// composer-pro.jsx — the per-plugin tier module for the COMPOSER (editor).
//
// THIS FILE IS ALLOWED TO DIFFER between the Free and Pro repos; it is on the
// allowlist in tools/parity-config.json. Everything else under composer/src must stay
// byte-identical. See docs/free-pro-split-plan.md.
//
// >>> ONE COPY, GATED AT RUNTIME. <<<
//
// UiChemy shipped two copies of this file: Free's with the real locks and all the
// upsell copy, Pro's a thin passthrough where every gate returned "unlocked". There
// is one bundle now, so each gate consults isPro() instead — which reads
// `uichComposerEditorCfg.isPro`, localised from uichemy_is_pro().
//
// Anything added here MUST answer isPro() first. A gate that forgets stays locked
// forever on Pro sites: that is what kept the Code tab's CSS/JS panes showing an
// upsell, and the Globals limits pinned at 2/1/1, after the merge.
//
// Every upsell surface the composer can show lives HERE, not in the shared panels:
//   • <ProBadge/>  — a small "PRO" pill next to a label
//   • <ProLock/>   — a full card that replaces a removed/locked feature body
//   • showProUpsell() — a global modal fired when a Free limit is hit
//   • the gates and copy for Chat, Draw, the CSS/JS panes, the loop sources, the
//     loop Pagination section and the Globals limits
//
// Pro's copy of this file is a set of inert stubs with the same export surface, so
// none of this markup, copy or limit arithmetic is compiled into the Pro bundle. The
// shared panels import the same names in both builds and never ask which tier they
// are running in.
//
// Keep the export surface identical to Pro's copy. A shared file importing a name
// that exists in only one build is exactly the breakage the parity check exists to
// prevent, and a missing component reads as `undefined` in JSX, which throws.
import React from 'react';
import ReactDOM from 'react-dom';
import { I } from './composer-icons';
import { ensurePortalRoot } from '@/components/ui/portal-context';

/** True only in the Pro build (PHP: uichemy_is_pro()). Absent cfg → Free. */
export function isPro() {
  return !!(typeof window !== 'undefined' && window.uichComposerEditorCfg && window.uichComposerEditorCfg.isPro);
}

/** Upgrade URL — PHP localises cfg.proUrl from uichemy_upgrade_url(). */
export function proUrl() {
  const cfg = (typeof window !== 'undefined' && window.uichComposerEditorCfg) || {};
  return cfg.proUrl || 'https://uichemy.com/pricing/';
}

/**
 * Whether a named composer feature is locked behind Pro in this build.
 *
 * The list comes from PHP (`cfg.proFeatures`, built by
 * UiChemy_Composer_Enqueue::pro_feature_flags()) so the tiering lives in one
 * place; the fallback only covers a stale localisation. A locked feature is also
 * refused by its REST routes, so this drives the UI, not the security.
 */
export function isFeatureLocked(feature) {
  if (isPro()) { return false; }
  const cfg = (typeof window !== 'undefined' && window.uichComposerEditorCfg) || {};
  const map = cfg.proFeatures;
  if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, feature)) {
    return !!map[feature];
  }
  return feature === 'ai_chat';
}

/* ── global upsell modal store ─────────────────────────────────────────────
   A tiny pub/sub so any limit check can pop the same modal without threading
   props. One <ProUpsellHost/> is mounted at the app root. */
let _listeners = [];
let _state = null; // { title, message } | null
function _emit() { _listeners.forEach((l) => l(_state)); }

/** Open the Pro upsell modal. `info` = { title, message }. */
export function showProUpsell(info) {
  if (isPro()) { return; }
  _state = info || {}; _emit();
}
export function hideProUpsell() { _state = null; _emit(); }

/**
 * Limit guard for Free. Returns true when the action may proceed (Pro, or still
 * under the limit); otherwise fires the upsell modal and returns false.
 */
export function allowOrUpsell(currentCount, limit, upsell) {
  if (isPro() || currentCount < limit) { return true; }
  showProUpsell(upsell);
  return false;
}

/** Small inline "PRO" pill. */
export function ProBadge({ small }) {
  if (isPro()) { return null; }
  return <span className={`pro-badge${small ? ' pro-badge--sm' : ''}`}>PRO</span>;
}

/**
 * Full card that stands in for a removed/locked feature body (e.g. the CSS/JS
 * editor in Free). Not just decorative — it's the only thing rendered where the
 * real feature used to be.
 */
