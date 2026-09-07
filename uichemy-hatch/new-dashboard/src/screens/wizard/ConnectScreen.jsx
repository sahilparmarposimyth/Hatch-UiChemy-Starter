import React, { useEffect, useMemo, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';

import { ajax, copyText, getBoot } from '../../lib/api.js';
import { useAppPassword, regenerateAppPassword } from '../../lib/app-password.js';
import * as Icon from '../../components/icons.jsx';
import { Tooltip, Button } from '../../design-system';
import McpSetup from '../dashboard/McpSetup.jsx';

/* ============================================================
   ConnectScreen, Step 3 of the wizard.
   Built to match Claude design (project/UiChemy WordPress Plugin/
   screens-connect.jsx). Two branches:
     • Figma branch , Site URL + Application Password fields + 3-step infocard
     • Compose branch, mcp.json codeblock + advanced endpoints list
   ============================================================ */

const FIGMA_PLUGINS = {
  Elementor: 'https://www.figma.com/community/plugin/1377539250607344052/uichemy-figma-to-elementor',
  Gutenberg: 'https://www.figma.com/community/plugin/1377539250607344052/uichemy-figma-to-gutenberg',
  Bricks:    'https://www.figma.com/community/plugin/1377539250607344052/uichemy-figma-to-bricks',
};

export default function ConnectScreen({ mode, builder, boot }) {
  return mode === 'compose'
    ? <ComposeBranch builder={builder} boot={boot} />
    : <FigmaBranch builder={builder} boot={boot} />;
}

/* ============================================================
   Small reusable bits
   ============================================================ */

function Tip({ text }) {
  return (
    <Tooltip content={text}>
      <span className="tooltip-dot" aria-label={text}>?</span>
    </Tooltip>
  );
}

function CopyBtn({ value, label, disabled }) {
  const labelText = label != null ? label : __('Copy', 'uichemy');
  const [done, setDone] = useState(false);
  const click = async () => {
    if (disabled) return;
    const ok = await copyText(value);
    if (ok) { setDone(true); setTimeout(() => setDone(false), 1800); }
  };
  return (
    <Button variant="outline" tone="neutral" size="sm" onClick={click} disabled={disabled}>
      {done ? <Icon.Check size={13}/> : <Icon.Copy size={13}/>}
      <span>{done ? __('Copied', 'uichemy') : labelText}</span>
    </Button>
  );
}

function ConnField({ label, tip, icon, value, copyValue, ok }) {
  const IconEl = icon;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="fld-label">
        <span>{label}</span>
        {tip ? <Tip text={tip} /> : null}
      </div>
      <div className={`tokenfield${ok ? ' tokenfield--ok' : ''}`}>
        <span className="tokenfield__key"><IconEl size={15}/></span>
        <span className="tokenfield__val">{value}</span>
        <CopyBtn value={copyValue != null ? copyValue : value} label={__('Copy', 'uichemy')} />
      </div>
    </div>
  );
}

function PlayRow({ title, sub, dur = '1:02' }) {
  const [played, setPlayed] = useState(false);
  return (
    <div className="playrow" role="button" onClick={() => setPlayed(true)}>
      <span className="playrow__btn"><Icon.Play size={13}/></span>
      <span className="playrow__txt">
        <b>{title}</b>
        <span>{played ? __('Now playing. Watch it in the help center.', 'uichemy') : sub}</span>
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
        <Icon.Video size={12}/> {dur}
      </span>
    </div>
  );
}

/* ============================================================
   Figma branch, auto-issued password + design's layout
   ============================================================ */

