// Right-side Inspector (Direct Editor).
// Edits are scoped, Local (this element) or a class (everywhere).
import React from 'react';
import ReactDOM from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ensurePortalRoot } from '@/components/ui/portal-context';
import { I } from './composer-icons';
import { OPTS, UNITS } from './composer-css';
import { emptyProps } from './composer-data';
import { buildClassSuggestions, classSuggestionHint } from './composer-class-suggestions';
import { useGlobalClasses } from './composer-classes';
import { useUiChemyGlobalClasses } from './composer-variables';
import { LengthInput, parseLen, INPUT_CLS, MENU_ITEM_CLS, useSlidingSeg } from './composer-inputs';
import { SpacingBox } from './composer-spacing';
import { SCHEMA } from './composer-schema';
import { PropField, AddProperty, CustomCssSection, GlobalLabelMarker, MediaPreviewButton, AppliedFromHint } from './composer-fields';
import { CanvasTypographyBar } from './composer-canvas-typo';
import { CanvasTextToolbarSlot } from './composer-text-toolbar';
import { ComposerErrorBoundary } from './composer-error-boundary';
import { GradientBuilder, DEFAULT_GRADIENT } from './composer-gradient';
import { useImportedFontFamilies } from './composer-fonts';
import { formatTextShadow, parseTextShadow } from './composer-shadow-utils';
import {
  displayClassName,
  resolveScopePropertyDisplay,
} from './composer-cascade';
import {
  buildResponsiveFallbackChainForBreakpoint,
  breakpointLabelForKey,
} from './composer-breakpoints';
import {
  markScopePropOwn,
  clearScopePropOwn,
} from './composer-breakpoint-scope';
import {
  findEffectivePropertySource,
  scopeHasOwnAtActiveBreakpoint,
  getParsedScopeBag,
} from './composer-breakpoint-cascade';
import { tagIcon, ELEMENT_GROUPS, isValidTagName } from './composer-layers';
import {
  isSvgLayerEntry,
  readSvgLayerState,
  getSvgOuterHtml,
  isSvgMediaAttachment,
} from './composer-svg-utils';
import { findEnclosingLoop, isDynamicPlaceholderText } from './composer-layer-tree';

export { displayClassName };

// ── Inline dynamic-value binding ("Insert dynamic value" button) ─────────────
// Opens the shared visual picker (window.UichDD.ui.openValue) and inserts a
// {{ … }} Twig token at the caret. Loop-aware via LoopBindingContext.
const UICH_DD_CONTEXT = ['post', 'product', 'user', 'site', 'request'];

function uichInsertTokenAtCaret(el, value, token, commit) {
  const cur = String(value == null ? '' : value);
  if (el && typeof el.selectionStart === 'number') {
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const next = cur.slice(0, s) + token + cur.slice(e);
    commit(next);
    requestAnimationFrame(() => {
      try { el.focus(); const c = s + token.length; el.selectionStart = el.selectionEnd = c; } catch (_) { /* noop */ }
    });
  } else {
    commit(cur + token);
  }
}

// Loop context for the selected element: { alias, source } when it sits inside a
// {% for alias in get_*(…) %} loop, else null. Provided by <Inspector>.
const LoopBindingContext = React.createContext(null);

const UICH_IMG_FALLBACK = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='250'%3E%3Crect width='100%25' height='100%25' fill='%23e5e7eb'/%3E%3C/svg%3E";

function uichParseLoopExpr(expr) {
  const m = String(expr || '').match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\s+in\s+(get_[a-z_]+)?/);
  if (!m) return null;
  const SRC = { get_posts: 'post', get_products: 'product', get_users: 'user', get_terms: 'term' };
  return { alias: m[1], source: m[2] ? (SRC[m[2]] || null) : null };
}

