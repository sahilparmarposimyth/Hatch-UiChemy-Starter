// Parses the widget's `raw_css` (and a selected element's inline `style`)
// into the scope shape the Inspector expects:
//   { typography: {...}, layout: {...}, spacing: {...}, background: {...},
//     border: {...}, effects: {...},
//     __units: { "spacing.padTop": "px", ... },
//     __globals: {}, __shown: {} }
//
// This is read-only for now, the Inspector edits don't write back to
// `raw_css` yet (next slice). The goal here is for property values that
// already exist in CSS to *display* in their right tab.

import { emptyProps } from './composer-data';
import { applyTextShadowToScope } from './composer-shadow-utils';
import { matchTrailingUnit } from './composer-inputs';
import { findMatchingBraceIndex, findMediaBlockRange, findBaseRegionEnd } from './composer-css-media';
import { markParsedScopeOwnership } from './composer-breakpoint-scope';
import { parseColorToRgba, rgbaToHex } from './composer-color-utils';

// Map kebab-case CSS property → { group, key, length? }.
// `length: true` means parse `12px` → number "12" + unit "px" and store
// the unit in `__units.<group>.<key>`. Falsy = store the raw value as-is.
const CSS_TO_SCHEMA = {
  // Typography
  'font-size':              { group: 'typography', key: 'fontSize',           length: true },
  'font-family':            { group: 'typography', key: 'fontFamily' },
  'font-weight':            { group: 'typography', key: 'fontWeight' },
  'line-height':            { group: 'typography', key: 'lineHeight',         length: true },
  'letter-spacing':         { group: 'typography', key: 'letterSpacing',      length: true },
  'word-spacing':           { group: 'typography', key: 'wordSpacing',        length: true },
  'text-align':             { group: 'typography', key: 'textAlign' },
  'color':                  { group: 'typography', key: 'textColor' },
  'font-style':             { group: 'typography', key: 'fontStyle' },
  'text-transform':         { group: 'typography', key: 'textTransform' },
  'text-decoration':        { group: 'typography', key: 'textDecoration' },
  'text-decoration-style':  { group: 'typography', key: 'textDecorationStyle' },
  'white-space':            { group: 'typography', key: 'whiteSpace' },
  'word-break':             { group: 'typography', key: 'wordBreak' },
  'overflow-wrap':          { group: 'typography', key: 'overflowWrap' },
  'font-variant':           { group: 'typography', key: 'fontVariant' },
  'font-stretch':           { group: 'typography', key: 'fontStretch' },
  'direction':              { group: 'typography', key: 'direction' },
  'writing-mode':           { group: 'typography', key: 'writingMode' },
  'text-orientation':       { group: 'typography', key: 'textOrientation' },
  'text-shadow':            { group: 'typography', key: 'textShadow' },

  // Layout
  'display':                { group: 'layout', key: 'display' },
  'position':               { group: 'layout', key: 'position' },
  'box-sizing':             { group: 'layout', key: 'boxSizing' },
  'visibility':             { group: 'layout', key: 'visibility' },
  'width':                  { group: 'layout', key: 'width',      length: true },
  'height':                 { group: 'layout', key: 'height',     length: true },
  'min-width':              { group: 'layout', key: 'minWidth',   length: true },
  'max-width':              { group: 'layout', key: 'maxWidth',   length: true },
  'min-height':             { group: 'layout', key: 'minHeight',  length: true },
  'max-height':             { group: 'layout', key: 'maxHeight',  length: true },
  'top':                    { group: 'layout', key: 'top',        length: true },
  'right':                  { group: 'layout', key: 'right',      length: true },
  'bottom':                 { group: 'layout', key: 'bottom',     length: true },
  'left':                   { group: 'layout', key: 'left',       length: true },
  'z-index':                { group: 'layout', key: 'zIndex' },
  'overflow':               { group: 'layout', key: 'overflow' },
  'overflow-x':             { group: 'layout', key: 'overflowX' },
  'overflow-y':             { group: 'layout', key: 'overflowY' },
  'float':                  { group: 'layout', key: 'float' },
  'clear':                  { group: 'layout', key: 'clear' },
  'cursor':                 { group: 'layout', key: 'cursor' },
  'pointer-events':         { group: 'layout', key: 'pointerEvents' },
  'user-select':            { group: 'layout', key: 'userSelect' },
  'resize':                 { group: 'layout', key: 'resize' },
  'object-fit':             { group: 'layout', key: 'objectFit' },
  'object-position':        { group: 'layout', key: 'objectPosition' },
  'flex-direction':         { group: 'layout', key: 'flexDirection' },
  'flex-wrap':              { group: 'layout', key: 'flexWrap' },
  'justify-content':        { group: 'layout', key: 'justifyContent' },
  'align-items':            { group: 'layout', key: 'alignItems' },
  'align-content':          { group: 'layout', key: 'alignContent' },
  'align-self':             { group: 'layout', key: 'alignSelf' },
  'justify-self':           { group: 'layout', key: 'justifySelf' },
  'flex-grow':              { group: 'layout', key: 'flexGrow' },
  'flex-shrink':            { group: 'layout', key: 'flexShrink' },
  'flex-basis':             { group: 'layout', key: 'flexBasis',  length: true },
  'order':                  { group: 'layout', key: 'order' },
  'grid-template-columns':  { group: 'layout', key: 'gridTemplateColumns' },
  'grid-template-rows':     { group: 'layout', key: 'gridTemplateRows' },
  'grid-auto-flow':         { group: 'layout', key: 'gridAutoFlow' },

  // Spacing
  'padding-top':            { group: 'spacing', key: 'padTop',    length: true },
  'padding-right':          { group: 'spacing', key: 'padRight',  length: true },
  'padding-bottom':         { group: 'spacing', key: 'padBottom', length: true },
  'padding-left':           { group: 'spacing', key: 'padLeft',   length: true },
  'margin-top':             { group: 'spacing', key: 'marTop',    length: true },
  'margin-right':           { group: 'spacing', key: 'marRight',  length: true },
  'margin-bottom':          { group: 'spacing', key: 'marBottom', length: true },
  'margin-left':            { group: 'spacing', key: 'marLeft',   length: true },
  'row-gap':                { group: 'layout',  key: 'rowGap',    length: true },
  'column-gap':             { group: 'layout',  key: 'columnGap', length: true },

  // Background
  'background-color':       { group: 'background', key: 'bgColor' },
  'background-image':       { group: 'background', key: 'bgImage' },
  'background-repeat':      { group: 'background', key: 'bgRepeat' },
  'background-size':        { group: 'background', key: 'bgSize' },
  'background-position':    { group: 'background', key: 'bgPosition' },
  'background-attachment':  { group: 'background', key: 'bgAttachment' },
  'background-origin':      { group: 'background', key: 'bgOrigin' },
  'background-clip':        { group: 'background', key: 'bgClip' },
  'background-blend-mode':  { group: 'background', key: 'bgBlendMode' },

  // Border
  'border-width':              { group: 'border', key: 'width',  length: true },
  'border-style':              { group: 'border', key: 'style' },
  'border-color':              { group: 'border', key: 'color' },
  'border-radius':             { group: 'border', key: 'radius', length: true },
  'border-top-width':          { group: 'border', key: 'bwTop',    length: true },
  'border-right-width':        { group: 'border', key: 'bwRight',  length: true },
  'border-bottom-width':       { group: 'border', key: 'bwBottom', length: true },
  'border-left-width':         { group: 'border', key: 'bwLeft',   length: true },
  'border-top-left-radius':    { group: 'border', key: 'rTL', length: true },
  'border-top-right-radius':   { group: 'border', key: 'rTR', length: true },
  'border-bottom-right-radius':{ group: 'border', key: 'rBR', length: true },
  'border-bottom-left-radius': { group: 'border', key: 'rBL', length: true },

  // Effects
  'opacity':                    { group: 'effects', key: 'opacity' },
  'box-shadow':                 { group: 'effects', key: 'boxShadow' },
  'mix-blend-mode':             { group: 'effects', key: 'mixBlendMode' },
  'transform-origin':           { group: 'effects', key: 'transformOrigin' },
  'transition-property':        { group: 'effects', key: 'transitionProperty' },
  'transition-duration':        { group: 'effects', key: 'transitionDuration', length: true },
  'transition-delay':           { group: 'effects', key: 'transitionDelay',    length: true },
  'transition-timing-function': { group: 'effects', key: 'transitionTiming' },
};

