<?php
/**
 * UiChemy_Theme_Builder_REST — read the active Theme Builder templates over REST.
 *
 * Exposes a single read-only endpoint that returns whichever UiChemy templates
 * are currently ACTIVE (header, footer, single, archive, …) together with their
 * metadata and, by default, their rendered HTML. Consumers (the UiChemy app, an
 * external service, a headless front end) call it to learn what the Theme
 * Builder is serving without having to query the CPT/meta themselves.
 *
 *   GET /wp-json/uichemy/v1/theme-builder/active
 *       ?type=header        Optional. Limit to one location type.
 *       &render=0           Optional. Omit the rendered `html` field.
 *
 * Response:
 *   {
 *     "success": true,
 *     "types":   [ "header", "footer", … ],
 *     "active":  {
 *       "header": [ { id, title, type, target, editor, status, conditions,
 *                     date, modified, edit_link, preview_link, html? } ],
 *       "footer": [ … ],
 *       …
 *     }
 *   }
 *
 * Each type maps to an ARRAY because single/archive can have several active
 * templates at once (one per target slot); header/footer will hold 0 or 1.
 *
 * Read-only + capability gated (same policy as the rest of UiChemy's REST
 * surface): it never writes, but it returns edit links and site structure, so
 * it requires a logged-in user who can edit.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Theme_Builder_REST' ) ) {

	/**
	 * REST route for reading active Theme Builder templates.
	 */
	class UiChemy_Theme_Builder_REST {

		const REST_NAMESPACE = 'uichemy/v1';

		/**
		 * Hook route registration. Registered unconditionally (REST requests do
		 * not reliably set is_admin()), so it is available on every REST request.
		 *
		 * @return void
		 */
		public static function init() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		}

		/**
		 * Register GET /uichemy/v1/theme-builder/active.
		 *
		 * @return void
		 */
		public static function register_routes() {
			register_rest_route(
				self::REST_NAMESPACE,
				'/theme-builder/active',
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'handle_get_active' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
						'args'                => array(
							'type'   => array(
								'required'    => false,
								'type'        => 'string',
								'description' => 'Limit to one location type (header, footer, single, archive, single_product, product_archive, search, error_404).',
							),
							'render' => array(
								'required'    => false,
								'type'        => 'boolean',
								'default'     => true,
								'description' => 'Include each template\'s rendered HTML. Set to 0/false to omit.',
							),
						),
					),
				)
			);
		}

		/**
		 * Capability check. This endpoint exposes Theme Builder structure (active
		 * templates, their display conditions, edit + signed preview links), so it
		 * is gated to users allowed to use the Theme Builder — not merely anyone
		 * who can open the composer. That matches the Theme Builder admin surface,
		 * which requires `manage_options` (UiChemy_Theme_Builder_Admin).
		 *
		 * UiChemy_Roles::can_use('theme_builder') already grants administrators
		 * (manage_options) unconditionally and non-admins only when their role has
		 * the Theme Builder feature flag AND composer access. On top of the
		 * capability, WordPress's REST layer still enforces cookie-nonce / app-
		 * password authentication before this callback runs.
		 *
		 * @return bool
		 */
		public static function check_permission() {
			if ( class_exists( 'UiChemy_Roles' ) ) {
				return UiChemy_Roles::can_use( 'theme_builder' );
			}
			return is_user_logged_in() && current_user_can( 'manage_options' );
		}

		/**
		 * GET handler — return the active templates grouped by type.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_get_active( $request ) {
			if ( ! class_exists( 'UiChemy_Template_CPT' ) || ! class_exists( 'UiChemy_Template_Store' ) ) {
				return new WP_Error( 'uichemy_tb_missing', 'Theme Builder is not initialised.', array( 'status' => 500 ) );
			}

			$render = self::truthy( $request->get_param( 'render' ) );

			// Which types to report: one requested type, or all of them.
			$requested = $request->get_param( 'type' );
			if ( null !== $requested && '' !== (string) $requested ) {
				$type = sanitize_key( (string) $requested );
				if ( ! UiChemy_Template_CPT::is_valid_type( $type ) ) {
					if ( UiChemy_Template_CPT::is_known_type( $type ) ) {
						return new WP_Error(
							'uichemy_tb_pro_type',
							sprintf( '"%s" templates are a UiChemy Pro feature.', $type ),
							array( 'status' => 403 )
						);
					}
					return new WP_Error(
						'uichemy_tb_bad_type',
						'Unknown template type. Must be one of: ' . implode( ', ', UiChemy_Template_CPT::allowed_types() ) . '.',
						array( 'status' => 400 )
					);
				}
				$types = array( $type );
			} else {
				$types = UiChemy_Template_CPT::allowed_types();
			}

			$active = array();
			foreach ( $types as $type ) {
				$active[ $type ] = array();
				foreach ( UiChemy_Template_Store::get_active( $type ) as $id ) {
					$active[ $type ][] = self::serialize_template( (int) $id, $type, $render );
				}
			}

			return rest_ensure_response(
				array(
					'success' => true,
					'types'   => array_values( $types ),
					'active'  => $active,
				)
			);
		}

		/**
		 * Build the response object for a single active template.
		 *
		 * @param int    $id     Template post ID.
		 * @param string $type   Location type.
		 * @param bool   $render Whether to include rendered HTML.
		 * @return array
		 */
		private static function serialize_template( $id, $type, $render ) {
			$editor     = UiChemy_Template_CPT::editor_for( $id );
			$conditions = get_post_meta( $id, UiChemy_Template_CPT::META_CONDITIONS, true );

			$data = array(
				'id'           => $id,
				'title'        => get_the_title( $id ),
				'type'         => $type,
				'target'       => UiChemy_Template_CPT::target_for( $id ),
				'editor'       => $editor,
				'status'       => 'active',
				'conditions'   => is_array( $conditions ) ? $conditions : array(),
				'date'         => get_post_time( 'c', true, $id ),
				'modified'     => get_post_modified_time( 'c', true, $id ),
				'edit_link'    => self::edit_link( $id, $editor ),
				'preview_link' => self::preview_link( $id ),
			);

			if ( $render && class_exists( 'UiChemy_Template_Render' ) ) {
				$data['html'] = UiChemy_Template_Render::get_render_html_for( $id );
			}

			return $data;
		}

		/**
		 * The editor URL for a template (Elementor canvas or the block editor).
		 *
		 * @param int    $id     Template post ID.
		 * @param string $editor 'elementor'|'gutenberg'.
		 * @return string
		 */
		private static function edit_link( $id, $editor ) {
			if ( 'elementor' === $editor ) {
				return add_query_arg(
					array(
						'post'   => $id,
						'action' => 'elementor',
					),
					admin_url( 'post.php' )
				);
			}
			$link = get_edit_post_link( $id, 'raw' );
			return $link ? $link : '';
		}

		/**
		 * A signed, isolated front-end preview URL for a template — the same
		 * nonce contract UiChemy_Template_Render::maybe_preview() verifies.
		 *
		 * @param int $id Template post ID.
		 * @return string
		 */
		private static function preview_link( $id ) {
			return add_query_arg(
				array(
					'uichemy_tb_preview' => $id,
					'_wpnonce'           => wp_create_nonce( 'uichemy_tb_preview_' . $id ),
				),
				home_url( '/' )
			);
		}

		/**
		 * Loose-truthy read of a REST param (accepts 1/0, true/false, "true"/"false").
		 *
		 * @param mixed $value Raw value.
		 * @return bool
		 */
		private static function truthy( $value ) {
			if ( is_bool( $value ) ) {
				return $value;
			}
			$value = strtolower( trim( (string) $value ) );
			return ! in_array( $value, array( '0', 'false', 'no', 'off', '' ), true );
		}
	}
}
