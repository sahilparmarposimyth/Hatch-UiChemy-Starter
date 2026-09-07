// composer-globals-css, JS mirror of the PHP UiChemy_Globals_CSS locator/parser.
//
// The single source of truth for site design tokens is one
// <style id="uichemy-globals">…</style> block that lives INSIDE the site head
// code (the `site_custom_code_head` widget setting the "Before </head> on every
// page" editor edits, mirrored to the uichemy_composer_site_custom_code option).
// The Globals Manager and the CSS pane both operate on that same head string.
//
// Model: variables are grouped into COLLECTIONS by the section comment that
// precedes them inside :root, e.g. `/* Colors */` starts the "Colors"
// collection; every variable until the next section comment belongs to it.
// There is NO value/name inference and NO @-rules: the comment header is the
// only classifier, so an LLM (or the user) groups variables simply by writing
// them under a heading. Each variable's editor is picked from its value alone:
// a colour value → colour picker, anything else → a plain text field.

export const GLOBALS_BLOCK_ID = 'uichemy-globals';
export const DEFAULT_COLLECTION = 'Variables';

// <style … id="uichemy-globals" …> … </style>, attribute order agnostic.
const BLOCK_RE = /<style\b[^>]*\bid\s*=\s*(["'])uichemy-globals\1[^>]*>([\s\S]*?)<\/style\s*>/i;

// Inner CSS of the block (trimmed), or '' when the head has no such block.
export function extractGlobalsCss(head) {
  const m = BLOCK_RE.exec(String(head == null ? '' : head));
  return m ? m[2].trim() : '';
}

export function wrapGlobalsBlock(css) {
  return `<style id="${GLOBALS_BLOCK_ID}">\n${String(css == null ? '' : css).trim()}\n</style>`;
}

// Replace the block's body in place, or append the block once when absent –
// leaving all other head markup byte-identical.
export function upsertGlobalsBlock(head, css) {
  head = String(head == null ? '' : head);
  const block = wrapGlobalsBlock(css);
  if (BLOCK_RE.test(head)) return head.replace(BLOCK_RE, () => block); // fn form: css may contain `$`
  return head.trim() ? `${head}\n${block}` : block;
}

// ── Value helpers ────────────────────────────────────────────────────────────

const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'black', 'white', 'red', 'green', 'blue', 'yellow',
  'orange', 'purple', 'pink', 'gray', 'grey', 'brown', 'cyan', 'magenta', 'lime',
  'navy', 'teal', 'maroon', 'olive', 'silver', 'gold', 'beige', 'coral', 'crimson',
  'indigo', 'ivory', 'khaki', 'lavender', 'salmon', 'tan', 'turquoise', 'violet',
  'aqua', 'fuchsia',
]);

