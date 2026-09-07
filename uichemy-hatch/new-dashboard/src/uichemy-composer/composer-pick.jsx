// Pick-element flow — when active, listens for hover/click inside the
// Elementor widget's rendered content in the preview iframe, highlights
// the candidate, and resolves the click to a layer path so we can select
// the matching entry in the Layers tree.
import React from 'react';
import { pathRelevantChildren, computePathForNode } from './composer-layer-tree';
import { drawBoxOverlay, clearBoxOverlay } from './composer-box-overlay';
import { drawBoxHandles, clearBoxHandles } from './composer-box-handles';
import {
  openInlineText, closeInlineText, repositionInlineText,
  isInlineTextOpen, isInlineTextAnchorStale, reanchorInlineText,
  inlineTextBlockReason, inlineTextEditMode, openRichText, closeRichText,
  isRichTextOpen, itLog,
} from './composer-canvas-text';

const HOVER_CLASS = 'uich-composer-hover-target';
const SELECTED_CLASS = 'uich-composer-selected-target';
// Chat pick uses its own persistent-selected class (visually identical) so its
// cleanup sweep never touches the editor tab's SELECTED_CLASS outline, which is
// owned by useSelectionDecorator. Keeping them separate lets the two tabs'
// selection highlights coexist without one wiping the other on a tab switch.
const CHAT_SELECTED_CLASS = 'uich-composer-chat-selected-target';
// Persistent solid box around the WHOLE active widget. Shown for as long as a
// widget is loaded — regardless of the panel being open/collapsed, the active
// tab, or whether a specific element is selected — so the user always sees
// which widget they're editing (owned by useActiveWidgetOutline).
const WIDGET_SELECTED_CLASS = 'uich-composer-widget-selected-target';
const PICKING_CLASS = 'uich-composer-picking';
// Fired by useChatPickMode on every pick, carrying the clicked node. Consumed by
// useChatPickSelection (below) so the panel can select the same element.
const CHAT_PICKED_NODE_EVENT = 'uichemy:composer:chat-picked-node';
const STYLE_ID = 'uich-composer-pick-styles';
// Must match WIDGET_SELECTOR in assets/js/uichemy-frontend-bridge.js — the
// wrapper class Elementor puts on every Composer widget's `.elementor-element`.
// Used by usePickMode to recognize a click on a DIFFERENT widget/section than
// the one currently loaded, so the picker can switch to it instead of
// silently ignoring the click (see onSwitchWidget below).
// The legacy classes cover widgets still stored under the pre-rename types
// (`proton`, `uichemy-builder`), which render under their own wrapper class
// until Uich_Builder_Migration rewrites the row. See the hidden aliases in
// class-uichemy-composer-widget-legacy.php.
export const COMPOSER_WIDGET_SELECTOR =
  '.elementor-widget-uichemy-composer, .elementor-widget-composer, .elementor-widget-proton, .elementor-widget-uichemy-builder';

function ensurePickStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  // Literal values (not CSS vars): this stylesheet is injected into the
  // Elementor preview document, where the composer's theme variables don't
  // exist.
  //
  // MONOCHROME: the selection accent was #4B22CC, UiChemy brand purple, with a
  // matching 8% purple wash. It is black and white now, like the rest of the
  // composer chrome. One wrinkle this overlay has that the panel doesn't: it is
  // drawn on the USER'S page, which can be any colour, so a single flat stroke
  // is not safe — a black outline disappears on a dark section. Every outline
  // therefore ships a white halo behind it (an outer box-shadow, which paints
  // under the outline), and the hover wash is mid-grey rather than black, since
  // grey at low alpha darkens a light section and lightens a dark one.
  style.textContent = `
    .${PICKING_CLASS},
    .${PICKING_CLASS} * {
      cursor: crosshair !important;
    }
    /* Never let the crosshair leak onto the UiChemy panel. On the live page the
       panel shares this document with the picked content, so the body-level
       rule above would otherwise paint it too. These MUST stay gated under
       .${PICKING_CLASS} (i.e. only while actively picking) — the stylesheet
       persists in the document after pick ends, so an un-gated rule would keep
       overriding the panel's own cursors forever. (In the editor these match
       nothing in the preview iframe, so it's a harmless no-op there.) */
    .${PICKING_CLASS} #uichemy-composer-floating-panel, .${PICKING_CLASS} #uichemy-composer-floating-panel *,
    .${PICKING_CLASS} .uichemy-composer-floating-panel, .${PICKING_CLASS} .uichemy-composer-floating-panel * {
      cursor: auto !important;
    }
    .${PICKING_CLASS} #uichemy-composer-floating-panel button, .${PICKING_CLASS} #uichemy-composer-floating-panel a, .${PICKING_CLASS} #uichemy-composer-floating-panel [role="button"],
    .${PICKING_CLASS} .uichemy-composer-floating-panel button, .${PICKING_CLASS} .uichemy-composer-floating-panel a, .${PICKING_CLASS} .uichemy-composer-floating-panel [role="button"] {
      cursor: pointer !important;
    }
    .${PICKING_CLASS} #uichemy-composer-floating-panel input, .${PICKING_CLASS} #uichemy-composer-floating-panel textarea,
    .${PICKING_CLASS} .uichemy-composer-floating-panel input, .${PICKING_CLASS} .uichemy-composer-floating-panel textarea {
      cursor: text !important;
    }
    /* The hover HIGHLIGHT is no longer drawn as an outline on the element itself
       (two different elements can't tween, so it jumped A→B). It is now a single
       floating ring (#uich-hover-ring) that SLIDES between elements — see
       ensureHoverRing/moveHoverRing. This class stays as the hover MARKER (logic
       + cursor); it just doesn't paint its own box anymore. */
    .${HOVER_CLASS} {
      cursor: crosshair !important;
    }
    .${WIDGET_SELECTED_CLASS} {
      outline: 1px solid #EC0868 !important;
      /* Inset so the box hugs the widget and can't be clipped by an
         ancestor's overflow:hidden (the reason a positive offset vanishes). */
      outline-offset: -2px !important;
      /* Halo goes INSIDE too, since the outline itself is inset. */
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.9) !important;
    }
    .${SELECTED_CLASS},
    .${CHAT_SELECTED_CLASS} {
      outline: 1px dashed #EC0868 !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.9) !important;
    }
    /* (The old .selected.hover override is gone: hover is the sliding ring now,
       so a selected element keeps its dashed selected outline and the ring rides
       on top — no second static outline to fight it.) */
  `;
  doc.head.appendChild(style);
}

// ── Sliding hover ring ──────────────────────────────────────────────────────
// A SINGLE floating box (per preview document) that follows the hovered element.
// Because it's one persistent element, moving it from one target's rect to the
// next's is a smooth CSS slide — which a class-based `outline` on the elements
// themselves can never be (they're separate boxes, nothing to tween). Snaps
// (no position transition) on first appearance and while hidden, so it never
// slides in from a stale spot.
const HOVER_RING_ID = 'uich-hover-ring';
const HOVER_RING_SLIDE =
  'left .13s cubic-bezier(.22,1,.36,1), top .13s cubic-bezier(.22,1,.36,1), '
  + 'width .1s cubic-bezier(.22,1,.36,1), height .1s cubic-bezier(.22,1,.36,1), opacity .1s ease';

function ensureHoverRing(doc) {
  let ring = doc.getElementById(HOVER_RING_ID);
  if (ring) return ring;
  ring = doc.createElement('div');
  ring.id = HOVER_RING_ID;
  ring.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;'
    + 'z-index:2147483000;box-sizing:border-box;'
    + 'outline:1px solid #EC0868;outline-offset:0;'
    + 'box-shadow:0 0 0 2px rgba(255,255,255,0.9);'
    + 'transition:opacity .1s ease;';
  (doc.body || doc.documentElement).appendChild(ring);
  return ring;
}

