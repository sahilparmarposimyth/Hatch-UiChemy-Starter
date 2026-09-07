<?php
/**
 * Takeover: retire the standalone Hatch plugin automatically.
 *
 * This plugin ships Hatch inside itself. While a standalone Hatch plugin is
 * also active, the bundled runtime has to stand down — both copies declare the
 * same 57 global `hatch_*` functions and 56 `Hatch_*` classes, so loading them
 * together fatals on the first redeclaration and takes down the whole site, not
 * just this plugin. Standing down means the Hatch features are simply missing
 * and "Sync with Elementor" has nothing to open.
 *
 * Rather than leave the site in that half-working state until someone reads a
 * notice, this class removes the conflict for them:
 *
 *   1. `admin_init` — a standalone Hatch is active → deactivate it.
 *   2. The NEXT request — with the conflict gone, Uich_Hatch_Loader boots the
 *      bundled runtime and every Hatch feature comes back.
 *
 * Why the files are NOT deleted
 * -----------------------------
 * UiChemy's builder takeover deletes the standalone plugin it supersedes, but it
 * only does so after a data MIGRATION has stamped itself complete — the old
 * plugin's rows had to be rewritten before the plugin that wrote them could go.
 * Hatch needs no migration at all: the bundled copy reads and writes the exact
 * same `hatch_*` options, so the site's entire Hatch configuration carries over
 * untouched the moment the bundled runtime boots. With no migration to gate a
 * deletion on, deleting a user's plugin files would be an irreversible act with
 * nothing to justify it. Deactivation is reversible and sufficient.
 *
 * Why deactivation is not done in the activation hook
 * ---------------------------------------------------
 * `activate_plugin()` reads `active_plugins`, fires `activate_{$plugin}`, and
 * only THEN writes the option back. A `deactivate_plugins()` call from inside
 * an activation hook would be silently overwritten by that write. `admin_init`
 * has no such problem — and it also covers the update path, where no activation
 * hook fires at all because the plugin was already active.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Hatch_Takeover' ) ) {

	/**
	 * Deactivates a standalone Hatch so the bundled runtime can boot.
	 */
	final class Uich_Hatch_Takeover {

		/**
		 * History of what the takeover has deactivated, so the admin surface can
		 * name it and a repeat run can tell "already handled" from "never seen".
		 */
		const STATE_OPTION = 'uichemy_hatch_takeover';

		/**
		 * Set for one page load after a deactivation, so the admin is told what
		 * happened to a plugin they did not deactivate themselves.
		 */
		const NOTICE_TRANSIENT = 'uichemy_hatch_takeover_notice';

		/**
		 * The plugin FILE name that means "a standalone, pre-merge Hatch".
		 *
		 * Matched on the file rather than the `folder/file.php` slug because the
		 * folder is whatever the zip was named — `hatch/` from a release zip,
		 * `hatch-main/` or `hatch-wordpress-main/` from a GitHub source zip.
		 *
		 * Note this can never match the copy bundled here. WordPress only scans
		 * `plugins/*.php` and `plugins/*<slash>*.php` for plugin headers, and the
		 * bundled runtime sits two levels down at `<this-plugin>/hatch/hatch.php`,
		 * so it is never a plugin in its own right and never appears in
		 * `active_plugins`. standalone_plugins() excludes this plugin's own file
		 * name as well, belt and braces.
		 */
		const STANDALONE_FILES = array( 'hatch.php' );

		/**
		 * Opt-out flag: when something defines HATCH_STANDALONE (any value)
		 * before `admin_init`, this takeover is suppressed entirely, so a
		 * standalone Hatch keeps running and the bundled runtime stays stood
		 * down. For anyone deliberately developing against both copies.
		 *
		 * Checked at hook time rather than at construction, so it works
		 * regardless of the order the two plugins load in — the constant only
		 * has to exist by the time the stage below runs.
		 *
		 * @return bool
		 */
		public static function keep_standalone() {
			return defined( 'HATCH_STANDALONE' );
		}

		/**
		 * Register the stage. Called from Uich_Hatch_Loader on every request,
		 * whether the bundled runtime booted or stood down — the deactivation
		 * only ever finds something to do in the latter case.
		 *
		 * @return void
		 */
		public static function init() {
			add_action( 'admin_init', array( __CLASS__, 'maybe_deactivate' ), 1 );
			add_action( 'admin_notices', array( __CLASS__, 'notices' ) );
		}

		/**
		 * Deactivate every standalone Hatch that is currently active.
		 *
		 * @return void
		 */
		public static function maybe_deactivate() {
			if ( self::keep_standalone() ) {
				return;
			}

			$plugins = self::standalone_plugins();
			if ( empty( $plugins ) ) {
				return;
			}

			// Deactivating plugins is an administrative act; a low-privilege user
			// browsing wp-admin must not trigger it. They see the fallback notice
			// from Uich_Hatch_Loader instead.
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}

			require_once ABSPATH . 'wp-admin/includes/plugin.php';

			$network = array();
			$single  = array();

			foreach ( $plugins as $plugin ) {
				if ( is_multisite() && is_plugin_active_for_network( $plugin ) ) {
					$network[] = $plugin;
				} else {
					$single[] = $plugin;
				}
			}

			// $silent = false: the standalone plugin's own deactivation hook
			// should run, so anything it scheduled or cached is cleaned up.
			if ( $single ) {
				deactivate_plugins( $single, false, false );
			}
			if ( $network ) {
				deactivate_plugins( $network, false, true );
			}

			self::remember( $plugins );
			set_transient( self::NOTICE_TRANSIENT, $plugins, 5 * MINUTE_IN_SECONDS );

			/**
			 * Fires after a standalone Hatch plugin has been deactivated so the
			 * bundled runtime can take over.
			 *
			 * @param string[] $plugins Plugin files that were deactivated.
			 */
			do_action( 'uich_hatch_standalone_deactivated', $plugins );
		}

		/**
		 * Active plugins whose file name marks them as a standalone Hatch.
		 *
		 * @return string[] Plugin files as stored in `active_plugins`.
		 */
		public static function standalone_plugins() {
			$active = (array) get_option( 'active_plugins', array() );

			if ( is_multisite() ) {
				$active = array_merge(
					$active,
					array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) )
				);
			}

			// This plugin can never be its own takeover target. STANDALONE_FILES
			// lists a foreign plugin's file name; if it were ever edited to match
			// this plugin's file, the stage above would deactivate the running
			// plugin. Excluding our own basename outright makes that failure mode
			// impossible regardless of what the list says.
			$self = defined( 'UICH_FILE' ) ? basename( UICH_FILE ) : '';

			$found = array();
			foreach ( $active as $plugin ) {
				$file = basename( (string) $plugin );
				if ( '' !== $self && $file === $self ) {
					continue;
				}
				if ( in_array( $file, self::STANDALONE_FILES, true ) ) {
					$found[] = (string) $plugin;
				}
			}

			return array_values( array_unique( $found ) );
		}

		/**
		 * Add plugin files to the deactivation history.
		 *
		 * @param string[] $plugins Plugin files.
		 * @return void
		 */
		private static function remember( $plugins ) {
			$state = self::state();
			$state['deactivated'] = array_values(
				array_unique( array_merge( $state['deactivated'], (array) $plugins ) )
			);
			update_option( self::STATE_OPTION, $state, false );
		}

		/**
		 * Read the takeover state, normalised.
		 *
		 * @return array{deactivated:string[]}
		 */
		public static function state() {
			$state = get_option( self::STATE_OPTION, array() );
			if ( ! is_array( $state ) ) {
				$state = array();
			}
			return array(
				'deactivated' => isset( $state['deactivated'] ) ? (array) $state['deactivated'] : array(),
			);
		}

		/**
		 * Explain a deactivation the user did not ask for.
		 *
		 * @return void
		 */
		public static function notices() {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}

			$just_deactivated = get_transient( self::NOTICE_TRANSIENT );
			if ( empty( $just_deactivated ) ) {
				return;
			}
			delete_transient( self::NOTICE_TRANSIENT );

			// Name the plugin file that was actually retired. This notice reports
			// a deactivation the user did not ask for, so "the standalone plugin"
			// is not enough — it tells them nothing to look for on the Plugins
			// screen.
			echo '<div class="notice notice-success"><p><strong>';
			echo esc_html__( 'UiChemy now includes Hatch.', 'uichemy' );
			echo '</strong> ';
			printf(
				/* translators: %s: plugin file(s) that were deactivated, e.g. hatch/hatch.php */
				esc_html__( 'The standalone plugin (%s) was deactivated because UiChemy now bundles it, and keeping both active would crash the site. All of your Hatch settings carry over untouched — they live in the same options the bundled copy reads. Nothing needs to be done.', 'uichemy' ),
				'<code>' . esc_html( implode( ', ', (array) $just_deactivated ) ) . '</code>'
			);
			echo '</p></div>';
		}
	}
}
