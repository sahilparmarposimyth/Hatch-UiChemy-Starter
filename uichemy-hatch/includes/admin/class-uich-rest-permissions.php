<?php
/**
 * Central permission callback for all UiChemy REST routes.
 *
 * Every REST route is admin-only (`manage_options`). Authentication
 * happens via the native WordPress Application Passwords flow
 * (HTTP Basic auth) handled by `wp_authenticate_application_password`.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Rest_Permissions' ) ) {

	class Uich_Rest_Permissions {

		/**
		 * Admin-only permission gate used by every UiChemy REST route.
		 * Passes when the current user can manage_options (administrator),
		 * authenticated either via cookie + nonce or via an Application
		 * Password sent as HTTP Basic auth.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return bool|WP_Error
		 */
		public static function check_admin( WP_REST_Request $request ) {
			if ( current_user_can( 'manage_options' ) ) {
				return true;
			}
			return new WP_Error(
				'rest_forbidden',
				__( 'Sorry, only administrators can use UiChemy endpoints.', 'uichemy' ),
				array( 'status' => 403 )
			);
		}
	}
}
