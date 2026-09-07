// Reverse of composer-css-parser: serialises an Inspector scope object back
// into CSS, and surgically inserts/replaces the matching `.classname { ... }`
// block in the widget's raw_css. The Local scope is serialised to a
// single declaration string and written to the selected element's `style`
// attribute inside raw_html.

import {
  resolveNodeByPath, normalizeUichemyTags, denormalizeUichemyTags,
} from './composer-layer-tree';
import {
  getClassRuleDeclarationsAtBreakpoint,
  upsertClassStyleUpdatesInBreakpoint,
} from './composer-css-media';
import {
  isScopePropOwnAtBp,
  listScopePropsOwnAtBp,
} from './composer-breakpoint-scope';
import { formatTextShadow, parseTextShadow } from './composer-shadow-utils';
import { gradientCSS } from './composer-gradient';
import { SCHEMA, resolveUnits } from './composer-schema';

// Schema-key → CSS property + length flag (this is the reverse map of the
// parser's CSS_TO_SCHEMA; kept in sync with that table).
const SCHEMA_TO_CSS = {
  // Typography
  'typography.fontSize':            { prop: 'font-size',            length: true },
  'typography.fontFamily':          { prop: 'font-family' },
  'typography.fontWeight':          { prop: 'font-weight' },
  'typography.lineHeight':          { prop: 'line-height',          length: true },
  'typography.letterSpacing':       { prop: 'letter-spacing',       length: true },
  'typography.wordSpacing':         { prop: 'word-spacing',         length: true },
  'typography.textAlign':           { prop: 'text-align' },
  'typography.textColor':           { prop: 'color' },
  'typography.fontStyle':           { prop: 'font-style' },
  'typography.textTransform':       { prop: 'text-transform' },
  'typography.textDecoration':      { prop: 'text-decoration' },
  'typography.textDecorationStyle': { prop: 'text-decoration-style' },
  'typography.whiteSpace':          { prop: 'white-space' },
  'typography.wordBreak':           { prop: 'word-break' },
  'typography.overflowWrap':        { prop: 'overflow-wrap' },
  'typography.fontVariant':         { prop: 'font-variant' },
  'typography.fontStretch':         { prop: 'font-stretch' },
  'typography.direction':           { prop: 'direction' },
  'typography.writingMode':         { prop: 'writing-mode' },
  'typography.textOrientation':     { prop: 'text-orientation' },
  'typography.textShadow':          { prop: 'text-shadow' },

  // Layout
  'layout.display':                 { prop: 'display' },
  'layout.position':                { prop: 'position' },
  'layout.boxSizing':               { prop: 'box-sizing' },
  'layout.visibility':              { prop: 'visibility' },
  'layout.width':                   { prop: 'width',                length: true },
  'layout.height':                  { prop: 'height',               length: true },
  'layout.minWidth':                { prop: 'min-width',            length: true },
  'layout.maxWidth':                { prop: 'max-width',            length: true },
  'layout.minHeight':               { prop: 'min-height',           length: true },
  'layout.maxHeight':               { prop: 'max-height',           length: true },
  'layout.top':                     { prop: 'top',                  length: true },
  'layout.right':                   { prop: 'right',                length: true },
  'layout.bottom':                  { prop: 'bottom',               length: true },
  'layout.left':                    { prop: 'left',                 length: true },
  'layout.zIndex':                  { prop: 'z-index' },
  'layout.overflow':                { prop: 'overflow' },
  'layout.overflowX':               { prop: 'overflow-x' },
  'layout.overflowY':               { prop: 'overflow-y' },
  'layout.float':                   { prop: 'float' },
  'layout.clear':                   { prop: 'clear' },
  'layout.cursor':                  { prop: 'cursor' },
  'layout.pointerEvents':           { prop: 'pointer-events' },
  'layout.userSelect':              { prop: 'user-select' },
  'layout.resize':                  { prop: 'resize' },
  'layout.objectFit':               { prop: 'object-fit' },
  'layout.objectPosition':          { prop: 'object-position' },
  'layout.flexDirection':           { prop: 'flex-direction' },
  'layout.flexWrap':                { prop: 'flex-wrap' },
  'layout.justifyContent':          { prop: 'justify-content' },
  'layout.alignItems':              { prop: 'align-items' },
  'layout.alignContent':            { prop: 'align-content' },
  'layout.alignSelf':               { prop: 'align-self' },
  'layout.justifySelf':             { prop: 'justify-self' },
  'layout.flexGrow':                { prop: 'flex-grow' },
  'layout.flexShrink':              { prop: 'flex-shrink' },
  'layout.flexBasis':               { prop: 'flex-basis',           length: true },
  'layout.order':                   { prop: 'order' },
  'layout.gridTemplateColumns':     { prop: 'grid-template-columns' },
  'layout.gridTemplateRows':        { prop: 'grid-template-rows' },
  'layout.gridAutoFlow':            { prop: 'grid-auto-flow' },
  'layout.rowGap':                  { prop: 'row-gap',        length: true },
  'layout.columnGap':               { prop: 'column-gap',     length: true },

  // Spacing
  'spacing.padTop':                 { prop: 'padding-top',    length: true },
  'spacing.padRight':               { prop: 'padding-right',  length: true },
  'spacing.padBottom':              { prop: 'padding-bottom', length: true },
  'spacing.padLeft':                { prop: 'padding-left',   length: true },
  'spacing.marTop':                 { prop: 'margin-top',     length: true },
  'spacing.marRight':               { prop: 'margin-right',   length: true },
  'spacing.marBottom':              { prop: 'margin-bottom',  length: true },
  'spacing.marLeft':                { prop: 'margin-left',    length: true },

  // Background
  'background.bgColor':             { prop: 'background-color' },
  'background.bgImage':             { prop: 'background-image' },
  'background.bgGradient':          { prop: 'background-image', gradient: true },
  'background.bgRepeat':            { prop: 'background-repeat' },
  'background.bgSize':              { prop: 'background-size' },
  'background.bgPosition':          { prop: 'background-position' },
  'background.bgAttachment':        { prop: 'background-attachment' },
  'background.bgOrigin':            { prop: 'background-origin' },
  'background.bgClip':              { prop: 'background-clip' },
  'background.bgBlendMode':         { prop: 'background-blend-mode' },

  // Border
  'border.width':                   { prop: 'border-width',         length: true },
  'border.style':                   { prop: 'border-style' },
  'border.color':                   { prop: 'border-color' },
  'border.radius':                  { prop: 'border-radius',        length: true },
  'border.bwTop':                   { prop: 'border-top-width',     length: true },
  'border.bwRight':                 { prop: 'border-right-width',   length: true },
  'border.bwBottom':                { prop: 'border-bottom-width',  length: true },
  'border.bwLeft':                  { prop: 'border-left-width',    length: true },
  'border.rTL':                     { prop: 'border-top-left-radius',     length: true },
  'border.rTR':                     { prop: 'border-top-right-radius',    length: true },
  'border.rBR':                     { prop: 'border-bottom-right-radius', length: true },
  'border.rBL':                     { prop: 'border-bottom-left-radius',  length: true },

  // Effects
  'effects.opacity':                { prop: 'opacity' },
  'effects.boxShadow':              { prop: 'box-shadow' },
  'effects.mixBlendMode':           { prop: 'mix-blend-mode' },
  'effects.transformOrigin':        { prop: 'transform-origin' },
  'effects.transitionProperty':     { prop: 'transition-property' },
  'effects.transitionDuration':     { prop: 'transition-duration',  length: true },
  'effects.transitionDelay':        { prop: 'transition-delay',     length: true },
  'effects.transitionTiming':       { prop: 'transition-timing-function' },
};

