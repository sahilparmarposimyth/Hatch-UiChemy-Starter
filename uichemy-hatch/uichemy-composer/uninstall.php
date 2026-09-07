<?php
/**
 * Fired when the plugin is uninstalled.
 *
 * UiChemy preserves all user data by default. Only when the site has enabled
 * "Delete all data on uninstall" (Settings screen → stored in
 * `uichemy_settings['delete_on_uninstall']`) does this file remove the data
 * UiChemy owns: its custom tables, options, transients, and chat upload
 * directory. On multisite the check + cleanup run per-site, so each site keeps
 * or removes its own data according to its own setting.
 *
 * Intentionally NOT removed: page content and theme-builder templates the user
 * created (Elementor post data / `uichemy_template` posts) — that is the user's
 * work, not plugin housekeeping.
 *
 * @link    https://posimyth.com
 * @package UiChemy
 */

// If uninstall not called from WordPress, then exit.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

if ( ! function_exists( 'uichemy_uninstall_cleanup_site' ) ) {
	/**
	 * Remove every UiChemy-owned datum for the CURRENT site, gated by that
	 * site's opt-in setting.
	 *
	 * @return void
	 */
	function uichemy_uninstall_cleanup_site() {
		global $wpdb;

		$settings = get_option( 'uichemy_settings', array() );
		if ( ! is_array( $settings ) || empty( $settings['delete_on_uninstall'] ) ) {
			return; // Default: keep all data.
		}

		// 1. Custom tables (chat + forms, including the legacy chat-settings table).
		$tables = array(
			$wpdb->prefix . 'uichemy_chat_conversations',
			$wpdb->prefix . 'uichemy_chat_messages',
			$wpdb->prefix . 'uichemy_chat_settings',
			$wpdb->prefix . 'uich_submissions',
			$wpdb->prefix . 'uich_submission_values',
		);
		foreach ( $tables as $table ) {
			// Table identifiers cannot be bound via prepare(); each is built from
			// the trusted $wpdb->prefix, not user input.
			$wpdb->query( "DROP TABLE IF EXISTS `{$table}`" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Table name built from trusted $wpdb->prefix; identifiers cannot be bound via prepare().
		}

		// 2. Options this plugin owns. Everything this plugin writes uses the
		// unambiguous `uichemy_` prefix (settings, white-label, role-manager,
		// globals, chat, composer_*, the v2→v3 migration flag, …), so delete those
		// by prefix rather than a hand-list that drifts out of date. The two
		// legacy-prefixed options the current code still writes are removed
		// explicitly.
		$like         = $wpdb->esc_like( 'uichemy_' ) . '%';
		$uichemy_opts = $wpdb->get_col( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $like )
		);
		foreach ( (array) $uichemy_opts as $option ) {
			delete_option( $option );
		}
		foreach ( array( 'uich_forms_db_version', 'uich_atomic_global_width_class_id' ) as $option ) {
			delete_option( $option );
		}
		// Intentionally NOT removed: pre-rename legacy options (uich_chat_*,
		// uich_elementor_custom_css, uich_nd_*). The current codebase does not
		// create them, so they can't be safely attributed to this plugin vs. a
		// sibling — deleting them could destroy another plugin's data.

		// 3. Transients UiChemy sets (upload slots + dynamic-data API cache).
		// They live as option rows; remove both the value and timeout rows.
		$wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE '\_transient\_uich\_upl\_%'
			 OR option_name LIKE '\_transient\_timeout\_uich\_upl\_%'
			 OR option_name LIKE '\_transient\_uich\_api\_%'
			 OR option_name LIKE '\_transient\_timeout\_uich\_api\_%'
			 OR option_name LIKE '\_transient\_uichemy\_selected\_el\_%'
			 OR option_name LIKE '\_transient\_timeout\_uichemy\_selected\_el\_%'"
		);

		// 4. Chat upload directory (uploads/uichemy/chat), then the parent if empty.
		$uploads = wp_upload_dir();
		if ( empty( $uploads['error'] ) && ! empty( $uploads['basedir'] ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			global $wp_filesystem;
			if ( WP_Filesystem() && $wp_filesystem ) {
				$chat_dir = trailingslashit( $uploads['basedir'] ) . 'uichemy/chat';
				if ( $wp_filesystem->is_dir( $chat_dir ) ) {
					$wp_filesystem->delete( $chat_dir, true );
				}
				$parent = trailingslashit( $uploads['basedir'] ) . 'uichemy';
				if ( $wp_filesystem->is_dir( $parent ) ) {
					$kids = $wp_filesystem->dirlist( $parent );
					if ( empty( $kids ) ) {
						$wp_filesystem->delete( $parent, false );
					}
				}
			}
		}
	}
}

if ( is_multisite() ) {
	$uichemy_site_ids = get_sites( array( 'fields' => 'ids', 'number' => 0 ) );
	foreach ( $uichemy_site_ids as $uichemy_site_id ) {
		switch_to_blog( (int) $uichemy_site_id );
		uichemy_uninstall_cleanup_site();
		restore_current_blog();
	}
} else {
	uichemy_uninstall_cleanup_site();
}
