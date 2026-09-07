// Breakpoint-aware CSS region helpers, parity with legacy panel.

/**
 * Map a scope key to its CSS selector.
 *   `foo`              → `.foo`
 *   `foo:hover`        → `.foo:hover`
 *   `tag:h1`           → `h1`
 *   `tag:h1:hover`     → `h1:hover`
 *   `compound:.a .b`   → `.a .b`   (descendant / child / sibling chains)
 */
export function scopeKeyToSelector(scopeKey) {
  const key = String(scopeKey || '');
  if (key.startsWith('tag:')) return key.slice(4);
  if (key.startsWith('compound:')) return key.slice(9);
  return `.${key}`;
}

export function normalizeMediaTextForCompare(mediaText) {
  return String(mediaText || '')
    .toLowerCase()
    .replace(/^\s*(only\s+screen|not\s+all|screen|all)\s+and\s+/, '')
    .replace(/\s+/g, '')
    .trim();
}

export function findMatchingBraceIndex(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Base-level rules live before the first @media block so cascade order stays correct. */
export function findBaseRegionEnd(cssText) {
  const m = /@media\s+/i.exec(String(cssText || ''));
  return m ? m.index : cssText.length;
}

export function findMediaBlockRange(cssText, targetMediaText) {
  const targetNorm = normalizeMediaTextForCompare(targetMediaText);
  if (!targetNorm) return null;
  const headerRe = /@media\s+([^{]+)\{/g;
  let match;
  while ((match = headerRe.exec(cssText)) !== null) {
    const headerMedia = String(match[1] || '').trim();
    if (normalizeMediaTextForCompare(headerMedia) !== targetNorm) continue;
    const openBraceIdx = match.index + match[0].length - 1;
    const closeBraceIdx = findMatchingBraceIndex(cssText, openBraceIdx);
    if (closeBraceIdx === -1) continue;
    return {
      startIdx: match.index,
      openBraceIdx,
      closeBraceIdx,
      bodyStart: openBraceIdx + 1,
      bodyEnd: closeBraceIdx,
    };
  }
  return null;
}

export function findRuleBlockRange(cssText, targetSelector, regionStart, regionEnd) {
  const targetNorm = String(targetSelector || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!targetNorm) return null;
  const end = typeof regionEnd === 'number' ? regionEnd : cssText.length;
  let i = Math.max(0, regionStart || 0);
  while (i < end) {
    while (i < end && /\s/.test(cssText[i])) i++;
    if (i >= end) break;
    if (cssText[i] === '/' && cssText[i + 1] === '*') {
      const e = cssText.indexOf('*/', i + 2);
      if (e === -1 || e >= end) break;
      i = e + 2;
      continue;
    }
    if (cssText[i] === '@') {
      // Scan to the at-rule terminator while ignoring `{`/`;` inside quotes or
      // parentheses. `@import url(...)` URLs can contain semicolons (e.g. Google
      // Fonts `wght@400;500;700`); a naive scan would stop at that inner `;`,
      // desync, and fail to locate the existing rule below, causing a duplicate
      // block to be appended instead of an in-place update.
      let j = i;
      let strCh = '';
      let parenDepth = 0;
      while (j < end) {
        const c = cssText[j];
        if (strCh) {
          if (c === strCh && cssText[j - 1] !== '\\') strCh = '';
        } else if (c === '"' || c === "'") {
          strCh = c;
        } else if (c === '(') {
          parenDepth++;
        } else if (c === ')') {
          if (parenDepth > 0) parenDepth--;
        } else if (parenDepth === 0 && (c === '{' || c === ';')) {
          break;
        }
        j++;
      }
      if (j >= end) break;
      if (cssText[j] === ';') {
        i = j + 1;
        continue;
      }
      const close = findMatchingBraceIndex(cssText, j);
      if (close === -1 || close >= end) break;
      i = close + 1;
      continue;
    }
    if (cssText[i] === '}') {
      i++;
      continue;
    }
    const headerStart = i;
    while (i < end && cssText[i] !== '{' && cssText[i] !== '}') i++;
    if (i >= end || cssText[i] !== '{') break;
    const selectorText = cssText.substring(headerStart, i).trim();
    const openBraceIdx = i;
    const closeBraceIdx = findMatchingBraceIndex(cssText, openBraceIdx);
    if (closeBraceIdx === -1 || closeBraceIdx >= end) break;
    const parts = selectorText
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
      .filter(Boolean);
    const wantsClass = targetNorm.startsWith('.');
    const tagPrefixed = wantsClass
      ? new RegExp(`^[a-z][\\w-]*${targetNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
      : null;
    const matched = parts.indexOf(targetNorm) !== -1
      || (tagPrefixed && parts.some((p) => tagPrefixed.test(p)));
    if (matched) {
      return {
        startIdx: headerStart,
        openBraceIdx,
        closeBraceIdx,
        bodyStart: openBraceIdx + 1,
        bodyEnd: closeBraceIdx,
      };
    }
    i = closeBraceIdx + 1;
  }
  return null;
}

function parseRuleBodyDeclarations(body) {
  const order = [];
  const map = Object.create(null);
  const text = String(body || '');
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === '/' && text[i + 1] === '*') {
      const endComment = text.indexOf('*/', i + 2);
      if (endComment === -1) break;
      i = endComment + 2;
      continue;
    }
    let nameStart = i;
    while (i < text.length && text[i] !== ':' && text[i] !== ';' && text[i] !== '{' && text[i] !== '}') {
      i++;
    }
    if (i >= text.length || text[i] !== ':') {
      if (text[i] === ';') { i++; continue; }
      break;
    }
    const name = text.substring(nameStart, i).trim();
    i++;
    let valueStart = i;
    let depth = 0;
    let quote = '';
    while (i < text.length) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        if (depth > 0) depth--;
      } else if (ch === ';' && depth === 0) {
        break;
      } else if (ch === '}' && depth === 0) {
        break;
      }
      i++;
    }
    const value = text.substring(valueStart, i).trim();
    if (name) {
      if (!(name in map)) order.push(name);
      map[name] = value;
    }
    if (i < text.length && text[i] === ';') i++;
  }
  return { order, map };
}

function serializeRuleBody(declOrder, declMap, indent) {
  const pad = indent || '  ';
  return declOrder
    .filter((name) => String(declMap[name] || '').length > 0)
    .map((name) => `${pad}${name}: ${declMap[name]};`)
    .join('\n');
}

function applyPropMapToDeclarations(declOrder, declMap, propMap) {
  Object.keys(propMap).forEach((property) => {
    const value = String(propMap[property] || '').trim();
    if (value) {
      if (!(property in declMap)) declOrder.push(property);
      declMap[property] = value;
    } else if (property in declMap) {
      delete declMap[property];
      const idx = declOrder.indexOf(property);
      if (idx !== -1) declOrder.splice(idx, 1);
    }
  });
}

// Remove the byte range [removeStart, removeEnd) and the immediately-following
// single line of trailing whitespace. Used to delete a rule whose body became
// empty so an `.myClass { }` skeleton doesn't linger and re-seed the cleared
// value on the next CSS parse.
function trimTrailingRuleWhitespace(cssText, removeStart, removeEnd) {
  const rangeEnd = removeEnd == null ? removeStart : removeEnd;
  let end = rangeEnd;
  while (end < cssText.length && (cssText[end] === '\n' || cssText[end] === ' ' || cssText[end] === '\t')) {
    if (cssText[end] === '\n') { end++; break; }
    end++;
  }
  return cssText.substring(0, removeStart) + cssText.substring(end);
}

/**
 * Merge declaration-level updates into a selector rule inside a region.
 * Empty string values remove properties; removes the rule if the body becomes empty.
 */
export function upsertSelectorRuleInRegion(cssText, regionStart, regionEnd, selector, propMap, indent) {
  const block = findRuleBlockRange(cssText, selector, regionStart, regionEnd);
  const declIndent = indent || '  ';
  if (block) {
    const body = cssText.substring(block.bodyStart, block.bodyEnd);
    const { order, map } = parseRuleBodyDeclarations(body);
    applyPropMapToDeclarations(order, map, propMap);
    const serialized = serializeRuleBody(order, map, declIndent);
    if (!serialized.trim()) {
      return trimTrailingRuleWhitespace(cssText, block.startIdx, block.closeBraceIdx + 1);
    }
    const outerIndent = declIndent.length >= 2 ? declIndent.substring(0, declIndent.length - 2) : '';
    return cssText.substring(0, block.bodyStart)
      + `\n${serialized}\n${outerIndent}`
      + cssText.substring(block.bodyEnd);
  }

  const hasAnyValue = Object.keys(propMap).some((k) => String(propMap[k] || '').trim() !== '');
  if (!hasAnyValue) return cssText;

  const order = [];
  const map = Object.create(null);
  applyPropMapToDeclarations(order, map, propMap);
  const serialized = serializeRuleBody(order, map, declIndent);
  if (!serialized.trim()) return cssText;

  const outerIndent = declIndent.length >= 2 ? declIndent.substring(0, declIndent.length - 2) : '';
  const insertion = `${outerIndent}${selector} {\n${serialized}\n${outerIndent}}\n`;
  const before = cssText.substring(0, regionEnd);
  const after = cssText.substring(regionEnd);
  const needsLeadingNewline = before.length > 0 && before[before.length - 1] !== '\n';
  return before + (needsLeadingNewline ? '\n' : '') + insertion + after;
}

/** Declarations currently in `.className` for a breakpoint region (base or @media). */
export function getClassRuleDeclarationsAtBreakpoint(rawCss, className, mediaQueryInner) {
  const cssText = String(rawCss == null ? '' : rawCss);
  const selector = scopeKeyToSelector(className);
  const mediaTrim = String(mediaQueryInner || '').trim();
  let regionStart = 0;
  let regionEnd = cssText.length;
  if (mediaTrim) {
    const mediaBlock = findMediaBlockRange(cssText, mediaTrim);
    if (!mediaBlock) return { order: [], map: Object.create(null) };
    regionStart = mediaBlock.bodyStart;
    regionEnd = mediaBlock.bodyEnd;
  } else {
    regionEnd = findBaseRegionEnd(cssText);
  }
  const block = findRuleBlockRange(cssText, selector, regionStart, regionEnd);
  if (!block) return { order: [], map: Object.create(null) };
  return parseRuleBodyDeclarations(cssText.substring(block.bodyStart, block.bodyEnd));
}

/**
 * Apply CSS property updates for a class at a specific breakpoint only.
 * @param {Record<string, string>} styleUpdates, CSS property name → value ('' removes)
 */
export function upsertClassStyleUpdatesInBreakpoint(rawCss, className, styleUpdates, mediaQueryInner) {
  const cssText = String(rawCss == null ? '' : rawCss);
  const selector = scopeKeyToSelector(className);
  const mediaTrim = String(mediaQueryInner || '').trim();
  const propMap = styleUpdates && typeof styleUpdates === 'object' ? styleUpdates : {};
  const hasChange = Object.keys(propMap).some((k) => propMap[k] !== undefined);
  if (!hasChange) return cssText;

  if (!mediaTrim) {
    const baseEnd = findBaseRegionEnd(cssText);
    return upsertSelectorRuleInRegion(cssText, 0, baseEnd, selector, propMap, '  ');
  }

  const mediaBlock = findMediaBlockRange(cssText, mediaTrim);
  if (mediaBlock) {
    return upsertSelectorRuleInRegion(
      cssText,
      mediaBlock.bodyStart,
      mediaBlock.bodyEnd,
      selector,
      propMap,
      '    ',
    );
  }

  const hasAnyValue = Object.keys(propMap).some((k) => String(propMap[k] || '').trim() !== '');
  if (!hasAnyValue) return cssText;

  const order = [];
  const map = Object.create(null);
  applyPropMapToDeclarations(order, map, propMap);
  const serialized = serializeRuleBody(order, map, '    ');
  if (!serialized.trim()) return cssText;

  const mediaRule = `@media ${mediaTrim} {\n  ${selector} {\n${serialized}\n  }\n}\n`;
  const prefix = cssText.trim() ? cssText.replace(/\s+$/, '') + '\n\n' : '';
  return `${prefix}${mediaRule}`;
}

/** @deprecated Use upsertClassStyleUpdatesInBreakpoint for incremental writes. */
export function updateRawCssForClassInBreakpoint(rawCss, className, block, mediaQueryInner) {
  const propMap = Object.create(null);
  const bodyMatch = String(block || '').match(/\{([\s\S]*)\}/);
  if (!bodyMatch) {
    return upsertClassStyleUpdatesInBreakpoint(rawCss, className, propMap, mediaQueryInner);
  }
  const decls = bodyMatch[1].split(';');
  decls.forEach((chunk) => {
    const t = chunk.trim();
    if (!t) return;
    const colon = t.indexOf(':');
    if (colon < 0) return;
    const prop = t.slice(0, colon).trim();
    const val = t.slice(colon + 1).trim();
    if (prop) propMap[prop] = val;
  });
  return upsertClassStyleUpdatesInBreakpoint(rawCss, className, propMap, mediaQueryInner);
}
