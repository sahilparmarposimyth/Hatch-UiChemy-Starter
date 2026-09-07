// Contextual construct tab, appears after Editor/Code/Chat AI when the selected layer is a
// Loop or Form. Manages that construct's options and writes back into raw_html in place
// (round-trip). Loop edits rewrite the governing `{% for … %}`; Form edits rewrite the
// <form> tag's attributes (name + data-atom-* config honoured server-side by Uich_Forms).
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { I } from './composer-icons';
import { normalizeUichemyTags, denormalizeUichemyTags, resolveNodeByPath } from './composer-layer-tree';
import {
  PaginationGate, ProBadge, isLoopSourceLocked, loopSourceSuffix, showLoopSourceUpsell,
  CustomLoopLockNote, customLoopSuffix, isCustomLoopLocked, showCustomLoopUpsell,
} from './composer-pro';

// ── shadcn recipes (mirrors composer-layers' MENU_ITEM_CLS conventions) ───────
const SELECT_CLS =
  'flex h-8 w-full appearance-none rounded-md border border-input bg-transparent px-2.5 pr-7 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const CHIP_CLS =
  'inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground';

const SOURCES = [
  { key: 'get_posts', label: 'Posts', alias: 'post' },
  { key: 'get_products', label: 'Products', alias: 'product', taxonomy: 'product_cat' },
  { key: 'get_terms', label: 'Terms / Categories', alias: 'term' },
  { key: 'get_users', label: 'Users', alias: 'user' },
  { key: 'get_api', label: 'External API (JSON)', alias: 'item' },
];
const ORDERBY = ['date', 'title', 'menu_order', 'rand', 'ID', 'name', 'count'];
const POST_STATUS = ['publish', 'any', 'draft', 'pending', 'private', 'future'];
const META_COMPARE = ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'IN', 'EXISTS', 'NOT EXISTS'];
// Relative-date presets → the WP date_query `after` value they compile to (strtotime-parsed).
const DATE_RELATIVE = { day: '1 day ago', week: '1 week ago', month: '1 month ago', year: '1 year ago' };
const DATE_OPTIONS = [
  { key: '', label: 'Any time' },
  { key: 'day', label: 'Past day' },
  { key: 'week', label: 'Past week' },
  { key: 'month', label: 'Past month' },
  { key: 'year', label: 'Past year' },
  { key: 'custom', label: 'Custom range…' },
];

/* ── loop expr ⇄ config ───────────────────────────────────────────────────── */
// Turn a Twig id list "[ 1, 2 ,3 ]" capture into a clean "1, 2, 3" display string.
function normIdList(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).join(', ');
}
// terms can be a single slug ('a') or an array ([ 'a', 'b' ]) → return a clean "a, b" string.
function parseTermsArg(call) {
  const arr = call.match(/terms\s*:\s*\[([^\]]*)\]/);
  if (arr) return (arr[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, '')).join(', ');
  const single = call.match(/terms\s*:\s*'([^']+)'/);
  return single ? single[1] : '';
}
// Read back the date_query preset/custom values from a built loop call.
function parseDate(call) {
  const m = call.match(/date_query\s*:\s*\[\s*\{([^}]*)\}/);
  if (!m) return { dateMode: '', dateAfter: '', dateBefore: '' };
  const inner = m[1];
  const after = (inner.match(/after\s*:\s*'([^']+)'/) || [])[1] || '';
  const before = (inner.match(/before\s*:\s*'([^']+)'/) || [])[1] || '';
  const rel = Object.keys(DATE_RELATIVE).find((k) => DATE_RELATIVE[k] === after);
  if (rel) return { dateMode: rel, dateAfter: '', dateBefore: '' };
  return { dateMode: (after || before) ? 'custom' : '', dateAfter: /^\d{4}-\d{2}-\d{2}$/.test(after) ? after : '', dateBefore: /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : '' };
}
// `rawHtml` is optional and only used to tell the two paginated modes apart:
// both emit `paged: current_page()`, so the expression alone cannot say whether
// the author picked numbered links or a Load more control. The slot that sits
// after {% endfor %} is what distinguishes them.
function parseLoopExpr(expr, rawHtml) {
  const e = String(expr || '');
  const inMatch = e.split(/\s+in\s+/);
  const alias = (inMatch[0] || 'item').trim();
  const call = (inMatch[1] || '').trim();
  const fn = (call.match(/^([a-z_]+)\s*\(/i) || [])[1] || 'get_posts';
  const pick = (re) => { const m = call.match(re); return m ? m[1] : ''; };
  const notIn = pick(/post__not_in\s*:\s*\[([^\]]*)\]/);
  return {
    alias,
    sourceKey: fn,
    // With Load more the count is `loop_more_count(initial, batch)`, so read the
    // initial from there first, the plain `posts_per_page: N` regex can't see it.
    perPage: pick(/loop_more_count\(\s*(\d+)/) || pick(/(?:posts_per_page|number|limit)\s*:\s*(\d+)/) || (fn === 'get_products' ? '12' : '9'),
    loadBatch: pick(/loop_more_count\(\s*\d+\s*,\s*(\d+)/) || '',
    orderby: pick(/orderby\s*:\s*'([^']+)'/) || 'date',
    order: pick(/order\s*:\s*'([^']+)'/) || 'DESC',
    postType: pick(/post_type\s*:\s*'([^']+)'/) || 'post',
    term: parseTermsArg(call),
    taxonomy: pick(/taxonomy\s*:\s*'([^']+)'/) || (fn === 'get_products' ? 'product_cat' : 'category'),
    //, filtering (posts/products) –
    postStatus: pick(/post_status\s*:\s*'([^']+)'/) || 'publish',
    offset: pick(/offset\s*:\s*(\d+)/) || '',
    include: normIdList(pick(/post__in\s*:\s*\[([^\]]*)\]/)),
    exclude: normIdList(notIn),
    excludeCurrent: /\bpost\.id\b/.test(notIn),
    author: normIdList(pick(/author__in\s*:\s*\[([^\]]*)\]/)),
    ignoreSticky: /ignore_sticky_posts\s*:\s*false/.test(call) ? false : true,
    avoidDuplicates: /avoid_duplicates\s*:\s*true/.test(call),
    // Load more is now identifiable from the expression alone (it is the only mode
    // that calls loop_more_offset), so this no longer depends on the slot markup.
    pagination: /loop_more_offset\(/.test(call)
      ? 'loadmore'
      : (/paged\s*:\s*current_page\(\)/.test(call) ? 'numbers' : 'none'),
    ...parseDate(call),
    //, external API (JSON) source –
    apiUrl: pick(/url\s*:\s*'([^']*)'/) || '',
    apiPath: pick(/path\s*:\s*'([^']*)'/) || '',
    apiMethod: pick(/method\s*:\s*'([^']+)'/) || 'GET',
    //, single custom-field (meta) clause –
    metaKey: pick(/key\s*:\s*'([^']+)'/) || '',
    metaValue: pick(/value\s*:\s*'([^']*)'/) || '',
    metaCompare: pick(/compare\s*:\s*'([^']+)'/) || '=',
    //, terms –
    hideEmpty: /hide_empty\s*:\s*false/.test(call) ? false : true,
    termParent: pick(/parent\s*:\s*(\d+)/) || '',
    //, users –
    role: pick(/role\s*:\s*'([^']+)'/) || '',
  };
}
// Shared filtering args for the WP_Query-backed sources (posts + products). The Twig
// get_posts()/get_products() runner wp_parse_args()es these straight into WP_Query, so any
// valid WP_Query key emitted here is honoured server-side.
// A tax_query clause that accepts one or many term slugs ("a" or "a, b").
function taxClause(taxonomy, term) {
  const slugs = String(term || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) return '';
  const termsVal = slugs.length > 1 ? `[ ${slugs.map((s) => `'${s}'`).join(', ')} ]` : `'${slugs[0]}'`;
  return `tax_query: [ { taxonomy: '${taxonomy}', field: 'slug', terms: ${termsVal} } ]`;
}
function pushPostFilters(p, c) {
  if (c.postStatus && c.postStatus !== 'publish') p.push(`post_status: '${c.postStatus}'`);
  const off = parseInt(c.offset, 10) || 0;
  if (c.pagination === 'loadmore') {
    // Load more is offset-based (see loop_more_offset/loop_more_count in PHP), so
    // the loop's own "Skip" becomes the base that every load-more request adds to.
    p.push(`offset: loop_more_offset(${off})`);
  } else if (off > 0) {
    p.push(`offset: ${off}`);
  }
  const inc = normIdList(c.include);
  if (inc) p.push(`post__in: [ ${inc} ]`);
  // Exclude = explicit IDs + (optionally) the current post via the Twig global `post.id`.
  const excTokens = normIdList(c.exclude).split(',').map((s) => s.trim()).filter(Boolean);
  if (c.excludeCurrent) excTokens.push('post.id');
  if (excTokens.length) p.push(`post__not_in: [ ${excTokens.join(', ')} ]`);
  const au = normIdList(c.author);
  if (au) p.push(`author__in: [ ${au} ]`);
  if (c.ignoreSticky === false) p.push('ignore_sticky_posts: false');
  if (c.dateMode === 'custom') {
    const dq = [];
    if (c.dateAfter) dq.push(`after: '${c.dateAfter}'`);
    if (c.dateBefore) dq.push(`before: '${c.dateBefore}'`);
    if (dq.length) p.push(`date_query: [ { ${dq.join(', ')}, inclusive: true } ]`);
  } else if (DATE_RELATIVE[c.dateMode]) {
    p.push(`date_query: [ { after: '${DATE_RELATIVE[c.dateMode]}' } ]`);
  }
  if (c.avoidDuplicates) p.push('avoid_duplicates: true');
  // 'numbers' is page-based; 'loadmore' is offset-based and gets its `offset:`
  // clause from pushPostFilters instead. Either way the query must stop using the
  // no_found_rows shortcut, or the engine never learns the total and no control
  // can render at all.
  if (c.pagination === 'numbers') p.push('paged: current_page()');
  if (c.metaKey) {
    const cmp = c.metaCompare || '=';
    const numeric = ['>', '>=', '<', '<='].includes(cmp);
    const noValue = cmp === 'EXISTS' || cmp === 'NOT EXISTS';
    const parts = [`key: '${c.metaKey}'`];
    if (!noValue && c.metaValue !== '') parts.push(`value: '${c.metaValue}'`);
    parts.push(`compare: '${cmp}'`);
    if (numeric) parts.push(`type: 'NUMERIC'`);
    p.push(`meta_query: [ { ${parts.join(', ')} } ]`);
  }
}
// How many items a request returns. With Load more the count differs between the
// first render and each click, so it becomes a call the server resolves per
// request rather than a fixed number.
function perPageArg(c, fallback) {
  const initial = parseInt(c.perPage, 10) || fallback;
  if (c.pagination !== 'loadmore') return `posts_per_page: ${initial}`;
  const batch = parseInt(c.loadBatch, 10) || initial;
  return `posts_per_page: loop_more_count(${initial}, ${batch})`;
}

