import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import express from 'express';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

process.env.NODE_ENV = 'test';
const { app, db } = await import('./server.js');

type RequestContext = { sessionId: string };
const requestContext = new AsyncLocalStorage<RequestContext>();

db.function('current_session', () => requestContext.getStore()?.sessionId || '');

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readSessionCookie(req: any) {
  const raw = String(req.header('cookie') || '');
  const match = raw.match(/(?:^|;\\s*)acs_session=([^;]+)/);
  return match ? String(match[1]) : '';
}

function createSession() {
  return crypto.randomBytes(24).toString('base64url');
}

function getSession(req: any, res: any) {
  const existing = String(req.acsSessionId || readSessionCookie(req) || '');
  if (/^[A-Za-z0-9_-]{20,100}$/.test(existing)) {
    req.acsSessionId = existing;
    return existing;
  }
  const sessionId = createSession();
  req.acsSessionId = sessionId;
  res.append('Set-Cookie', 'acs_session=' + sessionId + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000');
  return sessionId;
}

function migrateToSessionScopedViews() {
  const projectObject = db.prepare("SELECT type FROM sqlite_master WHERE name='projects'").get() as any;
  if (projectObject?.type === 'table') {
    const projectColumns = db.prepare('PRAGMA table_info(projects)').all() as any[];
    const hasOwner = projectColumns.some((column: any) => column.name === 'owner_session');
    if (!hasOwner) {
      db.exec('ALTER TABLE projects RENAME TO acs_projects');
      db.exec('ALTER TABLE assets RENAME TO acs_assets');
      db.exec("ALTER TABLE acs_projects ADD COLUMN owner_session TEXT NOT NULL DEFAULT 'legacy'");
      db.exec("ALTER TABLE acs_assets ADD COLUMN owner_session TEXT NOT NULL DEFAULT 'legacy'");
    }
  }

  const backingProject = db.prepare("SELECT type FROM sqlite_master WHERE name='acs_projects'").get() as any;
  if (backingProject?.type !== 'table') throw new Error('Session-scoped project table migration failed');

  const backingAssets = db.prepare("SELECT type FROM sqlite_master WHERE name='acs_assets'").get() as any;
  if (backingAssets?.type !== 'table') throw new Error('Session-scoped asset table migration failed');

  const projectView = db.prepare("SELECT type FROM sqlite_master WHERE name='projects'").get() as any;
  if (projectView?.type !== 'view') {
    db.exec(`
      CREATE VIEW projects AS
        SELECT id,name,timeline_json,history_json,history_index,created_at,updated_at
        FROM acs_projects
        WHERE owner_session = current_session();

      CREATE TRIGGER projects_insert INSTEAD OF INSERT ON projects
      BEGIN
        INSERT INTO acs_projects(id,name,timeline_json,history_json,history_index,created_at,updated_at,owner_session)
        VALUES(NEW.id,NEW.name,NEW.timeline_json,NEW.history_json,NEW.history_index,NEW.created_at,NEW.updated_at,current_session());
      END;

      CREATE TRIGGER projects_update INSTEAD OF UPDATE ON projects
      BEGIN
        UPDATE acs_projects
        SET id=NEW.id,name=NEW.name,timeline_json=NEW.timeline_json,history_json=NEW.history_json,
            history_index=NEW.history_index,created_at=NEW.created_at,updated_at=NEW.updated_at
        WHERE id=OLD.id AND owner_session=current_session();
      END;

      CREATE TRIGGER projects_delete INSTEAD OF DELETE ON projects
      BEGIN
        DELETE FROM acs_projects WHERE id=OLD.id AND owner_session=current_session();
      END;
    `);
  }

  const assetView = db.prepare("SELECT type FROM sqlite_master WHERE name='assets'").get() as any;
  if (assetView?.type !== 'view') {
    db.exec(`
      CREATE VIEW assets AS
        SELECT id,project_id,name,path,mime,duration,created_at
        FROM acs_assets
        WHERE owner_session = current_session();

      CREATE TRIGGER assets_insert INSTEAD OF INSERT ON assets
      BEGIN
        INSERT INTO acs_assets(id,project_id,name,path,mime,duration,created_at,owner_session)
        VALUES(NEW.id,NEW.project_id,NEW.name,NEW.path,NEW.mime,NEW.duration,NEW.created_at,current_session());
      END;

      CREATE TRIGGER assets_update INSTEAD OF UPDATE ON assets
      BEGIN
        UPDATE acs_assets
        SET id=NEW.id,project_id=NEW.project_id,name=NEW.name,path=NEW.path,mime=NEW.mime,
            duration=NEW.duration,created_at=NEW.created_at
        WHERE id=OLD.id AND owner_session=current_session();
      END;

      CREATE TRIGGER assets_delete INSTEAD OF DELETE ON assets
      BEGIN
        DELETE FROM acs_assets WHERE id=OLD.id AND owner_session=current_session();
      END;
    `);
  }
}

migrateToSessionScopedViews();

const expected = process.env.EDGE_SHARED_SECRET || '';

function guard(req: any, res: any, next: any) {
  const sessionId = getSession(req, res);
  return requestContext.run({ sessionId }, () => {
    const path = String(req.originalUrl || req.url || '').split('?')[0];

    if (path.startsWith('/api/') && path !== '/api/health' && expected) {
      const supplied = String(req.header('x-edge-shared-secret') || '');
      if (supplied && !safeEqual(supplied, expected)) {
        return res.status(403).json({ error: 'renderer_access_denied' });
      }
    }

    if (path.startsWith('/media/')) {
      const fileName = basename(decodeURIComponent(path));
      const row = db.prepare(
        'SELECT id FROM acs_assets WHERE owner_session=? AND path LIKE ? LIMIT 1'
      ).get(sessionId, '%/' + fileName) as any;
      if (!row) return res.status(404).json({ error: 'media_not_found' });
    }

    return next();
  });
}

const router = (app as any)._router;
if (!router?.stack) throw new Error('Express router stack is unavailable');

const wrapped = new WeakSet<Function>();
function wrapStack() {
  for (const layer of router.stack) {
    if (typeof layer.handle !== 'function' || wrapped.has(layer.handle)) continue;
    const original = layer.handle;
    const wrappedHandle = (req: any, res: any, next: any) =>
      guard(req, res, () => original(req, res, next));
    layer.handle = wrappedHandle;
    wrapped.add(wrappedHandle);
  }
}

wrapStack();

const webRoot = join(process.cwd(), 'apps/web/dist');
if (existsSync(webRoot)) {
  app.use(express.static(webRoot, { index: 'index.html' }));
  app.get('*', (req: any, res: any, next: any) => {
    const path = String(req.path || '');
    if (path.startsWith('/api/') || path.startsWith('/media/')) return next();
    return res.sendFile(join(webRoot, 'index.html'));
  });
  wrapStack();
}

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log('AI Creative Studio secure renderer listening on ' + port));
