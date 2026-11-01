# GitHub Actions execution policy — 2026-11-01

## Latest verified source
- PR #10 branch: fix/srt-cue-dedup-and-sync-audit
- Previous checkpoint: 120ff55314f942d11b87cebfaf4260ec57e1cdee
- CPU MuseTalk pilot: run 41254652598, job 124695139680, artifact 13066051523
- Pilot inference: 11.775 s / 294 frames; 7,266 s wall time; 0.0405 fps; peak RSS 8,395 MiB; CPU-only, 4 threads, 15 GiB RAM, no NVIDIA GPU.
- Output ffprobe and full ffmpeg decode passed. Phonetic lip-sync quality is not certified because the original sample was not retained beside the output for controlled A/B comparison.
- Alignment rebuild: run 41255382380, artifact 13063195067; 152 utterances audited, 72 coverage improvements accepted, 49 safe lines / 116 clips / 720.023 s dialogue. Coverage is partial.

## Engineering decision
- Full MuseTalk CPU rendering is not viable on GitHub-hosted runners at measured throughput: approximately 44 days of inference for the full 6,153.995 s episode, or about 5.1 days for the currently safe dialogue subset, excluding setup, retries and muxing.
- Matrix chunking does not reduce total CPU consumption and would multiply hosted-runner minutes. It is not a valid workaround under the no-paid-compute constraint.
- Do not start a full CPU render, do not relax alignment thresholds, do not substitute a pilot for a final episode, and do not upload partial output to Drive.
- Continue CPU Actions for deterministic planning, alignment QA, tests, source-hash checks, FFmpeg mux/decode verification and artifact/checkpoint handling.
- A full lip-sync inference pass requires an already-connected authorized GPU resource or a substantially faster, separately benchmarked CPU inference backend. No paid resource is authorized.

## Workflow safety change
- Commit dd10c656911d008f3056bb594cd6c9bf52a40306 gates the expensive CPU MuseTalk pilot behind an explicit workflow_dispatch boolean input `run_cpu_pilot=true`.
- The pilot no longer launches automatically on every push. The workflow_dispatch default is false.
- ASR audit remains independently opt-in via `run_voice_alignment_audit=true`.
- This prevents accidental repeated 2-hour CPU inference jobs and preserves free Actions minutes.

## Drive/source protection
- No Drive writes, replacements, deletes, or sharing changes were made.
- Original 6153.995-second base video and ten voice masters remain untouched.
- Only a fully verified complete episode may be uploaded to folder 1SE3JYbB4c-pC1W-ymRK6S5CsFt-XidzA.
- No Google Colab or notebook was used.

## Next step
- Run lightweight validation for the updated workflow YAML and continue candidate-plan/alignment regression checks.
- Do not trigger MuseTalk CPU inference again unless explicitly required for a narrowly scoped diagnostic; it is already proven too slow for full production.
