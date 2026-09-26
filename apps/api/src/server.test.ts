import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app, db, MEDIA } from './server.js';
import { verifyGeminiCredentials } from './aiProvider.js';

let projectId = '';
const fixture = join(tmpdir(), 'ai-creative-studio-test.mp4');

const hasGemini = Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2);
const expectedProvider = hasGemini ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'local';

async function startFixtureServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
  return { server, url: `http://127.0.0.1:${address.port}/fixture.mp4` };
}

describe('integrated API', () => {
  beforeAll(() => {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture], { stdio: 'ignore' });
  });

  afterAll(() => { db.close(); });

  it('reports health and FFmpeg availability', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.ffmpeg).toBe(true);
    expect(response.body.ffprobe).toBe(true);
  });

  it('creates a persistent project with video/audio/text tracks', async () => {
    const response = await request(app).post('/api/projects').send({ name: 'Integration Test' });
    expect(response.status).toBe(200);
    projectId = response.body.id;
    expect(response.body.timeline.tracks.map((t: any) => t.type)).toEqual(['video', 'audio', 'text']);
  });

  it('uploads real media and discovers its duration', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/upload`).attach('file', fixture);
    expect(response.status).toBe(200);
    expect(response.body.assets).toHaveLength(1);
    expect(response.body.assets[0].duration).toBeGreaterThan(2.9);
    expect(response.body.timeline.tracks[0].clips).toHaveLength(1);
  });

  it('imports a real MP4 from a server-side Google Drive source and inserts it into the timeline', async () => {
    const testProject = await request(app).post('/api/projects').send({ name: 'Drive Import Test' });
    expect(testProject.status).toBe(200);
    const driveProjectId = testProject.body.id;
    const source = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      createReadStream(fixture).pipe(res);
    });
    try {
      const response = await request(app)
        .post(`/api/projects/${driveProjectId}/import/google-drive`)
        .send({ fileId: 'drive-test-file', name: 'drive-test.mp4', downloadUrl: source.url });
      expect(response.status).toBe(201);
      expect(response.body.importedMedia.width).toBe(640);
      expect(response.body.importedMedia.height).toBe(360);
      expect(response.body.importedMedia.duration).toBeGreaterThan(2.9);
      expect(response.body.assets).toHaveLength(1);
      expect(response.body.timeline.tracks[0].clips).toHaveLength(1);
      expect(existsSync(response.body.assets[0].path)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => source.server.close(() => resolve()));
    }
  });

  it('rejects a non-video Google Drive download', async () => {
    const source = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not a video');
    });
    try {
      const response = await request(app)
        .post('/api/media/google-drive')
        .send({ fileId: 'drive-invalid-mime', name: 'not-video.mp4', downloadUrl: source.url });
      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('invalid_video_content_type');
    } finally {
      await new Promise<void>((resolve) => source.server.close(() => resolve()));
    }
  });

  it('enforces the Google Drive download size limit before writing oversized content', async () => {
    const previous = process.env.GOOGLE_DRIVE_MAX_BYTES;
    process.env.GOOGLE_DRIVE_MAX_BYTES = '1024';
    const source = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '2048' });
      res.end(Buffer.alloc(2048));
    });
    try {
      const response = await request(app)
        .post('/api/media/google-drive')
        .send({ fileId: 'drive-too-large', name: 'too-large.mp4', downloadUrl: source.url });
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('download_too_large');
    } finally {
      await new Promise<void>((resolve) => source.server.close(() => resolve()));
      if (previous === undefined) delete process.env.GOOGLE_DRIVE_MAX_BYTES;
      else process.env.GOOGLE_DRIVE_MAX_BYTES = previous;
    }
  });

  it('cleans up a partially downloaded invalid video', async () => {
    const before = new Set(readdirSync(MEDIA));
    const source = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(Buffer.from('this is not an actual mp4'));
    });
    try {
      const response = await request(app)
        .post('/api/media/google-drive')
        .send({ fileId: 'drive-bad-bytes', name: 'broken.mp4', downloadUrl: source.url });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('ffprobe_failed');
      const after = new Set(readdirSync(MEDIA));
      expect([...after].filter(name => !before.has(name))).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => source.server.close(() => resolve()));
    }
  });

  it('uses the configured real AI provider for an Arabic editing command', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/ai-command`).send({ text: 'قص أول 1 ثانية' });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe(expectedProvider);
    expect(response.body.command.type).toBe('trim_start');
    expect(response.body.timeline.tracks[0].clips[0].trimStart).toBe(1);
  }, 30000);

  it('verifies both Gemini credentials with independent real API calls', async () => {
    if (!hasGemini) return;
    const result = await verifyGeminiCredentials();
    if (process.env.GEMINI_API_KEY) expect(result.GEMINI_API_KEY).toBe(true);
    if (process.env.GEMINI_API_KEY_2) expect(result.GEMINI_API_KEY_2).toBe(true);
  }, 60000);

  it('verifies Gemini compound editing with a real API call', async () => {
    if (!hasGemini) return;
    const response = await request(app).post(`/api/projects/${projectId}/ai-plan`).send({
      text: 'قص أول ثانية ثم زد السرعة إلى 1.5x',
    });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('gemini');
    expect(response.body.dryRun).toBe(true);
    expect(Array.isArray(response.body.plan.operations)).toBe(true);
    expect(response.body.plan.operations.length).toBeGreaterThanOrEqual(2);
    const operations = response.body.plan.operations.map((operation: any) => operation.op);
    expect(operations).toContain('set_speed');
    expect(operations.length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('supports split, undo and redo', async () => {
    const split = await request(app).post(`/api/projects/${projectId}/command`).send({ text: 'قسّم عند 2' });
    expect(split.status).toBe(200);
    expect(split.body.timeline.tracks[0].clips).toHaveLength(2);
    const undo = await request(app).post(`/api/projects/${projectId}/undo`);
    expect(undo.status).toBe(200);
    expect(undo.body.timeline.tracks[0].clips).toHaveLength(1);
    const redo = await request(app).post(`/api/projects/${projectId}/redo`);
    expect(redo.status).toBe(200);
    expect(redo.body.timeline.tracks[0].clips).toHaveLength(2);
  });

  it('builds a real fast short timeline and renders it as 9:16 MP4', async () => {
    const created = await request(app).post('/api/projects').send({ name: 'Auto Short Test' });
    expect(created.status).toBe(200);
    const id = created.body.id;
    const uploaded = await request(app).post(`/api/projects/${id}/upload`).attach('file', fixture);
    expect(uploaded.status).toBe(200);

    const edited = await request(app).post(`/api/projects/${id}/auto-edit/short`);
    expect(edited.status).toBe(200);
    expect(edited.body.timeline.width).toBe(1080);
    expect(edited.body.timeline.height).toBe(1920);
    expect(edited.body.timeline.aspectRatio).toBe('9:16');
    expect(edited.body.timeline.tracks[0].clips.length).toBeGreaterThanOrEqual(2);

    const rendered = await request(app).post(`/api/projects/${id}/render`);
    expect(rendered.status).toBe(200);
    expect(rendered.headers['content-type']).toMatch(/video\/mp4/);
    expect(Buffer.isBuffer(rendered.body)).toBe(true);
    expect(rendered.body.length).toBeGreaterThan(10000);

    const out = join(tmpdir(), 'ai-creative-studio-auto-short-test.mp4');
    writeFileSync(out, rendered.body);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out], { encoding: 'utf8' }));
    const video = probe.streams.find((stream: any) => stream.codec_type === 'video');
    expect(video.width).toBe(1080);
    expect(video.height).toBe(1920);
    expect(Number(probe.format.duration)).toBeGreaterThan(2.5);
    unlinkSync(out);
  }, 60000);


  it('builds and renders the YouTube-reference-inspired 3:4 anime style', async () => {
    const created = await request(app).post('/api/projects').send({ name: 'Reference Anime Test' });
    expect(created.status).toBe(200);
    const id = created.body.id;
    const uploaded = await request(app).post(`/api/projects/${id}/upload`).attach('file', fixture);
    expect(uploaded.status).toBe(200);

    const edited = await request(app).post(`/api/projects/${id}/auto-edit/reference`);
    expect(edited.status).toBe(200);
    expect(edited.body.timeline.width).toBe(1080);
    expect(edited.body.timeline.height).toBe(1440);
    expect(edited.body.timeline.aspectRatio).toBe('3:4');
    expect(edited.body.timeline.editPreset.name).toBe('reference-anime');
    expect(edited.body.timeline.tracks[0].clips.length).toBeGreaterThanOrEqual(5);

    const rendered = await request(app).post(`/api/projects/${id}/render`);
    expect(rendered.status).toBe(200);
    expect(rendered.headers['content-type']).toMatch(/video\/mp4/);
    expect(Buffer.isBuffer(rendered.body)).toBe(true);
    expect(rendered.body.length).toBeGreaterThan(10000);

    const out = join(tmpdir(), 'ai-creative-studio-reference-anime-test.mp4');
    writeFileSync(out, rendered.body);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out], { encoding: 'utf8' }));
    const video = probe.streams.find((stream: any) => stream.codec_type === 'video');
    expect(video.width).toBe(1080);
    expect(video.height).toBe(1440);
    expect(video.codec_name).toBe('h264');
    expect(Number(probe.format.duration)).toBeGreaterThan(2.5);
    unlinkSync(out);
  }, 60000);

  it('renders the edited multi-clip timeline into a real MP4', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/render`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/video\/mp4/);
    expect(Number(response.headers['content-length'] || 0)).toBeGreaterThan(1000);
  });
});