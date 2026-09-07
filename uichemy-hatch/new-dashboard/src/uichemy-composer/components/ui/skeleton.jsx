import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }) {
  // Neutral grey shimmer (was bg-primary/10, which tinted loading states with
  // the brand accent). A muted grey keeps lazy-load minimal and on-brand.
  return <div className={cn('animate-pulse rounded-md bg-muted-foreground/15', className)} {...props} />;
}

export { Skeleton };
