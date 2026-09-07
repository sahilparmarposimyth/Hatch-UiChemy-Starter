#!/usr/bin/env node
/**
 * Build an installable plugin zip from this checkout — Node only.
 *
 * Why this exists alongside scripts/build.sh
 * ------------------------------------------
 * build.sh is the RELEASE builder and stays authoritative for anything going to
 * WP.org: it regenerates THIRD-PARTY-LICENSES.txt from the built bundles and
 * refuses to package unless every prefixed PHP dependency carries its upstream
 * licence. It also needs `rsync`, `zip` and `composer`, none of which exist on a
 * stock Windows dev box, and it asserts a `vendor-prefixed/` that only appears
 * after a composer install plus the prefixing step.
 *
 * This one needs only Node (already required, to build the two React bundles)
 * plus a zip writer that Windows 10+, macOS and Linux all ship. It is for
 * getting a testable plugin zip out of a working tree — not for releasing.
 *
 * Usage
 * -----
 *   node scripts/build-zip.mjs                  build bundles, then package
 *   node scripts/build-zip.mjs --skip-build     package what is already built
 *   node scripts/build-zip.mjs --slug=uichemy-hatch
 *                                               install side by side with an
 *                                               existing UiChemy instead of
 *                                               replacing it
 *   node scripts/build-zip.mjs --out=../my.zip  choose the output path
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

const args = process.argv.slice( 2 );
const flag = ( name, fallback ) => {
  const hit = args.find( ( a ) => a.startsWith( `--${ name }=` ) );
  return hit ? hit.slice( name.length + 3 ) : fallback;
};
const skipBuild = args.includes( '--skip-build' );

/*
 * The folder name inside the archive is the directory WordPress installs into,
 * and plugin_basename() bakes it into update checks — so it defaults to
 * `uichemy`, exactly as build.sh hard-codes, regardless of what this checkout
 * is called locally. Override it to install a test build next to a real
 * UiChemy rather than on top of it.
 */
const SLUG = flag( 'slug', 'uichemy' );

const version = ( () => {
  const src = fs.readFileSync( path.join( ROOT, 'uichemy.php' ), 'utf8' );
  const m = src.match( /define\(\s*'UICH_VERSION',\s*'([^']+)'\s*\)/ );
  return m ? m[ 1 ] : '0.0.0';
} )();

const OUT = path.resolve( flag( 'out', path.join( ROOT, `${ SLUG }-v${ version }.zip` ) ) );

// ── Exclusions ─────────────────────────────────────────────────────────────
// Kept deliberately in step with .distignore and build.sh's rsync list. Two
// entries under hatch/ that LOOK like source are absent on purpose: the runtime
// reads hatch/blocks-src/ for the block.json metadata it registers blocks from,
// and serves hatch/agent/ to the VPS installer. Dropping either produces a zip
// that activates cleanly and then misbehaves.
const EXCLUDE_PATHS = new Set( [
  '.git', '.github', '.gitignore', '.gitattributes', '.editorconfig', '.distignore',
  '.vscode', '.idea', '.claude', '.sandbox', '.mcp.json', 'skills-lock.json',
  'scripts', 'docs', 'composer.json', 'composer.lock', 'vendor',
  'new-dashboard',                       // re-added below, compiled build/ only
  'hatch/admin-react', 'hatch/docs', 'hatch/package.json', 'hatch/package-lock.json',
  'hatch/tailwind.config.js', 'hatch/wizard-screenshots.mjs', 'hatch/.gitignore',
  'hatch/readme.txt', 'hatch/CHANGELOG.md', 'hatch/design.md',
] );

const excludeAnywhere = ( rel, base ) =>
  base === 'node_modules' ||
  base === '.DS_Store' ||
  base === 'Thumbs.db' ||
  base.endsWith( '.log' ) ||
  base.endsWith( '.map' ) ||
  // `/*.md` in .distignore — root-level markdown only.
  ( ! rel.includes( '/' ) && base.endsWith( '.md' ) ) ||
  /*
   * Root-level zips — which is exactly where THIS script writes its output.
   * Without this a second run stages the first run's archive inside the new
   * one and the zip doubles every build; caught at 4.7 MB -> 9.25 MB. Mirrors
   * `/*.zip` in .gitignore, and root-level only so a zip a plugin genuinely
   * ships from a subdirectory still travels.
   */
  ( ! rel.includes( '/' ) && base.endsWith( '.zip' ) );

