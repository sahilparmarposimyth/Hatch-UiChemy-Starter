/**
 * Which WP page is the site's front page, and what its URL should be.
 *
 * The starter shipped `/` as a hardcoded blog landing — site name, tagline,
 * three latest posts — which ignores WordPress entirely. A site whose home page
 * is a designed page (every UiChemy import) ended up with that page at `/home`
 * and a near-empty `/`: the root URL showed none of the design, and the nav's
 * "Home" link pointed at a second URL serving the same content.
 *
 * There are deliberately NO redirects in this design. `/` renders the front
 * page via `Astro.rewrite`, `/<slug>` keeps rendering it too, and links plus the
 * canonical are pointed at `/`. Redirecting `/<slug>` → `/` is the obvious move
 * and it is a trap: `Astro.rewrite()` re-runs middleware and route resolution on
 * some Astro versions, so `/` → rewrite `/home` → redirect `/` would ping-pong
 * forever. Rewrite one way only and the cycle cannot form.
 */
import { getPages } from './hatch';

/**
 * Slugs to treat as the front page when WordPress has not been told which page
 * is the front page (Settings → Reading still on "Your latest posts").
 *
 * Checked in order, so the more explicit names win. This is a convenience for
 * the common case of an imported design whose home page was never wired up in
 * Reading — WP's own setting always takes precedence when it is set.
 */
export const HOME_SLUG_FALLBACKS = [
	'home',
	'homepage',
	'home-page',
	'front-page',
	'landing-page',
	'landing',
];

/*
 * Memoised because this runs on `/` for every request and, in the fallback
 * path, costs a page listing. The TTL is short so setting a front page in WP
 * takes effect without a redeploy.
 */
const TTL_MS = 60 * 1000;
let cache: { slug: string; at: number } | null = null;

/**
 * Resolve the slug of the page that should render at `/`.
 *
 * @param features The /hatch/v1/features payload, which carries WP's own
 *                 `show_on_front` / `page_on_front` as `home.mode` and
 *                 `home.static_page_slug`.
 * @return The slug, or '' when the site really does want a posts homepage.
 */
export async function resolveFrontPageSlug( features: any ): Promise<string> {
	// 1. What WordPress itself says. Authoritative: if the owner set a static
	//    front page, that is the answer and no guessing is required.
	const home = features && features.home;
	if ( home && home.mode === 'page' ) {
		const configured = normaliseSlug( String( home.static_page_slug || '' ) );
		if ( configured ) return configured;
	}

	// 2. Nothing configured. Look for a conventionally-named page, in ONE
	//    request for the whole list rather than a probe per candidate name.
	if ( cache && Date.now() - cache.at < TTL_MS ) return cache.slug;

	let slug = '';
	try {
		const pages = await getPages();
		const have = new Set( pages.map( ( p ) => String( p.slug || '' ).toLowerCase() ) );
		for ( const candidate of HOME_SLUG_FALLBACKS ) {
			if ( have.has( candidate ) ) {
				slug = candidate;
				break;
			}
		}
	} catch {
		// A failed page listing must not take the homepage down with it. Fall
		// through to '' and let the posts landing render.
	}

	cache = { slug, at: Date.now() };
	return slug;
}

/** Strip surrounding slashes and lowercase. */
function normaliseSlug( raw: string ): string {
	return raw.replace( /^[/]+/, '' ).replace( /[/]+$/, '' ).toLowerCase();
}

/**
 * Only ever build a pattern out of a token that cannot contain regex syntax.
 *
 * WP sanitises slugs to this set already, and refusing anything else is safer
 * than escaping it: a slug is data, and data that reaches `new RegExp` is a way
 * to get either a broken pattern or a pathological one.
 */
const SAFE_TOKEN = /^[a-z0-9._~-]+$/;

/** Make `.` literal without needing a backslash escape. */
function literalDots( value: string ): string {
	return value.split( '.' ).join( '[.]' );
}

/**
 * Point links at `/` instead of the front page's own slug.
 *
 * The nav in an imported design lives in the page CONTENT, not in the Astro
 * header, so its "Home" link arrives as `href="/home"` (already relativised
 * server-side) or as an absolute URL on the site's own origin. Both are handled
 * here, which is why no redirect is needed for "Home" to land on `/`.
 *
 * Matches a whole path segment only: `/home` and `/home/` are rewritten, while
 * `/homes` and `/home-loans` are left alone.
 *
 * @param html      Rendered content HTML.
 * @param frontSlug Slug from resolveFrontPageSlug(); '' disables this entirely.
 * @param siteUrl   The site's own origin, so absolute self-links match too.
 */
export function rewriteFrontPageLinks( html: string, frontSlug: string, siteUrl = '' ): string {
	if ( ! html || ! frontSlug ) return html;

	const slug = normaliseSlug( frontSlug );
	if ( ! SAFE_TOKEN.test( slug ) ) return html;

	// Absolute self-links are matched by host, not by the whole URL string, so a
	// site reachable over both schemes still collapses to one target.
	let host = '';
	try {
		host = new URL( siteUrl ).host.toLowerCase();
	} catch {
		host = '';
	}
	if ( host && ! SAFE_TOKEN.test( host.split( ':' )[ 0 ] ) ) host = '';

	const targets = [ '/' + slug ];
	if ( host ) {
		targets.push( 'https://' + literalDots( host ) + '/' + slug );
		targets.push( 'http://' + literalDots( host ) + '/' + slug );
	}

	let out = html;
	for ( const target of targets ) {
		// Trailing group keeps a fragment or query intact, and requires the
		// segment to actually END here so /home-loans cannot match.
		const pattern = new RegExp( '(href=["\'])' + target + '[/]?(["\'#?])', 'gi' );
		out = out.replace( pattern, '$1/$2' );
	}

	return out;
}
