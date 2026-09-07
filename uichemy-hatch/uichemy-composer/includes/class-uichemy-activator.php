<?php

/**
 * Fired during plugin activation
 *
 * @link       https://posimyth.com
 * @since      1.0.0
 *
 * @package    UiChemy
 * @subpackage UiChemy/includes
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Fired during plugin activation.
 *
 * This class defines all code necessary to run during the plugin's activation.
 *
 * @since      1.0.0
 * @package    UiChemy
 * @subpackage UiChemy/includes
 * @author     Posimyth <posimyth@gmail.com>
 */
class UiChemy_Activator {

	/**
	 * Runs on plugin activation.
	 *
	 * Installs the AI Chat database tables and upload directories when this build
	 * ships chat, and the form-submission tables always.
	 *
	 * @since    1.0.0
	 */
	public static function activate() {
		// AI Chat is Pro-only, so includes/chat/ does not exist in the free build.
		// These were plain require_once calls, and require_once on a missing file is
		// FATAL — it made the free plugin impossible to activate and left the
		// class_exists() guards below unreachable. Check the file first so each build
		// installs only what it actually ships.
		foreach ( array( 'class-uichemy-chat-db.php', 'class-uichemy-chat-uploads.php' ) as $chat_file ) {
			$chat_path = UICHEMY_PATH . 'includes/chat/' . $chat_file;
			if ( file_exists( $chat_path ) ) {
				require_once $chat_path;
			}
		}

		if ( class_exists( 'UiChemy_Chat_DB' ) ) {
			UiChemy_Chat_DB::install();
		}

		if ( class_exists( 'UiChemy_Chat_Uploads' ) ) {
			UiChemy_Chat_Uploads::ensure_directories();
		}

		// Dynamic-data forms — submission storage tables.
		require_once UICHEMY_PATH . 'includes/forms/class-uich-forms-db.php';
		if ( class_exists( 'Uich_Forms_DB' ) ) {
			Uich_Forms_DB::install();
		}
	}

}
