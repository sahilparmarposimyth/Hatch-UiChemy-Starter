// Responsive cascade: resolve effective values across breakpoints + class stack.

import {
  buildResponsiveFallbackChainForBreakpoint,
  getMediaTextForElementorBreakpointKey,
  breakpointLabelForKey,
} from './composer-breakpoints';
import { isScopePropOwnAtBp } from './composer-breakpoint-scope';
import { resolveScopePropertyDisplay } from './composer-cascade';

function normalizeBpKey(bpKey) {
  const k = String(bpKey || '').trim();
  return !k || k === 'desktop' ? 'desktop' : k;
}

export function getParsedScopeBag(scopes, parsedByBpKey, scopeName, bpKey, activeDevice) {
  const key = normalizeBpKey(bpKey);
  if (key === normalizeBpKey(activeDevice)) {
    return scopes[scopeName];
  }
  // The local (inline) scope has no @media variants: an element's inline
  // `style` applies at EVERY breakpoint. It also never lives in the parsed
  // per-breakpoint CSS maps (those are built from class rules in raw_css), so
  // for any non-active breakpoint fall back to the single inline bag. Without
  // this the cascade cannot see an inline value from a responsive view, so
  // tablet/mobile showed the field empty with no "inherited from Desktop" hint.
  if (scopeName === 'local') return scopes.local;
  const parsed = parsedByBpKey[key] || parsedByBpKey.desktop || parsedByBpKey[''];
  return parsed ? parsed[scopeName] : undefined;
}

export function scopeHasValueAtBreakpoint(
  scopes,
  parsedByBpKey,
  scopeName,
  group,
  key,
  bpKey,
  activeDevice,
) {
  const fk = `${group}.${key}`;
  const mq = getMediaTextForElementorBreakpointKey(
    normalizeBpKey(bpKey) === 'desktop' ? 'desktop' : bpKey,
  );
  const cs = getParsedScopeBag(scopes, parsedByBpKey, scopeName, bpKey, activeDevice);
  if (!cs) return false;
  if (cs.__globals && cs.__globals[fk]) return true;
  if (!isScopePropOwnAtBp(cs, fk, mq)) return false;
  const v = cs[group] && cs[group][key];
  return v != null && v !== '';
}

/**
 * First matching scope + breakpoint in the fallback chain (specific → base).
 *
 * `activeState` extends the scope-walk: when on a non-default state (e.g.
 * `hover`), state-suffixed scopes (`.foo:hover`) are tried before default
 * (`.foo`) so per-state overrides win, with defaults as a natural fallback.
 */
export function findEffectivePropertySource({
  scopes,
  parsedByBpKey,
  elementClasses,
  elementTag,
  activeDevice,
  activeState,
  group,
  key,
  globals,
  breakpoints,
}) {
  const chain = buildResponsiveFallbackChainForBreakpoint(activeDevice);
  const baseClasses = (elementClasses || []).slice().reverse();
  const useState = activeState && activeState !== 'default';
  const tagKey = elementTag ? `tag:${String(elementTag).toLowerCase()}` : '';

  // Compound scopes (e.g. `.parent .test`, `div h1`) that match the element –
  // the tail segment's tag (if any) must equal the element tag and every
  // class in lastClasses must be on the element. Higher CSS specificity than
  // a single class/tag, so they slot in ahead of `baseClasses`.
  const elementTagLower = elementTag ? String(elementTag).toLowerCase() : '';
  const matchingCompoundKeys = Object.keys(scopes || {}).filter((k) => {
    if (!k.startsWith('compound:')) return false;
    const meta = scopes[k] && scopes[k].__compound;
    if (!meta) return false;
    const lastClasses = Array.isArray(meta.lastClasses) ? meta.lastClasses : [];
    const lastTag = String(meta.lastTag || '').toLowerCase();
    if (!lastClasses.length && !lastTag) return false;
    if (lastTag && lastTag !== elementTagLower) return false;
    return lastClasses.every((cn) => (elementClasses || []).includes(cn));
  });

  // Build the scope order. Local stays first (inline overrides win), then
  // state-suffixed classes (if a state is selected) for full precedence over
  // the default classes that follow. Tag selectors sit last, lowest specificity.
  const scopeOrder = ['local'];
  if (useState) {
    for (const cls of baseClasses) scopeOrder.push(`${cls}:${activeState}`);
    for (const k of matchingCompoundKeys) {
      if (scopes[k].__compound.lastState === activeState) scopeOrder.push(k);
    }
  }
  for (const k of matchingCompoundKeys) {
    if (!scopes[k].__compound.lastState) scopeOrder.push(k);
  }
  for (const cls of baseClasses) scopeOrder.push(cls);
  if (tagKey) {
    if (useState) scopeOrder.push(`${tagKey}:${activeState}`);
    scopeOrder.push(tagKey);
  }

  for (let ci = 0; ci < chain.length; ci++) {
    const chainBp = chain[ci];
    for (const scopeName of scopeOrder) {
      if (!scopeHasValueAtBreakpoint(
        scopes, parsedByBpKey, scopeName, group, key, chainBp, activeDevice,
      )) {
        continue;
      }
      const bag = getParsedScopeBag(scopes, parsedByBpKey, scopeName, chainBp, activeDevice);
      const mergedScopes = { ...scopes, [scopeName]: bag || scopes[scopeName] };
      const r = resolveScopePropertyDisplay(scopeName, group, key, mergedScopes, globals);
      const display = r.display || r.raw || '';
      if (!display && !r.isGlobal) continue;
      return {
        scopeName,
        bpKey: chainBp || 'desktop',
        bpLabel: breakpointLabelForKey(chainBp, breakpoints),
        chainIndex: ci,
        value: display,
        isGlobal: r.isGlobal,
        globalLabel: r.globalLabel,
      };
    }
  }
  return null;
}

/** Active breakpoint owns this property (chain index 0 only). */
export function scopeHasOwnAtActiveBreakpoint(
  scopes,
  parsedByBpKey,
  scopeName,
  group,
  key,
  activeDevice,
  activeMediaQuery,
) {
  const chain = buildResponsiveFallbackChainForBreakpoint(activeDevice);
  const activeBp = chain[0] ?? '';
  const cs = scopes[scopeName];
  if (!cs) return false;
  const fk = `${group}.${key}`;
  if (cs.__globals && cs.__globals[fk]) return true;
  if (!isScopePropOwnAtBp(cs, fk, activeMediaQuery)) return false;
  const v = cs[group] && cs[group][key];
  if (v == null || v === '') return false;
  return normalizeBpKey(activeBp) === normalizeBpKey(activeDevice)
    || getMediaTextForElementorBreakpointKey(activeBp) === activeMediaQuery;
}
