#!/usr/bin/env python3
import json
import sys

REQUIRED_KEYS = ["title", "resolution", "fps", "durationSeconds", "totalFrames", "characters", "shots", "confidence"]

def validate_manifest(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    errors = []
    for k in REQUIRED_KEYS:
        if k not in data:
            errors.append(f"Missing required top-level key: {k}")

    if data.get("resolution") != [1920, 1080]:
        errors.append(f"Expected resolution [1920, 1080], got {data.get('resolution')}")

    if data.get("fps") != 60:
        errors.append(f"Expected fps 60, got {data.get('fps')}")

    expected_frames = int(data.get("fps", 60) * data.get("durationSeconds", 0))
    if data.get("totalFrames") != expected_frames:
        errors.append(f"totalFrames mismatch: expected {expected_frames}, got {data.get('totalFrames')}")

    shots = data.get("shots", [])
    if not shots or len(shots) < 2:
        errors.append("Manifest should have at least 2 shots")

    for idx, shot in enumerate(shots):
        if "id" not in shot or "startTime" not in shot or "duration" not in shot:
            errors.append(f"Shot index {idx} missing basic fields (id, startTime, duration)")
        if "keyframes" not in shot or not isinstance(shot["keyframes"], list):
            errors.append(f"Shot {shot.get('id')} missing keyframes array")
        if "effectEvents" not in shot or not isinstance(shot["effectEvents"], list):
            errors.append(f"Shot {shot.get('id')} missing effectEvents array")
        if "audioCues" not in shot or not isinstance(shot["audioCues"], list):
            errors.append(f"Shot {shot.get('id')} missing audioCues array")

    return errors, data

if __name__ == "__main__":
    filepath = sys.argv[1] if len(sys.argv) > 1 else "docs/episodes/fight-manifest-1080p60.json"
    errs, manifest = validate_manifest(filepath)
    if errs:
        print("Manifest validation FAILED:")
        for e in errs:
            print(" -", e)
        sys.exit(1)
    else:
        print(f"Manifest '{filepath}' VALIDATED successfully! Total shots: {len(manifest['shots'])}, Total frames: {manifest['totalFrames']}")
