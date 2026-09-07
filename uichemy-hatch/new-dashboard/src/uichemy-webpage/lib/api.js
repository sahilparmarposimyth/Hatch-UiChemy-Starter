/**
 * AI Website Creator API client.
 *
 * Every call goes to this site's own REST namespace (`uichemy/v2/webpage`),
 * which proxies onward to the project API with the stored OAuth bearer token.
 * Nothing here talks to a third-party host directly, that keeps the token
 * server-side and sidesteps CORS entirely.
 */

import { __, sprintf } from '@wordpress/i18n';

import { normalizeDownloadUrls } from './download-urls';

/**
 * Configuration injected by Uich_Webpage_Loader::localize_boot_payload().
 * Read through a function rather than captured at module load: the dashboard
 * bundle can evaluate before the localized global is assigned.
 *
 * @returns {{ restUrl: string, nonce: string, siteUrl: string, isAuthenticated: boolean, userInfo: object|false, userId: string|false }}
 */
export function getBoot() {
  return (typeof window !== 'undefined' && window.uich_webpage_boot) || {};
}

/**
 * Get all exported projects for the authenticated user.
 * Returns { success, total, projects } with projects containing pages, sections, and design concepts.
 * Uses WordPress REST API proxy (Bearer token sent by backend).
 *
 * @returns {Promise<{ success: boolean, total: number, projects: Array }>} API response.
 */
export async function getSitemaps() {
  return wpRestRequest('sitemaps');
}

/**
 * Mint an OAuth authorization URL for the connect flow.
 *
 * Fetched on click rather than shipped in the boot payload: minting one costs a
 * round trip to the auth server and rotates the server-side PKCE verifier, so
 * doing it on every dashboard page load would be both slow and wasteful.
 *
 * The `route` tells the server where to land once the account is connected.
 * It matters because the rail's "Activate" button starts this same flow:
 * without it, connecting from either place would drop the user on the dashboard
 * root instead of on the AI Website Creator, the tab the account unlocks.
 *
 * Defaults to `#/ai-website`, the live route for this flow — it opens Home with
 * the AI Website Creator tab preselected (see DashboardApp). The old `#/import`
 * route no longer resolves to anything.
 *
 * @param {string} route Dashboard hash route to return to, e.g. '#/ai-website'.
 * @returns {Promise<string>} Absolute URL to send the browser to.
 */
export async function getAuthorizeUrl(route = '#/ai-website') {
  // rest_url() already carries a query string on sites with plain permalinks
  // (?rest_route=/…), so pick the separator instead of assuming '?'.
  const separator = (getBoot()?.restUrl || '').includes('?') ? '&' : '?';
  const endpoint = route
    ? `auth/authorize-url${separator}route=${encodeURIComponent(route)}`
    : 'auth/authorize-url';
  const data = await wpRestRequest(endpoint);
  if (!data || typeof data.authorization_url !== 'string' || !data.authorization_url) {
    throw new Error('The connect URL could not be created. Please try again.');
  }
  return data.authorization_url;
}

/**
 * Clear the stored tokens for the connected account on this site.
 *
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function logout() {
  return wpRestRequest('auth/logout', { method: 'POST', body: JSON.stringify({}) });
}


/**
 * Poll an async job endpoint until it completes (POST returns 202; work runs after
 * the response to avoid gateway 504 on long-running server-side work).
 *
 * @param {string} endpoint Job status endpoint prefix, e.g. 'replacement-job' or 'import-job'.
 * @param {string} jobId
 * @param {{ intervalMs?: number, maxWaitMs?: number, failedErrorCode?: string, timeoutErrorCode?: string }} [options]
 * @returns {Promise<any>} Job result payload.
 */
