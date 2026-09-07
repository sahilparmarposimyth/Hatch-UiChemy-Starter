// Theme Builder — Canvas (site-architecture) view.
// A pannable / zoomable map of the WordPress template hierarchy, mirroring
// Nexter's four-group layout (Structural / Singular / Archives / Special) but
// driven by UiChemy's own /tb_architecture endpoint and our real types+targets.
// Custom-built (no flow library): SVG edges + absolutely-positioned nodes in a
// CSS-transformed "world", with zoom / pan / wheel-zoom / fit / full-screen and a
// minimap. Styled with the shared shadcn tokens (.uich-tw scope).
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Icon } from '../icons';
import { tbAjax } from '../data';
import { LockedSlotCount, LockedSlotPanel, ProBadge, slotPresentation, upsellForType } from '../pro';

const COLS = 3;
/* 280, the reference card's true width. That Figma frame sits at 0.88 scale
   (246.4 = 280 × 0.88, 14.08 = 16 × 0.88, 8.8 = 10 × 0.88), so every value in
   this card is the unscaled original rather than a guess. Widening from 232 also
   lets the type sit at the reference's real sizes instead of a squeezed copy —
   CAT_WIDTH is derived from CARD_W, so the whole graph reflows to suit. */
const CARD_W = 280;
/* Content-sized, at the reference's real metrics: 16 pad + 20 title + 8 + 17.5
   path + 12 + 1 rule + 14 + 17.5 action + 16 pad. Rows tighten to suit;
   ROW_GAP is unchanged so the edges keep their curve. */
const CARD_H = 124;
const CARD_GAP = 22;
const ROW_GAP = 56;
const CAT_W = 206;
const CAT_H = 52;
const CAT_GAP = 60;
const HUB_W = 236;
const HUB_H = 70;
const HUB_Y = 0;
const CAT_Y = 152;
const CHILD_Y = 286;
const CAT_WIDTH = COLS * CARD_W + (COLS - 1) * CARD_GAP;
const ZERO = { dx: 0, dy: 0 };

const CATS = [
  { key: 'structural', label: 'Structural', icon: 'layout' },
  { key: 'singular', label: 'Singular', icon: 'book' },
  { key: 'archive', label: 'Archives', icon: 'inbox' },
  { key: 'special', label: 'Special', icon: 'star' },
];

/* One icon per CARD, not one per group. The reference gives every node its own
   page icon (a different exported glyph on each card); ours has to do the same or
   the row reads as six copies of one card. The glyphs are OURS — this icon set,
   monochrome, same language as the rest of the panel — which is the "our things"
   half of same-structure-different-branding.

   Matched on substrings of `slot.key` rather than an exhaustive key list, so a
   slot the backend adds later still lands on something sensible instead of the
   generic fallback. Ordered: the first match wins, so the specific cases sit
   above the broad ones ('author'/'date'/'categor' before 'archive', 'front'
   before 'page'). Every name here was checked against the icon map — a name that
   isn't in it renders nothing, silently. */
const SLOT_ICON_RULES = [
  ['front', 'home'],
  ['author', 'users'],
  ['date', 'calendar'],
  ['categor', 'tag'],
  ['tag', 'tag'],
  ['search', 'help'],
  ['404', 'info'],
  ['error', 'info'],
  ['blog', 'list'],
  ['posts', 'list'],
  ['product_archive', 'grid'],
  ['product', 'tag'],
  ['archive', 'inbox'],
  ['header', 'layout'],
  ['footer', 'layout'],
  ['page', 'layout'],
  ['post', 'book'],
  ['singular', 'book'],
  ['single', 'book'],
];

function slotIcon(slot, fallback) {
  const k = String(slot.key || '').toLowerCase();
  const hit = SLOT_ICON_RULES.find(([frag]) => k.indexOf(frag) !== -1);
  return hit ? hit[1] : (fallback || 'layout');
}

