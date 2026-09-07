// Parses the active widget's raw_html string into a flat ordered list of
// layer entries with stable, path-based IDs. Mirrors the path scheme used
// by the legacy editor (`layer.0.1.2-el`) so a selection can survive an
// HTML edit by re-resolving the same path on the new DOM tree.
import React from 'react';
import { useWidgetSetting } from './composer-elementor';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'META', 'LINK', 'HEAD',
]);

// ─── uichemy dynamic tag helpers ──────────────────────────────────────────────
// <uichemy:post-content /> uses a colon in the tag name, which the HTML5 parser
// treats as an open element that captures following siblings as children.
// We normalize to <uichemy-post-content></uichemy-post-content> (custom element
// with a hyphen) before any DOM operation so the tree structure stays correct,
// then denormalize back to the original colon form before persisting to raw_html.

export function normalizeUichemyTags(html) {
  if (!html || !html.includes('uichemy-')) return html;
  // Convert self-closing <uichemy-foo /> → <uichemy-foo></uichemy-foo>
  html = html.replace(/<(uichemy-[a-z0-9_-]+)((?:\s[^>]*)?)\/>/gi, '<$1$2></$1>');
  // For bare open tags with no matching close, add an empty close tag.
  // Tags that already have a close tag (content-bearing, e.g. nav-menu) are left intact.
  const afterStep1 = html;
  html = html.replace(/<(uichemy-[a-z0-9_-]+)((?:\s[^>]*)?)>/gi, (match, tag, attrs) => {
    if (afterStep1.indexOf(`</${tag}>`) !== -1) return match;
    return `<${tag}${attrs}></${tag}>`;
  });
  return html;
}

export function denormalizeUichemyTags(html) {
  if (!html || !html.includes('uichemy-')) return html;
  return html.replace(
    /<(uichemy-[a-z0-9_-]+)((?:\s[^>]*)?)><\/\1>/gi,
    (_, tag, attrs) => `<${tag}${attrs.trimEnd()} />`
  );
}

/**
 * Is this text a `<uichemy-*>` single-curly placeholder (`{nav_item}`,
 * `{sub_item}`, `{heading}`)?
 *
 * These are nav-menu / TOC template syntax — NOT `{{ data }}` bindings and NOT
 * `{% %}` control markup. PHP replaces the whole token with the rendered item
 * (for a nav menu, an `<a>`), so a node whose only text is one of these has no
 * literal text of its own: what the reader actually sees there is markup the
 * server generated, which never exists in raw_html.
 */
export function isDynamicPlaceholderText(text) {
  return /^\{[a-zA-Z_][\w.]*\}$/.test(String(text == null ? '' : text).trim());
}

export function pathRelevantChildren(el) {
  const out = [];
  if (!el || !el.childNodes) return out;
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 1 /* ELEMENT */ && !SKIP_TAGS.has(c.tagName)) out.push(c);
  }
  return out;
}

export function getClassList(el) {
  if (!el) return [];
  const raw = (typeof el.className === 'string' ? el.className : '') ||
    (el.getAttribute ? el.getAttribute('class') : '') || '';
  return raw.trim().split(/\s+/).filter(Boolean);
}

function getDirectText(el) {
  let buf = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 3 /* TEXT */) buf += c.textContent || '';
  }
  return buf;
}

function getDirectTextPreview(el) {
  return getDirectText(el).trim().replace(/\s+/g, ' ').slice(0, 60);
}

function collectAttrs(el) {
  const out = {};
  if (!el || !el.attributes) return out;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    out[a.name] = a.value;
  }
  return out;
}

function getLayerName(el) {
  // Prefer an explicit name attr, else id, else class list, else tag.
  if (el.getAttribute) {
    const id = el.getAttribute('id');
    if (id) return `#${id}`;
  }
  const cls = getClassList(el);
  if (cls.length) return `.${cls.slice(0, 2).join('.')}`;
  // img[data-as="svg"] displays as "svg" in the layer name.
  if (el.tagName && el.tagName.toUpperCase() === 'IMG' && el.getAttribute('data-as') === 'svg') return 'svg';
  return el.tagName ? el.tagName.toLowerCase() : 'node';
}

/**
 * @param {string} rawHtml
 * @returns {{ entries: Array<LayerEntry>, rootNode: HTMLElement | null }}
 *
 * Each entry: { id, path, parentId, depth, tag, name, classes, attrs,
 *   hasChildren, contentPreview }
 */
