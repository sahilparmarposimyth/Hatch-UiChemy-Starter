// Typography controls for the on-canvas floating toolbar.
//
// Rendered from INSIDE the Inspector and portalled into the handle layer's slot
// (composer-box-handles.js). That placement is the whole point: `ctx` carries
// the Inspector's own cascade/scope/unit helpers, so these controls read the
// value the panel reads and write through the funnel the panel writes through.
// There is no second source of truth to keep in step, change the font size
// here and the panel's field updates because it IS the same field.
//
// The controls themselves are PropField, exactly as the panel renders them, so
// units, global-token links, inherited placeholders and per-breakpoint
// ownership all behave identically. Only the labels are dropped (no room in a
// floating bar); each cell carries the property name as a tooltip instead.

import React from 'react';
import { createPortal } from 'react-dom';
import { SCHEMA } from './composer-schema';
import { PropField } from './composer-fields';
import { I } from './composer-icons';
import { subscribeHandleSlot, getHandleSlot, refreshHandles } from './composer-box-handles';
import { ensurePortalRoot } from './components/ui/portal-context';

/**
 * The Elementor editor's own light/dark UI theme, or null when we are not
 * inside it (front end, Gutenberg, cross-origin).
 *
 * The toolbar renders in the PREVIEW iframe, which Elementor only ever loads
 * the light theme into, so there is no signal to read there. The signal lives
 * in the EDITOR (top) window, which enqueues BOTH theme stylesheets and marks
 * the inactive one `media="none"` (explicit light/dark) or gives both a
 * `prefers-color-scheme` media query (the "auto" preference). WordPress appends
 * `-css` to a style handle, so the links are `#e-theme-ui-{light,dark}-css`.
 * Editor and preview are same-origin, so `window.top` is reachable.
 */