// Filter function entries: [schemaKey, CSS-function-name]
const FILTER_FN_ENTRIES = [
  ['blur',       'blur'],
  ['brightness', 'brightness'],
  ['contrast',   'contrast'],
  ['saturate',   'saturate'],
  ['hueRotate',  'hue-rotate'],
  ['grayscale',  'grayscale'],
  ['invert',     'invert'],
  ['sepia',      'sepia'],
];

// Transform function keys (camelCase = CSS function name)
const TRANSFORM_KEYS = ['translateX', 'translateY', 'rotate', 'scale', 'skewX', 'skewY'];

// Schema-driven default unit for each effect length property (e.g. skewX → deg,
// brightness → %, transitionDuration → ms). Used as the emit-time fallback so a
// field the user never touched the unit-pill on serialises with its real unit
// instead of withUnit()'s generic `px` default — which produced invalid output
// like `skewX(10px)` / `brightness(50px)`.
const EFFECT_DEFAULT_UNITS = (() => {
  const out = {};
  for (const p of (SCHEMA.effects || [])) {
    if (p.type === 'length' && p.units) {
      const u = resolveUnits(p.units);
      if (u && u[0]) out[p.k] = u[0];
    }
  }
  return out;
})();

// Shadow preset → CSS box-shadow value
const SHADOW_PRESET_VALUES = {
  'none':            'none',
  'sm subtle':     '0 1px 2px rgba(0,0,0,.05)',
  'md soft':       '0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -1px rgba(0,0,0,.06)',
  'lg elevated':   '0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -2px rgba(0,0,0,.05)',
  'xl floating':   '0 20px 25px -5px rgba(0,0,0,.1),0 10px 10px -5px rgba(0,0,0,.04)',
  '2xl dramatic':  '0 25px 50px -12px rgba(0,0,0,.25)',
  'inset pressed': 'inset 0 2px 4px rgba(0,0,0,.06)',
};