const PARSE_LENGTH_UNITS = [
  'px', '%', 'em', 'rem', 'vw', 'vh', 'vmin', 'vmax', 'ch', 'ex', 'pt', 'pc', 'cm', 'mm', 'in',
  // Angle + time units (effect transforms/filters/transitions). Without these,
  // values like `skewX(40rad)` or `300ms` round-trip back as a unit-less number,
  // so the inspector's unit pill reset to its default on re-parse.
  'deg', 'rad', 'grad', 'turn', 'ms', 's',
  'auto', 'fit-content', 'max-content', 'min-content',
];

function parseLength(value) {
  const v = String(value || '').trim();
  if (!v) return { num: '', unit: '' };
  const matched = matchTrailingUnit(v, PARSE_LENGTH_UNITS);
  if (matched) return matched;
  const numOnly = /^-?[\d.]+$/.exec(v);
  if (numOnly) return { num: numOnly[0], unit: '' };
  return { num: v, unit: '' };
}

function emptyScope() {
  return { ...emptyProps(), __units: {}, __globals: {}, __shown: {} };
}

// Length keywords (fit-content, auto, …) have no numeric part. Ownership
// detection treats an empty value as "unset", so storing the keyword only in
// __units made width/height read as empty after a Code→Layout round-trip.
// Keep the keyword as the value too so the property stays owned.
const LENGTH_KEYWORD_VALUES = new Set([
  'auto', 'fit-content', 'max-content', 'min-content', 'none',
]);

