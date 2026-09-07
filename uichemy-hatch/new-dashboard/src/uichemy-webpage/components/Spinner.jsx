import React from 'react';

/**
 * Busy indicator for the flow's loading and import-progress states.
 *
 * Stands in for the standalone plugin's Lottie star animation. That needed the
 * `lottie-web` runtime plus a bundled animation JSON; this is a pure inline SVG
 * with a CSS rotation, so the port adds no dependency and no asset files for
 * what is only ever a spinner.
 *
 * @param {number} [props.size=60]  Square render size in px.
 * @param {string} [props.className]
 */
export default function Spinner({ size = 60, className = '' }) {
  return (
    <span
      className={`uich-wpc-spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" fill="none" width={size} height={size}>
        <circle
          cx="24"
          cy="24"
          r="19"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="4"
        />
        <path
          d="M43 24c0-10.493-8.507-19-19-19"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
