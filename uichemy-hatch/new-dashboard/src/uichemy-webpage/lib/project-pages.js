import { __, sprintf } from '@wordpress/i18n';

/** Keys from sitemaps API `project` for grouped pages (order = UI order). */
export const PAGE_GROUP_KEYS = [
  'static_pages',
  'blog_pages',
  'theme_builder',
  'shop_pages',
  'extra_pages',
  'legal_pages',
];

export const PAGE_GROUP_LABELS = {
  static_pages: __( 'Static Pages', 'uichemy' ),
  blog_pages: __( 'Blog Pages', 'uichemy' ),
  theme_builder: __( 'Theme Builder', 'uichemy' ),
  shop_pages: __( 'Shop Pages', 'uichemy' ),
  extra_pages: __( 'Extra Pages', 'uichemy' ),
  legal_pages: __( 'Legal Pages', 'uichemy' ),
};

/** static_pages → staticPages */
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * `pages` may be a bucket: { static_pages: [...], theme_builder: [...], ... } (not a flat list).
 *
 * @param {object} raw
 * @returns {boolean}
 */
function isPagesBucketObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return PAGE_GROUP_KEYS.some((k) => Object.prototype.hasOwnProperty.call(raw, k));
}

/**
 * Read a grouped page array: on `src` or under `src.pages`; snake_case or camelCase.
 *
 * @param {object} src
 * @param {string} snakeKey
 * @returns {unknown[]}
 */
function getGroupArrayRaw(src, snakeKey) {
  if (!src || typeof src !== 'object') return [];
  const camelKey = snakeToCamel(snakeKey);
  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const a = obj[snakeKey];
    const b = obj[camelKey];
    if (Array.isArray(a)) return a;
    if (Array.isArray(b)) return b;
    return null;
  };
  const direct = pick(src);
  if (direct) return direct;
  const nested = src.pages;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const inner = pick(nested);
    if (inner) return inner;
  }
  return [];
}

/**
 * True if any grouped bucket has at least one page.
 *
 * @param {object} src
 */
function hasAnyGroupedPages(src) {
  return PAGE_GROUP_KEYS.some((k) => getGroupArrayRaw(src, k).length > 0);
}

/**
 * Legacy flat list: `pages` is an array, or a map of id → page (not the grouped bucket).
 *
 * @param {object} src
 * @returns {unknown[]}
 */
function getLegacyPagesArray(src) {
  if (!src || typeof src !== 'object') return [];
  const raw = src.pages;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    if (isPagesBucketObject(raw)) return [];
    return Object.values(raw);
  }
  return [];
}

/**
 * Some APIs nest page buckets under `sitemap`, `siteMap`, etc. Pick the first object that
 * actually contains page data so the dashboard import UI matches list/stats.
 *
 * @param {object} project
 * @returns {object}
 */
export function getProjectPageSource(project) {
  if (!project || typeof project !== 'object') return project;

  const candidates = [
    project,
    project.data,
    project.sitemap,
    project.siteMap,
    project.site_map,
    project.exportedProject,
    project.exported_project,
  ].filter((x) => x && typeof x === 'object');

  for (const src of candidates) {
    if (hasAnyGroupedPages(src)) return src;
    const legacy = getLegacyPagesArray(src);
    if (legacy.length > 0) return src;
  }

  return project;
}

/**
 * Collect every page `_id` from the new grouped shape, or legacy `project.pages`.
 *
 * @param {object} project
 * @returns {string[]}
 */
export function collectAllPageIds(project) {
  const src = getProjectPageSource(project);
  if (!src || typeof src !== 'object') return [];
  const ids = [];
  for (const key of PAGE_GROUP_KEYS) {
    const arr = getGroupArrayRaw(src, key);
    for (const p of arr) {
      if (p && (p._id || p.id)) ids.push(p._id || p.id);
    }
  }
  if (ids.length === 0) {
    for (const p of getLegacyPagesArray(src)) {
      if (p && (p._id || p.id)) ids.push(p._id || p.id);
    }
  }
  return ids;
}

