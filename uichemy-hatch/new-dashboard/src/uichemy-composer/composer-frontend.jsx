// Frontend bridge (Phase F2b) — when a Composer widget is picked on the live page
// (event from assets/js/uichemy-frontend-bridge.js), fetch its raw HTML/CSS/JS
// over REST and load it into the composer panel via setActiveFrontendWidget so
// the existing Code tab shows and edits the real widget content.
import {
  setActiveFrontendWidget,
  setFrontendChangeHook,
  getActiveWidgetSync,
  UICHEMY_DYNAMIC_TAG_RE,
  UICH_TWIG_RE,
  stripCssAnimations,
  forceImportant,
  scopeCssToWidget,
} from './composer-elementor';

function cfg() {
  return (typeof window !== 'undefined' && window.uichUiChemyFrontend) || {};
}

// Currently-loaded frontend widget — used by later phases for live DOM apply / save.
// `rawJs` is kept in sync so a live raw_html re-render can re-run the widget's
// init script against the freshly-swapped nodes (see reexecWidgetJs).
// `pickedNode` is the element the user actually clicked on the live page. It is
// consumed once by composer-app.jsx, which turns it into a layer path so the
// panel opens on THAT element rather than the widget's first layer.
export const frontendState = { postId: null, widgetIndex: 0, widgetId: '', elementId: '', builder: 'elementor', uid: '', el: null, rawJs: '', pickedNode: null, loadedData: null, liveKey: '' };

// Latest in-session code for widgets the user has edited this page-load, keyed
// builder-aware. A commit updates this SYNCHRONOUSLY (see the change hook), so
// switching away from an edited element and back serves the live value at once
// — instead of the 800ms-debounced save's stale cache / pre-edit server copy,
// which was the "switch away shows old text, switch back shows new" bug.
const liveCode = new Map();
function liveCodeKey(postId, builder, elementId, uid) {
  const idPart = ('gutenberg' === builder || 'bricks' === builder) ? ('uid:' + (uid || '')) : ('el:' + (elementId || ''));
  return String(postId) + '|' + (builder || 'elementor') + '|' + idPart;
}

/**
 * Code for every Composer widget on the page, keyed `postId:elementId`.
 *
 * Warmed once per owner post by prefetchSections() when the bridge reports what
 * is on the page, so switching between sections afterwards costs no request at
 * all — which is what makes hover-then-click switching feel instant instead of
 * firing a REST call per section the pointer crosses.
 *
 * Keyed by post as well as element id because a Composer widget inside a global
 * header/footer belongs to that template's post, not the page being viewed, so
 * ids from different owners can collide.
 */
const sectionCache = new Map();
const cacheKey = (postId, elementId) => String(postId) + ':' + String(elementId || '');

/** Posts already fetched (or in flight), so a re-render never refetches. */
const prefetchedPosts = new Map();

/**
 * Pull every Composer widget on `postId` into sectionCache in one request.
 * Returns the same promise for concurrent callers, and never rejects — a failed
 * prefetch just leaves the cache cold and the per-widget path takes over.
 */
function prefetchSections(postId) {
  const c = cfg();
  if (!postId || !c.restUrl) return Promise.resolve();
  if (prefetchedPosts.has(postId)) return prefetchedPosts.get(postId);

  const base = c.restUrl + 'frontend/sections';
  const sep = base.indexOf('?') >= 0 ? '&' : '?';
  const url = base + sep + 'post_id=' + encodeURIComponent(postId);

  const p = fetch(url, { method: 'GET', headers: { 'X-WP-Nonce': c.nonce || '' }, credentials: 'same-origin' })
    .then((r) => r.json())
    .then((data) => {
      if (!data || data.code || !Array.isArray(data.widgets)) return;
      data.widgets.forEach((w) => {
        sectionCache.set(cacheKey(postId, w.widget_id), {
          ...w,
          // Site code lives once on the envelope, not per widget — fold it back in
          // so a cache hit hands the panel exactly what the single-widget read does.
          site_custom_code_head: data.site_custom_code_head || '',
          site_custom_code_footer: data.site_custom_code_footer || '',
        });
      });
      window.console && console.log('[UiChemy FE] prefetched', data.widgets.length, 'section(s) for post', postId);
    })
    .catch(() => { /* cold cache is a valid state */ });

  prefetchedPosts.set(postId, p);
  return p;
}

