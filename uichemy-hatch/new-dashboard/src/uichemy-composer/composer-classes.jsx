// Global Classes scope, reusable, site-wide CSS classes.
//
// Stored in the `uichemy_globals_class` option (REST /uichemy/v1/classes).
// Each class = a name (e.g. pr-blog-card) + a raw CSS block. The server emits
// real rules (`.pr-blog-card{…}`) on the frontend and in the editor preview;
// this panel additionally live-injects the compiled CSS into the preview
// iframe so edits show instantly. Apply the class to any element anywhere –
// editing it here updates every usage.
//
// CSS block supports plain declarations plus `&` nesting:
//   background:#fff; padding:20px;
//   &:hover { box-shadow:0 12px 30px rgba(0,0,0,.12); }
//   & .title { font-size:18px; }
//   @media (max-width:767px) { padding:10px; }

import React from 'react';
import { I } from './composer-icons';
import { getRestApiBaseUrl, getRestNonce } from './composer-elementor';
import { applyCssDeclToScope } from './composer-css-parser';
import { markParsedScopeOwnership, BASE_BP_KEY } from './composer-breakpoint-scope';
import { emptyProps } from './composer-data';
import { CodeMirrorEditor } from './composer-code-editor';

let _kSeq = 0;
function genKey() { _kSeq += 1; return 'gc' + _kSeq; }
function slugClass(s) {
  let v = String(s).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+/, '');
  if (/^[0-9]/.test(v)) v = 'c-' + v;
  return v;
}

// ── module-level cache so the Inspector can read classes without refetching ──
let _cache = { classes: [], loaded: false };
const _subs = new Set();
function setCache(classes) {
  _cache = { classes: Array.isArray(classes) ? classes : [], loaded: true };
  _subs.forEach((fn) => { try { fn(_cache); } catch (e) { /* noop */ } });
}
export function getGlobalClassesCache() { return _cache; }

let _fetchInFlight = null;
function fetchClasses() {
  if (_fetchInFlight) return _fetchInFlight;
  const base  = getRestApiBaseUrl();
  const nonce = getRestNonce();
  _fetchInFlight = fetch(`${base}/uichemy/v1/classes`, { credentials: 'same-origin', headers: nonce ? { 'X-WP-Nonce': nonce } : {} })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => { if (d && Array.isArray(d.classes)) { setCache(d.classes); injectPreviewCss(d.css || ''); } return d; })
    .finally(() => { _fetchInFlight = null; });
  return _fetchInFlight;
}

/** Hook: current global classes; auto-fetches once, updates on panel saves. */
export function useGlobalClasses() {
  const [state, setState] = React.useState(_cache);
  React.useEffect(() => {
    const fn = (c) => setState({ ...c });
    _subs.add(fn);
    if (!_cache.loaded) fetchClasses().catch(() => {});
    return () => _subs.delete(fn);
  }, []);
  return state.classes;
}

// ── live preview injection ───────────────────────────────────────────────────
// Mirror of the PHP compiler (loose decls → .cls{}, `&` blocks anchored, @media recursed).
export function compileClassCss(sel, body) {
  const segs = parseTopLevel(body);
  let loose = '';
  let blocks = '';
  segs.forEach((seg) => {
    if (seg.type === 'decls') { loose += seg.text; return; }
    const s = seg.selector;
    if (s[0] === '@') { blocks += s + '{' + compileClassCss(sel, seg.inner) + '}'; return; }
    let full;
    if (s.indexOf('&') !== -1) full = s.split('&').join(sel);
    else if (s[0] === ':') full = sel + s;
    else full = sel + ' ' + s;
    blocks += full + '{' + seg.inner.trim() + '}';
  });
  loose = loose.trim();
  return (loose ? sel + '{' + loose + '}' : '') + blocks;
}

export function buildAllClassesCss(classes) {
  return (classes || []).map((c) => (c && c.id ? compileClassCss('.' + c.id, c.css) : '')).join('');
}

// ── Inspector integration ────────────────────────────────────────────────────
// Extract only the TOP-LEVEL declarations of a class body (nested &/@ blocks
// are display-states, not base props) and parse them into a scope object so
// the Inspector can show what CSS a global class applies to the selection.
function topLevelDeclarations(body) {
  return parseTopLevel(body).filter((s) => s.type === 'decls').map((s) => s.text).join('');
}

export function globalClassToScope(css) {
  // applyCssDeclToScope mutates `scope` in place and returns nothing, do NOT
  // reassign its result back onto `scope` (that overwrites it with undefined
  // after the first declaration and crashes on the next one).
  const scope = emptyProps();
  parseDecls(topLevelDeclarations(css)).forEach((d) => {
    if (d.off) return; // disabled declaration, don't seed the Inspector with it
    applyCssDeclToScope(scope, d.prop, d.value);
  });
  // Mark every populated key as owned at the base breakpoint (same as
  // parseInlineStyleToScope/parseCssToScopes), without this the cascade's
  // __bpOwn check treats the seeded values as absent, so they never show as
  // the scope's own value or as an inherited placeholder elsewhere.
  return markParsedScopeOwnership(scope, '');
}

/** True when `scopeName` matches a registered global class. */
export function isUiChemyGlobalClassScope(scopeName) {
  const list = _cache.classes || [];
  return list.some((c) => c && c.id === scopeName);
}

