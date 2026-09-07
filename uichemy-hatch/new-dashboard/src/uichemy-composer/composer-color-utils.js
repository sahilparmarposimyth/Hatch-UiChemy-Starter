/** CSS color parsing, conversion, and formatting for the composer color picker. */

const KEYWORD_COLORS = new Set([
  'transparent', 'inherit', 'initial', 'unset', 'currentcolor', 'none',
]);

export function isKeywordColor(value) {
  return KEYWORD_COLORS.has(String(value || '').trim().toLowerCase());
}

// Elementor Global / Atomic color-var recognition has been removed. These
// helpers remain for API compatibility with the color picker + shadow utils
// but no longer resolve any Elementor global; a raw custom-property value is
// passed through untouched.
export function parseGlobalColorVar() {
  return null;
}

export function globalColorVarName(id) {
  if (!id) return '';
  const s = String(id);
  if (s.startsWith('--')) return `var(${s})`;
  return '';
}

export function isPickableColor(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (isKeywordColor(v)) return false;
  return !!parseColorToRgba(v);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function pad2(n) {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

export function rgbaToHex({ r, g, b, a = 1 }, includeAlpha = false) {
  const hex = `#${pad2(r)}${pad2(g)}${pad2(b)}`.toUpperCase();
  if (!includeAlpha || a >= 0.999) return hex;
  const alpha = clamp(Math.round(a * 255), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return hex + alpha;
}

export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
      case gn: h = ((bn - rn) / d + 2); break;
      default: h = ((rn - gn) / d + 4); break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function rgbToHsvCore(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const v = max * 100;
  const s = max === 0 ? 0 : (d / max) * 100;
  if (d !== 0) {
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      default: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, v };
}

/** Integer H/S/V (0–360, 0–100) for display and text fields. */
export function rgbToHsv(r, g, b) {
  const { h, s, v } = rgbToHsvCore(r, g, b);
  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
}

/** Full-precision H/S/V for interactive picker surfaces. */
export function rgbToHsvPrecise(r, g, b) {
  return rgbToHsvCore(r, g, b);
}

export function hsvToRgb(h, s, v) {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(v, 0, 100) / 100;
  const i = Math.floor(hn * 6);
  const f = hn * 6 - i;
  const p = vn * (1 - sn);
  const q = vn * (1 - f * sn);
  const t = vn * (1 - (1 - f) * sn);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = vn; g = t; b = p; break;
    case 1: r = q; g = vn; b = p; break;
    case 2: r = p; g = vn; b = t; break;
    case 3: r = p; g = q; b = vn; break;
    case 4: r = t; g = p; b = vn; break;
    default: r = vn; g = p; b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

export function hslToRgb(h, s, l) {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue2rgb = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(hn) * 255),
    b: Math.round(hue2rgb(hn - 1 / 3) * 255),
  };
}

function parseHex(raw) {
  let h = raw.replace('#', '');
  // expand 3-char (#RGB) and 4-char (#RGBA) short forms
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  if (h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }
  return null;
}

function parseRgbLike(raw) {
  const m = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  let a = 1;
  if (m[4] != null && m[4] !== '') {
    a = String(m[4]).includes('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  }
  return {
    r: clamp(parseFloat(m[1]), 0, 255),
    g: clamp(parseFloat(m[2]), 0, 255),
    b: clamp(parseFloat(m[3]), 0, 255),
    a: clamp(a, 0, 1),
  };
}

function parseHslLike(raw) {
  const m = raw.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  const { r, g, b } = hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  let a = 1;
  if (m[4] != null && m[4] !== '') {
    a = String(m[4]).includes('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  }
  return { r, g, b, a: clamp(a, 0, 1) };
}

function probeBrowserColor(raw) {
  if (typeof document === 'undefined') return null;
  try {
    const el = document.createElement('span');
    el.style.color = '';
    el.style.color = raw;
    if (!el.style.color) return null;
    document.body.appendChild(el);
    const computed = window.getComputedStyle(el).color;
    document.body.removeChild(el);
    const m = computed.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    return {
      r: parseFloat(m[1]),
      g: parseFloat(m[2]),
      b: parseFloat(m[3]),
      a: m[4] != null ? parseFloat(m[4]) : 1,
    };
  } catch (_) {
    return null;
  }
}

/** @returns {{ r: number, g: number, b: number, a: number } | null} */
export function parseColorToRgba(value) {
  const raw = String(value || '').trim();
  if (!raw || isKeywordColor(raw) || /^var\(/i.test(raw)) return null;
  if (raw.startsWith('#')) return parseHex(raw);
  if (/^rgba?\(/i.test(raw)) return parseRgbLike(raw);
  if (/^hsla?\(/i.test(raw)) return parseHslLike(raw);
  return probeBrowserColor(raw);
}

export function colorToHex(value, fallback = '#000000') {
  const rgba = parseColorToRgba(value);
  return rgba ? rgbaToHex(rgba, false) : fallback;
}

export function formatRgba(rgba, format = 'hex') {
  if (!rgba) return '';
  const { r, g, b, a } = rgba;
  if (format === 'rgb') {
    if (a < 0.999) {
      return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;
    }
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  if (format === 'hsl') {
    const { h, s, l } = rgbToHsl(r, g, b);
    if (a < 0.999) {
      return `hsla(${h}, ${s}%, ${l}%, ${Math.round(a * 1000) / 1000})`;
    }
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  return rgbaToHex(rgba, a < 0.999);
}

export function normalizeColorInput(value, preferredFormat = 'hex') {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isKeywordColor(v) || /^var\(/i.test(v)) return v;
  const rgba = parseColorToRgba(v);
  return rgba ? formatRgba(rgba, preferredFormat) : v;
}

export function rgbaToCssPreview(rgba) {
  if (!rgba) return 'transparent';
  const { r, g, b, a } = rgba;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

// Elementor kit / Atomic linked colors have been removed, so there is no
// linked-global metadata to resolve. Kept for API compatibility with existing
// callers (color picker + inspector); UiChemy globals are resolved separately
// via resolveUiChemyColorMeta.
export function getLinkedColorMeta() {
  return null;
}
