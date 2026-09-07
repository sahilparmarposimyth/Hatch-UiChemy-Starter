"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../lib/cn";
import s from "./Popover.module.css";

/** Popover, Radix behavior. Light raised surface (unlike the dark Menu pop). */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(s.content, "uc-portal", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