function buildGraph(slots, site) {
  const groups = {};
  CATS.forEach((c) => { groups[c.key] = []; });
  slots.forEach((s) => { (groups[s.group] || (groups[s.group] = [])).push(s); });

  const nodes = [];
  const edges = [];
  const catCenter = {};
  let left = Infinity;
  let right = -Infinity;
  let bottom = CHILD_Y;

  CATS.forEach((cat, ci) => {
    const list = groups[cat.key] || [];
    const blockX = ci * (CAT_WIDTH + CAT_GAP);
    const catCardX = blockX + (CAT_WIDTH - CAT_W) / 2;
    catCenter[cat.key] = catCardX + CAT_W / 2;

    // "built / total" counts only slots this build can actually fill, so Free
    // never shows an all-Pro group as "0/9" unfinished work. The Pro slots are
    // still drawn (and counted separately) so the hierarchy stays complete.
    const own = list.filter((s) => !slotIsPro(s));
    nodes.push({
      id: `cat-${cat.key}`, kind: 'cat', x: catCardX, y: CAT_Y, cat,
      total: own.length, built: own.filter((s) => s.filled).length,
      pro: list.length - own.length,
    });
    left = Math.min(left, catCardX);
    right = Math.max(right, catCardX + CAT_W);

    list.forEach((slot, i) => {
      const x = blockX + (i % COLS) * (CARD_W + CARD_GAP);
      const y = CHILD_Y + Math.floor(i / COLS) * (CARD_H + ROW_GAP);
      nodes.push({ id: `slot-${slot.key}`, kind: 'slot', x, y, slot, icon: cat.icon });
      left = Math.min(left, x);
      right = Math.max(right, x + CARD_W);
      bottom = Math.max(bottom, y + CARD_H);
      const empty = !slot.filled;
      // A Pro slot is never "missing" in Free — that styling means "you should
      // fix this", and there is nothing here for a Free user to fix.
      edges.push({ id: `e-${slot.key}`, nodeKey: slot.key, x1: catCenter[cat.key], y1: CAT_Y + CAT_H, x2: x + CARD_W / 2, y2: y, empty, missing: empty && slot.critical && !slotIsPro(slot) });
    });
  });

  const hubX = (left + right) / 2 - HUB_W / 2;
  const gaps = slots.filter((s) => s.critical && !s.filled && !slotIsPro(s)).length;
  nodes.unshift({ id: 'hub', kind: 'hub', x: hubX, y: HUB_Y, site, gaps });
  CATS.forEach((cat) => {
    if ((groups[cat.key] || []).length) {
      edges.unshift({ id: `eh-${cat.key}`, x1: hubX + HUB_W / 2, y1: HUB_Y + HUB_H, x2: catCenter[cat.key], y2: CAT_Y, hub: true });
    }
  });

  return { nodes, edges, worldW: Math.max(right, hubX + HUB_W) + 40, worldH: bottom + 40 };
}

// A slot whose template type this build doesn't ship. The architecture endpoint
// returns the full hierarchy regardless of build — that's correct, the slots exist
// on the site either way — so the question is answered here in the view, by the
// tier module. slotPresentation() returns the card's whole locked appearance (all
// of its copy included) or null; the build that ships every type always gets null,
// so it compiles in none of that copy and every slot below reads as ordinary.
function slotIsPro(slot) {
  return !!slotPresentation(slot);
}

function slotStatus(slot) {
  // Locked slots come before missing/empty: they are not gaps this build's user
  // can fill, so they must never be painted as a problem to fix.
  if (slotIsPro(slot)) return 'pro';
  if (!slot.filled) return slot.critical ? 'missing' : 'empty';
  return (slot.templates || []).some((t) => t.status === 'active') ? 'active' : 'inactive';
}

