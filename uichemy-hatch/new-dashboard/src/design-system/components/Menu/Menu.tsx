"use client";

import { createContext, useContext, useRef } from "react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../../lib/cn";
import { useSlidingHighlight } from "../Select/Select";
import s from "./Menu.module.css";

export type MenuSize = "sm" | "md" | "lg";
const MenuSizeCtx = createContext<MenuSize>("md");

/** Provides the size to menu items so one `size` scales every row. */
export function Menu({ size = "md", children, ...props }: React.ComponentProps<typeof MenuPrimitive.Root> & { size?: MenuSize }) {
  return (
    <MenuSizeCtx.Provider value={size}>
      <MenuPrimitive.Root {...props}>{children}</MenuPrimitive.Root>
    </MenuSizeCtx.Provider>
  );
}
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
  className,
  sideOffset = 6,
  align = "start",
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>) {
  const hlRef = useRef<HTMLSpanElement>(null);
  const contentRefCb = useSlidingHighlight(hlRef);

  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        ref={contentRefCb}
        className={cn(s.content, "uc-portal", "uc-pop-dark", className)}
        sideOffset={sideOffset}
        align={align}
        {...props}
      >
        <span ref={hlRef} className={s.highlight} aria-hidden />
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  className,
  danger,
  shortcut,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & {
  danger?: boolean;
  shortcut?: string;
}) {
  const size = useContext(MenuSizeCtx);
  const sizeCls = size === "sm" ? s.itemSm : size === "lg" ? s.itemLg : undefined;
  return (
    <MenuPrimitive.Item className={cn(s.item, sizeCls, danger && s.itemDanger, className)} {...props}>
      {children}
      {shortcut && <span className={s.shortcut}>{shortcut}</span>}
    </MenuPrimitive.Item>
  );
}

export const MenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof MenuPrimitive.Label>) => (
  <MenuPrimitive.Label className={cn(s.label, className)} {...p} />
);
export const MenuSeparator = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator className={cn(s.separator, className)} {...p} />
);

// ── Submenu (nested flyout) ────────────────────────────────────────────────
export const MenuSub = MenuPrimitive.Sub;

export function MenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger>) {
  const size = useContext(MenuSizeCtx);
  const sizeCls = size === "sm" ? s.itemSm : size === "lg" ? s.itemLg : undefined;
  return (
    <MenuPrimitive.SubTrigger className={cn(s.item, sizeCls, className)} {...props}>
      {children}
    </MenuPrimitive.SubTrigger>
  );
}

export function MenuSubContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>) {
  const hlRef = useRef<HTMLSpanElement>(null);
  const contentRefCb = useSlidingHighlight(hlRef);
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        ref={contentRefCb}
        className={cn(s.content, "uc-portal", "uc-pop-dark", className)}
        sideOffset={4}
        {...props}
      >
        <span ref={hlRef} className={s.highlight} aria-hidden />
        {children}
      </MenuPrimitive.SubContent>
    </MenuPrimitive.Portal>
  );
}