/**
 * Drop a widget's cached copy after it is written, so the next switch back reads
 * the saved code rather than the stale snapshot taken at page load.
 */
export function invalidateSectionCache(postId, elementId) {
  sectionCache.delete(cacheKey(postId, elementId));
}

async function loadPickedWidget(detail) {
  const c = cfg();
  const postId = detail.postId || c.postId;
  const widgetIndex = detail.index != null ? detail.index : 0;
  const builder = detail.builder || 'elementor';
  const uid = detail.uid || '';
  if (!postId || !c.restUrl) {
    window.console && console.warn('[UiChemy FE] missing postId/restUrl', postId, c.restUrl);
    return;
  }

  // Support both permalink styles: pretty (.../wp-json/uichemy/v1/) and plain
  // (.../index.php?rest_route=/uichemy/v1/). With the plain form the base URL
  // already contains "?", so query params must be joined with "&", not "?".
  const base = c.restUrl + 'frontend/section';
  const sep = base.indexOf('?') >= 0 ? '&' : '?';
  const url = base + sep + 'post_id=' + encodeURIComponent(postId) +
    '&widget_index=' + encodeURIComponent(widgetIndex) +
    '&element_id=' + encodeURIComponent(detail.elementId || '') +
    '&builder=' + encodeURIComponent(builder) +
    '&uid=' + encodeURIComponent(uid);

  // Live edits first — if this widget was edited this session, its in-memory
  // code is newer than anything the cache or server holds (the save is debounced
  // 800ms). Serving it here is what makes switching away and back never show
  // stale text, for every builder.
  const lkey = liveCodeKey(postId, builder, detail.elementId, uid);
  let data = liveCode.get(lkey) || null;
  // Cache next — a warmed section switches with no network at all. Gutenberg
  // widgets are keyed server-side by uid rather than element id, so they take the
  // per-widget path below.
  if (!data) data = 'elementor' === builder ? sectionCache.get(cacheKey(postId, detail.elementId)) : null;
  let httpStatus = 0;
  if (!data) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-WP-Nonce': c.nonce || '' },
        credentials: 'same-origin',
      });
      httpStatus = res.status;
      data = await res.json();
    } catch (err) {
      window.console && console.error('[UiChemy FE] load failed (fetch/json)', err, 'url=', url);
      return;
    }
    if (data && !data.code && 'elementor' === builder && detail.elementId) {
      sectionCache.set(cacheKey(postId, detail.elementId), data);
    }
  }

  if (!data || data.code) {
    window.console && console.error(
      '[UiChemy FE] load error http=' + httpStatus +
      ' code=' + (data && data.code) +
      ' message=' + (data && data.message) +
      ' status=' + (data && data.data && data.data.status) +
      ' | postId=' + postId + ' widgetIndex=' + widgetIndex +
      ' nonce=' + ( c.nonce ? 'set(' + String(c.nonce).length + ')' : 'MISSING' )
    );
    return;
  }

  frontendState.postId = postId;
  frontendState.widgetIndex = widgetIndex;
  frontendState.widgetId = data.widget_id || '';
  frontendState.elementId = detail.elementId || '';
  // Builder + uid must ride along on frontendState, not just the load event:
  // doSave() reads them from here. Without this a Gutenberg edit saves as
  // builder='elementor' with an empty uid, so the server takes the Elementor
  // branch, finds no _elementor_data, and the edit is silently dropped.
  frontendState.builder = builder;
  frontendState.uid = uid;
  // Remember this widget's identity + full loaded payload so an edit can update
  // liveCode with the complete data shape (label / widget_id / page+site code),
  // not just the changed html/css/js.
  frontendState.liveKey = lkey;
  frontendState.loadedData = data;
  frontendState.rawJs = data.js || '';
  // Resolve the live widget node from its Elementor element id (robust across
  // event boundaries), falling back to any node passed on the event.
  frontendState.el = ( detail.elementId
    ? document.querySelector( '.elementor-element[data-id="' + detail.elementId + '"]' )
    : null ) || detail.el || null;
  // Hand the clicked element to the panel (see frontendState.pickedNode). Only
  // when it is a node INSIDE the widget — clicking the widget's own wrapper
  // carries no element-level intent, so the normal first-layer anchor applies.
  frontendState.pickedNode = ( detail.node && detail.node.nodeType === 1 ) ? detail.node : null;
  // Load-time preload, not a user pick — composer-app.jsx keeps the panel shut
  // and the outline off for this one activation.
  frontendState.silentLoad = !!detail.silent;

  setActiveFrontendWidget({
    raw_html: data.html || '',
    raw_css: data.css || '',
    raw_js: data.js || '',
    _title: data.label || '',
    widget_id: data.widget_id || '',
    __elementId: detail.elementId || '',
    // Builder + uid make the active model builder-aware so getWidgetRoot() can
    // resolve the live DOM root the right way: Gutenberg/Bricks match by uid /
    // scope class, not an Elementor data-id. Without this the frontend model is
    // Elementor-shaped and the floating toolbar / outline / in-place text never
    // appear for a Gutenberg (or Bricks) pick.
    builder: builder,
    uid: uid,
    // Page/Site Code panes (composer-code.jsx) read these off the active widget's
    // settings model — without them the panes render blank on the front end even
    // though the editor shows the same widget's real values.
    page_custom_code_head: data.page_custom_code_head || '',
    page_custom_code_footer: data.page_custom_code_footer || '',
    site_custom_code_head: data.site_custom_code_head || '',
    site_custom_code_footer: data.site_custom_code_footer || '',
  });

  window.console && console.log('[UiChemy FE] loaded widget', frontendState.widgetId,
    'html', (data.html || '').length, 'css', (data.css || '').length, 'js', (data.js || '').length);

  // Deliberately does NOT surface the panel.
  //
  // This used to dispatch `uich:composer-switch-tab` to land the user on the
  // Editor tab — and that event's handler opens the drawer as well as switching
  // the tab ("switching tabs is what forces the panel open"), so every pick threw
  // the sidebar over the page. On the front end the pick is meant to stay ON the
  // canvas: floating bar over the element, text editable in place, sidebar only
  // when the user asks for it with the edge chevron.
  //
  // The Editor tab is still selected — composer-app.jsx's own
  // `uichemy:frontend:widget-selected` handler does it there, without touching
  // the drawer.
}

