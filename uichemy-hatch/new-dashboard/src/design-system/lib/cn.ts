/** Minimal className joiner for the design system (no external deps).
 *  Accepts any value so `cond && className` guards type-check under strict
 *  configs (a `ReactNode && string` can widen to number/bigint); non-string
 *  truthy values are coerced by join, falsy ones are dropped. */
export function cn(...parts: Array<unknown>): string {
  return parts.filter(Boolean).join(" ");
}
