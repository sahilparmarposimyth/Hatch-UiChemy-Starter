// Generic field renderer + Add Property picker + ColorInput.
import React from 'react';
import ReactDOM from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ensurePortalRoot } from '@/components/ui/portal-context';
import { I } from './composer-icons';
import { OPTS } from './composer-css';
import { resolveUnits } from './composer-schema';
import { LengthInput, PresetChips, SelectCustomInput, renderOptions, parseLen, UnitPill, INPUT_CLS, MENU_ITEM_CLS, useSlidingSeg } from './composer-inputs';
import { parseTextShadow, formatTextShadow } from './composer-shadow-utils';
import { GradientBuilder, DEFAULT_GRADIENT } from './composer-gradient';
import { scopeLabel } from './composer-cascade';
import { computeFloatingPosition } from './composer-floating';
import { ColorInput, GlobalColorHint } from './composer-color-picker';
import { GlobalsValuePicker } from './composer-globals-picker';

// Field types whose value is structural (not a single CSS string), the globals
// value picker is not offered for these.
const GLOBALS_PICKER_SKIP = new Set(['gradient', 'media-image', 'seg-align']);

// Text-align segmented control with the shared sliding-pill indicator (same
// system as the Code / model tabs) instead of a per-item static chip. Extracted
// into its own component because useSlidingSeg is a hook and can't be called
// inside PropField's `switch`.
const ALIGN_OPTS = [
  { v: 'left', ico: 'alignL' },
  { v: 'center', ico: 'alignC' },
  { v: 'right', ico: 'alignR' },
  { v: 'justify', ico: 'alignJ' },
];
function SegAlign({ cur, inhVal, onPick }) {
  const segRef = useSlidingSeg();
  return (
    <div ref={segRef} className="seg-slide flex w-full items-center gap-0.5 rounded-md bg-muted p-0.5">
      {ALIGN_OPTS.map((o) => {
        const Ic = I[o.ico];
        const active = cur === o.v;
        return (
          <button
            key={o.v}
            data-state={active ? 'active' : 'inactive'}
            className={cn(
              'flex h-6 flex-1 items-center justify-center rounded-sm px-1.5 transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              !active && inhVal === o.v && 'text-foreground/60',
            )}
            // Toggle: clicking the already-set alignment CLEARS it so the element
            // falls back to the WP/theme default; a different one switches to it.
            onClick={() => onPick(active ? '' : o.v)}
            title={o.v}
          >
            <Ic size={12} />
          </button>
        );
      })}
    </div>
  );
}
import { mergeFontFamilyOptions } from './composer-fonts';

export { ColorInput };

/**
 * Globe icon marking a Global Class.
 *
 * When `label` is set (e.g. "Global"), the marker renders
 * as a small icon-plus-text chip, used in the Applied Class chips so the
 * user can scan at a glance what each class actually is.
 *
 * When `label` is omitted (most property-field call sites), only the globe
 * icon is shown, kept low-contrast so it reads as a hint rather than
 * a heavy badge.
 */
export function GlobalLabelMarker({ title, className = '', label }) {
  const T = I;
  const hasLabel = !!label;
  return (
    <span
      className={
        `uich-global-marker` +
        `${hasLabel ? ' has-label' : ''}` +
        `${className ? ` ${className}` : ''}`
      }
      title={title || label || 'Global'}
      aria-label={title || label || 'Global'}
    >
      <span className="uich-global-marker-icon" aria-hidden="true">
        <T.globe size={10} />
      </span>
      {hasLabel && (
        <span className="uich-global-marker-text">{label}</span>
      )}
    </span>
  );
}

const SHADOW_LEN_UNITS = ['px', 'em', 'rem'];

// Shared Tailwind recipes for the restyled controls in this file.
const MONO_BOX_CLS =
  'flex h-8 w-full items-center rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring';
const MONO_INPUT_CLS =
  'h-full w-full min-w-0 rounded-md bg-transparent px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground';
// Ghost "+" add-trigger (minimal skin): borderless, reveals a soft bg on hover
// instead of the dashed card, matching the inspector's borderless inputs. [ui-ux]
const ADD_TRIGGER_CLS =
  'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground';
const COUNT_BADGE_CLS =
  'inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground';
const KBD_CLS =
  'inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground';
const MICRO_LABEL_CLS =
  'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const CHIP_CLS =
  'inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground';

/**
 * Opacity input, text field + − / + step buttons (0.1 per click).
 * Stores and emits a 0.0–1.0 decimal string matching CSS `opacity`.
 */
