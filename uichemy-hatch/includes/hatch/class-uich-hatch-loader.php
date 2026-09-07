<?php
/**
 * Hatch loader — boots the merged Hatch runtime.
 *
 * The former Hatch plugin now lives inside this one, under `hatch/`. Its PHP
 * was moved across VERBATIM apart from four surgical edits:
 *
 *   hatch/hatch.php            — its WordPress PLUGIN HEADER was removed. Not
 *                                cosmetic: with it present, the installer's
 *                                "Activate" link pointed at the bundled file
 *                                instead of at this plugin and activation failed
 *                                with "The plugin does not have a valid header."
 *                                The full explanation is in that file's docblock;
 *                                do not restore the header. uichemy-composer/,
 *                                the other runtime merged into this plugin, has
 *                                no plugin header for the same reason.
 *   hatch/hatch.php            — the four path constants became guarded
 *                                `defined() || define()` (see the comment there
 *                                for why HATCH_PLUGIN_FILE is NOT re-pointed).
 *   hatch/admin/dashboard.php  — hatch_register_admin_menu() registers a HIDDEN
 *                                submenu instead of a second top-level menu.
 *   hatch/admin/setup-wizard.php — the first-run redirect stands down, because
 *                                this plugin owns where an admin lands after
 *                                activation.
 *   hatch/includes/class-options-rest.php — the `/self-update` REST route
 *                                refuses. It copy_dir()s a standalone Hatch
 *                                release over HATCH_PLUGIN_DIR, which here
 *                                would restore the plugin header and overwrite
 *                                every edit listed above — silently un-merging
 *                                the product. This plugin owns updates for what
 *                                it bundles.
 *   hatch/admin-react/src/index.jsx — resolveTheme() now honours
 *                                `hatchBoot.forceTheme`, so a host page can pin
 *                                the palette. Hatch otherwise picks dark from
 *                                the visitor's OS, and a dark panel inside this
 *                                plugin's light dashboard reads as a rendering
 *                                fault. See Uich_Hatch_Embed::pin_light_theme().
 *
 * Three of these are guarded by UICH_HATCH_MERGED and are inert outside this
 * plugin. The forceTheme hook needs no guard — it is an opt-in that does nothing
 * until a host sets the flag. The header removal is the one edit that cannot be
 * conditional, because a file either advertises itself to WordPress or it does
 * not, so `hatch/` is no longer independently activatable. That is deliberate:
 * the standalone Hatch plugin still lives at wp-plugin/ in the Hatch repository,
 * and this copy exists only to be required from here.
 *
 * Everything else reaches the filesystem and the browser through HATCH_PLUGIN_DIR
 * / HATCH_PLUGIN_URL, and both are derived from `__FILE__` inside `hatch/`, so
 * the whole subsystem relocated without touching a single require or enqueue.
 *
 * Text domain stays 'hatch'. Retargeting every `__( …, 'hatch' )` to 'uichemy'
 * would be a huge diff for no user-visible gain — WordPress is happy to load a
 * second text domain from a subdirectory, and hatch.php already does exactly
 * that from its own `init` hook.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Hatch_Loader' ) ) {

	/**
	 * Boots (or deliberately stands down) the bundled Hatch runtime.
	 */
	final class Uich_Hatch_Loader {

		/**
		 * Subdirectory (relative to the plugin root) holding the merged runtime.
		 */
		const DIR = 'hatch/';

		/**
		 * Singleton.
		 *
		 * @var Uich_Hatch_Loader|null
		 */
		private static $instance;

		/**
		 * Initiator.
		 *
		 * @return Uich_Hatch_Loader
		 */
		public static function get_instance() {
			if ( ! isset( self::$instance ) ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		/**
		 * Constructor.
		 */
		private function __construct() {
			// Retires a standalone Hatch automatically: deactivates it on the next
			// admin request so the bundled copy can own the runtime from then on.
			// Registered BEFORE the stand-down check below, because a request that
			// stands down is exactly the request that has to schedule the fix.
			require_once UICH_PATH . 'includes/hatch/class-uich-hatch-takeover.php';
			Uich_Hatch_Takeover::init();

			/*
			 * A standalone Hatch plugin declares the same 57 global `hatch_*`
			 * functions, 56 `Hatch_*` classes, constants, options and REST routes
			 * as the copy bundled here. Loading ours too would redeclare every one
			 * of those symbols and fatal on the first collision, taking the whole
			 * site down — not just this plugin. So stand down and let the
			 * standalone plugin own the runtime for this request.
			 *
			 * Normally this lasts exactly one request: the takeover above
			 * deactivates the standalone plugin on `admin_init`, and the next
			 * request boots the bundled runtime for real. The notice is the
			 * fallback for when it cannot — a visitor without `activate_plugins`,
			 * or a front-end-only request where `admin_init` never fires.
			 */
			if ( self::standalone_is_active() ) {
				add_action( 'admin_notices', array( __CLASS__, 'standalone_notice' ) );
				return;
			}

			// Someone else already booted the runtime this request (activation
			// sandbox scrape, or a stray include) — never boot twice.
			if ( defined( 'UICH_HATCH_BOOTED' ) ) {
				return;
			}

			/*
			 * Marks the runtime as running MERGED rather than as its own plugin.
			 * Read by the guarded edits listed in the file docblock. Defined
			 * BEFORE the constants and the require below, because hatch.php runs
			 * its top-level `add_action()` calls the moment it is required and the
			 * menu edit is consulted from one of them.
			 */
			if ( ! defined( 'UICH_HATCH_MERGED' ) ) {
				define( 'UICH_HATCH_MERGED', true );
			}

			define( 'UICH_HATCH_BOOTED', true );

			$this->define_constants();
			$this->boot_runtime();
		}

		/**
		 * Is a standalone Hatch plugin still active?
		 *
		 * Read from the option rather than is_plugin_active() so this works at
		 * plugin-file load time, long before wp-admin's plugin.php is available.
		 *
		 * Matched on the plugin FILE name, not the full `folder/file.php` slug —
		 * see Uich_Hatch_Takeover::standalone_plugins(), which owns that detection
		 * so this guard and the plugin the takeover deactivates can never
		 * disagree. Missing the guard is the worst failure mode available: both
		 * copies of the runtime load and PHP fatals on the first redeclared
		 * function.
		 *
		 * @return bool
		 */
		public static function standalone_is_active() {
			return ! empty( Uich_Hatch_Takeover::standalone_plugins() );
		}

		/**
		 * Tell the admin why the Hatch features are missing right now.
		 *
		 * The takeover normally clears this within one request, so seeing this
		 * notice means it could not run — the current user lacks
		 * `activate_plugins`, or the site is being hit somewhere `admin_init`
		 * never fires. Hence the instruction is still manual.
		 *
		 * @return void
		 */
		public static function standalone_notice() {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}

			/*
			 * Re-check instead of trusting the decision made at plugin-load time.
			 * This notice is hooked from the stand-down path, but the takeover
			 * deactivates the standalone plugin on `admin_init` (pri 1) — earlier
			 * in the same request than `admin_notices`. Without this the
			 * successful case printed BOTH the takeover's "was deactivated"
			 * success and this warning claiming Hatch is still disabled, which
			 * flatly contradict each other. By print time the option is
			 * authoritative.
			 */
			if ( ! self::standalone_is_active() ) {
				return;
			}

			echo '<div class="notice notice-warning"><p>';
			echo esc_html__( 'UiChemy now includes Hatch, so the standalone Hatch plugin is being retired automatically. If this message keeps appearing, deactivate that plugin manually. Until then Hatch stays disabled to avoid a fatal conflict.', 'uichemy' );
			echo '</p></div>';
		}

		/**
		 * Point the runtime's path constants at their new home.
		 *
		 * Both values are what `plugin_dir_path( __FILE__ )` / `plugin_dir_url(
		 * __FILE__ )` inside `hatch/hatch.php` would work out on their own. They
		 * are set here anyway so the relocation is stated once, explicitly, in
		 * the file that performs it rather than being an emergent property of
		 * where the folder happens to sit.
		 *
		 * HATCH_PLUGIN_FILE and HATCH_VERSION are deliberately left to hatch.php
		 * — see the constants comment there.
		 *
		 * @return void
		 */
		private function define_constants() {
			if ( ! defined( 'HATCH_PLUGIN_DIR' ) ) {
				define( 'HATCH_PLUGIN_DIR', UICH_PATH . self::DIR );
			}
			if ( ! defined( 'HATCH_PLUGIN_URL' ) ) {
				define( 'HATCH_PLUGIN_URL', UICH_URL . self::DIR );
			}
		}

		/**
		 * Require the runtime, then the pieces that bridge it to this plugin.
		 *
		 * hatch.php calls `Hatch::instance()` on its last line and registers all
		 * of its own hooks at top level, so requiring it here — from this
		 * plugin's own file load, before `plugins_loaded` — reproduces exactly
		 * the timing it had as a standalone plugin.
		 *
		 * @return void
		 */
		private function boot_runtime() {
			$runtime = UICH_PATH . self::DIR . 'hatch.php';

			// A source checkout with the subdirectory pruned (or a partial upload)
			// should degrade to "Hatch features missing", never to a fatal require.
			if ( ! file_exists( $runtime ) ) {
				add_action( 'admin_notices', array( __CLASS__, 'missing_runtime_notice' ) );
				return;
			}

			require_once $runtime;

			// The bridge owns everything that is about the SEAM rather than about
			// Hatch: the boot payload the dashboard reads, the activation call
			// Hatch can no longer make for itself, and the chrome-free embed the
			// "Sync with Astro" screen loads.
			require_once UICH_PATH . 'includes/hatch/class-uich-hatch-embed.php';
			require_once UICH_PATH . 'includes/hatch/class-uich-hatch-bridge.php';
			require_once UICH_PATH . 'includes/hatch/class-uich-hatch-deploy.php';

			Uich_Hatch_Embed::boot();
			Uich_Hatch_Bridge::boot();
			// Registers a REST route, so it boots regardless of whether this
			// particular request is the embedded one.
			Uich_Hatch_Deploy::boot();
		}

		/**
		 * The `hatch/` subdirectory is not on disk.
		 *
		 * @return void
		 */
		public static function missing_runtime_notice() {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}
			echo '<div class="notice notice-warning"><p><strong>UiChemy:</strong> ';
			printf(
				/* translators: %s: expected directory path, e.g. hatch/hatch.php */
				esc_html__( 'the bundled Hatch runtime is missing (%s), so "Sync with Astro" is unavailable. Re-install the plugin to restore it.', 'uichemy' ),
				'<code>' . esc_html( self::DIR . 'hatch.php' ) . '</code>'
			);
			echo '</p></div>';
		}
	}

	Uich_Hatch_Loader::get_instance();
}
