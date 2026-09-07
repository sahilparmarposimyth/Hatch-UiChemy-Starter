import * as React from 'react';

/**
 * Sliding segmented control.
 *
 * Publishes the active item's offset/size as custom properties so ONE pill,
 * drawn by the wrapper, can travel between items. A per-item active chip can
 * only cross-fade — one chip vanishing as another appears — which reads as
 * blinking rather than movement.
 *
 * Usage: put the returned ref on the wrapper, give it the `seg-slide` class,
 * and mark each item with data-state="active" | "inactive".
 *
 * Returns a CALLBACK ref, not a useRef object, and that is the whole trick: a
 * track often mounts long after the component that owns the hook. The Inspector
 * mounts once and its Background sub-toggles only appear when that section is
 * expanded — so a `useLayoutEffect(..., [])` reading `ref.current` found null,
 * bailed, and never ran again, leaving those tracks with no pill at all. React
 * calls a callback ref with the node when it attaches and with null when it
 * detaches, so setup happens whenever the track actually arrives.
 *
 * Lives here rather than in composer-inputs.jsx because components/ui is a
 * vendored copy of the design system, synced between repos: a DS file importing
 * an app module would break that sync. composer-inputs re-exports it, so the
 * existing call sites are unchanged.
 */
export function useSlidingSeg() {
  const teardown = React.useRef(null);

  return React.useCallback((wrap) => {
    if (teardown.current) { teardown.current(); teardown.current = null; }
    if (!wrap || typeof window === 'undefined') return;

    const sync = () => {
      const active = wrap.querySelector('[data-state="active"]');
      if (!active) { wrap.style.setProperty('--seg-o', '0'); return; }
      const wr = wrap.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      // A track inside a collapsed section has no box yet. Publishing zeros
      // would park the pill at the origin and then animate it out to the real
      // position the moment the section opens, which reads as the pill flying
      // in from the left edge. Leave it hidden until there is something to
      // measure; the observers below fire again when there is.
      if (!wr.width || !ar.width) { wrap.style.setProperty('--seg-o', '0'); return; }
      wrap.style.setProperty('--seg-x', (ar.left - wr.left) + 'px');
      wrap.style.setProperty('--seg-w', ar.width + 'px');
      wrap.style.setProperty('--seg-h', ar.height + 'px');
      wrap.style.setProperty('--seg-o', '1');
    };

    sync();
    // Fonts and late layout can move the items a fraction after attach, and the
    // first measurement happens before the browser has painted. One more pass
    // on the next frame settles it without waiting for an observer to fire.
    const raf = requestAnimationFrame(sync);

    // data-state flips on selection; childList covers items appearing (e.g. the
    // CSS/JS panes only exist when unlocked); resize covers label reflow, since
    // the pill hugs each item and they are different widths.
    const mo = new MutationObserver(sync);
    mo.observe(wrap, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-state'] });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    if (ro) ro.observe(wrap);

    teardown.current = () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      if (ro) ro.disconnect();
    };
  }, []);
}
