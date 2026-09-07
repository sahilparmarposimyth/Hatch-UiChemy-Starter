// Framer-style box-model overlay for the on-canvas element picker/selector.
//
// Given a rendered element (inside the Elementor preview document), draws an
// absolutely-positioned overlay that visualises:
//   • the element outline,
//   • its PADDING as hatched bands (top/right/bottom/left) + numeric labels,
//   • the GAP between flex/grid children as hatched bands + a numeric label,
//   • a small label chip (tag + first meaningful class).
//
// The overlay host is a `position:fixed; inset:0` layer appended to the SAME
// document as the element, so `getBoundingClientRect()` (viewport-relative)
// coordinates line up 1:1 with no iframe translation. It is pointer-transparent
// so it never intercepts clicks. Call drawBoxOverlay() on hover/selection and
// clearBoxOverlay() to remove it.

const OVERLAY_ID = 'uich-box-overlay';

// Blue = padding; green = gap. A fine hatch rather than the old 5px/5px bands:
// wide stripes at .30 read as a solid wash over page content, which buries the
// design being measured. 1.5px lines every 6px keep the band legible as a
// measurement while the content stays readable through it.
// Lines only — the space BETWEEN the stripes is transparent. A tint there (it
// was .07) turned the band into a translucent panel over the page, which is the
// thing being measured; bare lines read as a measurement laid on top of the
// design rather than a wash covering it.
const PAD_HATCH =
  'repeating-linear-gradient(45deg, rgba(59,130,246,.32) 0, rgba(59,130,246,.32) 1.5px, transparent 1.5px, transparent 6px)';
const GAP_HATCH =
  'repeating-linear-gradient(45deg, rgba(16,185,129,.32) 0, rgba(16,185,129,.32) 1.5px, transparent 1.5px, transparent 6px)';
// Measurement labels follow the padding hue.
const ACCENT = 'rgba(59,130,246,.95)';
// Selection ring + selector chip (Framer-style). A saturated pink, deliberately
// NOT the Elementor accent: that pale pink already means "active control" on the
// canvas toolbar, and the ring has to stay legible over arbitrary page content.
const SELECT_INK = '#EC0868';
// Default stacking: high enough to sit above the previewed page content. When a
// docked composer panel shares this document (front-end preview), clipHostToPanel
// drops the host just below the panel so the grid renders BEHIND it, never on it.
const BASE_Z = 2147482000;

function ensureOverlay(doc) {
  let host = doc.getElementById(OVERLAY_ID);
  if (!host) {
    host = doc.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText =
      `position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;overflow:hidden;z-index:${BASE_Z};`;
    (doc.body || doc.documentElement).appendChild(host);
  }
  bindMediaModalGuard(doc, host);
  return host;
}

function bindMediaModalGuard(doc, host) {
  if (host.__uichMediaModalGuardBound) return;
  host.__uichMediaModalGuardBound = true;
  const sync = () => {
    host.style.display = doc.querySelector('.media-modal') ? 'none' : '';
  };
  try {
    const observer = new MutationObserver(sync);
    observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    sync();
  } catch (_) { /* noop */ }
}

// The docked composer panel lives in the SAME document as the element when we
// draw over the front-end preview (not the Elementor editor, where the element
// is inside the preview iframe). There, a full-viewport overlay would paint its
// hatched bands across the panel. Clip the host to the panel's edge so the
// overlay stays within the canvas area. No panel in this doc → no clipping.
const PANEL_SEL =
  '#uichemy-composer-floating-panel, .uichemy-composer-floating-panel, .uich-composer-host';

