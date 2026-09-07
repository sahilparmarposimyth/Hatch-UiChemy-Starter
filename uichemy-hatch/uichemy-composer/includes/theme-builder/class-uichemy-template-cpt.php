<?php
/**
 * UiChemy_Template_CPT — the native Theme Builder template post type.
 *
 * Registers the `uichemy_template` custom post type (edited with Elementor, so
 * a Composer widget can live inside it) plus the three meta keys that describe a
 * template: its location type, its display conditions, and its active status.
 *
 * This is the storage layer only. The display-conditions resolver and the
 * front-end location rendering live in sibling classes and are wired later.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Template_CPT' ) ) {

	/**
	 * Registers the uichemy_template post type and its meta.
	 */
	class UiChemy_Template_CPT {

		/**
		 * Post type slug.
		 */
		const POST_TYPE = 'uichemy_template';

		/**
		 * Meta key: template location type (one of self::TYPES).
		 */
		const META_TYPE = '_uichemy_tpl_type';

		/**
		 * Meta key: display-conditions rule set (array).
		 */
		const META_CONDITIONS = '_uichemy_tpl_conditions';

		/**
		 * Meta key: active|inactive.
		 */
		const META_STATUS = '_uichemy_tpl_status';

		/**
		 * Meta key: which editor authors + renders the template (elementor|gutenberg).
		 */
		const META_EDITOR = '_uichemy_tpl_editor';

		/**
		 * Meta key: the context a single/archive template targets. String form:
		 *   'any'                    — any singular / any archive (fallback)
		 *   'front'                  — the front page (single)
		 *   'blog' | 'author' | 'date' — special archives
		 *   'pt:{post_type}'         — a specific post type (single)
		 *   'tax:{taxonomy}'         — a specific taxonomy archive
		 * Absent meta means 'any' (back-compat: pre-targeting templates were global).
		 */
		const META_TARGET = '_uichemy_tpl_target';

		/**
		 * Supported template location types.
		 *
		 * Full-page types (single, archive, single_product, product_archive,
		 * search, error_404) swap the whole page via template_include; header /
		 * footer are injected at the theme's header/footer locations. The two
		 * `*_product` / `product_*` types only render when WooCommerce is active.
		 */
		const TYPES = array( 'header', 'footer', 'single', 'archive', 'single_product', 'product_archive', 'search', 'error_404' );

		/**
		 * The subset of TYPES available in the Free build. The remaining four
		 * (archive, single_product, product_archive, search) are UiChemy Pro.
		 *
		 * Note this gates CREATION and LISTING only — a template already stored for
		 * a Pro type keeps its post and meta untouched when Pro goes away, it simply
		 * stops being offered and stops resolving. Nothing is ever deleted, so
		 * reactivating Pro brings every template straight back.
		 */
		const FREE_TYPES = array( 'header', 'footer', 'single', 'error_404' );

		/**
		 * Template types the current build may use — all of TYPES in Pro, only
		 * FREE_TYPES in Free. Every validation and listing path goes through here,
		 * so a crafted REST/ajax request cannot create a Pro type in the Free build.
		 *
		 * @return string[]
		 */
		public static function allowed_types() {
			return uichemy_is_pro() ? self::TYPES : self::FREE_TYPES;
		}

		/**
		 * Whether a type exists at all, regardless of build. Used where we must
		 * recognise a stored Pro-type template in Free (e.g. to leave it alone)
		 * rather than treat it as corrupt data.
		 *
		 * @param string $type Location type.
		 * @return bool
		 */
		public static function is_known_type( $type ) {
			return in_array( (string) $type, self::TYPES, true );
		}

		/**
		 * Register the post type and meta on `init`.
		 *
		 * @return void
		 */
		public static function register() {
			$labels = array(
				'name'          => _x( 'Templates', 'post type general name', 'uichemy' ),
				'singular_name' => _x( 'Template', 'post type singular name', 'uichemy' ),
				'menu_name'     => _x( 'Theme Builder', 'admin menu', 'uichemy' ),
				'add_new'       => __( 'Add New', 'uichemy' ),
				'add_new_item'  => __( 'Add New Template', 'uichemy' ),
				'edit_item'     => __( 'Edit Template', 'uichemy' ),
				'new_item'      => __( 'New Template', 'uichemy' ),
				'view_item'     => __( 'View Template', 'uichemy' ),
				'search_items'  => __( 'Search Templates', 'uichemy' ),
			);

			register_post_type(
				self::POST_TYPE,
				array(
					'labels'              => $labels,
					// Not a public content type: no front-end single URL of its
					// own, hidden from search and nav menus. `publicly_queryable`
					// stays true so Elementor's editor preview iframe (which loads
					// the post via a query arg) can resolve it.
					'public'              => false,
					'publicly_queryable'  => true,
					'exclude_from_search' => true,
					'show_in_nav_menus'   => false,
					'show_ui'             => true,
					'show_in_menu'        => false,
					'show_in_admin_bar'   => false,
					// REST support is required for the block (Gutenberg) editor to
					// load for this post type — Gutenberg-authored templates need it.
					'show_in_rest'        => true,
					'hierarchical'        => false,
					'rewrite'             => false,
					'query_var'           => false,
					'can_export'          => true,
					'capability_type'     => 'post',
					'map_meta_cap'        => true,
					// 'elementor' is the ONLY support Elementor checks to allow
					// editing a post type on its canvas (see Utils::is_post_type_support).
					'supports'            => array( 'title', 'editor', 'elementor', 'author', 'custom-fields', 'thumbnail' ),
				)
			);

			self::register_meta();
		}

		/**
		 * Register the template meta keys.
		 *
		 * All three are single values, editable only by users who can manage
		 * options, and kept out of REST (the Theme Builder UI reads/writes them
		 * through its own capability-checked endpoints, not the public meta API).
		 *
		 * @return void
		 */
		private static function register_meta() {
			$auth = static function () {
				return current_user_can( 'manage_options' );
			};

			register_post_meta(
				self::POST_TYPE,
				self::META_TYPE,
				array(
					'type'          => 'string',
					'single'        => true,
					'show_in_rest'  => false,
					'auth_callback' => $auth,
				)
			);

			register_post_meta(
				self::POST_TYPE,
				self::META_STATUS,
				array(
					'type'          => 'string',
					'single'        => true,
					'show_in_rest'  => false,
					'auth_callback' => $auth,
				)
			);

			register_post_meta(
				self::POST_TYPE,
				self::META_EDITOR,
				array(
					'type'          => 'string',
					'single'        => true,
					'show_in_rest'  => false,
					'auth_callback' => $auth,
				)
			);

			register_post_meta(
				self::POST_TYPE,
				self::META_TARGET,
				array(
					'type'          => 'string',
					'single'        => true,
					'show_in_rest'  => false,
					'auth_callback' => $auth,
				)
			);

			// Conditions are an array; register without a scalar type so WP does
			// not coerce them, and keep them out of REST.
			register_post_meta(
				self::POST_TYPE,
				self::META_CONDITIONS,
				array(
					'single'        => true,
					'show_in_rest'  => false,
					'auth_callback' => $auth,
				)
			);
		}

		/**
		 * Whether the given string is a template type this build may use. Free
		 * rejects the four Pro-only types here, which is what stops a crafted
		 * request from creating one (the locked UI cards are cosmetic).
		 *
		 * @param string $type Candidate type.
		 * @return bool
		 */
		public static function is_valid_type( $type ) {
			return in_array( (string) $type, self::allowed_types(), true );
		}

		/**
		 * The editor a template uses. Absent meta means it predates the editor
		 * flag and was authored in Elementor, so that is the back-compat default.
		 *
		 * @param int $post_id Template post ID.
		 * @return string 'gutenberg' | 'elementor'
		 */
		public static function editor_for( $post_id ) {
			// Elementor builder data is authoritative when present. A template
			// built or rebuilt in Elementor carries _elementor_edit_mode='builder'
			// and a non-empty _elementor_data; it must render through Elementor
			// even if a stale META_EDITOR still reads 'gutenberg' — e.g. a template
			// first created as Gutenberg (seeding post_content), then rebuilt in
			// Elementor. Elementor's own save does not touch UiChemy's META_EDITOR,
			// so without this the render would route to the stale, class-stripped
			// post_content and drop the widget's classes + CSS (unstyled output).
			if ( 'builder' === get_post_meta( $post_id, '_elementor_edit_mode', true ) ) {
				$data = get_post_meta( $post_id, '_elementor_data', true );
				if ( ! empty( $data ) && '[]' !== trim( (string) $data ) ) {
					return 'elementor';
				}
			}
			return 'gutenberg' === get_post_meta( $post_id, self::META_EDITOR, true ) ? 'gutenberg' : 'elementor';
		}

		/**
		 * The context a template targets. Absent meta = 'any' (back-compat).
		 *
		 * @param int $post_id Template post ID.
		 * @return string One of the META_TARGET forms.
		 */
		public static function target_for( $post_id ) {
			$target = get_post_meta( $post_id, self::META_TARGET, true );
			return ( is_string( $target ) && '' !== $target ) ? $target : 'any';
		}

		/**
		 * Map a template type to the semantic HTML tag its outer container uses.
		 *
		 * @param string $type Template type.
		 * @return string header|footer|div
		 */
		public static function container_tag_for_type( $type ) {
			if ( 'header' === $type ) {
				return 'header';
			}
			if ( 'footer' === $type ) {
				return 'footer';
			}
			return 'div';
		}
	}
}
