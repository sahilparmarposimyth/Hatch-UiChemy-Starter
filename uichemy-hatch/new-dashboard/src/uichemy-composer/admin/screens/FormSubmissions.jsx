// Form Submissions screen, Atom form entries, INSIDE the dashboard (no separate
// wp-admin page). Calendly-style list + detail pane: a submissions list on the
// left, the selected entry's fields on the right. All data flows through the
// uichemy_forms admin-ajax endpoint (Uich_Forms_Dashboard) via formsAjax() –
// list / view / set_read / delete, all without a reload.
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
// Confirm dialog uses the shared DS Dialog (portals to body / .uc-portal, so it
// renders with DS styling and matches the Theme Builder dialogs exactly, same
// grey tray + white card + footer). DsButton is the DS button for inside it.
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogCard, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
  Button as DsButton,
} from '../../../design-system';
import { formsAjax, data } from '../data';
import { Icon } from '../icons';

const STATUSES = [
  { v: 'all', label: 'All' },
  { v: 'unread', label: 'Unread' },
  { v: 'read', label: 'Read' },
];

// Pill styling for the form-filter ToggleGroupItems (DS component + brand tokens).
const FORM_PILL =
  'h-7 gap-1.5 rounded-full border px-3 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[state=on]:border-transparent data-[state=on]:bg-foreground data-[state=on]:text-background';

/**
 * Build a CSV download URL for the export endpoint (Uich_Forms_Dashboard).
 *
 * The base already carries `action` + the dashboard nonce; only the filters are
 * appended here. An EMPTY formKey is sent as no parameter at all, which is what
 * the server reads as "every form", one file covering the lot.
 */
function exportHref( { formKey = '', status = 'all' } = {} ) {
  const base = (data.urls && data.urls.formsExport) || '';
  if (!base) return '';
  const url = new URL(base, window.location.origin);
  if (formKey) url.searchParams.set('form_key', formKey);
  if (status && status !== 'all') url.searchParams.set('status', status);
  return url.toString();
}