function DynamicConnector({ inputRef, value, onCommit, title = 'Insert dynamic value', isImage = false, valueType = '' }) {
  const loop = React.useContext(LoopBindingContext);
  const bound = typeof value === 'string' && value.indexOf('{{') !== -1;
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.UichDD || !window.UichDD.ui || typeof window.UichDD.ui.openValue !== 'function') return;
    // Anchor the picker as a dropdown under the trigger button (the picker
    // renders in this same document, so viewport coords line up).
    let anchor;
    try {
      const r = e.currentTarget.getBoundingClientRect();
      anchor = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    } catch (_) { anchor = undefined; }
    window.UichDD.ui.openValue({
      context: UICH_DD_CONTEXT,
      anchor,
      // Restrict the picker to values compatible with the edited field: 'url'
      // (Link field) shows only URL-typed values / drillable providers; 'text'
      // (content field) hides URL-typed values (URLs have their own Link field).
      valueType: valueType || undefined,
      loopAlias: loop && loop.alias ? loop.alias : '',
      loopSource: loop && loop.source ? loop.source : '',
      onInsert: (t) => {
        let expr = String(t == null ? '' : t).trim();
        const wrapped = /^\{\{[\s\S]*\}\}$/.test(expr);
        if (wrapped) expr = expr.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
        if (isImage && loop && loop.alias && !/\|\s*default\s*\(/.test(expr)) {
          expr += " | default('" + UICH_IMG_FALLBACK + "')";
        }
        const token = '{{ ' + expr + ' }}';
        const el = inputRef && inputRef.current ? inputRef.current : null;
        uichInsertTokenAtCaret(el, value, token, onCommit);
      },
    });
  };
  return (
    <button
      type="button"
      className={`element-editor-dyn-btn${bound ? ' is-bound' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={open}
      title={title}
      aria-label={title}
    >
      <I.dynamic size={14} />
    </button>
  );
}

const U = UNITS;

// Length keywords (fit-content, auto, …) are complete values with no numeric
// part. Picking one from the unit pill must store the keyword as the value so
// the property is owned (and serialises) even when the number field is empty.
const LENGTH_KEYWORD_UNITS = new Set([
  'auto', 'fit-content', 'max-content', 'min-content', 'none',
]);

// Shared Tailwind recipes for restyled inspector controls.
const MICRO_LABEL_CLS = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const SEG_WRAP_CLS = 'inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5';
const SEG_ITEM_CLS = 'flex h-6 min-w-7 items-center justify-center rounded-sm px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground';
const SEG_ITEM_ON_CLS = 'bg-background text-foreground shadow-sm';
/* On a `seg-slide` track the wrapper draws the chip and it travels, so the
   active item keeps only its ink — `bg-background` + `shadow-sm` here would
   paint a second, stationary chip on top of the moving one. */
const SEG_ITEM_ON_SLIDE_CLS = 'text-foreground';

// Anchored dropdown menu that renders into the scoped portal root instead of an
// `absolute` child, so it is never clipped by the panel's overflow (the header
// dropdowns sit in a scrolling/overflow-hidden panel, an in-flow menu gets cut
// off). Right-aligned to the trigger by default; flips above / clamps to the
// viewport when it would overflow. Mirrors the tag-modify dropdown pattern.
function DropdownMenuLayer({ triggerRef, open, onClose, align = 'end', minWidth = 160, className, children }) {
  const menuRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);

  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const win = trigger.ownerDocument?.defaultView || window;
    const rect = trigger.getBoundingClientRect();
    const menu = menuRef.current;
    const mw = Math.max(minWidth, menu?.offsetWidth || minWidth);
    const mh = menu?.offsetHeight || 0;
    let left = align === 'end' ? rect.right - mw : rect.left;
    left = Math.min(Math.max(4, left), Math.max(4, win.innerWidth - mw - 4));
    let top = rect.bottom + 4;
    if (mh && top + mh > win.innerHeight - 8) {
      const above = rect.top - 4 - mh;
      top = above >= 8 ? above : Math.max(8, win.innerHeight - mh - 8);
    }
    setPos({ top, left });
  }, [align, minWidth, triggerRef]);

  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    reposition();
    const trigger = triggerRef.current;
    const win = trigger?.ownerDocument?.defaultView || window;
    const onDoc = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    win.addEventListener('scroll', reposition, true);
    win.addEventListener('resize', reposition);
    win.document.addEventListener('mousedown', onDoc);
    win.document.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('scroll', reposition, true);
      win.removeEventListener('resize', reposition);
      win.document.removeEventListener('mousedown', onDoc);
      win.document.removeEventListener('keydown', onKey);
    };
  }, [open, reposition, onClose, triggerRef]);

  const portalDoc = triggerRef.current?.ownerDocument || null;
  if (!open || !portalDoc?.body) return null;
  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className={cn('rounded-md border bg-popover p-1 text-popover-foreground shadow-md', className)}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        minWidth,
        zIndex: 2147483646,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    ensurePortalRoot(portalDoc),
  );
}
const TEXTAREA_CLS = 'flex w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
// Ghost "+" add-trigger (minimal skin): borderless, soft-bg on hover. The large
// empty-state variant re-adds a dashed boundary at its call site. [ui-ux]
const ADD_TRIGGER_CLS = 'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground';
const MONO_BOX_CLS = 'flex h-8 w-full items-center rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring';
const MONO_INPUT_CLS = 'h-full w-full min-w-0 rounded-md bg-transparent px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground';
const CHIP_BASE_CLS = 'inline-flex h-6 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full bg-secondary text-xs font-medium text-secondary-foreground transition-colors';
const CHIP_ON_CLS = 'bg-accent text-accent-foreground ring-1 ring-ring';

// Set of bare class names (no leading dot) that are UiChemy Global Classes,
// gathered from either store: the unified Globals Manager (selectors like
// `.pr-card`) and the legacy standalone Global Classes cache (`{ id }`). Used
// to flag applied-class chips and inherited properties with the Global icon.
function buildUiChemyGlobalClassNames(unified, legacy) {
  const set = new Set();
  (unified || []).forEach((c) => {
    const m = /^\.([\w-]+)$/.exec(String(c?.selector || '').trim());
    if (m) set.add(m[1]);
  });
  (legacy || []).forEach((c) => { if (c && c.id) set.add(String(c.id)); });
  return set;
}

// Whether a scope key resolves to a UiChemy Global Class. Handles pseudo-state
// suffixes (`.pr-card:hover` → `pr-card`); tag/compound/local scopes never are.
function isUiChemyGlobalScopeName(scopeName, names) {
  if (!scopeName || !names || scopeName === 'local') return false;
  const s = String(scopeName);
  if (s.startsWith('tag:') || s.startsWith('compound:')) return false;
  return names.has(s.split(':')[0]);
}


const STATE_DEFS = [
  { id: 'default', label: 'Default' },
  { id: 'hover',   label: 'Hover' },
  { id: 'active',  label: 'Active' },
  { id: 'focus',   label: 'Focus' },
  { id: 'disabled',label: 'Disabled' },
];

const STATE_DATA_GROUPS = ['typography', 'layout', 'spacing', 'background', 'border', 'effects'];

/** True if any property has been set on this scope (any group, any breakpoint). */
function scopeHasAnyData(scope) {
  if (!scope) return false;
  for (const g of STATE_DATA_GROUPS) {
    const bag = scope[g];
    if (bag && typeof bag === 'object') {
      for (const k of Object.keys(bag)) {
        const v = bag[k];
        if (v != null && v !== '') return true;
      }
    }
  }
  if (scope.__globals && Object.keys(scope.__globals).length) return true;
  if (scope.__bpOwn) {
    for (const bk of Object.keys(scope.__bpOwn)) {
      const bag = scope.__bpOwn[bk];
      if (bag && Object.keys(bag).some((k) => !!bag[k])) return true;
    }
  }
  return false;
}

function stateHasData(stateId, activeScope, scopes, parsedScopesByBpKey) {
  if (activeScope === 'local') return false;
  const key = stateId === 'default' ? activeScope : `${activeScope}:${stateId}`;
  // Check live React state first, captures unsaved edits, then fall back
  // to any parsed breakpoint scope so existing CSS shows up immediately.
  if (scopeHasAnyData(scopes && scopes[key])) return true;
  if (parsedScopesByBpKey) {
    for (const bpKey of Object.keys(parsedScopesByBpKey)) {
      if (scopeHasAnyData(parsedScopesByBpKey[bpKey] && parsedScopesByBpKey[bpKey][key])) {
        return true;
      }
    }
  }
  return false;
}

// Pseudo-state selector as a visible segmented control (Default / Hover /
// Active / Focus / Disabled) instead of a dropdown, so every state — and which
// ones already carry overrides (the dot) — is readable at a glance. States only
// apply to a class/tag scope, so the whole control dims on the Local scope.
function StateSegments({ state, setState, activeScope, scopes, parsedScopesByBpKey }) {
  const disabled = activeScope === 'local';

  const dotByState = React.useMemo(() => {
    const out = {};
    for (const s of STATE_DEFS) {
      out[s.id] = stateHasData(s.id, activeScope, scopes, parsedScopesByBpKey);
    }
    return out;
  }, [activeScope, scopes, parsedScopesByBpKey]);

  return (
    <div
      className="state-row"
      title={disabled
        ? 'Select a class to style hover / focus / active states'
        : 'Pseudo-state'}
    >
      <div className={cn(
        'flex w-full items-center gap-0.5 rounded-md bg-secondary p-0.5',
        disabled && 'opacity-50',
      )}>
        {STATE_DEFS.map(s => {
          const on = s.id === state;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1 rounded-sm px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors',
                !disabled && 'hover:text-foreground',
                on && 'bg-background text-foreground shadow-sm',
                disabled && 'cursor-not-allowed',
              )}
              onClick={() => { if (!disabled) setState(s.id); }}
              title={s.label}
            >
              <span className="truncate">{s.label}</span>
              {dotByState[s.id] && !on && (
                <span className="h-1 w-1 shrink-0 rounded-full bg-primary" title="Styles set" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Compact dropdown variant of the pseudo-state selector, so it can share one row
// with the scope/class bar instead of taking a full row of its own. The 2-option
// segmented "readability" is traded for a smaller footer; states-with-data still
// show a dot in the menu. Dims (and won't open) on the Local scope, same as the
// segmented version.
function StateDropdown({ state, setState, activeScope, scopes, parsedScopesByBpKey }) {
  const T = I;
  const disabled = activeScope === 'local';
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef(null);
  const dotByState = React.useMemo(() => {
    const out = {};
    for (const s of STATE_DEFS) out[s.id] = stateHasData(s.id, activeScope, scopes, parsedScopesByBpKey);
    return out;
  }, [activeScope, scopes, parsedScopesByBpKey]);
  const active = STATE_DEFS.find(s => s.id === state) || STATE_DEFS[0];
  const anyOtherHasData = STATE_DEFS.some(s => s.id !== state && dotByState[s.id]);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="state-dd shrink-0"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        title={disabled ? 'Select a class to style hover / focus / active states' : 'Pseudo-state'}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
      >
        <span>{active.label}</span>
        {/* a dot here hints that OTHER states carry styles, without opening the menu */}
        {anyOtherHasData && <span className="h-1 w-1 shrink-0 rounded-full bg-primary" />}
        <T.chevron size={11} />
      </button>
      <DropdownMenuLayer triggerRef={btnRef} open={open && !disabled} onClose={() => setOpen(false)} minWidth={150}>
        {STATE_DEFS.map(s => {
          const on = s.id === state;
          return (
            <button
              key={s.id}
              type="button"
              className={cn(MENU_ITEM_CLS, on && 'font-medium text-foreground')}
              onClick={() => { setState(s.id); setOpen(false); }}
            >
              <span>{s.label}</span>
              {on
                ? <T.check size={12} className="ml-auto" />
                : (dotByState[s.id] && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" title="Styles set" />)}
            </button>
          );
        })}
      </DropdownMenuLayer>
    </>
  );
}

const TEXT_ELEMENT_TAGS = new Set(['h1','h2','h3','h4','h5','h6','p','span','blockquote','strong','em','mark','small','s','u','cite','q','abbr','code','kbd','samp','sub','sup','time','pre']);
const QUICK_TAGS = ['h1','h2','h3','h4','h5','h6','p','span'];
const SUGGESTION_TAGS = ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'a', 'img', 'ul', 'li', 'ol', 'button', 'input', 'textarea', 'label'];

function QuickTagSwitch({ element, setElement }) {
  if (!TEXT_ELEMENT_TAGS.has(element.tag)) return null;
  const T = I;
  const isQuickTag = QUICK_TAGS.includes(element.tag);

  return (
    <div className="quick-tag-switch">
      <span className={MICRO_LABEL_CLS}>TAG</span>
      <div className={cn(SEG_WRAP_CLS, 'min-w-0 overflow-x-auto')}>
        {QUICK_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            className={cn(SEG_ITEM_CLS, 'font-mono', element.tag === tag && SEG_ITEM_ON_CLS)}
            onClick={() => { if (element.tag !== tag) setElement({ ...element, tag }); }}
          >
            {tag}
          </button>
        ))}
        {!isQuickTag && (
          <button
            type="button"
            className={cn(SEG_ITEM_CLS, 'font-mono lowercase', SEG_ITEM_ON_CLS)}
          >
            {element.tag}
          </button>
        )}
      </div>
      <div className="quick-tag-edit-wrapper">
        <TagModifyDropdown
          element={element}
          setElement={setElement}
          className="quick-tag-modify-dd"
          trigger={
            <>
              <T.pencil size={9} style={{ marginRight: '4px' }} />
              <span>Custom…</span>
            </>
          }
        />
      </div>
    </div>
  );
}

const TAG_MENU_W = 200;
const TAG_MENU_H = 280;

function TagModifyDropdown({ element, setElement, className = '', trigger = null, triggerClassName = '' }) {
  const T = I;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [pos, setPos] = React.useState(null);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const listRef = React.useRef(null);

  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const win = trigger.ownerDocument?.defaultView || window;
    const rect = trigger.getBoundingClientRect();
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    let left = rect.left;
    if (left + TAG_MENU_W > vw - 4) left = Math.max(4, vw - TAG_MENU_W - 4);
    let top = rect.bottom + 4;
    if (top + TAG_MENU_H > vh - 8) {
      const above = rect.top - 4 - TAG_MENU_H;
      top = above >= 8 ? above : Math.max(8, vh - TAG_MENU_H - 8);
    }
    setPos({ top, left, width: TAG_MENU_W });
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;
    reposition();
    const trigger = triggerRef.current;
    const win = trigger?.ownerDocument?.defaultView || window;
    const onDoc = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    win.addEventListener('scroll', reposition, true);
    win.addEventListener('resize', reposition);
    win.document.addEventListener('mousedown', onDoc);
    win.document.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('scroll', reposition, true);
      win.removeEventListener('resize', reposition);
      win.document.removeEventListener('mousedown', onDoc);
      win.document.removeEventListener('keydown', onKey);
    };
  }, [open, reposition]);

  function pick(tag) { setOpen(false); setQ(''); setElement({ ...element, tag }); }

  const query = q.trim().toLowerCase();
  const groups = ELEMENT_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => !query || it.tag.toLowerCase().includes(query) || it.label.toLowerCase().includes(query)),
    }))
    .filter((g) => g.items.length > 0);

  const exactCatalogHit = ELEMENT_GROUPS.some((g) => g.items.some((it) => it.tag.toLowerCase() === query));
  const showCustom = !!query && isValidTagName(query) && !exactCatalogHit;

  const flatRows = React.useMemo(() => {
    const rows = [];
    if (showCustom) rows.push({ kind: 'custom', tag: query });
    for (const g of groups) for (const it of g.items) rows.push({ kind: 'catalog', tag: it.tag });
    return rows;
  }, [showCustom, query, groups]);

  React.useEffect(() => { setActiveIndex(flatRows.length > 0 ? 0 : -1); }, [flatRows.length, q]);

  React.useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const list = listRef.current;
    const row = list.querySelector(`[data-row-idx="${activeIndex}"]`);
    if (!row) return;
    const rTop = row.offsetTop;
    const rBot = rTop + row.offsetHeight;
    if (rTop < list.scrollTop) list.scrollTop = rTop;
    else if (rBot > list.scrollTop + list.clientHeight) list.scrollTop = rBot - list.clientHeight;
  }, [activeIndex]);

  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flatRows.length) setActiveIndex((i) => (i + 1) % flatRows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flatRows.length) setActiveIndex((i) => (i <= 0 ? flatRows.length - 1 : i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const row = flatRows[activeIndex] || flatRows[0]; if (row) pick(row.tag); }
  };

  const portalDoc = triggerRef.current?.ownerDocument || null;
  const menuNode = open && pos && portalDoc?.body ? ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="flex max-h-[280px] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 2147483646 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-muted-foreground">
        <T.search size={11} />
        <input
          autoFocus
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Search tags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>
      <div className="tag-menu-list flex-1 overflow-y-auto p-1" ref={listRef} role="listbox">
        {(() => {
          let cursor = 0;
          const customRowIdx = showCustom ? cursor++ : -1;
          return (
            <>
              {showCustom && (
                <button data-row-idx={customRowIdx} type="button"
                  className={cn(MENU_ITEM_CLS, activeIndex === customRowIdx && 'bg-accent text-accent-foreground')}
                  onClick={() => pick(query)} onMouseEnter={() => setActiveIndex(customRowIdx)}
                  role="option" aria-selected={activeIndex === customRowIdx}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"><T.plus size={12} /></span>
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="font-mono text-xs">{`<${query}>`}</span>
                    <span className="text-[11px] text-muted-foreground">Use as custom tag</span>
                  </span>
                </button>
              )}
              {groups.map((group) => (
                <React.Fragment key={group.title}>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</div>
                  {group.items.map((it) => {
                    const Ic = tagIcon(it.tag);
                    const idx = cursor++;
                    const isActive = activeIndex === idx;
                    const isCurrent = element.tag === it.tag;
                    return (
                      <button data-row-idx={idx} key={it.tag} type="button"
                        className={cn(MENU_ITEM_CLS, (isActive || isCurrent) && 'bg-accent text-accent-foreground')}
                        onClick={() => pick(it.tag)} onMouseEnter={() => setActiveIndex(idx)}
                        role="option" aria-selected={isActive}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"><Ic size={12} /></span>
                        <span className="flex min-w-0 flex-col items-start">
                          <span className="font-mono text-xs">{`<${it.tag}>`}</span>
                          <span className="text-[11px] text-muted-foreground">{it.label}</span>
                        </span>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
              {groups.length === 0 && !showCustom && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">No tags match "{q}".</div>
              )}
            </>
          );
        })()}
      </div>
    </div>,
    ensurePortalRoot(portalDoc),
  ) : null;

  return (
    <div className={`tag-modify-dd${open ? ' open' : ''} ${className}`}>
      <button
        ref={triggerRef}
        className={trigger
          ? cn(
              'inline-flex h-6 items-center rounded-md px-2 text-xs transition-colors',
              triggerClassName || 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              open && 'bg-accent text-accent-foreground',
            )
          : 'tag-modify-btn'}
        type="button"
        title="Change element tag"
        onClick={() => { setOpen((o) => !o); setQ(''); }}
      >
        {trigger || <T.pencil size={10} />}
      </button>
      {menuNode}
    </div>
  );
}

// NOTE: The in-panel breakpoint switcher (BreakpointDropdown) and its editor-
// detection helper were removed. Inside the Elementor editor its top bar already
// switches devices; on the published front end there's no Elementor device
// machinery for it to drive. Device state still syncs from Elementor via
// useElementorDeviceMode (see the header render site).

// Specialised editors for `<img>` and `<svg>` selections.
//
// The image editor mirrors the legacy controls: a URL input + a "Browse
// media" button that opens the WordPress media library frame and writes
// the selected attachment's URL back through `setElement({ src })`. The
// SVG editor exposes the element's full outerHTML in a textarea so users
// can hand-edit the markup; on save it replaces the node in raw_html.
function ImageEditor({ element, setElement, selectedEntry }) {
  const T = I;
  const srcAttr = (selectedEntry && selectedEntry.attrs && selectedEntry.attrs.src) || '';
  const altAttr = (selectedEntry && selectedEntry.attrs && selectedEntry.attrs.alt) || '';
  const [src, setSrc] = React.useState(srcAttr);
  const [alt, setAlt] = React.useState(altAttr);
  const lastSrcRef = React.useRef(srcAttr);
  const lastAltRef = React.useRef(altAttr);
  // Selection identity. The ref-guarded sync below only re-runs when srcAttr /
  // altAttr change, which is exactly what a rejected write does NOT do, the
  // local state would then stay on the picked-but-never-committed value with no
  // way back. Re-selecting the same element must always hard-resync from
  // raw_html (mirrors the other editors, which key their sync on entry id).
  const entryId = (selectedEntry && selectedEntry.id) || null;
  const lastEntryRef = React.useRef(entryId);

  React.useEffect(() => {
    const entryChanged = entryId !== lastEntryRef.current;
    if (entryChanged) lastEntryRef.current = entryId;
    if (entryChanged || srcAttr !== lastSrcRef.current) {
      setSrc(srcAttr);
      lastSrcRef.current = srcAttr;
    }
    if (entryChanged || altAttr !== lastAltRef.current) {
      setAlt(altAttr);
      lastAltRef.current = altAttr;
    }
  }, [entryId, srcAttr, altAttr]);

  // `dims`, the chosen attachment's intrinsic size, when the media library
  // gave us one. Passed through so the new file's width/height replace the
  // previous file's instead of being left behind (see setElement).
  function commitSrc(next, dims) {
    setSrc(next);
    lastSrcRef.current = next;
    const patch = { ...element, src: next };
    const w = dims && parseInt(dims.width, 10);
    const h = dims && parseInt(dims.height, 10);
    if (w > 0 && h > 0) {
      patch.srcWidth = w;
      patch.srcHeight = h;
    }
    setElement(patch);
  }
  function commitAlt(next) {
    setAlt(next);
    lastAltRef.current = next;
    setElement({ ...element, alt: next });
  }

  function openMediaLibrary() {
    // Resolve the WP media library frame. The React composer runs in the
    // top frame; `window.wp.media` is the WordPress-bundled global.
    // Accepts images and SVGs, browsers render both natively inside <img>.
    const wpMedia = (typeof window !== 'undefined' && window.wp && window.wp.media) ||
      (typeof window !== 'undefined' && window.top && window.top.wp && window.top.wp.media);
    if (!wpMedia) return;
    const frame = wpMedia({
      title: 'Choose image',
      multiple: false,
      library: { type: 'image' },
      button: { text: 'Use this image' },
    });
    frame.on('select', () => {
      const att = frame.state().get('selection').first();
      if (!att) return;
      const json = att.toJSON();
      if (json && json.url) commitSrc(json.url, { width: json.width, height: json.height });
      if (json && typeof json.alt === 'string' && !lastAltRef.current) commitAlt(json.alt);
    });
    frame.open();
  }

  // Dynamic binding for the image SOURCE, mirrors the Background image field:
  // a {{ … }} token in src (e.g. {{ post.thumbnail.src('large') }}) shows a
  // readable chip; the ⚡ picker (valueType 'image') writes the picked value.
  // Unlike the CSS background (url({{ … }})), an <img> src is a plain URL, so
  // the token is written bare.
  const dynMatch = String(src == null ? '' : src).match(/\{\{\s*([\s\S]*?)\s*\}\}/);
  const dynExpr  = dynMatch ? dynMatch[1].trim() : null;
  const dynLabel = React.useMemo(() => {
    if (!dynExpr) return null;
    try {
      const C = window.UichDD && window.UichDD.compile;
      if (C && C.parseBinding && C.bindingLabel) {
        const l = C.bindingLabel(C.parseBinding('{{ ' + dynExpr + ' }}'), window.UichDD && window.UichDD.schema);
        if (l) return l;
      }
    } catch (_) { /* fall back to the raw expression */ }
    return dynExpr;
  }, [dynExpr]);

  function openDynamicPicker(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.UichDD || !window.UichDD.ui || typeof window.UichDD.ui.openValue !== 'function') return;
    let anchor;
    try {
      const r = e.currentTarget.getBoundingClientRect();
      anchor = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    } catch (_) { anchor = undefined; }
    window.UichDD.ui.openValue({
      context: ['post', 'product', 'user', 'site', 'request'],
      anchor,
      valueType: 'image',
      onInsert: (t) => {
        let expr = String(t == null ? '' : t).trim();
        if (/^\{\{[\s\S]*\}\}$/.test(expr)) expr = expr.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
        commitSrc('{{ ' + expr + ' }}');
      },
    });
  }

  return (
    <div className="element-editor element-editor-media">
      <div className="element-editor-media-grid">
        <div className="element-editor-media-left">
          {/* Preview works for both raster images and SVG URLs / data-URIs */}
          <MediaPreviewButton
            src={dynExpr ? '' : src}
            emptyLabel={dynExpr ? 'Dynamic image' : 'No image selected'}
            overlayLabel="Change Image"
            onPick={openMediaLibrary}
            onRemove={src && !dynExpr ? () => commitSrc('') : undefined}
            disabled={!!dynExpr}
          />
          <div className="element-editor-field-stack">
            <div className="element-editor-row">
              <span className={MICRO_LABEL_CLS}>SOURCE</span>
              {dynExpr ? (
                <div
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-sm"
                  title={String(src).trim()}
                >
                  <T.dynamic size={13} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{dynLabel}</span>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => commitSrc('')}
                    title="Remove dynamic value"
                    aria-label="Remove dynamic value"
                  >
                    <T.x size={12} />
                  </button>
                </div>
              ) : (
                <>
                  {/* Dynamic-image picker (⚡) sits inside the input's right edge,
                      matching the Background image field. */}
                  <div className="element-editor-input relative min-w-0 flex-1">
                    <input
                      type="text"
                      className={INPUT_CLS + ' w-full pr-9'}
                      value={src}
                      placeholder="https://… (image or .svg)"
                      onChange={(e) => commitSrc(e.target.value)}
                    />
                    <button
                      type="button"
                      className="element-editor-dyn-btn absolute right-1 top-1/2 -translate-y-1/2"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={openDynamicPicker}
                      title="Insert dynamic image value"
                      aria-label="Insert dynamic image value"
                    >
                      <T.dynamic size={14} />
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 px-2.5 text-xs"
                    onClick={openMediaLibrary}
                    title="Choose from media library"
                  >
                    <T.image size={11} /> Media
                  </Button>
                </>
              )}
            </div>
            <div className="element-editor-row">
              <span className={MICRO_LABEL_CLS}>ALT</span>
              <div className="element-editor-input">
                <input
                  type="text"
                  className={INPUT_CLS}
                  value={alt}
                  placeholder="Alt text"
                  onChange={(e) => commitAlt(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function seedSvgDrafts(rawHtml, path, layerState) {
  const url = layerState?.sourceUrl || '';
  if (layerState?.mode === 'url' && !url) {
    return { url: '', code: '' };
  }
  const code = layerState?.mode === 'code' && layerState.markup
    ? layerState.markup
    : (getSvgOuterHtml(rawHtml, path) || '');
  return { url, code };
}

function SvgEditor({
  rawHtml,
  element,
  setElement,
  selectedEntry,
  onSvgUrl,
}) {
  const T = I;
  const layerState = React.useMemo(
    () => (selectedEntry ? readSvgLayerState(rawHtml, selectedEntry.path) : null),
    [rawHtml, selectedEntry],
  );

  const initial = React.useMemo(
    () => seedSvgDrafts(rawHtml, selectedEntry?.path, layerState),
    [rawHtml, selectedEntry, layerState],
  );

  const [codeDraft, setCodeDraft] = React.useState(initial.code);
  const [urlDraft, setUrlDraft] = React.useState(initial.url);
  const [status, setStatus] = React.useState('');
  const lastPropRef = React.useRef('');
  const urlDebounceRef = React.useRef(null);
  const codeDebounceRef = React.useRef(null);

  React.useEffect(() => {
    const key = JSON.stringify(layerState);
    if (!layerState || key === lastPropRef.current) return;
    lastPropRef.current = key;
    const next = seedSvgDrafts(rawHtml, selectedEntry.path, layerState);
    setCodeDraft(next.code);
    setUrlDraft(next.url);
    setStatus('');
  }, [layerState, rawHtml, selectedEntry]);

  React.useEffect(() => () => {
    if (urlDebounceRef.current) clearTimeout(urlDebounceRef.current);
    if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
  }, []);

  function commitCode(markupRaw) {
    const markup = String(markupRaw != null ? markupRaw : codeDraft || '').trim();
    if (!markup) {
      setStatus('');
      setElement({ ...element, outerHtml: '<svg></svg>' });
      lastPropRef.current = '';
      return;
    }
    if (!/^\s*<(svg|img)\b/i.test(markup)) {
      setStatus('Markup must start with <svg> or <img>.');
      return;
    }
    setStatus('');
    setElement({ ...element, outerHtml: markup });
    lastPropRef.current = '';
  }

  function scheduleCodeCommit(nextCode) {
    if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
    codeDebounceRef.current = setTimeout(() => commitCode(nextCode), 400);
  }

  function pushUrl(nextUrl) {
    const trimmed = String(nextUrl || '').trim();
    setUrlDraft(trimmed);
    setStatus('');
    if (onSvgUrl) onSvgUrl(trimmed);
    else setElement({ ...element, svgUrl: trimmed });
    lastPropRef.current = '';
  }

  function scheduleUrlCommit(nextUrl) {
    if (urlDebounceRef.current) clearTimeout(urlDebounceRef.current);
    urlDebounceRef.current = setTimeout(() => pushUrl(nextUrl), 400);
  }

  function openSvgMediaLibrary() {
    const wpMedia = (typeof window !== 'undefined' && window.wp && window.wp.media) ||
      (typeof window !== 'undefined' && window.top && window.top.wp && window.top.wp.media);
    if (!wpMedia) {
      setStatus('WordPress media library is unavailable.');
      return;
    }
    const frame = wpMedia({
      title: 'Select SVG',
      multiple: false,
      library: { type: 'image/svg+xml' },
      button: { text: 'Use this file' },
    });
    frame.on('select', () => {
      const att = frame.state().get('selection').first();
      if (!att) return;
      const json = att.toJSON();
      const url = (json && json.url) ? String(json.url).trim() : '';
      if (!url) {
        setStatus('Could not read URL from selected file.');
        return;
      }
      if (!isSvgMediaAttachment(json)) {
        setStatus('Only SVG files are allowed.');
        return;
      }
      setStatus('');
      pushUrl(url);
    });
    frame.open();
  }

  // Derive a displayable src for the preview:
  // 1. SVG URL → use directly (browsers render .svg in <img>)
  // 2. Inline <svg> code → convert to data-URI so <img> can display it
  const previewSrc = React.useMemo(() => {
    if (urlDraft) return urlDraft;
    const code = String(codeDraft || '').trim();
    if (code && /^\s*<svg\b/i.test(code)) {
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(code);
    }
    return '';
  }, [urlDraft, codeDraft]);

  return (
    <div className="element-editor element-editor-media is-svg">
      {/* Preview, same style as ImageEditor */}
      <MediaPreviewButton
        src={previewSrc}
        emptyLabel="No SVG selected"
        overlayLabel="Change SVG"
        onPick={openSvgMediaLibrary}
        onRemove={previewSrc ? () => { pushUrl(''); setCodeDraft(''); setStatus(''); } : undefined}
      />
      <div className="element-editor-row">
        <span className={MICRO_LABEL_CLS}>URL</span>
        <div className="element-editor-input">
          <input
            type="url"
            className={INPUT_CLS}
            value={urlDraft}
            placeholder="https://example.com/icon.svg"
            onChange={(e) => {
              const v = e.target.value;
              setUrlDraft(v);
              setStatus('');
              scheduleUrlCommit(v);
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5 text-xs"
          onClick={openSvgMediaLibrary}
          title="Choose SVG from WordPress media library"
        >
          <T.image size={11} /> Media
        </Button>
      </div>

      <div className="element-editor-media-code">
        <span className={MICRO_LABEL_CLS}>SVG Code</span>
        <textarea
          className={cn(TEXTAREA_CLS, 'min-h-[90px] resize-y font-mono text-xs')}
          spellCheck={false}
          value={codeDraft}
          placeholder="<svg>...</svg>"
          onChange={(e) => {
            const v = e.target.value;
            setCodeDraft(v);
            setStatus('');
            scheduleCodeCommit(v);
          }}
          rows={7}
        />
        <div className="element-editor-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => {
              if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
              const next = seedSvgDrafts(rawHtml, selectedEntry.path, layerState);
              setCodeDraft(next.code);
              setUrlDraft(next.url);
              setStatus('');
              if (next.code) commitCode(next.code);
            }}
          >Reset</Button>
        </div>
      </div>

      {status ? <p className="mt-1.5 text-xs text-destructive">{status}</p> : null}
    </div>
  );
}

// Textarea for editing the selected element's direct text content.
//
// Why a dedicated local-state component? The user reported the textarea
// "reverts after typing": each keystroke writes through `setElement` →
// raw_html → re-parse → element.text. Sometimes the re-parse lands a
// value that's identical-but-not-stricly-equal to what the user just
// typed (e.g. when the parent has whitespace text-node siblings), or
// React's controlled-input reconciliation snaps the value back during
// the round-trip. Holding the typed value in local state and only
// re-seeding from props when the SELECTED ENTRY changes makes the
// user's keystrokes authoritative for the lifetime of the selection.
function AnchorLinkEditor({ link, onChange, disabled, embedded = false, isAnchor = true }) {
  const [draft, setDraft] = React.useState(() => ({
    url: String(link?.url || ''),
    is_external: link?.is_external === 'on' ? 'on' : '',
    nofollow: link?.nofollow === 'on' ? 'on' : '',
    custom_attributes: String(link?.custom_attributes || ''),
  }));
  const lastPropRef = React.useRef(JSON.stringify(draft));
  const debounceRef = React.useRef(null);
  const urlInputRef = React.useRef(null);

  // When the URL holds a single dynamic binding ({{ post.link }}), show a
  // readable chip instead of the raw Twig token (mirrors the Text field).
  const urlDynLabel = React.useMemo(() => {
    const s = String(draft.url == null ? '' : draft.url).trim();
    if (!/^\{\{[\s\S]*\}\}$/.test(s)) return null;
    let label = s.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
    try {
      const C = window.UichDD && window.UichDD.compile;
      if (C && C.parseBinding && C.bindingLabel) {
        const l = C.bindingLabel(C.parseBinding(s), window.UichDD && window.UichDD.schema);
        if (l) label = l;
      }
    } catch (_) { /* fall back to the raw expression */ }
    return label;
  }, [draft.url]);

  React.useEffect(() => {
    const incoming = {
      url: String(link?.url || ''),
      is_external: link?.is_external === 'on' ? 'on' : '',
      nofollow: link?.nofollow === 'on' ? 'on' : '',
      custom_attributes: String(link?.custom_attributes || ''),
    };
    const key = JSON.stringify(incoming);
    if (key === lastPropRef.current) return;
    setDraft(incoming);
    lastPropRef.current = key;
  }, [link]);

  React.useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function commit(next) {
    lastPropRef.current = JSON.stringify(next);
    onChange?.(next);
  }

  function update(patch, debounce) {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (debounce) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => commit(next), 400);
      } else {
        commit(next);
      }
      return next;
    });
  }

  return (
    <div className={cn('text-row', embedded && 'is-embedded')}>
      {/* Match the TEXT field: label + dynamic (⚡) icon on the header line, then
          the chip / input spanning the full width below. */}
      <div className="text-row-head">
        <span className={MICRO_LABEL_CLS}>{embedded ? 'URL' : 'LINK'}</span>
        {!urlDynLabel && !disabled && (
          <DynamicConnector
            inputRef={urlInputRef}
            value={draft.url}
            onCommit={(v) => update({ url: v }, false)}
            valueType="url"
            title="Insert dynamic URL"
          />
        )}
      </div>
      {urlDynLabel ? (
        <div
          className="flex w-full items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-sm"
          title={String(draft.url).trim()}
        >
          <I.dynamic size={13} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{urlDynLabel}</span>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => update({ url: '' }, false)}
            disabled={disabled}
            title="Remove dynamic URL"
            aria-label="Remove dynamic URL"
          >
            <I.x size={12} />
          </button>
        </div>
      ) : (
        // Match the Typography property inputs: the border lives on the <div>
        // wrapper (Tailwind `border-input`, which the Elementor editor panel
        // doesn't reset like it does a bare <input>), and the inner input is
        // transparent + borderless. Keeps the LINK field visually in sync with
        // the length/select fields below.
        <div className="flex h-9 w-full items-center rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
          <input
            ref={urlInputRef}
            type="url"
            className="h-full w-full min-w-0 flex-1 rounded-md bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            value={draft.url}
            placeholder="https://example.com"
            disabled={disabled}
            onChange={(e) => update({ url: e.target.value }, true)}
          />
        </div>
      )}
      <div className="element-editor-link-toggles">
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <input
            type="checkbox"
            className="uich-check"
            checked={draft.is_external === 'on'}
            disabled={disabled}
            onChange={(e) => update({ is_external: e.target.checked ? 'on' : '' }, false)}
          />
          <span>Open in new tab</span>
        </label>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <input
            type="checkbox"
            className="uich-check"
            checked={draft.nofollow === 'on'}
            disabled={disabled}
            onChange={(e) => update({ nofollow: e.target.checked ? 'on' : '' }, false)}
          />
          <span>nofollow</span>
        </label>
      </div>
      {/* Custom link attributes are only carried through for real <a> elements
          (applyLinkToAnchor). A non-anchor link is materialised as an <a> at
          render from data-uich-link* markers, which don't carry custom attrs –
          so hide the field there rather than show a control that does nothing. */}
      {isAnchor && (
        <>
          <div className="element-editor-row">
            <span className={MICRO_LABEL_CLS}>ATTRS</span>
          </div>
          <textarea
            className={cn(TEXTAREA_CLS, 'min-h-[60px] resize-y font-mono text-xs')}
            spellCheck={false}
            rows={3}
            value={draft.custom_attributes}
            placeholder="data-id|123 || aria-label|Read more"
            disabled={disabled}
            onChange={(e) => update({ custom_attributes: e.target.value }, true)}
          />
        </>
      )}
    </div>
  );
}

// Strip leading/trailing pretty-print formatting whitespace, a run that
// contains a newline, so indented source HTML like `<p>\n  Text\n</p>`
// doesn't render a blank first line in the editor. A lone significant
// inline space (no newline) is left intact.
export function stripFormattingWhitespace(t) {
  return String(t || '').replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, '');
}

function ElementTextField({ element, setElement }) {
  const [draft, setDraft] = React.useState(() => stripFormattingWhitespace(element.text));
  const textRef = React.useRef(null);
  // `lastUserSetRef` records the visible value the user actually typed;
  // when an *external* change comes in via props (e.g. user picks another
  // layer), the draft is reseeded. `originalRef` keeps the untrimmed
  // incoming value so an unchanged field commits byte-identical and
  // triggers no raw_html rewrite (see setElement's text diff).
  const lastUserSetRef = React.useRef(stripFormattingWhitespace(element.text));
  const originalRef = React.useRef(element.text || '');

  React.useEffect(() => {
    const incoming = element.text || '';
    const shown = stripFormattingWhitespace(incoming);
    if (shown !== lastUserSetRef.current) {
      setDraft(shown);
      lastUserSetRef.current = shown;
      originalRef.current = incoming;
    }
  }, [element.text]);

  const commit = (v) => {
    setDraft(v);
    lastUserSetRef.current = v;
    // If the visible text is unchanged from the original (ignoring only the
    // stripped formatting whitespace), write back the ORIGINAL so the node's
    // indentation is preserved and no rewrite fires.
    const next = v === stripFormattingWhitespace(originalRef.current) ? originalRef.current : v;
    setElement({ ...element, text: next });
  };

  // When the text is a single dynamic binding ({{ … }}), show a readable chip
  // (e.g. "Post · Title") instead of the raw Twig token. While bound we hide the
  // picker button + textarea; the ✕ clears the binding so the plain field returns.
  const dynChipLabel = React.useMemo(() => {
    const s = String(draft == null ? '' : draft).trim();
    if (!/^\{\{[\s\S]*\}\}$/.test(s)) return null;
    let label = s.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
    try {
      const C = window.UichDD && window.UichDD.compile;
      if (C && C.parseBinding && C.bindingLabel) {
        const l = C.bindingLabel(C.parseBinding(s), window.UichDD && window.UichDD.schema);
        if (l) label = l;
      }
    } catch (_) { /* fall back to the raw expression */ }
    return label;
  }, [draft]);

  // Loop / condition CONTROL markup ({% for %}…{% endfor %}, {% if %}…) sits as
  // text on the container element. It is not editable content, so show a muted
  // read-only note instead of dumping raw Twig into the editable textarea.
  const isControlOnly = React.useMemo(() => {
    const s = String(draft == null ? '' : draft).trim();
    if (s.indexOf('{%') === -1) return false;
    return s.replace(/\{%[\s\S]*?%\}/g, '').trim() === '';
  }, [draft]);

  // For a control-only container, surface WHICH construct it runs (the loop /
  // condition expression) so the user sees the loop right here on the element.
  const controlLabel = React.useMemo(() => {
    const s = String(draft == null ? '' : draft);
    let m = s.match(/\{%\s*for\s+([\s\S]*?)\s*%\}/);
    if (m) return { kind: 'Loop', expr: m[1].trim() };
    m = s.match(/\{%\s*if\s+([\s\S]*?)\s*%\}/);
    if (m) return { kind: 'Condition', expr: m[1].trim() };
    return { kind: 'Control markup', expr: '' };
  }, [draft]);

  // <uichemy-nav-menu>/<uichemy-toc> stand a SINGLE curly-brace placeholder
  // (`{nav_item}`, `{sub_item}`) directly as this element's text — their own
  // template syntax, distinct from `{{ data }}` bindings and `{% %}` control
  // markup, both already handled above. It marks "PHP fills this node's real
  // rendered content in here" — there is no element to hold it, so it is not
  // user text to edit: committing over it would replace the token in raw_html
  // and silently break that item's substitution for every rendered instance.
  // Style (Typography/CSS) on this SAME entry still applies normally — only
  // the raw token is locked.
  const dynPlaceholder = React.useMemo(
    () => isDynamicPlaceholderText(draft),
    [draft],
  );

  return (
    <div className="text-row">
      {/* No header line. It carried a "Text" micro-label and the dynamic-value
          icon; the label restated the section it already sits in (Content ▸ the
          only field ▸ placeholder "Inner content of this element…"), and the icon
          has moved into the textarea's bottom-right corner, where it belongs to
          the field it acts on instead of floating above it. The chip branches
          below never rendered the icon anyway — they own their own remove
          button — so it only ever needed to exist for the textarea. */}
      {isControlOnly ? (
        // This element's own content is ONLY {% for %}/{% if %} control markup that
        // wraps a child (e.g. a grid div wrapping the looped card). It is NOT the
        // marked loop/condition itself, that lives on the child inside, so show a
        // muted, clearly-a-container note (not a loop-colored "Loop" chip, which
        // read as "this element is the loop" and confused authors).
        <div
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-input bg-muted/30 px-2.5 py-1.5"
          title={`This element only wraps a ${controlLabel.kind === 'Condition' ? 'condition' : controlLabel.kind === 'Loop' ? 'loop' : 'control block'}. It isn't the ${controlLabel.kind === 'Condition' ? 'condition' : 'loop'} itself, select the item inside it to edit that.`}
        >
          <I.dynamic size={13} className="shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Wraps a {controlLabel.kind === 'Condition' ? 'condition' : controlLabel.kind === 'Loop' ? 'loop' : 'control block'} · edit on the item inside
          </span>
        </div>
      ) : dynPlaceholder ? (
        // A raw `{nav_item}`-style placeholder — the rendered menu link/text
        // PHP substitutes in, not literal content. Style it via Typography/
        // Border/etc. on this same element; the text itself is locked.
        <div
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-input bg-muted/30 px-2.5 py-1.5"
          title="This is the dynamically rendered menu text — its wording comes from the menu item itself and can't be edited here. Style it with Typography, Border, etc. on this element."
        >
          <I.dynamic size={13} className="shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Dynamic menu text · style it below, wording isn't editable
          </span>
        </div>
      ) : dynChipLabel ? (
        <div
          className="flex w-full items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-sm"
          title={String(draft).trim()}
        >
          <I.dynamic size={13} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{dynChipLabel}</span>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => commit('')}
            title="Remove dynamic value"
            aria-label="Remove dynamic value"
          >
            <I.x size={12} />
          </button>
        </div>
      ) : (
        // The connector is absolutely positioned inside this wrapper, so the
        // textarea reserves the corner via padding-bottom (see .text-row-area in
        // composer.css) and a long value never runs under the button.
        <div className="text-row-area">
          <textarea
            ref={textRef}
            className={cn(TEXTAREA_CLS, 'max-h-[140px] min-h-[60px] w-full resize-none')}
            value={draft}
            onChange={(e) => commit(e.target.value)}
            placeholder="Inner content of this element…"
            rows={2}
          />
          <span className="text-row-area-dyn">
            <DynamicConnector inputRef={textRef} value={draft} onCommit={commit} valueType="text" title="Insert dynamic value into text" />
          </span>
        </div>
      )}
    </div>
  );
}

