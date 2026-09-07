/**
 * Thin wrapper around the new-dashboard REST API + AJAX endpoints +
 * the global boot payload (`window.uich_nd_boot`) injected by
 * class-uich-nd-enqueue.php.
 */

const FALLBACK_BOOT = {
  mountId: 'uich-new-dash',
  restRoot: '',
  restNonce: '',
  ajaxUrl: '',
  ajaxNonce: '',
  siteName: '',
  siteUrl: '',
  restUrl: '',
  connectUrl: '',
  state: { env: {}, builders: {}, builder: '', mode: '', onboarded: false, appPassword: {}, localEnv: { available: false, current: 'production', snippet: '' }, uichemy: { installed: false, active: false, file: '', version: '' } },
  auth: { isAuthed: false, logoutNonce: '', licenseData: null, capacity: { plan: '', purchased: true } },
  user: { isAdmin: false },
  urls: {},
};

export function getBoot() {
  return (typeof window !== 'undefined' && window.uich_nd_boot) || FALLBACK_BOOT;
}

export function useBoot() {
  return getBoot();
}

/**
 * Force a WordPress-built absolute URL onto the CURRENT browser origin.
 *
 * WP builds REST / admin-ajax URLs from the saved home/siteurl option. On some
 * setups, notably a LocalWP site opened on its raw `:PORT` while siteurl is the
 * portless router domain, that origin differs from the one the admin is
 * actually browsing. A fetch to WP's URL is then CROSS-origin, so
 * `credentials: 'same-origin'` drops the auth cookie and the request 401s –
 * which made the dashboard wrongly report "REST API is blocked". Every endpoint
 * the dashboard calls is same-site, so retarget it to the live origin (the REST
 * nonce is tied to the user session, not the origin, so it stays valid).
 */
function sameOrigin(absUrl) {
  if (typeof window === 'undefined' || !absUrl) return absUrl;
  try {
    const u = new URL(absUrl, window.location.href);
    u.protocol = window.location.protocol;
    u.host = window.location.host; // host = hostname + port
    return u.toString();
  } catch (_) {
    return absUrl;
  }
}

/**
 * Is an AI Website Creator account connected to this site?
 *
 * Signing in is OPTIONAL: the Figma plugin and the AI Agent (MCP) run on the
 * site's own Application Password and never touch this. Only the AI Website
 * Creator needs an account, so this flag drives that tab's own connect card and
 * the rail's "Activate" button — it is not an app-wide gate any more.
 */
export function isAuthed() {
  return !!getBoot()?.auth?.isAuthed;
}

/**
 * Mint an OAuth authorization URL for the AI Website Creator sign-in and return
 * it. The caller navigates to it — a full-page redirect, since the flow leaves
 * WordPress entirely and comes back through the plugin's admin-page callback.
 *
 * The endpoint lives in the `uichemy/v2/webpage` namespace rather than this
 * dashboard's own: the OAuth client is shared with the Import tab, which is what
 * makes one sign-in cover both (see class-uich-nd-auth.php).
 *
 * Minted on click, never shipped in the boot payload — every call rotates the
 * server-side PKCE verifier, so minting one on page load would invalidate a flow
 * already in progress.
 *
 * @param {string} route Dashboard hash route to come back to, e.g.
 *                       '#/ai-website'. Server-side allow-listed (see
 *                       Uich_Webpage_Auth::RETURN_ROUTES); '' = dashboard root.
 */
export async function getAuthorizeUrl(route = '') {
  const boot = getBoot();
  // `restUrl` is rest_url(): ".../wp-json/" on pretty permalinks, but
  // ".../?rest_route=/" on plain ones. Trimming the trailing slash leaves a
  // valid prefix for both, since the route path starts with one.
  const root = sameOrigin((boot.restUrl || '').replace(/\/$/, ''));
  if (!root) throw new Error('REST URL is not configured');

  // rest_url() already carries a query string on plain permalinks
  // (?rest_route=/…), so pick the separator instead of assuming '?'.
  const sep = root.includes('?') ? '&' : '?';
  const url = `${root}/uichemy/v2/webpage/auth/authorize-url`
    + (route ? `${sep}route=${encodeURIComponent(route)}` : '');

  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'X-WP-Nonce': boot.restNonce },
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json || typeof json.authorization_url !== 'string' || !json.authorization_url) {
    throw new Error((json && (json.error || json.message)) || 'Could not start the sign-in. Please try again.');
  }
  return json.authorization_url;
}

/**
 * Start the sign-in: mint the authorization URL and leave WordPress for it.
 *
 * The one entry point every "Activate / Sign in" affordance shares (the rail
 * button, the AI Website Creator's connect card), so the PKCE handshake is set
 * up identically wherever the user starts from. Resolves only on failure — on
 * success the browser has already navigated away.
 *
 * @param {string} route Hash route to return to once connected.
 */
