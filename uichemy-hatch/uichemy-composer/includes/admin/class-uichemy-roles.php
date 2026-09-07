<?php
/**
 * UiChemy_Roles — role-based access resolver for the UiChemy editor.
 *
 * A small, dependency-free helper that answers "what may this user do with
 * UiChemy?" from a single option (`uichemy_role_manager`). It is the one place
 * every gate (composer load, frontend REST, feature REST) consults, so access
 * rules live in exactly one spot.
 *
 * Storage model (option `uichemy_role_manager`), keyed by role slug — the
 * Administrator role is never stored and is always resolved as full access so
 * an admin can never lock themselves out:
 *
 *     [
 *       'editor' => [
 *         'access'        => 'full',   // 'full' | 'content' | 'none'
 *         'theme_builder' => 1,        // UiChemy feature toggles (0|1)
 *         'design_system' => 1,        // Globals CSS / Variables / Classes
 *         'ai_chat'       => 0,        // MCP / AI chat tab
 *       ],
 *       // ...one entry per editable role
 *     ]
 *
 * When the option (or a given role) has never been saved, defaults are
 * synthesised to preserve the plugin's historical behaviour: any role that can
 * `edit_posts` gets full editor access; every other role gets none. Feature
 * toggles default off for all non-admin roles (those surfaces were previously
 * administrator-only), so introducing the Role Manager changes nothing until an
 * admin edits it.
 *
 * @package UiChemy
 * @subpackage UiChemy/admin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Roles' ) ) {

	/**
	 * Resolves UiChemy editor access for users and roles.
	 */
	class UiChemy_Roles {

		/**
		 * Option name storing the per-role access map.
		 */
		const OPTION = 'uichemy_role_manager';

		/**
		 * Valid access levels, ordered least → most permissive. The array index
		 * doubles as the comparison rank used when a user has several roles.
		 *
		 * @var string[]
		 */
		const ACCESS_LEVELS = array( 'none', 'content', 'full' );

		/**
		 * Recognised per-role feature toggles.
		 *
		 * @var string[]
		 */
		const FEATURES = array( 'theme_builder', 'design_system', 'ai_chat' );

		/* ── Public resolver API ──────────────────────────────────────────── */

		/**
		 * Resolve the effective access level for a user.
		 *
		 * Administrators (anyone who can `manage_options`) are always full.
		 * Otherwise the most permissive level across the user's roles wins,
		 * mirroring WordPress's additive capability model and avoiding surprise
		 * lockouts for multi-role users.
		 *
		 * @param int|WP_User|null $user User or ID; defaults to the current user.
		 * @return string One of 'full' | 'content' | 'none'.
		 */
		public static function access_for_user( $user = null ) {
			$user = self::resolve_user( $user );
			if ( ! $user || ! $user->exists() ) {
				return 'none';
			}
			if ( user_can( $user, 'manage_options' ) ) {
				return 'full';
			}

			$best = 'none';
			foreach ( (array) $user->roles as $role_slug ) {
				$access = self::access_for_role( $role_slug );
				if ( self::rank( $access ) > self::rank( $best ) ) {
					$best = $access;
				}
			}
			return $best;
		}

		/**
		 * Whether the user may open the UiChemy composer at all.
		 *
		 * @param int|WP_User|null $user User or ID; defaults to the current user.
		 * @return bool
		 */
		public static function can_edit( $user = null ) {
			return 'none' !== self::access_for_user( $user );
		}

		/**
		 * Whether the user is restricted to content-only editing (no design,
		 * structure, code or global changes).
		 *
		 * @param int|WP_User|null $user User or ID; defaults to the current user.
		 * @return bool
		 */
		public static function is_content_only( $user = null ) {
			return 'content' === self::access_for_user( $user );
		}

		/**
		 * Whether the user may use a UiChemy feature surface.
		 *
		 * Administrators always may. Otherwise the flag is OR'd across the
		 * user's roles. A feature is only meaningful when the user also has
		 * editor access, so it is forced off for no-access users.
		 *
		 * @param string           $feature One of self::FEATURES.
		 * @param int|WP_User|null $user    User or ID; defaults to current user.
		 * @return bool
		 */
		public static function can_use( $feature, $user = null ) {
			if ( ! in_array( $feature, self::FEATURES, true ) ) {
				return false;
			}
			$user = self::resolve_user( $user );
			if ( ! $user || ! $user->exists() ) {
				return false;
			}
			if ( user_can( $user, 'manage_options' ) ) {
				return true;
			}
			// Feature surfaces require FULL access — a content-only (or no-access)
			// role never gets design system / theme builder / AI chat, matching the
			// "no design, code or globals" contract shown in the Role Manager. This
			// is the server-side guarantee even if a stale stored flag says otherwise.
			if ( 'full' !== self::access_for_user( $user ) ) {
				return false;
			}

			foreach ( (array) $user->roles as $role_slug ) {
				if ( self::feature_for_role( $role_slug, $feature ) ) {
					return true;
				}
			}
			return false;
		}

		/* ── Per-role resolution ──────────────────────────────────────────── */

		/**
		 * The stored (or default) access level for a single role slug.
		 *
		 * @param string $role_slug Role slug (e.g. 'editor').
		 * @return string One of 'full' | 'content' | 'none'.
		 */
		public static function access_for_role( $role_slug ) {
			$settings = self::get_settings();
			if ( isset( $settings[ $role_slug ]['access'] )
				&& in_array( $settings[ $role_slug ]['access'], self::ACCESS_LEVELS, true ) ) {
				return $settings[ $role_slug ]['access'];
			}
			return self::default_access_for_role( $role_slug );
		}

		/**
		 * The stored (or default) value of one feature toggle for a role.
		 *
		 * @param string $role_slug Role slug.
		 * @param string $feature   One of self::FEATURES.
		 * @return bool
		 */
		public static function feature_for_role( $role_slug, $feature ) {
			$settings = self::get_settings();
			if ( isset( $settings[ $role_slug ][ $feature ] ) ) {
				return ! empty( $settings[ $role_slug ][ $feature ] );
			}
			// Historical behaviour: these surfaces were administrator-only, so
			// every non-admin role defaults to off.
			return false;
		}

		/**
		 * Default access for a role when nothing is stored.
		 *
		 * PRO — nothing at all. The Role Manager exists, so access is something an
		 * administrator grants deliberately; the first time Pro is activated every
		 * role therefore reads No Access, and the screen shows exactly the state
		 * that is in force. Handing out full access to every `edit_posts` role and
		 * then showing it pre-selected made the grant look like a decision someone
		 * had made.
		 *
		 * FREE — the historical capability default stands: any role that can
		 * `edit_posts` gets full access. There is no Role Manager screen in Free, so
		 * defaulting to none would strip Editors and Authors of the editor with no
		 * way for the site owner to give it back. Same reasoning as get_settings()
		 * ignoring the stored map in Free.
		 *
		 * @param string $role_slug Role slug.
		 * @return string 'full' | 'none'.
		 */
		private static function default_access_for_role( $role_slug ) {
			if ( uichemy_is_pro() ) {
				return 'none';
			}
			return self::role_can_edit( $role_slug ) ? 'full' : 'none';
		}

		/**
		 * Can this role edit content at all?
		 *
		 * Without `edit_posts` there is nothing for the UiChemy editor to open, so
		 * "Content Only" and "Full Access" are meaningless on such a role —
		 * Subscriber and WooCommerce's Customer being the everyday examples. Keyed
		 * on the capability rather than a list of slugs so any non-editing role a
		 * plugin or membership site adds behaves the same way.
		 *
		 * @param string $role_slug Role slug.
		 * @return bool
		 */
		public static function role_can_edit( $role_slug ) {
			$role = get_role( $role_slug );
			return (bool) ( $role && $role->has_cap( 'edit_posts' ) );
		}

		/**
		 * Which editable roles can edit content, as slug => bool.
		 *
		 * Sent to the Role Manager screen so the UI can offer only the levels a
		 * role can actually have, instead of letting someone configure access that
		 * could never take effect.
		 *
		 * @return array<string,bool>
		 */
		public static function roles_can_edit() {
			$out = array();
			foreach ( array_keys( self::editable_roles() ) as $slug ) {
				$out[ $slug ] = self::role_can_edit( $slug );
			}
			return $out;
		}

		/* ── Settings storage / listing ───────────────────────────────────── */

		/**
		 * The raw stored access map. Never includes the Administrator role.
		 *
		 * @return array
		 */
		public static function get_settings() {
			// The Role Manager is a Pro feature. In Free the stored map is ignored
			// entirely, so access falls back to the WordPress-capability default in
			// default_access_for_role() (any role with `edit_posts` gets full access)
			// — exactly the behaviour Free has always had. Returning the stored map
			// here would let a Pro-configured site keep its restrictions after a
			// downgrade, with no UI left to change them. The option is never deleted.
			if ( ! uichemy_is_pro() ) {
				return array();
			}

			$stored = get_option( self::OPTION, array() );
			return is_array( $stored ) ? $stored : array();
		}

		/**
		 * A fully-resolved settings map for every editable role — each entry
		 * populated with the stored value or its synthesised default. This is
		 * what the Role Manager screen renders (so unsaved roles show their
		 * effective defaults, not blanks).
		 *
		 * @return array<string,array>
		 */
		public static function get_resolved_settings() {
			$out = array();
			foreach ( array_keys( self::editable_roles() ) as $role_slug ) {
				$entry = array( 'access' => self::access_for_role( $role_slug ) );
				foreach ( self::FEATURES as $feature ) {
					$entry[ $feature ] = self::feature_for_role( $role_slug, $feature ) ? 1 : 0;
				}
				$out[ $role_slug ] = $entry;
			}
			return $out;
		}

		/**
		 * Editable roles — every registered role except Administrator — as a map
		 * of slug => human-readable name.
		 *
		 * @return array<string,string>
		 */
		public static function editable_roles() {
			$roles = wp_roles()->get_names();
			unset( $roles['administrator'] );
			return array_map( 'translate_user_role', $roles );
		}

		/**
		 * Sanitize a raw settings payload from the Role Manager screen.
		 *
		 * Only known roles and known keys survive; access is whitelisted to a
		 * valid level and features are coerced to 0/1. Features are forced off
		 * for no-access roles so stored data can't imply a contradictory state.
		 *
		 * @param mixed $input Raw input (expected slug => settings map).
		 * @return array
		 */
		public static function sanitize( $input ) {
			$input = is_array( $input ) ? $input : array();
			$out   = array();

			foreach ( array_keys( self::editable_roles() ) as $role_slug ) {
				$row    = isset( $input[ $role_slug ] ) && is_array( $input[ $role_slug ] ) ? $input[ $role_slug ] : array();
				$access = isset( $row['access'] ) && in_array( $row['access'], self::ACCESS_LEVELS, true )
					? $row['access']
					: self::default_access_for_role( $role_slug );

				// A role with no `edit_posts` has nothing to edit, so an editor level
				// on it is unreachable state. Clamped here as well as hidden in the
				// UI, so a payload from an older build (or a hand-rolled POST) cannot
				// leave a Subscriber stored as "full".
				if ( 'none' !== $access && ! self::role_can_edit( $role_slug ) ) {
					$access = 'none';
				}

				$entry = array( 'access' => $access );
				foreach ( self::FEATURES as $feature ) {
					// Feature surfaces (design system, theme builder, AI chat) require
					// FULL editor access. A "content only" role is explicitly limited to
					// text/images — "no design, code or globals" — so features can never
					// be stored for anything below full access.
					$entry[ $feature ] = ( 'full' === $access && ! empty( $row[ $feature ] ) ) ? 1 : 0;
				}
				$out[ $role_slug ] = $entry;
			}

			return $out;
		}

		/* ── Internals ────────────────────────────────────────────────────── */

		/**
		 * Comparison rank for an access level (higher = more permissive).
		 *
		 * @param string $access Access level.
		 * @return int
		 */
		private static function rank( $access ) {
			$idx = array_search( $access, self::ACCESS_LEVELS, true );
			return false === $idx ? 0 : (int) $idx;
		}

		/**
		 * Normalise a user argument to a WP_User (or null).
		 *
		 * @param int|WP_User|null $user User, user ID, or null for current user.
		 * @return WP_User|null
		 */
		private static function resolve_user( $user ) {
			if ( null === $user ) {
				return wp_get_current_user();
			}
			if ( $user instanceof WP_User ) {
				return $user;
			}
			$resolved = get_user_by( 'id', (int) $user );
			return $resolved ? $resolved : null;
		}
	}
}
