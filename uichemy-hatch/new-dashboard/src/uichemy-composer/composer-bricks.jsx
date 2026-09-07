// Bricks bridge, feeds the active `uichemy-composer` Bricks element's settings
// into the composer store, mirroring composer-gutenberg.jsx.
//
// VERIFIED against a real Bricks 2.x install (theme zip tested live, not just
// read from a third-party addon's source). Deliberately backed by direct DOM
// read/write on the rendered `uichemy_settings` control's <textarea> –
// dispatching native input/change events so Bricks' own two-way binding
// persists the change, rather than calling into Bricks' internal
// element-store API directly, since Bricks only ever shows ONE element's
// settings panel at a time (confirmed live: the control wrapper carries no
// per-element id, just a stable `data-controlkey` on the control itself), so
// no per-element scoping is needed, there's only ever one match.
import { setActiveComposerWidget, clearActiveComposerWidget } from './composer-elementor';

// Temporary diagnostics for the "Bricks floating-toolbar edits don't persist"
// bug — gated behind a flag so it is silent unless explicitly turned on with
// `window.UICH_DEBUG_BRICKS_SAVE = true` in the console. Remove once the persist
// path is confirmed fixed.
function bLog() {
  try {
    if (typeof window !== 'undefined' && window.UICH_DEBUG_BRICKS_SAVE) {
      // eslint-disable-next-line no-console
      console.log.apply(console, ['[UiChemy bricks-save]'].concat(Array.prototype.slice.call(arguments)));
    }
  } catch (_) { /* noop */ }
}

function findSettingsTextarea() {
  if (typeof document === 'undefined') return null;
  // Confirmed live markup: <div data-controlkey="uichemy_settings"><div
  // class="control control-textarea..."><div data-control="textarea">
  // <textarea>...</textarea></div></div></div>, the textarea has no name
  // attribute at all, so `data-controlkey` on the ancestor is the only anchor.
  return document.querySelector('[data-controlkey="uichemy_settings"] textarea');
}

function readElementSettings(elementId) {
  const ta = findSettingsTextarea();
  if (!ta) return {};
  try {
    const parsed = JSON.parse(ta.value || '{}');
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeElementSettings(elementId, next) {
  const ta = findSettingsTextarea();
  bLog('writeElementSettings', 'textareaFound=', !!ta, 'keys=', next && Object.keys(next),
    'raw_html.len=', next && next.raw_html ? String(next.raw_html).length : 0,
    'raw_css.len=', next && next.raw_css ? String(next.raw_css).length : 0);
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  // Native setter bypass so frameworks with their own value-tracking (Vue/React
  // on the Bricks side) still see the change via the dispatched input event,
  // the same technique React's own controlled-input internals rely on.
  const wrote = JSON.stringify(next);
  setter.call(ta, wrote);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
  // DIAGNOSTIC: is the textarea actually v-model bound (Vue sets el._assign), and
  // does our written value survive, or does something revert it a moment later?
  bLog('afterWrite', 'vModelAssign=', typeof ta._assign,
    'hasVueParent=', !!ta.__vueParentComponent,
    'valStuck=', ta.value === wrote, 'len=', ta.value.length);
  try {
    const expected = wrote;
    setTimeout(function () {
      const ta2 = findSettingsTextarea();
      bLog('afterWrite+500ms', 'sameTextarea=', ta2 === ta,
        'stillOurs=', !!ta2 && ta2.value === expected,
        'len=', ta2 ? ta2.value.length : -1);
    }, 500);
  } catch (_) { /* noop */ }
  return true;
}

// Backbone-like settings model, identical contract to composer-gutenberg.jsx's,
// since both feed the same generic composer store.
function makeSettingsModel(elementId) {
  const local = readElementSettings(elementId);
  const listeners = Object.create(null);
  let flushTimer = null;

  function emit(event) {
    const cbs = listeners[event];
    if (cbs) cbs.slice().forEach((cb) => { try { cb(); } catch (e) { /* ignore */ } });
  }

  function flush() {
    flushTimer = null;
    bLog('flush → writeElementSettings', 'elementId=', elementId);
    writeElementSettings(elementId, local);
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 150);
  }

  const model = {
    __uichBricks: true,
    elementId,
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
      bLog('settingsModel.set', 'changed=', changed);
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

function makeWidgetModel(elementId, settingsModel) {
  return {
    __uichBricks: true,
    get(key) {
      if (key === 'settings') return settingsModel;
      if (key === 'widgetType') return 'uichemy_composer';
      if (key === 'id') return elementId;
      return undefined;
    },
  };
}

let activeElementId = null;
let activeWidgetModel = null;

export function activateBricksComposer(elementId) {
  if (!elementId) return;
  if (elementId === activeElementId && activeWidgetModel) return;
  activeElementId = elementId;
  const settingsModel = makeSettingsModel(elementId);
  activeWidgetModel = makeWidgetModel(elementId, settingsModel);
  setActiveComposerWidget({ panel: null, model: activeWidgetModel, view: null });
}

export function deactivateBricksComposer(elementId) {
  if (elementId && elementId !== activeElementId) return;
  activeElementId = null;
  activeWidgetModel = null;
  clearActiveComposerWidget();
}

export function getActiveBricksElementId() {
  return activeElementId;
}

// Write a setting through the ACTIVE element's shim model (so the React panel,
// slot-sync, preview and persistence all stay consistent).
export function setActiveBricksSetting(elementId, key, value) {
  if (!activeWidgetModel || (elementId && elementId !== activeElementId)) return false;
  const settings = activeWidgetModel.get('settings');
  if (settings && typeof settings.set === 'function') {
    settings.set(key, value);
    return true;
  }
  return false;
}

// Expose a tiny global API the Bricks adapter (plain JS, outside this bundle)
// calls on element selection / panel-open. Mirrors window.UichComposerGutenberg's
// shape exactly.
export function initBricksBridge() {
  if (typeof window === 'undefined') return;
  window.UichComposerBricks = {
    activate: activateBricksComposer,
    deactivate: deactivateBricksComposer,
    getActiveClientId: getActiveBricksElementId,
    setSetting: setActiveBricksSetting,
  };
}
