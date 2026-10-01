import type { APIRoute } from 'astro';
import { WP_API_URL } from 'astro:env/server';
import { clientIpHeaders, cookiesForWordPress, sessionAuthHeaders } from '@/lib/wp-auth';

/**
 * Same-origin proxy for Hatch plugin REST routes (/hatch/v1/*).
 *
 * Mirrors the /api/wc-store/[...path].ts pattern so the browser talks to
 * the Astro origin only, no CORS surface. Used by /order-summary.astro to
 * hit /hatch/v1/order/{id}?key=X when Woo Store API's stricter guest
 * lookup returns 401 (Cart-Token expired or missing).
 *
 * @since 0.7.6
 */

export const prerender = false;

const WP_BASE = (WP_API_URL || '').replace(/\/wp-json(\/.*)?$/, '').replace(/\/$/, '');

const FORWARD_REQ_HEADERS = ['content-type', 'x-wp-nonce', 'accept'];

/**
 * Only what this site actually calls is reachable through the proxy: reading
 * one order by id. Everything else under /hatch/v1/ (settings, auth, deploy,
 * diagnostics) is deliberately NOT exposed on the public origin.
 */
const ALLOWED = /^order\/\d+$/;

async function proxy(request: Request, path: string | undefined, clientAddress?: string): Promise<Response> {
  if (!WP_BASE) {
    return new Response(JSON.stringify({ code: 'hatch_wp_api_url_missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const cleanPath = (path || '').replace(/^\/+/, '').replace(/\.\./g, '');
  if (request.method !== 'GET' || !ALLOWED.test(cleanPath)) {
    return new Response(JSON.stringify({ code: 'hatch_proxy_forbidden' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(request.url);
  const target = `${WP_BASE}/wp-json/hatch/v1/${cleanPath}${url.search}`;

  const outHeaders: Record<string, string> = {};
  for (const h of FORWARD_REQ_HEADERS) {
    const v = request.headers.get(h);
    if (v) outHeaders[h] = v;
  }
  const cookie = cookiesForWordPress(request);
  if (cookie) outHeaders['cookie'] = cookie;
  Object.assign(outHeaders, sessionAuthHeaders(request), clientIpHeaders(clientAddress));

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: outHeaders,
      body,
      redirect: 'manual',
    });
  } catch (err) {
    // WP down, DNS failure, timeout, network partition. Return structured
    // JSON so the client renderer shows a readable error instead of a
    // generic 500 stack trace.
    return new Response(
      JSON.stringify({ code: 'hatch_upstream_unreachable', message: String((err as Error).message || err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const resHeaders = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) resHeaders.set('content-type', ct);
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') resHeaders.append('set-cookie', value);
  });

  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}

export const GET: APIRoute = ({ request, params, clientAddress }) => proxy(request, params.path as string, clientAddress);
export const POST: APIRoute = ({ request, params, clientAddress }) => proxy(request, params.path as string, clientAddress);
export const PUT: APIRoute = ({ request, params, clientAddress }) => proxy(request, params.path as string, clientAddress);
export const DELETE: APIRoute = ({ request, params, clientAddress }) => proxy(request, params.path as string, clientAddress);
export const OPTIONS: APIRoute = ({ request, params, clientAddress }) => proxy(request, params.path as string, clientAddress);
