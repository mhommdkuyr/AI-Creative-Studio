import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { registerAIRoute } from './aiRoute.js';
import { registerPublicAPIRoute } from './publicApiRoute.js';
import { downloadGoogleDriveMedia, GoogleDriveImportError } from './googleDriveImport.js';

const ROOT = resolve(process.cwd(), '../..');
const DATA = join(ROOT, 'data');
export const MEDIA = join(DATA, 'media');
type RenderJob = {
  status: 'queued' | 'running' | 'completed' | 'failed';
  projectId?: string;
  output?: string;
  error?: string;
  width?: number;
  height?: number;
  preset?: string;
  createdAt: string;
  finishedAt?: string;
};
const renderJobs = new Map<string, RenderJob>();
const EXPORTS = join(DATA, 'exports');
mkdirSync(MEDIA, { recursive: true });
mkdirSync(EXPORTS, { recursive: true });

export const db = new Database(join(DATA, 'creative-studio.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS projects(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timeline_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  history_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

export const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(MEDIA));

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase() || '.bin'}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

const now = () => new Date().toISOString();
const timelineTemplate = () => ({
  version: 2,
  duration: 0,
  currentTime: 0,
  tracks: [
    { id: randomUUID(), name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, visible: true, height: 60, order: 0 },
    { id: randomUUID(), name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, visible: true, height: 80, order: 1 },
    { id: randomUUID(), name: 'Text 1', type: 'text', clips: [], muted: false, locked: false, visible: true, height: 60, order: 2 },
  ],
  markers: [],
});

function readDuration(path: string) {
  try {
    return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8', timeout: 30000 }).trim()) || 0;
  } catch {
    return 0;
  }
}

function hasAudio(path: string) {
  try {
    return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8', timeout: 30000 }).trim() === 'audio';
  } catch {
    return false;
  }
}

function getProject(id: string) {
  return db.prepare('SELECT * FROM projects WHERE id=?').get(id) as any;
}

function getAssets(id: string) {
  return db.prepare('SELECT * FROM assets WHERE project_id=? ORDER BY created_at').all(id) as any[];
}

function payload(id: string) {
  const p = getProject(id);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updated_at,
    createdAt: p.created_at,
    timeline: JSON.parse(p.timeline_json),
    historyIndex: p.history_index,
    historyLength: JSON.parse(p.history_json).length,
    assets: getAssets(id).map(a => ({ ...a, url: `/media/${basename(a.path)}` })),
  };
}

function saveTimeline(id: string, timeline: any) {
  const p = getProject(id);
  if (!p) throw new Error('Project not found');
  const history = JSON.parse(p.history_json) as any[];
  const trimmed = history.slice(0, Number(p.history_index) + 1);
  trimmed.push(timeline);
  const bounded = trimmed.slice(-100);
  db.prepare('UPDATE projects SET timeline_json=?,history_json=?,history_index=?,updated_at=? WHERE id=?')
    .run(JSON.stringify(timeline), JSON.stringify(bounded), bounded.length - 1, now(), id);
}

function videoTrack(timeline: any) {
  let track = timeline.tracks.find((t: any) => t.type === 'video');
  if (!track) {
    track = { id: randomUUID(), name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, visible: true, height: 60, order: 0 };
    timeline.tracks.unshift(track);
  }
  return track;
}


