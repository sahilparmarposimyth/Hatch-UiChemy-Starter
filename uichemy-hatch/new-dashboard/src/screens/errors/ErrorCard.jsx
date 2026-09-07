import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Button, Alert } from '../../design-system';
import { copyText } from '../../lib/api.js';

// Each state carries its own glyph + severity so it reads at a glance instead
// of a generic warning triangle. `tone` drives the severity dot + eyebrow:
// warn = fixable, danger = blocking/setup, info = non-blocking heads-up.
const COPY = {
  rest: {
    tone: 'warn', icon: Icon.Server,
    title: __('REST API is blocked', 'uichemy'),
    body: __('A plugin or your host is blocking WordPress\'s REST API. UiChemy can\'t connect until it\'s reachable.', 'uichemy'),
    action: __('Show me how to fix', 'uichemy'),
  },
  'app-passwords': {
    tone: 'warn', icon: Icon.Key,
    title: __('Application Passwords are disabled', 'uichemy'),
    body: __('WordPress Application Passwords are turned off on this site. UiChemy needs them to connect the Figma plugin or MCP client.', 'uichemy'),
    action: __('Enable for my account', 'uichemy'),
    busyLabel: __('Enabling…', 'uichemy'),
  },
  'local-env-needed': {
    tone: 'warn', icon: Icon.Terminal,
    title: __('WP_ENVIRONMENT_TYPE is not set to “local”', 'uichemy'),
    body: __('You\'re on a localhost site. Add the line below to wp-config.php, then click Re-check.', 'uichemy'),
    action: __('Re-check', 'uichemy'),
  },
  'not-admin': {
    tone: 'warn', icon: Icon.UserShield, eyebrow: __('Access required', 'uichemy'),
    title: __('Administrator access required', 'uichemy'),
    body: __("You'll need an Administrator account to set up UiChemy. Ask your site admin to finish this step.", 'uichemy'),
    action: __('OK', 'uichemy'),
  },
  uichemy: {
    tone: 'danger', icon: Icon.Puzzle, eyebrow: __('Setup required', 'uichemy'),
    title: __('UiChemy is not installed', 'uichemy'),
    body: __("UiChemy powers the Composer widget, which turns your prototype into fully editable Elementor sections. Its MCP server lets AI tools like Claude, Cursor and Codex convert Figma designs and build whole pages on your site. Install it to get started.", 'uichemy'),
    action: __('Install & Activate UiChemy', 'uichemy'),
    busyLabel: __('Installing…', 'uichemy'),
  },
  permalinks: {
    tone: 'warn', icon: Icon.Link,
    title: __('Pretty permalinks are required', 'uichemy'),
    body: __('This site is using plain permalinks, so UiChemy’s REST routes can’t resolve. Set permalinks to “Post name” (or any option other than Plain) and save.', 'uichemy'),
    action: __('Open Permalink settings', 'uichemy'),
    href: 'options-permalink.php',
  },
  unreachable: {
    tone: 'warn', icon: Icon.CloudOff,
    title: __("We couldn’t reach your site", 'uichemy'),
    body: __("This site’s REST API didn’t respond. It may be in maintenance mode, behind a firewall, or temporarily offline. Check that it’s publicly reachable, then retry.", 'uichemy'),
    action: __('Retry', 'uichemy'),
  },
  'token-failed': {
    tone: 'warn', icon: Icon.Lock,
    title: __("Sign-in couldn’t be verified", 'uichemy'),
    body: __("We didn’t get a valid sign-in token from UiChemy. Sign in again to reconnect this site.", 'uichemy'),
    action: __('Sign in again', 'uichemy'),
  },
  builder: {
    tone: 'warn', icon: Icon.Layout,
    title: __('Finish choosing a page builder', 'uichemy'),
    body: __('UiChemy needs an active page builder before it can convert designs. Pick one to continue.', 'uichemy'),
    action: __('Choose a builder', 'uichemy'),
  },
  session: {
    tone: 'warn', icon: Icon.License,
    title: __('Your license session needs attention', 'uichemy'),
    body: __("We couldn’t register a session for your license on this site. Pick a license again to continue.", 'uichemy'),
    action: __('Choose a license', 'uichemy'),
  },
  'mcp-unreachable': {
    tone: 'warn', icon: Icon.Plug,
    title: __("The MCP endpoint isn’t reachable", 'uichemy'),
    body: __("Your AI client couldn’t reach this site’s MCP server. Confirm the site is public and the connection link is current, then retry.", 'uichemy'),
    action: __('Retry', 'uichemy'),
  },
};

