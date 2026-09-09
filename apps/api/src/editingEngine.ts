import { randomUUID } from 'node:crypto';
import { EDITING_OPERATION_CAPABILITIES, EDITING_OPERATION_NAMES, type RegisteredOperationName } from '../../../packages/shared/operation-registry.js';

export type EditingOperation = {
  op: RegisteredOperationName;
  [key: string]: any;
};

export type EditPlan = {
  version: 1;
  summary: string;
  operations: EditingOperation[];
};

export { EDITING_OPERATION_NAMES, EDITING_OPERATION_CAPABILITIES };

function getTracks(timeline: any) {
  if (!Array.isArray(timeline.tracks)) timeline.tracks = [];
  return timeline.tracks;
}

function getAllClips(timeline: any) {
  return getTracks(timeline).flatMap((track: any) => (Array.isArray(track.clips) ? track.clips : []).map((clip: any) => ({ track, clip })));
}

function findClip(timeline: any, clipId?: string) {
  const items = getAllClips(timeline);
  if (clipId) return items.find((item: { clip: any }) => item.clip.id === clipId);
  return items[0];
}

function ensureTrack(timeline: any, type: string, name?: string) {
  let track = getTracks(timeline).find((item: any) => item.type === type);
  if (!track) {
    track = { id: randomUUID(), name: name || `${type} 1`, type, clips: [], muted: false, locked: false, visible: true, height: type === 'audio' ? 80 : 60, order: getTracks(timeline).length };
    timeline.tracks.push(track);
  }
  return track;
}

function ensureTextTrack(timeline: any) { return ensureTrack(timeline, 'text', 'Text 1'); }

function normalize(timeline: any) {
  for (const track of getTracks(timeline)) {
    track.clips = Array.isArray(track.clips) ? track.clips : [];
    track.clips.sort((a: any, b: any) => Number(a.startTime || 0) - Number(b.startTime || 0));
  }
  const maxEnd = Math.max(0, ...getAllClips(timeline).map((item: { clip: any }) => Number(item.clip.endTime || 0)));
  timeline.duration = Math.max(Number(timeline.duration || 0), maxEnd);
  return timeline;
}

function addJob(timeline: any, type: string, parameters: Record<string, unknown>) {
  if (!Array.isArray(timeline.jobs)) timeline.jobs = [];
  const job = { id: randomUUID(), type, status: 'queued', createdAt: new Date().toISOString(), parameters };
  timeline.jobs.push(job);
  return job;
}

function clipDuration(clip: any) {
  return Math.max(0.01, Number(clip.duration || clip.endTime - clip.startTime || 0.01));
}

function shiftClipsAfter(timeline: any, start: number, delta: number, exceptId?: string) {
  for (const item of getAllClips(timeline)) {
    if (item.clip.id === exceptId) continue;
    if (Number(item.clip.startTime || 0) >= start) {
      item.clip.startTime = Math.max(0, Number(item.clip.startTime || 0) + delta);
      item.clip.endTime = Number(item.clip.startTime) + clipDuration(item.clip);
    }
  }
}