/** CSS property names we manage in class rules (for stale-declaration cleanup). */
const MANAGED_CSS_PROPS = new Set(
  Object.values(SCHEMA_TO_CSS).map((m) => m.prop),
);
// Compound props not in SCHEMA_TO_CSS — add manually for cleanup tracking
MANAGED_CSS_PROPS.add('filter');
MANAGED_CSS_PROPS.add('transform');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse scope.customCss (array or legacy string) into [{prop,value}] pairs. */
function parseCustomCssItems(raw) {
  const cleanItem = (item) => {
    if (!item || !item.prop) return null;
    const prop = String(item.prop || '').trim().replace(/[;{}]+$/g, '').trim();
    const value = String(item.value == null ? '' : item.value).trim().replace(/;+$/g, '').trim();
    return prop && value ? { prop, value } : null;
  };
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(cleanItem).filter(Boolean);
  if (typeof raw === 'string') {
    return raw.split(';').map(d => {
      const t = d.trim(); if (!t) return null;
      const ci = t.indexOf(':');
      return ci > 0 ? cleanItem({ prop: t.slice(0, ci), value: t.slice(ci + 1) }) : null;
    }).filter(Boolean).filter(i => i.value);
  }
  return [];
}

function looksAlreadyUnited(value) {
  // Treat the value as already-formatted if it ends in any non-numeric
  // suffix (px, %, em, rem, vw, vh, deg, ms, s, auto, keywords, fn-calls).
  return /[%a-zA-Z)]\s*$/.test(value) || value === 'auto' || value === 'none';
}

// Length keywords are complete values, not suffixes — they must replace the
// numeric value, never append to it. Picking "fit-content" from the unit pill
// leaves the prior number (e.g. "300") in the bag; without this guard the
// writer emitted "300fit-content".
const KEYWORD_UNITS = new Set([
  'auto', 'fit-content', 'max-content', 'min-content',
  'none', 'inherit', 'initial', 'unset', 'revert', 'normal',
]);

function withUnit(value, unit) {
  if (unit && KEYWORD_UNITS.has(unit)) return unit;
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (!s) return '';
  if (looksAlreadyUnited(s)) return s;
  // unit === '' means intentionally unitless (e.g. line-height: 1.5).
  if (unit === '') return s;
  if (unit) return `${s}${unit}`;
  const num = parseFloat(s);
  if (Number.isFinite(num) && Math.abs(num) < 10 && /\./.test(s)) return s;
  return `${s}px`;
}

