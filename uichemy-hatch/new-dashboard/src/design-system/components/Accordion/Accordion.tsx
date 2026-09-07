"use client";

import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/cn";
import { strokeFor } from "../../lib/icon";
import s from "./Accordion.module.css";

/** Accordion, Radix behavior, uc- token look. Same primitive shadcn uses. */
export const Accordion = AccordionPrimitive.Root;

export const AccordionItem = ({
  className,
  ...p
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>) => (
  <AccordionPrimitive.Item className={cn(s.item, className)} {...p} />
);

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className={s.header}>
      <AccordionPrimitive.Trigger className={cn(s.trigger, className)} {...props}>
        {children}
        <HugeiconsIcon icon={ArrowDown01Icon} className={s.chevron} size={16} strokeWidth={strokeFor(16)} aria-hidden />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content className={cn(s.content, className)} {...props}>
      <div className={s.contentInner}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
