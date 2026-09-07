// Diff-based persistence for the composer history log (Phase 3, diff edition).
//
// Sir's review: store DIFFS, not full text, to save space + keep a LONGER history
// (npm jsondiffpatch). So the DB holds ONE full "base" snapshot per widget plus a
// chain of forward DELTAS; each history entry is reconstructed by applying the
// deltas over the base. Text-diffing (jsondiffpatch/with-text-diffs) makes the raw
// html/css deltas tiny.
//
// The CLIENT owns the whole blob and PUTs it to a dumb server meta store — that
// keeps all diff/patch logic in JS (the server has no jsondiffpatch), and lets the
// cap rebase safely (merge the oldest delta into the base) without ever breaking
// the chain.
import { diff, patch, clone } from 'jsondiffpatch/with-text-diffs';

const CAP_STEPS = 80; // deltas kept after the base (≈81 restorable points/widget)

function nowMs() { return (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0; }
export function emptyBlob() { return { v: 1, widgets: {} }; }

/**
 * Rebuild a widget's full history from the blob — oldest → newest. Returns rows in
 * the same shape the session store hydrates from: { t, u, label, html, css }.
 */
export function reconstructWidget(blob, widgetId) {
  const w = blob && blob.widgets && blob.widgets[widgetId];
  if (!w || !w.base) return [];
  const wl = w.base.wl || ''; // widget display name, stored once on the base
  const out = [];
  let cur = { html: w.base.html || '', css: w.base.css || '' };
  out.push({ t: w.base.t || 0, u: w.base.u || '', label: w.base.label || 'Opened', html: cur.html, css: cur.css, wl });
  const steps = Array.isArray(w.steps) ? w.steps : [];
  for (let i = 0; i < steps.length; i += 1) {
    try {
      cur = patch(clone(cur), steps[i].d);
    } catch (_) { break; } // corrupt delta → stop, keep what reconstructed
    out.push({ t: steps[i].t || 0, u: steps[i].u || '', label: steps[i].label || 'Change', html: cur.html || '', css: cur.css || '', wl });
  }
  return out;
}

/**
 * Append the current widget state as a new step (delta from the last reconstructed
 * state). Returns { blob, changed }. Skips when nothing changed. Caps by merging the
 * oldest delta into the base so the chain stays valid and short.
 *
 * @param {object} blob      current log blob (or falsy for a fresh one)
 * @param {string} widgetId
 * @param {{html:string,css:string}} cur   the live state to record
 * @param {{label?:string,who?:string}} meta
 */
export function appendStep(blob, widgetId, cur, meta) {
  const b = (blob && blob.widgets) ? { v: 1, widgets: { ...blob.widgets } } : emptyBlob();
  const curObj = { html: cur.html || '', css: cur.css || '' };
  const label = (meta && meta.label) || 'Change';
  const who = (meta && meta.who) || '';
  const wl = (meta && meta.wlabel) || '';

  let w = b.widgets[widgetId];
  if (!w || !w.base) {
    b.widgets[widgetId] = { base: { ...curObj, t: nowMs(), u: who, label: 'Opened', wl }, steps: [] };
    return { blob: b, changed: true };
  }

  const recon = reconstructWidget(b, widgetId);
  const last = recon[recon.length - 1] || { html: '', css: '' };
  const d = diff({ html: last.html || '', css: last.css || '' }, curObj);
  if (!d) return { blob: b, changed: false }; // identical → nothing to store

  w = { base: { ...w.base }, steps: (Array.isArray(w.steps) ? w.steps.slice() : []) };
  if (!w.base.wl && wl) w.base.wl = wl; // backfill the name on older bases
  w.steps.push({ d, t: nowMs(), u: who, label });

  while (w.steps.length > CAP_STEPS) {
    const first = w.steps.shift();
    try {
      const merged = patch(clone({ html: w.base.html || '', css: w.base.css || '' }), first.d);
      w.base = { html: merged.html || '', css: merged.css || '', t: first.t, u: first.u, label: first.label };
    } catch (_) { /* merge failed (rare) → the dropped step is simply lost */ }
  }
  b.widgets[widgetId] = w;
  return { blob: b, changed: true };
}
