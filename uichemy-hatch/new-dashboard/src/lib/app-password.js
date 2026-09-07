/**
 * Shared Application Password state.
 *
 * The Connection card and the Composer MCP panel both display the same
 * Application Password. When either one issues a new password, wizard
 * auto-issue, dashboard Regenerate, the other needs to refresh too.
 * This tiny module-level store + pub-sub gives us cross-component sync
 * without dragging in a context provider.
 *
 * We deliberately do NOT store the Basic-auth header / base64 token any
 * more, every surface now exposes the plain Application Password (so
 * the user can drop it straight into a URL or the MCP env var).
 */

import { useEffect, useState } from 'react';
import { __ } from '@wordpress/i18n';
import { ajax, getBoot } from './api.js';

function initial() {
  const boot = getBoot();
  const ap = boot?.state?.appPassword || {};
  return {
    hasToken: !!ap.hasToken,
    password: '',
    last4:    ap.lastLast4 || '',
    name:     '',
  };
}

let state = initial();
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(state); } catch (_) { /* swallow listener errors */ }
  }
}

export function getAppPasswordState() {
  return state;
}

export function setAppPasswordState(next) {
  state = { ...state, ...next };
  emit();
}

export function useAppPassword() {
  const [s, setS] = useState(state);
  useEffect(() => {
    const fn = (next) => setS(next);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return s;
}

/**
 * Issue (or re-issue) the Application Password. Calls the same backend
 * endpoint both the wizard and dashboard rely on, then broadcasts the
 * new state to every subscriber.
 *
 * `mode` controls the WP profile entry name:
 *   'figma' → uichemy-figma-N
 *   'mcp'   → uichemy-mcp-N
 * Defaults to 'figma' when not specified.
 *
 * Resolves to the new state on success; throws on failure so callers
 * can show their own error UI.
 */
export async function regenerateAppPassword(mode) {
  const payload = mode ? { mode } : {};
  const data = await ajax('uich_nd_generate_app_password', payload);
  const password = data.password || '';
  const next = {
    hasToken: true,
    password,
    last4:    password ? password.slice(-4) : (data.last4 || state.last4),
    name:     data.name || '',
  };
  setAppPasswordState(next);
  return next;
}

/* ============================================================
   Force-enable Application Passwords
   ------------------------------------------------------------
   WordPress can refuse to issue App Passwords (HTTP-without-SSL, WP < 5.6, or
   a plugin/filter/wp-config returning false). This per-account override flips
   availability back on for the current user so the connection link / Figma /
   MCP can authenticate. Shared by every surface that offers the toggle (the
   Connect panel and the Settings screen) so there's one source of truth.
   ============================================================ */

const FORCE_REASON_COPY = {
  no_class: __( 'Your WordPress version is too old (App Passwords need 5.6+).', 'uichemy' ),
  no_ssl:   __( "This site runs on HTTP and isn't flagged as local/dev, so WordPress blocks App Passwords by default.", 'uichemy' ),
  blocked:  __( 'A plugin, theme, or wp-config snippet on this site is blocking App Passwords (a filter is returning false).', 'uichemy' ),
  user:     __( 'Your account is allowed but a site-level rule is blocking App Passwords.', 'uichemy' ),
};

function readForceState() {
  const ap = getBoot()?.state?.appPassword || {};
  return {
    available:       !! ap.available,
    forceEnabled:    !! ap.forceEnabled,
    canForceEnable:  !! ap.canForceEnable,
    canForceDisable: !! ap.canForceDisable,
    disabledReason:  ap.disabledReason || null,
  };
}

/**
 * State + toggle for the "Force-enable Application Passwords" control.
 *
 * `visible` is false whenever App Passwords already work and there's no
 * override to undo, the same self-hide rule the old rail gear used, so the
 * control only appears when it's actually actionable. `toggle` calls the same
 * enable/disable AJAX endpoints and folds the fresh state back in.
 */
export function useAppPasswordForce() {
  const [ap, setAp] = useState( readForceState );
  const [busy, setBusy] = useState( false );
  const [error, setError] = useState( '' );

  const visible = ! ( ap.available && ! ap.canForceDisable );

  const toggle = async () => {
    if ( busy ) return;
    setBusy( true ); setError( '' );
    try {
      const action = ap.forceEnabled
        ? 'uich_nd_disable_app_passwords'
        : 'uich_nd_enable_app_passwords';
      const data = await ajax( action );
      setAp( {
        available:       !! data.available,
        forceEnabled:    !! data.forceEnabled,
        canForceEnable:  !! data.canForceEnable,
        canForceDisable: !! data.canForceDisable,
        disabledReason:  data.disabledReason || null,
      } );
    } catch ( e ) {
      setError( e.message || __( 'Could not update Application Passwords.', 'uichemy' ) );
    } finally {
      setBusy( false );
    }
  };

  return {
    visible,
    forceEnabled: ap.forceEnabled,
    busy,
    error,
    reasonText: ap.disabledReason ? FORCE_REASON_COPY[ ap.disabledReason ] : null,
    toggle,
  };
}
