import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from './icons.jsx';
import { BrandFull, BrandIcon } from './brand-logos.jsx';
import { ProfileMenu } from './WebShell.jsx';
import { Badge, Button } from '../design-system';
import { getBoot, isAuthed, startSignIn } from '../lib/api.js';
import { useAppPassword } from '../lib/app-password.js';
import { useProSetup } from '../dashboard/use-pro-setup.js';
import { data as dashData } from '../uichemy-composer/admin/data.js';
import { SECTIONS, tabsInSection } from '../dashboard/tabs.js';
import { computeHealth } from '../dashboard/health.js';
import HealthBanner from '../screens/dashboard/HealthNotices.jsx';

/** Remember the rail's collapsed state across reloads. */
const RAIL_KEY = 'uich_nd_rail_collapsed';

/**
 * True when UiChemy Pro is active. PHP is the single source of truth, the flag
 * comes from uichemy_is_pro() via window.uichemyDashboard (see
 * Uich_ND_Enqueue::enqueue_builder_screen_deps). The rail's Pro affordance is
 * the crown on locked nav rows; the "Upgrade to Pro" purchase link moved into
 * the profile menu (see WebShell's ProfileMenu). Both answer this, otherwise a
 * paid site keeps getting sold what it already owns.
 */
const isPro = () => !! dashData.isPro;

/**
 * Post-onboarding dashboard frame: a full-height grey sidebar rail plus the
 * active screen. Lovable-style, the rail owns everything: brand at the top,
 * screen navigation in the middle, and the account (settings + profile) pinned
 * at the bottom. There is no separate top bar anymore (see WebShell).
 *
 * Rows for `pending` tabs stay CLICKABLE: they land on Placeholder, which says
 * what's coming. A disabled row would leave the user guessing whether the tab
 * is broken.
 */

function ItemMeta( { tab } ) {
  return (
    <>
      { tab.pro && ! isPro() ? (
        <span className="nd-side-nav__lock" title="Pro">
          <Icon.Crown size={ 13 } />
        </span>
      ) : null }
      { tab.badge ? <span className="nd-side-nav__badge">{ tab.badge }</span> : null }
      { tab.pending ? <span className="nd-side-nav__soon">Soon</span> : null }
    </>
  );
}

function NavItem( { tab } ) {
  const IconEl = tab.icon;
  return (
    <NavLink
      to={ tab.path }
      end={ tab.path === '/' }
      title={ tab.label }
      className={ ( { isActive } ) => `nd-side-nav__item${ isActive ? ' nd-side-nav__item--on' : '' }` }
    >
      <span className="nd-side-nav__ic"><IconEl size={ 17 } /></span>
      <span className="nd-side-nav__label">{ tab.label }</span>
      <ItemMeta tab={ tab } />
    </NavLink>
  );
}

/**
 * A labelled block of the rail, the heading is a quiet caption above its rows;
 * when the rail is collapsed the caption hides (CSS) and only the icons remain.
 * A section with no tabs renders nothing, so pruning its last tab can't leave a
 * dangling label.
 */
function NavSection( { section } ) {
  const items = tabsInSection( section.id );
  if ( ! items.length ) return null;
  return (
    <div className="nd-side-nav__sec">
      { section.label ? <div className="nd-side-nav__seclabel">{ section.label }</div> : null }
      { items.map( ( tab ) => (
        <NavItem key={ tab.key } tab={ tab } />
      ) ) }
    </div>
  );
}

/**
 * A slim "Get set up · N/3" progress block pinned in the rail. Reads the three
 * core setup steps from boot / app-password state and links to the in-dashboard
 * /setup flow. Hides itself once all three are done.
 */
