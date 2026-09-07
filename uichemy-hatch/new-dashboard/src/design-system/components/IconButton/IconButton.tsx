"use client";

import { forwardRef } from "react";
import { Button } from "../Button/Button";
import type { ButtonProps } from "../Button/Button";

export interface IconButtonProps extends Omit<ButtonProps, "iconOnly"> {
  /** Accessible name for the control, REQUIRED: there is no visible text label. */
  "aria-label": string;
  /** Convenience prop for the single glyph; falls back to `children`. */
  icon?: React.ReactNode;
}

/**
 * IconButton, a square icon-only button.
 *
 * A thin wrapper over `<Button iconOnly>`: it forces the square icon layout
 * (`iconOnly` can't be overridden), enforces an `aria-label` at the type level
 * (icon-only controls have no visible text), and defaults to a quiet `ghost`
 * look for toolbar affordances. Every other Button prop, `variant`, `tone`,
 * `size`, `surface`, `loading`, `disabled`, `asChild`, passes straight through.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = "ghost", tone = "neutral", size = "md", icon, children, ...props },
    ref,
  ) {
    return (
      <Button ref={ref} iconOnly variant={variant} tone={tone} size={size} {...props}>
        {icon ?? children}
      </Button>
    );
  },
);
