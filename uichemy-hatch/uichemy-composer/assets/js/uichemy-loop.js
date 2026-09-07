/**
 * UiChemy — loop pagination runtime (AJAX + skeleton loading).
 *
 * Upgrades both loop page controls from full page loads to in-place updates:
 *
 *   • Load more  — appends the next batch after the current items.
 *   • Numbered   — swaps the loop's contents for the requested page.
 *
 * Both work the same way: fetch the URL the server already put in the link, then
 * lift the rendered result out of the response. Nothing here decides WHAT is
 * queried — it only re-requests a URL the visitor could open directly, so the
 * query stays entirely server-authored and there is no endpoint to abuse.
 *
 * With JS off, or if anything goes wrong, every control is still a real link and
 * navigates normally.
 *
 * Loaded only when a loop actually rendered one of the controls.
 */
(function () {
	'use strict';

	var BUSY = 'uich-loop--busy';
	var SKELETON = 'uich-loop-skeleton';
	var MORE_SLOT = 'uich-loop-more-slot';
	var PAGE_SLOT = 'uich-loop-pagination-slot';

	function isSlot( node ) {
		return node && node.nodeType === 1 && node.classList &&
			( node.classList.contains( MORE_SLOT ) || node.classList.contains( PAGE_SLOT ) );
	}

	/** The element children of a loop container that are actual items, not controls. */
	function itemsIn( parent ) {
		var out = [];
		for ( var i = 0; i < parent.children.length; i++ ) {
			if ( ! isSlot( parent.children[ i ] ) ) {
				out.push( parent.children[ i ] );
			}
		}
		return out;
	}

	/**
	 * Build placeholders by cloning real items and hollowing them out. Cloning
	 * rather than emitting generic boxes means the skeleton inherits the item's
	 * exact size, spacing and grid placement, so the layout never jumps when the
	 * real content replaces it.
	 */
	function makeSkeletons( sample, count ) {
		var frag = document.createDocumentFragment();
		if ( ! sample || count < 1 ) {
			return frag;
		}
		for ( var i = 0; i < count; i++ ) {
			var node = sample.cloneNode( true );
			node.classList.add( SKELETON );
			node.setAttribute( 'aria-hidden', 'true' );
			node.removeAttribute( 'id' );
			// cloneNode copies inline styles. If the sample was already hidden for
			// the swap, the clone inherits `display: none` and the skeleton renders
			// 0x0 — present in the DOM, invisible on screen. Clear it explicitly as
			// well as cloning before the hide, so neither order can reintroduce it.
			node.style.removeProperty( 'display' );
			// Strip anything that would show real content or be interactive.
			var links = node.querySelectorAll( 'a, button, input, select, textarea' );
			for ( var l = 0; l < links.length; l++ ) {
				links[ l ].removeAttribute( 'href' );
				links[ l ].setAttribute( 'tabindex', '-1' );
				links[ l ].setAttribute( 'aria-hidden', 'true' );
			}
			// Deliberately KEEP each image's src. A cloned <img> with no src
			// collapses to 0x0, taking the card's height with it — the skeleton
			// then renders as an invisible zero-height box. The CSS flattens the
			// bitmap to a solid grey block instead, which preserves the exact
			// layout the real item will occupy.
			var embeds = node.querySelectorAll( 'svg, video, iframe' );
			for ( var m = 0; m < embeds.length; m++ ) {
				embeds[ m ].innerHTML = '';
			}
			frag.appendChild( node );
		}
		return frag;
	}

	function clearSkeletons( parent ) {
		var all = parent.querySelectorAll( '.' + SKELETON );
		for ( var i = 0; i < all.length; i++ ) {
			if ( all[ i ].parentNode ) {
				all[ i ].parentNode.removeChild( all[ i ] );
			}
		}
	}

	/**
	 * Real source attributes used by lazy-load plugins, in the order we trust them.
	 * Perfmatters, WP Rocket, Smush, a3 Lazy Load, WP Compress and friends all ship
	 * a placeholder in `src` and keep the true URL in one of these.
	 */
	var LAZY_SRC_ATTRS = [ 'data-src', 'data-lazy-src', 'data-wpcs-src', 'data-original', 'data-cfsrc' ];
	var LAZY_SET_ATTRS = [ 'data-srcset', 'data-lazy-srcset', 'data-wpcs-srcset', 'data-original-set' ];
	var LAZY_BG_ATTRS = [ 'data-bg', 'data-background-image', 'data-bg-image' ];
	var LAZY_CLASSES = [
		'perfmatters-lazy', 'lazyload', 'lazy', 'lazy-hidden', 'wpcs-lazy',
		'a3-lazyload', 'rocket-lazyload', 'jetpack-lazy-image', 'ls-is-cached',
	];

	function firstAttr( el, names ) {
		for ( var i = 0; i < names.length; i++ ) {
			var v = el.getAttribute( names[ i ] );
			if ( v && v.indexOf( 'data:' ) !== 0 ) {
				return { name: names[ i ], value: v };
			}
		}
		return null;
	}

	/**
	 * Promote lazy-load placeholders to their real sources inside a freshly fetched
	 * subtree.
	 *
	 * A lazy-load plugin swaps every `src` for a transparent placeholder and hands
	 * the real URL to an IntersectionObserver it builds ONCE on page load. Nodes we
	 * inject later were never registered with that observer, so their placeholder is
	 * never replaced and the image stays permanently blank — visible only on sites
	 * that run such a plugin, which is why it does not reproduce locally.
	 *
	 * Hydrating the attributes ourselves fixes every one of those plugins at once,
	 * without depending on any of their internals (Perfmatters, for one, does not
	 * expose its LazyLoad instance, so its own update() is unreachable). Images that
	 * were never lazified have no data-attribute and are left untouched.
	 */
	function hydrateLazyMedia( root ) {
		if ( ! root || typeof root.querySelectorAll !== 'function' ) {
			return;
		}
		var media = root.querySelectorAll( 'img, source, iframe, video' );
		for ( var i = 0; i < media.length; i++ ) {
			var el = media[ i ];

			var src = firstAttr( el, LAZY_SRC_ATTRS );
			if ( src ) {
				el.setAttribute( 'src', src.value );
			}
			var set = firstAttr( el, LAZY_SET_ATTRS );
			if ( set ) {
				el.setAttribute( 'srcset', set.value );
			}
			var sizes = el.getAttribute( 'data-sizes' );
			if ( sizes && 'auto' !== sizes ) {
				el.setAttribute( 'sizes', sizes );
			}

			// Drop the source attributes and markers so the plugin's own observer
			// cannot re-blank what we just resolved, and so a second pass is a no-op.
			LAZY_SRC_ATTRS.concat( LAZY_SET_ATTRS ).forEach( function ( a ) {
				el.removeAttribute( a );
			} );
			for ( var c = 0; c < LAZY_CLASSES.length; c++ ) {
				el.classList.remove( LAZY_CLASSES[ c ] );
			}
		}

		// Lazy background images carry their URL the same way.
		var bgSel = LAZY_BG_ATTRS.map( function ( a ) { return '[' + a + ']'; } ).join( ',' );
		var bgs = root.querySelectorAll( bgSel );
		for ( var b = 0; b < bgs.length; b++ ) {
			var node = bgs[ b ];
			var bg = firstAttr( node, LAZY_BG_ATTRS );
			if ( bg ) {
				node.style.backgroundImage = 'url("' + bg.value.replace( /"/g, '\\"' ) + '")';
				LAZY_BG_ATTRS.forEach( function ( a ) { node.removeAttribute( a ); } );
				for ( var k = 0; k < LAZY_CLASSES.length; k++ ) {
					node.classList.remove( LAZY_CLASSES[ k ] );
				}
			}
		}
	}

	/** Elementor's stable per-element class, used to find the same loop in the response. */
	function widgetSelector( el ) {
		var w = el.closest( '.elementor-widget, .elementor-element' );
		if ( ! w ) {
			return null;
		}
		var m = String( w.className || '' ).match( /elementor-element-([\w-]+)/ );
		return m ? { sel: '.elementor-element-' + m[ 1 ], node: w } : null;
	}

	/** Which slot this is within its widget — a widget may hold several loops. */
	function slotIndexIn( widget, slotEl ) {
		var all = widget.querySelectorAll( '.' + MORE_SLOT + ', .' + PAGE_SLOT );
		for ( var i = 0; i < all.length; i++ ) {
			if ( all[ i ] === slotEl ) {
				return i;
			}
		}
		return 0;
	}

	function fetchDoc( href ) {
		return fetch( href, { credentials: 'same-origin' } ).then( function ( r ) {
			if ( ! r.ok ) {
				throw new Error( 'HTTP ' + r.status );
			}
			return r.text();
		} ).then( function ( html ) {
			return new DOMParser().parseFromString( html, 'text/html' );
		} );
	}

	/** Locate the counterpart of `slotEl` inside a freshly fetched document. */
	function matchingSlot( doc, sel, index ) {
		var w = doc.querySelector( sel );
		if ( ! w ) {
			return null;
		}
		var all = w.querySelectorAll( '.' + MORE_SLOT + ', .' + PAGE_SLOT );
		return all[ index ] || null;
	}

	function scrollIntoViewIfAbove( el ) {
		var top = el.getBoundingClientRect().top;
		if ( top < 0 ) {
			el.scrollIntoView( { behavior: 'smooth', block: 'start' } );
		}
	}

	function onClick( ev ) {
		var t = ev.target;
		if ( ! t || typeof t.closest !== 'function' ) {
			return;
		}
		// Let modified clicks (new tab / window) behave normally.
		if ( ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey ) {
			return;
		}

		var moreLink = t.closest( '.uich-loop-more' );
		var pageLink = t.closest( '.' + PAGE_SLOT + ' a.page-numbers' );
		var link = moreLink || pageLink;
		if ( ! link ) {
			return;
		}

		var href = link.getAttribute( 'href' );
		var slotEl = link.closest( '.' + MORE_SLOT + ', .' + PAGE_SLOT );
		var parent = slotEl && slotEl.parentNode;
		var w = widgetSelector( link );
		// Anything unexpected: leave it as a plain link rather than half-handling it.
		if ( ! href || ! slotEl || ! parent || ! w || parent.classList.contains( BUSY ) ) {
			return;
		}

		ev.preventDefault();

		var isMore = !! moreLink;
		var index = slotIndexIn( w.node, slotEl );
		var existing = itemsIn( parent );
		var sample = existing[ existing.length - 1 ] || existing[ 0 ];

		parent.classList.add( BUSY );
		parent.setAttribute( 'aria-busy', 'true' );

		// Draw placeholders up front so the wait has visible feedback.
		var skelCount;
		if ( isMore ) {
			// data-batch is exact in offset mode. A page-mode loop has no batch — the
			// next page is another full page — so stand in for a pageful, i.e. what
			// is on screen now. (Guessing a small constant here made the placeholder
			// visibly shorter than the batch that arrived.)
			skelCount = parseInt( link.getAttribute( 'data-batch' ), 10 );
			if ( ! ( skelCount > 0 ) ) {
				// Page mode: the next page holds as many items as the FIRST page did.
				// Measuring the container each time would grow with every append (a
				// second click asked for 16 placeholders to load 8), so remember the
				// page size the first time we see it.
				skelCount = parseInt( parent.getAttribute( 'data-uich-page-size' ), 10 );
				if ( ! ( skelCount > 0 ) ) {
					skelCount = existing.length || 3;
					parent.setAttribute( 'data-uich-page-size', skelCount );
				}
			}
			parent.insertBefore( makeSkeletons( sample, skelCount ), slotEl );
		} else {
			// Numbered: the current page is being replaced, so hide it and stand in
			// for all of it. Build the placeholders BEFORE hiding, or the clone
			// source is already display:none and every skeleton inherits it.
			skelCount = existing.length || 3;
			var pageFrag = makeSkeletons( sample, skelCount );
			for ( var i = 0; i < existing.length; i++ ) {
				// NOT the `hidden` attribute: the UA's `[hidden] { display: none }`
				// loses to any author rule that sets display on the item (a card is
				// usually `display: flex` or a grid child), so the old items stayed
				// on screen and the skeletons piled up underneath them.
				existing[ i ].style.setProperty( 'display', 'none', 'important' );
			}
			parent.insertBefore( pageFrag, slotEl );
		}

		var done = function () {
			parent.classList.remove( BUSY );
			parent.removeAttribute( 'aria-busy' );
		};

		/**
		 * Put the loop back exactly as it was. Used on every failure path: without
		 * it the items stay hidden behind cleared skeletons and the visitor is left
		 * staring at an empty container — and the fallback navigation can take
		 * seconds, so "briefly" is not brief.
		 */
		var restore = function () {
			clearSkeletons( parent );
			for ( var r = 0; r < existing.length; r++ ) {
				existing[ r ].style.removeProperty( 'display' );
			}
		};

		fetchDoc( href ).then( function ( doc ) {
			var nextSlot = matchingSlot( doc, w.sel, index );
			if ( ! nextSlot || ! nextSlot.parentNode ) {
				throw new Error( 'loop not found in response' );
			}
			var nextParent = nextSlot.parentNode;

			// Never swap in an empty result. If the response carries no items —
			// a query that legitimately returns nothing for this page, a partial
			// render, a cache/redirect serving something unexpected — replacing
			// would leave the visitor with a blank listing and no way back. Treat
			// it as a failure so the fallback navigation shows the real page.
			if ( itemsIn( nextParent ).length === 0 ) {
				throw new Error( 'no items in response' );
			}

			clearSkeletons( parent );

			if ( isMore ) {
				// Append only the newly rendered items; keep everything already shown.
				var frag = document.createDocumentFragment();
				var kids = itemsIn( nextParent );
				for ( var k = 0; k < kids.length; k++ ) {
					frag.appendChild( document.importNode( kids[ k ], true ) );
				}
				var added = frag.childElementCount;
				// Resolve lazy-load placeholders before the nodes enter the document,
				// so the images never flash as blanks.
				hydrateLazyMedia( frag );
				parent.insertBefore( frag, slotEl );

				var nextBtn = nextSlot.querySelector( '.uich-loop-more' );
				if ( nextBtn && nextBtn.getAttribute( 'href' ) && added > 0 ) {
					link.setAttribute( 'href', nextBtn.getAttribute( 'href' ) );
					for ( var a = 0; a < nextBtn.attributes.length; a++ ) {
						var att = nextBtn.attributes[ a ];
						if ( att.name.indexOf( 'data-' ) === 0 ) {
							link.setAttribute( att.name, att.value );
						}
					}
				} else {
					// Nothing left — the control has served its purpose.
					slotEl.parentNode.removeChild( slotEl );
				}
				link.dispatchEvent( new CustomEvent( 'uichemy:loop-more', {
					bubbles: true,
					detail: { added: added },
				} ) );
			} else {
				// Numbered: swap the whole container. Replacing wholesale (rather than
				// just the items) keeps any static content authored alongside the loop,
				// and refreshes the nav so the current-page highlight is correct — both
				// re-render identically in the fetched document.
				var pageFragOut = document.createDocumentFragment();
				Array.prototype.forEach.call( nextParent.childNodes, function ( n ) {
					pageFragOut.appendChild( document.importNode( n, true ) );
				} );
				hydrateLazyMedia( pageFragOut );
				parent.replaceChildren( pageFragOut );
				scrollIntoViewIfAbove( parent );
				parent.dispatchEvent( new CustomEvent( 'uichemy:loop-page', { bubbles: true } ) );
			}
		} ).catch( function () {
			// Put the loop back first, THEN fall back to the plain navigation the
			// link always was — so the visitor keeps seeing real content for the
			// seconds the full page load takes, instead of an empty container.
			restore();
			window.location.href = href;
		} ).finally( done );
	}

	document.addEventListener( 'click', onClick );
}());
