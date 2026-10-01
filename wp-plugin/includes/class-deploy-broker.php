<?php
/**
 * Deploy Broker client — v0.20.0.
 *
 * Flow for both providers (vercel + cloudflare):
 *
 *   1. User submits the wizard's deploy form with `provider` + token field
 *   2. handle_start_deploy() generates a fresh App Password, calls broker
 *      POST /deploy/<provider>/prepare with creds + token, gets a ticket
 *   3. WP redirects user's browser to broker /deploy/<provider>/start?ticket=…
 *   4. Broker auto-redirects to /build, runs the pipeline (clone → install →
 *      build → vercel/wrangler deploy), streams a live log page
 *   5. On success, broker redirects back to admin-post.php?action=hatch_deploy_callback
 *      with hatch_ticket + hatch_result + provider
 *   6. handle_deploy_callback() saves the project URL as the revalidate
 *      endpoint and redirects to the Connector tab with a success notice.
 *
 * Tokens (cf_token / vercel_token) flow through the broker in memory only.
 * They never touch disk on either WP or broker, and they're dropped from
 * memory at the end of the build. App Password is generated fresh per deploy.
 *
 * @package Hatch
 * @since 0.20.0
 */

defined( 'ABSPATH' ) || exit;

class Hatch_Deploy_Broker {

	const DEFAULT_BASE  = 'https://hatch.adityaarsharma.com';
	const HTTP_TIMEOUT  = 15;
	const TICKET_TRANSIENT_PREFIX = 'hatch_pending_ticket_';
	const NOTICE_TRANSIENT        = 'hatch_deploy_notice_';

	/**
	 * Name prefix of a deploy credential that has NOT been confirmed yet. Only
	 * credentials still carrying it are ever revoked by the timeout / failure paths.
	 */
	const PENDING_PREFIX = 'Hatch (Deploy: ';

	/**
	 * Name prefix once a deploy succeeded. The deployed frontend keeps using this
	 * read-only credential at runtime (menus, redirects, SEO), so a successful
	 * deploy must KEEP it. It is renamed, never deleted.
	 */
	const ADOPTED_PREFIX = 'Hatch Frontend (';

	private static $instance = null;

	public static function instance(): Hatch_Deploy_Broker {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_post_hatch_start_deploy',    array( $this, 'handle_start_deploy' ) );
		add_action( 'hatch_revoke_deploy_password',     array( __CLASS__, 'revoke_by_ids' ), 10, 2 );
		add_action( 'admin_post_hatch_deploy_callback', array( $this, 'handle_deploy_callback' ) );
		add_action( 'rest_api_init',                    array( $this, 'register_routes' ) );
	}

	/**
	 * Base URL of the broker. Filterable so self-hosters can point at their
	 * own deployment of hatch-deploy/.
	 *
	 * DATA FLOW (audit H-5) — a deploy sends this server, over HTTPS: the
	 * Cloudflare/Vercel API token the user pasted, the site URL, a throw-away
	 * read-only Application Password for the `uichemy-deploy` service user, and
	 * the revalidation webhook secret. The default broker is operated by POSIMYTH
	 * at headless.uichemy.com. To keep all of it on infrastructure you control,
	 * run your own broker and set, in wp-config.php:
	 *
	 *     define( 'HATCH_DEPLOY_BROKER_URL', 'https://deploy.example.com' );
	 *
	 * (or use the `hatch/deploy_broker_base_url` filter). Prefer a deploy token
	 * scoped to a single project/account resource over a full account token.
	 */
	public static function base_url(): string {
		$base = defined( 'HATCH_DEPLOY_BROKER_URL' ) ? HATCH_DEPLOY_BROKER_URL : self::DEFAULT_BASE;
		$base = (string) apply_filters( 'hatch/deploy_broker_base_url', $base );
		return rtrim( $base, '/' );
	}

