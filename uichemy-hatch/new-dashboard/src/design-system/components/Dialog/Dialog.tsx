"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/cn";
import { strokeFor } from "../../lib/icon";
import s from "./Dialog.module.css";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn(s.overlay, "uc-portal")} />
      <div className={cn(s.positioner, "uc-portal")}>
        <DialogPrimitive.Content className={cn(s.content, className)} {...props}>
          {children}
        </DialogPrimitive.Content>
        {showClose && (
          <DialogPrimitive.Close className={s.closeOutside} aria-label="Close">
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={strokeFor(16)} aria-hidden />
          </DialogPrimitive.Close>
        )}
      </div>
    </DialogPrimitive.Portal>
  );
}

/* These four used to read `className={cn(s.x, p.className)} {...p}`, and the
   spread came LAST, so `p.className` overwrote the merged value and the
   module class was dropped entirely the moment a caller passed one. A card
   with a className lost its background, padding, radius and border; a footer
   lost its flex row. Destructuring className out (the way DialogTitle and
   DialogDescription below already did) is the fix. */

/** White content card that sits inside the grey dialog tray (holds the
    header + body). Same radius as the dialog, with a 1px bottom border. */
export const DialogCard = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(s.card, className)} {...p} />
);

export const DialogHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(s.header, className)} {...p} />
);
export const DialogTitle = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn(s.title, className)} {...p} />
);
export const DialogDescription = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn(s.desc, className)} {...p} />
);
export const DialogBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(s.body, className)} {...p} />
);
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(s.footer, className)} {...p} />
);