function buildShortFormTimeline(timeline: any) {
  const out = structuredClone(timeline);
  const track = videoTrack(out);
  const sources = [...track.clips].filter((clip: any) => Number(clip.trimEnd ?? clip.duration ?? 0) > Number(clip.trimStart ?? 0));
  if (!sources.length) return null;
  const generated: any[] = [];
  const speeds = [1.08, 0.96, 1.16, 1.0, 1.10, 1.02];
  const zooms = [1.00, 1.05, 1.09, 1.03];
  let cursor = 0;
  let index = 0;
  for (const source of sources) {
    let sourceCursor = Number(source.trimStart || 0);
    const sourceEnd = Number(source.trimEnd ?? source.duration ?? source.endTime ?? 0);
    while (sourceCursor + 0.04 < sourceEnd && generated.length < 12 && cursor < 22) {
      const chunk = Math.min(2.4, sourceEnd - sourceCursor);
      const speed = speeds[index % speeds.length];
      const duration = chunk / speed;
      if (cursor + duration > 22) break;
      generated.push({
        id: randomUUID(),
        assetId: source.assetId,
        name: String(source.name || 'clip') + ' • ' + String(index + 1),
        startTime: cursor,
        endTime: cursor + duration,
        trimStart: sourceCursor,
        trimEnd: sourceCursor + chunk,
        duration,
        speed,
        volume: 0.96,
        opacity: 1,
        effects: [],
        audioEffects: [],
        audioFade: { in: 0.06, out: 0.06 },
        normalizeAudio: true,
        contentFit: 'fill',
        transform: { scaleX: zooms[index % zooms.length], scaleY: zooms[index % zooms.length], x: 0, y: 0, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
        color: { set_color_adjustments: { contrast: 1.04, saturation: 1.05, exposure: 0.04 } },
        keyframes: [],
      });
      cursor += duration;
      sourceCursor += chunk;
      index++;
    }
    if (generated.length >= 12 || cursor >= 22) break;
  }
  if (!generated.length) return null;
  track.clips = generated;
  out.width = 1080;
  out.height = 1920;
  out.fps = 30;
  out.aspectRatio = '9:16';
  out.duration = cursor;
  out.currentTime = 0;
  out.editPreset = {
    name: 'fast-short',
    target: '9:16',
    pacing: 'fast cuts',
    motion: 'micro zoom',
    audio: 'normalized with short fades',
  };
  out.markers = generated.map((clip: any, i: number) => ({ id: randomUUID(), time: clip.startTime, label: 'Cut ' + String(i + 1) }));
  const textTrack = out.tracks.find((t: any) => t.type === 'text');
  if (textTrack) {
    textTrack.clips = [{
      id: randomUUID(),
      type: 'text',
      name: 'AI CREATIVE STUDIO',
      text: 'AI CREATIVE STUDIO',
      startTime: 0.15,
      endTime: Math.min(1.8, cursor),
      duration: Math.min(1.65, Math.max(0.1, cursor - 0.15)),
      style: { fontSize: 76, color: '#ffffff', position: 'top' },
    }];
  }
  return out;
}


function buildReferenceAnimeTimeline(timeline: any) {
  const out = structuredClone(timeline);
  const track = videoTrack(out);
  const sources = [...track.clips].filter((clip: any) => Number(clip.trimEnd ?? clip.duration ?? 0) > Number(clip.trimStart ?? 0));
  if (!sources.length) return null;

  const chunkPattern = [0.62, 0.78, 0.54, 0.86, 0.66, 0.74, 0.58, 0.82];
  const speeds = [1.00, 1.12, 0.94, 1.18, 1.05, 1.22, 0.98, 1.10];
  const zooms = [1.03, 1.08, 1.02, 1.11, 1.05, 1.09];
  const xShifts = [0, -0.08, 0.06, -0.04, 0.09, -0.02];
  const maxDuration = 16.4;
  const generated: any[] = [];
  const flashTimes: number[] = [];
  let cursor = 0;
  let index = 0;

  for (const source of sources) {
    let sourceCursor = Number(source.trimStart || 0);
    const sourceEnd = Number(source.trimEnd ?? source.duration ?? source.endTime ?? 0);
    while (sourceCursor + 0.04 < sourceEnd && generated.length < 24 && cursor < maxDuration) {
      const desired = chunkPattern[index % chunkPattern.length];
      const chunk = Math.min(desired, sourceEnd - sourceCursor);
      const speed = speeds[index % speeds.length];
      const duration = chunk / speed;
      if (cursor + duration > maxDuration) break;

      const nextClip = {
        id: randomUUID(),
        assetId: source.assetId,
        name: String(source.name || 'clip') + ' • ref-' + String(index + 1),
        startTime: cursor,
        endTime: cursor + duration,
        trimStart: sourceCursor,
        trimEnd: sourceCursor + chunk,
        duration,
        speed,
        volume: 0.98,
        opacity: 1,
        effects: index % 3 === 0 ? [{ type: 'sharpen', amount: 0.8 }] : [],
        audioEffects: [],
        audioFade: { in: 0, out: 0 },
        normalizeAudio: true,
        contentFit: 'fill',
        transform: {
          scaleX: zooms[index % zooms.length],
          scaleY: zooms[index % zooms.length],
          x: xShifts[index % xShifts.length],
          y: 0,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        color: {
          set_color_adjustments: {
            contrast: 1.10,
            saturation: 1.12,
            exposure: 0.05,
          },
        },
        keyframes: [],
      };
      generated.push(nextClip);
      cursor += duration;
      sourceCursor += chunk;
      index++;

      if (generated.length > 1 && generated.length % 4 === 0) {
        flashTimes.push(Math.max(0.02, cursor - 0.045));
      }
    }
    if (generated.length >= 24 || cursor >= maxDuration) break;
  }

  if (!generated.length) return null;

  track.clips = generated;
  out.width = 720;
  out.height = 960;
  out.fps = 30;
  out.aspectRatio = '3:4';
  out.duration = cursor;
  out.currentTime = 0;
  out.editPreset = {
    name: 'reference-anime',
    target: '3:4',
    sourceReference: '2CjhGX-vvvo',
    pacing: 'rapid cuts ~0.5-0.9s',
    motion: 'micro zoom + horizontal reframe',
    transitions: 'hard cuts + 45ms flash accents',
    grade: 'high contrast / high saturation / sharpened',
    audio: 'kept source audio + light dynamics',
  };
  out.flashTimes = flashTimes;
  out.markers = generated.map((clip: any, i: number) => ({ id: randomUUID(), time: clip.startTime, label: 'Ref Cut ' + String(i + 1) }));

  const textTrack = out.tracks.find((t: any) => t.type === 'text');
  if (textTrack) {
    textTrack.clips = [{
      id: randomUUID(),
      type: 'text',
      name: 'AI CREATIVE STUDIO WATERMARK',
      text: 'AI CREATIVE STUDIO',
      startTime: 0.05,
      endTime: Math.min(16.2, cursor),
      duration: Math.max(0.05, Math.min(16.15, cursor - 0.05)),
      style: { fontSize: 34, color: '#ffffff', position: 'top-right', opacity: 0.78 },
    }];
  }
  return out;
}

function atempoChain(speed: number) {
  let value = Math.max(0.25, Math.min(4, Number(speed || 1)));
  const filters: string[] = [];
  while (value > 2) { filters.push('atempo=2'); value /= 2; }
  while (value < 0.5) { filters.push('atempo=0.5'); value /= 0.5; }
  filters.push('atempo=' + value.toFixed(4));
  return filters.join(',');
}

function renderTimelineToFile(projectId: string, timeline: any) {
  const track = videoTrack(timeline);
  const clips = track.clips.filter((clip: any) => Number(clip.duration || 0) > 0);
  if (!clips.length) throw new Error('No video clips');
  const inputs: string[] = [];
  const filters: string[] = [];
  const refs: string[] = [];
  const targetW = Number(timeline.width || 1080);
  const targetH = Number(timeline.height || 1920);
  const fps = Number(timeline.fps || 30);
  const referenceAnime = timeline.editPreset?.name === 'reference-anime';
  let inputIndex = 0;

  for (const clip of clips) {
    const asset = db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId) as any;
    if (!asset || !existsSync(asset.path)) throw new Error('Media missing for ' + String(clip.name));
    const sourceDuration = Math.max(0.01, Number(clip.trimEnd) - Number(clip.trimStart));
    const speed = Math.max(0.25, Math.min(4, Number(clip.speed || 1)));
    const outputDuration = sourceDuration / speed;
    const streamIndex = inputIndex;
    inputs.push('-ss', String(Math.max(0, Number(clip.trimStart || 0))), '-t', String(sourceDuration), '-i', asset.path);

    const zoom = Math.max(1, Math.min(1.18, Number(clip.transform?.scaleX || 1)));
    const shiftX = Math.max(-0.25, Math.min(0.25, Number(clip.transform?.x || 0)));
    const shiftY = Math.max(-0.20, Math.min(0.20, Number(clip.transform?.y || 0)));
    const cropX = '((iw-' + targetW + ')/2)+(' + shiftX.toFixed(3) + '*(iw-' + targetW + ')/2)';
    const cropY = '((ih-' + targetH + ')/2)+(' + shiftY.toFixed(3) + '*(ih-' + targetH + ')/2)';
    const scaledW = Math.max(targetW, Math.round(targetW * zoom / 2) * 2);
    const scaledH = Math.max(targetH, Math.round(targetH * zoom / 2) * 2);
    const contrast = Math.max(0.85, Math.min(1.25, Number(clip.color?.set_color_adjustments?.contrast ?? 1)));
    const saturation = Math.max(0.7, Math.min(1.35, Number(clip.color?.set_color_adjustments?.saturation ?? 1)));
    const exposure = Math.max(-0.15, Math.min(0.15, Number(clip.color?.set_color_adjustments?.exposure ?? 0) * 0.12));
    let vf = '[' + streamIndex + ':v:0]setpts=PTS-STARTPTS,scale=' + targetW + ':' + targetH + ':force_original_aspect_ratio=increase,crop=' + targetW + ':' + targetH + ':' + cropX + ':' + cropY;
    if (zoom > 1.001) vf += ',scale=' + scaledW + ':' + scaledH + ',crop=' + targetW + ':' + targetH + ':(iw-' + targetW + ')/2:(ih-' + targetH + ')/2';
    if (speed !== 1) vf += ',setpts=PTS/' + speed.toFixed(4);
    vf += ',fps=' + fps + ',eq=contrast=' + contrast.toFixed(3) + ':saturation=' + saturation.toFixed(3) + ':brightness=' + exposure.toFixed(3);
    if (!referenceAnime) vf += ',setsar=1,fade=t=in:st=0:d=0.06,fade=t=out:st=' + Math.max(0.01, outputDuration - 0.06).toFixed(3) + ':d=0.06';
    vf += ',setsar=1[v' + inputIndex + ']';
    filters.push(vf);

    const aLabel = 'a' + inputIndex;
    if (hasAudio(asset.path)) {
      let af = '[' + streamIndex + ':a:0]aresample=48000,asetpts=PTS-STARTPTS,' + atempoChain(speed) + ',volume=' + Math.max(0, Math.min(4, Number(clip.volume ?? 1))).toFixed(3);
      if (clip.normalizeAudio !== false) af += ',acompressor=threshold=-18dB:ratio=2:attack=5:release=80,alimiter=limit=0.95';
      filters.push(af + '[' + aLabel + ']');
    } else {
      const dummyIndex = streamIndex + 1;
      inputs.push('-f', 'lavfi', '-t', String(outputDuration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      filters.push('[' + dummyIndex + ':a:0]atrim=0:' + outputDuration.toFixed(3) + ',asetpts=PTS-STARTPTS[' + aLabel + ']');
      inputIndex++;
    }
    refs.push('[v' + streamIndex + '][a' + streamIndex + ']');
    inputIndex++;
  }

  filters.push(refs.join('') + 'concat=n=' + clips.length + ':v=1:a=1[basev][basea]');
  let finalVideo = '[basev]';
  const textClips = (timeline.tracks || []).flatMap((t: any) => t.type === 'text' ? (t.clips || []) : []).filter((c: any) => typeof c.text === 'string' && c.text.trim()).slice(0, 6);
  for (let i = 0; i < textClips.length; i++) {
    const c = textClips[i];
    const start = Math.max(0, Number(c.startTime || 0));
    const end = Math.max(start + 0.05, Number(c.endTime || start + Number(c.duration || 1)));
    const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    const fontsize = Math.max(18, Math.min(120, Number(c.style?.fontSize || 64)));
    const text = String(c.text).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    filters.push(finalVideo + 'drawtext=fontfile=' + font + ':text=' + "'" + text + "'" + ':fontsize=' + fontsize + ':fontcolor=white@' + (referenceAnime ? '0.78' : '1') + ':borderw=' + (referenceAnime ? '1' : '3') + ':bordercolor=black@0.75:x=' + (referenceAnime ? 'w-text_w-52' : '(w-text_w)/2') + ':y=' + (referenceAnime ? '28' : 'h*0.13') + ':enable=between(t\\,' + start.toFixed(3) + '\\,' + end.toFixed(3) + ')[txt' + i + ']');
    finalVideo = '[txt' + i + ']';
  }
  if (referenceAnime) {
    for (const flashTime of (timeline.flashTimes || []).slice(0, 8)) {
      const start = Math.max(0, Number(flashTime));
      const end = Math.min(Number(timeline.duration || 0), start + 0.045);
      filters.push(finalVideo + 'drawbox=x=0:y=0:w=iw:h=ih:color=white@0.82:t=fill:enable=between(t\\,' + start.toFixed(3) + '\\,' + end.toFixed(3) + ')[flash' + Math.round(start * 1000) + ']');
      finalVideo = '[flash' + Math.round(start * 1000) + ']';
    }
  }
  filters.push(finalVideo + 'format=yuv420p[outv]');

  const output = join(EXPORTS, randomUUID() + '.mp4');
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'),
    '-map', '[outv]', '-map', '[basea]', '-r', String(fps),
    '-c:v', 'libx264', '-preset', referenceAnime ? 'ultrafast' : 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', output
  ], { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || !existsSync(output)) throw new Error((result.stderr || 'FFmpeg render failed').slice(-4000));
  return output;
}

function normalizeTimeline(timeline: any) {
  for (const track of timeline.tracks) track.clips.sort((a: any, b: any) => a.startTime - b.startTime);
  timeline.duration = Math.max(0, ...timeline.tracks.flatMap((t: any) => t.clips.map((c: any) => c.endTime)));
  return timeline;
}

function applyCommand(timeline: any, command: any) {
  const out = structuredClone(timeline);
  const track = videoTrack(out);
  const clips = track.clips;
  if (!clips.length) return out;
  const target = clips.find((c: any) => c.id === command.clipId) || clips[0];

  switch (command.type) {
    case 'split': {
      const t = Number(command.time);
      if (t <= target.startTime || t >= target.endTime) break;
      const ratio = (t - target.startTime) / (target.endTime - target.startTime);
      const first = structuredClone(target);
      const second = structuredClone(target);
      first.endTime = t;
      first.duration = t - first.startTime;
      second.id = randomUUID();
      second.startTime = t;
      second.endTime = target.endTime;
      second.duration = second.endTime - second.startTime;
      second.trimStart = target.trimStart + (target.trimEnd - target.trimStart) * ratio;
      clips.splice(clips.indexOf(target), 1, first, second);
      break;
    }
    case 'delete': {
      const index = clips.indexOf(target);
      if (index >= 0) clips.splice(index, 1);
      break;
    }
    case 'move': {
      const s = Math.max(0, Number(command.startTime));
      target.startTime = s;
      target.endTime = s + target.duration;
      break;
    }
    case 'trim_start': {
      const s = Math.min(Math.max(0, Number(command.time)), Math.max(0, target.trimEnd - 0.01));
      const d = s - target.trimStart;
      target.trimStart = s;
      target.startTime += d;
      target.duration = Math.max(0.01, target.endTime - target.startTime);
      break;
    }
    case 'trim_end': {
      const e = Math.max(target.trimStart + 0.01, Number(command.time));
      target.trimEnd = Math.min(e, target.trimEnd);
      target.endTime = target.startTime + (target.trimEnd - target.trimStart);
      target.duration = Math.max(0.01, target.endTime - target.startTime);
      break;
    }
    default:
      break;
  }

  return normalizeTimeline(out);
}

function parseCommand(text: string, timeline: any) {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const clip = timeline.tracks.find((t: any) => t.type === 'video')?.clips?.[0];
  if (!clip) return { type: 'noop', message: 'أضف فيديو أولًا حتى أستطيع تعديل الـTimeline.' };
  const num = s.match(/(\d+(?:[.,]\d+)?)/)?.[1];
  if (/split|قسّم|قسم/.test(s) && num) return { type: 'split', time: Number(num.replace(',', '.')), clipId: clip.id, message: `قسّمت المقطع عند ${num} ثانية.` };
  if (/delete|remove|احذف|حذف/.test(s)) return { type: 'delete', clipId: clip.id, message: 'حذفت المقطع المحدد.' };
  if (/move|حرّك|حرك/.test(s) && num) return { type: 'move', startTime: Number(num.replace(',', '.')), clipId: clip.id, message: `نقلت المقطع إلى ${num} ثانية.` };
  if (/trim|قص|اقطع|أول/.test(s) && num) return { type: 'trim_start', time: Number(num.replace(',', '.')), clipId: clip.id, message: `قصصت بداية المقطع إلى ${num} ثانية.` };
  return { type: 'noop', message: 'لم أفهم الأمر. جرّب: قص أول 5 ثوانٍ، قسّم عند 10، احذف، حرّك إلى 3.' };
}

app.get('/api/health', (_req, res) => {
  let ffmpeg = false;
  let ffprobe = false;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = true; } catch {}
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); ffprobe = true; } catch {}
  res.json({ ok: true, ffmpeg, ffprobe, version: '1.1.0-integrated' });
});