export function ProLock({ icon, title, subtitle, message, features, cta }) {
  if (isPro()) { return null; }
  const Icon = icon || I.lock;
  // A structured benefit list reads far better than one dense paragraph on an
  // upsell (see the Grok / Character AI paywall pattern): icon + bold benefit +
  // one-line detail per row. `features` is optional, so every existing caller
  // that passes only `message` keeps its current single-paragraph layout.
  const hasFeats = Array.isArray(features) && features.length > 0;
  return (
    <div className={`pro-lock${hasFeats ? ' pro-lock--rich' : ''}`}>
      <div className="pro-lock__ic"><Icon size={22} /></div>
      <div className="pro-lock__title">{title}<ProBadge small /></div>
      {subtitle && <p className="pro-lock__sub">{subtitle}</p>}
      {hasFeats && (
        <ul className="pro-lock__feats">
          {features.map((f, i) => {
            const FIcon = f.icon || I.check;
            return (
              <li className="pro-lock__feat" key={i}>
                <span className="pro-lock__feat-ic"><FIcon size={15} /></span>
                <span className="pro-lock__feat-tx">
                  <span className="pro-lock__feat-t">{f.title}</span>
                  {f.desc && <span className="pro-lock__feat-d">{f.desc}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {message && <p className="pro-lock__msg">{message}</p>}
      <a className="pro-lock__cta" href={proUrl()} target="_blank" rel="noreferrer">
        {cta || 'Upgrade to Pro'}
      </a>
    </div>
  );
}

/* ── per-feature gates and copy ────────────────────────────────────────────
   Each of these owns one upsell surface AND its wording. The shared panels call
   them without knowing the tier; Pro's stubs no-op or pass children through, so
   neither the copy nor the markup reaches the Pro bundle. */

/** Canvas toolbar → Draw. Both Draw and Ask-AI are doors into AI chat. */
export function showDrawUpsell() {
  showProUpsell({
    title: 'Draw & Ask AI',
    message: 'Sketch straight onto the page. Circle what you want changed, add a note, and let AI rebuild it. Part of UiChemy Pro.',
  });
}

/** Canvas toolbar → Ask AI, and the Chat tab itself. */
export function showChatUpsell() {
  showProUpsell({
    title: 'AI Chat',
    message: 'Build and edit any widget by chatting with AI. Connect Claude, Codex, Gemini or OpenCode, or use your WordPress AI provider. Part of UiChemy Pro.',
  });
}

/**
 * The card that stands in for the CSS and JavaScript panes in the Code tab. Returns
 * null when the panes are available, which lets the caller size its grid and render
 * the real editors with a single expression instead of branching on the tier.
 */
export function codeLock() {
  if (isPro()) { return null; }
  return (
    <ProLock
      icon={I.code}
      title="Custom CSS & JavaScript"
      message="Scoped CSS and JavaScript for any widget are part of UiChemy Pro."
    />
  );
}

/**
 * Whether a loop source requires Pro. Mirrors uichemy_free_loop_sources() in PHP via
 * the picker's schema, which is the copy that actually ships to the browser.
 */
export function isLoopSourceLocked(key) {
  if (isPro()) { return false; }
  const S = (typeof window !== 'undefined' && window.UichDD && window.UichDD.schema) || null;
  return !!(S && S.loopSourceIsPro && S.loopSourceIsPro(key));
}

/**
 * Suffix for a loop source's <option> label. A <select> cannot hold a badge, so the
 * marker is text. Locked sources stay listed — a hidden option sells nothing.
 */
export function loopSourceSuffix(key) {
  return isLoopSourceLocked(key) ? ' · Pro' : '';
}

/** Fired when a locked loop source is picked; the selection is then bounced back. */
export function showLoopSourceUpsell() {
  showProUpsell({
    title: 'Loop source',
    message: 'Free loops over Posts. Looping Products, Terms / Categories, Users or an external JSON API is part of UiChemy Pro.',
  });
}

/* ── Loop: Custom query mode ────────────────────────────────────────────────
   The Loop panel's builder select offers Basic (the form) and Custom (hand-written
   query). Custom is Pro. */

/** True when the Loop panel's "Custom query" mode needs Pro in this build. */
export function isCustomLoopLocked() {
  return isFeatureLocked('loop_custom_query');
}

/**
 * Suffix for the "Custom query" <option> label — a <select> can't hold a badge,
 * so the marker is text, exactly as with the loop sources.
 */
export function customLoopSuffix() {
  return isCustomLoopLocked() ? ' · Pro' : '';
}

/** Fired when Custom is picked in Free; the select is then bounced back to Basic. */
export function showCustomLoopUpsell() {
  showProUpsell({
    title: 'Custom query',
    message: 'Writing the loop query by hand is part of UiChemy Pro. That covers several post types at once, OR between taxonomies, and more than one custom-field rule. The Basic builder covers the common cases.',
  });
}

/**
 * Note shown above a custom query the user ALREADY has in Free (imported, or
 * written in the Code tab). The query keeps running — only editing it here is
 * Pro — so the panel shows it read-only rather than forcing it back to Basic,
 * which would silently rewrite it into something simpler.
 */
export function CustomLoopLockNote() {
  if (!isCustomLoopLocked()) { return null; }
  return (
    <div className="uich-dd-hint" style={{ marginTop: 8 }}>
      This loop uses a custom query. It keeps working as it is. Editing it here is part of
      UiChemy Pro.{' '}
      <a href={proUrl()} target="_blank" rel="noreferrer">Upgrade to Pro</a>
    </div>
  );
}

/**
 * The loop's Pagination section. Free replaces the whole control with an upgrade
 * line — a live select would let the user store a value PHP then refuses to render,
 * and a disabled one could not be edited back to 'none'. Pro renders `children`.
 */
export function PaginationGate({ children }) {
  if (!isFeatureLocked('loop_pagination')) { return children || null; }
  return (
    <>
      <SectionHeadPro title="Pagination" />
      <div className="uich-dd-hint" style={{ marginTop: 8 }}>
        Numbered page links and the Load more button are part of UiChemy Pro. The loop itself
        still works. It shows the first “How many” items.{' '}
        <a href={proUrl()} target="_blank" rel="noreferrer">Upgrade to Pro</a>
      </div>
    </>
  );
}

/* Mirrors SectionHead in composer-construct-tab.jsx (same markup, badge always on).
   Duplicated deliberately: importing it back from the shared panel would create a
   cycle that exists in Free only, and this module must not depend on a panel it is
   itself injected into. Keep the two class names in step. */
function SectionHeadPro({ title }) {
  return (
    <div className="subsection uich-construct-sub">
      <span className="subsection-title">{title}</span>
      <ProBadge small />
    </div>
  );
}

/**
 * The Globals free limits. Free caps collections and classes; Pro returns Infinity so
 * the shared panel's `count >= limit` comparisons are simply never true there and no
 * tier check is needed at the call site.
 */
export function globalsLimits() {
  if (isPro()) {
    // Infinity, not a big number: the shared panel's `count >= limit` checks are
    // then never true, so no call site needs a tier check.
    return { collections: Infinity, typo: Infinity, other: Infinity };
  }
  return { collections: 2, typo: 1, other: 1 };
}

/** Copy for each Globals limit, keyed to match globalsLimits(). */
export function globalsUpsell(kind) {
  const L = globalsLimits();
  if (kind === 'collections') {
    return {
      title: 'Globals collections',
      message: `Free includes up to ${L.collections} Globals collections. Upgrade to UiChemy Pro for unlimited collections.`,
    };
  }
  if (kind === 'typo') {
    return {
      title: 'Typography classes',
      message: `Free includes ${L.typo} typography class. Upgrade to UiChemy Pro for unlimited typography classes.`,
    };
  }
  return {
    title: 'Component classes',
    message: `Free includes ${L.other} component class. Upgrade to UiChemy Pro for unlimited classes.`,
  };
}

/** Mounted once at the app root; renders the shared upsell modal on demand. */
export function ProUpsellHost() {
  if (isPro()) { return null; }
  const [info, setInfo] = React.useState(_state);
  React.useEffect(() => {
    const l = (s) => setInfo(s);
    _listeners.push(l);
    return () => { _listeners = _listeners.filter((x) => x !== l); };
  }, []);
  React.useEffect(() => {
    if (!info) { return undefined; }
    const onKey = (e) => { if (e.key === 'Escape') hideProUpsell(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [info]);
  if (!info) { return null; }
  return ReactDOM.createPortal(
    <div className="pro-modal__overlay" onClick={hideProUpsell}>
      <div className="pro-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="pro-modal__x" onClick={hideProUpsell} aria-label="Close"><I.x size={14} /></button>
        <div className="pro-modal__ic"><I.lock size={24} /></div>
        <h3 className="pro-modal__title">{info.title || 'This is a Pro feature'}</h3>
        <p className="pro-modal__msg">{info.message || 'Upgrade to UiChemy Pro to unlock this.'}</p>
        <a className="pro-modal__cta" href={proUrl()} target="_blank" rel="noreferrer">
          <I.sparkles size={13} /> Upgrade to Pro
        </a>
      </div>
    </div>,
    ensurePortalRoot(document),
  );
}
