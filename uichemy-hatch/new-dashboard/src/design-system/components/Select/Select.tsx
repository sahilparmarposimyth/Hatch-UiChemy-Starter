"use client";

import { createContext, useCallback, useContext, useRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/cn";
import { strokeFor } from "../../lib/icon";
import s from "./Select.module.css";

export type SelectSize = "sm" | "md" | "lg";
const SelectSizeCtx = createContext<SelectSize>("md");

/** Attaches a sliding highlight that follows the [data-highlighted] item.
    Uses a callback ref so it runs when the portal content actually mounts.

    The slide is driven by the Web Animations API rather than a CSS transition:
    setting `transform` inside a MutationObserver can be coalesced by the browser
    so the implicit transition never fires (it snaps). `element.animate()` from
    the current computed transform to the target is deterministic, and, because
    it reads the live computed value, an in-flight slide is picked up mid-way and
    redirected smoothly when the highlight changes again. */
const SLIDE_MS = 240; // matches --uc-dur-base
const SLIDE_EASE = "cubic-bezier(0.3, 0, 0, 1)"; // --uc-ease-emphasized

export function useSlidingHighlight(hlRef: React.RefObject<HTMLElement | null>) {
  const moRef = useRef<MutationObserver | null>(null);
  return useCallback(
    (box: HTMLElement | null) => {
      moRef.current?.disconnect();
      const hl = hlRef.current;
      if (!box || !hl) return;
      const move = () => {
        const item = box.querySelector<HTMLElement>("[data-highlighted]");
        // Keep the last position on transient empty frames so moving between
        // items still slides (Radix briefly clears data-highlighted).
        if (!item) return;
        const target = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
        // "Placed" is tracked on the element, not a React ref: Radix re-renders
        // the popover content on every highlight change, which re-invokes this
        // ref callback, a ref flag would reset each time and every move would
        // snap. A data-attribute on the (persistent) highlight node survives that.
        const placed = hl.dataset.slid === "1";
        hl.style.opacity = "1";
        hl.style.width = `${item.offsetWidth}px`;
        hl.style.height = `${item.offsetHeight}px`;
        if (!placed) {
          hl.style.transform = target; // first placement: snap in, no slide
          hl.dataset.slid = "1";
          return;
        }
        const from = getComputedStyle(hl).transform;
        hl.getAnimations().forEach((a) => a.cancel());
        hl.style.transform = target; // commit the resting state
        if (from && from !== "none") {
          hl.animate(
            [{ transform: from }, { transform: target }],
            { duration: SLIDE_MS, easing: SLIDE_EASE },
          );
        }
      };
      move();
      const mo = new MutationObserver(move);
      mo.observe(box, { attributes: true, attributeFilter: ["data-highlighted"], subtree: true });
      moRef.current = mo;
    },
    [hlRef],
  );
}

/** Provides the size to the trigger + items so one `size` scales the whole control. */
export function Select({
  size = "md",
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root> & { size?: SelectSize }) {
  return (
    <SelectSizeCtx.Provider value={size}>
      <SelectPrimitive.Root {...props}>{children}</SelectPrimitive.Root>
    </SelectSizeCtx.Provider>
  );
}
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  const size = useContext(SelectSizeCtx);
  return (
    <SelectPrimitive.Trigger className={cn(s.trigger, size !== "md" && s[size], className)} {...props}>
      {children}
      <SelectPrimitive.Icon className={s.chevron}>
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={strokeFor(16)} aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  const hlRef = useRef<HTMLSpanElement>(null);
  const contentRefCb = useSlidingHighlight(hlRef);

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={contentRefCb}
        className={cn(s.content, "uc-portal", "uc-pop-dark", className)}
        position={position}
        sideOffset={6}
        {...props}
      >
        <SelectPrimitive.Viewport className={s.viewport}>
          <span ref={hlRef} className={s.highlight} aria-hidden />
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  const size = useContext(SelectSizeCtx);
  const sizeCls = size === "sm" ? s.itemSm : size === "lg" ? s.itemLg : undefined;
  return (
    <SelectPrimitive.Item className={cn(s.item, sizeCls, className)} {...props}>
      <SelectPrimitive.ItemIndicator className={s.indicator}>
        <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={strokeFor(14)} aria-hidden />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