// Color schema keys that may hold a linked custom-property reference.
const COLOR_SCHEMA_KEYS = new Set([
  'typography.textColor',
  'typography.textShadowColor',
  'background.bgColor',
  'border.color',
]);

// A color scope may carry a generic custom-property link (e.g. `--my-var`) in
// `__globals`; emit it as-is. Any other id has no var mapping.
function globalVarFor(group, key, globalId) {
  if (!globalId) return null;
  const id = String(globalId);
  if (COLOR_SCHEMA_KEYS.has(`${group}.${key}`) && id.startsWith('--')) return id;
  return null;
}

const DATA_GROUPS = ['typography', 'layout', 'spacing', 'background', 'border', 'effects'];

/**
 * Walks the schema groups in a scope and returns an ordered array of
 * `[cssProp, valueWithUnit]` pairs ready to be joined.
 *
 * When the scope has `__globals['group.key']` set to a custom-property
 * reference, a `var(--…)` is emitted instead of the raw value.
 */
export function scopeToDeclarations(scope) {
  const out = [];
  if (!scope || typeof scope !== 'object') return out;
  const units = scope.__units || {};
  const globals = scope.__globals || {};
  const emitted = new Set();

  for (const group of DATA_GROUPS) {
    const bag = scope[group];
    if (!bag || typeof bag !== 'object') continue;
    for (const [k] of Object.entries(bag)) {
      const map = SCHEMA_TO_CSS[`${group}.${k}`];
      if (!map) continue;
      const globalId = globals[`${group}.${k}`];
      if (globalId) {
        const varName = globalVarFor(group, k, globalId);
        if (varName) {
          out.push([map.prop, `var(${varName})`]);
          emitted.add(`${group}.${k}`);
          continue;
        }
      }
      if (group === 'typography' && k === 'textShadow') {
        const shadowColorGlobal = globals['typography.textShadowColor'];
        const raw = bag[k];
        if (raw != null && raw !== '' || shadowColorGlobal) {
          const parsed = parseTextShadow(raw || '0 0 0');
          let color = parsed.color;
          if (shadowColorGlobal) {
            const varName = globalVarFor('typography', 'textShadowColor', shadowColorGlobal);
            if (varName) color = `var(${varName})`;
          }
          const value = formatTextShadow({ ...parsed, color });
          if (value) {
            out.push([map.prop, value]);
            emitted.add(`${group}.${k}`);
            if (shadowColorGlobal) emitted.add('typography.textShadowColor');
          }
        }
        continue;
      }
      // bgGradient: parse JSON → CSS gradient string → emit as background-image
      if (map.gradient) {
        const raw = bag[k];
        if (raw == null || raw === '') continue;
        try {
          const g = typeof raw === 'object' ? raw : JSON.parse(String(raw));
          const css = gradientCSS(g);
          if (css && css !== 'none') {
            out.push([map.prop, css]);
            emitted.add(`${group}.${k}`);
            emitted.add('background.bgImage'); // prevent duplicate background-image
          }
        } catch {}
        continue;
      }
      // Skip bgImage if gradient already emitted it
      if (group === 'background' && k === 'bgImage' && emitted.has('background.bgGradient')) continue;

      const raw = bag[k];
      if (raw == null || raw === '') continue;
      const storedUnit = units[`${group}.${k}`];
      const value = map.length
        // For effect length props the unit pill never offers a unitless option,
        // so a missing/empty stored unit ('' from a unitless round-trip parse, or
        // undefined) must fall back to the schema default — `||` catches both.
        // Non-effect groups keep '' as intentional unitless (e.g. line-height).
        ? withUnit(raw, group === 'effects' ? (storedUnit || EFFECT_DEFAULT_UNITS[k]) : storedUnit)
        : String(raw);
      if (value === '') continue;
      out.push([map.prop, value]);
      emitted.add(`${group}.${k}`);
    }
  }

  // Compound: filter (blur / brightness / contrast / saturate / hue-rotate / grayscale / invert / sepia)
  {
    const eff = scope.effects;
    if (eff) {
      const parts = [];
      for (const [schemaKey, fnName] of FILTER_FN_ENTRIES) {
        const raw = eff[schemaKey];
        if (raw == null || raw === '') continue;
        const val = withUnit(raw, units[`effects.${schemaKey}`] || EFFECT_DEFAULT_UNITS[schemaKey]);
        if (val) parts.push(`${fnName}(${val})`);
      }
      if (parts.length) out.push(['filter', parts.join(' ')]);
    }
  }

  // Compound: transform (translateX / translateY / rotate / scale / skewX / skewY)
  {
    const eff = scope.effects;
    if (eff) {
      const parts = [];
      for (const schemaKey of TRANSFORM_KEYS) {
        const raw = eff[schemaKey];
        if (raw == null || raw === '') continue;
        const val = schemaKey === 'scale' ? String(raw) : withUnit(raw, units[`effects.${schemaKey}`] || EFFECT_DEFAULT_UNITS[schemaKey]);
        if (val) parts.push(`${schemaKey}(${val})`);
      }
      if (parts.length) out.push(['transform', parts.join(' ')]);
    }
  }

  // Shadow preset → box-shadow (only when no custom boxShadow is set)
  {
    const eff = scope.effects;
    if (eff && eff.shadow && !emitted.has('effects.boxShadow')) {
      const presetVal = SHADOW_PRESET_VALUES[eff.shadow];
      if (presetVal != null) out.push(['box-shadow', presetVal]);
    }
  }

  // Custom CSS (user-added property: value pairs)
  {
    const raw = scope.customCss;
    const items = Array.isArray(raw) ? raw
      : (typeof raw === 'string')
        ? raw.split(';').map(d => {
            const t = d.trim(); if (!t) return null;
            const ci = t.indexOf(':');
            return ci > 0 ? { prop: t.slice(0, ci).trim(), value: t.slice(ci + 1).trim() } : null;
          }).filter(Boolean)
        : [];
    for (const item of items) {
      const prop = String(item.prop || '').trim().replace(/[;{}]+$/g, '').trim();
      const value = String(item.value == null ? '' : item.value).trim().replace(/;+$/g, '').trim();
      if (prop && value) out.push([prop, value]);
    }
  }

  // Globals-only links (no entry in the value bag yet) still need to be
  // emitted so toggling a global on a previously-unset property writes
  // through to raw_css.
  for (const fullKey of Object.keys(globals)) {
    if (emitted.has(fullKey)) continue;
    const map = SCHEMA_TO_CSS[fullKey];
    if (!map) continue;
    const [group, key] = fullKey.split('.');
    const varName = globalVarFor(group, key, globals[fullKey]);
    if (!varName) continue;
    out.push([map.prop, `var(${varName})`]);
  }

  return out;
}

