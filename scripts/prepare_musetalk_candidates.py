#!/usr/bin/env python3
"""Build a conservative, resumable MuseTalk plan from an existing verified render manifest."""
from __future__ import annotations
import argparse, json, math
from pathlib import Path


def build_plan(manifest: dict, *, min_confidence: float = 0.80,
               min_coverage: float = 0.70, min_audio_fit: float = 0.75,
               max_audio_fit: float = 1.25, max_clip_seconds: float = 8.0,
               overlap_tolerance: float = 0.25) -> dict:
    lines = manifest.get("lines", [])
    eligible = []
    excluded = {"low_confidence": 0, "low_coverage": 0, "timing_overrun": 0, "audio_duration_mismatch": 0, "invalid_timing": 0}
    for line in lines:
        conf = float(line.get("confidence") or 0)
        cov = float(line.get("arabic_word_alignment_coverage") or 0)
        if conf < min_confidence:
            excluded["low_confidence"] += 1; continue
        if cov < min_coverage:
            excluded["low_coverage"] += 1; continue
        if bool(line.get("timing_overrun")):
            excluded["timing_overrun"] += 1; continue
        start, end = float(line.get("source_start", -1)), float(line.get("source_end", -1))
        atempo = float(line.get("atempo") or 1.0)
        voice_duration = float(line.get("voice_end", 0)) - float(line.get("voice_start", 0))
        fit_ratio = (voice_duration / atempo / (end - start)) if atempo > 0 and end > start else 0.0
        if not (math.isfinite(start) and math.isfinite(end) and end > start and 0.75 <= atempo <= 1.45):
            excluded["invalid_timing"] += 1; continue
        if not (min_audio_fit <= fit_ratio <= max_audio_fit):
            excluded["audio_duration_mismatch"] += 1; continue
        eligible.append(line)

    conflicts = set()
    for i, a in enumerate(eligible):
        for j in range(i + 1, len(eligible)):
            b = eligible[j]
            overlap = min(float(a["source_end"]), float(b["source_end"])) - max(float(a["source_start"]), float(b["source_start"]))
            if overlap > overlap_tolerance and a.get("speaker_script_id") != b.get("speaker_script_id"):
                conflicts.update((i, j))
    excluded["cross_speaker_overlap"] = len(conflicts)

    safe_lines = [line for i, line in enumerate(eligible) if i not in conflicts]
    clips = []
    for line in safe_lines:
        start, end = float(line["source_start"]), float(line["source_end"])
        voice_start, voice_end = float(line["voice_start"]), float(line["voice_end"])
        atempo = float(line.get("atempo") or 1.0)
        duration = end - start
        voice_duration = voice_end - voice_start
        audio_fit_ratio = (voice_duration / atempo / duration) if atempo > 0 and duration > 0 else 0.0
        chunk_count = max(1, int(math.ceil(duration / max_clip_seconds)))
        chunk_size = duration / chunk_count
        line_id = f"{line['speaker_script_id']}_{int(line['utterance_index']):03d}"
        for index in range(chunk_count):
            cstart = start + index * chunk_size
            cend = end if index == chunk_count - 1 else start + (index + 1) * chunk_size
            vo_start = voice_start + (cstart - start) * atempo
            vo_end = min(voice_end, voice_start + (cend - start) * atempo)
            if cend - cstart <= 0:
                continue
            clips.append({
                "clip_id": f"{line_id}_{index:02d}",
                "line_id": line_id,
                "chunk_index": index,
                "chunk_count": chunk_count,
                "speaker_script_id": line["speaker_script_id"],
                "utterance_index": int(line["utterance_index"]),
                "voice_master": line["voice_master"],
                "source_start": round(cstart, 3),
                "source_end": round(cend, 3),
                "voice_start": round(vo_start, 3),
                "voice_end": round(vo_end, 3),
                "atempo": round(atempo, 4),
                "target_duration": round(cend - cstart, 3),
                "confidence": round(float(line["confidence"]), 3),
                "word_alignment_coverage": round(float(line["arabic_word_alignment_coverage"]), 3),
                "audio_fit_ratio": round(audio_fit_ratio, 3),
                "silent_audio_chunk": vo_end <= vo_start,
                "source_segment_index": line.get("source_segment_index"),
            })

    # Prefer a short 4-7s sample for the first GPU benchmark; then highest coverage/confidence.
    pilot_pool = [c for c in clips if 4.0 <= c["target_duration"] <= 7.0]
    pilot = max(pilot_pool, key=lambda c: (-abs(1.0-c["audio_fit_ratio"]), c["word_alignment_coverage"], c["confidence"])) if pilot_pool else (clips[0] if clips else None)
    return {
        "schema_version": 1,
        "source_video_sha256": manifest.get("source_video_sha256"),
        "base_dub_video_sha256": manifest.get("video_sha256"),
        "video_duration_seconds": manifest.get("video_duration_seconds"),
        "selection_policy": {
            "min_confidence": min_confidence,
            "min_word_alignment_coverage": min_coverage,
            "min_audio_fit_ratio": min_audio_fit,
            "max_audio_fit_ratio": max_audio_fit,
            "exclude_timing_overruns": True,
            "exclude_cross_speaker_overlaps": True,
            "max_clip_seconds": max_clip_seconds,
        },
        "summary": {
            "rendered_lines": len(lines),
            "eligible_lines_before_overlap_filter": len(eligible),
            "safe_lines": len(safe_lines),
            "clips": len(clips),
            "safe_dialogue_seconds": round(sum(c["target_duration"] for c in clips), 3),
            "excluded": excluded,
        },
        "pilot_clip_id": pilot["clip_id"] if pilot else None,
        "clips": clips,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render-manifest", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--min-confidence", type=float, default=0.80)
    ap.add_argument("--min-coverage", type=float, default=0.70)
    ap.add_argument("--min-audio-fit", type=float, default=0.75)
    ap.add_argument("--max-audio-fit", type=float, default=1.25)
    ap.add_argument("--max-clip-seconds", type=float, default=8.0)
    args = ap.parse_args()
    data = json.loads(Path(args.render_manifest).read_text(encoding="utf-8"))
    plan = build_plan(data, min_confidence=args.min_confidence,
                      min_coverage=args.min_coverage, min_audio_fit=args.min_audio_fit,
                      max_audio_fit=args.max_audio_fit, max_clip_seconds=args.max_clip_seconds)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": args.output, **plan["summary"], "pilot_clip_id": plan["pilot_clip_id"]}, ensure_ascii=False))

if __name__ == "__main__":
    main()
