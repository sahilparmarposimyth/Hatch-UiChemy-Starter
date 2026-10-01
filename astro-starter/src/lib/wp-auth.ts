/**
 * Visitor-session helpers for talking to the Hatch WordPress plugin.
 *
 * Security model (plugin audit C-2 / C-3):
 *
 *  - The WordPress JWT lives in an HttpOnly cookie on the ASTRO origin and is
 *    never readable by browser JS. Every server-side call to WordPress carries
 *    it as `Authorization: Bearer …`. Header auth is not CSRF-able, and it is
 *    the only way the plugin accepts a JWT on a state-changing request (a
 *    cookie JWT is honoured for GET only).
 *  - WordPress's own login cookies (`wordpress_logged_in_*` …) are never
 *    relayed to the browser and never forwarded back. They would put core's
 *    cookie auth in charge, and core drops the user when no `wp_rest` nonce
 *    accompanies the request.
 *  - Woo guest-cart cookies (`wp_woocommerce_session_*`, `woocommerce_*`) are
 *    NOT auth cookies and keep flowing both ways.
 *  - Administrators cannot sign in here: the plugin answers 403. That is
 *    intended; use wp-admin for admin work.
 *  - Tokens last 24 h and are revoked on logout. `/auth/refresh` rotates the
 *    token (the old one stops working immediately), so refresh from ONE place
 *    at a time; this starter does not refresh, a visitor simply signs in again.
 *
 * Server-only.
 */

export const SESSION_COOKIE = 'hatch_jwt';

/** Cookies that carry WordPress identity and must never cross the proxy. */
const IDENTITY_COOKIE = /^(hatch_jwt|wordpress_logged_in_|wordpress_sec_|wordpress_test_cookie|wp-settings-|wp-settings-time-)/i;

function parseCookieHeader(header: string): Array<[string, string]> {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): [string, string] => {
      const i = part.indexOf('=');
      return i === -1 ? [part, ''] : [part.slice(0, i), part.slice(i + 1)];
    });
}

/** The visitor's WordPress JWT from the session cookie, or ''. */
export function getSessionToken(request: Request): string {
  const header = request.headers.get('cookie') || '';
  for (const [name, value] of parseCookieHeader(header)) {
    if (name === SESSION_COOKIE) {
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return '';
}

/** `{ Authorization: 'Bearer …' }` for a signed-in visitor, else `{}`. */
export function sessionAuthHeaders(request: Request): Record<string, string> {
  const token = getSessionToken(request);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The incoming Cookie header minus every WordPress identity cookie. */
export function cookiesForWordPress(request: Request): string {
  return parseCookieHeader(request.headers.get('cookie') || '')
    .filter(([name]) => !IDENTITY_COOKIE.test(name))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Headers that tell WordPress who the visitor really is, so its per-IP rate
 * limits (login, registration, order lookup, comments, forms) bucket by
 * visitor and not by this server. The plugin only believes them when the site
 * owner enabled `hatch_trust_cf_ip` AND the request arrives from a Cloudflare
 * range, so sending them is always safe.
 */
export function clientIpHeaders(clientAddress: string | undefined): Record<string, string> {
  const ip = (clientAddress || '').trim();
  // Only forward something that is shaped like an IP address.
  if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return {};
  return { 'CF-Connecting-IP': ip, 'X-Forwarded-For': ip };
}

function splitSetCookie(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const out: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') out.push(value);
  });
  return out;
}

/**
 * Copy ONLY the session cookie from a WordPress auth response onto the
 * browser response: Domain stripped so it binds to the Astro origin, `Secure`
 * added whenever the visitor is on HTTPS (WordPress may be behind plain HTTP
 * and would not have set it).
 */
export function relaySessionCookie(upstream: Response, out: Headers, requestUrl: string): void {
  const https = new URL(requestUrl).protocol === 'https:';
  for (const raw of splitSetCookie(upstream)) {
    if (!raw.toLowerCase().startsWith(`${SESSION_COOKIE}=`)) continue;
    let cookie = raw.replace(/;\s*Domain=[^;]+/i, '');
    if (https && !/;\s*Secure/i.test(cookie)) cookie += '; Secure';
    out.append('set-cookie', cookie);
  }
}

/** A Set-Cookie value that clears the session cookie. */
export function clearSessionCookie(requestUrl: string): string {
  const https = new URL(requestUrl).protocol === 'https:';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${https ? '; Secure' : ''}`;
}

/** Expiry (unix seconds) read from a JWT's payload WITHOUT verifying it, or null. */
export function tokenExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = Number(JSON.parse(json)?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

/** The plugin allows a refresh only in the last 2 hours (7200 s); stay a little inside that. */
const REFRESH_WITHIN_S = 7000;
const refreshInFlight = new Map<string, Promise<string[]>>();

/**
 * Sliding session: when the visitor's token is in its last ~2 hours, trade it
 * for a fresh one and return the Set-Cookie value(s) to put on the response.
 *
 *  - Returns [] when nothing is due, when WordPress is unreachable, or on any
 *    error; a missed refresh only means the visitor signs in again later.
 *  - A token WordPress no longer accepts (revoked / signed out elsewhere) gets
 *    its cookie cleared so the visitor is not stuck holding a dead one.
 *  - The plugin rotates tokens and keeps the old one alive for ~30 s, so several
 *    tabs refreshing together all succeed. Concurrent requests in one server
 *    process share a single refresh call instead of each rotating the token.
 */
export function refreshSessionIfDue(request: Request, wpBase: string): Promise<string[]> {
  const token = getSessionToken(request);
  if (!token || !wpBase) return Promise.resolve([]);
  const exp = tokenExpiry(token);
  const left = exp === null ? Infinity : exp - Math.floor(Date.now() / 1000);
  if (left > REFRESH_WITHIN_S || left <= 0) return Promise.resolve([]);

  const existing = refreshInFlight.get(token);
  if (existing) return existing;

  const job = (async (): Promise<string[]> => {
    try {
      const res = await fetch(`${wpBase}/hatch/v1/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 401) return [clearSessionCookie(request.url)];
      if (!res.ok) return [];
      const out = new Headers();
      relaySessionCookie(res, out, request.url);
      return (out as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    } catch {
      return [];
    }
  })();

  refreshInFlight.set(token, job);
  // Keep the result around briefly so tabs that arrive just after still share it.
  setTimeout(() => refreshInFlight.delete(token), 60_000).unref?.();
  return job;
}

/**
 * Drop the raw JWT from an auth response body before it reaches browser JS.
 * The cookie already carries it, and a token in script-readable JSON is what
 * an XSS payload would steal.
 */
export function redactToken<T>(body: T): T {
  if (body && typeof body === 'object' && 'token' in (body as Record<string, unknown>)) {
    const { token: _token, ...rest } = body as Record<string, unknown>;
    return rest as T;
  }
  return body;
}
