/**
 * UiChemy Composer — shared slot parsing/writing (builder-agnostic).
 *
 * Extracted from the Gutenberg block's index.js so Bricks (and any future
 * builder's sidebar UI) can render the exact same "Text N / Image N" per-slot
 * fields against the exact same raw_html walk, instead of drifting apart with
 * separate copies. Exposes window.UiChemySlots = { readSlots, writeSlot }.
 *
 * Mirrors the PHP get_text_nodes() walk used at render time, so slot indexes
 * here line up with the server's own slot_N settings keys.
 */
( function () {
	'use strict';

	var SLOT_INLINE_TAGS = [ 'A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'LABEL', 'BUTTON' ];
	var SLOT_IGNORE_TAGS = [ 'STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE' ];
	var SLOT_MAX = 20;

	function isSvgImg( node ) {
		var src = ( node.getAttribute && node.getAttribute( 'src' ) ) || '';
		return /^data:image\/svg\+xml/i.test( src ) || /\.svg(?:[?#]|$)/i.test( src );
	}

	// Twig statement tags — {% for %}, {% endfor %}, {% if %}, {% endif %},
	// {% else %} — aren't real HTML elements, so a Loop/Condition construct's
	// open/close markers sit in the DOM as plain sibling TEXT NODES. Without this
	// check they got picked up as ordinary "TEXT N" content slots: exposed as
	// editable fields (with a "replace with dynamic value" icon that would
	// silently overwrite the tag and corrupt the loop/condition if clicked).
	// {{ value }} expressions are NOT filtered — those are genuine editable
	// bindings, only {% ... %} STATEMENT syntax is structural.
	function isPureTwigStatement( text ) {
		return /^\s*\{%[\s\S]*%\}\s*$/.test( String( text || '' ) );
	}

	function parseHtmlToDiv( rawHtml ) {
		var div = document.createElement( 'div' );
		div.innerHTML = String( rawHtml || '' );
		return div;
	}

	// Collect editable nodes in document order (same order as the renderer's slots).
	function collectSlotNodes( root, out ) {
		out = out || [];
		var kids = root.childNodes;
		for ( var i = 0; i < kids.length && out.length < SLOT_MAX; i++ ) {
			var c = kids[ i ];
			if ( c.nodeType === 3 ) {
				if ( c.nodeValue && c.nodeValue.trim() !== '' && ! isPureTwigStatement( c.nodeValue ) ) {
					out.push( { node: c, kind: 'text' } );
				}
			} else if ( c.nodeType === 1 ) {
				var tag = ( c.tagName || '' ).toUpperCase();
				if ( tag.indexOf( 'UICHEMY-' ) === 0 || SLOT_IGNORE_TAGS.indexOf( tag ) >= 0 ) {
					continue;
				}
				if ( tag === 'IMG' ) {
					out.push( { node: c, kind: isSvgImg( c ) ? 'svg' : 'image' } );
				} else if ( tag === 'SVG' ) {
					out.push( { node: c, kind: 'svg' } );
				} else if ( SLOT_INLINE_TAGS.indexOf( tag ) >= 0 ) {
					if ( String( c.textContent || '' ).trim() !== '' && ! isPureTwigStatement( c.textContent ) ) {
						out.push( { node: c, kind: 'text' } );
					}
				} else {
					collectSlotNodes( c, out );
				}
			}
		}
		return out;
	}

	// Read-only slot descriptors for rendering the controls.
	function readSlots( rawHtml ) {
		var entries = collectSlotNodes( parseHtmlToDiv( rawHtml ) );
		return entries.map( function ( e, idx ) {
			if ( e.kind === 'image' ) {
				return {
					index: idx,
					kind: 'image',
					src: e.node.getAttribute( 'src' ) || '',
					alt: e.node.getAttribute( 'alt' ) || ''
				};
			}
			if ( e.kind === 'svg' ) {
				return { index: idx, kind: 'svg' };
			}
			var isLink = ( e.node.nodeType === 1 && String( e.node.tagName || '' ).toUpperCase() === 'A' );
			var text = ( e.node.nodeType === 3 ) ? e.node.nodeValue : e.node.textContent;
			return { index: idx, kind: 'text', isLink: isLink, text: String( text || '' ).trim() };
		} );
	}

	// Write a single slot's new value back into raw_html and return the new HTML.
	function writeSlot( rawHtml, index, patch ) {
		var div = parseHtmlToDiv( rawHtml );
		var entries = collectSlotNodes( div );
		var entry = entries[ index ];
		if ( ! entry ) {
			return rawHtml;
		}
		var node = entry.node;
		if ( entry.kind === 'text' ) {
			var val = patch.text == null ? '' : String( patch.text );
			if ( node.nodeType === 3 ) {
				node.nodeValue = val === '' ? '​' : val;
			} else {
				node.textContent = val;
			}
		} else if ( entry.kind === 'image' ) {
			if ( patch.src != null ) {
				node.setAttribute( 'src', String( patch.src ) );
			}
			if ( patch.alt != null ) {
				node.setAttribute( 'alt', String( patch.alt ) );
			}
		}
		return div.innerHTML;
	}

	window.UiChemySlots = {
		readSlots: readSlots,
		writeSlot: writeSlot
	};
} )();
