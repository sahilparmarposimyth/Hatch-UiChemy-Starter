// Canvas inline rich-text toolbar — a floating light pill that appears above a
// text/heading element while it's being edited on the canvas (Framer / Squarespace
// style). Anchors top-left of the selection; a grip lets the user reposition it.
//
// VISUAL COMPONENT (phase 1): the full UI, menus, states and positioning are real;
// the formatting/AI actions are surfaced through callback props and are stubbed by
// the caller until we wire them into the canvas text-editing layer. Every visual is
// driven by props so wiring later is a drop-in.
import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { I } from './composer-icons';
import { subscribeHandleSlot, getHandleSlot, refreshHandles } from './composer-box-handles';

const BLOCK_TYPES = [
  { id: 'h1', label: 'Heading 1', ico: 'type' },
  { id: 'h2', label: 'Heading 2', ico: 'type' },
  { id: 'h3', label: 'Heading 3', ico: 'type' },
  { id: 'p',  label: 'Paragraph', ico: 'paragraph' },
];

const ALIGNS = [
  { id: 'left',    label: 'Align left',    ico: 'alignL' },
  { id: 'center',  label: 'Align center',  ico: 'alignC' },
  { id: 'right',   label: 'Align right',   ico: 'alignR' },
  { id: 'justify', label: 'Justify',       ico: 'alignJ' },
];

const AI_ACTIONS = [
  { id: 'improve', label: 'Improve writing',        ico: 'effect' },
  { id: 'shorter', label: 'Make shorter',           ico: 'minus'  },
  { id: 'longer',  label: 'Make longer',            ico: 'plus'   },
  { id: 'tone',    label: 'Change tone',            ico: 'chat', sub: true },
  { id: 'grammar', label: 'Fix spelling & grammar', ico: 'check'  },
];

