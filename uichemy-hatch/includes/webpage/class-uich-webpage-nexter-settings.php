<?php
/**
 * UiChemy Nexter settings: auto-enable the Nexter Extension + Theme Customizer
 * defaults confirmed safe after import (Master Action Plan Part 2). Pure
 * configuration on Nexter's own existing toggles — no import-code correctness
 * fix, just what a site owner would flip on by hand after every import.
 *
 * @package Uichemy
 */

defined( 'ABSPATH' ) || exit;

/**
 * Class Uich_Webpage_Nexter_Settings
 */
class Uich_Webpage_Nexter_Settings {

	/**
	 * Initialize REST routes.
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	/**
	 * Register REST routes.
	 */
	public function register_rest_routes() {
		register_rest_route(
			'uichemy/v2/webpage',
			'/apply-nexter-settings',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_apply_nexter_settings' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);
	}

	/**
	 * Permission check: only site admins can trigger settings changes.
	 *
	 * @return bool
	 */
	public function check_permission() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * REST callback: apply every setting confirmed safe to auto-enable after import.
	 *
	 * @param WP_REST_Request $request Request (body unused).
	 * @return WP_REST_Response
	 */
	public function rest_apply_nexter_settings( WP_REST_Request $request ) {
		$result = $this->apply_settings();
		return rest_ensure_response(
			array(
				'success'  => true,
				'warnings' => $result['warnings'],
			)
		);
	}

	/**
	 * Whether the paid Nexter Extension add-on is active — detected the same way the
	 * rest of this plugin does, via its Theme Builder post type (nxt_builder), which
	 * only Nexter Extension registers; the free Nexter theme does not.
	 *
	 * @return bool
	 */
	protected function is_nexter_extension_active() {
		return post_type_exists( 'nxt_builder' );
	}

	/**
	 * Apply all confirmed-safe settings. Every write merges into whatever the site
	 * already has on that option — nothing here wipes a setting the site owner
	 * configured by hand outside of the specific keys listed below.
	 *
	 * @return array{warnings: string[]}
	 */
	public function apply_settings() {
		$warnings = array();

		// nexter_site_performance / nexter_site_security are only ever read by the paid
		// Nexter Extension add-on — the free Nexter theme doesn't look at either option.
		// Writing them on a site without Nexter Extension is a dead write: confirmed live,
		// a real page still loaded emoji scripts and external Google Fonts despite these
		// flags being "enabled". Gate on the same Extension-active check used elsewhere in
		// this plugin rather than silently writing settings nothing will ever read.
		if ( $this->is_nexter_extension_active() ) {
			$this->apply_performance_settings();
			$this->apply_security_settings();
		} else {
			$warnings[] = __( 'Performance/security settings skipped: Nexter Extension is not installed/active (these options are only read by Nexter Extension, not the free Nexter theme).', 'uichemy' );
		}

		// Theme Customizer settings (sidebar/WooCommerce CSS) are read by the free Nexter
		// theme itself, so these apply regardless of whether Nexter Extension is active.
		$this->apply_theme_customizer_settings();

		return array( 'warnings' => $warnings );
	}

	/**
	 * Performance toggles, stored in `nexter_site_performance`. Unlike security,
	 * these are read via a legacy flat-array fallback too, so no master switch is
	 * strictly required — but "advance-performance" is the shape a real admin save
	 * produces, so writing it the same way keeps this indistinguishable from a
	 * manual save.
	 */
	protected function apply_performance_settings() {
		$performance = get_option( 'nexter_site_performance', array() );
		if ( ! is_array( $performance ) ) {
			$performance = array();
		}

		$existing = isset( $performance['advance-performance']['values'] ) && is_array( $performance['advance-performance']['values'] )
			? $performance['advance-performance']['values']
			: array();

		$to_enable = array(
			'disable_emoji_scripts',
			'disable_rsd_link',
			'disable_wlwmanifest_link',
			'disable_shortlink',
			'disable_self_pingbacks',
			// No effect on Elementor; ~59KB saved per visitor on Gutenberg — one
			// consistent default on both builders rather than a per-builder branch.
			'disable_dashicons',
		);

		$performance['advance-performance']['switch'] = true;
		$performance['advance-performance']['values'] = array_values( array_unique( array_merge( $existing, $to_enable ) ) );

		// Load Google Fonts Locally has its own independent master switch/values shape.
		$performance['google-fonts']['switch']                    = true;
		$performance['google-fonts']['values']['self_host_gfont'] = true;

		update_option( 'nexter_site_performance', $performance );

		// Legacy option name some read-paths check directly alongside the nested one above.
		update_option( 'nexter_google_fonts', array( 'self_host_gfont' => true ) );
	}

	/**
	 * Security toggles, stored in `nexter_site_security`, gated behind the
	 * "Advanced Security" master switch (off by default). `values` mixes a flat
	 * enabled-id list with key => value pairs (e.g. iframe_security), so existing
	 * entries are split and merged by shape rather than blindly array_merge'd.
	 *
	 * "Basic Security Headers" maps to two underlying flags: xss_protection (flat)
	 * and iframe_security => 'sameorigin' (NOT 'deny' — SAMEORIGIN blocks
	 * clickjacking while still allowing the Elementor editor's own iframe preview).
	 * There is no nosniff / X-Content-Type-Options toggle in this codebase.
	 */
	protected function apply_security_settings() {
		$security = get_option( 'nexter_site_security', array() );
		if ( ! is_array( $security ) ) {
			$security = array();
		}

		$existing = isset( $security['advance-security']['values'] ) && is_array( $security['advance-security']['values'] )
			? $security['advance-security']['values']
			: array();

		$existing_list  = array();
		$existing_assoc = array();
		foreach ( $existing as $key => $value ) {
			if ( is_int( $key ) ) {
				$existing_list[] = $value;
			} else {
				$existing_assoc[ $key ] = $value;
			}
		}

		$flags_to_enable = array(
			'disable_xml_rpc',
			'remove_meta_generator',
			'disable_wp_version',
			'disable_file_editor',
			'xss_protection',
		);

		$existing_list                     = array_values( array_unique( array_merge( $existing_list, $flags_to_enable ) ) );
		$existing_assoc['iframe_security'] = 'sameorigin';

		$security['advance-security']['switch'] = true;
		$security['advance-security']['values'] = array_merge( $existing_list, $existing_assoc );

		update_option( 'nexter_site_security', $security );
	}

	/**
	 * Theme Customizer / dashboard toggles, stored in `nexter_settings_opts`.
	 *
	 * Disable Theme Woo CSS is conditional: only enabled when the imported kit does
	 * NOT require WooCommerce (flagged at fetch time in Uich_Webpage_Import::run_fetch_only(),
	 * since the raw globals.json this is derived from is deleted by finalize's cleanup
	 * before this runs) — otherwise it would strip shop/cart/checkout styling out from
	 * under a site that needs it.
	 */
	protected function apply_theme_customizer_settings() {
		$settings = get_option( 'nexter_settings_opts', array() );
		if ( ! is_array( $settings ) ) {
			$settings = array();
		}
		if ( ! isset( $settings['values'] ) || ! is_array( $settings['values'] ) ) {
			$settings['values'] = array();
		}

		$settings['values']['sidebar_css'] = 1;

		$import_meta          = get_option( Uich_Webpage_Import::OPTION_IMPORT_META, array() );
		$requires_woocommerce = is_array( $import_meta ) && ! empty( $import_meta['requiresWooCommerce'] );
		if ( ! $requires_woocommerce ) {
			$settings['values']['woocommerce_min_css'] = 1;
		}

		update_option( 'nexter_settings_opts', $settings );
	}
}
