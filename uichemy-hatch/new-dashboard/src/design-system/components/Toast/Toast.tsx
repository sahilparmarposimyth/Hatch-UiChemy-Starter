"use client";

// UiChemy toast, rebuilt on uc- tokens.
// A light-grey outer tray wraps a white card (icon + title/description + Close),
// with a live "closes in N sec" countdown footer. Every toast is rendered as a
// Sonner custom toast (Sonner has no footer slot); the countdown owns auto-close
// so Sonner is handed `duration: Infinity` and never runs a competing timer.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  toast as sonnerToast,
  Toaster as SonnerToaster,
  type ToasterProps,
  type ExternalToast,
} from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Alert02Icon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../lib/cn";
import { strokeFor } from "../../lib/icon";
import s from "./Toast.module.css";

export type ToastVariant = "success" | "error" | "warning" | "info" | "loading" | "default";

/* ---- Variant icons (Hugeicons, sized to 24px by .icon svg CSS) ----------- */
const SW = strokeFor(24);
const CheckCircle = () => <HugeiconsIcon icon={CheckmarkCircle02Icon} size={24} strokeWidth={SW} aria-hidden />;
const AlertTriangle = () => <HugeiconsIcon icon={Alert02Icon} size={24} strokeWidth={SW} aria-hidden />;
const Info = () => <HugeiconsIcon icon={InformationCircleIcon} size={24} strokeWidth={SW} aria-hidden />;
const Loader = () => <HugeiconsIcon icon={Loading03Icon} size={24} strokeWidth={SW} aria-hidden />;

function VariantIcon({ variant }: { variant: ToastVariant }) {
  switch (variant) {
    case "success":
      return <span className={cn(s.icon, s.iconSuccess)}><CheckCircle /></span>;
    case "error":
    case "warning":
      return <span className={cn(s.icon, s.iconDanger)}><AlertTriangle /></span>;
    case "info":
      return <span className={cn(s.icon, s.iconInfo)}><Info /></span>;
    case "loading":
      return <span className={cn(s.icon, s.iconLoading, s.spin)}><Loader /></span>;
    default:
      return null;
  }
}

/* ---- Countdown footer ---------------------------------------------------- */
/** Presentational "closes in N sec" line. */
function CountdownText({ seconds }: { seconds: number }) {
  return (
    <p className={s.countdown}>
      This message will automatically close in <span className={s.countSec}>{seconds} sec</span>
    </p>
  );
}

/** Live countdown that also owns auto-close (dismisses the Sonner toast at 0).
    Pauses while the pointer is over the toaster or the tab is hidden, matching
    Sonner's own pause rules, so the number the user reads never desyncs. */
function LiveCountdown({ id, durationMs }: { id: number | string; durationMs: number }) {
  const [remaining, setRemaining] = useState(() => Math.ceil(durationMs / 1000));
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let end = Date.now() + durationMs;
    let pausedAt: number | null = null;
    let dismissed = false;

    const pause = () => {
      if (pausedAt == null) pausedAt = Date.now();
    };
    const resume = () => {
      if (pausedAt == null) return;
      end += Date.now() - pausedAt;
      pausedAt = null;
    };
    const onVisibility = () => (document.hidden ? pause() : resume());

    const toaster = ref.current?.closest("[data-sonner-toaster]");
    toaster?.addEventListener("mouseenter", pause);
    toaster?.addEventListener("mouseleave", resume);
    document.addEventListener("visibilitychange", onVisibility);
    if (document.hidden) pause();

    const iv = setInterval(() => {
      if (pausedAt != null || dismissed) return;
      const left = end - Date.now();
      setRemaining(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) {
        dismissed = true;
        sonnerToast.dismiss(id);
      }
    }, 200);

    return () => {
      clearInterval(iv);
      toaster?.removeEventListener("mouseenter", pause);
      toaster?.removeEventListener("mouseleave", resume);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, durationMs]);

  return <p ref={ref} className={s.countdown} style={{ width: "100%" }}>
    This message will automatically close in <span className={s.countSec}>{remaining} sec</span>
  </p>;
}