/* Sitemap node card, ported from the sitemap design (Figma
   3672:8685) and re-skinned onto our tokens. Anatomy taken from that reference:

     icon + title            20px icon, 14px medium, tight tracking
     path / subtitle         12px medium, muted
     1px rule
     action link             12px medium, in the BRAND colour
     corner ribbon           status, top-right, clipped to the card's radius
     connector handle        8px dot at top-centre, where the edge lands

   Two deliberate departures from the reference. It is a dark card (#0e0e11) and
   ours is WHITE — asked for explicitly — so every value is a token
   (bg-card / border / text-foreground / text-muted-foreground) and follows the
   theme instead of being pinned. And its action link is blue (#2d69eb); ours is
   `text-primary`, our own orange, because that link is the brand accent in this
   card and the reference's blue is theirs.

   The old 88px skeleton preview strip is gone with it: three grey bars were
   standing in for a page thumbnail this canvas never had. */
function SlotCard({ slot, icon, x, y, onDragStart }) {
  const n = (slot.templates || []).length;
  // A locked slot's entire appearance — title, status word, badge, hover label
  // and icon — comes from the tier module as one object, so none of that copy
  // sits in this shared file. `null` (always, in the build that ships every
  // type) means the ordinary presentation below is used.
  const tier = slotPresentation(slot);
  const status = tier ? 'pro' : slotStatus(slot);
  const view = tier || {
    statusText: { active: 'Active', inactive: 'Inactive', missing: 'Missing', empty: 'Empty' }[status],
    badge: n > 0 ? `${n} template${n > 1 ? 's' : ''}` : 'No templates',
    hoverIcon: n > 0 ? 'edit' : 'plus',
    hoverLabel: n > 0 ? 'Manage' : 'Set up',
    title: n > 0 ? 'Drag to move · click to manage templates' : 'Drag to move · click to set up this slot',
  };
  // The reference tints the card's own border by state (its published cards use
  // a green border, not a neutral one). Same idea on our palette: green when a
  // template is live, destructive when a critical slot is empty, otherwise the
  // ordinary border.
  const borderCls = status === 'active' ? 'border-[#0E7C6B]/45'
    : status === 'missing' ? 'border-destructive/45'
      : 'border-border';
  // Ribbon only where it means something. An empty non-critical slot is not a
  // problem, so it gets no flag at all rather than a grey one.
  // `check` / `alert` do not exist in this icon set (checked the map, 43 names) —
  // `check-circle` and `info` are the closest that do. A name that isn't in the
  // map renders nothing at all, silently, so the ribbon would have been an empty
  // coloured triangle.
  const ribbon = status === 'active' ? { bg: 'bg-[#0E7C6B]', icon: 'check-circle' }
    : status === 'missing' ? { bg: 'bg-destructive', icon: 'info' }
      : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseDown={(e) => { e.stopPropagation(); onDragStart(slot.key, e); }}
      title={view.title}
      className={`group absolute cursor-grab rounded-[10px] border bg-card shadow-sm transition hover:shadow-md active:cursor-grabbing ${borderCls} ${tier ? 'opacity-90' : ''}`}
      style={{ left: x, top: y, width: CARD_W, minHeight: CARD_H }}
    >
      {/* Connector handle. The SVG edge for this slot ends at exactly
          (x + CARD_W / 2, y), so the dot sits on the join instead of near it.
          The card must NOT be overflow-hidden for this to show. */}
      <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full border bg-background" />

      {/* Status ribbon. Its own overflow-hidden + matching top-right radius does
          the clipping, so the card stays unclipped for the handle above. */}
      {ribbon && (
        <span className="absolute right-0 top-0 size-8 overflow-hidden rounded-tr-[10px]">
          <span className={`absolute inset-0 ${ribbon.bg}`} style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
          <Icon name={ribbon.icon} className="absolute right-1 top-1 size-3 text-white" />
        </span>
      )}

      <div className="p-4">
        {/* pr-7 keeps a long title clear of the ribbon rather than under it. */}
        <div className="flex items-center gap-2 pr-8">
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
            <Icon name={slotIcon(slot, icon)} className="size-[18px]" />
          </span>
          <p className="truncate text-[16px] font-medium tracking-[-0.4px] text-foreground">{slot.label}</p>
        </div>

        <p className="truncate pt-2 text-[14px] font-medium leading-[17.5px] text-muted-foreground">
          {slot.sub_label || view.statusText}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3.5">
          <span className="inline-flex items-center gap-1.5 text-[14px] font-medium tracking-[-0.35px] text-primary">
            {tier ? <ProBadge small /> : <Icon name={view.hoverIcon} className="size-3.5" />}
            {view.hoverLabel}
          </span>
          <span className="shrink-0 truncate text-[12px] text-muted-foreground">{view.badge}</span>
        </div>
      </div>
    </div>
  );
}

