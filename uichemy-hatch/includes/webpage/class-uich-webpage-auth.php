<?php
/**
 * OAuth2 Authentication handler for the UiChemy app.
 *
 * @package Uichemy
 */

defined( 'ABSPATH' ) || exit;

/**
 * Class Uich_Webpage_Auth
 */
class Uich_Webpage_Auth {

	/**
	 * wp-admin page slug the authorization code is handed back to. The auth
	 * server echoes this into its redirect (see the `adminPage` field sent by
	 * register_site()), which is what lets the callback land on UiChemy's own
	 * page instead of another plugin's.
	 */
	const ADMIN_PAGE = 'uichemy';

	/**
	 * OAuth2 endpoints, all derived from UICH_WEBPAGE_APP_URL so a single
	 * wp-config.php define points the whole flow at a dev server. Methods
	 * rather than constants because a class constant would be baked in at
	 * compile time, before wp-config's define is guaranteed to have run.
	 *
	 * @return string
	 */
	protected static function app_url() {
		return rtrim( UICH_WEBPAGE_APP_URL, '/' );
	}

	/** OIDC endpoint base — /authorize and /token hang off this. */
	protected static function oauth_base_url() {
		return self::app_url() . '/api/auth/oauth2';
	}

	/**
	 * The single fixed redirect_uri registered for every WordPress plugin OAuth
	 * flow. The auth server relays the code from here back to this site.
	 */
	protected static function oauth_wp_callback_url() {
		return self::app_url() . '/api/auth/oauth2/wp-callback';
	}

	/** Where a site announces itself before starting a flow. */
	protected static function oauth_register_site_url() {
		return self::app_url() . '/api/wp/register-site';
	}

	const RESPONSE_TYPE = 'code';
	// `offline_access` is REQUIRED for the OIDC provider to return a refresh_token
	// in the token response (better-auth only includes it when this scope is
	// requested). Without it the refresh_token comes back empty and token refresh
	// can never work.
	const SCOPE = 'openid profile email offline_access';

	/**
	 * Option names for storing tokens.
	 */
	const OPTION_ACCESS_TOKEN  = 'uich_webpage_access_token';
	const OPTION_REFRESH_TOKEN = 'uich_webpage_refresh_token';
	const OPTION_ID_TOKEN      = 'uich_webpage_id_token';
	const OPTION_USER_INFO     = 'uich_webpage_user_info';
	const OPTION_USER_ID       = 'uich_webpage_user_id';

	/**
	 * Transient holding the PKCE code_verifier between the authorize request and
	 * the token exchange. The plugin is a PUBLIC OAuth client (no client_secret),
	 * so PKCE (RFC 7636) is what proves the token request came from the same
	 * install that started the flow. 10-minute TTL mirrors the server's siteToken
	 * window. Single-flight: a concurrent connect from another admin overwrites
	 * it, which is acceptable for an admin-only "connect site" action.
	 */
	const TRANSIENT_PKCE_VERIFIER = 'uich_webpage_pkce_verifier';

	/**
	 * Marks that THIS plugin started the connect flow that is currently in
	 * flight, so handle_oauth_callback() can tell "the user clicked Log in here"
	 * apart from "some other plugin's OAuth callback happens to look like ours".
	 *
	 * The auth server names the code parameter after the `adminPage` we
	 * register and returns to that page, so we answer `page=uichemy` with a
	 * `uichemy_code`, while any other plugin using this auth server answers
	 * its own page slug with its own code parameter. The addresses no longer overlap,
	 * which is what makes this marker cheap to keep rather than load-bearing:
	 * it stops us spending a code that was never minted against our PKCE
	 * verifier, which would abort the request with "your connection session
	 * expired" for no reason the admin could act on.
	 *
	 * Its TTL is deliberately longer than the verifier's: once the verifier has
	 * expired we still want to know the flow was ours, so the user gets our
	 * accurate "session expired, start again" message instead of silently
	 * falling through to another plugin's handler.
	 */
	const TRANSIENT_OAUTH_PENDING = 'uich_webpage_oauth_pending';

	/**
	 * Short-lived access JWT obtained from /api/wp/token, cached until it is due
	 * to expire.
	 *
	 * The OAuth access token is opaque, so every call that presented it cost the
	 * app a lookup in its `oauthAccessToken` collection. Exchanging it once for a
	 * signed token that the app can verify locally turns that into one lookup per
	 * TTL instead of one per request.
	 *
	 * The transient's own lifetime is what enforces the expiry here — it is set a
	 * minute shorter than the token's, so a cached value can never be handed out
	 * past its `exp`.
	 */
	const TRANSIENT_API_JWT = 'uich_webpage_api_jwt';

	/**
	 * Marks that validate_session() confirmed the connection recently.
	 *
	 * That check used to run on EVERY dashboard load — a blocking round trip to
	 * the app before the page could render, repeated on every navigation. What it
	 * detects (the site being signed out from the dashboard, its seat released)
	 * doesn't need per-request freshness; noticing within a few minutes is the
	 * point. So a confirmed result is cached for VALIDATE_SESSION_TTL and the
	 * request is skipped until it lapses.
	 *
	 * Only SUCCESS is cached. A failure must never be sticky.
	 */
	const TRANSIENT_SESSION_OK = 'uich_webpage_session_ok';

	/** How long a confirmed session check stays good for. */
	const VALIDATE_SESSION_TTL = 5 * MINUTE_IN_SECONDS;

