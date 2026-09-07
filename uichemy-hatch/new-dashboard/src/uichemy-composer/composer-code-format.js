// Lightweight in-browser code formatters used by the Code tab's Format button.
//
// Goals:
// - No external dependency / no Prettier.
// - Predictable, idempotent indentation for HTML / CSS / JS.
// - Preserve user content; never throw on malformed input, fall back to
//   the original string so the editor's value is never destroyed.

const INDENT = '  '; // two spaces, matches CodeMirror's `indentUnit: 2`.

const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Inline-context tags whose direct content should stay on the same line –
// keeps `<a>text</a>` from blowing up into three lines.
const HTML_INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em',
  'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub',
  'sup', 'time', 'u', 'var',
]);

// Tags whose inner text should be preserved verbatim (no re-indenting).
const HTML_RAW_TAGS = new Set(['pre', 'script', 'style', 'textarea']);

/** Format an HTML string with indented blocks while keeping inline runs intact. */
export function formatHtml(input) {
  const src = String(input == null ? '' : input);
  if (!src.trim()) return src;
  try {
    const tokens = tokenizeHtml(src);
    return renderHtmlTokens(tokens);
  } catch (_) {
    return src;
  }
}

function tokenizeHtml(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    // Raw blocks: <script>, <style>, <pre>, <textarea>.
    const rawMatch = src.slice(i).match(/^<(script|style|pre|textarea)(\s[^>]*)?>/i);
    if (rawMatch) {
      const tag = rawMatch[1].toLowerCase();
      const openLen = rawMatch[0].length;
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = src.slice(i + openLen);
      const closeIdx = rest.search(closeRe);
      if (closeIdx !== -1) {
        const body = rest.slice(0, closeIdx);
        const closeMatch = rest.slice(closeIdx).match(closeRe);
        tokens.push({ type: 'open', tag, raw: rawMatch[0] });
        if (body.length) tokens.push({ type: 'raw', text: body });
        tokens.push({ type: 'close', tag, raw: closeMatch[0] });
        i += openLen + closeIdx + closeMatch[0].length;
        continue;
      }
    }
    if (src[i] === '<') {
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        const close = end === -1 ? src.length : end + 3;
        tokens.push({ type: 'comment', raw: src.slice(i, close) });
        i = close;
        continue;
      }
      if (src.startsWith('<!', i) || src.startsWith('<?', i)) {
        const end = src.indexOf('>', i + 2);
        const close = end === -1 ? src.length : end + 1;
        tokens.push({ type: 'doctype', raw: src.slice(i, close) });
        i = close;
        continue;
      }
      const closeIdx = src.indexOf('>', i);
      if (closeIdx === -1) {
        tokens.push({ type: 'text', text: src.slice(i) });
        break;
      }
      const raw = src.slice(i, closeIdx + 1);
      const isClose = /^<\s*\//.test(raw);
      const isSelf = /\/>\s*$/.test(raw);
      const nameMatch = raw.match(/^<\s*\/?\s*([a-zA-Z][\w:-]*)/);
      const tag = nameMatch ? nameMatch[1].toLowerCase() : '';
      const selfClosing = isSelf || HTML_VOID_TAGS.has(tag);
      tokens.push({
        type: isClose ? 'close' : (selfClosing ? 'void' : 'open'),
        tag,
        raw,
      });
      i = closeIdx + 1;
      continue;
    }
    // Text run until next `<`.
    const next = src.indexOf('<', i);
    const text = next === -1 ? src.slice(i) : src.slice(i, next);
    if (text.length) tokens.push({ type: 'text', text });
    i = next === -1 ? src.length : next;
  }
  return tokens;
}