function detectElementorEditorTheme() {
  try {
    const topWin = window.top || window;
    const topDoc = topWin.document;
    if (!topDoc || !topDoc.getElementById) return null;
    // null = link absent · false = present but inactive · true = active now.
    const linkActive = (id) => {
      const el = topDoc.getElementById(id);
      if (!el) return null;
      const media = String(el.media || 'all').trim().toLowerCase();
      if (media === 'none') return false;
      if (media === '' || media === 'all') return true;
      try { return !!topWin.matchMedia(media).matches; } catch (_) { return false; }
    };
    const light = linkActive('e-theme-ui-light-css');
    const dark = linkActive('e-theme-ui-dark-css');
    if (light === null && dark === null) return null; // not the Elementor editor
    if (dark && !light) return 'dark';
    if (light && !dark) return 'light';
    // Ambiguous (auto with both/neither matching) → fall back to OS preference.
    try { return topWin.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { /* noop */ }
    return null;
  } catch (_) {
    return null; // cross-origin or no top window
  }
}

/**
 * Subscribe to the editor theme so the toolbar re-themes live when the user
 * switches Elementor's UI theme (which swaps the links' `media` attribute) or
 * the OS scheme changes under an "auto" preference, no reload, no stale bar.
 */
function useElementorEditorTheme() {
  const subscribe = React.useCallback((onChange) => {
    const cleanups = [];
    try {
      const topWin = window.top || window;
      const topDoc = topWin.document;
      if (topDoc) {
        const obs = new MutationObserver(onChange);
        for (const id of ['e-theme-ui-light-css', 'e-theme-ui-dark-css']) {
          const el = topDoc.getElementById(id);
          if (el) obs.observe(el, { attributes: true, attributeFilter: ['media'] });
        }
        // The links may be (re)inserted after this subscribes; watching head
        // childList catches that without polling.
        if (topDoc.head) obs.observe(topDoc.head, { childList: true });
        cleanups.push(() => obs.disconnect());
      }
      const mq = (topWin.matchMedia && topWin.matchMedia('(prefers-color-scheme: dark)')) || null;
      if (mq) {
        if (mq.addEventListener) { mq.addEventListener('change', onChange); cleanups.push(() => mq.removeEventListener('change', onChange)); }
        else if (mq.addListener) { mq.addListener(onChange); cleanups.push(() => mq.removeListener(onChange)); }
      }
    } catch (_) { /* cross-origin / no top window, snapshot stays null */ }
    return () => { for (const fn of cleanups) { try { fn(); } catch (_) { /* noop */ } } };
  }, []);
  return React.useSyncExternalStore(subscribe, detectElementorEditorTheme, () => null);
}

// Shown when a property has no value anywhere in the cascade. PropField already
// prefers an inherited value as the placeholder; this is the last fallback, so
// an unset field reads as "Size" rather than as an empty box.
const HINTS = {
  fontFamily: 'Font',
  fontSize: 'Size',
  fontWeight: 'Weight',
  // Short on purpose. These are placeholders inside a ~70px cell that also holds
  // a unit chip and, for line height, a leading glyph — "Line height" truncated
  // to "Line h…", which reads as broken rather than as a hint. "Auto" is both
  // shorter and truer: an unset line height IS the inherited/normal one.
  lineHeight: 'Auto',
};

// One control per group: a hairline between every field, which keeps a bar this
// wide readable, without them the controls run together into one grey smear.
const BAR_GROUPS = [
  ['fontFamily'],
  ['fontSize'],
  ['lineHeight'],
  ['textAlign'],
  ['textColor'],
];

/**
 * Give every part of the toolbar its own name.
 *
 * The controls come from PropField, which is shared with the panel and must not
 * grow toolbar-specific classes of its own. Without a naming layer the
 * stylesheet had to address parts structurally, `.pf-input-main > div >
 * button`, `[data-k="fontSize"] button`, `.sw`, `.bg-background`, and those
 * selectors overlap: the rule written for the unit chip also caught the select's
 * caret, and a rule for one cell's box caught another's. Styling one thing moved
 * something else, every time.
 *
 * So the markup is named here, once, and the stylesheet addresses nothing but
 * these names. Idempotent by construction, `classList.add` for a class that is
 * already present mutates nothing, which is what lets a MutationObserver drive
 * this without looping.
 */
function stampClasses(root) {
  if (!root) return;
  for (const cell of root.querySelectorAll('.uich-tb-cell')) {
    const k = cell.dataset.k;
    // PropField wraps most bodies in .pf-input-main, but the types listed in its
    // GLOBALS_PICKER_SKIP set (seg-align among them) render straight into
    // .prop-input-stack. Resolving only the first shape left the align control
    // permanently unnamed, and therefore unstyled.
    const box = cell.querySelector('.pf-input-main > *')
      || cell.querySelector('.prop-input-stack > *');
    if (!box) continue;
    box.classList.add('uich-tb-box');

    if (k === 'fontFamily' || k === 'fontWeight') {
      box.classList.add('uich-tb-select');
      const value = box.querySelector('input');
      if (value) value.classList.add('uich-tb-value');
      const caret = box.querySelector('button');
      if (caret) caret.classList.add('uich-tb-caret');
      const menu = box.querySelector(':scope > div');
      if (menu) {
        menu.classList.add('uich-tb-menu');
        for (const row of menu.querySelectorAll('button')) {
          row.classList.add('uich-tb-menu-row');
        }
      }
    }

    if (k === 'fontSize' || k === 'lineHeight') {
      box.classList.add('uich-tb-length');
      const value = box.querySelector('input');
      if (value) value.classList.add('uich-tb-value');
      // UnitPill wraps its button in a span, so the chip is a GRANDchild of the
      // field box, querying direct children found nothing and the chip never
      // got its fill. A LengthInput has exactly one button, so searching at any
      // depth is unambiguous.
      const unit = box.querySelector('button');
      if (unit) {
        unit.classList.add('uich-tb-unit');
        const wrap = unit.parentElement;
        if (wrap && wrap !== box) wrap.classList.add('uich-tb-unit-wrap');
      }
    }

    if (k === 'textAlign') {
      box.classList.add('uich-tb-seg');
      for (const b of box.querySelectorAll('button')) {
        b.classList.add('uich-tb-seg-btn');
      }
    }

    if (k === 'textColor') {
      box.classList.add('uich-tb-color');
      const swatch = box.querySelector('.sw');
      if (swatch) swatch.classList.add('uich-tb-swatch');
      for (const svg of box.querySelectorAll(':scope > svg')) {
        svg.classList.add('uich-tb-caret-icon');
      }
      // Everything else in this cell, the hex field, the linked-global name –
      // is panel furniture. Left visible it stretches the cell, and a cell wide
      // enough to hold it makes the whole toolbar span the viewport.
      for (const n of box.children) {
        if (n.contains(swatch) || n.tagName === 'SVG') continue;
        n.classList.add('uich-tb-off');
      }
    }

    // Globals picker. PropField already renders one in EVERY cell — the bar
    // hides them all, because a picker on all six controls doubled the toolbar's
    // width. Font family and colour are the two properties whose value is most
    // often a global token, so those two get it back as a chip on the end of the
    // field, styled like the unit chip. Note it lives OUTSIDE `box` (it is
    // PropField's sibling to `.pf-input-main`), hence the query from `cell`.
    //
    // The picker renders nothing at all when no globals exist, so the chip
    // simply is not there until the user has created some.
    if (k === 'fontFamily' || k === 'textColor') {
      const gp = cell.querySelector('.pr-gpick');
      if (gp) {
        gp.classList.add('uich-tb-global');
        const btn = gp.querySelector('.pr-gpick-btn');
        if (btn) btn.classList.add('uich-tb-global-btn');

        // Its popover has to be named part by part, and every one of those parts
        // styled from scratch. The picker dresses itself in Tailwind utilities
        // (bg-popover, border, truncate, font-mono, the paddings) which live in
        // composer.css — a stylesheet loaded into whichever document hosts the
        // PANEL, not necessarily the one this toolbar renders into. In the
        // Elementor editor it is not, so the popover arrived essentially
        // unstyled. Same reason .uich-tb-menu declares its own position and
        // height cap.
        const pop = gp.querySelector('.pr-gpick-pop');
        if (pop) {
          pop.classList.add('uich-tb-gmenu');
          const search = pop.firstElementChild;
          if (search) search.classList.add('uich-tb-gsearch');
          const input = pop.querySelector('input');
          if (input) input.classList.add('uich-tb-gsearch-input');
          const list = pop.children[1];
          if (list) {
            list.classList.add('uich-tb-glist');
            for (const grp of list.children) {
              // Within a group the FIRST button is its header, the rest are its
              // values. Both are plain buttons, so position is the only thing
              // telling them apart.
              const rows = grp.querySelectorAll(':scope > button');
              rows.forEach((row, i) => {
                if (i === 0) {
                  row.classList.add('uich-tb-ggroup');
                  const head = row.children;
                  if (head.length >= 3) {
                    head[1].classList.add('uich-tb-ggroup-name');
                    head[2].classList.add('uich-tb-ggroup-count');
                  }
                  return;
                }
                row.classList.add('uich-tb-gitem');
                // Children are [swatch?] name value — counted from the END so the
                // optional colour swatch cannot shift the mapping.
                const kids = row.children;
                if (kids.length >= 2) {
                  kids[kids.length - 1].classList.add('uich-tb-gitem-val');
                  kids[kids.length - 2].classList.add('uich-tb-gitem-name');
                }
                if (kids.length >= 3) kids[0].classList.add('uich-tb-gitem-sw');
              });
            }
          }
        }
      }
    }
  }
}

// Dynamic-tag (⚡) control for the floating bar. Standalone (NOT a PropField),
// and it calls window.UichDD.ui.openValue directly rather than importing the
// panel's DynamicConnector — importing it would be a circular dependency, since
// the Inspector imports THIS module. Text-bearing elements only for now (image
// dynamic src is a follow-up). Picking binds the element's text to the chosen
// `{{ … }}` token; the accent `is-bound` state shows a value is already set so
// the current selection is visible at a glance.
const DYN_MEDIA_TAGS = ['img', 'svg', 'picture', 'video', 'audio', 'iframe', 'canvas', 'input', 'br', 'hr', 'source', 'track'];

// A readable name for a bound dynamic token ({{ post.title }} → "Post Title").
// Uses the dynamic system's own resolver if it ever exposes one; otherwise falls
// back to prettifying the token path so it always yields something meaningful.
function friendlyDynLabel(token) {
  const t = String(token || '').trim();
  if (!t) return 'value';
  try {
    const dd = typeof window !== 'undefined' ? window.UichDD : null;
    if (dd) {
      for (const fn of ['labelFor', 'label']) {
        if (typeof dd[fn] === 'function') { const l = dd[fn](t); if (l) return String(l); }
      }
      if (dd.ui && typeof dd.ui.labelFor === 'function') { const l = dd.ui.labelFor(t); if (l) return String(l); }
    }
  } catch (_) { /* resolver optional */ }
  return t.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function DynTagCell({ ctx }) {
  const el = ctx && ctx.element;
  const se = ctx && ctx.selectedEntry;
  const setElement = ctx && ctx.setElement;
  if (!el || !se || typeof setElement !== 'function') return null;
  const tag = String(se.tag || '').toLowerCase();
  if (DYN_MEDIA_TAGS.indexOf(tag) !== -1) return null;
  const value = typeof el.text === 'string' ? el.text : '';
  const bound = value.indexOf('{{') !== -1;
  // The bound token + its friendly name, so the tooltip can say WHAT is connected
  // ("Dynamic: Post Title · click to change") instead of a generic label.
  const dynToken = bound ? ((value.match(/\{\{\s*([\s\S]*?)\s*\}\}/) || [])[1] || '').trim() : '';
  const dynLabel = bound ? friendlyDynLabel(dynToken) : '';
  const dynTitle = bound ? `Dynamic: ${dynLabel} · click to change` : 'Insert dynamic value';
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dd = typeof window !== 'undefined' ? window.UichDD : null;
    if (!dd || !dd.ui || typeof dd.ui.openValue !== 'function') return;
    let anchor;
    try {
      const r = e.currentTarget.getBoundingClientRect();
      anchor = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    } catch (_) { anchor = undefined; }
    dd.ui.openValue({
      context: ['post', 'product', 'user', 'site', 'request'],
      anchor,
      valueType: 'text',
      onInsert: (t) => {
        let expr = String(t == null ? '' : t).trim();
        if (/^\{\{[\s\S]*\}\}$/.test(expr)) expr = expr.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
        setElement({ ...el, text: '{{ ' + expr + ' }}' });
      },
    });
  };
  return (
    <>
      <div className="uich-tb-sep" aria-hidden="true" />
      {/* data-tip, not title: the bar draws its own tooltip (see the [data-tip]
          block in composer-box-handles' stylesheet). data-tip-end right-aligns
          it because this is the last cell in the bar, and a centred tip on it
          ran off the right edge. Keeping `title` as well would give two
          tooltips, the browser's arriving a second after ours. */}
      <div className="uich-tb-cell" data-k="dynamic" data-tip={dynTitle} data-tip-end="">
        {/* Named, not inline-styled. Inline CSS cannot express :hover, so this
            was the only button in the bar with no hover state, and `inherit`
            gave it the row's body ink where every other icon uses the muted
            grey. Geometry, both hover states and the bound state now come from
            composer-box-handles' stylesheet, with the rest of the controls. */}
        <button
          type="button"
          className={`uich-tb-dyn${bound ? ' is-bound' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={open}
          aria-label={bound ? `Dynamic value: ${dynLabel}` : 'Insert dynamic value'}
          aria-pressed={bound}
        >
          <I.dynamic size={15} />
        </button>
      </div>
    </>
  );
}

export function CanvasTypographyBar({ ctx }) {
  const slot = React.useSyncExternalStore(subscribeHandleSlot, getHandleSlot, getHandleSlot);
  const rootRef = React.useRef(null);
  // The bar matches the ELEMENTOR EDITOR's own UI theme when we're inside it, so
  // a dark editor gets a dark bar regardless of the composer's own toggle. Only
  // outside Elementor (front end / Gutenberg, where there is no editor theme to
  // read) does it fall back to the composer's `ctx.theme`. The palette swap
  // lives in composer-box-handles' stylesheet, gated on `.uich-bh-dark`.
  const editorTheme = useElementorEditorTheme();
  const dark = editorTheme ? editorTheme === 'dark' : (!!ctx && ctx.theme === 'dark');
  // The SHELL's answer, kept in state so the CONTROLS can render with it too.
  //
  // These are two different questions and they were being answered twice, from
  // two different sources. The layout effect below resolves the real one — the
  // panel's own data-uich-composer-theme, falling back to `dark` — and stamped
  // it on the bar; the controls' Tailwind scope was left rendering from raw
  // `dark`, i.e. the ELEMENTOR EDITOR's theme, with the skin hard-coded to
  // elementor. Whenever the two disagreed (composer set to dark, editor still
  // light) the result was exactly the reported bug: a dark bar shell wrapped
  // around light controls, a white font dropdown hanging off it, and the field
  // turning white the moment it took focus. One resolution, used by both.
  const [resolved, setResolved] = React.useState({ skin: 'elementor', dark: false });

  const groups = React.useMemo(() => {
    const byKey = new Map((SCHEMA.typography || []).map((p) => [p.k, p]));
    return BAR_GROUPS
      .map((keys) => keys
        .map((k) => {
          const def = byKey.get(k);
          if (!def) return null;
          return HINTS[k] ? { ...def, placeholder: HINTS[k] } : def;
        })
        .filter(Boolean))
      .filter((g) => g.length);
  }, []);

  // Name the markup after every render, and again whenever the controls rebuild
  // themselves. A dropdown opening is internal state inside PropField's own
  // control, it never re-renders this component, so a render-time pass alone
  // would leave the options menu unnamed, and therefore unstyled.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let obs = null;
    // Disconnect around every pass. Stamping writes classes, and an observer
    // watching its own writes is one bad guard away from spinning the main
    // thread, which presents as a page that still scrolls (the compositor owns
    // that) while every click dies.
    const run = () => {
      if (obs) obs.disconnect();
      try {
        stampClasses(root);
      } finally {
        if (obs) {
          try { obs.observe(root, { childList: true, subtree: true }); } catch (_) { /* noop */ }
        }
      }
      // The controls portal in one commit AFTER the bar's first measurement, so
      // the bar has to be told to re-measure once they exist. One explicit call,
      // never an observer on the bar itself: that fed back into its own redraw.
      refreshHandles();
    };
    try {
      obs = new MutationObserver(run);
    } catch (_) { /* stamping still runs, just once */ }
    run();
    // `attributes` is deliberately NOT observed. Active states are read straight
    // off the shared control's own marker classes in CSS, so there is nothing to
    // mirror, and watching class changes across a 50-row dropdown was a lot of
    // churn for no gain.
    return () => { if (obs) obs.disconnect(); };
  }, [slot, ctx]);

  // Mirror the composer theme onto the bar SHELL, the card, grip and dividers
  // live outside `.uich-tb`, so a class on the portal root alone would leave the
  // shell light in dark mode. `.uich-bh-dark` on the bar scopes both.
  React.useLayoutEffect(() => {
    // Found through the SLOT, not through this component's own portal root.
    //
    // rootRef only exists once the controls have rendered into the bar, and the
    // bar is drawn a commit earlier than that — so keying the theme off it left
    // the shell painting in the light fallbacks for a frame on every selection.
    // Worse, the two cases where the controls never render at all — no `ctx`,
    // or the silent error boundary around this component tripping — left a bar
    // that was permanently light inside a dark editor, which is exactly the
    // "toolbar didn't go dark" report. The slot node comes from the handle
    // layer's own store and is there as soon as the bar is, so the shell is
    // themed whether or not anything portals into it.
    const anchor = (slot && slot.node) || rootRef.current;
    const bar = anchor && anchor.closest && anchor.closest('.uich-bh-bar');
    if (!bar) return;
    // Set after the attributes below, from the same resolved value.
    // Skin + theme as ATTRIBUTES, because that is how the palette is keyed.
    // composer-skin-tokens.css declares --panel-*, --text-* and --accent-* on
    // [data-uich-composer-skin]/[data-uich-composer-theme], and the canvas
    // bundle loads that same file — so stamping them here is what makes the
    // toolbar resolve the exact colours the panel and dock are using.
    //
    // Read off the PANEL, not guessed. applyTheme/applySkin in composer-app
    // write these onto the panel host and shell (and body), so copying them is
    // what guarantees the three surfaces move together: flip the composer to
    // dark and the toolbar goes dark with it. Reading Elementor's own editor
    // theme instead — which is what this did — meant a dark composer could sit
    // above a light toolbar whenever the two disagreed.
    let skin = null;
    let themeAttr = null;
    try {
      const docs = [document];
      const topDoc = (window.top || window).document;
      if (topDoc && topDoc !== document) docs.push(topDoc);
      for (const d of docs) {
        const src = d.querySelector('[data-uich-composer-theme], [data-uich-composer-skin]');
        if (!src) continue;
        skin = skin || src.getAttribute('data-uich-composer-skin');
        themeAttr = themeAttr || src.getAttribute('data-uich-composer-theme');
        if (skin && themeAttr) break;
      }
    } catch (_) { /* cross-origin: fall through to the detected values */ }
    const resolvedSkin = skin || 'elementor';
    bar.setAttribute('data-uich-composer-skin', resolvedSkin);
    // The panel's own setting wins; the Elementor editor theme is the fallback
    // for surfaces that have no panel to read (front end, Gutenberg).
    const resolvedDark = themeAttr ? themeAttr === 'dark' : dark;
    bar.setAttribute('data-uich-composer-theme', resolvedDark ? 'dark' : 'light');
    bar.classList.toggle('uich-bh-dark', resolvedDark);
    // Same values to the controls. Guarded so an unchanged theme cannot loop:
    // this effect runs on every Inspector render, and an unconditional setState
    // would schedule one of its own each time.
    setResolved((prev) => (
      prev.skin === resolvedSkin && prev.dark === resolvedDark
        ? prev
        : { skin: resolvedSkin, dark: resolvedDark }
    ));

    // The bar's SUB-dropdowns do not live in the bar.
    //
    // The unit chip's menu (px / em / rem / unitless — the one on Size and Line
    // Height) and the colour picker portal out to `.uich-portal-root`, a host
    // ensurePortalRoot() appends to the body of whichever document they render
    // in. Here that is the Elementor PREVIEW document, and nothing themed it:
    // composer-app's applyTheme/applySkin sync the portal root of the document
    // that hosts the PANEL, which in Elementor is the top editor document, not
    // this one. So the preview's portal root was created bare by the first
    // caller — no `dark`, no skin — and its menus resolved the default LIGHT
    // shadcn tokens: a white dropdown hanging off a dark toolbar, with light
    // hover fills inside it.
    //
    // Stamped from the same two values the bar itself just took, so the menu
    // cannot disagree with the surface it opens from, and re-run on every theme
    // change because the host is reused rather than rebuilt.
    try {
      ensurePortalRoot(
        bar.ownerDocument || document,
        resolvedDark ? 'dark' : 'light',
        skin || 'elementor',
      );
    } catch (_) { /* no body yet: the next draw stamps it */ }
    // `ctx` is in the dependency list because the value this effect actually
    // applies — themeAttr, read off the panel — is NOT one of the other two.
    // Inside Elementor `dark` tracks the EDITOR's theme and the panel's own
    // toggle wins over it, so flipping the composer between light and dark
    // changed nothing here: neither `slot` nor `dark` moved, the effect never
    // re-ran, and the bar stayed in the theme it was first drawn in until the
    // selection changed. `ctx` is a fresh object on every Inspector render,
    // which is exactly the signal wanted; the body is idempotent attribute
    // writes, so running it often costs nothing.
  }, [slot, dark, ctx]);

  if (!slot || !slot.node || !ctx) return null;

  return createPortal(
    // `uich-tw` scopes the design system the same way the panel host does –
    // without it these fields render unstyled, since the toolbar lives outside
    // the composer's own host element. `dark` + `skin-elementor` make any shared
    // control internals our stylesheet doesn't name resolve the Editor One dark
    // tokens, so nothing stays light-themed inside a dark bar.
    <div
      className={`uich-tw uich-tb${resolved.skin === 'brand' ? '' : ` skin-${resolved.skin}`}${resolved.dark ? ' dark' : ''}`}
      ref={rootRef}
    >
      {groups.map((group, gi) => (
        <React.Fragment key={group[0].k}>
          {gi > 0 && <div className="uich-tb-sep" aria-hidden="true" />}
          {group.map((prop) => (
            <div className="uich-tb-cell" data-k={prop.k} data-tip={prop.label} key={prop.k}>
              <PropField group="typography" prop={prop} ctx={ctx} />
            </div>
          ))}
        </React.Fragment>
      ))}
      <DynTagCell ctx={ctx} />
    </div>,
    slot.node,
  );
}
