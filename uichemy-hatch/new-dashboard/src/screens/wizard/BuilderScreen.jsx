import React, { useState } from 'react';
import { brandLogoSrc, brandName } from '../../components/brand-logos.jsx';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Badge as DSBadge } from '../../design-system';
import { request, getBoot } from '../../lib/api.js';

/* ============================================================
   Step 2, Page builder picker.
   Full-width rows (the base `.choice` card), matching the mode step: logo
   (left), body (title + badges + desc), and a right-side slot that holds
   EITHER a compact Install/Get button (for a builder that isn't active yet
   and we can drive) OR the springy check badge (for a selectable/selected
   row). Selection is the outline + check, not an in-card button; the
   wizard's Continue commits.
   ============================================================ */

const BUILDERS = [
  { id: 'elementor', name: 'Elementor', icon: Icon.Elementor, desc: __('Elementor widgets you can open and edit.', 'uichemy') },
  { id: 'gutenberg', name: 'Gutenberg', icon: Icon.Gutenberg, desc: __('The built-in WordPress editor. Clean blocks.', 'uichemy') },
  { id: 'bricks',    name: 'Bricks',    icon: Icon.Bricks,    desc: __('Bricks elements that stay clean and lightweight.', 'uichemy') },
];

// Thin adapter → DS Badge. The old `variant` values were really tones
// (success/brand/warning/neutral), so map them to the DS `tone` prop and
// render the soft style the wizard chips have always used.
function Badge({ variant = 'neutral', dot = false, children }) {
  return (
    <DSBadge tone={variant} variant="soft" dot={dot}>
      {children}
    </DSBadge>
  );
}