function Menu({ children, align = 'left', minWidth = 214 }) {
  return (
    <div
      className="ctb-menu"
      style={{ minWidth, [align === 'right' ? 'right' : 'left']: 0 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function CanvasTextToolbar({
  blockType = 'h1',
  active = {},           // { bold, italic, link }
  align = 'left',
  color = '#111111',
  style,                 // position ({ top, left }) from the caller
  embedded = false,      // true when injected into the editor's own selection
                         // toolbar, which already provides the grip + Ask AI and
                         // its own pill — so we drop those and the pill chrome.
  onCommand = () => {},  // (id) => void   e.g. 'bold','italic','link','ul','indent','clear'…
  onBlockChange = () => {},
  onAlign = () => {},
  onAI = () => {},
  onColor = () => {},
}) {
  const T = I;
  const [open, setOpen] = React.useState(null); // 'ai' | 'block' | 'align' | 'more' | null
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (k) => setOpen((o) => (o === k ? null : k));
  const run = (fn) => { fn(); setOpen(null); };

  const blockLabel = (BLOCK_TYPES.find((b) => b.id === blockType) || BLOCK_TYPES[0]).label;
  const AlignIco = T[(ALIGNS.find((a) => a.id === align) || ALIGNS[0]).ico];

  return (
    <div className="ctb-root" ref={rootRef} style={style}>
      <div className={cn('ctb', embedded && 'ctb-embedded')}>
        {!embedded && (
          <span className="ctb-grip" title="Drag to move" aria-label="Drag to move">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
              <circle cx="2.5" cy="3" r="1.2" /><circle cx="7.5" cy="3" r="1.2" />
              <circle cx="2.5" cy="8" r="1.2" /><circle cx="7.5" cy="8" r="1.2" />
              <circle cx="2.5" cy="13" r="1.2" /><circle cx="7.5" cy="13" r="1.2" />
            </svg>
          </span>
        )}

        {/* Ask AI — hidden when embedded (the editor's selection toolbar already
            carries an Ask AI action). */}
        {!embedded && (
        <div className="ctb-slot">
          <button
            type="button"
            className={cn('ctb-btn ctb-ai', open === 'ai' && 'is-open')}
            title="Ask AI"
            onClick={() => toggle('ai')}
          >
            <T.sparkles size={18} />
          </button>
          {open === 'ai' && (
            <Menu>
              <div className="ctb-mlabel">Ask AI</div>
              {AI_ACTIONS.map((a) => (
                <button key={a.id} type="button" className="ctb-item" onClick={() => run(() => onAI(a.id))}>
                  <span className="ctb-item-ico ctb-item-ai">{T[a.ico]({ size: 17 })}</span>
                  <span>{a.label}</span>
                  {a.sub && <T.caretRight className="ctb-item-chev" size={14} />}
                </button>
              ))}
            </Menu>
          )}
        </div>
        )}

        {!embedded && <span className="ctb-div" />}

        {/* Block type */}
        <div className="ctb-slot">
          <button
            type="button"
            className={cn('ctb-btn ctb-block', open === 'block' && 'is-open')}
            onClick={() => toggle('block')}
          >
            {blockLabel} <T.caretDown size={14} />
          </button>
          {open === 'block' && (
            <Menu minWidth={180}>
              {BLOCK_TYPES.map((b) => (
                <button key={b.id} type="button" className={cn('ctb-item', b.id === blockType && 'on')} onClick={() => run(() => onBlockChange(b.id))}>
                  <span className="ctb-item-ico">{T[b.ico]({ size: 16 })}</span>
                  <span>{b.label}</span>
                  {b.id === blockType && <T.check className="ctb-item-chev" size={14} />}
                </button>
              ))}
            </Menu>
          )}
        </div>

        <span className="ctb-div" />

        {/* Character formatting — full flat set, reference order */}
        <button type="button" className={cn('ctb-btn', active.bold && 'on')} title="Bold" onClick={() => onCommand('bold')}><T.bold size={18} /></button>
        <button type="button" className={cn('ctb-btn', active.italic && 'on')} title="Italic" onClick={() => onCommand('italic')}><T.italic size={18} /></button>
        <button type="button" className="ctb-btn" title="Text color" onClick={() => onColor()}>
          <span className="ctb-swatch" style={{ background: color }} />
        </button>
        <button type="button" className="ctb-btn" title="Font size" onClick={() => onCommand('fontSize')}><T.type size={18} /></button>
        <button type="button" className="ctb-btn ctb-btn-text" title="Letter case" onClick={() => onCommand('case')}>Aa</button>
        <button type="button" className={cn('ctb-btn', active.link && 'on')} title="Link" onClick={() => onCommand('link')}><T.link size={18} /></button>

        <span className="ctb-div" />

        {/* Paragraph formatting */}
        <div className="ctb-slot">
          <button type="button" className={cn('ctb-btn', open === 'align' && 'is-open')} title="Align" onClick={() => toggle('align')}>
            <AlignIco size={18} />
          </button>
          {open === 'align' && (
            <Menu minWidth={170}>
              {ALIGNS.map((a) => (
                <button key={a.id} type="button" className={cn('ctb-item', a.id === align && 'on')} onClick={() => run(() => onAlign(a.id))}>
                  <span className="ctb-item-ico">{T[a.ico]({ size: 17 })}</span>
                  <span>{a.label}</span>
                  {a.id === align && <T.check className="ctb-item-chev" size={14} />}
                </button>
              ))}
            </Menu>
          )}
        </div>
        <button type="button" className="ctb-btn" title="Quote" onClick={() => onCommand('quote')}><T.quote size={18} /></button>
        <button type="button" className="ctb-btn" title="Bulleted list" onClick={() => onCommand('ul')}><T.listBullet size={18} /></button>
        <button type="button" className="ctb-btn" title="Numbered list" onClick={() => onCommand('ol')}><T.listNumber size={18} /></button>
        <button type="button" className="ctb-btn" title="Strikethrough" onClick={() => onCommand('strike')}><T.strike size={18} /></button>
        <button type="button" className="ctb-btn" title="Outdent" onClick={() => onCommand('outdent')}><T.indentLess size={18} /></button>
        <button type="button" className="ctb-btn" title="Indent" onClick={() => onCommand('indent')}><T.indentMore size={18} /></button>
        <button type="button" className="ctb-btn" title="Clear formatting" onClick={() => onCommand('clear')}><T.clearFormat size={18} /></button>
      </div>
    </div>
  );
}

// ── Anchored wrapper ─────────────────────────────────────────────────────────
// Positions the toolbar top-left ABOVE a target rect (the element being edited),
// flipping BELOW when it would clip the top of the viewport, and clamping to the
// left/right edges. `rect` is in viewport coordinates ({ top, left, width,
// height }); the caller refreshes it on scroll/resize/selection change. Renders
// nothing when `open` is false or no rect is given.
//
// Rendered in the COMPOSER document (where composer.css / .ctb-* live) as a
// fixed-position overlay over the canvas — NOT inside the preview iframe, which
// carries none of the composer's styles.
const GAP = 10;   // space between the toolbar and the element
const EDGE = 8;   // keep this far from the viewport edges

export function CanvasTextToolbarAnchored({ open, rect, ...toolbarProps }) {
  const wrapRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);

  React.useLayoutEffect(() => {
    if (!open || !rect || !wrapRef.current) { setPos(null); return; }
    const el = wrapRef.current;
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;

    // Left-aligned to the element, clamped so it never runs off either edge.
    let left = rect.left;
    if (left + w > vw - EDGE) left = vw - EDGE - w;
    if (left < EDGE) left = EDGE;

    // Above by default; flip below if it would clip the top.
    let top = rect.top - h - GAP;
    let below = false;
    if (top < EDGE) { top = rect.top + rect.height + GAP; below = true; }
    // If flipping below would run off the bottom too, pin to the top edge.
    if (below && top + h > vh - EDGE) top = Math.max(EDGE, rect.top - h - GAP);

    setPos({ top: Math.round(top), left: Math.round(left) });
  }, [open, rect]);

  if (!open || !rect) return null;

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        top: pos ? pos.top : (rect.top - 60),
        left: pos ? pos.left : rect.left,
        // Hidden for the first layout pass (before we've measured), so it never
        // flashes in the wrong place.
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 2147482300,
      }}
    >
      <CanvasTextToolbar {...toolbarProps} style={{ position: 'static' }} />
    </div>
  );
}

