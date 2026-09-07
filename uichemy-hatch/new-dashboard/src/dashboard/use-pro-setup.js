import { useState, useCallback } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { getBoot, request } from '../lib/api.js';
import { toast } from '../design-system';

/**
 * useProSetup — the UiChemy Pro install/activate orchestration, shared by the
 * onboarding step (screens/wizard/ProScreen.jsx) and the sidebar rail card
 * (components/DashShell.jsx) so both drive the SAME server call and land on the
 * same states. Written as a hook for the same reason useBuilderSetup is: two
 * unrelated screens need one behaviour, and duplicating it is how the two drift.
 *
 * Server contract — POST /uichemy-pro/install (Uich_ND_Api):
 *   already_active → nothing to do
 *   activated      → an installed-but-inactive copy was switched on
 *   installed      → the zip was downloaded, installed AND activated
 *   updated        → an out-of-date copy was overwrite-installed in place
 *   activate_url   → installed, but its bootstrap threw; finish in WP-Admin
 *
 * One endpoint, four outcomes: the server compares the installed version against
 * the API's published `uichemy_pro.latest_version` and picks. So "Update" is the
 * same POST as "Install" — this hook only changes the label.
 *
 * On `activate_url` we hand the user off to plugins.php rather than retrying:
 * WordPress sandboxes the plugin include there and reports the real error,
 * where our REST request can only return an opaque 500.
 */
export function useProSetup() {
  const boot = getBoot();
  const detected = boot?.state?.uichemyPro || {};

  // Server-fresh detection, merged over boot's snapshot so the UI flips the
  // moment the call returns instead of waiting for a reload.
  const [ override, setOverride ] = useState( null );
  const pro = override || detected;

  const [ busy, setBusy ] = useState( false );
  const [ error, setError ] = useState( '' );
  const [ done, setDone ] = useState( false );

  const installed = !! pro.installed;
  const active = !! pro.active;
  /**
   * Is the installed copy behind the version published on the API?
   *
   * Computed server-side by Uich_ND_Settings::detect_uichemy_pro: the version
   * WordPress reports for the installed Pro plugin, against the one the UiChemy
   * API publishes. So the prompt appears the moment a release goes up — no plugin
   * update needed to learn about one.
   *
   * `done` excludes it so a run that just updated doesn't immediately ask again
   * while `pro` still holds the pre-run snapshot.
   */
  const updateAvailable = !! pro.update_available;
  const latestVersion = pro.latest_version || '';
  /**
   * Is Pro unlocked?
   *
   * `active` OR `is_pro`, not just one of them:
   *
   *   `is_pro` alone misses a fresh activation — the plugin defines UICHEMY_PRO
   *   on its NEXT request, so uichemy_is_pro() still answers false in the
   *   response that activated it (see the installer's uichemy_pro_payload).
   *
   *   `active` alone misses a site that unlocks Pro without this plugin (the
   *   UICHEMY_PRO constant, or the `uich_composer_is_pro` filter), which would
   *   then be nagged to install something it does not need.
   *
   * `done` covers the third case: this session just activated it successfully.
   */
  const unlocked = active || !! pro.is_pro || done;
  const zipConfigured = !! pro.zip_configured;

  /** An update is only actionable on a copy that is actually installed here. */
  const needsUpdate = installed && updateAvailable && ! done;

  /** What pressing the button will actually do — drives its label. */
  const intent = needsUpdate ? 'update' : unlocked ? 'done' : installed ? 'activate' : 'install';

  const label = intent === 'update'
    ? __( 'Update UiChemy Pro', 'uichemy' )
    : intent === 'done'
      ? __( 'UiChemy Pro is active', 'uichemy' )
      : intent === 'activate'
        ? __( 'Activate UiChemy Pro', 'uichemy' )
        : __( 'Install & Activate', 'uichemy' );

  const run = useCallback( async ( onDone ) => {
    // An unlocked site still has work to do when it is out of date.
    if ( busy || ( unlocked && ! needsUpdate ) ) return;
    setBusy( true );
    setError( '' );
    try {
      const res = await request( '/uichemy-pro/install', { method: 'POST' } );

      // Its bootstrap threw, or in-process activation didn't stick. plugins.php
      // sandboxes the include and surfaces the real reason.
      if ( res?.action === 'activate_url' && res.activate_url ) {
        window.location.href = res.activate_url;
        return;
      }

      if ( res?.uichemyPro ) setOverride( res.uichemyPro );
      setDone( true );

      /*
       * Tell the user it landed.
       *
       * Fired HERE, in the hook, rather than at each call site: the rail card
       * and the onboarding step both run this, and the onboarding step advances
       * to the next screen the moment it succeeds — so a toast owned by the
       * screen would unmount before it was read. The Toaster is mounted at the
       * dashboard root (see DashboardApp) and outlives both.
       *
       * The message names what actually happened, which is why it reads the
       * response's `action` instead of assuming: pressing one button can install,
       * activate, or update, and "installed" on a copy that was only switched on
       * would be wrong.
       */
      const fresh = res?.uichemyPro || {};
      const version = fresh.version ? String( fresh.version ) : '';
      const title =
        res?.action === 'updated' ? __( 'UiChemy Pro updated', 'uichemy' ) :
        res?.action === 'already_active' ? __( 'UiChemy Pro is already active', 'uichemy' ) :
        res?.action === 'activated' ? __( 'UiChemy Pro activated', 'uichemy' ) :
        __( 'UiChemy Pro installed and activated', 'uichemy' );

      toast.success( title, {
        description: version
          // translators: %s is the plugin version, e.g. "1.4.2".
          ? sprintf( __( 'Version %s is ready. Pro features are unlocked on this site.', 'uichemy' ), version )
          : __( 'Pro features are unlocked on this site.', 'uichemy' ),
      } );

      if ( onDone ) onDone( res );
    } catch ( e ) {
      setError( ( e && e.message ) || __( 'Could not set up UiChemy Pro. Please try again.', 'uichemy' ) );
    } finally {
      setBusy( false );
    }
  }, [ busy, unlocked, needsUpdate ] );

  return { pro, installed, active, unlocked, zipConfigured, updateAvailable, needsUpdate, latestVersion, intent, label, busy, error, run };
}
