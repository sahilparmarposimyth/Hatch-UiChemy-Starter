<?php
/**
 * Shared upload-slot bookkeeping for every UiChemy upload endpoint.
 *
 * Two abilities hand an agent a short-lived credential and let it stream bytes
 * up with a shell tool instead of passing them through the model: the media
 * library (`uichemy-composer/media`, free) and code files
 * (`uichemy-composer/code-file`, Pro). What they do with the bytes is genuinely
 * different - one sideloads an attachment, the other writes a named file to a
 * fixed directory - but how the credential is minted, stored, presented and
 * checked should not differ at all, and when it was duplicated it drifted:
 * different header names, different field names for the same value, and
 * different answers to the same failure.
 *
 * So the mechanism lives here, once. Callers get the slot id, the secret, the
 * clamped TTL and the validation verdict from this class, and compose only the
 * fields that are genuinely theirs on top. The shared response vocabulary is:
 *
 *   slot            public slot id, also the ?slot= query arg
 *   slot_url      where the bytes go
 *   request_header  one ready-to-send "Name: value" line
 *   expiry          ISO 8601 with offset, unambiguous across timezones
 *   ttl_minutes     the clamped lifetime
 *   usage_example   a runnable curl line for one file
 *   instructions    what the caller must do, in order
 *
 * On failures this returns a specific error per cause rather than one generic
 * 401. Distinguishing "unknown slot" from "bad token" does let a caller learn
 * whether a slot id exists, but a slot id is 32 bits and worth nothing without
 * the 192-bit token that goes with it, so the sweep costs more than it can ever
 * return. Telling an agent mid-build that its slot EXPIRED, rather than that
 * something unspecified was forbidden, is worth more than closing an oracle
 * that yields nothing. Change `validate()` if that trade ever stops holding.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Upload_Slots' ) ) {

	final class UiChemy_Upload_Slots {

		/**
		 * The one header every UiChemy upload endpoint reads the token from.
		 *
		 * Deliberately not `Sec-` prefixed: browsers treat `Sec-*` as forbidden
		 * header names, so `fetch()` could never set it and any future in-browser
		 * uploader would be locked out of these endpoints for good.
		 */
		const TOKEN_HEADER = 'Uich-Token';

		/**
		 * How long a slot record outlives its own expiry. Keeping the record
		 * briefly past `expires_at` is what lets an expired slot answer
		 * "expired" instead of "unknown", which is the difference between an
		 * agent requesting a fresh slot and an agent hunting for a typo.
		 */
		const EXPIRY_GRACE_SECONDS = 1800;

		/**
		 * Payloads validated during this request, keyed by transient prefix, so
		 * the write handler does not repeat the lookup its permission gate just
		 * did.
		 *
		 * @var array<string,array>
		 */
		private static $validated = array();

		// ============================================================
		// ISSUE
		// ============================================================

		/**
		 * Mint a slot.
		 *
		 * @param array $args {
		 *     @type string $prefix      Transient prefix identifying the endpoint. Required.
		 *     @type int    $ttl_minutes Requested lifetime, clamped to min/max.
		 *     @type int    $min_ttl     Lower clamp. Default 1.
		 *     @type int    $max_ttl     Upper clamp. Default 30.
		 *     @type int    $default_ttl Used when ttl_minutes is absent. Default 15.
		 *     @type array  $meta        Extra values to store on the slot record.
		 * }
		 * @return array{slot:string,token:string,expires_at:int,ttl_minutes:int}|WP_Error
		 */
		public static function issue( $args = array() ) {
			$args   = is_array( $args ) ? $args : array();
			$prefix = isset( $args['prefix'] ) ? (string) $args['prefix'] : '';
			if ( '' === $prefix ) {
				return self::error( 'slot_prefix_missing', 'An upload slot needs a transient prefix.', 500 );
			}

			$user_id = get_current_user_id();
			if ( ! $user_id ) {
				return self::error( 'no_user', 'An authenticated user is required to issue an upload slot.', 401 );
			}

			$min = isset( $args['min_ttl'] ) ? (int) $args['min_ttl'] : 1;
			$max = isset( $args['max_ttl'] ) ? (int) $args['max_ttl'] : 30;
			$ttl = isset( $args['ttl_minutes'] ) && $args['ttl_minutes']
				? (int) $args['ttl_minutes']
				: ( isset( $args['default_ttl'] ) ? (int) $args['default_ttl'] : 15 );
			$ttl = max( $min, min( $max, $ttl ) );

			try {
				$slot  = bin2hex( random_bytes( 4 ) );  // 8-char public id.
				$token = bin2hex( random_bytes( 24 ) ); // 48-char secret, never persisted raw.
			} catch ( \Exception $e ) {
				return self::error( 'random_fail', 'Could not generate an upload token.', 500 );
			}

			$expires_at = time() + ( $ttl * MINUTE_IN_SECONDS );
			$meta       = isset( $args['meta'] ) && is_array( $args['meta'] ) ? $args['meta'] : array();

			$payload = array_merge(
				$meta,
				array(
					'token_hash' => wp_hash( $token ),
					'user_id'    => (int) $user_id,
					'expires_at' => $expires_at,
					'created'    => time(),
				)
			);

			$stored = set_transient(
				$prefix . $slot,
				$payload,
				( $ttl * MINUTE_IN_SECONDS ) + self::EXPIRY_GRACE_SECONDS
			);
			if ( ! $stored ) {
				return self::error( 'transient_fail', 'Could not store the upload slot.', 500 );
			}

			return array(
				'slot'        => $slot,
				'token'       => $token,
				'expires_at'  => $expires_at,
				'ttl_minutes' => $ttl,
			);
		}

		// ============================================================
		// VALIDATE
		// ============================================================

		/**
		 * Authorise a request against a slot. Call from `permission_callback`.
		 *
		 * Authorisation only: this never mutates global user state, because a
		 * permission gate can run in read-only and OPTIONS contexts. The write
		 * handler calls `adopt_user()` instead.
		 *
		 * @param WP_REST_Request $request Incoming request.
		 * @param string          $prefix  Transient prefix for this endpoint.
		 * @return array|WP_Error Slot payload, or the reason it was refused.
		 */
		public static function validate( WP_REST_Request $request, $prefix ) {
			$prefix = (string) $prefix;
			unset( self::$validated[ $prefix ] );

			$slot = sanitize_key( (string) $request->get_param( 'slot' ) );
			if ( '' === $slot ) {
				return self::error( 'slot_missing', 'Missing "slot" query arg. Request an upload slot first.', 400 );
			}

			$payload = get_transient( $prefix . $slot );
			if ( ! is_array( $payload ) || ! isset( $payload['token_hash'], $payload['expires_at'] ) ) {
				return self::error( 'slot_unknown', 'Upload slot "' . $slot . '" is not recognised. Request a new upload slot.', 404 );
			}

			if ( time() > (int) $payload['expires_at'] ) {
				return self::error(
					'slot_expired',
					'Upload slot "' . $slot . '" expired at ' . self::iso8601( (int) $payload['expires_at'] ) . '. Request a new upload slot.',
					410
				);
			}

			$token = self::pick_token( $request );
			if ( '' === $token ) {
				return self::error( 'token_invalid', 'Missing upload token. Send the ' . self::TOKEN_HEADER . ' header returned with the slot.', 401 );
			}

			if ( ! hash_equals( (string) $payload['token_hash'], wp_hash( $token ) ) ) {
				return self::error( 'token_invalid', 'Upload token does not match slot "' . $slot . '".', 401 );
			}

			// A different signed-in user may never spend someone else's slot.
			$current_uid = get_current_user_id();
			if ( $current_uid && $current_uid !== (int) $payload['user_id'] ) {
				return self::error( 'owner_mismatch', 'Upload slot "' . $slot . '" belongs to a different user.', 403 );
			}

			$payload['slot']              = $slot;
			self::$validated[ $prefix ]   = $payload;
			return $payload;
		}

		/**
		 * The payload `validate()` accepted earlier in this request.
		 *
		 * @param string $prefix Transient prefix for this endpoint.
		 * @return array|null
		 */
		public static function validated( $prefix ) {
			$prefix = (string) $prefix;
			return isset( self::$validated[ $prefix ] ) ? self::$validated[ $prefix ] : null;
		}

		/**
		 * Act as the user who issued the slot.
		 *
		 * A token-only curl PUT carries no login cookie, so the current user id
		 * is 0. Capability checks during the write - and the authorship of
		 * whatever gets created - need the issuing user. `validate()` has
		 * already refused a mismatched signed-in user by this point.
		 *
		 * @param array $payload Validated slot payload.
		 * @return void
		 */
		public static function adopt_user( $payload ) {
			if ( ! get_current_user_id() && isset( $payload['user_id'] ) ) {
				wp_set_current_user( (int) $payload['user_id'] );
			}
		}

		/**
		 * Spend a slot. Endpoints that accept exactly one file call this after a
		 * successful write; endpoints that accept many leave the slot standing
		 * until it expires.
		 *
		 * @param string $prefix Transient prefix for this endpoint.
		 * @param string $slot   Slot id.
		 * @return void
		 */
		public static function burn( $prefix, $slot ) {
			delete_transient( (string) $prefix . sanitize_key( (string) $slot ) );
		}

		/**
		 * Count one use of a multi-file slot and refuse once it has served too many.
		 *
		 * A multi-file slot stays open for its whole TTL (see burn()), so without a
		 * ceiling a single leaked token could push files into the media library
		 * without bound for up to the slot's lifetime. A legitimate editor batch
		 * stays well under the cap; the cap itself is chosen by the caller (and is
		 * filterable there). Every accepted use also fires `uich_upload_slot_used`,
		 * a hook point for audit logging / rate monitoring.
		 *
		 * The counter is a best-effort read-modify-write on the slot transient —
		 * exact under normal sequential batches, and only ever loose under a
		 * deliberate concurrent flood, which the cap still bounds.
		 *
		 * @param string $prefix Transient prefix.
		 * @param string $slot   Slot id.
		 * @param int    $max    Maximum uploads this slot may serve.
		 * @return true|WP_Error True if within the cap, WP_Error once exceeded.
		 */
		public static function register_use( $prefix, $slot, $max ) {
			$prefix = (string) $prefix;
			$slot   = sanitize_key( (string) $slot );
			$key    = $prefix . $slot;

			$payload = get_transient( $key );
			if ( ! is_array( $payload ) ) {
				// Slot vanished between validate() and here — let the normal flow 404.
				return true;
			}

			$uses = isset( $payload['uses'] ) ? (int) $payload['uses'] : 0;
			$max  = max( 1, (int) $max );
			if ( $uses >= $max ) {
				return self::error(
					'slot_exhausted',
					'Upload slot "' . $slot . '" has reached its ' . $max . '-file limit. Request a new upload slot.',
					429
				);
			}

			$payload['uses'] = $uses + 1;

			// Keep the slot's original expiry, do not extend it on use.
			$remaining = isset( $payload['expires_at'] ) ? (int) $payload['expires_at'] - time() : 0;
			$remaining = max( 1, $remaining );
			set_transient( $key, $payload, $remaining + self::EXPIRY_GRACE_SECONDS );

			/**
			 * Fires once per accepted upload-slot use — a hook for audit logging or
			 * rate monitoring. No default listener.
			 *
			 * @param string $prefix  Slot prefix (identifies the endpoint).
			 * @param string $slot    Slot id.
			 * @param array  $payload Slot payload (user_id, uses, expires_at, …).
			 */
			do_action( 'uich_upload_slot_used', $prefix, $slot, $payload );

			return true;
		}

		// ============================================================
		// REQUEST BODY
		// ============================================================

		/**
		 * Temp file the request body was streamed into, and whether it exceeded
		 * the endpoint's ceiling on the way in. At most one endpoint can match a
		 * given request, so a single pair of values covers all of them.
		 *
		 * @var string|null
		 */
		private static $body_path = null;

		/**
		 * @var bool
		 */
		private static $body_overflowed = false;

		/**
		 * Take the request body off the socket before WordPress buffers it.
		 *
		 * WP_REST_Server::serve_request() does file_get_contents('php://input')
		 * into a string before it dispatches, so by the time any callback runs the
		 * whole upload is already resident in memory. On a 256M memory_limit a
		 * large upload exhausts the worker and returns a fatal 500, and because
		 * the buffering happens before dispatch it happens before authentication
		 * too: an unauthenticated request could spend a worker's memory. Reading
		 * the stream here in fixed chunks keeps memory flat regardless of file
		 * size, and priming $HTTP_RAW_POST_DATA stops core reading the (now
		 * consumed) stream afterwards.
		 *
		 * Call during plugins_loaded, before the REST server reads anything at
		 * parse_request. Multipart POSTs are left alone: PHP has already parsed
		 * those into $_FILES and php://input is empty for them.
		 *
		 * @param string $namespace REST namespace, e.g. "uichemy/v1".
		 * @param string $route     Route, e.g. "composer-upload".
		 * @param int    $ceiling   Largest body this endpoint will ever accept.
		 * @return void
		 */
		public static function capture_body( $namespace, $route, $ceiling ) {
			$method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) : '';
			if ( 'PUT' !== $method && 'POST' !== $method ) {
				return;
			}

			$needle = trim( (string) $namespace, '/' ) . '/' . trim( (string) $route, '/' );
			$uri    = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
			if ( false === strpos( rawurldecode( $uri ), $needle ) ) {
				return;
			}

			$content_type = isset( $_SERVER['CONTENT_TYPE'] ) ? strtolower( sanitize_text_field( wp_unslash( $_SERVER['CONTENT_TYPE'] ) ) ) : '';
			if ( 0 === strpos( $content_type, 'multipart/form-data' ) ) {
				return;
			}

			$ceiling = (int) $ceiling;

			// A declared length over the ceiling needs no reading at all.
			$declared = isset( $_SERVER['CONTENT_LENGTH'] ) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
			if ( $declared > $ceiling ) {
				self::$body_overflowed         = true;
				$GLOBALS['HTTP_RAW_POST_DATA'] = '';
				return;
			}

			$in = fopen( 'php://input', 'rb' );
			if ( ! $in ) {
				return;
			}

			$path = tempnam( get_temp_dir(), 'uich-upl-' );
			if ( ! $path ) {
				fclose( $in );
				return;
			}
			$out = fopen( $path, 'wb' );
			if ( ! $out ) {
				fclose( $in );
				return;
			}

			// Copy at most one byte beyond the ceiling: PHP buffers internally, so
			// memory stays flat whatever the body size, and a result longer than
			// the ceiling is exactly the proof that the body did not fit. Anything
			// still unread stays on the socket, which is what we want for a body
			// we are about to refuse.
			$copied = stream_copy_to_stream( $in, $out, $ceiling + 1 );
			fclose( $in );
			fclose( $out );

			if ( false === $copied ) {
				wp_delete_file( $path );
				return;
			}
			if ( $copied > $ceiling ) {
				self::$body_overflowed = true;
			}

			if ( self::$body_overflowed ) {
				wp_delete_file( $path );
			} else {
				self::$body_path = $path;

				// The body is taken off the socket BEFORE the request is
				// authenticated, which is the point: an unauthenticated caller must
				// not be able to spend a worker's memory. The cost is that most
				// rejections, including every failed token check, return without
				// ever consuming the file. Nothing else runs on those paths, so the
				// capture has to clean up after itself or an unauthenticated caller
				// could fill the temp directory instead.
				register_shutdown_function( array( __CLASS__, 'discard_captured_body' ) );
			}

			// Core checks isset() before reading php://input; the stream is spent.
			$GLOBALS['HTTP_RAW_POST_DATA'] = '';
		}

		/**
		 * Path to the streamed body, if `capture_body()` claimed one.
		 *
		 * @return string|null
		 */
		public static function body_path() {
			return ( self::$body_path && file_exists( self::$body_path ) ) ? self::$body_path : null;
		}

		/**
		 * Whether the body was refused for exceeding the endpoint's ceiling.
		 *
		 * @return bool
		 */
		public static function body_overflowed() {
			return self::$body_overflowed;
		}

		/**
		 * Forget the streamed body once it has been consumed or discarded.
		 *
		 * @param string $path Path being released.
		 * @return void
		 */
		public static function release_body( $path ) {
			if ( self::$body_path === $path ) {
				self::$body_path = null;
			}
		}

		/**
		 * Delete a captured body that nothing consumed.
		 *
		 * Registered at capture time and runs at shutdown. A consumer that took
		 * the file calls release_body() first, which clears the path, so this is
		 * a no-op on the success path and only bites when the request was
		 * refused before the bytes were read.
		 *
		 * @return void
		 */
		public static function discard_captured_body() {
			if ( self::$body_path && file_exists( self::$body_path ) ) {
				wp_delete_file( self::$body_path );
			}
			self::$body_path = null;
		}

		// ============================================================
		// PRESENTATION
		// ============================================================

		/**
		 * The full header line to send, as one copy-pasteable string.
		 *
		 * @param string $token Raw token.
		 * @return string
		 */
		public static function request_header( $token ) {
			return self::TOKEN_HEADER . ': ' . (string) $token;
		}

		/**
		 * Endpoint URL carrying the slot id.
		 *
		 * @param string $namespace REST namespace, e.g. "uichemy/v1".
		 * @param string $route     Route, e.g. "composer-upload".
		 * @param string $slot      Slot id.
		 * @return string
		 */
		public static function slot_url( $namespace, $route, $slot ) {
			return add_query_arg(
				array( 'slot' => (string) $slot ),
				rest_url( trim( (string) $namespace, '/' ) . '/' . trim( (string) $route, '/' ) )
			);
		}

		/**
		 * ISO 8601 in the site's timezone. The offset keeps it unambiguous when
		 * the site timezone and the server timezone disagree.
		 *
		 * @param int $timestamp Unix timestamp.
		 * @return string
		 */
		public static function iso8601( $timestamp ) {
			return (string) wp_date( 'c', (int) $timestamp );
		}

		// ============================================================
		// HELPERS
		// ============================================================

		/**
		 * The token, however the HTTP client spelled the header.
		 *
		 * @param WP_REST_Request $request Incoming request.
		 * @return string
		 */
		private static function pick_token( WP_REST_Request $request ) {
			$candidates = array(
				$request->get_header( 'uich_token' ),
				$request->get_header( self::TOKEN_HEADER ),
				// Superseded spelling, still accepted so a slot issued before the
				// rename can still be spent by a client that cached the header.
				$request->get_header( 'x_uichemy_upload_token' ),
			);

			foreach ( $candidates as $value ) {
				if ( is_string( $value ) && '' !== trim( $value ) ) {
					return trim( $value );
				}
			}

			return '';
		}

		/**
		 * A WP_Error carrying an HTTP status, in the shared code vocabulary.
		 *
		 * @param string $code    Code, without the shared prefix.
		 * @param string $message Human-readable reason.
		 * @param int    $status  HTTP status.
		 * @param array  $data    Extra machine-readable context.
		 * @return WP_Error
		 */
		public static function error( $code, $message, $status, $data = array() ) {
			$data           = is_array( $data ) ? $data : array();
			$data['status'] = (int) $status;
			return new WP_Error( 'uich_upload_' . $code, $message, $data );
		}
	}
}
