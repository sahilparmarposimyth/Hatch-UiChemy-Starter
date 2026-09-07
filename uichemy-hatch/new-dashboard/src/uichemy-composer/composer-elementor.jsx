// Elementor bridge, exposes the currently-edited UiChemy Composer widget's
// Backbone settings model to React via a small store, and provides hooks
// for two-way binding to a single setting key.
import React from 'react';
import {
  SLOT_COUNT,
  EMPTY_LINK,
  normalizeMediaValue,
  normalizeLinkValue,
  applyLinkToAnchor,
  anchorWrapsSlotContent,
  extractSlotTextNodes,
  getSlotKind,
  applySlotSettingsToNode,
  syncSlotSettingsFromNode,
  syncPanelControl,
  syncPanelLinkControls,
  computeBgSlotWrite,
  syncBgSlotSettingsFromCss,
} from './composer-slots';

// Every Elementor widget type that IS the Composer widget, current name first.
// Mirrors uichemy_composer_widget_types() in
// uichemy-composer/includes/admin/widgets/composer-widget-types.php — READS match
// all of them so a not-yet-migrated widget is never silently skipped; WRITES use
// COMPOSER_WIDGET_TYPE only.
const COMPOSER_WIDGET_TYPE = 'uichemy-composer';
const COMPOSER_WIDGET_TYPES = [COMPOSER_WIDGET_TYPE, 'composer', 'proton', 'uichemy-builder'];
const isComposerWidgetType = (t) => COMPOSER_WIDGET_TYPES.indexOf(t) !== -1;

const HIDE_HOOKS = [
  'panel/open_editor/elements',
  'panel/open_editor/page_settings',
  'panel/open_editor/section',
  'panel/open_editor/column',
  'panel/open_editor/container',
];

const store = {
  listeners: new Set(),
  current: null, // { panel, model, view, settings } | null
  _modelOff: null, // unbinds the active model's removal listeners
  setActive(payload) {
    this._bindModelRemoval(payload && payload.model);
    this.current = payload;
    this.listeners.forEach((fn) => fn());
  },
  clear() {
    this._bindModelRemoval(null);
    if (this.current === null) return;
    this.current = null;
    this.listeners.forEach((fn) => fn());
  },
  // When the active widget is DELETED from the document, the panel must stop
  // showing that widget's structure (Layers popup, Inspector). Elementor's
  // element-delete pulls the model from its parent Backbone collection, which
  // fires 'remove' on the model (and 'destroy' when it's destroyed). Neither is
  // one of the HIDE_HOOKS (those only fire when another element's editor opens),
  // so without this the store stayed populated and the Layers dialogue lingered
  // after the widget was gone. Re-render/undo keep the model in the collection,
  // so they don't trip this.
  _bindModelRemoval(model) {
    if (this._modelOff) { this._modelOff(); this._modelOff = null; }
    if (!model || typeof model.on !== 'function' || typeof model.off !== 'function') return;
    const onGone = () => this.clear();
    model.on('remove', onGone);
    model.on('destroy', onGone);
    this._modelOff = () => {
      try { model.off('remove', onGone); model.off('destroy', onGone); } catch (_) { /* detached model */ }
    };
  },
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

let bridgeReady = false;

function parseSlotsFromHtml(rawHtml) {
  const doc = document.createElement('div');
  doc.innerHTML = String(rawHtml || '');
  return extractSlotTextNodes(doc);
}

function syncSlotsFromRawHtml(settings, panel) {
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') return;
  const rawHtml = settings.get('raw_html');
  if (typeof rawHtml !== 'string') return;
  const nodes = parseSlotsFromHtml(rawHtml);
  const dynamics = settings.get('__dynamic__') || {};

  settings.__uichComposerSlotSyncing = true;
  try {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const visibleKey = `slot_${i}_visible`;
      const node = nodes[i] || null;
      if (node) {
        syncSlotSettingsFromNode(settings, i, node, panel, dynamics);
      } else if (String(settings.get(visibleKey) || '') !== 'no') {
        settings.set(visibleKey, 'no');
      }
    }
  } finally {
    settings.__uichComposerSlotSyncing = false;
  }
}

function writeRawHtmlFromLink(settings, slotIndex) {
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') return;
  if (settings.__uichComposerSlotSyncing) return;
  const linkKey = `slot_${slotIndex}_link`;
  const dynamics = settings.get('__dynamic__') || {};
  if (dynamics[linkKey] && dynamics[linkKey] !== '') return;

  const rawHtml = settings.get('raw_html');
  if (typeof rawHtml !== 'string') return;
  const doc = document.createElement('div');
  doc.innerHTML = rawHtml;
  const nodes = extractSlotTextNodes(doc);
  const node = nodes[slotIndex];
  if (!node || node.nodeType !== 1 || String(node.tagName || '').toUpperCase() !== 'A') return;

  const linkVal = normalizeLinkValue(settings.get(linkKey) || {});
  applyLinkToAnchor(node, linkVal);
  const nextHtml = doc.innerHTML;
  if (nextHtml !== rawHtml) {
    settings.__uichComposerSlotSyncing = true;
    try {
      settings.set('raw_html', nextHtml);
    } finally {
      settings.__uichComposerSlotSyncing = false;
    }
  }
}

function writeRawHtmlFromSlot(settings, slotIndex, nextValue) {
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') return;
  if (settings.__uichComposerSlotSyncing) return;
  const dynamics = settings.get('__dynamic__') || {};
  const slotKey = `slot_${slotIndex}`;
  if (dynamics[slotKey] && dynamics[slotKey] !== '') return;

  const rawHtml = settings.get('raw_html');
  if (typeof rawHtml !== 'string') return;
  const doc = document.createElement('div');
  doc.innerHTML = rawHtml;
  const nodes = extractSlotTextNodes(doc);
  const node = nodes[slotIndex];
  if (!node) return;
  const kind = getSlotKind(node);
  if (kind === 'image' || kind === 'svg') return;
  // Link-wrapper anchor (wraps media/blocks): its text is the Link Text, applied
  // elsewhere, skip here so we never wipe its child media/heading nodes.
  if (kind === 'anchor' && anchorWrapsSlotContent(node)) return;

  let safeValue = nextValue == null ? '' : String(nextValue);
  if (safeValue.trim() === '' && node.nodeType === 3) safeValue = '\u200B';
  if (node.nodeType === 3) node.nodeValue = safeValue;
  else node.textContent = safeValue;

  const nextHtml = doc.innerHTML;
  if (nextHtml !== rawHtml) settings.set('raw_html', nextHtml);
}

function writeRawHtmlFromSlotSettings(settings, slotIndex) {
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') return;
  if (settings.__uichComposerSlotSyncing) return;
  const rawHtml = settings.get('raw_html');
  if (typeof rawHtml !== 'string') return;
  const doc = document.createElement('div');
  doc.innerHTML = rawHtml;
  const nodes = extractSlotTextNodes(doc);
  const node = nodes[slotIndex];
  if (!node) return;
  applySlotSettingsToNode(node, settings, slotIndex);
  const nextHtml = doc.innerHTML;
  if (nextHtml !== rawHtml) {
    settings.__uichComposerSlotSyncing = true;
    try {
      settings.set('raw_html', nextHtml);
    } finally {
      settings.__uichComposerSlotSyncing = false;
    }
  }
}

// Forward-sync bgslot_* controls from raw_html/raw_css, guarded so the writes
// never re-enter the bgslot reverse-sync below.
function syncBgSlotsFromRawCss(settings, panel) {
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') return;
  settings.__uichComposerSlotSyncing = true;
  try {
    syncBgSlotSettingsFromCss(settings, panel);
  } finally {
    settings.__uichComposerSlotSyncing = false;
  }
}

// Reverse-sync: a bgslot_i_image pick rewrites the i-th background image back
// into its source, the element's inline style (raw_html) or a class rule
// (raw_css). Returns true when something changed.
function writeRawCssFromBgSlot(settings, slotIndex) {
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') return false;
  if (settings.__uichComposerSlotSyncing) return false;
  const media = normalizeMediaValue(settings.get(`bgslot_${slotIndex}_image`));
  const write = computeBgSlotWrite(settings.get('raw_html'), settings.get('raw_css'), slotIndex, media.url);
  if (!write) return false;
  settings.__uichComposerSlotSyncing = true;
  try {
    settings.set(write.key, write.value);
    // Re-derive bgslot_* from the just-written source so a cleared background
    // drops its now-empty slot. The change:raw_css handler skips its own
    // re-derive while __uichComposerSlotSyncing is set, so without this the
    // emptied slot would linger with a stray "Choose Image" control.
    try { syncBgSlotSettingsFromCss(settings, settings.__uichComposerSlotSyncPanel); }
    catch (e) { /* bg-slots are best-effort */ }
  } finally {
    settings.__uichComposerSlotSyncing = false;
  }
  return true;
}

