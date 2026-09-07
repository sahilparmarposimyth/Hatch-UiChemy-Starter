// Inline text editing on the canvas.
//
// Double-clicking the selected element opens a small editable box floated over
// its CONTENT box and styled with the element's own computed typography, so the
// text reads as if it were being edited in place. The real node is NEVER made
// contentEditable: the canvas DOM belongs to the builder and is replaced
// wholesale on every raw_html write (rerenderWidgetContainer / applyLive), so
// anything typed straight into it would be silently thrown away — and until
// that happened the live DOM would disagree with raw_html, which is the tree
// every layer path is resolved against.
//
// The value goes back out through the caller's onCommit, which is wired to the
// Inspector's setElement({ ...element, text }) — the SAME write the sidebar's
// Content → TEXT field performs. There is deliberately no second write path.
//
// Sibling module to composer-box-handles.js and built the same way: plain DOM
// inside the preview document (where the composer's theme tokens don't exist),
// one host created lazily and only ever repositioned.

import { clipHostToPanel } from './composer-box-overlay';
import { isDynamicPlaceholderText } from './composer-layer-tree';

const HOST_ID = 'uich-inline-text';
const STYLE_ID = 'uich-inline-text-style';
// Stamped on the element being edited so its own text stops painting through
// our overlay. Visual only, removed the moment the editor closes.
const HIDE_CLASS = 'uich-inline-text-src';
// Above the handle bar (2147482100) so the caret is never buried under it.
const BASE_Z = 2147482200;
// UiChemy brand purple — the accent composer-pick.jsx already draws selection
// with, inlined for the same reason it is there: this markup renders inside the
// previewed page, which has none of the composer's CSS variables.
// Same pink as SELECT_INK in composer-box-overlay.js — one selection colour
// across selection, hover and text editing. Was '#000', which put a hard black
// rectangle around the text you were typing into.
const ACCENT = '#EC0868';

// Elements with no text of their own to type into. Everything else is gated on
// being a childless leaf (see isInlineTextEditable), which already rules out
// most containers.
const SKIP_TAGS = new Set([
  'img', 'input', 'br', 'hr', 'svg', 'canvas', 'video', 'audio',
  'iframe', 'textarea', 'select', 'object', 'embed', 'picture', 'source',
]);

// Phrasing / inline children a text element may hold and STILL be edited as one
// rich-text run (e.g. an <h1> with <em>, <strong>, <a>, <br>). A child OUTSIDE
// this set (div, section, ul, figure…) means the node is a layout container, not
// a text run — those stay non-editable.
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em',
  'i', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'del', 'ins',
  // Inline DECORATIONS that ride alongside a text run — the icon in a
  // "Get Started →" button/link. They carry no editable text of their own, but
  // their presence must NOT block editing the text they sit next to. Their own
  // internals (an <svg>'s <path>) are not direct children, so only the wrapper
  // tag is what this set is checked against.
  'svg', 'img', 'picture',
]);

// Editor-only classes/attrs that must never be serialized back into raw_html.
const EDITOR_JUNK_CLASS = /^uich-(composer|inline-text)/;

// Typography that has to be mirrored onto the editable box for the text to land
// in the same place, at the same size, as the text it is covering.
const COPY_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform',
  'textIndent', 'textDecoration', 'color', 'whiteSpace', 'direction',
];

function px(n) { return `${Math.round(n * 100) / 100}px`; }

/**
 * Paint the committed text straight onto the live leaf node for DISPLAY only.
 * Mirrors the model-side replaceDirectTextOf, and is only ever called on nodes
 * inlineTextBlockReason() already vetted as childless pure-text leaves — so
 * setting textContent cannot clobber child elements.
 *
 * Why it exists: the editor masks the source node with color:transparent while
 * the floating box carries the text, and the node's OWN text is never rewritten.
 * On close the mask is removed; the new text only survives on-canvas if a
 * raw_html repaint (applyLive / rerenderWidgetContainer) runs — but those BAIL
 * on any widget whose raw_html contains a dynamic token ({{ }}, {% %}, or
 * <uichemy-*>) anywhere, so on such widgets unmasking revealed the OLD text and
 * the edit appeared to vanish on blur. Writing the leaf here makes the canvas
 * correct immediately, independent of the repaint path.
 */