function setLength(scope, group, key, value) {
  const { num, unit } = parseLength(value);
  if (!scope[group]) scope[group] = {};
  const isKeyword = num === '' && LENGTH_KEYWORD_VALUES.has(unit);
  scope[group][key] = isKeyword ? unit : num;
  // Always record the unit slot, even when the parsed value was unitless.
  // The writer differentiates "intentionally unitless" ('') from "no unit
  // info" (undefined), and falling back here loses that distinction.
  scope.__units = scope.__units || {};
  scope.__units[`${group}.${key}`] = unit;
}

/** Apply a single CSS declaration into an Inspector scope (exported for global-class seeding). */
export function applyCssDeclToScope(scope, prop, value) {
  return applyDecl(scope, prop, value);
}

function applyDecl(scope, prop, value) {
  const cleanProp = String(prop || '').trim().toLowerCase();
  const cleanValue = String(value || '').trim().replace(/;+$/g, '').trim();
  if (!cleanValue) {
    if (cleanProp === 'text-shadow') {
      scope.typography = scope.typography || {};
      delete scope.typography.textShadow;
      if (scope.__globals) delete scope.__globals['typography.textShadowColor'];
    }
    return;
  }

  if (cleanProp === 'text-shadow') {
    applyTextShadowToScope(scope, cleanValue);
    return;
  }

  // Shorthand expansions, handle a few common ones so values land in the
  // per-side / per-axis schema slots the Inspector reads.
  if (cleanProp === 'padding' || cleanProp === 'margin') {
    const sides = expandSides(cleanValue);
    if (sides) {
      const prefix = cleanProp === 'padding' ? 'padding' : 'margin';
      applyDecl(scope, `${prefix}-top`,    sides.top);
      applyDecl(scope, `${prefix}-right`,  sides.right);
      applyDecl(scope, `${prefix}-bottom`, sides.bottom);
      applyDecl(scope, `${prefix}-left`,   sides.left);
      return;
    }
  }

  if (cleanProp === 'gap') {
    const parts = cleanValue.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      applyDecl(scope, 'row-gap', parts[0]);
      applyDecl(scope, 'column-gap', parts[0]);
      return;
    }
    if (parts.length === 2) {
      applyDecl(scope, 'row-gap', parts[0]);
      applyDecl(scope, 'column-gap', parts[1]);
      return;
    }
  }

  if (cleanProp === 'border') {
    // e.g. "1px solid #000", fan out width / style / color.
    const parts = splitOutsideParens(cleanValue);
    for (const p of parts) {
      if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(p)) {
        applyDecl(scope, 'border-style', p);
      } else if (/^(?:#|rgb|hsl|var\()/i.test(p) || /^[a-z]+$/i.test(p)) {
        applyDecl(scope, 'border-color', p);
      } else if (/\d/.test(p)) {
        applyDecl(scope, 'border-width', p);
      }
    }
    return;
  }

  if (cleanProp === 'background') {
    // Very crude: if the value is a color-ish token, treat it as bg-color.
    // Otherwise (urls, gradients) drop into bg-image.
    if (/^(#|rgb|hsl)/i.test(cleanValue) || /^[a-z]+$/i.test(cleanValue)) {
      applyDecl(scope, 'background-color', cleanValue);
    } else {
      applyDecl(scope, 'background-image', cleanValue);
    }
    return;
  }

  // Compound: filter → individual filter schema keys
  if (cleanProp === 'filter' && cleanValue !== 'none') {
    const FILTER_TO_KEY = {
      'blur':       'blur',
      'brightness': 'brightness',
      'contrast':   'contrast',
      'saturate':   'saturate',
      'hue-rotate': 'hueRotate',
      'grayscale':  'grayscale',
      'invert':     'invert',
      'sepia':      'sepia',
    };
    const fnRe = /([\w-]+)\(\s*([^)]*?)\s*\)/g;
    let m;
    while ((m = fnRe.exec(cleanValue)) !== null) {
      const key = FILTER_TO_KEY[m[1].toLowerCase()];
      if (key) {
        scope.effects = scope.effects || {};
        setLength(scope, 'effects', key, m[2].trim());
      }
    }
    return;
  }

  // Compound: transform → individual transform schema keys
  if (cleanProp === 'transform' && cleanValue !== 'none') {
    const TRANSFORM_TO_KEY = {
      'translatex': 'translateX',
      'translatey': 'translateY',
      'rotate':     'rotate',
      'scale':      'scale',
      'skewx':      'skewX',
      'skewy':      'skewY',
    };
    const fnRe = /([\w-]+)\(\s*([^)]*?)\s*\)/g;
    let m;
    while ((m = fnRe.exec(cleanValue)) !== null) {
      const key = TRANSFORM_TO_KEY[m[1].toLowerCase()];
      if (key) {
        scope.effects = scope.effects || {};
        if (key === 'scale') {
          scope.effects[key] = m[2].trim();
        } else {
          setLength(scope, 'effects', key, m[2].trim());
        }
      }
    }
    return;
  }

  // Shorthand: transition → fan out to individual transition properties
  if (cleanProp === 'transition') {
    const parts = splitOutsideParens(cleanValue);
    const times = parts.filter((p) => /^[\d.]+m?s$/i.test(p));
    const nonTimes = parts.filter((p) => !/^[\d.]+m?s$/i.test(p));
    if (nonTimes[0]) applyDecl(scope, 'transition-property', nonTimes[0]);
    if (times[0])    applyDecl(scope, 'transition-duration', times[0]);
    if (times[1])    applyDecl(scope, 'transition-delay', times[1]);
    if (nonTimes[1]) applyDecl(scope, 'transition-timing-function', nonTimes[1]);
    return;
  }

  const map = CSS_TO_SCHEMA[cleanProp];
  if (!map) {
    scope.customCss = Array.isArray(scope.customCss) ? scope.customCss : [];
    const existingIdx = scope.customCss.findIndex((item) => item && item.prop === cleanProp);
    const item = { prop: cleanProp, value: cleanValue };
    if (existingIdx >= 0) scope.customCss[existingIdx] = item;
    else scope.customCss.push(item);
    return;
  }
  const { group, key, length } = map;
  // background-image: a gradient value is written by the inspector via
  // the bgGradient slot, not bgImage. If we route a gradient string back
  // into bgImage during a round-trip parse, the inspector tab strip flips
  // to Image and the gradient builder loses its source. Skip gradients here
  //, the inspector keeps the authoritative JSON in scope.bgGradient.
  if (cleanProp === 'background-image' && /-gradient\s*\(/i.test(cleanValue)) {
    const parsedGrad = parseGradientCSS(cleanValue);
    if (parsedGrad) {
      if (!scope[group]) scope[group] = {};
      scope[group].bgGradient = JSON.stringify(parsedGrad);
    }
    return;
  }
  if (!scope[group]) scope[group] = {};

  if (length) setLength(scope, group, key, cleanValue);
  else scope[group][key] = cleanValue;
}

