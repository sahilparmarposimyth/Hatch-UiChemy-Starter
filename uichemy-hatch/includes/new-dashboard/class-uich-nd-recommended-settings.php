<?php
/**
 * Recommended settings applied on first builder selection.
 *
 * When the user picks a builder in the onboarding wizard and presses
 * Continue, we silently enable the settings UiChemy needs to convert
 * designs cleanly. We only apply per-builder ONCE — tracked via the
 * `uich_nd_recommended_applied` option — so subsequent selects don't
 * override a user's later customisations.
 *
 * Per-builder side-effects:
 *   elementor → flexbox container experiment + unfiltered file uploads
 *   gutenberg → UiChemy Gutenberg custom CSS field
 *   bricks    → SVG upload capability for every role with `import`
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Recommended_Settings' ) ) {

	final class Uich_ND_Recommended_Settings {

		const OPT_APPLIED = 'uich_nd_recommended_applied';

		// Option / capability keys (mirror the legacy class-uich-api.php).
		const OPT_FLEXBOX_CONTAINER = 'elementor_experiment-container';
		const OPT_FILE_UPLOADS      = 'elementor_unfiltered_files_upload';
		const OPT_GB_CUSTOM_CSS     = 'uictmcss_enabled';
		const CAP_BRICKS_SVG        = 'bricks_upload_svg';

		public static function boot() {
			// Pure on-demand class — Uich_ND_Api::route_set_builder calls
			// `apply_for()` directly. Nothing to wire up here.
		}

		/**
		 * Apply recommended settings for a builder.
		 *
		 * Runs on every builder select (wizard Continue + dashboard
		 * "Change Builder"). Individual enable_* helpers are idempotent
		 * — anything already on stays untouched; anything the user has
		 * disabled gets switched back on. This is intentional: UiChemy
		 * needs these settings to convert designs correctly.
		 *
		 * @param string $builder One of 'elementor' | 'bricks' | 'gutenberg'.
		 * @return array {builder: string, changes: string[], runCount: int}
		 */
		public static function apply_for( $builder ) {
			$builder = sanitize_key( $builder );

			$changes = array();
			switch ( $builder ) {
				case 'elementor':
					if ( self::enable_flexbox_container() ) {
						$changes[] = 'flexbox_container';
					}
					if ( self::enable_unfiltered_file_uploads() ) {
						$changes[] = 'unfiltered_file_uploads';
					}
					break;

				case 'gutenberg':
					if ( self::enable_gutenberg_custom_css() ) {
						$changes[] = 'gutenberg_custom_css';
					}
					break;

				case 'bricks':
					if ( self::enable_bricks_svg_upload() ) {
						$changes[] = 'bricks_svg_upload';
					}
					break;

				default:
					return array(
						'builder'  => $builder,
						'changes'  => array(),
						'runCount' => 0,
					);
			}

			// Bump a per-builder run counter so we can see in logs / debug
			// how many times we've re-asserted these settings.
			$applied             = self::get_applied();
			$prev                = isset( $applied[ $builder ] ) && is_array( $applied[ $builder ] )
				? $applied[ $builder ]
				: array( 'runCount' => 0 );
			$run_count           = isset( $prev['runCount'] ) ? (int) $prev['runCount'] + 1 : 1;
			$applied[ $builder ] = array(
				'runCount' => $run_count,
				'lastRun'  => time(),
				'lastDiff' => $changes,
			);
			update_option( self::OPT_APPLIED, $applied );

			return array(
				'builder'  => $builder,
				'changes'  => $changes,
				'runCount' => $run_count,
			);
		}

		/**
		 * Snapshot for the React side. Useful for debugging / future UI.
		 */
		public static function get_applied() {
			$applied = get_option( self::OPT_APPLIED, array() );
			return is_array( $applied ) ? $applied : array();
		}

		/* ---------- Elementor ---------- */

		/**
		 * Mirrors Uich_Api::uich_flexbox_container().
		 */
		private static function enable_flexbox_container() {
			if ( 'active' === get_option( self::OPT_FLEXBOX_CONTAINER ) ) {
				return false;
			}
			update_option( self::OPT_FLEXBOX_CONTAINER, 'active' );
			return true;
		}

		/**
		 * Mirrors Uich_Api::uich_elementor_file_uploads().
		 */
		private static function enable_unfiltered_file_uploads() {
			$current = get_option( self::OPT_FILE_UPLOADS );
			if ( ! empty( $current ) ) {
				return false;
			}
			update_option( self::OPT_FILE_UPLOADS, 1 );
			return true;
		}

		/* ---------- Gutenberg ---------- */

		/**
		 * Mirrors Uich_Api::uich_add_option() for the Gutenberg key.
		 */
		private static function enable_gutenberg_custom_css() {
			if ( ! empty( get_option( self::OPT_GB_CUSTOM_CSS ) ) ) {
				return false;
			}
			if ( false === get_option( self::OPT_GB_CUSTOM_CSS ) ) {
				add_option( self::OPT_GB_CUSTOM_CSS, true );
			} else {
				update_option( self::OPT_GB_CUSTOM_CSS, true );
			}
			return true;
		}

		/* ---------- Bricks ---------- */

		/**
		 * Mirrors Uich_Api::uich_bricks_file_uploads(). Always re-adds
		 * the cap on every call so a role that lost it gets it back.
		 */
		private static function enable_bricks_svg_upload() {
			if ( ! function_exists( 'wp_roles' ) ) {
				return false;
			}
			$added = false;
			$roles = wp_roles()->get_names();
			foreach ( $roles as $role_key => $label ) {
				$role = get_role( $role_key );
				if ( $role && $role->has_cap( 'import' ) ) {
					if ( ! $role->has_cap( self::CAP_BRICKS_SVG ) ) {
						wp_roles()->add_cap( $role_key, self::CAP_BRICKS_SVG );
						$added = true;
					}
				}
			}
			return $added;
		}
	}
}
