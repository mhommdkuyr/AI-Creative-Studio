import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { planWithOpenAI } from './aiProvider.js';
import { applyOperations } from './editingEngine.js';

type ClientRow = { id: string; tenant_id: string; name: string; key_hash: string; scopes_json: string; created_at: string; revoked_at: string | null };

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const now = () => new Date().toISOString();
const makeKey = () => `asc_live_${randomUUID().replaceAll('-', '')}`;

export function registerPublicAPIRoute(app: Express, db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS api_clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,name TEXT NOT NULL,key_hash TEXT NOT NULL UNIQUE,scopes_json TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS project_tenants(project_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL)`);

  const authenticate: RequestHandler = (req, res, next) => {
    const provided = String(req.header('x-api-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '') || '');
    if (!provided) return res.status(401).json({ error: { code: 'missing_api_key', message: 'API key is required' } });
    const hash = hashKey(provided);
    const client = db.prepare('SELECT * FROM api_clients WHERE key_hash=? AND revoked_at IS NULL').get(hash) as ClientRow | undefined;
    const fallback = process.env.PUBLIC_API_KEY && provided === process.env.PUBLIC_API_KEY;
    if (!client && !fallback) return res.status(401).json({ error: { code: 'invalid_api_key', message: 'Invalid API key' } });
    (req as any).apiClient = client || { id: 'env', tenant_id: 'env', name: 'environment', scopes_json: '["*"]' };
    next();
  };

  const adminOnly: RequestHandler = (req, res, next) => {
    const adminKey = process.env.ADMIN_API_KEY;
    const provided = String(req.header('x-admin-key') || req.header('authorization')?.replace(/^Bearer\s+/i, '') || '');
    if (!adminKey || provided !== adminKey) return res.status(403).json({ error: { code: 'admin_required', message: 'Admin API key required' } });
    next();
  };

  const createProject = (tenantId: string, name: string) => {
    const id = randomUUID();
    const video = { id: randomUUID(), name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, visible: true, height: 60, order: 0 };
    const audio = { id: randomUUID(), name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, visible: true, height: 80, order: 1 };
    const text = { id: randomUUID(), name: 'Text 1', type: 'text', clips: [], muted: false, locked: false, visible: true, height: 60, order: 2 };
    const timeline = { version: 2, duration: 0, currentTime: 0, tracks: [video, audio, text], markers: [] };
    const ts = now();
    db.prepare('INSERT INTO projects(id,name,timeline_json,history_json,history_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, name || 'New project', JSON.stringify(timeline), JSON.stringify([timeline]), 0, ts, ts);
    db.prepare('INSERT OR REPLACE INTO project_tenants(project_id,tenant_id) VALUES(?,?)').run(id, tenantId);
    return id;
  };

  const getProject = (id: string, tenantId: string) => {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(id) as any;
    if (!project) return null;
    const mapping = db.prepare('SELECT tenant_id FROM project_tenants WHERE project_id=?').get(id) as any;
    const actualTenant = mapping?.tenant_id || 'local';
    if (tenantId !== 'env' && actualTenant !== tenantId) return undefined;
    return project;
  };

  app.get('/v1/capabilities', authenticate, (_req, res) => {
    res.json({ version: 'v1', operations: ['split','delete_clip','duplicate_clip','move_clip','trim_clip','set_speed','set_volume','mute_clip','set_opacity','transform','crop','set_blend_mode','add_text','update_text','add_marker','add_effect','remove_effect','set_keyframe','add_transition','set_timeline','reorder_track','rename_track','set_track_state'], providers: { ai: Boolean(process.env.OPENAI_API_KEY), renderer: 'ffmpeg' } });
  });

  app.post('/v1/api-keys', adminOnly, (req, res) => {
    const key = makeKey();
    const client = { id: randomUUID(), tenantId: String(req.body?.tenantId || randomUUID()), name: String(req.body?.name || 'Integration'), scopes: Array.isArray(req.body?.scopes) ? req.body.scopes : ['projects:read','projects:write','render'] };
    db.prepare('INSERT INTO api_clients(id,tenant_id,name,key_hash,scopes_json,created_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)')
      .run(client.id, client.tenantId, client.name, hashKey(key), JSON.stringify(client.scopes), now());
    res.status(201).json({ id: client.id, tenantId: client.tenantId, name: client.name, apiKey: key, scopes: client.scopes, warning: 'Store this API key securely. It is shown only once.' });
  });

  app.post('/v1/projects', authenticate, (req, res) => {
    const tenantId = (req as any).apiClient.tenant_id;
    const id = createProject(tenantId, String(req.body?.name || 'New project'));
    res.status(201).json({ id, tenantId });
  });

  app.get('/v1/projects/:id', authenticate, (req, res) => {
    const project = getProject(String(req.params.id), (req as any).apiClient.tenant_id);
    if (project === undefined) return res.status(403).json({ error: { code: 'tenant_forbidden', message: 'Project belongs to another tenant' } });
    if (!project) return res.status(404).json({ error: { code: 'project_not_found', message: 'Project not found' } });
    res.json({ id: project.id, name: project.name, timeline: JSON.parse(project.timeline_json), updatedAt: project.updated_at });
  });

  app.post('/v1/projects/:id/command', authenticate, async (req, res) => {
    const id = String(req.params.id);
    const project = getProject(id, (req as any).apiClient.tenant_id);
    if (project === undefined) return res.status(403).json({ error: { code: 'tenant_forbidden', message: 'Project belongs to another tenant' } });
    if (!project) return res.status(404).json({ error: { code: 'project_not_found', message: 'Project not found' } });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: { code: 'empty_command', message: 'text is required' } });
    try {
      const timeline = JSON.parse(project.timeline_json);
      const plan = await planWithOpenAI(text, timeline);
      const next = applyOperations(timeline, plan.operations);
      const history = JSON.parse(project.history_json).slice(0, Number(project.history_index) + 1);
      history.push(next);
      const bounded = history.slice(-100);
      db.prepare('UPDATE projects SET timeline_json=?,history_json=?,history_index=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(next), JSON.stringify(bounded), bounded.length - 1, now(), id);
      res.json({ requestId: randomUUID(), plan, timeline: next });
    } catch (error) {
      res.status(500).json({ error: { code: 'command_failed', message: error instanceof Error ? error.message : 'Command execution failed' } });
    }
  });

  app.post('/v1/projects/:id/render', authenticate, async (req, res) => {
    const project = getProject(String(req.params.id), (req as any).apiClient.tenant_id);
    if (project === undefined) return res.status(403).json({ error: { code: 'tenant_forbidden', message: 'Project belongs to another tenant' } });
    if (!project) return res.status(404).json({ error: { code: 'project_not_found', message: 'Project not found' } });
    res.status(202).json({ requestId: randomUUID(), status: 'accepted', message: 'Use the existing editor render endpoint for local synchronous export. The public async render contract is reserved for the scalable worker backend.' });
  });
}
