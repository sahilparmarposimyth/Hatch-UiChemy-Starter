import React from 'react';
import { __ } from '@wordpress/i18n';

/**
 * The two meta icons are inlined rather than loaded from `assets/images/svg/`.
 * Inlining is what let this port skip copying image files over from the
 * standalone plugin, one fewer asset path to keep in sync, and the icons
 * inherit `currentColor` so they follow the card's own text colour.
 */
const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M9.5 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5l-3.5-3.5Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M9.25 1.75V5h3.25" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.2" />
    <path d="M8 4.75V8l2.25 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Project card, a preview thumbnail with the project name and a meta row
 * (pages · last updated).
 *
 * `projectImage` comes from the projects API. When a project has none, the
 * thumbnail falls back to a CSS placeholder (see project-card.scss) instead of
 * a bundled sample image.
 *
 * @param {string}   props.name
 * @param {string}   props.pages          e.g. "5 Pages"
 * @param {string}   props.updated        e.g. "5 days ago"
 * @param {string}   [props.projectImage]
 * @param {boolean}  [props.loading]      Shows a spinner and blocks re-clicks.
 * @param {Function} [props.onClick]
 */
export default function ProjectCard({
  name,
  pages,
  updated,
  projectImage,
  loading = false,
  onClick,
}) {
  return (
    <button
      type="button"
      className={`uich-wpc-project-card${loading ? ' is-loading' : ''}`}
      onClick={onClick}
      disabled={loading}
    >
      <div className="uich-wpc-project-card__thumb">
        {projectImage ? (
          <img
            src={projectImage}
            alt=""
            className="uich-wpc-project-card__preview"
            aria-hidden="true"
          />
        ) : (
          <span className="uich-wpc-project-card__placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="uich-wpc-project-card__info">
        <div className="uich-wpc-project-card__title-row">
          <span className="uich-wpc-project-card__name">{name}</span>
        </div>

        <div className="uich-wpc-project-card__meta">
          <span className="uich-wpc-project-card__meta-item">
            <FileIcon />
            {pages}
          </span>
          <span className="uich-wpc-project-card__dot" aria-hidden="true" />
          <span className="uich-wpc-project-card__meta-item">
            <ClockIcon />
            {updated}
          </span>
        </div>
      </div>

      {loading && (
        <span className="uich-wpc-project-card__spinner" aria-label={ __( 'Loading', 'uichemy' ) } />
      )}
    </button>
  );
}
