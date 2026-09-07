// Canvas quick-action toolbar — a floating rounded-full pill that sits at the
// bottom-centre over the canvas (Inspecta-style). It surfaces the most-used
// canvas actions (pick, draw, outline, chat, open/close panel) in one horizontal
// row so they stay reachable even when the main panel is collapsed. Pure
// presentation: every action is wired from the composer app, which owns state.
import React from 'react';
import { cn } from '@/lib/utils';
import { I } from './composer-icons';
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/components/ui/tooltip';

/**
 * Toggle a lightweight "wireframe" outline over every element rendered inside
 * the Elementor preview. We inject a single tagged <style> into each preview
 * document (the editor iframe, or the top document in the dev harness) and
 * remove it when off — never touching Elementor's own or user styles. Neutral
 * grey so it reads as a utility overlay, not a brand colour.
 */
export function setCanvasOutline(on) {
  if (typeof document === 'undefined') return;
  const docs = [];
  const frames = Array.from(document.querySelectorAll('iframe'));
  for (const f of frames) {
    let d = null;
    try { d = f.contentDocument; } catch (_) { d = null; }
    if (!d || !d.head) continue;
    try { if (d.querySelector('.elementor-element')) docs.push(d); } catch (_) {}
  }
  // Dev-harness / same-document fallback.
  if (!docs.length && document.head) docs.push(document);

  const CSS = '.elementor-widget-container *, [data-uich-root] * {'
    + ' outline: 1px solid rgba(147, 151, 167, 0.55) !important;'
    + ' outline-offset: -1px !important; }';

  for (const d of docs) {
    let style = d.getElementById('uich-canvas-outline');
    if (on) {
      if (!style) {
        style = d.createElement('style');
        style.id = 'uich-canvas-outline';
        d.head.appendChild(style);
      }
      style.textContent = CSS;
    } else if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }
}

/**
 * `pro` marks the action as Pro-only in this build: the button stays clickable
 * (the handler opens the upsell modal) and gains a small gradient dot, since an
 * icon-only pill has no room for the usual "PRO" pill. The title/aria label say
 * it too, so the lock is not colour-only.
 */
