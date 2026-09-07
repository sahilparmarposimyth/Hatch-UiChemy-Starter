"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/cn";
import s from "./Tabs.module.css";

type TabsVariant = "pill" | "underline";
export type TabsSize = "sm" | "md" | "lg";
const VariantCtx = createContext<TabsVariant>("pill");
const SizeCtx = createContext<TabsSize>("md");

export function Tabs({
  variant = "pill",
  size = "md",
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & { variant?: TabsVariant; size?: TabsSize }) {
  return (
    <VariantCtx.Provider value={variant}>
      <SizeCtx.Provider value={size}>
        <TabsPrimitive.Root className={cn(s.root, className)} {...props} />
      </SizeCtx.Provider>
    </VariantCtx.Provider>
  );
}

export function TabsList({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  const variant = useContext(VariantCtx);
  const listRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const ind = indRef.current;
    if (!list || !ind) return;
    let first = true;

    const move = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) {
        ind.style.opacity = "0";
        return;
      }
      const lr = list.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      if (first) ind.style.transition = "none";
      ind.style.opacity = "1";
      ind.style.width = `${ar.width}px`;
      ind.style.transform = `translateX(${Math.round(ar.left - lr.left)}px)`;
      if (first) {
        void ind.offsetWidth; // flush so the first placement doesn't animate
        ind.style.transition = "";
        first = false;
      }
    };

    move();
    const mo = new MutationObserver(move);
    mo.observe(list, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    const ro = new ResizeObserver(move);
    ro.observe(list);
    const raf = requestAnimationFrame(move); // re-measure after fonts settle
    return () => {
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [variant]);

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn(variant === "pill" ? s.listPill : s.listLine, className)}
      {...props}
    >
      <span ref={indRef} className={variant === "pill" ? s.indicatorPill : s.indicatorLine} aria-hidden />
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  className,
  iconOnly = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  /** Square, side-padding-free trigger for an icon-only segmented control
   *  (pill variant only). The square tracks the active size's height. */
  iconOnly?: boolean;
}) {
  const variant = useContext(VariantCtx);
  const size = useContext(SizeCtx);
  const base = variant === "pill" ? s.triggerPill : s.triggerLine;
  const sizeCls =
    size === "md"
      ? undefined
      : s[`trigger${variant === "pill" ? "Pill" : "Line"}${size === "sm" ? "Sm" : "Lg"}`];
  const iconCls = iconOnly && variant === "pill" ? s.triggerPillIcon : undefined;
  return (
    <TabsPrimitive.Trigger className={cn(base, sizeCls, iconCls, className)} {...props} />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn(s.content, className)} {...props} />;
}