// ── Steps ──────────────────────────────────────────────────────────────────

/*
 * `npm` on Windows is a .cmd shim, and since the CVE-2024-27980 mitigation Node
 * REFUSES to spawn .bat/.cmd without shell:true — it fails before the command
 * runs at all. So shell:true is required here, not optional.
 *
 * That trips Node's DEP0190 warning, which exists because shell:true
 * concatenates argv into one command line without escaping. Harmless in this
 * file: every argument passed below is a fixed literal written here ('install',
 * 'run', 'build'…). Nothing user-supplied, nothing interpolated, so there is no
 * argument that could carry shell syntax.
 */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPM_OPTS = process.platform === 'win32' ? { shell: true } : {};

function run( cmd, cmdArgs, cwd, extra = {} ) {
  const r = spawnSync( cmd, cmdArgs, { cwd, stdio: 'inherit', ...extra } );
  // A spawn that never started reports `error` and a null status. Surfacing it
  // is the difference between "npm failed" and knowing npm was never reached —
  // exactly the distinction that made the .cmd problem above hard to see.
  if ( r.error ) throw new Error( `could not run ${ cmd }: ${ r.error.message }` );
  return r.status === 0;
}

function mustRun( cmd, cmdArgs, cwd, extra = {} ) {
  if ( ! run( cmd, cmdArgs, cwd, extra ) ) {
    throw new Error( `${ cmd } ${ cmdArgs.join( ' ' ) } failed in ${ cwd }` );
  }
}

function buildBundles() {
  // The dashboard, and the bundled Hatch runtime's own React admin. Without the
  // second one every Hatch screen renders an empty mount point.
  for ( const [ dir, script ] of [ [ 'new-dashboard', 'build' ], [ 'hatch', 'build:admin' ] ] ) {
    const cwd = path.join( ROOT, dir );
    const modules = path.join( cwd, 'node_modules' );

    if ( ! fs.existsSync( modules ) ) {
      console.log( `\n· npm install in ${ dir }/` );
      /*
       * Judged on the OUTCOME, not the exit code. npm 11 exits non-zero from a
       * fully successful install whenever a dependency has an install script
       * its allowScripts policy has not covered — this tree trips that on
       * @parcel/watcher and three core-js postinstalls. Treating that as a
       * failure aborted the build after it had already added 1633 packages.
       * A genuine failure leaves no node_modules, which is what this checks.
       */
      if ( ! run( NPM, [ 'install', '--no-audit', '--no-fund' ], cwd, NPM_OPTS ) ) {
        if ( ! fs.existsSync( modules ) ) {
          throw new Error( `npm install failed in ${ dir }/ and left no node_modules.` );
        }
        console.log( `  (npm reported a non-zero exit, but ${ dir }/node_modules is present — continuing)` );
      }
    }

    console.log( `\n· npm run ${ script } in ${ dir }/` );
    mustRun( NPM, [ 'run', script ], cwd, NPM_OPTS );
  }
}

function stage( dest ) {
  let files = 0;
  const walk = ( from, to, rel ) => {
    for ( const entry of fs.readdirSync( from, { withFileTypes: true } ) ) {
      const base = entry.name;
      const childRel = rel ? `${ rel }/${ base }` : base;
      if ( EXCLUDE_PATHS.has( childRel ) || excludeAnywhere( childRel, base ) ) continue;

      const src = path.join( from, base );
      const dst = path.join( to, base );
      if ( entry.isDirectory() ) {
        fs.mkdirSync( dst, { recursive: true } );
        walk( src, dst, childRel );
      } else if ( entry.isFile() ) {
        fs.copyFileSync( src, dst );
        files++;
      }
    }
  };

  fs.mkdirSync( dest, { recursive: true } );
  walk( ROOT, dest, '' );

  // Add back only the compiled dashboard bundle.
  const buildSrc = path.join( ROOT, 'new-dashboard', 'build' );
  if ( fs.existsSync( buildSrc ) ) {
    const buildDest = path.join( dest, 'new-dashboard', 'build' );
    const addBack = ( f, t ) => {
      fs.mkdirSync( t, { recursive: true } );
      for ( const e of fs.readdirSync( f, { withFileTypes: true } ) ) {
        if ( e.name.endsWith( '.map' ) ) continue;
        const fp = path.join( f, e.name );
        const tp = path.join( t, e.name );
        if ( e.isDirectory() ) addBack( fp, tp );
        else { fs.copyFileSync( fp, tp ); files++; }
      }
    };
    addBack( buildSrc, buildDest );
  }
  return files;
}

