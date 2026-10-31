# MuseTalk lip-sync repair workflow

## Verified inputs
- Base dubbed MKV in Drive: `15MkBM0m9YduRz4pim2Stp_9ruW5XbqKw` (971,090,724 bytes; SHA-256 is checked by the notebook).
- Matching original source ID: `13AL8R54GE-S41TsIbXGX1rhIa-Y0HZm-` (6153.974 seconds). Do not use the unrelated 2.48 GB / 2h07m cut.
- Ten existing Arabic voice masters: bundled in the GitHub Release; every WAV SHA-256 matched `analysis_manifest.json`.
- Exact alignment and render report: included in the release bundle.

## Open-source components
- MuseTalk v1.5: MIT code; model weights and third-party assets have their own licenses.
- FFmpeg: media slicing, time fitting, muxing and video overlay.
- Existing WhisperX/ASR and alignment JSON are reused; no new transcription, TTS or Gemini call is made in the pilot.

## Resource policy
- No CPU inference fallback. Require a Colab T4-class GPU with at least 10 GB reported VRAM.
- Cache weights and completed clips on Drive.
- Process maximum 8 seconds per clip, 6 clips per session, 25 GPU minutes per session.
- First run is one 4.72-second pilot; inspect it before enabling batch processing.
- Minimal weight downloader skips MuseTalk v1.0 and optional SyncNet weights.
- The conservative plan currently selects 49 of 152 rendered lines, split into 113 clips (about 743.52 seconds of dialogue, around 12.1% of the 6154-second video). The remaining lines are excluded because of low confidence/coverage, timing overruns or cross-speaker overlap. Therefore, an output from this plan is explicitly a partial safe lip-sync pass, not a fully lip-synced episode.

## Why not use the 2.48 GB Drive file?
It is a different 2h07m cut and does not match the 1h42m voice timing/alignment. The notebook uses the already-rendered 1h42m base video and verifies its hash and duration before processing.