export default function BuilderScreen({ detected = {}, selected, onSelect, uichemy = {} }) {
  // Local override merged on top of boot's detected map so the UI flips
  // to "Active" immediately after a successful install / activate, no
  // page reload needed.
  const [detectedOverride, setDetectedOverride] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const merged = { ...detected, ...detectedOverride };

  const activeIds = BUILDERS.filter(b => merged[b.id]?.active).map(b => b.id);
  const multipleActive = activeIds.length > 1;
  const detectedId = !multipleActive && activeIds.length === 1 ? activeIds[0] : null;

  const handleInstall = async (e, id) => {
    e.stopPropagation();
    e.preventDefault();
    setError('');
    setBusyId(id);
    try {
      const result = await request('/install', { method: 'POST', body: { builder: id } });
      // External destination (e.g. Bricks buy page), new tab.
      if (result.action === 'redirect' && result.redirect) {
        window.open(result.redirect, '_blank', 'noopener,noreferrer');
        return;
      }
      // Activation must finish in WP-Admin (e.g. Elementor 4.1.x throws
      // an uncaught exception during in-process activation). Navigating
      // there lets plugins.php sandbox the include; our activated_plugin
      // hook bounces the user back to this wizard when it's done.
      if (result.action === 'activate_url' && result.activate_url) {
        window.location.href = result.activate_url;
        return;
      }
      // Merge fresh detection state from server.
      if (result.detected) setDetectedOverride(result.detected);
      // Auto-select the builder once it's available.
      if (result.detected?.[id]?.installed) onSelect(id);
    } catch (err) {
      setError(sprintf(__("Couldn't complete %1$s: %2$s", 'uichemy'), id, err.message));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="choices">
      {BUILDERS.map((b) => {
        const det = merged[b.id] || {};
        const isInstalled = !!det.installed;
        const isActive    = !!det.active;
        const isDetected  = detectedId === b.id;
        const isInactive  = isInstalled && !isActive;
        const isSelected  = selected === b.id;
        const isBusy      = busyId === b.id;

        const pills = [];
        if (isDetected) {
          pills.push(<Badge key="d" variant="success" dot>{__('Detected', 'uichemy')}</Badge>);
        } else if (multipleActive && isActive) {
          pills.push(<Badge key="a" variant="brand">{__('Active', 'uichemy')}</Badge>);
        }
        if (isInactive) pills.push(<Badge key="i" variant="warning">{__('Inactive', 'uichemy')}</Badge>);
        if (!isInstalled) pills.push(<Badge key="n" variant="neutral">{__('Not installed', 'uichemy')}</Badge>);

        const IconEl = b.icon;
        // Elementor can be selected even when inactive / not installed –
        // the wizard's Continue button transitions to "Install & Activate"
        // and drives the install/activate flow when the user proceeds.
        // Bricks stays gated: it's premium and we can't install it for
        // them, so the in-card "Get Bricks" link is the only path forward.
        const selectable = isActive || b.id === 'elementor';
        const needsAction = !isActive;
        const actionLabel = !isInstalled
          ? ( b.id === 'bricks'
              ? sprintf(__('Get %s', 'uichemy'), b.name)
              : sprintf(__('Install %s', 'uichemy'), b.name) )
          : sprintf(__('Activate %s', 'uichemy'), b.name);

        return (
          <button
            key={b.id}
            type="button"
            className={`choice ${isSelected ? 'choice--selected' : ''}`}
            onClick={() => selectable && onSelect(b.id)}
            aria-pressed={isSelected}
          >
            <span className="choice__logo"><IconEl size={24}/></span>
            <div className="choice__body">
              <div className="choice__title">
                {b.name}
                {pills.length ? <span className="choice__pills">{pills}</span> : null}
              </div>
              <p className="choice__desc">{b.desc}</p>
            </div>
            {/* Right slot: an inactive builder we can drive gets a compact
                Install/Get button; everything else gets the check badge, which
                springs in once the row is selected. */}
            {needsAction && b.id !== 'elementor' ? (
              <a
                className="choice__btn choice__btn--sm"
                href="#"
                onClick={(e) => handleInstall(e, b.id)}
                style={{ pointerEvents: isBusy ? 'none' : 'auto', opacity: isBusy ? 0.6 : 1 }}
              >
                {isBusy
                  ? <><span className="nd-spin"><Icon.Spinner size={13}/></span> {__('Working…', 'uichemy')}</>
                  : <><Icon.ExtLink size={13}/> {actionLabel}</>}
              </a>
            ) : (
              <span className="choice__check" aria-hidden="true"><Icon.Check size={12}/></span>
            )}
          </button>
        );
      })}
      {/* UiChemy used to be a separate plugin that this step installed alongside
          Elementor, so it appeared here as a checked, locked "Required" companion.
          It is bundled into UiChemy now (uichemy-composer/), so there is nothing to
          install and nothing to disclose, `uichemy.bundled` hides the card.
          Kept rather than deleted: dropping the flag brings the flow back. */}
      {selected === 'elementor' && !uichemy.bundled && (() => {
        const logo = brandLogoSrc(getBoot());
        const pActive = !!uichemy.active;
        const pInstalled = !!uichemy.installed;
        const pUpdate = !!uichemy.update_available;
        const pPills = [];
        if (pActive) {
          pPills.push(<Badge key="pa" variant="brand">{__('Active', 'uichemy')}</Badge>);
        } else if (pInstalled) {
          pPills.push(<Badge key="pi" variant="warning">{__('Inactive', 'uichemy')}</Badge>);
        } else {
          pPills.push(<Badge key="pn" variant="neutral">{__('Not installed', 'uichemy')}</Badge>);
        }
        if (pUpdate) {
          pPills.push(
            <Badge key="pu" variant="warning">
              {uichemy.latest_version
                ? sprintf(__('Update available · Beta v%s', 'uichemy'), uichemy.latest_version)
                : __('Update available', 'uichemy')}
            </Badge>
          );
        }
        return (
          <React.Fragment>
            {/* Section divider with a centered "Required" label. */}
            <div className="choice-sep" style={{ gridColumn: '1 / -1' }}>
              <span className="choice-sep__label">{__('Required', 'uichemy')}</span>
            </div>
            <div
              className="choice choice--selected choice--locked"
              aria-disabled="true"
              style={{ gridColumn: '1 / -1' }}
            >
              <span className="choice__logo">
                <img src={logo} alt={brandName()} style={{ width: 34, height: 34, objectFit: 'contain' }} />
              </span>
              <div className="choice__body">
                <div className="choice__title">
                  {brandName()}
                  {pPills.length ? <span className="choice__pills">{pPills}</span> : null}
                </div>
                <p className="choice__desc">
                  {__('We install UiChemy, the UiChemy editing layer. It keeps every converted design fully editable inside your builder.', 'uichemy')}
                </p>
              </div>
              <span className="choice__check"><Icon.Check size={13}/></span>
            </div>
          </React.Fragment>
        );
      })()}
      {error && (
        <div className="choice__inline" style={{ gridColumn: '1 / -1', marginTop: 4 }}>
          <Icon.Warn size={14}/> {error}
        </div>
      )}
    </div>
  );
}
