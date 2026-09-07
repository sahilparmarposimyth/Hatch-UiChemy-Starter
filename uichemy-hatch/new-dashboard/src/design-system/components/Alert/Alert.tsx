import { HugeiconsIcon } from "@hugeicons/react";
import {
  InformationCircleIcon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../lib/cn";
import { strokeFor } from "../../lib/icon";
import s from "./Alert.module.css";

export type AlertTone = "accent" | "success" | "warning" | "danger";

const SW = strokeFor(18);
const ICONS: Record<AlertTone, React.ReactNode> = {
  accent: <HugeiconsIcon icon={InformationCircleIcon} size={18} strokeWidth={SW} aria-hidden />,
  success: <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} strokeWidth={SW} aria-hidden />,
  warning: <HugeiconsIcon icon={Alert02Icon} size={18} strokeWidth={SW} aria-hidden />,
  danger: <HugeiconsIcon icon={AlertCircleIcon} size={18} strokeWidth={SW} aria-hidden />,
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
  icon?: React.ReactNode;
}

export function Alert({ tone = "accent", title, icon, className, children, ...props }: AlertProps) {
  return (
    <div role="status" className={cn(s.alert, s[tone], className)} {...props}>
      <span className={s.icon}>{icon ?? ICONS[tone]}</span>
      <div className={s.content}>
        {title && <span className={s.title}>{title}</span>}
        {children && <span className={s.desc}>{children}</span>}
      </div>
    </div>
  );
}
