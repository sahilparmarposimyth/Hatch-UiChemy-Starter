// Gradient builder, premium Figma-style editor.
import React from 'react';
import { cn } from '@/lib/utils';
import { ColorInput } from './composer-color-picker';
import { parseColorToRgba, rgbaToHex } from './composer-color-utils';
import { I } from './composer-icons';
import { useSlidingSeg } from './composer-inputs';

// Shared shadcn segmented-control classes, kept identical to the inspector's
// SEG_* constants so the gradient type strip matches every other tab strip
// (Color/Image, Solid/Gradient, tag switch, …).
const SEG_WRAP_CLS = 'inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5';
const SEG_ITEM_CLS = 'flex h-6 min-w-7 items-center justify-center rounded-sm px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground';
const SEG_ITEM_ON_CLS = 'bg-background text-foreground shadow-sm';
/* On a `seg-slide` track the wrapper draws the chip and it travels, so the
   active item keeps only its ink — `bg-background` + `shadow-sm` here would
   paint a second, stationary chip on top of the moving one. */
const SEG_ITEM_ON_SLIDE_CLS = 'text-foreground';

// ─── helpers ────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Read an "X% Y%" (or keyword `center`) position into [x, y] percentages.
function parsePos(rp) {
  if (!rp || rp === 'center') return [50, 50];
  const m = String(rp).match(/(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
}

function hexToRgba(hex, opacity) {
  const h = (hex || '#000000').replace('#', '');
  const r = parseInt(h.substr(0, 2), 16) || 0;
  const g = parseInt(h.substr(2, 2), 16) || 0;
  const b = parseInt(h.substr(4, 2), 16) || 0;
  const a = clamp((opacity ?? 100), 0, 100) / 100;
  if (a >= 1) return hex;
  return `rgba(${r},${g},${b},${parseFloat(a.toFixed(3))})`;
}

// ─── public API ─────────────────────────────────────────────────────────────

export const DEFAULT_GRADIENT = {
  type: 'linear',
  angle: 90,
  radialShape: 'circle',
  radialPos: 'center',
  stops: [
    { color: '#FFFFFF', pos: 0,   opacity: 100 },
    { color: '#FFFFFF', pos: 100, opacity: 0   },
  ],
};

export function gradientCSS(g) {
  if (!g || !g.stops || !g.stops.length) return 'none';
  const stops = g.stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map(s => `${hexToRgba(s.color, s.opacity ?? 100)} ${s.pos}%`)
    .join(', ');

  if (g.type === 'linear')
    return `linear-gradient(${g.angle ?? 90}deg, ${stops})`;
  if (g.type === 'radial')
    return `radial-gradient(${g.radialShape || 'circle'} at ${g.radialPos || 'center'}, ${stops})`;
  if (g.type === 'angular' || g.type === 'conic')
    return `conic-gradient(from ${g.angle ?? 0}deg at ${g.radialPos || 'center'}, ${stops})`;
  return `linear-gradient(${g.angle ?? 90}deg, ${stops})`;
}

// ─── SVG icons ──────────────────────────────────────────────────────────────

const FlipSVG = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5v11M3.5 4.5 6.5 1.5M3.5 4.5H6.5M10.5 9.5 7.5 12.5M10.5 9.5H7.5"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const RotateSVG = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M12 7A5 5 0 1 1 7 2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M7 2l3-2v4L7 2z" fill="currentColor"/>
  </svg>
);

// ─── GradientBuilder ────────────────────────────────────────────────────────

const TYPES = [
  { value: 'linear',  label: 'Linear'  },
  { value: 'angular', label: 'Angular' },
  { value: 'radial',  label: 'Radial'  },
];

export function GradientBuilder({ value, onChange, globals, globalTokens }) {
  // One ref per segmented track — each measures its own active item.
  const typeSegRef = useSlidingSeg();
  const shapeSegRef = useSlidingSeg();
  const g = value || DEFAULT_GRADIENT;

  // Normalise stops, add opacity if missing (legacy data)
  const stops = (g.stops || []).map(s => ({ opacity: 100, ...s }));
  const norm = { ...g, stops };

  const [activeIdx, setActiveIdx] = React.useState(0);
  const [tip, setTip]             = React.useState(null);
  const barRef      = React.useRef(null);
  const dragging    = React.useRef(null); // { idx, startX, startPos }
  // Refs to each stop-row DOM node so we can scroll the active one into view.
  const rowRefs     = React.useRef([]);
  const scrollPendingRef = React.useRef(false);

  const safeActive = clamp(activeIdx, 0, stops.length - 1);

  function push(patch) { onChange({ ...norm, ...patch }); }
  function pushStop(i, patch) {
    push({ stops: stops.map((s, j) => j === i ? { ...s, ...patch } : s) });
  }
  function moveStop(i, rawPos) {
    const pos = clamp(Number(rawPos) || 0, 0, 100);
    push({ stops: stops.map((s, j) => j === i ? { ...s, pos } : s) });
  }

  // ── type-specific settings (angle / shape / position) ──────────────────────
  const [posX, posY] = parsePos(norm.radialPos);
  function setAngle(v) { push({ angle: clamp(Number(v) || 0, 0, 360) }); }
  function writePos(x, y) { push({ radialPos: `${clamp(Number(x) || 0, 0, 100)}% ${clamp(Number(y) || 0, 0, 100)}%` }); }
  const hasAngle = norm.type === 'linear' || norm.type === 'angular';
  const hasPos = norm.type === 'radial' || norm.type === 'angular';

  // ── add / remove ─────────────────────────────────────────────────────────
  function addStop() {
    const sorted = stops.slice().sort((a, b) => a.pos - b.pos);
    let newPos = 50;
    if (sorted.length >= 2) {
      let maxGap = 0, gapIdx = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].pos - sorted[i].pos;
        if (gap > maxGap) { maxGap = gap; gapIdx = i; }
      }
      newPos = Math.round((sorted[gapIdx].pos + sorted[gapIdx + 1].pos) / 2);
    }
    const newStop = { color: sorted[0]?.color || '#FFFFFF', pos: newPos, opacity: 100 };
    const next = [...stops, newStop].sort((a, b) => a.pos - b.pos);
    const newActive = next.findIndex(
      (s) => s.pos === newPos && s.color === newStop.color && s.opacity === newStop.opacity,
    );
    push({ stops: next });
    setActiveIdx(newActive < 0 ? 0 : newActive);
    // Schedule a scroll into view once the row DOM nodes have been updated.
    scrollPendingRef.current = newActive < 0 ? 0 : newActive;
  }

  function removeStop(i) {
    if (stops.length <= 2) return;
    const next = stops.filter((_, j) => j !== i);
    push({ stops: next });
    setActiveIdx(clamp(i, 0, next.length - 1));
  }

  // ── header actions ────────────────────────────────────────────────────────
  function flipGradient() {
    push({ stops: stops.map(s => ({ ...s, pos: 100 - s.pos })) });
  }
  function rotateGradient() {
    push({ angle: ((norm.angle ?? 90) + 90) % 360 });
  }

  // ── bar drag (horizontal) ────────────────────────────────────────────────
  function onHandleMouseDown(e, i) {
    e.preventDefault();
    setActiveIdx(i);
    const barEl = barRef.current;
    if (!barEl) return;
    const rect = barEl.getBoundingClientRect();
    dragging.current = { idx: i, rect };

    function onMove(ev) {
      if (!dragging.current) return;
      const { idx: di, rect: r } = dragging.current;
      const raw = ((ev.clientX - r.left) / r.width) * 100;
      moveStop(di, clamp(Math.round(raw), 0, 100));
    }
    function onUp() {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const css = gradientCSS(norm);

  // Scroll the active row into view after addStop inserts a new stop.
  React.useEffect(() => {
    if (scrollPendingRef.current === false) return;
    const idx = scrollPendingRef.current;
    scrollPendingRef.current = false;
    const el = rowRefs.current[idx];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [stops.length]); // fires when a stop is added/removed

  return (
    <div className="gp">

      {/* ── Type selector (full-width segmented), same shadcn tab strip as
          the Color/Image and Solid/Gradient toggles above it. ── */}
      <div className="gp-header">
        <div ref={typeSegRef} className={cn(SEG_WRAP_CLS, 'seg-slide', 'flex w-full')} role="tablist">
          {TYPES.map(t => {
            const active = (TYPES.find(x => x.value === norm.type) ? norm.type : 'linear') === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-state={active ? 'active' : 'inactive'}
                className={cn(SEG_ITEM_CLS, 'flex-1 px-2', active && SEG_ITEM_ON_SLIDE_CLS)}
                onClick={() => push({ type: t.value })}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Type-specific settings ──
          Only the controls that the active gradient type actually uses are
          shown, so switching type reveals the right options (no dead UI). */}
      <div className="gp-settings">
        {hasAngle && (
          <div className="gp-set-row">
            <span className="gp-set-label">Angle</span>
            <div className="gp-set-right">
              <span className="gp-set-field">
                <input type="number" className="gp-set-num" min="0" max="360"
                  value={norm.angle ?? 90} onChange={(e) => setAngle(e.target.value)} />
                <span className="gp-set-unit">°</span>
              </span>
              <button className="gp-hbtn" type="button" onClick={rotateGradient} title="Rotate 90°" aria-label="Rotate 90°"><RotateSVG /></button>
              <button className="gp-hbtn" type="button" onClick={flipGradient} title="Reverse stops" aria-label="Reverse stops"><FlipSVG /></button>
            </div>
          </div>
        )}

        {norm.type === 'radial' && (
          <div className="gp-set-row">
            <span className="gp-set-label">Shape</span>
            <div ref={shapeSegRef} className={cn(SEG_WRAP_CLS, 'seg-slide')}>
              {['circle', 'ellipse'].map((sh) => {
                const on = (norm.radialShape || 'circle') === sh;
                return (
                  <button
                    key={sh}
                    type="button"
                    data-state={on ? 'active' : 'inactive'}
                    className={cn(SEG_ITEM_CLS, 'px-2.5', on && SEG_ITEM_ON_SLIDE_CLS)}
                    onClick={() => push({ radialShape: sh })}
                  >{sh.charAt(0).toUpperCase() + sh.slice(1)}</button>
                );
              })}
            </div>
          </div>
        )}

        {hasPos && (
          <div className="gp-set-row">
            <span className="gp-set-label">Position</span>
            <div className="gp-set-right">
              <span className="gp-set-field">
                <span className="gp-set-axis">X</span>
                <input type="number" className="gp-set-num" min="0" max="100"
                  value={posX} onChange={(e) => writePos(e.target.value, posY)} />
                <span className="gp-set-unit">%</span>
              </span>
              <span className="gp-set-field">
                <span className="gp-set-axis">Y</span>
                <input type="number" className="gp-set-num" min="0" max="100"
                  value={posY} onChange={(e) => writePos(posX, e.target.value)} />
                <span className="gp-set-unit">%</span>
              </span>
            </div>
          </div>
        )}

        {!hasAngle && (
          <div className="gp-set-row">
            <span className="gp-set-label">Reverse</span>
            <button className="gp-hbtn" type="button" onClick={flipGradient} title="Reverse stops" aria-label="Reverse stops"><FlipSVG /></button>
          </div>
        )}
      </div>

      {/* ── Preview bar (horizontal) ── */}
      <div className="gp-bar-wrap">
        <div className="gp-bar-checker" />
        <div
          className="gp-bar-fill"
          ref={barRef}
          style={{ background: `linear-gradient(90deg, ${stops
            .slice()
            .sort((a, b) => a.pos - b.pos)
            .map(s => `${hexToRgba(s.color, s.opacity ?? 100)} ${s.pos}%`)
            .join(', ')})` }}
        >
          {stops.map((s, i) => (
            <button
              key={i}
              className={`gp-handle${safeActive === i ? ' active' : ''}`}
              style={{
                left: `${s.pos}%`,
                '--hc': hexToRgba(s.color, s.opacity ?? 100),
              }}
              onMouseDown={e => onHandleMouseDown(e, i)}
              onClick={() => setActiveIdx(i)}
              aria-label={`Stop ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* ── Stops list ── */}
      <div className="gp-stops-block">
        <div className="gp-stops-head">
          <span className="gp-dim-label">Stops</span>
          <button className="gp-add-btn" onClick={addStop} title="Add stop"><I.plus size={14} /></button>
        </div>

        {/* Column labels, help users identify each field at a glance.
            Opacity isn't a separate column: it's the alpha of the colour and is
            edited through the colour field / picker (keeps the narrow right-dock
            row from overflowing). */}
        <div className="gp-stops-cols-header">
          <span className="gp-col-label gp-col-label-pos">POSITION</span>
          <span className="gp-col-label gp-col-label-color">COLOR</span>
        </div>

        <div className="gp-stops-list">
          {stops.map((s, i) => {
            // Stable key: pos + color + opacity so React does NOT reuse the
            // wrong ColorInput state when stops are re-sorted after insertion.
            // Using the array index as key caused the newly-inserted stop's row
            // to inherit stale open/draft state from the previous occupant of
            // that index position.
            const stableKey = `${s.pos}-${String(s.color).replace('#','')}-${s.opacity ?? 100}`;
            const stopRgbaValue = hexToRgba(s.color, s.opacity ?? 100);

            function onStopColorChange(v) {
              const rgba = parseColorToRgba(v);
              if (rgba) {
                const hex = rgbaToHex(rgba, false);
                const opacity = Math.round(rgba.a * 100);
                pushStop(i, { color: hex, opacity });
              } else if (v) {
                pushStop(i, { color: v });
              }
            }

            return (
              <div
                key={stableKey}
                ref={(el) => { rowRefs.current[i] = el; }}
                className={`gp-row${safeActive === i ? ' active' : ''}`}
                onClick={() => setActiveIdx(i)}
              >
                {/* position */}
                <div className="gp-pos-cell">
                  <input
                    className="gp-num"
                    type="number" min="0" max="100"
                    value={s.pos}
                    onChange={e => moveStop(i, e.target.value)}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="gp-unit">%</span>
                </div>

                {/* color swatch + hex (uses the main ColorInput). Alpha of this
                    colour IS the stop's opacity, no separate opacity column. */}
                <div className="gp-color-cell" onClick={e => e.stopPropagation()}>
                  <ColorInput
                    value={stopRgbaValue}
                    onChange={onStopColorChange}
                    globals={globals}
                    globalTokens={globalTokens}
                    compact
                  />
                </div>

                {/* remove */}
                <button
                  className="gp-rm-btn"
                  disabled={stops.length <= 2}
                  onClick={e => { e.stopPropagation(); removeStop(i); }}
                  title="Remove stop"
                >−</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Generated CSS preview ── */}
      <div className="gp-css-row">
        <span className="gp-dim-label">CSS</span>
        <input
          className="gp-css-inp"
          type="text"
          value={css}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.target.select()}
          title="Generated background-image value"
        />
      </div>

    </div>
  );
}