function setLeafTextForDisplay(node, value) {
  if (!node || node.nodeType !== 1) return;
  node.textContent = value == null ? '' : String(value);
}

/**
 * Trace every decision this editor makes to the console.
 *
 * On by default while inline editing is being shaken out: when it declines to
 * open, or opens and immediately closes again, the reason is the ONLY thing
 * that distinguishes half a dozen indistinguishable-looking causes. Silence it
 * Enable it with `window.UICH_DEBUG_INLINE_TEXT = true`.
 */
export function itLog(what, detail) {
  try {
    // Opt-IN, for the same reason as the text-toolbar logger: this runs on paths
    // that repeat per render / per selection, so an opt-out default spammed the
    // editor console in normal use.
    if (typeof window === 'undefined' || window.UICH_DEBUG_INLINE_TEXT !== true) return;
    // eslint-disable-next-line no-console
    console.log('[UiChemy inline-text] ' + what, detail === undefined ? '' : detail);
  } catch (_) { /* console is best-effort */ }
}

/**
 * Why can't this element's text be edited on the canvas? null = it can.
 *
 * @param {Element} node  the rendered node in the preview document
 * @param {string}  text  the element's direct text (what setElement writes)
 * @returns {string|null} a human-readable reason, or null when editable
 */
export function inlineTextBlockReason(node, text) {
  if (!node || node.nodeType !== 1 || !node.tagName) return 'not an element node';
  const tag = node.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return `<${tag}> has no text of its own`;
  // A node with child ELEMENTS can still be edited AS A WHOLE (rich mode, in
  // place — see openRichText) as long as every child is inline/phrasing (em,
  // strong, a, br…). Only a BLOCK child (div, section, ul…) means this is a
  // layout container, not a text run, and stays non-editable — the overlay's
  // single-run model can't represent it and editing it as rich text would let
  // the user restructure layout by accident.
  if (node.children && node.children.length) {
    const blockKids = Array.prototype.slice.call(node.children)
      .filter((k) => !INLINE_TAGS.has(k.tagName.toLowerCase()))
      .map((k) => k.tagName.toLowerCase());
    if (blockKids.length) {
      return `<${tag}> contains block elements (${blockKids.join(', ')}) not editable as text`;
    }
    // else: rich-text container → editable (handled by rich mode).
  }
  const s = String(text == null ? '' : text).trim();
  // A dynamic binding is not literal text — the sidebar shows a chip there, so
  // there is nothing to type over. Same for loop / condition control markup.
  if (/^\{\{[\s\S]*\}\}$/.test(s)) return 'text is a dynamic binding';
  if (s.indexOf('{%') !== -1) return 'text is loop / condition markup';
  // <uichemy-nav-menu>/<uichemy-toc>'s own single-curly-brace placeholder
  // (`{nav_item}`, `{sub_item}`) — PHP substitutes the real rendered item
  // in here; typing over it on canvas would overwrite that token in
  // raw_html and break the substitution for every rendered instance.
  if (isDynamicPlaceholderText(s)) return 'text is a dynamic menu placeholder';
  return null;
}

/** Can this element's text be edited on the canvas? */
export function isInlineTextEditable(node, text) {
  return inlineTextBlockReason(node, text) === null;
}

/**
 * Which editor to use for this node:
 *   'leaf' — childless pure-text → the floated overlay box (openInlineText).
 *   'rich' — has only inline children → edit the node in place (openRichText),
 *            so interleaved text around <em>/<br> keeps its position.
 *   ''     — not editable (blockReason has the why).
 */
export function inlineTextEditMode(node, text) {
  if (inlineTextBlockReason(node, text)) return '';
  return (node.children && node.children.length) ? 'rich' : 'leaf';
}

// ── Rich in-place editor (nodes with inline children) ───────────────────────
// Unlike the overlay, this makes the REAL node contentEditable. That is the only
// way to keep text interleaved with <em>/<br> in the right places while the user
// types. On commit the node's cleaned innerHTML is written back through the
// caller (→ setElement({ innerHtml })), which stays the single raw_html source
// of truth — same contract as the overlay's onCommit(text).
const RICH_STYLE_ID = 'uich-rich-text-style';
let richState = null; // { doc, node, original, onCommitHtml, onKey, onBlur }

