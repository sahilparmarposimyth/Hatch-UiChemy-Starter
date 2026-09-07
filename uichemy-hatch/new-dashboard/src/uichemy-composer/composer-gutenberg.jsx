// Gutenberg bridge, feeds the active `uichemy/composer` block's settings into
// the composer store, mirroring the Elementor bridge (composer-elementor.jsx)
// but backed by `wp.data` block attributes instead of an Elementor Backbone model.
//
// The React panel reads the active widget through the same store, so once a block
// is made active here the entire editor (Layers / Code / Chat) works unchanged.
import { setActiveComposerWidget, clearActiveComposerWidget } from './composer-elementor';

function wpData() {
  return (typeof window !== 'undefined' && window.wp && window.wp.data) ? window.wp.data : null;
}

function readBlockSettings(clientId) {
  const wp = wpData();
  if (!wp) return {};
  const attrs = wp.select('core/block-editor').getBlockAttributes(clientId) || {};
  const s = attrs.settings;
  return (s && typeof s === 'object') ? Object.assign({}, s) : {};
}

// Backbone-like settings model over a block's `settings` object attribute.
// An in-memory snapshot is the synchronous source of truth (the composer reads
// settings back immediately after writing, e.g. in slot-sync loops); writes are
// mirrored to wp.data on a debounce so we don't dispatch dozens of times per edit.
function makeSettingsModel(clientId) {
  const local = readBlockSettings(clientId);
  const listeners = Object.create(null);
  let flushTimer = null;

  function emit(event) {
    const cbs = listeners[event];
    if (cbs) {
      cbs.slice().forEach((cb) => { try { cb(); } catch (e) { /* ignore */ } });
    }
  }

  function flush() {
    flushTimer = null;
    const wp = wpData();
    if (!wp) return;
    const out = {};
    Object.keys(local).forEach((k) => {
      // Skip internal flags (e.g. __uichComposerSlotSyncing), those live on the
      // model object, never in the persisted attribute, but guard here anyway.
      if (k.indexOf('__') !== 0) out[k] = local[k];
    });
    try {
      wp.dispatch('core/block-editor').updateBlockAttributes(clientId, { settings: out });
    } catch (e) { /* ignore */ }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 150);
  }

  const model = {
    __uichGutenberg: true,
    clientId,
    get(key) {
      return key === undefined ? local : local[key];
    },
    set(key, value) {
      let patch;
      if (key && typeof key === 'object') {
        patch = key;
      } else {
        patch = {};
        patch[key] = value;
      }
      const changed = [];
      Object.keys(patch).forEach((k) => {
        if (local[k] !== patch[k]) {
          local[k] = patch[k];
          changed.push(k);
        }
      });
      if (!changed.length) return model;
      scheduleFlush();
      changed.forEach((k) => emit('change:' + k));
      emit('change');
      return model;
    },
    on(event, cb) {
      (listeners[event] = listeners[event] || []).push(cb);
      return model;
    },
    off(event, cb) {
      if (listeners[event]) {
        if (cb) {
          listeners[event] = listeners[event].filter((f) => f !== cb);
        } else {
          delete listeners[event];
        }
      }
      return model;
    },
    trigger(event) {
      emit(event);
      return model;
    },
  };
  return model;
}

// Widget-model wrapper: the composer expects model.get('settings'|'widgetType'|'id').
function makeWidgetModel(clientId, settingsModel) {
  return {
    __uichGutenberg: true,
    get(key) {
      if (key === 'settings') return settingsModel;
      if (key === 'widgetType') return 'uichemy_composer';
      if (key === 'id') return clientId;
      // The block's `uid` attribute (distinct from `id`/clientId, which is an
      // ephemeral per-session identifier). The rendered DOM carries it as
      // `.uichemy-composer-<uid>`, so it's the only stable way to locate this
      // block's preview element in the canvas, used by getWidgetRoot() in
      // composer-pick.jsx to make the Editor-tab element picker work under
      // Gutenberg (Elementor has no equivalent, hence no `uid`).
      if (key === 'uid') {
        const wp = wpData();
        if (!wp) return '';
        try {
          const attrs = wp.select('core/block-editor').getBlockAttributes(clientId) || {};
          return typeof attrs.uid === 'string' ? attrs.uid : '';
        } catch (e) { return ''; }
      }
      return undefined;
    },
  };
}

let activeClientId = null;
let activeWidgetModel = null;

export function activateGutenbergComposer(clientId) {
  if (!clientId || !wpData()) return;
  // Idempotent: re-selecting the active block keeps its in-memory model (and any
  // in-flight edits) intact instead of rebuilding from a possibly-stale snapshot.
  if (clientId === activeClientId && activeWidgetModel) return;

  activeClientId = clientId;
  const settingsModel = makeSettingsModel(clientId);
  activeWidgetModel = makeWidgetModel(clientId, settingsModel);
  setActiveComposerWidget({ panel: null, model: activeWidgetModel, view: null });
}

export function deactivateGutenbergComposer(clientId) {
  if (clientId && clientId !== activeClientId) return;
  activeClientId = null;
  activeWidgetModel = null;
  clearActiveComposerWidget();
}

export function getActiveGutenbergClientId() {
  return activeClientId;
}

