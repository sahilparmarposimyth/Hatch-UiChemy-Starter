"use client";

import { createContext, useContext } from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "../../lib/cn";
import s from "./ToggleGroup.module.css";

type Size = "sm" | "md" | "lg";
const SizeCtx = createContext<Size>("md");

/** ToggleGroup, segmented control; single or multiple selection (Radix). */
export function ToggleGroup({
  size = "md",
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & { size?: Size }) {
  return (
    <SizeCtx.Provider value={size}>
      <ToggleGroupPrimitive.Root className={cn(s.group, className)} {...props}>
        {children}
      </ToggleGroupPrimitive.Root>
    </SizeCtx.Provider>
  );
}

export function ToggleGroupItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>) {
  const size = useContext(SizeCtx);
  return (
    <ToggleGroupPrimitive.Item className={cn(s.item, size !== "md" && s[size], className)} {...props} />
  );
}