function ensureRichStyles(doc) {
  if (doc.getElementById(RICH_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = RICH_STYLE_ID;
  // Same pink ring as the rest of the selection chrome, drawn WITHOUT changing
  // layout (outline, not border) so the text never shifts while editing.
  style.textContent =
    '.uich-rich-editing{outline:1px solid ' + ACCENT + ' !important;outline-offset:3px !important;'
    + 'box-shadow:0 0 0 3px rgba(255,255,255,0.92) !important;border-radius:2px;cursor:text !important;}';
  (doc.head || doc.documentElement).appendChild(style);
}

// Serialize the node's children WITHOUT any editor-only class/attr leaking into
// raw_html (selection/hover/picking markers, contenteditable).
function cleanInnerHtml(node) {
  const clone = node.cloneNode(true);
  const scrub = (el) => {
    if (el.nodeType !== 1) return;
    el.removeAttribute('contenteditable');
    if (el.getAttribute && el.getAttribute('class')) {
      const kept = el.getAttribute('class').split(/\s+/).filter((c) => c && !EDITOR_JUNK_CLASS.test(c));
      if (kept.length) el.setAttribute('class', kept.join(' '));
      else el.removeAttribute('class');
    }
    Array.prototype.forEach.call(el.childNodes, scrub);
  };
  Array.prototype.forEach.call(clone.childNodes, scrub);
  return clone.innerHTML;
}

export function isRichTextOpen(doc) {
  return !!(richState && richState.node && richState.node.ownerDocument === doc);
}

export function isRichTextAnchorStale() {
  return !!(richState && richState.node && richState.node.isConnected === false);
}

export function openRichText(doc, node, opts) {
  if (!doc || !node) return false;
  if (richState && richState.node === node) return true;
  if (richState) closeRichText(richState.doc, true); // commit whatever was open

  ensureRichStyles(doc);
  const original = node.innerHTML;
  node.setAttribute('contenteditable', 'true');
  node.classList.add('uich-rich-editing');
  // spellcheck off + plaintext-ish: we still allow the existing inline tags, but
  // don't want the browser sprinkling <div>/<font> on Enter/format shortcuts.
  try { node.setAttribute('spellcheck', 'false'); } catch (_) { /* noop */ }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); node.blur(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeRichText(doc, false); }
  };
  const onBlur = () => closeRichText(doc, true);
  const onPaste = (e) => {
    // Paste as PLAIN text so foreign markup never enters the node.
    e.preventDefault(); e.stopPropagation();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    try { doc.execCommand('insertText', false, t); } catch (_) { /* best-effort */ }
  };
  node.addEventListener('keydown', onKey, true);
  node.addEventListener('blur', onBlur, true);
  node.addEventListener('paste', onPaste, true);

  richState = { doc, node, original, onCommitHtml: (opts && opts.onCommitHtml) || null, onKey, onBlur, onPaste };

  try {
    node.focus({ preventScroll: true });
    // Caret at the end so typing appends rather than replacing a selection.
    const win = doc.defaultView || window;
    const sel = win.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) { /* focus/selection best-effort */ }

  itLog('rich open', { tag: node.tagName.toLowerCase(), anchorInDocument: node.isConnected !== false });
  return true;
}

export function closeRichText(doc, commit) {
  const st = richState;
  if (!st || !st.node) return;
  richState = null; // clear FIRST — the write re-renders and could re-enter

  const node = st.node;
  try { node.removeEventListener('keydown', st.onKey, true); } catch (_) { /* noop */ }
  try { node.removeEventListener('blur', st.onBlur, true); } catch (_) { /* noop */ }
  try { node.removeEventListener('paste', st.onPaste, true); } catch (_) { /* noop */ }

  let nextHtml = '';
  try { nextHtml = cleanInnerHtml(node); } catch (_) { nextHtml = node.innerHTML; }
  const changed = nextHtml !== st.original;

  // Restore the node to a non-editing state. On cancel, put the original markup
  // back so a half-typed edit doesn't linger on the canvas.
  try { node.removeAttribute('contenteditable'); } catch (_) { /* noop */ }
  try { node.removeAttribute('spellcheck'); } catch (_) { /* noop */ }
  try { node.classList.remove('uich-rich-editing'); } catch (_) { /* noop */ }
  if (!commit && changed) { try { node.innerHTML = st.original; } catch (_) { /* noop */ } }

  itLog('rich close', { commit: !!commit, changed });
  if (commit && changed && typeof st.onCommitHtml === 'function') st.onCommitHtml(nextHtml);
}

