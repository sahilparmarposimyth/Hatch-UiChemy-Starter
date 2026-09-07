// React wrapper around `wp.codeEditor.initialize`, mirrors how the legacy
// editor wires CodeMirror onto a textarea inside the floating panel.
import React from 'react';
import { getUiChemyGlobalsSnapshot, groupUiChemyGlobals } from './composer-variables';

// CSS-editor autocomplete: type "/" to open a grouped, collapsible globals
// picker at the cursor. Groups (by tab) are collapsed by default so the list
// stays short, click a group to unfold it, or type in the filter box. Picking
// an item inserts var(--id) in place of the "/".
function attachGlobalsHint(cm) {
  if (!cm) return function () {};

  let popup = null;

  function close() {
    if (!popup) return;
    document.removeEventListener('mousedown', onDocDown, true);
    try { popup.remove(); } catch (e) { /* noop */ }
    popup = null;
  }
  function onDocDown(e) { if (popup && !popup.contains(e.target)) close(); }

  function open() {
    close();
    const cur   = cm.getCursor();
    const upto  = cm.getLine(cur.line).slice(0, cur.ch);
    const slash = upto.lastIndexOf('/');
    if (slash === -1) return;
    const fromPos = { line: cur.line, ch: slash };
    const toPos   = { line: cur.line, ch: slash + 1 }; // just the "/"

    const groups = groupUiChemyGlobals(getUiChemyGlobalsSnapshot(), {});
    if (!groups.length) return;

    const coords = cm.cursorCoords(true, 'page');
    popup = document.createElement('div');
    popup.className = 'pr-cm-globals';
    popup.style.left = coords.left + 'px';
    popup.style.top  = (coords.bottom + 4) + 'px';

    const search = document.createElement('input');
    search.className = 'pr-cm-globals-search';
    search.type = 'text';
    search.placeholder = 'Search globals…';
    popup.appendChild(search);

    const listWrap = document.createElement('div');
    listWrap.className = 'pr-cm-globals-list';
    popup.appendChild(listWrap);

    const openState = {}; // groupId -> expanded

    function insert(id) {
      cm.replaceRange('var(--' + id + ')', fromPos, toPos);
      close();
      cm.focus();
    }

    function render() {
      const q = search.value.trim().toLowerCase();
      listWrap.textContent = '';
      let shown = 0;
      groups.forEach((g) => {
        const matches = g.items.filter((it) => !q
          || String(it.name).toLowerCase().includes(q)
          || String(it.id).toLowerCase().includes(q));
        if (q && !matches.length) return;
        const expanded = q ? true : !!openState[g.id];

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'pr-cm-globals-group';
        const caret = document.createElement('span');
        caret.className = 'pr-cm-caret';
        caret.textContent = expanded ? '▾' : '▸';
        const gname = document.createElement('span');
        gname.className = 'pr-cm-gname';
        gname.textContent = g.name;
        const gcount = document.createElement('span');
        gcount.className = 'pr-cm-count';
        gcount.textContent = String(matches.length);
        head.appendChild(caret); head.appendChild(gname); head.appendChild(gcount);
        head.addEventListener('click', () => { openState[g.id] = !expanded; render(); });
        listWrap.appendChild(head);
        shown += 1;

        if (expanded) {
          matches.forEach((it) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'pr-cm-globals-item';
            const sw = document.createElement('span');
            sw.className = 'pr-cm-sw' + (it.type === 'color' ? '' : ' pr-cm-sw-txt');
            if (it.type === 'color') { sw.style.background = it.value || 'transparent'; }
            else { sw.textContent = '{}'; }
            const nm = document.createElement('span');
            nm.className = 'pr-cm-name';
            nm.textContent = it.name;
            const vr = document.createElement('span');
            vr.className = 'pr-cm-var';
            vr.textContent = 'var(--' + it.id + ')';
            item.appendChild(sw); item.appendChild(nm); item.appendChild(vr);
            item.addEventListener('click', () => insert(it.id));
            listWrap.appendChild(item);
          });
        }
      });
      if (!shown) {
        const empty = document.createElement('div');
        empty.className = 'pr-cm-globals-empty';
        empty.textContent = 'No match';
        listWrap.appendChild(empty);
      }
    }

    render();
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); cm.focus(); } });
    document.body.appendChild(popup);
    document.addEventListener('mousedown', onDocDown, true);
    setTimeout(() => { try { search.focus(); } catch (e) { /* noop */ } }, 0);
  }

  const onInput = (cmInst, change) => {
    if (change && change.text && change.text[0] === '/') setTimeout(open, 0);
  };
  cm.on('inputRead', onInput);
  getUiChemyGlobalsSnapshot(); // warm the cache
  return function () { try { cm.off('inputRead', onInput); } catch (e) { /* noop */ } close(); };
}

