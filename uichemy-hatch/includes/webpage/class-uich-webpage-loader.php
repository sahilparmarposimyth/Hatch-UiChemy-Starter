<?php
/**
 * AI Website Creator loader.
 *
 * Single entry point for the "AI Website Creator" flow — the import path that
 * pulls an AI-generated project from the user's AI Website Creator account and builds it
 * out on this site (Nexter theme + required plugins + globals + pages).
 *
 * It is reached from the dashboard's Import tab by picking the "AI Website
 * Creator" mode, and renders inside that tab's content area — there is no
 * separate admin menu, no separate React root and no page takeover. The React
 * side lives in new-dashboard/src/uichemy-webpage/ and is part of the one
 * dashboard bundle, so this class only has to register the runtime + REST
 * routes and hand the app its boot payload.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'UICH_WEBPAGE_PATH' ) ) {
	define( 'UICH_WEBPAGE_PATH', UICH_PATH . 'includes/webpage/' );
}

/**
 * Plugin version reported alongside error telemetry.
 */
if ( ! defined( 'UICH_WEBPAGE_VERSION' ) ) {
	define( 'UICH_WEBPAGE_VERSION', UICH_VERSION );
}

/**
 * AI Website Creator web app host — the OIDC provider this plugin signs in
 * against. Every OAuth endpoint (authorize / token / register-site / the shared
 * wp-callback) is derived from this, so pointing it at a dev server is a
 * one-line change in wp-config.php:
 *
 *   define( 'UICH_WEBPAGE_APP_URL', 'http://localhost:3000' );
 *
 * Distinct from UICH_WEBPAGE_API_URL below: that is the project data backend,
 * this is the app that issues the tokens.
 */
if ( ! defined( 'UICH_WEBPAGE_APP_URL' ) ) {
	define( 'UICH_WEBPAGE_APP_URL', 'https://app.uichemy.com' );
}

/**
 * Project API host. Projects, design concepts and the per-page export URLs all
 * come from here, authenticated with the OAuth access token this flow obtains.
 *
 * MUST resolve to the API deployment that shares a database with
 * UICH_WEBPAGE_APP_URL above. That is not a preference — the OAuth access token
 * this flow presents is a row in the app's `oauthAccessToken` collection, and
 * the API authenticates by looking that row up in ITS OWN database. Point the
 * two at differently-named databases and every call 401s with "Missing or
 * invalid session" while the app itself still reports the site as connected:
 * the token is perfectly valid, just invisible to the host being asked.
 *
 * That is exactly what the previous API host now does — it is a differently
 * branded deployment of the same backend, reading its own separate database, while
 * creator.uichemy.com writes to UiChemy's own. creator-api.uichemy.com is the
 * same backend deployed against the same database as the app.
 */
if ( ! defined( 'UICH_WEBPAGE_API_URL' ) ) {
	define( 'UICH_WEBPAGE_API_URL', 'https://creator-api.uichemy.com' );
}

/**
 * OAuth client id. This flow is a PUBLIC OAuth client and authenticates with
 * PKCE (RFC 7636), NOT a client_secret — there is deliberately no secret here.
 * Override per-site from wp-config.php if a different client is provisioned.
 */
if ( ! defined( 'UICH_WEBPAGE_CLIENT_ID' ) ) {
	define( 'UICH_WEBPAGE_CLIENT_ID', '8aca3061-e4be-4a64-a265-c4c40080b4c9' );
}

/**
 * Verify TLS certificates for outbound HTTP. Set false only on broken local CA bundles.
 */
if ( ! defined( 'UICH_WEBPAGE_HTTP_SSLVERIFY' ) ) {
	define( 'UICH_WEBPAGE_HTTP_SSLVERIFY', true );
}

if ( ! function_exists( 'uich_webpage_http_sslverify' ) ) {
	/**
	 * Whether this flow's wp_remote_* calls should verify SSL peer certificates.
	 *
	 * @return bool
	 */
	function uich_webpage_http_sslverify() {
		/**
		 * Filters SSL peer verification for every AI Website Creator HTTP client.
		 *
		 * @param bool $verify Default from UICH_WEBPAGE_HTTP_SSLVERIFY.
		 */
		return (bool) apply_filters( 'uich_webpage_http_sslverify', (bool) UICH_WEBPAGE_HTTP_SSLVERIFY );
	}
}