function renderHtmlTokens(tokens) {
  const out = [];
  const stack = [];
  let depth = 0;
  // Inline-context detection: if we just emitted an inline opener on the
  // current line we keep the closer and any short text on that line too.
  let inlineRun = false;

  const pad = () => INDENT.repeat(depth);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'text') {
      const text = tok.text.replace(/\s+/g, ' ');
      const trimmed = text.trim();
      if (!trimmed) continue;
      if (inlineRun && out.length) {
        out[out.length - 1] += trimmed;
      } else {
        out.push(pad() + trimmed);
      }
      continue;
    }
    if (tok.type === 'comment' || tok.type === 'doctype') {
      out.push(pad() + tok.raw);
      inlineRun = false;
      continue;
    }
    if (tok.type === 'raw') {
      // Preserve the raw body's leading newline-trimming but keep interior intact.
      const body = tok.text.replace(/^\n/, '').replace(/\n$/, '');
      if (body.length) out.push(body);
      inlineRun = false;
      continue;
    }
    if (tok.type === 'open') {
      const isInline = HTML_INLINE_TAGS.has(tok.tag);
      // Peek ahead: `<a>text</a>` collapses into one line.
      const next1 = tokens[i + 1];
      const next2 = tokens[i + 2];
      const isShortInline =
        isInline &&
        next1 && next1.type === 'text' && !next1.text.includes('\n') &&
        next2 && next2.type === 'close' && next2.tag === tok.tag;
      if (isShortInline) {
        out.push(pad() + tok.raw + next1.text.replace(/\s+/g, ' ').trim() + next2.raw);
        i += 2; // consumed text + close
        inlineRun = false;
        continue;
      }
      out.push(pad() + tok.raw);
      stack.push(tok.tag);
      depth++;
      inlineRun = isInline;
      continue;
    }
    if (tok.type === 'void') {
      if (inlineRun && out.length) {
        out[out.length - 1] += tok.raw;
      } else {
        out.push(pad() + tok.raw);
      }
      continue;
    }
    if (tok.type === 'close') {
      if (stack.length && stack[stack.length - 1] === tok.tag) {
        stack.pop();
        depth = Math.max(0, depth - 1);
      }
      if (inlineRun && out.length) {
        out[out.length - 1] += tok.raw;
        inlineRun = false;
      } else {
        out.push(pad() + tok.raw);
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Format a CSS string: one declaration per line, blank line between rules. */
export function formatCss(input) {
  const src = String(input == null ? '' : input);
  if (!src.trim()) return src;
  try {
    let i = 0;
    let depth = 0;
    let out = '';
    const pad = () => INDENT.repeat(depth);
    let pendingNewline = false;

    const flushPendingNewline = () => {
      if (pendingNewline) {
        out += '\n';
        pendingNewline = false;
      }
    };

    while (i < src.length) {
      const ch = src[i];

      // Keep @import / @charset / @namespace (and other ;-terminated at-rules)
      // on a single line. Their url(...) can contain semicolons (e.g. Google
      // Fonts `wght@400;500;700`); the generic `;` rule below would split them
      // across lines and break the import so it stops applying in the preview.
      if (ch === '@' && (out.endsWith('\n') || out.length === 0 || out.endsWith(' '))) {
        const m = /^@(import|charset|namespace|use|forward)\b/i.exec(src.slice(i));
        if (m) {
          let j = i;
          let strCh = '';
          let parenDepth = 0;
          while (j < src.length) {
            const c = src[j];
            if (strCh) {
              if (c === strCh && src[j - 1] !== '\\') strCh = '';
            } else if (c === '"' || c === "'") {
              strCh = c;
            } else if (c === '(') {
              parenDepth++;
            } else if (c === ')') {
              if (parenDepth > 0) parenDepth--;
            } else if (parenDepth === 0 && (c === ';' || c === '{')) {
              break;
            }
            j++;
          }
          if (j < src.length && src[j] === ';') {
            flushPendingNewline();
            out = out.replace(/[ \t]+$/, '');
            if (out && !out.endsWith('\n')) out += '\n';
            // Drop any line breaks (and their indentation) the formatter may
            // have inserted previously, without injecting spaces inside the URL.
            out += pad() + src.slice(i, j + 1).replace(/\s*\r?\n\s*/g, '').trim() + '\n';
            i = j + 1;
            while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
            continue;
          }
        }
      }

      if (ch === '/' && src[i + 1] === '*') {
        flushPendingNewline();
        const endIdx = src.indexOf('*/', i + 2);
        const close = endIdx === -1 ? src.length : endIdx + 2;
        const comment = src.slice(i, close);
        if (out && !out.endsWith('\n')) out += '\n';
        out += pad() + comment + '\n';
        i = close;
        // Eat one trailing whitespace run.
        while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        continue;
      }

      if (ch === '{') {
        // Trim trailing whitespace before the brace from `out`.
        out = out.replace(/[ \t]+$/, '');
        out += ' {\n';
        depth++;
        i++;
        while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        continue;
      }

      if (ch === '}') {
        out = out.replace(/[ \t\n]+$/, '\n');
        depth = Math.max(0, depth - 1);
        out += pad() + '}\n';
        i++;
        // Blank line between top-level blocks for readability.
        if (depth === 0) {
          while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
          if (i < src.length) out += '\n';
        } else {
          while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        }
        continue;
      }

      if (ch === ';') {
        out = out.replace(/[ \t]+$/, '');
        out += ';\n';
        i++;
        while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        continue;
      }

      if (/[ \t\r\n]/.test(ch)) {
        // Collapse runs of whitespace to a single space (selector / value internal).
        if (!out.endsWith('\n') && !out.endsWith(' ') && !out.endsWith('{')) out += ' ';
        i++;
        continue;
      }

      // Beginning of a statement / selector line, emit indent.
      if (out.endsWith('\n') || out.length === 0) {
        out += pad();
      }
      out += ch;
      i++;
    }
    return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim() + '\n';
  } catch (_) {
    return src;
  }
}

/** Minimal JS formatter, reflows braces / semicolons. Safe-ish best-effort. */
export function formatJs(input) {
  const src = String(input == null ? '' : input);
  if (!src.trim()) return src;
  try {
    let i = 0;
    let depth = 0;
    let out = '';
    const pad = () => INDENT.repeat(depth);
    let inString = null; // '"' | "'" | '`' | null
    let inLineComment = false;
    let inBlockComment = false;

    while (i < src.length) {
      const ch = src[i];
      const nxt = src[i + 1];

      // String literals, copy verbatim.
      if (inString) {
        out += ch;
        if (ch === '\\' && i + 1 < src.length) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i++;
        continue;
      }

      // Line comment until newline.
      if (inLineComment) {
        if (ch === '\n') {
          inLineComment = false;
          out += '\n';
        } else {
          out += ch;
        }
        i++;
        continue;
      }

      // Block comment until `*/`.
      if (inBlockComment) {
        out += ch;
        if (ch === '*' && nxt === '/') {
          out += '/';
          inBlockComment = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        out += ch;
        i++;
        continue;
      }
      if (ch === '/' && nxt === '/') { inLineComment = true; out += '//'; i += 2; continue; }
      if (ch === '/' && nxt === '*') { inBlockComment = true; out += '/*'; i += 2; continue; }

      if (ch === '{') {
        out = out.replace(/[ \t]+$/, '');
        if (out && !out.endsWith('\n') && !out.endsWith(' ')) out += ' ';
        out += '{\n';
        depth++;
        i++;
        while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        if (i < src.length) out += pad();
        continue;
      }
      if (ch === '}') {
        out = out.replace(/[ \t]+$/, '');
        if (!out.endsWith('\n') && out.length) out += '\n';
        depth = Math.max(0, depth - 1);
        out += pad() + '}';
        i++;
        // Append trailing single newline so the next statement indents fresh.
        while (i < src.length && /[ \t]/.test(src[i])) i++;
        if (src[i] === ';') { out += ';'; i++; }
        if (src[i] === ',') { out += ','; i++; }
        out += '\n';
        while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        if (i < src.length) out += pad();
        continue;
      }
      if (ch === ';') {
        out = out.replace(/[ \t]+$/, '');
        out += ';\n';
        i++;
        while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        if (i < src.length) out += pad();
        continue;
      }
      if (ch === '\n') {
        out = out.replace(/[ \t]+$/, '');
        if (!out.endsWith('\n')) out += '\n';
        i++;
        while (i < src.length && /[ \t\r\n]/.test(src[i])) i++;
        if (i < src.length) out += pad();
        continue;
      }
      if (/[ \t]/.test(ch)) {
        if (!out.endsWith(' ') && !out.endsWith('\n') && out.length) out += ' ';
        i++;
        continue;
      }
      out += ch;
      i++;
    }
    return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim() + '\n';
  } catch (_) {
    return src;
  }
}

/** Dispatch by language key (matches the CodeMirror editor's `languageKey`). */
export function formatCode(text, languageKey) {
  const key = String(languageKey || '').toLowerCase();
  if (key === 'css') return formatCss(text);
  if (key === 'js' || key === 'javascript') return formatJs(text);
  return formatHtml(text);
}