function buildForArgs(c) {
  const p = [];
  if (c.sourceKey === 'get_posts') {
    if (c.postType) p.push(`post_type: '${c.postType}'`);
    p.push(perPageArg(c, 9));
    if (c.orderby) p.push(`orderby: '${c.orderby}'`);
    if (c.order) p.push(`order: '${c.order}'`);
    { const tc = taxClause(c.taxonomy || 'category', c.term); if (tc) p.push(tc); }
    pushPostFilters(p, c);
  } else if (c.sourceKey === 'get_products') {
    p.push(perPageArg(c, 12));
    if (c.orderby) p.push(`orderby: '${c.orderby}'`);
    if (c.order) p.push(`order: '${c.order}'`);
    { const tc = taxClause('product_cat', c.term); if (tc) p.push(tc); }
    pushPostFilters(p, c);
  } else if (c.sourceKey === 'get_terms') {
    p.push(`taxonomy: '${c.taxonomy || 'category'}'`);
    p.push(`number: ${parseInt(c.perPage, 10) || 9}`);
    if (c.orderby) p.push(`orderby: '${c.orderby}'`);
    if (c.order) p.push(`order: '${c.order}'`);
    p.push(`hide_empty: ${c.hideEmpty === false ? 'false' : 'true'}`);
    if (c.termParent !== '' && parseInt(c.termParent, 10) >= 0) p.push(`parent: ${parseInt(c.termParent, 10)}`);
    const off = parseInt(c.offset, 10);
    if (off > 0) p.push(`offset: ${off}`);
  } else if (c.sourceKey === 'get_users') {
    p.push(`number: ${parseInt(c.perPage, 10) || 9}`);
    if (c.role) p.push(`role: '${c.role}'`);
    const off = parseInt(c.offset, 10);
    if (off > 0) p.push(`offset: ${off}`);
  } else if (c.sourceKey === 'get_api') {
    p.push(`url: '${String(c.apiUrl || '').replace(/'/g, "\\'")}'`);
    if (c.apiPath) p.push(`path: '${c.apiPath}'`);
    if (c.apiMethod && c.apiMethod !== 'GET') p.push(`method: '${c.apiMethod}'`);
    const lim = parseInt(c.perPage, 10);
    if (lim > 0) p.push(`limit: ${lim}`);
  }
  return `{ ${p.join(', ')} }`;
}
function buildForTag(c) {
  return `{% for ${c.alias || 'item'} in ${c.sourceKey}(${buildForArgs(c)}) %}`;
}
// The inner expression of a {% for %} tag, what the Custom editor edits, and
// what replaceLoop() matches on.
function forInner(tag) {
  return String(tag || '').replace(/^\{%\s*for\s+/, '').replace(/\s*%\}$/, '');
}
const normExpr = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Can the Basic builder express this loop exactly?
 *
 * Everything Basic generates round-trips byte-for-byte through
 * parseLoopExpr → buildForArgs, so a mismatch means the expression was written
 * by hand (Custom mode, or the Code tab) and carries something the form has no
 * field for, a nested tax_query, two meta clauses, multiple post types.
 *
 * Basic used to load such a loop anyway and silently rewrite it down to what its
 * fields could hold. This is what stops that: the panel opens in Custom instead,
 * showing the real query.
 */
function isBasicExpr(expr) {
  const raw = normExpr( expr );
  if ( ! raw ) return true;
  try {
    const p = parseLoopExpr( raw );
    return normExpr( `${ p.alias } in ${ p.sourceKey }(${ buildForArgs( p ) })` ) === raw;
  } catch ( _e ) {
    return false;
  }
}
function replaceLoop(rawHtml, oldExpr, newTag) {
  let done = false;
  return String(rawHtml || '').replace(/\{%\s*for\s+([\s\S]*?)\s*%\}/g, (m, inner) => {
    if (done) return m;
    if (inner.trim() === String(oldExpr || '').trim()) { done = true; return newTag; }
    return m;
  });
}


