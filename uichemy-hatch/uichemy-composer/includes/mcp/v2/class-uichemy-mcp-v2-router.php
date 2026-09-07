<?php
/**
 * UiChemy MCP v2 — the action routers behind the consolidated abilities.
 *
 * Each `uichemy/*` ability takes { action, action_parameters } and lands here;
 * every branch then hands off to the handler on UiChemy_Composer_MCP_Server that
 * already did the work, so v2 adds routing and validation but no second
 * implementation of anything. That is why v1 and v2 cannot drift: they execute
 * the same handlers.
 *
 * Nothing in v1 references this file. It exists purely so the consolidated
 * surface has a home of its own, separate from the flat-tool surface it
 * replaces.
 *
 * @link       https://posimyth.com/
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_MCP_V2_Router' ) ) {

	/**
	 * Routes every action-routed v2 ability to a shared handler.
	 */
	class UiChemy_MCP_V2_Router {

		/**
		 * Split an action-routed ability's input into { action, parameters }.
		 *
		 * Parameters arrive nested under `action_parameters` (the shape these
		 * abilities advertise, so each action can declare its own schema) but a flat
		 * payload is accepted too — the v1 tools passed flat arrays and the pipeline
		 * docs still describe them that way. Action names are normalised to
		 * underscores so "add-section" and "add_section" both route.
		 *
		 * @param array $arguments Raw ability input.
		 * @return array{0:string,1:array} The action name and its parameters.
		 */
		private static function unwrap_action( $arguments ) {
			$arguments = is_array( $arguments ) ? $arguments : array();
			$action    = isset( $arguments['action'] ) ? sanitize_key( str_replace( '-', '_', (string) $arguments['action'] ) ) : '';

			$params = array();
			if ( isset( $arguments['action_parameters'] ) && is_array( $arguments['action_parameters'] ) ) {
				$params = $arguments['action_parameters'];
			}

			// Flat fallback: anything passed alongside `action` is treated as a
			// parameter, with the nested block winning on a collision.
			$flat = $arguments;
			unset( $flat['action'], $flat['action_parameters'] );

			return array( $action, array_merge( $flat, $params ) );
		}

		/**
		 * uichemy-composer/describe-site — the same action shape as every other ability.
		 *
		 * The introspection itself lives in Uich_Dynamic, next to the dynamic-data
		 * engine whose field map it reports. This exists only so describe-site is
		 * addressed the way the rest are: { action, action_parameters }, with the flat
		 * payload still accepted, and its two actions declared in meta.actions so
		 * discovery lists them instead of showing the ability as one opaque call.
		 *
		 * @param array $arguments { action: schema|entities, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_describe_site( $arguments ) {
			if ( ! class_exists( 'Uich_Dynamic' ) || ! method_exists( 'Uich_Dynamic', 'describe_site' ) ) {
				return new WP_Error( 'uich_mcp_error', 'The dynamic-data engine is unavailable.' );
			}

			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( '' === $action ) {
				$action = 'schema';
			}
			if ( ! in_array( $action, array( 'schema', 'entities' ), true ) ) {
				return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: schema, entities.' );
			}

			return Uich_Dynamic::describe_site( array_merge( $params, array( 'action' => $action ) ) );
		}

		/**
		 * uichemy-composer/theme-builder — the NATIVE UiChemy theme builder.
		 *
		 * Distinct from uichemy-composer/template: that one drives Elementor Pro's
		 * elementor_library and Nexter's nxt_builder, while this stores templates in
		 * UiChemy's own CPT — which is what lets it run on free Elementor and cover
		 * archive / single_product / product_archive / search / error_404, types
		 * neither of those exposes here.
		 *
		 * The storage engine (UiChemy_Template_Store / _CPT / _Resolver) is not in the
		 * tree yet, so every action reports that plainly rather than half-working. The
		 * guard is the whole reason this is safe to register now.
		 *
		 * @param array $arguments { action, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_theme_builder( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}
			if ( ! class_exists( 'UiChemy_Template_Store' ) ) {
				return new WP_Error(
					'uich_tb_unavailable',
					'The native UiChemy Theme Builder is not installed on this site yet. For a header, footer or single template on Elementor Pro or Nexter, use uichemy-composer/template (action="create") instead.'
				);
			}

			switch ( $action ) {
				case 'create':
					return UiChemy_Composer_Manager::create_theme_builder_template( $params );

				case 'set_conditions':
					return UiChemy_Composer_Manager::mcp_set_theme_builder_conditions( $params );

				case 'list':
					return UiChemy_Composer_Manager::mcp_list_theme_builder_templates( $params );

				case 'toggle':
					return UiChemy_Composer_Manager::mcp_toggle_theme_builder_template( $params );

				case 'delete':
					return UiChemy_Composer_Manager::mcp_delete_theme_builder_template( $params );

				case 'architecture':
					// "list" answers what templates EXIST. This answers which slots the
					// site has at all and which of them are still falling through to
					// the theme — the question you have to ask before you can say what
					// is missing.
					if ( ! class_exists( 'UiChemy_Theme_Builder_Admin' )
						|| ! method_exists( 'UiChemy_Theme_Builder_Admin', 'architecture' ) ) {
						return new WP_Error( 'uich_mcp_error', 'The theme-builder architecture map is unavailable in this build.' );
					}
					return self::shape_architecture( UiChemy_Theme_Builder_Admin::architecture() );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". Valid: architecture, create, set-conditions, list, toggle, delete.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: architecture, create, set-conditions, list, toggle, delete.' );
			}
		}

		/**
		 * Turn the raw slot map into something a model can act on directly.
		 *
		 * The Canvas view draws the same payload and works out the gaps as it
		 * renders. An agent has no such pass, so the summary is computed here —
		 * otherwise the model has to scan every slot and infer which of them matter,
		 * which is exactly the sort of derivation it gets subtly wrong.
		 *
		 * Slots whose type this build cannot create are marked rather than dropped:
		 * they exist on the site either way, and an agent that cannot see them will
		 * keep proposing a template it is about to be refused.
		 *
		 * @param array $arch { site: array, slots: array[] }
		 * @return array
		 */
		private static function shape_architecture( $arch ) {
			$slots     = isset( $arch['slots'] ) && is_array( $arch['slots'] ) ? $arch['slots'] : array();
			$allowed   = class_exists( 'UiChemy_Template_CPT' ) ? UiChemy_Template_CPT::allowed_types() : array();
			$gaps      = array();
			$out       = array();
			$templates = 0;

			foreach ( $slots as $slot ) {
				$type       = isset( $slot['type'] ) ? (string) $slot['type'] : '';
				$creatable  = empty( $allowed ) || in_array( $type, $allowed, true );
				$filled     = ! empty( $slot['filled'] );
				$list       = isset( $slot['templates'] ) && is_array( $slot['templates'] ) ? $slot['templates'] : array();
				$templates += count( $list );

				$row = array(
					'key'       => isset( $slot['key'] ) ? $slot['key'] : '',
					'type'      => $type,
					'target'    => isset( $slot['target'] ) ? $slot['target'] : '',
					'label'     => isset( $slot['label'] ) ? $slot['label'] : '',
					'group'     => isset( $slot['group'] ) ? $slot['group'] : '',
					'critical'  => ! empty( $slot['critical'] ),
					'filled'    => $filled,
					'creatable' => $creatable,
					'templates' => array(),
				);
				if ( ! empty( $slot['sub_label'] ) ) {
					$row['sub_label'] = $slot['sub_label'];
				}
				foreach ( $list as $t ) {
					$row['templates'][] = array(
						'id'     => isset( $t['id'] ) ? (int) $t['id'] : 0,
						'title'  => isset( $t['title'] ) ? $t['title'] : '',
						'status' => isset( $t['status'] ) ? $t['status'] : '',
						'editor' => isset( $t['editor'] ) ? $t['editor'] : '',
					);
				}

				// A gap is a slot that MATTERS and that this build could actually
				// fill. A Pro-only slot in Free is not work the caller can do.
				if ( ! $filled && ! empty( $slot['critical'] ) && $creatable ) {
					$gaps[] = array(
						'key'   => $row['key'],
						'label' => $row['label'],
						'type'  => $type,
						'fix'   => 'uichemy-composer/theme-builder (action="create", type="' . $type . '"'
							. ( '' !== $row['target'] ? ', target="' . $row['target'] . '"' : '' ) . ')',
					);
				}

				$out[] = $row;
			}

			return array(
				'site'      => isset( $arch['site'] ) ? $arch['site'] : array(),
				'summary'   => array(
					'slots'     => count( $out ),
					'filled'    => count( array_filter( $out, static function ( $s ) { return $s['filled']; } ) ),
					'templates' => $templates,
					'gaps'      => count( $gaps ),
				),
				'gaps'      => $gaps,
				'slots'     => $out,
				'message'   => $gaps
					? 'These slots fall through to the active theme. Each gap names the call that fills it.'
					: 'Every critical slot this build can fill already has a template.',
			);
		}

		/**
		 * uichemy-composer/design-system — read, replace, or patch the #uichemy-globals block.
		 *
		 * The three verbs belong together because they are three ways of writing one
		 * file, and using them correctly means knowing about the other two: you read
		 * before you write, and you patch rather than replace unless you are laying
		 * the file down for the first time. As three separate tools that relationship
		 * had to be re-stated in every description.
		 *
		 * @param array $arguments { action: get|set|patch, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_design_system( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			switch ( $action ) {
				case 'get':
					return UiChemy_Composer_MCP_Server::execute_get_globals_css( $params );

				case 'set':
					return UiChemy_Composer_MCP_Server::execute_set_globals_css( $params );

				case 'patch':
					return UiChemy_Composer_MCP_Server::execute_edit_globals_css( $params );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". Valid: get, set, patch.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: get, set, patch.' );
			}
		}

		/**
		 * uichemy-composer/media — the media library: get an upload slot, then find, read and
		 * annotate what is in there.
		 *
		 * request-upload and find are two answers to the same question ("how do I get
		 * a real URL for this asset?"), and the cheaper answer is find: an asset that
		 * is already uploaded should be reused, not uploaded a second time. Keeping
		 * them in one ability is what makes that choice visible.
		 *
		 * @param array $arguments { action, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_media( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			switch ( $action ) {
				case 'request_upload':
					return UiChemy_Composer_MCP_Server::execute_request_media_upload( $params );

				case 'find':
					return UiChemy_Composer_Manager::mcp_media_find( $params );

				case 'get':
					return UiChemy_Composer_Manager::mcp_media_get( $params );

				case 'update':
					return UiChemy_Composer_Manager::mcp_media_update( $params );

				case 'list':
					return UiChemy_Composer_Manager::mcp_media_list( $params );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". Valid: request-upload, find, get, update, list.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: request-upload, find, get, update, list.' );
			}
		}

		/**
		 * uichemy-composer/dynamic — bind live WordPress content into a section.
		 *
		 * Everything here is markup generation, not a write: it hands back the exact
		 * Twig the engine understands so the caller does not guess accessor-vs-meta and
		 * get a silently-empty binding. Feed the result to page / post / template.
		 *
		 * @param array $arguments { action, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_dynamic( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			switch ( $action ) {
				case 'create_loop':
					return UiChemy_Composer_Manager::mcp_dynamic_create_loop( $params );

				case 'bind_field':
					return UiChemy_Composer_Manager::mcp_dynamic_bind_field( $params );

				case 'add_tag':
					return UiChemy_Composer_Manager::mcp_dynamic_add_tag( $params );

				case 'list_fields':
					// The one action here that reads the site rather than returning
					// markup: the catalog of tokens every other action expects you to
					// already know.
					if ( ! class_exists( 'Uich_Dynamic' ) || ! method_exists( 'Uich_Dynamic', 'list_fields' ) ) {
						return new WP_Error( 'uich_mcp_error', 'The dynamic-data engine is unavailable.' );
					}
					return Uich_Dynamic::list_fields( $params );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". Valid: list-fields, create-loop, bind-field, add-tag.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: list-fields, create-loop, bind-field, add-tag.' );
			}
		}

		/**
		 * uichemy-composer/forms — where a form delivers, and what it has received.
		 *
		 * @param array $arguments { action, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_forms( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			switch ( $action ) {
				case 'configure':
					return UiChemy_Composer_Manager::mcp_forms_configure( $params );

				case 'list_submissions':
					return UiChemy_Composer_Manager::mcp_forms_list_submissions( $params );

				case 'get_submission':
					return UiChemy_Composer_Manager::mcp_forms_get_submission( $params );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". Valid: configure, list-submissions, get-submission.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: configure, list-submissions, get-submission.' );
			}
		}

		/**
		 * uichemy-composer/seo — per-post SEO metadata, through whichever SEO plugin owns output.
		 *
		 * BASIC for now: UiChemy has no head emitter of its own in this build, so this
		 * reads and writes Yoast's or Rank Math's own meta keys and refuses a write
		 * when neither is active, rather than storing values nothing renders. JSON-LD
		 * schema and previews are not implemented yet.
		 *
		 * @param array $arguments { action, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_seo( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			switch ( $action ) {
				case 'get':
					return UiChemy_Composer_Manager::mcp_seo_get( $params );

				case 'set':
					return UiChemy_Composer_Manager::mcp_seo_set( $params );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". Valid: get, set.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: get, set.' );
			}
		}

		/**
		 * uichemy-composer/audit — read-only readiness findings, each naming its fix ability.
		 *
		 * @param array $arguments { action, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_audit( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			switch ( $action ) {
				case '':
				case 'run':
					return UiChemy_Composer_Manager::mcp_audit_run( $params );

				case 'list_checks':
					return UiChemy_Composer_Manager::mcp_audit_list_checks();

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: run, list-checks.' );
			}
		}

		/**
		 * uichemy-composer/platform — site-level settings and nav menus.
		 *
		 * Both halves are things a build configures ONCE and then relies on: the site
		 * identity a header renders, and the menu a <uichemy-nav-menu> placeholder
		 * resolves against. They sit together because they are the same job — wiring
		 * up the site around the pages, rather than building a page.
		 *
		 * set-site-settings vs update-site-settings is replace vs fill-in-what-is-
		 * missing: an invented logo should not silently overwrite the one the site
		 * owner chose.
		 *
		 * @param array $arguments { action, action_parameters?: array }
		 * @return array|WP_Error
		 */
		public static function execute_platform( $arguments ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			switch ( $action ) {
				// --- Site settings -----------------------------------------------
				case 'get_site_settings':
					return UiChemy_Composer_Manager::mcp_platform_get_site();

				case 'set_site_settings':
					return UiChemy_Composer_Manager::mcp_platform_set_site( $params, true );

				case 'update_site_settings':
					return UiChemy_Composer_Manager::mcp_platform_set_site( $params, false );

				// --- Site-wide head + body code ----------------------------------
				case 'get_site_code':
					return UiChemy_Composer_Manager::mcp_site_code_get();

				case 'set_site_code':
					return UiChemy_Composer_Manager::mcp_site_code_set( $params );

				case 'update_site_code':
					return UiChemy_Composer_Manager::mcp_site_code_update( $params );

				// --- Nav menus ---------------------------------------------------
				case 'get_menu':
					return UiChemy_Composer_Manager::mcp_menu_get( $params );

				case 'update_menu':
					return UiChemy_Composer_Manager::mcp_menu_update( $params );

				case 'delete_menu':
					return UiChemy_Composer_Manager::mcp_menu_delete( $params );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". Valid: get-site-settings, set-site-settings, update-site-settings, get-site-code, set-site-code, update-site-code, get-menu, update-menu, delete-menu.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". Valid: get-site-settings, set-site-settings, update-site-settings, get-site-code, set-site-code, update-site-code, get-menu, update-menu, delete-menu.' );
			}
		}

		/**
		 * uichemy-composer/page — the content router bound to the `page` post type.
		 *
		 * @param array $arguments { action, action_parameters?, ...flat fallback }
		 * @return array|WP_Error
		 */
		public static function execute_page( $arguments ) {
			return self::execute_content( $arguments, 'page' );
		}

		/**
		 * uichemy-composer/post — the same router bound to posts and custom post types. Any
		 * action that takes a post_type honours it, so one ability covers post,
		 * product, portfolio and every other public type.
		 *
		 * @param array $arguments { action, action_parameters?, ...flat fallback }
		 * @return array|WP_Error
		 */
		public static function execute_post( $arguments ) {
			return self::execute_content( $arguments, 'post' );
		}

		/**
		 * uichemy-composer/template — the same router bound to theme-builder templates, where
		 * `list` and `create` mean the template versions of those verbs.
		 *
		 * @param array $arguments { action, action_parameters?, ...flat fallback }
		 * @return array|WP_Error
		 */
		public static function execute_template( $arguments ) {
			return self::execute_content( $arguments, 'template' );
		}

		/**
		 * The shared content + section router behind page / post / template.
		 *
		 * A Composer section tree is the same object whatever post type carries it, so
		 * every section action here is genuinely identical across the three: only
		 * `list`, `create` and `create-with-sections` differ, because only they have
		 * to know what kind of thing they are making. Splitting the router per domain
		 * would have meant three copies of the thirteen shared branches, drifting
		 * apart the first time one was fixed.
		 *
		 * @param array  $arguments { action, action_parameters?, ...flat fallback }
		 * @param string $domain    'page' | 'post' | 'template'.
		 * @return array|WP_Error
		 */
		private static function execute_content( $arguments, $domain ) {
			list( $action, $params ) = self::unwrap_action( $arguments );

			// Every section action targets by `section_index`; the older code-editing
			// handlers underneath still call the same number `widget_index`. Aliasing
			// here keeps one name in the ability contract.
			if ( isset( $params['section_index'] ) && ! isset( $params['widget_index'] ) ) {
				$params['widget_index'] = (int) $params['section_index'];
			} elseif ( isset( $params['widget_index'] ) && ! isset( $params['section_index'] ) ) {
				$params['section_index'] = (int) $params['widget_index'];
			}

			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			// The three domain-sensitive actions. Everything below them is identical
			// across page / post / template.
			$params = self::apply_content_domain( $params, $domain, $action );
			if ( is_wp_error( $params ) ) {
				return $params;
			}

			switch ( $action ) {
				// --- Discovery -------------------------------------------------
				case 'list':
					return ( 'template' === $domain )
						? UiChemy_Composer_MCP_Server::execute_list_templates( $params )
						: UiChemy_Composer_MCP_Server::execute_list_pages( $params );

				case 'grep':
					return UiChemy_Composer_Manager::mcp_grep_sections( $params );

				case 'get_structure':
					return UiChemy_Composer_MCP_Server::execute_get_post_structure( $params );

				// --- Creation ----------------------------------------------------
				case 'create':
					if ( 'template' === $domain ) {
						return self::execute_create_template( $params );
					}
					return UiChemy_Composer_MCP_Server::execute_create_uichemy_composer_page( $params );

				// --- Theme builder (template domain only) ------------------------
				case 'set_conditions':
				case 'toggle':
				case 'delete':
					if ( 'template' !== $domain ) {
						return new WP_Error(
							'uich_mcp_error',
							'action="' . str_replace( '_', '-', $action ) . '" is a theme-builder operation - use uichemy-composer/template.'
						);
					}
					if ( 'set_conditions' === $action ) {
						return UiChemy_Composer_Manager::mcp_template_set_conditions( $params );
					}
					if ( 'toggle' === $action ) {
						return UiChemy_Composer_Manager::mcp_template_toggle( $params );
					}
					return UiChemy_Composer_Manager::mcp_template_delete( $params );

				case 'create_with_sections':
					if ( 'template' === $domain ) {
						return new WP_Error( 'uich_mcp_error', 'Templates are created one at a time - use action="create" with a type, then append-section for the rest.' );
					}
					if ( empty( $params['sections'] ) || ! is_array( $params['sections'] ) ) {
						return new WP_Error( 'uich_mcp_error', 'action="create-with-sections" requires a non-empty "sections" array.' );
					}
					// This branch calls the manager directly, so it has to do the
					// head/body key translation the single-section creator does for
					// itself. Without it the four code parameters this action
					// advertises are accepted and silently dropped.
					return UiChemy_Composer_Manager::mcp_create_page_with_sections(
						array_merge( $params, self::map_page_code_params( $params ) )
					);

				// --- Section creation ------------------------------------------
				case 'append_section':
					return UiChemy_Composer_MCP_Server::execute_add_uichemy_composer_section( $params );

				case 'insert_section':
					return UiChemy_Composer_MCP_Server::execute_insert_section_at_index( $params );

				// --- Section code ----------------------------------------------
				case 'get_section_code':
					return UiChemy_Composer_MCP_Server::execute_find_and_update_section_code( array_merge( $params, array( 'action' => 'get' ) ) );

				case 'set_section_code':
					return UiChemy_Composer_MCP_Server::execute_find_and_update_section_code( array_merge( $params, array( 'action' => 'set' ) ) );

				case 'patch_section_code':
					return UiChemy_Composer_Manager::mcp_patch_section_code( $params );

				// --- Section structure -------------------------------------------
				case 'move_section':
					return UiChemy_Composer_Manager::mcp_move_section( $params );

				case 'duplicate_section':
					return UiChemy_Composer_Manager::mcp_duplicate_section( $params );

				case 'delete_section':
					return UiChemy_Composer_Manager::mcp_delete_section( $params );

				// --- Page head + body code ---------------------------------------
				// Page scope only: site-wide code is a property of the site, so it is
				// written through uichemy-composer/platform. The site keys are rejected rather
				// than ignored, so a caller that sends them here finds out.
				case 'get_page_code':
					return UiChemy_Composer_Manager::mcp_get_page_code( $params );

				case 'set_page_code':
					$rejected = self::reject_site_scope( $params );
					if ( is_wp_error( $rejected ) ) {
						return $rejected;
					}
					return UiChemy_Composer_MCP_Server::execute_set_page_site_code( $params );

				case 'update_page_code':
					$rejected = self::reject_site_scope( $params );
					if ( is_wp_error( $rejected ) ) {
						return $rejected;
					}
					return UiChemy_Composer_Manager::mcp_update_page_code( self::map_page_code_params( $params ) );

				case '':
					return new WP_Error( 'uich_mcp_error', 'Missing "action". ' . self::page_action_hint() );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown action "' . $action . '". ' . self::page_action_hint() );
			}
		}

		/**
		 * The valid-actions line shared by execute_content()'s two error paths.
		 *
		 * @return string
		 */
		private static function page_action_hint() {
			return 'Valid: list, grep, create, create-with-sections, append-section, insert-section, '
				. 'get-section-code, set-section-code, patch-section-code, get-structure, move-section, '
				. 'duplicate-section, delete-section, set-page-code, get-page-code, update-page-code '
				. '(templates also: set-conditions, toggle, delete).';
		}

		/**
		 * Fill in the post-type defaults that make one router serve three abilities.
		 *
		 * Only the actions that address a *set* of posts need this — list, create and
		 * grep. Everything else already names one post_id, and a post_id is
		 * unambiguous on its own.
		 *
		 * The caller can still override: uichemy-composer/post with post_type="product" lists
		 * and creates products, which is the point of not shipping one ability per
		 * registered type.
		 *
		 * @param array  $params Action parameters.
		 * @param string $domain 'page' | 'post' | 'template'.
		 * @param string $action Normalised action name.
		 * @return array|WP_Error Parameters, or an error for an unknown post type.
		 */
		private static function apply_content_domain( $params, $domain, $action ) {
			if ( ! in_array( $action, array( 'list', 'create', 'create_with_sections', 'grep' ), true ) ) {
				return $params;
			}

			if ( 'page' === $domain ) {
				// A page ability that could be pointed at another type would make
				// uichemy-composer/post redundant and the two abilities indistinguishable.
				$params['post_type'] = 'page';
				return $params;
			}

			if ( 'post' === $domain ) {
				if ( empty( $params['post_type'] ) ) {
					$params['post_type'] = 'post';
					return $params;
				}

				// Say so when the requested type does not exist. Falling back to a
				// page would hand back a successful-looking response for content
				// created in the wrong place — the caller asked for a product and
				// would have to notice, from a post_id alone, that it is not one.
				$requested = sanitize_key( (string) $params['post_type'] );
				$object    = get_post_type_object( $requested );
				if ( ! $object || empty( $object->public ) ) {
					$available = implode( ', ', get_post_types( array( 'public' => true ), 'names' ) );
					return new WP_Error(
						'uich_mcp_error',
						sprintf(
							'Unknown post type "%s". This site has: %s. Run uichemy-composer/describe-site to see the real content model.',
							$requested,
							$available
						)
					);
				}
				$params['post_type'] = $requested;
				return $params;
			}

			// Templates live in whichever theme-builder post type is installed; grep
			// and list resolve that themselves, so only grep needs a scope hint.
			if ( 'grep' === $action && empty( $params['post_type'] ) ) {
				$params['post_type'] = post_type_exists( 'nxt_builder' ) && ! post_type_exists( 'elementor_library' )
					? 'nxt_builder'
					: 'elementor_library';
			}

			return $params;
		}

		/**
		 * uichemy-composer/template action="create" — route by template type to the existing
		 * theme-builder creators, which already handle Elementor Pro vs Nexter vs
		 * plain Elementor and the activation rules that differ between them.
		 *
		 * @param array $params Action parameters, including `type`.
		 * @return array|WP_Error
		 */
		private static function execute_create_template( $params ) {
			$type = isset( $params['type'] ) ? sanitize_key( (string) $params['type'] ) : '';

			switch ( $type ) {
				case 'header':
				case 'footer':
					return UiChemy_Composer_MCP_Server::execute_create_uichemy_composer_header_footer( $params );

				case 'single':
					return UiChemy_Composer_MCP_Server::execute_create_single_post_widget( $params );

				case '':
					return new WP_Error( 'uich_mcp_error', 'action="create" on a template requires "type": header, footer or single.' );

				default:
					return new WP_Error( 'uich_mcp_error', 'Unknown template type "' . $type . '". Valid: header, footer, single.' );
			}
		}

		/**
		 * Translate the ability's caller-facing head/body names to the manager's
		 * internal css/js payload keys.
		 *
		 * The public vocabulary is page_before_head / page_before_body (where the code
		 * lands), while the manager has always spoken page_css / page_js (what it
		 * usually holds).
		 *
		 * @param array $params Caller-facing parameters.
		 * @return array Manager payload.
		 */
		private static function map_page_code_params( $params ) {
			$mapped = array(
				'post_id'  => isset( $params['post_id'] ) ? (int) $params['post_id'] : 0,
				'page_css' => isset( $params['page_before_head'] ) ? (string) $params['page_before_head'] : '',
				'page_js'  => isset( $params['page_before_body'] ) ? (string) $params['page_before_body'] : '',
			);

			// Site scope is refused on the page-code actions, but the creators accept
			// it as an upload-time append (that is how a build's font <link> lands on
			// the first call), so pass it through when it is actually present.
			if ( isset( $params['site_before_head'] ) ) {
				$mapped['site_css'] = (string) $params['site_before_head'];
			}
			if ( isset( $params['site_before_body'] ) ) {
				$mapped['site_js'] = (string) $params['site_before_body'];
			}

			return $mapped;
		}

		/**
		 * Refuse site-scope keys on a page-scope action.
		 *
		 * Site-wide code has one home now — uichemy-composer/platform. Silently dropping these
		 * would leave a caller believing a font <link> had been installed site-wide
		 * when nothing was written, so the mistake is named instead.
		 *
		 * @param array $params Action parameters.
		 * @return true|WP_Error
		 */
		private static function reject_site_scope( $params ) {
			$site_keys = array_intersect( array( 'site_before_head', 'site_before_body' ), array_keys( (array) $params ) );
			if ( $site_keys ) {
				return new WP_Error(
					'uich_mcp_error',
					sprintf(
						'%s is site-wide, not page-level. Write it with uichemy-composer/platform (action="set-site-code" to replace, "update-site-code" to append).',
						implode( ' and ', $site_keys )
					)
				);
			}
			return true;
		}
	}
}