/** Every `.php` in the checkout that the runtime needs must reach the stage. */
function guardPhpComplete( dest ) {
  const skip = /(^|\/)(\.git|vendor|new-dashboard|scripts|docs|node_modules)\/|^hatch\/(admin-react|docs)\//;
  const list = ( base, rel = '' ) => {
    const out = [];
    for ( const e of fs.readdirSync( path.join( base, rel ), { withFileTypes: true } ) ) {
      const r = rel ? `${ rel }/${ e.name }` : e.name;
      if ( e.isDirectory() ) {
        if ( ! skip.test( `${ r }/` ) ) out.push( ...list( base, r ) );
      } else if ( e.name.endsWith( '.php' ) && ! skip.test( r ) ) out.push( r );
    }
    return out;
  };

  const missing = list( ROOT ).filter( ( f ) => ! fs.existsSync( path.join( dest, f ) ) );
  if ( missing.length ) {
    throw new Error( `these PHP files did not reach the archive:\n  ${ missing.join( '\n  ' ) }` );
  }
  return true;
}

/**
 * Exactly ONE file may advertise a plugin header, and it must be uichemy.php.
 *
 * A second one is not cosmetic. The installer picks the file to offer an
 * "Activate" link for via get_plugins( '/<folder>' ), which — scoped to a folder
 * — scans its top level AND one subdirectory deep, then sorts by plugin name. A
 * bundled runtime carrying its own header can win that pick, and the link then
 * points below the plugins root where activate_plugin() cannot validate it:
 * "The plugin does not have a valid header." That shipped once already.
 */