async function pollJobStatus(
  endpoint,
  jobId,
  {
    intervalMs = 4000,
    maxWaitMs = 900000,
    failedErrorCode = 'IMPORT_JOB_FAILED',
    timeoutErrorCode = 'IMPORT_JOB_TIMEOUT',
    stallSeconds = 0,
    onProgress = null,
  } = {}
) {
  const start = Date.now();
  let delay = intervalMs;
  while (Date.now() - start < maxWaitMs) {
    const data = await wpRestRequest(`${endpoint}/${jobId}`, { method: 'GET' });
    if (data.status === 'complete') {
      if (onProgress && data.progress) onProgress(data.progress);
      return data.result;
    }
    if (data.status === 'error') {
      // errorDetail is the sanitized upstream body (e.g. the actual validation message) –
      // surface it too, since data.error alone is often just a generic "API error: 500".
      const errMsg = data.errorDetail ? `${data.error || 'Job failed'}: ${data.errorDetail}` : data.error || 'Job failed';
      reportError(failedErrorCode, { message: errMsg, level: 'error', context: { jobId } });
      throw new Error(errMsg);
    }

    if (onProgress && data.progress) onProgress(data.progress);

    // A worker killed by a PHP fatal leaves its job transient frozen on the last
    // value it wrote — forever "running", never "error". Without this the poller
    // would sit out its whole maxWaitMs on a job that is never coming back, which
    // is a worse experience than the failure it replaced. Both timestamps come
    // from the server, so a skewed client clock cannot trigger it.
    if (stallSeconds > 0 && typeof data.updated === 'number' && typeof data.now === 'number') {
      if (data.now - data.updated > stallSeconds) {
        const stallMsg = __( 'The server stopped responding part-way through this step.', 'uichemy' );
        reportError(failedErrorCode, {
          message: `Job stalled: no progress for ${data.now - data.updated}s.`,
          level: 'error',
          context: { jobId, lastProgress: data.progress || null },
        });
        const error = new Error(stallMsg);
        error.code = 'IMPORT_JOB_STALLED';
        error.hint = __( 'The background worker was killed before it finished — usually a PHP memory limit or a hard process timeout on your host. Retry the step, and check the PHP error log if it happens again.', 'uichemy' );
        throw error;
      }
    }

    await new Promise((r) => setTimeout(r, delay));
    // Back off while pending/running, job can take several minutes; fewer network calls.
    if (Date.now() - start > 45000) {
      delay = Math.min(10000, delay + 2000);
    }
  }
  reportError(timeoutErrorCode, { message: 'Job timed out waiting for server.', level: 'error', context: { jobId } });
  throw new Error('Job timed out waiting for server.');
}

/**
 * Poll async replacement job until complete (POST returns 202; work runs after response to avoid gateway 504).
 *
 * @param {string} jobId
 * @param {{ intervalMs?: number, maxWaitMs?: number }} [options]
 * @returns {Promise<any>} UiChemy API result payload (e.g. downloadUrls).
 */
export async function pollReplacementJobStatus(jobId, options = {}) {
  return pollJobStatus('replacement-job', jobId, {
    ...options,
    failedErrorCode: 'IMPORT_REPLACEMENT_JOB_FAILED',
    timeoutErrorCode: 'IMPORT_REPLACEMENT_TIMEOUT',
  });
}

/**
 * Poll async import-pages job until complete (POST returns 202; work runs after response to avoid gateway 504).
 *
 * @param {string} jobId
 * @param {{ intervalMs?: number, maxWaitMs?: number }} [options]
 * @returns {Promise<any>} { success, created_pages, blog_posts, widgets_enable }.
 */
export async function pollImportJobStatus(jobId, options = {}) {
  return pollJobStatus('import-job', jobId, {
    ...options,
    failedErrorCode: 'IMPORT_PAGES_JOB_FAILED',
    timeoutErrorCode: 'IMPORT_PAGES_TIMEOUT',
  });
}

/**
 * Call project-replacement-elementor API (Elementor replacement).
 * Uses WordPress REST API proxy; backend forwards to the project API with Bearer token.
 *
 * @param {{ projectId: string, conceptNumber: number, pagesList: string[] }} params
 * @returns {Promise<any>} API response.
 */
export async function replaceProjectElementor({ projectId, conceptNumber, pagesList }) {
  const initial = await wpRestRequest('project-replacement-elementor', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      conceptNumber,
      pagesList,
    }),
  });
  if (initial.jobId && initial.status === 'pending') {
    return pollReplacementJobStatus(initial.jobId);
  }
  return initial;
}

