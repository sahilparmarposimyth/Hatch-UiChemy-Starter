"use client";

import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "../../lib/cn";
import s from "./Separator.module.css";

/** Separator, 1px hairline; horizontal (default) or vertical. */
export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn(s.root, className)}
      {...props}
    />
  );
}