// Write a setting through the ACTIVE block's shim model (so the React panel,
// slot-sync, preview and persistence all stay consistent). Returns true when the
// write was routed through the shim; false when no matching block is active (the
// caller should then write block attributes directly).
export function setActiveGutenbergSetting(clientId, key, value) {
  if (!activeWidgetModel || (clientId && clientId !== activeClientId)) return false;
  const settings = activeWidgetModel.get('settings');
  if (settings && typeof settings.set === 'function') {
    settings.set(key, value);
    return true;
  }
  return false;
}

// ── Page-scope ops (Gutenberg equivalents of the chat's Elementor helpers) ──
function blockEditorSelect() {
  const wp = wpData();
  return wp ? wp.select('core/block-editor') : null;
}
function blockEditorDispatch() {
  const wp = wpData();
  return wp ? wp.dispatch('core/block-editor') : null;
}
function collectComposerBlocks(blocks, out) {
  (blocks || []).forEach((b) => {
    if (b && b.name === 'uichemy/composer') out.push(b);
    if (b && b.innerBlocks && b.innerBlocks.length) collectComposerBlocks(b.innerBlocks, out);
  });
  return out;
}
function blockSettings(clientId) {
  const sel = blockEditorSelect();
  if (!sel) return {};
  const attrs = sel.getBlockAttributes(clientId) || {};
  return (attrs.settings && typeof attrs.settings === 'object') ? attrs.settings : {};
}
function gen7() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * 36)];
  return s;
}

// List every uichemy/composer block on the page. `id` is the block clientId –
// the chat/agent use it as the widget id (parity with Elementor's element id).
export function gbListComposerBlocks() {
  const sel = blockEditorSelect();
  if (!sel) return [];
  return collectComposerBlocks(sel.getBlocks(), []).map((b) => {
    const s = (b.attributes && b.attributes.settings) || {};
    return {
      id: b.clientId,
      label: s._title || ('Block ' + String(b.clientId).slice(0, 6)),
      htmlPreview: String(s.raw_html || '').slice(0, 200),
    };
  });
}

export function gbReadSetting(clientId, key) {
  return blockSettings(clientId)[key] || '';
}

// Write a setting on ANY composer block. Routes through the active shim when the
// target is the active block (keeps panel/slot-sync/preview consistent).
export function gbWriteSetting(clientId, key, value) {
  if (clientId && clientId === activeClientId && activeWidgetModel) {
    const sm = activeWidgetModel.get('settings');
    if (sm && typeof sm.set === 'function') { sm.set(key, value); return true; }
  }
  const sel = blockEditorSelect();
  const disp = blockEditorDispatch();
  if (!sel || !disp) return false;
  const next = { ...blockSettings(clientId) };
  next[key] = value;
  disp.updateBlockAttributes(clientId, { settings: next });
  return true;
}

export function gbGetPageCode() {
  const sel = blockEditorSelect();
  if (!sel) return { head: '', body: '' };
  let head = '', body = '';
  collectComposerBlocks(sel.getBlocks(), []).some((b) => {
    const s = (b.attributes && b.attributes.settings) || {};
    if (!head) head = s.page_custom_code_head || '';
    if (!body) body = s.page_custom_code_footer || '';
    return head && body;
  });
  return { head, body };
}

export function gbSetPageCode(head, body) {
  const sel = blockEditorSelect();
  if (!sel) return { success: false, error: 'Block editor not available.' };
  const cur = gbGetPageCode();
  const newHead = typeof head === 'string' ? head : cur.head;
  const newBody = typeof body === 'string' ? body : cur.body;
  const blocks = collectComposerBlocks(sel.getBlocks(), []);
  blocks.forEach((b) => {
    gbWriteSetting(b.clientId, 'page_custom_code_head', newHead);
    gbWriteSetting(b.clientId, 'page_custom_code_footer', newBody);
  });
  return { success: blocks.length > 0, widgetsUpdated: blocks.length };
}

// Insert a new composer block after `afterClientId` (or append when omitted).
export function gbInsertComposerAfter(afterClientId, html, css, js, label) {
  const sel = blockEditorSelect();
  const disp = blockEditorDispatch();
  if (!sel || !disp || !window.wp || !window.wp.blocks) {
    return { success: false, error: 'Block editor not available.' };
  }
  const block = window.wp.blocks.createBlock('uichemy/composer', {
    uid: gen7(),
    settings: {
      _title: label || 'New Section',
      raw_html: html || '',
      raw_css: css || '',
      raw_js: js || '',
    },
  });
  let rootClientId = '';
  let index;
  if (afterClientId) {
    rootClientId = sel.getBlockRootClientId(afterClientId) || '';
    index = sel.getBlockIndex(afterClientId) + 1;
  }
  disp.insertBlock(block, index, rootClientId || undefined);
  return { success: true, widgetId: block.clientId, label: label || 'New Section', position: index == null ? -1 : index };
}

// Expose a tiny global API the block's editor script (plain JS, outside this
// bundle) calls on selection / panel-open.
export function initGutenbergBridge() {
  if (typeof window === 'undefined') return;
  window.UichComposerGutenberg = {
    activate: activateGutenbergComposer,
    deactivate: deactivateGutenbergComposer,
    getActiveClientId: getActiveGutenbergClientId,
    setSetting: setActiveGutenbergSetting,
    // Page-scope ops used by the chat bridge:
    listComposerBlocks: gbListComposerBlocks,
    readSetting: gbReadSetting,
    writeSetting: gbWriteSetting,
    getPageCode: gbGetPageCode,
    setPageCode: gbSetPageCode,
    insertComposerAfter: gbInsertComposerAfter,
  };
}
