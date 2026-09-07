"use client";

import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import s from "./Input.module.css";

export type InputSize = "sm" | "md" | "lg";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: InputSize;
  invalid?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = "md", invalid, leftIcon, rightIcon, className, ...props },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        s.input,
        inputSize === "sm" && s.sm,
        inputSize === "lg" && s.lg,
        invalid && s.invalid,
        leftIcon && s.hasLeft,
        rightIcon && s.hasRight,
        className,
      )}
      {...props}
    />
  );
  if (!leftIcon && !rightIcon) return control;
  return (
    <span className={s.wrap}>
      {leftIcon && <span className={cn(s.icon, s.iconLeft)}>{leftIcon}</span>}
      {control}
      {rightIcon && <span className={cn(s.icon, s.iconRight)}>{rightIcon}</span>}
    </span>
  );
});

/** Optional label + hint/error wrapper for form fields. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={s.field}>
      {label && (
        <label className={s.label} htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {(error || hint) && (
        <span className={cn(s.hint, error && s.hintError)}>{error || hint}</span>
      )}
    </div>
  );
}
