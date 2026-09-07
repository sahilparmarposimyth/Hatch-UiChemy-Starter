<?php
/**
 * UiChemy_Theme_Builder — bootstrap for the native Theme Builder feature.
 *
 * Wires the storage layer (CPT + template store). The display-conditions
 * resolver, the front-end location rendering, and the admin UI/REST are added
 * in later milestones; this class is the single entry point they will hook
 * into.
 *
 * The Theme Builder is always on — it is a core UiChemy feature with no
 * user-facing toggle.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Theme_Builder' ) ) {

	/**
	 * Theme Builder bootstrap.
	 */
	class UiChemy_Theme_Builder {

		/**
		 * Boot the feature.
		 *
		 * @return void
		 */
		public static function init() {
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-template-cpt.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-template-store.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-conditions.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-template-resolver.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-template-render.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-locations.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-theme-builder-rest.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-theme-builder-api.php';
			require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-template-shortcode.php';

			// The CPT must exist on both admin and front end so templates resolve
			// and render everywhere.
			add_action( 'init', array( 'UiChemy_Template_CPT', 'register' ) );

			// Front-end location rendering. Both self-guard against the admin.
			UiChemy_Template_Render::init();  // 404 location (template_include).
			UiChemy_Locations::init();        // header/footer locations.

			// Read-only REST endpoint exposing the active templates. Registered
			// on both admin + front end (REST requests are not always is_admin()).
			UiChemy_Theme_Builder_REST::init();

			// Public creation hook (`uichemy/theme_builder/create_template` filter
			// + uichemy_create_theme_template() helper) for trusted server-side
			// callers such as the import pipeline. Registered everywhere so it is
			// available regardless of request context.
			UiChemy_Theme_Builder_API::init();

			// `[uichemy_template id="…"]`. Registered on admin too: the block editor
			// and other admin-side renderers run shortcodes as well.
			UiChemy_Template_Shortcode::init();

			// Admin UI ajax endpoints.
			if ( is_admin() ) {
				require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-theme-builder-admin.php';
				UiChemy_Theme_Builder_Admin::init();
			}
		}
	}
}
