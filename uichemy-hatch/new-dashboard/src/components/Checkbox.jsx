import React from 'react';

/**
 * Custom UiChemy-accent checkbox.
 *
 * Keeps a real <input type="checkbox"> underneath (so it stays fully
 * keyboard- and screen-reader-accessible, and works inside a <label>),
 * and paints a brand-purple box + checkmark on top via `appearance:none`.
 *
 * Sizing is driven by the `--nd-check-size` CSS variable, pass `size`
 * (number → px, or any CSS length string) to set it inline, or override
 * `--nd-check-size` from a parent rule. No hard-coded width/height here,
 * so it scales cleanly now and in the future.
 *
 * Any extra props (id, name, disabled, aria-*, etc.) pass through to the
 * underlying input.
 */
export default function Checkbox({ checked, onChange, size, className = '', style, ...rest }) {
  const inputStyle = size != null
    ? { ...style, '--nd-check-size': typeof size === 'number' ? `${size}px` : size }
    : style;

  // The box and checkmark are painted entirely by CSS on the input
  // itself (appearance:none + a ::after tick), so there's no extra DOM
  // and nothing for WP admin's checkbox styles to fight with.
  return (
    <input
      type="checkbox"
      className={`nd-check ${className}`.trim()}
      style={inputStyle}
      checked={checked}
      onChange={onChange}
      {...rest}
    />
  );
}
