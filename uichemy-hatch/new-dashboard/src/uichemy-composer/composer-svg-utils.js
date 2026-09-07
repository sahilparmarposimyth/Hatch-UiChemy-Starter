// SVG layer helpers, mirrors legacy UiChemy Composer direct editor SVG flows.
import { resolveNodeByPath } from './composer-layer-tree';

export function isSvgUrlValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/^data:image\/svg\+xml(?:[;,]|$)/i.test(normalized)) return true;
  return /\.svg(?:[?#]|$)/i.test(normalized);
}

export function isSvgLayerEntry(entry) {
  if (!entry) return false;
  if (entry.tag === 'svg') return true;
  // img[data-as="svg"] is always treated as an SVG layer (URL or code mode).
  if (entry.tag === 'img') {
    if (entry.attrs && entry.attrs['data-as'] === 'svg') return true;
    return isSvgUrlValue(entry.attrs && entry.attrs.src);
  }
  return false;
}

export function svgMarkupToPreviewDataUri(svgMarkup) {
  const markup = String(svgMarkup || '').trim();
  if (!markup || !/^<svg[\s>]/i.test(markup)) return '';
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
      return URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    }
  } catch (_) {}
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

export function isSvgMediaAttachment(json) {
  if (!json || !json.url) return false;
  const mime = String(json.mime || '').toLowerCase();
  const subtype = String(json.subtype || '').toLowerCase();
  const filename = String(json.filename || '').toLowerCase();
  return (
    mime === 'image/svg+xml'
    || mime === 'image/svg'
    || subtype === 'svg+xml'
    || subtype === 'svg'
    || /\.svg(?:[?#]|$)/i.test(filename)
    || isSvgUrlValue(json.url)
  );
}

/** @returns {{ tag: string, mode: 'code'|'url', sourceUrl: string, markup: string }|null} */
export function readSvgLayerState(rawHtml, path) {
  if (!path) return null;
  const container = document.createElement('div');
  container.innerHTML = String(rawHtml || '');
  const node = resolveNodeByPath(container, path);
  if (!node || node.nodeType !== 1) return null;

  const tag = String(node.tagName || '').toUpperCase();

  // `<img data-as="svg" src="...">`, always URL mode.
  if (tag === 'IMG' && node.getAttribute('data-as') === 'svg') {
    return {
      tag: 'IMG',
      mode: 'url',
      sourceUrl: node.getAttribute('src') || '',
      markup: '',
    };
  }

  // Legacy: plain `<img src="*.svg">` (no data-as attribute).
  if (tag === 'IMG' && isSvgUrlValue(node.getAttribute('src') || '')) {
    return {
      tag: 'IMG',
      mode: 'url',
      sourceUrl: node.getAttribute('src') || '',
      markup: '',
    };
  }

  if (tag !== 'SVG') return null;

  const sourceUrl = String(node.getAttribute('data-uc-svg-source') || '').trim();
  const imageEl = node.querySelector('image');
  const imageHref = imageEl
    ? (imageEl.getAttribute('href')
      || imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      || '')
    : '';
  const url = sourceUrl || String(imageHref || '').trim();
  if (url) {
    return { tag: 'SVG', mode: 'url', sourceUrl: url, markup: '' };
  }
  const markup = node.innerHTML.trim() === '' ? '' : node.outerHTML;
  return { tag: 'SVG', mode: 'code', sourceUrl: '', markup };
}

/** Nearest wrapping `<a>` ancestor for a layer path, if any. */
export function findAnchorAncestor(rawHtml, path) {
  if (!path) return null;
  const segments = String(path).split('.');
  if (segments.length < 2) return null;
  const container = document.createElement('div');
  container.innerHTML = String(rawHtml || '');
  for (let i = segments.length - 1; i >= 1; i--) {
    const ancestorPath = segments.slice(0, i).join('.');
    const node = resolveNodeByPath(container, ancestorPath);
    if (!node || node.nodeType !== 1 || String(node.tagName || '').toUpperCase() !== 'A') continue;
    const attrs = {};
    if (node.attributes) {
      for (let j = 0; j < node.attributes.length; j++) {
        const a = node.attributes[j];
        attrs[a.name] = a.value;
      }
    }
    return { path: ancestorPath, attrs };
  }
  return null;
}

export function getSvgOuterHtml(rawHtml, path) {
  const state = readSvgLayerState(rawHtml, path);
  if (!state) return '';
  if (state.mode === 'url') {
    if (!state.sourceUrl) return '';
    const container = document.createElement('div');
    container.innerHTML = String(rawHtml || '');
    const node = resolveNodeByPath(container, path);
    return node && node.nodeType === 1 ? node.outerHTML : '';
  }
  return state.markup || '';
}

export function applySvgCodeAtPath(rawHtml, path, markup) {
  if (!path) return null;
  const trimmed = String(markup || '').trim();
  if (!trimmed) return null;
  const parsedWrap = document.createElement('div');
  parsedWrap.innerHTML = trimmed;
  const nextNode = parsedWrap.querySelector('svg, img');
  if (!nextNode) return null;

  const container = document.createElement('div');
  container.innerHTML = String(rawHtml || '');
  const node = resolveNodeByPath(container, path);
  if (!node || node.nodeType !== 1) return null;

  const tag = String(node.tagName || '').toUpperCase();
  const isSvgImgNode = tag === 'IMG' && (
    node.getAttribute('data-as') === 'svg' ||
    isSvgUrlValue(node.getAttribute('src') || '')
  );
  if (tag === 'SVG' || isSvgImgNode) {
    node.replaceWith(nextNode.cloneNode(true));
    const next = container.innerHTML;
    return next === String(rawHtml || '') ? null : next;
  }
  return null;
}

/**
 * Map external SVG URL onto the node.
 *
 * When the selected node is a raw `<svg>` tag, it is replaced in-place with
 * `<img data-as="svg" src="URL">` so the output source code uses the clean
 * attribute-based format the user expects.
 *
 * When the node is already an `<img data-as="svg">` (or a legacy `<img src="*.svg">`),
 * the `src` attribute is simply updated.
 */
export function applySvgUrlAtPath(rawHtml, path, url) {
  if (!path) return null;
  const nextUrl = String(url || '').trim();

  const container = document.createElement('div');
  container.innerHTML = String(rawHtml || '');
  const node = resolveNodeByPath(container, path);
  if (!node || node.nodeType !== 1) return null;

  const tag = String(node.tagName || '').toUpperCase();

  if (tag === 'SVG') {
    // Replace the entire <svg> node with <img data-as="svg" src="URL">.
    if (nextUrl) {
      const doc = node.ownerDocument || container.ownerDocument || document;
      const imgNode = doc.createElement('img');
      imgNode.setAttribute('data-as', 'svg');
      imgNode.setAttribute('src', nextUrl);
      // Preserve any existing class / style / id attributes from the old <svg>.
      ['class', 'style', 'id', 'width', 'height'].forEach((attr) => {
        const val = node.getAttribute(attr);
        if (val) imgNode.setAttribute(attr, val);
      });
      node.parentNode.replaceChild(imgNode, node);
    } else {
      // URL cleared, replace with a clean empty plain <svg> tag.
      const doc = node.ownerDocument || container.ownerDocument || document;
      const svgNode = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      node.parentNode.replaceChild(svgNode, node);
    }
  } else if (tag === 'IMG') {
    // Already an <img data-as="svg"> or legacy <img src="*.svg">, update src.
    if (nextUrl) {
      node.setAttribute('src', nextUrl);
      // Ensure the data-as marker is present.
      if (!node.getAttribute('data-as')) node.setAttribute('data-as', 'svg');
    } else {
      // URL cleared, replace with a clean empty plain <svg> tag.
      const doc = node.ownerDocument || container.ownerDocument || document;
      const svgNode = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      node.parentNode.replaceChild(svgNode, node);
    }
  } else {
    return null;
  }

  const next = container.innerHTML;
  return next === String(rawHtml || '') ? null : next;
}