// NEVER put a backtick in the stylesheet below — it is a template literal, and
// one stray backtick ends the string early and the rest is parsed as
// JavaScript (see the same warning in composer-box-handles.js).
function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* The source element keeps its layout (so the box it reserves does not
       jump) but stops painting its text while the overlay carries it. */
    .${HIDE_CLASS} {
      color: transparent !important;
      caret-color: transparent !important;
      text-shadow: none !important;
    }
    #${HOST_ID} .uich-it-box {
      position: absolute !important;
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      pointer-events: auto !important;
      overflow-wrap: break-word !important;
      outline: 1px solid ${ACCENT} !important;
      outline-offset: 3px !important;
      /* This overlay sits on the user's own page, which can be any colour. The
         white halo fills the 3px offset gap and paints under the outline, so the
         ring stays legible on a dark section as well as a light one. Sized to
         the 1px stroke — a wider halo reads as thickness the ring doesn't have. */
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.92) !important;
      border-radius: 2px !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

function ensureHost(doc) {
  let host = doc.getElementById(HOST_ID);
  if (host && host.__uichIT) { ensureStyles(doc); return host; }
  ensureStyles(doc);

  host = doc.createElement('div');
  host.id = HOST_ID;
  // Pointer-transparent host; only the box itself opts back in. A full-viewport
  // interactive layer would swallow the first click on the page every time.
  host.style.cssText =
    'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;'
    + `z-index:${BASE_Z};display:none;`;

  const box = doc.createElement('div');
  box.className = 'uich-it-box';
  box.setAttribute('contenteditable', 'true');
  box.setAttribute('role', 'textbox');
  box.setAttribute('aria-multiline', 'true');
  box.setAttribute('aria-label', 'Edit element text');
  box.spellcheck = false;
  host.appendChild(box);

  (doc.body || doc.documentElement).appendChild(host);
  host.__uichIT = { box, el: null, onCommit: null, original: '', bound: false };
  return host;
}

/**
 * Read the typed value back as plain text.
 *
 * contentEditable pads with non-breaking spaces and keeps a trailing <br> as a
 * filler line, neither of which the author typed — undo both so an untouched
 * edit commits byte-identical to what came in and fires no raw_html rewrite.
 */
function readValue(box) {
  return String(box.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n$/, '');
}

/**
 * Mirror the source element's typography onto the box.
 *
 * MUST run BEFORE the hide class goes on. That class sets
 * `color: transparent !important`, so reading the computed style afterwards
 * copies TRANSPARENT onto the box and every character typed is painted
 * invisible — the editor looks dead when it is in fact working. For the same
 * reason this is deliberately not part of positionBox(), which re-runs on every
 * scroll and resize while the class IS applied.
 */
function copyTypography(doc, host, el) {
  const st = host.__uichIT;
  const win = doc.defaultView || window;
  const cs = win.getComputedStyle(el);
  for (const p of COPY_PROPS) {
    try { st.box.style[p] = cs[p]; } catch (_) { /* unsupported in this engine */ }
  }
  // `caret-color: auto` resolves against the box's own colour; pin it to the
  // text colour so the caret is never left to a browser fallback.
  try { st.box.style.caretColor = cs.color; } catch (_) { /* older engines */ }
}

