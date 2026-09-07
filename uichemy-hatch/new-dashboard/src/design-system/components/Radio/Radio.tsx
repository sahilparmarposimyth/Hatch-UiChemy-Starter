"use client";

import { createContext, useContext } from "react";
import * as RadioPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../../lib/cn";
import s from "./Radio.module.css";

export type RadioSize = "sm" | "md" | "lg";
const RadioSizeCtx = createContext<RadioSize>("md");

export const RadioGroup = ({
  size = "md",
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadioPrimitive.Root> & { size?: RadioSize }) => (
  <RadioSizeCtx.Provider value={size}>
    <RadioPrimitive.Root className={cn(s.group, className)} {...props} />
  </RadioSizeCtx.Provider>
);

export const RadioItem = ({
  size,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadioPrimitive.Item> & { size?: RadioSize }) => {
  const ctxSize = useContext(RadioSizeCtx);
  const sz = size ?? ctxSize;
  return (
    <RadioPrimitive.Item className={cn(s.item, sz !== "md" && s[sz], className)} {...props}>
      <RadioPrimitive.Indicator className={s.indicator} />
    </RadioPrimitive.Item>
  );
};

/** Convenience row: radio + clickable label. */
export function RadioRow({
  value,
  label,
  id,
  disabled,
}: {
  value: string;
  label: string;
  id: string;
  disabled?: boolean;
}) {
  return (
    <div className={s.row}>
      <RadioItem value={value} id={id} disabled={disabled} />
      <label className={s.rowLabel} htmlFor={id}>
        {label}
      </label>
    </div>
  );
}