if ( ! class_exists( 'Uich_Webpage_Loader' ) ) {

	final class Uich_Webpage_Loader {

		/**
		 * Global the React app reads its configuration from.
		 */
		const BOOT_GLOBAL = 'uich_webpage_boot';

		private static $instance;

		public static function get_instance() {
			if ( ! isset( self::$instance ) ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		private function __construct() {
			require_once UICH_WEBPAGE_PATH . 'class-uich-webpage-auth.php';
			require_once UICH_WEBPAGE_PATH . 'class-uich-webpage-api.php';
			require_once UICH_WEBPAGE_PATH . 'class-uich-webpage-block-processor.php';
			require_once UICH_WEBPAGE_PATH . 'class-uich-webpage-import.php';
			require_once UICH_WEBPAGE_PATH . 'class-uich-webpage-nexter-settings.php';

			( new Uich_Webpage_Auth() )->init();
			( new Uich_Webpage_Api() )->init();
			( new Uich_Webpage_Import() )->init();
			( new Uich_Webpage_Nexter_Settings() )->init();

			/*
			 * Priority 20 so this runs after Uich_ND_Enqueue::enqueue() (priority
			 * 10) has registered the dashboard handle — wp_localize_script() needs
			 * the handle to exist. Attaching to that same handle, rather than
			 * enqueueing a bundle of our own, is what keeps this flow inside the
			 * Import tab's React tree instead of a second root on the page.
			 */
			add_action( 'admin_enqueue_scripts', array( $this, 'localize_boot_payload' ), 20, 1 );

			/*
			 * Revalidate BEFORE anything reads the auth state — priority 5, ahead of
			 * Uich_ND_Enqueue::enqueue() at 10.
			 *
			 * The session check used to live only in boot_payload() at priority 20,
			 * which is too late: by then Uich_ND_Auth::get_boot_state() has already
			 * put `isAuthed: true` into the dashboard payload, read straight from the
			 * stored token. So on the very page load where the account turned out to
			 * be disconnected, validate_session() would sign the site out AFTER the
			 * screen had been told it was signed in — the dashboard rendered as
			 * logged in and only the NEXT reload showed the truth. That looked
			 * exactly like "signing out from the app does nothing on WordPress".
			 *
			 * Doing it here costs no extra request: validate_session() caches a
			 * confirmed result (TRANSIENT_SESSION_OK), so the call still sitting in
			 * boot_payload() becomes a no-op for the rest of that window.
			 */
			add_action( 'admin_enqueue_scripts', array( $this, 'revalidate_session' ), 5, 1 );
		}

		/**
		 * Confirm the account is still connected, early enough that every consumer
		 * of the auth state on this request sees the same answer.
		 *
		 * @param string $page Current admin page hook suffix.
		 * @return void
		 */
		public function revalidate_session( $page ) {
			if ( ! class_exists( 'Uich_ND_Enqueue' ) ) {
				return;
			}
			if ( ! in_array( $page, Uich_ND_Enqueue::page_hooks(), true ) ) {
				return;
			}

			( new Uich_Webpage_Auth() )->validate_session();
		}

		/**
		 * Attach the flow's configuration to the dashboard script.
		 *
		 * @param string $page Current admin page hook suffix.
		 * @return void
		 */
		public function localize_boot_payload( $page ) {
			if ( ! class_exists( 'Uich_ND_Enqueue' ) ) {
				return;
			}
			if ( ! in_array( $page, Uich_ND_Enqueue::page_hooks(), true ) ) {
				return;
			}
			if ( ! wp_script_is( Uich_ND_Enqueue::HANDLE_JS, 'registered' ) ) {
				return;
			}

			wp_localize_script( Uich_ND_Enqueue::HANDLE_JS, self::BOOT_GLOBAL, self::boot_payload() );
		}

		/**
		 * Bootstrap data injected as `window.uich_webpage_boot`.
		 *
		 * Deliberately does NOT pre-fetch the OAuth authorize URL: minting one
		 * costs a round trip to the auth server and rotates the stored PKCE
		 * verifier, so it is fetched over REST only when the user actually
		 * clicks "Log in".
		 *
		 * Note on `isAuthenticated`: wp_localize_script() stringifies scalars, so
		 * this reaches JS as "1" or "" — both of which coerce correctly. Do NOT
		 * "tidy" it into an int: false would then arrive as the string "0",
		 * which is truthy in JavaScript and would show the project list to a
		 * site with no account connected.
		 *
		 * @return array
		 */
		public static function boot_payload() {
			$auth = new Uich_Webpage_Auth();

			// Confirm with the app that this site is still connected before telling
			// the dashboard we're signed in. Without this the screen renders from
			// our own stored token alone, so a site signed out from the UiChemy
			// dashboard would keep showing a logged-in UI indefinitely. Throttled
			// internally, and it never signs anyone out over a network hiccup.
			$auth->validate_session();

			return array(
				'restUrl'         => esc_url_raw( rest_url( 'uichemy/v2/webpage/' ) ),
				'nonce'           => wp_create_nonce( 'wp_rest' ),
				'siteUrl'         => home_url( '/' ),
				// Base for this flow's own images (assets/images/webpage/*). Sent
				// from PHP rather than derived in JS so the path survives a plugin
				// folder rename or a non-standard wp-content location.
				'assetsUrl'       => esc_url_raw( UICH_URL . 'assets/images/webpage/' ),
				'isAuthenticated' => $auth->is_authenticated(),
				'userInfo'        => $auth->get_user_info(),
				'userId'          => $auth->get_user_id(),
			);
		}
	}

	Uich_Webpage_Loader::get_instance();
}