export async function startSignIn(route = '') {
  window.location.href = await getAuthorizeUrl(route);
}

/**
 * Hard sign-out. Clears the stored OAuth tokens on the server (via the logout
 * AJAX) and reloads, so the app falls back to the login screen. Triggered
 * automatically when the API rejects our token with a 401.
 */
let signingOut = false;
export async function signOut() {
  if (signingOut) return;
  signingOut = true;
  const boot = getBoot();
  try {
    const form = new URLSearchParams();
    form.set('action', 'uich_nd_sso_logout');
    form.set('nonce', boot?.auth?.logoutNonce || '');
    await fetch(sameOrigin(boot.ajaxUrl), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form.toString(),
    });
  } catch (_) { /* sign out locally regardless of the network result */ }
  if (typeof window !== 'undefined') window.location.reload();
}

/** REST request (namespace uichemy/v2/nd). */
export async function request(path, { method = 'GET', body } = {}) {
  const boot = getBoot();
  const url = sameOrigin(boot.restRoot.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  const headers = { 'X-WP-Nonce': boot.restNonce, 'Content-Type': 'application/json' };
  const opts = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    let message;
    try {
      const json = await res.json();
      message = json?.error || json?.message || json?.data?.message;
    } catch (_) { /* ignore parse failure */ }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json();
}

/**
 * Validate the current SSO session. Calls our own WordPress endpoint
 * (same-origin, so no CORS) which proxies to the UiChemy API server-side
 * with the bearer token. Runs on every dashboard visit. A 401 means the
 * token is no longer valid → sign the user out and bounce them to login.
 */
export async function getSession() {
  const boot = getBoot();
  const url = sameOrigin(boot.restRoot.replace(/\/$/, '') + '/licenses/user');
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { 'X-WP-Nonce': boot.restNonce, 'Accept': 'application/json' },
  });
  if (res.status === 401) {
    signOut();
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`licenses/user failed (${res.status})`);
  return res.json().catch(() => null);
}

/**
 * REST request against the WP REST root, for endpoints outside the
 * `uichemy/v2/nd` namespace, like the `uichemy/v2/system/plugin/*`
 * handlers used by the wizard's install/activate flow.
 *
 * `path` is appended verbatim to `boot.restUrl`, so pass the full
 * namespaced route, e.g. `requestRoot('uichemy/v2/system/plugin/install', ...)`.
 */
export async function requestRoot(path, { method = 'GET', body } = {}) {
  const boot = getBoot();
  // `restUrl` is the REST root, `restRoot` is the nd sub-namespace –
  // fall back to deriving root from restRoot if the older boot payload
  // doesn't carry restUrl.
  const root = boot.restUrl || boot.restRoot.replace(/uichemy\/v2\/nd\/?$/, '');
  const url  = sameOrigin(root.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  const headers = { 'X-WP-Nonce': boot.restNonce, 'Content-Type': 'application/json' };
  const opts = { method, headers, credentials: 'same-origin' };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json && (json.message || json.reason)) || `API ${method} ${path} failed (${res.status})`;
    throw new Error(message);
  }
  return json;
}

/**
 * AJAX (admin-ajax.php) wrapper for the uich_nd_* actions registered by
 * Uich_ND_App_Password. WordPress's admin-ajax expects form-encoded POST
 * with `action` + `nonce` + the rest of the payload.
 *
 * Returns the unwrapped `data` payload on success, throws a normalised
 * error on failure (`code` / `message` / `status`).
 */
export async function ajax(action, payload = {}) {
  const boot = getBoot();
  const form = new URLSearchParams();
  form.set('action', action);
  form.set('nonce', boot.ajaxNonce);
  for (const [k, v] of Object.entries(payload)) form.set(k, v == null ? '' : String(v));

  const res = await fetch(sameOrigin(boot.ajaxUrl), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: form.toString(),
  });
  let json;
  try { json = await res.json(); } catch (_) { json = null; }
  if (!res.ok || !json || json.success === false) {
    const data = (json && json.data) || {};
    const err = new Error(data.message || `AJAX ${action} failed (${res.status})`);
    err.code = data.code || 'ajax_error';
    err.status = res.status;
    throw err;
  }
  return json.data;
}

/** Copy to clipboard with a navigator fallback. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through */ }
  // Legacy fallback for http localhost.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

/** Read a query-param off the current URL (used for QA preview routes). */
export function getQuery(name) {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  } catch (_) { return null; }
}

/**
 * Is a query-param PRESENT on the current URL, whatever its value?
 *
 * Needed for valueless flags like `&onboard`: `searchParams.get('onboard')`
 * answers `''` for those, which is falsy, so getQuery() can't tell "flag is
 * set" from "flag is absent". This can.
 */
export function hasQuery(name) {
  try {
    return new URL(window.location.href).searchParams.has(name);
  } catch (_) { return false; }
}