// style/class/href/target and the Link field's data-uich-link* markers are
// owned by other controls in the panel (the class strip, the Style props, the
// Link editor), so the raw attribute list must neither list nor write them.
// One predicate, used by the read filter, the write filter and the section's
// dirty dot, so the three can't drift apart.
const RESERVED_ATTR_NAMES = ['style', 'class', 'href', 'target'];
function isEditableAttrName(name) {
  const n = String(name == null ? '' : name).trim().toLowerCase();
  if (!n) return false;
  return !RESERVED_ATTR_NAMES.includes(n) && n.indexOf('data-uich-link') !== 0;
}
function countEditableAttrs(entry) {
  const attrs = (entry && entry.attrs) || {};
  return Object.keys(attrs).filter(isEditableAttrName).length;
}

function ElementAttributeEditor({ selectedEntry, setElement }) {
  const allAttrs = selectedEntry ? (selectedEntry.attrs || {}) : {};
  
  // Local state for smooth typing and fast updates without cursor jumps
  const [localAttrs, setLocalAttrs] = React.useState([]);

  // Sync with selectedEntry attrs whenever the selected entry changes
  React.useEffect(() => {
    const editable = Object.keys(allAttrs)
      .filter(isEditableAttrName)
      .map(name => ({ name, value: allAttrs[name] || '' }));
    setLocalAttrs(editable);
  }, [selectedEntry?.id]);

  function commitChanges(attrsList = localAttrs) {
    if (!selectedEntry) return;
    const finalAttrs = {};
    for (const item of attrsList) {
      const name = item.name.trim();
      if (!name) continue;
      if (!isEditableAttrName(name)) continue;
      finalAttrs[name] = item.value;
    }
    setElement({ attrs: finalAttrs });
  }

  function handleAdd() {
    setLocalAttrs(prev => [...prev, { name: '', value: '' }]);
  }

  function handleRemove(idx) {
    const next = localAttrs.filter((_, i) => i !== idx);
    setLocalAttrs(next);
    commitChanges(next);
  }

  function handleChangeName(idx, newName) {
    setLocalAttrs(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], name: newName };
      return next;
    });
  }

  function handleChangeValue(idx, newValue) {
    setLocalAttrs(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], value: newValue };
      return next;
    });
  }

  const T = I;

  // Renders as a section body (like Typography / Spacing), so it carries no
  // heading of its own and no bottom rule — the accordion row / tab already
  // names it, and `.section` owns the padding.
  return (
    <div className="section attribute-editor-box">
      <div className="min-w-0">
      {localAttrs.length === 0 ? (
        <div className="w-full">
          {/* An empty list is one line of prompt, not a 200px-tall dashed slab —
              this panel is ~260px wide and that box pushed everything below it
              off-screen. */}
          <button className={cn(ADD_TRIGGER_CLS, 'justify-center border border-dashed border-input hover:border-ring')} onClick={handleAdd}>
            <T.plus size={11} />
            <span>Add Attribute</span>
          </button>
        </div>
      ) : (
        <>
          {/* Header labels ONCE, not per row.
              Every row used to carry its own "Attribute Name" and "Value" label,
              each wrapped in the legacy `field pf` / `pf-label` /
              `prop-input-stack` scaffolding. That CSS is written for PropField's
              markup, and reusing it by hand here left the labels sitting beside
              their inputs instead of above them — in a ~260px panel the two
              labels then ate the width and both inputs collapsed to a sliver.
              Plain markup, one header, and inputs that cannot shrink below a
              usable width. */}
          <div className="mb-1.5 flex items-center gap-2 pr-6">
            <span className={cn(MICRO_LABEL_CLS, 'min-w-[84px] flex-1')}>Name</span>
            <span className={cn(MICRO_LABEL_CLS, 'min-w-[84px] flex-1')}>Value</span>
          </div>

          <div className="mb-3 flex flex-col gap-2">
            {localAttrs.map((attr, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className={cn(MONO_BOX_CLS, 'min-w-[84px] flex-1')}>
                  <input
                    className={MONO_INPUT_CLS}
                    value={attr.name}
                    onChange={(e) => handleChangeName(idx, e.target.value)}
                    onBlur={() => commitChanges()}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); commitChanges(); } }}
                    placeholder="data-custom"
                    aria-label="Attribute name"
                    spellCheck={false}
                  />
                </div>

                <div className={cn(MONO_BOX_CLS, 'min-w-[84px] flex-1')}>
                  <input
                    className={MONO_INPUT_CLS}
                    value={attr.value}
                    onChange={(e) => handleChangeValue(idx, e.target.value)}
                    onBlur={() => commitChanges()}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); commitChanges(); } }}
                    placeholder="value"
                    aria-label="Attribute value"
                    spellCheck={false}
                  />
                </div>

                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  onClick={() => handleRemove(idx)}
                  title="Remove attribute"
                  aria-label="Remove attribute"
                >
                  <T.x size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="w-full">
            <button className={ADD_TRIGGER_CLS} onClick={handleAdd}>
              <T.plus size={11} />
              <span>Add Attribute</span>
            </button>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function AppliedClasses({
  element, setElement,
  scopes, setScopes,
  activeScope, setActiveScope,
  globals,
  isMedia,
  selectedEntry,
  state, setState,
  parsedScopesByBpKey,
  localScopeNeedsClass = false,
}) {
  const T = I;
  const [adding, setAdding] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  // Tracks whether the user has explicitly clicked a class chip (not just auto-selected).
  // Backspace-to-remove only fires when this is true, preventing accidental removal
  // when the user focuses the input to add a new class.
  const explicitChipClickRef = React.useRef(false);
  const addInputRef = React.useRef(null);

  // Reset input when user switches to a different layer
  React.useEffect(() => {
    setAdding('');
    setFocused(false);
    explicitChipClickRef.current = false;
  }, [selectedEntry?.id]);

  // ── Scope strip: one line, with a "+N" that unlocks the scroll ──────────
  // The scope row has to hold the tag selector, `Local` and every applied
  // class inside a dock that is often ~320px wide. Rather than wrap (height
  // jumps as you move between elements) or clip (a chip cut mid-word reads as
  // a rendering bug), the strip keeps exactly one line: whatever doesn't fit
  // folds into a counter, and clicking that counter turns the strip into a
  // scroller. Clicking it again folds it back.
  const scopeLineRef = React.useRef(null);
  const scopeLaneRef = React.useRef(null);
  const [scopeOpen, setScopeOpen] = React.useState(false);
  const [scopeHidden, setScopeHidden] = React.useState(0);
  // True when the scope being edited is one of the folded chips — the counter
  // says so, since otherwise you'd be editing something you can't see.
  const [scopeActiveFolded, setScopeActiveFolded] = React.useState(false);
  const prevActiveScopeRef = React.useRef(activeScope);

  // Width the "+N" / collapse button claims, plus the gap before it. Measuring
  // against the ROW (whose width never depends on the button) instead of the
  // lane is what keeps this from oscillating: were we to measure the lane, the
  // button appearing would shrink it, hiding one more chip, and so on.
  const SCOPE_MORE_W = 40;

  // `Local` plus the first scope chip are always on screen — the counter only
  // ever stands in for the SECOND class onwards.
  const SCOPE_ALWAYS_SHOWN = 2;

  // `element.classes` / `scopes` are fresh objects on every render, so the
  // measuring effect keys off their contents instead — otherwise it would tear
  // down and rebuild its ResizeObserver on each keystroke.
  const scopeChipsKey = `${element.tag}|${element.classes.join(' ')}|${Object.keys(scopes || {}).join(' ')}`;

  // Switching elements starts over — an expanded strip shouldn't follow you.
  React.useEffect(() => { setScopeOpen(false); }, [selectedEntry?.id]);

  React.useLayoutEffect(() => {
    const line = scopeLineRef.current;
    const lane = scopeLaneRef.current;
    if (!line || !lane) return undefined;

    // A folded chip is taken OUT OF FLOW rather than `display:none`d. Two
    // reasons, both of which were real bugs: an out-of-flow chip still reports
    // its width, so measuring never has to un-fold everything first (that
    // restore pass painted a frame of overflowing chips, which is the flicker);
    // and folding no longer changes what the browser considers the row's
    // content, so it can't feed back into the panel's own width.
    const fold = (k) => {
      k.style.position = 'absolute';
      k.style.visibility = 'hidden';
      k.style.pointerEvents = 'none';
    };
    const unfold = (k) => {
      k.style.position = '';
      k.style.visibility = '';
      k.style.pointerEvents = '';
    };

    const measure = () => {
      const kids = Array.prototype.slice.call(lane.children);
      // Pure read pass — nothing above this line writes to the DOM.
      const widths = kids.map((k) => k.offsetWidth);
      // Less the lane's own 2px inline padding (the room the selected chip's
      // ring needs), which `line.clientWidth` doesn't account for.
      const full = line.clientWidth - 4;

      if (scopeOpen) {
        kids.forEach(unfold);
        setScopeHidden(0);
        setScopeActiveFolded(false);
        prevActiveScopeRef.current = activeScope;
        // Keep the chip you're editing in view as you move between scopes.
        const act = lane.querySelector('[data-active="true"]');
        if (act) {
          const left = act.offsetLeft;
          const right = left + act.offsetWidth;
          if (left < lane.scrollLeft) lane.scrollLeft = Math.max(0, left - 8);
          else if (right > lane.scrollLeft + lane.clientWidth) lane.scrollLeft = right - lane.clientWidth + 8;
        }
        return;
      }

      // The panel hasn't been laid out yet (hidden tab, first paint). Folding
      // against a zero width would hide everything and stick that way.
      if (full <= 0) return;

      const gap = 6;
      const total = widths.reduce((sum, w, i) => sum + w + (i ? gap : 0), 0);

      // Everything fits without the counter — nothing to fold.
      if (total <= full) {
        kids.forEach(unfold);
        setScopeHidden(0);
        setScopeActiveFolded(false);
        prevActiveScopeRef.current = activeScope;
        return;
      }

      const avail = full - SCOPE_MORE_W;
      let used = 0;
      let hidden = 0;
      let activeFolded = false;
      kids.forEach((k, i) => {
        const w = widths[i] + (i ? gap : 0);
        // `Local` and the first scope chip never fold. A row showing nothing but
        // a counter tells you nothing about what you're editing, and the first
        // chip would rather truncate to `hero-dark__ti…` than disappear (CSS
        // lets these two shrink; every chip after them is fixed-width).
        if (i < SCOPE_ALWAYS_SHOWN) {
          unfold(k);
          used += w;
          return;
        }
        // Once one chip is folded every chip after it folds too, so the
        // visible run always reads left-to-right without gaps.
        if (hidden || used + w > avail) {
          fold(k);
          hidden += 1;
          if (k.dataset.active === 'true') activeFolded = true;
        } else {
          unfold(k);
          used += w;
        }
      });

      // If the user just picked a scope that lands in the folded run, open the
      // strip for them — they asked to edit it, so it has to be on screen. A
      // scope that merely fell off the end because the panel got narrower does
      // NOT force the strip open, or collapsing it again would be impossible.
      const activeChanged = prevActiveScopeRef.current !== activeScope;
      prevActiveScopeRef.current = activeScope;
      if (activeFolded && activeChanged) {
        setScopeOpen(true);
        return;
      }

      setScopeHidden(hidden);
      setScopeActiveFolded(activeFolded);
    };

    measure();

    // Only re-measure when the row's width genuinely moved. ResizeObserver
    // also fires for sub-pixel churn and for our own writes; acting on those
    // is what let the fold decision ping-pong frame after frame.
    let lastWidth = line.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = line.clientWidth;
      if (Math.abs(w - lastWidth) < 2) return;
      lastWidth = w;
      measure();
    });
    ro.observe(line);
    return () => ro.disconnect();
  }, [scopeOpen, scopeChipsKey, activeScope]);

  // Fade an edge only while there is actually more content past it, so a
  // half-visible chip reads as "keep scrolling" rather than as damage.
  React.useLayoutEffect(() => {
    const lane = scopeLaneRef.current;
    if (!lane) return undefined;
    const sync = () => {
      const max = lane.scrollWidth - lane.clientWidth;
      lane.classList.toggle('can-l', scopeOpen && lane.scrollLeft > 1);
      lane.classList.toggle('can-r', scopeOpen && lane.scrollLeft < max - 1);
    };
    sync();
    if (!scopeOpen) return undefined;
    lane.addEventListener('scroll', sync, { passive: true });
    // A trackpad's vertical flick should move the strip sideways — otherwise
    // reaching the last chip needs a gesture most people never try.
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      lane.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    lane.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      lane.removeEventListener('scroll', sync);
      lane.removeEventListener('wheel', onWheel);
    };
  }, [scopeOpen, scopeHidden, scopeChipsKey]);

  // Subscribe to UiChemy's global classes so the add-class dropdown refreshes
  // live when one is created/renamed, from either store: the unified Globals
  // Manager ("Other"/"Typography" classes, the current UI) or the legacy
  // standalone Global Classes panel (older data, no UI anymore).
  const legacyGlobalClasses = useGlobalClasses();
  const unifiedGlobalClasses = useUiChemyGlobalClasses();
  const uichemyGlobalNames = React.useMemo(
    () => buildUiChemyGlobalClassNames(unifiedGlobalClasses, legacyGlobalClasses),
    [unifiedGlobalClasses, legacyGlobalClasses],
  );
  const allSuggestions = React.useMemo(
    () => buildClassSuggestions(scopes, unifiedGlobalClasses),
    [scopes, legacyGlobalClasses, unifiedGlobalClasses],
  );

  const filteredSuggestions = React.useMemo(() => {
    const q = adding.trim().toLowerCase();
    return allSuggestions
      .filter((s) => !element.classes.includes(s.name))
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [allSuggestions, adding, element.classes]);

  // Classes that appear only as the rightmost segment of a compound rule
  // that will render on this element. Used to hide redundant simple chips –
  // e.g. when CSS has `.parent .child { … }` but no standalone `.child { … }`,
  // the `.child` simple chip is suppressed so only the compound chip is shown.
  const coveredByCompound = React.useMemo(() => {
    const covered = new Set();
    Object.keys(scopes || {}).forEach((k) => {
      if (!k.startsWith('compound:')) return;
      const meta = scopes[k] && scopes[k].__compound;
      if (!meta) return;
      const lastClasses = Array.isArray(meta.lastClasses) ? meta.lastClasses : [];
      if (!lastClasses.length) return;
      if (!lastClasses.every((cn) => element.classes.includes(cn))) return;
      lastClasses.forEach((cn) => covered.add(cn));
    });
    return covered;
  }, [scopes, element.classes]);

  function addClass(c) {
    const raw = typeof c === 'string' ? c : (c && c.name) || '';
    const name = (raw || adding).trim().replace(/^\./, '');
    if (!name || element.classes.includes(name)) { setAdding(''); return; }

    // Add the class to the element. UiChemy global classes (including
    // `text-{id}` typography classes) are seeded into the Inspector scopes by
    // hydrateGlobalClassScopes once the class list changes, no per-class
    // seeding needed here.
    setElement({ ...element, classes: [...element.classes, name] });
    setActiveScope(name);
    setAdding('');
  }

  function removeClass(c) {
    setElement({ ...element, classes: element.classes.filter((x) => x !== c) });
    if (activeScope === c) setActiveScope('local');
  }

  // Compound selectors (`.a .b .c`) can't be unbound by editing element.classes –
  // the rule targets a nested DOM shape. Drop the whole scope; setScopes diffs
  // prev→next, clears every owned declaration, and the empty rule is trimmed
  // from raw_css by upsertSelectorRuleInRegion.
  function removeCompoundScope(compoundKey) {
    if (!setScopes) return;
    setScopes((prev) => {
      if (!prev || !prev[compoundKey]) return prev;
      const next = { ...prev };
      delete next[compoundKey];
      return next;
    });
    if (activeScope === compoundKey) setActiveScope('local');
  }

  return (
    <>
    <div className="applied-compact">
      <div className="scope-line" ref={scopeLineRef}>
        {/* The tag selector used to lead this strip; it now lives in the head
            row beside Attributes / Mark as. The strip is scopes only. */}
        <div className={cn('scope-lane', scopeOpen && 'is-open')} ref={scopeLaneRef}>
          {/* An inline `style` cannot carry an @media block, so away from the base
              breakpoint Local has nowhere to put a responsive value. Say what
              will happen instead of letting the edit look like it failed. */}
          <button
            className={cn(CHIP_BASE_CLS, 'gap-1 px-2', activeScope === 'local' && CHIP_ON_CLS)}
            data-active={activeScope === 'local' ? 'true' : undefined}
            onClick={() => { setActiveScope('local'); explicitChipClickRef.current = false; }}
            title={localScopeNeedsClass
              ? 'Inline overrides on this element only — inline styles can\'t be responsive, so editing here moves them to a per-element class'
              : 'Inline overrides on this element only'}
          >
            <T.bolt size={10} /><span>Local</span>
            {localScopeNeedsClass && <span className="scope-chip-note">→ class</span>}
          </button>
          {(() => {
            const tagName = (selectedEntry && selectedEntry.tag) ? String(selectedEntry.tag).toLowerCase() : '';
            const tagScopeKey = tagName ? `tag:${tagName}` : '';
            if (!tagScopeKey || !scopes || !scopes[tagScopeKey]) return null;
            return (
              <span
                className={cn(CHIP_BASE_CLS, activeScope === tagScopeKey && CHIP_ON_CLS)}
                data-active={activeScope === tagScopeKey ? 'true' : undefined}
                title={`Tag selector · ${tagName}`}
              >
                <button className="flex h-full items-center gap-1.5 px-2" onClick={() => { setActiveScope(tagScopeKey); explicitChipClickRef.current = false; }}>
                  <span className="dot-cls" />
                  <span className="font-mono">{tagName}</span>
                </button>
              </span>
            );
          })()}
          {element.classes.map((c) => {
            const isUiChemyGlobal = isUiChemyGlobalScopeName(c, uichemyGlobalNames);
            const isGlobalClass = isUiChemyGlobal;
            const hasOwnScope = !!(scopes && scopes[c]);
            // Hide the simple chip when this class only exists as the tail of
            // a visible compound rule and has no standalone `.class { … }`
            // scope of its own, editing happens through the compound chip
            // instead. Globals always keep their chip.
            if (coveredByCompound.has(c) && !hasOwnScope && !isGlobalClass) return null;
            const chipTitle = isUiChemyGlobal ? `Global Class · .${c}` : c;
            return (
              <span
                key={c}
                className={cn(CHIP_BASE_CLS, activeScope === c && CHIP_ON_CLS)}
                data-active={activeScope === c ? 'true' : undefined}
                title={chipTitle}
              >
                <button className="flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1" onClick={() => { setActiveScope(c); explicitChipClickRef.current = true; }}>
                  {!isGlobalClass && <span className="dot-cls" />}
                  {isGlobalClass && (
                    <GlobalLabelMarker
                      className="chip-global-marker"
                      title={chipTitle}
                    />
                  )}
                  <span className="truncate font-mono">{displayClassName(c)}</span>
                </button>
                <button
                  className="flex h-full shrink-0 items-center px-1.5 text-muted-foreground transition-colors hover:text-destructive"
                  title="Remove class"
                  onClick={() => removeClass(c)}
                >
                  <T.x size={9} />
                </button>
              </span>
            );
          })}
          {/* Compound class selectors (e.g. `.parent .test`), surfaced as
              chips when the element's classes include the rightmost segment
              of the selector. Editable like normal class scopes; the X button
              removes the whole rule from raw_css. */}
          {Object.keys(scopes || {}).filter((k) => k.startsWith('compound:')).map((compoundKey) => {
            const compoundMeta = scopes[compoundKey] && scopes[compoundKey].__compound;
            if (!compoundMeta) return null;
            const lastClasses = Array.isArray(compoundMeta.lastClasses) ? compoundMeta.lastClasses : [];
            const lastTag = String(compoundMeta.lastTag || '').toLowerCase();
            // A compound's tail segment can be tag-only (`div h1`), class-only
            // (`.parent .child`), or both (`.foo h1.bar`). Without either we
            // can't decide whether the element matches.
            if (!lastClasses.length && !lastTag) return null;
            const currentTag = (selectedEntry && selectedEntry.tag)
              ? String(selectedEntry.tag).toLowerCase()
              : '';
            const tagMatches = !lastTag || lastTag === currentTag;
            const classMatches = lastClasses.every((cn) => element.classes.includes(cn));
            if (!tagMatches || !classMatches) return null;
            const display = compoundMeta.normalized;
            return (
              <span
                key={compoundKey}
                className={cn(CHIP_BASE_CLS, activeScope === compoundKey && CHIP_ON_CLS)}
                data-active={activeScope === compoundKey ? 'true' : undefined}
                title={`Compound selector · ${display}`}
              >
                <button
                  className="flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1"
                  onClick={() => { setActiveScope(compoundKey); explicitChipClickRef.current = true; }}
                >
                  <span className="dot-cls" />
                  <span className="truncate font-mono">{display}</span>
                </button>
                <button
                  className="flex h-full shrink-0 items-center px-1.5 text-muted-foreground transition-colors hover:text-destructive"
                  title="Remove rule"
                  onClick={() => removeCompoundScope(compoundKey)}
                >
                  <T.x size={9} />
                </button>
              </span>
            );
          })}
        </div>
        {(scopeHidden > 0 || scopeOpen) && (
          <button
            type="button"
            className="scope-more"
            aria-expanded={scopeOpen}
            data-holds-active={scopeActiveFolded ? 'true' : undefined}
            title={scopeOpen
              ? 'Fold the class list back'
              : `Show ${scopeHidden} more${scopeActiveFolded ? ' (the scope you\'re editing is in here)' : ''}`}
            onClick={() => setScopeOpen((v) => !v)}
          >
            {scopeOpen
              ? <T.chevron size={10} className="rotate-90" />
              : <span>{`+${scopeHidden}`}</span>}
          </button>
        )}
      </div>
      <div className="scope-line-2">
        <div className="relative flex min-w-0 flex-1">
        <input
          ref={addInputRef}
          className="h-6 w-full rounded-md border border-dashed border-transparent bg-transparent px-1.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-input focus:border-solid focus:border-ring"
          placeholder="+ Add class"
          value={adding}
          onChange={(e) => { setAdding(e.target.value); if (e.target.value) explicitChipClickRef.current = false; }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (adding && filteredSuggestions[0] && filteredSuggestions[0].name === adding) {
                addClass(filteredSuggestions[0]);
              } else if (filteredSuggestions[0] && !adding) {
                addClass(filteredSuggestions[0]);
              } else if (adding) {
                addClass(adding);
              }
            }
            if (e.key === 'Backspace' && !adding && element.classes.length) {
              // Only remove if the user explicitly clicked this chip, not when a class
              // is merely auto-selected while the user intends to add a new class.
              if (explicitChipClickRef.current && element.classes.includes(activeScope)) {
                removeClass(activeScope);
                explicitChipClickRef.current = false;
              }
            }
            if (e.key === 'Escape') { setAdding(''); e.target.blur(); }
          }}
        />

        {/* Suggestions render into the scoped portal root, right-aligned to the
            input and clamped to the viewport, so the list never spills off the
            screen (the input sits at the panel's right edge in the right dock). */}
        <DropdownMenuLayer
          triggerRef={addInputRef}
          open={focused && filteredSuggestions.length > 0}
          onClose={() => setFocused(false)}
          minWidth={240}
          className="max-h-[min(360px,60vh)] max-w-[min(340px,90vw)] overflow-y-auto"
        >
          {filteredSuggestions.map((s) => (
            <div
              key={s.name}
              className={cn(MENU_ITEM_CLS, 'font-mono text-xs')}
              onMouseDown={(e) => { e.preventDefault(); addClass(s); }}
            >
              <span className={`dot-cls${s.kind === 'uichemy-global' ? ' global' : ''}`} />
              <span className="min-w-0 truncate">
                {s.kind === 'uichemy-global' && s.title ? s.title : s.name}
              </span>
              <span className="ml-auto shrink-0 pl-4 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">{classSuggestionHint(s)}</span>
            </div>
          ))}
        </DropdownMenuLayer>
        <DropdownMenuLayer
          triggerRef={addInputRef}
          open={focused && !!adding && filteredSuggestions.length === 0}
          onClose={() => setFocused(false)}
          minWidth={240}
          className="max-w-[min(340px,90vw)]"
        >
          <div className={cn(MENU_ITEM_CLS, 'font-mono text-xs')}>
            <span className="dot-cls" />
            <span className="min-w-0 truncate">{adding}</span>
            <span className="ml-auto shrink-0 pl-4 font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Press Enter to add</span>
          </div>
        </DropdownMenuLayer>
        </div>
        <StateDropdown
          state={state}
          setState={setState}
          activeScope={activeScope}
          scopes={scopes}
          parsedScopesByBpKey={parsedScopesByBpKey}
        />
      </div>
    </div>
    </>
  );
}

