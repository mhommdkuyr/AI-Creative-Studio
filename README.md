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

Node.js 20+ and FFmpeg/FFprobe.

```bash
npm install
npm run dev
```

The web app runs through Vite and the API on port `8787`.

## Optional AI provider

Set `OPENAI_API_KEY` to enable the Responses API tool provider. Without it, local deterministic command parsing remains available for offline development and testing.

## Architecture direction

`AI-Creative-Studio` is the execution base because it already contains the Timeline, Rendering, Animation, Media, Asset, Project, State and AI engine foundations. The contracts from AI Video Studio are preserved under `packages/shared` and the API/runtime is being hardened around a vertical slice: import → timeline → AI command → undo/redo → MP4 render.
