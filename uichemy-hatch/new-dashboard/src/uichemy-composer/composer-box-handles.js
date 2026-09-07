// Interactive handle layer for the selected canvas element.
//
// Sibling module to composer-box-overlay.js, and deliberately NOT part of it:
// drawBoxOverlay() wipes its host (`host.textContent = ''`) on every draw, which
// would destroy a handle mid-drag and break pointer capture with it. This layer
// is built once and only ever repositioned, so a drag survives every redraw the
// selection decorator fires (scroll, resize, mutation).
//
// Today it renders one thing: a small floating bar above the selection carrying
// a 9-dot grip. Dragging the grip moves the element among its SIBLINGS, the
// same operation the Layers tree performs, routed through the same
// applyLayerMove() write, so canvas and tree can never disagree.
//
// Nothing is written while the pointer is down. A raw_html write replaces the
// canvas DOM (rerenderWidgetContainer / applyLive), which would yank the node
// out from under the drag, so the move is committed once, on drop.

import { clipHostToPanel } from './composer-box-overlay';
import {
  SparklesIcon,
  DragDropVerticalIcon,
  ArrowDown01Icon,
  ParagraphSpacingIcon,
} from '@hugeicons/core-free-icons';

/**
 * Render a Hugeicons icon to an SVG string.
 *
 * This layer builds plain DOM inside the Elementor preview document, so it can't
 * mount the React <HugeiconsIcon> the panel uses — but it must not hand-draw its
 * own glyphs either, or the canvas ends up with lookalikes that drift from the
 * panel's. Icons ship as [tag, attrs] tuples, so serialise them here and use the
 * SAME source of truth in both places.
 *
 * `stroke`/`width` override the per-node values because two of these are baked
 * into CSS `data:` URIs, which can't inherit currentColor and need the literal
 * ink for each bar theme.
 */
