import type { APIRoute } from 'astro';
import { WP_API_URL } from 'astro:env/server';
import { clientIpHeaders } from '@/lib/wp-auth';
import { unlockCookieName } from '@/lib/unlock';

/**
 * Same-origin unlock proxy for password-protected posts.
 *
 * Exchanges {slug, password} for a signed token via the plugin's
 * POST /hatch/v1/content/unlock and stores it in an HttpOnly cookie scoped to
 * that one post. The token is NOT returned in the response body, so page
 * script can never read it. Astro's checkOrigin guard covers CSRF on this POST.
 */

export const prerender = false;

const WP_BASE = (WP_API_URL || '').replace(/\/wp\/v2\/?$/, '').replace(/\/$/, '');

function json(body: unknown, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!WP_BASE) return json({ ok: false, message: 'Unlocking is not configured.' }, 503);

  let payload: { slug?: unknown; password?: unknown };
  try { payload = await request.json(); } catch { return json({ ok: false, message: 'Invalid request.' }, 400); }
  const slug = typeof payload.slug === 'string' ? payload.slug : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  if (!slug || !password) return json({ ok: false, message: 'Enter the password.' }, 400);

  let upstream: Response;
  try {
    upstream = await fetch(`${WP_BASE}/hatch/v1/content/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...clientIpHeaders(clientAddress) },
      body: JSON.stringify({ slug, password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json({ ok: false, message: 'Could not reach the server. Try again.' }, 504);
  }

  const data = (await upstream.json().catch(() => null)) as { token?: string; expires_in?: number; message?: string; code?: string } | null;
  if (!upstream.ok || !data?.token) {
    const status = upstream.status === 429 ? 429 : 403;
    return json({ ok: false, message: status === 429 ? 'Too many attempts. Try again in a few minutes.' : 'Incorrect password.' }, status);
  }

  const https = new URL(request.url).protocol === 'https:';
  const maxAge = Math.max(60, Math.min(Number(data.expires_in) || 86400, 86400));
  const cookie = `${unlockCookieName(slug)}=${encodeURIComponent(data.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
};
