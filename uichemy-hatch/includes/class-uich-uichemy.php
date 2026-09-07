<?php
/**
 * The file that defines the core plugin class
 *
 * A class definition that includes attributes and functions used across both the
 * public-facing side of the site and the admin area.
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    Uichemy
 * @subpackage Uichemy/includes
 */

namespace Uich;

/**
 * Exit if accessed directly.
 * */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Uichemy' ) ) {

	/**
	 * It is Uichemy Main Class
	 *
	 * @since 1.0.0
	 */
	class Uich_Uichemy {

		/**
		 * Member Variable
		 *
		 * @since 1.0.0
		 * @var instance
		 */
		private static $instance;

		/**
		 *  Initiator
		 *
		 * @since 1.0.0
		 */
		public static function get_instance() {
			if ( ! isset( self::$instance ) ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		/**
		 * Define the core functionality of the plugin.
		 *
		 * @since 1.0.0
		 */
		public function __construct() {

			register_activation_hook( UICH_FILE, array( __CLASS__, 'uich_activation' ) );
			register_deactivation_hook( UICH_FILE, array( __CLASS__, 'uich_deactivation' ) );

			add_action( 'plugins_loaded', array( $this, 'uich_plugin_loaded' ) );
		}

		/**
		 * Plugin Activation.
		 *
		 * @since 1.0.0
		 * @return void
		 */
		public static function uich_activation() {
			// Consumed once by Uich_ND_Menu::maybe_redirect_after_activation()
			// on the next admin_init to send first-time activators straight
			// to the onboarding wizard.
			set_transient( 'uich_do_activation_redirect', true, MINUTE_IN_SECONDS * 5 );

			// The merged builder runtime owns tables of its own (form submissions,
			// and AI chat in Pro). Standalone UiChemy installed them from its own
			// activation hook; that plugin file is not the one WordPress activates
			// any more, so this hook has to do it.
			//
			// UICH_COMPOSER_MERGED first: without it, UICHEMY_PATH and
			// UiChemy_Activator can both belong to a still-active STANDALONE UiChemy
			// plugin, and this would run that plugin's activator instead of ours.
			//
			// The runtime's classes are all global — this file is namespaced Uich, so
			// they need the leading \ or PHP looks for Uich\UiChemy_Activator.
			if ( defined( 'UICH_COMPOSER_MERGED' ) && defined( 'UICHEMY_PATH' ) && file_exists( UICHEMY_PATH . 'includes/class-uichemy-activator.php' ) ) {
				require_once UICHEMY_PATH . 'includes/class-uichemy-activator.php';
				if ( class_exists( '\UiChemy_Activator' ) ) {
					\UiChemy_Activator::activate();
				}
			}

			// Queue the UiChemy → UiChemy Builder data migration. Only queued here,
			// never run: activation is a sandboxed request with its own timeout, and
			// a site with thousands of Elementor rows would fail to activate at all.
			// admin_init and cron drain the queue from the next request onward.
			if ( class_exists( '\Uich_Composer_Migration' ) ) {
				\Uich_Composer_Migration::schedule_on_activation();
			}
		}

		/**
		 * Plugin deactivation.
		 *
		 * @since 1.0.0
		 * @return void
		 */
		public static function uich_deactivation() {
			apply_filters( 'uich_manage_usermanager', 'delete_user' );
		}

		/**
		 * Files load plugin loaded.
		 *
		 * @since 1.0.0
		 * @return void
		 */
		public function uich_plugin_loaded() {
			$this->uich_load_textdomain();
			$this->uich_load_dependencies();
		}

		/**
		 * Load Text Domain. Text Domain : wdkit
		 *
		 * @since 1.0.0
		 */
		public function uich_load_textdomain() {
			load_plugin_textdomain( 'uichemy', false, UICH_BDNAME . '/languages/' ); // phpcs:ignore PluginCheck.CodeAnalysis.DiscouragedFunctions.load_plugin_textdomainFound -- Plugin also distributed outside wp.org; explicit textdomain load required.
		}

		/**
		 * Load the required dependencies for this plugin.
		 *
		 * -  Defines all hooks for the admin area.
		 * -  Defines all hooks for the public side of the site.
		 *
		 * @since    1.0.0
		 */
		public function uich_load_dependencies() {
			require_once UICH_PATH . 'includes/notices/class-uich-notice-main.php';
			require_once UICH_PATH . 'includes/admin/class-uich-usermanager.php';
			require_once UICH_PATH . 'includes/admin/class-uich-rest-permissions.php';
			require_once UICH_PATH . 'includes/admin/class-uich-api.php';
			require_once UICH_PATH . 'includes/admin/class-uich-enqueue.php';
			require_once UICH_PATH . 'includes/admin/class-uich-bricks-imgs.php';
			require_once UICH_PATH . 'includes/admin/class-uich-atomic-imgs.php';
			require_once UICH_PATH . 'includes/admin/class-uich-elementor.php';
			require_once UICH_PATH . 'includes/admin/class-uich-copy-images.php';
			require_once UICH_PATH . 'includes/mcp/class-uich-mcp-loader.php';

			// New dashboard.
			require_once UICH_PATH . 'includes/new-dashboard/class-uich-nd-loader.php';

			// AI Website Creator — the Import tab's "from scratch" mode. Loaded
			// after the new dashboard so its enqueue hook can attach the flow's
			// boot payload to the dashboard script handle.
			require_once UICH_PATH . 'includes/webpage/class-uich-webpage-loader.php';
		}
	}

	Uich_Uichemy::get_instance();
}
