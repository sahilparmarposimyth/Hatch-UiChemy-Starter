<?php
/**
 * Composer — Bricks Builder element.
 *
 * UNVERIFIED INTEGRATION. Written without access to Bricks core (only a
 * third-party Bricks addon, "Bricks Advanced Themer", was available as a
 * reference for the real element API). The render() path reuses the same
 * shared, already-proven UiChemy_Composer_Renderer used by the Elementor
 * widget and Gutenberg block, so front-end output should be correct. The
 * builder-side editing UI (opening the floating panel from inside a Bricks
 * element's settings panel) has NOT been tested against a real Bricks
 * install — see assets/js/uichemy-composer-bricks-adapter.js's header
 * comment for the part most likely to need fixing once Bricks is available.
 *
 * This file is deliberately NEVER `require`d directly by this plugin's own
 * bootstrap (unlike the Gutenberg block's class). It's only ever included by
 * Bricks itself, via \Bricks\Elements::register_element() in
 * class-uichemy-bricks-loader.php — mirroring the verified real-world
 * pattern from the reference addon's own elements/*.php files, which are
 * likewise plain top-level class definitions with no include-time guards,
 * because Bricks controls exactly when it's safe to include them (Bricks is
 * a THEME, so \Bricks\Element doesn't exist until well after this plugin's
 * own early bootstrap runs — see the loader file for why that matters).
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class UiChemy_Bricks_Composer extends \Bricks\Element {

	/** @var string Bricks element category (shows in the builder's element panel). */
	public $category = 'general';

	/** @var string Unique element slug. Prefixed per Bricks convention. */
	public $name = 'uichemy-composer';

	/**
	 * Bricks renders the element icon as `<i class="{$icon}">`, so this is a CSS
	 * class, not a path. It used to be Themify's generic `ti-code`; it is now our
	 * own class, whose ::before draws the UiChemy mark from a CSS mask — the same
	 * one the Elementor widget panel uses, so all three builders show one logo.
	 *
	 * The stylesheet that defines it (assets/css/uichemy-composer-editor-panel.css)
	 * is already enqueued into the Bricks builder by
	 * UiChemy_Composer_Enqueue::enqueue_bricks_editor_script().
	 */
	public $icon = 'uichemy-composer-icon';

	/** @var string Default CSS selector Bricks scopes element-level style controls to. */
	public $css_selector = '';

	/**
	 * White-label the element icon (parity with the Elementor widget's get_icon()
	 * and the Gutenberg block). When white-labeling is enabled and a Dashicons
	 * icon is chosen in the plugin settings, override the default Themify class
	 * with that dashicons class — the dashicons font is enqueued into the Bricks
	 * builder in UiChemy_Composer_Composer_Enqueue::enqueue_bricks_editor_script()
	 * so the glyph renders. UNVERIFIED against real Bricks core (no test env);
	 * best-effort, consistent with this file's header caveat.
	 *
	 * @param array|null $element Bricks element instance data.
	 */
	public function __construct( $element = null ) {
		parent::__construct( $element );

		// Pro-gated read. get_option() would keep a site that configured White Label
		// under Pro white-labelled after downgrading, with no UI left to undo it.
		$wl = function_exists( 'uich_brand_wl' ) ? uich_brand_wl() : array();

		if ( ! empty( $wl['widget_icon'] ) ) {
			$this->icon = 'dashicons ' . sanitize_html_class( $wl['widget_icon'] );
			return;
		}

		// A brand logo with no dashicon picked. Bricks takes a class, not a URL, so
		// the logo arrives through the modifier rule added by
		// UiChemy_Composer_Enqueue::add_wl_icon_css().
		if ( ! empty( $wl['logo_url'] ) ) {
			$this->icon = 'uichemy-composer-icon uichemy-composer-icon--wl';
		}
	}

	public function get_label() {
		// White-label the element label — parity with the Elementor widget's
		// get_title() and the Gutenberg block title (widget_name → plugin_name →
		// default). Bricks' element category is a fixed builtin slug ('general')
		// and is intentionally left unchanged. UNVERIFIED against real Bricks core.
		$wl = function_exists( 'uich_brand_wl' ) ? uich_brand_wl() : array();
		if ( ! empty( $wl['widget_name'] ) ) {
			return esc_html( $wl['widget_name'] );
		}
		if ( ! empty( $wl['plugin_name'] ) ) {
			return esc_html( $wl['plugin_name'] );
		}
		return esc_html__( 'Composer', 'uichemy' );
	}

	/**
	 * One control group. All authoring happens in the shared floating panel
	 * (Editor/Code/Chat), not through individual Bricks fields, so this group
	 * only needs to hold the raw settings blob + a launcher control.
	 */
	public function set_control_groups() {
		$this->control_groups['uichemy'] = array(
			'title' => esc_html__( 'Composer', 'uichemy' ),
			'tab'   => 'content',
		);
	}

	public function set_controls() {
		// The actual "Edit Code" / "Edit with AI" buttons are injected into this
		// control's DOM location by uichemy-composer-bricks-adapter.js — reusing
		// the plugin's existing pattern of injecting buttons into a known DOM
		// anchor via JS, rather than a Bricks-native button-control type, since
		// that hasn't been verified against real Bricks core.
		$this->controls['uichemy_launcher'] = array(
			'tab'     => 'content',
			'group'   => 'uichemy',
			'type'    => 'info',
			'content' => '<div class="uichemy-bricks-launcher" data-uichemy-element-id="">'
				. esc_html__( 'Loading Composer…', 'uichemy' )
				. '</div>',
		);

		// Per-slot "Text N / Image N" fields, using Bricks' OWN native text/image
		// control types (not a custom-rendered UI) — mirrors exactly how the
		// Elementor widget does this (class-uichemy-composer-widget.php:
		// register_controls(), a fixed 20-slot loop gated by 'condition'/hidden
		// flag controls). uichemy-composer-bricks-adapter.js keeps these in sync
		// with raw_html (parsed via the shared assets/js/uichemy-composer-slots.js)
		// in both directions; render() below merges them back into raw_html at
		// render time via UiChemy_Composer_Renderer's existing, already-tested
		// slot-merge (the same mechanism Elementor's own render() relies on —
		// see includes/admin/widgets/class-uichemy-composer-renderer.php:160-167,
		// which unconditionally walks raw_html and applies any slot_{i}* settings
		// it's given, doing nothing when none are present).
		for ( $i = 0; $i < 20; $i++ ) {
			// Hidden bookkeeping flags — not shown to the user, only used to gate
			// the two visible controls' 'required' conditions. Kept as real
			// checkbox controls (Bricks has no true "hidden" control type) and
			// visually hidden via a small CSS rule injected by the adapter.
			$this->controls[ "uichemy_slot_{$i}_visible" ]  = array(
				'tab'   => 'content',
				'group' => 'uichemy',
				'type'  => 'checkbox',
				'class' => 'uichemy-slot-flag',
			);
			$this->controls[ "uichemy_slot_{$i}_is_image" ] = array(
				'tab'   => 'content',
				'group' => 'uichemy',
				'type'  => 'checkbox',
				'class' => 'uichemy-slot-flag',
			);

			$this->controls[ "uichemy_slot_{$i}_text" ] = array(
				'tab'      => 'content',
				'group'    => 'uichemy',
				'label'    => sprintf( esc_html__( 'Text %d', 'uichemy' ), $i + 1 ),
				'type'     => 'text',
				'required' => array(
					array( "uichemy_slot_{$i}_visible", '!=', '' ),
					array( "uichemy_slot_{$i}_is_image", '=', '' ),
				),
			);

			$this->controls[ "uichemy_slot_{$i}_image" ] = array(
				'tab'      => 'content',
				'group'    => 'uichemy',
				'label'    => sprintf( esc_html__( 'Image %d', 'uichemy' ), $i + 1 ),
				'type'     => 'image',
				'required' => array(
					array( "uichemy_slot_{$i}_visible", '!=', '' ),
					array( "uichemy_slot_{$i}_is_image", '!=', '' ),
				),
			);
		}

		// Single JSON blob holding {raw_html, raw_css, raw_js, slots, deps,
		// css_unscoped} — the exact same shape as the Gutenberg block's
		// `settings` attribute and the Elementor widget's settings map. The
		// floating panel's JS writes here directly (see the adapter) rather
		// than through individual Bricks fields, so all three builders share
		// one data model end to end.
		$this->controls['uichemy_settings'] = array(
			'tab'     => 'content',
			'group'   => 'uichemy',
			'type'    => 'textarea',
			'default' => '{}',
		);
	}

	// No enqueue_scripts() override: the shared panel assets are loaded
	// builder-wide (any time bricks_is_builder() is true), not per-element —
	// see UiChemy_Composer_Enqueue::enqueue_bricks_editor_script(), hooked on
	// `get_footer` in the plugin's main enqueue class.

	/**
	 * Server render callback. Delegates to the exact same shared renderer the
	 * Elementor widget and Gutenberg block use, so output is byte-identical
	 * regardless of which builder authored the content.
	 */
	public function render() {
		$raw      = isset( $this->settings['uichemy_settings'] ) ? (string) $this->settings['uichemy_settings'] : '{}';
		$settings = json_decode( $raw, true );
		$settings = is_array( $settings ) ? $settings : array();

		if ( empty( $settings['raw_html'] ) ) {
			// Helpers::get_element_placeholder() outputs 'title' unescaped (same
			// trust boundary as the 'uichemy_launcher' info control above), so a
			// real button can live here instead of plain instructional text — the
			// only other way to reach the Composer panel was the "Edit" button
			// buried in the sidebar's "Composer" control group, which
			// isn't visible until that group is expanded. This button is rendered
			// INSIDE Bricks' canvas preview iframe (this whole branch only ever
			// runs in the builder — render_element_placeholder() itself no-ops on
			// the frontend, see is_frontend check in Bricks' own Element::
			// render_element_placeholder()), while the shared floating Composer
			// panel lives in the PARENT frame's DOM — uichemy-composer-bricks-
			// adapter.js bridges the two via `window.UiChemyBricksCanvasOpen`,
			// called on `window.top` from decorateCanvasButtons() (iframe side).
			$cta = '<div class="uichemy-bricks-canvas-cta">'
				. '<p style="margin:0 0 12px;">' . esc_html__( 'Add HTML/CSS/JS via the UiChemy panel to render this element.', 'uichemy' ) . '</p>'
				. '<button type="button" class="uichemy-bricks-canvas-edit-btn" data-uichemy-element-id="' . esc_attr( $this->id ) . '" '
				. 'style="padding:8px 22px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;">'
				. esc_html__( 'Open Composer', 'uichemy' )
				. '</button>'
				. '</div>';

			return $this->render_element_placeholder( array( 'title' => $cta ) );
		}

		if ( ! class_exists( 'UiChemy_Composer_Renderer' ) ) {
			require_once UICHEMY_PATH . 'includes/admin/widgets/class-uichemy-composer-renderer.php';
		}

		$uid   = sanitize_html_class( (string) $this->element['id'] );
		$scope = '.uichemy-composer-' . $uid;

		// `$this->is_frontend` (bricks_is_frontend()) alone is NOT enough: it's
		// only based on `$_GET['bricks']`, which is absent when Bricks re-renders
		// this element via its OWN AJAX endpoint (`wp_ajax_bricks_render_element`)
		// while the user is actively editing in the canvas — confirmed by reading
		// \Bricks\Builder::is_builder_call() (functions.php's bricks_is_builder_call()
		// wraps it), which checks a SEPARATE signal for exactly that AJAX case
		// (`$_REQUEST['bricks-is-builder']` alongside a builder-specific nonce, or
		// the `X-Bricks-Is-Builder` header for REST calls) that bricks_is_frontend()
		// never looks at.
		$is_builder_context = ! $this->is_frontend
			|| ( function_exists( 'bricks_is_builder_call' ) && bricks_is_builder_call() );

		$raw_js          = isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '';
		$render_settings = $settings;
		if ( ! $is_builder_context ) {
			// Front end only: raw_js is injected once via wp_footer below (after
			// all page dependencies have loaded), not inline through the
			// renderer's own <script> emission — keeping it out of
			// $render_settings here stops render_html() from ALSO emitting it
			// inline, which would run it twice on the front end.
			unset( $render_settings['raw_js'] );
		}

		// Merge the native Bricks per-slot controls (uichemy_slot_{i}_*) into the
		// bare slot_{i}_* keys UiChemy_Composer_Renderer already knows how to
		// apply (same mechanism the Elementor widget uses) — this is what makes
		// edits made through Bricks' own text/image controls actually reach the
		// rendered HTML, since those controls can only write to their own
		// top-level Bricks settings keys, never into the uichemy_settings JSON
		// blob directly.
		for ( $i = 0; $i < 20; $i++ ) {
			if ( empty( $this->settings[ "uichemy_slot_{$i}_visible" ] ) ) {
				continue;
			}
			if ( ! empty( $this->settings[ "uichemy_slot_{$i}_is_image" ] ) ) {
				$render_settings[ "slot_{$i}_is_image" ] = 'yes';
				$image                                   = isset( $this->settings[ "uichemy_slot_{$i}_image" ] ) ? $this->settings[ "uichemy_slot_{$i}_image" ] : array();
				$image                                   = is_array( $image ) ? $image : array();
				// Bricks' native image control stores {id, size, ...} and only
				// resolves `url` at its OWN render time (wp_get_attachment_image_url),
				// it isn't necessarily persisted — resolve it here the same way so
				// UiChemy_Composer_Renderer::get_media_url_from_setting(), which only
				// reads $setting['url'], has something to find.
				if ( empty( $image['url'] ) && ! empty( $image['id'] ) ) {
					$resolved = wp_get_attachment_image_url( (int) $image['id'], ! empty( $image['size'] ) ? $image['size'] : 'full' );
					if ( $resolved ) {
						$image['url'] = $resolved;
					}
				}
				$render_settings[ "slot_{$i}_image" ] = $image;
			} else {
				$render_settings[ "slot_{$i}" ] = isset( $this->settings[ "uichemy_slot_{$i}_text" ] )
					? (string) $this->settings[ "uichemy_slot_{$i}_text" ]
					: '';
			}
		}

		$raw_html    = (string) $render_settings['raw_html'];
		$had_dynamic = class_exists( 'Uich_Dynamic' ) && Uich_Dynamic::has_dynamic( $raw_html );
		if ( $had_dynamic ) {
			$render_settings['raw_html'] = Uich_Dynamic::render_html( $raw_html, array( 'widget_id' => $uid ) );
			foreach ( array_keys( $render_settings ) as $k ) {
				if ( 0 === strpos( $k, 'slot_' ) ) {
					unset( $render_settings[ $k ] );
				}
			}
		}

		$scope_css = empty( $settings['css_unscoped'] );

		// `uichemy-bricks-composer` is the CONSTANT marker the front-end picker keys
		// on (uichemy-frontend-bridge.js WIDGET_SELECTOR / builderFor) — the
		// per-instance `uichemy-composer-<uid>` scope class alone can't distinguish
		// a Bricks composer from a Gutenberg one, which carries the same pattern.
		$this->set_attribute( '_root', 'class', array( 'uichemy-bricks-composer', 'uichemy-composer-' . $uid ) );

		// $obfuscate_scripts=true only in the builder (never the front end, where
		// there's no adapter script loaded to revive an obfuscated <script> tag —
		// see UiChemy_Composer_Renderer::render()'s matching parameter doc for why
		// Bricks specifically needs this and Elementor/Gutenberg don't). Without
		// this, every canvas AJAX re-render was silently falling through to the
		// "front end" branch and emitting a plain <script> tag — Bricks' own
		// extraction logic would then strip it before it ever mounts (see the
		// JS-side comment on $obfuscate_scripts for what that breaks).
		$html = UiChemy_Composer_Renderer::render_html( $render_settings, $scope, $uid, false, $scope_css, $is_builder_context );

		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo "<div {$this->render_attributes( '_root' )}>" . $html . '</div>';

		if ( ! $is_builder_context && '' !== trim( $raw_js ) ) {
			add_action(
				'wp_footer',
				function () use ( $uid, $raw_js ) {
					$safe_js = preg_replace( '#</(script)#i', '<\\\\/$1', $raw_js );
					echo "\n<script id=\"uichemy-composer-js-" . esc_attr( $uid ) . '" data-cfasync="false" data-no-optimize="1">';
					// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					echo $safe_js;
					echo "</script>\n";
				},
				20
			);
		}
	}
}