function bindComposerSlotSync(panel, model, view) {
  if (!model || typeof model.get !== 'function') return;
  const settings = model.get('settings');
  if (!settings || typeof settings.on !== 'function' || typeof settings.get !== 'function') return;
  settings.__uichComposerSlotSyncPanel = panel;
  settings.__uichComposerSlotSyncView = view || null;
  if (settings.__uichComposerSlotSyncBound) {
    syncSlotsFromRawHtml(settings, panel);
    try { syncBgSlotsFromRawCss(settings, panel); } catch (e) { /* best-effort */ }
    return;
  }
  settings.__uichComposerSlotSyncBound = true;

  settings.on('change:raw_html', () => {
    syncSlotsFromRawHtml(settings, settings.__uichComposerSlotSyncPanel || panel);
    // Inline-style (Local scope) backgrounds live in raw_html, so refresh the
    // background-image slots on markup changes too. Guarded so a bgslot reverse
    // write (which may set raw_html) does not re-clobber the pick. Best-effort:
    // a background-slot error must never disturb the node slots synced above.
    if (!settings.__uichComposerSlotSyncing) {
      try { syncBgSlotsFromRawCss(settings, settings.__uichComposerSlotSyncPanel || panel); }
      catch (e) { /* bg-slots are best-effort */ }
    }
    scheduleRerender({ model, view: settings.__uichComposerSlotSyncView || view || null });
  });

  // Keep the Media panel's background-image slots aligned with raw_css too.
  settings.on('change:raw_css', () => {
    // A CSS-only change used to repaint NOTHING: this handler only synced the
    // background slots, and no other handler watched raw_css. Requested before
    // the sync guard, because that guard is there to stop a reverse write
    // looping, not to suppress the paint.
    scheduleRerender({ model, view: settings.__uichComposerSlotSyncView || view || null });
    if (settings.__uichComposerSlotSyncing) return;
    syncBgSlotsFromRawCss(settings, settings.__uichComposerSlotSyncPanel || panel);
  });

  const slotSettingKeys = (i) => [
    `slot_${i}`,
    `slot_${i}_link_text`,
    `slot_${i}_link`,
    `slot_${i}_image`,
    `slot_${i}_image_alt`,
    `slot_${i}_svg_mode`,
    `slot_${i}_svg_code`,
    `slot_${i}_svg_code_media`,
    `slot_${i}_svg_url`,
  ];

  for (let i = 0; i < SLOT_COUNT; i++) {
    settings.on(`change:slot_${i}`, () => {
      writeRawHtmlFromSlot(settings, i, settings.get(`slot_${i}`));
    });
    slotSettingKeys(i).slice(1).forEach((key) => {
      settings.on(`change:${key}`, () => {
        if (settings.__uichComposerSlotSyncing) return;
        if (key === `slot_${i}_link`) {
          writeRawHtmlFromLink(settings, i);
          scheduleRerender({ model, view: settings.__uichComposerSlotSyncView || view || null });
          return;
        }
        if (key === `slot_${i}_svg_code_media`) {
          // Mirror the Composer Panel's media-picker behavior: apply URL mode instead of
          // fetching and embedding SVG content inline.  Synthetic preview values (data:/blob:
          // URLs written by syncSlotSettingsFromNode) are ignored so only a real user pick
          // triggers the mode switch.
          const media = normalizeMediaValue(settings.get(key));
          if (media.url && !/^(data:|blob:)/i.test(media.url)) {
            settings.__uichComposerSlotSyncing = true;
            try {
              settings.set(`slot_${i}_svg_mode`, 'url');
              settings.set(`slot_${i}_svg_url`, media);
              settings.set(`slot_${i}_svg_code`, '');
              settings.set(`slot_${i}_svg_code_media`, { url: '', id: '' });
            } finally {
              settings.__uichComposerSlotSyncing = false;
            }
          }
          writeRawHtmlFromSlotSettings(settings, i);
          scheduleRerender({ model, view: settings.__uichComposerSlotSyncView || view || null });
          return;
        }
        writeRawHtmlFromSlotSettings(settings, i);
        scheduleRerender({ model, view: settings.__uichComposerSlotSyncView || view || null });
      });
    });

    settings.on(`change:bgslot_${i}_image`, () => {
      if (settings.__uichComposerSlotSyncing) return;
      if (writeRawCssFromBgSlot(settings, i)) {
        scheduleRerender({ model, view: settings.__uichComposerSlotSyncView || view || null });
      }
    });
  }

  syncSlotsFromRawHtml(settings, panel);
  try { syncBgSlotsFromRawCss(settings, panel); } catch (e) { /* best-effort */ }
}

/**
 * Editor load: put the page's FIRST Composer widget in the panel, so the
 * composer opens ready to edit instead of sitting empty until the user clicks a
 * widget.
 *
 * Activated straight through the store rather than via Elementor's
 * `panel/editor/open`, opening Elementor's own editor panel would yank the
 * user out of the Elements tab they land on, which is far more than "select the
 * first widget" should cost. Elementor's panel still takes over normally the
 * moment the user clicks any widget themselves.
 *
 * Polls because the preview iframe is not populated when the bridge binds, and
 * gives up quietly rather than retrying forever on a page with no Composer
 * widget on it.
 */
function autoSelectFirstComposerWidget() {
  const el = typeof window !== 'undefined' ? window.elementor : null;
  if (!el || typeof el.getContainer !== 'function') return;
  let tries = 0;
  const tick = () => {
    if (store.current) return;   // the user got there first, leave their pick alone
    if (tries++ > 40) return;    // ~10s
    let doc = null;
    try {
      const top = (window.top && window.top.document) || document;
      const frame = top.getElementById('elementor-preview-iframe');
      doc = frame && frame.contentDocument;
    } catch (_) { doc = null; }
    // Legacy classes included so a not-yet-migrated widget is still found.
    const w = doc && doc.querySelector(
      '.elementor-widget-uichemy-composer, .elementor-widget-composer, .elementor-widget-proton, .elementor-widget-uichemy-builder'
    );
    const host = w && w.closest ? w.closest('.elementor-element[data-id]') : null;
    const id = host && host.getAttribute('data-id');
    let c = null;
    if (id) {
      try { c = el.getContainer(id); } catch (_) { c = null; }
    }
    if (!c || !c.model || typeof c.model.get !== 'function') {
      setTimeout(tick, 250);
      return;
    }
    bindComposerSlotSync(null, c.model, c.view || null);
    store.setActive({ panel: null, model: c.model, view: c.view || null, settings: c.model.get('settings') });
  };
  setTimeout(tick, 250);
}

function tryBindElementor() {
  if (bridgeReady) return true;
  const el = typeof window !== 'undefined' ? window.elementor : null;
  if (!el || !el.hooks || typeof el.hooks.addAction !== 'function') return false;

  // Elementor names this hook after the widget TYPE, so a widget still stored as
  // `proton` / `composer` / `uichemy-builder` fires a different hook than a migrated
  // one. All four are bound until Uich_Composer_Migration has rewritten every row — see
  // the hidden aliases in class-uichemy-composer-widget-legacy.php.
  COMPOSER_WIDGET_TYPES.forEach((type) => {
    el.hooks.addAction(`panel/open_editor/widget/${type}`, (panel, model, view) => {
      if (!model || typeof model.get !== 'function') return;
      bindComposerSlotSync(panel, model, view);
      store.setActive({ panel, model, view, settings: model.get('settings') });
    });
  });

  el.hooks.addAction('panel/open_editor/widget', (panel, model /* , view */) => {
    if (!model || typeof model.get !== 'function') return;
    if (!isComposerWidgetType(model.get('widgetType'))) store.clear();
  });

  HIDE_HOOKS.forEach((h) => el.hooks.addAction(h, () => store.clear()));

  bridgeReady = true;
  autoSelectFirstComposerWidget();
  return true;
}

export function initElementorBridge() {
  if (tryBindElementor()) return;
  // Poll briefly until Elementor is available.
  const start = Date.now();
  const t = setInterval(() => {
    if (tryBindElementor() || Date.now() - start > 30000) clearInterval(t);
  }, 250);
}

const subscribe = (fn) => store.subscribe(fn);
const getSnapshot = () => store.current;
const SETTING_SYNC_EVENT = 'uich:widget-setting-sync';
const RERENDER_KEYS = new Set(['raw_html', 'raw_css', 'raw_js']);
const STALE_ECHO_MS = 4000;
/** Recent inspector writes, blocks legacy CodeMirror/Backbone echoes of superseded values. */
const recentWidgetWrites = Object.create(null);