function RailSetup() {
  const boot = getBoot();
  const ap = useAppPassword();
  const builders = boot?.state?.builders || {};
  const done = [
    !! boot?.state?.builder || Object.values( builders ).some( ( b ) => b?.active ),
    !! boot?.state?.mode,
    ap.hasToken,
  ].filter( Boolean ).length;

  /*
   * Finishing the wizard dismisses this for good.
   *
   * The three checks below are live conditions, not a record of what the user
   * did — an App Password can be revoked, a builder deactivated. Without this
   * the block reappeared in the rail after onboarding was completed, nagging
   * about steps the user had already been through. `onboarded` is the persisted
   * answer to "have they done this?" (option uich_nd_onboarded), so it wins.
   *
   * /setup stays reachable from the nav for anyone who wants to revisit it.
   */
  if ( boot?.state?.onboarded ) return null;
  if ( done >= 3 ) return null;
  const pct = Math.round( ( done / 3 ) * 100 );
  return (
    <NavLink to="/setup" className="nd-side__setup" title={ __( 'Finish setup', 'uichemy' ) }>
      <div className="nd-side__setup-top">
        <span className="nd-side__setup-label">{ __( 'Get set up', 'uichemy' ) }</span>
        <span className="nd-side__setup-count">{ done }/3</span>
      </div>
      <div className="nd-side__setup-bar"><span style={ { width: `${ pct }%` } } /></div>
    </NavLink>
  );
}

/**
 * Account block pinned to the very bottom of the rail: profile avatar (opens
 * the ProfileMenu, name/email, Switch License, Sign Out) and the user's name +
 * email inline. The App-Passwords "force-enable" control used to live here as a
 * gear; it now sits inline in the Connect panel (where a blocked password stops
 * the user) and permanently under Settings. Collapsed rail shows just the
 * avatar (CSS).
 */
function RailAccount( { onSwitchLicense } ) {
  // Nothing to show while signed out: the card would name an account that isn't
  // connected and its menu would offer a Sign Out with nothing to sign out of.
  // RailActivateCard, just above, carries the sign-in until one is.
  if ( ! isAuthed() ) return null;
  return (
    <div className="nd-side__acct">
      <ProfileMenu onSwitchLicense={ onSwitchLicense } />
    </div>
  );
}

/**
 * The activation card, sitting just above the profile block.
 *
 * ONE card, one action, in the white-card-with-a-travelling-glow-ring treatment
 * the old "Upgrade to Pro" card had. This one walks through everything that can
 * be switched on, in order:
 *
 *   1. UiChemy Pro not active  → "Install & Activate" (download, install, on).
 *   2. Pro on but out of date  → "Update now" (same endpoint; the server sees
 *                                 the installed version is behind the one the
 *                                 API publishes and overwrite-installs it).
 *   3. Pro on, no account yet  → "Activate" (the PKCE OAuth sign-in).
 *   4. Signed in, not purchased → "Upgrade to Pro" (see needsUpgrade below).
 *   5. All done                 → nothing renders.
 *
 * One at a time, deliberately: two orange CTAs stacked in a 256px rail makes the
 * user pick between them, and these are sequential anyway — Pro is what the site
 * needs, the account is what the AI Website Creator needs, and a purchase is
 * what the ACCOUNT needs once it's connected. Whichever is missing is the only
 * thing asked for. The plain buy link also still lives in the profile menu (see
 * WebShell's ProfileMenu) for a signed-in, purchased account that just wants to
 * browse plans — that one is never a nag, only this card is.
 *
 * Step 1 is skipped when no package URL is configured — a button that can only
 * fail is worse than no button. The onboarding step has room to explain that
 * case; the rail does not.
 */
