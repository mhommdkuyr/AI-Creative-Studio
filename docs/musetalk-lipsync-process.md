# MuseTalk lip-sync repair workflow

## Verified inputs
- Base dubbed video: GitHub Actions artifact from run `41119346692`, SHA-256 `85efc3b6130a411789d27a622244cec75845dca4b0923b9a9048cd2e1235a087`, 971,090,724 bytes, 6153.995 seconds. It matches the verified Drive copy; use the artifact as the private-input-free Actions checkpoint and verify the hash before processing.
- Matching original source ID: `13AL8R54GE-S41TsIbXGX1rhIa-Y0HZm-` (6153.974 seconds). Do not use the unrelated 2.48 GB / 2h07m cut.
- Ten existing Arabic voice masters and exact alignment/render reports: bundled in the GitHub Release `arabic-dub-assets-2026-10-31`; verify all ten WAV hashes against `source_manifest.json`.
- Do not use duplicate SRT cues as the timing source. Use the source-to-Arabic mapping, render manifest, speaker mapping and word-level timing evidence.

## Open-source components
- MuseTalk v1.5: MIT code and MIT model metadata on the official Hugging Face repository; dependencies retain their own licenses.
- FFmpeg: media slicing, time fitting, muxing and video overlay.
- Existing voice masters only: no new transcription-driven TTS and no regeneration of the ten WAV masters.
- The official MuseTalk inference script selects CUDA when available and otherwise selects CPU. CPU is therefore a supported execution path in the code, but its throughput and quality must be measured on the actual sample before committing to a full run.

## Execution policy
- Do not use Google Colab or any Colab notebook for this project.
- Start with GitHub Actions `ubuntu-latest` CPU-only inference, FP32, batch size 1, and measured wall time/RAM. Never request a GPU runner unless one is explicitly registered and online.
- Use only the matching 6153.995-second base video for picture overlays. Keep the existing Arabic dialogue/music/effects mix bit-identical by overlaying only the video stream and copying the original audio stream.
- Process a continuous 10–20 second representative sample first. Record model loading time, inference time, peak RSS, disk use, output frame count and decode checks. Do not infer lip-sync performance from FFmpeg-only tests.
- Save checkpoints and completed clips so an interrupted GitHub Actions run can resume without regenerating TTS or reprocessing completed clips.
- Do not publish or upload a partial pass as the final episode. A full-length container with only a subset of dialogue corrected remains a partial lip-sync result.

## Current alignment limitations
- Current conservative plan: 152 rendered utterances, 41 safe utterances, 100 clips, 629.534 seconds of safe dialogue. It excludes low-confidence mappings, low word-alignment coverage, timing overruns, audio-duration mismatches and cross-speaker overlaps.
- The 41-line plan is not a fully lip-synced episode. Re-audit Arabic word timing with a stronger CPU ASR model, but accept improved coverage only when the newly detected voice boundaries agree with the existing render timing. Do not move the audio or relax confidence thresholds merely to increase the clip count.
- If a line cannot be aligned without changing the existing Arabic audio timing or guessing speaker identity, leave it out and report it as unresolved.

## Final verification and Drive policy
- Before a final render, require every rendered utterance to have a verified, non-overlapping lip-sync clip. Verify exact video duration, stream presence, full decode, audio-track hash preservation and visual/audio samples from the beginning, middle and end.
- Upload only the complete, verified final episode to Drive folder `1SE3JYbB4c-pC1W-ymRK6S5CsFt-XidzA`. Use the existing service-account secret if configured; never change Drive sharing permissions or expose credentials.
