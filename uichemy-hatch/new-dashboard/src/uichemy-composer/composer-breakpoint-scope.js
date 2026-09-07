// Per-breakpoint ownership, which schema keys were set at desktop vs @media.

import { normalizeMediaTextForCompare } from './composer-css-media';

export const BASE_BP_KEY = '__base__';

export function breakpointStorageKey(mediaQueryInner) {
  const norm = normalizeMediaTextForCompare(mediaQueryInner);
  return norm || BASE_BP_KEY;
}

export function markScopePropOwn(scope, fullKey, mediaQueryInner) {
  if (!scope || !fullKey) return scope;
  const bk = breakpointStorageKey(mediaQueryInner);
  const next = { ...scope, __bpOwn: { ...(scope.__bpOwn || {}) } };
  next.__bpOwn[bk] = { ...(next.__bpOwn[bk] || {}), [fullKey]: true };
  return next;
}

export function clearScopePropOwn(scope, fullKey, mediaQueryInner) {
  if (!scope || !scope.__bpOwn) return scope;
  const bk = breakpointStorageKey(mediaQueryInner);
  const bag = scope.__bpOwn[bk];
  if (!bag || !bag[fullKey]) return scope;
  const nextOwn = { ...scope.__bpOwn, [bk]: { ...bag } };
  delete nextOwn[bk][fullKey];
  return { ...scope, __bpOwn: nextOwn };
}

export function isScopePropOwnAtBp(scope, fullKey, mediaQueryInner) {
  if (!scope || !fullKey) return false;
  const bk = breakpointStorageKey(mediaQueryInner);
  return !!(scope.__bpOwn && scope.__bpOwn[bk] && scope.__bpOwn[bk][fullKey]);
}

export function listScopePropsOwnAtBp(scope, mediaQueryInner) {
  if (!scope || !scope.__bpOwn) return [];
  const bk = breakpointStorageKey(mediaQueryInner);
  const bag = scope.__bpOwn[bk];
  if (!bag) return [];
  return Object.keys(bag).filter((k) => bag[k]);
}

const DATA_GROUPS = ['typography', 'layout', 'spacing', 'background', 'border', 'effects'];

/**
 * Keep only values/globals/units owned at this breakpoint in scope data bags.
 * Inherited values must come from the cascade, not linger in React state.
 */
export function pruneScopeDataToBreakpointOwnership(scope, mediaQueryInner) {
  if (!scope) return scope;
  const next = { ...scope };
  DATA_GROUPS.forEach((group) => {
    const bag = { ...(next[group] || {}) };
    let touched = false;
    Object.keys(bag).forEach((key) => {
      const fk = `${group}.${key}`;
      if (!isScopePropOwnAtBp(scope, fk, mediaQueryInner)) {
        delete bag[key];
        touched = true;
      }
    });
    if (touched) next[group] = bag;
  });
  const units = { ...(next.__units || {}) };
  Object.keys(units).forEach((unitKey) => {
    if (!isScopePropOwnAtBp(scope, unitKey, mediaQueryInner)) {
      delete units[unitKey];
    }
  });
  next.__units = units;
  const globals = { ...(next.__globals || {}) };
  Object.keys(globals).forEach((fk) => {
    if (!isScopePropOwnAtBp(scope, fk, mediaQueryInner)) {
      delete globals[fk];
    }
  });
  next.__globals = globals;
  return next;
}

/** After parsing CSS at a breakpoint, mark every populated schema key as owned there. */
export function markParsedScopeOwnership(scope, mediaQueryInner) {
  if (!scope) return scope;
  let next = scope;
  const groups = ['typography', 'layout', 'spacing', 'background', 'border', 'effects'];
  groups.forEach((group) => {
    const bag = scope[group];
    if (!bag || typeof bag !== 'object') return;
    Object.keys(bag).forEach((key) => {
      const v = bag[key];
      if (v != null && v !== '') {
        next = markScopePropOwn(next, `${group}.${key}`, mediaQueryInner);
      }
    });
  });
  const globals = scope.__globals || {};
  Object.keys(globals).forEach((fullKey) => {
    if (globals[fullKey]) next = markScopePropOwn(next, fullKey, mediaQueryInner);
  });
  return next;
}
