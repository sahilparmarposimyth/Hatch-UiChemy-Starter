import React, { useEffect, useState } from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import ScreenHead from '../../components/ScreenHead.jsx';
import { request, getBoot } from '../../lib/api.js';
import { modeSupportsBuilder } from '../../dashboard/modes.js';
import { computeHealth, connectIssues } from '../../dashboard/health.js';
import BuilderScreen from '../wizard/BuilderScreen.jsx';
import { Panel, ConnectionPanel } from './panels.jsx';
import McpSetup from './McpSetup.jsx';
import { ConnectionBlocker } from './HealthNotices.jsx';
import WebpageCreator from '../../uichemy-webpage/index.jsx';

/**
 * Inline "choose your page builder" card, reuses the wizard's BuilderScreen
 * (rich Elementor/Gutenberg/Bricks cards with detect + install/activate) so the
 * connect screens run the same guided flow the onboarding wizard does, instead
 * of a bare "Change" button. Selecting a builder persists it (POST /builder) and
 * bubbles up so the rest of the dashboard stays in sync.
 */
function BuilderStep({ builderSlug, onBuilderChange, note }) {
  const boot = getBoot();
  const detected = boot?.state?.builders || {};
  const uichemy = boot?.state?.uichemy || {};
  const [sel, setSel] = useState(builderSlug || 'elementor');

  const pick = async (id) => {
    setSel(id);
    if (onBuilderChange) onBuilderChange(id);
    try { await request('/builder', { method: 'POST', body: { builder: id } }); }
    catch (_) { /* selection is optimistic; a failed persist self-heals on reload */ }
  };

  return (
    <Panel
      flat
      title={__('Page builder', 'uichemy')}
      className="span-2"
    >
      <p className="conn-intro">{note || __('Your design converts into editable elements in the builder you pick.', 'uichemy')}</p>
      <BuilderScreen detected={detected} selected={sel} onSelect={pick} uichemy={uichemy} />
    </Panel>
  );
}

/**
 * The three "how a design gets in" screens.
 *
 * These used to be one Import tab with a mode dropdown. The dropdown hid the two
 * flows that matter most (Figma for designers, AI Website Creator for builders)
 * behind a menu, so each mode is now its own first-class sidebar entry, see
 * dashboard/tabs.js. Same three flows, same panels, no dropdown.
 *
 * `uich_nd_mode` is still a real option (it seeds onboarding and analytics), so
 * landing on one of these screens quietly persists its mode, exactly what the
 * old dropdown did on pick, keeping "which mode" consistent across the wizard
 * and the dashboard. It's a preference only: a failed write is ignored and
 * never blocks the screen (the flow reads from the route, not the option).
 */

function usePersistMode( target, current, onModeChange, enabled = true ) {
  useEffect( () => {
    if ( ! enabled || ! target || target === current ) return;
    let alive = true;
    ( async () => {
      try {
        await request( '/mode', { method: 'POST', body: { mode: target } } );
        if ( alive && onModeChange ) onModeChange( target );
      } catch ( _ ) {
        /* preference only, ignore */
      }
    } )();
    return () => { alive = false; };
  }, [ target, current, enabled ] ); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Figma Plugin, a guided flow: pick your builder, then connect. */
export function FigmaScreen( { builderSlug, mode, onModeChange, onBuilderChange, restFailed, embedded } ) {
  usePersistMode( 'figma', mode, onModeChange );
  const blockers = connectIssues( computeHealth( getBoot(), { restFailed } ) );
  return (
    <div className="dash">
      { ! embedded && (
        <ScreenHead
          title={ __( 'Figma Plugin', 'uichemy' ) }
          subtitle={ __( 'Design in Figma and send it straight to WordPress.', 'uichemy' ) }
        />
      ) }
      <div className="dash__grid">
        {/* One white card (like the AI Agent tab's stepper) sitting on the grey
            group, the flat Page builder / Connection sections stack inside it. */}
        <Panel className="span-2 conn-card">
          <BuilderStep builderSlug={ builderSlug } onBuilderChange={ onBuilderChange } />
          { blockers.length
            ? blockers.map( ( i ) => <ConnectionBlocker key={ i.id } issue={ i } /> )
            : <ConnectionPanel mode="figma" hideBuilder /> }
        </Panel>
      </div>
    </div>
  );
}

/** AI Agent (MCP), connection details plus the per-client MCP config. */
export function AiAgentScreen( { builder, builderSlug, mode, siteName, onModeChange, onBuilderChange, restFailed, embedded } ) {
  const supported = modeSupportsBuilder( 'compose', builderSlug );
  usePersistMode( 'compose', mode, onModeChange, supported );
  const blockers = connectIssues( computeHealth( getBoot(), { restFailed } ) );
  return (
    <div className="dash">
      { ! embedded && (
        <ScreenHead
          title={ __( 'AI Agent (MCP)', 'uichemy' ) }
          subtitle={ __( 'Build pages by chatting with Claude, Cursor, Codex and more.', 'uichemy' ) }
        />
      ) }
      <div className="dash__grid">
        { supported ? (
          blockers.length ? (
            // Can't connect until the site issue is fixed, show the blocker in
            // place of the connection details (the MCP config would be premature).
            blockers.map( ( i ) => <ConnectionBlocker key={ i.id } issue={ i } /> )
          ) : (
          // Minimal Mobbin-style stepper: connect → pick tool → add config →
          // restart. Includes the connection (App Password) as step 1, so the
          // separate ConnectionPanel isn't needed on this screen anymore.
          <McpSetup siteName={ siteName } />
          )
        ) : (
          // MCP is Elementor-only. Rather than the old jump back to the
          // full-screen onboarding wizard, switch builder inline, the same
          // picker the Figma screen uses, so selecting Elementor bubbles up
          // and the connection details appear in place.
          <BuilderStep
            builderSlug={ builderSlug }
            onBuilderChange={ onBuilderChange }
            note={ __( 'The AI Agent (MCP) connection runs on Elementor. Select it below to connect Claude, Cursor or Codex.', 'uichemy' ) }
          />
        ) }
      </div>
    </div>
  );
}

/**
 * AI Website Creator, a full multi-step flow (connect → pick a project →
 * import) with its own header and account bar, so it renders on its own rather
 * than inside a connection grid. See uichemy-webpage/index.jsx.
 */
export function AiWebsiteScreen( { builderSlug, mode, onModeChange } ) {
  usePersistMode( 'scratch', mode, onModeChange, modeSupportsBuilder( 'scratch', builderSlug ) );
  return (
    <div className="dash">
      <WebpageCreator />
    </div>
  );
}
