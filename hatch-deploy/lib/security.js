/**
 * Security helpers for the deploy broker.
 *
 * What the broker handles (and therefore must protect):
 *   - the visitor's Cloudflare / Vercel API token
 *   - a read-only WordPress Application Password (service user `uichemy-deploy`)
 *   - the site's revalidation webhook secret
 *
 * Rules enforced here:
 *   1. /prepare input is validated: HTTPS only, no private/loopback targets
 *      (the build fetches wp_url, so an open /prepare would be an SSRF), no
 *      control characters (they would inject extra lines into the .env file),
 *      and return_url must be HTTPS and end in /wp-admin/admin-post.php.
 *   2. Secrets never reach a log line, a status response or an error message.
 *   3. Secrets are wiped from memory as soon as the build ends, and WordPress
 *      is told (HMAC-signed, server to server) whether the build succeeded so
 *      it can keep or revoke the credential without waiting for a browser.
 *   4. /prepare is rate limited per client and the ticket store is capped.
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

/** Set HATCH_ALLOW_INSECURE=1 ONLY for local development (http / localhost). */
export const ALLOW_INSECURE = process.env.HATCH_ALLOW_INSECURE === '1';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const TOKEN_CHARS = /^[A-Za-z0-9_.:\-]+$/;

// ---------------------------------------------------------------- response headers

/** Express middleware: headers that matter for pages carrying one-time tickets. */
export function securityHeaders(req, res, next) {
	res.set('X-Content-Type-Options', 'nosniff');
	// The ticket id is in the URL. Without this it leaks via Referer to every
	// external link on the page (including the live-site link shown on success).
	res.set('Referrer-Policy', 'no-referrer');
	if (req.path.startsWith('/deploy/')) {
		res.set('Cache-Control', 'no-store');
	}
	next();
}

// ---------------------------------------------------------------- network targets

function isPrivateIPv4(ip) {
	const [a, b] = ip.split('.').map(Number);
	return (
		a === 0 || a === 10 || a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||     // CGNAT
		(a === 169 && b === 254) ||               // link-local / cloud metadata
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0) ||
		a >= 224                                   // multicast / reserved
	);
}

function isPrivateIPv6(ip) {
	const v = ip.toLowerCase();
	if (v === '::1' || v === '::') return true;
	if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true; // fe80::/10
	if (v.startsWith('fc') || v.startsWith('fd')) return true;                                                  // fc00::/7
	const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	return mapped ? isPrivateIPv4(mapped[1]) : false;
}

export function isPrivateAddress(ip) {
	if (net.isIPv4(ip)) return isPrivateIPv4(ip);
	if (net.isIPv6(ip)) return isPrivateIPv6(ip);
	return true; // not an IP at all: treat as unsafe
}

/** True when `host` is, or resolves to, anything but a public address. */
export async function resolvesToPrivate(host) {
	const bare = host.replace(/^\[|\]$/g, '');
	if (net.isIP(bare)) return isPrivateAddress(bare);
	const h = bare.toLowerCase();
	if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
	try {
		const addrs = await dns.lookup(h, { all: true });
		return addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address));
	} catch {
		return true; // does not resolve: the build could not reach it anyway
	}
}

// ---------------------------------------------------------------- /prepare validation

function str(v) {
	return typeof v === 'string' ? v : '';
}

/**
 * Validate a /prepare body. Returns `{ ok: true, value }` with normalised
 * fields, or `{ ok: false, error, detail }`.
 *
 * @param {object} b          Request body.
 * @param {string} tokenKey   'vercel_token' | 'cf_token'.
 */
export async function validatePrepare(b, tokenKey) {
	const fail = (error, detail) => ({ ok: false, error, detail });

	const wpUser = str(b.wp_user);
	const wpPass = str(b.wp_pass);
	const secret = str(b.webhook_secret);
	const wpUrlRaw = str(b.wp_url);
	const returnRaw = str(b.return_url);
	const token = str(b[tokenKey]).trim();

	for (const [name, value] of [['wp_user', wpUser], ['wp_pass', wpPass], ['webhook_secret', secret], ['wp_url', wpUrlRaw], ['return_url', returnRaw]]) {
		if (!value) return fail('missing_fields', name);
		if (CONTROL_CHARS.test(value)) return fail('invalid_characters', name);
	}
	if (wpUser.length > 100 || wpPass.length > 200 || wpUrlRaw.length > 300 || returnRaw.length > 1000) return fail('field_too_long');
	if (secret.length < 32 || secret.length > 200) return fail('invalid_webhook_secret', 'must be 32-200 characters');
	if (token.length < 20 || token.length > 500 || !TOKEN_CHARS.test(token)) return fail('missing_or_invalid_token', tokenKey);

	let wp;
	let ret;
	try { wp = new URL(wpUrlRaw); ret = new URL(returnRaw); } catch { return fail('invalid_url'); }

	const okProtocol = (u) => u.protocol === 'https:' || (ALLOW_INSECURE && u.protocol === 'http:');
	if (!okProtocol(wp) || !okProtocol(ret)) return fail('https_required');
	if (wp.username || wp.password || wp.search || wp.hash) return fail('invalid_url', 'wp_url must be a plain site address');
	// return_url is only ever used for the visitor's browser redirect back to wp-admin, and
	// admin_url() may legitimately differ from wp_url (public-URL override, tunnels), so the
	// host is not pinned; the path is.
	if (!ret.pathname.endsWith('/wp-admin/admin-post.php')) return fail('return_url_mismatch', 'unexpected return_url path');

	if (!ALLOW_INSECURE && (await resolvesToPrivate(wp.hostname))) {
		return fail('private_address', 'wp_url must be a publicly reachable site');
	}

	return {
		ok: true,
		value: {
			wp_url: wp.origin + wp.pathname.replace(/\/+$/, ''),
			wp_user: wpUser,
			wp_pass: wpPass,
			webhook_secret: secret,
			return_url: ret.toString(),
			token,
		},
	};
}