app.get('/api/projects', (_req, res) => {
  const rows = db.prepare('SELECT id,name,created_at,updated_at FROM projects ORDER BY updated_at DESC').all() as any[];
  res.json(rows.map(p => ({ id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at })));
});

app.post('/api/projects', (req, res) => {
  const id = randomUUID();
  const timeline = timelineTemplate();
  const ts = now();
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(id, req.body?.name || 'مشروعي الجديد', JSON.stringify(timeline), JSON.stringify([timeline]), 0, ts, ts);
  res.json(payload(id));
});

app.get('/api/projects/:id', (req, res) => {
  const projectId = String(req.params.id);
  const p = payload(projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json(p);
});

app.post('/api/projects/:id/upload', upload.single('file'), (req, res) => {
  const projectId = String(req.params.id);
  const p = getProject(projectId);
  if (!p || !req.file) return res.status(400).json({ error: 'Project or file missing' });
  const duration = readDuration(req.file.path);
  const assetId = randomUUID();
  db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(assetId, projectId, req.file.originalname, req.file.path, req.file.mimetype || 'application/octet-stream', duration, now());
  const timeline = JSON.parse(p.timeline_json);
  const track = videoTrack(timeline);
  track.clips.push({ id: randomUUID(), assetId, name: req.file.originalname, startTime: timeline.duration, endTime: timeline.duration + duration, trimStart: 0, trimEnd: duration, duration, speed: 1, opacity: 1, effects: [], animations: [], keyframes: [] });
  timeline.duration += duration;
  saveTimeline(projectId, normalizeTimeline(timeline));
  res.json(payload(projectId));
});


app.post('/api/media/google-drive', async (req, res) => {
  try {
    const imported = await downloadGoogleDriveMedia(
      {
        fileId: String(req.body?.fileId || ''),
        name: req.body?.name ? String(req.body.name) : undefined,
        downloadUrl: req.body?.downloadUrl ? String(req.body.downloadUrl) : undefined,
      },
      MEDIA,
    );
    res.status(201).json({
      fileId: imported.fileId,
      name: imported.name,
      url: `/media/${basename(imported.path)}`,
      path: imported.path,
      mime: imported.mime,
      size: imported.size,
      duration: imported.duration,
      width: imported.width,
      height: imported.height,
      videoCodec: imported.videoCodec,
      audioCodec: imported.audioCodec,
    });
  } catch (error) {
    const driveError = error instanceof GoogleDriveImportError ? error : new GoogleDriveImportError(
      error instanceof Error ? error.message : 'Google Drive import failed',
      'google_drive_import_failed',
      502,
    );
    res.status(driveError.statusCode).json({ error: { code: driveError.code, message: driveError.message } });
  }
});

app.post('/api/projects/:id/import/google-drive', async (req, res) => {
  const projectId = String(req.params.id);
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const imported = await downloadGoogleDriveMedia(
      {
        fileId: String(req.body?.fileId || ''),
        name: req.body?.name ? String(req.body.name) : undefined,
        downloadUrl: req.body?.downloadUrl ? String(req.body.downloadUrl) : undefined,
      },
      MEDIA,
    );

    try {
      const assetId = randomUUID();
      db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(
        assetId,
        projectId,
        imported.name,
        imported.path,
        imported.mime,
        imported.duration,
        now(),
      );

      const timeline = JSON.parse(project.timeline_json);
      const track = videoTrack(timeline);
      track.clips.push({
        id: randomUUID(),
        assetId,
        name: imported.name,
        startTime: timeline.duration,
        endTime: timeline.duration + imported.duration,
        trimStart: 0,
        trimEnd: imported.duration,
        duration: imported.duration,
        speed: 1,
        opacity: 1,
        effects: [],
        animations: [],
        keyframes: [],
      });
      timeline.duration += imported.duration;
      saveTimeline(projectId, normalizeTimeline(timeline));
    } catch (error) {
      try { unlinkSync(imported.path); } catch {}
      throw error;
    }

    res.status(201).json({
      ...payload(projectId),
      importedMedia: {
        fileId: imported.fileId,
        name: imported.name,
        mime: imported.mime,
        size: imported.size,
        duration: imported.duration,
        width: imported.width,
        height: imported.height,
        videoCodec: imported.videoCodec,
        audioCodec: imported.audioCodec,
      },
    });
  } catch (error) {
    const driveError = error instanceof GoogleDriveImportError ? error : new GoogleDriveImportError(
      error instanceof Error ? error.message : 'Google Drive project import failed',
      'google_drive_project_import_failed',
      502,
    );
    res.status(driveError.statusCode).json({ error: { code: driveError.code, message: driveError.message } });
  }
});

