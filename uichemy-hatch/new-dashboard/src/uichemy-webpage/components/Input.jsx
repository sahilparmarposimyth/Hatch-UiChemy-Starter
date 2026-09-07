import React from 'react';
import { Input as DSInput, Textarea as DSTextarea } from '../../design-system';

/**
 * Webpage field, now a thin adapter over the design-system Input / Textarea.
 *
 * The external API is unchanged (size / error / disabled / multiline / leftIcon
 * / rightIcon / className / …rest) so every consuming screen keeps working; only
 * the rendered primitive is now the DS component (uc- tokens, Zalando Sans,
 * shared focus ring). `multiline` maps to the DS Textarea, single-line to Input.
 */
const SIZE_MAP = { regular: 'md', large: 'lg', small: 'sm', mini: 'sm' };

export default function Input({
  size = 'regular',
  error = false,
  disabled = false,
  multiline = false,
  leftIcon,
  rightIcon,
  className = '',
  type = 'text',
  ...rest
}) {
  const dsSize = SIZE_MAP[size] || 'md';

  if (multiline) {
    return (
      <DSTextarea
        size={dsSize}
        invalid={error}
        disabled={disabled}
        className={`uich-wpc-input-ds ${className}`.trim()}
        {...rest}
      />
    );
  }

  return (
    <DSInput
      inputSize={dsSize}
      invalid={error}
      disabled={disabled}
      leftIcon={leftIcon}
      rightIcon={rightIcon}
      type={type}
      className={`uich-wpc-input-ds ${className}`.trim()}
      {...rest}
    />
  );
}
