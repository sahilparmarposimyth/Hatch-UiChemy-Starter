<?php
/**
 * UiChemy_Template_Render — render native templates into front-end locations.
 *
 * Milestone 2 scope: the 404 location. When WordPress serves a 404 and an
 * active UiChemy `error_404` template exists, we swap the theme's template for
 * a thin view that wraps the template's Elementor content in the theme's
 * header/footer. Header/footer location rendering is added in a later milestone.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Template_Render' ) ) {

	/**
	 * Front-end template rendering for theme-builder locations.
	 */
	class UiChemy_Template_Render {

		/**
		 * The template post ID selected for the current render (read by the view).
		 *
		 * @var int
		 */
		private static $render_id = 0;

		/**
		 * Register front-end hooks. No-op in the admin.
		 *
		 * @return void
		 */
		public static function init() {
			if ( is_admin() ) {
				return;
			}
			// Late priority so we win over the theme and most other plugins that
			// also filter template_include.
			add_filter( 'template_include', array( __CLASS__, 'maybe_render_template' ), 99 );

			// Isolated canvas preview of a single template (admin "Preview" button).
			add_action( 'template_redirect', array( __CLASS__, 'maybe_preview' ), 0 );
		}

		/**
		 * Render an isolated, full-page canvas preview of one template when the
		 * request carries a valid `uichemy_tb_preview` id + nonce and the user may
		 * edit it. Bypasses active status / display conditions so drafts can be
		 * previewed, and renders WITHOUT the theme header/footer so the template is
		 * seen on its own. Ends the request.
		 *
		 * @return void
		 */
		public static function maybe_preview() {
			if ( is_admin() ) {
				return;
			}

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- nonce is verified explicitly below.
			$id = isset( $_GET['uichemy_tb_preview'] ) ? absint( $_GET['uichemy_tb_preview'] ) : 0;
			if ( ! $id ) {
				return;
			}

			$nonce = isset( $_GET['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ) : '';
			if ( ! wp_verify_nonce( $nonce, 'uichemy_tb_preview_' . $id ) ) {
				return;
			}

			if ( ! current_user_can( 'edit_post', $id )
				|| ! class_exists( 'UiChemy_Template_Store' )
				|| ! UiChemy_Template_Store::is_template( $id )
			) {
				return;
			}

			self::$render_id = $id;
			add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_elementor_styles' ), 5 );
			// Keep the preview canvas clean — no admin bar chrome over the template.
			add_filter( 'show_admin_bar', '__return_false' );

			include UICHEMY_PATH . 'includes/theme-builder/views/preview.php';
			exit;
		}

		/**
		 * Swap the theme template for our full-page view when a UiChemy template
		 * applies to this request. Handles every full-page location:
		 *  - error_404: any not-found request.
		 *  - single_product: a single WooCommerce product (Woo active).
		 *  - single: a single post/page matching its display conditions.
		 *  - search: the search-results request.
		 *  - product_archive: the WooCommerce shop / product taxonomy (Woo active).
		 *  - archive: any post/term archive or the blog posts index.
		 * All wrap the template's content in the theme header/footer (which, on a
		 * supported theme, are themselves UiChemy header/footer templates).
		 *
		 * @param string $template The template path WordPress resolved.
		 * @return string
		 */
		public static function maybe_render_template( $template ) {
			if ( is_admin() || self::is_elementor_preview() ) {
				return $template;
			}

			if ( ! class_exists( '\Elementor\Plugin' ) || ! class_exists( 'UiChemy_Template_Resolver' ) ) {
				return $template;
			}

			// Resolve the most specific applicable full-page location. Order
			// matters: WooCommerce product/shop checks run before the generic
			// singular/archive checks (a product page is also is_singular(); the
			// shop is also is_archive()), so the Woo-specific template wins.
			$id = 0;
			if ( is_404() ) {
				$id = UiChemy_Template_Resolver::resolve( 'error_404' );
			} elseif ( function_exists( 'is_product' ) && is_product() ) {
				$id = UiChemy_Template_Resolver::resolve( 'single_product' );
			} elseif ( is_singular() && ! self::is_protected_singular() ) {
				// A single template applies to single post/page views whose
				// display conditions match (entire = all singular views), EXCEPT
				// the functional WooCommerce pages guarded by is_protected_singular()
				// — a generic single template must never silently replace them.
				$id = UiChemy_Template_Resolver::resolve( 'single' );
			} elseif ( is_search() ) {
				$id = UiChemy_Template_Resolver::resolve( 'search' );
			} elseif ( self::is_woo_product_archive() ) {
				$id = UiChemy_Template_Resolver::resolve( 'product_archive' );
			} elseif ( is_archive() || is_home() ) {
				// Any post/term archive: category, tag, taxonomy, author, date,
				// post-type archive, and the blog posts index.
				$id = UiChemy_Template_Resolver::resolve( 'archive' );
			}

			if ( ! $id ) {
				return $template;
			}

			self::$render_id = $id;

			// Guarantee Elementor's base frontend stylesheet is present. This is
			// static-guarded inside Elementor, so it is a safe no-op if Elementor
			// already enqueued it for this request. Registered here (before the
			// view calls get_header() → wp_head) so it prints in <head>.
			add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_elementor_styles' ), 5 );

			return UICHEMY_PATH . 'includes/theme-builder/views/fullpage.php';
		}

		/**
		 * Enqueue Elementor's base frontend styles (container/flex utilities etc.).
		 *
		 * @return void
		 */
		public static function enqueue_elementor_styles() {
			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->frontend ) ) {
				\Elementor\Plugin::$instance->frontend->enqueue_styles();
			}
			// A template on this request may be Gutenberg-authored; ensure block
			// styles are available too (harmless when unused).
			self::enqueue_block_styles();
		}

		/**
		 * Ensure the core block-library styles are present (for Gutenberg-authored
		 * templates). Per-block "supports" styles are printed inline by WordPress.
		 *
		 * @return void
		 */
		public static function enqueue_block_styles() {
			foreach ( array( 'wp-block-library', 'wp-block-library-theme', 'global-styles' ) as $handle ) {
				if ( wp_style_is( $handle, 'registered' ) && ! wp_style_is( $handle, 'enqueued' ) ) {
					wp_enqueue_style( $handle );
				}
			}
		}

		/**
		 * The Elementor content for the current render target, with its CSS
		 * inlined ($with_css = true) so styling survives even though the enqueue
		 * happens after wp_head on this path.
		 *
		 * @return string Rendered HTML ('' when nothing to render).
		 */
		public static function get_render_html() {
			return self::get_render_html_for( self::$render_id );
		}

		/**
		 * The Elementor content for a specific template ID, CSS inlined.
		 *
		 * Shared by every location handler (404 view, header/footer shim, block
		 * template-part interception). $with_css = true so the template's own CSS
		 * travels inline — essential on paths where the enqueue would land after
		 * wp_head (e.g. a header rendered inside the theme's header.php).
		 *
		 * @param int $id Template post ID.
		 * @return string Rendered HTML ('' when nothing to render).
		 */
		public static function get_render_html_for( $id ) {
			$id = (int) $id;
			if ( ! $id ) {
				return '';
			}

			$editor = class_exists( 'UiChemy_Template_CPT' ) ? UiChemy_Template_CPT::editor_for( $id ) : 'elementor';

			if ( 'gutenberg' === $editor ) {
				$post = get_post( $id );
				if ( ! $post ) {
					return '';
				}
				// Render the block content. Block "supports" inline styles print
				// alongside the markup; base block-library CSS is enqueued via
				// enqueue_block_styles(). do_shortcode covers any embedded shortcodes.
				return do_shortcode( do_blocks( (string) $post->post_content ) );
			}

			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return '';
			}
			return \Elementor\Plugin::$instance->frontend->get_builder_content_for_display( $id, true );
		}

		/**
		 * The template post ID selected for the current render.
		 *
		 * @return int
		 */
		public static function get_current_render_id() {
			return (int) self::$render_id;
		}

		/**
		 * Whether the current singular request is a functional page a generic
		 * "single" template must never take over: the WooCommerce cart, checkout
		 * or my-account page. These carry core store flows (add-to-cart, payment,
		 * order history) that a theme-builder template would silently replace,
		 * breaking purchasing. Single *products* are intentionally NOT protected —
		 * they are designed via the single_product location, checked earlier.
		 *
		 * Always false when WooCommerce is inactive (the conditionals are absent),
		 * so non-Woo sites are unaffected.
		 *
		 * @return bool
		 */
		private static function is_protected_singular() {
			if ( function_exists( 'is_cart' ) && is_cart() ) {
				return true;
			}
			if ( function_exists( 'is_checkout' ) && is_checkout() ) {
				return true;
			}
			if ( function_exists( 'is_account_page' ) && is_account_page() ) {
				return true;
			}
			return false;
		}

		/**
		 * Whether this request is a WooCommerce product archive — the shop page,
		 * a product post-type archive, or a product taxonomy (category/tag/attr).
		 * Always false when WooCommerce is inactive.
		 *
		 * @return bool
		 */
		private static function is_woo_product_archive() {
			if ( ! function_exists( 'is_shop' ) ) {
				return false;
			}
			return is_shop() || is_product_taxonomy() || is_post_type_archive( 'product' );
		}

		/**
		 * Whether we are inside the Elementor editor or its preview iframe.
		 *
		 * @return bool
		 */
		private static function is_elementor_preview() {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only context check, no state change.
			if ( isset( $_GET['elementor-preview'] ) ) {
				return true;
			}
			if ( class_exists( '\Elementor\Plugin' )
				&& isset( \Elementor\Plugin::$instance->preview )
				&& \Elementor\Plugin::$instance->preview->is_preview_mode()
			) {
				return true;
			}
			return false;
		}
	}
}
