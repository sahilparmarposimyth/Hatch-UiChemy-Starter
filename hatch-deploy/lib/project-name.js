/**
 * What the deployed Vercel project should be called.
 *
 * The CLI is run as `vercel deploy --prebuilt --prod --yes` with no `--name`
 * and nothing linking it to an existing project, so it names the project after
 * the DIRECTORY it is invoked in. That directory was always `astro-starter`,
 * and because the name is taken after the first deploy, Vercel appends a random
 * word — which is where `astro-starter-murex` and `astro-starter-snowy` came
 * from. Unhelpful when you have several sites and no way to tell which URL
 * belongs to which.
 *
 * So the plugin sends the WordPress site name, and the build directory is named
 * after it. `Fitness` deploys to `fitness.vercel.app` instead of a colour.
 *
 * Two honest limits:
 *
 * 1. This does NOT guarantee a stable URL across redeploys. Nothing here links
 *    to an existing project, so whether a second deploy reuses `fitness` or
 *    becomes `fitness-xyz` is the CLI's decision, not ours. A custom domain is
 *    still the answer for a URL that must not move.
 * 2. It only takes effect on a broker running this code. A broker that does not
 *    read `project_name` off the ticket ignores it and keeps naming projects
 *    after its own build directory.
 */

/**
 * The longest project name to ask for.
 *
 * Vercel allows up to 100 characters, but the name becomes the hostname and
 * gets suffixes appended (`-git-branch`, `-hash`, the disambiguating word), and
 * a DNS label caps at 63. Cutting our own contribution well short of that keeps
 * the generated URLs inside the limit with room to spare.
 */
const MAX_LENGTH = 48;

/** Used when the site name yields nothing usable. The historical behaviour. */
export const FALLBACK_PROJECT_NAME = 'astro-starter';

/**
 * Turn a WordPress site name into something Vercel will accept as a project
 * name, and something that reads as a hostname.
 *
 * Vercel project names are lowercase, and permit letters, digits and hyphens.
 * Anything else — spaces, apostrophes, em-dashes, emoji, non-Latin script — is
 * collapsed to a hyphen rather than stripped, so "Posimyth — Fitness" becomes
 * `posimyth-fitness` rather than `posimythfitness`.
 *
 * Returns '' when nothing usable survives, so the caller can decide whether to
 * fall back or to leave the directory alone. A site named entirely in a
 * non-Latin script is the realistic case for that, and inventing a
 * transliteration would be worse than keeping the old default.
 *
 * @param {string} raw The site name, as WordPress reports it.
 * @return {string} A safe project name, or '' if none.
 */
export function slugifyProjectName( raw ) {
	let slug = String( raw == null ? '' : raw )
		.normalize( 'NFKD' )          // é → e + combining accent
		.replace( /[̀-ͯ]/g, '' ) // drop the combining marks
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )     // everything else becomes a separator
		.replace( /-+/g, '-' )             // no runs of separators
		.replace( /^-+|-+$/g, '' );        // and none at either end

	if ( slug.length > MAX_LENGTH ) {
		// Trim on a hyphen boundary when there is one nearby, so the name does
		// not end mid-word.
		slug = slug.slice( 0, MAX_LENGTH ).replace( /-+[^-]*$/, '' ) || slug.slice( 0, MAX_LENGTH );
		slug = slug.replace( /^-+|-+$/g, '' );
	}

	// A name that is only digits reads as an accident and collides easily.
	if ( /^\d+$/.test( slug ) ) return '';

	return slug;
}

/**
 * The directory name to build in, for a given ticket.
 *
 * @param {object} ticket Deploy ticket. `project_name` is optional — a broker
 *                        older than the plugin simply never receives it.
 * @return {string} A safe project name; FALLBACK_PROJECT_NAME when the ticket
 *                 names nothing usable.
 */
export function projectNameFor( ticket ) {
	const slug = slugifyProjectName( ticket && ticket.project_name );
	return slug || FALLBACK_PROJECT_NAME;
}
