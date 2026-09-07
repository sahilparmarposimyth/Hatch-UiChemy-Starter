<?php
/**
 * Loads the Composer composer editor JavaScript and CSS in the Elementor editor.
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    UiChemy
 */

/**
 * Exit if accessed directly.
 * */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Composer_Enqueue' ) ) {

	/**
	 * Enqueues the Composer editor panel + React composer assets.
	 */
	class UiChemy_Composer_Enqueue {

		/**
		 * Initialize the class and set its properties.
		 *
		 * @since   1.0.0
		 */
		public function __construct() {
			add_action( 'elementor/editor/after_enqueue_scripts', array( $this, 'enqueue_composer_editor_script' ) );

			add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_gutenberg_composer_editor_script' ) );
			// Bricks' builder is a front-end template rather than a wp-admin screen,
			// so it has no editor-scripts action to hook directly — bricks_is_builder()
			// gates this on every front-end footer instead (verified pattern from a
			// real third-party Bricks addon). See includes/bricks/ for the rest of the
			// (unverified against real Bricks core) integration.
			add_action( 'get_footer', array( $this, 'enqueue_bricks_editor_script' ) );

			// Frontend editor (Phase F1): show the same composer panel on the
			// live page for logged-in editors/admins.
			//
			// Priority 100 so the composer's CSS is enqueued (and printed) AFTER the
			// active theme's stylesheets. On the front end the panel shares the
			// document with the theme, whose global reset (e.g. Hello Elementor
			// reset.css) styles attribute/bare selectors like `[type=button]` and
			// `input[type=text]` at specificity (0,1,0) — the same as the composer's
			// Tailwind utilities. When the theme loaded last it won those ties (pink
			// button borders, wrong padding, collapsed flex rows, etc.). Loading the
			// composer CSS last makes its own rules win, matching the Elementor editor.
			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_frontend_editor' ), 100 );
			add_action( 'wp_footer', array( $this, 'render_frontend_panel_root' ), 100 );
			add_filter( 'body_class', array( $this, 'frontend_body_class' ) );

			// GSAP animation (Phase 1): load GSAP + runtime inside the Elementor
			// preview iframe so `data-tp-gsap` animations preview while editing. The
			// runtime re-runs per widget on Elementor's element_ready (see
			// uichemy-gsap.js). Front-end pages load it on demand from the widget.
			add_action( 'elementor/preview/enqueue_scripts', array( $this, 'enqueue_preview_gsap' ) );
			// The design system for the on-canvas toolbar, which renders in THIS
			// document while the panel (and composer.css) lives in the editor window.
			add_action( 'elementor/preview/enqueue_scripts', array( $this, 'enqueue_preview_canvas_css' ) );
			// NOTE: the old "Pick UiChemy" admin-bar node was removed — picking is
			// now driven entirely by the floating radial action button (FAB) that the
			// React composer renders over the canvas, on both the editor and the
			// live front end.
		}

		/**
		 * Enqueue the Composer composer assets inside the Gutenberg block editor.
		 *
		 * Loads the same builder-agnostic panel scripts + React composer bundle that
		 * the Elementor editor uses, plus the dynamic-data (Twig) picker, the
		 * Gutenberg glue adapter, and the block's editor script.
		 *
		 * @return void
		 */
		public function enqueue_gutenberg_composer_editor_script() {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return;
			}

			$html_editor_settings = wp_enqueue_code_editor( array( 'type' => 'text/html' ) );
			$css_editor_settings  = wp_enqueue_code_editor( array( 'type' => 'text/css' ) );
			$js_editor_settings   = wp_enqueue_code_editor( array( 'type' => 'application/javascript' ) );

			wp_enqueue_style( 'wp-codemirror' );
			wp_enqueue_style( 'code-editor' );
			wp_enqueue_script( 'code-editor' );
			wp_enqueue_script( 'wp-theme-plugin-editor' );

			$panel_css = UICHEMY_PATH . 'assets/css/uichemy-composer-editor-panel.css';
			wp_enqueue_style(
				'uichemy-composer-editor-panel',
				UICHEMY_URL . 'assets/css/uichemy-composer-editor-panel.css',
				array(),
				file_exists( $panel_css ) ? filemtime( $panel_css ) : UICHEMY_VERSION
			);
			self::add_wl_icon_css( 'uichemy-composer-editor-panel' );

			$js_base = UICHEMY_PATH . 'assets/js/';
			wp_enqueue_script(
				'uichemy-composer-editor-registry',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-registry.js',
				array( 'jquery' ),
				filemtime( $js_base . 'uichemy-composer-editor-registry.js' ),
				true
			);

			$panel_html_path = UICHEMY_PATH . 'assets/html/uichemy-composer-editor-panel.html';
			$panel_html      = '';
			if ( is_readable( $panel_html_path ) ) {
				$panel_html = file_get_contents( $panel_html_path );
				if ( ! is_string( $panel_html ) ) {
					$panel_html = '';
				}
			}
			$panel_html = self::brand_panel_html( $panel_html );

			// Was three byte-identical copies of the same array. One builder now,
			// and it is empty unless a build supplies chat (see get_wp_agent_config).
			$wp_agent_config = $this->get_wp_agent_config();

			// Role Manager flags for the panel (contentOnly + per-feature toggles).
			$access = $this->access_flags();

			wp_localize_script(
				'uichemy-composer-editor-registry',
				'uichComposerEditorCfg',
				array(
					// White Label name + logo for the panel's brand mark. Without it
					// the panel has no branding data at all and paints UiChemy's mark
					// on every white-labelled site.
					'brand'          => self::brand_cfg(),
					'html'           => $html_editor_settings,
					'css'            => $css_editor_settings,
					'js'             => $js_editor_settings,
					'pageCode'       => $html_editor_settings,
					'siteCodeEditor' => $html_editor_settings,
					'ajaxUrl'        => admin_url( 'admin-ajax.php' ),
					'ajaxNonce'      => wp_create_nonce( \UiChemy_Composer_Manager::EDITOR_AJAX_NONCE_ACTION ),
					'siteCode'       => \UiChemy_Composer_Manager::get_site_custom_code_option(),
					'wpAgent'        => $wp_agent_config,
					'panelHtml'      => $panel_html,
					'isPro'          => uichemy_is_pro(),
					'proUrl'         => uichemy_upgrade_url( 'composer' ),
					'proFeatures'    => $this->pro_feature_flags(),
					// Role Manager flags. Without these the panel treats an absent
					// config as "no restrictions", so a content-only role would keep
					// the Code tab in Gutenberg while losing it in Elementor.
					'contentOnly'    => $access['contentOnly'],
					'features'       => $access['features'],
					'editorMode'     => $this->editor_mode(),
					'postId'         => $this->current_editor_post_id(),
					'builder'        => 'gutenberg',
				)
			);

			wp_enqueue_script(
				'uichemy-composer-editor-helpers',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-helpers.js',
				array( 'uichemy-composer-editor-registry', 'code-editor', 'wp-theme-plugin-editor' ),
				filemtime( $js_base . 'uichemy-composer-editor-helpers.js' ),
				true
			);
			wp_enqueue_script(
				'uichemy-composer-editor-panel',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-panel.js',
				array( 'uichemy-composer-editor-helpers' ),
				filemtime( $js_base . 'uichemy-composer-editor-panel.js' ),
				true
			);
			wp_enqueue_script(
				'uichemy-composer-editor',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor.js',
				array( 'jquery', 'uichemy-composer-editor-panel' ),
				filemtime( $js_base . 'uichemy-composer-editor.js' ),
				true
			);
			/**
			 * Let this build add its own editor scripts after the shared panel ones.
			 *
			 * Pro hooks this to enqueue the AI-chat runtime (uichemy-composer-wp-agent.js
			 * + uichemy-composer-chat.js), which Free does not ship at all. Fires in every
			 * builder context, so a listener may depend on 'uichemy-composer-editor'.
			 *
			 * @param string $js_base Absolute path to assets/js/ (for filemtime cache-busting).
			 */
			do_action( 'uichemy/composer/enqueue_editor_scripts', $js_base );

			// React composer bundle (defines window.UichComposerGutenberg).
			$this->enqueue_composer_react();

			// Dynamic-data (Twig) picker: schema + compile + picker + "+ Dynamic"
			// button injector + atom-preview endpoint. Reused verbatim from the
			// Elementor path so tokens/preview are byte-identical.
			if ( class_exists( 'Uich_DD_Enqueue' ) ) {
				\Uich_DD_Enqueue::editor_assets();
			}

			// Gutenberg glue: provides UichSHE.uichOpenComposerTab().
			wp_enqueue_script(
				'uichemy-composer-gutenberg-adapter',
				UICHEMY_URL . 'assets/js/uichemy-composer-gutenberg-adapter.js',
				array( 'uichemy-composer-editor', 'uichemy-composer-composer' ),
				filemtime( $js_base . 'uichemy-composer-gutenberg-adapter.js' ),
				true
			);

			// Shared slot parsing/writing (raw_html -> Text N / Image N fields),
			// used by both this Gutenberg block and the Bricks sidebar UI.
			$slots_js = UICHEMY_PATH . 'assets/js/uichemy-composer-slots.js';
			wp_enqueue_script(
				'uichemy-composer-slots',
				UICHEMY_URL . 'assets/js/uichemy-composer-slots.js',
				array(),
				file_exists( $slots_js ) ? filemtime( $slots_js ) : UICHEMY_VERSION,
				true
			);

			// The block's editor script. Depends on 'uich-dd-picker' because the sidebar's
			// per-slot "Insert dynamic value" button calls window.UichDD.ui.openValue()
			// directly — that must not rely on enqueue call order alone.
			$block_js = UICHEMY_PATH . 'assets/blocks/uichemy-composer/index.js';
			wp_enqueue_script(
				'uichemy-composer-block',
				UICHEMY_URL . 'assets/blocks/uichemy-composer/index.js',
				array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n', 'wp-data', 'uichemy-composer-composer', 'uichemy-composer-gutenberg-adapter', 'uich-dd-picker', 'uichemy-composer-slots' ),
				file_exists( $block_js ) ? filemtime( $block_js ) : UICHEMY_VERSION,
				true
			);

			// White-label block icon + title — parity with the Elementor widget's
			// get_icon() / get_title(). The block's client registration (index.js)
			// reads these to set its inserter / list-view / "Edit …" header icon and
			// label dynamically instead of the hardcoded defaults. (The block
			// CATEGORY heading is white-labeled server-side in
			// UiChemy_Gutenberg_Composer::register_category().)
			$this->localize_block_cfg( 'uichemy-composer-block' );
		}

		/**
		 * Paint an uploaded White Label logo into the widget/element icon.
		 *
		 * Elementor and Bricks both take a CSS CLASS for the icon, never a URL, so
		 * a custom logo can only be delivered as CSS. `.uichemy-composer-icon` draws
		 * our own mark through a mask; the modifier below swaps that mask for the
		 * uploaded image and drops the `currentColor` fill so the artwork keeps its
		 * own colours.
		 *
		 * No-op unless white-labeling is on AND a logo was uploaded AND no dashicon
		 * was picked — in every other case the class is never emitted by get_icon().
		 *
		 * @param string $handle Stylesheet handle to attach the rule to.
		 * @return void
		 */
		private static function add_wl_icon_css( $handle ) {
			$logo = function_exists( 'uich_brand_logo_url' ) ? uich_brand_logo_url() : '';
			if ( '' === $logo ) {
				return;
			}

			wp_add_inline_style(
				$handle,
				'.uichemy-composer-icon--wl::before{'
					. 'background-color:transparent;'
					. '-webkit-mask:none;mask:none;'
					. 'background:url(' . esc_url( $logo ) . ') no-repeat center/contain;'
				. '}'
			);
		}

		/**
		 * Swap the brand mark baked into the panel skeleton for an uploaded logo.
		 *
		 * assets/html/uichemy-composer-editor-panel.html opens with a hardcoded
		 * UiChemy mark. That markup is injected straight into the editor
		 * (uichemy-composer-editor-panel.js sets it as innerHTML), so on a
		 * white-labelled site it painted our logo into the panel header — briefly
		 * even where the React panel later takes the node over.
		 *
		 * Matched on the header wrapper rather than the raw path data so a redesign
		 * of the mark cannot silently un-brand this: if the wrapper is missing the
		 * markup is returned untouched.
		 *
		 * @param string $html Panel markup.
		 * @return string
		 */
		private static function brand_panel_html( $html ) {
			$logo = function_exists( 'uich_brand_logo_url' ) ? uich_brand_logo_url() : '';
			if ( '' === $logo || '' === $html ) {
				return $html;
			}

			$open  = '<div class="uichemy-composer-panel-header-left">';
			$start = strpos( $html, $open );
			if ( false === $start ) {
				return $html;
			}

			$svg_start = strpos( $html, '<svg', $start );
			$svg_end   = strpos( $html, '</svg>', (int) $svg_start );
			if ( false === $svg_start || false === $svg_end ) {
				return $html;
			}

			$img = sprintf(
				'<img src="%1$s" alt="%2$s" width="24" height="24" style="border-radius:4px;display:block;object-fit:contain" />',
				esc_url( $logo ),
				esc_attr( function_exists( 'uich_brand_name' ) ? uich_brand_name() : '' )
			);

			return substr( $html, 0, $svg_start ) . $img . substr( $html, $svg_end + strlen( '</svg>' ) );
		}

		/**
		 * White Label branding for the composer panel.
		 *
		 * Routed through the free plugin's helper so the panel, the dashboard shell
		 * and the admin menu all resolve the brand from one place. Guarded because
		 * this runtime predates that helper and may be loaded without it.
		 *
		 * @return array
		 */
		private static function brand_cfg() {
			return function_exists( 'uich_brand_payload' )
				? uich_brand_payload()
				: array( 'enabled' => 0, 'name' => 'UiChemy', 'logo' => '' );
		}

		/**
		 * Localize the resolved white-label block icon + title onto a script handle
		 * as window.uichUiChemyBlockCfg. Both fall back to the block's own defaults
		 * when white-labeling is off / unset. Mirrors the Elementor widget's
		 * get_icon() and get_title() resolution order.
		 *
		 * @param string $handle Enqueued script handle to attach the data to.
		 * @return void
		 */
		private function localize_block_cfg( $handle ) {
			// Pro-gated read: get_option() would keep a downgraded site white-labelled
			// with no UI left to turn it off.
			$wl    = function_exists( 'uich_brand_wl' ) ? uich_brand_wl() : array();
			$icon  = ''; // empty → index.js draws the brand mark (bundled or custom).
			$title = ''; // empty → index.js keeps its default "Composer".
			$desc  = ''; // empty → index.js keeps its default empty-state description.

			if ( ! empty( $wl['enabled'] ) ) {
				if ( ! empty( $wl['widget_icon'] ) ) {
					$icon = preg_replace( '/^dashicons-/', '', sanitize_html_class( $wl['widget_icon'] ) );
				}
				// get_title() order: widget_name → plugin_name → default.
				if ( ! empty( $wl['widget_name'] ) ) {
					$title = sanitize_text_field( $wl['widget_name'] );
				} elseif ( ! empty( $wl['plugin_name'] ) ) {
					$title = sanitize_text_field( $wl['plugin_name'] );
				}
				// White-label description → the block's empty-state one-liner.
				if ( ! empty( $wl['description'] ) ) {
					$desc = sanitize_textarea_field( $wl['description'] );
				}
			}

			wp_localize_script(
				$handle,
				'uichUiChemyBlockCfg',
				array(
					'icon'        => $icon,
					'title'       => $title,
					'description' => $desc,
					// Used only when no dashicon was picked: a site that uploaded a
					// brand logo but never opened the icon picker would otherwise keep
					// UiChemy's mark in the inserter.
					'logo'        => function_exists( 'uich_brand_logo_url' ) ? uich_brand_logo_url() : '',
				)
			);
		}

		/**
		 * Enqueue the Composer composer assets inside the Bricks builder.
		 *
		 * Verified live against a real Bricks 2.x install — see
		 * includes/bricks/class-uichemy-bricks-composer.php and
		 * assets/js/uichemy-composer-bricks-adapter.js for what was confirmed.
		 * The panel scripts themselves are the identical, already-proven handles
		 * the Elementor/Gutenberg paths use; only the Bricks-specific glue
		 * adapter at the end is unique to this builder.
		 *
		 * @return void
		 */
		public function enqueue_bricks_editor_script() {
			if ( ! function_exists( 'bricks_is_builder' ) || ! bricks_is_builder() ) {
				return;
			}
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return;
			}

			$html_editor_settings = wp_enqueue_code_editor( array( 'type' => 'text/html' ) );
			$css_editor_settings  = wp_enqueue_code_editor( array( 'type' => 'text/css' ) );
			$js_editor_settings   = wp_enqueue_code_editor( array( 'type' => 'application/javascript' ) );

			wp_enqueue_style( 'wp-codemirror' );
			wp_enqueue_style( 'code-editor' );
			wp_enqueue_script( 'code-editor' );
			wp_enqueue_script( 'wp-theme-plugin-editor' );

			// Dashicons font in the Bricks builder — the Bricks element's icon is
			// white-labeled to a dashicons class (see UiChemy_Bricks_Composer's
			// constructor) when white-labeling is enabled, and Bricks runs on the
			// front end where dashicons isn't loaded by default, so the glyph would
			// otherwise render blank. Harmless when the default Themify icon is used.
			wp_enqueue_style( 'dashicons' );

			// Per-slot field styling (.uichemy-slot-row / -input-wrap / -field-input /
			// -dynamic-btn / -image-thumb). Originally Gutenberg-only (loaded via
			// block.json's editorStyle, which only fires in the block editor) — the
			// Bricks sidebar's slots UI reuses these exact class names, so it needs
			// this file enqueued explicitly here too.
			$slots_css = UICHEMY_PATH . 'assets/blocks/uichemy-composer/editor.css';
			wp_enqueue_style(
				'uichemy-composer-editor-style',
				UICHEMY_URL . 'assets/blocks/uichemy-composer/editor.css',
				array(),
				file_exists( $slots_css ) ? filemtime( $slots_css ) : UICHEMY_VERSION
			);

			$panel_css = UICHEMY_PATH . 'assets/css/uichemy-composer-editor-panel.css';
			wp_enqueue_style(
				'uichemy-composer-editor-panel',
				UICHEMY_URL . 'assets/css/uichemy-composer-editor-panel.css',
				array(),
				file_exists( $panel_css ) ? filemtime( $panel_css ) : UICHEMY_VERSION
			);
			self::add_wl_icon_css( 'uichemy-composer-editor-panel' );

			$js_base = UICHEMY_PATH . 'assets/js/';
			wp_enqueue_script(
				'uichemy-composer-editor-registry',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-registry.js',
				array( 'jquery' ),
				filemtime( $js_base . 'uichemy-composer-editor-registry.js' ),
				true
			);

			$panel_html_path = UICHEMY_PATH . 'assets/html/uichemy-composer-editor-panel.html';
			$panel_html      = '';
			if ( is_readable( $panel_html_path ) ) {
				$panel_html = file_get_contents( $panel_html_path );
				if ( ! is_string( $panel_html ) ) {
					$panel_html = '';
				}
			}
			$panel_html = self::brand_panel_html( $panel_html );

			// Was three byte-identical copies of the same array. One builder now,
			// and it is empty unless a build supplies chat (see get_wp_agent_config).
			$wp_agent_config = $this->get_wp_agent_config();

			// Role Manager flags for the panel (contentOnly + per-feature toggles).
			$access = $this->access_flags();

			wp_localize_script(
				'uichemy-composer-editor-registry',
				'uichComposerEditorCfg',
				array(
					// White Label name + logo for the panel's brand mark. Without it
					// the panel has no branding data at all and paints UiChemy's mark
					// on every white-labelled site.
					'brand'          => self::brand_cfg(),
					'html'           => $html_editor_settings,
					'css'            => $css_editor_settings,
					'js'             => $js_editor_settings,
					'pageCode'       => $html_editor_settings,
					'siteCodeEditor' => $html_editor_settings,
					'ajaxUrl'        => admin_url( 'admin-ajax.php' ),
					'ajaxNonce'      => wp_create_nonce( \UiChemy_Composer_Manager::EDITOR_AJAX_NONCE_ACTION ),
					'siteCode'       => \UiChemy_Composer_Manager::get_site_custom_code_option(),
					'wpAgent'        => $wp_agent_config,
					'panelHtml'      => $panel_html,
					'isPro'          => uichemy_is_pro(),
					'proUrl'         => uichemy_upgrade_url( 'composer' ),
					'proFeatures'    => $this->pro_feature_flags(),
					// Role Manager flags — see the Gutenberg context above.
					'contentOnly'    => $access['contentOnly'],
					'features'       => $access['features'],
					'editorMode'     => $this->editor_mode(),
					'postId'         => $this->current_editor_post_id(),
					'builder'        => 'bricks',
				)
			);

			wp_enqueue_script(
				'uichemy-composer-editor-helpers',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-helpers.js',
				array( 'uichemy-composer-editor-registry', 'code-editor', 'wp-theme-plugin-editor' ),
				filemtime( $js_base . 'uichemy-composer-editor-helpers.js' ),
				true
			);
			wp_enqueue_script(
				'uichemy-composer-editor-panel',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-panel.js',
				array( 'uichemy-composer-editor-helpers' ),
				filemtime( $js_base . 'uichemy-composer-editor-panel.js' ),
				true
			);
			wp_enqueue_script(
				'uichemy-composer-editor',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor.js',
				array( 'jquery', 'uichemy-composer-editor-panel' ),
				filemtime( $js_base . 'uichemy-composer-editor.js' ),
				true
			);
			/**
			 * Let this build add its own editor scripts after the shared panel ones.
			 *
			 * Pro hooks this to enqueue the AI-chat runtime (uichemy-composer-wp-agent.js
			 * + uichemy-composer-chat.js), which Free does not ship at all. Fires in every
			 * builder context, so a listener may depend on 'uichemy-composer-editor'.
			 *
			 * @param string $js_base Absolute path to assets/js/ (for filemtime cache-busting).
			 */
			do_action( 'uichemy/composer/enqueue_editor_scripts', $js_base );

			// React composer bundle (defines window.UichComposerGutenberg — the name
			// is legacy from the Gutenberg integration, but the bundle itself is
			// builder-agnostic; both adapters read the same global).
			$this->enqueue_composer_react();

			// Dynamic-data (Twig) picker: schema + compile + picker + "+ Dynamic"
			// button injector + atom-preview endpoint. Reused verbatim so
			// tokens/preview are byte-identical across all three builders.
			if ( class_exists( 'Uich_DD_Enqueue' ) ) {
				\Uich_DD_Enqueue::editor_assets();
			}

			// Shared slot parsing/writing (raw_html -> Text N / Image N fields),
			// used by both the Bricks sidebar UI and the Gutenberg block.
			$slots_js = UICHEMY_PATH . 'assets/js/uichemy-composer-slots.js';
			wp_enqueue_script(
				'uichemy-composer-slots',
				UICHEMY_URL . 'assets/js/uichemy-composer-slots.js',
				array(),
				file_exists( $slots_js ) ? filemtime( $slots_js ) : UICHEMY_VERSION,
				true
			);

			// Bricks glue: injects the launcher button + per-slot fields into the
			// element's info controls and syncs edits into the `uichemy_settings`
			// textarea control. Verified live against a real Bricks 2.x install.
			$bricks_adapter_js = UICHEMY_PATH . 'assets/js/uichemy-composer-bricks-adapter.js';
			wp_enqueue_script(
				'uichemy-composer-bricks-adapter',
				UICHEMY_URL . 'assets/js/uichemy-composer-bricks-adapter.js',
				array( 'uichemy-composer-editor', 'uichemy-composer-composer', 'uich-dd-picker', 'uichemy-composer-slots' ),
				file_exists( $bricks_adapter_js ) ? filemtime( $bricks_adapter_js ) : UICHEMY_VERSION,
				true
			);
		}

		/**
		 * Whether the frontend UiChemy editor should load for the current request.
		 *
		 * Gated to logged-in users who can edit content, on singular front-end
		 * views only — never in wp-admin or the Elementor preview/editor.
		 *
		 * @return bool
		 */
		public function frontend_editor_allowed() {
			if ( is_admin() || wp_doing_ajax() ) {
				return false;
			}
			// Dashboard toggle (Settings → "Show editor on the front end"). When off,
			// the live-page editor never loads. Defaults to on to preserve behaviour.
			$settings = wp_parse_args(
				(array) get_option( 'uichemy_settings', array() ),
				array( 'enable_frontend_editor' => 1 )
			);
			if ( empty( $settings['enable_frontend_editor'] ) ) {
				return false;
			}
			// Role Manager gate: an admin may restrict which roles can open the
			// composer at all. Falls back to the historical edit_posts check if the
			// resolver is somehow unavailable.
			$can_edit = class_exists( 'UiChemy_Roles' )
				? UiChemy_Roles::can_edit()
				: ( is_user_logged_in() && current_user_can( 'edit_posts' ) );
			if ( ! $can_edit ) {
				return false;
			}
			if ( ! is_singular() ) {
				return false;
			}
			// Skip only Elementor's own editor preview iframe (?elementor-preview=<id>).
			// A plain WordPress preview (?preview=true) is a real front-end view where
			// the editor SHOULD appear, so it is intentionally allowed.
			if ( isset( $_GET['elementor-preview'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				return false;
			}
			if ( class_exists( '\Elementor\Plugin' )
				&& isset( \Elementor\Plugin::$instance->preview )
				&& method_exists( \Elementor\Plugin::$instance->preview, 'is_preview_mode' )
				&& \Elementor\Plugin::$instance->preview->is_preview_mode() ) {
				return false;
			}
			// Bricks' own builder runs on the FRONT END (?bricks=run), not in
			// wp-admin, so it slips past the is_admin() check above entirely —
			// unlike Elementor/Gutenberg, which are always caught by it. Without
			// this, the live-page editor (uichemy-frontend-bridge.js + its own
			// floating panel/canvas toolbar) mounted a SECOND time inside the
			// actual Bricks builder session, alongside the builder's own
			// legitimate panel (uichemy-composer-bricks-adapter.js) — confirmed
			// live: two independent `#uichemy-composer-floating-panel` instances
			// plus a redundant `#uich-composer-canvas-toolbar` all present at
			// once, reported as a "double navigation" bug.
			if ( function_exists( 'bricks_is_builder' ) && bricks_is_builder() ) {
				return false;
			}
			return true;
		}

		/**
		 * Whether the current singular page was built with a UiChemy widget.
		 *
		 * Scans the queried post's Elementor data for a `composer` widget so the
		 * front-end composer only loads on pages that actually contain one.
		 * Note: this checks the queried post's own content; a UiChemy widget that
		 * lives only in an Elementor header/footer/theme-builder template is not
		 * detected here.
		 *
		 * @return bool
		 */
		protected function page_has_composer_widget() {
			$post_id = get_queried_object_id();
			if ( ! $post_id ) {
				return false;
			}
			$data = get_post_meta( $post_id, '_elementor_data', true );
			if ( empty( $data ) || ! is_string( $data ) ) {
				return false;
			}

			// Every name the widget has had, not just the current one: this decides
			// whether the frontend runtime loads at all, so missing a not-yet-migrated
			// page would leave its widget rendered but inert — no picker, no slots.
			foreach ( uichemy_composer_widget_json_needles() as $needle ) {
				if ( false !== strpos( $data, $needle ) ) {
					return true;
				}
			}

			return false;
		}

		/**
		 * The AI-chat runtime config handed to the composer as
		 * `window.uichComposerEditorCfg.wpAgent` (REST URLs, upload paths, nonce).
		 *
		 * AI Chat is a Pro feature and Free does not ship it, so the default here is
		 * EMPTY. Pro fills it from includes/chat/class-uichemy-chat-assets.php, which
		 * only its own plugin-modules.php loads. Free's composer never reads the value
		 * — its Chat tab is the upsell card. See docs/free-pro-split-plan.md.
		 *
		 * @return array
		 */
		public function get_wp_agent_config() {
			/**
			 * Filter the AI-chat runtime config exposed to the composer.
			 *
			 * @param array $config Empty in Free; populated by Pro's chat module.
			 */
			return (array) apply_filters( 'uichemy/composer/wp_agent_config', array() );
		}

		/**
		 * Role-based access flags shared with the React composer (both the
		 * Elementor-editor and front-end contexts). `contentOnly` restricts the
		 * UI to content editing; `features` gates optional surfaces (theme
		 * builder, design system, AI chat) per the Role Manager settings.
		 *
		 * When the resolver is unavailable the flags open everything, preserving
		 * the composer's historical behaviour.
		 *
		 * @return array
		 */
		public function access_flags() {
			if ( ! class_exists( 'UiChemy_Roles' ) ) {
				return array(
					'contentOnly' => false,
					'features'    => array(
						'theme_builder' => true,
						'design_system' => true,
						'ai_chat'       => true,
					),
				);
			}
			return array(
				'contentOnly' => UiChemy_Roles::is_content_only(),
				'features'    => array(
					'theme_builder' => UiChemy_Roles::can_use( 'theme_builder' ),
					'design_system' => UiChemy_Roles::can_use( 'design_system' ),
					'ai_chat'       => UiChemy_Roles::can_use( 'ai_chat' ),
				),
			);
		}

		/**
		 * Which editor mode the composer should expose, from the dashboard setting:
		 * 'both' (default, show the Design/Developer switch), 'design' (lock to
		 * Design), or 'developer' (lock to Developer). Read into every
		 * uichComposerEditorCfg so composer-app.jsx can gate the switch + Code tab.
		 *
		 * @return string
		 */
		public function editor_mode() {
			$opts = get_option( 'uichemy_settings', array() );
			$mode = ( is_array( $opts ) && isset( $opts['editor_mode'] ) ) ? (string) $opts['editor_mode'] : 'both';
			return in_array( $mode, array( 'both', 'design', 'developer' ), true ) ? $mode : 'both';
		}

		/**
		 * The post id currently being edited. Elementor exposes it via
		 * window.elementor.config; Gutenberg/Bricks do NOT, so the chat's page-scope
		 * key ('page-{postId}') came out empty there and every page-scope send died
		 * silently. Localizing this into uichComposerEditorCfg gives the chat a postId
		 * in all builders.
		 *
		 * @return int
		 */
		public function current_editor_post_id() {
			$id = (int) get_the_ID();
			if ( ! $id && function_exists( 'get_queried_object_id' ) ) {
				$id = (int) get_queried_object_id();
			}
			// phpcs:disable WordPress.Security.NonceVerification.Recommended
			if ( ! $id && isset( $_GET['post'] ) ) {
				$id = absint( wp_unslash( $_GET['post'] ) );
			}
			if ( ! $id && isset( $_GET['post_id'] ) ) {
				$id = absint( wp_unslash( $_GET['post_id'] ) );
			}
			if ( ! $id && isset( $_GET['page_id'] ) ) {
				$id = absint( wp_unslash( $_GET['page_id'] ) );
			}
			// phpcs:enable WordPress.Security.NonceVerification.Recommended
			return $id;
		}

		/**
		 * Which composer features this build locks behind Pro, keyed by feature
		 * slug (`true` = locked here, show the upsell instead of the feature).
		 *
		 * Mirrors uichemy_pro_feature_map() on the dashboard side: PHP stays the
		 * single source of truth so the React panel never hard-codes the list.
		 * Pro therefore always ships `false` for every slug.
		 *
		 * @return array<string,bool>
		 */
		public function pro_feature_flags() {
			$locked = array();

			foreach ( uichemy_editor_pro_features() as $feature ) {
				$locked[ $feature ] = ! uichemy_editor_feature_allowed( $feature );
			}

			return $locked;
		}

		/**
		 * Add a marker body class on the frontend when the editor is active so
		 * the floating-panel CSS can position itself.
		 *
		 * @param array $classes Existing body classes.
		 * @return array
		 */
		public function frontend_body_class( $classes ) {
			if ( $this->frontend_editor_allowed() ) {
				$classes[] = 'uichemy-composer-active';
				$classes[] = 'uichemy-frontend-editor';
			}
			return $classes;
		}

		/**
		 * Enqueue the composer panel assets on the live page for editors.
		 *
		 * Reuses the same React build as the Elementor editor. Editing wiring
		 * (frontend bridge) lands in a later phase — F1 renders the panel UI.
		 *
		 * @return void
		 */
		public function enqueue_frontend_editor() {
			if ( ! $this->frontend_editor_allowed() || ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return;
			}

			$panel_css = UICHEMY_PATH . 'assets/css/uichemy-composer-editor-panel.css';
			wp_enqueue_style(
				'uichemy-composer-editor-panel',
				UICHEMY_URL . 'assets/css/uichemy-composer-editor-panel.css',
				array(),
				file_exists( $panel_css ) ? filemtime( $panel_css ) : UICHEMY_VERSION
			);
			self::add_wl_icon_css( 'uichemy-composer-editor-panel' );

			// The Code tab's CodeMirrorEditor (composer-code-editor.jsx) only
			// initializes CodeMirror when window.wp.codeEditor is present — the
			// editor context gets this via enqueue_composer_editor_script(), but the
			// front end never did, so it silently fell back to a plain unhighlighted
			// textarea. Load the same CodeMirror assets here so the Code tab looks
			// identical on the live page.
			wp_enqueue_code_editor( array( 'type' => 'text/html' ) );
			wp_enqueue_code_editor( array( 'type' => 'text/css' ) );
			wp_enqueue_code_editor( array( 'type' => 'application/javascript' ) );
			wp_enqueue_style( 'wp-codemirror' );
			wp_enqueue_style( 'code-editor' );
			wp_enqueue_script( 'code-editor' );
			wp_enqueue_script( 'wp-theme-plugin-editor' );

			// The panel uses position:absolute (correct inside Elementor's preview
			// iframe). On the live page it must be fixed to the viewport, not the
			// document, or it lands at the very bottom of the page and is unseen.
			//
			// Also: the React bundle's composer.css declares a global `body {
			// overflow:hidden; height:100% }` (meant for the editor's own iframe
			// document). On the front end that CSS loads in the MAIN document and
			// kills page scroll — restore it for the live page.
			wp_add_inline_style(
				'uichemy-composer-editor-panel',
				'body.uichemy-frontend-editor .uichemy-composer-floating-panel{position:fixed !important;}'
				. 'html:has(body.uichemy-frontend-editor),body.uichemy-frontend-editor{overflow:visible !important;height:auto !important;}'
			);

			// Pro's extension point — same action the three editor paths fire. The Pro
			// plugin hangs its own editor bundle (the real Chat/Draw tab) off this, and
			// the chat runs on the live front end too, so the seam must exist here as
			// well or Pro users get the upsell card on the front end only.
			do_action( 'uichemy/composer/enqueue_editor_scripts', UICHEMY_PATH . 'assets/js/' );

			// React composer build (registers/enqueues handle 'uichemy-composer-composer'
			// and localizes uichComposerCfg).
			$this->enqueue_composer_react();

			/*
			 * composer.css is built for documents the composer owns; here it lands in
			 * the VISITOR'S document, where its Tailwind preflight repaints the page
			 * being edited. Measured on a real import (2026-08-24): every Elementor
			 * container grew a 1.5px top+bottom border — preflight's
			 * `*{border-style:solid}` turns any pre-existing invisible border-width
			 * visible — and html's font-family/line-height were overwritten.
			 *
			 * Counter exactly those, scoped off the composer island. :where() keeps
			 * specificity at zero, so this only ever defeats the equally-zero
			 * preflight rule — a real border set by the theme, Elementor or the page
			 * itself always outranks it. Attached to the COMPOSER handle, not the
			 * panel handle the body{overflow} patch above rides on: the panel
			 * stylesheet prints BEFORE composer.css, where a zero-specificity
			 * counter would lose the order tiebreak to preflight.
			 */
			wp_add_inline_style(
				'uichemy-composer-composer',
				// Elements. Preflight's `*` is specificity 0; :where stays 0 and
				// prints later, so it wins that tie and loses to everything real.
				':where(:not(.uich-tw):not(.uich-tw *)){border-style:none;}'
				// Pseudo-elements. Preflight targets `::before, ::after` too, and a
				// :where() over elements never matches pseudos — without these two
				// the same invisible-border bug survives on ::before/::after
				// (Elementor overlays live there). A pseudo raises specificity to
				// 0-0-1 on BOTH sides, so later-wins still decides it our way,
				// and any intended pseudo border (class-level, 0-1-1+) still wins.
				. ':where(:not(.uich-tw):not(.uich-tw *))::before,'
				. ':where(:not(.uich-tw):not(.uich-tw *))::after{border-style:none;}'
				// html: preflight overwrote font-family/line-height (measured:
				// Times -> ui-sans, 18.4px -> 24px). revert = back to the browser
				// default the theme was designed against.
				. 'html{font-family:revert;line-height:revert;-webkit-text-size-adjust:revert;tab-size:revert;}'
			);

			// Visual dynamic-data picker (window.UichDD). The inspector's "Insert
			// dynamic value" connector and the Loop/Form/Condition builders call it;
			// without it those buttons silently no-op. Previously loaded only in the
			// Elementor editor, so it was missing on the front-end composer.
			if ( class_exists( 'Uich_DD_Enqueue' ) ) {
				Uich_DD_Enqueue::enqueue_picker();
			}

			// Elementor kit global colours + typography. In the Elementor editor the
			// composer reads these from the live editor APIs (window.elementor / $e),
			// but those don't exist on the front end, so the global colour/typography
			// options came up empty there. Localise the same kit tokens server-side so
			// the front-end composer has them (JS falls back to this when the editor
			// APIs are absent — see getKitGlobalsFromCfg in composer-elementor.jsx).
			$kit_globals = null;
			if ( class_exists( 'UiChemy_Elementor_Globals' ) && \UiChemy_Elementor_Globals::is_available() ) {
				$kit_globals = array(
					'colors'     => \UiChemy_Elementor_Globals::get_colors(),
					'typography' => \UiChemy_Elementor_Globals::get_typography(),
				);
			}

			// Chat tab reads window.uichComposerEditorCfg.wpAgent.
			// Globals Manager seeds from uichComposerEditorCfg.siteCode (the saved
			// #uichemy-globals block). Without it the frontend panel reads empty on
			// cold load and shows 0 variables, and a subsequent save would wipe the
			// real globals — so pass the same snapshot the Elementor editor uses.
			$access = $this->access_flags();

			wp_localize_script(
				'uichemy-composer-composer',
				'uichComposerEditorCfg',
				array(
					// White Label name + logo for the panel's brand mark. Without it
					// the panel has no branding data at all and paints UiChemy's mark
					// on every white-labelled site.
					'brand'          => self::brand_cfg(),
					'wpAgent'    => $this->get_wp_agent_config(),
					'frontend'   => true,
					'editorMode' => $this->editor_mode(),
					'isPro'       => uichemy_is_pro(),
					'proUrl'      => uichemy_upgrade_url( 'composer' ),
					'proFeatures' => $this->pro_feature_flags(),
					'contentOnly' => $access['contentOnly'],
					'features'    => $access['features'],
					'siteCode'   => \UiChemy_Composer_Manager::get_site_custom_code_option(),
					'kitGlobals' => $kit_globals,
					// SitePanes' saveSharedSiteCustomCodeDebounced() (composer-elementor.jsx)
					// posts here to persist Site Code edits. Without these the editor
					// context saves fine but the front end silently no-ops (cfg.ajaxUrl
					// missing) on every edit.
					'ajaxUrl'    => admin_url( 'admin-ajax.php' ),
					'ajaxNonce'  => wp_create_nonce( \UiChemy_Composer_Manager::EDITOR_AJAX_NONCE_ACTION ),
				)
			);

			// Phase F2a — frontend widget picker/bridge (plain JS, no build step).
			$bridge_js = UICHEMY_PATH . 'assets/js/uichemy-frontend-bridge.js';
			if ( file_exists( $bridge_js ) ) {
				wp_enqueue_script(
					'uichemy-frontend-bridge',
					UICHEMY_URL . 'assets/js/uichemy-frontend-bridge.js',
					array(),
					filemtime( $bridge_js ),
					true
				);
				// Detect which builder rendered THIS page, so the front-end chat's
				// "create section" can target the right server inserter. Elementor
				// stamps _elementor_edit_mode; Bricks stores its flat content array;
				// otherwise assume the block editor.
				$fe_post_id = (int) get_queried_object_id();
				$fe_builder = 'gutenberg';
				if ( class_exists( '\Elementor\Plugin' ) && 'builder' === get_post_meta( $fe_post_id, '_elementor_edit_mode', true ) ) {
					$fe_builder = 'elementor';
				} elseif ( is_array( get_post_meta( $fe_post_id, '_bricks_page_content_2', true ) ) ) {
					$fe_builder = 'bricks';
				}

				wp_localize_script(
					'uichemy-frontend-bridge',
					'uichUiChemyFrontend',
					array(
						'postId'  => $fe_post_id,
						'restUrl' => rest_url( 'uichemy/v1/' ),
						'nonce'   => wp_create_nonce( 'wp_rest' ),
						'builder' => $fe_builder,
					)
				);
			}
		}

		/**
		 * Output the empty floating-panel root the React app mounts into.
		 *
		 * @return void
		 */
		public function render_frontend_panel_root() {
			if ( ! $this->frontend_editor_allowed() ) {
				return;
			}
			echo '<div id="uichemy-composer-floating-panel" class="uichemy-composer-floating-panel uich-dock-right" data-uich-composer-theme="dark" data-uichemy-frontend="1"></div>';
		}

		/**
		 * Enqueue the Composer editor scripts/styles inside the Elementor editor.
		 *
		 * @return void
		 */
		/**
		 * Enqueue GSAP + the UiChemy GSAP runtime inside the Elementor preview iframe
		 * so `data-tp-gsap` animations preview while editing.
		 *
		 * @return void
		 */
		public function enqueue_preview_gsap() {
			if ( class_exists( 'UiChemy_Composer_Widget' ) ) {
				\UiChemy_Composer_Widget::enqueue_gsap_runtime();
			}
		}

		/**
		 * Design-system CSS for the on-canvas toolbar, in the PREVIEW document.
		 *
		 * The composer panel mounts in the editor window, so composer.css is
		 * enqueued there — but the toolbar renders over the page, inside this
		 * iframe, and its controls are real design-system components. Without
		 * their styles they arrive as unstyled blocks and the previewed page's own
		 * CSS paints them.
		 *
		 * This is canvas.css, NOT composer.css. The difference is Tailwind's
		 * preflight: composer.css carries a global reset (`border-width: 0` on
		 * every element, `margin: 0` on headings and paragraphs, `display: block`
		 * on images) which in this document would restyle the very page the user
		 * is editing. canvas.css omits it, and every rule it does carry is scoped
		 * inside the `.uich-tw` island.
		 */
		public function enqueue_preview_canvas_css() {
			$css_file = UICHEMY_BUILD_PATH . 'canvas.css';
			if ( ! file_exists( $css_file ) ) {
				return;
			}
			wp_enqueue_style(
				'uichemy-composer-canvas',
				UICHEMY_BUILD_URL . 'canvas.css',
				array(),
				filemtime( $css_file )
			);
		}

		public function enqueue_composer_editor_script() {
			if ( ! class_exists( '\Elementor\Plugin' ) || ! \Elementor\Plugin::$instance->editor->is_edit_mode() ) {
				return;
			}

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return;
			}

			$html_editor_settings = wp_enqueue_code_editor(
				array(
					'type' => 'text/html',
				)
			);
			$css_editor_settings  = wp_enqueue_code_editor(
				array(
					'type' => 'text/css',
				)
			);
			$js_editor_settings   = wp_enqueue_code_editor(
				array(
					'type' => 'application/javascript',
				)
			);

			wp_enqueue_style( 'wp-codemirror' );
			wp_enqueue_style( 'code-editor' );
			wp_enqueue_script( 'code-editor' );
			wp_enqueue_script( 'wp-theme-plugin-editor' );

			$panel_css = UICHEMY_PATH . 'assets/css/uichemy-composer-editor-panel.css';
			wp_enqueue_style(
				'uichemy-composer-editor-panel',
				UICHEMY_URL . 'assets/css/uichemy-composer-editor-panel.css',
				array(),
				file_exists( $panel_css ) ? filemtime( $panel_css ) : UICHEMY_VERSION
			);
			self::add_wl_icon_css( 'uichemy-composer-editor-panel' );

			$js_base = UICHEMY_PATH . 'assets/js/';
			wp_enqueue_script(
				'uichemy-composer-editor-registry',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-registry.js',
				array( 'jquery' ),
				filemtime( $js_base . 'uichemy-composer-editor-registry.js' ),
				true
			);

			$panel_html_path = UICHEMY_PATH . 'assets/html/uichemy-composer-editor-panel.html';
			$panel_html      = '';
			if ( is_readable( $panel_html_path ) ) {
				$panel_html = file_get_contents( $panel_html_path );
				if ( ! is_string( $panel_html ) ) {
					$panel_html = '';
				}
			}
			$panel_html = self::brand_panel_html( $panel_html );

			$wp_agent_config = $this->get_wp_agent_config();

			$access = $this->access_flags();

			wp_localize_script(
				'uichemy-composer-editor-registry',
				'uichComposerEditorCfg',
				array(
					// White Label name + logo for the panel's brand mark. Without it
					// the panel has no branding data at all and paints UiChemy's mark
					// on every white-labelled site.
					'brand'          => self::brand_cfg(),
					'html'           => $html_editor_settings,
					'css'            => $css_editor_settings,
					'js'             => $js_editor_settings,
					'pageCode'       => $html_editor_settings,
					'siteCodeEditor' => $html_editor_settings,
					'isPro'          => uichemy_is_pro(),
					'proUrl'         => uichemy_upgrade_url( 'composer' ),
					'proFeatures'    => $this->pro_feature_flags(),
					'contentOnly'    => $access['contentOnly'],
					'features'       => $access['features'],
					'ajaxUrl'        => admin_url( 'admin-ajax.php' ),
					'ajaxNonce'      => wp_create_nonce( \UiChemy_Composer_Manager::EDITOR_AJAX_NONCE_ACTION ),
					'siteCode'       => \UiChemy_Composer_Manager::get_site_custom_code_option(),
					'wpAgent'        => $wp_agent_config,
					'panelHtml'      => $panel_html,
					'editorMode'     => $this->editor_mode(),
				)
			);

			wp_enqueue_script(
				'uichemy-composer-editor-helpers',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-helpers.js',
				array(
					'uichemy-composer-editor-registry',
					'code-editor',
					'wp-theme-plugin-editor',
				),
				filemtime( $js_base . 'uichemy-composer-editor-helpers.js' ),
				true
			);
			wp_enqueue_script(
				'uichemy-composer-editor-panel',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor-panel.js',
				array( 'uichemy-composer-editor-helpers' ),
				filemtime( $js_base . 'uichemy-composer-editor-panel.js' ),
				true
			);
			wp_enqueue_script(
				'uichemy-composer-editor',
				UICHEMY_URL . 'assets/js/uichemy-composer-editor.js',
				array( 'jquery', 'uichemy-composer-editor-panel' ),
				filemtime( $js_base . 'uichemy-composer-editor.js' ),
				true
			);

			/**
			 * Let this build add its own editor scripts after the shared panel ones.
			 *
			 * Pro hooks this to enqueue the AI-chat runtime (uichemy-composer-wp-agent.js
			 * + uichemy-composer-chat.js), which Free does not ship at all. Fires in every
			 * builder context, so a listener may depend on 'uichemy-composer-editor'.
			 *
			 * @param string $js_base Absolute path to assets/js/ (for filemtime cache-busting).
			 */
			do_action( 'uichemy/composer/enqueue_editor_scripts', $js_base );

			$this->enqueue_composer_react();
		}

		/**
		 * Enqueue the React composer build that mounts into the floating panel shell.
		 *
		 * @return void
		 */
		public function enqueue_composer_react() {
			/*
			 * Merged build: the composer panel is compiled by the dashboard's
			 * webpack config, so its output lives in new-dashboard/build/ (see
			 * UICHEMY_BUILD_PATH in Uich_Composer_Loader) — not under this folder.
			 *
			 * The entry is named `composer`, not `index`: the dashboard bundle
			 * already claims index.js / index.css in that same directory, and two
			 * entries cannot share one basename.
			 */
			$build_dir  = UICHEMY_BUILD_PATH;
			$build_url  = UICHEMY_BUILD_URL;
			$asset_file = $build_dir . 'composer.asset.php';
			$js_file    = $build_dir . 'composer.js';
			$css_file   = $build_dir . 'composer.css';

			if ( ! file_exists( $js_file ) || ! file_exists( $asset_file ) ) {
				return;
			}

			$asset   = include $asset_file;
			$deps    = isset( $asset['dependencies'] ) && is_array( $asset['dependencies'] ) ? $asset['dependencies'] : array();
			$version = isset( $asset['version'] ) ? $asset['version'] : filemtime( $js_file );

			/*
			 * The bundle now reads `uichComposerEditorCfg.isPro` while its modules are
			 * still evaluating — plugin-registrations.js picks the real Chat tab or the
			 * upsell from it. In the Elementor / Gutenberg / Bricks paths that config is
			 * localized onto the REGISTRY handle, so the registry's inline data has to be
			 * printed first. Enqueue order alone made that true only incidentally;
			 * declaring the dependency makes WordPress guarantee it.
			 *
			 * Conditional because the frontend-editor path never enqueues the registry —
			 * it localizes the same object onto THIS handle instead (so the data is
			 * printed immediately before the script either way). Naming an unregistered
			 * dependency would make WordPress silently drop the composer entirely.
			 */
			if ( wp_script_is( 'uichemy-composer-editor-registry', 'enqueued' ) ) {
				$deps[] = 'uichemy-composer-editor-registry';
				$deps   = array_values( array_unique( $deps ) );
			}

			// vis.js (timeline library) is intentionally NOT enqueued for now — the
			// GSAP Timeline editor is temporarily disabled and will return later with
			// play controls. The vis assets remain under assets/*/vendor/vis/; to
			// re-enable, enqueue 'uichemy-vis' (js+css) and add it to $deps.
			$css_url = file_exists( $css_file ) ? $build_url . 'composer.css' : '';
			$css_ver = file_exists( $css_file ) ? filemtime( $css_file ) : UICHEMY_VERSION;

			if ( $css_url ) {
				wp_enqueue_style(
					'uichemy-composer-composer',
					$css_url,
					array(),
					$css_ver
				);
				// Load the RTL build (index-rtl.css) automatically on RTL locales.
				wp_style_add_data( 'uichemy-composer-composer', 'rtl', 'replace' );
			}

			wp_enqueue_script(
				'uichemy-composer-composer',
				$build_url . 'composer.js',
				$deps,
				$version,
				true
			);

			wp_localize_script(
				'uichemy-composer-composer',
				'uichComposerCfg',
				array(
					/*
					 * VERSIONED on purpose. index.jsx's ensureStylesheet() injects this
					 * URL as <link id="uich-composer-css"> into whichever document the
					 * panel mounts in — needed for Elementor's preview iframe, which the
					 * wp_enqueue_style above cannot reach. Handing it the bare URL meant
					 * that link was never cache-busted: browsers held an old index.css
					 * indefinitely, so a rebuild fixed nothing for anyone whose cache
					 * still had the previous copy while the enqueued (versioned) copy
					 * updated normally. That is a per-machine difference, which makes it
					 * look like a bug that reproduces on one computer and not another.
					 */
					'cssUrl'           => $css_url ? add_query_arg( 'ver', $css_ver, $css_url ) : '',
					'ajaxUrl'          => admin_url( 'admin-ajax.php' ),
					'ajaxNonce'        => class_exists( '\UiChemy_Composer_Manager' )
						? wp_create_nonce( \UiChemy_Composer_Manager::EDITOR_AJAX_NONCE_ACTION )
						: '',
					'settingsUrl'      => admin_url( 'admin.php?page=uichemy' ),
					'connectorsUrl'    => admin_url( 'options-connectors.php' ),
					'containerWidths'  => class_exists( 'UiChemy_Container_Width' )
						? \UiChemy_Container_Width::get()
						: null,
					'atomicEnabled'    => class_exists( '\Elementor\Plugin' )
						&& \Elementor\Plugin::$instance->experiments
						&& method_exists( \Elementor\Plugin::$instance->experiments, 'is_feature_active' )
						&& (bool) \Elementor\Plugin::$instance->experiments->is_feature_active( 'e_atomic_elements' ),
					'atomicWidthClass' => ( class_exists( 'UiChemy_Atomic_Globals' ) && class_exists( '\Elementor\Plugin' ) )
						? \UiChemy_Atomic_Globals::get_elementor_width_class()
						: null,
				)
			);
		}
	}

	new UiChemy_Composer_Enqueue();
}