function OpacityInput({ value, onChange, inherited, placeholder }) {
  const [draft, setDraft] = React.useState(value || '');
  const [focused, setFocused] = React.useState(false);

  // Keep draft in sync with prop changes (e.g. undo / scope switch)
  React.useEffect(() => {
    if (!focused) setDraft(value || '');
  }, [value, focused]);

  function clampOpacity(n) {
    return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
  }

  function commitDraft(raw) {
    const trimmed = String(raw || '').trim();
    if (trimmed === '' || trimmed === '-') {
      onChange('');
      setDraft('');
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isFinite(n)) {
      const clamped = clampOpacity(n);
      const str = String(clamped);
      onChange(str);
      setDraft(str);
    } else {
      // Invalid input, revert to last known good
      setDraft(value || '');
    }
  }

  function step(delta) {
    const cur = parseFloat(value || '0') || 0;
    const next = clampOpacity(cur + delta);
    const str = String(next);
    onChange(str);
    setDraft(str);
  }

  return (
    <div className="flex h-8 w-full items-center rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
      <button
        type="button"
        className="flex h-full w-7 shrink-0 items-center justify-center rounded-l-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => step(-0.1)}
        title="Decrease opacity by 0.1"
        tabIndex={-1}
      >
        −
      </button>
      <input
        type="text"
        className={cn(
          'h-full w-full min-w-0 bg-transparent text-center font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground',
          inherited && 'text-muted-foreground focus:text-foreground',
        )}
        value={focused ? draft : (value || '')}
        placeholder={placeholder || '1'}
        onFocus={() => { setFocused(true); setDraft(value || ''); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setFocused(false); commitDraft(draft); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitDraft(draft); e.target.blur(); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); step(+0.1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); step(-0.1); }
        }}
      />
      <button
        type="button"
        className="flex h-full w-7 shrink-0 items-center justify-center rounded-r-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => step(+0.1)}
        title="Increase opacity by 0.1"
        tabIndex={-1}
      >
        +
      </button>
    </div>
  );
}

/** Text shadow, X/Y/blur lengths + ColorInput (with globals), same as text/bg color. */
function TextShadowInput({
  value,
  onChange,
  inherited,
  placeholder,
  globalTokens,
  globals,
  shadowGlobalProps,
}) {
  const parsed = React.useMemo(() => parseTextShadow(value), [value]);
  const linkedId = shadowGlobalProps?.linked || null;

  function commit(parts) {
    onChange(formatTextShadow(parts) || '');
  }

  function dimField(key, label) {
    const p = parseLen(parsed[key], 'px', SHADOW_LEN_UNITS);
    return (
      <label key={key} className="shadow-field-dim">
        <span>{label}</span>
        <LengthInput
          value={parsed[key] || ''}
          unit={p.unit || 'px'}
          units={SHADOW_LEN_UNITS}
          placeholder="0"
          inherited={inherited}
          onChange={(v) => {
            const next = parseLen(v, 'px', SHADOW_LEN_UNITS);
            const token = next.num === '' ? '0' : `${next.num}${next.unit || 'px'}`;
            commit({ ...parsed, [key]: token });
          }}
          onUnit={(u) => {
            const token = p.num === '' ? `0${u}` : `${p.num}${u}`;
            commit({ ...parsed, [key]: token });
          }}
        />
      </label>
    );
  }

  return (
    <div className={`shadow-field${inherited ? ' inherited-input' : ''}`}>
      {dimField('x', 'X')}
      {dimField('y', 'Y')}
      {dimField('blur', 'Blur')}
      <div className="shadow-field-color">
        <span className="shadow-field-color-label">Text Shadow Color</span>
        <ColorInput
          value={parsed.color}
          placeholder={inherited ? placeholder : (parsed.color || linkedId ? undefined : 'rgba(0,0,0,.2)')}
          onChange={(c) => {
            if (linkedId) shadowGlobalProps?.onUnlink?.();
            commit({ ...parsed, color: c });
          }}
          inherited={inherited}
          globalTokens={globalTokens}
          globals={globals}
          linkedGlobalId={linkedId}
          onLinkGlobal={(id) => shadowGlobalProps?.onLink?.(id)}
          onUnlinkGlobal={() => shadowGlobalProps?.onUnlink?.()}
        />
      </div>
    </div>
  );
}

/** Dot + hover tooltip (class + value); click selects scope. */
export function AppliedFromHint({ scope, value, isGlobal, globals, onSelect, breakpointLabel }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const btnRef = React.useRef(null);
  const tipRef = React.useRef(null);
  const label = scope ? scopeLabel(scope, globals) : '';

  const reposition = React.useCallback(() => {
    const anchor = btnRef.current?.getBoundingClientRect();
    const tip = tipRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const tipW = tip?.width || 200;
    const tipH = tip?.height || 32;
    setPos(computeFloatingPosition(anchor, tipW, tipH));
  }, []);

  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition, label, value, isGlobal]);

  if (!scope) return null;

  return (
    <span
      className="prop-applied-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        className="prop-applied-dot"
        onClick={() => onSelect?.(scope)}
        aria-label={
          breakpointLabel
            ? `Inherited from ${breakpointLabel}${value ? `: ${value}` : ''}`
            : `Applied from ${label}${value ? `: ${value}` : ''}. Click to select.`
        }
      />
      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={tipRef}
          className={cn(
            'pointer-events-auto whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md',
            !pos && 'invisible',
          )}
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            zIndex: 2147483645,
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <span className="inline-flex items-center gap-1.5">
            {breakpointLabel ? (
              <span className="text-muted-foreground">Inherited from {breakpointLabel}</span>
            ) : (
              <>
                <span className="font-mono text-[11px] text-foreground">{label}</span>
                {isGlobal && (
                  <GlobalLabelMarker
                    className="prop-applied-tip-global"
                    title="Global"
                  />
                )}
              </>
            )}
            <span className="text-muted-foreground" aria-hidden="true">·</span>
            <span className="font-mono text-[11px] text-muted-foreground">{value || '–'}</span>
          </span>
        </div>,
        ensurePortalRoot(btnRef.current?.ownerDocument || document)
      )}
    </span>
  );
}