// ─── dynamic-data (Twig) detection ────────────────────────────────────────────
// Twig control tags ({% for %}, {% if %}) live as TEXT nodes between element
// siblings. Scan a parent's childNodes in order, track an open-construct stack,
// and map each ELEMENT child to the innermost loop/condition it sits inside.
// Output bindings ({{ … }}) are detected per element on its attrs / direct text.
function twigConstructMembership(parentNode) {
  const map = new Map();
  const stack = [];
  const kids = parentNode.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.nodeType === 3 /* TEXT */) {
      const re = /\{%\s*(for|if|endfor|endif)\b([^%]*)%\}/g;
      let m;
      while ((m = re.exec(String(c.nodeValue || '')))) {
        const kw = m[1];
        if (kw === 'for') stack.push({ type: 'loop', expr: m[2].trim() });
        else if (kw === 'if') stack.push({ type: 'condition', expr: m[2].trim() });
        else if (kw === 'endfor') { for (let s = stack.length - 1; s >= 0; s--) { if (stack[s].type === 'loop') { stack.splice(s, 1); break; } } }
        else if (kw === 'endif') { for (let s = stack.length - 1; s >= 0; s--) { if (stack[s].type === 'condition') { stack.splice(s, 1); break; } } }
      }
    } else if (c.nodeType === 1 /* ELEMENT */ && !SKIP_TAGS.has(c.tagName)) {
      map.set(c, stack.length ? stack[stack.length - 1] : null);
    }
  }
  return map;
}

function detectEntryDynamic(child, construct) {
  const dyn = {};
  let dataExpr = null;
  if (child.attributes) {
    for (let i = 0; i < child.attributes.length; i++) {
      const mm = String(child.attributes[i].value || '').match(/\{\{([\s\S]+?)\}\}/);
      if (mm) { dataExpr = mm[1].trim(); break; }
    }
  }
  if (!dataExpr) {
    let buf = '';
    for (let i = 0; i < child.childNodes.length; i++) {
      const c = child.childNodes[i];
      if (c.nodeType === 3) buf += c.textContent || '';
    }
    const mm = buf.match(/\{\{([\s\S]+?)\}\}/);
    if (mm) dataExpr = mm[1].trim();
  }
  if (dataExpr) dyn.data = dataExpr;
  if (construct && construct.type === 'loop') dyn.loop = construct.expr;
  if (construct && construct.type === 'condition') dyn.condition = construct.expr;
  // <uichemy-nav-menu> / <uichemy-toc> use their OWN attribute-based template
  // syntax — `for="x in y"` / `if="x in y"` as real attributes on the element,
  // not {% %} text between siblings — so twigConstructMembership() above never
  // sees them. Recognise it here too, or the composer can't tell these nodes
  // apart from ordinary static ones (the move-grip must stay off a template
  // whose reorder would rewrite every rendered repeat, exactly like a {% for %}
  // template). `attrTemplate` marks the syntax: the tag's PHP renderer owns
  // this loop, so the Twig Loop accordion (Remove Loop / Loop builder / query)
  // must NOT be offered on it — removeLoop() only understands {% %} text.
  if (!dyn.loop && child.getAttribute) {
    const forAttr = child.getAttribute('for');
    if (forAttr && /\S+\s+in\s+\S+/.test(forAttr)) { dyn.loop = forAttr.trim(); dyn.attrTemplate = true; }
  }
  if (!dyn.condition && child.getAttribute) {
    const ifAttr = child.getAttribute('if');
    if (ifAttr) { dyn.condition = ifAttr.trim(); dyn.attrTemplate = true; }
  }
  if (child.tagName === 'FORM' && child.getAttribute && child.getAttribute('data-atom-form') !== null) dyn.form = true;
  return Object.keys(dyn).length ? dyn : null;
}

