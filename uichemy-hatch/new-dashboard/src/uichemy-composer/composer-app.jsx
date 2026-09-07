// Top-level panel: tab switching across Direct Editor / Code / Chat.
import React from 'react';
import ReactDOM from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PortalContainerProvider, ensurePortalRoot } from '@/components/ui/portal-context';
import { I } from './composer-icons';
import { CanvasToolbarContent, setCanvasOutline } from './composer-toolbar';
import { ComposerErrorBoundary } from './composer-error-boundary';
import { LayersPane, FloatingLayers } from './composer-layers';
import { Inspector, stripFormattingWhitespace } from './composer-inspector';
import { CodeTab } from './composer-code';
// The Chat tab comes from the registry, not a direct import: Pro supplies the
// real chat, Free an upsell card, and this file is shared between both plugins.
import { getChatTab, subscribeChatTab, PassthroughProvider } from './composer-tab-slots';
import { ProUpsellHost, ProBadge, showChatUpsell, showDrawUpsell } from './composer-pro';
import ConstructTab, { markAsLoop, markAsForm, removeLoop, removeForm } from './composer-construct-tab';
import { useActiveWidget, useWidgetSetting, useWidgetLinkSetting, getRestApiBaseUrl, getRestNonce, selectComposerWidgetById, applyWidgetSnapById } from './composer-elementor';
import { seedHistory, recordHistory, setTip, getHistory, jumpToHistory, hydrateHistory, listScopes, commitGlobalUndo, commitGlobalRedo, canGlobalUndo, canGlobalRedo } from './composer-history';
import { reconstructWidget, appendStep, emptyBlob } from './composer-history-db';
import { HistoryList } from './composer-history-panel';
import {
  resolveSlotIndexForPath,
  applyLinkAtPath,
  applyElementLinkAttrsAtPath,
  normalizeLinkValue,
  syncSlotSettingsFromNode,
} from './composer-slots';
import { applySvgUrlAtPath, isSvgLayerEntry } from './composer-svg-utils';
import {
  useElementorDeviceMode,
  getMediaTextForElementorBreakpointKey,
} from './composer-breakpoints';
import {
  useLayerTree, applyLayerMove,
  applyLayerDelete, applyLayerPaste, getLayerOuterHtml,
  resolveNodeByPath,
  normalizeUichemyTags, denormalizeUichemyTags,
  tagCanHaveChildren,
  computePathForNode,
  pathRelevantChildren,
  isDynamicPlaceholderText,
} from './composer-layer-tree';

// Text properties that a generated child (a nav-menu link) sets on itself, so
// setting them on the template item alone can never reach the visible text.
// See mirrorTextStylesToGeneratedChild.
const GENERATED_TEXT_MIRROR_PROPS = new Set([
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-transform', 'text-decoration', 'text-decoration-color',
  'text-decoration-line', 'text-decoration-style', 'text-shadow',
  'white-space', 'text-overflow', 'text-indent',
]);
import {
  usePickMode, useSelectionDecorator, useActiveWidgetOutline, useInlineTextEdit,
  useChatPickSelection,
  COMPOSER_WIDGET_SELECTOR, applyInlineStyleLive,
} from './composer-pick';
import { useInjectImportedFontsIntoPreview } from './composer-fonts';
import { parseCssToScopes, parseInlineStyleToScope } from './composer-css-parser';
import { emptyProps } from './composer-data';
import {
  scopeToInlineStyle,
  scopeToStyleUpdates,
  updateRawCssForClass,
  diffScopeStyleUpdates,
  reconcileScopeStyleUpdates,
  upsertClassStyleUpdatesInBreakpoint,
  updateInlineStyleForPath,
  isElementScopeClassName,
  nextElementScopeClassName,
  promoteInlineStyleToClassAtPath,
} from './composer-css-writer';
import {
  pruneScopeDataToBreakpointOwnership,
  markScopePropOwn,
  clearScopePropOwn,
} from './composer-breakpoint-scope';
import {
  isTypographyGlobalScope,
} from './composer-cascade';
import { useGlobalClasses, hydrateGlobalClassScopes, isUiChemyGlobalClassScope, applyGlobalClassUpdates } from './composer-classes';
import { useUiChemyGlobalClasses, applyTypographyClassToGlobals } from './composer-variables';
import { frontendState, applyFrontendWidgetById } from './composer-frontend';
import { setBoxToolbarAI } from './composer-box-handles';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSlidingSeg } from './composer-inputs';

/**
 * Merge two customCss arrays while preserving the previous insertion order.
 * - Items in prevCss that still exist in seedCss keep their position (values updated from seed).
 * - Items removed from seedCss are dropped.
 * - Items new in seedCss (not in prevCss) are appended at the end.
 * This prevents the display order from changing when the CSS is re-parsed.
 */
function stableCustomCssOrder(prevCss, seedCss) {
  const prev = Array.isArray(prevCss) ? prevCss : [];
  const seed = Array.isArray(seedCss) ? seedCss : [];
  if (!prev.length) return seed;
  if (!seed.length) return [];
  const seedMap = new Map();
  for (const item of seed) {
    if (item && item.prop) seedMap.set(item.prop, item.value);
  }
  const prevPropSet = new Set();
  const retained = [];
  for (const item of prev) {
    if (!item || !item.prop) continue;
    if (seedMap.has(item.prop)) {
      retained.push({ prop: item.prop, value: seedMap.get(item.prop) });
      prevPropSet.add(item.prop);
    }
  }
  for (const item of seed) {
    if (item && item.prop && !prevPropSet.has(item.prop)) {
      retained.push(item);
    }
  }
  return retained;
}

function readHashPreset() {
  const raw = (typeof window !== 'undefined' && window.location.hash) || '';
  const h = raw.replace(/^#/, '');
  if (!h) return {};
  const [name, ...rest] = h.split('&');
  const params = Object.fromEntries(rest.map(p => {
    const [k, v] = p.split('=');
    return [k, decodeURIComponent(v || '')];
  }));
  const out = {};
  if (params.theme) out.theme = params.theme;
  if (params.skin) out.skin = params.skin;
  if (name === 'editor') { out.tab = 'direct'; out.collapsed = false; }
  else if (name === 'collapsed') { out.tab = 'direct'; out.collapsed = true; }
  else if (name.startsWith('code-')) { out.tab = 'code'; out.codeScope = name.slice(5); }
  else if (name.startsWith('chat-')) { out.tab = 'chat'; out.chatScenario = name.slice(5); }
  else if (name === 'code') { out.tab = 'code'; }
  else if (name === 'chat') { out.tab = 'chat'; }
  if (params.panel === '1') out.panelOnly = true;
  if (params.h) out.heightOverride = parseInt(params.h, 10);
  return out;
}

function deriveElement(entry) {
  if (!entry) return { tag: 'div', classes: [], text: '', slot: 0 };
  return {
    tag: entry.tag,
    classes: entry.classes,
    // Use full untruncated direct-text so the Inspector textarea has the
    // real value to edit — contentPreview is only for the layer-tree row.
    text: entry.directText != null ? entry.directText : (entry.contentPreview || ''),
    slot: 0,
  };
}

function replaceDirectTextOf(node, nextText) {
  const removes = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 3 /* TEXT */) removes.push(c);
  }
  for (const c of removes) node.removeChild(c);
  if (nextText !== '' && nextText != null) {
    const doc = node.ownerDocument || document;
    node.insertBefore(doc.createTextNode(String(nextText)), node.firstChild);
  }
}

// The right dock's default width, and the drag-resize range around it.
const DOCK_W = 332;
const DOCK_MIN = 280;
const DOCK_MAX = 720;

const CONSTRUCT_ACCORDION_META = {
  loop: { label: 'Loop', dot: 'hsl(var(--status-loop))' },
  form: { label: 'Form', dot: 'hsl(var(--status-form))' },
};

