// Runs the REAL canvas toolbar: imports drawBoxHandles from source, so
// ensureStyles() injects the actual stylesheet and ensureHost() builds the
// actual bar DOM — grip, Ask AI, extras, slot.
//
// The slot's property controls normally come from CanvasTypographyBar, which
// needs a live composer `ctx`. Here they are injected as the same .uich-tb-*
// markup that PropField + stampClasses() produce, so the CSS under test is
// exercised on the classes it actually targets.
import { drawBoxHandles, setBoxToolbarAI } from '../../src/uichemy-composer/composer-box-handles';

setBoxToolbarAI(true);

// Test hook: lets a driver redraw the bar at arbitrary element geometry so
// positionBar()'s placement can be asserted directly. Harness-only.
if (typeof window !== 'undefined') window.__drawBoxHandles = drawBoxHandles;

const target = document.getElementById('target');
// A real sibling set. The grip reorders an element among its DOM siblings, so a
// page with a single block can never exercise it — pointerdown bails on
// `sibs.length < 2` and the drag looks broken rather than inapplicable.
drawBoxHandles(document, target, {
  canMove: true,
  onMove: (dragEl, dropEl, placement) => {
    // eslint-disable-next-line no-console
    console.log('[harness] onMove', { drag: dragEl.textContent.slice(0, 24), drop: dropEl.textContent.slice(0, 24), placement });
    if (placement === 'before') dropEl.parentElement.insertBefore(dragEl, dropEl);
    else dropEl.parentElement.insertBefore(dragEl, dropEl.nextSibling);
    window.__moves = (window.__moves || 0) + 1;
  },
});

// Fill the slot with representative controls, then flip the bar to dark on demand.
const host = document.getElementById('uich-box-handles') || document.querySelector('[id*="box-handles"]');
const st = host && host.__uichBH;

function cell(k, inner, w) {
  return '<div class="uich-tb-cell" data-k="' + k + '"' + (w ? ' style="width:' + w + 'px"' : '') + '>' + inner + '</div>';
}
const CARET = '<span class="uich-tb-caret"></span>';
function select(k, val, w) {
  return cell(k, '<div class="uich-tb-box uich-tb-select"><span class="uich-tb-value">' + val + '</span>' + CARET + '</div>', w);
}
function length(k, val, unit, w) {
  return cell(k, '<div class="uich-tb-box uich-tb-length"><span class="uich-tb-value">' + val
    + '</span><span class="uich-tb-unit-wrap"><span class="uich-tb-unit">' + unit + '</span></span></div>', w);
}
const SEP = '<div class="uich-tb-sep"></div>';
const ALIGN = '<div class="uich-tb-cell" data-k="textAlign"><div class="uich-tb-box uich-tb-seg">'
  + '<button class="uich-tb-seg-btn is-on">L</button><button class="uich-tb-seg-btn">C</button>'
  + '<button class="uich-tb-seg-btn">R</button></div></div>';
const COLOR = '<div class="uich-tb-cell" data-k="textColor"><div class="uich-tb-box uich-tb-color">'
  + '<span class="uich-tb-swatch" style="background:#111"></span></div></div>';

if (st && st.slotEl) {
  st.slotEl.innerHTML = '<div class="uich-tb">' + SEP
    + select('fontFamily', 'Plus Jakarta Sans', 186)
    + length('fontSize', '32', 'px', 96)
    + length('lineHeight', '1.2', 'em', 96)
    + SEP + ALIGN + COLOR + '</div>';
}

document.getElementById('themeBtn').addEventListener('click', () => {
  if (st && st.bar) st.bar.classList.toggle('uich-bh-dark');
  document.body.classList.toggle('dk');
});
window.__bh = st;