function hugeSvg(icon, { size = 14, stroke = 'currentColor', width = 1.8 } = {}) {
  const body = (icon || []).map(([tag, attrs = {}]) => {
    const parts = Object.entries(attrs)
      .filter(([k]) => k !== 'key')
      .map(([k, v]) => {
        const name = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        if (name === 'stroke') return `stroke="${stroke}"`;
        if (name === 'stroke-width') return `stroke-width="${width}"`;
        return `${name}="${v}"`;
      });
    return `<${tag} ${parts.join(' ')}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`
    + ` viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
}

/** Same glyph, encoded for a CSS `background-image: url(...)`. */
function hugeSvgUrl(icon, opts) {
  return `url('data:image/svg+xml;utf8,${encodeURIComponent(hugeSvg(icon, opts))}')`;
}

const HOST_ID = 'uich-box-handles';
// Above the box overlay's own base layer so the grip is never buried under a
// padding band. clipHostToPanel still drops us behind a docked panel.
const BASE_Z = 2147482100;
// Elementor "Editor One" skin (Elementor v4 panel). Literals, not CSS vars: this
// markup lives in the Elementor preview document, where the composer's theme
// tokens (.uich-tw / .skin-elementor) don't exist, so the skin's values are
// inlined here. Values verified against the installed Elementor 4.2.1 editor-one
// theme + its MUI theme: accent (primary-main) #f0abfc · Roboto · MUI shape
// radius 4px for controls, 8px for surfaces · the signature soft symmetric
// popover shadow (±6px offsets, 10px blur, 2px spread).
// The accent, like every other colour here, now comes from the shared palette
// (composer-skin-tokens.css) rather than being restated. --accent-bg carries
// the per-theme alpha the panel already uses — 0.14 light, 0.22 dark — so a
// selected control in the toolbar matches a selected control in the panel.
const ACCENT = 'rgb(var(--accent-rgb, 240, 171, 252))';
// Active/selected fills and focus rings are the accent at low alpha, so a
// "selected" control reads as on-brand without an unreadable pale-pink glyph on
// top of it, the ink stays the neutral ramp; only the FILL is pink.
const ACCENT_TINT = 'var(--accent-bg, rgba(240, 171, 252, 0.22))';   // active/selected (light)
const ACCENT_RING = 'rgba(var(--accent-rgb, 240, 171, 252), 0.55)';   // focus ring (light)
const ACCENT_TINT_D = 'var(--accent-bg, rgba(240, 171, 252, 0.22))'; // active/selected (dark)
const ACCENT_RING_D = 'rgba(var(--accent-rgb, 240, 171, 252), 0.34)'; // focus ring (dark)
// The DROPDOWN surface and its row hover, named once and taken straight from
// the shadcn tokens rather than the --panel-* ramp.
//
// These two are the tokens the PANEL's own menus use (bg-popover /
// hover:bg-accent), and both already carry the right value in each theme:
// --popover is #ffffff light and #313336 dark, --accent is #ebebeb light and
// #434547 dark. Writing them as one expression each is what stops the bar's two
// dropdowns drifting apart — the font list used to be painted on --panel-bg-2
// while the globals popover beside it used --panel-bg, so one dark dropdown sat
// two shades lighter than the other, and the dark row hover was a hand-written
// #3a3c3e (the DIVIDER colour, four percent above the menu it sat on) which
// read as no hover at all.
const MENU_BG = 'hsl(var(--popover))';
const MENU_ROW_HOVER = 'hsl(var(--accent))';
// The drag drop-indicator is a 2px line drawn on the (usually light) page, the
// pale primary would vanish against it, so the indicator uses a saturated
// member of the same pink family (fuchsia-500) purely for visibility.
const ACCENT_LINE = '#d946ef';
// Ask AI is the toolbar's one emphasised action. It used to be UiChemy brand
// orange; the composer carries no brand orange any more (black/white shades plus
// whatever the builder skin supplies), so it now uses the strongest neutral ink
// on each bar and leans on weight, not hue, to stand out. Hover still gets a
// neutral wash so the target reads as a button.
const BRAND = '#1f2124';        // strongest ink on the light bar
const BRAND_D = '#ffffff';      // strongest ink on the dark bar
const BRAND_TINT = 'rgba(31, 33, 36, 0.08)';
const BRAND_TINT_D = 'rgba(255, 255, 255, 0.12)';
// Elementor's own floating-panel shadow: a soft, symmetric 4-direction glow
// rather than a hard drop shadow. Verified from the editor-one MUI theme (there
// at 0.025 alpha for tooltips); nudged up for a toolbar that floats over page
// content so it still separates, while keeping the diffuse Elementor character.
const EL_SHADOW = '0px -6px 10px 2px rgba(0,0,0,0.05), 6px 0px 10px 2px rgba(0,0,0,0.05), -6px 0px 10px 2px rgba(0,0,0,0.05), 0px 6px 10px 2px rgba(0,0,0,0.05)';
const EL_SHADOW_DARK = '0px -6px 12px 2px rgba(0,0,0,0.4), 6px 0px 12px 2px rgba(0,0,0,0.4), -6px 0px 12px 2px rgba(0,0,0,0.4), 0px 6px 12px 2px rgba(0,0,0,0.4)';
// The floating bar's OWN lift. EL_SHADOW above is Elementor's symmetric 4-way
// popover glow: correct for a panel flyout, but on a wide toolbar it reads as a
// flat grey halo rather than something hovering over the page. This is the usual
// floating-toolbar recipe instead — a hairline ring, a 1px contact shadow, and
// one soft directional drop.
//
// The ring lives IN the shadow, not in `border`. A real 1px border on a 14px
// radius draws a hard grey outline that is the first thing the eye lands on,
// and it also eats 2px of the inner height; an inset-free 0-blur spread ring
// sits at the same place, a third of the weight, and costs no layout.
const BAR_SHADOW = '0 0 0 1px rgba(16, 18, 32, 0.055), 0 1px 2px rgba(16, 18, 32, 0.06), 0 10px 28px -6px rgba(16, 18, 32, 0.18)';
const BAR_SHADOW_DARK = '0 0 0 1px rgba(255, 255, 255, 0.07), 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 30px -6px rgba(0, 0, 0, 0.55)';

/* Ask AI is role-gated. composer-app owns that knowledge (access.features.ai_chat)
   and calls setBoxToolbarAI(); the bar itself only shows or hides. Default false
   so a build that never calls it simply has no AI button rather than one that
   silently does nothing. */
let aiEnabled = false;

/** Show or hide the toolbar's Ask AI action. Called from composer-app.
 *  Stores the flag only — drawBoxHandles applies it on every draw, so nothing
 *  here holds a reference to a button that a preview reload has detached. */
export function setBoxToolbarAI(enabled) {
  // TEMP (2026-08-24): "Ask AI" hidden from the element toolbar on request — to be
  // re-added later. Force-disabled regardless of the ai_chat capability composer-app
  // passes in. TO RESTORE: replace the line below with `aiEnabled = !!enabled;`.
  void enabled;
  aiEnabled = false;
}

// The same Hugeicons marks the panel uses, rather than hand-drawn lookalikes.
const AI_SVG = hugeSvg(SparklesIcon, { size: 14, width: 1.9 });
const GRIP_SVG = hugeSvg(DragDropVerticalIcon, { size: 14, width: 1.8 });

function px(n) { return `${Math.round(n * 100) / 100}px`; }

// The toolbar's React slot.
//
// The controls it carries (typography, and whatever follows) must show the
// SAME values the Inspector shows and write through the SAME funnel, so they
// are not rebuilt here in plain DOM, they are React, rendered from inside the
// Inspector (where the cascade/scope helpers already live) and portalled into
// this node. That makes sync a non-issue by construction rather than something
// to keep in step.
//
// Subscribable because this host is created lazily, on the first selection,
// long after the panel mounted.
let slot = null; // { doc, node } | null
const slotListeners = new Set();

export function subscribeHandleSlot(fn) {
  slotListeners.add(fn);
  return () => slotListeners.delete(fn);
}
export function getHandleSlot() { return slot; }

function setSlot(next) {
  if (slot === next) return;
  if (slot && next && slot.node === next.node) return;
  slot = next;
  slotListeners.forEach((fn) => {
    try { fn(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  });
}

// The toolbar is a real surface, not a badge: it is the shell every later
// canvas action (style, duplicate, delete, …) will live in, so it gets a
// proper light chrome, white card, hairline border, lifted shadow, square
// icon buttons with hover/pressed states and hairline group dividers.
//
// Injected as a stylesheet rather than inline styles because hover and pressed
// states cannot be expressed inline, and `!important` throughout because this
// markup renders inside the previewed PAGE, whose own CSS is free to target
// bare `button`/`div` and would otherwise repaint the toolbar.
const STYLE_ID = 'uich-box-handles-style';

// NEVER put a backtick in the stylesheet below, not even inside a CSS comment.
// It is a template literal, so one stray backtick ends the string early and the
// remaining CSS is parsed as JavaScript. That has happened twice: webpack reports
// an error but still emits a bundle, and the emitted module throws
// "<minified> is not defined" out of ensureStyles, which used to take the whole
// Inspector down with it. Quote CSS selectors in prose plainly instead.
function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Every selector below addresses a class stamped by composer-canvas-typo's
       stampClasses(). Nothing here is structural (no > div > button, no
       [data-k] button), those overlapped, so a rule for the unit chip also
       hit the select caret and styling one control moved another. One name, one
       rule. */

    /* ── Shell ────────────────────────────────────────────────────────────── */
    #${HOST_ID} .uich-bh-bar {
      position: absolute !important;
      box-sizing: border-box !important;
      margin: 0 !important;
      /* ABOVE the selection decoration, stated rather than left to chance.
         The host is one stacking context holding, in DOM order, four padding
         hit-strips (z-index 1), eight selection dots (z-index 2), the drop
         indicator, and this bar. The bar carried NO z-index, so it painted in
         the auto/0 group — beneath every dot. That is what put a pink handle
         dot on top of the open font dropdown.

         The dropdown's own z-index could not rescue it: this bar has an
         entrance animation with fill-mode both, and an element with a filling
         transform/opacity animation keeps a stacking context for as long as the
         animation is in effect — which, with a fill, is forever. So the menu's
         2147483000 is resolved INSIDE the bar and never competes with the dots
         at all. The bar's own z-index is the only one that decides this, hence
         a real value here.

         10, not a large number: it is only ever compared with 1 and 2, and the
         host's own z-index is what holds the whole layer above the page. */
      z-index: 10 !important;
      display: flex !important;
      align-items: center !important;
      gap: 0 !important;
      padding: 7px 9px !important;
      background: var(--panel-bg, #fff) !important;
      border: 1px solid var(--panel-line, #e0e0e0) !important;
      border-radius: var(--radius, 6px) !important;
      box-shadow: ${EL_SHADOW} !important;
      pointer-events: none !important;
      font: 500 13px/1 'Plus Jakarta Sans', sans-serif !important;
      color: var(--uich-text, #3f444b) !important;
    }
    #${HOST_ID} .uich-bh-slot { display: flex !important; align-items: center !important; }

    /* ── Drag grip ────────────────────────────────────────────────────────── */
    #${HOST_ID} .uich-bh-btn {
      all: unset;
      box-sizing: border-box !important;
      pointer-events: auto !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 28px !important;
      height: 28px !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--text-mid, #69727d) !important;
      cursor: pointer;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      transition: background-color .12s ease, color .12s ease;
    }
    #${HOST_ID} .uich-bh-btn:hover { background: var(--panel-bg-2, #f5f5f5) !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-btn:active { background: var(--panel-bg-3, #ebebeb) !important; }
    #${HOST_ID} .uich-bh-btn.is-on { background: ${ACCENT_TINT} !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-grip { cursor: grab; color: var(--text-dim, #9da5ae) !important; width: 26px !important; }
    #${HOST_ID} .uich-bh-grip:hover { color: var(--text-hi, #0c0d0e) !important; background: var(--panel-bg-2, #f5f5f5) !important; }
    #${HOST_ID} .uich-bh-grip.is-off {
      opacity: .4 !important;
      cursor: not-allowed !important;
      color: var(--text-dim, #9da5ae) !important;
      background: transparent !important;
    }
    #${HOST_ID} .uich-bh-grip.is-dragging { cursor: grabbing; background: ${ACCENT_TINT} !important; color: var(--text-hi, #0c0d0e) !important; }

    /* ── Token bridge: give the ramp its steps back inside .uich-tb ─────────
       The controls' root carries uich-tw, a skin class and uich-tb, and
       composer.css ends
       with a bridge block that re-declares the whole legacy ramp ON .uich-tw:

         .uich-tw { --panel-bg: hsl(var(--background));
                    --panel-bg-2: hsl(var(--background));
                    --panel-bg-3: hsl(var(--background)); … }

       -2 and -3 are deliberately COLLAPSED onto -bg there, and that is right
       for the panel: its surfaces are flat and dozens of elements paint
       themselves with those names. It is wrong here, and in two ways.

       First, a custom property substitutes at its DECLARATION scope, so those
       three declarations shadow the values this toolbar inherits from the bar
       — the bar resolves --panel-* from its own data-uich-composer-skin/-theme
       attributes and is correct, but nothing inside .uich-tb sees them.

       Second, and this is the visible fault: every hover in the toolbar is
       written as --panel-bg-2 or --panel-bg-3 over a --panel-bg surface. With
       all three equal, hovering a control, a font row or a globals row painted
       the surface in the colour it already was. Not subtle — no hover at all,
       in either theme. The dropdown had the same problem against the bar it
       hangs off: same fill, so it read as one shape with no edge.

       So the names are re-declared here at ID specificity, mapped onto the
       shadcn tokens that DO carry the distinct steps in both themes:

         --panel-bg-2 = --muted   action-hover     #f5f5f5 · #313336
         --panel-bg-3 = --accent  action-selected  #ebebeb · #434547

       Every existing rule keeps working unchanged; they simply mean again what
       their names say. This also makes the toolbar render identically in both
       documents it can live in — the preview iframe, which loads canvas.css and
       has no bridge block, and the editor window, which loads composer.css and
       does. */
    #${HOST_ID} .uich-tb {
      --panel-bg: hsl(var(--background));
      --panel-bg-2: hsl(var(--muted));
      --panel-bg-3: hsl(var(--accent));
      --panel-bg-4: hsl(var(--secondary));
      --panel-line: hsl(var(--border));
      --panel-line-2: hsl(var(--input));
      /* --foreground is Editor One's text-SECONDARY (#3f444b / #babfc5); the
         primary ink the toolbar calls --text-hi is --accent-foreground
         (#0c0d0e / #ffffff), the pair that stays legible on a hovered row. */
      --text-hi: hsl(var(--accent-foreground));
      --uich-text: hsl(var(--foreground));
      --text-mid: hsl(var(--muted-foreground));
      --text-dim: hsl(var(--muted-foreground));
    }

    /* ── Theme isolation ──────────────────────────────────────────────────
       Hello, Astra and friends style bare input/button/select, element
       selectors reach straight in here and repaint the toolbar with the site's
       accent, font stack, uppercase tracking and 48px control heights. So the
       toolbar states its own value for every property a theme is likely to set,
       at ID specificity plus !important, rather than hoping none of them do. */
    #${HOST_ID} .uich-tb,
    #${HOST_ID} .uich-tb * {
      box-sizing: border-box !important;
      font-family: 'Plus Jakarta Sans', sans-serif !important;
      letter-spacing: normal !important;
      text-transform: none !important;
      text-indent: 0 !important;
      text-shadow: none !important;
      float: none !important;
      max-width: none !important;
    }
    /* :where() so this reset carries ZERO extra specificity. Written as a
       plain element selector it scored (1,1,1), one MORE than a component rule
       like .uich-tb-unit at (1,1,0), so the reset beat the very rules meant to
       style these parts: the unit chip lost its fill (visible only on :hover,
       which scores higher) and the colour swatch lost its colour. With :where()
       the reset ties at (1,1,0) and every later component rule wins. */
    #${HOST_ID} .uich-tb :where(input, button) {
      -webkit-appearance: none !important;
      appearance: none !important;
      margin: 0 !important;
      min-width: 0 !important;
      min-height: 0 !important;
      height: auto !important;
      padding: 0 !important;
      border: 0 !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      line-height: 1.2 !important;
      box-shadow: none !important;
      outline: none !important;
      color: var(--text-hi, #0c0d0e) !important;
    }
    #${HOST_ID} .uich-tb :where(button) { cursor: pointer !important; color: var(--text-mid, #69727d) !important; }
    /* Backgrounds are NOT reset wholesale: the swatch paints its colour through
       an inline style, and a blanket transparent would erase it. Each named part
       states its own fill instead. */
    #${HOST_ID} .uich-tb-caret,
    #${HOST_ID} .uich-tb-seg-btn,
    #${HOST_ID} .uich-tb-menu-row,
    #${HOST_ID} .uich-tb-value {
      background: transparent !important;
      background-image: none !important;
    }
    #${HOST_ID} .uich-tb ::placeholder { color: var(--text-dim, #9da5ae) !important; opacity: 1 !important; }
    #${HOST_ID} .uich-tb svg { display: inline-block !important; vertical-align: middle !important; }

    /* ── Row + dividers ───────────────────────────────────────────────────── */
    #${HOST_ID} .uich-tb {
      display: flex !important;
      align-items: center !important;
      gap: 3px !important;
      pointer-events: auto !important;
      color: var(--uich-text, #3f444b) !important;
    }
    #${HOST_ID} .uich-tb-sep {
      width: 1px !important;
      height: 20px !important;
      margin: 0 9px !important;
      background: var(--panel-line, #e0e0e0) !important;
      flex: 0 0 auto !important;
      align-self: center !important;
    }

    /* ── Cells. Every one is fixed-size: a growing cell does not just look
          wrong, it widens the toolbar until the viewport clamp slides it to the
          screen edge and the popup stops appearing over its element. ───────── */
    #${HOST_ID} .uich-tb-cell { flex: 0 0 auto !important; }

    /* ── tooltips ───────────────────────────────────────────────────────────
       The bar only ever had the native title attribute: about a second of delay,
       OS styling that matches nothing else here, and it renders outside the
       toolbar so it cannot be aligned to the cell it belongs to. A CSS-only tip
       on the data-tip attribute instead — instant, set in the bar's own face, and
       it inverts for the dark bar with no override, because the background is the
       INK token and the text is the SURFACE token, so the pair simply swaps.

       Below the bar, never above. The bar floats directly over the selected
       element, so a tip above it would cover the thing being edited.

       A cell carrying data-tip must NOT also carry title, or the browser draws
       its own on top a second later.

       NOTE, and this cost a failed build: this whole stylesheet is a JS TEMPLATE
       LITERAL. No backticks anywhere in here, not even inside a comment quoting
       an attribute name — a backtick ends the literal and the file stops parsing.
       Name attributes in prose instead. */
    #${HOST_ID} [data-tip] { position: relative !important; }
    #${HOST_ID} [data-tip]::after {
      content: attr(data-tip) !important;
      position: absolute !important;
      top: calc(100% + 9px) !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      padding: 5px 8px !important;
      border-radius: 6px !important;
      background: var(--text-hi, #0c0d0e) !important;
      color: var(--panel-bg, #fff) !important;
      font: 500 11.5px/1.35 'Plus Jakarta Sans', sans-serif !important;
      letter-spacing: 0 !important;
      white-space: nowrap !important;
      pointer-events: none !important;
      opacity: 0 !important;
      transition: opacity .08s ease !important;
      z-index: 2147483001 !important;
    }
    #${HOST_ID} [data-tip]:hover::after,
    #${HOST_ID} [data-tip]:focus-within::after { opacity: 1 !important; }
    /* An OPEN dropdown beats its own tooltip.
       The tip is anchored 9px below the cell, which is exactly where the menu
       opens, so with a menu up the tip printed across its first row. Dropping
       the focus-within trigger would not have fixed it: while the menu is open
       the pointer is inside the menu, which is inside the cell, so plain :hover
       keeps the tip alive too. The open menu itself is the only reliable signal,
       hence :has(). Where :has() is unsupported this simply does not apply and
       the tip behaves as before. */
    #${HOST_ID} .uich-tb-cell:has(.uich-tb-menu)::after,
    #${HOST_ID} .uich-tb-cell:has(.uich-tb-global.is-open)::after {
      opacity: 0 !important;
    }
    /* The right-most cell. Centre-anchoring runs a long tip past the bar's right
       edge — which is exactly where the dynamic cell sits, and where a clipped
       tooltip was showing as a stray sliver. */
    #${HOST_ID} [data-tip][data-tip-end]::after {
      left: auto !important;
      right: 0 !important;
      transform: none !important;
    }
    /* +30px over the other selects: this cell also carries the globals chip, and
       taking that width out of the field left the font name clipped to a stub. */
    #${HOST_ID} .uich-tb-cell[data-k="fontFamily"] { width: 186px !important; }
    #${HOST_ID} .uich-tb-cell[data-k="fontWeight"] { width: 116px !important; }
    #${HOST_ID} .uich-tb-cell[data-k="fontSize"],
    #${HOST_ID} .uich-tb-cell[data-k="lineHeight"] { width: 96px !important; }

    /* PropField renders a label and a globals picker. Both are panel
       affordances: the label has nowhere to go here, and the picker doubled
       every field's width for a control the panel already offers. */
    #${HOST_ID} .uich-tb .pf-label,
    #${HOST_ID} .uich-tb .pf-input-row > *:not(.pf-input-main),
    #${HOST_ID} .uich-tb .uich-tb-off { display: none !important; }
    #${HOST_ID} .uich-tb .field,
    #${HOST_ID} .uich-tb .prop-input-stack,
    #${HOST_ID} .uich-tb .pf-input-row {
      display: flex !important;
      align-items: center !important;
      margin: 0 !important;
      padding: 0 !important;
      gap: 0 !important;
      min-width: 0 !important;
      width: 100% !important;
    }
    #${HOST_ID} .uich-tb .pf-input-main { flex: 1 1 auto !important; min-width: 0 !important; }

    /* ── Globals chip (font family + colour only) ──────────────────────────────
       The two properties most often driven by a global token get their picker
       back, as a segment on the end of the field rather than a second control
       beside it: the box gives up its right edge, the chip takes the rounded
       corner. Same shape as the unit chip, deliberately — one visual idea for
       "this field has a second mode".

       Must out-specify the blanket hide rule above, which is why it is written
       as a pf-input-row child selector and placed after it. */
    #${HOST_ID} .uich-tb .pf-input-row > .uich-tb-global {
      display: inline-flex !important;
      flex: 0 0 auto !important;
      align-self: stretch !important;
    }
    #${HOST_ID} .uich-tb-cell[data-k="fontFamily"] .uich-tb-box,
    #${HOST_ID} .uich-tb-cell[data-k="textColor"] .uich-tb-box {
      border-top-right-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
      border-right: 0 !important;
    }
    #${HOST_ID} .uich-tb-global-btn {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 auto !important;
      width: 30px !important;
      height: 28px !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 1px solid var(--panel-line, #e0e0e0) !important;
      border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0 !important;
      background: var(--panel-bg-2, #f5f5f5) !important;
      color: var(--text-mid, #69727d) !important;
    }
    #${HOST_ID} .uich-tb-global-btn:hover,
    #${HOST_ID} .uich-tb-global.is-open .uich-tb-global-btn {
      background: var(--panel-bg-3, #ebebeb) !important;
      color: var(--text-hi, #0c0d0e) !important;
      border-color: var(--panel-line, #e0e0e0) !important;
    }

    /* The picker's popover, dressed from scratch. It arrives wearing Tailwind
       utilities (bg-popover, border, rounded-md, flex-1, truncate, font-mono, the
       paddings) that live in composer.css — loaded into whichever document hosts
       the PANEL, which in the Elementor editor is not the document this toolbar
       renders into. So none of them apply here and every part needs declaring,
       exactly as uich-tb-menu already has to. Shape follows uich-tb-menu so the
       two dropdowns in this bar are one design. */
    #${HOST_ID} .uich-tb-gmenu {
      position: absolute !important;
      right: 0 !important;
      left: auto !important;
      top: 100% !important;
      bottom: auto !important;
      margin: 5px 0 0 0 !important;
      display: flex !important;
      flex-direction: column !important;
      width: max-content !important;
      min-width: 240px !important;
      max-width: 320px !important;
      max-height: 260px !important;
      overflow: hidden !important;
      padding: 0 !important;
      z-index: 2147483000 !important;
      background-color: ${MENU_BG} !important;
      color: var(--uich-text, #3f444b) !important;
      border: 1px solid var(--panel-line, #e0e0e0) !important;
      border-radius: var(--radius, 6px) !important;
      box-shadow: ${EL_SHADOW} !important;
    }
    #${HOST_ID} .uich-tb-gsearch {
      display: flex !important;
      align-items: center !important;
      gap: 7px !important;
      flex: 0 0 auto !important;
      padding: 8px 10px !important;
      border-bottom: 1px solid var(--panel-line, #e0e0e0) !important;
      color: var(--text-mid, #69727d) !important;
    }
    #${HOST_ID} .uich-tb-gsearch-input {
      flex: 1 1 auto !important;
      width: 100% !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      outline: none !important;
      color: var(--uich-text, #3f444b) !important;
      font: 500 12.5px/1.4 inherit !important;
    }
    #${HOST_ID} .uich-tb-glist {
      flex: 1 1 auto !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      padding: 4px !important;
    }
    /* ── Scrollbars ─────────────────────────────────────────────────────────
       The composer gives every dropdown and popover ONE scrollbar: 3px wide, a
       --panel-line-2 thumb at 2px radius, transparent track (composer.css, the
       block listing combo-menu / upill-list / suggest / layer-menu / lib-list /
       cpicker-globals-list). These two panes are dropdowns like the rest and now
       use it, instead of the 8px translucent thumb with a 2px surface-coloured
       border they carried, which matched nothing else in the product.

       Note what is NOT here: scrollbar-width. Both menus used to set it to
       thin, and that single declaration is why they looked wrong. Chrome
       implements the standard property, and once it is set it IGNORES the
       ::-webkit-scrollbar pseudo-elements entirely — so the 8px rules below it
       never applied at all and Chrome drew its own ~11px bar. composer.css
       carries the same warning over the prompt textarea for the same reason.
       The webkit rules alone give the 3px bar; Firefox keeps its own default,
       exactly as every other menu in the panel does. */
    #${HOST_ID} .uich-tb-menu::-webkit-scrollbar,
    #${HOST_ID} .uich-tb-glist::-webkit-scrollbar {
      width: 3px !important;
      height: 3px !important;
    }
    #${HOST_ID} .uich-tb-menu::-webkit-scrollbar-thumb,
    #${HOST_ID} .uich-tb-glist::-webkit-scrollbar-thumb {
      background: var(--panel-line-2, #a7aaad) !important;
      border: 0 !important;
      border-radius: 2px !important;
    }
    #${HOST_ID} .uich-tb-menu::-webkit-scrollbar-track,
    #${HOST_ID} .uich-tb-glist::-webkit-scrollbar-track { background: transparent !important; }

    #${HOST_ID} .uich-tb-ggroup {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      width: 100% !important;
      padding: 5px 8px !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--text-mid, #69727d) !important;
      font-size: 10.5px !important;
      font-weight: 600 !important;
      letter-spacing: .05em !important;
      text-transform: uppercase !important;
      text-align: left !important;
    }
    #${HOST_ID} .uich-tb-ggroup:hover { background-color: ${MENU_ROW_HOVER} !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-tb-ggroup-name {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      text-align: left !important;
    }
    #${HOST_ID} .uich-tb-ggroup-count { flex: 0 0 auto !important; font-variant-numeric: tabular-nums !important; }

    #${HOST_ID} .uich-tb-gitem {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      width: 100% !important;
      padding: 5px 8px !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--uich-text, #3f444b) !important;
      font-size: 12.5px !important;
      font-weight: 500 !important;
      text-align: left !important;
      cursor: pointer !important;
    }
    #${HOST_ID} .uich-tb-gitem:hover { background-color: ${MENU_ROW_HOVER} !important; }
    #${HOST_ID} .uich-tb-gitem-sw {
      flex: 0 0 auto !important;
      width: 14px !important;
      height: 14px !important;
      border-radius: 3px !important;
      border: 1px solid rgba(12, 13, 14, .18) !important;
    }
    /* The name takes the room; the value is a hint and gives way first. */
    #${HOST_ID} .uich-tb-gitem-name {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    #${HOST_ID} .uich-tb-gitem-val {
      flex: 0 1 auto !important;
      min-width: 0 !important;
      max-width: 45% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      color: var(--text-mid, #69727d) !important;
      font-size: 11px !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important;
    }

    /* ── The field box, shared by select and length ────────────────────────── */
    #${HOST_ID} .uich-tb-box {
      display: flex !important;
      align-items: center !important;
      width: 100% !important;
      height: 28px !important;
      border: 1px solid var(--panel-line, #e0e0e0) !important;
      border-radius: var(--radius-sm, 4px) !important;
      background: var(--panel-bg, #fff) !important;
      box-shadow: none !important;
      padding: 0 !important;
      transition: border-color .12s ease, box-shadow .12s ease !important;
    }
    #${HOST_ID} .uich-tb-box:hover { border-color: var(--panel-line-2, #a7aaad) !important; }
    #${HOST_ID} .uich-tb-box:focus-within {
      border-color: ${ACCENT} !important;
      box-shadow: 0 0 0 3px ${ACCENT_RING} !important;
    }
    #${HOST_ID} .uich-tb-value {
      flex: 1 1 auto !important;
      height: 100% !important;
      padding: 0 10px !important;
      text-align: left !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      overflow: hidden !important;
    }

    /* ── Select ───────────────────────────────────────────────────────────── */
    #${HOST_ID} .uich-tb-select { position: relative !important; }
    /* The shared control draws a filled triangle, heavy beside hairline
       borders. Replaced with a thin chevron here only, toolbar density, not a
       defect in the panel's own glyph. */
    #${HOST_ID} .uich-tb-caret {
      flex: 0 0 auto !important;
      width: 28px !important;
      height: 100% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    #${HOST_ID} .uich-tb-caret svg { display: none !important; }
    #${HOST_ID} .uich-tb-caret::after {
      content: "" !important;
      width: 12px !important;
      height: 12px !important;
      background: no-repeat center/12px ${hugeSvgUrl(ArrowDown01Icon, { size: 24, stroke: '#69727d', width: 2.2 })} !important;
    }

    /* ── Length + unit chip ───────────────────────────────────────────────── */
    #${HOST_ID} .uich-tb-length {
      /* Safe to clip: the unit menu is portalled to a floating layer, so nothing
         inside this box needs to escape it, and clipping is what lets the chip
         meet the rounded corner with no seam. A select must NOT clip: its
         options list is absolutely positioned inside its own box, and clipping
         swallowed every dropdown, they opened, invisibly. */
      overflow: hidden !important;
    }
    /* The chip is a grandchild: UnitPill wraps its button in a span, so the
       wrapper has to stretch too or the fill floats mid-field instead of
       meeting the box edges. */
    #${HOST_ID} .uich-tb-unit-wrap {
      display: flex !important;
      align-self: stretch !important;
      flex: 0 0 auto !important;
    }
    #${HOST_ID} .uich-tb-unit {
      flex: 0 0 auto !important;
      align-self: stretch !important;
      display: flex !important;
      align-items: center !important;
      padding: 0 10px !important;
      border-radius: 0 !important;
      background: var(--panel-bg-2, #f5f5f5) !important;
      background-image: none !important;
      color: var(--text-mid, #69727d) !important;
      font-size: 11.5px !important;
      border-left: 1px solid var(--panel-line, #e0e0e0) !important;
    }
    #${HOST_ID} .uich-tb-unit:hover { background: var(--panel-bg-3, #ebebeb) !important; color: var(--text-hi, #0c0d0e) !important; }
    /* Line height carries a leading glyph: it is the one field whose bare
       number means nothing without a label. */
    #${HOST_ID} .uich-tb-cell[data-k="lineHeight"] .uich-tb-box::before {
      content: "" !important;
      flex: 0 0 auto !important;
      width: 15px !important;
      height: 15px !important;
      margin-left: 9px !important;
      background: no-repeat center/15px ${hugeSvgUrl(ParagraphSpacingIcon, { size: 24, stroke: '#69727d', width: 2 })} !important;
    }
    #${HOST_ID} .uich-tb-cell[data-k="lineHeight"] .uich-tb-value { padding-left: 4px !important; }
    #${HOST_ID} .uich-tb-cell[data-k="fontSize"] .uich-tb-value,
    #${HOST_ID} .uich-tb-cell[data-k="lineHeight"] .uich-tb-value { text-align: center !important; padding-right: 4px !important; }

    /* ── Segmented align ──────────────────────────────────────────────────── */
    #${HOST_ID} .uich-tb-seg {
      display: flex !important;
      align-items: center !important;
      gap: 2px !important;
      height: 28px !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    #${HOST_ID} .uich-tb-seg-btn {
      flex: 0 0 auto !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 28px !important;
      height: 28px !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--text-mid, #69727d) !important;
      transition: background-color .12s ease, color .12s ease !important;
    }
    #${HOST_ID} .uich-tb-seg-btn:hover { background: var(--panel-bg-2, #f5f5f5) !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-tb-seg-btn.bg-background { background: ${ACCENT_TINT} !important; color: var(--text-hi, #0c0d0e) !important; }

    /* ── Colour ───────────────────────────────────────────────────────────── */
    #${HOST_ID} .uich-tb-color {
      display: flex !important;
      align-items: center !important;
      gap: 5px !important;
      width: auto !important;
      height: 28px !important;
      padding: 0 8px !important;
      border: 1px solid var(--panel-line, #e0e0e0) !important;
      border-radius: var(--radius-sm, 4px) !important;
      background: var(--panel-bg, #fff) !important;
      cursor: pointer !important;
      transition: border-color .12s ease !important;
    }
    #${HOST_ID} .uich-tb-color:hover { border-color: var(--panel-line-2, #a7aaad) !important; }
    /* Only the swatch is pinned. The caret is a sibling and keeps its own size,
       or it collapses out of sight. */
    #${HOST_ID} .uich-tb-swatch,
    #${HOST_ID} .uich-tb-swatch * {
      width: 22px !important;
      height: 22px !important;
      border-radius: var(--radius-sm, 4px) !important;
      flex: 0 0 auto !important;
      border: 0 !important;
    }
    #${HOST_ID} .uich-tb-swatch {
      box-shadow: inset 0 0 0 1px rgba(16, 18, 32, 0.14) !important;
      overflow: hidden !important;
      padding: 0 !important;
    }
    #${HOST_ID} .uich-tb-caret-icon {
      display: inline-flex !important;
      width: 10px !important;
      height: 10px !important;
      flex: 0 0 auto !important;
      color: var(--text-mid, #69727d) !important;
    }

    /* ── Options menu ─────────────────────────────────────────────────────── */
    #${HOST_ID} .uich-tb-menu {
      /* Position is declared HERE, for the same reason the height cap is: the
         control asks for it with Tailwind utilities (absolute left-0 right-0
         top-full mt-1) that live in composer.css, and that stylesheet is loaded
         into whichever document hosts the panel, in the Elementor editor, not
         necessarily the one this toolbar renders into. Without them the menu
         stopped being positioned at all: it laid out as a static block inside
         the flex row, so it appeared beside the field as a narrow column with
         every font name truncated. */
      position: absolute !important;
      left: 0 !important;
      right: auto !important;
      top: 100% !important;
      bottom: auto !important;
      margin: 4px 0 0 0 !important;
      /* Never narrower than the field it belongs to, and free to grow past it so
         long names stay readable. */
      min-width: 100% !important;
      width: max-content !important;
      max-width: 260px !important;
      padding: 4px !important;
      z-index: 2147483000 !important;
      /* Height cap and scrolling are declared HERE, not inherited from the
         control's Tailwind classes. Those live in composer.css, which is loaded
         into whichever document hosts the panel, in the Elementor editor that
         is not always the document this toolbar renders into, so the cap went
         missing and the font list grew to its full length with no scroll. */
      max-height: 220px !important;
      overflow-y: auto !important;
      /* No horizontal scrollbar: long names ellipsize instead. */
      overflow-x: hidden !important;
      background-color: ${MENU_BG} !important;
      color: var(--uich-text, #3f444b) !important;
      border: 1px solid var(--panel-line, #e0e0e0) !important;
      border-radius: var(--radius, 6px) !important;
      box-shadow: ${EL_SHADOW} !important;
    }
    #${HOST_ID} .uich-tb-menu-row {
      /* block, not flex: a flex row cannot ellipsize its own text, and long font
         names are exactly what pushed a horizontal scrollbar into the menu. */
      display: block !important;
      width: 100% !important;
      padding: 5px 8px !important;
      border-radius: var(--radius-sm, 4px) !important;
      color: var(--uich-text, #3f444b) !important;
      text-align: left !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    #${HOST_ID} .uich-tb-menu-row:hover { background-color: ${MENU_ROW_HOVER} !important; }
    #${HOST_ID} .uich-tb-menu-row.bg-accent { background-color: ${ACCENT_TINT} !important; color: var(--text-hi, #0c0d0e) !important; }

    /* ── Dark skin ────────────────────────────────────────────────────────────
       These rules no longer carry a palette. Every colour above and below now
       resolves through the SAME custom properties the composer panel and the
       dock read (composer-skin-tokens.css), and those tokens already flip with
       the editor's theme — so what is left here is redundant with its light
       counterpart and safe to delete once verified in both themes.

       The toolbar used to restate the Editor One dark palette as literals. That
       is what let it drift: alongside the real values it grew in-between shades
       that exist nowhere in the panel. */
    #${HOST_ID} .uich-bh-bar.uich-bh-dark {
      background: var(--panel-bg, #fff) !important;
      border-color: var(--panel-line, #e0e0e0) !important;
      box-shadow: ${EL_SHADOW_DARK} !important;
      color: var(--uich-text, #3f444b) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-bh-btn { color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-btn:hover { background: var(--panel-bg-2, #f5f5f5) !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-btn:active { background: var(--panel-bg-3, #ebebeb) !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-btn.is-on { background: ${ACCENT_TINT_D} !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-grip { color: var(--text-dim, #9da5ae) !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-grip:hover { color: var(--text-hi, #0c0d0e) !important; background: var(--panel-bg-2, #f5f5f5) !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-grip.is-off { color: var(--text-dim, #9da5ae) !important; background: transparent !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-grip.is-dragging { background: ${ACCENT_TINT_D} !important; color: var(--text-hi, #0c0d0e) !important; }

    #${HOST_ID} .uich-bh-dark .uich-tb { color: var(--uich-text, #3f444b) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb :where(input, button) { color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb :where(button) { color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb ::placeholder { color: var(--text-dim, #9da5ae) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-sep { background: var(--panel-line, #3a3c3e) !important; }

    #${HOST_ID} .uich-bh-dark .uich-tb-box {
      border-color: var(--panel-line-2, #a7aaad) !important;
      background: var(--panel-bg, #fff) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-box:hover { border-color: var(--panel-line-2, #434547) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-box:focus-within {
      border-color: ${ACCENT} !important;
      box-shadow: 0 0 0 3px ${ACCENT_RING_D} !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-value { background: transparent !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-caret::after {
      background: no-repeat center/12px ${hugeSvgUrl(ArrowDown01Icon, { size: 24, stroke: '#9da5ae', width: 2.2 })} !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-cell[data-k="lineHeight"] .uich-tb-box::before {
      background: no-repeat center/15px ${hugeSvgUrl(ParagraphSpacingIcon, { size: 24, stroke: '#9da5ae', width: 2 })} !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-unit {
      background: var(--panel-bg-2, #f5f5f5) !important;
      color: var(--text-mid, #69727d) !important;
      border-left-color: var(--panel-line-2, #a7aaad) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-unit:hover { background: var(--panel-bg-3, #434547) !important; color: var(--text-hi, #0c0d0e) !important; }

    #${HOST_ID} .uich-bh-dark .uich-tb-global-btn {
      background: var(--panel-bg-2, #f5f5f5) !important;
      color: var(--text-mid, #69727d) !important;
      border-color: var(--panel-line-2, #a7aaad) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-global-btn:hover,
    #${HOST_ID} .uich-bh-dark .uich-tb-global.is-open .uich-tb-global-btn {
      background: var(--panel-bg-3, #434547) !important;
      color: var(--text-hi, #0c0d0e) !important;
      border-color: var(--panel-line-2, #434547) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-gmenu {
      background-color: ${MENU_BG} !important;
      color: var(--uich-text, #3f444b) !important;
      border-color: var(--panel-line, #e0e0e0) !important;
      box-shadow: ${EL_SHADOW_DARK} !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-gsearch { border-bottom-color: var(--panel-line, #e0e0e0) !important; color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-gsearch-input { color: var(--uich-text, #3f444b) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-ggroup { color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-ggroup:hover { background-color: ${MENU_ROW_HOVER} !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-gitem { color: var(--uich-text, #3f444b) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-gitem:hover { background-color: ${MENU_ROW_HOVER} !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-gitem-val { color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-gitem-sw { border-color: rgba(255, 255, 255, .22) !important; }

    #${HOST_ID} .uich-bh-dark .uich-tb-seg-btn { color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-seg-btn:hover { background: var(--panel-bg-2, #f5f5f5) !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-seg-btn.bg-background { background: ${ACCENT_TINT_D} !important; color: var(--text-hi, #0c0d0e) !important; }

    #${HOST_ID} .uich-bh-dark .uich-tb-color {
      border-color: var(--panel-line-2, #a7aaad) !important;
      background: var(--panel-bg, #fff) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-color:hover { border-color: var(--panel-line-2, #434547) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-caret-icon { color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-swatch {
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18) !important;
    }

    #${HOST_ID} .uich-bh-dark .uich-tb-menu {
      background-color: ${MENU_BG} !important;
      color: var(--uich-text, #3f444b) !important;
      border-color: var(--panel-line, #3a3c3e) !important;
      box-shadow: ${EL_SHADOW_DARK} !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-menu-row { color: var(--uich-text, #3f444b) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-menu-row:hover { background-color: ${MENU_ROW_HOVER} !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-menu-row.bg-accent { background-color: ${ACCENT_TINT_D} !important; color: var(--text-hi, #0c0d0e) !important; }
    /* Padding drag edges — transparent hit strips on each side of the selection;
       a brand tint appears on hover / while dragging so the affordance is found. */
    #${HOST_ID} .uich-bh-pad-edge { background: transparent; transition: background .08s; }
    #${HOST_ID} .uich-bh-pad-edge:hover,
    #${HOST_ID} .uich-bh-pad-edge.is-drag { background: rgba(128, 128, 128, 0.32) !important; }
    /* Selection handle dots — 4 corners + 4 edge-centres. Corners are visual;
       edge-centre dots mark the draggable padding edges. */
    #${HOST_ID} .uich-bh-dot {
      position: absolute; width: 7px; height: 7px; box-sizing: border-box;
      /* Pink to match the selection outline; a black-bordered square read as
         a different tool's chrome sitting on top of ours. */
      background: var(--panel-bg, #fff); border: 1px solid #EC0868; border-radius: 1px;
      transform: translate(-50%, -50%); pointer-events: none; display: none; z-index: 2;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       BORDERLESS SKIN
       ───────────────────────────────────────────────────────────────────────
       Overrides the blocks above rather than editing them, so reverting is
       deleting from this banner to the end of the template.

       The pattern comes from five shipping builders (Framer-style text bar,
       Webflow, Wix): on a canvas toolbar every control is borderless and
       unfilled, and a caret is what tells you a value is editable. Dividers do
       the grouping that 11 outlines were doing before.

       Geometry: bar radius 14, controls 32px at radius 9, dividers 1x20 at 6px.
       ═══════════════════════════════════════════════════════════════════════ */
    #${HOST_ID} .uich-bh-bar {
      gap: 2px !important;
      padding: 6px 8px !important;
      border-radius: var(--radius, 6px) !important;
      /* No border at all — BAR_SHADOW carries the hairline as a ring, so the
         shell reads as one lifted white surface instead of an outlined card. */
      border: 0 !important;
      box-shadow: ${BAR_SHADOW} !important;
    }
    #${HOST_ID} .uich-bh-dark.uich-bh-bar { box-shadow: ${BAR_SHADOW_DARK} !important; }

    #${HOST_ID} .uich-bh-btn {
      width: 28px !important;
      height: 28px !important;
      border-radius: var(--radius-sm, 4px) !important;
    }
    #${HOST_ID} .uich-bh-btn:hover { background: var(--panel-bg-2, #f5f5f5) !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-btn:hover { background: var(--panel-bg-2, #f5f5f5) !important; }
    #${HOST_ID} .uich-bh-grip { color: var(--text-dim, #9da5ae) !important; width: 26px !important; }

    /* Control shell: no border, no fill, until hover or focus. */
    #${HOST_ID} .uich-tb-box {
      height: 28px !important;
      border-color: transparent !important;
      background: transparent !important;
      border-radius: var(--radius-sm, 4px) !important;
    }
    #${HOST_ID} .uich-tb-box:hover {
      border-color: transparent !important;
      background: var(--panel-bg-2, #f5f5f5) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-box,
    #${HOST_ID} .uich-bh-dark .uich-tb-color {
      border-color: transparent !important;
      background: transparent !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-box:hover,
    #${HOST_ID} .uich-bh-dark .uich-tb-color:hover {
      border-color: transparent !important;
      background: var(--panel-bg-2, #f5f5f5) !important;
    }
    /* Focus keeps a real surface so the caret and text stay legible while typing. */
    #${HOST_ID} .uich-tb-box:focus-within {
      background: var(--panel-bg, #fff) !important;
      border-color: ${ACCENT} !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-box:focus-within {
      background: var(--panel-bg, #fff) !important;
      border-color: ${ACCENT} !important;
    }

    /* The unit was a filled chip with its own dividing rule; borderless now, and
       it keeps ew-resize because it doubles as the scrub handle. */
    #${HOST_ID} .uich-tb-unit {
      background: transparent !important;
      border-left: 0 !important;
      cursor: ew-resize !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-unit { background: transparent !important; }
    #${HOST_ID} .uich-tb-unit:hover { background: var(--panel-bg-3, #ebebeb) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-unit:hover { background: var(--panel-bg-3, #ebebeb) !important; }

    /* Colour: the swatch alone, no box around it. */
    #${HOST_ID} .uich-tb-color {
      height: 28px !important;
      padding: 0 7px !important;
      gap: 6px !important;
      border-color: transparent !important;
      background: transparent !important;
      border-radius: var(--radius-sm, 4px) !important;
    }
    #${HOST_ID} .uich-tb-color:hover { background: var(--panel-bg-2, #f5f5f5) !important; }
    /* Softer square than the old 4px chip, to sit with the 9px controls. */
    #${HOST_ID} .uich-tb-swatch,
    #${HOST_ID} .uich-tb-swatch * {
      width: 20px !important;
      height: 20px !important;
      border-radius: var(--radius-sm, 4px) !important;
    }
    #${HOST_ID} .uich-tb-caret-icon { width: 11px !important; height: 11px !important; }

    /* Dividers carry the grouping. Full control height would fence the row into
       cells; two thirds of it groups without drawing a grid.

       The uich-tb::before rule is the leading divider, between Ask AI and the
       first property control. It cannot be a real element: the controls arrive
       as a React portal whose root IS uich-tb, so the bar's plain DOM has no
       node to put there, and the divider must disappear along with the controls
       when nothing is selected. A pseudo-element on the portal root is both.

       uich-bh-sep is the divider renderItems() builds for the extras group. It
       gets the full declaration here because it never had one — only height and
       margin were ever set, so it laid out 0px wide and no divider appeared in
       front of the extras at all. */
    /* Only the pseudo-element takes a content value; the other two are real divs.

       :not(:empty) matters — when the panel's Inspector is not rendering (its
       error boundary tripped, or the controls have not portalled in yet) the
       portal root is an EMPTY div, and an unguarded divider would hang off the
       end of "Ask AI" pointing at nothing. */
    #${HOST_ID} .uich-tb:not(:empty)::before { content: "" !important; }
    #${HOST_ID} .uich-tb-sep,
    #${HOST_ID} .uich-bh-sep,
    #${HOST_ID} .uich-tb:not(:empty)::before {
      width: 1px !important;
      height: 20px !important;
      margin: 0 6px !important;
      background: var(--panel-line, #e0e0e0) !important;
      flex: 0 0 auto !important;
      align-self: center !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-sep,
    #${HOST_ID} .uich-bh-dark .uich-bh-sep,
    #${HOST_ID} .uich-bh-dark .uich-tb:not(:empty)::before { background: var(--panel-line, #3a3c3e) !important; }

    /* Segmented groups lose their track — the buttons are already grouped by
       sitting together between two dividers. */
    #${HOST_ID} .uich-tb-seg { height: 28px !important; background: transparent !important; }
    #${HOST_ID} .uich-tb-seg-btn { height: 28px !important; width: 28px !important; border-radius: var(--radius-sm, 4px) !important; }

    /* ── Width: the cells were sized for bordered fields ──────────────────────
       A bordered box needs its value centred in a fixed frame, so the old cells
       were padded out to 186/96px and the value floated in the middle of an
       invisible rectangle: "Inter" then 90px of nothing then the caret. With no
       frame there is nothing for that air to fill, so each cell shrinks to about
       what its value needs, the caret comes back within reach of the text, and
       the bar loses roughly 200px of width — which is why it now fits above a
       narrow element instead of being clamped to the viewport edge. */
    #${HOST_ID} .uich-tb-cell[data-k="fontFamily"] { width: 124px !important; }
    #${HOST_ID} .uich-tb-cell[data-k="fontWeight"] { width: 96px !important; }
    #${HOST_ID} .uich-tb-cell[data-k="fontSize"] { width: 70px !important; }
    /* Line height is NOT the same width as font size, even though both are a
       number plus a unit: this one also carries the leading glyph, so the same
       width squeezed the value until "1.4" rendered as "1." and the placeholder
       "Auto" rendered as "Au…". Glyph 15 + gap 8 + unit 31 leaves ~44px for the
       value here, which fits both. */
    #${HOST_ID} .uich-tb-cell[data-k="lineHeight"] { width: 98px !important; }
    #${HOST_ID} .uich-tb-value { padding: 0 8px !important; }
    /* The caret is a hint next to a word, not a button-sized target of its own. */
    #${HOST_ID} .uich-tb-caret { width: 20px !important; }
    #${HOST_ID} .uich-tb-caret::after { width: 11px !important; height: 11px !important; background-size: 11px !important; }
    #${HOST_ID} .uich-tb-unit { padding: 0 7px !important; }
    #${HOST_ID} .uich-tb-cell[data-k="lineHeight"] .uich-tb-box::before { margin-left: 8px !important; }

    /* ── Globals chip ─────────────────────────────────────────────────────────
       The one control the borderless pass missed: it kept its grey fill and its
       1px border, so in a bar of bare controls it was the single outlined box,
       and it read as the bar's primary action. Bare like the rest, and the
       field's clipped right corner goes back to being round now that there is
       no chip edge to meet. */
    #${HOST_ID} .uich-tb-cell[data-k="fontFamily"] .uich-tb-box,
    #${HOST_ID} .uich-tb-cell[data-k="textColor"] .uich-tb-box {
      border-top-right-radius: 9px !important;
      border-bottom-right-radius: 9px !important;
      border-right: 0 !important;
    }
    #${HOST_ID} .uich-tb-global-btn {
      width: 26px !important;
      height: 28px !important;
      border: 0 !important;
      border-radius: var(--radius-sm, 4px) !important;
      background: transparent !important;
    }
    #${HOST_ID} .uich-tb-global-btn:hover,
    #${HOST_ID} .uich-tb-global.is-open .uich-tb-global-btn {
      border: 0 !important;
      background: var(--panel-bg-2, #f5f5f5) !important;
    }
    #${HOST_ID} .uich-bh-dark .uich-tb-global-btn { border: 0 !important; background: transparent !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-global-btn:hover,
    #${HOST_ID} .uich-bh-dark .uich-tb-global.is-open .uich-tb-global-btn {
      border: 0 !important;
      background: var(--panel-bg-2, #f5f5f5) !important;
    }

    /* Both dropdowns follow the shell's radius, or a 8px popover hanging off a
       14px bar reads as a different component. */
    #${HOST_ID} .uich-tb-menu,
    #${HOST_ID} .uich-tb-gmenu { border-radius: var(--radius, 6px) !important; }
    #${HOST_ID} .uich-tb-menu-row,
    #${HOST_ID} .uich-tb-gitem,
    #${HOST_ID} .uich-tb-ggroup { border-radius: var(--radius-sm, 4px) !important; }

    /* ── Ask AI ─────────────────────────────────────────────────────────────
       The row's ONLY coloured item, so the AI entry point is findable. Brand
       orange, deliberately NOT the ACCENT pink used by the selection outline
       and the active-button tint — at pink it read as another selected state. */
    #${HOST_ID} .uich-bh-ai {
      all: unset;
      box-sizing: border-box !important;
      pointer-events: auto !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      flex: 0 0 auto !important;
      height: 28px !important;
      padding: 0 10px !important;
      border-radius: var(--radius-sm, 4px) !important;
      background: transparent !important;
      color: ${BRAND} !important;
      font: 600 12.5px/1 'Plus Jakarta Sans', sans-serif !important;
      white-space: nowrap !important;
      cursor: pointer;
      user-select: none;
      transition: background-color .12s ease !important;
    }
    #${HOST_ID} .uich-bh-ai:hover { background: ${BRAND_TINT} !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-ai { color: ${BRAND_D} !important; }
    #${HOST_ID} .uich-bh-dark .uich-bh-ai:hover { background: ${BRAND_TINT_D} !important; }
    #${HOST_ID} .uich-bh-ai svg { flex: 0 0 auto !important; }
    #${HOST_ID} .uich-bh-ai.is-off { display: none !important; }

    /* ── The real LengthInput shape ───────────────────────────────────────────
       stampClasses tags .lin-row as the field box, but .lin-row is only a
       WRAPPER: the actual field is an inner div, and the minus/plus stepper is
       that div's sibling. The inner div dresses itself in Tailwind utilities, so
       wherever composer.css is absent it arrives as a plain block — and its
       input and unit chip stacked, which is why the size field read as "Size"
       with "px" underneath instead of as one row. */
    #${HOST_ID} .uich-tb-length > div {
      display: flex !important;
      flex: 1 1 auto !important;
      align-items: center !important;
      min-width: 0 !important;
      height: 100% !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    /* The panel's field has room for a minus/plus stepper. A floating bar does
       not — it was the third and fourth control inside a 70px cell, and it is
       what pushed the value and its unit onto two lines. Dropped HERE only:
       typing, arrow keys and scrubbing the unit chip all still step the value,
       so the control loses crowding, not capability. */
    #${HOST_ID} .uich-tb .lin-step { display: none !important; }

    /* The swatch is a button. On a themed page a bare button arrives wearing the
       site's fill, radius and padding, so state all three. */
    #${HOST_ID} .uich-tb-swatch {
      flex: 0 0 auto !important;
      padding: 0 !important;
      border: 0 !important;
    }


    /* ── Dynamic value ────────────────────────────────────────────────────────
       The last control still dressed in inline styles, which is exactly why it
       read as foreign: inline CSS cannot express :hover, so it was the only
       button in the bar with no hover state at all, and its ink came out as the
       row's body colour instead of the muted grey every other icon uses. Its
       glyph also ran a pixel under the align icons next to it.

       Declared here now, so it inherits the same 32/9 geometry, the same
       muted-to-dark hover, and — when a dynamic token IS bound — the same accent
       fill the active align button uses, so "this control is doing something"
       reads identically everywhere in the bar. */
    #${HOST_ID} .uich-tb-dyn {
      all: unset;
      box-sizing: border-box !important;
      display: inline-grid !important;
      place-items: center !important;
      flex: 0 0 auto !important;
      width: 28px !important;
      height: 28px !important;
      padding: 0 !important;
      border-radius: var(--radius-sm, 4px) !important;
      background: transparent !important;
      color: var(--text-mid, #69727d) !important;
      cursor: pointer;
      transition: background-color .12s ease, color .12s ease !important;
    }
    #${HOST_ID} .uich-tb-dyn:hover { background: var(--panel-bg-2, #f5f5f5) !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-tb-dyn:active { background: var(--panel-bg-3, #ebebeb) !important; }
    #${HOST_ID} .uich-tb-dyn.is-bound { background: ${ACCENT_TINT} !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-dyn { color: var(--text-mid, #69727d) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-dyn:hover { background: var(--panel-bg-2, #f5f5f5) !important; color: var(--text-hi, #0c0d0e) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-dyn:active { background: var(--panel-bg-3, #ebebeb) !important; }
    #${HOST_ID} .uich-bh-dark .uich-tb-dyn.is-bound { background: ${ACCENT_TINT_D} !important; color: var(--text-hi, #0c0d0e) !important; }

    /* ── Colour swatch: one box, square, one radius ───────────────────────────
       It was the odd control in the bar. Two faults, both geometric:

         padding: 0 7px    horizontal only, so the hover wash came out wider
                           than it was tall around a square swatch.
         border-*-right-   only the RIGHT pair of corners was set to 9px, while
         radius: 9px       the base radius left the LEFT pair at 4px. That came
                           from the days when this field was fused to the globals
                           chip and needed a clipped right edge; the chip went
                           bare, the comment on that rule says the corner "goes
                           back to being round", and it did — on one side.

       Now it is the same 28 by 28 at 9px radius as every other icon button here
       (see .uich-tb-dyn just above), with the swatch centred by grid rather than
       by padding, so all four sides are equal by construction and cannot drift
       apart again. The globals chip beside it takes the same box, so the pair
       reads as two buttons of one size instead of two near-misses. */
    #${HOST_ID} .uich-tb-cell[data-k="textColor"] .uich-tb-box,
    #${HOST_ID} .uich-tb-color {
      width: 28px !important;
      min-width: 28px !important;
      height: 28px !important;
      padding: 0 !important;
      gap: 0 !important;
      display: grid !important;
      place-items: center !important;
      border-radius: 9px !important;
    }
    #${HOST_ID} .uich-tb-swatch {
      width: 18px !important;
      height: 18px !important;
      border-radius: 5px !important;
    }
    /* The caret has no room in a 28px square and the swatch already says what the
       control does — the colour itself is the value. */
    #${HOST_ID} .uich-tb-color .uich-tb-caret-icon { display: none !important; }

    /* Both radii, not just the right pair. */
    #${HOST_ID} .uich-tb-cell[data-k="fontFamily"] .uich-tb-box {
      border-radius: 9px !important;
    }
    #${HOST_ID} .uich-tb-global-btn {
      width: 28px !important;
      min-width: 28px !important;
      height: 28px !important;
      padding: 0 !important;
      border-radius: 9px !important;
    }

    /* Keyboard focus, one ring for every icon button in the bar. These are real
       focusable controls — the host carries no aria-hidden precisely so they can
       be reached — and until now none of them showed focus at all. Uniform by
       design: a ring on one button and not its neighbour reads as a defect. */
    #${HOST_ID} .uich-bh-btn:focus-visible,
    #${HOST_ID} .uich-bh-ai:focus-visible,
    #${HOST_ID} .uich-tb-seg-btn:focus-visible,
    #${HOST_ID} .uich-tb-dyn:focus-visible {
      outline: 2px solid ${ACCENT_LINE} !important;
      outline-offset: 1px !important;
    }

    /* ── Appearance ───────────────────────────────────────────────────────────
       An ANIMATION with fill-mode "both", not a transition driven by a class.
       That distinction is the whole point: the first version set opacity 0 and
       waited for requestAnimationFrame to add a class that returned it to 1 —
       and rAF is throttled in a background tab, so the bar could sit fully
       invisible while every control inside it worked. Entrance polish must never
       be load-bearing for visibility. Here the resting state IS opacity 1: if
       the animation never runs, is interrupted, or is disabled outright, the bar
       is simply there.

       POSITION is never animated. The bar tracks scrolling and mutation through
       refreshHandles, and an eased left/top would visibly trail the element it
       belongs to — the jitter would cost more than the polish buys. */
    #${HOST_ID} .uich-bh-bar {
      animation: uich-bh-in .14s cubic-bezier(.2, .8, .2, 1) both;
    }
    @keyframes uich-bh-in {
      from { opacity: 0; transform: translateY(3px); }
      to   { opacity: 1; transform: none; }
    }

    /* The unit menu and the colour picker portal OUT of the bar, to a host
       ensurePortalRoot() appends to body, so nothing scoped to this bar's id
       reaches them. The design system now styles them properly — canvas.css is
       enqueued into this document — but its rounded-md is 4px, which reads as a
       different component sitting under a 14px pill. So the radius, and only the
       radius, is brought onto the shell's. Everything else stays the design
       system's.

       Safe to write unscoped: this stylesheet is injected per-document, into
       whichever document the bar lives in. */
    .uich-portal-root > div { border-radius: var(--radius, 6px) !important; }
    /* And the same 3px scrollbar the menus above just took. The unit list is a
       dropdown like any other, but it is built from design-system utilities and
       Tailwind has no scrollbar utility, so it was the one menu in the bar still
       drawing the browser's default bar. Written unscoped for the same reason as
       the rule above: this stylesheet is injected per-document, into whichever
       document the bar (and therefore this portal host) lives in. */
    .uich-portal-root ::-webkit-scrollbar { width: 3px !important; height: 3px !important; }
    .uich-portal-root ::-webkit-scrollbar-thumb {
      background: var(--panel-line-2, #a7aaad) !important;
      border: 0 !important;
      border-radius: 2px !important;
    }
    .uich-portal-root ::-webkit-scrollbar-track { background: transparent !important; }

    /* Menus open from their trigger corner. Short enough to feel instant. */
    #${HOST_ID} .uich-tb-menu,
    #${HOST_ID} .uich-tb-gmenu {
      transform-origin: top left;
      animation: uich-bh-pop .12s cubic-bezier(.2, .8, .2, 1);
    }
    @keyframes uich-bh-pop {
      from { opacity: 0; transform: translateY(-3px) scale(.985); }
      to   { opacity: 1; transform: none; }
    }

    /* Motion is polish, never the mechanism: with it suppressed every control
       still appears, positions and reads exactly the same. */
    @media (prefers-reduced-motion: reduce) {
      #${HOST_ID} .uich-bh-bar { transition: none; transform: none; }
      #${HOST_ID} .uich-tb-menu,
      #${HOST_ID} .uich-tb-gmenu { animation: none; }
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

function ensureHost(doc) {
  let host = doc.getElementById(HOST_ID);
  if (host && host.__uichBH) { ensureStyles(doc); return host; }
  ensureStyles(doc);

  host = doc.createElement('div');
  host.id = HOST_ID;
  // NO aria-hidden on the host: it contains REAL focusable controls (grip,
  // toolbar buttons, text-align seg buttons). aria-hidden on their ancestor makes
  // the browser refuse focus and relocate it out — in Gutenberg that hands focus
  // back to the canvas, which re-selects the block under it and tears down the
  // composer's element selection (clicking any floating control deselected the
  // pick). Decorative-only children (line, dots, pad-edges) carry aria-hidden
  // individually instead.
  // The host itself must stay pointer-transparent, an interactive full-viewport
  // layer swallows the first click on the page every time. Only buttons opt in.
  host.style.cssText =
    'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;' +
    `z-index:${BASE_Z};visibility:hidden;`;

  const bar = doc.createElement('div');
  bar.className = 'uich-bh-bar';

  const grip = doc.createElement('button');
  grip.type = 'button';
  grip.className = 'uich-bh-btn uich-bh-grip';
  grip.title = 'Drag to move';
  grip.setAttribute('aria-label', 'Drag to move element');
  grip.innerHTML = GRIP_SVG;
  bar.appendChild(grip);

  // Ask AI — the toolbar's one coloured action. Placed right after the grip so
  // it holds a stable position; the property controls that follow change with
  // the selection, this does not.
  const ai = doc.createElement('button');
  ai.type = 'button';
  ai.className = 'uich-bh-ai' + (aiEnabled ? '' : ' is-off');
  ai.title = 'Ask AI about this element';
  ai.setAttribute('aria-label', 'Ask AI about this element');
  ai.innerHTML = AI_SVG + '<span>Ask AI</span>';
  // pointerdown is swallowed so the press does not reach the canvas and
  // re-select whatever is underneath, the same guard renderItems() uses.
  ai.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
  ai.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // composer-app listens for this and opens the Chat tab; it re-checks the
    // role gate there, so dispatching can never bypass Role Manager.
    try {
      window.dispatchEvent(new CustomEvent('uich:composer-switch-tab', { detail: { tab: 'chat' } }));
    } catch (_) { }
  }, true);
  bar.appendChild(ai);

  // Everything added later lands here, behind its own divider, so the grip
  // stays the leftmost affordance no matter how the toolbar grows.
  const extras = doc.createElement('div');
  extras.style.cssText = 'display:none;align-items:center;gap:2px;pointer-events:none;';
  bar.appendChild(extras);

  const slotEl = doc.createElement('div');
  slotEl.className = 'uich-bh-slot';
  bar.appendChild(slotEl);

  const line = doc.createElement('div');
  line.setAttribute('aria-hidden', 'true');
  line.style.cssText = 'position:absolute;pointer-events:none;display:none;';

  // Padding drag edges — one hit strip per side, laid over the selection's edges.
  // Opt back into pointer events (the host is transparent); positioned per-rect in
  // positionPadEdges() and wired in bindPaddingEdges().
  function mkPadEdge(cursor) {
    const e = doc.createElement('div');
    e.className = 'uich-bh-pad-edge';
    e.setAttribute('aria-hidden', 'true'); // non-focusable div; hide from SR
    // `!important` on the inline cursor: pick mode stamps `* { cursor: crosshair
    // !important }` on the whole page, and an inline important is the only thing
    // that outranks it so the resize (<->) affordance actually shows on the edge.
    e.style.cssText = 'position:absolute;pointer-events:auto;display:none;z-index:1;cursor:' + cursor + ' !important;';
    host.appendChild(e);
    return e;
  }
  const padEdges = {
    top: mkPadEdge('ns-resize'),
    right: mkPadEdge('ew-resize'),
    bottom: mkPadEdge('ns-resize'),
    left: mkPadEdge('ew-resize'),
  };

  // Visible selection handle dots: 4 corners + 4 edge-centres. Purely visual
  // (pointer-events:none) — the edge hit-strips above own the drag.
  function mkDot() {
    const d = doc.createElement('div');
    d.className = 'uich-bh-dot';
    d.setAttribute('aria-hidden', 'true');
    host.appendChild(d);
    return d;
  }
  const padDots = {
    tl: mkDot(), tr: mkDot(), bl: mkDot(), br: mkDot(),
    top: mkDot(), right: mkDot(), bottom: mkDot(), left: mkDot(),
  };

  host.appendChild(line);
  host.appendChild(bar);
  (doc.body || doc.documentElement).appendChild(host);

  host.__uichBH = { bar, grip, ai, extras, slotEl, line, padEdges, padDots, padBound: false, dragging: false, el: null, opts: {}, bound: false, itemsKey: '' };
  return host;
}

// Side name → CSS-side suffix (matches the Inspector's pad<Side> keys).
const PAD_SIDE = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

/** Lay the four padding hit-strips over the selection's edges (host coords). */
function positionPadEdges(doc, host, r) {
  const st = host.__uichBH;
  if (!st || !st.padEdges) return;
  const hostLeft = parseFloat(host.style.left) || 0;
  const T = 9; // hit-strip thickness, centred on the line
  // The selection outline (composer-pick.jsx SELECTED_CLASS) is a 2px dashed line
  // drawn at outline-offset:3px — i.e. its stroke centre sits ~4px OUTSIDE the
  // element's border box. Place the dots + hit-strips on that same line so the
  // dots read as centred on the box line, not floating inside it.
  const OFF = 4;
  const oL = r.left - hostLeft - OFF;
  const oT = r.top - OFF;
  const oW = r.width + OFF * 2;
  const oH = r.height + OFF * 2;
  const R = oL + oW;
  const B = oT + oH;
  const cx = oL + oW / 2;
  const cy = oT + oH / 2;
  const e = st.padEdges;
  const put = (el, left, top, w, h) => {
    el.style.left = px(left); el.style.top = px(top);
    el.style.width = px(w); el.style.height = px(h);
    el.style.display = 'block';
  };
  put(e.left,   oL - T / 2,      oT,           T,   oH);
  put(e.right,  R - T / 2,       oT,           T,   oH);
  put(e.top,    oL,              oT - T / 2,   oW,  T);
  put(e.bottom, oL,              B - T / 2,    oW,  T);

  // Visible dots (centres set via transform:translate(-50%,-50%)), on the line.
  const dots = st.padDots;
  if (dots) {
    const dot = (el, x, y) => { el.style.left = px(x); el.style.top = px(y); el.style.display = 'block'; };
    dot(dots.tl, oL, oT);   dot(dots.tr, R, oT);
    dot(dots.bl, oL, B);    dot(dots.br, R, B);
    dot(dots.top, cx, oT);  dot(dots.bottom, cx, B);
    dot(dots.left, oL, cy); dot(dots.right, R, cy);
  }
}

/**
 * Drag a padding edge to change that side's padding. Dispatches
 * `uich:composer:pad-drag` {side:'Left'|…, px} on the TOP window (where the
 * Inspector's React runs), which applies it through the SAME spacing write the
 * panel field uses — so the Inspector Spacing value and the canvas stay in sync,
 * in all three builders. Mid-drag writes are throttled to rAF. Mirrors bindGrip's
 * cross-document pointer capture so a drag that leaves the preview iframe still
 * tracks.
 */
function bindPaddingEdges(doc, host) {
  const st = host.__uichBH;
  if (!st || st.padBound) return;
  st.padBound = true;
  const win = doc.defaultView || window;
  Object.keys(st.padEdges).forEach((sideKey) => {
    const edge = st.padEdges[sideKey];
    edge.addEventListener('pointerdown', function (ev) {
      if (!st.el) return;
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const cssSide = PAD_SIDE[sideKey];
      const cs = win.getComputedStyle(st.el);
      const startPad = parseFloat(cs['padding' + cssSide]) || 0;
      const startMar = parseFloat(cs['margin' + cssSide]) || 0;
      const startX = ev.clientX;
      const startY = ev.clientY;
      const horizontal = (sideKey === 'left' || sideKey === 'right');
      // Inward vs outward: left/top inward is +delta, right/bottom is −delta.
      const sign = (sideKey === 'left' || sideKey === 'top') ? 1 : -1;
      const topWin = win.top || win;
      let raf = 0;
      let pending = null;

      edge.classList.add('is-drag');
      try { edge.setPointerCapture(ev.pointerId); } catch (_) { /* older */ }

      const flush = () => {
        raf = 0;
        if (!pending) return;
        const detail = Object.assign({ side: cssSide }, pending);
        pending = null;
        try {
          topWin.dispatchEvent(new topWin.CustomEvent('uich:composer:pad-drag', { detail: detail }));
        } catch (_) {
          try { topWin.dispatchEvent(new CustomEvent('uich:composer:pad-drag', { detail: detail })); } catch (_) { /* noop */ }
        }
      };
      const onMove = (e2) => {
        const delta = horizontal ? (e2.clientX - startX) : (e2.clientY - startY);
        // `d` = inward distance from the edge's start. Box model: inward space is
        // PADDING, outward space is MARGIN — so drag inward grows padding, drag
        // outward (past the start) grows margin. Only the property being dragged
        // is sent, so a padding drag never writes a stray margin and vice versa.
        const d = sign * delta;
        if (d >= 0) {
          pending = { pad: Math.max(0, Math.round(startPad + d)) };
        } else {
          pending = { mar: Math.max(0, Math.round(startMar - d)) };
        }
        if (!raf) raf = win.requestAnimationFrame(flush);
      };
      const onUp = () => {
        if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
        flush();
        edge.classList.remove('is-drag');
        try { edge.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onUp, true);
        if (topWin.document && topWin.document !== doc) {
          topWin.document.removeEventListener('pointermove', onMove, true);
          topWin.document.removeEventListener('pointerup', onUp, true);
          topWin.document.removeEventListener('pointercancel', onUp, true);
        }
      };
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onUp, true);
      if (topWin.document && topWin.document !== doc) {
        topWin.document.addEventListener('pointermove', onMove, true);
        topWin.document.addEventListener('pointerup', onUp, true);
        topWin.document.addEventListener('pointercancel', onUp, true);
      }
    });
  });
}

/**
 * Render the toolbar's optional buttons.
 *
 * Rebuilt only when the SET of items changes (keyed by id), never on every
 * reposition, replacing a button the pointer is on would break the click that
 * is already in flight.
 *
 * @param {Document} doc
 * @param {object} st  host state
 * @param {Array<{id:string,title:string,svg:string,onClick:Function,active?:boolean}>} items
 */
function renderItems(doc, st, items) {
  const list = Array.isArray(items) ? items : [];
  const key = list.map((it) => it.id).join('|');
  if (key !== st.itemsKey) {
    st.itemsKey = key;
    st.extras.textContent = '';
    if (list.length) {
      const sep = doc.createElement('div');
      sep.className = 'uich-bh-sep';
      st.extras.appendChild(sep);
      list.forEach((it) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'uich-bh-btn';
        b.dataset.uichBhId = it.id;
        if (it.title) { b.title = it.title; b.setAttribute('aria-label', it.title); }
        b.innerHTML = it.svg || '';
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cur = (st.opts.items || []).find((x) => x.id === it.id);
          if (cur && typeof cur.onClick === 'function') cur.onClick(st.el);
        }, true);
        st.extras.appendChild(b);
      });
    }
    st.extras.style.display = list.length ? 'flex' : 'none';
  }
  // Pressed state can change without the set changing, so it syncs every draw.
  list.forEach((it) => {
    const b = st.extras.querySelector(`[data-uich-bh-id="${it.id}"]`);
    if (b) b.classList.toggle('is-on', !!it.active);
  });
}

