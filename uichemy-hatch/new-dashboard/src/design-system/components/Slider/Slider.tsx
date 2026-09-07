"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../lib/cn";
import s from "./Slider.module.css";

/** Slider, Radix behavior, monochrome fill (matches Switch/Checkbox). */
export function Slider({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>) {
  const v = props.value ?? props.defaultValue;
  const count = Array.isArray(v) ? v.length : 1;
  return (
    <SliderPrimitive.Root className={cn(s.root, className)} {...props}>
      <SliderPrimitive.Track className={s.track}>
        <SliderPrimitive.Range className={s.range} />
      </SliderPrimitive.Track>
      {Array.from({ length: count }).map((_, i) => (
        <SliderPrimitive.Thumb key={i} className={s.thumb} />
      ))}
    </SliderPrimitive.Root>
  );
}
