# Anime Animation Studio

## Purpose

This workspace adds a practical first animation vertical slice to AI Creative Studio: prompt-to-storyboard planning, a PixiJS canvas preview, character transform keyframes, timeline scrubbing, basic skeleton JSON import/export, local project persistence, and browser WebM capture. It is a foundation to iterate on, not a claim that a web editor already matches Moho or OpenToonz feature-for-feature.

## Implemented in this branch

- PixiJS preview scene with a built-in vector mascot and import of a PNG/SVG character image.
- Editable time-based keyframes for position, scale, rotation, opacity, and expression.
- Storyboard cards and timing.
- AI plan API at POST /api/animation/plan. With OPENAI_API_KEY on the API server it calls the OpenAI Responses API; otherwise a local fallback makes a starter plan so the UI remains testable.
- Browser WebM recording from the actual PixiJS canvas, plus project JSON export.
- Basic Spine JSON and DragonBones JSON hierarchy import/export via the neutral rig schema.
- Validation of missing parents, duplicate bone IDs, invalid slots, and hierarchy cycles.
- API tests for local plan generation, required prompt validation, and bearer-token enforcement.

## Set up

Use Node.js 22 and FFmpeg as described by the main README. Install the repository workspaces and start the API/web processes with the existing root scripts.

On the server, set OPENAI_API_KEY to enable AI planning. Set ANIMATION_API_TOKEN to a long random secret before enabling paid AI generation in production. Never expose either secret in Vite variables or commit them into Git. The web editor accepts the animation bearer token for the current browser session only. The local fallback works without a provider key.

The endpoint limits prompts to 4000 characters and generated plans to a maximum of 30 seconds. API deployments should also use host-level rate limits and HTTPS before enabling public access.

## ChatGPT connection path

This branch prepares two ways to connect an AI client:
1. The web editor uses the API route directly, where the server owns OPENAI_API_KEY.
2. A Custom GPT Action can call the public API using the OpenAPI schema at docs/chatgpt-animation-openapi.yaml. Replace YOUR-API-HOST with the HTTPS origin of the deployed API, then configure HTTP Bearer authentication with the value stored as ANIMATION_API_TOKEN.

The current ChatGPT conversation is not automatically linked to a deployed API simply by committing code to GitHub. A deployed HTTPS API and explicit ChatGPT Action/MCP configuration are required for direct external calls. Do not publish ANIMATION_API_TOKEN or OPENAI_API_KEY in a browser bundle.

## Interchange and scope

- Spine / DragonBones: the adapter imports/exports basic bone hierarchy, slot names, parent relations, transforms, and placeholder attachment references. It does not preserve all weights, mesh deformation, constraints, skins, attachments, atlas data, or proprietary animation curves. Validate exported files in the originating application.
- PixiJS: used as the web preview/runtime layer; its ticker drives the visible canvas.
- Remotion: not bundled as an automatic cloud renderer in this feature slice. Its current licensing differentiates individual/small-team video creation from automated video products and may charge per render, so review the official terms before commercial integration: https://www.remotion.dev/docs/license/pricing
- Moho: a separate commercial desktop tool, not embedded in this browser app. Use image assets and interchange files as a handoff rather than claiming native Moho project compatibility.
- OpenToonz / Tahoma2D: separate desktop applications. The supported handoff in this slice is a neutral project manifest and image/audio assets, not full native-project round-tripping. Check third-party library licenses for either desktop project.
- Spine runtime: no Spine runtime package or proprietary editor code is redistributed by this repository. Integrating Spine runtimes into a product requires following the relevant editor/runtime license: https://esotericsoftware.com/spine-editor-license

## Official references

- PixiJS ticker: https://pixijs.com/8.x/guides/components/ticker
- PixiJS AnimatedSprite: https://pixijs.download/v8.21.0/docs/scene.AnimatedSprite.html
- Remotion license / pricing: https://www.remotion.dev/docs/license/pricing
- Spine editor and runtime license: https://esotericsoftware.com/spine-editor-license
- OpenToonz repository and license notes: https://github.com/opentoonz/opentoonz
- Tahoma2D repository and license notes: https://github.com/tahoma2d/tahoma2d
