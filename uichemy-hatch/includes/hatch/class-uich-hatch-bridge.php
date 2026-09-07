<?php
/**
 * The seam between this plugin and the bundled Hatch runtime.
 *
 * Everything here is about the MERGE rather than about Hatch: the payload the
 * dashboard's "Sync with Astro" screen reads, and the activation and
 * deactivation calls Hatch can no longer make for itself.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Hatch_Bridge' ) ) {

	/**
	 * Bridges the merged Hatch runtime to the dashboard.
	 */
	final class Uich_Hatch_Bridge {

		/**
		 * Register hooks.
		 *
		 * @return void
		 */
		public static function boot() {
			/*
			 * Hatch registered its own activation hook against HATCH_PLUGIN_FILE,
			 * which in a merged build is `<plugin>/hatch/hatch.php` — a path
			 * WordPress never activates, so that hook can never fire. This plugin
			 * is the one being activated, so its hook has to run Hatch's
			 * activation on Hatch's behalf.
			 *
			 * Registered from here rather than added to Uich_Uichemy::uich_activation()
			 * so the whole merge stays inside includes/hatch/ and reviewing it
			 * means reading one directory.
			 */
			register_activation_hook( UICH_FILE, array( __CLASS__, 'on_host_activation' ) );

			// Same problem, same fix, at the other end of the lifecycle. Hatch's
			// on_deactivate() clears the connection-status cron and flushes
			// rewrite rules; without this the cron keeps firing every hour after
			// the merged plugin has been switched off.
			register_deactivation_hook( UICH_FILE, array( __CLASS__, 'on_host_deactivation' ) );

			// Keeps the deploy inside the "Sync with Astro" frame when the
			// broker says its build page can be embedded. See below.
			add_action( 'hatch_deploy_prepared', array( __CLASS__, 'on_deploy_prepared' ), 10, 1 );
		}

		/**
		 * Keep the deploy on this screen when the broker allows it.
		 *
		 * The deploy hands off to the broker's live-log page on another origin.
		 * Uich_Hatch_Embed sends off-site hops to the top window by default,
		 * because a page that forbids framing shows the browser's "refused to
		 * connect" instead of anything useful — which is exactly what this page
		 * did before the broker learned to permit it.
		 *
		 * So the broker now says so, and this listens rather than assumes. The
		 * `frameable` flag on the /prepare reply is what a broker that emits
		 * `Content-Security-Policy: frame-ancestors <this site>` sends; a broker
		 * that predates it simply omits the key, this returns early, and the
		 * deploy keeps taking over the tab as it does today. Version sniffing
		 * would have had to guess; this cannot be wrong.
		 *
		 * Registered for THIS request only. The filter is added while
		 * handle_start_deploy() is mid-flight, one statement before it redirects,
		 * so it lives exactly as long as the hop it authorises.
		 *
		 * @param array $data Decoded broker /prepare response.
		 * @return void
		 */
		public static function on_deploy_prepared( $data ) {
			if ( empty( $data['frameable'] ) ) {
				return;
			}
			if ( ! class_exists( 'Hatch_Deploy_Broker' ) || ! method_exists( 'Hatch_Deploy_Broker', 'base_url' ) ) {
				return;
			}

			// Read from the broker client rather than hard-coding a hostname, so
			// a site pointed at its own broker via HATCH_DEPLOY_BROKER_URL is
			// covered too — and so this can never authorise a host the deploy is
			// not actually about to visit.
			$host = strtolower( (string) wp_parse_url( Hatch_Deploy_Broker::base_url(), PHP_URL_HOST ) );
			if ( '' === $host ) {
				return;
			}

			add_filter(
				'uich_hatch_frameable_hosts',
				static function ( $hosts ) use ( $host ) {
					$hosts[] = $host;
					return $hosts;
				}
			);
		}

		/**
		 * Run Hatch's activation routine during THIS plugin's activation.
		 *
		 * Both entry points, in the order the standalone plugin ran them:
		 * `hatch_on_activation()` (the procedural half — image-proxy default,
		 * libsodium probe, mu-plugin sync) and `Hatch::on_activate()` (the class
		 * half — permalink default, uninstall preference, App-Password pruning).
		 *
		 * Skipped on network activation. Hatch does not support being
		 * network-activated — per-site is the only supported shape, because
		 * network activation would share encrypted deploy tokens and frontend
		 * URLs across every subsite — and its own guard for that case calls
		 * `deactivate_plugins()`, which from inside an activation hook is
		 * silently overwritten when WordPress writes `active_plugins` back. So
		 * running it here would leave the state half-applied and print a notice
		 * naming a plugin that is still active. Each subsite that activates this
		 * plugin normally gets the full routine.
		 *
		 * @return void
		 */
		public static function on_host_activation() {
			if ( is_multisite() && is_network_admin() ) {
				return;
			}

			if ( function_exists( 'hatch_on_activation' ) ) {
				hatch_on_activation();
			}

			if ( class_exists( 'Hatch' ) && method_exists( 'Hatch', 'instance' ) ) {
				$hatch = Hatch::instance();
				if ( method_exists( $hatch, 'on_activate' ) ) {
					$hatch->on_activate();
				}
			}
		}

		/**
		 * Run Hatch's deactivation routine during THIS plugin's deactivation.
		 *
		 * Unlike activation there is no network-activation caveat: Hatch's
		 * on_deactivate() only deletes two transients, unschedules its cron and
		 * flushes rewrite rules. All four are safe to run more than once and
		 * safe to run when Hatch was never fully activated.
		 *
		 * @return void
		 */
		public static function on_host_deactivation() {
			if ( ! class_exists( 'Hatch' ) || ! method_exists( 'Hatch', 'instance' ) ) {
				return;
			}
			$hatch = Hatch::instance();
			if ( method_exists( $hatch, 'on_deactivate' ) ) {
				$hatch->on_deactivate();
			}
		}

		/**
		 * Did the bundled runtime actually boot this request?
		 *
		 * UICH_HATCH_MERGED rather than class_exists( 'Hatch' ): when a
		 * standalone Hatch is active the loader stands down so OUR copy never
		 * loads — but the standalone plugin declares a `Hatch` class of its own,
		 * so the class name is present anyway and the check would lie. The
		 * constant is only ever defined by our loader, so it is the direct answer
		 * to "is the runtime that is loaded ours?".
		 *
		 * The second half covers the reverse case: the constant is set but the
		 * require failed (a pruned source checkout), so nothing is really there.
		 *
		 * @return bool
		 */
		public static function is_available() {
			return defined( 'UICH_HATCH_MERGED' ) && UICH_HATCH_MERGED && class_exists( 'Hatch' );
		}

		/**
		 * Has Hatch's own React bundle been built?
		 *
		 * Its admin pages are a React SPA; without the bundle they render an
		 * empty mount point and a WordPress error notice. Reported to the
		 * dashboard so the screen can say what to run instead of framing a blank
		 * iframe.
		 *
		 * @return bool
		 */
		public static function build_exists() {
			if ( ! defined( 'HATCH_PLUGIN_DIR' ) ) {
				return false;
			}
			return file_exists( HATCH_PLUGIN_DIR . 'build/admin/index.jsx.js' );
		}

		/**
		 * Is Elementor active?
		 *
		 * The screen no longer names Elementor — it is "Sync with Astro", after
		 * the frontend Hatch deploys — but Elementor is still the builder whose
		 * output gets published, and it is this plugin's whole purpose. Reported
		 * so the screen can say so up front rather than letting someone deploy
		 * and wonder why the result is bare.
		 *
		 * @return bool
		 */
		private static function elementor_active() {
			return defined( 'ELEMENTOR_VERSION' ) || did_action( 'elementor/loaded' ) > 0;
		}

		/**
		 * The `hatch` block of `window.uich_nd_boot`.
		 *
		 * Read by new-dashboard/src/screens/dashboard/SyncAstro.jsx.
		 *
		 * @return array<string, mixed>
		 */
		public static function boot_payload() {
			$available = self::is_available();

			if ( ! $available ) {
				return array(
					'available'    => false,
					// Names the reason so the screen can distinguish "a standalone
					// Hatch is in the way" (self-healing, one request) from "the
					// runtime is not on disk" (needs a re-install).
					'standalone'   => class_exists( 'Uich_Hatch_Takeover' )
						&& ! empty( Uich_Hatch_Takeover::standalone_plugins() ),
					'buildMissing' => false,
				);
			}

			return array(
				'available'    => true,
				'standalone'   => false,
				'buildMissing' => ! self::build_exists(),
				'version'      => defined( 'HATCH_VERSION' ) ? HATCH_VERSION : '',

				// Chrome-free URLs for the iframe.
				'wizardUrl'    => Uich_Hatch_Embed::url( 'hatch-setup' ),
				'adminUrl'     => Uich_Hatch_Embed::url( 'hatch' ),

				// The same two screens WITHOUT the embed flag, for "open in a new
				// tab" — some of Hatch's deploy steps are long-running and easier
				// to watch full-screen.
				//
				// The flag is stripped explicitly rather than simply left off.
				// These are built with admin_url(), and Uich_Hatch_Embed filters
				// admin_url to ADD the flag to exactly this shape of URL. That
				// filter is only registered on an embedded request, and this
				// payload is only assembled on the dashboard page — so today the
				// two never meet. Stripping makes "full screen" mean full screen
				// regardless, instead of depending on that happening to hold.
				'wizardOpenUrl' => remove_query_arg( Uich_Hatch_Embed::FLAG, admin_url( 'admin.php?page=hatch-setup' ) ),
				'adminOpenUrl'  => remove_query_arg( Uich_Hatch_Embed::FLAG, admin_url( 'admin.php?page=hatch' ) ),

				// Which of the two to frame on arrival. Before the wizard has been
				// completed the wizard IS the screen; afterwards the admin UI is,
				// and the wizard is re-runnable from a link.
				'wizardDone'   => (bool) get_option( 'hatch_setup_wizard_completed', 0 ),
				'connected'    => (bool) get_option( 'hatch_connected', 0 ),
				'frontendUrl'  => (string) get_option( 'hatch_frontend_url', '' ),

				'elementor'    => self::elementor_active(),
			);
		}
	}
}
