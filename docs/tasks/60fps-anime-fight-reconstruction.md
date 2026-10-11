# 60 FPS 2D Anime Fight Reconstruction — Jules Task Brief

## Goal
Produce a high-quality original-character 2D anime fight sequence based on the user's reference video:
https://youtu.be/Wa-_lVBLiwQ

The user reports that the source video is in their Google Drive folder named **فيديوهات**. Match the reference's shot timing, camera motion, fast combat rhythm, supernatural energy effects, scene composition, sound design, and edit pacing as closely as practical, while using the user's own character assets and avoiding unlicensed reuse of original drawings or audio.

## Repository facts
- Work from the existing `anime-animation-studio` feature foundation.
- Current work branch: `jules/60fps-anime-fight-reconstruction`.
- Existing editor foundation: PixiJS preview, keyframes, storyboard, skeleton JSON interchange, browser capture.
- Existing Drive import: `apps/api/src/googleDriveImport.ts`; documentation: `docs/google-drive-import.md`.
- Existing API and tests: `apps/api/src/animationRoute.ts`, `apps/api/src/animationRoute.test.ts`.
- Do not rewrite unrelated code. Audit first and preserve current behavior.

## Execution plan
1. Inspect the repository, current feature branch, rendering pipeline, test commands, and available character assets before modifying code.
2. Verify access to the actual Google Drive video and character assets. Do not guess a Drive file ID or pretend access succeeded. Use the existing authorized Drive import route. If a file ID or temporary download URL is unavailable, report the exact missing input and continue only with independent tasks.
3. Probe the real source with FFprobe. Record duration, dimensions, codec, frame rate, audio streams, and any variable-frame-rate behavior.
4. Analyze in short chunks: shot boundaries; character positions and key poses; fast attack/dodge/impact timing; camera pan/zoom/shake; speed lines; supernatural energy/aura/projectile effects; backgrounds; transitions; audio cues.
5. Store analysis in a versioned, validated JSON manifest. Include timestamps, character IDs, camera transforms, effect events, audio cue times, confidence values, and explicit missing/uncertain observations.
6. Reconstruct with the user's original character assets. Keep character identity consistent across frames. Create layered backgrounds, editable keyframes, fast combat timing, impact frames, supernatural effects, camera motion, compositing, and sound/edit timeline.
7. Target 1920x1080 at 60 fps if compute allows. Ensure the renderer produces actual 60 fps timing; do not merely label a lower-frame-rate file as 60 fps or silently duplicate frames. Document any quality/resolution trade-off.
8. First render a 5–10 second proof of concept. Generate a contact sheet and inspect it visually. Verify the output by decoding the MP4 and checking FFprobe metadata, frame count, duration, audio stream and sync.
9. Only after the sample passes, render the full sequence in resumable chunks. Keep intermediate files outside Git; publish renders as workflow artifacts or documented output assets.
10. Add automated tests for manifest validation, frame timing, render output validation, and failure handling. Run existing regression/build tests and report their actual results.

## Acceptance criteria
- Source and character assets are actually accessible and identified, or blockers are precisely documented.
- A real source analysis manifest exists; no fabricated measurements.
- Camera movement and combat beats are represented as editable time-based data.
- The proof-of-concept contains original characters, dynamic camera movement, supernatural effects, backgrounds/compositing, and timed audio/editing.
- Render is decoded and verified as 60 fps; report resolution, codec, duration, frame count, and audio status.
- Build/tests pass with logs or CI links, and a visual preview/contact sheet is available.
- Final deliverables include source code, tests, editable project data, analysis manifest, preview, full MP4 artifact, and a verification report.
- Do not claim completion until the actual artifacts exist and have been checked.

## Important constraints
- Do not commit large rendered videos or user-private source assets into the Git repository.
- Do not expose access tokens, OAuth credentials, or temporary signed URLs in logs, commits, or client-side code.
- If direct Jules execution is not available from the current integration, keep this task brief in the repository and provide the user the branch link so they can launch Jules against it.