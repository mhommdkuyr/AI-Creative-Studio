import { randomUUID } from 'node:crypto';

export type EditingOperation =
  | { op: 'split'; clipId?: string; time: number }
  | { op: 'delete_clip'; clipId?: string }
  | { op: 'duplicate_clip'; clipId?: string; offset?: number }
  | { op: 'move_clip'; clipId?: string; startTime: number; trackId?: string }
  | { op: 'trim_clip'; clipId?: string; trimStart?: number; trimEnd?: number }
  | { op: 'set_speed'; clipId?: string; speed: number }
  | { op: 'set_volume'; clipId?: string; volume: number }
  | { op: 'mute_clip'; clipId?: string; muted: boolean }
  | { op: 'set_opacity'; clipId?: string; opacity: number }
  | { op: 'transform'; clipId?: string; x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number; anchorX?: number; anchorY?: number }
  | { op: 'crop'; clipId?: string; left?: number; top?: number; right?: number; bottom?: number }
  | { op: 'set_blend_mode'; clipId?: string; mode: string }
  | { op: 'add_text'; trackId?: string; text: string; startTime: number; duration: number; style?: Record<string, unknown> }
  | { op: 'update_text'; clipId?: string; text?: string; style?: Record<string, unknown> }
  | { op: 'add_marker'; time: number; label?: string; color?: string }
  | { op: 'add_effect'; clipId?: string; effect: string; params?: Record<string, unknown> }
  | { op: 'remove_effect'; clipId?: string; effect: string }
  | { op: 'set_keyframe'; clipId?: string; property: string; time: number; value: unknown }
  | { op: 'add_transition'; fromClipId?: string; toClipId?: string; type: string; duration: number }
  | { op: 'set_timeline'; duration?: number; fps?: number; width?: number; height?: number; aspectRatio?: string }
  | { op: 'reorder_track'; trackId?: string; order: number }
  | { op: 'rename_track'; trackId?: string; name: string }
  | { op: 'set_track_state'; trackId?: string; muted?: boolean; locked?: boolean; visible?: boolean }
  | { op: 'noop'; reason?: string };

export type EditPlan = {
  version: 1;
  summary: string;
  operations: EditingOperation[];
};

export const EDITING_OPERATION_NAMES = [
  'split','delete_clip','duplicate_clip','move_clip','trim_clip','set_speed','set_volume','mute_clip',
  'set_opacity','transform','crop','set_blend_mode','add_text','update_text','add_marker','add_effect',
  'remove_effect','set_keyframe','add_transition','set_timeline','reorder_track','rename_track','set_track_state','noop',
] as const;

function getTracks(timeline: any) {
  if (!Array.isArray(timeline.tracks)) timeline.tracks = [];
  return timeline.tracks;
}

function getAllClips(timeline: any) {
  return getTracks(timeline).flatMap((track: any) => (track.clips || []).map((clip: any) => ({ track, clip })));
}

function findClip(timeline: any, clipId?: string) {
  const items = getAllClips(timeline);
  if (clipId) return items.find(({ clip }) => clip.id === clipId);
  return items[0];
}

function ensureTextTrack(timeline: any) {
  let track = getTracks(timeline).find((t: any) => t.type === 'text');
  if (!track) {
    track = { id: randomUUID(), name: 'Text 1', type: 'text', clips: [], muted: false, locked: false, visible: true, height: 60, order: getTracks(timeline).length };
    timeline.tracks.push(track);
  }
  return track;
}

function normalize(timeline: any) {
  for (const track of getTracks(timeline)) {
    track.clips = Array.isArray(track.clips) ? track.clips : [];
    track.clips.sort((a: any, b: any) => Number(a.startTime || 0) - Number(b.startTime || 0));
  }
  const maxEnd = Math.max(0, ...getAllClips(timeline).map(({ clip }) => Number(clip.endTime || 0)));
  timeline.duration = Math.max(Number(timeline.duration || 0), maxEnd);
  return timeline;
}

