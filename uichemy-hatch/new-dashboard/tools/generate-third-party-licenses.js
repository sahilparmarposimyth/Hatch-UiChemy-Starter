#!/usr/bin/env node
/**
 * Generate THIRD-PARTY-LICENSES.txt at the plugin root.
 *
 * WHY. The shipped bundles under new-dashboard/build/ inline third-party npm
 * code (MIT, ISC, Apache-2.0 …). Those licences require their copyright and
 * permission notices to travel with the code, and webpack emits no notice of
 * its own here: most modern packages ship no `@license` banner in their dist
 * files, so Terser's comment extraction finds nothing to extract. Without this
 * file the release carries the code and not the notices.
 *
 * METHOD. The package list is derived from the ACTUAL build, not from
 * package.json. `wp-scripts build --json` is run and every
 * `node_modules/<pkg>` path in the module graph is collected. This matters for
 * accuracy in both directions:
 *   - react, react-dom and @wordpress/* are externalised by wp-scripts (mapped
 *     to window.React / wp.i18n and declared in *.asset.php), so they are NOT
 *     bundled and must not be claimed here;
 *   - @babel/core and the presets are build-time only and never reach output;
 *   - but @babel/runtime helpers ARE inlined, and transitive packages nobody
 *     listed in package.json are too.
 * Only what the bundler actually emitted gets listed.
 *
 * Run via `npm run licenses`. Also run by scripts/build.sh before packaging,
 * so the shipped file can never drift from the shipped bundles.
 */

'use strict';

const { execFileSync } = require( 'child_process' );
const fs = require( 'fs' );
const path = require( 'path' );

const PROJECT_DIR = path.resolve( __dirname, '..' );          // new-dashboard/
const PLUGIN_ROOT = path.resolve( PROJECT_DIR, '..' );        // plugin root
const OUT_FILE = path.join( PLUGIN_ROOT, 'THIRD-PARTY-LICENSES.txt' );
const BUNDLE_DIR = path.relative( PLUGIN_ROOT, path.join( PROJECT_DIR, 'build' ) );

const LICENSE_FILE_RE = /^(licen[cs]e|copying|notice)(\..*)?$/i;

