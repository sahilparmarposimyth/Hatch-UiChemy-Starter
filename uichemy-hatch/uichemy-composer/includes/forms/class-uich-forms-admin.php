<?php
/**
 * Uich_Forms_Admin — "Atom Forms" submissions screen.
 *
 * A WP_List_Table-based submissions browser modelled on The Plus Addons' Form
 * Submissions design: a form-name dropdown + page + date-range + search filters,
 * status tabs, bulk actions, single-submission view with inline edit, and CSV
 * export (all/filtered + selected). Reads the existing uich_submissions tables.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'WP_List_Table' ) ) {
	require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

if ( ! class_exists( 'Uich_Submissions_List_Table' ) ) {

	/**
	 * Submissions list table.
	 */
	class Uich_Submissions_List_Table extends WP_List_Table {

		/** @var array<int,string> submission id => email value, filled in prepare_items(). */
		private $emails = array();

		/** @var array<int,array<string,string>> submission id => key=>value, filled in prepare_items(). */
		private $row_values = array();

		public function __construct() {
			parent::__construct(
				array(
					'singular' => 'submission',
					'plural'   => 'submissions',
					'ajax'     => false,
				)
			);
		}

		public function get_columns() {
			return array(
				'cb'           => '<input type="checkbox" />',
				'id'           => __( 'ID', 'uichemy' ),
				'form_name'    => __( 'Form Name', 'uichemy' ),
				'page'         => __( 'Page', 'uichemy' ),
				'email'        => __( 'Email', 'uichemy' ),
				'status'       => __( 'Status', 'uichemy' ),
				'created_at'   => __( 'Submitted At', 'uichemy' ),
				'uich_actions' => __( 'Actions', 'uichemy' ),
			);
		}

		public function get_sortable_columns() {
			return array(
				'id'         => array( 'id', false ),
				'created_at' => array( 'created_at', true ),
			);
		}

		protected function get_bulk_actions() {
			return array(
				'delete'      => __( 'Delete', 'uichemy' ),
				'export_csv'  => __( 'Export', 'uichemy' ),
				'mark_read'   => __( 'Mark as Read', 'uichemy' ),
				'mark_unread' => __( 'Mark as Unread', 'uichemy' ),
			);
		}

		/** All / Unread / Read tabs with counts. */
		protected function get_views() {
			global $wpdb;
			$t = Uich_Forms_DB::table_submissions();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$t}`" );
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$unread = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$t}` WHERE is_read = 0" );
			$read   = $total - $unread;

			$current = isset( $_REQUEST['status'] ) ? sanitize_key( wp_unslash( $_REQUEST['status'] ) ) : 'all'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			$base    = remove_query_arg( array( 'status', 'paged' ) );

			$make = function ( $key, $label, $count ) use ( $current, $base ) {
				$url = add_query_arg( 'status', $key, $base );
				return sprintf(
					'<a href="%s" class="%s">%s <span class="count">(%d)</span></a>',
					esc_url( $url ),
					( $current === $key ) ? 'current' : '',
					esc_html( $label ),
					$count
				);
			};

			return array(
				'all'    => $make( 'all', __( 'All', 'uichemy' ), $total ),
				'unread' => $make( 'unread', __( 'Unread', 'uichemy' ), $unread ),
				'read'   => $make( 'read', __( 'Read', 'uichemy' ), $read ),
			);
		}

		/** Build the WHERE clause + args from the active filters. */
		private function build_where() {
			global $wpdb;
			$where = array( '1=1' );
			$args  = array();

			$status = isset( $_REQUEST['status'] ) ? sanitize_key( wp_unslash( $_REQUEST['status'] ) ) : 'all'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			if ( 'unread' === $status ) {
				$where[] = 'is_read = 0';
			} elseif ( 'read' === $status ) {
				$where[] = 'is_read = 1';
			}

			$form = isset( $_REQUEST['filter_form'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['filter_form'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			if ( '' !== $form ) {
				$where[] = 'form_name = %s';
				$args[]  = $form;
			}

			$page_id = isset( $_REQUEST['filter_page'] ) ? absint( $_REQUEST['filter_page'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			if ( $page_id ) {
				$where[] = 'post_id = %d';
				$args[]  = $page_id;
			}

			$date = isset( $_REQUEST['date_filter'] ) ? sanitize_key( wp_unslash( $_REQUEST['date_filter'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			if ( 'today' === $date ) {
				$where[] = 'DATE(created_at) = %s';
				$args[]  = current_time( 'Y-m-d' );
			} elseif ( 'yesterday' === $date ) {
				$where[] = 'DATE(created_at) = %s';
				$args[]  = gmdate( 'Y-m-d', current_time( 'timestamp' ) - DAY_IN_SECONDS );
			} elseif ( 'last_7' === $date ) {
				$where[] = 'created_at >= %s';
				$args[]  = gmdate( 'Y-m-d 00:00:00', current_time( 'timestamp' ) - 7 * DAY_IN_SECONDS );
			} elseif ( 'last_30' === $date ) {
				$where[] = 'created_at >= %s';
				$args[]  = gmdate( 'Y-m-d 00:00:00', current_time( 'timestamp' ) - 30 * DAY_IN_SECONDS );
			} elseif ( 'custom' === $date ) {
				$from = isset( $_REQUEST['date_from'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['date_from'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
				$to   = isset( $_REQUEST['date_to'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['date_to'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
				if ( $from ) {
					$where[] = 'created_at >= %s';
					$args[]  = $from . ' 00:00:00';
				}
				if ( $to ) {
					$where[] = 'created_at <= %s';
					$args[]  = $to . ' 23:59:59';
				}
			}

			$search = isset( $_REQUEST['s'] ) ? trim( sanitize_text_field( wp_unslash( $_REQUEST['s'] ) ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			if ( '' !== $search ) {
				$vals    = Uich_Forms_DB::table_values();
				$like    = '%' . $wpdb->esc_like( $search ) . '%';
				$where[] = '(form_name LIKE %s OR CAST(id AS CHAR) LIKE %s OR id IN (SELECT submission_id FROM `' . $vals . '` WHERE `value` LIKE %s) OR post_id IN (SELECT ID FROM `' . $wpdb->posts . '` WHERE post_title LIKE %s))';
				$args[]  = $like;
				$args[]  = $like;
				$args[]  = $like;
				$args[]  = $like;
			}

			return array( implode( ' AND ', $where ), $args );
		}

		public function prepare_items() {
			global $wpdb;
			$t = Uich_Forms_DB::table_submissions();

			$this->process_bulk_action();

			list( $where, $where_args ) = $this->build_where();

			// Total for pagination.
			$count_sql = "SELECT COUNT(*) FROM `{$t}` WHERE {$where}";
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$total = (int) ( $where_args ? $wpdb->get_var( $wpdb->prepare( $count_sql, $where_args ) ) : $wpdb->get_var( $count_sql ) );

			$per_page = 20;
			$paged    = max( 1, (int) $this->get_pagenum() );
			$offset   = ( $paged - 1 ) * $per_page;

			// Sorting (whitelisted).
			$orderby = isset( $_REQUEST['orderby'] ) ? sanitize_key( wp_unslash( $_REQUEST['orderby'] ) ) : 'created_at'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			$orderby = in_array( $orderby, array( 'id', 'created_at' ), true ) ? $orderby : 'created_at';
			$order   = isset( $_REQUEST['order'] ) && 'asc' === sanitize_key( wp_unslash( $_REQUEST['order'] ) ) ? 'ASC' : 'DESC'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.

			$sql      = "SELECT * FROM `{$t}` WHERE {$where} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d";
			$run_args = array_merge( $where_args, array( $per_page, $offset ) );
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$items = $wpdb->get_results( $wpdb->prepare( $sql, $run_args ) );

			// Pull field values for the visible rows in one pass (for email + search-free render).
			$ids = wp_list_pluck( $items, 'id' );
			if ( ! empty( $ids ) ) {
				$vals_table = Uich_Forms_DB::table_values();
				$in         = implode( ',', array_map( 'intval', $ids ) );
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
				$rows = $wpdb->get_results( "SELECT submission_id, `key`, `value` FROM `{$vals_table}` WHERE submission_id IN ({$in})" );
				foreach ( $rows as $r ) {
					$sid                                 = (int) $r->submission_id;
					$this->row_values[ $sid ][ $r->key ] = $r->value;
					if ( ! isset( $this->emails[ $sid ] ) && false !== stripos( (string) $r->key, 'email' ) && '' !== trim( (string) $r->value ) ) {
						$this->emails[ $sid ] = (string) $r->value;
					}
				}
			}

			$this->_column_headers = array( $this->get_columns(), array(), $this->get_sortable_columns() );
			$this->items           = $items;
			$this->set_pagination_args(
				array(
					'total_items' => $total,
					'per_page'    => $per_page,
					'total_pages' => (int) ceil( $total / $per_page ),
				)
			);
		}

		protected function process_bulk_action() {
			$action = $this->current_action();
			if ( ! $action ) {
				return;
			}
			// WP_List_Table adds this nonce in display_tablenav().
			check_admin_referer( 'bulk-' . $this->_args['plural'] );

			$ids = isset( $_REQUEST['ids'] ) ? array_map( 'intval', (array) $_REQUEST['ids'] ) : array();
			if ( empty( $ids ) ) {
				return;
			}

			if ( 'delete' === $action ) {
				Uich_Forms_DB::delete( $ids );
			} elseif ( 'mark_read' === $action ) {
				Uich_Forms_DB::set_read( $ids, true );
			} elseif ( 'mark_unread' === $action ) {
				Uich_Forms_DB::set_read( $ids, false );
			} elseif ( 'export_csv' === $action ) {
				Uich_Forms_Admin::stream_csv( $ids );
			}
		}

		/* ── columns ─────────────────────────────────────────────────────────── */

		protected function column_cb( $item ) {
			return sprintf( '<input type="checkbox" name="ids[]" value="%d" />', (int) $item->id );
		}

		protected function column_id( $item ) {
			return (int) $item->id;
		}

		protected function column_form_name( $item ) {
			$name = $item->form_name ? $item->form_name : $item->form_key;
			$edit = $item->post_id ? admin_url( 'post.php?post=' . absint( $item->post_id ) . '&action=elementor' ) : '';
			$hash = ' <span style="color:#9ca3af">(#' . esc_html( substr( md5( (string) $item->widget_id ), 0, 7 ) ) . ')</span>';
			if ( $edit ) {
				return '<a href="' . esc_url( $edit ) . '" target="_blank">' . esc_html( $name ) . '</a>' . $hash;
			}
			return esc_html( $name ) . $hash;
		}

		protected function column_page( $item ) {
			if ( ! $item->post_id ) {
				return '&mdash;';
			}
			$title = get_the_title( $item->post_id );
			$title = $title ? $title : ( '#' . (int) $item->post_id );
			return '<a href="' . esc_url( (string) get_permalink( $item->post_id ) ) . '" target="_blank">' . esc_html( $title ) . '</a>';
		}

		protected function column_email( $item ) {
			$email = isset( $this->emails[ (int) $item->id ] ) ? $this->emails[ (int) $item->id ] : '';
			if ( '' === $email ) {
				return '&mdash;';
			}
			if ( is_email( $email ) ) {
				return '<a href="mailto:' . esc_attr( $email ) . '">' . esc_html( $email ) . '</a>';
			}
			return esc_html( $email );
		}

		protected function column_status( $item ) {
			if ( empty( $item->is_read ) ) {
				return '<span class="uich-status-badge uich-status-unread">' . esc_html__( 'Unread', 'uichemy' ) . '</span>';
			}
			return '<span class="uich-status-badge uich-status-read">' . esc_html__( 'Read', 'uichemy' ) . '</span>';
		}

		protected function column_created_at( $item ) {
			$ts = strtotime( (string) $item->created_at );
			return $ts ? esc_html( date_i18n( 'M j, Y g:i a', $ts ) ) : esc_html( (string) $item->created_at );
		}

		protected function column_uich_actions( $item ) {
			$id   = (int) $item->id;
			$view = add_query_arg(
				array(
					'page' => Uich_Forms_Admin::PAGE,
					'view' => $id,
				),
				admin_url( 'admin.php' )
			);

			$html = '<a href="' . esc_url( $view ) . '" class="uich-action-btn uich-btn-view">' . esc_html__( 'View', 'uichemy' ) . '</a>';

			if ( empty( $item->is_read ) ) {
				$mr    = wp_nonce_url(
					add_query_arg(
						array(
							'page'      => Uich_Forms_Admin::PAGE,
							'uich_mark' => 'read',
							'id'        => $id,
						),
						admin_url( 'admin.php' )
					),
					'uich_mark_' . $id
				);
				$html .= '<a href="' . esc_url( $mr ) . '" class="uich-action-btn uich-btn-mark">' . esc_html__( 'Mark as Read', 'uichemy' ) . '</a>';
			} else {
				$mu    = wp_nonce_url(
					add_query_arg(
						array(
							'page'      => Uich_Forms_Admin::PAGE,
							'uich_mark' => 'unread',
							'id'        => $id,
						),
						admin_url( 'admin.php' )
					),
					'uich_mark_' . $id
				);
				$html .= '<a href="' . esc_url( $mu ) . '" class="uich-action-btn uich-btn-mark">' . esc_html__( 'Mark as Unread', 'uichemy' ) . '</a>';
			}

			$del   = wp_nonce_url(
				add_query_arg(
					array(
						'page'        => Uich_Forms_Admin::PAGE,
						'uich_delete' => $id,
					),
					admin_url( 'admin.php' )
				),
				'uich_delete_' . $id
			);
			$html .= '<a href="' . esc_url( $del ) . '" class="uich-action-btn uich-btn-delete" onclick="return confirm(\'' . esc_js( __( 'Delete this submission permanently?', 'uichemy' ) ) . '\');">' . esc_html__( 'Delete', 'uichemy' ) . '</a>';

			return $html;
		}

		/** Filter bar (form/page/date/search) + export button — top only. */
		protected function extra_tablenav( $which ) {
			if ( 'top' !== $which ) {
				return;
			}
			global $wpdb;
			$t = Uich_Forms_DB::table_submissions();

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$forms = $wpdb->get_col( "SELECT DISTINCT form_name FROM `{$t}` WHERE form_name <> '' ORDER BY form_name ASC" );
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$page_ids = $wpdb->get_col( "SELECT DISTINCT post_id FROM `{$t}` WHERE post_id > 0" );

			$cur_form = isset( $_REQUEST['filter_form'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['filter_form'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			$cur_page = isset( $_REQUEST['filter_page'] ) ? absint( $_REQUEST['filter_page'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			$cur_date = isset( $_REQUEST['date_filter'] ) ? sanitize_key( wp_unslash( $_REQUEST['date_filter'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			$cur_from = isset( $_REQUEST['date_from'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['date_from'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			$cur_to   = isset( $_REQUEST['date_to'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['date_to'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			$cur_s    = isset( $_REQUEST['s'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['s'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.

			echo '<div class="alignleft actions uich-filter-actions">';

			echo '<select name="filter_form" class="uich-select"><option value="">' . esc_html__( 'All Forms', 'uichemy' ) . '</option>';
			foreach ( $forms as $f ) {
				printf( '<option value="%s" %s>%s</option>', esc_attr( $f ), selected( $cur_form, $f, false ), esc_html( $f ) );
			}
			echo '</select>';

			echo '<select name="filter_page" class="uich-select"><option value="">' . esc_html__( 'All Pages', 'uichemy' ) . '</option>';
			foreach ( $page_ids as $pid ) {
				$title = get_the_title( $pid );
				$title = $title ? $title : ( '#' . (int) $pid );
				printf( '<option value="%d" %s>%s</option>', (int) $pid, selected( $cur_page, (int) $pid, false ), esc_html( $title ) );
			}
			echo '</select>';

			echo '<select name="date_filter" id="uich-date-filter-select" class="uich-select">';
			$date_opts = array(
				''          => __( 'All Time', 'uichemy' ),
				'today'     => __( 'Today', 'uichemy' ),
				'yesterday' => __( 'Yesterday', 'uichemy' ),
				'last_7'    => __( 'Last 7 Days', 'uichemy' ),
				'last_30'   => __( 'Last 30 Days', 'uichemy' ),
				'custom'    => __( 'Custom', 'uichemy' ),
			);
			foreach ( $date_opts as $k => $label ) {
				printf( '<option value="%s" %s>%s</option>', esc_attr( $k ), selected( $cur_date, $k, false ), esc_html( $label ) );
			}
			echo '</select>';

			$custom_style = ( 'custom' === $cur_date ) ? '' : 'display:none;';
			echo '<span id="uich-custom-date" style="' . esc_attr( $custom_style ) . '">';
			echo '<input type="date" name="date_from" class="uich-date-field" value="' . esc_attr( $cur_from ) . '" />';
			echo '<input type="date" name="date_to" class="uich-date-field" value="' . esc_attr( $cur_to ) . '" />';
			echo '</span>';

			echo '<button type="submit" class="uich-filter-apply-btn">' . esc_html__( 'Apply', 'uichemy' ) . '</button>';

			echo '</div>';

			// Right side: search + export.
			echo '<div class="uich-filter-right">';
			echo '<span class="uich-search-wrap">';
			echo '<svg class="uich-search-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
			echo '<input type="search" name="s" class="uich-search-field" placeholder="' . esc_attr__( 'Search submissions', 'uichemy' ) . '" value="' . esc_attr( $cur_s ) . '" />';
			echo '</span>';

			$export_url = wp_nonce_url(
				add_query_arg(
					array_filter(
						array(
							'action'      => 'uich_export_all_submissions',
							'filter_form' => $cur_form,
							'filter_page' => $cur_page ? $cur_page : null,
							'date_filter' => $cur_date,
							'date_from'   => $cur_from,
							'date_to'     => $cur_to,
							's'           => $cur_s,
							'status'      => isset( $_REQUEST['status'] ) ? sanitize_key( wp_unslash( $_REQUEST['status'] ) ) : null, // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
						)
					),
					admin_url( 'admin-post.php' )
				),
				'uich_export_all'
			);
			echo '<a href="' . esc_url( $export_url ) . '" class="uich-export-btn">' . esc_html__( 'Export CSV', 'uichemy' ) . '</a>';
			echo '</div>';
		}

		public function no_items() {
			esc_html_e( 'No submissions found.', 'uichemy' );
		}
	}
}

if ( ! class_exists( 'Uich_Forms_Admin' ) ) {
	class Uich_Forms_Admin {

		const PAGE = 'uich-atom-forms';

		public static function init() {
			// The submissions screen is registered as the "Form Submissions"
			// submenu under the UiChemy menu (see UiChemy_Admin_Menu). We only
			// wire the request handlers and AJAX here.
			add_action( 'admin_init', array( __CLASS__, 'maybe_handle_single_actions' ) );
			add_action( 'admin_post_uich_export_all_submissions', array( __CLASS__, 'export_all' ) );
			add_action( 'wp_ajax_uich_update_submission', array( __CLASS__, 'ajax_update_submission' ) );
			add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_admin_assets' ) );
		}

		/** Single-row mark-read/unread/delete (GET nonce links from the Actions column). */
		public static function maybe_handle_single_actions() {
			if ( ! is_admin() || ! current_user_can( 'manage_options' ) ) {
				return;
			}
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			if ( empty( $_GET['page'] ) || self::PAGE !== $_GET['page'] ) {
				return;
			}

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			if ( ! empty( $_GET['uich_mark'] ) && ! empty( $_GET['id'] ) ) {
				$id = (int) $_GET['id'];
				check_admin_referer( 'uich_mark_' . $id );
				$read = ( 'read' === sanitize_key( wp_unslash( $_GET['uich_mark'] ) ) );
				Uich_Forms_DB::set_read( array( $id ), $read );
				wp_safe_redirect( remove_query_arg( array( 'uich_mark', 'id', '_wpnonce' ) ) );
				exit;
			}

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			if ( ! empty( $_GET['uich_delete'] ) ) {
				$id = (int) $_GET['uich_delete'];
				check_admin_referer( 'uich_delete_' . $id );
				Uich_Forms_DB::delete( array( $id ) );
				wp_safe_redirect( remove_query_arg( array( 'uich_delete', 'view', '_wpnonce' ) ) );
				exit;
			}
		}

		public static function render() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			Uich_Forms_DB::maybe_upgrade();

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			if ( ! empty( $_GET['view'] ) ) {
				self::render_view( (int) $_GET['view'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
				return;
			}

			$table = new Uich_Submissions_List_Table();
			$table->prepare_items();

			echo '<div class="wrap" id="uich-submissions-page">';
			echo '<h1 class="wp-heading-inline">' . esc_html__( 'Form Submissions', 'uichemy' ) . '</h1>';
			echo '<hr class="wp-header-end">';

			$table->views();

			echo '<form method="get">';
			echo '<input type="hidden" name="page" value="' . esc_attr( self::PAGE ) . '">';
			if ( isset( $_REQUEST['status'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
				echo '<input type="hidden" name="status" value="' . esc_attr( sanitize_key( wp_unslash( $_REQUEST['status'] ) ) ) . '">'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only list-table display filter (GET), no state change; state-changing actions are separately nonce-verified.
			}
			echo '<div class="uich-table-card">';
			$table->display();
			echo '</div>';
			echo '</form>';
			echo '</div>';
		}

		/* ── single submission view + inline edit ──────────────────────────────── */

		public static function render_view( $id ) {
			$s = Uich_Forms_DB::get_submission( $id );
			if ( ! $s ) {
				echo '<div class="wrap"><p>' . esc_html__( 'Submission not found.', 'uichemy' ) . '</p></div>';
				return;
			}
			Uich_Forms_DB::mark_read( $id );

			$vals = Uich_Forms_DB::get_values( $id );
			$user = $s->user_id ? get_user_by( 'id', $s->user_id ) : false;
			$meta = json_decode( (string) $s->meta, true );
			$log  = json_decode( (string) $s->actions_log, true );
			$back = add_query_arg( array( 'page' => self::PAGE ), admin_url( 'admin.php' ) );
			?>
			<div class="wrap" id="uich-view-submission">
				<h1 class="wp-heading-inline"><?php esc_html_e( 'Form Submission Details', 'uichemy' ); ?></h1>
				<a href="<?php echo esc_url( $back ); ?>" class="page-title-action">&#8592; <?php esc_html_e( 'Back to Submissions', 'uichemy' ); ?></a>
				<hr class="wp-header-end">

				<div class="uich-view-grid">

						<div class="uich-view-main">
							<div class="postbox">
								<div class="uich-postbox-header">
									<h2 class="hndle"><?php /* translators: %d: numeric submission ID. */ printf( esc_html__( 'Submission #%d', 'uichemy' ), (int) $s->id ); ?></h2>
									<button type="button" id="uich-toggle-edit" class="button button-primary"><?php esc_html_e( 'Edit', 'uichemy' ); ?></button>
								</div>
								<div class="inside">
									<form id="uich-edit-submission-form">
										<?php wp_nonce_field( 'uich_update_submission', 'uich_nonce' ); ?>
										<input type="hidden" name="submission_id" value="<?php echo esc_attr( $id ); ?>">
										<div class="uich-view-submission-details">
											<table class="widefat striped"><tbody>
											<?php if ( ! empty( $vals ) ) : ?>
												<?php
												foreach ( $vals as $key => $value ) :
													$label  = ucwords( str_replace( array( '_', '-' ), ' ', $key ) );
													$is_msg = ( false !== stripos( $key, 'message' ) || false !== stripos( $key, 'content' ) );
													?>
													<tr>
														<th style="width:220px;"><?php echo esc_html( $label ); ?></th>
														<td>
															<div class="uich-view-value">
																<?php
																if ( false !== stripos( $key, 'email' ) && is_email( $value ) ) {
																	echo '<a href="mailto:' . esc_attr( $value ) . '">' . esc_html( $value ) . '</a>';
																} else {
																	echo nl2br( esc_html( (string) $value ) );
																}
																?>
															</div>
															<div class="uich-edit-value" style="display:none;">
																<?php if ( $is_msg ) : ?>
																	<textarea name="fields[<?php echo esc_attr( $key ); ?>]" rows="4" style="width:100%;"><?php echo esc_textarea( (string) $value ); ?></textarea>
																<?php else : ?>
																	<input type="text" name="fields[<?php echo esc_attr( $key ); ?>]" value="<?php echo esc_attr( (string) $value ); ?>" style="width:100%;">
																<?php endif; ?>
															</div>
														</td>
													</tr>
												<?php endforeach; ?>
											<?php else : ?>
												<tr><td colspan="2"><?php esc_html_e( 'No form data found.', 'uichemy' ); ?></td></tr>
											<?php endif; ?>
											</tbody></table>
										</div>
									</form>
								</div>
							</div>

							<?php if ( is_array( $log ) && ! empty( $log ) ) : ?>
								<div class="postbox">
									<h2 class="hndle" style="padding:8px 12px;"><?php esc_html_e( 'Actions', 'uichemy' ); ?></h2>
									<div class="inside">
										<table class="widefat striped"><tbody>
										<?php
										foreach ( $log as $a ) :
											$ok = isset( $a['status'] ) && 'success' === $a['status'];
											?>
											<tr>
												<td><?php echo esc_html( isset( $a['label'] ) ? $a['label'] : ( isset( $a['name'] ) ? $a['name'] : '' ) ); ?></td>
												<td><span style="color:<?php echo $ok ? '#008a20' : '#d63638'; ?>"><?php echo esc_html( $ok ? __( 'Success', 'uichemy' ) : __( 'Failed', 'uichemy' ) ); ?></span></td>
											</tr>
										<?php endforeach; ?>
										</tbody></table>
									</div>
								</div>
							<?php endif; ?>
						</div>

						<div class="uich-view-side">
							<div class="postbox uich-formview-additional-info">
								<h2 class="hndle" style="padding:8px 12px;"><?php esc_html_e( 'Additional Info', 'uichemy' ); ?></h2>
								<div class="inside">
									<div class="uich-top-divider"></div>
									<p><strong><?php esc_html_e( 'Form:', 'uichemy' ); ?></strong>
										<?php
										$name = $s->form_name ? $s->form_name : $s->form_key;
										if ( $s->post_id ) {
											echo '<a href="' . esc_url( admin_url( 'post.php?post=' . absint( $s->post_id ) . '&action=elementor' ) ) . '" target="_blank">' . esc_html( $name ) . '</a>';
										} else {
											echo esc_html( $name );
										}
										?>
									</p>
									<p><strong><?php esc_html_e( 'Page:', 'uichemy' ); ?></strong>
										<?php if ( $s->post_id ) : ?>
											<a href="<?php echo esc_url( (string) get_permalink( $s->post_id ) ); ?>" target="_blank"><?php echo esc_html( get_the_title( $s->post_id ) ); ?></a>
										<?php else : ?>
											&mdash;
										<?php endif; ?>
									</p>
									<p><strong><?php esc_html_e( 'Create Date:', 'uichemy' ); ?></strong>
										<?php echo esc_html( date_i18n( 'F j, Y g:i a', strtotime( (string) $s->created_at ) ) ); ?>
									</p>
									<p><strong><?php esc_html_e( 'Update Date:', 'uichemy' ); ?></strong>
										<span class="uich-update-date-value"><?php echo ! empty( $s->updated_at ) ? esc_html( date_i18n( 'F j, Y g:i a', strtotime( (string) $s->updated_at ) ) ) : esc_html__( 'Never updated', 'uichemy' ); ?></span>
									</p>
									<p><strong><?php esc_html_e( 'User Name:', 'uichemy' ); ?></strong>
										<?php echo $user ? esc_html( $user->display_name ) : esc_html__( 'Guest', 'uichemy' ); ?>
									</p>
									<p><strong><?php esc_html_e( 'User IP:', 'uichemy' ); ?></strong> <?php echo esc_html( (string) $s->user_ip ); ?></p>
									<p><strong><?php esc_html_e( 'User Agent:', 'uichemy' ); ?></strong> <small><?php echo esc_html( (string) $s->user_agent ); ?></small></p>
									<div class="uich-bottom-divider"></div>
									<div class="uich-add-info-footer">
										<?php
										$del = wp_nonce_url(
											add_query_arg(
												array(
													'page' => self::PAGE,
													'uich_delete' => (int) $id,
												),
												admin_url( 'admin.php' )
											),
											'uich_delete_' . (int) $id
										);
										?>
										<a href="<?php echo esc_url( $del ); ?>" class="submitdelete deletion" onclick="return confirm('<?php echo esc_js( __( 'Delete this submission permanently?', 'uichemy' ) ); ?>');"><?php esc_html_e( 'Delete', 'uichemy' ); ?></a>
										<button type="button" id="uich-update-btn" class="button button-primary" disabled><?php esc_html_e( 'Update', 'uichemy' ); ?></button>
									</div>
								</div>
							</div>
						</div>

				</div>
			</div>

			<script>
			jQuery(function ($) {
				var editMode = false;
				$('#uich-toggle-edit').on('click', function () {
					editMode = !editMode;
					if (editMode) {
						$('.uich-view-value').hide();
						$('.uich-edit-value').show();
						$('#uich-update-btn').prop('disabled', false);
						$(this).text('<?php echo esc_js( __( 'Cancel', 'uichemy' ) ); ?>').removeClass('button-primary');
					} else {
						$('.uich-edit-value').hide();
						$('.uich-view-value').show();
						$('#uich-update-btn').prop('disabled', true);
						$(this).text('<?php echo esc_js( __( 'Edit', 'uichemy' ) ); ?>').addClass('button-primary');
					}
				});
				$('#uich-update-btn').on('click', function (e) {
					if ($(this).prop('disabled')) { return; }
					e.preventDefault();
					var $btn = $(this), fields = {};
					$('.uich-edit-value').find('input, textarea').each(function () {
						var m = this.name.match(/\[(.*?)\]/);
						if (m) { fields[m[1]] = $(this).val(); }
					});
					$btn.prop('disabled', true).text('<?php echo esc_js( __( 'Saving...', 'uichemy' ) ); ?>');
					$.post(ajaxurl, {
						action: 'uich_update_submission',
						nonce: $('#uich_nonce').val(),
						submission_id: $('input[name="submission_id"]').val(),
						fields: fields
					}).done(function (res) {
						if (res && res.success) {
							$('.uich-edit-value').each(function () {
								var $i = $(this).find('input, textarea').first(), v = $i.val();
								var $view = $(this).closest('td').find('.uich-view-value');
								var m = ($i.attr('name') || '').match(/\[(.*?)\]/), key = m ? m[1] : '';
								if (key.toLowerCase().indexOf('email') !== -1 && v.indexOf('@') !== -1) {
									$view.empty().append($('<a>').attr('href', 'mailto:' + v).text(v));
								} else { $view.text(v); }
							});
							if (res.data && res.data.updated_at) { $('.uich-update-date-value').text(res.data.updated_at); }
							editMode = false;
							$('.uich-edit-value').hide(); $('.uich-view-value').show();
							$('#uich-toggle-edit').text('<?php echo esc_js( __( 'Edit', 'uichemy' ) ); ?>').addClass('button-primary');
							$('#uich-update-btn').prop('disabled', true).text('<?php echo esc_js( __( 'Update', 'uichemy' ) ); ?>');
						} else {
							alert((res && res.data && res.data.message) ? res.data.message : 'Update failed');
							$btn.prop('disabled', false).text('<?php echo esc_js( __( 'Update', 'uichemy' ) ); ?>');
						}
					}).fail(function () {
						alert('AJAX error occurred.');
						$btn.prop('disabled', false).text('<?php echo esc_js( __( 'Update', 'uichemy' ) ); ?>');
					});
				});
			});
			</script>
			<?php
		}

		/** AJAX: inline-edit a submission's field values. */
		public static function ajax_update_submission() {
			check_ajax_referer( 'uich_update_submission', 'nonce' );
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_send_json_error( array( 'message' => __( 'Permission denied.', 'uichemy' ) ) );
			}
			$id     = isset( $_POST['submission_id'] ) ? absint( $_POST['submission_id'] ) : 0;
			$fields = isset( $_POST['fields'] ) && is_array( $_POST['fields'] ) ? map_deep( wp_unslash( $_POST['fields'] ), 'sanitize_textarea_field' ) : array();
			if ( ! $id || empty( $fields ) ) {
				wp_send_json_error( array( 'message' => __( 'Invalid submission data.', 'uichemy' ) ) );
			}
			foreach ( $fields as $key => $value ) {
				Uich_Forms_DB::set_value( $id, sanitize_key( $key ), sanitize_textarea_field( $value ) );
			}
			Uich_Forms_DB::touch_updated( $id );
			wp_send_json_success(
				array(
					'message'    => __( 'Submission updated successfully.', 'uichemy' ),
					'updated_at' => date_i18n( 'F j, Y g:i a', current_time( 'timestamp' ) ),
				)
			);
		}

		/* ── CSV export ─────────────────────────────────────────────────────────── */

		/** Export the current filtered set (admin-post link from the filter bar). */
		public static function export_all() {
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_die( esc_html__( 'Permission denied.', 'uichemy' ) );
			}
			check_admin_referer( 'uich_export_all' );

			global $wpdb;
			$t     = Uich_Forms_DB::table_submissions();
			$table = new Uich_Submissions_List_Table();
			// Reuse the same filter builder.
			$ref = new ReflectionMethod( 'Uich_Submissions_List_Table', 'build_where' );
			$ref->setAccessible( true );
			list( $where, $args ) = $ref->invoke( $table );

			$sql = "SELECT id FROM `{$t}` WHERE {$where} ORDER BY created_at DESC";
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; all values are bound via $wpdb->prepare().
			$ids = $args ? $wpdb->get_col( $wpdb->prepare( $sql, $args ) ) : $wpdb->get_col( $sql );
			self::stream_csv( array_map( 'intval', $ids ) );
		}

		/**
		 * Stream a CSV of the given submission ids (union of all field keys as columns).
		 *
		 * @param array  $ids      Submission ids to include.
		 * @param string $filename Optional download filename; defaults to the
		 *                         dated generic name the classic list has always used.
		 */
		public static function stream_csv( array $ids, $filename = '' ) {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			$ids = array_filter( array_map( 'intval', $ids ) );

			$columns = array();
			$data    = array();
			foreach ( $ids as $id ) {
				$s = Uich_Forms_DB::get_submission( $id );
				if ( ! $s ) {
					continue;
				}
				$vals = Uich_Forms_DB::get_values( $id );
				foreach ( array_keys( $vals ) as $k ) {
					$columns[ $k ] = ucwords( str_replace( array( '_', '-' ), ' ', $k ) );
				}
				$data[] = array(
					'id'        => (int) $s->id,
					'form_name' => (string) $s->form_name,
					'date'      => (string) $s->created_at,
					'vals'      => $vals,
				);
			}

			$filename = sanitize_file_name( (string) $filename );
			if ( '' === $filename ) {
				$filename = 'uichemy-submissions-' . gmdate( 'Y-m-d' ) . '.csv';
			}

			nocache_headers();
			header( 'Content-Type: text/csv; charset=utf-8' );
			header( 'Content-Disposition: attachment; filename=' . $filename );

			$out = fopen( 'php://output', 'w' );
			fputcsv( $out, array_map( array( __CLASS__, 'csv_safe' ), array_merge( array( 'ID', 'Form', 'Date' ), array_values( $columns ) ) ) );
			foreach ( $data as $row ) {
				$line = array( $row['id'], $row['form_name'], $row['date'] );
				foreach ( array_keys( $columns ) as $k ) {
					$line[] = isset( $row['vals'][ $k ] ) ? $row['vals'][ $k ] : '';
				}
				fputcsv( $out, array_map( array( __CLASS__, 'csv_safe' ), $line ) );
			}
			fclose( $out ); // phpcs:ignore
			exit;
		}

		/**
		 * Neutralise CSV/formula injection: prefix a leading =, +, -, @, tab or CR with a
		 * single quote so spreadsheet apps treat the cell as text, not a formula.
		 *
		 * @param mixed $v Cell value.
		 * @return string
		 */
		private static function csv_safe( $v ) {
			$v = (string) $v;
			if ( '' !== $v && in_array( $v[0], array( '=', '+', '-', '@', "\t", "\r" ), true ) ) {
				return "'" . $v;
			}
			return $v;
		}

		/* ── styles / scripts ─────────────────────────────────────────────────────── */

		/**
		 * Enqueue the Form Submissions screen CSS/JS through the core pipeline
		 * (wp_add_inline_style / wp_add_inline_script) instead of echoing inline
		 * <style>/<script> tags during render. Runs only on our own admin screen.
		 *
		 * @param string $hook Current admin page hook suffix (unused; the screen is
		 *                      matched via the `page` query arg).
		 * @return void
		 */
		public static function enqueue_admin_assets( $hook ) {
			unset( $hook );
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only check of which admin page is loading, purely to scope asset enqueueing; no state is changed.
			$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
			if ( self::PAGE !== $page ) {
				return;
			}

			// The list (#uich-submissions-page) and view (#uich-view-submission)
			// scopes use distinct id selectors, so both stylesheets can be attached
			// together — only the one matching the current screen applies.
			wp_register_style( 'uich-forms-admin', false, array(), UICHEMY_VERSION );
			wp_enqueue_style( 'uich-forms-admin' );
			wp_add_inline_style( 'uich-forms-admin', self::list_styles_css() . self::view_styles_css() );

			// Date-filter toggle on the list screen (jQuery).
			wp_register_script( 'uich-forms-admin', false, array( 'jquery' ), UICHEMY_VERSION, true );
			wp_enqueue_script( 'uich-forms-admin' );
			wp_add_inline_script( 'uich-forms-admin', self::list_script_js() );
		}

		private static function list_styles_css() {
			return '#uich-submissions-page{--bg:#fff;--fg:#09090b;--muted:#f4f4f5;--muted-fg:#71717a;--border:#e4e4e7;--primary:#18181b;--primary-fg:#fafafa;--destructive:#ef4444;font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg)}#uich-submissions-page .subsubsub{float:none;clear:both;width:auto;display:block;margin:4px 0 14px;font-size:13px;color:var(--muted-fg)}#uich-submissions-page .subsubsub a{color:var(--muted-fg);text-decoration:none}#uich-submissions-page .subsubsub a:hover{color:var(--fg)}#uich-submissions-page .subsubsub a.current{color:var(--fg);font-weight:600}#uich-submissions-page .subsubsub .count{color:var(--muted-fg)}.uich-table-card{position:relative;clear:both;width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:0 1px 2px 0 rgba(0,0,0,.05);margin-top:12px}.uich-table-card .tablenav.top{padding:14px 16px;margin:0;background:var(--bg);border-bottom:1px solid var(--border);display:flex;align-items:center;flex-wrap:wrap;gap:8px;height:auto!important}.uich-table-card .tablenav.top .bulkactions{display:flex;align-items:center;gap:6px;float:none;margin:0}.uich-table-card .tablenav.top .bulkactions select,.uich-select{height:36px!important;border:1px solid var(--border)!important;border-radius:6px!important;font-size:13px!important;padding:0 30px 0 10px!important;color:var(--fg)!important;background:var(--bg) url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2371717a\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E") no-repeat right 10px center!important;-webkit-appearance:none!important;-moz-appearance:none!important;appearance:none!important;cursor:pointer;line-height:34px!important}.uich-select:hover,.uich-table-card .tablenav.top .bulkactions select:hover{background-color:var(--muted)!important}.uich-table-card .tablenav.top .bulkactions .button{height:36px;line-height:34px;padding:0 14px;border-radius:6px;font-size:14px;font-weight:500;background:var(--bg)!important;border:1px solid var(--border)!important;color:var(--fg)!important;cursor:pointer;box-shadow:0 1px 2px 0 rgba(0,0,0,.05)}.uich-table-card .tablenav.top .bulkactions .button:hover{background:var(--muted)!important;color:var(--fg)!important}.uich-filter-actions{display:flex;align-items:center;gap:8px;float:none!important}.uich-filter-apply-btn{height:36px;line-height:34px;padding:0 16px;border-radius:6px;font-size:14px;font-weight:500;border:1px solid var(--primary)!important;background:var(--primary)!important;color:var(--primary-fg)!important;cursor:pointer;box-shadow:0 1px 2px 0 rgba(0,0,0,.05)}.uich-filter-apply-btn:hover{background:#27272a!important;border-color:#27272a!important;color:var(--primary-fg)!important}.uich-table-card .tablenav.top .tablenav-pages{display:none}.uich-filter-right{margin-left:auto;display:flex;align-items:center;gap:10px}.uich-date-field{height:36px!important;border:1px solid var(--border)!important;border-radius:6px!important;padding:0 10px!important;font-size:13px!important;color:var(--fg)!important;background:var(--bg)!important;box-sizing:border-box;margin-right:4px}.uich-search-wrap{position:relative;display:inline-flex;align-items:center}.uich-search-icon{position:absolute;left:11px;color:var(--muted-fg);pointer-events:none}.uich-search-field{height:36px!important;border:1px solid var(--border)!important;border-radius:6px!important;padding:0 12px 0 34px!important;font-size:14px!important;color:var(--fg)!important;background:var(--bg)!important;width:240px;box-sizing:border-box;margin:0!important}.uich-search-field::placeholder{color:var(--muted-fg)}.uich-search-field:focus,.uich-select:focus,.uich-date-field:focus{outline:none!important;border-color:var(--fg)!important;box-shadow:0 0 0 1px var(--fg)!important}.uich-export-btn{height:36px;line-height:34px;padding:0 16px;border-radius:6px;font-size:14px;font-weight:500;background:var(--bg);border:1px solid var(--border);color:var(--fg)!important;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none!important;box-shadow:0 1px 2px 0 rgba(0,0,0,.05)}.uich-export-btn:hover{background:var(--muted);color:var(--fg)!important}.uich-table-card .wp-list-table{width:100%;border:none!important;border-radius:0;margin:0;background:var(--bg);font-size:14px}.uich-table-card .wp-list-table thead th,.uich-table-card .wp-list-table thead td,.uich-table-card .wp-list-table tfoot th,.uich-table-card .wp-list-table tfoot td{background:var(--muted)!important;color:var(--muted-fg)!important;font-size:13px;font-weight:500;padding:0 16px!important;height:44px;border-bottom:1px solid var(--border)!important;border-top:none!important;white-space:nowrap;vertical-align:middle}.uich-table-card .wp-list-table tfoot th,.uich-table-card .wp-list-table tfoot td{border-top:1px solid var(--border)!important;border-bottom:none!important}.uich-table-card .wp-list-table thead th a,.uich-table-card .wp-list-table thead th.sortable a,.uich-table-card .wp-list-table thead th.sorted a,.uich-table-card .wp-list-table tfoot th a,.uich-table-card .wp-list-table tfoot th.sortable a,.uich-table-card .wp-list-table tfoot th.sorted a{color:var(--fg)!important;text-decoration:none}.uich-table-card .wp-list-table thead th a:hover,.uich-table-card .wp-list-table tfoot th a:hover{text-decoration:underline}.uich-table-card .wp-list-table tbody td,.uich-table-card .wp-list-table tbody th{padding:12px 16px!important;border-bottom:1px solid var(--border)!important;background:var(--bg)!important;vertical-align:middle;font-size:14px;color:#3f3f46;border-top:none!important}.uich-table-card .wp-list-table tbody tr:last-child td,.uich-table-card .wp-list-table tbody tr:last-child th{border-bottom:none!important}.uich-table-card .wp-list-table.striped>tbody>tr:nth-child(odd){background:var(--bg)!important}.uich-table-card .wp-list-table tbody tr:hover td{background:#fafafa!important}.uich-table-card .wp-list-table tbody tr:has(.uich-status-unread) td{font-weight:600;color:var(--fg)}.uich-table-card .wp-list-table input[type=checkbox]{accent-color:var(--primary);border-color:var(--border)}.uich-status-badge{display:inline-flex;align-items:center;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:600;line-height:1.6;white-space:nowrap;border:1px solid transparent}.uich-status-unread{color:var(--primary-fg);background:var(--primary);border-color:var(--primary)}.uich-status-read{color:var(--muted-fg);background:var(--bg);border-color:var(--border)}.uich-action-btn{display:inline-flex;align-items:center;height:30px;padding:0 11px;border-radius:6px;font-size:12px;font-weight:500;text-decoration:none!important;margin-right:4px;cursor:pointer;line-height:1;border:1px solid transparent;vertical-align:middle;transition:background-color .15s ease,color .15s ease}.uich-btn-view{background:var(--bg);color:var(--fg)!important;border-color:var(--border)}.uich-btn-view:hover{background:var(--muted);color:var(--fg)!important}.uich-btn-mark{background:var(--bg);color:var(--fg)!important;border-color:var(--border)}.uich-btn-mark:hover{background:var(--muted);color:var(--fg)!important}.uich-btn-delete{background:var(--bg);color:var(--destructive)!important;border-color:#f0c8c8;margin-left:8px}.uich-btn-delete:hover{background:#fef2f2;color:#dc2626!important;border-color:#e7a3a3}.uich-table-card .column-id{width:56px}.uich-table-card .column-uich_actions{white-space:nowrap;width:300px}.uich-table-card .column-form_name a,.uich-table-card .column-page a{color:var(--fg);text-decoration:none;font-weight:500}.uich-table-card .column-form_name a:hover,.uich-table-card .column-page a:hover{text-decoration:underline}.uich-table-card .column-email a{color:var(--fg);text-decoration:none}.uich-table-card .column-email a:hover{text-decoration:underline}.uich-table-card .tablenav.bottom{padding:12px 16px;margin:0;background:var(--bg);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;height:auto!important}.uich-table-card .tablenav.bottom .bulkactions,.uich-table-card .tablenav.bottom .actions{display:none!important}.uich-table-card .tablenav.bottom .displaying-num{color:var(--muted-fg);font-size:13px}.uich-table-card .tablenav.bottom .tablenav-pages{margin:0;float:none;display:flex;align-items:center;gap:6px}.uich-table-card .tablenav.bottom .tablenav-pages .pagination-links{display:flex;align-items:center;gap:4px}.uich-table-card .tablenav.bottom .tablenav-pages a.button,.uich-table-card .tablenav.bottom .tablenav-pages span.button{height:32px;min-width:32px;line-height:30px;border:1px solid var(--border)!important;border-radius:6px!important;background:var(--bg)!important;color:var(--fg)!important;box-shadow:none!important;padding:0 8px;text-align:center}.uich-table-card .tablenav.bottom .tablenav-pages a.button:hover{background:var(--muted)!important}.uich-table-card .tablenav.bottom .tablenav-pages .button.disabled{opacity:.5}.uich-table-card .tablenav.bottom .paging-input{color:var(--muted-fg);font-size:13px}';
		}

		private static function list_script_js() {
			return 'jQuery(function($){var sel=$("#uich-date-filter-select");function t(){$("#uich-custom-date").toggle(sel.val()==="custom");}sel.on("change",t);t();});';
		}

		private static function view_styles_css() {
			return '#uich-view-submission{--bg:#fff;--fg:#09090b;--muted:#f4f4f5;--muted-fg:#71717a;--border:#e4e4e7;--primary:#18181b;--primary-fg:#fafafa;--destructive:#ef4444;font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg)}#uich-view-submission h1.wp-heading-inline{font-size:20px;font-weight:600;letter-spacing:-0.025em;color:var(--fg)}#uich-view-submission .wp-header-end{display:none}#uich-view-submission .page-title-action{display:inline-flex;align-items:center;height:34px;padding:0 14px;margin-left:10px;border:1px solid var(--border)!important;border-radius:6px!important;background:var(--bg)!important;color:var(--fg)!important;font-size:13px;font-weight:500;line-height:1;text-decoration:none!important;box-shadow:0 1px 2px 0 rgba(0,0,0,.05);vertical-align:middle}#uich-view-submission .page-title-action:hover{background:var(--muted)!important;color:var(--fg)!important}.uich-view-grid{display:flex;gap:20px;align-items:flex-start;margin-top:16px}.uich-view-main{flex:1 1 auto;min-width:0}.uich-view-side{width:320px;flex:0 0 320px}@media(max-width:782px){.uich-view-grid{flex-direction:column}.uich-view-side{width:100%;flex-basis:auto}}#uich-view-submission .postbox{background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 1px 2px 0 rgba(0,0,0,.05);margin-bottom:20px;overflow:hidden}#uich-view-submission .postbox .inside{padding:20px;margin:0}#uich-view-submission .uich-postbox-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border)}#uich-view-submission .uich-postbox-header .hndle{padding:0!important;margin:0;border:0;font-size:15px;font-weight:600;color:var(--fg);line-height:1.3}#uich-view-submission .postbox>.hndle{padding:14px 20px!important;margin:0;border-bottom:1px solid var(--border);font-size:15px;font-weight:600;color:var(--fg);line-height:1.3}.uich-view-submission-details table{width:100%!important;border:1px solid var(--border)!important;border-collapse:separate!important;border-spacing:0!important;border-radius:8px;overflow:hidden}.uich-view-submission-details th{width:200px;padding:12px 16px!important;background:#fafafa!important;font-weight:500;font-size:13px;text-align:left;color:var(--muted-fg)!important;border-right:1px solid var(--border)!important;vertical-align:top}.uich-view-submission-details td{padding:12px 16px!important;background:var(--bg)!important;font-size:14px;color:#3f3f46!important;vertical-align:top}.uich-view-submission-details tr+tr th,.uich-view-submission-details tr+tr td{border-top:1px solid var(--border)!important}.uich-view-submission-details .uich-view-value a{color:var(--fg);text-decoration:underline;text-underline-offset:2px}.uich-view-submission-details textarea,.uich-view-submission-details input[type=text]{border:1px solid var(--border)!important;border-radius:6px!important;padding:8px 10px!important;font-size:14px!important;color:var(--fg)!important;box-shadow:none!important;width:100%}#uich-view-submission .button-primary,#uich-view-submission #uich-update-btn{background:var(--primary)!important;border:1px solid var(--primary)!important;color:var(--primary-fg)!important;border-radius:6px!important;box-shadow:0 1px 2px 0 rgba(0,0,0,.05)!important;text-shadow:none!important;height:34px;line-height:1;padding:0 14px;font-size:13px;font-weight:500;display:inline-flex;align-items:center}#uich-view-submission .button-primary:hover,#uich-view-submission #uich-update-btn:hover:not(:disabled){background:#27272a!important;border-color:#27272a!important;color:var(--primary-fg)!important}#uich-view-submission .button:not(.button-primary):not(#uich-update-btn){display:inline-flex;align-items:center;height:34px;padding:0 14px;border:1px solid var(--border)!important;border-radius:6px!important;background:var(--bg)!important;color:var(--fg)!important;font-size:13px;font-weight:500;line-height:1;text-shadow:none!important;box-shadow:0 1px 2px 0 rgba(0,0,0,.05)!important}#uich-view-submission .button:not(.button-primary):not(#uich-update-btn):hover{background:var(--muted)!important;color:var(--fg)!important;border-color:var(--border)!important}#uich-update-btn:disabled{opacity:.45!important;cursor:not-allowed}#uich-update-btn{float:right}#uich-view-submission .uich-formview-additional-info p{font-size:13px;line-height:1.55;margin:10px 0;color:var(--muted-fg)}#uich-view-submission .uich-formview-additional-info p strong{color:var(--fg);font-weight:600}.uich-formview-additional-info .uich-top-divider{display:none}.uich-formview-additional-info .uich-bottom-divider{margin:14px -20px;border-top:1px solid var(--border)}.uich-add-info-footer{position:relative;display:flex;justify-content:space-between;align-items:center}.uich-formview-additional-info .submitdelete{color:var(--destructive)!important;text-decoration:none;font-weight:500;font-size:13px}.uich-formview-additional-info .submitdelete:hover{color:#dc2626!important;text-decoration:underline}';
		}
	}
}
