# AI Creative Studio — Integrated AI Video MVP

This branch integrates the executable video-editing core into the Creative Studio UI and adopts the shared contracts designed for AI Video Studio.

## What works now

- React/TypeScript editor workspace
- Real project persistence with SQLite through `apps/api`
- Real local video upload and FFprobe metadata discovery
- Multi-clip video timeline with persistent clip state
- Split, delete, move and trim commands
- Undo/redo history (bounded)
- Arabic/English deterministic editing commands without an API key
- Optional OpenAI Responses API tool provider (`apps/api/src/aiProvider.ts`)
- Real FFmpeg MP4/H.264/AAC export, including multiple video clips with silent audio synthesis when a source has no audio
- Shared Timeline and `edit_timeline` contracts
- Automated regression suite that creates a real test video, uploads it, edits it, undoes/redoes it and renders a real MP4
- GitHub Actions integration CI for API and web builds

## Local requirements

Node.js 22+ and FFmpeg/FFprobe.

```bash
npm install
npm run dev
```

The web app runs through Vite and the API on port `8787`.

## Optional AI provider

Set `OPENAI_API_KEY` to enable the Responses API tool provider. Without it, local deterministic command parsing remains available for offline development and testing.

## Architecture direction

`AI-Creative-Studio` is the execution base because it already contains the Timeline, Rendering, Animation, Media, Asset, Project, State and AI engine foundations. The contracts from AI Video Studio are preserved under `packages/shared` and the API/runtime is being hardened around a vertical slice: import → timeline → AI command → undo/redo → MP4 render.


## Anime Animation Studio (new development branch)

The new browser-first animation workspace is being developed on the `anime-animation-studio` branch. It adds a PixiJS preview, editable character keyframes, scene cards, a prompt-to-shot-plan API, and basic skeletal JSON interchange for Spine and DragonBones.

See [docs/anime-animation-studio.md](docs/anime-animation-studio.md) for the supported workflows, limitations, deployment variables, and ChatGPT Action connection instructions. The feature branch is intentionally separate from main while CI and integration are checked.

## Arabic dubbing production workflow

The resumable workflow lives at https://github.com/mhommdkuyr/AI-Creative-Studio/blob/main/.github/workflows/arabic-dubbing-resumable.yml . It requires a rights-cleared direct HTTPS media-file URL and an explicit rights confirmation. It deliberately rejects YouTube watch/player URLs and does not use YouTube cookies or player-client workarounds. Supply a direct file URL from the rights holder or authorized storage; the workflow probes the media before processing.

The pipeline fingerprints the original and normalized source, includes source/settings/code identity in chunk cache keys, stores per-segment ASR/translation/TTS checkpoints, and verifies the rendered MP4's streams, duration, and full decode before emitting a SHA-256 manifest. The default translation backend is offline Argos Translate: it attempts a direct source-language-to-Arabic model, then an installed source-to-English plus English-to-Arabic pivot where available. Translation model packages are separate assets with their own terms; check the selected package metadata before commercial/restricted use. The remote GoogleTranslator path remains optional but can be rate-limited. Current audio capabilities use one configurable Arabic Edge TTS voice per segment/chunk. Speaker diarization, accurate emotion transfer, source music/effects separation, and visual lip-sync are not implemented; those limits are recorded in the output manifest.

### Required Google Drive Actions secrets

Configure these under Repository Settings → Secrets and variables → Actions → Repository secrets:

- GOOGLE_DRIVE_CREDENTIALS: complete JSON for a Google service account; never commit it or print it in logs.
- GOOGLE_DRIVE_FOLDER_ID: destination folder ID. Share the target folder with the service-account email address as an Editor.

If the Drive secrets are absent, the final MP4 is still published as a GitHub Actions artifact, while the Drive stage fails explicitly. To retry only the upload after the secrets are configured, use https://github.com/mhommdkuyr/AI-Creative-Studio/actions/workflows/retry-drive-upload.yml . Enter the original run ID and task ID from output/run_manifest.json; the retry validates the artifact and does not re-run ASR, translation or TTS.

A synthetic, original-source end-to-end smoke test is defined at https://github.com/mhommdkuyr/AI-Creative-Studio/blob/main/.github/workflows/arabic-dubbing-smoke-test.yml . It tests ASR, translation, Arabic TTS, resumption, muxing and MP4 decode without downloading a third-party episode.
