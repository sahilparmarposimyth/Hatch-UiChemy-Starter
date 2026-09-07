// White Label screen, tabbed configurator (Branding / Plugins / Widget / Advanced)
// with live previews, media-library logo upload and a Dashicons picker.
//
// Every FORM CONTROL is the global shadcn component (Input / Textarea / Button /
// Switch / Label). Because the live-preview mockups are ~75 bare-class ptn- rules
// that the `.uich-tw` Tailwind reset would strip, we can't wrap the whole screen
// in one shadcn island. Instead each non-preview section (fields column, enable
// row, advanced list, footer) is its own `.uich-tw` island, and the preview
// column stays a plain ptn- sibling, so previews keep their borders. The outer
// card, the tab bar, and the previews remain ptn- (they're chrome / bespoke art,
// not shadcn-provided components).
import React from 'react';
import { data, ajax } from '../data';
import { Icon, UiChemyMark } from '../icons';
import { SaveButton } from '../components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const WL_DEFAULTS = {
  enabled: 0, plugin_name: '', description: '', author: '', author_url: '', plugin_url: '',
  logo_url: '', hide_from_others: 0, owner_id: 0, widget_name: '', widget_icon: '', widget_category: '',
  hide_help_links: 0, hide_update_news: 0, hide_recommend_ads: 0, force_disable: 0,
};
const DEFAULT_DESC = 'One widget for your website. Build with AI at its full potential. From pages and posts to templates and layouts, create anything.';

const TABS = [
  { key: 'branding', icon: 'home', label: 'Dashboard Branding' },
  { key: 'plugins', icon: 'plug', label: 'Plugins Screen' },
  { key: 'widget', icon: 'code', label: 'Widgets' },
  { key: 'advanced', icon: 'sliders', label: 'Advanced' },
];

function WidgetIcon({ icon }) {
  if (icon && icon.indexOf('dashicons-') === 0) return <span className={`dashicons ${icon}`} />;
  return <Icon name="code" />;
}