export function applyOperations(input: any, operations: EditingOperation[]) {
  const timeline = structuredClone(input || { version: 2, duration: 0, currentTime: 0, tracks: [], markers: [] });
  if (!Array.isArray(timeline.markers)) timeline.markers = [];

  for (const operation of operations) {
    switch (operation.op) {
      case 'split': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        const { track, clip } = found;
        const t = Number(operation.time);
        if (!(t > clip.startTime && t < clip.endTime)) break;
        const ratio = (t - clip.startTime) / Math.max(0.0001, clip.endTime - clip.startTime);
        const first = structuredClone(clip);
        const second = structuredClone(clip);
        first.endTime = t;
        first.duration = t - first.startTime;
        second.id = randomUUID();
        second.startTime = t;
        second.endTime = clip.endTime;
        second.duration = second.endTime - second.startTime;
        if (typeof clip.trimStart === 'number' && typeof clip.trimEnd === 'number') {
          second.trimStart = clip.trimStart + (clip.trimEnd - clip.trimStart) * ratio;
        }
        track.clips.splice(track.clips.indexOf(clip), 1, first, second);
        break;
      }
      case 'delete_clip': {
        const found = findClip(timeline, operation.clipId);
        if (found) found.track.clips = found.track.clips.filter((c: any) => c.id !== found.clip.id);
        break;
      }
      case 'duplicate_clip': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        const copy = structuredClone(found.clip);
        const offset = Number(operation.offset || copy.duration || 0);
        copy.id = randomUUID();
        copy.startTime += offset;
        copy.endTime += offset;
        found.track.clips.push(copy);
        break;
      }
      case 'move_clip': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        const start = Math.max(0, Number(operation.startTime));
        found.clip.startTime = start;
        found.clip.endTime = start + Math.max(0.01, Number(found.clip.duration || 0));
        if (operation.trackId && operation.trackId !== found.track.id) {
          const targetTrack = getTracks(timeline).find((t: any) => t.id === operation.trackId);
          if (targetTrack) {
            found.track.clips = found.track.clips.filter((c: any) => c.id !== found.clip.id);
            targetTrack.clips.push(found.clip);
          }
        }
        break;
      }
      case 'trim_clip': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        const clip = found.clip;
        if (typeof operation.trimStart === 'number') {
          const next = Math.max(0, operation.trimStart);
          const delta = next - Number(clip.trimStart || 0);
          clip.trimStart = next;
          clip.startTime = Math.max(0, Number(clip.startTime || 0) + delta);
        }
        if (typeof operation.trimEnd === 'number') clip.trimEnd = Math.max(Number(clip.trimStart || 0) + 0.01, operation.trimEnd);
        clip.duration = Math.max(0.01, Number(clip.trimEnd || clip.endTime) - Number(clip.trimStart || 0));
        clip.endTime = Number(clip.startTime || 0) + clip.duration;
        break;
      }
      case 'set_speed': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        const speed = Math.max(0.05, Math.min(16, Number(operation.speed)));
        found.clip.speed = speed;
        const sourceDuration = Math.max(0.01, Number(found.clip.trimEnd || found.clip.endTime) - Number(found.clip.trimStart || 0));
        found.clip.duration = sourceDuration / speed;
        found.clip.endTime = found.clip.startTime + found.clip.duration;
        break;
      }
      case 'set_volume': {
        const found = findClip(timeline, operation.clipId);
        if (found) found.clip.volume = Math.max(0, Math.min(4, Number(operation.volume)));
        break;
      }
      case 'mute_clip': {
        const found = findClip(timeline, operation.clipId);
        if (found) found.clip.muted = Boolean(operation.muted);
        break;
      }
      case 'set_opacity': {
        const found = findClip(timeline, operation.clipId);
        if (found) found.clip.opacity = Math.max(0, Math.min(1, Number(operation.opacity)));
        break;
      }
      case 'transform': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        found.clip.transform = { ...(found.clip.transform || {}), ...operation };
        delete found.clip.transform.op;
        delete found.clip.transform.clipId;
        break;
      }
      case 'crop': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        found.clip.crop = { ...(found.clip.crop || {}), left: operation.left ?? 0, top: operation.top ?? 0, right: operation.right ?? 1, bottom: operation.bottom ?? 1 };
        break;
      }
      case 'set_blend_mode': {
        const found = findClip(timeline, operation.clipId);
        if (found) found.clip.blendMode = operation.mode;
        break;
      }
      case 'add_text': {
        const track = operation.trackId ? getTracks(timeline).find((t: any) => t.id === operation.trackId) : ensureTextTrack(timeline);
        if (!track) break;
        const start = Math.max(0, Number(operation.startTime));
        const duration = Math.max(0.01, Number(operation.duration));
        track.clips.push({ id: randomUUID(), type: 'text', name: operation.text, text: operation.text, startTime: start, endTime: start + duration, duration, style: operation.style || {} });
        break;
      }
      case 'update_text': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        if (typeof operation.text === 'string') { found.clip.text = operation.text; found.clip.name = operation.text; }
        if (operation.style) found.clip.style = { ...(found.clip.style || {}), ...operation.style };
        break;
      }
      case 'add_marker': {
        timeline.markers.push({ id: randomUUID(), time: Math.max(0, Number(operation.time)), label: operation.label || '', color: operation.color });
        break;
      }
      case 'add_effect': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        found.clip.effects = Array.isArray(found.clip.effects) ? found.clip.effects : [];
        found.clip.effects.push({ id: randomUUID(), name: operation.effect, params: operation.params || {} });
        break;
      }
      case 'remove_effect': {
        const found = findClip(timeline, operation.clipId);
        if (found) found.clip.effects = (found.clip.effects || []).filter((effect: any) => effect.name !== operation.effect);
        break;
      }
      case 'set_keyframe': {
        const found = findClip(timeline, operation.clipId);
        if (!found) break;
        found.clip.keyframes = Array.isArray(found.clip.keyframes) ? found.clip.keyframes : [];
        found.clip.keyframes.push({ id: randomUUID(), property: operation.property, time: Math.max(0, Number(operation.time)), value: operation.value });
        found.clip.keyframes.sort((a: any, b: any) => a.time - b.time);
        break;
      }
      case 'add_transition': {
        const from = findClip(timeline, operation.fromClipId);
        const to = findClip(timeline, operation.toClipId);
        const target = from?.clip || to?.clip;
        if (target) target.transition = { type: operation.type, duration: Math.max(0, Number(operation.duration)), fromClipId: operation.fromClipId, toClipId: operation.toClipId };
        break;
      }
      case 'set_timeline': {
        if (typeof operation.duration === 'number') timeline.duration = Math.max(0, operation.duration);
        if (typeof operation.fps === 'number') timeline.fps = Math.max(1, Math.min(240, operation.fps));
        if (typeof operation.width === 'number') timeline.width = Math.max(16, operation.width);
        if (typeof operation.height === 'number') timeline.height = Math.max(16, operation.height);
        if (typeof operation.aspectRatio === 'string') timeline.aspectRatio = operation.aspectRatio;
        break;
      }
      case 'reorder_track': {
        const track = getTracks(timeline).find((t: any) => t.id === operation.trackId);
        if (track) track.order = operation.order;
        break;
      }
      case 'rename_track': {
        const track = getTracks(timeline).find((t: any) => t.id === operation.trackId);
        if (track) track.name = operation.name;
        break;
      }
      case 'set_track_state': {
        const track = getTracks(timeline).find((t: any) => t.id === operation.trackId);
        if (!track) break;
        if (typeof operation.muted === 'boolean') track.muted = operation.muted;
        if (typeof operation.locked === 'boolean') track.locked = operation.locked;
        if (typeof operation.visible === 'boolean') track.visible = operation.visible;
        break;
      }
      case 'noop':
        break;
    }
  }

  return normalize(timeline);
}