export function parseHtmlToLayers(rawHtml) {
  const html = normalizeUichemyTags(String(rawHtml || ''));
  const root = document.createElement('div');
  root.innerHTML = html;
  const entries = [];

  function visit(node, depth, parentId, path) {
    const kids = pathRelevantChildren(node);
    const membership = twigConstructMembership(node);
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      const childPath = `${path}.${i}`;
      const id = `layer${childPath}-el`;
      const grandKids = pathRelevantChildren(child);
      const childTagUpper = child.tagName ? child.tagName.toUpperCase() : '';
      // img[data-as="svg"] is treated as an SVG layer, show tag as 'svg'.
      const isSvgImg = childTagUpper === 'IMG' && child.getAttribute && child.getAttribute('data-as') === 'svg';
      const displayTag = isSvgImg ? 'svg' : (child.tagName ? child.tagName.toLowerCase() : 'node');
      entries.push({
        id,
        path: childPath,
        parentId,
        depth,
        tag: displayTag,
        name: getLayerName(child),
        classes: getClassList(child),
        attrs: collectAttrs(child),
        hasChildren: grandKids.length > 0,
        contentPreview: grandKids.length === 0 ? getDirectTextPreview(child) : '',
        // Full untruncated direct-text content, used by the Inspector's
        // text editor so the textarea can hold the real value.
        directText: getDirectText(child),
        // Dynamic-data construct on this node (data binding / loop / condition / form).
        dyn: detectEntryDynamic(child, membership.get(child) || null),
      });
      // Don't descend into <svg> internals or img[data-as="svg"], decorative and dense.
      const isSvgNode = childTagUpper === 'SVG' || isSvgImg;
      if (!isSvgNode) {
        visit(child, depth + 1, id, childPath);
      }
    }
  }

  visit(root, 0, null, '0');
  return { entries, rootNode: root };
}

export function resolveNodeByPath(rootNode, path) {
  if (!rootNode || !path) return null;
  const parts = path.split('.').slice(1).map(Number);
  let node = rootNode;
  for (const i of parts) {
    const kids = pathRelevantChildren(node);
    if (i >= kids.length) return null;
    node = kids[i];
  }
  return node;
}

/**
 * Walk up from the element at `path`; return the `{% for … %}` expression of
 * the nearest enclosing loop, or null. Used to make dynamic bindings picked
 * inside a loop target the loop item (item.title) instead of the global post.
 *
 * @param {string} rawHtml
 * @param {string} path
 * @returns {string|null}
 */
export function findEnclosingLoop(rawHtml, path) {
  const root = document.createElement('div');
  root.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  let node = resolveNodeByPath(root, path);
  if (!node) return null;
  while (node && node !== root && node.parentNode) {
    const membership = twigConstructMembership(node.parentNode);
    const construct = membership.get(node);
    if (construct && construct.type === 'loop') {
      return construct.expr;
    }
    node = node.parentNode;
  }
  return null;
}

/**
 * Best-effort: given a clicked DOM node inside the widget's rendered
 * output, compute the same path scheme parseHtmlToLayers uses, so we can
 * map preview clicks back to layers. Returns null if `clickedNode` isn't
 * reachable from `widgetRoot` via path-relevant traversal.
 */
export function computePathForNode(widgetRoot, clickedNode) {
  if (!widgetRoot || !clickedNode) return null;
  // Walk up from clickedNode collecting child-index at each step until we
  // hit widgetRoot.
  const chain = [];
  let cur = clickedNode;
  while (cur && cur !== widgetRoot) {
    const parent = cur.parentNode;
    if (!parent) return null;
    const siblings = pathRelevantChildren(parent);
    const idx = siblings.indexOf(cur);
    if (idx === -1) return null;
    chain.unshift(idx);
    cur = parent;
  }
  if (cur !== widgetRoot) return null;
  return ['0', ...chain].join('.');
}

export function useLayerTree() {
  const [rawHtml] = useWidgetSetting('raw_html');
  return React.useMemo(() => parseHtmlToLayers(rawHtml || ''), [rawHtml]);
}

const VOID_TAGS = new Set([
  'AREA','BASE','BR','COL','EMBED','HR','IMG','INPUT','LINK','META','SOURCE','TRACK','WBR',
]);

export function tagCanHaveChildren(tag) {
  if (!tag) return false;
  const upper = String(tag).toUpperCase();
  if (upper.startsWith('UICHEMY-')) return false;
  return !VOID_TAGS.has(upper);
}

/**
 * Mirrors the legacy `commitDirectLayerDragMove`. Given the active widget's
 * `raw_html`, move the node at `dragPath` to be before/after/inside the node
 * at `dropPath`. Returns the rewritten HTML plus the new layer id of the
 * moved node so callers can preserve the selection.
 *
 * `placement`: 'before' | 'after' | 'inside'
 *
 * Bails out (returns `{ html: rawHtml }`) when:
 *  - either path doesn't resolve in the parsed tree
 *  - drag and drop nodes are the same
 *  - the drop target is a descendant of the drag node (would cycle)
 *  - placement='inside' on a void element
 */
