import React, { useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';

import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import DashShell from '../../components/DashShell.jsx';
import { routableTabs } from '../../dashboard/tabs.js';
import { getSession, getQuery, hasQuery, getBoot, isAuthed } from '../../lib/api.js';

import Welcome from './Welcome.jsx';
import { FigmaScreen, AiAgentScreen, AiWebsiteScreen } from './Import.jsx';
import WhiteLabel from './WhiteLabel.jsx';
import ThemeBuilder from './ThemeBuilder.jsx';
import Placeholder from './Placeholder.jsx';
import BuilderScreenHost from './BuilderScreenHost.jsx';
import SetupFlow from './SetupFlow.jsx';
import SyncAstro from './SyncAstro.jsx';
import { Toaster } from '../../design-system';

/**
 * The post-onboarding dashboard: a hash-routed SPA inside the sidebar shell.
 *
 * HashRouter (not BrowserRouter) because every tab stays on the one WP admin
 * page, `admin.php?page=uichemy`, a path router would need a registered WP page
 * per tab and would break on reload.
 *
 * Three kinds of route, decided entirely by the registry:
 *   screen         → a UiChemy screen from SCREENS below
 *   builderScreen  → a screen from the merged UiChemy runtime, mounted by
 *                    BuilderScreenHost inside its Tailwind island
 *   pending        → Placeholder
 *
 * The rail is a flat, section-labelled list now (no groups), so every tab maps
 * straight to one route, no group rows to redirect.
 */
const SCREENS = {
  welcome: Welcome,
  figma: FigmaScreen,
  aiagent: AiAgentScreen,
  aiwebsite: AiWebsiteScreen,
  whitelabel: WhiteLabel,
  themebuilder: ThemeBuilder,
  syncastro: SyncAstro,
};

/**
 * First-run gate: a brand-new admin (state.onboarded === false) is dropped into
 * the /setup wizard on their first landing, so onboarding is the first thing
 * they see. Fires ONCE per session (a ref latch), after they finish setup (or
 * click "Back to dashboard"), navigating to `/` shows the Create hub normally
 * and never bounces back. Already-onboarded users are untouched.
 *
 * `&onboard` on the admin URL forces the wizard open on an already-onboarded
 * site, so the flow can be reviewed without resetting the `uich_nd_onboarded`
 * option (or hunting for a fresh install). It overrides the path check too, so
 * it works from any hash route. Because the latch still applies, finishing the
 * wizard lands on Home and stays there — the flag only re-arms on a reload.
 * SetupFlow reads the same flag to restart from the Welcome intro; see there.
 */
function FirstRunGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const fired = useRef( false );
  useEffect( () => {
    if ( fired.current ) return;
    fired.current = true;
    const onboarded = !! getBoot()?.state?.onboarded;
    const forced = hasQuery( 'onboard' );
    if ( forced || ( ! onboarded && location.pathname === '/' ) ) {
      navigate( '/setup', { replace: true } );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [] );
  return null;
}

/**
 * Frame: onboarding (/setup) renders WITHOUT the dashboard rail, just the
 * two-pane wizard filling the WP-admin content area, so WordPress's own sidebar
 * stays visible. Every other route keeps the full dashboard shell.
 */
function Frame( { onSwitchLicense, restFailed, children } ) {
  const location = useLocation();
  if ( location.pathname === '/setup' ) {
    return <div className="nd-onboarding">{ children }</div>;
  }
  return (
    <DashShell onSwitchLicense={ onSwitchLicense } restFailed={ restFailed }>
      { children }
    </DashShell>
  );
}

/** A full tool page opened from a Home bar, adds a back-to-Home link above it. */
function ToolRoute( { children } ) {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" className="tool-back" onClick={ () => navigate( '/' ) }>
        <Icon.ChevL size={ 15 } /> { __( 'Back to Home', 'uichemy' ) }
      </button>
      { children }
    </>
  );
}

export default function DashboardApp( { onSwitchLicense, ...props } ) {
  // Validate the SSO session on every dashboard visit/refresh. A 401 signs the
  // user out (handled inside getSession); other failures are ignored so a
  // transient blip never does. Mounted here rather than per-tab so switching
  // tabs doesn't re-check.
  //
  // Only when an account is actually connected. Signing in is optional now, so
  // the dashboard renders for signed-out admins too — and with no token
  // `licenses/user` answers 401, which makes getSession() call signOut(), which
  // reloads, which lands here again: an endless reload loop. Nothing to validate
  // when there was never a session.
  //
  // Skipped under ?nd_preview for the same reason: that hatch jumps past the
  // remaining gates, so the probe would fire on sites with no token at all.
  // App.jsx skips its REST probe in preview mode too.
  useEffect( () => {
    if ( getQuery( 'nd_preview' ) ) return;
    if ( ! isAuthed() ) return;
    ( async () => {
      try { await getSession(); } catch ( _ ) { /* 401 already signs out */ }
    } )();
  }, [] );

  return (
    <HashRouter>
      {/* Mounted once, at the dashboard root rather than inside Frame, so the
          onboarding wizard at /setup (which renders outside the rail shell) gets
          toasts too — the Pro install can be driven from either place. Sonner
          portals to <body>, and the --uc-* tokens live on :root, so it is styled
          correctly even though it lands outside #uich-new-dash. */}
      <Toaster />
      <FirstRunGate />
      <Frame onSwitchLicense={ onSwitchLicense } restFailed={ props.restFailed }>
        <Routes>
          { routableTabs().map( ( tab ) => {
            let element;
            if ( tab.builderScreen && ! tab.pending ) {
              element = <BuilderScreenHost name={ tab.builderScreen } />;
            } else if ( tab.screen && SCREENS[ tab.screen ] && ! tab.pending ) {
              const Screen = SCREENS[ tab.screen ];
              element = <Screen { ...props } />;
            } else {
              element = <Placeholder />;
            }
            return <Route key={ tab.key } path={ tab.path } element={ element } />;
          } ) }

          {/* The three Create methods are tabs on Home now, keep their old
              routes working by opening Home with that tab preselected. */}
          <Route path="/figma" element={ <Welcome initialTab="figma" { ...props } /> } />
          <Route path="/ai-website" element={ <Welcome initialTab="aiwebsite" { ...props } /> } />
          <Route path="/ai-agent" element={ <Welcome initialTab="aiagent" { ...props } /> } />

          {/* Onboarding, re-housed in the dashboard shell (option A). */}
          <Route path="/setup" element={ <SetupFlow /> } />

          {/* Unknown hash (stale bookmark, hand-typed) → home, never a blank pane. */}
          <Route path="*" element={ <Navigate to="/" replace /> } />
        </Routes>
      </Frame>
    </HashRouter>
  );
}
