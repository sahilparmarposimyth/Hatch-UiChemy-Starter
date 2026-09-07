import React, { useCallback, useEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import ScreenHead from '../../components/ScreenHead.jsx';
import { Alert, Button } from '../../design-system';
import { request } from '../../lib/api.js';

/**
 * The Hatch deploy, running on this screen.
 *
 * The build itself happens on the deploy broker, but nothing about it needs to
 * be *watched* there: its `/status?ticket=` already returns `{ stage, log[],
 * error, project_url, return_url }`. So PHP starts the pipeline server-side
 * (Uich_Hatch_Deploy::takeover_url) and this polls it and draws the log here, in
 * the dashboard's own styling. The browser never visits the broker.
 *
 * Polling goes through a WordPress REST proxy rather than straight at the
 * broker — not a preference: the broker sends no CORS headers, so a fetch() from
 * wp-admin is blocked outright. The proxy also keeps the ticket server-side and
 * refuses one that is not this user's.
 *
 * Finishing is deliberately NOT reimplemented here. On success the screen
 * navigates to the `return_url` the broker hands back, which is Hatch's own
 * `admin-post.php?action=hatch_deploy_callback` — so the project URL, hosting
 * model, image proxy and companion theme are all persisted by the same code
 * path that always did it. Only the trigger moved.
 */

/** Poll interval. The broker's log grows in bursts; faster just adds requests. */
const POLL_MS = 2000;

/**
 * Stop polling eventually. A ticket only lives five minutes on the broker and a
 * typical build is 60–90s, so well past this something is wrong and hammering
 * the endpoint forever helps nobody.
 */
const MAX_POLL_MS = 10 * 60 * 1000;

/**
 * The stages the broker actually reports, verified against every `stage:` it
 * assigns in hatch-deploy/server.js — `token_attached`, `building`, `complete`,
 * `failed`. There is no `success`; the terminal value is `complete`, which is
 * also what the broker's own build page tests for.
 */
const STAGE_DONE = 'complete';
const STAGE_FAILED = 'failed';

const STAGES = {
  // Ticket issued, pipeline not yet reporting. Reads as busy, not as a
  // separate state worth naming to the user.
  token_attached: { label: __( 'Starting the build…', 'uichemy' ), tone: 'busy' },
  building: { label: __( 'Building your site…', 'uichemy' ), tone: 'busy' },
  complete: { label: __( 'Deployed', 'uichemy' ), tone: 'ok' },
  failed: { label: __( 'Deploy failed', 'uichemy' ), tone: 'bad' },
};

export default function DeployProgress( { ticket, provider, onDismiss } ) {
  const [ state, setState ] = useState( { stage: 'building', log: [], error: null } );
  const [ fatal, setFatal ] = useState( '' );
  const logRef = useRef( null );
  const startedAt = useRef( Date.now() );
  const timer = useRef( null );
  const done = useRef( false );

  const poll = useCallback( async () => {
    try {
      const data = await request(
        `hatch-deploy/status?ticket=${ encodeURIComponent( ticket ) }&provider=${ encodeURIComponent( provider ) }`
      );
      setState( {
        stage: data.stage || 'building',
        log: Array.isArray( data.log ) ? data.log : [],
        error: data.error || null,
        projectUrl: data.projectUrl || '',
        projectName: data.projectName || '',
        returnUrl: data.returnUrl || '',
      } );

      if ( data.stage === STAGE_DONE ) {
        done.current = true;
        /*
         * Hand off to Hatch's own callback, which is what actually saves the
         * deploy. Same-origin, and PHP already refused any return_url that was
         * not on this site — a broker naming somewhere else would otherwise be
         * an open redirect.
         */
        if ( data.returnUrl ) {
          window.location.href = data.returnUrl;
        }
        return;
      }
      if ( data.stage === STAGE_FAILED ) {
        done.current = true;
      }
    } catch ( e ) {
      // A single blip should not kill a 90-second build view; a persistent
      // failure surfaces once the deadline below passes.
      setFatal( ( e && e.message ) || __( 'Could not read the deploy status.', 'uichemy' ) );
    }
  }, [ ticket, provider ] );

  useEffect( () => {
    let alive = true;
    const tick = async () => {
      if ( ! alive || done.current ) return;
      if ( Date.now() - startedAt.current > MAX_POLL_MS ) {
        done.current = true;
        setFatal(
          __( 'Gave up waiting for the deploy. The build may still be running — check the host’s dashboard.', 'uichemy' )
        );
        return;
      }
      await poll();
      if ( alive && ! done.current ) timer.current = setTimeout( tick, POLL_MS );
    };
    tick();
    return () => {
      alive = false;
      if ( timer.current ) clearTimeout( timer.current );
    };
  }, [ poll ] );

  // Follow the tail, the way a terminal does — but only while the user has not
  // scrolled up to read something, or it would yank the view out from under them.
  useEffect( () => {
    const el = logRef.current;
    if ( ! el ) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if ( atBottom ) el.scrollTop = el.scrollHeight;
  }, [ state.log ] );

  const stage = STAGES[ state.stage ] || STAGES.building;
  const elapsed = Math.floor( ( Date.now() - startedAt.current ) / 1000 );

  return (
    <div className="nd-hatch">
      <ScreenHead
        title={ __( 'Sync with Astro', 'uichemy' ) }
        subtitle={ sprintf(
          /* translators: %s: hosting provider name, e.g. Vercel */
          __( 'Deploying to %s. This usually takes 60–90 seconds — you can stay on this page.', 'uichemy' ),
          provider ? provider.charAt( 0 ).toUpperCase() + provider.slice( 1 ) : __( 'your host', 'uichemy' )
        ) }
      />

      <div className={ `nd-deploy nd-deploy--${ stage.tone }` }>
        <div className="nd-deploy__bar">
          <span className="nd-deploy__spin">
            { 'busy' === stage.tone ? <Icon.Spinner size={ 16 } /> : null }
            { 'ok' === stage.tone ? <Icon.Check size={ 16 } /> : null }
            { 'bad' === stage.tone ? <Icon.Warn size={ 16 } /> : null }
          </span>
          <strong className="nd-deploy__stage">{ stage.label }</strong>
          { 'busy' === stage.tone ? (
            <span className="nd-deploy__elapsed">{ sprintf( __( '%ds', 'uichemy' ), elapsed ) }</span>
          ) : null }
        </div>

        { state.error ? (
          <Alert tone="danger" className="nd-deploy__err">{ state.error }</Alert>
        ) : null }
        { fatal ? (
          <Alert tone="warning" className="nd-deploy__err">{ fatal }</Alert>
        ) : null }

        {/* Rendered as text, never markup: these lines come from a build running
            on another machine. */}
        <pre className="nd-deploy__log" ref={ logRef } aria-live="polite" aria-label={ __( 'Build log', 'uichemy' ) }>
          { state.log.length
            ? state.log.join( '\n' )
            : __( 'Waiting for the build host…', 'uichemy' ) }
        </pre>

        <p className="nd-deploy__foot">
          { __(
            'The build runs on the Hatch deploy broker. Your host token is held in memory for the build only and dropped when it finishes.',
            'uichemy'
          ) }
        </p>

        { STAGE_FAILED === state.stage || fatal ? (
          <Button variant="ghost" tone="neutral" size="sm" onClick={ onDismiss }>
            { __( 'Back to setup', 'uichemy' ) }
          </Button>
        ) : null }
      </div>
    </div>
  );
}
