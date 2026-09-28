# Browser-first architecture

## Goal

AI Creative Studio is being evolved into a browser-first editor with two execution tiers:

1. **Local tier** — editing, preview and export that can run on the user's device. Media is not uploaded.
2. **Remote tier** — long/heavy renders and advanced analysis executed only after the user explicitly starts a remote job.

The existing repository already has the executable vertical slice: React/TypeScript editor, SQLite project persistence, FFprobe metadata discovery, multi-clip timeline, split/delete/move/trim, bounded undo/redo, deterministic Arabic/English commands, optional AI providers and real FFmpeg MP4/H.264/AAC export. See README.

## Execution graph

```text
User command / reference
        |
        v
Intent + reference analysis
        |
        v
EditPlan (versioned operations)
        |
        v
Timeline transaction
   |              |
   |              +--> history checkpoint
   |
   +--> local renderer when supported
   |
   +--> remote renderer only for explicit heavy jobs
```

Every operation must be represented explicitly. The timeline is the source of truth; undo/redo operates on timeline checkpoints rather than opaque video files.

## Reference-video matching

A reference is represented as a **ReferenceEditGraph**, not as a copied video. The graph can contain:

- duration and aspect ratio
- cut timestamps
- shot lengths and pacing
- crop/reframe/scale
- text timing and placement
- transition/effect timing
- audio ducking and volume envelopes
- color adjustments
- beat markers when audio analysis is available

The first implementation can approximate a reference from available source media. Pixel-identical reproduction is only possible when the same assets, fonts, effects, codecs and source conditions are available; the product must expose a similarity score rather than claim universal pixel identity.

## Local media policy

Selecting a local file does **not** upload it. Browser previews should use `File`, `Blob`, object URLs and/or the File System Access API where available. Local rendering uses WebCodecs/Workers where supported and FFmpeg.wasm as a compatibility path.

If the user starts a remote render, bytes necessarily have to cross the network. There is no technically valid way to render on a remote machine without transferring the required media. The UX should therefore use resumable/chunked uploads, hashing, retry, pause/resume and local caching rather than pretending that remote rendering consumes no bandwidth.

## Remote rendering

The Cloudflare edge layer is intentionally thin. It should authenticate the user, enforce origin policy, attach a request ID and proxy only approved API calls to the user's configured renderer. FFmpeg and SQLite remain outside Cloudflare Workers.

The existing Render service `ai-creative-studio-renderer-stable` is the current renderer candidate. It runs the repository's Node API and FFmpeg on Render's free plan. Remote rendering must remain an opt-in capability because free compute is finite and not a contractual guarantee for long jobs.

## Security requirements

- Never expose provider API keys in browser JavaScript.
- Never serve project media from a public unauthenticated path in production.
- Use short-lived user/session credentials for API calls.
- Use a separate edge-to-renderer shared secret; rotate it without changing application code.
- Bind every project, asset, render job and history record to an authenticated user ID.
- Validate MIME type, container/codec and size before FFmpeg processing.
- Keep filenames generated server-side; never use user filenames as filesystem paths.
- Apply rate limits and render quotas per user/plan.
- Delete remote media and exports according to an explicit retention policy.
- Treat reference URLs as untrusted input; do not fetch arbitrary localhost/private-network URLs from the renderer.
- Do not expose stack traces, filesystem paths or provider errors to end users.
- Record usage/cost counters without storing raw media when not required.

## Product tiers

### Free browser tier

- local import
- local timeline editing
- local preview
- local export where the device/browser can handle it
- basic deterministic commands
- limited AI assistance using a user-supplied key or a server-side quota when available
- advertising may be used on non-sensitive UI areas

### Creator tier

- larger/longer jobs
- advanced reference analysis
- more AI operations
- no advertising
- higher export limits

### Remote/Pro tier

- remote FFmpeg rendering
- queued jobs
- high-resolution exports
- advanced analysis
- storage retention according to plan

### BYOC

Allow advanced users to connect their own compute. The application should never imply that a user's own Render account is invisible to that account owner: the owner of the compute environment can inspect the code and runtime of that environment.
