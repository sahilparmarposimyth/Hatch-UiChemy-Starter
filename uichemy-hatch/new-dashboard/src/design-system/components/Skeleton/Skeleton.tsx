import { cn } from "../../lib/cn";
import s from "./Skeleton.module.css";

/** Skeleton, loading placeholder with a shimmer sweep. No primitive. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(s.skeleton, className)} aria-hidden {...props} />;
}