function recordWidgetWrite(key, value) {
  const next = value == null ? '' : String(value);
  let rec = recentWidgetWrites[key];
  if (!rec) {
    recentWidgetWrites[key] = { current: next, at: Date.now(), superseded: new Set() };
    return;
  }
  if (rec.current !== next) rec.superseded.add(rec.current);
  rec.current = next;
  rec.at = Date.now();
}

function isStaleWidgetSettingEcho(key, incoming) {
  const rec = recentWidgetWrites[key];
  if (!rec) return false;
  if (Date.now() - rec.at > STALE_ECHO_MS) return false;
  const inc = incoming == null ? '' : String(incoming);
  if (inc === rec.current) return false;
  return rec.superseded.has(inc);
}

export function getLastWidgetWrite(key) {
  return recentWidgetWrites[key] || null;
}

export function useActiveWidget() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Synchronous (non-hook) accessor for the currently-active widget store entry. */
export function getActiveWidgetSync() {
  return store.current;
}

// Builder-agnostic entry points for non-Elementor bridges (Gutenberg, Bricks)
// to publish/clear the active-widget store, mirrors what tryBindElementor()
// does inline via store.setActive()/store.clear() for the Elementor hooks.
export function setActiveComposerWidget(payload) {
  store.setActive(payload);
}

/**
 * Select a composer widget by its id and make it the active one, across every
 * builder. Powers whole-page (global) undo/redo: to restore a change on an
 * element that isn't currently selected, we must first select it so the shared
 * setters (writeHtml / setRawCss) rebind to it. Returns true when a target was
 * found and activated. Best-effort + fully guarded — never throws.
 *
 *  - Elementor: elementor.getContainer(id) → store.setActive (mirrors
 *    autoSelectFirstComposerWidget); also asks Elementor to visually select it.
 *  - Gutenberg / Bricks: their bridge globals (window.UichComposer*) publish the
 *    active shim model; Gutenberg also gets a real block selection.
 */
export function selectComposerWidgetById(id) {
  if (!id || typeof window === 'undefined') return false;

  // Already active — nothing to do.
  const cur = store.current;
  if (cur && cur.model && typeof cur.model.get === 'function' && cur.model.get('id') === id) return true;

  // Elementor.
  const el = window.elementor;
  if (el && typeof el.getContainer === 'function') {
    let c = null;
    try { c = el.getContainer(id); } catch (_) { c = null; }
    if (c && c.model && typeof c.model.get === 'function') {
      try { window.$e && window.$e.run && window.$e.run('document/elements/select', { container: c }); } catch (_) { /* visual-only */ }
      try { bindComposerSlotSync(null, c.model, c.view || null); } catch (_) {}
      store.setActive({ panel: null, model: c.model, view: c.view || null, settings: c.model.get('settings') });
      return true;
    }
  }

  // Gutenberg — select the real block, then publish the shim model.
  const gb = window.UichComposerGutenberg;
  if (gb && typeof gb.activate === 'function') {
    try {
      const wp = window.wp;
      if (wp && wp.data && wp.data.dispatch) {
        try { wp.data.dispatch('core/block-editor').selectBlock(id); } catch (_) {}
      }
      gb.activate(id);
      return true;
    } catch (_) { /* fall through */ }
  }

  // Bricks — publish the shim model (canvas selection is Bricks' own Vue app).
  const br = window.UichComposerBricks;
  if (br && typeof br.activate === 'function') {
    try { br.activate(id); return true; } catch (_) { /* fall through */ }
  }

  return false;
}

/**
 * Apply raw_html + raw_css straight to a composer widget BY ID, without changing
 * the selection or routing through React state. Powers whole-page undo/redo: the
 * restore lands on the exact element the change belongs to — reliably and
 * synchronously — even when a different element is selected (no async
 * select-then-apply race). The caller moves the visual selection separately, only
 * for feedback. Returns true when the write went through. Never throws.
 *
 * NOTE: use this ONLY for elements that are NOT the active one — the active
 * widget must go through the React setters so its open panel/preview refresh.
 */
export function applyWidgetSnapById(id, snap) {
  if (!id || !snap || typeof window === 'undefined') return false;
  const html = snap.raw_html || '';
  const css = snap.raw_css || '';

  // Elementor — set both keys on the container's settings model, then rebuild it.
  const el = window.elementor;
  try { console.log('[UiChemy history] applyWidgetSnapById', id, 'elementor?', !!el, 'getContainer?', !!(el && el.getContainer)); } catch (_) {}
  if (el && typeof el.getContainer === 'function') {
    let c = null;
    try { c = el.getContainer(id); } catch (_) { c = null; }
    try { console.log('[UiChemy history] getContainer(', id, ') →', !!c, 'hasModel?', !!(c && c.model)); } catch (_) {}
    if (c && c.model && typeof c.model.get === 'function') {
      const settings = c.model.get('settings');
      if (settings && typeof settings.set === 'function') {
        settings.set('raw_html', html);
        settings.set('raw_css', css);
      }
      try { window.elementor && window.elementor.saver && window.elementor.saver.setFlagEditorChange && window.elementor.saver.setFlagEditorChange(true); } catch (_) {}
      try { rerenderWidgetContainer({ model: c.model, view: c.view || null, settings }, 'raw_html'); } catch (_) {}
      return true;
    }
  }

  // Gutenberg — writeSetting routes to updateBlockAttributes for any block id.
  // Respect its return: on a front-end page there's no block editor, so it fails
  // and we must fall through to the front-end path (not claim success).
  const gb = window.UichComposerGutenberg;
  if (gb && typeof gb.writeSetting === 'function') {
    try {
      const okH = gb.writeSetting(id, 'raw_html', html);
      const okC = gb.writeSetting(id, 'raw_css', css);
      if (okH || okC) return true;
    } catch (_) { /* fall through */ }
  }

  // Bricks — setSetting only writes the ACTIVE element, so select it first (its
  // shim model then accepts the write and drives the Bricks preview).
  const br = window.UichComposerBricks;
  if (br && typeof br.activate === 'function' && typeof br.setSetting === 'function') {
    try {
      br.activate(id);
      const okH = br.setSetting(id, 'raw_html', html);
      const okC = br.setSetting(id, 'raw_css', css);
      if (okH || okC) return true;
    } catch (_) { /* fall through */ }
  }

  return false;
}
export function clearActiveComposerWidget() {
  store.clear();
}

// Synchronous, non-hook writer for a single setting on the active widget's
// Backbone settings model. This is the imperative counterpart to the `update`
// callback returned by useWidgetSetting() — for flows that run outside React
// (e.g. applyTypographyClassToGlobals writing `site_custom_code_head`). It sets
// the value on the live model, marks the Elementor document dirty so a Save
// actually persists it, and broadcasts SETTING_SYNC_EVENT so any open panel
// resyncs. No-ops safely when there is no active widget.
export function setActiveWidgetSettingSync(key, value) {
  const active = getActiveWidgetSync();
  if (RERENDER_KEYS.has(key)) {
    recordWidgetWrite(key, value);
  }

  const target = liveSettings(active);
  if (target && typeof target.set === 'function') {
    const before = typeof target.get === 'function' ? target.get(key) : undefined;
    target.set(key, value);
    if (before === value && typeof target.trigger === 'function') {
      target.trigger(`change:${key}`, target, value, {});
    }
  }

  // Mirror the write onto the hidden panel control so Elementor marks the
  // document dirty, matching useWidgetSetting()'s update pipeline.
  if (active && active.panel && active.panel.$el) {
    const $input = active.panel.$el.find(`[data-setting="${key}"]`);
    if ($input && $input.length) {
      try {
        $input.val(value).trigger('input').trigger('change');
      } catch (_) {}
    }
  }
  try { window.elementor?.saver?.setFlagEditorChange?.(true); } catch (_) {}

  if (RERENDER_KEYS.has(key)) {
    rerenderWidgetContainer(active, key);
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(SETTING_SYNC_EVENT, {
        detail: {
          key,
          value: value == null ? '' : String(value),
          model: active && active.model ? active.model : null,
        },
      }));
    } catch (_) {}
  }
}

// Always pull the live settings model from the widget, Elementor sometimes
// hands back a fresh settings instance (undo/redo, history) and a stored
// reference can go stale silently.
function liveSettings(active) {
  if (!active) return null;
  if (active.model && typeof active.model.get === 'function') {
    return active.model.get('settings') || active.settings || null;
  }
  return active.settings || null;
}

