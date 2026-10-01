/**
 * Password-protected post unlock helpers.
 *
 * The plugin swaps a post password for a short-lived signed token
 * (POST /hatch/v1/content/unlock). The token lives in an HttpOnly cookie on
 * THIS origin, one cookie per post, and is sent to WordPress as the
 * `X-Hatch-Post-Token` header when that post is fetched. The password itself
 * is never stored.
 *
 * Server-only.
 */

/** Cookie name for one post. Slugs are [a-z0-9-/]; anything else is dropped. */
export function unlockCookieName(slug: string): string {
  return 'hatch_pp_' + slug.toLowerCase().replace(/[^a-z0-9-]+/g, '_').slice(0, 120);
}

/** The visitor's unlock token for this post, or ''. */
export function getUnlockToken(request: Request, slug: string): string {
  const wanted = unlockCookieName(slug);
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === wanted) {
      const raw = part.slice(i + 1).trim();
      try { return decodeURIComponent(raw); } catch { return raw; }
    }
  }
  return '';
}

/**
 * Only same-site relative paths may be used as a post-unlock redirect, so the
 * form cannot be turned into an open redirect.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}

/** Where to send a visitor who needs to enter a post password. */
export function unlockUrl(slug: string, next: string): string {
  return `/unlock?slug=${encodeURIComponent(slug)}&next=${encodeURIComponent(safeNextPath(next))}`;
}
