// Mounts the UiChemy Composer React panel into the existing
// `#uichemy-composer-floating-panel` shell that the legacy editor JS injects
// into the Elementor preview iframe.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './shadcn.css';
// Tokens live in their own file so the dashboard bundle can load them without
// shadcn.css's `@tailwind base` preflight. Must come after the directives –
// these rules are unlayered and are meant to win.
import './shadcn-tokens.css';
// The skin palette, shared with the canvas bundle. Imported before
// composer.css so the tokens keep the cascade position they had when they
// lived inside it.
import './composer-skin-tokens.css';
import './composer.css';
import './composer-dock.css';
// Seeds the Chat slot with the upsell stand-in. MUST be imported before
// ComposerPanel renders, see composer-tab-slots.js.
import './plugin-registrations';
// Publishes window.UichComposerRuntime for the PRO editor bundle (which loads
// after this script and registers the real Chat tab through it).
import './composer-runtime-exports';
import { ComposerPanel } from './composer-app';
import { ComposerErrorBoundary } from './composer-error-boundary';
import { initElementorBridge } from './composer-elementor';
import { initFrontendBridge } from './composer-frontend';
import { initGutenbergBridge } from './composer-gutenberg';
import { initBricksBridge } from './composer-bricks';

initElementorBridge();
initGutenbergBridge();
initBricksBridge();
// Frontend (live-page) bridge, inert in the Elementor editor (its selection
// event never fires there), active on the front end where the picker runs.
initFrontendBridge();

const PANEL_ID = 'uichemy-composer-floating-panel';
const MOUNTED_FLAG = '__uichComposerMounted';

// Gutenberg only: the host that the block's own InspectorControls renders into
// (assets/blocks/uichemy-composer/index.js), i.e. the composer living inside
// WordPress's Block tab. Distinct id from the drawer on purpose, rendering a
// second `#uichemy-composer-floating-panel` would duplicate an element id and
// break every getElementById lookup in the panel, the box overlay and the
// element picker.
const INSPECTOR_ID = 'uichemy-composer-inspector-host';

function getCfg() {
  return (typeof window !== 'undefined' && window.uichComposerCfg) || {};
}

function ensureStylesheet(doc) {
  const cfg = getCfg();
  if (!cfg.cssUrl) return;
  if (doc.getElementById('uich-composer-css')) return;
  const link = doc.createElement('link');
  link.id = 'uich-composer-css';
  link.rel = 'stylesheet';
  link.href = cfg.cssUrl;
  doc.head.appendChild(link);
}

function listCandidateDocs() {
  const docs = [document];
  const iframes = document.querySelectorAll('iframe');
  for (const f of iframes) {
    let d = null;
    try { d = f.contentDocument; } catch (_) { d = null; }
    if (d) docs.push(d);
  }
  return docs;
}

function findPanel() {
  for (const d of listCandidateDocs()) {
    const el = d.getElementById(PANEL_ID);
    if (el) return { el, doc: d };
  }
  return null;
}

function mount(target) {
  const { el, doc } = target;
  if (el[MOUNTED_FLAG]) return;
  el[MOUNTED_FLAG] = true;

  ensureStylesheet(doc);
  el.innerHTML = '';

  // Mark the shell as a right-side drawer the instant React takes it over, the
  // dock is always 'right' now. Doing it here (before the first render) means the
  // shell never paints with its base bottom-sheet CSS, so it doesn't flash at the
  // bottom and jump to the side on load. React's dock layout-effect keeps it set.
  el.classList.add('uich-dock-right');

  // `uich-tw` scopes the Tailwind/shadcn design system to the composer;
  // theme code toggles `dark` on this element.
  const host = doc.createElement('div');
  host.className = 'uich-composer-host uich-tw';
  el.appendChild(host);

  const root = createRoot(host);
  root.render(
    <ComposerErrorBoundary>
      <ComposerPanel />
    </ComposerErrorBoundary>
  );
}

/**
 * Gutenberg: keep a composer mounted inside the Block tab for as long as the
 * block's inspector is on screen.
 *
 * Unlike the drawer, injected once and then reused, this host is React-owned
 * by WordPress: it appears when a UiChemy block is selected and is destroyed on
 * deselection, tab switch, or sidebar close. So this watcher is PERSISTENT
 * (the drawer's observers disconnect after their one-and-only mount) and it
 * unmounts the React root when the host goes away. Skipping that would leak a
 * root per selection and leave orphaned effects subscribed to the store.
 */
function watchInspectorHost() {
  let mountedEl = null;
  let mountedRoot = null;

  const unmount = () => {
    if (!mountedRoot) return;
    const root = mountedRoot;
    mountedRoot = null;
    mountedEl = null;
    // Deferred: unmounting synchronously from inside a MutationObserver can land
    // mid-render of WordPress's own tree, which React rejects.
    setTimeout(() => { try { root.unmount(); } catch (_) { /* noop */ } }, 0);
  };

  const sync = () => {
    const el = document.getElementById(INSPECTOR_ID);
    // The host was swapped for a different node, or detached, drop its root.
    if (mountedEl && (mountedEl !== el || !mountedEl.isConnected)) unmount();
    if (!el) return;

    // Healthy: same element, a live root, and our mount point still inside it.
    if (mountedRoot && mountedEl === el && el.firstElementChild) return;

    // Anything else is a rebuild. This is deliberately derived from the DOM's
    // actual state rather than a sticky "already mounted" flag on the element:
    // WordPress can REUSE the same host node across a hide/show cycle (Block ⇄
    // Page tab, sidebar close/reopen), and a flag would still read true after we
    // tore the root down for being disconnected, so the panel would never mount
    // again and stayed empty until a full page reload. Checking for a live root
    // plus a surviving child makes the watcher self-healing instead.
    if (mountedRoot) unmount();
    ensureStylesheet(document);
    el.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'uich-composer-host uich-tw uich-inspector-host';
    el.appendChild(host);
    mountedEl = el;
    mountedRoot = createRoot(host);
    mountedRoot.render(
      <ComposerErrorBoundary>
        <ComposerPanel surface="inspector" />
      </ComposerErrorBoundary>
    );
  };

  sync();
  const obs = new MutationObserver(sync);
  obs.observe(document.documentElement || document, { childList: true, subtree: true });
}

function start() {
  // Gutenberg's inspector host is independent of the drawer: it can appear
  // before, after, or instead of one, so it gets its own watcher that keeps
  // running for the life of the editor.
  watchInspectorHost();

  const found = findPanel();
  if (found) { mount(found); return; }

  // Watch every same-origin document for the panel to appear.
  const observers = [];
  function watch(doc) {
    const obs = new MutationObserver(() => {
      const el = doc.getElementById(PANEL_ID);
      if (el) {
        observers.forEach(o => o.disconnect());
        mount({ el, doc });
      }
    });
    obs.observe(doc.documentElement || doc, { childList: true, subtree: true });
    observers.push(obs);
  }
  listCandidateDocs().forEach(watch);

  // Newly-loaded iframes need their docs observed too.
  document.querySelectorAll('iframe').forEach((f) => {
    f.addEventListener('load', () => {
      let d = null;
      try { d = f.contentDocument; } catch (_) {}
      if (!d) return;
      const el = d.getElementById(PANEL_ID);
      if (el) {
        observers.forEach(o => o.disconnect());
        mount({ el, doc: d });
        return;
      }
      watch(d);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
