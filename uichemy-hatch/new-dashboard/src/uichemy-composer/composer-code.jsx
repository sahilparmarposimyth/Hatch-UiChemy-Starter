// Code tab, 4 scopes: Standard / Page / Site / Globals.
import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { I } from './composer-icons';
import { DependenciesBar } from './composer-deps';
import { CodeMirrorEditor } from './composer-code-editor';
import { useSlidingSeg } from './composer-inputs';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useActiveWidget, useWidgetSetting,
  propagateComposerSetting, saveSharedSiteCustomCodeDebounced,
} from './composer-elementor';
import { formatCode } from './composer-code-format';
import { useEditorDepsSync } from './composer-deps-sync';
import { VariablesPanel } from './composer-variables';
import { codeLock } from './composer-pro';

// ── shadcn segmented-tab recipe (mirrors composer-layers' MENU_ITEM_CLS style) ─
const SEG_WRAP_CLS = 'inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5';
const SEG_ITEM_CLS = 'inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground';
const SEG_ITEM_ON_CLS = 'bg-background text-foreground shadow-sm';
// Sliding variants: the pill behind the items paints the chip, so the active
// item must NOT paint its own or the two stack.
const SEG_ITEM_ON_SLIDE_CLS = 'text-foreground';
// Compact ghost button used by the editor-pane toolbars (Format / Copy / Assets).
const PANE_TOOL_CLS = 'h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground [&_svg]:size-3';

// ── Deps persistence helpers ───────────────────────────────────────────────────
function parseDepsJson(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (_) { return []; }
}
function stringifyDeps(deps) {
  return JSON.stringify(deps);
}

// Debounced AJAX save for site-level deps (mirrors saveSharedSiteCustomCodeDebounced).
let _siteDepsSaveTimer = null;
let _siteDepsSavePending = null;
function saveSharedSiteDepsDebounced(deps) {
  _siteDepsSavePending = deps;
  if (_siteDepsSaveTimer) clearTimeout(_siteDepsSaveTimer);
  _siteDepsSaveTimer = setTimeout(() => {
    const payload = _siteDepsSavePending;
    _siteDepsSavePending = null;
    _siteDepsSaveTimer = null;
    if (!payload) return;
    const cfg = (typeof window !== 'undefined' && window.uichComposerEditorCfg) || {};
    if (!cfg.ajaxUrl || !cfg.ajaxNonce) return;
    const body = new URLSearchParams();
    body.set('action', 'uichemy_composer_save_site_deps');
    body.set('nonce', cfg.ajaxNonce);
    body.set('deps', JSON.stringify(payload));
    try {
      fetch(cfg.ajaxUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
      }).catch(() => {});
    } catch (_) {}
  }, 400);
}

// ── Asset URL matcher, finds the line in head/footer that corresponds to a
// dep. URLs may contain a {v} placeholder; match by the literal prefix/suffix
// around it so the tag can be located even if the version stored on the dep
// no longer matches the version baked into the tag in the editor.
function lineMatchesDep(line, dep) {
  const url = (dep && dep.url) || '';
  if (!url) return false;
  if (url.includes('{v}')) {
    const [pre, post] = url.split('{v}');
    if (pre && !line.includes(pre)) return false;
    if (post && !line.includes(post)) return false;
    return true;
  }
  return line.includes(url);
}
function stripDepLine(text, dep) {
  if (!text) return text;
  const lines = text.split('\n');
  const kept = lines.filter(l => !lineMatchesDep(l, dep));
  return kept.join('\n');
}

// ── Asset tag builder (JS mirror of PHP build_asset_tag_html) ─────────────────
// Returns the inline tag for a dep. When `dep.enabled === false`, the tag is
// wrapped in an HTML comment so the line stays visible/editable in the code
// editor but the browser doesn't load the resource. This means:
//   - The deps bar's reverse-sync parser can still find the URL and keep the
//     row in the list (marked disabled).
//   - The user can comment / uncomment a tag directly in the editor and the
//     bar's enabled toggle stays in sync.
function buildAssetTagHtml(dep) {
  let url  = (dep.url || '').trim();
  const ver   = (dep.v || '').trim();
  const kind  = dep.kind || 'script';
  const attrs = dep.attrs || [];
  if (!url) return '';
  url = (ver && ver !== '–') ? url.replace('{v}', ver) : url.replace('{v}', '');
  let tag;
  if (kind === 'style') {
    const media = attrs.includes('print') ? ' media="print"' : attrs.includes('all') ? ' media="all"' : '';
    tag = `<link rel="stylesheet" href="${url}"${media} />`;
  } else {
    let extra = '';
    if (attrs.includes('defer'))       extra += ' defer';
    else if (attrs.includes('async'))  extra += ' async';
    if (attrs.includes('module'))      extra += ' type="module"';
    tag = `<script src="${url}"${extra}></script>`;
  }
  if (dep.enabled === false) {
    tag = `<!-- ${tag} -->`;
  }
  return tag;
}

