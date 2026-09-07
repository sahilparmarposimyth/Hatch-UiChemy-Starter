import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import { Input } from '../../design-system';
import ProjectCard from '../components/ProjectCard.jsx';

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7.33" cy="7.33" r="4.58" stroke="currentColor" strokeWidth="1.5" />
    <path d="M13.25 13.25l-2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * "Select Your Project", a minimal section header, a DS search field, and the
 * project-card grid. Presentational: render it inside the flow's <AppShell>.
 *
 * Uses the shared design-system <Input> (same control as the rest of the
 * dashboard) so the search reads as one product and inherits its wp-admin
 * hardening + focus states.
 *
 * @param {Array}  props.projects          [{ id, name, pages, updated, projectImage, createdAt, updatedAt }]
 * @param {Function} [props.onSelectProject] (id) => void
 * @param {(string|number|null)} [props.loadingProjectId]
 */
export default function ProjectsScreen({
  projects = [],
  onSelectProject,
  loadingProjectId = null,
  toolbarAction = null,
}) {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? projects.filter((p) =>
        (p.name || '').toLowerCase().includes(query.trim().toLowerCase())
      )
    : projects;

  // Newest first; projects without timestamps keep their original order.
  const timeOf = (p) => {
    const raw = p.updatedAt || p.createdAt;
    const time = raw ? new Date(raw).getTime() : NaN;
    return Number.isNaN(time) ? 0 : time;
  };
  const sorted = [...filtered].sort((a, b) => timeOf(b) - timeOf(a));

  return (
    <div className="uich-wpc-project">
      <div className="uich-wpc-project__body">
        <div className="uich-wpc-project__toolbar">
          <div className="uich-wpc-project__search-wrap">
            <Input
              inputSize="md"
              className="uich-wpc-project__search"
              leftIcon={<SearchIcon />}
              placeholder={ __( 'Search projects', 'uichemy' ) }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={ __( 'Search projects', 'uichemy' ) }
            />
          </div>
          { toolbarAction }
        </div>

        {filtered.length === 0 ? (
          <div className="uich-wpc-project__empty">
            <div className="uich-wpc-project__empty-illustration">
              <div className="uich-wpc-project__empty-card uich-wpc-project__empty-card--a" />
              <div className="uich-wpc-project__empty-card uich-wpc-project__empty-card--b" />
              <div className="uich-wpc-project__empty-card uich-wpc-project__empty-card--c" />
              <div className="uich-wpc-project__empty-fade" />
              <p className="uich-wpc-project__empty-count">0 Projects</p>
            </div>
            <div className="uich-wpc-project__empty-text">
              <p className="uich-wpc-project__empty-title">
                { query.trim()
                  ? __( 'No projects found', 'uichemy' )
                  : __( 'No projects yet', 'uichemy' ) }
              </p>
              <p className="uich-wpc-project__empty-subtitle">
                { query.trim()
                  ? __( 'Try a different search term.', 'uichemy' )
                  : __( 'Create your first project to get started.', 'uichemy' ) }
              </p>
            </div>
          </div>
        ) : (
          <div className="uich-wpc-project__grid">
            {sorted.map((project) => (
              <ProjectCard
                key={project.id}
                name={project.name}
                pages={project.pages}
                updated={project.updated}
                projectImage={project.projectImage}
                loading={loadingProjectId === project.id}
                onClick={() => onSelectProject?.(project.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
