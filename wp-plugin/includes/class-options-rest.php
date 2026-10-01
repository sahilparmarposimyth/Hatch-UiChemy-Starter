<?php
/**
 * Hatch Options REST — admin-authenticated CRUD for plugin settings.
 *
 *   GET    /hatch/v1/options              → all whitelisted Hatch options
 *   POST   /hatch/v1/options              → update one or more options
 *
 * Whitelist approach (no arbitrary update_option) — each key has an explicit
 * sanitize callback. Means an Admin app password is enough to drive the
 * plugin remotely: no more "download zip, upload, activate, click around".
 *
 * @package Hatch
 */

defined( 'ABSPATH' ) || exit;

class Hatch_Options_Rest {

	/**
	 * key => sanitize callable
	 */
	private static function schema(): array {
		return array(
			'hatch_image_proxy_url'          => 'esc_url_raw',
			'hatch_revalidate_endpoint'      => 'esc_url_raw',
			'hatch_frontend_url'             => 'esc_url_raw',
			'hatch_security_harden_rest'     => 'rest_sanitize_boolean',
			'hatch_security_disable_xmlrpc'  => 'rest_sanitize_boolean',
			'hatch_security_block_user_enum' => 'rest_sanitize_boolean',
			'hatch_security_force_noindex'   => 'rest_sanitize_boolean',
			'hatch_revalidate_post_types'    => 'sanitize_text_field',
			'hatch_menu_primary_id'          => 'absint',
			'hatch_menu_footer_id'           => 'absint',
		);
	}

	public static function register_routes(): void {
		// v0.50.11 — /options was a legacy whitelist-based handler (10 keys).
		// Superseded by hatch_react_options_save() in admin/dashboard.php which
		// handles the React dispatcher's dot-path schema with the full key set.

		// Self-update route removed in merged build per audit finding M-8.

		register_rest_route( HATCH_REST_NAMESPACE, '/version', array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => array( __CLASS__, 'route_version' ),
			'permission_callback' => array( __CLASS__, 'require_admin' ),
		) );

		// v0.45 — soft "redeploy" / "refresh" affordance. Pings the revalidate
		// webhook if set; otherwise just returns ok after a short delay so the
		// admin gets visible feedback (spinner → tick) even when no webhook
		// is configured. Edge cache TTL is 60s anyway — content propagates.
		register_rest_route( HATCH_REST_NAMESPACE, '/refresh-cache', array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => array( __CLASS__, 'route_refresh_cache' ),
			'permission_callback' => array( __CLASS__, 'require_admin' ),
		) );
	}

	public static function require_admin(): bool {
		return current_user_can( 'manage_options' );
	}

	/**
	 * GET — return all whitelisted options + their current values.
	 */
	public static function route_get(): WP_REST_Response {
		$out = array();
		foreach ( array_keys( self::schema() ) as $key ) {
			$out[ $key ] = get_option( $key, '' );
		}
		return new WP_REST_Response( $out, 200 );
	}

	/**
	 * POST — accept JSON body { "hatch_xxx": value, ... } and update each
	 * whitelisted key through its sanitize callback.
	 */
	public static function route_post( WP_REST_Request $req ) {
		$body = $req->get_json_params();
		if ( ! is_array( $body ) ) {
			return new WP_Error( 'hatch_bad_body', __( 'JSON object expected.', 'hatch' ), array( 'status' => 400 ) );
		}

		$schema  = self::schema();
		$updated = array();
		$ignored = array();

		foreach ( $body as $key => $value ) {
			if ( ! isset( $schema[ $key ] ) ) {
				$ignored[] = $key;
				continue;
			}
			$sanitized = call_user_func( $schema[ $key ], $value );
			update_option( $key, $sanitized );
			$updated[ $key ] = $sanitized;
		}

		return new WP_REST_Response( array(
			'ok'      => true,
			'updated' => $updated,
			'ignored' => $ignored,
		), 200 );
	}

	/**
	 * POST — pings the revalidate webhook (if set) to purge edge cache.
	 * No webhook configured → returns ok anyway after a short pause so the
	 * admin UI gets visible feedback. Content always propagates within the
	 * 60s edge cache TTL.
	 */
	public static function route_refresh_cache() {
		$endpoint = trim( (string) get_option( 'hatch_revalidate_endpoint', '' ) );
		$secret   = (string) get_option( 'hatch_webhook_secret', '' );
		$pinged   = false;
		$status   = 0;

		if ( '' !== $endpoint ) {
			$url = $secret ? add_query_arg( 'secret', rawurlencode( $secret ), $endpoint ) : $endpoint;
			$res = wp_remote_post( $url, array(
				'timeout'  => 6,
				'blocking' => true,
				'headers'  => array(
					'Content-Type'   => 'application/json',
					'X-Hatch-Test'   => '1',
					'X-Hatch-Action' => 'refresh-cache',
				),
				'body'     => wp_json_encode( array( 'event' => 'hatch_refresh', 'ts' => time() ) ),
			) );
			if ( ! is_wp_error( $res ) ) {
				$pinged = true;
				$status = (int) wp_remote_retrieve_response_code( $res );
			}
		}

		return new WP_REST_Response( array(
			'ok'         => true,
			'pinged'     => $pinged,
			'status'     => $status,
			'has_webhook' => '' !== $endpoint,
			'message'    => $pinged
				? __( 'Edge cache refresh signal sent. Live content within seconds.', 'hatch' )
				: __( 'No revalidate webhook configured — content still propagates within the 60s TTL.', 'hatch' ),
		), 200 );
	}

	/**
	 * GET — version + latest available from GitHub.
	 */
	public static function route_version() {
		$current = HATCH_VERSION;
		$latest  = '';
		$err     = '';

		$res = wp_remote_get( 'https://api.github.com/repos/adityaarsharma/hatch/releases/latest', array(
			'timeout' => 10,
			'headers' => array( 'User-Agent' => 'Hatch/' . HATCH_VERSION ),
		) );
		if ( is_wp_error( $res ) ) {
			$err = $res->get_error_message();
		} else {
			$code = wp_remote_retrieve_response_code( $res );
			if ( 200 === (int) $code ) {
				$data   = json_decode( wp_remote_retrieve_body( $res ), true );
				$latest = isset( $data['tag_name'] ) ? ltrim( (string) $data['tag_name'], 'v' ) : '';
			} else {
				$err = 'GitHub API HTTP ' . $code;
			}
		}

		return new WP_REST_Response( array(
			'current'           => $current,
			'latest'            => $latest,
			'update_available'  => $latest && version_compare( $current, $latest, '<' ),
			'github_error'      => $err,
		), 200 );
	}

	/**
	 * Self-update is permanently disabled.
	 *
	 * The route used to download a zip from a personal GitHub repository and copy
	 * it over this plugin's directory with no checksum, signature or version pin
	 * (audit M-8). The route is no longer registered; this stub remains only so
	 * nothing that still references the callback fatals. Update the plugin through
	 * WordPress's own plugin updater.
	 */
	public static function route_self_update() {
		return new WP_Error(
			'hatch_no_self_update',
			__( 'Self-update is disabled. Update the plugin from the WordPress Plugins screen.', 'hatch' ),
			array( 'status' => 410 )
		);
	}
}

add_action( 'rest_api_init', array( 'Hatch_Options_Rest', 'register_routes' ) );