function ToolButton({ icon, label, active, onClick, pro, tipContainer, disabled }) {
  const title = pro ? `${label} Pro` : label;
  const button = (
    <button
      type="button"
      className={cn('ct-btn', active && 'ct-btn-on', pro && 'ct-btn-pro', disabled && 'ct-btn-disabled')}
      // No `title`: the native tooltip would appear alongside the Radix one,
      // ~1s later and in the OS style. aria-label still names the button.
      aria-label={title}
      aria-pressed={active ? 'true' : undefined}
      aria-disabled={disabled ? 'true' : undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
    </button>
  );
  // Portal INTO the toolbar host. The pill is rendered through its own portal,
  // outside the panel's PortalContainerProvider, so usePortalContainer() finds
  // nothing and Radix would fall back to document.body — which is outside
  // `.uich-tw`, where every Tailwind utility is inert. The tooltip would render
  // completely unstyled, and on the live front end the page's own CSS would
  // style it instead.
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={10} container={tipContainer} className="ct-tip">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * macOS-dock magnification. The hovered button grows and its neighbours grow a
 * little less, falling off with horizontal distance from the pointer.
 *
 * Built natively rather than pulling a dock component from a third-party shadcn
 * registry: those are Framer Motion based, which is not a dependency here, and
 * this is ~20 lines of transform maths against a value the pointer already
 * gives us. Writes a CSS custom property per button and lets CSS animate it —
 * no React state, so a mousemove does not re-render the toolbar.
 */
/* Sizes in PIXELS, not a scale factor — the distinction is the whole point.
   transform: scale() does not reflow, so a magnified button grows INTO its
   neighbours and the pill stays the same width; it reads as crowding, not as a
   dock. Animating width makes the row reflow, so items push each other apart
   and the pill genuinely expands. magicui's Dock does the same: its
   `magnification: 60` against a 40px base is a width, not a multiplier. */
const DOCK_BASE = 34;    // .ct-btn's resting size, matches the CSS
const DOCK_PEAK = 48;    // size under the pointer; capped at the pill's inner
                         // height so a grown button never spills out of it
const DOCK_REACH = 120;  // px of falloff either side, about three buttons

function useDockMagnify(ref) {
  React.useEffect(() => {
    const bar = ref.current;
    if (!bar) return undefined;
    // Respect the OS setting — a magnifying dock is exactly the kind of motion
    // "reduce motion" is asking us not to do.
    const win = bar.ownerDocument?.defaultView || window;
    const reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;

    // Centres are measured ONCE per hover, on enter, at REST size — and then
    // never re-read. That is deliberate: widths change as the pointer moves, so
    // measuring live would feed each frame's output back into the next frame's
    // input and the row would oscillate. Against fixed rest centres the size of
    // every button is a pure function of the pointer's x, which is stable.
    //
    // An earlier version coalesced moves with requestAnimationFrame behind an
    // `if (frame) return` guard. That deadlocks: rAF does not fire in a
    // backgrounded tab, so the pending id is never cleared and every later move
    // returns early — magnification dies for the rest of that mount, and only a
    // remount brings it back. Not worth the risk to save five rect reads.
    let items = [];

    function measure() {
      items = Array.from(bar.querySelectorAll('.ct-btn')).map((b) => {
        const r = b.getBoundingClientRect();
        return { b, cx: r.left + r.width / 2 };
      });
    }
    function onMove(e) {
      if (!items.length) measure();
      for (const it of items) {
        const d = Math.abs(e.clientX - it.cx);
        // Gaussian falloff: smooth, with no visible step at the edge of reach.
        const k = Math.exp(-((d / DOCK_REACH) ** 2) * 2.2);
        const px = DOCK_BASE + (DOCK_PEAK - DOCK_BASE) * k;
        it.b.style.setProperty('--ct-size', px.toFixed(2) + 'px');
      }
    }
    let settleTimer = 0;
    function onEnter() {
      // Cancel a settle still in flight — re-entering mid-return should track
      // the pointer immediately, not finish easing back to rest first.
      if (settleTimer) { win.clearTimeout(settleTimer); settleTimer = 0; }
      bar.classList.remove('is-settling');
      measure();
    }
    function onLeave() {
      // Swap to the slower curve for the return, then drop the class once it has
      // finished so the next hover starts on the fast tracking transition.
      bar.classList.add('is-settling');
      for (const it of items) it.b.style.removeProperty('--ct-size');
      items = [];
      if (settleTimer) win.clearTimeout(settleTimer);
      settleTimer = win.setTimeout(() => {
        settleTimer = 0;
        bar.classList.remove('is-settling');
      }, 280);   // the 260ms settle plus a frame
    }

    bar.addEventListener('pointerenter', onEnter);
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerleave', onLeave);
    return () => {
      bar.removeEventListener('pointerenter', onEnter);
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerleave', onLeave);
      if (settleTimer) win.clearTimeout(settleTimer);
      bar.classList.remove('is-settling');
      for (const it of items) it.b.style.removeProperty('--ct-size');
      items = [];
    };
  }, [ref]);
}

// Session-only toolbar hide: the ✕ button sets this, so the pill stays gone for
// the rest of this page-load (survives re-mounts on selection/tab changes) but
// a refresh — which reloads the module — brings it back, exactly as asked.
let sessionToolbarHidden = false;

export function CanvasToolbarContent({
  picking, onTogglePick,
  outlineOn, onToggleOutline,
  layersOn, onToggleLayers,
  // History panel toggle (Undo/Redo are keyboard-only — no buttons).
  historyOn, onToggleHistory,
  onDraw, drawActive,
  // onOpenChat / chatOpen are no longer surfaced (the Ask AI / Chat button was
  // removed from the pill) but stay in the signature so the caller is untouched.
  onOpenChat, chatOpen,
  panelCollapsed, onToggleCollapse,
  // Free build: Draw is an AI-chat door, so it shows the Pro dot and its handler
  // opens the upsell modal. Passed in (not read from cfg here) to keep this
  // component pure presentation.
  proLocked,
}) {
  const T = I;
  const [hidden, setHidden] = React.useState(sessionToolbarHidden);
  const wrapRef = React.useRef(null);
  const barRef = React.useRef(null);
  // Re-render once on mount so the tooltip container ref is populated before
  // any tooltip can open (refs are null on the first pass).
  const [wrapEl, setWrapEl] = React.useState(null);
  React.useEffect(() => { setWrapEl(wrapRef.current); }, []);
  useDockMagnify(barRef);
  if (hidden) return null;
  const hide = () => { sessionToolbarHidden = true; setHidden(true); };
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={120}>
    <div className="canvas-toolbar-wrap" ref={wrapRef}>
      <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools" ref={barRef}>
        <ToolButton tipContainer={wrapEl} icon={<T.cursor size={16} />} label="Select / pick element" active={picking} onClick={onTogglePick} />
        <ToolButton tipContainer={wrapEl} icon={<T.pencil size={16} />} label="Draw on canvas" active={drawActive} onClick={onDraw} pro={proLocked} />
        <ToolButton tipContainer={wrapEl} icon={<T.layout size={15} />} label="Toggle element outlines" active={outlineOn} onClick={onToggleOutline} />
        {/* Layers, moved here from the panel titlebar. Flanked by separators on
            both sides so it reads as its own group, distinct from the tools. */}
        <span className="ct-sep" aria-hidden="true" />
        <ToolButton tipContainer={wrapEl} icon={<T.layers size={15} />} label="Toggle Layers" active={layersOn} onClick={onToggleLayers} />
        {/* History panel toggle. Undo/Redo are keyboard-only (Ctrl+Z / Ctrl+Shift+Z)
            on purpose — no toolbar buttons, per the design review (keeps the pill
            simple). The History list is where you jump to any point. */}
        {onToggleHistory && (
          <ToolButton tipContainer={wrapEl} icon={<T.history size={15} />} label="History" active={historyOn} onClick={onToggleHistory} />
        )}
        <span className="ct-sep" aria-hidden="true" />
        {/* Panel docks to the right, so use left/right arrows: collapsed → left
            ("pull the drawer open"), open → right ("push it back to the edge"). */}
        <ToolButton tipContainer={wrapEl}
          icon={panelCollapsed ? <T.caretLeft size={15} /> : <T.caretRight size={15} />}
          label={panelCollapsed ? 'Open panel' : 'Minimise panel'}
          onClick={onToggleCollapse}
        />
      </div>
      {/* Separate circular ✕ — hides the pill for this session (back on refresh).
          Icon uses currentColor so it follows the host's light/dark theme. */}
      <button
        type="button"
        className="ct-close"
        title="Hide toolbar"
        aria-label="Hide toolbar"
        onClick={hide}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
    </TooltipProvider>
  );
}
