<?php
/**
 * REST controller for the Globals Manager ⇄ Elementor kit sync.
 *
 * The #uichemy-globals CSS block stays UiChemy's source of truth; these routes
 * only bridge it to the active Elementor kit's Site Settings globals so the
 * Globals Manager's "Elementor Sync" button can read the kit tokens (to diff)
 * and push the missing ones in.
 *
 * Routes (admin-only):
 *   GET  /uichemy/v1/elementor-globals       → { available, colors, typography }
 *   POST /uichemy/v1/elementor-globals/sync  → { success, added: { colors, typography } }
 *     body: { colors: [ { id, title, value } ],
 *             typography: [ { id, title, value: { typography_* } } ] }
 *
 * @package UiChemy
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

if ( ! class_exists( 'UiChemy_Elementor_Globals_Rest' ) ) {

	/**
	 * Registers and serves the elementor-globals sync routes.
	 */
	class UiChemy_Elementor_Globals_Rest {

		const REST_NS = 'uichemy/v1';

		/**
		 * Hook registration.
		 *
		 * @return void
		 */
		public static function init() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		}

		/**
		 * Register the GET (read) and POST (sync) routes.
		 *
		 * @return void
		 */
		public static function register_routes() {
			register_rest_route(
				self::REST_NS,
				'/elementor-globals',
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'rest_get' ),
						'permission_callback' => array( __CLASS__, 'rest_permission' ),
					),
				)
			);
			register_rest_route(
				self::REST_NS,
				'/elementor-globals/sync',
				array(
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'rest_sync' ),
						'permission_callback' => array( __CLASS__, 'rest_permission' ),
					),
				)
			);
		}

		/**
		 * Admin-only, mirroring the other globals endpoints.
		 *
		 * @param \WP_REST_Request $request Request.
		 * @return bool|\WP_Error
		 */
		public static function rest_permission( $request ) {
			if ( class_exists( 'UiChemy_Rest_Permissions' ) ) {
				return UiChemy_Rest_Permissions::check_feature( 'design_system' );
			}
			return current_user_can( 'manage_options' );
		}

		/**
		 * GET — current kit colours + typography (empty + available:false when
		 * Elementor is inactive).
		 *
		 * @return \WP_REST_Response
		 */
		public static function rest_get() {
			if ( ! UiChemy_Elementor_Globals::is_available() ) {
				return rest_ensure_response(
					array(
						'available'  => false,
						'colors'     => array(),
						'typography' => array(),
					)
				);
			}
			return rest_ensure_response(
				array(
					'available'  => true,
					'colors'     => UiChemy_Elementor_Globals::get_colors(),
					'typography' => UiChemy_Elementor_Globals::get_typography(),
				)
			);
		}

		/**
		 * POST — create-or-update the supplied colours + typography on the kit.
		 *
		 * @param \WP_REST_Request $request Request.
		 * @return \WP_REST_Response|\WP_Error
		 */
		public static function rest_sync( $request ) {
			// Elementor global-sync is a Pro-only feature — blocked server-side so a
			// crafted request can't bypass the locked UI in the Free build.
			if ( ! uichemy_is_pro() ) {
				return new WP_Error( 'uichemy_pro_only', 'Elementor Sync is a UiChemy Pro feature.', array( 'status' => 403 ) );
			}
			if ( ! UiChemy_Elementor_Globals::is_available() ) {
				return new WP_Error( 'uichemy_no_elementor', 'Elementor is not active.', array( 'status' => 400 ) );
			}

			$body       = $request->get_json_params();
			$colors     = ( is_array( $body ) && isset( $body['colors'] ) && is_array( $body['colors'] ) ) ? $body['colors'] : array();
			$typography = ( is_array( $body ) && isset( $body['typography'] ) && is_array( $body['typography'] ) ) ? $body['typography'] : array();

			// Sanitize into plain rows, then apply everything in ONE kit save.
			$color_rows = array();
			foreach ( $colors as $c ) {
				if ( empty( $c['id'] ) ) {
					continue;
				}
				$value = isset( $c['value'] ) ? sanitize_text_field( $c['value'] ) : '';
				// A blank colour value would render as `--e-global-color-x: ;`
				// (invalid CSS), so skip it rather than persist an empty token.
				if ( '' === trim( $value ) ) {
					continue;
				}
				$color_rows[] = array(
					'id'    => sanitize_text_field( $c['id'] ),
					'title' => isset( $c['title'] ) ? sanitize_text_field( $c['title'] ) : sanitize_text_field( $c['id'] ),
					'value' => $value,
				);
			}

			$typo_rows = array();
			foreach ( $typography as $t ) {
				if ( empty( $t['id'] ) ) {
					continue;
				}
				$value = self::sanitize_typography_value( isset( $t['value'] ) ? $t['value'] : array() );
				if ( empty( $value ) ) {
					continue;
				}
				$typo_rows[] = array(
					'id'    => sanitize_text_field( $t['id'] ),
					'title' => isset( $t['title'] ) ? sanitize_text_field( $t['title'] ) : sanitize_text_field( $t['id'] ),
					'value' => $value,
				);
			}

			$added = UiChemy_Elementor_Globals::set_or_create_many( $color_rows, $typo_rows );

			return rest_ensure_response(
				array(
					'success' => true,
					'added'   => array(
						'colors'     => $added['colors'],
						'typography' => $added['typography'],
					),
				)
			);
		}

		/**
		 * Whitelist + sanitize a typography value map from the request so only
		 * Elementor `typography_*` keys reach the kit (never arbitrary settings).
		 * Values are scalars or one-level { unit, size, ... } arrays of scalars.
		 *
		 * @param mixed $value Raw value from the request body.
		 * @return array Sanitized typography_* map.
		 */
		private static function sanitize_typography_value( $value ) {
			if ( ! is_array( $value ) ) {
				return array();
			}
			$out = array();
			foreach ( $value as $key => $v ) {
				if ( ! is_string( $key ) || ! preg_match( '/^typography_[a-z0-9_]+$/', $key ) ) {
					continue;
				}
				if ( is_array( $v ) ) {
					$sub = array();
					foreach ( $v as $sk => $sv ) {
						if ( is_array( $sv ) || is_object( $sv ) ) {
							continue;
						}
						$sub[ sanitize_key( (string) $sk ) ] = sanitize_text_field( (string) $sv );
					}
					$out[ $key ] = $sub;
				} else {
					$out[ $key ] = sanitize_text_field( (string) $v );
				}
			}
			return $out;
		}
	}

	UiChemy_Elementor_Globals_Rest::init();
}
