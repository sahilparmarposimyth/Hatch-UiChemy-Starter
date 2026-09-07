// Role Manager screen — per-role editor access.
//
// Minimal layout on the design system, rendered with the ISLAND's own
// components (@/components/ui/*) + shadcn tokens, which brand.css bridges to the
// UiChemy DS (monochrome surfaces/text, orange only on the primary CTA, Zalando
// Sans). Those are what render correctly inside the `.uich-tw` island — the main
// dashboard's DS React components do NOT (different scope / reset), which is what
// broke the segmented control.
//
// Open-list pattern (Teachable / Zendesk / Writer): every role is one quiet,
// hairline-divided row with its access level inline. The three feature
// descriptions are stated ONCE in the legend (Vanta / StackAI "describe once");
// per-role features collapse to a compact toggle row shown only for Full access.
// Data + save wiring unchanged (window.uichemyDashboard + admin-ajax; the server
// enforces "features apply only to Full" in UiChemy_Roles::can_use).
import React from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Icon } from '../icons';
import { data, ajax } from '../data';

// Access levels, least → most permissive (matches UiChemy_Roles::ACCESS_LEVELS).
// `dot` is a monochrome legend marker: empty ring → half → solid.
const ACCESS = [
  { value: 'none',    label: 'No Access',    dot: 'ring',  desc: "Can't open the UiChemy editor." },
  { value: 'content', label: 'Content Only', dot: 'half',  desc: 'Edit text and images only. No design, code or globals.' },
  { value: 'full',    label: 'Full Access',  dot: 'solid', desc: 'Full editor, plus the features below.' },
];
const meta = (v) => ACCESS.find((a) => a.value === v) || ACCESS[0];

// Optional features — apply only to Full access (match UiChemy_Roles::FEATURES).
const FEATURES = [
  { key: 'theme_builder', label: 'Theme Builder' },
  { key: 'design_system', label: 'Design System' },
  { key: 'ai_chat',       label: 'AI Chat' },
];

const DEFAULT_ROW = { access: 'none', theme_builder: 0, design_system: 0, ai_chat: 0 };

function Dot({ kind }) {
  if (kind === 'solid') return <span className="size-2 shrink-0 rounded-full bg-foreground" />;
  if (kind === 'half')  return <span className="size-2 shrink-0 rounded-full bg-muted-foreground" />;
  return <span className="size-2 shrink-0 rounded-full border border-muted-foreground/60" />;
}