// Two-way binding for a single setting key on the active widget's
// Backbone settings model. Returns [value, setValue, isActive].
export function useWidgetSetting(key) {
  const active = useActiveWidget();
  const settings = liveSettings(active);
  // The state remembers WHICH (settings, key) pair it was read for. Both can
  // change on a component that stays mounted: the Code tab swaps `key` when you
  // switch the HTML / CSS / JS panes (they are one reused EditorPaneLive), and
  // `settings` swaps when you select a different widget. A plain useState
  // initializer only runs at mount, so the previous pair's value survived into
  // the first render under the new one.
  //
  // That single stale render was not cosmetic, it corrupted data: on HTML → CSS
  // the pane rendered with settingKey 'raw_css' while `value` was still the
  // HTML, and EditorPaneLive's auto-format effect (which fires once per
  // widget+setting) formatted that HTML as CSS and wrote it straight into
  // raw_css. Hence "the HTML shows up in the CSS editor", and hence the widget's
  // CSS breaking in the Elementor preview, they are the same bug.
  //
  // Re-deriving during render is React's documented "adjust state when props
  // change" pattern; it re-runs this component before anything is committed, so
  // no consumer, effect or child ever observes the mismatched pair.
  const [state, setState] = React.useState(() => ({ settings, key, value: readSetting(settings, key) }));
  let value = state.value;
  if (state.settings !== settings || state.key !== key) {
    value = readSetting(settings, key);
    setState({ settings, key, value });
  }
  // Functional update so a late echo from a listener that is mid-teardown can
  // only change the value, never resurrect the (settings, key) it was read for.
  const setValue = React.useCallback((next) => {
    setState((prev) => (prev.value === next ? prev : { ...prev, value: next }));
  }, []);

  React.useEffect(() => {
    const incoming = readSetting(settings, key);
    if (!isStaleWidgetSettingEcho(key, incoming)) {
      setValue(incoming);
    }
    if (!settings || typeof settings.on !== 'function') return undefined;
    const handler = () => {
      const next = readSetting(settings, key);
      if (!isStaleWidgetSettingEcho(key, next)) {
        setValue(next);
      }
    };
    settings.on(`change:${key}`, handler);
    return () => {
      if (typeof settings.off === 'function') settings.off(`change:${key}`, handler);
    };
  }, [settings, key]);

  // Safety net for flows that update the setting through alternate paths:
  // every write emits a lightweight window event so any open panel (Editor
  // tab, Code tab, widget panel mirrors) can resync even if Backbone change
  // listeners were briefly detached during Elementor internals.
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const activeModel = active && active.model;
    function onSync(e) {
      const d = e && e.detail;
      if (!d || d.key !== key) return;
      if (activeModel && d.model && d.model !== activeModel) return;
      const incoming = d.value == null ? '' : String(d.value);
      if (!isStaleWidgetSettingEcho(key, incoming)) {
        setValue(incoming);
      }
    }
    window.addEventListener(SETTING_SYNC_EVENT, onSync);
    return () => window.removeEventListener(SETTING_SYNC_EVENT, onSync);
  }, [active, key]);

  const update = React.useCallback(
    (next) => {
      if (RERENDER_KEYS.has(key)) {
        recordWidgetWrite(key, next);
      }
      // Re-fetch the live settings on every write, defends against the
      // stored reference going stale between renders.
      const target = liveSettings(active) || settings;
      if (target && typeof target.set === 'function') {
        const before = typeof target.get === 'function' ? target.get(key) : undefined;
        target.set(key, next);
        if (before === next && typeof target.trigger === 'function') {
          target.trigger(`change:${key}`, target, next, {});
        }
      }

      // Match the legacy editor's write pipeline: triggering input/change
      // on the hidden control element is what marks Elementor's document
      // dirty so a Save actually persists the value. Without this the
      // user's changes look correct in the editor but never reach the DB.
      if (active && active.panel && active.panel.$el) {
        const $input = active.panel.$el.find(`[data-setting="${key}"]`);
        if ($input && $input.length) {
          try {
            $input.val(next).trigger('input').trigger('change');
          } catch (_) {}
        }
      }
      // Always flag the document dirty so the Publish/Update button re-enables
      //, mirrors legacy markEditorDirty(). The panel control's change event
      // can't be relied on alone: after a publish Elementor may re-render the
      // panel, leaving our cached $el stale so the control isn't found; and the
      // value already set on the model above can make Elementor's change
      // handler a no-op. Must pass `true`, a no-arg setFlagEditorChange()
      // sets the flag falsy and leaves the button disabled.
      try { window.elementor?.saver?.setFlagEditorChange?.(true); } catch (_) {}

      // raw_html / raw_css / raw_js controls are registered with
      // render_type='none', so Elementor never auto-re-renders the widget
      // when they change. The legacy code rewrites the widget container
      // manually, do the same so the preview canvas reflects edits.
      if (RERENDER_KEYS.has(key)) {
        rerenderWidgetContainer(active, key);
      }

      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent(SETTING_SYNC_EVENT, {
            detail: {
              key,
              value: next == null ? '' : String(next),
              model: active && active.model ? active.model : null,
            },
          }));
        } catch (_) {}
      }

      setValue(next);
    },
    [active, settings, key]
  );

  return [value, update, !!settings];
}

function readLinkSetting(settings, slotIndex) {
  if (!settings || typeof settings.get !== 'function' || typeof slotIndex !== 'number') {
    return { ...EMPTY_LINK };
  }
  return normalizeLinkValue(settings.get(`slot_${slotIndex}_link`) || {});
}

/**
 * Two-way binding for `slot_{n}_link` on the active widget.
 * Returns [link, setLink, isActive].
 */
export function useWidgetLinkSetting(slotIndex) {
  const active = useActiveWidget();
  const settings = liveSettings(active);
  const hasSlot = typeof slotIndex === 'number' && slotIndex >= 0;
  const linkKey = hasSlot ? `slot_${slotIndex}_link` : null;
  const isLinkKey = hasSlot ? `slot_${slotIndex}_is_link` : null;

  const [link, setLink] = React.useState(() => readLinkSetting(settings, slotIndex));

  React.useEffect(() => {
    if (!hasSlot) {
      setLink({ ...EMPTY_LINK });
      return undefined;
    }
    setLink(readLinkSetting(settings, slotIndex));
    if (!settings || typeof settings.on !== 'function' || !linkKey) return undefined;
    const handler = () => {
      setLink(readLinkSetting(settings, slotIndex));
    };
    settings.on(`change:${linkKey}`, handler);
    return () => {
      if (typeof settings.off === 'function') settings.off(`change:${linkKey}`, handler);
    };
  }, [settings, slotIndex, hasSlot, linkKey]);

  const update = React.useCallback(
    (next) => {
      if (!hasSlot || !linkKey) return;
      const normalized = normalizeLinkValue(next);
      const target = liveSettings(active) || settings;
      if (!target || typeof target.set !== 'function') return;

      const dynamics = target.get('__dynamic__') || {};
      if (dynamics[linkKey] && dynamics[linkKey] !== '') return;

      target.set(linkKey, normalized);
      if (isLinkKey) target.set(isLinkKey, 'yes');

      if (active && active.panel) {
        syncPanelLinkControls(active.panel, linkKey, normalized);
      }

      if (typeof target.trigger === 'function') {
        target.trigger(`change:${linkKey}`, target, normalized, {});
      }

      setLink(normalized);
    },
    [active, settings, hasSlot, linkKey, isLinkKey, slotIndex],
  );

  return [link, update, !!(settings && hasSlot)];
}

