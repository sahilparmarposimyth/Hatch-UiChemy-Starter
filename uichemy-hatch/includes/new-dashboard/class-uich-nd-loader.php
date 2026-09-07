<?php
/**
 * New Dashboard loader.
 *
 * Single entry point for the UiChemy dashboard + onboarding wizard.
 * All new-dashboard PHP lives under includes/new-dashboard/.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'UICH_ND_PATH' ) ) {
	define( 'UICH_ND_PATH', UICH_PATH . 'includes/new-dashboard/' );
}
if ( ! defined( 'UICH_ND_URL' ) ) {
	define( 'UICH_ND_URL', UICH_URL . 'includes/new-dashboard/' );
}
if ( ! defined( 'UICH_ND_BUILD_URL' ) ) {
	define( 'UICH_ND_BUILD_URL', UICH_URL . 'new-dashboard/build/' );
}
if ( ! defined( 'UICH_ND_BUILD_PATH' ) ) {
	define( 'UICH_ND_BUILD_PATH', UICH_PATH . 'new-dashboard/build/' );
}
if ( ! defined( 'UICH_ND_MOUNT' ) ) {
	define( 'UICH_ND_MOUNT', 'uich-new-dash' );
}
if ( ! defined( 'UICH_ND_MENU_SLUG' ) ) {
	define( 'UICH_ND_MENU_SLUG', 'uichemy-new-dashboard' );
}

/**
 * 🛠️ ONBOARDING TOGGLE (development).
 *
 *   true  → onboarding ek baar dikhega; complete hone ke baad agli baar
 *           dashboard pe land karoge (production behavior).
 *   false → onboarding HAR refresh pe dikhega (testing ke liye).
 */
if ( ! defined( 'UICH_ND_ONBOARDING_PERSIST' ) ) {
	define( 'UICH_ND_ONBOARDING_PERSIST', true );
}

if ( ! class_exists( 'Uich_ND_Loader' ) ) {

	final class Uich_ND_Loader {

		private static $instance;

		public static function get_instance() {
			if ( ! isset( self::$instance ) ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		private function __construct() {
			require_once UICH_ND_PATH . 'class-uich-nd-settings.php';
			require_once UICH_ND_PATH . 'class-uich-nd-auth.php';
			require_once UICH_ND_PATH . 'class-uich-nd-app-password.php';
			require_once UICH_ND_PATH . 'class-uich-nd-recommended-settings.php';
			require_once UICH_ND_PATH . 'class-uich-nd-installer.php';
			require_once UICH_ND_PATH . 'class-uich-nd-analytics.php';
			require_once UICH_ND_PATH . 'class-uich-nd-api.php';
			require_once UICH_ND_PATH . 'class-uich-nd-enqueue.php';
			require_once UICH_ND_PATH . 'class-uich-nd-menu.php';

			Uich_ND_Settings::boot();
			Uich_ND_Auth::boot();
			Uich_ND_App_Password::boot();
			Uich_ND_Recommended_Settings::boot();
			Uich_ND_Installer::boot();
			Uich_ND_Analytics::boot();
			Uich_ND_Api::boot();
			Uich_ND_Enqueue::boot();
			Uich_ND_Menu::boot();
		}
	}

	Uich_ND_Loader::get_instance();
}
