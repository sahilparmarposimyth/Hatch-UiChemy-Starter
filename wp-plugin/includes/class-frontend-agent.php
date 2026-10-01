<?php
/**
 * Hatch Frontend Agent — WordPress-side manager.
 *
 * Manages the connection to a Hatch Agent running on the user's frontend VPS.
 * Pattern is inspired by RunCloud:
 *
 *   1. User clicks "Set up Agent" in WP admin
 *   2. WP generates: HMAC shared secret + one-time install token (10 min TTL)
 *   3. WP shows: curl -H "X-Hatch-Agent-Token: XXX" <wp-url>/hatch-agent-installer | sudo bash
 *   4. User runs that on their VPS as root
 *   5. The install script (served by Hatch_Frontend_Installer_Route) installs
 *      Node.js daemon at /opt/hatch-agent, registers systemd, opens firewall
 *   6. User comes back to WP admin, enters VPS host:port
 *   7. WP verifies connection with HMAC-signed ping
 *   8. Connection saved. "Update Frontend" button enabled.
 *
 * Security:
 *   - HMAC-SHA256 signature on every request (replay protection via timestamp + nonce)
 *   - Secret encrypted at rest via sodium (key derived from wp_salt)
 *   - Agent only runs whitelisted commands — no arbitrary shell
 *   - Connection token is one-time, 10-minute TTL
 *
 * @package Hatch
 */

defined( 'ABSPATH' ) || exit;

/**
 * Hatch_Frontend_Agent
 */
class Hatch_Frontend_Agent {

	/** Option keys */
	const OPT_HOST            = 'hatch_agent_host';            // "1.2.3.4:34210" or "agent.mysite.com:34210"
	const OPT_SECRET          = 'hatch_agent_secret_encrypted';
	const OPT_CONNECTED_AT    = 'hatch_agent_connected_at';
	const OPT_LAST_PING       = 'hatch_agent_last_ping';
	const OPT_LAST_STATUS     = 'hatch_agent_last_status';
	const OPT_FRONTEND_URL    = 'hatch_agent_frontend_url';
	const OPT_GIT_REPO        = 'hatch_agent_git_repo';
	const OPT_GIT_BRANCH      = 'hatch_agent_git_branch';
	const OPT_CERT_PIN        = 'hatch_agent_cert_pin';        // base64 sha256 of the agent certificate's public key (SPKI).

	/** Token transient for one-time install URL */
	const TRANSIENT_INSTALL_TOKEN = 'hatch_agent_install_token';
	const INSTALL_TOKEN_TTL       = 10 * MINUTE_IN_SECONDS;

	/** HMAC clock skew tolerance */
	const HMAC_WINDOW_SECONDS = 300; // 5 minutes

	/**
	 * @var Hatch_Frontend_Agent|null
	 */
	private static $instance = null;

