// Shared class suggestion list for Applied Classes and similar UIs.
import { getGlobalClassesCache } from './composer-classes';

/**
 * Build deduped class suggestions from UiChemy's OWN global class system only,
 * followed by any classes already applied on the element (raw_css scopes).
 *
 * @returns {Array<{ name: string, kind: string, title?: string }>}
 */
// A `.selector { … }` class from the Globals Manager is only offerable as a
// literal class name when it's a single simple class (no combinators, no
// pseudo-selectors, no compound parts), e.g. `.pr-card`, not `.pr-card:hover`
// or `.pr-card .title`.
const SIMPLE_CLASS_SELECTOR_RE = /^\.([\w-]+)$/;

export function buildClassSuggestions(scopes, globalClasses) {
  const list = [];
  const seen = new Set();

  const push = (item) => {
    if (!item || !item.name) return;
    const key = item.name;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(item);
  };

  // UiChemy's own global classes, the only suggestions we proactively offer.
  // Elementor Atomic / v3 kit classes are deliberately excluded so this list
  // mirrors our own global system. Two sources, both UiChemy's:
  //  1. The unified Globals Manager's "Other"/"Typography" classes (current
  //     UI, created via composer-variables.jsx, stored in the #uichemy-globals
  //     block, passed in here as `globalClasses`).
  //  2. The legacy standalone Global Classes store (composer-classes.jsx),
  //     kept for sites with older data.
  (globalClasses || []).forEach((c) => {
    if (!c || !c.selector) return;
    const m = SIMPLE_CLASS_SELECTOR_RE.exec(String(c.selector).trim());
    if (!m) return; // compound/pseudo selector, not addable as a single class
    push({ name: m[1], kind: 'uichemy-global', title: c.selector });
  });

  const gc = getGlobalClassesCache();
  (gc.classes || []).forEach((c) => {
    if (!c || !c.id) return;
    push({ name: c.id, kind: 'uichemy-global', title: c.name || c.id });
  });

  Object.keys(scopes || {}).forEach((k) => {
    if (k === 'local') return;
    if (k.startsWith('tag:')) return;
    // Compound class scopes (e.g. `compound:.parent .test`) are surfaced as
    // their own chips in AppliedClasses, they're not valid as a typed-in
    // single class name, so exclude them from the add-class suggestion list.
    if (k.startsWith('compound:')) return;
    push({ name: k, kind: 'existing' });
  });

  return list;
}

export function classSuggestionHint(item) {
  if (!item) return '';
  if (item.kind === 'uichemy-global') return 'Global';
  if (item.kind === 'existing') return 'existing';
  return 'suggestion';
}
