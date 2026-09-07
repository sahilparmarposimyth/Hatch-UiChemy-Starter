<?php
/**
 * Takeover: retire the standalone Protuno plugin automatically.
 *
 * UiChemy v1.0.0 ships the UiChemy builder inside itself. While a standalone
 * UiChemy (or UiChemy Pro) plugin is also active, the bundled runtime has to
 * stand down — both copies declare the same classes, constants, options, REST
 * routes and MCP abilities, so loading them together fatals on the first
 * redeclaration. Standing down means the builder features are simply missing,
 * and the data migration cannot run either.
 *
 * Rather than leave the site in that half-working state until someone reads a
 * notice, this class removes the standalone plugin for them:
 *
 *   1. `admin_init` — a standalone Protuno is active → deactivate it, and record
 *      its plugin file so step 3 knows what to remove.
 *   2. The NEXT request — with the conflict gone, Uich_Composer_Loader boots the
 *      bundled runtime and Uich_Composer_Migration rewrites the database.
 *   3. `uich_composer_migration_complete` — the data is now UiChemy's, so the
 *      standalone plugin's files are deleted.
 *
 * Why the ordering matters
 * -----------------------
 * Deleting the plugin that authored the data before the data has been migrated
 * would leave a site with content it cannot render and no plugin to fall back
 * to. Deactivation is reversible, so it happens immediately; deletion is not, so
 * it waits until the migration has actually stamped itself complete. If the
 * migration never finishes, the files stay put and the site can be recovered by
 * reactivating the standalone plugin.
 *
 * Why deactivation is not done in the activation hook
 * ---------------------------------------------------
 * `activate_plugin()` reads `active_plugins`, fires `activate_{$plugin}`, and
 * only THEN writes the option back. A `deactivate_plugins()` call from inside
 * our activation hook would be silently overwritten by that write. `admin_init`
 * has no such problem — and it also covers the update path, where no activation
 * hook fires at all because the plugin was already active.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Composer_Takeover' ) ) {

	final class Uich_Composer_Takeover {

		/**
		 * What the takeover has done so far:
		 *
		 *   array(
		 *     'deactivated'    => array( 'uichemy/uichemy.php' ),  // history
		 *     'delete_pending' => array( 'uichemy/uichemy.php' ),  // step 3 queue
		 *     'deleted'        => array( 'uichemy/uichemy.php' ),  // history
		 *   )
		 */
		const STATE_OPTION = 'uichemy_composer_takeover';

		/**
		 * Set for one page load after a deactivation so the admin is told what
		 * happened to a plugin they did not deactivate themselves.
		 */
		const NOTICE_TRANSIENT = 'uichemy_composer_takeover_notice';

		/**
		 * The plugin FILE names that mean "a standalone, pre-merge Protuno".
		 *
		 * Matched on the file rather than the `folder/file.php` slug because the
		 * folder is whatever the zip was named — `protuno/` from a release zip,
		 * `protuno-wordpress/` or `protuno-main/` from a GitHub source zip.
		 *
		 * These two names intentionally keep the retired "protuno" branding: they
		 * are the filenames of the OLD, FOREIGN plugins this one supersedes, not
		 * identifiers of this plugin. Renaming them to this plugin's own file name
		 * makes standalone_plugins() match THIS plugin, and the takeover then
		 * deactivates and deletes itself — confirmed live once already.
		 */
		const STANDALONE_FILES = array( 'protuno.php', 'protuno-pro.php' );

		/**
		 * Opt-out flag: when a companion plugin defines the constant PROTUNO_STANDALONE
		 * (any value) before `admin_init`, this whole takeover — deactivating,
		 * migrating and deleting a standalone Protuno — is suppressed, so the two
		 * plugins coexist and the bundled runtime stays stood down for that request.
		 *
		 * Checked at hook time (admin_init), not construction, so it works regardless
		 * of the order the two plugins load in — the constant only has to exist by the
		 * time these stages run. Uich_Composer_Migration::maybe_run() honours the same
		 * flag so no data rewrite starts either.
		 *
		 * @return bool
		 */
		public static function keep_standalone() {
			return defined( 'PROTUNO_STANDALONE' );
		}

		/**
		 * Register both stages. Called from Uich_Composer_Loader on every request,
		 * whether the bundled runtime booted or stood down — stage 1 only runs in
		 * the latter case, stage 3 only in the former.
		 *
		 * @return void
		 */
		public static function init() {
			// Priority 1: ahead of Uich_Composer_Migration::maybe_run() at 5, so a
			// request that deactivates the conflict does not also try to migrate
			// while the standalone plugin's classes are still loaded.
			add_action( 'admin_init', array( __CLASS__, 'maybe_deactivate' ), 1 );

			// Stage 3, the moment the migration reports done.
			add_action( 'uich_composer_migration_complete', array( __CLASS__, 'process_deletions' ) );

			// …and again on ordinary admin requests, because the migration can
			// finish inside a cron run, which has no user and therefore no
			// `delete_plugins` capability. The queue simply waits for an admin.
			add_action( 'admin_init', array( __CLASS__, 'process_deletions' ), 20 );

			add_action( 'admin_notices', array( __CLASS__, 'notices' ) );
		}

		// ============================================================
		// STAGE 1 — DEACTIVATE
		// ============================================================

		/**
		 * Deactivate every standalone Protuno that is currently active.
		 *
		 * @return void
		 */
		public static function maybe_deactivate() {
			// Opt-out: a companion plugin can keep a standalone Protuno running
			// untouched by defining PROTUNO_STANDALONE. When it is present UiChemy
			// never deactivates, migrates or deletes the standalone plugin — the two
			// simply coexist and the bundled runtime stays stood down. See
			// keep_standalone().
			if ( self::keep_standalone() ) {
				return;
			}

			$plugins = self::standalone_plugins();
			if ( empty( $plugins ) ) {
				return;
			}

			// Deactivating plugins is an administrative act; a low-privilege user
			// browsing wp-admin must not trigger it. They see the fallback notice
			// from Uich_Composer_Loader instead.
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

			// $silent = false: the standalone plugin's own deactivation hook should
			// run, so anything it schedules or caches is cleaned up properly.
			if ( $single ) {
				deactivate_plugins( $single, false, false );
			}
			if ( $network ) {
				deactivate_plugins( $network, false, true );
			}

			self::remember( 'deactivated', $plugins );
			self::remember( 'delete_pending', $plugins );

			set_transient( self::NOTICE_TRANSIENT, $plugins, 5 * MINUTE_IN_SECONDS );

			/**
			 * Fires after a standalone Protuno plugin has been deactivated so the
			 * bundled builder can take over.
			 *
			 * @param string[] $plugins Plugin files that were deactivated.
			 */
			do_action( 'uich_composer_standalone_deactivated', $plugins );
		}

		/**
		 * Queue a standalone Protuno that is INSTALLED but already inactive.
		 *
		 * A site that upgraded before this class existed — or whose owner simply
		 * deactivated UiChemy by hand first — has the old plugin sitting on disk
		 * with nothing queued to remove it. This picks those up.
		 *
		 * Runs ONCE, recorded by the `swept` flag. Without that flag a deliberate
		 * re-install later (someone downgrading on purpose) would be deleted again
		 * on the next admin request, and the user would be fighting the plugin.
		 *
		 * @return void
		 */
		private static function sweep_leftovers() {
			$state = self::state();
			if ( ! empty( $state['swept'] ) ) {
				return;
			}

			// Only meaningful once the data is ours; before that there is nothing to
			// be leftover FROM.
			if ( ! class_exists( 'Uich_Composer_Migration' ) || ! Uich_Composer_Migration::is_complete() ) {
				return;
			}

			require_once ABSPATH . 'wp-admin/includes/plugin.php';

			$leftover = array();
			foreach ( array_keys( (array) get_plugins() ) as $plugin ) {
				if ( in_array( basename( (string) $plugin ), self::STANDALONE_FILES, true ) ) {
					$leftover[] = (string) $plugin;
				}
			}

			$state          = self::state();
			$state['swept'] = true;
			if ( $leftover ) {
				$state['delete_pending'] = array_values( array_unique( array_merge( $state['delete_pending'], $leftover ) ) );
			}
			update_option( self::STATE_OPTION, $state, false );
		}

		/**
		 * Active plugins whose file name marks them as a standalone Protuno.
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
			// lists foreign, retired plugin filenames; if one of them is ever edited
			// to match this plugin's file, the stages below would deactivate and
			// delete the running plugin. Excluding our own basename outright makes
			// that failure mode impossible regardless of what the list says.
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

		// ============================================================
		// STAGE 3 — DELETE
		// ============================================================

		/**
		 * Delete the plugin files queued by stage 1, once the migration is done.
		 *
		 * @return void
		 */
		public static function process_deletions() {
			// Honour the companion-plugin opt-out — never delete a standalone Protuno
			// (nor sweep leftovers for deletion) while PROTUNO_STANDALONE is defined.
			if ( self::keep_standalone() ) {
				return;
			}

			self::sweep_leftovers();

			$state   = self::state();
			$pending = (array) $state['delete_pending'];

			if ( empty( $pending ) ) {
				return;
			}

			/**
			 * Filter whether the standalone plugin's FILES are removed once its data
			 * has been migrated. Return false to deactivate only and leave the files
			 * on disk — useful on a site that wants to keep the old plugin around.
			 *
			 * @param bool     $delete  Whether to delete. Default true.
			 * @param string[] $pending Plugin files queued for deletion.
			 */
			if ( ! apply_filters( 'uich_composer_delete_standalone', true, $pending ) ) {
				self::clear( 'delete_pending' );
				return;
			}

			// The whole point of the ordering: the data must already be UiChemy's
			// before the plugin that wrote it is removed. Not complete yet → wait.
			if ( ! class_exists( 'Uich_Composer_Migration' ) || ! Uich_Composer_Migration::is_complete() ) {
				return;
			}

			if ( ! current_user_can( 'delete_plugins' ) ) {
				return;
			}

			require_once ABSPATH . 'wp-admin/includes/plugin.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';

			// delete_plugins() needs a working filesystem abstraction. On anything
			// other than 'direct' that means asking the user for FTP/SSH
			// credentials, which cannot be done from admin_init — so leave the
			// queue alone and let the notice explain it.
			if ( 'direct' !== get_filesystem_method() ) {
				return;
			}
			if ( ! WP_Filesystem() ) {
				return;
			}

			// Never delete something that is somehow active again — that would pull
			// running code out from under the request.
			$still_active = self::standalone_plugins();
			$deletable    = array_values( array_diff( $pending, $still_active ) );

			if ( empty( $deletable ) ) {
				return;
			}

			$result = delete_plugins( $deletable );

			if ( is_wp_error( $result ) || false === $result ) {
				// Leave the queue in place; a later request can try again.
				return;
			}

			self::clear( 'delete_pending' );
			self::remember( 'deleted', $deletable );

			/**
			 * Fires after the standalone Protuno plugin files have been deleted.
			 *
			 * @param string[] $deletable Plugin files that were deleted.
			 */
			do_action( 'uich_composer_standalone_deleted', $deletable );
		}

		// ============================================================
		// STATE
		// ============================================================

		/**
		 * Read the takeover state, normalised.
		 *
		 * @return array{deactivated:string[], delete_pending:string[], deleted:string[], swept:bool}
		 */
		public static function state() {
			$state = get_option( self::STATE_OPTION, array() );
			if ( ! is_array( $state ) ) {
				$state = array();
			}

			return array(
				'deactivated'    => isset( $state['deactivated'] ) ? (array) $state['deactivated'] : array(),
				'delete_pending' => isset( $state['delete_pending'] ) ? (array) $state['delete_pending'] : array(),
				'deleted'        => isset( $state['deleted'] ) ? (array) $state['deleted'] : array(),
				'swept'          => ! empty( $state['swept'] ),
			);
		}

		/**
		 * Add plugin files to one of the state lists.
		 *
		 * @param string   $key     State key.
		 * @param string[] $plugins Plugin files.
		 * @return void
		 */
		private static function remember( $key, $plugins ) {
			$state         = self::state();
			$state[ $key ] = array_values( array_unique( array_merge( $state[ $key ], (array) $plugins ) ) );
			update_option( self::STATE_OPTION, $state, false );
		}

		/**
		 * Empty one of the state lists.
		 *
		 * @param string $key State key.
		 * @return void
		 */
		private static function clear( $key ) {
			$state         = self::state();
			$state[ $key ] = array();
			update_option( self::STATE_OPTION, $state, false );
		}

		// ============================================================
		// ADMIN SURFACE
		// ============================================================

		/**
		 * Explain a deactivation the user did not ask for, and a deletion that is
		 * waiting on something.
		 *
		 * @return void
		 */
		public static function notices() {
			if ( ! current_user_can( 'activate_plugins' ) ) {
				return;
			}

			$just_deactivated = get_transient( self::NOTICE_TRANSIENT );
			if ( ! empty( $just_deactivated ) ) {
				delete_transient( self::NOTICE_TRANSIENT );

				// Name the plugin that was actually retired, and show its plugin
				// file. This notice reports a deactivation the user did not ask
				// for, so "the standalone plugin" is not enough — it read as
				// UiChemy having deactivated UiChemy, which is alarming and
				// tells them nothing about what to look for on the Plugins screen.
				echo '<div class="notice notice-success"><p><strong>';
				echo esc_html__( 'UiChemy now includes Composer.', 'uichemy' );
				echo '</strong> ';
				printf(
					/* translators: %s: plugin file(s) that were deactivated, e.g. protuno/protuno.php */
					esc_html__( 'The standalone plugin (%s) was deactivated because UiChemy now bundles Composer, and your existing sections are being migrated to the Composer widget. Your pages keep working. Nothing needs to be done.', 'uichemy' ),
					'<code>' . esc_html( implode( ', ', (array) $just_deactivated ) ) . '</code>'
				);
				echo '</p></div>';
			}

			$state = self::state();
			if ( empty( $state['delete_pending'] ) ) {
				return;
			}

			// Only worth mentioning once the migration is done — before that, the
			// wait is expected and the migration has its own progress notice.
			if ( ! class_exists( 'Uich_Composer_Migration' ) || ! Uich_Composer_Migration::is_complete() ) {
				return;
			}

			if ( 'direct' === get_filesystem_method() ) {
				return;
			}

			echo '<div class="notice notice-warning"><p>';
			printf(
				/* translators: %s: plugin file, e.g. uichemy/uichemy.php */
				esc_html__( 'UiChemy finished migrating your Protuno content but could not remove the old plugin files (%s), because this site does not allow direct file writes. You can safely delete it from the Plugins screen.', 'uichemy' ),
				'<code>' . esc_html( implode( ', ', $state['delete_pending'] ) ) . '</code>'
			);
			echo '</p></div>';
		}
	}
}
