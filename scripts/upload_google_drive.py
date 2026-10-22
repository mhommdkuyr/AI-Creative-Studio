#!/usr/bin/env python3
"""Resumable/idempotent upload of a verified dubbing MP4 to a configured Drive folder."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"Missing GitHub Actions secret/variable {name}. "
            "The verified MP4 remains available as a workflow artifact; Drive upload did not occur."
        )
    return value


def upload_resumable(request):
    response = None
    while response is None:
        try:
            _status, response = request.next_chunk(num_retries=5)
        except Exception as exc:
            raise RuntimeError(
                f"Google Drive resumable upload failed ({type(exc).__name__}); "
                "the workflow artifact remains available for a retry."
            ) from exc
    return response


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--filename", required=True)
    args = parser.parse_args()

    file_path = Path(args.file).resolve()
    if not file_path.is_file() or file_path.stat().st_size < 1_000_000:
        raise RuntimeError("Refusing to upload: final MP4 is missing or below the minimum validated size.")
    output_hash = sha256_file(file_path)
    expected_hash = os.environ.get("EXPECTED_OUTPUT_SHA256", "").strip()
    if expected_hash and output_hash != expected_hash:
        raise RuntimeError("Refusing to upload: MP4 SHA-256 does not match the verified output hash.")
    folder_id = required_env("GOOGLE_DRIVE_FOLDER_ID")
    credential_text = required_env("GOOGLE_DRIVE_CREDENTIALS")
    try:
        credential_info = json.loads(credential_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            "GOOGLE_DRIVE_CREDENTIALS must contain the service-account JSON document as a GitHub Actions secret."
        ) from exc
    if credential_info.get("type") != "service_account":
        raise RuntimeError("GOOGLE_DRIVE_CREDENTIALS must be a Google service-account JSON document.")

    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    credentials = service_account.Credentials.from_service_account_info(
        credential_info,
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )
    del credential_info, credential_text
    service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    escaped_task = args.task_id.replace("'", "\\'")
    escaped_folder = folder_id.replace("'", "\\'")
    query = (
        f"'{escaped_folder}' in parents and trashed = false and "
        f"appProperties has {{ key='task_id' and value='{escaped_task}' }}"
    )
    fields = "files(id,name,size,webViewLink,appProperties,parents,md5Checksum)"
    existing = service.files().list(
        q=query, pageSize=20, spaces="drive", fields=fields
    ).execute(num_retries=5).get("files", [])

    same = next((
        item for item in existing
        if (item.get("appProperties") or {}).get("output_sha256") == output_hash
        and str(item.get("size", "")) == str(file_path.stat().st_size)
    ), None)
    if same:
        result = {
            "status": "already_present",
            "file_id": same["id"],
            "name": same.get("name", args.filename),
            "size_bytes": int(same["size"]),
            "sha256": output_hash,
            "webViewLink": same.get("webViewLink", ""),
        }
    else:
        metadata = {
            "name": args.filename,
            "mimeType": "video/mp4",
            "parents": [folder_id],
            "description": (
                "Verified Arabic dubbing pipeline output. "
                f"Task: {args.task_id}; source SHA-256: {args.source_sha256}; output SHA-256: {output_hash}."
            ),
            "appProperties": {
                "task_id": args.task_id,
                "source_sha256": args.source_sha256,
                "output_sha256": output_hash,
            },
        }
        media = MediaFileUpload(
            str(file_path), mimetype="video/mp4", resumable=True,
            chunksize=8 * 1024 * 1024,
        )
        if existing:
            item = existing[0]
            request = service.files().update(
                fileId=item["id"], body={k:v for k,v in metadata.items() if k != "parents"}, media_body=media, fields=fields
            )
        else:
            request = service.files().create(body=metadata, media_body=media, fields=fields)
        uploaded = upload_resumable(request)
        file_id = uploaded.get("id")
        if not file_id:
            raise RuntimeError("Drive upload returned no file ID; refusing to report success.")
        verified = service.files().get(fileId=file_id, fields=fields).execute(num_retries=5)
        if (
            str(verified.get("size", "")) != str(file_path.stat().st_size)
            or (verified.get("appProperties") or {}).get("output_sha256") != output_hash
            or verified.get("name") != args.filename
        ):
            raise RuntimeError("Drive upload was returned, but remote size/name/hash metadata failed verification.")
        if folder_id not in verified.get("parents", []):
            raise RuntimeError("Drive file exists but is not listed inside the configured destination folder.")
        result = {
            "status": "uploaded_and_verified",
            "file_id": file_id,
            "name": verified["name"],
            "size_bytes": int(verified["size"]),
            "sha256": output_hash,
            "webViewLink": verified.get("webViewLink", ""),
        }

    serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    print("DRIVE_RESULT " + serialized)
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as f:
            f.write(f"drive_status={result['status']}\n")
            f.write(f"drive_file_id={result['file_id']}\n")
            f.write(f"drive_web_view_link={result['webViewLink']}\n")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write("## Google Drive upload verification\n\n")
            f.write(f"- Status: {result['status']}\n")
            f.write(f"- File: {result['name']}\n")
            f.write(f"- Size: {result['size_bytes']} bytes\n")
            f.write(f"- SHA-256: {result['sha256']}\n")
            f.write(f"- File ID: {result['file_id']}\n")
            if result["webViewLink"]:
                f.write(f"- Link: {result['webViewLink']}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"::error::{type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)
