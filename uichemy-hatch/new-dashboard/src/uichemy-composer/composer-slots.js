// Slot helpers, text, anchor links, images, and SVG layers stay in sync with
// Elementor widget settings (slot_* keys in the widget panel).
import { resolveNodeByPath, normalizeUichemyTags, denormalizeUichemyTags } from './composer-layer-tree';
import { isSvgUrlValue } from './composer-svg-utils';

// Number of editable slots the composer syncs to/from the Elementor panel
// controls. MUST stay in sync with the SLOT_COUNT class constant in
// includes/admin/widgets/class-uichemy-composer-widget.php, which pre-registers
// exactly this many slot_* / bgslot_* controls.
export const SLOT_COUNT = 60;
const INLINE_SLOT_TAGS = new Set(['A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'LABEL', 'BUTTON']);
const IGNORE_SLOT_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE']);
// Void / empty-content elements, never count as "block content" inside an <a>
// (e.g. <a>line1<br>line2</a> must stay a single text slot, not a link wrapper).
const VOID_SLOT_TAGS = new Set([
  'BR', 'WBR', 'HR', 'AREA', 'BASE', 'COL', 'EMBED', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK',
]);

export const EMPTY_LINK = Object.freeze({
  url: '',
  is_external: '',
  nofollow: '',
  custom_attributes: '',
});

export const EMPTY_MEDIA = Object.freeze({ url: '', id: '' });

/** Normalize Elementor MEDIA control values (`{ url, id }`). */
export function normalizeMediaValue(raw) {
  if (raw && typeof raw === 'object') {
    return {
      url: String(raw.url || '').trim(),
      id: raw.id != null && raw.id !== '' ? raw.id : '',
    };
  }
  const str = String(raw || '').trim();
  if (str) return { url: str, id: '' };
  return { url: '', id: '' };
}

export function getMediaUrl(raw) {
  return normalizeMediaValue(raw).url;
}

/** @param {string} raw */
export function normalizeLinkValue(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    url: String(src.url || '').trim(),
    is_external: src.is_external === 'on' ? 'on' : '',
    nofollow: src.nofollow === 'on' ? 'on' : '',
    custom_attributes: String(src.custom_attributes || '').trim(),
  };
}

/** Read link fields from an `<a>` element's DOM attributes. */
export function readLinkFromAnchor(anchor) {
  if (!anchor || anchor.nodeType !== 1 || String(anchor.tagName || '').toUpperCase() !== 'A') {
    return { ...EMPTY_LINK };
  }
  const rel = String(anchor.getAttribute('rel') || '');
  return {
    url: anchor.getAttribute('href') || '',
    is_external: anchor.getAttribute('target') === '_blank' ? 'on' : '',
    nofollow: rel.toLowerCase().includes('nofollow') ? 'on' : '',
    custom_attributes: '',
  };
}

export function parseCustomAttributes(customAttributesRaw) {
  const raw = String(customAttributesRaw || '').trim();
  if (!raw) return [];
  const rows = raw
    .split(/\r?\n|\|\|/)
    .map((row) => String(row || '').trim())
    .filter(Boolean);
  const out = [];
  rows.forEach((row) => {
    let key = '';
    let value = '';
    if (row.includes('|')) {
      const pair = row.split('|');
      key = String((pair.shift() || '')).trim();
      value = String(pair.join('|') || '').trim();
    } else if (row.includes('=')) {
      const idx = row.indexOf('=');
      key = String(row.slice(0, idx) || '').trim();
      value = String(row.slice(idx + 1) || '').trim();
    } else {
      key = String(row || '').trim();
      value = '';
    }
    if (!key || /[\s"'`=<>]/.test(key)) return;
    value = value.replace(/^['"]|['"]$/g, '');
    out.push({ key, value });
  });
  return out;
}

export function applyCustomAttributesToAnchor(anchor, customAttributesRaw) {
  if (!anchor || anchor.nodeType !== 1 || String(anchor.tagName || '').toUpperCase() !== 'A') return;
  parseCustomAttributes(customAttributesRaw).forEach((entry) => {
    if (!entry || !entry.key) return;
    anchor.setAttribute(entry.key, entry.value);
  });
}

/** Apply widget link object onto an anchor element (href / target / rel / custom attrs). */
export function applyLinkToAnchor(anchor, link) {
  if (!anchor || anchor.nodeType !== 1 || String(anchor.tagName || '').toUpperCase() !== 'A') return;
  const next = normalizeLinkValue(link);
  if (next.url) anchor.setAttribute('href', next.url);
  else anchor.removeAttribute('href');

  if (next.is_external === 'on') anchor.setAttribute('target', '_blank');
  else anchor.removeAttribute('target');

  if (next.nofollow === 'on') {
    const rels = String(anchor.getAttribute('rel') || '')
      .split(' ')
      .map((r) => String(r || '').trim())
      .filter((r) => r && r.toLowerCase() !== 'nofollow');
    rels.push('nofollow');
    anchor.setAttribute('rel', rels.join(' ').trim());
  } else {
    const rels = String(anchor.getAttribute('rel') || '')
      .split(' ')
      .map((r) => String(r || '').trim())
      .filter((r) => r && r.toLowerCase() !== 'nofollow')
      .join(' ')
      .trim();
    if (rels) anchor.setAttribute('rel', rels);
    else anchor.removeAttribute('rel');
  }

  applyCustomAttributesToAnchor(anchor, next.custom_attributes);
}

/** @returns {'text'|'anchor'|'image'|'svg'|null} */
export function getSlotKind(node) {
  if (!node) return null;
  if (node.nodeType === 3) return 'text';
  if (node.nodeType !== 1) return null;
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'A') return 'anchor';
  if (tag === 'IMG') {
    // img[data-as="svg"] was originally a <svg> tag, keep it as SVG slot.
    // Any other <img> is always an image slot, even if src points to a .svg file.
    if (node.getAttribute('data-as') === 'svg') return 'svg';
    return 'image';
  }
  if (tag === 'SVG') return 'svg';
  if (INLINE_SLOT_TAGS.has(tag)) return 'text';
  return null;
}

/**
 * True when an <a> wraps content that becomes its own slots, nested <img>/<svg>
 * media, or block elements like <h1>/<div>/<p> that carry text. Such an anchor
 * is a link wrapper: its own direct text is the Link Text, and its children are
 * extracted as separate slots. A plain <a> with only inline text (or inline
 * formatting like <b>/<span>) stays a single anchor text slot.
 */
export function anchorWrapsSlotContent(node) {
  if (!node || node.nodeType !== 1) return false;
  if (String(node.tagName || '').toUpperCase() !== 'A') return false;
  if (typeof node.querySelectorAll !== 'function') return false;
  const descendants = node.querySelectorAll('*');
  for (let i = 0; i < descendants.length; i++) {
    const t = String(descendants[i].tagName || '').toUpperCase();
    if (t.startsWith('UICHEMY-') || IGNORE_SLOT_TAGS.has(t)) continue;
    if (t === 'IMG' || t === 'SVG') return true; // nested media
    // A block-level element (h1/div/p/…) breaks out into its own slot. This is
    // based on STRUCTURE, not text, so emptying that element's text does not
    // collapse the anchor back to a plain text slot (which would wipe the block).
    if (!INLINE_SLOT_TAGS.has(t) && !VOID_SLOT_TAGS.has(t)) return true;
  }
  return false;
}

/**
 * True when a NON-anchor inline slot element (button/label/span/…) wraps content
 * that must become its own slots, nested <img>/<svg> media, or block elements
 * like <div>/<h1>/<p> that carry their own text. Mirrors anchorWrapsSlotContent
 * (minus the link-specific handling) so e.g. <button><div>…</div></button>
 * exposes the inner block as an editable slot instead of collapsing the whole
 * button into a single text slot (which hides edits to the nested block).
 */
export function inlineWrapsBlockContent(node) {
  if (!node || node.nodeType !== 1) return false;
  if (typeof node.querySelectorAll !== 'function') return false;
  const descendants = node.querySelectorAll('*');
  for (let i = 0; i < descendants.length; i++) {
    const t = String(descendants[i].tagName || '').toUpperCase();
    if (t.startsWith('UICHEMY-') || IGNORE_SLOT_TAGS.has(t)) continue;
    if (t === 'IMG' || t === 'SVG') return true; // nested media
    if (!INLINE_SLOT_TAGS.has(t) && !VOID_SLOT_TAGS.has(t)) return true; // block content
  }
  return false;
}

/** Set an anchor's text without removing element children (nested media/blocks). */
function setAnchorTextPreservingChildren(node, text) {
  if (!node || node.nodeType !== 1) return;
  const safe = String(text == null ? '' : text);
  // Collect the anchor's DIRECT text-node children.
  const textNodes = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    if (node.childNodes[i].nodeType === 3) textNodes.push(node.childNodes[i]);
  }
  if (safe.trim() === '') {
    // Empty link text, drop all stray text nodes, keep the media/block children.
    textNodes.forEach((t) => node.removeChild(t));
    return;
  }
  if (textNodes.length === 0) {
    const doc = node.ownerDocument || document;
    node.insertBefore(doc.createTextNode(safe), node.firstChild);
    return;
  }
  // Consolidate to exactly ONE text node: set the first (preserves its position
  // relative to the media/block) to the full value and drop the rest. This keeps
  // read (getDirectTextValue) and write in sync, otherwise leftover text nodes
  // get concatenated on read and corrupt spacing while typing the Link Text.
  textNodes[0].nodeValue = safe;
  for (let i = 1; i < textNodes.length; i++) node.removeChild(textNodes[i]);
}

export function readSvgSlotFromNode(node) {
  if (!node || node.nodeType !== 1) {
    return { svgMode: 'code', svgUrl: '', svgCode: '' };
  }
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'IMG') {
    // img[data-as="svg"] or legacy img src="*.svg"
    return { svgMode: 'url', svgUrl: node.getAttribute('src') || '', svgCode: '' };
  }
  if (tag !== 'SVG') {
    return { svgMode: 'code', svgUrl: '', svgCode: '' };
  }
  const sourceUrl = String(node.getAttribute('data-uc-svg-source') || '').trim();
  const imageEl = node.querySelector('image');
  const imageHref = imageEl
    ? (imageEl.getAttribute('href')
      || imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      || '')
    : '';
  const url = sourceUrl || String(imageHref || '').trim();
  if (url) return { svgMode: 'url', svgUrl: url, svgCode: '' };
  return { svgMode: 'code', svgUrl: '', svgCode: node.outerHTML || '' };
}

/** Snapshot of widget-facing values for one slot node. */
export function readSlotStateFromNode(node) {
  const kind = getSlotKind(node);
  if (!kind) return null;
  if (kind === 'anchor') {
    return {
      kind,
      // Link Text = the anchor's OWN text. For a link-wrapper <a> (one wrapping
      // a heading/block or media), use only its direct text nodes so nested
      // content like an <h1>'s text never leaks into the Link Text. A plain
      // inline anchor keeps its full textContent (incl. <b>/<span> formatting).
      text: anchorWrapsSlotContent(node) ? getDirectTextValue(node) : getSlotTextValue(node),
      link: readLinkFromAnchor(node),
      isLink: true,
      isImage: false,
      isSvg: false,
      svgMode: '',
      imageUrl: '',
      imageAlt: '',
      svgUrl: '',
      svgCode: '',
    };
  }
  if (kind === 'image') {
    return {
      kind,
      text: '',
      link: null,
      isLink: false,
      isImage: true,
      isSvg: false,
      svgMode: '',
      imageUrl: node.getAttribute('src') || '',
      imageAlt: node.getAttribute('alt') || '',
      svgUrl: '',
      svgCode: '',
    };
  }
  if (kind === 'svg') {
    const svg = readSvgSlotFromNode(node);
    return {
      kind,
      text: '',
      link: null,
      isLink: false,
      isImage: false,
      isSvg: true,
      svgMode: svg.svgMode,
      imageUrl: '',
      imageAlt: '',
      svgUrl: svg.svgUrl,
      svgCode: svg.svgCode,
    };
  }
  return {
    kind: 'text',
    text: getSlotTextValue(node),
    link: null,
    isLink: false,
    isImage: false,
    isSvg: false,
    svgMode: '',
    imageUrl: '',
    imageAlt: '',
    svgUrl: '',
    svgCode: '',
  };
}

/**
 * Strip ONLY HTML formatting whitespace (indentation / newlines) at the edges –
 * runs that contain a line break. Plain spaces the user typed in a slot (incl.
 * trailing or double spaces) are preserved so the panel value round-trips
 * cleanly instead of being clobbered mid-typing.
 */
function stripFormattingEdges(str) {
  return String(str || '').replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, '');
}

export function getSlotTextValue(node) {
  if (!node) return '';
  const raw = node.nodeType === 3 ? node.nodeValue : node.textContent;
  return stripFormattingEdges(raw);
}

/** Concatenated value of an element's DIRECT text-node children only (no descendants). */
function getDirectTextValue(node) {
  if (!node || !node.childNodes) return '';
  let out = '';
  for (let i = 0; i < node.childNodes.length; i++) {
    if (node.childNodes[i].nodeType === 3) out += node.childNodes[i].nodeValue || '';
  }
  return stripFormattingEdges(out);
}

function applySvgUrlToNode(node, url) {
  if (!node || node.nodeType !== 1) return;
  const nextUrl = String(url || '').trim();
  const tag = String(node.tagName || '').toUpperCase();

  if (tag === 'SVG') {
    if (nextUrl) {
      // Replace <svg> with <img data-as="svg" src="URL"> in its parent.
      if (!node.parentNode) return;
      const doc = node.ownerDocument || document;
      const imgNode = doc.createElement('img');
      imgNode.setAttribute('data-as', 'svg');
      imgNode.setAttribute('src', nextUrl);
      // Carry over class / style / id / width / height from the old <svg>.
      ['class', 'style', 'id', 'width', 'height'].forEach((attr) => {
        const val = node.getAttribute(attr);
        if (val) imgNode.setAttribute(attr, val);
      });
      node.parentNode.replaceChild(imgNode, node);
    } else {
      // URL cleared, remove all children and all attributes to leave a clean empty plain <svg> tag.
      while (node.firstChild) {
        node.removeChild(node.firstChild);
      }
      while (node.attributes.length > 0) {
        node.removeAttribute(node.attributes[0].name);
      }
    }
  } else if (tag === 'IMG') {
    if (nextUrl) {
      // Already <img data-as="svg"> or legacy <img src="*.svg">, update src.
      node.setAttribute('src', nextUrl);
      if (!node.getAttribute('data-as')) node.setAttribute('data-as', 'svg');
    } else {
      // URL cleared, replace with a clean empty plain <svg> tag.
      if (!node.parentNode) return;
      const doc = node.ownerDocument || document;
      const svgNode = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      node.parentNode.replaceChild(svgNode, node);
    }
  }
}

function applySvgCodeToNode(node, markup) {
  if (!node || node.nodeType !== 1) return false;
  const trimmed = String(markup || '').trim();
  if (!trimmed || !/^<(svg|img)[\s>]/i.test(trimmed)) return false;
  const parsedWrap = document.createElement('div');
  parsedWrap.innerHTML = trimmed;
  const nextNode = parsedWrap.querySelector('svg, img');
  if (!nextNode) return false;
  const tag = String(node.tagName || '').toUpperCase();
  const isSvgImgNode = tag === 'IMG' && (
    node.getAttribute('data-as') === 'svg' ||
    isSvgUrlValue(node.getAttribute('src') || '')
  );
  if (tag === 'SVG' || isSvgImgNode) {
    node.replaceWith(nextNode.cloneNode(true));
    return true;
  }
  return false;
}

/** Apply widget slot settings onto a live DOM slot node (preview / reverse sync). */
export function applySlotSettingsToNode(node, settings, slotIndex) {
  if (!node || !settings || typeof settings.get !== 'function') return;
  const kind = getSlotKind(node);
  if (!kind) return;

  // Anchor wrapping media/block content: update its own text (the Link Text)
  // WITHOUT touching the nested children, then apply the link URL/attributes.
  // Writing textContent here would wipe the nested media/heading, so use a
  // child-preserving setter.
  if (kind === 'anchor' && anchorWrapsSlotContent(node)) {
    // Link Text is the SOLE source for a link-wrapper anchor's own text, no
    // slot_${i} fallback, so clearing the field actually removes the text.
    // Only overwrite once the composer has actually derived this slot
    // (slot_${i}_visible is set 'yes' by syncSlotSettingsFromNode), before
    // that, the field is still at its control default ('') and writing it
    // would blank text that was never actually cleared by the user.
    if (settings.get(`slot_${slotIndex}_visible`) === 'yes') {
      const linkText = settings.get(`slot_${slotIndex}_link_text`);
      setAnchorTextPreservingChildren(node, linkText == null ? '' : String(linkText));
    }
    applyLinkToAnchor(node, normalizeLinkValue(settings.get(`slot_${slotIndex}_link`) || {}));
    return;
  }

  if (kind === 'image') {
    const url = getMediaUrl(settings.get(`slot_${slotIndex}_image`));
    if (url) node.setAttribute('src', url);
    else node.removeAttribute('src');
    const alt = String(settings.get(`slot_${slotIndex}_image_alt`) || '');
    if (alt) node.setAttribute('alt', alt);
    else node.removeAttribute('alt');
    return;
  }

  if (kind === 'svg') {
    const svgMode = String(settings.get(`slot_${slotIndex}_svg_mode`) || 'code');
    if (svgMode === 'url') {
      const url = getMediaUrl(settings.get(`slot_${slotIndex}_svg_url`));
      applySvgUrlToNode(node, url);
      return;
    }
    const code = String(settings.get(`slot_${slotIndex}_svg_code`) || '').trim();
    if (code) applySvgCodeToNode(node, code);
    return;
  }

  let textVal;
  if (kind === 'anchor') {
    const linkText = settings.get(`slot_${slotIndex}_link_text`);
    textVal = (linkText != null && String(linkText).trim() !== '')
      ? linkText
      : settings.get(`slot_${slotIndex}`);
  } else {
    textVal = settings.get(`slot_${slotIndex}`);
  }
  if (textVal == null) textVal = '';
  let safeVal = String(textVal);
  if (safeVal.trim() === '' && (node.nodeType === 3 || kind === 'anchor')) safeVal = '\u200B';
  if (node.nodeType === 3) node.nodeValue = safeVal;
  else node.textContent = safeVal;

  if (kind === 'anchor') {
    const linkVal = normalizeLinkValue(settings.get(`slot_${slotIndex}_link`) || {});
    applyLinkToAnchor(node, linkVal);
  }
}

/** Push parsed slot node state into Elementor widget settings. */
export function syncSlotSettingsFromNode(settings, slotIndex, node, panel, dynamics = {}) {
  if (!settings || typeof settings.set !== 'function' || !node) return;
  const state = readSlotStateFromNode(node);
  if (!state) return;

  const visibleKey = `slot_${slotIndex}_visible`;
  const isLinkKey = `slot_${slotIndex}_is_link`;
  const isImageKey = `slot_${slotIndex}_is_image`;
  const isSvgKey = `slot_${slotIndex}_is_svg`;
  const isDynamicKey = `slot_${slotIndex}_is_dynamic`;
  const linkIsDynamicKey = `slot_${slotIndex}_link_is_dynamic`;
  const slotKey = `slot_${slotIndex}`;
  const linkKey = `slot_${slotIndex}_link`;
  const imageKey = `slot_${slotIndex}_image`;
  const imageAltKey = `slot_${slotIndex}_image_alt`;
  const svgModeKey = `slot_${slotIndex}_svg_mode`;
  const svgCodeKey = `slot_${slotIndex}_svg_code`;
  const svgCodeMediaKey = `slot_${slotIndex}_svg_code_media`;
  const svgUrlKey = `slot_${slotIndex}_svg_url`;

  // A `{{ … }}` / `{% … %}` src is a dynamic-data token, not a URL, so this is
  // not a static image slot. Storing the token in the MEDIA control would make
  // the PHP render emit it verbatim as the src the moment the markup stops being
  // dynamic, has_dynamic() goes false, the slot pass runs again, and the browser
  // requests the literal "{{ post.thumbnail.src('large') }}". Leaving is_image
  // 'no' makes apply_slot_settings_to_node() bail and defer to raw_html, which
  // is correct both while Twig resolves the token and after it's replaced.
  const isTokenImage = state.isImage && /\{\{|\{%/.test(String(state.imageUrl || ''));
  const isStaticImage = state.isImage && !isTokenImage;

  // Same reasoning as isTokenImage, applied to text and link URLs. A `{{ … }}`
  // value is data bound at render time and a `{% … %}` one is loop/condition
  // scaffolding ({% for %}, {% else %}, {% endfor %}) that emits nothing at
  // all, neither is content anyone can meaningfully type over, and a loop card
  // produced a dozen such slots that buried the handful of real editable ones.
  // Flag them so the panel controls hide. The value itself is still written to
  // the setting below exactly as before, so PHP's slot pass round-trips it
  // unchanged and Twig resolves it the same way it always did.
  const hasTwig = (val) => /\{\{|\{%/.test(String(val == null ? '' : val));
  const isDynamicText = hasTwig(state.text);
  const isDynamicLinkUrl = !!(state.link && hasTwig(state.link.url));

  settings.set(visibleKey, 'yes');
  settings.set(isLinkKey, state.isLink ? 'yes' : 'no');
  settings.set(isImageKey, isStaticImage ? 'yes' : 'no');
  settings.set(isSvgKey, state.isSvg ? 'yes' : 'no');
  settings.set(isDynamicKey, isDynamicText ? 'yes' : 'no');
  settings.set(linkIsDynamicKey, isDynamicLinkUrl ? 'yes' : 'no');
  triggerSettingChange(settings, visibleKey);
  triggerSettingChange(settings, isLinkKey);
  triggerSettingChange(settings, isImageKey);
  triggerSettingChange(settings, isSvgKey);
  triggerSettingChange(settings, isDynamicKey);
  triggerSettingChange(settings, linkIsDynamicKey);

  const linkTextKey = `slot_${slotIndex}_link_text`;
  if (!state.isImage && !state.isSvg) {
    if (state.isLink) {
      const isDynamicLinkText = !!(dynamics[linkTextKey] && dynamics[linkTextKey] !== '');
      if (!isDynamicLinkText) {
        settings.set(linkTextKey, state.text);
        if (panel) syncPanelControl(panel, linkTextKey, state.text);
      }
    } else if (!(dynamics[slotKey] && dynamics[slotKey] !== '')) {
      settings.set(slotKey, state.text);
      if (panel) syncPanelControl(panel, slotKey, state.text);
    }
  }

  if (state.isLink) {
    const isDynamicLink = !!(dynamics[linkKey] && dynamics[linkKey] !== '');
    if (!isDynamicLink) {
      const oldLink = settings.get(linkKey) || {};
      const nextLink = {
        ...normalizeLinkValue(state.link),
        custom_attributes: oldLink.custom_attributes || '',
      };
      settings.set(linkKey, nextLink);
    }
  }

  if (isStaticImage) {
    const prevMedia = normalizeMediaValue(settings.get(imageKey));
    const nextMedia = normalizeMediaValue({
      url: state.imageUrl,
      id: prevMedia.url === state.imageUrl ? prevMedia.id : '',
    });
    settings.set(imageKey, nextMedia);
    settings.set(imageAltKey, state.imageAlt);
    if (panel) {
      syncPanelMediaControl(panel, imageKey, nextMedia);
      syncPanelControl(panel, imageAltKey, state.imageAlt);
    }
    triggerSettingChange(settings, imageKey);
    triggerSettingChange(settings, imageAltKey);
  }

  if (state.isSvg) {
    const mode = state.svgMode || 'code';
    const isDynamicSvgCodeMedia = !!(dynamics[svgCodeMediaKey] && dynamics[svgCodeMediaKey] !== '');
    settings.set(svgModeKey, mode);
    if (panel) syncPanelControl(panel, svgModeKey, mode);
    triggerSettingChange(settings, svgModeKey);

    if (mode === 'url') {
      const prevSvgMedia = normalizeMediaValue(settings.get(svgUrlKey));
      const nextSvgMedia = normalizeMediaValue({
        url: state.svgUrl,
        id: prevSvgMedia.url === state.svgUrl ? prevSvgMedia.id : '',
      });
      settings.set(svgUrlKey, nextSvgMedia);
      settings.set(svgCodeKey, '');
      settings.set(svgCodeMediaKey, { ...EMPTY_MEDIA });
      if (panel) {
        syncPanelMediaControl(panel, svgUrlKey, nextSvgMedia);
        syncPanelMediaControl(panel, svgCodeMediaKey, EMPTY_MEDIA);
      }
      triggerSettingChange(settings, svgUrlKey);
      triggerSettingChange(settings, svgCodeKey);
      triggerSettingChange(settings, svgCodeMediaKey);
    } else {
      settings.set(svgCodeKey, state.svgCode);
      settings.set(svgUrlKey, { ...EMPTY_MEDIA });
      if (!isDynamicSvgCodeMedia) {
        const codePreviewMedia = buildSvgCodeMediaPreview(state.svgCode);
        settings.set(svgCodeMediaKey, codePreviewMedia);
        if (panel) syncPanelMediaControl(panel, svgCodeMediaKey, codePreviewMedia);
      }
      if (panel) syncPanelMediaControl(panel, svgUrlKey, EMPTY_MEDIA);
      triggerSettingChange(settings, svgCodeKey);
      triggerSettingChange(settings, svgUrlKey);
      triggerSettingChange(settings, svgCodeMediaKey);
    }
  }
}

// ── Background-image slots ───────────────────────────────────────────────────
// Elements can carry their background image via CSS (raw_css class rules) or an
// inline style attribute (Inspector "Local" scope, stored in raw_html), so they
// never appear in the node-driven slot list. These helpers surface each
// `background-image: url(...)` as a Media-panel slot (bgslot_*). The source
// (raw_html / raw_css) stays the single source of truth: picking an image
// rewrites the url() back into it.

/**
 * Scan a CSS string and return, in document order, every background-image /
 * background declaration whose value contains a real url(...). Quote- and
 * paren-aware so `;`/`{`/`}` inside a data: URI or url() token are not mistaken
 * for structural delimiters. Each entry records the owning selector plus the
 * absolute [tokenStart, tokenEnd) range of the url() token for in-place rewrite.
 * @returns {{selector:string,url:string,prop:string,tokenStart:number,tokenEnd:number}[]}
 */
export function extractBgImageDecls(css) {
  const src = String(css || '');
  const out = [];
  if (!src) return out;
  const selStack = [];
  let buf = '';
  let bufStart = 0;
  let inStr = '';
  let paren = 0;

  const collect = (rawBuf, rawStart, termIdx, termChar) => {
    const trimmed = String(rawBuf || '').trim();
    if (!trimmed) return;
    const ci = trimmed.indexOf(':');
    if (ci < 0) return;
    const prop = trimmed.slice(0, ci).trim().toLowerCase();
    if (prop !== 'background-image' && prop !== 'background') return;
    const m = /url\(\s*(['"]?)([^'")]*)\1\s*\)/i.exec(rawBuf);
    if (!m) return;
    const url = String(m[2] || '').trim();
    if (!url) return;
    out.push({
      selector: selStack.length ? selStack[selStack.length - 1] : '',
      url,
      prop,
      // True when nested inside an at-rule (@media/@supports): such a rule is
      // conditional, so it must not be treated as the element's applied value.
      isMedia: selStack.slice(0, -1).some((s) => s.trim().charAt(0) === '@'),
      // Carries a `!important` flag, a higher cascade tier than a normal
      // declaration, so an !important class rule beats a normal inline one.
      important: /!\s*important/i.test(rawBuf),
      tokenStart: rawStart + m.index,
      tokenEnd: rawStart + m.index + m[0].length,
      // Full declaration span [declStart, declEnd) and whether it ends with a
      // ';', used to delete the whole declaration when the image is cleared
      // (writing url("") would instead override the cascade with an empty image).
      declStart: rawStart,
      declEnd: termIdx,
      declSemicolon: termChar === ';',
    });
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (buf === '') bufStart = i;
    if (inStr) {
      buf += ch;
      if (ch === inStr && src[i - 1] !== '\\') inStr = '';
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; buf += ch; continue; }
    if (ch === '(') { paren++; buf += ch; continue; }
    if (ch === ')') { if (paren > 0) paren--; buf += ch; continue; }
    if (paren === 0 && (ch === '{' || ch === '}' || ch === ';')) {
      if (ch === '{') {
        selStack.push(buf.trim());
      } else {
        collect(buf, bufStart, i, ch);
        if (ch === '}') selStack.pop();
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

/** Rewrite the url() of the Nth (index) background-image declaration in `css`. */
export function rewriteBgImageUrl(css, index, newUrl) {
  const src = String(css || '');
  const decls = extractBgImageDecls(src);
  if (index < 0 || index >= decls.length) return src;
  const d = decls[index];
  const safe = String(newUrl || '').replace(/["\\]/g, '\\$&');
  return `${src.slice(0, d.tokenStart)}url("${safe}")${src.slice(d.tokenEnd)}`;
}

/** Background-image url() inside a plain inline `style` string (no selectors). */
function extractBgUrlFromStyle(styleText) {
  const decls = extractBgImageDecls(`x{${String(styleText || '')}}`);
  return decls.length ? decls[0].url : '';
}

/** Inline background image with its `!important` flag, or null. */
function extractInlineBg(styleText) {
  const decls = extractBgImageDecls(`x{${String(styleText || '')}}`);
  return decls.length ? { url: decls[0].url, important: !!decls[0].important } : null;
}

// Cascade tier for a background declaration: !important outranks normal, and an
// inline declaration outranks a class rule of the same importance. Higher wins.
function bgCascadeTier(important, isInline) {
  return (important ? 2 : 0) + (isInline ? 1 : 0);
}

/**
 * Inline-style background images, in DOM order. The Inspector's Local scope
 * writes a background image onto the element's `style` attribute inside raw_html
 * (not raw_css), so those must be surfaced too. `elIndex` is the element's
 * querySelectorAll('*') position, stable across re-parses of the same raw_html.
 * @returns {{url:string,elIndex:number,selector:string}[]}
 */
export function extractInlineBgImages(rawHtml) {
  const out = [];
  const html = String(rawHtml || '');
  if (!html) return out;
  const container = document.createElement('div');
  container.innerHTML = html;
  const els = container.querySelectorAll('*');
  for (let i = 0; i < els.length; i++) {
    const style = els[i].getAttribute ? els[i].getAttribute('style') : '';
    if (!style) continue;
    const url = extractBgUrlFromStyle(style);
    if (url) out.push({ url, elIndex: i, selector: 'inline' });
  }
  return out;
}

/**
 * The ordered list of background-image slots for a widget, resolved to what is
 * actually APPLIED per element (the CSS cascade winner) so an element never
 * shows two slots for the same background:
 *   • An inline-style background (Local scope) wins over class rules, so the
 *     element's class-rule background is suppressed.
 *   • Otherwise the last matching non-@media class rule is used.
 *   • A class rule that is fully overridden by inline on every element it
 *     matches is dropped; one that matches no element is still surfaced (so a
 *     genuinely-applied rule is never hidden by an over-eager match check).
 * Slots are emitted in element (DOM) order. Order defines each slot's index.
 */
export function extractBgImageSlots(rawHtml, rawCss) {
  const rules = extractBgImageDecls(rawCss).filter((r) => !r.isMedia);
  const html = String(rawHtml || '');
  const slots = [];
  const cssSlot = (r) => ({
    url: r.url, selector: r.selector, source: 'css',
    tokenStart: r.tokenStart, tokenEnd: r.tokenEnd,
    declStart: r.declStart, declEnd: r.declEnd, declSemicolon: r.declSemicolon,
  });
  if (!html) {
    // No markup to resolve against, surface the CSS rules as-is.
    return rules.map(cssSlot);
  }
  const container = document.createElement('div');
  container.innerHTML = html;
  const els = container.querySelectorAll('*');
  const matchedTokens = new Set();
  const usedTokens = new Set();
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    // All matching class rules (any is recorded as "matched" so a fully
    // overridden rule can be dropped from the orphan pass later).
    const matches = [];
    for (let r = 0; r < rules.length; r++) {
      let hit = false;
      try { hit = el.matches(rules[r].selector); } catch (e) { hit = false; }
      if (hit) { matches.push(rules[r]); matchedTokens.add(rules[r].tokenStart); }
    }
    const styleAttr = el.getAttribute ? (el.getAttribute('style') || '') : '';
    const inlineBg = styleAttr ? extractInlineBg(styleAttr) : null;

    // Resolve the cascade winner: highest tier wins; among equal tiers a later
    // class rule beats an earlier one (source-order approximation of the
    // cascade). Inline is seeded first so a class rule needs an equal-or-higher
    // tier to override it.
    let best = null;
    let bestTier = -1;
    if (inlineBg) {
      best = { source: 'inline', url: inlineBg.url, elIndex: i, selector: 'inline' };
      bestTier = bgCascadeTier(inlineBg.important, true);
    }
    for (let r = 0; r < matches.length; r++) {
      const tier = bgCascadeTier(matches[r].important, false);
      if (tier >= bestTier) { best = cssSlot(matches[r]); bestTier = tier; }
    }
    if (!best) continue;
    if (best.source === 'inline') {
      slots.push(best);
    } else if (!usedTokens.has(best.tokenStart)) {
      usedTokens.add(best.tokenStart);
      slots.push(best);
    }
  }
  // Rules that match NO element are intentionally not surfaced: a Media-panel
  // background slot should appear only when its selector actually applies to an
  // element in the markup (e.g. the class is added to an element). A class rule
  // sitting in the CSS whose class was never used on any element must not show.
  return slots;
}

/**
 * Delete a whole declaration from a CSS/style source, given its span. Consumes
 * the trailing `;` when present; otherwise strips a preceding `;` so no dangling
 * separator is left. Used when an image is cleared, removing the declaration
 * lets a lower-cascade rule (e.g. the element's class background) apply again,
 * whereas writing `url("")` would override it with an empty image.
 */
function removeBgDeclFromSource(src, decl) {
  const s = String(src || '');
  let start = decl.declStart;
  let end = decl.declEnd;
  if (decl.declSemicolon) {
    end += 1; // swallow the terminating ';'
  } else {
    // Terminator was '}', drop a preceding ';' (and its whitespace) if any.
    let p = start - 1;
    while (p >= 0 && /\s/.test(s[p])) p -= 1;
    if (p >= 0 && s[p] === ';') start = p;
  }
  return s.slice(0, start) + s.slice(end);
}

/** Update the bg image url() in one element's inline style; '' clears it. */
function applyInlineBgImage(rawHtml, elIndex, newUrl) {
  const html = String(rawHtml || '');
  const container = document.createElement('div');
  container.innerHTML = html;
  const els = container.querySelectorAll('*');
  const el = els[elIndex];
  if (!el) return html;
  const style = el.getAttribute('style') || '';
  const wrapped = `x{${style}}`;
  const decls = extractBgImageDecls(wrapped);
  if (!decls.length) return html;
  const d = decls[0];
  let nextWrapped;
  if (String(newUrl || '').trim() === '') {
    // Clear: remove the whole declaration so a class background can show through.
    nextWrapped = removeBgDeclFromSource(wrapped, d);
  } else {
    // Single-quote the url so serializing the style attribute doesn't emit &quot;.
    const safe = String(newUrl).replace(/(['\\])/g, '\\$1');
    nextWrapped = wrapped.slice(0, d.tokenStart) + `url('${safe}')` + wrapped.slice(d.tokenEnd);
  }
  const nextStyle = nextWrapped.slice(2, nextWrapped.length - 1).trim();
  if (nextStyle) el.setAttribute('style', nextStyle);
  else el.removeAttribute('style');
  return container.innerHTML;
}

/**
 * Decide where a bgslot_i image pick must be written back. Recomputes the same
 * applied-slot list and acts on the slot at `index`: an inline slot rewrites the
 * element's style attribute in raw_html; a CSS slot rewrites that rule's url()
 * token in raw_css.
 * @returns {{key:'raw_html'|'raw_css',value:string}|null}
 */
export function computeBgSlotWrite(rawHtml, rawCss, index, newUrl) {
  const slots = extractBgImageSlots(rawHtml, rawCss);
  if (index < 0 || index >= slots.length) return null;
  const s = slots[index];
  const clearing = String(newUrl || '').trim() === '';
  if (s.source === 'inline') {
    const html = String(rawHtml || '');
    const nextHtml = applyInlineBgImage(html, s.elIndex, newUrl);
    return nextHtml === html ? null : { key: 'raw_html', value: nextHtml };
  }
  const css = String(rawCss || '');
  let nextCss;
  if (clearing) {
    // Remove the whole declaration so the class rule no longer paints an image.
    nextCss = removeBgDeclFromSource(css, s);
  } else {
    const safe = String(newUrl).replace(/["\\]/g, '\\$&');
    nextCss = `${css.slice(0, s.tokenStart)}url("${safe}")${css.slice(s.tokenEnd)}`;
  }
  return nextCss === css ? null : { key: 'raw_css', value: nextCss };
}

/**
 * Forward-sync: derive bgslot_* controls from the widget's inline-style and CSS
 * background images so the Media panel lists them all. Call under a sync guard
 * so the writes do not re-enter the reverse-sync.
 */
export function syncBgSlotSettingsFromCss(settings, panel) {
  if (!settings || typeof settings.set !== 'function') return;
  const decls = extractBgImageSlots(settings.get('raw_html') || '', settings.get('raw_css') || '');
  for (let i = 0; i < SLOT_COUNT; i++) {
    const visibleKey = `bgslot_${i}_visible`;
    const selectorKey = `bgslot_${i}_selector`;
    const imageKey = `bgslot_${i}_image`;
    if (i < decls.length) {
      const d = decls[i];
      settings.set(visibleKey, 'yes');
      settings.set(selectorKey, d.selector || '');
      const prevMedia = normalizeMediaValue(settings.get(imageKey));
      const nextMedia = normalizeMediaValue({
        url: d.url,
        id: prevMedia.url === d.url ? prevMedia.id : '',
      });
      settings.set(imageKey, nextMedia);
      if (panel) syncPanelMediaControl(panel, imageKey, nextMedia);
      triggerSettingChange(settings, visibleKey);
      triggerSettingChange(settings, selectorKey);
      triggerSettingChange(settings, imageKey);
    } else if (String(settings.get(visibleKey) || '') !== 'no') {
      settings.set(visibleKey, 'no');
      triggerSettingChange(settings, visibleKey);
    }
  }
}

function getElementorPanelPageView() {
  try {
    const el = typeof window !== 'undefined' ? window.elementor : null;
    if (!el || typeof el.getPanelView !== 'function') return null;
    const panelView = el.getPanelView();
    if (!panelView || typeof panelView.getCurrentPageView !== 'function') return null;
    return panelView.getCurrentPageView();
  } catch (_) {
    return null;
  }
}

/** Marionette control view for a widget setting (Elementor panel). */
export function getPanelControlView(settingKey) {
  const pageView = getElementorPanelPageView();
  if (!pageView || !pageView.collection || !pageView.children) return null;
  const controlModel = pageView.collection.findWhere({ name: settingKey });
  if (!controlModel) return null;
  return pageView.children.findByModelCid(controlModel.cid) || null;
}

/** Fire Backbone change events after programmatic settings writes (panel condition refresh). */
function triggerSettingChange(settings, key) {
  if (!settings || typeof settings.trigger !== 'function' || !key) return;
  const value = typeof settings.get === 'function' ? settings.get(key) : undefined;
  settings.trigger(`change:${key}`, settings, value, {});
}

/**
 * Refresh Elementor MEDIA control UI from the settings model (url + id).
 * Call only after `settings.set`, does not run `$e` document/settings (avoids HTML reverse-sync).
 */
/** Preview URL for inline SVG code (Elementor MEDIA control in the widget panel). */
export function buildSvgCodeMediaPreview(svgCode) {
  const markup = String(svgCode || '').trim();
  if (!markup || !/^<svg[\s>]/i.test(markup)) {
    return { ...EMPTY_MEDIA };
  }
  let previewUrl = '';
  try {
    if (typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
      previewUrl = window.URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    }
  } catch (_) { /* ignore */ }
  if (!previewUrl) {
    previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  }
  return normalizeMediaValue({ url: previewUrl, id: '' });
}

export function syncPanelMediaControl(panel, settingKey, rawValue) {
  const media = normalizeMediaValue(rawValue);
  const controlView = getPanelControlView(settingKey);
  if (controlView && typeof controlView.applySavedValue === 'function') {
    try {
      controlView.applySavedValue();
      return true;
    } catch (_) {}
  }
  if (!panel || !panel.$el) return false;
  try {
    const wrap = panel.$el.find(`.elementor-control-${settingKey}`);
    if (!wrap || !wrap.length) return false;
    const urlInput = wrap.find('[data-setting="url"]');
    const idInput = wrap.find('[data-setting="id"]');
    let synced = false;
    if (urlInput.length && String(urlInput.val() || '') !== media.url) {
      urlInput.val(media.url).trigger('input').trigger('change');
      synced = true;
    }
    if (idInput.length && String(idInput.val() || '') !== String(media.id || '')) {
      idInput.val(media.id).trigger('input').trigger('change');
      synced = true;
    }
    return synced;
  } catch (_) {
    return false;
  }
}

export function syncPanelControl(panel, settingKey, value) {
  if (!panel || !panel.$el) return;
  try {
    const strVal = value == null ? '' : String(value);
    const $input = panel.$el.find(`[data-setting="${settingKey}"]`);
    if ($input && $input.length && String($input.val() || '') !== strVal) {
      $input.val(strVal).trigger('input').trigger('change');
      return;
    }
    const wrap = panel.$el.find(`.elementor-control-${settingKey}`);
    if (wrap && wrap.length) {
      const nested = wrap.find('[data-setting]').first();
      if (nested.length && String(nested.val() || '') !== strVal) {
        nested.val(strVal).trigger('input').trigger('change');
      }
    }
  } catch (_) {}
}

export function syncPanelLinkControls(panel, linkKey, link) {
  if (!panel || !panel.$el || !linkKey) return;
  try {
    const controlWrap = panel.$el.find(`.elementor-control-${linkKey}`);
    if (!controlWrap || !controlWrap.length) return;
    const next = normalizeLinkValue(link);
    const urlInput = controlWrap.find('[data-setting="url"]');
    if (urlInput.length && String(urlInput.val() || '') !== next.url) {
      urlInput.val(next.url).trigger('input').trigger('change');
    }
  } catch (_) {}
}

export function extractSlotTextNodes(node, nodes = [], skipOwnText = false) {
  if (!node || !node.childNodes) return nodes;
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 3) {
      // skipOwnText: this text belongs to a wrapping <a> (its Link Text), so it
      // must not become a standalone text slot.
      if (!skipOwnText && String(child.nodeValue || '').trim() !== '') nodes.push(child);
    } else if (child.nodeType === 1) {
      const tag = String(child.tagName || '').toUpperCase();
      // Skip <uichemy-*> custom elements entirely, their inner template tokens
      // (e.g. {nav_item}) must never be treated as editable text slots.
      // The PHP layer extracts and renders these tags server-side.
      if (tag.startsWith('UICHEMY-')) continue;
      if (IGNORE_SLOT_TAGS.has(tag)) continue;
      if (tag === 'IMG' || tag === 'SVG') {
        nodes.push(child);
      } else if (tag === 'A' && anchorWrapsSlotContent(child)) {
        // <a> wrapping media or block content (e.g. <a>txt<h1>..</h1></a>,
        // <a><img></a>): the anchor is one slot, its URL plus its own direct
        // text as the Link Text, and its children are recursed into separate
        // slots (heading text, nested media, …). The anchor's own text must NOT
        // spawn a standalone text slot, so recurse with skipOwnText.
        nodes.push(child);
        extractSlotTextNodes(child, nodes, true);
      } else if (INLINE_SLOT_TAGS.has(tag)) {
        // Other inline tags (span, button, …) are a single text slot, unless one
        // wraps an <img>/<svg>, then expose the nested media.
        if (child.querySelector && child.querySelector('img, svg')) {
          extractSlotTextNodes(child, nodes);
        } else if (inlineWrapsBlockContent(child)) {
          // …or wraps block content (div/h1/p/…): expose the nested block as its
          // own slot(s), mirroring the link-wrapper <a> handling above. Without
          // this a <button><div>…</div></button> collapses into one text slot
          // and edits to the inner block never reach the preview.
          extractSlotTextNodes(child, nodes);
        } else if (String(child.textContent || '').trim() !== '') {
          nodes.push(child);
        }
      } else {
        extractSlotTextNodes(child, nodes);
      }
    }
  }
  return nodes;
}

/** Map a layer path to its widget slot index, or null when not a slot node. */
export function resolveSlotIndexForPath(rawHtml, path) {
  if (!path) return null;
  const container = document.createElement('div');
  container.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const node = resolveNodeByPath(container, path);
  if (!node) return null;
  const slotNodes = extractSlotTextNodes(container);
  const idx = slotNodes.indexOf(node);
  return idx === -1 ? null : idx;
}

/** Apply a link object to the anchor at `path` inside `rawHtml`; returns updated HTML or null. */
export function applyLinkAtPath(rawHtml, path, link) {
  if (!path) return null;
  const container = document.createElement('div');
  container.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const node = resolveNodeByPath(container, path);
  if (!node || node.nodeType !== 1 || String(node.tagName || '').toUpperCase() !== 'A') return null;
  applyLinkToAnchor(node, link);
  const next = denormalizeUichemyTags(container.innerHTML);
  return next === String(rawHtml || '') ? null : next;
}

/**
 * Store a link on a NON-anchor element as `data-uich-link*` marker attributes.
 * The element is not wrapped in the editor (so paths / slot indices stay stable);
 * the widget's PHP render materialises the actual <a> wrapper from these markers.
 * An empty URL removes the markers. Returns the updated HTML, or null if unchanged.
 */
export function applyElementLinkAttrsAtPath(rawHtml, path, link) {
  if (!path) return null;
  const container = document.createElement('div');
  container.innerHTML = normalizeUichemyTags(String(rawHtml || ''));
  const node = resolveNodeByPath(container, path);
  if (!node || node.nodeType !== 1) return null;
  const l = normalizeLinkValue(link);
  const url = String(l.url || '').trim();
  if (!url) {
    node.removeAttribute('data-uich-link');
    node.removeAttribute('data-uich-link-target');
    node.removeAttribute('data-uich-link-rel');
  } else {
    node.setAttribute('data-uich-link', url);
    if (l.is_external === 'on') node.setAttribute('data-uich-link-target', '_blank');
    else node.removeAttribute('data-uich-link-target');
    if (l.nofollow === 'on') node.setAttribute('data-uich-link-rel', 'nofollow');
    else node.removeAttribute('data-uich-link-rel');
  }
  const next = denormalizeUichemyTags(container.innerHTML);
  return next === String(rawHtml || '') ? null : next;
}
