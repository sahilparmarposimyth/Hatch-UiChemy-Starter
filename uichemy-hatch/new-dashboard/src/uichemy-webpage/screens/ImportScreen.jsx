import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { __, _n, sprintf } from '@wordpress/i18n';

import SuccessMark from '../components/SuccessMark.jsx';
import Input from '../components/Input.jsx';
import Tooltip from '../components/Tooltip.jsx';
import Button from '../components/Button.jsx';
import { Badge, Checkbox, Alert, ToggleGroup, ToggleGroupItem } from '../../design-system';
import {
  replaceProjectElementor,
  replaceProjectGutenberg,
  fetchReplacementJson,
  checkRequirements,
  downloadProPlugins,
  installPlugin,
  installTheme,
  importSinglePage,
  enableWidgets,
  enableBlocks,
  applyPluginSettings,
  applyThemeSettings,
  applyNexterSettings,
  importBlogPosts,
  resetExistingContent,
  cleanupImportData,
  reportError,
  getBoot,
} from '../lib/api.js';
import { normalizeDownloadUrls } from '../lib/download-urls.js';
import {
  normalizeProjectPages,
  getRequiredPluginDisplayLabels,
  getRequiredPluginsFree,
  getRequiredPluginsPro,
  labelFromZipUrl,
  buildProPluginRetryPayload,
  buildPluginGroupPlaceholderItems,
} from '../lib/project-pages.js';

/**
 * Blog-related filenames that need special handling.
 * Key: lowercase filename (without path). Value: { type, label, pageName?, el_type?, archive_rule? }.
 *
 * - blog-page:       Blog listing JSON as a normal Elementor page (not assigned as Settings > Posts page). Uses Blog Page.json.
 * - theme-template:  Nexter Extension theme builder template (nxt_builder post type).
 *
 * pageName: Used for API file lookup (pageName + '.json'). Must match the actual filename stem.
 */
const BLOG_FILE_MAP = {
  'blog page.json': { type: 'blog-page', label: __('Blog Page', 'uichemy'), pageName: 'Blog Page' },
  'blog.json': { type: 'theme-template', label: __('Blog', 'uichemy'), pageName: 'Blog', el_type: 'archive', archive_rule: 'all' },
  'blog detail page.json': { type: 'theme-template', label: __('Blog Detail Page', 'uichemy'), el_type: 'single', archive_rule: '' },
  'search results page.json': { type: 'theme-template', label: __('Search Results Page', 'uichemy'), el_type: 'search-results', archive_rule: 'nxt_search' },
  'author page.json': { type: 'theme-template', label: __('Author Page', 'uichemy'), el_type: 'archive', archive_rule: 'nxt_author' },
  'category page.json': { type: 'theme-template', label: __('Category Page', 'uichemy'), el_type: 'archive', archive_rule: 'category' },
  'tag featured page.json': { type: 'theme-template', label: __('Tag Featured Page', 'uichemy'), el_type: 'archive', archive_rule: 'post_tag' },
  'cookie policy.json': { type: 'hooks-template', label: __('Cookie Policy', 'uichemy'), pageName: 'Cookie Policy', hooks_action: 'nxt_footer_before' },
};

/**
 * Downloaded filenames that are never a regular page: they either feed a
 * dedicated import step (navbar/footer/404) or are settings payloads.
 */
const NON_PAGE_FILES = new Set([
  'globals.json',
  'uichemy-globals.json',
  'navbar.json',
  'footer.json',
  '404.json',
  'blog-post-content.json',
]);

/**
 * Download URL -> stored-data filename key.
 *
 * Mirrors PHP replacement_filename_from_url(): basename of the URL *path*
 * (query/hash dropped, no percent-decoding, so the key matches the one PHP
 * stored), with .html/.htm mapped onto the matching .json stem. Both sides must
 * agree or find_file_key() will not resolve the file.
 *
 * @param {unknown} u
 * @returns {string}
 */
function filenameFromUrl(u) {
  const base = (typeof u === 'string' ? u : '').split(/[?#]/)[0].split('/').pop() || '';
  return /\.html?$/i.test(base) ? base.replace(/\.html?$/i, '') + '.json' : base;
}

/**
 * Human-readable label for a filename stem. The stem doubles as the API lookup
 * key so it stays percent-encoded; only the display copy is decoded.
 *
 * @param {string} name
 * @returns {string}
 */
function prettyPageLabel(name) {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * Placeholder thumbnail for each row in the page picker. The pages being
 * imported don't exist on this site yet, so there is no real preview to show –
 * every row gets this same bundled image, exactly as the standalone plugin did.
 *
 * Resolved lazily from the boot payload rather than at module scope: this
 * module is part of the dashboard bundle, which can evaluate before
 * `uich_webpage_boot` is assigned.
 */
const pageThumbnail = () => {
  const base = getBoot().assetsUrl;
  return base ? `${base}page-thumbnail.png` : '';
};

/** Tiny sleep helper */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Max parallel import-single-page REST calls (balance speed vs server load / DB contention). */
const PAGE_IMPORT_CONCURRENCY = 3;

/**
 * Run async work on items with limited concurrency (faster than strict sequential awaits).
 *
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} fn
 */
const runPool = async (items, concurrency, fn) => {
  if (items.length === 0) return;
  const queue = items.slice();
  const n = Math.min(Math.max(1, concurrency), queue.length);
  const workers = Array.from({ length: n }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item) await fn(item);
    }
  });
  await Promise.all(workers);
};

/** Prefer Error.message (incl. wpRestRequest) for user-visible notes. */
function messageFromCaught(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err.trim();
  if (typeof err.message === 'string') return err.message.trim();
  return '';
}

/**
 * Copy for the live counter under the active row.
 *
 * The server names the phase it is in (see Uich_Webpage_Import::run_fetch_only);
 * saying which one is running is the difference between a step that looks stuck
 * for three minutes and one that is visibly installing a plugin or pulling
 * images. Anything unrecognised falls back to the generic line rather than
 * showing a raw phase key.
 *
 * @param {{ phase?: string, label?: string }} progress
 * @param {number} current
 * @param {number} total
 * @returns {string}
 */
function progressNoteFor(progress, current, total) {
  const phase = typeof progress.phase === 'string' ? progress.phase : '';
  const label = typeof progress.label === 'string' ? progress.label.trim() : '';

  switch (phase) {
    case 'download':
      return sprintf(
        /* translators: 1: files downloaded so far, 2: total files. */
        __('Downloading %1$d of %2$d files', 'uichemy'),
        current,
        total
      );
    case 'process':
      return __('Saving downloaded content', 'uichemy');
    case 'install_plugins':
      return label
        ? sprintf(
          /* translators: %s: plugin name. */
          __('Installing %s', 'uichemy'),
          label
        )
        : __('Installing required plugins', 'uichemy');
    case 'apply_globals':
      return __('Applying global styles', 'uichemy');
    case 'import_templates':
      return total > 0
        ? sprintf(
          /* translators: 1: templates imported so far, 2: total templates. */
          __('Importing templates (%1$d of %2$d)', 'uichemy'),
          current,
          total
        )
        : __('Importing templates', 'uichemy');
    case 'media':
      return __('Downloading images', 'uichemy');
    case 'scan_widgets':
      return __('Checking which widgets are used', 'uichemy');
    case 'finishing':
      return __('Finishing up', 'uichemy');
    default:
      return __('Working…', 'uichemy');
  }
}

/**
 * Everything a failed sub-item needs to explain itself.
 *
 * wpRestRequest() attaches `hint` (what to do about it) and `detail` (the
 * server's own text, markup flattened) to the Error for failures it can
 * recognise — a PHP fatal above all, which WordPress reports as a JSON error
 * carrying the critical-error page as its message. Spread this at a catch site
 * so the row shows a cause and a next step instead of raw markup.
 *
 * @param {unknown} err
 * @returns {{ failureNote: string, failureHint: string, failureDetail: string }}
 */
function failureFromCaught(err) {
  return {
    failureNote: messageFromCaught(err) || __('This step failed. Please try again.', 'uichemy'),
    failureHint: typeof err?.hint === 'string' ? err.hint : '',
    failureDetail: typeof err?.detail === 'string' ? err.detail : '',
  };
}

/** Some endpoints return 200 + { success: false, message?, description? }. */
function failureMessageFromRestPayload(res) {
  if (!res || typeof res !== 'object' || res.success !== false) return '';
  const msg = typeof res.message === 'string' ? res.message.trim() : '';
  const desc = typeof res.description === 'string' ? res.description.trim() : '';
  return [msg, desc].filter(Boolean).join(', ');
}

/** install-plugin / install-theme JSON: treat success flag same as status active (slug mismatch edge cases). */
function themeOrPluginInstallSucceeded(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.success === true) return true;
  return res.status === 'active';
}

/**
 * Keep plugins accordion header in sync with row statuses (e.g. after per-plugin retry fixes last failure).
 */
function reconcilePluginsGroupState(groups) {
  return groups.map((g) => {
    if (g.id !== 'plugins') return g;
    const { items } = g;
    if (!items.length) return g;
    const failed = items.some((it) => it.status === 'failed');
    const pendingOrActive = items.some((it) => it.status === 'pending' || it.status === 'active');
    const nextStatus = failed ? 'failed' : pendingOrActive ? 'active' : 'completed';
    const expanded = failed || pendingOrActive;
    return { ...g, status: nextStatus, expanded };
  });
}

