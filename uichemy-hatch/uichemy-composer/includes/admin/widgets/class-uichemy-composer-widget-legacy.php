<?php
/**
 * Legacy aliases for the Composer widget.
 *
 * The widget type stored in `_elementor_data` is the content contract, and
 * Elementor renders an unregistered type as NOTHING AT ALL — no placeholder, no
 * error, just a gap where the section used to be. Renaming the widget therefore
 * orphans every row still holding an old name.
 *
 * Uich_Composer_Migration rewrites those rows, but not instantly: it is batched
 * (20 rows a slice) and driven by `admin_init` and wp-cron, so a large site can
 * sit part-migrated across several requests — and the FRONTEND never runs the
 * migration at all. Between the update landing and the last row being rewritten
 * there is a window in which visitors would see empty widgets. That window is
 * exactly what these aliases close.
 *
 * Each alias is the real widget with a different get_name(), hidden from the
 * panel so the picker still shows one "Composer". Content under either legacy
 * name keeps rendering identically; once the migration finishes, nothing matches
 * these types any more and they simply go unused.
 *
 * Two legacy names:
 *   proton          — every released Protuno wrote this. Customer sites have it.
 *   uichemy-builder — a development-only interim name that never shipped. Only
 *                     our own dev/staging sites have it.
 *
 * Keep this list in step with Uich_Composer_Migration::OLD_WIDGET / DEV_WIDGET.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/class-uichemy-composer-widget.php';

if ( ! class_exists( 'UiChemy_Composer_Widget_Legacy' ) ) {

	/**
	 * Shared behaviour: inherit the whole widget, change only the type, and stay
	 * out of the panel.
	 */
	abstract class UiChemy_Composer_Widget_Legacy extends \UiChemy_Composer_Widget {

		/**
		 * Every legacy widget type that must keep rendering, newest first.
		 *
		 * @return string[]
		 */
		public static function legacy_names() {
			return array( 'composer', 'uichemy-builder', 'proton' );
		}

		/**
		 * Hide from the widget picker.
		 *
		 * Without this the panel would list one entry per alias, all titled
		 * "Composer", and the user could insert content under a name the migration
		 * is actively trying to retire.
		 *
		 * @return bool
		 */
		public function show_in_panel() {
			return false;
		}

		/**
		 * Not searchable either — the primary widget covers discovery.
		 *
		 * @return string[]
		 */
		public function get_keywords() {
			return array();
		}
	}
}

if ( ! class_exists( 'UiChemy_Composer_Widget_Composer' ) ) {

	/**
	 * The second interim name, shipped in no release.
	 *
	 * REMOVABLE once every internal site has run Uich_Composer_Migration v2 —
	 * see the INTERIM_WIDGET note there. Delete this class, its registration in
	 * class-uichemy-composer-manager.php, and the matching entries in
	 * legacy_names() / uichemy_composer_widget_types().
	 */
	class UiChemy_Composer_Widget_Composer extends UiChemy_Composer_Widget_Legacy {

		public function get_name() {
			return 'composer';
		}
	}
}

if ( ! class_exists( 'UiChemy_Composer_Widget_Proton' ) ) {

	/** The type every released Protuno stored. */
	class UiChemy_Composer_Widget_Proton extends UiChemy_Composer_Widget_Legacy {

		public function get_name() {
			return 'proton';
		}
	}
}

if ( ! class_exists( 'UiChemy_Composer_Widget_Uichemy_Builder' ) ) {

	/** The interim development name that never shipped. */
	class UiChemy_Composer_Widget_Uichemy_Builder extends UiChemy_Composer_Widget_Legacy {

		public function get_name() {
			return 'uichemy-builder';
		}
	}
}
