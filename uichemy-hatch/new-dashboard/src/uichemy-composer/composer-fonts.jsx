// Discovers font families imported by the user via 3rd-party assets, custom
// CSS, or page/site-level code editors, so the Font Family dropdown can
// surface them alongside the curated list.
//
// Sources we scan:
//   1. raw_html              , <link href="https://fonts.googleapis.com/..."> tags
//   2. raw_css               , @import url(...), @font-face { font-family: ... }
//   3. page_custom_code_head  ┐
//   4. page_custom_code_footer├─ <link> tags + inline <style> blocks
//   5. site_custom_code_head  │
//   6. site_custom_code_footer┘
//   7. raw_deps_standard      ┐
//   8. raw_deps_page          ├─ stringified JSON containing dep URLs
//   9. raw_deps_site          ┘
//
// Recognised URL hosts: Google Fonts (fonts.googleapis.com) + Bunny Fonts
// (fonts.bunny.net), both of which use the same `?family=…` URL format.
// We accept BOTH the legacy v1 syntax (`family=Roboto|Open+Sans`) and the
// modern v2 syntax (`family=Roboto:wght@400;700&family=Inter:wght@300..700`).
//
// We deliberately do NOT load fonts ourselves, we only surface their names
// in the dropdown. The actual @font-face / <link> tag that makes the font
// renderable lives in whatever editor the user already imported it from.

import React from 'react';
import { useWidgetSetting } from './composer-elementor';