/**
 * Re-run the active widget's `raw_js` against its freshly re-rendered subtree.
 *
 * After a live raw_html swap the new markup is inert: any behaviour the section
 * relies on (scroll-reveal IntersectionObservers, counters, sliders, …) lives
 * in raw_js, which ran once on the ORIGINAL page load and is typically bound to
 * DOMContentLoaded. The swapped-in nodes are therefore never initialised and
 * stay in their hidden starting state — e.g. `.aria-reveal { opacity: 0 }` — so
 * the section looks empty in the editor even though its content is present.
 *
 * innerHTML never executes injected <script> tags, and the real page-load
 * events already fired and won't fire again, so we re-execute raw_js manually
 * through two shims that make an already-loaded page behave like a fresh one:
 *   • `document`/`window` `addEventListener('DOMContentLoaded'|'load', …)` fire
 *     their listener immediately instead of registering it for an event that
 *     has passed.
 *   • `document.querySelector[All]` are scoped to THIS widget, so a section
 *     whose wrapper class also appears elsewhere on the page (a duplicated
 *     section) still initialises its own nodes rather than the first match.
 *
 * The animation is untouched on the live front end — it still plays normally on
 * a real page load; this only re-triggers it after an in-editor re-render.
 */
function reexecWidgetJs(scopeEl, jsOverride) {
  const js = jsOverride != null ? jsOverride : frontendState.rawJs;
  if (!js || !scopeEl) return;
  const realDoc = scopeEl.ownerDocument || document;
  const realWin = realDoc.defaultView || window;

  const fireNow = (listener, thisArg, type) => {
    if (typeof listener !== 'function') return;
    try { listener.call(thisArg, new realWin.Event(type)); } catch (_) {}
  };
  const readyShim = (thisArg) => (type, listener, opts) => {
    if (type === 'DOMContentLoaded' || type === 'load') { fireNow(listener, thisArg, type); return; }
    return thisArg.addEventListener(type, listener, opts);
  };

  const docProxy = new Proxy(realDoc, {
    get(target, prop) {
      if (prop === 'addEventListener') return readyShim(realDoc);
      // Scope element lookups to this widget so a duplicated section (same
      // wrapper class elsewhere on the page) initialises its OWN nodes.
      if (prop === 'querySelector') return (sel) => scopeEl.querySelector(sel);
      if (prop === 'querySelectorAll') return (sel) => scopeEl.querySelectorAll(sel);
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
  const winProxy = new Proxy(realWin, {
    get(target, prop) {
      if (prop === 'addEventListener') return readyShim(realWin);
      if (prop === 'document') return docProxy;
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });

  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', js)(winProxy, docProxy);
  } catch (e) {
    window.console && console.warn('[UiChemy FE] raw_js re-run failed', e);
  }
}

/** Live-reflect an edited setting onto the picked widget's DOM (Phase F2c). */
function applyLive(key, value, data) {
  const el = frontendState.el;
  if (!el) return;

  if (key === 'raw_html') {
    // Twig ({% %} / {{ }}) and <uichemy-*> tokens resolve only on the SERVER.
    // Painting the raw template here replaced the rendered output with literal
    // template code, which renders as nothing — so editing anything on a widget
    // holding a dynamic tag made that tag disappear until the next page load,
    // where the server render brought it back.
    //
    // Painting the raw template client-side would show literal `{{ … }}`. Instead
    // ask the server to resolve the tokens against this post and swap the rendered
    // HTML in — so a dynamic binding previews live, without a page refresh.
    if (UICHEMY_DYNAMIC_TAG_RE.test(value || '') || UICH_TWIG_RE.test(value || '')) {
      scheduleDynRender(value || '');
      return;
    }
    // The Composer widget's rendered output lives in .elementor-widget-container.
    // Replacing its markup gives an instant client-side preview (the exact
    // server render is reapplied on save/refresh in F3).
    const container = el.querySelector('.elementor-widget-container') || el;
    container.innerHTML = value || '';
    // The swap leaves the new nodes uninitialised — re-run the widget's init JS
    // so scroll-reveal/counters/etc. re-bind and content doesn't stay stuck in
    // its hidden start state (see reexecWidgetJs).
    reexecWidgetJs(el);
    return;
  }

  if (key === 'raw_js') {
    // Keep the cached copy current so any later re-render runs the LATEST script.
    frontendState.rawJs = value || '';
    const html = (data && data.raw_html) || '';
    if (!html) { reexecWidgetJs(el); return; }
    if (UICHEMY_DYNAMIC_TAG_RE.test(html) || UICH_TWIG_RE.test(html)) {
      scheduleDynRender(html);
      return;
    }
    const container = el.querySelector('.elementor-widget-container') || el;
    container.innerHTML = html;
    reexecWidgetJs(el);
    return;
  }

  if (key === 'raw_css') {
    // Append (or update) a per-widget style block. Being last in <head> it wins
    // for equal specificity, so edits override the widget's original CSS.
    const styleId = 'uichemy-fe-css-' + (frontendState.widgetId || frontendState.elementId || 'w');
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    const scopeSelector = frontendState.elementId ? `.elementor-element-${frontendState.elementId}` : '';
    // Strip @keyframes + animation/transition before injecting: this live style
    // is re-written on every edit, and re-applying an animation-bearing block
    // restarts CSS entrance reveals (opacity:0 + animation-delay), flashing an
    // animated section hidden on each tweak. The widget's ORIGINAL animation CSS
    // (server-rendered, untouched) keeps the finished/visible state; only the
    // edited look (color, font, spacing…) is overridden here.
    style.textContent = forceImportant(scopeCssToWidget(stripCssAnimations(value || ''), scopeSelector));
    return;
  }
}

let saveTimer = null;

/** Debounced persistence — POST the widget's current code to the REST endpoint. */
function scheduleSave(data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { doSave(data); }, 800);
}

async function doSave(data) {
  const c = cfg();
  if (!frontendState.postId || !c.restUrl) return;

  try {
    const res = await fetch(c.restUrl + 'frontend/section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': c.nonce || '' },
      credentials: 'same-origin',
      body: JSON.stringify({
        post_id: frontendState.postId,
        widget_index: frontendState.widgetIndex,
        element_id: frontendState.elementId || '',
        builder: frontendState.builder || 'elementor',
        uid: frontendState.uid || '',
        html: data.raw_html || '',
        css: data.raw_css || '',
        js: data.raw_js || '',
      }),
    });
    const out = await res.json();
    if (!out || out.code) {
      window.console && console.error('[UiChemy FE] save error', out && out.code, out && out.message);
      return;
    }
    // The cached copy is now the pre-edit snapshot. Drop it so switching away
    // and back re-reads what was actually saved instead of resurrecting old code.
    invalidateSectionCache(frontendState.postId, frontendState.elementId);
    window.console && console.log('[UiChemy FE] saved widget', frontendState.widgetId);
  } catch (e) {
    window.console && console.error('[UiChemy FE] save failed', e);
  }
}