function RailActivateCard() {
  const pset = useProSetup();
  const authed = isAuthed();
  const capacity = getBoot()?.auth?.capacity || { plan: '', purchased: true };

  const [ signBusy, setSignBusy ] = useState( false );
  const [ signErr, setSignErr ] = useState( '' );

  const needsPro = ! pset.unlocked && pset.zipConfigured;
  // An installed-but-outdated Pro. Same zip gate: without a package URL there is
  // nothing an Update button could fetch.
  const needsProUpdate = ! needsPro && pset.needsUpdate && pset.zipConfigured;
  /**
   * Signed in, the Pro plugin itself needs nothing — but the connected account
   * never actually bought a paid plan (see Uich_ND_Auth::get_capacity_plan()).
   * `active` alone satisfies needsPro/needsProUpdate above, since installing and
   * activating the plugin is unrestricted; this is the separate, account-side
   * check that catches "switched on, never purchased".
   */
  const needsUpgrade = ! needsPro && ! needsProUpdate && authed && ! capacity.purchased;

  if ( ! needsPro && ! needsProUpdate && ! needsUpgrade && authed ) return null;

  const upgradeUrl =
    dashData.upgradeUrl || getBoot()?.urls?.pricing || getBoot()?.urls?.upgrade || 'https://uichemy.com/pricing/';

  const signIn = async () => {
    if ( signBusy ) return;
    setSignBusy( true );
    setSignErr( '' );
    try {
      // Resolves only on failure — success has already navigated away.
      await startSignIn( '#/ai-website' );
    } catch ( e ) {
      setSignErr( ( e && e.message ) || __( 'Could not start the sign-in. Please try again.', 'uichemy' ) );
      setSignBusy( false );
    }
  };

  // Pro first (install, then update), then the account.
  const view = needsProUpdate
    ? {
      icon: Icon.Crown,
      title: __( 'UiChemy Pro update', 'uichemy' ),
      // The version being offered, so the card says what "update" means here.
      badge: pset.latestVersion
        ? sprintf( __( 'v%s', 'uichemy' ), pset.latestVersion )
        : null,
      sub: __( 'A newer UiChemy Pro is available. Your licence and settings are kept.', 'uichemy' ),
      cta: __( 'Update now', 'uichemy' ),
      ctaIcon: Icon.Refresh,
      busy: pset.busy,
      busyLabel: __( 'Updating…', 'uichemy' ),
      err: pset.error,
      onAction: () => pset.run(),
    }
    : needsPro
    ? {
      icon: Icon.Crown,
      // Names the PLUGIN, not the tier. "UiChemy Pro" alone reads as a plan you
      // buy; this card installs a plugin, and saying so is what makes the
      // Install button below make sense.
      title: __( 'UiChemy Pro Plugin', 'uichemy' ),
      // Where the site stands right now, which is the reason the card is here.
      // Neutral, not a warning — being on Free isn't a problem to fix.
      badge: __( 'Free', 'uichemy' ),
      sub: pset.installed
        ? __( 'It’s already installed on this site, it just needs switching on.', 'uichemy' )
        : __( 'Unlock Theme Builder, Role Manager and White Label. We’ll install it for you.', 'uichemy' ),
      cta: pset.installed ? __( 'Activate', 'uichemy' ) : __( 'Install & Activate', 'uichemy' ),
      // Download for a fetch-and-install, power for a flip-the-switch.
      ctaIcon: pset.installed ? Icon.Power : Icon.Import,
      busy: pset.busy,
      busyLabel: pset.installed ? __( 'Activating…', 'uichemy' ) : __( 'Installing…', 'uichemy' ),
      err: pset.error,
      onAction: () => pset.run(),
    }
    : ! authed
    ? {
      icon: Icon.Sparkles,
      title: __( 'Activate UiChemy', 'uichemy' ),
      sub: __( 'Sign in & Activate UiChemy to get the best out of it.', 'uichemy' ),
      cta: __( 'Activate', 'uichemy' ),
      ctaIcon: Icon.ExtLink,
      busy: signBusy,
      busyLabel: __( 'Opening…', 'uichemy' ),
      err: signErr,
      onAction: signIn,
    }
    : {
      // needsUpgrade: everything local is switched on, the account just never
      // bought a plan. A link, not a run() call — there is nothing this site
      // can do about it, only the account can.
      //
      // No plan-tier badge here on purpose: naming the account's current tier
      // reads as a status report, not a pitch. The sub line sells forward —
      // what upgrading unlocks — instead of stating where they already are.
      icon: Icon.Crown,
      title: __( 'Upgrade to Pro', 'uichemy' ),
      sub: __( 'Get more AI credits, extra seats, priority support and advanced tools like Role Manager and White Label.', 'uichemy' ),
      cta: __( 'Upgrade Now', 'uichemy' ),
      ctaIcon: Icon.Crown,
      busy: false,
      busyLabel: '',
      err: '',
      onAction: () => window.open( upgradeUrl, '_blank', 'noopener' ),
    };

  const IconEl = view.icon;
  const CtaIconEl = view.ctaIcon;

  return (
    <div className="nd-procard-wrap">
      <div className="nd-procard">
        <span className="nd-procard__head">
          <IconEl size={ 15 } />
          <b>{ view.title }</b>
          { view.badge ? (
            <Badge tone="neutral" variant="soft" className="nd-procard__tier">
              { view.badge }
            </Badge>
          ) : null }
        </span>
        <span className="nd-procard__sub">{ view.sub }</span>

        { view.err ? <span className="nd-procard__err">{ view.err }</span> : null }

        <Button
          variant="solid"
          tone="brand"
          size="sm"
          className="nd-procard__cta"
          onClick={ view.onAction }
          loading={ view.busy }
          title={ view.cta }
        >
          {/* The icon is what survives in the collapsed rail: the label span is
              hidden there, leaving a square icon button rather than a clipped
              string. Hidden from AT because the button's own title names it. */}
          <CtaIconEl size={ 13 } aria-hidden="true" />
          <span className="nd-procard__cta-label">
            { view.busy ? view.busyLabel : view.cta }
          </span>
        </Button>
      </div>
    </div>
  );
}

