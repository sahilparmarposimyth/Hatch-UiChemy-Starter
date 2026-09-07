import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { createInterpolateElement } from '@wordpress/element';

import WPChrome from './components/WPChrome.jsx';
import WebShell from './components/WebShell.jsx';
import WizardShell from './components/WizardShell.jsx';
import Toast from './components/Toast.jsx';
import * as Icon from './components/icons.jsx';

import EnvBlocked from './screens/wizard/EnvBlocked.jsx';
import WelcomeScreen from './screens/wizard/WelcomeScreen.jsx';
import PersonalizeScreen from './screens/wizard/PersonalizeScreen.jsx';
import BuilderScreen from './screens/wizard/BuilderScreen.jsx';
import ModeScreen from './screens/wizard/ModeScreen.jsx';
import ConnectScreen from './screens/wizard/ConnectScreen.jsx';
import DashboardApp from './screens/dashboard/DashboardApp.jsx';
import DSGallery from './screens/DSGallery.jsx';
import LoginScreen from './screens/auth/LoginScreen.jsx';
import ErrorCard from './screens/errors/ErrorCard.jsx';

import { useBoot, request, requestRoot, ajax, getQuery } from './lib/api.js';
import { modeById, modeSupportsBuilder } from './dashboard/modes.js';
import { personaById } from './dashboard/personas.js';

/**
 * QA preview escape hatch: append `?nd_preview=error:permalinks` (or
 * `env:wp-old`, `dashboard`, `connect:figma`, `connect:compose`)
 * to the admin URL to jump straight into any screen. No effect outside
 * preview mode.
 */
function previewScreen() {
  const raw = getQuery('nd_preview');
  if (!raw) return null;
  return raw;
}

/* ------------------------------------------------------------------
   TEMPORARY DEV-ONLY: floating QA switcher to review every screen,
   including all error/env variants. Appears only when the admin URL
   carries `&nd_qa=1`. Remove this block before shipping to users.
   ------------------------------------------------------------------ */
const QA_SCREENS = [
  'login',
  'welcome', 'personalize',
  'builder', 'mode', 'connect:figma', 'connect:compose', 'dashboard',
  'error:permalinks', 'error:rest', 'error:app-passwords',
  'error:unreachable', 'error:token-failed', 'error:builder', 'error:session',
  'error:mcp-unreachable', 'error:not-admin', 'error:uichemy',
  'env:wp-old', 'env:php-old', 'env:missing-ext', 'env:low-memory',
];

