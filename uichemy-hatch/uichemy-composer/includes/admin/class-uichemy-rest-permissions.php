<?php
/**
 * Central permission callback for all UiChemy REST routes.
 *
 * Every REST route is admin-only (`manage_options`). Authentication
 * happens via the native WordPress Application Passwords flow
 * (HTTP Basic auth) handled by `wp_authenticate_application_password`.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Rest_Permissions' ) ) {

	class UiChemy_Rest_Permissions {

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

		/**
		 * Feature-scoped gate. Passes for administrators, or for any user whose
		 * role has been granted the given UiChemy feature in the Role Manager
		 * (see UiChemy_Roles::can_use()). Used to widen otherwise admin-only
		 * routes — e.g. the design-system (globals/variables/classes) and
		 * AI-chat endpoints — to editor roles when an admin opts in.
		 *
		 * Pro-only features (uichemy_editor_pro_features() — currently `ai_chat`,
		 * i.e. the whole Chat tab) are refused here BEFORE the administrator
		 * bypass: in Free nobody may reach them, admins included. This is the real
		 * boundary — hiding the Chat tab in the React panel is cosmetic on its own,
		 * since the routes could still be called directly with a valid nonce.
		 *
		 * @param string $feature One of UiChemy_Roles::FEATURES.
		 * @return bool|WP_Error
		 */
		public static function check_feature( $feature ) {
			if ( function_exists( 'uichemy_editor_feature_allowed' ) && ! uichemy_editor_feature_allowed( $feature ) ) {
				return new WP_Error(
					'uichemy_pro_required',
					__( 'This is a UiChemy Pro feature.', 'uichemy' ),
					array(
						'status'     => 403,
						'upgradeUrl' => function_exists( 'uichemy_upgrade_url' ) ? uichemy_upgrade_url( 'composer-' . str_replace( '_', '-', (string) $feature ) ) : '',
					)
				);
			}

			if ( current_user_can( 'manage_options' ) ) {
				return true;
			}
			if ( class_exists( 'UiChemy_Roles' ) && UiChemy_Roles::can_use( $feature ) ) {
				return true;
			}
			return new WP_Error(
				'rest_forbidden',
				__( 'Sorry, you are not allowed to use this UiChemy feature.', 'uichemy' ),
				array( 'status' => 403 )
			);
		}
	}
}
