"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/cn";
import { strokeFor } from "../../lib/icon";
import s from "./Checkbox.module.css";

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  size?: "sm" | "md" | "lg";
}

export function Checkbox({ size = "md", className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root className={cn(s.root, size !== "md" && s[size], className)} {...props}>
      <CheckboxPrimitive.Indicator className={s.indicator}>
        <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={strokeFor(12)} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
