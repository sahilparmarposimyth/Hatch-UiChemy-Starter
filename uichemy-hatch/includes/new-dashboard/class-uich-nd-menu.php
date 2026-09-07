<?php
/**
 * Admin menu wiring for the new dashboard.
 *
 * Registers the top-level "UiChemy" menu at admin_menu priority 11.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Menu' ) ) {

	final class Uich_ND_Menu {

		public static function boot() {
			add_action( 'admin_menu', array( __CLASS__, 'register_menu' ), 11 );

			// Send old bookmarks / external links from the legacy
			// `uichemy-welcome` slug to the new `uichemy` page.
			add_action( 'admin_init', array( __CLASS__, 'redirect_legacy_slug' ) );

			// First-time activation: bounce straight to the dashboard so the
			// onboarding wizard shows immediately instead of leaving the admin
			// on the plugins.php activation notice screen.
			add_action( 'admin_init', array( __CLASS__, 'maybe_redirect_after_activation' ) );

			// Onboarding "Activate Elementor" flow: the React install link
			// sends users to plugins.php?action=activate&from=uichemy&...
			// After WP finishes activation, bounce them back to the
			// dashboard so the wizard can pick up the now-active builder.
			add_action( 'activated_plugin', array( __CLASS__, 'redirect_after_uichemy_activate' ), 10, 1 );

			// Whiten the SVG icon when the UiChemy menu item is current.
			// Our icon is loaded as <img> so WP's admin-color rules don't
			// recolor it — `filter: brightness(0) invert(1)` does the job.
			add_action( 'admin_head', array( __CLASS__, 'menu_icon_active_css' ) );
		}

		public static function menu_icon_active_css() {
			// Only for OUR bundled monochrome mark. A white-label logo is the
			// customer's own artwork — `brightness(0) invert(1)` would flatten it
			// to a white silhouette, so leave it exactly as uploaded.
			if ( '' !== uich_brand_logo_url() ) {
				return;
			}

			echo '<style>'
				// Our icon is an <img>, so WP's admin-color rules don't recolor
				// it and its default state renders dimmed/off-tint compared to
				// the dashicon siblings. Force pure white at rest so it matches
				// the other menu items, and keep it white on hover/current.
				. '#adminmenu li.toplevel_page_uichemy .wp-menu-image img'
				. '{filter:brightness(0) invert(1);opacity:1;}'
				. '</style>';
		}

		public static function redirect_after_uichemy_activate( $plugin ) {
			if ( ! isset( $_GET['from'] ) || 'uichemy' !== $_GET['from'] ) {  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Admin screen; capability verified; read-only navigation param.
				return;
			}
			wp_safe_redirect( admin_url( 'admin.php?page=uichemy' ) );
			exit;
		}

		public static function maybe_redirect_after_activation() {
			if ( ! get_transient( 'uich_do_activation_redirect' ) ) {
				return;
			}
			delete_transient( 'uich_do_activation_redirect' );

			// Skip on bulk activation, AJAX, network admin, or if the user
			// simply doesn't have access to the dashboard page.
			if ( wp_doing_ajax() || is_network_admin() || isset( $_GET['activate-multi'] ) || ! current_user_can( 'manage_options' ) ) {  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Admin screen; capability verified; read-only navigation param.
				return;
			}

			wp_safe_redirect( admin_url( 'admin.php?page=uichemy' ) );
			exit;
		}

		public static function redirect_legacy_slug() {
			if ( isset( $_GET['page'] ) && 'uichemy-welcome' === $_GET['page'] ) {  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Admin screen; capability verified; read-only navigation param.
				wp_safe_redirect( admin_url( 'admin.php?page=uichemy' ) );
				exit;
			}
		}

		public static function register_menu() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}

			/*
			 * White Label owns this menu's name and icon.
			 *
			 * UiChemy_Admin_Menu has done this since White Label shipped, but that
			 * method returns early in a merged build (this plugin owns the one menu),
			 * so its branding never ran on a real site — a white-labelled install
			 * still showed "UiChemy" and the UiChemy mark here. Same for "hide from
			 * other admins", whose only implementation lived in that dead branch.
			 */
			if ( uich_brand_hidden_from_current_user() ) {
				return;
			}

			$label = uich_brand_name();
			$icon  = uich_brand_menu_icon();

			add_menu_page(
				$label,
				$label,
				'manage_options',
				'uichemy',
				array( __CLASS__, 'render_page' ),
				$icon
			);
		}

		public static function render_page() {
			echo '<div id="' . esc_attr( UICH_ND_MOUNT ) . '"></div>';
		}
	}
}
