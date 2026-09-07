// Session Undo/Redo for the composer — Phase 1.
//
// SCOPE: the active widget's raw_html + raw_css only, kept in browser memory for
// the current editing session (NOT the DB — that is Phase 3 "who changed what").
// Each widget gets its own snapshot stack so undoing on one never touches another.
//
// A snapshot is a full picture of the widget's editable state at a moment:
//   { raw_html, raw_css, selected }   (selected = layer path, best-effort)
//
// Recording is driven by composer-app watching [rawHtml, rawCss]: whenever they
// settle it calls record(). Undo/redo write the chosen snapshot back through the
// SAME builder-aware setters (writeHtml / setRawCss), so Elementor / Gutenberg /
// Bricks are all covered with no per-builder code. The equal-check in record()
// means an undo/redo re-applying a value never records a spurious new entry — so
// no "applying" flag is needed.

const CAP = 50;          // max snapshots kept per widget (memory bound)
const COALESCE_MS = 450; // edits closer than this merge into one undo step

// widgetId -> { stack: snapshot[], index: number, lastTime: number }
const store = new Map();

// ── Whole-page (global) undo order ─────────────────────────────────────────
// A single chronological list of scope keys — one entry per real undo STEP
// (push) across ALL scopes (every widget + page + site). `gPtr` is how many of
// those steps are currently applied; global undo walks it backwards, redo
// forwards. This lets Ctrl+Z undo the last change ANYWHERE on the page, in the
// order it happened, regardless of which element is selected.
let gMoves = [];
let gPtr = 0;
function pushMove(scope) {
  gMoves = gMoves.slice(0, gPtr); // drop the redo tail
  gMoves.push(scope);
  gPtr = gMoves.length;
}

function ensure(id) {
  let e = store.get(id);
  if (!e) { e = { stack: [], index: -1, lastTime: 0 }; store.set(id, e); }
  return e;
}

function sameSnap(a, b) {
  return !!a && !!b && a.raw_html === b.raw_html && a.raw_css === b.raw_css;
}

// A short human label for what changed between two snapshots — powers the
// History panel ("Content edited" / "Style changed"). Best-effort, never throws.
function deriveLabel(prev, next) {
  if (!prev) return 'Initial';
  const htmlChanged = prev.raw_html !== next.raw_html;
  const cssChanged = prev.raw_css !== next.raw_css;
  if (htmlChanged && cssChanged) return 'Content + style';
  if (htmlChanged) return 'Content edited';
  if (cssChanged) return 'Style changed';
  return 'Changed';
}