// ── CSS-body parsing (comment-aware) ─────────────────────────────────────────
// Parse declarations into [{prop, value, off}]. A `/* prop: value; */` comment
// is a DISABLED declaration (off:true). Splits on `;` outside parens + comments.
function parseDecls(text) {
  const s = String(text || '');
  const out = [];
  let buf = '';
  let depth = 0;
  let i = 0;
  const push = (chunk, off) => {
    const k = chunk.indexOf(':');
    if (k === -1) return;
    const prop = chunk.slice(0, k).trim();
    const value = chunk.slice(k + 1).trim().replace(/;\s*$/, '');
    if (prop && value) out.push({ prop, value, off: !!off });
  };
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '*') {                  // disabled decl(s)
      const e = s.indexOf('*/', i + 2);
      const inner = e === -1 ? s.slice(i + 2) : s.slice(i + 2, e);
      inner.split(';').forEach((p) => { if (p.trim()) push(p, true); });
      i = e === -1 ? s.length : e + 2;
      continue;
    }
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { push(buf, false); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  push(buf, false);
  return out;
}

// Parse a class body into ordered top-level segments (comment-aware so a
// commented declaration's `; { }` are never treated as structural):
//   { type:'decls', text } | { type:'block', selector, inner }
function parseTopLevel(body) {
  const s = String(body || '');
  const segs = [];
  let decls = '';  // completed loose declarations (incl. disabled comments)
  let sel = '';    // pending selector-candidate / trailing text
  let i = 0;
  const flush = () => { if (decls.trim()) segs.push({ type: 'decls', text: decls }); decls = ''; };
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '*') {                  // comment = loose (disabled) decl
      const e = s.indexOf('*/', i + 2);
      decls += (e === -1 ? s.slice(i) : s.slice(i, e + 2)) + '\n';
      i = e === -1 ? s.length : e + 2;
      continue;
    }
    const ch = s[i];
    if (ch === ';') { decls += sel + ';'; sel = ''; i++; continue; }
    if (ch === '{') {
      const selector = sel.trim(); sel = '';
      let depth = 1; let inner = ''; i++;
      while (i < s.length && depth > 0) {
        if (s[i] === '/' && s[i + 1] === '*') {
          const e = s.indexOf('*/', i + 2);
          inner += e === -1 ? s.slice(i) : s.slice(i, e + 2);
          i = e === -1 ? s.length : e + 2;
          continue;
        }
        const c2 = s[i];
        if (c2 === '{') depth++;
        else if (c2 === '}') { depth--; if (depth === 0) break; }
        inner += c2; i++;
      }
      i++;
      flush();
      if (selector) segs.push({ type: 'block', selector, inner });
      continue;
    }
    sel += ch; i++;
  }
  decls += sel;
  flush();
  return segs;
}

// Merge updates into the LOOSE declarations of a body, preserving nested blocks
// AND disabled (commented) declarations. Update value forms:
//   'red'                 → set enabled
//   ''  / null            → remove entirely
//   { value, off }        → set value and/or disabled state (missing keys kept)
// Disabled declarations serialize as `/* prop: value; */`.
function mergeDeclsIntoBody(body, updates) {
  const segs = parseTopLevel(body);
  const order = [];
  const map = {}; // prop -> { value, off }
  segs.forEach((seg) => {
    if (seg.type !== 'decls') return;
    parseDecls(seg.text).forEach((d) => {
      if (!(d.prop in map)) order.push(d.prop);
      map[d.prop] = { value: d.value, off: d.off };
    });
  });
  const drop = (prop) => { delete map[prop]; const at = order.indexOf(prop); if (at !== -1) order.splice(at, 1); };
  Object.keys(updates || {}).forEach((prop) => {
    const u = updates[prop];
    if (u === '' || u == null) { drop(prop); return; }
    if (typeof u === 'object') {
      const cur = map[prop] || { value: '', off: false };
      const value = ('value' in u) ? String(u.value).trim() : cur.value;
      const off = ('off' in u) ? !!u.off : cur.off;
      if (value === '') { drop(prop); return; }
      if (!(prop in map)) order.push(prop);
      map[prop] = { value, off };
      return;
    }
    const value = String(u).trim();
    if (value === '') { drop(prop); return; }
    if (!(prop in map)) order.push(prop);
    map[prop] = { value, off: false };
  });
  const declText = order.map((p) => (map[p].off ? `/* ${p}: ${map[p].value}; */` : `${p}: ${map[p].value};`)).join('\n');
  const blocks = segs.filter((seg) => seg.type === 'block');
  const blockText = blocks.map((b) => `${b.selector} {${b.inner}}`).join('\n');
  return [declText, blockText].filter(Boolean).join('\n');
}

const normSel = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Merge updates into a named top-level block (`&:hover`, `& .title`, …) of a
// body, created at the end when missing. Other segments stay untouched.
function mergeBlockInBody(body, blockSel, updates) {
  const segs = parseTopLevel(body);
  let found = false;
  const out = segs.map((seg) => {
    if (!found && seg.type === 'block' && normSel(seg.selector) === normSel(blockSel)) {
      found = true;
      return { ...seg, inner: '\n' + mergeDeclsIntoBody(seg.inner, updates) + '\n' };
    }
    return seg;
  });
  if (!found) {
    const inner = mergeDeclsIntoBody('', updates);
    if (inner.trim()) out.push({ type: 'block', selector: blockSel, inner: '\n' + inner + '\n' });
  }
  return serializeSegs(out);
}

