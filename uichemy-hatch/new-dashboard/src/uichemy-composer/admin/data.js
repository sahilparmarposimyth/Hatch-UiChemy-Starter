// Server data (localized as window.uichemyDashboard) + admin-ajax helper.
// Mirrors the dashboardPost() pattern.
export const data = (typeof window !== 'undefined' && window.uichemyDashboard) || {};

// Post to an admin-ajax action with the shared dashboard nonce. Objects are
// JSON-encoded so the PHP side can json_decode them.
export function ajaxTo(action, type, fields = {}) {
  const body = new FormData();
  body.append('action', action);
  body.append('nonce', data.nonce || '');
  body.append('type', type);
  Object.keys(fields).forEach((k) => {
    const v = fields[k];
    body.append(k, (v !== null && typeof v === 'object') ? JSON.stringify(v) : v);
  });
  return fetch(sameOriginUrl(data.ajaxUrl), { method: 'POST', credentials: 'same-origin', body })
    .then((r) => r.json())
    .then((j) => (j && j.success ? (j.data || {}) : Promise.reject(j && j.data)));
}

// Same-origin guard. `admin_url()` returns the site's CANONICAL origin, which can
// differ from the origin wp-admin is actually loaded on: LocalWP's direct :10008
// port, a staging alias, or an http/https mismatch. A cross-origin admin-ajax POST
// triggers a CORS preflight that drops the auth cookie/nonce, and the whole request
// fails as a bare "Failed to fetch". The auth cookie is host-scoped (not port- or
// scheme-scoped), so realign the request to the current origin to keep it
// same-origin. No-op when the origins already match (production).
function sameOriginUrl(url) {
  try {
    if (typeof window !== 'undefined' && window.location && url) {
      const u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) {
        u.protocol = window.location.protocol;
        u.host = window.location.host;
        return u.toString();
      }
    }
  } catch (_) { /* non-absolute / unparsable, send the original string as-is */ }
  return url;
}

// Dashboard/settings/white-label endpoint.
export function ajax(type, fields = {}) {
  return ajaxTo('uichemy_dashboard', type, fields);
}

// Theme Builder endpoint (see UiChemy_Theme_Builder_Admin).
export function tbAjax(type, fields = {}) {
  return ajaxTo('uichemy_theme_builder', type, fields);
}

// Form Submissions endpoint (see Uich_Forms_Dashboard).
export function formsAjax(type, fields = {}) {
  return ajaxTo('uichemy_forms', type, fields);
}
