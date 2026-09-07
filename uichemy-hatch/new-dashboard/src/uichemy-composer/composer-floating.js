/** Shared viewport-aware fixed positioning for floating panels.
 *
 * `win` is the window whose viewport the returned coordinates belong to, and it
 * is NOT optional in practice — it is the anchor's own window. The composer's
 * bundle runs in whichever document hosts the PANEL (in Elementor, the top
 * editor document), while the on-canvas toolbar and its controls live in the
 * PREVIEW iframe. Measuring against the module's ambient `window` therefore
 * clamped iframe coordinates to the top window's viewport: the preview is both
 * narrower (the panel takes ~300px off the left) and shorter than the editor
 * window, so a menu opened near its edges was flipped or pushed to the wrong
 * side of its trigger. Callers that know the anchor's document must pass
 * `anchor.ownerDocument.defaultView`; the ambient window remains the fallback
 * for same-document callers. */

const FLOAT_PAD = 8;
const FLOAT_GAP = 6;

export function computeFloatingPosition(anchor, tipW, tipH, win) {
  const w = win || window;
  const vw = w.innerWidth;
  const vh = w.innerHeight;
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;

  const candidates = [
    { top: anchor.bottom + FLOAT_GAP, left: cx - tipW / 2 },
    { top: anchor.top - FLOAT_GAP - tipH, left: cx - tipW / 2 },
    { top: cy - tipH / 2, left: anchor.right + FLOAT_GAP },
    { top: cy - tipH / 2, left: anchor.left - FLOAT_GAP - tipW },
  ];

  function overflow({ top, left }) {
    return Math.max(0, FLOAT_PAD - left)
      + Math.max(0, left + tipW - (vw - FLOAT_PAD))
      + Math.max(0, FLOAT_PAD - top)
      + Math.max(0, top + tipH - (vh - FLOAT_PAD));
  }

  let best = candidates[0];
  let bestOver = overflow(best);
  for (let i = 1; i < candidates.length; i++) {
    const o = overflow(candidates[i]);
    if (o < bestOver) {
      best = candidates[i];
      bestOver = o;
    }
  }

  return {
    top: Math.max(FLOAT_PAD, Math.min(best.top, vh - FLOAT_PAD - tipH)),
    left: Math.max(FLOAT_PAD, Math.min(best.left, vw - FLOAT_PAD - tipW)),
  };
}

/** Color picker, prefer below/above the swatch, aligned to its left edge.
 *  `win` as above: the anchor's own window, not the bundle's. */
export function computePickerPosition(anchor, tipW, tipH, win) {
  const w = win || window;
  const vw = w.innerWidth;
  const vh = w.innerHeight;

  const candidates = [
    { top: anchor.bottom + FLOAT_GAP, left: anchor.left },
    { top: anchor.top - FLOAT_GAP - tipH, left: anchor.left },
    { top: anchor.bottom + FLOAT_GAP, left: anchor.right - tipW },
    { top: anchor.top - FLOAT_GAP - tipH, left: anchor.right - tipW },
    { top: anchor.top, left: anchor.right + FLOAT_GAP },
    { top: anchor.bottom - tipH, left: anchor.left - FLOAT_GAP - tipW },
  ];

  function overflow({ top, left }) {
    return Math.max(0, FLOAT_PAD - left)
      + Math.max(0, left + tipW - (vw - FLOAT_PAD))
      + Math.max(0, FLOAT_PAD - top)
      + Math.max(0, top + tipH - (vh - FLOAT_PAD));
  }

  let best = candidates[0];
  let bestOver = overflow(best);
  for (let i = 1; i < candidates.length; i++) {
    const o = overflow(candidates[i]);
    if (o < bestOver) {
      best = candidates[i];
      bestOver = o;
    }
  }

  return {
    top: Math.max(FLOAT_PAD, Math.min(best.top, vh - FLOAT_PAD - tipH)),
    left: Math.max(FLOAT_PAD, Math.min(best.left, vw - FLOAT_PAD - tipW)),
  };
}