// ── On-canvas mount ──────────────────────────────────────────────────────────
// Portals the toolbar into the selection handle slot (same host the typography
// bar uses), so it rides the on-canvas selection box. Rendered from the Inspector
// with the inspector `ctx`, gated to text-bearing elements.
//
// Wiring status (phase 2, incremental — validated live on LocalWP):
//   • block type → real write via ctx.setElement({ ...element, tag })  ← FIRST live test
//   • align / color already live in CanvasTypographyBar; here they read for display
//     and route through ctx (kept minimal until verified in the editor)
//   • AI + inline formatting → stubbed (logged) pending their own wiring passes
const MEDIA_TAGS = new Set([
  'img', 'svg', 'picture', 'video', 'audio', 'iframe', 'canvas', 'input', 'br', 'hr', 'source', 'track', 'select', 'textarea',
]);
const TAG_TO_BLOCK = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3', p: 'p', div: 'p', span: 'p' };
const BLOCK_TO_TAG = { h1: 'h1', h2: 'h2', h3: 'h3', p: 'p' };

function ctbLog(what, detail) {
  try {
    // Opt-IN. This fires on every slot render, so shipped as opt-out it wrote a
    // line per render into the editor console — hundreds of them — and buried the
    // errors people actually needed to read. The diagnostic is still one line
    // away when it is wanted: `window.UICH_DEBUG_TEXT_TOOLBAR = true`.
    if (typeof window === 'undefined' || window.UICH_DEBUG_TEXT_TOOLBAR !== true) return;
    // eslint-disable-next-line no-console
    console.log('[UiChemy text-toolbar] ' + what, detail === undefined ? '' : detail);
  } catch (_) { /* best-effort */ }
}