function moveHoverRing(el) {
  if (!el || !el.getBoundingClientRect) return;
  const doc = el.ownerDocument;
  if (!doc) return;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return;
  const ring = ensureHoverRing(doc);
  // Slide only when already visible (element → element). Otherwise snap.
  const visible = ring.style.opacity === '1';
  ring.style.transition = visible ? HOVER_RING_SLIDE : 'opacity .1s ease';
  ring.style.left = `${Math.round(r.left)}px`;
  ring.style.top = `${Math.round(r.top)}px`;
  ring.style.width = `${Math.round(r.width)}px`;
  ring.style.height = `${Math.round(r.height)}px`;
  ring.style.opacity = '1';
}

function hideHoverRing(doc) {
  const ring = doc && doc.getElementById && doc.getElementById(HOVER_RING_ID);
  if (ring) ring.style.opacity = '0';
}

function removeHoverRing(doc) {
  const ring = doc && doc.getElementById && doc.getElementById(HOVER_RING_ID);
  if (ring) { try { ring.remove(); } catch (_) { /* noop */ } }
}

export function getWidgetRoot(model) {
  if (!model || typeof model.get !== 'function') return null;

  // Documents to search: the main page + one level of iframes (the block-editor
  // canvas / Elementor preview iframe both live here).
  const docs = [document];
  document.querySelectorAll('iframe').forEach((f) => {
    let d = null;
    try { d = f.contentDocument; } catch (_) {}
    if (d) docs.push(d);
  });

  // Gutenberg: locate the active block's wrapper, whose rendered HTML lives one
  // sandboxed iframe deeper (the block-editor canvas is itself one iframe; the
  // composer renders its Figma HTML in a further-nested PreviewFrame). Drill
  // into that inner <body> so it plays the same implicit-wrapper role
  // .elementor-widget-container does for Elementor, and computePathForNode()
  // lines up with the parser's entries. Without this, getWidgetRoot returned
  // null on Gutenberg — usePickMode bailed and the Editor-tab canvas element
  // picker was dead there. Selectors, best → fallback:
  //   • editor: the block's own wrapper id="block-<clientId>"
  //   • front end: the PHP render's .uichemy-composer-<uid> scope class
  //   • last resort: the standard .wp-block-uichemy-composer marker
  // (Elementor's model is not __uichGutenberg, so it uses the path below.)
  if (model.__uichGutenberg) {
    const clientId = model.get('id');
    const uid = model.get('uid');
    for (const d of docs) {
      let wrapper = null;
      try {
        if (clientId && d.getElementById) wrapper = d.getElementById(`block-${clientId}`);
        if (!wrapper && uid && d.querySelector) wrapper = d.querySelector(`.uichemy-composer-${uid}`);
        if (!wrapper && d.querySelector) wrapper = d.querySelector('.wp-block-uichemy-composer');
      } catch (_) { /* detached / cross-origin */ }
      if (!wrapper) continue;
      const nested = wrapper.querySelector('iframe');
      if (nested) {
        let ndoc = null;
        try { ndoc = nested.contentDocument; } catch (_) {}
        // Prefer the `#uich-pv-root` content wrapper (index.js) so layer paths line
        // up with raw_html and — crucially — our box-handles/overlay (appended to
        // <body>, OUTSIDE this root) survive the in-place content updates that keep
        // the Gutenberg preview from reloading.
        if (ndoc && ndoc.body) return ndoc.getElementById('uich-pv-root') || ndoc.body;
      }
      return wrapper; // inline render (e.g. front end) — no nested iframe.
    }
    return null;
  }

  // Bricks: the rendered element carries the shared `.uichemy-composer-<uid>`
  // scope class from UiChemy_Composer_Renderer directly on its own root node —
  // no Elementor-style wrapper-container, no Gutenberg-style nested sandboxed
  // iframe, so a single-level match is enough. composer-bricks.jsx's model has
  // no separate uid vs id: its get('id') already returns the raw Bricks
  // element id that class-uichemy-bricks-composer.php sanitizes into that
  // scope class at render time. Without this branch, getWidgetRoot() always
  // fell through to the Elementor lookup below (which never matches on
  // Bricks), returned null, and usePickMode/useActiveWidgetOutline/
  // useSelectionDecorator all silently no-opped — confirmed live: clicking
  // the canvas toolbar's "Select / pick element" toggled the button's own
  // active state, but no PICKING_CLASS/crosshair/hover ever applied, and
  // clicking an element inside the widget did nothing.
  if (model.__uichBricks) {
    const elementId = model.get('id');
    if (!elementId) return null;
    for (const d of docs) {
      let el = null;
      try { el = d.querySelector(`.uichemy-composer-${elementId}`); } catch (_) { /* detached / cross-origin */ }
      if (el) return el;
    }
    return null;
  }

  // Elementor: the rendered widget lives in .elementor-widget-container.
  const widgetId = model.get('id');
  if (!widgetId) return null;
  for (const d of docs) {
    const el = d.querySelector(`.elementor-element[data-id="${widgetId}"] .elementor-widget-container`);
    if (el) return el;
  }
  return null;
}

// Always return the .elementor-widget-container itself. It plays the role
// of the implicit `<div>` wrapper the parser uses around raw_html, so
// computePathForNode produces paths that line up with the parser's entries
// 1:1 (path `0.X` = widget-container.children[X], same as parser's path).

// "Ours, not the page" — anything the picker must never treat as a pick target.
//
// Beyond the panel itself this has to name our CANVAS-side chrome: the handle
// bar (typography controls) and the inline text editor live in the previewed
// document, right on top of the content being picked, so without them listed a
// click on the font-size control read as a pick. That is why the handle bar used
// to be hidden outright while picking was armed.
//
// Matched by ID on purpose. Giving these hosts `.uich-composer-host` would be
// the shorter fix and a bad one — that class is the lookup key for "the composer
// panel" (composer-variables.jsx portals into the first match in document
// order), so a second element carrying it hijacks those lookups.
const OUR_CHROME_SEL = '#uichemy-composer-floating-panel, .uichemy-composer-floating-panel, .uich-composer-host,'
  + ' #uich-box-handles, #uich-inline-text, #uich-box-overlay';

function isInsidePanel(node) {
  return !!(node && node.closest && node.closest(OUR_CHROME_SEL));
}

// Chat pick should only target real widgets (and the content inside them),
// never a builder's structural scaffolding — empty sections/columns/containers,
// "Drag widget here" placeholders, or the add-widget / add-section buttons.
// Elementor widgets always carry `.elementor-widget`; Gutenberg's Composer
// block always carries `.wp-block-uichemy-composer` (WordPress's standard
// auto-generated block class, constant across every instance). Bricks has no
// equivalent fixed marker of its own (its wrapper only carries Bricks-internal
// classes like `brxe-uichemy-composer`/`brxe-<id>`), but every builder's
// rendered output — Bricks included — carries the shared
// `.uichemy-composer-<uid>` scope class from UiChemy_Composer_Renderer, so an
// attribute-contains match on that covers Bricks too. Requiring any of the
// three (on the node itself or an ancestor) cleanly excludes all of the above
// scaffolding on every builder.
const WIDGET_MARKER_SELECTOR = '.elementor-widget, .wp-block-uichemy-composer, [class*="uichemy-composer-"]';
function isInsideWidget(node) {
  return !!(node && node.closest && node.closest(WIDGET_MARKER_SELECTOR));
}

