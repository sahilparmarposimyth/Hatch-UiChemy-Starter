import { cn } from "../../lib/cn";
import s from "./Badge.module.css";

export type BadgeVariant = "solid" | "soft" | "outline";
export type BadgeTone = "brand" | "neutral" | "success" | "danger" | "warning" | "accent";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
}

export function Badge({
  variant = "soft",
  tone = "brand",
  size = "sm",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(s.badge, s[variant], s[tone], size === "md" && s.md, className)} {...props}>
      {dot && <span className={s.dot} aria-hidden />}
      {children}
    </span>
  );
}
