import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { __ } from '@wordpress/i18n';

import LoginScreen from './screens/LoginScreen.jsx';
import ProjectsScreen from './screens/ProjectsScreen.jsx';
import ImportScreen from './screens/ImportScreen.jsx';
import BuilderModal from './components/BuilderModal.jsx';
import Spinner from './components/Spinner.jsx';
import { Skeleton, Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator } from '../design-system';
import { getBoot, getSitemaps, logout } from './lib/api.js';
import { collectAllPageIds, getAllProjectPageRecords } from './lib/project-pages.js';

import './webpage.scss';

/**
 * AI Website Creator, the Import tab's "build it for me" mode.
 *
 * Three steps, held in local state rather than routes: connect account → pick a
 * project (and a builder) → run the import. State beats routing here because the
 * whole flow lives inside one dashboard tab; adding hash routes would put steps
 * of an in-progress import into browser history, where a Back press mid-import
 * would unmount the progress screen.
 *
 * Everything renders inside `.uich-wpc`, which is a normal child of the Import
 * tab's content area, no portal to <body>, no fixed full-screen shell, no
 * WP-admin chrome overrides. That is the one hard constraint of this
 * integration: it must never take the admin page over.
 */

const STEP_PROJECTS = 'projects';
const STEP_IMPORT = 'import';

/** Relative "5 days ago" label for a project's export timestamp. */
function formatExportedAt(isoString) {
  if (!isoString) return __( 'Recently', 'uichemy' );
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return __( 'Recently', 'uichemy' );
  const diffDays = Math.floor(Math.max(0, Date.now() - date.getTime()) / 86400000);
  if (diffDays === 0) return __( 'Today', 'uichemy' );
  if (diffDays === 1) return __( 'Yesterday', 'uichemy' );
  if (diffDays < 7) return `${diffDays} ${ __( 'days ago', 'uichemy' ) }`;
  if (diffDays < 30) {
    const w = Math.floor(diffDays / 7);
    return `${w} ${ w === 1 ? __( 'week ago', 'uichemy' ) : __( 'weeks ago', 'uichemy' ) }`;
  }
  if (diffDays < 365) {
    const m = Math.floor(diffDays / 30);
    return `${m} ${ m === 1 ? __( 'month ago', 'uichemy' ) : __( 'months ago', 'uichemy' ) }`;
  }
  const y = Math.floor(diffDays / 365);
  return `${y} ${ y === 1 ? __( 'year ago', 'uichemy' ) : __( 'years ago', 'uichemy' ) }`;
}

const MoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="4" cy="10" r="1.6" fill="currentColor" />
    <circle cx="10" cy="10" r="1.6" fill="currentColor" />
    <circle cx="16" cy="10" r="1.6" fill="currentColor" />
  </svg>
);

/**
 * Overflow menu: who is connected + a way to disconnect. The connected account
 * and the (rare) Disconnect action don't need persistent real estate, so they
 * live behind a ⋯ icon-box button, the DS Menu, same as the dashboard's
 * ProfileMenu. Rendered inline at the right of the search toolbar on the
 * projects screen, and in a top-right bar on the error state.
 */