/* ── form read / write ────────────────────────────────────────────────────── */
function findFormNode(rawHtml, path) {
  const c = document.createElement('div');
  c.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  let node = resolveNodeByPath(c, path);
  while (node && node.tagName !== 'FORM') node = node.parentElement;
  return node ? { container: c, node } : null;
}
function readForm(rawHtml, path) {
  const found = findFormNode(rawHtml, path);
  if (!found) return null;
  const f = found.node;
  const fields = [].slice.call(f.querySelectorAll('input,select,textarea'))
    .filter((i) => i.getAttribute('name') && i.getAttribute('name').indexOf('_uich') !== 0)
    .map((i) => ({ key: i.getAttribute('name'), type: i.tagName === 'TEXTAREA' ? 'textarea' : (i.getAttribute('type') || 'text') }));
  // A present-but-empty attribute means "both actions off" (deliberate). Only a
  // missing attribute falls back to the default, never confuse the two.
  const actionsAttr = f.getAttribute('data-atom-actions');
  const actions = (actionsAttr === null ? 'save_db,email' : actionsAttr).split(',').filter(Boolean);
  return {
    name: f.getAttribute('data-atom-form') || 'form',
    actions,
    subject: f.getAttribute('data-atom-subject') || '',
    emailTo: f.getAttribute('data-atom-email-to') || '',
    emailFrom: f.getAttribute('data-atom-email-from') || '',
    emailReply: f.getAttribute('data-atom-email-reply') || '',
    email2: f.getAttribute('data-atom-email2') || '',
    webhook: f.getAttribute('data-atom-webhook') || '',
    redirect: f.getAttribute('data-atom-redirect') || '',
    success: f.getAttribute('data-atom-success') || '',
    fields,
  };
}
function writeForm(rawHtml, path, cfg) {
  const found = findFormNode(rawHtml, path);
  if (!found) return null;
  const f = found.node;
  const set = (k, v) => { if (v === '' || v == null) f.removeAttribute(k); else f.setAttribute(k, v); };
  set('data-atom-form', (cfg.name || 'form').replace(/[^a-z0-9_-]/gi, ''));
  // Always write data-atom-actions, even when empty (both off). Removing it would
  // look like an unconfigured form and the server would re-apply its default.
  f.setAttribute('data-atom-actions', (cfg.actions || []).join(','));
  set('data-atom-subject', cfg.subject);
  set('data-atom-redirect', cfg.redirect);
  set('data-atom-success', cfg.success);
  // Sensitive settings (email recipients, webhook) are NOT written to the HTML/page source –
  // they're saved server-side via saveFormConfig() and loaded by post + form key at submit.
  return denormalizeUichemyTags(found.container.innerHTML);
}

// Persist sensitive form config server-side (post meta), keyed by post + form key.
function saveFormConfig(formKey, cfg) {
  const c = window.uichAtomFormCfg;
  if (!c || !c.url) return;
  let postId = 0;
  try { postId = (window.elementor && elementor.config && elementor.config.document && elementor.config.document.id) || 0; } catch (e) {}
  if (!postId) return;
  const fd = new FormData();
  fd.append('post_id', postId);
  fd.append('form_key', (formKey || 'form').replace(/[^a-z0-9_-]/gi, ''));
  fd.append('email_to', cfg.emailTo || '');
  fd.append('email_from', cfg.emailFrom || '');
  fd.append('email_reply', cfg.emailReply || '');
  fd.append('email2', cfg.email2 || '');
  fd.append('webhook', cfg.webhook || '');
  fetch(c.url, { method: 'POST', headers: c.nonce ? { 'X-WP-Nonce': c.nonce } : {}, body: fd }).catch(() => {});
}
function loadFormConfig(formKey, cb) {
  const c = window.uichAtomFormCfg;
  if (!c || !c.url) return;
  let postId = 0;
  try { postId = (window.elementor && elementor.config && elementor.config.document && elementor.config.document.id) || 0; } catch (e) {}
  if (!postId) return;
  const url = c.url + '?post_id=' + postId + '&form_key=' + encodeURIComponent((formKey || 'form').replace(/[^a-z0-9_-]/gi, ''));
  fetch(url, { headers: c.nonce ? { 'X-WP-Nonce': c.nonce } : {} })
    .then((r) => r.json()).then((d) => { if (d && d.config) cb(d.config); }).catch(() => {});
}

/* ── mark a selected element as a loop / form ─────────────────────────────── */
// Element child-indices (and thus layer paths) are unchanged by these wraps:
// loop adds for/endfor TEXT siblings (text nodes don't count), and form wraps the
// element in a <form> that takes its index while the element becomes the form's child.
// So the caller re-selects the SAME layer id afterwards.
export function markAsLoop(rawHtml, path) {
  const c = document.createElement('div');
  c.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const node = resolveNodeByPath(c, path);
  if (!node || !node.parentNode) return null;
  // Use the source's NATURAL alias (get_posts → "post"), not a generic "item".
  // Post-card templates bind {{ post.title }} / {{ post.thumbnail }}; if the loop
  // variable were "item", those bindings would fall back to the GLOBAL page post
  // (every card showing the page's own title and no image) instead of resolving
  // per looped post. Keeping alias === source alias makes {{ post.* }} resolve to
  // each item. On a source change the Loop panel re-derives the alias the same way.
  const src = SOURCES[0]; // Posts (get_posts) → alias "post"
  const tag = buildForTag({ sourceKey: src.key, alias: src.alias, perPage: '6', orderby: 'date', order: 'DESC', postType: 'post' });
  node.parentNode.insertBefore(document.createTextNode('\n' + tag + '\n'), node);
  node.parentNode.insertBefore(document.createTextNode('\n{% endfor %}\n'), node.nextSibling);
  return denormalizeUichemyTags(c.innerHTML);
}
// Set/replace a loop's empty-state ({% else %}…) message. Depth-aware so nested loops are safe.
export function setLoopElse(rawHtml, forExpr, message) {
  const s = String(rawHtml || '');
  const want = String(forExpr || '').trim();
  const tagRe = /\{%\s*(for|endfor|else)\b([^%]*)%\}/g;
  let m;
  let depth = 0;
  let forStart = -1; let forEnd = -1; let elsePos = -1; let elseEnd = -1; let bodyDepth = 0;
  while ((m = tagRe.exec(s))) {
    const kw = m[1];
    if (kw === 'for') {
      if (forStart === -1 && m[2].trim() === want) { forStart = m.index + m[0].length; bodyDepth = depth; depth++; }
      else { depth++; }
    } else if (kw === 'endfor') {
      depth--;
      if (forStart !== -1 && depth === bodyDepth) { forEnd = m.index; if (elsePos !== -1) elseEnd = m.index; break; }
    } else if (kw === 'else') {
      if (forStart !== -1 && depth === bodyDepth + 1 && elsePos === -1) { elsePos = m.index; elseEnd = m.index + m[0].length; }
    }
  }
  if (forStart === -1 || forEnd === -1) return s;
  const elseBlock = message ? `{% else %}<div class="uich-loop-empty">${message}</div>` : '';
  if (elsePos !== -1) {
    // replace existing else block (from {% else %} to {% endfor %})
    return s.slice(0, elsePos) + elseBlock + s.slice(forEnd);
  }
  // insert else just before {% endfor %}
  return message ? s.slice(0, forEnd) + elseBlock + s.slice(forEnd) : s;
}

// A loop carries at most ONE pagination slot: numbered links or a Load more
// control. Both writers strip both kinds before inserting, because a mode
// switch runs them in sequence, if each only cleared its own slot, going
// Load more -> Numbered would insert the <nav> ahead of the stale <div>, which
// then no longer sits directly after {% endfor %} for the second writer to find,
// and the loop would render both controls.
const LOOP_SLOT_RE = /^\s*(?:<nav class="uich-loop-pagination-slot">[\s\S]*?<\/nav>|<div class="uich-loop-more-slot">[\s\S]*?<\/div>)/;
function stripLoopSlots(after) {
  let s = String(after || '');
  let prev;
  do { prev = s; s = s.replace(LOOP_SLOT_RE, ''); } while (s !== prev);
  return s;
}