/** Siblings the element can be reordered among, element children of its parent. */
function siblingsOf(el) {
  const parent = el && el.parentElement;
  if (!parent) return [];
  return Array.prototype.filter.call(
    parent.children,
    (c) => c.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META)$/.test(c.tagName),
  );
}

/**
 * Whether siblings are laid out side by side.
 *
 * Measured from the rendered boxes rather than read off `display`/
 * `flex-direction`: grid, inline-block, floats and wrapped flex rows all lay out
 * horizontally without saying so in any single property, and the drop indicator
 * has to match what the user actually sees.
 */
function isHorizontal(sibs) {
  if (sibs.length < 2) return false;
  let dx = 0;
  let dy = 0;
  for (let i = 1; i < sibs.length; i++) {
    const a = sibs[i - 1].getBoundingClientRect();
    const b = sibs[i].getBoundingClientRect();
    dx += Math.abs((b.left + b.width / 2) - (a.left + a.width / 2));
    dy += Math.abs((b.top + b.height / 2) - (a.top + a.height / 2));
  }
  return dx > dy;
}

function hideLine(st) {
  st.line.style.display = 'none';
}

function showLine(st, rect, placement, horizontal) {
  const s = st.line.style;
  s.display = 'block';
  s.borderTop = 'none';
  s.borderLeft = 'none';
  s.boxShadow = '0 0 0 1px rgba(255,255,255,.65)';
  if (horizontal) {
    s.left = px((placement === 'before' ? rect.left : rect.right) - 1);
    s.top = px(rect.top);
    s.width = '0';
    s.height = px(rect.height);
    s.borderLeft = `2px solid ${ACCENT_LINE}`;
  } else {
    s.left = px(rect.left);
    s.top = px((placement === 'before' ? rect.top : rect.bottom) - 1);
    s.width = px(rect.width);
    s.height = '0';
    s.borderTop = `2px solid ${ACCENT_LINE}`;
  }
}