	/**
	 * Read + drop a one-shot notice stashed by handle_deploy_callback().
	 * Connector tab calls this on render.
	 *
	 * @return array{type:string,message:string}|null
	 */
	public static function pop_notice(): ?array {
		$key = self::NOTICE_TRANSIENT . get_current_user_id();
		$n   = get_transient( $key );
		if ( ! is_array( $n ) || ! isset( $n['type'], $n['message'] ) ) return null;
		delete_transient( $key );
		return $n;
	}

	/**
	 * admin-post handler: kick off the deploy.
	 */
	public function handle_start_deploy(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'hatch' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( 'hatch_start_deploy' );

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$provider = isset( $_POST['provider'] ) ? sanitize_key( wp_unslash( (string) $_POST['provider'] ) ) : '';
		if ( ! in_array( $provider, array( 'vercel', 'cloudflare' ), true ) ) {
			wp_die( esc_html__( 'Unknown deploy provider.', 'hatch' ), '', array( 'response' => 400 ) );
		}

		// Pull the right-named token key from the form.
		$token_field = ( 'vercel' === $provider ) ? 'vercel_token' : 'cf_token';
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$token = isset( $_POST[ $token_field ] ) ? trim( (string) wp_unslash( $_POST[ $token_field ] ) ) : '';

		// v0.48: if no token pasted, fall back to the encrypted credential store (one-click redeploy).
		if ( '' === $token && class_exists( 'Hatch_Credential_Store' ) ) {
			$token = Hatch_Credential_Store::retrieve( $provider );
		}

		if ( '' === $token ) {
			wp_die(
				/* translators: %s: provider name (Vercel or Cloudflare) */
				sprintf( esc_html__( 'No %s token provided. Paste a token in the wizard, then click Build & deploy.', 'hatch' ), esc_html( ucfirst( $provider ) ) ),
				'',
				array( 'response' => 400 )
			);
		}

		// v0.48: if user checked "save token", encrypt and persist it.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( isset( $_POST['save_token'] ) && '1' === (string) $_POST['save_token'] && class_exists( 'Hatch_Credential_Store' ) ) {
			Hatch_Credential_Store::store( $provider, $token );
		}

		// H-5: the credentials leave this server, so require explicit consent that
		// names what is sent and to whom (the wizard shows the same wording).
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( empty( $_POST['hatch_deploy_consent'] ) || '1' !== (string) $_POST['hatch_deploy_consent'] ) {
			wp_die( esc_html__( 'Please confirm what will be sent to the deploy server before continuing.', 'hatch' ), '', array( 'response' => 400 ) );
		}

		// H-5: mint a throw-away Application Password on a read-only service user,
		// never on the current administrator. Revoked when the deploy ends.
		$fresh = class_exists( 'Hatch_App_Password_Helper' )
			? Hatch_App_Password_Helper::create_service_credential( 'Hatch (Deploy: ' . $provider . ')' )
			: null;
		if ( ! $fresh || empty( $fresh['password'] ) ) {
			wp_die( esc_html__( 'Could not generate Application Password. Check user permissions.', 'hatch' ), '', array( 'response' => 500 ) );
		}

		// Webhook secret (auto-created at activation; generate if somehow missing).
		$webhook_secret = (string) get_option( 'hatch_webhook_secret', '' );
		if ( '' === $webhook_secret ) {
			$webhook_secret = wp_generate_password( 48, false );
			update_option( 'hatch_webhook_secret', $webhook_secret, false );
		}

		// Where the broker redirects the user back to after the deploy.
		//
		// IMPORTANT: do NOT use wp_nonce_url() here — it calls esc_html()
		// internally, which HTML-encodes `&` to `&amp;`. When the broker passes
		// that URL through new URL() and appends `hatch_ticket` + `hatch_result`,
		// the `&amp;` survives into the final redirect, so WP sees query
		// parameters named `amp;provider` and `amp;_wpnonce` instead of
		// `provider` and `_wpnonce` — nonce check fails → "The link you
		// followed has expired." This was the v0.15.0 CF callback bug; it
		// regressed when I rewrote this class in v0.20.0. Build the URL with
		// add_query_arg() only — no HTML encoding.
		$return_url = add_query_arg(
			array(
				'action'   => 'hatch_deploy_callback',
				'provider' => $provider,
				'_wpnonce' => wp_create_nonce( 'hatch_deploy_callback' ),
			),
			admin_url( 'admin-post.php' )
		);