/**
 * Flat list of page objects from grouped API fields or legacy `project.pages` (dashboard stats, etc.).
 *
 * @param {object} project
 * @returns {object[]}
 */
export function getAllProjectPageRecords(project) {
  const src = getProjectPageSource(project);
  if (!src || typeof src !== 'object') return [];
  const out = [];
  for (const key of PAGE_GROUP_KEYS) {
    out.push(...getGroupArrayRaw(src, key));
  }
  if (out.length === 0) {
    return getLegacyPagesArray(src);
  }
  return out;
}

/**
 * Normalize grouped API pages (+ legacy flat list) for the import picker.
 *
 * @param {object} project
 * @param {string} thumbnailUrl
 * @returns {{ groups: Array<{ key: string, label: string, pages: object[] }>, allPages: object[], pageById: Record<string, object> }}
 */
export function normalizeProjectPages(project, thumbnailUrl) {
  if (!project || typeof project !== 'object') {
    return { groups: [], allPages: [], pageById: {} };
  }

  const src = getProjectPageSource(project);

  const pageById = {};
  const pushPage = (raw, groupKey, indexInGroup) => {
    const stableId = raw._id || raw.id || `${groupKey}-${raw.pageName || 'page'}-${indexInGroup}`;
    const page = {
      id: stableId,
      pageName: raw.pageName || '',
      label: raw.pageName || __( 'Untitled Page', 'uichemy' ),
      sections: Array.isArray(raw.sections) ? raw.sections : [],
      thumbnail: thumbnailUrl,
      groupKey,
    };
    if (page.id) pageById[page.id] = page;
    return page;
  };

  let hasGrouped = false;
  for (const key of PAGE_GROUP_KEYS) {
    if (getGroupArrayRaw(src, key).length > 0) hasGrouped = true;
  }

  const groups = [];

  if (hasGrouped) {
    for (const key of PAGE_GROUP_KEYS) {
      const arr = getGroupArrayRaw(src, key);
      if (arr.length === 0) continue;
      const pages = arr.map((p, i) => pushPage(p, key, i));
      groups.push({
        key,
        label: PAGE_GROUP_LABELS[key] || key,
        pages,
      });
    }
  }

  const legacy = getLegacyPagesArray(src);
  if (groups.length === 0 && legacy.length > 0) {
    const pages = legacy.map((p, i) => pushPage(p, 'pages', i));
    groups.push({
      key: 'pages',
      label: __( 'Pages', 'uichemy' ),
      pages,
    });
  }

  const allPages = groups.flatMap((g) => g.pages);
  return { groups, allPages, pageById };
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function looksLikePluginZipUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

/**
 * The Plus Addons for Elementor (Free or Pro) is no longer required, installed, or
 * shown by an import. These predicates drop it from every requiredPlugins list —
 * both the free display names and the pro zip URLs — while leaving Nexter Blocks /
 * The Plus Addons for Block Editor (which contain "block") untouched.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isTpaeElementorFreeName(name) {
  if (typeof name !== 'string') return false;
  const s = name.toLowerCase();
  if (s.includes('block')) return false;
  return s.includes('plus') && s.includes('elementor');
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isTpaeElementorProUrl(url) {
  if (typeof url !== 'string') return false;
  const s = url.toLowerCase();
  if (s.includes('block')) return false;
  if (s.includes('theplus_elementor_addon')) return true;
  return s.includes('elementor') && (s.includes('theplus') || s.includes('the-plus') || s.includes('plus-addons'));
}

/**
 * UiChemy is the plugin serving the import screen, so it is always already
 * active and the import never installs it. A project that names it anyway would
 * otherwise get a placeholder row for it that the API-backed list then drops —
 * a plugin flickering in and out of "Installing Plugins & Theme".
 *
 * @param {unknown} name
 * @returns {boolean}
 */
function isUiChemyName(name) {
  return typeof name === 'string' && name.trim().toLowerCase().startsWith('uichemy');
}

/**
 * Remove entries the import never installs from a normalized { free, pro } pair:
 * The Plus Addons for Elementor, and UiChemy itself.
 *
 * @param {{ free: string[], pro: string[] }} pair
 * @returns {{ free: string[], pro: string[] }}
 */
function stripTpaeElementor(pair) {
  return {
    free: pair.free.filter((x) => !isTpaeElementorFreeName(x) && !isUiChemyName(x)),
    pro: pair.pro.filter((x) => !isTpaeElementorProUrl(x)),
  };
}

/**
 * Normalize all requiredPlugins shapes into `{ free, pro }`.
 *
 * Supported shapes:
 *  1. Legacy flat array: `["Elementor", "https://...pro.zip"]`
 *  2. Direct free/pro object: `{ free: ["Elementor"], pro: ["https://...pro.zip"] }`
 *  3. Builder-keyed object (new API): `{ elementor: { free: [...], pro: [...] }, gutenberg: { free: [...], pro: [...] } }`
 *
 * @param {unknown} rp
 * @returns {{ free: string[], pro: string[] }}
 */
/**
 * @param {unknown} rp
 * @param {'elementor'|'gutenberg'|null} [builder] - when set and rp is builder-keyed, only that builder's plugins are returned.
 */
function normalizeRpToFreeAndPro(rp, builder) {
  if (rp == null) return { free: [], pro: [] };
  if (Array.isArray(rp)) {
    return stripTpaeElementor({
      free: rp.filter((x) => typeof x === 'string' && x !== '' && !looksLikePluginZipUrl(x)),
      pro:  rp.filter((x) => looksLikePluginZipUrl(x)),
    });
  }
  if (typeof rp === 'object') {
    // Shape 2: direct { free, pro }
    if (Array.isArray(rp.free) || Array.isArray(rp.pro)) {
      return stripTpaeElementor({
        free: Array.isArray(rp.free) ? rp.free.filter((x) => typeof x === 'string' && x !== '') : [],
        pro:  Array.isArray(rp.pro)  ? rp.pro.filter((x) => looksLikePluginZipUrl(x))           : [],
      });
    }
    // Shape 3: builder-keyed { elementor: { free, pro }, gutenberg: { free, pro } }
    // When a builder is specified, only load that builder's plugins.
    const entries = builder && rp[builder]
      ? [[builder, rp[builder]]]
      : Object.entries(rp);
    const free = [], pro = [];
    for (const [, val] of entries) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        if (Array.isArray(val.free)) free.push(...val.free.filter((x) => typeof x === 'string' && x !== ''));
        if (Array.isArray(val.pro))  pro.push(...val.pro.filter((x) => looksLikePluginZipUrl(x)));
      }
    }
    return stripTpaeElementor({ free, pro });
  }
  return { free: [], pro: [] };
}

