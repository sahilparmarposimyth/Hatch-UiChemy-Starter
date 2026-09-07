/**
 * Dashboard health model.
 *
 * These conditions used to short-circuit `initialScreen()` and take over the
 * whole page with a full-screen "calm" card — the user lost the sidebar and
 * every bit of context until they fixed it. That's the wrong model for a
 * recoverable problem (Wise/Shopify/Dialpad all keep you in the app and surface
 * the issue as a top banner + an inline block on the screen that needs it).
 *
 * `computeHealth()` derives the same conditions from the boot snapshot (plus a
 * runtime REST-probe flag) and returns an ordered list of issue objects. The
 * dashboard renders them as a top banner (all issues) and, for the
 * connect-scoped ones, an inline block on the AI Agent / Figma screens.
 *
 * Copy is intentionally duplicated from the legacy full-page ErrorCard /
 * EnvBlocked variants (which still back the `?nd_preview=` QA hatch and the
 * one remaining hard gate) so the two paths can't silently drift — the strings
 * are the single visible contract and are kept identical on purpose.
 *
 * NOTE: `not-admin` is deliberately NOT here — a non-admin must never reach the
 * dashboard, so it stays a hard full-page gate in App.jsx.
 */
import { createElement } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { createInterpolateElement } from '@wordpress/element';

const SEVERITY_RANK = { error: 0, warn: 1, info: 2 };

// Why Application Passwords are off — mirrors App.jsx's REASON_COPY so the
// inline app-passwords block explains the exact cause.
const AP_REASON = {
  no_class: __( 'Your WordPress version is too old (App Passwords need 5.6+).', 'uichemy' ),
  no_ssl:   __( 'For security, WordPress enables App Passwords only when your site is set up with HTTPS.', 'uichemy' ),
  blocked:  __( 'A plugin, theme, or wp-config snippet on this site is blocking App Passwords.', 'uichemy' ),
  user:     __( 'Your account is allowed but a site-level rule is blocking App Passwords.', 'uichemy' ),
};

/**
 * Copy for the app-passwords issue when `detect_blocker()` attributed the block
 * to a specific plugin. Naming the culprit beats a generic filter explanation,
 * and Wordfence is the one case where we can also name the exact setting.
 */
function blockerCopy( blocker, wordfenceUrl ) {
  if ( blocker.type === 'wordfence' ) {
    const stepOne = wordfenceUrl
      ? createInterpolateElement(
        __( 'In WP-Admin, go to Wordfence → <a>All Options</a>.', 'uichemy' ),
        { a: createElement( 'a', { href: wordfenceUrl, target: '_blank', rel: 'noreferrer' } ) }
      )
      : __( 'In WP-Admin, go to Wordfence → All Options.', 'uichemy' );
    return {
      title: __( 'Wordfence is blocking Application Passwords', 'uichemy' ),
      body: __( 'Wordfence has “Disable WordPress application passwords” switched on, which is its default, so WordPress won\'t let UiChemy connect. Enable it for your account in one click, or turn the option off in Wordfence.', 'uichemy' ),
      steps: [
        stepOne,
        __( 'Find Brute Force Protection and expand its advanced options.', 'uichemy' ),
        __( 'Uncheck “Disable WordPress application passwords”.', 'uichemy' ),
        __( 'Save the change, then click Re-check below.', 'uichemy' ),
      ],
    };
  }
  if ( blocker.label ) {
    return {
      /* translators: %s: name of the plugin blocking Application Passwords. */
      title: sprintf( __( '%s is blocking Application Passwords', 'uichemy' ), blocker.label ),
      body: __( 'WordPress Application Passwords are switched off on this site, which is what UiChemy connects with. Enable them for your account in one click, or change the setting in that plugin.', 'uichemy' ),
    };
  }
  return {
    title: __( 'Application Passwords are being blocked', 'uichemy' ),
    body: __( 'Something on this site is switching off WordPress Application Passwords, which is what UiChemy connects with. Enabling them for your account usually resolves it.', 'uichemy' ),
    hooked: ( blocker.type === 'unknown' && blocker.hooked && blocker.hooked.length ) ? blocker.hooked : null,
  };
}

const DOCS = 'https://uichemy.com/docs';
const SUPPORT = 'https://store.posimyth.com/helpdesk';

/**
 * Build one issue descriptor.
 *   severity  — error | warn | info (drives banner order + tone)
 *   variant   — the legacy ErrorCard/EnvBlocked key, so the inline block can
 *               reuse the exact same card.
 *   inlineOnConnect — also render inline on the AI Agent / Figma connect
 *               screens (the ones whose action the issue blocks).
 *   fix.kind  — 'enable-ap' | 'install-uichemy' | 'reload' | 'link' | 'expand'
 */
function issue( o ) {
  return { tone: 'warn', inlineOnConnect: false, ...o };
}

