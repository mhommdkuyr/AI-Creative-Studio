#!/usr/bin/env python3
"""Accept improved Arabic word coverage only when the existing voice timing remains stable."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def merge_alignment_audit(
    render_manifest: dict,
    timing: dict,
    *,
    model_name: str = "large-v3-turbo",
    boundary_tolerance: float = 0.35,
) -> dict:
    lookup = {}
    for track in timing.get("tracks", []):
        speaker_id = track.get("speaker_id")
        for utterance in track.get("utterances", []):
            lookup[(speaker_id, int(utterance.get("utterance_index", 0) or 0))] = utterance

    result = json.loads(json.dumps(render_manifest))
    improved = []
    rejected = []
    unchanged = 0

    for line in result.get("lines", []):
        key = (line.get("speaker_script_id"), int(line.get("utterance_index", 0) or 0))
        candidate = lookup.get(key)
        if not candidate:
            rejected.append({"key": key, "reason": "missing_new_alignment"})
            continue

        old_coverage = float(line.get("arabic_word_alignment_coverage") or 0)
        new_coverage = float(candidate.get("word_alignment_coverage") or 0)
        new_start = candidate.get("track_start_seconds")
        new_end = candidate.get("track_end_seconds")
        old_start = float(line.get("voice_start") or 0)
        old_end = float(line.get("voice_end") or 0)

        if new_start is None or new_end is None or float(new_end) <= float(new_start):
            rejected.append({"key": key, "reason": "invalid_new_voice_boundaries"})
            continue

        start_delta = abs(float(new_start) - old_start)
        end_delta = abs(float(new_end) - old_end)
        max_delta = max(start_delta, end_delta)

        if new_coverage > old_coverage and max_delta <= boundary_tolerance:
            line["arabic_word_alignment_coverage"] = round(new_coverage, 3)
            line["alignment_audit"] = {
                "model": model_name,
                "accepted": True,
                "previous_coverage": round(old_coverage, 3),
                "new_coverage": round(new_coverage, 3),
                "start_delta_seconds": round(start_delta, 3),
                "end_delta_seconds": round(end_delta, 3),
            }
            improved.append({
                "speaker_script_id": key[0],
                "utterance_index": key[1],
                "previous_coverage": round(old_coverage, 3),
                "new_coverage": round(new_coverage, 3),
                "boundary_delta_seconds": round(max_delta, 3),
            })
        else:
            unchanged += 1
            reason = "boundary_drift" if max_delta > boundary_tolerance else "no_coverage_gain"
            line["alignment_audit"] = {
                "model": model_name,
                "accepted": False,
                "reason": reason,
                "previous_coverage": round(old_coverage, 3),
                "candidate_coverage": round(new_coverage, 3),
                "start_delta_seconds": round(start_delta, 3),
                "end_delta_seconds": round(end_delta, 3),
            }
            rejected.append({
                "speaker_script_id": key[0],
                "utterance_index": key[1],
                "reason": reason,
                "previous_coverage": round(old_coverage, 3),
                "candidate_coverage": round(new_coverage, 3),
                "boundary_delta_seconds": round(max_delta, 3),
            })

    result["alignment_audit"] = {
        "model": model_name,
        "boundary_tolerance_seconds": boundary_tolerance,
        "improved_lines": len(improved),
        "unchanged_or_rejected_lines": unchanged + len(rejected),
        "improvements": improved,
        "rejections": rejected,
        "policy": "Voice start/end and source timing remain unchanged; only word coverage is raised when a stronger ASR agrees with existing boundaries.",
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--render-manifest", required=True)
    parser.add_argument("--voice-line-timing", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--boundary-tolerance", type=float, default=0.35)
    args = parser.parse_args()

    manifest = json.loads(Path(args.render_manifest).read_text(encoding="utf-8"))
    timing = json.loads(Path(args.voice_line_timing).read_text(encoding="utf-8"))
    merged = merge_alignment_audit(
        manifest,
        timing,
        model_name=args.model,
        boundary_tolerance=args.boundary_tolerance,
    )
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    audit = merged["alignment_audit"]
    print(json.dumps({
        "output": str(destination),
        "model": audit["model"],
        "improved_lines": audit["improved_lines"],
        "unchanged_or_rejected_lines": audit["unchanged_or_rejected_lines"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