// Dynamic <uichemy-*> tags (nav-menu, site-logo, site-icon, post-content,
// toc, …) carry an inner template whose tokens (e.g. {nav_item}) are only
// resolved by the PHP render(). A plain client-side innerHTML injection can't
// expand them, so the browser would paint the literal `{nav_item}` text.
export const UICHEMY_DYNAMIC_TAG_RE = /<uichemy-[a-z0-9_-]+/i;
// Twig expressions ({{ output }}) and control tags ({% for/if/set … %}) also
// resolve only on the server, so they must be treated as dynamic too.
export const UICH_TWIG_RE = /\{\{|\{%/;

// Blank the inner template of every <uichemy-*> tag so its tokens never flash
// as literal text during the optimistic paint; the server re-render fills in
// the resolved markup. Self-closing tags carry no inner content and are left
// untouched by the (content-bearing) pattern below.
function stripUichemyTemplateContent(html) {
  if (!html || html.indexOf('uichemy-') === -1) return html;
  return html.replace(
    /(<(uichemy-[a-z0-9_-]+)(?:\s[^>]*)?>)[\s\S]*?(<\/\2\s*>)/gi,
    (_m, open, _tag, close) => open + close,
  );
}

// Ask Elementor to re-render the widget on the server (throttled to ~1s) so
// dynamic <uichemy-*> tags resolve against live WordPress data. Returns true
// only when a render was actually requestable, so callers can decide whether
// to fall back to the raw (token-bearing) optimistic paint.
function requestServerRender(active) {
  try {
    const view = active && active.view;
    let model = view && typeof view.getEditModel === 'function' ? view.getEditModel() : null;
    if (!model && active) model = active.model;
    if (model && typeof model.renderRemoteServer === 'function') {
      model.renderRemoteServer();
      return true;
    }
  } catch (_) {}
  return false;
}

// A "full" HTML document (starts with a doctype or an <html> element) cannot
// be injected with innerHTML / jQuery.html(): the fragment parser silently
// drops <!doctype>, <html>, <head>, <title> and <body>, and any <script> is
// parsed but never executed. That is why a widget holding a complete document
// renders blank/partial in the editor and only appears after a hard refresh
// (a full page load runs a real HTML parser + executes scripts). Detect it so
// we can take the DOMParser path below instead.
function isFullHtmlDocument(html) {
  if (!html) return false;
  return /^\s*<!doctype\s+html/i.test(html) || /<html[\s>]/i.test(html);
}

// Render a complete HTML document into the widget container the way a browser
// would on a full page load: parse with a real HTML parser, hoist the <head>
// styles, move the <body> content in, and re-create every <script> as a fresh
// element so it actually executes. This makes full documents render instantly
// in the editor preview, no refresh required.
function injectFullDocumentIntoContainer(containerEl, docHtml, rawCss, rawJs) {
  if (!containerEl) return;
  const cdoc = containerEl.ownerDocument || document;
  const parsed = new DOMParser().parseFromString(String(docHtml || ''), 'text/html');

  containerEl.innerHTML = '';

  // Pull every script out of the parsed tree first so the markup we import
  // below never carries a dead (never-executing) copy alongside the live one
  // we append at the end. Order is preserved: head scripts, then body scripts.
  const scriptSources = [];
  const collectScripts = (root) => {
    if (!root) return;
    root.querySelectorAll('script').forEach((s) => {
      scriptSources.push(s);
      if (s.parentNode) s.parentNode.removeChild(s);
    });
  };

  if (parsed.head) {
    collectScripts(parsed.head);
    // <style> / stylesheet <link> keep the document's own styling.
    parsed.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
      containerEl.appendChild(cdoc.importNode(n, true));
    });
  }
  if (parsed.body) {
    collectScripts(parsed.body);
    Array.from(parsed.body.childNodes).forEach((n) => {
      containerEl.appendChild(cdoc.importNode(n, true));
    });
  }

  // Widget-scope raw CSS from the Code tab.
  if (rawCss) {
    const st = cdoc.createElement('style');
    st.textContent = rawCss;
    containerEl.appendChild(st);
  }

  // Re-create each collected script so the browser executes it (importNode /
  // innerHTML nodes never run), then the widget's own raw JS last.
  const runScript = (src) => {
    const s = cdoc.createElement('script');
    if (src && src.attributes) {
      for (let i = 0; i < src.attributes.length; i++) {
        s.setAttribute(src.attributes[i].name, src.attributes[i].value);
      }
    }
    s.textContent = (src && src.textContent) || '';
    containerEl.appendChild(s);
  };
  scriptSources.forEach(runScript);
  if (rawJs) {
    const s = cdoc.createElement('script');
    s.textContent = rawJs;
    containerEl.appendChild(s);
  }
}

/**
 * Run a widget's init JS against its freshly re-rendered subtree so behaviours
 * that live in raw_js (scroll-reveal IntersectionObservers, counters, sliders,
 * …) re-bind to the new nodes.
 *
 * A bare `<script>` re-inject can't do this: innerHTML never executes injected
 * scripts, and a re-render happens long after the page's DOMContentLoaded/load,
 * so a re-injected script's readiness handlers would never fire. We execute
 * raw_js through shims that make an already-loaded document behave like a fresh
 * one:
 *   • `document`/`window` `addEventListener('DOMContentLoaded'|'load', …)` fire
 *     their listener immediately instead of registering it for a past event.
 *   • `document.querySelector[All]` are scoped to THIS widget's subtree, so a
 *     section whose wrapper class also appears elsewhere on the page (a
 *     duplicated section) initialises its own nodes rather than the first match
 *    , with a document-wide fallback when a selector isn't found inside it, so
 *     genuinely global lookups still resolve.
 */
export function runWidgetInitJs(scopeEl, rawJs) {
  const js = typeof rawJs === 'string' ? rawJs : '';
  if (!js.trim() || !scopeEl) return;
  const realDoc = scopeEl.ownerDocument || document;
  const realWin = realDoc.defaultView || window;

  const fireNow = (listener, thisArg, type) => {
    if (typeof listener !== 'function') return;
    try { listener.call(thisArg, new realWin.Event(type)); } catch (_) {}
  };
  const readyShim = (thisArg) => (type, listener, opts) => {
    if (type === 'DOMContentLoaded' || type === 'load') { fireNow(listener, thisArg, type); return; }
    return thisArg.addEventListener(type, listener, opts);
  };
  const docProxy = new Proxy(realDoc, {
    get(t, p) {
      if (p === 'addEventListener') return readyShim(realDoc);
      if (p === 'querySelector') return (s) => { let r = null; try { r = scopeEl.querySelector(s); } catch (_) {} return r || realDoc.querySelector(s); };
      if (p === 'querySelectorAll') return (s) => { let r = null; try { r = scopeEl.querySelectorAll(s); } catch (_) {} return (r && r.length) ? r : realDoc.querySelectorAll(s); };
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const winProxy = new Proxy(realWin, {
    get(t, p) {
      if (p === 'addEventListener') return readyShim(realWin);
      if (p === 'document') return docProxy;
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', js)(winProxy, docProxy);
  } catch (e) {
    window.console && console.warn('[UiChemy] widget init JS re-run failed', e);
  }
}

/**
 * Coalesced repaint of a widget's container.
 *
 * A generated section arrives as SEPARATE setting writes — raw_html, then
 * raw_css, then raw_js — and every one of them fired its own repaint. So the
 * markup painted first against the PREVIOUS stylesheet, which is the unstyled
 * flash you see before a section settles, and then painted again once the CSS
 * landed. Worse, `change:raw_css` asked for no repaint at all, so a CSS-only
 * change showed nothing until some unrelated change happened to trigger one.
 *
 * One frame of coalescing turns that burst into a SINGLE paint with all three
 * present — which is what makes a generated section appear at once instead of
 * assembling itself on screen.
 *
 * Keyed on the model so two widgets generating at the same time do not collapse
 * into one repaint. WeakMap, so a torn-down widget does not leak.
 */
const pendingRerender = new WeakMap();
function scheduleRerender( active ) {
  const key = ( active && active.model ) || active;
  if ( ! key || typeof key !== 'object' ) { rerenderWidgetContainer( active ); return; }
  const queued = pendingRerender.has( key );
  // Always store the LATEST active ref: the view can be handed to us again
  // mid-burst and the stale one may already be detached.
  pendingRerender.set( key, active );
  if ( queued ) return;
  const run = () => {
    const latest = pendingRerender.get( key );
    pendingRerender.delete( key );
    try { rerenderWidgetContainer( latest ); } catch ( _ ) { /* a repaint must never break the editor */ }
  };
  if ( typeof requestAnimationFrame === 'function' ) requestAnimationFrame( run );
  else setTimeout( run, 0 );
}

// Every live `.elementor-widget-container` for the active widget — the view's
// own $el plus any preview-iframe match. Lets us patch a widget WITHOUT
// rebuilding its innerHTML.
function findWidgetContainerEls(active) {
  const els = [];
  if (active && active.view && active.view.$el) {
    const $c = active.view.$el.find('.elementor-widget-container');
    if ($c && $c.length) els.push($c[0]);
  }
  const widgetId = active && active.model && typeof active.model.get === 'function'
    ? active.model.get('id') : null;
  if (widgetId) {
    const docs = [document];
    document.querySelectorAll('iframe').forEach((f) => {
      try { const d = f.contentDocument; if (d) docs.push(d); } catch (_) { /* cross-origin */ }
    });
    for (const d of docs) {
      d.querySelectorAll(`.elementor-element[data-id="${widgetId}"] .elementor-widget-container`).forEach((el) => {
        if (els.indexOf(el) === -1) els.push(el);
      });
    }
  }
  return els;
}

// Build an override stylesheet that carries ONLY the "look" of an edit (color,
// font, spacing, background…) and NONE of the properties a CSS entrance reveal
// owns. We drop:
//   • `@keyframes` blocks (brace-matched, incl. vendor prefixes),
//   • `animation` / `transition` (shorthand + longhand) — so re-injecting can't
//     restart a reveal, and
//   • `opacity` / `transform` / `visibility` / `will-change` — the props a reveal
//     animates. Keeping these would PIN the element at the animation's hidden
//     start state (e.g. opacity:0; transform:translateY(60%)) with no animation
//     left to move it, so the element stays invisible. Leaving them out lets the
//     untouched base animation's filled end-state (opacity:1) hold instead.
/* ── Matching the server's cascade ───────────────────────────────────────────
   PHP does NOT emit raw_css verbatim: it scopes every selector to the widget
   (`.elementor-element-<id> <selector>`, see scope_css_to_widget in
   class-uichemy-composer-widget.php). So the rendered stylesheet's rules carry
   one more class of specificity than the raw text they came from.

   The live override below used to inject the raw text UNSCOPED, which meant the
   editor's preview layer was a specificity class WEAKER than the very stylesheet
   it exists to override — so an edit could be silently outranked by the
   server-rendered rule and simply not appear on canvas, while the saved CSS was
   perfectly correct and showed up the moment the page was rendered again. That
   is the "not in the editor, fine in preview" split.

   The FRONT-END bridge already worked this out and scopes + forces important
   (composer-frontend.jsx). These two helpers moved here so both paths share one
   implementation rather than the editor quietly missing the fix. */
export function forceImportant(css) {
  return String(css || '').replace(
    /([\w-]+)\s*:\s*([^;{}]+);/g,
    (match, prop, rawVal) => {
      const val = rawVal.replace(/\s*!important\s*$/i, '').trim();
      return `${prop}: ${val} !important;`;
    }
  );
}

export function scopeCssToWidget(css, scopeSelector) {
  const text = String(css == null ? '' : css);
  if (!scopeSelector) return text;
  let out = '';
  let i = 0;
  const len = text.length;
  while (i < len) {
    const open = text.indexOf('{', i);
    if (open === -1) { out += text.slice(i); break; }
    let depth = 1;
    let j = open + 1;
    while (j < len && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const prelude = text.slice(i, open).trim();
    const body = text.slice(open + 1, j - 1);
    if (prelude[0] === '@') {
      // @media / @supports / etc. — keep the at-rule, recurse into its body.
      out += text.slice(i, open + 1) + scopeCssToWidget(body, scopeSelector) + '}';
    } else if (prelude) {
      const scoped = prelude.split(',').map((sel) => {
        const s = sel.trim();
        if (!s || s === ':root' || s.indexOf(scopeSelector) === 0) return s;
        return `${scopeSelector} ${s}`;
      }).join(', ');
      out += `${scoped} {${body}}`;
    }
    i = j;
  }
  return out;
}

export function stripCssAnimations(css) {
  let out = String(css || '');
  // Remove @keyframes / @-webkit-keyframes … { … } with balanced braces.
  let guard = 0;
  for (;;) {
    const m = /@(-webkit-|-moz-|-o-)?keyframes\b/i.exec(out);
    if (!m || guard++ > 200) break;
    const start = m.index;
    let i = out.indexOf('{', start);
    if (i === -1) { out = out.slice(0, start); break; }
    let depth = 1; i++;
    for (; i < out.length && depth > 0; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') depth--;
    }
    out = out.slice(0, start) + out.slice(i);
  }
  // Drop the reveal-owned declarations. Looped to a fixed point because adjacent
  // declarations share a `;` delimiter — a single pass consumes one decl's
  // trailing `;`, which is the next decl's leading delimiter, so consecutive
  // animation/animation-delay pairs need a second pass to fully clear.
  const decl = /(^|[;{])\s*(?:-webkit-|-moz-|-o-)?(?:animation|opacity|transform|visibility)(?:-[a-z-]+)?\s*:[^;}]*;?/gi;
  const stripDecls = (block) => {
    let prev;
    let b = block;
    do { prev = b; b = b.replace(decl, '$1'); } while (b !== prev);
    return b;
  };

  const INTERACTION = /:(?:hover|focus|focus-visible|focus-within|active|target)\b/i;
  let result = '';
  let pos = 0;
  while (pos < out.length) {
    const open = out.indexOf('{', pos);
    if (open === -1) { result += out.slice(pos); break; }
    let depth = 1;
    let end = open + 1;
    for (; end < out.length && depth > 0; end++) {
      if (out[end] === '{') depth++;
      else if (out[end] === '}') depth--;
    }
    const selector = out.slice(pos, open);
    const body     = out.slice(open, end);
    if (/^@(?:media|supports|layer|container|scope|document)\b/i.test(selector.replace(/^[\s;]+/, ''))) {
      result += selector + '{' + stripCssAnimations(body.replace(/^\{/, '').replace(/\}$/, '')) + '}';
    } else if (INTERACTION.test(selector)) {
      result += selector + body;
    } else {
      result += selector + stripDecls(body);
    }
    pos = end;
  }
  return result;
}

// Apply a raw_css edit WITHOUT rebuilding innerHTML and WITHOUT restarting
// animations. The animation-bearing CSS (server-rendered <style>, or the base
// <style data-uich-css> from a full rebuild) is left untouched; the edited look
// goes into a separate, animation-stripped override <style> appended last so it
// wins the cascade. Returns true if at least one container was patched.
function updateWidgetCssOverrideInPlace(active, rawCss) {
  const els = findWidgetContainerEls(active);
  // Scoped and forced, exactly like PHP's output and the front-end bridge — see
  // the note on forceImportant above. Unscoped, this layer sat BELOW the
  // server-rendered rules it is meant to override.
  const widgetId = active && active.model && typeof active.model.get === 'function'
    ? active.model.get('id') : null;
  const scopeSelector = widgetId ? `.elementor-element-${widgetId}` : '';
  const overrideCss = forceImportant(scopeCssToWidget(stripCssAnimations(rawCss), scopeSelector));
  let patched = false;
  els.forEach((el) => {
    let style = el.querySelector('style[data-uich-css-override]');
    if (!style) {
      style = (el.ownerDocument || document).createElement('style');
      style.setAttribute('data-uich-css-override', '1');
      el.appendChild(style); // append-only → existing nodes & their animations stay
    }
    if (style.textContent !== overrideCss) style.textContent = overrideCss;
    patched = true;
  });
  return patched;
}

/**
 * Drop the server-rendered `<style id="uich-w-<id>">` for this widget.
 *
 * PHP emits that sheet from an inline <script> (see class-uichemy-composer-widget.php)
 * and it lands in the PREVIEW DOCUMENT'S HEAD, holding the css as it was at the
 * last server render. Once a full rebuild below paints the widget's current css,
 * that sheet is stale by definition — and it is not harmless: it is scoped
 * `.elementor-element-<id> <sel>`, so it goes on winning ties against anything
 * the editor paints, and a declaration the user DELETED still applies from it.
 * The editor owns this widget's look from here on, so remove it; a later server
 * render re-runs the PHP script and puts it back.
 */
function removeServerWidgetCss(active) {
  const widgetId = active && active.model && typeof active.model.get === 'function'
    ? active.model.get('id') : null;
  if (!widgetId) return;
  const docs = [document];
  document.querySelectorAll('iframe').forEach((f) => {
    try { const d = f.contentDocument; if (d) docs.push(d); } catch (_) { /* cross-origin */ }
  });
  docs.forEach((d) => {
    const el = d.getElementById(`uich-w-${widgetId}`);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
}

function rerenderWidgetContainer(active, changedKey) {
  const target = liveSettings(active);
  if (!target || typeof target.get !== 'function') return;

  const widgetId = active && active.model && typeof active.model.get === 'function'
    ? active.model.get('id') : null;

  const rawHtml = target.get('raw_html') || '';
  const rawCss  = target.get('raw_css')  || '';
  const rawJs   = target.get('raw_js')   || '';

  // A raw_css-ONLY change must not rebuild the container NOR re-apply the
  // animation-bearing stylesheet: either re-creates/re-triggers the CSS entrance
  // reveals (opacity:0 + animation-delay), so an animated hero flashes hidden /
  // re-animates on every floating-editor tweak. Push the edited look into a
  // stripped override <style> instead — nodes untouched, animations untouched.
  // Safe for dynamic ({{ }} / {% %}) widgets too: it never touches the HTML.
  if (changedKey === 'raw_css' && !isFullHtmlDocument(rawHtml)) {
    if (updateWidgetCssOverrideInPlace(active, rawCss)) return;
    // Nothing to patch yet → fall through to a full build once.
  }
  // Twig ({% %} / {{ }}) and <uichemy-*> tokens resolve only on the server, so a
  // client-side paint of the raw template can only ever be wrong, it would flash
  // literal template code, and stripping the tokens first blanks real content.
  // Keeping the CURRENT rendered markup until the server swap-in avoids both.
  const isDynamic = UICHEMY_DYNAMIC_TAG_RE.test(rawHtml) || UICH_TWIG_RE.test(rawHtml);
  if (isDynamic) {
    // A server render is the ONLY correct repaint for dynamic content, so ask for
    // one; if that is not possible, leave the DOM alone.
    //
    // The old fallback painted stripDynamicTemplateContent(), a token-free
    // skeleton, over the rendered output. That is not a degraded preview, it is
    // destruction: on the front end there is no Elementor model, so
    // requestServerRender() always returns false, and every style tweak replaced
    // the rendered value with nothing. An element showing "Test" from
    // {{ post.title }} went empty on each edit and only came back on reload,
    // which read the untouched server copy.
    //
    // Keeping the current markup costs a stale preview until the save lands. That
    // is strictly better than blanking correct content, and it matches what
    // applyLive() on the front end already does.
    requestServerRender(active);
    return;
  }
  const previewHtml = rawHtml;

  // Build combined HTML+CSS. JS is intentionally excluded here because
  // innerHTML does NOT execute scripts, JS is appended as a real element below.
  let htmlWithCss = previewHtml;
  // Marked "base" so a later raw_css-only edit knows to leave THIS (animation-
  // bearing) block alone and write a separate stripped override instead.
  //
  // SCOPED exactly like PHP's output (`.elementor-element-<id> <sel>`). Injected
  // raw, this sheet carried selectors one specificity class LOWER than the
  // server-rendered sheet it exists to supersede — `.small-section` (0,1,0) against
  // `.elementor-element-abc .small-section` (0,2,0) — so the server rule kept
  // winning and the edit never appeared on canvas, while the saved css was
  // perfectly correct and showed up the moment the page was rendered again. That
  // is the whole "changes don't show in the editor, but the published preview is
  // right" split. Properties the server sheet did NOT already set (say `opacity`
  // on an element it only styles a child of) did apply, which is what made it look
  // intermittent rather than broken.
  //
  // At equal specificity this wins on document order: the server sheet sits in
  // the preview document's HEAD, this one inside the widget in the BODY. No
  // `!important` needed — the in-place override path uses that because it has to
  // beat THIS sheet too.
  const scopeSelector = widgetId ? `.elementor-element-${widgetId}` : '';
  if (rawCss) {
    htmlWithCss += `<style data-uich-css="1">${scopeCssToWidget(rawCss, scopeSelector)}</style>`;
  }
  // We are about to paint this widget's css in full, so the stale server sheet
  // must go — otherwise a DELETED declaration still applies from it.
  removeServerWidgetCss(active);

  // Primary path: use the view reference Elementor handed us.
  // jQuery .html() parses and executes embedded scripts, so pass the full string.
  if (active && active.view && active.view.$el) {
    const $container = active.view.$el.find('.elementor-widget-container');
    if ($container && $container.length) {
      try {
        if (isFullHtmlDocument(previewHtml)) {
          injectFullDocumentIntoContainer($container[0], previewHtml, rawCss, rawJs);
          return;
        }
        $container.html(htmlWithCss);
        // Re-run init JS scoped to this instance (a bare re-injected <script>
        // wouldn't fire its DOMContentLoaded handler again, see runWidgetInitJs).
        runWidgetInitJs($container[0], rawJs);
        return;
      } catch (_) {}
    }
  }

  // Fallback: view reference is null/stale (e.g. after undo/redo). Search
  // the main document and any iframes (the Elementor preview lives in one).
  // `widgetId` is resolved at the top of this function — the scoped stylesheet
  // above needs it too.
  if (!widgetId) return;
  const docs = [document];
  document.querySelectorAll('iframe').forEach((f) => {
    try { const d = f.contentDocument; if (d) docs.push(d); } catch (_) {}
  });
  for (const d of docs) {
    const el = d.querySelector(`.elementor-element[data-id="${widgetId}"] .elementor-widget-container`);
    if (!el) continue;
    try {
      if (isFullHtmlDocument(previewHtml)) {
        injectFullDocumentIntoContainer(el, previewHtml, rawCss, rawJs);
        break;
      }
      el.innerHTML = htmlWithCss;
      // Re-run init JS scoped to this instance so scroll-reveal / counters
      // re-bind to the new nodes. A bare <script> re-inject wouldn't work:
      // innerHTML doesn't execute it, and its DOMContentLoaded handler can't
      // fire again on an already-loaded page (see runWidgetInitJs).
      runWidgetInitJs(el, rawJs);
    } catch (_) {}
    break;
  }
}

function readSetting(settings, key) {
  if (!settings || typeof settings.get !== 'function') return '';
  const raw = settings.get(key);
  return typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
}

// ---------------------------------------------------------------------------
// Page + Site custom-code propagation (legacy parity).
//
// `page_custom_code_head` / `page_custom_code_footer` and the matching
// `site_custom_code_*` settings are stored on every UiChemy Composer widget.
// When the user edits them on one widget, the legacy editor mirrors the
// value onto every other UiChemy Composer widget in the current Elementor
// document, so opening any of them shows the same head/footer code.
// For site code, the value is additionally persisted to a shared WP
// option via AJAX so it sticks across documents and reloads.

function walkContainers(container, cb) {
  if (!container) return;
  cb(container);
  const kids = container.children;
  if (!kids) return;
  if (typeof kids.each === 'function') {
    kids.each((c) => walkContainers(c, cb));
  } else if (Array.isArray(kids)) {
    kids.forEach((c) => walkContainers(c, cb));
  }
}

function getCurrentDocumentContainer() {
  const el = typeof window !== 'undefined' ? window.elementor : null;
  if (!el || !el.documents) return null;
  // Newer Elementor versions
  if (typeof el.documents.getCurrent === 'function') {
    const doc = el.documents.getCurrent();
    if (doc && doc.container) return doc.container;
  }
  // Fallback: iterate
  const documents = el.documents.documents || {};
  for (const id of Object.keys(documents)) {
    const doc = documents[id];
    if (doc && doc.config && doc.config.type !== 'kit' && doc.container) {
      return doc.container;
    }
  }
  return null;
}

/**
 * Mirror a page/site custom-code setting onto every UiChemy Composer widget in
 * the current document. The active widget (passed as `skipModel`) is
 * skipped because the caller already wrote to it through `settings.set`.
 */
export function propagateComposerSetting(settingKey, value, skipModel) {
  const root = getCurrentDocumentContainer();
  if (!root) return;
  const strVal = value == null ? '' : String(value);
  walkContainers(root, (container) => {
    const model = container.model;
    if (!model || typeof model.get !== 'function') return;
    if (model.get('elType') !== 'widget' || !isComposerWidgetType(model.get('widgetType'))) return;
    if (skipModel && model === skipModel) return;
    const settings = model.get('settings');
    if (!settings || typeof settings.set !== 'function' || typeof settings.get !== 'function') return;
    const cur = settings.get(settingKey) || '';
    if (String(cur) !== strVal) {
      settings.set(settingKey, strVal);
    }
  });
}

// Debounced AJAX save for site-level custom code (legacy mirrors the
// shared values into a WP option via `uichemy_composer_save_site_custom_code`).
let _siteCodeSaveTimer = null;
let _siteCodeSavePending = null;
export function saveSharedSiteCustomCodeDebounced(head, footer) {
  _siteCodeSavePending = { head: head || '', footer: footer || '' };
  if (_siteCodeSaveTimer) clearTimeout(_siteCodeSaveTimer);
  _siteCodeSaveTimer = setTimeout(() => {
    const payload = _siteCodeSavePending;
    _siteCodeSavePending = null;
    _siteCodeSaveTimer = null;
    if (!payload) return;
    const cfg = (typeof window !== 'undefined' && window.uichComposerEditorCfg) || {};
    if (!cfg.ajaxUrl || !cfg.ajaxNonce) return;
    const body = new URLSearchParams();
    body.set('action', 'uichemy_composer_save_site_custom_code');
    body.set('nonce', cfg.ajaxNonce);
    body.set('head',  payload.head);
    body.set('footer', payload.footer);
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

// ---------------------------------------------------------------------------

export function getRestApiBaseUrl() {
  if (typeof window === 'undefined') return '';
  if (window.wpApiSettings && window.wpApiSettings.root) {
    return String(window.wpApiSettings.root).replace(/\/$/, '');
  }
  // Front-end composer: WP core's wpApiSettings isn't localized on the public
  // page. Derive the bare REST root from our front-end config's namespaced
  // restUrl (…/wp-json/uichemy/v1/), callers append their own namespace.
  if (window.uichUiChemyFrontend && window.uichUiChemyFrontend.restUrl) {
    return String(window.uichUiChemyFrontend.restUrl).replace(/\/uichemy\/v1\/?$/, '').replace(/\/$/, '');
  }
  return '/wp-json';
}

export function getRestNonce() {
  if (typeof window === 'undefined') return '';
  if (window.wpApiSettings && window.wpApiSettings.nonce) {
    return String(window.wpApiSettings.nonce);
  }
  // Front-end composer: fall back to our own front-end REST nonce (wp_rest),
  // since wpApiSettings is absent on the public page, without this every panel
  // REST call there is unauthenticated and 401/403s.
  if (window.uichUiChemyFrontend && window.uichUiChemyFrontend.nonce) {
    return String(window.uichUiChemyFrontend.nonce);
  }
  return '';
}

// ── Elementor kit-globals live mirror (used by the Globals Manager's
// "Elementor Sync") ─────────────────────────────────────────────────────────

/** The live Elementor kit document's settings model (null outside the editor). */
function findKitSettingsModel() {
  const el = typeof window !== 'undefined' ? window.elementor : null;
  const documents = el && el.documents && el.documents.documents;
  if (!documents) return null;
  const ids = Object.keys(documents);
  for (const id of ids) {
    const doc = documents[id];
    if (doc && doc.config && doc.config.type === 'kit' && doc.container && doc.container.settings) {
      return doc.container.settings;
    }
  }
  return null;
}

/**
 * Upsert colour/typography rows into the LIVE kit model's custom repeaters so
 * the Elementor editor (and any later Site-Settings save) stays consistent with
 * a sync that was just persisted server-side. No-op outside the editor. Rows are
 * raw kit-repeater shapes ({ _id, title, color } / { _id, title, typography_* });
 * an incoming row REPLACES an existing one with the same _id (so value edits and
 * renames reflect live), otherwise it is appended. A custom row that shadows a
 * system row (same _id, e.g. an updated "primary") is dropped from the system
 * repeater so the kit doesn't carry two rows for one id.
 */
export function upsertKitGlobalsLive(colorRows, typoRows) {
  try {
    const kit = findKitSettingsModel();
    if (!kit || typeof kit.get !== 'function' || typeof kit.set !== 'function') return false;
    const upsert = (customKey, systemKey, incoming) => {
      if (!incoming || !incoming.length) return;
      // Mirror the server's set_or_create: update an existing system row in
      // place, else an existing custom row, else append to custom.
      const system = (Array.isArray(kit.get(systemKey)) ? kit.get(systemKey) : []).slice();
      const custom = (Array.isArray(kit.get(customKey)) ? kit.get(customKey) : []).slice();
      let sysChanged = false;
      incoming.forEach((r) => {
        if (!r || !r._id) return;
        const si = system.findIndex((x) => x && x._id === r._id);
        if (si >= 0) { system[si] = r; sysChanged = true; return; }
        const ci = custom.findIndex((x) => x && x._id === r._id);
        if (ci >= 0) { custom[ci] = r; return; }
        custom.push(r);
      });
      kit.set(customKey, custom);
      if (sysChanged) kit.set(systemKey, system);
    };
    upsert('custom_colors', 'system_colors', colorRows);
    upsert('custom_typography', 'system_typography', typoRows);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Invalidate Elementor's cached globals index so its Global pickers re-read the
 * kit after a sync wrote new tokens. No-op outside the editor. (The old
 * in-composer globals store this used to also refresh was retired with the
 * #uichemy-globals CSS-block migration.)
 */
export function refreshElementorGlobalsPanel() {
  try {
    const $e = typeof window !== 'undefined' ? window.$e : null;
    const comp = $e && $e.components && typeof $e.components.get === 'function'
      ? $e.components.get('globals') : null;
    if (comp && $e.data && typeof $e.data.deleteCache === 'function') {
      $e.data.deleteCache(comp, 'globals/index');
    }
  } catch (_) { /* ignore */ }
}

// Live-inject the globals stylesheet into the editor so value changes show in the
// Elementor preview immediately, no page/refresh needed. On the frontend the
// same CSS is printed by PHP; here we upsert a dedicated <style> into the editor
// document AND the preview iframe(s), appended last so it wins the cascade over
// the server-printed inline style loaded at page open.
export function applyGlobalsCss(css) {
  if (typeof document === 'undefined') return;
  const STYLE_ID = 'uichemy-globals-live';
  const docs = [document];
  try {
    document.querySelectorAll('iframe').forEach((f) => {
      try { const d = f.contentDocument; if (d && d.head) docs.push(d); } catch (_) { /* cross-origin */ }
    });
  } catch (_) { /* noop */ }

  docs.forEach((d) => {
    try {
      const head = d.head || d.getElementsByTagName('head')[0];
      if (!head) return;
      let el = d.getElementById(STYLE_ID);
      if (!el) {
        el = d.createElement('style');
        el.id = STYLE_ID;
        el.setAttribute('data-uichemy', 'globals');
      }
      if (el.textContent !== css) el.textContent = css;
      head.appendChild(el); // (re)append → keep it last so it overrides stale CSS
    } catch (_) { /* noop */ }
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * Frontend bridge (Phase F2), feed the panel from the live page instead of
 * the Elementor editor. Builds a minimal Backbone-like settings model backed
 * by data fetched over REST, then drives the same `store` the editor uses so
 * the whole React panel works unchanged.
 * ───────────────────────────────────────────────────────────────────────── */

let frontendChangeHook = null;

/** Register a callback fired on every frontend settings write (DOM apply / save). */
export function setFrontendChangeHook(fn) {
  frontendChangeHook = typeof fn === 'function' ? fn : null;
}

/** Minimal Backbone-compatible settings model (get/set/on/off/trigger). */
function makeFrontendSettings(initial) {
  const data = Object.assign({}, initial || {});
  const listeners = Object.create(null);

  const model = {
    get(key) { return data[key]; },
    set(key, value) {
      if (key && typeof key === 'object') {
        Object.keys(key).forEach((k) => model.set(k, key[k]));
        return model;
      }
      const before = data[key];
      data[key] = value;
      if (before !== value) {
        model.trigger(`change:${key}`, model, value, {});
        model.trigger('change', model);
        // Skip live-apply/save ONLY during initial load-time slot derivation
        // (setActiveFrontendWidget sets __uichFrontendLoading). Do NOT gate on
        // __uichComposerSlotSyncing: the Direct Editor's slot→raw_html sync sets
        // that flag during genuine user edits, so gating on it would drop the
        // raw_html write and the edit would never save (revert on refresh).
        if (frontendChangeHook && !model.__uichFrontendLoading) {
          try { frontendChangeHook(key, value, data); } catch (_) {}
        }
      }
      return model;
    },
    on(ev, fn) { (listeners[ev] || (listeners[ev] = new Set())).add(fn); return model; },
    off(ev, fn) { if (listeners[ev]) listeners[ev].delete(fn); return model; },
    trigger(ev) {
      const args = Array.prototype.slice.call(arguments, 1);
      if (listeners[ev]) listeners[ev].forEach((fn) => { try { fn.apply(null, args); } catch (_) {} });
      return model;
    },
    toJSON() { return Object.assign({}, data); },
  };
  return model;
}

/**
 * Make a frontend-fetched widget the active widget in the panel.
 *
 * @param {object} initial  { raw_html, raw_css, raw_js, _title, widget_id, __elementId }
 * @returns {{ model:object, settings:object }}
 */
export function setActiveFrontendWidget(initial) {
  const settings = makeFrontendSettings(initial);
  // Derive slot_N settings from raw_html so the Direct Editor (layers + text
  // nodes) has data to bind to, the same step bindWidget runs in the editor.
  // __uichFrontendLoading suppresses live-apply/save ONLY for this initial
  // derivation, so it never auto-saves on load (real user edits still save).
  settings.__uichFrontendLoading = true;
  try { syncSlotsFromRawHtml(settings, null); } catch (e) { /* Direct Editor optional */ }
  settings.__uichFrontendLoading = false;
  const builder = (initial && initial.builder) || 'elementor';
  const uid = (initial && initial.uid) || '';
  const model = {
    get(key) {
      if (key === 'settings') return settings;
      if (key === 'widgetType') return COMPOSER_WIDGET_TYPE;
      if (key === 'uid') return uid;
      if (key === 'id') {
        // Gutenberg/Bricks resolve their live DOM root by uid / scope class
        // (getWidgetRoot), not an Elementor data-id — so hand back the uid there.
        if ('gutenberg' === builder || 'bricks' === builder) {
          return uid || (initial && initial.widget_id) || '';
        }
        return (initial && (initial.__elementId || initial.widget_id)) || '';
      }
      return undefined;
    },
  };
  // Tag the model so getWidgetRoot takes the matching branch. Only ever read by
  // getWidgetRoot; the editor bridges set the same flags (composer-gutenberg.jsx /
  // composer-bricks.jsx).
  if ('gutenberg' === builder) model.__uichGutenberg = true;
  else if ('bricks' === builder) model.__uichBricks = true;
  store.setActive({ panel: null, model, view: null, settings });
  return { model, settings };
}

/** Clear the active frontend widget (deselect). */
export function clearActiveFrontendWidget() {
  store.clear();
}