function serializeSegs(segs) {
  return segs
    .map((seg) => (seg.type === 'decls' ? seg.text.trim() : `${seg.selector} {${seg.inner}}`))
    .filter(Boolean)
    .join('\n');
}

/**
 * Merge style updates into a class's CSS text at a precise target:
 *   target.media, '' for base, or a media query like `(max-width: 767px)`
 *   target.sel  , '' for the class itself, or an `&`-form selector
 *                  (`&:hover`, `& .title`) for a nested block.
 * Accepts a plain string third argument as `{ media: <string> }` for
 * backward compatibility with the Inspector write-back.
 */
export function updateClassCssText(cssText, updates, target) {
  const t = typeof target === 'string' ? { media: target } : (target || {});
  const media = t.media || '';
  const sel = t.sel || '';
  const text = String(cssText || '');

  const applyInner = (body) => (sel ? mergeBlockInBody(body, sel, updates) : mergeDeclsIntoBody(body, updates));

  if (!media) return applyInner(text);

  const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
  const want = norm('@media' + media);
  const segs = parseTopLevel(text);
  let found = false;
  const out = segs.map((seg) => {
    if (!found && seg.type === 'block' && seg.selector[0] === '@' && norm(seg.selector) === want) {
      found = true;
      return { ...seg, inner: '\n' + applyInner(seg.inner) + '\n' };
    }
    return seg;
  });
  if (!found) {
    const inner = applyInner('');
    if (inner.trim()) out.push({ type: 'block', selector: '@media ' + media, inner: '\n' + inner + '\n' });
  }
  return serializeSegs(out);
}

// Debounced REST save shared by Inspector write-backs.
let _saveTimer = null;
function saveCacheToServer() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const base  = getRestApiBaseUrl();
    const nonce = getRestNonce();
    fetch(`${base}/uichemy/v1/classes`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, nonce ? { 'X-WP-Nonce': nonce } : {}),
      body: JSON.stringify({ classes: _cache.classes }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (d && Array.isArray(d.classes)) setCache(d.classes); if (d && typeof d.css === 'string') injectPreviewCss(d.css); })
      .catch(() => {});
  }, 700);
}

/**
 * Persist edits into a global class: merge into its CSS text at `target`
 * ({media, sel}), update the shared cache (panel + Inspector hydration
 * follow), live-inject the compiled CSS, and debounce-save to the server.
 * Returns false when the class is unknown.
 */
export function mergeIntoGlobalClass(className, updates, target) {
  if (!_cache.loaded) return false;
  const list = _cache.classes || [];
  const at = list.findIndex((c) => c && c.id === className);
  const next = list.slice();
  const existing = at === -1 ? { id: className, name: className, css: '' } : next[at];
  const nextCss = updateClassCssText(existing.css || '', updates, target);
  if (at !== -1 && nextCss === (existing.css || '')) return true;
  const updatedEntry = { ...existing, css: nextCss };
  if (at === -1) next.push(updatedEntry);
  else next[at] = updatedEntry;
  setCache(next);
  injectPreviewCss(buildAllClassesCss(next));
  saveCacheToServer();
  return true;
}

/** Inspector write-back: base declarations at the given media query. */
export function applyGlobalClassUpdates(className, updates, mediaQuery) {
  return mergeIntoGlobalClass(className, updates, { media: mediaQuery || '' });
}

/**
 * Map a scanned page rule to a merge target on `className`:
 * `.pr-blog:hover` → sel `&:hover`; `.pr-blog .title` → sel `& .title`;
 * the first `@media` condition becomes target.media.
 */
export function ruleToClassTarget(className, rule) {
  const re = new RegExp('\\.' + escapeRegex(className) + '(?![A-Za-z0-9_-])', 'g');
  let sel = String(rule.sel || '').replace(re, '&').trim();
  if (sel === '&') sel = '';
  let media = '';
  (rule.conds || []).some((c) => {
    if (String(c).indexOf('@media') === 0) { media = String(c).slice(6).trim(); return true; }
    return false;
  });
  return { media, sel };
}

/**
 * Import every scanned page rule for `className` into the class CSS
 * (selectors become `&`-form blocks, media queries preserved) and save.
 * Returns the number of rules imported.
 */
export function importAppliedRulesIntoClass(className) {
  const rules = collectAppliedRules(className);
  let n = 0;
  rules.forEach((r) => {
    const updates = {};
    (r.decls || []).forEach((d) => { updates[d.prop] = d.value; });
    if (!Object.keys(updates).length) return;
    if (mergeIntoGlobalClass(className, updates, ruleToClassTarget(className, r))) n++;
  });
  return n;
}