function FigmaBranch({ builder, boot }) {
  const ap = useAppPassword();
  const [state, setState] = useState('generating');
  const [error, setError] = useState(null);
  const didIssue = useRef(false);

  const generate = async () => {
    setError(null);
    setState('generating');
    try {
      await regenerateAppPassword('figma');
      setState('ready');
    } catch (e) {
      setError(e.message);
      setState('error');
    }
  };

  // Always issue a fresh password when the user lands here, this is what
  // makes "Change mode" on the dashboard surface a new password each
  // time the user revisits this step.
  useEffect(() => {
    if (didIssue.current) return;
    didIssue.current = true;
    generate();
  }, []);

  if (state === 'error') {
    return (
      <div className="calm">
        <div className="calm__icon calm__icon--warn"><Icon.Warn size={26}/></div>
        <h2>{__("We couldn't reach your site", 'uichemy')}</h2>
        <p>{__('Something interrupted the connection. Your site is safe. Just try again.', 'uichemy')}</p>
        <div className="calm__actions">
          <Button variant="solid" tone="brand" onClick={generate}><Icon.Refresh size={14}/> {__('Retry', 'uichemy')}</Button>
          <Button variant="outline" tone="neutral" asChild>
            <a href="https://store.posimyth.com/helpdesk" target="_blank" rel="noreferrer">{__('Contact support', 'uichemy')}</a>
          </Button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
          {__('Still stuck after a couple of tries? We usually reply within a few hours.', 'uichemy')}
        </div>
      </div>
    );
  }

  // Connection Link base, PHP picks the clean form per permalink setting
  // (pretty: /wp-json/, plain: /index.php). The Figma plugin appends the
  // route itself, so we keep the copied link short and route-free. Login +
  // Application Password are embedded as user:pass@ so it's self-
  // authenticating. Drops back to the bare URL until the password lands.
  const restRoot = (boot?.connectUrl || boot?.restUrl || '').replace(/\/+$/, '')
    || ((boot?.siteUrl || 'https://my-wordpress-site.com').replace(/\/+$/, '') + '/index.php');
  const username = boot?.user?.login || '';
  let siteUrl = restRoot;
  if (username && ap.password) {
    try {
      const u = new URL(restRoot);
      u.username = username;
      u.password = ap.password;
      siteUrl = u.toString();
    } catch (_) { /* keep bare restRoot */ }
  }

  // Show the plain Application Password once issued. Copy gives the same
  //, users paste it straight into the Figma plugin's password field.
  const tokenDisplay = state === 'generating'
    ? __('Generating your Application Password…', 'uichemy')
    : (ap.password || __('Waiting for Application Password…', 'uichemy'));
  const tokenCopy = ap.password || '';

  const builderKey = builder ? builder.charAt(0).toUpperCase() + builder.slice(1).toLowerCase() : 'Elementor';
  const pluginHref = FIGMA_PLUGINS[builderKey] || FIGMA_PLUGINS.Elementor;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ConnField
        label={__('Connection Link', 'uichemy')}
        tip={__('One self-authenticating link. Your WP login and Application Password are already embedded.', 'uichemy')}
        icon={Icon.Link}
        value={siteUrl}
      />

      <div className="infocard">
        <div className="infocard__head">
          <Icon.Figma size={16}/> {__('Connect in three steps', 'uichemy')}
        </div>
        <ol className="steps-list">
          <li>
            <span className="steps-list__n">1</span>
            <span>
              {__('Install the', 'uichemy')}{' '}
              <a className="choice__link" href={pluginHref} target="_blank" rel="noreferrer" style={{ whiteSpace: 'nowrap' }}>
                {sprintf(__('UiChemy → %s plugin', 'uichemy'), builderKey)} <Icon.ExtLink size={12}/>
              </a>
              {' '}{__('in Figma.', 'uichemy')}
            </span>
          </li>
          <li>
            <span className="steps-list__n">2</span>
            <span>{__('Open it and go to', 'uichemy')} <b>{__('Site Connection', 'uichemy')}</b>.</span>
          </li>
          <li>
            <span className="steps-list__n">3</span>
            <span>{__('Paste your', 'uichemy')} <b>{__('Connection Link', 'uichemy')}</b>{__(', then click', 'uichemy')} <b>{__('Connect.', 'uichemy')}</b> </span>
          </li>
        </ol>
      </div>

      <PlayRow
        title={__("Your site's connected. Here's what's next.", 'uichemy')}
        sub={__('A 60-second walkthrough, from connection to your first export.', 'uichemy')}
        dur="1:02"
      />
    </div>
  );
}

/* ============================================================
   Compose branch, AI Agent to WordPress (MCP) config.
   Reuses the SAME light McpSetup stepper as the dashboard's AI Agent screen
   (embedded = no outer card), so onboarding and the dashboard are identical.
   McpSetup owns the whole flow: generate connection → pick tool → add config
   → restart, so no separate auto-issue / config panel is needed here.
   ============================================================ */

function ComposeBranch({ boot }) {
  return (
    <div className="wiz-mcp" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <McpSetup siteName={boot?.siteName} embedded />

      <PlayRow
        title={__("Added the MCP here's what to do next", 'uichemy')}
        sub={__('Connect from Claude or Cursor and run your first conversion.', 'uichemy')}
        dur="1:18"
      />
    </div>
  );
}
