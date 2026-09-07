// Layers tree (left side of Direct Editor tab). Reads layer entries
// produced by composer-layer-tree from the active widget's raw_html.
import React from 'react';
import ReactDOM from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ensurePortalRoot } from '@/components/ui/portal-context';
import { I, TAG_ICON } from './composer-icons';
import { isDescendantOrSelf, tagCanHaveChildren } from './composer-layer-tree';

const DRAG_MIME = 'application/x-uich-layer-id';

// shadcn menu-item recipe shared by the layer context menu + add-layer rows.
const MENU_ITEM_CLS =
  'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent disabled:pointer-events-none disabled:opacity-50';

// One glyph per tag, from the TAG_ICON map. Falls back to a plain square for a
// custom tag we have no mapping for, and to `dynamic` for an unrecognised
// `uichemy-*` tag so it still reads as data-backed rather than as a generic box.
export function tagIcon(tag) {
  const t = String(tag || '').toLowerCase();
  const hit = Object.prototype.hasOwnProperty.call(TAG_ICON, t) ? TAG_ICON[t] : null;
  if (hit) return hit;
  if (t.startsWith('uichemy-')) return I.dynamic;
  return I.box;
}

// ── AddLayer dropdown ─────────────────────────────────────────────────────────
// Catalog of insertable element tags grouped by category. Powers the empty
// state's "Add Layer" picker and is filterable by typing. The "Dynamic" group
// pulls our custom `uichemy-*` tags so they're first-class options here too.
export const ELEMENT_GROUPS = [
  {
    title: 'Containers',
    items: [
      { tag: 'div',     label: 'Generic block' },
      { tag: 'section', label: 'Section' },
      { tag: 'article', label: 'Article' },
      { tag: 'header',  label: 'Header' },
      { tag: 'footer',  label: 'Footer' },
      { tag: 'main',    label: 'Main content' },
      { tag: 'nav',     label: 'Navigation' },
      { tag: 'aside',   label: 'Sidebar' },
      { tag: 'figure',  label: 'Figure' },
      { tag: 'figcaption', label: 'Figure caption' },
      { tag: 'address', label: 'Address block' },
    ],
  },
  {
    title: 'Headings & Text',
    items: [
      { tag: 'h1',   label: 'Heading 1' },
      { tag: 'h2',   label: 'Heading 2' },
      { tag: 'h3',   label: 'Heading 3' },
      { tag: 'h4',   label: 'Heading 4' },
      { tag: 'h5',   label: 'Heading 5' },
      { tag: 'h6',   label: 'Heading 6' },
      { tag: 'p',    label: 'Paragraph' },
      { tag: 'blockquote', label: 'Blockquote' },
      { tag: 'pre',  label: 'Preformatted text' },
      { tag: 'hr',   label: 'Horizontal rule' },
      { tag: 'br',   label: 'Line break' },
    ],
  },
  {
    title: 'Inline',
    items: [
      { tag: 'span',   label: 'Inline span' },
      { tag: 'strong', label: 'Strong emphasis' },
      { tag: 'em',     label: 'Emphasis' },
      { tag: 'mark',   label: 'Highlight' },
      { tag: 'small',  label: 'Small print' },
      { tag: 's',      label: 'Strikethrough' },
      { tag: 'u',      label: 'Underline' },
      { tag: 'code',   label: 'Inline code' },
      { tag: 'kbd',    label: 'Keyboard input' },
      { tag: 'sub',    label: 'Subscript' },
      { tag: 'sup',    label: 'Superscript' },
      { tag: 'abbr',   label: 'Abbreviation' },
      { tag: 'cite',   label: 'Citation' },
      { tag: 'time',   label: 'Time' },
    ],
  },
  {
    title: 'Interactive',
    items: [
      { tag: 'a',       label: 'Link' },
      { tag: 'button',  label: 'Button' },
      { tag: 'details', label: 'Disclosure' },
      { tag: 'summary', label: 'Disclosure label' },
    ],
  },
  {
    title: 'Media',
    items: [
      { tag: 'img',    label: 'Image' },
      { tag: 'video',  label: 'Video' },
      { tag: 'audio',  label: 'Audio' },
      { tag: 'picture',label: 'Picture' },
      { tag: 'source', label: 'Media source' },
      { tag: 'iframe', label: 'Iframe' },
      { tag: 'canvas', label: 'Canvas' },
      { tag: 'svg',    label: 'SVG' },
    ],
  },
  {
    title: 'Lists',
    items: [
      { tag: 'ul', label: 'Unordered list' },
      { tag: 'ol', label: 'Ordered list' },
      { tag: 'li', label: 'List item' },
      { tag: 'dl', label: 'Definition list' },
      { tag: 'dt', label: 'Definition term' },
      { tag: 'dd', label: 'Definition desc' },
    ],
  },
  {
    title: 'Forms',
    items: [
      { tag: 'form',     label: 'Form' },
      { tag: 'label',    label: 'Field label' },
      { tag: 'input',    label: 'Input' },
      { tag: 'textarea', label: 'Textarea' },
      { tag: 'select',   label: 'Select' },
      { tag: 'option',   label: 'Option' },
      { tag: 'fieldset', label: 'Fieldset' },
      { tag: 'legend',   label: 'Legend' },
      { tag: 'progress', label: 'Progress' },
      { tag: 'meter',    label: 'Meter' },
    ],
  },
  {
    title: 'Table',
    items: [
      { tag: 'table',   label: 'Table' },
      { tag: 'thead',   label: 'Table head' },
      { tag: 'tbody',   label: 'Table body' },
      { tag: 'tfoot',   label: 'Table foot' },
      { tag: 'tr',      label: 'Table row' },
      { tag: 'th',      label: 'Header cell' },
      { tag: 'td',      label: 'Data cell' },
      { tag: 'caption', label: 'Caption' },
    ],
  },
  {
    title: 'Dynamic (UiChemy)',
    items: [
      { tag: 'uichemy-nav-menu',      label: 'Site nav menu' },
      { tag: 'uichemy-toc',           label: 'Table of contents' },
      { tag: 'uichemy-post-content',  label: 'Post content' },
      { tag: 'uichemy-site-logo',     label: 'Site logo' },
      { tag: 'uichemy-site-icon',     label: 'Site icon' },
    ],
  },
];