/* ---- Toast card ---------------------------------------------------------- */
export interface ToastProps {
  variant?: ToastVariant;
  title: ReactNode;
  description?: ReactNode;
  /** Icon override; defaults to the variant icon. */
  icon?: ReactNode;
  /** Action/close button. Defaults to a "Close" button. */
  actionLabel?: ReactNode;
  onAction?: () => void;
  /** Footer content (a countdown). Omit for no footer (e.g. loading). */
  footer?: ReactNode;
  className?: string;
}

/** The visual toast card, usable standalone (static) or inside a Sonner toast. */
export function Toast({ variant = "default", title, description, icon, actionLabel, onAction, footer, className }: ToastProps) {
  return (
    <div className={cn(s.tray, "uc-portal", className)}>
      <div className={s.card}>
        <div className={s.main}>
          {icon !== undefined ? <span className={s.icon}>{icon}</span> : <VariantIcon variant={variant} />}
          <div className={s.text}>
            <p className={s.title}>{title}</p>
            {description ? <p className={s.desc}>{description}</p> : null}
          </div>
        </div>
        <button type="button" className={s.close} onClick={onAction}>
          {actionLabel ?? "Close"}
        </button>
      </div>
      {footer ? <div className={s.footer}>{footer}</div> : null}
    </div>
  );
}

/** Static preview footer for the showroom (no live timer). */
export function ToastCountdownPreview({ seconds }: { seconds: number }) {
  return <CountdownText seconds={seconds} />;
}

/* ---- Sonner wiring ------------------------------------------------------- */
const DEFAULT_DURATION = 4000;

/** Mount once near the app root to render toasts. */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{ unstyled: true, className: s.sonnerToast }}
      {...props}
    />
  );
}

function normalizeAction(action: ExternalToast["action"]): { label: ReactNode; onClick?: () => void } | undefined {
  if (action && typeof action === "object" && "label" in action) {
    const onClick = (action as { onClick?: (...args: unknown[]) => void }).onClick;
    return { label: action.label as ReactNode, onClick: () => onClick?.() };
  }
  return undefined;
}

function show(variant: ToastVariant, message: ReactNode, data?: ExternalToast) {
  const durationMs = data?.duration ?? (variant === "loading" ? Infinity : DEFAULT_DURATION);
  const { description, action, icon, duration: _duration, ...rest } = data ?? {};
  const act = normalizeAction(action);
  const showCountdown = Number.isFinite(durationMs) && durationMs > 0;

  // Sonner gets Infinity on purpose, the LiveCountdown owns auto-close.
  return sonnerToast.custom(
    (id) => (
      <Toast
        variant={variant}
        title={message}
        description={description as ReactNode}
        icon={icon as ReactNode}
        actionLabel={act?.label}
        onAction={() => {
          act?.onClick?.();
          sonnerToast.dismiss(id);
        }}
        footer={showCountdown ? <LiveCountdown id={id} durationMs={durationMs} /> : undefined}
      />
    ),
    { ...rest, duration: Infinity },
  );
}

type SonnerToast = typeof sonnerToast;

/** Drop-in for sonner's `toast`, every variant rendered with the UiChemy layout. */
export const toast: SonnerToast = Object.assign(
  (message: ReactNode, data?: ExternalToast) => show("default", message, data),
  sonnerToast,
  {
    success: (message: ReactNode, data?: ExternalToast) => show("success", message, data),
    error: (message: ReactNode, data?: ExternalToast) => show("error", message, data),
    warning: (message: ReactNode, data?: ExternalToast) => show("warning", message, data),
    info: (message: ReactNode, data?: ExternalToast) => show("info", message, data),
    loading: (message: ReactNode, data?: ExternalToast) => show("loading", message, data),
    message: (message: ReactNode, data?: ExternalToast) => show("default", message, data),
  },
) as SonnerToast;
