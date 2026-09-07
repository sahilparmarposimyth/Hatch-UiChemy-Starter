// Inputs with unit pickers + helpers for CSS option lists.
import React from 'react';
import ReactDOM from 'react-dom';
import { cn } from '@/lib/utils';
import { ensurePortalRoot } from '@/components/ui/portal-context';
import { computeFloatingPosition } from './composer-floating';

// shadcn text-input recipe (compact h-8 rows) shared across the composer.
export const INPUT_CLS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

// shadcn menu-item recipe, mirrors MENU_ITEM_CLS in composer-layers.jsx.
export const MENU_ITEM_CLS =
  'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent disabled:pointer-events-none disabled:opacity-50';

const LENGTH_KEYWORDS = [
  'auto', 'fit-content', 'max-content', 'min-content',
  'none', 'inherit', 'initial', 'unset', 'unitless',
];

const DEFAULT_UNITS = [
  'px', '%', 'em', 'rem', 'vw', 'vh', 'vmin', 'vmax', 'ch', 'ex', 'pt', 'pc', 'cm', 'mm', 'in',
];

/**
 * Match a complete trailing CSS unit from an allowed list (longest wins).
 * Avoids treating partial input like "20p" as unit "p" when "px" is intended.
 */
export function matchTrailingUnit(text, units) {
  const v = String(text || '').trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (LENGTH_KEYWORDS.includes(lower)) return { num: '', unit: lower };

  const sorted = [...units].sort((a, b) => b.length - a.length);
  for (const unit of sorted) {
    if (!unit || unit === 'unitless') continue;
    const uLower = unit.toLowerCase();
    if (!lower.endsWith(uLower)) continue;
    const numPart = v.slice(0, v.length - unit.length).trim();
    if (numPart === '' && LENGTH_KEYWORDS.includes(unit)) continue;
    if (/^-?[\d.]+$/.test(numPart)) return { num: numPart, unit };
  }
  return null;
}

export function parseLen(s, defaultUnit = 'px', units = DEFAULT_UNITS) {
  if (s == null || s === '') return { num: '', unit: defaultUnit };
  const v = String(s).trim();
  if (LENGTH_KEYWORDS.includes(v.toLowerCase())) return { num: '', unit: v };

  const matched = matchTrailingUnit(v, units);
  if (matched) {
    return {
      num: matched.num,
      unit: matched.unit || defaultUnit,
    };
  }

  const numOnly = /^-?[\d.]+$/.exec(v);
  if (numOnly) return { num: numOnly[0], unit: defaultUnit };
  return { num: v, unit: defaultUnit };
}

function formatLengthText(num, unit) {
  if (num === '' || num == null) return '';
  if (!unit || unit === 'unitless') return String(num);
  return `${num}${unit}`;
}

/**
 * Whether `raw` is text that could still become a valid CSS length, so it is
 * safe to let it appear in the field while typing. Accepts an in-progress
 * number, a number with a (partial) unit suffix like "10p"/"10px"/"100%", and
 * a case-insensitive prefix of a length keyword like "au" → "auto". Rejects
 * arbitrary alphabetic input (e.g. "afsdsvsdv"): the old onChange echoed any
 * text into the field even though it was dropped on blur, so a numeric field
 * looked like it accepted letters. Used to gate keystrokes/paste in LengthInput.
 */
function isTypableLength(raw) {
  const t = String(raw).trim();
  if (t === '' || t === '-' || t === '.') return true;
  const lower = t.toLowerCase();
  if (LENGTH_KEYWORDS.some((k) => k.startsWith(lower))) return true;
  return /^-?(?:\d+\.?\d*|\.\d+)[a-z%]*$/i.test(t);
}

