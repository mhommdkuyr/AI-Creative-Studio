import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, db } from './server.js';

let projectId = '';

describe('integrated API', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });
  afterAll(() => {
    db.close();
  });

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
    expect(response.body.timeline.tracks).toHaveLength(3);
    expect(response.body.timeline.tracks.map((t: any) => t.type)).toEqual(['video', 'audio', 'text']);
  });

  it('returns a deterministic Arabic edit command without requiring a paid AI API', async () => {
    const response = await request(app)
      .post(`/api/projects/${projectId}/command`)
      .send({ text: 'قص أول 5 ثواني' });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('local-tool-parser');
    expect(response.body.command.type).toBe('noop');
  });
});
