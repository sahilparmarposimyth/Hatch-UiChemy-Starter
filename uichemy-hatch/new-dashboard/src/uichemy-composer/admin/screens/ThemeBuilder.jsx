// Theme Builder screen, manage native header / footer / 404 templates.
// Same shadcn card shell as Settings/WhiteLabel, scoped to its own `.uich-tw`
// island. All data flows through the uichemy_theme_builder admin-ajax endpoint
// (see UiChemy_Theme_Builder_Admin) via the tbAjax() helper.
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { tbAjax } from '../data';
import { Icon } from '../icons';
import { CanvasView } from './ThemeBuilderCanvas';
import { LockedTypePanel, TypeBadge, lockedTypeItem, themeBuilderTagline, typeIsAvailable, upsellForType } from '../pro';

// The full list of template types. Every build renders every row: a build that
// does not ship a type still SHOWS it, badged, because a hidden control converts
// at zero. Which types those are is never decided here, the tier module answers
// it (TypeBadge / lockedTypeItem / LockedTypePanel / typeIsAvailable), driven by
// the localized `proTypes` from UiChemy_Template_CPT::FREE_TYPES. The `pro: true`
// flags below are inert documentation of that PHP list, read by nothing.
const TYPES = [
  { key: 'header',          label: 'Header',            desc: 'Displayed at the top of your site.' },
  { key: 'footer',          label: 'Footer',            desc: 'Displayed at the bottom of your site.' },
  { key: 'single',          label: 'Single (Post / Page)', desc: 'Replaces the content of single posts and pages.' },
  { key: 'archive',         label: 'Archive',           desc: 'Category, tag, author, date and blog archive pages.', pro: true },
  { key: 'single_product',  label: 'Single Product',    desc: 'Replaces the layout of a single WooCommerce product.', woo: true, pro: true },
  { key: 'product_archive', label: 'Products Archive',  desc: 'The WooCommerce shop and product category / tag pages.', woo: true, pro: true },
  { key: 'search',          label: 'Search Results',    desc: 'Shown on the search results page.', pro: true },
  { key: 'error_404',       label: '404 Page',          desc: 'Shown when a URL is not found.' },
];

// Types whose display is narrowed by page-level conditions (Conditions dialog).
// The rest apply to a whole request context and are not page-targeted.
const CONDITION_TYPES = ['header', 'footer', 'single', 'archive'];

const LABEL_BY_TYPE = Object.fromEntries(TYPES.map((t) => [t.key, t.label]));

// Type → glyph for the gallery card's header chip (falls back to the generic
// layout glyph). Reuses the existing inline icon set.
const ICON_BY_TYPE = {
  header: 'layout',
  footer: 'layout',
  single: 'book',
  archive: 'list',
  single_product: 'tag',
  product_archive: 'grid',
  search: 'help',
  error_404: 'info',
};

const EMPTY_TEMPLATES = {
  header: [], footer: [], single: [], archive: [],
  single_product: [], product_archive: [], search: [], error_404: [],
};

// Fixed summaries for the whole-context types (no page-level conditions).
const FIXED_SUMMARY = {
  error_404: 'All 404 (not-found) requests',
  search: 'Search results page',
  single_product: 'All WooCommerce products',
  product_archive: 'Shop & product archive pages',
};

// Human-readable one-liner for a template's display conditions.
function conditionSummary(tpl) {
  if (FIXED_SUMMARY[tpl.type]) return FIXED_SUMMARY[tpl.type];
  const entireLabel = tpl.type === 'single' ? 'All posts & pages'
    : tpl.type === 'archive' ? 'All archives' : 'Entire site';

  // v2 rules take precedence when present.
  const rl = tpl.rulesLabels || [];
  if (rl.length) {
    const inc = rl.filter((r) => r.match !== 'exclude').map((r) => r.label).filter(Boolean);
    const exc = rl.filter((r) => r.match === 'exclude').map((r) => r.label).filter(Boolean);
    let base = inc.length ? inc.join(', ') : entireLabel;
    if (exc.length) base += ` · except ${exc.join(', ')}`;
    return base;
  }

  // Legacy scope/include/exclude fallback.
  const c = tpl.conditions || {};
  const inc = tpl.includeLabels || [];
  const exc = tpl.excludeLabels || [];
  let base;
  if (c.scope === 'specific') {
    base = inc.length ? `Only: ${inc.map((p) => p.title).join(', ')}` : 'Specific pages (none selected yet)';
  } else {
    base = entireLabel;
  }
  if (exc.length) base += ` · except ${exc.map((p) => p.title).join(', ')}`;
  return base;
}

