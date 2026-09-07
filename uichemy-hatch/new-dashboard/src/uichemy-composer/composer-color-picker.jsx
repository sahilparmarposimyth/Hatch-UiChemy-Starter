// Simple shadcn color picker.
//
// The inspector color field is a swatch + text input. Clicking the swatch
// opens a lightweight shadcn `Popover` containing the color surface
// (SV plane + hue + alpha, powered by `react-colorful`), a HEX field, an
// alpha % field and an optional eyedropper. That's it — no gradient types,
// no HEX/RGB/HSL format tabs, no global-styles list. Linking a color to a
// Global is handled by the separate globe picker on the property row, so
// the picker itself can stay small and focused.
import React from 'react';
import { RgbaColorPicker } from 'react-colorful';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { I } from './composer-icons';
import {
  colorToHex,
  formatRgba,
  getLinkedColorMeta,
  isKeywordColor,
  normalizeColorInput,
  parseColorToRgba,
  parseGlobalColorVar,
  rgbaToCssPreview,
} from './composer-color-utils';
import { useUiChemyGlobals, resolveUiChemyColorMeta } from './composer-variables';

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

/**
 * SV plane + hue + alpha, powered by react-colorful's RgbaColorPicker.
 *
 * react-colorful emits continuous `onChange` calls during pointer drag; we
 * pipe each into `onLiveChange` for live preview. Because the library has no
 * separate "drag end" event, we synthesise one by listening to pointerup /
 * pointercancel so we can call `onCommit` (which writes the final value into
 * the inspector + breakpoint scope) once, instead of on every mouse move.
 */
