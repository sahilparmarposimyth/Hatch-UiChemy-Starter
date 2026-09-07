/**
 * Flatten `downloadUrls` from the replace-project API.
 * May be `string[]` or grouped buckets, e.g.
 * `{ static_pages: url[], blog_pages: url[], theme_builder: url[], globals: url[], elementor_template: url[], ... }`.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeDownloadUrls(raw) {
  if (raw == null) return [];
  if (typeof raw === 'string') return raw.trim() ? [raw] : [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => normalizeDownloadUrls(item));
  }
  if (typeof raw === 'object') {
    return Object.values(raw).flatMap((v) => normalizeDownloadUrls(v));
  }
  return [];
}