function QASwitcher({ current }) {
  const goto = (s) => {
    const u = new URL(window.location.href);
    u.searchParams.set('nd_preview', s);
    u.searchParams.set('nd_qa', '1');
    window.location.href = u.toString();
  };
  return (
    <div className="nd-qa">
      <div className="nd-qa__head">QA · screens</div>
      {QA_SCREENS.map((s) => (
        <button
          key={s}
          type="button"
          className={`nd-qa__item${current === s ? ' nd-qa__item--on' : ''}`}
          onClick={() => goto(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function initialScreen(boot) {
  // QA preview always wins.
  const preview = previewScreen();
  if (preview) return preview;

  const env = boot?.state?.env || {};

  // 1. Admin gate.
  if (!boot?.user?.isAdmin || env.is_admin === false) return 'error:not-admin';

  // 1.5. NO sign-in gate. Signing in used to be mandatory here — a signed-out
  //      admin saw nothing but the login page — but the Figma plugin and the AI
  //      Agent (MCP) authenticate with the site's own Application Password and
  //      never need a UiChemy account. Only the AI Website Creator does, and it
  //      gates itself: its tab renders its own connect card while signed out
  //      (see uichemy-webpage/index.jsx). Signing in is offered, not required,
  //      from the rail's "Activate" button (see DashShell's RailSignIn).
  //
  //      The standalone login page still exists and is still reachable through
  //      the `?nd_preview=login` QA hatch; nothing routes to it on its own.
  //
  // There is no license-session gate either: there are no per-site license
  // sessions to register or switch.
  //
  // Environment, connection, and UiChemy are NOT full-page gates either. They
  // used to short-circuit here and take over the whole page; now the user
  // always lands in the dashboard and these surface as a top health banner
  // (+ an inline block on the connect screens), see dashboard/health.js and
  // components/DashShell. Only `not-admin` (above) stays a hard gate, because a
  // non-admin must not see the dashboard at all. The old full-page error:*/env:*
  // screens remain reachable via the `?nd_preview=` QA hatch.

  // First-run: a brand-new admin (not yet onboarded) is dropped into the /setup
  // two-pane wizard, Welcome → About you → How you'll use it → Page builder →
  // Connect, by DashboardApp's FirstRunGate. Welcome is the intro panel of that
  // same two-pane (see SetupFlow), so the whole flow shares one chrome.
  // Already-onboarded users skip straight in.
  return 'dashboard';
}

export default function App() {
  const boot = useBoot();
  const [screen, setScreen] = useState(() => initialScreen(boot));

  // REST probe: if /state hangs/throws after mount, flag it so the dashboard's
  // health banner can surface "REST API is blocked", instead of hijacking the
  // whole page. Boot's conn.rest_ok already covers a REST API that's down at
  // first paint; this catches one that goes dark after load.
  useEffect(() => {
    if (previewScreen()) return;                       // QA escape hatch wins
    if (!boot?.restRoot || !boot?.restNonce) return;   // nothing to probe

    let cancelled = false;
    (async () => {
      try {
        const data = await request('/state');
        if (cancelled) return;
        // Endpoint reached but came back malformed → treat as blocked too.
        if (!data || typeof data !== 'object') setRestFailed(true);
      } catch (e) {
        if (cancelled) return;
        console.warn('[nd] REST probe failed, flagging health banner', e);
        setRestFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // Run once per boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default selection rules:
  //  - The card must be selectable (active), otherwise Continue would
  //    advance with a builder the user can't use.
  //  - Prefer the previously saved choice IF still active.
  //  - Else fall back to whichever builder is currently active.
  //  - Else default to Elementor (user can drive Install & Activate from
  //    the Continue button).
  const [builder, setBuilder] = useState(() => {
    const det = boot?.state?.builders || {};
    const isActive = (id) => !!det[id]?.active;
    const saved = boot?.state?.builder;
    if (saved && isActive(saved)) return saved;
    return ['elementor', 'bricks', 'gutenberg'].find(isActive) || 'elementor';
  });
  const [mode, setMode] = useState(boot?.state?.mode || '');

  // Onboarding persona ("About you" step). Client-side only, it tailors copy
  // and pre-selects the recommended mode; no server round-trip needed.
  const [persona, setPersona] = useState(() => {
    try { return localStorage.getItem('uich_nd_persona') || ''; } catch (_) { return ''; }
  });

  // Local override merged on top of boot's detected map so the UI flips
  // to "Active" immediately after a Continue-driven install/activate.
  const [detectedOverride, setDetectedOverride] = useState({});
  const detectedMerged = useMemo(
    () => ({ ...(boot?.state?.builders || {}), ...detectedOverride }),
    [boot?.state?.builders, detectedOverride]
  );

  // Continue-button progress (while we drive the install/activate flow).
  const [continueBusy, setContinueBusy] = useState(false);
  const [continueError, setContinueError] = useState('');

  // Force-enable Application Passwords from the error screen.
  const [forceApBusy, setForceApBusy] = useState(false);
  const [forceApError, setForceApError] = useState('');

  // One-click UiChemy install/activate from its full-page gate card.
  const [uichemyBusy, setUiChemyBusy] = useState(false);
  const [uichemyError, setUiChemyError] = useState('');
  // Fresh UiChemy detection merged on top of boot's stale snapshot, so the
  // step (and the finish routing) see "active" immediately after the
  // Continue-driven install/activate, without a full page reload.
  const [uichemyOverride, setUiChemyOverride] = useState(null);

  // Analytics opt-in. WordPress.org requires explicit, opt-in consent
  // before any site data is sent to an external server; the onboarding
  // consent prompt was removed, so this stays permanently off.
  const consent = false;

  // Runtime REST health. If the post-mount /state probe fails, we no longer
  // yank the user to a full-page "REST blocked" screen, the dashboard stays
  // put and surfaces it via the health banner (see components/DashShell +
  // dashboard/health.js). Boot's conn.rest_ok covers the initial paint; this
  // flag catches a REST API that goes dark after load.
  const [restFailed, setRestFailed] = useState(false);

  // Toast notification. Auto-dismisses ~3s after it appears.
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, variant = 'success') => {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // Testing hooks:
  //   1. `?nd_test_toast=success|error|info` in the URL fires a sample
  //      toast on mount.
  //   2. `window.__ndToast('Hello', 'success')` from the devtools console
  //      fires one on demand, handy while iterating on the design.
  useEffect(() => {
    window.__ndToast = (message, variant = 'success') => showToast(message, variant);
    const want = getQuery('nd_test_toast');
    if (want) {
      const variant = ['success', 'error', 'info'].includes(want) ? want : 'success';
      const sample =
        variant === 'error' ? __('Could not activate Elementor.', 'uichemy') :
          variant === 'info' ? __('Finishing activation in WP-Admin…', 'uichemy') :
            __('Elementor installed and activated successfully.', 'uichemy');
      showToast(sample, variant);
    }
    return () => { delete window.__ndToast; };
  }, [showToast]);

  // Center the toast over the WP content column (#wpcontent), not the whole
  // viewport, the admin menu eats the left edge, so viewport-center looks
  // shifted left. We measure the real column and expose its centre as a CSS
  // var; a ResizeObserver keeps it correct when the menu folds/unfolds.
  useEffect(() => {
    const col = document.getElementById('wpcontent');
    if (!col) return;
    const setVar = () => {
      const r = col.getBoundingClientRect();
      document.documentElement.style.setProperty('--nd-toast-cx', `${Math.round(r.left + r.width / 2)}px`);
    };
    setVar();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setVar) : null;
    if (ro) ro.observe(col);
    window.addEventListener('resize', setVar);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', setVar);
      document.documentElement.style.removeProperty('--nd-toast-cx');
    };
  }, []);

  // Sign-in return: once the OAuth callback has stored the tokens it redirects
  // back here with ?uich_connected=1. Confirm the connection with a toast.
  // Failures never get this far — the PHP side ends those requests with its own
  // message — so there is no error branch to translate here.
  useEffect(() => {
    if (getQuery('uich_connected') === '1') {
      showToast('Connected to UiChemy.', 'success');
    }
  }, [showToast]);

  // Some modes are builder-specific (MCP is Elementor-only for now). If the
  // picked mode doesn't support the newly-chosen builder, drop the selection so
  // they don't end up locked on a Continue button.
  useEffect(() => {
    if (mode && builder && !modeSupportsBuilder(mode, builder)) {
      setMode('');
    }
  }, [builder, mode]);

  const go = useCallback((next) => setScreen(next), []);

  // Where the full-page env/error screens send the user once resolved. With the
  // standalone welcome wizard retired, that target is simply the dashboard.
  const firstWizardScreen = 'dashboard';

  // DEV-ONLY QA screen switcher, disabled. Set to null so the floating panel
  // never renders (previously shown when the admin URL carried ?nd_qa=1). The
  // QASwitcher component + .nd-qa styles remain for easy re-enable if needed.
  const qaBar = null;

  const builderLabel = useMemo(() => {
    const m = {
      elementor: __('Elementor', 'uichemy'),
      bricks: __('Bricks', 'uichemy'),
      gutenberg: __('Gutenberg', 'uichemy'),
    };
    return m[builder] || __('Elementor', 'uichemy');
  }, [builder]);
  // A `pending` mode (AI Website Creator) has nothing to connect, so the
  // wizard drops its third step and finishes on the mode step rather than
  // parking the user on a Connect screen with no fields.
  const modeIsPending = !!modeById(mode)?.pending;

  /** Persist current step's choice to REST, then advance. Errors are
   *  swallowed to a console.warn so navigation never blocks on a flaky
   *  network, the choice is already in local state. */
  const persistThenGo = useCallback(async (path, body, next) => {
    try { await request(path, { method: 'POST', body }); }
    catch (e) { console.warn('[nd] persist failed', path, e); }
    go(next);
  }, [go]);

  // UiChemy detection, merged local override on top of boot's snapshot so
  // the builder step (and finish routing) see "active" immediately after a
  // Continue-driven install/activate, no page reload needed. UiChemy is a
  // required companion whenever Elementor is the selected builder.
  const uichemyDet = uichemyOverride || boot?.state?.uichemy || {};
  const uichemyActive = !!uichemyDet.active;
  const uichemyInstalled = !!uichemyDet.installed;
  const uichemyUpdate = !!uichemyDet.update_available;

  /**
   * What does the Continue button need to do for the currently-selected
   * builder? `continue` = everything already active, just advance. `install`
   * or `activate` = drive the corresponding endpoints first. For Elementor
   * the required UiChemy companion is folded into the same check, so the
   * button stays in "Install & Activate" until BOTH are active.
   */
  const builderContinueIntent = useMemo(() => {
    const det = detectedMerged[builder] || {};
    if (builder === 'elementor') {
      const allActive = det.active && uichemyActive;
      if (allActive) {
        // Both active, if UiChemy has a newer release, fold the update into
        // this same Continue button instead of a separate card control.
        return uichemyUpdate ? 'update' : 'continue';
      }
      // If either Elementor or UiChemy still needs installing, the button
      // installs; otherwise both are present and just need activating.
      const needInstall = !det.installed || !uichemyInstalled;
      return needInstall ? 'install' : 'activate';
    }
    if (det.active) return 'continue';
    if (det.installed) return 'activate';
    // Bricks isn't installable from us; the in-card "Get Bricks" link
    // is the only path forward, so the Continue button stays disabled
    // when the user lands on Bricks-not-installed.
    if (builder === 'bricks') return null;
    return 'install';
  }, [builder, detectedMerged, uichemyActive, uichemyInstalled, uichemyUpdate]);

  const builderContinueLabel = useMemo(() => {
    if (continueBusy) {
      const text = builderContinueIntent === 'install' ? __('Installing…', 'uichemy')
        : builderContinueIntent === 'activate' ? __('Activating…', 'uichemy')
          : builderContinueIntent === 'update' ? __('Updating…', 'uichemy')
            : __('Working…', 'uichemy');
      return (
        <>
          <span className="nd-spin"><Icon.Spinner size={13} /></span>
          {text}
        </>
      );
    }
    if (builderContinueIntent === 'install') return __('Install & Activate', 'uichemy');
    if (builderContinueIntent === 'activate') return __('Activate & Continue', 'uichemy');
    if (builderContinueIntent === 'update') return __('Update & Continue', 'uichemy');
    return __('Continue', 'uichemy');
  }, [builderContinueIntent, continueBusy]);

  /**
   * Continue handler for the builder step.
   *
   * Non-Elementor builders: unchanged, if active, just advance (install /
   * activate for those happens via the in-card links).
   *
   * Elementor: this single Continue button drives EVERYTHING the choice
   * needs, it installs/activates Elementor if required AND installs/activates
   * the required UiChemy companion, before advancing to the mode step.
   */
  const handleBuilderContinue = useCallback(async () => {
    setContinueError('');
    if (!builder) return;

    // Non-Elementor builders keep the simple path: only advance when active.
    if (builder !== 'elementor') {
      if (builderContinueIntent === 'continue') {
        await persistThenGo('/builder', { builder }, 'mode');
      }
      return;
    }

    // Elementor + UiChemy both already active → nothing to install, advance.
    if (builderContinueIntent === 'continue') {
      await persistThenGo('/builder', { builder }, 'mode');
      return;
    }

    setContinueBusy(true);
    try {
      // ---- 1. Elementor, install/activate only if it isn't active yet. ----
      const elemDet = detectedMerged.elementor || {};
      if (!elemDet.active) {
        const action = elemDet.installed ? 'activate' : 'install';
        const route = action === 'install'
          ? 'uichemy/v2/system/plugin/install'
          : 'uichemy/v2/system/plugin/activate';
        const res = await requestRoot(route, { method: 'POST', body: { slug: 'elementor' } });

        if (!res || res.success === false) {
          // If WP needs to finish activation in plugins.php (sandboxed
          // include), hand the user the activate URL.
          if (res?.activate_url) {
            showToast(__('Finishing activation in WP-Admin…', 'uichemy'), 'info');
            window.location.href = res.activate_url;
            return;
          }
          const msg = (res && res.message) || sprintf(__('Could not %s Elementor.', 'uichemy'), action);
          setContinueError(msg);
          showToast(msg, 'error');
          return;
        }

        // Merge fresh detected state so the BuilderScreen card flips to Active.
        setDetectedOverride(prev => ({
          ...prev,
          elementor: { installed: true, active: true },
        }));
      }

      // ---- 2. UiChemy, install/activate if needed, or update if a newer
      //         release is available. The install endpoint handles all three. ----
      if (!uichemyActive || uichemyUpdate) {
        const res = await request('uichemy/install', { method: 'POST' });

        // Reflect the server's fresh detection locally so the finish routing
        // doesn't read the stale boot snapshot.
        if (res && (res.action === 'activated' || res.action === 'already_active')) {
          setUiChemyOverride({ ...(res.uichemy || {}), installed: true, active: true });
        } else if (res && res.uichemy) {
          setUiChemyOverride(res.uichemy);
        }

        // Activation threw in-process, WP needs its admin sandbox. Open it in
        // a new tab and keep the user on this step; once they finish there and
        // come back, clicking Continue again resolves to already-active.
        if (res && res.action === 'activate_url' && res.activate_url) {
          showToast(__('Finishing UiChemy activation in WP-Admin…', 'uichemy'), 'info');
          window.open(res.activate_url, '_blank', 'noopener');
          setContinueBusy(false);
          return;
        }
      }

      showToast(__('Elementor and UiChemy are ready.', 'uichemy'), 'success');
      await persistThenGo('/builder', { builder }, 'mode');
    } catch (e) {
      const msg = e?.message || __('Could not finish setup. Please try again.', 'uichemy');
      setContinueError(msg);
      showToast(msg, 'error');
    } finally {
      setContinueBusy(false);
    }
  }, [builder, builderContinueIntent, detectedMerged, uichemyActive, uichemyUpdate, persistThenGo, showToast]);

  // ----- Design-system gallery (dev preview: ?nd_preview=ds-gallery) -----
  if (screen === 'ds-gallery') {
    return (
      <div data-vs="uichemy" data-accent="full">
        <DSGallery />
        <Toast toast={toast} />
        {qaBar}
      </div>
    );
  }

  // ----- Dashboard (post-onboarding) -----
  if (screen === 'dashboard') {
    return (
      <div data-vs="uichemy" data-accent="full">
        {/* No onSwitchLicense: there are no per-site license sessions to switch
            between any more. The profile menu hides that item on its own,
            because the prop is absent (see WebShell's ProfileMenu). */}
        <WebShell>
          <DashboardApp
            builderSlug={builder}
            builder={builderLabel}
            mode={mode}
            siteName={boot?.siteName}
            restFailed={restFailed}
            onBuilderChange={setBuilder}
            onModeChange={setMode}
          />
        </WebShell>
        <Toast toast={toast} />
        {qaBar}
      </div>
    );
  }

  // ----- Login (QA preview only) -----
  //
  // Sign-in is no longer a gate, so nothing routes here on its own: the screen
  // is kept reachable through `?nd_preview=login` (and the QA switcher) so the
  // page can still be reviewed. The live sign-in entry point is the rail's
  // "Activate" button, which starts the same OAuth flow inline.
  //
  // No error query params to translate here: a failed exchange never reaches
  // this screen. Uich_Webpage_Auth::exchange_code_for_token() ends the request
  // with its own wp_die() message, and failures before the redirect are shown
  // by LoginScreen itself.
  if (screen === 'login') {
    return (
      <div data-vs="uichemy" data-accent="full">
        {/* Same grey scene as the onboarding, LoginScreen renders its own
            two-pane card (see .login-flow), so no WizardShell wrapper here. */}
        <div className="nd-onboarding">
          <LoginScreen />
        </div>
        <Toast toast={toast} />
        {qaBar}
      </div>
    );
  }

  // ----- Error cards (calm) -----
  if (screen.startsWith('error:')) {
    const variant = screen.split(':')[1];
    // Variants whose in-card primary action is the only sensible move
    //, hide the wizard footer so users don't reach for "Continue
    // setup" first by mistake.
    const isLocalEnvNeeded = variant === 'local-env-needed';
    const isAppPasswords = variant === 'app-passwords';
    const isUiChemy = variant === 'uichemy';
    const inCardPrimary = isLocalEnvNeeded || isAppPasswords || isUiChemy;

    const REASON_COPY = {
      no_class: __('Your WordPress version is too old (App Passwords need 5.6+).', 'uichemy'),
      // No mention of where the fix control is: this map also feeds the gear
      // menu, where it's a toggle, not a button. See `reasonHint`.
      no_ssl:   __('For security, WordPress enables App Passwords only when your site is set up with HTTPS.', 'uichemy'),
      blocked:  __('A plugin, theme, or wp-config snippet on this site is blocking App Passwords.', 'uichemy'),
      user:     __('Your account is allowed but a site-level rule is blocking App Passwords.', 'uichemy'),
    };

    let resolveHandler;
    let extra = null;
    if (isLocalEnvNeeded) {
      resolveHandler = () => window.location.reload();
      extra = { snippet: boot?.state?.localEnv?.snippet || "define( 'WP_ENVIRONMENT_TYPE', 'local' );" };
    } else if (isAppPasswords) {
      const reason  = boot?.state?.appPassword?.disabledReason || null;
      const blocker = boot?.state?.connection?.security_blocking || null;
      const apState = boot?.state?.appPassword || {};
      extra = {
        // Chip is suppressed once a culprit is named, since the title says it.
        reasonText: (reason && ! blocker) ? REASON_COPY[reason] : null,
        // Only where the override can actually help — not for an outdated WP.
        reasonHint: ( reason && 'no_class' !== reason && apState.canForceEnable )
          ? __('You can still enable it for your account with the button below.', 'uichemy')
          : null,
      };
      if (blocker) {
        // Only Wordfence exposes a setting we can name exactly; for anything
        // else we stop, since a made-up click path is worse than none.
        const wfUrl = boot?.state?.appPassword?.wordfenceUrl || null;
        // createInterpolateElement so the sentence stays one translatable
        // string with the link inline on "All Options".
        const stepOne = wfUrl
          ? createInterpolateElement(
              __('In WP-Admin, go to Wordfence → <a>All Options</a>.', 'uichemy'),
              { a: <a href={wfUrl} target="_blank" rel="noreferrer" /> }
            )
          : __('In WP-Admin, go to Wordfence → All Options.', 'uichemy');
        extra.steps = blocker.type === 'wordfence'
          ? [
              stepOne,
              __('Find Brute Force Protection and expand its advanced options.', 'uichemy'),
              __('Uncheck “Disable WordPress application passwords”.', 'uichemy'),
              __('Save the change, then click Re-check below.', 'uichemy'),
            ]
          : null;
        extra.hooked = (blocker.type === 'unknown' && blocker.hooked && blocker.hooked.length)
          ? blocker.hooked
          : null;
        extra.onRecheck = () => window.location.reload();
      }
      resolveHandler = async () => {
        setForceApBusy(true); setForceApError('');
        try {
          await ajax('uich_nd_enable_app_passwords');
          // Reload so the boot payload reflects the fresh available state
          // and the user lands on the wizard/dashboard cleanly.
          window.location.reload();
        } catch (e) {
          setForceApError(e.message || __('Could not enable Application Passwords.', 'uichemy'));
          setForceApBusy(false);
        }
      };
    } else if (isUiChemy) {
      resolveHandler = async () => {
        setUiChemyBusy(true); setUiChemyError('');
        try {
          const res = await request('uichemy/install', { method: 'POST' });
          // Activation bootstrap needs WP-Admin's sandbox, open it there
          // and let the user finish, then they refresh this screen.
          if (res && res.action === 'activate_url' && res.activate_url) {
            window.open(res.activate_url, '_blank', 'noopener');
            setUiChemyBusy(false);
            return;
          }
          // Installed + activated → reload so boot re-reads UiChemy as active
          // and the gate falls through to the dashboard.
          window.location.reload();
        } catch (e) {
          setUiChemyError(e.message || __('Could not install UiChemy. Please try again.', 'uichemy'));
          setUiChemyBusy(false);
        }
      };
    } else if (variant === 'unreachable' || variant === 'mcp-unreachable') {
      resolveHandler = () => window.location.reload();       // "Retry"
    } else if (variant === 'token-failed') {
      resolveHandler = () => go('login');                    // "Sign in again"
    } else if (variant === 'session') {
      // Only reachable via the `?nd_preview=` QA hatch now — there is no
      // license-session gate left to send the user to, so signing in again
      // is the one sensible move.
      resolveHandler = () => go('login');                    // "Sign in again"
    } else {
      // rest / builder land on the wizard's first step;
      // permalinks renders an href link so its onResolve is never used.
      resolveHandler = () => go(firstWizardScreen);
    }

    // UiChemy: adapt the card copy to whether it's missing vs just inactive.
    // Installed-but-inactive only needs a one-click activate (no download).
    let uichemyOverrides = null;
    if (isUiChemy) {
      const installed = !!boot?.state?.uichemy?.installed;
      uichemyOverrides = installed
        ? {
          title: __('UiChemy is installed but not active', 'uichemy'),
          body: __('UiChemy powers the Composer widget, which turns your prototype into fully editable Elementor sections. Its MCP server lets AI tools like Claude, Cursor and Codex convert Figma designs and build whole pages on your site. Activate it to get started.', 'uichemy'),
          action: __('Activate UiChemy', 'uichemy'),
          busyLabel: __('Activating…', 'uichemy'),
        }
        : null; // default COPY.uichemy already covers the not-installed case.
    }

    // Name the actual culprit on the app-passwords card, and keep the same
    // one-click fix.
    let apOverrides = null;
    if (isAppPasswords) {
      const blocker = boot?.state?.connection?.security_blocking || null;
      const label   = blocker?.label || '';
      if (blocker?.type === 'wordfence') {
        apOverrides = {
          title: __('Wordfence is blocking Application Passwords', 'uichemy'),
          body: __('Wordfence has “Disable WordPress application passwords” switched on, which is its default, so WordPress won\'t let UiChemy connect. Enable it for your account in one click, or turn the option off in Wordfence.', 'uichemy'),
          action: __('Enable for my account', 'uichemy'),
          busyLabel: __('Enabling…', 'uichemy'),
        };
      } else if (label) {
        apOverrides = {
          /* translators: %s: name of the plugin blocking Application Passwords. */
          title: sprintf(__('%s is blocking Application Passwords', 'uichemy'), label),
          body: __('WordPress Application Passwords are switched off on this site, which is what UiChemy connects with. Enable them for your account in one click, or change the setting in that plugin.', 'uichemy'),
          action: __('Enable for my account', 'uichemy'),
          busyLabel: __('Enabling…', 'uichemy'),
        };
      } else if (blocker) {
        apOverrides = {
          title: __('Application Passwords are being blocked', 'uichemy'),
          body: __('Something on this site is switching off WordPress Application Passwords, which is what UiChemy connects with. Enabling them for your account usually resolves it.', 'uichemy'),
          action: __('Enable for my account', 'uichemy'),
          busyLabel: __('Enabling…', 'uichemy'),
        };
      }
    }

    return (
      <div data-vs="uichemy" data-accent="full">
        <WPChrome>
          <div className="wizwrap">
            <WizardShell
              compact
              noProgress
              backHidden
              hideFooter={inCardPrimary}
              onNext={inCardPrimary ? null : () => go(firstWizardScreen)}
              nextLabel={__('Continue setup', 'uichemy')}
              nextVariant="secondary"
            >
              <ErrorCard
                variant={variant}
                onResolve={resolveHandler}
                extra={extra}
                overrides={uichemyOverrides || apOverrides}
                busy={isUiChemy ? uichemyBusy : (isAppPasswords && forceApBusy)}
                errorMessage={isUiChemy ? uichemyError : (isAppPasswords ? forceApError : '')}
              />
            </WizardShell>
          </div>
        </WPChrome>
        <Toast toast={toast} />
        {qaBar}
      </div>
    );
  }

  // ----- Env-blocked -----
  if (screen.startsWith('env:')) {
    const variant = screen.split(':')[1];
    return (
      <div data-vs="uichemy" data-accent="full">
        <WPChrome>
          <div className="wizwrap">
            <WizardShell compact noProgress backHidden onNext={() => go(firstWizardScreen)} nextLabel={__('Re-run checks', 'uichemy')} nextVariant="secondary">
              <EnvBlocked variant={variant} env={boot?.state?.env} onContinue={() => go(firstWizardScreen)} />
            </WizardShell>
          </div>
        </WPChrome>
        <Toast toast={toast} />
        {qaBar}
      </div>
    );
  }

  // ----- Wizard -----
  // The wizard is 3 steps for everyone: Page Builder → Mode → Connect.
  // UiChemy is no longer a standalone step, it's a required companion of
  // the Elementor builder, installed from the builder step's Continue button.
  // Two steps when the chosen mode has nothing to connect (Scratch to
  // WordPress), the rail updates the moment that card is picked.
  // Numbered steps begin at "About you"; Welcome is a pre-step (no counter).
  const totalSteps = modeIsPending ? 3 : 4;
  const stepPersonalize = 0;
  const stepBuilder = 1;
  const stepMode = 2;
  const stepConnect = 3;

  /** Finish onboarding and land on the dashboard. */
  const finishOnboarding = () => persistThenGo(
    '/onboarded',
    { done: true, consent },
    'dashboard',
  );

  let inner = null;
  if (screen === 'welcome') {
    inner = (
      <WizardShell
        noProgress
        backHidden
        // Enter the two-pane /setup flow (Personalize → Mode → Builder → Connect).
        // go('dashboard') mounts DashboardApp; FirstRunGate (onboarded === false)
        // redirects to /setup. The old full-page WizardShell steps are retired.
        onNext={() => go('dashboard')}
        nextLabel={__('Get Started', 'uichemy')}
      >
        <WelcomeScreen />
      </WizardShell>
    );
  } else if (screen === 'personalize') {
    inner = (
      <WizardShell
        step={stepPersonalize}
        total={totalSteps}
        railName={__('About you', 'uichemy')}
        title={__('What best describes you?', 'uichemy')}
        subtitle={__('We’ll tailor the setup to how you work. You can change anything later.', 'uichemy')}
        onBack={() => go('welcome')}
        onNext={() => {
          try { localStorage.setItem('uich_nd_persona', persona); } catch (_) { /* ignore */ }
          // Pre-select the persona's recommended mode when the user hasn't
          // already picked one and it's compatible with the chosen builder.
          const rec = personaById(persona)?.mode;
          if (rec && !mode && modeSupportsBuilder(rec, builder)) setMode(rec);
          go('builder');
        }}
        nextDisabled={!persona}
      >
        <PersonalizeScreen selected={persona} onSelect={setPersona} />
      </WizardShell>
    );
  } else if (screen === 'builder') {
    inner = (
      <WizardShell
        step={stepBuilder}
        total={totalSteps}
        railName={__('Page Builder', 'uichemy')}
        title={__('Which builder do you build in?', 'uichemy')}
        subtitle={__('Your design converts into editable elements in the builder you pick.', 'uichemy')}
        onBack={() => go('personalize')}
        onNext={handleBuilderContinue}
        nextLabel={builderContinueLabel}
        nextDisabled={!builder || builderContinueIntent === null || continueBusy}
        nextChevronHidden={continueBusy || builderContinueIntent !== 'continue'}
        footerNote={continueError || undefined}
      >
        <BuilderScreen
          detected={detectedMerged}
          selected={builder}
          onSelect={setBuilder}
          uichemy={{ active: uichemyActive, installed: uichemyInstalled, update_available: uichemyUpdate, latest_version: uichemyDet.latest_version }}
        />
      </WizardShell>
    );
  } else if (screen === 'mode') {
    inner = (
      <WizardShell
        step={stepMode}
        total={totalSteps}
        railName={__('Mode', 'uichemy')}
        title={__('How will you use UiChemy?', 'uichemy')}
        subtitle={__('Most designers pick the Figma plugin. You can switch anytime.', 'uichemy')}
        onBack={() => go('builder')}
        onNext={async () => {
          // Persist the mode either way; a pending mode then finishes here
          // instead of advancing to a Connect step it has no use for.
          try { await request('/mode', { method: 'POST', body: { mode } }); }
          catch (e) { console.warn('[nd] persist failed /mode', e); }
          if (modeIsPending) { await finishOnboarding(); return; }
          go('connect');
        }}
        nextLabel={modeIsPending ? __('Open Dashboard', 'uichemy') : undefined}
        nextDisabled={!mode}
      >
        <ModeScreen builder={builder} selected={mode} onSelect={setMode} />
      </WizardShell>
    );
  } else if (screen === 'connect' || screen.startsWith('connect:')) {
    const forcedBranch = screen.startsWith('connect:') ? screen.split(':')[1] : null;
    const effectiveMode = forcedBranch === 'compose' ? 'compose' : forcedBranch === 'figma' ? 'figma' : mode;
    const isFigma = effectiveMode !== 'compose';
    inner = (
      <WizardShell
        step={stepConnect}
        total={totalSteps}
        railName={__('Connect', 'uichemy')}
        title={isFigma ? __('Connect your WordPress site', 'uichemy') : __('Connect your AI agent', 'uichemy')}
        subtitle={isFigma
          ? __('Copy your Connection Link and paste it into the UiChemy plugin in Figma.', 'uichemy')
          : __('Drop this config into Claude, Cursor or Codex to start converting.', 'uichemy')}
        onBack={() => go('mode')}
        onNext={finishOnboarding}
        nextLabel={__('Open Dashboard', 'uichemy')}
      >
        <ConnectScreen mode={effectiveMode} builder={builder || 'elementor'} boot={boot} />
      </WizardShell>
    );
  }

  return (
    <div data-vs="uichemy" data-accent="full">
      <WPChrome>
        <div className="wizwrap">
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>{inner}</div>
        </div>
      </WPChrome>
      <Toast toast={toast} />
      {qaBar}
    </div>
  );
}
