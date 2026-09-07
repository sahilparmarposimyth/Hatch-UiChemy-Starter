<?php
/**
 * One place that answers "what is this plugin called and what does its mark look
 * like right now?".
 *
 * White Label lets a site replace UiChemy's name and logo. Before this file every
 * surface answered that question for itself, so the ones that were never updated
 * (the admin menu the merged build actually registers, the React dashboard's
 * sidebar, the onboarding wizard, the composer panel, the three editor paste
 * buttons) kept painting UiChemy's mark on a white-labelled site.
 *
 * Read the settings through uich_brand_wl() only. It delegates to
 * uichemy_white_label_settings(), which is Pro-gated — reading the raw option
 * would keep a downgraded site white-labelled with no UI left to turn it off.
 *
 * Loaded from uichemy.php right after the constants so it is available to every
 * hook, including `admin_menu` and the Elementor/Bricks editor enqueues.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'uich_brand_wl' ) ) {
	/**
	 * The effective White Label settings, or an empty array when white-labeling
	 * is off / unavailable.
	 *
	 * Returns empty rather than the raw option in three cases, all of which mean
	 * "show UiChemy's own branding": the builder runtime has not booted (so the
	 * Pro gate cannot be consulted), the build is Free, or the toggle is off.
	 *
	 * @return array
	 */
	function uich_brand_wl() {
		if ( ! function_exists( 'uichemy_white_label_settings' ) ) {
			return array();
		}

		$wl = (array) uichemy_white_label_settings();

		return empty( $wl['enabled'] ) ? array() : $wl;
	}
}

if ( ! function_exists( 'uich_brand_name' ) ) {
	/**
	 * The product name to print in the UI.
	 *
	 * @return string
	 */
	function uich_brand_name() {
		$wl = uich_brand_wl();

		return ( ! empty( $wl['plugin_name'] ) )
			? (string) $wl['plugin_name']
			: __( 'UiChemy', 'uichemy' );
	}
}

if ( ! function_exists( 'uich_brand_logo_url' ) ) {
	/**
	 * The custom brand logo, or '' when the caller should draw UiChemy's own mark.
	 *
	 * Deliberately empty rather than a URL to the bundled logo: most callers draw
	 * an INLINE svg (so it inherits currentColor and stays crisp), and only swap
	 * to an <img> when there is a custom file to show.
	 *
	 * @return string
	 */
	function uich_brand_logo_url() {
		$wl = uich_brand_wl();

		return ( ! empty( $wl['logo_url'] ) ) ? esc_url_raw( $wl['logo_url'] ) : '';
	}
}

if ( ! function_exists( 'uich_brand_menu_icon' ) ) {
	/**
	 * Icon for add_menu_page(): the custom logo when set, else the bundled
	 * black-and-white mark WordPress tints for the admin menu.
	 *
	 * @return string
	 */
	function uich_brand_menu_icon() {
		$logo = uich_brand_logo_url();
		if ( '' !== $logo ) {
			return $logo;
		}

		return defined( 'UICH_URL' ) ? UICH_URL . 'assets/svg/bw-logo.svg' : '';
	}
}

if ( ! function_exists( 'uich_brand_button_logo_url' ) ) {
	/**
	 * Logo for the paste buttons injected into the Gutenberg / Elementor / Bricks
	 * editors.
	 *
	 * Unlike uich_brand_logo_url() this always returns a URL: those buttons render
	 * an <img>, so there is nothing to fall back to but the bundled file.
	 *
	 * @return string
	 */
	function uich_brand_button_logo_url() {
		$logo = uich_brand_logo_url();
		if ( '' !== $logo ) {
			return $logo;
		}

		return defined( 'UICH_URL' ) ? UICH_URL . 'assets/svg/uichemy-logo.svg' : '';
	}
}

if ( ! function_exists( 'uich_brand_hidden_from_current_user' ) ) {
	/**
	 * Whether "Hide from other admins" should hide our admin menu right now.
	 *
	 * The administrator who turned the option on is recorded as `owner_id` when it
	 * is saved; everyone else loses the menu. With no owner recorded the option is
	 * ignored, so a half-written value can never lock every admin out.
	 *
	 * @return bool
	 */
	function uich_brand_hidden_from_current_user() {
		$wl = uich_brand_wl();

		if ( empty( $wl['hide_from_others'] ) || empty( $wl['owner_id'] ) ) {
			return false;
		}

		return get_current_user_id() !== (int) $wl['owner_id'];
	}
}

if ( ! function_exists( 'uich_brand_payload' ) ) {
	/**
	 * The branding fields the JavaScript surfaces need.
	 *
	 * One shape, shared by the dashboard boot payload and the composer editor
	 * config, so React and the panel brand themselves from the same four values.
	 *
	 * @return array
	 */
	function uich_brand_payload() {
		$wl = uich_brand_wl();

		return array(
			'enabled' => empty( $wl ) ? 0 : 1,
			'name'    => uich_brand_name(),
			'logo'    => uich_brand_logo_url(),
		);
	}
}
