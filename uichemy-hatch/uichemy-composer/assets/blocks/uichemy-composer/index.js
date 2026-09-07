/**
 * Composer — Gutenberg block (editor side).
 *
 * Plain JS (no build step), consistent with the floating-panel editor scripts.
 * The block is dynamic: `save` returns null and PHP renders it through the shared
 * UiChemy_Composer_Renderer. Editing happens in the reused floating panel, driven
 * by the React composer bridge (window.UichComposerGutenberg) and the panel shell
 * exposed on window.UichUiChemyComposerEditor.
 *
 * Dynamic data uses uichemy's Twig engine: bindings are `{{ }}` tokens authored
 * through the panel's "+ Dynamic" builder (UichDD) and resolved server-side by
 * Uich_Dynamic at render. The editor preview resolves them via the
 * `uichemy/v1/atom-preview` REST endpoint.
 */
( function ( wp ) {
	'use strict';

	if ( ! wp || ! wp.blocks || ! wp.element || ! window.UiChemySlots ) {
		return;
	}

	var el = wp.element.createElement;
	var Fragment = wp.element.Fragment;
	var useEffect = wp.element.useEffect;
	var useRef = wp.element.useRef;
	var useState = wp.element.useState;
	var useMemo = wp.element.useMemo;
	var registerBlockType = wp.blocks.registerBlockType;
	var useBlockProps = wp.blockEditor.useBlockProps;
	var BlockControls = wp.blockEditor.BlockControls;
	var InspectorControls = wp.blockEditor.InspectorControls;
	var MediaUpload = wp.blockEditor.MediaUpload;
	var MediaUploadCheck = wp.blockEditor.MediaUploadCheck;
	var ToolbarGroup = wp.components.ToolbarGroup;
	var ToolbarButton = wp.components.ToolbarButton;
	var PanelBody = wp.components.PanelBody;
	var Button = wp.components.Button;
	var BaseControl = wp.components.BaseControl;
	var ToggleControl = wp.components.ToggleControl;
	var Placeholder = wp.components.Placeholder;
	var __ = wp.i18n.__;

	// Vanilla floating-panel helper (injects + shows the panel shell that the
	// React composer app mounts into).
	var UICH = function () { return window.UichUiChemyComposerEditor; };
	// React composer bridge (feeds the active block into the composer store).
	var GB = function () { return window.UichComposerGutenberg; };

	/**
	 * Reveal the composer when a Composer block is selected.
	 *
	 * The composer renders through InspectorControls, so it only exists on screen
	 * while the settings sidebar is OPEN and showing the Block tab. Selecting the
	 * block with the sidebar closed (or parked on Page) therefore showed nothing
	 * at all — the editing surface was there but unreachable. This opens the
	 * sidebar straight onto the Block tab so clicking the block lands you in the
	 * composer (which opens on its Chat tab by default).
	 *
	 * In WordPress the sidebar's active TAB *is* the complementary-area
	 * identifier — `edit-post/document` for Page, `edit-post/block` for Block — so
	 * enabling that area both opens the sidebar and selects the right tab in one
	 * call. Two API generations, newest first; each is optional, so a missing
	 * store must never break block selection. We stop at the first one that works
	 * rather than calling both, so we can't enable an area in two different
	 * scopes.
	 *
	 * Only fires on the selection CHANGE (see the effect's deps) — so if you
	 * deliberately close the sidebar while the block stays selected, it stays
	 * closed instead of fighting you.
	 */
	function openBlockSidebar() {
		var data = window.wp && window.wp.data;
		if ( ! data || typeof data.dispatch !== 'function' ) {
			return;
		}
		try {
			var iface = data.dispatch( 'core/interface' );
			if ( iface && typeof iface.enableComplementaryArea === 'function' ) {
				iface.enableComplementaryArea( 'core', 'edit-post/block' );
				return;
			}
		} catch ( e ) { /* store not registered in this WP version */ }
		try {
			var editPost = data.dispatch( 'core/edit-post' );
			if ( editPost && typeof editPost.openGeneralSidebar === 'function' ) {
				editPost.openGeneralSidebar( 'edit-post/block' );
			}
		} catch ( e ) { /* ignore */ }
	}

	/** Generate a stable 7-char id for CSS scoping. */
	function makeUid() {
		var s = '';
		var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		for ( var i = 0; i < 7; i++ ) {
			s += chars.charAt( Math.floor( Math.random() * chars.length ) );
		}
		return s;
	}

	// --- Slot extraction (mirrors the PHP/JS get_text_nodes walk) -------------
	// Shared with the Bricks sidebar UI — see assets/js/uichemy-composer-slots.js
	// (enqueued as a dependency of this script) so both builders parse/write
	// raw_html slots identically instead of maintaining separate copies.
	var readSlots = window.UiChemySlots.readSlots;
	var writeSlot = window.UiChemySlots.writeSlot;

	// Database-cylinder glyph (the conventional "dynamic data" icon, matching
	// Elementor's own dynamic-tag icon) — used on the per-field "Dynamic value" button.
	// fill is set via inline `style` (not the SVG attribute) because WP admin's own
	// button/icon CSS (`.components-button svg { fill: currentColor }`) has higher
	// specificity than a bare `fill="none"` presentation attribute and would
	// otherwise solid-fill the shape instead of leaving it as an outline.
	var DYNAMIC_ICON_SHAPE_STYLE = { fill: 'none', stroke: 'currentColor' };
	var DYNAMIC_ICON = el( 'svg', {
		width: 14, height: 14, viewBox: '0 0 24 24',
		style: { fill: 'none', stroke: 'currentColor' },
		strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round'
	},
		el( 'ellipse', { cx: 12, cy: 5, rx: 8, ry: 3, style: DYNAMIC_ICON_SHAPE_STYLE } ),
		el( 'path', { d: 'M4 5v14a8 3 0 0 0 16 0V5', style: DYNAMIC_ICON_SHAPE_STYLE } ),
		el( 'path', { d: 'M4 12a8 3 0 0 0 16 0', style: DYNAMIC_ICON_SHAPE_STYLE } )
	);

	// True when the field's whole value is already one or more {{ }} bindings and
	// nothing else (no surrounding static text). Picking a new dynamic value on such
	// a field should REPLACE the existing binding, not insert alongside it — otherwise
	// re-picking a field (e.g. swapping Date for Date|time_ago) leaves both tokens
	// concatenated together as duplicate dynamic data.
	function isFullyDynamicValue( str ) {
		var t = ( str || '' ).trim();
		if ( ! t ) {
			return false;
		}
		return /^(?:\{\{[^{}]*\}\}\s*)+$/.test( t );
	}

	// Opens the SAME "+Dynamic" → "Dynamic value" picker used in the Code tab
	// (window.UichDD.ui.openValue, shared verbatim with the Elementor editor). Unlike
	// the Code tab's HTML/CSS/JS editors — where a token is inserted at the caret
	// alongside surrounding markup — each sidebar slot is a single bound value, so
	// picking a dynamic value here always REPLACES the field's whole content
	// (static text or an existing binding), never concatenates onto it.
	function openDynamicValuePicker( getValue, setValueAndCommit ) {
		var dd = window.UichDD;
		if ( ! dd || ! dd.ui || typeof dd.ui.openValue !== 'function' ) {
			return;
		}
		var existing = getValue();
		dd.ui.openValue( {
			context: [ 'post', 'site', 'user', 'request' ],
			// If this field is already one dynamic binding, the picker opens with that
			// field/filters pre-selected and highlighted instead of an empty list.
			currentValue: isFullyDynamicValue( existing ) ? existing.trim() : '',
			onInsert: function ( token ) {
				setValueAndCommit( token, token.length );
			}
		} );
	}

	// Debounced text field: keeps a local value for smooth typing and commits the
	// raw_html rewrite on a short delay so the preview/iframe doesn't thrash.
	function SlotTextField( props ) {
		var slot = props.slot;
		var commit = props.commit;
		var idx = slot.index;

		var vState = useState( slot.text );
		var value = vState[ 0 ];
		var setValue = vState[ 1 ];
		var timer = useRef( null );
		var lastExternal = useRef( slot.text );
		var inputRef = useRef( null );

		// Re-seed when the underlying value changes elsewhere (panel/AI edits).
		useEffect( function () {
			if ( slot.text !== lastExternal.current ) {
				lastExternal.current = slot.text;
				setValue( slot.text );
			}
		}, [ slot.text ] );

		function onChange( next ) {
			setValue( next );
			if ( timer.current ) {
				window.clearTimeout( timer.current );
			}
			timer.current = window.setTimeout( function () {
				lastExternal.current = next;
				commit( idx, { text: next } );
			}, 350 );
		}

		// Replaces the field's whole value with a picked dynamic token (see
		// openDynamicValuePicker) and moves the caret to the end of the new value.
		function replaceWithDynamicToken( next, caretPos ) {
			if ( timer.current ) {
				window.clearTimeout( timer.current );
				timer.current = null;
			}
			lastExternal.current = next;
			setValue( next );
			commit( idx, { text: next } );
			window.setTimeout( function () {
				var node = inputRef.current;
				if ( node && typeof node.focus === 'function' ) {
					node.focus();
					if ( typeof node.setSelectionRange === 'function' ) {
						node.setSelectionRange( caretPos, caretPos );
					}
				}
			}, 0 );
		}

		var labelTxt = __( 'Text', 'uichemy' ) + ' ' + ( props.label || ( idx + 1 ) );
		// A plain native <input>/<textarea> instead of TextControl/TextareaControl —
		// those WP components apply `className` to their OUTER wrapper div, not the
		// actual field, which made CSS targeting the input directly impossible and
		// produced a nested double-border look. The native element takes the class
		// straight, and the extra .uichemy-slot-input-wrap div still gives CSS a
		// stable hook independent of the field's tag.
		var Tag = ( value && value.length > 40 ) ? 'textarea' : 'input';
		var fieldProps = {
			ref: inputRef,
			value: value,
			onChange: function ( e ) { onChange( e.target.value ); },
			className: 'uichemy-slot-field-input'
		};
		if ( 'input' === Tag ) {
			fieldProps.type = 'text';
		} else {
			fieldProps.rows = 3;
		}
		return el( BaseControl, { key: 'txt', label: labelTxt, __nextHasNoMarginBottom: true },
			el( 'div', { className: 'uichemy-slot-row' },
				// Dedicated wrapper around just the input, independent of whichever
				// element renders it — gives CSS a stable target regardless of tag.
				el( 'div', { className: 'uichemy-slot-input-wrap' },
					el( Tag, fieldProps )
				),
				el( Button, {
					icon: DYNAMIC_ICON,
					label: __( 'Insert dynamic value', 'uichemy' ),
					showTooltip: true,
					className: 'uichemy-slot-dynamic-btn',
					onClick: function () {
						openDynamicValuePicker(
							function () { return value; },
							replaceWithDynamicToken
						);
					}
				} )
			)
		);
	}

	function SlotImageField( props ) {
		var slot = props.slot;
		var commit = props.commit;
		var idx = slot.index;
		var isDynamic = isFullyDynamicValue( slot.src );

		var control = el( MediaUploadCheck, null,
			el( MediaUpload, {
				allowedTypes: [ 'image' ],
				onSelect: function ( media ) {
					commit( idx, { src: media && media.url ? media.url : '', alt: media && media.alt ? media.alt : '' } );
				},
				render: function ( o ) {
					return el( Button, { variant: 'secondary', onClick: o.open },
						slot.src ? __( 'Replace', 'uichemy' ) : __( 'Select image', 'uichemy' ) );
				}
			} )
		);

		// A dynamic src (e.g. {{ post.featured_image }}) isn't a real URL, so show a
		// placeholder swatch instead of a broken <img>, and surface the raw token as
		// its title so it's still inspectable at a glance.
		var thumb = null;
		if ( isDynamic ) {
			thumb = el( 'div', {
				className: 'uichemy-slot-image-thumb uichemy-slot-image-thumb--dynamic',
				title: slot.src
			}, DYNAMIC_ICON );
		} else if ( slot.src ) {
			thumb = el( 'img', { className: 'uichemy-slot-image-thumb', src: slot.src, alt: '' } );
		}

		return el(
			BaseControl,
			{ label: __( 'Image', 'uichemy' ) + ' ' + ( props.label || ( idx + 1 ) ), __nextHasNoMarginBottom: true },
			el( 'div', { className: 'uichemy-slot-row' },
				el( 'div', { className: 'uichemy-slot-input-wrap uichemy-slot-image-controls' },
					thumb,
					control
				),
				el( Button, {
					icon: DYNAMIC_ICON,
					label: __( 'Insert dynamic value', 'uichemy' ),
					showTooltip: true,
					className: 'uichemy-slot-dynamic-btn',
					onClick: function () {
						openDynamicValuePicker(
							function () { return slot.src || ''; },
							function ( next ) { commit( idx, { src: next, alt: '' } ); }
						);
					}
				} )
			)
		);
	}

	// Lists detected text/image slots as native side-panel controls (static edits).
	// Dynamic data is bound via the panel's "+ Dynamic" builder (UichDD) which writes
	// {{ }} Twig tokens into the HTML; those resolve server-side at render.
	//
	// CURRENTLY UNRENDERED. The composer panel now lives in the Block tab and owns
	// slot editing through its own Content section, so this duplicated it. Kept
	// rather than deleted because it is the only path that offers the WordPress
	// MEDIA LIBRARY (MediaUpload) for image slots — if that turns out to be needed,
	// re-render it from the inspector instead of rebuilding it. Delete this and its
	// field components (SlotTextField / SlotImageField) once that's settled.
	function SlotsPanel( props ) {
		var settings = props.settings || {};
		var setAttributes = props.setAttributes;
		var rawHtml = settings.raw_html || '';

		var slots = useMemo( function () { return readSlots( rawHtml ); }, [ rawHtml ] );

		var commit = function ( index, patch ) {
			var current = ( props.getSettings && props.getSettings() ) || settings;
			var nextHtml = writeSlot( current.raw_html || '', index, patch );
			if ( nextHtml === ( current.raw_html || '' ) ) {
				return;
			}
			// If the composer panel is active for this block, write through its shim
			// so the panel/slot-sync/preview stay consistent; otherwise write the
			// block attribute directly (the panel rebuilds fresh on next activate).
			var gb = GB();
			if ( gb && typeof gb.setSetting === 'function' && gb.getActiveClientId
				&& gb.getActiveClientId() === props.clientId
				&& gb.setSetting( props.clientId, 'raw_html', nextHtml ) ) {
				return;
			}
			var nextSettings = {};
			Object.keys( current ).forEach( function ( k ) { nextSettings[ k ] = current[ k ]; } );
			nextSettings.raw_html = nextHtml;
			setAttributes( { settings: nextSettings } );
		};

		var textSlots = slots.filter( function ( s ) { return s.kind === 'text'; } );
		var imageSlots = slots.filter( function ( s ) { return s.kind === 'image'; } );

		if ( ! textSlots.length && ! imageSlots.length ) {
			return null;
		}

		var children = [];
		textSlots.forEach( function ( s, i ) {
			children.push( el( SlotTextField, {
				key: 'text-' + s.index,
				slot: s,
				label: i + 1,
				commit: commit
			} ) );
		} );
		imageSlots.forEach( function ( s, i ) {
			children.push( el( SlotImageField, {
				key: 'image-' + s.index,
				slot: s,
				label: i + 1,
				commit: commit
			} ) );
		} );

		return el( PanelBody, { title: __( 'Content', 'uichemy' ), initialOpen: true }, children );
	}

	// Build standard-scope 3rd-party asset tags (CDN <link>/<script>) from the
	// raw_deps_standard JSON — mirrors the PHP renderer's build_standard_deps_output
	// so the editor iframe loads the same libraries the front end does.
	function buildDepTags( rawDepsJson ) {
		var out = { before: '', after: '' };
		if ( ! rawDepsJson ) {
			return out;
		}
		var deps;
		try { deps = JSON.parse( rawDepsJson ); } catch ( e ) { return out; }
		if ( ! Array.isArray( deps ) ) {
			return out;
		}
		deps.forEach( function ( dep ) {
			if ( ! dep || ! dep.enabled || ! dep.url ) {
				return;
			}
			var ver = ( dep.v && dep.v !== '—' ) ? String( dep.v ) : '';
			var url = String( dep.url ).replace( '{v}', ver );
			var attrs = Array.isArray( dep.attrs ) ? dep.attrs : [];
			var tag;
			if ( dep.kind === 'style' ) {
				var media = attrs.indexOf( 'print' ) >= 0 ? ' media="print"' : ( attrs.indexOf( 'all' ) >= 0 ? ' media="all"' : '' );
				tag = '<link rel="stylesheet" href="' + url + '"' + media + '>';
			} else {
				var extra = attrs.indexOf( 'defer' ) >= 0 ? ' defer' : ( attrs.indexOf( 'async' ) >= 0 ? ' async' : '' );
				if ( attrs.indexOf( 'module' ) >= 0 ) {
					extra += ' type="module"';
				}
				tag = '<scr' + 'ipt src="' + url + '"' + extra + '></scr' + 'ipt>';
			}
			if ( dep.position === 'after' ) {
				out.after += tag + '\n';
			} else {
				out.before += tag + '\n';
			}
		} );
		return out;
	}

	// Decode HTML entities kses may have injected into stored code (e.g. `&&` →
	// `&#038;&#038;`). Code fields never legitimately contain HTML entities.
	function decodeCodeEntities( s ) {
		s = String( s || '' );
		if ( s.indexOf( '&' ) === -1 ) { return s; }
		var t = document.createElement( 'textarea' );
		t.innerHTML = s;
		return t.value;
	}

	// Resolve any {{ Twig }} tokens in raw_html for the editor preview via the
	// atom-preview REST endpoint (same engine the front end renders through). When
	// the HTML has no tokens, the raw HTML is used directly.
	function hasDynamic( html ) {
		html = String( html || '' );
		return html.indexOf( '{{' ) !== -1 || html.indexOf( '{%' ) !== -1;
	}
	function atomPreviewCfg() { return window.uichAtomPreview || null; }
	function currentPostId() {
		try { return ( wp.data.select( 'core/editor' ).getCurrentPostId() ) || 0; } catch ( e ) { return 0; }
	}
	var atomPreviewCache = {};
	function useDynamicResolvedHtml( settings ) {
		var rawHtml = settings.raw_html || '';
		var rState = useState( rawHtml );
		var resolved = rState[ 0 ];
		var setResolved = rState[ 1 ];

		useEffect( function () {
			var cfg = atomPreviewCfg();
			if ( ! hasDynamic( rawHtml ) || ! cfg || ! cfg.url ) {
				setResolved( rawHtml );
				return undefined;
			}
			var pid = currentPostId();
			var key = pid + '|' + rawHtml;
			if ( atomPreviewCache[ key ] ) {
				setResolved( atomPreviewCache[ key ] );
				return undefined;
			}
			var alive = true;
			window.fetch( cfg.url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce || '' },
				body: JSON.stringify( { html: rawHtml, post_id: pid } )
			} ).then( function ( r ) { return r.ok ? r.json() : null; } ).then( function ( res ) {
				if ( ! alive ) { return; }
				var out = ( res && typeof res.html === 'string' ) ? res.html : rawHtml;
				atomPreviewCache[ key ] = out;
				setResolved( out );
			} ).catch( function () { if ( alive ) { setResolved( rawHtml ); } } );
			return function () { alive = false; };
		}, [ rawHtml ] );

		return resolved;
	}

	// Self-contained editor preview. Renders the composer's HTML/CSS/JS inside an
	// isolated iframe — no ServerSideRender round-trip. The front end still renders
	// via the PHP UiChemy_Composer_Renderer (slots, dynamic tags, scoping).
	function PreviewFrame( props ) {
		var settings = props.settings || {};
		var html = useDynamicResolvedHtml( settings );
		var css = decodeCodeEntities( settings.raw_css || '' );
		var js = decodeCodeEntities( String( settings.raw_js || '' ) ).replace( /<\/(script)/gi, '<\\/$1' );

		var ref = useRef( null );
		var hState = useState( 280 );
		var height = hState[ 0 ];
		var setHeight = hState[ 1 ];
		var heightRef = useRef( height );

		var deps = buildDepTags( settings.raw_deps_standard );

		// Site Globals (#uichemy-globals CSS variables + global classes) must be
		// mirrored into this isolated iframe, else `var(--…)` tokens applied to
		// elements resolve to nothing here — they only work on the front end, where
		// PHP prints #uichemy-globals into the page <head>. Live source: the
		// <style id="uichemy-globals-live"> the composer panel injects into the
		// editor document while editing. Fallback (before that style exists): the
		// persisted site head localized as uichComposerEditorCfg.siteCode(.head).
		function extractGlobalsFromHead( head ) {
			if ( ! head || typeof head !== 'string' ) { return ''; }
			var m = /<style[^>]*id=["']uichemy-globals["'][^>]*>([\s\S]*?)<\/style>/i.exec( head );
			return m ? m[ 1 ] : '';
		}
		function readGlobalsCss() {
			// 1) Live: the panel-injected style, freshest while editing globals.
			try {
				var live = document.getElementById( 'uichemy-globals-live' );
				if ( live && live.textContent ) { return live.textContent; }
			} catch ( e ) { /* noop */ }
			// 2) This block's persisted site head (carries #uichemy-globals) — the
			//    reliable load-time source when the panel hasn't injected the live
			//    style yet (e.g. viewing the block without opening the composer).
			var fromSetting = extractGlobalsFromHead( settings.site_custom_code_head || '' );
			if ( fromSetting ) { return fromSetting; }
			// 3) Global fallback: the localized editor site-code snapshot.
			try {
				var sc = window.uichComposerEditorCfg && window.uichComposerEditorCfg.siteCode;
				var head = sc ? ( typeof sc === 'string' ? sc : sc.head ) : '';
				return extractGlobalsFromHead( head );
			} catch ( e ) { /* noop */ }
			return '';
		}
		var gState = useState( readGlobalsCss );
		var globalsCss = gState[ 0 ];
		var setGlobalsCss = gState[ 1 ];
		useEffect( function () {
			function sync() {
				var next = readGlobalsCss();
				setGlobalsCss( function ( prev ) { return prev === next ? prev : next; } );
			}
			sync();
			var head = document.head || document.getElementsByTagName( 'head' )[ 0 ];
			if ( ! head || typeof MutationObserver === 'undefined' ) { return undefined; }
			var mo = new MutationObserver( sync );
			try {
				mo.observe( head, { childList: true, subtree: true, characterData: true } );
			} catch ( e ) { /* noop */ }
			return function () { mo.disconnect(); };
		}, [ settings.site_custom_code_head ] );

		// IDs/wrapper let us update html/css/globals IN PLACE (see the in-place
		// effect below) instead of reassigning srcDoc, which fully reloads the
		// iframe — dropping input focus and the floating editor toolbar that lives
		// inside this document. Only a script-context change (js/deps) needs a real
		// reload to re-run cleanly.
		var nextSrcDoc = '<!doctype html><html><head><meta charset="utf-8">'
			+ '<base target="_blank">'
			+ '<style>html,body{margin:0;padding:0;}</style>'
			+ '<style data-uichemy-globals id="uich-pv-globals">' + ( globalsCss || '' ) + '</style>'
			+ deps.before
			+ '<style id="uich-pv-css">' + css + '</style></head><body>'
			+ '<div id="uich-pv-root">' + html + '</div>'
			+ ( js ? '<scr' + 'ipt>' + js + '</scr' + 'ipt>' : '' )
			+ deps.after
			+ '</body></html>';

		// Debounce the actual iframe reload. Reassigning srcDoc re-navigates the
		// iframe from scratch, which aborts any in-flight "3RD PARTY ASSETS" CDN
		// script request. Without this, fast edits (e.g. typing) reload the iframe
		// on every keystroke, and a library like Anime.js may never finish
		// downloading before the next reload cancels it — leaving `anime` (or
		// whatever the library's global is) undefined when raw_js runs and
		// throwing a ReferenceError, repeatedly, for as long as edits keep coming
		// faster than the script can load.
		var latestSrcDocRef = useRef( nextSrcDoc );
		latestSrcDocRef.current = nextSrcDoc;

		var dState = useState( nextSrcDoc );
		var srcDoc = dState[ 0 ];
		var setSrcDoc = dState[ 1 ];
		var debounceRef = useRef( null );

		useEffect( function () {
			if ( debounceRef.current ) {
				window.clearTimeout( debounceRef.current );
			}
			debounceRef.current = window.setTimeout( function () {
				setSrcDoc( nextSrcDoc );
			}, 400 );
			return function () { window.clearTimeout( debounceRef.current ); };
		}, [ js, deps.before, deps.after ] );

		// Apply html / css / globals changes IN PLACE — no srcDoc reassign, so the
		// iframe is not reloaded and the composer's floating editor (which lives in
		// this document) keeps its focus and stays mounted. Runs only once the frame
		// has loaded; before that the initial srcDoc already carries these values.
		useEffect( function () {
			var frame = ref.current;
			if ( ! frame ) { return undefined; }
			var d = frame.contentDocument;
			if ( ! d || ! d.body ) { return undefined; }
			try {
				var root = d.getElementById( 'uich-pv-root' );
				if ( root && root.innerHTML !== html ) { root.innerHTML = html; }
				var cssEl = d.getElementById( 'uich-pv-css' );
				if ( cssEl && cssEl.textContent !== css ) { cssEl.textContent = css; }
				var gEl = d.getElementById( 'uich-pv-globals' );
				if ( gEl && gEl.textContent !== ( globalsCss || '' ) ) { gEl.textContent = globalsCss || ''; }
			} catch ( e ) { /* cross-origin guard */ }
			return undefined;
		}, [ html, css, globalsCss ] );

		useEffect( function () {
			var frame = ref.current;
			if ( ! frame ) {
				return undefined;
			}
			var observer = null;
			function resize() {
				try {
					var d = frame.contentDocument;
					var h = d && d.body ? d.body.scrollHeight : 0;
					if ( h && Math.abs( h - heightRef.current ) > 1 ) {
						// +20px (not just a rounding buffer) so the block's edge sits
						// clear of the content instead of hugging it exactly.
						heightRef.current = h + 20;
						setHeight( h + 20 );
					}
				} catch ( e ) { /* cross-origin guard */ }
			}
			// A single post-load measurement misses content that grows after the
			// initial paint — async images (the common case), web fonts, or JS the
			// widget itself runs. Without ongoing measurement the iframe gets stuck
			// at its first-measured height and shows its own native scrollbar
			// instead of growing, forcing the editor to scroll inside the preview.
			// A ResizeObserver on the iframe's own body keeps the height correct for
			// as long as the frame is mounted, not just at three fixed checkpoints.
			function restoreIfNavigatedAway() {
				try {
					var d = frame.contentDocument;
					if ( ! d ) { return false; }
					var href = d.location && d.location.href;
					if ( href && href !== 'about:srcdoc' && href !== 'about:blank' ) {
						frame.srcdoc = latestSrcDocRef.current;
						return true;
					}
				} catch ( e ) {
					// Reading location threw — the frame is on a cross-origin page,
					// which is itself proof it navigated away. Same recovery.
					try { frame.srcdoc = latestSrcDocRef.current; } catch ( e2 ) { /* noop */ }
					return true;
				}
				return false;
			}

			function swallowLinkNav( e ) {
				var a = e.target && e.target.closest ? e.target.closest( 'a[href]' ) : null;
				if ( a ) { e.preventDefault(); }
			}

			function onLoad() {
				if ( restoreIfNavigatedAway() ) { return; }
				resize();
				try {
					var d = frame.contentDocument;
					if ( d ) {
						d.addEventListener( 'click', swallowLinkNav, true );
					}
					if ( d && d.body && typeof ResizeObserver !== 'undefined' ) {
						if ( observer ) {
							observer.disconnect();
						}
						observer = new ResizeObserver( resize );
						observer.observe( d.body );
					}
				} catch ( e ) { /* cross-origin guard */ }
			}
			frame.addEventListener( 'load', onLoad );
			var t1 = window.setTimeout( resize, 250 );
			var t2 = window.setTimeout( resize, 800 );
			return function () {
				frame.removeEventListener( 'load', onLoad );
				if ( observer ) {
					observer.disconnect();
				}
				window.clearTimeout( t1 );
				window.clearTimeout( t2 );
			};
		}, [ srcDoc ] );

		return el( 'iframe', {
			ref: ref,
			srcDoc: srcDoc,
			sandbox: 'allow-scripts allow-same-origin',
			title: 'Composer preview',
			style: { width: '100%', height: height + 'px', border: '0', display: 'block', background: '#fff' }
		} );
	}

	function Edit( props ) {
		var attributes = props.attributes;
		var setAttributes = props.setAttributes;
		var clientId = props.clientId;
		var isSelected = props.isSelected;

		// Ensure a uid exists (used for CSS scoping on the front end).
		useEffect( function () {
			if ( ! attributes.uid ) {
				setAttributes( { uid: makeUid() } );
			}
		}, [] );

		// Bind the floating panel to this block when it becomes selected.
		//
		// Important: we do NOT deactivate when the block loses selection. The
		// floating panel lives outside the block's DOM (on document.body), so
		// clicking into the panel's editors deselects the block in Gutenberg —
		// tearing down the binding here would make the panel unusable. Instead we
		// keep the last-selected Composer block bound until another Composer block
		// is selected (its own effect re-binds) or this block is removed (cleanup).
		useEffect( function () {
			var gb = GB();
			if ( ! gb || ! isSelected || typeof gb.activate !== 'function' ) {
				return;
			}
			gb.activate( clientId );
			openBlockSidebar();
		}, [ isSelected, clientId ] );

		// Release the panel only when this block is unmounted (deleted) and it was
		// the active one.
		useEffect( function () {
			return function () {
				var gb = GB();
				if ( gb && typeof gb.deactivate === 'function'
					&& ( ! gb.getActiveClientId || gb.getActiveClientId() === clientId ) ) {
					gb.deactivate( clientId );
				}
			};
		}, [ clientId ] );

		// Open the editor: (1) inject + show the floating-panel shell (the React
		// composer app mounts into it), then (2) make THIS block active in the
		// composer store. Both are idempotent, so selection timing doesn't matter.
		function open( tab ) {
			// The composer already lives in the Block inspector (see `inspector`
			// below), so open THAT panel and switch its tab — don't pop the floating
			// drawer. uichOpenComposerTab() injects + SHOWS the drawer, which put a
			// second, redundant panel on screen next to the block sidebar.
			openBlockSidebar();
			var fireSwitch = function () {
				try {
					window.dispatchEvent( new CustomEvent( 'uich:composer-switch-tab', { detail: { tab: tab } } ) );
				} catch ( e ) { /* older browsers */ }
			};
			fireSwitch();
			// The inspector composer may still be mounting if the sidebar was just
			// opened — fire once more so the tab switch isn't missed.
			setTimeout( fireSwitch, 80 );
			var gb = GB();
			if ( gb && typeof gb.activate === 'function' ) {
				gb.activate( clientId );
			}
		}

		var blockProps = useBlockProps( { className: 'uichemy-composer-block-editor' } );

		var hasContent = !! ( attributes.settings && attributes.settings.raw_html );

		// Live settings getter so rapid slot edits read the freshest raw_html
		// (avoids stale-closure clobbering across debounced commits).
		var settingsRef = useRef( attributes.settings );
		settingsRef.current = attributes.settings;
		var getSettings = function () { return settingsRef.current || {}; };

		// Write a single settings key (block-level options), routing through the
		// composer shim when active so the panel/preview stay consistent.
		var writeBlockSetting = function ( key, value ) {
			var current = getSettings();
			var gb = GB();
			if ( gb && typeof gb.setSetting === 'function' && gb.getActiveClientId
				&& gb.getActiveClientId() === clientId
				&& gb.setSetting( clientId, key, value ) ) {
				return;
			}
			var next = {};
			Object.keys( current ).forEach( function ( k ) { next[ k ] = current[ k ]; } );
			if ( value === '' || value == null || value === false ) { delete next[ key ]; } else { next[ key ] = value; }
			setAttributes( { settings: next } );
		};

		var toolbar = el(
			BlockControls,
			{ key: 'toolbar' },
			el(
				ToolbarGroup,
				null,
				el( ToolbarButton, {
					icon: 'edit',
					label: __( 'Edit Layers', 'uichemy' ),
					onClick: function () { open( 'direct' ); }
				} ),
				el( ToolbarButton, {
					icon: 'editor-code',
					label: __( 'Edit Code', 'uichemy' ),
					onClick: function () { open( 'code' ); }
				} ),
				el( ToolbarButton, {
					icon: 'admin-comments',
					label: __( 'Edit with AI', 'uichemy' ),
					onClick: function () { open( 'chat' ); }
				} )
			)
		);

		var inspector = el(
			InspectorControls,
			{ key: 'inspector' },
			// Host for the full composer panel, rendered right at the top of the
			// Block tab. The React bundle (composer/src/index.jsx) watches for this
			// id and mounts <ComposerPanel surface="inspector"/> into it, then
			// unmounts when the inspector goes away — so nothing is rendered here
			// by this plain-JS block script beyond the empty container.
			//
			// Only while the block is SELECTED: InspectorControls content is
			// hoisted into the sidebar slot, and rendering the host for an
			// unselected block would fight the selected block's own host over the
			// same element id.
			isSelected ? el( 'div', {
				key: 'composer-host',
				id: 'uichemy-composer-inspector-host',
				className: 'uichemy-composer-inspector-host'
			} ) : null
			// The "Content" PanelBody (SlotsPanel) is intentionally not rendered:
			// the composer above owns slot editing through its own Content section,
			// so showing both meant two Content editors in one sidebar. SlotsPanel
			// and its field components are left defined but unused — see the note
			// on the function itself.
		);

		var body;
		if ( hasContent ) {
			// The preview is an iframe, which swallows pointer events — so a click
			// on it never selects the block and the block toolbar/inspector never
			// appear. While unselected, lay a transparent overlay over the iframe to
			// capture the click (selecting the block); once selected the overlay
			// lifts so the preview is interactive.
			body = el( 'div', { key: 'preview-wrap', style: { position: 'relative' } },
				el( PreviewFrame, { settings: attributes.settings } ),
				! isSelected ? el( 'div', {
					'aria-hidden': 'true',
					style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1, cursor: 'pointer' }
				} ) : null
			);
		} else {
			body = el( 'div', { key: 'placeholder', className: 'uichemy-cta' },
				el( 'div', { className: 'uichemy-cta-icon' },
					el( 'svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true' },
						el( 'path', { d: 'M12 3l1.85 4.6L18.5 9.5l-4.65 1.9L12 16l-1.85-4.6L5.5 9.5l4.65-1.9L12 3z', fill: 'currentColor' } ),
						el( 'path', { d: 'M18.6 13.6l.86 2.04 2.04.86-2.04.86-.86 2.04-.86-2.04-2.04-.86 2.04-.86.86-2.04z', fill: 'currentColor', opacity: '0.55' } )
					)
				),
				el( 'h3', { className: 'uichemy-cta-title' }, emptyStateTitle ),
				el( 'p', { className: 'uichemy-cta-text' }, emptyStateText ),
				el( 'div', { className: 'uichemy-cta-actions' },
					el( Button, {
						variant: 'primary',
						className: 'uichemy-cta-btn',
						onClick: function () { open( 'chat' ); }
					}, __( 'Edit with AI', 'uichemy' ) ),
					el( Button, {
						variant: 'secondary',
						className: 'uichemy-cta-btn',
						onClick: function () { open( 'code' ); }
					}, __( 'Edit Code', 'uichemy' ) )
				)
			);
		}

		return el( 'div', blockProps, toolbar, inspector, body );
	}

	// White-label block icon + title: set in the admin (Dashicons picker + Widget
	// label field) and localized server-side as window.uichUiChemyBlockCfg.
	// `icon` is a bare dashicon slug (e.g. 'star-filled'); `title` is the
	// white-label widget/plugin name (empty string when white-labeling is off,
	// in which case the default label below is kept). The category HEADING is
	// white-labeled separately, server-side, in register_category().
	var blockCfg   = window.uichUiChemyBlockCfg || {};
	// The UiChemy mark as the block icon. registerBlockType accepts a React element
	// here, so the logo is drawn inline rather than borrowed from Dashicons — which
	// is why the inserter used to show a generic code glyph. `fill="currentColor"`
	// lets it follow the inserter's own light/dark colours.
	//
	// A white-label icon still wins: that setting stores a bare dashicon slug, and
	// passing the string keeps WordPress's dashicon path intact.
	var UICH_MARK = el( 'svg', { viewBox: '0 0 40 40', xmlns: 'http://www.w3.org/2000/svg', width: 24, height: 24 },
		el( 'path', { d: 'M29.9051 21.3778V24.409C29.9028 25.8619 29.3149 27.2547 28.2694 28.2821C27.2239 29.3094 25.8065 29.8872 24.328 29.8895H20.7909C21.1677 29.5927 21.4973 29.2425 21.7694 28.8504C22.6079 27.6333 22.7157 26.2714 22.7157 25.2235L22.7264 21.3778H29.9051Z', fill: 'currentColor' } ),
		el( 'path', { fillRule: 'evenodd', clipRule: 'evenodd', d: 'M4.19223 4.19223C9.78187 -1.39741 30.2178 -1.39741 35.8075 4.19223C41.3971 9.78187 41.3971 30.2178 35.8075 35.8075C30.2178 41.3971 9.78187 41.3971 4.19223 35.8075C-1.39741 30.2178 -1.39741 9.78187 4.19223 4.19223ZM9.32797 9.33383V24.495C9.32797 26.124 9.98678 27.6868 11.159 28.8387C12.3312 29.9904 13.9213 30.6375 15.5789 30.6375H15.5877C16.0116 30.6768 16.4383 30.6768 16.8622 30.6375H24.328C26.0077 30.6375 27.6188 29.9814 28.8065 28.8143C29.9941 27.6472 30.6609 26.0643 30.661 24.4139V20.6414H21.9774L21.9579 25.2225C21.9579 25.2225 18.0147 25.4457 18.0145 22.4627V14.8553C18.0145 14.1301 17.8692 13.412 17.5868 12.742C17.3043 12.072 16.89 11.4628 16.368 10.95C15.8462 10.4374 15.2265 10.0312 14.5448 9.75375C13.8628 9.47629 13.1315 9.33371 12.3934 9.33383H9.32797ZM27.0282 9.33383C25.6876 9.33384 24.402 9.8566 23.4539 10.7879C22.506 11.7193 21.9729 12.9825 21.9725 14.2997V17.2782H30.659V9.33383H27.0282Z', fill: 'currentColor' } )
	);
	// Resolution order: a picked dashicon, then an uploaded brand logo, then our
	// own mark. The dashicon used to win unconditionally because PHP defaulted the
	// slug to 'editor-code', which made UICH_MARK above unreachable and shipped a
	// generic code glyph to every site.
	var blockIcon  = blockCfg.icon
		? blockCfg.icon
		: ( blockCfg.logo
			? el( 'img', { src: blockCfg.logo, alt: '', width: 24, height: 24, style: { objectFit: 'contain' } } )
			: UICH_MARK );
	var blockTitle = blockCfg.title ? blockCfg.title : __( 'Composer', 'uichemy' );
	// The empty-state "get started" card (Edit's placeholder) follows white-label
	// too: its heading uses the same white-label name as blockTitle, and its
	// one-liner uses the white-label `description` when set — each falling back to
	// the UiChemy default when white-labeling is off/unset.
	var emptyStateTitle = blockTitle;
	var emptyStateText  = blockCfg.description ? blockCfg.description : __( 'Describe a change and let AI build it, or drop in your own HTML, CSS and JS.', 'uichemy' );

	registerBlockType( 'uichemy/composer', {
		apiVersion: 3,
		title: blockTitle,
		description: __( 'Render and edit Figma-generated HTML/CSS/JS with editable slots.', 'uichemy' ),
		category: 'uichemy',
		icon: blockIcon,
		keywords: [ 'uichemy', 'composer', 'html', 'figma', 'code' ],
		supports: { html: false, customClassName: false, anchor: false, reusable: true, align: [ 'wide', 'full' ] },
		attributes: {
			uid: { type: 'string', 'default': '' },
			settings: { type: 'object', 'default': {} }
		},
		edit: Edit,
		save: function () { return null; }
	} );
} )( window.wp );
