<?php
/**
 * Guest-safe order lookup for the headless Astro frontend.
 *
 * Woo Store API's GET /wc/store/v1/order/{id}?key=X requires the same
 * Cart-Token JWT that placed the order. Astro's order-summary page can
 * lose that token (page navigations, share links, refresh), so guests
 * see 401 even with the correct order_key in the URL.
 *
 * This bridge exposes GET /hatch/v1/order/{id}?key=X, validates the key
 * against wc_get_order()->get_order_key() with a timing-safe compare,
 * then returns a shape that mirrors Woo Store API's response so the
 * existing order-summary.astro renderer works unchanged.
 *
 * @since 0.7.6
 */

defined( 'ABSPATH' ) || exit;

class Hatch_Order_Lookup {

	/**
	 * Rate limit: max lookups per IP per window.
	 */
	const RATE_LIMIT_MAX    = 10;
	const RATE_LIMIT_WINDOW = 60; // seconds

	public static function boot(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Client IP resolved via trusted proxy configuration.
	 */
	protected static function client_ip(): string {
		if ( class_exists( 'Hatch_Auth' ) ) {
			return Hatch_Auth::client_ip();
		}
		return isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
	}

	/**
	 * Lightweight per-IP transient counter. Returns true if the caller is
	 * OVER the limit for the current window. Uses a hashed key so raw IPs
	 * never land in the options table.
	 */
	protected static function is_rate_limited( string $ip ): bool {
		$key   = 'hatch_ol_rl_' . substr( md5( $ip ), 0, 16 );
		$count = (int) get_transient( $key );
		if ( $count >= self::RATE_LIMIT_MAX ) {
			return true;
		}
		// Re-set the transient every hit so the window slides forward from the
		// first request in the burst; simpler than a fixed-window scheduler
		// and good enough to blunt enumeration attempts.
		set_transient( $key, $count + 1, self::RATE_LIMIT_WINDOW );
		return false;
	}

	public static function register_routes(): void {
		register_rest_route(
			'hatch/v1',
			'/order/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'get_order' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'id'  => array( 'required' => true, 'sanitize_callback' => 'absint' ),
					'key' => array( 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ),
				),
			)
		);
	}

	public static function get_order( WP_REST_Request $req ) {
		if ( ! function_exists( 'wc_get_order' ) ) {
			return new WP_Error( 'hatch_woo_missing', esc_html__( 'WooCommerce not active', 'hatch' ), array( 'status' => 500 ) );
		}

		// Rate-limit BEFORE any DB work so an abuser cannot cheaply enumerate
		// order IDs even under the 404-mask branch below.
		$ip = self::client_ip();
		if ( self::is_rate_limited( $ip ) ) {
			return new WP_Error(
				'hatch_rate_limited',
				esc_html__( 'Too many requests. Try again in a minute.', 'hatch' ),
				array( 'status' => 429 )
			);
		}

		$id  = (int) $req->get_param( 'id' );
		$key = (string) $req->get_param( 'key' );
		if ( $id <= 0 || '' === $key ) {
			return new WP_Error( 'hatch_bad_request', esc_html__( 'Missing id or key', 'hatch' ), array( 'status' => 400 ) );
		}

		$order = wc_get_order( $id );
		// Anti-enumeration: return the SAME 404 for both "no order" and "wrong key"
		// so an attacker cannot map which order IDs exist by watching 401 vs 404.
		// hash_equals runs when order exists so the branch stays timing-safe.
		if ( ! $order || ! hash_equals( (string) $order->get_order_key(), $key ) ) {
			return new WP_Error( 'hatch_not_found', esc_html__( 'Order not found', 'hatch' ), array( 'status' => 404 ) );
		}

		$items = array();
		foreach ( $order->get_items() as $item ) {
			$items[] = array(
				'name'     => $item->get_name(),
				'quantity' => (int) $item->get_quantity(),
				'total'    => wc_format_decimal( $item->get_total(), 2 ),
			);
		}

		$currency = $order->get_currency();
		$sym      = get_woocommerce_currency_symbol( $currency );

		return rest_ensure_response( array(
			'id'           => $order->get_id(),
			'order_number' => (string) $order->get_order_number(),
			'status'       => (string) $order->get_status(),
			'created_at'   => $order->get_date_created() ? $order->get_date_created()->date( 'c' ) : '',
			'items'        => $items,
			'totals'       => array(
				'currency_code'        => $currency,
				'currency_symbol'      => $sym,
				'currency_minor_unit'  => wc_get_price_decimals(),
				'subtotal'             => wc_format_decimal( $order->get_subtotal(), 2 ),
				'shipping'             => wc_format_decimal( $order->get_shipping_total(), 2 ),
				'tax'                  => wc_format_decimal( $order->get_total_tax(), 2 ),
				'total'                => wc_format_decimal( $order->get_total(), 2 ),
			),
			'billing_address'  => $order->get_address( 'billing' ),
			'shipping_address' => $order->get_address( 'shipping' ),
			'payment_method'   => (string) $order->get_payment_method_title(),
		) );
	}
}