// In-canvas modal (rendered inside the canvas wrapper so it also shows in
// full-screen). Lists the slot's templates with manage actions, or a create
// button when empty.
function SlotModal({ slot, onClose, onCreate, onStatus, onDelete, busy }) {
  const templates = slot.templates || [];
  const active = templates.filter((t) => t.status === 'active').length;
  const pro = slotIsPro(slot);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-foreground/40 p-4" onMouseDown={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="flex max-h-[86%] w-[min(640px,94%)] flex-col overflow-hidden rounded-xl border bg-card shadow-xl" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">{slot.label}</h2>
              {pro && <ProBadge small />}
              {!pro && !templates.length && slot.critical && <Badge variant="destructive" className="text-[10px]">Missing</Badge>}
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {slot.sub_label ? `${slot.sub_label} · ` : ''}
              {templates.length ? `${active}/${templates.length} active` : 'No templates yet'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <Icon name="close" className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-5 py-4">
          {pro ? (
            // Panel markup and copy come from the per-plugin pro module, so Pro's
            // bundle carries neither. onCreate already routes a locked type to
            // pricing rather than to tb_create.
            <LockedSlotPanel slot={slot} onUpgrade={() => onCreate(slot)} />
          ) : templates.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-[13px] text-muted-foreground">
                {slot.critical
                  ? 'No template here. Visitors get the active theme’s default.'
                  : 'No template assigned to this slot yet.'}
              </p>
              <Button size="sm" className="mt-3" disabled={busy} onClick={() => onCreate(slot)}>
                <Icon name="plus" className="mr-1 size-3.5" />{busy ? 'Creating…' : 'Create template'}
              </Button>
            </div>
          ) : templates.map((t) => (
            <div key={t.id} className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-2 ${t.status === 'active' ? '' : 'opacity-80'}`}>
              <div className="min-w-0 flex-1">
                <a href={t.editUrl} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium text-foreground hover:underline">{t.title || '(untitled)'}</a>
                <span className="text-[11px] text-muted-foreground">{t.status === 'active' ? 'Active' : 'Inactive'} · {t.editor === 'gutenberg' ? 'Gutenberg' : 'Elementor'}</span>
              </div>
              <Switch checked={t.status === 'active'} onCheckedChange={(v) => onStatus(t, v ? 'active' : 'inactive')} />
              <a href={t.previewUrl} target="_blank" rel="noreferrer" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Preview"><Icon name="eye" className="size-3.5" /></a>
              <a href={t.editUrl} target="_blank" rel="noreferrer" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit"><Icon name="edit" className="size-3.5" /></a>
              <button type="button" onClick={() => onDelete(t)} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive" title="Delete"><Icon name="trash" className="size-3.5" /></button>
            </div>
          ))}
        </div>

        {!pro && templates.length > 0 && (
          <div className="border-t px-5 py-3">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onCreate(slot)}>
              <Icon name="plus" className="mr-1 size-3.5" />{busy ? 'Creating…' : 'Add another template'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CanvasView() {
  const wrapRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const [size, setSize] = React.useState({ w: 1000, h: 560 });
  const [view, setView] = React.useState({ scale: 0.8, x: 40, y: 20 });
  const [dragging, setDragging] = React.useState(false);
  const [fs, setFs] = React.useState(false);
  const [openKey, setOpenKey] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [nodePos, setNodePos] = React.useState({});
  const nodeDragRef = React.useRef(null);

  const load = React.useCallback(() => {
    tbAjax('tb_architecture')
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError((e && e.message) || 'Failed to load architecture.'));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const graph = React.useMemo(() => {
    if (!data) return null;
    const g = buildGraph(data.slots || [], data.site || {});
    // stash slot node coords onto the slot for SlotCard.
    g.nodes.forEach((nd) => { if (nd.kind === 'slot') { nd.slot.__x = nd.x; nd.slot.__y = nd.y; } });
    return g;
  }, [data]);

  const worldW = graph ? graph.worldW : 1200;
  const worldH = graph ? graph.worldH : 700;

  React.useEffect(() => {
    if (!wrapRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = React.useCallback(() => {
    const pad = 40;
    const s = Math.max(0.2, Math.min((size.w - pad * 2) / worldW, (size.h - pad * 2) / worldH, 1.1));
    setView({ scale: s, x: (size.w - worldW * s) / 2, y: Math.max(pad, (size.h - worldH * s) / 2) });
  }, [size, worldW, worldH]);
  React.useEffect(() => { fit(); }, [fit]);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      // Ctrl/Cmd + wheel → zoom toward the cursor. Shift + wheel → pan left/right.
      // Plain wheel → pan up/down (and left/right on trackpads with deltaX).
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        setView((p) => {
          const scale = Math.min(1.8, Math.max(0.2, +(p.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(3)));
          const k = scale / p.scale;
          return { scale, x: px - (px - p.x) * k, y: py - (py - p.y) * k };
        });
      } else if (e.shiftKey) {
        const dx = e.deltaX || e.deltaY;
        setView((p) => ({ ...p, x: p.x - dx }));
      } else {
        setView((p) => ({ ...p, x: p.x - (e.deltaX || 0), y: p.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  React.useEffect(() => {
    const onFsChange = () => setFs(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFs = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
    else if (el.requestFullscreen) el.requestFullscreen();
  };

  const zoomBy = (dir) => setView((p) => {
    const scale = Math.min(1.8, Math.max(0.2, +(p.scale * (dir > 0 ? 1.15 : 1 / 1.15)).toFixed(3)));
    const cx = size.w / 2;
    const cy = size.h / 2;
    const k = scale / p.scale;
    return { scale, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k };
  });

  const startNodeDrag = (key, e) => {
    const cur = nodePos[key] || ZERO;
    nodeDragRef.current = { key, sx: e.clientX, sy: e.clientY, ox: cur.dx, oy: cur.dy, moved: false };
    setDragging(true);
  };

  const onDown = (e) => { dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; setDragging(true); };
  const onMove = (e) => {
    if (nodeDragRef.current) {
      const d = nodeDragRef.current;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
      const dx = d.ox + (e.clientX - d.sx) / view.scale;
      const dy = d.oy + (e.clientY - d.sy) / view.scale;
      setNodePos((p) => ({ ...p, [d.key]: { dx, dy } }));
      return;
    }
    if (!dragRef.current) return;
    const d = dragRef.current;
    setView((p) => ({ ...p, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onUp = () => {
    if (nodeDragRef.current) {
      const d = nodeDragRef.current;
      nodeDragRef.current = null;
      setDragging(false);
      if (!d.moved) setOpenKey(d.key); // a click (no drag) opens the popup
      return;
    }
    dragRef.current = null;
    setDragging(false);
  };

  const doCreate = (slot) => {
    // Mirrors ThemeBuilder's create(): a type this build does not ship goes to
    // pricing rather than to tb_create, which would reject it as an "Invalid
    // template type" and show a validation error where an upgrade prompt belongs.
    // The tier module owns both the decision and the redirect; its Pro stub always
    // returns false, so creation simply proceeds.
    if (upsellForType(slot && slot.type)) {
      return;
    }
    setBusy(true);
    tbAjax('tb_create', { tpl_type: slot.type, target: slot.target })
      .then((tpl) => { if (tpl && tpl.editUrl) window.open(tpl.editUrl, '_blank', 'noreferrer'); load(); })
      .catch((e) => setError((e && e.message) || 'Could not create template.'))
      .finally(() => setBusy(false));
  };
  const doStatus = (tpl, status) => { tbAjax('tb_set_status', { id: tpl.id, status }).then(load).catch(load); };
  const doDelete = (tpl) => { tbAjax('tb_delete', { id: tpl.id }).then(load).catch(load); };

  const openSlot = (data && openKey) ? (data.slots || []).find((s) => s.key === openKey) : null;

  // Minimap.
  const mmW = 176;
  const mmH = 120;
  const mmPad = 6;
  const mmScale = Math.min((mmW - mmPad * 2) / worldW, (mmH - mmPad * 2) / worldH);
  const vpX = -view.x / view.scale;
  const vpY = -view.y / view.scale;

  /* The flow lines are GREY, not brand orange. A filled edge used to draw in
     `--primary`, so on a full graph the orange became the loudest thing on the
     canvas — an accent repeated 18 times reads as decoration, and the cards it
     connects are the content. Grey at low opacity lets the lines do their one
     job (showing what hangs off what) and stay behind the cards.
     `--destructive` survives for a critical slot with nothing in it, because
     that line is a signal rather than structure. Say the word and it greys too. */
  const edgeStroke = (e) => (e.missing ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))');

  return (
    <div
      ref={wrapRef}
      className={`relative w-full flex-1 min-h-[520px] select-none overflow-hidden border ${fs ? 'rounded-none bg-background' : 'rounded-lg bg-muted/20'}`}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onDoubleClick={toggleFs}
    >
      {error && (
        <div className="absolute inset-x-0 top-0 z-10 m-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-[13px] text-destructive">{error}</div>
      )}
      {!graph && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">Loading site map…</div>
      )}

      {graph && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width: worldW, height: worldH }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={worldW} height={worldH}>
            {graph.edges.map((e) => {
              const o = e.nodeKey ? (nodePos[e.nodeKey] || ZERO) : ZERO;
              const x2 = e.x2 + o.dx;
              const y2 = e.y2 + o.dy;
              const my = (e.y1 + y2) / 2;
              return (
                <path key={e.id} d={`M ${e.x1} ${e.y1} C ${e.x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
                  fill="none" stroke={edgeStroke(e)} strokeWidth={e.hub ? 1.4 : 1.2}
                  /* Thinner and quieter than before, now that the colour no longer
                     carries the emphasis. The dashed empty edges keep the highest
                     value of the three: a broken line reads lighter than a solid
                     one at the same opacity, so matching them would make the
                     empty slots the faintest thing rather than the clearest gap. */
                  strokeDasharray={e.empty ? '4 4' : '0'} opacity={e.hub ? 0.4 : e.empty ? 0.55 : 0.45} />
              );
            })}
          </svg>

          {graph.nodes.map((nd) => {
            if (nd.kind === 'hub') {
              return (
                <div key={nd.id} className="absolute flex flex-col items-center justify-center rounded-xl border bg-primary px-4 text-center text-primary-foreground shadow-md"
                  style={{ left: nd.x, top: nd.y, width: HUB_W, height: HUB_H }}>
                  <span className="max-w-full truncate text-[13px] font-medium">{nd.site.name || 'Your site'}</span>
                  {nd.site.url ? <span className="max-w-full truncate text-[10px] opacity-80">{nd.site.url}</span> : null}
                  <span className="mt-0.5 text-[10px] opacity-75">{nd.gaps > 0 ? `${nd.gaps} slot${nd.gaps > 1 ? 's' : ''} missing` : 'All key slots filled'}</span>
                  {/* Same one-dot rule as the group nodes below: this is the root
                      parent, so its handle sits at the bottom edge where its
                      edges to each group leave. */}
                  <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full border border-primary-foreground/40 bg-primary" />
                </div>
              );
            }
            if (nd.kind === 'cat') {
              return (
                <div key={nd.id} className="absolute flex items-center gap-2 rounded-lg border bg-card px-2.5 shadow-sm"
                  style={{ left: nd.x, top: nd.y, width: CAT_W, height: CAT_H }}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"><Icon name={nd.cat.icon} className="size-4" /></span>
                  <span className="flex-1 truncate text-[13px] font-medium text-foreground">{nd.cat.label}</span>
                  {nd.total > 0 && (
                    <Badge variant="outline" className="shrink-0 px-1.5 text-[10px] text-muted-foreground">{nd.built}/{nd.total}</Badge>
                  )}
                  {/* Count of slots in this group whose type this build does not
                      ship. Badge and its wording come from the tier module; the
                      build that ships every type has no such slots and its stub
                      returns null, so neither the count nor the copy appears. */}
                  <LockedSlotCount count={nd.pro} />
                  {/* Connector handle. In the reference every node carries ONE
                      dot, sited where its edge actually joins — children at the
                      top, the parent at the bottom. This node is a parent: its
                      edges leave at (catCenter, CAT_Y + CAT_H), i.e. exactly
                      here. */}
                  <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rounded-full border bg-background" />
                </div>
              );
            }
            {
              const o = nodePos[nd.slot.key] || ZERO;
              return <SlotCard key={nd.id} slot={nd.slot} icon={nd.icon} x={nd.x + o.dx} y={nd.y + o.dy} onDragStart={startNodeDrag} />;
            }
          })}
        </div>
      )}

      {openSlot && (
        <SlotModal
          slot={openSlot}
          busy={busy}
          onClose={() => setOpenKey(null)}
          onCreate={doCreate}
          onStatus={doStatus}
          onDelete={doDelete}
        />
      )}

      <button type="button" title={fs ? 'Exit full screen' : 'Full screen'} onMouseDown={(e) => e.stopPropagation()} onClick={toggleFs}
        className="absolute right-3 top-3 flex h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-[12px] font-medium text-foreground shadow-sm transition hover:bg-accent">
        <Icon name={fs ? 'shrink' : 'expand'} className="size-3.5" />{fs ? 'Exit' : 'Full screen'}
      </button>

      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <button type="button" title="Zoom in" onMouseDown={(e) => e.stopPropagation()} onClick={() => zoomBy(1)} className="flex h-8 w-8 items-center justify-center hover:bg-accent"><Icon name="plus" className="size-4" /></button>
        <button type="button" title="Zoom out" onMouseDown={(e) => e.stopPropagation()} onClick={() => zoomBy(-1)} className="flex h-8 w-8 items-center justify-center border-t hover:bg-accent"><Icon name="minus" className="size-4" /></button>
        <button type="button" title="Fit to screen" onMouseDown={(e) => e.stopPropagation()} onClick={fit} className="flex h-8 w-8 items-center justify-center border-t hover:bg-accent"><Icon name="maximize" className="size-4" /></button>
      </div>

      {graph && (
        <div className="absolute bottom-3 right-3 overflow-hidden rounded-md border bg-card/90 shadow-sm" style={{ width: mmW, height: mmH }}>
          <svg width={mmW} height={mmH}>
            <g transform={`translate(${mmPad}, ${mmPad}) scale(${mmScale})`}>
              {graph.nodes.map((nd) => {
                const w = nd.kind === 'hub' ? HUB_W : nd.kind === 'cat' ? CAT_W : CARD_W;
                const h = nd.kind === 'hub' ? HUB_H : nd.kind === 'cat' ? CAT_H : CARD_H;
                let fill = 'hsl(var(--muted-foreground) / 0.3)';
                if (nd.kind === 'hub') fill = 'hsl(var(--primary))';
                else if (nd.kind === 'cat') fill = 'hsl(var(--primary) / 0.55)';
                else if (nd.slot.filled) fill = 'hsl(var(--primary) / 0.45)';
                else if (nd.slot.critical) fill = 'hsl(var(--destructive) / 0.5)';
                const o = nd.kind === 'slot' ? (nodePos[nd.slot.key] || ZERO) : ZERO;
                return <rect key={nd.id} x={nd.x + o.dx} y={nd.y + o.dy} width={w} height={h} rx="10" fill={fill} />;
              })}
              <rect x={vpX} y={vpY} width={size.w / view.scale} height={size.h / view.scale} fill="none" stroke="hsl(var(--primary))" strokeWidth={2 / mmScale} rx={6} />
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
