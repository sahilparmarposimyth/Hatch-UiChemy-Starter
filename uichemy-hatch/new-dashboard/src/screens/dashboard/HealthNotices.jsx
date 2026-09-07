import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Button, Alert, Card } from '../../design-system';
import { ajax, request, copyText } from '../../lib/api.js';
import ErrorCard from '../errors/ErrorCard.jsx';

/**
 * In-dashboard health surfacing, the banner + the shared fix affordances.
 *
 * These replace the old full-page takeover: recoverable site/connection
 * problems now show as a compact top banner (all issues) that expands the fix
 * steps IN PLACE, plus an inline block on the connect screens (see
 * ConnectionBlocker in Import.jsx). The user keeps the sidebar and can still
 * move around the dashboard while a problem is outstanding.
 */

/** Fix handlers (enable App Passwords / install UiChemy / reload) with shared
 *  busy + error state. Lifted out of App.jsx so both the banner and the inline
 *  connect blocks drive the exact same actions. */
export function useIssueActions() {
  const [ busyId, setBusyId ] = useState( null );
  const [ error, setError ] = useState( '' );

  const run = async ( issue ) => {
    const kind = issue?.fix?.kind;
    setError( '' );
    if ( kind === 'reload' ) { window.location.reload(); return; }
    if ( kind === 'enable-ap' ) {
      setBusyId( issue.id );
      try { await ajax( 'uich_nd_enable_app_passwords' ); window.location.reload(); }
      catch ( e ) { setError( e.message || __( 'Could not enable Application Passwords.', 'uichemy' ) ); setBusyId( null ); }
      return;
    }
    if ( kind === 'install-uichemy' ) {
      setBusyId( issue.id );
      try {
        const res = await request( 'uichemy/install', { method: 'POST' } );
        // Activation bootstrap needs WP-Admin's sandbox, open it there and
        // let the user finish, then they refresh.
        if ( res && res.action === 'activate_url' && res.activate_url ) {
          window.open( res.activate_url, '_blank', 'noopener' );
          setBusyId( null );
          return;
        }
        window.location.reload();
      } catch ( e ) { setError( e.message || __( 'Could not install UiChemy. Please try again.', 'uichemy' ) ); setBusyId( null ); }
      return;
    }
  };

  return { run, busyId, error };
}

/** The primary action for an issue, a link when the fix is a doc/admin page,
 *  otherwise a button that runs the handler with a busy state. */
export function IssueAction( { issue, actions, size = 'sm', variant = 'solid', tone = 'brand' } ) {
  const fix = issue.fix || {};
  if ( fix.kind === 'link' ) {
    return (
      <Button variant={ variant } tone={ tone } size={ size } asChild>
        <a href={ fix.href } target={ /^https?:/.test( fix.href || '' ) ? '_blank' : undefined } rel="noreferrer">{ fix.label }</a>
      </Button>
    );
  }
  const busy = actions.busyId === issue.id;
  return (
    <Button variant={ variant } tone={ tone } size={ size } loading={ busy } onClick={ () => actions.run( issue ) }>
      { busy && fix.busyLabel ? fix.busyLabel : fix.label }
    </Button>
  );
}

/** Read-only wp-config snippet with a copy button (local-env fix). */
export function Snippet( { code } ) {
  const [ copied, setCopied ] = useState( false );
  const onCopy = async () => {
    if ( await copyText( code ) ) { setCopied( true ); setTimeout( () => setCopied( false ), 1600 ); }
  };
  return (
    <div className="codeblock nd-health__snippet">
      <div className="codeblock__bar">
        <span>wp-config.php</span>
        <Button type="button" variant="ghost" tone="neutral" size="sm" className="codeblock__copy" onClick={ onCopy }>
          { copied ? <><Icon.Check size={ 12 } /> { __( 'Copied', 'uichemy' ) }</> : <><Icon.Copy size={ 12 } /> { __( 'Copy', 'uichemy' ) }</> }
        </Button>
      </div>
      <pre><code>{ code }</code></pre>
    </div>
  );
}

/** The expanded detail for one issue: body + reason + snippet + action. Shared
 *  by the banner's expand region and (optionally) other surfaces. */
