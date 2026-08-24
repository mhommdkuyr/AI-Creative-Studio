import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, createWriteStream, readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd(), '../..');
const DATA = join(ROOT, 'data');
const MEDIA = join(DATA, 'media');
const EXPORTS = join(DATA, 'exports');
mkdirSync(MEDIA, { recursive: true });
mkdirSync(EXPORTS, { recursive: true });

const db = new Database(join(DATA, 'creative-studio.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 timeline_json TEXT NOT NULL,
 history_json TEXT NOT NULL,
 history_index INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 name TEXT NOT NULL,
 path TEXT NOT NULL,
 mime TEXT NOT NULL,
 duration REAL NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
`);

const app = express();
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
    const value = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8', timeout: 30000 }).trim();
    return Number(value) || 0;
  } catch {
    return 0;
  }
}

function getProject(id: string) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
}
function getAssets(id: string) {
  return db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(id) as any[];
}
function payload(id: string) {
  const p = getProject(id);
  if (!p) return null;
  return { id: p.id, name: p.name, timeline: JSON.parse(p.timeline_json), historyIndex: p.history_index, historyLength: JSON.parse(p.history_json).length, assets: getAssets(id) };
}
function saveTimeline(id: string, timeline: any) {
  const p = getProject(id);
  if (!p) throw new Error('Project not found');
  const history = JSON.parse(p.history_json) as any[];
  const trimmed = history.slice(0, Number(p.history_index) + 1);
  trimmed.push(timeline);
  const bounded = trimmed.slice(-100);
  db.prepare('UPDATE projects SET timeline_json=?, history_json=?, history_index=?, updated_at=? WHERE id=?')
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
function applyCommand(timeline: any, command: any) {
  const out = structuredClone(timeline);
  const track = videoTrack(out);
  const clips = track.clips;
  if (!clips.length) return out;
  const target = clips.find((c: any) => c.id === command.clipId) ?? clips[0];
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
      target.startTime = Math.max(0, Number(command.startTime));
      target.endTime = target.startTime + target.duration;
      break;
    }
    case 'trim_start': {
      target.trimStart = Math.max(0, Number(command.time));
      target.startTime = Math.max(0, target.startTime + target.trimStart);
      target.duration = Math.max(0.01, target.endTime - target.startTime);
      break;
    }
    case 'trim_end': {
      target.trimEnd = Math.max(target.trimStart + 0.01, Number(command.time));
      target.endTime = target.startTime + (target.trimEnd - target.trimStart);
      target.duration = Math.max(0.01, target.endTime - target.startTime);
      break;
    }
    default:
      break;
  }
  out.duration = Math.max(0, ...out.tracks.flatMap((t: any) => t.clips.map((c: any) => c.endTime)));
  return out;
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
  return { type: 'noop', message: 'لم أفهم أمر التحرير بعد. جرّب: قص أول 5 ثوانٍ، قسّم عند 10، احذف، حرّك إلى 3.' };
}

app.get('/api/health', (_req, res) => {
  let ffmpeg = false;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = true; } catch {}
  res.json({ ok: true, ffmpeg, version: '1.1.0-integrated' });
});

app.post('/api/projects', (req, res) => {
  const id = randomUUID();
  const timeline = timelineTemplate();
  const ts = now();
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run(id, req.body?.name || 'مشروعي الجديد', JSON.stringify(timeline), JSON.stringify([timeline]), 0, ts, ts);
  res.json(payload(id));
});
app.get('/api/projects/:id', (req, res) => {
  const p = payload(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  res.json(p);
});
app.post('/api/projects/:id/upload', upload.single('file'), (req, res) => {
  const p = getProject(req.params.id);
  if (!p || !req.file) return res.status(400).json({ error: 'Project or file missing' });
  const duration = readDuration(req.file.path);
  const assetId = randomUUID();
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(assetId, req.params.id, req.file.originalname, req.file.path, req.file.mimetype || 'application/octet-stream', duration, now());
  const timeline = JSON.parse(p.timeline_json);
  const track = videoTrack(timeline);
  track.clips.push({ id: randomUUID(), assetId, name: req.file.originalname, startTime: timeline.duration, endTime: timeline.duration + duration, trimStart: 0, trimEnd: duration, duration, speed: 1, opacity: 1, effects: [], animations: [], keyframes: [] });
  timeline.duration = Math.max(timeline.duration, timeline.duration + duration);
  saveTimeline(req.params.id, timeline);
  res.json(payload(req.params.id));
});
app.post('/api/projects/:id/command', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const timeline = JSON.parse(p.timeline_json);
  const command = parseCommand(String(req.body?.text || ''), timeline);
  const updated = applyCommand(timeline, command);
  if (command.type !== 'noop') saveTimeline(req.params.id, updated);
  res.json({ provider: 'local-tool-parser', command, timeline: command.type === 'noop' ? timeline : updated });
});
app.post('/api/projects/:id/undo', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const history = JSON.parse(p.history_json) as any[];
  if (Number(p.history_index) <= 0) return res.status(409).json({ error: 'Nothing to undo' });
  const index = Number(p.history_index) - 1;
  db.prepare('UPDATE projects SET timeline_json=?, history_index=?, updated_at=? WHERE id=?').run(JSON.stringify(history[index]), index, now(), req.params.id);
  res.json(payload(req.params.id));
});
app.post('/api/projects/:id/redo', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const history = JSON.parse(p.history_json) as any[];
  const index = Number(p.history_index) + 1;
  if (index >= history.length) return res.status(409).json({ error: 'Nothing to redo' });
  db.prepare('UPDATE projects SET timeline_json=?, history_index=?, updated_at=? WHERE id=?').run(JSON.stringify(history[index]), index, now(), req.params.id);
  res.json(payload(req.params.id));
});
app.post('/api/projects/:id/render', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const timeline = JSON.parse(p.timeline_json);
  const track = videoTrack(timeline);
  const clip = track.clips[0];
  if (!clip) return res.status(422).json({ error: 'No video clips' });
  const asset = db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId) as any;
  if (!asset || !existsSync(asset.path)) return res.status(404).json({ error: 'Media file missing' });
  const output = join(EXPORTS, `${randomUUID()}.mp4`);
  const seconds = Math.max(0.01, clip.trimEnd - clip.trimStart);
  const result = spawnSync('ffmpeg', ['-y','-ss',String(clip.trimStart),'-i',asset.path,'-t',String(seconds),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output], { encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0 || !existsSync(output)) return res.status(500).json({ error: 'FFmpeg render failed', detail: result.stderr?.slice(-2000) });
  res.download(output, 'ai-video-studio.mp4', () => { try { unlinkSync(output); } catch {} });
});

app.listen(Number(process.env.PORT || 8787), () => console.log('AI Creative Studio API listening on 8787'));