function positionBox(doc, host, el) {
  const st = host.__uichIT;
  const win = doc.defaultView || window;
  const r = el.getBoundingClientRect();
  const cs = win.getComputedStyle(el);
  const f = (v) => parseFloat(v) || 0;

  const bl = f(cs.borderLeftWidth), bt = f(cs.borderTopWidth);
  const br = f(cs.borderRightWidth), bb = f(cs.borderBottomWidth);
  const pl = f(cs.paddingLeft), pt = f(cs.paddingTop);
  const pr = f(cs.paddingRight), pb = f(cs.paddingBottom);

  // clipHostToPanel can shift the host's own left edge (panel docked LEFT). The
  // box is absolutely positioned INSIDE the host, so viewport coordinates have
  // to be rebased by that shift — same correction positionBar() makes.
  const hostLeft = parseFloat(host.style.left) || 0;

  st.box.style.left = px(r.left + bl + pl - hostLeft);
  st.box.style.top = px(r.top + bt + pt);
  st.box.style.width = px(Math.max(8, r.width - bl - br - pl - pr));
  st.box.style.minHeight = px(Math.max(8, r.height - bt - bb - pt - pb));
}

function bind(doc, host) {
  const st = host.__uichIT;
  if (st.bound) return;
  st.bound = true;
  const box = st.box;

  // Every one of these is stopped from bubbling: the box lives in the previewed
  // page, whose own scripts — and Elementor's editor shortcuts — listen at the
  // document and would treat typing as page interaction.
  const swallow = (e) => e.stopPropagation();
  box.addEventListener('keypress', swallow);
  box.addEventListener('keyup', swallow);
  box.addEventListener('mousedown', swallow);
  box.addEventListener('mouseup', swallow);
  box.addEventListener('click', swallow);
  box.addEventListener('dblclick', swallow);

  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeInlineText(doc, false); }
    // Enter commits; Shift+Enter keeps the newline, matching the sidebar's
    // multi-line textarea.
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeInlineText(doc, true); }
  });

  box.addEventListener('input', () => {
    // Logged once per open: proves keystrokes are actually landing in the box,
    // which separates "the editor is inert" from "the editor works but the
    // commit never happens".
    if (!st.touched) itLog('typing reached the box', { value: readValue(box) });
    st.touched = true;
  });

  // Clicking anywhere else — canvas, panel, another element — commits.
  box.addEventListener('blur', () => {
    // Which element took the focus is the whole story when the editor closes
    // on its own a moment after opening (Elementor focusing its panel, the
    // preview reloading, a stray focus() elsewhere).
    let to = 'unknown';
    try {
      const a = doc.activeElement;
      to = a ? (a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.className ? '.' + String(a.className).split(' ')[0] : '')) : 'none';
    } catch (_) { /* noop */ }
    itLog('blur closing', { focusWentTo: to, everTyped: !!st.touched });
    closeInlineText(doc, true);
  });

  box.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    try { doc.execCommand('insertText', false, t); }
    catch (_) { box.textContent += t; }
  });
}

/** Is the inline editor currently open in this document? */
export function isInlineTextOpen(doc) {
  const host = doc && doc.getElementById && doc.getElementById(HOST_ID);
  return !!(host && host.__uichIT && host.__uichIT.el);
}

/**
 * Has the element the open editor is anchored to been taken out of the page?
 *
 * The canvas re-renders under us constantly — the front-end editor reloads the
 * widget's HTML when a widget is selected, and Elementor replaces the node on
 * its own render cycle — which leaves the box floating over a NEW node that
 * never received the hide class, so the untouched original text shows through
 * and the box drifts on the next scroll.
 */
export function isInlineTextAnchorStale(doc) {
  const host = doc && doc.getElementById && doc.getElementById(HOST_ID);
  const st = host && host.__uichIT;
  if (!st || !st.el) return false;
  return st.el.isConnected === false;
}

/**
 * Move the open editor onto `el` — the replacement for a node that was
 * re-rendered away. The typed value and the caret are left alone; only the
 * anchor changes.
 */
