import crypto from 'node:crypto';

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

// The legacy server registers its routes during import. Wrap the existing layers so
// the guard is evaluated before every API handler without changing the legacy server.
const router = (app as any)._router;
if (!router?.stack) throw new Error('Express router stack is unavailable');
for (const layer of router.stack) {
  if (typeof layer.handle !== 'function') continue;
  const original = layer.handle;
  layer.handle = (req: any, res: any, next: any) => guard(req, res, () => original(req, res, next));
}

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log(`AI Creative Studio secure renderer listening on ${port}`));
