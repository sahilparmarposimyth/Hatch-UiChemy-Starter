<?php
/**
 * UiChemy Builder loader — boots the merged UiChemy runtime.
 *
 * The former UiChemy plugin now lives inside this one, under `uichemy-composer/`.
 * Its 38k lines of PHP were moved across VERBATIM; nothing inside
 * `uichemy-composer/includes/` was rewritten. That is possible because every one
 * of those files reaches the filesystem and the browser through the same handful
 * of `UICHEMY_*` constants, so re-pointing the constants at the new location
 * relocates the whole subsystem without touching a single require or enqueue.
 *
 * Constant map:
 *   UICHEMY_PATH       → uichemy/uichemy-composer/          (was the plugin root)
 *   UICHEMY_URL        → same, as a URL
 *   UICHEMY_FILE       → uichemy.php — this is the plugin file now, so
 *                        register_*_hook() and plugin_basename() stay correct
 *   UICHEMY_BUILD_PATH → uichemy/new-dashboard/build/      (NEW — see below)
 *   UICHEMY_BUILD_URL  → same, as a URL
 *
 * UICHEMY_BUILD_* exist because the React bundles did NOT move with the PHP:
 * the composer panel is built by the dashboard's webpack config now, so its
 * output sits in `new-dashboard/build/` rather than under the builder folder.
 * `UICHEMY_PATH . 'composer/build/'` would point at a directory that no longer
 * exists, so the two enqueue sites that used it read these instead.
 *
 * Text domain stays 'uichemy'. Retargeting 38k lines of `__( …, 'uichemy' )` to
 * 'uichemy' would be a huge diff for no user-visible gain — WordPress is happy
 * to load a second text domain from a subdirectory, which is what we do below.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Composer_Loader' ) ) {

	final class Uich_Composer_Loader {

		/**
		 * Subdirectory (relative to the plugin root) holding the merged runtime.
		 */
		const DIR = 'uichemy-composer/';

		private static $instance;

		public static function get_instance() {
			if ( ! isset( self::$instance ) ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		private function __construct() {
			// Retires the standalone plugin automatically: deactivates it on the
			// next admin request, then deletes its files once the migration has
			// finished. Registered on BOTH paths below — when a standalone Protuno
			// is active it is what removes the conflict, and when one is not it is
			// what completes the deletion the earlier request queued.
			require_once UICH_PATH . 'includes/composer/class-uich-composer-takeover.php';
			Uich_Composer_Takeover::init();

			// The standalone Protuno / Protuno Pro plugins declare the same
			// classes, constants, options, REST routes and MCP abilities as the
			// copy bundled here. If either is still active, loading ours too
			// would redeclare every symbol and fatal, so stand down and let the
			// standalone plugin own the runtime for this request.
			//
			// Normally this lasts exactly one request: the takeover above
			// deactivates the standalone plugin on `admin_init`, and the next
			// request boots the runtime for real. The notice is the fallback for
			// when it cannot — a visitor without `activate_plugins`, or a
			// front-end-only request where `admin_init` never fires.
			if ( self::standalone_is_active() ) {
				add_action( 'admin_notices', array( __CLASS__, 'standalone_notice' ) );
				return;
			}

			// Someone else already booted the runtime this request (activation
			// sandbox scrape, or a stray include) — never boot twice.
			if ( defined( 'UICHEMY_BOOTED' ) ) {
				return;
			}

			$this->define_constants();

			// Marks the runtime as running MERGED rather than as its own plugin.
			// The one behaviour that has to change is the admin menu: this plugin
			// owns the dashboard now, so UiChemy_Admin_Menu must not register a
			// second top-level menu. It checks this constant and bails, while
			// keeping its ajax endpoint, settings and white-label filters live.
			if ( ! defined( 'UICH_COMPOSER_MERGED' ) ) {
				define( 'UICH_COMPOSER_MERGED', true );
			}

			define( 'UICHEMY_BOOTED', true );

			add_action( 'plugins_loaded', array( $this, 'load_textdomain' ) );

			// v1.0.0 renamed the widget type, the template post type, its meta keys
			// and the options — see class-uich-composer-migration.php. Registered
			// before the runtime boots so a site upgrading from standalone Protuno
			// starts rewriting on this very request.
			require_once UICH_PATH . 'includes/composer/class-uich-composer-migration.php';
			Uich_Composer_Migration::init();

			$this->boot_runtime();
		}

		/**
		 * Is a standalone Protuno (free or pro) plugin still active?
		 *
		 * Read from the option rather than is_plugin_active() so this works at
		 * `plugins_loaded` time, before wp-admin's plugin.php is available.
		 *
		 * Matched on the plugin FILE name, not the full `folder/file.php` slug — see
		 * Uich_Composer_Takeover::standalone_plugins(), which owns that detection so
		 * the guard here and the plugin the takeover deactivates can never disagree.
		 * Missing the guard is the worst failure mode available: both copies of the
		 * runtime load and PHP fatals on the first redeclared class.
		 */
		public static function standalone_is_active() {
			return ! empty( Uich_Composer_Takeover::standalone_plugins() );
		}

		/**
		 * Tell the admin why the builder features are missing right now.
		 *
		 * The takeover normally clears this within one request, so seeing this
		 * notice means it could not run — the current user lacks
		 * `activate_plugins`, or the site is being hit somewhere `admin_init` never
		 * fires. Hence the instruction is still manual.
		 */
		public static function standalone_notice() {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}

			// Re-check instead of trusting the decision made at `plugins_loaded`.
			// This notice is hooked from the stand-down path, but the takeover
			// deactivates the standalone plugin on `admin_init` (pri 1) — earlier in
			// the same request than `admin_notices`. Without this the successful
			// case printed BOTH the takeover's "standalone plugin was deactivated" success and
			// this warning claiming the builder is still disabled, which flatly
			// contradict each other. By print time the option is authoritative.
			if ( ! self::standalone_is_active() ) {
				return;
			}

			echo '<div class="notice notice-warning"><p>';
			echo esc_html__( 'UiChemy now includes Composer, so the standalone Protuno (or Protuno Pro) plugin is being retired automatically. If this message keeps appearing, deactivate that plugin manually. Until then Composer stays disabled to avoid a conflict.', 'uichemy' );
			echo '</p></div>';
		}

		/**
		 * Re-point the runtime's constants at their new home.
		 */
		private function define_constants() {
			$path = UICH_PATH . self::DIR;
			$url  = UICH_URL . self::DIR;

			if ( ! defined( 'UICHEMY_VERSION' ) ) {
				define( 'UICHEMY_VERSION', UICH_VERSION );
			}
			// Kept for the update-notice copy inside the runtime, which reads it.
			if ( ! defined( 'UICHEMY_BETA_VERSION' ) ) {
				define( 'UICHEMY_BETA_VERSION', '5.0.0' );
			}
			if ( ! defined( 'UICHEMY_FILE' ) ) {
				define( 'UICHEMY_FILE', UICH_FILE );
			}
			if ( ! defined( 'UICHEMY_PATH' ) ) {
				define( 'UICHEMY_PATH', $path );
			}
			if ( ! defined( 'UICHEMY_URL' ) ) {
				define( 'UICHEMY_URL', $url );
			}
			if ( ! defined( 'UICHEMY_BDNAME' ) ) {
				define( 'UICHEMY_BDNAME', UICH_BDNAME );
			}
			if ( ! defined( 'UICHEMY_PBNAME' ) ) {
				define( 'UICHEMY_PBNAME', UICH_PBNAME );
			}
			// The React bundles live with the dashboard build, not here.
			if ( ! defined( 'UICHEMY_BUILD_PATH' ) ) {
				define( 'UICHEMY_BUILD_PATH', UICH_PATH . 'new-dashboard/build/' );
			}
			if ( ! defined( 'UICHEMY_BUILD_URL' ) ) {
				define( 'UICHEMY_BUILD_URL', UICH_URL . 'new-dashboard/build/' );
			}
		}

		/**
		 * The runtime's own strings still live under the 'uichemy' text domain.
		 */
		public function load_textdomain() {
			load_plugin_textdomain( // phpcs:ignore PluginCheck.CodeAnalysis.DiscouragedFunctions.load_plugin_textdomainFound -- Plugin also distributed outside wp.org; explicit textdomain load required.
				'uichemy',
				false,
				UICH_BDNAME . '/' . rtrim( self::DIR, '/' ) . '/languages/'
			);
		}

		/**
		 * Require the gate helpers, then hand off to the runtime's own module
		 * loader on `plugins_loaded` — the same hook and the same ordering the
		 * standalone plugin used, so Elementor and the WP AI Client are ready.
		 */
		private function boot_runtime() {
			// uichemy_is_pro() is consulted by every gate below and must exist
			// before anything else is required. Merged builds have no separate
			// Pro plugin, so Pro is decided by the UiChemy licence tier — see
			// the filter in uich_composer_is_pro() at the bottom of this file.
			if ( ! function_exists( 'uichemy_is_pro' ) ) {
				function uichemy_is_pro() {
					return (bool) apply_filters( 'uich_composer_is_pro', defined( 'UICHEMY_PRO' ) && UICHEMY_PRO );
				}
			}

			require_once UICHEMY_PATH . 'includes/plugin-modules.php';

			// class-uichemy.php holds the module list in load_composer_module().
			// Reused as-is rather than duplicated here, so the merged build keeps
			// loading exactly what the standalone plugin did — and future edits
			// to that list travel with the runtime.
			if ( ! class_exists( 'UiChemy' ) ) {
				require_once UICHEMY_PATH . 'includes/class-uichemy.php';
			}

			$runtime = new UiChemy();
			$runtime->run();
		}
	}

	Uich_Composer_Loader::get_instance();
}