function bindGrip(doc, host) {
  const st = host.__uichBH;
  if (st.bound) return;
  st.bound = true;

  const win = doc.defaultView || window;
  const { grip } = st;

  const endDrag = (commit) => {
    if (!st.dragging) return;
    st.dragging = false;
    grip.classList.remove('is-dragging');
    hideLine(st);
    detach();
    try { if (st.pointerId != null) grip.releasePointerCapture(st.pointerId); } catch (_) { /* already gone */ }
    st.pointerId = null;
    if (st.prevUserSelect !== undefined) {
      const b = doc.body;
      if (b) b.style.userSelect = st.prevUserSelect;
      st.prevUserSelect = undefined;
    }
    const drop = st.drop;
    st.drop = null;
    if (commit && drop && drop.node && drop.node !== st.el && typeof st.opts.onMove === 'function') {
      st.opts.onMove(st.el, drop.node, drop.placement);
    }
  };

  const onMove = (ev) => {
    if (!st.dragging) return;
    // Elementor and plenty of themes install their own capture-phase pointer
    // handlers; claiming the event here keeps the page from reacting to a drag.
    ev.preventDefault();
    ev.stopPropagation();

    const x = ev.clientX;
    const y = ev.clientY;
    const sibs = st.siblings;
    let hit = null;

    for (let i = 0; i < sibs.length; i++) {
      const rr = sibs[i].getBoundingClientRect();
      if (x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom) { hit = { node: sibs[i], rect: rr }; break; }
    }
    if (!hit) {
      // Outside every sibling (gaps, margins, past the last one), fall back to
      // the nearest, so the indicator never blanks out mid-drag.
      let bestD = Infinity;
      for (let i = 0; i < sibs.length; i++) {
        const rr = sibs[i].getBoundingClientRect();
        const d = st.horizontal
          ? Math.abs((rr.left + rr.width / 2) - x)
          : Math.abs((rr.top + rr.height / 2) - y);
        if (d < bestD) { bestD = d; hit = { node: sibs[i], rect: rr }; }
      }
    }
    if (!hit) { st.drop = null; hideLine(st); return; }

    const rr = hit.rect;
    const ratio = st.horizontal
      ? (x - rr.left) / (rr.width || 1)
      : (y - rr.top) / (rr.height || 1);
    const placement = ratio < 0.5 ? 'before' : 'after';
    st.drop = { node: hit.node, placement };
    showLine(st, rr, placement, st.horizontal);
  };

  const onUp = (ev) => {
    if (!st.dragging) return;
    if (ev && ev.preventDefault) ev.preventDefault();
    if (ev && ev.stopPropagation) ev.stopPropagation();
    endDrag(true);
  };

  const onKey = (ev) => { if (ev.key === 'Escape') endDrag(false); };

  // Documents to listen on: the element's own, plus the top document when the
  // canvas is an iframe (the editor) so releasing the button outside the frame
  // still ends the drag instead of leaving it stuck.
  const docs = [doc];
  try {
    const topDoc = win.top && win.top !== win ? win.top.document : null;
    if (topDoc && topDoc !== doc) docs.push(topDoc);
  } catch (_) { /* cross-origin, the local doc is enough */ }

  function attach() {
    docs.forEach((d, i) => {
      try {
        // Capture phase: a target-phase listener gets swallowed by the editor's
        // own capture handlers, which is why the first version of this drag
        // moved nothing at all.
        if (i === 0) d.addEventListener('pointermove', onMove, true);
        d.addEventListener('pointerup', onUp, true);
        d.addEventListener('pointercancel', onUp, true);
        d.addEventListener('keydown', onKey, true);
      } catch (_) { /* noop */ }
    });
  }
  function detach() {
    docs.forEach((d, i) => {
      try {
        if (i === 0) d.removeEventListener('pointermove', onMove, true);
        d.removeEventListener('pointerup', onUp, true);
        d.removeEventListener('pointercancel', onUp, true);
        d.removeEventListener('keydown', onKey, true);
      } catch (_) { /* noop */ }
    });
  }
  st.detach = detach;

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const el = st.el;
    if (!el || !el.parentElement) return;
    if (st.opts.canMove === false) return;
    const sibs = siblingsOf(el);
    if (sibs.length < 2) return; // nothing to reorder against

    e.preventDefault();
    e.stopPropagation();
    st.dragging = true;
    st.drop = null;
    st.siblings = sibs;
    st.horizontal = isHorizontal(sibs);
    st.pointerId = e.pointerId;
    grip.classList.add('is-dragging');
    if (doc.body) {
      st.prevUserSelect = doc.body.style.userSelect;
      doc.body.style.userSelect = 'none';
    }
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* not fatal */ }
    attach();
  }, true);
}