		// v0.5.7 — wizard Sub-step A hidden inputs (mountMode + subPath + domain).
		// Broker uses these to decide whether to bind a Worker to a subfolder
		// route or the root of the domain. Missing = broker defaults to root.
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		$mount_mode = isset( $_POST['mountMode'] ) ? sanitize_key( wp_unslash( (string) $_POST['mountMode'] ) ) : 'root';
		if ( ! in_array( $mount_mode, array( 'root', 'subfolder' ), true ) ) {
			$mount_mode = 'root';
		}
		$sub_path = isset( $_POST['subPath'] ) ? '/' . ltrim( sanitize_text_field( wp_unslash( (string) $_POST['subPath'] ) ), '/' ) : '/blog';
		$custom_domain = isset( $_POST['domain'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['domain'] ) ) : '';
		// phpcs:enable

		// v0.5.9 — persist mount_mode so the React admin, features/status
		// endpoint, and the SEO subfolder-rewriter all read the same value
		// the user just selected in the wizard. Without this, the dashboard
		// label ignored Root vs Subfolder and stayed hard-coded.
		update_option( 'hatch_mount_mode', $mount_mode, false );
		update_option( 'hatch_mount_subpath', $sub_path, false );

		// Public WP URL override. When the site's home_url() is a private
		// address (localhost, tunnel-only dev), an admin can set
		// hatch_wp_public_url to a URL that Cloudflare's edge / Vercel's
		// build servers can actually reach. Falls back to home_url() for
		// standard production installs on a public domain.
		$wp_public = trim( (string) get_option( 'hatch_wp_public_url', '' ) );
		$wp_url    = '' !== $wp_public ? untrailingslashit( $wp_public ) : untrailingslashit( home_url() );

		// Call broker /prepare server-to-server.
		$prepare_url = self::base_url() . '/deploy/' . $provider . '/prepare';
		$body        = array(
			'wp_url'         => $wp_url,
			'wp_user'        => $fresh['username'],
			'wp_pass'        => $fresh['password'],
			'webhook_secret' => $webhook_secret,
			'return_url'     => $return_url,
			'mountMode'      => $mount_mode,
			'subPath'        => $sub_path,
			'domain'         => $custom_domain,
			$token_field     => $token,
		);
		$response = wp_remote_post( $prepare_url, array(
			'timeout' => self::HTTP_TIMEOUT,
			'headers' => array( 'Content-Type' => 'application/json' ),
			'body'    => wp_json_encode( $body ),
		) );

		if ( is_wp_error( $response ) ) {
			wp_die( esc_html__( 'Could not reach the deploy broker: ', 'hatch' ) . esc_html( $response->get_error_message() ), '', array( 'response' => 502 ) );
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( $code !== 200 || empty( $data['ticket'] ) ) {
			wp_die(
				esc_html__( 'Broker rejected the request: ', 'hatch' ) . esc_html( substr( (string) wp_remote_retrieve_body( $response ), 0, 400 ) ),
				'',
				array( 'response' => 502 )
			);
		}

		// Stash ticket and temporary app password metadata for callback verification & cleanup.
		set_transient(
			self::TICKET_TRANSIENT_PREFIX . get_current_user_id(),
			array(
				'ticket'  => (string) $data['ticket'],
				'pw_uuid' => ( is_array( $fresh ) && isset( $fresh['uuid'] ) ) ? (string) $fresh['uuid'] : '',
				'user_id' => ( is_array( $fresh ) && isset( $fresh['user_id'] ) ) ? (int) $fresh['user_id'] : 0,
			),
			15 * MINUTE_IN_SECONDS
		);

		// H-5: if the callback never arrives (closed tab, failed build), the
		// password must not outlive the ticket. Revoke it shortly after expiry.
		if ( is_array( $fresh ) && ! empty( $fresh['uuid'] ) && ! empty( $fresh['user_id'] ) ) {
			update_option( 'uich_hatch_deploy_pending', 1, false ); // lets cron boot the runtime to run the revoke.
			wp_schedule_single_event( time() + 16 * MINUTE_IN_SECONDS, 'hatch_revoke_deploy_password', array( (int) $fresh['user_id'], (string) $fresh['uuid'] ) );
		}

		// Send the browser to the broker's live-log page.
		$start_url = self::base_url() . '/deploy/' . $provider . '/start?ticket=' . rawurlencode( (string) $data['ticket'] );
		wp_redirect( $start_url );
		exit;
	}

