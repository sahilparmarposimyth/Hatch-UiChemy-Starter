"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";
import s from "./Switch.module.css";

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: "sm" | "md" | "lg";
}

export function Switch({ size = "md", className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root className={cn(s.root, size !== "md" && s[size], className)} {...props}>
      <SwitchPrimitive.Thumb className={s.thumb} />
    </SwitchPrimitive.Root>
  );
}