function PickerSurface({ rgba, onLiveChange, onCommit, onInteractStart, onInteractEnd }) {
  // Keep the latest rgba in a ref so the synthesised commit handler always
  // sees the most recent live value, even if React hasn't flushed the
  // parent's re-render yet.
  const scratchRef = React.useRef(rgba);
  scratchRef.current = rgba;

  const interactingRef = React.useRef(false);

  const handleColorChange = React.useCallback((next) => {
    // Snap r/g/b to integers so downstream consumers don't accumulate float
    // noise; pass alpha through untouched (it stays 0..1).
    const normalized = {
      r: Math.round(next.r),
      g: Math.round(next.g),
      b: Math.round(next.b),
      a: next.a == null ? scratchRef.current.a : next.a,
    };
    scratchRef.current = normalized;
    onLiveChange?.(normalized);
  }, [onLiveChange]);

  const handlePointerDown = React.useCallback(() => {
    interactingRef.current = true;
    onInteractStart?.();
  }, [onInteractStart]);

  const handlePointerEnd = React.useCallback(() => {
    if (!interactingRef.current) return;
    interactingRef.current = false;
    onCommit?.(scratchRef.current);
    onInteractEnd?.();
  }, [onCommit, onInteractEnd]);

  // pointerup can fire OUTSIDE the picker (drag past the edge), so attach at
  // window level. pointerdown stays on the picker so unrelated clicks
  // elsewhere don't kick off a commit cycle.
  React.useEffect(() => {
    function up() { handlePointerEnd(); }
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [handlePointerEnd]);

  return (
    <div className="cpicker-sv-wrap" onPointerDown={handlePointerDown}>
      <RgbaColorPicker color={rgba} onChange={handleColorChange} />
    </div>
  );
}

/**
 * The picker body — surface + HEX/alpha/eyedropper. Rendered inside a
 * shadcn PopoverContent by ColorInput.
 */
function ColorPickerPanel({ value, linkedGlobalId, onChange, globals, compact = false }) {
  const [rgba, setRgba] = React.useState({ r: 0, g: 0, b: 0, a: 1 });
  const [textDraft, setTextDraft] = React.useState('');
  const [eyedropperBusy, setEyedropperBusy] = React.useState(false);
  const interactingRef = React.useRef(false);
  const linkedMeta = getLinkedColorMeta(globals, linkedGlobalId);

  React.useEffect(() => {
    if (interactingRef.current) return;
    const seed = linkedGlobalId ? (linkedMeta?.value || '') : (value || '');
    const parsed = parseColorToRgba(seed);
    if (parsed) {
      setRgba(parsed);
      setTextDraft(formatRgba(parsed, 'hex'));
    } else {
      setTextDraft(seed || '');
    }
  }, [value, linkedGlobalId, linkedMeta?.value]);

  function setRgbaLocal(next) {
    setRgba(next);
    setTextDraft(formatRgba(next, 'hex'));
  }

  function commitRgba(next) {
    setRgbaLocal(next);
    onChange?.(formatRgba(next, 'hex'));
  }

  function applyTextDraft() {
    const t = textDraft.trim();
    if (linkedMeta && t.toLowerCase() === (linkedMeta.value || '').trim().toLowerCase()) return;
    if (!t) { onChange?.(''); return; }
    if (isKeywordColor(t) || /^var\s*\(/i.test(t)) { onChange?.(t); return; }
    const parsed = parseColorToRgba(t);
    if (parsed) commitRgba(parsed);
    else onChange?.(normalizeColorInput(t, 'hex'));
  }

  async function pickFromScreen() {
    if (typeof window === 'undefined' || !window.EyeDropper) return;
    try {
      setEyedropperBusy(true);
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      if (result && result.sRGBHex) {
        const parsed = parseColorToRgba(result.sRGBHex);
        if (parsed) commitRgba(parsed);
      }
    } catch (_) { /* cancelled */ }
    finally { setEyedropperBusy(false); }
  }

  const hasEyedropper = typeof window !== 'undefined' && !!window.EyeDropper;

  return (
    <div className={cn('cpicker cpicker-simple', compact && 'cpicker-compact')}>
      <PickerSurface
        rgba={rgba}
        onLiveChange={(next) => setRgbaLocal(next)}
        onCommit={(next) => commitRgba(next)}
        onInteractStart={() => { interactingRef.current = true; }}
        onInteractEnd={() => { interactingRef.current = false; }}
      />

      <div className="mt-3 flex items-center gap-2">
        <div className={cn(
          'flex h-8 flex-1 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring',
          linkedMeta && 'is-global-linked'
        )}>
          {linkedMeta && (
            <span className="text-muted-foreground" title={`Global: ${linkedMeta.name}`} aria-hidden="true">
              <I.globe size={11} />
            </span>
          )}
          <input
            className="w-full bg-transparent font-mono text-xs uppercase text-foreground outline-none placeholder:text-muted-foreground"
            type="text"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={applyTextDraft}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyTextDraft(); } }}
            placeholder="RRGGBB"
            spellCheck={false}
          />
        </div>
        <div className="flex h-8 w-16 items-center gap-0.5 rounded-md border border-input bg-transparent px-2 shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
          <input
            className="w-full bg-transparent text-right font-mono text-xs tabular-nums text-foreground outline-none"
            type="number"
            min={0}
            max={100}
            value={Math.round(rgba.a * 100)}
            onChange={(e) => commitRgba({ ...rgba, a: clamp01(Number(e.target.value) / 100) })}
          />
          <span className="text-[11px] text-muted-foreground">%</span>
        </div>
        {hasEyedropper && (
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={eyedropperBusy}
            onClick={pickFromScreen}
            title="Pick color from screen"
            aria-label="Eyedropper"
          >
            <I.pipette size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Hover label for a property linked to a Global Color.
 *
 * Pure CSS-only tooltip — no React state, no portal, no effects. The tooltip
 * is a sibling of the dot inside the same wrap and shows on hover via
 * `:hover .prop-global-color-tip { opacity: 1 }`. A native `title` is also set
 * on the dot so the label still surfaces when an ancestor `overflow: hidden`
 * clips the styled chip.
 */
export function GlobalColorHint({ linkedId, globals }) {
  const meta = getLinkedColorMeta(globals, linkedId);
  if (!meta) return null;
  const dotColor = meta.value || '#7dd3fc';
  const tipText = meta.sourceBadge ? `${meta.name} · ${meta.sourceBadge}` : meta.name;
  return (
    <span className="prop-global-color-wrap">
      <button
        type="button"
        className="prop-global-color-dot"
        style={{ background: dotColor }}
        aria-label={`Global color: ${meta.name}`}
        title={tipText}
      />
      <span className="prop-global-color-tip" role="tooltip" aria-hidden="true">
        <span className="prop-global-color-tip-name">{meta.name}</span>
        {meta.sourceBadge && (
          <span className="prop-global-color-tip-badge">{meta.sourceBadge}</span>
        )}
      </span>
    </span>
  );
}

/**
 * Inspector color field — swatch + text; the swatch opens a shadcn Popover
 * with the simple color picker.
 */
export function ColorInput({
  value,
  onChange,
  inherited,
  placeholder,
  disabled,
  // globalTokens / onLinkGlobal / onUnlinkGlobal are kept in the signature for
  // API compatibility with existing callers, but the simple picker no longer
  // renders the global-styles list — global linking lives on the row's globe.
  globalTokens,
  globals,
  linkedGlobalId,
  onLinkGlobal,
  onUnlinkGlobal,
  compact = false,
  // Popover placement. Default drops the picker directly under the swatch so it
  // stays inside the narrow right-docked inspector instead of flinging out over
  // the canvas. Radix collision handling flips it above when near the viewport
  // bottom. Callers can still override (e.g. side="left"/"right") when needed.
  side = 'bottom',
  align = 'start',
}) {
  const [open, setOpen] = React.useState(false);

  // Close on click inside the canvas. Radix's own dismiss layer only sees clicks
  // in the editor document; the canvas is a separate preview iframe, so a click
  // there never reaches Radix and the picker used to stay open. Listen for a
  // pointerdown inside every reachable iframe (capture phase, so the canvas's own
  // handlers can't swallow it) and close. Only while open; cleaned up on close.
  React.useEffect(() => {
    if (!open) return undefined;
    const cleanups = [];
    const close = () => setOpen(false);
    try {
      const frames = Array.from(document.querySelectorAll('iframe'));
      for (const f of frames) {
        let d = null;
        try { d = f.contentDocument; } catch (_) { d = null; } // cross-origin
        if (!d) continue;
        d.addEventListener('pointerdown', close, true);
        cleanups.push(() => { try { d.removeEventListener('pointerdown', close, true); } catch (_) { /* frame gone */ } });
      }
    } catch (_) { /* best-effort */ }
    return () => { for (const fn of cleanups) { try { fn(); } catch (_) { /* noop */ } } };
  }, [open]);

  // UiChemy globals: a `var(--id)` that resolves to one of them is shown as a
  // linked global (name + swatch) and renders in the preview via the enqueued
  // :root vars. getLinkedColorMeta/parseGlobalColorVar are inert now (Elementor
  // Globals removed) but kept so the call sites stay stable.
  const uichemyGlobals = useUiChemyGlobals();
  const uichemyMeta = resolveUiChemyColorMeta(value, uichemyGlobals);
  const linkedMeta = uichemyMeta ? null : getLinkedColorMeta(globals, linkedGlobalId);
  const varFromValue = uichemyMeta ? null : parseGlobalColorVar(value);
  const effectiveLinkedId = uichemyMeta ? null : (linkedGlobalId || varFromValue);
  const anyLinked = !!uichemyMeta || !!effectiveLinkedId;

  const displayForSwatch = (() => {
    if (uichemyMeta) return uichemyMeta.value || '#000000';
    if (linkedMeta) return linkedMeta.value || colorToHex(value, '#000000');
    const d = value || placeholder || '';
    const parsed = parseColorToRgba(d);
    return parsed ? rgbaToCssPreview(parsed) : d;
  })();

  // When a Global Color is linked, show its NAME inside the input (e.g.
  // "Primary") instead of the resolved hex.
  const fieldValue = (() => {
    if (uichemyMeta) return uichemyMeta.name || '';
    if (linkedMeta) return linkedMeta.name || linkedMeta.id || '';
    return value || '';
  })();

  return (
    <Popover open={open} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
      <div
        className={`swatch-input color-input${inherited ? ' inherited-input' : ''}${disabled ? ' disabled' : ''}${anyLinked ? ' is-global-linked' : ''}`}
        style={{ '--c': displayForSwatch || '#00000000' }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="sw swatch-trigger"
            disabled={disabled}
            title="Open color picker"
            aria-label="Open color picker"
          />
        </PopoverTrigger>
        <input
          type="text"
          className={(uichemyMeta || linkedMeta) ? 'color-field-linked-input' : ''}
          value={fieldValue}
          disabled={disabled}
          title={
            uichemyMeta
              ? `${uichemyMeta.name} (global) edit to use a custom color`
              : (linkedMeta ? `${linkedMeta.name} edit to use a custom color` : undefined)
          }
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (uichemyMeta && t === (uichemyMeta.name || '').trim()) return;
            if (linkedMeta && t === (linkedMeta.name || '').trim()) return;
            if (!t) { onChange?.(''); return; }
            if (isKeywordColor(t) || /^var\s*\(/i.test(t)) { onChange?.(t); return; }
            onChange?.(normalizeColorInput(t));
          }}
          placeholder={placeholder || '#000000'}
          spellCheck={false}
        />
      </div>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={10}
        collisionPadding={8}
        className="cpicker-popover z-[2147483647] w-60 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ColorPickerPanel
          value={uichemyMeta ? uichemyMeta.value : value}
          linkedGlobalId={effectiveLinkedId}
          onChange={onChange}
          globals={globals}
          compact={compact}
        />
      </PopoverContent>
    </Popover>
  );
}