/** Merge seeded values into empty fields only (do not clobber user edits). */
export function mergeSeedIntoScope(existing, seeded) {
  const base = existing && typeof existing === 'object' ? existing : emptyProps();
  const out = {
    ...emptyProps(),
    ...base,
    typography: { ...base.typography },
    layout: { ...base.layout },
    spacing: { ...base.spacing },
    background: { ...base.background },
    border: { ...base.border },
    effects: { ...base.effects },
    __units: { ...(base.__units || {}) },
    __globals: { ...(base.__globals || {}) },
    __shown: { ...(base.__shown || {}) },
    __bpOwn: { ...(base.__bpOwn || {}) },
  };

  // The seeded scope (from globalClassToScope) marks its own keys owned at
  // BASE_BP_KEY, carry that mark over for exactly the keys we actually copy
  // below, so the cascade's __bpOwn check recognizes them as present. Keys
  // the existing scope already owns are left untouched (never clobbered).
  const seededOwnBase = (seeded.__bpOwn && seeded.__bpOwn[BASE_BP_KEY]) || {};

  const groups = ['typography', 'layout', 'spacing', 'background', 'border', 'effects'];
  groups.forEach((g) => {
    const src = seeded[g] || {};
    const dst = out[g] || {};
    Object.keys(src).forEach((k) => {
      if (dst[k] != null && dst[k] !== '') return;
      if (src[k] == null || src[k] === '') return;
      dst[k] = src[k];
      const fullKey = `${g}.${k}`;
      if (seededOwnBase[fullKey]) {
        out.__bpOwn = {
          ...out.__bpOwn,
          [BASE_BP_KEY]: { ...(out.__bpOwn[BASE_BP_KEY] || {}), [fullKey]: true },
        };
      }
    });
    out[g] = dst;
  });

  Object.entries(seeded.__units || {}).forEach(([k, u]) => {
    if (!out.__units[k] && u) out.__units[k] = u;
  });

  return out;
}

/**
 * Seed the Inspector's scopes with each global class present on the selected
 * element, so its CSS shows up when that class chip is selected. Seeds empty
 * fields only, widget-level (local) edits stay on top.
 */
export function hydrateGlobalClassScopes(scopes, classNames, classes) {
  const base = scopes && typeof scopes === 'object' ? { ...scopes } : {};
  if (!Array.isArray(classes) || !classes.length || !Array.isArray(classNames)) return base;
  const byId = new Map(classes.filter((c) => c && c.id).map((c) => [c.id, c]));
  classNames.forEach((className) => {
    const gc = byId.get(className);
    if (!gc || !String(gc.css || '').trim()) return;
    const seeded = globalClassToScope(gc.css);
    base[className] = mergeSeedIntoScope(base[className], seeded);
  });
  return base;
}

function injectPreviewCss(css) {
  const docs = [document];
  document.querySelectorAll('iframe').forEach((f) => {
    try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) { /* cross-origin */ }
  });
  docs.forEach((doc) => {
    let el = doc.getElementById('uichemy-global-classes-live');
    if (!el) {
      el = doc.createElement('style');
      el.id = 'uichemy-global-classes-live';
      (doc.head || doc.documentElement).appendChild(el);
    }
    el.textContent = css;
  });
}

// ── DevTools-style CSS view (Tab 1) ─────────────────────────────────────────
// Instead of only compiling the stored CSS, scan every same-origin stylesheet
// in the Elementor preview iframe(s) AND the editor document, and list every
// rule whose selector targets `.className`, exactly what the browser console
// shows. The panel's own class CSS is picked up too, because it is live-
// injected as a <style id="uichemy-global-classes-live"> into those documents.
function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function ruleConditions(rule) {
  const conds = [];
  let p = rule.parentRule;
  while (p) {
    if (p.media && p.media.mediaText) conds.unshift('@media ' + p.media.mediaText);
    else if (p.conditionText) conds.unshift('@supports ' + p.conditionText);
    p = p.parentRule;
  }
  return conds;
}

function walkSheetRules(rules, re, push) {
  Array.prototype.forEach.call(rules, (rule) => {
    if (rule.selectorText) {
      if (re.test(rule.selectorText)) push(rule);
    } else if (rule.cssRules && rule.cssRules.length) {
      walkSheetRules(rule.cssRules, re, push);
    }
  });
}

function collectAppliedRules(className) {
  // Match `.pr-blog` as a whole token, not `.pr-blog-card`.
  const re = new RegExp('\\.' + escapeRegex(className) + '(?![A-Za-z0-9_-])');
  const docs = [];
  // Preview iframe(s) first, that's where the page's real CSS lives.
  document.querySelectorAll('iframe').forEach((f) => {
    try { if (f.contentDocument) docs.push({ doc: f.contentDocument, where: 'preview' }); } catch (e) { /* cross-origin */ }
  });
  docs.push({ doc: document, where: 'editor' });

  const out = [];
  const seen = new Set();
  docs.forEach(({ doc, where }) => {
    Array.prototype.forEach.call(doc.styleSheets || [], (sheet) => {
      // Skip our own Tab-2 live-edit layer, or the scan would echo it back.
      if (sheet.ownerNode && sheet.ownerNode.id === 'uichemy-class-live-edit') return;
      let rules;
      try { rules = sheet.cssRules; } catch (e) { return; } // cross-origin sheet
      if (!rules) return;
      const src = sheet.href
        ? sheet.href.split('?')[0].split('/').pop()
        : (sheet.ownerNode && sheet.ownerNode.id ? '<style#' + sheet.ownerNode.id + '>' : '<style>');
      walkSheetRules(rules, re, (rule) => {
        const cssText = String(rule.style.cssText || '');
        const conds = ruleConditions(rule);
        const key = conds.join('|') + '||' + rule.selectorText + '||' + cssText;
        if (seen.has(key)) return; // same sheet loaded in both editor & preview
        seen.add(key);
        const decls = cssText.split(';').map((d) => {
          const k = d.indexOf(':');
          if (k === -1) return null;
          const prop = d.slice(0, k).trim();
          const value = d.slice(k + 1).trim();
          return prop && value ? { prop, value } : null;
        }).filter(Boolean);
        // `rule` is the LIVE CSSStyleRule, Tab 1 edits/toggles write to it
        // directly (CSSOM), exactly like the browser's Styles panel.
        out.push({ sel: rule.selectorText, decls, conds, src, where, rule });
      });
    });
  });
  return out;
}

