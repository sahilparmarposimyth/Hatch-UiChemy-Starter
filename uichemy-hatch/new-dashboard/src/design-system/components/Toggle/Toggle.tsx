"use client";

import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cn } from "../../lib/cn";
import s from "./Toggle.module.css";

export interface ToggleProps
  extends React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> {
  size?: "sm" | "md" | "lg";
}

/** Toggle, a pressable button; "on" reads as the inverse fill. */
export function Toggle({ size = "md", className, ...props }: ToggleProps) {
  return (
    <TogglePrimitive.Root className={cn(s.toggle, size !== "md" && s[size], className)} {...props} />
  );
}