export function clipHostToPanel(doc, win, host, baseZ) {
  // Reset to the full viewport + default stacking first (dock side / width can
  // change, and the previous draw may have moved us behind a panel).
  host.style.left = '0';
  host.style.right = '0';
  host.style.zIndex = String(baseZ || BASE_Z);
  const vw = win.innerWidth || (doc.documentElement && doc.documentElement.clientWidth) || 0;
  const vh = win.innerHeight || (doc.documentElement && doc.documentElement.clientHeight) || 0;
  if (!vw || !vh) return;

  const directPanel = doc.getElementById('uichemy-composer-floating-panel')
    || doc.querySelector('.uichemy-composer-floating-panel');
  if (directPanel
      && directPanel.classList.contains('active')
      && !directPanel.classList.contains('uich-dock-slid')) {
    const pr = directPanel.getBoundingClientRect();
    if (pr.width > 0 && pr.height > 0) {
      const pz = parseInt(win.getComputedStyle(directPanel).zIndex, 10);
      if (!isNaN(pz)) host.style.zIndex = String(pz - 1);
      host.style.right = px(vw - pr.left);
      return;
    }
  }

  let list;
  try { list = Array.prototype.slice.call(doc.querySelectorAll(PANEL_SEL)); }
  catch (_) { return; }
  let best = null;
  let bestEl = null;
  for (let i = 0; i < list.length; i++) {
    // The canvas-toolbar host matches `.uich-composer-host` but is a
    // full-viewport overlay on the front end, never a docked panel.
    if (list[i].classList && list[i].classList.contains('uich-canvas-toolbar-host')) continue;
    const pr = list[i].getBoundingClientRect();
    // Skip small hosts (e.g. the floating canvas toolbar), the dock is tall.
    if (pr.width <= 0 || pr.height < vh * 0.5) continue;
    // Skip panels that sit (almost) fully OUTSIDE the viewport, the collapsed
    // drawer parks itself just past the right edge, and treating it as a
    // docked panel would clip the whole overlay down to a useless sliver
    // (host.right = vw - panel.left ≈ vw), hiding every band/label/chip.
    if (pr.left >= vw - 4 || pr.right <= 4) continue;
    // A docked side panel never spans (nearly) the whole viewport, anything
    // that wide is a wrapper/host element, and clipping to it would blank the
    // entire overlay.
    if (pr.width >= vw * 0.8) continue;
    const hugsRight = pr.right >= vw - 4;
    const hugsLeft  = pr.left <= 4;
    if (!hugsRight && !hugsLeft) continue;
    if (!best || pr.width > best.width) { best = { left: pr.left, right: pr.right, width: pr.width, hugsRight, hugsLeft }; bestEl = list[i]; }
  }
  if (!best) return;
  // Primary fix: drop the overlay just BEHIND the docked panel so its hatched
  // bands can never paint on top of it (the panel's z-index vastly exceeds the
  // overlay's default, so without this it always won). Clipping the host to the
  // panel edge stays as a belt-and-suspenders guard.
  if (bestEl) {
    const pz = parseInt(win.getComputedStyle(bestEl).zIndex, 10);
    if (!isNaN(pz)) host.style.zIndex = String(pz - 1);
  }
  if (best.hugsRight)      host.style.right = px(vw - best.left);
  else if (best.hugsLeft)  host.style.left  = px(best.right);
}

export function clearBoxOverlay(doc) {
  const host = doc && doc.getElementById && doc.getElementById(OVERLAY_ID);
  if (!host) return;
  // Fade the persistent ring out (keep the node for reuse) and reset its target
  // so the NEXT show snaps in rather than sliding from a stale position; clear
  // only the detail layer's contents.
  const ring = host.__uichRing;
  if (ring) { ring.style.transition = 'opacity .12s ease'; ring.style.opacity = '0'; }
  host.__uichRingEl = null;
  const detail = host.__uichDetail;
  if (detail) detail.textContent = '';
  // Legacy safety: if this host predates the ring/detail split, wipe it whole.
  if (!ring && !detail) host.textContent = '';
}

function px(n) { return `${Math.round(n * 100) / 100}px`; }

function bandEl(doc, left, top, w, h, fill) {
  if (w <= 0 || h <= 0) return null;
  const d = doc.createElement('div');
  d.style.cssText =
    `position:absolute;left:${px(left)};top:${px(top)};width:${px(w)};height:${px(h)};background:${fill};`;
  return d;
}

/**
 * Selector chip pinned under the ring's left edge — `h2.hero-title`, the same
 * name the panel's class row shows, so canvas and panel agree on what's
 * selected. Flips above the element when it would fall off the bottom.
 */
