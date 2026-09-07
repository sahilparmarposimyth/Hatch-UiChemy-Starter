import React, { useCallback, useEffect, useRef, useState } from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import ScreenHead from '../../components/ScreenHead.jsx';
import { Alert, Button } from '../../design-system';
import { getBoot } from '../../lib/api.js';

/**
 * Sync with Elementor — the merged Hatch runtime, hosted in this content area.
 *
 * Hatch turns the site into a headless WordPress: an Elementor/Gutenberg build
 * here, a static Astro frontend deployed to Cloudflare / Vercel / a VPS. Its
 * setup wizard is what connects the two, and it is the first thing this screen
 * shows.
 *
 * Why an iframe rather than Hatch's screens rendered inline
 * ---------------------------------------------------------
 * Hatch's admin is its own complete React app with its own design tokens, its
 * own CSS reset and its own web font. Mounted into this dashboard's DOM the two
 * systems fight and neither survives intact. Its wizard also advances through
 * real form POSTs to `admin-post.php` handlers so all of its server logic runs
 * — full page loads, which inside an iframe are free and on this page would
 * destroy the SPA. See includes/hatch/class-uich-hatch-embed.php, which strips
 * the WordPress chrome off those pages so only the body arrives here.
 *
 * The frame is measured and sized to its content (same origin, so the inner
 * document is readable), which is what makes it read as part of this page
 * rather than as a panel with its own scrollbar.
 */

/** No content shorter than this — avoids a collapsed frame on first paint. */
const MIN_HEIGHT = 480;

/**
 * Keep an iframe's height equal to its content's height.
 *
 * Re-measured on load — which fires again on every navigation INSIDE the frame,
 * so each wizard step re-fits — and on any later reflow of the inner document
 * via a ResizeObserver. Both are wrapped: same-origin access is expected to
 * work here, but a browser that refuses it should degrade to a tall scrolling
 * frame, never to a thrown render.
 *
 * @return {{ ref: object, height: number, remeasure: Function }} Frame plumbing.
 */
function useFrameAutoHeight() {
  const ref = useRef( null );
  const observer = useRef( null );
  const [ height, setHeight ] = useState( MIN_HEIGHT );

  const measure = useCallback( () => {
    const frame = ref.current;
    if ( ! frame ) return;
    try {
      const doc = frame.contentDocument;
      if ( ! doc || ! doc.documentElement ) return;
      // scrollHeight of BOTH: WP admin pages give body the layout, but a short
      // page leaves body smaller than the html box.
      const next = Math.max(
        doc.documentElement.scrollHeight || 0,
        doc.body ? doc.body.scrollHeight : 0,
        MIN_HEIGHT
      );
      setHeight( ( prev ) => ( Math.abs( prev - next ) > 1 ? next : prev ) );
    } catch ( _ ) {
      /* Cross-origin refusal — keep the last known height. */
    }
  }, [] );

  const remeasure = useCallback( () => {
    measure();

    // Re-bind on every load: the previous inner document is gone after a
    // navigation, and an observer still pointed at it would never fire again.
    if ( observer.current ) {
      observer.current.disconnect();
      observer.current = null;
    }
    try {
      const doc = ref.current && ref.current.contentDocument;
      if ( ! doc || ! doc.documentElement || typeof ResizeObserver === 'undefined' ) return;
      observer.current = new ResizeObserver( measure );
      observer.current.observe( doc.documentElement );
      if ( doc.body ) observer.current.observe( doc.body );
    } catch ( _ ) {
      /* Observer is an optimisation; onLoad measuring alone still works. */
    }
  }, [ measure ] );

  useEffect(
    () => () => {
      if ( observer.current ) observer.current.disconnect();
    },
    []
  );

  return { ref, height, remeasure };
}

/**
 * The two things this screen can frame. The wizard is the point of the screen;
 * the admin UI is where the wizard leaves you, and where you go back to.
 */
const VIEWS = [
  {
    id: 'wizard',
    label: __( 'Setup wizard', 'uichemy' ),
    urlKey: 'wizardUrl',
    openKey: 'wizardOpenUrl',
  },
  {
    id: 'admin',
    label: __( 'Hatch', 'uichemy' ),
    urlKey: 'adminUrl',
    openKey: 'adminOpenUrl',
  },
];

