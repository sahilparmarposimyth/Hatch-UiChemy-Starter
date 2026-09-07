import React, { useEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from './icons.jsx';
import { BrandFull } from './brand-logos.jsx';
import { Button, Menu, MenuTrigger, MenuContent, MenuItem } from '../design-system';
import { getBoot, ajax } from '../lib/api.js';

const WIZ_STEPS = [__('Page Builder', 'uichemy'), __('Mode', 'uichemy'), __('Connect', 'uichemy')];

function ProgressRail({ step, total = WIZ_STEPS.length, name }) {
  const segs = [];
  for (let i = 0; i < total; i++) {
    const cls =
      i < step ? 'rail__seg rail__seg--done'
      : i === step ? 'rail__seg rail__seg--active'
      : 'rail__seg';
    segs.push(<span className={cls} key={i} />);
  }
  const num = String(step + 1).padStart(2, '0');
  const tot = String(total).padStart(2, '0');
  return (
    <div className="rail">
      <div className="rail__top">
        <span className="rail__step">{sprintf(__('Step %1$s / %2$s', 'uichemy'), num, tot)}</span>
        <span className="rail__name">{name || WIZ_STEPS[step] || ''}</span>
      </div>
      <div className="rail__track">{segs}</div>
    </div>
  );
}

function WizProfileMenu() {
  const boot = getBoot();
  // Use the UiChemy account user from the licenses/user API response,
  // not the WordPress site user.
  const user = boot?.auth?.licenseData?.data?.user || boot?.auth?.licenseData?.user || null;
  const isAuthed = boot?.auth?.isAuthed;
  const gravatar = boot?.user?.gravatar || '';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  if (!isAuthed) return null;

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
      <MenuTrigger
        type="button"
        className="wiz-profile__avatar"
        aria-label={__('Profile', 'uichemy')}
      >
        {gravatar && !imgFailed ? (
          <img
            src={gravatar}
            alt=""
            className="wiz-profile__avatar-img"
            onError={() => setImgFailed(true)}
          />
        ) : (
          initial
        )}
      </MenuTrigger>
      <MenuContent align="end" sideOffset={8}>
        {/* Inline --uc-* styles: the menu portals to <body>, outside #uich-new-dash. */}
        <div style={{ padding: '4px 10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 500, color: 'var(--uc-text-strong)', fontSize: 'var(--uc-text-sm)' }}>{displayName}</span>
          {user?.email ? <span style={{ color: 'var(--uc-text-muted)', fontSize: 'var(--uc-text-xs)' }}>{user.email}</span> : null}
        </div>
        <MenuItem danger onSelect={(e) => { e.preventDefault(); logout(); }}>
          <Icon.LogOut size={13}/> {busy ? __('Signing out…', 'uichemy') : __('Sign Out', 'uichemy')}
        </MenuItem>
        {err ? (
          <div style={{ padding: '4px 10px', color: 'var(--uc-danger-fg)', fontSize: 'var(--uc-text-xs)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Icon.Warn size={11}/> {err}
          </div>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

function BrandTop() {
  return (
    <div className="wiz-top">
      <div className="wiz-brand">
        <BrandFull />
      </div>
      <div className="wiz-top__help">
        <a href="https://uichemy.com/docs" target="_blank" rel="noreferrer"><Icon.Book size={13}/> {__('Docs', 'uichemy')}</a>
        <a href="https://uichemy.com/chat" target="_blank" rel="noreferrer"><Icon.Help size={13}/> {__('Help', 'uichemy')}</a>
        <WizProfileMenu />
      </div>
    </div>
  );
}

export default function WizardShell({
  step, total, railName, title, subtitle, children,
  onBack, onNext, nextLabel = __('Continue', 'uichemy'), nextDisabled, nextVariant = 'primary',
  nextChevronHidden = false,
  backHidden, footerNote, noProgress, hideFooter, compact,
}) {
  return (
    <div className="wiz">
      <BrandTop />
      <div className={`wiz-card${compact ? ' wiz-card--compact' : ''}`}>
        {!noProgress && typeof step === 'number' ? <ProgressRail step={step} total={total} name={railName} /> : null}
        <div className="wiz-body">
          {title ? (
            <div className="wiz-head">
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          ) : null}
          <div className="wiz-content">{children}</div>
        </div>
        {!hideFooter ? (
          <footer className="wiz-foot">
            {backHidden || !onBack
              ? <span />
              : <Button variant="outline" tone="neutral" onClick={onBack}><Icon.ChevL size={14}/> {__('Back', 'uichemy')}</Button>}
            {footerNote ? <span className="wiz-foot__note">{footerNote}</span> : <span />}
            {onNext
              ? <Button
                  variant={nextVariant === 'secondary' ? 'outline' : 'solid'}
                  tone={nextVariant === 'secondary' ? 'neutral' : 'brand'}
                  onClick={onNext}
                  disabled={nextDisabled}
                >
                  {nextLabel}{nextVariant === 'primary' && !nextChevronHidden ? <Icon.ChevR size={14}/> : null}
                </Button>
              : <span />}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