export function applyOperations(input: any, operations: EditingOperation[]) {
  const timeline = structuredClone(input || { version: 2, duration: 0, currentTime: 0, tracks: [], markers: [] });
  if (!Array.isArray(timeline.markers)) timeline.markers = [];
  if (!Array.isArray(timeline.jobs)) timeline.jobs = [];

  for (const operation of operations) {
    const args = operation.args && typeof operation.args === 'object' ? operation.args : operation;
    switch (operation.op) {
      case 'insert_clip': {
        const track = args.trackId ? getTracks(timeline).find((item: any) => item.id === args.trackId) : ensureTrack(timeline, 'video', 'Video 1');
        if (!track) break;
        const duration = Math.max(0.01, Number(args.duration || 0.01));
        const start = Math.max(0, Number(args.startTime ?? timeline.duration ?? 0));
        track.clips.push({ id: args.clipId || randomUUID(), assetId: args.assetId, name: args.name || 'clip', startTime: start, endTime: start + duration, trimStart: Number(args.trimStart || 0), trimEnd: Number(args.trimEnd ?? duration), duration, speed: 1, opacity: 1, effects: [], animations: [], keyframes: [] });
        break;
      }
      case 'replace_source':
      case 'relink_asset': {
        const found = findClip(timeline, args.clipId); if (found) found.clip.assetId = args.assetId; break;
      }
      case 'proxy_clip': {
        const found = findClip(timeline, args.clipId); if (found) found.clip.proxy = { enabled: args.enabled !== false, assetId: args.proxyAssetId }; break;
      }
      case 'freeze_frame':
      case 'hold_frame': {
        const found = findClip(timeline, args.clipId); if (!found) break;
        found.clip.freezeFrame = { time: Math.max(0, Number(args.time || 0)), duration: Math.max(0.01, Number(args.duration || 0.01)) }; break;
      }
      case 'split': {
        const found = findClip(timeline, args.clipId); if (!found) break;
        const t = Number(args.time); const clip = found.clip; if (!(t > clip.startTime && t < clip.endTime)) break;
        const ratio = (t - clip.startTime) / Math.max(0.0001, clip.endTime - clip.startTime);
        const first = structuredClone(clip); const second = structuredClone(clip);
        first.endTime = t; first.duration = t - first.startTime;
        second.id = randomUUID(); second.startTime = t; second.endTime = clip.endTime; second.duration = second.endTime - second.startTime;
        if (typeof clip.trimStart === 'number' && typeof clip.trimEnd === 'number') second.trimStart = clip.trimStart + (clip.trimEnd - clip.trimStart) * ratio;
        found.track.clips.splice(found.track.clips.indexOf(clip), 1, first, second); break;
      }
      case 'delete_clip': {
        const found = findClip(timeline, args.clipId); if (found) found.track.clips = found.track.clips.filter((c: any) => c.id !== found.clip.id); break;
      }
      case 'ripple_delete': {
        const found = findClip(timeline, args.clipId); if (!found) break;
        const removed = clipDuration(found.clip); const start = Number(found.clip.startTime || 0);
        found.track.clips = found.track.clips.filter((c: any) => c.id !== found.clip.id); shiftClipsAfter(timeline, start + removed, -removed); break;
      }
      case 'close_gap': {
        const start = Math.max(0, Number(args.startTime || 0)); const gap = Math.max(0, Number(args.duration || 0)); if (gap) shiftClipsAfter(timeline, start + gap, -gap); break;
      }
      case 'duplicate_clip': {
        const found = findClip(timeline, args.clipId); if (!found) break; const copy = structuredClone(found.clip); const offset = Number(args.offset ?? clipDuration(copy)); copy.id = randomUUID(); copy.startTime += offset; copy.endTime += offset; found.track.clips.push(copy); break;
      }
      case 'move_clip': {
        const found = findClip(timeline, args.clipId); if (!found) break; const start = Math.max(0, Number(args.startTime)); found.clip.startTime = start; found.clip.endTime = start + clipDuration(found.clip);
        if (args.trackId && args.trackId !== found.track.id) { const target = getTracks(timeline).find((item: any) => item.id === args.trackId); if (target) { found.track.clips = found.track.clips.filter((c: any) => c.id !== found.clip.id); target.clips.push(found.clip); } }
        break;
      }
      case 'trim_clip': {
        const found = findClip(timeline, args.clipId); if (!found) break; const clip = found.clip;
        if (typeof args.trimStart === 'number') { const next = Math.max(0, args.trimStart); const delta = next - Number(clip.trimStart || 0); clip.trimStart = next; clip.startTime = Math.max(0, Number(clip.startTime || 0) + delta); }
        if (typeof args.trimEnd === 'number') clip.trimEnd = Math.max(Number(clip.trimStart || 0) + 0.01, args.trimEnd);
        clip.duration = Math.max(0.01, Number(clip.trimEnd || clip.endTime) - Number(clip.trimStart || 0)); clip.endTime = Number(clip.startTime || 0) + clip.duration; break;
      }
      case 'slip_clip': { const found = findClip(timeline, args.clipId); if (found) found.clip.slip = Number(args.amount || 0); break; }
      case 'slide_clip': { const found = findClip(timeline, args.clipId); if (found) { const delta = Number(args.amount || 0); found.clip.startTime += delta; found.clip.endTime += delta; } break; }
      case 'extend_clip': { const found = findClip(timeline, args.clipId); if (found) { const delta = Number(args.duration || 0); found.clip.endTime = Math.max(found.clip.startTime + 0.01, found.clip.endTime + delta); found.clip.duration = Math.max(0.01, found.clip.endTime - found.clip.startTime); } break; }
      case 'set_speed': { const found = findClip(timeline, args.clipId); if (found) { const speed = Math.max(0.05, Math.min(16, Number(args.speed))); found.clip.speed = speed; const sourceDuration = Math.max(0.01, Number(found.clip.trimEnd || found.clip.endTime) - Number(found.clip.trimStart || 0)); found.clip.duration = sourceDuration / speed; found.clip.endTime = found.clip.startTime + found.clip.duration; } break; }
      case 'set_speed_ramp': { const found = findClip(timeline, args.clipId); if (found) found.clip.speedRamp = Array.isArray(args.points) ? args.points : []; break; }
      case 'set_time_remap': { const found = findClip(timeline, args.clipId); if (found) found.clip.timeRemap = Array.isArray(args.points) ? args.points : []; break; }
      case 'reverse_clip': { const found = findClip(timeline, args.clipId); if (found) found.clip.reverse = args.enabled !== false; break; }
      case 'loop_clip': { const found = findClip(timeline, args.clipId); if (found) found.clip.loop = Math.max(1, Number(args.count || 1)); break; }
      case 'set_volume': { const found = findClip(timeline, args.clipId); if (found) found.clip.volume = Math.max(0, Math.min(4, Number(args.volume))); break; }
      case 'mute_clip': { const found = findClip(timeline, args.clipId); if (found) found.clip.muted = Boolean(args.muted); break; }
      case 'set_pan': { const found = findClip(timeline, args.clipId); if (found) found.clip.pan = Math.max(-1, Math.min(1, Number(args.pan || 0))); break; }
      case 'audio_fade': { const found = findClip(timeline, args.clipId); if (found) found.clip.audioFade = { in: Math.max(0, Number(args.in || 0)), out: Math.max(0, Number(args.out || 0)) }; break; }
      case 'normalize_audio': { const found = findClip(timeline, args.clipId); if (found) found.clip.normalizeAudio = args.enabled !== false; break; }
      case 'audio_effect': { const found = findClip(timeline, args.clipId); if (found) { found.clip.audioEffects = Array.isArray(found.clip.audioEffects) ? found.clip.audioEffects : []; found.clip.audioEffects.push({ id: randomUUID(), name: args.effect, params: args.params || {} }); } break; }
      case 'duck_audio': { const found = findClip(timeline, args.clipId); if (found) found.clip.ducking = { amount: Number(args.amount || 0), threshold: Number(args.threshold || 0) }; break; }
      case 'set_audio_speed': { const found = findClip(timeline, args.clipId); if (found) found.clip.audioSpeed = Math.max(0.25, Math.min(4, Number(args.speed || 1))); break; }
      case 'replace_audio': { const found = findClip(timeline, args.clipId); if (found) found.clip.audioAssetId = args.assetId; break; }
      case 'remove_audio': { const found = findClip(timeline, args.clipId); if (found) found.clip.audioRemoved = true; break; }
      case 'set_opacity': { const found = findClip(timeline, args.clipId); if (found) found.clip.opacity = Math.max(0, Math.min(1, Number(args.opacity))); break; }
      case 'transform': { const found = findClip(timeline, args.clipId); if (found) found.clip.transform = { ...(found.clip.transform || {}), x: args.x, y: args.y, scaleX: args.scaleX, scaleY: args.scaleY, rotation: args.rotation, anchorX: args.anchorX, anchorY: args.anchorY }; break; }
      case 'crop': { const found = findClip(timeline, args.clipId); if (found) found.clip.crop = { left: args.left ?? 0, top: args.top ?? 0, right: args.right ?? 1, bottom: args.bottom ?? 1 }; break; }
      case 'fit_clip':
      case 'fill_clip': { const found = findClip(timeline, args.clipId); if (found) found.clip.contentFit = operation.op === 'fit_clip' ? 'fit' : 'fill'; break; }
      case 'mirror_clip': { const found = findClip(timeline, args.clipId); if (found) found.clip.mirror = { horizontal: Boolean(args.horizontal), vertical: Boolean(args.vertical) }; break; }
      case 'set_anchor': { const found = findClip(timeline, args.clipId); if (found) found.clip.anchor = { x: Number(args.x ?? 0.5), y: Number(args.y ?? 0.5) }; break; }
      case 'set_perspective': { const found = findClip(timeline, args.clipId); if (found) found.clip.perspective = args.points || {}; break; }
      case 'set_blend_mode': { const found = findClip(timeline, args.clipId); if (found) found.clip.blendMode = args.mode; break; }
      case 'set_mask':
      case 'set_chroma_key':
      case 'set_luma_key':
      case 'set_matte': { const found = findClip(timeline, args.clipId); if (found) found.clip[operation.op] = { enabled: args.enabled !== false, ...args }; break; }
      case 'group_clips': { timeline.groups = Array.isArray(timeline.groups) ? timeline.groups : []; timeline.groups.push({ id: randomUUID(), clipIds: Array.isArray(args.clipIds) ? args.clipIds : [], name: args.name }); break; }
      case 'ungroup_clips': { timeline.groups = (timeline.groups || []).filter((group: any) => group.id !== args.groupId); break; }
      case 'nest_sequence': { timeline.sequences = Array.isArray(timeline.sequences) ? timeline.sequences : []; timeline.sequences.push({ id: randomUUID(), clipIds: args.clipIds || [], name: args.name || 'Sequence' }); break; }
      case 'set_color_adjustments':
      case 'set_hsl':
      case 'set_curves':
      case 'set_levels':
      case 'add_lut':
      case 'set_sharpen':
      case 'set_denoise':
      case 'set_vignette':
      case 'set_grain': { const found = findClip(timeline, args.clipId); if (found) found.clip.color = { ...(found.clip.color || {}), [operation.op]: { ...args } }; break; }
      case 'add_text': { const track = args.trackId ? getTracks(timeline).find((item: any) => item.id === args.trackId) : ensureTextTrack(timeline); if (!track) break; const start = Math.max(0, Number(args.startTime)); const duration = Math.max(0.01, Number(args.duration)); track.clips.push({ id: randomUUID(), type: 'text', name: args.text, text: args.text, startTime: start, endTime: start + duration, duration, style: args.style || {} }); break; }
      case 'update_text':
      case 'update_caption': { const found = findClip(timeline, args.clipId); if (!found) break; if (typeof args.text === 'string') { found.clip.text = args.text; found.clip.name = args.text; } if (args.style) found.clip.style = { ...(found.clip.style || {}), ...args.style }; break; }
      case 'delete_text':
      case 'delete_caption': { const found = findClip(timeline, args.clipId); if (found) found.track.clips = found.track.clips.filter((c: any) => c.id !== found.clip.id); break; }
      case 'add_caption': { const track = ensureTextTrack(timeline); const start = Math.max(0, Number(args.startTime || 0)); const duration = Math.max(0.01, Number(args.duration || 1)); track.clips.push({ id: randomUUID(), type: 'caption', name: args.text || '', text: args.text || '', startTime: start, endTime: start + duration, duration, style: args.style || {}, caption: true }); break; }
      case 'import_captions': { timeline.captions = { source: args.source, format: args.format, imported: true }; break; }
      case 'export_captions': { addJob(timeline, 'export_captions', { format: args.format || 'srt' }); break; }
      case 'add_marker': { timeline.markers.push({ id: randomUUID(), time: Math.max(0, Number(args.time)), label: args.label || '', color: args.color }); break; }
      case 'remove_marker': { timeline.markers = timeline.markers.filter((marker: any) => marker.id !== args.markerId); break; }
      case 'clear_markers': { timeline.markers = []; break; }
      case 'add_effect': { const found = findClip(timeline, args.clipId); if (found) { found.clip.effects = Array.isArray(found.clip.effects) ? found.clip.effects : []; found.clip.effects.push({ id: randomUUID(), name: args.effect, params: args.params || {} }); } break; }
      case 'remove_effect': { const found = findClip(timeline, args.clipId); if (found) found.clip.effects = (found.clip.effects || []).filter((effect: any) => effect.name !== args.effect && effect.id !== args.effectId); break; }
      case 'update_effect': { const found = findClip(timeline, args.clipId); if (found) { const effect = (found.clip.effects || []).find((item: any) => item.id === args.effectId || item.name === args.effect); if (effect) effect.params = { ...(effect.params || {}), ...(args.params || {}) }; } break; }
      case 'set_effect_stack': { const found = findClip(timeline, args.clipId); if (found) found.clip.effects = Array.isArray(args.effects) ? args.effects : []; break; }
      case 'set_keyframe': { const found = findClip(timeline, args.clipId); if (!found) break; found.clip.keyframes = Array.isArray(found.clip.keyframes) ? found.clip.keyframes : []; found.clip.keyframes.push({ id: randomUUID(), property: args.property, time: Math.max(0, Number(args.time)), value: args.value }); found.clip.keyframes.sort((a: any, b: any) => a.time - b.time); break; }
      case 'add_transition': { const from = findClip(timeline, args.fromClipId); const to = findClip(timeline, args.toClipId); const target = from?.clip || to?.clip; if (target) target.transition = { type: args.type || args.transitionType || 'cut', duration: Math.max(0, Number(args.duration || 0)), fromClipId: args.fromClipId, toClipId: args.toClipId }; break; }
      case 'remove_transition': { const found = findClip(timeline, args.clipId || args.fromClipId); if (found) delete found.clip.transition; break; }
      case 'add_track': { const type = args.type || 'video'; getTracks(timeline).push({ id: args.trackId || randomUUID(), name: args.name || `${type} ${getTracks(timeline).length + 1}`, type, clips: [], muted: false, locked: false, visible: true, height: type === 'audio' ? 80 : 60, order: getTracks(timeline).length }); break; }
      case 'delete_track': { timeline.tracks = getTracks(timeline).filter((track: any) => track.id !== args.trackId); break; }
      case 'duplicate_track': { const source = getTracks(timeline).find((track: any) => track.id === args.trackId); if (source) { const copy = structuredClone(source); copy.id = randomUUID(); copy.name = args.name || `${source.name} copy`; copy.order = getTracks(timeline).length; copy.clips = copy.clips.map((clip: any) => ({ ...clip, id: randomUUID() })); timeline.tracks.push(copy); } break; }
      case 'reorder_track': { const track = getTracks(timeline).find((item: any) => item.id === args.trackId); if (track) track.order = Number(args.order); break; }
      case 'rename_track': { const track = getTracks(timeline).find((item: any) => item.id === args.trackId); if (track) track.name = args.name; break; }
      case 'set_track_state': { const track = getTracks(timeline).find((item: any) => item.id === args.trackId); if (track) { if (typeof args.muted === 'boolean') track.muted = args.muted; if (typeof args.locked === 'boolean') track.locked = args.locked; if (typeof args.visible === 'boolean') track.visible = args.visible; if (typeof args.solo === 'boolean') track.solo = args.solo; } break; }
      case 'set_track_type': { const track = getTracks(timeline).find((item: any) => item.id === args.trackId); if (track) track.type = args.type; break; }
      case 'set_timeline': { if (typeof args.duration === 'number') timeline.duration = Math.max(0, args.duration); if (typeof args.fps === 'number') timeline.fps = Math.max(1, Math.min(240, args.fps)); if (typeof args.width === 'number') timeline.width = Math.max(16, args.width); if (typeof args.height === 'number') timeline.height = Math.max(16, args.height); if (typeof args.aspectRatio === 'string') timeline.aspectRatio = args.aspectRatio; if (typeof args.background === 'string') timeline.background = args.background; break; }
      case 'set_selection': { timeline.selection = { clipIds: args.clipIds || [], startTime: args.startTime, endTime: args.endTime }; break; }
      case 'clear_selection': { timeline.selection = null; break; }
      case 'detect_scenes':
      case 'detect_silence':
      case 'detect_beats':
      case 'transcribe':
      case 'auto_caption':
      case 'track_subject':
      case 'smart_reframe':
      case 'extract_highlights':
      case 'auto_cut':
      case 'render_preview':
      case 'render_export':
      case 'extract_frame':
      case 'generate_thumbnail': { addJob(timeline, operation.op, { ...args }); break; }
      case 'noop': break;
    }
  }

  return normalize(timeline);
}