/**
 * Free plugin names from repo / wp.org (for check-requirements).
 * Handles flat array, `{ free, pro }`, and builder-keyed `{ elementor: { free, pro }, gutenberg: { free, pro } }`.
 *
 * @param {unknown} rp
 * @param {'elementor'|'gutenberg'|null} [builder]
 * @returns {string[]}
 */
export function getRequiredPluginsFree(rp, builder) {
  return normalizeRpToFreeAndPro(rp, builder).free;
}

/**
 * Pro plugin zip URLs (for download-pro-plugins).
 * Handles flat array, `{ free, pro }`, and builder-keyed `{ elementor: { free, pro }, gutenberg: { free, pro } }`.
 *
 * @param {unknown} rp
 * @param {'elementor'|'gutenberg'|null} [builder]
 * @returns {string[]}
 */
export function getRequiredPluginsPro(rp, builder) {
  return normalizeRpToFreeAndPro(rp, builder).pro;
}

/**
 * Flatten free + pro for UI tags / display (same order: free names then pro URLs).
 *
 * @param {unknown} rp
 * @param {'elementor'|'gutenberg'|null} [builder]
 * @returns {string[]}
 */
export function normalizeRequiredPluginsPayload(rp, builder) {
  return [...getRequiredPluginsFree(rp, builder), ...getRequiredPluginsPro(rp, builder)];
}

