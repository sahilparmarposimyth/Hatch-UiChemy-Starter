// Globals, site-wide design tokens, grouped into user-named COLLECTIONS.
//
// Source of truth is the #uichemy-globals <style> block INSIDE the site head
// code (the same `site_custom_code_head` buffer the "Before </head> on every
// page" editor edits, mirrored to the uichemy_composer_site_custom_code option),
// the SAME artifact the AI reads/writes via get_globals_css / set_globals_css.
//
// A variable's collection is simply the `/* Section */` comment it sits under in
// :root, the LLM (or user) classifies by writing a heading, no @-rules or value
// inference. Each variable's editor is a colour picker when its value looks like
// a colour, else a plain text field. Reusable classes (.text-* typography and
// .pr-* components) live in a separate Classes section; AI-authored @media /
// other CSS in the block is preserved verbatim on save.

import React from 'react';
import ReactDOM from 'react-dom';
import { I } from './composer-icons';
import { cn } from '@/lib/utils';
import { LengthInput, SelectCustomInput } from './composer-inputs';
import { ensurePortalRoot } from '@/components/ui/portal-context';
import { getRestApiBaseUrl, getRestNonce, applyGlobalsCss, useWidgetSetting, propagateComposerSetting, saveSharedSiteCustomCodeDebounced, refreshElementorGlobalsPanel, upsertKitGlobalsLive, setActiveWidgetSettingSync } from './composer-elementor';
import { ColorInput } from './composer-color-picker';
import { extractGlobalsCss, upsertGlobalsBlock, parseGlobalsCss, isColorValue, isFontFamilyValue, DEFAULT_COLLECTION } from './composer-globals-css';
import { ProBadge, allowOrUpsell, globalsLimits, globalsUpsell } from './composer-pro';

// The per-build limits, from the per-plugin pro module. A build with no limits reports
// Infinity, so every `count >= limit` below is simply false there, which is why none
// of these call sites needs a tier check.
const LIMITS = globalsLimits();

// ── helpers ──────────────────────────────────────────────────────────────────
let _kSeq = 0;
function genKey() { _kSeq += 1; return 'k' + _kSeq; }
function genVarId() { return 'var-' + Math.random().toString(36).slice(2, 7); }
// Slug for a css-variable id. NOTE: no leading/trailing hyphen trim, trimming
// on every keystroke makes it impossible to type `brand-dark` (the hyphen is
// stripped before the next char). Trailing hyphens are harmless in a var name.
function slugId(s) { return String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-'); }

// The design-system input frame (INPUT_CLS: border-input + shadow-sm +
// focus-visible ring-ring). Rendered as a wrapper with `focus-within` so the
// ring shows even with a `--` prefix, variable-id and string-value inputs look
// and focus identically, using the same tokens as every other composer field.
const G_FRAME_CLS = 'flex h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring';
function GInput({ value, onChange, placeholder, mono, prefix, title, onFocus, onBlur }) {
  return (
    <div className={G_FRAME_CLS} title={title}>
      {prefix && <span className={cn('shrink-0 select-none text-muted-foreground', mono ? 'font-mono text-[11.5px]' : 'text-sm')}>{prefix}</span>}
      <input type="text" value={value} placeholder={placeholder} spellCheck={false} onChange={onChange} onFocus={onFocus} onBlur={onBlur}
        className={cn('w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground', mono ? 'font-mono text-[11.5px]' : 'text-sm')} />
    </div>
  );
}

// Variable value editor. A colour value shows the ColorInput; anything else a
// text field, BUT the swap only happens when the text field is NOT focused, so
// typing a hex (e.g. #FFF → #FFFFFF, which passes in/out of "valid colour" per
// keystroke) never remounts the field or steals focus mid-type. Value still
// reflects live on every keystroke.
function ValueCell({ value, onChange }) {
  const [focused, setFocused] = React.useState(false);
  if (isColorValue(value) && !focused) {
    return <ColorInput value={value} onChange={(nv) => onChange(nv)} placeholder="#hex / rgba(…)" compact side="bottom" />;
  }
  return (
    <GInput value={value} placeholder="value…"
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)} />
  );
}

// Load-time snapshot of the shared site head/footer code, provided by the server
// in window.uichComposerEditorCfg.siteCode. This is the authoritative value at
// page load, the `site_custom_code_head` widget setting is only populated once a
// Composer widget carrying it becomes the active selection, so on a cold load (or
// when a non-Composer element is selected) useWidgetSetting() reads empty even
// though the block exists. We fall back to this snapshot so the Globals Manager
// never sees an empty block and never clobbers it on save.
function readCfgSiteCode() {
  try {
    const sc = (typeof window !== 'undefined' && window.uichComposerEditorCfg && window.uichComposerEditorCfg.siteCode) || null;
    return {
      head: sc && typeof sc.head === 'string' ? sc.head : '',
      footer: sc && typeof sc.footer === 'string' ? sc.footer : '',
    };
  } catch (_) {
    return { head: '', footer: '' };
  }
}
// Keep the cfg snapshot fresh after our own writes so the fallback stays correct.
function writeCfgSiteHead(head) {
  try {
    const w = typeof window !== 'undefined' ? window : null;
    if (w && w.uichComposerEditorCfg && w.uichComposerEditorCfg.siteCode) w.uichComposerEditorCfg.siteCode.head = head;
  } catch (_) { /* noop */ }
}

// Guess a collection icon from its name; fall back to a generic variable glyph.
function iconForCollection(name) {
  const n = String(name || '').toLowerCase();
  if (/colou?r/.test(n)) return I.paint;
  if (/shadow|elevat/.test(n)) return I.layers;
  if (/font|typograph|text/.test(n)) return I.type;
  if (/radi|round|corner/.test(n)) return I.border;
  if (/border|stroke|outline/.test(n)) return I.border;
  if (/spac|gap|margin|padd|size|dimension|width|height|scale/.test(n)) return I.spacing;
  return I.variable;
}

// ── CSS block ↔ Manager model adapter ────────────────────────────────────────
// Parsed tokens → editable item rows. An item is just { id, value, collection }.
function tokensToItems(tokens) {
  return (tokens || []).map((t) => ({
    _k: genKey(),
    id: String(t.name || '').replace(/^--/, ''),
    value: typeof t.value === 'string' ? t.value : '',
    collection: t.collection || DEFAULT_COLLECTION,
  }));
}

// Parsed classes → editable rows (stable keys + typography|component kind).
function classesToRows(classes) {
  return (Array.isArray(classes) ? classes : []).map((c) => ({
    _k: genKey(),
    selector: c.selector || '',
    kind: c.kind || 'component',
    body: typeof c.body === 'string' ? c.body : '',
  }));
}

/* ── Globals export / import ──────────────────────────────────────────────────
   The whole globals model is ONE artifact — the #uichemy-globals block — so a
   kit round-trips as that CSS string and nothing has to be mapped field by
   field. The file wraps it in a small envelope so an import can tell a real
   export from an arbitrary file, and so fields can be added later without
   breaking older files. A bare .css file is accepted too: someone who exported,
   hand-edited and re-imported should not be punished for it. */

const EXPORT_FORMAT  = 'uichemy-globals';
const EXPORT_VERSION = 1;

function buildExportFile(css, counts) {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    site: (typeof window !== 'undefined' && window.location) ? window.location.origin : '',
    // Informational only — the import reads `css`, never these.
    counts,
    css: String(css || ''),
  }, null, 2);
}

/**
 * Pull the globals CSS out of a chosen file's text.
 *
 * @throws {Error} with a message meant for the user.
 */
function readImportFile(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) throw new Error('That file is empty.');

  if (raw[0] === '{') {
    let json;
    try { json = JSON.parse(raw); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (json && json.format && json.format !== EXPORT_FORMAT) {
      throw new Error(`That file is a "${json.format}" export, not a UiChemy globals export.`);
    }
    if (!json || typeof json.css !== 'string') {
      throw new Error('That export has no globals CSS in it.');
    }
    return json.css;
  }

  // Raw CSS. Tolerate a full <style> wrapper, which is what someone gets if they
  // copy the block straight out of the site head.
  const inner = extractGlobalsCss(raw);
  return inner || raw;
}

/**
 * What importing `imported` would do to the current model, per row.
 *
 * Computed rather than described so the dialog can show real counts — an import
 * that silently replaced everything was the thing to avoid here.
 */
function planGlobalsImport(current, imported) {
  const curVarById = new Map((current.vars || []).map((v) => [String(v.id), v]));
  const curClsBySel = new Map((current.classes || []).map((c) => [String(c.selector).trim(), c]));

  const varsAdd = [], varsUpdate = [], varsSame = [];
  (imported.vars || []).forEach((v) => {
    const cur = curVarById.get(String(v.id));
    if (!cur) varsAdd.push(v);
    else if (String(cur.value).trim() !== String(v.value).trim()) varsUpdate.push({ from: cur, to: v });
    else varsSame.push(v);
  });

  const clsAdd = [], clsUpdate = [], clsSame = [];
  (imported.classes || []).forEach((c) => {
    const cur = curClsBySel.get(String(c.selector).trim());
    if (!cur) clsAdd.push(c);
    else if (String(cur.body).trim() !== String(c.body).trim()) clsUpdate.push({ from: cur, to: c });
    else clsSame.push(c);
  });

  const curCols = new Set(current.collections || []);
  const colsAdd = (imported.collections || []).filter((c) => !curCols.has(c));

  // Replace drops whatever the file does not carry — worth counting, since it is
  // the number that makes Replace vs Merge a real decision.
  const impVarIds = new Set((imported.vars || []).map((v) => String(v.id)));
  const impClsSels = new Set((imported.classes || []).map((c) => String(c.selector).trim()));
  const varsDropped = (current.vars || []).filter((v) => !impVarIds.has(String(v.id)));
  const clsDropped = (current.classes || []).filter((c) => !impClsSels.has(String(c.selector).trim()));

  return { varsAdd, varsUpdate, varsSame, clsAdd, clsUpdate, clsSame, colsAdd, varsDropped, clsDropped };
}

/**
 * Apply an import, in the chosen mode.
 *
 * MERGE keeps the user's own organisation: a token that already exists takes the
 * file's VALUE but stays in the collection it is filed under, because moving
 * someone's tokens around is not what "import a palette" should mean. REPLACE is
 * the whole file, verbatim.
 *
 * @returns {{vars: Array, collections: Array, classes: Array, preserved: Array}}
 */
function applyGlobalsImport(mode, current, imported) {
  if (mode === 'replace') {
    return {
      vars: (imported.vars || []).map((v) => ({ ...v, _k: genKey() })),
      collections: (imported.collections || []).slice(),
      classes: (imported.classes || []).map((c) => ({ ...c, _k: genKey() })),
      preserved: (imported.preserved || []).slice(),
    };
  }

  const impVarById = new Map((imported.vars || []).map((v) => [String(v.id), v]));
  const vars = (current.vars || []).map((v) => {
    const imp = impVarById.get(String(v.id));
    if (!imp) return v;
    impVarById.delete(String(v.id));
    return { ...v, value: imp.value };           // value from the file, collection stays
  });
  impVarById.forEach((v) => vars.push({ ...v, _k: genKey() }));

  const impClsBySel = new Map((imported.classes || []).map((c) => [String(c.selector).trim(), c]));
  const classes = (current.classes || []).map((c) => {
    const imp = impClsBySel.get(String(c.selector).trim());
    if (!imp) return c;
    impClsBySel.delete(String(c.selector).trim());
    return { ...c, body: imp.body, kind: imp.kind || c.kind };
  });
  impClsBySel.forEach((c) => classes.push({ ...c, _k: genKey() }));

  const collections = (current.collections || []).slice();
  (imported.collections || []).forEach((c) => { if (!collections.includes(c)) collections.push(c); });
  // Only the collections the merged tokens actually need, plus what was already
  // there — an empty collection from the file would otherwise appear for nothing.
  const used = new Set(vars.map((v) => v.collection || DEFAULT_COLLECTION));
  const cols = collections.filter((c) => used.has(c) || (current.collections || []).includes(c));

  // Raw blocks (@media, keyframes) are deduped by exact text: appending blindly
  // would stack a second copy of the same keyframes on every import.
  const preserved = (current.preserved || []).slice();
  (imported.preserved || []).forEach((blk) => {
    const t = String(blk || '').trim();
    if (t && !preserved.some((x) => String(x || '').trim() === t)) preserved.push(blk);
  });

  return { vars, collections: cols, classes, preserved };
}