function expandSides(value) {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  if (parts.length === 4) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  return null;
}

function splitOutsideParens(str) {
  // Splits on whitespace but keeps content inside `(...)` together so
  // values like `rgba(0,0,0,.5)` survive intact.
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (buf) { out.push(buf); buf = ''; }
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function parseDeclarations(declText) {
  const out = [];
  const text = String(declText || '');
  let depth = 0;
  let buf = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      pushDecl(out, buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  pushDecl(out, buf);
  return out;
}

function pushDecl(out, raw) {
  const t = raw.trim();
  if (!t) return;
  const colonIdx = t.indexOf(':');
  if (colonIdx < 0) return;
  const prop = t.slice(0, colonIdx).trim().toLowerCase();
  const val = t.slice(colonIdx + 1).trim().replace(/!\s*important$/i, '').trim();
  out.push([prop, val]);
}

/**
 * Detect a compound selector built from class / tag segments joined by
 * descendant / child / sibling combinators, `.parent .test`, `.a > .b`,
 * `div h1`, `div .child:hover`, `h1.foo .bar`, etc. Returns null when the
 * selector contains IDs, attributes, pseudo-elements, or `&`.
 *
 * Each segment is either a tag, a class chain, or both, with an optional
 * trailing `:state`. At least one of (tag, class) must be present per segment
 * and the selector must have at least two segments overall.
 *
 * @returns {null | { normalized: string, classes: string[], lastClasses: string[], lastTag: string, lastState: string }}
 */
export function parseCompoundClassSelector(sel) {
  const raw = String(sel || '').trim();
  if (!raw) return null;
  if (/[#\[\]&]|::/.test(raw)) return null;
  const norm = raw.replace(/\s*([>+~])\s*/g, ' $1 ').replace(/\s+/g, ' ').trim();
  const tokens = norm.split(' ');
  if (tokens.length < 2) return null;

  const SEG_RE = /^([A-Za-z][\w-]*)?((?:\.[A-Za-z_][\w-]*)*)(?::([a-z-]+))?$/;
  const segments = [];
  for (const t of tokens) {
    if (t === '>' || t === '+' || t === '~') continue;
    const m = SEG_RE.exec(t);
    if (!m) return null;
    const tag = (m[1] || '').toLowerCase();
    const classChain = m[2] || '';
    const state = m[3] || '';
    if (!tag && !classChain) return null;
    const classes = [];
    const classRe = /\.([A-Za-z_][\w-]*)/g;
    let mm;
    while ((mm = classRe.exec(classChain)) !== null) classes.push(mm[1]);
    segments.push({ tag, classes, state });
  }
  if (segments.length < 2) return null;

  const last = segments[segments.length - 1];
  return {
    normalized: norm,
    classes: segments.flatMap((s) => s.classes),
    lastClasses: last.classes,
    lastTag: last.tag,
    lastState: last.state,
  };
}

function parseClassScopesInRegion(cssText, regionStart, regionEnd) {
  const out = {};
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
      // Scan to the at-rule terminator, but ignore `{`/`;` that live inside a
      // quoted string or parentheses. Critical for `@import url(...)` whose URL
      // can contain semicolons (e.g. Google Fonts `wght@400;500;700`); a naive
      // scan would stop at that inner `;` and discard every rule below it.
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
    const selectorRaw = cssText.substring(headerStart, i).trim();
    const openBraceIdx = i;
    const closeBraceIdx = findMatchingBraceIndex(cssText, openBraceIdx);
    if (closeBraceIdx === -1 || closeBraceIdx >= end) break;
    const body = cssText.substring(openBraceIdx + 1, closeBraceIdx);
    const selectors = selectorRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const decls = parseDeclarations(body);
    for (const sel of selectors) {
      // Match `.foo`, `tag.foo`, or `tag` (and any `:state` variant).
      // Pseudo-state goes into a compound scope key `<base>:state` so per-state
      // styles flow through the cascade independently of the default block.
      // Tag-only selectors are stored under `tag:<name>` so the inspector can
      // surface them for elements that match the tag.
      const cls = /^(?:[A-Za-z][\w-]*)?\.([A-Za-z_][\w-]*)(?::([a-z-]+))?$/.exec(sel);
      const tag = !cls && /^([A-Za-z][\w-]*)(?::([a-z-]+))?$/.exec(sel);
      const compound = !cls && !tag && parseCompoundClassSelector(sel);
      let scopeKey = '';
      if (cls) {
        const className = cls[1];
        const pseudoState = cls[2] || '';
        scopeKey = pseudoState ? `${className}:${pseudoState}` : className;
      } else if (tag) {
        const tagName = tag[1].toLowerCase();
        const pseudoState = tag[2] || '';
        scopeKey = pseudoState ? `tag:${tagName}:${pseudoState}` : `tag:${tagName}`;
      } else if (compound) {
        // Compound selectors (descendant / child / sibling chains of class
        // segments) get their own scope key prefixed with `compound:` so they
        // surface in the inspector without colliding with simple class scopes.
        // The CSS writer treats compound scopes as read-only, see app.jsx.
        scopeKey = `compound:${compound.normalized}`;
        if (!out[scopeKey]) {
          out[scopeKey] = emptyScope();
          out[scopeKey].__compound = compound;
        }
      } else {
        continue;
      }
      if (!out[scopeKey]) out[scopeKey] = emptyScope();
      for (const [p, v] of decls) applyDecl(out[scopeKey], p, v);
    }
    i = closeBraceIdx + 1;
  }
  return out;
}

/**
 * Parse class scopes from raw_css for the active breakpoint only.
 * @param {string} rawCss
 * @param {{ mediaQuery?: string }} [options], inner media condition, e.g. `(max-width: 1024px)`; empty = desktop/base
 */
export function parseCssToScopes(rawCss, options = {}) {
  if (!rawCss) return {};
  const css = String(rawCss).replace(/\/\*[\s\S]*?\*\//g, '');
  const mediaQuery = String(options.mediaQuery || '').trim();

  let scopes;
  if (!mediaQuery) {
    scopes = parseClassScopesInRegion(css, 0, findBaseRegionEnd(css));
  } else {
    const mediaBlock = findMediaBlockRange(css, mediaQuery);
    if (!mediaBlock) return {};
    scopes = parseClassScopesInRegion(css, mediaBlock.bodyStart, mediaBlock.bodyEnd);
  }

  const out = {};
  Object.keys(scopes).forEach((className) => {
    out[className] = markParsedScopeOwnership(scopes[className], mediaQuery);
  });
  return out;
}

export function parseInlineStyleToScope(styleStr) {
  const scope = emptyScope();
  if (!styleStr) return scope;
  for (const [p, v] of parseDeclarations(styleStr)) applyDecl(scope, p, v);
  // Mark breakpoint ownership so cascade/UI treat inline values as Local
  // overrides (same as parsed class rules). Without this, Class scope inputs
  // show the class value after refresh even when Local wins in the browser.
  return markParsedScopeOwnership(scope, '');
}

function parseGradientCSS(css) {
  const m = /^\s*(linear|radial|conic)-gradient\((.*)\)\s*$/i.exec(css.trim());
  if (!m) return null;
  const type = m[1].toLowerCase();
  const inner = m[2].trim();

  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current.trim());

  if (parts.length < 2) return null;

  let angle = 90;
  let radialShape = 'circle';
  let radialPos = 'center';
  let firstPart = parts[0];
  let stopsStartIndex = 0;

  if (type === 'linear') {
    if (/^\d+deg$/i.test(firstPart)) {
      angle = parseInt(firstPart);
      stopsStartIndex = 1;
    } else if (firstPart.startsWith('to ')) {
      const dir = firstPart.slice(3).toLowerCase();
      if (dir === 'right') angle = 90;
      else if (dir === 'left') angle = 270;
      else if (dir === 'top') angle = 0;
      else if (dir === 'bottom') angle = 180;
      else if (dir === 'top right' || dir === 'right top') angle = 45;
      else if (dir === 'bottom right' || dir === 'right bottom') angle = 135;
      else if (dir === 'bottom left' || dir === 'left bottom') angle = 225;
      else if (dir === 'top left' || dir === 'left top') angle = 315;
      stopsStartIndex = 1;
    }
  } else if (type === 'radial') {
    if (firstPart.includes(' at ')) {
      const sub = firstPart.split(' at ');
      radialShape = sub[0].trim();
      radialPos = sub[1].trim();
      stopsStartIndex = 1;
    } else if (firstPart === 'circle' || firstPart === 'ellipse') {
      radialShape = firstPart;
      stopsStartIndex = 1;
    }
  } else if (type === 'conic') {
    // conic-gradient( [from <angle>deg] [at <pos>] , stops… )
    // The optional config prefix is NOT a colour stop, skip it, otherwise
    // "from 90deg at 50% 50%" gets mis-parsed as a stop (and re-emitted on
    // every save, accumulating bogus stops).
    if (/(^|\s)from\s/i.test(firstPart) || /(^|\s)at\s/i.test(firstPart)) {
      const fromM = /from\s+(-?\d*\.?\d+)deg/i.exec(firstPart);
      if (fromM) angle = parseFloat(fromM[1]);
      const atM = /\bat\s+(.+)$/i.exec(firstPart);
      if (atM) radialPos = atM[1].trim();
      stopsStartIndex = 1;
    }
  }

  const stops = [];
  for (let i = stopsStartIndex; i < parts.length; i++) {
    const part = parts[i];
    const lastSpace = part.lastIndexOf(' ');
    let colorPart = part;
    let pos = null;
    if (lastSpace > 0) {
      const possiblePos = part.slice(lastSpace + 1).trim();
      if (possiblePos.endsWith('%')) {
        pos = parseFloat(possiblePos);
        colorPart = part.slice(0, lastSpace).trim();
      }
    }

    const rgba = parseColorToRgba(colorPart);
    let color = colorPart;
    let opacity = 100;
    if (rgba) {
      color = rgbaToHex(rgba, false);
      opacity = Math.round(rgba.a * 100);
    } else if (!/^(#|rgb|hsl|var\(|[a-z]+$)/i.test(colorPart)) {
      // Not a colour (e.g. a leaked "from 90deg at 50%" config fragment from
      // previously-corrupted data), drop it so it can't linger or re-emit.
      continue;
    }

    stops.push({
      color,
      pos,
      opacity
    });
  }

  if (stops.length > 0) {
    if (stops[0].pos === null) stops[0].pos = 0;
    if (stops[stops.length - 1].pos === null) stops[stops.length - 1].pos = 100;

    for (let i = 0; i < stops.length; i++) {
      if (stops[i].pos === null || stops[i].pos === 0 && i > 0) {
        let nextIndex = i;
        while (nextIndex < stops.length && (stops[nextIndex].pos === null || stops[nextIndex].pos === 0 && nextIndex > 0)) {
          nextIndex++;
        }
        const startPos = stops[i - 1].pos;
        const endPos = nextIndex < stops.length ? stops[nextIndex].pos : 100;
        const steps = nextIndex - i + 1;
        const stepSize = (endPos - startPos) / steps;
        for (let j = i; j < nextIndex; j++) {
          stops[j].pos = Math.round(startPos + stepSize * (j - i + 1));
        }
        i = nextIndex - 1;
      }
    }
  }

  return {
    // The builder's tabs use 'angular'; CSS uses 'conic-gradient'. Normalise so
    // a parsed conic gradient re-selects the right tab (and round-trips cleanly).
    type: type === 'conic' ? 'angular' : type,
    angle,
    radialShape,
    radialPos,
    stops
  };
}
