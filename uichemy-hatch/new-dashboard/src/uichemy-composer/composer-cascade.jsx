// Cascade resolution, winning scope + display values.

export const TYPO_TOKEN_KEYS = [
  'fontFamily', 'fontWeight', 'fontSize', 'lineHeight',
  'letterSpacing', 'fontStyle', 'textTransform', 'textDecoration',
];

const LENGTH_TYPO_KEYS = new Set(['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing']);

export function displayClassName(className) {
  return className || '';
}

export function isTypographyGlobalScope(scopeName) {
  return /^text-.+$/.test(scopeName || '');
}

function attachUnitIfNeeded(group, key, display, scopes, scopeName) {
  if (!display || group !== 'typography' || !LENGTH_TYPO_KEYS.has(key)) return display;
  if (/[a-z%]/i.test(display)) return display;
  const cs = scopes && scopes[scopeName];
  const u = cs && cs.__units && cs.__units[`${group}.${key}`];
  if (u && u !== 'unitless' && u !== '') return display + u;
  if (key === 'lineHeight') return display;
  return display + 'px';
}

function finalizeDisplay(group, key, display, scopes, scopeName) {
  const d = String(display || '').trim();
  if (!d) return '';
  return attachUnitIfNeeded(group, key, d, scopes, scopeName);
}

/**
 * Resolved display for one property on a scope.
 * @returns {{ raw: string, display: string, isGlobal: boolean, globalLabel: string|null }}
 */
export function resolveScopePropertyDisplay(scopeName, group, key, scopes) {
  const cs = scopes && scopes[scopeName];
  if (!cs) return { raw: '', display: '', isGlobal: false, globalLabel: null };

  const raw = (cs[group] && cs[group][key] != null && cs[group][key] !== '')
    ? String(cs[group][key])
    : '';

  return {
    raw,
    display: finalizeDisplay(group, key, raw, scopes, scopeName),
    isGlobal: false,
    globalLabel: null,
  };
}

export function scopeLabel(scope) {
  if (!scope || scope === 'local') return 'Local';
  // Compound class scopes (`compound:.parent .test`) are surfaced as the raw
  // selector, the leading `.` is already part of the stored selector.
  if (typeof scope === 'string' && scope.startsWith('compound:')) {
    return scope.slice('compound:'.length);
  }
  return '.' + displayClassName(scope);
}
