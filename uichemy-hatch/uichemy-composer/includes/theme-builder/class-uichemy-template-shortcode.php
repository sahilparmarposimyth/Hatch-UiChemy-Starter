<?php
/**
 * UiChemy_Template_Shortcode — render a Theme Builder template anywhere.
 *
 * `[uichemy_template id="123"]` drops a template into any post, widget or
 * builder that runs shortcodes. Theme Builder templates otherwise only appear
 * where their own location + display conditions put them; this is the escape
 * hatch for "I want this exact section here".
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Template_Shortcode' ) ) {

	/**
	 * The `[uichemy_template]` shortcode.
	 */
	class UiChemy_Template_Shortcode {

		/**
		 * The shortcode tag.
		 *
		 * ONE-WAY DOOR. The moment a user pastes this into a post it becomes part
		 * of their content, so renaming it later leaves that content rendering the
		 * literal text instead of the template — the same trap the Elementor widget
		 * slug carries. It mirrors the CPT name (`uichemy_template`) deliberately,
		 * so there is one obvious spelling rather than a second vocabulary.
		 */
		const TAG = 'uichemy_template';

		/**
		 * Templates currently being rendered, by ID.
		 *
		 * A template that contains its own shortcode — or two that contain each
		 * other — would recurse until the request dies. Tracking the open renders
		 * turns that into a silently skipped embed.
		 *
		 * @var array<int,bool>
		 */
		private static $rendering = array();

		/**
		 * @return void
		 */
		public static function init() {
			add_shortcode( self::TAG, array( __CLASS__, 'render' ) );
		}

		/**
		 * The shortcode string for a template, so PHP stays the only place that
		 * knows how the tag is spelled (the dashboard copies this verbatim).
		 *
		 * @param int $id Template post ID.
		 * @return string
		 */
		public static function for_id( $id ) {
			return sprintf( '[%s id="%d"]', self::TAG, (int) $id );
		}

		/**
		 * Render the referenced template.
		 *
		 * @param array|string $atts Shortcode attributes.
		 * @return string Rendered HTML, or '' when there is nothing to show.
		 */
		public static function render( $atts ) {
			$atts = shortcode_atts( array( 'id' => 0 ), $atts, self::TAG );
			$id   = absint( $atts['id'] );

			if ( ! $id || ! class_exists( 'UiChemy_Template_Store' ) || ! UiChemy_Template_Store::is_template( $id ) ) {
				return '';
			}

			// A draft or private template is not public content: show it only to
			// someone who could open it in the editor anyway.
			if ( 'publish' !== get_post_status( $id ) && ! current_user_can( 'edit_post', $id ) ) {
				return '';
			}

			if ( isset( self::$rendering[ $id ] ) ) {
				return '';
			}

			self::$rendering[ $id ] = true;
			try {
				// Elementor's own CSS is inlined by get_render_html_for(), but its
				// base frontend styles (and the block library, for a
				// Gutenberg-authored template) still have to be on the page.
				UiChemy_Template_Render::enqueue_elementor_styles();
				return UiChemy_Template_Render::get_render_html_for( $id );
			} finally {
				unset( self::$rendering[ $id ] );
			}
		}
	}
}
