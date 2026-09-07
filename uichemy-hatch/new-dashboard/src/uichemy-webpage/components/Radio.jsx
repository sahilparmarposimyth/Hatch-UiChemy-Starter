import React from 'react';

/**
 * Radio (Figma node 6672:50992). White circle + border when unselected,
 * inner dot when selected. Mirrors the Checkbox primitive API.
 *
 * States from the design map to props + native focus:
 *   - Default        -> base styles
 *   - Focus          -> :focus-visible
 *   - Error          -> error prop
 *   - Error Focus    -> error prop + :focus-visible
 *   - Disabled       -> disabled prop
 *
 * @param {boolean}                       [props.checked]
 * @param {(value:any, e:Event)=>void}    [props.onChange]  fired when this radio is selected
 * @param {any}                           [props.value]     value passed to onChange (for groups)
 * @param {boolean}                       [props.error]
 * @param {boolean}                       [props.disabled]
 * @param {number}                        [props.size=16]
 * @param {string}                        [props.className]
 */
export default function Radio({
  checked = false,
  onChange,
  value,
  error = false,
  disabled = false,
  size = 16,
  className = '',
  ...rest
}) {
  const select = (e) => {
    if (disabled || checked) return;
    e.stopPropagation();
    onChange?.(value !== undefined ? value : true, e);
  };

  return (
    <span
      className={`uich-wpc-radio${checked ? ' is-checked' : ''}${error ? ' is-error' : ''}${disabled ? ' is-disabled' : ''} ${className}`.trim()}
      style={{ width: size, height: size }}
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={select}
      onKeyDown={(e) => {
        if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          select(e);
        }
      }}
      {...rest}
    >
      <span className="uich-wpc-radio__dot" aria-hidden="true" />
    </span>
  );
}
