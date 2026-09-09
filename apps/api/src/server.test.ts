import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app, db } from './server.js';

let projectId = '';
const fixture = join(tmpdir(), 'ai-creative-studio-test.mp4');

const expectedProvider = process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'local';

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

  it('uses the configured real AI provider for an Arabic editing command', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/ai-command`).send({ text: 'قص أول 1 ثانية' });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe(expectedProvider);
    expect(response.body.command.type).toBe('trim_start');
    expect(response.body.timeline.tracks[0].clips[0].trimStart).toBe(1);
  });

  it('verifies Gemini with a real API call when GEMINI_API_KEY is configured', async () => {
    if (!process.env.GEMINI_API_KEY) return;
    const response = await request(app).post(`/api/projects/${projectId}/ai-plan`).send({
      text: 'قص أول ثانية، ثم زد السرعة إلى 1.5x، ثم أضف نصًا في منتصف الفيديو يقول: تجربة Gemini',
    });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('gemini');
    expect(response.body.dryRun).toBe(true);
    expect(Array.isArray(response.body.plan.operations)).toBe(true);
    expect(response.body.plan.operations.length).toBeGreaterThanOrEqual(3);
    expect(response.body.plan.operations.map((operation: any) => operation.op)).toEqual(
      expect.arrayContaining(['trim_clip', 'set_speed']),
    );
  });

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

  it('renders the edited multi-clip timeline into a real MP4', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/render`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/video\/mp4/);
    expect(Number(response.headers['content-length'] || 0)).toBeGreaterThan(1000);
  });
});
