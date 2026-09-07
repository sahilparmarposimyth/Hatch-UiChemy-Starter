import { useState, useMemo, useCallback } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { getBoot, request, requestRoot } from '../lib/api.js';

/**
 * useBuilderSetup, the page-builder step's install/activate orchestration,
 * extracted verbatim from the (now QA-only) wizard in App.jsx so the
 * in-dashboard SetupFlow drives the SAME behaviour: install/activate the chosen
 * builder, and for Elementor also install/activate the required UiChemy
 * companion, before persisting the choice and advancing.
 *
 * `notify(message, variant)` is optional, pass a toast fn if you have one;
 * errors are also mirrored to the returned `error` string for inline display.
 *
 * NOTE: App.jsx keeps its own inline copy for the legacy preview wizard; this
 * hook is the canonical path for real (in-dashboard) first-run.
 */
export function useBuilderSetup( notify ) {
  const boot = getBoot();
  const notifyFn = notify || ( () => {} );

  // Default selection: previously-saved builder if still active, else the first
  // active one, else Elementor (Continue can then drive install/activate).
  const [ builder, setBuilder ] = useState( () => {
    const det = boot?.state?.builders || {};
    const isActive = ( id ) => !! det[ id ]?.active;
    const saved = boot?.state?.builder;
    if ( saved && isActive( saved ) ) return saved;
    return [ 'elementor', 'bricks', 'gutenberg' ].find( isActive ) || 'elementor';
  } );

  // Local override merged on top of boot's detected map so the cards flip to
  // "Active" immediately after a Continue-driven install/activate.
  const [ detectedOverride, setDetectedOverride ] = useState( {} );
  const detected = useMemo(
    () => ( { ...( boot?.state?.builders || {} ), ...detectedOverride } ),
    [ boot?.state?.builders, detectedOverride ]
  );

  // Fresh UiChemy detection merged on top of boot's stale snapshot.
  const [ uichemyOverride, setUiChemyOverride ] = useState( null );
  const uichemyDet = uichemyOverride || boot?.state?.uichemy || {};
  const uichemyActive = !! uichemyDet.active;
  const uichemyInstalled = !! uichemyDet.installed;
  const uichemyUpdate = !! uichemyDet.update_available;

  const [ busy, setBusy ] = useState( false );
  const [ error, setError ] = useState( '' );

  const intent = useMemo( () => {
    const det = detected[ builder ] || {};
    if ( builder === 'elementor' ) {
      const allActive = det.active && uichemyActive;
      if ( allActive ) return uichemyUpdate ? 'update' : 'continue';
      const needInstall = ! det.installed || ! uichemyInstalled;
      return needInstall ? 'install' : 'activate';
    }
    if ( det.active ) return 'continue';
    if ( det.installed ) return 'activate';
    // Bricks isn't installable from us, the in-card "Get Bricks" link is the
    // only path forward, so Continue stays disabled (null) until it's present.
    if ( builder === 'bricks' ) return null;
    return 'install';
  }, [ builder, detected, uichemyActive, uichemyInstalled, uichemyUpdate ] );

  const label = useMemo( () => {
    if ( busy ) {
      return intent === 'install' ? __( 'Installing…', 'uichemy' )
        : intent === 'activate' ? __( 'Activating…', 'uichemy' )
        : intent === 'update' ? __( 'Updating…', 'uichemy' )
        : __( 'Working…', 'uichemy' );
    }
    if ( intent === 'install' ) return __( 'Install & Activate', 'uichemy' );
    if ( intent === 'activate' ) return __( 'Activate & Continue', 'uichemy' );
    if ( intent === 'update' ) return __( 'Update & Continue', 'uichemy' );
    return __( 'Continue', 'uichemy' );
  }, [ intent, busy ] );

  const persistBuilder = async () => {
    try { await request( '/builder', { method: 'POST', body: { builder } } ); }
    catch ( e ) { console.warn( '[nd] persist failed /builder', e ); }
  };

  /**
   * Drive the builder step. `onDone` runs only after the builder (and, for
   * Elementor, UiChemy) is ready and the choice is persisted, the caller uses
   * it to advance to the next step. Returns nothing; read `busy`/`error`.
   */
  const run = useCallback( async ( onDone ) => {
    setError( '' );
    if ( ! builder ) return;

    // Non-Elementor builders: only advance when already active (install /
    // activate for those happens via the in-card links).
    if ( builder !== 'elementor' ) {
      if ( intent === 'continue' ) { await persistBuilder(); onDone?.(); }
      return;
    }

    // Elementor + UiChemy already active → nothing to install, advance.
    if ( intent === 'continue' ) { await persistBuilder(); onDone?.(); return; }

    setBusy( true );
    try {
      // 1. Elementor, install/activate only if it isn't active yet.
      const elemDet = detected.elementor || {};
      if ( ! elemDet.active ) {
        const action = elemDet.installed ? 'activate' : 'install';
        const route = action === 'install'
          ? 'uichemy/v2/system/plugin/install'
          : 'uichemy/v2/system/plugin/activate';
        const res = await requestRoot( route, { method: 'POST', body: { slug: 'elementor' } } );

        if ( ! res || res.success === false ) {
          if ( res?.activate_url ) {
            notifyFn( __( 'Finishing activation in WP-Admin…', 'uichemy' ), 'info' );
            window.location.href = res.activate_url;
            return;
          }
          const msg = ( res && res.message ) || sprintf( __( 'Could not %s Elementor.', 'uichemy' ), action );
          setError( msg );
          notifyFn( msg, 'error' );
          return;
        }
        setDetectedOverride( ( prev ) => ( { ...prev, elementor: { installed: true, active: true } } ) );
      }

      // 2. UiChemy, install/activate if needed, or update if newer.
      if ( ! uichemyActive || uichemyUpdate ) {
        const res = await request( 'uichemy/install', { method: 'POST' } );
        if ( res && ( res.action === 'activated' || res.action === 'already_active' ) ) {
          setUiChemyOverride( { ...( res.uichemy || {} ), installed: true, active: true } );
        } else if ( res && res.uichemy ) {
          setUiChemyOverride( res.uichemy );
        }
        if ( res && res.action === 'activate_url' && res.activate_url ) {
          notifyFn( __( 'Finishing UiChemy activation in WP-Admin…', 'uichemy' ), 'info' );
          window.open( res.activate_url, '_blank', 'noopener' );
          setBusy( false );
          return;
        }
      }

      notifyFn( __( 'Elementor and UiChemy are ready.', 'uichemy' ), 'success' );
      await persistBuilder();
      onDone?.();
    } catch ( e ) {
      const msg = e?.message || __( 'Could not finish setup. Please try again.', 'uichemy' );
      setError( msg );
      notifyFn( msg, 'error' );
    } finally {
      setBusy( false );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ builder, intent, detected, uichemyActive, uichemyUpdate ] );

  return {
    builder,
    setBuilder,
    detected,
    uichemy: {
      active: uichemyActive,
      installed: uichemyInstalled,
      update_available: uichemyUpdate,
      latest_version: uichemyDet.latest_version,
      bundled: uichemyDet.bundled,
    },
    intent,
    label,
    busy,
    error,
    run,
  };
}