export function scopeToCssBlock(className, scope) {
  const decls = scopeToDeclarations(scope);
  if (decls.length === 0) return '';
  const body = decls.map(([p, v]) => `  ${p}: ${v};`).join('\n');
  const key = String(className || '');
  const selector = key.startsWith('tag:') ? key.slice(4) : `.${key}`;
  return `${selector} {\n${body}\n}`;
}

export function scopeToInlineStyle(scope) {
  const propMap = scopeToStyleUpdates(scope, '');
  const parts = Object.entries(propMap)
    .filter(([, v]) => v != null && v !== '')
    .map(([p, v]) => `${p}: ${v}`);
  return parts.join('; ');
}

/**
 * Surgically replaces (or inserts) the `.className { ... }` block inside
 * `rawCss`. Returns the rewritten CSS string. When `block` is empty the
 * existing block is removed.
 */
export function updateRawCssForClass(rawCss, className, block) {
  const css = String(rawCss == null ? '' : rawCss);
  const key = String(className || '');
  const isTag = key.startsWith('tag:');
  // For class scopes, also sweep any legacy `tag.className { ... }` blocks
  // so user edits don't leave duplicate rules behind.
  const re = isTag
    ? new RegExp(
        `(^|\\n)[ \\t]*${escapeRegex(key.slice(4))}\\s*\\{[\\s\\S]*?\\}`,
        'g'
      )
    : new RegExp(
        `(^|\\n)[ \\t]*(?:[A-Za-z][\\w-]*)?\\.${escapeRegex(key)}\\s*\\{[\\s\\S]*?\\}`,
        'g'
      );
  if (block) {
    let replaced = false;
    const out = css.replace(re, (_m, prefix) => {
      if (replaced) return prefix; // drop legacy duplicates after first replace
      replaced = true;
      return `${prefix}${block}`;
    });
    if (replaced) return out;
    return css.trim() ? `${css.replace(/\s+$/, '')}\n\n${block}\n` : `${block}\n`;
  }
  return css.replace(re, (_m, prefix) => prefix).replace(/\n{3,}/g, '\n\n').trim();
}

