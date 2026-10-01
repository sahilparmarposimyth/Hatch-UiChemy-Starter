import type { APIRoute } from 'astro';
import { WP_API_URL } from 'astro:env/server';
import { clientIpHeaders, redactToken, relaySessionCookie } from '@/lib/wp-auth';

/**
 * Same-origin login proxy.
 *
 * CLEAN-ROOM ORIGINAL. Zero lines copied from any external repo.
 * Forwards {username,password} to WP /hatch/v1/auth/login. Only the
 * `hatch_jwt` session cookie is relayed to the browser (see lib/wp-auth.ts):
 * WordPress's own login cookies are dropped on purpose, and the raw token is
 * stripped from the JSON body so script on the page can never read it.
 *
 * Administrators are refused by the plugin (403). Visitors only.
 */

export const prerender = false;

const WP_BASE = (WP_API_URL || '').replace(/\/wp\/v2\/?$/, '').replace(/\/$/, '');

function json(body: unknown, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!WP_BASE) return json({ message: 'Auth is not configured.' }, 503);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ message: 'Invalid request body.' }, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${WP_BASE}/hatch/v1/auth/login`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...clientIpHeaders(clientAddress),
        'User-Agent': request.headers.get('user-agent') || 'Hatch-Auth-Proxy/1.0',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json({ message: 'Could not reach the server. Try again.' }, 504);
  }

  const text = await upstream.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ message: 'Unexpected response.' }, 502); }

  // Administrator accounts are refused by the plugin on purpose. Say so in
  // plain words rather than showing a generic failure.
  const code = (body as { code?: string } | null)?.code;
  if (upstream.status === 403 && code === 'hatch_auth_admin_forbidden') {
    return json({ message: 'Administrator accounts cannot sign in here. Use the WordPress admin instead.' }, 403);
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  relaySessionCookie(upstream, headers, request.url);
  return new Response(JSON.stringify(redactToken(body)), { status: upstream.status, headers });
};
