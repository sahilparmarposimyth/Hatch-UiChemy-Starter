/**
 * UiChemy Composer — Bricks Builder glue.
 *
 * VERIFIED against a real Bricks 2.x install (theme zip provided and tested
 * live in the actual builder, not just a third-party addon's source):
 *   - The `.uichemy-bricks-launcher` div (from our element's `uichemy_launcher`
 *     info control) DOES render as live HTML in the settings panel — Bricks'
 *     `info` control type renders `content` unescaped.
 *   - It renders inside a COLLAPSED accordion group by default (Bricks groups
 *     controls under collapsible `<li class="control-group">` sections) — the
 *     user must expand the "UiChemy Composer" group once per session for the
 *     launcher/settings control to mount. watch() below still finds it fine
 *     once expanded; this is just a one-extra-click UX note, not a bug.
 *   - resolveElementId(): the selected element's real id lives on
 *     `li.bricks-draggable-item.active[data-id]` in the Structure panel — a
 *     different DOM subtree than the settings panel itself — confirmed via
 *     live inspection, not guessed.
 *   - The `uichemy_settings` textarea control is wrapped in
 *     `[data-controlkey="uichemy_settings"]` (not `data-control`, and it has
 *     no `name` attribute) — see composer-bricks.jsx's matching selector.
 *
 * Per-slot Text/Image editing uses Bricks' OWN native `text`/`image` controls
 * (class-uichemy-bricks-composer.php declares 20 fixed slots), not a
 * custom-built UI — verified live:
 *   - `uichemy_slot_{i}_text` renders as a real `.control-text` with Bricks'
 *     own dynamic-data flash-icon button; a single `input[type="text"]` lives
 *     inside `[data-controlkey="uichemy_slot_{i}_text"]`.
 *   - `uichemy_slot_{i}_image` renders as a real `.control-image` with a
 *     native "Select image" media-library trigger, PLUS a "Custom URL" text
 *     field (`input[type="text"]` inside a `.external-url` wrapper within the
 *     same `[data-controlkey="uichemy_slot_{i}_image"]`). Typing a plain URL
 *     into that field runs through Bricks' own `setExternalUrl()` (confirmed
 *     by reading main.min.js), which emits `{url, external:true, filename}`
 *     — exactly the shape `UiChemy_Composer_Renderer::get_media_url_from_setting()`
 *     already reads via `$setting['url']`, so no PHP-side shape translation
 *     is needed for values written through that field.
 *   - Both controls are gated by `uichemy_slot_{i}_visible`/`_is_image`
 *     checkbox controls (real native Bricks checkboxes) via Bricks' `required`
 *     condition arrays — toggling them live-reveals/hides the text vs image
 *     control the same way Elementor's `condition` arrays do.
 *   - Sync is one-directional at the DOM-event level but keeps both sides
 *     consistent: forwardSyncFromRawHtml() (below) polls `raw_html` and
 *     pushes parsed slot content INTO the native controls (skipping any
 *     field currently focused, so it never fights live typing); a delegated
 *     'input' listener pushes native-control EDITS back into `raw_html` via
 *     the same shared `window.UiChemySlots.writeSlot()` Gutenberg uses. Native
 *     media-library picks (attachment id, not a plain URL) are NOT written
 *     back into `raw_html` — they don't need to be, since
 *     UiChemy_Bricks_Composer::render() already reads
 *     `this->settings['uichemy_slot_{i}_image']` directly (Bricks' own saved
 *     element settings), independent of `raw_html`'s content. `raw_html`
 *     acts as the structural skeleton; the native slot controls are the
 *     actual content source of truth at render time.
 *
 * Everything else mirrors uichemy-composer-gutenberg-adapter.js exactly:
 * inject the shared floating-panel shell, show it, click the tab button
 * matching the requested tab. That part is the same proven mechanism
 * Elementor and Gutenberg both already use.
 */
