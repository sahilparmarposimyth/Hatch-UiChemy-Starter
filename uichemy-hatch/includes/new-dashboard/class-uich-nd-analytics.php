<?php
/**
 * Onboarding analytics for the new dashboard.
 *
 * Fires a single best-effort POST to POSIMYTH's intake endpoint when
 * the wizard finishes — captures the host environment so the team can
 * see which combinations of WP / PHP / theme / builder users are
 * onboarding with. Mirrors the legacy `uich_boarding_store` AJAX from
 * class-uich-enqueue.php, ported to use new-dashboard state.
 *
 * Safe to call repeatedly: an internal "already pinged" option means we
 * only POST once per onboarding completion. Failures are swallowed.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Analytics' ) ) {

	final class Uich_ND_Analytics {

		const ENDPOINT     = 'https://api.posimyth.com/wp-json/uich/v2/uich_store_user_data';
		const OPT_PINGED   = 'uich_nd_analytics_pinged';
		const TIMEOUT_SECS = 6;

		public static function boot() {
			// On-demand class — Uich_ND_Api::route_set_onboarded calls
			// ping_onboarding directly when the user finishes the wizard.
		}

		/**
		 * Fire the onboarding ping. No-op if it's already been sent
		 * once for this site.
		 */
		public static function ping_onboarding( $consent = false ) {
			// Explicit opt-in is required before ANY site data leaves the site.
			// Re-checked here — not only at the caller — so this method can never
			// send without consent, whatever path reaches it in future.
			if ( ! $consent ) {
				return array(
					'sent'   => false,
					'reason' => 'no_consent',
				);
			}

			if ( '1' === (string) get_option( self::OPT_PINGED, '0' ) ) {
				return array(
					'sent'   => false,
					'reason' => 'already_pinged',
				);
			}

			$payload = self::build_payload();

			$response = wp_remote_post(
				self::ENDPOINT,
				array(
					'method'   => 'POST',
					'timeout'  => self::TIMEOUT_SECS,
					'blocking' => true,
					'headers'  => array( 'Content-Type' => 'application/json' ),
					'body'     => wp_json_encode( $payload ),
				)
			);

			// Mark sent even if the POST failed — we don't want to ping
			// the intake endpoint on every refresh just because a single
			// request 5xx'd. Re-ping on next major version, not refresh.
			update_option( self::OPT_PINGED, '1' );

			if ( is_wp_error( $response ) ) {
				return array(
					'sent'    => false,
					'reason'  => 'wp_error',
					'message' => $response->get_error_message(),
				);
			}

			return array(
				'sent'   => true,
				'status' => wp_remote_retrieve_response_code( $response ),
			);
		}

		/**
		 * Build the site-info payload. Mirrors the legacy shape so the
		 * intake endpoint doesn't need a separate handler for new-dashboard
		 * pings.
		 */
		private static function build_payload() {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$active_plugins = (array) get_option( 'active_plugins', array() );
			$all_plugins    = get_plugins();
			$plugin_names   = array();
			foreach ( $active_plugins as $file ) {
				if ( isset( $all_plugins[ $file ] ) ) {
					$plugin_names[] = $all_plugins[ $file ]['Name'];
				}
			}

			$theme = wp_get_theme();

			$server_software = ! empty( $_SERVER['SERVER_SOFTWARE'] )
				? sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) )
				: '';

			// Recommended settings — re-use the new dashboard's source of truth.
			$basic_requirements = array(
				'elementor_install'       => is_plugin_active( 'elementor/elementor.php' ),
				'flexbox_container'       => 'active' === get_option( 'elementor_experiment-container' ),
				'unfiltered_file_uploads' => (bool) get_option( 'elementor_unfiltered_files_upload' ),
			);

			return array(
				'web_server'         => $server_software,
				'memory_limit'       => (string) ini_get( 'memory_limit' ),
				'max_execution_time' => (string) ini_get( 'max_execution_time' ),
				'php_version'        => PHP_VERSION,
				'wp_version'         => get_bloginfo( 'version' ),
				'email'              => get_option( 'admin_email' ),
				'site_url'           => get_option( 'siteurl' ),
				'site_language'      => get_bloginfo( 'language' ),
				'theme'              => $theme ? (string) $theme->get( 'Name' ) : '',
				'plugins'            => $plugin_names,
				'basic_requirements' => $basic_requirements,
				'source'             => 'new-dashboard',
				'builder'            => Uich_ND_Settings::get_builder(),
				'mode'               => Uich_ND_Settings::get_mode(),
			);
		}
	}
}
