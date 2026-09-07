<?php
/**
 * Uich_Forms_DB — submission storage for Atom forms.
 *
 * Mirrors Elementor Pro's proven design: one row per submission + a key/value table for the
 * field values (so any set of fields works with no schema changes). Field labels/types are
 * stored in the submission's `fields_snapshot` JSON so the admin columns survive HTML edits.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Forms_DB' ) ) {
	class Uich_Forms_DB {

		const DB_VERSION = '1.2.0';

		public static function table_submissions() {
			global $wpdb;
			return $wpdb->prefix . 'uich_submissions';
		}

		public static function table_values() {
			global $wpdb;
			return $wpdb->prefix . 'uich_submission_values';
		}

		/** Create tables. Called on activation and on version bump. */
		public static function install() {
			global $wpdb;
			$charset_collate = $wpdb->get_charset_collate();
			$subs            = self::table_submissions();
			$vals            = self::table_values();

			$sql_subs = "CREATE TABLE `{$subs}` (
				id bigint(20) unsigned auto_increment primary key,
				form_key varchar(80) not null,
				form_name varchar(190) not null,
				widget_id varchar(40) not null,
				post_id bigint(20) unsigned not null default 0,
				status varchar(20) not null default 'unread',
				is_read tinyint(1) not null default 0,
				user_id bigint(20) unsigned not null default 0,
				user_ip varchar(46) not null default '',
				user_agent text null,
				referer varchar(500) not null default '',
				fields_snapshot longtext null,
				actions_log longtext null,
				meta longtext null,
				created_at datetime not null,
				updated_at datetime null default null,
				KEY form_key_index (form_key),
				KEY status_index (status),
				KEY is_read_index (is_read),
				KEY post_id_index (post_id),
				KEY created_at_index (created_at)
			) {$charset_collate};";

			$sql_vals = "CREATE TABLE `{$vals}` (
				id bigint(20) unsigned auto_increment primary key,
				submission_id bigint(20) unsigned not null default 0,
				`key` varchar(190) null,
				`value` longtext null,
				KEY submission_id_index (submission_id),
				KEY key_index (`key`)
			) {$charset_collate};";

			require_once ABSPATH . 'wp-admin/includes/upgrade.php';
			dbDelta( $sql_subs );
			dbDelta( $sql_vals );

			update_option( 'uich_forms_db_version', self::DB_VERSION );
		}

		public static function maybe_upgrade() {
			if ( get_option( 'uich_forms_db_version' ) !== self::DB_VERSION ) {
				self::install();
			}
			self::ensure_columns();
		}

		/**
		 * Guarantee columns dbDelta can miss (it ignores added columns on tables whose
		 * CREATE uses an inline PRIMARY KEY). Adds them with a plain ALTER if absent.
		 */
		private static function ensure_columns() {
			global $wpdb;
			$subs = self::table_submissions();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$has = $wpdb->get_var( $wpdb->prepare( 'SHOW COLUMNS FROM `' . $subs . '` LIKE %s', 'updated_at' ) );
			if ( ! $has ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
				$wpdb->query( "ALTER TABLE `{$subs}` ADD COLUMN updated_at datetime NULL DEFAULT NULL AFTER created_at" );
			}
		}

		/**
		 * Insert a submission + its field values.
		 *
		 * @param array $submission Row data for the submissions table.
		 * @param array $values     Map of field key => value.
		 * @return int Submission id (0 on failure).
		 */
		public static function add( array $submission, array $values ) {
			global $wpdb;

			$row = wp_parse_args(
				$submission,
				array(
					'form_key'        => '',
					'form_name'       => '',
					'widget_id'       => '',
					'post_id'         => 0,
					'status'          => 'unread',
					'user_id'         => get_current_user_id(),
					'user_ip'         => '',
					'user_agent'      => '',
					'referer'         => '',
					'fields_snapshot' => '',
					'meta'            => '',
					'created_at'      => current_time( 'mysql' ),
				)
			);

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$ok = $wpdb->insert( self::table_submissions(), $row );
			if ( ! $ok ) {
				return 0;
			}
			$submission_id = (int) $wpdb->insert_id;

			foreach ( $values as $key => $value ) {
				if ( is_array( $value ) ) {
					$value = implode( ', ', array_map( 'strval', $value ) );
				}
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$wpdb->insert(
					self::table_values(),
					array(
						'submission_id' => $submission_id,
						'key'           => substr( (string) $key, 0, 190 ),
						'value'         => (string) $value,
					)
				);
			}

			return $submission_id;
		}

		/** Distinct forms that have submissions, with total + unread counts. */
		public static function get_forms() {
			global $wpdb;
			$t = self::table_submissions();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			return $wpdb->get_results( "SELECT form_key, form_name, COUNT(*) AS total, SUM(is_read = 0) AS unread, MAX(created_at) AS last_at FROM `{$t}` GROUP BY form_key, form_name ORDER BY last_at DESC" );
		}

		/** Submissions for a form (most recent first), optionally filtered by read state. */
		public static function get_submissions( $form_key, $limit = 100, $offset = 0, $status = 'all' ) {
			global $wpdb;
			$t = self::table_submissions();
			if ( 'unread' === $status ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
				return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `{$t}` WHERE form_key = %s AND is_read = 0 ORDER BY created_at DESC LIMIT %d OFFSET %d", $form_key, $limit, $offset ) );
			}
			if ( 'read' === $status ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
				return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `{$t}` WHERE form_key = %s AND is_read = 1 ORDER BY created_at DESC LIMIT %d OFFSET %d", $form_key, $limit, $offset ) );
			}
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			return $wpdb->get_results(
				$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Trusted internal table name; all user values bound via prepare().
					"SELECT * FROM `{$t}` WHERE form_key = %s ORDER BY created_at DESC LIMIT %d OFFSET %d",
					$form_key,
					$limit,
					$offset
				)
			);
		}

		/** A single submission row, or null. */
		public static function get_submission( $id ) {
			global $wpdb;
			$t = self::table_submissions();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `{$t}` WHERE id = %d", (int) $id ) );
		}

		/** Mark a submission read (called when its detail view is opened). */
		public static function mark_read( $id ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->update(
				self::table_submissions(),
				array(
					'is_read' => 1,
					'status'  => 'read',
				),
				array( 'id' => (int) $id )
			);
		}

		/** Store the actions log (which actions ran + their status) for a submission. */
		public static function update_actions_log( $id, array $log ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->update( self::table_submissions(), array( 'actions_log' => wp_json_encode( $log ) ), array( 'id' => (int) $id ) );
		}

		/** Set the read/unread state for a set of submissions. */
		public static function set_read( array $ids, $read ) {
			global $wpdb;
			$ids = array_map( 'intval', $ids );
			if ( empty( $ids ) ) {
				return;
			}
			$val          = $read ? 1 : 0;
			$status       = $read ? 'read' : 'unread';
			$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
			$table        = self::table_submissions();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Custom submissions table; no object cache layer. Table name is a trusted $wpdb->prefix constant; all values bound via $wpdb->prepare().
			$wpdb->query(
				$wpdb->prepare( // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $placeholders is a runtime-built list of %d bound from $ids; the count matches at runtime, PCP cannot statically count dynamically-generated placeholders.
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is a trusted internal $wpdb->prefix name; $placeholders is a literal list of %d, and every value is bound below.
					"UPDATE `{$table}` SET is_read = %d, status = %s WHERE id IN ({$placeholders})",
					array_merge( array( $val, $status ), $ids )
				)
			);
		}

		/** Permanently delete a set of submissions + their field values. */
		public static function delete( array $ids ) {
			global $wpdb;
			$ids = array_map( 'intval', $ids );
			if ( empty( $ids ) ) {
				return;
			}
			$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
			$t_sub        = self::table_submissions();
			$t_val        = self::table_values();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Custom submissions table; no object cache layer. Table name is a trusted $wpdb->prefix constant; all values bound via $wpdb->prepare().
			$wpdb->query(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- Trusted internal table name; %d placeholders bind every id below; PCP cannot statically count dynamically-generated placeholders.
				$wpdb->prepare( "DELETE FROM `{$t_sub}` WHERE id IN ({$placeholders})", $ids )
			);
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Custom field-values table; no object cache layer. Table name is a trusted $wpdb->prefix constant; all values bound via $wpdb->prepare().
			$wpdb->query(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- Trusted internal table name; %d placeholders bind every id below; PCP cannot statically count dynamically-generated placeholders.
				$wpdb->prepare( "DELETE FROM `{$t_val}` WHERE submission_id IN ({$placeholders})", $ids )
			);
		}

		/** Update a single field value for a submission (used by the admin inline editor). */
		public static function set_value( $submission_id, $key, $value ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->update(
				self::table_values(),
				array( 'value' => (string) $value ),
				array(
					'submission_id' => (int) $submission_id,
					'key'           => substr( (string) $key, 0, 190 ),
				),
				array( '%s' ),
				array( '%d', '%s' )
			);
		}

		/** Stamp a submission's updated_at to now. */
		public static function touch_updated( $id ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->update( self::table_submissions(), array( 'updated_at' => current_time( 'mysql' ) ), array( 'id' => (int) $id ) );
		}

		/** Values for one submission as key => value. */
		public static function get_values( $submission_id ) {
			global $wpdb;
			$t = self::table_values();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT `key`, `value` FROM `{$t}` WHERE submission_id = %d", $submission_id ) );
			$out  = array();
			foreach ( $rows as $r ) {
				$out[ $r->key ] = $r->value;
			}
			return $out;
		}
	}
}
