#!/usr/bin/env python3
"""Re-transcribe the ten existing Arabic voice masters with CPU Whisper; never modifies audio."""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--cpu-threads", type=int, default=4)
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise SystemExit(f"Could not import faster-whisper: {type(exc).__name__}: {exc}") from exc

    voice_dir = Path(args.voice_dir)
    out_dir = Path(args.out_dir)
    files = sorted(
        path for path in voice_dir.glob("*.wav")
        if path.name[:2].isdigit() and 1 <= int(path.name[:2]) <= 10
    )
    if len(files) != 10:
        raise SystemExit(f"Expected exactly ten numbered WAV masters; found {len(files)}")

    print(f"Loading Whisper model {args.model} on CPU (int8, {args.cpu_threads} threads)", flush=True)
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        cpu_threads=args.cpu_threads,
        num_workers=1,
    )

    manifest = {
        "status": "VOICE_MASTER_ASR_COMPLETE",
        "model": args.model,
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": args.cpu_threads,
        "tracks": [],
    }

    for index, path in enumerate(files, 1):
        started = time.monotonic()
        print(f"[{index}/10] Transcribing {path.name}", flush=True)
        segments, info = model.transcribe(
            str(path),
            language="ar",
            beam_size=2,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 350, "speech_pad_ms": 180},
            word_timestamps=True,
            condition_on_previous_text=True,
        )
        rows = []
        word_count = 0
        for segment in segments:
            words = []
            for word in segment.words or []:
                text = (word.word or "").strip()
                if not text:
                    continue
                words.append({
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                    "text": text,
                    "probability": round(float(word.probability), 4),
                })
            text = " ".join((segment.text or "").split())
            if text:
                rows.append({
                    "index": len(rows),
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "text": text,
                    "words": words,
                })
                word_count += len(words)

        record = {
            "file": path.name,
            "sha256": sha256_file(path),
            "language_detected": "ar",
            "duration_seconds": round(float(getattr(info, "duration", 0) or 0), 3),
            "elapsed_seconds": round(time.monotonic() - started, 1),
            "segments": rows,
        }
        atomic_json(out_dir / f"{path.stem}.json", record)
        manifest["tracks"].append({
            "file": path.name,
            "sha256": record["sha256"],
            "duration_seconds": record["duration_seconds"],
            "segments": len(rows),
            "words": word_count,
            "elapsed_seconds": record["elapsed_seconds"],
        })
        print(json.dumps(manifest["tracks"][-1], ensure_ascii=False), flush=True)

    manifest["total_duration_seconds"] = round(sum(x["duration_seconds"] for x in manifest["tracks"]), 3)
    manifest["total_elapsed_seconds"] = round(sum(x["elapsed_seconds"] for x in manifest["tracks"]), 1)
    atomic_json(out_dir / "voice_asr_manifest.json", manifest)
    print(json.dumps({
        "status": manifest["status"],
        "model": manifest["model"],
        "tracks": len(manifest["tracks"]),
        "total_duration_seconds": manifest["total_duration_seconds"],
        "total_elapsed_seconds": manifest["total_elapsed_seconds"],
    }, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
