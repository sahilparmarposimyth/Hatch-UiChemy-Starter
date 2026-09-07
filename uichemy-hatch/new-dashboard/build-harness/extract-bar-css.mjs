// Pulls the REAL stylesheet out of composer-box-handles.js by evaluating the
// template literal in ensureStyles() with the module's own constants.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'src/uichemy-composer/composer-box-handles.js');
const src = fs.readFileSync(SRC, 'utf8');

// 1. the template literal
const start = src.indexOf('style.textContent = `');
const bodyStart = start + 'style.textContent = `'.length;
const end = src.indexOf('\n  `;\n  (doc.head', bodyStart);
if (start < 0 || end < 0) { console.error('could not locate template'); process.exit(1); }
const tpl = src.slice(bodyStart, end);

// 2. the constants it interpolates, read straight out of the source
function constOf(name) {
  const m = src.match(new RegExp('^const ' + name + " = '([^']*)'", 'm'));
  return m ? m[1] : null;
}
const scope = {
  HOST_ID: constOf('HOST_ID'),
  ACCENT: constOf('ACCENT'),
  ACCENT_TINT: constOf('ACCENT_TINT'),
  ACCENT_RING: constOf('ACCENT_RING'),
  ACCENT_TINT_D: constOf('ACCENT_TINT_D'),
  ACCENT_RING_D: constOf('ACCENT_RING_D'),
  ACCENT_LINE: constOf('ACCENT_LINE'),
  BRAND: constOf('BRAND'),
  BRAND_D: constOf('BRAND_D'),
  BRAND_TINT: constOf('BRAND_TINT'),
  BRAND_TINT_D: constOf('BRAND_TINT_D'),
  EL_SHADOW: constOf('EL_SHADOW'),
  EL_SHADOW_DARK: constOf('EL_SHADOW_DARK'),
  BAR_SHADOW: constOf('BAR_SHADOW'),
  BAR_SHADOW_DARK: constOf('BAR_SHADOW_DARK'),
};

// 3. real Hugeicons glyphs, serialised the way the module does it
const icons = await import(path.join(ROOT, 'node_modules/@hugeicons/core-free-icons/dist/esm/index.js'))
  .catch(() => null);
function hugeSvg(icon, { size = 14, stroke = 'currentColor', width = 1.8 } = {}) {
  const body = (icon || []).map(([tag, attrs = {}]) => {
    const parts = Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => {
      const n = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      if (n === 'stroke') return `stroke="${stroke}"`;
      if (n === 'stroke-width') return `stroke-width="${width}"`;
      return `${n}="${v}"`;
    });
    return `<${tag} ${parts.join(' ')}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
}
scope.hugeSvgUrl = (icon, opts) => `url('data:image/svg+xml;utf8,${encodeURIComponent(hugeSvg(icon, opts))}')`;
scope.ArrowDown01Icon = icons ? icons.ArrowDown01Icon : [];
scope.ParagraphSpacingIcon = icons ? icons.ParagraphSpacingIcon : [];

const names = Object.keys(scope);
const css = new Function(...names, 'return `' + tpl + '`;')(...names.map((n) => scope[n]));
const out = process.argv[2];
fs.writeFileSync(out, css);
console.log('wrote', out, css.length, 'bytes · icons', icons ? 'real' : 'MISSING');
