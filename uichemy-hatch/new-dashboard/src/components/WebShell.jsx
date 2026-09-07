import React, { useEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { Logo, Gear, Key, Warn, LogOut, ChevD, Refresh, Crown } from './icons.jsx';
import { Switch, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from '../design-system';
import { ajax, getBoot } from '../lib/api.js';
import { data as dashData } from '../uichemy-composer/admin/data.js';

const REASON_COPY = {
  no_class:  __('Your WordPress version is too old (App Passwords need 5.6+).', 'uichemy'),
  no_ssl:    __('For security, WordPress enables App Passwords only when your site is set up with HTTPS.', 'uichemy'),
  blocked:   __('A plugin, theme, or wp-config snippet on this site is blocking App Passwords.', 'uichemy'),
  user:      __('Your account is allowed but a site-level rule is blocking App Passwords.', 'uichemy'),
};

/**
 * Top-bar settings dropdown. Renders ONLY when Application Passwords
 * are currently unavailable, once they work (natively or via our
 * force override), the gear hides because there's nothing to toggle.
 */
export function SettingsMenu() {
  const boot = getBoot();
  const initial = boot?.state?.appPassword || {};
  const [ap, setAp] = useState({
    available:       !!initial.available,
    forceEnabled:    !!initial.forceEnabled,
    canForceEnable:  !!initial.canForceEnable,
    canForceDisable: !!initial.canForceDisable,
    disabledReason:  initial.disabledReason || null,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Hide entirely when App Passwords are working AND there's no
  // override to undo. Per spec: gear only shows when app passwords are
  // deactivated for the current account.
  if (ap.available && !ap.canForceDisable) return null;

  const apply = (data) => {
    setAp({
      available:       !!data.available,
      forceEnabled:    !!data.forceEnabled,
      canForceEnable:  !!data.canForceEnable,
      canForceDisable: !!data.canForceDisable,
      disabledReason:  data.disabledReason || null,
    });
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const action = ap.forceEnabled
        ? 'uich_nd_disable_app_passwords'
        : 'uich_nd_enable_app_passwords';
      const data = await ajax(action);
      apply(data);
    } catch (e) {
      setErr(e.message || __('Could not update Application Passwords.', 'uichemy'));
    } finally {
      setBusy(false);
    }
  };

  const reasonText = ap.disabledReason ? REASON_COPY[ap.disabledReason] : null;

  return (
    <div className="web-bar__settings" ref={wrapRef}>
      <button
        type="button"
        className="web-bar__gear"
        onClick={() => setOpen((v) => !v)}
        aria-label={__('Settings', 'uichemy')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Gear size={18}/>
      </button>
      {open ? (
        <div className="web-bar__menu" role="menu">
          <div className="web-bar__menu-head">{__('Settings', 'uichemy')}</div>
          <div className="web-bar__menu-row">
            <span className="web-bar__menu-ic"><Key size={14}/></span>
            <span className="web-bar__menu-text">
              <b>{__('Force-enable Application Passwords', 'uichemy')}</b>
              <small>
                {ap.forceEnabled
                  ? __('UiChemy is overriding the site to allow App Passwords for your account.', 'uichemy')
                  : (reasonText || __('Application Passwords are currently unavailable on this site.', 'uichemy'))}
              </small>
            </span>
            <Switch
              checked={ap.forceEnabled}
              aria-label={__('Force-enable Application Passwords', 'uichemy')}
              disabled={busy}
              onCheckedChange={toggle}
            />
          </div>
          {err ? (
            <div className="web-bar__menu-msg">
              <Warn size={12}/> <span>{err}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProfileMenu({ onSwitchLicense }) {
  const boot = getBoot();
  const user = boot?.auth?.licenseData?.data?.user || boot?.auth?.licenseData?.user || null;
  // Only offer "Switch license" when the account actually has more than one
  // usable (active/inactive) license to switch between.
  const allLicenses = boot?.auth?.licenseData?.data?.licenses || boot?.auth?.licenseData?.licenses || [];
  const canSwitch = allLicenses.filter((l) => l.status === 'active' || l.status === 'inactive').length > 1;

  /*
   * "Upgrade to Pro" — the BUY link, and nothing else.
   *
   * It used to be a card at the bottom of the rail, which put it next to the
   * activation card and made two different things look like one: buying a
   * licence you don't have vs. switching on a plugin you do. The rail now owns
   * only the second (see DashShell's RailActivate); the purchase lives here,
   * in the profile menu, where it is a link rather than a pitch.
   *
   * `uichemy_is_pro()` via window.uichemyDashboard is the single source of truth
   * — a paid site must never be sold what it already owns.
   */
  const showUpgrade = !dashData.isPro;
  const upgradeUrl =
    dashData.upgradeUrl || boot?.urls?.pricing || boot?.urls?.upgrade || 'https://uichemy.com/pricing/';
  const gravatar = boot?.user?.gravatar || '';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const form = new URLSearchParams();
      form.set('action', 'uich_nd_sso_logout');
      form.set('nonce', boot?.auth?.logoutNonce || '');
      await fetch(boot.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: form.toString(),
      });
      window.location.reload();
    } catch (e) {
      setErr(e.message || 'Could not disconnect.');
      setBusy(false);
    }
  };

  const displayName = user?.name
    ? user.name.charAt(0).toUpperCase() + user.name.slice(1)
    : 'Admin';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <Menu>
      {/* No asChild: let the Radix Trigger render its own <button>, so there is
          no Slot to choke on the children. The whole card is the trigger –
          avatar + name/email + a chevron that hints it opens a menu. */}
      <MenuTrigger
        type="button"
        className="nd-acctbtn"
        aria-label={__('Profile', 'uichemy')}
      >
        <span className="nd-acctbtn__avatar">
          {gravatar && !imgFailed ? (
            <img src={gravatar} alt="" onError={() => setImgFailed(true)} />
          ) : (
            initial
          )}
        </span>
        <span className="nd-acctbtn__who">
          <b>{displayName}</b>
          {user?.email ? <span>{user.email}</span> : null}
        </span>
        <ChevD size={15} className="nd-acctbtn__chev" />
      </MenuTrigger>
      {/* Anchored to the rail avatar (bottom-left): open UPWARD and align the
          menu's LEFT edge to the trigger so it stays inside the rail instead of
          spilling left over the WP admin menu. */}
      <MenuContent side="top" align="start" sideOffset={8}>
        {/* Head uses --uc-* tokens (inline) because the menu portals to <body>,
            outside #uich-new-dash where the legacy --ink tokens live. */}
        <div style={{ padding: '4px 10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 500, color: 'var(--uc-text-strong)', fontSize: 'var(--uc-text-sm)' }}>{displayName}</span>
          {user?.email ? <span style={{ color: 'var(--uc-text-muted)', fontSize: 'var(--uc-text-xs)' }}>{user.email}</span> : null}
        </div>
        <MenuSeparator />
        {/* Both rows are conditional, so the trailing separator is too — a Pro
            site with a single license renders neither, and two separators back
            to back would draw a double rule above Sign Out. */}
        {canSwitch && onSwitchLicense ? (
          <MenuItem onSelect={() => onSwitchLicense()}>
            <Refresh size={13}/> {__('Switch License', 'uichemy')}
          </MenuItem>
        ) : null}
        {showUpgrade ? (
          <MenuItem onSelect={() => window.open(upgradeUrl, '_blank', 'noopener')}>
            <Crown size={13}/> {__('Upgrade to Pro', 'uichemy')}
          </MenuItem>
        ) : null}
        {(canSwitch && onSwitchLicense) || showUpgrade ? <MenuSeparator /> : null}
        <MenuItem danger onSelect={(e) => { e.preventDefault(); logout(); }}>
          <LogOut size={13}/> {busy ? __('Signing out…', 'uichemy') : __('Sign Out', 'uichemy')}
        </MenuItem>
        {err ? (
          <div style={{ padding: '4px 10px', color: 'var(--uc-danger-fg)', fontSize: 'var(--uc-text-xs)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Warn size={11}/> {err}
          </div>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

/**
 * Dashboard frame. The dark top bar is gone: brand and account now live in the
 * sidebar rail (see DashShell), Lovable-style. This stays a thin wrapper so the
 * `.web` page ground and the dashboard-only body class keep resolving.
 * SettingsMenu / ProfileMenu are exported above for the rail to render.
 */
export default function WebShell({ children }) {
  return <div className="web web--dash">{children}</div>;
}
