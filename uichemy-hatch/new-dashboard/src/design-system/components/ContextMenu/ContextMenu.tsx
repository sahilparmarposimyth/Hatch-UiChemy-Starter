"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "../../lib/cn";
import s from "./ContextMenu.module.css";

/** ContextMenu, right-click menu, dark popover (mirrors Menu). */
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(s.content, "uc-portal", "uc-pop-dark", className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  danger,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { danger?: boolean }) {
  return <ContextMenuPrimitive.Item className={cn(s.item, danger && s.itemDanger, className)} {...props} />;
}

export const ContextMenuLabel = ({
  className,
  ...p
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>) => (
  <ContextMenuPrimitive.Label className={cn(s.label, className)} {...p} />
);

export const ContextMenuSeparator = ({
  className,
  ...p
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) => (
  <ContextMenuPrimitive.Separator className={cn(s.separator, className)} {...p} />
);

// ── Submenu (nested flyout) ────────────────────────────────────────────────
export const ContextMenuSub = ContextMenuPrimitive.Sub;

export function ContextMenuSubTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>) {
  return <ContextMenuPrimitive.SubTrigger className={cn(s.item, className)} {...props} />;
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        className={cn(s.content, "uc-portal", "uc-pop-dark", className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}