/**
 * Position the handle bar over `el`, wiring `opts.onMove(dragEl, dropEl,
 * placement)` for the grip. A no-op while a drag is in flight, so the
 * decorator's scroll/resize redraws can't move the bar out from under the
 * pointer.
 *
 * @param {Document} doc  document that hosts the element
 * @param {Element}  el   the selected element
 * @param {{onMove?:Function, items?:Array}} opts  `items` renders extra toolbar
 *   buttons after the grip: `{ id, title, svg, onClick(el), active }`.
 */
/**
 * Re-measure and reposition the bar once, for a caller that just changed its
 * contents.
 *
 * Deliberately a one-shot call rather than a ResizeObserver on the bar. Observing
 * it fed straight back into itself: a redraw runs clipHostToPanel, which resizes
 * the HOST, which changes the width available to the bar, which fires the
 * observer, which redraws. The main thread never came back, scrolling kept
 * working (the compositor owns that) while every click died, which is exactly
 * how that loop presents.
 */
/**
 * Place the bar over a rect. Pure layout, it must never publish the slot.
 *
 * Splitting this out is what fixes React's "Cannot update a component while
 * rendering a different component": the re-measure below runs from a layout
 * effect, and going through drawBoxHandles took setSlot() with it, so the store
 * notified its subscriber mid-commit while the Inspector subtree was still
 * rendering.
 */
