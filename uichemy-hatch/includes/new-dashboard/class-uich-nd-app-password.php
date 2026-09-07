<?php
/**
 * App Password handling for the new dashboard.
 *
 * Clean-slate port of the legacy `Uich_App_Password`. Coexists with it
 * during Phase 1-3: same WP application-passwords store, distinct name
 * prefix (`uichemy-nd-`) and distinct meta keys so the new dashboard's
 * remembered state is independent.
 *
 * Force-availability filters reuse the legacy `uich_force_app_passwords`
 * user-meta key so that an admin who enabled the override from either
 * dashboard sees a consistent on/off state. We only register the
 * filters here if the legacy class isn't already registering them, so
 * the cutover in Phase 3 doesn't lose this behaviour.
 *
 * AJAX actions (admin-only, nonce `uich_nd_ajax`):
 *   uich_nd_generate_app_password
 *   uich_nd_enable_app_passwords
 *   uich_nd_disable_app_passwords
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_App_Password' ) ) {

	final class Uich_ND_App_Password {

		const NONCE_ACTION      = 'uich_nd_ajax';
		const NAME_PREFIX       = 'uichemy-';            // shared root, mode appended live
		const FIGMA_PREFIX      = 'uichemy-figma-';
		const MCP_PREFIX        = 'uichemy-mcp-';
		const USER_META_COUNTER = 'uich_nd_app_pass_counter';
		const USER_META_FORCE   = 'uich_force_app_passwords'; // shared with legacy

		/**
		 * Login captured from the `authenticate` filter.
		 *
		 * @var string|null
		 */
		private static $auth_login = null;

		/**
		 * Login verify_force_effective() pretends to authenticate as.
		 *
		 * @var string|null
		 */
		private static $simulated_login = null;

		public static function boot() {
			self::maybe_register_force_filters();
			// Core hooks wp_authenticate_application_password on
			// `authenticate` at 20; sit just before it so the login is
			// known by the time our availability filter is consulted.
			add_filter( 'authenticate', array( __CLASS__, 'capture_auth_login' ), 19, 3 );
			add_action( 'wp_ajax_uich_nd_generate_app_password', array( __CLASS__, 'ajax_generate' ) );
			add_action( 'wp_ajax_uich_nd_enable_app_passwords', array( __CLASS__, 'ajax_enable' ) );
			add_action( 'wp_ajax_uich_nd_disable_app_passwords', array( __CLASS__, 'ajax_disable' ) );
		}

		/**
		 * Only register force filters if the legacy class hasn't. Both
		 * read the same user meta, so duplicating wastes cycles on every
		 * app-passwords check.
		 */
		private static function maybe_register_force_filters() {
			if ( class_exists( 'Uich_App_Password' )
				&& has_filter( 'wp_is_application_passwords_available', array( 'Uich_App_Password', 'filter_force_available' ) ) ) {
				return;
			}
			add_filter( 'wp_is_application_passwords_available', array( __CLASS__, 'filter_force_available' ), 999 );
			add_filter( 'wp_is_application_passwords_available_for_user', array( __CLASS__, 'filter_force_available_for_user' ), 999, 2 );
		}

		public static function is_user_force_enabled( $user_id ) {
			$user_id = (int) $user_id;
			if ( $user_id <= 0 ) {
				return false;
			}
			return '1' === (string) get_user_meta( $user_id, self::USER_META_FORCE, true );
		}

		/**
		 * Remember who is trying to authenticate. Pass-through filter — we only
		 * need the username. The REST path is covered by PHP_AUTH_USER instead.
		 */
		public static function capture_auth_login( $user, $username = '', $password = '' ) {
			if ( is_string( $username ) && '' !== $username ) {
				self::$auth_login = $username;
			}
			return $user;
		}

		/**
		 * Which user is this availability check being made on behalf of?
		 *
		 * Resolved from the Basic-auth username, the way core does it. Do NOT
		 * reach for get_current_user_id() during `determine_current_user`:
		 * _wp_get_current_user() re-applies that filter while $current_user is
		 * still empty and recurses until the stack blows.
		 */
		private static function resolve_requesting_user_id() {
			$login = null;

			if ( null !== self::$simulated_login ) {
				$login = self::$simulated_login;
			} elseif ( doing_filter( 'determine_current_user' ) || doing_filter( 'authenticate' ) ) {
				$login = self::$auth_login;
				if ( ( ! is_string( $login ) || '' === $login ) && isset( $_SERVER['PHP_AUTH_USER'] ) ) {
					$login = wp_unslash( $_SERVER['PHP_AUTH_USER'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- looked up via get_user_by(), which prepares the query.
				}
			} else {
				return (int) get_current_user_id();
			}

			if ( ! is_string( $login ) || '' === $login ) {
				return 0;
			}

			// Memoised: availability is checked several times per request.
			static $cache = array();
			if ( isset( $cache[ $login ] ) ) {
				return $cache[ $login ];
			}

			$user = get_user_by( 'login', $login );
			if ( ! $user && is_email( $login ) ) {
				$user = get_user_by( 'email', $login );
			}

			$cache[ $login ] = ( $user && $user->exists() ) ? (int) $user->ID : 0;
			return $cache[ $login ];
		}

		/**
		 * Site-level override: intentionally overrides a security plugin's
		 * `false`, but only for a user who opted in, and the per-user filter
		 * below still has to agree. Their site-wide setting is left alone.
		 */
		public static function filter_force_available( $available ) {
			if ( $available ) {
				return true;
			}
			$user_id = self::resolve_requesting_user_id();
			if ( $user_id > 0 && self::is_user_force_enabled( $user_id ) ) {
				return true;
			}
			return false;
		}

		public static function filter_force_available_for_user( $available, $user ) {
			if ( $available ) {
				return true;
			}
			if ( $user instanceof WP_User && $user->exists() && self::is_user_force_enabled( $user->ID ) ) {
				return true;
			}
			return (bool) $available;
		}

		/**
		 * Snapshot for the React side.
		 *
		 * The Application Password is treated as a transient one-shot
		 * secret: we never persist last4 / name in user meta and always
		 * boot the dashboard with `hasToken: false`. The dashboard's
		 * Connection card shows a "Generate" button on every load — the
		 * user picks when to issue a fresh password (no auto-issue).
		 */
		public static function get_dashboard_state() {
			$user               = wp_get_current_user();
			$available          = function_exists( 'wp_is_application_passwords_available' )
				? (bool) wp_is_application_passwords_available()
				: false;
			$available_for_user = function_exists( 'wp_is_application_passwords_available_for_user' )
				? (bool) wp_is_application_passwords_available_for_user( $user )
				: $available;

			$native_available = self::is_native_site_available();
			$native_for_user  = $native_available && self::is_native_available_for_user( $user );
			$force_enabled    = $user ? self::is_user_force_enabled( $user->ID ) : false;

			return array(
				'available'        => $available,
				'availableForUser' => $available_for_user,
				'nativeAvailable'  => $native_available,
				'forceEnabled'     => $force_enabled,
				'canForceEnable'   => ! $native_for_user && ! $force_enabled,
				'canForceDisable'  => $force_enabled,
				'disabledReason'   => self::get_disabled_reason( $user ),
				'wordfenceUrl'     => admin_url( 'admin.php?page=WordfenceOptions' ),
				'userLogin'        => $user ? $user->user_login : '',
				'isSsl'            => is_ssl(),
				'permalinkPretty'  => '' !== get_option( 'permalink_structure' ),
				'namePrefix'       => self::NAME_PREFIX,
				// Transient by design — user clicks Generate to issue fresh.
				'hasToken'         => false,
				'profileUrl'       => admin_url( 'profile.php#application-passwords-section' ),
			);
		}

		public static function ajax_generate() {
			self::guard();

			if ( ! class_exists( 'WP_Application_Passwords' ) ) {
				wp_send_json_error(
					array(
						'code'    => 'no_class',
						'message' => __( 'Application Passwords need WordPress 5.6+.', 'uichemy' ),
					),
					400
				);
			}

			$user = wp_get_current_user();

			// Auto-enable for HTTP / local dev — same UX as legacy.
			if ( self::is_native_disabled_for_user( $user ) && ! self::is_user_force_enabled( $user->ID ) ) {
				update_user_meta( $user->ID, self::USER_META_FORCE, '1' );
			}

			if ( function_exists( 'wp_is_application_passwords_available_for_user' )
				&& ! wp_is_application_passwords_available_for_user( $user ) ) {
				wp_send_json_error(
					array(
						'code'    => 'user_blocked',
						'message' => __( 'Application Passwords are disabled for this user. Enable them, then try again.', 'uichemy' ),
					),
					400
				);
			}

			// Mode determines the naming convention: uichemy-figma-N /
			// uichemy-mcp-N. Default to figma when the JS side doesn't
			// pass it (e.g. dashboard Generate before mode is set).
			$mode = isset( $_POST['mode'] ) ? sanitize_key( wp_unslash( $_POST['mode'] ) ) : 'figma';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce and capability verified at handler entry.
			if ( ! in_array( $mode, array( 'figma', 'mcp' ), true ) ) {
				$mode = 'figma';
			}

			// No cleanup — every Generate adds a new entry, old entries
			// stay in the user's WP profile (they can revoke manually if
			// they want). Counter is monotonic so names never collide.
			$counter = (int) get_user_meta( $user->ID, self::USER_META_COUNTER, true );
			++$counter;
			update_user_meta( $user->ID, self::USER_META_COUNTER, $counter );

			$name = sprintf( 'uichemy-%s-%d', $mode, $counter );

			$created = WP_Application_Passwords::create_new_application_password( $user->ID, array( 'name' => $name ) );
			if ( is_wp_error( $created ) ) {
				wp_send_json_error(
					array(
						'code'    => 'wp_error',
						'message' => $created->get_error_message(),
					),
					500
				);
			}

			list( $password, $details ) = $created;

			// Plain Application Password is the only secret the React side
			// needs — every surface (Connection card, wizard, MCP config)
			// embeds it directly into the URL or env var. The old
			// `Authorization: Basic …` flow is gone, so we don't compute
			// the base64 token or the masked variant any more.

			wp_send_json_success(
				array(
					'uuid'      => isset( $details['uuid'] ) ? (string) $details['uuid'] : '',
					'name'      => $name,
					'created'   => isset( $details['created'] ) ? (int) $details['created'] : time(),
					'userLogin' => $user->user_login,
					'password'  => $password,
					'state'     => self::get_dashboard_state(),
				)
			);
		}

		public static function ajax_enable() {
			self::guard();

			if ( ! class_exists( 'WP_Application_Passwords' ) ) {
				wp_send_json_error(
					array(
						'code'    => 'no_class',
						'message' => __( 'Application Passwords need WordPress 5.6+.', 'uichemy' ),
					),
					400
				);
			}

			$user = wp_get_current_user();
			if ( ! self::is_native_disabled_for_user( $user ) ) {
				wp_send_json_error(
					array(
						'code'    => 'already',
						'message' => __( 'Application Passwords are already available for your account.', 'uichemy' ),
					),
					400
				);
			}

			update_user_meta( $user->ID, self::USER_META_FORCE, '1' );

			// Verify rather than assume the meta was enough: a callback at a
			// later priority than ours would still win at auth time.
			if ( ! self::verify_force_effective( $user ) ) {
				delete_user_meta( $user->ID, self::USER_META_FORCE );
				$blocker = self::detect_blocker();
				$label   = ( $blocker && '' !== $blocker['label'] ) ? $blocker['label'] : '';
				wp_send_json_error(
					array(
						'code'    => 'still_blocked',
						'blocker' => $blocker,
						'message' => $label
							/* translators: %s: name of the plugin blocking Application Passwords. */
							? sprintf( __( '%s is still blocking Application Passwords, so we rolled the override back. Turn its setting off and try again.', 'uichemy' ), $label )
							: __( 'Something on this site is still blocking Application Passwords, so we rolled the override back.', 'uichemy' ),
					),
					409
				);
			}

			wp_send_json_success( self::get_dashboard_state() );
		}

		public static function ajax_disable() {
			self::guard();
			$user = wp_get_current_user();
			if ( ! self::is_user_force_enabled( $user->ID ) ) {
				wp_send_json_error(
					array(
						'code'    => 'noop',
						'message' => __( 'No UiChemy override is active for your account.', 'uichemy' ),
					),
					400
				);
			}
			delete_user_meta( $user->ID, self::USER_META_FORCE );
			wp_send_json_success( self::get_dashboard_state() );
		}

		private static function guard() {
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_send_json_error(
					array(
						'code'    => 'forbidden',
						'message' => __( 'Insufficient permissions.', 'uichemy' ),
					),
					403
				);
			}
			check_ajax_referer( self::NONCE_ACTION, 'nonce' );
		}


		/**
		 * Run $fn with our own force overrides lifted, so we measure the site's
		 * native answer. Legacy `Uich_App_Password` entries are included in case
		 * a stale copy is loaded by something else.
		 */
		private static function with_force_filters_removed( $fn ) {
			$hooks = array(
				array( 'wp_is_application_passwords_available', array( 'Uich_App_Password', 'filter_force_available' ), 999, 1 ),
				array( 'wp_is_application_passwords_available', array( __CLASS__, 'filter_force_available' ), 999, 1 ),
				array( 'wp_is_application_passwords_available_for_user', array( 'Uich_App_Password', 'filter_force_available_for_user' ), 999, 2 ),
				array( 'wp_is_application_passwords_available_for_user', array( __CLASS__, 'filter_force_available_for_user' ), 999, 2 ),
			);

			$restore = array();
			foreach ( $hooks as $hook ) {
				list( $name, $callback, $priority, $args ) = $hook;
				// Remove at the priority it is *actually* registered at, not the
				// one we expect: remove_filter() at the wrong priority is a
				// silent no-op, and we would then re-add a duplicate below.
				$found = has_filter( $name, $callback );
				if ( false !== $found ) {
					remove_filter( $name, $callback, $found );
					$restore[] = array( $name, $callback, $found, $args );
				}
			}

			try {
				return $fn();
			} finally {
				foreach ( $restore as $hook ) {
					list( $name, $callback, $priority, $args ) = $hook;
					add_filter( $name, $callback, $priority, $args );
				}
			}
		}

		public static function is_native_site_available() {
			return (bool) self::with_force_filters_removed(
				function () {
					return function_exists( 'wp_is_application_passwords_available' )
						? (bool) wp_is_application_passwords_available()
						: false;
				}
			);
		}

		private static function is_native_available_for_user( $user ) {
			return (bool) self::with_force_filters_removed(
				function () use ( $user ) {
					return function_exists( 'wp_is_application_passwords_available_for_user' )
						? (bool) wp_is_application_passwords_available_for_user( $user )
						: false;
				}
			);
		}

		/**
		 * Would an Application Password for $user actually authenticate? Runs
		 * the real filter chain with the identity resolved as it will be at
		 * auth time, so a later-priority callback shows up here rather than as
		 * a working dashboard and a failing connection.
		 */
		private static function verify_force_effective( $user ) {
			if ( ! ( $user instanceof WP_User ) || ! $user->exists() ) {
				return false;
			}
			self::$simulated_login = $user->user_login;
			try {
				if ( ! function_exists( 'wp_is_application_passwords_available_for_user' ) ) {
					return false;
				}
				return (bool) wp_is_application_passwords_available()
					&& (bool) wp_is_application_passwords_available_for_user( $user );
			} finally {
				self::$simulated_login = null;
			}
		}

		/**
		 * What is blocking Application Passwords on this site? Null when nothing
		 * is — never infer a block from a plugin merely being installed.
		 *
		 * @return array|null {
		 *     @type string $type    'wordfence' | 'plugin' | 'unknown'
		 *     @type string $label   Human name of the culprit, '' when unknown.
		 *     @type array  $hooked  Plugin names with callbacks on the filter.
		 * }
		 */
		public static function detect_blocker() {
			// Memoised: bisection re-runs the availability chain once per hooked
			// callback, and more than one caller wants this per boot.
			static $memo = false;
			if ( false !== $memo ) {
				return $memo;
			}

			$memo = self::compute_blocker();
			return $memo;
		}

		private static function compute_blocker() {
			if ( ! class_exists( 'WP_Application_Passwords' ) ) {
				return null;
			}
			// Without HTTPS (or a local environment) core never offers them in the
			// first place, so nothing is *blocking* them — reporting a blocker here
			// invents a culprit and hides the real reason.
			if ( ! wp_is_application_passwords_supported() ) {
				return null;
			}
			if ( self::is_native_site_available() ) {
				return null; // Nothing to report.
			}

			$hooked = self::plugins_hooked_on_availability();

			// Wordfence enforces its own setting with `__return_false`, a *core*
			// function — reflection would blame wp-includes. Asking it directly is
			// the only way to name it and point at the exact toggle.
			if ( class_exists( 'wfConfig' ) && wfConfig::get( 'loginSec_disableApplicationPasswords' ) ) {
				return array(
					'type'   => 'wordfence',
					'label'  => 'Wordfence',
					'hooked' => $hooked,
				);
			}

			$culprit = self::bisect_availability_filter();
			if ( '' !== (string) $culprit ) {
				return array(
					'type'   => 'plugin',
					'label'  => $culprit,
					'hooked' => $hooked,
				);
			}

			// Something is returning false and we can't attribute it. Listing
			// what's hooked on the filter still beats naming a plugin we only
			// guessed at from a slug.
			return array(
				'type'   => 'unknown',
				'label'  => '',
				'hooked' => $hooked,
			);
		}

		/**
		 * Find the culprit by behaviour, not introspection: drop one callback at
		 * a time and see whose absence flips availability to true. Works however
		 * the callback was registered (closure, method, core helper).
		 */
		private static function bisect_availability_filter() {
			global $wp_filter;
			$hook = 'wp_is_application_passwords_available';

			if ( empty( $wp_filter[ $hook ] ) || ! ( $wp_filter[ $hook ] instanceof WP_Hook ) ) {
				return '';
			}

			// Flat snapshot, plus the live hook object to put back untouched.
			$saved     = $wp_filter[ $hook ];
			$callbacks = array();
			foreach ( $saved->callbacks as $priority => $entries ) {
				foreach ( $entries as $entry ) {
					$callbacks[] = array( $priority, $entry );
				}
			}

			try {
				foreach ( $callbacks as $index => $item ) {
					if ( self::is_own_callback( $item[1]['function'] ) ) {
						continue; // Never a suspect.
					}

					// Measure on a throwaway WP_Hook; never mutate the live one.
					// WP_Hook::$priorities is private and only rebuilt through the
					// add/remove API, so restoring `->callbacks` by hand leaves
					// callbacks apply_filters() never iterates — i.e. a blocker
					// left registered but inert for the rest of the request.
					// Ours are excluded too, so this reads the native answer.
					$trial = new WP_Hook();
					foreach ( $callbacks as $i => $other ) {
						if ( $i === $index || self::is_own_callback( $other[1]['function'] ) ) {
							continue;
						}
						$trial->add_filter( $hook, $other[1]['function'], $other[0], $other[1]['accepted_args'] );
					}

					$wp_filter[ $hook ] = $trial;
					$without            = function_exists( 'wp_is_application_passwords_available' )
						? (bool) wp_is_application_passwords_available()
						: false;
					$wp_filter[ $hook ] = $saved;

					if ( $without ) {
						// '' when it resolves to core (e.g. __return_false) —
						// the caller falls back to the vendor probe / unknown
						// branch rather than naming WordPress itself.
						return self::describe_callback_owner( $item[1]['function'] );
					}
				}
			} finally {
				$wp_filter[ $hook ] = $saved;
			}

			return '';
		}

		private static function is_own_callback( $callback ) {
			if ( ! is_array( $callback ) || count( $callback ) !== 2 ) {
				return false;
			}
			$class = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
			return in_array( $class, array( __CLASS__, 'Uich_App_Password' ), true );
		}

		/**
		 * Which plugin owns this callback? '' when it resolves to core, a
		 * theme, or anything we can't place inside wp-content/plugins.
		 */
		private static function describe_callback_owner( $callback ) {
			$file = self::callback_file( $callback );
			if ( '' === $file ) {
				return '';
			}
			return self::plugin_name_for_file( $file );
		}

		private static function callback_file( $callback ) {
			try {
				if ( is_string( $callback ) && false !== strpos( $callback, '::' ) ) {
					list( $class, $method ) = explode( '::', $callback, 2 );
					$ref                    = new ReflectionMethod( $class, $method );
				} elseif ( is_array( $callback ) && count( $callback ) === 2 ) {
					$ref = new ReflectionMethod( is_object( $callback[0] ) ? get_class( $callback[0] ) : $callback[0], $callback[1] );
				} elseif ( is_object( $callback ) && ! ( $callback instanceof Closure ) && method_exists( $callback, '__invoke' ) ) {
					$ref = new ReflectionMethod( $callback, '__invoke' );
				} else {
					$ref = new ReflectionFunction( $callback );
				}
				$file = (string) $ref->getFileName();
			} catch ( Exception $e ) {
				return '';
			} catch ( Throwable $e ) {
				return '';
			}
			return $file;
		}

		private static function plugin_name_for_file( $file ) {
			$plugin_dir = wp_normalize_path( WP_PLUGIN_DIR );
			$file       = wp_normalize_path( $file );
			if ( 0 !== strpos( $file, trailingslashit( $plugin_dir ) ) ) {
				return ''; // Core, a theme, or an mu-plugin — don't guess.
			}

			$relative = ltrim( substr( $file, strlen( $plugin_dir ) ), '/' );
			$folder   = strtok( $relative, '/' );
			if ( ! $folder ) {
				return '';
			}

			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			foreach ( get_plugins() as $plugin_file => $data ) {
				if ( 0 === strpos( $plugin_file, $folder . '/' ) && ! empty( $data['Name'] ) ) {
					return (string) $data['Name'];
				}
			}
			return $folder;
		}

		/**
		 * Active plugins with a callback on the availability filter. Shown
		 * when attribution fails, so the card still gives the user
		 * somewhere to look.
		 */
		private static function plugins_hooked_on_availability() {
			global $wp_filter;
			$hook = 'wp_is_application_passwords_available';
			if ( empty( $wp_filter[ $hook ] ) || ! ( $wp_filter[ $hook ] instanceof WP_Hook ) ) {
				return array();
			}

			$names = array();
			foreach ( $wp_filter[ $hook ]->callbacks as $entries ) {
				foreach ( $entries as $entry ) {
					if ( self::is_own_callback( $entry['function'] ) ) {
						continue;
					}
					$name = self::describe_callback_owner( $entry['function'] );
					if ( '' !== $name ) {
						$names[ $name ] = true;
					}
				}
			}
			return array_keys( $names );
		}

		private static function is_native_disabled_for_user( $user ) {
			if ( ! class_exists( 'WP_Application_Passwords' ) ) {
				return false;
			}
			if ( ! self::is_native_site_available() ) {
				return true;
			}
			return ! self::is_native_available_for_user( $user );
		}

		private static function get_disabled_reason( $user ) {
			if ( ! class_exists( 'WP_Application_Passwords' ) ) {
				return 'no_class';
			}
			if ( ! self::is_native_site_available() ) {
				// Core's own rule (is_ssl() || local), not a second guess at it,
				// so this and detect_blocker() can't disagree about HTTPS.
				if ( ! wp_is_application_passwords_supported() ) {
					return 'no_ssl';
				}
				return 'blocked';
			}
			if ( $user && ! self::is_native_available_for_user( $user ) ) {
				return 'user';
			}
			return null;
		}
	}
}
