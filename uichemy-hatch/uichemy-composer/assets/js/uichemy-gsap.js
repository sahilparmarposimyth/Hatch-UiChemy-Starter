/**
 * UiChemy GSAP animation runtime (Basic type).
 *
 * UiChemy's own take on The Plus Addons' GSAP animation: the option SET is
 * modelled on TPAE (Type / Trigger / Delay / Duration / Offset / Style / Effect /
 * Direction / Stagger / Repeat) but the implementation is UiChemy-native — the
 * config is a single JSON blob on `data-tp-gsap` written by the composer's
 * Animation panel onto any raw_html node, and this plain-JS runtime reads it and
 * plays the animation. No jQuery. GSAP + ScrollTrigger are enqueued separately.
 *
 * data-tp-gsap (JSON), Basic type keys:
 *   type       "tp_basic" | "tp_custom" | "none"
 *   trigger    "tp_on_load" | "tp_on_scroll"
 *   delay      seconds        duration  seconds        offset  px
 *   style      "tp_fade" | "tp_slide" | "tp_scale"
 *   ease       gsap ease (e.g. "power1.out")
 *   direction  "top" | "bottom" | "left" | "right"
 *   stagger    "yes" | "no"    stagger_depth "child" | "multi_child"
 *   repeat     "yes" | "no"
 */