// Empty inbox glyph (kept inline, matches the Mobbin inbox empty state).
function InboxGlyph({ size = 20 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

/**
 * Initial-load placeholder for the whole list+detail box.
 *
 * BOTH panes shimmer at once. Previously only the list did, with the right pane
 * left as a blank white rectangle, then, once the list resolved, DetailPane
 * mounted and started its OWN skeleton. Two loading waves in sequence for what
 * is a single page load, and the blank pane in between read as "empty", not
 * "loading". The right half mirrors DetailPane's real structure (header block
 * with title/meta and its two actions, over field rows) so the swap to real
 * content lands in place instead of reflowing.
 */
function BoxSkeleton() {
  return (
    <>
      <div className="w-[320px] shrink-0 overflow-hidden rounded-xl border bg-card">
        {[0, 1, 2, 3, 4].map((k) => (
          <div key={k} className="flex flex-col gap-1.5 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-44" />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-36" />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 px-6 py-4">
          {[0, 1, 2, 3, 4].map((k) => <Skeleton key={k} className="h-9 w-full" />)}
        </div>
      </div>
    </>
  );
}

// Right-hand reading pane for the selected submission. Lazy-fetches the full
// field list on selection (the list rows only carry a preview). Remounted per
// selection via a `key`, so its fetch/loading state resets cleanly.
function DetailPane({ sub, onToggleRead, onDelete }) {
  const [full, setFull] = React.useState(sub.fields ? sub : null);
  const [loading, setLoading] = React.useState(!sub.fields);

  React.useEffect(() => {
    let alive = true;
    if (sub.fields) return undefined;
    formsAjax('view', { id: sub.id })
      .then((d) => { if (alive) { setFull(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sub.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = full || sub;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-foreground">{s.formName || 'Submission'}</h2>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {s.createdAt}
            {s.page ? <> · <a href={s.pageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{s.page}</a></> : null}
          </p>
          {s.email ? (
            <a href={`mailto:${s.email}`} className="mt-0.5 block truncate text-[12px] text-foreground underline-offset-2 hover:underline">{s.email}</a>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => onToggleRead(s)}>
            {s.isRead ? 'Mark unread' : 'Mark read'}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-destructive" onClick={() => onDelete(s)} title="Delete">
            <Icon name="trash" className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((k) => <Skeleton key={k} className="h-9 w-full" />)}
          </div>
        ) : (s.fields && s.fields.length) ? (
          <table className="w-full border-collapse text-left text-[13px]">
            <tbody>
              {s.fields.map((f, i) => (
                <tr key={i} className="border-b align-top last:border-0">
                  <td className="w-[34%] py-2.5 pr-4 font-medium text-muted-foreground">{f.key || '–'}</td>
                  <td className="whitespace-pre-wrap py-2.5 text-foreground">{f.value || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-6 text-center text-[13px] text-muted-foreground">No field values recorded.</p>
        )}

        {(s.ip || s.referer) && (
          <div className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
            {s.ip ? <span className="mr-3">IP: {s.ip}</span> : null}
            {s.referer ? <span>From: {s.referer}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteDialog({ sub, onCancel, onConfirm }) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="tb-dlg">
        <DialogCard>
          <DialogHeader>
            <DialogTitle>Delete this submission?</DialogTitle>
            <DialogDescription>
              This entry from <b>{sub.formName}</b> will be permanently deleted. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
        </DialogCard>
        <DialogFooter>
          <DsButton variant="outline" tone="neutral" onClick={onCancel}>Cancel</DsButton>
          <DsButton variant="solid" tone="danger" onClick={onConfirm}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
            Delete permanently
          </DsButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FormSubmissions() {
  const [forms, setForms] = React.useState([]);
  const [subs, setSubs] = React.useState([]);
  const [formKey, setFormKey] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [deleteSub, setDeleteSub] = React.useState(null);

  // Sliding-pill status tabs — mirrors our DS Tabs pill: a grey track with a white
  // chip that slides (translateX + width) to the active tab. Position is derived
  // from the active status into React state, so React owns the style (imperative
  // ref writes get clobbered by re-renders). A layout effect keyed to `status`
  // re-measures on every change; a ResizeObserver keeps it aligned; the very first
  // placement is snapped (transition: none) so it doesn't animate in from the left.

  const reload = React.useCallback((opts = {}) => {
    const silent = !!(opts && opts.silent);
    if (!silent) setLoading(true);
    return formsAjax('list', { form_key: formKey, status })
      .then((d) => { setForms(d.forms || []); setSubs(d.submissions || []); setError(''); })
      .catch((e) => setError((e && e.message) || 'Failed to load submissions.'))
      .finally(() => { if (!silent) setLoading(false); });
  }, [formKey, status]);

  React.useEffect(() => { reload(); }, [reload]);

  // Keep a valid selection: preserve the current one across refreshes, else fall
  // back to the first row. Auto-selecting does NOT mark read, only an explicit
  // click does (see select()).
  React.useEffect(() => {
    setSelected((cur) => {
      if (cur) {
        const stillThere = subs.find((s) => s.id === cur.id);
        if (stillThere) return stillThere;
      }
      return subs[0] || null;
    });
  }, [subs]);

  const select = (sub) => {
    setSelected(sub);
    if (!sub.isRead) {
      setSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, isRead: true } : s)));
      setForms((prev) => prev.map((f) => (f.key === sub.formKey ? { ...f, unread: Math.max(0, f.unread - 1) } : f)));
      formsAjax('set_read', { ids: [sub.id], read: 1 }).catch(() => { /* optimistic */ });
    }
  };

  const toggleRead = (sub) => {
    const read = sub.isRead ? 0 : 1;
    setSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, isRead: !!read } : s)));
    setSelected((v) => (v && v.id === sub.id ? { ...v, isRead: !!read } : v));
    formsAjax('set_read', { ids: [sub.id], read }).then(() => reload({ silent: true })).catch(() => reload({ silent: true }));
  };

  const confirmDelete = () => {
    const sub = deleteSub;
    if (!sub) return;
    setDeleteSub(null);
    setSubs((prev) => prev.filter((s) => s.id !== sub.id));
    formsAjax('delete', { ids: [sub.id] }).then(() => reload({ silent: true })).catch(() => reload({ silent: true }));
  };

  const totalUnread = forms.reduce((a, f) => a + (f.unread || 0), 0);
  const classicUrl = (data.urls && data.urls.forms) || '';
  const canExport = !!(data.urls && data.urls.formsExport);
  const activeForm = formKey ? forms.find((f) => f.key === formKey) : null;
  const statusLabel = (STATUSES.find((o) => o.v === status) || {}).label || 'All';

  return (
    <div className="uich-tw">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 pb-4">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-foreground">
              Form Submissions
            </h1>
            <p className="mt-1 text-[13px] font-normal text-muted-foreground">
              Every entry from your Composer forms. {totalUnread > 0 ? `${totalUnread} unread` : 'All caught up'}.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Status tabs = our sliding-pill control (mirrors the DS Tabs pill):
                a grey track with a white chip that slides to the active tab. The
                chip is the absolutely-positioned span; the effect above measures
                and animates it. Items sit on top (z-10), transparent, so only the
                sliding chip provides the active background. */}
            {/* Status tabs: grey track with a white raised chip on the active tab
                (our DS Tabs pill look). A true sliding indicator wouldn't resolve
                its % offset reliably inside wp-admin's island, so the chip is
                per-tab (appears on the active tab) rather than a sliding element. */}
            <ToggleGroup
              type="single"
              value={status}
              onValueChange={(v) => v && setStatus(v)}
              className="inline-flex items-center gap-0.5 rounded-[9px] border border-border bg-muted p-[3px]"
            >
              {STATUSES.map((o) => (
                <ToggleGroupItem
                  key={o.v}
                  value={o.v}
                  className="h-[22px] whitespace-nowrap rounded-[6px] px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
                >
                  {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button variant="outline" size="sm" onClick={() => reload()} title="Refresh">
              <Icon name="inbox" className="size-3.5" />
            </Button>
            {/* Export menu. The first item follows the two filters on screen, so
                "All Forms" writes every form into one CSV and a selected form
                writes only that one; the second ignores both, for a full backup
                without having to reset the filters first. */}
            {canExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">Export</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                    Download as CSV
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <a href={exportHref({ formKey, status })} download>
                      <span className="flex flex-col gap-0.5">
                        <span>{activeForm ? `Export “${activeForm.name}”` : 'Export all forms'}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {activeForm
                            ? `Only this form · ${statusLabel}`
                            : `Every form in one file · ${statusLabel}`}
                        </span>
                      </span>
                    </a>
                  </DropdownMenuItem>
                  {/* Only worth offering when the view is actually narrowed –
                      otherwise it is the same file as the item above. */}
                  {(formKey || status !== 'all') && (
                    <DropdownMenuItem asChild>
                      <a href={exportHref()} download>
                        <span className="flex flex-col gap-0.5">
                          <span>Export everything</span>
                          <span className="text-[11px] text-muted-foreground">
                            All forms, read and unread
                          </span>
                        </span>
                      </a>
                    </DropdownMenuItem>
                  )}
                  {classicUrl && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a href={classicUrl}>Open classic list</a>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-[13px] font-normal text-destructive">
            {error}
          </div>
        )}

        {/* Form filter, DS ToggleGroup of pills; only when there are forms.
            While loading, a same-height row of pill skeletons stands in, so the
            real pills appearing doesn't shove the whole box down the page. */}
        {loading ? (
          <div className="mb-4 flex shrink-0 flex-wrap gap-1.5">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        ) : forms.length > 0 && (
          <ToggleGroup
            type="single"
            value={formKey || 'all'}
            onValueChange={(v) => setFormKey(!v || v === 'all' ? '' : v)}
            className="mb-4 shrink-0 flex-wrap justify-start gap-1.5"
          >
            <ToggleGroupItem value="all" className={FORM_PILL}>All Forms</ToggleGroupItem>
            {forms.map((f) => (
              <ToggleGroupItem key={f.key} value={f.key} className={FORM_PILL}>
                {f.name}
                {f.unread > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-[16px] justify-center rounded-full px-1 text-[10px] font-semibold">
                    {f.unread}
                  </Badge>
                )}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}

        {/* List + detail box (Calendly-style), card-in-card: a recessed grey
            group holding two white panels, gap showing the grey between them. */}
        <div className="flex h-[70vh] min-h-[420px] shrink-0 gap-2 rounded-2xl bg-muted/50 p-2">
          {loading ? (
            <BoxSkeleton />
          ) : subs.length === 0 ? (
            // Empty: single centred inbox empty-state across the whole box.
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border bg-card px-6 py-16 text-center">
              <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <InboxGlyph />
              </span>
              <p className="text-sm font-semibold text-foreground">
                No submissions{status !== 'all' ? ` marked ${status}` : ''} yet
              </p>
              <p className="mt-1 max-w-xs text-[13px] font-normal text-muted-foreground">
                Entries from your Composer forms show up here once visitors start submitting.
              </p>
            </div>
          ) : (
            <>
              {/* Left: submissions list */}
              <div className="ptn-scroll w-[320px] shrink-0 overflow-y-auto rounded-xl border bg-card">
                {subs.map((sub) => {
                  const active = selected && selected.id === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => select(sub)}
                      className={`relative flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition last:border-0 hover:bg-accent ${active ? 'bg-accent' : ''}`}
                    >
                      {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-foreground" />}
                      <div className="flex items-center gap-2">
                        {!sub.isRead && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label="Unread" />}
                        <span className={`truncate text-[13px] text-foreground ${sub.isRead ? 'font-medium' : 'font-semibold'}`}>
                          {sub.formName}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">{sub.createdAt}</span>
                      </div>
                      <span className="truncate text-[12px] font-normal text-muted-foreground">
                        {sub.email || sub.preview || sub.page || '–'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Right: detail pane */}
              <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
                {selected ? (
                  <DetailPane key={selected.id} sub={selected} onToggleRead={toggleRead} onDelete={setDeleteSub} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                    <span className="flex size-11 items-center justify-center rounded-full bg-muted"><InboxGlyph /></span>
                    <p className="text-[13px] font-normal">Select a submission to read it.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {deleteSub && (
        <DeleteDialog sub={deleteSub} onCancel={() => setDeleteSub(null)} onConfirm={confirmDelete} />
      )}
    </div>
  );
}