/**
 * Apply raw_html + raw_css to a composer widget BY ID on the LIVE PAGE, without it
 * being the active/loaded widget. Powers whole-page (global) undo/redo on the
 * front end, where there is no builder editor model — only the rendered section on
 * the page. Paints the DOM instantly, then persists.
 *
 * raw_js is NOT in a history snapshot, and the save REPLACES html/css/js wholesale,
 * so we resolve the widget's CURRENT js (active state → section cache → a GET) and
 * send it back untouched — an undo must never wipe a widget's script.
 *
 * @param {string} id    the widget's element id (history scope key)
 * @param {{raw_html?:string, raw_css?:string}} snap
 * @returns {boolean} true when a target was painted/queued
 */
export function applyFrontendWidgetById(id, snap) {
  if (!id || !snap || typeof document === 'undefined') return false;
  const html = snap.raw_html || '';
  const css = snap.raw_css || '';
  const builder = frontendState.builder || 'elementor';

  // 1) Paint the live section immediately (same rules as applyLive, but scoped to
  //    THIS id instead of frontendState).
  const el = document.querySelector('.elementor-element[data-id="' + id + '"]')
    || document.querySelector('.uichemy-composer-' + id)
    || document.querySelector('[data-id="' + id + '"]');
  try { window.console && console.log('[UiChemy history] applyFrontendWidgetById', id, 'domFound?', !!el, 'builder=', builder); } catch (_) {}
  if (el) {
    if (!(UICHEMY_DYNAMIC_TAG_RE.test(html) || UICH_TWIG_RE.test(html))) {
      const container = el.querySelector('.elementor-widget-container') || el;
      container.innerHTML = html;
      try { reexecWidgetJs(el); } catch (_) { /* re-init best-effort */ }
    }
    const styleId = 'uichemy-fe-css-' + id;
    let style = document.getElementById(styleId);
    if (!style) { style = document.createElement('style'); style.id = styleId; document.head.appendChild(style); }
    style.textContent = forceImportant(scopeCssToWidget(stripCssAnimations(css), '.elementor-element-' + id));
  }

  // 2) Persist — resolve the widget's current js + uid first, then POST a replace.
  const c = cfg();
  const pid = frontendState.postId || c.postId;
  if (!pid || !c.restUrl) return !!el;

  const post = (js, uid) => {
    // Keep the in-memory copy consistent so re-selecting this widget shows the
    // RESTORED code (the loader reads liveCode first, before cache/server).
    try {
      const lkey = liveCodeKey(pid, builder, id, uid);
      const prev = liveCode.get(lkey) || {};
      liveCode.set(lkey, Object.assign({}, prev, { html, css, js: js || '' }));
    } catch (_) { /* best-effort */ }
    fetch(c.restUrl + 'frontend/section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': c.nonce || '' },
      credentials: 'same-origin',
      body: JSON.stringify({
        post_id: pid,
        widget_index: 0, // ignored server-side when element_id/uid resolves the widget
        element_id: 'elementor' === builder ? id : '',
        builder,
        uid: uid || '',
        html,
        css,
        js: js || '',
      }),
    }).then(() => invalidateSectionCache(pid, id)).catch(() => { /* best-effort */ });
  };

  // Active widget → js is in memory. Else look in the section cache (prefetch pulls
  // every widget's full code at page load), matching by key OR widget_id.
  if (id === frontendState.elementId || id === frontendState.widgetId) {
    post(frontendState.rawJs || '', frontendState.uid || '');
    return true;
  }
  let cached = sectionCache.get(cacheKey(pid, id));
  if (!cached) {
    sectionCache.forEach((v) => { if (!cached && v && (v.widget_id === id || v.id === id)) cached = v; });
  }
  if (cached) {
    post(typeof cached.js === 'string' ? cached.js : '', cached.uid || '');
    return true;
  }
  // Cold cache: fetch just to learn js/uid so the replace keeps them intact.
  const base = c.restUrl + 'frontend/section';
  const sep = base.indexOf('?') >= 0 ? '&' : '?';
  const url = base + sep + 'post_id=' + encodeURIComponent(pid)
    + '&element_id=' + encodeURIComponent(id) + '&builder=' + encodeURIComponent(builder);
  fetch(url, { headers: { 'X-WP-Nonce': c.nonce || '' }, credentials: 'same-origin' })
    .then((r) => r.json())
    .then((d) => { post((d && !d.code && d.js) || '', (d && !d.code && (d.uid || d.widget_id)) || ''); })
    .catch(() => post('', ''));
  return true;
}

