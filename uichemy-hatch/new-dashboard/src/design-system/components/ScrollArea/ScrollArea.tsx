"use client";

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../../lib/cn";
import s from "./ScrollArea.module.css";

/** ScrollArea, custom cross-browser scrollbars (Radix), uc- token look. */
export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn(s.root, className)} {...props}>
      <ScrollAreaPrimitive.Viewport className={s.viewport}>{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar className={s.scrollbar} orientation="vertical">
        <ScrollAreaPrimitive.Thumb className={s.thumb} />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Scrollbar className={s.scrollbar} orientation="horizontal">
        <ScrollAreaPrimitive.Thumb className={s.thumb} />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