// The widget wrapper matched by WIDGET_MARKER_SELECTOR sometimes only holds a
// further-nested, sandboxed content iframe — Gutenberg renders the composer's
// Figma-generated HTML/CSS/JS this way, isolated from the rest of the shared
// block-editor canvas iframe (which holds every block on the page, not just
// this one). Drill into that inner iframe's document when present: listeners
// have to attach where real hit-testing happens, since events firing inside a
// child iframe never bubble into an ancestor document. Bounded loop guards
// against any unexpected multi-level nesting.
function resolveInnerContentDoc(doc) {
  let current = doc;
  for (let i = 0; i < 4; i += 1) {
    const marker = current.querySelector(WIDGET_MARKER_SELECTOR);
    if (!marker) break;
    const nestedFrame = marker.querySelector('iframe');
    if (!nestedFrame) break;
    let nestedDoc = null;
    try { nestedDoc = nestedFrame.contentDocument; } catch (_) {}
    if (!nestedDoc || !nestedDoc.body) break;
    current = nestedDoc;
  }
  return current;
}

// ── Chat-pick CSS-selector helper ────────────────────────────────────────────
// Returns a short, human-readable CSS selector for any DOM element.
// Skips Elementor / UiChemy internal class names so the label is meaningful.
function getChatPickSelector(el) {
  if (!el || !el.tagName) return '';
  const tag = el.tagName.toLowerCase();
  // Prefer a non-Elementor id
  if (el.id && !/^elementor[-_]|^e-/.test(el.id)) return `#${el.id}`;
  // First meaningful class name. Skip framework internals and any
  // dynamically-added editor markers (selection / hover / picking
  // highlights) so they never leak into the selector. Note: `uich`
  // without a trailing hyphen also covers the `uichemy-…` prefix.
  const cls = Array.from(el.classList || []).find(
    (c) => c && !c.startsWith('uich-composer-') && !c.startsWith('uichemy-composer-') &&
           !c.startsWith('elementor') &&
           !c.startsWith('e-') && !c.startsWith('swiper-') &&
           !/(selected|hover|picking)-target/.test(c)
  );
  if (cls) return `${tag}.${cls}`;
  return tag;
}

/**
 * Load the Composer section that owns `node`, unless it is already the loaded one.
 * Returns true when a switch was actually requested.
 *
 * Two mechanisms, one intent — the chat picker and the Draw surface both roam the
 * WHOLE page, so either can land in a section other than the one the panel (and
 * therefore every chat request's widget context) points at:
 *
 *   • Live page — the bridge's selectNode(), which carries the clicked node
 *     through so the panel also lands on that element, not the first layer.
 *   • Elementor editor — $e's select command. It opens that widget's panel, which
 *     is what fires `panel/open_editor/widget/composer` and drives the same
 *     store the composer reads. (Only the SECTION switches here; the editor has no
 *     cross-section element anchor.)
 *
 * @param {Element} node            The element the user picked / drew on.
 * @param {string}  currentWidgetId Section currently loaded in the panel.
 * @returns {boolean}
 */
export function switchToSectionForNode(node, currentWidgetId) {
  if (!node || !node.closest) return false;
  const SEL = `${COMPOSER_WIDGET_SELECTOR}, .wp-block-uichemy-composer`;
  let w = node.closest(SEL);

  if (!w) {
    let frame = node.ownerDocument && node.ownerDocument.defaultView
      && node.ownerDocument.defaultView.frameElement;
    for (let i = 0; i < 4 && frame && !w; i += 1) {
      try {
        w = frame.closest(SEL);
        frame = frame.ownerDocument && frame.ownerDocument.defaultView
          && frame.ownerDocument.defaultView.frameElement;
      } catch (_) { break; } // cross-origin — nothing more to walk
    }
  }
  if (!w) return false;

  // Gutenberg: the block's clientId is on the wrapper, and selecting it is a
  // store dispatch rather than an editor command.
  const clientId = w.getAttribute && w.getAttribute('data-block');
  if (clientId) {
    if (currentWidgetId && clientId === currentWidgetId) return false; // already loaded
    try {
      const data = typeof window !== 'undefined' && window.wp && window.wp.data;
      const dispatch = data && data.dispatch && data.dispatch('core/block-editor');
      if (dispatch && typeof dispatch.selectBlock === 'function') {
        // Same marker as the front-end path: selecting a block makes the panel
        // stage its Editor tab, and ChatTab clears its picked targets the moment
        // it stops being the active tab. Flagging the switch as chat-initiated is
        // what lets both of those leave the pick alone.
        try { window.__uichSelectFromChat = Date.now(); } catch (_) {}
        dispatch.selectBlock(clientId);
        return true;
      }
    } catch (_) { /* fall through to the paths below */ }
  }

  const wrap = w.closest('.elementor-element[data-id]');
  const id = wrap ? wrap.getAttribute('data-id') : '';
  if (id && currentWidgetId && id === currentWidgetId) return false; // already loaded

  try {
    const api = typeof window !== 'undefined' ? window.UiChemyFrontend : null;
    if (api && typeof api.selectNode === 'function') {

      try { window.__uichSelectFromChat = Date.now(); } catch (_) {}
      return !!api.selectNode(node);
    }
  } catch (_) { /* fall through to the editor path */ }

  try {
    if (id && window.$e && typeof window.$e.run === 'function'
        && window.elementor && typeof window.elementor.getContainer === 'function') {
      const container = window.elementor.getContainer(id);
      if (container) {
        window.$e.run('document/elements/select', { container });
        return true;
      }
    }
  } catch (_) { /* selection is best-effort */ }
  return false;
}