/** Run the real build and return webpack's stats object. */
function getStats() {
	// --json sends stats to stdout; a large graph needs a generous buffer.
	const raw = execFileSync(
		'npx',
		[ 'wp-scripts', 'build', '--json' ],
		{ cwd: PROJECT_DIR, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' }
	);

	// Guard against any pre-JSON noise on stdout.
	const start = raw.indexOf( '{' );
	if ( start === -1 ) {
		throw new Error( 'wp-scripts build --json produced no JSON on stdout.' );
	}
	return JSON.parse( raw.slice( start ) );
}

/**
 * Collect package names from every node_modules path in the module graph.
 * Handles scopes (@scope/name) and nested node_modules (deepest wins, which is
 * the copy actually resolved and therefore the one whose licence applies).
 */
function collectPackages( stats ) {
	const names = new Set();

	const visit = ( mods ) => {
		if ( ! Array.isArray( mods ) ) {
			return;
		}
		for ( const mod of mods ) {
			const raw = mod.identifier || mod.name || '';

			// Strip webpack loader prefixes. An identifier looks like
			//   /…/node_modules/babel-loader/lib/index.js??ruleSet!/…/src/x.js
			// and only the part after the last "!" is the module that actually
			// ends up in the bundle. Without this, every loader in the chain
			// (babel-loader, css-loader, sass-loader …) is misreported as a
			// bundled dependency, which it is not — loaders transform code at
			// build time and are never inlined. A loader that genuinely ships a
			// runtime (css-loader/dist/runtime/*) still appears, correctly, as
			// its own prefix-free module.
			const id = raw.split( '!' ).pop();

			// Take the LAST node_modules segment — the resolved copy.
			const idx = id.lastIndexOf( 'node_modules/' );
			if ( idx !== -1 ) {
				const rest = id.slice( idx + 'node_modules/'.length ).split( '?' )[ 0 ];
				const parts = rest.split( '/' );
				const name = parts[ 0 ].startsWith( '@' )
					? parts.slice( 0, 2 ).join( '/' )
					: parts[ 0 ];
				if ( name && ! name.startsWith( '.' ) ) {
					names.add( name );
				}
			}
			// Concatenated/split chunks nest their constituent modules.
			visit( mod.modules );
		}
	};

	visit( stats.modules );
	for ( const child of stats.children || [] ) {
		visit( child.modules );
	}

	return [ ...names ].sort();
}

/** Read name/version/licence and the full licence text for one package. */
function describe( name ) {
	const dir = path.join( PROJECT_DIR, 'node_modules', name );
	const pkgFile = path.join( dir, 'package.json' );

	if ( ! fs.existsSync( pkgFile ) ) {
		return { name, version: 'unknown', license: 'UNKNOWN', text: null, resolved: false };
	}

	const pkg = JSON.parse( fs.readFileSync( pkgFile, 'utf8' ) );

	let license = pkg.license || '';
	if ( ! license && Array.isArray( pkg.licenses ) ) {
		license = pkg.licenses.map( ( l ) => l.type || l ).join( ' OR ' );
	}
	if ( license && typeof license === 'object' ) {
		license = license.type || '';
	}

	// Prefer the package's own licence text over the SPDX id alone.
	let text = null;
	for ( const entry of fs.readdirSync( dir ) ) {
		if ( LICENSE_FILE_RE.test( entry ) ) {
			const p = path.join( dir, entry );
			if ( fs.statSync( p ).isFile() ) {
				text = fs.readFileSync( p, 'utf8' ).trim();
				break;
			}
		}
	}

	return {
		name,
		version: pkg.version || 'unknown',
		license: license || 'UNKNOWN',
		text,
		resolved: true,
	};
}

/**
 * Read the `License:` field from the plugin's main PHP file header.
 * Returns null if it cannot be found, in which case the notice simply omits
 * the claim rather than guessing.
 */
function readOwnLicense() {
	for ( const entry of fs.readdirSync( PLUGIN_ROOT ) ) {
		if ( ! entry.endsWith( '.php' ) ) {
			continue;
		}
		const head = fs.readFileSync( path.join( PLUGIN_ROOT, entry ), 'utf8' ).slice( 0, 4096 );
		if ( ! /^\s*\*\s*Plugin Name:/m.test( head ) ) {
			continue;
		}
		const m = head.match( /^\s*\*\s*License:\s*(.+?)\s*$/m );
		if ( m ) {
			return m[ 1 ];
		}
	}
	return null;
}

function main() {
	process.stdout.write( 'Building to determine bundled packages…\n' );
	const stats = getStats();
	const packages = collectPackages( stats ).map( describe );

	if ( packages.length === 0 ) {
		throw new Error( 'No bundled third-party packages found — refusing to write an empty notice.' );
	}

	const unknown = packages.filter( ( p ) => p.license === 'UNKNOWN' );

	const lines = [];
	lines.push( 'THIRD-PARTY LICENCES' );
	lines.push( '====================' );
	lines.push( '' );
	// Read the plugin's own licence from its main-file header rather than
	// hardcoding it, so this notice cannot contradict the plugin it ships in.
	// Only mention a LICENSE file if one is actually present: the Pro plugin
	// deliberately ships none.
	const ownLicense = readOwnLicense();
	if ( ownLicense ) {
		const hasLicenseFile = fs.existsSync( path.join( PLUGIN_ROOT, 'LICENSE' ) );
		lines.push(
			'This plugin is licensed ' + ownLicense +
			( hasLicenseFile ? ' (see LICENSE).' : '.' )
		);
	}
	lines.push( 'The notices below apply regardless of that licence.' );
	lines.push( '' );
	lines.push( 'The compiled JavaScript bundles in ' + BUNDLE_DIR + '/ contain code from the' );
	lines.push( 'third-party packages listed below. Each package remains under its own' );
	lines.push( 'licence, reproduced in full here as those licences require.' );
	lines.push( '' );
	lines.push( 'This file is generated from the actual build output, not from' );
	lines.push( 'package.json — only packages webpack genuinely inlined are listed.' );
	lines.push( 'Packages provided by WordPress at runtime (react, react-dom,' );
	lines.push( '@wordpress/*) are externalised and therefore absent.' );
	lines.push( '' );
	lines.push( 'Regenerate with: npm run licenses' );
	lines.push( '' );
	// Only true of a plugin that actually prefixes PHP dependencies — the Pro
	// plugin vendors none, so claiming otherwise would misdescribe the package.
	if ( fs.existsSync( path.join( PLUGIN_ROOT, 'vendor-prefixed' ) ) ) {
		lines.push( 'PHP dependencies are documented separately: each prefixed package under' );
		lines.push( 'vendor-prefixed/ ships its own upstream LICENSE file.' );
		lines.push( '' );
	}
	lines.push( '--------------------------------------------------------------------' );
	lines.push( 'SUMMARY (' + packages.length + ' packages)' );
	lines.push( '--------------------------------------------------------------------' );
	lines.push( '' );
	for ( const p of packages ) {
		lines.push( '  ' + p.name + '@' + p.version + ' — ' + p.license );
	}
	lines.push( '' );

	for ( const p of packages ) {
		lines.push( '' );
		lines.push( '====================================================================' );
		lines.push( p.name + '@' + p.version );
		lines.push( 'Licence: ' + p.license );
		lines.push( '====================================================================' );
		lines.push( '' );
		if ( p.text ) {
			lines.push( p.text );
		} else if ( ! p.resolved ) {
			lines.push( '[Package not present in node_modules at generation time; run' );
			lines.push( ' npm ci and regenerate.]' );
		} else {
			lines.push( '[No licence file shipped in this package. Declared licence: ' + p.license + '.' );
			lines.push( ' Full text: https://spdx.org/licenses/ ]' );
		}
		lines.push( '' );
	}

	fs.writeFileSync( OUT_FILE, lines.join( '\n' ) );

	process.stdout.write(
		'Wrote ' + path.relative( PLUGIN_ROOT, OUT_FILE ) +
		' (' + packages.length + ' packages).\n'
	);

	// An unattributable bundled package is a compliance problem, not a nit.
	if ( unknown.length > 0 ) {
		process.stderr.write(
			'\nERROR: no licence could be determined for:\n' +
			unknown.map( ( p ) => '  - ' + p.name + '@' + p.version ).join( '\n' ) +
			'\nResolve before releasing.\n'
		);
		process.exit( 1 );
	}
}

main();
