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
- The conservative plan currently selects 41 of 152 rendered lines, split into 100 clips (about 629.53 seconds of dialogue, around 10.2% of the 6154-second video). An additional voice-duration-fit filter excludes 12 lines that would otherwise require substantial silence padding. The remaining lines are excluded because of low confidence/coverage, timing overruns or cross-speaker overlap. Therefore, an output from this plan is explicitly a partial safe lip-sync pass, not a fully lip-synced episode.

## Why not use the 2.48 GB Drive file?
It is a different 2h07m cut and does not match the 1h42m voice timing/alignment. The notebook downloads the private 1h42m base video through authenticated, resumable Google Drive API range requests into a persistent My Drive cache, then verifies its hash and duration before processing. It does not make the file public.