	/**
	 * admin-post handler: receive callback from broker after build completes.
	 */
	public function handle_deploy_callback(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Permission denied.', 'hatch' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( 'hatch_deploy_callback' );

		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		$provider = isset( $_GET['provider'] )      ? sanitize_key( wp_unslash( (string) $_GET['provider'] ) )       : '';
		$ticket   = isset( $_GET['hatch_ticket'] )  ? sanitize_text_field( wp_unslash( (string) $_GET['hatch_ticket'] ) ) : '';
		$result   = isset( $_GET['hatch_result'] )  ? sanitize_key( wp_unslash( (string) $_GET['hatch_result'] ) )   : '';
		// phpcs:enable

		$pending  = get_transient( self::TICKET_TRANSIENT_PREFIX . get_current_user_id() );
		$expected = is_array( $pending ) ? ( $pending['ticket'] ?? '' ) : (string) $pending;

		if ( 'success' !== $result || '' === $ticket || ! in_array( $provider, array( 'vercel', 'cloudflare' ), true ) ) {
			self::revoke_deploy_password( $pending );
			delete_transient( self::TICKET_TRANSIENT_PREFIX . get_current_user_id() );
			$this->redirect_with_notice( 'error', __( 'Deploy callback was malformed.', 'hatch' ) );
		}

		// Verify ticket matches the one we issued.
		if ( '' === $expected || ! hash_equals( $expected, $ticket ) ) {
			self::revoke_deploy_password( $pending );
			delete_transient( self::TICKET_TRANSIENT_PREFIX . get_current_user_id() );
			$this->redirect_with_notice( 'error', __( 'Deploy ticket did not match the pending request.', 'hatch' ) );
		}
		// Success: the deployed site now runs on this credential. Keep it.
		self::adopt_deploy_password( $pending, $provider );
		delete_transient( self::TICKET_TRANSIENT_PREFIX . get_current_user_id() );

		// Ask broker for the final project URL via /status (ticket still alive
		// for ~5 min, so we can redeem it once before it expires).
		$status_url = self::base_url() . '/deploy/' . $provider . '/status?ticket=' . rawurlencode( $ticket );
		$response   = wp_remote_get( $status_url, array( 'timeout' => self::HTTP_TIMEOUT ) );
		if ( is_wp_error( $response ) ) {
			$this->redirect_with_notice( 'error', __( 'Could not read broker status: ', 'hatch' ) . $response->get_error_message() );
		}
		$status_data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$project_url = is_array( $status_data ) && ! empty( $status_data['project_url'] ) ? (string) $status_data['project_url'] : '';

		if ( '' === $project_url ) {
			$this->redirect_with_notice( 'error', __( 'Deploy completed but no project URL was returned.', 'hatch' ) );
		}

		// Persist hosting model + project metadata.
		if ( class_exists( 'Hatch_Connection_Status' ) ) {
			// v0.5.9 — this is Cloudflare Workers, not Pages. The old label
			// misled every downstream consumer (dashboard label, host
			// detection, support docs). Normalise on write so new deploys
			// carry the accurate model.
			Hatch_Connection_Status::set_hosting_model( 'vercel' === $provider ? 'vercel' : 'cloudflare-workers' );
		}
		update_option(
			'hatch_deploy_project_' . $provider,
			array(
				'name'         => isset( $status_data['project_name'] ) ? (string) $status_data['project_name'] : '',
				'url'          => $project_url,
				'connected_at' => time(),
			),
			false
		);

		// v0.29: stamp the Hatch version that was deployed so the admin can
		// show an "Update available" banner when the plugin is later upgraded
		// past the deployed frontend code.
		update_option( 'hatch_deployed_frontend_version', HATCH_VERSION );

		// v0.35: auto-mirror the frontend URL into the image proxy URL so the
		// image proxy uses your own domain by default. No "do you want to use
		// same domain?" prompt — that's just the right answer. Users can still
		// override via the Connector tab if they have a separate image host.
		$existing_proxy = trim( (string) get_option( 'hatch_image_proxy_url', '' ) );
		if ( '' === $existing_proxy || $existing_proxy === untrailingslashit( (string) get_option( 'hatch_frontend_url', '' ) ) ) {
			update_option( 'hatch_image_proxy_url', untrailingslashit( $project_url ) );
		}

		// Companion theme + other plugin features read this option to know
		// the public frontend URL.
		update_option( 'hatch_frontend_url', esc_url_raw( $project_url ), false );

		// Flip the site into headless mode automatically — install (if needed)
		// and activate the companion theme so the WP frontend immediately
		// 302-redirects to the new project URL. The setup wizard warns users
		// about this before they hit the deploy button. Failures here are
		// non-fatal (the deploy already succeeded); users can manually
		// activate the companion theme from the Connector tab if needed.
		if ( class_exists( 'Hatch_Companion_Theme_Installer' ) ) {
			Hatch_Companion_Theme_Installer::install_and_activate();
		}

		// Auto-fill revalidate endpoint with the new project URL (only if not
		// already set — don't clobber a custom one).
		$existing = (string) get_option( 'hatch_revalidate_endpoint', '' );
		if ( '' === $existing ) {
			update_option(
				'hatch_revalidate_endpoint',
				esc_url_raw( rtrim( $project_url, '/' ) . '/api/revalidate' ),
				false
			);
		}

		$this->redirect_with_notice( 'success', sprintf(
			/* translators: 1: provider name, 2: project URL */
			__( 'Connected to %1$s · live at %2$s', 'hatch' ),
			ucfirst( $provider ),
			$project_url
		) );
	}