// Eyebrow label by severity (a card can override with its own `eyebrow`).
const EYEBROW = {
  warn:   __('Action needed', 'uichemy'),
  danger: __('Action needed', 'uichemy'),
  info:   __('Heads up', 'uichemy'),
};

function SnippetBlock({ snippet }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const ok = await copyText(snippet);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <div className="codeblock calm__snippet">
      <div className="codeblock__bar">
        <span>wp-config.php</span>
        <Button type="button" variant="ghost" tone="neutral" size="sm" className="codeblock__copy" onClick={onCopy}>
          {copied ? <><Icon.Check size={12}/> {__('Copied', 'uichemy')}</> : <><Icon.Copy size={12}/> {__('Copy', 'uichemy')}</>}
        </Button>
      </div>
      <pre><code>{snippet}</code></pre>
    </div>
  );
}

export default function ErrorCard({ variant = 'rest', onResolve, extra = null, busy = false, errorMessage = '', overrides = null }) {
  // `overrides` lets a caller adapt the static copy to live state — e.g. the
  // UiChemy card flips between "not installed / Install" and "not active /
  // Activate" depending on what's actually on the site.
  const c = { ...(COPY[variant] || COPY.rest), ...(overrides || {}) };
  const label = busy && c.busyLabel ? c.busyLabel : c.action;
  // UiChemy's install card drops the support link — the user just has to
  // install it, so "Contact support" would be a dead-end distraction.
  const isUiChemy = variant === 'uichemy';
  const IconEl = c.icon || Icon.Warn;
  const eyebrow = c.eyebrow || EYEBROW[c.tone] || EYEBROW.warn;
  return (
    <div className={`calm calm--${c.tone}`}>
      <div className="calm__badge">
        <span className="calm__icon"><IconEl size={24}/></span>
        <span className="calm__sev" aria-hidden="true" />
      </div>
      <span className="calm__eyebrow">{eyebrow}</span>
      <h2>{c.title}</h2>
      <p>{c.body}</p>
      {extra && extra.reasonText ? (
        <Alert tone="warning" title={__('Why it\'s off', 'uichemy')} className="calm__reason">
          {extra.reasonText}
          {extra.reasonHint ? (
            <span style={{ display: 'block', marginTop: 4 }}>{extra.reasonHint}</span>
          ) : null}
        </Alert>
      ) : null}
      {extra && extra.snippet ? <SnippetBlock snippet={extra.snippet} /> : null}
      {extra && extra.steps && extra.steps.length ? (
        <div className="calm__snippet" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 600 }}>
            {__('Or fix it at the source:', 'uichemy')}
          </p>
          <div className="calm__steps">
            <ol>
              {extra.steps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>
        </div>
      ) : null}
      {extra && extra.hooked && extra.hooked.length ? (
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          {__('These active plugins are hooked on the Application Passwords check, so one of them is the likely cause:', 'uichemy')}
          <b style={{ display: 'block', marginTop: 4, color: 'var(--ink-2)' }}>{extra.hooked.join(', ')}</b>
        </p>
      ) : null}
      {/* Secondary actions lead, primary sits last so the eye lands on the
          fix before acting. Support is deliberately NOT in this row — it's an
          escape hatch, not an alternative to the one-click fix. */}
      <div className="calm__actions">
        {extra && extra.onRecheck ? (
          <button type="button" className="btn btn--ghost" onClick={extra.onRecheck} disabled={busy}>
            {__('Re-check', 'uichemy')}
          </button>
        ) : null}
        {c.href ? (
          <Button variant="solid" tone="brand" asChild><a href={c.href}>{label}</a></Button>
        ) : (
          <Button variant="solid" tone="brand" onClick={onResolve} loading={busy}>
            {label}
          </Button>
        )}
      </div>
      {errorMessage ? (
        <Alert tone="danger" className="calm__errmsg">{errorMessage}</Alert>
      ) : null}
      {!isUiChemy ? (
        <a className="calm__support" href="https://store.posimyth.com/helpdesk" target="_blank" rel="noreferrer">
          { __('Still stuck? Contact support', 'uichemy') }
        </a>
      ) : null}
    </div>
  );
}