/** Initial import groups */
const makeInitialGroups = () => [
  {
    id: 'plugins',
    label: __('Installing Plugins & Theme', 'uichemy'),
    completedLabel: __('Installed Plugins & Theme', 'uichemy'),
    status: 'pending',   // pending | active | completed | failed
    expanded: false,
    items: [],           // populated at runtime
  },
  {
    id: 'content',
    label: __('Importing Site Content', 'uichemy'),
    completedLabel: __('Imported Site Content', 'uichemy'),
    status: 'pending',
    expanded: false,
    items: [],
  },
  {
    id: 'pages',
    label: __('Setting Up Pages & Layout', 'uichemy'),
    completedLabel: __('Imported Pages & Layout', 'uichemy'),
    status: 'pending',
    expanded: false,
    items: [],
  },
  {
    id: 'finalize',
    label: __('Finalizing Settings', 'uichemy'),
    completedLabel: __('Settings Finalized', 'uichemy'),
    status: 'pending',
    expanded: false,
    items: [
      { id: 'plugin-settings', label: __('Applying plugin settings', 'uichemy'), status: 'pending' },
      { id: 'theme-settings', label: __('Applying theme settings', 'uichemy'), status: 'pending' },
    ],
  },
];

// ─── Icon Components ─────────────────────────────────────────────────────────

