<?php
/**
 * Form Submissions — dashboard AJAX endpoint.
 *
 * Serves the Atom form submissions to the React admin dashboard (the
 * "Form Submissions" screen), so submissions live INSIDE the UiChemy dashboard
 * instead of the separate wp-admin list-table page. Mirrors the
 * uichemy_dashboard / uichemy_theme_builder AJAX pattern: one action, dispatched
 * on `type`, guarded by the shared dashboard nonce + manage_options.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Forms_Dashboard' ) ) {

	class Uich_Forms_Dashboard {

		/** Max submissions returned per list request. */
		const LIST_LIMIT = 300;

		/** admin-post action backing the screen's CSV export. */
		const EXPORT_ACTION = 'uich_forms_export';

		/** Register the AJAX action + the CSV export endpoint. */
		public static function init() {
			add_action( 'wp_ajax_uichemy_forms', array( __CLASS__, 'ajax' ) );
			// A file download can't come back through admin-ajax as JSON — the
			// browser has to be navigated at it — so export is its own endpoint.
			add_action( 'admin_post_' . self::EXPORT_ACTION, array( __CLASS__, 'export_csv' ) );
		}

		/** Router — mirrors UiChemy_Theme_Builder_Admin::ajax(). */
		public static function ajax() {
			check_ajax_referer( 'uichemy_dashboard', 'nonce' );

			if ( ! current_user_can( 'manage_options' ) ) {
				wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
			}
			if ( ! class_exists( 'Uich_Forms_DB' ) ) {
				wp_send_json_error( array( 'message' => 'Forms are disabled.' ), 400 );
			}

			$type = isset( $_POST['type'] ) ? sanitize_key( wp_unslash( $_POST['type'] ) ) : '';

			switch ( $type ) {
				case 'list':
					self::handle_list();
					break;
				case 'view':
					self::handle_view();
					break;
				case 'set_read':
					self::handle_set_read();
					break;
				case 'delete':
					self::handle_delete();
					break;
				default:
					wp_send_json_error( array( 'message' => 'unknown type' ), 400 );
			}
		}

		/** Read the posted `ids` (JSON array) as a clean int list. */
		private static function posted_ids() {
			$raw = isset( $_POST['ids'] ) ? wp_unslash( $_POST['ids'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.NonceVerification.Missing -- Nonce/capability verified at AJAX handler entry; decoded as JSON and cast to a positive-int list below.
			$arr = is_array( $raw ) ? $raw : json_decode( (string) $raw, true );
			$ids = array();
			foreach ( (array) $arr as $v ) {
				$id = (int) $v;
				if ( $id > 0 ) {
					$ids[] = $id;
				}
			}
			return array_values( array_unique( $ids ) );
		}

		/** Best email for a submission (prefers a key containing "email"). */
		private static function submission_email( $values ) {
			$fallback = '';
			foreach ( (array) $values as $k => $v ) {
				if ( is_string( $v ) && is_email( $v ) ) {
					if ( false !== stripos( (string) $k, 'email' ) ) {
						return $v;
					}
					if ( '' === $fallback ) {
						$fallback = $v;
					}
				}
			}
			return $fallback;
		}

		/** A short one-line preview of a submission's field values. */
		private static function submission_preview( $values ) {
			$parts = array();
			foreach ( (array) $values as $k => $v ) {
				$v = trim( wp_strip_all_tags( (string) $v ) );
				if ( '' === $v ) {
					continue;
				}
				$parts[] = ( '' !== (string) $k ? $k . ': ' : '' ) . $v;
				if ( count( $parts ) >= 3 ) {
					break;
				}
			}
			$s = implode( ' · ', $parts );
			return ( mb_strlen( $s ) > 140 ) ? ( mb_substr( $s, 0, 140 ) . '…' ) : $s;
		}

		/** Shape one submission row for the dashboard (list card). */
		private static function shape_row( $item ) {
			$id       = (int) $item->id;
			$values   = Uich_Forms_DB::get_values( $id );
			$post_id  = (int) $item->post_id;
			$page     = '';
			$page_url = '';
			$edit_url = '';
			if ( $post_id ) {
				$title    = get_the_title( $post_id );
				$page     = $title ? $title : ( '#' . $post_id );
				$page_url = (string) get_permalink( $post_id );
				$edit_url = admin_url( 'post.php?post=' . $post_id . '&action=elementor' );
			}
			$ts = strtotime( (string) $item->created_at );
			return array(
				'id'        => $id,
				'formKey'   => (string) $item->form_key,
				'formName'  => $item->form_name ? (string) $item->form_name : (string) $item->form_key,
				'postId'    => $post_id,
				'page'      => $page,
				'pageUrl'   => $page_url,
				'editUrl'   => $edit_url,
				'email'     => self::submission_email( $values ),
				'preview'   => self::submission_preview( $values ),
				'isRead'    => ! empty( $item->is_read ),
				'createdAt' => $ts ? date_i18n( 'M j, Y g:i a', $ts ) : (string) $item->created_at,
				'createdTs' => $ts ? (int) $ts : 0,
			);
		}

		/**
		 * The WHERE clause behind the screen's two filters, as ( $sql, $params ).
		 *
		 * Shared by the list and the CSV export on purpose: "export what I am
		 * looking at" is only true while both build the same query, and an empty
		 * $form_key means every form — which is what makes "All forms" export
		 * into one file.
		 *
		 * @param string $form_key Form to limit to, '' for all forms.
		 * @param string $status   'all' | 'unread' | 'read'.
		 * @return array{0:string,1:array}
		 */
		private static function filter_where( $form_key, $status ) {
			$where  = '1=1';
			$params = array();

			if ( '' !== (string) $form_key ) {
				$where   .= ' AND form_key = %s';
				$params[] = (string) $form_key;
			}
			if ( 'unread' === $status ) {
				$where .= ' AND is_read = 0';
			} elseif ( 'read' === $status ) {
				$where .= ' AND is_read = 1';
			}

			return array( $where, $params );
		}

		/** list — forms (for the filter) + submissions for the selected form. */
		private static function handle_list() {
			global $wpdb;

			$form_key = isset( $_POST['form_key'] ) ? sanitize_text_field( wp_unslash( $_POST['form_key'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
			$status   = isset( $_POST['status'] ) ? sanitize_key( wp_unslash( $_POST['status'] ) ) : 'all';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.

			$forms = array();
			foreach ( (array) Uich_Forms_DB::get_forms() as $f ) {
				$forms[] = array(
					'key'    => (string) $f->form_key,
					'name'   => $f->form_name ? (string) $f->form_name : (string) $f->form_key,
					'total'  => (int) $f->total,
					'unread' => (int) $f->unread,
				);
			}

			$t                      = Uich_Forms_DB::table_submissions();
			list( $where, $params ) = self::filter_where( $form_key, $status );
			$params[]               = self::LIST_LIMIT;

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; $where placeholders + LIMIT are bound via prepare().
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `{$t}` WHERE {$where} ORDER BY created_at DESC LIMIT %d", $params ) );

			$subs = array();
			foreach ( (array) $rows as $r ) {
				$subs[] = self::shape_row( $r );
			}

			wp_send_json_success(
				array(
					'forms'       => $forms,
					'submissions' => $subs,
				)
			);
		}

		/** view — a single submission with every field value. */
		private static function handle_view() {
			$id   = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
			$item = $id ? Uich_Forms_DB::get_submission( $id ) : null;
			if ( ! $item ) {
				wp_send_json_error( array( 'message' => 'Submission not found.' ), 404 );
			}

			// Mark as read on open (matches the classic view behaviour).
			if ( empty( $item->is_read ) ) {
				Uich_Forms_DB::mark_read( $id );
			}

			$values = Uich_Forms_DB::get_values( $id );
			$fields = array();
			foreach ( (array) $values as $k => $v ) {
				$fields[] = array(
					'key'   => (string) $k,
					'value' => (string) $v,
				);
			}

			$row            = self::shape_row( $item );
			$row['isRead']  = true; // just marked read
			$row['fields']  = $fields;
			$row['ip']      = (string) $item->user_ip;
			$row['referer'] = (string) $item->referer;

			wp_send_json_success( $row );
		}

		/** set_read — mark ids read/unread. */
		private static function handle_set_read() {
			$ids  = self::posted_ids();
			$read = isset( $_POST['read'] ) ? (int) $_POST['read'] : 1;  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
			if ( $ids ) {
				Uich_Forms_DB::set_read( $ids, $read ? 1 : 0 );
			}
			wp_send_json_success(
				array(
					'ids'  => $ids,
					'read' => $read ? 1 : 0,
				)
			);
		}

		/** delete — permanently remove ids. */
		private static function handle_delete() {
			$ids = self::posted_ids();
			if ( $ids ) {
				Uich_Forms_DB::delete( $ids );
			}
			wp_send_json_success( array( 'ids' => $ids ) );
		}

		/**
		 * The URL the dashboard's export menu points at.
		 *
		 * Carries the dashboard nonce rather than a fresh one so the React screen
		 * can build the link from the payload it already has (`data.nonce`), with
		 * no extra field to keep in sync.
		 *
		 * @return string
		 */
		public static function export_url() {
			return add_query_arg(
				array(
					'action' => self::EXPORT_ACTION,
					'nonce'  => wp_create_nonce( 'uichemy_dashboard' ),
				),
				admin_url( 'admin-post.php' )
			);
		}

		/**
		 * CSV export for the dashboard screen.
		 *
		 * Honours the same two filters the list does: `form_key` limits the file
		 * to one form, and omitting it exports EVERY form into a single CSV
		 * (columns are the union of all field keys, so forms with different
		 * fields still line up — see Uich_Forms_Admin::stream_csv). `status`
		 * narrows to read/unread the same way.
		 *
		 * @return void
		 */
		public static function export_csv() {
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_die( esc_html__( 'Permission denied.', 'uichemy' ), 403 );
			}

			$nonce = isset( $_GET['nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['nonce'] ) ) : '';
			if ( ! wp_verify_nonce( $nonce, 'uichemy_dashboard' ) ) {
				wp_die( esc_html__( 'This export link has expired. Reload the dashboard and try again.', 'uichemy' ), 403 );
			}

			// stream_csv() lives on the classic-list class, which only loads in
			// admin context. admin-post.php IS admin context, so this holds — but
			// fail with a readable message rather than a fatal if that changes.
			if ( ! class_exists( 'Uich_Forms_DB' ) || ! class_exists( 'Uich_Forms_Admin' ) ) {
				wp_die( esc_html__( 'Forms are disabled.', 'uichemy' ), 400 );
			}

			global $wpdb;

			$form_key = isset( $_GET['form_key'] ) ? sanitize_text_field( wp_unslash( $_GET['form_key'] ) ) : '';
			$status   = isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : 'all';

			$t                      = Uich_Forms_DB::table_submissions();
			list( $where, $params ) = self::filter_where( $form_key, $status );

			// No LIMIT here: the list caps at LIST_LIMIT for render cost, but an
			// export that silently dropped rows past 300 would be a data-loss bug.
			$sql = "SELECT id FROM `{$t}` WHERE {$where} ORDER BY created_at DESC";
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; $where placeholders are bound via prepare().
			$ids = $params ? $wpdb->get_col( $wpdb->prepare( $sql, $params ) ) : $wpdb->get_col( $sql );

			Uich_Forms_Admin::stream_csv( array_map( 'intval', $ids ), self::export_filename( $form_key, $status ) );
		}

		/**
		 * Filename for an export, so the downloads folder says what each file is
		 * instead of collecting identically-named CSVs.
		 *
		 * @param string $form_key Form the export was limited to, '' for all.
		 * @param string $status   Status filter in force.
		 * @return string
		 */
		private static function export_filename( $form_key, $status ) {
			$parts = array( 'uichemy-submissions' );

			if ( '' !== (string) $form_key ) {
				$name = '';
				foreach ( (array) Uich_Forms_DB::get_forms() as $f ) {
					if ( (string) $f->form_key === (string) $form_key ) {
						$name = $f->form_name ? (string) $f->form_name : (string) $f->form_key;
						break;
					}
				}
				$slug = sanitize_title( '' !== $name ? $name : $form_key );
				if ( '' !== $slug ) {
					$parts[] = $slug;
				}
			} else {
				$parts[] = 'all-forms';
			}

			if ( 'unread' === $status || 'read' === $status ) {
				$parts[] = $status;
			}

			$parts[] = gmdate( 'Y-m-d' );

			return implode( '-', $parts ) . '.csv';
		}
	}
}
