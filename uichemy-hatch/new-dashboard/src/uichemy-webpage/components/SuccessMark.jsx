import React, { useEffect, useRef, useState } from 'react';

/**
 * Success mark for the "your website is ready" screen.
 *
 * Plays the bundled Bodymovin confirm animation (`success-check.json`) via
 * lottie-web's light SVG player. Both the player and the ~1.9MB animation JSON
 * are LAZY-LOADED (dynamic import) so they land in their own async chunk and
 * never weigh down the main dashboard bundle, they load only when this screen
 * mounts, which is a rare terminal state.
 *
 * The inline SVG (ring + check with a CSS draw-in) renders instantly as the
 * fallback: it shows while the async chunk loads, and stays if the load ever
 * fails (offline, blocked chunk), so the screen is never blank.
 *
 * @param {number} [props.size=160] Square render size in px.
 */
export default function SuccessMark({ size = 160 }) {
  const containerRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let anim;
    let holdTimer;
    let cancelled = false;

    Promise.all([
      // Full build (not lottie_light): this animation is an embedded-image
      // layer, and the light SVG build doesn't size <image> elements reliably.
      import('lottie-web'),
      import('./success-check.json'),
    ])
      .then(([mod, data]) => {
        if (cancelled || !containerRef.current) return;
        const lottie = mod.default || mod;
        anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: false,
          autoplay: true,
          animationData: data.default || data,
        });
        // This Bodymovin comp is a transient "pop": the badge draws in and is
        // fully formed around frame 55 (of 100), then the comp scales everything
        // back OUT to an empty final frame. A success screen needs the check to
        // persist, so we let the pop-in play for real, then freeze on the settled
        // badge frame. The freeze is scheduled OUTSIDE lottie's rAF loop (a
        // timeout, not an enterFrame/complete handler), stopping from inside the
        // loop gets overwritten by the same tick, but an external stop sticks.
        // ~55 frames at 25fps ≈ 2.2s of pop-in before it holds.
        holdTimer = setTimeout(() => {
          try { anim.goToAndStop(55, true); } catch ( e ) { /* noop */ }
        }, 2300);
        setPlaying(true);
      })
      .catch(() => {
        /* keep the inline-SVG fallback */
      });

    return () => {
      cancelled = true;
      if (holdTimer) clearTimeout(holdTimer);
      if (anim) anim.destroy();
    };
  }, []);

  return (
    <span
      className="uich-wpc-success-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        ref={containerRef}
        className="uich-wpc-success-mark__lottie"
        style={{ width: size, height: size, display: playing ? 'block' : 'none' }}
      />
      {!playing && (
        <svg viewBox="0 0 120 120" fill="none" width={size} height={size}>
          <circle
            className="uich-wpc-success-mark__ring"
            cx="60"
            cy="60"
            r="52"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            className="uich-wpc-success-mark__check"
            d="M38 61.5 53 76.5 83 46.5"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