/**
 * Call project-replacement-gutenberg API (Gutenberg replacement).
 * Same request shape as Elementor; backend serves Gutenberg export URLs.
 *
 * @param {{ projectId: string, conceptNumber: number, pagesList: string[] }} params
 * @returns {Promise<any>} API response.
 */
export async function replaceProjectGutenberg({ projectId, conceptNumber, pagesList }) {
  const initial = await wpRestRequest('project-replacement-gutenberg', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      conceptNumber,
      pagesList,
    }),
  });
  if (initial.jobId && initial.status === 'pending') {
    return pollReplacementJobStatus(initial.jobId);
  }
  return initial;
}


/**
 * Fetch replacement assets from downloadUrls only (no page creation).
 * URLs may be JSON exports or HTML / other responses with Gutenberg block markup (same array).
 * Call first, then importPages. Enables Visit Site link after import.
 *
 * Runs server-side as an async job: the POST answers 202 + jobId and the download
 * work happens after the response is flushed, so no single HTTP request stays open
 * long enough for a gateway/proxy timeout to kill it. `onProgress` receives the
 * server's real file counter ({ phase, current, total, label }).
 *
 * @param {{ downloadUrls: string[] | Record<string, string[]>, projectId?: string, meta?: object, builder?: 'elementor'|'gutenberg'|'auto' }} params
 * @param {{ onProgress?: (progress: object) => void }} [options]
 * @returns {Promise<any>} API response { success, globals, files, meta }.
 */