export function reanchorInlineText(doc, el) {
  const host = doc && doc.getElementById && doc.getElementById(HOST_ID);
  const st = host && host.__uichIT;
  if (!st || !st.el || !el || st.el === el) return;

  try { st.el.classList.remove(HIDE_CLASS); } catch (_) { /* already detached */ }
  st.el = el;
  copyTypography(doc, host, el); // before the hide class — see copyTypography
  try { el.classList.add(HIDE_CLASS); } catch (_) { /* detached */ }
  clipHostToPanel(doc, doc.defaultView || window, host, BASE_Z);
  positionBox(doc, host, el);

  // Only take the caret back if the re-render stole it — re-focusing a box that
  // already has focus would collapse the user's selection mid-typing.
  let refocused = false;
  try {
    if (doc.activeElement !== st.box) { st.box.focus({ preventScroll: true }); refocused = true; }
  } catch (_) { /* best-effort */ }
  itLog('re-anchored after canvas re-render', { tag: el.tagName.toLowerCase(), refocused });
}

/**
 * Open the editor over `el`.
 *
 * @param {Document} doc
 * @param {Element}  el
 * @param {{value: string, onCommit: (text: string) => void}} opts
 */
export function openInlineText(doc, el, opts) {
  if (!doc || !el) return false;
  const host = ensureHost(doc);
  const st = host.__uichIT;
  if (st.el === el) return true;
  if (st.el) closeInlineText(doc, true); // commit whatever was already open

  const win = doc.defaultView || window;
  st.el = el;
  st.touched = false;
  st.onCommit = (opts && opts.onCommit) || null;
  st.original = String((opts && opts.value) || '');
  st.box.textContent = st.original;
  copyTypography(doc, host, el); // before the hide class — see copyTypography
  try { el.classList.add(HIDE_CLASS); } catch (_) { /* detached */ }

  // Measure with the host visible — a display:none box measures 0×0, so the
  // first placement would land in the wrong spot. Clip before positioning:
  // clipHostToPanel rewrites host.style.left, which positionBox reads.
  host.style.display = '';
  clipHostToPanel(doc, win, host, BASE_Z);
  positionBox(doc, host, el);
  bind(doc, host);

  try {
    st.box.focus({ preventScroll: true });
    const sel = win.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(st.box);
    range.collapse(false); // caret at the end
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) { /* focus/selection is best-effort */ }

  // `focused: false` means the box never took the caret, so no keystroke will
  // ever reach it AND no blur will ever fire to say so — the single most
  // important thing to know when the editor looks open but is inert.
  itLog('open', {
    tag: el.tagName.toLowerCase(),
    value: st.original,
    focused: doc.activeElement === st.box,
    anchorInDocument: el.isConnected !== false,
  });
  return true;
}

/** Keep the box over the element as the canvas scrolls, resizes or reflows. */
export function repositionInlineText(doc) {
  const host = doc && doc.getElementById && doc.getElementById(HOST_ID);
  const st = host && host.__uichIT;
  if (!st || !st.el) return;
  try {
    clipHostToPanel(doc, doc.defaultView || window, host, BASE_Z);
    positionBox(doc, host, st.el);
  } catch (_) { /* node went away — the next close tidies up */ }
}

/**
 * Close the editor.
 * @param {boolean} commit  write the typed value back through onCommit
 */
export function closeInlineText(doc, commit) {
  const host = doc && doc.getElementById && doc.getElementById(HOST_ID);
  const st = host && host.__uichIT;
  if (!st || !st.el) return;

  const el = st.el;
  const onCommit = st.onCommit;
  const original = st.original;
  const value = readValue(st.box);

  // Cleared BEFORE onCommit fires: the write re-renders the canvas, and a
  // re-entrant close (blur while the node is replaced) must find nothing open.
  st.el = null;
  st.onCommit = null;
  st.original = '';
  host.style.display = 'none';
  st.box.textContent = '';

  const willWrite = !!(commit && typeof onCommit === 'function' && value !== original);
  // Write the committed text onto the live node BEFORE unmasking it, so the
  // canvas shows the new text with no flash of the old — and so it stays correct
  // even when the raw_html repaint bails on a dynamic widget (see
  // setLeafTextForDisplay). The model write below (onCommit → setElement) remains
  // the single source of truth for raw_html; this only keeps the DOM in step.
  if (willWrite) { try { setLeafTextForDisplay(el, value); } catch (_) { /* detached */ } }
  try { el.classList.remove(HIDE_CLASS); } catch (_) { /* detached */ }

  itLog('close', { commit: !!commit, changed: value !== original, wrote: willWrite, from: original, to: value });
  if (willWrite) onCommit(value);
}
