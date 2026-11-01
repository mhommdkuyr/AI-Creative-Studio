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


## Documentation-commit CI verification — 2026-11-01 (head bddb1403809a374459c68b2caa7aefaae423ce1f)

- The checkpoint update was committed as `bddb1403809a374459c68b2caa7aefaae423ce1f`; PR #10 remains open and mergeable.
- The new PR synchronization triggered four GitHub Actions workflows. All completed successfully:
  - `MuseTalk candidate planner tests` run `41282384124`: 11/11 tests passed.
  - `Build verified MuseTalk candidate plan` run `41282384095`: success; same 41 safe lines / 100 clips / 629.534 seconds. Artifact `13073581844`, 5,462 bytes, SHA-256 `ca8ace14d56a8138dd4a99b465549e0d74814027ae0e125e385e960c604f1783`.
  - `cloudflare-edge-ci` run `41282384132`: success.
  - `integrated-mvp-ci` run `41282384099`: both web and API jobs succeeded, including API regression.
- The current commit's Vercel status was pending at the last check; this is separate from the completed successful GitHub Actions jobs.
- No CPU inference, final MP4 mux, full-length decode, visual/phonetic lip-sync review, or Drive upload was performed. No Colab notebook was opened or executed.


## Latest PR-head verification — 2026-11-01 (branch head 59b4b32b65a9a2816196364c9399ba8f0df1a2e5)

- PR #10 remains open and mergeable; latest branch head at inspection: `59b4b32b65a9a2816196364c9399ba8f0df1a2e5`.
- The latest PR Actions runs associated with this head completed successfully:
  - Candidate planner tests: run `41282453986`, job `124776962876`; Python compilation passed and all 11/11 unit tests passed.
  - Candidate plan: run `41282453991`, job `124776962755`; downloaded the compact render report, rebuilt the conservative plan and passed the source/duration/budget assertions.
  - Integrated CI: run `41282454014`; API and web jobs both succeeded.
  - Cloudflare edge CI: run `41282454069`; validation/build and Wrangler dry-run succeeded.
- The verified plan artifact is `13074196062`, `verified-musetalk-candidate-plan`, 5,462 bytes; ZIP SHA-256 `b73db5fe951e4c44c559945c1f3909f99dea2134b89e95a54d5ae3d634874680`. Its JSON records the exact base-dub SHA-256 `85efc3b6130a411789d27a622244cec75845dca4b0923b9a9048cd2e1235a087` and duration 6,153.995 seconds.
- Candidate coverage remains limited: 152 rendered lines audited; 43 eligible before overlap filtering; 41 safe lines; 100 clips; 629.534 seconds of dialogue (10.23% of episode runtime). Exclusions: 6 low-confidence, 45 low-coverage, 46 timing-overrun, 12 voice-duration mismatch, and 2 cross-speaker overlaps. This is a candidate plan only, not rendered lip-sync.
- Assembly-code review confirms the overlay script maps audio and subtitle streams from input 0 and copies them; it does not mux MuseTalk-generated audio. It refuses missing planned clips unless the explicit `--allow-partial` flag is used. Its existing tests cover graph offsets/chaining, not full-episode mux/decode or phonetic lip-sync accuracy.
- The expensive CPU MuseTalk pilot remains gated behind explicit manual dispatch; no new inference was started in this verification. The prior measured rate still makes full-episode inference impractical on the available CPU runner.
- The latest combined commit status contains a failing `Vercel` deployment context. This is separate from the successful GitHub Actions tests/builds above and was not changed in this dubbing-only pass.
- No final full-length MP4 is present in the latest run artifacts; the only MuseTalk-specific artifact from this head is the 5,462-byte JSON candidate plan. No final mux, complete MP4 decode, visual/phonetic review, or Drive upload occurred. No Colab notebook was opened or executed; source video, voice masters and checkpoints remain untouched.
- Blocking requirement remains an already-authorized connected GPU runner within existing permitted limits, or a separately benchmarked materially faster inference backend. Do not use paid compute without explicit approval; do not upload pilot/partial output.
