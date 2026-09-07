// Dependencies bar, per-scope 3rd-party assets + catalog picker.
import React from 'react';
import ReactDOM from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { I } from './composer-icons';
import { LIBRARY_CATALOG, depKindPill } from './composer-libraries';
import { useSlidingSeg } from './composer-inputs';
import { ensurePortalRoot } from '@/components/ui/portal-context';
import { computePickerPosition } from './composer-floating';

// ── shadcn recipes (mirrors composer-layers' MENU_ITEM_CLS conventions) ───────
const SEG_WRAP_CLS = 'inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5';
const SEG_ITEM_CLS = 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground';
const SEG_ITEM_ON_CLS = 'bg-background text-foreground shadow-sm';
/* On a `seg-slide` track the wrapper draws the chip and it travels, so the
   active item keeps only its ink — `bg-background` + `shadow-sm` here would
   paint a second, stationary chip on top of the moving one. */
const SEG_ITEM_ON_SLIDE_CLS = 'text-foreground';
const MENU_ITEM_CLS =
  'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent disabled:pointer-events-none disabled:opacity-50';
const MICRO_LABEL_CLS = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const SELECT_CLS =
  'flex h-8 appearance-none rounded-md border border-input bg-transparent px-2.5 pr-7 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Native <select> restyled to the shadcn input recipe (appearance-none drops
// the platform arrow, so we overlay our own chevron icon).
function NativeSelect({ className, wrapClassName, children, ...props }) {
  const T = I;
  return (
    <span className={cn('relative inline-flex shrink-0', wrapClassName)}>
      <select className={cn(SELECT_CLS, className)} {...props}>{children}</select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
        <T.chevron size={9} />
      </span>
    </span>
  );
}

