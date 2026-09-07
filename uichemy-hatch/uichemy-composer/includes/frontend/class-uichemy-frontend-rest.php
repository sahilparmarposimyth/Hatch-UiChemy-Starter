<?php
/**
 * Frontend editor REST — read/write a Composer widget's code from the live page.
 *
 * Backs the Phase F2 frontend bridge: the picked widget's raw_html/raw_css/raw_js
 * are fetched here (GET) and saved here (POST), reusing the same executor that
 * powers the find-and-update-section-code ability. Admin/editor-gated.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Frontend_REST' ) ) {

	/**
	 * REST routes for the frontend composer editor.
	 */
	class UiChemy_Frontend_REST {

		const REST_NAMESPACE       = 'uichemy/v1';
		const SELECTED_ELEMENT_TTL = 30 * MINUTE_IN_SECONDS;

		/**
		 * Hook route registration.
		 */
		public static function init() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		}

		/**
		 * Register GET/POST /uichemy/v1/frontend/section and
		 * GET/POST /uichemy/v1/selected-element.
		 */
		public static function register_routes() {
			register_rest_route(
				self::REST_NAMESPACE,
				'/frontend/section',
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'handle_get' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
						'args'                => array(
							'post_id'      => array(
								'required' => true,
								'type'     => 'integer',
							),
							'widget_index' => array(
								'required' => false,
								'type'     => 'integer',
							),
							'builder'      => array(
								'required' => false,
								'type'     => 'string',
							),
							'uid'          => array(
								'required' => false,
								'type'     => 'string',
							),
						),
					),
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'handle_set' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
					),
				)
			);

			// Every Composer widget on a post in one response. The live-page editor
			// calls this once on load to warm its cache, so hovering and switching
			// between sections afterwards costs no requests.
			register_rest_route(
				self::REST_NAMESPACE,
				'/frontend/sections',
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'handle_get_all' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
						'args'                => array(
							'post_id' => array(
								'required' => true,
								'type'     => 'integer',
							),
						),
					),
				)
			);

			register_rest_route(
				self::REST_NAMESPACE,
				'/selected-element',
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'handle_get_selected_element' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
						'args'                => array(
							'post_id' => array(
								'required' => false,
								'type'     => 'integer',
							),
						),
					),
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'handle_post_selected_element' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
					),
				)
			);

			// Server-render a snippet of raw_html with dynamic tokens resolved, so the
			// live front-end editor can preview a `{{ … }}` binding WITHOUT a full page
			// refresh (dynamic tags resolve only on the server).
			register_rest_route(
				self::REST_NAMESPACE,
				'/frontend/render',
				array(
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'handle_render' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
					),
				)
			);

			// Create a NEW UiChemy Composer widget on the page from the live front end.
			// There is no builder editor model on the public page, so the widget is
			// appended server-side to the post's stored builder content and the client
			// reloads to show it (see handle_insert + the frontend bridge).
			register_rest_route(
				self::REST_NAMESPACE,
				'/frontend/insert',
				array(
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'handle_insert' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
					),
				)
			);

			// Composer change-history log (Phase 3) — a capped JSON array in the
			// post's `_uichemy_history` meta so the History panel survives reload and
			// shows who/when across sessions. GET reads it; POST appends one entry.
			register_rest_route(
				self::REST_NAMESPACE,
				'/history',
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'handle_history_get' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
						'args'                => array(
							'post_id' => array(
								'required' => true,
								'type'     => 'integer',
							),
						),
					),
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'handle_history_post' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
					),
				)
			);
		}

		const HISTORY_META = '_uichemy_history';
		/** Hard ceiling on the stored diff-blob (bytes) — a safety net, not the cap. */
		const HISTORY_MAX_BYTES = 786432; // 768 KB

		/**
		 * GET — the post's history diff-blob. The client owns its shape (base +
		 * per-widget forward deltas, see composer-history-db.js); the server just
		 * stores/returns it verbatim.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_history_get( $request ) {
			$post_id = absint( $request->get_param( 'post_id' ) );
			$guard   = self::guard_post( $post_id );
			if ( is_wp_error( $guard ) ) {
				return $guard;
			}
			$raw  = get_post_meta( $post_id, self::HISTORY_META, true );
			$data = is_string( $raw ) && '' !== $raw ? json_decode( $raw, true ) : null;
			if ( ! is_array( $data ) ) {
				$data = new stdClass();
			}
			return rest_ensure_response( array( 'data' => $data ) );
		}

		/**
		 * POST — replace the post's history diff-blob. Body: { post_id, data }.
		 * `data` is the client-managed blob (already capped/rebased client-side via
		 * jsondiffpatch); the server only enforces a byte ceiling and stores it as a
		 * JSON STRING so the nested delta arrays survive meta's array-unslash intact.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_history_post( $request ) {
			$post_id = absint( $request->get_param( 'post_id' ) );
			$guard   = self::guard_post( $post_id );
			if ( is_wp_error( $guard ) ) {
				return $guard;
			}

			$data = $request->get_param( 'data' );
			if ( ! is_array( $data ) ) {
				return new WP_Error( 'uichemy_bad_history', 'data must be an object.', array( 'status' => 400 ) );
			}
			$json = wp_json_encode( $data );
			if ( ! is_string( $json ) ) {
				return new WP_Error( 'uichemy_bad_history', 'data is not encodable.', array( 'status' => 400 ) );
			}
			if ( strlen( $json ) > self::HISTORY_MAX_BYTES ) {
				return new WP_Error( 'uichemy_history_too_big', 'History log exceeds the size limit.', array( 'status' => 413 ) );
			}
			// Stored as a STRING (wp_slash'd) so nested text-diff arrays are not
			// unslashed by update_metadata.
			update_post_meta( $post_id, self::HISTORY_META, wp_slash( $json ) );

			return rest_ensure_response(
				array(
					'success' => true,
					'bytes'   => strlen( $json ),
				)
			);
		}

		/**
		 * POST — append a new UiChemy Composer widget to the post's builder content
		 * from the front end, then return its new id. Builder-aware.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_insert( $request ) {
			$post_id      = absint( $request->get_param( 'post_id' ) );
			$builder      = sanitize_key( (string) $request->get_param( 'builder' ) );
			$html         = (string) $request->get_param( 'html' );
			$css          = (string) $request->get_param( 'css' );
			$js           = (string) $request->get_param( 'js' );
			$label        = sanitize_text_field( (string) $request->get_param( 'label' ) );
			$insert_index = null === $request->get_param( 'insert_index' ) ? 100000 : (int) $request->get_param( 'insert_index' );

			if ( '' === $label ) {
				$label = 'New Section';
			}

			$guard = self::guard_post( $post_id );
			if ( is_wp_error( $guard ) ) {
				return $guard;
			}
			if ( '' === trim( $html ) && '' === trim( $css ) ) {
				return new WP_Error( 'uichemy_empty_code', 'At least html or css must be provided.', array( 'status' => 400 ) );
			}
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uichemy_no_dep', 'Composer manager class missing.', array( 'status' => 500 ) );
			}

			if ( 'gutenberg' === $builder ) {
				$result = UiChemy_Composer_Manager::mcp_insert_gutenberg_section(
					$post_id,
					array(
						'html'  => $html,
						'css'   => $css,
						'js'    => $js,
						'label' => $label,
					)
				);
			} elseif ( 'bricks' === $builder ) {
				$result = UiChemy_Composer_Manager::mcp_insert_bricks_section(
					$post_id,
					array(
						'html'  => $html,
						'css'   => $css,
						'js'    => $js,
						'label' => $label,
					)
				);
			} else {
				// Elementor (default) — reuse the existing server-side inserter.
				$result = UiChemy_Composer_Manager::mcp_insert_section_at_index(
					array(
						'post_id'       => $post_id,
						'insert_index'  => $insert_index,
						'label'         => $label,
						'source'        => 'frontend',
						'html'          => $html,
						'css'           => $css,
						'js'            => $js,
						'upload_images' => true,
					)
				);
			}

			if ( is_wp_error( $result ) ) {
				return $result;
			}
			return rest_ensure_response(
				array(
					'success' => true,
					'result'  => $result,
				)
			);
		}

		/**
		 * POST — resolve dynamic tokens ({{ … }} / {% … %}) in a raw_html snippet
		 * against a post's context and return the rendered HTML. Used for live
		 * dynamic-value preview on the front end (no refresh).
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_render( $request ) {
			$post_id = absint( $request->get_param( 'post_id' ) );
			$html    = (string) $request->get_param( 'html' );
			$uid     = sanitize_text_field( (string) $request->get_param( 'uid' ) );

			$guard = self::guard_post( $post_id );
			if ( is_wp_error( $guard ) ) {
				return $guard;
			}

			$resolved = $html;
			if ( class_exists( 'Uich_Dynamic' ) && Uich_Dynamic::has_dynamic( $html ) ) {
				// Set up the target post as the current context so `{{ post.* }}` and
				// friends resolve against it (a REST request has no page loop of its own).
				global $post;
				$prev_post = $post;
				$target    = $post_id ? get_post( $post_id ) : null;
				if ( $target ) {
					$post = $target; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
					setup_postdata( $post );
				}
				$resolved = Uich_Dynamic::render_html( $html, array( 'widget_id' => $uid ) );
				wp_reset_postdata();
				$post = $prev_post; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
			}

			return rest_ensure_response( array( 'html' => $resolved ) );
		}

		/**
		 * Base capability check (per-post capability is verified in handlers).
		 *
		 * @return bool
		 */
		public static function check_permission() {
			if ( class_exists( 'UiChemy_Roles' ) ) {
				return UiChemy_Roles::can_edit();
			}
			return is_user_logged_in() && current_user_can( 'edit_posts' );
		}

		/**
		 * GET — return { widget_id, widget_index, total_widgets, label, html, css, js }.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_get( $request ) {
			$post_id      = absint( $request->get_param( 'post_id' ) );
			$widget_index = (int) $request->get_param( 'widget_index' );
			$element_id   = sanitize_text_field( (string) $request->get_param( 'element_id' ) );
			$builder      = sanitize_key( (string) $request->get_param( 'builder' ) );
			$uid          = sanitize_text_field( (string) $request->get_param( 'uid' ) );

			$guard = self::guard_post( $post_id );
			if ( is_wp_error( $guard ) ) {
				return $guard;
			}

			if ( 'gutenberg' === $builder ) {
				if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
					return new WP_Error( 'uichemy_no_dep', 'Composer manager class missing.', array( 'status' => 500 ) );
				}
				$result = UiChemy_Composer_Manager::mcp_get_gutenberg_section_code( $post_id, $uid );
				if ( is_wp_error( $result ) ) {
					return $result;
				}
				return rest_ensure_response( $result );
			}

			if ( 'bricks' === $builder ) {
				if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
					return new WP_Error( 'uichemy_no_dep', 'Composer manager class missing.', array( 'status' => 500 ) );
				}
				$result = UiChemy_Composer_Manager::mcp_get_bricks_section_code( $post_id, $uid );
				if ( is_wp_error( $result ) ) {
					return $result;
				}
				return rest_ensure_response( $result );
			}

			// The composer's Page/Site Code panes need the site-wide code, so the
			// last argument requests it explicitly.
			$result = UiChemy_Composer_Manager::mcp_get_section_code( $post_id, $widget_index, $element_id, true );

			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return rest_ensure_response( $result );
		}

		/**
		 * GET — every Composer widget on the post, with its code, in one response.
		 *
		 * A page with no Composer widgets is a normal, empty answer here (the editor
		 * simply has nothing to cache), not an error — unlike the single-widget read,
		 * where "no widgets" means the caller asked for something that isn't there.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_get_all( $request ) {
			$post_id = absint( $request->get_param( 'post_id' ) );

			$guard = self::guard_post( $post_id );
			if ( is_wp_error( $guard ) ) {
				return $guard;
			}

			$result = UiChemy_Composer_Manager::mcp_get_all_section_code( $post_id, true );
			if ( is_wp_error( $result ) ) {
				// Nothing to cache for this post — hand back an empty set so the
				// editor can carry on instead of logging a failure.
				return rest_ensure_response(
					array(
						'post_id'       => $post_id,
						'total_widgets' => 0,
						'widgets'       => array(),
					)
				);
			}

			return rest_ensure_response( $result );
		}

		/**
		 * POST — save html/css/js back to the widget (Phase F3).
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_set( $request ) {
			$post_id      = absint( $request->get_param( 'post_id' ) );
			$widget_index = (int) $request->get_param( 'widget_index' );
			$element_id   = sanitize_text_field( (string) $request->get_param( 'element_id' ) );
			$html         = (string) $request->get_param( 'html' );
			$css          = (string) $request->get_param( 'css' );
			$js           = (string) $request->get_param( 'js' );
			$builder      = sanitize_key( (string) $request->get_param( 'builder' ) );
			$uid          = sanitize_text_field( (string) $request->get_param( 'uid' ) );

			$guard = self::guard_post( $post_id );
			if ( is_wp_error( $guard ) ) {
				return $guard;
			}

			if ( 'gutenberg' === $builder ) {
				if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
					return new WP_Error( 'uichemy_no_dep', 'Composer manager class missing.', array( 'status' => 500 ) );
				}
				$result = UiChemy_Composer_Manager::mcp_set_gutenberg_section_code(
					$post_id,
					$uid,
					array(
						'html' => $html,
						'css'  => $css,
						'js'   => $js,
					)
				);
				if ( is_wp_error( $result ) ) {
					return $result;
				}
				return rest_ensure_response( $result );
			}

			if ( 'bricks' === $builder ) {
				if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
					return new WP_Error( 'uichemy_no_dep', 'Composer manager class missing.', array( 'status' => 500 ) );
				}
				$result = UiChemy_Composer_Manager::mcp_set_bricks_section_code(
					$post_id,
					$uid,
					array(
						'html' => $html,
						'css'  => $css,
						'js'   => $js,
					)
				);
				if ( is_wp_error( $result ) ) {
					return $result;
				}
				return rest_ensure_response( $result );
			}

			// Resolve the widget the GET side would have returned (element id preferred,
			// positional index as the fallback) so the write lands on that same widget,
			// then replace its html/css/js wholesale. Images are already uploaded by the
			// editor, so the media pass is skipped here.
			$target = UiChemy_Composer_Manager::mcp_get_section_code( $post_id, $widget_index, $element_id, false );
			if ( is_wp_error( $target ) ) {
				return $target;
			}

			$result = UiChemy_Composer_Manager::mcp_sync_generated_code_to_widget(
				$post_id,
				array(
					'mode'          => 'replace',
					'widget_id'     => isset( $target['widget_id'] ) ? (string) $target['widget_id'] : '',
					'html'          => $html,
					'css'           => $css,
					'js'            => $js,
					'upload_images' => false,
					'source'        => 'frontend',
				)
			);

			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return rest_ensure_response( $result );
		}

		/**
		 * Validate the post id + per-post edit capability + dependency class.
		 *
		 * @param int $post_id Post id.
		 * @return true|WP_Error
		 */
		private static function guard_post( $post_id ) {
			if ( ! $post_id ) {
				return new WP_Error( 'uichemy_bad_post', 'post_id is required.', array( 'status' => 400 ) );
			}
			if ( ! current_user_can( 'edit_post', $post_id ) ) {
				return new WP_Error( 'uichemy_forbidden', 'You cannot edit this post.', array( 'status' => 403 ) );
			}
			if ( ! class_exists( 'UiChemy_Composer_MCP_Server' ) ) {
				return new WP_Error( 'uichemy_no_dep', 'Composer server class missing.', array( 'status' => 500 ) );
			}
			return true;
		}

		// ── Selected-element snapshot (last-picked-element store) ──────────────

		/**
		 * GET — return the stored snapshot (optionally scoped to a post_id).
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response
		 */
		public static function handle_get_selected_element( $request ) {
			$post_id  = absint( $request->get_param( 'post_id' ) );
			$snapshot = self::read_selected_element( $post_id );

			if ( ! $snapshot ) {
				return rest_ensure_response( array( 'found' => false ) );
			}

			return rest_ensure_response( array_merge( array( 'found' => true ), $snapshot ) );
		}

		/**
		 * POST — save the currently-picked element's snapshot. Called by the
		 * composer (composer/src/composer-app.jsx) every time the Editor tab's
		 * selection changes.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function handle_post_selected_element( $request ) {
			$post_id   = absint( $request->get_param( 'post_id' ) );
			$widget_id = sanitize_text_field( (string) $request->get_param( 'widget_id' ) );
			$html      = (string) $request->get_param( 'html' );

			if ( ! $post_id || ! $widget_id || '' === trim( $html ) ) {
				return new WP_Error( 'uichemy_bad_selection', 'post_id, widget_id, and html are required.', array( 'status' => 400 ) );
			}
			if ( ! current_user_can( 'edit_post', $post_id ) ) {
				return new WP_Error( 'uichemy_forbidden', 'You cannot edit this post.', array( 'status' => 403 ) );
			}

			self::save_selected_element(
				array(
					'post_id'   => $post_id,
					'widget_id' => $widget_id,
					'tag'       => sanitize_text_field( (string) $request->get_param( 'tag' ) ),
					'selector'  => sanitize_text_field( (string) $request->get_param( 'selector' ) ),
					'path'      => sanitize_text_field( (string) $request->get_param( 'path' ) ),
					'html'      => $html,
				)
			);

			return rest_ensure_response( array( 'success' => true ) );
		}

		/**
		 * The current WP user's snapshot transient key. Per-user (not per-post)
		 * — "what's selected" belongs to one person's browser session.
		 *
		 * @return string
		 */
		private static function selected_element_key() {
			return 'uichemy_selected_el_' . get_current_user_id();
		}

		/**
		 * Persist a snapshot for the current user, refreshing the TTL. Public —
		 * called by class-uichemy-composer-mcp-server.php's update_code
		 * handler (via update_selected_element_html()) after a successful write.
		 *
		 * @param array $data { post_id, widget_id, tag, selector, path, html }.
		 */
		public static function save_selected_element( array $data ) {
			$data['saved_at'] = time();
			set_transient( self::selected_element_key(), $data, self::SELECTED_ELEMENT_TTL );
		}

		/**
		 * Read back the current user's snapshot. Called directly by
		 * class-uichemy-composer-mcp-server.php's grab /
		 * update_code handlers (no REST round-trip needed).
		 *
		 * @param int $post_id Optional — if given and it doesn't match the stored
		 *                     snapshot's post_id, treat it as "nothing selected"
		 *                     (avoids handing over a stale pick from a different
		 *                     page than the one the caller is asking about).
		 * @return array|null
		 */
		public static function read_selected_element( $post_id = 0 ) {
			$snapshot = get_transient( self::selected_element_key() );
			if ( ! is_array( $snapshot ) || empty( $snapshot['widget_id'] ) ) {
				return null;
			}
			if ( $post_id && (int) $snapshot['post_id'] !== (int) $post_id ) {
				return null;
			}
			return $snapshot;
		}

		/**
		 * Update just the `html` field of the current snapshot (and refresh its
		 * TTL) — called after update_code successfully writes a
		 * new outerHTML, so a follow-up edit chains against the new value
		 * without requiring the user to re-pick the element.
		 *
		 * @param string $new_html New outerHTML.
		 * @return array|null The updated snapshot, or null if none was stored.
		 */
		public static function update_selected_element_html( $new_html ) {
			$snapshot = self::read_selected_element();
			if ( ! $snapshot ) {
				return null;
			}
			$snapshot['html'] = (string) $new_html;
			self::save_selected_element( $snapshot );
			return $snapshot;
		}
	}

	UiChemy_Frontend_REST::init();
}