function Legend() {
  return (
    <div className="grid gap-x-6 gap-y-3 border-y py-3.5 sm:grid-cols-3">
      {ACCESS.map((a) => (
        <div key={a.value} className="flex items-start gap-2.5">
          <span className="mt-1"><Dot kind={a.dot} /></span>
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-foreground">{a.label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{a.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RoleRow({ slug, name, row, onChange, admin = false, last = false, canEdit = true }) {
  const isFull = !admin && row.access === 'full';
  // A role with no `edit_posts` has nothing for the editor to open, so Content
  // Only and Full Access are states it can never actually be in. Offering just No
  // Access is honest; the server clamps the same way (UiChemy_Roles::sanitize).
  const levels = canEdit ? ACCESS : ACCESS.filter((a) => a.value === 'none');
  const info = meta(admin ? 'full' : row.access);
  return (
    <div className={`px-5 py-3.5 ${last ? '' : 'border-b'}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px] ${admin ? 'bg-foreground text-background' : 'bg-muted text-foreground'}`}>
            <Icon name={admin ? 'crown' : 'users'} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{name}</div>
            {admin ? (
              <div className="mt-0.5 text-[12px] text-muted-foreground">Always has full access</div>
            ) : (
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Dot kind={info.dot} />
                <span>{info.label}</span>
                <span className="text-muted-foreground/50">·</span>
                <span className="truncate">{slug}</span>
              </div>
            )}
          </div>
        </div>

        {admin ? (
          <Badge variant="secondary" className="shrink-0 gap-1.5 py-1 text-[12px] font-medium [&_svg]:size-3.5">
            <Icon name="lock" />
            Full Access
          </Badge>
        ) : (
          <ToggleGroup
            type="single"
            value={row.access}
            onValueChange={(v) => {
              if (!v) return;
              // Full access turns the feature surfaces ON. They are what "full"
              // means, and leaving them off made the level look granted while
              // Theme Builder / Design System / AI Chat stayed shut.
              if (v === 'full') {
                const on = {};
                FEATURES.forEach((f) => { on[f.key] = 1; });
                onChange({ ...row, ...on, access: v });
                return;
              }
              onChange({ ...row, access: v });
            }}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
            {levels.map((a) => (
              <ToggleGroupItem key={a.value} value={a.value} aria-label={a.label} className="px-3 text-[13px]">
                {a.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {isFull && (
        <div className="animate-in fade-in slide-in-from-top-1 mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 pl-12 duration-200">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Features</span>
          {FEATURES.map((f) => (
            <label key={f.key} className="inline-flex cursor-pointer items-center gap-2.5 text-[13px] text-foreground">
              <span>{f.label}</span>
              <Switch
                checked={!!Number(row[f.key])}
                onCheckedChange={(v) => onChange({ ...row, [f.key]: v ? 1 : 0 })}
              />
            </label>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground/70">Full Access only</span>
        </div>
      )}
    </div>
  );
}

export function RoleManager() {
  const roles = data.roles || {};
  const slugs = Object.keys(roles);
  // slug => bool from PHP (UiChemy_Roles::roles_can_edit). Absent on an older
  // build, so a missing entry means "assume it can" and the UI is unchanged.
  const canEdit = data.roleCanEdit || {};

  const seed = React.useMemo(() => {
    const stored = data.roleManager || {};
    const out = {};
    slugs.forEach((s) => { out[s] = { ...DEFAULT_ROW, ...(stored[s] || {}) }; });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rows, setRows] = React.useState(seed);
  const [baseline, setBaseline] = React.useState(seed);
  const [state, setState] = React.useState('');

  const dirty = React.useMemo(() => JSON.stringify(rows) !== JSON.stringify(baseline), [rows, baseline]);
  const setRow = (slug, next) => { setRows((r) => ({ ...r, [slug]: next })); if (state) setState(''); };
  const discard = () => { setRows(baseline); setState(''); };

  const save = () => {
    setState('saving');
    Promise.resolve(ajax('save_role_manager', { role_manager: rows }))
      .then((res) => {
        const saved = (res && res.roleManager) ? res.roleManager : rows;
        setRows(saved);
        setBaseline(saved);
        setState('saved');
      })
      .catch(() => setState('error'));
  };

  return (
    <div className="uich-tw">
      <div className="pb-5">
        <h1 className="text-2xl font-medium tracking-tight text-foreground">Role Manager</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Control which user roles can use the UiChemy editor and its features.
        </p>
      </div>

      <Legend />

      {slugs.length === 0 ? (
        <p className="mt-6 text-[13px] text-muted-foreground">No editable roles found.</p>
      ) : (
        <div className="mt-6 rounded-2xl bg-muted/50 p-2.5">
          <div className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">User roles</div>
          <Card className="overflow-hidden border shadow-none">
            <RoleRow admin name="Administrator" slug="administrator" row={DEFAULT_ROW} onChange={() => {}} />
            {slugs.map((slug, i) => (
              <RoleRow
                key={slug}
                slug={slug}
                name={roles[slug]}
                row={rows[slug] || DEFAULT_ROW}
                onChange={(next) => setRow(slug, next)}
                canEdit={canEdit[slug] !== false}
                last={i === slugs.length - 1}
              />
            ))}
          </Card>
        </div>
      )}

      <Card className="mt-4 flex items-center justify-between gap-3 px-5 py-3.5 shadow-none">
        <span className="text-[13px] text-muted-foreground">
          {state === 'error'
            ? <span className="font-medium text-destructive">Save failed. Try again.</span>
            : state === 'saved' && !dirty
              ? <span className="ptn-saved font-medium">All changes saved</span>
              : dirty ? 'You have unsaved changes.' : 'All changes saved.'}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={discard} disabled={!dirty || state === 'saving'}>
            Discard
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || state === 'saving' || slugs.length === 0}>
            {state === 'saving' ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