const FALLBACK_MODES = {
  html: 'htmlmixed',
  css: 'css',
  js: 'javascript',
};

function getSettings(languageKey) {
  const all = (typeof window !== 'undefined' && window.uichComposerEditorCfg) || {};
  if (all[languageKey]) return all[languageKey];
  const wp = typeof window !== 'undefined' ? window.wp : null;
  const defaults = (wp && wp.codeEditor && wp.codeEditor.defaultSettings) || {};
  const codemirror = Object.assign({}, defaults.codemirror || {}, {
    mode: FALLBACK_MODES[languageKey] || 'htmlmixed',
    lineNumbers: true,
    lineWrapping: false,
    indentUnit: 2,
    tabSize: 2,
    matchBrackets: true,
    autoCloseBrackets: true,
  });
  return Object.assign({}, defaults, { codemirror });
}

function canInit() {
  return typeof window !== 'undefined' &&
    window.wp && window.wp.codeEditor &&
    typeof window.wp.codeEditor.initialize === 'function';
}

let uid = 0;
function nextId() { return `uich-cm-${++uid}-${Date.now().toString(36)}`; }

export function CodeMirrorEditor({ languageKey, value, onChange, disabled, readOnly }) {
  const textareaRef = React.useRef(null);
  const editorRef = React.useRef(null);
  const lastSetRef = React.useRef(value || '');
  const onChangeRef = React.useRef(onChange);

  React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Initialize CodeMirror once, when the textarea mounts and wp.codeEditor is available.
  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return undefined;
    if (!ta.id) ta.id = nextId();
    if (!canInit()) {
      // Fall back to a plain textarea, keep React state in sync via onChange.
      ta.value = value || '';
      const handler = (e) => {
        lastSetRef.current = e.target.value;
        onChangeRef.current?.(e.target.value);
      };
      ta.addEventListener('input', handler);
      return () => ta.removeEventListener('input', handler);
    }

    const editor = window.wp.codeEditor.initialize(ta, getSettings(languageKey));
    editorRef.current = editor;
    const cm = editor && editor.codemirror;
    if (!cm) return undefined;
    cm.setOption('lineNumbers', true);
    cm.setOption('lineWrapping', false);
    cm.setOption('readOnly', !!readOnly);
    cm.setSize('100%', '100%');
    cm.setValue(value || '');
    lastSetRef.current = value || '';

    const handleChange = () => {
      const v = cm.getValue();
      lastSetRef.current = v;
      onChangeRef.current?.(v);
    };
    cm.on('change', handleChange);

    // "/" → globals autocomplete (CSS editors only), inserts var(--id).
    const detachHint = languageKey === 'css' ? attachGlobalsHint(cm) : null;

    // CodeMirror sometimes needs a refresh after being mounted in a
    // detached/hidden container (panel tab switching).
    setTimeout(() => { try { cm.refresh(); } catch (_) {} }, 0);

    return () => {
      try { if (detachHint) detachHint(); } catch (_) {}
      try { cm.off('change', handleChange); } catch (_) {}
      try { cm.toTextArea(); } catch (_) {}
      editorRef.current = null;
    };
    // languageKey changes are rare; if it does, we want a full re-init.
  }, [languageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // External value → CodeMirror sync.
  React.useEffect(() => {
    const editor = editorRef.current;
    const cm = editor && editor.codemirror;
    const next = value || '';
    if (cm) {
      // Don't overwrite the document while the user is actively typing in it.
      // raw_html/raw_css/raw_js writes trigger a widget re-render + Backbone
      // change echo on every keystroke, and that value round-trips back here.
      // If it differs even slightly from what CodeMirror emitted (Backbone /
      // Elementor normalization), calling cm.setValue() mid-keystroke replaces
      // the whole doc and resets the cursor, which is what breaks typing and
      // Enter. When the editor is focused it already holds the latest text, so
      // only apply external updates when focus is elsewhere (Format, AI sync…).
      if (cm.hasFocus()) return;
      if (next !== lastSetRef.current) {
        const cursor = cm.getCursor();
        cm.setValue(next);
        try { cm.setCursor(cursor); } catch (_) {}
        lastSetRef.current = next;
      }
    } else if (textareaRef.current && textareaRef.current.value !== next) {
      textareaRef.current.value = next;
      lastSetRef.current = next;
    }
  }, [value]);

  React.useEffect(() => {
    const cm = editorRef.current && editorRef.current.codemirror;
    if (cm) cm.setOption('readOnly', !!readOnly);
  }, [readOnly]);

  return (
    <textarea
      ref={textareaRef}
      className="uich-cm-textarea"
      defaultValue={value || ''}
      disabled={disabled}
      spellCheck={false}
    />
  );
}
