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
- OpenAI-compatible AI tool provider through Experiential Labs (`apps/api/src/aiProvider.ts`)
- Backward-compatible OpenAI environment variable support
- Real FFmpeg MP4/H.264/AAC export, including multiple video clips with silent audio synthesis when a source has no audio
- Shared Timeline and `edit_timeline` contracts
- Automated regression suite that creates a real test video, uploads it, edits it, undoes/redoes it and renders a real MP4
- AI provider tests covering gateway requests, tool-call parsing and local fallback
- GitHub Actions integration CI for API and web builds

## Local requirements

Node.js 22+ and FFmpeg/FFprobe.

```bash
npm install
npm run dev
```

The web app runs through Vite and the API on port `8787`.

## AI provider configuration

The preferred AI path uses the Experiential Labs OpenAI-compatible gateway. Copy `apps/api/.env.example` to your runtime environment and set `EXPLABS_API_KEY` to an organization API key. The default base URL is `https://api.experientiallabs.ai/v1` and the default model is `claude-fable-5.1`.

The API key must remain server-side and must not be committed to Git. `.env*` files are ignored while `.env.example` is allowed. Without an AI key, the deterministic local command parser remains active, so development and regression tests continue to work offline.

Experiential Labs exposes an OpenAI-compatible `POST /v1/chat/completions` endpoint and documents `claude-fable-5.1` as an available model slug.

## Architecture direction

`AI-Creative-Studio` is the execution base because it already contains the Timeline, Rendering, Animation, Media, Asset, Project, State and AI engine foundations. The contracts from AI Video Studio are preserved under `packages/shared` and the API/runtime is being hardened around a vertical slice: import → timeline → AI command → undo/redo → MP4 render.