function selectorChipEl(doc, win, r, el) {
  const tag = (el.tagName || '').toLowerCase();
  const classes = (typeof el.className === 'string' ? el.className : '')
    .split(/\s+/)
    .filter(Boolean)
    // The builders' own runtime classes are noise here, not identity.
    .filter((c) => !/^(elementor|uich-bh|uich-tb)/.test(c))
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join('');
  const text = `${tag}${classes}`;
  if (!text) return null;

  const vh = win.innerHeight || 0;
  const below = r.top + r.height;
  const flip = vh && below + 18 > vh;
  const top = flip ? r.top - 18 : below;

  const d = doc.createElement('div');
  d.textContent = text;
  d.style.cssText =
    `position:absolute;left:${px(r.left)};top:${px(top)};`
    + 'font:600 10px/1.6 ui-sans-serif,system-ui,sans-serif;color:#fff;'
    + `background:${SELECT_INK};padding:1px 5px;white-space:nowrap;`
    + 'max-width:60vw;overflow:hidden;text-overflow:ellipsis;pointer-events:none;';
  return d;
}

function labelEl(doc, cx, cy, text) {
  const d = doc.createElement('div');
  d.textContent = String(text);
  d.style.cssText =
    `position:absolute;left:${px(cx)};top:${px(cy)};transform:translate(-50%,-50%);` +
    'font:600 10px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;background:' + ACCENT + ';' +
    'padding:1px 4px;border-radius:3px;white-space:nowrap;';
  return d;
}

// The dashed selection/hover ring is a PERSISTENT element (one per overlay
// host), NOT recreated each draw — so moving from one element to another can be
// a smooth CSS slide instead of an instant jump. The per-element detail (padding
// bands, gap bands, chip, value labels) still gets wiped + rebuilt each draw in a
// separate layer that carries no transition.
function ensureRing(doc, host) {
  let ring = host.__uichRing;
  if (ring && ring.parentNode === host) return ring;
  ring = doc.createElement('div');
  ring.style.cssText =
    `position:absolute;left:0;top:0;width:0;height:0;opacity:0;`
    + `outline:1px solid ${SELECT_INK};outline-offset:0;box-sizing:border-box;pointer-events:none;`
    + `box-shadow:0 0 0 2px rgba(255,255,255,0.9);`;
  host.__uichRing = ring;
  host.appendChild(ring);
  return ring;
}

function ensureDetailLayer(doc, host) {
  let layer = host.__uichDetail;
  if (layer && layer.parentNode === host) return layer;
  layer = doc.createElement('div');
  layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;';
  host.__uichDetail = layer;
  host.appendChild(layer);
  return layer;
}

// Snappy ease-out so a move reads as a quick SLIDE, not a slow balloon: position
// gets the full glide, width/height resolve a touch faster so the box doesn't
// visibly "grow into" a larger element.
const RING_SLIDE =
  'left .13s cubic-bezier(.22,1,.36,1), top .13s cubic-bezier(.22,1,.36,1), '
  + 'width .1s cubic-bezier(.22,1,.36,1), height .1s cubic-bezier(.22,1,.36,1), opacity .1s ease';

/**
 * Draw the box-model overlay for `el` into its owner document.
 * @param {Document} doc  document that hosts the element (preview iframe doc)
 * @param {Element}  el   the rendered element to decorate
 */
