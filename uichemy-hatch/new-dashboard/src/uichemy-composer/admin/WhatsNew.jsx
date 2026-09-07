// "What's New" panel, a floating side sheet pinned to the right of the
// dashboard. It slides in from the right (no backdrop, so the page is never
// dimmed) and closes via the ✕ or Escape. Content is a placeholder for now –
// blog posts will load from an API here later. Self-scoped to `.uich-tw`.
import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function WhatsNewDrawer({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className="uich-tw">
      <aside
        className={cn(
          'fixed bottom-6 right-6 top-6 z-[99999] flex w-[380px] max-w-[90vw] flex-col overflow-hidden rounded-xl border bg-card shadow-[0_4px_16px_rgba(0,0,0,0.06)]',
          'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          open
            ? 'pointer-events-auto translate-x-0'
            : 'pointer-events-none translate-x-[110%]'
        )}
        role="dialog"
        aria-label="What's New"
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">What&apos;s New</h3>
            <span className="text-sm text-muted-foreground">Latest updates &amp; posts from UiChemy</span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {/* TODO: fetch + render blog posts from the API here. */}
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <span className="text-2xl text-muted-foreground">✦</span>
            <p className="text-sm text-muted-foreground">Blog posts &amp; product updates will appear here soon.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