// ── Chat pick mode — picks ANY element anywhere in the preview ────────────────
// Unlike usePickMode (which restricts to one widget's container and returns a
// layer-tree path), this hook finds the preview iframe independently of which
// widget is open, and calls onPicked(selector) with a plain CSS selector string.
export function useChatPickMode({ picking, setPicking, onPicked, onSwitchWidget }) {
  React.useEffect(() => {
    if (!picking) return undefined;

    // Find the preview document (editor). Elementor and Bricks render inline
    // in the main document or their own iframe; Gutenberg always renders in
    // `iframe[name="editor-canvas"]`. On the live page (frontend editor)
    // there is no iframe at all — the content is in the main document, so
    // fall back to it. WIDGET_MARKER_SELECTOR covers both builders' markers.
    let previewDoc = null;
    const frames = Array.from(document.querySelectorAll('iframe'));
    for (const f of frames) {
      try {
        const d = f.contentDocument;
        if (d && d.querySelector(WIDGET_MARKER_SELECTOR)) { previewDoc = d; break; }
      } catch (_) {}
    }
    if (!previewDoc && document.querySelector(WIDGET_MARKER_SELECTOR)) {
      previewDoc = document;
    }
    if (!previewDoc) return undefined; // preview not accessible yet

    // See resolveInnerContentDoc: the wrapper doc found above may just hold a
    // sandboxed content iframe with the widget's actual DOM. When we drill
    // into it, every node in that document is by definition part of the
    // widget's rendered output (there is no `.wp-block-uichemy-composer` /
    // `.elementor-widget` marker inside it to check against), so the
    // isInsideWidget() gate below has to be skipped for that document.
    const nestedDocs = [];
    try {
      for (const marker of Array.from(previewDoc.querySelectorAll(WIDGET_MARKER_SELECTOR))) {
        const frame = marker.querySelector('iframe');
        if (!frame) continue;
        let d = null;
        try { d = frame.contentDocument; } catch (_) { /* cross-origin */ }
        if (d && d.body && !nestedDocs.includes(d)) nestedDocs.push(resolveInnerContentDoc(d));
      }
    } catch (_) { /* fall through to the single-document path */ }

    const pickDocs = nestedDocs.length ? nestedDocs : [resolveInnerContentDoc(previewDoc)];
    const skipWidgetMarkerCheck = nestedDocs.length > 0 || pickDocs[0] !== previewDoc;
    previewDoc = pickDocs[0];

    // Force the crosshair across the whole preview while picking, so it
    // never falls back to the default cursor when the pointer is idle or
    // the hovered node briefly loses its hover class.
    const pickBodies = [];
    for (const d of pickDocs) {
      ensurePickStyles(d);
      const body = d.body || d.documentElement;
      if (body?.classList) body.classList.add(PICKING_CLASS);
      if (body) pickBodies.push(body);
    }
    const pickBody = pickBodies[0];
    let lastHover = null;
    // Track elements the user has picked so they keep a persistent
    // "selected" outline (mirrors the editor tab), and so we can clean
    // them all up when pick mode ends.
    const selectedEls = new Set();

    function clearHover() {
      if (lastHover?.classList) lastHover.classList.remove(HOVER_CLASS);
      lastHover = null;
      // Every preview, not just the first: with a block per iframe the ring the
      // pointer just left may live in a different document than pickDocs[0].
      for (const d of pickDocs) hideHoverRing(d);
    }

    function onMove(e) {
      const target = e.target;
      const tag = target?.tagName;
      if (!target || !tag || tag === 'HTML' || tag === 'BODY'
          || isInsidePanel(target) || (!skipWidgetMarkerCheck && !isInsideWidget(target))) {
        clearHover(); return;
      }
      if (target === lastHover) return;
      // Swap the marker class and SLIDE the ring — do NOT hide it in between
      // (clearHover would, which makes the next move snap instead of slide).
      if (lastHover?.classList) lastHover.classList.remove(HOVER_CLASS);
      target.classList?.add(HOVER_CLASS);
      lastHover = target;
      moveHoverRing(target);
    }

    function commit(e) {
      const target = e.target;
      const tag = target?.tagName;
      if (!target || !tag || tag === 'HTML' || tag === 'BODY'
          || isInsidePanel(target) || (!skipWidgetMarkerCheck && !isInsideWidget(target))) return;
      e.preventDefault();
      e.stopPropagation();
      clearHover();
      // Add a persistent selected outline on the clicked element so it stays
      // highlighted after picking (matches the editor tab). Selecting is
      // idempotent — clicking an already-selected element keeps it selected
      // (never toggles it off); removal is done via the chip's × / Cancel.
      if (target.classList && !selectedEls.has(target)) {
        target.classList.add(CHAT_SELECTED_CLASS);
        selectedEls.add(target);
      }
      if (typeof onPicked === 'function') onPicked(getChatPickSelector(target), { node: target });
      // Publish the raw NODE as well as the selector. The selector is a readable
      // label for the chat chip; it is not enough to drive an editor selection,
      // and the chip pipeline lives in the Pro bundle. Broadcasting the node lets
      // the panel (which owns `model`, and therefore getWidgetRoot) turn the pick
      // into a layer path and select it — which is what puts the on-canvas
      // typography bar on screen while Chat is the visible tab. An event rather
      // than a new prop, so the Pro-side caller of this hook needs no change.
      try {
        window.dispatchEvent(new CustomEvent(CHAT_PICKED_NODE_EVENT, {
          detail: { node: target },
        }));
      } catch (_) { /* older browsers */ }
      // The picked element can live in a DIFFERENT section than the one loaded —
      // this picker roams the whole page, unlike the editor's in-widget one. Hand
      // the node over so the panel switches to that section AND lands on this
      // element. Without it the chat targets one section while the request's
      // widget context still points at another, so the AI edits the wrong one.
      if (typeof onSwitchWidget === 'function') {
        try { onSwitchWidget(target); } catch (_) { /* switching is best-effort */ }
      }
      // Finish as soon as one element is picked — the selection is immediate,
      // there is no separate Done step. To target additional elements the user
      // clicks Pick again and picks another.
      setPicking(false);
    }

    function swallowClick(e) {
      if (!e || isInsidePanel(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    }

    // Elementor re-writes element class attributes on its own render cycle,
    // which strips our hover/selected/picking classes when the pointer is
    // idle. Watch for that and immediately re-apply so nothing flickers off.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName !== 'class') continue;
        const t = m.target;
        if (!t.classList) continue;
        if (t === lastHover && !t.classList.contains(HOVER_CLASS)) {
          t.classList.add(HOVER_CLASS);
        }
        if (selectedEls.has(t) && !t.classList.contains(CHAT_SELECTED_CLASS)) {
          t.classList.add(CHAT_SELECTED_CLASS);
        }
      }
      for (const body of pickBodies) {
        if (body?.classList && !body.classList.contains(PICKING_CLASS)) {
          body.classList.add(PICKING_CLASS);
        }
      }
    });
    for (const body of pickBodies) {
      observer.observe(body, { attributes: true, attributeFilter: ['class'], subtree: true });
    }

    for (const d of pickDocs) {
      d.addEventListener('mousemove', onMove,       true);
      d.addEventListener('mousedown', commit,       true);
      d.addEventListener('click',     swallowClick, true);
    }

    return () => {
      // Disconnect first so nothing re-applies while we sweep.
      observer.disconnect();
      lastHover = null;
      selectedEls.clear();
      // Sweep the whole preview — a race with Elementor's re-render can leave
      // a stray hover/selected/picking class on a node we no longer track;
      // nuke them all so no highlight lingers once pick mode is off.
      for (const body of pickBodies) {
        try {
          if (body?.classList) body.classList.remove(PICKING_CLASS);
          body.querySelectorAll('.' + HOVER_CLASS)
            .forEach((el) => el.classList.remove(HOVER_CLASS));
          body.querySelectorAll('.' + CHAT_SELECTED_CLASS)
            .forEach((el) => el.classList.remove(CHAT_SELECTED_CLASS));
        } catch (_) {}
      }
      for (const d of pickDocs) {
        removeHoverRing(d);
        d.removeEventListener('mousemove', onMove,       true);
        d.removeEventListener('mousedown', commit,       true);
        d.removeEventListener('click',     swallowClick, true);
      }
    };
  }, [picking, setPicking, onPicked, onSwitchWidget]);
}

/**
 * Turn a chat pick into an EDITOR selection.
 *
 * Chat's own picker (above) only ever produced a chip: `onPicked` hands back a
 * CSS selector for the request, and `onSwitchWidget` selects the whole widget —
 * and even that no-ops when the picked node is already inside the loaded one.
 * Nothing set the inner-element selection, so on the Chat tab there was no
 * `selectedEntry`, no selection decoration, and therefore no handle slot for the
 * on-canvas typography bar to portal into.
 *
 * This closes that gap. It lives here rather than in composer-app because
 * getWidgetRoot() is here: resolving the widget root is document-aware (main
 * page, Elementor preview iframe, Gutenberg's doubly-nested canvas) and the path
 * must be measured from the SAME root the layer parser used, or the computed
 * path points at the wrong element.
 *
 * `onPath` is called with a layer path string; the caller resolves it to an
 * entry and selects it. Silent when the pick lands outside the loaded widget —
 * that case is the cross-section switch, which onSwitchWidget already handles.
 */
export function useChatPickSelection({ model, enabled, onPath }) {
  // Keep the callback in a ref so a caller that passes an inline arrow does not
  // tear down and rebind this listener on every render of the panel.
  const onPathRef = React.useRef(onPath);
  React.useEffect(() => { onPathRef.current = onPath; }, [onPath]);

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const handle = (e) => {
      const node = e && e.detail && e.detail.node;
      if (!node) return;
      let path = null;
      try {
        const widgetRoot = getWidgetRoot(model);
        // `contains` guard: a chat pick roams the WHOLE page, so the node is
        // often in a different section. computePathForNode would return null for
        // those anyway, but checking first keeps the intent obvious.
        if (!widgetRoot || !widgetRoot.contains(node)) return;
        path = computePathForNode(widgetRoot, node);
      } catch (_) { return; }
      if (!path) return;
      const fn = onPathRef.current;
      if (typeof fn === 'function') fn(path);
    };
    window.addEventListener(CHAT_PICKED_NODE_EVENT, handle);
    return () => window.removeEventListener(CHAT_PICKED_NODE_EVENT, handle);
  }, [model, enabled]);
}