// The ONE piece of value sniffing we keep: pick the colour picker vs a text
// field. Everything else is a plain string editor.
export function isColorValue(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  return /\bgradient\s*\(/i.test(v)
    || /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)
    || /^(rgb|hsl)a?\s*\(/i.test(v)
    || NAMED_COLORS.has(v.toLowerCase());
}

// A bare CSS length / number / angle / time, i.e. what a "dimensions" or
// "spacing" collection holds. `calc()` and friends count too — they compute to
// one.
const DIMENSION_RE = /^-?\d*\.?\d+(px|em|rem|%|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch|ex|q|fr|deg|rad|turn|s|ms)?$/i;
const DIMENSION_FN_RE = /^(calc|clamp|min|max)\s*\(/i;

/**
 * Could this global be a font family?
 *
 * A global carries no declared type — only a value — so there is nothing to
 * match on directly and this has to work by elimination: not a colour, and not a
 * dimension. What is left is a family name or a comma-separated stack
 * ("Inter, sans-serif").
 *
 * Used to keep the font-family field's globals list to font collections instead
 * of offering every colour and spacing token the user has ever made.
 */
// Any CSS length/angle/time unit stuck to a number, ANYWHERE in the string — so a
// multi-token value ("8px 16px", "0 0 4px") is caught even though it isn't a single
// bare dimension. `s`/`ms` need a digit before them, so a family name never matches.
const HAS_UNIT_RE = /\d\s*(px|em|rem|%|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch|ex|fr|deg|rad|turn|ms|s)\b/i;

export function isFontFamilyValue(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  if (isColorValue(v)) return false;
  if (DIMENSION_RE.test(v) || DIMENSION_FN_RE.test(v)) return false;
  // Positive test (not just "isn't a colour/dimension") so a spacing token like
  // "8px 16px" or "0 auto" — which no single-value check catches — can't pass as a
  // font. A real family is alphabetic name(s), optionally a comma-separated stack.
  if (HAS_UNIT_RE.test(v)) return false;
  // Break into the tokens a family stack would have ("Inter, sans-serif" → Inter,
  // sans-serif). If every token is a number / auto / none, it's a dimension list.
  const tokens = v.replace(/["']/g, '').split(',').join(' ').split(/\s+/).filter(Boolean);
  const numericOrKeyword = tokens.every((tk) => /^-?\d*\.?\d+$/.test(tk) || tk === 'auto' || tk === 'none' || tk === 'inherit' || tk === 'initial' || tk === 'unset');
  if (numericOrKeyword) return false;
  // A font family must carry at least one alphabetic name.
  if (!/[a-z]/i.test(v)) return false;
  return true;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Top-level { selector, body } nodes, comment- and brace-aware.
function splitTopLevel(css) {
  const nodes = [];
  const len = css.length;
  let i = 0, selStart = 0;
  while (i < len) {
    if (css[i] === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e === -1 ? len : e + 2; continue; }
    if (css[i] === '{') {
      const selector = css.slice(selStart, i).trim();
      let depth = 1, j = i + 1;
      while (j < len && depth > 0) {
        if (css[j] === '/' && css[j + 1] === '*') { const e = css.indexOf('*/', j + 2); j = e === -1 ? len : e + 2; continue; }
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (depth === 0) break; }
        j++;
      }
      nodes.push({ selector, body: css.slice(i + 1, j) });
      i = j + 1; selStart = i; continue;
    }
    i++;
  }
  return nodes;
}

// Walk a :root body into ordered entries: section-header comments (collection
// names) and `--name: value;` declarations. A comment is a header only when it
// stands alone (preceded by whitespace since the last ';'); `@`-prefixed
// comments are ignored (legacy metadata) so old blocks stay safe.
function scanRootEntries(body) {
  const out = [];
  const len = body.length;
  let i = 0, seg = 0;
  const flush = (end) => {
    const s = body.slice(seg, end);
    const colon = s.indexOf(':');
    if (colon === -1) return;
    const prop = s.slice(0, colon).trim();
    const value = s.slice(colon + 1).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (prop) out.push({ t: 'decl', prop, value });
  };
  while (i <= len) {
    if (i < len && body[i] === '/' && body[i + 1] === '*') {
      const e = body.indexOf('*/', i + 2); const end = e === -1 ? len : e + 2;
      if (body.slice(seg, i).trim() === '') {
        const name = (e === -1 ? body.slice(i + 2) : body.slice(i + 2, e)).trim();
        if (name && name[0] !== '@') out.push({ t: 'header', name });
        seg = end;
      }
      i = end; continue;
    }
    if (i === len || body[i] === ';') { flush(i); i++; seg = i; continue; }
    i++;
  }
  return out;
}

// A class is Typography if its selector is `.text-*` OR its body sets any font /
// text metric, the "scan for font-size / font-* rules" heuristic.
export function classifyClass(selector, body) {
  if (/^\.text-/i.test(selector)) return 'typography';
  if (/\bfont-size\b|\bfont-family\b|\bfont-weight\b|\bfont-style\b|\bfont\s*:|\bline-height\b|\bletter-spacing\b|\btext-transform\b/i.test(body)) return 'typography';
  return 'component';
}

function rawClass(selector, body) {
  const trimmed = body.trim();
  return { selector, kind: classifyClass(selector, body), body: trimmed };
}

// Parse block CSS → { tokens, collections, classes, preserved }.
//   tokens      : [{ name, value, collection }]  (desktop :root, first wins)
//   collections : ordered collection names seen (incl. empty headers)
//   classes     : [{ selector, kind, body }]     (.selector rules)
//   preserved   : raw strings for @media / other at-rules & bare selectors,
//                 re-emitted verbatim so AI-authored responsive/extra CSS lives.
export function parseGlobalsCss(css) {
  css = String(css == null ? '' : css);
  const tokens = [], collections = [], classes = [], preserved = [];
  const seenName = new Set(), seenCol = new Set();
  const addCol = (name) => { if (!seenCol.has(name)) { seenCol.add(name); collections.push(name); } };

  for (const node of splitTopLevel(css)) {
    const sel = node.selector;
    if (sel === ':root') {
      let current = '';
      for (const e of scanRootEntries(node.body)) {
        if (e.t === 'header') { current = e.name; addCol(current); continue; }
        if (e.prop.slice(0, 2) !== '--' || seenName.has(e.prop)) continue;
        const col = current || DEFAULT_COLLECTION;
        if (!current) addCol(DEFAULT_COLLECTION);
        seenName.add(e.prop);
        tokens.push({ name: e.prop, value: e.value, collection: col });
      }
      continue;
    }
    if (sel && sel[0] === '.') { classes.push(rawClass(sel, node.body)); continue; }
    if (sel) preserved.push(`${sel} {\n${node.body.trim()}\n}`); // @media, keyframes, bare selectors
  }
  return { tokens, collections, classes, preserved };
}