// Chrome DevTools (dark) palette, the view keeps its own dark background so
// it reads as a console panel in both light and dark editor themes.
const DT = {
  panel: { background: '#202124', border: '1px solid rgba(128,128,128,.28)', borderRadius: 6, padding: '10px 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.7, overflowX: 'auto', overflowY: 'auto', maxHeight: 380, color: '#e8eaed' },
  sel:   { color: '#e8eaed' },
  at:    { color: '#c58af9' },
  prop:  { color: '#7cacf8' },
  value: { color: '#f29766' },
  punct: { color: '#9aa0a6' },
  src:   { color: '#9aa0a6', fontStyle: 'italic', fontSize: 10.5, float: 'right', marginLeft: 16 },
};
const IND = 14; // px per nesting level

// Double-click a token to edit it inline (Enter/blur commits, Esc cancels).
// `list` wires a <datalist> id for native autocomplete suggestions.
function InlineEdit({ text, style, onCommit, list }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(text);
  React.useEffect(() => { if (!editing) setVal(text); }, [text, editing]);
  if (!editing) {
    return <span style={{ ...style, cursor: 'text' }} title="Double-click to edit" onDoubleClick={() => { setVal(text); setEditing(true); }}>{text}</span>;
  }
  const commit = () => { setEditing(false); if (val.trim() && val !== text) onCommit(val); };
  return (
    <input
      autoFocus
      list={list}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { setEditing(false); setVal(text); }
      }}
      onBlur={commit}
      spellCheck={false}
      style={{ ...style, background: '#111', border: '1px solid #5f6368', borderRadius: 3, padding: '0 3px', font: 'inherit', outline: 'none', width: Math.max(6, val.length + 2) + 'ch' }}
    />
  );
}

// ── Parse a class body into an ordered, editable model ───────────────────────
// Each group = one selector context: { media, sel, label, decls:[{prop,value,off}] }.
// media '' + sel '' → the class base. sel '&:hover' / '& .title' → nested block.
// @media groups carry `media` and (optionally) a nested `sel`. `off` = disabled.
const declList = parseDecls;

function parseClassModel(css, className) {
  const cls = '.' + (className || 'class');
  const segs = parseTopLevel(css);
  const groups = [];
  const baseDecls = [];
  segs.forEach((seg) => { if (seg.type === 'decls') baseDecls.push(...declList(seg.text)); });
  groups.push({ media: '', sel: '', label: cls, decls: baseDecls });

  segs.forEach((seg) => {
    if (seg.type !== 'block') return;
    const sel = seg.selector;
    if (sel[0] === '@') {
      const media = sel.replace(/^@media\s*/i, '').trim();
      const inner = parseTopLevel(seg.inner);
      const mBase = [];
      inner.forEach((s2) => { if (s2.type === 'decls') mBase.push(...declList(s2.text)); });
      if (mBase.length) groups.push({ media, sel: '', label: `${sel} { ${cls}`, decls: mBase });
      inner.forEach((s2) => {
        if (s2.type !== 'block') return;
        groups.push({ media, sel: s2.selector, label: `${sel} { ${s2.selector.replace('&', cls)}`, decls: declList(s2.inner) });
      });
    } else {
      groups.push({ media: '', sel, label: sel.replace('&', cls), decls: declList(seg.inner) });
    }
  });
  return groups;
}

// Autocomplete suggestions for the Visual editor (property + common values).
const CSS_PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index', 'float', 'clear',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'box-sizing',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block',
  'color', 'background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-attachment',
  'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'box-shadow', 'outline', 'outline-offset',
  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-transform', 'text-decoration', 'text-shadow', 'text-overflow', 'white-space', 'word-break',
  'opacity', 'visibility', 'overflow', 'overflow-x', 'overflow-y', 'cursor', 'pointer-events', 'user-select',
  'transition', 'transform', 'transform-origin', 'animation', 'filter', 'backdrop-filter', 'mix-blend-mode',
  'display', 'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'justify-content', 'align-items', 'align-content', 'align-self', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
  'object-fit', 'object-position', 'content', 'list-style', 'vertical-align',
];
const CSS_VALUES = [
  'auto', 'none', 'inherit', 'initial', 'unset', '100%', '50%', '0', '0px', '1', '1px', '2px', '4px', '8px', '16px', '24px', '100vw', '100vh',
  'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'contents', 'table',
  'relative', 'absolute', 'fixed', 'sticky', 'static',
  'center', 'flex-start', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'stretch', 'baseline', 'start', 'end',
  'row', 'row-reverse', 'column', 'column-reverse', 'wrap', 'nowrap',
  'bold', 'normal', '400', '500', '600', '700', 'italic', 'uppercase', 'lowercase', 'capitalize', 'underline', 'line-through',
  'hidden', 'visible', 'scroll', 'clip', 'pointer', 'default', 'not-allowed', 'grab',
  'transparent', 'currentColor', 'cover', 'contain', 'solid', 'dashed', 'dotted', 'double',
  'ellipsis', 'pre', 'pre-wrap', 'break-word', 'fit-content', 'max-content', 'min-content',
];

