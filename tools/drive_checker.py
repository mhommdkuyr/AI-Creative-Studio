#!/usr/bin/env python3
import os
import sys
import json
import urllib.request
import urllib.error

FILE_IDS = {
    "ref_video": {"id": "1ygz0hzQNH70VsP8-2DCSFO9OFPg7JB4_", "name": "Red vs Black 2023 (by MicroMist)_720p.mp4"},
    "char_a": {"id": "18H3tcZeY4wdtk7ech6nNxi-eDDiMHFp0", "name": "Nightshade J Friedrich.fbx"},
    "char_b": {"id": "1b7B-tJXlZ4al_0yeiF9ktY1vLDkgDP9W", "name": "Prisoner B Styperek.fbx"},
    "comfy_workflow": {"id": "1zx107T1rKDTjV7_jW_oey59EYgCYWy7l", "name": "ComfyUI_Anime_Combat_Workflow.json"},
    "colab_notebook": {"id": "1yq3Ovuc_dGvmHGIyurqiGwyzuI32ndt_", "name": "Anime_Combat_ComfyUI_Colab_T4.ipynb"},
}

def check_drive_access():
    token = os.environ.get("GOOGLE_DRIVE_ACCESS_TOKEN", "").strip()
    report = {
        "token_configured": bool(token),
        "files": {},
        "blockers": []
    }

    if not token:
        report["blockers"].append(
            "GOOGLE_DRIVE_ACCESS_TOKEN is not configured in the server environment. Direct Google Drive API downloads require OAuth authentication or temporary download URLs."
        )

    for key, meta in FILE_IDS.items():
        file_id = meta["id"]
        file_info = {"file_id": file_id, "name": meta["name"], "accessible": False, "status_code": None, "error": None}

        if token:
            url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true"
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    file_info["accessible"] = (resp.status == 200)
                    file_info["status_code"] = resp.status
            except urllib.error.HTTPError as e:
                file_info["status_code"] = e.code
                file_info["error"] = f"HTTP {e.code}"
            except Exception as e:
                file_info["error"] = str(e)
        else:
            file_info["error"] = "No Google Drive access token configured"

        report["files"][key] = file_info

    return report

if __name__ == "__main__":
    res = check_drive_access()
    print(json.dumps(res, indent=2))
