// Settings screen, rebuilt on the shadcn design system to match the Dashboard:
// one white panel (bg-card) floating on the grey app background, neutral zinc
// tokens, and the shadcn primitives (Switch / Button / Label) so the accent is
// the theme's near-black primary, no hard-coded purple. Typography is kept
// compact/minimal (smaller title, 13px descriptions, tight rows). Scoped to its
// own `.uich-tw` island (see Shell). Saves via admin-ajax, same as before.
import React from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { data, ajax } from '../data';
// Shared App-Password force logic. This is plain state/AJAX (not a DS React
// component), so it's safe to use inside the Tailwind island, the Settings
// screen renders within the new-dashboard app, so the native boot + endpoints
// are present. The visual below is built from island shadcn primitives.
import { useAppPasswordForce } from '../../../lib/app-password';

const DEFAULTS = { enable_elementor: 1, enable_gutenberg: 1, enable_bricks: 1, enable_mcp: 1, store_forms: 1, enable_frontend_editor: 1, delete_on_uninstall: 0, editor_mode: 'both' };

// A labelled 3-way segmented choice (Both / Design / Developer) for the
// editor_mode setting. Built on the DS ToggleGroup (grey track + white raised
// chip on the active item), the same primitive the Form Submissions filters use.
function ModeChoiceRow({ value, onChange }) {
  const choices = [
    { v: 'both', label: 'Both' },
    { v: 'design', label: 'Design' },
    { v: 'developer', label: 'Developer' },
  ];
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="space-y-0.5">
        <Label className="text-sm font-semibold text-foreground">Editor mode</Label>
        <p className="text-[13px] leading-snug text-muted-foreground">
          Which tabs the composer shows. <b>Both</b> lets editors switch between Design (Chat + Editor) and Developer (Chat + Editor + Code). <b>Design</b> or <b>Developer</b> locks the editor to that set and hides the switch.
        </p>
      </div>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v)}
        className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-[9px] border border-border bg-muted p-[3px]"
      >
        {choices.map((o) => (
          <ToggleGroupItem
            key={o.v}
            value={o.v}
            className="h-[26px] whitespace-nowrap rounded-[6px] px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/* ── Composer appearance ───────────────────────────────────────────────────
   These two replace the palette + sun buttons that used to float in the
   composer dock's bottom-right corner. They are set-once preferences, not
   per-edit controls, so the panel is not where they belonged.

   Unlike every other row on this screen they are NOT part of the Save batch:
   they write the same localStorage keys composer-app.jsx reads
   (`uich-composer-skin*` / `uich-composer-theme*`), so the change is instant
   and a composer left open in another tab picks it up via its `storage`
   listener. Per-browser rather than per-site, which is what a personal editor
   preference should be — and it needs no new option or PHP endpoint.

   Both keys are written per builder, because the composer reads a different key
   inside Gutenberg than in Elementor/Bricks and would otherwise ignore this. */
const SKIN_KEYS = ['uich-composer-skin', 'uich-composer-skin-gutenberg'];
const THEME_KEYS = ['uich-composer-theme', 'uich-composer-theme-gutenberg'];

function readPref(keys, fallback) {
  try {
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
  } catch (e) { }
  return fallback;
}

/** Write to every builder's key so the choice holds wherever the composer opens.
 *  'native' means "match the builder", which is a different literal per key. */
function writePref(keys, value, nativePerKey) {
  try {
    keys.forEach((k, i) => {
      localStorage.setItem(k, value === 'native' ? nativePerKey[i] : value);
    });
    // localStorage events don't fire in the tab that wrote them, so nudge this
    // page's own listeners too.
    window.dispatchEvent(new Event('uich:composer-appearance'));
  } catch (e) { }
}

function AppearanceRow({ label, desc, value, choices, onChange }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="space-y-0.5">
        <Label className="text-sm font-semibold text-foreground">{label}</Label>
        <p className="text-[13px] leading-snug text-muted-foreground">{desc}</p>
      </div>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v)}
        className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-[9px] border border-border bg-muted p-[3px]"
      >
        {choices.map((o) => (
          <ToggleGroupItem
            key={o.v}
            value={o.v}
            className="h-[26px] whitespace-nowrap rounded-[6px] px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function ComposerAppearance() {
  const [skin, setSkinPref] = React.useState(() => {
    const v = readPref(SKIN_KEYS, 'brand');
    return v === 'brand' ? 'brand' : 'native';
  });
  const [theme, setThemePref] = React.useState(() => readPref(THEME_KEYS, 'dark'));

  return (
    <>
      <AppearanceRow
        label="Composer colours"
        desc={<>Whether the composer panel uses UiChemy&rsquo;s own palette or borrows the builder&rsquo;s — Elementor pink, Gutenberg blue. <b>Match builder</b> makes it feel native to whichever editor you are in.</>}
        value={skin}
        choices={[{ v: 'brand', label: 'UiChemy' }, { v: 'native', label: 'Match builder' }]}
        onChange={(v) => { setSkinPref(v); writePref(SKIN_KEYS, v, ['elementor', 'gutenberg']); }}
      />
      <AppearanceRow
        label="Composer theme"
        desc="Light or dark for the composer panel only. Your builder's own theme is unaffected."
        value={theme}
        choices={[{ v: 'dark', label: 'Dark' }, { v: 'light', label: 'Light' }]}
        onChange={(v) => { setThemePref(v); writePref(THEME_KEYS, v, ['dark', 'dark']); }}
      />
    </>
  );
}

// One setting: label + description on the left, shadcn Switch on the right.
function SettingRow({ id, label, desc, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer text-sm font-semibold text-foreground">{label}</Label>
        <p className="text-[13px] leading-snug text-muted-foreground">{desc}</p>
      </div>
      <Switch id={id} checked={!!checked} onCheckedChange={(v) => onChange(v ? 1 : 0)} className="mt-0.5 shrink-0" />
    </div>
  );
}

// Force-enable Application Passwords, toggles live via AJAX (not part of the
// Save batch), so it has its own row. Self-hides unless App Passwords are
// blocked or currently overridden.
function AppPasswordForceRow() {
  const f = useAppPasswordForce();
  if (!f.visible) return null;
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="space-y-0.5">
        <Label htmlFor="ptn-set-force-app" className="cursor-pointer text-sm font-semibold text-foreground">Force-enable Application Passwords</Label>
        <p className="text-[13px] leading-snug text-muted-foreground">
          {f.forceEnabled
            ? 'UiChemy is overriding the site to allow App Passwords for your account.'
            : (f.reasonText || 'Application Passwords are currently unavailable on this site.')}
        </p>
        {f.error ? <p className="mt-0.5 text-[12px] font-medium text-destructive">{f.error}</p> : null}
      </div>
      <Switch id="ptn-set-force-app" checked={f.forceEnabled} disabled={f.busy} onCheckedChange={f.toggle} className="mt-0.5 shrink-0" />
    </div>
  );
}

// A labelled group of settings, so related toggles read together instead of as
// one long undifferentiated list.
function Section({ title, desc, children }) {
  return (
    <div className="rounded-2xl bg-muted/50 p-3">
      <div className="px-1 pb-2.5">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {desc ? <p className="mt-0.5 text-[12px] text-muted-foreground">{desc}</p> : null}
      </div>
      <div className="divide-y rounded-xl border bg-card px-4">{children}</div>
    </div>
  );
}

export function Settings() {
  const [opts, setOpts] = React.useState(() => ({ ...DEFAULTS, ...(data.settings || {}) }));
  const [state, setState] = React.useState('');
  const set = (k, v) => setOpts((o) => ({ ...o, [k]: v }));
  const save = () => {
    setState('saving');
    Promise.resolve(ajax('save_settings', { settings: opts }))
      .then(() => setState('saved'))
      .catch(() => setState('error'));
  };

  return (
    <div className="uich-tw">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Page header, full-bleed divider below the title, matching the White Label panel header. */}
        <div className="shrink-0 pb-4">
          <h1 className="text-2xl font-medium tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Configure how UiChemy behaves on your site.</p>
        </div>

        <div className="ptn-scroll flex min-h-0 flex-1 flex-col gap-4 pb-2">

          {/* Editor & widgets */}
          <Section title="Editor & widgets" desc="What UiChemy adds to your page builder and the front end.">
            {/* One switch per builder. Turning one off unregisters the Composer
                there, so it leaves the inserter AND stops loading its editor
                assets. Pages already built with it keep rendering, because the
                front-end renderer is separate from registration. */}
            <SettingRow id="ptn-set-elementor" label="Enable in Elementor" desc="Register the Composer widget in Elementor's widget panel." checked={opts.enable_elementor} onChange={(v) => set('enable_elementor', v)} />
            <SettingRow id="ptn-set-gutenberg" label="Enable in Gutenberg" desc="Register the Composer block in the WordPress block inserter." checked={opts.enable_gutenberg} onChange={(v) => set('enable_gutenberg', v)} />
            <SettingRow id="ptn-set-bricks" label="Enable in Bricks" desc="Register the Composer element in the Bricks builder panel." checked={opts.enable_bricks} onChange={(v) => set('enable_bricks', v)} />
            <SettingRow id="ptn-set-fe-editor" label="Show editor on the front end" desc="Let logged-in editors open the UiChemy editor directly on the live page. When off, the front-end editor never loads." checked={opts.enable_frontend_editor} onChange={(v) => set('enable_frontend_editor', v)} />
            <ModeChoiceRow value={opts.editor_mode || 'both'} onChange={(v) => set('editor_mode', v)} />
            <ComposerAppearance />
          </Section>

          {/* Integrations */}
          <Section title="Integrations" desc="Connect AI clients so they can build with UiChemy.">
            <SettingRow id="ptn-set-mcp" label="Enable MCP server" desc="Expose the built-in Model Context Protocol server so AI clients can build with UiChemy." checked={opts.enable_mcp} onChange={(v) => set('enable_mcp', v)} />
            <AppPasswordForceRow />
          </Section>

          {/* Data */}
          <Section title="Data" desc="What UiChemy stores on your site.">
            <SettingRow id="ptn-set-store" label="Store form submissions" desc="Save Composer form entries to the database so they appear under Form Submissions." checked={opts.store_forms} onChange={(v) => set('store_forms', v)} />
          </Section>

          {/* Danger zone, destructive setting split out with a red frame. */}
          <div className="rounded-2xl bg-muted/50 p-3">
            <div className="px-1 pb-2.5">
              <h2 className="text-[13px] font-semibold text-destructive">Danger Zone</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Irreversible on uninstall. Leave off unless you're sure.</p>
            </div>
            <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] px-4">
              <SettingRow id="ptn-set-delete" label="Delete all data on uninstall" desc="Remove UiChemy options and stored submissions when the plugin is deleted. This cannot be undone." checked={opts.delete_on_uninstall} onChange={(v) => set('delete_on_uninstall', v)} />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t pt-5">
            {state === 'saved' && <span className="ptn-saved text-[13px] font-medium">Saved</span>}
            {state === 'error' && <span className="text-[13px] font-medium text-destructive">Save failed</span>}
            <Button size="sm" onClick={save} disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