// Search-backed multiselect of pages/posts (used for include & exclude lists).
function PostPicker({ label, selected, onChange }) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);

  const runSearch = (value) => {
    setQ(value);
    window.clearTimeout(timer.current);
    if (!value.trim()) { setResults([]); setOpen(false); return; }
    timer.current = window.setTimeout(() => {
      tbAjax('tb_search_posts', { q: value })
        .then((d) => { setResults(d.results || []); setOpen(true); })
        .catch(() => { setResults([]); setOpen(false); });
    }, 250);
  };

  const add = (item) => {
    if (!selected.some((s) => s.id === item.id)) onChange([...selected, { id: item.id, title: item.title }]);
    setQ(''); setResults([]); setOpen(false);
  };
  const remove = (id) => onChange(selected.filter((s) => s.id !== id));

  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-medium text-foreground">{label}</Label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <Badge key={s.id} variant="secondary" className="gap-1 py-1 font-normal">
              {s.title}
              <button type="button" onClick={() => remove(s.id)} className="text-muted-foreground hover:text-foreground">×</button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input value={q} onChange={(e) => runSearch(e.target.value)} placeholder="Search pages or posts…" />
        {open && results.length > 0 && (
          <div className="absolute z-50 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => add(r)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground"
              >
                <span className="truncate">{r.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{r.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Rule-type choices per template type (Core set).
function ruleTypeChoices(tplType) {
  if (tplType === 'archive') {
    return [
      { v: 'entire', t: 'All archives' },
      { v: 'taxonomy', t: 'Taxonomy archive' },
      { v: 'author', t: 'Author archive' },
      { v: 'search', t: 'Search results' },
    ];
  }
  // single / header / footer
  return [
    { v: 'entire', t: 'Entire site' },
    { v: 'post_type', t: 'All of a post type' },
    { v: 'taxonomy', t: 'In a taxonomy term' },
    { v: 'author', t: 'By author' },
    { v: 'singular', t: 'Specific page / post' },
  ];
}

// Seed the rule list from stored rules, else migrate legacy scope/include/exclude.
function initConditionRules(tpl) {
  const rl = tpl.rulesLabels || [];
  if (rl.length) {
    return rl.map((r) => ({
      match: r.match === 'exclude' ? 'exclude' : 'include',
      type: r.type || 'entire',
      value: r.value != null ? r.value : undefined,
      taxonomy: r.taxonomy || undefined,
      term: r.term || 0,
      _label: r.type === 'singular' ? r.label : undefined,
      _termLabel: (r.type === 'taxonomy' && r.term) ? String(r.label).split(': ').slice(1).join(': ') : undefined,
    }));
  }
  const c = tpl.conditions || {};
  const out = [];
  if (c.scope === 'specific') {
    (tpl.includeLabels || []).forEach((p) => out.push({ match: 'include', type: 'singular', value: p.id, _label: p.title }));
  } else {
    out.push({ match: 'include', type: 'entire' });
  }
  (tpl.excludeLabels || []).forEach((p) => out.push({ match: 'exclude', type: 'singular', value: p.id, _label: p.title }));
  return out.length ? out : [{ match: 'include', type: 'entire' }];
}

// Search-backed single-value picker (posts via tb_search_posts, terms via tb_search_terms).
function SearchPick({ placeholder, action, extra, value, label, onPick }) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);

  const run = (val) => {
    setQ(val);
    window.clearTimeout(timer.current);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    timer.current = window.setTimeout(() => {
      tbAjax(action, { q: val, ...(extra || {}) })
        .then((d) => { setResults(d.results || []); setOpen(true); })
        .catch(() => { setResults([]); setOpen(false); });
    }, 250);
  };

  if (value) {
    return (
      <Badge variant="secondary" className="gap-1 py-1 font-normal">
        {label || `#${value}`}
        <button type="button" onClick={() => onPick(0, '')} className="text-muted-foreground hover:text-foreground">×</button>
      </Badge>
    );
  }
  return (
    <div className="relative w-full min-w-[180px]">
      <Input value={q} onChange={(e) => run(e.target.value)} placeholder={placeholder} />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onPick(r.id, r.title); setQ(''); setResults([]); setOpen(false); }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground"
            >
              <span className="truncate">{r.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{r.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Value control for one rule, keyed on its type.
function RuleValue({ rule, opts, onChange }) {
  if (rule.type === 'post_type') {
    return (
      <Select value={rule.value || ''} onValueChange={(v) => onChange({ ...rule, value: v })}>
        <SelectTrigger className="h-8 w-[190px]"><SelectValue placeholder="Choose post type" /></SelectTrigger>
        <SelectContent>{(opts.postTypes || []).map((p) => <SelectItem key={p.slug} value={p.slug}>{p.label}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (rule.type === 'author') {
    return (
      <Select value={String(rule.value != null ? rule.value : 0)} onValueChange={(v) => onChange({ ...rule, value: Number(v) })}>
        <SelectTrigger className="h-8 w-[190px]"><SelectValue placeholder="Author" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Any author</SelectItem>
          {(opts.authors || []).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (rule.type === 'taxonomy') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Select value={rule.taxonomy || ''} onValueChange={(v) => onChange({ ...rule, taxonomy: v, term: 0, _termLabel: '' })}>
          <SelectTrigger className="h-8 w-[150px]"><SelectValue placeholder="Taxonomy" /></SelectTrigger>
          <SelectContent>{(opts.taxonomies || []).map((t) => <SelectItem key={t.slug} value={t.slug}>{t.label}</SelectItem>)}</SelectContent>
        </Select>
        {rule.taxonomy && (
          <SearchPick
            placeholder="Any term, search to narrow…"
            action="tb_search_terms"
            extra={{ taxonomy: rule.taxonomy }}
            value={rule.term || 0}
            label={rule._termLabel}
            onPick={(id, title) => onChange({ ...rule, term: id, _termLabel: title })}
          />
        )}
      </div>
    );
  }
  if (rule.type === 'singular') {
    return (
      <SearchPick
        placeholder="Search page / post…"
        action="tb_search_posts"
        value={rule.value || 0}
        label={rule._label}
        onPick={(id, title) => onChange({ ...rule, value: id, _label: title })}
      />
    );
  }
  return <span className="text-[12px] text-muted-foreground">– applies everywhere in scope –</span>;
}

// Conditions editor, stacked include/exclude rules (header/footer/single/archive).
function ConditionsDialog({ tpl, onClose, onSaved }) {
  const choices = ruleTypeChoices(tpl.type);
  const [opts, setOpts] = React.useState({ postTypes: [], taxonomies: [], authors: [] });
  const [rules, setRules] = React.useState(() => initConditionRules(tpl));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    tbAjax('tb_condition_options').then((d) => { if (alive) setOpts(d || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const updateAt = (i, r) => setRules(rules.map((x, idx) => (idx === i ? r : x)));
  const removeAt = (i) => setRules(rules.filter((_, idx) => idx !== i));
  const addRule = () => setRules([...rules, { match: 'include', type: choices[0].v }]);

  const save = () => {
    setSaving(true);
    const clean = rules.map((r) => {
      const out = { match: r.match === 'exclude' ? 'exclude' : 'include', type: r.type };
      if (r.type === 'post_type') out.value = r.value || '';
      if (r.type === 'author') out.value = Number(r.value || 0);
      if (r.type === 'singular') out.value = Number(r.value || 0);
      if (r.type === 'taxonomy') { out.taxonomy = r.taxonomy || ''; out.term = Number(r.term || 0); }
      return out;
    }).filter((r) => {
      if (r.type === 'post_type') return !!r.value;
      if (r.type === 'singular') return r.value > 0;
      if (r.type === 'taxonomy') return !!r.taxonomy;
      return true; // entire / search / author(any)
    });
    // Send rules[] (backend prefers it); keep legacy fields inert for compatibility.
    const conditions = { rules: clean, scope: 'entire', include: [], exclude: [] };
    tbAjax('tb_update_conditions', { id: tpl.id, conditions })
      .then((updated) => { onSaved(updated); onClose(); })
      .catch(() => setSaving(false));
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="uich-tw sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Display conditions</DialogTitle>
          <DialogDescription>Choose where “{tpl.title}” appears. Rules stack, an Exclude always wins.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] space-y-2 overflow-auto py-1">
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
              <Select value={r.match} onValueChange={(v) => updateAt(i, { ...r, match: v })}>
                <SelectTrigger className="h-8 w-[104px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="include">Include</SelectItem>
                  <SelectItem value="exclude">Exclude</SelectItem>
                </SelectContent>
              </Select>
              <Select value={r.type} onValueChange={(v) => updateAt(i, { match: r.match, type: v })}>
                <SelectTrigger className="h-8 w-[176px]"><SelectValue /></SelectTrigger>
                <SelectContent>{choices.map((t) => <SelectItem key={t.v} value={t.v}>{t.t}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex flex-1 items-center">
                <RuleValue rule={r} opts={opts} onChange={(nr) => updateAt(i, nr)} />
              </div>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:text-destructive"
                title="Remove condition"
                aria-label="Remove condition"
              >×</button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRule}>+ Add condition</Button>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Conditions'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Isolated canvas preview in a modal iframe.
function PreviewDialog({ tpl, onClose }) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="uich-tw w-[92vw] max-w-5xl">
        <DialogHeader>
          <DialogTitle>Preview, {tpl.title || '(untitled)'}</DialogTitle>
          <DialogDescription>
            How this template renders on a clean page.{' '}
            <a href={tpl.previewUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">Open in a new tab ↗</a>
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border bg-white">
          <iframe title="Template preview" src={tpl.previewUrl} className="h-[70vh] w-full border-0" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Styled permanent-delete confirmation (replaces the native window.confirm).
function DeleteDialog({ tpl, onCancel, onConfirm }) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="uich-tw sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this template?</DialogTitle>
          <DialogDescription>
            <b className="text-foreground">“{tpl.title || 'This template'}”</b> will be <b className="text-foreground">permanently deleted</b>. This can’t be undone. It does not go to Trash.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            <Icon name="trash" className="mr-1 size-3.5" />Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A live, zoomed-out render of a template used as a grid thumbnail. Renders the
// isolated preview URL in a non-interactive iframe scaled to the card width.
function ScaledPreview({ url, title, icon }) {
  const boxRef = React.useRef(null);
  const [scale, setScale] = React.useState(0.22);
  const BASE_W = 1440;

  React.useEffect(() => {
    if (!boxRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const el = boxRef.current;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w) setScale(w / BASE_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative h-44 w-full overflow-hidden bg-muted">
      {url ? (
        <>
          <iframe
            title={title || 'Template preview'}
            src={url}
            loading="lazy"
            tabIndex={-1}
            scrolling="no"
            style={{
              width: BASE_W,
              height: Math.round(BASE_W * 0.75),
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              border: 0,
              pointerEvents: 'none',
            }}
          />
          {/* No bottom fade. It was an 80px `from-card to-transparent` gradient
              meant to blend a short or empty template body into the card, but on
              a header template — which is most of this grid — the body IS short,
              so the fade covered nearly half the thumbnail and every preview
              read as if it were dissolving. The preview now ends where it ends. */}
        </>
      ) : (
        // Cover fallback when there's no preview to render: the type glyph and a
        // label on a FLAT --muted surface. This carried a diagonal brand gradient
        // too; the glyph and label already stop the card looking blank, so the
        // gradient was decoration on a placeholder.
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted">
          <span className="flex size-11 items-center justify-center rounded-xl bg-card text-foreground shadow-sm [&_svg]:size-5">
            <Icon name={icon || 'layout'} />
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">No preview</span>
        </div>
      )}
    </div>
  );
}

// Type filter pills, a single horizontally-scrollable row. When the row
// overflows, a soft edge gradient fades in on whichever side has more content,
// hinting that it scrolls (the scrollbar itself is hidden). Pinning "Add New" to
// the right of this in the parent keeps the whole control on one line.
function TypeTabs({ active, onSelect }) {
  const ref = React.useRef(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setEdges({
      left: scrollLeft > 1,
      right: Math.ceil(scrollLeft + clientWidth) < scrollWidth - 1,
    });
  }, []);

  React.useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return undefined;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  const tabs = [{ key: 'all', label: 'All' }, ...TYPES];
  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={ref}
        className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onSelect(f.key)}
            className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition ${
              active === f.key ? 'border-transparent bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-accent'
            }`}
          >
            {f.label}
            <TypeBadge type={f.key} small className="ml-1" />
          </button>
        ))}
      </div>

      {/* Edge fades, only visible when there's off-screen content that way. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent transition-opacity duration-200 ${edges.left ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent transition-opacity duration-200 ${edges.right ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

// Gallery card: live thumbnail + hover "Edit" overlay + a compact action bar.
function GridCard({ tpl, typeLabel, onToggle, onDelete, onConditions, onPreview, onEditElementor }) {
  const isGutenberg = tpl.editor === 'gutenberg';
  const typeIcon = ICON_BY_TYPE[tpl.type] || 'layout';
  const isActive = tpl.status === 'active';
  const editorLabel = isGutenberg ? 'Gutenberg' : 'Elementor';
  const typeDesc = (TYPES.find((t) => t.key === tpl.type) || {}).desc || '';
  const isConditionType = CONDITION_TYPES.includes(tpl.type);

  return (
    <Card className="group flex flex-col gap-4 rounded-2xl p-4 shadow-none">
      {/* Header: title + type description, with the status pill and an overflow
          menu holding every action. */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{tpl.title || '(untitled)'}</p>
          <p className="truncate text-xs text-muted-foreground">{typeDesc || `${typeLabel} template`}</p>
        </div>
        <Badge
          className={`shrink-0 rounded-full border-transparent px-2.5 py-1 text-[11px] ${
            isActive ? 'bg-[#BDEFE7]/50 text-[#0E7C6B]' : 'bg-muted text-muted-foreground'
          }`}
        >
          {isActive ? 'Active' : 'Inactive'}
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-8 shrink-0 px-0 text-muted-foreground" title="More actions">
              <Icon name="more-vertical" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="uich-tw w-52">
            <DropdownMenuItem onSelect={() => onPreview(tpl)}>
              <Icon name="eye" className="mr-2 size-3.5" /> Preview
            </DropdownMenuItem>
            {isConditionType && (
              <DropdownMenuItem onSelect={() => onConditions(tpl)}>
                <Icon name="sliders" className="mr-2 size-3.5" /> Display conditions
              </DropdownMenuItem>
            )}
            {isGutenberg && (
              <DropdownMenuItem onSelect={() => onEditElementor(tpl)}>
                <Icon name="code" className="mr-2 size-3.5" /> Edit in Elementor
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onToggle(tpl, isActive ? 'inactive' : 'active')}>
              <Icon name={isActive ? 'power-off' : 'power'} className="mr-2 size-3.5" /> {isActive ? 'Deactivate' : 'Activate'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDelete(tpl)} className="text-destructive focus:text-destructive">
              <Icon name="trash" className="mr-2 size-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Category-style tag pills, sit above the preview thumbnail. The target
          pill (single / archive only) is what distinguishes e.g. a Single Post
          from a Single Page or an Any-Singular template. */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="rounded-full px-3 py-1 text-[12px] font-normal text-muted-foreground">{typeLabel}</Badge>
        {isConditionType && tpl.targetLabel && (tpl.type === 'single' || tpl.type === 'archive') && (
          <Badge variant="outline" className="rounded-full border-border bg-muted px-3 py-1 text-[12px] font-medium text-foreground">{tpl.targetLabel}</Badge>
        )}
        <Badge variant="outline" className="rounded-full px-3 py-1 text-[12px] font-normal text-muted-foreground">{editorLabel}</Badge>
      </div>

      {/* Inset preview image + hover "Edit" overlay. Pulled out 8px on the
          left/right/bottom so the thumbnail sits 8px from the card edge (the
          gap above it, between the pills and the preview, is left unchanged). */}
      <div className="relative -mx-2 -mb-2 overflow-hidden rounded-xl border">
        <ScaledPreview url={tpl.previewUrl} title={tpl.title} icon={typeIcon} />
        <a
          href={tpl.editUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:bg-foreground/20 group-hover:opacity-100"
        >
          <span className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground shadow">
            <Icon name="edit" className="size-3.5" />Edit {typeLabel}
          </span>
        </a>
      </div>
    </Card>
  );
}

export function ThemeBuilder() {
  const [templates, setTemplates] = React.useState(EMPTY_TEMPLATES);
  const [view, setView] = React.useState('grid');
  const [gridType, setGridType] = React.useState('all');
  const [env, setEnv] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [creating, setCreating] = React.useState('');
  const [condTpl, setCondTpl] = React.useState(null);
  const [previewTpl, setPreviewTpl] = React.useState(null);
  const [deleteTpl, setDeleteTpl] = React.useState(null);

  // Pass { silent: true } to refresh data in the background without flashing the
  // "Loading…" placeholders (used after optimistic actions like toggle/delete).
  const reload = React.useCallback((opts = {}) => {
    const silent = !!(opts && opts.silent);
    if (!silent) setLoading(true);
    return tbAjax('tb_list')
      .then((d) => { setTemplates({ ...EMPTY_TEMPLATES, ...(d.templates || {}) }); setEnv(d.env || null); setError(''); })
      .catch((e) => setError((e && e.message) || 'Failed to load templates.'))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  const conflictLabel = (c) => (c === 'elementor_pro' ? 'Elementor Pro' : c === 'nexter' ? 'Nexter' : c);

  React.useEffect(() => { reload(); }, [reload]);

  const create = (type) => {
    // Belt-and-braces: every UI path already routes locked types to pricing, and
    // PHP rejects them anyway, this stops any other caller creating one in a
    // build that does not ship the type. Handled entirely by the tier module,
    // which sends the user to pricing and reports that it took over; the Pro
    // stub always returns false, so creation just proceeds.
    if (upsellForType(type)) {
      return;
    }
    // Create the template (inactive, Gutenberg by default) and open it straight
    // in the block editor. The card offers "Edit with Elementor" for users who
    // prefer Elementor.
    setCreating(type);
    tbAjax('tb_create', { tpl_type: type })
      .then((tpl) => { if (tpl && tpl.editUrl) window.open(tpl.editUrl, '_blank', 'noreferrer'); reload({ silent: true }); })
      .catch((e) => setError((e && e.message) || 'Could not create template.'))
      .finally(() => setCreating(''));
  };

  // Switch a template to Elementor and open it there.
  const editWithElementor = (tpl) => {
    tbAjax('tb_set_editor', { id: tpl.id, editor: 'elementor' })
      .then((updated) => { if (updated && updated.elementorUrl) window.open(updated.elementorUrl, '_blank', 'noreferrer'); reload({ silent: true }); })
      .catch(() => reload({ silent: true }));
  };

  const toggle = (tpl, status) => {
    // Reflect the final state instantly: activating one also deactivates every
    // other template of the same type (one active per type) in the SAME update,
    // so there's no lag where both look active. The background request + silent
    // refresh just confirm it.
    setTemplates((prev) => ({
      ...prev,
      [tpl.type]: prev[tpl.type].map((t) => {
        if (t.id === tpl.id) return { ...t, status };
        return status === 'active' ? { ...t, status: 'inactive' } : t;
      }),
    }));
    tbAjax('tb_set_status', { id: tpl.id, status })
      .then(() => reload({ silent: true }))
      .catch(() => reload({ silent: true }));
  };

  const confirmDelete = () => {
    const tpl = deleteTpl;
    if (!tpl) return;
    setDeleteTpl(null);
    // Optimistically remove the card, then reconcile silently.
    setTemplates((prev) => ({ ...prev, [tpl.type]: prev[tpl.type].filter((t) => t.id !== tpl.id) }));
    tbAjax('tb_delete', { id: tpl.id })
      .then(() => reload({ silent: true }))
      .catch(() => reload({ silent: true }));
  };

  const onConditionsSaved = (updated) => {
    setTemplates((prev) => ({ ...prev, [updated.type]: prev[updated.type].map((t) => (t.id === updated.id ? updated : t)) }));
  };

  return (
    <div className="uich-tw">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-foreground">Theme Builder</h1>
            {/* Only promise the template types this build actually ships, listing
                archive and search in Free contradicts the Pro crowns on the filter
                pills directly below. Each plugin owns its own sentence, so neither
                build carries the other's copy. */}
            <p className="mt-1 text-[13px] text-muted-foreground">{themeBuilderTagline()}</p>
          </div>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v)}
            className="shrink-0 gap-1 rounded-lg border bg-muted/40 p-0.5"
          >
            {[
              { v: 'grid', icon: 'grid', label: 'Grid view', text: 'Grid' },
              { v: 'canvas', icon: 'canvas', label: 'Canvas view', text: 'Canvas' },
            ].map((o) => (
              <ToggleGroupItem
                key={o.v}
                value={o.v}
                title={o.label}
                className="h-auto gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
              >
                <Icon name={o.icon} className="size-3.5" />
                {o.text}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="ptn-scroll flex min-h-0 flex-1 flex-col gap-7 pb-2">
          {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-[13px] text-destructive">{error}</div>}

          {env && !env.headerFooterSupported && (
            <div className="rounded-md border border-l-[3px] border-l-foreground/40 bg-muted/40 px-4 py-2.5 text-[13px] text-muted-foreground">
              <b className="text-foreground">Heads up:</b> your active theme doesn’t expose header/footer locations for UiChemy to hook into, so <b>Header</b> and <b>Footer</b> templates may not appear on the front end. <b>Single</b> and <b>404</b> templates work on any theme. (Fully supported: block themes and Elementor-compatible themes like Hello Elementor.)
            </div>
          )}
          {env && env.conflicts && env.conflicts.length > 0 && (
            <div className="rounded-md border border-l-[3px] border-l-foreground/40 bg-muted/40 px-4 py-2.5 text-[13px] text-muted-foreground">
              <b className="text-foreground">Another theme builder is active</b> ({env.conflicts.map(conflictLabel).join(', ')}). UiChemy won’t disable it, avoid activating a UiChemy header/footer at the same time to prevent a duplicate.
            </div>
          )}

          {view === 'grid' && (() => {
            const flatAll = TYPES.flatMap((t) => templates[t.key] || []);
            const items = gridType === 'all' ? flatAll : (templates[gridType] || []);
            const activeType = TYPES.find((t) => t.key === gridType);
            return (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <TypeTabs active={gridType} onSelect={setGridType} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" disabled={!!creating} className="shrink-0">
                        <Icon name="plus" className="mr-1 size-3.5" />
                        {creating ? 'Creating…' : 'Add New'}
                        <Icon name="chevron-down" className="ml-1 size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="uich-tw w-48">
                      {/* A build that does not ship a type renders its own row for
                          it (badged, opening pricing). Pro's stub returns null for
                          every type, so the normal item is always used and none of
                          that row's markup is compiled in. */}
                      {TYPES.map((t) => lockedTypeItem(t) || (
                        <DropdownMenuItem key={t.key} onSelect={() => create(t.key)}>
                          {t.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* When the selected type is one this build does not ship, say so
                    rather than showing a bare "no templates yet" state. The whole
                    card, markup and copy, lives in the tier module; Pro's stub
                    returns null, so none of it is compiled into that bundle. */}
                <LockedTypePanel type={activeType} />

                {/* "design it now" only makes sense for a type this build can
                    actually create, otherwise the panel above already explains
                    why the list is empty. typeIsAvailable() is always true in the
                    build that ships every type. */}
                {activeType && activeType.woo && typeIsAvailable(activeType.key) && env && !env.woocommerce && (
                  <p className="text-[12px] text-muted-foreground">Renders only when WooCommerce is active. You can design it now.</p>
                )}

                {loading ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2].map((k) => (
                      <div key={k} className="overflow-hidden rounded-lg border">
                        <Skeleton className="aspect-[16/10] w-full rounded-none" />
                        <div className="space-y-2 p-3">
                          <Skeleton className="h-3.5 w-32" />
                          <div className="flex items-center gap-2 pt-1">
                            <Skeleton className="h-5 w-9 rounded-full" />
                            <div className="flex-1" />
                            <Skeleton className="size-7 rounded-md" />
                            <Skeleton className="size-7 rounded-md" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
                    <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M3 9h18M9 21V9" />
                      </svg>
                    </span>
                    <p className="text-sm font-semibold text-foreground">
                      No {activeType ? `${activeType.label.toLowerCase()} ` : ''}templates yet
                    </p>
                    <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
                      Use <span className="font-medium text-foreground">Add New</span> above to create your first {activeType ? activeType.label.toLowerCase() : 'template'}.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-muted/50 p-3">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((tpl) => (
                      <GridCard
                        key={tpl.id}
                        tpl={tpl}
                        typeLabel={LABEL_BY_TYPE[tpl.type] || tpl.type}
                        onToggle={toggle}
                        onDelete={setDeleteTpl}
                        onConditions={setCondTpl}
                        onPreview={setPreviewTpl}
                        onEditElementor={editWithElementor}
                      />
                    ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {view === 'canvas' && <CanvasView />}
        </div>
      </div>

      {condTpl && (
        <ConditionsDialog tpl={condTpl} onClose={() => setCondTpl(null)} onSaved={onConditionsSaved} />
      )}
      {previewTpl && (
        <PreviewDialog tpl={previewTpl} onClose={() => setPreviewTpl(null)} />
      )}
      {deleteTpl && (
        <DeleteDialog tpl={deleteTpl} onCancel={() => setDeleteTpl(null)} onConfirm={confirmDelete} />
      )}
    </div>
  );
}