// Collapsible panel for a layer's dynamic construct (Loop / Form / Condition /
// Data). Lives at the bottom of the Editor tab's inspector body instead of a
// dedicated tab — expanded by default when a layer is marked so its options are
// immediately visible. Keyed by layer+type upstream, so it re-mounts (and
// re-opens) whenever the selection or construct changes.
function ConstructAccordion({ constructType, selectedEntry, rawHtml, onWriteHtml, onRemove }) {
  const [open, setOpen] = React.useState(true);
  const meta = CONSTRUCT_ACCORDION_META[constructType] || { label: 'Dynamic', dot: 'hsl(var(--muted-foreground))' };
  return (
    <div className={`construct-accordion${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="construct-accordion-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="construct-accordion-title">{meta.label}</span>
        <I.chevron size={10} className="construct-accordion-chevron" />
      </button>
      {open && (
        <div className="construct-accordion-body">
          <ComposerErrorBoundary label="Dynamic panel">
            <ConstructTab
              constructType={constructType}
              selectedEntry={selectedEntry}
              rawHtml={rawHtml}
              onWriteHtml={onWriteHtml}
              onRemove={onRemove}
            />
          </ComposerErrorBoundary>
        </div>
      )}
    </div>
  );
}

/**
 * @param {object}  props
 * @param {string} [props.surface] Where this instance is mounted:
 *   'drawer'    (default) — the floating right-dock shell, as in Elementor,
 *                Bricks and the front end.
 *   'inspector' — rendered INSIDE Gutenberg's Block tab (InspectorControls).
 *                WordPress's sidebar owns the position, width, scrolling and
 *                close button there, so this instance must not run any of the
 *                drawer-only chrome: no editor push, no fixed positioning, no
 *                resize/collapse. Both surfaces can be live at once (the block
 *                inspector plus an opened drawer), which is why these effects
 *                are gated per-instance rather than globally — two instances
 *                both pushing the editor would fight over the same CSS var.
 */
export function ComposerPanel({ surface = 'drawer' } = {}) {
  const isInspector = surface === 'inspector';
  const T = I;
  const preset = React.useMemo(readHashPreset, []);
  const active = useActiveWidget();
  const hasWidget = !!active;

  // Live front-end context (the composer mounted on the rendered page, not the
  // Elementor editor). PHP localises `uichComposerEditorCfg.frontend = true` and
  // the picker bridge sets `uichUiChemyFrontend` — but those globals ride on
  // enqueued script handles and may not be defined at the exact tick this
  // component first mounts (script-order dependent). When they're missing the
  // toolbar pill never appears on load and only shows up after a widget is
  // picked (the `hasWidget` path) — the bug this guards against. So we ALSO read
  // DOM signals that PHP always bakes into the served markup and that are
  // therefore present the moment the app mounts: the `uichemy-frontend-editor`
  // body class and the panel root's `data-uichemy-frontend="1"` attribute.
  const isFrontend = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (window.uichComposerEditorCfg && window.uichComposerEditorCfg.frontend) return true;
    if (window.uichUiChemyFrontend) return true;
    try {
      if (document.body && document.body.classList.contains('uichemy-frontend-editor')) return true;
      if (document.querySelector('#uichemy-composer-floating-panel[data-uichemy-frontend="1"], .uichemy-composer-floating-panel[data-uichemy-frontend="1"]')) return true;
    } catch (_) { /* SSR / detached document */ }
    return false;
  }, []);

  // Are we inside the Gutenberg block editor? Same belt-and-braces shape as
  // `isFrontend`: the localized cfg (set by enqueue_gutenberg_composer_editor_script)
  // may not be defined at the tick we mount, so also accept DOM signals WordPress
  // always bakes into the block-editor screen.
  const isGutenberg = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (window.uichComposerEditorCfg && window.uichComposerEditorCfg.builder === 'gutenberg') return true;
    try {
      if (document.body && document.body.classList.contains('block-editor-page')) return true;
      if (document.querySelector('.interface-interface-skeleton')) return true;
    } catch (_) { /* SSR / detached document */ }
    return false;
  }, []);

  // Are we inside the Bricks builder? Same belt-and-braces shape as the two
  // above: prefer the localized cfg, fall back to DOM signals Bricks always
  // renders into the builder shell — the fixed `#bricks-toolbar` plus the
  // `.brx-body` flex layout root (the two elements the push effect below
  // shrinks). `window.bricksData` is a further builder-only signal.
  const isBricks = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (window.uichComposerEditorCfg && window.uichComposerEditorCfg.builder === 'bricks') return true;
    try {
      if (document.getElementById('bricks-toolbar') && document.querySelector('.brx-body')) return true;
      if (window.bricksData && typeof window.bricksData === 'object') return true;
    } catch (_) { /* SSR / detached document */ }
    return false;
  }, []);

  // Mirror imported fonts (Google/Bunny <link>s, @font-face blocks) into the
  // Elementor preview iframe's <head> so newly-added fonts render INSTANTLY
  // in the editor without requiring a refresh. The published page is fine
  // either way — this is purely for the editor preview to match.
  useInjectImportedFontsIntoPreview();

  // Role Manager access flags, localised by PHP on uichComposerEditorCfg.
  // `contentOnly` restricts the UI to content editing — the Code tab is hidden.
  // `features` gates optional surfaces (AI chat). An ABSENT config opens
  // everything, which preserves behaviour anywhere the flags aren't sent yet.
  //
  // Note: PHP casts the top-level `contentOnly` boolean to "" / "1", while the
  // nested `features` booleans survive as real booleans — hence the two styles.
  //
  // This is a DIFFERENT axis from the Free/Pro gate below: Role Manager asks
  // "may this ROLE use it", the build gate asks "does this BUILD ship it". A
  // surface must clear both.
  const access = React.useMemo(() => {
    const cfg = (typeof window !== 'undefined' && window.uichComposerEditorCfg) || {};
    const f = cfg.features || {};
    const feat = (v) => (v === undefined ? true : !!v);
    return {
      contentOnly: !!cfg.contentOnly,
      features: {
        theme_builder: feat(f.theme_builder),
        design_system: feat(f.design_system),
        ai_chat: feat(f.ai_chat),
      },
    };
  }, []);
  const canAiChat = access.features.ai_chat;

  // White Label branding for the panel's brand mark, localised by PHP on the same
  // config (UiChemy_Composer_Enqueue::brand_cfg()). `logo` is empty unless
  // white-labeling is on AND a logo was uploaded, so an unbranded site keeps our
  // own inline mark.
  const { brandLogo, brandName } = React.useMemo(() => {
    const b = ((typeof window !== 'undefined' && window.uichComposerEditorCfg) || {}).brand || {};
    return { brandLogo: b.logo || '', brandName: b.name || 'UiChemy' };
  }, []);

  // Whichever Chat tab this build registered (Pro: the real one; Free: the
  // upsell). Null would mean a build that ships no Chat tab at all, in which
  // case the tab button and its body are simply not rendered.
  // Subscribed, not read-once: the real Chat tab arrives from the PRO bundle,
  // which registers whenever its script evaluates. On the Elementor drawer that
  // is BEFORE we mount (we wait for the shell to appear in the preview iframe),
  // but in Gutenberg's inspector host it can land after — so the subscription is
  // what re-renders the panel on a late swap.
  const chatSlot = React.useSyncExternalStore(subscribeChatTab, getChatTab, getChatTab);
  // Whether the registered tab is a stand-in rather than working chat. The build
  // declares this itself when it registers (`pro: true`), which is why this panel
  // needs no tier lookup: a build shipping real chat simply never sets the flag.
  // The tab still shows when locked — with a PRO pill — but the canvas Draw /
  // Ask-AI buttons upsell instead of opening it.
  const chatLocked = !!(chatSlot && chatSlot.pro);
  const ChatSession = chatSlot?.SessionProvider || PassthroughProvider;
  // Always land on the Editor tab. Chat is opened deliberately — by clicking the
  // tab, by the canvas Ask-AI action, or by a `#chat` hash preset — never by
  // default, so opening the panel doesn't drop a Pro user into a conversation
  // they didn't ask for. (This used to start on Chat whenever a usable one was
  // registered, which on a Pro site meant every single time: the PRO bundle
  // registers at script eval, long before the drawer shell exists for us to
  // mount into, so its tab was always present at first render.)
  const [tab, setTab] = React.useState(preset.tab || 'direct');
  // Light/dark, persisted per-builder for the same reason as the skin below:
  // wp-admin is a light UI, so the panel defaults to LIGHT inside Gutenberg
  // (dark everywhere else, unchanged) instead of dropping a dark slab into the
  // block editor. A deliberate toggle is still remembered, separately per
  // builder, so switching to dark in Gutenberg doesn't darken Elementor too.
  const themeStorageKey = isGutenberg ? 'uich-composer-theme-gutenberg' : 'uich-composer-theme';
  const [theme, setTheme] = React.useState(() => {
    if (preset.theme === 'light' || preset.theme === 'dark') {
      return preset.theme;
    }
    try {
      const stored = localStorage.getItem(themeStorageKey);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) { }
    return isGutenberg ? 'light' : 'dark';
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch (e) { }
  }, [theme, themeStorageKey]);

  // Color skin — a second palette that is orthogonal to light/dark.
  // 'brand' = the default purple/green look, 'elementor' = Elementor's editor
  // palette (pink accent, #515962 text, 3px radius), 'gutenberg' = the block
  // editor's palette (#3858e9 accent, #1e1e1e text, 13px, 2px radius).
  // Persisted like the theme.
  //
  // The native skin is per-builder, and so is its storage key: Gutenberg reads
  // and writes `uich-composer-skin-gutenberg`. Sharing one key across builders
  // meant a skin chosen in Elementor decided how the panel looked inside
  // Gutenberg — including leaving Elementor's pink accent on the block editor —
  // and there is no sensible way to translate one builder's choice into the
  // other. Separate keys let each builder default to looking native while
  // still remembering a deliberate switch to 'brand'.
  // The front end uses the Gutenberg skin, same as the block editor. The skin's
  // job is to make the panel look native to WordPress, and the live site is a
  // WordPress surface — blue WP-admin chrome reads as "a WordPress tool", where
  // Elementor's pink only makes sense INSIDE Elementor's own editor. So the
  // "native" identity is Gutenberg whenever we're in the block editor OR on the
  // front-end drawer; Elementor's editor is the only place that stays pink.
  const usesGutenbergSkin = isGutenberg || isFrontend;
  const skinStorageKey = usesGutenbergSkin ? 'uich-composer-skin-gutenberg' : 'uich-composer-skin';
  // The "looks like the host builder" skin, and its name for the toggle's
  // tooltip — the one skin button now means "native palette ⇄ Brand" in both
  // builders instead of always offering Elementor's.
  const nativeSkin = usesGutenbergSkin ? 'gutenberg' : 'elementor';
  const nativeSkinLabel = usesGutenbergSkin ? 'Gutenberg' : 'Elementor';
  const [skin, setSkin] = React.useState(() => {
    // A skin is only valid for the builder it belongs to. 'brand' is universal
    // (the neutral base palette), but the two NATIVE skins are mutually
    // exclusive: Elementor's pink must never appear in the block editor, and
    // Gutenberg's blue must never appear in Elementor. Without this guard a
    // stale per-builder localStorage value, or a `#…&skin=elementor` hash from a
    // preview link, leaks the wrong builder's palette in — which is exactly how
    // the Gutenberg panel came up wearing Elementor's pink chrome (visible
    // connection chip, pink Send, pink message bubbles). The native skin for THIS
    // builder plus 'brand' are the only two options that make sense here. */
    const valid = (v) => v === 'brand' || v === nativeSkin;
    if (valid(preset.skin)) return preset.skin;
    try {
      const stored = localStorage.getItem(skinStorageKey);
      if (valid(stored)) return stored;
    } catch (e) { }
    // In the block editor and on the front end, look native (Gutenberg) out of
    // the box; inside Elementor's editor keep Brand.
    return usesGutenbergSkin ? 'gutenberg' : 'brand';
  });

  // Persist the skin per builder. Because `setSkin` above already rejects the
  // wrong builder's native palette, writing back here also overwrites any stale
  // value a previous build stored — e.g. an 'elementor' left under the Gutenberg
  // key by the old hardcoded toggle — so existing installs self-heal on first
  // load instead of needing a manual switch.
  React.useEffect(() => {
    try {
      localStorage.setItem(skinStorageKey, skin);
    } catch (e) { }
  }, [skin, skinStorageKey]);

  /* Appearance is now set in Dashboard → Settings, which is a different page.
     `storage` fires only in OTHER tabs, so an editor left open picks the change
     up instead of looking broken until reload. Both keys are handled here
     because the two states are read the same way. */
  React.useEffect(() => {
    function onStorage(e) {
      if (e.key === themeStorageKey && (e.newValue === 'dark' || e.newValue === 'light')) {
        setTheme(e.newValue);
      }
      // Same validity rule as the initial read above: 'brand' is universal, but
      // a native skin only belongs to its own builder. Without this a value
      // written under the other builder's key — or an older stale one — would
      // leak Elementor's pink into the block editor.
      if (e.key === skinStorageKey && (e.newValue === 'brand' || e.newValue === nativeSkin)) {
        setSkin(e.newValue);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [themeStorageKey, skinStorageKey, nativeSkin]);


  React.useEffect(() => {
    function onSwitchTab(e) {
      const next = e && e.detail && e.detail.tab;
      if (next !== 'direct' && next !== 'code' && next !== 'chat') return;
      // Respect Role Manager restrictions on programmatic tab switches too —
      // otherwise an event could open a tab the role is not allowed to see.
      if (next === 'code' && access.contentOnly) return;
      if (next === 'chat' && !canAiChat) return;
      setTab(next);
      setPanelCollapsed(false);
    }
    window.addEventListener('uich:composer-switch-tab', onSwitchTab);
    return () => window.removeEventListener('uich:composer-switch-tab', onSwitchTab);
  }, []);

  /* The canvas toolbar's Ask AI action opens the Chat tab, so it is only useful
     when that tab can actually open. Gated on the same two conditions as the tab
     itself (line ~3490): the role allows AI chat, and a chat slot is registered
     — in the Free build there is none, so the button stays hidden rather than
     doing nothing. */
  React.useEffect(() => {
    setBoxToolbarAI(!!canAiChat && !!chatSlot);
  }, [canAiChat, chatSlot]);

  /** Theme must live on the document that owns the panel (often the preview iframe). */
  const applyTheme = React.useCallback((mode, panelEl) => {
    const host = panelEl && panelEl.closest && panelEl.closest('.uich-composer-host');
    if (host) {
      host.dataset.theme = mode;
      host.dataset.uichComposerTheme = mode;
      host.style.colorScheme = mode;
      // shadcn theme switch — the Tailwind scope resolves dark tokens off this class.
      host.classList.toggle('dark', mode === 'dark');
    }
    const shell = panelEl && panelEl.closest && (
      panelEl.closest('#uichemy-composer-floating-panel') ||
      panelEl.closest('#smart-html-floating-panel')
    );
    if (shell) {
      shell.dataset.uichComposerTheme = mode;
      shell.style.colorScheme = mode;
    }
    if (panelEl) {
      panelEl.dataset.theme = mode;
      panelEl.dataset.uichComposerTheme = mode;
      panelEl.style.colorScheme = mode;
    }
    const doc = panelEl ? panelEl.ownerDocument : document;
    if (doc && doc.body) {
      doc.body.dataset.uichComposerTheme = mode;
    }
    // Keep the scoped shadcn portal hosts (panel doc + top doc) theme-synced.
    try { ensurePortalRoot(doc, mode); } catch (_) { }
    if (doc !== document) {
      try { ensurePortalRoot(document, mode); } catch (_) { }
    }
  }, []);

  /** Skin (color palette) travels on the same hosts as the theme. Mirrors
   *  applyTheme: `.skin-elementor` drives the shadcn tokens (scoped to
   *  `.uich-tw`), the `data-uich-composer-skin` attribute drives the legacy
   *  `--panel-*` tokens. Kept separate from applyTheme so the two toggles
   *  compose without re-running each other. */
  const applySkin = React.useCallback((mode, panelEl) => {
    const isEl = mode === 'elementor';
    const isGb = mode === 'gutenberg';
    const setAttr = (el) => {
      if (!el) return;
      // 'brand' is the absence of a skin — the base tokens already are it.
      if (isEl || isGb) el.dataset.uichComposerSkin = mode;
      else delete el.dataset.uichComposerSkin;
    };
    const setClasses = (el) => {
      if (!el) return;
      el.classList.toggle('skin-elementor', isEl);
      el.classList.toggle('skin-gutenberg', isGb);
    };
    const host = panelEl && panelEl.closest && panelEl.closest('.uich-composer-host');
    if (host) {
      setAttr(host);
      setClasses(host);
    }
    const shell = panelEl && panelEl.closest && (
      panelEl.closest('#uichemy-composer-floating-panel') ||
      panelEl.closest('#smart-html-floating-panel')
    );
    setAttr(shell);
    if (panelEl) {
      setAttr(panelEl);
      setClasses(panelEl);
    }
    const doc = panelEl ? panelEl.ownerDocument : document;
    if (doc && doc.body) setAttr(doc.body);
    // Portaled popovers/menus live in the scoped portal root — keep it synced.
    try { ensurePortalRoot(doc, undefined, mode); } catch (_) { }
    if (doc !== document) {
      try { ensurePortalRoot(document, undefined, mode); } catch (_) { }
    }
  }, []);

  // Default container for all shadcn portal components (popovers, menus,
  // selects…) — lives in the panel's own document so anchor coordinates and
  // the `.uich-tw` scope both hold.
  const [portalRoot, setPortalRoot] = React.useState(null);
  React.useLayoutEffect(() => {
    const doc = (panelRef.current && panelRef.current.ownerDocument) || document;
    try { setPortalRoot(ensurePortalRoot(doc, theme, skin)); } catch (_) { setPortalRoot(null); }
  }, [theme, skin]);

  const { entries: layerEntries } = useLayerTree();
  const [rawHtml, setRawHtml] = useWidgetSetting('raw_html');
  const [rawCss, setRawCss] = useWidgetSetting('raw_css');
  // Page- and site-level code (Sir's ask: version-history beyond the widget). These
  // are widget settings synced page/site-wide; head+footer map onto the same
  // two-field snapshot the history uses ({raw_html: head, raw_css: footer}).
  const [pageHead, setPageHead] = useWidgetSetting('page_custom_code_head');
  const [pageFooter, setPageFooter] = useWidgetSetting('page_custom_code_footer');
  const [siteHead, setSiteHead] = useWidgetSetting('site_custom_code_head');
  const [siteFooter, setSiteFooter] = useWidgetSetting('site_custom_code_footer');
  const rawHtmlRef = React.useRef(rawHtml || '');
  const rawCssRef = React.useRef(rawCss || '');
  React.useEffect(() => { rawHtmlRef.current = rawHtml || ''; }, [rawHtml]);
  React.useEffect(() => { rawCssRef.current = rawCss || ''; }, [rawCss]);
  const { device, setDevice, breakpoints } = useElementorDeviceMode();
  const activeMediaQuery = React.useMemo(
    () => getMediaTextForElementorBreakpointKey(device),
    [device],
  );
  const [selectedLayerId, setSelectedLayerId] = React.useState(null);
  const [picking, setPicking] = React.useState(false);
  // One-shot guard: set true just before a widget is loaded via the "open panel"
  // button, so the auto-arm effect below skips arming the picker that once —
  // opening the panel shouldn't switch the canvas into pick mode uninvited.
  const suppressAutoArmRef = React.useRef(false);
  // Dashboard "Editor mode" setting (Settings screen → uichemy_settings.editor_mode,
  // localized into the editor cfg): 'both' shows the Design/Developer switch and
  // remembers the user's choice; 'design' / 'developer' LOCK the composer to that
  // mode and hide the switch. forcedMode maps that to the internal simple/pro.
  const editorModeSetting = React.useMemo(() => {
    try {
      const m = (window.uichComposerEditorCfg && window.uichComposerEditorCfg.editorMode) || 'both';
      return (m === 'design' || m === 'developer') ? m : 'both';
    } catch (_) { return 'both'; }
  }, []);
  const forcedMode = editorModeSetting === 'design' ? 'simple' : (editorModeSetting === 'developer' ? 'pro' : null);

  // Editing mode: 'simple' (non-technical: no layers/classes, flat effective
  // styles) or 'pro' (the full class/cascade experience). Persisted — unless the
  // dashboard forces a mode, in which case forcedMode wins and is not persisted
  // (so the user's own 'both' preference survives a later switch back to Both).
  const [mode, setMode] = React.useState(() => {
    if (forcedMode) return forcedMode;
    try { return localStorage.getItem('uich_composer_mode') === 'simple' ? 'simple' : 'pro'; } catch (e) { return 'pro'; }
  });
  React.useEffect(() => {
    if (forcedMode) { if (mode !== forcedMode) setMode(forcedMode); return; }
    try { localStorage.setItem('uich_composer_mode', mode); } catch (e) { /* ignore */ }
  }, [mode, forcedMode]);
  // Right-click context menu on a preview element (Simple mode has no Layers
  // panel, so this is how users mark/duplicate/delete). { id, x, y } | null.
  const [previewMenu, setPreviewMenu] = React.useState(null);
  const [markSubOpen, setMarkSubOpen] = React.useState(false);
  // Gutenberg only: a mount node we inject into WordPress's settings-sidebar
  // header (the Page/Block + ✕ row) and portal the Layers toggle into, per
  // request. null until the header is found — the button then falls back to its
  // in-panel spot, so a WP markup change can't make it vanish entirely.
  const [headerSlot, setHeaderSlot] = React.useState(null);
  const clipboardRef = React.useRef({ html: '', mode: 'copy' });

  const writeHtml = React.useCallback((nextHtml, newSelectedId) => {
    if (!hasWidget) return;
    if (nextHtml == null) return;
    if (nextHtml === rawHtmlRef.current) return;
    rawHtmlRef.current = nextHtml;
    setRawHtml(nextHtml);
    if (typeof newSelectedId !== 'undefined') {
      setSelectedLayerId(newSelectedId || null);
    }
  }, [hasWidget, setRawHtml]);

  // ── Session Undo/Redo (Phase 1) ───────────────────────────────────────────
  // Per-widget snapshot stack in memory (see composer-history.js). Records on
  // every raw_html/raw_css settle; undo/redo re-apply through writeHtml/setRawCss
  // (builder-aware, so all three builders are covered).
  const historyWidgetId = (active && active.model && typeof active.model.get === 'function')
    ? (active.model.get('id') || '') : '';
  // Human name for the active element, stamped on each snapshot so the whole-page
  // timeline can say WHICH element changed (Elementor label, then UiChemy id, then
  // a short element-id tail). Best-effort — never throws.
  const activeWidgetLabel = React.useMemo(() => {
    try {
      const s = active && active.model && active.model.get && active.model.get('settings');
      const t = (s && s.get && (s.get('_title') || s.get('widget_id'))) || '';
      if (t) return String(t).trim();
    } catch (_) { /* fall through */ }
    return historyWidgetId ? ('Element ' + String(historyWidgetId).slice(-4)) : 'Element';
  }, [active, historyWidgetId]);
  const [historyTick, setHistoryTick] = React.useState(0);
  // Which tab the Layers/History floating popup shows. History lives as a second
  // tab in the SAME popup (not a separate window).
  const [popupTab, setPopupTab] = React.useState('layers');
  const bumpHistory = React.useCallback(() => setHistoryTick((t) => (t + 1) & 0xffff), []);
  const historyWho = (typeof window !== 'undefined' && window.uichComposerEditorCfg
    && (window.uichComposerEditorCfg.userName || window.uichComposerEditorCfg.user)) || 'You';
  // While an undo/redo is being applied, its writes land as one or two separate
  // state updates. Native keydown handlers aren't React-batched (React 17), so the
  // record effect can see an INTERMEDIATE state ({new css, old html}) and push a
  // spurious entry. Hold the target here and skip recording until the state
  // matches it (apply settled), so undo/redo never pollute the stack.
  const pendingApplyRef = React.useRef(null);

  React.useEffect(() => {
    if (!historyWidgetId) return;
    seedHistory(historyWidgetId, { raw_html: rawHtmlRef.current, raw_css: rawCssRef.current, who: historyWho, wlabel: activeWidgetLabel });
    bumpHistory();
  }, [historyWidgetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Post id for DB persistence (Phase 3). Editor cfg first, front-end cfg fallback.
  const historyPostId = (typeof window !== 'undefined' && (
    (window.uichComposerEditorCfg && window.uichComposerEditorCfg.postId)
    || (window.uichUiChemyFrontend && window.uichUiChemyFrontend.postId)
  )) || 0;
  const persistedLogRef = React.useRef({ postId: null, blob: null });
  const persistTimersRef = React.useRef({}); // scopeKey → timeout id (per-scope debounce)
  // Non-widget history scopes (Sir: page/site code). Keyed so they never collide
  // with a real widget id.
  const PAGE_SCOPE = '__page';
  const SITE_SCOPE = '__site';
  const pendingPageRef = React.useRef(null);
  const pendingSiteRef = React.useRef(null);
  // page/site code loads async; don't record the empty→loaded transition as an
  // edit. Set true after the load effect hydrates + seeds with real values.
  const pageSiteReadyRef = React.useRef(false);

  // Ensure the post's diff-blob is loaded before we mutate it, so a fast first
  // edit doesn't start a fresh blob and clobber the server's existing history.
  const ensureBlob = React.useCallback(async () => {
    if (persistedLogRef.current.postId === historyPostId && persistedLogRef.current.blob) {
      return persistedLogRef.current.blob;
    }
    const base = getRestApiBaseUrl();
    const nonce = getRestNonce();
    let blob = emptyBlob();
    if (base && historyPostId) {
      try {
        const r = await fetch(`${base}/uichemy/v1/history?post_id=${encodeURIComponent(historyPostId)}`, {
          headers: { 'X-WP-Nonce': nonce }, credentials: 'same-origin',
        });
        const d = await r.json();
        if (d && d.data && d.data.widgets) blob = d.data;
      } catch (_) { /* no persisted history is fine */ }
    }
    persistedLogRef.current = { postId: historyPostId, blob };
    return blob;
  }, [historyPostId]);

  // Debounced "transit" save: append the current state as a DIFF (jsondiffpatch)
  // to the post's blob ~2s after the last edit, then PUT the whole (small) blob.
  // Never fires for undo/redo applies (the record effect returns before this).
  const schedulePersist = React.useCallback((scopeKey, snap) => {
    if (!scopeKey || !historyPostId) return;
    const timers = persistTimersRef.current;
    if (timers[scopeKey]) clearTimeout(timers[scopeKey]);
    timers[scopeKey] = setTimeout(async () => {
      const base = getRestApiBaseUrl();
      const nonce = getRestNonce();
      if (!base) return;
      const blob = await ensureBlob();
      const h = getHistory(scopeKey);
      const label = (h.entries && h.entries[0] && h.entries[0].label) || 'Change';
      const { blob: nextBlob, changed } = appendStep(
        blob, scopeKey,
        { html: snap.html || '', css: snap.css || '' },
        { label, who: historyWho, wlabel: snap.wlabel || '' },
      );
      if (!changed) return;
      persistedLogRef.current = { postId: historyPostId, blob: nextBlob };
      fetch(`${base}/uichemy/v1/history`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        body: JSON.stringify({ post_id: historyPostId, data: nextBlob }),
      }).catch(() => { /* transit save is best-effort */ });
    }, 2000);
  }, [historyPostId, ensureBlob, historyWho]);

  React.useEffect(() => {
    if (!historyWidgetId) return;
    const cur = { raw_html: rawHtml || '', raw_css: rawCss || '' };
    const p = pendingApplyRef.current;
    if (p) {
      // An undo/redo apply is in flight — don't record. Clear once settled.
      if ((p.raw_html || '') === cur.raw_html && (p.raw_css || '') === cur.raw_css) {
        pendingApplyRef.current = null;
      }
      bumpHistory();
      return;
    }
    // Front-end sections load their code ASYNC after select. When the settling
    // value equals the freshly-loaded server copy, it's the LOAD (or a select),
    // not a user edit — re-baseline the tip so it never becomes a spurious undo
    // step / global move (which was making one widget appear twice in undo).
    const ld = frontendState && frontendState.loadedData;
    if (ld && historyWidgetId === frontendState.elementId
        && (ld.html || '') === cur.raw_html && (ld.css || '') === cur.raw_css) {
      setTip(historyWidgetId, { ...cur, who: historyWho, wlabel: activeWidgetLabel });
      bumpHistory();
      return;
    }
    const changed = recordHistory(historyWidgetId, { ...cur, who: historyWho, wlabel: activeWidgetLabel });
    try { console.log('[UiChemy history] record widget', historyWidgetId, '→', changed, 'canUndo=', canGlobalUndo()); } catch (_) {}
    bumpHistory();
    // Only touch the DB when the widget actually changed. Selecting a widget or
    // an echo re-render records nothing, so it must not append a duplicate row
    // (the post's history is capped — spurious rows evict real history).
    if (changed) schedulePersist(historyWidgetId, { html: cur.raw_html, css: cur.raw_css, wlabel: activeWidgetLabel });
  }, [rawHtml, rawCss, historyWidgetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Page- and site-level code history (Sir's ask) ─────────────────────────
  // page_custom_code_head/footer → PAGE_SCOPE; site_custom_code_head/footer →
  // SITE_SCOPE (Globals CSS rides inside site head). Same record/persist/hydrate
  // as widgets, keyed by scope. Restore is scope-aware (see applyScopeSnap).
  React.useEffect(() => {
    if (!historyPostId || !pageSiteReadyRef.current) return;
    const cur = { raw_html: pageHead || '', raw_css: pageFooter || '' };
    const p = pendingPageRef.current;
    if (p) { if ((p.raw_html || '') === cur.raw_html && (p.raw_css || '') === cur.raw_css) pendingPageRef.current = null; bumpHistory(); return; }
    const changed = recordHistory(PAGE_SCOPE, { ...cur, who: historyWho, label: 'Page code' });
    bumpHistory();
    if (changed) schedulePersist(PAGE_SCOPE, { html: cur.raw_html, css: cur.raw_css });
  }, [pageHead, pageFooter, historyPostId]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!historyPostId || !pageSiteReadyRef.current) return;
    const cur = { raw_html: siteHead || '', raw_css: siteFooter || '' };
    const p = pendingSiteRef.current;
    if (p) { if ((p.raw_html || '') === cur.raw_html && (p.raw_css || '') === cur.raw_css) pendingSiteRef.current = null; bumpHistory(); return; }
    const changed = recordHistory(SITE_SCOPE, { ...cur, who: historyWho, label: 'Site code' });
    bumpHistory();
    if (changed) schedulePersist(SITE_SCOPE, { html: cur.raw_html, css: cur.raw_css });
  }, [siteHead, siteFooter, historyPostId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load persisted history for this post, reconstruct the active widget's snapshots
  // from the diff-blob, and hydrate the session stack so the panel + undo include
  // past sessions / other users.
  React.useEffect(() => {
    if (!historyWidgetId || !historyPostId) return undefined;
    let cancelled = false;
    ensureBlob().then((blob) => {
      if (cancelled) return;
      // Whole-page timeline: hydrate EVERY widget in the blob (not just the active
      // one) so past-session edits to any element show up. The active widget also
      // gets the live state appended as its tip.
      const widgetKeys = (blob && blob.widgets) ? Object.keys(blob.widgets) : [];
      widgetKeys.forEach((k) => {
        if (k === PAGE_SCOPE || k === SITE_SCOPE) return; // handled explicitly below
        const rows = reconstructWidget(blob, k);
        if (!rows.length) return;
        const current = (k === historyWidgetId)
          ? { raw_html: rawHtmlRef.current, raw_css: rawCssRef.current, who: historyWho }
          : null;
        hydrateHistory(k, rows, current);
      });
      // The active widget may have no blob rows yet (never persisted) — seed it so
      // it appears in the timeline immediately.
      seedHistory(historyWidgetId, { raw_html: rawHtmlRef.current, raw_css: rawCssRef.current, who: historyWho, wlabel: activeWidgetLabel });
      // Page + site code scopes too (Globals rides inside site head). Seed a base
      // with the current value so the first edit's pre-edit state is restorable.
      seedHistory(PAGE_SCOPE, { raw_html: pageHead || '', raw_css: pageFooter || '', who: historyWho, label: 'Page code' });
      seedHistory(SITE_SCOPE, { raw_html: siteHead || '', raw_css: siteFooter || '', who: historyWho, label: 'Site code' });
      hydrateHistory(PAGE_SCOPE, reconstructWidget(blob, PAGE_SCOPE), { raw_html: pageHead || '', raw_css: pageFooter || '', who: historyWho });
      hydrateHistory(SITE_SCOPE, reconstructWidget(blob, SITE_SCOPE), { raw_html: siteHead || '', raw_css: siteFooter || '', who: historyWho });
      pageSiteReadyRef.current = true; // begin recording page/site edits now
      bumpHistory();
    });
    return () => { cancelled = true; };
  }, [historyWidgetId, historyPostId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scope-aware restore: widget code, page code, or site code (Globals lives in
  // site head). Uses the matching setters so all builders + the sync are covered.
  const applyScopeSnap = React.useCallback((scopeKey, snap) => {
    if (!snap) return;
    if (scopeKey === PAGE_SCOPE) {
      pendingPageRef.current = { raw_html: snap.raw_html || '', raw_css: snap.raw_css || '' };
      setPageHead(snap.raw_html || '');
      setPageFooter(snap.raw_css || '');
      setTimeout(() => { pendingPageRef.current = null; }, 60);
    } else if (scopeKey === SITE_SCOPE) {
      pendingSiteRef.current = { raw_html: snap.raw_html || '', raw_css: snap.raw_css || '' };
      setSiteHead(snap.raw_html || '');
      setSiteFooter(snap.raw_css || '');
      setTimeout(() => { pendingSiteRef.current = null; }, 60);
    } else if (scopeKey === historyWidgetId) {
      // Active widget → go through the React setters so its open panel + preview
      // refresh. pendingApplyRef stops the resulting state settle from re-recording.
      pendingApplyRef.current = { raw_html: snap.raw_html || '', raw_css: snap.raw_css || '' };
      if ((snap.raw_css || '') !== rawCssRef.current) { rawCssRef.current = snap.raw_css || ''; setRawCss(snap.raw_css || ''); }
      if ((snap.raw_html || '') !== rawHtmlRef.current) { writeHtml(snap.raw_html || ''); }
      setTimeout(() => { pendingApplyRef.current = null; }, 60);
    } else {
      // A DIFFERENT element → write straight to it by id (no selection or async
      // race); the selected element is left untouched. On the live front end there
      // is NO builder editor model — paint the section + persist via REST. In a
      // builder editor, write the element's model directly.
      const pair = { raw_html: snap.raw_html || '', raw_css: snap.raw_css || '' };
      if (isFrontend) applyFrontendWidgetById(scopeKey, pair);
      else applyWidgetSnapById(scopeKey, pair);
    }
    bumpHistory();
  }, [setRawCss, writeHtml, setPageHead, setPageFooter, setSiteHead, setSiteFooter, bumpHistory, historyWidgetId]);

  // Whole-page undo/redo: step the global order and apply — synchronously.
  // applyScopeSnap routes the write to the right place: active widget via React
  // setters, page/site via their setters, ANY OTHER element straight to its model
  // by id (no async select race). Then move the visual selection to that element
  // for feedback — best-effort, correctness never depends on it.
  const runGlobal = React.useCallback((mode) => {
    const r = mode === 'undo' ? commitGlobalUndo() : commitGlobalRedo();
    try { console.log('[UiChemy history] runGlobal', mode, '→', r && r.scope, 'active=', historyWidgetId, 'isActiveTarget=', !!r && r.scope === historyWidgetId); } catch (_) {}
    if (!r) return;
    applyScopeSnap(r.scope, r.snap);
    if (r.scope !== PAGE_SCOPE && r.scope !== SITE_SCOPE && r.scope !== historyWidgetId) {
      try { selectComposerWidgetById(r.scope); } catch (_) { /* visual only */ }
    }
  }, [historyWidgetId, applyScopeSnap]); // eslint-disable-line react-hooks/exhaustive-deps
  const doUndo = React.useCallback(() => runGlobal('undo'), [runGlobal]);
  const doRedo = React.useCallback(() => runGlobal('redo'), [runGlobal]);
  const doJumpHistory = React.useCallback((scopeKey, absIndex) => {
    if (scopeKey) applyScopeSnap(scopeKey, jumpToHistory(scopeKey, absIndex));
  }, [applyScopeSnap]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      const z = e.key === 'z' || e.key === 'Z';
      const y = e.key === 'y' || e.key === 'Y';
      if (!(e.ctrlKey || e.metaKey) || (!z && !y)) return;
      // Inline text / real inputs keep the browser's own undo.
      const t = e.target;
      const tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
      const inField = tag === 'input' || tag === 'textarea' || (t && t.isContentEditable);
      try { console.log('[UiChemy history] keydown seen z/y, target=', tag, 'inField=', inField); } catch (_) {}
      if (inField) return;
      // Redo is Cmd/Ctrl+Shift+Z everywhere, plus Ctrl+Y on Windows/Linux only.
      // Cmd+Y is a macOS browser shortcut (History) — never bind it, or the page
      // opens History instead of redoing. So Ctrl+Y needs ctrl WITHOUT meta.
      const ctrlYRedo = y && e.ctrlKey && !e.metaKey;
      if (y && !ctrlYRedo) return; // Cmd+Y (mac) → leave it to the browser
      const wantRedo = ctrlYRedo || (z && e.shiftKey);
      // Whole-page undo/redo — steps the last change ANYWHERE (applies by element
      // id), so it works even when nothing is selected.
      const can = wantRedo ? canGlobalRedo() : canGlobalUndo();
      try { console.log('[UiChemy history] key', wantRedo ? 'redo' : 'undo', 'can=', can); } catch (_) {}
      if (can) {
        e.preventDefault();
        e.stopPropagation();
        if (wantRedo) doRedo(); else doUndo();
      }
    };
    const targets = [window];
    try {
      document.querySelectorAll('iframe').forEach((f) => {
        try { const d = f.contentDocument; if (d) targets.push(d); } catch (_) { /* cross-origin */ }
      });
    } catch (_) { /* noop */ }
    targets.forEach((t) => { try { t.addEventListener('keydown', onKey, true); } catch (_) {} });
    return () => targets.forEach((t) => { try { t.removeEventListener('keydown', onKey, true); } catch (_) {} });
  }, [historyWidgetId, doUndo, doRedo]);

  const onMoveLayer = React.useCallback((dragId, dropId, placement) => {
    const dragEntry = layerEntries.find((e) => e.id === dragId);
    const dropEntry = layerEntries.find((e) => e.id === dropId);
    if (!dragEntry || !dropEntry) return;
    const result = applyLayerMove(rawHtml, dragEntry.path, dropEntry.path, placement);
    if (!result) return;
    writeHtml(result.html, result.newId);
  }, [layerEntries, rawHtml, writeHtml]);

  const onLayerCopy = React.useCallback((id) => {
    const entry = layerEntries.find((e) => e.id === id);
    if (!entry) return;
    const html = getLayerOuterHtml(rawHtml, entry.path);
    if (html) clipboardRef.current = { html, mode: 'copy' };
  }, [layerEntries, rawHtml]);

  const onLayerCut = React.useCallback((id) => {
    const entry = layerEntries.find((e) => e.id === id);
    if (!entry) return;
    const html = getLayerOuterHtml(rawHtml, entry.path);
    if (!html) return;
    clipboardRef.current = { html, mode: 'cut' };
    const result = applyLayerDelete(rawHtml, entry.path);
    if (result) writeHtml(result.html, result.newSelectedId);
  }, [layerEntries, rawHtml, writeHtml]);

  const onLayerPaste = React.useCallback((id, placement = 'before') => {
    const entry = layerEntries.find((e) => e.id === id);
    if (!entry) return;
    const { html: clipHtml, mode } = clipboardRef.current;
    if (!clipHtml) return;
    const result = applyLayerPaste(rawHtml, clipHtml, entry.path, placement);
    if (!result || result.html === rawHtml) return;
    writeHtml(result.html, result.newSelectedId);
    if (mode === 'cut') clipboardRef.current = { html: '', mode: 'copy' };
  }, [layerEntries, rawHtml, writeHtml]);

  const onLayerDelete = React.useCallback((id) => {
    const entry = layerEntries.find((e) => e.id === id);
    if (!entry) return;
    const result = applyLayerDelete(rawHtml, entry.path);
    if (result) writeHtml(result.html, result.newSelectedId);
  }, [layerEntries, rawHtml, writeHtml]);

  const onLayerDuplicate = React.useCallback((id) => {
    const entry = layerEntries.find((e) => e.id === id);
    if (!entry) return;
    const snippet = getLayerOuterHtml(rawHtml, entry.path);
    if (!snippet) return;
    const result = applyLayerPaste(rawHtml, snippet, entry.path, 'after');
    if (result) writeHtml(result.html, result.newSelectedId);
  }, [layerEntries, rawHtml, writeHtml]);

  // Build a starter snippet for a tag — sensible defaults so a freshly
  // added layer renders something visible the user can immediately style.
  // Custom `uichemy-*` tags are emitted self-closing (matches the editor's
  // existing convention; composer-layer-tree normalises them internally).
  const buildLayerSnippet = React.useCallback((tag) => {
    const t = String(tag || '').toLowerCase().trim();
    if (!t) return '';
    if (t === 'img') return '<img src="" alt="" />';
    if (t === 'a') return '<a href="#">Link text</a>';
    if (t === 'button') return '<button>Button</button>';
    if (/^h[1-6]$/.test(t)) return `<${t}>Heading</${t}>`;
    if (t === 'p') return '<p>Paragraph text</p>';
    if (t === 'span') return '<span>Span text</span>';
    if (t === 'ul' || t === 'ol') return `<${t}>\n  <li>Item one</li>\n  <li>Item two</li>\n</${t}>`;
    if (t === 'li') return '<li>List item</li>';
    if (t.startsWith('uichemy-')) return `<${t} />`;
    return `<${t}></${t}>`;
  }, []);

  // Add a new layer of the requested tag. Placement rules:
  //   1. No selection                          → append at the top level.
  //   2. Selected tag CAN have children        → insert INSIDE the
  //                                              selected layer (becomes
  //                                              its last child).
  //   3. Selected tag is a void / leaf element → insert AFTER it inside
  //      (e.g. <img>, <br>, <input>)            its parent, since making
  //                                              a child of a void element
  //                                              would produce invalid
  //                                              markup.
  // Selection follows the newly inserted node so the inspector
  // immediately reflects the addition.
  const onAddLayer = React.useCallback((tag) => {
    if (!hasWidget) return;
    const snippet = buildLayerSnippet(tag);
    if (!snippet) return;

    // No selection → top-level append. Same behavior as before, including
    // the "snippet IS the whole content when rawHtml is empty" case.
    if (!selectedLayerId) {
      const cur = (rawHtmlRef.current || '').replace(/\s+$/, '');
      const nextHtml = cur ? `${cur}\n${snippet}` : snippet;
      writeHtml(nextHtml);
      return;
    }

    const entry = layerEntries.find((e) => e.id === selectedLayerId);
    if (!entry) {
      // Selection points at a stale node — fall back to top-level append
      // rather than silently dropping the user's click.
      const cur = (rawHtmlRef.current || '').replace(/\s+$/, '');
      const nextHtml = cur ? `${cur}\n${snippet}` : snippet;
      writeHtml(nextHtml);
      return;
    }

    // Determine where it can legally land. If the selected tag can hold
    // children, drop it inside; otherwise the new layer becomes a sibling
    // immediately after the selected (i.e. ends up in the selected's
    // parent, which is the user's likely intent).
    //
    // SVG layers (both real <svg> and <img data-as="svg">) are opaque leaves —
    // their internals are not shown in the layer tree, so new tags must always
    // go 'after' rather than 'inside', even though SVG is not a void element.
    const isSvgLayer = entry.tag === 'svg';
    const placement = (!isSvgLayer && tagCanHaveChildren(entry.tag)) ? 'inside' : 'after';
    const result = applyLayerPaste(rawHtml, snippet, entry.path, placement);
    if (result && result.html !== rawHtml) {
      writeHtml(result.html, result.newSelectedId);
    }
  }, [
    hasWidget, buildLayerSnippet, writeHtml,
    selectedLayerId, layerEntries, rawHtml,
  ]);

  const hasClipboard = !!clipboardRef.current.html;
  const panelRef = React.useRef(null);

  // Tracks whether the user last clicked inside our panel. Read by the
  // keyboard handler below so we only intercept shortcuts when our panel
  // owns "focus", leaving Elementor's shortcuts fully intact otherwise.
  const panelHasFocusRef = React.useRef(false);

  React.useLayoutEffect(() => {
    applyTheme(theme, panelRef.current);
  }, [theme, applyTheme]);

  React.useLayoutEffect(() => {
    applySkin(skin, panelRef.current);
  }, [skin, applySkin]);

  // Keep panelHasFocusRef in sync with where the user clicks. Runs at
  // capture on the panel's own document so it fires before any other handler.
  // The floating Layers navigator is portaled OUTSIDE `panelRef` (its own
  // `.layers-float` host on document.body), so a plain `panelRef.contains`
  // check reads clicks there as "outside the panel" — which let Elementor's
  // Delete shortcut through and deleted the whole Composer widget instead of the
  // selected layer. Treat the floating Layers panel as part of our surface too.
  React.useEffect(() => {
    const doc = (panelRef.current?.ownerDocument) || document;
    function onMouseDown(e) {
      const inPanel = !!(panelRef.current && panelRef.current.contains(e.target));
      const inLayers = !!(e.target && e.target.closest && e.target.closest('.layers-float'));
      panelHasFocusRef.current = inPanel || inLayers;
    }
    doc.addEventListener('mousedown', onMouseDown, true);
    return () => doc.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  // Layer keyboard shortcuts (⌘C/⌘X/⌘V/⌘D/Delete/Backspace).
  //
  // Registered on the WINDOW at capture phase — this runs before any
  // document-level listener (Elementor's included), regardless of when
  // Elementor registered its own handlers. stopImmediatePropagation +
  // stopPropagation ensures the event never reaches Elementor when our
  // panel is the active surface. When the panel is not focused the handler
  // returns immediately so Elementor behaves as if we weren't here at all.
  React.useEffect(() => {
    if (!hasWidget || !selectedLayerId) return undefined;
    if (tab !== 'direct') return undefined;
    const doc = (panelRef.current && panelRef.current.ownerDocument) || document;
    const win = doc.defaultView || window;
    function isEditingTarget(node) {
      if (!node) return false;
      const tag = node.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (node.isContentEditable) return true;
      if (node.closest && node.closest('.CodeMirror')) return true;
      if (node.closest && node.closest('.chat2-wrap')) return true;
      // Treat any click within the inspector body as an editing context — prevents
      // Backspace/Delete layer shortcuts from firing while the user edits properties.
      if (node.closest && node.closest('.inspector-body')) return true;
      return false;
    }
    function onKey(e) {
      if (!panelHasFocusRef.current) return;
      if (isEditingTarget(doc.activeElement)) return;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (meta && key === 'c') {
        e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();
        onLayerCopy(selectedLayerId);
      } else if (meta && key === 'x') {
        e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();
        onLayerCut(selectedLayerId);
      } else if (meta && key === 'v') {
        e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();
        onLayerPaste(selectedLayerId, 'before');
      } else if (meta && key === 'd') {
        e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();
        onLayerDuplicate(selectedLayerId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !meta) {
        // Both keys must be intercepted: Elementor deletes the selected widget
        // on Delete AND Backspace, so letting either through (e.g. the macOS
        // ⌫ key reports 'Backspace') would nuke the whole Composer widget.
        e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();
        onLayerDelete(selectedLayerId);
      }
    }
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  }, [hasWidget, selectedLayerId, tab, onLayerCopy, onLayerCut, onLayerPaste, onLayerDelete, onLayerDuplicate]);

  // Click-away deselect plumbing: when the user clicks outside the composer UI
  // we clear the selection AND set this flag so the re-anchor effect below does
  // NOT immediately re-pick the first layer (otherwise the outline never clears).
  // Reset whenever the active widget changes — a fresh widget selects normally.
  const deselectedRef = React.useRef(false);
  const pickingRef = React.useRef(picking);
  const selectedIdRef = React.useRef(selectedLayerId);
  React.useEffect(() => { pickingRef.current = picking; }, [picking]);
  React.useEffect(() => { selectedIdRef.current = selectedLayerId; }, [selectedLayerId]);
  // Reset the deliberate-deselect flag only when the widget IDENTITY changes, not
  // on every model-object swap. A save/Publish re-render hands us a NEW model
  // object for the SAME widget; keying off `active?.model` alone would treat that
  // as a widget switch, wipe the flag, and let the re-anchor effect re-pick the
  // first layer — so after a click-away deselect + Publish the inspector jumped to
  // a different element. Compare the widget id instead.
  const lastWidgetIdRef = React.useRef(null);
  React.useEffect(() => {
    const wid = active?.model?.get?.('id') ?? null;
    if (wid !== lastWidgetIdRef.current) {
      lastWidgetIdRef.current = wid;
      deselectedRef.current = false;
    }
  }, [active?.model]);

  // Set whenever the front end picks a widget on the user's behalf (a fresh
  // pick with no widget loaded yet, or switching to a different section) to
  // the path of whatever element the user actually clicked — consumed by the
  // re-anchor effect the moment THAT widget's layer tree loads, so the right
  // panel shows THAT element's properties. Without this, every pick would
  // land on the widget's first layer and picking would feel like a two-step
  // "select the section, then select the element" flow instead of one click.
  // Tagged with the elementId it belongs to so the re-anchor effect never
  // applies it against a stale/different widget's layerEntries mid-transition
  // (a plain path alone can't tell those apart).
  const pendingCrossWidgetPathRef = React.useRef(null); // { elementId, path } | null
  // Forces another pass of the re-anchor effect while a pick is still queued.
  //
  // That effect only re-runs when `layerEntries`, `selectedLayerId` or `active`
  // change — and a section switch can change NONE of them after the first pass:
  // two sections with identical raw_html produce the identical `layerEntries`
  // reference (useWidgetSetting bails on an unchanged string), and `active`
  // changes exactly once. So the pick sat queued through the one grace pass and
  // was never looked at again, leaving the panel on the old element until some
  // unrelated render happened to come along — the "data only shows on the second
  // click" report. Nudging keeps the retry loop alive on its own.
  const [pendingNudge, setPendingNudge] = React.useState(0);
  const nudgeScheduledRef = React.useRef(false);
  const scheduleReanchorRetry = React.useCallback(() => {
    if (nudgeScheduledRef.current) return;
    nudgeScheduledRef.current = true;
    Promise.resolve().then(() => {
      nudgeScheduledRef.current = false;
      setPendingNudge((n) => n + 1);
    });
  }, []);
  // A pick queued for a widget that is not active YET waits on a real timer,
  // not a microtask: the editor swaps the panel over asynchronously, and a
  // microtask loop would burn the whole retry budget before that ever lands.
  const waitScheduledRef = React.useRef(false);
  const scheduleReanchorWait = React.useCallback(() => {
    if (waitScheduledRef.current) return;
    waitScheduledRef.current = true;
    setTimeout(() => {
      waitScheduledRef.current = false;
      setPendingNudge((n) => n + 1);
    }, 40);
  }, []);
  // Tracks the last `active.model` id the re-anchor effect observed, so it
  // can tell the FIRST render after a widget switch apart from later ones.
  // `active.model`'s id flips synchronously (useSyncExternalStore), but
  // `layerEntries` (sourced from useWidgetSetting('raw_html'), which only
  // catches up via its OWN useEffect one render later — see
  // composer-elementor.jsx's useWidgetSetting) can still hold the PREVIOUS
  // widget's parsed tree on that same render. On a fresh first pick that
  // stale tree is empty (harmless — the length-guard below bails), but on a
  // switch between two already-loaded widgets it's non-empty, so it slips
  // past that guard and gets misread as the new widget's real layer tree.
  const lastReanchorIdRef = React.useRef(undefined);
  const stashPendingPickPath = React.useCallback((container, clickedNode, elementId) => {
    if (!container || !clickedNode) return;
    try {
      const path = computePathForNode(container, clickedNode);
      if (path) {
        pendingCrossWidgetPathRef.current = { elementId: elementId || null, path };
      }
    } catch (_) { /* noop */ }
  }, []);

  // Front end, first pick: the page bridge hands over the exact node the user
  // clicked (frontendState.pickedNode). Turn it into a pending layer path so the
  // panel opens ON that element. Without this the pick only loaded the widget and
  // anchored to its first layer, so selecting an element took a SECOND pick —
  // which is how it behaved in practice, even though the bridge already resolved
  // the click to a node. Queued through the same ref the cross-widget switch uses,
  // so the re-anchor effect below consumes it once THIS widget's tree has parsed.
  React.useEffect(() => {
    if (!isFrontend) return;
    const node = frontendState.pickedNode;
    if (!node) return;
    frontendState.pickedNode = null; // one-shot
    // Deliberately does NOT disarm the picker. The page bridge and the panel
    // each keep their own `picking` flag, and they have to agree: the bridge no
    // longer stops picking when a pick lands either (see onMouseDown in
    // uichemy-frontend-bridge.js), because the toolbar button is a MODE the user
    // turns off by pressing it again. Clearing only this one would light the
    // button while the page had already dropped the crosshair.
    // The container that plays the parser's implicit wrapper role — the same node
    // getWidgetRoot() resolves — so computed paths line up with layerEntries.
    const container = node.closest
      ? node.closest('.elementor-widget-container, .wp-block-uichemy-composer')
      : null;
    if (container && container !== node) {
      stashPendingPickPath(container, node, frontendState.elementId || null);
    }
  }, [active, isFrontend, stashPendingPickPath]);

  // Re-anchor the selection whenever the parsed entries change (HTML edit,
  // widget switch). If the previously-selected layer no longer exists, pick the
  // first entry; if there are no entries, clear. Skip the re-pick right after an
  // explicit click-away deselect so the outline can actually stay cleared.
  React.useEffect(() => {
    if (!layerEntries.length) {
      if (selectedLayerId !== null) setSelectedLayerId(null);
      return;
    }
    const currentId = active && active.model && typeof active.model.get === 'function'
      ? active.model.get('id') : null;
    // The very first render where `currentId` changes is never trustworthy —
    // `layerEntries` may still be the previous widget's tree (see
    // lastReanchorIdRef's declaration above). Wait for the render after.
    const idJustChanged = lastReanchorIdRef.current !== currentId;
    lastReanchorIdRef.current = currentId;
    const pending = pendingCrossWidgetPathRef.current;
    if (pending) {
      // A mismatch does NOT mean stale. Clicking another Composer widget queues
      // the pick BEFORE the editor swaps the panel over to it, so for a few
      // passes `currentId` is still the widget being left. Dropping the pick on
      // that first mismatch is exactly what made picking in another section
      // take a second click — so wait for the swap, and only give up if it
      // never comes.
      if (pending.elementId && currentId && pending.elementId !== currentId) {
        pending.waits = (pending.waits || 0) + 1;
        if (pending.waits > 16) pendingCrossWidgetPathRef.current = null;
        else scheduleReanchorWait();
      } else if (!idJustChanged) {
        pending.waits = 0;
        pending.attempts = (pending.attempts || 0) + 1;
        // Exact hit only, until the tree has demonstrably settled.
        //
        // `layerEntries` lags a widget switch by more than the one render
        // `idJustChanged` covers — it comes from useWidgetSetting('raw_html'),
        // which catches up in its OWN effect. Walking up to an ancestor while
        // the PREVIOUS widget's tree is still in hand is not a near miss: two
        // sections of similar markup share plenty of shallow paths, so the walk
        // reliably found a bogus parent, consumed the pick, and anchored the
        // panel to an unrelated element — which is exactly what made picking
        // look like it needed a second click. So take an exact path or wait;
        // only once waiting has clearly failed does the ancestor fallback (for
        // a genuine live-DOM vs raw_html divergence) come into play.
        let match = layerEntries.find((e) => e.path === pending.path) || null;
        let exact = !!match;
        if (!match && pending.attempts > 8) {
          let p = pending.path;
          while (p) {
            const idx = p.lastIndexOf('.');
            if (idx === -1) break;
            p = p.slice(0, idx);
            match = layerEntries.find((e) => e.path === p);
            if (match) break;
          }
        }
        if (match) {
          window.console && console.log('[UiChemy] pick ->', match.path,
            exact ? '(exact)' : '(ancestor fallback after ' + pending.attempts + ' tries)');
          pendingCrossWidgetPathRef.current = null;
          // The pointerdown that carried this pick also ran the click-away
          // deselect; landing on the picked element supersedes it.
          deselectedRef.current = false;
          setSelectedLayerId(match.id);
          return;
        }
        // No match YET. Keep the pick queued rather than burning it here.
        //
        // `idJustChanged` only buys one render of grace, and a switch can take
        // more than one: the pointerdown that selects a new section also fires
        // the click-away deselect, whose setSelectedLayerId(null) forces an
        // extra pass through this effect (selectedLayerId is a dependency)
        // while `layerEntries` still holds the PREVIOUS section's tree. Clearing
        // the pick on that pass matched it against the wrong tree, found
        // nothing, and dropped it — which is why selecting an element in another
        // section took a second click. Retrying until the section's own tree
        // arrives makes this independent of how many render passes a switch
        // happens to take.
        // A path that never resolves (raw_html and the live DOM genuinely
        // disagree) must not linger and hijack a later selection. Waiting runs
        // on the real timer, not a microtask — a microtask loop burns the whole
        // budget inside a single frame, long before the tree can arrive.
        if (pending.attempts > 12) pendingCrossWidgetPathRef.current = null;
        else scheduleReanchorWait();
      } else {
        // Mid-transition grace pass — leave it queued, and make sure a further
        // pass actually happens, since nothing else is guaranteed to change.
        scheduleReanchorRetry();
      }
    }
    // A pick is still queued for this section — don't anchor to its first layer,
    // or the panel visibly lands on the wrong element for a frame before the
    // pick resolves.
    if (pendingCrossWidgetPathRef.current) return;
    const stillThere = layerEntries.some((e) => e.id === selectedLayerId);
    if (!stillThere && !(deselectedRef.current && selectedLayerId === null)) {
      setSelectedLayerId(layerEntries[0].id);
    }
  }, [layerEntries, selectedLayerId, active, pendingNudge, scheduleReanchorRetry, scheduleReanchorWait]);

  // Remember the Editor tab's selection across a trip to another tab (e.g.
  // Chat) and restore it on return, so the user doesn't have to re-pick the
  // element they were working on. While away, the visible selection is cleared
  // (so no outline lingers on the canvas) but the last-picked id is stashed and
  // re-applied the moment the Editor tab comes back.
  const lastEditorSelectionRef = React.useRef(null);
  React.useEffect(() => {
    if (tab !== 'direct') {
      lastEditorSelectionRef.current = selectedIdRef.current;
      setSelectedLayerId(null);
    } else if (lastEditorSelectionRef.current !== null) {
      setSelectedLayerId(lastEditorSelectionRef.current);
    }
  }, [tab]);

  // Click-away deselect: a pointerdown on the canvas (empty space or another
  // widget) clears the element selection so its outline disappears. Skipped
  // while (re-)picking, which owns that click. In the Elementor editor a click
  // on editor chrome (top bar, the Publish button, panels) must NOT deselect —
  // selectable elements live inside the preview iframe, so only clicks that
  // originate there count as click-away. This keeps the current element
  // selected when you click Publish (otherwise the save re-render loses it).
  React.useEffect(() => {
    if (!hasWidget) return undefined;
    const COMPOSER_UI = '#uichemy-composer-floating-panel, .uichemy-composer-floating-panel, .uich-composer-host, .uich-portal-root, .uichemy-fab, .uich-canvas-toolbar-host, .uich-box-handles, #uich-box-handles, .annotate-bar, .media-modal, .media-modal-backdrop';
    const onDown = (e) => {
      if (pickingRef.current) return;             // (re-)picking owns this click
      const t = e.target;
      if (t && t.closest && t.closest(COMPOSER_UI)) return; // inside composer UI
      // Editor only: selectable elements live inside the preview iframe, so a
      // legitimate click-away originates INSIDE that iframe's document. A
      // pointerdown anywhere else (top bar, Publish button, panels) is editor
      // chrome and must NOT clear the selection. (No preview iframe on the front
      // end — the page is the top document — so this guard is editor-only.)
      if (!isFrontend) {
        let canvasDoc = null;
        try {
          const topDoc = (window.top && window.top.document) || document;
          const frame = topDoc.getElementById('elementor-preview-iframe');
          canvasDoc = frame && frame.contentDocument;
        } catch (_) { canvasDoc = null; }
        if (!t || t.ownerDocument !== canvasDoc) return; // chrome / unknown → keep selection
        // A click inside a Composer widget used to resolve to a layer path and
        // select that element even with the picker OFF, so clicking a widget in
        // Elementor silently selected an element and raised the canvas toolbar
        // over it. Element selection is now the PICKER's job and only the
        // picker's: nothing here selects, and this click falls through to the
        // deselect below like any other canvas click. Elementor still brings the
        // widget itself into the panel — that is its own selection, untouched.
      }
      if (selectedIdRef.current !== null) {
        deselectedRef.current = true;
        setSelectedLayerId(null);
      }
    };
    const docs = [document];
    try {
      document.querySelectorAll('iframe').forEach((f) => {
        let d = null; try { d = f.contentDocument; } catch (_) { }
        if (d) docs.push(d);
      });
    } catch (_) { /* noop */ }
    docs.forEach((d) => { try { d.addEventListener('mousedown', onDown, true); } catch (_) { } });
    return () => docs.forEach((d) => { try { d.removeEventListener('mousedown', onDown, true); } catch (_) { } });
  }, [hasWidget, isFrontend]);

  // Arming the element picker is MANUAL — the toolbar button, never automatic.
  // This effect only ever turns picking OFF, so it cannot carry silently into
  // somewhere it has no meaning:
  //  • Elementor editor: off on ANY active-widget/tab change.
  //  • Front end: off only when leaving the Editor tab. It deliberately does NOT
  //    disarm on a missing `active.model`: a front-end pick loads the widget over
  //    REST, so the model is briefly absent MID-PICK, and disarming there was
  //    exactly what un-lit the button the moment an element was picked. Nothing
  //    needs the flag forced off anyway — usePickMode already no-ops without a
  //    model, so an armed picker with no widget just does nothing until one
  //    arrives, and the pick that is in flight survives.
  //  • Opening the panel loads a widget too, but that transition shouldn't
  //    touch picking either way — suppressAutoArmRef guards that one
  //    active-change (see onTogglePanel).
  React.useEffect(() => {
    if (suppressAutoArmRef.current) { suppressAutoArmRef.current = false; return; }
    if (!isFrontend) { setPicking(false); return; }
    if (tab === 'chat') setPicking(false);
  }, [active?.model, tab, isFrontend]);

  // Code tab is Developer-only. If the user is on it and switches to Design
  // (Simple) mode, the Code tab button is hidden — fall back to the Editor tab
  // so the panel body always matches an available tab.
  React.useEffect(() => { if (mode === 'simple' && tab === 'code') setTab('direct'); }, [mode, tab]);

  const selectedEntry = React.useMemo(
    () => layerEntries.find((e) => e.id === selectedLayerId) || null,
    [layerEntries, selectedLayerId]
  );

  // Push a snapshot of the Editor tab's current selection (tag/selector/path
  // + exact outerHTML of just that element) to the server whenever it
  // changes, debounced. Backs the grab / update_code
  // MCP tools (class-uichemy-composer-mcp-server.php) — those tools have no live
  // connection to this browser tab, so they read whatever was last picked here.
  React.useEffect(() => {
    if (tab !== 'direct' || !selectedEntry || !active?.model || typeof active.model.get !== 'function') return undefined;
    const widgetId = active.model.get('id');
    if (!widgetId) return undefined;
    const postId = isFrontend
      ? (frontendState.postId || (window.uichUiChemyFrontend && window.uichUiChemyFrontend.postId) || 0)
      : (window.elementor?.config?.document?.id ? parseInt(window.elementor.config.document.id, 10) : 0);
    if (!postId) return undefined;
    const html = getLayerOuterHtml(rawHtml, selectedEntry.path);
    if (!html) return undefined;
    // Mirrors composer-pick.jsx's (unexported) getChatPickSelector — a short,
    // human-meaningful selector, not a strict CSS-unique one; update_code
    // locates the element by exact HTML match, not by this selector.
    const cls = (selectedEntry.classes || []).find(
      (c) => c && !c.startsWith('uich') && !c.startsWith('elementor') && !c.startsWith('e-') && !c.startsWith('swiper-')
    );
    const selector = cls ? `${selectedEntry.tag}.${cls}` : (selectedEntry.tag || '');

    const timer = setTimeout(() => {
      const base = getRestApiBaseUrl();
      const nonce = getRestNonce();
      const headers = { 'Content-Type': 'application/json' };
      if (nonce) headers['X-WP-Nonce'] = nonce;
      fetch(`${base}/uichemy/v1/selected-element`, {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ post_id: postId, widget_id: widgetId, tag: selectedEntry.tag, selector, path: selectedEntry.path, html }),
      }).catch(() => { /* best-effort — an MCP tool call will just report "nothing selected" */ });
    }, 400);
    return () => clearTimeout(timer);
  }, [tab, selectedEntry, active, rawHtml, isFrontend]);

  // Keep the latest layer entries in a ref so the pick callbacks below can
  // stay referentially stable — otherwise usePickMode's effect (which lists
  // onPicked/onContextPick in its deps) would tear down and re-run on every
  // render / layerEntries change, wiping the hover highlight whenever the
  // pointer sits still.
  const layerEntriesRef = React.useRef(layerEntries);
  layerEntriesRef.current = layerEntries;

  // Walk a picked path upward until it hits a parsed layer entry — handles
  // clicks landing inside elements the parser intentionally skips
  // (e.g. <svg> internals, <script>, <style>). Reads the ref so the callbacks
  // that use it can stay stable.
  const resolveEntryForPath = React.useCallback((path, classChain) => {
    const entries = layerEntriesRef.current;
    const byPath = (pp) => entries.find((e) => e.path === pp) || null;

    // 0) Inside a <uichemy-*> tag (nav-menu, TOC, …) index paths are
    //    untrustworthy: PHP inserts wrapper levels raw_html never had (the
    //    nav-menu's own <ul>), shifting every index below the tag — a live
    //    path there can collide EXACTLY with a DIFFERENT authored element's
    //    path (clicking a top-level menu item used to land on the dropdown
    //    template, so the edit styled the wrong class and "did nothing").
    //    Class identity survives the server's rewrites, so when the pick
    //    carries the clicked node's ancestor class chain, resolve by that:
    //    the deepest classed ancestor that IS an authored element inside the
    //    tag's subtree is the element the user picked.
    if (classChain && classChain.length) {
      const dynTag = entries.find((e) => /^uichemy-/.test(e.tag || '')
        && (path === e.path || path.indexOf(e.path + '.') === 0));
      if (dynTag) {
        for (const classes of classChain) { // deepest first
          const hit = entries.find((e) => e.path.indexOf(dynTag.path + '.') === 0
            && (e.classes || []).some((c) => classes.includes(c)));
          if (hit) return hit;
        }
        // No classed ancestor matches an authored element (e.g. the injected
        // <ul> itself, or a bare <a>) — the tag is the nearest real thing.
        return dynTag;
      }
    }

    // 1) Exact path, then trim trailing segments (clicks landing inside nodes the
    //    parser skips — <svg> internals, <script>, etc.).
    let p = path;
    let match = null;
    while (p) {
      match = byPath(p);
      if (match) break;
      const idx = p.lastIndexOf('.');
      if (idx === -1) break;
      p = p.slice(0, idx);
    }
    if (!match) return null;

    // 2) Loop remap. If the exact path only resolved to a shorter ANCESTOR, the
    //    extra depth is a loop that renders one authored template as many
    //    nodes — either a {% for %} block, or (via detectEntryDynamic in
    //    composer-layer-tree.jsx) a <uichemy-nav-menu>/<uichemy-toc>-style
    //    `for="x in y"` attribute template — so the clicked card's/item's
    //    index doesn't exist in the source tree. Map the click onto the
    //    loop's single template node (the parser tags loop descendants with
    //    dyn.loop) so clicking ANY rendered card or menu item selects the
    //    template element (title / image / menu link / …), never a whole
    //    ancestor it doesn't correspond to. Static layouts resolve exactly
    //    above and never reach this branch — no behaviour change there.
    if (p !== path) {
      const prefixSegs = p.split('.');
      const fullSegs = path.split('.');
      if (fullSegs.length > prefixSegs.length) {
        const tail = fullSegs.slice(prefixSegs.length + 1); // structure inside one card
        // Direct children of the resolved container that live inside a loop.
        const templates = entries.filter((e) => {
          if (!e.dyn || !e.dyn.loop) return false;
          const segs = e.path.split('.');
          return segs.length === prefixSegs.length + 1 && e.path.indexOf(p + '.') === 0;
        });
        for (const t of templates) {
          const remapped = tail.length ? t.path + '.' + tail.join('.') : t.path;
          const hit = byPath(remapped);
          if (hit) return hit;
        }
        // Deeper structure didn't line up — at least select the template node
        // itself (its container) rather than the whole loop wrapper.
        if (templates.length) return templates[0];
      }
    }
    return match;
  }, []);

  // ── Dynamic constructs (data binding / loop / condition / form) ───────────
  // Contextual tab type, driven by the selected layer's dynamic markers.
  const constructType = React.useMemo(() => {
    const d = selectedEntry && selectedEntry.dyn;
    if (!d) return null;
    if (d.form) return 'form';
    // A <uichemy-*> attribute template (`for="x in y"` on a nav-menu/TOC item)
    // is looped by the tag's own PHP renderer — the Twig Loop accordion's
    // Remove Loop / Loop builder / query controls don't apply to it (removeLoop
    // only understands {% %} text and would no-op or corrupt). dyn.loop is
    // still set so the move-grip stays off the template; just no accordion.
    if (d.attrTemplate) return null;
    if (d.loop) return 'loop';
    // Condition ({% if %}) and Data ({{ }}) authoring panels are intentionally
    // not surfaced — the Twig engine still renders both; text/value bindings are
    // edited via the inline chip in the Content section, not a separate panel.
    return null;
  }, [selectedEntry]);

  // The construct's options (Loop / Form / Condition / Data) no longer live in a
  // dedicated tab — they render as a collapsible accordion at the bottom of the
  // Editor tab (see ConstructAccordion below). Marking a layer just switches to
  // the Editor tab so that accordion is visible.

  // Mark the element at `path` as a loop / condition / form.
  const markPathAsConstruct = React.useCallback((type, path, id) => {
    const fn = type === 'loop' ? markAsLoop : markAsForm;
    const html = fn(rawHtmlRef.current, path);
    if (html != null) { writeHtml(html, id); setTab('direct'); }
  }, [writeHtml]);

  // "Mark as …" from the Layers Pick dropdown — acts on the current selection.
  const onMarkConstruct = React.useCallback((type) => {
    if (!selectedEntry) return;
    markPathAsConstruct(type, selectedEntry.path, selectedLayerId);
  }, [selectedEntry, selectedLayerId, markPathAsConstruct]);

  // "Mark as …" from a layer's context menu — acts on that specific layer.
  const onMarkLayer = React.useCallback((id, type) => {
    const entry = layerEntries.find((e) => e.id === id);
    if (!entry) return;
    setSelectedLayerId(id);
    markPathAsConstruct(type, entry.path, id);
  }, [layerEntries, markPathAsConstruct]);

  // Remove a construct from a node: loops/conditions unwrapped, data cleared,
  // the form's data-atom-* tagging stripped.
  const onRemoveDyn = React.useCallback((node, kind) => {
    if (!node || !node.dyn) return;
    const html = rawHtmlRef.current;
    let next = null;
    if (kind === 'loop') next = removeLoop(html, node.dyn.loop);
    else if (kind === 'form') next = removeForm(html, node.path);
    if (next != null) writeHtml(next, node.id);
  }, [writeHtml]);

  const onRemoveCurrentConstruct = React.useCallback((kind) => {
    if (!selectedEntry) return;
    onRemoveDyn({ ...selectedEntry, id: selectedLayerId }, kind);
  }, [selectedEntry, selectedLayerId, onRemoveDyn]);

  // "Pick loop / condition / form" (nothing selected) — enter pick mode; the
  // next picked element is auto-marked. Intent lives in a ref so onPicked reads it fresh.
  const pickIntentRef = React.useRef(null);

  // Stable pick handler: resolve the entry, select it, and auto-mark it if the
  // user entered pick mode via "Pick loop / condition / form".
  const handlePicked = React.useCallback((path, classChain) => {
    const match = resolveEntryForPath(path, classChain);
    if (!match) return;
    deselectedRef.current = false; // an explicit pick re-enables normal selection
    setSelectedLayerId(match.id);
    if (pickIntentRef.current) {
      const type = pickIntentRef.current;
      pickIntentRef.current = null;
      setPicking(false);
      markPathAsConstruct(type, match.path, match.id);
    }
  }, [resolveEntryForPath, markPathAsConstruct]);

  // Stable right-click handler: open the preview context menu on the picked layer.
  const handleContextPick = React.useCallback((path, x, y, classChain) => {
    const match = resolveEntryForPath(path, classChain);
    if (!match) return;
    setSelectedLayerId(match.id);
    setPreviewMenu({ id: match.id, x, y });
  }, [resolveEntryForPath]);

  const onPickConstruct = React.useCallback((type) => {
    pickIntentRef.current = type;
    setPicking(true);
  }, []);

  // Front-end only: usePickMode calls this when the user clicks a DIFFERENT
  // Composer widget/section while picking is still scoped to the one currently
  // loaded. Hand off to the frontend bridge's own widget-selection so the
  // panel loads the new widget and selects the exact clicked element once its
  // layer tree is ready (see stashPendingPickPath / the re-anchor effect
  // above). Without this the picker gets stuck on the first widget: clicking
  // another section does nothing. Picking itself is left off after this — the
  // user presses the FAB again to pick something else.
  const onSwitchWidget = React.useCallback((widgetNode, clickedNode) => {
    try {
      // The new widget is already rendered live on the page, so the exact
      // clicked element's path can be resolved right now, before the async
      // fetch that loads its raw_html into the composer.
      const container = widgetNode && widgetNode.querySelector
        ? widgetNode.querySelector('.elementor-widget-container')
        : null;
      const widgetElementId = widgetNode && widgetNode.closest
        ? (widgetNode.closest('[data-id]') && widgetNode.closest('[data-id]').getAttribute('data-id'))
        : null;
      stashPendingPickPath(container, clickedNode, widgetElementId);
      if (window.UiChemyFrontend && typeof window.UiChemyFrontend.selectNode === 'function') {
        window.UiChemyFrontend.selectNode(widgetNode);
      }
    } catch (_) { /* noop */ }
  }, [stashPendingPickPath]);

  usePickMode({
    picking,
    setPicking,
    model: active?.model,
    onPicked: handlePicked,
    onContextPick: handleContextPick,
    onSwitchWidget: isFrontend ? onSwitchWidget : undefined,
  });

  // Close the preview context menu on any outside click / Escape.
  React.useEffect(() => {
    if (!previewMenu) return undefined;
    const close = () => setPreviewMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setPreviewMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [previewMenu]);

  // Inject a mount node into Gutenberg's settings-sidebar header (the Page/Block
  // + ✕ row), just left of the close button, and keep it re-attached across the
  // sidebar's own re-renders. We portal the Layers toggle into it below. The node
  // carries `.uich-tw` so the button's utilities/tokens still resolve out here,
  // outside the composer host. Gutenberg (inspector) surface only.
  React.useEffect(() => {
    if (!isInspector || typeof document === 'undefined') return undefined;

    const slot = document.createElement('span');
    slot.className = 'uich-tw uich-gb-header-slot';

    const findSpot = () => {
      const host = document.getElementById('uichemy-composer-inspector-host');
      const area = (host && host.closest('.interface-complementary-area'))
        || document.querySelector('.interface-complementary-area');
      if (!area) return null;
      // Preferred: immediately before the sidebar's close (✕) button.
      const closeBtn = area.querySelector('button[aria-label*="close" i]');
      if (closeBtn && closeBtn.parentElement) return { parent: closeBtn.parentElement, before: closeBtn };
      // Fallback: at the end of the Page/Block tablist's row.
      const tabs = area.querySelector('[role="tablist"]');
      if (tabs && tabs.parentElement) return { parent: tabs.parentElement, before: null };
      return null;
    };

    const attach = () => {
      if (slot.isConnected) return;
      const spot = findSpot();
      if (!spot) return;
      if (spot.before) {
        spot.parent.insertBefore(slot, spot.before);
        // WP pushes the close (✕) button right with its own auto margin, leaving
        // a gap between it and our right-aligned slot. Zero it so the two hug.
        try { spot.before.style.marginLeft = '0'; } catch (_) { /* noop */ }
      } else {
        spot.parent.appendChild(slot);
      }
      setHeaderSlot(slot);
    };

    attach();
    const obs = new MutationObserver(() => { if (!slot.isConnected) attach(); });
    obs.observe(document.body, { childList: true, subtree: true });

    return () => {
      obs.disconnect();
      setHeaderSlot(null);
      if (slot.parentNode) slot.parentNode.removeChild(slot);
    };
  }, [isInspector]);

  // The header slot lives outside the composer host, so mirror the live theme /
  // skin onto it — otherwise the portaled button reads the wrong palette.
  React.useEffect(() => {
    if (!headerSlot) return;
    headerSlot.classList.toggle('dark', theme === 'dark');
    headerSlot.classList.toggle('skin-gutenberg', skin === 'gutenberg');
    headerSlot.classList.toggle('skin-elementor', skin === 'elementor');
    if (skin === 'gutenberg' || skin === 'elementor') headerSlot.dataset.uichComposerSkin = skin;
    else delete headerSlot.dataset.uichComposerSkin;
  }, [headerSlot, theme, skin]);

  // The persistent selection outline belongs to the tabs that act on the
  // current selection — Editor and Code. Chat has its own pick highlighting,
  // so on that tab we pass a null path and the decorator's cleanup clears the
  // outline; it is re-applied automatically when the user returns to Editor or
  // Code. (Not gated on panel collapse, so the outline survives collapsing.)
  // Canvas grip drag → the SAME write the Layers tree performs, so a move made
  // on the canvas and one made in the tree cannot produce different markup.
  //
  // Paths come from the live DOM but the write addresses the parsed raw_html
  // tree; where the two have drifted (dynamic content, a stray wrapper in the
  // saved markup) a path can resolve to a different node in each. Refuse the
  // move in that case — silently reordering the wrong element is far worse than
  // a drag that does nothing.
  const onMoveElementByPath = React.useCallback((dragPath, dropPath, placement) => {
    const dragEntry = layerEntries.find((e) => e.path === dragPath);
    const dropEntry = layerEntries.find((e) => e.path === dropPath);
    if (!dragEntry || !dropEntry) return;
    onMoveLayer(dragEntry.id, dropEntry.id, placement);
  }, [layerEntries, onMoveLayer]);

  // A chat pick selects the element in the panel too, so the Chat tab gets the
  // same on-canvas typography bar the Editor tab has. `chatPicked` is what the
  // decorator is gated on over there: Chat's picker disarms itself the instant
  // one element is picked (`setPicking(false)` inside its commit), so gating on
  // an "is the picker armed" flag the way the Editor tab does would flash the
  // bar up and immediately drop it again.
  const [chatPicked, setChatPicked] = React.useState(false);
  // (The listener that feeds this, and the reset, sit further down — they read
  // `chatPickOwnsCanvas`, which is declared with the panel state below. Called
  // from up here they would hit its temporal dead zone on every render.)
  const handleChatPickPath = React.useCallback((path) => {
    const match = resolveEntryForPath(path);
    if (!match) return;
    deselectedRef.current = false; // an explicit pick re-enables normal selection
    setSelectedLayerId(match.id);
    setChatPicked(true);
  }, [resolveEntryForPath]);
  // Every canvas decoration is pick mode's: the selection outline, the
  // padding/gap bands and the floating toolbar all appear only while the picker
  // is armed. Off, the canvas is a plain preview with nothing of ours drawn on
  // it — a selection made earlier stays selected in the panel, it just stops
  // being outlined out there. (The hover highlight needed nothing: usePickMode
  // already bails when the picker is off.)
  //
  // Gated in ONE place, `selectedPath`, so the whole decorator goes quiet
  // together and there is no second switch to keep in step.
  useSelectionDecorator({
    model: active?.model,
    // Still gated in ONE place, now with a per-tab notion of "armed": the Editor
    // tab draws while its picker is armed, the Chat tab draws once a chat pick
    // has landed (see chatPicked above).
    selectedPath: ((tab === 'chat' ? chatPicked : picking)
      ? (selectedEntry?.path || null)
      : null),
    // See resolveByClassFallback in composer-pick.jsx: a loop/condition
    // template's path (e.g. the nav-menu <li>) can land one level off in the
    // live DOM when the server wraps its repeats in markup raw_html never
    // authored (nav-menu's own <ul>). The class fingerprint corrects that.
    selectedClasses: selectedEntry?.classes || null,
    // Free to stay up whenever the decorator runs: the picker recognises our own
    // canvas chrome by id and no longer counts a click on the bar as a pick (see
    // OUR_CHROME_SEL in composer-pick.jsx), which is what forced it to hide.
    toolbar: true,
    // The GRIP alone goes unavailable on a loop template, where reordering one
    // repeat rewrites every repeat — the typography controls stay usable there.
    movable: !selectedEntry?.dyn?.loop,
    onMoveElement: onMoveElementByPath,
  });

  // (The active-widget outline is drawn further down — it needs `feEngaged` to
  // know whether the front-end editor was ever actually opened.)

  // Inspector state — seeded from the widget's real CSS + the selected
  // element's inline `style` attr, so Typography/Layout/Spacing/etc tabs
  // display the existing values. Inspector edits are still local-only for
  // now; the CSS write-back lands in the next slice.
  const lastWroteRef = React.useRef({ rawHtml: null, rawCss: null });
  const [cssParseTick, setCssParseTick] = React.useState(0);
  const cssForParse = React.useMemo(
    () => (rawCss !== undefined && rawCss !== null) ? rawCss : (rawCssRef.current || ''),
    [rawCss, cssParseTick],
  );
  const baseParsedScopes = React.useMemo(
    () => parseCssToScopes(cssForParse, { mediaQuery: '' }),
    [cssForParse],
  );
  const parsedScopesByBpKey = React.useMemo(() => {
    const out = { '': baseParsedScopes, desktop: baseParsedScopes };
    (breakpoints || []).forEach((bp) => {
      if (!bp?.key || bp.key === 'desktop' || !bp.value) return;
      const mq = getMediaTextForElementorBreakpointKey(bp.key);
      if (mq) out[bp.key] = parseCssToScopes(cssForParse, { mediaQuery: mq });
    });
    return out;
  }, [cssForParse, breakpoints, baseParsedScopes]);
  const parsedScopes = React.useMemo(
    () => {
      const current = (!device || device === 'desktop')
        ? baseParsedScopes
        : (parsedScopesByBpKey[device] || {});

      // Compound (`compound:…`) and tag (`tag:…`) scopes from OTHER breakpoints
      // would normally vanish from `scopes` when the user switches devices
      // because the seed only pulls from `current`. Merge them across all
      // breakpoints so their chips stay visible and editable at every device,
      // with breakpoint ownership (`__bpOwn`) correctly tracked so the Inspector
      // cascade shows the right values and writes to the right @media block.
      const out = { ...current };
      Object.values(parsedScopesByBpKey).forEach((bpScopes) => {
        if (!bpScopes) return;
        Object.keys(bpScopes).forEach((k) => {
          if (!k.startsWith('compound:') && !k.startsWith('tag:')) return;
          if (!out[k]) {
            out[k] = bpScopes[k];
          } else {
            out[k] = {
              ...out[k],
              __bpOwn: { ...(bpScopes[k].__bpOwn || {}), ...(out[k].__bpOwn || {}) },
              __compound: out[k].__compound || bpScopes[k].__compound,
            };
          }
        });
      });
      return out;
    },
    [device, baseParsedScopes, parsedScopesByBpKey],
  );
  const localScope = React.useMemo(
    () => parseInlineStyleToScope(selectedEntry?.attrs?.style || ''),
    [selectedEntry?.attrs?.style, selectedEntry?.id],
  );
  const elementClasses = React.useMemo(() => {
    if (!selectedEntry) return [];
    const cls = selectedEntry.attrs && selectedEntry.attrs.class;
    return cls ? String(cls).trim().split(/\s+/).filter(Boolean) : [];
  }, [selectedEntry]);

  const parsedSeedScopes = React.useMemo(
    () => ({ local: localScope, ...parsedScopes }),
    [localScope, parsedScopes],
  );
  const uichemyGlobalClasses = useGlobalClasses();
  // Unified Globals Manager classes (the ones users create today via the
  // Globals panel) — normalize their { selector, body } shape to the
  // { id, css } shape hydrateGlobalClassScopes expects (bare class name, no
  // leading dot). Compound/pseudo selectors (e.g. ".pr-card:hover") aren't
  // seedable as a plain class scope, so only simple single-class selectors
  // are included here.
  const unifiedUiChemyGlobalClasses = useUiChemyGlobalClasses();
  const unifiedGlobalClassesForSeed = React.useMemo(
    () => unifiedUiChemyGlobalClasses
      .map((c) => {
        const m = /^\.([\w-]+)$/.exec(String(c?.selector || '').trim());
        return m ? { id: m[1], css: c.body || '' } : null;
      })
      .filter(Boolean),
    [unifiedUiChemyGlobalClasses],
  );
  const seedScopes = React.useMemo(() => {
    const withLegacy = hydrateGlobalClassScopes(parsedSeedScopes, elementClasses, uichemyGlobalClasses);
    return hydrateGlobalClassScopes(withLegacy, elementClasses, unifiedGlobalClassesForSeed);
  }, [parsedSeedScopes, elementClasses, uichemyGlobalClasses, unifiedGlobalClassesForSeed]);

  const [scopes, setScopesState] = React.useState(seedScopes);
  const [activeScope, setActiveScope] = React.useState('local');
  const prevDeviceRef = React.useRef(device);
  const prevSelectedPathRef = React.useRef(selectedEntry?.path ?? null);
  const prevTabRef = React.useRef(tab);
  // The active-widget id, read off the Backbone model where it actually lives.
  //
  // `active` is the store payload — { panel, model, view, settings } — and has no
  // `id` of its own, so the `active?.id` this used to read was permanently
  // undefined. That silently disabled BOTH the widgetChanged branch below and the
  // effect's own re-run on a switch: picking an element in another section left
  // the inspector seeded from the previous section, so Typography/Colour showed
  // nothing until a second click happened to change some other dependency. It
  // hid best on two sections sharing the same CSS, where `rawCss` doesn't change
  // either and nothing re-triggered the seed at all.
  const activeWidgetId = React.useMemo(
    () => (active && active.model && typeof active.model.get === 'function' ? active.model.get('id') : null),
    [active],
  );
  const prevWidgetIdRef = React.useRef(activeWidgetId || null);

  React.useEffect(() => {
    const deviceChanged = prevDeviceRef.current !== device;
    prevDeviceRef.current = device;
    const ownCss = lastWroteRef.current.rawCss;
    const entryPath = selectedEntry?.path ?? null;
    const entryChanged = entryPath !== prevSelectedPathRef.current;
    prevSelectedPathRef.current = entryPath;

    const widgetChanged = prevWidgetIdRef.current !== (activeWidgetId || null);
    prevWidgetIdRef.current = activeWidgetId || null;

    const tabChanged = prevTabRef.current !== tab;
    prevTabRef.current = tab;
    const forceReseed = tabChanged && tab === 'direct';

    // Guard against re-seeding when the inspector itself wrote raw_css — but
    // always reseed when the selected element changes so inline styles on the
    // newly-selected element are immediately reflected in the Local scope.
    if (!forceReseed && !widgetChanged && !entryChanged && ownCss != null && String(rawCss ?? '') === String(ownCss) && !deviceChanged) {
      return;
    }
    const externalCssReseed = ownCss != null && String(rawCss ?? '') !== String(ownCss);
    // Merge fresh parsed scopes with UI-meta (__units, __shown, __globals).
    // Skip entirely while raw_css matches our last inspector write so a
    // globals poll cannot resurrect cleared breakpoint values.
    setScopesState((prev) => {
      if (!prev) return seedScopes;
      const merged = { ...seedScopes };
      for (const key of Object.keys(merged)) {
        const seedScope = merged[key];
        const prevScope = prev[key];
        if (!seedScope || !prevScope) continue;
        if (deviceChanged && key !== 'local') {
          merged[key] = pruneScopeDataToBreakpointOwnership(
            {
              ...seedScope,
              __shown: prevScope.__shown || seedScope.__shown || {},
            },
            activeMediaQuery,
          );
          continue;
        }
        if ((externalCssReseed || forceReseed) && key !== 'local') {
          merged[key] = {
            ...seedScope,
            __shown: prevScope.__shown || seedScope.__shown || {},
          };
          continue;
        }
        if (key === 'local') {
          merged[key] = {
            ...seedScope,
            customCss: stableCustomCssOrder(prevScope.customCss, seedScope.customCss),
            __bpOwn: seedScope.__bpOwn || {},
            __units: { ...(prevScope.__units || {}), ...(seedScope.__units || {}) },
            __shown: prevScope.__shown || seedScope.__shown || {},
            __globals: (entryChanged || widgetChanged)
              ? (seedScope.__globals || {})
              : (prevScope.__globals || seedScope.__globals || {}),
          };
          continue;
        }
        const seedUnits = seedScope.__units || {};
        const prevUnits = prevScope.__units || {};
        const mergedUnits = { ...seedUnits };
        Object.keys(prevUnits).forEach((unitKey) => {
          if (seedUnits[unitKey] != null && seedUnits[unitKey] !== '') return;
          if (prevUnits[unitKey] != null && prevUnits[unitKey] !== '') {
            mergedUnits[unitKey] = prevUnits[unitKey];
          }
        });
        merged[key] = {
          ...seedScope,
          customCss: stableCustomCssOrder(prevScope.customCss, seedScope.customCss),
          __bpOwn: seedScope.__bpOwn || {},
          __units: mergedUnits,
          __shown: prevScope.__shown || seedScope.__shown || {},
          __globals: prevScope.__globals || seedScope.__globals || {},
        };
      }
      // Preserve scopes from prev that have __shown items but aren't in seedScopes.
      // Only when staying on the same element — on element/widget switch these scopes
      // belong to the old element and must not bleed into the new element's inspector.
      if (!entryChanged && !widgetChanged) {
        for (const key of Object.keys(prev || {})) {
          if (merged[key]) continue;
          const prevScope = prev[key];
          if (!prevScope || !prevScope.__shown) continue;
          const hasShownItems = Object.keys(prevScope.__shown).some(
            (g) => Array.isArray(prevScope.__shown[g]) && prevScope.__shown[g].length > 0
          );
          if (hasShownItems) merged[key] = prevScope;
        }
      }
      return merged;
    });
  }, [parsedSeedScopes, seedScopes, device, rawCss, activeMediaQuery, tab, activeWidgetId]);

  // ── Typography on a server-generated item ──────────────────────────────────
  // A <uichemy-nav-menu>/<uichemy-toc> template item (`<li for="…">{nav_item}`)
  // holds NO text of its own: PHP swaps the `{nav_item}` token for the rendered
  // markup, and for a nav menu that markup is an `<a>`. So the text the user
  // sees inside that <li> is always in a child that does not exist in raw_html
  // and therefore can never be selected and styled on its own.
  //
  // That made every typography edit on a menu item look broken. The write
  // itself was fine — `.hdr__nav-item { font-size: 55px }` landed in raw_css —
  // but the widget's own stylesheet pins the anchor with a MORE SPECIFIC rule
  // (`.uichemy-header-1 .hdr__nav-item > a { font-size: 14px }`, 0-2-1 against
  // 0-1-0), so the visible text never moved and there was no anchor layer to
  // fix it on.
  //
  // Since that <li>'s only text IS the generated link, text properties set on
  // it are unambiguously meant for that link — so mirror them onto it.
  //
  // The class is DOUBLED (`.x.x > a`) purely for cascade position: after PHP
  // scopes both rules to `.elementor-element-<id> …`, the mirror lands at
  // 0-3-1, exactly tying the widget's own `… .hdr__nav-item > a`. A tie is the
  // goal, not an accident — it resolves on document order, and edits are
  // appended after the base rules, so the user's value wins, while genuinely
  // higher-specificity rules (`… .hdr__nav-item:hover > a`, 0-4-1) still win
  // over it and hover keeps working. Bumping specificity further would have
  // silently killed those hover states.
  const mirrorTextStylesToGeneratedChild = React.useCallback(
    (css, scopeKey, updates, mediaQuery) => {
      const entry = selectedEntry;
      if (!entry || !isDynamicPlaceholderText(entry.directText)) return css;
      // Only mirror for the class actually on the picked element — a scope the
      // user switched to by hand may belong to something else entirely.
      if (!(entry.classes || []).includes(scopeKey)) return css;
      const textUpdates = {};
      Object.keys(updates).forEach((prop) => {
        if (GENERATED_TEXT_MIRROR_PROPS.has(prop)) textUpdates[prop] = updates[prop];
      });
      if (!Object.keys(textUpdates).length) return css;
      return upsertClassStyleUpdatesInBreakpoint(
        css,
        `compound:.${scopeKey}.${scopeKey} > a`,
        textUpdates,
        mediaQuery,
      );
    },
    [selectedEntry],
  );

  // Wrapped setter — every Inspector edit flows through here, gets diffed
  // against the previous scopes object, and projects the change back to
  // raw_css (for class scopes) or raw_html's inline `style` attr (for the
  // Local scope). The loop guard is the lastWroteRef snapshot above.
  const setScopes = React.useCallback((nextOrFn) => {
    setScopesState((prev) => {
      const next = typeof nextOrFn === 'function' ? nextOrFn(prev) : nextOrFn;
      if (!next || next === prev) return next;
      if (!hasWidget) return next;

      let workingHtml = rawHtmlRef.current;
      let workingCss = rawCssRef.current;
      let htmlDirty = false;
      let cssDirty = false;

      const DATA_GROUPS = ['typography', 'layout', 'spacing', 'background', 'border', 'effects'];
      // Only the parts that end up in the markup. `hasDataDiff` below also
      // counts UI-meta (__units / __globals / __bpOwn), which is right for
      // deciding whether to re-serialise, but wrong for deciding whether a
      // BLOCKED Local write lost anything: a unit pick with no value attached
      // is meta the panel is entitled to remember.
      const hasWritableDiff = (a, b) => {
        if (!a || !b) return a !== b;
        for (const g of DATA_GROUPS) if (a[g] !== b[g]) return true;
        if (JSON.stringify(a.customCss || []) !== JSON.stringify(b.customCss || [])) return true;
        return false;
      };
      const hasDataDiff = (a, b) => {
        if (!a || !b) return a !== b;
        for (const g of DATA_GROUPS) if (a[g] !== b[g]) return true;
        if (JSON.stringify(a.__units || {}) !== JSON.stringify(b.__units || {})) return true;
        if (JSON.stringify(a.__globals || {}) !== JSON.stringify(b.__globals || {})) return true;
        if (JSON.stringify(a.__bpOwn || {}) !== JSON.stringify(b.__bpOwn || {})) return true;
        if (JSON.stringify(a.customCss || []) !== JSON.stringify(b.customCss || [])) return true;
        return false;
      };

      let localDataTouched = false;
      let localBlocked = false;
      const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
      for (const key of keys) {
        if (prev[key] === next[key]) continue;
        // Skip pure UI-meta changes (__units, __shown, __globals only);
        // they survive in local React state without round-tripping
        // through Backbone / the CSS parser.
        if (!hasDataDiff(prev[key], next[key])) continue;

        if (key === 'local') {
          if (hasDataDiff(prev[key], next[key])) localDataTouched = true;
          try {
            if (typeof window !== 'undefined' && window.UICH_DEBUG_BRICKS_SAVE) {
              // eslint-disable-next-line no-console
              console.log('[UiChemy bricks-save] setScopes local-branch',
                'selectedEntry=', !!selectedEntry, 'path=', selectedEntry && selectedEntry.path,
                'device=', device, 'builder=', active && active.model && (active.model.__uichBricks ? 'bricks' : (active.model.__uichGutenberg ? 'gutenberg' : 'elementor')));
            }
          } catch (_) { /* noop */ }
          if (!selectedEntry) continue;
          // Inline styles have no @media scope, so writing one on tablet/mobile
          // would silently overwrite the desktop value — the write stays blocked.
          //
          // What must NOT happen is keeping the value in state anyway. Local is
          // read back from the element's live inline `style`
          // (Inspector's `scopesForRead`), never from `scopes.local`, so a value
          // parked there is invisible to every field: each one showed what you
          // typed while it had focus, then re-read the unchanged inline style on
          // blur and went blank. That was every input in the Editor tab, on
          // every breakpoint but Desktop. `localBlocked` drops the value here so
          // state and markup can't drift; responsive Local edits are routed to a
          // per-element class instead, see promoteLocalToBreakpointClass.
          if (device && device !== 'desktop') {
            if (hasWritableDiff(prev[key], next[key])) localBlocked = true;
            continue;
          }
          const styleText = scopeToInlineStyle(next.local || {});
          // Preview it on the live node right away. A container repaint cannot do
          // this for dynamic content, so without it inline-style edits only showed
          // up after a reload.
          try { applyInlineStyleLive(active && active.model, selectedEntry.path, styleText, selectedEntry.classes); }
          catch (_) { /* preview only — the write below is what matters */ }
          const updated = updateInlineStyleForPath(workingHtml, selectedEntry.path, styleText);
          if (updated !== workingHtml) {
            workingHtml = updated;
            htmlDirty = true;
          }
        } else if (isTypographyGlobalScope(key)) {
          const updated = updateRawCssForClass(workingCss, key, '');
          if (updated !== workingCss) {
            workingCss = updated;
            cssDirty = true;
          }
          const updates = diffScopeStyleUpdates(prev[key], next[key], activeMediaQuery);
          if (Object.keys(updates).length) {
            applyTypographyClassToGlobals(key, updates);
          }
        } else if (isUiChemyGlobalClassScope(key)) {
          // UiChemy global class — edits persist into the class registry so
          // every usage site-wide updates (never into this widget's CSS).
          const updates = diffScopeStyleUpdates(prev[key], next[key], activeMediaQuery);
          if (Object.keys(updates).length) {
            applyGlobalClassUpdates(key, updates, activeMediaQuery);
          }
        } else {
          // diff tracks __bpOwn clears (prev owned → next not); reconcile strips
          // declarations still present in raw_css at this breakpoint.
          const diffUpdates = diffScopeStyleUpdates(
            prev[key],
            next[key],
            activeMediaQuery,
          );
          // prev is passed so the sweep can only remove declarations the state
          // actually knew about — see reconcileScopeStyleUpdates.
          const reconcileUpdates = reconcileScopeStyleUpdates(
            workingCss,
            key,
            next[key],
            activeMediaQuery,
            prev[key],
          );
          const updates = { ...reconcileUpdates, ...diffUpdates };
          if (Object.keys(updates).length) {
            const updated = upsertClassStyleUpdatesInBreakpoint(
              workingCss,
              key,
              updates,
              activeMediaQuery,
            );
            if (updated !== workingCss) {
              workingCss = updated;
              cssDirty = true;
            }
            const mirrored = mirrorTextStylesToGeneratedChild(
              workingCss, key, updates, activeMediaQuery,
            );
            if (mirrored !== workingCss) {
              workingCss = mirrored;
              cssDirty = true;
            }
          }
        }
      }

      try {
        if (typeof window !== 'undefined' && window.UICH_DEBUG_BRICKS_SAVE) {
          // eslint-disable-next-line no-console
          console.log('[UiChemy bricks-save] setScopes flush', 'htmlDirty=', htmlDirty, 'cssDirty=', cssDirty);
        }
      } catch (_) { /* noop */ }
      if (htmlDirty) {
        lastWroteRef.current.rawHtml = workingHtml;
        writeHtml(workingHtml);
      }
      if (cssDirty) {
        lastWroteRef.current.rawCss = workingCss;
        rawCssRef.current = workingCss;
        setCssParseTick((t) => t + 1);
        setRawCss(workingCss);
      }
      // Class/CSS edits must not leave stale values in scopes.local — UI reads
      // inline style from raw_html; re-anchor when Local was not edited.
      // Preserve __shown so AddProperty selections survive the re-anchor.
      // A blocked Local write must leave `scopes.local` exactly as it was — see
      // the note in the local branch above.
      if (localBlocked) return { ...next, local: prev.local };
      if (!localDataTouched && selectedEntry) {
        const parsedLocal = parseInlineStyleToScope(selectedEntry.attrs?.style || '');
        const prevShown = (next.local || {}).__shown;
        const prevCustomCss = next.local && next.local.customCss;
        const mergedLocal = {
          ...parsedLocal,
          customCss: stableCustomCssOrder(prevCustomCss, parsedLocal.customCss),
        };
        return {
          ...next,
          local: prevShown ? { ...mergedLocal, __shown: prevShown } : mergedLocal,
        };
      }
      return next;
    });
  }, [hasWidget, selectedEntry, setRawCss, writeHtml, activeMediaQuery, device, mirrorTextStylesToGeneratedChild]);

  // ── Responsive Local edits → a per-element class ───────────────────────────
  // The Local scope lives in the element's inline `style` attribute, and an
  // inline style cannot carry an `@media` block. So on Tablet/Mobile a Local
  // edit has nowhere valid to go: it used to be dropped (see the block in
  // setScopes above), which is what made every field in the Editor tab accept a
  // value and then lose it on blur.
  //
  // Rather than refuse the edit, move the element's Local styling onto a class
  // of its own (`uich-e-N`). A class scope already supports every breakpoint,
  // so the edit lands somewhere it can actually BE responsive and every later
  // edit takes the ordinary class path — no new cascade machinery.
  //
  // Two details make the promotion safe:
  //   • Whatever the element carries inline becomes the class's BASE rule, so
  //     Desktop looks exactly the same afterwards.
  //   • That base rule is appended, so among equal-specificity class rules it
  //     wins — which is what the inline style did before. A HIGHER-specificity
  //     selector the element also matches (e.g. `.card .title`) now outranks
  //     the promoted rule where the inline style used to win; the class is
  //     visible in the scope strip so that case is at least diagnosable.
  //
  // Returns true when the edit was handled here.
  const promoteLocalToBreakpointClass = React.useCallback((group, patch) => {
    if (!hasWidget || !selectedEntry || !patch) return false;
    const html = rawHtmlRef.current || '';

    // Already promoted once — reuse that class instead of stacking a second.
    const existing = String(selectedEntry.attrs?.class || '')
      .trim().split(/\s+/).filter(isElementScopeClassName);
    const className = existing[0] || nextElementScopeClassName(html);

    const inlineScope = parseInlineStyleToScope(selectedEntry.attrs?.style || '');
    const localUnits = { ...((scopes.local || {}).__units || {}), ...(inlineScope.__units || {}) };

    // The pending edit, owned at the ACTIVE breakpoint. Only this breakpoint's
    // declarations go in the in-memory scope: the base values are read back
    // from the parsed raw_css, exactly as they are for any other class.
    let bpScope = { ...emptyProps(), __units: localUnits, __globals: {}, __shown: {} };
    Object.keys(patch).forEach((k) => {
      const val = patch[k];
      const fk = `${group}.${k}`;
      bpScope = { ...bpScope, [group]: { ...(bpScope[group] || {}), [k]: val } };
      bpScope = (val == null || val === '')
        ? clearScopePropOwn(bpScope, fk, activeMediaQuery)
        : markScopePropOwn(bpScope, fk, activeMediaQuery);
    });

    // Nothing to write at this breakpoint (a cleared field, or a property with
    // no CSS mapping) is not a reason to promote — the element would silently
    // gain a class for an edit that changes nothing.
    const bpUpdates = scopeToStyleUpdates(bpScope, activeMediaQuery);
    if (!Object.keys(bpUpdates).length) return false;

    let nextCss = rawCssRef.current || '';
    // Everything currently inline — including declarations with no schema slot,
    // which parse into `customCss` — becomes the class's base rule.
    const baseUpdates = scopeToStyleUpdates({ ...inlineScope, __units: localUnits }, '');
    if (Object.keys(baseUpdates).length) {
      nextCss = upsertClassStyleUpdatesInBreakpoint(nextCss, className, baseUpdates, '');
    }
    nextCss = upsertClassStyleUpdatesInBreakpoint(nextCss, className, bpUpdates, activeMediaQuery);

    const nextHtml = promoteInlineStyleToClassAtPath(html, selectedEntry.path, className);
    if (nextHtml === html && !existing.length) return false;

    // CSS first, then the markup: the class has to exist in raw_css before the
    // element stops carrying its inline style, or it paints unstyled for a frame.
    if (nextCss !== rawCssRef.current) {
      lastWroteRef.current.rawCss = nextCss;
      rawCssRef.current = nextCss;
      setCssParseTick((t) => t + 1);
      setRawCss(nextCss);
    }
    writeHtml(nextHtml);
    setScopesState((prev) => ({
      ...prev,
      local: { ...emptyProps(), __units: {}, __globals: {}, __shown: (prev.local || {}).__shown || {} },
      [className]: { ...bpScope, __shown: ((prev[className] || {}).__shown) || {} },
    }));
    // Point the panel at the scope the value actually went into, so the user can
    // see where their edit landed rather than being left on an empty Local.
    setActiveScope(className);
    return true;
  }, [hasWidget, selectedEntry, scopes, activeMediaQuery, setRawCss, writeHtml]);

  // True when the active breakpoint is NOT the base one, i.e. Local has no
  // valid place to put a value (an inline style holds one value per property
  // and carries no @media) and an edit there has to become a class first.
  // Drives the promotion above and the hint on the Inspector's Local chip.
  const localScopeNeedsClass = !!device && device !== 'desktop';

  // When the selected layer changes, snap the Inspector to that element's
  // first class scope (so Typography/Layout/etc. show real values right
  // away). Falls back to 'local' when the element has no classes. Within
  // the same selection, only forces a reset if the current scope's class
  // has been removed from the element.
  const prevSelectedIdRef = React.useRef(null);
  React.useEffect(() => {
    if (!selectedEntry) {
      prevSelectedIdRef.current = null;
      if (activeScope !== 'local') setActiveScope('local');
      return;
    }
    if (prevSelectedIdRef.current !== selectedEntry.id) {
      prevSelectedIdRef.current = selectedEntry.id;
      const next = selectedEntry.classes[0] || 'local';
      if (next !== activeScope) setActiveScope(next);
      return;
    }
    const tagKey = selectedEntry.tag ? `tag:${String(selectedEntry.tag).toLowerCase()}` : '';
    const isMatchingTagScope = !!tagKey && (activeScope === tagKey || activeScope.startsWith(`${tagKey}:`));
    const isCompoundScope = typeof activeScope === 'string' && activeScope.startsWith('compound:');
    if (activeScope !== 'local' && !selectedEntry.classes.includes(activeScope) && !isMatchingTagScope && !isCompoundScope) {
      setActiveScope(selectedEntry.classes[0] || 'local');
    }
  }, [selectedEntry, activeScope]);

  // The Inspector edits an element model with `classes` and `text`. Both
  // mutate the selected element inside raw_html — `class=""` attribute for
  // class add/remove, direct text-node children for the text editor.
  const element = React.useMemo(() => deriveElement(selectedEntry), [selectedEntry]);

  const anchorSlotIndex = React.useMemo(() => {
    if (!selectedEntry || selectedEntry.tag !== 'a') return null;
    return resolveSlotIndexForPath(rawHtml, selectedEntry.path);
  }, [selectedEntry, rawHtml]);

  const [widgetLink, setWidgetLink] = useWidgetLinkSetting(anchorSlotIndex);

  const anchorLink = React.useMemo(() => {
    if (!selectedEntry) return null;
    const attrs = selectedEntry.attrs || {};
    if (selectedEntry.tag === 'a') {
      const fromDom = {
        url: attrs.href || '',
        is_external: attrs.target === '_blank' ? 'on' : '',
        nofollow: String(attrs.rel || '').toLowerCase().includes('nofollow') ? 'on' : '',
        custom_attributes: '',
      };
      if (anchorSlotIndex == null) return fromDom;
      const fromWidget = normalizeLinkValue(widgetLink);
      return {
        ...fromDom,
        ...fromWidget,
        url: fromWidget.url || fromDom.url,
        custom_attributes: fromWidget.custom_attributes || fromDom.custom_attributes,
      };
    }
    // Non-anchor element: the link is stored as data-uich-link* markers and
    // materialised as an <a> wrapper by the widget's PHP render.
    return {
      url: attrs['data-uich-link'] || '',
      is_external: attrs['data-uich-link-target'] === '_blank' ? 'on' : '',
      nofollow: String(attrs['data-uich-link-rel'] || '').toLowerCase().includes('nofollow') ? 'on' : '',
      custom_attributes: '',
    };
  }, [selectedEntry, anchorSlotIndex, widgetLink]);

  const anchorLinkDynamic = React.useMemo(() => {
    if (anchorSlotIndex == null) return false;
    const settings = active?.settings || (active?.model && active.model.get && active.model.get('settings'));
    if (!settings || typeof settings.get !== 'function') return false;
    const dynamics = settings.get('__dynamic__') || {};
    const linkKey = `slot_${anchorSlotIndex}_link`;
    return !!(dynamics[linkKey] && dynamics[linkKey] !== '');
  }, [active, anchorSlotIndex]);

  const onAnchorLinkChange = React.useCallback((nextLink) => {
    if (!hasWidget || !selectedEntry) return;
    const normalized = normalizeLinkValue(nextLink);
    if (selectedEntry.tag === 'a') {
      const updated = applyLinkAtPath(rawHtmlRef.current, selectedEntry.path, normalized);
      if (updated) writeHtml(updated);
      if (anchorSlotIndex != null) setWidgetLink(normalized);
      return;
    }
    // Non-anchor element: write the link as data-uich-link* markers on the element
    // itself (no wrapping in the editor — the PHP render materialises the <a>).
    const updated = applyElementLinkAttrsAtPath(rawHtmlRef.current, selectedEntry.path, normalized);
    if (updated) writeHtml(updated);
  }, [hasWidget, selectedEntry, anchorSlotIndex, setWidgetLink, writeHtml]);

  const syncWidgetSlotForSelection = React.useCallback((html) => {
    if (!hasWidget || !selectedEntry) return;
    const settings = active?.settings || (active?.model?.get && active.model.get('settings'));
    if (!settings || typeof settings.set !== 'function') return;
    const slotIndex = resolveSlotIndexForPath(html, selectedEntry.path);
    if (slotIndex == null) return;
    const container = document.createElement('div');
    container.innerHTML = normalizeUichemyTags(String(html || ''));
    const node = resolveNodeByPath(container, selectedEntry.path);
    if (!node) return;
    const dynamics = settings.get('__dynamic__') || {};
    settings.__uichComposerSlotSyncing = true;
    try {
      syncSlotSettingsFromNode(settings, slotIndex, node, active?.panel || null, dynamics);
    } finally {
      settings.__uichComposerSlotSyncing = false;
    }
  }, [hasWidget, selectedEntry, active]);

  const onSvgUrlChange = React.useCallback((url) => {
    if (!hasWidget || !selectedEntry || !isSvgLayerEntry(selectedEntry)) return;
    const updated = applySvgUrlAtPath(rawHtmlRef.current, selectedEntry.path, url);
    if (updated) {
      writeHtml(updated);
      syncWidgetSlotForSelection(updated);
    }
  }, [hasWidget, selectedEntry, writeHtml, syncWidgetSlotForSelection]);

  const setElement = React.useCallback((next) => {
    if (!hasWidget || !selectedEntry || !next) return;
    const container = document.createElement('div');
    container.innerHTML = normalizeUichemyTags(String(rawHtmlRef.current || ''));
    let node = resolveNodeByPath(container, selectedEntry.path);
    if (!node || node.nodeType !== 1) return;

    let dirty = false;

    // Full outerHTML replacement — used for SVG editing. We replace the
    // node in-place; the entry's path stays the same because we keep the
    // node's position among its siblings.
    if (typeof next.outerHtml === 'string') {
      const tmp = document.createElement('div');
      tmp.innerHTML = next.outerHtml;
      const candidate = tmp.firstElementChild;
      if (candidate && node.parentNode) {
        node.parentNode.replaceChild(candidate, node);
        node = candidate;
        dirty = true;
      }
    }

    // Inner HTML replacement — used by the rich in-place text editor for nodes
    // with inline children (e.g. an <h1> holding <em>/<br>). Keeps the node's own
    // attributes/classes; only its children (interleaved text + inline tags) are
    // rewritten, so text around a child element keeps its position.
    if (typeof next.innerHtml === 'string') {
      if (node.innerHTML !== next.innerHtml) {
        node.innerHTML = next.innerHtml;
        dirty = true;
      }
    }

    // Classes
    const prevClassAttr = node.getAttribute('class') || '';
    const nextClassAttr = Array.isArray(next.classes)
      ? next.classes.join(' ').trim()
      : prevClassAttr;
    if (Array.isArray(next.classes) && prevClassAttr !== nextClassAttr) {
      if (nextClassAttr) node.setAttribute('class', nextClassAttr);
      else node.removeAttribute('class');
      dirty = true;
    }

    // Tag rename — replace node in-place, preserving attributes + children.
    if (next.tag && typeof next.tag === 'string') {
      const newTag = next.tag.toLowerCase();
      if (newTag !== node.tagName.toLowerCase()) {
        const newNode = document.createElement(newTag);
        Array.from(node.attributes).forEach((attr) => newNode.setAttribute(attr.name, attr.value));
        while (node.firstChild) newNode.appendChild(node.firstChild);
        if (node.parentNode) node.parentNode.replaceChild(newNode, node);
        node = newNode;
        dirty = true;
      }
    }

    // `src` / `alt` attributes — used by the image editor.
    if (typeof next.src === 'string') {
      const prev = node.getAttribute('src') || '';
      if (prev !== next.src) {
        if (next.src) node.setAttribute('src', next.src);
        else node.removeAttribute('src');
        dirty = true;
      }
    }
    if (typeof next.alt === 'string') {
      const prev = node.getAttribute('alt') || '';
      if (prev !== next.alt) {
        node.setAttribute('alt', next.alt);
        dirty = true;
      }
    }

    // Custom Attributes update
    if (next.attrs && typeof next.attrs === 'object') {
      const newCustomAttrs = next.attrs;
      const currentAttrs = Array.from(node.attributes);

      // 1. Remove attributes that are not in newCustomAttrs (excluding style, class, href, target)
      for (const attr of currentAttrs) {
        const nameLower = attr.name.toLowerCase();
        if (['style', 'class', 'href', 'target'].includes(nameLower)) {
          continue;
        }
        if (!(attr.name in newCustomAttrs)) {
          node.removeAttribute(attr.name);
          dirty = true;
        }
      }

      // 2. Set/update attributes from newCustomAttrs (excluding style, class, href, target)
      for (const name of Object.keys(newCustomAttrs)) {
        const nameLower = name.toLowerCase();
        if (['style', 'class', 'href', 'target'].includes(nameLower)) {
          continue;
        }
        const val = String(newCustomAttrs[name]);
        if (node.getAttribute(name) !== val) {
          node.setAttribute(name, val);
          dirty = true;
        }
      }
    }

    if (typeof next.svgUrl === 'string') {
      const updated = applySvgUrlAtPath(container.innerHTML, selectedEntry.path, next.svgUrl);
      if (updated) {
        writeHtml(updated);
        syncWidgetSlotForSelection(updated);
        return;
      }
    }

    // Text content (only when the caller actually supplied a text field).
    if (typeof next.text === 'string') {
      let prevText = '';
      for (let i = 0; i < node.childNodes.length; i++) {
        const c = node.childNodes[i];
        if (c.nodeType === 3) prevText += c.textContent || '';
      }
      if (prevText !== next.text) {
        replaceDirectTextOf(node, next.text);
        dirty = true;
      }
    }

    if (dirty) {
      const nextHtml = denormalizeUichemyTags(container.innerHTML);
      writeHtml(nextHtml);
      syncWidgetSlotForSelection(nextHtml);
    }
  }, [hasWidget, selectedEntry, writeHtml, syncWidgetSlotForSelection]);

  // Double-click the selected element on the canvas to edit its text in place.
  // It is the sidebar's Content → TEXT field, moved onto the element: the same
  // `element`, the same setElement, and the same whitespace rule — if the
  // visible text comes back unchanged, write the ORIGINAL back so the node's
  // source indentation survives and no raw_html rewrite fires (mirrors
  // ElementTextField.commit).
  //
  const onCommitInlineText = React.useCallback((typed) => {
    const original = element.text || '';
    const next = typed === stripFormattingWhitespace(original) ? original : typed;
    setElement({ ...element, text: next });
  }, [element, setElement]);

  // Rich in-place edit (nodes with inline children like <em>/<br>/<svg>) commits
  // the node's cleaned innerHTML instead of a single text run, so interleaved
  // text keeps its place. Same setElement write funnel.
  const onCommitInlineHtml = React.useCallback((html) => {
    setElement({ innerHtml: String(html == null ? '' : html) });
  }, [setElement]);

  // Live text is part of pick mode, exactly like the canvas toolbar above: pick
  // an element and type on it, all without leaving pick mode. With the picker off
  // the canvas is a preview and nothing is editable on it.
  //
  // No click-through needed: the picker ignores our own chrome by id, so a click
  // inside the editor is not a pick, which leaves clicking into the text free to
  // do the obvious thing and place the caret.
  //
  // Off on Chat, where the selection belongs to Chat's own picker.
  useInlineTextEdit({
    model: active?.model,
    selectedPath: tab !== 'chat' ? (selectedEntry?.path || null) : null,
    selectedClasses: selectedEntry?.classes || null,
    text: element.text,
    enabled: picking,
    onCommit: onCommitInlineText,
    onCommitHtml: onCommitInlineHtml,
  });

  const [stateName, setStateName] = React.useState('default');
  const [height, setHeight] = React.useState(preset.heightOverride || 520);
  // The drawer starts COLLAPSED and is opened by the toolbar's Edit Code / Edit
  // with AI buttons, which fire the switch-tab event that clears this flag.
  // Nothing does that for an inspector instance — WordPress's sidebar owns
  // showing and hiding it, and its collapse affordances (edge toggle, resize)
  // are hidden there — so it would sit permanently collapsed: the tab bar
  // rendered with Chat marked active, but the tab BODY hidden behind
  // `display: none` (see the chat wrapper in the render below), i.e. an empty
  // panel until you clicked the already-active tab. Never collapsed in the
  // inspector.
  const [panelCollapsed, setPanelCollapsed] = React.useState(
    isInspector ? false : (preset.collapsed ?? true)
  );

  // True while Chat is the visible tab, which is the only time its own picker
  // (useChatPickMode) is mounted and listening. For exactly this window the FAB
  // drives THAT picker instead of one of its own — see onToolbarPick.
  const chatPickOwnsCanvas = !panelCollapsed && tab === 'chat';

  // Feed chat picks into the panel's own selection (handleChatPickPath, above),
  // which is what gives the Chat tab the on-canvas typography bar.
  useChatPickSelection({
    model: active?.model,
    enabled: chatPickOwnsCanvas,
    onPath: handleChatPickPath,
  });
  // Drop the flag when Chat stops owning the canvas (tab change or collapse), so
  // coming back to Chat starts clean instead of re-drawing chrome for an element
  // the user last touched several tabs ago. The SELECTION itself is deliberately
  // left alone — the panel remembering what you picked is existing behaviour on
  // every other tab.
  React.useEffect(() => {
    if (!chatPickOwnsCanvas) setChatPicked(false);
  }, [chatPickOwnsCanvas]);

  // Chat owns its picker state; it mirrors it out on this event so the FAB's
  // button can render pressed while picking is armed from either side.
  const [chatPicking, setChatPicking] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onState = (e) => setChatPicking(!!(e && e.detail && e.detail.picking));
    window.addEventListener('uichemy:composer:chat-pick-state', onState);
    return () => window.removeEventListener('uichemy:composer:chat-pick-state', onState);
  }, []);

  // Draw/annotate lives in the Pro bundle; it mirrors its on/off out on this
  // event so the toolbar's Draw button renders pressed while draw mode is active
  // — same out-of-tree bridge as the chat picker above.
  const [drawActive, setDrawActive] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onState = (e) => setDrawActive(!!(e && e.detail && e.detail.on));
    window.addEventListener('uichemy:composer:draw-state', onState);
    return () => window.removeEventListener('uichemy:composer:draw-state', onState);
  }, []);

  // The React root is mounted once into the floating-panel shell and never
  // unmounts — switching to a Container / other element only toggles the
  // panel's `.active` visibility class, it does NOT tear down React. Without
  // this, the panel's open/expanded state (`panelCollapsed`) and the selected
  // layer survive the hide/show cycle, so re-selecting the Composer widget shows
  // the HTML editor still expanded on the previously-selected element. Reset to
  // a clean, collapsed state whenever the active widget is deselected so the
  // editor re-opens closed (mirrors Elementor's own panel-close behaviour).
  const prevHasWidgetRef = React.useRef(hasWidget);
  React.useEffect(() => {
    const was = prevHasWidgetRef.current;
    prevHasWidgetRef.current = hasWidget;
    if (was && !hasWidget) {
      // Collapsing is drawer-only. In the inspector there is no affordance to
      // un-collapse (WordPress owns show/hide and the edge toggle is hidden), so
      // this would strand the panel blank — tab bar visible, body `display:none`
      // — with no way back.
      if (!isInspector) setPanelCollapsed(true);
      setSelectedLayerId(null);
    }
  }, [hasWidget, isInspector]);

  // Auto-open the panel when a Composer widget is (re)selected — IN THE EDITOR
  // ONLY. There the sidebar IS the editor, so selecting a widget without showing
  // the Inspector would leave the user with nothing.
  //
  // On the FRONT END it stays shut. There the page is the thing being read, the
  // canvas carries its own editing surface (floating bar + in-place text), and
  // the drawer is opened deliberately with the edge chevron when the full
  // Inspector is actually wanted. Auto-opening it also made picking behave
  // inconsistently: it only fired when `active` CHANGED, and the front-end bridge
  // stages the page's first widget at load, so picking inside widget 1 opened
  // nothing while picking widget 2 opened the drawer.
  //
  // `active` is a fresh store object per selection (see store.setActive in the
  // Elementor bridge), so this fires once per selection change — it does NOT
  // re-open a panel the user deliberately collapsed while staying on the same
  // widget, and it stays quiet on initial mount (prev === active there).
  const prevActiveRef = React.useRef(active);
  React.useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = active;
    if (!active || active === prev) return;
    // Consume the load-time staging flag either way, so it can never leak into a
    // later selection.
    const wasSilent = frontendState.silentLoad;
    frontendState.silentLoad = false;
    if (wasSilent || isFrontend) return;
    setPanelCollapsed(false);
  }, [active, isFrontend]);

  // Panel dock position — 'bottom' (default, current experience) or 'right'
  // (vertical Elementor-panel-like layout). Persisted like the mode switch.
  // Always 'right' — the bottom dock was removed per product decision. setDock is
  // kept so existing callers are harmless no-ops (they only ever pass 'right').
  const [dock, setDock] = React.useState('right');
  React.useEffect(() => {
    try { localStorage.setItem('uich_composer_dock', 'right'); } catch (_) { /* noop */ }
  }, [dock]);
  const dockRef = React.useRef(dock);
  React.useEffect(() => { dockRef.current = dock; }, [dock]);
  // Right-dock width (px). Drag-resizable between DOCK_MIN and DOCK_MAX via
  // the resize handle; starts from whatever was last persisted (clamped, in
  // case DOCK_MIN/DOCK_MAX changed since) or DOCK_W for a first run.
  const [dockWidth, setDockWidth] = React.useState(() => {
    try {
      const stored = parseInt(localStorage.getItem('uich_composer_dock_w'), 10);
      if (Number.isFinite(stored)) return Math.min(DOCK_MAX, Math.max(DOCK_MIN, stored));
    } catch (_) { /* noop */ }
    return DOCK_W;
  });
  React.useEffect(() => {
    try { localStorage.setItem('uich_composer_dock_w', String(dockWidth)); } catch (_) { /* noop */ }
  }, [dockWidth]);
  const dockWidthRef = React.useRef(dockWidth);
  React.useEffect(() => { dockWidthRef.current = dockWidth; }, [dockWidth]);

  // Editing mode now applies in BOTH docks. Simple stays the client-friendly
  // layout; Developer unlocks the full class/code/scope system — including the
  // Layers tree, which in the right dock stacks ABOVE the Inspector inside the
  // same panel (no separate side panel).
  const uiMode = mode;

  // The tool tabs' sliding pill. useSlidingSeg measures the active tab and
  // publishes its offset/size, so nothing here has to know how many tabs
  // rendered — which matters because Chat is gated on the role's AI permission
  // and Code on Developer mode, so the count is 1, 2 or 3.
  const toolTabsRef = useSlidingSeg();

  // Layers panel width draggable state. Resets to 220px (min width) on page refresh.
  const [layersWidth, setLayersWidth] = React.useState(220);
  const layersWidthRef = React.useRef(layersWidth);
  React.useEffect(() => { layersWidthRef.current = layersWidth; }, [layersWidth]);

  const layersResizeHandleRef = React.useRef(null);

  // Layers "Navigator" — detach the Layers tree into a floating, movable
  // window (Elementor-style). Persisted so it stays detached across reloads.
  const [layersFloating, setLayersFloating] = React.useState(() => {
    try { return localStorage.getItem('uich_layers_floating') === '1'; } catch (_) { return false; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('uich_layers_floating', layersFloating ? '1' : '0'); } catch (_) { /* noop */ }
  }, [layersFloating]);

  // Layers hidden on/off — the header Layers icon toggles the movable floating
  // navigator (there is no inline pane).
  //
  // ALWAYS starts closed, and deliberately not remembered: it is a floating
  // window over the canvas, so persisting "open" meant that opening it once left
  // it covering the canvas on every load afterwards. Session-only state — the
  // icon opens it when it is wanted. (The old `uich_layers_hidden_v2` key is no
  // longer read or written; any leftover value is simply ignored.)
  const [layersHidden, setLayersHidden] = React.useState(true);

  // ── Canvas quick-action toolbar (Inspecta-style floating pill) ─────────────
  // A rounded-full pill portaled over the canvas with the most-used actions.
  // Shown on the Editor AND Chat tabs while a widget is active; especially handy
  // when the panel is collapsed. On Chat its pick button drives Chat's own
  // picker (see onToolbarPick / chatPickOwnsCanvas) rather than the editor's, so
  // only ever one picker is armed.
  const [toolbarEl, setToolbarEl] = React.useState(null);
  const [outlineOn, setOutlineOn] = React.useState(false);
  // On the live front end the pill is the primary way to pick a Composer widget
  // on the page (replacing the admin-bar "Pick UiChemy" node), so it stays
  // visible even before a widget is loaded. In the editor it shows on the
  // Editor and Chat tabs once a widget is active.
  // On the live front end the canvas toolbar is hidden until the user clicks the
  // admin-bar "Pick UiChemy" button, which toggles it on/off (slides up from the
  // bottom). In the Elementor/standalone editor it follows the widget/tab state.
  const [feToolbarOn, setFeToolbarOn] = React.useState(false);

  // Does the current front-end view actually contain a Composer widget? The FAB
  // toolbar is the entry point for picking / editing a Composer widget, so on a
  // page (or a plain WP `?preview=true` view) that has NO Composer widget there
  // is nothing for it to act on — showing it there is just noise. Detect real
  // presence in the SERVED DOM using the same selector the picker bridge uses so
  // this also catches widgets that live only in a header/footer/theme-builder
  // template (which the PHP-side `page_has_composer_widget()` check cannot see),
  // and covers the Elementor / Gutenberg / Bricks wrappers alike.
  const detectPageHasWidget = React.useCallback(() => {
    if (typeof window === 'undefined') return false;
    try {
      const api = window.UiChemyFrontend;
      if (api && typeof api.widgets === 'function') return api.widgets().length > 0;
      return !!document.querySelector(
        '.elementor-widget-uichemy-composer, .elementor-widget-composer, .elementor-widget-proton, .elementor-widget-uichemy-builder, .wp-block-uichemy-composer, .uichemy-bricks-composer'
      );
    } catch (_) { /* SSR / detached document */ }
    return false;
  }, []);
  const [pageHasComposerWidget, setPageHasComposerWidget] = React.useState(detectPageHasWidget);
  // The picker bridge (uichemy-frontend-bridge.js) may finish parsing the page
  // AFTER this component first mounts, so re-check once the effect runs and again
  // when the bridge announces the widgets it found. Front end only — the editor
  // surfaces gate the toolbar on the picked widget, not page markup.
  React.useEffect(() => {
    if (!isFrontend || typeof window === 'undefined') return undefined;
    const recheck = () => setPageHasComposerWidget(detectPageHasWidget());
    recheck();
    window.addEventListener('uichemy:frontend:widgets-discovered', recheck);
    return () => window.removeEventListener('uichemy:frontend:widgets-discovered', recheck);
  }, [isFrontend, detectPageHasWidget]);

  // The floating radial action button is the only entry point to picking on the
  // live front end (the old admin-bar "Pick UiChemy" node was removed). It shows
  // whenever the page has a Composer widget to act on — a page/preview with no
  // Composer widget gets no FAB (`hasWidget` keeps it visible while a widget is
  // actively loaded, belt-and-braces). In the editor it rides the direct-edit
  // surface and the Chat tab (Chat needs the same pick / outline / layers /
  // collapse actions).
  const toolbarActive = isFrontend
    ? (pageHasComposerWidget || hasWidget)
    : (hasWidget && (tab === 'direct' || tab === 'chat'));

  // On the live front end the drawer's on-screen `.active` class is normally
  // gated on `hasWidget` (see the dock layout-effect below) — the Editor is only
  // shown when a Composer widget is being edited. But Chat and Draw are page-scoped
  // features that need NO widget: clicking Draw/Ask-AI opens the Chat tab (and,
  // for Draw, the annotate overlay) with nothing picked. Without a widget the
  // drawer stayed at translateX(105%) off-screen, so the panel never appeared
  // (and, once collapsed, its edge-toggle reopen chevron never rendered either).
  // `feEngaged` latches true the first time the panel is opened on the front end
  // and keeps the drawer `.active` from then on, so it opens on demand AND leaves
  // the collapsed edge-toggle reachable to reopen it. Left false on first load so
  // the initial front-end look is unchanged (just the toolbar pill, no drawer).
  const [feEngaged, setFeEngaged] = React.useState(false);

  // Persistent solid box around the whole active widget — drawn for as long as a
  // widget is loaded, regardless of tab, panel collapse, or whether a layer is
  // selected. This is what tells the user "this is the section you picked" when
  // the panel is closed to a strip on the live front end.
  //
  // Held back on the front end until the editor has actually been opened
  // (`feEngaged`): the first section is staged at load time so the panel can show
  // it instantly, and outlining it before the user opens anything would paint a
  // box over a page they came to read.
  useActiveWidgetOutline({ model: (!isFrontend || feEngaged) ? active?.model : null });

  // Switch mode is NEVER armed: responding to the page belongs to the picker
  // alone, and the picker is armed by its toolbar button.
  //
  // It used to follow the panel — open panel meant hovering any Composer section
  // highlighted it and a click jumped straight there. But it runs precisely when
  // the picker is OFF (its handlers bail while picking), so with the panel open
  // an ordinary click on the page still selected an element and pulled its values
  // into the sidebar, and hovering still drew a box over the content. Nothing was
  // lost by turning it off: the armed picker's own mousedown already resolves a
  // click inside ANY Composer widget, this one included, and the hover highlight
  // comes from usePickMode.
  //
  // The bridge's onSwitchOver / onSwitchDown are dormant with this off — worth
  // deleting outright once this has been confirmed in the browser.
  React.useEffect(() => {
    if (!isFrontend) return undefined;
    const api = window.UiChemyFrontend;
    if (!api || typeof api.setSwitchMode !== 'function') return undefined;
    api.setSwitchMode(false);
    return () => { try { api.setSwitchMode(false); } catch (_) { /* torn down */ } };
  }, [isFrontend, panelCollapsed]);

  // "Pick UiChemy" dispatches this toggle; flip our local visibility. The event
  // may carry an explicit { on } (from the admin-bar mirror) or nothing (plain
  // toggle) — honour the explicit value when present.
  React.useEffect(() => {
    if (!isFrontend || typeof window === 'undefined') return undefined;
    const onToggle = (e) => setFeToolbarOn((v) => (
      e && e.detail && typeof e.detail.on === 'boolean' ? e.detail.on : !v
    ));
    window.addEventListener('uichemy:frontend:toggle-toolbar', onToggle);
    return () => window.removeEventListener('uichemy:frontend:toggle-toolbar', onToggle);
  }, [isFrontend]);

  // Front-end WHOLE-WIDGET picking (no widget loaded yet) is owned by the
  // picker bridge (uichemy-frontend-bridge.js). The pill drives it via events
  // and mirrors the pressed state locally; it clears once a widget is selected.
  const [fePicking, setFePicking] = React.useState(false);
  React.useEffect(() => {
    if (!isFrontend || typeof window === 'undefined') return undefined;
    const onSelected = (e) => {
      setFePicking(false);
      const detail = e && e.detail;

      // A real pick puts the user to work ON THE CANVAS — floating bar over the
      // element, text editable in place. It deliberately does NOT open the
      // sidebar: that stays a manual choice, via the edge chevron.
      //
      // Two things have to be set for the canvas to come alive, and neither was:
      //
      //  • `tab`. The canvas decorations are gated on `tab !== 'chat'`, and 'chat'
      //    is the DEFAULT tab on the front end (see the useState above), so a pick
      //    drew nothing at all. A pick means "work on this element", so it lands
      //    on the Editor tab — without opening the panel to show it.
      //  • `picking`. The bridge keeps its own flag and stays armed after a pick
      //    now (it no longer calls stopPicking), while the panel's flag was still
      //    false — so the toolbar button un-lit itself and everything gated on
      //    `picking` stayed off. Mirror it here or the two drift apart.
      //
      // `silent` separates the load-time staging (selectFirst({silent:true}),
      // which stages the page's FIRST widget before the user touches anything)
      // from a real pick. That staging is also why widget 1 behaved differently
      // from widget 2: it was already `active`, so the active-change effect below
      // saw no change at all.

      let fromChat = false;
      try {
        fromChat = typeof window.__uichSelectFromChat === 'number'
          && (Date.now() - window.__uichSelectFromChat) < 2000;
      } catch (_) { /* flag is best-effort */ }

      if (detail && !detail.silent && !fromChat) {
        setTab('direct');
        setPicking(true);
      }

      // The pick carries a specific element, not just "a section" — resolve its
      // path the same way onSwitchWidget does, so it ends up selected once the
      // widget's layer tree loads instead of defaulting to the first layer.
      // Without this, picking would feel like two steps (pick the section, then
      // pick the element inside it) instead of one.
      const clickedNode = detail && detail.clickedNode;
      if (clickedNode) {
        // Resolve the container by walking UP from the clicked node itself,
        // NOT by re-querying the document for `data-id` — Elementor reuses
        // the SAME data-id across every repeated instance of a widget inside
        // a Loop Grid / dynamic template, so a global lookup can silently
        // grab the FIRST occurrence instead of the one actually clicked.
        // computePathForNode then can't find `clickedNode` as a descendant of
        // the WRONG container, returns null, and the pending path is quietly
        // dropped — which looks exactly like "only the section got selected."
        const container = clickedNode.closest
          ? clickedNode.closest('.elementor-widget-container')
          : null;
        stashPendingPickPath(container, clickedNode, detail.elementId);
      }
    };
    window.addEventListener('uichemy:frontend:widget-selected', onSelected);
    return () => window.removeEventListener('uichemy:frontend:widget-selected', onSelected);
  }, [isFrontend, stashPendingPickPath]);

  // The FAB is context-aware: with no widget loaded yet it picks a WHOLE
  // Composer widget on the page (bridge above). Once a widget is loaded, it
  // switches to picking a specific element WITHIN that widget — the same
  // `usePickMode` mechanism the Elementor editor uses (getWidgetRoot already
  // resolves the live frontend DOM node via document.querySelector, so no
  // further plumbing is needed there).
  const onFrontendPick = React.useCallback(() => {
    if (hasWidget) {
      // Arming the picker IS "I want to edit on the canvas", so it lands on the
      // Editor tab — without opening the drawer (setTab alone doesn't; only the
      // `uich:composer-switch-tab` handler pairs the two).
      //
      // Every canvas decoration — floating bar, in-place text — is gated on
      // `tab !== 'chat'`, and 'chat' is the front end's DEFAULT tab. So a pick
      // made straight after load did select the element but drew nothing at all,
      // and the first widget looked completely dead. It only came right once
      // something else had switched the tab, which is exactly why picking the
      // SECOND widget appeared to fix it: that click goes out through the bridge,
      // whose widget-selected handler sets the tab. Same pick, two behaviours,
      // depending only on which widget was staged at load.
      //
      // It also keeps the picker armed, because the disarm effect above treats
      // "armed while on Chat" as invalid and turns it straight back off.
      const next = !pickingRef.current;
      if (next) setTab('direct');
      setPicking(next);
      // Turning the button OFF has to disarm the page bridge too.
      //
      // The bridge keeps its own `picking` flag and no longer drops it after a
      // pick (it is a mode now), but this branch only ever toggled the panel's
      // flag — so once the bridge had been armed it answered clicks forever.
      // Switching the button off left it live: the next plain click on an element
      // still selected it, and the bridge's widget-selected handler then set
      // `picking` back to true, re-arming the picker the user had just turned off,
      // floating bar and in-place text and all.
      if (!next) {
        try {
          const api = window.UiChemyFrontend;
          if (api && typeof api.stopPicking === 'function') api.stopPicking();
        } catch (_) { /* bridge not on the page */ }
      }
      return;
    }
    setFePicking((p) => {
      const next = !p;
      try {
        if (next) window.dispatchEvent(new CustomEvent('uichemy:frontend:start-pick'));
        else if (window.UiChemyFrontend && window.UiChemyFrontend.stopPicking) window.UiChemyFrontend.stopPicking();
      } catch (_) { /* older browsers */ }
      return next;
    });
  }, [hasWidget]);

  // The FAB's pick button is context-aware: it arms the picker belonging to
  // whichever tab is on screen — the editor's within-widget / whole-widget
  // picker on Editor, and Chat's own picker (which turns the pick into a
  // CONTEXT chip) on Chat. Only ever one picker is armed, so the two can't
  // both answer the same click the way they used to.
  const onToolbarPick = React.useCallback(() => {
    if (chatPickOwnsCanvas) {
      try {
        window.dispatchEvent(new CustomEvent('uichemy:composer:toggle-chat-pick'));
      } catch (_) { /* older browsers */ }
      return;
    }
    if (isFrontend) { onFrontendPick(); return; }
    setPicking((p) => !p);
  }, [chatPickOwnsCanvas, isFrontend, onFrontendPick]);

  // Handing the canvas to Chat's picker means dropping whatever the editor's
  // side had armed — `picking` is also covered by the auto-arm effect above,
  // but the whole-widget picker lives in the bridge and keeps its own
  // listeners until explicitly stopped, so it needs clearing on both sides.
  React.useEffect(() => {
    if (!chatPickOwnsCanvas) return;
    setPicking(false);
    if (!isFrontend) return;
    setFePicking(false);
    try {
      if (window.UiChemyFrontend && typeof window.UiChemyFrontend.stopPicking === 'function') {
        window.UiChemyFrontend.stopPicking();
      }
    } catch (_) { /* noop */ }
  }, [isFrontend, chatPickOwnsCanvas]);

  // Latch `feEngaged` the moment the panel is first opened on the front end, so
  // the drawer stays `.active` (openable + collapsible with a reachable edge
  // toggle) for the rest of the session even with no widget picked — see the
  // `feEngaged` declaration and the dock layout-effect below.
  React.useEffect(() => {
    if (isFrontend && !panelCollapsed) setFeEngaged(true);
  }, [isFrontend, panelCollapsed]);

  // FAB "open / close panel" action. With a widget loaded it just toggles the
  // drawer. On the front end with NOTHING loaded yet, the drawer has no widget
  // to edit — so the FIRST open auto-selects the FIRST Composer widget on the page
  // (its load fires the `active`-change effect below, which opens the panel).
  // Only on that first open, though: once the panel has been engaged (e.g. for
  // Chat/Draw) or is already open (this press is a MINIMISE), just toggle —
  // never yank a widget in on a close, reopen, or minimise.
  const onTogglePanel = React.useCallback(() => {
    if (isFrontend && !hasWidget && panelCollapsed && !feEngaged) {
      try {
        if (window.UiChemyFrontend && typeof window.UiChemyFrontend.selectFirst === 'function') {
          // Opening the panel loads a widget but must NOT arm the picker — guard
          // the resulting active-change so the auto-arm effect skips it once.
          suppressAutoArmRef.current = true;
          if (window.UiChemyFrontend.selectFirst()) return; // load → panel auto-opens
          suppressAutoArmRef.current = false; // nothing selected — don't leave it armed-off
        }
      } catch (_) { /* older browsers */ }
    }
    setPanelCollapsed((c) => !c);
  }, [isFrontend, hasWidget, panelCollapsed, feEngaged]);

  // Element-outline overlay lives in the preview document; always cleared on
  // teardown so it never lingers after the composer closes.
  React.useEffect(() => {
    setCanvasOutline(outlineOn);
    return () => setCanvasOutline(false);
  }, [outlineOn]);

  // Read latest height from a ref so the drag handler doesn't have to be
  // re-created on every render (and so re-attaching the native listener
  // doesn't tear off the in-flight drag).
  const heightRef = React.useRef(height);
  React.useEffect(() => { heightRef.current = height; }, [height]);

  const resizeHandleRef = React.useRef(null);

  // Walks up from the panel section to the outer `#uichemy-composer-floating-panel`
  // container that the legacy editor injects. That's the element with
  // `position: absolute; bottom: 0; height: 430px; overflow: hidden`, so it
  // is the one whose height we need to change to grow/shrink the visible
  // panel area.
  function getOuterPanel() {
    const section = panelRef.current;
    if (!section) return null;
    // Inspector surface: there IS no outer drawer shell — WordPress's sidebar is
    // the container. Returning the `section.parentNode` fallback here would hand
    // back our own mount host INSIDE the sidebar, and the dock layout effect
    // would then write `width: <dockWidth>px` (420 by default) plus
    // `.uich-dock-right` onto it — forcing the panel to 420px inside a 280px
    // sidebar and overflowing it. No shell means no shell geometry to drive.
    if (isInspector) return null;
    return (
      (section.closest && section.closest('#uichemy-composer-floating-panel')) ||
      (section.closest && section.closest('.uichemy-composer-floating-panel')) ||
      section.parentNode || null
    );
  }

  // Push React's height state down to the outer container on every change.
  // We keep React as the source of truth and treat the DOM update as a
  // side effect — the outer container has its own legacy CSS height
  // (430px) that we need to override here.
  //
  // useLayoutEffect (not useEffect): this applies `.uich-dock-right` to the outer
  // shell BEFORE the browser paints. With a plain effect it ran AFTER first paint,
  // so the shell painted once with its base bottom-dock CSS (bottom sheet) and
  // then jumped to the right — the "editor flashes at the bottom then moves to
  // the side on refresh" bug. index.jsx also adds the class at mount time and the
  // front end ships it in static markup, so the flash is gone in every context.
  React.useLayoutEffect(() => {
    const outer = getOuterPanel();
    if (!outer || !outer.style) return;
    if (dock === 'right') {
      // Right dock: CSS drives position (top:0;bottom:0;right:0); we drive width.
      // "Collapsed" slides the whole drawer off-screen (Elementor-style) —
      // the edge toggle sticking out of the left edge stays reachable.
      outer.classList.add('uich-dock-right');
      outer.classList.toggle('uich-dock-slid', !!panelCollapsed);
      // Elementor-style in/out: the drawer is only ON-SCREEN when a widget is
      // being edited. React owns `.active` here (rather than relying on the
      // legacy shell) so the panel and the reserved canvas gutter below stay in
      // sync — no widget ⇒ no panel ⇒ no gutter. On the front end, Chat/Draw open
      // the (page-scoped) panel with no widget picked, so also keep it active
      // once engaged there (`feEngaged`) — otherwise the drawer never slides on
      // for Draw, and its collapsed edge-toggle reopen chevron never appears.
      outer.classList.toggle('active', hasWidget || (isFrontend && feEngaged));
      // Clear any stale inline offsets left over from the legacy draggable
      // bottom panel. A leftover `left`/`top` overrides the dock's `right:0`
      // (left+width win over right in absolute positioning), pinning the drawer
      // a few pixels off the edge with a gap. Wiping them lets `right:0` place
      // it flush against the edge — the correct left position at any width.
      outer.style.left = '';
      outer.style.top = '';
      outer.style.right = '';
      outer.style.bottom = '';
      outer.style.height = '';
      outer.style.maxHeight = '';
      outer.style.width = `${dockWidth}px`;
    } else {
      outer.classList.remove('uich-dock-right', 'uich-dock-slid');
      outer.style.width = '';
      outer.style.height = panelCollapsed ? '44px' : `${height}px`;
      outer.style.maxHeight = panelCollapsed ? '44px' : '90vh';
    }
  }, [height, panelCollapsed, dock, dockWidth, hasWidget, isFrontend, feEngaged]);

  // When the composer is docked to the RIGHT and open, dock it OFF-CANVAS like
  // Elementor's own panel: hide Elementor's left panel AND reserve our panel's
  // width on the right of `#elementor-preview` so the preview iframe shrinks to
  // sit *beside* the panel instead of sliding underneath it. Overlaying a full-
  // width canvas was what pushed content under the drawer and spilled past the
  // viewport (the horizontal window scrollbar).
  //
  // How it reserves space: our panel is `position:absolute; right:0` inside
  // `#elementor-preview` (top editor document). Right-padding that container by
  // the panel width pushes the iframe (a width:100% flow child) leftward and
  // leaves an exactly panel-wide gutter on the right for the panel to fill — no
  // overlap, no overflow. The width tracks the draggable `dockWidth`. Everything
  // is reversible: re-docking to the bottom, collapsing, or closing removes the
  // class and Elementor's panel + full-width canvas return with native easing.
  React.useEffect(() => {
    const doc = document.getElementById('elementor-panel')
      ? document
      : (() => { try { return window.top.document.getElementById('elementor-panel') ? window.top.document : document; } catch (_) { return document; } })();
    if (!doc || !doc.body) return undefined;

    if (!doc.getElementById('uich-hide-e-panel-style')) {
      const style = doc.createElement('style');
      style.id = 'uich-hide-e-panel-style';
      style.textContent =
        // Slide Elementor's own panel out (native preview-mode transition).
        'body.uich-hide-e-panel .elementor-panel{--e-is-preview-mode:1!important}' +
        // Full-width canvas, then carve out a panel-wide gutter on the right.
        'body.uich-hide-e-panel{--e-preview-width:100%!important}' +
        'body.uich-hide-e-panel #elementor-preview{' +
        'padding-right:var(--uich-dock-w,420px)!important;' +
        'box-sizing:border-box!important;' +
        '}' +
        // Match Elementor's own preview easing for the gutter carve. Elementor
        // animates #elementor-preview `width`/`margin` over 0.5s when its panel
        // slides away; without this the right `padding` jumped instantly, so
        // during that 0.5s the canvas was `animating-width − full-padding` and
        // momentarily collapsed narrow before settling. Extending the SAME
        // transition to `padding` keeps the carve in lockstep with the width
        // grow, so the canvas eases straight to its final width — the "same
        // feeling as Elementor's panel". Unconditional (not scoped to the
        // toggle class) so the transition is already live before padding
        // changes; disabled mid-drag via `.uich-dock-resizing` so the resize
        // handle tracks the pointer with no lag (mirrors `.ui-resizable-resizing`).
        '#elementor-preview:not(.ui-resizable-resizing):not(.uich-dock-resizing){' +
        'transition:margin .5s ease-in-out,width .5s ease-in-out,padding .5s ease-in-out!important;' +
        '}' +
        // Keep the responsive wrapper flush-left in the shrunk area (Elementor
        // centres it for tablet/mobile widths) AND drop the 1025px desktop
        // min-width: once we carve out the panel gutter, `viewport - dockWidth`
        // is often < 1025px, and that min-width made the canvas overflow past
        // the gutter and spill a horizontal scrollbar onto the window. Letting
        // it shrink into the available width is what "fits" the canvas.
        'body.uich-hide-e-panel #elementor-preview-responsive-wrapper{' +
        'margin-right:0!important;' +
        'min-width:0!important;' +
        '}' +
        // Belt-and-suspenders: never let the canvas column spill horizontally
        // past the reserved area (kills any residual window scrollbar).
        'body.uich-hide-e-panel #elementor-preview{' +
        'overflow-x:hidden!important;' +
        '}';
      (doc.head || doc.documentElement).appendChild(style);
      // Flush layout so the browser adopts the (unconditional) padding
      // transition BEFORE the class toggle below changes padding — otherwise
      // the first open applies the transition and the new padding in the same
      // recalc and skips the animation (the classic first-transition gotcha).
      try { const prev = doc.getElementById('elementor-preview'); if (prev) void prev.offsetWidth; } catch (_) { /* noop */ }
    }

    // Reserve the canvas gutter ONLY while the drawer is actually on-screen:
    // right dock + open + a widget is being edited. Collapsed or no widget ⇒
    // no gutter, so the canvas reclaims full width (the "minus padding, go
    // outside" behaviour — same as when Elementor's own panel hides). On the
    // front end the Editor gutter is inert (no #elementor-preview), but this
    // still sets `--uich-dock-w`, which recentres the canvas toolbar pill over
    // the visible canvas — so include the engaged, widget-less Chat/Draw case.
    const hide = dock === 'right' && !panelCollapsed && (hasWidget || (isFrontend && feEngaged));
    doc.body.classList.toggle('uich-hide-e-panel', hide);
    if (hide) doc.body.style.setProperty('--uich-dock-w', `${dockWidth}px`);
    else doc.body.style.removeProperty('--uich-dock-w');
    // Always hide overflow-x when in dock-right so the off-screen panel
    // (translateX(100%)) never becomes visible on horizontal scroll.
    try {
      const prev = doc.getElementById('elementor-preview');
      if (prev) prev.style.overflowX = dock === 'right' ? 'hidden' : '';
    } catch (_) { /* noop */ }

    try {
      doc.documentElement.style.overflowX = dock === 'right' ? 'hidden' : '';
    } catch (_) { /* noop */ }

    // Safety guard: Elementor can tear our panel shell out of the DOM on its own
    // (e.g. when a widget is drag-dropped onto the canvas) WITHOUT firing a
    // deselection React would hear — so `hasWidget` stays true and this effect
    // never re-runs to remove the carve. The result was the reserved gutter
    // lingering as an empty grey strip with the panel gone. Watch the document
    // and, the instant no composer panel is connected anymore, drop the carve
    // (class + width var + overflow) so the canvas reclaims full width.
    const findComposerPanel = () => {
      const ids = 'uichemy-composer-floating-panel';
      const tryDoc = (d) => { try { return d && d.getElementById(ids); } catch (_) { return null; } };
      let p = tryDoc(doc) || tryDoc(document);
      try { p = p || tryDoc(window.top && window.top.document); } catch (_) { /* cross-origin */ }
      if (!p) {
        const frames = document.querySelectorAll('iframe');
        for (const f of frames) {
          let d = null;
          try { d = f.contentDocument; } catch (_) { d = null; }
          const hit = tryDoc(d);
          if (hit) { p = hit; break; }
        }
      }
      return p;
    };
    const view = doc.defaultView || window;
    let rafId = 0;
    const clearCarve = () => {
      try {
        doc.body.classList.remove('uich-hide-e-panel');
        doc.body.style.removeProperty('--uich-dock-w');
        const prev = doc.getElementById('elementor-preview');
        if (prev) prev.style.overflowX = '';
        doc.documentElement.style.overflowX = '';
      } catch (_) { /* noop */ }
    };
    const guard = () => {
      rafId = 0;
      if (!doc.body.classList.contains('uich-hide-e-panel')) return;
      const panel = findComposerPanel();
      // The gutter must exist ONLY while the drawer is actually on-screen. Tie it
      // to the panel's real DOM truth, not React's hasWidget: when Elementor tears
      // out / replaces / deactivates / EMPTIES our shell on a widget drag-drop,
      // React may still think a widget is selected, so the reserved grey strip
      // must be reclaimed the moment the panel is not genuinely live. "Live" =
      // connected + `.active` + still has its mounted React content.
      const live = panel
        && panel.isConnected
        && panel.classList.contains('active')
        && !!panel.querySelector('.uich-composer-host');
      if (!live) clearCarve();
    };
    const scheduleGuard = () => { if (!rafId) rafId = view.requestAnimationFrame(guard); };
    const obs = new MutationObserver(scheduleGuard);
    try { obs.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); } catch (_) { /* noop */ }

    return () => {
      try {
        obs.disconnect();
        if (rafId) view.cancelAnimationFrame(rafId);
        clearCarve();
      } catch (_) { /* noop */ }
    };
  }, [dock, panelCollapsed, dockWidth, hasWidget, isFrontend, feEngaged]);

  const elementorYieldRef = React.useRef(false);
  const pendingAutoPanelChangeRef = React.useRef(false);
  const prevPanelCollapsedRef = React.useRef(panelCollapsed);
  React.useEffect(() => {
    const changed = prevPanelCollapsedRef.current !== panelCollapsed;
    prevPanelCollapsedRef.current = panelCollapsed;
    if (changed && !pendingAutoPanelChangeRef.current) {
      elementorYieldRef.current = false;
    }
    pendingAutoPanelChangeRef.current = false;
  }, [panelCollapsed]);

  React.useEffect(() => {
    const doc = document.getElementById('elementor-panel')
      ? document
      : (() => { try { return window.top.document.getElementById('elementor-panel') ? window.top.document : document; } catch (_) { return document; } })();
    if (!doc) return undefined;

    let checkbox = null;
    let label = null;
    let onChange = null;
    let pollId = 0;

    const bind = () => {
      checkbox = doc.getElementById('elementor-mode-switcher-preview-input');
      label = doc.getElementById('elementor-mode-switcher-preview');
      if (!checkbox || !label) return false;
      onChange = () => {
        if (!elementorYieldRef.current) {
          if (dock === 'right' && !panelCollapsed && hasWidget) {
            elementorYieldRef.current = true;
            pendingAutoPanelChangeRef.current = true;
            setPanelCollapsed(true);
            window.setTimeout(() => { if (checkbox.checked) label.click(); }, 0);
          }
          return;
        }
        if (checkbox.checked) {
          elementorYieldRef.current = false;
          pendingAutoPanelChangeRef.current = true;
          setPanelCollapsed(false);
        }
      };
      checkbox.addEventListener('change', onChange);
      return true;
    };

    if (!bind()) {
      // The editor chrome can still be assembling when this first runs.
      pollId = window.setInterval(() => { if (bind()) window.clearInterval(pollId); }, 250);
    }

    return () => {
      if (pollId) window.clearInterval(pollId);
      if (checkbox && onChange) checkbox.removeEventListener('change', onChange);
    };
  }, [dock, panelCollapsed, hasWidget]);

  React.useEffect(() => {
    const doc = document.getElementById('elementor-panel')
      ? document
      : (() => { try { return window.top.document.getElementById('elementor-panel') ? window.top.document : document; } catch (_) { return document; } })();
    if (!doc) return undefined;

    let btn = null;
    let observer = null;
    let pollId = 0;

    const sync = () => {
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      if (pressed) {
        if (!elementorYieldRef.current && dock === 'right' && !panelCollapsed && hasWidget) {
          elementorYieldRef.current = true;
          pendingAutoPanelChangeRef.current = true;
          setPanelCollapsed(true);
        }
      } else if (elementorYieldRef.current) {
        elementorYieldRef.current = false;
        pendingAutoPanelChangeRef.current = true;
        setPanelCollapsed(false);
      }
    };

    const bind = () => {
      btn = doc.querySelector('button[aria-label="Design System"]');
      if (!btn) return false;
      observer = new MutationObserver(sync);
      observer.observe(btn, { attributes: true, attributeFilter: ['aria-pressed'] });
      return true;
    };

    if (!bind()) {
      // The editor chrome can still be assembling when this first runs.
      pollId = window.setInterval(() => { if (bind()) window.clearInterval(pollId); }, 250);
    }

    return () => {
      if (pollId) window.clearInterval(pollId);
      if (observer) observer.disconnect();
    };
  }, [dock, panelCollapsed, hasWidget]);

  // Front-end analogue of the editor's canvas-gutter carve above. The live page
  // has no `#elementor-preview` to shrink, so when the right-dock panel is open
  // we push the PAGE ITSELF in by the panel width via `margin-right` on <body>.
  // That narrows the normal content flow so the panel sits BESIDE the page —
  // exactly like the backend editor shrinks its canvas — instead of covering the
  // content. It eases in lockstep with the drawer's transform (same 0.4s curve)
  // and is fully reversed on collapse/close/unmount.
  React.useEffect(() => {
    if (!isFrontend || typeof document === 'undefined' || !document.body) return undefined;
    const body = document.body;
    body.style.transition = 'margin-right 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
    // On-screen when a widget is being edited OR the panel has been engaged for
    // Chat/Draw (page scope, no widget) — mirrors the `.active` gate so the page
    // is pushed aside (and the pill recentres) in both cases, never leaving the
    // open drawer overlapping the content.
    const open = dock === 'right' && !panelCollapsed && (hasWidget || feEngaged);
    body.style.marginRight = open ? `${dockWidth}px` : '0px';
    // Expose the reserved dock width so the bottom canvas pill can re-centre
    // itself over the canvas (viewport − dock) instead of the whole viewport.
    if (open) body.style.setProperty('--uich-dock-w', `${dockWidth}px`);
    else body.style.removeProperty('--uich-dock-w');
    return () => {
      try {
        body.style.marginRight = ''; body.style.transition = '';
        body.style.removeProperty('--uich-dock-w');
      } catch (_) { /* noop */ }
    };
  }, [isFrontend, dock, panelCollapsed, hasWidget, dockWidth, feEngaged]);

  // Builder stamp for LAYOUT/type scoping, e.g.
  //   body[data-uich-builder="gutenberg"] .uich-composer-host { … }
  // Deliberately separate from the colour skin: the skin is a user toggle
  // (native ⇄ Brand), so rules keyed on it would revert when someone flips
  // colours. Also deliberately NOT part of the drawer-push effect below — that
  // one early-returns for inspector instances, so a stamp set there would never
  // appear when the composer lives only in the Block tab (the common case).
  //
  // Set on the front end too, not just the block editor: the front-end drawer
  // now wears the Gutenberg skin (see usesGutenbergSkin), and this stamp carries
  // the NON-colour half of that look — sentence-case labels instead of SHOUTING
  // caps, the native control radius, etc. Without it the front-end drawer would
  // be blue but still uppercase, i.e. half-converted. The layout rules scoped to
  // this stamp target `.uich-inspector-host` / WordPress sidebar wrappers that
  // simply don't exist on the front end, so they stay inert there.
  // Elementor and Bricks never get the attribute, so they are unaffected.
  React.useEffect(() => {
    if (!usesGutenbergSkin || typeof document === 'undefined' || !document.body) return undefined;
    document.body.dataset.uichBuilder = 'gutenberg';
    // Not cleared on unmount: sibling instances (inspector + drawer) share the
    // stamp, so the first to unmount would otherwise strip it from the other.
    // It is meaningless outside the block editor anyway — the page is gone.
    return undefined;
  }, [usesGutenbergSkin]);

  // ── Gutenberg: push the editor aside instead of covering it ────────────────
  // Third sibling of the Elementor canvas-gutter carve and the front-end page
  // push above. The block editor's entire layout root
  // (`.interface-interface-skeleton`) is itself `position: fixed; right: 0`, so
  // shrinking its right edge by the drawer's width pushes the WHOLE editor —
  // header included — clear of the drawer. Before this, the fixed drawer sat on
  // top of Saved / Publish / the settings toggle, and wp-admin's admin bar
  // (z-index 99999) covered the drawer's own titlebar in return.
  //
  // Split in two effects on purpose: the setup half runs once so the
  // `uich-gb-dock` class and its `right` transition are already live before any
  // width change lands (the classic first-transition gotcha — see the Elementor
  // carve above), and the width half runs per state change. If both shared one
  // effect, every dock/width change would tear the class down and re-add it,
  // which can swallow the animation.
  React.useEffect(() => {
    // Inspector instances live inside WP's own sidebar, which already reserves
    // its own width — pushing the editor as well would double-count it.
    if (isInspector) return undefined;
    if (!isGutenberg || typeof document === 'undefined' || !document.body) return undefined;
    const body = document.body;
    const root = document.documentElement;

    // The drawer must start below the admin bar — but only when there IS one.
    // Fullscreen mode hides the admin bar and the admin menu and moves the
    // skeleton to top: 0. Measuring the skeleton rather than hardcoding 32/46px
    // gets fullscreen toggles and the 782px breakpoint right for free, and
    // survives WordPress changing those values.
    const syncTop = () => {
      let top = 0;
      try {
        const skeleton = document.querySelector('.interface-interface-skeleton');
        if (skeleton) top = Math.max(0, Math.round(skeleton.getBoundingClientRect().top));
      } catch (_) { /* noop */ }
      root.style.setProperty('--uich-gb-dock-top', `${top}px`);
    };

    body.classList.add('uich-gb-dock');
    syncTop();
    // Flush layout so the browser adopts the transition BEFORE the width var
    // changes, otherwise the first open applies both in one recalc and skips
    // the animation.
    try { void body.offsetWidth; } catch (_) { /* noop */ }

    window.addEventListener('resize', syncTop);
    // Toggling fullscreen mode swaps `is-fullscreen-mode` on <body>, which moves
    // the skeleton's top edge without firing a resize event.
    const obs = new MutationObserver(syncTop);
    try { obs.observe(body, { attributes: true, attributeFilter: ['class'] }); } catch (_) { /* noop */ }

    return () => {
      try {
        window.removeEventListener('resize', syncTop);
        obs.disconnect();
        body.classList.remove('uich-gb-dock', 'uich-gb-dock-resizing');
        root.style.removeProperty('--uich-gb-dock-w');
        root.style.removeProperty('--uich-gb-dock-top');
      } catch (_) { /* noop */ }
    };
  }, [isGutenberg, isInspector]);

  React.useEffect(() => {
    if (isInspector) return;
    if (!isGutenberg || typeof document === 'undefined') return;
    // Reserve the strip ONLY while the drawer is genuinely on-screen: right dock
    // + open + a block being edited. Collapsed (`uich-dock-slid`, fully
    // off-screen) or no block ⇒ 0, and the editor eases back to full width.
    const open = dock === 'right' && !panelCollapsed && hasWidget;
    try {
      document.documentElement.style.setProperty('--uich-gb-dock-w', open ? `${dockWidth}px` : '0px');
    } catch (_) { /* noop */ }
  }, [isGutenberg, isInspector, dock, panelCollapsed, hasWidget, dockWidth]);

  // ── Bricks: push the builder aside instead of covering it ──────────────────
  // Bricks' equivalent of the Gutenberg push above. The builder is a flex row
  // `.brx-body.main` holding `#bricks-panel` (left) · `#bricks-preview` (canvas,
  // flexes to fill) · `#bricks-structure` (right), with a separate fixed
  // full-width `#bricks-toolbar` on top. Neither is `position: fixed; right: 0`
  // like the block-editor skeleton, so we can't shrink one root — instead the
  // CSS (composer-dock.css) insets BOTH the flex row and the toolbar from the
  // right with `padding-right: var(--uich-bricks-dock-w)` (box-sizing:
  // border-box). That reflows the flex children into the reduced content box —
  // the canvas shrinks, panel + structure stay put — and slides the toolbar's
  // right-hand Save/settings buttons clear of the drawer, so the whole builder
  // sits BESIDE it instead of underneath. Width can't be used here: both
  // elements carry `margin: 0 auto`, so a narrower width would CENTRE them and
  // overlap the drawer on the right by half the reserved strip.
  //
  // Split setup (add class once) / width (per state) for the same first-frame
  // transition reason as the Gutenberg pair above.
  React.useEffect(() => {
    if (isInspector) return undefined;
    if (!isBricks || typeof document === 'undefined' || !document.body) return undefined;
    const body = document.body;
    body.classList.add('uich-bricks-dock');
    // Flush layout so the width transition is live before the var first changes.
    try { void body.offsetWidth; } catch (_) { /* noop */ }
    return () => {
      try {
        body.classList.remove('uich-bricks-dock', 'uich-bricks-dock-resizing');
        document.documentElement.style.removeProperty('--uich-bricks-dock-w');
      } catch (_) { /* noop */ }
    };
  }, [isBricks, isInspector]);

  React.useEffect(() => {
    if (isInspector) return;
    if (!isBricks || typeof document === 'undefined') return;
    // Reserve the strip ONLY while the drawer is genuinely on-screen: right dock
    // + open + a widget being edited. Collapsed or no widget ⇒ 0, and the
    // builder eases back to full width.
    const open = dock === 'right' && !panelCollapsed && hasWidget;
    try {
      document.documentElement.style.setProperty('--uich-bricks-dock-w', open ? `${dockWidth}px` : '0px');
    } catch (_) { /* noop */ }
  }, [isBricks, isInspector, dock, panelCollapsed, hasWidget, dockWidth]);

  // Native pointer-based resize. We attach the listener directly on the
  // handle element (not via React's onMouseDown) because the panel lives
  // inside Elementor's preview iframe and an Elementor capture listener
  // would otherwise swallow React's synthetic event before it reaches us.
  React.useEffect(() => {
    const handle = resizeHandleRef.current;
    if (!handle) return undefined;

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startScreenY = typeof e.screenY === 'number' ? e.screenY : 0;
      const startScreenX = typeof e.screenX === 'number' ? e.screenX : 0;
      const startH = heightRef.current;
      const startW = dockWidthRef.current;
      const dragDock = dockRef.current;
      const handleDoc = handle.ownerDocument || document;
      const iframeWin = handleDoc.defaultView || window;
      let topWin = null;
      try {
        if (iframeWin.parent && iframeWin.parent !== iframeWin) {
          topWin = iframeWin.parent;
          // Probe — throws on cross-origin so we fall back to iframe-only.
          // eslint-disable-next-line no-unused-vars
          const _ = topWin.document;
        }
      } catch (_) { topWin = null; }

      // Right-dock width drag changes the canvas gutter (`padding-right`) each
      // frame. That padding normally eases (0.5s) so open/close feels like
      // Elementor's panel — but during a drag that easing would make the canvas
      // lag the handle. Flag the preview as resizing so the transition is
      // suppressed and the gutter tracks the pointer 1:1 (removed on pointerup).
      const previewEl = dragDock === 'right'
        ? (() => { try { return (topWin ? topWin.document : handleDoc).getElementById('elementor-preview'); } catch (_) { return null; } })()
        : null;
      if (previewEl) previewEl.classList.add('uich-dock-resizing');

      // Gutenberg equivalent: its editor push eases over the same 0.4s, which
      // during a drag would leave the editor edge trailing the handle. Flag the
      // body so composer-dock.css drops the easing for the duration.
      const gbBody = dragDock === 'right'
        ? (() => { try { return (topWin ? topWin.document : handleDoc).body; } catch (_) { return null; } })()
        : null;
      const gbDocked = !!gbBody && gbBody.classList.contains('uich-gb-dock');
      if (gbDocked) gbBody.classList.add('uich-gb-dock-resizing');

      // Bricks equivalent: its builder push (`.brx-body.main` + `#bricks-toolbar`
      // width) eases over the same 0.4s, so suppress it mid-drag too.
      const brDocked = !!gbBody && gbBody.classList.contains('uich-bricks-dock');
      if (brDocked) gbBody.classList.add('uich-bricks-dock-resizing');

      let captured = false;
      const pointerId = e.pointerId;
      if (pointerId !== undefined && typeof handle.setPointerCapture === 'function') {
        try { handle.setPointerCapture(pointerId); captured = true; } catch (_) { }
      }

      function onMove(ev) {
        if (dragDock === 'right') {
          const screenX = typeof ev.screenX === 'number' ? ev.screenX : 0;
          const dx = startScreenX - screenX; // dragging left grows the panel
          const nw = Math.min(DOCK_MAX, Math.max(DOCK_MIN, startW + dx));
          setDockWidth(nw);
          return;
        }
        const screenY = typeof ev.screenY === 'number' ? ev.screenY : 0;
        const dy = startScreenY - screenY;
        const nh = Math.min(900, Math.max(160, startH + dy));
        setHeight(nh);
      }
      function onUp() {
        if (captured) {
          try { handle.releasePointerCapture(pointerId); } catch (_) { }
        }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
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
        // Re-enable the gutter easing once the drag ends.
        if (previewEl) previewEl.classList.remove('uich-dock-resizing');
        if (gbDocked) gbBody.classList.remove('uich-gb-dock-resizing');
        if (brDocked) gbBody.classList.remove('uich-bricks-dock-resizing');
      }

      // Pointer capture on the handle covers cursor leaving the handle but
      // staying in the same document; window-level listeners cover the
      // cursor leaving the iframe entirely.
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
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
    }

    handle.addEventListener('pointerdown', onPointerDown);
    return () => handle.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // Native pointer-based resize for layers panel width.
  React.useEffect(() => {
    const handle = layersResizeHandleRef.current;
    if (!handle) return undefined;

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startScreenX = typeof e.screenX === 'number' ? e.screenX : 0;
      const startW = layersWidthRef.current;
      const handleDoc = handle.ownerDocument || document;
      const iframeWin = handleDoc.defaultView || window;
      let topWin = null;
      try {
        if (iframeWin.parent && iframeWin.parent !== iframeWin) {
          topWin = iframeWin.parent;
          const _ = topWin.document;
        }
      } catch (_) { topWin = null; }

      let captured = false;
      const pointerId = e.pointerId;
      if (pointerId !== undefined && typeof handle.setPointerCapture === 'function') {
        try { handle.setPointerCapture(pointerId); captured = true; } catch (_) { }
      }

      function onMove(ev) {
        const screenX = typeof ev.screenX === 'number' ? ev.screenX : 0;
        const dx = screenX - startScreenX;
        const nw = Math.min(600, Math.max(220, startW + dx));
        setLayersWidth(nw);
      }
      function onUp() {
        if (captured) {
          try { handle.releasePointerCapture(pointerId); } catch (_) { }
        }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
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

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
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
    }

    handle.addEventListener('pointerdown', onPointerDown);
    return () => handle.removeEventListener('pointerdown', onPointerDown);
  }, [tab, panelCollapsed]);

  // ── Canvas toolbar host: create/remove a themed host in the preview root ────
  React.useEffect(() => {
    if (!toolbarActive) { setToolbarEl(null); return undefined; }
    const outer = getOuterPanel();
    let parent = outer && outer.parentNode;
    // Inspector surface (Gutenberg): there is no drawer shell, so getOuterPanel()
    // is null and the pill would never mount. Fall back to the top-document body.
    // The host is a full-viewport passthrough layer whose FAB self-positions, so
    // body is a fine anchor. Guard against a SECOND toolbar when a drawer instance
    // is also live and already mounted one (both surfaces can co-exist).
    if (!parent && typeof document !== 'undefined' && document.body
      && !document.getElementById('uich-composer-canvas-toolbar')) {
      parent = document.body;
    }
    if (!parent) return undefined;
    const doc = parent.ownerDocument || document;
    const el = doc.createElement('div');
    el.id = 'uich-composer-canvas-toolbar';
    el.className = 'uich-composer-host uich-tw uich-canvas-toolbar-host';
    // On the live page the panel is position:fixed to the viewport; the pill
    // must be too, or absolute positioning drops it to the document bottom.
    if (isFrontend) el.classList.add('is-frontend');
    parent.appendChild(el);
    setToolbarEl(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
      setToolbarEl(null);
    };
  }, [toolbarActive]);

  // Keep the toolbar host theme- and skin-synced.
  React.useEffect(() => {
    if (!toolbarEl) return;
    toolbarEl.dataset.theme = theme;
    toolbarEl.dataset.uichComposerTheme = theme;
    toolbarEl.style.colorScheme = theme;
    toolbarEl.classList.toggle('dark', theme === 'dark');
    toolbarEl.classList.toggle('skin-elementor', skin === 'elementor');
    toolbarEl.classList.toggle('skin-gutenberg', skin === 'gutenberg');
    if (skin === 'brand') delete toolbarEl.dataset.uichComposerSkin;
    else toolbarEl.dataset.uichComposerSkin = skin;
  }, [toolbarEl, theme, skin]);

  // The toolbar host is now a full-viewport passthrough layer (pointer-events:
  // none) — the radial FAB inside it self-positions and is freely draggable, so
  // there is no host positioning to drive here anymore.

  // Design / Developer switch — shared by both docks (bottom toolbar + right
  // titlebar) so the two stay identical, and by every builder so the control never
  // depends on which editor you happen to be in.
  //
  // Two segments in a pill, each an icon plus a label, and the LABEL SHOWS ONLY ON
  // THE ACTIVE SEGMENT — the inactive one collapses to its icon. That keeps the
  // control narrow enough to ride the end of the Chat/Editor/Code row while still
  // naming the mode you are in.
  //
  // This is the original control (49a6dc3), restored. 58c6db4 replaced it with a
  // Simple ⇄ Pro slider for every builder except Gutenberg, which both lost the
  // icons and put the word "Pro" a couple of centimetres from the Chat PRO pill,
  // where it means the paid tier rather than an editing mode.
  //
  // The internal state values stay 'simple' / 'pro': they are persisted per-builder
  // and read in a dozen places, so renaming them would reset saved preferences for
  // a purely cosmetic gain.
  /* Design / Developer as LINE tabs (underline) rather than the filled
     segmented pill it used to be. Two consequences worth noting:

     · Both labels are always visible now. The pill hid the inactive one to save
       width, which left a lone icon carrying the meaning — that reads fine on a
       filled chip but not under an underline, where the label IS the tab.
     · Radix Tabs replaces the hand-rolled role=group + aria-pressed pair. It
       brings arrow-key navigation and the correct tab/tablist roles, which the
       two buttons never had. There are no TabsContent panels: the panel body is
       rendered elsewhere off `mode`, and a TabsList on its own is valid. */
  const modeSwitch = (
    <Tabs value={mode} onValueChange={(v) => v && setMode(v)}>
      <TabsList variant="line" className="mode-switch h-auto gap-3" aria-label="Editing mode">
        {/* Labels only. The glyphs cost ~30px in a row that also carries
            Attributes and Mark as, which was enough to wrap Mark as onto a line
            of its own; the words already say what these are. */}
        <TabsTrigger
          value="simple"
          title="Design: visual editing for clients"
          className="text-xs font-semibold"
        >Design</TabsTrigger>
        <TabsTrigger
          value="pro"
          title="Developer: full classes, code and scopes"
          className="text-xs font-semibold"
        >Developer</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  // Layers are ONLY ever shown as the movable floating navigator — never docked
  // inline inside the composer panel (per the user's request). `layersHidden`
  // is the single on/off; floating is implied.
  // The panel only renders while a Composer widget is actually selected: the
  // navigator shows that widget's structure, so once the widget is deleted (or
  // deselected) there is nothing to show and the popup must disappear instead of
  // lingering with a stale tree. `layersVisible` still tracks the user's own
  // on/off preference so re-selecting a widget re-opens the panel they left on.
  const layersVisible = !layersHidden;
  const floatLayersShown = layersVisible && hasWidget;

  // Layers toggle — opens/closes the movable floating layers panel. The button
  // now lives in the bottom canvas toolbar (composer-toolbar.jsx, wired via
  // tbProps below); this is just the shared handler it calls. Always the floating
  // panel; toggle its visibility.
  const onToggleLayers = () => {
    setLayersFloating(true);
    // Layers button: if the popup is already open ON the Layers tab, close it;
    // otherwise open it on Layers (switching from History counts as "open").
    if (!layersHidden && popupTab === 'layers') {
      setLayersHidden(true);
    } else {
      setPopupTab('layers');
      setLayersHidden(false);
    }
  };
  const onToggleHistory = () => {
    setLayersFloating(true);
    if (!layersHidden && popupTab === 'history') {
      setLayersHidden(true);
    } else {
      setPopupTab('history');
      setLayersHidden(false);
    }
  };

  // Shared Layers-tree props — the tree renders inline (bottom dock) or in the
  // portaled left dock (Developer + right dock), never both at once.
  const layersPaneProps = {
    entries: layerEntries,
    selectedId: selectedLayerId,
    onSelect: setSelectedLayerId,
    onMoveLayer,
    onCopy: onLayerCopy,
    onCut: onLayerCut,
    onPaste: onLayerPaste,
    onDelete: onLayerDelete,
    onDuplicate: onLayerDuplicate,
    onAddLayer,
    hasClipboard,
    picking,
    onTogglePick: () => setPicking((p) => !p),
    onMark: onMarkConstruct,
    onMarkLayer,
    onPickIntent: onPickConstruct,
    onRemoveDyn,
    hasSelection: !!selectedEntry,
    hasWidget,
  };

  return (
    <section ref={panelRef} className={`panel${dock === 'right' ? ' dock-right' : ''}${tab === 'chat' ? ' tab-chat' : ''}`}>
      {previewMenu && ReactDOM.createPortal(
        <div
          className="z-[2147483646] min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ position: 'fixed', left: previewMenu.x, top: previewMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {[
            'mark-as',
            'sep',
            { icon: <T.duplicate size={12} />, label: 'Duplicate', kbd: '⌘D', onClick: () => onLayerDuplicate(previewMenu.id) },
            { icon: <T.copy size={12} />, label: 'Copy', kbd: '⌘C', onClick: () => onLayerCopy(previewMenu.id) },
            { icon: <T.scissors size={12} />, label: 'Cut', kbd: '⌘X', onClick: () => onLayerCut(previewMenu.id) },
            { icon: <T.clipboard size={12} />, label: 'Paste', kbd: '⌘V', disabled: !hasClipboard, onClick: () => hasClipboard && onLayerPaste(previewMenu.id, 'before') },
            'sep',
            { icon: <T.trash size={12} />, label: 'Delete', kbd: '⌫', danger: true, onClick: () => onLayerDelete(previewMenu.id) },
          ].map((item, i) => item === 'sep' ? (
            <div key={`sep-${i}`} className="-mx-1 my-1 h-px bg-border" />
          ) : item === 'mark-as' ? (
            <React.Fragment key="mark-as">
              <button
                type="button"
                className="relative flex w-full cursor-default select-none items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent hover:bg-accent hover:text-accent-foreground"
                onClick={() => setMarkSubOpen(v => !v)}
              >
                <span className="flex items-center gap-2"><T.dynamic size={12} /> Mark as</span>
                <svg style={{ transform: markSubOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,18 15,12 9,6" /></svg>
              </button>
              {markSubOpen && [
                { label: 'Mark as loop', type: 'loop' },
                { label: 'Mark as form', type: 'form' },
              ].map(sub => (
                <button
                  key={sub.type}
                  type="button"
                  className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-6 pr-2 text-sm outline-none transition-colors focus:bg-accent hover:bg-accent hover:text-accent-foreground"
                  onClick={() => { onMarkLayer(previewMenu.id, sub.type); setPreviewMenu(null); setMarkSubOpen(false); }}
                >
                  <T.dynamic size={12} /> {sub.label}
                </button>
              ))}
            </React.Fragment>
          ) : (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              className={cn(
                'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
                item.danger && 'text-destructive hover:text-destructive focus:text-destructive'
              )}
              onClick={() => { item.onClick(); setPreviewMenu(null); }}
            >
              {item.icon} {item.label}
              {item.kbd && <span className="ml-auto text-xs tracking-widest text-muted-foreground">{item.kbd}</span>}
            </button>
          ))}
        </div>,
        ensurePortalRoot(document, theme, skin),
      )}
      <div
        ref={resizeHandleRef}
        className="panel-resize"
        role="separator"
        aria-orientation={dock === 'right' ? 'vertical' : 'horizontal'}
        aria-label="Resize panel"
        title="Drag to resize"
      ></div>
      {dock === 'right' && (
        <button
          type="button"
          className={`dock-edge-toggle${panelCollapsed ? ' closed' : ''}`}
          title={panelCollapsed ? 'Open panel' : 'Hide panel'}
          aria-label={panelCollapsed ? 'Open panel' : 'Hide panel'}
          onClick={() => setPanelCollapsed((c) => !c)}
        >
          <span className="chev">
            {/* Elementor eicon-chevron glyph (filled). Rendered pointing DOWN by
                default so the existing .chev rotate(-90deg)/rotate(90deg) logic
                keeps producing right (open) / left (closed) exactly as before. */}
            <svg width="12" height="12" viewBox="0 0 1000 1000" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <g transform="rotate(90 500 500) translate(0 850) scale(1 -1)">
                <path d="M696 317c12 12 17 29 17 46 0 16-5 33-17 41l-296 300c-12 13-25 21-46 21-16 0-29-4-41-17-13-12-21-29-21-45 0-17 4-34 16-46l255-259-259-279c-12-12-16-29-16-46 0-16 8-33 20-46 13-8 30-12 46-12 17 0 34 8 46 21l296 321z" />
              </g>
            </svg>
          </span>
        </button>
      )}

      {/* Top bar holds the Design/Developer switch (+ dock/skin/theme in the
          bottom dock). When the dashboard locks a mode (forcedMode) AND we're in
          the right dock, nothing here renders, so the bar is pure empty space
          above the Chat/Editor/Code strip — collapse it entirely in that case. */}
      {/* Option B header: in the right dock this top bar collapses entirely, so
          the panel opens with the Chat/Editor tabs and nothing above them. It
          previously cost 57px for a brand mark and the Design/Developer switch.
          The switch is not lost — it re-renders at the top of the Editor body
          below, which is the only surface it affects (it gates the Code tab and
          the class/scope UI; Chat ignores it). The bottom dock is untouched: it
          still uses this bar for the dock/skin/theme controls. */}
      <div
        className="panel-tabs"
        style={(dock === 'right' || forcedMode) ? { display: 'none' } : undefined}
      >
        <div className="panel-brand">
          {brandLogo ? (
            /* White Label: the uploaded brand logo replaces our mark. `brandLogo`
               is empty unless white-labeling is on AND a logo was set, so an
               unbranded site keeps the inline SVG below. */
            <img src={brandLogo} alt={brandName} width="24" height="24" style={{ borderRadius: '4px', display: 'block', objectFit: 'contain' }} />
          ) : (
            <svg width="24" height="24" style={{ borderRadius: '4px' }} viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="400" height="400" fill="#4B22CC" />
              <path d="M223.001 261.203C223.001 261.203 176.796 263.816 176.796 228.857V139.714C176.796 131.215 175.093 122.799 171.782 114.947C168.472 107.094 163.62 99.9598 157.503 93.9503C151.386 87.9409 144.125 83.1744 136.133 79.9228C128.142 76.6713 119.576 74.9985 110.927 75H75V252.676C75 271.766 82.7175 290.074 96.4548 303.573C110.192 317.071 128.824 324.655 148.251 324.655H148.352C153.322 325.115 158.325 325.115 163.296 324.655H250.78C270.464 324.655 289.343 316.971 303.262 303.294C317.181 289.617 325 271.066 325 251.724V207.518H223.238L223.001 261.203ZM232.016 216.144H316.142V251.669C316.116 268.695 309.221 285.016 296.968 297.055C284.716 309.094 268.107 315.869 250.78 315.896H209.331C213.748 312.416 217.615 308.311 220.803 303.715C230.63 289.452 231.892 273.495 231.892 261.214L232.016 216.144Z" fill="white" />
              <path d="M282.425 75C266.714 75 251.647 81.1317 240.537 92.0465C229.427 102.961 223.184 117.766 223.181 133.203V168.107H324.978V75H282.425Z" fill="white" />
            </svg>
          )}
        </div>
        {/* Editor / Chat / Code tabs live in their own full-width row directly
            below this bar (see .panel-tabs-strip); the top bar keeps just the
            navigator icon + Design/Developer switcher. */}
        <div className="tab-tools">
          {/* Just the Design/Developer switch now (hidden when the dashboard locks
              a mode). Layers moved to the bottom canvas toolbar, and the chat
              History button lives inside the Chat tab's own status bar — so in a
              locked mode this row is empty rather than holding one lone control. */}
          <div className="mr-2 inline-flex items-center gap-1">{!forcedMode && modeSwitch}</div>
          {dock !== 'right' && (<>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title="Dock panel to the right side"
              aria-label="Dock panel to the right side"
              onClick={() => setDock('right')}
            >
              <T.dockRight size={14} />
            </Button>
            {/* Skin + theme buttons removed here too, not just from the right
                dock. Leaving them would give appearance two sources of truth —
                a click here would silently override the Settings choice. Both
                now live only in Dashboard → Settings → Composer appearance. */}
          </>)}
          {/* <button className="panel-icon-btn" title="More"><T.more /></button> */}
        </div>
        {/* Window controls — bottom dock only; the right dock uses the edge
            drawer toggle instead of collapse/close. */}
        {dock !== 'right' && (
          <div className="tab-winctl">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title={panelCollapsed ? 'Expand panel' : 'Collapse panel'} onClick={() => setPanelCollapsed(c => !c)}>
              {panelCollapsed ? <T.caretUp /> : <T.caretDown />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title="Close panel"
              onClick={() => {
                const bridge = typeof window !== 'undefined' ? window.UichUiChemyComposerEditor : null;
                if (bridge && typeof bridge.hideFloatingPanel === 'function') {
                  bridge.hideFloatingPanel();
                }
              }}
            >
              <T.x />
            </Button>
          </div>
        )}
      </div>

      {/* Primary Editor / Chat / Code navigation — a full-width row directly
          below the Design/Developer switcher bar. Always mounted (outside the
          !panelCollapsed guard) so tab switching keeps working while the panel
          is collapsed. Elementor-style stacked icon+label.

          The active tab is marked by ONE pill on the track that slides between
          tabs, rather than a chip appearing on one tab as it vanishes from
          another. `seg-slide` + useSlidingSeg is the same mechanism every other
          segmented control in the composer uses; each tab below carries
          data-state so the hook can find the active one. */}
      <div ref={toolTabsRef} className="panel-tabs panel-tabs-strip seg-slide">
        {/* Label and badge come from whatever this build registered. In Free the
            tab stays visible but carries a PRO pill — opening it shows the upsell
            card, which is the whole point: a hidden feature sells nothing. */}
        {/* Two gates: the Role Manager must allow AI chat for this role, and the
            build must ship a Chat tab. In Free that tab is the upsell card. */}
        {canAiChat && chatSlot && (
          <button data-state={tab === 'chat' ? 'active' : 'inactive'} className={`panel-tab${tab === 'chat' ? ' active' : ''}`} onClick={() => { setTab('chat'); setPanelCollapsed(false); }}>
            <T.sparkles size={16} />
            <span>
              {chatSlot.label || 'Chat'}{' '}
              {chatLocked || chatSlot.pro
                ? <ProBadge small />
                : (chatSlot.badge ? <span className="badge">{chatSlot.badge}</span> : null)}
            </span>
          </button>
        )}
        <button data-state={tab === 'direct' ? 'active' : 'inactive'} className={`panel-tab${tab === 'direct' ? ' active' : ''}`} onClick={() => { setTab('direct'); setPanelCollapsed(false); }}>
          <T.pencil size={16} />
          <span>Editor</span>
        </button>
        {/* Developer-only, and hidden entirely for content-only roles — raw code is
            a design/structure surface the Role Manager can withhold. */}
        {uiMode !== 'simple' && !access.contentOnly && (
          <button data-state={tab === 'code' ? 'active' : 'inactive'} className={`panel-tab${tab === 'code' ? ' active' : ''}`} onClick={() => { setTab('code'); setPanelCollapsed(false); }}>
            <T.code size={16} />
            <span>Code</span>
          </button>
        )}
      </div>

      {/* Shared Pro-upsell modal — fired from any Free limit check (Globals
          collection/class caps, the canvas Draw / Ask-AI buttons, the Loop
          source select). Without this host mounted those calls no-op silently. */}
      <ProUpsellHost />

      {/* The skin + theme toggles used to float in the dock's bottom-right
          corner. They are set-once preferences, not per-edit controls, so they
          moved to Dashboard → Settings → Composer appearance, which writes the
          same localStorage keys this component reads (`uich-composer-skin*` /
          `uich-composer-theme*`). Nothing else changes: the state, the storage
          and the applySkin/applyTheme effects here are untouched. */}

      {/* ChatSessionProvider wraps everything so queue state survives panel
          collapse and tab switches. ChatTab is always mounted (outside the
          !panelCollapsed guard) so the WS session and in-flight tasks keep
          running even when the panel is collapsed or the user switches tabs.
          display:contents makes the wrapper div layout-transparent so
          .chat2-wrap behaves exactly as a direct child of the panel section. */}
      <PortalContainerProvider container={portalRoot}>
        <ChatSession>
          <>
            {/* The Inspector stays MOUNTED whatever the panel is doing, and is
                  only hidden — the same approach the Chat tab takes above. It owns
                  the cascade/scope helpers the on-canvas toolbar renders with, so
                  unmounting it on collapse took the toolbar's controls down with
                  it: selecting an element with the panel shut left nothing but the
                  drag grip. That is the only reason this sits outside the
                  !panelCollapsed guard. */}
            <div
              className="panel-body"
              // Layers only ever float, so the body is always a single column —
              // the Inspector fills it; no inline layers row/column to reserve.
              style={(!panelCollapsed && tab === 'direct')
                ? (dock === 'right'
                  ? { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
                  : { gridTemplateColumns: '1fr' })
                : { display: 'none' }}
            >
              {/* The Design/Developer switch, re-homed from the collapsed top
                      bar. It belongs here: it gates the Code tab and the
                      class/scope surfaces, all of which are Editor concerns.
                      Right dock only — the bottom dock still shows it up top.

                      Both the switch and the Inspector sit inside ONE wrapper so
                      the body stays a single-child grid. `.panel-body` is
                      `grid-template-rows: 1fr`, sized for one child; adding a
                      second made the 1fr row stretch the switch to 147px for a
                      32px control. A flex column inside the single cell keeps the
                      switch at its natural height and gives the Inspector the
                      rest. */}
              <div className="panel-editor-stack">
                <ComposerErrorBoundary label="Inspector">
                  <Inspector
                    modeSwitch={dock === 'right' && !forcedMode ? modeSwitch : null}
                    mode={uiMode}
                    dock={dock}
                    theme={theme}
                    element={element}
                    setElement={setElement}
                    scopes={scopes}
                    setScopes={setScopes}
                    activeScope={activeScope}
                    setActiveScope={setActiveScope}
                    state={stateName} setState={setStateName}
                    device={device} setDevice={setDevice} breakpoints={breakpoints}
                    activeMediaQuery={activeMediaQuery}
                    baseParsedScopes={baseParsedScopes}
                    parsedScopesByBpKey={parsedScopesByBpKey}
                    selectedEntry={selectedEntry}
                    onMark={onMarkConstruct}
                    rawHtml={rawHtml}
                    rawCss={rawCss}
                    anchorLink={anchorLink}
                    onAnchorLinkChange={onAnchorLinkChange}
                    anchorLinkDisabled={anchorLinkDynamic}
                    onSvgUrlChange={onSvgUrlChange}
                    inlineScope={localScope}
                    localScopeNeedsClass={localScopeNeedsClass}
                    onPromoteLocalToBreakpointClass={promoteLocalToBreakpointClass}
                    constructSlot={constructType ? (
                      <ConstructAccordion
                        key={selectedLayerId + ':' + constructType}
                        constructType={constructType}
                        selectedEntry={selectedEntry}
                        rawHtml={rawHtml}
                        onWriteHtml={writeHtml}
                        onRemove={onRemoveCurrentConstruct}
                      />
                    ) : null}
                  />
                </ComposerErrorBoundary>
              </div>
            </div>
            {!panelCollapsed && tab === 'code' && (
              <ComposerErrorBoundary label="Code editor">
                <CodeTab initialScope={preset.codeScope} mode={uiMode} />
              </ComposerErrorBoundary>
            )}
          </>
          {chatSlot && (
            <div style={{ display: (!panelCollapsed && tab === 'chat') ? 'contents' : 'none' }}>
              <ComposerErrorBoundary label="Chat">
                <chatSlot.Tab initialScenario={preset.chatScenario} isActiveTab={!panelCollapsed && tab === 'chat'} mode={uiMode} />
              </ComposerErrorBoundary>
            </div>
          )}
        </ChatSession>
      </PortalContainerProvider>

      {/* Movable "Navigator" — the Layers tree floating over the editor. This is
          the ONLY way layers are shown (never docked inline). "Close" hides it.
          Available in every tab and both modes. */}
      {floatLayersShown && (
        <FloatingLayers
          paneProps={layersPaneProps}
          onClose={() => setLayersHidden(true)}
          canDock={false}
          portalDoc={(panelRef.current && panelRef.current.ownerDocument) || (typeof document !== 'undefined' ? document : null)}
          theme={theme}
          tab={popupTab}
          onSelectTab={setPopupTab}
          historyContent={(() => {
            void historyTick; // re-read on record/undo/redo
            // Whole-page timeline: EVERY edited element + page + site code, newest
            // first. Each row is tagged with which element it belongs to. Any row is
            // restorable — clicking one applies straight to that element by id (no
            // need to select it first), same path global undo uses.
            const special = { [PAGE_SCOPE]: 'Page', [SITE_SCOPE]: 'Site' };
            const rows = [];
            listScopes().forEach((key) => {
              if (!key) return;
              const isWidget = key !== PAGE_SCOPE && key !== SITE_SCOPE;
              const h = getHistory(key);
              (h.entries || []).forEach((e) => rows.push({
                ...e,
                scope: key,
                scopeTag: isWidget ? (e.wlabel || 'Element') : special[key],
                restorable: true,
              }));
            });
            rows.sort((a, b) => (b.time || 0) - (a.time || 0));
            return <HistoryList entries={rows} onJump={(scope, idx) => doJumpHistory(scope, idx)} />;
          })()}
        />
      )}
      {toolbarEl && ReactDOM.createPortal(
        (() => {
          // Shared props for both toolbar copies (bottom-centre + left-centre).
          const tbProps = {
            isFrontend,
            // Frontend, no widget loaded yet: the FAB's only job is picking a
            // whole widget, regardless of which tab happens to be open in the
            // background — the default tab is 'chat', so gating on 'direct'
            // would silently fall back to the fan-out on the very first click.
            // Once a widget IS loaded, gate on the Editor tab as before so
            // inner-element picking never engages while on Chat/Code.
            directPick: isFrontend ? (hasWidget ? tab === 'direct' : true) : tab === 'direct',
            picking: chatPickOwnsCanvas
              ? chatPicking
              : (isFrontend ? (hasWidget ? picking : fePicking) : picking),
            onTogglePick: onToolbarPick,
            outlineOn,
            onToggleOutline: () => setOutlineOn((v) => !v),
            // Layers, moved here from the panel titlebar.
            // `floatLayersShown`, not `layersVisible`: the first is what is
            // actually on screen (it also requires a selected widget), the
            // second is only the user's remembered preference. Wired to the
            // preference, the button stayed lit after the widget was
            // deselected — pressed state showing with no panel open.
            layersOn: floatLayersShown && popupTab === 'layers',
            onToggleLayers,
            // History panel toggle. Undo/Redo are keyboard-only (Ctrl+Z / Ctrl+Shift+Z).
            historyOn: floatLayersShown && popupTab === 'history',
            onToggleHistory,
            // Free: both of these are doors into AI chat, so they carry a PRO dot
            // and open the upsell modal where the user clicked — better than
            // switching them to a tab that just says "locked".
            proLocked: chatLocked,
            drawActive,
            onDraw: () => {
              if (chatLocked) {
                showDrawUpsell();
                return;
              }
              // Draw sends the annotated canvas to the AI chat, so surface the
              // Chat tab, then fire the event ChatTab listens for to enter draw
              // mode (it hides the panel itself while drawing).
              setTab('chat'); setPanelCollapsed(false);
              try { window.dispatchEvent(new CustomEvent('uichemy:composer:start-draw')); } catch (_) { /* older browsers */ }
            },
            // Chat is a toggle like the other tools: it lights up while Chat is
            // the tab you are actually looking at, and clicking it again hands
            // the panel back to the Editor tab. Un-selecting deliberately does
            // NOT collapse the panel — on the Gutenberg inspector there is no
            // drawer of ours to collapse, and driving WordPress's own sidebar
            // remounts the inspector (which duplicated the whole editor once
            // already). Returning to the Editor tab un-selects the same way on
            // every surface.
            chatOpen: !panelCollapsed && tab === 'chat',
            onOpenChat: () => {
              if (chatLocked) {
                showChatUpsell();
                return;
              }
              if (!panelCollapsed && tab === 'chat') { setTab('direct'); return; }
              setTab('chat'); setPanelCollapsed(false);
            },
            panelCollapsed,
            onToggleCollapse: onTogglePanel,
          };
          return <CanvasToolbarContent {...tbProps} />;
        })(),
        toolbarEl
      )}
    </section>
  );
}
