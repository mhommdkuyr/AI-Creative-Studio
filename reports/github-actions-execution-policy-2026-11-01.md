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


## Follow-up verification — 2026-11-01 (PR head 3aa16f0125cbb231ee2fb98fbfdc981a5ba2c2fa)

### Latest GitHub Actions results
- PR #10 remains open and mergeable; head is still `3aa16f0125cbb231ee2fb98fbfdc981a5ba2c2fa`.
- Candidate planner run `41278429682`: success. It rebuilt the plan from the verified render report and uploaded only the JSON plan as artifact `13072147463` (5,462 bytes; SHA-256 `771879e2a7fc082be012ae4fd575b1f872ac22d43a9cc9d4e0739484c8cbfe86`).
- Planner result: 152 rendered lines; 43 eligible before overlap filtering; 41 safe lines; 100 clips; 629.534 seconds of safe dialogue (~10.23% of 6,153.995 seconds). Exclusions: 6 low-confidence, 45 low-coverage, 46 timing-overrun, 12 audio-duration mismatch, 2 cross-speaker overlap.
- Python test run `41278429608`: success; 11/11 unit tests passed, including overlay graph offsets/chaining, voice-boundary preservation, resumable marker behavior, candidate filtering, and Arabic subtitle cue generation.
- `cloudflare-edge-ci` run `41278429673` and `integrated-mvp-ci` run `41278429610`: success.
- Push run `41278412177` completed with both `cpu-inference-pilot` and `voice-alignment-audit` skipped. This confirms the expensive CPU pilot is not started automatically after an ordinary push.
- The latest Actions checks are green. A separate commit status context named `Vercel` is `failure` (deployment failure; target URL is in the commit status). This is not a MuseTalk inference or test failure and was not modified in this dubbing-only pass.

### Safe mux code audit
- `scripts/assemble_musetalk_overlays.py` maps video from the overlay graph while mapping audio and subtitle streams from input `0` (the verified Arabic-dubbed base), with `-c:a copy` and `-c:s copy`. MuseTalk clip audio is not muxed.
- The assembly script refuses to assemble when planned clips are missing unless `--allow-partial` is explicitly supplied. No partial flag was used and no mux/render was launched in this pass.
- The existing unit tests cover graph timing/overlay chaining, but they do not constitute a full-length MP4 mux/decode or a visual/phonetic lip-sync review.

### Limits and disposition
- The latest candidate plan covers 629.534 seconds of dialogue only, not the full episode dialogue. It is a conservative candidate plan, not a completed dub.
- No new MuseTalk inference was run: the previously measured CPU rate (0.0405 fps / 617.07x real-time) makes the full episode impractical on the available GitHub-hosted CPU runner.
- No final MP4 was produced. No file was uploaded to the destination Drive folder, and no source video, voice master, or checkpoint was deleted or replaced.
- The PR includes `notebooks/musetalk_lipsync_colab.ipynb`, but this pass did not open or execute it; all checks above ran through GitHub Actions only.
- Required next capability: an already-authorized, connected GPU runner within existing permitted limits, or a materially faster backend benchmarked on the same sample. No paid compute is authorized.