// Label + optional helper text + control (shadcn). Used inside a `.uich-tw` island.
function Field({ id, label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-semibold text-foreground">{label}</Label>
      {hint ? <p className="text-[13px] leading-snug text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  );
}

// Label + description on the left, shadcn Switch on the right. Used inside islands.
function SwitchRow({ id, label, desc, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer text-sm font-semibold text-foreground">{label}</Label>
        <p className="text-[13px] leading-snug text-muted-foreground">{desc}</p>
      </div>
      <Switch id={id} checked={!!checked} onCheckedChange={(v) => onChange(v ? 1 : 0)} className="mt-0.5 shrink-0" />
    </div>
  );
}

export function WhiteLabel() {
  const initial = { ...WL_DEFAULTS, ...(data.whiteLabel || {}) };

  // Force-disabled: page stays reachable but the configurator is locked.
  if (initial.enabled && initial.force_disable) {
    return (
      <div className="ptn-card ptn-wl ptn-scroll">
        <div className="ptn-pagehead ptn-wl-pagehead"><h1 className="text-xl font-medium tracking-tight text-foreground">White Label</h1></div>
        <div className="uich-tw">
          <div className="px-7 pb-8 pt-2 text-center">
            <span className="dashicons dashicons-lock mx-auto mb-3 block text-muted-foreground" style={{ fontSize: 32, width: 32, height: 32 }} />
            <h2 className="text-base font-semibold text-foreground">White Label settings are locked</h2>
            <p className="mx-auto mt-1 max-w-md text-[13px] leading-snug text-muted-foreground">Force Disable is enabled, so these options are hidden from all administrators. To unlock them again, deactivate and reactivate the plugin.</p>
          </div>
        </div>
      </div>
    );
  }

  const [wl, setWl] = React.useState(initial);
  const [tab, setTab] = React.useState('branding');
  const [dashMode, setDashMode] = React.useState(null);   // null = base (Default active), 'light' | 'dark'
  const [widgetMode, setWidgetMode] = React.useState(null);
  const [iconQuery, setIconQuery] = React.useState('');
  const set = (k, v) => setWl((o) => ({ ...o, [k]: v }));

  const name = wl.plugin_name || 'UiChemy';
  const dashicons = data.dashicons || [];

  function pickLogo() {
    if (!window.wp || !window.wp.media) return;
    const frame = window.wp.media({ title: 'Select brand logo', button: { text: 'Use this logo' }, multiple: false, library: { type: 'image' } });
    frame.on('select', () => {
      const a = frame.state().get('selection').first().toJSON();
      set('logo_url', a.url);
    });
    frame.open();
  }

  function save() {
    return ajax('save_white_label', { white_label: wl }).then((res) => {
      if (res && res.reload && data.urls) { window.location.href = data.urls.dashboard; }
    });
  }

  const dashCls = dashMode === null ? '' : (dashMode === 'dark' ? 'is-dark' : 'is-light');
  const widgetCls = widgetMode === null ? '' : (widgetMode === 'dark' ? 'is-dark' : 'is-light');

  return (
    <div className="ptn-card ptn-wl">
      <div className="ptn-pagehead ptn-wl-pagehead">
        <h1 className="text-xl font-medium tracking-tight text-foreground">White Label</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Rebrand UiChemy everywhere it shows, with a live preview of every change.</p>
      </div>

      <div className="ptn-wl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`ptn-wl-tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} />{t.label}
          </button>
        ))}
      </div>

      <div className="ptn-wl-enable">
        {/* Island root only carries the width; the flex layout lives on a CHILD,
            because Tailwind utilities apply to descendants of `.uich-tw`, not the
            island element itself. */}
        <div className="uich-tw" style={{ width: '100%' }}>
          <div className="flex w-full items-center justify-between gap-6">
            <div className="space-y-0.5">
              <Label htmlFor="ptn-f-enabled" className="cursor-pointer text-sm font-semibold text-foreground">Enable white label</Label>
              <p className="text-[13px] leading-snug text-muted-foreground">Master switch. Applies the branding below across the admin, Plugins screen and Elementor.</p>
            </div>
            <Switch id="ptn-f-enabled" checked={!!wl.enabled} onCheckedChange={(v) => set('enabled', v ? 1 : 0)} className="shrink-0" />
          </div>
        </div>
      </div>

      {/* Config panels, blurred + inert until the master switch is enabled. */}
      <div className={`ptn-wl-body ${wl.enabled ? '' : 'ptn-wl-locked'}`} {...(wl.enabled ? {} : { inert: '' })}>
        {/* ── Branding ── */}
        <div className={`ptn-wl-panel ${tab === 'branding' ? 'is-active' : ''}`} data-panel="branding">
          <div className="ptn-wl-cols">
            <div className="ptn-wl-fields uich-tw">
              <div className="space-y-5">
                <Field id="ptn-f-plugin_name" label="Plugin / brand name" hint="Shown in place of “UiChemy” in the menu and dashboard.">
                  <Input id="ptn-f-plugin_name" value={wl.plugin_name} onChange={(e) => set('plugin_name', e.target.value)} placeholder="e.g. Studio Builder" />
                </Field>
                <Field label="Brand logo" hint="Replaces the composer mark. Square PNG/SVG works best.">
                  <div className="flex gap-2">
                    <Input className="flex-1" value={wl.logo_url} onChange={(e) => set('logo_url', e.target.value)} placeholder="https://…" />
                    <Button type="button" onClick={pickLogo}>Upload</Button>
                    <Button type="button" variant="outline" onClick={() => set('logo_url', '')}>Clear</Button>
                  </div>
                </Field>
                <Field id="ptn-f-author" label="Author / agency name">
                  <Input id="ptn-f-author" value={wl.author} onChange={(e) => set('author', e.target.value)} placeholder="e.g. Your Agency" />
                </Field>
                <Field id="ptn-f-author_url" label="Author URL">
                  <Input id="ptn-f-author_url" type="url" value={wl.author_url} onChange={(e) => set('author_url', e.target.value)} placeholder="https://…" />
                </Field>
              </div>
            </div>

            <div className="ptn-wl-preview">
              <div className="ptn-pv-head">
                <span className="ptn-pv-title">Live preview</span>
                <div className="ptn-pv-modes" data-target="pv-dash">
                  <button type="button" className={`ptn-pv-mode ${dashMode === 'light' ? 'is-active' : ''}`} onClick={() => setDashMode('light')}>Light</button>
                  <button type="button" className={`ptn-pv-mode ${dashMode !== 'light' ? 'is-active' : ''}`} onClick={() => setDashMode('dark')}>Default</button>
                </div>
              </div>
              <div className={`ptn-pv-body ${dashCls}`} id="pv-dash">
                <div className="wpv">
                  <div className="wpv-bar">
                    <span className="dashicons dashicons-wordpress wpv-bar-ico" />
                    <span className="wpv-bar-site"><span className="dashicons dashicons-admin-home" />{data.siteName}</span>
                  </div>
                  <div className="wpv-main">
                    <div className="wpv-menu">
                      <a className="wpv-item"><span className="dashicons dashicons-dashboard wpv-ico" /><span className="wpv-name">Dashboard</span></a>
                      <div className="wpv-sep" />
                      <a className="wpv-item"><span className="dashicons dashicons-admin-post wpv-ico" /><span className="wpv-name">Posts</span></a>
                      <a className="wpv-item"><span className="dashicons dashicons-admin-media wpv-ico" /><span className="wpv-name">Media</span></a>
                      <a className="wpv-item"><span className="dashicons dashicons-admin-page wpv-ico" /><span className="wpv-name">Pages</span></a>
                      <a className="wpv-item"><span className="dashicons dashicons-admin-comments wpv-ico" /><span className="wpv-name">Comments</span></a>
                      <div className="wpv-sep" />
                      <a className="wpv-item is-current">
                        <span className="wpv-ico wpv-brandico" id="ptn-pv-wpicon">
                          {wl.logo_url ? <img className="wpv-logo-img" src={wl.logo_url} alt="" /> : <UiChemyMark className="h-5 w-5" />}
                        </span>
                        <span className="wpv-name" id="ptn-pv-wpname">{wl.plugin_name || 'UiChemy'}</span>
                      </a>
                      <div className="wpv-submenu">
                        <a className="wpv-sub is-current">Dashboard</a>
                        <a className="wpv-sub">Settings</a>
                        <a className="wpv-sub">Form Submissions</a>
                        <a className="wpv-sub">White Label</a>
                      </div>
                      <div className="wpv-sep" />
                      <a className="wpv-item"><span className="dashicons dashicons-admin-appearance wpv-ico" /><span className="wpv-name">Appearance</span></a>
                      <a className="wpv-item"><span className="dashicons dashicons-admin-plugins wpv-ico" /><span className="wpv-name">Plugins</span></a>
                      <a className="wpv-item"><span className="dashicons dashicons-admin-users wpv-ico" /><span className="wpv-name">Users</span></a>
                    </div>
                    <div className="wpv-canvas">
                      <div className="wpv-canvas-h" />
                      <div className="wpv-canvas-line" />
                      <div className="wpv-canvas-line short" />
                      <div className="wpv-canvas-block" />
                    </div>
                  </div>
                </div>
                <div className="pvd-caption">Your plugin in the WordPress admin menu</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Plugins Screen ── */}
        <div className={`ptn-wl-panel ${tab === 'plugins' ? 'is-active' : ''}`} data-panel="plugins">
          <div className="ptn-wl-cols">
            <div className="ptn-wl-fields uich-tw">
              <div className="space-y-5">
                <Field id="ptn-f-plugin_name-2" label="Plugin name" hint="Bold title on the Plugins list (mirrors the name above).">
                  <Input id="ptn-f-plugin_name-2" value={wl.plugin_name} onChange={(e) => set('plugin_name', e.target.value)} placeholder="e.g. Studio Builder" />
                </Field>
                <Field id="ptn-f-description" label="Plugin description">
                  <Textarea id="ptn-f-description" rows={3} value={wl.description} onChange={(e) => set('description', e.target.value)} placeholder="One widget for your website…" />
                </Field>
                <Field id="ptn-f-plugin_url" label="Plugin site URL" hint="The “Visit plugin site” link.">
                  <Input id="ptn-f-plugin_url" type="url" value={wl.plugin_url} onChange={(e) => set('plugin_url', e.target.value)} placeholder="https://…" />
                </Field>
                <SwitchRow id="ptn-f-hide" label="Hide from other admins" desc="Only show the menu to the current administrator." checked={wl.hide_from_others} onChange={(v) => set('hide_from_others', v)} />
              </div>
            </div>

            <div className="ptn-wl-preview">
              <div className="ptn-pv-head"><span className="ptn-pv-title">Plugins screen row</span></div>
              <div className="ptn-pv-body" id="pv-plug">
                <div className="wpp">
                  <div className="wpp-head">
                    <span className="wpp-cb" />
                    <span>Plugin</span>
                    <span>Description</span>
                  </div>
                  <div className="wpp-row">
                    <span className="wpp-cb"><span className="wpp-box" /></span>
                    <div className="wpp-plugin">
                      <strong className="wpp-name">Hello Dolly</strong>
                      <div className="wpp-actions"><a className="wpp-a">Activate</a> <span className="wpp-bar">|</span> <a className="wpp-a wpp-del">Delete</a></div>
                    </div>
                    <div className="wpp-desc">
                      <span className="wpp-dtext">This is not just a plugin, it symbolizes the hope and enthusiasm of an entire generation.</span>
                      <div className="wpp-meta">Version 1.7.2 | By <a className="wpp-a">Matt Mullenweg</a></div>
                    </div>
                  </div>
                  <div className="wpp-row is-active">
                    <span className="wpp-cb"><span className="wpp-box" /></span>
                    <div className="wpp-plugin">
                      <strong className="wpp-name" id="ptn-pv-plug-name">{name}</strong>
                      <div className="wpp-actions"><a className="wpp-a">Deactivate</a></div>
                    </div>
                    <div className="wpp-desc">
                      <span className="wpp-dtext" id="ptn-pv-plug-desc">{wl.description || DEFAULT_DESC}</span>
                      <div className="wpp-meta">
                        Version {data.version} | By{' '}
                        <span id="ptn-pv-plug-author-wrap">
                          {(wl.author && wl.author_url)
                            ? <a className="wpp-a" href={wl.author_url} target="_blank" rel="noopener">{wl.author}</a>
                            : (wl.author || 'Posimyth')}
                        </span>
                        <span id="ptn-pv-plug-site-wrap">
                          {wl.plugin_url ? <> | <a className="wpp-a" href={wl.plugin_url} target="_blank" rel="noopener">Visit plugin site</a></> : null}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="pvd-caption">Links open in a new tab so you can safely test them.</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Elementor Widget ── */}
        <div className={`ptn-wl-panel ${tab === 'widget' ? 'is-active' : ''}`} data-panel="widget">
          <div className="ptn-wl-cols">
            <div className="ptn-wl-fields uich-tw">
              <div className="space-y-5">
                <Field id="ptn-f-widget_name" label="Widget" hint="The label shown in the Elementor Elements panel and the “Edit …” header.">
                  <Input id="ptn-f-widget_name" value={wl.widget_name} onChange={(e) => set('widget_name', e.target.value)} placeholder="Composer" />
                </Field>
                <Field id="ptn-f-widget_category" label="Widget category" hint="The category heading shown in the Elementor Elements panel (default “UiChemy”).">
                  <Input id="ptn-f-widget_category" value={wl.widget_category} onChange={(e) => set('widget_category', e.target.value)} placeholder="UiChemy" />
                </Field>
                <Field label="Widget icon" hint="Pick from the WordPress Dashicons library, or keep the default.">
                  <div className="overflow-hidden rounded-lg border">
                    <div className="flex items-center gap-2 border-b p-2">
                      <Input type="search" className="h-8 flex-1" placeholder="Search icons…" value={iconQuery} onChange={(e) => setIconQuery(e.target.value)} />
                      <Button type="button" variant="outline" size="sm" onClick={() => set('widget_icon', '')}>Default</Button>
                    </div>
                    <div className="grid max-h-[300px] grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5 overflow-y-auto p-3">
                      {dashicons.map((slug) => {
                        const hidden = iconQuery && slug.toLowerCase().indexOf(iconQuery.toLowerCase().trim()) === -1;
                        return (
                          <button
                            key={slug}
                            type="button"
                            title={slug}
                            style={hidden ? { display: 'none' } : undefined}
                            className={cn(
                              'flex h-9 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-muted',
                              wl.widget_icon === slug && 'border-transparent bg-foreground text-background',
                            )}
                            onClick={() => set('widget_icon', slug)}
                          >
                            <span className={`dashicons ${slug}`} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </Field>
              </div>
            </div>

            <div className="ptn-wl-preview">
              <div className="ptn-pv-head">
                <span className="ptn-pv-title">Elementor panel</span>
                <div className="ptn-pv-modes" data-target="pv-widget">
                  <button type="button" className={`ptn-pv-mode ${widgetMode === 'light' ? 'is-active' : ''}`} onClick={() => setWidgetMode('light')}>Light</button>
                  <button type="button" className={`ptn-pv-mode ${widgetMode !== 'light' ? 'is-active' : ''}`} onClick={() => setWidgetMode('dark')}>Dark</button>
                </div>
              </div>
              <div className={`ptn-pv-body ele-body ${widgetCls}`} id="pv-widget">
                <div className="ele">
                  <div className="ele-head">
                    <span className="ele-back dashicons dashicons-arrow-left-alt2" />
                    <span className="ele-title">Edit <span id="ptn-pv-w-name2">{wl.widget_name || 'Composer'}</span></span>
                  </div>
                  <div className="ele-search">
                    <span className="dashicons dashicons-search" />
                    <span id="ptn-pv-w-search">{(wl.widget_name || 'Composer').toLowerCase()}</span>
                  </div>
                  <div className="ele-grid">
                    <div className="ele-card is-hit">
                      <span className="ele-ico" id="ptn-pv-w-icon"><WidgetIcon icon={wl.widget_icon} /></span>
                      <span className="ele-label" id="ptn-pv-w-name">{wl.widget_name || 'Composer'}</span>
                    </div>
                    <div className="ele-card is-ghost"><span className="ele-ico dashicons dashicons-editor-textcolor" /><span className="ele-label">Heading</span></div>
                    <div className="ele-card is-ghost"><span className="ele-ico dashicons dashicons-format-image" /><span className="ele-label">Image</span></div>
                  </div>
                </div>
                <div className="pvd-caption pvd-caption-dark">How the widget appears inside the Elementor editor</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Advanced ── */}
        <div className={`ptn-wl-panel ${tab === 'advanced' ? 'is-active' : ''}`} data-panel="advanced">
          <div className="uich-tw">
            <p className="text-[13px] leading-snug text-muted-foreground">Lock the plugin down for your clients. Some options apply to future banners and notices UiChemy may add.</p>
            <div className="mt-2 divide-y border-t">
              <SwitchRow id="ptn-f-hide-help" label="Hide all help links" desc="Hide all the links (except the brand name) from the plugin’s row on the Plugins page." checked={wl.hide_help_links} onChange={(v) => set('hide_help_links', v)} />
              <SwitchRow id="ptn-f-hide-news" label="Hide all plugin update news" desc="Hide all future (not the existing) news and update banners shown by the plugin." checked={wl.hide_update_news} onChange={(v) => set('hide_update_news', v)} />
              <SwitchRow id="ptn-f-hide-ads" label="Hide our recommended-plugin ads" desc="Hide the “recommended plugins” promotions shown by the plugin." checked={wl.hide_recommend_ads} onChange={(v) => set('hide_recommend_ads', v)} />
            </div>
            <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4">
              <SwitchRow id="ptn-f-force" label="Enable Force Disable Options" desc="Completely remove the White Label page so your clients can’t change these settings. To restore it, deactivate and reactivate the plugin, then save again." checked={wl.force_disable} onChange={(v) => set('force_disable', v)} />
            </div>
          </div>
        </div>
      </div>{/* /ptn-wl-body */}

      <div className="ptn-form-footer">
        <SaveButton onSave={save} />
      </div>
    </div>
  );
}