	private function redirect_with_notice( string $type, string $message ): void {
		set_transient(
			self::NOTICE_TRANSIENT . get_current_user_id(),
			array( 'type' => $type, 'message' => $message ),
			HOUR_IN_SECONDS
		);
		wp_safe_redirect( admin_url( 'admin.php?page=hatch#connection' ) );
		exit;
	}

	/**
	 * Cron target: revoke a deploy password by ids (timeout path).
	 *
	 * @param int    $user_id Service user.
	 * @param string $uuid    Application Password uuid.
	 * @return void
	 */
	public static function revoke_by_ids( $user_id, $uuid ): void {
		if ( $user_id && '' !== (string) $uuid && class_exists( 'WP_Application_Passwords' ) ) {
			// Revoke ONLY a credential that was never confirmed. If the deploy
			// succeeded it was renamed to ADOPTED_PREFIX and a live site depends on it.
			foreach ( (array) WP_Application_Passwords::get_user_application_passwords( (int) $user_id ) as $item ) {
				if ( isset( $item['uuid'], $item['name'] ) && (string) $uuid === (string) $item['uuid'] && 0 === strpos( (string) $item['name'], self::PENDING_PREFIX ) ) {
					WP_Application_Passwords::delete_application_password( (int) $user_id, (string) $uuid );
				}
			}
		}
		delete_option( 'uich_hatch_deploy_pending' );
	}

	/**
	 * A deploy succeeded: keep the credential, but rename it so the timeout
	 * revoke leaves it alone, and cancel that scheduled revoke.
	 *
	 * @param array|mixed $pending  Pending ticket data.
	 * @param string      $provider vercel|cloudflare.
	 * @return void
	 */
	private static function adopt_deploy_password( $pending, string $provider ): void {
		if ( ! is_array( $pending ) || empty( $pending['pw_uuid'] ) || empty( $pending['user_id'] ) || ! class_exists( 'WP_Application_Passwords' ) ) {
			return;
		}
		WP_Application_Passwords::update_application_password(
			(int) $pending['user_id'],
			(string) $pending['pw_uuid'],
			array( 'name' => self::ADOPTED_PREFIX . $provider . ')' )
		);
		wp_clear_scheduled_hook( 'hatch_revoke_deploy_password', array( (int) $pending['user_id'], (string) $pending['pw_uuid'] ) );
		delete_option( 'uich_hatch_deploy_pending' );
	}

