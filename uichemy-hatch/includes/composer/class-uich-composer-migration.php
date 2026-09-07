<?php
/**
 * Protuno → UiChemy Composer data migration.
 *
 * v1.0.0 folded the standalone Protuno plugin into UiChemy and renamed every
 * public identifier the runtime had stamped into the database:
 *
 *   Elementor widget type   proton            → uichemy-composer
 *   Theme Builder post type protuno_template  → uichemy_template
 *   Template post meta      _protuno_tpl_*    → _uichemy_tpl_*
 *   Options                 protuno_*         → uichemy_*
 *
 * The rename is a HARD switch — the runtime no longer answers to the old names
 * anywhere — so a site upgrading from standalone Protuno has rows the new code
 * cannot see. An unmigrated `proton` widget is an unregistered widget type to
 * Elementor, which renders nothing at all. Everything in this class exists to
 * close that window as fast as possible after the upgrade.
 *
 * Why it is batched
 * -----------------
 * The widget rewrite has to read, string-replace and write back every
 * `_elementor_data` row that mentions the old type. On a site with a few
 * thousand posts and revisions that is far more than one PHP request can do, so
 * the work is split into steps, each step into batches, and the position is
 * persisted in an option. Every entry point (admin request, cron tick, manual
 * "run now") pushes the same queue forward by one time-boxed slice; whichever
 * one happens to fire finishes the job.
 *
 * Idempotence
 * -----------
 * Every step is written so that running it twice is harmless: options only copy
 * when the destination is absent, the post-type and meta-key updates match on
 * the OLD name (already-migrated rows no longer match), and the widget rewrite
 * is a plain search-and-replace for a string that is gone once rewritten. A
 * half-finished migration that is interrupted simply resumes.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Composer_Migration' ) ) {

	final class Uich_Composer_Migration {

		/**
		 * Schema version this class migrates TO. Bump it — and add the matching
		 * steps — when a future release renames something else.
		 */
		const TARGET_VERSION = 2;

		/**
		 * Stores the version the database has been migrated to. Absent means the
		 * site has never run this migration.
		 */
		const VERSION_OPTION = 'uichemy_composer_migration_version';

		/**
		 * The live queue: which steps remain and where each one is up to.
		 * Deleted when the migration completes.
		 */
		const QUEUE_OPTION = 'uichemy_composer_migration_queue';

		/**
		 * Held for the duration of one slice so two concurrent requests cannot
		 * rewrite the same rows.
		 */
		const LOCK_TRANSIENT = 'uichemy_composer_migration_lock';

		/**
		 * Prefixed onto a destination key whose value step_options() had to
		 * displace in favour of the legacy one, so an upgrade can never be the
		 * reason a value stops existing. Diagnostic only — nothing reads these
		 * back; they are here so a support request can.
		 */
		const BACKUP_PREFIX = 'uichemy_composer_premigration_';

		/**
		 * Cron hook that carries the migration forward on sites where nobody is
		 * sitting in wp-admin.
		 */
		const CRON_HOOK = 'uichemy_composer_migration_run';

		/**
		 * admin-post action behind the "run now" link in the progress notice.
		 */
		const MANUAL_ACTION = 'uichemy_composer_migration_manual';

		/**
		 * Rows touched per batch. Each `_elementor_data` row can be a megabyte of
		 * JSON, so this is deliberately modest — the time box below is the real
		 * limit and this only caps memory.
		 */
		const BATCH_SIZE = 20;

		/**
		 * Seconds one slice may spend before yielding to the next entry point.
		 * Well inside a default max_execution_time of 30s, with room for whatever
		 * else the request is doing.
		 */
		const TIME_BUDGET = 8;

		/**
		 * Elementor widget type: before → after.
		 *
		 * `proton` is what every released Protuno wrote into `_elementor_data`, and
		 * it is the ONLY value a customer site can be carrying. `composer` is the
		 * final name — see UiChemy_Composer_Widget::get_name().
		 *
		 * Do not "simplify" these to the same value: needs_migration() probes
		 * OLD_WIDGET, so an identity pair makes a real Protuno site look migrated,
		 * stamps the schema version, and lets Uich_Composer_Takeover delete the
		 * standalone plugin whose content was never rewritten.
		 */
		const OLD_WIDGET = 'proton';
		const NEW_WIDGET = 'uichemy-composer';

		/**
		 * A second, development-only widget name that also has to land on
		 * NEW_WIDGET.
		 *
		 * Between Protuno and the final rename the widget was briefly called
		 * `uichemy-builder`. That name never shipped, so no customer site has it —
		 * but our own dev, staging and test sites do, and without this pass their
		 * content would render as nothing after the rename. Harmless everywhere
		 * else: on a customer site the needle simply matches no rows.
		 */
		const DEV_WIDGET = 'uichemy-builder';

		/**
		 * A THIRD name that also has to land on NEW_WIDGET.
		 *
		 * v1 of this migration wrote `composer`. It shipped in no release — main
		 * carries no widget file at all — so like DEV_WIDGET it exists only on our
		 * own dev, staging and test sites. v2 exists solely to move those rows onto
		 * the namespaced `uichemy-composer`, which cannot collide with another
		 * plugin's widget in Elementor's global registry.
		 *
		 * REMOVABLE once every internal site has run v2 (target: one month after
		 * the 5.1.0 branch lands). To retire it, delete this constant and its use
		 * in legacy_widget_needles(), drop `composer` from
		 * uichemy_composer_widget_types() and UiChemy_Composer_Widget_Legacy::legacy_names(),
		 * delete UiChemy_Composer_Widget_Composer and its registration, and drop it
		 * from the widget-type lists in the four JS files. A customer site is never
		 * affected either way.
		 */
		const INTERIM_WIDGET = 'composer';

		/** Theme Builder post type: before → after. */
		const OLD_POST_TYPE = 'protuno_template';
		const NEW_POST_TYPE = 'uichemy_template';

		/**
		 * The id of the owned globals <style> block, before → after.
		 *
		 * Lives inside an option VALUE, not a key, so step_options() cannot move it.
		 * NEW_GLOBALS_BLOCK_ID must stay equal to UiChemy_Globals_CSS::BLOCK_ID —
		 * that class finds the block by this id, and a mismatch reads as "the site
		 * has no globals".
		 */
		const OLD_GLOBALS_BLOCK_ID = 'protuno-globals';
		const NEW_GLOBALS_BLOCK_ID = 'uichemy-globals';

		/**
		 * The ordered step list. Options and the small SQL renames run first so
		 * that settings, white label and the Theme Builder come back immediately;
		 * the long widget rewrite runs last.
		 *
		 * `globals_block` sits right after `options` because it rewrites a string
		 * INSIDE a value that `options` has just moved — it must not run before
		 * the destination key exists.
		 */
		const STEPS = array( 'options', 'globals_block', 'transients', 'post_type', 'meta_keys', 'elementor_data', 'finalize' );

		/**
		 * Option renames. Values are copied to the new key and the old key is
		 * deleted, so nothing reads a stale copy later.
		 *
		 * Mostly a `protuno_` → `uichemy_` prefix swap — but NOT for the last three
		 * before `role_manager`: those carried the old widget name inside the key as
		 * well, so `protuno_proton_*` becomes `uichemy_composer_*`. Copying them by
		 * prefix alone would produce keys nothing reads.
		 *
		 * KEYS ARE DATA, NOT IDENTIFIERS. They are the literal strings sitting in a
		 * customer's `wp_options` right now, so a repo-wide find-and-replace must
		 * never touch them — that is exactly how this map was once flattened into
		 * `'uichemy_x' => 'uichemy_x'` identity pairs, which makes needs_migration()
		 * report a Protuno site as already migrated.
		 *
		 * This list must cover EVERY option the runtime persists, not just the ones
		 * that are obvious from the settings screens. `protuno_globals_variable`
		 * (the global tokens and classes) and `protuno_globals_class` are the two
		 * that matter most: miss either and a site loses its global CSS, which looks
		 * like the design broke rather than like a missed key.
		 *
		 * Deliberately NOT here:
		 *   protuno_chat_*  — AI Chat is Pro-only and its code is not in this build,
		 *                     so renaming its rows would leave Pro reading keys that
		 *                     no longer exist.
		 *   protuno_sl_* / protuno_api_request_* — the standalone plugin's own
		 *                     licence/update transients. The merged plugin updates
		 *                     through UiChemy, so these rows are simply dead.
		 *
		 * @return array<string,string> old key → new key.
		 */
		public static function option_map() {
			return array(
				'protuno_settings'                  => 'uichemy_settings',
				'protuno_white_label'               => 'uichemy_white_label',
				'protuno_globals_class'             => 'uichemy_globals_class',
				'protuno_globals_variable'          => 'uichemy_globals_variable',
				'protuno_global_migration_v2_to_v3' => 'uichemy_global_migration_v2_to_v3',
				'protuno_autobind_dynamic_tags'     => 'uichemy_autobind_dynamic_tags',
				'protuno_proton_site_custom_code'   => 'uichemy_composer_site_custom_code',
				'protuno_proton_site_deps'          => 'uichemy_composer_site_deps',
				'protuno_proton_mcp_enabled'        => 'uichemy_composer_mcp_enabled',
				'protuno_role_manager'              => 'uichemy_role_manager',
			);
		}

		/**
		 * Post meta key renames.
		 *
		 * As with option_map(), the keys are literal database strings — never
		 * rename them to match the runtime's own constants.
		 *
		 * @return array<string,string> old key → new key.
		 */
		public static function meta_map() {
			return array(
				'_protuno_tpl_type'           => '_uichemy_tpl_type',
				'_protuno_tpl_conditions'     => '_uichemy_tpl_conditions',
				'_protuno_tpl_status'         => '_uichemy_tpl_status',
				'_protuno_tpl_editor'         => '_uichemy_tpl_editor',
				'_protuno_tpl_target'         => '_uichemy_tpl_target',
				'_protuno_stashed_conditions' => '_uichemy_stashed_conditions',
			);
		}

		// ============================================================
		// WIRING
		// ============================================================

		/**
		 * Register every entry point. Called from the builder loader, which has
		 * already decided that this plugin owns the runtime for this request.
		 *
		 * @return void
		 */
		public static function init() {
			// wp-admin is where an upgrading site lands first, so this is the
			// entry point that normally does all the work.
			add_action( 'admin_init', array( __CLASS__, 'maybe_run' ), 5 );

			// …but a site can be upgraded by a deploy that never opens wp-admin,
			// and its visitors would see empty widgets until someone did. Cron
			// finishes the job unattended.
			add_action( self::CRON_HOOK, array( __CLASS__, 'run_slice' ) );

			add_action( 'admin_notices', array( __CLASS__, 'progress_notice' ) );
			add_action( 'admin_post_' . self::MANUAL_ACTION, array( __CLASS__, 'handle_manual' ) );
		}

		/**
		 * Mark the migration as needed. Called from the plugin's activation hook,
		 * which is the one moment we KNOW an upgrade just happened.
		 *
		 * Only ever schedules work — activation runs in a sandboxed request with
		 * its own timeout, and rewriting thousands of rows there is how plugins
		 * fail to activate at all.
		 *
		 * @return void
		 */
		public static function schedule_on_activation() {
			if ( self::is_complete() ) {
				return;
			}
			self::ensure_queue();
			self::ensure_cron();
		}

		/**
		 * Has the database already been migrated to the current target?
		 *
		 * @return bool
		 */
		public static function is_complete() {
			return (int) get_option( self::VERSION_OPTION, 0 ) >= self::TARGET_VERSION;
		}

		/**
		 * Are there still legacy `protuno_*` option rows waiting to be moved?
		 *
		 * Exists so anything that WRITES one of the destination keys can hold off
		 * until step_options() has run — see UiChemy_Globals_Migration::maybe_migrate(),
		 * which would otherwise create the site-custom-code row on `init` and make
		 * this migration reconcile a collision it never needed to see.
		 *
		 * Deliberately not gated on is_complete(): a row imported after the
		 * migration stamped itself done is still a row that has to move, and the
		 * caller wants the truth about the database, not about the flag.
		 *
		 * @return bool
		 */
		public static function has_pending_legacy_options() {
			global $wpdb;

			$names        = array_keys( self::option_map() );
			$placeholders = implode( ', ', array_fill( 0, count( $names ), '%s' ) );

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $placeholders is a generated %s-only list; values bound as args.
			$found = $wpdb->get_var(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
				$wpdb->prepare(
					"SELECT option_id FROM {$wpdb->options} WHERE option_name IN ( {$placeholders} ) LIMIT 1",
					$names
				)
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

			return null !== $found;
		}

		// ============================================================
		// SCHEDULING
		// ============================================================

		/**
		 * Create the queue if the site needs migrating and has no queue yet.
		 *
		 * A site that installs v1.0.0 fresh has no UiChemy rows at all. Rather
		 * than make it carry a queue it will never use, `needs_migration()` looks
		 * for actual legacy rows and, finding none, stamps the version straight
		 * away — so a new install never shows a progress notice.
		 *
		 * @return array|null The queue, or null when nothing to do.
		 */
		private static function ensure_queue() {
			if ( self::is_complete() ) {
				return null;
			}

			$queue = get_option( self::QUEUE_OPTION, null );
			if ( is_array( $queue ) && ! empty( $queue['steps'] ) ) {
				return $queue;
			}

			if ( ! self::needs_migration() ) {
				self::mark_complete();
				return null;
			}

			$queue = array(
				'steps'   => array_values( self::STEPS ),
				'offset'  => 0,
				'done'    => array(),
				'counts'  => array(),
				'started' => time(),
			);
			update_option( self::QUEUE_OPTION, $queue, false );

			return $queue;
		}

		/**
		 * Is there any legacy UiChemy data on this site?
		 *
		 * Cheap existence probes (LIMIT 1) rather than counts — this runs on every
		 * admin request until the migration is stamped complete.
		 *
		 * @return bool
		 */
		private static function needs_migration() {
			global $wpdb;

			foreach ( self::option_map() as $old => $new ) {
				if ( null !== $wpdb->get_var( $wpdb->prepare( "SELECT option_id FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", $old ) ) ) {  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
					return true;
				}
			}

			if ( null !== $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s LIMIT 1", self::OLD_POST_TYPE ) ) ) {  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
				return true;
			}

			foreach ( array_keys( self::meta_map() ) as $old ) {
				if ( null !== $wpdb->get_var( $wpdb->prepare( "SELECT meta_id FROM {$wpdb->postmeta} WHERE meta_key = %s LIMIT 1", $old ) ) ) {  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
					return true;
				}
			}

			// Any legacy widget name still in the tree means there is work to do.
			foreach ( self::legacy_widget_needles() as $needle ) {
				$found = $wpdb->get_var(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
					$wpdb->prepare(
						"SELECT meta_id FROM {$wpdb->postmeta} WHERE meta_key = '_elementor_data' AND meta_value LIKE %s LIMIT 1",
						'%' . $wpdb->esc_like( $needle ) . '%'
					)
				);
				if ( null !== $found ) {
					return true;
				}
			}

			return false;
		}

		/**
		 * Keep a cron tick pending while work remains.
		 *
		 * @return void
		 */
		private static function ensure_cron() {
			if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
				wp_schedule_single_event( time() + 30, self::CRON_HOOK );
			}
		}

		/**
		 * Stamp the migration done and tidy up.
		 *
		 * @return void
		 */
		private static function mark_complete() {
			update_option( self::VERSION_OPTION, self::TARGET_VERSION, true );
			delete_option( self::QUEUE_OPTION );
			wp_clear_scheduled_hook( self::CRON_HOOK );
		}

		// ============================================================
		// RUNNER
		// ============================================================

		/**
		 * admin_init entry point.
		 *
		 * @return void
		 */
		public static function maybe_run() {
			if ( self::is_complete() ) {
				return;
			}
			// Companion-plugin opt-out: while PROTUNO_STANDALONE is defined the site is
			// keeping a standalone Protuno active, so its data must NOT be rewritten
			// into UiChemy's format. Mirrors Uich_Composer_Takeover::keep_standalone().
			if ( defined( 'PROTUNO_STANDALONE' ) ) {
				return;
			}
			// Ajax, cron and REST hit admin_init too. Migrating there is fine, but
			// a slow slice inside someone's editor autosave is not worth the risk —
			// cron and ordinary page loads will carry it.
			if ( wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
				self::ensure_cron();
				return;
			}
			self::run_slice();
		}

		/**
		 * Do as much of the queue as fits in one time box, then hand off.
		 *
		 * @return array Progress snapshot: array{complete:bool, step:string, counts:array}.
		 */
		public static function run_slice() {
			if ( self::is_complete() ) {
				return array(
					'complete' => true,
					'step'     => '',
					'counts'   => array(),
				);
			}

			$queue = self::ensure_queue();
			if ( null === $queue ) {
				return array(
					'complete' => true,
					'step'     => '',
					'counts'   => array(),
				);
			}

			// A slice that dies mid-way (fatal, timeout, killed worker) must not
			// wedge the migration forever, so the lock expires on its own.
			if ( get_transient( self::LOCK_TRANSIENT ) ) {
				self::ensure_cron();
				return array(
					'complete' => false,
					'step'     => (string) reset( $queue['steps'] ),
					'counts'   => (array) $queue['counts'],
				);
			}
			set_transient( self::LOCK_TRANSIENT, 1, 2 * MINUTE_IN_SECONDS );

			$deadline = microtime( true ) + self::TIME_BUDGET;

			try {
				while ( ! empty( $queue['steps'] ) && microtime( true ) < $deadline ) {
					$step = (string) $queue['steps'][0];

					$result = self::run_step( $step, (int) $queue['offset'], $queue );

					// Roll the per-step tally forward for the progress notice.
					foreach ( (array) $result['counts'] as $key => $value ) {
						$queue['counts'][ $key ] = ( isset( $queue['counts'][ $key ] ) ? (int) $queue['counts'][ $key ] : 0 ) + (int) $value;
					}

					if ( $result['done'] ) {
						array_shift( $queue['steps'] );
						$queue['done'][] = $step;
						$queue['offset'] = 0;
					} else {
						$queue['offset'] = (int) $result['offset'];
					}

					update_option( self::QUEUE_OPTION, $queue, false );
				}
			} finally {
				delete_transient( self::LOCK_TRANSIENT );
			}

			if ( empty( $queue['steps'] ) ) {
				$counts = (array) $queue['counts'];
				self::mark_complete();
				return array(
					'complete' => true,
					'step'     => '',
					'counts'   => $counts,
				);
			}

			// Still work left — make sure something comes back for it.
			self::ensure_cron();

			return array(
				'complete' => false,
				'step'     => (string) $queue['steps'][0],
				'counts'   => (array) $queue['counts'],
			);
		}

		/**
		 * Dispatch one step.
		 *
		 * @param string $step   Step name.
		 * @param int    $offset Where this step left off (meaning is step-specific).
		 * @param array  $queue  The live queue, for steps that need the tally.
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function run_step( $step, $offset, $queue ) {
			switch ( $step ) {
				case 'options':
					return self::step_options();
				case 'globals_block':
					return self::step_globals_block();
				case 'transients':
					return self::step_transients();
				case 'post_type':
					return self::step_post_type();
				case 'meta_keys':
					return self::step_meta_keys();
				case 'elementor_data':
					return self::step_elementor_data( $offset );
				case 'finalize':
					return self::step_finalize();
			}

			// Unknown step (e.g. a queue written by a newer version, then a
			// downgrade): drop it rather than spin on it forever.
			return array(
				'done'   => true,
				'offset' => 0,
				'counts' => array(),
			);
		}

		// ============================================================
		// STEPS
		// ============================================================

		/**
		 * Copy each protuno_* option to its uichemy_* name, then delete the old.
		 *
		 * THE LEGACY VALUE WINS when both keys exist, and the displaced value is
		 * kept under a backup key. This used to be the other way round — the
		 * destination was never overwritten — which silently destroyed the design
		 * of every migrating site:
		 *
		 *   1. UiChemy_Globals_Migration runs on `init` (pri 25) and, on a site
		 *      whose v2→v3 flag is still under its `protuno_` name, cannot tell it
		 *      has already run. It treats the site as fresh and CREATES
		 *      uichemy_composer_site_custom_code holding a default four-colour
		 *      #uichemy-globals block.
		 *   2. This step then runs on `admin_init` (pri 5) — later in the SAME
		 *      request — found the destination populated, skipped the copy, and
		 *      deleted the source. The customer's real block (design tokens, font
		 *      stacks, typography utility classes, Google Fonts links) was gone,
		 *      unrecoverable, and every page rendered unstyled.
		 *
		 * maybe_migrate() now defers to us so step 1 cannot happen first, but the
		 * ordering guard alone is not enough: an option can also be seeded by an
		 * import, a partial earlier run, or a future hook nobody remembers to
		 * order. So the conflict policy itself has to be non-destructive.
		 *
		 * Legacy-wins also makes this step agree with step_meta_keys(), which has
		 * always resolved the same collision in favour of the legacy row.
		 *
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function step_options() {
			$moved     = 0;
			$backed_up = 0;

			foreach ( self::option_map() as $old => $new ) {
				$old_value = get_option( $old, null );
				if ( null === $old_value ) {
					continue;
				}

				$new_value = get_option( $new, null );

				// Nothing to reconcile: the destination is free, or already holds
				// exactly what we would write.
				if ( null !== $new_value && $new_value !== $old_value ) {
					// Keep whatever we are about to displace. These rows are small
					// and there are at most a dozen of them, so the cost is trivial
					// next to being unable to answer "what did the upgrade drop?".
					update_option( self::BACKUP_PREFIX . $new, $new_value, false );
					++$backed_up;
				}

				if ( $new_value !== $old_value ) {
					// Autoload matches the old row so the new key is loaded on the
					// same requests the old one was.
					update_option( $new, $old_value, self::option_autoloads( $old ) );
					++$moved;
				}

				delete_option( $old );
			}

			return array(
				'done'   => true,
				'offset' => 0,
				'counts' => array(
					'options'         => $moved,
					'options_backups' => $backed_up,
				),
			);
		}

		/**
		 * Rename the owned globals <style> block inside the site custom code.
		 *
		 * The design tokens live as `<style id="protuno-globals">…</style>` inside
		 * the `head` string of the site-custom-code option, and UiChemy_Globals_CSS
		 * finds that block by its id. step_options() moved the option to its new key
		 * but the id inside the VALUE is still the old one, so without this the
		 * Globals screen opens empty on a migrated site and the section rewriter
		 * finds no var() definitions — the site looks like it lost its design.
		 *
		 * Deliberately surgical. The same string also holds the customer's own head
		 * markup — analytics snippets, their own CSS, possibly the word "protuno" in
		 * a comment or a class of their own — and none of that is ours to touch. So
		 * this rewrites ONLY the `id` attribute of a <style> tag whose id is exactly
		 * the old block id, and leaves every other byte alone. The pattern mirrors
		 * UiChemy_Globals_CSS::extract_css() so the two agree on what a block is.
		 *
		 * Runs after `options`, because the destination key has to exist first.
		 *
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function step_globals_block() {
			$option_name = self::option_map()['protuno_proton_site_custom_code'];

			$stored = get_option( $option_name, null );
			if ( ! is_array( $stored ) ) {
				return array(
					'done'   => true,
					'offset' => 0,
					'counts' => array(),
				);
			}

			// Matches the opening <style> tag only, capturing everything before and
			// after the id value so attribute order and quoting survive untouched.
			$pattern = '/(<style\b[^>]*\bid\s*=\s*(["\']))'
				. preg_quote( self::OLD_GLOBALS_BLOCK_ID, '/' )
				. '(\2)/i';

			$rewritten = 0;

			foreach ( array( 'head', 'footer' ) as $part ) {
				if ( ! isset( $stored[ $part ] ) || ! is_string( $stored[ $part ] ) ) {
					continue;
				}

				$updated = preg_replace(
					$pattern,
					'${1}' . self::NEW_GLOBALS_BLOCK_ID . '${3}',
					$stored[ $part ]
				);

				// preg_replace returns null on failure — never persist that.
				if ( null !== $updated && $updated !== $stored[ $part ] ) {
					$stored[ $part ] = $updated;
					++$rewritten;
				}
			}

			if ( $rewritten > 0 ) {
				update_option( $option_name, $stored, self::option_autoloads( $option_name ) );
			}

			return array(
				'done'   => true,
				'offset' => 0,
				'counts' => array( 'globals_block' => $rewritten ),
			);
		}

		/**
		 * Delete the runtime's leftover transients rather than rename them.
		 *
		 * These hold a per-user editor selection and a template preview payload —
		 * short-lived UI state that is rebuilt the moment it is needed again. The
		 * code writes them under `uichemy_` prefixes now, so the old `protuno_` rows
		 * would otherwise sit in wp_options until their timeout, unread.
		 *
		 * The prefixes below are the OLD ones being deleted — literal database
		 * strings, not the runtime's current names.
		 *
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function step_transients() {
			global $wpdb;

			$deleted = 0;

			foreach ( array( 'protuno_selected_el_', 'protuno_tb_preview_' ) as $prefix ) {
				$like = $wpdb->esc_like( '_transient_' . $prefix ) . '%';
				$tout = $wpdb->esc_like( '_transient_timeout_' . $prefix ) . '%';

				$rows = $wpdb->query(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
					$wpdb->prepare(
						"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
						$like,
						$tout
					)
				);

				$deleted += max( 0, (int) $rows );
			}

			return array(
				'done'   => true,
				'offset' => 0,
				'counts' => array( 'transients' => $deleted ),
			);
		}

		/**
		 * Read an option's autoload flag straight from the table.
		 *
		 * @param string $name Option name.
		 * @return bool
		 */
		private static function option_autoloads( $name ) {
			global $wpdb;

			$flag = $wpdb->get_var(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
				$wpdb->prepare( "SELECT autoload FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", $name )
			);

			// WP 6.6+ writes 'on'/'off'/'auto'/'auto-on'/'auto-off'; older rows are
			// 'yes'/'no'. Anything that is not an explicit "no" autoloads.
			return ! in_array( (string) $flag, array( 'no', 'off', 'auto-off' ), true );
		}

		/**
		 * Rename the Theme Builder post type in place.
		 *
		 * One UPDATE regardless of site size: post_type is indexed and template
		 * counts are in the dozens, not the thousands.
		 *
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function step_post_type() {
			global $wpdb;

			$rows = $wpdb->query(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
				$wpdb->prepare(
					"UPDATE {$wpdb->posts} SET post_type = %s WHERE post_type = %s",
					self::NEW_POST_TYPE,
					self::OLD_POST_TYPE
				)
			);

			// Revisions of a template are post_type='revision' and need no change,
			// so the single UPDATE above is the whole job. What it does invalidate is
			// every cached WP_Query result that was grouped by post type — bumping
			// the last-changed marker is how core expresses "all of them".
			if ( $rows && function_exists( 'wp_cache_set_posts_last_changed' ) ) {
				wp_cache_set_posts_last_changed();
			}

			return array(
				'done'   => true,
				'offset' => 0,
				'counts' => array( 'templates' => max( 0, (int) $rows ) ),
			);
		}

		/**
		 * Rename the template meta keys.
		 *
		 * Any row already sitting under the NEW key for the same post is deleted
		 * first, because two rows with the same post_id and meta_key would make
		 * get_post_meta() single reads non-deterministic. The new keys are unused
		 * before this migration, so in practice this only ever fires when an
		 * earlier run was interrupted between the delete and the update.
		 *
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function step_meta_keys() {
			global $wpdb;

			$renamed = 0;

			foreach ( self::meta_map() as $old => $new ) {
				$wpdb->query(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Direct DB query intentional; caching not applicable.
					$wpdb->prepare(
						"DELETE new_rows FROM {$wpdb->postmeta} AS new_rows
						 INNER JOIN {$wpdb->postmeta} AS old_rows
						    ON old_rows.post_id = new_rows.post_id
						 WHERE new_rows.meta_key = %s
						   AND old_rows.meta_key = %s",
						$new,
						$old
					)
				);

				$rows = $wpdb->query(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Direct DB query intentional; caching not applicable.
					$wpdb->prepare(
						"UPDATE {$wpdb->postmeta} SET meta_key = %s WHERE meta_key = %s",
						$new,
						$old
					)
				);

				$renamed += max( 0, (int) $rows );
			}

			if ( $renamed ) {
				wp_cache_flush_group( 'post_meta' );
			}

			return array(
				'done'   => true,
				'offset' => 0,
				'counts' => array( 'template_meta' => $renamed ),
			);
		}

		/**
		 * Rewrite the legacy widget types → `composer` inside every `_elementor_data` row.
		 *
		 * Paged by meta_id rather than LIMIT/OFFSET: the WHERE clause stops
		 * matching a row the moment it is rewritten, so an OFFSET would skip
		 * unprocessed rows as the result set shrinks under it. A high-water mark on
		 * the primary key is stable under exactly that mutation.
		 *
		 * @param int $offset Highest meta_id already processed.
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function step_elementor_data( $offset ) {
			global $wpdb;

			// Six needles: three legacy names (the shipped `proton`, plus the
			// dev-only `uichemy-builder` and `composer`) × two encodings. The same
			// JSON reaches the database escaped in some paths (nested template data,
			// exports re-imported through wp_slash), so both forms have to be
			// matched. All six are disjoint strings — no plain needle is a substring
			// of a slashed one, and each carries its own `"widgetType":"` prefix, so
			// `composer` cannot match inside an already-rewritten
			// `"widgetType":"uichemy-composer"` — so the replace order below is free.
			$needles = self::legacy_widget_needles();

			$likes = array();
			foreach ( $needles as $needle ) {
				$likes[] = '%' . $wpdb->esc_like( $needle ) . '%';
			}

			$where_like = implode( ' OR ', array_fill( 0, count( $likes ), 'meta_value LIKE %s' ) );

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where_like is a generated %s-only placeholder list; values are bound as args.
			$rows = $wpdb->get_results(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $where_like is built from a fixed placeholder string, not input.
					"SELECT meta_id, post_id, meta_value FROM {$wpdb->postmeta}
					 WHERE meta_key = '_elementor_data'
					   AND ( {$where_like} )
					   AND meta_id > %d
					 ORDER BY meta_id ASC
					 LIMIT %d",
					array_merge( $likes, array( (int) $offset, self::BATCH_SIZE ) )
				)
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

			if ( empty( $rows ) ) {
				return array(
					'done'   => true,
					'offset' => 0,
					'counts' => array(),
				);
			}

			$rewritten = 0;
			$last_id   = (int) $offset;
			$post_ids  = array();

			foreach ( $rows as $row ) {
				$last_id = (int) $row->meta_id;

				// Each legacy needle maps to the NEW_WIDGET needle in the SAME
				// encoding, so a slashed row stays slashed and a plain row stays
				// plain — the surrounding JSON is never re-encoded.
				$replacements = array();
				foreach ( $needles as $needle ) {
					$slashed        = false !== strpos( $needle, '\\"' );
					$replacements[] = self::widget_needle( self::NEW_WIDGET, $slashed );
				}

				$updated = str_replace(
					$needles,
					$replacements,
					(string) $row->meta_value
				);

				if ( $updated === (string) $row->meta_value ) {
					continue;
				}

				// %s on meta_value, so the JSON is bound as a literal — no second
				// round of slashing, no chance of mangling backslashes in the CSS.
				$wpdb->query(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Direct DB query intentional; caching not applicable.
					$wpdb->prepare(
						"UPDATE {$wpdb->postmeta} SET meta_value = %s WHERE meta_id = %d",
						$updated,
						(int) $row->meta_id
					)
				);

				++$rewritten;
				$post_ids[] = (int) $row->post_id;
			}

			foreach ( array_unique( $post_ids ) as $post_id ) {
				clean_post_cache( $post_id );
			}

			return array(
				// Fewer rows than asked for means the table is exhausted.
				'done'   => count( $rows ) < self::BATCH_SIZE,
				'offset' => $last_id,
				'counts' => array( 'elementor_rows' => $rewritten ),
			);
		}

		/**
		 * The `"widgetType":"…"` fragment as it appears inside stored JSON.
		 *
		 * The type is passed in rather than derived from a flag, because there are
		 * now three names to search for — OLD_WIDGET, DEV_WIDGET and INTERIM_WIDGET
		 * — and one to write. A boolean could only ever express two of them.
		 *
		 * @param string $type    Widget type to wrap.
		 * @param bool   $slashed Escaped form, as found in double-encoded rows.
		 * @return string
		 */
		private static function widget_needle( $type, $slashed = false ) {
			return $slashed
				? '\\"widgetType\\":\\"' . $type . '\\"'
				: '"widgetType":"' . $type . '"';
		}

		/**
		 * Every legacy widget name that must end up as NEW_WIDGET, in both the
		 * plain and the slashed form — the six needles the rewrite searches for.
		 *
		 * @return string[]
		 */
		private static function legacy_widget_needles() {
			$needles = array();

			foreach ( array( self::OLD_WIDGET, self::DEV_WIDGET, self::INTERIM_WIDGET ) as $type ) {
				$needles[] = self::widget_needle( $type, true );
				$needles[] = self::widget_needle( $type, false );
			}

			return $needles;
		}

		/**
		 * Clear the caches that still describe the site under its old names.
		 *
		 * @return array{done:bool, offset:int, counts:array}
		 */
		private static function step_finalize() {
			// The template post type slug changed, and its rewrite rules (and the
			// admin's registered-post-type list) are cached in an option.
			flush_rewrite_rules( false );

			// Elementor caches per-post CSS on disk and a widget-type list in the
			// database. Neither knows about `composer` yet, and the cached CSS still
			// carries the old `.elementor-widget-proton` wrapper class.
			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			wp_cache_flush_group( 'options' );

			/**
			 * Fires once the builder migration has finished rewriting the database.
			 *
			 * @param int $version The schema version now stamped on the site.
			 */
			do_action( 'uich_composer_migration_complete', self::TARGET_VERSION );

			return array(
				'done'   => true,
				'offset' => 0,
				'counts' => array(),
			);
		}

		// ============================================================
		// ADMIN SURFACE
		// ============================================================

		/**
		 * Tell the admin the migration is running, and let them push it along.
		 *
		 * Shown while the queue exists rather than only on the UiChemy screens:
		 * during the window before it finishes, some widgets on the site render
		 * nothing, and that is worth explaining wherever the user happens to be.
		 *
		 * @return void
		 */
		public static function progress_notice() {
			if ( self::is_complete() || ! current_user_can( 'manage_options' ) ) {
				return;
			}

			$queue = get_option( self::QUEUE_OPTION, null );
			if ( ! is_array( $queue ) || empty( $queue['steps'] ) ) {
				return;
			}

			$remaining = self::remaining_elementor_rows();
			$url       = wp_nonce_url(
				admin_url( 'admin-post.php?action=' . self::MANUAL_ACTION ),
				self::MANUAL_ACTION
			);

			echo '<div class="notice notice-info"><p><strong>';
			echo esc_html__( 'UiChemy is updating content from your previous plugin.', 'uichemy' );
			echo '</strong> ';
			printf(
				/* translators: %d: number of Elementor rows left to rewrite. */
				esc_html__( 'Widgets built with the previous plugin are being renamed to the Composer widget. %d items left.', 'uichemy' ),
				(int) $remaining
			);
			echo ' <a href="' . esc_url( $url ) . '">' . esc_html__( 'Finish now', 'uichemy' ) . '</a>';
			echo '</p></div>';
		}

		/**
		 * How many `_elementor_data` rows still hold the old widget type.
		 *
		 * @return int
		 */
		public static function remaining_elementor_rows() {
			global $wpdb;

			$likes = array();
			foreach ( self::legacy_widget_needles() as $needle ) {
				$likes[] = '%' . $wpdb->esc_like( $needle ) . '%';
			}

			$where_like = implode( ' OR ', array_fill( 0, count( $likes ), 'meta_value LIKE %s' ) );

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- $where_like is a generated %s-only placeholder list; values are bound as args.
			return (int) $wpdb->get_var(  // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct DB query intentional; caching not applicable.
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $where_like is built from a fixed placeholder string, not input.
					"SELECT COUNT(*) FROM {$wpdb->postmeta}
					 WHERE meta_key = '_elementor_data'
					   AND ( {$where_like} )",
					$likes
				)
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		}

		/**
		 * "Finish now": run slices back to back until the queue empties or the
		 * request runs out of the time PHP will give it.
		 *
		 * @return void
		 */
		public static function handle_manual() {
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_die( esc_html__( 'You are not allowed to do that.', 'uichemy' ), 403 );
			}
			check_admin_referer( self::MANUAL_ACTION );

			// The whole point of this route is to finish, so raise the ceiling as
			// far as the host allows and keep going.
			if ( function_exists( 'set_time_limit' ) ) {
				@set_time_limit( 0 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, Squiz.PHP.DiscouragedFunctions.Discouraged -- Raise limit for long migration; silenced if disabled by host.
			}

			$guard = 0;
			do {
				$progress = self::run_slice();
				++$guard;
			} while ( empty( $progress['complete'] ) && $guard < 200 );

			wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url() );
			exit;
		}
	}
}