function renderTokens(tokens) {
  const out = [];
  let pendingType = null;
  let key = 0;
  for (const tok of tokens) {
    if (tok === '__active') continue;
    if (tok === 'tag' || tok === 'attr' || tok === 'str' || tok === 'cls' || tok === 'txt') {
      pendingType = tok; continue;
    }
    if (pendingType) {
      out.push(<span key={key++} className={`tk-${pendingType}`}>{tok}</span>);
      pendingType = null;
    } else {
      out.push(<span key={key++} className="tk-punc">{tok}</span>);
    }
  }
  return out;
}

function EditorPaneStatic({ title, lang, lines, readOnly, actions = ['format','copy'] }) {
  const T = I;
  const langClass = (lang || '').toLowerCase();
  const LangIcon = ({
    html: T.htmlLogo, css: T.cssLogo, js: T.jsLogo,
  })[langClass];
  return (
    <div className="ed-pane">
      <div className="ed-pane-head">
        <div className="ed-pane-title">
          {LangIcon && <LangIcon size={14} />}
          <span className="ed-title">{title}</span>
        </div>
        <div className="ed-pane-tools">
          {actions.includes('format') && !readOnly && <Button type="button" variant="ghost" size="sm" className={PANE_TOOL_CLS}><T.bolt size={12} /> Format</Button>}
          {actions.includes('copy') && <Button type="button" variant="ghost" size="sm" className={PANE_TOOL_CLS}><T.copy size={12} /> Copy</Button>}
        </div>
      </div>
      <div className="ed-pane-body">
        {lines.map((line, i) => {
          const active = line.includes('__active');
          return (
            <div key={i} className={`ln${active ? ' active' : ''}`}>
              <span className="n">{i + 1}</span>
              <span className="c">{renderTokens(line)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Page scope, head + footer chunks injected only on the current page.
// On every edit we mirror the new value onto every sibling UiChemy Composer
// widget in the current Elementor document so the floating panel stays
// consistent regardless of which widget is open (legacy parity).
function PagePanes() {
  const active = useActiveWidget();
  const skipModel = active && active.model;

  const onPageHead = React.useCallback((next) => {
    propagateComposerSetting('page_custom_code_head', next, skipModel);
  }, [skipModel]);
  const onPageFooter = React.useCallback((next) => {
    propagateComposerSetting('page_custom_code_footer', next, skipModel);
  }, [skipModel]);

  return (
    <PaneTabs
      panes={[
        {
          id: 'head',
          tabLabel: 'Head',
          title: 'Before the </head> on this page',
          render: () => (
            <EditorPaneLive
              title="Before the </head> on this page"
              lang="HTML"
              languageKey="html"
              settingKey="page_custom_code_head"
              onAfterWrite={onPageHead}
            />
          ),
        },
        {
          id: 'footer',
          tabLabel: 'Footer',
          title: 'Before the </body> on this page',
          render: () => (
            <EditorPaneLive
              title="Before the </body> on this page"
              lang="HTML"
              languageKey="html"
              settingKey="page_custom_code_footer"
              onAfterWrite={onPageFooter}
            />
          ),
        },
      ]}
    />
  );
}

// Site scope, head + footer chunks injected site-wide. On every edit we
// mirror the new value to sibling widgets AND persist the shared values
// to the WP option via the `uichemy_composer_save_site_custom_code`
// AJAX endpoint (debounced). Same flow the legacy editor uses.
function SitePanes() {
  const active = useActiveWidget();
  const settings = active && active.model && active.model.get && active.model.get('settings');
  const skipModel = active && active.model;

  function readSettingNow(key) {
    if (!settings || typeof settings.get !== 'function') return '';
    const v = settings.get(key);
    return typeof v === 'string' ? v : v == null ? '' : String(v);
  }

  function onSiteHead(next) {
    propagateComposerSetting('site_custom_code_head', next, skipModel);
    saveSharedSiteCustomCodeDebounced(next, readSettingNow('site_custom_code_footer'));
  }
  function onSiteFooter(next) {
    propagateComposerSetting('site_custom_code_footer', next, skipModel);
    saveSharedSiteCustomCodeDebounced(readSettingNow('site_custom_code_head'), next);
  }

  return (
    <PaneTabs
      panes={[
        {
          id: 'head',
          tabLabel: 'Head',
          title: 'Before the </head> on every page',
          render: () => (
            <EditorPaneLive
              title="Before the </head> on every page"
              lang="HTML"
              languageKey="html"
              settingKey="site_custom_code_head"
              onAfterWrite={onSiteHead}
            />
          ),
        },
        {
          id: 'footer',
          tabLabel: 'Footer',
          title: 'Before the </body> on every page',
          render: () => (
            <EditorPaneLive
              title="Before the </body> on every page"
              lang="HTML"
              languageKey="html"
              settingKey="site_custom_code_footer"
              onAfterWrite={onSiteFooter}
            />
          ),
        },
      ]}
    />
  );
}

function EditorPaneStaticText({ title, lang, languageKey, value, readOnly }) {
  const T = I;
  const langClass = (lang || '').toLowerCase();
  const LangIcon = ({ html: T.htmlLogo, css: T.cssLogo, js: T.jsLogo })[langClass];
  // Show formatted code by default. The Globals panes render generated CSS
  // that is read-only here, so formatting is purely a display concern, there
  // is nothing to persist. Re-derives whenever the source value changes.
  const displayValue = React.useMemo(
    () => formatCode(value || '', languageKey || langClass || 'css'),
    [value, languageKey, langClass]
  );

  const [copied, setCopied] = React.useState(false);
  function copy() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(displayValue).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="ed-pane ed-pane-live">
      <div className="ed-pane-head">
        <div className="ed-pane-title">
          {LangIcon && <LangIcon size={14} />}
          <span className="ed-title">{title}</span>
        </div>
        <div className="ed-pane-tools">
          <Button type="button" variant="ghost" size="sm" className={PANE_TOOL_CLS} onClick={copy} title="Copy contents">{copied ? <T.check size={12} /> : <T.copy size={12} />} {copied ? 'Copied' : 'Copy'}</Button>
        </div>
      </div>
      <div className="ed-pane-body ed-pane-body-live">
        <CodeMirrorEditor
          languageKey={languageKey || 'css'}
          value={displayValue}
          readOnly={readOnly !== false}
        />
      </div>
    </div>
  );
}

// Tracks which (widget, setting) pairs have already been auto-formatted in
// this editor session. Lives at module scope, NOT in component state, so it
// survives the unmount/remount that happens every time the user switches Code
// scopes or leaves and re-enters the Code tab. Without this the pane would
// reformat on every re-entry and clobber code the user has since hand-edited.
const _autoFormattedOnce = new Set();

function EditorPaneLive({ title, lang, languageKey, settingKey, readOnly, onAfterWrite, assets }) {
  const T = I;
  const langClass = (lang || '').toLowerCase();
  const LangIcon = ({ html: T.htmlLogo, css: T.cssLogo, js: T.jsLogo })[langClass];
  const active = useActiveWidget();
  const widgetId = (active && active.model && (active.model.id || active.model.cid)) || 'na';
  const seedKey = `${widgetId}::${settingKey}`;
  const [value, setValue, isActive] = useWidgetSetting(settingKey);
  const [copied, setCopied] = React.useState(false);

  function copy() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value || '').catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // `onAfterWrite(next)` runs after the value has been written through to
  // the active widget's Backbone settings. Page / site scopes use it to
  // mirror the new value onto sibling widgets and (for site) to persist
  // to the shared WP option via AJAX.
  const handleChange = React.useCallback((next) => {
    setValue(next);
    if (typeof onAfterWrite === 'function') onAfterWrite(next);
  }, [setValue, onAfterWrite]);

  // Auto-format on first display only. Stored code is often saved unformatted
  // (AI output / minified / single line), so without this the pane shows a
  // wall of unformatted text until the user clicks Format. We seed the
  // formatted version exactly once per (widget, setting), the first time it
  // receives non-empty, editable content, then record it in the module-level
  // registry so re-entering the Code tab never reformats it again. This is the
  // key difference from a component ref: the registry survives remounts, so
  // code the user has hand-edited (even back into an unformatted shape) is
  // left untouched on subsequent visits.
  React.useEffect(() => {
    if (_autoFormattedOnce.has(seedKey)) return;
    if (!isActive || readOnly) return;
    const current = value || '';
    if (!current.trim()) return; // wait for real content to load
    _autoFormattedOnce.add(seedKey);
    const formatted = formatCode(current, languageKey || langClass);
    if (formatted !== current) handleChange(formatted);
  }, [seedKey, value, isActive, readOnly, languageKey, langClass, handleChange]);

  function doFormat() {
    if (!isActive || readOnly) return;
    const formatted = formatCode(value || '', languageKey || langClass);
    if (formatted !== (value || '')) handleChange(formatted);
  }

  const canFormat = isActive && !readOnly;

  return (
    <div className={`ed-pane ed-pane-live${isActive ? '' : ' ed-pane-disabled'}`}>
      <div className="ed-pane-head">
        <div className="ed-pane-title">
          {LangIcon && <LangIcon size={14} />}
          <span className="ed-title">{title}</span>
        </div>
        <div className="ed-pane-tools">
          {assets && (
            <Button
              type="button"
              variant={assets.active ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(PANE_TOOL_CLS, assets.active && 'text-foreground')}
              onClick={assets.onClick}
              title="3rd party assets injected with this widget"
            >
              <T.layers size={12} /> Assets
              {assets.count > 0 && (
                <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-sm bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">{assets.count}</span>
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={PANE_TOOL_CLS}
            onClick={doFormat}
            disabled={!canFormat}
            title="Format code"
          >
            <T.bolt size={12} /> Format
          </Button>
          <Button type="button" variant="ghost" size="sm" className={PANE_TOOL_CLS} onClick={copy} title="Copy contents">
            {copied ? <T.check size={12} /> : <T.copy size={12} />} {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <div className="ed-pane-body ed-pane-body-live">
        <CodeMirrorEditor
          languageKey={languageKey}
          value={value || ''}
          onChange={handleChange}
          disabled={!isActive}
          readOnly={readOnly || !isActive}
        />
        {!isActive && (
          <div className="ed-pane-empty">Select a UiChemy Composer widget</div>
        )}
      </div>
    </div>
  );
}

// ── Per-scope deps wiring ──────────────────────────────────────────────────────
function useStandardDeps() {
  const [raw, setRaw] = useWidgetSetting('raw_deps_standard');
  const deps = React.useMemo(() => parseDepsJson(raw), [raw]);
  const setDeps = React.useCallback((next) => setRaw(stringifyDeps(next)), [setRaw]);
  return [deps, setDeps];
}

function usePageDeps() {
  const active = useActiveWidget();
  const skipModel = active && active.model;
  const [raw, setRaw] = useWidgetSetting('raw_deps_page');
  const deps = React.useMemo(() => parseDepsJson(raw), [raw]);
  const setDeps = React.useCallback((next) => {
    const json = stringifyDeps(next);
    setRaw(json);
    propagateComposerSetting('raw_deps_page', json, skipModel);
  }, [setRaw, skipModel]);
  return [deps, setDeps];
}

function useSiteDeps() {
  const active = useActiveWidget();
  const skipModel = active && active.model;
  const [raw, setRaw] = useWidgetSetting('raw_deps_site');
  const deps = React.useMemo(() => parseDepsJson(raw), [raw]);
  const setDeps = React.useCallback((next) => {
    const json = stringifyDeps(next);
    setRaw(json);
    propagateComposerSetting('raw_deps_site', json, skipModel);
    saveSharedSiteDepsDebounced(next);
  }, [setRaw, skipModel]);
  return [deps, setDeps];
}

// Full-width editor tabs: shows ONE EditorPaneLive at a time with a segmented
// switcher, instead of cramming 2–3 editors into side-by-side columns that are
// unreadable in the narrow floating panel. Each pane: { id, tabLabel, title?,
// count?, render() }.
function PaneTabs({ panes }) {
  const [active, setActive] = React.useState(panes[0]?.id);
  const segRef = useSlidingSeg();
  const activeId = panes.some((p) => p.id === active) ? active : panes[0]?.id;
  const activePane = panes.find((p) => p.id === activeId);
  if (!activePane) return null;
  return (
    <div className="code2-panes">
      {panes.length > 1 && (
        <div ref={segRef} className={cn(SEG_WRAP_CLS, 'seg-slide', 'code-pane-tabs')}>
          {panes.map((p) => (
            <button
              key={p.id}
              type="button"
              data-state={activeId === p.id ? 'active' : 'inactive'}
              className={cn(SEG_ITEM_CLS, 'min-w-0 flex-1 justify-center gap-1.5', activeId === p.id && SEG_ITEM_ON_SLIDE_CLS)}
              onClick={() => setActive(p.id)}
              title={p.title || p.tabLabel}
            >
              <span className="truncate">{p.tabLabel}</span>
              {p.count > 0 && (
                <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-sm bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">{p.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {/* Keyed by pane id so HTML / CSS / JS get their own component instance
          instead of one EditorPaneLive whose `settingKey` mutates underneath it.
          Same element type at the same position would otherwise be reconciled as
          "the same editor with new props", which is what let one pane's document
          and its CodeMirror instance carry over into the next. */}
      <React.Fragment key={activeId}>{activePane.render()}</React.Fragment>
    </div>
  );
}

export function CodeTab({ initialScope, mode }) {
  const [assetsOpen, setAssetsOpen] = React.useState(false);
  // Which asset kind the panel is focused on ('style' = CSS, 'script' = JS).
  const [assetsKind, setAssetsKind] = React.useState('style');
  const T = I;

  // Open the assets panel on a given kind; clicking the same kind again closes it.
  function toggleAssets(kind) {
    if (assetsOpen && assetsKind === kind) {
      setAssetsOpen(false);
    } else {
      setAssetsKind(kind);
      setAssetsOpen(true);
    }
  }
  // The old separate 'globals' code scope merged into 'variables' (one
  // Globals scope; its code view toggles inside).
  const [scopeState, setScope] = React.useState(
    initialScope === 'globals' ? 'variables' : (initialScope || 'standard')
  );
  // Simple mode exposes only the widget's own HTML/CSS/JS, no Page/Site/Globals
  // scope tabs. Force the standard scope and hide the switcher.
  const scope = mode === 'simple' ? 'standard' : scopeState;
  // Globals scope shows the Globals Manager (VariablesPanel). Raw CSS editing of
  // the same #uichemy-globals block is available in the Site scope's
  // "Before </head>" editor, so there is no separate CSS view here.

  const [depsStandard, setDepsStandard] = useStandardDeps();
  const [depsPage, setDepsPage]         = usePageDeps();
  const [depsSite, setDepsSite]         = useSiteDeps();

  // Code editor settings, needed so an added dep can auto-inject its tag.
  const active    = useActiveWidget();
  const skipModel = active && active.model;

  const [rawHtml,    setRawHtml]    = useWidgetSetting('raw_html');
  const [pageHead,   setPageHead]   = useWidgetSetting('page_custom_code_head');
  const [pageFooter, setPageFooter] = useWidgetSetting('page_custom_code_footer');
  const [siteHead,   setSiteHead]   = useWidgetSetting('site_custom_code_head');
  const [siteFooter, setSiteFooter] = useWidgetSetting('site_custom_code_footer');

  // Standard scope, there is no head/body split, so every dep tag goes
  // straight into the widget's HTML editor (raw_html). No site-wide
  // propagation; this widget owns its own HTML.
  const handleStandardAssetAdded = React.useCallback((dep) => {
    const tag = buildAssetTagHtml(dep);
    if (!tag) return;
    const next = rawHtml ? rawHtml + '\n' + tag : tag;
    setRawHtml(next);
  }, [rawHtml, setRawHtml]);

  const handleStandardAssetRemoved = React.useCallback((dep) => {
    if (!dep) return;
    const next = stripDepLine(rawHtml || '', dep);
    if (next === (rawHtml || '')) return;
    setRawHtml(next);
  }, [rawHtml, setRawHtml]);

  const handleStandardAssetReplaced = React.useCallback((prev, nextDep) => {
    if (!prev || !nextDep) return;
    let html = rawHtml || '';
    html = stripDepLine(html, prev);
    const tag = buildAssetTagHtml(nextDep);
    if (tag) html = html ? html + '\n' + tag : tag;
    if (html !== (rawHtml || '')) setRawHtml(html);
  }, [rawHtml, setRawHtml]);

  // Called by DependenciesBar when a dep is added from the picker.
  // Appends the asset tag to the matching code-editor setting so it's visible
  // in the Head / Footer panel immediately.
  const handlePageAssetAdded = React.useCallback((dep) => {
    const tag = buildAssetTagHtml(dep);
    if (!tag) return;
    if ((dep.position || 'before') === 'before') {
      const next = pageHead ? pageHead + '\n' + tag : tag;
      setPageHead(next);
      propagateComposerSetting('page_custom_code_head', next, skipModel);
    } else {
      const next = pageFooter ? pageFooter + '\n' + tag : tag;
      setPageFooter(next);
      propagateComposerSetting('page_custom_code_footer', next, skipModel);
    }
  }, [pageHead, pageFooter, setPageHead, setPageFooter, skipModel]);

  const handlePageAssetRemoved = React.useCallback((dep) => {
    if (!dep) return;
    if ((dep.position || 'before') === 'before') {
      const next = stripDepLine(pageHead || '', dep);
      if (next === (pageHead || '')) return;
      setPageHead(next);
      propagateComposerSetting('page_custom_code_head', next, skipModel);
    } else {
      const next = stripDepLine(pageFooter || '', dep);
      if (next === (pageFooter || '')) return;
      setPageFooter(next);
      propagateComposerSetting('page_custom_code_footer', next, skipModel);
    }
  }, [pageHead, pageFooter, setPageHead, setPageFooter, skipModel]);

  // Atomic replace, used when an existing dep's url/version/kind/attrs/position
  // changes. Computes the resulting head + footer from a SINGLE snapshot so we
  // don't end up with two stale-closure writes racing into the same setter
  // (which produces a duplicate tag instead of an updated one).
  const handlePageAssetReplaced = React.useCallback((prev, nextDep) => {
    if (!prev || !nextDep) return;
    const prevPos = (prev.position    || 'before');
    const nextPos = (nextDep.position || 'before');
    let head   = pageHead   || '';
    let footer = pageFooter || '';

    if (prevPos === 'before') head   = stripDepLine(head, prev);
    else                      footer = stripDepLine(footer, prev);

    const tag = buildAssetTagHtml(nextDep);
    if (tag) {
      if (nextPos === 'before') head   = head   ? head   + '\n' + tag : tag;
      else                      footer = footer ? footer + '\n' + tag : tag;
    }

    if (head !== (pageHead || '')) {
      setPageHead(head);
      propagateComposerSetting('page_custom_code_head', head, skipModel);
    }
    if (footer !== (pageFooter || '')) {
      setPageFooter(footer);
      propagateComposerSetting('page_custom_code_footer', footer, skipModel);
    }
  }, [pageHead, pageFooter, setPageHead, setPageFooter, skipModel]);

  const handleSiteAssetAdded = React.useCallback((dep) => {
    const tag = buildAssetTagHtml(dep);
    if (!tag) return;
    if ((dep.position || 'before') === 'before') {
      const next = siteHead ? siteHead + '\n' + tag : tag;
      setSiteHead(next);
      propagateComposerSetting('site_custom_code_head', next, skipModel);
      saveSharedSiteCustomCodeDebounced(next, siteFooter || '');
    } else {
      const next = siteFooter ? siteFooter + '\n' + tag : tag;
      setSiteFooter(next);
      propagateComposerSetting('site_custom_code_footer', next, skipModel);
      saveSharedSiteCustomCodeDebounced(siteHead || '', next);
    }
  }, [siteHead, siteFooter, setSiteHead, setSiteFooter, skipModel]);

  const handleSiteAssetReplaced = React.useCallback((prev, nextDep) => {
    if (!prev || !nextDep) return;
    const prevPos = (prev.position    || 'before');
    const nextPos = (nextDep.position || 'before');
    let head   = siteHead   || '';
    let footer = siteFooter || '';

    if (prevPos === 'before') head   = stripDepLine(head, prev);
    else                      footer = stripDepLine(footer, prev);

    const tag = buildAssetTagHtml(nextDep);
    if (tag) {
      if (nextPos === 'before') head   = head   ? head   + '\n' + tag : tag;
      else                      footer = footer ? footer + '\n' + tag : tag;
    }

    const headChanged   = head   !== (siteHead   || '');
    const footerChanged = footer !== (siteFooter || '');
    if (headChanged) {
      setSiteHead(head);
      propagateComposerSetting('site_custom_code_head', head, skipModel);
    }
    if (footerChanged) {
      setSiteFooter(footer);
      propagateComposerSetting('site_custom_code_footer', footer, skipModel);
    }
    if (headChanged || footerChanged) {
      saveSharedSiteCustomCodeDebounced(head, footer);
    }
  }, [siteHead, siteFooter, setSiteHead, setSiteFooter, skipModel]);

  const handleSiteAssetRemoved = React.useCallback((dep) => {
    if (!dep) return;
    if ((dep.position || 'before') === 'before') {
      const next = stripDepLine(siteHead || '', dep);
      if (next === (siteHead || '')) return;
      setSiteHead(next);
      propagateComposerSetting('site_custom_code_head', next, skipModel);
      saveSharedSiteCustomCodeDebounced(next, siteFooter || '');
    } else {
      const next = stripDepLine(siteFooter || '', dep);
      if (next === (siteFooter || '')) return;
      setSiteFooter(next);
      propagateComposerSetting('site_custom_code_footer', next, skipModel);
      saveSharedSiteCustomCodeDebounced(siteHead || '', next);
    }
  }, [siteHead, siteFooter, setSiteHead, setSiteFooter, skipModel]);

  // ── Reverse sync, editor → deps ─────────────────────────────────────────
  // When the user types/pastes a <script src> or <link rel=stylesheet> into
  // any of the editor strings, surface it as a row in the assets bar. The
  // forward direction (bar → editor) is already wired via the handle*Added
  // / handle*Removed / handle*Replaced callbacks above. The hook below
  // calls setDepsPage / setDepsSite / setDepsStandard DIRECTLY (not via
  // the bar's commitDep) so it can update the JSON without re-mirroring
  // back into the editor, preventing duplication loops.
  useEditorDepsSync({
    headText:   pageHead,
    footerText: pageFooter,
    deps:       depsPage,
    setDeps:    setDepsPage,
    positionAware: true,
  });
  useEditorDepsSync({
    headText:   siteHead,
    footerText: siteFooter,
    deps:       depsSite,
    setDeps:    setDepsSite,
    positionAware: true,
  });
  // Standard scope has no head/footer split, all dep tags live inside
  // raw_html. Pass an empty footer so the parser only walks the HTML, and
  // disable position-awareness so we don't clobber a stored position.
  useEditorDepsSync({
    headText:   rawHtml,
    footerText: '',
    deps:       depsStandard,
    setDeps:    setDepsStandard,
    positionAware: false,
  });

  const SCOPES = [
    { id: 'standard', label: 'Standard', sub: 'Widget HTML / CSS / JS', icon: T.code },
    { id: 'page',     label: 'Page',     sub: 'Injected on this page only', icon: T.pageCode },
    { id: 'site',     label: 'Site',     sub: 'Injected on every page', icon: T.site },
    { id: 'variables', label: 'Globals', sub: 'Variables, classes & buttons, var(--…) / .class', icon: T.globe },
  ];

  const scopeDeps = { standard: depsStandard, page: depsPage, site: depsSite, globals: [], variables: [] };
  const scopeSetDeps = {
    standard: setDepsStandard,
    page:     setDepsPage,
    site:     setDepsSite,
    globals:  () => {},
    variables: () => {},
  };
  const scopeOnAssetAdded = {
    standard: handleStandardAssetAdded,
    page:     handlePageAssetAdded,
    site:     handleSiteAssetAdded,
    globals:  null,
    variables: null,
  };
  const scopeOnAssetRemoved = {
    standard: handleStandardAssetRemoved,
    page:     handlePageAssetRemoved,
    site:     handleSiteAssetRemoved,
    globals:  null,
    variables: null,
  };
  const scopeOnAssetReplaced = {
    standard: handleStandardAssetReplaced,
    page:     handlePageAssetReplaced,
    site:     handleSiteAssetReplaced,
    globals:  null,
    variables: null,
  };

  return (
    <div className="code2">
      {mode !== 'simple' && (
      <div className="section-tabs code-scope-tabs">
        {/* Same treatment as the Design/Developer switch: underline tabs on a
            shared rule, with one bar that slides between them (TabsList
            variant="line"), rather than a filled pill. Equal columns so the
            four scopes divide the row evenly. */}
        <Tabs value={scope} onValueChange={(v) => v && setScope(v)} className="flex-1 min-w-0">
          <TabsList variant="line" className="w-full gap-0">
            {SCOPES.map(s => (
              <TabsTrigger
                key={s.id}
                value={s.id}
                title={s.label}
                className="min-w-0 flex-1 justify-center text-xs font-semibold"
              >
                <span className="truncate">{s.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* Standard scope surfaces assets from inside the CSS / JS panes. Page /
            Site have no CSS/JS panes, so their assets live in the accordion below. */}
      </div>
      )}

      <div className="code2-body">

        {/* Standard scope opens its DependenciesBar inline via the CSS/JS pane
            toggle. Page / Site expose it through a collapsible Assets accordion. */}
        {scope === 'standard' && assetsOpen && (
          <DependenciesBar
            scope={scope}
            deps={scopeDeps[scope]}
            setDeps={scopeSetDeps[scope]}
            onAssetAddedToCode={scopeOnAssetAdded[scope]}
            onAssetRemovedFromCode={scopeOnAssetRemoved[scope]}
            onAssetReplacedInCode={scopeOnAssetReplaced[scope]}
          />
        )}

        {(scope === 'page' || scope === 'site') && (() => {
          const cd = scopeDeps[scope] || [];
          const en = cd.filter((d) => d.enabled).length;
          return (
            <div className={cn('assets-acc', assetsOpen && 'open')}>
              <button
                type="button"
                className="assets-acc-head"
                onClick={() => setAssetsOpen((o) => !o)}
                aria-expanded={assetsOpen ? 'true' : 'false'}
                title="3rd party CSS / JS assets injected with this widget"
              >
                <T.bolt size={12} />
                <span className="assets-acc-label">Assets</span>
                {cd.length > 0 && (
                  <span className="ml-0.5 text-[10px] tabular-nums text-muted-foreground">{en}/{cd.length}</span>
                )}
                <span className="assets-acc-caret"><T.chevron size={11} /></span>
              </button>
              {assetsOpen && (
                <div className="assets-acc-body">
                  <DependenciesBar
                    scope={scope}
                    deps={scopeDeps[scope]}
                    setDeps={scopeSetDeps[scope]}
                    onAssetAddedToCode={scopeOnAssetAdded[scope]}
                    onAssetRemovedFromCode={scopeOnAssetRemoved[scope]}
                    onAssetReplacedInCode={scopeOnAssetReplaced[scope]}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {scope === 'standard' && (() => {
          /* The lock card comes from the per-plugin pro module: it stands in for the
             CSS and JavaScript panes where this build does not ship them, and is null
             where it does. Sizing the grid off it keeps this to one block with no tier
             check, and the two panes are not merely hidden when locked: the server
             never outputs raw_css/raw_js for that build, so custom CSS/JS cannot run
             at all (security, not decoration). */
          const lock = codeLock();
          const cssCount = depsStandard.filter((d) => d.kind !== 'script').length;
          const jsCount = depsStandard.filter((d) => d.kind === 'script').length;
          const panes = [
            {
              id: 'html', tabLabel: 'HTML',
              render: () => <EditorPaneLive title="HTML" lang="HTML" languageKey="html" settingKey="raw_html" />,
            },
          ];
          if (!lock) {
            panes.push({
              id: 'css', tabLabel: 'CSS', count: cssCount,
              render: () => (
                <EditorPaneLive
                  title="CSS" lang="CSS" languageKey="css" settingKey="raw_css"
                  assets={{
                    count: cssCount,
                    active: assetsOpen && assetsKind === 'style',
                    onClick: () => toggleAssets('style'),
                  }}
                />
              ),
            });
            panes.push({
              id: 'js', tabLabel: 'JS', count: jsCount,
              render: () => (
                <EditorPaneLive
                  title="JavaScript" lang="JS" languageKey="js" settingKey="raw_js"
                  assets={{
                    count: jsCount,
                    active: assetsOpen && assetsKind === 'script',
                    onClick: () => toggleAssets('script'),
                  }}
                />
              ),
            });
          }
          return <PaneTabs panes={panes} />;
        })()}

        {scope === 'page' && <PagePanes />}

        {scope === 'site' && <SitePanes />}

        {/* One Globals scope: the visual collections UI by default, with the
            generated-CSS code view behind the toolbar's Code toggle. */}
        {scope === 'variables' && (
          <div className="min-h-0 flex-1">
            <VariablesPanel />
          </div>
        )}

      </div>
    </div>
  );
}