	/**
	 * REST: the broker tells this site, server to server, that a build ended.
	 *
	 * The browser callback above is the normal path, but a closed tab never
	 * fires it. Without this, a SUCCESSFUL deploy would have its credential
	 * revoked by the timeout (breaking the live site) and a FAILED one would
	 * leave a live credential behind. Authenticated by an HMAC over the
	 * ticket/status/provider/timestamp with the webhook secret that only this
	 * site and the broker know; stale (> 5 min) or forged requests are refused.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			'hatch/v1',
			'/deploy/finished',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'route_deploy_finished' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function route_deploy_finished( $request ) {
		$ticket   = (string) $request->get_param( 'ticket' );
		$status   = (string) $request->get_param( 'status' );
		$provider = sanitize_key( (string) $request->get_param( 'provider' ) );
		$ts       = (string) $request->get_param( 'ts' );
		$sig      = (string) $request->get_param( 'sig' );
		$secret   = (string) get_option( 'hatch_webhook_secret', '' );

		$forbidden = new WP_Error( 'hatch_deploy_forbidden', __( 'Not allowed.', 'hatch' ), array( 'status' => 403 ) );
		if ( '' === $secret || '' === $ticket || '' === $sig || ! ctype_digit( $ts ) || abs( time() - (int) $ts ) > 300 ) {
			return $forbidden;
		}
		if ( ! in_array( $status, array( 'success', 'failed' ), true ) || ! in_array( $provider, array( 'vercel', 'cloudflare' ), true ) ) {
			return $forbidden;
		}
		$expected = hash_hmac( 'sha256', 'finished|' . $ticket . '|' . $status . '|' . $provider . '|' . $ts, $secret );
		if ( ! hash_equals( $expected, $sig ) ) {
			return $forbidden;
		}

		$kept    = 0;
		$revoked = 0;
		$user    = class_exists( 'Hatch_App_Password_Helper' ) ? get_user_by( 'login', Hatch_App_Password_Helper::SERVICE_USER_LOGIN ) : false;
		if ( $user && class_exists( 'WP_Application_Passwords' ) ) {
			foreach ( (array) WP_Application_Passwords::get_user_application_passwords( (int) $user->ID ) as $item ) {
				if ( empty( $item['uuid'] ) || empty( $item['name'] ) || 0 !== strpos( (string) $item['name'], self::PENDING_PREFIX ) ) {
					continue;
				}
				wp_clear_scheduled_hook( 'hatch_revoke_deploy_password', array( (int) $user->ID, (string) $item['uuid'] ) );
				if ( 'success' === $status ) {
					WP_Application_Passwords::update_application_password( (int) $user->ID, (string) $item['uuid'], array( 'name' => self::ADOPTED_PREFIX . $provider . ')' ) );
					$kept++;
				} else {
					WP_Application_Passwords::delete_application_password( (int) $user->ID, (string) $item['uuid'] );
					$revoked++;
				}
			}
		}
		delete_option( 'uich_hatch_deploy_pending' );
		return new WP_REST_Response( array( 'ok' => true, 'kept' => $kept, 'revoked' => $revoked ), 200 );
	}

	/**
	 * Revoke the temporary application password created for the deploy.
	 *
	 * @param array|mixed $pending Pending ticket data.
	 * @return void
	 */
	private static function revoke_deploy_password( $pending ): void {
		if ( is_array( $pending ) && ! empty( $pending['pw_uuid'] ) && ! empty( $pending['user_id'] ) ) {
			if ( class_exists( 'WP_Application_Passwords' ) ) {
				WP_Application_Passwords::delete_application_password( (int) $pending['user_id'], (string) $pending['pw_uuid'] );
			}
		}
	}
}
