export interface Env {
  APP_ENV: string;
  RENDER_ORIGIN: string;
  EDGE_SHARED_SECRET: string;
}

const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function securityHeaders(origin: string | null) {
  const headers = new Headers();
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
  headers.set('Access-Control-Expose-Headers', 'X-Request-Id, X-Editor-Preset, X-Rendered-Width, X-Rendered-Height');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return headers;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (!allowedMethods.has(request.method)) {
      return new Response('Method Not Allowed', { status: 405, headers: securityHeaders(origin) });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: securityHeaders(origin) });
    }

    if (!sameOrigin(request)) {
      const headers = securityHeaders(origin);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify({ error: 'cross_origin_request_blocked' }), { status: 403, headers });
    }

    const requestId = crypto.randomUUID();
    const upstream = new URL(env.RENDER_ORIGIN);
    upstream.pathname = new URL(request.url).pathname;
    upstream.search = new URL(request.url).search;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cookie');
    headers.delete('x-forwarded-for');
    headers.set('X-Request-Id', request.headers.get('X-Request-Id') || requestId);
    headers.set('X-Edge-Shared-Secret', env.EDGE_SHARED_SECRET);

    const response = await fetch(new Request(upstream, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual'
    }));

    const outHeaders = new Headers(response.headers);
    const security = securityHeaders(origin);
    for (const [key, value] of security) outHeaders.set(key, value);
    outHeaders.set('X-Request-Id', headers.get('X-Request-Id')!);
    outHeaders.delete('server');
    outHeaders.delete('via');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders
    });
  }
};