	/**
	 * Caches a successful get_capacity() body.
	 *
	 * get_boot_state() runs twice per dashboard page view — once server-side
	 * while the page renders, once more from the client's /state REST probe
	 * (App.jsx) a moment later — and each call to this endpoint costs up to two
	 * HTTP round trips (the JWT attempt, plus a possible 401 retry). Without a
	 * cache that is up to four outbound requests, each with an 8s timeout, on
	 * every single page load. A short-lived cache collapses the pair into one.
	 *
	 * Only SUCCESS is cached, same rule as TRANSIENT_SESSION_OK — a failure
	 * must never be sticky, or a real outage would keep answering "unreachable"
	 * past the point the app recovered.
	 */
	const TRANSIENT_CAPACITY = 'uich_webpage_capacity';

	/**
	 * Short on purpose: this cache exists to dedupe the two near-simultaneous
	 * calls one page load makes, not to keep the plan fresh — a plan change
	 * (e.g. right after checkout) is picked up on the next full boot anyway,
	 * since `window.uich_nd_boot` itself is a one-shot server-rendered payload,
	 * not something this cache could make staler than it already is.
	 */
	const CAPACITY_TTL = MINUTE_IN_SECONDS;

	/**
	 * The throttle window actually in force.
	 *
	 * Filterable because this window is what decides HOW LONG a sign-out on the
	 * app side stays invisible here, and five minutes of waiting makes the
	 * behaviour impractical to test — drop it to a few seconds while working on
	 * that.
	 *
	 * A filter rather than a constant: it is an ordinary tunable, not an
	 * environment pointer, and this is how the plugin already exposes such things
	 * (`uich_webpage_oidc_allowed_issuers`).
	 *
	 * @return int Seconds; at least 1.
	 */
	protected static function validate_session_ttl() {
		/**
		 * Filters how long a confirmed session check is cached.
		 *
		 * @param int $ttl Seconds.
		 */
		$ttl = apply_filters( 'uich_webpage_validate_session_ttl', self::VALIDATE_SESSION_TTL );

		return is_numeric( $ttl ) ? max( 1, (int) $ttl ) : self::VALIDATE_SESSION_TTL;
	}

	/**
	 * Dashboard hash route to return to once the account is connected. This flow
	 * is now entered from two places — the dashboard's own login gate and the
	 * Import tab — so the destination has to travel with the flow rather than be
	 * hardcoded. TTL matches TRANSIENT_OAUTH_PENDING; a missing value just means
	 * the default route.
	 */
	const TRANSIENT_RETURN_ROUTE = 'uich_webpage_return_route';


	/**
	 * Hash routes the callback is allowed to land on. An allow-list, not
	 * sanitization: the value ends up in a redirect, and only the dashboard's
	 * own routes are ever legitimate here.
	 *
	 * `#/ai-website` is the live destination: the AI Website Creator is a tab on
	 * Home, and that route opens Home with it preselected (see DashboardApp), so
	 * both the rail's "Activate" button and the tab's own connect card come back
	 * to the screen the account was needed for. `#/import` is the retired route
	 * kept for in-flight flows started before the update — it resolves to Home.
	 */
	const RETURN_ROUTES = array( '', '#/ai-website', '#/import' );

	/**
	 * Remember where to send the browser after a successful exchange.
	 *
	 * @param string $route One of RETURN_ROUTES; anything else is dropped.
	 */
	protected function set_return_route( $route ) {
		$route = is_string( $route ) ? $route : '';
		if ( ! in_array( $route, self::RETURN_ROUTES, true ) ) {
			$route = '';
		}
		set_transient( self::TRANSIENT_RETURN_ROUTE, $route, 30 * MINUTE_IN_SECONDS );
	}

	/**
	 * Consume the stored return route. Single-use, like the other flow markers.
	 *
	 * @return string Hash route, or '' for the dashboard root.
	 */
	protected function consume_return_route() {
		$route = get_transient( self::TRANSIENT_RETURN_ROUTE );
		delete_transient( self::TRANSIENT_RETURN_ROUTE );
		return in_array( $route, self::RETURN_ROUTES, true ) ? $route : '';
	}