// Background tab image set
function openWpMediaFrame(onSelect) {
  const wpMedia =
    (typeof window !== 'undefined' && window.wp && window.wp.media) ||
    (typeof window !== 'undefined' && window.top && window.top.wp && window.top.wp.media);
  if (!wpMedia) return;
  const frame = wpMedia({
    title: 'Select Background Image',
    multiple: false,
    library: { type: 'image' },
    button: { text: 'Use this image' },
  });
  frame.on('select', () => {
    const att = frame.state().get('selection').first();
    if (!att) return;
    const json = att.toJSON();
    if (json && json.url) onSelect(json.url);
  });
  frame.open();
}

// Shared image preview used by both the <img> tag editor and the
// background-image field. Shows the current image with a hover overlay
// that offers "Change Image" and (when onRemove is provided) "Remove".
// When no image is set the entire area is a clickable pick button.
export function MediaPreviewButton({ src, emptyLabel, overlayLabel, onPick, onRemove, disabled, inherited }) {
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [src]);

  const hasSrc = !!String(src || '').trim() && !hasError;
  return (
    <div
      className={`element-editor-media-preview${!hasSrc ? ' is-empty' : ''}`}
      onClick={hasSrc && !disabled ? onPick : undefined}
    >
      {hasSrc && (
        <img
          src={src}
          alt=""
          onError={() => setHasError(true)}
          style={inherited ? { opacity: 0.5 } : undefined}
        />
      )}
      {!hasSrc && (
        <button
          type="button"
          className="element-editor-media-pick-btn"
          onClick={onPick}
          disabled={disabled}
        >
          <span className="element-editor-media-empty">{emptyLabel}</span>
        </button>
      )}
      {hasSrc && (
        <div className="element-editor-media-overlay">
          <button
            type="button"
            className="element-editor-media-overlay-btn"
            onClick={(e) => { e.stopPropagation(); onPick(); }}
            disabled={disabled}
          >
            {overlayLabel}
          </button>
          {onRemove && (
            <button
              type="button"
              className="element-editor-media-overlay-btn is-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              disabled={disabled}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MediaImageField({ value, placeholder, inherited, onChange }) {
  const T = I;

  function extractUrl(v) {
    if (!v) return '';
    const m = (v || '').match(/^url\(["']?(.+?)["']?\)$/i);
    return m ? m[1] : v;
  }

  function handlePick() {
    openWpMediaFrame((rawUrl) => {
      onChange(`url(${rawUrl})`);
    });
  }

  function handleRemove() {
    onChange('');
  }

  // Dynamic binding support, mirrors the TEXT field. When the value carries a
  // {{ … }} token (e.g. url({{ post.thumbnail.url('large') }})), show a readable
  // chip with a ✕ instead of the raw SOURCE input + picker/Media buttons. The
  // dynamic picker (⚡) writes the picked expression back as url({{ … }}).
  const dynMatch = String(value == null ? '' : value).match(/\{\{\s*([\s\S]*?)\s*\}\}/);
  const dynExpr = dynMatch ? dynMatch[1].trim() : null;
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
        onChange('url({{ ' + expr + ' }})');
      },
    });
  }

  const rawUrl = extractUrl(value);
  const displayUrl = dynExpr ? '' : (rawUrl || (inherited ? extractUrl(placeholder) : ''));

  return (
    <div className="element-editor element-editor-media">
      <div className="element-editor-media-left">
        <MediaPreviewButton
          src={displayUrl}
          emptyLabel={dynExpr ? 'Dynamic image' : 'Choose Image'}
          overlayLabel={inherited && !rawUrl ? "Override Image" : "Change Image"}
          onPick={handlePick}
          onRemove={rawUrl && !dynExpr ? handleRemove : undefined}
          inherited={inherited && !rawUrl}
          disabled={!!dynExpr}
        />
        <div className="element-editor-field-stack">
          <div className="element-editor-row">
            <span className={MICRO_LABEL_CLS}>SOURCE</span>
            {dynExpr ? (
              <div
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-sm"
                title={String(value).trim()}
              >
                <T.dynamic size={13} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{dynLabel}</span>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => onChange('')}
                  title="Remove dynamic value"
                  aria-label="Remove dynamic value"
                >
                  <T.x size={12} />
                </button>
              </div>
            ) : (
              // Dynamic-value picker lives INSIDE the input (right edge). The
              // separate "Media" button is removed, the Choose Image preview
              // above still opens the media library. Input grows to fill the row.
              <div className="element-editor-input relative min-w-0 flex-1">
                <input
                  type="text"
                  className={INPUT_CLS + ' w-full pr-9'}
                  value={value}
                  placeholder={placeholder || 'url(https://…)'}
                  onChange={e => onChange(e.target.value)}
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Visual position-inset editor: a box with top/right/bottom/left offsets on
// their edges + a centre input for the selected side. Reads and writes the
// real top/right/bottom/left keys through the shared ctx helpers so it behaves
// exactly like the individual fields it replaces (units, cascade, globals).
const INSET_SIDES = [
  { k: 'top',    pos: 'top' },
  { k: 'right',  pos: 'right' },
  { k: 'bottom', pos: 'bottom' },
  { k: 'left',   pos: 'left' },
];

// Compact box-model design (mirrors SpacingBox): one bordered box with the four
// offsets edited inline on their edges, a shared unit + link toggle in the head,
// and an "auto" centre. Writes the real top/right/bottom/left keys (unitless
// value + a per-side unit) through the shared ctx helpers.
function InsetControl({ ctx, group }) {
  const T = I;
  const { upd, getUnit, setUnit, propCascade, displayValue, placeholderFor } = ctx;
  const units = resolveUnits('length');
  const [link, setLink] = React.useState(false);

  // One shared unit for the whole inset box (Framer-style), seeded from `top`.
  const unit = getUnit ? getUnit(`${group}.top`, units[0]) : units[0];
  function setAllUnit(u) {
    if (!setUnit) return;
    INSET_SIDES.forEach((s) => setUnit(`${group}.${s.k}`, u));
  }

  function read(k) {
    const c = propCascade ? propCascade(group, k) : null;
    const own = c ? (c.own || c.ownRaw || '') : (displayValue ? displayValue(group, k) : '');
    const applied = c ? c.appliedValue : (placeholderFor ? placeholderFor(group, k) : '');
    // Cells are unitless, the unit lives in the head pill. Strip any unit that
    // rode along on the stored value so it never shows "98.5px" inside a cell.
    let num = own || '';
    if (num !== '') {
      const p = parseLen(num, unit);
      if (p && p.num != null && !Number.isNaN(p.num)) num = String(p.num);
    }
    return { num, ph: applied || '0' };
  }
  function write(k, v) {
    if (link) upd(group, { top: v, right: v, bottom: v, left: v });
    else upd(group, { [k]: v });
  }

  const cell = (k) => {
    const d = read(k);
    return (
      <input
        className="sb-cell"
        value={d.num}
        placeholder={d.ph}
        onChange={(e) => write(k, e.target.value)}
        title={k[0].toUpperCase() + k.slice(1)}
      />
    );
  };

  return (
    <div className="sb sb-inset">
      <div className="sb-row">
        <span className="sb-label">Inset</span>
        <div className="sb-tools">
          <button
            type="button"
            className={`sb-link${link ? ' on' : ''}`}
            onClick={() => setLink((l) => !l)}
            title={link ? 'Unlink sides' : 'Link all sides'}
          >
            <T.link size={10} />
          </button>
          <UnitPill unit={unit} units={units} onChange={setAllUnit} />
        </div>
      </div>
      <div className="sb-pad">
        {cell('top')}
        <div className="sb-pad-mid">
          {cell('left')}
          <div className="sb-content">auto</div>
          {cell('right')}
        </div>
        {cell('bottom')}
      </div>
    </div>
  );
}

export function PropField({ group, prop, ctx, onRemove, labelAction }) {
  const T = I;
  const {
    upd, getUnit, setUnit, setColorValue, displayValue, resolvedScopeValue, placeholderFor, propCascade,
    globalProps, activeScope, setActiveScope, globals, importedFontFamilies, mode,
  } = ctx;
  // The Global-reference indicator (icon + "Global" label) is a Developer-mode
  // tool, Design mode hides it so clients only see the field's own value.
  const isDeveloperMode = mode !== 'simple';
  const cascade = propCascade ? propCascade(group, prop.k) : {
    own: displayValue(group, prop.k),
    ownIsGlobal: false,
    appliedValue: placeholderFor(group, prop.k),
    appliedScope: null,
    appliedIsGlobal: false,
    isOverridden: false,
    isInherited: !!placeholderFor(group, prop.k),
  };
  // Always edit this scope's stored value, never the cascaded winner (e.g. Local
  // override). Applied value is shown via AppliedFromHint / placeholder only.
  const inputValue = cascade.hasOwn
    ? (cascade.own || cascade.ownRaw || '')
    : '';
  const inheritedPlaceholder = cascade.appliedValue || placeholderFor(group, prop.k) || '';
  const inputPlaceholder = cascade.isInherited
    ? (inheritedPlaceholder || prop.placeholder || '')
    : (prop.placeholder || placeholderFor(group, prop.k) || '');
  const showAppliedHint = !!(cascade.isInherited || cascade.isOverridden);
  const showAppliedGlobal = showAppliedHint && cascade.appliedIsGlobal;
  const ownGlobalColorId = !isDeveloperMode ? null : ((prop.type === 'color' && globalProps)
    ? (globalProps(group, prop.k)?.linked || null)
    : (prop.type === 'text-shadow' && globalProps)
      ? (globalProps(group, 'textShadow')?.linked || null)
      : null);
  // Show the small "Global" tag beside the label when this field's value
  // resolves to a kit/global token, either the own value links to one or
  // the cascade picked up a global from a class.
  const labelGlobalLabel = !isDeveloperMode ? null : (cascade.ownIsGlobal
    ? (cascade.ownGlobalLabel || 'Global')
    : (cascade.appliedIsGlobal ? (cascade.appliedGlobalLabel || 'Global') : null));
  const showLabelGlobalTag = !!labelGlobalLabel || !!ownGlobalColorId;

  function selOptions(key) {
    const items = OPTS[key] || [];
    return renderOptions(items, inputPlaceholder);
  }



  let body = null;
  switch (prop.type) {

    case 'select': {
      const options = OPTS[prop.optionsKey] || [];
      body = (
        <SelectCustomInput
          value={inputValue}
          options={options}
          placeholder={inputPlaceholder}
          inherited={showAppliedHint}
          onChange={(v) => upd(group, { [prop.k]: v })}
        />
      );
      break;
    }

    case 'length':
    case 'length-presets': {
      const units = resolveUnits(prop.units);
      const node = (
        <LengthInput
          value={inputValue}
          unit={getUnit(`${group}.${prop.k}`, units[0])}
          units={units}
          placeholder={inputPlaceholder}
          onChange={(v) => upd(group, { [prop.k]: v })}
          onUnit={(u) => setUnit(`${group}.${prop.k}`, u)}
          inherited={showAppliedHint}
        />
      );
      body = prop.type === 'length-presets' && prop.presets ? (
        <>
          <PresetChips
            presets={prop.presets}
            current={cascade.hasOwn
              ? `${inputValue}${getUnit(`${group}.${prop.k}`, units[0]) || ''}`
              : ''}
            onPick={(v, u) => { upd(group, { [prop.k]: v }); setUnit(`${group}.${prop.k}`, u); }}
          />
          {node}
        </>
      ) : node;
      break;
    }

    case 'global-length': {
      // Legacy schema type, fall through to plain length input. Typography
      // globals are applied via the `text-{id}` class flow now, so this no
      // longer renders a per-property globe.
      const units = resolveUnits(prop.units);
      body = (
        <LengthInput
          value={inputValue}
          unit={getUnit(`${group}.${prop.k}`, units[0])}
          units={units}
          placeholder={inputPlaceholder}
          onChange={(v) => upd(group, { [prop.k]: v })}
          onUnit={(u) => setUnit(`${group}.${prop.k}`, u)}
          inherited={showAppliedHint}
        />
      );
      break;
    }

    case 'global-select':
    case 'select-options': {
      // Plain select with custom options (no per-property globe, typography
      // globals are now applied via the `text-{id}` class flow instead).
      const options = prop.options || [];
      body = (
        <SelectCustomInput
          value={inputValue}
          options={options}
          placeholder={inputPlaceholder}
          inherited={showAppliedHint}
          onChange={(v) => upd(group, { [prop.k]: v })}
        />
      );
      break;
    }

    case 'select-custom': {
      // Editable combobox, pick from `options` or type any custom value.
      // For the Font Family field specifically, also append any font families
      // the user has imported via the site/page code editors or 3rd-party
      // assets so those become first-class picks rather than free-form typing.
      const isFontFamily = prop.k === 'fontFamily';
      const mergedOptions = isFontFamily
        ? mergeFontFamilyOptions(prop.options || [], importedFontFamilies || [])
        : (prop.options || []);
      body = (
        <SelectCustomInput
          value={inputValue}
          options={mergedOptions}
          placeholder={inputPlaceholder}
          inherited={showAppliedHint}
          previewFontFamily={isFontFamily}
          onChange={(v) => upd(group, { [prop.k]: v })}
        />
      );
      break;
    }

    case 'text-shadow': {
      const gp = prop.global && globalProps ? globalProps(group, 'textShadow') : null;
      body = (
        <TextShadowInput
          value={inputValue}
          onChange={(v) => upd(group, { [prop.k]: v })}
          inherited={showAppliedHint}
          placeholder={inputPlaceholder || '0 2px 4px rgba(0,0,0,.2)'}
          globals={globals}
          shadowGlobalProps={gp}
        />
      );
      break;
    }

    case 'color': {
      const gp = prop.global && globalProps ? globalProps(group, prop.k) : null;
      const onColorChange = setColorValue
        ? (v) => setColorValue(group, prop.k, v)
        : (v) => upd(group, { [prop.k]: v });
      body = (
        <ColorInput
          value={inputValue}
          placeholder={showAppliedHint ? (cascade.appliedValue || inputPlaceholder) : undefined}
          onChange={onColorChange}
          inherited={showAppliedHint}
          globals={globals}
          linkedGlobalId={gp?.linked}
          onLinkGlobal={gp?.onLink}
          onUnlinkGlobal={gp?.onUnlink}
        />
      );
      break;
    }

    case 'number':
      body = (
        <div className={MONO_BOX_CLS}>
          <input
            className={cn(MONO_INPUT_CLS, showAppliedHint && 'text-muted-foreground focus:text-foreground')}
            value={inputValue}
            onChange={e => upd(group, { [prop.k]: e.target.value })}
            placeholder={inputPlaceholder}
          />
        </div>
      );
      break;

    case 'opacity':
      body = (
        <OpacityInput
          value={inputValue}
          onChange={(v) => upd(group, { [prop.k]: v })}
          inherited={showAppliedHint}
          placeholder={inputPlaceholder || prop.placeholder}
        />
      );
      break;

    case 'gradient': {
      const cur = (() => { try { return inputValue && typeof inputValue === 'object' ? inputValue : (inputValue ? JSON.parse(inputValue) : null); } catch { return null; } })();
      body = (
        <GradientBuilder
          value={cur || DEFAULT_GRADIENT}
          onChange={(g) => upd(group, { [prop.k]: JSON.stringify(g) })}
        />
      );
      break;
    }

    case 'text-mono': {
      // Free-text multi-token CSS value (grid templates, box-shadow,
      // transition property, etc.). The cascade's "display" path runs every
      // read through finalizeDisplay() which .trim()s, fine for single-token
      // values like fontSize, but for these multi-token strings it strips
      // the trailing space the user just typed, snapping the input back to
      // "1fr 1fr" while they're trying to type "1fr 1fr 1fr". We feed the
      // RAW stored value here so spaces (and any other whitespace) survive
      // the keystroke → re-render round-trip.
      const monoValue = cascade.hasOwn
        ? (cascade.ownRaw != null && cascade.ownRaw !== '' ? cascade.ownRaw : (cascade.own || ''))
        : '';
      body = (
        <div className={MONO_BOX_CLS}>
          <input
            className={cn(MONO_INPUT_CLS, showAppliedHint && 'text-muted-foreground focus:text-foreground')}
            value={monoValue}
            onChange={e => upd(group, { [prop.k]: e.target.value })}
            placeholder={inputPlaceholder}
          />
        </div>
      );
      break;
    }

    case 'media-image':
      body = (
        <MediaImageField
          value={inputValue}
          placeholder={inputPlaceholder}
          inherited={showAppliedHint}
          onChange={(v) => upd(group, { [prop.k]: v })}
        />
      );
      break;

    case 'seg-align': {
      // Own value only, never promote an inherited/cascaded value to "active".
      // Inherited value is shown as a dim hint (inh-on) so the user can see
      // what will render without thinking it is set at this breakpoint.
      const cur = inputValue;
      const inhVal = !cascade.hasOwn && cascade.appliedValue ? cascade.appliedValue : null;
      body = (
        <SegAlign
          cur={cur}
          inhVal={inhVal}
          onPick={(v) => upd(group, { [prop.k]: v })}
        />
      );
      break;
    }

    case 'inset': {
      body = <InsetControl ctx={ctx} group={group} />;
      break;
    }

    default:
      body = <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>This property is not editable here ({prop.type}).</span>;
  }

  return (
    <div className={`field pf pf-${group}-${prop.k}${showAppliedHint ? ' inherited' : ''}${cascade.isOverridden ? ' overridden' : ''}${showAppliedGlobal ? ' applied-global' : ''}`}>
      <div className="pf-label">
        <span className="pf-name">
          <span className="pf-name-text">{prop.label}</span>
          {/* Global color dot sits IMMEDIATELY after the label text now –
              was previously aligned to the far right in `.pf-meta`,
              which made the link to the label visually ambiguous. */}
          {ownGlobalColorId && (
            <GlobalColorHint linkedId={ownGlobalColorId} globals={globals} />
          )}
          {showLabelGlobalTag && (
            <GlobalLabelMarker
              title={
                labelGlobalLabel
                  ? `Global: ${labelGlobalLabel}`
                  : 'Value resolves to a global token'
              }
            />
          )}
          {showAppliedHint && (
            <AppliedFromHint
              scope={cascade.appliedScope}
              value={cascade.appliedValue}
              isGlobal={isDeveloperMode && cascade.appliedIsGlobal}
              globals={globals}
              onSelect={setActiveScope}
              breakpointLabel={cascade.inheritedFromBreakpoint}
            />
          )}
          {labelAction}
        </span>
        <span className="pf-meta">
          {onRemove && (
            <button
              type="button"
              className="inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              title="Remove"
              onClick={(e) => { e.preventDefault(); onRemove(); }}
            >
              <I.trash size={10} />
              <span>Remove</span>
            </button>
          )}
        </span>
      </div>
      <div className="prop-input-stack">
        {GLOBALS_PICKER_SKIP.has(prop.type) ? body : (
          <div className="pf-input-row">
            <div className="pf-input-main">{body}</div>
            <GlobalsValuePicker
              colorOnly={prop.type === 'color'}
              // Keyed on the property, not its control type: a colour field can
              // only take a colour and the font-family field can only take a
              // family, so offering the other kinds is offering broken values.
              fontOnly={prop.k === 'fontFamily'}
              onPick={(val) => {
                if (prop.type === 'color' && setColorValue) setColorValue(group, prop.k, val);
                else upd(group, { [prop.k]: val });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function AddProperty({ section, hidden, onAdd, inheritedMap }) {
  const T = I;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const ref = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    function onDoc(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') { setOpen(false); setQ(''); } }
    if (open) {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function activate() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const filtered = q
    ? hidden.filter(h => h.label.toLowerCase().includes(q.toLowerCase()) || h.k.toLowerCase().includes(q.toLowerCase()))
    : hidden;

  const inheritedItems = filtered.filter(h => inheritedMap?.[h.k]);
  const grouped = {};
  for (const h of filtered) {
    if (inheritedMap?.[h.k]) continue;
    const g = h.group || 'All';
    (grouped[g] ||= []).push(h);
  }

  const inheritedCount = Object.keys(inheritedMap || {}).length;

  if (!open) {
    return (
      <div className="mt-3 w-full border-t border-border pt-3" ref={ref}>
        <button className={ADD_TRIGGER_CLS} onClick={activate}>
          <T.plus size={11} />
          <span>Add property</span>
          <span className={cn(COUNT_BADGE_CLS, 'ml-auto')}>{hidden.length} available</span>
          {inheritedCount > 0 && (
            <span className={cn(COUNT_BADGE_CLS, 'bg-accent text-accent-foreground')}>{inheritedCount} inherited</span>
          )}
          <span className={KBD_CLS}>/</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 w-full border-t border-border pt-3" ref={ref}>
      <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-muted-foreground shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
        <T.search size={12} />
        <input
          ref={inputRef}
          className="h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Type to search · Enter to add first match"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) {
              onAdd(filtered[0].k);
              setQ('');
            }
          }}
        />
        <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'match' : 'matches'}
        </span>
        <button
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => { setOpen(false); setQ(''); }}
          title="Close (Esc)"
        >
          <T.x size={11} />
        </button>
      </div>

      <div className="mt-2 flex max-h-[260px] flex-col gap-2.5 overflow-y-auto pb-1">
        {inheritedItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className={cn(MICRO_LABEL_CLS, 'w-full')}>Inherited</span>
            {inheritedItems.map(h => (
              <button
                key={h.k}
                className={cn(CHIP_CLS, 'ring-1 ring-border')}
                title={
                  inheritedMap[h.k].fromBreakpoint
                    ? `Inherited from ${inheritedMap[h.k].fromBreakpoint}: ${inheritedMap[h.k].value}`
                    : `Inherited from .${inheritedMap[h.k].from}: ${inheritedMap[h.k].value}`
                }
                onClick={() => onAdd(h.k)}
              >
                {h.label}
                <span className="font-mono text-[10px] text-muted-foreground">.{inheritedMap[h.k].from}</span>
              </button>
            ))}
          </div>
        )}
        {Object.entries(grouped).map(([gname, items]) => (
          <div className="flex flex-wrap items-center gap-1" key={gname}>
            <span className={cn(MICRO_LABEL_CLS, 'w-full')}>{gname}</span>
            {items.map(h => (
              <button key={h.k} className={CHIP_CLS} onClick={() => onAdd(h.k)}>
                {h.label}
              </button>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-1 py-3 text-center text-xs text-muted-foreground">No properties match "{q}"</div>
        )}
      </div>
    </div>
  );
}

// ── Custom CSS Tab ────────────────────────────────────────────────────────────
export function CustomCssSection({ items, inheritedItems = [], relevantProps = [], cascadeMap = {}, onAdd, onUpdate, onRemove, globals, setActiveScope }) {
  const T = I;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const ref = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    function onDoc(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') { setOpen(false); setQ(''); } }
    if (open) {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function activate() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleAdd() {
    const raw = q.trim();
    if (!raw) return;
    let prop, value;
    const ci = raw.indexOf(':');
    if (ci > 0) {
      prop  = raw.slice(0, ci).trim();
      value = raw.slice(ci + 1).trim();
    } else {
      prop  = raw;
      value = '';
    }
    // Reject if prop is empty or contains invalid chars (; { })
    if (!prop || /[;{}]/.test(prop)) return;
    onAdd(prop, value);
    setQ('');
  }

  const mergedMap = new Map();
  const ensureItem = (propName) => {
    if (!propName) return null;
    if (!mergedMap.has(propName)) {
      mergedMap.set(propName, {
        prop: propName,
        ownValue: '',
        ownIdx: -1,
        inheritedValue: null,
        fromClass: null,
        hasOwn: false,
      });
    }
    return mergedMap.get(propName);
  };

  // Ordered props are prepared by the inspector; filling values must not move rows.
  relevantProps.forEach((propName) => {
    ensureItem(propName);
  });

  inheritedItems.forEach((inh) => {
    if (inh.prop) {
      const existing = ensureItem(inh.prop);
      mergedMap.set(inh.prop, {
        ...existing,
        inheritedValue: inh.value,
        fromClass: inh.fromClass,
      });
    }
  });

  items.forEach((item, idx) => {
    if (!item.prop) return;
    const existing = ensureItem(item.prop);
    mergedMap.set(item.prop, {
      ...existing,
      prop: item.prop,
      ownValue: item.value,
      ownIdx: idx,
      hasOwn: true,
    });
  });

  const mergedList = Array.from(mergedMap.values());

  return (
    <div className="section custom-css-section">
      {mergedList.length > 0 && (
        <div className="prop-rows">
          <div className="prop-row">
            {mergedList.map((item) => {
              const cascade = cascadeMap[item.prop] || {};
              const appliedValue = cascade.appliedValue || item.inheritedValue || '';
              const appliedScope = cascade.appliedScope || item.fromClass || null;
              const showAppliedHint = !!(cascade.isInherited || cascade.isOverridden || (!item.hasOwn && item.inheritedValue));
              const isOverridden = !!(cascade.isOverridden || (item.hasOwn && item.inheritedValue));
              const inputValue = item.hasOwn ? item.ownValue : '';
              const inputPlaceholder = appliedValue || 'value';
              const showsInheritedPlaceholder = !!appliedValue && (!item.hasOwn || !item.ownValue || cascade.isOverridden);
              const ownDisplay = isOverridden && item.ownValue ? item.ownValue : '';

              return (
                <div className="prop-cell" key={item.prop} style={{ gridColumn: 'span 6' }}>
                  <div className={`field pf custom-css-field${showAppliedHint ? ' inherited' : ''}${isOverridden ? ' overridden' : ''}`}>
                    <div className="pf-label">
                      <span className="pf-name">
                        <span className="pf-name-text">{item.prop}</span>
                        {item.hasOwn && (
                          <button className="gp-gradient-remove-btn" onClick={() => onRemove(item.prop)} title="Remove">
                            <T.x size={12} />
                          </button>
                        )}
                        {(showAppliedHint || isOverridden) && (
                          <>
                            <AppliedFromHint
                              scope={appliedScope}
                              value={appliedValue}
                              globals={globals}
                              onSelect={setActiveScope}
                              breakpointLabel={cascade.inheritedFromBreakpoint}
                            />
                          </>
                        )}
                      </span>
                      <span className="pf-meta">
                        {ownDisplay && (
                          <span className="prop-scope-own" title={`Defined here: ${ownDisplay}`}>
                            {ownDisplay}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="prop-input-stack">
                      <div className={MONO_BOX_CLS}>
                        <input
                          className={cn(MONO_INPUT_CLS, showsInheritedPlaceholder && 'text-muted-foreground focus:text-foreground')}
                          value={inputValue}
                          placeholder={inputPlaceholder}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (item.hasOwn) {
                              onUpdate(item.prop, val);
                            } else {
                              onAdd(item.prop, val);
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mergedList.length > 0 && <div className="my-3 h-px bg-border" />}

      <div className="w-full" ref={ref}>
        {!open ? (
          <button className={ADD_TRIGGER_CLS} onClick={activate}>
            <T.plus size={11} />
            <span>Add property</span>
            {items.length > 0 && <span className={cn(COUNT_BADGE_CLS, 'ml-auto')}>{items.length} added</span>}
            <span className={cn(KBD_CLS, items.length > 0 ? '' : 'ml-auto')}>/</span>
          </button>
        ) : (
          <>
            <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-muted-foreground shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
              <input
                ref={inputRef}
                className="h-full w-full min-w-0 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="property: value · Enter to add"
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd();
                }}
              />
              <button
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => { setOpen(false); setQ(''); }}
                title="Close (Esc)"
              >
                <T.x size={15} />
              </button>
            </div>
            {q.trim() && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="truncate rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">{q.trim()}</div>
                <span className="shrink-0 text-[10px] text-muted-foreground">Press Enter to add</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