( function () {
	'use strict';

	var PANEL_ID = 'uichemy-composer-floating-panel';
	var POLL_MS = 400;
	var ZFIX_STYLE_ID = 'uichemy-bricks-panel-zfix';

	function she() { return window.UichUiChemyComposerEditor || null; }
	function bricksBridge() { return window.UichComposerBricks || null; }

	// Bricks' own builder chrome (left settings sidebar, Structure panel, etc.)
	// uses z-index values up to 9999999 (confirmed in builder.min.css) — well
	// above the shared panel's z-index:9999 (set in uichemy-composer-editor-panel.css,
	// shared by Elementor/Gutenberg where it's never an issue since neither
	// builder's own UI stacks that high). Bricks' sidebar was rendering on top
	// of our expanded panel, cutting off its left portion. Scoped to this
	// adapter only — Elementor/Gutenberg are untouched.
	//
	// IMPORTANT: this value must stay LOWER than 2147483646 — the z-index every
	// portaled dropdown/menu in the panel uses (the class-select "+ Add class"
	// suggestions in composer-inspector.jsx, the Layers panel's own menus/hover
	// overlay in composer-layers.jsx — both render into a body-level portal via
	// ensurePortalRoot(), a SIBLING of this panel, not a descendant, so they only
	// stack above it by NUMBER, not by DOM nesting). This was previously set to
	// 2147483647 (one MORE than those dropdowns) — confirmed live: on Bricks
	// specifically, that made the panel itself render ON TOP OF its own
	// "+ Add class" dropdown and Layers menus, hiding them behind the panel
	// entirely. Leaving a wide buffer below 2147483646 so any future portaled
	// UI added at that same max-ish value still safely stacks above the panel.
	function ensureZIndexFix() {
		if ( document.getElementById( ZFIX_STYLE_ID ) ) { return; }
		var style = document.createElement( 'style' );
		style.id = ZFIX_STYLE_ID;
		style.textContent = '#' + PANEL_ID + '{z-index:2147483000 !important;}';
		document.head.appendChild( style );
	}

	function ensurePanel() {
		ensureZIndexFix();
		var UichSHE = she();
		if ( ! document.getElementById( PANEL_ID ) && UichSHE && typeof UichSHE.injectFloatingPanel === 'function' ) {
			try { UichSHE.injectFloatingPanel(); } catch ( e ) { /* ignore */ }
		}
	}

	function showPanel() {
		var panel = document.getElementById( PANEL_ID );
		if ( ! panel ) { return; }
		document.body.classList.add( 'uichemy-composer-active' );
		panel.classList.add( 'active' );
		panel.classList.remove( 'minimized' );
	}

	// Reverses showPanel(): removing 'active' lets the panel's own CSS
	// (`translateY(100%)` on the base class) slide it fully off-screen again.
	function hidePanel() {
		var panel = document.getElementById( PANEL_ID );
		if ( ! panel ) { return; }
		panel.classList.remove( 'active' );
		document.body.classList.remove( 'uichemy-composer-active' );
	}

	// The React composer app (composer-app.jsx) renders its tab bar as plain
	// `.panel-tab` buttons with visible labels ("Editor" / "Code" / "Chat AI")
	// and no `data-uichemy-composer-tab` attribute — that attribute only ever
	// existed on an older static HTML panel shell that isn't what actually
	// mounts. Matching only the data-attribute (as this file used to) meant
	// switchTab() never found anything under Bricks: it silently retried for
	// ~1.8s and gave up, leaving whatever tab (or the panel's collapsed 44px
	// header-only state) already showing — which is what made "Edit" appear
	// to not open the full panel. Mirrors uichemy-composer-gutenberg-adapter.js's
	// same fix exactly: try the data-attribute first, then fall back to the
	// real React tab button by its label.
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

	// The panel has a SEPARATE `panelCollapsed` React state (composer-app.jsx),
	// independent of which tab is active, that defaults to collapsed and is
	// only cleared as a side effect of a real tab-button click. It renders as
	// an inline `height:44px` on the outer panel while collapsed (only the
	// tab bar shows, no tab body). "Editor" is the default active tab even on
	// a fresh mount, so if switchTab() skipped clicking whenever the target
	// tab was ALREADY active, the click (and its uncollapse side effect) would
	// never fire on first open — leaving the panel stuck at its 44px header
	// strip even though the "correct" tab is technically selected.
	function isCollapsed() {
		var panel = document.getElementById( PANEL_ID );
		return ! panel || panel.style.height === '44px';
	}

	// Click the tab button, then verify shortly after that it actually became
	// active AND the panel expanded, re-clicking if not (handles both the
	// React-not-attached-yet race and the already-active-but-still-collapsed
	// case above).
	function switchTab( tab ) {
		var t = tab || 'direct';
		var attempts = 0;
		( function attempt() {
			var btn = findTabButton( t );
			if ( ! btn ) {
				if ( attempts++ < 30 ) { window.setTimeout( attempt, 60 ); }
				return;
			}
			if ( isActive( btn ) && ! isCollapsed() ) { return; }
			btn.click();
			window.setTimeout( function () {
				if ( ( ! isActive( findTabButton( t ) ) || isCollapsed() ) && attempts++ < 30 ) {
					window.setTimeout( attempt, 60 );
				}
			}, 40 );
		} )();
	}

	// VERIFIED against real Bricks 2.x: the currently-selected element is
	// `li.bricks-draggable-item.active` in the Structure panel, carrying the
	// real element id as `data-id` (e.g. `<li id="element-qbwnqc"
	// class="...element active" data-id="qbwnqc">`). That list lives in a
	// different DOM subtree than the settings panel our launcher renders in,
	// so this searches the whole document rather than an ancestor of launcherEl.
	function resolveElementId() {
		var active = document.querySelector( 'li.bricks-draggable-item.element.active[data-id]' )
			|| document.querySelector( 'li.bricks-draggable-item.active[data-id]' );
		if ( active ) {
			var id = active.getAttribute( 'data-id' );
			if ( id ) { return id; }
		}
		// Fallback: a stable per-launcher id so the panel still has SOMETHING to
		// bind to (settings will round-trip via this element's own textarea
		// regardless, since composer-bricks.jsx re-resolves the textarea by
		// scanning the open panel rather than trusting this id for the DOM
		// lookup itself).
		return 'uichemy-bricks-' + Math.random().toString( 36 ).slice( 2, 9 );
	}

	// Bricks keeps the "UiChemy Composer" control-group accordion COLLAPSED by
	// default (see this file's header comment) — the `uichemy_settings`
	// <textarea> composer-bricks.jsx reads/writes through doesn't exist in the
	// DOM at all until that group is expanded at least once. Selecting an
	// element (which the canvas button's click does, via Bricks' own
	// delegated click-to-select — confirmed live) is NOT enough by itself.
	// composer-bricks.jsx's activateBricksComposer() reads the textarea
	// EXACTLY ONCE, synchronously, at activation, to seed its in-memory
	// settings model, and memoizes on elementId — so if the group is still
	// collapsed at that moment, the model is permanently seeded to `{}` for
	// the rest of this element's session, and every later write silently
	// no-ops (findSettingsTextarea() still returns null at flush time too).
	// The sidebar's own "Edit" launcher button (buildLauncherButtons() below)
	// never hits this: it lives inside the SAME collapsed group, so it can
	// only ever be clicked once that group is already open. The canvas "Open
	// Composer" button has no such guarantee — confirmed live: clicking it
	// opened the panel and let the user type into the Code tab, but NONE of
	// it was ever actually saved (reloading the builder showed the element
	// still completely empty), because activate() had already seeded an
	// empty model before the group existed to read from.
	function ensureSettingsGroupExpanded( done, attempts ) {
		attempts = attempts || 0;
		if ( findSettingsTextarea() ) { done(); return; }
		var header = document.querySelector( 'li.control-group[data-control-group="uichemy"] .control-group-title' );
		if ( header ) {
			header.click();
			// Expanding mounts the control via Vue reactivity, not
			// synchronously — re-check on the next tick instead of assuming
			// the textarea exists immediately after the click.
			window.setTimeout( function () { ensureSettingsGroupExpanded( done, attempts + 1 ); }, 80 );
			return;
		}
		if ( attempts < 40 ) {
			window.setTimeout( function () { ensureSettingsGroupExpanded( done, attempts + 1 ); }, 80 );
			return;
		}
		// Give up after ~3.2s (element/group never appeared) and proceed
		// anyway — same as pre-fix behavior, rather than hang the panel open
		// indefinitely.
		done();
	}

	function openTab( elementId, tab ) {
		ensurePanel();
		showPanel();
		ensureSettingsGroupExpanded( function () {
			var bridge = bricksBridge();
			if ( bridge && typeof bridge.activate === 'function' ) {
				bridge.activate( elementId );
			}
			switchTab( tab );
		} );
	}

	// Exposed so the canvas "Open Composer" button (rendered server-side by
	// UiChemy_Bricks_Composer::render() for an empty element — see that
	// method's comment) can open the shared floating panel. That button lives
	// INSIDE Bricks' preview iframe (the canvas is always an iframe —
	// confirmed via ?brickspreview=true — its content is the element's own
	// render() output), while the floating panel is injected into the PARENT
	// frame's document.body. This script is loaded in BOTH contexts
	// (bricks_is_builder() is true for the iframe request too), so the
	// iframe's own copy of this file has no PANEL_ID element in ITS document
	// to open — decorateCanvasButtons() below, running in the iframe, calls
	// this function on `window.top` instead of locally.
	window.UiChemyBricksCanvasOpen = function ( elementId ) {
		openTab( elementId, 'direct' );
	};

	// Finds the canvas button (iframe-side) and wires it to the parent-frame
	// bridge above. `window.top` resolves to `window` itself when this script
	// isn't framed, so this is a harmless no-op path when accidentally run in
	// the main builder page (no such button exists there to find anyway).
	function decorateCanvasButtons() {
		document.querySelectorAll( '.uichemy-bricks-canvas-edit-btn:not([data-uichemy-decorated="1"])' ).forEach( function ( btn ) {
			btn.setAttribute( 'data-uichemy-decorated', '1' );
			btn.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				var elementId = btn.getAttribute( 'data-uichemy-element-id' ) || '';
				var open = window.top && window.top.UiChemyBricksCanvasOpen;
				if ( typeof open === 'function' ) { open( elementId ); }
			} );
		} );
	}

	// VERIFIED root cause of "raw_js never fires" / "3rd-party JS never
	// loads" inside the Bricks builder canvas (confirmed via live inspection,
	// not guessed): Bricks mounts each element's render() output into the
	// canvas iframe's DOM via a Vue-reactive HTML-injection mechanism (every
	// child node Bricks produces this way carries a `brx-child-node` class) —
	// functionally equivalent to `el.innerHTML = html`. For EXTERNAL
	// (`src="..."`) script tags, browsers never execute them when inserted
	// this way — confirmed by finding our dependency's `<script src>` tag
	// present and correct in the iframe DOM, with ZERO network requests ever
	// made for it. The standard workaround: clone the inert `<script>` into a
	// freshly created one and re-insert it — a genuinely created+appended
	// script element DOES execute.
	//
	// INLINE scripts (raw_js) are handled differently — Bricks' own mounting
	// step doesn't just leave them inert, it strips them from the DOM
	// entirely (confirmed empirically: even giving the tag a deliberately
	// non-standard `type` didn't help, it was absent either way — whatever
	// strips it matches on the `<script>` tag itself, not its attributes).
	// So `raw_js` is never emitted as a `<script>` tag in the builder at all
	// (see class-uichemy-composer-renderer.php's $obfuscate_scripts) — it's
	// hidden as text in a `data-uichemy-js` attribute on a plain, inert
	// `<div class="uichemy-deferred-js">`, which nothing strips since it
	// isn't a script. This function creates the REAL script element from
	// that text at the correct point in the sequence instead.
	//
	// Both kinds must revive SEQUENTIALLY, not via a simple forEach:
	// `async=false` on a dynamically-created script only orders it relative
	// to OTHER dynamically-created `async=false` scripts — raw_js firing
	// immediately after a still-loading external dependency would defeat the
	// entire point of "before"-position deps (raw_js assumes they're already
	// loaded), so each step here waits for the previous external script's
	// 'load' (or 'error', so one bad CDN URL can't wedge the chain forever)
	// before reviving the next.
	// Per-canvas-window registry of external dependency URLs already executed.
	// Mirrors `__ucComposerDeps` in assets/js/uichemy-composer-editor.js — the
	// Elementor live preview dedupes deps by URL for exactly this reason.
	// Bricks re-renders the WHOLE element output on every settings change, so
	// each render hands us a fresh, unmarked set of dep `<script src>` tags
	// that would otherwise be re-created (and re-executed) once per render. A
	// slider/scroll/animation library booting a second, third, tenth time in
	// the same canvas window is what wedges the builder.
	function depsRegistry() {
		return window.__ucComposerDeps || ( window.__ucComposerDeps = {} );
	}

	// The stable per-element scope class UiChemy_Composer_Renderer puts on the
	// element root (`uichemy-composer-<uid>`). Used as the teardown-registry key
	// so two UiChemy elements on the same page never tear down each other's
	// timers, and as the "is my markup mounted yet" probe inside the harness.
	function rootScopeSelector( root ) {
		var m = /(?:^|\s)(uichemy-composer-[A-Za-z0-9_-]+)/.exec( root.getAttribute( 'class' ) || '' );
		return m ? '.' + m[ 1 ] : '';
	}

	// Wrap raw_js in the SAME teardown harness the Elementor editor path uses
	// (buildUiChemyComposerEditorJsRuntimeScript() in
	// assets/js/uichemy-composer-editor.js, with a PHP twin in
	// includes/admin/widgets/class-uichemy-composer-widget.php), so all builders
	// share one registry (`window.__ucComposerEditorJS`) and one contract:
	//
	//   • Before re-running a widget's JS, clear the PREVIOUS run's intervals /
	//     timeouts / rAFs and remove the window+document listeners it added.
	//     This is the fix for "the Bricks editor gets stuck / stops scrolling
	//     once a UiChemy element has content": Bricks re-renders the element on
	//     every settings change (each Code-tab keystroke flushes
	//     uichemy_settings ~150ms later — see makeSettingsModel() in
	//     composer/src/composer-bricks.jsx), and reviveInertScripts() faithfully
	//     re-executed raw_js on every one of those renders with no teardown. So
	//     each edit stacked ANOTHER live copy of the content's JS onto the
	//     canvas window. Content that touches scrolling — GSAP/ScrollTrigger,
	//     smooth-scroll libraries, sticky-header handlers, wheel/scroll/resize
	//     listeners, IntersectionObservers — then ran N times per scroll event
	//     and fought itself, so the canvas stopped scrolling and the whole
	//     builder felt frozen. An EMPTY element never hit this (render() returns
	//     the placeholder before it sets the `.uichemy-composer-<uid>` root
	//     class, so there is no wrapper to scan and no script to revive), which
	//     is exactly why the symptom only appears after content is added.
	//
	//   • `load` / `DOMContentLoaded` registrations are FIRED immediately rather
	//     than registered. The canvas iframe finished loading long before this
	//     script is revived, so those events can never fire again — raw_js that
	//     wraps itself in `DOMContentLoaded` (very common) previously never ran
	//     at all inside the Bricks canvas.
	function buildTeardownWrappedJs( wid, scopeSel, body ) {
		var WID   = JSON.stringify( wid );
		var SCOPE = JSON.stringify( scopeSel || '' );
		var BODY  = JSON.stringify( String( body || '' ) );
		return '(function(){'
			+ 'var WID=' + WID + ',SCOPE=' + SCOPE + ',BODY=' + BODY + ';'
			+ 'var G=(window.__ucComposerEditorJS=window.__ucComposerEditorJS||{});'
			+ 'var prev=G[WID];'
			+ 'if(prev){'
			+ 'prev.intervals.forEach(function(i){clearInterval(i);});'
			+ 'prev.timeouts.forEach(function(i){clearTimeout(i);});'
			+ 'prev.rafs.forEach(function(i){cancelAnimationFrame(i);});'
			+ 'prev.listeners.forEach(function(l){try{l.t.removeEventListener(l.e,l.h,l.o);}catch(e){}});'
			+ '}'
			+ 'var R=G[WID]={intervals:[],timeouts:[],rafs:[],listeners:[]};'
			+ 'var tries=0;'
			+ 'function fire(target,type,h){try{h.call(target,new Event(type));}catch(e){console.error("[Composer editor JS]",e);}}'
			+ 'function run(){'
			+ 'var root=SCOPE?document.querySelector(SCOPE):document.body;'
			+ 'if(!root){if(tries++<20){window.setTimeout(run,50);}return;}'
			+ 'var oSI=window.setInterval,oST=window.setTimeout,oRAF=window.requestAnimationFrame,owA=window.addEventListener,odA=document.addEventListener;'
			+ 'window.setInterval=function(f,t){var i=oSI(f,t);R.intervals.push(i);return i;};'
			+ 'window.setTimeout=function(f,t){var i=oST(f,t);R.timeouts.push(i);return i;};'
			+ 'window.requestAnimationFrame=function(f){var i=oRAF(f);R.rafs.push(i);return i;};'
			+ 'window.addEventListener=function(type,h,o){if(type==="load"||type==="DOMContentLoaded"){fire(window,type,h);return;}owA.call(window,type,h,o);R.listeners.push({t:window,e:type,h:h,o:o});};'
			+ 'document.addEventListener=function(type,h,o){if(type==="DOMContentLoaded"||type==="load"||type==="readystatechange"){fire(document,type,h);return;}odA.call(document,type,h,o);R.listeners.push({t:document,e:type,h:h,o:o});};'
			+ 'try{(new Function(BODY))();}'
			+ 'catch(e){console.error("[Composer editor JS]",e);}'
			+ 'finally{window.setInterval=oSI;window.setTimeout=oST;window.requestAnimationFrame=oRAF;window.addEventListener=owA;document.addEventListener=odA;}'
			+ '}'
			+ 'window.setTimeout(run,0);'
			+ '})();';
	}

	function reviveInertScripts( root ) {
		if ( root.getAttribute( 'data-uichemy-reviving' ) === '1' ) { return; }
		var nodes = Array.prototype.slice.call( root.querySelectorAll(
			'script:not([data-uichemy-revived="1"]), .uichemy-deferred-js[data-uichemy-js]:not([data-uichemy-js-revived="1"])'
		) );
		if ( ! nodes.length ) { return; }
		root.setAttribute( 'data-uichemy-reviving', '1' );

		var scopeSel = rootScopeSelector( root );
		var wid      = 'w' + ( scopeSel ? scopeSel.slice( 1 ).replace( 'uichemy-composer-', '' ) : 'bricks' );

		function reviveNext( index ) {
			if ( index >= nodes.length ) {
				root.removeAttribute( 'data-uichemy-reviving' );
				return;
			}
			var oldNode = nodes[ index ];

			if ( oldNode.classList && oldNode.classList.contains( 'uichemy-deferred-js' ) ) {
				var jsSource = oldNode.getAttribute( 'data-uichemy-js' ) || '';
				oldNode.setAttribute( 'data-uichemy-js-revived', '1' );
				var jsScript = document.createElement( 'script' );
				// MUST carry the revived marker: without it the very next 400ms
				// watch() tick matched this freshly-created inline script via
				// `script:not([data-uichemy-revived="1"])`, cloned it and ran
				// raw_js a SECOND time within half a second of the first —
				// doubling the accumulation the teardown harness above exists
				// to prevent.
				jsScript.setAttribute( 'data-uichemy-revived', '1' );
				jsScript.textContent = buildTeardownWrappedJs( wid, scopeSel, jsSource );
				oldNode.parentNode.insertBefore( jsScript, oldNode.nextSibling );
				reviveNext( index + 1 );
				return;
			}

			var oldScript = oldNode;

			// External deps: execute once per canvas window, not once per
			// Bricks re-render (see depsRegistry()). The old tag is inert —
			// Bricks never executed it — so marking it and moving on is enough.
			if ( oldScript.src ) {
				var reg = depsRegistry();
				if ( reg[ oldScript.src ] ) {
					oldScript.setAttribute( 'data-uichemy-revived', '1' );
					reviveNext( index + 1 );
					return;
				}
				reg[ oldScript.src ] = true;
			}

			var newScript = document.createElement( 'script' );
			for ( var i = 0; i < oldScript.attributes.length; i++ ) {
				var attr = oldScript.attributes[ i ];
				newScript.setAttribute( attr.name, attr.value );
			}
			newScript.setAttribute( 'data-uichemy-revived', '1' );
			newScript.textContent = oldScript.textContent;

			if ( newScript.src ) {
				newScript.addEventListener( 'load', function () { reviveNext( index + 1 ); } );
				newScript.addEventListener( 'error', function () { reviveNext( index + 1 ); } );
				oldScript.parentNode.replaceChild( newScript, oldScript );
			} else {
				oldScript.parentNode.replaceChild( newScript, oldScript );
				reviveNext( index + 1 );
			}
		}

		reviveNext( 0 );
	}

	// Poll for any UiChemy Composer element(s) rendered into the canvas
	// iframe and revive their inert scripts. Scoped to `.uichemy-composer-*`
	// wrappers specifically (not the whole document) so this never touches
	// Bricks' own native elements or chrome. Harmless no-op when this script
	// happens to run in the parent frame too, since no such wrapper exists
	// there (the wrapper is server-rendered element output, iframe-only).
	function reviveCanvasScripts() {
		document.querySelectorAll( '[class*="uichemy-composer-"]' ).forEach( function ( el ) {
			// The substring match ALSO catches non-wrapper classes: the
			// `uichemy-composer-active` state class showPanel() adds to <body>, and
			// the panel shell. Running reviveInertScripts() against <body> re-executes
			// EVERY script in the Bricks builder's top document, double-booting Bricks
			// and blanking the canvas (only the floating panel, a separate root,
			// survives). Genuine server-rendered element output carries a
			// `uichemy-composer-<uid>` scope class — revive only those.
			if ( el === document.body || el === document.documentElement ) return;
			if ( el.classList.contains( 'uichemy-composer-active' ) ) return;
			if ( el.classList.contains( 'uichemy-composer-floating-panel' ) ) return;
			reviveInertScripts( el );
		} );
	}

	// Injects a single "Edit" launcher button into our element's
	// `.uichemy-bricks-launcher` div once Bricks renders it (i.e. once the user
	// selects a UiChemy Composer element, expands its "UiChemy Composer" control
	// group, and the group's controls mount). It opens the shared panel on the
	// Editor tab — the same starting point Elementor/Gutenberg land on — from
	// which the user reaches Code/Chat via the panel's own tab bar. The
	// element id is resolved fresh on click (not cached at decoration time)
	// since the panel can stay mounted across a selection change.
	function buildLauncherButtons() {
		var wrap = document.createElement( 'div' );
		wrap.className = 'uichemy-bricks-launcher-buttons';
		wrap.style.display = 'flex';
		wrap.style.gap = '6px';

		var btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.textContent = 'Edit';
		btn.className = 'uichemy-bricks-launcher-btn';
		btn.style.cssText = 'flex:1 1 auto;padding:6px 10px;border:1px solid #dcdcde;'
			+ 'border-radius:6px;background:#fff;color:#1e1e1e;font-size:12px;cursor:pointer;';
		btn.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			openTab( resolveElementId(), 'direct' );
		} );
		wrap.appendChild( btn );

		return wrap;
	}

	function decorateLauncher( launcherEl ) {
		if ( launcherEl.getAttribute( 'data-uichemy-decorated' ) === '1' ) { return; }
		launcherEl.setAttribute( 'data-uichemy-decorated', '1' );

		launcherEl.textContent = '';
		launcherEl.appendChild( buildLauncherButtons() );
	}

	// --- Per-slot "Text N / Image N" fields (the Bricks equivalent of the ---
	// --- Gutenberg block's sidebar "Content" panel) --------------------------
	// VERIFIED selector — see this file's header comment: the settings control
	// is wrapped in `[data-controlkey="uichemy_settings"]`, has no `name`
	// attribute, and only one Bricks element panel is ever open at a time so no
	// per-element scoping is needed.
	function findSettingsTextarea() {
		return document.querySelector( '[data-controlkey="uichemy_settings"] textarea' );
	}

	// The shared React panel (composer-app.jsx) keeps showing whatever HTML/CSS/JS
	// was last loaded until something explicitly clears its "active widget" store
	// (`clearActiveComposerWidget()`) — Elementor does this itself via panel-close
	// hooks (`HIDE_HOOKS` in composer-elementor.jsx), but Bricks has no equivalent
	// hook API, and this adapter never called `window.UichComposerBricks.deactivate()`
	// anywhere — so deselecting/deleting the active UiChemy element, or navigating
	// to a page with none at all, left the Code tab frozen on stale content from
	// whichever element was last opened. Bricks only ever renders the
	// `uichemy_settings` control when a UiChemy Composer element is selected AND
	// its group is expanded, so "that control just disappeared" is a reliable
	// signal the previously-active element is no longer selected.
	//
	// Also hides the panel entirely (not just clearing its content) — once
	// there's no UiChemy element left to edit, leaving an empty panel open on
	// screen is just clutter with nothing useful to show.
	// NOTE: earlier version checked `findSettingsTextarea()` instead of the
	// Structure panel — WRONG, since that control only exists while the
	// sidebar's "UiChemy Composer" accordion group happens to be expanded, an
	// entirely separate UI state from "does this element still exist". The
	// canvas "Open Composer" button opens the floating panel directly
	// (openTab → bridge.activate()) WITHOUT expanding that sidebar group, so
	// the very next poll tick saw a non-null active id with no settings
	// control mounted and concluded the element was gone — closing the panel
	// that had just been opened. Checking the Structure panel's own draggable
	// item list for the active element's id is the correct, independent
	// signal: it reflects every element on the page regardless of which
	// sidebar accordion (if any) is currently expanded.
	function deactivateIfElementGone() {
		var bridge = bricksBridge();
		if ( ! bridge || typeof bridge.getActiveClientId !== 'function' ) { return; }
		var activeId = bridge.getActiveClientId();
		if ( ! activeId ) { return; }
		if ( document.querySelector( 'li.bricks-draggable-item[data-id="' + activeId + '"]' ) ) { return; }
		if ( typeof bridge.deactivate === 'function' ) { bridge.deactivate(); }
		hidePanel();
	}

	function readSettings() {
		var ta = findSettingsTextarea();
		if ( ! ta ) { return null; }
		try {
			var parsed = JSON.parse( ta.value || '{}' );
			return ( parsed && typeof parsed === 'object' ) ? parsed : {};
		} catch ( e ) {
			return {};
		}
	}

	// Native setter bypass + dispatched events so Bricks' own Vue binding on
	// the textarea picks up the change and persists it — same technique as
	// composer-bricks.jsx's writeElementSettings().
	function writeSettings( next ) {
		var ta = findSettingsTextarea();
		if ( ! ta ) { return false; }
		var setter = Object.getOwnPropertyDescriptor( window.HTMLTextAreaElement.prototype, 'value' ).set;
		setter.call( ta, JSON.stringify( next ) );
		ta.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		ta.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		return true;
	}

	var SLOT_COUNT = 20;

	// Flag checkboxes (`_visible`/`_is_image`) are real Bricks controls (Bricks
	// has no true "hidden" type) but are pure bookkeeping — hide their rows so
	// only the actual Text N / Image N fields show in the panel. `uichemy_settings`
	// is the raw JSON blob (raw_html/raw_css/raw_js/slots) — also a real,
	// necessary Bricks control (it's the only place this element can persist
	// that data), but showing its raw JSON textarea in the sidebar is pure
	// internal plumbing with no reason for a user to look at or edit directly
	// (the floating panel's Code tab is the intended editing surface for that
	// data). Hiding via CSS only, same as the flags above — findSettingsTextarea()/
	// composer-bricks.jsx's own lookup are plain DOM queries with no visibility
	// check, so this doesn't affect read/write functionality at all.
	var FLAG_HIDE_STYLE_ID = 'uichemy-bricks-flag-hide';
	function ensureFlagHiddenStyle() {
		if ( document.getElementById( FLAG_HIDE_STYLE_ID ) ) { return; }
		var style = document.createElement( 'style' );
		style.id = FLAG_HIDE_STYLE_ID;
		style.textContent = '[data-controlkey^="uichemy_slot_"][data-controlkey$="_visible"],'
			+ '[data-controlkey^="uichemy_slot_"][data-controlkey$="_is_image"],'
			+ '[data-controlkey="uichemy_settings"]{display:none !important;}';
		document.head.appendChild( style );
	}

	function getSlotControlWrap( index, key ) {
		return document.querySelector( '[data-controlkey="uichemy_slot_' + index + '_' + key + '"]' );
	}

	function getCheckboxInput( index, key ) {
		var wrap = getSlotControlWrap( index, key );
		return wrap ? wrap.querySelector( 'input[type="checkbox"]' ) : null;
	}

	function getTextInputEl( index ) {
		var wrap = getSlotControlWrap( index, 'text' );
		return wrap ? wrap.querySelector( 'input[type="text"]' ) : null;
	}

	// The image control renders both a media-library trigger AND a "Custom URL"
	// text field (`.external-url`) — see this file's header comment. Only the
	// latter is a plain native input we can sync raw_html against.
	function getImageUrlInputEl( index ) {
		var wrap = getSlotControlWrap( index, 'image' );
		if ( ! wrap ) { return null; }
		var extWrap = wrap.querySelector( '.external-url' );
		return extWrap ? extWrap.querySelector( 'input[type="text"]' ) : null;
	}

	function setCheckboxValue( el, value ) {
		if ( ! el || el.checked === value ) { return; }
		el.checked = value;
		el.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	}

	// Native setter bypass + dispatched 'input' event, same technique as
	// writeSettings() above, so Bricks' own Vue binding on the control's
	// underlying <input> picks up the programmatic change.
	function setTextValue( el, value ) {
		if ( ! el || el.value === value ) { return; }
		var setter = Object.getOwnPropertyDescriptor( window.HTMLInputElement.prototype, 'value' ).set;
		setter.call( el, value );
		el.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	}

	// Pushes parsed raw_html content INTO the native per-slot controls. Skips
	// any field the user currently has focused so a poll tick never overwrites
	// live typing (the field's own edit will itself update raw_html a moment
	// later via the reverse-sync listener below, converging naturally).
	//
	// Deliberately does NOT cache/skip based on "raw_html unchanged since last
	// run": checking a visible/is_image flag reveals its paired text/image
	// control on Bricks' NEXT Vue tick, not synchronously, so the control may
	// not exist in the DOM yet within the same pass that just toggled its
	// flag. Re-running every poll tick lets that reveal catch up on the next
	// pass; each individual field write already no-ops when the value already
	// matches (setCheckboxValue/setTextValue), so this stays cheap.
	// Per-slot cache of the last raw_html-derived image src pushed into the
	// native control. Image picks made via Bricks' own media-library button
	// (as opposed to typing in the "Custom URL" field) update the control's
	// internal Vue value directly — Bricks itself, not our reverse-sync
	// listener — so raw_html never learns about them (by design, see this
	// file's header comment: native settings are the source of truth for
	// images, raw_html is only the initial skeleton). Without this cache,
	// polling would keep re-pushing raw_html's stale placeholder `src` on
	// every tick and stomp the user's just-made pick back to empty. Re-sync
	// only fires when the raw_html-derived value itself actually changes
	// (e.g. the user edits the Code tab again), never merely because the
	// native control's own value has since diverged.
	var lastForwardedImageSrc = {};

	// Same problem, same fix, for TEXT fields: Bricks' own native "dynamic
	// data" flash-icon picker (attached to every text control automatically)
	// writes the picked `{tag}` token into the control's value via its own
	// Vue reactivity — no native DOM 'input' event fires, so our reverse-sync
	// listener never sees it and raw_html never learns about it. Without this
	// cache, the very next poll tick's forwardSync would see the field's
	// value has "changed" relative to raw_html's still-static text and
	// immediately stomp the just-picked dynamic tag back to the old value —
	// exactly what made dynamic picks appear to vanish right after selecting
	// them. Same rule as images: only re-push when the raw_html-derived value
	// itself changes, never merely because the control's own value diverged.
	var lastForwardedText = {};

	function forwardSyncFromRawHtml() {
		var settings = readSettings();
		if ( ! settings ) { return; }
		var rawHtml = settings.raw_html || '';
		// Controls only exist once the user has selected a UiChemy Composer
		// element and expanded its "UiChemy Composer" control group.
		if ( ! getSlotControlWrap( 0, 'visible' ) ) { return; }

		var slots = window.UiChemySlots.readSlots( rawHtml );
		for ( var i = 0; i < SLOT_COUNT; i++ ) {
			var visibleCb = getCheckboxInput( i, 'visible' );
			if ( ! visibleCb ) { continue; }
			var slot = slots[ i ];
			if ( ! slot ) {
				setCheckboxValue( visibleCb, false );
				continue;
			}
			setCheckboxValue( visibleCb, true );
			var imageCb = getCheckboxInput( i, 'is_image' );
			if ( slot.kind === 'image' ) {
				setCheckboxValue( imageCb, true );
				var srcFromHtml = slot.src || '';
				if ( lastForwardedImageSrc[ i ] !== srcFromHtml ) {
					lastForwardedImageSrc[ i ] = srcFromHtml;
					var urlInput = getImageUrlInputEl( i );
					if ( urlInput && document.activeElement !== urlInput ) {
						setTextValue( urlInput, srcFromHtml );
					}
				}
			} else {
				setCheckboxValue( imageCb, false );
				var textFromHtml = slot.text || '';
				if ( lastForwardedText[ i ] !== textFromHtml ) {
					lastForwardedText[ i ] = textFromHtml;
					var textInput = getTextInputEl( i );
					if ( textInput && document.activeElement !== textInput ) {
						setTextValue( textInput, textFromHtml );
					}
				}
			}
		}
	}

	var reverseSyncTimers = {};

	function applyReverseSlotEdit( index, patch ) {
		var settings = readSettings();
		if ( ! settings ) { return; }
		var rawHtml = settings.raw_html || '';
		var nextHtml = window.UiChemySlots.writeSlot( rawHtml, index, patch );
		if ( nextHtml === rawHtml ) { return; }
		settings.raw_html = nextHtml;
		writeSettings( settings );
	}

	function scheduleReverseSlotEdit( index, patch ) {
		var key = index + ':' + Object.keys( patch )[ 0 ];
		if ( reverseSyncTimers[ key ] ) { window.clearTimeout( reverseSyncTimers[ key ] ); }
		reverseSyncTimers[ key ] = window.setTimeout( function () {
			applyReverseSlotEdit( index, patch );
		}, 350 );
	}

	// Delegated listener (capture phase, attached once) rather than per-field
	// binding, since Bricks mounts/unmounts these controls dynamically as
	// groups expand/collapse or the selected element changes.
	function attachReverseSyncListeners() {
		document.addEventListener( 'input', function ( e ) {
			var target = e.target;
			if ( ! target || target.tagName !== 'INPUT' || target.type === 'checkbox' ) { return; }
			var wrap = target.closest( '[data-controlkey^="uichemy_slot_"]' );
			if ( ! wrap ) { return; }
			var key = wrap.getAttribute( 'data-controlkey' ) || '';
			var m = /^uichemy_slot_(\d+)_(text|image)$/.exec( key );
			if ( ! m ) { return; }
			var index = parseInt( m[ 1 ], 10 );
			var kind = m[ 2 ];
			if ( kind === 'image' && ! target.closest( '.external-url' ) ) { return; }
			scheduleReverseSlotEdit( index, kind === 'text' ? { text: target.value } : { src: target.value } );
		}, true );
	}

	// Poll for the launcher (rendered by our info control) and for the native
	// slot controls, rather than relying on a specific Bricks JS event, since
	// no Bricks-fired "element settings panel opened" event name has been
	// verified.
	function watch() {
		ensureFlagHiddenStyle();
		document.querySelectorAll( '.uichemy-bricks-launcher:not([data-uichemy-decorated="1"])' ).forEach( decorateLauncher );
		decorateCanvasButtons();
		reviveCanvasScripts();
		forwardSyncFromRawHtml();
		deactivateIfElementGone();
		window.setTimeout( watch, POLL_MS );
	}

	attachReverseSyncListeners();

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', watch );
	} else {
		watch();
	}
} )();
