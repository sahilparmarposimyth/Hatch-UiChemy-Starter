/**
 * UiChemy Frontend Bridge (Phase F2a)
 *
 * Runs on the live page for logged-in editors. Discovers Composer widgets on the
 * page, lets the user pick one (hover highlight + click), reads its element id +
 * rendered HTML, and broadcasts the selection so the composer panel (and later
 * phases) can load/edit that widget's code.
 *
 * Plain browser JS — no build step. The real read/write (server raw_html via
 * REST) and live DOM reflection land in F2b/F2c; this phase proves discovery,
 * selection and the selection event.
 */
(function () {
	"use strict";

	var CFG = (typeof window !== "undefined" && window.uichUiChemyFrontend) || {};
	// Elementor's Composer widget wrapper, or Gutenberg's Composer block —
	// `.wp-block-uichemy-composer` is WordPress's standard auto-generated
	// block class, constant across every instance, so it's the reliable
	// builder-agnostic marker (parallel to WIDGET_MARKER_SELECTOR in
	// composer-pick.jsx).
	// The two legacy Elementor classes are here for the same reason the hidden
	// legacy widget aliases exist: a widget still stored as `proton` (released
	// Protuno) or `composer` / `uichemy-builder` (interim dev names) renders under its own
	// wrapper class, and the picker must recognise it until Uich_Composer_Migration
	// has rewritten that row. Harmless once it has — nothing matches.
	var WIDGET_SELECTOR = ".elementor-widget-uichemy-composer, .elementor-widget-composer, .elementor-widget-proton, .elementor-widget-uichemy-builder, .wp-block-uichemy-composer, .uichemy-bricks-composer";
	var picking = false;
	var selected = null; // { el, elementId, index }
	// Set for exactly one tick after a mousedown commits a pick, so the
	// trailing native `click` (link navigation, button handlers, etc.) that
	// follows the same physical click is swallowed instead of firing on the
	// live page.
	var justPicked = false;

	function log() {
		if (window.console && window.console.log) {
			window.console.log.apply(window.console, ["[UiChemy FE]"].concat([].slice.call(arguments)));
		}
	}

	/** All Composer widgets on the page, in DOM order. */
	function composerWidgets() {
		return Array.prototype.slice.call(document.querySelectorAll(WIDGET_SELECTOR));
	}

	/** Elementor element id for a widget node (data-id on the .elementor-element wrapper). */
	function elementIdFor(node) {
		var wrap = node.closest ? node.closest(".elementor-element[data-id]") : null;
		return wrap ? wrap.getAttribute("data-id") : node.getAttribute("data-id") || "";
	}

	/** Which builder rendered this widget node — 'elementor', 'gutenberg' or 'bricks'. */
	function builderFor(node) {
		if (node.classList && node.classList.contains("wp-block-uichemy-composer")) {
			return "gutenberg";
		}
		if (node.classList && node.classList.contains("uichemy-bricks-composer")) {
			return "bricks";
		}
		return "elementor";
	}

	/**
	 * Per-instance uid for a widget node — extracted from the
	 * `uichemy-composer-<uid>` scope class. BOTH Gutenberg blocks and Bricks
	 * elements carry it (Gutenberg alongside `wp-block-uichemy-composer`, Bricks
	 * alongside `uichemy-bricks-composer`). Server-side this uid is the block's
	 * `uid` attr (Gutenberg) / the element id (Bricks) — the key each builder's
	 * REST get/set matches on.
	 */
	function scopeUidFor(node) {
		var cls = Array.prototype.find.call(node.classList || [], function (c) {
			return /^uichemy-composer-/.test(c);
		});
		return cls ? cls.replace(/^uichemy-composer-/, "") : "";
	}

	/**
	 * Owning post/template id for a widget node. A Composer widget inside a global
	 * header/footer or a loop-item template belongs to THAT template's post, not
	 * the page being viewed — Elementor exposes it as `data-elementor-id` on the
	 * nearest `.elementor` document wrapper. Falls back to the viewed page id
	 * (window.uichUiChemyFrontend.postId, then the WP body `page-id-N` / `postid-N`
	 * class), which covers ordinary in-page widgets and the Gutenberg block
	 * (whose content is saved with the current post).
	 */
	function ownerPostIdFor(w) {
		try {
			var host = w && w.closest ? w.closest(".elementor[data-elementor-id]") : null;
			var id = host ? parseInt(host.getAttribute("data-elementor-id"), 10) : 0;
			if (id) {
				return id;
			}
		} catch (e) {
			/* noop */
		}
		if (CFG && CFG.postId) {
			return CFG.postId;
		}
		var m = /\b(?:page-id|postid)-(\d+)\b/.exec(document.body ? document.body.className : "");
		return m ? parseInt(m[1], 10) : 0;
	}

	// ── minimal styling injected once ──────────────────────────────────────────
	// Same visual language as the in-widget element picker (composer-pick.jsx):
	// hover = solid outline + a faint tinted fill; selected = dashed outline
	// with a positive offset. Picking a whole section on the front end should
	// look and feel identical to picking an element once inside one.
	function injectStyle() {
		if (document.getElementById("uichemy-fe-bridge-style")) {
			return;
		}
		// Canvas selection is ONE colour everywhere: the same pink the editor
		// overlay uses (SELECT_INK in composer-box-overlay.js, and the widget
		// outline in uichemy-composer-editor-helpers.js). This used to be the
		// brand violet #4B22CC, which on a light page read as a near-black dash
		// and clashed with the pink ring drawn over the same element.
		var css =
			".uichemy-fe-hover{outline:1px solid #EC0868 !important;outline-offset:0 !important;" +
			"cursor:crosshair !important;}" +
			".uichemy-fe-selected{outline:1px dashed #EC0868 !important;outline-offset:3px !important;}" +
			".uichemy-fe-picking *{cursor:crosshair !important;}" +
			// Admin-bar "Pick UiChemy" pressed state (toolbar on).
			"#wp-admin-bar-uichemy-pick.uichemy-pick-on > .ab-item{background:#4B22CC !important;color:#fff !important;}";
		var style = document.createElement("style");
		style.id = "uichemy-fe-bridge-style";
		style.textContent = css;
		document.head.appendChild(style);
	}

	// ── hover box overlay ────────────────────────────────────────────────────────
	// A fixed-position highlight box tracking the hovered element's bounds. The
	// `.uichemy-fe-hover` class already outlines the element, but that outline is
	// clipped by any ancestor with `overflow:hidden` (common on real sections);
	// this overlay lives in a fixed top layer so it stays fully visible. Kept
	// border-only so it reinforces — rather than doubles — the class's tinted fill.
	var _feBoxOverlay = null;
	function drawBoxOverlayFE(doc, target) {
		if (!doc || !target || !target.getBoundingClientRect) {
			return;
		}
		if (!_feBoxOverlay || _feBoxOverlay.ownerDocument !== doc) {
			_feBoxOverlay = doc.createElement("div");
			_feBoxOverlay.id = "uichemy-fe-box-overlay";
			_feBoxOverlay.setAttribute("aria-hidden", "true");
			_feBoxOverlay.style.cssText =
				"position:fixed;z-index:2147483646;pointer-events:none;display:none;" +
				"border:2px solid #4B22CC;box-sizing:border-box;border-radius:2px;";
			(doc.body || doc.documentElement).appendChild(_feBoxOverlay);
		}
		var r = target.getBoundingClientRect();
		_feBoxOverlay.style.display = "block";
		_feBoxOverlay.style.left = r.left + "px";
		_feBoxOverlay.style.top = r.top + "px";
		_feBoxOverlay.style.width = r.width + "px";
		_feBoxOverlay.style.height = r.height + "px";
	}
	function clearBoxOverlayFE() {
		if (_feBoxOverlay) {
			_feBoxOverlay.style.display = "none";
		}
	}

	// ── picking interaction ─────────────────────────────────────────────────────
	function onOver(e) {
		if (!picking) {
			return;
		}
		var w = e.target.closest(WIDGET_SELECTOR);
		clearHover();
		if (w) {
			// Highlight the exact ELEMENT under the cursor, not the whole
			// widget — the click already resolves to that element (via
			// `clickedNode`), so the hover must promise the same granularity.
			// Highlighting the whole section here made the first pick read as
			// "select the widget first, then pick elements inside" even though
			// one click was enough.
			e.target.classList.add("uichemy-fe-hover");
			drawBoxOverlayFE(document, e.target);
		}
	}

	function clearHover() {
		var prev = document.querySelectorAll(".uichemy-fe-hover");
		Array.prototype.forEach.call(prev, function (n) {
			n.classList.remove("uichemy-fe-hover");
		});
		clearBoxOverlayFE(document);
	}

	// Commit on `mousedown` (capture), not `click`: a native `click` event only
	// fires when the browser judges mousedown+mouseup as a "clean" click on the
	// same target — on a real published page, hover animations, sliders, and
	// other interactive widgets can shift the DOM between press and release, so
	// `click` can silently fail to fire at all, requiring a second attempt.
	// `mousedown` always fires immediately and unconditionally on first press,
	// matching the same approach already used by the Elementor-editor and Chat
	// pickers (composer-pick.jsx).
	function onMouseDown(e) {
		if (!picking) {
			return;
		}
		var w = e.target.closest(WIDGET_SELECTOR);
		if (!w) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		justPicked = true;
		// Carry the exact clicked node along too — the composer uses it to
		// select that specific element once the widget's editor loads, so
		// picking never feels like a separate "select the section" step
		// followed by a second "now pick the element" step.
		selectWidget(w, e.target);
		// Stays armed: the toolbar's pick button is a MODE, lit until the user
		// presses it again (or Escape), so several elements can be picked in a
		// row. The panel's own `picking` flag is left alone for the same reason
		// (see the frontendState.pickedNode effect in composer-app.jsx) — the
		// two must agree or the button lights while the page has no crosshair.
		//
		// This handler runs on every armed click inside a widget, same-section
		// ones included, and routes all of them through selectWidget() — which
		// carries the pending-path retry. That matters: the in-widget path in
		// usePickMode has no such retry and silently drops picks whose layer
		// tree has not settled yet, which is why this used to disarm here.
	}

	// Swallows the native `click` that immediately follows a mousedown-committed
	// pick, so the page's own click handling (link navigation, button actions
	// under the pointer) doesn't also fire.
	function onClick(e) {
		if (!justPicked) {
			return;
		}
		justPicked = false;
		e.preventDefault();
		e.stopPropagation();
	}

	/**
	 * @param {Element}  w           Composer widget to load.
	 * @param {Element=} clickedNode Exact element the user clicked, if any.
	 * @param {{silent?: boolean}=} opts
	 *        `silent` marks the load-time preload — a selection the user did not
	 *        ask for. The panel stages it in the background: no drawer pops open
	 *        and no outline is painted over a page they may only be reading.
	 */
	function selectWidget(w, clickedNode, opts) {
		var silent = !!(opts && opts.silent);
		if (selected && selected.el) {
			selected.el.classList.remove("uichemy-fe-selected");
		}
		var all = composerWidgets();
		var index = all.indexOf(w);
		var elementId = elementIdFor(w);
		var builder = builderFor(w);
		var uid = ("gutenberg" === builder || "bricks" === builder) ? scopeUidFor(w) : "";
		if (!silent) {
			w.classList.add("uichemy-fe-selected");
		}

		selected = { el: w, elementId: elementId, index: index, builder: builder, uid: uid };

		var detail = {
			// Resolved per-widget, NOT always the page being viewed — a Composer
			// widget inside a global header/footer (or a loop-item template)
			// belongs to that template's own post. Using the page id there
			// 404s the REST lookup with "No Composer widget with id … on this post."
			postId: ownerPostIdFor(w),
			elementId: elementId,
			index: index,
			html: w.innerHTML,
			builder: builder,
			uid: uid,
			// The exact element under the cursor. The panel resolves it to a layer
			// path once the widget's tree loads, so ONE click both opens the widget
			// and selects what was clicked. Without it the panel falls back to the
			// widget's first layer and picking reads as two steps: "select the
			// section", then "now pick the element inside it".
			node: clickedNode || null,
			// Load-time preload rather than a user pick — see selectWidget().
			silent: silent,
		};
		log("selected widget", detail.elementId, "index", detail.index, "html chars", (detail.html || "").length);
		clearBoxOverlayFE(document);

		try {
			window.dispatchEvent(new CustomEvent("uichemy:frontend:widget-selected", { detail: detail }));
		} catch (err) {
			/* older browsers */
		}
	}

	function startPicking() {
		picking = true;
		document.body.classList.add("uichemy-fe-picking");
	}

	function stopPicking() {
		picking = false;
		document.body.classList.remove("uichemy-fe-picking");
		clearHover();
	}

	/**
	 * Select the first Composer widget on the page programmatically (same path as a
	 * user click). Used by the composer's "open panel" action when nothing is
	 * loaded yet, so the drawer has a widget to open with instead of looking dead.
	 * Returns true if a widget was found and selected.
	 */
	function selectFirst(opts) {
		var all = composerWidgets();
		if (!all.length) {
			return false;
		}
		selectWidget(all[0], null, opts);
		return true;
	}

	// ── switch mode: hover another section, click to jump to it ─────────────────
	// Armed by the panel while it is open (see setSwitchMode). Deliberately narrow:
	// it reacts ONLY to widgets other than the one already loaded, so clicks inside
	// the section being edited — and everywhere else on the page — behave normally.
	// The section code is already cached by then, so the jump costs no request.
	var switchMode = false;

	/**
	 * The element under the pointer, when it sits inside ANY Composer section
	 * (never a section wrapper itself).
	 *
	 * Deliberately blind to which section is loaded: hovering and clicking read
	 * the same everywhere on the page. Outlining a whole OTHER section — what
	 * this used to do — promised section-level granularity the click no longer
	 * has, since a click now resolves to the exact element under the cursor.
	 */
	function pickTargetFrom(target) {
		if (!target || !target.closest) {
			return null;
		}
		var w = target.closest(WIDGET_SELECTOR);
		if (!w || target === w) {
			return null;
		}
		return target;
	}

	function onSwitchOver(e) {
		if (!switchMode || picking) {
			return;
		}
		clearHover();
		var t = pickTargetFrom(e.target);
		if (t) {
			t.classList.add("uichemy-fe-hover");
			drawBoxOverlayFE(document, t);
		}
	}

	function onSwitchDown(e) {
		// `picking` owns the pointer when armed — let the element picker run.
		if (!switchMode || picking || (e.button !== undefined && e.button !== 0)) {
			return;
		}
		var t = pickTargetFrom(e.target);
		if (!t) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		justPicked = true; // swallow the trailing click on the live page
		clearHover();
		selectWidget(t.closest(WIDGET_SELECTOR), t);
	}

	/**
	 * Turn section-switching on or off. The panel calls this as it opens/closes:
	 * while it is shut the page must behave like an ordinary page.
	 */
	function setSwitchMode(on) {
		switchMode = !!on;
		if (!switchMode) {
			clearHover();
		}
	}

	/** De-duplicated owner post ids for every Composer widget on the page. */
	function ownerPostIds() {
		var ids = [];
		composerWidgets().forEach(function (w) {
			var pid = ownerPostIdFor(w);
			if (pid && ids.indexOf(pid) === -1) {
				ids.push(pid);
			}
		});
		return ids;
	}

	// Public API for later phases + a keyboard/event trigger for F2a testing.
	window.UiChemyFrontend = {
		widgets: composerWidgets,
		// Pull-based twin of the `widgets-discovered` event, so a panel that
		// mounted after the event fired can still warm its cache.
		ownerPostIds: ownerPostIds,
		// Armed by the panel while it is open — hover another section, click to jump.
		setSwitchMode: setSwitchMode,
		getSelected: function () {
			return selected;
		},
		selectFirst: selectFirst,
		// Programmatically select the Composer widget containing `node` (same path
		// as a user click). Used by the composer's in-widget picker to switch to
		// a different section without dropping back to whole-page pick mode.
		selectNode: function (node) {
			var w = node && node.closest ? node.closest(WIDGET_SELECTOR) : null;
			if (!w) {
				return false;
			}
			// Forward the node so switching widgets lands on the clicked element
			// too, exactly like a first pick does.
			selectWidget(w, node);
			return true;
		},
		startPicking: startPicking,
		stopPicking: stopPicking,
	};

	/**
	 * Bind the WordPress admin-bar "Pick UiChemy" node. It is an on/off switch
	 * for the floating canvas toolbar: the toolbar is hidden on page load and
	 * slides up from the bottom on the first click. Actual widget picking is
	 * started from the toolbar's cursor button, not from here.
	 */
	function bindAdminBar() {
		var toolbarOn = false;
		// Delegate so it works regardless of admin-bar render timing.
		document.addEventListener(
			"click",
			function (e) {
				var node = e.target.closest ? e.target.closest("#wp-admin-bar-uichemy-pick") : null;
				if (!node) {
					return;
				}
				e.preventDefault();
				toolbarOn = !toolbarOn;
				node.classList.toggle("uichemy-pick-on", toolbarOn);
				// Turning the toolbar off also cancels any in-progress picking.
				if (!toolbarOn && picking) {
					stopPicking();
				}
				window.dispatchEvent(
					new CustomEvent("uichemy:frontend:toggle-toolbar", {
						detail: { on: toolbarOn },
					}),
				);
			},
			false,
		);
	}

	function init() {
		injectStyle();
		document.addEventListener("mouseover", onOver, true);
		document.addEventListener("mousedown", onMouseDown, true);
		document.addEventListener("click", onClick, true);

		// Section switching (armed only while the panel is open).
		document.addEventListener("mouseover", onSwitchOver, true);
		document.addEventListener("mousedown", onSwitchDown, true);

		// Let the composer panel (or a toolbar button) start picking via event.
		window.addEventListener("uichemy:frontend:start-pick", startPicking);

		bindAdminBar();

		var count = composerWidgets().length;
		log("ready — " + count + ' Composer widget(s). Use the "Pick UiChemy" button in the top admin bar.');

		// Tell the panel which posts own the widgets on this page so it can warm its
		// section cache in one request per owner. Widgets inside a global
		// header/footer belong to that template's post, not the page being viewed,
		// hence the de-duplicated list rather than a single id.
		if (count) {
			try {
				window.dispatchEvent(
					new CustomEvent("uichemy:frontend:widgets-discovered", { detail: { postIds: ownerPostIds() } })
				);
			} catch (err) {
				/* older browsers — the cache simply stays cold */
			}

			// Stage the first section so the panel has something to show the moment
			// it is opened — no pick step. Silent: nothing opens, nothing is
			// outlined, until the user actually asks for the editor.
			selectFirst({ silent: true });
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
