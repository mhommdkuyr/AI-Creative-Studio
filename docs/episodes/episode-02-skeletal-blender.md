# Episode 01 Skeletal Fight Upgrade — Blender Automation

This upgrade adds an authored multi-character cutout fight timeline and a Blender 4.2+ scene builder to the downloadable episode package.

## Full source package
The complete package includes `scripts/blender_episode2_rig.py`, `scripts/build_episode2_skeletal.py`, `scripts/prepare_rig_parts.py`, per-character PNG cutouts, rig JSON files, 600 joint-angle samples for each of 3 characters, and the rendered MP4. The full executable script is in the package's `scripts/` directory; this repository document tracks scope and motion-source/licensing notes.

## Fight rig
- Three character tracks: girl, dark-haired fighter, yellow-haired fighter.
- 15 articulated cutout bones/joints per character; 600 pose samples per character at 24 fps.
- 18 timed attack events and 6 shot sections, including punches, hooks, body strikes, round kicks, aerial kicks/counters, energy attacks, hit reactions, and recovery.
- Camera push-ins, lateral tracking, and impact shakes.
- Impact frame requirement: contact at zero-based output frame 192, exactly frames 193–195 black/white, and color returns at frame 196. Blender's one-based frames are 193 contact, 194–196 impact, 197 return.
- Video master: 960x540, H.264, 24 fps, 600 frames, 25 seconds; stereo AAC audio with custom instrumental/SFX.
- Current rig is a rigid 2D cutout skeleton. It does not claim continuous mesh skin deformation or professional hand-drawn inbetweens.

## Run Blender
Extract the full episode project package, preserve its folder structure, install Blender 4.2+, and run from the extracted `episode-02-project` root:

```bash
blender --background --python scripts/blender_episode2_rig.py
```

To render all frames (CPU/GPU time required):

```bash
blender --background --python scripts/blender_episode2_rig.py -- --render
```

Optional reference-motion inputs supported by the package script:
- `--mixamo /path/to/animation.fbx`
- `--bvh /path/to/motion.bvh`
- `--mmd-model /path/to/model.pmx --mmd-vmd /path/to/motion.vmd` (requires MMD Tools add-on)

External motions import into a review collection and are not automatically retargeted onto the 2D cutout rig. No third-party motion clip was bundled; the included episode uses its original keyed fight movement.

## Motion-library references
- Adobe Mixamo FAQ and usage: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
- MMD Tools official add-on and license: https://extensions.blender.org/add-ons/mmd-tools/
- MMD Tools source: https://github.com/MMD-Blender/blender_mmd_tools
- Rokoko Motion Library: https://www.rokoko.com/products/motion-library

Follow the specific license for each downloaded motion and avoid redistributing raw motion files without permission.

## Testing caveat
The final MP4 and timeline were checked locally, including frame-level impact checks. The Blender script passed Python syntax compilation, but Blender itself was not installed in the build environment, so no Blender runtime execution or native `.blend` file is claimed here.
