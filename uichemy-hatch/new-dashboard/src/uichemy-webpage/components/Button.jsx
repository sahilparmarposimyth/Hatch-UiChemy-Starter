import React from 'react';
import { Button as DSButton } from '../../design-system';

/**
 * Webpage Button, now a thin adapter over the design-system Button, so the
 * whole AI-Website-Creator flow uses the shared control (uc- tokens, Zalando
 * Sans, brand orange). The original API (variant / size / leftIcon / rightIcon /
 * disabled / …rest) is preserved so no consuming screen changes.
 */
const VARIANT_MAP = {
  primary:      { variant: 'solid',   tone: 'brand'   },
  secondary:    { variant: 'soft',    tone: 'brand'   },
  outline:      { variant: 'outline', tone: 'neutral' },
  ghost:        { variant: 'ghost',   tone: 'neutral' },
  'ghost-muted':{ variant: 'ghost',   tone: 'neutral' },
  destructive:  { variant: 'solid',   tone: 'danger'  },
  dark:         { variant: 'solid',   tone: 'neutral' },
};
const SIZE_MAP = { regular: 'md', large: 'lg', small: 'sm', mini: 'sm' };

export default function Button({
  children,
  variant = 'primary',
  size = 'regular',
  type = 'button',
  leftIcon,
  rightIcon,
  disabled = false,
  className = '',
  ...rest
}) {
  const v = VARIANT_MAP[variant] || VARIANT_MAP.primary;
  const dsSize = SIZE_MAP[size] || 'md';

  return (
    <DSButton
      type={type}
      variant={v.variant}
      tone={v.tone}
      size={dsSize}
      disabled={disabled}
      className={className}
      {...rest}
    >
      {leftIcon ? <span aria-hidden="true">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span aria-hidden="true">{rightIcon}</span> : null}
    </DSButton>
  );
}