function declarationForScopeKey(scope, fullKey) {
  const map = SCHEMA_TO_CSS[fullKey];
  if (!map || !scope) return '';
  const decls = scopeToDeclarations(scope);
  const row = decls.find(([prop]) => prop === map.prop);
  return row ? row[1] : '';
}

/**
 * Compute compound CSS values (filter / transform / shadow preset) from
 * effects keys that are owned at the given breakpoint.
 */
function buildCompoundEffectsProps(scope, mediaQueryInner) {
  const propMap = {};
  const ownKeys = new Set(listScopePropsOwnAtBp(scope, mediaQueryInner));
  const eff = (scope && scope.effects) || {};
  const units = (scope && scope.__units) || {};

  // filter
  const filterParts = [];
  let hasFilterKey = false;
  for (const [schemaKey, fnName] of FILTER_FN_ENTRIES) {
    const fk = `effects.${schemaKey}`;
    if (!ownKeys.has(fk)) continue;
    hasFilterKey = true;
    const raw = eff[schemaKey];
    if (raw == null || raw === '') continue;
    const val = withUnit(raw, units[fk] || EFFECT_DEFAULT_UNITS[schemaKey]);
    if (val) filterParts.push(`${fnName}(${val})`);
  }
  if (hasFilterKey) propMap['filter'] = filterParts.join(' ') || '';

  // transform
  const transformParts = [];
  let hasTransformKey = false;
  for (const schemaKey of TRANSFORM_KEYS) {
    const fk = `effects.${schemaKey}`;
    if (!ownKeys.has(fk)) continue;
    hasTransformKey = true;
    const raw = eff[schemaKey];
    if (raw == null || raw === '') continue;
    const val = schemaKey === 'scale' ? String(raw) : withUnit(raw, units[fk] || EFFECT_DEFAULT_UNITS[schemaKey]);
    if (val) transformParts.push(`${schemaKey}(${val})`);
  }
  if (hasTransformKey) propMap['transform'] = transformParts.join(' ') || '';

  // shadow preset (only when custom boxShadow not set at this bp)
  if (ownKeys.has('effects.shadow') && !ownKeys.has('effects.boxShadow')) {
    const preset = eff.shadow;
    if (preset != null && preset !== '') {
      const presetVal = SHADOW_PRESET_VALUES[preset];
      if (presetVal != null) propMap['box-shadow'] = presetVal;
    }
  }

  return propMap;
}

