<?php
/**
 * UiChemy_Template_Store — create and manage native Theme Builder templates.
 *
 * The single write/CRUD surface for `uichemy_template` posts. Both the MCP
 * builder and (later) the Theme Builder REST/UI call this, so template creation
 * behaves identically no matter where it is triggered from.
 *
 * Deliberately self-contained: it does not depend on UiChemy_Composer_Manager's
 * private MCP helpers. Callers that already have an assembled Elementor element
 * tree (e.g. the MCP path, which runs image sideloading + globals matching
 * first) pass it in via `elements`; callers that just want a blank template let
 * the store build a default Composer-widget tree.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Template_Store' ) ) {

	/**
	 * Creates and manages uichemy_template posts.
	 */
	class UiChemy_Template_Store {

		/**
		 * Create a native Theme Builder template.
		 *
		 * @param array $args {
		 *     Template arguments.
		 *
		 *     @type string $type       Required. header|footer|error_404.
		 *     @type string $title      Post title. Defaults to a type-derived title.
		 *     @type string $status     active|inactive. Default 'inactive'.
		 *     @type array  $conditions Display-conditions rule set. Default array().
		 *     @type array  $elements   Pre-built Elementor element tree. When omitted a
		 *                              default single-Composer-widget tree is built from the
		 *                              html/css/js below.
		 *     @type string $html       Composer widget raw_html (used only when $elements is absent).
		 *     @type string $css        Composer widget raw_css  (used only when $elements is absent).
		 *     @type string $js         Composer widget raw_js   (used only when $elements is absent).
		 *     @type string $label      Composer widget _title.
		 * }
		 * @return int|WP_Error New post ID, or WP_Error on failure.
		 */
		public static function create( $args ) {
			if ( ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return new WP_Error( 'uichemy_tb_missing', 'Theme Builder is not initialised.' );
			}

			$args = is_array( $args ) ? $args : array();
			$type = isset( $args['type'] ) ? sanitize_key( (string) $args['type'] ) : '';
			if ( ! UiChemy_Template_CPT::is_valid_type( $type ) ) {
				// A real type that this build simply doesn't include gets a Pro
				// message; anything else is a genuine bad request.
				if ( UiChemy_Template_CPT::is_known_type( $type ) ) {
					return new WP_Error(
						'uichemy_tb_pro_type',
						sprintf( '"%s" templates are a UiChemy Pro feature.', $type ),
						array( 'status' => 403 )
					);
				}
				return new WP_Error( 'uichemy_tb_bad_type', 'Template "type" must be one of: ' . implode( ', ', UiChemy_Template_CPT::allowed_types() ) . '.' );
			}

			$title = isset( $args['title'] ) && '' !== trim( (string) $args['title'] )
				? sanitize_text_field( (string) $args['title'] )
				: self::default_title( $type );

			$status     = ( isset( $args['status'] ) && 'active' === $args['status'] ) ? 'active' : 'inactive';
			$conditions = isset( $args['conditions'] ) ? self::sanitize_conditions( $args['conditions'] ) : array();
			$editor     = ( isset( $args['editor'] ) && 'gutenberg' === $args['editor'] ) ? 'gutenberg' : 'elementor';
			$target     = self::sanitize_target( isset( $args['target'] ) ? $args['target'] : 'any' );

			$postarr = array(
				'post_title'  => $title,
				'post_type'   => UiChemy_Template_CPT::POST_TYPE,
				'post_status' => 'publish',
			);
			// A Gutenberg template stores block markup in post_content (empty on a
			// blank create); an Elementor template stores an element tree instead.
			if ( 'gutenberg' === $editor && isset( $args['content'] ) ) {
				$postarr['post_content'] = (string) $args['content'];
			}

			$post_id = wp_insert_post( $postarr, true );

			if ( is_wp_error( $post_id ) || ! $post_id ) {
				return is_wp_error( $post_id )
					? $post_id
					: new WP_Error( 'uichemy_tb_insert_failed', 'Failed to create the template post.' );
			}

			// If this template is created active, make sure it is the only active
			// one for its type. We never touch other systems' (Pro/Nexter)
			// templates here — that is a coexistence decision surfaced elsewhere.
			if ( 'active' === $status ) {
				self::deactivate_others_in_slot( $type, $target, $post_id, $conditions );
			}

			update_post_meta( $post_id, UiChemy_Template_CPT::META_TYPE, $type );
			update_post_meta( $post_id, UiChemy_Template_CPT::META_STATUS, $status );
			update_post_meta( $post_id, UiChemy_Template_CPT::META_CONDITIONS, $conditions );
			update_post_meta( $post_id, UiChemy_Template_CPT::META_EDITOR, $editor );
			update_post_meta( $post_id, UiChemy_Template_CPT::META_TARGET, $target );

			// Only Elementor templates carry Elementor document meta; a Gutenberg
			// template is left as a plain block-editor post so it opens cleanly in
			// Gutenberg and renders through do_blocks().
			if ( 'elementor' === $editor ) {
				$elements = ( isset( $args['elements'] ) && is_array( $args['elements'] ) && ! empty( $args['elements'] ) )
					? $args['elements']
					: self::default_elements(
						$type,
						array(
							'_title'   => isset( $args['label'] ) ? sanitize_text_field( (string) $args['label'] ) : $title,
							'raw_html' => isset( $args['html'] ) ? (string) $args['html'] : '',
							'raw_css'  => isset( $args['css'] ) ? (string) $args['css'] : '',
							'raw_js'   => isset( $args['js'] ) ? (string) $args['js'] : '',
						)
					);
				update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
				update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
				// Elementor expects this meta as an array; a JSON string can fatal
				// on strict type checks (see UiChemy_Composer_Manager normalisation).
				update_post_meta( $post_id, '_elementor_page_settings', array() );
			}

			self::flush_elementor_cache();

			return (int) $post_id;
		}

		/**
		 * Build a default element tree: one zeroed Elementor container holding a
		 * single Composer widget.
		 *
		 * The container zeroes padding / margin / flex-gap (Elementor's kit
		 * defaults otherwise fight the widget's own spacing) and carries the
		 * semantic tag for the location (header → <header>, footer → <footer>).
		 *
		 * @param string $type            Template type.
		 * @param array  $widget_settings Composer widget settings (raw_html/raw_css/raw_js/_title).
		 * @return array Elementor elements tree.
		 */
		public static function default_elements( $type, $widget_settings = array() ) {
			$container_id = strtolower( wp_generate_password( 7, false, false ) );
			$widget_id    = strtolower( wp_generate_password( 7, false, false ) );

			$zero_box = array(
				'unit'     => 'px',
				'top'      => '0',
				'right'    => '0',
				'bottom'   => '0',
				'left'     => '0',
				'isLinked' => true,
			);

			$container_settings = array(
				'content_width' => 'full',
				'html_tag'      => UiChemy_Template_CPT::container_tag_for_type( $type ),
				'padding'       => $zero_box,
				'margin'        => $zero_box,
				'flex_gap'      => array(
					'unit'     => 'px',
					'size'     => 0,
					'sizes'    => array(),
					'column'   => '0',
					'row'      => '0',
					'isLinked' => true,
				),
			);

			return array(
				array(
					'id'       => $container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => $container_settings,
					'elements' => array(
						array(
							'id'         => $widget_id,
							'elType'     => 'widget',
							'widgetType' => 'uichemy-composer',
							'settings'   => is_array( $widget_settings ) ? $widget_settings : array(),
							'elements'   => array(),
						),
					),
				),
			);
		}

		/**
		 * All templates of a given type, newest first.
		 *
		 * @param string $type Template type.
		 * @return int[] Post IDs.
		 */
		public static function get_by_type( $type ) {
			if ( ! UiChemy_Template_CPT::is_valid_type( $type ) ) {
				return array();
			}

			return get_posts(
				array(
					'post_type'      => UiChemy_Template_CPT::POST_TYPE,
					'post_status'    => 'publish',
					'posts_per_page' => -1,
					'orderby'        => 'date',
					'order'          => 'DESC',
					'fields'         => 'ids',
					'meta_key'       => UiChemy_Template_CPT::META_TYPE, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
					'meta_value'     => $type, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				)
			);
		}

		/**
		 * The IDs of active templates for a type (newest first).
		 *
		 * @param string $type Template type.
		 * @return int[] Post IDs.
		 */
		public static function get_active( $type ) {
			if ( ! UiChemy_Template_CPT::is_valid_type( $type ) ) {
				return array();
			}

			return get_posts(
				array(
					'post_type'      => UiChemy_Template_CPT::POST_TYPE,
					'post_status'    => 'publish',
					'posts_per_page' => -1,
					'orderby'        => 'date',
					'order'          => 'DESC',
					'fields'         => 'ids',
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					'meta_query'     => array(
						'relation' => 'AND',
						array(
							'key'   => UiChemy_Template_CPT::META_TYPE,
							'value' => $type,
						),
						array(
							'key'   => UiChemy_Template_CPT::META_STATUS,
							'value' => 'active',
						),
					),
				)
			);
		}

		/**
		 * Persist a template's display conditions.
		 *
		 * @param int   $post_id    Template post ID.
		 * @param array $conditions Rule set.
		 * @return bool
		 */
		public static function update_conditions( $post_id, $conditions ) {
			if ( ! self::is_template( $post_id ) ) {
				return false;
			}
			update_post_meta( $post_id, UiChemy_Template_CPT::META_CONDITIONS, self::sanitize_conditions( $conditions ) );
			return true;
		}

		/**
		 * Activate or deactivate a template. Activating a header/footer/404
		 * deactivates the other templates of the same type (one active per type).
		 *
		 * @param int    $post_id Template post ID.
		 * @param string $status  active|inactive.
		 * @return bool
		 */
		public static function set_status( $post_id, $status ) {
			if ( ! self::is_template( $post_id ) ) {
				return false;
			}
			$status = ( 'active' === $status ) ? 'active' : 'inactive';
			if ( 'active' === $status ) {
				$type   = (string) get_post_meta( $post_id, UiChemy_Template_CPT::META_TYPE, true );
				$target = UiChemy_Template_CPT::target_for( $post_id );
				self::deactivate_others_in_slot( $type, $target, $post_id );
			}
			update_post_meta( $post_id, UiChemy_Template_CPT::META_STATUS, $status );
			self::flush_elementor_cache();
			return true;
		}

		/**
		 * Delete a template.
		 *
		 * @param int  $post_id     Template post ID.
		 * @param bool $force_delete Skip trash. Default true.
		 * @return bool
		 */
		public static function delete( $post_id, $force_delete = true ) {
			if ( ! self::is_template( $post_id ) ) {
				return false;
			}
			$result = wp_delete_post( $post_id, $force_delete );
			self::flush_elementor_cache();
			return (bool) $result;
		}

		/**
		 * Mark every OTHER template of a type inactive.
		 *
		 * @param string $type       Template type.
		 * @param int    $except_id  Template to leave untouched.
		 * @return int Number of templates deactivated.
		 */
		public static function deactivate_others_of_type( $type, $except_id ) {
			$count = 0;
			foreach ( self::get_by_type( $type ) as $id ) {
				if ( (int) $id === (int) $except_id ) {
					continue;
				}
				if ( 'active' === get_post_meta( $id, UiChemy_Template_CPT::META_STATUS, true ) ) {
					update_post_meta( $id, UiChemy_Template_CPT::META_STATUS, 'inactive' );
					++$count;
				}
			}
			return $count;
		}

		/**
		 * The "slot" a template occupies — the unit within which only one template
		 * may be active. header/footer/search/404/single_product/product_archive
		 * are one slot per type; single/archive split further by their target so a
		 * "Single Post" and a "Single Page" template can both be active at once.
		 *
		 * @param string $type   Template type.
		 * @param string $target Template target.
		 * @return string
		 */
		private static function slot_key( $type, $target, $post_id = 0 ) {
			if ( in_array( $type, array( 'single', 'archive' ), true ) ) {
				return $type . '|' . $target;
			}

			/*
			 * header/footer are NOT a single global slot. Both carry display
			 * conditions, and the resolver already picks between several active
			 * ones by condition specificity (see
			 * UiChemy_Template_Resolver::best_match) — so a site can legitimately
			 * run one header for the shop, another for the blog, and a third as
			 * the site-wide fallback, all active at once.
			 *
			 * Collapsing them to one slot made activating any header silently
			 * deactivate every other, which threw away exactly the setup the
			 * conditions were written for. Keying by the conditions instead means
			 * only a template competing for the SAME condition set gets replaced,
			 * which is the real conflict.
			 */
			if ( in_array( $type, array( 'header', 'footer' ), true ) ) {
				return $type . '|' . self::conditions_key( (int) $post_id );
			}

			return $type;
		}

		/**
		 * Stable key for a template's display conditions, used to tell "the same
		 * placement" apart from "a different placement" when deciding what an
		 * activation should replace.
		 *
		 * @param int $post_id Template post ID.
		 * @return string
		 */
		private static function conditions_key( $post_id, $conditions = null ) {
			if ( null === $conditions ) {
				$conditions = $post_id ? get_post_meta( $post_id, UiChemy_Template_CPT::META_CONDITIONS, true ) : array();
			}
			if ( ! is_array( $conditions ) || empty( $conditions ) ) {
				return 'any';
			}
			// Order must not matter: two templates set to the same places are the
			// same slot however the UI happened to store them.
			$normalized = wp_json_encode( self::normalize_conditions_for_key( $conditions ) );
			return $normalized ? md5( $normalized ) : 'any';
		}

		/**
		 * Recursively sort a conditions array so equal sets serialise identically.
		 *
		 * @param mixed $value Conditions value.
		 * @return mixed
		 */
		private static function normalize_conditions_for_key( $value ) {
			if ( ! is_array( $value ) ) {
				return $value;
			}
			$out = array();
			foreach ( $value as $k => $v ) {
				$out[ $k ] = self::normalize_conditions_for_key( $v );
			}
			if ( wp_is_numeric_array( $out ) ) {
				sort( $out );
			} else {
				ksort( $out );
			}
			return $out;
		}

		/**
		 * Deactivate every OTHER active template sharing the same slot.
		 *
		 * @param string $type      Template type.
		 * @param string $target    Template target.
		 * @param int    $except_id Template to leave untouched.
		 * @return int Number deactivated.
		 */
		public static function deactivate_others_in_slot( $type, $target, $except_id, $conditions = null ) {
			// On the create path the new template's conditions meta is not written
			// yet, so the caller passes them in; elsewhere they are read back off
			// the post.
			$slot  = in_array( $type, array( 'header', 'footer' ), true )
				? $type . '|' . self::conditions_key( (int) $except_id, $conditions )
				: self::slot_key( $type, $target, (int) $except_id );
			$count = 0;
			foreach ( self::get_by_type( $type ) as $id ) {
				if ( (int) $id === (int) $except_id ) {
					continue;
				}
				if ( self::slot_key( $type, UiChemy_Template_CPT::target_for( $id ), (int) $id ) !== $slot ) {
					continue;
				}
				if ( 'active' === get_post_meta( $id, UiChemy_Template_CPT::META_STATUS, true ) ) {
					update_post_meta( $id, UiChemy_Template_CPT::META_STATUS, 'inactive' );
					++$count;
				}
			}
			return $count;
		}

		/**
		 * Normalise a template target string (see UiChemy_Template_CPT::META_TARGET).
		 *
		 * @param mixed $target Raw target.
		 * @return string
		 */
		public static function sanitize_target( $target ) {
			$target = is_string( $target ) ? trim( $target ) : '';
			if ( '' === $target ) {
				return 'any';
			}
			if ( 0 === strpos( $target, 'pt:' ) ) {
				$name = sanitize_key( substr( $target, 3 ) );
				return '' !== $name ? 'pt:' . $name : 'any';
			}
			if ( 0 === strpos( $target, 'tax:' ) ) {
				$name = sanitize_key( substr( $target, 4 ) );
				return '' !== $name ? 'tax:' . $name : 'any';
			}
			return in_array( $target, array( 'any', 'front', 'blog', 'author', 'date' ), true ) ? $target : 'any';
		}

		/**
		 * Normalise a display-conditions payload.
		 *
		 * v1 supports the "entire site" default plus explicit include/exclude of
		 * specific post/page IDs. The shape is intentionally forward-compatible so
		 * later phases (archive/taxonomy targeting) can extend it without a
		 * migration:
		 *
		 *   array(
		 *     'scope'   => 'entire'|'specific',  // 'entire' = whole site
		 *     'include' => int[],                // post IDs to include
		 *     'exclude' => int[],                // post IDs to exclude
		 *   )
		 *
		 * @param mixed $conditions Raw conditions.
		 * @return array
		 */
		public static function sanitize_conditions( $conditions ) {
			$conditions = is_array( $conditions ) ? $conditions : array();

			$scope = isset( $conditions['scope'] ) && 'specific' === $conditions['scope'] ? 'specific' : 'entire';

			$to_ids = static function ( $list ) {
				if ( ! is_array( $list ) ) {
					return array();
				}
				$ids = array_values( array_unique( array_filter( array_map( 'absint', $list ) ) ) );
				return $ids;
			};

			return array(
				'scope'   => $scope,
				'include' => isset( $conditions['include'] ) ? $to_ids( $conditions['include'] ) : array(),
				'exclude' => isset( $conditions['exclude'] ) ? $to_ids( $conditions['exclude'] ) : array(),  // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_exclude -- Small admin-scoped exclusion list.
				'rules'   => isset( $conditions['rules'] ) ? self::sanitize_condition_rules( $conditions['rules'] ) : array(),
			);
		}

		/**
		 * Sanitize the v2 `rules` list (additive; the legacy scope/include/exclude
		 * fields are preserved so old templates and the pre-rebuild UI keep working).
		 * Invalid rules are dropped.
		 *
		 * @param mixed $rules Raw rules list.
		 * @return array<int,array<string,mixed>>
		 */
		public static function sanitize_condition_rules( $rules ) {
			if ( ! is_array( $rules ) ) {
				return array();
			}
			$out = array();
			foreach ( $rules as $rule ) {
				$norm = self::sanitize_one_condition_rule( $rule );
				if ( null !== $norm ) {
					$out[] = $norm;
				}
			}
			return $out;
		}

		/**
		 * Normalize a single display-condition rule, or null if invalid.
		 *
		 * @param mixed $rule Raw rule.
		 * @return array<string,mixed>|null
		 */
		private static function sanitize_one_condition_rule( $rule ) {
			if ( ! is_array( $rule ) ) {
				return null;
			}
			$type  = isset( $rule['type'] ) ? sanitize_key( $rule['type'] ) : '';
			$match = ( isset( $rule['match'] ) && 'exclude' === $rule['match'] ) ? 'exclude' : 'include';

			switch ( $type ) {
				case 'entire':
				case 'search':
					return array(
						'match' => $match,
						'type'  => $type,
					);
				case 'post_type':
					$pt = isset( $rule['value'] ) ? sanitize_key( $rule['value'] ) : '';
					return '' !== $pt ? array(
						'match' => $match,
						'type'  => $type,
						'value' => $pt,
					) : null;
				case 'taxonomy':
					$tax = isset( $rule['taxonomy'] ) ? sanitize_key( $rule['taxonomy'] ) : '';
					if ( '' === $tax ) {
						return null;
					}
					return array(
						'match'    => $match,
						'type'     => $type,
						'taxonomy' => $tax,
						'term'     => isset( $rule['term'] ) ? absint( $rule['term'] ) : 0,
					);
				case 'author':
					return array(
						'match' => $match,
						'type'  => $type,
						'value' => isset( $rule['value'] ) ? absint( $rule['value'] ) : 0,
					);
				case 'singular':
					$id = isset( $rule['value'] ) ? absint( $rule['value'] ) : 0;
					return $id ? array(
						'match' => $match,
						'type'  => $type,
						'value' => $id,
					) : null;
			}
			return null;
		}

		/**
		 * Whether a post ID is a uichemy_template.
		 *
		 * @param int $post_id Post ID.
		 * @return bool
		 */
		public static function is_template( $post_id ) {
			return $post_id && UiChemy_Template_CPT::POST_TYPE === get_post_type( $post_id );
		}

		/**
		 * Default title for a template type.
		 *
		 * @param string $type Template type.
		 * @return string
		 */
		private static function default_title( $type ) {
			switch ( $type ) {
				case 'header':
					return __( 'Header (UiChemy)', 'uichemy' );
				case 'footer':
					return __( 'Footer (UiChemy)', 'uichemy' );
				case 'single':
					return __( 'Single Post or Page (UiChemy)', 'uichemy' );
				case 'archive':
					return __( 'Archive (UiChemy)', 'uichemy' );
				case 'single_product':
					return __( 'Single Product (UiChemy)', 'uichemy' );
				case 'product_archive':
					return __( 'Products Archive (UiChemy)', 'uichemy' );
				case 'search':
					return __( 'Search Results (UiChemy)', 'uichemy' );
				case 'error_404':
					return __( '404 Page (UiChemy)', 'uichemy' );
				default:
					return __( 'Template (UiChemy)', 'uichemy' );
			}
		}

		/**
		 * Flush Elementor's compiled CSS/JS file cache.
		 *
		 * @return void
		 */
		private static function flush_elementor_cache() {
			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}
		}
	}
}
