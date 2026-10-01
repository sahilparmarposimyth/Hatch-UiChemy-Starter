import type { APIRoute } from 'astro';
import { WP_API_URL } from 'astro:env/server';
import { clearSessionCookie, sessionAuthHeaders } from '@/lib/wp-auth';

/**
 * Same-origin logout proxy. Sends the session JWT to WordPress as a Bearer
 * header so the plugin can revoke it server-side (WP session + token id), then
 * always clears the cookie on this origin, even if WordPress is unreachable.
 * CLEAN-ROOM ORIGINAL. Zero lines copied from any external repo.
 */

export const prerender = false;

const WP_BASE = (WP_API_URL || '').replace(/\/wp\/v2\/?$/, '').replace(/\/$/, '');

function signedOut(requestUrl: string): Response {
  const h = new Headers({ 'Content-Type': 'application/json' });
  h.append('set-cookie', clearSessionCookie(requestUrl));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}

export const POST: APIRoute = async ({ request }) => {
  const auth = sessionAuthHeaders(request);
  if (!WP_BASE || !auth.Authorization) return signedOut(request.url);

  try {
    await fetch(`${WP_BASE}/hatch/v1/auth/logout`, {
      method: 'POST',
      headers: { Accept: 'application/json', ...auth },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* Revocation is best-effort; the visitor is signed out locally regardless. */
  }
  return signedOut(request.url);
};
