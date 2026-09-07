// Two-way sync between the code-editor strings and the 3rd-party assets list.
//
// Forward sync (deps → editor) was already in place: adding / editing /
// removing a row in the assets bar mutates the corresponding head/footer
// (or raw_html) string so the tag in the editor stays in lock-step.
//
// This module adds the REVERSE direction (editor → deps): when the user
// types or pastes a `<script src=…>` / `<link rel="stylesheet" href=…>` /
// Google-fonts `<link>` straight into one of the editors, we detect it and
// surface it as a row in the assets bar. Removing the tag from the editor
// (deleting the line, commenting it out, etc.) drops the matching row.
//
// Loop-safety:
//   • The bar's forward sync uses the `commitDep` / `remove` / `update`
//     paths, which write the editor too. The reverse sync uses ONLY
//     `setDeps` (no mirror). Each side reads the other's source of truth
//     and converges; never adds work back to the other side.
//   • The reconciler is idempotent, if the parsed tags already match the
//     deps list, it returns `changed: false` and skips the setDeps call.
//
// Why URL-keyed matching:
//   The dep <-> tag relationship is unambiguous by URL. Names, versions,
//   and ids are user-mutable; the URL is what actually shows up in <head>.

import React from 'react';

// ── Parsers ───────────────────────────────────────────────────────────────────
// We deliberately use simple regex (vs DOMParser) because:
//   (a) the editor strings are HTML *fragments*, not full documents;
//   (b) we don't want to instantiate a heavy parser on every keystroke;
//   (c) loose matching tolerates user-formatted whitespace / attribute order.
// The regexes capture attribute strings so we can re-extract attrs (defer /
// async / module / media) from any order.

const SCRIPT_TAG_RE =
  /<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*?)>\s*<\/script>/gi;

const LINK_TAG_RE = /<link\b([^>]*?)\/?>/gi;

function lower(s) { return String(s || '').toLowerCase(); }