/**
 * Keep the chat's persistent "targeted" outline in sync with its target chips.
 *
 * useChatPickMode above paints CHAT_SELECTED_CLASS only while the picker is
 * ACTIVE, and its teardown sweeps every instance of the class out of the preview
 * (see the comment there — a re-render race can leave strays). So once picking
 * ends the outline would disappear even though the chips, and therefore the
 * targets, are still live. This hook owns that after-picking state: it decorates
 * exactly the nodes the chips point at and clears them again when a chip goes
 * away (× or Cancel).
 *
 * `picking` is a dependency specifically so this re-runs when the picker CLOSES.
 * React runs effects in call order, and the call site invokes useChatPickMode
 * first — so on the render where picking flips false, that hook's sweep happens
 * before this one re-applies, leaving the outline intact.
 *
 * Nodes come from `pickedNodesRef` (selector → {node, index}) rather than from
 * re-querying the selector: a selector here is a readable label, not necessarily
 * a unique one, so re-querying could decorate a different element than the one
 * the user actually clicked.
 *
 * @param {string[]} pickedTargets   selectors currently shown as chips
 * @param {{current: Map}} pickedNodesRef  selector → {node, index}
 * @param {boolean} [picking]        whether the picker is currently active
 */
export function useChatTargetDecorator(pickedTargets, pickedNodesRef, picking) {
  const targets = Array.isArray(pickedTargets) ? pickedTargets : [];
  // Depend on the CONTENT, not the array identity — the call site rebuilds the
  // array on every pick, which would otherwise thrash this effect.
  const key = targets.join(' ');
  React.useEffect(() => {
    const map = pickedNodesRef && pickedNodesRef.current;
    if (!map) return undefined;
    const decorated = [];
    const styled = new Set();
    targets.forEach((sel) => {
      const hit = map.get(sel);
      const node = hit && hit.node;
      if (!node || !node.classList) return;
      // The design can re-render between pick and decorate, orphaning the node.
      if (node.isConnected === false) return;
      const doc = node.ownerDocument || document;
      if (!styled.has(doc)) { ensurePickStyles(doc); styled.add(doc); }
      node.classList.add(CHAT_SELECTED_CLASS);
      decorated.push(node);
    });
    if (!decorated.length) return undefined;
    return () => {
      decorated.forEach((node) => {
        try { node.classList.remove(CHAT_SELECTED_CLASS); } catch (_) { /* noop */ }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, picking, pickedNodesRef]);
}

/**
 * Class lists of the clicked node and its ancestors, deepest first, up to (not
 * including) the widget root. Sent along with every pick so the resolver can
 * identify the authored element by CLASS when the index path can't be trusted
 * — inside a `<uichemy-*>` tag the server freely inserts wrapper levels
 * (nav-menu wraps its repeats in a `<ul>` raw_html never had), which shifts
 * every index below it. A live path there can collide EXACTLY with a different
 * authored element's path — clicking a top-level menu item resolved to the
 * dropdown-item template — so class identity, not position, is what survives
 * the server's rewrites.
 */
function buildClassChain(widgetRoot, node) {
  const chain = [];
  let cur = node;
  while (cur && cur !== widgetRoot && cur.nodeType === 1) {
    const cls = [];
    if (cur.classList) {
      for (let i = 0; i < cur.classList.length; i++) {
        const c = cur.classList[i];
        // Skip our own canvas chrome markers — never authored classes.
        if (c && c.indexOf('uich-') !== 0 && c.indexOf('elementor') !== 0) cls.push(c);
      }
    }
    if (cls.length) chain.push(cls);
    cur = cur.parentNode;
  }
  return chain;
}

/**
 * Activate pick mode while `picking` is true. When the user clicks an
 * element inside the active widget, `onPicked(path)` is called with the
 * path string that matches the parser's scheme. Esc cancels.
 */
export function usePickMode({ picking, setPicking, model, rootRef, onPicked, onContextPick, onSwitchWidget }) {
  React.useEffect(() => {
    if (!picking || !model) return undefined;
    const widgetRoot = getWidgetRoot(model);
    if (!widgetRoot) return undefined;
    const doc = widgetRoot.ownerDocument || document;
    ensurePickStyles(doc);
    // Force the crosshair across the whole widget while picking, so it
    // never falls back to the default cursor when the pointer is idle or
    // the hovered node briefly loses its hover class.
    if (widgetRoot.classList) widgetRoot.classList.add(PICKING_CLASS);
    let lastHover = null;
    // Last pointer position (in this doc's viewport coords) so we can
    // re-resolve the hovered element after Elementor re-renders replace it.
    let lastX = null, lastY = null;

    function clearHover() {
      if (lastHover && lastHover.classList) {
        lastHover.classList.remove(HOVER_CLASS);
      }
      lastHover = null;
      clearBoxOverlay(doc);
    }

    // A hovered/clicked node counts as "pickable" if it's inside the widget
    // currently loaded, OR — when the front-end bridge lets us switch widgets
    // — inside any OTHER Composer widget on the page.
    function isPickable(target) {
      if (widgetRoot.contains(target)) return true;
      return typeof onSwitchWidget === 'function' && !!(target.closest && target.closest(COMPOSER_WIDGET_SELECTOR));
    }

    function applyHover(target) {
      if (!target || !isPickable(target) || isInsidePanel(target)) { clearHover(); return; }
      if (target === lastHover) return;
      // Swap the hover MARKER class off the old node onto the new one WITHOUT
      // clearing the overlay — clearBoxOverlay() would drop the ring's opacity to
      // 0, and drawBoxOverlay() then treats it as a first-show and snaps. Leaving
      // it visible lets the persistent ring SLIDE from the old rect to the new.
      if (lastHover && lastHover.classList) lastHover.classList.remove(HOVER_CLASS);
      if (target.classList) {
        target.classList.add(HOVER_CLASS);
        lastHover = target;
        // Framer-style box-model overlay: sliding ring + padding/gap bands, chip.
        drawBoxOverlay(doc, target);
      }
    }

    function onMove(e) {
      lastX = e.clientX; lastY = e.clientY;
      applyHover(e.target);
    }

    // Elementor actively re-renders the edited widget, replacing DOM nodes
    // (not just their class attribute). When that happens the pointer is
    // idle so no mousemove fires — re-resolve the element under the cursor
    // and re-highlight it, so the hover never drops off.
    function reinforce() {
      if (widgetRoot.classList && !widgetRoot.classList.contains(PICKING_CLASS)) {
        widgetRoot.classList.add(PICKING_CLASS);
      }
      if (lastX == null) return;
      if (lastHover && isPickable(lastHover) && lastHover.classList.contains(HOVER_CLASS)) return;
      let el = null;
      try { el = doc.elementFromPoint(lastX, lastY); } catch (_) {}
      if (el) applyHover(el);
    }

    function commit(e) {
      if (e.button !== undefined && e.button !== 0) return; // left-click only; right-click opens the menu
      const target = e.target;
      if (!target || isInsidePanel(target)) return;
      // A rich in-place edit is live: clicks inside the editable node are for
      // placing the caret, not re-picking. Let contentEditable handle them.
      if (isRichTextOpen(doc) && target.closest && target.closest('[contenteditable="true"]')) return;
      if (!widgetRoot.contains(target)) {
        // Clicked outside the widget that's currently loaded. On the front
        // end (where the picker is the only way to change what's loaded)
        // this is the user picking a DIFFERENT section — hand off to the
        // bridge instead of silently ignoring the click, otherwise the
        // picker gets stuck on whichever widget happened to load first.
        const otherWidget = typeof onSwitchWidget === 'function'
          ? target.closest && target.closest(COMPOSER_WIDGET_SELECTOR)
          : null;
        if (!otherWidget) return;
        e.preventDefault();
        e.stopPropagation();
        clearHover();
        // Stays armed across a section switch too — same reason as the in-widget
        // commit below: the button is a mode, not a one-shot action.
        // Pass the exact node the user clicked (not just the widget it lives
        // in) so the caller can select THAT element once the new widget's
        // layer tree loads, instead of defaulting to the widget's first layer.
        onSwitchWidget(otherWidget, target);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const path = computePathForNode(widgetRoot, target);
      clearHover();
      // Picking STAYS ARMED after a pick: the toolbar button is a mode switch,
      // and it stays lit until the user presses it again (or Escape). Landing a
      // pick used to disarm it, so the button un-lit itself on the first click
      // anywhere and there was no way to pick several elements in a row.
      // The one exception is a pick made to mark a loop / condition / form,
      // which is genuinely one-shot — handlePicked disarms that itself.
      if (path && typeof onPicked === 'function') onPicked(path, buildClassChain(widgetRoot, target));
    }

    // Swallow the trailing click so Elementor doesn't re-open the panel /
    // re-select the widget after we've consumed the pick on mousedown.
    function swallowClick(e) {
      if (!e || isInsidePanel(e.target)) return;
      // Don't swallow clicks that are placing the caret in a live rich edit.
      if (isRichTextOpen(doc) && e.target.closest && e.target.closest('[contenteditable="true"]')) return;
      if (widgetRoot.contains(e.target) || isPickable(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    function onKey(e) { if (e.key === 'Escape') { clearHover(); setPicking(false); } }

    // Elementor re-writes class attributes AND replaces DOM nodes on its own
    // render cycle, stripping our hover/picking highlight when the pointer is
    // idle. Watch for both and re-resolve/re-apply so it never flickers off.
    const observer = new MutationObserver(() => { reinforce(); });
    observer.observe(widgetRoot, {
      attributes: true, attributeFilter: ['class'], childList: true, subtree: true,
    });

    // Right-click a preview element → open its context menu (used in Simple
    // mode, where there is no Layers panel). Coordinates are translated from
    // the preview iframe into the parent viewport so the menu lands under the
    // cursor.
    function onContext(e) {
      const target = e.target;
      if (!target || !widgetRoot.contains(target) || isInsidePanel(target)) return;
      if (typeof onContextPick !== 'function') return;
      // Beat Elementor's own widget context menu: this runs on the iframe
      // window in the capture phase (before Elementor's document listener),
      // and stops the event dead so only our menu shows.
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      const path = computePathForNode(widgetRoot, target);
      let x = e.clientX, y = e.clientY;
      try {
        const fe = doc.defaultView && doc.defaultView.frameElement;
        if (fe) { const r = fe.getBoundingClientRect(); x += r.left; y += r.top; }
      } catch (_) { /* same-origin only */ }
      clearHover();
      if (path) onContextPick(path, x, y, buildClassChain(widgetRoot, target));
    }

    const win = doc.defaultView || window;
    doc.addEventListener('mousemove', onMove, true);
    // mousedown runs before Elementor's own selection click — using
    // capture phase so we win even if Elementor calls stopPropagation.
    doc.addEventListener('mousedown', commit, true);
    doc.addEventListener('click', swallowClick, true);
    // contextmenu on the window (capture) fires before Elementor's own
    // document-level handler, so we can suppress its menu and show ours.
    win.addEventListener('contextmenu', onContext, true);
    doc.addEventListener('keydown', onKey, true);
    if (rootRef) rootRef.current = widgetRoot;

    return () => {
      // Disconnect first so nothing re-applies while we sweep.
      observer.disconnect();
      lastHover = null;
      // Sweep the whole subtree — a race with Elementor's re-render can leave
      // a stray HOVER_CLASS on a node other than lastHover; nuke them all so
      // no highlight lingers once pick mode is off. (SELECTED_CLASS is owned
      // by useSelectionDecorator, so it is intentionally left untouched.)
      try {
        if (widgetRoot.classList) widgetRoot.classList.remove(PICKING_CLASS);
        widgetRoot.querySelectorAll('.' + HOVER_CLASS)
          .forEach((el) => el.classList.remove(HOVER_CLASS));
      } catch (_) {}
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mousedown', commit, true);
      doc.removeEventListener('click', swallowClick, true);
      win.removeEventListener('contextmenu', onContext, true);
      doc.removeEventListener('keydown', onKey, true);
      if (rootRef) rootRef.current = null;
    };
  }, [picking, model, setPicking, onPicked, onContextPick, onSwitchWidget, rootRef]);
}

/**
 * Draws a persistent solid outline around the WHOLE active widget for as long
 * as a widget is loaded. Independent of the panel being open/collapsed, the
 * active tab, or whether a specific element is selected — so on the live front
 * end (where the panel collapses to a thin strip) the user always sees which
 * widget is being edited. Mirrors the Elementor editor's own selection box.
 */
export function useActiveWidgetOutline({ model }) {
  React.useEffect(() => {
    if (!model) return undefined;
    const widgetRoot = getWidgetRoot(model);
    if (!widgetRoot || !widgetRoot.classList) return undefined;
    const doc = widgetRoot.ownerDocument || document;
    ensurePickStyles(doc);
    widgetRoot.classList.add(WIDGET_SELECTED_CLASS);

    // Elementor's render cycle (and the front-end live-apply that rewrites the
    // widget's inner HTML) re-writes class attributes and can strip our class.
    // Re-apply it so the box never flickers off — same guard the other pick
    // hooks carry. The widget-container node itself survives an innerHTML swap,
    // so watching its own class attribute is enough.
    const observer = new MutationObserver(() => {
      if (!widgetRoot.classList.contains(WIDGET_SELECTED_CLASS)) {
        widgetRoot.classList.add(WIDGET_SELECTED_CLASS);
      }
    });
    try { observer.observe(widgetRoot, { attributes: true, attributeFilter: ['class'] }); } catch (_) {}

    return () => {
      observer.disconnect();
      try { widgetRoot.classList.remove(WIDGET_SELECTED_CLASS); } catch (_) {}
    };
  }, [model]);
}

/**
 * Decorates the rendered widget node matching `selectedPath` with a
 * persistent "selected" outline while a layer is selected.
 */
/**
 * Write an inline `style` string straight onto the LIVE node at `path`.
 *
 * Surgical on purpose: the Local scope's only product is one element's `style`
 * attribute, so there is no reason to replace markup to preview it — and every
 * reason not to. A container repaint is impossible for dynamic content (Twig
 * resolves server-side), which is why style edits on such a widget stopped
 * showing until reload. Setting the attribute in place restores the instant
 * feedback and leaves the server-rendered children exactly where they are.
 *
 * Idempotent, so it is safe to call more than once for the same edit.
 *
 * @returns {boolean} true when the node was found and updated.
 */
// <uichemy-nav-menu>/<uichemy-toc>'s PHP renderer inserts its OWN wrapper
// levels around repeated items (e.g. every rendered <li> lands inside a <ul>
// the renderer adds — raw_html's authored template has no such <ul>, the
// <li> sits directly under <uichemy-nav-menu>). Below wherever the server is
// free to reshape the tree like that, a layer path's child INDICES no longer
// line up with the live DOM, so walking them can land one level short (or a
// tag off) of the real node — e.g. on the injected <ul> instead of the <li>
// template it wraps. A loop/condition template's classes are stable (the
// same class covers every rendered instance, that's what makes it a shared
// style), so when the walked node doesn't carry them, search the subtree by
// class instead of trusting the index further.
function resolveByClassFallback(root, node, classes) {
  if (!classes || !classes.length) return node;
  if (node && node.classList && classes.every((c) => node.classList.contains(c))) return node;
  const sel = classes.map((c) => {
    try { return '.' + CSS.escape(c); } catch (_) { return null; }
  });
  if (sel.some((s) => !s)) return node;
  try {
    const hit = root.querySelector(sel.join(''));
    if (hit) return hit;
  } catch (_) { /* noop */ }
  return node;
}

export function applyInlineStyleLive(model, path, styleText, classes) {
  if (!model || !path) return false;
  const root = getWidgetRoot(model);
  if (!root) return false;
  let n = root;
  const parts = String(path).split('.').slice(1).map(Number);
  for (const i of parts) {
    const kids = pathRelevantChildren(n);
    if (!(i >= 0) || i >= kids.length) { n = null; break; }
    n = kids[i];
  }
  n = resolveByClassFallback(root, n, classes);
  if (!n || n.nodeType !== 1 || n === root) return false;
  if (styleText) n.setAttribute('style', styleText);
  else n.removeAttribute('style');
  return true;
}

/**
 * Walk a layer path (`0.2.1`) down from the widget root to the rendered node.
 *
 * If the path can't be walked all the way down (e.g. the live DOM and the
 * stored raw_html drifted slightly — dynamic content, slot text, etc.), stop at
 * the deepest ancestor that DID resolve rather than returning nothing: for the
 * selection decorator a slightly-off box beats an invisible one.
 *
 * `classes`, when given, is the target entry's own class list — used to
 * correct for server-inserted wrapper levels the path can't predict (see
 * resolveByClassFallback above).
 */
function resolveNodeByLayerPath(widgetRoot, path, classes) {
  if (!widgetRoot || !path) return null;
  let n = widgetRoot;
  const parts = String(path).split('.').slice(1).map(Number);
  for (const i of parts) {
    const kids = pathRelevantChildren(n);
    if (i >= kids.length) break;
    n = kids[i];
  }
  n = resolveByClassFallback(widgetRoot, n, classes);
  return (n && n.classList) ? n : null;
}

/**
 * Edit the selected element's text where it sits, instead of walking over to
 * the sidebar's Content → TEXT field.
 *
 * Selecting an eligible element opens the editor and puts the caret in it, so
 * you can just start typing. Double-click re-opens it after a commit closed it.
 * Both act on the SELECTION rather than on whatever is under the pointer:
 * picking owns single clicks on the canvas, and this must not fight it for the
 * same event.
 *
 * `onCommit` must be the Inspector's setElement({ ...element, text }); the
 * editor deliberately has no write path of its own (see composer-canvas-text).
 */
export function useInlineTextEdit({ model, selectedPath, selectedClasses, text, enabled, onCommit, onCommitHtml }) {

  // Both kept in refs: a new callback identity, or the user typing, must not
  // tear the listener down and reattach it mid-edit.
  const commitRef = React.useRef(onCommit);
  commitRef.current = onCommit;
  const commitHtmlRef = React.useRef(onCommitHtml);
  commitHtmlRef.current = onCommitHtml;
  const textRef = React.useRef(text);
  textRef.current = text;

  React.useEffect(() => {
    if (!enabled || !model || !selectedPath) {
      itLog('inactive', { enabled, hasModel: !!model, selectedPath });
      return undefined;
    }
    const widgetRoot = getWidgetRoot(model);
    if (!widgetRoot) { itLog('inactive: widget root not found in any document'); return undefined; }
    const doc = widgetRoot.ownerDocument || document;
    const win = doc.defaultView || window;

    // Leaf → floated overlay box (text run). Rich (inline children like
    // <em>/<br>) → edit the node in place so interleaved text keeps its spot.
    const openFor = (node) => {
      const mode = inlineTextEditMode(node, textRef.current);
      // Cross-mode handoff: each opener only auto-closes its OWN kind, so close
      // the other kind here (commit it) before switching editors.
      if (mode === 'rich' && isInlineTextOpen(doc)) closeInlineText(doc, true);
      if (mode !== 'rich' && isRichTextOpen(doc)) closeRichText(doc, true);
      if (mode === 'rich') {
        return openRichText(doc, node, {
          onCommitHtml: (html) => {
            const fn = commitHtmlRef.current;
            if (typeof fn === 'function') fn(html);
          },
        });
      }
      return openInlineText(doc, node, {
        value: textRef.current || '',
        onCommit: (next) => {
          const fn = commitRef.current;
          if (typeof fn === 'function') fn(next);
        },
      });
    };

    // Selecting a text element arms it for typing immediately — the caret lands
    // in the text and blinks, so editing is ONE gesture rather than
    // select-then-double-click.
    //
    // The node is resolved on a frame delay and retried: a selection very often
    // arrives while the canvas is still re-rendering (Elementor replaces the
    // widget's DOM after a write), and resolving in the same tick would find
    // nothing and silently give up.
    let raf = 0;
    let tries = 0;
    const openWhenReady = () => {
      raf = 0;
      const node = resolveNodeByLayerPath(widgetRoot, selectedPath, selectedClasses);
      if (!node) {
        if (tries++ < 5 && win.requestAnimationFrame) { raf = win.requestAnimationFrame(openWhenReady); return; }
        itLog('selection: no DOM node for this path nothing to edit', { path: selectedPath });
        return;
      }
      const why = inlineTextBlockReason(node, textRef.current);
      if (why) {
        itLog('selection: NOT editable ' + why, {
          path: selectedPath, tag: node.tagName.toLowerCase(), text: textRef.current,
        });
        return;
      }
      openFor(node);
    };
    if (win.requestAnimationFrame) raf = win.requestAnimationFrame(openWhenReady);
    else openWhenReady();

    // Kept as the way back in after a commit closed the editor, and after any
    // click that moved focus out of it without changing the selection.
    const onDblClick = (e) => {
      const node = resolveNodeByLayerPath(widgetRoot, selectedPath, selectedClasses);
      if (!node) return;
      const t = e.target;
      if (t !== node && !node.contains(t)) return;
      const why = inlineTextBlockReason(node, textRef.current);
      if (why) { itLog('double-click: NOT editable ' + why, { tag: node.tagName.toLowerCase() }); return; }
      // Stop the page's own dblclick handling (and the browser's word-select)
      // from running underneath the editor we are about to open.
      e.preventDefault();
      e.stopPropagation();
      openFor(node);
    };

    // The node the box is anchored to gets replaced out from under it: the
    // front-end editor reloads the whole widget on selection, and any write
    // re-renders it. Without this the editor keeps the caret but is left
    // covering a stale position, with the fresh node's own text showing through
    // — exactly what "select karta hoon par edit nahi hota" looks like.
    // useSelectionDecorator carries the same guard for the outline.
    const obs = new MutationObserver(() => {
      if (!isInlineTextOpen(doc) || !isInlineTextAnchorStale(doc)) return;
      const fresh = resolveNodeByLayerPath(widgetRoot, selectedPath, selectedClasses);
      if (fresh) reanchorInlineText(doc, fresh);
    });
    try { obs.observe(widgetRoot, { childList: true, subtree: true }); } catch (_) { /* noop */ }

    const reposition = () => repositionInlineText(doc);
    widgetRoot.addEventListener('dblclick', onDblClick, true);
    win.addEventListener('scroll', reposition, true);
    win.addEventListener('resize', reposition);

    return () => {
      if (raf && win.cancelAnimationFrame) { try { win.cancelAnimationFrame(raf); } catch (_) { /* noop */ } }
      try { obs.disconnect(); } catch (_) { /* noop */ }
      widgetRoot.removeEventListener('dblclick', onDblClick, true);
      win.removeEventListener('scroll', reposition, true);
      win.removeEventListener('resize', reposition);
      // Selection changed / editing turned off: drop the box without writing.
      // A commit here would fire against the element we just left. (Rich edits
      // already committed on blur, so this is cleanup — never a discard of a
      // pending change.)
      try { closeInlineText(doc, false); } catch (_) { /* teardown is best-effort */ }
      try { closeRichText(doc, false); } catch (_) { /* teardown is best-effort */ }
    };
  }, [model, selectedPath, enabled]);
}

export function useSelectionDecorator({ model, selectedPath, selectedClasses, toolbar, movable, onMoveElement }) {
  // Kept in a ref so a new callback identity can't tear the whole decorator
  // down and rebuild it — that would drop the outline and the handle bar on
  // every parent render.
  const moveRef = React.useRef(onMoveElement);
  moveRef.current = onMoveElement;
  // Gutenberg re-navigates its preview iframe (srcDoc reassign) on every edit,
  // replacing the inner document — which orphans the handles + observers this
  // effect binds to the OLD document, so the toolbar vanished until a manual
  // re-pick. Bumping this on the iframe's `load` re-runs the effect against the
  // fresh document (the same path a re-pick takes).
  const [previewEpoch, setPreviewEpoch] = React.useState(0);
  React.useEffect(() => {
    if (!model || !selectedPath) return undefined;
    const widgetRoot = getWidgetRoot(model);
    if (!widgetRoot) return undefined;
    const doc = widgetRoot.ownerDocument || document;
    ensurePickStyles(doc);

    // Resolve the selected element fresh each time — a re-render replaces the
    // DOM node, so a cached reference goes stale and must be recomputed by path.
    const resolveNode = () => resolveNodeByLayerPath(widgetRoot, selectedPath, selectedClasses);

    let node = resolveNode();
    if (!node) return undefined;
    node.classList.add(SELECTED_CLASS);

    // Framer-style box-model overlay on the selected element — keep it aligned
    // as the canvas scrolls or resizes.
    const win = doc.defaultView || window;

    // Gutenberg only: the preview lives in a srcdoc iframe that fully reloads on
    // each edit (srcDoc is reassigned), replacing `doc`. The iframe ELEMENT
    // persists and fires 'load' on every reload, so re-run this effect there to
    // rebind + redraw against the new document instead of leaving stale handles.
    let previewIframe = null;
    const onPreviewReload = () => setPreviewEpoch((e) => e + 1);
    if (model.__uichGutenberg) {
      try {
        const fe = win && win.frameElement;
        if (fe && fe.tagName === 'IFRAME') {
          previewIframe = fe;
          fe.addEventListener('load', onPreviewReload);
        }
      } catch (_) { /* cross-origin / detached */ }
    }
    // Decoration is best-effort, and it is CONTAINED. redraw() runs synchronously
    // inside this effect, so anything it throws propagates out of the effect and
    // React unwinds to the nearest boundary — which is <ComposerErrorBoundary
    // label="Inspector">. That is how a single ReferenceError in the canvas
    // toolbar replaced every option in the side panel with an error card. A
    // broken decoration must cost the decoration, never the panel.
    const guard = (label, fn) => {
      try { fn(); } catch (err) {
        window.console && console.warn('[UiChemy] selection decoration failed (' + label + ')', err);
      }
    };
    const redraw = () => {
      if (!node) return;
      guard('box overlay', () => drawBoxOverlay(doc, node));
      if (!toolbar) { guard('handles off', () => clearBoxHandles(doc)); return; }
      guard('handles', () => drawBoxHandles(doc, node, {
        canMove: movable,
        // The handle layer speaks DOM; the write path speaks layer paths. Do the
        // translation here, where the widget root that both are measured from is
        // already in hand.
        onMove: (dragEl, dropEl, placement) => {
          const fn = moveRef.current;
          if (typeof fn !== 'function') return;
          const dragPath = computePathForNode(widgetRoot, dragEl);
          const dropPath = computePathForNode(widgetRoot, dropEl);
          if (dragPath && dropPath) fn(dragPath, dropPath, placement);
        },
      }));
    };
    // Coalesce bursts of resize/mutation callbacks into one draw per frame so a
    // drag-resize doesn't thrash layout (drawBoxOverlay reads getBoundingClientRect).
    let rafId = 0;
    const raf = win.requestAnimationFrame || window.requestAnimationFrame;
    const caf = win.cancelAnimationFrame || window.cancelAnimationFrame;
    const scheduleRedraw = () => {
      if (rafId || !raf) { if (!raf) redraw(); return; }
      rafId = raf(() => { rafId = 0; redraw(); });
    };
    redraw();

    // The overlay is positioned from getBoundingClientRect, so it only stays
    // aligned if we redraw whenever the element's BOX changes. Resizing the
    // element (Elementor's resize handles, or the width/height controls) changes
    // its size via inline style — which fires neither window 'resize' nor the
    // class/childList MutationObserver below — so without a ResizeObserver the
    // box overlay stays pinned to the element's old dimensions. Observe the node
    // (catches its own resize) and the widget root (catches reflow that shifts
    // the node's position even when its own size is unchanged).
    const RO = win.ResizeObserver || window.ResizeObserver;
    let ro = null;
    if (RO) {
      ro = new RO(() => scheduleRedraw());
      try { ro.observe(node); } catch (_) {}
      try { if (widgetRoot !== node) ro.observe(widgetRoot); } catch (_) {}
    }

    // Elementor re-writes class attributes AND replaces DOM nodes on its own
    // render cycle — and on the front end applyLive() swaps the widget's entire
    // innerHTML — either of which strips SELECTED_CLASS off the selected node.
    // usePickMode/useChatPickMode already guard against this; the persistent
    // selection outline needs the same guard or it silently drops off (e.g.
    // after a live edit or panel collapse) and never comes back. Re-resolve the
    // node by path and re-apply so the outline sticks.
    const observer = new MutationObserver(() => {
      if (node && widgetRoot.contains(node) && node.classList.contains(SELECTED_CLASS)) return;
      const fresh = resolveNode();
      if (fresh) {
        // Re-point the ResizeObserver at the replacement node so resize tracking
        // survives Elementor swapping the DOM node out from under us.
        if (ro && fresh !== node) {
          try { ro.unobserve(node); } catch (_) {}
          try { ro.observe(fresh); } catch (_) {}
        }
        node = fresh;
        if (!node.classList.contains(SELECTED_CLASS)) node.classList.add(SELECTED_CLASS);
        redraw();
      }
    });
    try {
      observer.observe(widgetRoot, {
        attributes: true, attributeFilter: ['class'], childList: true, subtree: true,
      });
    } catch (_) {}

    win.addEventListener('scroll', redraw, true);
    win.addEventListener('resize', redraw);

    return () => {
      observer.disconnect();
      if (ro) { try { ro.disconnect(); } catch (_) {} }
      if (rafId && caf) { try { caf(rafId); } catch (_) {} }
      try { if (node) node.classList.remove(SELECTED_CLASS); } catch (_) {}
      // Sweep any stray SELECTED_CLASS a re-render race may have left on a node
      // other than the one we last tracked.
      try {
        widgetRoot.querySelectorAll('.' + SELECTED_CLASS)
          .forEach((el) => el.classList.remove(SELECTED_CLASS));
      } catch (_) {}
      win.removeEventListener('scroll', redraw, true);
      win.removeEventListener('resize', redraw);
      if (previewIframe) { try { previewIframe.removeEventListener('load', onPreviewReload); } catch (_) {} }
      try { clearBoxOverlay(doc); } catch (_) { /* teardown is best-effort */ }
      try { clearBoxHandles(doc); } catch (_) { /* teardown is best-effort */ }
    };
  }, [model, selectedPath, toolbar, movable, previewEpoch]);
}
