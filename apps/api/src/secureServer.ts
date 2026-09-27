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

app.use((req, res, next) => {
  // Health remains public so the platform can monitor the service.
  if (req.path === '/api/health') return next();
  const supplied = String(req.header('x-edge-shared-secret') || '');
  if (!safeEqual(supplied, expected)) return res.status(403).json({ error: 'renderer_access_denied' });
  return next();
});

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log(`AI Creative Studio secure renderer listening on ${port}`));