const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', pink: '#ffc0cb', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff',
  gold: '#ffd700', navy: '#000080', teal: '#008080', lime: '#00ff00', maroon: '#800000',
};
// Return a #hex for a pure color value (hex/rgb/rgba/named), else null.
function colorToHexOrNull(v) {
  const s = String(v || '').trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) {
    return s.length === 4 ? '#' + s.slice(1).split('').map((c) => c + c).join('') : s;
  }
  const m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (m) { const h = (n) => (+n).toString(16).padStart(2, '0'); return '#' + h(m[1]) + h(m[2]) + h(m[3]); }
  return NAMED_COLORS[s] || null;
}

// One editable declaration line (double-click prop/value, checkbox disables
// via a CSS comment, reversible, DevTools-style, color swatch for colors).
function ClassDeclRow({ decl, onSet }) {
  const on = !decl.off; // enabled state comes straight from the parsed model
  const [prop, setProp]   = React.useState(decl.prop);
  const [value, setValue] = React.useState(decl.value);
  React.useEffect(() => { setProp(decl.prop); setValue(decl.value); }, [decl.prop, decl.value]);
  const strike = on ? {} : { textDecoration: 'line-through', opacity: 0.5 };
  // Toggle: enabled → disable (off:true); disabled → enable (off:false). Value kept.
  const toggle = () => onSet(prop, { off: on }, prop);
  // Edits preserve the current enabled/disabled state.
  const commitProp = (np) => { np = np.trim(); if (np && np !== prop) { onSet(np, { value, off: !on }, prop); setProp(np); } };
  const commitValue = (nv) => { nv = nv.trim(); if (nv && nv !== value) { onSet(prop, { value: nv, off: !on }, prop); setValue(nv); } };
  // Detect a color even with a trailing !important, and preserve it when picking.
  const important = /!\s*important\s*$/i.test(value);
  const bareValue = value.replace(/\s*!\s*important\s*$/i, '').trim();
  const colorHex = colorToHexOrNull(bareValue);
  const pickColor = (hex) => commitValue(hex + (important ? ' !important' : ''));
  return (
    <div style={{ position: 'relative', paddingLeft: IND + 22 }}>
      <input type="checkbox" className="uich-check" checked={on} onChange={toggle} title={on ? 'Disable' : 'Enable'} style={{ position: 'absolute', left: IND, top: 4 }} />
      <InlineEdit text={prop} style={{ ...DT.prop, ...strike }} onCommit={commitProp} list="pr-css-props" />
      <span style={DT.punct}>: </span>
      {colorHex && (
        <input
          type="color"
          className="pr-color-dot"
          value={colorHex}
          title={`Pick color (${value})`}
          onChange={(e) => pickColor(e.target.value)}
          style={{ width: 16, height: 16, border: '1px solid #5f6368', borderRadius: 3, background: colorHex, cursor: 'pointer', verticalAlign: 'middle', marginRight: 6 }}
        />
      )}
      <InlineEdit text={value} style={{ ...DT.value, ...strike }} onCommit={commitValue} list="pr-css-values" />
      <span style={DT.punct}>;</span>
    </div>
  );
}

// "+ add" row, separate property + value inputs, each with autocomplete
// suggestions. Enter on property jumps to value; Enter/blur on value adds.
function ClassAddRow({ onAdd }) {
  const [adding, setAdding] = React.useState(false);
  const [p, setP] = React.useState('');
  const [v, setV] = React.useState('');
  const valRef = React.useRef(null);
  const reset = () => { setAdding(false); setP(''); setV(''); };
  const commit = () => { const prop = p.trim(); const value = v.trim().replace(/;\s*$/, ''); reset(); if (prop && value) onAdd(prop, value); };
  if (!adding) {
    return (
      <div style={{ paddingLeft: IND + 22 }}>
        <button onClick={() => setAdding(true)} style={{ border: 'none', background: 'transparent', color: '#9aa0a6', font: 'inherit', fontSize: 10.5, cursor: 'pointer', padding: 0, opacity: 0.75 }}>+ add</button>
      </div>
    );
  }
  const inp = { background: '#111', border: '1px solid #5f6368', borderRadius: 3, padding: '0 4px', font: 'inherit', outline: 'none' };
  return (
    <div style={{ paddingLeft: IND + 22, display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        autoFocus list="pr-css-props" value={p} placeholder="property"
        onChange={(e) => setP(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (valRef.current) valRef.current.focus(); }
          else if (e.key === 'Escape') reset();
        }}
        spellCheck={false}
        style={{ ...inp, color: '#7cacf8', width: Math.max(8, p.length + 2) + 'ch' }}
      />
      <span style={DT.punct}>:</span>
      <input
        ref={valRef} list="pr-css-values" value={v} placeholder="value"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') reset(); }}
        onBlur={commit}
        spellCheck={false}
        style={{ ...inp, color: '#f29766', width: Math.max(8, v.length + 2) + 'ch' }}
      />
    </div>
  );
}

function ClassModelGroup({ group, onSet, onAdd }) {
  const target = { media: group.media, sel: group.sel };
  return (
    <div style={{ marginBottom: 10 }}>
      <div><span style={group.label && group.label[0] === '.' && !group.media ? DT.sel : DT.at}>{group.label}</span><span style={DT.punct}> {'{'}</span></div>
      {group.decls.map((d, j) => (
        <ClassDeclRow
          key={d.prop + j}
          decl={d}
          onSet={(prop, update, oldProp) => onSet(target, prop, update, oldProp)}
        />
      ))}
      <ClassAddRow onAdd={(prop, value) => onAdd(target, prop, value)} />
      <div><span style={DT.punct}>{'}'}</span>{group.media ? <span style={DT.punct}> {'}'}</span> : null}</div>
    </div>
  );
}

// Console/visual format of the SAME class CSS shown as code in the other tab.
// Every edit rewrites the class body (via updateClassCssText) → onChange.
function ClassVisualView({ className, css, onChange }) {
  const groups = React.useMemo(() => parseClassModel(css, className), [css, className]);
  // update = string (set enabled) | { value?, off? } (set value/disabled state).
  const set = (target, prop, update, oldProp) => {
    const updates = {};
    if (oldProp && oldProp !== prop) updates[oldProp] = '';
    updates[prop] = update;
    onChange(updateClassCssText(css, updates, target));
  };
  const add = (target, prop, value) => onChange(updateClassCssText(css, { [prop]: value }, target));
  const hasAny = groups.some((g) => g.decls.length);
  return (
    <div>
      <div style={DT.panel}>
        {groups.map((g, i) => (
          <ClassModelGroup key={i} group={g} onSet={set} onAdd={add} />
        ))}
        {!hasAny && <div style={{ opacity: 0.5, fontSize: 11 }}>No declarations yet. Use “+ add”, or type in the Code tab.</div>}
      </div>
      <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 5 }}>
        Double-click a property/value to edit · checkbox disables (strike-through, reversible) · “+ add” adds, same CSS as the Code tab, saved &amp; applied.
      </div>
    </div>
  );
}


