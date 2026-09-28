import crypto from 'node:crypto';
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Import server.ts only after forcing test mode so its default listener is not started.
process.env.NODE_ENV = 'test';
const { app } = await import('./server.js');

const expected = process.env.EDGE_SHARED_SECRET || '';
if (!expected) throw new Error('EDGE_SHARED_SECRET is required for secure renderer mode');

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function guard(req: any, res: any, next: any) {
  if (!String(req.path || '').startsWith('/api/') || req.path === '/api/health') return next();
  const supplied = String(req.header('x-edge-shared-secret') || '');
  if (!safeEqual(supplied, expected)) return res.status(403).json({ error: 'renderer_access_denied' });
  return next();
}

// Guard the legacy API routes before exposing the renderer to the public edge.
const router = (app as any)._router;
if (!router?.stack) throw new Error('Express router stack is unavailable');
for (const layer of router.stack) {
  if (typeof layer.handle !== 'function') continue;
  const original = layer.handle;
  layer.handle = (req: any, res: any, next: any) => guard(req, res, () => original(req, res, next));
}

// Serve the already-built Vite app from the same origin. The API remains guarded above.
const webRoot = join(process.cwd(), 'apps/web/dist');
if (existsSync(webRoot)) {
  app.use(express.static(webRoot, { index: 'index.html' }));
  app.get('*', (req: any, res: any, next: any) => {
    if (String(req.path || '').startsWith('/api/') || String(req.path || '').startsWith('/media/')) return next();
    return res.sendFile(join(webRoot, 'index.html'));
  });
}

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log('AI Creative Studio secure renderer listening on ' + port));