// Render items (grouped by collection) + preserved CSS + class rows → block CSS.
// Collection headers are emitted in order, including empty ones, so a freshly
// added collection persists even before it has variables.
function itemsToCss(items, collections, preserved, classRows) {
  const order = [];
  const seen = new Set();
  (collections || []).forEach((c) => { if (!seen.has(c)) { seen.add(c); order.push(c); } });
  (items || []).forEach((it) => { const c = it.collection || DEFAULT_COLLECTION; if (!seen.has(c)) { seen.add(c); order.push(c); } });

  const root = [];
  order.forEach((col, ci) => {
    if (ci > 0) root.push('');
    root.push(`  /* ${col} */`);
    (items || []).forEach((it) => {
      if ((it.collection || DEFAULT_COLLECTION) !== col) return;
      const id = String(it.id || '').replace(/^--/, '').trim();
      const val = String(it.value == null ? '' : it.value).trim();
      if (!id || val === '') return;
      root.push(`  --${id}: ${val};`);
    });
  });

  let css = '';
  if (root.length) css += `:root {\n${root.join('\n')}\n}\n`;
  (preserved || []).forEach((p) => { const s = String(p || '').trim(); if (s) css += `\n${s}\n`; });
  (classRows || []).forEach((c) => {
    const sel = String(c.selector || '').trim();
    const body = String(c.body || '').trim();
    if (!sel || !body) return;
    const indented = body.split('\n').map((ln) => (ln.trim() ? '  ' + ln.trim() : ln)).join('\n');
    css += `\n${sel} {\n${indented}\n}\n`;
  });
  css = css.replace(/<\/style/gi, '< /style'); // only neutralise a </style breakout; keep all other '<' (SVG data URIs, media ranges)
  return css.trim() ? css.trim() + '\n' : '';
}

// ── Shared read-only globals cache (inspector colour / globe pickers) ─────────
let _globalsCache = null;
let _globalsFetched = false;
const _globalsSubs = new Set();
function _emitGlobals() { _globalsSubs.forEach((fn) => { try { fn(_globalsCache); } catch (e) { /* noop */ } }); }
export function primeUiChemyGlobals(list) {
  if (Array.isArray(list)) { _globalsCache = list; _globalsFetched = true; _emitGlobals(); }
}
// Shared read-only cache of the SAME block's `.selector { … }` classes (both
// "Other" component classes and Typography classes from the unified Globals
// Manager), so the Add Class dropdown (composer-class-suggestions.js) can
// offer them without a second REST round-trip. Kept alongside the variables
// cache because both are parsed from one `/uichemy/v1/globals-css` fetch.
let _globalsClassesCache = null;
const _globalsClassesSubs = new Set();
function _emitGlobalsClasses() { _globalsClassesSubs.forEach((fn) => { try { fn(_globalsClassesCache); } catch (e) { /* noop */ } }); }
export function primeUiChemyGlobalClasses(list) {
  if (Array.isArray(list)) { _globalsClassesCache = list; _emitGlobalsClasses(); }
}

function mergeFlatCssBody(body, updates) {
  const order = [];
  const map = {};
  String(body || '').split(';').map((s) => s.trim()).filter(Boolean).forEach((line) => {
    const ci = line.indexOf(':');
    if (ci === -1) return;
    const prop = line.slice(0, ci).trim();
    if (!prop) return;
    if (!(prop in map)) order.push(prop);
    map[prop] = line.slice(ci + 1).trim();
  });
  Object.keys(updates || {}).forEach((prop) => {
    const value = updates[prop];
    if (value === '' || value == null) {
      const at = order.indexOf(prop);
      if (at !== -1) order.splice(at, 1);
      delete map[prop];
      return;
    }
    if (!(prop in map)) order.push(prop);
    map[prop] = value;
  });
  return order.map((prop) => `${prop}: ${map[prop]};`).join('\n');
}

export function applyTypographyClassToGlobals(className, updates) {
  const cfg = readCfgSiteCode();
  const head = cfg.head || '';
  const blockCss = extractGlobalsCss(head);
  const model = parseGlobalsCss(blockCss);
  const selector = `.${className}`;
  const rows = classesToRows(model.classes);
  let row = rows.find((r) => r.selector === selector);
  if (!row) {
    row = { _k: genKey(), selector, kind: 'typography', body: '' };
    rows.push(row);
  }
  row.body = mergeFlatCssBody(row.body, updates);

  const items = tokensToItems(model.tokens);
  const cols = model.collections.length ? model.collections : (items.length ? [DEFAULT_COLLECTION] : []);
  const cleanItems = items.map(({ _k, ...rest }) => rest);
  const cleanRows = rows.map(({ _k, ...rest }) => rest);
  const css = itemsToCss(cleanItems, cols, model.preserved, cleanRows);
  const nextHead = upsertGlobalsBlock(head, css);

  writeCfgSiteHead(nextHead);
  primeUiChemyGlobals(cleanItems);
  primeUiChemyGlobalClasses(cleanRows);
  setActiveWidgetSettingSync('site_custom_code_head', nextHead);
  propagateComposerSetting('site_custom_code_head', nextHead);
  saveSharedSiteCustomCodeDebounced(nextHead, cfg.footer || '');
  applyGlobalsCss(css);
  return true;
}

function _fetchGlobalsOnce() {
  if (_globalsFetched) return;
  _globalsFetched = true;
  const base = getRestApiBaseUrl();
  const nonce = getRestNonce();
  fetch(`${base}/uichemy/v1/globals-css`, { credentials: 'same-origin', headers: nonce ? { 'X-WP-Nonce': nonce } : {} })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      if (d && typeof d.css === 'string') {
        const parsed = parseGlobalsCss(d.css);
        _globalsCache = tokensToItems(parsed.tokens).map(({ _k, ...rest }) => rest);
        _emitGlobals();
        primeUiChemyGlobalClasses(parsed.classes);
      }
    })
    .catch(() => { /* pickers just render nothing */ });
}
export function getUiChemyGlobalsSnapshot() {
  _fetchGlobalsOnce();
  return _globalsCache || [];
}
export function getUiChemyGlobalClassesSnapshot() {
  _fetchGlobalsOnce();
  return _globalsClassesCache || [];
}
export function useUiChemyGlobalClasses() {
  const [list, setList] = React.useState(_globalsClassesCache || []);
  React.useEffect(() => {
    const fn = (l) => setList(l || []);
    _globalsClassesSubs.add(fn);
    if (_globalsClassesCache) setList(_globalsClassesCache);
    _fetchGlobalsOnce();
    return () => { _globalsClassesSubs.delete(fn); };
  }, []);
  return list;
}
export function useUiChemyGlobals() {
  const [items, setItems] = React.useState(_globalsCache || []);
  React.useEffect(() => {
    const fn = (list) => setItems(list || []);
    _globalsSubs.add(fn);
    if (_globalsCache) setItems(_globalsCache);
    _fetchGlobalsOnce();
    return () => { _globalsSubs.delete(fn); };
  }, []);
  return items;
}
// A global's resolved raw CSS value (always a string in the new model).
export function resolveGlobalValue(v) { return v && typeof v.value === 'string' ? v.value : ''; }

// Resolve a `var(--id)` value to the UiChemy global it references, so linked
// fields can show the global's NAME + swatch (and know they're linked). Returns
// { id, name, value } when `value` is a var() pointing at a known UiChemy
// global, else null. `list` defaults to the shared snapshot; callers inside a
// component should pass the useUiChemyGlobals() result so it stays reactive.
export function resolveUiChemyColorMeta(value, list) {
  const m = /^var\(\s*--([\w-]+)\s*\)\s*$/i.exec(String(value || '').trim());
  if (!m) return null;
  const id = m[1];
  const arr = Array.isArray(list) ? list : getUiChemyGlobalsSnapshot();
  const t = (arr || []).find((v) => v && String(v.id) === id);
  if (!t) return null;
  return { id, name: id, value: t.value || '' };
}
// Group globals by collection for the picker list. `colorOnly` keeps colours.
export function groupUiChemyGlobals(items, opts) {
  const o = opts || {};
  const out = [];
  const byId = {};

  // A global's value can be a REFERENCE to another global — `var(--other)`, with
  // or without a fallback. Classification has to follow that reference: an
  // aliased colour like `var(--titledark, #ebebeb)` is neither a literal colour
  // nor a dimension, so it slipped through every filter and put a "Colors"
  // collection in the font-family list. Follow the chain (capped, so a global
  // pointing at itself cannot spin), then fall back to the var()'s own fallback.
  const valueById = {};
  (items || []).forEach((v) => { if (v && v.id) valueById[v.id] = v.value; });
  const resolveValue = (value) => {
    let v = String(value == null ? '' : value).trim();
    for (let hop = 0; hop < 5; hop++) {
      const m = v.match(/^var\(\s*--([^,)\s]+)\s*(?:,\s*([\s\S]*))?\)$/);
      if (!m) return v;
      const target = valueById[m[1]];
      v = String((target != null ? target : m[2]) || '').trim();
      if (!v) return '';
    }
    return v;
  };

  (items || []).forEach((v) => {
    if (!v || !v.id) return;
    const resolved = resolveValue(v.value);
    const isColor = isColorValue(resolved);
    if (o.colorOnly && !isColor) return;
    // Font family: drop colours and dimensions, so the picker on that field
    // offers font collections instead of every token the user has ever made.
    if (o.fontOnly && !isFontFamilyValue(resolved)) return;
    const gname = (v.collection && String(v.collection).trim()) || DEFAULT_COLLECTION;
    const gid = 'c-' + slugId(gname);
    if (!byId[gid]) { byId[gid] = { id: gid, name: gname, items: [] }; out.push(byId[gid]); }
    // `value` stays the authored string (the user should see `var(--x)` if that
    // is what it is); `resolved` is what a swatch can actually paint.
    byId[gid].items.push({
      id: v.id, name: v.id, type: isColor ? 'color' : 'text', value: v.value, resolved,
    });
  });
  return out;
}

// ── chrome ────────────────────────────────────────────────────────────────────
const CAT_PILL_CLS = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 h-8 text-xs font-medium transition-colors';
const ICON_BTN_CLS = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-transparent text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50';
const ADD_BTN_CLS  = 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-secondary text-xs font-semibold text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80';
const NAV_ROW_CLS  = 'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors';

// Centered modal for the Globals manager. Portaled overlay (no radix) so it has
// no jsx-runtime dependency and works in every host document.
function GlobalsModal({ onClose, title, children, footer, headerActions }) {
  const T = I;
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined' || !document.body) return null;
  // Scope OFF the canvas-toolbar host: it also carries `.uich-composer-host`, and
  // querySelector takes the first match — when the panel host is gone (Gutenberg
  // deselect) the toolbar would otherwise stand in for "the panel". See
  // [[composer-host-class-is-a-lookup-key]].
  const composerHost = document.querySelector('.uich-composer-host:not(.uich-canvas-toolbar-host)');
  const theme = composerHost && composerHost.classList.contains('dark') ? 'dark' : 'light';
  const host = ensurePortalRoot(document, theme);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)' }} onMouseDown={onClose}>
      <div className="flex h-[620px] max-h-[86vh] w-[min(860px,95vw)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <T.globe size={15} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{title || 'Globals'}</span>
          <span className="flex-1" />
          {headerActions}
          <button type="button" className={ICON_BTN_CLS} title="Close (Esc)" onClick={onClose}><T.x size={14} /></button>
        </div>
        <div className="flex min-h-0 flex-1">{children}</div>
        {footer && <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">{footer}</div>}
      </div>
    </div>,
    host,
  );
}

// ── Typography controller (Elementor-like) ──────────────────────────────────
// A typography class is edited as a set of properties rather than raw CSS. We
// parse the class body into the known typography declarations (everything else
// is preserved as `extra`) and write them back in a stable order on change.
const TYPO_KEYS = ['font-family', 'font-size', 'font-weight', 'font-style', 'text-transform', 'text-decoration', 'line-height', 'letter-spacing'];
const WEIGHTS = ['', '100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold', 'lighter', 'bolder'];
const TRANSFORMS = ['', 'none', 'uppercase', 'lowercase', 'capitalize'];
const FSTYLES = ['', 'normal', 'italic', 'oblique'];
const DECOS = ['', 'none', 'underline', 'overline', 'line-through'];
const SIZE_UNITS = ['px', 'em', 'rem', '%'];
const LH_UNITS = ['', 'px', 'em', '%'];
const LS_UNITS = ['px', 'em', 'rem'];

