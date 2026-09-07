"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/cn";
import s from "./Tooltip.module.css";

export const TooltipProvider = TooltipPrimitive.Provider;

/** Simple tooltip: wrap a trigger, pass `content`. Behavior via Radix. */
export function Tooltip({
  content,
  children,
  side = "top",
  delayDuration = 200,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className={cn(s.content, "uc-portal")} side={side} sideOffset={3}>
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