// Approximate height used for above-vs-below flip decisions only — the
// real height is bounded by CSS `max-height`.
const ADD_MENU_H = 280;
const ADD_MENU_MIN_W = 180;

// Walk up from the trigger to find the nearest .layers-col ancestor so we
// can size the menu to the column rather than to the small trigger button.
function findLayersColumn(el) {
  let p = el;
  while (p) {
    if (p.classList && p.classList.contains('layers-col')) return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Position + size the floating menu so it ALIGNS with the Layers column:
 *   • width matches the column (so it never feels detached from the panel)
 *   • horizontal position pins to the column's left edge (with an inset
 *     so it doesn't sit flush against the column divider)
 *   • vertical position drops under the trigger; flips above if there
 *     isn't enough room.
 * Falls back to the trigger rect's own width if no column ancestor is
 * found (shouldn't happen in practice, but keeps the function defensive).
 */
function computeAddMenuPos(trigger, win) {
  if (!trigger || !win) return null;
  const triggerRect = trigger.getBoundingClientRect();
  const col = findLayersColumn(trigger);
  const colRect = col ? col.getBoundingClientRect() : triggerRect;

  const INSET = 8;  // breathing space on each side of the column edge
  const vw = win.innerWidth;
  const vh = win.innerHeight;

  // Width — clamp to column width minus insets, but never go below the
  // minimum that still fits a search input + a group title row.
  let width = Math.max(ADD_MENU_MIN_W, colRect.width - INSET * 2);
  // If the column itself is narrower than our min, just match the column.
  if (width > colRect.width) width = colRect.width;

  let left = colRect.left + Math.max(0, (colRect.width - width) / 2);
  // Viewport clamp (defensive, when the column gets pushed off-screen).
  if (left + width > vw - 4) left = Math.max(4, vw - width - 4);
  if (left < 4) left = 4;

  let top = triggerRect.bottom + 6;
  if (top + ADD_MENU_H > vh - 8) {
    const above = triggerRect.top - 6 - ADD_MENU_H;
    if (above >= 8) top = above;
    else top = Math.max(8, vh - ADD_MENU_H - 8);
  }

  return { top, left, width };
}

// A typed string can be used as a custom tag if it looks like a valid
// HTML/custom element name: lowercase letter start, then letters / digits /
// hyphens. This guards against accidental Enter on garbage typing.
const TAG_NAME_RE = /^[a-z][a-z0-9-]*$/;
export function isValidTagName(s) {
  return TAG_NAME_RE.test(String(s || '').trim());
}

function AddLayerButton({ onAdd, disabled, variant = 'primary' }) {
  // variant:
  //   'primary' — full "+ Add Layer" CTA used in the empty state
  //   'ghost'   — same label, lighter style (kept for compatibility)
  //   'icon'    — compact "+" trigger used next to the Layers title
  const T = I;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [pos, setPos] = React.useState(null);
  // Index of the row currently highlighted via Up/Down arrows. -1 means
  // "nothing selected yet" — first ArrowDown jumps to row 0.
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const listRef = React.useRef(null);

  // Recompute every time the layout might have shifted (open toggle,
  // window scroll/resize, ancestor scroll). The menu lives in a portal
  // attached to <body> with `position: fixed`, so it must follow the
  // trigger any time the trigger moves on screen. The new position math
  // sizes the menu to match the Layers column so it visually belongs to
  // the panel even though it's portaled to <body>.
  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const win = trigger.ownerDocument?.defaultView || window;
    setPos(computeAddMenuPos(trigger, win));
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;
    reposition();
    const trigger = triggerRef.current;
    const win = trigger?.ownerDocument?.defaultView || window;
    const onScroll = () => reposition();
    const onResize = () => reposition();
    const onDoc = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // `true` capture so scroll on any ancestor (including layers-tree)
    // also repositions the menu.
    win.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onResize);
    win.document.addEventListener('mousedown', onDoc);
    win.document.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', onResize);
      win.document.removeEventListener('mousedown', onDoc);
      win.document.removeEventListener('keydown', onKey);
    };
  }, [open, reposition]);

  function pick(tag) {
    setOpen(false);
    setQ('');
    onAdd?.(tag);
  }

  const query = q.trim().toLowerCase();
  // Filter inside each group; drop empty groups so the menu stays clean.
  const groups = ELEMENT_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => (
      !query
      || it.tag.toLowerCase().includes(query)
      || it.label.toLowerCase().includes(query)
    )),
  })).filter((g) => g.items.length > 0);

  // Custom-tag affordance — surfaced when the user typed something that
  // looks like a valid tag name AND it isn't already in the catalog (or
  // even when it IS in the catalog, the user gets the canonical entry
  // first; the custom row is for tags the curated list doesn't cover).
  const exactCatalogHit = ELEMENT_GROUPS.some((g) =>
    g.items.some((it) => it.tag.toLowerCase() === query),
  );
  const showCustom = !!query && isValidTagName(query) && !exactCatalogHit;

  // Flat list of navigable rows in render order — drives Up/Down arrow
  // navigation. The custom row (when shown) is first, followed by every
  // group's items concatenated.
  const flatRows = React.useMemo(() => {
    const rows = [];
    if (showCustom) rows.push({ kind: 'custom', tag: query });
    for (const g of groups) {
      for (const it of g.items) rows.push({ kind: 'catalog', tag: it.tag });
    }
    return rows;
  }, [showCustom, query, groups]);

  // Reset the highlight whenever the candidate set changes — otherwise an
  // index could point past the new end-of-list after filtering shrinks it.
  React.useEffect(() => {
    setActiveIndex(flatRows.length > 0 ? 0 : -1);
  }, [flatRows.length, q]);

  // Scroll the active row into view inside the menu's scroll container so
  // arrow navigation doesn't visually trap the user above/below the fold.
  React.useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const list = listRef.current;
    const row = list.querySelector(`[data-row-idx="${activeIndex}"]`);
    if (!row) return;
    const rTop = row.offsetTop;
    const rBot = rTop + row.offsetHeight;
    if (rTop < list.scrollTop) {
      list.scrollTop = rTop;
    } else if (rBot > list.scrollTop + list.clientHeight) {
      list.scrollTop = rBot - list.clientHeight;
    }
  }, [activeIndex]);

  const isIcon = variant === 'icon';

  // The menu itself — rendered into <body> via a portal so it sits ABOVE
  // any scrolling ancestor (notably .layers-tree, which has overflow:auto).
  // This is what prevents the dropdown from inflating the layers-tree's
  // scroll height.
  const portalDoc = triggerRef.current?.ownerDocument || null;
  // Keyboard handler for the search input — drives arrow navigation
  // through `flatRows` and commits on Enter. Tab passes through so the
  // user can move focus normally.
  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatRows.length === 0) return;
      setActiveIndex((i) => (i + 1) % flatRows.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatRows.length === 0) return;
      setActiveIndex((i) => (i <= 0 ? flatRows.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      if (flatRows.length) setActiveIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      if (flatRows.length) setActiveIndex(flatRows.length - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = flatRows[activeIndex] || flatRows[0];
      if (row) { pick(row.tag); return; }
      if (showCustom) pick(query);
      return;
    }
  };

  const menuStyle = {
    position: 'fixed',
    top: pos?.top,
    left: pos?.left,
    width: pos?.width,
    zIndex: 2147483646,
  };

  const menuNode = open && pos && portalDoc?.body ? ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="flex max-h-[280px] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
      style={menuStyle}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-muted-foreground">
        <T.search size={11} />
        <input
          autoFocus
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Search or type a custom tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKeyDown}
          aria-activedescendant={activeIndex >= 0 ? `layer-add-row-${activeIndex}` : undefined}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1" ref={listRef} role="listbox">
        {/* Each rendered row carries its index from `flatRows` via
            `data-row-idx` so the active highlight resolves from the
            arrow-driven activeIndex. Mouse hover still uses CSS :hover;
            the .active class is reserved for keyboard navigation. */}
        {(() => {
          // Local cursor mirrors flatRows insertion order so each rendered
          // row gets the right `activeIndex` lookup without us having to
          // re-derive it from tag identity.
          let cursor = 0;
          const customRowIdx = showCustom ? cursor++ : -1;
          return (
            <>
              {showCustom && (
                <button
                  id={`layer-add-row-${customRowIdx}`}
                  data-row-idx={customRowIdx}
                  type="button"
                  className={cn(MENU_ITEM_CLS, activeIndex === customRowIdx && 'bg-accent text-accent-foreground')}
                  onClick={() => pick(query)}
                  onMouseEnter={() => setActiveIndex(customRowIdx)}
                  role="option"
                  aria-selected={activeIndex === customRowIdx}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"><T.plus size={12} /></span>
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="font-mono text-xs">{`<${query}>`}</span>
                    <span className="text-[11px] text-muted-foreground">Use as custom tag</span>
                  </span>
                </button>
              )}

              {groups.map((group) => (
                <React.Fragment key={group.title}>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</div>
                  {group.items.map((it) => {
                    const Ic = tagIcon(it.tag);
                    const idx = cursor++;
                    const isActive = activeIndex === idx;
                    return (
                      <button
                        id={`layer-add-row-${idx}`}
                        data-row-idx={idx}
                        key={it.tag}
                        type="button"
                        className={cn(MENU_ITEM_CLS, isActive && 'bg-accent text-accent-foreground')}
                        onClick={() => pick(it.tag)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        role="option"
                        aria-selected={isActive}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground"><Ic size={12} /></span>
                        <span className="flex min-w-0 flex-col items-start">
                          <span className="font-mono text-xs">{`<${it.tag}>`}</span>
                          <span className="text-[11px] text-muted-foreground">{it.label}</span>
                        </span>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}

              {groups.length === 0 && !showCustom && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {query
                    ? `No elements match "${q}".`
                    : 'Type to search, or type a tag name to add a custom element.'}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>,
    ensurePortalRoot(portalDoc)
  ) : null;

  return (
    <div className={`layer-add${open ? ' open' : ''}${isIcon ? ' is-icon' : ''}`}>
      <Button
        ref={triggerRef}
        type="button"
        variant={isIcon ? 'ghost' : 'default'}
        size={isIcon ? 'icon' : 'sm'}
        className={isIcon ? 'h-6 w-6 text-muted-foreground' : undefined}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Add a new layer"
        aria-label="Add a new layer"
      >
        <T.plus size={isIcon ? 12 : 11} />
        {!isIcon && ' Add Layer'}
      </Button>
      {menuNode}
    </div>
  );
}

function isHiddenByCollapsedAncestor(entry, byId, collapsed) {
  let pid = entry.parentId;
  while (pid) {
    if (collapsed[pid]) return true;
    const parent = byId.get(pid);
    pid = parent ? parent.parentId : null;
  }
  return false;
}

// Show a friendly label for a layer whose text is a single {{ … }} binding
// (e.g. "Category · Name" instead of the raw "{{ cat.name }}"). Falls back to
// the raw text for anything else. Uses the shared dynamic-data label helper.
function friendlyLayerPreview(text) {
  const s = String(text == null ? '' : text).trim();
  if (!/^\{\{[\s\S]*\}\}$/.test(s)) return text;
  try {
    const C = typeof window !== 'undefined' && window.UichDD && window.UichDD.compile;
    if (C && C.parseBinding && C.bindingLabel) {
      const label = C.bindingLabel(C.parseBinding(s), window.UichDD && window.UichDD.schema);
      if (label) return label;
    }
  } catch (_) { /* fall back to raw */ }
  return text;
}

export function LayersPane({
  entries,
  selectedId,
  onSelect,
  onMoveLayer,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onDuplicate,
  onAddLayer,
  hasClipboard,
  picking,
  onTogglePick,
  onMark,
  onMarkLayer,
  onPickIntent,
  onRemoveDyn,
  hasSelection,
  hasWidget,
  resizeHandleRef,
  // Floating ("Navigator") mode — when true the pane lives inside the
  // FloatingLayers window; the head doubles as the window's drag handle and
  // the detach button turns into a "dock back" button.
  floating,
  onToggleFloat,
  onClose,
  canDock = true,
  onHeadPointerDown,
  headRef,
  // Optional History tab living in the same popup. When onSelectTab is provided
  // the header shows Layers|History tabs; historyContent replaces the tree body
  // while tab === 'history'.
  tab = 'layers',
  onSelectTab,
  historyContent,
}) {
  const T = I;
  const [collapsed, setCollapsed] = React.useState({});
  const [q, setQ] = React.useState('');
  const [menu, setMenu] = React.useState(null);
  const [dragId, setDragId] = React.useState(null);
  const [dropTarget, setDropTarget] = React.useState(null); // { id, zone }
  const [outline, setOutline] = React.useState(false);
  const rootRef = React.useRef(null);

  const byId = React.useMemo(() => {
    const m = new Map();
    entries.forEach((e) => m.set(e.id, e));
    return m;
  }, [entries]);

  const filtered = q
    ? entries.filter((r) =>
        r.name.toLowerCase().includes(q.toLowerCase()) ||
        r.tag.toLowerCase().includes(q.toLowerCase()) ||
        r.classes.some((c) => c.toLowerCase().includes(q.toLowerCase())) ||
        (r.contentPreview && r.contentPreview.toLowerCase().includes(q.toLowerCase())) ||
        (r.directText && r.directText.toLowerCase().includes(q.toLowerCase()))
      )
    : entries.filter((e) => !isHiddenByCollapsedAncestor(e, byId, collapsed));

  React.useEffect(() => {
    if (!menu) return undefined;
    const onDoc = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  React.useEffect(() => {
    if (!selectedId || !rootRef.current) return;
    const root = rootRef.current;
    const row = root.querySelector('.layer-row.selected');
    if (!row) return;
    // Scroll the layers list and NOTHING else. `scrollIntoView` walks every
    // scrollable ancestor up to the document, so on the front end — where the
    // panel lives in the page itself — selecting a layer yanked the whole page
    // back to the top on every pick.
    let scroller = row.parentElement;
    while (scroller && scroller !== root.parentElement) {
      if (scroller.scrollHeight > scroller.clientHeight + 1) break;
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === root.parentElement) scroller = root;
    const r = row.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const delta = (r.top + r.height / 2) - (box.top + box.height / 2);
    if (Math.abs(delta) < 2) return;
    if (typeof scroller.scrollBy === 'function') {
      scroller.scrollBy({ top: delta, behavior: 'smooth' });
    } else {
      scroller.scrollTop += delta;
    }
  }, [selectedId]);

  const toggle = (id) => setCollapsed((m) => ({ ...m, [id]: !m[id] }));

  const portalTarget = rootRef.current
    ? rootRef.current.ownerDocument && rootRef.current.ownerDocument.body
    : null;

  // Keep the context menu inside the viewport: if it would overflow the
  // bottom/right edge (e.g. right-clicking a layer near the bottom of the
  // tree), flip it up/left after measuring its actual size.
  const menuRef = React.useRef(null);
  React.useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const doc = el.ownerDocument;
    const win = doc.defaultView || window;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const pad = 6;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - pad - rect.width);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - pad - rect.height);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }, [menu]);

  const menuKbd = (k) => (
    <span className="ml-auto text-xs tracking-widest text-muted-foreground">{k}</span>
  );
  const menuEntry = menu ? byId.get(menu.id) : null;
  // The loop this layer represents: EXACTLY the element that carries it (the one
  // the {% for %}…{% endfor %} directly wraps). We do NOT treat a parent container
  // that merely holds the for-markup text as a loop — marking the div must light
  // up only the div, not the <section> above it. Matches the inspector's
  // element-only rule so the two menus always agree.
  const menuLoopEntry = (menuEntry && menuEntry.dyn && menuEntry.dyn.loop) ? menuEntry : null;
  const menuFormActive = !!(menuEntry && menuEntry.dyn && menuEntry.dyn.form);
  const menuNode = menu ? (
    <div
      ref={menuRef}
      className="z-[2147483646] min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ position: 'fixed', left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menuLoopEntry ? (
        // Already a loop → keep the "Mark as loop" label but show it SELECTED
        // (✓); clicking toggles it off (removes the loop).
        <button
          type="button"
          className={`${MENU_ITEM_CLS} font-medium text-foreground`}
          title={`Loop: ${menuLoopEntry.dyn.loop}\nClick to remove`}
          onClick={() => { onRemoveDyn && onRemoveDyn(menuLoopEntry, 'loop'); setMenu(null); }}
        >
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'hsl(var(--status-loop))' }} />
          Mark as loop
          <span className="ml-auto text-xs" style={{ color: 'hsl(var(--status-loop))' }}>✓</span>
        </button>
      ) : menuFormActive ? (
        // Mutually exclusive — already a form, so marking it a loop is disabled.
        <button
          type="button"
          className={`${MENU_ITEM_CLS} cursor-not-allowed opacity-40`}
          disabled
          aria-disabled="true"
          title="This element is a form. An element can't be both a form and a loop, so remove the form first."
        ><T.dynamic size={12} /> Mark as loop</button>
      ) : (
        <button
          type="button"
          className={MENU_ITEM_CLS}
          onClick={() => { onMarkLayer && onMarkLayer(menu.id, 'loop'); setMenu(null); }}
        ><T.dynamic size={12} /> Mark as loop</button>
      )}
      {menuFormActive ? (
        // Already a form → SELECTED (✓); clicking removes. Mirror the loop-active
        // entry above and the inspector/canvas surfaces exactly, so all read alike.
        <button
          type="button"
          className={`${MENU_ITEM_CLS} font-medium text-foreground`}
          title="Form. Click to remove."
          onClick={() => { onRemoveDyn && onRemoveDyn(menuEntry, 'form'); setMenu(null); }}
        >
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'hsl(var(--status-form))' }} />
          Mark as form
          <span className="ml-auto text-xs" style={{ color: 'hsl(var(--status-form))' }}>✓</span>
        </button>
      ) : menuLoopEntry ? (
        // Mutually exclusive — already a loop, so marking it a form is disabled.
        <button
          type="button"
          className={`${MENU_ITEM_CLS} cursor-not-allowed opacity-40`}
          disabled
          aria-disabled="true"
          title="This element is a loop. An element can't be both a loop and a form, so remove the loop first."
        ><T.dynamic size={12} /> Mark as form</button>
      ) : (
        <button
          type="button"
          className={MENU_ITEM_CLS}
          onClick={() => { onMarkLayer && onMarkLayer(menu.id, 'form'); setMenu(null); }}
        ><T.dynamic size={12} /> Mark as form</button>
      )}
      <div className="-mx-1 my-1 h-px bg-border"></div>
      <button
        type="button"
        className={MENU_ITEM_CLS}
        onClick={() => { onDuplicate && onDuplicate(menu.id); setMenu(null); }}
      ><T.duplicate size={12} /> Duplicate {menuKbd('⌘D')}</button>
      <button
        type="button"
        className={MENU_ITEM_CLS}
        onClick={() => { onCopy && onCopy(menu.id); setMenu(null); }}
      ><T.copy size={12} /> Copy {menuKbd('⌘C')}</button>
      <button
        type="button"
        className={MENU_ITEM_CLS}
        onClick={() => { onCut && onCut(menu.id); setMenu(null); }}
      ><T.scissors size={12} /> Cut {menuKbd('⌘X')}</button>
      <button
        type="button"
        className={MENU_ITEM_CLS}
        disabled={!hasClipboard}
        onClick={() => { if (hasClipboard && onPaste) onPaste(menu.id, 'before'); setMenu(null); }}
      ><T.clipboard size={12} /> Paste {menuKbd('⌘V')}</button>
      <div className="-mx-1 my-1 h-px bg-border"></div>
      <button
        type="button"
        className={cn(MENU_ITEM_CLS, 'text-destructive hover:text-destructive focus:text-destructive')}
        onClick={() => { onDelete && onDelete(menu.id); setMenu(null); }}
      ><T.trash size={12} /> Delete {menuKbd('⌫')}</button>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="layers-col" style={{ position: 'relative' }}>
      <div
        ref={floating ? headRef : undefined}
        className={cn('layers-head', floating && 'is-drag-handle')}
        onMouseDown={floating ? onHeadPointerDown : undefined}
      >
        <div className="layers-head-left">
          {onSelectTab ? (
            <div className="layers-tabs" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={cn('layers-tab', tab !== 'history' && 'is-active')}
                onClick={() => onSelectTab('layers')}
              >Layers</button>
              <button
                type="button"
                className={cn('layers-tab', tab === 'history' && 'is-active')}
                onClick={() => onSelectTab('history')}
              >History</button>
            </div>
          ) : (
            <h3>Layers</h3>
          )}
          {tab !== 'history' && onAddLayer && hasWidget && (
            <AddLayerButton onAdd={onAddLayer} variant="icon" />
          )}
        </div>
        <div className="layers-head-tools inline-flex items-center gap-0.5">
          {/* Detach (inline pane) or Dock-back (floating). The dock-back button
              only makes sense when there's a sidebar to dock INTO — i.e.
              Developer mode. In Design mode there's no inline pane, so we hide
              it and rely on the Close button below. */}
          {onToggleFloat && (!floating || canDock) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              title={floating ? 'Dock layers panel back into the sidebar' : 'Detach as a floating panel'}
              aria-label={floating ? 'Dock layers panel back into the sidebar' : 'Detach layers as a floating panel'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onToggleFloat}
            >
              {floating ? <T.dockRight size={13} /> : <T.move size={13} />}
            </Button>
          )}
          {/* Close — floating window only. Always available so the navigator can
              be dismissed even when it can't be docked into a sidebar. */}
          {floating && onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Close layers panel"
              aria-label="Close layers panel"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
            >
              <T.x size={13} />
            </Button>
          )}
        </div>
      </div>
      {tab === 'history' ? (
        <div className="layers-history-body">{historyContent}</div>
      ) : (<>
      <div className="layers-search">
        <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-muted-foreground shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring">
          <T.search size={12} />
          <input
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            placeholder="Search layers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={!hasWidget}
          />
        </div>
      </div>
      <div className="layers-tree">
        {!hasWidget && (
          <div className="layers-empty">Select a UiChemy Composer widget in the Elementor editor to see its layers.</div>
        )}
        {hasWidget && filtered.length === 0 && q && (
          <div className="layers-empty">No layers match "{q}".</div>
        )}
        {hasWidget && filtered.length === 0 && !q && (
          <div className="layers-empty layers-empty-state">
            <div className="layers-empty-icon" aria-hidden="true">
              <T.layers size={20} />
            </div>
            <div className="layers-empty-msg">No layers yet</div>
            <div className="layers-empty-sub">Add an element to start building the widget.</div>
            <div className="layers-empty-cta">
              <AddLayerButton onAdd={onAddLayer} disabled={!onAddLayer} />
            </div>
          </div>
        )}
        {hasWidget && filtered.map((node) => {
          const isOpen = !collapsed[node.id];
          const TagIco = tagIcon(node.tag);
          const isSelected = selectedId === node.id;
          const isDragging = dragId === node.id;
          const isDropTarget = dropTarget && dropTarget.id === node.id;
          const dropZone = isDropTarget ? dropTarget.zone : null;
          return (
            <div
              key={node.id}
              className={[
                'layer-row',
                isSelected ? 'selected' : '',
                isDragging ? 'is-dragging' : '',
                dropZone === 'before' ? 'drop-before' : '',
                dropZone === 'after' ? 'drop-after' : '',
                dropZone === 'inside' ? 'drop-inside' : '',
              ].filter(Boolean).join(' ')}
              style={{ paddingLeft: 2 + node.depth * 12 + (node.hasChildren ? 0 : 10) }}
              onClick={() => onSelect(node.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: node.id, x: e.clientX, y: e.clientY });
              }}
              draggable={hasWidget}
              onDragStart={(e) => {
                setDragId(node.id);
                try {
                  e.dataTransfer.setData(DRAG_MIME, node.id);
                  e.dataTransfer.setData('text/plain', node.id);
                  e.dataTransfer.effectAllowed = 'move';
                } catch (_) {}
              }}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
              onDragOver={(e) => {
                if (!dragId || dragId === node.id) return;
                // Forbid dropping a node into itself or its own descendants.
                if (isDescendantOrSelf(entries, dragId, node.id)) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
                let zone;
                if (ratio < 0.33) zone = 'before';
                else if (ratio > 0.66) zone = 'after';
                else zone = tagCanHaveChildren(node.tag) ? 'inside' : 'after';
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!isDropTarget || dropTarget.zone !== zone) {
                  setDropTarget({ id: node.id, zone });
                }
              }}
              onDragLeave={(e) => {
                // Only clear if leaving the row entirely (not just moving to a child span).
                if (e.currentTarget.contains(e.relatedTarget)) return;
                if (isDropTarget) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const sourceId = (e.dataTransfer.getData(DRAG_MIME) || dragId);
                const zone = dropTarget && dropTarget.id === node.id ? dropTarget.zone : null;
                setDragId(null);
                setDropTarget(null);
                if (!sourceId || sourceId === node.id || !zone) return;
                if (isDescendantOrSelf(entries, sourceId, node.id)) return;
                if (typeof onMoveLayer === 'function') onMoveLayer(sourceId, node.id, zone);
              }}
            >
              <span
                className={`lcaret${node.hasChildren ? '' : ' empty'}`}
                onClick={(e) => { e.stopPropagation(); if (node.hasChildren) toggle(node.id); }}
              >
                {node.hasChildren ? (isOpen ? <T.caretDown size={10} /> : <T.caretRight size={10} />) : null}
              </span>
              <span className="licon"><TagIco size={12} /></span>
              {!outline && <span className="ltag">{node.tag}</span>}
              <span className="lname" title={node.contentPreview || ''}>{friendlyLayerPreview(node.contentPreview) || ''}</span>
              {(() => {
                const dots = [];
                if (node.dyn) {
                  // Data ({{ }}) and Condition ({% if %}) markers intentionally
                  // hidden — bindings still render; the friendly row label already
                  // signals a dynamic value, so only Loop/Form get a marker dot.
                  // The loop dot marks EXACTLY the element that carries the loop
                  // (the one the {% for %} wraps) — never a parent container that
                  // merely holds the for-markup, so marking the div doesn't also
                  // flag the <section> above it.
                  if (node.dyn.loop) dots.push({ kind: 'loop', color: 'hsl(var(--status-loop))', tip: `Loop: ${node.dyn.loop}`, target: node });
                  if (node.dyn.form) dots.push({ kind: 'form', color: 'hsl(var(--status-form))', tip: 'Form', target: node });
                }
                if (!dots.length) return null;
                return (
                  <span className="ldots" onClick={(e) => e.stopPropagation()}>
                    {dots.map((dd) => (
                      <button
                        key={dd.kind}
                        type="button"
                        className="ldot"
                        title={`${dd.tip}\nClick to remove`}
                        onClick={(e) => { e.stopPropagation(); if (typeof onRemoveDyn === 'function') onRemoveDyn(dd.target, dd.removeKind || dd.kind); }}
                      >
                        <span className="ldot-core" style={{ background: dd.color }} />
                      </button>
                    ))}
                  </span>
                );
              })()}
              <button
                type="button"
                className="lmore"
                title="Layer actions"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ id: node.id, x: r.right, y: r.bottom + 4 });
                }}
              >
                <T.more size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {menuNode && portalTarget && ReactDOM.createPortal(menuNode, ensurePortalRoot(rootRef.current.ownerDocument))}
      <div className="layers-foot">
        <span>{entries.length} layers</span>
        <Button
          type="button"
          variant={outline ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => setOutline(v => !v)}
        ><T.layers size={11} /> Outline</Button>
      </div>
      </>)}
      {!floating && (
        <div
          ref={resizeHandleRef}
          className="layers-resize-handle"
          title="Drag to resize layers panel"
        ></div>
      )}
    </div>
  );
}