// ── Live dynamic-value preview ──────────────────────────────────────────────
// A dynamic binding ({{ … }} / {% … %}) resolves only on the server, so painting
// it client-side would show literal tokens. Instead POST the raw snippet to
// frontend/render, which resolves the tokens against this post, and swap the
// returned HTML into the widget — a live preview with no page refresh. Debounced
// so quick edits don't fire a request per keystroke.
let dynRenderTimer = null;
function scheduleDynRender(html) {
  if (dynRenderTimer) clearTimeout(dynRenderTimer);
  dynRenderTimer = setTimeout(function () { doDynRender(html); }, 300);
}
async function doDynRender(html) {
  const c = cfg();
  const el = frontendState.el;
  if (!el || !frontendState.postId || !c.restUrl) return;
  try {
    const res = await fetch(c.restUrl + 'frontend/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': c.nonce || '' },
      credentials: 'same-origin',
      body: JSON.stringify({
        post_id: frontendState.postId,
        html: html,
        uid: frontendState.uid || '',
        builder: frontendState.builder || 'elementor',
      }),
    });
    const out = await res.json();
    if (out && typeof out.html === 'string') {
      const container = el.querySelector('.elementor-widget-container') || el;
      container.innerHTML = out.html;
      reexecWidgetJs(el);
    }
  } catch (e) {
    window.console && console.warn('[UiChemy FE] dynamic render failed', e);
  }
}