// Set a loop's page control right AFTER its matching {% endfor %}: numbered
// links, a Load more button, or neither. Depth-aware so nested loops don't get
// the wrong endfor, and idempotent, any existing slot of either kind is
// replaced rather than stacked.
//
// ONE writer handles all three modes on purpose. Two independent writers (one
// per slot) cannot compose: running them in sequence, the second one's "clear"
// pass strips the slot the first one just inserted.
export function setLoopPageControl(rawHtml, forExpr, mode) {
  const s = String(rawHtml || '');
  const want = String(forExpr || '').trim();
  const tagRe = /\{%\s*(for|endfor)\b([^%]*)%\}/g;
  let m; let depth = 0; let forStart = -1; let bodyDepth = 0; let endforEnd = -1;
  while ((m = tagRe.exec(s))) {
    if (m[1] === 'for') {
      if (forStart === -1 && m[2].trim() === want) { forStart = m.index; bodyDepth = depth; depth++; }
      else { depth++; }
    } else {
      depth--;
      if (forStart !== -1 && depth === bodyDepth) { endforEnd = m.index + m[0].length; break; }
    }
  }
  if (forStart === -1 || endforEnd === -1) return s;
  const after = stripLoopSlots(s.slice(endforEnd));
  let block = '';
  if (mode === 'numbers') {
    block = `\n<nav class="uich-loop-pagination-slot">{{ loop_pagination()|raw }}</nav>`;
  } else if (mode === 'loadmore') {
    block = `\n<div class="uich-loop-more-slot">{{ loop_load_more()|raw }}</div>`;
  }
  return s.slice(0, endforEnd) + block + after;
}

// Back-compat wrappers over the single writer above.
export function setLoopPagination(rawHtml, forExpr, on) {
  return setLoopPageControl(rawHtml, forExpr, on ? 'numbers' : 'none');
}
export function setLoopLoadMore(rawHtml, forExpr, on) {
  return setLoopPageControl(rawHtml, forExpr, on ? 'loadmore' : 'none');
}

export function markAsForm(rawHtml, path) {
  const c = document.createElement('div');
  c.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const node = resolveNodeByPath(c, path);
  if (!node || !node.parentNode) return null;
  if (node.tagName === 'FORM') {
    // A user-authored native <form>, we only TAG it; never mark it as our wrapper
    // (so unmarking won't unwrap/destroy the author's real form).
    if (!node.getAttribute('data-atom-form')) node.setAttribute('data-atom-form', 'form');
  } else {
    const form = document.createElement('form');
    form.setAttribute('data-atom-form', 'form');
    // Flag this <form> as one WE injected, so removeForm can fully unwrap it
    // (mirroring removeLoop). Without this marker, unmarking could only untag –
    // leaving a residual bare <form> around the element every time.
    form.setAttribute('data-atom-form-wrap', '1');
    node.parentNode.insertBefore(form, node);
    form.appendChild(node);
  }
  return denormalizeUichemyTags(c.innerHTML);
}

/* ── remove / un-tag a construct ──────────────────────────────────────────────
   Inverse of markAs* / data binding. Loop & Condition are unwrapped (the
   {% for %}/{% if %} markers are removed, the inner element kept). Data clears
   the {{ … }} binding. Form strips the data-atom-* tagging (keeps the element). */
// Depth-aware removal of a {% kw expr %}…{% endKw %} wrapper, keeping the first
// branch's body (anything before an {% else %}, else the whole body).
function stripTwigWrapper(rawHtml, kw, endKw, expr) {
  const s = String(rawHtml || '');
  const want = String(expr || '').trim();
  const re = new RegExp('\\{%\\s*(' + kw + '|' + endKw + '|else)\\b([^%]*)%\\}', 'g');
  let m;
  let depth = 0;
  let openStart = -1; let openEnd = -1; let elsePos = -1; let closeStart = -1; let closeEnd = -1; let bodyDepth = 0;
  while ((m = re.exec(s))) {
    const t = m[1];
    if (t === kw) {
      if (openStart === -1 && m[2].trim() === want) { openStart = m.index; openEnd = m.index + m[0].length; bodyDepth = depth; depth++; }
      else { depth++; }
    } else if (t === endKw) {
      depth--;
      if (openStart !== -1 && depth === bodyDepth) { closeStart = m.index; closeEnd = m.index + m[0].length; break; }
    } else if (t === 'else') {
      if (openStart !== -1 && depth === bodyDepth + 1 && elsePos === -1) elsePos = m.index;
    }
  }
  if (openStart === -1 || closeStart === -1) return s;
  const bodyEnd = elsePos !== -1 ? elsePos : closeStart;
  const body = s.slice(openEnd, bodyEnd);
  return (s.slice(0, openStart) + body + s.slice(closeEnd)).replace(/\n{3,}/g, '\n\n');
}

export function removeLoop(rawHtml, forExpr) {
  return stripTwigWrapper(rawHtml, 'for', 'endfor', forExpr);
}
export function removeForm(rawHtml, path) {
  const found = findFormNode(rawHtml, path);
  if (!found) return null;
  const f = found.node;
  if (f.getAttribute('data-atom-form-wrap') !== null && f.parentNode) {
    // A wrapper WE injected → fully unwrap it: hoist its children back into place,
    // then drop the empty <form>. Reverses markAsForm cleanly (like removeLoop),
    // leaving no residual <form> in the tree or on the front end.
    while (f.firstChild) { f.parentNode.insertBefore(f.firstChild, f); }
    f.parentNode.removeChild(f);
  } else {
    // A pre-existing / user-authored <form> we only tagged → strip our data-atom-*
    // attributes and keep the element (unwrapping would destroy the author's form).
    [].slice.call(f.attributes).forEach((a) => { if (a.name.indexOf('data-atom-') === 0) f.removeAttribute(a.name); });
  }
  return denormalizeUichemyTags(found.container.innerHTML);
}

/* ── UI ───────────────────────────────────────────────────────────────────── */
// Field keeps the editor's native inspector label chrome (.field.pf) while the
// inputs/selects themselves use the shadcn recipes so the Loop/Form tabs match
// the rest of the migrated editor.
function Field({ label, children }) {
  return (
    <div className="field pf" style={{ margin: 0 }}>
      {label ? <label className="pf-label" style={{ padding: '0 0 4px' }}><span className="pf-name-text">{label}</span></label> : null}
      {children}
    </div>
  );
}
function NInput(props) {
  return (
    <div className="prop-input-stack">
      <Input className="h-8" {...props} />
    </div>
  );
}
function NSelect({ value, onChange, children }) {
  const T = I;
  return (
    <div className="prop-input-stack">
      <span className="relative flex w-full">
        <select className={SELECT_CLS} value={value} onChange={onChange}>{children}</select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          <T.chevron size={9} />
        </span>
      </span>
    </div>
  );
}

// Dashed section divider + title, reuses the editor inspector's .subsection chrome
// so construct tabs share the same visual rhythm as the Editor tab.
function SectionHead({ title, pro }) {
  return (
    <div className="subsection uich-construct-sub">
      <span className="subsection-title">{title}</span>
      {pro && <ProBadge small />}
    </div>
  );
}

// Collapsible sub-section inside a construct panel. Lighter than the top-level
// inspector accordions: a quiet divider + title, an optional one-line summary of
// the current state shown when collapsed, and a caret. Progressive disclosure
// lives inside the body (nested reveals, "more options"), so the panel reads as a
// short list of named groups instead of one long scroll.
function Section({ title, summary, defaultOpen = true, children }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={`uich-construct-section${open ? ' is-open' : ''}`}>
      <button type="button" className="uich-construct-section-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="uich-construct-section-title">{title}</span>
        {!open && summary ? <span className="uich-construct-section-sum">{summary}</span> : null}
        <I.chevron size={11} className="uich-construct-section-caret" />
      </button>
      {open && <div className="uich-construct-section-body">{children}</div>}
    </div>
  );
}