/** CSS property map for properties owned at this breakpoint only. */
export function scopeToStyleUpdates(scope, mediaQueryInner) {
  const propMap = Object.create(null);
  if (!scope) return propMap;
  listScopePropsOwnAtBp(scope, mediaQueryInner).forEach((fullKey) => {
    const map = SCHEMA_TO_CSS[fullKey];
    if (!map) return;
    const decl = declarationForScopeKey(scope, fullKey);
    // An EMPTY declaration reads as "delete this property" downstream, so it must
    // only ever come from a real clear. Clearing a field routes through
    // clearScopePropOwn, which un-owns it — so "owned, but no value" is not a
    // clear, it is ownership that has drifted out of step with the values (a
    // half-seeded scope, a breakpoint switch mid-write). Emitting '' there
    // deleted CSS the user never touched, so drift is skipped instead. Genuine
    // clears still come through diffScopeStyleUpdates, which compares prev/next
    // ownership rather than guessing from a blank.
    if (decl === '' || decl == null) return;
    propMap[map.prop] = decl;
  });
  // Compound effects (filter / transform / shadow preset)
  Object.assign(propMap, buildCompoundEffectsProps(scope, mediaQueryInner));
  // Custom CSS properties (user-defined — applied for both local inline + class rules)
  parseCustomCssItems(scope.customCss).forEach(({ prop, value }) => {
    propMap[prop] = value;
  });
  return propMap;
}

/** Diff two scopes and return declaration updates for the active breakpoint. */
export function diffScopeStyleUpdates(prevScope, nextScope, mediaQueryInner) {
  const keys = new Set([
    ...listScopePropsOwnAtBp(prevScope || {}, mediaQueryInner),
    ...listScopePropsOwnAtBp(nextScope || {}, mediaQueryInner),
  ]);
  const propMap = Object.create(null);
  keys.forEach((fullKey) => {
    const map = SCHEMA_TO_CSS[fullKey];
    if (!map) return;
    const prevOwn = isScopePropOwnAtBp(prevScope, fullKey, mediaQueryInner);
    const nextOwn = isScopePropOwnAtBp(nextScope, fullKey, mediaQueryInner);
    const prevVal = prevOwn ? declarationForScopeKey(prevScope, fullKey) : '';
    const nextVal = nextOwn ? declarationForScopeKey(nextScope, fullKey) : '';
    if (prevOwn !== nextOwn || prevVal !== nextVal) {
      propMap[map.prop] = nextOwn ? nextVal : '';
    }
  });
  // Custom CSS diff — detect added / changed / removed properties
  const prevItems = parseCustomCssItems(prevScope && prevScope.customCss);
  const nextItems = parseCustomCssItems(nextScope && nextScope.customCss);
  const allProps = new Set([...prevItems.map(i => i.prop), ...nextItems.map(i => i.prop)]);
  allProps.forEach(prop => {
    const prevVal = (prevItems.find(i => i.prop === prop) || {}).value || '';
    const nextVal = (nextItems.find(i => i.prop === prop) || {}).value || '';
    if (prevVal !== nextVal) propMap[prop] = nextVal; // '' = remove from CSS
  });
  return propMap;
}

/**
 * Build CSS updates for a class at a breakpoint from scope state, and sweep
 * managed declarations the user CLEARED but that are still sitting in raw_css.
 *
 * `prevScope` is what makes that sweep safe, and it is not optional in spirit:
 * without it this function cannot tell the difference between
 *
 *   • "the user cleared font-size"        → the declaration must go, and
 *   • "the panel never loaded font-size"  → the declaration must be LEFT ALONE,
 *
 * because both look identical from `nextScope` — the property simply is not
 * owned. It used to strip in both cases, which turned any transient gap in the
 * scope state into permanently deleted CSS: one font-family edit on a heading
 * deleted font-weight / font-size / line-height / letter-spacing from that rule
 * (and the same properties from every other rule written in the same flush),
 * because the panel's state for them was empty rather than cleared.
 *
 * So a declaration is swept only when the state DEMONSTRABLY knew about it —
 * it was owned in `prevScope` and is not owned now. Anything the state never
 * carried belongs to whoever wrote the CSS (an import, the AI, hand-written
 * code) and is none of this function's business.
 */
export function reconcileScopeStyleUpdates(rawCss, className, nextScope, mediaQueryInner, prevScope) {
  const desired = scopeToStyleUpdates(nextScope, mediaQueryInner);
  const { order } = getClassRuleDeclarationsAtBreakpoint(rawCss, className, mediaQueryInner);
  const propMap = { ...desired };
  const known = new Set(Object.keys(scopeToStyleUpdates(prevScope, mediaQueryInner)));
  order.forEach((propName) => {
    if (!MANAGED_CSS_PROPS.has(propName)) return;
    if (propName in propMap) return;   // still owned → keep whatever state says
    if (!known.has(propName)) return;  // state never had it → not ours to delete
    propMap[propName] = '';
  });
  return propMap;
}