/**
 * Human-readable label from a pro plugin zip URL path (e.g. my-addon-pro → My Addon Pro).
 *
 * @param {string} url
 * @returns {string}
 */
export function labelFromZipUrl(url) {
  try {
    const path = new URL(url).pathname.split('/').pop() || '';
    const base = path.replace(/\.zip(\?.*)?$/i, '');
    const lower = base.toLowerCase();

    if (lower.includes('theplus') || lower.includes('the-plus')) {
      if (lower.includes('elementor')) return 'The Plus Addons for Elementor Pro';
      if (lower.includes('block') || lower.includes('gutenberg') || lower.includes('nexter')) return 'Nexter Blocks Pro';
    }

    return base
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

/**
 * Request body for `downloadProPlugins` when installing or retrying a single pro zip.
 *
 * @param {unknown} proPayload  `project.requiredPlugins` (object with free+pro) or legacy URL array.
 * @param {string}  singleUrl
 * @returns {Record<string, unknown>|string[]}
 */
export function buildProPluginRetryPayload(proPayload, singleUrl) {
  const { free } = normalizeRpToFreeAndPro(proPayload);
  return { free, pro: [singleUrl] };
}

/**
 * Accordion rows for "Installing Plugins & Theme" from sitemaps `requiredPlugins` only,
 * so names appear before `check-requirements` returns. Replaced by the API-backed list
 * when that response is available.
 *
 * @param {unknown} requiredPlugins Sitemaps `project.requiredPlugins` (array or { free, pro }).
 * @param {{ installNexterTheme?: boolean }} [options]
 * @returns {{ id: string, label: string, status: string }[]}
 */
export function buildPluginGroupPlaceholderItems(requiredPlugins, options = {}) {
  const { installNexterTheme = true, builder = null } = options;
  const out = [];
  if (installNexterTheme) {
    out.push({
      id: 'sitemap-theme',
      label: __( 'Nexter WP Theme', 'uichemy' ),
    });
  }
  getRequiredPluginsFree(requiredPlugins, builder).forEach((name, i) => {
    const n = typeof name === 'string' ? name.trim() : '';
    out.push({
      id: `sitemap-free-${i}`,
      label: n || __( 'Free plugin', 'uichemy' ),
    });
  });
  getRequiredPluginsPro(requiredPlugins, builder).forEach((url, i) => {
    out.push({
      id: `uich-wpc-pro-${i}`,
      label: labelFromZipUrl(url),
    });
  });
  return out.map((row) => ({ ...row, status: 'active' }));
}

/**
 * Labels for Advanced Configurations plugin tags (names + shortened zip stems).
 *
 * @param {unknown} requiredPlugins
 * @param {'elementor'|'gutenberg'|null} [builder]
 * @returns {string[]}
 */
export function getRequiredPluginDisplayLabels(requiredPlugins, builder) {
  const labels = normalizeRequiredPluginsPayload(requiredPlugins, builder).map((item) => {
    if (typeof item !== 'string') return String(item);
    if (/^https?:\/\//i.test(item)) return labelFromZipUrl(item);
    return item;
  });

  // Nexter Extension is no longer force-installed: every Theme Builder template
  // the import creates, both editors, every type, goes to the UiChemy Theme
  // Builder now. It is only listed when a project asks for it by name, which the
  // labels above already cover.

  // UiChemy itself is not listed. This panel is a list of what the import will
  // install, and UiChemy is never installed by it — it is the plugin serving this
  // screen, so it is always already active (see rest_check_requirements()).

  if (builder !== 'elementor') {
    return labels;
  }

  // Elementor IS installed by the import when the project names it, and every
  // Elementor project does. Belt-and-braces label, de-duped against the
  // project's own entry.
  const hasElementor = labels.some(
    (l) => typeof l === 'string' && l.toLowerCase() === 'elementor'
  );
  return hasElementor ? labels : [ 'Elementor', ...labels ];
}