function positionBar(doc, host, r) {
  const st = host.__uichBH;
  const win = doc.defaultView || window;
  // clipHostToPanel can shift the host's own left edge (panel docked LEFT). The
  // bar is absolutely positioned INSIDE the host, so viewport coordinates have
  // to be rebased by that shift or the bar lands one panel-width too far right.
  const hostLeft = parseFloat(host.style.left) || 0;
  const bw = st.bar.offsetWidth || 26;
  const bh = st.bar.offsetHeight || 26;
  const vw = win.innerWidth || (doc.documentElement && doc.documentElement.clientWidth) || 0;

  // The WordPress admin bar is FIXED over the top of the viewport on the front
  // end, so clamping to y=2 slid the toolbar underneath it and clipped it. Treat
  // the bar's height as the ceiling instead. Elementor's editor iframe carries
  // no admin bar, so the class check keeps this to the surfaces that need it.
  // Heights mirror WP core's own breakpoint (32px, 46px at <=782px), the same
  // pair composer-dock.css uses to offset the docked panel.
  const adminBarH = (doc.body && doc.body.classList.contains('admin-bar'))
    ? ((win.innerWidth || 0) <= 782 ? 46 : 32)
    : 0;
  const minTop = adminBarH + 2;

  // Vertical placement: above the selection by preference, BELOW it when there
  // isn't room above. It used to tuck the bar inside the element instead
  // (`r.top + 2`), which parked a ~75px toolbar squarely on top of the very
  // thing you had just selected — worst for the short elements near the top of
  // a page that need the bar most.
  //
  // Only when neither side can hold the bar (an element taller than the
  // viewport, or one sandwiched against both edges) do we overlap at all, and
  // then we take the roomier side so the bar covers as little as it can.
  const GAP = 6;
  const vh = win.innerHeight || (doc.documentElement && doc.documentElement.clientHeight) || 0;
  const maxBottom = vh ? vh - 4 : Infinity;
  const roomAbove = r.top - minTop;
  const roomBelow = maxBottom - r.bottom;
  const need = bh + GAP;

  let top;
  if (roomAbove >= need) {
    top = r.top - bh - GAP;
  } else if (roomBelow >= need) {
    top = r.bottom + GAP;
  } else if (roomAbove >= roomBelow) {
    top = minTop;
  } else {
    top = Math.max(minTop, maxBottom - bh);
  }

  // Horizontal placement. The bar is LEFT-anchored to the element by default,
  // which is right for anything in the left half of the canvas.
  //
  // It used to be left-anchored and then hard-clamped to the viewport, and for an
  // element near the right edge that read as broken: the clamp slid the bar's
  // left edge back to `vw - bw`, so a wide bar ended up hanging off the right of
  // the canvas AND visually detached from the element it belongs to — parked to
  // the element's left with its far end past the content box.
  //
  // So when left-anchoring would overflow, anchor the bar's RIGHT edge to the
  // element's right edge instead: the bar opens leftward out of the element's
  // right corner and stays attached to it. Only if that ALSO does not fit (an
  // element narrower than the bar, hard against the right edge) do we fall back
  // to clamping, which is the old behaviour and the best available.
  const EDGE = 4;              // keep this far from the canvas edges
  const maxX = vw ? vw - EDGE : Infinity;
  let left = r.left;
  if (left + bw > maxX) {
    left = r.right - bw;       // right-anchored to the element
    if (left + bw > maxX) left = maxX - bw;
  }
  if (left < EDGE) left = EDGE;
  st.bar.style.left = px(left - hostLeft);
  st.bar.style.top = px(top);
}