function parseDecls(body) {
  const out = [];
  String(body || '').split(';').forEach((seg) => {
    const s = seg.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!s) return;
    const c = s.indexOf(':');
    if (c === -1) return;
    out.push({ prop: s.slice(0, c).trim().toLowerCase(), value: s.slice(c + 1).trim() });
  });
  return out;
}
function typoFromBody(body) {
  const props = {}, extra = [];
  parseDecls(body).forEach((d) => { if (TYPO_KEYS.includes(d.prop)) props[d.prop] = d.value; else extra.push(d); });
  return { props, extra };
}
function bodyFromTypo(props, extra) {
  const lines = [];
  TYPO_KEYS.forEach((k) => { if (props[k] != null && String(props[k]).trim() !== '') lines.push(`${k}: ${String(props[k]).trim()};`); });
  (extra || []).forEach((d) => lines.push(`${d.prop}: ${d.value};`));
  return lines.join('\n');
}
// Split "48px" → { num:'48', unit:'px' }; freeform (var(), calc()) → num holds all.
function splitLen(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(-?\d*\.?\d+)\s*([a-z%]*)$/i);
  return m ? { num: m[1], unit: (m[2] || '').toLowerCase() } : { num: s, unit: '' };
}

function TypoField({ label, full, children }) {
  return (
    <div className={cn('flex flex-col gap-1', full && 'col-span-2')}>
      <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
// Length field (number + unit pill) reusing the composer's LengthInput so the
// Globals typography controls match every other length field in the editor –
// the value is a single CSS string ("48px"), split for editing and recombined
// on change. Native <select>s were dropped: Elementor's editor stylesheet
// mangles their arrows, which is what looked broken here.
function TypoLen({ value, units, fallbackUnit, placeholder, onChange }) {
  const { num, unit } = splitLen(value);
  const u = unit || fallbackUnit;
  // LengthInput fires onChange(num) THEN onUnit(unit) in the same tick when a
  // value+unit is typed together ("24px"). Both handlers must compose from the
  // latest half, not the render-time `num`/`u`, otherwise the second call
  // rebuilds from the stale number and clobbers what the first just set. Hold
  // the freshest pair in a ref so the intra-tick calls see each other's write.
  const latest = React.useRef({ num, unit: u });
  latest.current = { num, unit: u };
  return (
    <LengthInput
      value={num}
      unit={u}
      units={units}
      placeholder={placeholder}
      onChange={(n) => { const nn = String(n).trim(); latest.current.num = nn; onChange(nn === '' ? '' : `${nn}${latest.current.unit}`); }}
      onUnit={(nu) => { latest.current.unit = nu; const nn = String(latest.current.num).trim(); onChange(nn === '' ? '' : `${nn}${nu}`); }}
    />
  );
}
function TypographyEditor({ body, onBody }) {
  const parsed = React.useMemo(() => typoFromBody(body), [body]);
  const p = parsed.props;
  const set = (k, val) => onBody(bodyFromTypo({ ...p, [k]: val }, parsed.extra));
  return (
    <div className="grid grid-cols-2 gap-2.5 border-t border-border bg-muted/20 p-3.5">
      <TypoField label="Font Family" full>
        <GInput value={p['font-family'] || ''} placeholder="var(--font-body) · Inter, sans-serif" onChange={(e) => set('font-family', e.target.value)} />
      </TypoField>
      <TypoField label="Size"><TypoLen value={p['font-size']} units={SIZE_UNITS} fallbackUnit="px" placeholder="16" onChange={(v) => set('font-size', v)} /></TypoField>
      <TypoField label="Weight"><SelectCustomInput value={p['font-weight'] || ''} options={WEIGHTS.filter(Boolean)} placeholder="–" onChange={(v) => set('font-weight', v)} /></TypoField>
      <TypoField label="Line Height"><TypoLen value={p['line-height']} units={LH_UNITS.filter(Boolean)} fallbackUnit="em" placeholder="1.5" onChange={(v) => set('line-height', v)} /></TypoField>
      <TypoField label="Letter Spacing"><TypoLen value={p['letter-spacing']} units={LS_UNITS} fallbackUnit="px" placeholder="0" onChange={(v) => set('letter-spacing', v)} /></TypoField>
      <TypoField label="Transform"><SelectCustomInput value={p['text-transform'] || ''} options={TRANSFORMS.filter(Boolean)} placeholder="–" onChange={(v) => set('text-transform', v)} /></TypoField>
      <TypoField label="Style"><SelectCustomInput value={p['font-style'] || ''} options={FSTYLES.filter(Boolean)} placeholder="–" onChange={(v) => set('font-style', v)} /></TypoField>
      <TypoField label="Decoration"><SelectCustomInput value={p['text-decoration'] || ''} options={DECOS.filter(Boolean)} placeholder="–" onChange={(v) => set('text-decoration', v)} /></TypoField>
    </div>
  );
}
// Small live sample styled by the class's typography (size clamped so the row
// stays compact); font vars resolve against :root in the portal document.
function typoPreviewStyle(body) {
  const p = typoFromBody(body).props;
  const sz = splitLen(p['font-size']);
  const px = parseFloat(sz.num);
  return {
    fontFamily: p['font-family'] || 'inherit',
    fontWeight: p['font-weight'] || 400,
    fontStyle: p['font-style'] || 'normal',
    textTransform: p['text-transform'] || 'none',
    textDecoration: p['text-decoration'] || 'none',
    letterSpacing: p['letter-spacing'] || 'normal',
    fontSize: (!isNaN(px) && sz.unit === 'px') ? Math.min(px, 22) + 'px' : 18,
    lineHeight: 1.1,
  };
}

// ── Elementor globals sync ───────────────────────────────────────────────────
// UiChemy's globals live in the #uichemy-globals block (colour vars + .text-*
// typography classes); Elementor keeps its own kit globals (System/Custom
// Colors + Typography). "Elementor Sync" reconciles the two, ADD-only, in both
// directions: whatever is missing on one side is created on the other. Tokens
// are matched by a normalized name key so re-syncing is idempotent (never
// duplicates). Values are never overwritten, a name present on both sides is
// left untouched.

// Normalized key for a typography token, a leading `text-`/`text_` is dropped
// so UiChemy `.text-hero` and an Elementor "Hero" reconcile to the same `hero`.
function typoBaseName(s) {
  return slugId(String(s || '').replace(/^\./, '')).replace(/^text[-_]/, '');
}

// Elementor stores font-size/line-height/letter-spacing as { unit, size }.
// Flatten one to a CSS length string ('' when unset). `custom` unit → unitless.
function elLenToCss(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
  const size = obj.size;
  if (size === '' || size == null) return '';
  const unit = obj.unit && obj.unit !== 'custom' ? obj.unit : '';
  return `${size}${unit}`;
}
// CSS length string → Elementor { unit, size } (null when empty). Unitless
// values take `fallbackUnit` (Elementor requires a unit on these controls).
function cssLenToEl(cssVal, fallbackUnit) {
  const { num, unit } = splitLen(cssVal);
  if (String(num).trim() === '') return null;
  return { unit: unit || fallbackUnit, size: num };
}

// Elementor typography value (prefix-stripped keys) → UiChemy .text-* class body.
function elTypoToBody(value) {
  const v = value || {};
  const lines = [];
  const push = (prop, val) => { const s = String(val == null ? '' : val).trim(); if (s) lines.push(`${prop}: ${s};`); };
  push('font-family', v.font_family);
  push('font-size', elLenToCss(v.font_size));
  push('font-weight', v.font_weight);
  push('font-style', v.font_style);
  push('text-transform', v.text_transform);
  push('text-decoration', v.text_decoration);
  push('line-height', elLenToCss(v.line_height));
  push('letter-spacing', elLenToCss(v.letter_spacing));
  return lines.join('\n');
}
// UiChemy .text-* class body → Elementor typography_* value map.
function bodyToElTypo(body) {
  const p = typoFromBody(body).props;
  const out = { typography_typography: 'custom' };
  if (p['font-family'])     out.typography_font_family = p['font-family'];
  if (p['font-weight'])     out.typography_font_weight = p['font-weight'];
  if (p['font-style'])      out.typography_font_style = p['font-style'];
  if (p['text-transform'])  out.typography_text_transform = p['text-transform'];
  if (p['text-decoration']) out.typography_text_decoration = p['text-decoration'];
  const fs = cssLenToEl(p['font-size'], 'px');       if (fs) out.typography_font_size = fs;
  const lh = cssLenToEl(p['line-height'], 'em');     if (lh) out.typography_line_height = lh;
  const ls = cssLenToEl(p['letter-spacing'], 'px');  if (ls) out.typography_letter_spacing = ls;
  return out;
}

// Strip Elementor's `typography_` prefix from a raw kit typography row's value
// keys (the REST endpoint returns them prefixed).
function normalizeElTypoValue(value) {
  const out = {};
  Object.keys(value || {}).forEach((k) => { out[k.replace(/^typography_/, '')] = value[k]; });
  return out;
}

// ── value equality (for value-conflict + rename detection) ────────────────────
// Colours compare after normalizing case/spacing and expanding shorthand hex, so
// "#FFF" == "#ffffff" and "rgba(0, 0, 0, 1)" == "rgba(0,0,0,1)".
function normColorValue(v) {
  let s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
  const m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) s = '#' + m[1].split('').map((ch) => ch + ch).join(''); // #rgb(a) → #rrggbb(aa)
  return s;
}
function colorsEqual(a, b) { return normColorValue(a) === normColorValue(b); }

// Typography compares on the eight known text properties only (colour/other
// declarations are UiChemy-only metadata and ignored). BOTH sides are canonised
// through the SAME Elementor round-trip so representation quirks (e.g. a unitless
// `1.2` line-height that syncs out as `1.2em`) don't read as a perpetual diff.
function canonTypoFromStripped(stripped) {
  const p = typoFromBody(elTypoToBody(stripped)).props;
  return TYPO_KEYS.map((k) => `${k}:${String(p[k] == null ? '' : p[k]).trim().toLowerCase()}`).join('|');
}
function uichemyBodyToStripped(body) { return normalizeElTypoValue(bodyToElTypo(body)); }
function canonTypoFromBody(body) { return canonTypoFromStripped(uichemyBodyToStripped(body)); }
function typoEqual(uichemyBody, elStripped) { return canonTypoFromBody(uichemyBody) === canonTypoFromStripped(elStripped); }

// ── reconciliation plan ───────────────────────────────────────────────────────
// Match UiChemy globals (colour vars + .text-* classes) against the Elementor
// kit by normalized NAME, then classify every token so the review dialog can let
// the user choose per item:
//   addToEl  , name only in UiChemy            → create on the kit
//   addToPr  , name only in Elementor          → create in the block
//   conflicts, same name, different value      → user picks a direction (skip)
//   renames  , different name, same value      → likely a rename (paired 1:1)
// Kit tokens are named by TITLE only (the `_id` is a random hash), so a
// blank-titled kit token is dropped rather than made into a `--hash` token.
// Deterministic 7-char id for a token we CREATE on the Elementor kit. Seeded on
// the token's normalized identity so re-syncing the same token always maps to
// the same kit entry (idempotent), and, unlike the old slugId(name) id, never
// lands on Elementor's reserved system ids (primary/secondary/text/accent) or
// shadows another token whose name happens to slugify the same.
function elGlobalId(seed) {
  const s = String(seed || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // djb2, unsigned
  return h.toString(36).padStart(7, '0').slice(-7);
}
function computeReconcilePlan(uichemy, elementor) {
  const pColors = (uichemy.colors || []).filter((c) => slugId(c.id));
  const eColors = (elementor.colors || []).filter((c) => slugId(c.title));
  const pTypo   = (uichemy.typo || []).filter((t) => typoBaseName(t.selector));
  const eTypo   = (elementor.typography || []).filter((t) => typoBaseName(t.title));

  // ---- colours ----
  // Iterate the by-key Maps (not the raw arrays) so two tokens that normalize to
  // the same key collapse to one plan entry instead of producing duplicate rows
  // that share a checkbox and double-write on apply.
  const eColorByKey = new Map(eColors.map((c) => [slugId(c.title), c]));
  const pColorByKey = new Map(pColors.map((c) => [slugId(c.id), c]));
  const cAddToEl = [], cAddToPr = [], cConflicts = [];
  pColorByKey.forEach((c, key) => {
    const e = eColorByKey.get(key);
    if (!e) { cAddToEl.push({ key, name: c.id, value: c.value }); return; }
    if (!colorsEqual(c.value, e.value)) cConflicts.push({ key, name: c.id, prValue: c.value, elValue: e.value, elId: e.id, elTitle: e.title });
  });
  eColorByKey.forEach((e, key) => {
    if (!pColorByKey.has(key)) cAddToPr.push({ key, name: slugId(e.title), title: e.title, value: e.value, elId: e.id });
  });
  const cRenames = extractRenames(cAddToEl, cAddToPr, (pr, el) => colorsEqual(pr.value, el.value));

  // ---- typography ----
  const eTypoByKey = new Map(eTypo.map((t) => [typoBaseName(t.title), t]));
  const pTypoByKey = new Map(pTypo.map((t) => [typoBaseName(t.selector), t]));
  const tAddToEl = [], tAddToPr = [], tConflicts = [];
  pTypoByKey.forEach((t, key) => {
    const e = eTypoByKey.get(key);
    if (!e) { tAddToEl.push({ key, name: t.selector, base: key, body: t.body }); return; }
    const elStripped = normalizeElTypoValue(e.value);
    if (!typoEqual(t.body, elStripped)) tConflicts.push({ key, name: t.selector, base: key, prBody: t.body, elStripped, elId: e.id, elTitle: e.title });
  });
  eTypoByKey.forEach((e, key) => {
    if (!pTypoByKey.has(key)) tAddToPr.push({ key, name: '.text-' + key, base: key, title: e.title, stripped: normalizeElTypoValue(e.value), elId: e.id });
  });
  const tRenames = extractRenames(tAddToEl, tAddToPr, (pr, el) => typoEqual(pr.body, el.stripped));

  return {
    colors:     { addToEl: cAddToEl, addToPr: cAddToPr, conflicts: cConflicts, renames: cRenames },
    typography: { addToEl: tAddToEl, addToPr: tAddToPr, conflicts: tConflicts, renames: tRenames },
  };
}
// Pull 1:1 same-value pairs out of the two "only on one side" lists (a probable
// rename). Mutates the lists (removes matched entries) and returns the pairs.
function extractRenames(prOnly, elOnly, sameValue) {
  const renames = [];
  for (let i = prOnly.length - 1; i >= 0; i--) {
    const pr = prOnly[i];
    const j = elOnly.findIndex((el) => sameValue(pr, el));
    if (j === -1) continue;
    const el = elOnly[j];
    renames.push({ pr, el });
    prOnly.splice(i, 1);
    elOnly.splice(j, 1);
  }
  return renames.reverse();
}

const EMPTY_GROUP = () => ({ addToEl: [], addToPr: [], conflicts: [], renames: [] });
const EMPTY_RECONCILE_PLAN = { colors: EMPTY_GROUP(), typography: EMPTY_GROUP() };

// Total selectable actions in a plan (0 ⇒ nothing to reconcile).
function planCount(plan) {
  let n = 0;
  ['colors', 'typography'].forEach((k) => {
    const g = plan[k];
    n += g.addToEl.length + g.addToPr.length + g.conflicts.length + g.renames.length;
  });
  return n;
}

// ── theme.json globals (Gutenberg / block-theme equivalent of the Elementor kit) ─
// Read the site's theme.json colour palette from the block editor so it can be
// synced INTO UiChemy Globals, the Gutenberg counterpart to "Elementor Sync".
// Prefer the theme (and any user `custom`) palette and SKIP WordPress's stock
// `default` core palette, so we bring in the site's own design tokens (Base,
// Contrast, Accent 1…) rather than 12 generic core colours. One-directional
// (theme.json → Globals): theme.json is a file we never write back to from here,
// so the resulting plan is add-only (see openThemeSync).
function readThemeJsonGlobals() {
  const wp = (typeof window !== 'undefined') ? window.wp : null;
  const sel = (wp && wp.data && wp.data.select) ? wp.data.select('core/block-editor') : null;
  if (!sel || typeof sel.getSettings !== 'function') return { available: false, colors: [], typography: [] };
  let s = {};
  try { s = sel.getSettings() || {}; } catch (e) { return { available: false, colors: [], typography: [] }; }
  const feat = s.__experimentalFeatures || {};
  const pal = (feat.color && feat.color.palette) ? feat.color.palette : null;
  let list = [];
  if (pal && typeof pal === 'object' && !Array.isArray(pal)) {
    list = [].concat(pal.theme || [], pal.custom || []);
    if (!list.length) list = pal.default || [];        // theme defines none → fall back to core
  } else if (Array.isArray(pal)) {
    list = pal;
  } else if (Array.isArray(s.colors)) {
    list = s.colors;                                    // older settings shape
  }
  const seen = new Set();
  const colors = [];
  list.forEach((c) => {
    if (!c || !c.slug || !c.color) return;
    const slug = slugId(c.slug);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    // Shape matches what computeReconcilePlan expects on the "other" side:
    // keyed by slugId(title), carrying value + id.
    colors.push({ id: slug, title: c.name || c.slug, value: c.color });
  });
  return { available: colors.length > 0, colors, typography: [] };
}

// ── Bricks globals (Bricks Builder's color palette + global variables) ────────
// Read Bricks' global colours from the editor's `window.bricksData` so they can
// be synced INTO UiChemy Globals, the Bricks counterpart to "Elementor Sync"
// and "Theme Sync". One-directional (Bricks → Globals), add-only.
//
// VERIFIED against Bricks 2.3.10's own source (includes/builder.php +
// includes/assets.php + includes/database.php), which is what the three fixes
// below are ports of, this used to be written defensively from guesswork and
// found NOTHING on a real install ("Bricks Sync" always reported an empty
// palette, so the Globals manager stayed at 0 variables):
//
//  1. WRONG PATH. `bricksData` has NO top-level `colorPalette` /
//     `globalVariables`. Bricks localizes the builder's whole bootstrap payload
//     under ONE key, `bricksData.loadData` (see Builder::builder_data(), which
//     returns $load_data, assigned to 'loadData' in the wp_localize_script call
//     at builder.php:319). So `bd.colorPalette` was always `undefined` and both
//     loops iterated an empty array. This is the fatal one.
//
//  2. WRONG VALUE KEYS. A palette colour is
//     `{ id, light?, dark?, rgb?, hex?, raw? }`, NOT `{ name, raw }`. Bricks
//     2.2 added the Style Manager, which stores the literal colour under
//     `light` / `dark` (per mode), and Bricks' own default palette ships as
//     exactly `{ light: '#f5f5f5', raw: 'var(--bricks-color-grey-100)' }`.
//     `light`/`dark` were never read, and `raw`, checked FIRST, is usually a
//     `var()` expression, which isColorValue() rejects. So even with the path
//     fixed, every default colour would still have been dropped.
//     bricksColorValue() mirrors Assets::generate_inline_css_color_vars()'s
//     precedence exactly: light/dark, then rgb overrides, then hex overrides,
//     then a literal (non-var) `raw` overrides.
//
//  3. NO `name` FIELD. Palette colours carry no name at all; the human-readable
//     token name is the CSS variable embedded in `raw`, Bricks strips `var(`/`)`
//     off it and emits that as the declaration name (assets.php:841). Falling
//     back to `slugId(value)` produced garbage ids like `-var---bricks-color-…`.
//     bricksColorName() reads the name out of `raw` the same way Bricks does,
//     dropping Bricks' internal `bricks-color-` prefix so the imported token
//     reads `grey-100` rather than shadowing Bricks' own `--bricks-color-grey-100`
//     declaration.

// `bricksData` lives on the BUILDER window. The composer panel mounts there too,
// but resolve up the frame chain anyway so a copy running inside the canvas
// iframe still finds it.
function getBricksData() {
  if (typeof window === 'undefined') return null;
  const frames = [window];
  try { if (window.parent && window.parent !== window) frames.push(window.parent); } catch (_) { /* cross-origin */ }
  try { if (window.top && frames.indexOf(window.top) === -1) frames.push(window.top); } catch (_) { /* cross-origin */ }
  for (const f of frames) {
    let bd = null;
    try { bd = f.bricksData; } catch (_) { /* cross-origin */ }
    if (bd && typeof bd === 'object') return bd;
  }
  return null;
}

// Builder bootstrap payload. Everything global (palettes, variables, classes,
// styleManager) hangs off `loadData`; the top-level keys are builder UI
// preferences. Read `loadData` first, fall back to the top level so a future
// Bricks release that promotes either key still works.
function bricksLoadData(bd) {
  return (bd && bd.loadData && typeof bd.loadData === 'object') ? bd.loadData : {};
}
function bricksList(bd, key) {
  const ld = bricksLoadData(bd);
  if (Array.isArray(ld[key])) return ld[key];
  return Array.isArray(bd && bd[key]) ? bd[key] : [];
}

// Port of Assets::generate_inline_css_color_vars()'s value precedence.
function bricksColorValue(c, darkMode) {
  let value = '';
  if (darkMode && c.dark) value = c.dark;
  else if (!darkMode && c.light) value = c.light;
  if (c.rgb) value = c.rgb;
  else if (c.hex) value = c.hex;
  const raw = String(c.raw == null ? '' : c.raw).trim();
  // A literal `raw` ("blue", "#fff", "rgb(...)") wins; a `var()` raw is a NAME,
  // not a value, see bricksColorName().
  if (raw && raw.indexOf('var(') === -1) value = raw;
  return String(value == null ? '' : value).trim();
}

// Port of the same function's CSS-variable naming.
function bricksColorName(c) {
  const raw = String(c.raw == null ? '' : c.raw).trim();
  const m = /^var\(\s*--([A-Za-z0-9_-]+)/.exec(raw);
  if (m) return m[1].replace(/^bricks-color-/, '');
  const named = String(c.name || c.label || '').trim();
  if (named) return named;
  return c.id ? `bricks-color-${c.id}` : '';
}

function readBricksGlobals() {
  const bd = getBricksData();
  if (!bd) return { available: false, colors: [], typography: [] };
  // Style Manager's default mode (Bricks 2.2+) decides whether `light` or `dark`
  // is the literal to import. NOTE: `bricksData.mode` (top level) is the builder
  // CHROME theme, a different setting entirely, only `loadData.mode` is the
  // site colour mode, so it is deliberately not part of the fallback here.
  const darkMode = String(bricksLoadData(bd).mode || 'light') === 'dark';
  const seen = new Set();
  const colors = [];
  const pushColor = (name, rawValue) => {
    const val = String(rawValue == null ? '' : rawValue).trim();
    if (!val || !isColorValue(val)) return;
    const slug = slugId(name);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    colors.push({ id: slug, title: name, value: val });
  };
  // Global color palettes: [{ id, name, colors: [{ id, light, dark, rgb, hex, raw }] }].
  bricksList(bd, 'colorPalette').forEach((p) => {
    (p && Array.isArray(p.colors) ? p.colors : []).forEach((c) => {
      if (c) pushColor(bricksColorName(c), bricksColorValue(c, darkMode));
    });
  });
  // Global CSS variables (Bricks 1.9.8+): [{ id, name, value, category }],
  // emitted by Bricks as `--{name}: {value}`. Colour-valued ones only.
  bricksList(bd, 'globalVariables').forEach((v) => {
    if (v) pushColor(String(v.name || '').trim(), v.value);
  });
  return { available: colors.length > 0, colors, typography: [] };
}

// Reduce a reconcile plan to its ADD-INTO-UICHEMY actions only. Used for the
// theme.json / Bricks syncs, which are one-directional: we never write back to
// the source, so drop addToEl / conflicts / renames (all of which would touch
// the source) and keep only the "add to UiChemy" additions.
function addOnlyPlan(plan) {
  const keepAdd = (g) => ({ addToEl: [], addToPr: g.addToPr, conflicts: [], renames: [] });
  return { colors: keepAdd(plan.colors), typography: keepAdd(plan.typography) };
}

// ── review-dialog atoms ───────────────────────────────────────────────────────
function SyncCheck({ on, indeterminate, onToggle }) {
  const active = on || indeterminate;
  return (
    <button type="button" onClick={onToggle} aria-pressed={on}
      className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-transparent hover:border-foreground')}>
      {on ? <I.check size={11} /> : indeterminate ? <span className="h-[2px] w-2 rounded-full bg-current" /> : null}
    </button>
  );
}
function SyncSeg({ value, options, onChange }) {
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-input">
      {options.map((o, i) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} title={o.title || o.label}
          className={cn('px-2 py-1 text-[11px] font-medium transition-colors', i > 0 && 'border-l border-input',
            value === o.v ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function ColorChip({ value }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      <span className="h-4 w-4 shrink-0 rounded border border-border" style={{ background: value || 'transparent' }} />
      {value}
    </span>
  );
}
// Small preview for a token: colour swatch or a typography "Ag" sample.
function TokenPreview({ kind, colorValue, typoBody }) {
  if (kind === 'colors') return <span className="h-5 w-5 shrink-0 rounded border border-border" style={{ background: colorValue || 'transparent' }} />;
  return <span style={typoPreviewStyle(typoBody || '')} className="shrink-0 text-foreground">Ag</span>;
}
function SyncSection({ title, hint, selectAll, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {selectAll && <SyncCheck on={selectAll.on} indeterminate={selectAll.indeterminate} onToggle={selectAll.onToggle} />}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex flex-col divide-y divide-border/60 rounded-md border border-border">{children}</div>
    </div>
  );
}

// Review-and-choose sync dialog. Shows every difference grouped by kind of
// action and lets the user pick per item: which additions to apply (checkbox),
// which side wins a value conflict (default skip, never silently overwrite),
// and how to resolve a probable rename (default: rename on the Elementor side to
// adopt the UiChemy name, instead of creating a duplicate).
function ElementorSyncDialog({ plan, busy, error, onCancel, onApply, source = 'elementor' }) {
  const T = I;
  const isTheme = source === 'theme';
  const isBricks = source === 'bricks';
  const srcLabel = isBricks ? 'Bricks' : isTheme ? 'theme.json' : 'Elementor';
  const SrcIcon = source === 'elementor' ? T.elementor : T.paint;
  const init = React.useMemo(() => {
    const addEl = {}, addPr = {}, conflictDir = {}, renameChoice = {};
    ['colors', 'typography'].forEach((kind) => {
      const g = plan[kind]; const pfx = kind === 'colors' ? 'c:' : 't:';
      g.addToEl.forEach((x) => { addEl[pfx + x.key] = true; });
      g.addToPr.forEach((x) => { addPr[pfx + x.key] = true; });
      g.conflicts.forEach((x) => { conflictDir[pfx + x.key] = 'skip'; });
      g.renames.forEach((x) => { renameChoice[pfx + x.pr.key] = 'rename'; });
    });
    return { addEl, addPr, conflictDir, renameChoice };
  }, [plan]);
  const [sel, setSel] = React.useState(init);
  React.useEffect(() => { setSel(init); }, [init]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  if (typeof document === 'undefined' || !document.body) return null;
  // Scope OFF the canvas-toolbar host (see the note above / other lookup site).
  const composerHost = document.querySelector('.uich-composer-host:not(.uich-canvas-toolbar-host)');
  const theme = composerHost && composerHost.classList.contains('dark') ? 'dark' : 'light';
  const host = ensurePortalRoot(document, theme);

  const total = planCount(plan);
  const nothing = total === 0;
  const kinds = ['colors', 'typography'];
  const rows = (grp) => kinds.flatMap((kind) => plan[kind][grp].map((item) => ({ kind, pfx: kind === 'colors' ? 'c:' : 't:', item })));
  const addElRows = rows('addToEl');
  const addPrRows = rows('addToPr');
  const conflictRows = rows('conflicts');
  const renameRows = rows('renames');

  const toggle = (mapKey, rowKey) => setSel((s) => ({ ...s, [mapKey]: { ...s[mapKey], [rowKey]: !s[mapKey][rowKey] } }));
  const setDir = (rowKey, v) => setSel((s) => ({ ...s, conflictDir: { ...s.conflictDir, [rowKey]: v } }));
  const setRen = (rowKey, v) => setSel((s) => ({ ...s, renameChoice: { ...s.renameChoice, [rowKey]: v } }));

  // Select/deselect-all for an add group (checkbox in the section header).
  const allSel  = (mapKey, rws) => rws.length > 0 && rws.every((r) => sel[mapKey][r.pfx + r.item.key]);
  const someSel = (mapKey, rws) => rws.some((r) => sel[mapKey][r.pfx + r.item.key]);
  const toggleAll = (mapKey, rws) => {
    const target = !allSel(mapKey, rws);
    setSel((s) => { const m = { ...s[mapKey] }; rws.forEach((r) => { m[r.pfx + r.item.key] = target; }); return { ...s, [mapKey]: m }; });
  };
  const selectAllFor = (mapKey, rws) => ({ on: allSel(mapKey, rws), indeterminate: !allSel(mapKey, rws) && someSel(mapKey, rws), onToggle: () => toggleAll(mapKey, rws) });

  const rowCls = 'flex items-center gap-2.5 px-3 py-2';

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)' }} onMouseDown={() => { if (!busy) onCancel(); }}>
      <div className="flex max-h-[86vh] w-[min(600px,95vw)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <SrcIcon size={16} />
          <span className="text-sm font-semibold text-foreground">{isBricks ? 'Sync from Bricks colors' : isTheme ? 'Sync from theme.json' : 'Sync with Elementor Globals'}</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-[13px] text-foreground">
          {error ? null : nothing ? (
            <p className="text-muted-foreground">{isBricks ? 'Every Bricks colour is already in your Globals. There is nothing to add.' : isTheme ? 'Every theme.json colour is already in your Globals. There is nothing to add.' : 'UiChemy and Elementor globals are already in sync. There is nothing to reconcile.'}</p>
          ) : (
            <>
              {addElRows.length > 0 && (
                <SyncSection title="Add to Elementor" hint="from UiChemy" selectAll={selectAllFor('addEl', addElRows)}>
                  {addElRows.map(({ kind, pfx, item }) => {
                    const rk = pfx + item.key;
                    return (
                      <label key={rk} className={cn(rowCls, 'cursor-pointer')}>
                        <SyncCheck on={!!sel.addEl[rk]} onToggle={() => toggle('addEl', rk)} />
                        <TokenPreview kind={kind} colorValue={item.value} typoBody={item.body} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{kind === 'colors' ? item.name : item.name}</span>
                        {kind === 'colors' && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.value}</span>}
                      </label>
                    );
                  })}
                </SyncSection>
              )}

              {addPrRows.length > 0 && (
                <SyncSection title="Add to UiChemy" hint={`from ${srcLabel}`} selectAll={selectAllFor('addPr', addPrRows)}>
                  {addPrRows.map(({ kind, pfx, item }) => {
                    const rk = pfx + item.key;
                    return (
                      <label key={rk} className={cn(rowCls, 'cursor-pointer')}>
                        <SyncCheck on={!!sel.addPr[rk]} onToggle={() => toggle('addPr', rk)} />
                        <TokenPreview kind={kind} colorValue={item.value} typoBody={kind === 'typography' ? elTypoToBody(item.stripped) : ''} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{kind === 'colors' ? item.name : item.name}</span>
                        {kind === 'colors' && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.value}</span>}
                      </label>
                    );
                  })}
                </SyncSection>
              )}

              {conflictRows.length > 0 && (
                <SyncSection title="Value updates" hint="same name, different values">
                  {conflictRows.map(({ kind, pfx, item }) => {
                    const rk = pfx + item.key;
                    const dir = sel.conflictDir[rk] || 'skip';
                    return (
                      <div key={rk} className={cn(rowCls, 'flex-wrap')}>
                        <TokenPreview kind={kind} colorValue={item.prValue} typoBody={item.prBody} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{kind === 'colors' ? item.name : item.name}</span>
                        {kind === 'colors' && (
                          <span className="flex shrink-0 items-center gap-2 text-[11px]">
                            <ColorChip value={item.prValue} />
                            <span className="text-muted-foreground">vs</span>
                            <ColorChip value={item.elValue} />
                          </span>
                        )}
                        <SyncSeg value={dir} onChange={(v) => setDir(rk, v)} options={[
                          { v: 'toEl', label: "Use UiChemy's", title: 'Update Elementor to use the UiChemy value' },
                          { v: 'skip', label: 'Skip' },
                          { v: 'toPr', label: "Use Elementor's", title: 'Update UiChemy to use the Elementor value' },
                        ]} />
                      </div>
                    );
                  })}
                </SyncSection>
              )}

              {renameRows.length > 0 && (
                <SyncSection title="Possible renames" hint="same value, different name">
                  {renameRows.map(({ kind, pfx, item }) => {
                    const rk = pfx + item.pr.key;
                    const choice = sel.renameChoice[rk] || 'rename';
                    const prName = kind === 'colors' ? item.pr.name : item.pr.name;
                    const elName = item.el.title;
                    return (
                      <div key={rk} className={cn(rowCls, 'flex-wrap')}>
                        <TokenPreview kind={kind} colorValue={kind === 'colors' ? item.pr.value : ''} typoBody={kind === 'typography' ? item.pr.body : ''} />
                        <span className="min-w-0 flex-1 truncate text-[12px]">
                          <span className="font-mono text-muted-foreground line-through">{elName}</span>
                          <span className="px-1 text-muted-foreground">→</span>
                          <span className="font-mono text-foreground">{prName}</span>
                        </span>
                        <SyncSeg value={choice} onChange={(v) => setRen(rk, v)} options={[
                          { v: 'rename', label: 'Rename', title: `Rename the Elementor token to "${prName}"` },
                          { v: 'separate', label: 'Keep both', title: 'Treat as two separate tokens' },
                          { v: 'skip', label: 'Skip' },
                        ]} />
                      </div>
                    );
                  })}
                </SyncSection>
              )}

              {conflictRows.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Value updates default to skip so nothing is updated unless you choose which value to use.
                </p>
              )}
            </>
          )}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" disabled={busy} onClick={onCancel}
            className="inline-flex h-8 items-center rounded-md border border-input bg-transparent px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy || nothing} onClick={() => onApply(sel)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
            {busy ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}

// ── panel ──────────────────────────────────────────────────────────────────────
/**
 * Import preview. Shows what the chosen file would do BEFORE it does it, and
 * makes Merge vs Replace an explicit choice — the whole point being that a kit
 * import must never quietly wipe globals the user already has.
 */
function GlobalsImportDialog({ plan, fileName, mode, onMode, busy, error, onCancel, onApply }) {
  const T = I;
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  if (typeof document === 'undefined' || !document.body) return null;
  // Scope OFF the canvas-toolbar host (see the other lookup sites in this file).
  const composerHost = document.querySelector('.uich-composer-host:not(.uich-canvas-toolbar-host)');
  const theme = composerHost && composerHost.classList.contains('dark') ? 'dark' : 'light';
  const host = ensurePortalRoot(document, theme);

  const isReplace = mode === 'replace';
  const rows = isReplace
    ? [
      { label: 'Variables in the file', n: plan.varsAdd.length + plan.varsUpdate.length + plan.varsSame.length },
      { label: 'Classes in the file',   n: plan.clsAdd.length + plan.clsUpdate.length + plan.clsSame.length },
      { label: 'Yours that will be removed', n: plan.varsDropped.length + plan.clsDropped.length, warn: true },
    ]
    : [
      { label: 'New variables added',    n: plan.varsAdd.length },
      { label: 'Existing values updated', n: plan.varsUpdate.length },
      { label: 'Already identical',      n: plan.varsSame.length, muted: true },
      { label: 'Classes added / updated', n: plan.clsAdd.length + plan.clsUpdate.length },
      { label: 'New collections',        n: plan.colsAdd.length, muted: true },
    ];

  const nothing = !isReplace
    && plan.varsAdd.length === 0 && plan.varsUpdate.length === 0
    && plan.clsAdd.length === 0 && plan.clsUpdate.length === 0;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)' }} onMouseDown={() => { if (!busy) onCancel(); }}>
      <div className="flex max-h-[86vh] w-[min(520px,95vw)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <T.upload size={16} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Import globals</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 text-[13px] text-foreground">
          {fileName && (
            <p className="truncate text-[12px] text-muted-foreground">
              From <span className="font-mono text-foreground">{fileName}</span>
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">How to apply</span>
            <div className="flex gap-1.5">
              {[
                { v: 'merge',   label: 'Merge',   hint: 'Add and update from the file. Nothing of yours is removed.' },
                { v: 'replace', label: 'Replace', hint: 'Your globals become exactly what the file contains.' },
              ].map((o) => (
                <button key={o.v} type="button" onClick={() => onMode(o.v)} disabled={busy} title={o.hint}
                  className={cn(
                    'flex-1 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-50',
                    mode === o.v ? 'border-primary bg-primary/10' : 'border-input bg-transparent hover:bg-accent',
                  )}>
                  <span className="block text-[12px] font-semibold text-foreground">{o.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            {rows.map((r, i) => (
              <div key={r.label} className={cn('flex items-center gap-2.5 px-3 py-2', i > 0 && 'border-t border-border')}>
                <span className={cn('min-w-0 flex-1 text-[12px]', r.muted ? 'text-muted-foreground' : 'text-foreground')}>{r.label}</span>
                <span className={cn(
                  'shrink-0 rounded px-1.5 text-[11px] font-semibold tabular-nums',
                  r.warn && r.n > 0 ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
                )}>{r.n}</span>
              </div>
            ))}
          </div>

          {isReplace && (plan.varsDropped.length + plan.clsDropped.length) > 0 && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
              Replace cannot be undone from here. {plan.varsDropped.length + plan.clsDropped.length} of your own entries are not in this file and will be removed — export first if you want a copy.
            </p>
          )}
          {nothing && <p className="text-muted-foreground">This file matches your globals exactly. Merging would change nothing.</p>}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" disabled={busy} onClick={onCancel}
            className="inline-flex h-8 items-center rounded-md border border-input bg-transparent px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy || (nothing && !isReplace)} onClick={onApply}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
            {busy ? 'Importing…' : isReplace ? 'Replace globals' : 'Merge into globals'}
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}

export function VariablesPanel() {
  const [vars, setVars]                 = React.useState([]);
  const [blockClasses, setBlockClasses] = React.useState([]);
  const [collections, setCollections]   = React.useState([]);
  const [preserved, setPreserved]       = React.useState([]);
  const [loading, setLoading]           = React.useState(true);
  const [loadOk, setLoadOk]             = React.useState(false);
  const [status, setStatus]             = React.useState('');
  const [activeCol, setActiveCol]       = React.useState('');
  const [open, setOpen]                 = React.useState(false);
  const [expandedClass, setExpandedClass] = React.useState(null); // typography row being edited
  const [syncPlan, setSyncPlan]     = React.useState(null);        // pending sync plan (null = closed)
  const [syncBusy, setSyncBusy]     = React.useState(false);
  const [syncError, setSyncError]   = React.useState('');
  const [syncSource, setSyncSource] = React.useState('elementor'); // 'elementor' | 'theme' | 'bricks', which sync is open
  const [importPlan, setImportPlan]   = React.useState(null);      // pending import preview (null = closed)
  const [importCss, setImportCss]     = React.useState('');        // the chosen file's globals CSS
  const [importName, setImportName]   = React.useState('');
  const [importMode, setImportMode]   = React.useState('merge');   // 'merge' | 'replace'
  const [importBusy, setImportBusy]   = React.useState(false);
  const [importError, setImportError] = React.useState('');
  const fileInputRef = React.useRef(null);
  const saveTimer = React.useRef(null);

  // Single source of truth: the #uichemy-globals block inside the site head code.
  // The widget setting is the live value once anything edits it; before that it
  // can read empty on a cold load, so we fall back to the server cfg snapshot.
  const [head, setHead] = useWidgetSetting('site_custom_code_head');
  const [siteFooter]    = useWidgetSetting('site_custom_code_footer');
  const cfgSite       = readCfgSiteCode();
  // Pick the head source that actually carries the #uichemy-globals block, not
  // merely the first non-empty one. Otherwise a widget head holding unrelated
  // markup (e.g. a Google-Fonts link) but no block would shadow the authoritative
  // cfg snapshot, seed 0 tokens, and let the next save clobber the real globals.
  const widgetHead     = (head && head.trim()) ? head : '';
  const cfgHead        = (cfgSite.head && cfgSite.head.trim()) ? cfgSite.head : '';
  const effectiveHead   = extractGlobalsCss(widgetHead) ? widgetHead
                        : extractGlobalsCss(cfgHead) ? cfgHead
                        : (widgetHead || cfgHead);
  const effectiveFooter = (siteFooter && siteFooter.trim()) ? siteFooter : cfgSite.footer;
  const blockCss   = React.useMemo(() => extractGlobalsCss(effectiveHead || ''), [effectiveHead]);
  const lastCssRef = React.useRef(null);
  const stateRef   = React.useRef({ vars: [], collections: [], classes: [] });
  stateRef.current = { vars, collections, classes: blockClasses };

  // Seed from the block whenever it changes externally (the "Before </head>"
  // editor, an AI write present at load, or first mount), ignore our own echo.
  React.useEffect(() => {
    if (blockCss === lastCssRef.current) return;
    lastCssRef.current = blockCss;
    const model = parseGlobalsCss(blockCss);
    const items = tokensToItems(model.tokens);
    const cols = model.collections.length ? model.collections : (items.length ? [DEFAULT_COLLECTION] : []);
    setVars(items);
    setBlockClasses(classesToRows(model.classes));
    setCollections(cols);
    setPreserved(model.preserved || []);
    setLoadOk(true);
    setLoading(false);
    primeUiChemyGlobals(items.map(({ _k, ...rest }) => rest));
    primeUiChemyGlobalClasses(model.classes);
    applyGlobalsCss(blockCss);
    setActiveCol((cur) => (cur === 'cls-typo' || cur === 'cls-other' || cols.includes(cur)) ? cur : (cols[0] || ''));
  }, [blockCss]);

  // `nextPreserved` is passed explicitly by the import path: it sets preserved
  // and schedules the write in the SAME tick, so reading it off state here would
  // serialise the pre-import raw blocks.
  const persist = React.useCallback((nextVars, nextCols, nextClasses, nextPreserved) => {
    if (!loadOk) { return; }
    const keepPreserved = (nextPreserved === undefined) ? preserved : nextPreserved;
    setStatus('Saving…');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const clean = nextVars.map(({ _k, ...rest }) => rest);
      primeUiChemyGlobals(clean);
      const cleanClasses = (nextClasses || []).map(({ _k, ...rest }) => rest);
      primeUiChemyGlobalClasses(cleanClasses);
      const css = itemsToCss(clean, nextCols, keepPreserved, nextClasses);
      lastCssRef.current = css.trim();                              // mark as ours → skip re-seed echo
      const nextHead = upsertGlobalsBlock(effectiveHead || '', css); // splice into site head, preserve everything else
      setHead(nextHead);
      writeCfgSiteHead(nextHead);                                   // keep the cfg fallback snapshot fresh
      propagateComposerSetting('site_custom_code_head', nextHead);
      saveSharedSiteCustomCodeDebounced(nextHead, effectiveFooter || '');
      applyGlobalsCss(css);
      setStatus('Saved ✓');
      setTimeout(() => setStatus((s) => (s === 'Saved ✓' ? '' : s)), 1200);
    }, 400);
  }, [loadOk, effectiveHead, effectiveFooter, setHead, preserved]);

  const updateVars    = React.useCallback((next) => { setVars(next); persist(next, stateRef.current.collections, stateRef.current.classes); }, [persist]);
  const updateCols    = React.useCallback((next) => { setCollections(next); persist(stateRef.current.vars, next, stateRef.current.classes); }, [persist]);
  const updateClasses = React.useCallback((next) => { setBlockClasses(next); persist(stateRef.current.vars, stateRef.current.collections, next); }, [persist]);

  /* ── Export / import ─────────────────────────────────────────────────────
     Both run entirely on the block that is already in state, so an export is
     exactly what the editor is showing and an import lands through the SAME
     persist() every other edit uses — no second write path to the site head. */

  const exportGlobals = React.useCallback(() => {
    const clean = vars.map(({ _k, ...rest }) => rest);
    const css = itemsToCss(clean, collections, preserved, blockClasses);
    const file = buildExportFile(css, {
      variables: clean.length,
      collections: collections.length,
      classes: (blockClasses || []).length,
    });
    try {
      const blob = new Blob([file], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `uichemy-globals-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoked on the next tick, not immediately: Safari cancels an in-flight
      // download if the blob URL is released synchronously after click().
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }, 0);
      setStatus('Globals exported');
      setTimeout(() => setStatus((st) => (st === 'Globals exported' ? '' : st)), 1600);
    } catch (e) {
      setStatus('Export failed');
    }
  }, [vars, collections, preserved, blockClasses]);

  const onImportFile = React.useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const css = readImportFile(reader.result);
        const model = parseGlobalsCss(css);
        const imported = {
          vars: tokensToItems(model.tokens).map(({ _k, ...rest }) => rest),
          collections: model.collections.length ? model.collections : [DEFAULT_COLLECTION],
          classes: classesToRows(model.classes).map(({ _k, ...rest }) => rest),
          preserved: model.preserved || [],
        };
        if (!imported.vars.length && !imported.classes.length) {
          setImportError('');
          setStatus('That file has no globals in it');
          setTimeout(() => setStatus((st) => (st.indexOf('no globals') !== -1 ? '' : st)), 2400);
          return;
        }
        const current = {
          vars: vars.map(({ _k, ...rest }) => rest),
          collections,
          classes: (blockClasses || []).map(({ _k, ...rest }) => rest),
          preserved,
        };
        setImportCss(css);
        setImportMode('merge');
        setImportError('');
        setImportPlan(planGlobalsImport(current, imported));
      } catch (err) {
        setImportCss('');
        setImportPlan(null);
        setStatus((err && err.message) ? err.message : 'Could not read that file');
        setTimeout(() => setStatus(''), 3200);
      }
    };
    reader.onerror = () => { setStatus('Could not read that file'); setTimeout(() => setStatus(''), 2400); };
    reader.readAsText(file);
  }, [vars, collections, blockClasses, preserved]);

  const applyImport = React.useCallback(() => {
    setImportBusy(true);
    setImportError('');
    try {
      const model = parseGlobalsCss(importCss);
      const imported = {
        vars: tokensToItems(model.tokens).map(({ _k, ...rest }) => rest),
        collections: model.collections.length ? model.collections : [DEFAULT_COLLECTION],
        classes: classesToRows(model.classes).map(({ _k, ...rest }) => rest),
        preserved: model.preserved || [],
      };
      const current = {
        vars: vars.map(({ _k, ...rest }) => rest),
        collections,
        classes: (blockClasses || []).map(({ _k, ...rest }) => rest),
        preserved,
      };
      const next = applyGlobalsImport(importMode, current, imported);
      const nextVars = next.vars.map((v) => (v._k ? v : { ...v, _k: genKey() }));
      const nextClasses = next.classes.map((c) => (c._k ? c : { ...c, _k: genKey() }));
      // preserved is not part of persist()'s arguments — it is read from state —
      // so it has to be set before the write is scheduled.
      setPreserved(next.preserved);
      setVars(nextVars);
      setBlockClasses(nextClasses);
      setCollections(next.collections);
      setActiveCol((cur) => (next.collections.includes(cur) ? cur : (next.collections[0] || '')));
      persist(nextVars, next.collections, nextClasses, next.preserved);
      setImportPlan(null);
      setImportCss('');
      setImportName('');
      setStatus(importMode === 'replace' ? 'Globals replaced' : 'Globals merged');
      setTimeout(() => setStatus((st) => (st === 'Globals replaced' || st === 'Globals merged' ? '' : st)), 1800);
    } catch (err) {
      setImportError((err && err.message) ? err.message : 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  }, [importCss, importMode, vars, collections, blockClasses, preserved, persist]);

  // variable CRUD
  function setVarField(k, key, val) {
    updateVars(vars.map((v) => (v._k === k ? { ...v, [key]: key === 'id' ? slugId(val) : val } : v)));
  }
  function addVar(collection) { updateVars([...vars, { _k: genKey(), id: genVarId(), value: '', collection }]); }
  function delVar(k) { updateVars(vars.filter((v) => v._k !== k)); }
  function copyVar(id) { try { navigator.clipboard.writeText(`var(--${id})`); setStatus(`Copied var(--${id})`); } catch (e) { /* noop */ } }

  // collection CRUD
  function addCollection() {
    // Capped per build; past the cap the module decides what to show instead.
    if (!allowOrUpsell(collections.length, LIMITS.collections, globalsUpsell('collections'))) { return; }
    let base = 'Collection', n = collections.length + 1, name = `${base} ${n}`;
    while (collections.includes(name)) { n += 1; name = `${base} ${n}`; }
    updateCols([...collections, name]);
    setActiveCol(name);
  }
  function renameCollection(oldName, newName) {
    const cols = collections.map((c) => (c === oldName ? newName : c));
    const nv = vars.map((v) => ((v.collection || DEFAULT_COLLECTION) === oldName ? { ...v, collection: newName } : v));
    setCollections(cols); setVars(nv); persist(nv, cols, stateRef.current.classes);
    if (activeCol === oldName) setActiveCol(newName);
  }
  function delCollection(name) {
    const cols = collections.filter((c) => c !== name);
    const nv = vars.filter((v) => (v.collection || DEFAULT_COLLECTION) !== name);
    setCollections(cols); setVars(nv); persist(nv, cols, stateRef.current.classes);
    if (activeCol === name) setActiveCol(cols[0] || '');
  }

  // class CRUD
  function setClassField(k, key, val) { updateClasses(blockClasses.map((c) => (c._k === k ? { ...c, [key]: val } : c))); }
  function delClass(k) { updateClasses(blockClasses.filter((c) => c._k !== k)); }
  function copyClass(id) { try { navigator.clipboard.writeText(id); setStatus(`Copied ${id}`); } catch (e) { /* noop */ } }
  function addClass(bucket) {
    const isTypo = bucket === 'typography';
    // Typography and component classes are capped separately per build.
    const count = blockClasses.filter((c) => (isTypo ? c.kind === 'typography' : c.kind !== 'typography')).length;
    const limit = isTypo ? LIMITS.typo : LIMITS.other;
    if (!allowOrUpsell(count, limit, globalsUpsell(isTypo ? 'typo' : 'other'))) { return; }
    updateClasses([...blockClasses, {
      _k: genKey(),
      kind: isTypo ? 'typography' : 'component',
      selector: isTypo ? '.text-new' : '.pr-new',
      body: isTypo ? 'font-family: var(--font-body);\nfont-size: 16px;\nline-height: 1.5;' : 'padding: var(--gap-sm) var(--gap-lg);\nborder-radius: var(--radius);',
    }]);
  }

  // ── Elementor sync ────────────────────────────────────────────────────────
  // Read the kit globals, reconcile against the current block, open the review
  // dialog so the user can choose per item what to add / which side wins.
  function openElementorSync() {
    setSyncError('');
    setSyncSource('elementor');
    setSyncBusy(true);
    setSyncPlan(EMPTY_RECONCILE_PLAN);
    const base = getRestApiBaseUrl();
    const nonce = getRestNonce();
    fetch(`${base}/uichemy/v1/elementor-globals`, { credentials: 'same-origin', headers: nonce ? { 'X-WP-Nonce': nonce } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('request failed'))))
      .then((d) => {
        if (!d || !d.available) {
          setSyncError('Elementor is not active on this site, so its globals can’t be synced.');
          setSyncBusy(false);
          return;
        }
        const uichemy = {
          colors: vars.filter((v) => isColorValue(v.value)).map((v) => ({ id: v.id, value: v.value })),
          typo:   blockClasses.filter((c) => c.kind === 'typography').map((c) => ({ selector: c.selector, body: c.body })),
        };
        setSyncPlan(computeReconcilePlan(uichemy, { colors: d.colors || [], typography: d.typography || [] }));
        setSyncBusy(false);
      })
      .catch(() => { setSyncError('Couldn’t read Elementor globals. Please try again.'); setSyncBusy(false); });
  }

  // Gutenberg equivalent of openElementorSync: read the site's theme.json colour
  // palette and reconcile it against the block, add-only (theme.json → Globals).
  // Runs synchronously off wp.data, no REST round-trip, then opens the same
  // review dialog so the user picks which colours to bring in.
  function openThemeSync() {
    setSyncError('');
    setSyncSource('theme');
    setSyncBusy(false);
    const theme = readThemeJsonGlobals();
    if (!theme.available) {
      setSyncPlan(EMPTY_RECONCILE_PLAN);
      setSyncError('Couldn’t read a theme.json colour palette from the block editor. Make sure the site uses a block theme with a palette defined.');
      return;
    }
    const uichemy = {
      colors: vars.filter((v) => isColorValue(v.value)).map((v) => ({ id: v.id, value: v.value })),
      typo: [],
    };
    const full = computeReconcilePlan(uichemy, { colors: theme.colors, typography: [] });
    setSyncPlan(addOnlyPlan(full));
  }

  // Bricks equivalent of openThemeSync: read Bricks' global colours and
  // reconcile them against the block, add-only (Bricks → Globals). Runs
  // synchronously off window.bricksData, then opens the same review dialog.
  function openBricksSync() {
    setSyncError('');
    setSyncSource('bricks');
    setSyncBusy(false);
    const bricks = readBricksGlobals();
    if (!bricks.available) {
      setSyncPlan(EMPTY_RECONCILE_PLAN);
      setSyncError('Couldn’t read a Bricks colour palette. Open this in the Bricks editor with global colors defined.');
      return;
    }
    const uichemy = {
      colors: vars.filter((v) => isColorValue(v.value)).map((v) => ({ id: v.id, value: v.value })),
      typo: [],
    };
    const full = computeReconcilePlan(uichemy, { colors: bricks.colors, typography: [] });
    setSyncPlan(addOnlyPlan(full));
  }

  // Apply the user's per-item choices: batch every Elementor-side write into one
  // REST call (+ mirror into the live kit), and fold every UiChemy-side change
  // into one block save.
  function applyElementorSync(sel) {
    const plan = syncPlan;
    if (!plan || !sel) return;
    setSyncBusy(true);
    setSyncError('');

    const base = getRestApiBaseUrl();
    const nonce = getRestNonce();
    const headers = { 'Content-Type': 'application/json' };
    if (nonce) headers['X-WP-Nonce'] = nonce;

    const elColors = [], elTypo = [], liveColorRows = [], liveTypoRows = [];
    const addElColor = (id, title, value) => { elColors.push({ id, title, value }); liveColorRows.push({ _id: id, title, color: value }); };
    const addElTypo  = (id, title, valueMap) => { elTypo.push({ id, title, value: valueMap }); liveTypoRows.push({ _id: id, title, ...valueMap }); };

    let nextVars = [...vars], nextClasses = [...blockClasses], nextCols = collections.slice();
    let prChanged = false;
    const colorCollection = () => {
      // Prefer a collection that already holds colours; then a conventionally
      // named one; only then create 'Colors'. (Don't fall back to nextCols[0],
      // which could be a typography/other collection and mis-file the colour.)
      let col = nextCols.find((c) => nextVars.some((v) => (v.collection || DEFAULT_COLLECTION) === c && isColorValue(v.value)));
      if (!col) col = nextCols.find((c) => c === 'Colors' || c === DEFAULT_COLLECTION);
      if (!col) { col = 'Colors'; nextCols = [...nextCols, col]; }
      return col;
    };
    const putPrColor = (name, value) => {
      const key = slugId(name);
      if (nextVars.some((v) => slugId(v.id) === key)) nextVars = nextVars.map((v) => (slugId(v.id) === key ? { ...v, value } : v));
      else nextVars = [...nextVars, { _k: genKey(), id: key, value, collection: colorCollection() }];
      prChanged = true;
    };
    const putPrTypo = (baseName, bodyCss) => {
      const s = '.text-' + baseName;
      if (nextClasses.some((c) => c.selector === s)) nextClasses = nextClasses.map((c) => (c.selector === s ? { ...c, body: bodyCss } : c));
      else nextClasses = [...nextClasses, { _k: genKey(), kind: 'typography', selector: s, body: bodyCss }];
      prChanged = true;
    };

    // ---- colours ----
    const gc = plan.colors;
    gc.addToEl.forEach((x) => { if (sel.addEl['c:' + x.key]) addElColor(elGlobalId('c:' + slugId(x.name)), x.name, x.value); });
    gc.addToPr.forEach((x) => { if (sel.addPr['c:' + x.key]) putPrColor(x.name, x.value); });
    gc.conflicts.forEach((x) => {
      const d = sel.conflictDir['c:' + x.key] || 'skip';
      if (d === 'toEl') addElColor(x.elId, x.elTitle, x.prValue);
      else if (d === 'toPr') putPrColor(x.name, x.elValue);
    });
    gc.renames.forEach((x) => {
      const ch = sel.renameChoice['c:' + x.pr.key] || 'rename';
      if (ch === 'rename') addElColor(x.el.elId, x.pr.name, x.el.value);            // adopt UiChemy name on the kit token
      else if (ch === 'separate') { addElColor(elGlobalId('c:' + slugId(x.pr.name)), x.pr.name, x.pr.value); putPrColor(x.el.name, x.el.value); }
    });

    // ---- typography ----
    const gt = plan.typography;
    gt.addToEl.forEach((x) => { if (sel.addEl['t:' + x.key]) addElTypo(elGlobalId('t:' + x.base), 'text-' + x.base, bodyToElTypo(x.body)); });
    gt.addToPr.forEach((x) => { if (sel.addPr['t:' + x.key]) putPrTypo(x.base, elTypoToBody(x.stripped)); });
    gt.conflicts.forEach((x) => {
      const d = sel.conflictDir['t:' + x.key] || 'skip';
      if (d === 'toEl') addElTypo(x.elId, x.elTitle, bodyToElTypo(x.prBody));
      else if (d === 'toPr') putPrTypo(x.base, elTypoToBody(x.elStripped));
    });
    gt.renames.forEach((x) => {
      const ch = sel.renameChoice['t:' + x.pr.key] || 'rename';
      if (ch === 'rename') addElTypo(x.el.elId, 'text-' + x.pr.base, bodyToElTypo(x.pr.body));
      else if (ch === 'separate') { addElTypo(elGlobalId('t:' + x.pr.base), 'text-' + x.pr.base, bodyToElTypo(x.pr.body)); putPrTypo(x.el.base, elTypoToBody(x.el.stripped)); }
    });

    const pushToElementor = () => {
      if (!elColors.length && !elTypo.length) return Promise.resolve();
      return fetch(`${base}/uichemy/v1/elementor-globals/sync`, {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ colors: elColors, typography: elTypo }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('sync failed'))))
        .then(() => {
          try { upsertKitGlobalsLive(liveColorRows, liveTypoRows); } catch (_) { /* editor may be absent */ }
          try { refreshElementorGlobalsPanel(); } catch (_) { /* noop */ }
        });
    };

    pushToElementor()
      .then(() => {
        if (prChanged) {
          setVars(nextVars);
          setCollections(nextCols);
          setBlockClasses(nextClasses);
          persist(nextVars, nextCols, nextClasses);
        }
        setSyncBusy(false);
        setSyncPlan(null);
        setStatus(syncSource === 'theme' ? 'Synced from theme.json ✓' : syncSource === 'bricks' ? 'Synced from Bricks ✓' : 'Synced with Elementor ✓');
        setTimeout(() => setStatus((s) => (/Elementor|theme\.json|sync/i.test(s) ? '' : s)), 1600);
      })
      .catch(() => { setSyncError('Sync failed while writing to Elementor. Please try again.'); setSyncBusy(false); });
  }

  // ── renderers ─────────────────────────────────────────────────────────────
  function renderVarValue(v) {
    return <ValueCell value={v.value || ''} onChange={(nv) => setVarField(v._k, 'value', nv)} />;
  }

  function renderVarRow(v) {
    return (
      <tr key={v._k} className="border-b border-border/60 align-middle last:border-0">
        <td className="w-[42%] px-3 py-2">
          <GInput value={v.id || ''} placeholder="brand" mono prefix="--"
            onChange={(e) => setVarField(v._k, 'id', e.target.value)}
            title="CSS variable name, emitted as var(--name)" />
        </td>
        {/* `var-value-cell` is what composer.css hangs the wider left padding on,
            so the hex code clears the colour swatch instead of sitting flush
            against it. The rule existed but this class was never rendered, so it
            had been dead the whole time. */}
        <td className="px-3 py-2"><div className="var-value-cell min-w-0">{renderVarValue(v)}</div></td>
        <td className="w-[1%] whitespace-nowrap px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            <button type="button" title="Copy var(--id)" className={ICON_BTN_CLS} onClick={() => copyVar(v.id)}><I.copy size={13} /></button>
            <button type="button" title="Delete variable" className={cn(ICON_BTN_CLS, 'hover:border-destructive hover:text-destructive')} onClick={() => delVar(v._k)}><I.trash size={13} /></button>
          </div>
        </td>
      </tr>
    );
  }

  function renderCollection(name) {
    const its = vars.filter((v) => (v.collection || DEFAULT_COLLECTION) === name);
    const Ic = iconForCollection(name);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Ic size={15} /></span>
          <input type="text" value={name} onChange={(e) => renameCollection(name, e.target.value)} placeholder="Collection name"
            aria-label="Collection name" title="Rename this collection"
            className="-mx-1 min-w-0 flex-1 rounded px-1 bg-transparent text-[13px] font-semibold leading-tight text-foreground outline-none transition-colors hover:bg-accent/40 focus:bg-accent/60" />
          <button type="button" className={cn(ICON_BTN_CLS, 'hover:border-destructive hover:text-destructive')} title="Delete collection (and its variables)" onClick={() => delCollection(name)}><I.trash size={13} /></button>
        </div>

        {its.length === 0 ? (
          <div className="rounded-lg border border-dashed border-input px-3 py-8 text-center text-xs text-muted-foreground">No variables yet. Add your first below.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Variable</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>{its.map(renderVarRow)}</tbody>
            </table>
          </div>
        )}

        <button type="button" onClick={() => addVar(name)} className={ADD_BTN_CLS}><I.plus size={13} /> Add variable</button>
      </div>
    );
  }

  function classHeader(Ic, title, hint) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Ic size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight text-foreground">{title}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
      </div>
    );
  }

  // Typography classes: a table (name · live preview · edit/copy/delete); the
  // Edit button expands an Elementor-like typography controller for that class.
  function renderTypographyClasses() {
    const list = blockClasses.filter((c) => c.kind === 'typography');
    return (
      <div className="flex flex-col gap-3">
        {classHeader(I.type, 'Typography Classes', 'Any class that sets font or text properties (e.g. .text-h1). Edit font, size, weight, line-height and more.')}
        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-input px-3 py-8 text-center text-xs text-muted-foreground">No typography classes yet. Add one below.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Preview</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const openEd = expandedClass === c._k;
                  return (
                    <React.Fragment key={c._k}>
                      <tr className="border-b border-border/60 align-middle last:border-0">
                        <td className="w-[36%] px-3 py-2">
                          <GInput value={c.selector || ''} placeholder=".text-h1" mono
                            onChange={(e) => setClassField(c._k, 'selector', e.target.value)}
                            title="Class selector. Apply it to any element." />
                        </td>
                        <td className="px-3 py-2">
                          <span style={typoPreviewStyle(c.body)} className="text-foreground">Ag</span>
                        </td>
                        <td className="w-[1%] whitespace-nowrap px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" title={openEd ? 'Close editor' : 'Edit typography'} className={cn(ICON_BTN_CLS, openEd && 'border-primary text-primary')} onClick={() => setExpandedClass(openEd ? null : c._k)}><I.pencil size={13} /></button>
                            <button type="button" title="Copy class name" className={ICON_BTN_CLS} onClick={() => copyClass(String(c.selector || '').replace(/^\./, ''))}><I.copy size={13} /></button>
                            <button type="button" title="Delete class" className={cn(ICON_BTN_CLS, 'hover:border-destructive hover:text-destructive')} onClick={() => delClass(c._k)}><I.trash size={13} /></button>
                          </div>
                        </td>
                      </tr>
                      {openEd && (
                        <tr>
                          <td colSpan={3} className="p-0">
                            <TypographyEditor body={c.body || ''} onBody={(b) => setClassField(c._k, 'body', b)} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" onClick={() => addClass('typography')} className={ADD_BTN_CLS}>
          <I.plus size={13} /> Add typography class
          {list.length >= LIMITS.typo && <ProBadge small />}
        </button>
      </div>
    );
  }

  // Other (component) classes: a plain raw-CSS editor per class, as before.
  function renderOtherClasses() {
    const list = blockClasses.filter((c) => c.kind !== 'typography');
    return (
      <div className="flex flex-col gap-3">
        {classHeader(I.variable, 'Other Classes', 'Any reusable class without text styling (e.g. .pr-card). Buttons, cards, containers and more.')}
        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-input px-3 py-8 text-center text-xs text-muted-foreground">No component classes yet. Add one below.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((c) => (
              <div key={c._k} className="rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
                  <I.variable size={13} className="shrink-0 text-muted-foreground" />
                  <input type="text" value={c.selector || ''} placeholder=".pr-card" spellCheck={false}
                    onChange={(e) => setClassField(c._k, 'selector', e.target.value)}
                    className="w-full bg-transparent font-mono text-[12px] font-semibold text-foreground outline-none"
                    title="Class selector. Apply it to any element." />
                  <button type="button" title="Copy class name" className={ICON_BTN_CLS} onClick={() => copyClass(String(c.selector || '').replace(/^\./, ''))}><I.copy size={13} /></button>
                  <button type="button" title="Delete class" className={cn(ICON_BTN_CLS, 'hover:border-destructive hover:text-destructive')} onClick={() => delClass(c._k)}><I.trash size={13} /></button>
                </div>
                <textarea value={c.body || ''} spellCheck={false}
                  rows={Math.min(12, Math.max(3, String(c.body || '').split('\n').length + 1))}
                  placeholder={'padding: 12px;\nborder-radius: 8px;'}
                  onChange={(e) => setClassField(c._k, 'body', e.target.value)}
                  className="w-full resize-y bg-transparent px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground outline-none" />
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => addClass('other')} className={ADD_BTN_CLS}>
          <I.plus size={13} /> Add component class
          {list.length >= LIMITS.other && <ProBadge small />}
        </button>
      </div>
    );
  }

  const total = vars.length;
  const clsCounts = {
    typography: blockClasses.filter((c) => c.kind === 'typography').length,
    other: blockClasses.filter((c) => c.kind !== 'typography').length,
  };
  // Which globals source can we sync FROM here? Elementor's kit when the
  // Elementor editor is present; Bricks' colour palette in the Bricks editor;
  // otherwise, when the block editor is available (Gutenberg), the site's
  // theme.json colour palette. No source ⇒ no button (e.g. the live front-end
  // composer, which has none).
  const elementorActive = typeof window !== 'undefined' && !!(window.elementor && window.elementor.elements);
  // `window.bricksData` alone is NOT a builder signal, the Bricks plugin
  // localizes it on wp-admin pages generally (incl. the Gutenberg editor), so
  // gate on the actual Bricks BUILDER: the `?bricks=run` URL it loads under, or
  // its builder root element. Otherwise Gutenberg would wrongly show Bricks Sync.
  const inBricksBuilder = typeof window !== 'undefined' && (
    /[?&]bricks=run\b/.test((window.location && window.location.search) || '')
    || (typeof document !== 'undefined' && !!(document.getElementById('bricks-builder') || document.querySelector('.brx-body')))
  );
  // Resolve through the frame chain (getBricksData), not `window.bricksData`
  // directly, so the button still appears for a panel copy mounted inside the
  // canvas iframe, where `.brx-body` (the inBricksBuilder probe above) is the
  // signal that matches, but `bricksData` only exists on the parent window.
  const bricksActive = inBricksBuilder && !!getBricksData();
  const blockEditorActive = typeof window !== 'undefined' && !!(window.wp && window.wp.data && window.wp.data.select && window.wp.data.select('core/block-editor'));
  const syncMode = elementorActive ? 'elementor' : (bricksActive ? 'bricks' : (blockEditorActive ? 'theme' : null));

  if (loading) return <div className="p-4 text-xs text-muted-foreground">Loading globals…</div>;

  const content = activeCol === 'cls-typo' ? renderTypographyClasses()
    : activeCol === 'cls-other' ? renderOtherClasses()
    : collections.includes(activeCol) ? renderCollection(activeCol)
    : (
      <div className="rounded-lg border border-dashed border-input px-3 py-10 text-center text-xs text-muted-foreground">
        No collection selected. <button type="button" className="font-semibold text-foreground underline" onClick={addCollection}>Add a collection</button> to start.
      </div>
    );

  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><I.globe size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">Globals</div>
          <div className="text-[11px] text-muted-foreground">{total} variable{total === 1 ? '' : 's'} · in &lt;head&gt; #uichemy-globals</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {collections.map((name) => {
          const n = vars.filter((v) => (v.collection || DEFAULT_COLLECTION) === name).length;
          const Ic = iconForCollection(name);
          return (
            <button key={name} type="button" title={`Open ${name}`}
              onClick={() => { setActiveCol(name); setOpen(true); }}
              className={cn(CAT_PILL_CLS, 'border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground')}>
              <Ic size={13} /> {name}
              {n > 0 && <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{n}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
        <I.globe size={13} /> Open Globals Manager
      </button>

      {open && (
        <GlobalsModal title="Globals" onClose={() => setOpen(false)} footer={status || `${total} variable${total === 1 ? '' : 's'}`}
          headerActions={<>
            <button type="button" onClick={exportGlobals}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
              title="Download every variable, collection and class as one file">
              <I.download size={14} className="shrink-0" />
              Export
            </button>
            <button type="button" onClick={() => { if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); } }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
              title="Load globals from an exported file — you choose merge or replace">
              <I.upload size={14} className="shrink-0" />
              Import
            </button>
            {syncMode === 'elementor' ? (
            <button type="button" onClick={openElementorSync} disabled={syncBusy}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
              title="Sync colors & typography with Elementor Globals">
              <I.elementor size={14} className="shrink-0" />
              Elementor Sync
            </button>
          ) : syncMode === 'bricks' ? (
            <button type="button" onClick={openBricksSync} disabled={syncBusy}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
              title="Sync colours from the Bricks global color palette into Globals">
              <I.paint size={14} className="shrink-0" />
              Bricks Sync
            </button>
          ) : syncMode === 'theme' ? (
            <button type="button" onClick={openThemeSync} disabled={syncBusy}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
              title="Sync colours from the site's theme.json / FSE palette into Globals">
              <I.paint size={14} className="shrink-0" />
              Theme Sync
            </button>
          ) : null}
          </>}>
          <nav className="flex w-[184px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-muted/30 p-2">
            {collections.map((name) => {
              const on = activeCol === name;
              const n = vars.filter((v) => (v.collection || DEFAULT_COLLECTION) === name).length;
              const Ic = iconForCollection(name);
              return (
                <div key={name} onClick={() => setActiveCol(name)}
                  className={cn(NAV_ROW_CLS, on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                  <Ic size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate px-1 font-medium">{name}</span>
                  {n > 0 && <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{n}</span>}
                </div>
              );
            })}
            <button type="button" onClick={addCollection}
              className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-input px-2.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              title={collections.length >= LIMITS.collections ? 'Unlimited collections are a Pro feature' : 'Create a new collection'}>
              <I.plus size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate px-1">Add collection</span>
              {collections.length >= LIMITS.collections && <ProBadge small />}
            </button>

            {/* Classes, reusable CSS classes parsed from the block. */}
            <div className="my-1.5 border-t border-border" />
            <div className="px-2.5 pb-0.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Classes</div>
            {[
              { id: 'cls-typo',  label: 'Typography', icon: I.type,     n: clsCounts.typography },
              { id: 'cls-other', label: 'Others',     icon: I.variable, n: clsCounts.other },
            ].map((c) => {
              const on = activeCol === c.id;
              const Ic = c.icon;
              return (
                <div key={c.id} onClick={() => setActiveCol(c.id)}
                  className={cn(NAV_ROW_CLS, on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                  <Ic size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate px-1 font-medium">{c.label}</span>
                  {c.n > 0 && <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{c.n}</span>}
                </div>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">{content}</div>
        </GlobalsModal>
      )}

      {/* Kept outside the modal so a re-render of the panel cannot detach the
          input mid-pick, which loses the change event on Safari. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.css,application/json,text/css"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          setImportName(f ? f.name : '');
          onImportFile(f);
        }}
      />

      {importPlan && (
        <GlobalsImportDialog
          plan={importPlan}
          fileName={importName}
          mode={importMode}
          onMode={setImportMode}
          busy={importBusy}
          error={importError}
          onCancel={() => { setImportPlan(null); setImportCss(''); setImportError(''); }}
          onApply={applyImport}
        />
      )}

      {syncPlan && (
        <ElementorSyncDialog
          plan={syncPlan}
          source={syncSource}
          busy={syncBusy}
          error={syncError}
          onCancel={() => { setSyncPlan(null); setSyncError(''); }}
          onApply={applyElementorSync}
        />
      )}
    </div>
  );
}