// A labelled on/off row built on the shared shadcn Switch. Clicking the label
// toggles too (larger target); the Switch itself stays keyboard-accessible.
function SwitchRow({ label, checked, onChange }) {
  return (
    <div className="uich-construct-switchrow">
      <span className="uich-construct-switchrow-label" onClick={() => onChange(!checked)}>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

// Radio-style exclusive choice (used for the After-submit behaviour).
function RadioRow({ label, checked, onChange }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className={`uich-construct-radio${checked ? ' on' : ''}`} onClick={onChange}>
      <span className="uich-construct-radio-dot" />
      <span>{label}</span>
    </button>
  );
}

/* ── live entity picker (real posts / terms) for the Loop tab ─────────────────
   Drives the Only-these-IDs / Exclude / In-category fields with actual content
   instead of hand-typed IDs/slugs. Degrades to a plain input if the REST endpoint
   isn't localized (e.g. front-end / old enqueue), so it can never break the editor. */
function entitiesCfg() {
  const c = (typeof window !== 'undefined' && window.uichAtomFields) || null;
  return c && c.entitiesUrl ? c : null;
}
function fetchEntities(params, cb) {
  const c = entitiesCfg();
  if (!c) { cb(null); return; }
  const qs = Object.keys(params).filter((k) => params[k] !== '' && params[k] != null)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  fetch(c.entitiesUrl + (qs ? '?' + qs : ''), { headers: c.nonce ? { 'X-WP-Nonce': c.nonce } : {} })
    .then((r) => r.json()).then((d) => cb(Array.isArray(d) ? d : [])).catch(() => cb([]));
}
const csvToArr = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const arrToCsv = (a) => a.join(', ');

export function EntityPicker({ kind, postType, taxonomy, value, field, multi, placeholder, onChange }) {
  if (!entitiesCfg()) {
    return <NInput value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  const selected = csvToArr(value);
  const [labels, setLabels] = React.useState({});
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const tRef = React.useRef(null);
  const tokenOf = (it) => String(field === 'slug' ? it.slug : it.id);
  // Resolve labels for already-selected tokens so chips show real titles after reload.
  React.useEffect(() => {
    const missing = selected.filter((t) => !(t in labels));
    if (!missing.length) return;
    fetchEntities({ kind, post_type: postType, taxonomy, include: missing.join(',') }, (items) => {
      if (!items) return;
      setLabels((m) => { const n = { ...m }; items.forEach((it) => { n[tokenOf(it)] = it.label; }); return n; });
    });
  }, [value]); // eslint-disable-line
  const search = (text) => {
    setQ(text); setOpen(true);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => fetchEntities({ kind, post_type: postType, taxonomy, search: text }, (items) => setResults(items || [])), 250);
  };
  const add = (it) => {
    const tok = tokenOf(it);
    setLabels((m) => ({ ...m, [tok]: it.label }));
    const next = multi ? (selected.includes(tok) ? selected : selected.concat(tok)) : [tok];
    onChange(arrToCsv(next)); setQ(''); setOpen(false); setResults([]);
  };
  const remove = (tok) => onChange(arrToCsv(selected.filter((t) => t !== tok)));
  return (
    <div className="uich-entity-picker">
      {selected.length > 0 && (
        <div className="uich-entity-chips mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((tok) => (
            <span key={tok} className={CHIP_CLS}>
              {labels[tok] || tok}
              <button
                type="button"
                className="ml-0.5 rounded-sm leading-none text-muted-foreground transition-colors hover:text-destructive"
                onClick={() => remove(tok)}
                aria-label="Remove"
              >×</button>
            </span>
          ))}
        </div>
      )}
      {(multi || selected.length === 0) && (
        <div className="uich-entity-search relative">
          <Input className="h-8" value={q} placeholder={placeholder}
            onChange={(e) => search(e.target.value)}
            onFocus={() => { setOpen(true); if (!results.length) search(''); }}
            onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {open && results.filter((it) => !selected.includes(tokenOf(it))).length > 0 && (
            <ul className="uich-entity-menu absolute left-0 right-0 top-full z-50 mt-1 max-h-52 list-none overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
              {results.filter((it) => !selected.includes(tokenOf(it))).map((it) => (
                <li
                  key={it.id}
                  className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(e) => { e.preventDefault(); add(it); }}
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{field === 'slug' ? it.slug : ('#' + it.id)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function getLoopEmptyMsg(rawHtml) {
  const m = String(rawHtml || '').match(/<div class="uich-loop-empty">([\s\S]*?)<\/div>/);
  return m ? m[1] : '';
}

function LoopPanel({ selectedEntry, rawHtml, onWriteHtml }) {
  const [cfg, setCfg] = React.useState(() => parseLoopExpr(selectedEntry.dyn.loop, rawHtml));
  const [emptyMsg, setEmptyMsg] = React.useState(() => getLoopEmptyMsg(rawHtml));
  // Basic = the form below. Custom = write the query by hand. The stored loop
  // decides which one opens: a query Basic can't reproduce would be rewritten
  // (and quietly simplified) the moment the form touched it, so it opens in
  // Custom instead. See isBasicExpr().
  const [mode, setMode] = React.useState(() => (isBasicExpr(selectedEntry.dyn.loop) ? 'basic' : 'custom'));
  const [customExpr, setCustomExpr] = React.useState(() => normExpr(selectedEntry.dyn.loop));
  const oldExprRef = React.useRef(selectedEntry.dyn.loop);
  const rawRef = React.useRef(rawHtml);
  rawRef.current = rawHtml;
  const apply = (next) => {
    setCfg(next);
    const tag = buildForTag(next);
    const html = replaceLoop(rawRef.current, oldExprRef.current, tag);
    oldExprRef.current = next.alias + ' in ' + next.sourceKey + '(' + buildForArgs(next) + ')';
    onWriteHtml(html);
  };
  const applyEmpty = (msg) => {
    setEmptyMsg(msg);
    onWriteHtml(setLoopElse(rawRef.current, oldExprRef.current, msg));
  };
  // Pagination injects a block after {% endfor %}, {{ loop_pagination() }} for
  // numbered links, {{ loop_load_more() }} for the button, so it does its own
  // combined write (rewrite the loop tag, then add/remove the slots). Both
  // writers always run: switching modes has to clear the slot it moved away
  // from, and 'none' has to clear both.
  const applyPagination = (mode) => {
    const next = { ...cfg, pagination: mode };
    setCfg(next);
    let html = replaceLoop(rawRef.current, oldExprRef.current, buildForTag(next));
    oldExprRef.current = next.alias + ' in ' + next.sourceKey + '(' + buildForArgs(next) + ')';
    html = setLoopPageControl(html, oldExprRef.current, mode);
    onWriteHtml(html);
  };
  const up = (k) => (e) => apply({ ...cfg, [k]: e.target.value });

  /* ── custom-query mode ─────────────────────────────────────────────────── */
  // Writes the typed expression straight into the {% for %} tag. Nothing is
  // parsed or normalised on the way through, that is the whole point of the
  // mode, and it is what lets a query hold things the form has no field for.
  const applyCustom = (expr) => {
    // The textarea is already readOnly when locked; this is the belt to that
    // brace, so no path can write a custom query in a build that doesn't sell it.
    if (isCustomLoopLocked()) return;
    setCustomExpr(expr);
    const clean = String(expr || '').trim();
    // Skip the write while the expression is obviously mid-typing, so a half
    // -finished line never lands in the template. Local state keeps the text.
    if (!/\S\s+in\s+\S/.test(clean)) return;
    const html = replaceLoop(rawRef.current, oldExprRef.current, `{% for ${clean} %}`);
    oldExprRef.current = clean;
    onWriteHtml(html);
  };
  const customValid = /\S\s+in\s+\S/.test(String(customExpr || '').trim());

  const switchMode = (next) => {
    if (next === mode) return;
    if (next === 'custom') {
      // Locked in Free: open the upsell and leave the select on Basic. The
      // marker and the copy both come from the pro module, so this panel holds
      // no upgrade text and needs no tier test of its own.
      if (isCustomLoopLocked()) {
        showCustomLoopUpsell();
        setMode('basic');
        return;
      }
      // Seed the editor with whatever the form is currently producing, so the
      // author starts from their own query rather than a blank line.
      setCustomExpr(normExpr(forInner(buildForTag(cfg))));
      setMode('custom');
      return;
    }
    // Custom → Basic rewrites the query from the form's fields. Anything the
    // form can't express is lost, so say so before doing it.
    if (!isBasicExpr(customExpr) && typeof window !== 'undefined' && window.confirm
      && !window.confirm('Switching to Basic rebuilds the query from the fields below. Anything Basic can’t express, nested AND/OR, a second filter, several post types, will be dropped. Continue?')) {
      return;
    }
    setMode('basic');
    apply(parseLoopExpr(customExpr, rawRef.current));
  };

  const isPostish = cfg.sourceKey === 'get_posts' || cfg.sourceKey === 'get_products';
  const isApi = cfg.sourceKey === 'get_api';
  const idPostType = cfg.sourceKey === 'get_products' ? 'product' : (cfg.postType || 'post');
  const catTax = cfg.sourceKey === 'get_products' ? 'product_cat' : (cfg.taxonomy || 'category');
  // Hide loop sources whose optional plugin is inactive (e.g. the WooCommerce
  // "Products" source when Woo is off), reusing the picker's integration flags.
  // Always keep the currently-selected source so an existing loop never loses it.
  const loopSrcOk = (key) => {
    const S = (typeof window !== 'undefined' && window.UichDD && window.UichDD.schema) || null;
    return S && S.loopSourceAvailable ? S.loopSourceAvailable(key) : true;
  };
  const visibleSources = SOURCES.filter((s) => loopSrcOk(s.key) || s.key === cfg.sourceKey);
  // A source this build does not ship stays in the list, marked by loopSourceSuffix()
  //, a hidden option sells nothing, but picking it opens the upsell and leaves the
  // loop on its current source, since the server returns no items for it anyway.
  // Both the marker and the upsell come from the per-plugin pro module, so this panel
  // holds no upgrade copy and needs no tier check.
  return (
    <div className="uich-construct-body">
      <div className="uich-construct-head"><span className="uich-construct-pill loop">Loop</span> writes <code>{'{% for … %}'}</code></div>

      <div className="uich-construct-grid">
        <Field label="Loop builder">
          <NSelect value={mode} onChange={(e) => switchMode(e.target.value)}>
            <option value="basic">Basic</option>
            {/* Stays listed when locked, a hidden option sells nothing. Picking
                it opens the upsell and bounces back to Basic. */}
            <option value="custom">Custom query{customLoopSuffix()}</option>
          </NSelect>
        </Field>
      </div>

      {mode === 'custom' && (
        <>
          <SectionHead title="Query" />
          {/* Free can still LAND here, an imported design or a Code-tab edit can
              hold a query Basic cannot express. Showing it read-only is the
              honest option: forcing Basic would silently rewrite their loop. */}
          <textarea
            className="uich-loop-custom"
            spellCheck={false}
            rows={6}
            readOnly={isCustomLoopLocked()}
            value={customExpr}
            placeholder="post in get_posts({ post_type: 'post', posts_per_page: 6 })"
            onChange={(e) => applyCustom(e.target.value)}
          />
          <CustomLoopLockNote />
          {!customValid && !isCustomLoopLocked() && (
            <div className="uich-dd-hint uich-loop-custom-warn">
              Expected <code>alias in source(&#123; … &#125;)</code>, e.g. <code>post in get_posts(&#123; … &#125;)</code>. The template is left untouched until the expression is complete.
            </div>
          )}
          <div className="uich-dd-hint" style={{ marginTop: 8 }}>
            Writes <code>{'{% for '}</code>…<code>{' %}'}</code> exactly as typed. Every WP_Query key the runner accepts works here, including the ones Basic has no field for:
            <br />• several post types, <code>post_type: [ 'post', 'page' ]</code>
            <br />• OR between taxonomies, <code>{"tax_query: [ { relation: 'OR' }, { … }, { … } ]"}</code>
            <br />• more than one custom-field rule, <code>{"meta_query: [ { relation: 'AND' }, { … }, { … } ]"}</code>
            <br />• the current post as context, <code>post__not_in: [ post.id ]</code>
            <br />Sources: <code>get_posts</code>, <code>get_products</code>, <code>get_terms</code>, <code>get_users</code>, <code>get_api</code>. Add <code>paged: current_page()</code> yourself for numbered pages.
          </div>
        </>
      )}

      {mode === 'basic' && (
      <>
      <div className="uich-construct-grid">
        <Field label="Show">
          <NSelect value={cfg.sourceKey} onChange={(e) => {
            const key = e.target.value;
            if (isLoopSourceLocked(key)) {
              showLoopSourceUpsell();
              setCfg({ ...cfg });
              return;
            }
            const s = SOURCES.find((x) => x.key === key) || SOURCES[0];
            apply({ ...cfg, sourceKey: s.key, alias: s.alias, taxonomy: s.taxonomy || 'category' });
          }}>
            {visibleSources.map((s) => (
              <option key={s.key} value={s.key}>{s.label}{loopSourceSuffix(s.key)}</option>
            ))}
          </NSelect>
        </Field>
        <Field label="Item name"><NInput value={cfg.alias} onChange={up('alias')} /></Field>
        {cfg.sourceKey === 'get_posts' && <Field label="Post type"><NInput value={cfg.postType} onChange={up('postType')} /></Field>}
        {isPostish &&
          <Field label="In categories">
            <EntityPicker kind="terms" taxonomy={catTax} value={cfg.term} field="slug" multi
              placeholder="Search categories…" onChange={(v) => apply({ ...cfg, term: v })} />
          </Field>}
        {isApi && <Field label="API URL"><NInput value={cfg.apiUrl} placeholder="https://api.example.com/items" onChange={up('apiUrl')} /></Field>}
        {isApi && <Field label="Response path"><NInput value={cfg.apiPath} placeholder="e.g. data.results (optional)" onChange={up('apiPath')} /></Field>}
        {isApi && (
          <Field label="Method">
            <NSelect value={cfg.apiMethod} onChange={up('apiMethod')}><option value="GET">GET</option><option value="POST">POST</option></NSelect>
          </Field>
        )}
        <Field label={isApi ? 'Limit' : 'How many'}><NInput type="number" value={cfg.perPage} onChange={up('perPage')} /></Field>
        {!isApi && (
          <Field label="Order by">
            <NSelect value={cfg.orderby} onChange={up('orderby')}>{ORDERBY.map((o) => <option key={o} value={o}>{o}</option>)}</NSelect>
          </Field>
        )}
        {!isApi && (
          <Field label="Order">
            <NSelect value={cfg.order} onChange={up('order')}><option value="DESC">Newest / Z-A</option><option value="ASC">Oldest / A-Z</option></NSelect>
          </Field>
        )}
      </div>

      {isApi && <div className="uich-dd-hint" style={{ marginTop: 10 }}>Fetches JSON and loops its array. Read fields with <code>{'{{ item.field }}'}</code> (or <code>{'{{ item.nested.field }}'}</code>). Responses cache 5 min; secrets belong in PHP constants.</div>}

      {!isApi && <SectionHead title="Filtering" />}
      {!isApi && (
      <div className="uich-construct-grid">
        <Field label="Skip first (offset)"><NInput type="number" min="0" value={cfg.offset} placeholder="0" onChange={up('offset')} /></Field>
        {isPostish && (
          <Field label="Status">
            <NSelect value={cfg.postStatus} onChange={up('postStatus')}>{POST_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</NSelect>
          </Field>
        )}
        {isPostish && (
          <Field label="Only these">
            <EntityPicker kind="posts" postType={idPostType} value={cfg.include} field="id" multi
              placeholder="Search to pick…" onChange={(v) => apply({ ...cfg, include: v })} />
          </Field>
        )}
        {isPostish && (
          <Field label="Exclude">
            <EntityPicker kind="posts" postType={idPostType} value={cfg.exclude} field="id" multi
              placeholder="Search to exclude…" onChange={(v) => apply({ ...cfg, exclude: v })} />
          </Field>
        )}
        {isPostish && (
          <Field label="By author">
            <EntityPicker kind="users" value={cfg.author} field="id" multi
              placeholder="Search authors…" onChange={(v) => apply({ ...cfg, author: v })} />
          </Field>
        )}
        {cfg.sourceKey === 'get_terms' && (
          <>
            <Field label="Parent term ID"><NInput type="number" min="0" value={cfg.termParent} placeholder="(any)" onChange={up('termParent')} /></Field>
            <Field label="Hide empty">
              <label className="uich-construct-check" style={{ marginTop: 6 }}>
                <input type="checkbox" className="uich-check" checked={cfg.hideEmpty !== false} onChange={(e) => apply({ ...cfg, hideEmpty: e.target.checked })} /> Skip terms with no posts
              </label>
            </Field>
          </>
        )}
        {cfg.sourceKey === 'get_users' && <Field label="Role"><NInput value={cfg.role} placeholder="e.g. administrator" onChange={up('role')} /></Field>}
      </div>
      )}

      {isPostish && (
        <div className="uich-construct-checks" style={{ marginTop: 10 }}>
          <label className="uich-construct-check">
            <input type="checkbox" className="uich-check" checked={!!cfg.excludeCurrent} onChange={(e) => apply({ ...cfg, excludeCurrent: e.target.checked })} /> Exclude the current post
          </label>
          <label className="uich-construct-check">
            <input type="checkbox" className="uich-check" checked={cfg.ignoreSticky === false} onChange={(e) => apply({ ...cfg, ignoreSticky: !e.target.checked })} /> Include sticky posts at the top
          </label>
          <label className="uich-construct-check">
            <input type="checkbox" className="uich-check" checked={!!cfg.avoidDuplicates} onChange={(e) => apply({ ...cfg, avoidDuplicates: e.target.checked })} /> Avoid duplicates across loops on the page
          </label>
        </div>
      )}

      {isPostish && (
        <>
          <SectionHead title="Published date" />
          <div className="uich-construct-grid">
            <Field label="Published">
              <NSelect value={cfg.dateMode || ''} onChange={(e) => apply({ ...cfg, dateMode: e.target.value })}>
                {DATE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </NSelect>
            </Field>
            {cfg.dateMode === 'custom' && (
              <>
                <Field label="After"><NInput type="date" value={cfg.dateAfter || ''} onChange={up('dateAfter')} /></Field>
                <Field label="Before"><NInput type="date" value={cfg.dateBefore || ''} onChange={up('dateBefore')} /></Field>
              </>
            )}
          </div>
        </>
      )}

      {isPostish && (
        <>
          <SectionHead title="Custom field filter" />
          <div className="uich-construct-grid">
            <Field label="Meta key"><NInput value={cfg.metaKey} placeholder="(optional)" onChange={up('metaKey')} /></Field>
            <Field label="Compare">
              <NSelect value={cfg.metaCompare} onChange={up('metaCompare')}>{META_COMPARE.map((o) => <option key={o} value={o}>{o}</option>)}</NSelect>
            </Field>
            {cfg.metaCompare !== 'EXISTS' && cfg.metaCompare !== 'NOT EXISTS' && (
              <Field label="Value"><NInput value={cfg.metaValue} placeholder="e.g. featured" onChange={up('metaValue')} /></Field>
            )}
          </div>
          <div className="uich-dd-hint" style={{ marginTop: 8 }}>Filters items by a custom field (ACF/Meta Box/native meta). Numeric compares (&gt;, &lt;, …) are treated as numbers automatically.</div>
        </>
      )}

      {/* PaginationGate comes from the per-plugin pro module: where this build ships
          the renderers it passes the real control through, and where it does not it
          substitutes its own upgrade line. Replacing the select outright (rather than
          disabling it) matters, a stored value could not be edited back to 'none'
          from a disabled control, and PHP refuses to render either option anyway. */}
      {isPostish && (
        <PaginationGate>
          <SectionHead title="Pagination" />
          <div className="uich-construct-grid">
            <Field label="Page links">
              <NSelect value={cfg.pagination || 'none'} onChange={(e) => applyPagination(e.target.value)}>
                <option value="none">None</option>
                <option value="numbers">Numbered</option>
                <option value="loadmore">Load more</option>
              </NSelect>
            </Field>
            {cfg.pagination === 'loadmore' && (
              <Field label="Load per click">
                <NInput
                  type="number"
                  min="1"
                  value={cfg.loadBatch}
                  placeholder={String(parseInt(cfg.perPage, 10) || 9)}
                  onChange={up('loadBatch')}
                />
              </Field>
            )}
          </div>
          <div className="uich-dd-hint" style={{ marginTop: 8 }}>
            {cfg.pagination === 'loadmore'
              ? <>Shows “How many” items first, then adds this many per click. Leave blank to load the same number each time. The button disappears once everything is shown, and falls back to a normal next-page link if JavaScript is off.</>
              : <>Adds numbered page links after the loop (via <code>?loop_page=</code>). Uses “How many” as the per-page count.</>}
          </div>
        </PaginationGate>
      )}
      </>
      )}

      {/* Outside the mode switch on purpose: the {% else %} block lives in the
          markup, not in the query, so it is editable either way. */}
      <SectionHead title="Empty state" />
      <div className="uich-construct-grid">
        <Field label="If empty, show"><NInput value={emptyMsg} placeholder="Nothing found." onChange={(e) => applyEmpty(e.target.value)} /></Field>
      </div>
      <div className="uich-dd-hint" style={{ marginTop: 12 }}>The “If empty” text shows (via <code>{'{% else %}'}</code>) when the query returns nothing.</div>
    </div>
  );
}

// Short summary of the On-submit group, shown when the section is collapsed.
function onSubmitSummary(actions, webhookOn) {
  const parts = [];
  if (actions.includes('save_db')) parts.push('Save');
  if (actions.includes('email')) parts.push('Email');
  if (webhookOn) parts.push('Webhook');
  return parts.length ? parts.join(' · ') : 'Nothing';
}

function FormPanel({ selectedEntry, rawHtml, onWriteHtml, onRemove }) {
  const initial = React.useMemo(() => readForm(rawHtml, selectedEntry.path) || { name: 'form', actions: ['save_db', 'email'], subject: '', emailTo: '', emailFrom: '', emailReply: '', email2: '', webhook: '', redirect: '', success: '', fields: [] }, []); // eslint-disable-line
  const [cfg, setCfg] = React.useState(initial);
  const cfgRef = React.useRef(cfg);
  cfgRef.current = cfg;
  // Progressive-disclosure UI state, derived from cfg (not persisted separately):
  //  · moreEmail, show the optional From / Reply-to / CC fields.
  //  · webhookOn, the webhook has no on/off flag of its own, so we track it by
  //    presence; toggling off clears the stored URL so it can't fire.
  //  · afterMode, "show message" vs "redirect" are mutually-exclusive paths.
  const [moreEmail, setMoreEmail] = React.useState(false);
  const [webhookOn, setWebhookOn] = React.useState(false);
  const [afterMode, setAfterMode] = React.useState(initial.redirect ? 'redirect' : 'message');
  // Load sensitive settings (email/webhook) from server-side config on open, then
  // re-derive the reveal state from what actually came back.
  React.useEffect(() => {
    loadFormConfig(initial.name, (sc) => {
      setCfg((c) => ({ ...c, emailTo: sc.email_to || '', emailFrom: sc.email_from || '', emailReply: sc.email_reply || '', email2: sc.email2 || '', webhook: sc.webhook || '' }));
      setMoreEmail(!!(sc.email_from || sc.email_reply || sc.email2));
      setWebhookOn(!!sc.webhook);
    });
  }, []); // eslint-disable-line
  const apply = (next) => { setCfg(next); const html = writeForm(rawHtml, selectedEntry.path, next); if (html != null) onWriteHtml(html); };
  const toggleAction = (a) => { const has = cfgRef.current.actions.includes(a); apply({ ...cfgRef.current, actions: has ? cfgRef.current.actions.filter((x) => x !== a) : cfgRef.current.actions.concat(a) }); };
  const up = (k) => (e) => apply({ ...cfgRef.current, [k]: e.target.value });
  // Sensitive fields → keep in state + persist server-side (never written to page source).
  const upSensitive = (k) => (e) => { const next = { ...cfgRef.current, [k]: e.target.value }; setCfg(next); saveFormConfig(next.name, next); };
  const setSensitive = (k, v) => { const next = { ...cfgRef.current, [k]: v }; setCfg(next); saveFormConfig(next.name, next); };
  const has = (a) => cfg.actions.includes(a);
  const toggleWebhook = (on) => { setWebhookOn(on); if (!on) setSensitive('webhook', ''); };
  const chooseAfter = (mode) => {
    setAfterMode(mode);
    if (mode === 'message' && cfgRef.current.redirect) apply({ ...cfgRef.current, redirect: '' });
    else if (mode === 'redirect' && cfgRef.current.success) apply({ ...cfgRef.current, success: '' });
  };
  const fieldCount = cfg.fields.length;
  return (
    <div className="uich-construct-body uich-construct-body--sectioned">
      <div className="uich-construct-head">
        <span className="uich-construct-pill form">Form</span>
        <code>.{cfg.name}</code>
        {typeof onRemove === 'function' && (
          <>
            <span className="uich-construct-head-sp" />
            <button type="button" className="uich-construct-head-act" title="Remove form" aria-label="Remove form" onClick={onRemove}><I.trash size={13} /></button>
          </>
        )}
      </div>

      <Section title="Fields" summary={fieldCount ? `${fieldCount} field${fieldCount > 1 ? 's' : ''}` : 'None yet'}>
        <Field label="Form name"><NInput value={cfg.name} onChange={up('name')} /></Field>
        {fieldCount
          ? <div className="uich-construct-fields">{cfg.fields.map((f) => <span key={f.key} className={CHIP_CLS}>{f.key} · {f.type}</span>)}</div>
          : <p className="uich-dd-hint">Add inputs between the form’s start and end. They’re detected automatically.</p>}
      </Section>

      <Section title="On submit" summary={onSubmitSummary(cfg.actions, webhookOn)}>
        <div className="uich-construct-switches">
          <SwitchRow label="Save to database" checked={has('save_db')} onChange={() => toggleAction('save_db')} />
          <SwitchRow label="Email a notification" checked={has('email')} onChange={() => toggleAction('email')} />
          {has('email') && (
            <div className="uich-construct-nest">
              <Field label="Send to"><NInput value={cfg.emailTo} placeholder="admin (default)" onChange={upSensitive('emailTo')} /></Field>
              <Field label="Subject"><NInput value={cfg.subject} placeholder="New submission" onChange={up('subject')} /></Field>
              <button type="button" className="uich-construct-more" onClick={() => setMoreEmail((m) => !m)}>{moreEmail ? 'Fewer options' : 'More options'}</button>
              {moreEmail && (
                <>
                  <Field label="From name"><NInput value={cfg.emailFrom} placeholder="(optional)" onChange={upSensitive('emailFrom')} /></Field>
                  <Field label="Reply-to"><NInput value={cfg.emailReply} placeholder="(optional)" onChange={upSensitive('emailReply')} /></Field>
                  <Field label="CC"><NInput value={cfg.email2} placeholder="(optional)" onChange={upSensitive('email2')} /></Field>
                </>
              )}
            </div>
          )}
          <SwitchRow label="Send to a webhook" checked={webhookOn} onChange={toggleWebhook} />
          {webhookOn && (
            <div className="uich-construct-nest">
              <Field label="Webhook URL"><NInput value={cfg.webhook} placeholder="https:// (Zapier / Make / n8n)" onChange={upSensitive('webhook')} /></Field>
            </div>
          )}
        </div>
      </Section>

      <Section title="After submit" defaultOpen={false} summary={afterMode === 'redirect' ? 'Redirect' : 'Show message'}>
        <div className="uich-construct-radios">
          <RadioRow label="Show a message" checked={afterMode === 'message'} onChange={() => chooseAfter('message')} />
          {afterMode === 'message' && <div className="uich-construct-nest"><NInput value={cfg.success} placeholder="Thank you!" onChange={up('success')} /></div>}
          <RadioRow label="Redirect to a URL" checked={afterMode === 'redirect'} onChange={() => chooseAfter('redirect')} />
          {afterMode === 'redirect' && <div className="uich-construct-nest"><NInput value={cfg.redirect} placeholder="https://…" onChange={up('redirect')} /></div>}
        </div>
      </Section>

      <p className="uich-dd-hint uich-construct-foot"><I.lock size={11} /> Recipients and webhook are stored securely server-side. Submissions appear in wp-admin → Form Submissions; more via the <code>uich_form_submitted</code> hook.</p>
    </div>
  );
}

const CONSTRUCT_LABELS = { loop: 'Loop', form: 'Form' };

export default function ConstructTab({ constructType, selectedEntry, rawHtml, onWriteHtml, onRemove }) {
  if (!selectedEntry || !constructType || !selectedEntry.dyn) return null;
  const d = selectedEntry.dyn;
  let panel = null;
  if (constructType === 'form') {
    panel = <FormPanel selectedEntry={selectedEntry} rawHtml={rawHtml} onWriteHtml={onWriteHtml} onRemove={typeof onRemove === 'function' ? () => onRemove('form') : undefined} />;
  } else if (constructType === 'loop' && d.loop) {
    panel = <LoopPanel selectedEntry={selectedEntry} rawHtml={rawHtml} onWriteHtml={onWriteHtml} />;
  }
  if (!panel) return null;

  const label = CONSTRUCT_LABELS[constructType] || 'tag';
  return (
    <div className="uich-construct-wrap">
      {/* Form has its own demoted Remove control in the panel header; the other
          constructs keep this top button. */}
      {typeof onRemove === 'function' && constructType !== 'form' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="uich-construct-remove mx-4 mt-3 h-7 gap-1.5 px-2.5 text-xs text-destructive hover:text-destructive [&_svg]:size-3"
          title={`Remove ${label}`}
          onClick={() => onRemove(constructType)}
        >
          <I.trash size={12} /> Remove {label}
        </Button>
      )}
      {panel}
    </div>
  );
}