// ---------------------------------------------------------------- rate limiting

/**
 * Fixed-window limiter keyed by an arbitrary string (client IP).
 * @returns {(key: string) => boolean} true when the call is allowed.
 */
export function createRateLimiter({ max, windowMs }) {
	const hits = new Map();
	setInterval(() => {
		const cutoff = Date.now() - windowMs;
		for (const [k, v] of hits) if (v.start < cutoff) hits.delete(k);
	}, windowMs).unref();
	return (key) => {
		const now = Date.now();
		const rec = hits.get(key);
		if (!rec || now - rec.start >= windowMs) {
			hits.set(key, { start: now, count: 1 });
			return true;
		}
		rec.count += 1;
		return rec.count <= max;
	};
}

// ---------------------------------------------------------------- redaction

/** Returns a function replacing every secret value in a string with ***. */
export function makeRedactor(values) {
	const secrets = values.filter((v) => typeof v === 'string' && v.length >= 6);
	return (text) => secrets.reduce((t, s) => t.split(s).join('***'), String(text ?? ''));
}

// ---------------------------------------------------------------- result validation

/** The live-site URL is shown as a link and sent back to WordPress: https only. */
export function safeProjectUrl(url) {
	try {
		const u = new URL(String(url));
		if (u.protocol !== 'https:' || u.username || u.password) return null;
		return u.origin;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- WordPress notification

/**
 * Tell WordPress, server to server, how the build ended, so it can keep the
 * deploy credential (success: the live site runs on it) or revoke it (failure)
 * even if the visitor closed the tab. HMAC-SHA256 over the ticket, status,
 * provider and timestamp with the webhook secret; WordPress refuses anything
 * older than five minutes or signed with a different secret.
 *
 * Best effort: WordPress also revokes unconfirmed credentials after 16 minutes.
 *
 * @returns {Promise<boolean>} whether WordPress acknowledged.
 */
export async function notifyWordPress({ wpUrl, secret, ticketId, status, provider }) {
	if (!wpUrl || !secret) return false;
	const ts = String(Math.floor(Date.now() / 1000));
	const sig = crypto.createHmac('sha256', secret).update(`finished|${ticketId}|${status}|${provider}|${ts}`).digest('hex');
	const body = JSON.stringify({ ticket: ticketId, status, provider, ts, sig });
	const urls = [`${wpUrl}/wp-json/hatch/v1/deploy/finished`, `${wpUrl}/?rest_route=/hatch/v1/deploy/finished`];
	for (const url of urls) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body,
				redirect: 'manual',
				signal: AbortSignal.timeout(10_000),
			});
			if (res.ok) return true;
			if (![301, 302, 404].includes(res.status)) return false; // a real answer (403 etc): do not retry
		} catch {
			/* try the next form */
		}
	}
	return false;
}

// ---------------------------------------------------------------- startup checks

/**
 * Misconfigurations that are safe on a developer machine and dangerous in
 * production. Returned as plain sentences; the server logs them at boot.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function productionWarnings(env) {
	const warnings = [];
	if (env.HATCH_ALLOW_INSECURE === '1') {
		warnings.push('HATCH_ALLOW_INSECURE=1 allows http:// and private addresses (SSRF). Never set it in production.');
	}
	const production = env.NODE_ENV === 'production' || env.HATCH_ALLOW_INSECURE !== '1';
	if (!production) return warnings;
	if (env.HATCH_TRUST_PROXY !== '1') {
		warnings.push('HATCH_TRUST_PROXY is not 1. Behind nginx/RunCloud every client shares the proxy\'s address, so the /prepare rate limit throttles everyone together.');
	}
	const branch = env.HATCH_BRANCH || 'main';
	if (['main', 'master', 'develop', 'dev'].includes(branch)) {
		warnings.push(`HATCH_BRANCH is "${branch}", a moving branch: every deploy builds whatever was pushed last. Pin it to a release tag.`);
	}
	if (!env.HATCH_VERCEL_CLI_VERSION) warnings.push('HATCH_VERCEL_CLI_VERSION is not set; the Vercel CLI is installed as "latest" on every build.');
	if (!env.HATCH_WRANGLER_VERSION) warnings.push('HATCH_WRANGLER_VERSION is not set; wrangler is installed as "latest" on every build.');
	return warnings;
}

// ---------------------------------------------------------------- build environment

const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP', 'SHELL', 'TERM', 'CI', 'NODE_OPTIONS', 'SystemRoot', 'ComSpec', 'PATHEXT'];

/**
 * Environment for a build subprocess: a short allowlist of the broker's own
 * variables plus whatever the step explicitly needs. `npm install` runs
 * third-party lifecycle scripts, so it must not inherit the broker's secrets.
 */
export function buildEnv(extra = {}) {
	const out = {};
	for (const k of ENV_ALLOWLIST) {
		if (process.env[k] !== undefined) out[k] = process.env[k];
	}
	for (const k of Object.keys(process.env)) {
		if (k.startsWith('npm_config_') || k.startsWith('NPM_CONFIG_')) out[k] = process.env[k];
	}
	return { ...out, ...extra };
}
