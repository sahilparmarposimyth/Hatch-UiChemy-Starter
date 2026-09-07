<?php
/**
 * REST controller for the #uichemy-globals CSS block.
 *
 * Thin HTTP layer over the block: GET returns the raw CSS plus the parsed model
 * (tokens + classes) so the Globals Manager can render controls; POST upserts
 * the block in place via the Composer Manager (surrounding head markup preserved).
 *
 * Routes (admin-only):
 *   GET  /uichemy/v1/globals-css  → { css, tokens, classes }
 *   POST /uichemy/v1/globals-css  → { success, css, tokens, classes }
 *
 * @package UiChemy
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

if ( ! class_exists( 'UiChemy_Globals_CSS_Rest' ) ) {

	/**
	 * Registers and serves the globals-css REST routes.
	 */
	class UiChemy_Globals_CSS_Rest {

		const REST_NS = 'uichemy/v1';
		const ROUTE   = '/globals-css';

		/**
		 * Hook registration.
		 *
		 * @return void
		 */
		public static function init() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		}

		/**
		 * Register GET/POST routes.
		 *
		 * @return void
		 */
		public static function register_routes() {
			register_rest_route(
				self::REST_NS,
				self::ROUTE,
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'rest_get' ),
						'permission_callback' => array( __CLASS__, 'rest_permission' ),
					),
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'rest_save' ),
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
		 * GET — current block CSS + parsed model.
		 *
		 * @return \WP_REST_Response
		 */
		public static function rest_get() {
			return rest_ensure_response( self::payload() );
		}

		/**
		 * POST — replace the block with the supplied CSS.
		 *
		 * @param \WP_REST_Request $request Request ({ css: string }).
		 * @return \WP_REST_Response
		 */
		public static function rest_save( $request ) {
			$body = $request->get_json_params();
			$css  = ( is_array( $body ) && isset( $body['css'] ) ) ? (string) $body['css'] : '';

			UiChemy_Composer_Manager::upsert_globals_block( $css );

			$payload            = self::payload();
			$payload['success'] = true;
			return rest_ensure_response( $payload );
		}

		/**
		 * Build the { css, tokens, classes } payload from the stored block.
		 *
		 * @return array
		 */
		private static function payload() {
			$css   = UiChemy_Composer_Manager::get_globals_block_css();
			$model = UiChemy_Globals_CSS::parse( $css );
			return array(
				'css'     => $css,
				'tokens'  => $model['tokens'],
				'classes' => $model['classes'],
			);
		}
	}

	UiChemy_Globals_CSS_Rest::init();
}