// theme-neutral styles (match the Variables panel)
const BORDER = '1px solid rgba(128,128,128,.28)';
const sInput  = { border: BORDER, background: 'transparent', color: 'inherit', borderRadius: 5, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit', minWidth: 0, width: '100%', boxSizing: 'border-box' };
const sIconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: BORDER, background: 'transparent', color: 'inherit', borderRadius: 5, cursor: 'pointer', padding: 0 };
const sAddBtn  = { display: 'inline-flex', alignItems: 'center', gap: 6, border: BORDER, background: 'transparent', color: 'inherit', borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const sCssArea = { ...sInput, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.55, resize: 'vertical', minHeight: 64 };

const sTabBtn = (active) => ({
  border: 'none',
  borderBottom: active ? '2px solid currentColor' : '2px solid transparent',
  background: 'transparent',
  color: 'inherit',
  opacity: active ? 1 : 0.55,
  fontSize: 11.5,
  fontWeight: 600,
  padding: '5px 10px 6px',
  cursor: 'pointer',
});

// Reusable class-editor body: Visual (console) / Code tabs + Import button.
// Used by the standalone ClassRow AND by the `class`-type row in the unified
// Global Variables panel.
export function ClassEditor({ id, css, onCss, onImported }) {
  const [tab, setTab] = React.useState(String(css || '').trim() ? 1 : 2);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, borderBottom: BORDER, marginBottom: 10 }}>
        <button onClick={() => setTab(1)} style={sTabBtn(tab === 1)}>Visual</button>
        <button onClick={() => setTab(2)} style={sTabBtn(tab === 2)}>Code</button>
        <span style={{ flex: 1 }} />
        {!!id && (
          <button
            title="Pull any CSS already applied to this class on the page (theme / Elementor) into it"
            onClick={() => { const n = importAppliedRulesIntoClass(id); if (onImported) onImported(n); }}
            style={{ ...sAddBtn, padding: '3px 9px', fontSize: 10.5 }}
          >⬇ Import applied CSS</button>
        )}
      </div>
      {tab === 1 && <ClassVisualView className={id} css={css || ''} onChange={onCss} />}
      {tab === 2 && (
        <div className="pr-class-code">
          <CodeMirrorEditor languageKey="css" value={css || ''} onChange={onCss} />
        </div>
      )}
    </div>
  );
}

function ClassRow({ c, onId, onName, onCss, onCopy, onDelete, onImported }) {
  const [open, setOpen] = React.useState(true);
  return (
    <div style={{ border: BORDER, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: 'rgba(128,128,128,.05)' }}>
        <button onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Expand'} style={{ ...sIconBtn, width: 22, height: 22 }}>{open ? '▾' : '▸'}</button>
        <input type="text" value={c.name || ''} placeholder="Class name (label)" onChange={(e) => onName(e.target.value)} style={{ ...sInput, maxWidth: 160 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, border: BORDER, borderRadius: 5, padding: '3px 6px', minWidth: 0, flex: 1 }}>
          <span style={{ opacity: 0.5, fontFamily: 'monospace', fontSize: 11.5 }}>.</span>
          <input type="text" value={c.id || ''} placeholder="class-name" onChange={(e) => onId(slugClass(e.target.value))} style={{ ...sInput, border: 'none', padding: '2px 0', fontFamily: 'monospace', fontSize: 11.5 }} title="CSS class name. Use it on any element." />
        </span>
        <button title="Copy class name" onClick={() => onCopy(c.id)} style={sIconBtn}><I.copy size={13} /></button>
        <button title="Delete class" onClick={onDelete} style={{ ...sIconBtn, borderColor: 'rgba(220,80,80,.45)', color: 'rgba(220,90,90,.95)' }}>×</button>
      </div>
      {open && (
        <div style={{ padding: '6px 10px 12px' }}>
          <ClassEditor id={c.id} css={c.css} onCss={onCss} onImported={onImported} />
        </div>
      )}
    </div>
  );
}