function guardSinglePluginHeader( dest ) {
  const hits = [];
  const scan = ( rel ) => {
    const abs = path.join( dest, rel );
    if ( ! fs.existsSync( abs ) || ! fs.statSync( abs ).isFile() ) return;
    if ( ! rel.endsWith( '.php' ) ) return;
    const fd = fs.openSync( abs, 'r' );
    const buf = Buffer.alloc( 8192 );
    const n = fs.readSync( fd, buf, 0, 8192, 0 );
    fs.closeSync( fd );
    // WordPress reads only the first 8KB for headers.
    if ( /^[ \t\/*#@]*Plugin Name:/im.test( buf.subarray( 0, n ).toString( 'utf8' ) ) ) hits.push( rel );
  };

  for ( const e of fs.readdirSync( dest, { withFileTypes: true } ) ) {
    if ( e.isFile() ) scan( e.name );
    else if ( e.isDirectory() ) {
      for ( const s of fs.readdirSync( path.join( dest, e.name ), { withFileTypes: true } ) ) {
        if ( s.isFile() ) scan( `${ e.name }/${ s.name }` );
      }
    }
  }

  if ( hits.length !== 1 || hits[ 0 ] !== 'uichemy.php' ) {
    throw new Error(
      `the archive must carry exactly one plugin header, in uichemy.php.\n` +
      `  found: ${ hits.length ? hits.join( ', ' ) : '<none>' }\n` +
      `  a bundled runtime must not advertise itself as a plugin.`
    );
  }
  return true;
}

/**
 * Both React bundles must be in the archive.
 *
 * Learned the hard way: --skip-build against a fresh clone happily produced a
 * zip with neither, which installs and activates fine and then renders empty
 * screens — the worst kind of broken, because nothing complains. The compiled
 * output is gitignored, so a clone never has it until something builds it.
 */
function guardBundles( dest ) {
  const required = [
    [ 'new-dashboard/build/index.js', 'cd new-dashboard && npm install && npm run build' ],
    [ 'hatch/build/admin/index.jsx.js', 'cd hatch && npm install && npm run build:admin' ],
  ];
  const missing = required.filter( ( [ rel ] ) => ! fs.existsSync( path.join( dest, rel ) ) );
  if ( ! missing.length ) return true;

  throw new Error(
    'the archive is missing compiled React bundles, which would install as blank screens:\n' +
    missing.map( ( [ rel, cmd ] ) => `  ${ rel }\n    build it with: ${ cmd }` ).join( '\n' ) +
    '\n  or just drop --skip-build and let this script build them.'
  );
}

/**
 * The archive must not contain an archive.
 *
 * The output defaults to the repo root, so a previous run's zip sits right where
 * the staging walk can pick it up — which it did, embedding a 4.7 MB archive in
 * the next one. The exclusion above fixes that; this makes sure a later edit to
 * the exclusion list cannot quietly bring it back.
 */
function guardNoNestedArchive( dest ) {
  const found = [];
  const walk = ( rel ) => {
    for ( const e of fs.readdirSync( path.join( dest, rel ), { withFileTypes: true } ) ) {
      const r = rel ? `${ rel }/${ e.name }` : e.name;
      if ( e.isDirectory() ) walk( r );
      else if ( /\.(zip|tar|tgz|gz)$/i.test( e.name ) ) found.push( r );
    }
  };
  walk( '' );
  if ( found.length ) {
    throw new Error(
      `the archive contains archives, almost certainly this script's own output:\n  ${ found.join( '\n  ' ) }`
    );
  }
  return true;
}

/** Prefer `zip`; fall back to bsdtar, which ships with Windows 10+ and macOS. */
function archive( stageParent, folder ) {
  fs.rmSync( OUT, { force: true } );

  const has = ( bin ) => spawnSync( bin, [ '--version' ], { stdio: 'ignore' } ).status === 0;

  if ( has( 'zip' ) ) {
    execFileSync( 'zip', [ '-qr', OUT, folder ], { cwd: stageParent } );
    return 'zip';
  }

  // bsdtar picks the format from the extension with -a. libarchive writes the
  // forward-slash separators the ZIP spec requires — unlike PowerShell's
  // Compress-Archive, which emits backslashes and can break WP's unzip.
  const tar = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
  execFileSync( tar, [ '-c', '-a', '-f', OUT, folder ], { cwd: stageParent } );
  return 'bsdtar';
}

// ── Main ───────────────────────────────────────────────────────────────────

// A failed guard is a packaging mistake with a known fix, not a crash — print
// the reason and nothing else. A stack trace here only buries the instruction.
process.on( 'uncaughtException', ( err ) => {
  console.error( `\n✗ ${ err.message }\n` );
  process.exit( 1 );
} );

const tmp = fs.mkdtempSync( path.join( os.tmpdir(), 'uich-pkg-' ) );
try {
  if ( ! skipBuild ) buildBundles();
  else console.log( '· --skip-build: packaging whatever is already in build/' );

  const dest = path.join( tmp, SLUG );
  const files = stage( dest );

  guardPhpComplete( dest );
  guardSinglePluginHeader( dest );
  guardBundles( dest );
  guardNoNestedArchive( dest );

  // Not fatal: the MCP adapter loads from vendor-prefixed/ and the loader guards
  // on is_readable(), so the plugin activates and everything else works — the
  // "AI Agent" surface just has no server behind it. build.sh treats an absent
  // notice as a release blocker; here it is worth knowing, not worth refusing.
  if ( ! fs.existsSync( path.join( ROOT, 'vendor-prefixed' ) ) ) {
    console.log( '\n! vendor-prefixed/ is absent, so MCP / "AI Agent" will be inert in this zip.' );
    console.log( '  Run composer install plus the prefixing step to include it.' );
  }

  const how = archive( tmp, SLUG );
  const mb = ( fs.statSync( OUT ).size / 1048576 ).toFixed( 2 );

  console.log( `\n✓ ${ OUT }` );
  console.log( `  ${ files } files · ${ mb } MB · v${ version } · folder "${ SLUG }/" · via ${ how }` );
} finally {
  fs.rmSync( tmp, { recursive: true, force: true } );
}