export default function SyncElementor() {
  const boot = getBoot();
  const hatch = boot?.hatch || { available: false };

  /*
   * What the user asked for — this drives the frame's src, and nothing else.
   *
   * It starts on the wizard until setup has been completed, then on the admin
   * UI: a site that has already been through setup does not want dropping back
   * at step 1 every time it opens this tab, and one that hasn't wants nothing
   * else on screen.
   */
  const [ view, setView ] = useState( () => ( hatch.wizardDone ? 'admin' : 'wizard' ) );
  // What the frame is actually showing, read back from its URL on each load.
  // The two diverge whenever the frame navigates on its own — which is exactly
  // what finishing the wizard does: it redirects to `page=hatch`.
  const [ framePage, setFramePage ] = useState( '' );
  const { ref, height, remeasure } = useFrameAutoHeight();

  const onFrameLoad = useCallback( () => {
    remeasure();
    try {
      const href = ref.current && ref.current.contentWindow && ref.current.contentWindow.location.href;
      if ( ! href ) return;
      setFramePage( new URL( href ).searchParams.get( 'page' ) || '' );
    } catch ( _ ) {
      /* Cross-origin refusal — the toggle just keeps following `view`. */
    }
    // ref is a stable useRef container, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ remeasure ] );

  /*
   * Setup is finished if the server said so at page load, OR if the frame has
   * since landed on Hatch's dashboard by itself — which is where the wizard
   * hands off on its last step. Without the second half the Wizard/Hatch
   * toggle stayed hidden until the whole dashboard page was reloaded, because
   * `hatch.wizardDone` is a snapshot taken before the wizard was ever run.
   */
  const setupDone = !! hatch.wizardDone || 'hatch' === framePage;

  /*
   * Highlight what is ON SCREEN rather than what was last clicked — after a
   * hand-off those are different, and highlighting the click would label the
   * Hatch dashboard "Setup wizard".
   */
  const shown =
    'hatch' === framePage ? 'admin' : ( 'hatch-setup' === framePage ? 'wizard' : view );

  // Clearing framePage on an explicit switch lets `shown` follow the click
  // immediately, instead of lagging until the new document reports back.
  const pick = ( id ) => {
    setFramePage( '' );
    setView( id );
  };

  // src follows `view` (what was asked for), so a hand-off inside the frame
  // never yanks the frame back. "Open full screen" follows `shown`, so it opens
  // the page actually on screen rather than the one last clicked.
  const active = VIEWS.find( ( v ) => v.id === view ) || VIEWS[ 0 ];
  const onScreen = VIEWS.find( ( v ) => v.id === shown ) || active;
  const src = hatch[ active.urlKey ] || '';
  const openUrl = hatch[ onScreen.openKey ] || '';

  const subtitle = __(
    'Publish this site as a static frontend on Cloudflare, Vercel or your own server, and keep editing it here.',
    'uichemy'
  );

  // ── Nothing to frame ────────────────────────────────────────────────────
  // Each branch names the actual cause, because the fixes are different: one
  // clears itself, one needs a build, one needs a re-install.

  if ( ! hatch.available ) {
    return (
      <div className="nd-hatch">
        <ScreenHead title={ __( 'Sync with Elementor', 'uichemy' ) } subtitle={ subtitle } />
        { hatch.standalone ? (
          <Alert tone="warning" title={ __( 'Retiring the standalone Hatch plugin', 'uichemy' ) }>
            { __(
              'UiChemy now includes Hatch, so the separate Hatch plugin is being deactivated for you — running both at once would crash the site. Reload this page to finish. All of your Hatch settings carry over untouched.',
              'uichemy'
            ) }
          </Alert>
        ) : (
          <Alert tone="warning" title={ __( 'Hatch is unavailable', 'uichemy' ) }>
            { __(
              'The bundled Hatch runtime could not be loaded, so there is nothing to set up yet. Re-installing UiChemy restores it.',
              'uichemy'
            ) }
          </Alert>
        ) }
      </div>
    );
  }

  if ( hatch.buildMissing ) {
    return (
      <div className="nd-hatch">
        <ScreenHead title={ __( 'Sync with Elementor', 'uichemy' ) } subtitle={ subtitle } />
        <Alert tone="warning" title={ __( 'Hatch’s admin bundle has not been built', 'uichemy' ) }>
          { __( 'Run this from the plugin root, then reload:', 'uichemy' ) }
          <code className="nd-hatch__cmd">cd hatch &amp;&amp; npm install &amp;&amp; npm run build:admin</code>
        </Alert>
      </div>
    );
  }

  // ── The real thing ──────────────────────────────────────────────────────

  return (
    <div className="nd-hatch">
      <ScreenHead
        title={ __( 'Sync with Elementor', 'uichemy' ) }
        subtitle={ subtitle }
        action={
          <div className="nd-hatch__actions">
            {/* Only offered once setup is done. Before that the wizard is the
                only screen worth being on, and a switch away from it reads as
                an invitation to skip it. */}
            { setupDone
              ? VIEWS.map( ( v ) => (
                <Button
                  key={ v.id }
                  variant={ v.id === shown ? 'solid' : 'ghost' }
                  tone={ v.id === shown ? 'brand' : 'neutral' }
                  size="sm"
                  onClick={ () => pick( v.id ) }
                >
                  { v.label }
                </Button>
              ) )
              : null }
            { openUrl ? (
              <Button
                variant="ghost"
                tone="neutral"
                size="sm"
                onClick={ () => window.open( openUrl, '_blank', 'noopener' ) }
                title={ __( 'Open in a new tab', 'uichemy' ) }
              >
                <Icon.ExtLink size={ 14 } aria-hidden="true" />
                <span>{ __( 'Open full screen', 'uichemy' ) }</span>
              </Button>
            ) : null }
          </div>
        }
      />

      { ! hatch.elementor ? (
        <Alert tone="warning" title={ __( 'Elementor is not active', 'uichemy' ) }>
          { __(
            'Hatch can still publish this site, but pages built with Elementor are what it syncs. Activate Elementor to get the full flow.',
            'uichemy'
          ) }
        </Alert>
      ) : null }

      <div className="nd-hatch__frame-wrap">
        <iframe
          ref={ ref }
          // Remounts the element when the view changes, so the new document
          // starts from a clean measurement rather than inheriting the old
          // one's height for a frame.
          key={ active.id }
          className="nd-hatch__frame"
          src={ src }
          title={ active.id === 'wizard' ? __( 'Hatch setup wizard', 'uichemy' ) : __( 'Hatch', 'uichemy' ) }
          style={ { height: `${ height }px` } }
          onLoad={ onFrameLoad }
        />
      </div>
    </div>
  );
}
