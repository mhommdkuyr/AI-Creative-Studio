# MuseTalk CPU pilot checkpoint — 2026-11-01

## Source run
- Workflow run: 41254652598
- Workflow job: 124695139680 (cpu-inference-pilot), conclusion: success
- Checked-out commit: e718db5bcdb7bef2f689ef830f158de8ab528788
- Artifact: 13066051523 (musetalk-cpu-pilot-41254652598)
- Artifact SHA-256: ef033e442be5c59454856f45f46eddc9db804980425d8b60f7410c53f876a352

## Actual inference measurement
- Model: TMElyralab/MuseTalk v1.5
- Device: CPU only; hosted runner had 4 logical CPU threads, 15 GiB RAM, no NVIDIA GPU
- Pilot output duration: 11.775 s; 294 frames; 1080x1920 H.264 video + AAC mono 16 kHz audio
- Inference wall time: 7,266.0 s (2:01:06)
- Peak RSS: 8,395.2 MiB
- Throughput: 0.0405 fps
- Real-time factor: 617.07x
- ffprobe: passed; ffmpeg full decode: passed
- Artifact includes pilot_lipsynced.mp4, ffprobe JSON, timing report, and contact sheet.

## Synchronization assessment
The model completed genuine CPU inference and produced a decodable pilot MP4. The contact sheet shows rendered frames with plausible mouth poses, but this artifact does not include the original pilot input video/audio alongside the output in a form that permits a frame-by-frame source/output comparison here. Therefore visual/phonetic lip-sync accuracy is NOT certified. A successful inference and decode check are not proof of accurate synchronization.

## Engineering decision
CPU inference is not viable for the requested full episode on GitHub-hosted runners:
- At the measured rate, 720.023 seconds of currently safe dialogue would require approximately 444,000 seconds (~5.1 days) of CPU inference, before retries/encoding.
- Rendering all 6,153.995 seconds at the same rate would be approximately 3.8 million seconds (~44 days).
- This exceeds practical GitHub Actions job limits and would be an unreliable, expensive-in-time approach. No paid compute or GPU runner is authorized/available.
- Do not start full CPU rendering and do not run another duplicate pilot on the same CPU hardware.
- Do not upload the pilot or any partial output to Drive.

## Alignment checkpoint
- Alignment rebuild run: 41255382380
- Artifact: 13063195067
- 152 utterances audited; 72 word-coverage improvements accepted without changing voice/source timing
- Safe plan: 49/152 lines, 116 clips, 720.023 seconds dialogue (~11.7% of 6,153.995 s runtime)
- This remains partial dialogue coverage; the remaining dialogue must not be treated as synchronized.

## Drive and source protection
- No Drive file was created, replaced, deleted, or shared.
- The pilot workflow's Drive credential secret was absent, so the read-only preflight skipped Drive access.
- Original base video and all ten voice masters were not modified.
- Only a complete, validated ~6,153.995-second final MP4 may be uploaded to the configured destination folder.

## Next safe step
Obtain an already-connected, authorized GPU inference runner/resource within existing free/authorized limits, or a materially faster legal inference backend that can be benchmarked. Until then, retain this checkpoint and do not claim the episode is complete.