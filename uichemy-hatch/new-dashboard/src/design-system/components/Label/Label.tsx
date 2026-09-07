"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../../lib/cn";
import s from "./Label.module.css";

/** Label, accessible form label (Radix), uc- token typography. */
export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn(s.label, className)} {...props} />;
}