export function IssueDetails( { issue, actions } ) {
  return (
    <div className="nd-health__detail">
      <div className="nd-health__detail-body">
        <b className="nd-health__detail-title">{ issue.title }</b>
        <p>{ issue.body }</p>
      </div>
      { issue.reasonText ? (
        <Alert tone="warning" title={ __( "Why it's off", 'uichemy' ) } className="nd-health__reason">
          { issue.reasonText }
          { issue.reasonHint ? (
            <span style={ { display: 'block', marginTop: 4 } }>{ issue.reasonHint }</span>
          ) : null }
        </Alert>
      ) : null }
      { issue.snippet ? <Snippet code={ issue.snippet } /> : null }
      { issue.steps && issue.steps.length ? (
        <div className="nd-health__steps">
          <p className="nd-health__steps-lead">{ __( 'Or fix it at the source:', 'uichemy' ) }</p>
          <ol>
            { issue.steps.map( ( step, i ) => <li key={ i }>{ step }</li> ) }
          </ol>
        </div>
      ) : null }
      { issue.hooked && issue.hooked.length ? (
        <p className="nd-health__hooked">
          { __( 'These active plugins are hooked on the Application Passwords check, so one of them is the likely cause:', 'uichemy' ) }
          <b>{ issue.hooked.join( ', ' ) }</b>
        </p>
      ) : null }
      <div className="nd-health__detail-actions">
        <IssueAction issue={ issue } actions={ actions } />
      </div>
    </div>
  );
}

/**
 * Full inline block for a connect-blocking issue, shown IN PLACE of the
 * Connection panel on the AI Agent / Figma screens (Shopify's inline pattern).
 * Reuses the legacy ErrorCard verbatim, it renders in the dashboard's CSS
 * scope here, so all the `.calm` styling applies, and drives it from the
 * health issue + the shared action handlers.
 */
export function ConnectionBlocker( { issue } ) {
  const actions = useIssueActions();
  const fix = issue.fix || {};
  const isLink = fix.kind === 'link';
  const overrides = {
    title: issue.title,
    body: issue.body,
    action: fix.label,
    ...( fix.busyLabel ? { busyLabel: fix.busyLabel } : {} ),
    ...( isLink ? { href: fix.href } : {} ),
  };
  return (
    <Card className="panel span-2">
      <ErrorCard
        variant={ issue.variant }
        overrides={ overrides }
        extra={ {
          snippet: issue.snippet || null,
          reasonText: issue.reasonText || null,
          reasonHint: issue.reasonHint || null,
          steps: issue.steps || null,
          hooked: issue.hooked || null,
          onRecheck: issue.steps ? () => window.location.reload() : null,
        } }
        busy={ actions.busyId === issue.id }
        errorMessage={ actions.error }
        onResolve={ isLink ? undefined : () => actions.run( issue ) }
      />
    </Card>
  );
}

const TONE_ICON = {
  info: Icon.Info,
  warn: Icon.Warn,
  danger: Icon.Warn,
};

/**
 * Compact top banner. Collapsed: tone icon + top-issue title (+ "N more") +
 * the top issue's action + an expand toggle. Expanded: full details for every
 * outstanding issue, in place.
 */
export default function HealthBanner( { issues } ) {
  const actions = useIssueActions();
  const [ open, setOpen ] = useState( false );
  if ( ! issues || ! issues.length ) return null;

  const top = issues[ 0 ];
  const rest = issues.length - 1;
  const IconEl = TONE_ICON[ top.tone ] || Icon.Warn;

  return (
    <div className={ `nd-health nd-health--${ top.tone } ${ open ? 'is-open' : '' }` } role="status">
      <div className="nd-health__bar">
        <span className="nd-health__ic"><IconEl size={ 16 } /></span>
        <div className="nd-health__lead">
          <b className="nd-health__title">{ top.title }</b>
          { rest > 0 ? (
            <button type="button" className="nd-health__more" onClick={ () => setOpen( true ) }>
              { /* translators: %d = number of additional issues */ }
              { rest === 1 ? __( '+1 more', 'uichemy' ) : `+${ rest } ${ __( 'more', 'uichemy' ) }` }
            </button>
          ) : null }
        </div>
        <div className="nd-health__cta">
          { ! open ? <IssueAction issue={ top } actions={ actions } /> : null }
          <Button
            variant="ghost"
            tone="neutral"
            size="sm"
            iconOnly
            className="nd-health__toggle"
            aria-expanded={ open }
            aria-label={ open ? __( 'Hide details', 'uichemy' ) : __( 'Show details', 'uichemy' ) }
            onClick={ () => setOpen( ( v ) => ! v ) }
          >
            <Icon.ChevR size={ 15 } />
          </Button>
        </div>
      </div>

      { open ? (
        <div className="nd-health__panel">
          { issues.map( ( it ) => (
            <IssueDetails key={ it.id } issue={ it } actions={ actions } />
          ) ) }
          { actions.error ? (
            <Alert tone="danger" className="nd-health__err">{ actions.error }</Alert>
          ) : null }
        </div>
      ) : null }
    </div>
  );
}