export function initFrontendBridge() {
  if (typeof window === 'undefined') return;

  // Phase F2c/F3 — every edit reflects on the page instantly (applyLive) and is
  // auto-saved (debounced) so it survives a refresh.
  setFrontendChangeHook(function (key, value, data) {
    try { applyLive(key, value, data); } catch (e) { window.console && console.warn('[UiChemy FE] applyLive failed', e); }
    // Keep the in-memory copy current the instant an edit commits, so switching
    // to another element and back reads the fresh code immediately rather than
    // the pre-edit cache/server copy the debounced save hasn't replaced yet.
    if (frontendState.liveKey) {
      liveCode.set(frontendState.liveKey, Object.assign({}, frontendState.loadedData || {}, {
        html: (data && data.raw_html) || '',
        css: (data && data.raw_css) || '',
        js: (data && data.raw_js) || '',
      }));
    }
    scheduleSave(data);
  });

  window.addEventListener('uichemy:frontend:widget-selected', function (e) {
    if (e && e.detail) loadPickedWidget(e.detail);
  });

  // The bridge reports what is on the page as soon as it has scanned the DOM.
  // Warm the cache per OWNER post — widgets in a global header/footer belong to
  // their template's post, so a page can span more than one.
  window.addEventListener('uichemy:frontend:widgets-discovered', function (e) {
    const posts = (e && e.detail && e.detail.postIds) || [];
    posts.forEach(function (pid) { prefetchSections(pid); });
  });

  // …and pull the same list directly, in case the bridge finished scanning before
  // this listener existed. prefetchSections() de-duplicates per post, so whichever
  // path wins, the request is made exactly once.
  const pullPostIds = function () {
    try {
      if (window.UiChemyFrontend && typeof window.UiChemyFrontend.ownerPostIds === 'function') {
        window.UiChemyFrontend.ownerPostIds().forEach(function (pid) { prefetchSections(pid); });
      }
    } catch (_) { /* cold cache is a valid state */ }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pullPostIds);
  } else {
    pullPostIds();
  }

  /** Composer setting key → the field name the REST payload and caches use. */
  var FE_CODE_FIELD = { raw_html: 'html', raw_css: 'css', raw_js: 'js' };

  /** The live settings model, but only when `widgetId` IS the current selection. */
  function feActiveSettings(widgetId) {
    var active = getActiveWidgetSync();
    var settings = active && active.settings;
    if (!settings || typeof settings.get !== 'function') return null;
    if (widgetId && widgetId !== frontendState.elementId && widgetId !== frontendState.widgetId) return null;
    return settings;
  }

  function feWidgetData(widgetId) {
    var c = cfg();
    var postId = frontendState.postId || c.postId;
    if (!postId || !widgetId) return null;
    // Only the current selection can be a Gutenberg/Bricks widget (those are keyed
    // by uid); anything else addressable by element id on a live page is Elementor.
    var lkey = (widgetId === frontendState.elementId && frontendState.liveKey)
      ? frontendState.liveKey
      : liveCodeKey(postId, 'elementor', widgetId, '');
    return liveCode.get(lkey) || sectionCache.get(cacheKey(postId, widgetId)) || null;
  }

  /** Paint a non-selected widget's new code onto the live page. */
  function feRepaintWidget(widgetId, data) {
    var el = document.querySelector('.elementor-element[data-id="' + widgetId + '"]');
    if (!el) return;

    var html = data.html || '';
    if (!UICHEMY_DYNAMIC_TAG_RE.test(html) && !UICH_TWIG_RE.test(html)) {
      var container = el.querySelector('.elementor-widget-container') || el;
      container.innerHTML = html;
      reexecWidgetJs(el, data.js || '');
    }

    var styleId = 'uichemy-fe-css-' + widgetId;
    var style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = forceImportant(
      scopeCssToWidget(stripCssAnimations(data.css || ''), '.elementor-element-' + widgetId)
    );
  }

  function feWriteOtherWidget(widgetId, key, value) {
    var c = cfg();
    var postId = frontendState.postId || c.postId;
    var field = FE_CODE_FIELD[key];
    if (!postId || !widgetId || !field || !c.restUrl) return false;

    var known = feWidgetData(widgetId);
    if (!known) return false;

    var next = Object.assign({}, known, { widget_id: known.widget_id || widgetId });
    next[field] = value == null ? '' : String(value);

    // Update both caches before the request so an immediately-following read
    // (the agent verifying its own write) sees the new code, not the old.
    liveCode.set(liveCodeKey(postId, 'elementor', widgetId, ''), next);
    sectionCache.set(cacheKey(postId, widgetId), next);

    try { feRepaintWidget(widgetId, next); } catch (e) {
      window.console && console.warn('[UiChemy FE] repaint failed', e);
    }

    fetch(c.restUrl + 'frontend/section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': c.nonce || '' },
      credentials: 'same-origin',
      body: JSON.stringify({
        post_id: postId,
        widget_index: 0,
        element_id: widgetId,
        builder: 'elementor',
        uid: '',
        html: next.html || '',
        css: next.css || '',
        js: next.js || '',
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (out) {
        if (!out || out.code) {
          window.console && console.error('[UiChemy FE] agent save error', out && out.code, out && out.message);
        }
      })
      .catch(function (e) { window.console && console.error('[UiChemy FE] agent save failed', e); });

    return true;
  }

  /**
   * Translate "insert after widget `afterId`" into the 0-based child index that
   * /frontend/insert expects in `insert_index`.
   *
   * Server side that index addresses the children of the Elementor container
   * holding the Composer widgets (see insert_widget_at_index_in_container), and on
   * a rendered page those children are exactly the target's `.elementor-element`
   * siblings — so the DOM position is the authoritative answer here, where no
   * builder model exists to ask.
   *
   * Returns 0 for a missing id (the tool documents omitting it as "insert at the
   * top"), and null when the reference widget isn't on the page, which the
   * endpoint treats as its append default rather than guessing a position.
   *
   * @param {string} afterId reference widget's element id.
   * @returns {number|null} index to insert at, or null to append.
   */
  function feInsertIndexAfter(afterId) {
    if (!afterId) return 0;
    var el = document.querySelector('.elementor-element[data-id="' + String(afterId) + '"]');
    if (!el || !el.parentElement) return null;
    var siblings = Array.prototype.filter.call(el.parentElement.children, function (n) {
      return n.classList && n.classList.contains('elementor-element');
    });
    var at = siblings.indexOf(el);
    return -1 === at ? null : at + 1;
  }

  // ── Page-scope bridge for the chat (create/list on the LIVE page) ──────────
  // The public page has no builder editor model, so the Pro chat routes its
  // page-scope ops here (see nonElementorPageBridge in composer-chat.jsx). List
  // is served from the already-warmed section cache; create persists server-side
  // via /frontend/insert (builder-aware) and reloads to reveal the new element.
  window.UichComposerFrontend = {
    readSetting: function (widgetId, key) {
      var wid = String(widgetId || '') || frontendState.elementId || '';
      var settings = feActiveSettings(wid);
      // The selected widget's model is authoritative — it holds edits the user
      // made in the panel this instant.
      if (settings) return settings.get(key) || '';
      var data = feWidgetData(wid);
      if (!data) return '';
      var field = FE_CODE_FIELD[key];
      // Page/site code ride on the payload under their own names already.
      return (field ? data[field] : data[key]) || '';
    },

    writeSetting: function (widgetId, key, value) {
      var wid = String(widgetId || '') || frontendState.elementId || '';
      var settings = feActiveSettings(wid);
      if (settings) {
        settings.set(key, value == null ? '' : String(value));
        return true;
      }
      return feWriteOtherWidget(wid, key, value);
    },

    getPageCode: function () {
      var settings = feActiveSettings('');
      if (settings) {
        return {
          head: settings.get('page_custom_code_head') || '',
          body: settings.get('page_custom_code_footer') || '',
        };
      }
      var data = feWidgetData(frontendState.elementId || '');
      return {
        head: (data && data.page_custom_code_head) || '',
        body: (data && data.page_custom_code_footer) || '',
      };
    },

    setPageCode: function () {
      return {
        success: false,
        error: 'Page head/body code cannot be saved from the live page. Open this page in the Elementor editor to change it.',
      };
    },

    listComposerBlocks: function () {
      var out = [];
      try {
        sectionCache.forEach(function (v) {
          if (!v || !v.widget_id) return;
          out.push({
            id: v.widget_id,
            label: v.label || ('Widget ' + String(v.widget_id).slice(0, 6)),
            htmlPreview: (v.html || '').slice(0, 200),
          });
        });
      } catch (e) { /* cold cache → empty list is valid */ }
      return out;
    },
    insertComposerAfter: function (afterId, html, css, js, label) {
      var c = cfg();
      if (!c.restUrl || !c.postId) {
        return { success: false, error: 'Front-end config missing (postId/restUrl).' };
      }
      var base = c.restUrl + 'frontend/insert';
      return fetch(base, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': c.nonce || '' },
        body: JSON.stringify({
          post_id: c.postId,
          builder: c.builder || 'elementor',
          insert_index: feInsertIndexAfter(afterId),
          html: html || '',
          css: css || '',
          js: js || '',
          label: label || 'New Section',
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || false === data.success || data.code) {
            return { success: false, error: (data && (data.message || data.error)) || 'Insert failed on the server.' };
          }
          var res = data.result || {};
          // The new widget lives only in saved content — a live page can't mount a
          return {
            success:     true,
            widgetId:    res.widget_id || '',
            label:       res.label || label || 'New Section',
            needsReload: true,
          };
        })
        .catch(function (e) {
          return { success: false, error: (e && e.message) || 'Insert request failed.' };
        });
    },
  };

  window.console && console.log('[UiChemy FE] React frontend bridge ready');
}
