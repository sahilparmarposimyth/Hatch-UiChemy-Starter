/**
 * The allowlist the deployed frontend's image proxy is built with.
 *
 * `astro-starter/src/pages/img.ts` refuses to fetch an upstream image unless
 * its host is allowlisted — an SSRF guard, so the proxy cannot be pointed at
 * cloud metadata or an internal dashboard. It builds that list from three
 * things: the WP backend host, `PUBLIC_SITE_URL`, and a comma-separated
 * `PUBLIC_IMG_ALLOWED_HOSTS`.
 *
 * Nothing ever wrote that third one. So on every site deployed so far the list
 * held only the WP host, and a page whose images live on a template CDN — which
 * is every UiChemy import, since those never enter the WP media library — got
 * `400 {"error":"url host not allowed"}` for each one and rendered alt text.
 * This module is what fills it in.
 *
 * Two constraints worth knowing before editing the defaults:
 *
 * 1. **Exact hosts only.** `img.ts` matches with `hosts.has(host)`. A wildcard
 *    like `*.uichemy.com` is not a pattern there, it is a hostname that will
 *    never equal anything, so it fails silently. Every subdomain needs its own
 *    entry.
 * 2. **Build-time, not runtime.** `PUBLIC_`-prefixed vars are Vite's
 *    `envPrefix`, so `import.meta.env.PUBLIC_IMG_ALLOWED_HOSTS` is statically
 *    replaced during `npm run build` and frozen into the bundle. The broker
 *    ships prebuilt output, so setting this on the hosting provider after the
 *    fact does nothing — it has to be in the environment of the build.
 */

/**
 * Hosts a UiChemy-imported site actually serves images from, observed on a real
 * deploy (`/home` of an imported "Firm" template: 24 Webflow, 18 img-library,
 * 14 + 2 Lummi, 3 assets). All are public image CDNs reachable server-side with
 * no Referer, so allowing them costs nothing an attacker could not already do
 * by fetching them directly.
 *
 * This is a starting point, not a closed set — a customer can insert an image
 * from anywhere. Extend with HATCH_IMG_ALLOWED_HOSTS rather than editing here.
 */
export const DEFAULT_IMG_ALLOWED_HOSTS = [
	// UiChemy's own asset hosts.
	'assets.uichemy.com',
	'img-library.uichemy.com',
	// Webflow's CDN — UiChemy templates are authored against it.
	'cdn.prod.website-files.com',
	// Lummi, the stock imagery in the shipped templates.
	'assets.lummi.ai',
	'www.lummi.ai',
];

/**
 * Suffixes that never name a public image host, and that a cloud build can
 * often reach. A list rather than more regex, so each entry says out loud what
 * it is protecting against.
 */
const INTERNAL_SUFFIXES = [
	'.internal',     // GCP metadata (metadata.google.internal), AWS *.internal
	'.local',        // mDNS
	'.localhost',
	'.localdomain',
	'.intranet',
	'.corp',
	'.home',
	'.lan',
	'.arpa',         // home.arpa, and reverse DNS
	'.test',         // RFC 2606 reserved
	'.example',
	'.invalid',
];

/**
 * Reject anything that is not a plain, public hostname.
 *
 * The list is partly operator-supplied and is meant to also accept hosts named
 * by the WordPress site on the ticket. That second source is the customer's own
 * server, which is exactly the thing the SSRF guard exists to distrust: a
 * compromised install that could name `169.254.169.254` would turn the
 * frontend's proxy into a metadata reader. So the shape is checked here, at the
 * only point where an untrusted list can enter a build.
 */
function isPublicHostname( raw ) {
	const host = String( raw || '' ).trim().toLowerCase();
	if ( ! host ) return false;

	// A host, not a URL or a pattern. No scheme, path, port, credentials,
	// whitespace or comma — a comma would smuggle two entries through one.
	if ( /[^a-z0-9.-]/.test( host ) ) return false;
	if ( host.startsWith( '.' ) || host.endsWith( '.' ) ) return false;
	if ( host.includes( '..' ) ) return false;

	// Must look like a real public name: at least one dot and a letter TLD.
	// This also drops bare `localhost` and single-label internal names.
	if ( ! /^([a-z0-9-]+\.)+[a-z]{2,}$/.test( host ) ) return false;

	// Reject anything that resolves to a literal address, so no private or
	// link-local range can be reached. A dotted-quad fails the TLD test above,
	// but be explicit rather than relying on that.
	if ( /^\d+(\.\d+)*$/.test( host ) ) return false;

	// Special-use and internal suffixes. These pass the shape test above —
	// `metadata.google.internal` is a perfectly well-formed hostname — and are
	// exactly the targets worth reaching from inside a cloud build. `.arpa` is
	// here because `home.arpa` is the standard home-network zone and nothing
	// serves images out of reverse DNS.
	if ( INTERNAL_SUFFIXES.some( ( suffix ) => host.endsWith( suffix ) ) ) return false;

	return true;
}

/**
 * Build the value for PUBLIC_IMG_ALLOWED_HOSTS.
 *
 * Merges the defaults, the operator's HATCH_IMG_ALLOWED_HOSTS, and any hosts
 * the plugin named on the ticket, then dedupes and drops everything that is not
 * a public hostname. Returns a comma-separated string, ready to write into the
 * build environment.
 *
 * @param {object} [ticket]  The deploy ticket. `img_allowed_hosts` may be a
 *                           comma-separated string or an array; absent today,
 *                           accepted so the plugin can start sending it without
 *                           another broker change.
 * @return {string} Comma-separated hostnames.
 */
export function imgAllowedHosts( ticket = {} ) {
	const fromTicket = ticket && ticket.img_allowed_hosts;

	const candidates = [
		...DEFAULT_IMG_ALLOWED_HOSTS,
		...String( process.env.HATCH_IMG_ALLOWED_HOSTS || '' ).split( ',' ),
		...( Array.isArray( fromTicket ) ? fromTicket : String( fromTicket || '' ).split( ',' ) ),
	];

	const seen = new Set();
	for ( const candidate of candidates ) {
		const host = String( candidate || '' ).trim().toLowerCase();
		if ( isPublicHostname( host ) ) seen.add( host );
	}

	return [ ...seen ].join( ',' );
}
