"use client";

import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import s from "./Textarea.module.css";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  size?: "sm" | "md" | "lg";
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, size = "md", className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(s.textarea, size !== "md" && s[size], invalid && s.invalid, className)}
        {...props}
      />
    );
  },
);
