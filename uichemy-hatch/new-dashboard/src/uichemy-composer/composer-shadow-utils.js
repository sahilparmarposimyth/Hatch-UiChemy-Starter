/** Parse / format CSS `text-shadow` (single shadow) for the inspector. */

import { parseGlobalColorVar, globalColorVarName } from './composer-color-utils';

const SHADOW_COLOR_PATTERNS = [
  /var\(\s*[^)]+\)/i,
  /rgba?\(\s*[^)]+\)/i,
  /hsla?\(\s*[^)]+\)/i,
  /#[0-9a-f]{3,8}/i,
];

const NAMED_COLOR_RE = /^(transparent|currentcolor|inherit|initial|unset|[a-z]+)$/i;

function extractShadowColor(raw) {
  const s = String(raw || '').trim();
  if (!s) return { color: '', rest: '' };
  for (const re of SHADOW_COLOR_PATTERNS) {
    const m = s.match(re);
    if (m && m.index != null) {
      const color = m[0];
      const rest = (s.slice(0, m.index) + s.slice(m.index + color.length))
        .replace(/\s+/g, ' ')
        .trim();
      return { color, rest };
    }
  }
  const tokens = s.split(/\s+/);
  if (tokens.length && NAMED_COLOR_RE.test(tokens[0])) {
    return { color: tokens[0], rest: tokens.slice(1).join(' ') };
  }
  if (tokens.length && NAMED_COLOR_RE.test(tokens[tokens.length - 1])) {
    return { color: tokens[tokens.length - 1], rest: tokens.slice(0, -1).join(' ') };
  }
  return { color: '', rest: s };
}

/**
 * @returns {{ x: string, y: string, blur: string, color: string, empty?: boolean }}
 */
export function parseTextShadow(value) {
  const raw = String(value || '').trim();
  if (!raw || /^none$/i.test(raw)) {
    return { x: '0', y: '0', blur: '0', color: '', empty: true };
  }
  const { color, rest } = extractShadowColor(raw);
  const lengths = rest.split(/\s+/).filter(Boolean);
  const withUnit = (t, fallback = '0') => {
    if (!t) return fallback;
    return /^-?[\d.]+(?:[a-z%]+)?$/i.test(t) ? t : fallback;
  };
  return {
    x: withUnit(lengths[0], '0'),
    y: withUnit(lengths[1], '0'),
    blur: withUnit(lengths[2], '0'),
    color: color || '',
    empty: false,
  };
}

/**
 * @param {{ x?: string, y?: string, blur?: string, color?: string }} parts
 * @returns {string}
 */
export function formatTextShadow(parts) {
  const x = String(parts.x ?? '0').trim() || '0';
  const y = String(parts.y ?? '0').trim() || '0';
  const blur = String(parts.blur ?? '0').trim() || '0';
  const color = String(parts.color ?? '').trim();
  const allZero = x === '0' && y === '0' && blur === '0';
  if (!color && allZero) return '';
  if (!color) return `${x} ${y} ${blur}`.trim();
  return `${x} ${y} ${blur} ${color}`.trim();
}

/** Apply parsed text-shadow to scope; splits global color into __globals.textShadowColor. */
export function applyTextShadowToScope(scope, value) {
  const parsed = parseTextShadow(value);
  scope.typography = scope.typography || {};
  scope.__globals = scope.__globals || {};

  const globalId = parsed.color ? parseGlobalColorVar(parsed.color) : null;
  const g = globalId ? { id: globalId } : null;
  if (g) {
    scope.__globals['typography.textShadowColor'] = g.id;
    scope.typography.textShadow = formatTextShadow({ ...parsed, color: '' });
    return;
  }
  delete scope.__globals['typography.textShadowColor'];
  if (parsed.empty && !parsed.color) {
    delete scope.typography.textShadow;
    return;
  }
  scope.typography.textShadow = formatTextShadow(parsed);
}

/** Resolved color string for text-shadow (raw or var()). */
export function resolveTextShadowColor(scope) {
  const linked = scope?.__globals?.['typography.textShadowColor'];
  if (linked) return globalColorVarName(linked);
  return parseTextShadow(scope?.typography?.textShadow || '').color;
}
