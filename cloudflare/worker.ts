export interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  RENDER_API_ORIGIN?: string;
  EDGE_SHARED_SECRET?: string;
}

const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function cors(origin: string | null) {
  const headers = new Headers();
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
  headers.set('Access-Control-Expose-Headers', 'X-Request-Id, X-Editor-Preset, X-Rendered-Width, X-Rendered-Height');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  return headers;
}

function requestId() {
  return crypto.randomUUID();
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function capabilityResponse(request: Request, env: Env) {
  const headers = cors(request.headers.get('Origin'));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({
    ok: true,
    mode: 'browser-first',
    localEditing: true,
    localRendering: true,
    referenceAnalysis: 'progressive',
    remoteRendering: Boolean(env.RENDER_API_ORIGIN),
    privacy: 'media stays in the browser unless the user explicitly starts a remote render or provider request',
  }), { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (!allowedMethods.has(request.method)) return new Response('Method Not Allowed', { status: 405, headers: cors(origin) });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    if (!isSameOrigin(request)) {
      return new Response(JSON.stringify({ error: 'cross_origin_request_blocked' }), {
        status: 403,
        headers: { ...Object.fromEntries(cors(origin)), 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/capabilities') return capabilityResponse(request, env);

    if (url.pathname.startsWith('/api/')) {
      if (!env.RENDER_API_ORIGIN) {
        return new Response(JSON.stringify({ error: 'renderer_not_configured' }), {
          status: 503,
          headers: { ...Object.fromEntries(cors(origin)), 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname !== '/api/health' && !request.headers.get('Authorization')) {
        return new Response(JSON.stringify({ error: 'authentication_required' }), {
          status: 401,
          headers: { ...Object.fromEntries(cors(origin)), 'Content-Type': 'application/json' },
        });
      }

      const upstream = new URL(env.RENDER_API_ORIGIN);
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('cookie');
      headers.delete('x-forwarded-for');
      headers.set('X-Request-Id', request.headers.get('X-Request-Id') || requestId());
      if (env.EDGE_SHARED_SECRET) headers.set('X-Edge-Shared-Secret', env.EDGE_SHARED_SECRET);

      const response = await fetch(new Request(upstream, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual'
      }));

      const outHeaders = new Headers(response.headers);
      const security = cors(origin);
      for (const [key, value] of security) outHeaders.set(key, value);
      outHeaders.set('X-Request-Id', headers.get('X-Request-Id')!);
      outHeaders.delete('server');
      outHeaders.delete('via');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outHeaders });
    }

    return env.ASSETS.fetch(request);
  }
};
