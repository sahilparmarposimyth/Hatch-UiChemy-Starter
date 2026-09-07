<?php
/**
 * Dashboard authentication gate.
 *
 * The dashboard is gated behind an AI Website Creator account, and
 * this class is the gate — but it owns no auth machinery of its own. The real
 * client is Uich_Webpage_Auth (includes/webpage/), an OAuth2 + PKCE public
 * client against UICH_WEBPAGE_APP_URL. This class reads that one token store and
 * shapes it for the React side.
 *
 * That is the point of the rewrite: the plugin used to hold TWO independent
 * logins — an opaque-token SSO against app.uichemy.com for the dashboard, and
 * the OAuth flow for the Import tab — so an admin signed in twice. There is now
 * one flow, one token store, one logout.
 *
 * Flow, end to end:
 *
 *   1. React's LoginScreen calls GET uichemy/v2/webpage/auth/authorize-url,
 *      which mints a PKCE pair and registers this site with the app.
 *   2. The browser goes to the app's /api/auth/oauth2/authorize. The app shows
 *      its login and (first time only) consent screen.
 *   3. The app relays the authorization code back to
 *      admin.php?page=uichemy&uichemy_code=CODE, where
 *      Uich_Webpage_Auth::handle_oauth_callback() exchanges it for tokens.
 *   4. Tokens land encrypted in the uich_webpage_* options; is_authed() below
 *      turns true and App.jsx's gate lets the user through.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Auth' ) ) {

	final class Uich_ND_Auth {

		/**
		 * UiChemy's own API host — the managed-plugin version manifest and the
		 * install package (see Uich_ND_Settings::fetch_managed_versions_raw()
		 * and Uich_ND_Installer::uichemy_zip_url()).
		 *
		 * Deliberately unrelated to authentication: both endpoints are public,
		 * and neither has anything to do with the token store. It lives here
		 * only because both callers already reference it from this class.
		 */
		// const API_BASE = 'http://localhost:8000';
		const API_BASE = 'https://core.uichemy.com';

		/** Clear the connected account. React's signOut() posts to this. */
		const AJAX_LOGOUT  = 'uich_nd_sso_logout';
		const NONCE_LOGOUT = 'uich_nd_sso_logout';

		/*
		-------------------------------------------------------------
			Retired SSO option keys.

			Kept only so cleanup_legacy_sso() can delete them. Nothing reads
			these any more — the token store is Uich_Webpage_Auth's.
			------------------------------------------------------------- */

		const OPT_LEGACY_TOKEN        = 'uich_nd_sso_token';
		const OPT_LEGACY_TOKEN_AT     = 'uich_nd_sso_token_at';
		const OPT_LEGACY_LICENSE_DATA = 'uich_nd_license_data';
		const OPT_LEGACY_SESSION_DATA = 'uich_nd_license_session';
		const META_LEGACY_PENDING     = 'uich_nd_sso_pending';

		/** Marks the one-time legacy cleanup as done. */
		const OPT_CLEANUP_DONE = 'uich_nd_sso_cleanup_done';

		public static function boot() {
			add_action( 'wp_ajax_' . self::AJAX_LOGOUT, array( __CLASS__, 'ajax_logout' ) );

			// Admin-only: the legacy rows are harmless until someone loads
			// wp-admin, and this keeps the cost off front-end requests.
			add_action( 'admin_init', array( __CLASS__, 'cleanup_legacy_sso' ) );
		}

		/*
		-------------------------------------------------------------
			The OAuth client
			------------------------------------------------------------- */

		/**
		 * The single OAuth client both this gate and the Import tab share.
		 *
		 * Uich_Webpage_Auth keeps all its state in options, so a fresh instance
		 * is as good as a cached one. Returns null when includes/webpage/ hasn't
		 * loaded yet — it is required later in the plugin's dependency list than
		 * this file, and callers must not assume it exists.
		 *
		 * @return Uich_Webpage_Auth|null
		 */
		private static function client() {
			return class_exists( 'Uich_Webpage_Auth' ) ? new Uich_Webpage_Auth() : null;
		}

		/**
		 * Is an AI Website Creator account connected to this site?
		 *
		 * Presence of an access token, not proof that it still works. A revoked
		 * token reads as authed here and is caught on the first API call, which
		 * refreshes it or signs the site out.
		 *
		 * @return bool
		 */
		public static function is_authed() {
			$client = self::client();
			return $client ? (bool) $client->is_authenticated() : false;
		}

		/**
		 * The connected account, decoded from the OAuth id_token.
		 *
		 * @return array|null  { sub, name, email, picture, ... } or null.
		 */
		public static function get_account() {
			$client = self::client();
			if ( ! $client ) {
				return null;
			}
			$info = $client->get_user_info();
			return is_array( $info ) ? $info : null;
		}

		/**
		 * Email of the connected account, for the profile Gravatar.
		 *
		 * @return string  Empty when no account is connected.
		 */
		public static function get_account_email() {
			$account = self::get_account();
			return ( is_array( $account ) && ! empty( $account['email'] ) && is_string( $account['email'] ) )
				? $account['email']
				: '';
		}

		/*
		-------------------------------------------------------------
			Boot state for React
			------------------------------------------------------------- */

		/**
		 * Auth snapshot for `window.uich_nd_boot.auth`.
		 *
		 * `licenseData` is a COMPATIBILITY SHAPE, not license data — the name is
		 * what WizardShell.jsx and WebShell.jsx already read the account name and
		 * email from, and those screens are unchanged by design. `licenses` is
		 * always empty, which is exactly what makes the profile menu's "Switch
		 * license" item hide itself. Rename it only alongside those components.
		 *
		 * `capacity` is only looked up when authed — a signed-out site has no
		 * account to ask, and get_capacity_plan() answers "purchased" for that
		 * case anyway (fail open), so the remote call would just be wasted.
		 *
		 * @return array
		 */
		public static function get_boot_state() {
			$account = self::get_account();
			$authed  = self::is_authed();

			return array(
				'isAuthed'    => $authed,
				'logoutNonce' => wp_create_nonce( self::NONCE_LOGOUT ),
				'licenseData' => array(
					'data' => array(
						'user'     => $account ? $account : null,
						'licenses' => array(),
					),
				),
				'capacity'    => $authed ? self::get_capacity_plan() : array(
					'plan'      => '',
					'purchased' => true,
				),
			);
		}

		public static function get_capacity_plan() {
			$client = self::client();
			$body   = $client ? $client->get_capacity() : false;

			if ( false === $body || ! array_key_exists( 'capacity', $body ) ) {
				return array(
					'plan'      => '',
					'purchased' => true,
				);
			}

			$capacity = $body['capacity'];
			$plan     = ( is_array( $capacity ) && ! empty( $capacity['plan'] ) && is_string( $capacity['plan'] ) )
				? strtoupper( $capacity['plan'] )
				: 'FREE';

			return array(
				'plan'      => $plan,
				'purchased' => 'FREE' !== $plan,
			);
		}

		/*
		-------------------------------------------------------------
			AJAX
			------------------------------------------------------------- */

		/**
		 * Disconnect the account. Clears the shared token store, so the
		 * dashboard gate and the Import tab both sign out together.
		 */
		public static function ajax_logout() {
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_send_json_error(
					array(
						'code'    => 'forbidden',
						'message' => __( 'Insufficient permissions.', 'uichemy' ),
					),
					403
				);
			}
			check_ajax_referer( self::NONCE_LOGOUT, 'nonce' );

			$client = self::client();
			if ( $client ) {
				$client->logout();
			}

			wp_send_json_success( array( 'isAuthed' => false ) );
		}

		/*
		-------------------------------------------------------------
			Migration
			------------------------------------------------------------- */

		/**
		 * Delete the retired app.uichemy.com SSO state, once per site.
		 *
		 * Nothing reads these rows any more, so this is housekeeping rather than
		 * a functional migration — the old opaque token could not be carried
		 * over regardless: it was issued by a different auth server. Sites that
		 * were signed in before the update land on the login screen and sign in
		 * once through the AI Website Creator.
		 */
		public static function cleanup_legacy_sso() {
			if ( get_option( self::OPT_CLEANUP_DONE ) ) {
				return;
			}

			delete_option( self::OPT_LEGACY_TOKEN );
			delete_option( self::OPT_LEGACY_TOKEN_AT );
			delete_option( self::OPT_LEGACY_LICENSE_DATA );
			delete_option( self::OPT_LEGACY_SESSION_DATA );
			delete_metadata( 'user', 0, self::META_LEGACY_PENDING, '', true );

			update_option( self::OPT_CLEANUP_DONE, 1, false );
		}
	}
}
