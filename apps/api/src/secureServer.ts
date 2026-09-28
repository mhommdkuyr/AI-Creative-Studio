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

function readSessionCookie(req: express.Request) {
  const raw = typeof req.get === 'function' ? String(req.get('cookie') || '') : '';
  const match = raw.match(/(?:^|;\s*)acs_session=([^;]+)/);
  return match ? String(match[1]) : '';
}

function createSession() {
  return crypto.randomBytes(24).toString('base64url');
}

function sessionMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  let sessionId = readSessionCookie(req);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(sessionId)) {
    sessionId = createSession();
    res.append('Set-Cookie', 'acs_session=' + sessionId + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000');
  }

  if (process.env.EDGE_SHARED_SECRET) {
    const path = String(req.path || '');
    if ((path.startsWith('/api/') || path.startsWith('/media/')) && path !== '/api/health') {
      const supplied = String(req.get('x-edge-shared-secret') || '');
      if (supplied && !safeEqual(supplied, String(process.env.EDGE_SHARED_SECRET))) {
        return res.status(403).json({ error: 'renderer_access_denied' });
      }
    }
  }

  return requestContext.run({ sessionId }, next);
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

const webRoot = join(process.cwd(), 'apps/web/dist');
const publicApp = express();
publicApp.disable('x-powered-by');

// One real Express middleware executes before the legacy API application.
// This avoids modifying Express router internals and gives every request a stable
// session context for the SQLite session-scoped views.
publicApp.use(sessionMiddleware);

publicApp.use(app);

if (existsSync(webRoot)) {
  publicApp.use(express.static(webRoot, { index: 'index.html' }));
  publicApp.get('*', (_req, res) => res.sendFile(join(webRoot, 'index.html')));
}

const port = Number(process.env.PORT || 10000);
publicApp.listen(port, '0.0.0.0', () => {
  console.log('AI Creative Studio secure renderer listening on ' + port);
});
