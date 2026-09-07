import React, { useState } from 'react';
import { brandLogoSrc } from '../../components/brand-logos.jsx';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Button, Badge, Card, Switch, Tooltip, Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../../design-system';
import MCPConfigTabs from '../../components/MCPConfigTabs.jsx';
import { copyText, getBoot, request } from '../../lib/api.js';
import { useAppPassword, regenerateAppPassword, useAppPasswordForce } from '../../lib/app-password.js';

/**
 * Shared dashboard panels.
 *
 * Extracted from the old single-screen Dashboard so the tabbed screens
 * (Welcome / Import / Tokens) each compose only the panels they need, instead
 * of one screen rendering all of them behind `view` flags.
 *
 * SwitchPanel is gone: it duplicated ConnectionPanel's inline "Change" rows and
 * only rendered behind `?nd_view=full`, so it was dead by default.
 */

export function Panel({ title, icon, action, brand, flat, children, className = '' }) {
  return (
    <Card className={`panel ${brand ? 'panel--brand ' : ''}${flat ? 'panel--flat ' : ''}${className}`}>
      {(title || action) ? (
        <div className="panel__head">
          <div className="panel__title">
            {icon}{title}
          </div>
          {action || null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

/**
 * Small `ⓘ` affordance whose tooltip carries a step's description, keeps the
 * panel visually quiet (title + action only) with the "why" one hover away,
 * instead of a paragraph of hint text under every row.
 */
export function InfoTip({ text }) {
  if (!text) return null;
  return (
    <Tooltip content={text}>
      <span className="conn-info" role="img" tabIndex={0} aria-label={text}>
        <Icon.Info size={13} />
      </span>
    </Tooltip>
  );
}

export function CopyInline({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      tone="neutral"
      size="sm"
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true); setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <><Icon.Check size={12}/> {__('Copied', 'uichemy')}</> : <><Icon.Copy size={12}/> {__('Copy', 'uichemy')}</>}
    </Button>
  );
}

// Reveal toggle glyph: shared Hugeicons eye / eye-off.
function EyeIcon({ off = false, size = 14 }) {
  return off ? <Icon.EyeOff size={size} /> : <Icon.Eye size={size} />;
}

/**
 * A secret value shown masked by default (premium + safe, Vapi / Supabase /
 * OpenAI pattern): a monospace field with a reveal (eye) toggle and a copy
 * button. Copy always copies the real value regardless of the mask.
 */
export function SecretField({ value, mono = true }) {
  const [shown, setShown] = useState(false);
  const masked = '•'.repeat(Math.min(Math.max(String(value || '').length, 16), 40));
  return (
    <div className="conn-field">
      <span className={`conn-field__val${mono ? '' : ' conn-field__val--plain'}${shown ? '' : ' conn-field__val--masked'}`}>
        { shown ? value : masked }
      </span>
      <Button
        variant="ghost"
        tone="neutral"
        size="sm"
        iconOnly
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? __('Hide', 'uichemy') : __('Reveal', 'uichemy')}
        title={shown ? __('Hide', 'uichemy') : __('Reveal', 'uichemy')}
      >
        <EyeIcon off={shown} />
      </Button>
      <CopyInline value={value} />
    </div>
  );
}

// Embed WP login + Application Password into the connection base as
// http://user:pass@host/... so the user gets a one-shot, paste-anywhere
// link. Falls back to the bare URL until a password has been issued.
function buildSiteUrl(restUrl, username, password) {
  const base = (restUrl || '').replace(/\/+$/, '');
  if (!base || !username || !password) return base;
  try {
    const u = new URL(base);
    u.username = username;
    u.password = password;
    return u.toString();
  } catch (_) {
    return base;
  }
}

/**
 * Force-enable Application Passwords, an inline row shown inside the Connection
 * card, right where a blocked App Password stops the user cold. Self-hides when
 * App Passwords already work and there's nothing to override (see
 * useAppPasswordForce), so it only appears when it's actionable.
 */
export function AppPasswordForceRow() {
  const f = useAppPasswordForce();
  if ( ! f.visible ) return null;
  return (
    <div className="conn-force">
      <span className="conn-force__ic"><Icon.Key size={ 15 } /></span>
      <span className="conn-force__text">
        <b>{ __( 'Force-enable Application Passwords', 'uichemy' ) }</b>
        <small>
          { f.forceEnabled
            ? __( 'UiChemy is overriding the site to allow App Passwords for your account.', 'uichemy' )
            : ( f.reasonText || __( 'Application Passwords are currently unavailable on this site.', 'uichemy' ) ) }
        </small>
        { f.error ? (
          <em className="conn-force__err"><Icon.Warn size={ 12 } /> { f.error }</em>
        ) : null }
      </span>
      <Switch
        checked={ f.forceEnabled }
        disabled={ f.busy }
        onCheckedChange={ f.toggle }
        aria-label={ __( 'Force-enable Application Passwords', 'uichemy' ) }
      />
    </div>
  );
}

/**
 * `mode` is the slug ('figma' | 'compose'), not a display label, the Import
 * tab's dropdown owns mode switching and shows the label, so this panel only
 * needs the slug to name the Application Password entry and to decide whether
 * to surface it at all.
 */
export function ConnectionPanel({ builder, mode, onChangeBuilder, hideBuilder = false, builderFixed = false, builderNote }) {
  const boot = getBoot();
  const ap = useAppPassword();
  // Use PHP-computed rest_url(), respects permalink settings so plain /
  // index.php / pretty all render correctly. Strip any trailing slash for
  // a cleaner display.
  const restRoot = (boot?.connectUrl || boot?.restUrl || '').replace(/\/+$/, '')
    || ((boot?.siteUrl || 'http://my-wordpress-site.com').replace(/\/+$/, '') + '/index.php');
  const username = boot?.user?.login || '';
  const siteUrl = buildSiteUrl(restRoot, username, ap.password);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // App Password entries are named per mode. 'compose' is the MCP mode; the
  // stored entry has always been called 'mcp', so keep that name rather than
  // renaming live entries on existing sites.
  const modeSlug = mode === 'compose' ? 'mcp' : 'figma';

  const generate = async () => {
    setBusy(true); setError('');
    try { await regenerateAppPassword(modeSlug); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const isMcp = modeSlug === 'mcp';
  const connected = ap.hasToken && !! ap.password;
  // "Where's the plugin?" / "How MCP works" link on the not-connected state.
  const pluginHref = boot?.urls?.figmaPlugin || boot?.urls?.docs || 'https://uichemy.com/docs';

  const generateBtn = (label) => (
    <Button variant="solid" tone="brand" size="sm" onClick={generate} loading={busy}>
      { busy
        ? __( 'Generating…', 'uichemy' )
        : <><Icon.Key size={ 13 } /> { label }</> }
    </Button>
  );

  return (
    <Panel
      flat
      title={ __( 'Connection', 'uichemy' ) }
      className="span-2"
      action={
        <span className={ `conn-status conn-status--${ connected ? 'on' : 'off' }` }>
          <span className="conn-status__dot" />
          { connected ? __( 'Connected', 'uichemy' ) : __( 'Not connected', 'uichemy' ) }
        </span>
      }
    >
      <div className="conn-cred">
        {/* Page builder, always set. Hidden when an inline builder-picker shows. */}
        { ! hideBuilder ? (
          <div className="conn-cred__item">
            <div className="conn-cred__top">
              <span className="conn-cred__label">
                <Icon.Check size={ 13 } className="conn-cred__tick" />
                { __( 'Page builder', 'uichemy' ) }
                <InfoTip text={ builderFixed ? builderNote : __( 'Designs convert into editable elements here.', 'uichemy' ) } />
              </span>
              <span className="conn-cred__val">
                <b>{ builder || 'Elementor' }</b>
                { builderFixed ? null : (
                  <Button variant="outline" tone="neutral" size="sm" onClick={ onChangeBuilder }>
                    { __( 'Change', 'uichemy' ) } <Icon.ChevR size={ 12 } />
                  </Button>
                ) }
              </span>
            </div>
          </div>
        ) : null }

        { connected ? (
          <>
            {/* Connection link, masked secret with reveal + copy. */}
            <div className="conn-cred__item">
              <div className="conn-cred__top">
                <span className="conn-cred__label">
                  <Icon.Check size={ 13 } className="conn-cred__tick" />
                  { __( 'Connection link', 'uichemy' ) }
                  <InfoTip text={ isMcp
                    ? __( 'A self-authenticating link your AI client uses to reach this site.', 'uichemy' )
                    : __( 'Paste this into the UiChemy plugin in Figma.', 'uichemy' ) } />
                </span>
              </div>
              <SecretField value={ siteUrl } />
              <p className="conn-note">
                { __( 'Keep this private. Anyone with the link can send designs to your site.', 'uichemy' ) }
              </p>
            </div>

            {/* Application password (MCP mode), same token, masked. */}
            { isMcp ? (
              <div className="conn-cred__item">
                <div className="conn-cred__top">
                  <span className="conn-cred__label">
                    <Icon.Check size={ 13 } className="conn-cred__tick" />
                    { __( 'Application password', 'uichemy' ) }
                    <InfoTip text={ __( 'Used by your AI client to authenticate with WordPress.', 'uichemy' ) } />
                  </span>
                  { ap.name ? (
                    <span className="conn-cred__meta">{ sprintf( __( 'Active · %s', 'uichemy' ), ap.name ) }</span>
                  ) : null }
                </div>
                <SecretField value={ ap.password } />
              </div>
            ) : null }
          </>
        ) : (
          /* Not connected, a guided connect block: lead + CTA + a 3-step
             mini-guide, so the user sees the whole path before generating. */
          <div className="conn-cred__item conn-cred__item--empty">
            <div className="conn-empty">
              <span className="conn-empty__ic"><Icon.Key size={ 20 } /></span>
              <div className="conn-empty__body">
                <div className="conn-empty__title">
                  { isMcp
                    ? __( 'Connect your site to your AI client', 'uichemy' )
                    : __( 'Connect your site to start converting', 'uichemy' ) }
                </div>
                <p className="conn-empty__desc">
                  { isMcp
                    ? __( 'Generate a secure link, then add it to Claude, Cursor or Codex below.', 'uichemy' )
                    : __( 'Generate a secure link and paste it into the UiChemy plugin in Figma.', 'uichemy' ) }
                </p>
                <div className="conn-empty__actions">
                  { generateBtn( __( 'Generate connection link', 'uichemy' ) ) }
                  <a className="conn-empty__link" href={ pluginHref } target="_blank" rel="noreferrer">
                    { isMcp ? __( 'How MCP works', 'uichemy' ) : __( 'Where’s the plugin?', 'uichemy' ) }
                  </a>
                </div>
              </div>
            </div>

            { ! isMcp ? (
              <ol className="conn-steps3">
                <li><span>1</span>{ __( 'Install the UiChemy plugin in Figma', 'uichemy' ) }</li>
                <li><span>2</span>{ __( 'Paste your connection link', 'uichemy' ) }</li>
                <li><span>3</span>{ __( 'Select a frame and hit Send', 'uichemy' ) }</li>
              </ol>
            ) : null }
          </div>
        ) }
      </div>

      {/* Only renders when App Passwords are blocked or force-enabled. */}
      <AppPasswordForceRow />

      { error ? (
        <div className="conn-err"><Icon.Warn size={ 14 } /> { error }</div>
      ) : null }
    </Panel>
  );
}

export function ResourcesPanel({ bare = false }) {
  const res = [
    { label: __('Read Docs', 'uichemy'),          sub: __('Guides & how-tos', 'uichemy'),   href: 'https://uichemy.com/docs',   ic: <Icon.Book size={20}/> },
    { label: __('Watch Videos', 'uichemy'),       sub: __('Watch & learn', 'uichemy'),      href: 'https://www.youtube.com/@uichemy', ic: <Icon.Video size={20}/> },
    { label: __('Discord Channel', 'uichemy'),    sub: __('Chat and get help', 'uichemy'),  href: 'https://discord.gg/2bR4WKWhw',     ic: <Icon.Discord size={20}/> },
    { label: __('Facebook Community', 'uichemy'), sub: __('Join Community', 'uichemy'),      href: 'https://www.facebook.com/uichemy/', ic: <Icon.Facebook size={20}/> },
  ];
  const grid = (
    <div className="resrow">
      {res.map((r) => (
        <a key={r.label} className="rescard" href={r.href} target="_blank" rel="noreferrer">
          <span className="rescard__ic">{r.ic}</span>
          <b>{r.label}</b>
          <span>{r.sub}</span>
        </a>
      ))}
    </div>
  );
  // `bare` renders just the content, for hosting inside another card (the
  // Lovable-style home panel); otherwise it carries its own Panel chrome.
  if (bare) return grid;
  return (
    <Panel title={__('Resources', 'uichemy')} icon={<Icon.Book size={20}/>} className="span-2">
      {grid}
    </Panel>
  );
}

export function TokenBalancePanel() {
  return (
    <Panel brand title={__('AI tokens', 'uichemy')} icon={<Icon.Sparkles size={20}/>} className="span-2">
      <div className="balance"><span className="balance__n">0</span><span className="balance__u">{__('tokens', 'uichemy')}</span></div>
      <p style={{ color: 'rgba(255,255,255,.8)', fontSize: 14, margin: '0 0 16px' }}>{__('You start with 0 tokens. Get yours to begin converting.', 'uichemy')}</p>
      <div className="gettokens__actions">
        <a className="btn-onbrand" href="mailto:hello@uichemy.com">{__('Get more', 'uichemy')}</a>
      </div>
    </Panel>
  );
}

/**
 * MCP config panel, thin wrapper around the shared
 * MCPConfigTabs component. The wizard's ComposeBranch uses the same
 * component so both surfaces stay in sync.
 */
export function MCPPanel({ siteName }) {
  return (
    <Panel
      flat
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{__('AI clients (MCP)', 'uichemy')}<InfoTip text={__('Generate your Application Password, then pick your AI client below. Copy the snippet into its config, or paste the Prompt tab into any AI to add it for you.', 'uichemy')} /></span>}
      className="span-2"
      action={<Badge tone="neutral" variant="soft">{__('Optional', 'uichemy')}</Badge>}
    >
      <MCPConfigTabs siteName={siteName} showGenerate={true} />
    </Panel>
  );
}

export function FAQPanel({ bare = false }) {
  const faqs = [
    { q: __('Can I switch builder or mode later?', 'uichemy'), a: __('Yes, anytime from this dashboard. Your Application Password stays the same.', 'uichemy') },
    { q: __('Is my Application Password safe to share?', 'uichemy'), a: __('Keep it private. Anyone with it can connect to this site. You can rotate it whenever you like.', 'uichemy') },
    { q: __('My site is local. Can I still use UiChemy?', 'uichemy'), a: __('Direct send needs a public URL, but you can use JSON export to move designs from a local site.', 'uichemy') },
  ];
  // DS Accordion (Radix), replaces the old hand-rolled maxHeight toggle.
  const list = (
    <Accordion type="single" collapsible defaultValue="faq-0">
      {faqs.map((f, i) => (
        <AccordionItem value={`faq-${i}`} key={i}>
          <AccordionTrigger>{f.q}</AccordionTrigger>
          <AccordionContent>{f.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
  if (bare) return list;
  return (
    <Panel title={__('Frequently asked', 'uichemy')} icon={<Icon.Chat size={20}/>} className="span-2">
      {list}
    </Panel>
  );
}

/**
 * Calm, on-brand banner for an available UiChemy update on the post-onboarding
 * dashboard. Reads the boot snapshot (computed server-side on page load, which
 * checks the API-managed latest), so the prompt appears the moment an
 * already-installed user opens the dashboard, without blocking anything. The
 * button hits the same install endpoint, which overwrite-installs the update.
 */
export function UiChemyUpdateNotice() {
  const boot = getBoot();
  const p = (boot && boot.state && boot.state.uichemy) || {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!p.installed || !p.update_available) return null;

  const logo = brandLogoSrc(boot);

  const onUpdate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await request('uichemy/install', { method: 'POST' });
      if (res && res.action === 'activate_url' && res.activate_url) {
        window.open(res.activate_url, '_blank', 'noopener');
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError((e && e.message) || __('Could not update UiChemy. Please try again.', 'uichemy'));
      setBusy(false);
    }
  };

  return (
    <div className="dash__update" role="status">
      <span className="dash__update-logo">
        <img src={logo} alt="" aria-hidden="true" />
      </span>
      <div className="dash__update-body">
        <div className="dash__update-title">
          {__('UiChemy update available', 'uichemy')}
          {p.latest_version ? <span className="dash__update-ver">{sprintf( __( 'Beta v%s', 'uichemy' ), p.latest_version )}</span> : null}
        </div>
        <p className="dash__update-desc">
          {__('A newer beta version of UiChemy is ready with the latest Composer widget.', 'uichemy')}
        </p>
        {error ? <p className="dash__update-err">{error}</p> : null}
      </div>
      <Button type="button" variant="solid" tone="brand" className="dash__update-btn" onClick={onUpdate} loading={busy}>
        {busy
          ? __('Updating…', 'uichemy')
          : <><Icon.Refresh size={14} /> {__('Update now', 'uichemy')}</>}
      </Button>
    </div>
  );
}