/** Sub-item status icon */
function SubItemIcon({ status }) {
  if (status === 'completed') {
    return (
      <span className="uich-wpc-sub-icon uich-wpc-sub-icon-completed">
        <svg className="uich-wpc-sub-icon-check" width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12.8918 7.05843C13.1358 6.81435 13.5315 6.81435 13.7756 7.05843C14.0196 7.30251 14.0196 7.69814 13.7756 7.94222L8.77555 12.9422C8.53148 13.1863 8.13584 13.1863 7.89176 12.9422L6.2251 11.2756C5.98102 11.0315 5.98102 10.6358 6.2251 10.3918C6.46918 10.1477 6.86481 10.1477 7.10889 10.3918L8.33366 11.6165L12.8918 7.05843Z" fill="currentColor" />
          <path fillRule="evenodd" clipRule="evenodd" d="M10.0003 1.04199C14.9479 1.04199 18.9587 5.05277 18.9587 10.0003C18.9587 14.9479 14.9479 18.9587 10.0003 18.9587C5.05277 18.9587 1.04199 14.9479 1.04199 10.0003C1.04199 5.05277 5.05277 1.04199 10.0003 1.04199ZM10.0003 2.29199C5.74313 2.29199 2.29199 5.74313 2.29199 10.0003C2.29199 14.2575 5.74313 17.7087 10.0003 17.7087C14.2575 17.7087 17.7087 14.2575 17.7087 10.0003C17.7087 5.74313 14.2575 2.29199 10.0003 2.29199Z" fill="currentColor" />
        </svg>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="uich-wpc-sub-icon">
        <span className="uich-wpc-sub-spinner" aria-hidden="true" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="uich-wpc-sub-icon uich-wpc-sub-icon-failed">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M5.99512 1.11816C6.23828 1.1182 6.47741 1.18323 6.6875 1.30566C6.89689 1.42777 7.07062 1.60279 7.19043 1.81348L11.1895 8.8125C11.3101 9.0214 11.374 9.25879 11.374 9.5C11.374 9.74097 11.3108 9.97774 11.1904 10.1865C11.0699 10.3954 10.8963 10.5697 10.6875 10.6904C10.4789 10.811 10.2419 10.8746 10.001 10.875H2C1.75889 10.8765 1.52119 10.8145 1.31152 10.6953C1.10104 10.5756 0.925795 10.4024 0.803711 10.1934C0.681682 9.98414 0.616872 9.74608 0.616211 9.50391C0.615674 9.26149 0.679563 9.02243 0.800781 8.8125L4.7998 1.81348C4.91962 1.60279 5.09334 1.42777 5.30273 1.30566C5.51282 1.18328 5.75198 1.11819 5.99512 1.11816ZM5.99512 1.86816C5.88469 1.86819 5.77609 1.89759 5.68066 1.95312C5.58519 2.00876 5.50666 2.08942 5.45215 2.18555L5.45117 2.18652L1.45117 9.18652L1.4502 9.1875C1.39519 9.28276 1.36607 9.39098 1.36621 9.50098C1.36646 9.61111 1.39571 9.72029 1.45117 9.81543C1.50664 9.91034 1.58707 9.98954 1.68262 10.0439C1.77824 10.098 1.88716 10.126 1.99707 10.125H10L10.0811 10.1191C10.1619 10.1084 10.2405 10.082 10.3115 10.041C10.4063 9.9862 10.4853 9.90728 10.54 9.8125C10.5948 9.71754 10.624 9.6096 10.624 9.5C10.624 9.39038 10.5948 9.28244 10.54 9.1875V9.18652L6.54004 2.18652L6.53906 2.18555C6.48467 2.08958 6.40579 2.00878 6.31055 1.95312C6.21509 1.89751 6.10561 1.8682 5.99512 1.86816ZM6.00488 8.125C6.21198 8.125 6.37988 8.29289 6.37988 8.5C6.37988 8.70711 6.21198 8.875 6.00488 8.875H6C5.7929 8.875 5.625 8.70711 5.625 8.5C5.625 8.29289 5.7929 8.125 6 8.125H6.00488ZM6 4.125C6.20711 4.125 6.375 4.29289 6.375 4.5V6.5C6.375 6.70711 6.20711 6.875 6 6.875C5.7929 6.875 5.625 6.70711 5.625 6.5V4.5C5.625 4.29289 5.7929 4.125 6 4.125Z" fill="currentColor" />
        </svg>
      </span>
    );
  }
  // pending
  return (
    <span className="uich-wpc-sub-icon uich-wpc-sub-icon-pending">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="7" stroke="#d1d5db" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

const STEP_DESCRIPTIONS = {
  plugins: __('Adding the theme and required plugins', 'uichemy'),
  content: __('Bringing in media, posts, menus and styles', 'uichemy'),
  pages: __('Building each page from your design', 'uichemy'),
  finalize: __('Applying plugin and theme configuration', 'uichemy'),
};

/**
 * Single import step, numbered medallion + title / description + right-side
 * status, with EVERY inner item shown while the step is expanded (active steps
 * auto-expand; completed steps collapse but can be re-opened). Import + retry
 * behaviour is unchanged; only the presentation is new.
 */
function ImportGroup({ group, index, onToggle, onRetryGroup, onRetryItem }) {
  const isExpanded =
    group.status === 'active' ||
    group.status === 'failed' ||
    (group.status !== 'pending' && group.expanded);
  const canToggle = group.status === 'completed';
  const stateLabel =
    group.status === 'completed' ? __('Done', 'uichemy')
      : group.status === 'failed' ? __('Failed', 'uichemy')
        : group.status === 'active' ? __('In progress', 'uichemy')
          : __('Waiting', 'uichemy');

  return (
    <div className={`uich-wpc-step uich-wpc-step-${group.status}${isExpanded ? ' is-open' : ''}`}>
      <div className="uich-wpc-step__rail">
        <span className="uich-wpc-step__med" aria-hidden="true">
          {group.status === 'completed' ? (
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="m5 10 3.5 3.5L15 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : group.status === 'failed' ? (
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 5.5v5M10 13.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : group.status === 'active' ? null : index}
        </span>
      </div>

      <div className="uich-wpc-step__body">
        <div
          className="uich-wpc-step__head"
          onClick={() => canToggle && onToggle(group.id)}
          style={{ cursor: canToggle ? 'pointer' : 'default' }}
        >
          <span className="uich-wpc-step__titles">
            <span className="uich-wpc-step__label">
              {group.status === 'completed' && group.completedLabel ? group.completedLabel : group.label}
            </span>
            <span className="uich-wpc-step__desc">{STEP_DESCRIPTIONS[group.id]}</span>
          </span>
          <span className="uich-wpc-step__right">
            <span className="uich-wpc-step__state">{stateLabel}</span>
            {(group.status === 'completed' || group.status === 'active') && (
              <svg className="uich-wpc-step__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </div>

        {isExpanded && group.items.length > 0 && (
          <div className="uich-wpc-import-group-body">
            {group.items.map((item) => (
              <div key={item.id} className={`uich-wpc-import-sub-item uich-wpc-import-sub-item-${item.status}`}>
                <SubItemIcon status={item.status} />
                <div className="uich-wpc-import-sub-main">
                  <span className="uich-wpc-import-sub-label">{item.label}</span>
                  {item.status === 'active' && item.progressNote ? (
                    <span className="uich-wpc-import-sub-progress">{item.progressNote}</span>
                  ) : null}
                  {item.status === 'failed' && item.failureNote ? (
                    <FailureNote
                      note={item.failureNote}
                      hint={item.failureHint}
                      detail={item.failureDetail}
                    />
                  ) : null}
                </div>

                {item.status === 'failed' && onRetryItem && (
                  <button
                    type="button"
                    className="uich-wpc-sub-retry-btn"
                    onClick={() => onRetryItem(group.id, item)}
                  >
                    {__('Retry', 'uichemy')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {group.status === 'failed' && onRetryGroup && (
          <button
            type="button"
            className="uich-wpc-group-retry-btn"
            onClick={(e) => { e.stopPropagation(); onRetryGroup(group.id); }}
          >
            {__('Retry', 'uichemy')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The failure copy under a sub-item: what went wrong, what to do about it, and
 * the server's own words tucked behind a disclosure.
 *
 * Layered deliberately. The note answers "what happened", the hint answers
 * "what now" — that pair is what a site owner can act on. `detail` is the
 * server text and is for whoever is debugging, so it starts closed rather than
 * dumping a wall of text into the progress list.
 *
 * @param {{ note: string, hint?: string, detail?: string }} props
 */
function FailureNote({ note, hint, detail }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="uich-wpc-import-sub-failure" role="note">
      <p className="uich-wpc-import-sub-note">{note}</p>

      {hint ? <p className="uich-wpc-import-sub-hint">{hint}</p> : null}

      {detail ? (
        <div className="uich-wpc-import-sub-detail">
          <button
            type="button"
            className="uich-wpc-import-sub-detail-toggle"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
          >
            {showDetail
              ? __('Hide technical details', 'uichemy')
              : __('Show technical details', 'uichemy')}
          </button>
          {showDetail ? (
            <pre className="uich-wpc-import-sub-detail-body">{detail}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Group header checkbox: checked only when every page in the group is selected (no partial / indeterminate). */
function GroupSelectCheckbox({ selectedCount, totalCount, onChange, ariaLabel }) {
  const allSelected = totalCount > 0 && selectedCount === totalCount;

  return (
    <span className="uich-wpc-checkbox-custom-wrap uich-wpc-checkbox-custom-wrap--sm">
      <input
        type="checkbox"
        checked={allSelected}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span className="uich-wpc-checkbox-custom" aria-hidden="true">
        <svg className="uich-wpc-checkbox-custom__check" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11.6666 3.5L5.24992 9.91667L2.33325 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ImportScreen({
  project,
  selectedPages,
  onSelectedPagesChange,
  onBack,
  onBackToProjects,
  conceptNumber = 1,
  builderOverride = null,
}) {
  const [isNextLoading, setIsNextLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [importGroups, setImportGroups] = useState(makeInitialGroups);
  /** Latest groups for retry handlers (avoid stale closure when reading failed page ids). */
  const importGroupsRef = useRef(importGroups);
  importGroupsRef.current = importGroups;
  const [importComplete, setImportComplete] = useState(false);
  const [timeSaved, setTimeSaved] = useState('2 hours');
  const [importError, setImportError] = useState(null);

  // Stores per-group "retry + continue from here" functions, set during handleNext
  const groupRetryRef = useRef({});
  // Stores plugin meta by plugin name for per-item retry
  const pluginMetaRef = useRef({});
  /** TPAE widget/extension slugs from fetch-replacement-json (same scan as stored JSON on server). */
  const tpaeEnableListsRef = useRef({ widget_list: [], extensions_list: [] });
  /** Gutenberg block names from fetch-replacement-json (for enable-blocks in finalize). */
  const blockListRef = useRef([]);

  const { groups: pageGroups, allPages } = useMemo(
    () => normalizeProjectPages(project, pageThumbnail()),
    [project]
  );

  const [filterKey, setFilterKey] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openGroupKey, setOpenGroupKey] = useState(null);

  const [advancedConfigOpen, setAdvancedConfigOpen] = useState(false);
  const [installNexterTheme, setInstallNexterTheme] = useState(true);
  const [resetContent, setResetContent] = useState(false);
  const [configSeo, setConfigSeo] = useState(true);
  const [configPerformance, setConfigPerformance] = useState(true);
  const [configSecurity, setConfigSecurity] = useState(true);

  useEffect(() => {
    if (pageGroups.length > 0) {
      setOpenGroupKey(pageGroups[0].key);
    } else {
      setOpenGroupKey(null);
    }
  }, [project?.projectId, pageGroups]);

  const visibleGroups = useMemo(() => {
    let list = filterKey === 'all' ? pageGroups : pageGroups.filter((g) => g.key === filterKey);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list
      .map((g) => ({
        ...g,
        pages: g.pages.filter((p) => p.label.toLowerCase().includes(q)),
      }))
      .filter((g) => g.pages.length > 0);
  }, [pageGroups, filterKey, searchQuery]);

  const importPageSubtitle = useMemo(() => {
    // The SEO / Performance / Security checkboxes are gated behind a "Coming Soon" badge,
    // so we no longer surface them in the subtitle, promising to apply settings the user
    // can't actually toggle would be misleading. Once those features ship, restore the
    // previous selected-list suffix here.
    return __('Choose the pages and setup options you want to import.', 'uichemy');
  }, []);

  const isElementorBuilder = builderOverride
    ? builderOverride === 'elementor'
    : Array.isArray(project?.builder) && project.builder.includes('elementor');

  const requiredPluginLabels = useMemo(
    () => getRequiredPluginDisplayLabels(project?.requiredPlugins, isElementorBuilder ? 'elementor' : 'gutenberg'),
    [project?.requiredPlugins, isElementorBuilder]
  );

  // ── Success sequence when progress hits 100% ───────────────────────────────
  useEffect(() => {
    if (!isImporting || overallProgress < 100) return;
    const t = setTimeout(() => {
      setIsImporting(false);
      setImportComplete(true);
      const hours = Math.max(1, Math.floor(selectedPages.length * 0.5));
      setTimeSaved(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }, 500);
    return () => clearTimeout(t);
  }, [isImporting, overallProgress, selectedPages.length, allPages.length]);

  // ── State helpers ──────────────────────────────────────────────────────────

  const activateGroup = useCallback((id, items) => {
    setImportGroups((prev) => {
      // Single-open accordion: activating a step collapses every other step so
      // only the live one stays expanded.
      let next = prev.map((g) =>
        g.id === id
          ? { ...g, status: 'active', expanded: true, items: items ?? g.items }
          : { ...g, expanded: false }
      );
      if (id === 'plugins') {
        next = reconcilePluginsGroupState(next);
      }
      return next;
    });
  }, []);

  const completeGroup = useCallback((id) => {
    setImportGroups((prev) =>
      prev.map((g) => {
        if (g.id !== id) {
          return g;
        }
        const items = g.items.map((it) => {
          if (it.status === 'failed') {
            return { ...it, status: 'failed' };
          }
          const next = { ...it, status: 'completed' };
          delete next.failureNote;
          return next;
        });
        const hasFailed = items.some((it) => it.status === 'failed');
        return {
          ...g,
          status: hasFailed ? 'failed' : 'completed',
          expanded: hasFailed,
          items,
        };
      })
    );
  }, []);

  const setSubItemStatus = useCallback((groupId, itemId, status, opts = null) => {
    const fallbackFailed = __('This step failed. Please try again.', 'uichemy');
    setImportGroups((prev) => {
      let next = prev.map((g) =>
        g.id === groupId
          ? {
            ...g,
            items: g.items.map((it) => {
              if (it.id !== itemId) return it;
              if (status !== 'failed') {
                const nextItem = { ...it, status };
                delete nextItem.failureNote;
                return nextItem;
              }
              const raw =
                opts && typeof opts.failureNote === 'string' ? opts.failureNote.trim() : '';
              return { ...it, status, failureNote: raw || fallbackFailed };
            }),
          }
          : g
      );
      if (groupId === 'plugins') {
        next = reconcilePluginsGroupState(next);
      }
      return next;
    });
  }, []);

  const handleToggleGroup = useCallback((id) => {
    setImportGroups((prev) =>
      prev.map((g) =>
        // Single-open accordion: opening one completed step collapses the others.
        g.id === id ? { ...g, expanded: !g.expanded } : { ...g, expanded: false }
      )
    );
  }, []);

  /**
   * Activate a group, tick sub-items while running API in parallel.
   * On API error: marks group + active item as 'failed', re-throws.
   */
  /**
   * Drive a group's rows while one API call runs.
   *
   * The rows used to be pure theatre: a timer walked them at a fixed interval
   * while a single request ran for however long it ran, so the last row was
   * always the one holding the bag when something failed (which is why a fetch
   * failure always read as "Theme Settings"). `apiCallFn` is now handed an
   * `onProgress` callback — the moment the server reports real numbers the
   * timer stops driving anything and the rows follow the actual work.
   */
  const runGroupPhase = useCallback(async (groupId, items, apiCallFn, delayPerItem = 700) => {
    activateGroup(groupId, items.map((it) => ({ ...it, status: 'pending' })));

    let sawRealProgress = false;

    let lastActiveIdx = 0;

    const applyRealProgress = (progress) => {
      if (!progress || typeof progress !== 'object') return;
      sawRealProgress = true;

      const total = Number(progress.total) || 0;
      const current = Number(progress.current) || 0;

      // Phases that report no counter (a step that is one long operation, or an
      // image download inside a step that owns its own counter) must not reset
      // the row. Without this a count-less phase computes fraction 0 and throws
      // the list back to the first row mid-run.
      const activeIdx =
        total > 0
          ? Math.min(items.length - 1, Math.floor(Math.min(1, current / total) * items.length))
          : lastActiveIdx;
      lastActiveIdx = activeIdx;

      setImportGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
              ...g,
              items: g.items.map((it, idx) => ({
                ...it,
                status: idx < activeIdx ? 'completed' : idx === activeIdx ? 'active' : 'pending',
                progressNote: idx === activeIdx ? progressNoteFor(progress, current, total) : '',
              })),
            }
        )
      );
    };

    const apiPromise = apiCallFn(applyRealProgress);

    for (let i = 0; i < items.length && !sawRealProgress; i++) {
      setImportGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
              ...g,
              items: g.items.map((it, idx) => ({
                ...it,
                status: idx < i ? 'completed' : idx === i ? 'active' : 'pending',
              })),
            }
        )
      );
      await sleep(delayPerItem);
    }

    let result;
    try {
      result = await apiPromise;
    } catch (err) {
      const failure = failureFromCaught(err);
      setImportGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
              ...g,
              status: 'failed',
              items: g.items.map((it) =>
                it.status === 'active' ? { ...it, status: 'failed', ...failure } : it
              ),
            }
        )
      );
      throw err;
    }

    completeGroup(groupId);
    return result;
  }, [activateGroup, completeGroup]);

  // ── Per-item retry (theme/plugins) ───────────────────────────────────────────────

  const handlePluginItemRetry = useCallback(async (groupId, item) => {
    const itemMeta = pluginMetaRef.current[item.id];
    if (!itemMeta) return;

    setSubItemStatus(groupId, item.id, 'active');
    try {
      if (itemMeta.type === 'pro') {
        const retryRes = await downloadProPlugins({
          requiredPlugins: buildProPluginRetryPayload(itemMeta.proPayload, itemMeta.url),
        });
        const row = Array.isArray(retryRes?.downloaded)
          ? retryRes.downloaded.find((d) => d && d.url === itemMeta.url)
          : null;
        const ok = row && (row.success === true || row.success);
        const proFail =
          !ok && row && typeof row.message === 'string' && row.message.trim()
            ? row.message.trim()
            : __('Could not download this plugin.', 'uichemy');
        setSubItemStatus(
          groupId,
          item.id,
          ok ? 'completed' : 'failed',
          ok ? undefined : { failureNote: proFail }
        );
        if (ok) {
          delete pluginMetaRef.current[item.id];
        }
        return;
      }
      let res;
      if (itemMeta.type === 'theme') {
        res = await installTheme({ theme_slug: itemMeta.slug || itemMeta.original_slug });
      } else {
        res = await installPlugin({
          original_slug: itemMeta.original_slug,
          plugin_slug: itemMeta.plugin_slug,
        });
      }
      const newStatus = themeOrPluginInstallSucceeded(res) ? 'completed' : 'failed';
      const restFail =
        failureMessageFromRestPayload(res) ||
        __('Installation did not finish successfully.', 'uichemy');
      setSubItemStatus(
        groupId,
        item.id,
        newStatus,
        newStatus === 'failed' ? { failureNote: restFail } : undefined
      );
      if (newStatus === 'completed') {
        delete pluginMetaRef.current[item.id];
      }
    } catch (err) {
      reportError('IMPORT_STEP_FAILED', { message: messageFromCaught(err), level: 'error', stack: err?.stack, context: { step: item.id, group: groupId } });
      setSubItemStatus(groupId, item.id, 'failed', failureFromCaught(err));
    }
  }, [setSubItemStatus]);

  // ── Per-group retry (content / pages / finalize) ───────────────────────────

  const handleGroupRetry = useCallback(async (groupId) => {
    const fn = groupRetryRef.current[groupId];
    if (!fn) return;

    let pagesRetryOpts = {};
    if (groupId === 'pages') {
      const pagesGroup = importGroupsRef.current.find((g) => g.id === 'pages');
      const failedIds = (pagesGroup?.items ?? [])
        .filter((it) => it.status === 'failed')
        .map((it) => it.id)
        .filter(Boolean);
      if (failedIds.length > 0) {
        pagesRetryOpts = { onlyItemIds: failedIds };
      }
    }

    setImportGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, status: 'pending', expanded: false } : g
      )
    );
    await fn(pagesRetryOpts);
  }, []);

  // ── Main import handler ────────────────────────────────────────────────────

  const handlePageToggle = (pageId) => {
    onSelectedPagesChange((prev) =>
      prev.includes(pageId) ? prev.filter((id) => id !== pageId) : [...prev, pageId]
    );
  };

  const toggleGroupPages = useCallback(
    (group) => {
      const ids = group.pages.map((p) => p.id).filter(Boolean);
      if (ids.length === 0) return;
      const allInGroup = ids.every((id) => selectedPages.includes(id));
      onSelectedPagesChange((prev) => {
        if (allInGroup) return prev.filter((id) => !ids.includes(id));
        const set = new Set(prev);
        ids.forEach((id) => set.add(id));
        return [...set];
      });
    },
    [selectedPages, onSelectedPagesChange]
  );

  const groupSelectionCounts = useCallback(
    (group) => {
      const ids = group.pages.map((p) => p.id).filter(Boolean);
      const n = ids.filter((id) => selectedPages.includes(id)).length;
      return { selected: n, total: ids.length };
    },
    [selectedPages]
  );

  const hasSelectionInGroup = useCallback(
    (group) => group.pages.some((p) => selectedPages.includes(p.id)),
    [selectedPages]
  );

  const handleNext = async () => {
    if (selectedPages.length === 0) {
      setImportError(__('Please select at least one page to import.', 'uichemy'));
      reportError('IMPORT_NO_PAGES_SELECTED', { level: 'warning' });
      return;
    }
    setImportError(null);

    // Immediately switch to import progress screen (no wait for API).
    setIsImporting(true);
    setOverallProgress(5);
    setImportGroups(makeInitialGroups());
    groupRetryRef.current = {};
    pluginMetaRef.current = {};
    tpaeEnableListsRef.current = { widget_list: [], extensions_list: [] };
    blockListRef.current = [];

    // Optional reset: move existing posts/pages/theme-builder templates to draft
    // BEFORE importing any new content (nothing is deleted, restorable from drafts).
    if (resetContent) {
      try {
        await resetExistingContent();
      } catch (err) {
        reportError('IMPORT_RESET_CONTENT_FAILED', { message: messageFromCaught(err), level: 'error', stack: err?.stack });
        setImportError(
          messageFromCaught(err) ||
          __('Failed to reset existing content. Please try again.', 'uichemy')
        );
        setIsImporting(false);
        return;
      }
    }

    const pagesList = allPages
      .filter((p) => selectedPages.includes(p.id))
      .map((p) => p.pageName || p.label)
      .filter(Boolean);

    // ── Run in parallel: Phase 1 (plugins) + project-replacement (Elementor or Gutenberg) API ──────────
    const runPhase1Plugins = async () => {
      const builder = isElementorBuilder ? 'elementor' : 'gutenberg';
      const freePlugins = getRequiredPluginsFree(project?.requiredPlugins, builder);
      const proPluginUrls = getRequiredPluginsPro(project?.requiredPlugins, builder);
      const proPayload = { free: freePlugins, pro: proPluginUrls };

      // Show sitemaps plugin list immediately (before check-requirements / download-pro return).
      const placeholderRows = buildPluginGroupPlaceholderItems(project?.requiredPlugins, { installNexterTheme, builder });
      if (placeholderRows.length > 0) {
        activateGroup('plugins', placeholderRows);
      }

      const [requirementsResult, downloadProResult] = await Promise.all([
        checkRequirements({ requiredPlugins: freePlugins }),
        downloadProPlugins({ requiredPlugins: proPayload }),
      ]);
      const theme = requirementsResult?.theme;
      const plugins = requirementsResult?.plugins || [];
      const proResultsByUrl = new Map();
      if (Array.isArray(downloadProResult?.downloaded)) {
        for (const row of downloadProResult.downloaded) {
          if (row && typeof row.url === 'string') {
            proResultsByUrl.set(row.url, row);
          }
        }
      }

      const allItems = [];
      if (theme && installNexterTheme) {
        allItems.push({
          id: theme.name,
          label: __('Nexter WP Theme', 'uichemy'),
          status: theme.status === 'active' ? 'completed' : 'pending',
          type: 'theme',
          original_slug: theme.original_slug,
          slug: theme.slug,
        });
      }
      for (const p of plugins) {
        allItems.push({
          id: p.name,
          label: p.label,
          status: p.status === 'active' ? 'completed' : 'pending',
          type: 'plugin',
          original_slug: p.original_slug,
          plugin_slug: p.plugin_slug,
        });
      }
      for (let i = 0; i < proPluginUrls.length; i++) {
        const url = proPluginUrls[i];
        const row = proResultsByUrl.get(url);
        const proOk = row && (row.success === true || row.success);
        const id = `uich-wpc-pro-${i}`;
        allItems.push({
          id,
          label: labelFromZipUrl(url),
          status: proOk ? 'completed' : 'failed',
          type: 'pro',
          url,
          proPayload,
        });
      }

      activateGroup(
        'plugins',
        allItems.map((it) => {
          const row = { id: it.id, label: it.label, status: it.status };
          if (it.type === 'pro' && it.status === 'failed') {
            const proRow = proResultsByUrl.get(it.url);
            const msg =
              proRow && typeof proRow.message === 'string' && proRow.message.trim()
                ? proRow.message.trim()
                : '';
            if (msg) row.failureNote = msg;
          }
          return row;
        })
      );

      const toInstall = allItems.filter((item) => item.status !== 'completed');
      for (const item of toInstall) {
        pluginMetaRef.current[item.id] = item;
        setSubItemStatus('plugins', item.id, 'active');
        try {
          if (item.type === 'pro') {
            const res = await downloadProPlugins({
              requiredPlugins: buildProPluginRetryPayload(item.proPayload, item.url),
            });
            const row = Array.isArray(res?.downloaded) ? res.downloaded.find((d) => d && d.url === item.url) : null;
            const ok = row && (row.success === true || row.success);
            const proFail =
              !ok && row && typeof row.message === 'string' && row.message.trim()
                ? row.message.trim()
                : __('Could not download this plugin.', 'uichemy');
            setSubItemStatus(
              'plugins',
              item.id,
              ok ? 'completed' : 'failed',
              ok ? undefined : { failureNote: proFail }
            );
            if (ok) {
              delete pluginMetaRef.current[item.id];
            }
            continue;
          }
          let res;
          if (item.type === 'theme') {
            res = await installTheme({ theme_slug: item.slug || item.original_slug });
          } else {
            res = await installPlugin({
              original_slug: item.original_slug,
              plugin_slug: item.plugin_slug,
            });
          }
          const newStatus = themeOrPluginInstallSucceeded(res) ? 'completed' : 'failed';
          const restFail =
            failureMessageFromRestPayload(res) ||
            __('Installation did not finish successfully.', 'uichemy');
          setSubItemStatus(
            'plugins',
            item.id,
            newStatus,
            newStatus === 'failed' ? { failureNote: restFail } : undefined
          );
          if (newStatus === 'completed') delete pluginMetaRef.current[item.id];
        } catch (err) {
          reportError('IMPORT_STEP_FAILED', { message: messageFromCaught(err), level: 'error', stack: err?.stack, context: { step: item.id, group: 'plugins' } });
          setSubItemStatus('plugins', item.id, 'failed', failureFromCaught(err));
        }
      }

      completeGroup('plugins');
      setOverallProgress(25);
    };

    const fetchDownloadUrls = () =>
      (isElementorBuilder ? replaceProjectElementor : replaceProjectGutenberg)({
        projectId: project.projectId,
        conceptNumber,
        pagesList,
      });

    // Kick off plugin/theme installation now, it must finish before page import (below)
    // runs, but must NOT gate how soon we consume the download URLs fetchDownloadUrls() is
    // about to mint. Those URLs come from the UiChemy backend with a short (~1 minute)
    // expiry; installing plugins/themes can easily take longer than that on real hosting,
    // so awaiting both here (as before) reliably handed fetch-replacement-json URLs that
    // had already expired. Attach a no-op .catch() so a later plugin-phase rejection
    // doesn't surface as an unhandled promise rejection before we get around to awaiting
    // it (after the content fetch below).
    const phase1PluginsPromise = runPhase1Plugins();
    phase1PluginsPromise.catch(() => { });

    let response;
    try {
      response = await fetchDownloadUrls();
    } catch (err) {
      reportError('IMPORT_START_FAILED', { message: err?.message, level: 'error', stack: err?.stack });
      setImportError(err?.message || __('Failed to start import. Please try again.', 'uichemy'));
      setIsImporting(false);
      return;
    }

    // Extract BEFORE flattening, bucket info is lost after normalizeDownloadUrls
    const rawElementorTemplateUrls = Array.isArray(response?.downloadUrls?.elementor_template) ? response.downloadUrls.elementor_template : [];

    const downloadUrls = normalizeDownloadUrls(response?.downloadUrls);
    const meta = {
      concept: response.concept,
      pages: response.pages,
      projectName: project.projectName || '',
      tagline: project?.tagline || '',
      meta: {
        ...(response.meta || {}),
        // Inject so PHP get_elementor_template_filenames_from_meta() can identify template files
        ...(rawElementorTemplateUrls.length > 0 ? { elementor_template: rawElementorTemplateUrls } : {}),
      },
    };

    // ── Build content + page items (captured in closures below) ────────────
    const rawFilenames = downloadUrls.map(filenameFromUrl);
    const lowerFilenames = rawFilenames.map((f) => f.toLowerCase());

    const contentItems = [];
    if (lowerFilenames.includes('globals.json'))
      contentItems.push({ id: 'globals', label: __('Global Settings', 'uichemy'), status: 'pending' });
    if (lowerFilenames.includes('navbar.json'))
      contentItems.push({ id: 'navbar', label: __('Plugin Settings', 'uichemy'), status: 'pending' });
    if (lowerFilenames.includes('footer.json'))
      contentItems.push({ id: 'footer', label: __('Theme Settings', 'uichemy'), status: 'pending' });
    if (contentItems.length === 0)
      contentItems.push({ id: 'content', label: __('Site Content', 'uichemy'), status: 'pending' });

    // Build one item per page + navbar/footer/404 + blog templates as separate steps.
    const rawPages = Array.isArray(meta.pages) ? meta.pages : [];
    const hasNavbar = lowerFilenames.includes('navbar.json');
    const hasFooter = lowerFilenames.includes('footer.json');
    const has404 = lowerFilenames.includes('404.json');

    // Detect which blog-related files are present in downloadUrls.
    const blogItems = [];
    for (const fn of lowerFilenames) {
      const cfg = BLOG_FILE_MAP[fn];
      if (cfg) {
        blogItems.push({
          id: fn.replace(/[^a-z0-9]/g, '-'),
          label: cfg.label,
          pageName: cfg.pageName ?? cfg.label,  // must match filename stem for API lookup (e.g. Blog for blog.json)
          type: cfg.type,
          el_type: cfg.el_type || null,
          archive_rule: cfg.archive_rule || '',
          conditions: cfg.conditions || [],
          hooks_action: cfg.hooks_action || null,
          status: 'pending',
        });
      }
    }

    // Gutenberg bundles often include blog-post-content.json without Blog.json / theme templates.
    // Elementor flows typically list those JSON files in BLOG_FILE_MAP, still require both paths.
    const hasBlogPostContentJson = lowerFilenames.includes('blog-post-content.json');
    const hasBlogContent = blogItems.length > 0 || hasBlogPostContentJson;

    // Pages that are handled as dedicated special items below, importing them
    // again from rawPages would create duplicate entries (e.g. 404 as a regular
    // page AND as a theme-builder 404 template).
    const specialPageNames = new Set(['404', 'navbar', 'header', 'footer']);

    // `pages` is the API's own list and it is not always complete: it has been
    // seen to mint download URLs for a whole bucket (legal_pages -- Privacy
    // Policy, Terms, ...) while omitting those pages from `pages`. Nothing then
    // built an import step for them, so the files were fetched, written to
    // stored data, and never imported -- with no error anywhere. Derive the
    // leftovers from the downloaded file list so a bucket missing from `pages`
    // cannot silently drop pages again.
    const listedPageFiles = new Set(
      rawPages
        .map((p) => (typeof p === 'string' ? p : p?.pageName || ''))
        .filter(Boolean)
        .map((name) => `${name}.json`.toLowerCase())
    );
    const elementorTemplateFiles = new Set(
      rawElementorTemplateUrls.map((u) => filenameFromUrl(u).toLowerCase())
    );
    // Only ever sweep in a page the user actually ticked. `pagesList` is what
    // was asked for, so a file outside it is not something to import quietly.
    const selectedPageFiles = new Set(pagesList.map((name) => `${name}.json`.toLowerCase()));
    const unlistedPageItems = [];
    const seenUnlisted = new Set();
    rawFilenames.forEach((file, i) => {
      const lower = lowerFilenames[i];
      if (!lower.endsWith('.json')) return;
      if (seenUnlisted.has(lower) || listedPageFiles.has(lower)) return;
      if (!selectedPageFiles.has(lower)) return;
      if (NON_PAGE_FILES.has(lower) || BLOG_FILE_MAP[lower]) return;
      if (elementorTemplateFiles.has(lower)) return;
      const name = file.replace(/\.json$/i, '');
      if (!name || specialPageNames.has(name.toLowerCase())) return;
      seenUnlisted.add(lower);
      unlistedPageItems.push({
        id: `page-unlisted-${i}`,
        label: prettyPageLabel(name),
        pageName: name,
        type: 'page',
        status: 'pending',
      });
    });

    if (unlistedPageItems.length > 0) {
      // Importing them regardless, but record it: a bucket dropping out of
      // `pages` is an upstream regression worth seeing rather than absorbing.
      reportError('IMPORT_PAGES_MISSING_FROM_LIST', {
        level: 'warning',
        message: sprintf(
          /* translators: %s: comma-separated page names. */
          __('These pages were downloaded but missing from the API page list, importing them anyway: %s', 'uichemy'),
          unlistedPageItems.map((it) => it.label).join(', ')
        ),
        context: { pageNames: unlistedPageItems.map((it) => it.pageName) },
      });
    }

    const pageItems = [
      // Blog posts run first (see runPages) so the blog listing / detail / archive
      // pages have posts to display, list it first in the UI to match.
      ...(hasBlogContent ? [{ id: 'blog-posts', label: __('Creating Blog Posts', 'uichemy'), pageName: null, type: 'blog-posts', status: 'pending' }] : []),
      ...rawPages.map((p, i) => {
        const name = typeof p === 'string' ? p : (p.pageName || sprintf(__('Page %1$s', 'uichemy'), i + 1));
        const lowerName = (name + '.json').toLowerCase();
        // Skip blog-template pages (already added via blogItems).
        if (BLOG_FILE_MAP[lowerName]) return null;
        // Skip pages whose JSON was not included in the download URLs.
        if (!lowerFilenames.includes(lowerName)) return null;
        // Skip pages that have a dedicated special handler (navbar/footer/404).
        if (specialPageNames.has(name.toLowerCase())) return null;
        return { id: `page-${i}`, label: name, pageName: name, type: 'page', status: 'pending' };
      }).filter(Boolean),
      ...unlistedPageItems,
      ...blogItems,
      ...(hasNavbar ? [{ id: 'navbar', label: __('Navbar (Header)', 'uichemy'), pageName: 'Navbar', type: 'navbar', status: 'pending' }] : []),
      ...(hasFooter ? [{ id: 'footer', label: __('Footer', 'uichemy'), pageName: 'Footer', type: 'footer', status: 'pending' }] : []),
      ...(has404 ? [{ id: '404', label: __('404 Page', 'uichemy'), pageName: '404', type: '404', status: 'pending' }] : []),
    ];

    if (pageItems.length === 0) {
      pageItems.push({ id: 'page-0', label: __('Importing pages', 'uichemy'), pageName: '', type: 'page', status: 'pending' });
    }

    // ── Phase 4: finalize, real API calls per step ─────────────────────────
    const runFinalize = async () => {
      groupRetryRef.current['finalize'] = runFinalize;

      const enableUsedItem = isElementorBuilder
        ? { id: 'enable-widgets', label: __('Enabling used widgets', 'uichemy') }
        : { id: 'enable-blocks', label: __('Enabling used blocks', 'uichemy') };

      const finalizeItems = [
        { ...enableUsedItem, status: 'pending' },
        { id: 'plugin-settings', label: __('Applying plugin settings', 'uichemy'), status: 'pending' },
        { id: 'theme-settings', label: __('Applying theme settings', 'uichemy'), status: 'pending' },
        { id: 'nexter-settings', label: __('Applying Nexter settings', 'uichemy'), status: 'pending' },
      ];
      activateGroup('finalize', finalizeItems.map((it) => ({ ...it, status: 'pending' })));

      const applyAdvancedPluginSettings = configSeo || configPerformance || configSecurity;

      setSubItemStatus('finalize', enableUsedItem.id, 'active');
      try {
        if (isElementorBuilder) {
          const { widget_list: wl, extensions_list: el } = tpaeEnableListsRef.current;
          await enableWidgets({
            widget_list: Array.isArray(wl) ? wl : [],
            extensions_list: Array.isArray(el) ? el : [],
          });
        } else {
          await enableBlocks({
            block_list: Array.isArray(blockListRef.current) ? blockListRef.current : [],
          });
        }
        setSubItemStatus('finalize', enableUsedItem.id, 'completed');
      } catch {
        // Non-fatal, extensions may already be enabled or handle on next load
        setSubItemStatus('finalize', enableUsedItem.id, 'completed');
      }

      setSubItemStatus('finalize', 'plugin-settings', 'active');
      if (applyAdvancedPluginSettings) {
        try {
          await applyPluginSettings();
          setSubItemStatus('finalize', 'plugin-settings', 'completed');
        } catch (err) {
          reportError('IMPORT_PLUGIN_SETTINGS_FAILED', { message: messageFromCaught(err), level: 'warning', stack: err?.stack });
          setSubItemStatus('finalize', 'plugin-settings', 'failed', {
            failureNote:
              messageFromCaught(err) ||
              __('Could not apply plugin settings. Check site permissions or try again.', 'uichemy'),
          });
        }
      } else {
        setSubItemStatus('finalize', 'plugin-settings', 'completed');
      }

      setSubItemStatus('finalize', 'theme-settings', 'active');
      if (installNexterTheme) {
        try {
          await applyThemeSettings();
          setSubItemStatus('finalize', 'theme-settings', 'completed');
        } catch (err) {
          reportError('IMPORT_THEME_SETTINGS_FAILED', { message: messageFromCaught(err), level: 'warning', stack: err?.stack });
          setSubItemStatus('finalize', 'theme-settings', 'failed', {
            failureNote:
              messageFromCaught(err) ||
              __('Could not apply theme settings. Try again or apply them manually in the Customizer.', 'uichemy'),
          });
        }
      } else {
        setSubItemStatus('finalize', 'theme-settings', 'completed');
      }

      setSubItemStatus('finalize', 'nexter-settings', 'active');
      if (installNexterTheme) {
        try {
          const nexterSettingsResult = await applyNexterSettings();
          // Not a thrown error, the call still succeeds, but e.g. performance/security
          // settings are dead writes without Nexter Extension installed, so at minimum
          // report it for visibility instead of a silent "completed" with nothing applied.
          if (Array.isArray(nexterSettingsResult?.warnings) && nexterSettingsResult.warnings.length > 0) {
            reportError('IMPORT_NEXTER_SETTINGS_PARTIAL', {
              message: nexterSettingsResult.warnings.join(' | '),
              level: 'warning',
            });
          }
          setSubItemStatus('finalize', 'nexter-settings', 'completed');
        } catch (err) {
          reportError('IMPORT_NEXTER_SETTINGS_FAILED', { message: messageFromCaught(err), level: 'warning', stack: err?.stack });
          setSubItemStatus('finalize', 'nexter-settings', 'failed', {
            failureNote:
              messageFromCaught(err) ||
              __('Could not apply Nexter settings. Try again or configure them manually.', 'uichemy'),
          });
        }
      } else {
        setSubItemStatus('finalize', 'nexter-settings', 'completed');
      }

      // Best-effort DB hygiene, not a user-facing step: delete the stored import JSON
      // (uich_webpage_replacement_data can be multiple MB) now that nothing else needs it.
      // Unlike the plugin-settings/theme-settings/nexter-settings steps above, this must
      // run unconditionally regardless of any advanced-config/installNexterTheme toggle,
      // otherwise that data is left in wp_options indefinitely.
      try {
        await cleanupImportData();
      } catch (err) {
        reportError('IMPORT_CLEANUP_FAILED', { message: messageFromCaught(err), level: 'warning', stack: err?.stack });
      }

      completeGroup('finalize');
      setOverallProgress(100);
    };

    // ── Phase 3: pages, parallel batches (import-single-page is independent per file in stored data) ──
    const runPages = async (opts = {}) => {
      const { continueToFinalize = true, onlyItemIds = null } = opts;
      const retryFailedOnly = Array.isArray(onlyItemIds) && onlyItemIds.length > 0;
      groupRetryRef.current['pages'] = (retryOpts = {}) =>
        runPages({ continueToFinalize: true, ...retryOpts });

      const pagesItemsForUi = retryFailedOnly
        ? pageItems.map((it) =>
          onlyItemIds.includes(it.id) ? { ...it, status: 'pending' } : { ...it, status: 'completed' }
        )
        : pageItems.map((it) => ({ ...it, status: 'pending' }));
      activateGroup('pages', pagesItemsForUi);

      let blogPostsOnly = pageItems.filter((it) => it.type === 'blog-posts');
      let importablePages = pageItems.filter((it) => it.type !== 'blog-posts');
      if (retryFailedOnly) {
        importablePages = importablePages.filter((it) => onlyItemIds.includes(it.id));
        blogPostsOnly = blogPostsOnly.filter((it) => onlyItemIds.includes(it.id));
      }

      let hadPageFailure = false;
      const runOnePageItem = async (item) => {
        setSubItemStatus('pages', item.id, 'active');
        try {
          let res;
          if (item.type === 'blog-posts') {
            // Batched by offset/limit so each HTTP request stays short — a single
            // all-at-once request downloads + thumbnails every post's images inline
            // and runs long enough to be killed by PHP/proxy/Cloudflare timeouts.
            //
            // The batch size ADAPTS instead of being pinned to 1: a fixed 1 was
            // chosen for the slowest hosts, which taxed every fast host with a
            // full HTTP round-trip per post. Start at 1 (worst-case safe), grow
            // by one after each quick batch, shrink back hard the moment one
            // runs long. The ceiling stays low because each post can carry many
            // image downloads and the request must stay well inside PHP's
            // 30s default execution window even at the ceiling.
            const BATCH_MAX = 3;
            const GROW_UNDER_MS = 5000;   // batch finished fast -> can afford more
            const SHRINK_OVER_MS = 15000; // batch ran long -> back to singles
            let limit = 1;
            let offset = 0;
            let guard = 0;
            do {
              const t0 = Date.now();
              res = await importBlogPosts({ offset, limit });
              const took = Date.now() - t0;
              const batchErr = failureMessageFromRestPayload(res);
              if (batchErr) throw new Error(batchErr);
              offset = typeof res?.processed === 'number' ? res.processed : offset + limit;
              if (took > SHRINK_OVER_MS) {
                limit = 1;
              } else if (took < GROW_UNDER_MS && limit < BATCH_MAX) {
                limit += 1;
              }
              guard += 1;
            } while (res && res.done === false && guard < 500);
          } else {
            res = await importSinglePage({
              pageName: item.pageName,
              type: item.type,
              el_type: item.el_type,
              archive_rule: item.archive_rule,
              hooks_action: item.hooks_action,
            });
          }
          const payloadErr = failureMessageFromRestPayload(res);
          if (payloadErr) {
            throw new Error(payloadErr);
          }
          // The server skips a template this build's tier cannot create (Archive,
          // Search, the WooCommerce types on Free) instead of failing the run.
          // The step did finish, so it is not marked failed, but it produced
          // nothing, so it is recorded rather than passing silently.
          if (res && res.skipped) {
            reportError('IMPORT_TEMPLATE_SKIPPED', {
              message: res.message || __('Template skipped.', 'uichemy'),
              level: 'warning',
              context: { pageName: item.pageName, pageType: item.type, reason: res.reason || '' },
            });
          }
          setSubItemStatus('pages', item.id, 'completed');
        } catch (err) {
          hadPageFailure = true;
          reportError('IMPORT_PAGE_IMPORT_FAILED', {
            message: messageFromCaught(err),
            level: 'error',
            stack: err?.stack,
            context: { pageName: item.pageName, pageType: item.type },
          });
          setSubItemStatus('pages', item.id, 'failed', failureFromCaught(err));
        }
      };

      // Blog posts must be created BEFORE the pages: the blog listing / detail /
      // archive templates and any menu links that reference posts only render
      // correctly once the posts exist. Run posts first (sequentially), then the
      // rest of the pages in parallel batches.
      for (const item of blogPostsOnly) {
        await runOnePageItem(item);
      }
      await runPool(importablePages, PAGE_IMPORT_CONCURRENCY, runOnePageItem);

      completeGroup('pages');
      setOverallProgress(85);
      if (continueToFinalize && !hadPageFailure) await runFinalize();
    };

    // ── Phase 2: content, fetch JSON files ─────────────────────────────────
    const runContent = async (opts = {}) => {
      const { continueToPages = true } = opts;
      // Retry must CONTINUE to pages. Content can only be retried after it
      // failed, and pages never start before content succeeds — so at retry
      // time pages have never run. With false here, a successful retry marked
      // the group Done at 55% and then simply stopped: step 3 sat on "Waiting"
      // forever with no button anywhere to resume (seen live, 2026-08-25).
      groupRetryRef.current['content'] = () => runContent({ continueToPages: true });
      try {
        const fetchResult = await runGroupPhase(
          'content',
          contentItems,
          (onProgress) => fetchReplacementJson(
            {
              downloadUrls,
              projectId: response.projectId || project.projectId,
              meta,
              builder: isElementorBuilder ? 'elementor' : 'gutenberg',
            },
            { onProgress }
          ),
          Math.max(80, Math.min(220, Math.floor(900 / Math.max(1, contentItems.length))))
        );
        if (fetchResult && typeof fetchResult === 'object') {
          tpaeEnableListsRef.current = {
            widget_list: Array.isArray(fetchResult.widget_list) ? fetchResult.widget_list : [],
            extensions_list: Array.isArray(fetchResult.extensions_list) ? fetchResult.extensions_list : [],
          };
          blockListRef.current = Array.isArray(fetchResult.block_list) ? fetchResult.block_list : [];
        }
        setOverallProgress(55);
        if (continueToPages) {
          // Page import needs the builder plugins/theme (Phase 1) active, wait for that
          // here, now that the download URLs have already been consumed above while fresh.
          try {
            await phase1PluginsPromise;
          } catch (err) {
            reportError('IMPORT_START_FAILED', { message: err?.message, level: 'error', stack: err?.stack });
            setImportError(err?.message || __('Failed to start import. Please try again.', 'uichemy'));
            setIsImporting(false);
            return;
          }
          await runPages({ continueToFinalize: true });
        }
      } catch {
        // group marked failed by runGroupPhase, retry button appears
      }
    };

    await runContent();
  };

  const handleVisitSite = () => {
    const url = getBoot().siteUrl;
    if (typeof url === 'string' && url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="uich-wpc-import-page">
      <div className="uich-wpc-import-page-wrap">

        {/* ── Import complete summary ── */}
        {importComplete && (
          <div className="uich-wpc-success-container">
            <div className="uich-wpc-success-content">
              <div className="uich-wpc-success-icon">
                <SuccessMark size={96} />
              </div>
              <div className="uich-wpc-time-saved-badge">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M8 4V8L10.5 10.5" stroke="#0A842A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="8" cy="8" r="6.5" stroke="#0A842A" strokeWidth="1.5" />
                </svg>
                <span>{sprintf(__('%1$s saved', 'uichemy'), timeSaved)}</span>
              </div>
              <h2 className="uich-wpc-success-title">{__('Your website is ready and live', 'uichemy')}</h2>
              <p className="uich-wpc-success-subtitle">
                {__('Your design is imported. Pages, styles, and settings are in place. Review it live and keep building.', 'uichemy')}
              </p>
              <div className="uich-wpc-success-actions">
                <button type="button" className="uich-wpc-success-btn uich-wpc-btn-secondary" onClick={onBackToProjects}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M15.8333 10H4.16667M4.16667 10L9.16667 15M4.16667 10L9.16667 5" stroke="currentColor" strokeWidth="1.67" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {__('Back to Projects', 'uichemy')}
                </button>
                <button type="button" className="uich-wpc-success-btn uich-wpc-btn-primary" onClick={handleVisitSite}>
                  {__('Visit Site', 'uichemy')}
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="1.67" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Importing progress ── */}
        {!importComplete && isImporting && (
          <div className="uich-wpc-importing-container">
            <div className="uich-wpc-importing-content">

              <div className="uich-wpc-importing-head">
                <h2 className="uich-wpc-importing-title">{__('Importing your design', 'uichemy')}</h2>
                <p className="uich-wpc-importing-sub">
                  {__('Building your site, one step at a time.', 'uichemy')}
                </p>
                <div className="uich-wpc-importing-meter">
                  <span className="uich-wpc-importing-track">
                    <span
                      className="uich-wpc-importing-fill"
                      style={{ width: `${Math.max(5, Math.min(100, overallProgress))}%` }}
                    />
                  </span>
                  <span className="uich-wpc-importing-pct">{Math.round(overallProgress)}%</span>
                </div>
              </div>

              <div className="uich-wpc-import-groups">
                {importGroups.map((group, i) => (
                  <ImportGroup
                    key={group.id}
                    group={group}
                    index={i + 1}
                    onToggle={handleToggleGroup}
                    onRetryGroup={group.id !== 'plugins' ? handleGroupRetry : undefined}
                    onRetryItem={group.id === 'plugins' ? handlePluginItemRetry : undefined}
                  />
                ))}
              </div>

            </div>
          </div>
        )}

        {/* ── Page selection ── */}
        {!importComplete && !isImporting && (
          <div className="uich-wpc-import-page-content">
            <div className="uich-wpc-import-page-header">
              <div className="uich-wpc-import-page-heading">
                <h2 className="uich-wpc-import-page-title">{__('Select What to Import', 'uichemy')}</h2>
                <p className="uich-wpc-import-page-subtitle">
                  {importPageSubtitle}
                </p>
              </div>
              {allPages.length > 0 && (
                <Badge variant="soft" tone="neutral" size="md" className="uich-wpc-import-selection-badge">
                  {sprintf(
                    /* translators: 1: selected count, 2: total pages */
                    __('%1$d of %2$d Pages Selected', 'uichemy'),
                    selectedPages.length,
                    allPages.length
                  )}
                </Badge>
              )}
            </div>

            {allPages.length === 0 ? (
              <p className="uich-wpc-dashboard-empty">{__('No pages found in this project.', 'uichemy')}</p>
            ) : (
              <>
                <div className="uich-wpc-import-picker-toolbar">
                  <div className="uich-wpc-import-toolbar-left">
                    {pageGroups.length > 1 && (
                      <ToggleGroup
                        type="single"
                        size="sm"
                        value={filterKey}
                        onValueChange={(v) => v && setFilterKey(v)}
                        aria-label={__('Page categories', 'uichemy')}
                      >
                        <ToggleGroupItem value="all">
                          {__('All', 'uichemy')}
                          <span className="uich-wpc-import-filter-count">{allPages.length}</span>
                        </ToggleGroupItem>
                        {pageGroups.map((g) => (
                          <ToggleGroupItem key={g.key} value={g.key}>
                            {g.label}
                            <span className="uich-wpc-import-filter-count">{g.pages.length}</span>
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    )}
                  </div>
                  <div className="uich-wpc-import-toolbar-right">
                    {allPages.length > 5 && (
                      <div className="uich-wpc-import-search-field">
                        <Input
                          type="search"
                          size="regular"
                          leftIcon={
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <circle cx="7.33" cy="7.33" r="4.58" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M13.25 13.25l-2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          }
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={__('Search pages…', 'uichemy')}
                          aria-label={__('Search pages', 'uichemy')}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {importError && selectedPages.length === 0 && (
                  <div className="uich-wpc-import-error">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M8 5v3M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span>{importError}</span>
                  </div>
                )}

                <div className="uich-wpc-import-groups-accordion">
                  {visibleGroups.length === 0 && (
                    <p className="uich-wpc-dashboard-empty">{__('No pages match your search.', 'uichemy')}</p>
                  )}
                  {visibleGroups.map((group) => {
                    const { selected: selN, total: totN } = groupSelectionCounts(group);
                    const isOpen = openGroupKey === group.key;
                    return (
                      <div key={group.key} className={`uich-wpc-import-page-group ${isOpen ? 'is-open' : ''}`}>
                        <button
                          type="button"
                          className="uich-wpc-import-page-group-header"
                          onClick={() => setOpenGroupKey(isOpen ? null : group.key)}
                          aria-expanded={isOpen}
                        >
                          <span
                            className="uich-wpc-import-group-checkbox-wrap"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            role="presentation"
                          >
                            <GroupSelectCheckbox
                              selectedCount={selN}
                              totalCount={totN}
                              onChange={() => toggleGroupPages(group)}
                              ariaLabel={sprintf(
                                /* translators: %s: group label */
                                __('Select all pages in %s', 'uichemy'),
                                group.label
                              )}
                            />
                          </span>
                          <span
                            className="uich-wpc-import-page-group-title"
                            onClick={(e) => { e.stopPropagation(); toggleGroupPages(group); }}
                          >{group.label}</span>
                          <span className="uich-wpc-import-page-group-count">
                            {sprintf(
                              /* translators: 1: selected in group, 2: total in group */
                              __('%1$d/%2$d pages', 'uichemy'),
                              selN,
                              totN
                            )}
                          </span>
                          <span className={`uich-wpc-import-page-group-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M9.60525 7.01487C9.85072 6.81469 10.213 6.82922 10.4418 7.058L15.4418 12.058C15.6859 12.3021 15.6858 12.6977 15.4418 12.9418C15.1978 13.1859 14.8021 13.1859 14.558 12.9418L9.99994 8.38369L5.44183 12.9418C5.19776 13.1859 4.80212 13.1859 4.55805 12.9418C4.31399 12.6977 4.31398 12.3021 4.55805 12.058L9.55805 7.058L9.60525 7.01487Z" fill="currentColor" />
                            </svg>
                          </span>
                        </button>
                        {isOpen && (
                          <div className="uich-wpc-import-page-group-body">
                            <div className="uich-wpc-pages-grid">
                              {group.pages.map((page) => (
                                <div
                                  key={page.id}
                                  className={`uich-wpc-page-card ${selectedPages.includes(page.id) ? 'selected' : ''}`}
                                  onClick={() => handlePageToggle(page.id)}
                                >
                                  <div className="uich-wpc-page-preview">
                                    <div className="uich-wpc-page-checkbox">
                                      <Checkbox
                                        size="sm"
                                        checked={selectedPages.includes(page.id)}
                                        onCheckedChange={() => handlePageToggle(page.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label={page.label}
                                      />
                                    </div>
                                    <div className="uich-wpc-page-thumbnail">
                                      {/* Decorative placeholder, the page doesn't exist on
                                          this site yet, so there is nothing real to preview.
                                          Rendered only when the asset URL resolved; an <img>
                                          with an empty src shows a broken-image glyph. */}
                                      {page.thumbnail ? (
                                        <img src={page.thumbnail} alt="" aria-hidden="true" />
                                      ) : null}
                                    </div>
                                    <div className="uich-wpc-page-overlay" />
                                  </div>
                                  <p className="uich-wpc-page-label">{page.label}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="uich-wpc-advanced-config">
                    <button
                      type="button"
                      className="uich-wpc-advanced-config-toggle"
                      onClick={() => setAdvancedConfigOpen((o) => !o)}
                      aria-expanded={advancedConfigOpen}
                    >
                      <span className="uich-wpc-advanced-config-toggle-left">
                        <svg className="uich-wpc-advanced-config-gear" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1.04Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {__('Advanced Configurations', 'uichemy')}
                      </span>
                      <span className={`uich-wpc-advanced-config-chevron ${advancedConfigOpen ? 'is-open' : ''}`} aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M9.60525 7.01487C9.85072 6.81469 10.213 6.82922 10.4418 7.058L15.4418 12.058C15.6859 12.3021 15.6858 12.6977 15.4418 12.9418C15.1978 13.1859 14.8021 13.1859 14.558 12.9418L9.99994 8.38369L5.44183 12.9418C5.19776 13.1859 4.80212 13.1859 4.55805 12.9418C4.31399 12.6977 4.31398 12.3021 4.55805 12.058L9.55805 7.058L9.60525 7.01487Z" fill="currentColor" />
                        </svg>
                      </span>
                    </button>

                    {advancedConfigOpen && (
                      <div className="uich-wpc-advanced-config-body">
                        <div className="uich-wpc-advanced-config-section">
                          <div className="uich-wpc-advanced-config-label-row">
                            <span className="uich-wpc-advanced-config-label">{__('Required Plugins', 'uichemy')}</span>
                            <Tooltip content={__('Plugins that will be installed or verified before import.', 'uichemy')} placement="top">
                              <span className="uich-wpc-advanced-config-info" tabIndex={0} role="img" aria-label={__('Plugins that will be installed or verified before import.', 'uichemy')}>
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
                                  <path d="M7 6.2V10M7 4.1h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                </svg>
                              </span>
                            </Tooltip>
                          </div>
                          {requiredPluginLabels.length === 0 ? (
                            <p className="uich-wpc-advanced-config-empty">{__('No required plugins listed for this project.', 'uichemy')}</p>
                          ) : (
                            <div className="uich-wpc-advanced-config-tags" role="list">
                              {requiredPluginLabels.map((name, idx) => (
                                <Badge key={`${name}-${idx}`} variant="soft" tone="neutral" role="listitem">
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  {name}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="uich-wpc-advanced-config-divider" />

                        <div className="uich-wpc-advanced-config-section">
                          <div className="uich-wpc-advanced-config-theme-row">
                            <Checkbox
                              id="uich-wpc-nexter-theme"
                              checked={installNexterTheme}
                              onCheckedChange={(v) => setInstallNexterTheme(v === true)}
                            />
                            <label className="uich-wpc-advanced-config-theme-label" htmlFor="uich-wpc-nexter-theme">{__('Nexter WP Theme', 'uichemy')}</label>
                          </div>
                          <Alert tone="warning" className="uich-wpc-advanced-config-alert">
                            {__(
                              'For the best experience, the Nexter WP Theme is recommended. Feel free to skip it if you\'re already running a lightweight, bloat-free theme.',
                              'uichemy'
                            )}
                          </Alert>
                        </div>

                        <div className="uich-wpc-advanced-config-divider" />

                        <div className="uich-wpc-advanced-config-section uich-wpc-advanced-config-section--configurations">
                          <div className="uich-wpc-advanced-configurations-panel">
                            <div className="uich-wpc-advanced-config-label-row uich-wpc-advanced-config-label-row--section-title">
                              <span className="uich-wpc-advanced-config-label uich-wpc-advanced-config-label--configurations">{__('Reset Previous Content Before Import', 'uichemy')}</span>
                              <Tooltip content={__('If enabled, your existing pages, posts, and Theme Builder content move to draft. Nothing is deleted. You can restore them anytime, or remove them manually later.', 'uichemy')} placement="top">
                                <span className="uich-wpc-advanced-config-info" tabIndex={0} role="img" aria-label={__('If enabled, your existing pages, posts, and Theme Builder content move to draft. Nothing is deleted. You can restore them anytime, or remove them manually later.', 'uichemy')}>
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
                                    <path d="M7 6.2V10M7 4.1h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                  </svg>
                                </span>
                              </Tooltip>
                            </div>
                            <div className="uich-wpc-advanced-config-options">
                              <div className="uich-wpc-advanced-config-option">
                                <Checkbox
                                  id="uich-wpc-reset-content"
                                  checked={resetContent}
                                  onCheckedChange={(v) => setResetContent(v === true)}
                                />
                                <label className="uich-wpc-advanced-config-option-copy" htmlFor="uich-wpc-reset-content">
                                  <span className="uich-wpc-advanced-config-option-heading">
                                    <span className="uich-wpc-advanced-config-option-icon" aria-hidden="true">
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M3.5 9a9 9 0 0114.7-3.3L21 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M21 4v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M20.5 15a9 9 0 01-14.7 3.3L3 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M3 20v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </span>
                                    <span className="uich-wpc-advanced-config-option-title">{__('Reset my previous content before importing', 'uichemy')}</span>
                                  </span>
                                  <span className="uich-wpc-advanced-config-option-desc">{__('Your current content moves to draft, not deleted.', 'uichemy')}</span>
                                </label>
                              </div>
                            </div>
                          </div>
                          {resetContent && (
                            <Alert tone="warning" className="uich-wpc-advanced-config-alert">
                              {__(
                                'Your current content moves to draft, not deleted. On a live or active site, take a full backup before you continue. You can restore everything from drafts anytime.',
                                'uichemy'
                              )}
                            </Alert>
                          )}
                        </div>

                        <div className="uich-wpc-advanced-config-divider" />

                        <div className="uich-wpc-advanced-config-section uich-wpc-advanced-config-section--configurations">
                          <div className="uich-wpc-advanced-configurations-panel is-disabled" aria-disabled="true">
                            <div className="uich-wpc-advanced-config-label-row uich-wpc-advanced-config-label-row--section-title">
                              <span className="uich-wpc-advanced-config-label uich-wpc-advanced-config-label--configurations">{__('Advanced Configurations', 'uichemy')}</span>
                              <Badge variant="soft" tone="warning">{__('Coming Soon', 'uichemy')}</Badge>
                            </div>
                            <div className="uich-wpc-advanced-config-options">
                              <div className="uich-wpc-advanced-config-option is-disabled" aria-disabled="true">
                                <Checkbox disabled checked={false} />
                                <div className="uich-wpc-advanced-config-option-copy">
                                  <div className="uich-wpc-advanced-config-option-heading">
                                    <span className="uich-wpc-advanced-config-option-icon" aria-hidden="true">
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
                                        <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                      </svg>
                                    </span>
                                    <span className="uich-wpc-advanced-config-option-title">{__('SEO', 'uichemy')}</span>
                                  </div>
                                  <span className="uich-wpc-advanced-config-option-desc">{__('Basic SEO setup', 'uichemy')}</span>
                                </div>
                              </div>
                              <div className="uich-wpc-advanced-config-option is-disabled" aria-disabled="true">
                                <Checkbox disabled checked={false} />
                                <div className="uich-wpc-advanced-config-option-copy">
                                  <div className="uich-wpc-advanced-config-option-heading">
                                    <span className="uich-wpc-advanced-config-option-icon" aria-hidden="true">
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </span>
                                    <span className="uich-wpc-advanced-config-option-title">{__('Performance', 'uichemy')}</span>
                                  </div>
                                  <span className="uich-wpc-advanced-config-option-desc">{__('PageSpeed optimized', 'uichemy')}</span>
                                </div>
                              </div>
                              <div className="uich-wpc-advanced-config-option is-disabled" aria-disabled="true">
                                <Checkbox disabled checked={false} />
                                <div className="uich-wpc-advanced-config-option-copy">
                                  <div className="uich-wpc-advanced-config-option-heading">
                                    <span className="uich-wpc-advanced-config-option-icon" aria-hidden="true">
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12 3l7 4v5c0 5-3.5 9-7 10-3.5-1-7-5-7-10V7l7-4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </span>
                                    <span className="uich-wpc-advanced-config-option-title">{__('Security', 'uichemy')}</span>
                                  </div>
                                  <span className="uich-wpc-advanced-config-option-desc">{__('Basic protection', 'uichemy')}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="uich-wpc-import-page-footer">
              <Button
                variant="outline"
                size="regular"
                onClick={onBack}
                disabled={isNextLoading}
                leftIcon={
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              >
                {__('Back', 'uichemy')}
              </Button>
              <Button
                variant="primary"
                size="regular"
                onClick={handleNext}
                disabled={isNextLoading}
                loading={isNextLoading}
                leftIcon={
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M10 2.5v9m0 0 3-3m-3 3-3-3M4 13.5v1A2.5 2.5 0 0 0 6.5 17h7a2.5 2.5 0 0 0 2.5-2.5v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              >
                {selectedPages.length > 0
                  ? sprintf(
                    /* translators: %d: number of pages to import */
                    _n('Import %d page', 'Import %d pages', selectedPages.length, 'uichemy'),
                    selectedPages.length
                  )
                  : __('Import', 'uichemy')}
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}