/**
 * One-time "Edit Condition" launcher for the block editor.
 *
 * Creating a Theme Builder template opens the Gutenberg editor in a new tab.
 * That is the one moment the author is being asked "where should this appear?",
 * so a button rides the editor header there and opens the dashboard's own
 * conditions dialog in place — no trip back to the dashboard mid-build.
 *
 * It is deliberately a ONE-TIME offer. PHP only loads this when the URL carries
 * the `uich_tb_new` flag the dashboard added when it opened the tab, and the
 * first thing we do here is strip that flag from the address bar. A refresh
 * therefore arrives clean, nothing is enqueued, and conditions go back to being
 * the dashboard's job — which keeps one obvious home for them instead of two
 * half-equal ones.
 *
 * The dialog itself is imported, not rebuilt: same component, same
 * tb_update_conditions endpoint as the dashboard.
 */
import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import { createRoot } from '@wordpress/element';
import { ConditionsDialog } from './ThemeBuilderConditions.jsx';
import { Button, TooltipProvider } from '../../design-system';
import * as Icon from '../../components/icons.jsx';

const BUTTON_ID = 'uich-tb-edit-condition';
// Where WordPress puts the header's centre group (title, shortcut hint). Both
// spellings exist across versions — `editor-header__center` is current, the
// `edit-post-` one is the older shell.
const HEADER_SELECTORS = [
  '.editor-header__center',
  '.edit-post-header__center',
  '.editor-header__settings',
];

function findHeader( doc ) {
  for ( const sel of HEADER_SELECTORS ) {
    const node = doc.querySelector( sel );
    if ( node ) return node;
  }
  return null;
}

function LauncherButton( { tpl } ) {
  const [ open, setOpen ] = useState( false );
  const [ saved, setSaved ] = useState( false );
  const [ current, setCurrent ] = useState( tpl );

  return (
    <>
      <Button
        variant="outline"
        tone="neutral"
        size="sm"
        onClick={ () => setOpen( true ) }
      >
        <Icon.Sliders size={ 14 } />
        { saved ? __( 'Conditions saved', 'uichemy' ) : __( 'Edit Condition', 'uichemy' ) }
      </Button>
      { open ? (
        <ConditionsDialog
          tpl={ current }
          onClose={ () => setOpen( false ) }
          onSaved={ ( updated ) => {
            // Keep the dialog seeded with what was just written, so reopening it
            // in the same session shows the saved rules rather than the originals.
            if ( updated ) setCurrent( updated );
            setSaved( true );
          } }
        />
      ) : null }
    </>
  );
}

/**
 * Mount the launcher, if this page is the one-time editor tab.
 *
 * Safe to call unconditionally — it returns immediately anywhere else.
 */
export default function bootConditionLauncher() {
  const boot = typeof window !== 'undefined' ? window.uich_tb_condition_launcher : null;
  if ( ! boot || ! boot.tpl || ! boot.tpl.id ) return;

  // Drop the flag from the address bar FIRST, so the offer cannot survive a
  // reload even if anything below throws.
  try {
    const url = new URL( window.location.href );
    url.searchParams.delete( boot.flag || 'uich_tb_new' );
    window.history.replaceState( null, '', url.toString() );
  } catch ( e ) { /* older browser — the flag simply stays in the URL */ }

  const doc = document;
  const host = doc.createElement( 'div' );
  host.id = BUTTON_ID;
  // `uc-content` is the design-system scope every --uc-* token resolves on; the
  // dashboard's own mount sets it too. Without it the button and the dialog
  // render with unresolved custom properties.
  host.className = 'uc-content uich-tb-ec-host';

  let root = null;
  const mount = () => {
    if ( host.isConnected ) return true;
    const header = findHeader( doc );
    if ( ! header ) return false;
    header.appendChild( host );
    if ( ! root ) {
      root = createRoot( host );
      root.render(
        <TooltipProvider delayDuration={ 200 }>
          <LauncherButton tpl={ boot.tpl } />
        </TooltipProvider>
      );
    }
    return true;
  };

  if ( mount() ) return;

  // The header mounts asynchronously, and React re-renders can drop our node
  // back out of it. Watch until it sticks, then stop — an observer left running
  // for the life of the editor is a cost with nothing to show for it.
  const obs = new MutationObserver( () => { if ( mount() ) obs.disconnect(); } );
  try {
    obs.observe( doc.body, { childList: true, subtree: true } );
  } catch ( e ) { /* nothing to watch — the button just will not appear */ }
  // Hard stop, so a header that never appears cannot leave an observer walking
  // every mutation in the editor forever.
  window.setTimeout( () => obs.disconnect(), 20000 );
}