export function applyLayerMove(rawHtml, dragPath, dropPath, placement) {
  const container = document.createElement('div');
  container.innerHTML = normalizeUichemyTags(String(rawHtml || ''));

  const dragNode = resolveNodeByPath(container, dragPath);
  const dropNode = resolveNodeByPath(container, dropPath);
  if (!dragNode || !dropNode || dragNode === dropNode) {
    return { html: rawHtml, newId: null };
  }
  if (dragNode.contains && dragNode.contains(dropNode)) {
    return { html: rawHtml, newId: null };
  }

  if (placement === 'inside') {
    if (!tagCanHaveChildren(dropNode.tagName)) {
      return { html: rawHtml, newId: null };
    }
    dropNode.appendChild(dragNode);
  } else if (placement === 'before') {
    if (!dropNode.parentNode) return { html: rawHtml, newId: null };
    dropNode.parentNode.insertBefore(dragNode, dropNode);
  } else if (placement === 'after') {
    if (!dropNode.parentNode) return { html: rawHtml, newId: null };
    dropNode.parentNode.insertBefore(dragNode, dropNode.nextSibling);
  } else {
    return { html: rawHtml, newId: null };
  }

  const newPath = computePathForNode(container, dragNode);
  const newId = newPath ? `layer${newPath}-el` : null;
  return { html: denormalizeUichemyTags(container.innerHTML), newId };
}

export function getLayerOuterHtml(rawHtml, path) {
  const container = document.createElement('div');
  container.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const node = resolveNodeByPath(container, path);
  return node ? denormalizeUichemyTags(node.outerHTML) : '';
}

export function applyLayerDelete(rawHtml, path) {
  const container = document.createElement('div');
  container.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const node = resolveNodeByPath(container, path);
  if (!node || !node.parentNode) return { html: rawHtml, newSelectedId: null };

  const parent = node.parentNode;
  const siblingsBefore = pathRelevantChildren(parent);
  const idx = siblingsBefore.indexOf(node);
  parent.removeChild(node);
  const siblingsAfter = pathRelevantChildren(parent);
  const fallback = siblingsAfter[idx] || siblingsAfter[idx - 1] ||
    (parent !== container ? parent : null);
  const newPath = fallback ? computePathForNode(container, fallback) : null;
  const newId = newPath ? `layer${newPath}-el` : null;
  return { html: denormalizeUichemyTags(container.innerHTML), newSelectedId: newId };
}

export function applyLayerPaste(rawHtml, snippet, targetPath, placement) {
  const container = document.createElement('div');
  container.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const target = resolveNodeByPath(container, targetPath);
  if (!target) return { html: rawHtml, newSelectedId: null };

  const tmp = document.createElement('div');
  tmp.innerHTML = normalizeUichemyTags(String(snippet || ''));
  const fragment = tmp.firstElementChild;
  if (!fragment) return { html: rawHtml, newSelectedId: null };

  if (placement === 'inside') {
    if (!tagCanHaveChildren(target.tagName)) return { html: rawHtml, newSelectedId: null };
    target.appendChild(fragment);
  } else if (placement === 'after') {
    if (!target.parentNode) return { html: rawHtml, newSelectedId: null };
    target.parentNode.insertBefore(fragment, target.nextSibling);
  } else {
    // 'before' (default)
    if (!target.parentNode) return { html: rawHtml, newSelectedId: null };
    target.parentNode.insertBefore(fragment, target);
  }

  const newPath = computePathForNode(container, fragment);
  const newId = newPath ? `layer${newPath}-el` : null;
  return { html: denormalizeUichemyTags(container.innerHTML), newSelectedId: newId };
}

/**
 * True if `candidatePid` is `ancestorId` or any of its descendants in the
 * given entries list. Cheap O(depth) walk via parentId chain.
 */
export function isDescendantOrSelf(entries, ancestorId, candidateId) {
  if (!ancestorId || !candidateId) return false;
  if (ancestorId === candidateId) return true;
  const byId = new Map();
  for (const e of entries) byId.set(e.id, e);
  let cur = byId.get(candidateId);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}