export async function fetchReplacementJson({ downloadUrls, projectId, meta, builder }, { onProgress } = {}) {
  const body = {
    downloadUrls: normalizeDownloadUrls(downloadUrls),
    projectId: projectId || '',
    meta: meta || {},
  };
  if (builder) {
    body.builder = builder;
  }

  const attempt = async () => {
    const started = await wpRestRequest('fetch-replacement-json', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    // Older builds of this route answered with the finished payload inline. Keep
    // reading that shape so a JS bundle newer than the PHP still works.
    if (!started || typeof started !== 'object' || !started.jobId) {
      return started;
    }
    return pollFetchJobStatus(started.jobId, { onProgress });
  };

  /*
   * A stall means the host killed the deferred worker mid-run (hard FPM/process
   * timeout — set_time_limit cannot extend that). The work is resumable: files
   * already fetched stay stored, imported images dedupe by source hash, and
   * installed plugins stay active, so a second run has far less to do and
   * usually fits inside the same kill window. A manual Retry click therefore
   * almost always succeeded — which is exactly the signal it should happen by
   * itself. Retry silently (with a pause so the server's stale-job window can
   * expire and a FRESH job is minted rather than re-joining the dead one),
   * and only surface the failure once repeated attempts stall too.
   */
  const STALL_RETRIES = 2;
  let lastErr;
  for (let i = 0; i <= STALL_RETRIES; i++) {
    if (i > 0) {
      reportError('IMPORT_FETCH_STALL_AUTORETRY', {
        message: `Fetch job stalled; auto-retrying (attempt ${i + 1} of ${STALL_RETRIES + 1}).`,
        level: 'warning',
      });
      await new Promise((r) => setTimeout(r, 8000));
    }
    try {
      return await attempt();
    } catch (e) {
      if (e?.code !== 'IMPORT_JOB_STALLED') throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Poll the async fetch-replacement-json job until it finishes.
 *
 * @param {string} jobId
 * @param {{ intervalMs?: number, maxWaitMs?: number, onProgress?: Function }} [options]
 * @returns {Promise<any>}
 */
export async function pollFetchJobStatus(jobId, options = {}) {
  return pollJobStatus('import-job', jobId, {
    // Files land every few seconds, so poll tighter than the pages job — the
    // counter should look live rather than lurching every 4s.
    intervalMs: 2000,
    // Matches Uich_Webpage_Import::JOB_STALL_SECONDS; one wp_remote_get() in the
    // loop may take up to 120s, so anything shorter would call a slow download dead.
    stallSeconds: 180,
    ...options,
    failedErrorCode: 'IMPORT_FETCH_JOB_FAILED',
    timeoutErrorCode: 'IMPORT_FETCH_TIMEOUT',
  });
}



/**
 * Check the status of required theme and plugins for Nexter-based imports.
 * requiredPlugins source: sitemaps API `project.requiredPlugins.free` (plugin names), NOT globals.json.
 *
 * @param {{ requiredPlugins?: string[] }} params Free plugin display names (e.g. Elementor).
 * @returns {Promise<{ success: boolean, theme: object, plugins: Array }>}
 */
export async function checkRequirements({ requiredPlugins } = {}) {
  return wpRestRequest('check-requirements', {
    method: 'POST',
    body: JSON.stringify({ requiredPlugins: requiredPlugins || [] }),
  });
}

/**
 * Download, install, and activate pro plugins from zip URLs.
 * The download is authenticated with the user's OAuth Bearer token alone.
 *
 * @param {{ requiredPlugins?: string[] }} params `project.requiredPlugins.pro` (https zip URLs).
 * @returns {Promise<{ success: boolean, downloaded: Array, message: string }>}
 */
export async function downloadProPlugins({ requiredPlugins } = {}) {
  return wpRestRequest('download-pro-plugins', {
    method: 'POST',
    body: JSON.stringify({ requiredPlugins: requiredPlugins || [] }),
  });
}

/**
 * Install and activate a single plugin.
 *
 * @param {{ original_slug: string, plugin_slug: string }} params
 * @returns {Promise<{ success: boolean, status: string, message: string }>}
 */
export async function installPlugin({ original_slug, plugin_slug }) {
  return wpRestRequest('install-plugin', {
    method: 'POST',
    body: JSON.stringify({ original_slug, plugin_slug }),
  });
}

/**
 * Install and activate Nexter theme.
 *
 * @param {{ theme_slug?: string }} params
 * @returns {Promise<{ success: boolean, status: string, message: string }>}
 */
export async function installTheme({ theme_slug = 'nexter' } = {}) {
  return wpRestRequest('install-theme', {
    method: 'POST',
    body: JSON.stringify({ theme_slug }),
  });
}


/**
 * Enable TPAE widgets/extensions used in imported templates.
 * Pass lists from fetch-replacement-json `widget_list` / `extensions_list`, or omit to let the server scan stored JSON.
 *
 * @param {{ widget_list?: string[], extensions_list?: string[] }} [params]
 */
export async function enableWidgets({ widget_list = [], extensions_list = [] } = {}) {
  return wpRestRequest('enable-widgets', {
    method: 'POST',
    body: JSON.stringify({ widget_list, extensions_list }),
  });
}

/**
 * Enable Nexter / TPG Gutenberg blocks used in imported templates (Gutenberg builder flow).
 * Pass `block_list` from fetch-replacement-json, or omit to let the server scan stored JSON.
 *
 * @param {{ block_list?: string[] }} [params]
 */
export async function enableBlocks({ block_list = [] } = {}) {
  return wpRestRequest('enable-blocks', {
    method: 'POST',
    body: JSON.stringify({ block_list }),
  });
}

/**
 * Import a single page or template by name.
 * Reads from stored replacement data (must call fetchReplacementJson first).
 *
 * Runs as an async job on the server (POST returns 202 + jobId immediately), a
 * synchronous response here previously 504'd on real hosting for image-heavy pages
 * (a reverse-proxy gateway timeout, not a PHP one, so raising PHP's own time limit alone
 * didn't help). This waits out the job via pollImportJobStatus before resolving, same as
 * importPages().
 *
 * @param {{ pageName: string, type?: 'page'|'navbar'|'footer'|'404'|'blog-page'|'blog-template'|'elementor-template', el_type?: string, conditions?: string[] }} params
 * @returns {Promise<{ success: boolean, post_id: number, permalink: string, title: string }>}
 */
export async function importSinglePage({ pageName, type = 'page', el_type, archive_rule, conditions, hooks_action }) {
  const initial = await wpRestRequest('import-single-page', {
    method: 'POST',
    body: JSON.stringify({ pageName, type, el_type, archive_rule, conditions, hooks_action }),
  });
  if (initial.jobId && initial.status === 'pending') {
    return pollImportJobStatus(initial.jobId);
  }
  return initial;
}

/**
 * Apply Elementor plugin settings (unfiltered uploads, experiments, etc.).
 *
 * @returns {Promise<{ success: boolean }>}
 */
export async function applyPluginSettings() {
  return wpRestRequest('apply-plugin-settings', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Delete stored import scratch data (uich_webpage_replacement_data, etc.) once an import
 * no longer needs it. Call unconditionally at the end of every import's finalize phase –
 * unlike applyPluginSettings(), which only runs when an "advanced config" toggle is on,
 * this always runs, so the multi-MB stored JSON doesn't linger in wp_options for imports
 * where that toggle is off.
 *
 * @returns {Promise<{ success: boolean }>}
 */
export async function cleanupImportData() {
  return wpRestRequest('import-cleanup', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Apply Nexter theme settings (fluid container layout options).
 *
 * @returns {Promise<{ success: boolean }>}
 */
export async function applyThemeSettings() {
  return wpRestRequest('apply-theme-settings', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Auto-enable the Nexter Extension + Theme Customizer defaults confirmed safe
 * after import (perf toggles, security headers, sidebar/Woo CSS), Master Action
 * Plan Part 2. Pure configuration on Nexter's own toggles, safe for both builders.
 *
 * @returns {Promise<{ success: boolean }>}
 */
export async function applyNexterSettings() {
  return wpRestRequest('apply-nexter-settings', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Move all existing posts, pages, and Nexter Theme Builder templates to draft.
 * Call before importing new content when the user opts to reset previous content.
 * Nothing is deleted, content is set to draft and can be restored later.
 *
 * @returns {Promise<{ success: boolean, moved: number, types: string[] }>}
 */
export async function resetExistingContent() {
  return wpRestRequest('reset-content', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * Create WordPress blog posts from stored blog-post-content.json (or an explicit posts payload).
 *
 * For the dynamic flow (no `posts`), pass `offset`/`limit` to import one slice at a time, each
 * request stays short because featured/inline images are downloaded + thumbnailed synchronously.
 * The response includes `{ total, processed, next_offset, done }` so the caller can loop.
 *
 * @param {{ posts?: Array, offset?: number, limit?: number }} params
 * @returns {Promise<{ success: boolean, created: number, total?: number, processed?: number, next_offset?: number|null, done?: boolean, posts: Array }>}
 */
export async function importBlogPosts({ posts, offset, limit } = {}) {
  return wpRestRequest('import-blog-posts', {
    method: 'POST',
    body: JSON.stringify({
      posts: posts || null,
      ...(typeof offset === 'number' ? { offset } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
    }),
  });
}


/**
 * Report an error to the UiChemy error-tracking service.
 * Best-effort, fire-and-forget, never throws or blocks the caller.
 *
 * @param {string} errorCode  Stable identifier matching the error catalog (e.g. 'IMPORT_START_FAILED').
 * @param {{ level?: 'fatal'|'error'|'warning'|'info', message?: string, stack?: string, context?: object }} [opts]
 */
export async function reportError(errorCode, opts = {}) {
  try {
    await wpRestRequest('report-error', {
      method: 'POST',
      body: JSON.stringify({
        source: 'uichemy-webpage',
        ...opts,
        errorCode,
      }),
    });
  } catch (_) {
    // Never let reporting break the user's flow.
  }
}

/**
 * Make a request to WordPress REST API.
 *
 * @param {string} endpoint - REST API endpoint (e.g., 'auth/status').
 * @param {Object} options - Fetch options.
 * @returns {Promise<any>} Response data.
 */
/**
 * Markup -> readable one-liner. WordPress puts a whole HTML page in the JSON
 * `message` of a fatal-error response, so flattening it is what makes the text
 * legible at all; it is only ever shown as supporting detail.
 *
 * @param {unknown} html
 * @returns {string}
 */
function toPlainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn a REST failure into something worth showing a user.
 *
 * A PHP fatal inside a REST call (timeout, memory, a real crash) does not come
 * back as our own WP_Error. WordPress catches it and answers with a JSON error
 * whose `message` is the critical-error PAGE, markup and all — which the import
 * UI then printed verbatim, tags included, saying nothing anyone could act on.
 * Detect that shape and replace it with a cause and a next step; keep the
 * flattened original as `detail` so nothing is actually lost.
 *
 * @param {string} rawMessage Message exactly as the server sent it.
 * @param {number} status     HTTP status code.
 * @returns {{ message: string, hint: string, detail: string }}
 */
function describeRestError(rawMessage, status) {
  const raw = typeof rawMessage === 'string' ? rawMessage : '';
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(raw);
  const plain = toPlainText(raw);
  const isServerFatal = /critical error/i.test(plain) || (looksLikeHtml && status >= 500);

  if (isServerFatal) {
    return {
      message: __('The server stopped part-way through this step.', 'uichemy'),
      hint: __('This is almost always a hosting limit rather than your design — PHP ran out of time or memory. Retry the step; if it keeps failing, raise max_execution_time and memory_limit (or ask your host to) and check the PHP error log.', 'uichemy'),
      detail: plain,
    };
  }

  if (looksLikeHtml) {
    return {
      message: plain || __('The server returned an unexpected response.', 'uichemy'),
      hint: '',
      detail: plain,
    };
  }

  return { message: raw.trim(), hint: '', detail: '' };
}

export async function wpRestRequest(endpoint, options = {}) {
  const restUrl = getBoot()?.restUrl;
  const nonce = getBoot()?.nonce;

  if (!restUrl) {
    throw new Error('REST URL is not configured');
  }

  let url = `${restUrl}${endpoint}`;

  // Same-origin guard. `rest_url()` returns the site's CANONICAL origin, which
  // can differ from the origin wp-admin is actually loaded on, LocalWP's direct
  // :10008 port, a staging alias, or an http/https mismatch. A cross-origin REST
  // call triggers a CORS preflight that rejects the `X-WP-Nonce` header, and the
  // whole request fails as a bare "Failed to fetch". WordPress serves its REST
  // API on whatever host reaches wp-admin (and the auth cookie/nonce are
  // host-scoped, not port-scoped), so realign the request to the current origin
  // to keep it same-origin. No-op when the origins already match (production).
  try {
    if (typeof window !== 'undefined' && window.location) {
      const u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) {
        u.protocol = window.location.protocol;
        u.host = window.location.host;
        url = u.toString();
      }
    }
  } catch (_) { /* non-absolute / unparsable, send the original string as-is */ }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-WP-Nonce': nonce,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const fallback = sprintf(
      /* translators: %d: HTTP status code. */
      __( 'The server rejected this request (HTTP %d).', 'uichemy' ),
      response.status
    );
    let message = fallback;
    let hint = '';
    let detail = '';
    let code = null;
    try {
      const err = JSON.parse(errorText);
      if (err.code) code = err.code;
      // WordPress reports a PHP fatal as a JSON error whose `message` is the
      // critical-error page markup, so the JSON branch needs the same
      // humanizing as the non-JSON one below.
      const described = describeRestError(err.message || '', response.status);
      if (described.message) {
        message = described.message;
        hint = described.hint;
        detail = described.detail;
      } else if (err.code) {
        message = `${err.code}: ${fallback}`;
      }
    } catch (_) {
      // Non-JSON body: WordPress's fatal-error HTML page served raw, or a proxy
      // error page. Never surface that markup — it renders as if it were part
      // of the UI.
      const described = describeRestError(errorText, response.status);
      if (described.message) {
        message = described.message;
        hint = described.hint;
        detail = described.detail || errorText.slice(0, 300);
      }
    }
    const error = new Error(message);
    if (code) error.code = code;
    if (hint) error.hint = hint;
    if (detail) error.detail = detail;
    if (!endpoint.includes('report-error')) {
      reportError('IMPORT_WP_REST_API_ERROR', {
        // Log the flattened server text, not the cleaned-up copy: the whole
        // point of the report is to say what actually broke.
        message: detail || message,
        level: 'error',
        context: { endpoint, httpStatus: response.status, ...(code ? { serverCode: code } : {}) },
      });
    }
    throw error;
  }

  return response.json();
}