export function CanvasTextToolbarSlot({ ctx }) {
  const slot = React.useSyncExternalStore(subscribeHandleSlot, getHandleSlot, getHandleSlot);

  const el = ctx && ctx.element;
  const se = ctx && ctx.selectedEntry;
  const setElement = ctx && ctx.setElement;
  const tag = String((se && se.tag) || '').toLowerCase();

  // Re-measure the handle layer once we're in the slot so the box sizes to us.
  React.useLayoutEffect(() => {
    if (slot) { try { refreshHandles(); } catch (_) { /* noop */ } }
  }, [slot, tag]);

  // Diagnostic: says exactly why the toolbar does or doesn't render. Silence
  // Enable it with `window.UICH_DEBUG_TEXT_TOOLBAR = true`.
  ctbLog('slot render', {
    hasSlot: !!slot,
    hasElement: !!el,
    hasSelectedEntry: !!se,
    hasSetElement: typeof setElement === 'function',
    tag,
    willRender: !!(slot && el && se && typeof setElement === 'function' && !MEDIA_TAGS.has(tag)),
  });

  // `slot.node`, not `slot` — the store holds { doc, node } and only the node is
  // a portal target. Guarding on it here as well as reading it below, because
  // passing the wrapper to createPortal is exactly what broke this: React's
  // isValidContainer() found no nodeType and threw "Target container is not a
  // DOM element" (minified #200), which the Inspector's error boundary caught —
  // taking CanvasTypographyBar down with it. The canvas toolbar then rendered as
  // nothing but the grip and Ask AI, with the real cause hidden in a collapsed
  // panel.
  // Parked behind a flag. Every action it offers — bold, italic, lists, quote,
  // clear formatting — is a console.log stub waiting on an HTML text pipeline
  // the editor does not have yet (see composer-canvas-text.js, itself
  // dormant). Rendered into the canvas bar it stacked fourteen dead buttons
  // on top of the five controls that do work, which is what turned the bar
  // into two overlapping rows. Re-enable for phase 2 with
  // window.UICH_CANVAS_TEXT_TOOLBAR = true.
  if (typeof window === 'undefined' || window.UICH_CANVAS_TEXT_TOOLBAR !== true) return null;

  if (!slot || !slot.node || !el || !se || typeof setElement !== 'function') return null;
  if (MEDIA_TAGS.has(tag)) return null; // nothing to format

  const blockType = TAG_TO_BLOCK[tag] || 'p';
  const align = (ctx.resolvedScopeValue && ctx.resolvedScopeValue('typography', 'textAlign')) || 'left';
  const color = (ctx.resolvedScopeValue && ctx.resolvedScopeValue('typography', 'textColor')) || '#111111';

  const onBlockChange = (id) => {
    const nextTag = BLOCK_TO_TAG[id] || 'p';
    if (nextTag === tag) return;
    ctbLog('block change → setElement tag', { from: tag, to: nextTag });
    try { setElement({ ...el, tag: nextTag }); } catch (e) { ctbLog('block change failed', e && e.message); }
  };
  const onAI = (id) => ctbLog('AI action (stub)', id);
  const onAlign = (id) => ctbLog('align (stub — lives in typography bar)', id);
  const onColor = () => ctbLog('color (stub — lives in typography bar)');
  const onCommand = (id) => ctbLog('command (stub — needs HTML text pipeline)', id);

  return createPortal(
    // `uich-tw` is not decoration: tailwind.config.js sets
    // `important: '.uich-tw'`, so EVERY utility ships as `.uich-tw .foo`.
    // Without that ancestor this subtree gets none of them — it rendered as a
    // scatter of unpositioned accent-coloured blocks over the canvas. Matches
    // the typography bar's own portal root.
    <div className="uich-tw skin-elementor ctb-oncanvas">
      <CanvasTextToolbar
        embedded
        blockType={blockType}
        align={align}
        color={color}
        onBlockChange={onBlockChange}
        onAI={onAI}
        onAlign={onAlign}
        onColor={onColor}
        onCommand={onCommand}
        style={{ position: 'static' }}
      />
    </div>,
    slot.node,
  );
}

export default CanvasTextToolbar;