export function refreshHandles() {
  const list = typeof document !== 'undefined' ? [document] : [];
  try {
    for (const f of document.querySelectorAll('iframe')) {
      let d = null;
      try { d = f.contentDocument; } catch (_) { d = null; }
      if (d) list.push(d);
    }
  } catch (_) { /* noop */ }
  for (const d of list) {
    const host = d.getElementById && d.getElementById(HOST_ID);
    const st = host && host.__uichBH;
    if (st && st.el && !st.dragging && host.style.visibility === 'visible') {
      try {
        const r = st.el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) { positionBar(d, host, r); positionPadEdges(d, host, r); }
      } catch (_) { /* noop */ }
    }
  }
}

export function drawBoxHandles(doc, el, opts) {
  if (!doc || !el || !el.getBoundingClientRect) return;
  const host = ensureHost(doc);
  const st = host.__uichBH;
  st.opts = opts || {};
  // Role gate re-applied each draw (see setBoxToolbarAI).
  if (st.ai) st.ai.classList.toggle('is-off', !aiEnabled);
  if (st.dragging) return;

  const win = doc.defaultView || window;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) {
    host.style.visibility = 'hidden';
    return;
  }

  const elChanged = st.el !== el;
  st.el = el;
  // Reordering inside a loop rewrites the TEMPLATE, i.e. every repeat, so the
  // grip goes unavailable there rather than the whole toolbar disappearing.
  // The other controls (typography, and whatever follows) are perfectly valid
  // on a loop element, and a toolbar that vanishes teaches the user nothing.
  // Reordering inside a loop rewrites the TEMPLATE, i.e. every repeat, so the
  // grip goes unavailable there rather than the whole toolbar disappearing.
  // The other controls (typography, and whatever follows) are perfectly valid
  // on a loop element, and a toolbar that vanishes teaches the user nothing.
  const canMove = st.opts.canMove !== false;
  st.grip.classList.toggle('is-off', !canMove);
  st.grip.title = canMove ? 'Drag to move' : 'Elements inside a loop cannot be reordered here';
  setSlot({ doc, node: st.slotEl });
  renderItems(doc, st, st.opts.items);
  clipHostToPanel(doc, win, host, BASE_Z);
  // `visibility`, never `display:none`, a display-none bar measures 0×0, so the
  // very first placement after a selection lands in the wrong spot.
  host.style.visibility = 'visible';
  // Replay the entrance for a DIFFERENT element, synchronously. Nothing depends
  // on this line succeeding: skip it and the bar just does not re-animate, which
  // is the correct failure mode for decoration.
  if (elChanged) {
    try {
      st.bar.style.animation = 'none';
      void st.bar.offsetWidth; // force reflow so the restart takes
      st.bar.style.animation = '';
    } catch (_) { /* decoration only */ }
  }
  bindGrip(doc, host);
  bindPaddingEdges(doc, host);

  positionBar(doc, host, r);
  positionPadEdges(doc, host, r);
}

/** Hide the handle layer and abandon any drag in progress. */
export function clearBoxHandles(doc) {
  const host = doc && doc.getElementById && doc.getElementById(HOST_ID);
  const st = host && host.__uichBH;
  if (!st) return;
  if (st.dragging) {
    st.dragging = false;
    st.drop = null;
    if (typeof st.detach === 'function') st.detach();
    st.grip.classList.remove('is-dragging');
  }
  hideLine(st);
  st.el = null;
  setSlot(null);
  host.style.visibility = 'hidden';
}
