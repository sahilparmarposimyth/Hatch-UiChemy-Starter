// Panel Icon Picker — renders candidate glyphs for the new inspector fields
// straight from the FREE Hugeicons package (never @hugeicons-pro, which we
// cannot ship in a GPL plugin). Each candidate is drawn twice: once at the real
// 14px panel size inside a mock field, and once at 3x so the shape is legible.
//
// Stroke uses the same size-aware rule as composer-icons.jsx:
//   strokeWidth = 1.25 * 24 / size
//
// Run:  node tools/panel-icon-picker.mjs   → writes ../panel-icons.html
import * as free from '@hugeicons/core-free-icons';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UC_ICON_STROKE = 1.25;
const strokeFor = (size) => +((UC_ICON_STROKE * 24) / size).toFixed(2);

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const DROP = new Set(['key', 'stroke', 'strokeWidth', 'fill']);

function nodeToSvg([tag, attrs]) {
  const parts = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (DROP.has(k)) continue;
    parts.push(`${kebab(k)}="${v}"`);
  }
  return `<${tag} ${parts.join(' ')}/>`;
}

function svg(name, size) {
  const icon = free[name];
  if (!Array.isArray(icon)) return `<span class="miss" title="${name}">?</span>`;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="${strokeFor(size)}"
    stroke-linecap="round" stroke-linejoin="round">${icon.map(nodeToSvg).join('')}</svg>`;
}

// One entry per control slot in the proposed panel. `letter` marks slots where
// a plain character (X / Y / W / H) may beat any icon — that is what the shadcn
// print editor itself uses.
const SLOTS = [
  {
    slot: 'Position — X / Y',
    note: 'shadcn uses plain letters here. Icons shown for comparison.',
    letter: ['X', 'Y'],
    candidates: ['Move01Icon', 'AdjustPositionIcon', 'ArrowExpandIcon', 'AnchorPointIcon'],
  },
  {
    slot: 'Size — W / H',
    note: 'Same: letters are the convention across Figma, Framer and shadcn.',
    letter: ['W', 'H'],
    candidates: ['Resize01Icon', 'Resize02Icon', 'ArrowHorizontalIcon', 'VectorSquareIcon'],
  },
  {
    slot: 'Corner radius',
    note: 'RadiusIcon is a geometric radius (circle + dot) — wrong meaning. SquareRoundCorner is the real one.',
    candidates: ['SquareRoundCornerIcon', 'RadiusIcon', 'JoinRoundIcon', 'CornerUpLeftIcon'],
  },
  {
    slot: 'Padding',
    note: 'No dedicated padding glyph in the free set — these are the closest.',
    candidates: ['BorderInnerIcon', 'BorderFullIcon', 'FrameIcon', 'AlignHorizontalSpaceAroundIcon'],
  },
  {
    slot: 'Rotate',
    note: 'Field glyph, plus the two nudge buttons beside it.',
    candidates: ['AngleIcon', 'Angle01Icon', 'RotateClockwiseIcon', 'Rotate01Icon'],
  },
  {
    slot: 'Rotate nudge — ccw / cw',
    candidates: ['RotateLeft01Icon', 'RotateRight01Icon', 'RotateCcwSquareIcon', 'RotateCwSquareIcon'],
  },
  {
    slot: 'Link / unlink sides',
    note: 'Link01Icon is already wired as I.link. Unlink is the "expanded" state.',
    candidates: ['Link01Icon', 'Unlink01Icon', 'Link03Icon', 'Unlink03Icon'],
  },
  {
    slot: 'Remove (Border / Shadow / Fill)',
    note: 'Cancel01Icon is already wired as I.x — no new import needed.',
    candidates: ['Cancel01Icon', 'Delete02Icon', 'MinusSignIcon'],
  },
];

const CARDS = SLOTS.map((s) => {
  const letters = (s.letter || [])
    .map((c) => `<div class="cand"><div class="field"><span class="addon lt">${c}</span><span class="val">240</span></div>
      <div class="big lt3">${c}</div><div class="nm ok">plain "${c}"</div></div>`)
    .join('');
  const icons = s.candidates
    .map((n) => {
      const exists = Array.isArray(free[n]);
      return `<div class="cand${exists ? '' : ' bad'}">
        <div class="field"><span class="addon">${svg(n, 14)}</span><span class="val">240</span></div>
        <div class="big">${svg(n, 42)}</div>
        <div class="nm">${n.replace(/Icon$/, '')}${exists ? '' : ' — NOT IN FREE'}</div></div>`;
    })
    .join('');
  return `<section class="card">
    <h2>${s.slot}</h2>
    ${s.note ? `<p class="note">${s.note}</p>` : ''}
    <div class="cands">${letters}${icons}</div>
  </section>`;
}).join('\n');

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel icons — free Hugeicons candidates</title>
<style>
:root{--panel-bg:#15161a;--panel-line:#2a2c33;--panel-line-2:#34363f;--panel-bg-4:#2d2f37;
 --text-hi:#f4f5f7;--text-mid:#9a9ca6;--text-dim:#6a6c76;--brand:#FD6A35;--page:#0e0f12;--radius:6px;--radius-sm:4px}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--text-hi);
 font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:30px 26px 70px}
.wrap{max-width:1120px;margin:0 auto}
h1{font-size:20px;font-weight:650;margin:0 0 6px}
.sub{color:var(--text-mid);font-size:13px;margin:0 0 26px;max-width:74ch}
.sub b{color:var(--text-hi)}
.card{background:var(--panel-bg);border:1px solid var(--panel-line);border-radius:10px;padding:18px 20px;margin-bottom:16px}
h2{font-size:13.5px;font-weight:650;margin:0 0 4px}
.note{font-size:12px;color:var(--text-mid);margin:0 0 14px}
.cands{display:flex;gap:14px;flex-wrap:wrap}
.cand{width:150px;background:#101116;border:1px solid var(--panel-line);border-radius:8px;padding:12px 12px 10px;text-align:center}
.cand.bad{opacity:.4}
.field{display:flex;align-items:center;height:30px;border:1px solid var(--panel-line-2);border-radius:var(--radius);
 position:relative;padding-left:26px;margin-bottom:12px}
.addon{position:absolute;left:1px;top:1px;bottom:1px;width:24px;display:flex;align-items:center;justify-content:center;
 color:var(--text-dim);border-radius:var(--radius-sm);cursor:ew-resize}
.addon:hover{background:var(--panel-bg-4);color:var(--text-hi)}
.addon.lt{font:600 10px/1 ui-monospace,Menlo,monospace}
.val{font:12px/1 ui-monospace,Menlo,monospace;color:var(--text-hi)}
.big{height:46px;display:flex;align-items:center;justify-content:center;color:var(--text-mid);margin-bottom:8px}
.big.lt3{font:600 30px/1 ui-monospace,Menlo,monospace}
.nm{font:10.5px/1.3 ui-monospace,Menlo,monospace;color:var(--text-dim);word-break:break-word}
.nm.ok{color:var(--brand)}
.miss{color:#ff7a7a;font:700 12px/1 monospace}
</style></head><body><div class="wrap">
<h1>Panel icons — free Hugeicons candidates</h1>
<p class="sub">Every glyph below comes from <b>@hugeicons/core-free-icons</b>, the package already in package.json — never the Pro set the icon-lab uses, which we can't ship in a GPLv3 plugin. Top row of each card is the real <b>14px</b> size inside a mock field; below it the same glyph at <b>42px</b> so you can judge the shape. Stroke follows the composer rule (<code>1.25 × 24 ÷ size</code>).</p>
${CARDS}
</div></body></html>`;

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'panel-icons.html');
writeFileSync(out, HTML);
console.log('wrote', out);