export function computeHealth( boot, { restFailed = false } = {} ) {
  const state = boot?.state || {};
  const env = state.env || {};
  const conn = state.connection || {};
  const out = [];

  // ---- Environment (site-wide) ----
  if ( env.wp_ok === false ) {
    out.push( issue( {
      id: 'env-wp-old', kind: 'env', variant: 'wp-old', severity: 'error',
      title: __( 'WordPress is out of date', 'uichemy' ),
      body: __( 'UiChemy needs WordPress 6.9 or newer. Update from Dashboard → Updates, then re-check.', 'uichemy' ),
      fix: { kind: 'link', label: __( 'Update WordPress', 'uichemy' ), href: 'update-core.php' },
    } ) );
  }
  if ( env.php_ok === false ) {
    out.push( issue( {
      id: 'env-php-old', kind: 'env', variant: 'php-old', severity: 'error',
      title: __( 'Your PHP version is too old', 'uichemy' ),
      body: __( 'UiChemy needs PHP 7.4 or newer. Your host can switch the PHP version in seconds.', 'uichemy' ),
      fix: { kind: 'link', label: __( 'Contact your host', 'uichemy' ), href: SUPPORT },
    } ) );
  }
  if ( env.ext_ok === false ) {
    out.push( issue( {
      id: 'env-missing-ext', kind: 'env', variant: 'missing-ext', severity: 'error',
      title: __( 'A PHP extension is missing', 'uichemy' ),
      body: __( 'UiChemy needs the JSON and mbstring extensions enabled. Ask your host to turn them on.', 'uichemy' ),
      fix: { kind: 'link', label: __( 'Show me how', 'uichemy' ), href: DOCS },
    } ) );
  }
  if ( env.memory_ok === false ) {
    out.push( issue( {
      id: 'env-low-memory', kind: 'env', variant: 'low-memory', severity: 'info', tone: 'info',
      title: __( 'Low memory', 'uichemy' ),
      body: __( 'You can keep working, but conversions of large designs may fail. Bumping memory_limit to 256M is recommended.', 'uichemy' ),
      fix: { kind: 'link', label: __( 'Show me how', 'uichemy' ), href: DOCS },
    } ) );
  }

  // ---- Connection (blocks connecting; app still usable) ----
  if ( conn.rest_ok === false || restFailed ) {
    out.push( issue( {
      id: 'rest', kind: 'error', variant: 'rest', severity: 'error', inlineOnConnect: true,
      title: __( 'REST API is blocked', 'uichemy' ),
      body: __( "A plugin or your host is blocking WordPress's REST API. UiChemy can't connect until it's reachable.", 'uichemy' ),
      fix: { kind: 'link', label: __( 'Show me how to fix', 'uichemy' ), href: DOCS },
    } ) );
  }
  if ( conn.app_passwords_ok === false ) {
    const le = state.localEnv;
    if ( le && le.available && le.current !== 'local' ) {
      out.push( issue( {
        id: 'local-env-needed', kind: 'error', variant: 'local-env-needed', severity: 'warn',
        title: __( 'WP_ENVIRONMENT_TYPE is not set to “local”', 'uichemy' ),
        body: __( "You're on a localhost site. Add the line below to wp-config.php, then re-check.", 'uichemy' ),
        snippet: le.snippet || "define( 'WP_ENVIRONMENT_TYPE', 'local' );",
        fix: { kind: 'reload', label: __( 'Re-check', 'uichemy' ) },
      } ) );
    } else {
      const reason = state.appPassword?.disabledReason || null;
      // `security_blocking` is behaviour-derived (see Uich_ND_App_Password::
      // detect_blocker), so when it names a culprit the card says so instead of
      // explaining filters. Null whenever nothing is actually blocking.
      const blocker = conn.security_blocking || null;
      const named = blocker ? blockerCopy( blocker, state.appPassword?.wordfenceUrl || null ) : null;
      out.push( issue( {
        id: 'app-passwords', kind: 'error', variant: 'app-passwords', severity: 'error', inlineOnConnect: true,
        title: named ? named.title : __( 'Application Passwords are disabled', 'uichemy' ),
        body: named ? named.body : __( 'WordPress Application Passwords are turned off on this site. UiChemy needs them to connect the Figma plugin or an MCP client.', 'uichemy' ),
        // The title already names the culprit, so the "why" chip would repeat it.
        reasonText: ( reason && ! named ) ? AP_REASON[ reason ] : null,
        reasonHint: ( reason && 'no_class' !== reason && state.appPassword?.canForceEnable )
          ? __( 'You can still enable it for your account with the button below.', 'uichemy' )
          : null,
        steps: named?.steps || null,
        hooked: named?.hooked || null,
        fix: { kind: 'enable-ap', label: __( 'Enable for my account', 'uichemy' ), busyLabel: __( 'Enabling…', 'uichemy' ) },
      } ) );
    }
  }

  // ---- UiChemy (Elementor-only setup step) ----
  const uichemy = state.uichemy;
  const isElementor = state.builder === 'elementor';
  if ( state.onboarded && isElementor && uichemy && uichemy.active === false ) {
    const installed = !! uichemy.installed;
    out.push( issue( {
      id: 'uichemy', kind: 'error', variant: 'uichemy', severity: 'error', tone: 'danger', inlineOnConnect: true,
      title: installed
        ? __( 'UiChemy is installed but not active', 'uichemy' )
        : __( 'UiChemy is not installed', 'uichemy' ),
      body: installed
        ? __( 'UiChemy powers the Composer widget and the MCP server that lets AI tools build on your site. Activate it to get started.', 'uichemy' )
        : __( 'UiChemy powers the Composer widget and the MCP server that lets AI tools build on your site. Install it to get started.', 'uichemy' ),
      fix: {
        kind: 'install-uichemy',
        label: installed ? __( 'Activate UiChemy', 'uichemy' ) : __( 'Install & Activate UiChemy', 'uichemy' ),
        busyLabel: installed ? __( 'Activating…', 'uichemy' ) : __( 'Installing…', 'uichemy' ),
      },
    } ) );
  }

  out.sort( ( a, b ) => SEVERITY_RANK[ a.severity ] - SEVERITY_RANK[ b.severity ] );
  return out;
}

/** Issues that should also block the connect screens inline. */
export function connectIssues( issues ) {
  return issues.filter( ( i ) => i.inlineOnConnect );
}