function nowMs() { return (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0; }

/** Seed a widget's history with its initial state (once, on first load). */
export function seedHistory(id, snap) {
  if (!id) return;
  const e = ensure(id);
  if (snap && snap.wlabel) e.wlabel = snap.wlabel; // remember the widget's display name
  if (e.stack.length) return; // already seeded / has history
  e.stack = [{
    raw_html: snap.raw_html || '', raw_css: snap.raw_css || '', selected: snap.selected || null,
    label: 'Opened', who: (snap && snap.who) || '', time: nowMs(), wlabel: (snap && snap.wlabel) || '',
  }];
  e.index = 0;
  e.lastTime = 0; // 0 so the FIRST real edit always pushes (never merges into the seed)
}

/**
 * Set a scope's CURRENT tip value WITHOUT pushing a new undo step or a global
 * move. Used when a value settles from a load/select (front-end sections load
 * async), so that settle re-baselines the tip instead of masquerading as an edit.
 */
export function setTip(id, snap) {
  if (!id) return;
  const e = ensure(id);
  if (snap && snap.wlabel) e.wlabel = snap.wlabel;
  const html = snap.raw_html || '';
  const css = snap.raw_css || '';
  if (e.stack.length === 0) {
    e.stack = [{ raw_html: html, raw_css: css, selected: null, label: 'Opened', who: (snap && snap.who) || '', time: nowMs(), wlabel: (snap && snap.wlabel) || '' }];
    e.index = 0;
  } else {
    const tip = e.stack[e.index];
    tip.raw_html = html;
    tip.raw_css = css;
    if (snap && snap.wlabel) tip.wlabel = snap.wlabel;
  }
  e.lastTime = 0; // the next real edit starts a fresh step from this baseline
}

/**
 * Record a new state. No-op if it equals the current entry (covers undo/redo
 * echoes and no-op writes). Rapid consecutive edits (< COALESCE_MS) REPLACE the
 * top entry so a burst of typing/slider drags collapses into one undo step.
 *
 * Returns a truthy tag when a change was recorded, false when skipped as
 * unchanged: 'push' (new undo step — also extends the global page order),
 * 'merge' (coalesced into the in-progress burst), or 'seed' (first baseline
 * entry). Callers that just gate DB writes can treat any truthy value as "changed".
 */
export function recordHistory(id, snap) {
  if (!id) return false;
  const e = ensure(id);
  if (snap && snap.wlabel) e.wlabel = snap.wlabel;
  const prev = e.stack[e.index] || null;
  const next = {
    raw_html: snap.raw_html || '', raw_css: snap.raw_css || '', selected: snap.selected || null,
    // Non-widget scopes (page/site code) pass an explicit label; widgets derive it.
    label: (snap && snap.label) || deriveLabel(prev, { raw_html: snap.raw_html || '', raw_css: snap.raw_css || '' }),
    who: (snap && snap.who) || '', time: nowMs(),
    wlabel: (snap && snap.wlabel) || (prev && prev.wlabel) || e.wlabel || '',
  };
  if (e.stack.length === 0) { next.label = 'Opened'; e.stack = [next]; e.index = 0; e.lastTime = 0; return 'seed'; }
  if (sameSnap(e.stack[e.index], next)) return false; // unchanged / echo → skip

  const now = next.time;
  const merge = e.index > 0 && now && (now - e.lastTime) < COALESCE_MS;
  if (merge) {
    // Extend the in-progress burst but KEEP the burst's original label/time so it
    // still reads as one action. Same undo step → no new global move.
    next.label = e.stack[e.index].label;
    next.time = e.stack[e.index].time;
    e.stack[e.index] = next;
    e.lastTime = now;
    return 'merge';
  }
  e.stack = e.stack.slice(0, e.index + 1); // drop any redo tail
  e.stack.push(next);
  e.index = e.stack.length - 1;
  if (e.stack.length > CAP) { e.stack.shift(); e.index -= 1; }
  e.lastTime = now;
  pushMove(id); // a new undo step joins the whole-page order
  return 'push';
}

export function canUndo(id) { const e = store.get(id); return !!e && e.index > 0; }
export function canRedo(id) { const e = store.get(id); return !!e && e.index < e.stack.length - 1; }

/** Step back one snapshot and return it (or null). */
export function undoHistory(id) {
  const e = store.get(id);
  if (!e || e.index <= 0) return null;
  e.index -= 1;
  e.lastTime = 0; // the next edit after an undo starts a fresh (non-merged) step
  return e.stack[e.index];
}

/** Step forward one snapshot and return it (or null). */
export function redoHistory(id) {
  const e = store.get(id);
  if (!e || e.index >= e.stack.length - 1) return null;
  e.index += 1;
  e.lastTime = 0;
  return e.stack[e.index];
}

/**
 * Snapshot metadata for the History panel — newest first. Each row carries the
 * ABSOLUTE stack index so a click can jump straight to it.
 */
export function getHistory(id) {
  const e = store.get(id);
  if (!e || !e.stack.length) return { entries: [], index: -1 };
  const entries = e.stack.map((s, i) => ({
    i, label: s.label || 'Changed', who: s.who || '', time: s.time || 0, isCurrent: i === e.index,
    wlabel: s.wlabel || e.wlabel || '',
  }));
  entries.reverse(); // newest at the top
  return { entries, index: e.index };
}

/**
 * All scope keys currently held in the store (widgets + any special scopes). The
 * caller filters out non-widget scopes (page/site) to build a whole-page timeline
 * spanning every element edited this session or hydrated from the DB.
 */
export function listScopes() {
  return Array.from(store.keys());
}

/**
 * Load persisted (DB) entries as the base of a widget's stack — once, before any
 * session edits. `entries` are the server rows [{t,u,w,label,html,css}] for THIS
 * widget (oldest→newest). `current` is the live state, appended as the tip if it
 * differs from the newest saved entry (so undo/panel include "now").
 */
export function hydrateHistory(id, entries, current, wlabel) {
  if (!id || !Array.isArray(entries) || !entries.length) return;
  const e = ensure(id);
  const wl = wlabel || (current && current.wlabel) || e.wlabel || '';
  if (wl) e.wlabel = wl;
  if (e.hydrated || e.stack.length > 1) return; // already have real history — don't clobber
  e.stack = entries.map((r) => ({
    raw_html: r.html || '', raw_css: r.css || '', selected: null,
    // r.t is already in milliseconds (client-stamped in composer-history-db.js).
    label: r.label || 'Change', who: r.u || '', time: r.t || 0, wlabel: r.wl || wl || '',
  }));
  e.index = e.stack.length - 1;
  if (current) {
    const tip = { raw_html: current.raw_html || '', raw_css: current.raw_css || '' };
    if (!sameSnap(e.stack[e.index], tip)) {
      e.stack.push({ ...tip, selected: null, label: 'Current', who: current.who || '', time: nowMs(), wlabel: wl });
      e.index = e.stack.length - 1;
    }
  }
  e.hydrated = true;
  e.lastTime = 0;
}

// ── Whole-page (global) undo/redo ──────────────────────────────────────────
// Peek/commit are split so the caller can SELECT the target element first (its
// setters must rebind) and only then apply. `commit*` mutate the pointer + the
// scope's index; `peek*` are pure look-aheads.

export function canGlobalUndo() { return gPtr > 0; }
export function canGlobalRedo() { return gPtr < gMoves.length; }

/** The scope + resulting snapshot a global undo WOULD land on, without mutating. */
export function peekGlobalUndo() {
  if (gPtr <= 0) return null;
  const scope = gMoves[gPtr - 1];
  const e = store.get(scope);
  if (!e || e.index <= 0) return null;
  return { scope, snap: e.stack[e.index - 1] };
}
export function peekGlobalRedo() {
  if (gPtr >= gMoves.length) return null;
  const scope = gMoves[gPtr];
  const e = store.get(scope);
  if (!e || e.index >= e.stack.length - 1) return null;
  return { scope, snap: e.stack[e.index + 1] };
}

/** Step the whole-page order back one and apply it to that scope's stack. */
export function commitGlobalUndo() {
  if (gPtr <= 0) return null;
  const scope = gMoves[gPtr - 1];
  const snap = undoHistory(scope);
  if (!snap) return null; // scope couldn't step back — leave the pointer put
  gPtr -= 1;
  return { scope, snap };
}
export function commitGlobalRedo() {
  if (gPtr >= gMoves.length) return null;
  const scope = gMoves[gPtr];
  const snap = redoHistory(scope);
  if (!snap) return null;
  gPtr += 1;
  return { scope, snap };
}

/** Jump to an absolute stack index and return that snapshot (or null). */
export function jumpToHistory(id, targetIndex) {
  const e = store.get(id);
  if (!e || targetIndex < 0 || targetIndex >= e.stack.length) return null;
  e.index = targetIndex;
  e.lastTime = 0; // the next edit after a jump starts a fresh step
  return e.stack[targetIndex];
}