// ── LocationDropdown ─────────────────────────────────────────────────────────
function LocationDropdown({ position, onChange }) {
  const T = I;
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    function onDoc(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const isBefore = !position || position === 'before';
  const label = isBefore ? 'before </head>' : 'before </body>';

  return (
    <div className={`dep-attrs-dd${open ? ' open' : ''}`} ref={ref}>
      <Button
        type="button"
        variant={open ? 'secondary' : 'outline'}
        size="sm"
        className="h-7 max-w-[180px] gap-1.5 px-2.5 text-xs font-normal [&_svg]:size-2.5"
        onClick={() => setOpen(o => !o)}
        title="Injection location"
      >
        <span className="truncate">{label}</span>
        <T.chevron size={9} />
      </Button>
      {open && (
        <div className="dep-attrs-menu dep-loc-menu rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="dep-attrs-section">Inject into</div>
          <button
            className={`dep-attrs-row${isBefore ? ' on' : ''}`}
            onClick={() => { onChange('before'); setOpen(false); }}
          >
            <span className="radio" />
            <span className="dep-attrs-name">before &lt;/head&gt;</span>
            <span className="dep-attrs-hint">styles &amp; preloads</span>
          </button>
          <button
            className={`dep-attrs-row${!isBefore ? ' on' : ''}`}
            onClick={() => { onChange('after'); setOpen(false); }}
          >
            <span className="radio" />
            <span className="dep-attrs-name">before &lt;/body&gt;</span>
            <span className="dep-attrs-hint">scripts at end</span>
          </button>
        </div>
      )}
    </div>
  );
}


// ── DepSettingsPopover ────────────────────────────────────────────────────────
// Every per-dependency setting lives here now. The row itself used to carry the
// kind pill, version, URL and two inline selects, which in the narrow dock
// collapsed into an unreadable smear of truncated text — the library's NAME, the
// one thing the row exists to show, got the least space of all. The row keeps
// the on/off switch and the name; the pencil opens this panel for the rest.
//
// A dropdown anchored to its own pencil, not a centred modal: these are row
// settings, and a full-screen dialog for "is this script deferred" dims the very
// list you are working through. Portalled + position:fixed for the same reason
// AddLibraryButton is — inside the narrow dock an absolutely positioned panel
// gets squeezed to the column's width.
//
// Edits commit as you make them, exactly as the old inline selects did, so
// dismissing by clicking away can't silently drop what you just changed. Text
// fields commit on blur or Enter rather than per keystroke, which keeps every
// letter typed into the URL from rewriting the injected tag.
function DepSettingsPopover({ dep, scope, triggerRef, onSave, onClose }) {
  const T = I;
  const ref = React.useRef(null);
  const [anchor, setAnchor] = React.useState(null);
  const [draft, setDraft] = React.useState(() => ({
    name: dep.name || '', v: dep.v || '', url: dep.url || '',
  }));

  const showLocation = scope === 'page' || scope === 'site';

  // Matches `.dep-settings-float`'s width in composer.css; the positioner needs
  // the real box size to pick a side.
  const FLOAT_W = 288;
  const FLOAT_H = showLocation ? 396 : 336;

  const reposition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    try {
      // The trigger's own window, not the bundle's: these panels also open from
      // surfaces that render in the Elementor preview iframe.
      const win = el.ownerDocument?.defaultView || window;
      setAnchor(computePickerPosition(el.getBoundingClientRect(), FLOAT_W, FLOAT_H, win));
    } catch (_) { setAnchor(null); }
  }, [triggerRef, FLOAT_H]);

  // Before paint, so the panel never shows up at 0,0 for a frame.
  React.useLayoutEffect(() => { reposition(); }, [reposition]);

  React.useEffect(() => {
    function onDoc(e) {
      if (ref.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      onClose();
    }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // The row lives in a scrollable dock, so a fixed panel measured once drifts
    // away from its pencil the moment anything scrolls. Capture-phase so nested
    // scrollers count too.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [onClose, reposition, triggerRef]);

  const attrs = Array.isArray(dep.attrs) ? dep.attrs : [];
  const has = (a) => attrs.includes(a);
  const order = has('defer') ? 'defer' : has('async') ? 'async' : 'default';
  const media = has('print') ? 'print' : has('all') ? 'all' : '';

  function setOrder(next) {
    const rest = attrs.filter((x) => x !== 'defer' && x !== 'async');
    if (next !== 'default') rest.push(next);
    onSave({ attrs: rest });
  }
  // media="all" / media="print" are alternatives, not a pair.
  function setMedia(next) {
    const rest = attrs.filter((x) => x !== 'all' && x !== 'print');
    if (next) rest.push(next);
    onSave({ attrs: rest });
  }
  function toggleModule() {
    const rest = attrs.filter((x) => x !== 'module');
    if (rest.length === attrs.length) rest.push('module');
    onSave({ attrs: rest });
  }
  // Only write when the value actually moved — a blur with nothing typed
  // shouldn't count as an edit and re-inject the tag.
  function commit(field) {
    const next = draft[field];
    if (next === (dep[field] || '')) return;
    onSave({ [field]: next });
  }

  return ReactDOM.createPortal(
    <div
      className="dep-settings-float"
      ref={ref}
      role="dialog"
      aria-label="Library settings"
      style={anchor ? { left: anchor.left, top: anchor.top } : { visibility: 'hidden' }}
    >
      <div className="dep-settings-head">
        <strong title={dep.name}>{dep.name || 'Library'}</strong>
        <button type="button" className="dep-settings-x" onClick={onClose} title="Close">
          <T.x size={12} />
        </button>
      </div>

      <div className="dep-settings-body">
        <label className="dep-field">
          <span className={MICRO_LABEL_CLS}>Type</span>
          <NativeSelect
            className="h-8 w-full text-xs"
            wrapClassName="w-full"
            value={dep.kind === 'script' ? 'script' : 'style'}
            onChange={(e) => onSave({ kind: e.target.value })}
          >
            <option value="script">JavaScript (.js)</option>
            <option value="style">Stylesheet (.css)</option>
          </NativeSelect>
        </label>

        <label className="dep-field">
          <span className={MICRO_LABEL_CLS}>Name</span>
          <Input
            className="h-8 text-xs"
            placeholder="Name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => commit('name')}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </label>

        <label className="dep-field">
          <span className={MICRO_LABEL_CLS}>Version</span>
          <Input
            className="h-8 text-xs"
            placeholder="3.12.5"
            value={draft.v}
            onChange={(e) => setDraft({ ...draft, v: e.target.value })}
            onBlur={() => commit('v')}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </label>

        <label className="dep-field">
          <span className={MICRO_LABEL_CLS}>URL</span>
          <Input
            className="h-8 text-xs"
            placeholder="https://…"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            onBlur={() => commit('url')}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </label>

        <label className="dep-field">
          <span className={MICRO_LABEL_CLS}>Load order</span>
          <NativeSelect className="h-8 w-full text-xs" wrapClassName="w-full" value={order}
            onChange={(e) => setOrder(e.target.value)}>
            <option value="default">Default</option>
            <option value="defer">Defer</option>
            <option value="async">Async</option>
          </NativeSelect>
        </label>

        {showLocation && (
          <label className="dep-field">
            <span className={MICRO_LABEL_CLS}>Inject into</span>
            <NativeSelect className="h-8 w-full text-xs" wrapClassName="w-full" value={dep.position || 'before'}
              onChange={(e) => onSave({ position: e.target.value })}>
              <option value="before">before &lt;/head&gt;</option>
              <option value="after">before &lt;/body&gt;</option>
            </NativeSelect>
          </label>
        )}

        {dep.kind === 'script' ? (
          <label className="dep-field dep-field-check">
            <input type="checkbox" checked={has('module')} onChange={toggleModule} />
            <span>
              <span className="dep-field-check-name">type="module"</span>
              <span className="dep-field-check-hint">Load as an ES module</span>
            </span>
          </label>
        ) : (
          <label className="dep-field">
            <span className={MICRO_LABEL_CLS}>Apply to</span>
            <NativeSelect className="h-8 w-full text-xs" wrapClassName="w-full" value={media}
              onChange={(e) => setMedia(e.target.value)}>
              <option value="">Every device (default)</option>
              <option value="all">media="all"</option>
              <option value="print">media="print"</option>
            </NativeSelect>
          </label>
        )}
      </div>

      {/* Removal is a one-click icon on the row itself, so this footer carries
          only the dismiss. The Remove button that used to sit here was a
          bare ghost button with its own hover colour — the one control in the
          panel that matched nothing else around it. */}
      <div className="dep-settings-foot">
        <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>,
    ensurePortalRoot(document),
  );
}

// ── DepRow ─────────────────────────────────────────────────────────────────────
function DepRow({ dep, scope, onToggle, onRemove, onChange }) {
  const T = I;
  const [open, setOpen] = React.useState(false);
  const pencilRef = React.useRef(null);
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <div className={`dep${dep.enabled ? '' : ' disabled'}${open ? ' dep-open' : ''}`}>
      {/* The design system's Switch, not a hand-rolled button. The bespoke one
          this replaces was built out of `--panel-bg-3` / `--text-mid`, and in the
          Elementor skin those map to `hsl(var(--background))` and a dim
          secondary-text token — i.e. the track was literally the panel colour
          behind it and the knob was near-invisible against it, which is why it
          kept rendering as an empty outlined pill however the colours were
          retuned. Switch is styled from the shadcn tokens directly
          (`bg-primary` / `bg-input` / thumb `bg-background`), which every skin
          is required to keep legible, and it brings the correct
          role="switch" + keyboard behaviour with it.
          The focus ring is suppressed by request — an outline around the pill
          broke its shape against the row. */}
      <Switch
        checked={!!dep.enabled}
        onCheckedChange={onToggle}
        aria-label={dep.enabled ? `Disable ${dep.name}` : `Enable ${dep.name}`}
        title={dep.enabled ? 'Disable this dependency' : 'Enable'}
        className={cn(
          'focus-visible:ring-0 focus-visible:ring-offset-0',
          /* Scaled down from the component's default 36x20, which was bulky
             against a 24px row. Marked important on purpose: these fight the
             Switch's OWN utilities, and `h-4` vs its `h-5` — like the thumb's
             translate vs its `translate-x-4` — are equal-specificity, so
             without `!` the winner would be whichever Tailwind happens to emit
             last. Geometry: 28x16 track, `border-2` leaves a 24x12 inner box,
             so a 12px thumb travels exactly 12px (translate-x-3) to sit flush
             at the far edge. Change one of the three and the other two have to
             move with it. */
          '!h-4 !w-7 [&>span]:!size-3 [&>[data-state=checked]]:!translate-x-3',
          /* Dark-mode legibility. Switch ships `border-2 border-transparent`,
             and its OFF colours are `bg-input` for the track (#27272a in dark)
             with a `bg-background` thumb (near-black) — two near-blacks on a
             near-black panel, so an OFF row's switch all but disappeared.
             Colouring that already-reserved border makes the pill's edge
             visible without changing its geometry, and lifting the OFF thumb to
             `muted-foreground` gives it something to read against inside the
             track. Both are scoped to the unchecked state; ON is a filled
             `bg-primary` track that was never hard to see. */
          'data-[state=unchecked]:border-muted-foreground/40',
          '[&>[data-state=unchecked]]:bg-muted-foreground'
        )}
      />

      {/* The URL is the tooltip rather than a column of its own — it is the
          detail you check occasionally, not the one you scan the list by. */}
      <span className="dep-name" title={dep.url ? String(dep.url).replace('{v}', dep.v) : dep.name}>
        {dep.name}
      </span>

      <Button
        ref={pencilRef}
        type="button"
        variant={open ? 'secondary' : 'ghost'}
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-3"
        title="Library settings"
        onClick={() => setOpen((o) => !o)}
      >
        <T.pencil size={11} />
      </Button>

      {/* Same ghost icon button as the pencil, only its hover colour differs —
          removal is the destructive one of the pair, and the shared shape is
          what keeps the row reading as one control group. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive [&_svg]:size-3"
        title={`Remove ${dep.name || 'library'}`}
        onClick={onRemove}
      >
        <T.trash size={11} />
      </Button>

      {/* Mounted only while open, so the draft it holds is seeded fresh from the
          dep every time rather than carrying a stale one between openings. */}
      {open && (
        <DepSettingsPopover
          dep={dep}
          scope={scope}
          triggerRef={pencilRef}
          onSave={onChange}
          onClose={close}
        />
      )}
    </div>
  );
}

// ── AddLibraryButton ───────────────────────────────────────────────────────────
function AddLibraryButton({ scope, onPendingSelect, onAddCustom, alreadyAdded }) {
  const tabSegRef = useSlidingSeg();
  const T = I;
  const [open, setOpen]   = React.useState(false);
  const [q, setQ]         = React.useState('');
  const [tab, setTab]     = React.useState('catalog');
  const [custom, setCustom] = React.useState({ url: '', kind: 'script', name: '', v: '' });
  // position state is used by the Custom URL tab
  const [position, setPosition] = React.useState('before');
  const ref = React.useRef(null);
  // The dialog is PORTALLED out of the panel, so it is not inside `ref`. Without
  // a second node to test, the outside-click check below treats every click on
  // the dialog's own fields as "outside" and shuts it on first use.
  const dialogRef = React.useRef(null);
  // Where the floating panel sits, measured from the trigger.
  const [anchor, setAnchor] = React.useState(null);

  // Matches `.dep-add-float`'s width in composer.css. The positioner has to know
  // the box's real size to pick a side, so the two must stay in step.
  const FLOAT_W = 320;
  // Never trim the panel below this — a sliver of a library list is worse than
  // one that overflows a little and scrolls.
  const MIN_FLOAT_H = 240;
  const MAX_FLOAT_H = 460;

  // Anchor the (position:fixed) panel to the trigger, preferring straight BELOW
  // it and aligned to its edge — the same rule every other float in the composer
  // follows, via the shared positioner.
  //
  // This used to hand-roll its own math, and only ever tried to open UPWARD:
  //   top = clamp(trigger.top - 8 - H)
  // With a 460px panel and a trigger ~360px down the dock, that expression goes
  // negative and clamps to `top: 8`, so the panel jumped to the top-left of the
  // VIEWPORT — nowhere near the button, and visually unrelated to it. Below the
  // trigger fit the whole time; the old code simply never offered it as an
  // option. computePickerPosition tries below first, then above, then the
  // opposite edge alignment, and only flips when a side genuinely overflows.
  const reposition = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const r = el.getBoundingClientRect();
      const win = el.ownerDocument.defaultView || window;

      // Size to the room the trigger actually has before choosing a side, rather
      // than always asking for 460px. A panel taller than the space above AND
      // below fits on neither, so the positioner is forced out to the trigger's
      // side — on-screen, but floating off on its own, which is the same
      // "unrelated to the button" complaint in a shorter window. Taking the
      // better of the two gaps keeps it attached: full height in a roomy
      // viewport, trimmed (and internally scrolling) in a cramped one.
      const GAP = 6;
      const PAD = 8;
      const below = win.innerHeight - PAD - (r.bottom + GAP);
      const above = (r.top - GAP) - PAD;
      const H = Math.max(MIN_FLOAT_H, Math.min(MAX_FLOAT_H, Math.max(below, above)));

      const pos = computePickerPosition(r, FLOAT_W, H, win);
      setAnchor({ left: pos.left, top: pos.top, height: H });
    } catch (_) { setAnchor(null); }
  }, []);

  const showLocationPicker = scope === 'page' || scope === 'site';

  React.useEffect(() => {
    function onDoc(e) {
      if (ref.current?.contains(e.target)) return;
      if (dialogRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    if (open) {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      // The trigger lives in a scrollable dock, so a fixed panel measured once at
      // open time drifts away from it the moment anything scrolls. Capture-phase
      // so nested scrollers count too, matching UnitPill.
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
    }
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  const lib = LIBRARY_CATALOG;
  const filtered = q
    ? lib.filter(l =>
        l.name.toLowerCase().includes(q.toLowerCase()) ||
        l.id.toLowerCase().includes(q.toLowerCase()) ||
        l.category.toLowerCase().includes(q.toLowerCase())
      )
    : lib;
  const byCat = {};
  for (const l of filtered) {
    (byCat[l.category] ||= []).push(l);
  }

  // Picking a catalog entry ADDS it. It used to open the library's website in a
  // new tab instead, leaving the user to copy a URL and retype it under Custom
  // URL — the row looked like an "add" button and behaved like a link, which is
  // the confusing part. The catalog now carries a pinned `url`, and the import
  // path (onPendingSelect → commitDep) already existed and was simply never
  // called from here.
  function addLibrary(l) {
    if (!l || !l.url) return;
    if (alreadyAdded && alreadyAdded.has(l.id)) return;
    onPendingSelect?.({
      id: l.id,
      name: l.name,
      v: l.v || '–',
      // The catalog's `font` kind is a display distinction only — a font IS a
      // stylesheet, and the dep layer only knows script | style.
      kind: l.kind === 'script' ? 'script' : 'style',
      url: l.url,
      brief: l.brief,
      category: l.category,
      attrs: l.attrs ? [...l.attrs] : undefined,
      enabled: true,
      position,
    });
    setOpen(false);
    setQ('');
  }

  // Reading the docs is still one click, just no longer the ONLY thing a click
  // can do — it moved to its own control on the row.
  function openLibSite(l) {
    if (l && l.site) {
      window.open(l.site, '_blank', 'noopener,noreferrer');
    }
  }

  // Auto-detect the asset type from a URL the user just pasted. We only
  // promote, never silently downgrade, so an explicit "font" pick the user
  // already made via the Type dropdown survives if they then paste a URL
  // that doesn't itself look like a font.
  function detectKindFromUrl(url, currentKind) {
    const u = String(url || '').toLowerCase();
    if (u.includes('fonts.googleapis.com') || u.includes('fonts.bunny.net')) {
      return 'font';
    }
    // Strip query/hash before looking at extension.
    const bare = u.split('?')[0].split('#')[0];
    if (bare.endsWith('.css')) return 'style';
    if (bare.endsWith('.js') || bare.endsWith('.mjs')) return 'script';
    return currentKind || 'script';
  }

  // The local `custom.kind` tracks the *UI* type, 'script' | 'style' | 'font'.
  // The dep itself only knows 'script' or 'style' (font is just a style
  // dep visually re-skinned via URL host detection), so we collapse here.
  function uiKindToDepKind(uiKind) {
    return uiKind === 'font' ? 'style' : (uiKind === 'style' ? 'style' : 'script');
  }

  function addCustom() {
    if (!custom.url.trim()) return;
    const uiKind = custom.kind || detectKindFromUrl(custom.url, 'script');
    const depKind = uiKindToDepKind(uiKind);
    const id = 'custom_' + Date.now();
    const name = custom.name.trim() || (custom.url.split('/').pop() || 'custom');
    onAddCustom({
      id, name,
      v: custom.v.trim() || '–',
      kind: depKind,
      url: custom.url,
      brief: uiKind === 'font' ? 'Custom font' : 'Custom URL',
      category: 'Custom',
      enabled: true,
      position,
    });
    setCustom({ url: '', kind: 'script', name: '', v: '' });
    setOpen(false);
  }

  return (
    <div className={`dep-add${open ? ' open' : ''}`} ref={ref}>
      <Button
        type="button"
        variant={open ? 'secondary' : 'outline'}
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3"
        onClick={() => {
          setOpen((o) => {
            if (o) return false;
            reposition();
            return true;
          });
        }}
      >
        <T.plus size={12} />
        <span>Add library</span>
      </Button>
      {open && ReactDOM.createPortal(
        /* Portalled out of the panel, on purpose. This popover was position:absolute
           with max-width:100%, so in the narrow right dock it shrank to the
           footer's width and six stacked fields had to fit a ~280px column —
           under two further levels of tabs, inside a scroll area. Portalled and
           position:fixed it keeps its full 320px whatever the dock does; it is
           anchored to the trigger by `reposition` above. */
        <div
          className="dep-add-float"
          ref={dialogRef}
          role="dialog"
          aria-label="Add library"
          style={anchor ? { left: anchor.left, top: anchor.top, height: anchor.height } : undefined}
        >
          <div className="dep-add-float-head">
            <strong>Add library</strong>
            <button type="button" className="dep-add-float-x" onClick={() => setOpen(false)} aria-label="Close">
              <T.x size={13} />
            </button>
          </div>
          <div className="flex items-center gap-0.5 border-b border-border p-1.5">
            <div ref={tabSegRef} className={cn(SEG_WRAP_CLS, 'seg-slide', 'w-full')}>
              <button type="button" data-state={tab === 'catalog' ? 'active' : 'inactive'} className={cn(SEG_ITEM_CLS, 'flex-1 justify-center [&_svg]:size-3', tab === 'catalog' && SEG_ITEM_ON_SLIDE_CLS)} onClick={() => setTab('catalog')}>
                <T.layers size={11} /> Catalog
              </button>
              <button type="button" data-state={tab === 'custom' ? 'active' : 'inactive'} className={cn(SEG_ITEM_CLS, 'flex-1 justify-center [&_svg]:size-3', tab === 'custom' && SEG_ITEM_ON_SLIDE_CLS)} onClick={() => setTab('custom')}>
                <T.code size={11} /> Custom URL
              </button>
            </div>
          </div>

          {/* ── Catalog tab, click selects; pending row appears in the dep list ── */}
          {tab === 'catalog' && (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-muted-foreground">
                <T.search size={11} />
                <input
                  autoFocus
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Search GSAP, Three, Swiper…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button type="button" className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground" onClick={() => setQ('')} title="Clear">
                    <T.x size={10} />
                  </button>
                )}
              </div>
              <div className={cn('flex items-start gap-1.5 px-2 pb-1 pt-1 text-[11px] text-muted-foreground')}>
                <T.bolt size={11} />
                <span>Adds a pinned CDN asset. Use <b>Custom URL</b> for anything not listed.</span>
              </div>
              <div className="lib-list">
                {Object.entries(byCat).map(([cat, items]) => (
                  <React.Fragment key={cat}>
                    <div className={cn('px-2 pb-1 pt-2', MICRO_LABEL_CLS)}>{cat}</div>
                    {items.map(l => {
                      const added = !!(alreadyAdded && alreadyAdded.has(l.id));
                      return (
                      /* Row = add. The docs link is a nested control, so the two
                         actions are distinguishable instead of one pretending to
                         be the other. Not a <button> inside a <button> — that is
                         invalid HTML and the inner one stops working. */
                      <div key={l.id} className={cn(MENU_ITEM_CLS, 'lib-row', added && 'is-added')}>
                        <button
                          type="button"
                          className="lib-row-add"
                          disabled={added}
                          onClick={() => addLibrary(l)}
                          title={added ? `${l.name} is already added` : `Add ${l.name} ${l.v && l.v !== '–' ? l.v : ''}`.trim()}
                        >
                          {(() => { const p = depKindPill(l); return (
                            <span className={`dep-kind ${p.cls}`} title={p.title}>{p.label}</span>
                          ); })()}
                          <span className="flex min-w-0 flex-1 flex-col items-start">
                            <span className="text-xs font-medium">
                              {l.name}
                              {l.v && l.v !== '–' && (
                                <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">{l.v}</span>
                              )}
                            </span>
                            <span className="w-full truncate text-left text-[11px] text-muted-foreground">{l.brief}</span>
                          </span>
                          {added && <span className="lib-row-added" title="Already added"><T.check size={11} /></span>}
                        </button>
                        <button
                          type="button"
                          className="lib-row-site"
                          onClick={(e) => { e.stopPropagation(); openLibSite(l); }}
                          title={`Open the ${l.name} docs in a new tab`}
                          aria-label={`Open the ${l.name} docs in a new tab`}
                        >
                          <T.link size={11} />
                        </button>
                      </div>
                      );
                    })}
                  </React.Fragment>
                ))}
                {filtered.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">Nothing matches "{q}".</div>
                )}
              </div>
            </>
          )}

          {/* ── Custom URL tab, has its own Add button, commits directly ── */}
          {tab === 'custom' && (() => {
            // Per-kind hints. The font branch nudges users toward the Google
            // Fonts CSS2 endpoint; style and script branches keep the
            // examples that match the corresponding asset type.
            const uiKind = custom.kind || 'script';
            const urlPlaceholder = (
              uiKind === 'font'  ? 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap'
            : uiKind === 'style' ? 'https://cdn.example.com/lib.min.css'
            :                      'https://cdn.example.com/lib.min.js'
            );
            const namePlaceholder = (
              uiKind === 'font'  ? 'Inter'
            : uiKind === 'style' ? 'my-styles'
            :                      'my-lib'
            );
            const versionDisabled = uiKind === 'font'; // Google Fonts has no version axis.
            const footHint = (
              uiKind === 'font'
                ? 'Adds a <link> to Google/Bunny Fonts. Font names auto-appear in the Font Family dropdown.'
                : "Loads before this scope's code runs."
            );
            return (
            <div className="dep-add-custom">
              <label>Name (optional)
                <Input
                  className="h-8"
                  placeholder={namePlaceholder}
                  value={custom.name}
                  onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                />
              </label>
              <div className="dep-add-row-2">
                <label>Version (optional)
                  <Input
                    className="h-8"
                    placeholder={versionDisabled ? '–' : '1.0.0'}
                    value={custom.v}
                    onChange={(e) => setCustom({ ...custom, v: e.target.value })}
                    disabled={versionDisabled}
                  />
                </label>
                <label>Type
                  <NativeSelect className="w-full" wrapClassName="w-full" value={uiKind} onChange={(e) => setCustom({ ...custom, kind: e.target.value })}>
                    <option value="script">JavaScript (.js)</option>
                    <option value="style">Stylesheet (.css)</option>
                    <option value="font">Font (Google / Bunny Fonts)</option>
                  </NativeSelect>
                </label>
              </div>
              <label>URL
                <Input
                  className="h-8"
                  autoFocus
                  placeholder={urlPlaceholder}
                  value={custom.url}
                  onChange={(e) => {
                    const url = e.target.value;
                    // Auto-promote the Type when the URL clearly indicates a
                    // font or stylesheet. Never silently demote, an
                    // explicit user pick from the Type dropdown is sticky
                    // unless the new URL itself is unambiguous.
                    const detected = detectKindFromUrl(url, uiKind);
                    const nextKind = (
                      detected === 'font'                ? 'font'  :
                      detected === 'style' && uiKind !== 'font' ? 'style' :
                                                          uiKind
                    );
                    setCustom({ ...custom, url, kind: nextKind });
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
                />
              </label>
              <div className="dep-add-custom-foot">
                {showLocationPicker
                  ? <LocationDropdown position={position} onChange={setPosition} />
                  : <span className="dep-add-hint text-[11px] text-muted-foreground">{footHint}</span>
                }
                <Button type="button" size="sm" className="h-7 gap-1 px-2.5 text-xs [&_svg]:size-3" onClick={addCustom} disabled={!custom.url}>
                  <T.plus size={11} /> Add
                </Button>
              </div>
            </div>
            );
          })()}
        </div>,
        ensurePortalRoot(document),
      )}
    </div>
  );
}

// ── DependenciesBar ────────────────────────────────────────────────────────────
export function DependenciesBar({ scope, deps, setDeps, onAssetAddedToCode, onAssetRemovedFromCode, onAssetReplacedInCode }) {
  const T = I;
  const depKindOf = (d) => (d.kind === 'script' ? 'script' : 'style');
  const [cssOpen, setCssOpen] = React.useState(true);
  const [jsOpen,  setJsOpen]  = React.useState(false);

  function update(idx, patch) {
    const prev = deps[idx];
    const next = [...deps];
    next[idx] = { ...prev, ...patch };
    setDeps(next);

    // If the injection position flipped (head ↔ body) or the URL/version
    // changed, rewrite the matching tag in the code editor so the live code
    // stays in sync with the dep row.
    const positionChanged = 'position' in patch && (patch.position || 'before') !== (prev.position || 'before');
    const urlChanged      = 'url' in patch && patch.url !== prev.url;
    const verChanged      = 'v'   in patch && patch.v   !== prev.v;
    const kindChanged     = 'kind' in patch && patch.kind !== prev.kind;
    const attrsChanged    = 'attrs' in patch && JSON.stringify(patch.attrs || []) !== JSON.stringify(prev.attrs || []);
    // Toggling enabled doesn't remove the tag, it switches between the
    // raw tag and an HTML-commented version so the user can see and
    // re-enable from the editor too.
    const enabledChanged  = 'enabled' in patch && Boolean(patch.enabled) !== Boolean(prev.enabled);
    if (positionChanged || urlChanged || verChanged || kindChanged || attrsChanged || enabledChanged) {
      // Replace atomically, remove + add against the SAME snapshot, so we
      // don't double-write the same state slot with two stale closures
      // (which is what caused duplicate tags to appear on every edit).
      if (typeof onAssetReplacedInCode === 'function') {
        onAssetReplacedInCode(prev, next[idx]);
      } else {
        if (typeof onAssetRemovedFromCode === 'function') onAssetRemovedFromCode(prev);
        if (typeof onAssetAddedToCode    === 'function') onAssetAddedToCode(next[idx]);
      }
    }
  }
  function remove(idx) {
    const prev = deps[idx];
    const next = [...deps];
    next.splice(idx, 1);
    setDeps(next);
    if (typeof onAssetRemovedFromCode === 'function' && prev) onAssetRemovedFromCode(prev);
  }
  function commitDep(dep) {
    setDeps([...deps, dep]);
    if (typeof onAssetAddedToCode === 'function') onAssetAddedToCode(dep);
  }

  // Custom URL adds go directly (already have position from the popover).
  function handleAddCustom(dep) {
    commitDep(dep);
  }

  const alreadyAdded = new Set(deps.map(d => d.id));
  const cssRows = deps.map((d, i) => ({ d, i })).filter(({ d }) => depKindOf(d) === 'style');
  const jsRows  = deps.map((d, i) => ({ d, i })).filter(({ d }) => depKindOf(d) === 'script');

  function renderSection(label, kindRows, isOpen, setOpen, emptyMsg) {
    const hasDeps = kindRows.length > 0;
    return (
      <div className={`acc${isOpen ? ' open' : ''}`}>
        <button type="button" className="acc-head" onClick={() => setOpen(o => !o)} aria-expanded={isOpen ? 'true' : 'false'}>
          <span className="acc-label">{label}</span>
          {hasDeps && <span className="acc-dot" />}
          <span className="acc-caret"><T.chevron size={10} /></span>
        </button>
        {isOpen && (
          <div className="acc-body" style={{ padding: '6px 0' }}>
            {kindRows.length === 0 ? (
              <div className="deps-empty text-xs text-muted-foreground">
                <T.bolt size={12} /> {emptyMsg}
              </div>
            ) : kindRows.map(({ d, i }) => (
              <DepRow
                key={d.id + ':' + i}
                dep={d}
                scope={scope}
                onToggle={() => update(i, { enabled: !d.enabled })}
                onRemove={() => remove(i)}
                onChange={(patch) => update(i, patch)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="deps-bar acc-list">
      {renderSection('CSS', cssRows, cssOpen, setCssOpen, 'No CSS libraries yet. Add a stylesheet, a font, or paste any CDN .css URL.')}
      {renderSection('JS',  jsRows,  jsOpen,  setJsOpen,  'No JS libraries yet. Add GSAP, Three.js, Swiper, or paste any CDN .js URL.')}
      <div className="deps-foot">
        <AddLibraryButton
          scope={scope}
          onPendingSelect={(dep) => commitDep({ ...dep, position: dep.position || 'before' })}
          onAddCustom={handleAddCustom}
          alreadyAdded={alreadyAdded}
        />
      </div>
    </div>
  );
}