export function GlobalClassesPanel() {
  const [classes, setClasses] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadOk, setLoadOk]   = React.useState(false);
  const [status, setStatus]   = React.useState('');
  const saveTimer = React.useRef(null);

  React.useEffect(() => {
    fetchClasses()
      .then((d) => { setClasses((d.classes || []).map((c) => ({ ...c, _k: genKey() }))); setLoadOk(true); })
      .catch(() => setLoadOk(false))
      .finally(() => setLoading(false));
  }, []);

  // Reflect edits made OUTSIDE the panel (Inspector write-backs) WITHOUT
  // disturbing the panel's own rows. This ONLY patches the css/name of an
  // existing row when its id matches, it never adds, removes, reorders, or
  // touches in-progress (empty-id) rows. That keeps add / type / scroll smooth:
  // a freshly-added class (empty id, dropped server-side) is left intact, and
  // the row you're typing in never gets rebuilt out from under you.
  const editingRef = React.useRef(false);
  React.useEffect(() => {
    const fn = (cache) => {
      if (editingRef.current) return; // a panel edit is in flight, ignore the echo
      setClasses((cur) => {
        const byId = new Map((cache.classes || []).map((c) => [c.id, c]));
        let changed = false;
        const next = cur.map((row) => {
          if (!row.id) return row;
          const ext = byId.get(row.id);
          if (!ext || (ext.css === row.css && ext.name === row.name)) return row;
          changed = true;
          return { ...row, css: ext.css, name: ext.name };
        });
        return changed ? next : cur;
      });
    };
    _subs.add(fn);
    return () => _subs.delete(fn);
  }, []);

  const persist = React.useCallback((list) => {
    if (!loadOk) return; // never overwrite the server if the initial load failed
    setStatus('Saving…');
    editingRef.current = true; // suppress our own cache echo while editing
    // Instant editor feedback even before the debounce fires.
    injectPreviewCss(buildAllClassesCss(list));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const base  = getRestApiBaseUrl();
      const nonce = getRestNonce();
      const clean = list.map(({ _k, ...rest }) => rest);
      // Update the shared cache from LOCAL rows (valid ids only) so Inspector
      // hydration follows, NOT from the server response (which drops
      // empty-id rows and can reorder, yanking rows out of the panel).
      setCache(clean.filter((c) => c.id));
      fetch(`${base}/uichemy/v1/classes`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: Object.assign({ 'Content-Type': 'application/json' }, nonce ? { 'X-WP-Nonce': nonce } : {}),
        body: JSON.stringify({ classes: clean.filter((c) => c.id) }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => { setStatus('Saved ✓'); if (d && typeof d.css === 'string') injectPreviewCss(d.css); })
        .catch(() => setStatus('Save failed'))
        .finally(() => { editingRef.current = false; });
    }, 600);
  }, [loadOk]);

  const update = React.useCallback((next) => { setClasses(next); persist(next); }, [persist]);

  function addClass() {
    update([...classes, { _k: genKey(), id: '', name: '', css: '' }]);
  }
  function setField(k, key, val) { update(classes.map((c) => (c._k === k ? { ...c, [key]: val } : c))); }
  function delClass(k) { update(classes.filter((c) => c._k !== k)); }
  function copyClass(id) {
    try { navigator.clipboard.writeText(id); setStatus(`Copied .${id}`); } catch (e) { /* noop */ }
  }

  if (loading) return <div style={{ padding: 16, fontSize: 12, opacity: 0.7 }}>Loading global classes…</div>;
  if (!loadOk) return <div style={{ padding: 16, fontSize: 12, color: 'rgba(220,90,90,.95)' }}>Couldn't load global classes. Reload the editor and try again.</div>;

  return (
    <div style={{ padding: '12px 14px', fontSize: 12 }}>
      {/* Autocomplete sources shared by every row's Visual editor. */}
      <datalist id="pr-css-props">{CSS_PROPS.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="pr-css-values">{CSS_VALUES.map((v) => <option key={v} value={v} />)}</datalist>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          Site-wide CSS classes, apply on any element (Elementor: Advanced → CSS Classes). Editing here updates every usage.
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ opacity: 0.7, fontSize: 11, whiteSpace: 'nowrap' }}>{status}</span>
      </div>

      {classes.length === 0 && (
        <div style={{ padding: '18px 0', opacity: 0.55, textAlign: 'center' }}>No global classes yet. Click “+ Add Class”.</div>
      )}

      {classes.map((c) => (
        <ClassRow
          key={c._k}
          c={c}
          onId={(v) => setField(c._k, 'id', v)}
          onName={(v) => setField(c._k, 'name', v)}
          onCss={(v) => setField(c._k, 'css', v)}
          onCopy={copyClass}
          onDelete={() => delClass(c._k)}
          onImported={(n) => setStatus(n ? `Imported ${n} rule${n === 1 ? '' : 's'} ✓` : 'Nothing to import')}
        />
      ))}

      <button onClick={addClass} style={{ ...sAddBtn, marginTop: 8 }}>+ Add Class</button>
    </div>
  );
}
