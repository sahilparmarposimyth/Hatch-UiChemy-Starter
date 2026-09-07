// Globals value picker, a small globe icon that opens a popover listing the
// user's own UiChemy globals (from the Globals panel), grouped by collection.
// Clicking an item inserts a var(--id) REFERENCE (not the raw value) into the
// field, so editing the global later updates every field that uses it.
// Used on every property field in the inspector + the colour field.

import React from 'react';
import { I } from './composer-icons';
import { useUiChemyGlobals, groupUiChemyGlobals } from './composer-variables';

export function GlobalsValuePicker({ onPick, colorOnly = false, fontOnly = false, title = 'Use a global value' }) {
  const items  = useUiChemyGlobals();
  const groups = React.useMemo(
    () => groupUiChemyGlobals(items, { colorOnly, fontOnly }),
    [items, colorOnly, fontOnly],
  );
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [openG, setOpenG] = React.useState({}); // groupId -> expanded
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    setQ(''); setOpenG({}); // fresh collapsed view each time it opens
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h, true);
    return () => document.removeEventListener('mousedown', h, true);
  }, [open]);

  if (!groups.length) return null; // nothing created yet → no icon

  const query = q.trim().toLowerCase();
  const match = (it) => !query
    || String(it.name).toLowerCase().includes(query)
    || String(it.id).toLowerCase().includes(query);

  return (
    <span ref={ref} className={`pr-gpick${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pr-gpick-btn"
        title={title}
        aria-label={title}
        onClick={() => setOpen((o) => !o)}
      >
        <I.globe size={12} />
      </button>
      {open && (
        <div className="pr-gpick-pop flex max-h-[300px] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" role="menu">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-muted-foreground">
            <I.search size={11} />
            <input
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              type="text"
              value={q}
              placeholder="Search globals…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {groups.map((g) => {
              const matches = g.items.filter(match);
              if (query && !matches.length) return null;
              const expanded = query ? true : !!openG[g.id];
              return (
                <div key={g.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setOpenG((s) => ({ ...s, [g.id]: !expanded }))}
                  >
                    <span className="text-[9px]">{expanded ? '▾' : '▸'}</span>
                    <span className="flex-1 text-left">{g.name}</span>
                    <span className="tabular-nums">{matches.length}</span>
                  </button>
                  {expanded && matches.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                      title={`var(--${it.id})  →  ${it.value}`}
                      onClick={() => { setOpen(false); onPick?.(`var(--${it.id})`); }}
                    >
                      {it.type === 'color' && (
                        <span className="h-4 w-4 shrink-0 rounded-sm border border-border" style={{ background: it.resolved || it.value || 'transparent' }} />
                      )}
                      <span className="flex-1 truncate text-left">{it.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">{it.value}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}