// ── FloatingLayers ────────────────────────────────────────────────────────────
// Elementor-Navigator-style detachable window. Wraps <LayersPane> in a
// fixed-position card that can be dragged by its header and resized from the
// bottom-right corner. Rendered into the scoped portal root so it floats above
// the whole editor and carries the composer's Tailwind + theme scope with it.
const FLOAT_MIN_W = 240;
const FLOAT_MIN_H = 220;
const FLOAT_LS_KEY = 'uich_layers_float_box';

function clampBox(box, win) {
  const vw = win?.innerWidth || 1280;
  const vh = win?.innerHeight || 800;
  const w = Math.max(FLOAT_MIN_W, Math.min(box.w, vw - 16));
  const h = Math.max(FLOAT_MIN_H, Math.min(box.h, vh - 16));
  const x = Math.max(8, Math.min(box.x, vw - w - 8));
  const y = Math.max(8, Math.min(box.y, vh - h - 8));
  return { x, y, w, h };
}

export function FloatingLayers({ paneProps, onDock, onClose, canDock, portalDoc, theme, tab, onSelectTab, historyContent }) {
  const doc = portalDoc || (typeof document !== 'undefined' ? document : null);
  const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);

  const [box, setBox] = React.useState(() => {
    let saved = null;
    try { saved = JSON.parse(win?.localStorage.getItem(FLOAT_LS_KEY) || 'null'); } catch (_) { /* noop */ }
    const base = saved && typeof saved.x === 'number'
      ? saved
      : { x: 96, y: 132, w: 300, h: 460 };
    return clampBox(base, win);
  });

  // Persist box changes (position + size) so the window reopens where the
  // user left it.
  React.useEffect(() => {
    try { win?.localStorage.setItem(FLOAT_LS_KEY, JSON.stringify(box)); } catch (_) { /* noop */ }
  }, [box, win]);

  // Live mirror of `box` so the native pointerdown handler (bound once) always
  // reads the current position/size as the drag start without re-binding.
  const boxRef = React.useRef(box);
  React.useEffect(() => { boxRef.current = box; }, [box]);

  // Refs to the two drag handles: the header (move) and the corner (resize).
  const headRef = React.useRef(null);
  const resizeRef = React.useRef(null);

  // Native pointer-based drag/resize. We attach `pointerdown` directly on the
  // handle elements (not via React's onMouseDown) and, crucially, listen on
  // BOTH the panel's own window AND the top window with `screenX/screenY`
  // deltas. In the Elementor editor the panel is portaled INTO the preview
  // iframe, so the moment the cursor leaves the iframe the pointer events fire
  // on the top window instead — single-window `clientX` listeners freeze there.
  // This mirrors the docked resize-handle driver in composer-app so the
  // floating Navigator drags smoothly across the iframe boundary. On the
  // frontend (no parent frame) `topWin` is null and this reduces to a plain
  // single-window drag — identical to the previous behaviour.
  React.useEffect(() => {
    if (!win) return undefined;
    const head = headRef.current;
    const resize = resizeRef.current;

    function makeDown(mode) {
      return function onPointerDown(e) {
        // Ignore clicks on interactive chrome inside the header (Add button,
        // dock toggle, close) so they don't hijack the drag.
        if (mode === 'move' && e.target.closest('button, input, a, .layer-add')) return;
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const startScreenX = typeof e.screenX === 'number' ? e.screenX : 0;
        const startScreenY = typeof e.screenY === 'number' ? e.screenY : 0;
        const start = boxRef.current;
        const handleEl = e.currentTarget;
        const handleDoc = handleEl.ownerDocument || doc;
        const iframeWin = handleDoc.defaultView || win;
        let topWin = null;
        try {
          if (iframeWin.parent && iframeWin.parent !== iframeWin) {
            topWin = iframeWin.parent;
            // Probe — throws on cross-origin so we fall back to iframe-only.
            // eslint-disable-next-line no-unused-vars
            const _ = topWin.document;
          }
        } catch (_) { topWin = null; }

        let captured = false;
        const pointerId = e.pointerId;
        if (pointerId !== undefined && typeof handleEl.setPointerCapture === 'function') {
          try { handleEl.setPointerCapture(pointerId); captured = true; } catch (_) { }
        }

        function onMove(ev) {
          const dx = (typeof ev.screenX === 'number' ? ev.screenX : 0) - startScreenX;
          const dy = (typeof ev.screenY === 'number' ? ev.screenY : 0) - startScreenY;
          const next = mode === 'move'
            ? { ...start, x: start.x + dx, y: start.y + dy }
            : { ...start, w: start.w + dx, h: start.h + dy };
          setBox(clampBox(next, win));
        }
        function onUp() {
          if (captured) {
            try { handleEl.releasePointerCapture(pointerId); } catch (_) { }
          }
          handleEl.removeEventListener('pointermove', onMove);
          handleEl.removeEventListener('pointerup', onUp);
          handleEl.removeEventListener('pointercancel', onUp);
          iframeWin.removeEventListener('mousemove', onMove, true);
          iframeWin.removeEventListener('mouseup', onUp, true);
          iframeWin.removeEventListener('pointermove', onMove, true);
          iframeWin.removeEventListener('pointerup', onUp, true);
          if (topWin) {
            try {
              topWin.removeEventListener('mousemove', onMove, true);
              topWin.removeEventListener('mouseup', onUp, true);
              topWin.removeEventListener('pointermove', onMove, true);
              topWin.removeEventListener('pointerup', onUp, true);
            } catch (_) { }
          }
          if (handleDoc.body && handleDoc.body.style) handleDoc.body.style.userSelect = '';
        }

        // Pointer capture covers the cursor leaving the handle but staying in
        // the same document; window-level capture listeners cover the cursor
        // leaving the iframe entirely (top window) or moving over the canvas.
        handleEl.addEventListener('pointermove', onMove);
        handleEl.addEventListener('pointerup', onUp);
        handleEl.addEventListener('pointercancel', onUp);
        iframeWin.addEventListener('mousemove', onMove, true);
        iframeWin.addEventListener('mouseup', onUp, true);
        iframeWin.addEventListener('pointermove', onMove, true);
        iframeWin.addEventListener('pointerup', onUp, true);
        if (topWin) {
          try {
            topWin.addEventListener('mousemove', onMove, true);
            topWin.addEventListener('mouseup', onUp, true);
            topWin.addEventListener('pointermove', onMove, true);
            topWin.addEventListener('pointerup', onUp, true);
          } catch (_) { }
        }
        if (handleDoc.body && handleDoc.body.style) handleDoc.body.style.userSelect = 'none';
      };
    }

    const onHeadDown = makeDown('move');
    const onResizeDown = makeDown('resize');
    if (head) head.addEventListener('pointerdown', onHeadDown);
    if (resize) resize.addEventListener('pointerdown', onResizeDown);
    return () => {
      if (head) head.removeEventListener('pointerdown', onHeadDown);
      if (resize) resize.removeEventListener('pointerdown', onResizeDown);
    };
  }, [win, doc]);

  // Keep the window on-screen if the viewport is resized.
  React.useEffect(() => {
    if (!win) return undefined;
    const onResize = () => setBox((b) => clampBox(b, win));
    win.addEventListener('resize', onResize);
    return () => win.removeEventListener('resize', onResize);
  }, [win]);

  if (!doc?.body) return null;

  const node = (
    <div
      className="layers-float"
      style={{ position: 'fixed', left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 2147483645 }}
    >
      <LayersPane
        {...paneProps}
        floating
        onToggleFloat={onDock}
        onClose={onClose || onDock}
        canDock={canDock}
        headRef={headRef}
        tab={tab}
        onSelectTab={onSelectTab}
        historyContent={historyContent}
      />
      <div
        ref={resizeRef}
        className="layers-float-resize"
        title="Drag to resize"
        aria-hidden="true"
      />
    </div>
  );

  return ReactDOM.createPortal(node, ensurePortalRoot(doc, theme));
}