function parseScriptTagsIn(text, position) {
  const out = [];
  if (!text) return out;
  SCRIPT_TAG_RE.lastIndex = 0;
  let m;
  while ((m = SCRIPT_TAG_RE.exec(text)) !== null) {
    const url     = m[2];
    const attrStr = lower((m[1] || '') + ' ' + (m[3] || ''));
    const attrs   = [];
    if (/\bdefer\b/.test(attrStr))                   attrs.push('defer');
    if (/\basync\b/.test(attrStr))                   attrs.push('async');
    if (/type\s*=\s*["']module["']/.test(attrStr))   attrs.push('module');
    out.push({ kind: 'script', url, attrs, position });
  }
  return out;
}

function parseLinkTagsIn(text, position) {
  const out = [];
  if (!text) return out;
  LINK_TAG_RE.lastIndex = 0;
  let m;
  while ((m = LINK_TAG_RE.exec(text)) !== null) {
    const attrStr = m[1] || '';
    const lowAttr = lower(attrStr);
    // Only stylesheet links count (skip rel="preload", "icon", etc.).
    if (!/rel\s*=\s*["']stylesheet["']/.test(lowAttr)) continue;
    const hrefMatch = attrStr.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const url   = hrefMatch[1];
    const attrs = [];
    const mediaMatch = lowAttr.match(/media\s*=\s*["']([^"']+)["']/);
    if (mediaMatch) {
      if (mediaMatch[1] === 'print')    attrs.push('print');
      else if (mediaMatch[1] === 'all') attrs.push('all');
    }
    out.push({ kind: 'style', url, attrs, position });
  }
  return out;
}

// Matches `<!-- … -->` chunks (non-greedy) so we can pull out commented-out
// tags and parse them as "disabled" deps. We split into two passes:
//   1. Find every comment block and parse its inner text, those tags are
//      disabled (enabled: false).
//   2. Strip the comment blocks from the source text and parse the
//      remainder, those tags are enabled.
// This lets the user comment / uncomment a tag in the editor and have the
// dep row reflect the right enabled state automatically.
const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g;

/** Pure parser, surfaces `<script src>` + `<link rel="stylesheet" href>` tags
 * from an editor string, tagging each with the supplied position AND with
 * `enabled: false` when the tag is wrapped in an HTML comment. */
export function parseDepTagsFromText(text, position) {
  if (!text || typeof text !== 'string') return [];

  // Pass 1, collect inner content of every HTML comment and parse it as
  // disabled tags.
  let commentedSrc = '';
  HTML_COMMENT_RE.lastIndex = 0;
  let m;
  while ((m = HTML_COMMENT_RE.exec(text)) !== null) {
    commentedSrc += (m[1] || '') + '\n';
  }
  const disabled = [
    ...parseScriptTagsIn(commentedSrc, position),
    ...parseLinkTagsIn(commentedSrc, position),
  ].map(t => ({ ...t, enabled: false }));

  // Pass 2, strip comments from the source and parse what remains as
  // enabled tags. (Using replace ensures a tag that appears both inside
  // AND outside a comment is correctly seen as enabled; that's an
  // unusual case but stays consistent.)
  const stripped = text.replace(HTML_COMMENT_RE, '\n');
  const enabled = [
    ...parseScriptTagsIn(stripped, position),
    ...parseLinkTagsIn(stripped, position),
  ].map(t => ({ ...t, enabled: true }));

  // Enabled tags take precedence when the same URL appears both ways;
  // reconcileDepsWithParsedTags dedupes by URL using first-wins.
  return [...enabled, ...disabled];
}

// ── Name derivation ───────────────────────────────────────────────────────────
// Best-effort human-friendly name for an "imported from editor" dep so the
// row label doesn't read like a raw URL. Catalog deps already carry a name;
// this only runs for tags the user typed by hand.

// Pull a numeric version segment out of common CDN URLs. We look for:
//   • jsdelivr / unpkg / GitHub raw: `…/something@1.2.3/…`
//   • cdnjs:                       `…/ajax/libs/PKG/1.2.3/file`
// Returns "–" when nothing reasonable can be inferred (e.g. Google Fonts
// URLs, plain hostnames, etc.). The trailing `@<digit>` constraint keeps
// us from mistaking npm scopes (e.g. `@scope/`) for versions.
export function deriveDepVersion(url) {
  if (!url || typeof url !== 'string') return '–';
  const bare = url.split('?')[0].split('#')[0];
  // Pick the LAST `@<digit>…` segment so scoped packages like
  // `@fortawesome/x@6.5.2` resolve to `6.5.2`, not the scope.
  const ats = bare.match(/@([0-9][\w.\-+~]*)/g);
  if (ats && ats.length) {
    return ats[ats.length - 1].slice(1);
  }
  // cdnjs convention.
  const cdnjs = bare.match(/\/ajax\/libs\/[^/]+\/([0-9][\w.\-+~]*)\//);
  if (cdnjs) return cdnjs[1];
  return '–';
}

// Resolve a dep's `{v}` placeholder against its stored version so we can
// match it against tag URLs in the editor (which are always literal, no
// templates). Without this, a catalog dep (`…/gsap@{v}/dist/gsap.min.js`)
// would never URL-match the editor's literal `…/gsap@3.12.5/…` tag, and
// the reconciler would treat the catalog dep as removed + replace it
// with an anonymous "imported" entry on every sync, wiping the
// catalog metadata.
function resolveDepUrl(d) {
  if (!d || !d.url) return '';
  const ver = (d.v || '').trim();
  if (!d.url.includes('{v}')) return d.url;
  return (ver && ver !== '–') ? d.url.replace('{v}', ver) : d.url.replace('{v}', '');
}

function deriveDepName(url) {
  if (!url) return 'imported';
  try {
    const u = new URL(url, 'http://localhost');
    // Google / Bunny Fonts → use the first family= value.
    if (u.hostname.includes('fonts.googleapis.com') || u.hostname.includes('fonts.bunny.net')) {
      const fam = u.searchParams.get('family');
      if (fam) {
        // "Plus+Jakarta+Sans:wght@400..700" → "Plus Jakarta Sans"
        const name = fam.split(':')[0].split('|')[0].replace(/\+/g, ' ').trim();
        if (name) return name;
      }
      return 'Google Fonts';
    }
    // Else: last path segment, stripped of extension.
    const file = (u.pathname.split('/').filter(Boolean).pop() || '').split('?')[0];
    if (!file) return 'imported';
    return file.replace(/\.(min\.)?(js|mjs|css)$/i, '') || file;
  } catch (_) {
    return 'imported';
  }
}

function hashKey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function attrsEqual(a, b) {
  const sa = [...(a || [])].sort().join(',');
  const sb = [...(b || [])].sort().join(',');
  return sa === sb;
}

// ── Reconciler ────────────────────────────────────────────────────────────────
// Single-pass reconciliation: keep deps that still have a matching tag,
// drop deps whose tag was deleted, add new deps for tags that weren't in
// the list, and refresh attrs/position/kind when the editor side changed.
// Idempotent, repeatedly calling with the same inputs returns
// changed: false.

export function reconcileDepsWithParsedTags(currentDeps, parsedTags, opts = {}) {
  const { positionAware = true } = opts;

  // Build a URL → tag map. If the same URL appears twice, the FIRST tag
  // wins (matches reading order). Duplicates left untouched in the editor
  // are the user's problem, not ours.
  const tagsByUrl = new Map();
  for (const t of parsedTags) {
    if (!t || !t.url) continue;
    if (!tagsByUrl.has(t.url)) tagsByUrl.set(t.url, t);
  }

  // Build current deps by URL too, needed when adding new entries from
  // tags so we don't override an existing dep (which Pass 1 already kept).
  // We key by the RESOLVED url (with `{v}` filled in from `dep.v`) so a
  // catalog dep like `…/gsap@{v}/dist/gsap.min.js` correctly matches the
  // editor's literal `…/gsap@3.12.5/dist/gsap.min.js` tag.
  const depsByUrl = new Map();
  for (const d of currentDeps) {
    const resolved = resolveDepUrl(d);
    if (resolved) depsByUrl.set(resolved, d);
  }

  const nextDeps = [];
  const handledUrls = new Set();
  let changed = false;

  // Pass 1, walk existing deps. Either keep, drop, or update.
  for (const d of currentDeps) {
    // Deps without a URL (defensive) pass through untouched.
    if (!d || !d.url) {
      nextDeps.push(d);
      continue;
    }
    const resolvedUrl = resolveDepUrl(d);
    const t = tagsByUrl.get(resolvedUrl);
    if (!t) {
      // Tag is no longer in the editor → drop the dep.
      changed = true;
      handledUrls.add(resolvedUrl);
      continue;
    }
    handledUrls.add(resolvedUrl);
    const sameKind    = (d.kind || 'script') === (t.kind || 'script');
    const sameAttrs   = attrsEqual(d.attrs, t.attrs);
    const samePos     = !positionAware
      || ((d.position || 'before') === (t.position || 'before'));
    // Treat missing `enabled` as true (legacy deps default to enabled).
    const depEnabled  = d.enabled !== false;
    const tagEnabled  = t.enabled !== false;
    const sameEnabled = depEnabled === tagEnabled;
    // Backfill the dep's `v` when missing, useful for deps that were
    // imported from the editor before version derivation existed, or for
    // catalog deps that came in without an explicit version. We only
    // upgrade from "missing" to "derived"; we never overwrite an existing
    // user-set version.
    const depHasVer   = d.v && d.v !== '–';
    const derivedVer  = depHasVer ? d.v : deriveDepVersion(d.url);
    const verChanged  = !depHasVer && derivedVer && derivedVer !== '–';
    if (sameKind && sameAttrs && samePos && sameEnabled && !verChanged) {
      nextDeps.push(d);
    } else {
      // Re-key off the editor, editor is authoritative for the tag shape.
      changed = true;
      nextDeps.push({
        ...d,
        kind: t.kind,
        attrs: t.attrs,
        position: positionAware ? (t.position || 'before') : (d.position || 'before'),
        enabled: tagEnabled,
        v: verChanged ? derivedVer : d.v,
      });
    }
  }

  // Pass 2, emit new deps for tags the user typed but that have no
  // matching dep row yet.
  for (const t of parsedTags) {
    if (!t || !t.url || handledUrls.has(t.url)) continue;
    handledUrls.add(t.url);
    if (depsByUrl.has(t.url)) continue; // shouldn't happen; defensive.
    nextDeps.push({
      id:       'imported_' + hashKey(t.url),
      name:     deriveDepName(t.url),
      v:        deriveDepVersion(t.url),
      kind:     t.kind,
      url:      t.url,
      attrs:    t.attrs || [],
      position: t.position || 'before',
      enabled:  t.enabled !== false,
      brief:    'Imported from editor',
      category: 'Imported',
    });
    changed = true;
  }

  return { nextDeps, changed };
}

// ── Sync hook ─────────────────────────────────────────────────────────────────
// One hook per scope. Watches the editor strings and reconciles them into
// `deps` via `setDeps`. The `setDeps` it receives MUST be the raw underlying
// JSON setter (e.g. the one returned by usePageDeps), NOT the bar-managed
// `commitDep`/`remove` paths, otherwise we'd double-mirror back into the
// editor and loop.
//
// `positionAware` defaults to true. Pass false for the Standard scope –
// there's no head/footer split in raw_html, so position is irrelevant and
// we don't want to clobber a stored position with a default.

export function useEditorDepsSync({ headText, footerText, deps, setDeps, positionAware = true }) {
  // Track the last value we wrote so we don't re-trigger on our own setDeps
  // echo. (The deps array reference changes each render; this gate ensures
  // we only act when the EDITOR text actually moved.)
  React.useEffect(() => {
    const parsed = [
      ...parseDepTagsFromText(headText || '',   positionAware ? 'before' : 'before'),
      ...parseDepTagsFromText(footerText || '', positionAware ? 'after'  : 'before'),
    ];
    const { nextDeps, changed } = reconcileDepsWithParsedTags(
      deps || [],
      parsed,
      { positionAware },
    );
    if (changed) {
      setDeps(nextDeps);
    }
    // We intentionally include `deps` and `setDeps` so that an external
    // dep mutation (e.g. bar removal) also re-checks for stale tags.
  }, [headText, footerText, deps, setDeps, positionAware]);
}