export function UnitPill({ unit, units, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const btnRef = React.useRef(null);
  const listRef = React.useRef(null);

  // Both dimensions are MEASURED from the unit list, not assumed.
  //
  // The old constants were 80px wide and 28px per row, and neither matched what
  // the menu actually renders. A row is `px-2 py-1 text-xs`: 16px line box +
  // 4px padding top and bottom = 24px, inside a `p-1` box = 8px more. Asking
  // the positioner for 28px a row over-reported the height by up to 44px, which
  // is enough to make it flip a menu above its trigger that fitted below.
  //
  // Width mattered more. 80px fits "px" and "rem", and nothing else this
  // control is handed: `lineHeight` ends in "unitless" and `size` in
  // "fit-content"/"max-content"/"min-content", all of which are wider than the
  // box — so the longest unit in the list was clipped, and the positioner was
  // placing a box narrower than the one the user saw. Sized to the longest
  // label instead (mono 12px is ~7.4px a character), floored at the old 80 so
  // short lists are unchanged and capped so a stray long keyword cannot grow a
  // 300px menu.
  const longestUnit = units.reduce((n, u) => Math.max(n, String(u).length), 0);
  const menuW = Math.max(80, Math.min(168, Math.ceil(longestUnit * 7.4) + 26));
  const menuH = Math.min(220, units.length * 24 + 10);

  const doc =
    (btnRef.current && btnRef.current.ownerDocument) ||
    (typeof document !== 'undefined' ? document : null);
  const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);

  const reposition = React.useCallback(() => {
    const btn = btnRef.current;
    const r = btn?.getBoundingClientRect();
    if (!r) return;
    // The anchor's OWN window, resolved at call time rather than from the render
    // closure. This control is also rendered into the on-canvas toolbar, which
    // lives in the Elementor PREVIEW iframe while the bundle itself runs in the
    // editor's top document — so the ambient `window` is the wrong viewport to
    // clamp iframe coordinates against, and the menu landed off its trigger.
    const w = btn.ownerDocument?.defaultView || win;
    if (!w) return;
    setPos(computeFloatingPosition(r, menuW, menuH, w));
  }, [win, menuW, menuH]);

  function openMenu() {
    reposition();
    setOpen(true);
  }

  React.useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    if (!win) return undefined;
    win.addEventListener('scroll', reposition, true);
    win.addEventListener('resize', reposition);
    return () => {
      win.removeEventListener('scroll', reposition, true);
      win.removeEventListener('resize', reposition);
    };
  }, [open, reposition, win]);

  React.useEffect(() => {
    if (!open || !doc) return undefined;
    function onDoc(e) {
      if (btnRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    const t = setTimeout(() => {
      doc.addEventListener('mousedown', onDoc, true);
      doc.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      clearTimeout(t);
      doc.removeEventListener('mousedown', onDoc, true);
      doc.removeEventListener('keydown', onKey, true);
    };
  }, [open, doc]);

  const label = unit || 'px';

  const menu = open && pos && doc ? (
    <div
      ref={listRef}
      className="flex flex-col overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: menuW,
        maxHeight: menuH,
        zIndex: 2147483646,
      }}
    >
      {units.map((u) => (
        <button
          key={u}
          type="button"
          className={cn(
            'flex w-full cursor-default select-none items-center rounded-sm px-2 py-1 font-mono text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
            u === unit && 'bg-accent text-accent-foreground',
          )}
          onClick={() => { onChange(u); setOpen(false); }}
        >
          <span>{u}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <span className="relative inline-flex shrink-0 items-center self-center">
      <button
        ref={btnRef}
        type="button"
        className={cn(
          'inline-flex h-5 items-center justify-center rounded-sm px-1 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          open && 'bg-accent text-foreground',
        )}
        onClick={() => (open ? setOpen(false) : openMenu())}
        title="Unit"
        aria-expanded={open}
      >
        <span>{label}</span>
      </button>
      {menu && doc?.body && ReactDOM.createPortal(menu, ensurePortalRoot(doc))}
    </span>
  );
}

/**
 * `glyph` opts a field into the InputGroup layout: a small square handle sits
 * INSIDE the field's left edge carrying a letter ("W") or an icon node, and the
 * −/+ stepper box beside the field goes away. Dragging that handle sideways
 * scrubs the value, which is how Figma, Framer and the shadcn print editor all
 * behave. Fields without `glyph` render exactly as before — this is additive,
 * so the ~40 length fields that don't opt in are untouched.
 *
 * `hideUnit` drops the trailing unit picker. The field's own text already spells
 * the unit out ("188px"), so on a narrow paired field (X|Y, W|H) the pill is
 * pure duplication that costs ~24px of the value's room. Units stay changeable
 * by typing them — matchTrailingUnit picks "50%" straight out of the text.
 */
export function LengthInput({
  value, unit, units = ['px', '%', 'em', 'rem', 'vw', 'vh'],
  onChange, onUnit, placeholder, inherited, disabled, scrub, glyph, hideUnit,
}) {
  const defaultUnit = unit || 'px';
  const parsed = parseLen(value, defaultUnit, units);
  const storedUnit = unit || parsed.unit || defaultUnit;
  const isKeyword = LENGTH_KEYWORDS.includes(storedUnit)
    && ['auto', 'fit-content', 'max-content', 'min-content', 'none', 'inherit', 'unitless'].includes(storedUnit);

  const [localText, setLocalText] = React.useState(formatLengthText(parsed.num, storedUnit));
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef(null);

  const matchedWhileTyping = focused ? matchTrailingUnit(localText, units) : null;
  const pillUnit = matchedWhileTyping?.unit ?? storedUnit;

  React.useEffect(() => {
    if (!focused) setLocalText(formatLengthText(parsed.num, storedUnit));
  }, [value, unit, storedUnit, focused]); // eslint-disable-line react-hooks/exhaustive-deps

  function syncFromRaw(raw) {
    const trimmed = raw.trim();
    const matched = matchTrailingUnit(trimmed, units);
    if (matched) {
      onChange?.(matched.num);
      onUnit?.(matched.unit);
      return;
    }
    if (LENGTH_KEYWORDS.includes(trimmed.toLowerCase())) {
      onChange?.('');
      onUnit?.(trimmed.toLowerCase());
      return;
    }
    if (trimmed === '' || trimmed === '-') {
      onChange?.('');
      return;
    }
    if (/^-?[\d.]*$/.test(trimmed)) {
      onChange?.(trimmed);
      return;
    }
    const prefix = trimmed.match(/^(-?[\d.]+)/);
    if (prefix) onChange?.(prefix[1]);
  }

  function commitText(raw) {
    const trimmed = raw.trim();
    const matched = matchTrailingUnit(trimmed, units);
    if (matched) {
      onChange?.(matched.num);
      onUnit?.(matched.unit);
      setLocalText(formatLengthText(matched.num, matched.unit));
      return;
    }
    const numPart = trimmed.match(/^(-?[\d.]+)/)?.[1] ?? '';
    onChange?.(numPart);
    setLocalText(formatLengthText(numPart, storedUnit));
  }

  // One step path shared by the ArrowUp/Down keys and the −/+ buttons, so the
  // two can never drift apart.
  function stepBy(delta) {
    const cur = parseFloat(parsed.num || '0') || 0;
    const nextStr = String(Math.round((cur + delta) * 100) / 100);
    onChange?.(nextStr);
    if (focused) setLocalText(formatLengthText(nextStr, pillUnit));
  }

  // Scroll-to-scrub: with the pointer over the field, turning the wheel steps the
  // value (Figma / Framer behaviour). A native NON-passive listener is required
  // so preventDefault can stop the panel from scrolling under the pointer. The
  // ref keeps the listener bound once while always calling the latest stepper.
  // Shift = ×10, ⌘/Ctrl = ×0.1, matching the arrow-key + drag steps.
  const stepByRef = React.useRef(stepBy);
  stepByRef.current = stepBy;
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (disabled) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : (e.metaKey || e.ctrlKey) ? 0.1 : 1;
      stepByRef.current(e.deltaY < 0 ? step : -step);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [disabled]);

  // A glyph field is scrubbable by definition — the handle exists to be dragged.
  // Legacy fields still need the explicit `scrub` prop, so nothing changes for
  // them.
  const scrubOn = scrub || !!glyph;

  const onPointerDown = (e) => {
    if (!scrubOn) return;
    // On a glyph field the handler is bound to the handle, never the input, so
    // click-to-type keeps working without a modifier. Legacy scrub fields keep
    // requiring Alt when the press lands on the input itself.
    if (!glyph && !e.altKey && e.target.tagName === 'INPUT') return;
    e.preventDefault();
    const startX = e.clientX;
    const startV = parseFloat(parsed.num || '0') || 0;
    function move(ev) {
      const dx = ev.clientX - startX;
      const step = ev.shiftKey ? 10 : ev.metaKey ? 0.1 : 1;
      const next = Math.round((startV + dx * step) * 100) / 100;
      const nextStr = String(next);
      onChange?.(nextStr);
      if (focused) setLocalText(formatLengthText(nextStr, pillUnit));
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // The keyword span and the text input are identical in both layouts, so they
  // are built once here and placed by whichever branch renders below. Keeping a
  // single copy stops the two paths drifting apart as the input gains handlers.
  const keywordEl = (
    <span className="flex-1 truncate font-mono text-xs italic text-muted-foreground">{storedUnit}</span>
  );

  const inputEl = (
        <input
          ref={inputRef}
          type="text"
          className={cn(
            'h-full w-full min-w-0 flex-1 rounded-md bg-transparent px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed',
            inherited && 'text-muted-foreground focus:text-foreground',
          )}
          // Horizontal resize cursor while hovering (not typing) to signal the
          // field is scrubbable — drag sideways or scroll to change the number.
          style={{ cursor: disabled ? 'not-allowed' : (focused ? 'text' : 'ew-resize') }}
          value={localText}
          placeholder={placeholder ?? '0'}
          disabled={disabled}
          onMouseDown={onPointerDown}
          onFocus={() => {
            setFocused(true);
            // Show only the numeric part on focus, the unit pill already
            // shows the unit. Showing "0px" caused a regression: typing "1"
            // at the end produced "0px1", which syncFromRaw's prefix regex
            // collapsed back to "0", resetting the field on every keystroke.
            setLocalText(parsed.num || '');
          }}
          onChange={(e) => {
            const raw = e.target.value;
            // Ignore keystrokes/paste that can't become a valid length so the
            // field never shows stray alphabetic input (it was dropped on blur
            // anyway); units ("px") and keywords ("auto") still type fine.
            if (!isTypableLength(raw)) return;
            setLocalText(raw);
            syncFromRaw(raw);
          }}
          onBlur={() => {
            setFocused(false);
            commitText(localText);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText(localText);
              e.target.blur();
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const step = e.shiftKey ? 10 : e.metaKey ? 0.1 : 1;
              stepBy(e.key === 'ArrowUp' ? step : -step);
            }
          }}
        />
  );

  // ── InputGroup layout (opt-in via `glyph`) ────────────────────────────────
  // Handle inside the field, no stepper box beside it. Arrow keys still step
  // the value, so the stepper's job is covered without spending the width.
  if (glyph) {
    return (
      <div
        className={cn(
          'lin-ig flex h-8 w-full items-center rounded-md border border-input bg-transparent pr-1 shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring',
          disabled && 'cursor-not-allowed opacity-50',
          isKeyword && 'pl-2.5',
        )}
      >
        {!isKeyword && (
          <span
            className="lin-glyph"
            onMouseDown={onPointerDown}
            title="Drag to change · Shift ×10 · ⌘ ×0.1"
            aria-hidden="true"
          >
            {glyph}
          </span>
        )}
        {isKeyword ? keywordEl : inputEl}
        {!hideUnit && <UnitPill unit={pillUnit} units={units} onChange={onUnit} />}
      </div>
    );
  }

  return (
    // Row wrapper so the −/+ stepper can sit in its OWN box beside the field,
    // as the reference design shows, instead of crowding the field's interior.
    <div className="lin-row">
    <div
      className={cn(
        'flex h-8 w-full items-center rounded-md border border-input bg-transparent pr-1 shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring',
        disabled && 'cursor-not-allowed opacity-50',
        isKeyword && 'pl-2.5',
      )}
    >
      {isKeyword ? keywordEl : inputEl}
      <UnitPill unit={pillUnit} units={units} onChange={onUnit} />
    </div>
      {/* −/+ nudge buttons in their own box beside the field (reference design).
          Keyboard arrows and alt-drag already stepped the value; these make it
          discoverable without typing. Shift steps by 10, ⌘/Ctrl by 0.1 — same
          increments as the arrow keys. tabIndex -1 keeps them out of the tab
          order (the input is the control); onMouseDown-prevented so clicking
          doesn't blur the field mid-edit. */}
      {!isKeyword && (
        <span className="lin-step">
          <button
            type="button"
            tabIndex={-1}
            className="lin-step-btn"
            disabled={disabled}
            title="Decrease"
            aria-label="Decrease"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => stepBy(e.shiftKey ? -10 : (e.metaKey || e.ctrlKey) ? -0.1 : -1)}
          >−</button>
          <button
            type="button"
            tabIndex={-1}
            className="lin-step-btn"
            disabled={disabled}
            title="Increase"
            aria-label="Increase"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => stepBy(e.shiftKey ? 10 : (e.metaKey || e.ctrlKey) ? 0.1 : 1)}
          >+</button>
        </span>
      )}
    </div>
  );
}

export function renderOptions(items, placeholderLabel) {
  return (
    <>
      <option value="">{placeholderLabel || '– inherit –'}</option>
      {items.map((item) => {
        if (Array.isArray(item)) return <option key={item[0]} value={item[0]}>{item[1]}</option>;
        return <option key={item} value={item}>{item}</option>;
      })}
    </>
  );
}

export function PresetChips({ presets, current, onPick }) {
  return (
    <div className="flex flex-wrap items-center gap-1 pb-1.5">
      {presets.map((p) => {
        const presetKey = `${p.value || ''}${p.unit || ''}`;
        const active = current && presetKey && current === presetKey;
        return (
          <button
            key={p.label}
            type="button"
            className={cn(
              'inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
              active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            )}
            onClick={() => onPick(p.value, p.unit)}
            title={p.title || p.label}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Editable combobox, typed value or pick from a list. Used for properties
 * like font-family where the option list is a curated convenience but any
 * custom value should still be allowed.
 */
export function SelectCustomInput({
  value, options = [], placeholder, inherited, onChange, previewFontFamily,
}) {
  const [open, setOpen] = React.useState(false);
  const [isTyping, setIsTyping] = React.useState(false);

  const getLabelForValue = React.useCallback((val) => {
    const found = options.find(o => (Array.isArray(o) ? o[0] : o) === val);
    return found ? (Array.isArray(found) ? found[1] : found) : val;
  }, [options]);

  const [draft, setDraft] = React.useState(getLabelForValue(value || ''));
  const wrapRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const lastValueRef = React.useRef(value || '');

  React.useEffect(() => {
    const incoming = value || '';
    if (incoming !== lastValueRef.current) {
      lastValueRef.current = incoming;
      setDraft(getLabelForValue(incoming));
    }
  }, [value, getLabelForValue]);

  React.useEffect(() => {
    if (!open) {
      setIsTyping(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!wrapRef.current || wrapRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function commitDraft(next) {
    const v = String(next ?? draft).trim();
    const found = options.find(o => (Array.isArray(o) ? o[1] : o) === v || (Array.isArray(o) ? o[0] : o) === v);
    const resolvedVal = found ? (Array.isArray(found) ? found[0] : found) : v;
    lastValueRef.current = resolvedVal;
    setDraft(found ? (Array.isArray(found) ? found[1] : found) : resolvedVal);
    onChange?.(resolvedVal);
  }

  function pick(v) {
    setOpen(false);
    commitDraft(v);
  }

  // When the user is typing, FILTER the dropdown to only matching options
  // (and rank them by how strong the match is). Non-matches are dropped –
  // so typing "rob" leaves just "Roboto", "Roboto Slab", "Roboto Mono", etc.
  // Empty input falls back to the full list in its original order.
  // Ranking:
  //   1. Exact case-insensitive match
  //   2. Prefix match              ("rob"  → "Roboto", "Roboto Slab", "Roboto Mono")
  //   3. Word-boundary match       ("slab" → "Roboto Slab", "PT Slab")
  //   4. Substring match anywhere  ("man"  → "Manrope", "Cormorant Garamond")
  const orderedOptions = React.useMemo(() => {
    const q = isTyping ? String(draft || '').trim().toLowerCase() : '';
    if (!q || !options.length) return options;
    const exact   = [];
    const prefix  = [];
    const word    = [];
    const sub     = [];
    for (const o of options) {
      const oVal = Array.isArray(o) ? String(o[0]) : String(o);
      const oLabel = Array.isArray(o) ? String(o[1]) : String(o);
      const lVal = oVal.toLowerCase();
      const lLabel = oLabel.toLowerCase();
      if (lVal === q || lLabel === q) {
        exact.push(o);
      } else if (lVal.startsWith(q) || lLabel.startsWith(q)) {
        prefix.push(o);
      } else if ((' ' + lVal).includes(' ' + q) || (' ' + lLabel).includes(' ' + q)) {
        word.push(o);
      } else if (lVal.includes(q) || lLabel.includes(q)) {
        sub.push(o);
      }
    }
    return [...exact, ...prefix, ...word, ...sub];
  }, [options, draft, isTyping]);

  return (
    // The box (border/rounded/shadow) lives on this WRAPPER, not on the
    // <input>, so it matches LengthInput and, crucially, survives Elementor's
    // editor stylesheet, which resets borders on bare <input> elements. Putting
    // the border on the input made Font Family / Font Weight lose their box in
    // the real editor while length fields (whose box is on a div) kept theirs.
    <div
      ref={wrapRef}
      className={cn(
        'relative flex h-8 w-full items-center rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring',
      )}
    >
      <input
        ref={inputRef}
        type="text"
        className={cn(
          'h-full w-full min-w-0 flex-1 rounded-md bg-transparent px-2.5 pr-7 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          inherited && 'text-muted-foreground focus:text-foreground',
        )}
        value={draft}
        placeholder={placeholder}
        style={previewFontFamily && draft ? { fontFamily: draft } : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setIsTyping(true);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a mousedown on a dropdown row fires `pick` before commit.
          window.setTimeout(() => {
            if (!wrapRef.current?.contains(document.activeElement)) {
              setOpen(false);
              commitDraft();
            }
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const q = isTyping ? String(draft || '').trim().toLowerCase() : '';
            const top = orderedOptions[0];
            if (q && top) {
              const topVal = Array.isArray(top) ? top[0] : top;
              const topLabel = Array.isArray(top) ? top[1] : top;
              if (topVal.toLowerCase().includes(q) || topLabel.toLowerCase().includes(q)) {
                commitDraft(topVal);
              } else {
                commitDraft();
              }
            } else {
              commitDraft();
            }
            setOpen(false);
            e.target.blur();
          } else if (e.key === 'Escape') {
            setDraft(getLabelForValue(value || ''));
            setOpen(false);
            e.target.blur();
          }
        }}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-7 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
        tabIndex={-1}
        onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        title="Show options"
        aria-label="Toggle options"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M5 7L1 3h8z" fill="currentColor" />
        </svg>
      </button>
      {/* Auto-width menu: it grows to fit the widest option (up to a cap)
          instead of being locked to the field width, so long values — long font
          names, long keyword lists — show in full rather than truncating.
          Anchored to the field's RIGHT edge (`right-0`, no `left-0`) so it
          expands leftward INTO the panel and never runs off the panel's right
          side in the right dock. `min-w-full` keeps it at least the field width;
          `max-w-[280px]` caps it, and the per-option `truncate` + `title`
          tooltip below handle anything still wider. [ui-ux] */}
      {open && orderedOptions.length > 0 && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[220px] w-max min-w-full max-w-[280px] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {orderedOptions.map((o) => {
            const oVal = Array.isArray(o) ? o[0] : o;
            const oLabel = Array.isArray(o) ? o[1] : o;
            return (
              <button
                key={oVal}
                type="button"
                className={cn(MENU_ITEM_CLS, 'min-w-0', oVal === value && 'bg-accent text-accent-foreground')}
                style={previewFontFamily ? { fontFamily: oVal } : undefined}
                title={typeof oLabel === 'string' ? oLabel : undefined}
                onMouseDown={(e) => { e.preventDefault(); pick(oVal); }}
              >
                {/* One line per option. The label previews in its own font, so a
                    wide face (Times New Roman, Libre Baskerville) used to wrap to
                    two lines in the narrow popover. `truncate` keeps every option
                    a single row, with an ellipsis only if a name genuinely can't
                    fit. `min-w-0` on the button lets the truncation take effect
                    inside the flex row. */}
                <span className="truncate">{oLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Sliding segmented control — moved to components/ui/use-sliding-seg.js so the
 * design system can use it without importing an app module (components/ui is a
 * vendored copy synced between repos). Re-exported here because every existing
 * call site imports it from composer-inputs.
 */
export { useSlidingSeg } from '@/components/ui/use-sliding-seg';