	/**
	 * Singleton accessor.
	 *
	 * @return Hatch_Frontend_Agent
	 */
	public static function instance(): Hatch_Frontend_Agent {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Wire REST routes for the agent admin UI.
	 */
	private function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/* ----------------------------------------------------------------
	 * REST ROUTES (admin UI calls these from the dashboard)
	 * ---------------------------------------------------------------- */

	/**
	 * Register agent management routes.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			HATCH_REST_NAMESPACE,
			'/agent/generate-install-token',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'route_generate_token' ),
				'permission_callback' => array( 'Hatch_Rest_Api', 'permission_admin_static' ),
			)
		);

		register_rest_route(
			HATCH_REST_NAMESPACE,
			'/agent/verify',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'route_verify_connection' ),
				'permission_callback' => array( 'Hatch_Rest_Api', 'permission_admin_static' ),
				'args'                => array(
					'host' => array( 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ),
				),
			)
		);

		register_rest_route(
			HATCH_REST_NAMESPACE,
			'/agent/update',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'route_trigger_update' ),
				'permission_callback' => array( 'Hatch_Rest_Api', 'permission_admin_static' ),
			)
		);

		register_rest_route(
			HATCH_REST_NAMESPACE,
			'/agent/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'route_status' ),
				'permission_callback' => array( 'Hatch_Rest_Api', 'permission_admin_static' ),
			)
		);

		register_rest_route(
			HATCH_REST_NAMESPACE,
			'/agent/disconnect',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'route_disconnect' ),
				'permission_callback' => array( 'Hatch_Rest_Api', 'permission_admin_static' ),
			)
		);
	}

	/* ----------------------------------------------------------------
	 * ROUTE: Generate one-time install token + secret
	 * ---------------------------------------------------------------- */
	public function route_generate_token( WP_REST_Request $request ): WP_REST_Response {
		unset( $request );
		// Generate a fresh agent secret (replaces any previous one).
		$secret = wp_generate_password( 48, false );
		$stored = $this->store_secret( $secret );
		if ( is_wp_error( $stored ) ) {
			return new WP_REST_Response(
				array( 'error' => $stored->get_error_message() ),
				501
			);
		}

		// One-time token for the install script URL.
		$token = wp_generate_password( 32, false );
		set_transient( self::TRANSIENT_INSTALL_TOKEN, hash( 'sha256', $token ), self::INSTALL_TOKEN_TTL );

		// Build the curl command for the user.
		// H-4: the token travels in a header, never the URL, so it stays out of
		// access logs, proxy logs and shell/browser history.
		$installer_url = home_url( '/hatch-agent-installer' );

		return new WP_REST_Response( array(
			'curl_command'  => 'curl -fsSL -H "X-Hatch-Agent-Token: ' . $token . '" ' . esc_url_raw( $installer_url ) . ' | sudo bash',
			'expires_in'    => self::INSTALL_TOKEN_TTL,
			'secret_preview'=> substr( $secret, 0, 6 ) . '…' . substr( $secret, -4 ),
		), 200 );
	}

	/* ----------------------------------------------------------------
	 * ROUTE: Verify a fresh agent connection
	 * ---------------------------------------------------------------- */
	public function route_verify_connection( WP_REST_Request $request ) {
		$host = (string) $request->get_param( 'host' );
		if ( ! self::is_valid_host( $host ) ) {
			return new WP_Error( 'hatch_invalid_host', __( 'Host must be in the form ip:port or hostname:port', 'hatch' ), array( 'status' => 400 ) );
		}

		// Pairing is the one moment a certificate may be trusted. Try normal CA
		// verification first (a real certificate needs no pin); only if the TLS
		// handshake itself is what fails, pin the agent's key (trust on first use).
		$old_pin = (string) get_option( self::OPT_CERT_PIN, '' );
		delete_option( self::OPT_CERT_PIN );
		$response = $this->call_agent( $host, 'GET', '/v1/healthz', array() );
		if ( is_wp_error( $response ) && 'hatch_agent_unreachable' === $response->get_error_code()
			&& false !== stripos( $response->get_error_message(), 'ssl' ) ) {
			$new_pin = self::fetch_spki_pin( $host );
			if ( '' !== $new_pin ) {
				update_option( self::OPT_CERT_PIN, $new_pin, false );
				$response = $this->call_agent( $host, 'GET', '/v1/healthz', array() );
			}
		}
		if ( is_wp_error( $response ) ) {
			if ( '' !== $old_pin ) {
				update_option( self::OPT_CERT_PIN, $old_pin, false ); // Failed re-pair: keep the old trust.
			} else {
				delete_option( self::OPT_CERT_PIN );
			}
			return $response;
		}

		// Save successful connection.
		update_option( self::OPT_HOST, $host );
		update_option( self::OPT_CONNECTED_AT, time() );
		update_option( self::OPT_LAST_STATUS, 'connected' );

		return new WP_REST_Response( array(
			'success'      => true,
			'host'         => $host,
			'agent_version'=> isset( $response['version'] ) ? (string) $response['version'] : 'unknown',
		), 200 );
	}

	/* ----------------------------------------------------------------
	 * ROUTE: Trigger an update (pull + build + reload)
	 * ---------------------------------------------------------------- */
	public function route_trigger_update( WP_REST_Request $request ): WP_REST_Response {
		unset( $request );
		$host = (string) get_option( self::OPT_HOST, '' );
		if ( '' === $host ) {
			return new WP_REST_Response( array( 'error' => __( 'Agent not configured.', 'hatch' ) ), 400 );
		}

		$response = $this->call_agent( $host, 'POST', '/v1/update', array(
			'branch' => (string) get_option( self::OPT_GIT_BRANCH, 'main' ),
		) );
		if ( is_wp_error( $response ) ) {
			return new WP_REST_Response( array( 'error' => $response->get_error_message() ), 502 );
		}

		return new WP_REST_Response( $response, 200 );
	}

	/* ----------------------------------------------------------------
	 * ROUTE: Status check
	 * ---------------------------------------------------------------- */
	public function route_status( WP_REST_Request $request ): WP_REST_Response {
		unset( $request );
		$host = (string) get_option( self::OPT_HOST, '' );
		if ( '' === $host ) {
			return new WP_REST_Response( array( 'connected' => false, 'message' => __( 'Agent not configured.', 'hatch' ) ), 200 );
		}

		$response = $this->call_agent( $host, 'GET', '/v1/status', array() );
		if ( is_wp_error( $response ) ) {
			return new WP_REST_Response( array(
				'connected' => false,
				'host'      => $host,
				'message'   => $response->get_error_message(),
			), 200 );
		}

		update_option( self::OPT_LAST_PING, time() );
		update_option( self::OPT_LAST_STATUS, $response );

		return new WP_REST_Response( array(
			'connected' => true,
			'host'      => $host,
			'status'    => $response,
		), 200 );
	}

	/* ----------------------------------------------------------------
	 * ROUTE: Disconnect — clear stored secret + host
	 * ---------------------------------------------------------------- */
	public function route_disconnect( WP_REST_Request $request ): WP_REST_Response {
		unset( $request );
		delete_option( self::OPT_HOST );
		delete_option( self::OPT_SECRET );
		delete_option( self::OPT_CONNECTED_AT );
		delete_option( self::OPT_LAST_PING );
		delete_option( self::OPT_LAST_STATUS );
		return new WP_REST_Response( array( 'success' => true ), 200 );
	}

	/* ----------------------------------------------------------------
	 * INSTALL-TOKEN validation (called from Hatch_Frontend_Installer_Route)
	 * ---------------------------------------------------------------- */

	/**
	 * Validate and consume a one-time install token.
	 * Returns the agent secret if valid, null otherwise.
	 *
	 * @param string $token Raw token from URL.
	 * @return string|null Plaintext secret on success.
	 */
	public static function consume_install_token( string $token ): ?string {
		$stored_hash = (string) get_transient( self::TRANSIENT_INSTALL_TOKEN );
		if ( '' === $stored_hash ) {
			return null;
		}
		if ( ! hash_equals( $stored_hash, hash( 'sha256', $token ) ) ) {
			return null;
		}
		// One-time use — delete the token immediately.
		delete_transient( self::TRANSIENT_INSTALL_TOKEN );

		$secret = self::instance()->load_secret();
		return $secret ?: null;
	}

	/* ----------------------------------------------------------------
	 * HMAC + transport
	 * ---------------------------------------------------------------- */

	/**
	 * Make an authenticated HTTP call to the agent.
	 *
	 * @param string $host     "ip:port" or "host:port"
	 * @param string $method   "GET" | "POST"
	 * @param string $path     Path beginning with /
	 * @param array  $body     Optional payload (encoded as JSON for POST).
	 * @return array<string,mixed>|WP_Error Decoded JSON response, or error.
	 */
	private function call_agent( string $host, string $method, string $path, array $body ) {
		$secret = $this->load_secret();
		if ( '' === $secret ) {
			return new WP_Error( 'hatch_no_secret', __( 'Agent secret not configured. Run install token flow first.', 'hatch' ) );
		}

		$timestamp = (string) time();
		$nonce     = bin2hex( random_bytes( 16 ) );
		$body_json = 'POST' === $method ? wp_json_encode( $body ) : '';
		if ( false === $body_json ) {
			$body_json = '';
		}

		$signing_string = $timestamp . '.' . $nonce . '.' . $method . '.' . $path . '.' . $body_json;
		$signature      = hash_hmac( 'sha256', $signing_string, $secret );

		// Allow overriding sslverify for development via filter; default to true (M-6).
		$sslverify = (bool) apply_filters( 'hatch_agent_sslverify', true );
		$args = array(
			'method'      => $method,
			'timeout'     => 30,
			'redirection' => 1,
			'sslverify'   => $sslverify,
			'headers'     => array(
				'Content-Type'      => 'application/json',
				'X-Hatch-Timestamp' => $timestamp,
				'X-Hatch-Nonce'     => $nonce,
				'X-Hatch-Signature' => $signature,
				'X-Hatch-Agent-WP'  => HATCH_VERSION,
			),
		);
		if ( 'POST' === $method ) {
			$args['body'] = $body_json;
		}

		// M-6: the agent ships a self-signed certificate. Once the operator has
		// paired it, that certificate's public key is pinned (see pin_agent_cert()),
		// and this request is accepted ONLY if the server presents that exact key —
		// enforced by curl itself during the handshake, not by a separate probe.
		$pin     = (string) get_option( self::OPT_CERT_PIN, '' );
		$pin_cb  = null;
		if ( '' !== $pin && defined( 'CURLOPT_PINNEDPUBLICKEY' ) ) {
			$args['sslverify'] = false; // Chain trust is replaced by the key pin below.
			$pin_cb            = static function ( $handle ) use ( $pin ) {
				curl_setopt( $handle, CURLOPT_SSL_VERIFYPEER, false );
				curl_setopt( $handle, CURLOPT_SSL_VERIFYHOST, 0 );
				curl_setopt( $handle, CURLOPT_PINNEDPUBLICKEY, 'sha256//' . $pin );
			};
			add_action( 'http_api_curl', $pin_cb );
		}

		// Use HTTPS first. Only permit HTTP fallback for loopback or RFC1918 private IPs (M-6).
		$url = 'https://' . $host . $path;
		$res = wp_remote_request( $url, $args );
		if ( $pin_cb ) {
			remove_action( 'http_api_curl', $pin_cb );
			if ( is_wp_error( $res ) ) {
				// A pinned host that fails its handshake must never fall back to HTTP.
				return new WP_Error( 'hatch_agent_pin_failed',
					sprintf( __( 'Agent certificate did not match the pinned key (%s). Re-verify the connection if you replaced the agent.', 'hatch' ), $res->get_error_message() )
				);
			}
		}
		if ( is_wp_error( $res ) ) {
			$host_only = explode( ':', $host )[0];
			$is_private = ( 'localhost' === $host_only )
				|| ( false !== filter_var( $host_only, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ? false : (bool) filter_var( $host_only, FILTER_VALIDATE_IP ) );

			if ( $is_private ) {
				$url = 'http://' . $host . $path;
				$res = wp_remote_request( $url, $args );
			}
		}

		if ( is_wp_error( $res ) ) {
			return new WP_Error( 'hatch_agent_unreachable',
				sprintf( __( 'Could not reach agent at %s — %s', 'hatch' ), $host, $res->get_error_message() )
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$body = (string) wp_remote_retrieve_body( $res );

		// Responses must be signed with the shared secret (agent >= 0.2.0), or an
		// attacker on the network could forge "update succeeded" / version data.
		// A reply that is unsigned, mis-signed, or older than the signing window
		// (replayed capture) is rejected. Filter exists only for lab setups.
		$res_sig = (string) wp_remote_retrieve_header( $res, 'x-hatch-signature' );
		if ( '' === $res_sig ) {
			if ( (bool) apply_filters( 'hatch_agent_require_signed', true ) ) {
				return new WP_Error( 'hatch_agent_unsigned', __( 'Agent response was not signed. Update the agent (re-run the installer) so replies can be authenticated.', 'hatch' ) );
			}
		} else {
			$res_ts    = (string) wp_remote_retrieve_header( $res, 'x-hatch-timestamp' );
			$res_nonce = (string) wp_remote_retrieve_header( $res, 'x-hatch-nonce' );
			$expected  = hash_hmac( 'sha256', $res_ts . '.' . $res_nonce . '.' . $body, $secret );
			if ( ! hash_equals( $expected, $res_sig ) ) {
				return new WP_Error( 'hatch_agent_tampered', __( 'Agent response signature verification failed.', 'hatch' ) );
			}
			if ( ! ctype_digit( $res_ts ) || abs( time() - (int) $res_ts ) > 300 ) {
				return new WP_Error( 'hatch_agent_stale', __( 'Agent response timestamp is outside the allowed window (replay, or clock drift).', 'hatch' ) );
			}
		}
		$json = json_decode( $body, true );

		if ( 200 !== $code ) {
			$msg = is_array( $json ) && isset( $json['error'] ) ? (string) $json['error'] : sprintf( 'HTTP %d', $code );
			return new WP_Error( 'hatch_agent_error', $msg, array( 'status' => $code ) );
		}

		return is_array( $json ) ? $json : array();
	}

	/* ----------------------------------------------------------------
	 * SECRET storage (encrypted with sodium when available)
	 * ---------------------------------------------------------------- */

	/**
	 * Store secret encrypted at rest.
	 *
	 * @param string $secret Plaintext secret.
	 * @return bool|WP_Error
	 */
	private function store_secret( string $secret ) {
		$enc = $this->encrypt( $secret );
		if ( is_wp_error( $enc ) ) {
			return $enc;
		}
		return update_option( self::OPT_SECRET, $enc );
	}

	/**
	 * Load and decrypt the secret.
	 *
	 * @return string Plaintext secret, or empty string if none.
	 */
	private function load_secret(): string {
		$enc = (string) get_option( self::OPT_SECRET, '' );
		if ( '' === $enc ) {
			return '';
		}
		// Migration: older versions stored the secret as `plain:<base64>` on hosts
		// without libsodium. Read it once, and immediately re-store it encrypted so
		// an existing pairing keeps working instead of silently breaking. If no
		// encryption is available the legacy value is left as it was and still works.
		if ( 0 === strpos( $enc, 'plain:' ) ) {
			$legacy = base64_decode( substr( $enc, 6 ), true );
			if ( false === $legacy || '' === $legacy ) {
				return '';
			}
			$upgraded = $this->encrypt( $legacy );
			if ( ! is_wp_error( $upgraded ) ) {
				update_option( self::OPT_SECRET, $upgraded );
			}
			return $legacy;
		}
		return $this->decrypt( $enc );
	}

	/**
	 * Derive a 32-byte key from wp_salt.
	 *
	 * @return string 32-byte key
	 */
	private function derive_key(): string {
		// auth salts rotate when wp-config changes — that's acceptable; old secret becomes garbage and user re-pairs.
		return substr( hash( 'sha256', wp_salt( 'auth' ) . wp_salt( 'secure_auth' ), true ), 0, 32 );
	}

	/**
	 * Encrypt a credential for at-rest storage in wp_options.
	 *
	 * Requires libsodium or OpenSSL AES-256-GCM; refuses to persist without encryption (M-5).
	 *
	 * @param string $plaintext Token to encrypt.
	 * @return string|WP_Error `sodium:<b64>` or `gcm:<b64>`.
	 */
	private function encrypt( string $plaintext ) {
		if ( function_exists( 'sodium_crypto_secretbox' ) ) {
			$nonce      = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
			$ciphertext = sodium_crypto_secretbox( $plaintext, $nonce, $this->derive_key() );
			return 'sodium:' . base64_encode( $nonce . $ciphertext );
		}
		if ( function_exists( 'openssl_encrypt' ) ) {
			$iv  = random_bytes( 12 );
			$tag = '';
			$enc = openssl_encrypt( $plaintext, 'aes-256-gcm', $this->derive_key(), OPENSSL_RAW_DATA, $iv, $tag, '', 16 );
			if ( false !== $enc ) {
				return 'gcm:' . base64_encode( $iv . $tag . $enc );
			}
		}
		return new WP_Error(
			'hatch_agent_no_crypto',
			__( 'libsodium or OpenSSL unavailable; refusing to store agent secret in plaintext.', 'hatch' ),
			array( 'status' => 501 )
		);
	}

	/**
	 * Inverse of encrypt().
	 *
	 * @param string $enc Stored ciphertext envelope.
	 * @return string Plaintext, or '' on failure (never throws).
	 */
	private function decrypt( string $enc ): string {
		if ( 0 === strpos( $enc, 'sodium:' ) && function_exists( 'sodium_crypto_secretbox_open' ) ) {
			$raw = base64_decode( substr( $enc, 7 ), true );
			if ( false === $raw || strlen( $raw ) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + 1 ) {
				return '';
			}
			$nonce      = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
			$ciphertext = substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
			$plain      = sodium_crypto_secretbox_open( $ciphertext, $nonce, $this->derive_key() );
			return is_string( $plain ) ? $plain : '';
		}
		if ( 0 === strpos( $enc, 'gcm:' ) && function_exists( 'openssl_decrypt' ) ) {
			$raw = base64_decode( substr( $enc, 4 ), true );
			if ( false !== $raw && strlen( $raw ) > 28 ) {
				$iv  = substr( $raw, 0, 12 );
				$tag = substr( $raw, 12, 16 );
				$ct  = substr( $raw, 28 );
				$dec = openssl_decrypt( $ct, 'aes-256-gcm', $this->derive_key(), OPENSSL_RAW_DATA, $iv, $tag );
				return false !== $dec ? (string) $dec : '';
			}
		}
		return '';
	}

	/**
	 * Fetch the agent's TLS public key and return its pin: base64(sha256(SPKI DER)),
	 * the format curl's CURLOPT_PINNEDPUBLICKEY expects. '' on any failure.
	 *
	 * Trust on first use: only called while the operator is explicitly pairing.
	 *
	 * @param string $host "host:port".
	 * @return string
	 */
	private static function fetch_spki_pin( string $host ): string {
		if ( ! function_exists( 'stream_socket_client' ) || ! function_exists( 'openssl_x509_read' ) ) {
			return '';
		}
		$ctx = stream_context_create( array(
			'ssl' => array(
				'capture_peer_cert' => true,
				'verify_peer'       => false,
				'verify_peer_name'  => false,
				'SNI_enabled'       => true,
			),
		) );
		$errno  = 0;
		$errstr = '';
		$fp     = @stream_socket_client( 'ssl://' . $host, $errno, $errstr, 10, STREAM_CLIENT_CONNECT, $ctx );
		if ( ! $fp ) {
			return '';
		}
		$params = stream_context_get_params( $fp );
		fclose( $fp );
		if ( empty( $params['options']['ssl']['peer_certificate'] ) ) {
			return '';
		}
		$pub = @openssl_pkey_get_public( $params['options']['ssl']['peer_certificate'] );
		if ( ! $pub ) {
			return '';
		}
		$details = openssl_pkey_get_details( $pub );
		if ( empty( $details['key'] ) ) {
			return '';
		}
		// The PEM body of a public key IS the SubjectPublicKeyInfo DER.
		$pem = preg_replace( '/-----(BEGIN|END) PUBLIC KEY-----|\s+/', '', (string) $details['key'] );
		$der = base64_decode( (string) $pem, true );
		if ( false === $der || '' === $der ) {
			return '';
		}
		return base64_encode( hash( 'sha256', $der, true ) );
	}

	/* ----------------------------------------------------------------
	 * VALIDATION
	 * ---------------------------------------------------------------- */

	/**
	 * Validate "host:port" format.
	 *
	 * @param string $host_with_port
	 * @return bool
	 */
	public static function is_valid_host( string $host_with_port ): bool {
		if ( ! preg_match( '/^[a-zA-Z0-9\.\-]+:\d{1,5}$/', $host_with_port ) ) {
			return false;
		}
		list( $host, $port ) = explode( ':', $host_with_port );
		$port = (int) $port;
		if ( $port < 1 || $port > 65535 ) {
			return false;
		}
		// Host must be IP or hostname.
		if ( filter_var( $host, FILTER_VALIDATE_IP ) ) {
			return true;
		}
		if ( filter_var( 'http://' . $host, FILTER_VALIDATE_URL ) ) {
			return true;
		}
		return false;
	}
}