// Match any Google/Bunny Fonts URL and capture everything after the first
// `family=` up to whitespace, quotes, or angle brackets. Subsequent
// `family=` params (v2 syntax) are handled by a secondary split below.
const FONT_HOST_URL_RE =
  /https?:\/\/(?:fonts\.googleapis\.com|fonts\.bunny\.net)\/css2?\?([^\s"'<>)]+)/gi;

// Match @font-face declarations and capture the font-family value.
const FONT_FACE_RE =
  /@font-face\s*\{[^}]*?font-family\s*:\s*(['"]?)([^;'"}]+?)\1\s*[;}]/gi;

// Decode a "Family Name" segment from a Google/Bunny URL query value.
// "Roboto+Slab:wght@100..900" → "Roboto Slab"
// "Plus+Jakarta+Sans"         → "Plus Jakarta Sans"
function decodeFontFamilySegment(seg) {
  if (!seg) return '';
  // The name lives before the first colon (which introduces axis specs).
  const namePart = String(seg).split(':')[0] || '';
  // URL-decode then turn `+` into spaces.
  let name = '';
  try { name = decodeURIComponent(namePart); } catch (_) { name = namePart; }
  name = name.replace(/\+/g, ' ').trim();
  // Strip surrounding quotes the user might have left in.
  name = name.replace(/^['"]|['"]$/g, '').trim();
  return name;
}

// Parse a single URL query string (e.g. "family=Roboto&family=Inter:wght@400&display=swap").
// Returns array of decoded family names, in order.
function extractFamiliesFromQueryString(qs) {
  const out = [];
  if (!qs) return out;
  // Split on `&` and grab every `family=…` parameter.
  const params = qs.split('&');
  for (const p of params) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const key = p.slice(0, eq).toLowerCase();
    if (key !== 'family') continue;
    const raw = p.slice(eq + 1);
    // Legacy v1 syntax allows pipe-separated families in a single `family=`
    // param: family=Roboto|Open+Sans|Lato
    const parts = raw.split('|');
    for (const part of parts) {
      const name = decodeFontFamilySegment(part);
      if (name) out.push(name);
    }
  }
  return out;
}

/**
 * Pure parser, scan an arbitrary text blob (HTML, CSS, JSON, all of it
 * concatenated) and return a Set of discovered font family names.
 * Safe to call on any string; returns an empty Set for empty input.
 */
export function extractFontFamiliesFromText(text) {
  const found = new Set();
  if (!text || typeof text !== 'string') return found;

  // (a) Any Google/Bunny Fonts URL, works for <link href>, @import url(),
  //     and dep JSON entries alike since they all embed the same URL form.
  let m;
  FONT_HOST_URL_RE.lastIndex = 0;
  while ((m = FONT_HOST_URL_RE.exec(text)) !== null) {
    const names = extractFamiliesFromQueryString(m[1]);
    for (const n of names) found.add(n);
  }

  // (b) Local @font-face declarations, capture whatever name the author
  //     defined, even if the font file is hosted locally / on a private CDN.
  FONT_FACE_RE.lastIndex = 0;
  while ((m = FONT_FACE_RE.exec(text)) !== null) {
    const name = (m[2] || '').trim();
    if (name) found.add(name);
  }

  return found;
}

/**
 * Hook, returns a sorted, deduplicated array of font families currently
 * imported by the active widget through any of the supported channels.
 * Re-runs whenever any of the watched settings change.
 */
export function useImportedFontFamilies() {
  const [rawHtml]        = useWidgetSetting('raw_html');
  const [rawCss]         = useWidgetSetting('raw_css');
  const [pageHead]       = useWidgetSetting('page_custom_code_head');
  const [pageFooter]     = useWidgetSetting('page_custom_code_footer');
  const [siteHead]       = useWidgetSetting('site_custom_code_head');
  const [siteFooter]     = useWidgetSetting('site_custom_code_footer');
  const [depsStandard]   = useWidgetSetting('raw_deps_standard');
  const [depsPage]       = useWidgetSetting('raw_deps_page');
  const [depsSite]       = useWidgetSetting('raw_deps_site');

  return React.useMemo(() => {
    const blob = [
      rawHtml, rawCss,
      pageHead, pageFooter,
      siteHead, siteFooter,
      depsStandard, depsPage, depsSite,
    ].filter(Boolean).join('\n');
    const set = extractFontFamiliesFromText(blob);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rawHtml, rawCss, pageHead, pageFooter, siteHead, siteFooter, depsStandard, depsPage, depsSite]);
}

// ── Live preview injection ────────────────────────────────────────────────────
// The composer dropdown lists imported font NAMES, but the actual <link> /
// <style> that makes those fonts renderable lives in the user's published
// page output, which is not what Elementor's editor iframe sees. So when
// the user imports a font in the editor, nothing renders in the new family
// until they refresh. The functions below mirror the imported font sources
// into the live editor iframe `<head>` so font changes apply instantly.

// Match font-host URLs (Google + Bunny). Same hosts as the name extractor.
const FONT_HOST_URL_FULL_RE =
  /https?:\/\/(?:fonts\.googleapis\.com|fonts\.bunny\.net)\/css2?\?[^\s"'<>)]+/gi;

// Match @font-face blocks so self-hosted fonts work in the editor preview
// too (otherwise the dropdown would list the name but the family wouldn't
// resolve when the user picks it).
const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/gi;

/**
 * Extract the actual `<link href>` URLs and `@font-face` blocks the editor
 * iframe needs in order to render the imported fonts. Pure parser, safe to
 * call on any string.
 */
export function extractInjectableFontResources(text) {
  const links = new Set();
  const faces = [];
  if (!text || typeof text !== 'string') return { links: [], faces };

  let m;
  FONT_HOST_URL_FULL_RE.lastIndex = 0;
  while ((m = FONT_HOST_URL_FULL_RE.exec(text)) !== null) {
    // Decode `&amp;` etc. that the HTML editor might have stored (e.g. inside
    // a quoted <link href> attribute). The browser will encode again when
    // setting `.href`.
    let url = m[0].replace(/&amp;/g, '&');
    links.add(url);
  }

  FONT_FACE_BLOCK_RE.lastIndex = 0;
  while ((m = FONT_FACE_BLOCK_RE.exec(text)) !== null) {
    faces.push(m[0]);
  }

  return { links: Array.from(links), faces };
}

// Stable 32-bit hash → hex string. Used as the unique marker for each
// injected <style> tag so we can reconcile (add/remove) without thrashing
// the DOM on every keystroke.
function hashKey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

// Find every document we should mirror fonts into. The Elementor preview is
// always inside an iframe; some panel mounts also live inside the same
// iframe. We pick any document whose body already contains an
// `.elementor-element` (the surest signal that the preview has loaded).
function findPreviewDocs() {
  const out = [];
  if (typeof document === 'undefined') return out;
  const frames = Array.from(document.querySelectorAll('iframe'));
  for (const f of frames) {
    let d = null;
    try { d = f.contentDocument; } catch (_) { d = null; }
    if (!d || !d.head) continue;
    try {
      if (d.querySelector('.elementor-element')) out.push(d);
    } catch (_) {}
  }
  return out;
}

// Sync the desired set of font tags into a document head. Tagged with
// `data-uich-font-inject` so we never touch user-authored / Elementor-owned
// <link>/<style> tags and our own tags are reconciled cleanly.
function syncFontTagsInDoc(doc, resources) {
  const head = doc && doc.head;
  if (!head) return;

  const desired = new Map(); // key → { kind: 'link'|'face', value }
  for (const url of resources.links) {
    desired.set('L:' + url, { kind: 'link', value: url });
  }
  for (const css of resources.faces) {
    desired.set('F:' + hashKey(css), { kind: 'face', value: css });
  }

  // Pass 1, remove any tag we previously injected that's no longer wanted.
  const present = new Set();
  const existing = head.querySelectorAll('[data-uich-font-inject]');
  for (let i = 0; i < existing.length; i++) {
    const el  = existing[i];
    const key = el.getAttribute('data-uich-font-inject');
    if (!key || !desired.has(key)) {
      el.parentNode && el.parentNode.removeChild(el);
    } else {
      present.add(key);
    }
  }

  // Pass 2, add anything that's missing.
  for (const [key, item] of desired) {
    if (present.has(key)) continue;
    let el;
    if (item.kind === 'link') {
      el = doc.createElement('link');
      el.setAttribute('rel', 'stylesheet');
      el.setAttribute('href', item.value);
    } else {
      el = doc.createElement('style');
      el.textContent = item.value;
    }
    el.setAttribute('data-uich-font-inject', key);
    head.appendChild(el);
  }
}

/**
 * Hook, mounts a singleton effect that keeps the editor preview iframe's
 * <head> in sync with the user's imported fonts. Call ONCE somewhere that
 * lives for the lifetime of the panel (e.g. ComposerPanel root). Safe to be
 * called when no widget is active; it just no-ops until settings appear.
 */
export function useInjectImportedFontsIntoPreview() {
  const [rawHtml]      = useWidgetSetting('raw_html');
  const [rawCss]       = useWidgetSetting('raw_css');
  const [pageHead]     = useWidgetSetting('page_custom_code_head');
  const [pageFooter]   = useWidgetSetting('page_custom_code_footer');
  const [siteHead]     = useWidgetSetting('site_custom_code_head');
  const [siteFooter]   = useWidgetSetting('site_custom_code_footer');
  const [depsStandard] = useWidgetSetting('raw_deps_standard');
  const [depsPage]     = useWidgetSetting('raw_deps_page');
  const [depsSite]     = useWidgetSetting('raw_deps_site');

  const resources = React.useMemo(() => {
    const blob = [
      rawHtml, rawCss,
      pageHead, pageFooter,
      siteHead, siteFooter,
      depsStandard, depsPage, depsSite,
    ].filter(Boolean).join('\n');
    return extractInjectableFontResources(blob);
  }, [rawHtml, rawCss, pageHead, pageFooter, siteHead, siteFooter, depsStandard, depsPage, depsSite]);

  React.useEffect(() => {
    // The preview iframe may not be ready on first paint (Elementor mounts
    // it asynchronously and may rebuild it on widget operations). Re-sync
    // a few times in case the iframe document we found at t=0 has been
    // swapped out by then.
    let cancelled = false;
    function doSync() {
      if (cancelled) return;
      const docs = findPreviewDocs();
      for (const d of docs) syncFontTagsInDoc(d, resources);
    }
    doSync();
    const t1 = setTimeout(doSync, 200);
    const t2 = setTimeout(doSync, 1000);
    return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
  }, [resources]);
}

/**
 * Merge curated and imported font lists, preserving the curated order at the
 * top and appending imported fonts (alphabetised) underneath. Duplicates
 * (case-insensitive) are removed so a user-imported "Inter" doesn't show up
 * twice when the curated list also has "Inter".
 */
export function mergeFontFamilyOptions(curated, imported) {
  const seen = new Set();
  const out = [];
  const push = (name) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  (curated || []).forEach(push);
  (imported || []).forEach(push);
  return out;
}