	/**
	 * Initialize authentication hooks.
	 */
	public function init() {
		// Priority 0, ahead of any other plugin's own callback
		// handler (priority 1). The two no longer share a callback address —
		// see TRANSIENT_OAUTH_PENDING — but running first is still free, and
		// the handler bails out immediately on anything that is not ours.
		add_action( 'admin_init', array( $this, 'handle_oauth_callback' ), 0 );
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	/**
	 * Register this site with the UiChemy app and get a ready-to-use OAuth authorization URL.
	 * The server handles redirect_uri registration and state/CSRF management.
	 *
	 * @return string|false Authorization URL on success, false on failure.
	 */
	public function get_authorization_url( $return_route = '' ) {
		// Generate a fresh PKCE pair and stash the verifier for the later token
		// exchange. The server only ever sees the (hashed) challenge.
		$code_verifier  = $this->generate_code_verifier();
		$code_challenge = $this->derive_code_challenge( $code_verifier );
		set_transient( self::TRANSIENT_PKCE_VERIFIER, $code_verifier, 10 * MINUTE_IN_SECONDS );
		// Stamp the initiating admin's id (not a bare 1) so handle_oauth_callback()
		// can confirm the same user finishes the flow — see the user-binding check there.
		set_transient( self::TRANSIENT_OAUTH_PENDING, get_current_user_id(), 30 * MINUTE_IN_SECONDS );
		$this->set_return_route( $return_route );

		$response = wp_remote_post(
			self::oauth_register_site_url(),
			array(
				'body'      => wp_json_encode(
					array(
						// Identifies this site to the app. Stays home_url() because that
						// is the value the connection record is keyed on (see
						// record_connection() and request_connection_state()) — changing
						// it would orphan every already-connected site.
						'siteUrl'             => home_url( '/' ),
						'clientId'            => UICH_WEBPAGE_CLIENT_ID,
						'codeChallenge'       => $code_challenge,
						'codeChallengeMethod' => 'S256',
						// Bring the code back to UiChemy's own admin page. This
						// also names the code parameter the server relays —
						// `uichemy_code` — which is the only one
						// handle_oauth_callback() answers to, so a server old
						// enough to ignore this field (landing on its own default
						// page with a differently-named code) will not complete the flow.
						'adminPage'           => self::ADMIN_PAGE,
						// Where admin.php actually IS on this install, as opposed to
						// where siteUrl implies it is. The server used to build the
						// return address as `{siteUrl}/wp-admin/admin.php`, which is
						// wrong for two ordinary setups: a site living in a
						// subdirectory (`localhost:8888/mysite/`), and "WordPress in
						// its own directory", where home_url() is example.com while
						// wp-admin sits under example.com/wp. Either way the browser
						// was sent somewhere the web server 404s, so
						// handle_oauth_callback() never ran and the admin was left on
						// a blank not-found page mid-connect.
						//
						// admin_url() resolves both, since it builds on site_url()
						// rather than home_url(). Older servers ignore the field and
						// fall back to the guess above.
						'adminUrl'            => admin_url( 'admin.php' ),
					)
				),
				'headers'   => array( 'Content-Type' => 'application/json' ),
				'timeout'   => 30,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);

		if ( is_wp_error( $response ) ) {
			return false;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		return isset( $body['authUrl'] ) ? $body['authUrl'] : false;
	}

	/**
	 * Generate a high-entropy PKCE code_verifier (RFC 7636 §4.1).
	 * 32 random bytes → base64url (no padding) = 43 unreserved characters.
	 *
	 * @return string
	 */
	protected function generate_code_verifier() {
		return $this->base64url_encode( random_bytes( 32 ) );
	}

	/**
	 * Derive the S256 code_challenge from a verifier (RFC 7636 §4.2):
	 * base64url( SHA-256( ascii(verifier) ) ), no padding.
	 *
	 * @param string $verifier The code_verifier.
	 * @return string
	 */
	protected function derive_code_challenge( $verifier ) {
		return $this->base64url_encode( hash( 'sha256', $verifier, true ) );
	}

	/**
	 * Base64URL-encode without padding (RFC 4648 §5).
	 *
	 * @param string $data Raw bytes.
	 * @return string
	 */
	protected function base64url_encode( $data ) {
		// Base64URL (RFC 7636 / RFC 4648 §5), unpadded — produced directly by
		// libsodium, so no base64_encode + strtr + rtrim round-trip is needed.
		return sodium_bin2base64( (string) $data, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING );
	}

	/**
	 * Token storage transform for update_option().
	 *
	 * Encryption at rest was intentionally removed — tokens are now stored in
	 * wp_options as plaintext. This is deliberately a passthrough (kept as a
	 * method so the call sites read the same and a future storage policy has one
	 * place to hook). A DB read now yields directly usable access/refresh/id
	 * tokens, so protect wp_options access accordingly.
	 *
	 * @param mixed $plaintext Raw token value from the OAuth response.
	 * @return mixed Stored as-is.
	 */
	protected function encrypt_token( $plaintext ) {
		return $plaintext;
	}

	/**
	 * Token read transform for get_option().
	 *
	 * Counterpart to encrypt_token(): returns the stored value as-is. It still
	 * recognises the two prefixes older, encrypting builds used, so upgrading a
	 * site doesn't hand a prefixed string back as if it were the token:
	 *   • `plain:` — was stored plaintext-with-marker; strip the marker.
	 *   • `enc:`   — was AES-encrypted; the key is gone, so it can't be read.
	 *     Return false so the site cleanly falls back to the login screen and a
	 *     fresh plaintext token is stored on the next sign-in.
	 *
	 * @param mixed $stored Raw value from get_option().
	 * @return string|false The token, or false if empty / unreadable legacy ciphertext.
	 */
	protected function decrypt_token( $stored ) {
		if ( ! is_string( $stored ) || '' === $stored ) {
			return false;
		}
		if ( 0 === strpos( $stored, 'enc:' ) ) {
			return false; // Legacy ciphertext, unreadable without the removed key.
		}
		if ( 0 === strpos( $stored, 'plain:' ) ) {
			return substr( $stored, strlen( 'plain:' ) );
		}
		return $stored;
	}

	/**
	 * Handle OAuth2 callback after authorization.
	 * The central callback relays the code back as `uichemy_code`, named after
	 * the `adminPage` slug get_authorization_url() registers for this site.
	 * State/CSRF is managed server-side by the register-site siteToken.
	 *
	 * Both halves of that address are ours now: the server returns to the
	 * `adminPage` we registered, so only `page=uichemy` carrying a
	 * `uichemy_code` is answered. A server old enough to ignore `adminPage`
	 * lands on its own default page with a differently-named code instead, and
	 * this handler ignores it — that flow cannot complete on this plugin.
	 *
	 * TRANSIENT_OAUTH_PENDING is still required before the code is spent. The
	 * address no longer collides with any other plugin, so the
	 * marker is now about the code itself: a `uichemy_code` we did not ask for
	 * has no PKCE verifier of ours behind it, and exchanging it would only
	 * produce a bogus "session expired".
	 */
	public function handle_oauth_callback() {
		// phpcs:disable WordPress.Security.NonceVerification -- CSRF is managed server-side via siteToken (see register-site flow).
		if ( ! isset( $_GET['uichemy_code'] ) ) {
			return;
		}

		if ( ! isset( $_GET['page'] ) ) {
			return;
		}

		$page = sanitize_text_field( wp_unslash( $_GET['page'] ) );
		if ( self::ADMIN_PAGE !== $page ) {
			return;
		}

		// A code we never asked for — nothing here can spend it, so return
		// rather than die and leave the request alone.
		if ( ! get_transient( self::TRANSIENT_OAUTH_PENDING ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to connect a UiChemy account.', 'uichemy' ) );
		}

		// Bind the callback to the admin who STARTED the flow. get_authorization_url()
		// stamped their user id into TRANSIENT_OAUTH_PENDING, so a DIFFERENT admin
		// landing on this callback (e.g. a forged link opened in their own session)
		// cannot spend the code. PKCE already rejects a foreign code at exchange;
		// this closes the same-site "who finishes the flow" gap early. A legacy
		// sentinel (0/1 from a flow started before this stamp) simply skips the check.
		$pending_user = (int) get_transient( self::TRANSIENT_OAUTH_PENDING );
		if ( $pending_user > 1 && get_current_user_id() !== $pending_user ) {
			return;
		}

		$code = sanitize_text_field( wp_unslash( $_GET['uichemy_code'] ) );
		// phpcs:enable WordPress.Security.NonceVerification
		$this->exchange_code_for_token( $code );
	}

	/**
	 * Exchange authorization code for access token.
	 *
	 * @param string $code Authorization code.
	 */
	protected function exchange_code_for_token( $code ) {
		$redirect_uri = self::oauth_wp_callback_url();

		// PKCE: prove possession of the verifier generated when the flow started.
		// As a public client we send no client_secret — the verifier is the proof.
		// Both transients are consumed here: this code is single-use, so whether
		// the exchange succeeds or fails the flow is over and a retry must start
		// a fresh one.
		$code_verifier = get_transient( self::TRANSIENT_PKCE_VERIFIER );
		$return_route  = $this->consume_return_route();
		delete_transient( self::TRANSIENT_PKCE_VERIFIER );
		delete_transient( self::TRANSIENT_OAUTH_PENDING );
		if ( empty( $code_verifier ) ) {
			wp_die(
				esc_html__( 'Your connection session expired. Please open UiChemy › Import and start the connection again.', 'uichemy' )
			);
		}

		$response = wp_remote_post(
			self::oauth_base_url() . '/token',
			array(
				'body'      => array(
					'code'          => $code,
					'client_id'     => UICH_WEBPAGE_CLIENT_ID,
					'code_verifier' => $code_verifier,
					'grant_type'    => 'authorization_code',
					'redirect_uri'  => $redirect_uri,
				),
				'timeout'   => 120,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);

		if ( is_wp_error( $response ) ) {
			wp_die(
				esc_html__( 'Failed to connect to the UiChemy app. Please try again.', 'uichemy' ) .
				'<br><br>' .
				esc_html( $response->get_error_message() )
			);
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( isset( $body['access_token'] ) && $this->is_storable_oauth_token( $body['access_token'] ) ) {
			// Store access token (do not use sanitize_text_field — it can corrupt opaque tokens).
			// encrypt_token() is now a passthrough, so this lands in wp_options as plaintext.
			update_option( self::OPTION_ACCESS_TOKEN, $this->encrypt_token( $body['access_token'] ), false );

			// A connect can follow a disconnect, and can be a DIFFERENT account.
			// Anything cached against the previous credentials has to go now,
			// before the first call is made with the new ones.
			delete_transient( self::TRANSIENT_API_JWT );
			delete_transient( self::TRANSIENT_SESSION_OK );

			// Store refresh token if provided.
			if ( isset( $body['refresh_token'] ) && $this->is_storable_oauth_token( $body['refresh_token'] ) ) {
				update_option( self::OPTION_REFRESH_TOKEN, $this->encrypt_token( $body['refresh_token'] ), false );
			}

			// Store and decode id_token. Uses is_storable_id_token() (not the opaque-token
			// check) because id_token is a JWT whose size varies with embedded claims.
			if ( isset( $body['id_token'] ) && $this->is_storable_id_token( $body['id_token'] ) ) {
				$user_info = $this->decode_jwt_payload( $body['id_token'] );
				if ( ! $user_info || ! $this->validate_id_token_payload( $user_info ) ) {
					wp_die( esc_html__( 'Invalid or expired identity token from the UiChemy app. Please try signing in again.', 'uichemy' ) );
				}
				update_option( self::OPTION_ID_TOKEN, $this->encrypt_token( $body['id_token'] ), false );
				update_option( self::OPTION_USER_INFO, $user_info, false );
				if ( isset( $user_info['sub'] ) && is_string( $user_info['sub'] ) ) {
					update_option( self::OPTION_USER_ID, sanitize_text_field( $user_info['sub'] ), false );
				}
			}

			// Record this connection on the app side (which site + that it's the
			// WordPress plugin), so the account knows where it's signed in from.
			// Best-effort: never block or fail the sign-in on this.
			$this->record_connection( $body['access_token'] );

			// Back to wherever the flow started — the dashboard's login gate or the
			// Import tab (see set_return_route()). Either way the destination
			// re-reads auth state from a fresh boot payload and lets the user in.
			// `uich_connected` is what App.jsx shows its success toast on; the hash
			// has to be appended after the query, so it is concatenated rather than
			// passed through add_query_arg().
			$destination = add_query_arg(
				array(
					'page'           => self::ADMIN_PAGE,
					'uich_connected' => '1',
				),
				admin_url( 'admin.php' )
			);
			wp_safe_redirect( $destination . $return_route );
			exit;
		} else {
			wp_die(
				esc_html__( 'Failed to authenticate with the UiChemy app. Please try again.', 'uichemy' ) .
				'<br><br>' .
				esc_html( isset( $body['error_description'] ) ? $body['error_description'] : '' )
			);
		}
	}

	/**
	 * Tell the app this site just connected, so the account's clientConnections
	 * record knows it signed in from the WordPress plugin (and from which site).
	 * Fire-and-forget: a short timeout and no error handling, because the sign-in
	 * is already complete and this is purely bookkeeping.
	 *
	 * @param string $access_token The freshly obtained OAuth access token.
	 * @return void
	 */
	protected function record_connection( $access_token ) {
		if ( ! is_string( $access_token ) || '' === $access_token ) {
			return;
		}

		wp_remote_post(
			self::app_url() . '/api/wp/connection',
			array(
				'headers'   => array(
					'Content-Type'  => 'application/json',
					'Authorization' => 'Bearer ' . $access_token,
				),
				'body'      => wp_json_encode( array( 'siteUrl' => home_url( '/' ) ) ),
				// Blocking with a short timeout: a non-blocking request fired
				// immediately before wp_safe_redirect()+exit can be cut off before
				// it's sent, so the record would intermittently never arrive. The
				// app host is the same one we just exchanged the token with, so
				// it's reachable and this adds only a brief, one-time wait.
				'timeout'   => 8,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);
	}

	/**
	 * Counterpart to record_connection(): on logout, ask the app to delete this
	 * site's connection record. Fire-and-forget with the still-valid token.
	 *
	 * @param string|false $access_token The current OAuth access token.
	 * @return void
	 */
	protected function remove_connection( $access_token ) {
		if ( ! is_string( $access_token ) || '' === $access_token ) {
			return;
		}

		wp_remote_request(
			self::app_url() . '/api/wp/connection',
			array(
				'method'    => 'DELETE',
				'headers'   => array(
					'Content-Type'  => 'application/json',
					'Authorization' => 'Bearer ' . $access_token,
				),
				'body'      => wp_json_encode( array( 'siteUrl' => home_url( '/' ) ) ),
				// Blocking (short timeout): a non-blocking request fired as logout
				// tears down the request often never leaves the process, so the
				// row was never actually deleted. A brief wait on logout is fine.
				'timeout'   => 8,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);
	}

	/**
	 * Decode JWT payload to extract user information.
	 *
	 * @param string $jwt The JWT token to decode.
	 * @return array|null Decoded payload or null on failure.
	 */
	protected function decode_jwt_payload( $jwt ) {
		$parts = explode( '.', $jwt );

		// A valid JWT has exactly 3 parts: header.payload.signature.
		if ( count( $parts ) !== 3 ) {
			return null;
		}

		// Base64 URL decode the payload.
		$payload = str_replace( array( '-', '_' ), array( '+', '/' ), $parts[1] );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions -- JWT payload segment is Base64URL (RFC 7519), not executable code.
		$decoded = base64_decode( $payload );

		if ( ! $decoded ) {
			return null;
		}

		return json_decode( $decoded, true );
	}

	/**
	 * Basic checks on opaque OAuth tokens before storing (avoid control chars / absurd length).
	 *
	 * @param mixed $token Token value.
	 * @return bool
	 */
	protected function is_storable_oauth_token( $token ) {
		if ( ! is_string( $token ) ) {
			return false;
		}
		$len = strlen( $token );
		if ( $len < 10 || $len > 8192 ) {
			return false;
		}
		return ! preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $token );
	}

	/**
	 * Sanity-check an id_token before decoding. Unlike opaque access/refresh tokens,
	 * an id_token is a JWT whose size legitimately grows with the claims the OIDC
	 * provider embeds (e.g. a long `picture` URL), so the 8192-char ceiling used for
	 * opaque tokens rejected valid id_tokens for some accounts (ClickUp 86d3ewmcu) —
	 * this uses a much higher ceiling and checks JWT shape instead. Real validation
	 * still happens via decode_jwt_payload() + validate_id_token_payload().
	 *
	 * @param mixed $token Token value.
	 * @return bool
	 */
	protected function is_storable_id_token( $token ) {
		if ( ! is_string( $token ) ) {
			return false;
		}
		$len = strlen( $token );
		if ( $len < 10 || $len > 65536 ) {
			return false;
		}
		// JWT = header.payload.signature — exactly two dots.
		if ( substr_count( $token, '.' ) !== 2 ) {
			return false;
		}
		return ! preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $token );
	}

	/**
	 * Validate OpenID id_token claims after payload decode (expiry, optional issuer allow-list).
	 * Does not verify JWT signature; rely on TLS to the token endpoint and/or add JWKS verification separately.
	 *
	 * @param array $payload Decoded JWT payload.
	 * @return bool
	 */
	protected function validate_id_token_payload( $payload ) {
		if ( ! is_array( $payload ) || empty( $payload['sub'] ) || ! is_string( $payload['sub'] ) ) {
			return false;
		}
		if ( isset( $payload['exp'] ) && (int) $payload['exp'] < time() ) {
			return false;
		}

		// Audience (OIDC Core §3.1.3.7): the client should confirm the token was
		// minted for it. OFF by default — like the issuer allow-list below — because
		// a false return here blocks sign-in entirely, and this brokered flow is
		// already bound by PKCE + TLS (sslverify). A deployment that wants strict
		// validation filters the expected audience to its client id, e.g.:
		//   add_filter( 'uich_webpage_oidc_expected_audience', fn() => UICH_WEBPAGE_CLIENT_ID );
		// `aud` may be a single string or an array of strings.
		$expected_aud = (string) apply_filters( 'uich_webpage_oidc_expected_audience', '' );
		if ( '' !== $expected_aud && isset( $payload['aud'] ) ) {
			$aud = is_array( $payload['aud'] ) ? array_map( 'strval', $payload['aud'] ) : array( (string) $payload['aud'] );
			if ( ! in_array( $expected_aud, $aud, true ) ) {
				return false;
			}
		}

		$allowed_issuers = apply_filters( 'uich_webpage_oidc_allowed_issuers', array() );
		if ( ! empty( $allowed_issuers ) && isset( $payload['iss'] ) ) {
			return is_string( $payload['iss'] ) && in_array( $payload['iss'], $allowed_issuers, true );
		}
		return true;
	}

	/**
	 * Check if user is authenticated.
	 *
	 * Local check only — it asks whether we HOLD a token, not whether that token
	 * is still good. Cheap enough to call anywhere; call validate_session() when
	 * the answer needs to reflect the app's current state.
	 *
	 * @return bool
	 */
	public function is_authenticated() {
		return ! empty( $this->get_access_token() );
	}

	/**
	 * Confirm with the app that this site is still connected, and sign out locally
	 * if it isn't.
	 *
	 * Needed because is_authenticated() only looks at our own options table: when
	 * the customer signs this site out from the UiChemy dashboard, nothing here
	 * changes and the plugin keeps showing a signed-in screen until some unrelated
	 * API call happens to fail. This is the check that closes that gap.
	 *
	 * Two ways to be signed out, matching what the endpoint reports:
	 *   • 401 — the token was revoked. request() already tries a refresh first, and
	 *     a rejected refresh clears our tokens on its own.
	 *   • connected:false — the token still works but this site's connection record
	 *     is gone, i.e. its seat was released.
	 *
	 * Throttled to once per VALIDATE_SESSION_TTL (see TRANSIENT_SESSION_OK) — a
	 * sign-out from the app shows up within a few minutes rather than blocking
	 * every single page load on a round trip. Network/5xx failures deliberately
	 * change nothing: a flaky connection must never sign a customer out.
	 *
	 * @return bool True if still connected.
	 */
	public function validate_session() {
		if ( ! $this->is_authenticated() ) {
			return false;
		}

		if ( get_transient( self::TRANSIENT_SESSION_OK ) ) {
			return true;
		}

		$response = $this->request_connection_state( $this->get_api_bearer() );
		$code     = is_wp_error( $response ) ? 0 : wp_remote_retrieve_response_code( $response );

		// A 401 while using the short-lived token may be about the TOKEN, not the
		// account (a rotated signing secret, a clock far enough out to fail the
		// expiry check). Drop it and ask once more with the OAuth token itself, so
		// only a genuine 401 reaches the refresh/logout path below.
		if ( 401 === $code && get_transient( self::TRANSIENT_API_JWT ) ) {
			$this->clear_api_jwt();
			$response = $this->request_connection_state( $this->get_access_token() );
			$code     = is_wp_error( $response ) ? 0 : wp_remote_retrieve_response_code( $response );
		}

		// Couldn't reach the app — assume nothing and try again next time.
		if ( is_wp_error( $response ) ) {
			return true;
		}

		if ( 401 === $code ) {
			// The access token is dead. One refresh attempt: if the refresh token
			// is also revoked, refresh_access_token() logs us out itself.
			if ( ! $this->refresh_access_token() ) {
				$this->logout();
				return false;
			}
			// Refresh worked, so the account is fine — re-check on the next load.
			return true;
		}

		if ( $code >= 500 ) {
			return true; // app trouble, not ours
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( is_array( $body ) && isset( $body['connected'] ) && false === $body['connected'] ) {
			$this->logout();
			return false;
		}

		// Confirmed — skip this check until the window lapses.
		set_transient( self::TRANSIENT_SESSION_OK, 1, self::validate_session_ttl() );

		return true;
	}

	/**
	 * Ask the app whether this site is still connected.
	 *
	 * @param string|false $bearer Token to authenticate with.
	 * @return array|WP_Error Raw wp_remote_get result.
	 */
	protected function request_connection_state( $bearer ) {
		return wp_remote_get(
			add_query_arg(
				'siteUrl',
				rawurlencode( home_url( '/' ) ),
				self::app_url() . '/api/wp/connection'
			),
			array(
				'headers'   => array( 'Authorization' => 'Bearer ' . $bearer ),
				'timeout'   => 8,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);
	}

	/**
	 * Ask the app for the signed-in account's plan/capacity.
	 *
	 * Used to tell an actual Pro PURCHASE apart from merely having the Pro
	 * plugin installed and active on this one site (see Uich_ND_Auth::
	 * get_capacity_plan(), which turns this into plan/purchased for the rail
	 * card) — install/activate is unrestricted, so `uichemy_is_pro()` alone
	 * cannot answer "did the connected account pay for anything".
	 *
	 * @return array|false Decoded `{ email, capacity }` body (capacity may be
	 *                      null for an account with nothing synced yet), or
	 *                      false when signed out, unreachable, or the app
	 *                      answered with anything but 200.
	 */
	public function get_capacity() {
		if ( ! $this->is_authenticated() ) {
			return false;
		}

		// See TRANSIENT_CAPACITY: dedupes the two calls one dashboard page load
		// already makes (server render + the /state REST probe). A cache miss
		// still costs at most the JWT attempt plus one 401 retry, same as
		// before this existed.
		$cached = get_transient( self::TRANSIENT_CAPACITY );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$response = $this->request_capacity( $this->get_api_bearer() );
		$code     = is_wp_error( $response ) ? 0 : wp_remote_retrieve_response_code( $response );

		// Same short-lived-token retry as validate_session(): a 401 on the JWT
		// may be about the TOKEN, not the account, so try once more with the
		// OAuth access token itself before giving up.
		if ( 401 === $code && get_transient( self::TRANSIENT_API_JWT ) ) {
			$this->clear_api_jwt();
			$response = $this->request_capacity( $this->get_access_token() );
			$code     = is_wp_error( $response ) ? 0 : wp_remote_retrieve_response_code( $response );
		}

		if ( is_wp_error( $response ) || 200 !== $code ) {
			// Not cached — a failure must never be sticky, same rule as
			// TRANSIENT_SESSION_OK.
			return false;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) ) {
			return false;
		}

		set_transient( self::TRANSIENT_CAPACITY, $body, self::CAPACITY_TTL );
		return $body;
	}

	/**
	 * @param string|false $bearer Token to authenticate with.
	 * @return array|WP_Error Raw wp_remote_get result.
	 */
	protected function request_capacity( $bearer ) {
		return wp_remote_get(
			self::app_url() . '/api/capacity',
			array(
				'headers'   => array( 'Authorization' => 'Bearer ' . $bearer ),
				'timeout'   => 8,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);
	}

	/**
	 * The token to send on routine calls to the app: a cached short-lived access
	 * JWT, minted from the OAuth access token when there isn't one.
	 *
	 * Falls back to the OAuth access token itself whenever the exchange can't
	 * happen — an app deploy that predates /api/wp/token, an unreachable host, a
	 * token the app rejects. Every endpoint still accepts it, so the worst case is
	 * the behaviour this plugin had before: correct, just one lookup heavier.
	 *
	 * Only used where the app resolves the ACCOUNT. Connecting and disconnecting a
	 * site key their record on the OAuth token row's id, which a JWT doesn't
	 * carry, so those keep sending the access token directly.
	 *
	 * @return string|false Bearer token, or false when the site isn't connected.
	 */
	protected function get_api_bearer() {
		$cached = get_transient( self::TRANSIENT_API_JWT );
		if ( is_string( $cached ) && '' !== $cached ) {
			return $cached;
		}

		$access_token = $this->get_access_token();
		if ( ! $access_token ) {
			return false;
		}

		$response = wp_remote_post(
			self::app_url() . '/api/wp/token',
			array(
				'headers'   => array( 'Authorization' => 'Bearer ' . $access_token ),
				'timeout'   => 15,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);

		if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
			return $access_token;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) || empty( $body['token'] ) || empty( $body['expiresIn'] ) ) {
			return $access_token;
		}

		// Expire our copy early, so a cached token is never handed out close enough
		// to its `exp` to die in flight. A minute of margin normally — but never
		// more than half the token's life, or a short TTL (a few seconds, as used
		// when testing expiry) would be cached for far longer than it is valid and
		// every call would 401.
		$expires_in = (int) $body['expiresIn'];
		$margin     = min( 60, (int) floor( $expires_in / 2 ) );
		$ttl        = max( 1, $expires_in - $margin );
		set_transient( self::TRANSIENT_API_JWT, $body['token'], $ttl );

		return $body['token'];
	}

	/** Drop the cached access JWT so the next call mints a fresh one. */
	protected function clear_api_jwt() {
		delete_transient( self::TRANSIENT_API_JWT );
	}

	/**
	 * Get stored user info.
	 *
	 * @return array|false
	 */
	public function get_user_info() {
		return get_option( self::OPTION_USER_INFO, false );
	}

	/**
	 * Get stored user ID (sub from JWT).
	 *
	 * @return string|false
	 */
	public function get_user_id() {
		return get_option( self::OPTION_USER_ID, false );
	}

	/**
	 * Get stored access token.
	 *
	 * @return string|false
	 */
	public function get_access_token() {
		$stored = get_option( self::OPTION_ACCESS_TOKEN, false );
		if ( ! is_string( $stored ) || '' === $stored ) {
			return false;
		}
		return $this->decrypt_token( $stored );
	}

	/**
	 * Refresh the access token using the stored refresh token.
	 *
	 * Called when an API request fails with 401 (access token expired). Unlike
	 * exchange_code_for_token(), this runs during normal requests, so it NEVER
	 * calls wp_die()/redirect — it returns a bool and lets the caller decide.
	 *
	 * @return bool True if a new access token was stored, false otherwise.
	 */
	public function refresh_access_token() {
		$stored_refresh_token = get_option( self::OPTION_REFRESH_TOKEN, false );
		$refresh_token        = ( is_string( $stored_refresh_token ) && '' !== $stored_refresh_token )
			? $this->decrypt_token( $stored_refresh_token )
			: false;
		if ( empty( $refresh_token ) ) {
			return false;
		}

		// Public client: the refresh grant is authenticated by possession of the
		// refresh_token bound to this client_id — no client_secret involved.
		$response = wp_remote_post(
			self::oauth_base_url() . '/token',
			array(
				'body'      => array(
					'grant_type'    => 'refresh_token',
					'refresh_token' => $refresh_token,
					'client_id'     => UICH_WEBPAGE_CLIENT_ID,
				),
				'timeout'   => 30,
				'sslverify' => uich_webpage_http_sslverify(),
			)
		);

		if ( is_wp_error( $response ) ) {
			return false;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		// HTTP 4xx = token definitively rejected (invalid_grant, expired, revoked).
		// Clear stored tokens so the next page load shows the login screen.
		if ( $code >= 400 && $code < 500 ) {
			$this->logout();
			return false;
		}

		// HTTP 5xx or unexpected body = transient server error; keep tokens and let the caller retry.
		if ( $code >= 500 || ! isset( $body['access_token'] ) || ! $this->is_storable_oauth_token( $body['access_token'] ) ) {
			return false;
		}

		update_option( self::OPTION_ACCESS_TOKEN, $this->encrypt_token( $body['access_token'] ), false );

		// Refresh tokens rotate on use — persist the new one if returned.
		if ( isset( $body['refresh_token'] ) && $this->is_storable_oauth_token( $body['refresh_token'] ) ) {
			update_option( self::OPTION_REFRESH_TOKEN, $this->encrypt_token( $body['refresh_token'] ), false );
		}

		// NOTE: deliberately no record_connection() here. A refresh is not a new
		// connection, and re-registering on every refresh would let a site that the
		// customer just signed out from the dashboard quietly re-add itself the
		// next time its token rotated. The connection record is keyed by site URL
		// and created once at connect time; validate_session() is what notices when
		// it has been taken away.

		// id_token may also be reissued. Also re-decodes into OPTION_USER_INFO so an
		// account previously rejected by the old opaque-token length check (ClickUp
		// 86d3ewmcu) self-heals on its next silent token refresh, without requiring
		// an explicit reconnect.
		if ( isset( $body['id_token'] ) && $this->is_storable_id_token( $body['id_token'] ) ) {
			update_option( self::OPTION_ID_TOKEN, $this->encrypt_token( $body['id_token'] ), false );
			$user_info = $this->decode_jwt_payload( $body['id_token'] );
			if ( $user_info && $this->validate_id_token_payload( $user_info ) ) {
				update_option( self::OPTION_USER_INFO, $user_info, false );
				if ( isset( $user_info['sub'] ) && is_string( $user_info['sub'] ) ) {
					update_option( self::OPTION_USER_ID, sanitize_text_field( $user_info['sub'] ), false );
				}
			}
		}

		return true;
	}

	/**
	 * Logout user by clearing stored tokens.
	 */
	public function logout() {
		// Before dropping the token, ask the app to remove this site's
		// connection record (clientConnections). Best-effort — read the token
		// first, since the delete_option calls below wipe it.
		$this->remove_connection( $this->get_access_token() );

		delete_option( self::OPTION_ACCESS_TOKEN );
		delete_option( self::OPTION_REFRESH_TOKEN );
		delete_option( self::OPTION_ID_TOKEN );
		delete_option( self::OPTION_USER_INFO );
		delete_option( self::OPTION_USER_ID );

		// Drop any half-finished flow markers too, so a logout during a pending
		// connect can't leave a stale verifier for the next one to trip over.
		delete_transient( self::TRANSIENT_PKCE_VERIFIER );
		delete_transient( self::TRANSIENT_OAUTH_PENDING );
		delete_transient( self::TRANSIENT_RETURN_ROUTE );

		// The cached access JWT outlives the credentials it was minted from — it
		// is signed, not stored, so nothing else invalidates it. All three MUST
		// go, or the next account to connect inherits this one's answers.
		delete_transient( self::TRANSIENT_API_JWT );
		delete_transient( self::TRANSIENT_SESSION_OK );
		delete_transient( self::TRANSIENT_CAPACITY );
	}

	/**
	 * Register REST API routes.
	 */
	public function register_rest_routes() {
		register_rest_route(
			'uichemy/v2/webpage',
			'/auth/authorize-url',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_authorize_url' ),
				'permission_callback' => array( $this, 'check_permission' ),
				'args'                => array(
					// Where to land after the account is connected. Validated
					// against RETURN_ROUTES, so an unknown value falls back to
					// the dashboard root rather than being rejected.
					'route' => array(
						'required' => false,
						'type'     => 'string',
						'default'  => '',
					),
				),
			)
		);
		register_rest_route(
			'uichemy/v2/webpage',
			'/auth/logout',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle_logout' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);
	}

	/**
	 * REST: return OAuth authorize URL (creates/refreshes pending state transient only when called).
	 *
	 * @param \WP_REST_Request|null $request Carries the optional `route`.
	 * @return \WP_REST_Response
	 */
	public function handle_authorize_url( $request = null ) {
		$route    = $request instanceof WP_REST_Request ? (string) $request->get_param( 'route' ) : '';
		$auth_url = $this->get_authorization_url( $route );
		if ( ! $auth_url ) {
			return new WP_REST_Response(
				array( 'error' => __( 'Failed to connect to the UiChemy app. Please try again.', 'uichemy' ) ),
				502
			);
		}
		return new WP_REST_Response( array( 'authorization_url' => $auth_url ) );
	}

	/**
	 * REST API callback: Handle logout.
	 *
	 * @return \WP_REST_Response
	 */
	public function handle_logout() {
		$this->logout();
		return new WP_REST_Response(
			array(
				'success' => true,
				'message' => __( 'Logged out successfully.', 'uichemy' ),
			)
		);
	}

	/**
	 * Check REST API permission.
	 *
	 * @return bool
	 */
	public function check_permission() {
		return current_user_can( 'manage_options' );
	}
}
