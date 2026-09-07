/**
 * UiChemy Composer — Gutenberg glue.
 *
 * The floating-panel editor (registry + helpers + panel + editor JS) and the
 * React composer app were built for Elementor, but their panel UI is
 * builder-agnostic and exposed on `window.UichUiChemyComposerEditor` (UichSHE).
 * The only Elementor-specific piece is the `panel/open_editor` handler that
 * shows the panel and switches tabs — which never runs without `window.elementor`.
 *
 * This adapter provides the Gutenberg equivalent: `UichSHE.uichOpenComposerTab()`,
 * which injects the panel shell (so the React app mounts into it), shows it, and
 * activates the requested tab. Per-block settings binding is handled separately by
 * the React bridge (window.UichComposerGutenberg, from composer-gutenberg.jsx).
 */
( function () {
	'use strict';

	var PANEL_ID = 'uichemy-composer-floating-panel';

	function she() { return window.UichUiChemyComposerEditor || null; }

	/** Ensure the floating panel DOM exists (injected by panel.js / UichSHE). */
	function ensurePanel() {
		var UichSHE = she();
		if ( ! document.getElementById( PANEL_ID ) && UichSHE && typeof UichSHE.injectFloatingPanel === 'function' ) {
			try { UichSHE.injectFloatingPanel(); } catch ( e ) { /* ignore */ }
		}
	}

	function showPanel() {
		var panel = document.getElementById( PANEL_ID );
		if ( ! panel ) {
			return;
		}
		document.body.classList.add( 'uichemy-composer-active' );
		panel.classList.add( 'active' );
		panel.classList.remove( 'minimized' );
	}

	// Click the panel's tab button for the requested tab. The panel (or React) may
	// mount a tick after the shell is injected, so retry briefly.
	//
	// The React composer app (composer-app.jsx) renders its tab bar as plain
	// `.panel-tab` buttons with visible labels ("Editor" / "Code" / "Chat AI") and
	// no `data-uichemy-composer-tab` attribute — that attribute only exists on a
	// separate, older static HTML panel shell. Try the data-attribute selector
	// first (in case that shell is ever what's actually mounted), then fall back
	// to matching the real React tab button by its label so the toolbar's
	// Editor/Code/Chat buttons actually switch the panel instead of silently
	// no-op'ing after the shared panel is shown.
	var TAB_LABELS = { direct: 'Editor', code: 'Code', chat: 'Chat' };
	function findTabButton( t ) {
		var byAttr = document.querySelector( '#' + PANEL_ID + ' [data-uichemy-composer-tab="' + t + '"]' );
		if ( byAttr ) { return byAttr; }
		var panel = document.getElementById( PANEL_ID );
		if ( ! panel ) { return null; }
		var label = TAB_LABELS[ t ] || t;
		var buttons = panel.querySelectorAll( '.panel-tab' );
		for ( var i = 0; i < buttons.length; i++ ) {
			if ( buttons[ i ].textContent.trim().indexOf( label ) === 0 ) {
				return buttons[ i ];
			}
		}
		return null;
	}
	function isActive( btn ) {
		return !! btn && ( ' ' + btn.className + ' ' ).indexOf( ' active ' ) !== -1;
	}

	// Click the tab button, then verify shortly after that it actually became
	// active. On the panel's very first render (right after injectFloatingPanel()
	// mounts the React app), the button DOM node can exist a tick before React has
	// attached its click listener to it — so a click at that exact moment can be a
	// silent no-op even though the element was found. Re-clicking (not just
	// re-finding) until the "active" class actually appears makes this robust to
	// that race instead of exiting the retry loop the instant a DOM node is found.
	function switchTab( tab ) {
		var t = tab || 'direct';
		var attempts = 0;
		( function attempt() {
			var btn = findTabButton( t );
			if ( ! btn ) {
				if ( attempts++ < 30 ) { window.setTimeout( attempt, 60 ); }
				return;
			}
			if ( isActive( btn ) ) { return; }
			btn.click();
			window.setTimeout( function () {
				if ( ! isActive( findTabButton( t ) ) && attempts++ < 30 ) {
					window.setTimeout( attempt, 60 );
				}
			}, 40 );
		} )();
	}

	function uichOpenComposerTab( tab ) {
		ensurePanel();
		showPanel();
		switchTab( tab );
	}

	// Elementor's `hideFloatingPanel`/`closeFloatingPanel` (uichemy-composer-editor.js)
	// only get defined inside its `onElementorInit()`, which never runs without
	// `window.elementor` — so under Gutenberg `UichSHE.hideFloatingPanel` is never
	// set and the panel's Close button (composer-app.jsx) silently no-ops. Provide
	// the Gutenberg equivalent here.
	function hideFloatingPanel() {
		var panel = document.getElementById( PANEL_ID );
		document.body.classList.remove( 'uichemy-composer-active' );
		if ( panel ) {
			panel.classList.remove( 'active' );
		}
	}

	// Attach to the shared panel global so the block script can call it. If the
	// panel scripts haven't defined the global yet, create a minimal holder; they
	// merge onto the same object when they load.
	var UichSHE = she();
	if ( UichSHE ) {
		if ( typeof UichSHE.uichOpenComposerTab !== 'function' ) {
			UichSHE.uichOpenComposerTab = uichOpenComposerTab;
		}
		if ( typeof UichSHE.hideFloatingPanel !== 'function' ) {
			UichSHE.hideFloatingPanel = hideFloatingPanel;
		}
	} else {
		window.UichUiChemyComposerEditor = { uichOpenComposerTab: uichOpenComposerTab, hideFloatingPanel: hideFloatingPanel };
	}
} )();