export { upsertClassStyleUpdatesInBreakpoint };

// ── Per-element scope class (`uich-e-N`) ─────────────────────────────────────
// The Local scope stores its declarations in the element's inline `style`
// attribute, and an inline style cannot carry an `@media` block: a value typed
// on Tablet/Mobile would overwrite the Desktop one. So a responsive Local edit
// moves the element's styling onto a class of its own — a class scope already
// supports every breakpoint — and everything after that takes the ordinary
// class path.
const ELEMENT_SCOPE_CLASS_RE = /^uich-e-(\d+)$/;

export function isElementScopeClassName(name) {
  return ELEMENT_SCOPE_CLASS_RE.test(String(name || ''));
}

/**
 * Next free `uich-e-N` for this widget. Numbered off whatever the markup
 * already carries rather than a counter or a random suffix, so re-running the
 * promotion on the same document is stable and two elements never collide.
 */
export function nextElementScopeClassName(rawHtml) {
  let max = 0;
  const re = /uich-e-(\d+)/g;
  const text = String(rawHtml == null ? '' : rawHtml);
  let m = re.exec(text);
  while (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
    m = re.exec(text);
  }
  return `uich-e-${max + 1}`;
}

/**
 * Add `className` to the element at `path` and strip its inline `style`
 * attribute, in ONE rewrite. Both halves have to land together — the caller
 * writes the declarations into raw_css in the same flush — or the element
 * paints unstyled for a frame between the two.
 *
 * Returns `rawHtml` unchanged when the path doesn't resolve.
 */
export function promoteInlineStyleToClassAtPath(rawHtml, path, className) {
  const container = document.createElement('div');
  // Same normalise / denormalise round-trip as updateInlineStyleForPath — see
  // the note there for why skipping it corrupts dynamic-tag markup.
  container.innerHTML = normalizeUichemyTags(String(rawHtml == null ? '' : rawHtml));
  const node = resolveNodeByPath(container, path);
  if (!node || node.nodeType !== 1) return rawHtml;
  const classes = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean);
  if (!classes.includes(className)) classes.push(className);
  node.setAttribute('class', classes.join(' '));
  node.removeAttribute('style');
  return denormalizeUichemyTags(container.innerHTML);
}

/**
 * Writes (or strips) the inline `style` attribute on the element at
 * `path` inside `rawHtml` and returns the rewritten HTML string.
 */
export function updateInlineStyleForPath(rawHtml, path, styleText) {
  const container = document.createElement('div');
  // Normalise on the way in, denormalise on the way out — the same round-trip
  // every other path-addressing writer performs (parseHtmlToLayers,
  // applyLayerMove, applyLayerDelete, getLayerOuterHtml, the slot writers…).
  //
  // This was the one place that skipped it, and it cost real content. A
  // self-closing `<uichemy-foo />` is not valid HTML: unknown elements cannot
  // self-close, so the parser treats it as an OPEN tag and adopts everything
  // after it as its children. Re-serialising then moved sibling markup INSIDE
  // that element, which is why editing anything on a widget holding a dynamic
  // tag emptied the element being styled — and why a reload, reading the
  // untouched server copy, brought it straight back.
  //
  // It also broke addressing: `path` is computed against the NORMALISED tree
  // (layerEntries), so resolving it against an unnormalised one could walk to a
  // different node entirely and write the style onto the wrong element.
  container.innerHTML = normalizeUichemyTags(String(rawHtml == null ? '' : rawHtml));
  const node = resolveNodeByPath(container, path);
  if (!node || node.nodeType !== 1) return rawHtml;
  if (styleText) {
    node.setAttribute('style', styleText);
  } else {
    node.removeAttribute('style');
  }
  return denormalizeUichemyTags(container.innerHTML);
}
