<?php
/**
 * This file specifically loads JavaScript and CSS dependencies.
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    Uichemy
 */

namespace Uich\Uich_enqueue;

use Uich\User\Uich_UserManager;

/**
 * Exit if accessed directly.
 * */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Enqueue' ) ) {

	/**
	 * Here Enqueue all js and css script
	 */
	class Uich_Enqueue {

		public $uich_onbording_end = 'uich_onbording_end';

		public $onbording_api = 'https://api.posimyth.com/wp-json/uich/v2/uich_store_user_data';

		/**
		 * Initialize the class and set its properties.
		 *
		 * @since   1.0.0
		 */
		public function __construct() {
			// Editor-side asset enqueue (NOT dashboard — dashboard hooks
			// moved to includes/new-dashboard/).
			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_bricks_scripts' ) );

			// Gutenberg block editor assets
			add_action( 'enqueue_block_editor_assets', array( $this, 'editor_assets' ) );

			// Hide native WP admin notices + strip WP admin chrome padding on
			// the UiChemy dashboard page so the React UI sits flush against
			// the sidebar and bottom. Only applied when page === 'uichemy'.
			add_action(
				'admin_head',
				function () {
					if ( isset( $_GET['page'] ) && 'uichemy' === $_GET['page'] ) {  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only admin page/asset check; no state change.
						echo '<style>
						.notice, .update-nag, .updated, .error, .is-dismissible, .notice-success, .notice-error, .notice-warning {
							display: none !important;
						}
						#wpcontent { padding-left: 0 !important; }
						#wpbody-content { padding-bottom: 0 !important; }
						#wpfooter { display: none !important; }
					</style>';
					}
				}
			);

			add_action( 'elementor/editor/after_enqueue_scripts', array( $this, 'enqueue_elementor_atomic_script' ) );

			// Gutenberg Custom CSS Field
			$uicssOpt = get_option( 'uictmcss_enabled' );
			if ( empty( $uicssOpt ) || false == $uicssOpt ) {
				add_action( 'wp_loaded', array( $this, 'uich_block_add_attribues' ) );
				add_action( 'wp_head', array( $this, 'uich_block_css_add_to_head' ) );
			}
		}

		public function editor_assets() {
			global $pagenow;
			$scripts_dep = array( 'react', 'react-dom', 'wp-block-editor', 'wp-element', 'wp-blocks', 'wp-i18n', 'wp-plugins', 'wp-components', 'wp-api-fetch' );
			if ( 'widgets.php' !== $pagenow && 'customize.php' !== $pagenow ) {
				wp_enqueue_style( 'uichemy-cp-style', UICH_URL . 'assets/css/uich-cp.css', array(), UICH_VERSION, 'all' );
				$scripts_dep = array_merge( $scripts_dep, array( 'wp-editor', 'wp-edit-post' ) );

				// Editor's Image Uploads script
				wp_enqueue_script( 'uich-editor-js', UICH_URL . 'assets/js/uich-copy-button.js', $scripts_dep, '1.0.0', false );
				wp_localize_script(
					'uich-editor-js',
					'uichemy_ajax_object',
					array(
						'ajax_url' => admin_url( 'admin-ajax.php' ),
						'nonce'    => wp_create_nonce( 'uichemy-ajax-nonce' ),
						'logo_url' => uich_brand_button_logo_url(),
						// Empty unless White Label is on AND a logo was uploaded. The
						// buttons draw their inline UiChemy glyph when this is empty, so
						// only a real custom logo replaces the mark.
						'wl_logo'  => uich_brand_logo_url(),
						'wl_name'  => uich_brand_name(),
					)
				);

				// Gutenberg Custom CSS Field
				$uicssOpt = get_option( 'uictmcss_enabled' );
				if ( empty( $uicssOpt ) || false == $uicssOpt ) {
					wp_enqueue_code_editor( array( 'type' => 'text/css' ) );

					wp_add_inline_script(
						'wp-codemirror',
						'window.CodeMirror = wp.CodeMirror;'
					);

					wp_enqueue_script(
						'uich-nxt-js',
						UICH_URL . 'assets/js/index.js',
						array_merge( $scripts_dep, array( 'lodash', 'code-editor', 'csslint', 'wp-i18n' ) ),
						UICH_VERSION,
						true
					);
					wp_set_script_translations( 'uich-nxt-js', 'uichemy' );
				}
			}
		}



		/**
		 * UiChemy copy button for atomic v4
		 */
		public function enqueue_elementor_atomic_script() {
			// Check if Elementor exists and is in edit mode
			if ( ! class_exists( '\Elementor\Plugin' ) || ! \Elementor\Plugin::$instance->editor->is_edit_mode() ) {
				return;
			}

			// Check if atomic elements are enabled
			$experiments_manager = \Elementor\Plugin::$instance->experiments;
			if ( ! $experiments_manager->is_feature_active( 'e_atomic_elements' ) ) {
				return; // Don't load the script if atomic elements are not enabled
			}

			// Register and enqueue the script only if all conditions are met
			wp_register_script(
				'uich-elementor-button-js',
				UICH_URL . 'assets/js/uich-elementor-button.js',
				array( 'jquery' ),
				UICH_VERSION,
				true,
			);

			wp_enqueue_script( 'uich-elementor-button-js' );

			wp_localize_script(
				'uich-elementor-button-js',
				'uich_ajax_object_data',
				array(
					'ajax_url' => admin_url( 'admin-ajax.php' ),
					'nonce'    => wp_create_nonce( 'uichemy-ajax-nonce' ),
					'logo_url' => uich_brand_button_logo_url(),
					// Empty unless White Label is on AND a logo was uploaded. The
					// buttons draw their inline UiChemy glyph when this is empty, so
					// only a real custom logo replaces the mark.
					'wl_logo'  => uich_brand_logo_url(),
					'wl_name'  => uich_brand_name(),
				)
			);

			// Enqueue UiChemy Custom CSS editor for atomic widgets
			wp_enqueue_script(
				'uich-atomic-custom-css-js',
				UICH_URL . 'assets/js/uich-atomic-custom-css.js',
				array(),
				UICH_VERSION,
				true,
			);
		}

		/**
		 * Enqueue script bricks button admin area.
		 *
		 * @since 3.2.3
		 */
		public function enqueue_bricks_scripts() {
			wp_register_script(
				'uich-bricks-button-js',
				UICH_URL . 'assets/js/uich-bricks-button.js',
				array( 'jquery' ),
				UICH_VERSION,
				true,
			);

			if ( ! empty( $_GET['bricks'] ) && 'run' === $_GET['bricks'] ) {  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only admin page/asset check; no state change.
				wp_enqueue_script( 'uich-bricks-button-js' );

				wp_localize_script(
					'uich-bricks-button-js',
					'uich_ajax_object_data',
					array(
						'ajax_url' => admin_url( 'admin-ajax.php' ),
						'nonce'    => wp_create_nonce( 'uichemy-ajax-nonce' ),
						'logo_url' => uich_brand_button_logo_url(),
						// Empty unless White Label is on AND a logo was uploaded. The
						// buttons draw their inline UiChemy glyph when this is empty, so
						// only a real custom logo replaces the mark.
						'wl_logo'  => uich_brand_logo_url(),
						'wl_name'  => uich_brand_name(),
					)
				);
			}
		}



		/**
		 * Add attributes to Gutenberg blocks
		 *
		 * @since 4.1.3
		 */
		public function uich_block_add_attribues() {
			$registered_blocks = \WP_Block_Type_Registry::get_instance()->get_all_registered();

			foreach ( $registered_blocks as $block ) {
				$block->attributes['uichCss'] = array(
					'type'    => 'string',
					'default' => '',
				);
			}
		}

		/**
		 * Add CSS to Gutenberg blocks
		 *
		 * @since 4.1.3
		 */
		public function uich_block_css_add_to_head() {
			if ( function_exists( 'has_blocks' ) && has_blocks( get_the_ID() ) ) {
				global $post;

				if ( ! is_object( $post ) ) {
					return;
				}

				$cnt = '';

				if ( get_queried_object() === null && function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() && current_theme_supports( 'block-templates' ) ) {
					global $_wp_current_template_content;

					$uichslugs       = array();
					$template_blocks = parse_blocks( $_wp_current_template_content );

					foreach ( $template_blocks as $template_block ) {
						if ( 'core/template-part' === $template_block['blockName'] ) {
							$uichslugs[] = $template_block['attrs']['slug'];
						}
					}

					$uitem_parts = get_block_templates( array( 'slugs__in' => $uichslugs ), 'wp_template_part' );

					foreach ( $uitem_parts as $template ) {
						if ( ! empty( $template->content ) && ! empty( $template->slug ) && in_array( $template->slug, $uichslugs ) ) {
							$cnt .= $template->content;
						}
					}

					$cnt .= $_wp_current_template_content;
				} else {
					$cnt = $post->post_content;
				}

				$blocks = parse_blocks( $cnt );

				if ( ! is_array( $blocks ) || empty( $blocks ) ) {
					return;
				}

				$css = $this->uich_inner_blocks_css( $blocks, $post->ID );

				if ( empty( $css ) ) {
					return;
				}

				$style  = "\n" . '<style type="text/css" media="all">' . "\n";
				$style .= $css;
				$style .= "\n" . '</style>' . "\n";

				echo $style;
			}
		}

		/**
		 * Add CSS to Gutenberg blocks
		 *
		 * @since 4.1.3
		 */
		public function uich_inner_blocks_css( $inner_blocks, $id ) {
			$style = '';

			foreach ( $inner_blocks as $block ) {

				if ( isset( $block['attrs'] ) ) {
					if ( isset( $block['attrs']['uichCss'] ) ) {
						$style .= $block['attrs']['uichCss'];
					}
				}

				if ( 'core/block' === $block['blockName'] && ! empty( $block['attrs']['ref'] ) ) {
					$reusable_block = get_post( $block['attrs']['ref'] );

					if ( ! $reusable_block || 'wp_block' !== $reusable_block->post_type ) {
						return '';
					}

					if ( 'publish' !== $reusable_block->post_status || ! empty( $reusable_block->post_password ) ) {
						return '';
					}

					$blocks = parse_blocks( $reusable_block->post_content );

					$style .= $this->uich_inner_blocks_css( $blocks, $reusable_block->ID );
				}

				if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
					$style .= $this->uich_inner_blocks_css( $block['innerBlocks'], $id );
				}
			}

			return $style;
		}
	}

	new Uich_Enqueue();
}
