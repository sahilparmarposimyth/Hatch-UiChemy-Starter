"use client";

import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/cn";
import s from "./Button.module.css";

export type ButtonVariant = "solid" | "soft" | "outline" | "ghost";
export type ButtonTone = "brand" | "neutral" | "success" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
/** Which surface the button sits on. `dark` remaps tokens for dark chrome
 *  (header / sidebar / rails) so every variant stays legible. */
export type ButtonSurface = "light" | "dark";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  loading?: boolean;
  iconOnly?: boolean;
  /** Surface the button sits on. `dark` = the app's dark chrome. Default `light`. */
  surface?: ButtonSurface;
  /** Render as the single child element (Radix Slot) instead of <button>. */
  asChild?: boolean;
}

/**
 * Button, behavior via native <button> / Radix Slot; look via uc- tokens.
 * Accessibility, keyboard and focus are the platform defaults, untouched.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "solid",
      tone = "neutral",
      size = "md",
      loading = false,
      iconOnly = false,
      surface = "light",
      asChild = false,
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    const classes = cn(
      s.button,
      s[variant],
      s[tone],
      s[size],
      iconOnly && s.iconOnly,
      surface === "dark" && s.onDark,
      loading && s.loading,
      className,
    );
    // Radix Slot requires EXACTLY one child element, so the spinner sibling
    // must not be injected on the asChild path. `asChild` + `loading` is not a
    // supported combination (the child owns its own content); render the child
    // through as-is.
    if (asChild) {
      return (
        <Comp ref={ref} className={classes} data-loading={loading || undefined} {...props}>
          {children}
        </Comp>
      );
    }
    return (
      <Comp
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        data-loading={loading || undefined}
        {...props}
      >
        {loading && <span className={s.spinner} aria-hidden />}
        {children}
      </Comp>
    );
  },
);
