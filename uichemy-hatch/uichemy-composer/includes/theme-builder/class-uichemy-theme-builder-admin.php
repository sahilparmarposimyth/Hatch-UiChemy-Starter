<?php
/**
 * UiChemy_Theme_Builder_Admin — admin-ajax endpoints for the Theme Builder UI.
 *
 * Routed through a single `wp_ajax_uichemy_theme_builder` action (mirrors the
 * dashboard's `uichemy_dashboard` pattern) and reuses the dashboard nonce, since
 * the Theme Builder screen is part of the same admin app. Every branch requires
 * `manage_options` and a valid nonce.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Theme_Builder_Admin' ) ) {

	/**
	 * AJAX controller for the Theme Builder admin screen.
	 */
	class UiChemy_Theme_Builder_Admin {

		/**
		 * Register the ajax route.
		 *
		 * @return void
		 */
		public static function init() {
			add_action( 'wp_ajax_uichemy_theme_builder', array( __CLASS__, 'ajax' ) );
			add_action( 'enqueue_block_editor_assets', array( __CLASS__, 'enqueue_block_editor' ) );
		}

		/**
		 * Add the "Edit with Elementor" panel to the block editor when editing a
		 * Gutenberg-authored UiChemy template.
		 *
		 * @return void
		 */
		public static function enqueue_block_editor() {
			if ( ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return;
			}

			$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
			if ( ! $screen || UiChemy_Template_CPT::POST_TYPE !== $screen->post_type ) {
				return;
			}

			$post = get_post();
			if ( ! $post || 'gutenberg' !== UiChemy_Template_CPT::editor_for( $post->ID ) ) {
				return;
			}

			wp_enqueue_script(
				'uichemy-tb-editor',
				UICHEMY_URL . 'assets/js/uichemy-tb-editor.js',
				array( 'wp-plugins', 'wp-edit-post', 'wp-editor', 'wp-element', 'wp-components' ),
				UICHEMY_VERSION,
				true
			);

			wp_localize_script(
				'uichemy-tb-editor',
				'uichemyTBEditor',
				array(
					'postId'  => (int) $post->ID,
					'ajaxUrl' => admin_url( 'admin-ajax.php' ),
					'nonce'   => wp_create_nonce( 'uichemy_dashboard' ),
				)
			);
		}

		/**
		 * Route Theme Builder ajax requests by `type`.
		 *
		 * @return void
		 */
		public static function ajax() {
			check_ajax_referer( 'uichemy_dashboard', 'nonce' );

			if ( ! current_user_can( 'manage_options' ) ) {
				wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
			}

			if ( ! class_exists( 'UiChemy_Template_Store' ) || ! class_exists( 'UiChemy_Template_CPT' ) ) {
				wp_send_json_error( array( 'message' => 'Theme Builder is disabled.' ), 400 );
			}

			$type = isset( $_POST['type'] ) ? sanitize_key( wp_unslash( $_POST['type'] ) ) : '';

			switch ( $type ) {
				case 'tb_list':
					self::handle_list();
					break;
				case 'tb_architecture':
					self::handle_architecture();
					break;
				case 'tb_create':
					self::handle_create();
					break;
				case 'tb_set_status':
					self::handle_set_status();
					break;
				case 'tb_set_editor':
					self::handle_set_editor();
					break;
				case 'tb_update_conditions':
					self::handle_update_conditions();
					break;
				case 'tb_delete':
					self::handle_delete();
					break;
				case 'tb_search_posts':
					self::handle_search_posts();
					break;
				case 'tb_condition_options':
					self::handle_condition_options();
					break;
				case 'tb_search_terms':
					self::handle_search_terms();
					break;
				default:
					wp_send_json_error( array( 'message' => 'unknown type' ), 400 );
			}
		}

		/**
		 * List all templates grouped by location type.
		 *
		 * @return void
		 */
		private static function handle_list() {
			$out = array();
			// Free lists only its four types — Pro-type templates stay in the DB
			// untouched, they just aren't surfaced until Pro is active again.
			foreach ( UiChemy_Template_CPT::allowed_types() as $tpl_type ) {
				$out[ $tpl_type ] = array();
				foreach ( UiChemy_Template_Store::get_by_type( $tpl_type ) as $id ) {
					$out[ $tpl_type ][] = self::template_payload( (int) $id );
				}
			}

			$env = class_exists( 'UiChemy_Locations' )
				? UiChemy_Locations::environment()
				: array(
					'type'                  => 'unknown',
					'headerFooterSupported' => true,
					'conflicts'             => array(),
				);

			// Site identity for the Canvas view's root node.
			$env['siteName'] = get_bloginfo( 'name' );
			$env['siteUrl']  = home_url( '/' );

			wp_send_json_success(
				array(
					'templates' => $out,
					'env'       => $env,
				)
			);
		}

		/**
		 * The site-architecture payload for the Canvas view: the site identity plus
		 * a slot catalog derived from the actual registered post types & taxonomies
		 * (so CPTs / custom taxonomies appear automatically), each with the UiChemy
		 * templates that fill it. Mirrors Nexter's four-group site map, mapped onto
		 * UiChemy's real types + targets.
		 *
		 * @return void
		 */
		private static function handle_architecture() {
			wp_send_json_success( self::architecture() );
		}

		/**
		 * The template-slot map: every location this site has, and what fills it.
		 *
		 * Extracted from handle_architecture() so it is reachable outside admin-ajax
		 * — the Canvas view and the MCP ability both need the same answer to "which
		 * parts of this site still fall through to the theme's defaults", and it must
		 * not be two derivations that can disagree.
		 *
		 * @return array{site:array,slots:array[]}
		 */
		public static function architecture() {
			return array(
				'site'  => array(
					'name' => get_bloginfo( 'name' ),
					'url'  => home_url( '/' ),
				),
				'slots' => self::build_architecture_slots(),
			);
		}

		/**
		 * Build the ordered slot catalog (structural / singular / archives / special).
		 *
		 * @return array[]
		 */
		private static function build_architecture_slots() {
			$exclude_pt  = array( 'attachment', UiChemy_Template_CPT::POST_TYPE, 'elementor_library', 'e-floating-buttons', 'nxt_builder' );
			$exclude_tax = array( 'post_format', 'nav_menu', 'link_category' );

			$slots = array();

			// Structural.
			$slots[] = self::arch_slot( 'header', __( 'Header', 'uichemy' ), 'structural', '', true );
			$slots[] = self::arch_slot( 'footer', __( 'Footer', 'uichemy' ), 'structural', '', true );

			// Singular: Front Page + one node per public post type + fallback.
			$slots[] = self::arch_slot( 'single', __( 'Front Page', 'uichemy' ), 'singular', 'front', true );
			foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $pt ) {
				if ( in_array( $pt->name, $exclude_pt, true ) ) {
					continue;
				}
				/* translators: %s: post type singular name. */
				$slots[] = self::arch_slot( 'single', sprintf( __( 'Single %s', 'uichemy' ), $pt->labels->singular_name ), 'singular', 'pt:' . $pt->name, ( 'post' === $pt->name || 'page' === $pt->name ), $pt->labels->singular_name );
			}
			$slots[] = self::arch_slot( 'single', __( 'Any Singular (fallback)', 'uichemy' ), 'singular', 'any', false );

			// Archives: Blog Home + one node per public taxonomy + author/date + fallback.
			$slots[] = self::arch_slot( 'archive', __( 'Blog Home', 'uichemy' ), 'archive', 'blog', false );
			foreach ( get_taxonomies( array( 'public' => true ), 'objects' ) as $tx ) {
				if ( in_array( $tx->name, $exclude_tax, true ) ) {
					continue;
				}
				/* translators: %s: taxonomy singular name. */
				$slots[] = self::arch_slot( 'archive', sprintf( __( '%s Archive', 'uichemy' ), $tx->labels->singular_name ), 'archive', 'tax:' . $tx->name, false, $tx->labels->name );
			}
			$slots[] = self::arch_slot( 'archive', __( 'Author Archive', 'uichemy' ), 'archive', 'author', false );
			$slots[] = self::arch_slot( 'archive', __( 'Date Archive', 'uichemy' ), 'archive', 'date', false );
			$slots[] = self::arch_slot( 'archive', __( 'Any Archive (fallback)', 'uichemy' ), 'archive', 'any', false );

			// Special.
			$slots[] = self::arch_slot( 'search', __( 'Search Results', 'uichemy' ), 'special', '', true );
			$slots[] = self::arch_slot( 'error_404', __( '404 Page', 'uichemy' ), 'special', '', true );

			return $slots;
		}

		/**
		 * Build one architecture slot with the templates that fill it.
		 *
		 * @param string $type      UiChemy template type.
		 * @param string $label     Slot label.
		 * @param string $group     structural|singular|archive|special.
		 * @param string $target    Target key ('' for header/footer/search/404).
		 * @param bool   $critical  Whether an unfilled slot is a "Missing" gap.
		 * @param string $sub_label Secondary label (post type / taxonomy plural).
		 * @return array
		 */
		private static function arch_slot( $type, $label, $group, $target, $critical, $sub_label = '' ) {
			$is_targeted = in_array( $type, array( 'single', 'archive' ), true );
			$templates   = array();

			foreach ( UiChemy_Template_Store::get_by_type( $type ) as $id ) {
				if ( $is_targeted && UiChemy_Template_CPT::target_for( $id ) !== $target ) {
					continue;
				}
				$templates[] = self::template_payload( (int) $id );
			}

			$slot_key = ( $is_targeted && '' !== $target ) ? $type . '|' . $target : $type;

			return array(
				'key'       => $slot_key,
				'type'      => $type,
				'target'    => $target,
				'label'     => $label,
				'sub_label' => $sub_label,
				'group'     => $group,
				'critical'  => (bool) $critical,
				'templates' => $templates,
				'filled'    => ! empty( $templates ),
			);
		}

		/**
		 * Create a blank template (inactive) of a type and return its edit link.
		 *
		 * @return void
		 */
		private static function handle_create() {
			$tpl_type = isset( $_POST['tpl_type'] ) ? sanitize_key( wp_unslash( $_POST['tpl_type'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
			if ( ! UiChemy_Template_CPT::is_valid_type( $tpl_type ) ) {
				wp_send_json_error( array( 'message' => 'Invalid template type.' ), 400 );
			}

			$title = isset( $_POST['title'] ) ? sanitize_text_field( wp_unslash( $_POST['title'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
			// New templates default to the Gutenberg block editor; Elementor is
			// opt-in (via the card's "Edit with Elementor").
			$editor = ( isset( $_POST['editor'] ) && 'elementor' === $_POST['editor'] ) ? 'elementor' : 'gutenberg';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
			// Optional target for canvas "create in slot" (e.g. pt:page, tax:category).
			// When none is supplied — the Grid's "Add New → Single" — a single
			// template defaults to Single Post (pt:post) rather than the greedy
			// "any", so a new single template scopes to blog posts and never
			// silently takes over pages or the front page. All other types keep
			// "any" (target is unused for them). The Canvas always passes an
			// explicit target, which wins.
			$default_target = ( 'single' === $tpl_type ) ? 'pt:post' : 'any';
			$target         = ( isset( $_POST['target'] ) && '' !== $_POST['target'] )  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
				? sanitize_text_field( wp_unslash( $_POST['target'] ) )  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
				: $default_target;

			$id = UiChemy_Template_Store::create(
				array(
					'type'   => $tpl_type,
					'title'  => $title,
					'status' => 'inactive',
					'editor' => $editor,
					'target' => $target,
				)
			);

			if ( is_wp_error( $id ) ) {
				wp_send_json_error( array( 'message' => $id->get_error_message() ), 400 );
			}

			wp_send_json_success( self::template_payload( (int) $id ) );
		}

		/**
		 * Resolve a POSTed template id and guard that it both exists AND is a type
		 * this build may manage. In Free this refuses to mutate a Pro-type template
		 * (e.g. an `archive` left behind by a former Pro install) so a crafted
		 * request cannot activate, retarget, re-edit or delete a template the build
		 * never surfaces — matching the creation gate, which already rejects Pro
		 * types. Ends the request with a JSON error when either check fails (so it
		 * returns a validated id or does not return at all).
		 *
		 * @return int Validated, manageable template ID.
		 */
		private static function require_manageable_template() {
			$id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.

			if ( ! UiChemy_Template_Store::is_template( $id ) ) {
				wp_send_json_error( array( 'message' => 'Template not found.' ), 404 );
			}

			$type = (string) get_post_meta( $id, UiChemy_Template_CPT::META_TYPE, true );
			if ( ! UiChemy_Template_CPT::is_valid_type( $type ) ) {
				wp_send_json_error(
					array( 'message' => 'This template type is not available on your plan.' ),
					403
				);
			}

			return $id;
		}

		/**
		 * Activate/deactivate a template.
		 *
		 * @return void
		 */
		private static function handle_set_status() {
			$id     = self::require_manageable_template();
			$status = isset( $_POST['status'] ) && 'active' === $_POST['status'] ? 'active' : 'inactive';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.

			UiChemy_Template_Store::set_status( $id, $status );
			wp_send_json_success( self::template_payload( $id ) );
		}

		/**
		 * Switch a template's editor (elementor|gutenberg). When switching to
		 * Elementor, seed a blank Elementor document if the post has none yet, so
		 * the Elementor editor opens with the standard Composer-widget container.
		 *
		 * @return void
		 */
		private static function handle_set_editor() {
			$id     = self::require_manageable_template();
			$editor = ( isset( $_POST['editor'] ) && 'elementor' === $_POST['editor'] ) ? 'elementor' : 'gutenberg';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.

			update_post_meta( $id, UiChemy_Template_CPT::META_EDITOR, $editor );

			if ( 'elementor' === $editor ) {
				$data = get_post_meta( $id, '_elementor_data', true );
				if ( empty( $data ) || '[]' === trim( (string) $data ) ) {
					$type     = (string) get_post_meta( $id, UiChemy_Template_CPT::META_TYPE, true );
					$elements = UiChemy_Template_Store::default_elements( $type, array( '_title' => get_the_title( $id ) ) );
					update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
					update_post_meta( $id, '_elementor_edit_mode', 'builder' );
					update_post_meta( $id, '_elementor_page_settings', array() );
				}
				if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
					\Elementor\Plugin::$instance->files_manager->clear_cache();
				}
			}

			wp_send_json_success( self::template_payload( $id ) );
		}

		/**
		 * Update a template's display conditions.
		 *
		 * @return void
		 */
		private static function handle_update_conditions() {
			$id = self::require_manageable_template();

			// The client sends `conditions` as a JSON string (see admin data.js).
			$raw        = isset( $_POST['conditions'] ) ? json_decode( wp_unslash( $_POST['conditions'] ), true ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.NonceVerification.Missing -- Nonce/capability verified at AJAX handler entry; normalized in sanitize_conditions().
			$conditions = is_array( $raw ) ? $raw : array();

			UiChemy_Template_Store::update_conditions( $id, $conditions );
			wp_send_json_success( self::template_payload( $id ) );
		}

		/**
		 * Delete a template.
		 *
		 * @return void
		 */
		private static function handle_delete() {
			$id = self::require_manageable_template();

			UiChemy_Template_Store::delete( $id );
			wp_send_json_success(
				array(
					'id'      => $id,
					'deleted' => true,
				)
			);
		}

		/**
		 * Search pages/posts for the conditions include/exclude picker.
		 *
		 * @return void
		 */
		private static function handle_search_posts() {
			$q = isset( $_POST['q'] ) ? sanitize_text_field( wp_unslash( $_POST['q'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.

			$query = new WP_Query(
				array(
					'post_type'           => array( 'page', 'post' ),
					'post_status'         => 'publish',
					'posts_per_page'      => 20,
					's'                   => $q,
					'orderby'             => 'title',
					'order'               => 'ASC',
					'ignore_sticky_posts' => true,
					'no_found_rows'       => true,
				)
			);

			$results = array();
			foreach ( $query->posts as $p ) {
				$results[] = array(
					'id'    => $p->ID,
					'title' => $p->post_title ? $p->post_title : sprintf( '#%d', $p->ID ),
					'type'  => $p->post_type,
				);
			}
			wp_reset_postdata();

			wp_send_json_success( array( 'results' => $results ) );
		}

		/**
		 * Option lists for the display-conditions rule builder: public post types,
		 * public taxonomies (with the post types they apply to), and authors. Terms
		 * are fetched on demand via tb_search_terms (they can be numerous).
		 *
		 * @return void
		 */
		private static function handle_condition_options() {
			$exclude_pt  = array( 'attachment', UiChemy_Template_CPT::POST_TYPE, 'elementor_library', 'e-floating-buttons', 'nxt_builder' );
			$exclude_tax = array( 'post_format', 'nav_menu', 'link_category' );

			$post_types = array();
			foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $pt ) {
				if ( in_array( $pt->name, $exclude_pt, true ) ) {
					continue;
				}
				$post_types[] = array(
					'slug'  => $pt->name,
					'label' => $pt->labels->singular_name,
				);
			}

			$taxonomies = array();
			foreach ( get_taxonomies( array( 'public' => true ), 'objects' ) as $tx ) {
				if ( in_array( $tx->name, $exclude_tax, true ) ) {
					continue;
				}
				$taxonomies[] = array(
					'slug'      => $tx->name,
					'label'     => $tx->labels->singular_name,
					'postTypes' => array_values( (array) $tx->object_type ),
				);
			}

			$authors = array();
			foreach ( get_users(
				array(
					'capability' => 'edit_posts',
					'number'     => 100,
					'orderby'    => 'display_name',
					'fields'     => array( 'ID', 'display_name' ),
				)
			) as $u ) {
				$authors[] = array(
					'id'   => (int) $u->ID,
					'name' => $u->display_name,
				);
			}

			wp_send_json_success(
				array(
					'postTypes'  => $post_types,
					'taxonomies' => $taxonomies,
					'authors'    => $authors,
				)
			);
		}

		/**
		 * Search terms within a taxonomy for the conditions rule builder.
		 *
		 * @return void
		 */
		private static function handle_search_terms() {
			$taxonomy = isset( $_POST['taxonomy'] ) ? sanitize_key( wp_unslash( $_POST['taxonomy'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.
			$q        = isset( $_POST['q'] ) ? sanitize_text_field( wp_unslash( $_POST['q'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Nonce (check_ajax_referer) and capability verified at handler entry.

			if ( '' === $taxonomy || ! taxonomy_exists( $taxonomy ) ) {
				wp_send_json_success( array( 'results' => array() ) );
			}

			$terms   = get_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => false,
					'number'     => 20,
					'search'     => $q,
					'orderby'    => 'name',
					'order'      => 'ASC',
				)
			);
			$results = array();
			if ( is_array( $terms ) ) {
				foreach ( $terms as $t ) {
					$results[] = array(
						'id'    => (int) $t->term_id,
						'title' => $t->name,
						'type'  => $taxonomy,
					);
				}
			}

			wp_send_json_success( array( 'results' => $results ) );
		}

		/**
		 * Human-readable labels for stored rules, echoing back the identifying
		 * fields so the modal can repopulate each row without extra lookups.
		 *
		 * @param array $rules Sanitized rules.
		 * @return array<int,array<string,mixed>>
		 */
		private static function rules_labels( $rules ) {
			$out = array();
			foreach ( (array) $rules as $rule ) {
				$out[] = array(
					'match'    => isset( $rule['match'] ) ? $rule['match'] : 'include',
					'type'     => isset( $rule['type'] ) ? $rule['type'] : '',
					'value'    => isset( $rule['value'] ) ? $rule['value'] : null,
					'taxonomy' => isset( $rule['taxonomy'] ) ? $rule['taxonomy'] : null,
					'term'     => isset( $rule['term'] ) ? (int) $rule['term'] : null,
					'label'    => self::rule_label( $rule ),
				);
			}
			return $out;
		}

		/**
		 * A single rule's display label.
		 *
		 * @param array $rule Rule.
		 * @return string
		 */
		private static function rule_label( $rule ) {
			$type = isset( $rule['type'] ) ? $rule['type'] : '';
			switch ( $type ) {
				case 'entire':
					return __( 'Entire site', 'uichemy' );
				case 'search':
					return __( 'Search results', 'uichemy' );
				case 'post_type':
					$o = get_post_type_object( (string) $rule['value'] );
					/* translators: %s: post type plural name. */
					return $o ? sprintf( __( 'All %s', 'uichemy' ), $o->labels->name ) : (string) $rule['value'];
				case 'author':
					$aid = isset( $rule['value'] ) ? (int) $rule['value'] : 0;
					if ( ! $aid ) {
						return __( 'Any author', 'uichemy' );
					}
					$u = get_userdata( $aid );
					return $u ? $u->display_name : sprintf( '#%d', $aid );
				case 'singular':
					$t = get_the_title( (int) $rule['value'] );
					return '' !== $t ? html_entity_decode( $t, ENT_QUOTES, 'UTF-8' ) : sprintf( '#%d', (int) $rule['value'] );
				case 'taxonomy':
					$txo  = get_taxonomy( (string) $rule['taxonomy'] );
					$txl  = $txo ? $txo->labels->singular_name : (string) $rule['taxonomy'];
					$term = isset( $rule['term'] ) ? (int) $rule['term'] : 0;
					if ( ! $term ) {
						/* translators: %s: taxonomy singular name. */
						return sprintf( __( 'Any %s', 'uichemy' ), $txl );
					}
					$tt = get_term( $term );
					return ( $tt && ! is_wp_error( $tt ) ) ? sprintf( '%s: %s', $txl, $tt->name ) : $txl;
			}
			return '';
		}

		/**
		 * Human-readable label for a single/archive template's target context
		 * (see UiChemy_Template_CPT::META_TARGET). Returns '' for types that do
		 * not use targeting (header/footer/search/404/Woo), whose scope is fixed.
		 *
		 * @param string $type   Template type.
		 * @param string $target Target key.
		 * @return string
		 */
		private static function target_label( $type, $target ) {
			$target = (string) $target;

			if ( 'single' === $type ) {
				if ( 'front' === $target ) {
					return __( 'Front page', 'uichemy' );
				}
				if ( 0 === strpos( $target, 'pt:' ) ) {
					$obj = get_post_type_object( substr( $target, 3 ) );
					/* translators: %s: post type plural name. */
					return $obj ? sprintf( __( 'All %s', 'uichemy' ), $obj->labels->name ) : $target;
				}
				return __( 'All posts & pages', 'uichemy' );
			}

			if ( 'archive' === $type ) {
				switch ( $target ) {
					case 'blog':
						return __( 'Blog home', 'uichemy' );
					case 'author':
						return __( 'Author archives', 'uichemy' );
					case 'date':
						return __( 'Date archives', 'uichemy' );
				}
				if ( 0 === strpos( $target, 'tax:' ) ) {
					$obj = get_taxonomy( substr( $target, 4 ) );
					/* translators: %s: taxonomy singular name. */
					return $obj ? sprintf( __( '%s archives', 'uichemy' ), $obj->labels->singular_name ) : $target;
				}
				return __( 'All archives', 'uichemy' );
			}

			return '';
		}

		/**
		 * Build the API payload for one template.
		 *
		 * @param int $id Template post ID.
		 * @return array
		 */
		/**
		 * One template as the React screens consume it.
		 *
		 * Public because the block editor's one-time "Edit Condition" launcher
		 * hands the very same shape to the dashboard's ConditionsDialog — the two
		 * must not drift into separate ideas of what a template looks like.
		 */
		public static function template_payload( $id ) {
			$conditions = get_post_meta( $id, UiChemy_Template_CPT::META_CONDITIONS, true );
			$conditions = UiChemy_Template_Store::sanitize_conditions( $conditions );

			// Resolve include/exclude IDs to titles so the UI can label them
			// without a second round-trip.
			$decode  = static function ( $text ) {
				return html_entity_decode( (string) $text, ENT_QUOTES, 'UTF-8' );
			};
			$labeler = static function ( $ids ) use ( $decode ) {
				$out = array();
				foreach ( (array) $ids as $pid ) {
					$title = get_the_title( $pid );
					$out[] = array(
						'id'    => (int) $pid,
						'title' => '' !== $title ? $decode( $title ) : sprintf( '#%d', $pid ),
					);
				}
				return $out;
			};

			$editor        = UiChemy_Template_CPT::editor_for( $id );
			$tpl_type      = (string) get_post_meta( $id, UiChemy_Template_CPT::META_TYPE, true );
			$target        = UiChemy_Template_CPT::target_for( $id );
			$elementor_url = add_query_arg(
				array(
					'post'   => $id,
					'action' => 'elementor',
				),
				admin_url( 'post.php' )
			);
			$gutenberg_url = add_query_arg(
				array(
					'post'   => $id,
					'action' => 'edit',
				),
				admin_url( 'post.php' )
			);

			return array(
				'id'            => (int) $id,
				'title'         => $decode( get_the_title( $id ) ),
				'type'          => $tpl_type,
				// The context a single/archive template targets, plus a human label
				// for it, so the Grid can distinguish a "Single Post" from a
				// "Single Page" / "Any Singular" template (they otherwise look alike).
				'target'        => $target,
				'targetLabel'   => self::target_label( $tpl_type, $target ),
				'status'        => 'active' === get_post_meta( $id, UiChemy_Template_CPT::META_STATUS, true ) ? 'active' : 'inactive',
				'editor'        => $editor,
				'conditions'    => $conditions,
				'includeLabels' => $labeler( $conditions['include'] ),
				'excludeLabels' => $labeler( $conditions['exclude'] ),
				'rulesLabels'   => self::rules_labels( isset( $conditions['rules'] ) ? $conditions['rules'] : array() ),
				// Built server-side so the dashboard never spells the tag itself —
				// see UiChemy_Template_Shortcode::TAG on why it must not drift.
				'shortcode'     => class_exists( 'UiChemy_Template_Shortcode' )
					? UiChemy_Template_Shortcode::for_id( $id )
					: '',
				// editUrl opens the template's current editor.
				'editUrl'       => ( 'gutenberg' === $editor ) ? $gutenberg_url : $elementor_url,
				'elementorUrl'  => $elementor_url,
				'gutenbergUrl'  => $gutenberg_url,
				'previewUrl'    => add_query_arg(
					array(
						'uichemy_tb_preview' => $id,
						'_wpnonce'           => wp_create_nonce( 'uichemy_tb_preview_' . $id ),
					),
					home_url( '/' )
				),
			);
		}
	}
}