export function drawBoxOverlay(doc, el) {
  if (!doc || !el || !el.getBoundingClientRect) return;
  const win = doc.defaultView || window;
  const host = ensureOverlay(doc);
  clipHostToPanel(doc, win, host);

  const r = el.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return;

  // Persistent ring: slide it to the new element only when the TARGET element
  // actually changed (hover/select A → B). On a same-element redraw (scroll /
  // resize follow) or a first show from hidden, snap instantly — a position
  // transition there would visibly lag behind the scroll.
  const ring     = ensureRing(doc, host);
  const prevEl   = host.__uichRingEl || null;
  const wasHidden = ring.style.opacity !== '1';
  const animate  = !wasHidden && prevEl && prevEl !== el;
  ring.style.transition = animate ? RING_SLIDE : 'opacity .12s ease';
  ring.style.left = px(r.left);
  ring.style.top = px(r.top);
  ring.style.width = px(r.width);
  ring.style.height = px(r.height);
  ring.style.opacity = '1';
  host.__uichRingEl = el;

  // Per-element detail is rebuilt each draw in its own (transition-free) layer.
  const detail = ensureDetailLayer(doc, host);
  detail.textContent = '';
  const cs = win.getComputedStyle(el);
  const f = (v) => parseFloat(v) || 0;

  const pt = f(cs.paddingTop), pr = f(cs.paddingRight), pb = f(cs.paddingBottom), pl = f(cs.paddingLeft);
  const bt = f(cs.borderTopWidth), br = f(cs.borderRightWidth), bb = f(cs.borderBottomWidth), bl = f(cs.borderLeftWidth);

  const frag = doc.createDocumentFragment();

  // Selection ring + selector chip. These were dropped at one point as noise on
  // top of Elementor's own selection chrome; they're back by request, because
  // naming what is selected (`h2.hero-title`) is what the canvas was missing —
  // Elementor's outline says "something is selected", not WHICH rule you are
  // about to edit. The spacing overlay below is a separate inspection aid.
  // (Ring is the persistent element positioned above — not appended here.)
  const chip = selectorChipEl(doc, win, r, el);
  if (chip) frag.appendChild(chip);

  // Padding bands sit between the border box and the content box.
  const ix = r.left + bl, iy = r.top + bt;
  const iw = r.width - bl - br, ih = r.height - bt - bb;
  const bands = [
    bandEl(doc, ix, iy, iw, pt, PAD_HATCH),                       // top
    bandEl(doc, ix, iy + ih - pb, iw, pb, PAD_HATCH),             // bottom
    bandEl(doc, ix, iy + pt, pl, ih - pt - pb, PAD_HATCH),        // left
    bandEl(doc, ix + iw - pr, iy + pt, pr, ih - pt - pb, PAD_HATCH), // right
  ];
  bands.forEach((b) => b && frag.appendChild(b));

  // Padding value labels (only where there's room / a value).
  if (pt > 0) frag.appendChild(labelEl(doc, ix + iw / 2, iy + pt / 2, Math.round(pt)));
  if (pb > 0) frag.appendChild(labelEl(doc, ix + iw / 2, iy + ih - pb / 2, Math.round(pb)));
  if (pl > 0) frag.appendChild(labelEl(doc, ix + pl / 2, iy + ih / 2, Math.round(pl)));
  if (pr > 0) frag.appendChild(labelEl(doc, ix + iw - pr / 2, iy + ih / 2, Math.round(pr)));

  // Gap bands between flex/grid children.
  const disp = cs.display || '';
  if (disp.indexOf('flex') !== -1 || disp.indexOf('grid') !== -1) {
    const rowGap = f(cs.rowGap === 'normal' ? 0 : cs.rowGap);
    const colGap = f(cs.columnGap === 'normal' ? 0 : cs.columnGap);
    const kids = Array.prototype.slice.call(el.children)
      .map((k) => k.getBoundingClientRect())
      .filter((k) => k.width > 0 || k.height > 0);
    let gapLabelShown = false;
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1], b = kids[i];
      // bandEl returns null for zero/negative sizes (touching children, the
      // -1px tolerance, siblings with no cross-axis overlap e.g. wrapped flex
      // rows), guard like the padding bands do, or appendChild(null) throws.
      if (colGap > 0 && b.left >= a.right - 1) {
        const top = Math.max(a.top, b.top), bot = Math.min(a.bottom, b.bottom);
        const band = bandEl(doc, a.right, top, b.left - a.right, bot - top, GAP_HATCH);
        if (band) {
          frag.appendChild(band);
          if (!gapLabelShown) { frag.appendChild(labelEl(doc, (a.right + b.left) / 2, (top + bot) / 2, Math.round(colGap))); gapLabelShown = true; }
        }
      } else if (rowGap > 0 && b.top >= a.bottom - 1) {
        const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
        const band = bandEl(doc, left, a.bottom, right - left, b.top - a.bottom, GAP_HATCH);
        if (band) {
          frag.appendChild(band);
          if (!gapLabelShown) { frag.appendChild(labelEl(doc, (left + right) / 2, (a.bottom + b.top) / 2, Math.round(rowGap))); gapLabelShown = true; }
        }
      }
    }
  }

  detail.appendChild(frag);
}
