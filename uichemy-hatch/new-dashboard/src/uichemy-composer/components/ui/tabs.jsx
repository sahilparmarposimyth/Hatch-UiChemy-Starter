import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';
import { useSlidingSeg } from './use-sliding-seg';

/**
 * Tabs, with the two variants the composer needs.
 *
 *   variant="pill"  (default) — the original filled track with a raised active
 *                   chip. Unchanged, so every existing call site keeps its look.
 *   variant="line"  — no track; the active tab is marked by an underline. Matches
 *                   the newer shadcn `TabsList variant="line"` API so the same
 *                   markup works here.
 *
 * The variant is passed on TabsList and read by TabsTrigger through context,
 * so callers write it once rather than repeating it on every trigger.
 */
const TabsVariantContext = React.createContext('pill');

const Tabs = TabsPrimitive.Root;

const LIST_VARIANTS = {
  // `seg-slide` puts the pill variant on the same travelling chip every other
  // segmented control in the composer uses. Radix already stamps
  // data-state="active" on the active trigger, which is exactly what
  // useSlidingSeg measures, so no call site has to change.
  pill: 'seg-slide inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
  // relative + the border on the LIST gives the tabs a continuous rule to sit
  // on, so the active underline reads as a marker along a line rather than a
  // floating dash. -mb-px pulls that rule onto any border below it.
  line: 'uich-tabs-line relative inline-flex h-9 items-center justify-start gap-4 border-b border-border text-muted-foreground',
};

const TRIGGER_VARIANTS = {
  // No per-trigger chip: the LIST draws one that slides. `bg-background` and
  // `shadow` here would paint a second chip on top of the moving one, so the
  // active trigger keeps only its ink — the same split the `line` variant makes.
  pill:
    'rounded-md px-3 py-1 data-[state=active]:text-foreground',
  // No per-tab underline: the LIST draws one shared bar that slides between
  // triggers (see the layout effect in TabsList). A pseudo-element per trigger
  // can only cross-fade, which reads as two bars blinking rather than one
  // moving.
  line:
    'relative px-1 pb-2 pt-1 hover:text-foreground data-[state=active]:text-foreground',
};

const TabsList = React.forwardRef(({ className, variant = 'pill', ...props }, ref) => {
  const listRef = React.useRef(null);
  // The pill variant's chip is measured and positioned by this hook; the line
  // variant's bar is measured by the layout effect below. One node, so the two
  // refs plus any forwarded ref are merged into a single callback.
  // useSlidingSeg returns a CALLBACK ref, so it is called with the node rather
  // than assigned to.
  const attachSeg = useSlidingSeg();
  const attachRef = React.useCallback((node) => {
    listRef.current = node;
    attachSeg(node);
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref, attachSeg]);

  // Sliding underline (line variant): publish the active trigger's offset and
  // width as custom properties; the list's ::after animates between them, so the
  // bar travels instead of blinking from one tab to the next. Re-measured on
  // tab change (data-state mutations) and on resize/label reflow, since the bar
  // hugs each label and every tab is a different width.
  React.useLayoutEffect(() => {
    if (variant !== 'line') return undefined;
    const list = listRef.current;
    if (!list || typeof window === 'undefined') return undefined;
    const sync = () => {
      const active = list.querySelector('[role="tab"][data-state="active"]');
      if (!active) { list.style.setProperty('--tab-bar-o', '0'); return; }
      const lr = list.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      list.style.setProperty('--tab-bar-x', (ar.left - lr.left) + 'px');
      list.style.setProperty('--tab-bar-w', ar.width + 'px');
      list.style.setProperty('--tab-bar-o', '1');
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(list, { attributes: true, subtree: true, attributeFilter: ['data-state'] });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    if (ro) ro.observe(list);
    return () => { mo.disconnect(); if (ro) ro.disconnect(); };
  }, [variant]);

  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        ref={attachRef}
        className={cn(LIST_VARIANTS[variant] ?? LIST_VARIANTS.pill, className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef(({ className, variant, ...props }, ref) => {
  const ctx = React.useContext(TabsVariantContext);
  const v = variant ?? ctx;
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        TRIGGER_VARIANTS[v] ?? TRIGGER_VARIANTS.pill,
        className
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