function AccountMenu({ userInfo, onDisconnect, disconnecting }) {
  // Hidden on request (2026-08-24): the ⋯ "Account options" / Disconnect button
  // is removed from the AI Website Creator toolbar. TO RESTORE: delete the line
  // below so the menu renders again.
  return null; // eslint-disable-line no-unreachable

  const name =
    (userInfo && (userInfo.name || userInfo.email || userInfo.preferred_username)) || '';

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="uich-wpc-account__more"
          aria-label={ __( 'Account options', 'uichemy' ) }
        >
          <MoreIcon />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>
          { name
            ? `${ __( 'Connected as', 'uichemy' ) } ${ name }`
            : __( 'Account connected', 'uichemy' ) }
        </MenuLabel>
        <MenuSeparator />
        <MenuItem
          danger
          disabled={ disconnecting }
          onSelect={ () => onDisconnect() }
        >
          { disconnecting ? __( 'Disconnecting…', 'uichemy' ) : __( 'Disconnect', 'uichemy' ) }
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export default function WebpageCreator() {
  const boot = getBoot();

  const [authed, setAuthed] = useState(!!boot.isAuthenticated);
  const [disconnecting, setDisconnecting] = useState(false);

  const [sitemapData, setSitemapData] = useState(null);
  const [loading, setLoading] = useState(!!boot.isAuthenticated);
  const [error, setError] = useState(null);

  const [step, setStep] = useState(STEP_PROJECTS);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedPages, setSelectedPages] = useState([]);
  const [selectedBuilder, setSelectedBuilder] = useState(null);
  const [loadingProjectId, setLoadingProjectId] = useState(null);
  /** Project whose "Choose Your Builder" modal is open (null = closed). */
  const [builderModalProjectId, setBuilderModalProjectId] = useState(null);

  // Load the project list once the account is connected.
  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getSitemaps();
        if (!cancelled) setSitemapData(data);
      } catch (err) {
        if (cancelled) return;
        // A dead/revoked token comes back as `not_authenticated`, drop straight
        // back to the login card instead of showing it as a generic load error.
        if (err && err.code === 'not_authenticated') {
          setAuthed(false);
          return;
        }
        setError((err && err.message) || __( 'Could not load your projects.', 'uichemy' ));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authed]);

  // Newest export first; undated projects sink to the bottom.
  const projects = useMemo(() => {
    const list = (sitemapData && sitemapData.projects) || [];
    const timeOf = (p) => {
      const t = Date.parse((p && (p.exportedAt || p.updatedAt || p.createdAt)) || '');
      return Number.isNaN(t) ? -Infinity : t;
    };
    return [...list].sort((a, b) => timeOf(b) - timeOf(a));
  }, [sitemapData]);

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.projectId === selectedProjectId)
    : null;

  const cardProjects = useMemo(
    () => projects.map((p) => {
      const flatPages = getAllProjectPageRecords(p);
      return {
        id: p.projectId,
        name: p.projectName || __( 'Untitled Project', 'uichemy' ),
        projectImage: p.projectImage,
        pages: `${flatPages.length} ${ __( 'Pages', 'uichemy' ) }`,
        updated: formatExportedAt(p.exportedAt || p.updatedAt || p.createdAt),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt || p.createdAt,
      };
    }),
    [projects]
  );

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await logout();
    } catch (_) {
      // Sign out locally regardless, the stored token is unusable either way.
    }
    setDisconnecting(false);
    setAuthed(false);
    setSitemapData(null);
    setStep(STEP_PROJECTS);
    setSelectedProjectId(null);
    setSelectedPages([]);
    setSelectedBuilder(null);
  }, []);

  const startImport = (projectId, builder) => {
    const project = projects.find((p) => p.projectId === projectId);
    setSelectedProjectId(projectId);
    setSelectedPages(collectAllPageIds(project));
    setSelectedBuilder(builder);
    setLoadingProjectId(null);
    setStep(STEP_IMPORT);
  };

  const backToProjects = () => {
    setStep(STEP_PROJECTS);
    setSelectedProjectId(null);
    setSelectedPages([]);
    setSelectedBuilder(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!authed) {
    // Same grey group as the Figma / AI Agent tabs (`--grouped`), so the connect
    // card reads as a white inner card on the soft grey, card-in-card consistent
    // across every tool tab.
    return (
      <div className="uich-wpc uich-wpc--grouped">
        <LoginScreen />
      </div>
    );
  }

  if (loading) {
    // DS Skeleton placeholders, shape-of-content loading instead of a bare
    // spinner, so the projects grid doesn't jump when data lands.
    return (
      <div className="uich-wpc uich-wpc--grouped">
        <div className="uich-wpc-project" aria-busy="true" aria-label={ __( 'Loading your projects…', 'uichemy' ) }>
          <div className="uich-wpc-project__body">
            <div className="uich-wpc-project__toolbar" aria-hidden="true">
              <Skeleton style={{ width: '100%', height: 40, borderRadius: 8 }} />
            </div>
            <div className="uich-wpc-project__grid" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} style={{ height: 168, borderRadius: 12 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="uich-wpc">
        <div className="uich-wpc-account">
          <AccountMenu userInfo={ boot.userInfo } onDisconnect={ handleDisconnect } disconnecting={ disconnecting } />
        </div>
        <div className="uich-wpc-state">
          <p className="uich-wpc-state__error">{ error }</p>
        </div>
      </div>
    );
  }

  if (step === STEP_IMPORT && selectedProject) {
    return (
      <div className="uich-wpc">
        <ImportScreen
          project={ selectedProject }
          selectedPages={ selectedPages }
          onSelectedPagesChange={ setSelectedPages }
          onBack={ backToProjects }
          onBackToProjects={ backToProjects }
          conceptNumber={ 1 }
          builderOverride={ selectedBuilder }
        />
      </div>
    );
  }

  const modalProject = builderModalProjectId
    ? projects.find((p) => p.projectId === builderModalProjectId)
    : null;
  const modalDefaultBuilder =
    Array.isArray(modalProject && modalProject.builder) && modalProject.builder.includes('elementor')
      ? 'elementor'
      : 'gutenberg';

  return (
    <div className="uich-wpc uich-wpc--grouped">
      <ProjectsScreen
        projects={ cardProjects }
        onSelectProject={ setBuilderModalProjectId }
        loadingProjectId={ loadingProjectId }
        toolbarAction={
          <AccountMenu
            userInfo={ boot.userInfo }
            onDisconnect={ handleDisconnect }
            disconnecting={ disconnecting }
          />
        }
      />

      <BuilderModal
        open={ builderModalProjectId !== null }
        defaultBuilder={ modalDefaultBuilder }
        onClose={ () => setBuilderModalProjectId(null) }
        onConfirm={ (builder) => {
          const projectId = builderModalProjectId;
          setBuilderModalProjectId(null);
          startImport(projectId, builder);
        } }
      />
    </div>
  );
}
