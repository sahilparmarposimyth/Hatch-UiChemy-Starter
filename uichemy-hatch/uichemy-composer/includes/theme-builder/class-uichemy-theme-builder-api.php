<?php
/**
 * UiChemy_Theme_Builder_API — public creation hook for Theme Builder templates.
 *
 * A stable, decoupled entry point so trusted server-side code (e.g. an import
 * pipeline) can create a native UiChemy template — header, footer, single,
 * archive, search, 404, or a WooCommerce type — without knowing the CPT, meta
 * keys, element-tree shape, or the manager class. It thinly wraps
 * UiChemy_Composer_Manager::create_theme_builder_template().
 *
 * Two equivalent entry points:
 *
 *   1) Filter (recommended — returns the result, and safely no-ops to the passed
 *      default when UiChemy / the Theme Builder is unavailable):
 *
 *        $result = apply_filters(
 *            'uichemy/theme_builder/create_template',
 *            null,                       // default returned if TB is inactive
 *            array(
 *                'type'   => 'header',   // header|footer|single|archive|single_product|product_archive|search|error_404
 *                'title'  => 'Imported Header',
 *                'html'   => $html,      // at least html OR css is required
 *                'css'    => $css,
 *                'js'     => $js,        // optional
 *                'status' => 'active',   // active (default) | inactive
 *                'editor' => 'elementor',// elementor (default) | gutenberg
 *                'placement' => array(), // optional — where it displays (see create_theme_builder_template)
 *                'upload_images' => true,// sideload <img>/CSS-url images (default true)
 *                'source' => 'import',   // provenance label written into the code block
 *            )
 *        );
 *
 *   2) Helper function (same thing, direct call):
 *
 *        $result = uichemy_create_theme_template( $args );
 *
 * Header / footer example (for the import flow):
 *
 *        $header = uichemy_create_theme_template( array(
 *            'type'   => 'header',
 *            'title'  => 'Imported Header',
 *            'html'   => $header_html,
 *            'css'    => $header_css,
 *            'status' => 'active',
 *        ) );
 *        $footer = uichemy_create_theme_template( array(
 *            'type'   => 'footer',
 *            'title'  => 'Imported Footer',
 *            'html'   => $footer_html,
 *            'css'    => $footer_css,
 *            'status' => 'active',
 *        ) );
 *
 * Return: on success an array( 'post_id', 'edit_url', 'preview_url', 'type',
 * 'status', … ); a WP_Error on failure; or the passed default (null) via the
 * filter when the Theme Builder is inactive.
 *
 * SECURITY: this stores the provided HTML/CSS/JS as the template content, so it
 * must only be called by trusted server-side code that controls the markup — it
 * is not a public/user-facing endpoint.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Theme_Builder_API' ) ) {

	/**
	 * Registers the public template-creation filter hook.
	 */
	class UiChemy_Theme_Builder_API {

		/**
		 * Filter hook name callers use to create a template.
		 */
		const CREATE_FILTER = 'uichemy/theme_builder/create_template';

		/**
		 * Register the filter.
		 *
		 * @return void
		 */
		public static function init() {
			// Third arg (accepted args) is 2: the default value + the args array.
			add_filter( self::CREATE_FILTER, array( __CLASS__, 'create' ), 10, 2 );
		}

		/**
		 * Filter callback: create a template from the given args.
		 *
		 * @param mixed $default Default returned when creation is unavailable (so
		 *                       the caller's apply_filters default is preserved if
		 *                       UiChemy / the Theme Builder is inactive).
		 * @param array $args    Template args (see the class docblock).
		 * @return array|\WP_Error|mixed
		 */
		public static function create( $default, $args = array() ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' )
				|| ! method_exists( 'UiChemy_Composer_Manager', 'create_theme_builder_template' ) ) {
				return $default;
			}
			return UiChemy_Composer_Manager::create_theme_builder_template( is_array( $args ) ? $args : array() );
		}
	}
}

if ( ! function_exists( 'uichemy_create_theme_template' ) ) {
	/**
	 * Create a native UiChemy Theme Builder template (header/footer/single/…).
	 *
	 * Thin wrapper over the `uichemy/theme_builder/create_template` filter so
	 * callers can use a plain function. See UiChemy_Theme_Builder_API for the args.
	 *
	 * @param array $args Template args.
	 * @return array|\WP_Error|null Result array, WP_Error, or null when disabled.
	 */
	function uichemy_create_theme_template( $args ) {
		return apply_filters( 'uichemy/theme_builder/create_template', null, $args );
	}
}