( function () {
	'use strict';

	var SELECTOR = '[data-tp-gsap]';
	var DONE = 'tp-gsap-done';
	var pluginReg = false;

	// Do NOT hard-return when gsap is missing at load time — in the Elementor
	// preview iframe the runtime can execute before gsap finishes loading, and a
	// module-level return would kill it forever (works on the front end, dead in
	// the editor). Instead check on demand and register the plugin once ready.
	function gsapReady() {
		if ( typeof window.gsap === 'undefined' ) { return false; }
		if ( ! pluginReg ) {
			var plugins = [];
			if ( typeof window.ScrollTrigger !== 'undefined' ) { plugins.push( window.ScrollTrigger ); }
			if ( typeof window.MotionPathPlugin !== 'undefined' ) { plugins.push( window.MotionPathPlugin ); }
			if ( typeof window.DrawSVGPlugin !== 'undefined' ) { plugins.push( window.DrawSVGPlugin ); }
			if ( plugins.length ) { try { window.gsap.registerPlugin.apply( window.gsap, plugins ); pluginReg = true; } catch ( e ) {} }
			else { pluginReg = true; }
		}
		return true;
	}

	// Poll briefly for gsap, then run the callback (covers late script load).
	function whenGsap( cb ) {
		if ( gsapReady() ) { cb(); return; }
		var n = 0;
		var t = setInterval( function () {
			n++;
			if ( gsapReady() ) { clearInterval( t ); cb(); }
			else if ( n > 40 ) { clearInterval( t ); } // ~8s give-up
		}, 200 );
	}

	function isEditMode() {
		try {
			return !! ( window.elementorFrontend && window.elementorFrontend.isEditMode && window.elementorFrontend.isEditMode() );
		} catch ( e ) { return false; }
	}

	// Which nodes get staggered — UiChemy raw_html has no Elementor .e-con /
	// .elementor-widget, so we stagger the element's own children: direct children
	// for "child", every descendant element for "multi_child".
	function staggerTargets( wrap, depth ) {
		if ( 'multi_child' === depth ) {
			return wrap.querySelectorAll( '*' );
		}
		return wrap.children;
	}

	function play( wrap, opt ) {
		if ( ! gsapReady() ) { return; }
		if ( ! opt || 'tp_custom' === opt.type || 'none' === opt.type ) { return; }

		var direction = opt.direction || 'bottom';
		var offset    = parseFloat( opt.offset )   || 50;
		var duration  = parseFloat( opt.duration ) || 1.2;
		var delay     = parseFloat( opt.delay )    || 0;
		var ease      = opt.ease    || 'power2.out';
		var trigger   = opt.trigger || 'tp_on_load';
		var style     = opt.style   || 'tp_fade';
		var stagger   = opt.stagger || 'no';
		var repeat    = opt.repeat  || 'no';

		var targets = wrap;
		if ( 'yes' === stagger ) {
			targets = staggerTargets( wrap, opt.stagger_depth );
		}

		var fromVars = {};
		if ( 'tp_fade' === style )  { fromVars.autoAlpha = 0; }
		if ( 'tp_scale' === style ) { fromVars.scale = 0.5; }

		switch ( direction ) {
			case 'top':    fromVars.y = -offset; break;
			case 'bottom': fromVars.y = offset;  break;
			case 'left':   fromVars.x = -offset; break;
			case 'right':  fromVars.x = offset;  break;
			default:       fromVars.y = offset;
		}

		var toVars = {
			x: 0,
			y: 0,
			duration: duration,
			delay: delay,
			ease: ease,
			repeat: 'yes' === repeat ? -1 : 0,
			yoyo: 'yes' === repeat,
			overwrite: true,
		};
		if ( 'tp_fade' === style )  { toVars.autoAlpha = 1; }
		if ( 'tp_scale' === style ) { toVars.scale = 1; }

		if ( 'yes' === stagger && targets && targets.length > 1 ) {
			toVars.stagger = delay || 0.15;
		}

		// Scroll trigger — skipped in the editor so nothing stays stuck hidden.
		if ( 'tp_on_load' !== trigger && window.ScrollTrigger && ! isEditMode() ) {
			toVars.scrollTrigger = {
				trigger: wrap,
				start: 'top 50%',
				toggleActions: 'play none none reverse',
				once: false,
			};
		}

		window.gsap.fromTo( targets, { ...fromVars }, toVars );
	}

	// Advanced (tp_custom) — a scroll-SCRUBBED timeline. Each motion property has
	// a {on, from, to}; the element tweens from→to linked to the scroll position
	// between `start` (viewport %) and `start + end px`. Mirrors The Plus Addons'
	// magic-scroll core (per-property [from,to] → gsap.fromTo + ScrollTrigger).
	//   m_opacity, m_x, m_y, m_scale, m_rotate, m_skew : { on, from, to }
	//   start  viewport % where it begins   (default 80)
	//   end    scroll distance in px        (default 300)
	//   scrub  smoothing seconds, or "true" (default 1)
	// key → { css property, kind }. kind: num (raw number), px (number + "px"),
	// raw (string as-is, e.g. colors / shadows — gsap's CSSPlugin tweens them).
	var PROP_MAP = {
		// motion / transform
		m_opacity: { css: 'opacity', kind: 'num' },
		m_x: { css: 'x', kind: 'num' },
		m_y: { css: 'y', kind: 'num' },
		m_scale: { css: 'scale', kind: 'num' },
		m_rotate: { css: 'rotation', kind: 'num' },
		m_skew: { css: 'skewX', kind: 'num' },
		// appearance
		m_width: { css: 'width', kind: 'px' },
		m_height: { css: 'height', kind: 'px' },
		m_padding: { css: 'padding', kind: 'px' },
		m_fontsize: { css: 'fontSize', kind: 'px' },
		m_letterspacing: { css: 'letterSpacing', kind: 'px' },
		m_color: { css: 'color', kind: 'raw' },
		m_bgcolor: { css: 'backgroundColor', kind: 'raw' },
		m_bordercolor: { css: 'borderColor', kind: 'raw' },
		m_boxshadow: { css: 'boxShadow', kind: 'raw' },
		m_textshadow: { css: 'textShadow', kind: 'raw' },
		// 3D (Phase 3d-1) — needs transformPerspective for the rotations to read as 3D.
		m_rotatex: { css: 'rotationX', kind: 'num' },
		m_rotatey: { css: 'rotationY', kind: 'num' },
		m_perspective: { css: 'transformPerspective', kind: 'px' },
	};
	function coerce( v, kind ) {
		if ( 'num' === kind ) { return parseFloat( v ); }
		if ( 'px' === kind ) { var n = parseFloat( v ); return isNaN( n ) ? v : ( n + 'px' ); }
		return v; // raw
	}
	function isOn( m ) { return m && ( m.on === true || m.on === 'true' || m.on === 'yes' ); }

	// Visual effects (blur/brightness/grayscale) all live on ONE `filter` property,
	// so they're combined into a single filter string (per from/to).
	var FILTER_MAP = { m_blur: 'blur', m_brightness: 'brightness', m_grayscale: 'grayscale' };
	function buildFilter( frame, which ) {
		var parts = [];
		Object.keys( FILTER_MAP ).forEach( function ( key ) {
			var m = frame[ key ];
			if ( ! isOn( m ) ) { return; }
			var v = parseFloat( m[ which ] );
			if ( isNaN( v ) ) { v = 0; }
			parts.push( 'blur' === FILTER_MAP[ key ] ? 'blur(' + v + 'px)' : FILTER_MAP[ key ] + '(' + v + ')' );
		} );
		return parts.length ? parts.join( ' ' ) : null;
	}

	// One repeater frame → one scroll-scrubbed fromTo on the element.
	function playFrame( wrap, frame ) {
		var fromVars = {};
		var toVars = { ease: frame.ease || 'none', overwrite: 'auto' };
		var any = false;

		Object.keys( PROP_MAP ).forEach( function ( key ) {
			var m = frame[ key ];
			if ( ! isOn( m ) ) { return; }
			var def = PROP_MAP[ key ];
			fromVars[ def.css ] = coerce( m.from, def.kind );
			toVars[ def.css ]   = coerce( m.to, def.kind );
			any = true;
		} );

		// Combined filter (blur/brightness/grayscale). Both from & to include the
		// same enabled functions, so gsap can interpolate their numbers.
		var ff = buildFilter( frame, 'from' );
		var ft = buildFilter( frame, 'to' );
		if ( ff !== null || ft !== null ) {
			fromVars.filter = ff || 'none';
			toVars.filter = ft || 'none';
			any = true;
		}

		var sticky = isOn( frame.sticky );
		var parallax = isOn( frame.parallax );
		var motionpath = isOn( frame.motionpath ) && frame.motionpath.path && window.MotionPathPlugin;
		var drawsvg = isOn( frame.drawsvg ) && window.DrawSVGPlugin;
		var playvideo = isOn( frame.playvideo );
		var threed = isOn( frame.threed );
		if ( ! any && ! sticky && ! parallax && ! motionpath && ! drawsvg && ! playvideo && ! threed ) { return; }

		var start = parseFloat( frame.start );
		if ( isNaN( start ) ) { start = 80; }
		var end = parseFloat( frame.end ) || 300;
		var offset = parseFloat( frame.offset ) || 0;
		// Build the ScrollTrigger start from the viewport-% (`start`), e.g. "top 80%".
		// Offset shifts the trigger point along the scroll (e.g. "top 80%+=100").
		// NOTE: this MUST derive from `start`, not from `startStr` itself — the
		// previous self-reference left every trigger with start:"undefined", which
		// silently broke ALL advanced scroll animations (editor and front end).
		var startStr = 'top ' + start + '%';
		if ( offset ) { startStr += ( offset > 0 ? '+=' : '-=' ) + Math.abs( offset ); }
		var scrub = ( frame.scrub === 'true' || frame.scrub === true ) ? true : ( parseFloat( frame.scrub ) || 1 );

		// Parallax (Phase 3d-2) — an independent viewport-passage y move: element
		// drifts from +speed to -speed across the whole time it's on screen.
		if ( parallax ) {
			var pspeed = parseFloat( frame.parallax.speed ) || 100;
			window.gsap.fromTo(
				wrap,
				{ y: pspeed },
				{ y: -pspeed, ease: 'none', overwrite: 'auto',
					scrollTrigger: { trigger: wrap, start: 'top bottom', end: 'bottom top', scrub: true } }
			);
		}

		var stConfig = {
			trigger: wrap,
			start: startStr,
			end: '+=' + end,
			scrub: scrub,
		};
		// Sticky (Phase 3d-2) — pin the element for the scroll range.
		if ( sticky ) { stConfig.pin = true; }

		// Motion path (Phase 3d-3) — the element travels along an SVG path (a
		// selector like "#mypath" or raw path data) as you scroll, optionally
		// rotating to face the direction of travel.
		if ( motionpath ) {
			window.gsap.to( wrap, {
				ease: 'none',
				immediateRender: true,
				motionPath: {
					path: frame.motionpath.path,
					autoRotate: !! frame.motionpath.autoRotate,
				},
				scrollTrigger: { trigger: wrap, start: startStr, end: '+=' + end, scrub: scrub },
			} );
		}

		// Draw SVG (Phase 3d-4) — "draw" the stroke of SVG paths as you scroll.
		// Targets: a selector inside the element, else every drawable SVG shape.
		if ( drawsvg ) {
			var sel = ( frame.drawsvg.target || '' ).trim();
			var dtargets = sel
				? wrap.querySelectorAll( sel )
				: wrap.querySelectorAll( 'path, line, polyline, circle, rect, ellipse' );
			if ( dtargets.length ) {
				window.gsap.fromTo(
					dtargets,
					{ drawSVG: frame.drawsvg.from || '0%' },
					{ drawSVG: frame.drawsvg.to || '100%', ease: 'none', overwrite: 'auto',
						scrollTrigger: { trigger: wrap, start: startStr, end: '+=' + end, scrub: scrub } }
				);
			}
		}

		// Play video on scroll (Phase 3d-5) — scrub a <video>'s currentTime to the
		// scroll position (no plugin needed; ScrollTrigger.onUpdate drives it).
		if ( playvideo ) {
			var vsel = ( frame.playvideo.target || '' ).trim();
			var video = vsel
				? wrap.querySelector( vsel )
				: ( ( wrap.matches && wrap.matches( 'video' ) ) ? wrap : wrap.querySelector( 'video' ) );
			if ( video ) {
				try { video.pause(); } catch ( e ) {}
				var mkVideoST = function () {
					window.ScrollTrigger.create( {
						trigger: wrap,
						start: startStr,
						end: '+=' + end,
						scrub: scrub,
						onUpdate: function ( self ) {
							if ( video.duration ) { video.currentTime = self.progress * video.duration; }
						},
					} );
				};
				if ( video.readyState >= 1 ) { mkVideoST(); }
				else { video.addEventListener( 'loadedmetadata', mkVideoST, { once: true } ); }
			}
		}

		// 3D Ring (advanced) — arrange the inner cards on a 3D ring (radius) and
		// spin the container as you scroll (preserve-3d carousel/coverflow).
		if ( threed ) {
			var innerSel = ( frame.threed.inner || '' ).trim();
			var cards = innerSel ? wrap.querySelectorAll( innerSel ) : wrap.children;
			cards = Array.prototype.slice.call( cards );
			if ( cards.length ) {
				var radius = parseFloat( frame.threed.radius ) || 300;
				var angle = 360 / cards.length;
				cards.forEach( function ( card, ci ) {
					window.gsap.set( card, {
						rotationY: ci * angle,
						z: radius,
						transformOrigin: '50% 50% -' + radius + 'px',
						position: 'absolute',
						backfaceVisibility: 'visible',
					} );
				} );
				window.gsap.set( wrap, { transformStyle: 'preserve-3d' } );
				window.gsap.to( wrap, {
					rotationY: 360,
					ease: 'none',
					scrollTrigger: { trigger: wrap, start: startStr, end: '+=' + end, scrub: scrub },
				} );
			}
		}

		if ( any ) {
			toVars.scrollTrigger = stConfig;
			window.gsap.fromTo( wrap, fromVars, toVars );
		} else if ( sticky ) {
			// Pin-only frame (no property animation).
			try { window.ScrollTrigger.create( stConfig ); } catch ( e ) {}
		}
	}

	// Advanced (tp_custom) = a repeater of frames; each frame is an independent
	// scroll-scrubbed effect on the element, so multiple frames stack.
	function playCustom( wrap, opt ) {
		if ( ! gsapReady() || ! window.ScrollTrigger ) { return; }
		var frames = Array.isArray( opt.frames ) ? opt.frames : ( opt.m_opacity ? [ opt ] : [] );
		frames.forEach( function ( f ) { if ( f ) { playFrame( wrap, f ); } } );
	}

	function animate( el ) {
		if ( ! el || el.classList.contains( DONE ) ) { return; }
		var raw = el.getAttribute( 'data-tp-gsap' );
		if ( ! raw ) { return; }
		var opt;
		try { opt = JSON.parse( raw ); } catch ( e ) { return; }
		if ( ! opt || 'none' === opt.type || ! opt.type ) { return; }
		el.classList.add( DONE );
		// Small tick so the node is laid out before we read/animate it.
		setTimeout( function () {
			if ( 'tp_custom' === opt.type ) { playCustom( el, opt ); }
			else { play( el, opt ); }
		}, 60 );
	}

	function run( root ) {
		var scope = ( root && root.querySelectorAll ) ? root : document;
		// Wait for gsap if it hasn't loaded yet (editor preview load-order safety).
		whenGsap( function () {
			// Editor re-renders a widget on every edit, replacing its DOM node. The
			// ScrollTriggers bound to the OLD node aren't auto-removed, so they pile
			// up and fight the fresh ones — kill any whose trigger has left the DOM.
			if ( window.ScrollTrigger && window.ScrollTrigger.getAll ) {
				window.ScrollTrigger.getAll().forEach( function ( st ) {
					try { if ( st.trigger && ! document.contains( st.trigger ) ) { st.kill(); } } catch ( e ) {}
				} );
			}
			var nodes = scope.querySelectorAll( SELECTOR );
			Array.prototype.forEach.call( nodes, animate );
			// The editor lays out asynchronously, so trigger positions can be stale
			// the instant we bind — recompute once things settle.
			if ( window.ScrollTrigger && window.ScrollTrigger.refresh ) {
				setTimeout( function () { try { window.ScrollTrigger.refresh(); } catch ( e ) {} }, 150 );
			}
		} );
	}

	function init() {
		try {
			if ( window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) { return; }
		} catch ( e ) {}
		run( document );
		bindEditor();
	}

	// In the Elementor editor widgets (re)render via AJAX on every setting change —
	// re-scan the re-rendered element so the animation replays as the user tweaks
	// it. A re-rendered node is fresh (no DONE marker), so it animates again.
	var editorBound = false;
	function bindEditor() {
		if ( editorBound ) { return; }
		if ( ! ( window.elementorFrontend && window.elementorFrontend.hooks ) ) { return; }
		editorBound = true;
		var onReady = function ( $scope ) {
			var el = ( $scope && $scope[ 0 ] ) ? $scope[ 0 ] : $scope;
			if ( el && el.querySelectorAll ) { run( el ); }
		};
		try {
			[ 'global', 'widget', 'container', 'section', 'column' ].forEach( function ( t ) {
				window.elementorFrontend.hooks.addAction( 'frontend/element_ready/' + t, onReady );
			} );
		} catch ( e ) {}
	}

	window.UiChemyGsap = { run: run, animate: animate, play: play };

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}

	var tries = 0;
	var iv = setInterval( function () {
		tries++;
		bindEditor();
		if ( editorBound || tries > 20 ) { clearInterval( iv ); }
	}, 300 );
} )();