app.post('/api/projects/:id/command', (req, res) => {
  const projectId = String(req.params.id);
  const p = getProject(projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const timeline = JSON.parse(p.timeline_json);
  const command = parseCommand(String(req.body?.text || ''), timeline);
  const updated = applyCommand(timeline, command);
  if (command.type !== 'noop') saveTimeline(projectId, updated);
  res.json({ provider: 'local-tool-parser', command, timeline: command.type === 'noop' ? timeline : updated });
});

app.post('/api/projects/:id/undo', (req, res) => {
  const projectId = String(req.params.id);
  const p = getProject(projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const history = JSON.parse(p.history_json) as any[];
  if (Number(p.history_index) <= 0) return res.status(409).json({ error: 'Nothing to undo' });
  const index = Number(p.history_index) - 1;
  db.prepare('UPDATE projects SET timeline_json=?,history_index=?,updated_at=? WHERE id=?').run(JSON.stringify(history[index]), index, now(), projectId);
  res.json(payload(projectId));
});

app.post('/api/projects/:id/redo', (req, res) => {
  const projectId = String(req.params.id);
  const p = getProject(projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const history = JSON.parse(p.history_json) as any[];
  const index = Number(p.history_index) + 1;
  if (index >= history.length) return res.status(409).json({ error: 'Nothing to redo' });
  db.prepare('UPDATE projects SET timeline_json=?,history_index=?,updated_at=? WHERE id=?').run(JSON.stringify(history[index]), index, now(), projectId);
  res.json(payload(projectId));
});

app.post('/api/projects/:id/auto-edit/short', (req, res) => {
  const projectId = String(req.params.id);
  const p = getProject(projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  try {
    const edited = buildShortFormTimeline(JSON.parse(p.timeline_json));
    if (!edited) return res.status(422).json({ error: 'No usable video clips' });
    saveTimeline(projectId, normalizeTimeline(edited));
    res.json(payload(projectId));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Auto edit failed' });
  }
});

app.post('/api/projects/:id/auto-edit/reference', (req, res) => {
  const projectId = String(req.params.id);
  const p = getProject(projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  try {
    const edited = buildReferenceAnimeTimeline(JSON.parse(p.timeline_json));
    if (!edited) return res.status(422).json({ error: 'No usable video clips' });
    saveTimeline(projectId, normalizeTimeline(edited));
    res.json(payload(projectId));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Reference edit failed' });
  }
});


app.post('/api/projects/:id/agent/import-and-render', async (req, res) => {
  const projectId = String(req.params.id);
  if (!getProject(projectId)) return res.status(404).json({ error: 'Project not found' });
  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 12) : [];
  if (!files.length) return res.status(400).json({ error: 'files must contain at least one Google Drive item' });

  const importedAssets: any[] = [];
  try {
    let latest = getProject(projectId);
    for (const item of files) {
      const imported = await downloadGoogleDriveMedia({
        fileId: String(item?.fileId || ''),
        name: item?.name ? String(item.name) : undefined,
        downloadUrl: item?.downloadUrl ? String(item.downloadUrl) : undefined,
      }, MEDIA);

      const assetId = randomUUID();
      db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(assetId, projectId, imported.name, imported.path, imported.mime, imported.duration, now());
      const timeline = JSON.parse(latest.timeline_json);
      const track = videoTrack(timeline);
      track.clips.push({
        id: randomUUID(),
        assetId,
        name: imported.name,
        startTime: timeline.duration,
        endTime: timeline.duration + imported.duration,
        trimStart: 0,
        trimEnd: imported.duration,
        duration: imported.duration,
        speed: 1,
        opacity: 1,
        volume: 1,
        effects: [],
        audioEffects: [],
        keyframes: [],
      });
      timeline.duration += imported.duration;
      saveTimeline(projectId, normalizeTimeline(timeline));
      latest = getProject(projectId);
      importedAssets.push({
        assetId,
        fileId: imported.fileId,
        name: imported.name,
        duration: imported.duration,
        width: imported.width,
        height: imported.height,
      });
    }

    const preset = String(req.body?.preset || 'fast-short');
    const edited = preset === 'reference-anime'
      ? buildReferenceAnimeTimeline(JSON.parse(getProject(projectId).timeline_json))
      : buildShortFormTimeline(JSON.parse(getProject(projectId).timeline_json));
    if (!edited) return res.status(422).json({ error: 'No usable video clips after import', importedAssets });
    saveTimeline(projectId, normalizeTimeline(edited));

    const finalTimeline = JSON.parse(getProject(projectId).timeline_json);
    const output = renderTimelineToFile(projectId, finalTimeline);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', output], { encoding: 'utf8', timeout: 30000 }));
    const video = probe.streams?.find((stream: any) => stream.codec_type === 'video');
    const expectedWidth = Number(finalTimeline.width || 1080);
    const expectedHeight = Number(finalTimeline.height || 1920);
    if (!video || Number(video.width) !== expectedWidth || Number(video.height) !== expectedHeight) {
      try { unlinkSync(output); } catch {}
      return res.status(500).json({ error: 'Rendered output failed dimension verification', importedAssets });
    }
    res.setHeader('X-Editor-Preset', String(finalTimeline.editPreset?.name || 'fast-short'));
    res.setHeader('X-Rendered-Width', String(expectedWidth));
    res.setHeader('X-Rendered-Height', String(expectedHeight));
    res.download(output, 'ai-creative-short.mp4', () => { try { unlinkSync(output); } catch {} });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Drive import and render failed',
      importedAssets,
    });
  }
});

app.get('/api/render-from-drive/start', (req, res) => {
  const fileId = String(req.query.fileId || '');
  const downloadUrl = String(req.query.downloadUrl || '');
  const preset = String(req.query.preset || 'reference-anime');
  if (!fileId || !downloadUrl) return res.status(400).json({ error: 'fileId and downloadUrl are required' });
  if (!['reference-anime', 'fast-short'].includes(preset)) return res.status(400).json({ error: 'Unsupported preset' });
  const jobId = randomUUID();
  renderJobs.set(jobId, { status: 'queued', preset, createdAt: now() });
  setImmediate(async () => {
    const job = renderJobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    try {
      const projectId = randomUUID();
      const baseTimeline = timelineTemplate();
      const ts = now();
      db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(projectId, preset === 'reference-anime' ? 'Drive Reference Render' : 'Drive Short Render', JSON.stringify(baseTimeline), JSON.stringify([baseTimeline]), 0, ts, ts);
      job.projectId = projectId;
      const imported = await downloadGoogleDriveMedia({ fileId, downloadUrl, name: String(req.query.name || 'drive-' + fileId + '.mp4') }, MEDIA);
      const assetId = randomUUID();
      db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(assetId, projectId, imported.name, imported.path, imported.mime, imported.duration, now());
      const timeline = JSON.parse(getProject(projectId)!.timeline_json);
      const track = videoTrack(timeline);
      track.clips.push({ id: randomUUID(), assetId, name: imported.name, startTime: 0, endTime: imported.duration, trimStart: 0, trimEnd: imported.duration, duration: imported.duration, speed: 1, opacity: 1, volume: 1, effects: [], audioEffects: [], keyframes: [] });
      timeline.duration = imported.duration;
      saveTimeline(projectId, normalizeTimeline(timeline));
      const edited = preset === 'reference-anime'
        ? buildReferenceAnimeTimeline(JSON.parse(getProject(projectId)!.timeline_json))
        : buildShortFormTimeline(JSON.parse(getProject(projectId)!.timeline_json));
      if (!edited) throw new Error('No usable video clips after Drive import');
      saveTimeline(projectId, normalizeTimeline(edited));
      const finalTimeline = JSON.parse(getProject(projectId)!.timeline_json);
      const output = renderTimelineToFile(projectId, finalTimeline);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-print_format','json','-show_format','-show_streams',output], { encoding: 'utf8', timeout: 30000 }));
      const video = probe.streams?.find((stream: any) => stream.codec_type === 'video');
      const expectedWidth = Number(finalTimeline.width || 1080);
      const expectedHeight = Number(finalTimeline.height || 1920);
      if (!video || Number(video.width) !== expectedWidth || Number(video.height) !== expectedHeight) {
        try { unlinkSync(output); } catch {}
        throw new Error('Rendered output failed dimension verification');
      }
      job.status = 'completed';
      job.output = output;
      job.width = expectedWidth;
      job.height = expectedHeight;
      job.finishedAt = now();
      setTimeout(() => {
        const current = renderJobs.get(jobId);
        if (current?.output === output && current.status === 'completed') { try { unlinkSync(output); } catch {} renderJobs.delete(jobId); }
      }, 15 * 60 * 1000);
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Drive render failed';
      job.finishedAt = now();
    }
  });
  res.status(202).json({ ok: true, jobId, status: 'queued', statusUrl: '/api/render-jobs/' + jobId, downloadUrl: '/api/render-jobs/' + jobId + '/download' });
});

app.get('/api/render-jobs/:id', (req, res) => {
  const jobId = String(req.params.id);
  const job = renderJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Render job not found' });
  res.json({ jobId, status: job.status, preset: job.preset, width: job.width, height: job.height, error: job.error, createdAt: job.createdAt, finishedAt: job.finishedAt, downloadUrl: job.status === 'completed' ? '/api/render-jobs/' + jobId + '/download' : undefined });
});

app.get('/api/render-jobs/:id/download', (req, res) => {
  const jobId = String(req.params.id);
  const job = renderJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Render job not found' });
  if (job.status !== 'completed' || !job.output) return res.status(409).json({ error: 'Render is not completed', status: job.status, jobId });
  const file = job.output;
  res.download(file, job.preset === 'reference-anime' ? 'ai-creative-reference.mp4' : 'ai-creative-short.mp4', () => {
    try { unlinkSync(file); } catch {}
    renderJobs.delete(jobId);
  });
});
app.post('/api/projects/:id/render', (req, res) => {
  const projectId = String(req.params.id);
  const p = getProject(projectId);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  try {
    const timeline = JSON.parse(p.timeline_json);
    const output = renderTimelineToFile(projectId, timeline);
    res.download(output, 'ai-video-studio.mp4', () => { try { unlinkSync(output); } catch {} });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FFmpeg render failed';
    const status = message === 'No video clips' ? 422 : 500;
    res.status(status).json({ error: message });
  }
});

registerAIRoute(app, db);
registerPublicAPIRoute(app, db);
if (process.env.NODE_ENV !== 'test') app.listen(Number(process.env.PORT || 8787), () => console.log('AI Creative Studio API listening on 8787'));