export function Inspector({
  mode = 'pro',
  dock = 'bottom',
  theme = 'dark',
  modeSwitch = null,
  element, setElement,
  scopes, setScopes,
  activeScope, setActiveScope,
  state, setState,
  device, breakpoints,
  activeMediaQuery = '',
  baseParsedScopes = {},
  parsedScopesByBpKey = {},
  globals,
  selectedEntry,
  onMark,
  onRemoveConstruct,
  markLoopActive = false,
  markFormActive = false,
  rawHtml,
  anchorLink,
  onAnchorLinkChange,
  anchorLinkDisabled,
  onSvgUrlChange,
  inlineScope = null,
  localScopeNeedsClass = false,
  onPromoteLocalToBreakpointClass = null,
  constructSlot = null,
}) {
  // Background sub-toggles: one ref per segmented track.
  const bgTabSegRef = useSlidingSeg();
  const fillModeSegRef = useSlidingSeg();
  const T = I;
  // UiChemy Global Class names (from both stores) so own/inherited property
  // values that resolve to a UiChemy global class can be flagged with the
  // Global icon. Subscribed here so the flag updates live as classes change.
  const inspectorLegacyGlobalClasses = useGlobalClasses();
  const inspectorUnifiedGlobalClasses = useUiChemyGlobalClasses();
  const uichemyGlobalNames = React.useMemo(
    () => buildUiChemyGlobalClassNames(inspectorUnifiedGlobalClasses, inspectorLegacyGlobalClasses),
    [inspectorUnifiedGlobalClasses, inspectorLegacyGlobalClasses],
  );
  // Loop context for the selected element, drives loop-aware dynamic bindings.
  const loopCtx = React.useMemo(() => {
    if (!selectedEntry || !selectedEntry.path) return null;
    const expr = findEnclosingLoop(rawHtml, selectedEntry.path);
    return expr ? uichParseLoopExpr(expr) : null;
  }, [rawHtml, selectedEntry]);
  // Content, the first section, is open by default in both docks/modes: it
  // holds what the element actually says (text/image/link), which is what a
  // fresh selection is nearly always about. The user can still collapse it;
  // `activeSection === null` means every dropdown is closed (see the toggle
  // handlers below). Drives the bottom-dock tab strip (one body at a time) and
  // the simple-mode content shortcut.
  const [activeSection, setActiveSection] = React.useState('content');
  // Right-dock accordion is multi-open: any number of sections can be expanded
  // at once, so tweaking Spacing while Typography stays open doesn't mean
  // re-opening it. Separate from `activeSection`, which the bottom-dock tab
  // strip uses and which stays single-select.
  const [openSections, setOpenSections] = React.useState(() => new Set(['content']));
  const toggleSection = React.useCallback((id) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const [bgTab, setBgTab] = React.useState(null); // null = auto-derive from scope
  const [bgFillMode, setBgFillMode] = React.useState(null); // 'solid' | 'gradient' | null(auto)
  const [showText, setShowText] = React.useState(false);
  const [showImage, setShowImage] = React.useState(true);
  const [showSvg, setShowSvg] = React.useState(true);
  // Simple mode surfaces content (text/image/link) as the first section tab,
  // inline with Typography/Layout/etc., no separate Content|Style switch.
  const simpleContent = mode === 'simple' && activeSection === 'content';
  // Both modes now expose the same sections (Content … Custom CSS), so no
  // section needs remapping per mode. Accordions are exclusive but MAY all be
  // closed, the user can collapse the open one, so nothing is force-reopened
  // here.
  const isMedia = React.useMemo(() => {
    if (!selectedEntry) return false;
    const tag = String(selectedEntry.tag || '').toLowerCase();
    return tag === 'img' || tag === 'svg' || isSvgLayerEntry(selectedEntry);
  }, [selectedEntry]);

  React.useEffect(() => {
    if (isMedia) {
      setShowImage(true);
      setShowSvg(true);
    }
  }, [selectedEntry?.id, isMedia]);

  React.useEffect(() => {
    setBgTab(null);
    setBgFillMode(null);
  }, [selectedEntry?.id, activeScope, device]);
  const [editingTag, setEditingTag] = React.useState(false);
  const [editingTagValue, setEditingTagValue] = React.useState('');
  const [suggestionIndex, setSuggestionIndex] = React.useState(0);
  const tagInputRef = React.useRef(null);
  const tagListRef = React.useRef(null);
  const [tagMenuPos, setTagMenuPos] = React.useState(null);
  const markBtnRef = React.useRef(null);
  const [markOpen, setMarkOpen] = React.useState(false);

  const isDesktopDevice = !device || device === 'desktop';
  // null = hidden, {x,y} = visible at click position relative to wrapper
  const [localBlockTooltip, setLocalBlockTooltip] = React.useState(null);

  const query = editingTagValue.trim().toLowerCase();
  const groups = React.useMemo(() => {
    return ELEMENT_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => !query || it.tag.toLowerCase().includes(query) || it.label.toLowerCase().includes(query)),
      }))
      .filter((g) => g.items.length > 0);
  }, [query]);

  const exactCatalogHit = React.useMemo(() => {
    return ELEMENT_GROUPS.some((g) => g.items.some((it) => it.tag.toLowerCase() === query));
  }, [query]);

  const showCustom = !!query && isValidTagName(query) && !exactCatalogHit;

  const flatRows = React.useMemo(() => {
    const rows = [];
    if (showCustom) rows.push({ kind: 'custom', tag: query });
    for (const g of groups) for (const it of g.items) rows.push({ kind: 'catalog', tag: it.tag });
    return rows;
  }, [showCustom, query, groups]);

  // Fonts the user has imported via 3rd-party assets, custom CSS, or any of
  // the page/site code editors, surfaced inside the Font Family dropdown so
  // they're pickable without typing the name by hand.
  const importedFontFamilies = useImportedFontFamilies();

  React.useEffect(() => {
    if (!editingTag) { setTagMenuPos(null); return undefined; }
    function reposition() {
      const input = tagInputRef.current;
      if (!input) return;
      const win = input.ownerDocument?.defaultView || window;
      const rect = input.getBoundingClientRect();
      const vw = win.innerWidth;
      const vh = win.innerHeight;
      const menuW = 230;
      const menuH = 260;
      let left = rect.left;
      if (left + menuW > vw - 4) left = Math.max(4, vw - menuW - 4);
      let top = rect.bottom + 4;
      if (top + menuH > vh - 8) {
        const above = rect.top - 4 - menuH;
        top = above >= 8 ? above : Math.max(8, vh - menuH - 8);
      }
      setTagMenuPos({ top, left, width: menuW });
    }
    reposition();
    const win = tagInputRef.current?.ownerDocument?.defaultView || window;
    win.addEventListener('resize', reposition);
    win.addEventListener('scroll', reposition, true);
    return () => {
      win.removeEventListener('resize', reposition);
      win.removeEventListener('scroll', reposition, true);
    };
  }, [editingTag]);

  React.useEffect(() => {
    if (suggestionIndex < 0 || !tagListRef.current) return;
    const list = tagListRef.current;
    const row = list.querySelector(`[data-row-idx="${suggestionIndex}"]`);
    if (!row) return;
    const rTop = row.offsetTop;
    const rBot = rTop + row.offsetHeight;
    if (rTop < list.scrollTop) list.scrollTop = rTop;
    else if (rBot > list.scrollTop + list.clientHeight) list.scrollTop = rBot - list.clientHeight;
  }, [suggestionIndex]);

  // Local display always follows live inline style on the selected element
  // (raw_html), not a shared/parsed class scope object in React state.
  const scopesForRead = React.useMemo(() => {
    if (!inlineScope) return scopes;
    return { ...scopes, local: inlineScope };
  }, [scopes, inlineScope]);

  // Effective scope key used for all scope-data read/write. When a non-default
  // pseudo-state is selected, edits target a sibling `.class:state` scope so
  // each state's CSS lives in its own selector. Local (inline) scope ignores
  // state, inline styles can't carry pseudo-classes.
  const stateActive = !!(state && state !== 'default');
  // Simple mode routes every read/write to the element's own inline (local)
  // scope: edits become safe per-element overrides, and displayValue's cascade
  // fallback still shows the merged/effective value from all classes.
  const effectiveScopeKey = mode === 'simple'
    ? 'local'
    : (stateActive && activeScope !== 'local')
      ? `${activeScope}:${state}`
      : activeScope;

  const p = scopesForRead[effectiveScopeKey] || emptyProps();

  const elementTag = (selectedEntry && selectedEntry.tag) ? String(selectedEntry.tag).toLowerCase() : '';
  const cascadeCtx = React.useMemo(() => ({
    scopes: scopesForRead,
    parsedByBpKey: parsedScopesByBpKey,
    elementClasses: element.classes,
    elementTag,
    activeDevice: device,
    activeState: state,
    globals,
    breakpoints,
  }), [scopesForRead, parsedScopesByBpKey, element.classes, elementTag, device, state, globals, breakpoints]);

  function effectiveSource(group, key) {
    return findEffectivePropertySource({ ...cascadeCtx, group, key });
  }

  function scopeHasExplicit(scopeName, group, key) {
    return scopeHasOwnAtActiveBreakpoint(
      scopesForRead, parsedScopesByBpKey, scopeName, group, key, device, activeMediaQuery,
    );
  }

  function inheritedFrom(group, key) {
    if (scopeHasOwnAtActiveBreakpoint(
      scopesForRead, parsedScopesByBpKey, effectiveScopeKey, group, key, device, activeMediaQuery,
    )) {
      return null;
    }
    const eff = effectiveSource(group, key);
    if (!eff || eff.chainIndex === 0) return null;
    return eff.scopeName;
  }

  function inheritedFromBreakpoint(group, key) {
    if (scopeHasOwnAtActiveBreakpoint(
      scopesForRead, parsedScopesByBpKey, effectiveScopeKey, group, key, device, activeMediaQuery,
    )) {
      return null;
    }
    const eff = effectiveSource(group, key);
    if (!eff || eff.chainIndex === 0) return null;
    return eff.bpLabel;
  }

  /** Value shown in inputs: this scope's own value at the active breakpoint, else cascade. */
  function displayValue(group, key) {
    if (scopeHasOwnAtActiveBreakpoint(
      scopesForRead, parsedScopesByBpKey, effectiveScopeKey, group, key, device, activeMediaQuery,
    )) {
      const r = resolveScopePropertyDisplay(effectiveScopeKey, group, key, scopesForRead, globals);
      return r.display || r.raw || '';
    }
    const eff = effectiveSource(group, key);
    return eff?.value || '';
  }

  function placeholderFor(group, key) {
    const eff = effectiveSource(group, key);
    return eff?.value || '';
  }

  /** Cascade context for one property in the active scope. */
  function propCascade(group, key) {
    const hasOwn = scopeHasOwnAtActiveBreakpoint(
      scopesForRead, parsedScopesByBpKey, effectiveScopeKey, group, key, device, activeMediaQuery,
    );
    const ownResolved = hasOwn
      ? resolveScopePropertyDisplay(effectiveScopeKey, group, key, scopesForRead, globals)
      : { raw: '', display: '', isGlobal: false, globalLabel: null };
    const own = ownResolved.display || ownResolved.raw;
    const eff = effectiveSource(group, key);
    const appliedValue = eff?.value || '';
    const appliedScope = eff?.scopeName || null;
    // A value that resolves through a UiChemy Global Class scope is a global,
    // even though resolveScopePropertyDisplay (which only knows Elementor kit /
    // Atomic globals) reports isGlobal:false for it. Flag it here so the label
    // marker + applied-from hint show the Global icon for UiChemy globals too.
    const ownUiChemyGlobal = hasOwn && isUiChemyGlobalScopeName(effectiveScopeKey, uichemyGlobalNames);
    const appliedUiChemyGlobal = !!eff && isUiChemyGlobalScopeName(eff.scopeName, uichemyGlobalNames);
    const appliedIsGlobal = eff?.isGlobal || appliedUiChemyGlobal || false;
    const appliedGlobalLabel = eff?.globalLabel || (appliedUiChemyGlobal ? `.${String(eff.scopeName).split(':')[0]}` : null);
    const isBreakpointInherited = !hasOwn && eff && eff.chainIndex > 0;
    const isClassInherited = !hasOwn && eff && eff.scopeName !== effectiveScopeKey;
    const isInherited = !hasOwn && !!eff;
    const isOverridden = hasOwn && eff && eff.scopeName !== effectiveScopeKey;
    return {
      own,
      ownRaw: ownResolved.raw,
      ownIsGlobal: ownResolved.isGlobal || ownUiChemyGlobal,
      ownGlobalLabel: ownResolved.globalLabel || (ownUiChemyGlobal ? `.${String(effectiveScopeKey).split(':')[0]}` : null),
      hasOwn,
      appliedValue,
      appliedScope,
      appliedIsGlobal,
      appliedGlobalLabel,
      inheritedFromBreakpoint: isBreakpointInherited ? eff.bpLabel : null,
      isOverridden,
      isInherited,
      isBreakpointInherited,
      isClassInherited,
    };
  }

  // True when this edit would land on Local at a responsive breakpoint — an
  // inline `style` cannot carry an @media block, so it has to become a
  // per-element class first (see promoteLocalToBreakpointClass in
  // composer-app.jsx). Without this the write was dropped and every field in
  // the panel looked like it forgot the value the moment it lost focus.
  const localNeedsPromotion = effectiveScopeKey === 'local'
    && localScopeNeedsClass
    && typeof onPromoteLocalToBreakpointClass === 'function';

  function upd(group, patch) {
    if (localNeedsPromotion && onPromoteLocalToBreakpointClass(group, patch)) return;
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      let nextScope = { ...current, [group]: { ...(current[group] || {}) } };
      const units = { ...(nextScope.__units || {}) };
      const globals = { ...(nextScope.__globals || {}) };
      Object.keys(patch).forEach((k) => {
        const fk = `${group}.${k}`;
        const val = patch[k];
        const grp = { ...(nextScope[group] || {}) };
        if (val == null || val === '') {
          delete grp[k];
          delete units[fk];
          delete globals[fk];
          nextScope = clearScopePropOwn(
            { ...nextScope, [group]: grp, __units: units, __globals: globals },
            fk,
            activeMediaQuery,
          );
        } else {
          grp[k] = val;
          nextScope = markScopePropOwn({ ...nextScope, [group]: grp }, fk, activeMediaQuery);
        }
      });
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }

  // Canvas padding-drag → the SAME spacing write the panel field uses, so dragging
  // an element's edge on the canvas and the Spacing fields stay in sync (all three
  // builders). The box-handles layer (composer-box-handles.js) dispatches
  // `uich:composer:pad-drag` {side:'Top'|'Right'|'Bottom'|'Left', px} on the top
  // window. A ref keeps the handler pointed at the current render's upd /
  // effectiveScopeKey; the listener attaches once.
  const padDragApplyRef = React.useRef(null);
  padDragApplyRef.current = (detail) => {
    const side = detail && detail.side;
    if (!side) return;
    const patch = {};
    // Drag is pixel-based; seed px only when the side has no explicit unit yet, so
    // an existing em/%/rem is not silently changed (mirrors spacingSetValue).
    const seed = (prefix, value) => {
      const propKey = `${prefix}${side}`;
      if (!scopeHasExplicit(effectiveScopeKey, 'spacing', propKey)) {
        setUnit(`spacing.${propKey}`, 'px');
      }
      patch[propKey] = String(Math.max(0, Math.round(Number(value) || 0)));
    };
    if (detail.pad != null) seed('pad', detail.pad);   // inward drag → padding
    if (detail.mar != null) seed('mar', detail.mar);   // outward drag → margin
    if (Object.keys(patch).length) upd('spacing', patch);
  };
  React.useEffect(() => {
    const onPadDrag = (e) => {
      if (padDragApplyRef.current) padDragApplyRef.current((e && e.detail) || {});
    };
    window.addEventListener('uich:composer:pad-drag', onPadDrag);
    return () => window.removeEventListener('uich:composer:pad-drag', onPadDrag);
  }, []);

  function getUnit(key, def = 'px') {
    const dot = key.indexOf('.');
    const group = dot >= 0 ? key.slice(0, dot) : '';
    const propKey = dot >= 0 ? key.slice(dot + 1) : key;
    if (scopeHasOwnAtActiveBreakpoint(
      scopesForRead, parsedScopesByBpKey, effectiveScopeKey, group, propKey, device, activeMediaQuery,
    )) {
      // Prefer the unit the user picked via `setUnit` (stored on the writable
      // `scopes` bag) over the parsed read bag. For inline/local elements
      // `scopesForRead.local` is a separate derived object that lacks the
      // freshly-picked __units, so reading only it makes the Spacing box –
      // which stores its value and unit separately, revert to px the moment a
      // value is typed after choosing a non-px unit. Mirrors the pending-unit
      // branch below, which already reads `scopes` for the same reason.
      const writable = scopes[effectiveScopeKey];
      if (writable && writable.__units && writable.__units[key] != null) {
        return writable.__units[key];
      }
      const s = scopesForRead[effectiveScopeKey];
      return (s && s.__units && s.__units[key]) || def;
    }
    // Pending unit chosen on this scope before any value exists. `setUnit`
    // writes the picked unit into the writable scope's `__units`; without
    // reading it back here the pill silently reverts to the default on every
    // valueless length field (font-size, width/height, radius, gap, offsets,
    // filters, transforms, transitions, everything outside the Spacing box,
    // which has its own `boxUnit` fallback). Reading `scopes` (the setUnit
    // target) rather than `scopesForRead` also covers inline/local elements.
    const writable = scopes[effectiveScopeKey];
    if (writable && writable.__units && writable.__units[key]) {
      return writable.__units[key];
    }
    const eff = effectiveSource(group, propKey);
    if (!eff) return def;
    const bag = getParsedScopeBag(scopesForRead, parsedScopesByBpKey, eff.scopeName, eff.bpKey, device);
    return (bag && bag.__units && bag.__units[key]) || def;
  }
  function setUnit(key, unit) {
    // A keyword unit ("auto", "fit-content", "none") IS the value — the branch
    // below stores it as one — so on Local at a responsive breakpoint it needs
    // the same promotion a typed value gets, or it goes nowhere.
    if (localNeedsPromotion && LENGTH_KEYWORD_UNITS.has(unit)) {
      const dotAt = key.indexOf('.');
      const g = dotAt >= 0 ? key.slice(0, dotAt) : '';
      const pk = dotAt >= 0 ? key.slice(dotAt + 1) : '';
      if (g && pk && onPromoteLocalToBreakpointClass(g, { [pk]: unit })) return;
    }
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const dot = key.indexOf('.');
      const group = dot >= 0 ? key.slice(0, dot) : '';
      const propKey = dot >= 0 ? key.slice(dot + 1) : key;
      let nextScope = {
        ...current,
        __units: { ...(current.__units || {}), [key]: unit },
      };
      if (group && propKey) {
        const curVal = current[group]?.[propKey];
        const curIsKeyword = typeof curVal === 'string' && LENGTH_KEYWORD_UNITS.has(curVal);
        if (LENGTH_KEYWORD_UNITS.has(unit)) {
          // Keyword unit picked: store the keyword as the value so the property
          // is owned and the writer emits e.g. `width: fit-content`.
          nextScope = {
            ...nextScope,
            [group]: { ...(current[group] || {}), [propKey]: unit },
          };
          nextScope = markScopePropOwn(nextScope, `${group}.${propKey}`, activeMediaQuery);
        } else if (curIsKeyword) {
          // Switching from a keyword back to a real unit: drop the keyword value
          // so the field doesn't keep serialising the old keyword.
          nextScope = {
            ...nextScope,
            [group]: { ...(current[group] || {}), [propKey]: '' },
          };
        } else if (curVal != null && curVal !== '') {
          nextScope = {
            ...nextScope,
            [group]: { ...(current[group] || {}) },
          };
          nextScope = markScopePropOwn(nextScope, `${group}.${propKey}`, activeMediaQuery);
        }
      }
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }

  function getGlobal(group, key) {
    const s = scopes[effectiveScopeKey];
    return s && s.__globals ? s.__globals[`${group}.${key}`] : null;
  }
  function setGlobal(group, key, tokenId) {
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const g = { ...(current.__globals || {}), [`${group}.${key}`]: tokenId };
      const bag = { ...(current[group] || {}), [key]: '' };
      const nextScope = markScopePropOwn(
        { ...current, [group]: bag, __globals: g },
        `${group}.${key}`,
        activeMediaQuery,
      );
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }
  function unsetGlobal(group, key) {
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const fk = `${group}.${key}`;
      const g = { ...(current.__globals || {}) };
      delete g[fk];
      const bag = { ...(current[group] || {}) };
      if (bag[key] === '' || bag[key] == null) delete bag[key];
      const nextScope = clearScopePropOwn(
        { ...current, [group]: bag, __globals: g },
        fk,
        activeMediaQuery,
      );
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }
  /** Set a color (or any prop) and clear any global link in one update, avoids stale __globals. */
  function setColorValue(group, key, value) {
    if (localNeedsPromotion && onPromoteLocalToBreakpointClass(group, { [key]: value })) return;
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const fk = `${group}.${key}`;
      const g = { ...(current.__globals || {}) };
      delete g[fk];
      const bag = { ...(current[group] || {}) };
      const units = { ...(current.__units || {}) };
      const v = value == null ? '' : String(value);
      if (v === '') {
        delete bag[key];
        delete units[fk];
      } else {
        bag[key] = v;
      }
      let nextScope = { ...current, [group]: bag, __globals: g, __units: units };
      if (v !== '') {
        nextScope = markScopePropOwn(nextScope, fk, activeMediaQuery);
      } else {
        nextScope = clearScopePropOwn(nextScope, fk, activeMediaQuery);
      }
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }
  function setTextShadowColorGlobal(tokenId) {
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const parsed = parseTextShadow(current.typography?.textShadow);
      const g = { ...(current.__globals || {}), 'typography.textShadowColor': tokenId };
      const bag = { ...(current.typography || {}) };
      bag.textShadow = formatTextShadow({ ...parsed, color: '' });
      let nextScope = { ...current, typography: bag, __globals: g };
      nextScope = markScopePropOwn(nextScope, 'typography.textShadow', activeMediaQuery);
      nextScope = markScopePropOwn(nextScope, 'typography.textShadowColor', activeMediaQuery);
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }

  function unsetTextShadowColorGlobal() {
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const g = { ...(current.__globals || {}) };
      delete g['typography.textShadowColor'];
      const parsed = parseTextShadow(current.typography?.textShadow);
      const bag = { ...(current.typography || {}) };
      bag.textShadow = formatTextShadow({
        ...parsed,
        color: parsed.color || 'rgba(0,0,0,0.2)',
      });
      const nextScope = clearScopePropOwn(
        { ...current, typography: bag, __globals: g },
        'typography.textShadowColor',
        activeMediaQuery,
      );
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }

  function globalProps(group, key) {
    if (key === 'textShadow') {
      return {
        linked: getGlobal(group, 'textShadowColor'),
        onLink: (id) => setTextShadowColorGlobal(id),
        onUnlink: () => unsetTextShadowColorGlobal(),
      };
    }
    return {
      linked: getGlobal(group, key),
      onLink: (id) => setGlobal(group, key, id),
      onUnlink: () => unsetGlobal(group, key),
    };
  }

  function getShown(group) {
    const s = scopes[effectiveScopeKey];
    return (s && s.__shown && s.__shown[group]) || [];
  }
  function addShown(group, k) {
    const scopeKey = effectiveScopeKey;
    setScopes((prev) => {
      const current = prev[scopeKey] || emptyProps();
      const shown = { ...(current.__shown || {}) };
      shown[group] = [...(shown[group] || []), k];
      return { ...prev, [scopeKey]: { ...current, __shown: shown } };
    });
  }
  function removeShownAndClear(group, k) {
    setScopes((prev) => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const shown = { ...(current.__shown || {}) };
      shown[group] = (shown[group] || []).filter(x => x !== k);
      const grp = { ...(current[group] || {}) };
      delete grp[k];
      const u = { ...(current.__units || {}) };
      delete u[`${group}.${k}`];
      const g = { ...(current.__globals || {}) };
      delete g[`${group}.${k}`];
      if (k === 'textShadow') delete g[`${group}.textShadowColor`];
      const nextScope = clearScopePropOwn({
        ...current, [group]: grp, __shown: shown, __units: u, __globals: g,
      }, `${group}.${k}`, activeMediaQuery);
      return { ...prev, [effectiveScopeKey]: nextScope };
    });
  }

  // ── Custom CSS helpers ────────────────────────────────────────────────────
  function parseRawCustomCss(raw) {
    const cleanItem = (item) => {
      if (!item || !item.prop) return null;
      const prop = normalizeCustomCssProp(item.prop);
      const value = normalizeCustomCssValue(item.value);
      return prop ? { prop, value } : null;
    };
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(cleanItem).filter(Boolean);
    if (typeof raw === 'string') {
      return raw.split(';').map(d => {
        const t = d.trim(); if (!t) return null;
        const ci = t.indexOf(':');
        return ci > 0
          ? cleanItem({ prop: t.slice(0, ci), value: t.slice(ci + 1) })
          : cleanItem({ prop: t, value: '' });
      }).filter(Boolean);
    }
    return [];
  }
  function normalizeCustomCssProp(prop) {
    return String(prop || '').trim().replace(/[;{}]+$/g, '').trim();
  }
  function normalizeCustomCssValue(value) {
    return String(value == null ? '' : value).trim().replace(/;+$/g, '').trim();
  }
  function getCustomCssItems() {
    const s = scopes[effectiveScopeKey];
    return parseRawCustomCss(s && s.customCss);
  }
  function customCssItemsForScope(scopeKey) {
    const s = scopes[scopeKey];
    return parseRawCustomCss(s && s.customCss);
  }
  function customCssItemsForScopeAllBreakpoints(scopeKey) {
    const items = [];
    const seen = new Set();
    const addItems = (s) => {
      if (!s || !s.customCss) return;
      parseRawCustomCss(s.customCss).forEach(item => {
        if (item.prop && !seen.has(item.prop)) {
          seen.add(item.prop);
          items.push(item);
        }
      });
    };
    addItems(scopesForRead[scopeKey]);
    if (parsedScopesByBpKey) {
      for (const bpKey of Object.keys(parsedScopesByBpKey)) {
        const bpScopes = parsedScopesByBpKey[bpKey];
        if (bpScopes) {
          addItems(bpScopes[scopeKey]);
        }
      }
    }
    return items;
  }
  function getInheritedCustomCssItems() {
    const classes = (element && element.classes) || [];
    const map = {};
    if (activeScope !== 'local') {
      customCssItemsForScopeAllBreakpoints('local').forEach((item) => {
        if (!item.prop || !item.value) return;
        map[item.prop] = { prop: item.prop, value: item.value, fromClass: 'local' };
      });
      return Object.values(map);
    }
    for (const cls of classes) {
      for (const item of customCssItemsForScopeAllBreakpoints(cls)) {
        if (item.prop && item.value) {
          map[item.prop] = { prop: item.prop, value: item.value, fromClass: cls };
        }
      }
    }
    return Object.values(map);
  }
  function getCustomCssValueForScope(scopeKey, propName) {
    const s = scopes[scopeKey];
    const out = {};
    if (!s || !s.customCss) return propName ? null : out;
    for (const item of parseRawCustomCss(s.customCss)) {
      if (!item.prop || !item.value) continue;
      out[item.prop] = item.value;
    }
    return propName ? (out[propName] || null) : out;
  }
  function getCustomCssValueForScopeAtBreakpoint(scopeKey, bpKey, propName) {
    const s = getParsedScopeBag(scopesForRead, parsedScopesByBpKey, scopeKey, bpKey, device);
    const out = {};
    if (!s || !s.customCss) return propName ? null : out;
    for (const item of parseRawCustomCss(s.customCss)) {
      if (!item.prop || !item.value) continue;
      out[item.prop] = item.value;
    }
    return propName ? (out[propName] || null) : out;
  }
  function findEffectiveCustomCssSource(propName) {
    const chain = buildResponsiveFallbackChainForBreakpoint(device);
    const baseClasses = ((element && element.classes) || []).slice().reverse();
    const useState = state && state !== 'default';

    // Compound class scopes (e.g. `.parent .test`) that match the element –
    // mirror the regular cascade so customCss reads from them too.
    const matchingCompoundKeys = Object.keys(scopesForRead || {}).filter((k) => {
      if (!k.startsWith('compound:')) return false;
      const meta = scopesForRead[k] && scopesForRead[k].__compound;
      if (!meta || !Array.isArray(meta.lastClasses) || !meta.lastClasses.length) return false;
      return meta.lastClasses.every((cn) => baseClasses.includes(cn));
    });

    const scopeOrder = ['local'];
    if (useState) {
      for (const cls of baseClasses) scopeOrder.push(`${cls}:${state}`);
      for (const k of matchingCompoundKeys) {
        if (scopesForRead[k].__compound.lastState === state) scopeOrder.push(k);
      }
    }
    for (const k of matchingCompoundKeys) {
      if (!scopesForRead[k].__compound.lastState) scopeOrder.push(k);
    }
    for (const cls of baseClasses) scopeOrder.push(cls);

    for (let ci = 0; ci < chain.length; ci++) {
      const chainBp = chain[ci];
      for (const scopeName of scopeOrder) {
        const val = getCustomCssValueForScopeAtBreakpoint(scopeName, chainBp, propName);
        if (val) {
          return {
            scopeName,
            bpKey: chainBp || 'desktop',
            bpLabel: breakpointLabelForKey(chainBp, breakpoints),
            chainIndex: ci,
            value: val,
          };
        }
      }
    }
    return null;
  }
  function customCssCascade(propName) {
    const ownValue = getCustomCssValueForScope(effectiveScopeKey, propName) || '';
    const eff = findEffectiveCustomCssSource(propName);
    const appliedValue = eff?.value || '';
    const appliedScope = eff?.scopeName || null;
    const hasOwn = !!ownValue;
    const isBreakpointInherited = !hasOwn && eff && eff.chainIndex > 0;
    const isClassInherited = !hasOwn && eff && eff.scopeName !== effectiveScopeKey;
    const isInherited = !hasOwn && !!eff;
    const isOverridden = hasOwn && eff && eff.scopeName !== effectiveScopeKey;
    return {
      own: ownValue,
      hasOwn,
      appliedValue,
      appliedScope,
      isInherited,
      isOverridden,
      isBreakpointInherited,
      isClassInherited,
      inheritedFromBreakpoint: isBreakpointInherited ? eff.bpLabel : null,
    };
  }
  function getCustomCssCascadeMap() {
    const map = {};
    getRelevantCustomCssProps().forEach((prop) => {
      map[prop] = customCssCascade(prop);
    });
    return map;
  }
  function getRelevantCustomCssProps() {
    return getOrderedCustomCssProps();
  }
  function getOrderedCustomCssProps() {
    const props = [];
    const seen = new Set();
    const add = (prop) => {
      if (!prop || seen.has(prop)) return;
      seen.add(prop);
      props.push(prop);
    };
    const classes = (element && element.classes) || [];
    // Keep one canonical order across Local and Class scopes, like schema tabs:
    // local inline props first, then class props in the element's class order.
    customCssItemsForScopeAllBreakpoints('local').forEach(item => add(item.prop));
    for (const cls of classes) {
      customCssItemsForScopeAllBreakpoints(cls).forEach(item => add(item.prop));
    }
    if (state && state !== 'default') {
      for (const cls of classes) {
        customCssItemsForScopeAllBreakpoints(`${cls}:${state}`).forEach(item => add(item.prop));
      }
    }
    // Fallback for scopes that are not currently attached to the selected element.
    customCssItemsForScopeAllBreakpoints(effectiveScopeKey).forEach(item => add(item.prop));
    return props;
  }
  function addCustomCssItem(prop, value = '') {
    const cleanProp = normalizeCustomCssProp(prop);
    const cleanValue = normalizeCustomCssValue(value);
    if (!cleanProp) return;
    setScopes(prev => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const existing = Array.isArray(current.customCss) ? current.customCss : [];
      return { ...prev, [effectiveScopeKey]: { ...current, customCss: [...existing, { prop: cleanProp, value: cleanValue }] } };
    });
  }
  function updateCustomCssItem(propName, value) {
    const cleanValue = normalizeCustomCssValue(value);
    setScopes(prev => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const list = [...(Array.isArray(current.customCss) ? current.customCss : [])];
      const idx = list.findIndex(item => item && item.prop === propName);
      if (idx >= 0) {
        list[idx] = { ...list[idx], value: cleanValue };
      }
      return { ...prev, [effectiveScopeKey]: { ...current, customCss: list } };
    });
  }
  function removeCustomCssItem(propName) {
    setScopes(prev => {
      const current = prev[effectiveScopeKey] || emptyProps();
      const list = (Array.isArray(current.customCss) ? current.customCss : [])
        .filter(item => item && item.prop !== propName);
      return { ...prev, [effectiveScopeKey]: { ...current, customCss: list } };
    });
  }

  function partitionSection(group) {
    const list = SCHEMA[group] || [];
    const explicit = new Set(getShown(group));
    const p_ = p[group] || {};
    const globals_ = p.__globals || {};
    const positionVal = p_.position || placeholderFor('layout','position');
    const ctx_ = { ...p_, position: positionVal };

    const visible = [];
    const hidden = [];
    const inheritedMap = {};
    for (const prop of list) {
      const hasVal = scopeHasOwnAtActiveBreakpoint(
        scopesForRead, parsedScopesByBpKey, effectiveScopeKey, group, prop.k, device, activeMediaQuery,
      );
      // A property linked to a global has an empty raw value, without
      // this check, linking a global to (say) fontFamily would make the
      // field vanish from the Inspector. Treat linked props as visible.
      const isLinked = !!globals_[`${group}.${prop.k}`]
        || (prop.k === 'textShadow' && !!globals_[`${group}.textShadowColor`]);
      // "Common" props in the schema map to the Elementor-style always-on
      // controls (font family / size / color / etc.). Surface them so the
      // globe icons are always one click away.
      const alwaysVisible = prop.common === true;
      if (prop.showWhen && !prop.showWhen(ctx_)) continue;
      // autoShowWhen: condition true hone par auto-visible, false hone par
      // Add Properties mein milta hai (showWhen ki tarah skip nahi hota).
      const autoVisible = prop.autoShowWhen ? prop.autoShowWhen(ctx_) : false;
      // When viewing the local scope, pre-show properties that are already
      // set in any applied class so the user can immediately override them.
      const isInheritedFromClass = activeScope === 'local' && !hasVal && (() => {
        const eff = effectiveSource(group, prop.k);
        return !!(eff && eff.scopeName !== 'local' && eff.value);
      })();
      // Symmetric to the above: when viewing a class scope, pre-show
      // properties the user has set on the local (inline) scope, so
      // switching local→class keeps those rows visible instead of vanishing.
      const isSetInLocal = activeScope !== 'local' && !hasVal
        && scopeHasExplicit('local', group, prop.k);

      if (hasVal || explicit.has(prop.k) || isLinked || alwaysVisible || autoVisible || isInheritedFromClass || isSetInLocal) {
        visible.push(prop);
      } else {
        hidden.push(prop);
        const inhBp = inheritedFromBreakpoint(group, prop.k);
        if (inhBp) {
          const eff = effectiveSource(group, prop.k);
          inheritedMap[prop.k] = {
            from: eff?.scopeName || effectiveScopeKey,
            value: eff?.value || '',
            fromBreakpoint: inhBp,
          };
        }
      }
    }
    return { visible, hidden, inheritedMap };
  }

  // Elementor global classes (kit `text-{id}` / Atomic / container width) used
  // to be read-only because they were defined on Elementor's Globals page. With
  // Elementor Globals removed, no scope is locked here, UiChemy global classes
  // remain fully editable (their edits persist to the UiChemy registry).
  const lockedFieldsMeta = { fields: null, kind: null, all: false };

  const lockedFields = lockedFieldsMeta.fields;
  const lockedGlobalKind = lockedFieldsMeta.kind;
  const globalReadOnly = !!lockedFieldsMeta.all;

  /** Effective value on the selected element (winning scope in the cascade). */
  function resolvedScopeValue(group, key) {
    const eff = effectiveSource(group, key);
    return eff?.value || '';
  }

  const ctx = {
    p, upd, getUnit, setUnit, setColorValue,
    displayValue, resolvedScopeValue, placeholderFor, inheritedFrom, propCascade,
    globalProps, globals, lockedFields, lockedGlobalKind,
    activeScope, setActiveScope,
    importedFontFamilies,
    mode,
    // The selected element + its writer + entry, so the on-canvas typography bar
    // can offer a dynamic-tag (⚡) control for text/image elements — the same
    // binding the panel's Content field sets.
    element, setElement, selectedEntry,
    // Drives the on-canvas typography bar's light/dark palette (see
    // composer-canvas-typo → composer-box-handles `.uich-bh-dark`).
    theme,
  };

  // ── Custom background section with Color / Gradient / Image tabs ──────────
  function renderBackgroundSection() {
    const T = I;
    const bgBag = p.background || {};

    // Whether background-color is actually set at the ACTIVE breakpoint. The
    // remove-colour button must follow the same per-breakpoint ownership rule
    // the rest of the panel uses. Reading the raw bag (`bgBag.bgColor`) instead
    // showed the button on breakpoints that merely INHERIT the colour, there
    // clicking remove cleared React state but left the owning breakpoint's CSS
    // untouched, so the colour never actually disappeared.
    const bgColorHasOwn = propCascade('background', 'bgColor').hasOwn;

    // Two tabs: Color (background-color + gradient) and Image (background-image url).
    // Color and Gradient share this tab because they map to *different* CSS
    // properties (background-color vs background-image) and can coexist.
    // Note: a gradient string sitting in bgImage (from legacy data) must not
    // flip the tab, the gradient is owned by the Color tab.
    const effBgImage = resolvedScopeValue('background', 'bgImage');
    const effBgGradient = resolvedScopeValue('background', 'bgGradient');
    const bgImageIsGradient = typeof effBgImage === 'string'
      && /-gradient\s*\(/i.test(effBgImage);
    const hasUrlImage = effBgImage && !bgImageIsGradient;
    const derivedTab = (hasUrlImage && !effBgGradient) ? 'image' : 'color';
    const activeBgTab = (bgTab === 'gradient' ? 'color' : bgTab) || derivedTab;

    function switchTab(tab) {
      if (tab === activeBgTab) return;
      setBgTab(tab);
    }

    // Keep alias consistent for rest of function
    const bgTab_ = activeBgTab;

    // Parse gradient JSON safely
    const gradValue = (() => {
      const raw = bgBag.bgGradient || resolvedScopeValue('background', 'bgGradient');
      if (!raw) return null;
      try { return typeof raw === 'object' ? raw : JSON.parse(String(raw)); }
      catch { return null; }
    })();


    // Schema props for this section (for auxiliary options)
    const BG_AUX = ['bgRepeat', 'bgSize', 'bgPosition', 'bgAttachment', 'bgOrigin', 'bgClip', 'bgBlendMode'];
    const bgSchema = SCHEMA.background || [];

    function renderBgProp(k, colSpan = 6) {
      const prop = bgSchema.find(p_ => p_.k === k);
      if (!prop) return null;
      return (
        <div className="prop-cell" key={k} style={{ gridColumn: `span ${colSpan}` }}>
          <PropField group="background" prop={prop} ctx={ctx} />
        </div>
      );
    }

    const colorProp   = bgSchema.find(p_ => p_.k === 'bgColor');
    const imageProp   = bgSchema.find(p_ => p_.k === 'bgImage');
    return (
      <div className={`section${globalReadOnly ? ' is-locked' : ''}`}>
        {/* ── Mode tab strip ── */}
        <div ref={bgTabSegRef} className={cn(SEG_WRAP_CLS, 'seg-slide', 'mb-3 flex w-full')}>
          {[
            { id: 'color', label: 'Color', icon: <T.paint size={11} /> },
            { id: 'image', label: 'Image', icon: <T.image size={11} /> },
          ].map(({ id, label, icon }) => (
            <button
              key={id}
              data-state={bgTab_ === id ? 'active' : 'inactive'}
              className={cn(SEG_ITEM_CLS, 'flex-1 gap-1.5 px-2', bgTab_ === id && SEG_ITEM_ON_SLIDE_CLS)}
              onClick={() => switchTab(id)}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* ── Color tab, Solid / Gradient sub-toggle ── */}
        {bgTab_ === 'color' && (() => {
          // Which fill editor is shown. Auto-picks Gradient when the element
          // already has one, else Solid; the user can flip it explicitly.
          const hasGradient = !!(bgBag.bgGradient || gradValue);
          const fillMode = bgFillMode || (hasGradient ? 'gradient' : 'solid');
          return (
          <div className="prop-rows bg-color-rows">
            {/* Solid | Gradient */}
            <div ref={fillModeSegRef} className={cn(SEG_WRAP_CLS, 'seg-slide', 'mb-3 flex w-full')}>
              {[{ id: 'solid', label: 'Solid' }, { id: 'gradient', label: 'Gradient' }].map(({ id, label }) => (
                <button
                  key={id}
                  data-state={fillMode === id ? 'active' : 'inactive'}
                  className={cn(SEG_ITEM_CLS, 'flex-1 px-2', fillMode === id && SEG_ITEM_ON_SLIDE_CLS)}
                  onClick={() => setBgFillMode(id)}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {fillMode === 'solid' ? (
              colorProp && (
                <div className="prop-row">
                  <div className="prop-cell" style={{ gridColumn: 'span 12' }}>
                    <PropField
                      group="background"
                      prop={colorProp}
                      ctx={ctx}
                      labelAction={bgColorHasOwn ? (
                        <button
                          className="gp-gradient-remove-btn"
                          type="button"
                          title="Remove color"
                          onClick={() => { upd('background', { bgColor: '' }); unsetGlobal('background', 'bgColor'); }}
                        >
                          <T.x size={12} />
                        </button>
                      ) : null}
                    />
                  </div>
                </div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {bgBag.bgGradient && (
                  <div className="gp-section-divider">
                    <span>Gradient</span>
                    {(() => {
                      const gradCascade = propCascade('background', 'bgGradient');
                      const showGradInherited = gradCascade && gradCascade.isInherited;
                      return showGradInherited ? (
                        <AppliedFromHint
                          scope={gradCascade.appliedScope}
                          value={gradCascade.appliedValue}
                          isGlobal={mode !== 'simple' && gradCascade.appliedIsGlobal}
                          globals={globals}
                          onSelect={setActiveScope}
                          breakpointLabel={gradCascade.inheritedFromBreakpoint}
                        />
                      ) : null;
                    })()}
                    <button
                      className="gp-gradient-remove-btn"
                      type="button"
                      title="Remove gradient"
                      onClick={() => upd('background', { bgGradient: '' })}
                    >
                      <T.x size={12} />
                    </button>
                  </div>
                )}
                <GradientBuilder
                  value={gradValue || DEFAULT_GRADIENT}
                  onChange={(g) => {
                    setBgTab('color');
                    setBgFillMode('gradient');
                    upd('background', { bgGradient: JSON.stringify(g), bgImage: '' });
                  }}
                  globals={globals}
                />
              </div>
            )}
          </div>
          );
        })()}

        {/* ── Image tab ── */}
        {bgTab_ === 'image' && imageProp && (
          <div className="prop-rows">
            {colorProp && (
              <div className="prop-row">
                <div className="prop-cell" style={{ gridColumn: 'span 12' }}>
                  <PropField
                    group="background"
                    prop={colorProp}
                    ctx={ctx}
                    labelAction={(bgBag.bgColor || getGlobal('background', 'bgColor')) ? (
                      <button
                        className="gp-gradient-remove-btn"
                        type="button"
                        title="Remove color"
                        onClick={() => { upd('background', { bgColor: '' }); unsetGlobal('background', 'bgColor'); }}
                      >
                        <T.x size={12} />
                      </button>
                    ) : null}
                  />
                </div>
              </div>
            )}
            <div className="prop-row">
              <div className="prop-cell" style={{ gridColumn: 'span 12' }}>
                <PropField
                  group="background"
                  prop={imageProp}
                  ctx={{
                    ...ctx,
                    upd: (group, patch) => {
                      if (group === 'background' && patch.bgImage) {
                        ctx.upd('background', { ...patch, bgGradient: '' });
                      } else {
                        ctx.upd(group, patch);
                      }
                    }
                  }}
                />
              </div>
            </div>
            <div className="prop-row">
              {renderBgProp('bgRepeat', 6)}
              {renderBgProp('bgSize', 6)}
            </div>
            <div className="prop-row">
              {renderBgProp('bgPosition', 6)}
              {renderBgProp('bgAttachment', 6)}
            </div>
            <div className="prop-row">
              {renderBgProp('bgOrigin', 6)}
              {renderBgProp('bgClip', 6)}
            </div>
            <div className="prop-row">
              {renderBgProp('bgBlendMode', 12)}
            </div>
          </div>
        )}

      </div>
    );
  }

  function renderSchemaSection(group) {
    const { visible, hidden, inheritedMap } = partitionSection(group);

    const groups = {};
    const groupOrder = [];
    for (const prop of visible) {
      const g = prop.group || '_main';
      if (!groups[g]) { groups[g] = []; groupOrder.push(g); }
      groups[g].push(prop);
    }

    function widthOf(_p) {
      return 0.5;
    }
    function colSpan(_p) {
      return 6;
    }
    function packRows(props_) {
      const rows = [];
      let row = [];
      let fill = 0;
      for (const p of props_) {
        const w = widthOf(p);
        if (w >= 1) {
          if (row.length) {
            rows.push(row);
            row = [];
            fill = 0;
          }
          rows.push([{ ...p, _colSpan: colSpan(p) }]);
        } else {
          if (fill + w > 1.001) {
            rows.push(row);
            row = [];
            fill = 0;
          }
          row.push({ ...p, _colSpan: colSpan(p) });
          fill += w;
        }
      }
      if (row.length) rows.push(row);
      return rows;
    }

    return (
      <div className="section">
        <div className="prop-rows">
          {groupOrder.length === 0 && (
            <div className="section-empty">
              {globalReadOnly ? (
                <>
                  <span>No <b>{group}</b> properties are defined on this global.</span>
                  <span className="section-empty-hint">Edit the global token to change its values.</span>
                </>
              ) : (
                <>
                  <span>No properties set for <b>{group}</b> in this scope.</span>
                  <span className="section-empty-hint">Use <b>Add property</b> to start editing.</span>
                </>
              )}
            </div>
          )}
          {groupOrder.map((gname) => (
            <React.Fragment key={gname}>
              {gname !== '_main' && (
                <div className="subsec">
                  <span className="subsec-title">{gname}</span>
                  <span className="subsec-rule" />
                </div>
              )}
              {packRows(groups[gname]).map((row, ri) => (
                <div className="prop-row" key={ri}>
                  {row.map((prop) => (
                    <div
                      className={`prop-cell${globalReadOnly ? ' is-locked' : ''}`}
                      key={prop.k}
                      style={{ gridColumn: `span ${prop._colSpan || 6}` }}
                    >
                      <PropField
                        group={group}
                        prop={prop}
                        ctx={ctx}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>

        {!globalReadOnly && (
          <AddProperty
            section={group}
            hidden={hidden}
            inheritedMap={inheritedMap}
            onAdd={(k) => addShown(group, k)}
          />
        )}
      </div>
    );
  }

  // Spacing has no SCHEMA entry (it renders via SpacingBox, not schema fields),
  // so its dirty-dot must check the per-side margin/padding keys directly.
  const SPACING_PROP_KEYS = [
    'padTop', 'padRight', 'padBottom', 'padLeft',
    'marTop', 'marRight', 'marBottom', 'marLeft',
  ];

  function scopeHas(group) {
    const list = group === 'spacing'
      ? SPACING_PROP_KEYS.map((k) => ({ k }))
      : (SCHEMA[group] || []);
    return list.some((prop) => scopeHasOwnAtActiveBreakpoint(
      scopesForRead, parsedScopesByBpKey, effectiveScopeKey, group, prop.k, device, activeMediaQuery,
    ));
  }

  const typoMeta = () => {
    const fam = resolvedScopeValue('typography', 'fontFamily') || placeholderFor('typography', 'fontFamily');
    const sz  = resolvedScopeValue('typography', 'fontSize')   || placeholderFor('typography', 'fontSize');
    const lh  = resolvedScopeValue('typography', 'lineHeight') || placeholderFor('typography', 'lineHeight');
    const szUnit = getUnit('typography.fontSize', 'px');
    const szOut = sz && !/\d(px|em|rem|%|vw|vh)$/i.test(sz) ? sz + szUnit : sz;
    return [fam, szOut, lh].filter(Boolean).join(' · ') || '';
  };
  const layoutMeta = () => {
    const l = p.layout || {};
    return [l.display || placeholderFor('layout', 'display'), l.position || placeholderFor('layout', 'position')].filter(Boolean).join(' · ') || '';
  };

  // Element identity + actions: the tag selector and Mark as. (Attributes moved
  // out of this row into its own inspector section — see SECTIONS below.)
  // Extracted from the head so the right dock can render it BELOW the class
  // strip (classes on top, actions under them, per the ui-ux request) while the
  // bottom dock keeps it inline in the head as before. Only one of the two
  // render sites is ever active — they are gated on opposite `dock` values — so
  // the shared refs (markBtnRef) and dropdown never mount twice. [ui-ux]
  const headActions = mode !== 'simple' ? (
        <>
        {/* The element's tag sits with Mark as, not on the scope strip below:
            both answer "what is this element", while the strip answers "what am
            I styling". Keeping it here also avoids a genuine collision — the
            strip can carry a `tag:h1` SCOPE chip, which used to sit right beside
            an identically-labelled tag dropdown.

            Shown for EVERY element, not only the text tags: the dropdown's
            catalogue already covers containers, media, lists and form controls,
            and gating it on TEXT_ELEMENT_TAGS meant a <div>/<section>/<a> had no
            way to change its tag from the inspector at all. */}
        {element?.tag && (
          <TagModifyDropdown
            element={element}
            setElement={setElement}
            className="insp-head-tag shrink-0"
            triggerClassName="gap-1 border border-input bg-background font-mono font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
            trigger={<><span>{`<${element.tag}>`}</span><T.caretDown size={11} /></>}
          />
        )}
        {onMark && (
          <>
            <Button
              ref={markBtnRef}
              type="button"
              variant={markOpen ? 'secondary' : 'outline'}
              size="sm"
              className="insp-head-mark h-6 shrink-0 gap-1 px-2 text-xs"
              onClick={() => setMarkOpen((v) => !v)}
              title={markLoopActive
                ? 'This element is a loop. Click to manage.'
                : markFormActive
                  ? 'This element is a form. Click to manage.'
                  : 'Mark this element as a dynamic loop or form'}
            >
              {/* Reflect the active construct right on the button so it reads as a
                  Loop / Form at a glance, without opening the dropdown. */}
              {markLoopActive ? (
                <>
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'hsl(var(--status-loop))' }} />
                  <span style={{ color: 'hsl(var(--status-loop))' }}>Loop</span>
                </>
              ) : markFormActive ? (
                <>
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'hsl(var(--status-form))' }} />
                  <span style={{ color: 'hsl(var(--status-form))' }}>Form</span>
                </>
              ) : (
                <span>Mark as</span>
              )}
              <T.caretDown size={11} />
            </Button>
            <DropdownMenuLayer
              triggerRef={markBtnRef}
              open={markOpen}
              onClose={() => setMarkOpen(false)}
              minWidth={160}
            >
              {markLoopActive ? (
                // Already a loop (the element itself OR a direct child that holds
                // it, e.g. a grid wrapper) → show it SELECTED (✓); clicking
                // removes the loop. Mirrors the Layers context-menu state exactly
                // so the two never disagree.
                <button
                  type="button"
                  className={`${MENU_ITEM_CLS} font-medium text-foreground`}
                  title="Loop. Click to remove."
                  onClick={() => { onRemoveConstruct && onRemoveConstruct('loop'); setMarkOpen(false); }}
                >
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'hsl(var(--status-loop))' }} />
                  Mark as loop
                  <span className="ml-auto text-xs" style={{ color: 'hsl(var(--status-loop))' }}>✓</span>
                </button>
              ) : markFormActive ? (
                // Mutually exclusive: an element can't be both a form and a loop.
                // It's already a form, so marking it a loop is disabled.
                <button
                  type="button"
                  className={`${MENU_ITEM_CLS} cursor-not-allowed opacity-40`}
                  disabled
                  aria-disabled="true"
                  title="This element is a form. An element can't be both a form and a loop, so remove the form first."
                ><T.loop size={12} /> Mark as loop</button>
              ) : (
                <button
                  type="button"
                  className={MENU_ITEM_CLS}
                  onClick={() => { onMark('loop'); setMarkOpen(false); }}
                ><T.loop size={12} /> Mark as loop</button>
              )}
              {markFormActive ? (
                <button
                  type="button"
                  className={`${MENU_ITEM_CLS} font-medium text-foreground`}
                  title="Form. Click to remove."
                  onClick={() => { onRemoveConstruct && onRemoveConstruct('form'); setMarkOpen(false); }}
                >
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'hsl(var(--status-form))' }} />
                  Mark as form
                  <span className="ml-auto text-xs" style={{ color: 'hsl(var(--status-form))' }}>✓</span>
                </button>
              ) : markLoopActive ? (
                // Mutually exclusive: an element can't be both a loop and a form.
                // It's already a loop, so marking it a form is disabled.
                <button
                  type="button"
                  className={`${MENU_ITEM_CLS} cursor-not-allowed opacity-40`}
                  disabled
                  aria-disabled="true"
                  title="This element is a loop. An element can't be both a loop and a form, so remove the loop first."
                ><T.form size={12} /> Mark as form</button>
              ) : (
                <button
                  type="button"
                  className={MENU_ITEM_CLS}
                  onClick={() => { onMark('form'); setMarkOpen(false); }}
                ><T.form size={12} /> Mark as form</button>
              )}
            </DropdownMenuLayer>
          </>
        )}
        {/* Breakpoint switcher intentionally removed from the composer: inside
            the Elementor editor its top bar already switches devices, and on the
            published front end there's no Elementor device machinery for it to
            drive. Device state still syncs from Elementor via useElementorDeviceMode. */}
        </>
  ) : null;

  return (
    <LoopBindingContext.Provider value={loopCtx}>
    {/* Canvas toolbar controls. Rendered here, not from composer-app, because
        `ctx` only exists inside this component, and sharing it is what makes the
        toolbar and the panel the same field rather than two that must agree. */}
    {/* One boundary EACH, and silent. Both of these portal into the canvas
        toolbar, and they used to sit bare inside the Inspector's own boundary —
        so when CanvasTextToolbarSlot threw (it passed the slot WRAPPER to
        createPortal instead of slot.node, React error #200), the boundary
        unmounted the entire Inspector and took the working typography controls
        with it. The panel showed "The Inspector hit an error" while the canvas
        showed a toolbar with nothing but the grip and Ask AI. Isolated, a broken
        canvas widget now costs only itself. */}
    <ComposerErrorBoundary label="CanvasTypographyBar" silent>
      <CanvasTypographyBar ctx={ctx} />
    </ComposerErrorBoundary>
    <ComposerErrorBoundary label="CanvasTextToolbarSlot" silent>
      <CanvasTextToolbarSlot ctx={ctx} />
    </ComposerErrorBoundary>
    <div className="inspector">
      {/* Row A: the Design/Developer switch (passed in for the right dock) shares
          this row with the Developer actions. Gate widened so the row still shows
          in Design mode — where it carries just the switch (actions are gated
          below). In the bottom dock modeSwitch is null, so this stays the
          Developer-only actions strip it was before. [ui-ux] */}
      {(modeSwitch || mode !== 'simple') && (
      <div className="inspector-head">
        {modeSwitch && <div className="inspector-head__tabs">{modeSwitch}</div>}
        {/* Element identity (tag + classes) now lives on the context line in
            zone 2 (AppliedClasses). Kept out of the head to remove the duplicate
            and drop a row; the action buttons below remain. */}
        {false && (
        <div className="target">
          {(<>
          {element.classes.length > 0 && (
            <span className="target-class">
              {element.classes.map((c) => '.' + displayClassName(c)).join('')}
            </span>
          )}
          {editingTag ? (
            <div className="target-tag-input-wrapper">
              <input
                ref={tagInputRef}
                className="h-6 rounded-md border border-input bg-transparent px-1.5 font-mono text-xs text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                value={editingTagValue}
                style={{ width: `${Math.max(4, editingTagValue.length + 2)}ch` }}
                autoFocus
                spellCheck={false}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  setEditingTagValue(e.target.value);
                  setSuggestionIndex(0);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setEditingTag(false);
                  }, 180);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const row = flatRows[suggestionIndex] || flatRows[0];
                    if (row) {
                      const t = row.tag.trim().toLowerCase();
                      if (t && isValidTagName(t)) setElement({ ...element, tag: t });
                    } else {
                      const t = editingTagValue.trim().toLowerCase();
                      if (t && isValidTagName(t)) setElement({ ...element, tag: t });
                    }
                    setEditingTag(false);
                  } else if (e.key === 'Escape') {
                    setEditingTag(false);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (flatRows.length > 0) {
                      setSuggestionIndex((prev) => (prev + 1) % flatRows.length);
                    }
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (flatRows.length > 0) {
                      setSuggestionIndex((prev) => (prev - 1 + flatRows.length) % flatRows.length);
                    }
                  }
                }}
              />
              {flatRows.length > 0 && tagMenuPos && ReactDOM.createPortal(
                <div
                  className="flex max-h-[260px] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
                  style={{ position: 'fixed', top: tagMenuPos.top, left: tagMenuPos.left, width: tagMenuPos.width, zIndex: 2147483646 }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="tag-menu-list flex-1 overflow-y-auto p-1" ref={tagListRef} role="listbox">
                    {(() => {
                      let cursor = 0;
                      const customRowIdx = showCustom ? cursor++ : -1;
                      return (
                        <>
                          {showCustom && (
                            <button
                              data-row-idx={customRowIdx}
                              type="button"
                              className={cn(MENU_ITEM_CLS, suggestionIndex === customRowIdx && 'bg-accent text-accent-foreground')}
                              onMouseDown={() => {
                                if (isValidTagName(query)) setElement({ ...element, tag: query });
                                setEditingTag(false);
                              }}
                              onMouseEnter={() => setSuggestionIndex(customRowIdx)}
                              role="option"
                              aria-selected={suggestionIndex === customRowIdx}
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"><T.plus size={12} /></span>
                              <span className="flex min-w-0 flex-col items-start">
                                <span className="font-mono text-xs">{`<${query}>`}</span>
                                <span className="text-[11px] text-muted-foreground">Use as custom tag</span>
                              </span>
                            </button>
                          )}
                          {groups.map((group) => (
                            <React.Fragment key={group.title}>
                              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</div>
                              {group.items.map((it) => {
                                const Ic = tagIcon(it.tag);
                                const idx = cursor++;
                                const isActive = suggestionIndex === idx;
                                const isCurrent = element.tag === it.tag;
                                return (
                                  <button
                                    data-row-idx={idx}
                                    key={it.tag}
                                    type="button"
                                    className={cn(MENU_ITEM_CLS, (isActive || isCurrent) && 'bg-accent text-accent-foreground')}
                                    onMouseDown={() => {
                                      if (isValidTagName(it.tag)) setElement({ ...element, tag: it.tag });
                                      setEditingTag(false);
                                    }}
                                    onMouseEnter={() => setSuggestionIndex(idx)}
                                    role="option"
                                    aria-selected={isActive}
                                  >
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"><Ic size={12} /></span>
                                    <span className="flex min-w-0 flex-col items-start">
                                      <span className="font-mono text-xs">{`<${it.tag}>`}</span>
                                      <span className="text-[11px] text-muted-foreground">{it.label}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </React.Fragment>
                          ))}
                          {groups.length === 0 && !showCustom && (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">No tags match "{editingTagValue}".</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>,
                ensurePortalRoot(tagInputRef.current?.ownerDocument || document),
              )}
            </div>
          ) : (
            <>
              <span
                className="target-tag target-tag-editable"
                title="Click to edit tag"
                onClick={() => { setEditingTagValue(element.tag); setEditingTag(true); }}
              >
                &lt;{element.tag}&gt;
              </span>
              <button
                className="tag-modify-btn"
                type="button"
                title="Change element tag"
                onClick={() => { setEditingTagValue(element.tag); setEditingTag(true); }}
              >
                <T.pencil size={10} />
              </button>
            </>
          )}
          </>)}
        </div>
        )}
        {/* Bottom dock keeps the identity + actions inline in the head. The
            right dock renders `headActions` below the class strip instead — see
            the .insp-actions-row block in the inspector body. [ui-ux] */}
        {dock !== 'right' && headActions}
      </div>
      )}

      <div className="inspector-body">
        <div className="inspector-top">
          {mode !== 'simple' && (<>
          <AppliedClasses
            element={element}
            setElement={setElement}
            scopes={scopes}
            setScopes={setScopes}
            activeScope={activeScope}
            setActiveScope={setActiveScope}
            globals={globals}
            isMedia={isMedia}
            selectedEntry={selectedEntry}
            state={state}
            setState={setState}
            parsedScopesByBpKey={parsedScopesByBpKey}
            localScopeNeedsClass={localScopeNeedsClass}
          />
          </>)}

          {/* Right dock only: the tag / Mark as actions sit BELOW
              the class strip, so the panel reads classes-first (per the ui-ux
              request). The bottom dock renders the same `headActions` up in the
              head instead — the two sites are mutually exclusive on `dock`. */}
          {dock === 'right' && headActions && (
            <div className="insp-actions-row">{headActions}</div>
          )}

        </div>

          <div style={{ position: 'relative' }}>
            {!isDesktopDevice && activeScope === 'local' && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 10,
                    cursor: 'not-allowed',
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.parentElement.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    setLocalBlockTooltip((v) => v ? null : { x, y });
                  }}
                  onMouseLeave={() => setLocalBlockTooltip(null)}
                />
                {localBlockTooltip && (
                  <div
                    className="pointer-events-none absolute z-[11] -translate-x-1/2 translate-y-[calc(-100%-6px)] whitespace-nowrap rounded-md border bg-popover px-2.5 py-1 text-[11px] text-popover-foreground shadow-md"
                    style={{ top: localBlockTooltip.y, left: localBlockTooltip.x }}
                  >
                    Only Desktop supports local style customization.
                  </div>
                )}
              </>
            )}
            {(() => {
              // Shared list of style/content sections. In bottom dock these are
              // tabs + a single visible body; in right dock (vertical/Elementor
              // layout) they render as stacked accordions.
              // Content is the first section and Custom CSS the last, in BOTH
              // modes, so the Design and Developer tabs expose the same dropdowns
              // in the same order.
              const SECTIONS = [
                { id: 'content',    label: 'Content',    icon: T.text,    dirty: false },
                // Attributes used to be a toggle button up in the actions row
                // that replaced the whole section list while it was on. It is a
                // section like any other now — same accordion row in the right
                // dock, same tab in the bottom dock — and it keeps its own
                // dirty dot when the element carries custom attributes.
                // Hidden in simple mode, which is where the old button was
                // hidden too (headActions is gated on `mode !== 'simple'`).
                ...(mode !== 'simple'
                  ? [{ id: 'attributes', label: 'Attributes', icon: T.code, dirty: countEditableAttrs(selectedEntry) > 0 }]
                  : []),
                { id: 'typography', label: 'Typography', icon: T.type,    dirty: scopeHas('typography') },
                { id: 'layout',     label: 'Layout',     icon: T.layout,  dirty: scopeHas('layout') },
                { id: 'spacing',    label: 'Spacing',    icon: T.spacing, dirty: scopeHas('spacing') },
                { id: 'background', label: 'Background', icon: T.paint,   dirty: scopeHas('background') },
                { id: 'border',     label: 'Border',     icon: T.border,  dirty: scopeHas('border') },
                { id: 'effects',    label: 'Effects',    icon: T.effect,  dirty: scopeHas('effects') },
                { id: 'customcss',  label: 'Custom CSS', icon: T.code,    dirty: getCustomCssItems().length > 0 },
              ];

              // Numeric part only (the unit lives on the pill). Keyword values
              // like `auto` have no number, so they render as an empty cell.
              // Defined up here (before its first use) because the right-dock
              // accordion layout returns early below, before the old definition
              // site, leaving `numOf` uninitialised and crashing the Spacing box.
              const numOf = (v) => {
                const str = String(v == null ? '' : v).trim();
                if (!str || LENGTH_KEYWORD_UNITS.has(str)) return '';
                const parsed = parseLen(str, '');
                return (parsed && parsed.num != null && parsed.num !== '') ? String(parsed.num) : '';
              };

              // Cascade-aware cell: own value when this scope sets it, otherwise
              // the inherited/parent value shown as a placeholder, matching how
              // Layout/Typography length fields already behave. The own value is
              // read raw (not re-parsed) so in-progress typing like "1." or a
              // trailing decimal isn't reformatted mid-keystroke.
              const spacingCellData = (prefix, side) => {
                const propKey = `${prefix}${side}`;
                const cas = propCascade('spacing', propKey);
                const ownRaw = (p.spacing && p.spacing[propKey] != null)
                  ? String(p.spacing[propKey]) : '';
                return {
                  value: cas.hasOwn ? ownRaw : '',
                  placeholder: numOf(cas.appliedValue) || '0',
                };
              };

              // When a value is typed, seed the effective unit onto any side that
              // is about to become owned so the writer keeps the inherited unit
              // (em/%/rem) instead of silently falling back to px.
              const spacingSetValue = (prefix, side, v, linked) => {
                const sides = linked ? ['Top', 'Right', 'Bottom', 'Left'] : [side];
                sides.forEach((s) => {
                  const key = `spacing.${prefix}${s}`;
                  if (!scopeHasExplicit(effectiveScopeKey, 'spacing', `${prefix}${s}`)) {
                    const u = getUnit(key, '');
                    if (u && !LENGTH_KEYWORD_UNITS.has(u)) setUnit(key, u);
                  }
                });
                const patch = {};
                sides.forEach((s) => { patch[`${prefix}${s}`] = v; });
                upd('spacing', patch);
              };

              // The pill is one control per box, but values live per side. Reflect
              // the unit of whichever side actually drives the box so a single
              // value (e.g. only padding-left) still shows/changes its own unit
              // instead of always reading the Top side.
              const boxUnit = (prefix, def = 'px') => {
                const sides = ['Top', 'Right', 'Bottom', 'Left'];
                // Merge the writable scope's units under the live-DOM ones so a
                // pending pill choice made before any value exists is seen on
                // inline/local elements too (setUnit writes to scopes[key],
                // which for inline is not the same object as `p`).
                const localUnits = {
                  ...(scopes[effectiveScopeKey]?.__units || {}),
                  ...((p && p.__units) || {}),
                };
                // 1) a side this scope explicitly owns (has a value for)
                for (const s of sides) {
                  if (scopeHasExplicit(effectiveScopeKey, 'spacing', `${prefix}${s}`)) {
                    return getUnit(`spacing.${prefix}${s}`, def);
                  }
                }
                // 2) a pending unit chosen on this scope before any value exists
                for (const s of sides) {
                  const u = localUnits[`spacing.${prefix}${s}`];
                  if (u) return u;
                }
                // 3) an inherited side's unit
                for (const s of sides) {
                  const u = getUnit(`spacing.${prefix}${s}`, '');
                  if (u) return u;
                }
                return def;
              };

              // Changing the pill applies to all four sides. For a side that only
              // inherits a value, materialise that number first so the new unit
              // actually changes the rendered spacing.
              const spacingSetBoxUnit = (prefix, u) => {
                ['Top', 'Right', 'Bottom', 'Left'].forEach((side) => {
                  const propKey = `${prefix}${side}`;
                  if (!scopeHasExplicit(effectiveScopeKey, 'spacing', propKey)
                      && !LENGTH_KEYWORD_UNITS.has(u)) {
                    const num = numOf(placeholderFor('spacing', propKey));
                    if (num !== '') upd('spacing', { [propKey]: num });
                  }
                  setUnit(`spacing.${propKey}`, u);
                });
              };

              function renderSpacingBody() {
                function fmt(group, key, defUnit) {
                  const raw = displayValue(group, key) || placeholderFor(group, key) || '';
                  if (!raw) return 'auto';
                  const parsed = parseLen(raw, defUnit);
                  if (!parsed.num) return parsed.unit || raw;
                  const u = getUnit(`${group}.${key}`, parsed.unit || defUnit);
                  return parsed.num + u;
                }
                return (
                  <div className={`section spacing-section${globalReadOnly ? ' is-locked' : ''}`}>
                    <div className="full">
                      <SpacingBox
                        spacing={p.spacing || {}}
                        getUnit={getUnit}
                        setUnit={setUnit}
                        onChange={(patch) => upd('spacing', patch)}
                        cellData={spacingCellData}
                        setValue={spacingSetValue}
                        setBoxUnit={spacingSetBoxUnit}
                        getBoxUnit={boxUnit}
                        widthLabel={fmt('layout','width','%')}
                        heightLabel={fmt('layout','height','px')}
                      />
                    </div>
                  </div>
                );
              }

              function renderContentBody() {
                return (
                  <div className="section simple-content-section">
                    {!isMedia && (
                      <ElementTextField element={element} setElement={setElement} />
                    )}
                    {isMedia && selectedEntry && selectedEntry.tag === 'img' && (
                      <ImageEditor
                        element={element}
                        setElement={setElement}
                        selectedEntry={selectedEntry}
                      />
                    )}
                    {isMedia && isSvgLayerEntry(selectedEntry) && selectedEntry.tag !== 'img' && (
                      <SvgEditor
                        rawHtml={rawHtml}
                        element={element}
                        setElement={setElement}
                        selectedEntry={selectedEntry}
                        onSvgUrl={onSvgUrlChange}
                      />
                    )}
                    {/* LINK editor. Shown only for <a> and <div>. On a <div>
                        (non-anchor) the link is stored as data-uich-link*
                        markers and materialised as an <a> wrapper by the
                        widget's PHP render. Loop/form wrappers are excluded: a
                        link on the wrapper would wrap the whole construct, the
                        link belongs on the item inside, not the wrapper.
                        `isAnchor` gates the custom-attrs field, which only
                        works for real <a> elements. */}
                    {selectedEntry && anchorLink
                      && (selectedEntry.tag === 'a' || selectedEntry.tag === 'div')
                      && !markLoopActive && !markFormActive && (
                      <AnchorLinkEditor
                        link={anchorLink}
                        onChange={onAnchorLinkChange}
                        disabled={anchorLinkDisabled}
                        isAnchor={selectedEntry.tag === 'a'}
                      />
                    )}
                  </div>
                );
              }

              function renderAttributesBody() {
                return (
                  <ElementAttributeEditor
                    selectedEntry={selectedEntry}
                    setElement={setElement}
                  />
                );
              }

              function renderCustomCssBody() {
                return (
                  <CustomCssSection
                    items={getCustomCssItems()}
                    inheritedItems={getInheritedCustomCssItems()}
                    relevantProps={getRelevantCustomCssProps()}
                    cascadeMap={getCustomCssCascadeMap()}
                    onAdd={addCustomCssItem}
                    onUpdate={updateCustomCssItem}
                    onRemove={removeCustomCssItem}
                    globals={globals}
                    setActiveScope={setActiveScope}
                  />
                );
              }

              function renderSectionBody(id) {
                if (id === 'content')    return renderContentBody();
                if (id === 'attributes') return renderAttributesBody();
                if (id === 'spacing')    return renderSpacingBody();
                if (id === 'background') return renderBackgroundSection();
                if (id === 'customcss')  return renderCustomCssBody();
                return renderSchemaSection(id);
              }

              // One source of truth for the per-section summary hint, so the
              // bottom-dock tab strip and the right-dock accordion show the same
              // "what's inside" caption.
              function sectionMeta(id) {
                return ({
                  content: 'text · image · link',
                  attributes: 'custom html attributes',
                  typography: typoMeta(),
                  layout: layoutMeta(),
                  spacing: 'padding · margin · gap',
                  background: 'color · image · gradient',
                  border: 'width · style · radius',
                  effects: 'opacity · shadow · filter',
                  customcss: 'custom css properties',
                })[id] || '';
              }

              if (dock === 'right') {
                // Right-dock (floating panel) navigation is a stacked accordion:
                // full-width rows (icon + label + caption). Multi-open — several
                // sections can stay expanded at once.
                return (
                  <div className="acc-list">
                    {SECTIONS.map((s) => {
                      const on = openSections.has(s.id);
                      return (
                        <div key={s.id} className={`acc${on ? ' open' : ''}`}>
                          <button
                            type="button"
                            className="acc-head"
                            onClick={() => toggleSection(s.id)}
                            aria-expanded={on ? 'true' : 'false'}
                          >
                            {/* Reference design: section rows are the name alone
                                plus the +/− — no leading icon, no caption. */}
                            <span className="acc-label">{s.label}</span>
                            {s.dirty && <span className="acc-dot" />}
                            {/* Framer-style +/− affordance instead of a caret. */}
                            <span className="acc-caret">
                              {on ? <T.minus size={12} /> : <T.plus size={12} />}
                            </span>
                          </button>
                          {on && <div className="acc-body">{renderSectionBody(s.id)}</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return (
                <>
                  <div className="section-tabs stabs-labeled">
                    {SECTIONS.map(s => {
                      const isOn = activeSection === s.id;
                      const Ic = s.icon;
                      return (
                        <button
                          key={s.id}
                          className={cn(
                            'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                            isOn && 'bg-accent text-accent-foreground',
                          )}
                          onClick={() => setActiveSection(isOn ? null : s.id)}
                          title={s.label}
                        >
                          {Ic && <Ic size={13} className="shrink-0 opacity-70" />}
                          <span>{s.label}</span>
                          {s.dirty && !isOn && <span className="h-1 w-1 shrink-0 rounded-full bg-primary" />}
                        </button>
                      );
                    })}
                    <div className="flex-1" />
                    <div className="min-w-0 truncate text-[10px] text-muted-foreground">{sectionMeta(activeSection)}</div>
                  </div>

                  {SECTIONS.some((s) => s.id === activeSection) && renderSectionBody(activeSection)}
                </>
              );
            })()}
          </div>

        {/* Dynamic construct (Loop / Form / Condition / Data) options, rendered
            as a collapsible accordion at the bottom of the inspector scroll
            flow instead of a dedicated tab. */}
        {constructSlot}
      </div>

      {/* The status footer (scope · breakpoint · state pills) was removed: all
          three only mirrored state the user had just set elsewhere in the panel,
          so it spent a full row restating what the scope chip, the breakpoint
          switcher and the state selector already show. The skin and theme
          toggles that shared that corner moved to Dashboard → Settings →
          Composer appearance. */}
    </div>
    </LoopBindingContext.Provider>
  );
}
