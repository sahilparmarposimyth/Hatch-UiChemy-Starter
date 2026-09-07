<?php
/**
 * UiChemy Dynamic Tags.
 *
 * Registers a Plus-Addons-style library of dynamic values into Elementor's
 * native Dynamic Tags connector. That connector already appears on the Composer
 * widget's slot controls (they declare `dynamic => active`); this module fills
 * it with Post / Site / Archive / User / Term values â€” plus WooCommerce, ACF and
 * JetEngine when those plugins are active â€” so non-technical editors can bind
 * data from the left panel with no Twig. The Twig engine (Uich_Dynamic) still
 * powers loops / conditions / expressions for power users.
 *
 * No render-side plumbing is needed: the widget reads get_settings_for_display(),
 * which resolves the selected tag into the slot value automatically.
 *
 * This file is safe to load before Elementor: only the lightweight registrar is
 * defined here. The abstract bases and tag classes (which extend Elementor
 * classes) load lazily inside register(), on the `elementor/dynamic_tags/register`
 * hook â€” by which point Elementor is guaranteed to be present.
 *
 * @link    https://posimyth.com/
 * @since   5.1.0
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

if ( ! class_exists( 'Uich_Dynamic_Tags' ) ) {

	/**
	 * Registrar â€” wires the groups and tag classes into Elementor.
	 *
	 * @since 5.1.0
	 */
	class Uich_Dynamic_Tags {

		const GROUP_POST    = 'composer-post';
		const GROUP_SITE    = 'composer-site';
		const GROUP_ARCHIVE = 'composer-archive';
		const GROUP_USER    = 'composer-user';
		const GROUP_TERM    = 'composer-term';
		const GROUP_WOO     = 'composer-woo';
		const GROUP_ACF     = 'composer-acf';
		const GROUP_JET     = 'composer-jet';
		const GROUP_TWIG    = 'composer-twig';

		/**
		 * Hook into Elementor's dynamic-tags registration.
		 *
		 * @since 5.1.0
		 * @return void
		 */
		public static function init() {
			add_action( 'elementor/dynamic_tags/register', array( __CLASS__, 'register' ) );
		}

		/**
		 * Load the tag classes and register groups + instances.
		 *
		 * @since 5.1.0
		 * @param \Elementor\Core\DynamicTags\Manager $tags Elementor tags manager.
		 * @return void
		 */
		public static function register( $tags ) {
			self::load_tag_classes();

			// The base build registers the Post group and its four tags. Everything
			// else â€” the rest of Post, Term, Site, Archive, User, Custom (Twig),
			// WooCommerce, ACF and JetEngine â€” belongs to Pro, which ships those tag
			// files and hooks the action below. Free does not contain them at all, and
			// an unregistered tag resolves to an empty value in Elementor, so a
			// template imported from Pro renders that slot empty rather than silently
			// keeping Pro data. See docs/free-pro-split-plan.md.
			$tags->register_group(
				self::GROUP_POST,
				array( 'title' => esc_html__( 'UiChemy Â· Post', 'uichemy' ) )
			);

			self::register_classes( $tags, self::free_tag_classes() );

			/**
			 * Let this build register additional dynamic-tag groups and classes.
			 *
			 * Pro hooks this from includes/dynamic/dynamic-tags/class-uich-dynamic-tags-pro.php.
			 *
			 * @param \Elementor\Core\DynamicTags\Manager $tags Elementor tags manager.
			 */
			do_action( 'uichemy/dynamic_tags/register', $tags );
		}

		/**
		 * The only tags Free registers: Post Title, Post Content, Post URL and
		 * Post Image.
		 *
		 * Kept as an explicit list rather than a diff of core_tag_classes() so adding
		 * a tag to the library never widens Free by accident. Mirrors
		 * uichemy_dynamic_free_fields() on the Twig side â€” change both together.
		 *
		 * @since 5.1.0
		 * @return string[]
		 */
		private static function free_tag_classes() {
			/**
			 * Filter the dynamic-tag classes available in Free.
			 *
			 * @param string[] $classes Class names.
			 */
			return (array) apply_filters(
				'uichemy/dynamic_tags/free_classes',
				array(
					'Uich_DT_Post_Title',
					'Uich_DT_Post_Content',
					'Uich_DT_Post_Permalink',
					'Uich_DT_Post_Featured_Image',
				)
			);
		}

		/**
		 * Register a list of tag class names that exist.
		 *
		 * @since 5.1.0
		 * @param \Elementor\Core\DynamicTags\Manager $tags    Manager.
		 * @param string[]                            $classes Class names.
		 * @return void
		 */
		public static function register_classes( $tags, $classes ) {
			foreach ( $classes as $class ) {
				if ( class_exists( $class ) ) {
					$tags->register( new $class() );
				}
			}
		}

		/**
		 * Require the base + per-group tag definitions (Elementor present).
		 *
		 * @since 5.1.0
		 * @return void
		 */
		public static function load_tag_classes() {
			$dir = __DIR__ . '/tags/';

			// Only the shared base + the four free Post tags. Pro requires its own tag
			// files from class-uich-dynamic-tags-pro.php; they do not exist in Free.
			require_once $dir . 'class-uich-dt-base.php';
			require_once $dir . 'class-uich-dt-post.php';
		}
	}
}

Uich_Dynamic_Tags::init();
