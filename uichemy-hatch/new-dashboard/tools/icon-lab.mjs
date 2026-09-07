// Icon Lab — generates an offline, searchable gallery of the whole Hugeicons
// Pro (stroke-standard) catalogue straight from node_modules, with live size +
// stroke sliders. Run:  node tools/icon-lab.mjs   → writes ../icon-lab.html
// then serve new-dashboard/ and open /icon-lab.html.
import * as pro from '@hugeicons-pro/core-stroke-standard';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const DROP = new Set(['key', 'stroke', 'strokeWidth', 'fill']);

// [tag, attrs] → "<tag a=b ... />", stripping baked stroke/fill so the sliders
// (set on the parent <svg>) drive weight and colour.
function nodeToSvg([tag, attrs]) {
  const parts = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (DROP.has(k)) continue;
    parts.push(`${kebab(k)}="${v}"`);
  }
  return `<${tag} ${parts.join(' ')}/>`;
}

const icons = Object.keys(pro)
  .filter((k) => /Icon$/.test(k) && Array.isArray(pro[k]))
  .sort()
  .map((name) => ({ n: name, s: pro[name].map(nodeToSvg).join('') }));

const DATA = JSON.stringify(icons);

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Icon Lab · Hugeicons Pro</title>
<style>
  :root { --uc:#FD6A35; --bg:#fafafa; --card:#fff; --line:#ececec; --ink:#171717; --ink-2:#525252; --ink-3:#8f8f8f; }
  @media (prefers-color-scheme: dark) { :root { --bg:#171717; --card:#1f1f1f; --line:#2e2e2e; --ink:#f5f5f5; --ink-2:#c4c4c4; --ink-3:#8f8f8f; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  header { position:sticky; top:0; z-index:2; background:var(--bg); border-bottom:1px solid var(--line); padding:16px 20px; }
  h1 { font-size:15px; font-weight:600; margin:0 0 12px; display:flex; align-items:center; gap:8px; }
  h1 b { color:var(--uc); font-weight:600; }
  .controls { display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  input[type=search] { flex:1; min-width:200px; height:36px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--ink); font-size:14px; outline:none; }
  input[type=search]:focus { border-color:var(--uc); }
  .ctrl { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-2); white-space:nowrap; }
  .ctrl input[type=range] { accent-color:var(--uc); width:120px; }
  .ctrl b { color:var(--ink); font-variant-numeric:tabular-nums; min-width:34px; }
  .count { font-size:12px; color:var(--ink-3); margin-left:auto; }
  main { padding:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:10px; }
  .cell { display:flex; flex-direction:column; align-items:center; gap:8px; padding:14px 8px; border:1px solid var(--line); border-radius:12px; background:var(--card); cursor:pointer; transition:border-color .12s; text-align:center; }
  .cell:hover { border-color:var(--uc); }
  .cell svg { color:var(--ink); display:block; }
  .cell span { font-size:10.5px; color:var(--ink-3); word-break:break-word; line-height:1.3; }
  .copied { border-color:var(--uc) !important; }
  .copied span { color:var(--uc); }
  .toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%) translateY(20px); background:var(--ink); color:var(--bg); padding:9px 16px; border-radius:8px; font-size:13px; opacity:0; transition:.18s; pointer-events:none; }
  .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
</style></head><body>
<header>
  <h1><b>◆</b> Icon Lab · Hugeicons Pro <span style="color:var(--ink-3);font-weight:400">stroke-standard · what the dashboard uses</span></h1>
  <div class="controls">
    <input type="search" id="q" placeholder="Search 6,124 icons — home, arrow, sparkle, figma…" autofocus>
    <label class="ctrl">Size <input type="range" id="size" min="14" max="48" value="26"><b id="sizeV">26</b></label>
    <label class="ctrl">Stroke <input type="range" id="sw" min="0.5" max="3" step="0.1" value="1.5"><b id="swV">1.5</b></label>
    <span class="count" id="count"></span>
  </div>
</header>
<main><div class="grid" id="grid"></div></main>
<div class="toast" id="toast"></div>
<script>
  const ICONS = ${DATA};
  const grid = document.getElementById('grid');
  const q = document.getElementById('q');
  const sizeEl = document.getElementById('size'), swEl = document.getElementById('sw');
  const sizeV = document.getElementById('sizeV'), swV = document.getElementById('swV');
  const countEl = document.getElementById('count'), toast = document.getElementById('toast');
  const CAP = 600;
  let size = +sizeEl.value, sw = +swEl.value, term = '';

  function svg(inner) {
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+sw+'" stroke-linecap="round" stroke-linejoin="round">'+inner+'</svg>';
  }
  function render() {
    const t = term.toLowerCase().replace(/[^a-z0-9]/g,'');
    const hits = t ? ICONS.filter(i => i.n.toLowerCase().includes(t)) : ICONS;
    const shown = hits.slice(0, CAP);
    grid.innerHTML = shown.map(i => '<div class="cell" data-n="'+i.n+'">'+svg(i.s)+'<span>'+i.n.replace(/Icon$/,'')+'</span></div>').join('');
    countEl.textContent = hits.length.toLocaleString() + ' icons' + (hits.length>CAP ? ' · showing '+CAP+', refine search' : '');
  }
  q.addEventListener('input', e => { term = e.target.value; render(); });
  sizeEl.addEventListener('input', e => { size = +e.target.value; sizeV.textContent = size; render(); });
  swEl.addEventListener('input', e => { sw = +e.target.value; swV.textContent = sw.toFixed(1); render(); });
  grid.addEventListener('click', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    navigator.clipboard && navigator.clipboard.writeText(c.dataset.n);
    document.querySelectorAll('.copied').forEach(x=>x.classList.remove('copied'));
    c.classList.add('copied');
    toast.textContent = 'Copied ' + c.dataset.n; toast.classList.add('show');
    clearTimeout(window.__t); window.__t = setTimeout(()=>toast.classList.remove('show'), 1400);
  });
  render();
</script></body></html>`;

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icon-lab.html');
writeFileSync(out, html);
console.log('Wrote', out, '(' + icons.length + ' icons, ' + (html.length / 1048576).toFixed(1) + ' MB)');