export default function DashShell( { children, onSwitchLicense, restFailed = false } ) {
  const issues = computeHealth( getBoot(), { restFailed } );
  const [ collapsed, setCollapsed ] = useState( () => {
    try { return localStorage.getItem( RAIL_KEY ) === '1'; } catch ( _ ) { return false; }
  } );

  const toggle = () => {
    setCollapsed( ( v ) => {
      const next = ! v;
      try { localStorage.setItem( RAIL_KEY, next ? '1' : '0' ); } catch ( _ ) { /* ignore */ }
      return next;
    } );
  };

  return (
    <div className={ `nd-shell${ collapsed ? ' nd-shell--collapsed' : '' }` }>
      <aside className="nd-shell__side">
        <div className="nd-side__brand">
          {/* Two logos: full wordmark when expanded, icon-only when collapsed.
              CSS shows exactly one (see .nd-side__logo--full / --icon). */}
          <span className="nd-side__logo nd-side__logo--full"><BrandFull /></span>
          <span className="nd-side__logo nd-side__logo--icon"><BrandIcon /></span>
          <Button
            variant="ghost"
            tone="neutral"
            size="sm"
            iconOnly
            className="nd-side__collapse"
            onClick={ toggle }
            aria-label={ collapsed ? 'Expand sidebar' : 'Collapse sidebar' }
            title={ collapsed ? 'Expand sidebar' : 'Collapse sidebar' }
          >
            <Icon.PanelLeft size={ 17 } />
          </Button>
        </div>

        <nav className="nd-side-nav" aria-label="Dashboard">
          { SECTIONS.map( ( section ) => (
            <NavSection key={ section.id } section={ section } />
          ) ) }
        </nav>

        <RailSetup />
        <RailActivateCard />
        <RailAccount onSwitchLicense={ onSwitchLicense } />
      </aside>

      <main className="nd-shell__main">
        <HealthBanner issues={ issues } />
        { children }
      </main>
    </div>
  );
}
