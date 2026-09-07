<?php
/**
 * This file Call Only One time when click and active Plugin
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    Uichemy
 */

/**
 * Exit if accessed directly.
 * */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Globals' ) ) {
	require_once UICH_PATH . 'includes/admin/globals/class-uich-globals.php';
	require_once UICH_PATH . 'includes/admin/globals/class-uich-bricks-globals.php';
	require_once UICH_PATH . 'includes/admin/class-uich-import-images.php';
	require_once UICH_PATH . 'includes/admin/class-uich-atomic-imgs.php';
	require_once UICH_PATH . 'includes/admin/globals/class-uich-atomic-globals.php';
}

if ( ! class_exists( 'Uich_Api' ) ) {

	/**
	 * Here Enqueue all js and css script
	 */
	class Uich_Api {

		/**
		 * Member Variable
		 *
		 * @var staring $flexbox_container_db
		 */
		public $flexbox_container_db = 'elementor_experiment-container';

		/**
		 * Member Variable
		 *
		 * @var staring $file_uploads_db
		 */
		public $file_uploads_db = 'elementor_unfiltered_files_upload';

		/**
		 * Member Variable
		 *
		 * @var staring $elementor_pluginpath
		 */
		public $elementor_pluginpath = 'elementor/elementor.php';

		/**
		 * TPGB Plugin Path
		 *
		 * @var string $tpgb_plugin_path
		 */
		public $tpgb_plugin_path = 'the-plus-addons-for-block-editor/the-plus-addons-for-block-editor.php';

		/**
		 * Onbording Popup Close
		 *
		 * @since 1.2.2
		 * @var uich_onbording_end of the class.
		 */
		public $uich_onbording_end = 'uich_onbording_end';

		/**
		 * Initialize the class and set its properties.
		 *
		 * @since   1.0.0
		 */
		public function __construct() {
			add_filter( 'rest_pre_serve_request', array( $this, 'uiche_rest_send_cors_headers' ) );
			add_filter( 'upload_mimes', array( $this, 'add_svg_to_upload_mimes' ) );
			add_filter( 'http_request_timeout', array( $this, 'uich_modify_http_request_default_timeout' ), 10 );

			add_action( 'wp_ajax_uich_select_user', array( $this, 'uich_select_user' ) );
			add_action( 'wp_ajax_uich_uichemy', array( $this, 'uich_api_call' ) );

			add_filter( 'uich_recommended_settings', array( $this, 'uich_recommended_settings' ), 10, 1 );

			add_action(
				'rest_api_init',
				function () {
					// Every UiChemy REST route is admin-only (manage_options).
					// Auth flows through Uich_Rest_Permissions::check_admin,
					// which trusts WP cookies/nonces and native Application
					// Password (HTTP Basic) authentication.
					$permission = array( 'Uich_Rest_Permissions', 'check_admin' );

					$routes = array(
						array( '/v1/import', 'uich_handle_import', 'POST' ),
						array( '/v2/elementor/import', 'uich_handle_elementor_import_v2', 'POST' ),
						array( '/v2/elementor/get_posts', 'uich_get_elementor_posts' ),
						array( '/v2/elementor/get_config', 'uich_get_elementor_config' ),
						array( '/v1/check', 'uich_handle_check', array( 'GET', 'POST' ) ),
						array( '/v2/gutenberg/import', 'uich_handle_gutenberg_import', 'POST' ),
						array( '/v2/gutenberg/get_posts', 'uich_get_gutenberg_posts' ),
						array( '/v2/gutenberg/get_config', 'uich_get_gutenberg_config' ),
						array( '/v2/bricks/import', 'uich_handle_bricks_import_v2', 'POST' ),
						array( '/v2/bricks/get_posts', 'uich_get_bricks_posts' ),
						array( '/v2/bricks/get_config', 'uich_get_bricks_config' ),
						array( '/v1/bricks/getnonce', 'uich_handle_bricks_get_nonce' ),
						array( '/v1/bricks/import', 'uich_handle_bricks_import', 'POST' ),
						array( '/v1/elementor/globals', 'uich_handle_elementor_globals_list' ),
						array( '/v1/elementor/globals/sync', 'uich_handle_elementor_globals_sync', 'POST' ),
						array( '/v1/bricks/globals', 'uich_handle_bricks_globals_list' ),
						array( '/v1/bricks/globals/sync', 'uich_handle_bricks_globals_sync', 'POST' ),
						array( '/v1/elementor/atomic_enable', 'uich_handle_elementor_atomic_enable' ),
						array( '/v1/elementor/classes_variables', 'uich_handle_elementor_classes_variables' ),
						array( '/v1/elementor/classes_variables/sync', 'uich_handle_elementor_classes_variables_sync', 'POST' ),
						array( '/v2/system/status', 'uich_get_system_status' ),
						array( '/v2/system/plugin/activate', 'uich_handle_plugin_activate', 'POST' ),
						array( '/v2/system/plugin/install', 'uich_handle_plugin_install', 'POST' ),
						array( '/v2/system/plugin/update', 'uich_handle_plugin_update', 'POST' ),
						array( '/v2/system/theme/update', 'uich_handle_nexter_theme_update', 'POST' ),
					);

					foreach ( $routes as $route_config ) {
						[$route, $callback, $method] = array_pad( $route_config, 3, null );
						$method                      = $method ?? 'GET';
						register_rest_route(
							'uichemy',
							$route,
							array(
								'methods'             => $method,
								'callback'            => array( $this, $callback ),
								'permission_callback' => $permission,
							)
						);
					}
				}
			);
		}

		/**
		 * Globals
		 */
		public function uich_handle_elementor_globals_list( WP_REST_Request $request ) {
			return Uich_Globals::get_globals();
		}

		/**
		 * Sync Globals
		 */
		public function uich_handle_elementor_globals_sync( WP_REST_Request $request ) {
			$sync_data = json_decode( $request->get_body() );

			$update_sync_data = Uich_Globals::sync_globals( $sync_data );

			return array(
				'success' => true,
				'data'    => $update_sync_data,
			);
		}

		public function uich_handle_bricks_globals_list( WP_REST_Request $request ) {
			return array(
				'success' => true,
				'data'    => Uich_Bricks_Globals::get_uich_bricks_globals(),
			);
		}

		public function uich_handle_bricks_globals_sync( WP_REST_Request $request ) {
			$sync_data = json_decode( $request->get_body() );

			$update_sync_data = Uich_Bricks_Globals::sync_uich_globals( $sync_data );

			return array(
				'success' => true,
				'data'    => $update_sync_data,
			);
		}

		/**
		 * Elementor Clasess
		 */
		public function uich_handle_elementor_classes_variables( WP_REST_Request $request ) {

			$uich_classes_variables = Uich_Atomic_Globals::get_global_classes_and_variable();

			return array(
				'success' => true,
				'data'    => $uich_classes_variables,
			);
		}

		public function uich_handle_elementor_classes_variables_sync( WP_REST_Request $request ) {

			$sync_data = json_decode( $request->get_body() );

			$uich_sync_variables = Uich_Atomic_Globals::sych_uich_elementor_classes_and_variables_sync( $sync_data );

			return array(
				'success' => true,
				'data'    => $uich_sync_variables,
			);
		}

		/**
		 * Upload mimes Type
		 */
		public function add_svg_to_upload_mimes( $mimes ) {
			if ( current_user_can( 'import' ) ) {
				$mimes['svg'] = 'image/svg+xml';
			}
			return $mimes;
		}

		/**
		 * Select User role
		 *
		 * @since   1.0.0
		 */
		public function uich_select_user() {

			check_ajax_referer( 'uichemy-ajax-nonce', 'nonce' );

			if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
				wp_send_json_error( null, 400 );
			}

			$newuser = ! empty( $_POST['new_user'] ) ? sanitize_text_field( wp_unslash( $_POST['new_user'] ) ) : '';

			apply_filters( 'uich_manage_usermanager', 'set_user', $newuser );

			$response = array(
				'message'  => 'Set Successful',
				'new_user' => apply_filters( 'uich_manage_usermanager', 'get_user' ),
			);

			wp_send_json_success( $response );
		}

		public function uich_get_elementor_posts( WP_REST_Request $request ) {

			// fetch all post Types
			$all_post_types = get_post_types(
				array(
					'public'     => true,
					'can_export' => true,
					'_builtin'   => false,
				)
			);

			// Create a response
			$response = array(
				'success' => true,
			);

			// Establishing installed things
			$is_elementor_installed = class_exists( 'Elementor\Plugin' );
			$is_nexter_installed    = array_key_exists( 'nxt_builder', $all_post_types );

			// To Check if required plugins have been installed
			$response['is_elementor_pro_installed'] = class_exists( 'ElementorPro\Plugin' );
			$response['is_elementor_installed']     = $is_elementor_installed;
			$response['is_nexter_installed']        = $is_nexter_installed;

			// Initiate empty array for gathering posts
			$response['posts'] = array(
				'elementor_library' => array(),
				'page'              => array(),
				'nxt_builder'       => array(),
			);

			// all post types to gather
			$post_types_to_query = array();

			// Add built-in post types
			// $post_types_to_query['post'] = 'post';
			$post_types_to_query['page'] = 'page';
			if ( $is_elementor_installed ) {
				$post_types_to_query['elementor_library'] = 'elementor_library';
			}
			if ( $is_nexter_installed ) {
				$post_types_to_query['nxt_builder'] = 'nxt_builder';
			}

			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return $response;
			}

			// Fetch posts for each post type
			foreach ( $post_types_to_query as $post_type ) {
				$args = array(
					'post_type'      => $post_type,
					'posts_per_page' => -1,
					'post_status'    => 'any',
				);

				$query = new WP_Query( $args );

				if ( $query->have_posts() ) {
					while ( $query->have_posts() ) {
						$query->the_post();
						$document = Elementor\Plugin::$instance->documents->get( get_the_ID() );

						if ( $document->is_built_with_elementor() ) {

							array_push(
								$response['posts'][ $post_type ],
								array(
									'id'    => get_the_ID(),
									'title' => html_entity_decode( get_the_title() ),
								)
							);

						}
					}
					wp_reset_postdata();
				}
			}

			return $response;
		}

		public function uich_handle_elementor_atomic_enable( WP_REST_Request $request ) {

			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return array(
					'success' => false,
					'message' => 'Elementor is not active.',
				);
			}

			$state           = \Elementor\Core\Experiments\Manager::STATE_ACTIVE; // 'active'
			$plugin_instance = \Elementor\Plugin::$instance;
			$experiments     = $plugin_instance->experiments;

			$features = array(
				'e_opt_in_v4',
				'container',
				\Elementor\Modules\NestedElements\Module::EXPERIMENT_NAME,
				\Elementor\Modules\AtomicWidgets\Module::EXPERIMENT_NAME,
				\Elementor\Modules\GlobalClasses\Module::NAME,
				\Elementor\Modules\Variables\Module::EXPERIMENT_NAME,
			);

			foreach ( $features as $feature ) {
				$option_key = $experiments->get_feature_option_key( $feature );
				update_option( $option_key, $state );
			}

			$is_active = get_option( $experiments->get_feature_option_key( 'e_opt_in_v4' ) ) === $state;

			return array(
				'success'        => true,
				'isAtomicEnable' => $is_active,
			);
		}

		public function uich_get_elementor_config( WP_REST_Request $request ) {
			$response = array(
				'success' => true,
				'version' => UICH_VERSION,
			);

			// fetch all post Types
			$all_post_types = get_post_types(
				array(
					'public'     => true,
					'can_export' => true,
					'_builtin'   => false,
				)
			);

			$response['is_elementor_pro_installed'] = class_exists( 'ElementorPro\Plugin' );
			$response['is_elementor_installed']     = class_exists( 'Elementor\Plugin' );
			$response['isNexterInstalled']          = array_key_exists( 'nxt_builder', $all_post_types );

			$response['isAtomicEnable'] = false;

			// Only try to access experiments if Elementor is active
			if ( $response['is_elementor_installed'] && isset( \Elementor\Plugin::$instance ) ) {
				$experiments_manager = \Elementor\Plugin::$instance->experiments;
				if ( method_exists( $experiments_manager, 'is_feature_active' ) ) {
					$response['isAtomicEnable'] = $experiments_manager->is_feature_active( 'e_atomic_elements' );
				}
			}

			$response['elementor_version'] = defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '';

			return $response;
		}

		/**
		 * Map a short slug used by the AI flow to a real plugin basename and
		 * the wordpress.org slug used by plugins_api / Plugin_Upgrader.
		 *
		 * @param string $slug 'elementor' | 'uichemy'
		 * @return array{file: string, wporg_slug: string}|null
		 */
		private function uich_resolve_plugin_slug( $slug ) {
			$map = array(
				'elementor' => array(
					'file'       => 'elementor/elementor.php',
					'wporg_slug' => 'elementor',
				),
				'uichemy'   => array(
					'file'       => defined( 'UICH_PBNAME' ) ? UICH_PBNAME : 'uichemy/uichemy.php',
					'wporg_slug' => 'uichemy',
				),
				// Nexter Extension provides the `nxt_builder` theme-builder post
				// type that the AI flow's "Full Setup" uses for header/footer
				// templates. One-click enable activates (or installs) this plugin.
				'nexter'    => array(
					'file'       => 'nexter-extension/nexter-extension.php',
					'wporg_slug' => 'nexter-extension',
				),
			);

			return $map[ $slug ] ?? null;
		}

		/**
		 * Lookup wordpress.org plugin info for a given slug. Returns null on failure.
		 *
		 * @param string $wporg_slug
		 * @return array|null
		 */
		private function uich_lookup_wporg_info( $wporg_slug ) {
			if ( ! function_exists( 'plugins_api' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
			}

			$info = plugins_api(
				'plugin_information',
				array(
					'slug'   => $wporg_slug,
					'fields' => array(
						'sections'          => false,
						'tags'              => false,
						'short_description' => false,
					),
				)
			);

			if ( is_wp_error( $info ) ) {
				return null;
			}

			return is_object( $info ) ? get_object_vars( $info ) : (array) $info;
		}

		/**
		 * Build a status struct for one plugin: installed/active/version plus
		 * update info. Uses WP's own `update_plugins` transient — this is the
		 * SAME source the Plugins screen uses to decide whether an update is
		 * available, so we never disagree with WP-Admin. (Direct lookups via
		 * `plugins_api()` can be misleading: a wp.org slug may map to a
		 * differently-versioned plugin, or to nothing at all for premium
		 * builds, and we'd light up "Update" for no good reason.)
		 *
		 * @param string $slug
		 * @return array
		 */
		private function uich_build_plugin_status( $slug ) {
			$resolved = $this->uich_resolve_plugin_slug( $slug );

			if ( ! $resolved ) {
				return array(
					'slug'             => $slug,
					'installed'        => false,
					'active'           => false,
					'version'          => null,
					'latest_version'   => null,
					'update_available' => false,
					'plugin_file'      => null,
				);
			}

			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$plugins   = get_plugins();
			$file      = $resolved['file'];
			$installed = isset( $plugins[ $file ] );
			$active    = $installed && is_plugin_active( $file );
			$version   = $installed ? ( $plugins[ $file ]['Version'] ?? null ) : null;

			$latest           = null;
			$update_available = false;

			if ( $installed ) {
				$api_latest = class_exists( 'Uich_ND_Settings' ) ? Uich_ND_Settings::get_managed_latest( $slug ) : '';

				if ( '' !== $api_latest ) {
					$latest           = $api_latest;
					$update_available = $version ? version_compare( $version, $latest, '<' ) : true;
				} else {
					// Fallback: WP's own wp.org update transient, when the API has
					// no value for this slug (e.g. API unreachable).
					if ( function_exists( 'wp_update_plugins' ) ) {
						wp_update_plugins();
					}

					$transient = get_site_transient( 'update_plugins' );

					if ( $transient && isset( $transient->response[ $file ]->new_version ) ) {
						$latest           = $transient->response[ $file ]->new_version;
						$update_available = $version
							? version_compare( $version, $latest, '<' )
							: true;
					} elseif ( $transient && isset( $transient->no_update[ $file ]->new_version ) ) {
						$latest = $transient->no_update[ $file ]->new_version;
					} else {
						$latest = $version;
					}
				}
			}

			return array(
				'slug'             => $slug,
				'installed'        => $installed,
				'active'           => $active,
				'version'          => $version,
				'latest_version'   => $latest,
				'update_available' => $update_available,
				'plugin_file'      => $file,
			);
		}

		/**
		 * System Status — versions of WP / Elementor / UiChemy and
		 * install / active / update-available flags. Powers the system
		 * status panel on the AI-flow Connect Site screen.
		 */
		public function uich_get_system_status( WP_REST_Request $request ) {
			global $wp_version;

			$elementor = $this->uich_build_plugin_status( 'elementor' );
			$uichemy   = $this->uich_build_plugin_status( 'uichemy' );

			// Elementor Pro is premium — we never offer install, only report.
			$elementor_pro_file = 'elementor-pro/elementor-pro.php';
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$plugins                 = get_plugins();
			$elementor_pro_installed = isset( $plugins[ $elementor_pro_file ] );
			$elementor_pro_active    = $elementor_pro_installed && is_plugin_active( $elementor_pro_file );
			$elementor_pro_version   = $elementor_pro_installed ? ( $plugins[ $elementor_pro_file ]['Version'] ?? null ) : null;

			$atomic_enabled = false;
			if ( $elementor['active'] && isset( \Elementor\Plugin::$instance ) ) {
				$experiments = \Elementor\Plugin::$instance->experiments;
				if ( method_exists( $experiments, 'is_feature_active' ) ) {
					$atomic_enabled = $experiments->is_feature_active( 'e_atomic_elements' );
				}
			}

			return array(
				'success'       => true,
				'wp'            => array(
					'version' => $wp_version,
				),
				'uichemy'       => $uichemy,
				'elementor'     => array_merge(
					$elementor,
					array(
						'atomic_enabled' => (bool) $atomic_enabled,
					)
				),
				'elementor_pro' => array(
					'slug'        => 'elementor_pro',
					'installed'   => $elementor_pro_installed,
					'active'      => $elementor_pro_active,
					'version'     => $elementor_pro_version,
					'plugin_file' => $elementor_pro_file,
				),
				// Nexter Extension (nxt_builder) — required, alongside Elementor
				// Pro, for the AI flow's "Full Setup" header/footer import. Built
				// via the shared helper so install/active/version are reported
				// the same way as the other managed plugins.
				'nexter'        => $this->uich_build_plugin_status( 'nexter' ),
				// Nexter THEME — the companion installed/activated alongside the
				// extension via uich_setup_nexter_companion(). Reported separately so
				// the AI flow can tell "extension present but theme missing/inactive"
				// apart from "extension missing" and prompt the right fix. This is the
				// case Elementor Pro would otherwise cover.
				'nexter_theme'  => $this->uich_build_nexter_theme_status(),
				// UiChemy (the "Composer" widget + MCP) — REQUIRED for the AI flow.
				// Built separately because UiChemy isn't on wordpress.org and
				// unpacks to a variable folder name, so it's detected by
				// TextDomain rather than the fixed-path plugin-status route.
				'uichemy'       => $this->uich_build_uichemy_status(),
				// UiChemy Pro — the premium plugin, REQUIRED for the AI flow. Not on
				// wordpress.org either: it is installed from the API's
				// /plugins/uichemy-pro/download package and detected by filename, so it
				// gets its own struct rather than the fixed-path plugin-status route.
				'uichemy_pro'   => $this->uich_build_uichemy_pro_status(),
			);
		}

		/**
		 * Build a SystemPluginStatus-shaped struct for UiChemy (the "Composer"
		 * widget + MCP). Detected by TextDomain via the shared new-dashboard
		 * helper instead of a fixed plugin file. UiChemy isn't on wp.org, so its
		 * latest version + update flag come from the UiChemy API (managed there),
		 * surfaced via Uich_ND_Settings::detect_uichemy().
		 *
		 * @return array
		 */
		private function uich_build_uichemy_status() {
			$empty = array(
				'slug'             => 'uichemy',
				'installed'        => false,
				'active'           => false,
				'version'          => null,
				'latest_version'   => null,
				'update_available' => false,
				'plugin_file'      => null,
			);

			if ( ! class_exists( 'Uich_ND_Settings' ) ) {
				return $empty;
			}

			$p = Uich_ND_Settings::detect_uichemy();

			return array(
				'slug'             => 'uichemy',
				'installed'        => (bool) $p['installed'],
				'active'           => (bool) $p['active'],
				'version'          => '' !== (string) $p['version'] ? (string) $p['version'] : null,
				'latest_version'   => isset( $p['latest_version'] ) && '' !== (string) $p['latest_version'] ? (string) $p['latest_version'] : null,
				'update_available' => ! empty( $p['update_available'] ),
				'plugin_file'      => '' !== (string) $p['file'] ? (string) $p['file'] : null,
			);
		}

		/**
		 * Build a SystemPluginStatus-shaped struct for UiChemy Pro — the premium
		 * plugin the AI flow requires alongside the free build. Detected by filename
		 * via the shared new-dashboard helper (Pro and free share the `uichemy` text
		 * domain, so a domain match cannot tell them apart), and its latest version
		 * comes from the UiChemy API's manually-managed `uichemy_pro` entry, surfaced
		 * through Uich_ND_Settings::detect_uichemy_pro().
		 *
		 * `update_available` is reported but is NOT a gate: there is no Pro update
		 * route here (Pro ships its own updater), so the panel offers Install &
		 * Activate / Activate only.
		 *
		 * @return array
		 */
		private function uich_build_uichemy_pro_status() {
			$empty = array(
				'slug'             => 'uichemy_pro',
				'installed'        => false,
				'active'           => false,
				'version'          => null,
				'latest_version'   => null,
				'update_available' => false,
				'plugin_file'      => null,
			);

			if ( ! class_exists( 'Uich_ND_Settings' ) ) {
				return $empty;
			}

			$p = Uich_ND_Settings::detect_uichemy_pro();

			return array(
				'slug'             => 'uichemy_pro',
				'installed'        => (bool) $p['installed'],
				// A site can unlock Pro without the plugin (the UICHEMY_PRO constant or
				// the `uich_composer_is_pro` filter). `is_pro` is what the features
				// actually read, so such a site reports active and is never nagged to
				// install a package it does not need.
				'active'           => (bool) $p['active'] || ! empty( $p['is_pro'] ),
				'version'          => '' !== (string) $p['version'] ? (string) $p['version'] : null,
				'latest_version'   => isset( $p['latest_version'] ) && '' !== (string) $p['latest_version'] ? (string) $p['latest_version'] : null,
				'update_available' => ! empty( $p['update_available'] ),
				'plugin_file'      => '' !== (string) $p['file'] ? (string) $p['file'] : null,
			);
		}

		/**
		 * Build a status struct for the Nexter THEME — the companion that ships the
		 * "Theme Optimization Controls" + header/footer disable that Full Setup relies
		 * on. Installed/activated alongside the Nexter Extension via
		 * uich_setup_nexter_companion(). Shape mirrors the plugin-status struct
		 * (slug/installed/active/version + latest/update) so the UI can treat it the
		 * same way as the managed plugins.
		 *
		 * Update check follows the SAME API-first path as the plugins: the UiChemy
		 * API's /plugins/versions (which fetches the theme's wp.org version and
		 * Redis-caches it) via get_managed_latest('nexter_theme'); if the API has
		 * no value we fall back to WP's own `update_themes` transient.
		 *
		 * @return array
		 */
		private function uich_build_nexter_theme_status() {
			$theme     = wp_get_theme( 'nexter' );
			$installed = $theme->exists();
			$active    = $installed && ( 'nexter' === get_stylesheet() );
			$version   = $installed ? ( $theme->get( 'Version' ) ?: null ) : null;

			$latest           = null;
			$update_available = false;

			if ( $installed ) {
				$api_latest = class_exists( 'Uich_ND_Settings' ) ? Uich_ND_Settings::get_managed_latest( 'nexter_theme' ) : '';

				if ( '' !== $api_latest ) {
					$latest           = $api_latest;
					$update_available = $version ? version_compare( $version, $latest, '<' ) : false;
				} else {
					// Fallback: WP's own wp.org theme update transient, when the API
					// has no value (e.g. API unreachable).
					if ( function_exists( 'wp_update_themes' ) ) {
						wp_update_themes();
					}

					$transient = get_site_transient( 'update_themes' );

					if ( $transient && isset( $transient->response['nexter']['new_version'] ) ) {
						$latest           = $transient->response['nexter']['new_version'];
						$update_available = $version
							? version_compare( $version, $latest, '<' )
							: false;
					} elseif ( $transient && isset( $transient->no_update['nexter']['new_version'] ) ) {
						$latest = $transient->no_update['nexter']['new_version'];
					} else {
						$latest = $version;
					}
				}
			}

			return array(
				'slug'             => 'nexter_theme',
				'installed'        => $installed,
				'active'           => $active,
				'version'          => $version,
				'latest_version'   => $latest,
				'update_available' => $update_available,
			);
		}

		/**
		 * Update the Nexter THEME to its latest wordpress.org version. Mirrors
		 * uich_handle_plugin_update() but drives Theme_Upgrader. The theme must
		 * already be installed; activation state is left untouched.
		 */
		public function uich_handle_nexter_theme_update( WP_REST_Request $request ) {
			if ( ! current_user_can( 'update_themes' ) ) {
				return new WP_Error( 'forbidden', 'You do not have permission to update themes.', array( 'status' => 403 ) );
			}

			if ( ! wp_get_theme( 'nexter' )->exists() ) {
				return array(
					'success' => false,
					'reason'  => 'not_installed',
					'message' => 'Nexter Theme is not installed.',
				);
			}

			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/misc.php';
			require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

			// Refresh the theme update transient so Theme_Upgrader sees the new version.
			wp_clean_themes_cache( true );
			if ( function_exists( 'wp_update_themes' ) ) {
				wp_update_themes();
			}

			$skin     = new WP_Ajax_Upgrader_Skin();
			$upgrader = new Theme_Upgrader( $skin );
			$result   = $upgrader->upgrade( 'nexter' );

			if ( is_wp_error( $result ) ) {
				return array(
					'success' => false,
					'reason'  => 'update_failed',
					'message' => $result->get_error_message(),
				);
			}

			if ( false === $result ) {
				return array(
					'success' => false,
					'reason'  => 'update_failed',
					'message' => 'Update could not be completed.',
				);
			}

			if ( $skin->get_errors() && $skin->get_errors()->has_errors() ) {
				return array(
					'success' => false,
					'reason'  => 'update_failed',
					'message' => $skin->get_error_messages(),
				);
			}

			return array(
				'success' => true,
				'action'  => 'updated',
				'status'  => $this->uich_build_nexter_theme_status(),
			);
		}

		/**
		 * Activate an already-installed plugin (Elementor / UiChemy).
		 */
		public function uich_handle_plugin_activate( WP_REST_Request $request ) {
			$slug              = sanitize_key( (string) $request->get_param( 'slug' ) );
			$resolved          = $this->uich_resolve_plugin_slug( $slug );
			$with_nexter_theme = $request->get_param( 'with_nexter_theme' ) !== false;

			if ( ! $resolved ) {
				return new WP_Error( 'invalid_slug', 'Unknown plugin slug.', array( 'status' => 400 ) );
			}

			if ( ! function_exists( 'is_plugin_active' ) || ! function_exists( 'activate_plugin' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$file = $resolved['file'];

			if ( ! file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
				return array(
					'success' => false,
					'reason'  => 'not_installed',
					'message' => 'Plugin is not installed.',
				);
			}

			if ( is_plugin_active( $file ) ) {
				// The extension may be active while its companion theme isn't (e.g.
				// theme deactivated separately). Re-run the companion so activating —
				if ( 'nexter' === $slug && $with_nexter_theme ) {
					$this->uich_setup_nexter_companion();
				}
				return array(
					'success' => true,
					'action'  => 'already_active',
				);
			}

			$threw = null;
			try {
				$result = activate_plugin( $file, '', false, true );
				if ( is_wp_error( $result ) ) {
					$threw = $result->get_error_message();
				}
			} catch ( \Throwable $e ) {
				$threw = $e->getMessage();
			}

			$is_active = is_plugin_active( $file );

			if ( $is_active && ! $threw ) {
				// REST activation runs activate_plugin() in SILENT mode, so WP's
				// `activated_plugin` hook (which also wires the theme) never fires —
				if ( 'nexter' === $slug && $with_nexter_theme ) {
					$this->uich_setup_nexter_companion();
				}
				return array(
					'success' => true,
					'action'  => 'activated',
					'status'  => $this->uich_build_plugin_status( $slug ),
				);
			}

			return array(
				'success'      => false,
				'reason'       => 'activation_failed',
				'message'      => $threw ?: 'Activation needs to finish in WP-Admin.',
				'activate_url' => wp_nonce_url(
					self_admin_url( 'plugins.php?action=activate&from=uichemy&plugin=' . urlencode( $file ) ),
					'activate-plugin_' . $file
				),
			);
		}

		/**
		 * Install (from wordpress.org) + activate a plugin.
		 */
		public function uich_handle_plugin_install( WP_REST_Request $request ) {
			$slug              = sanitize_key( (string) $request->get_param( 'slug' ) );
			$resolved          = $this->uich_resolve_plugin_slug( $slug );
			$with_nexter_theme = $request->get_param( 'with_nexter_theme' ) !== false;

			if ( ! $resolved ) {
				return new WP_Error( 'invalid_slug', 'Unknown plugin slug.', array( 'status' => 400 ) );
			}

			if ( ! current_user_can( 'install_plugins' ) ) {
				return new WP_Error( 'forbidden', 'You do not have permission to install plugins.', array( 'status' => 403 ) );
			}

			$file = $resolved['file'];

			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			// Already installed → just delegate to activate handler (which already
			// respects the with_nexter_theme param since we forward the same $request).
			$plugins = get_plugins();
			if ( isset( $plugins[ $file ] ) ) {
				return $this->uich_handle_plugin_activate( $request );
			}

			$wporg = $this->uich_lookup_wporg_info( $resolved['wporg_slug'] );
			if ( ! $wporg || empty( $wporg['download_link'] ) ) {
				return array(
					'success' => false,
					'reason'  => 'wporg_lookup_failed',
					'message' => 'Could not look up plugin on wordpress.org.',
				);
			}

			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/misc.php';
			require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

			$skin     = new WP_Ajax_Upgrader_Skin();
			$upgrader = new Plugin_Upgrader( $skin );
			$result   = $upgrader->install( $wporg['download_link'] );

			if ( is_wp_error( $result ) ) {
				return array(
					'success' => false,
					'reason'  => 'install_failed',
					'message' => $result->get_error_message(),
				);
			}

			if ( $skin->get_errors() && $skin->get_errors()->has_errors() ) {
				return array(
					'success' => false,
					'reason'  => 'install_failed',
					'message' => $skin->get_error_messages(),
				);
			}

			// activate
			$activate = activate_plugin( $file, '', false, true );
			if ( is_wp_error( $activate ) ) {
				return array(
					'success'      => false,
					'reason'       => 'activation_failed',
					'message'      => $activate->get_error_message(),
					'activate_url' => wp_nonce_url(
						self_admin_url( 'plugins.php?action=activate&from=uichemy&plugin=' . urlencode( $file ) ),
						'activate-plugin_' . $file
					),
				);
			}

			// Nexter Extension needs its theme + optimization controls alongside —
			// unless the caller explicitly opted out (with_nexter_theme=false).
			if ( 'nexter' === $slug && $with_nexter_theme ) {
				$this->uich_setup_nexter_companion();
			}

			return array(
				'success' => true,
				'action'  => 'installed_and_activated',
				'status'  => $this->uich_build_plugin_status( $slug ),
			);
		}

		/**
		 * Companion setup that must accompany a Nexter Extension install:
		 *   1. Install the Nexter theme (the "Theme Optimization Controls" feature
		 *      lives in the theme, not the extension plugin).
		 *   2. Enable "Nexter Theme Optimization Controls" and turn ON every
		 *      individual control.
		 *
		 * Best-effort — failures here never fail the plugin install. The theme is
		 * installed and activated, and the optimization option is enabled.
		 *
		 * @return void
		 */
		private function uich_setup_nexter_companion() {
			// 1. Install the Nexter theme if it isn't already present.
			if ( ! wp_get_theme( 'nexter' )->exists() ) {
				require_once ABSPATH . 'wp-admin/includes/file.php';
				require_once ABSPATH . 'wp-admin/includes/misc.php';
				require_once ABSPATH . 'wp-admin/includes/theme.php';
				require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

				$api = themes_api(
					'theme_information',
					array(
						'slug'   => 'nexter',
						'fields' => array( 'sections' => false ),
					)
				);

				if ( ! is_wp_error( $api ) && ! empty( $api->download_link ) ) {
					$skin     = new WP_Ajax_Upgrader_Skin();
					$upgrader = new Theme_Upgrader( $skin );
					$upgrader->install( $api->download_link );
				}
			}

			// 1b. Activate the Nexter theme so its optimization controls take effect.
			if ( wp_get_theme( 'nexter' )->exists() && 'nexter' !== get_stylesheet() ) {
				switch_theme( 'nexter' );
			}

			// 2. Enable the theme-optimization controls — master switch on, and
			// every individual control turned on (value 1 = optimization applied).
			$opts = get_option( 'nexter_settings_opts', array() );
			if ( ! is_array( $opts ) ) {
				$opts = array();
			}
			$opts['switch'] = true;

			$values   = isset( $opts['values'] ) && is_array( $opts['values'] ) ? $opts['values'] : array();
			$controls = array( 'container_css', 'header_footer_css', 'reset_min_css', 'sidebar_css', 'theme_min_css', 'woocommerce_min_css', 'skip_link' );
			foreach ( $controls as $ctrl ) {
				$values[ $ctrl ] = 1;
			}
			$opts['values'] = $values;
			update_option( 'nexter_settings_opts', $opts );

			// Mirror the side-effect the Nexter dashboard applies when
			// header_footer_css is enabled, so the theme's header/footer disable
			// flags stay consistent.
			$theme_opts = get_option( 'nxt-theme-options', array() );
			if ( ! is_array( $theme_opts ) ) {
				$theme_opts = array();
			}
			$theme_opts['nxt-header-disable-opt'] = 'on';
			$theme_opts['nxt-footer-disable-opt'] = 'on';
			update_option( 'nxt-theme-options', $theme_opts );
		}

		/**
		 * Update a plugin to the latest wordpress.org version.
		 */
		public function uich_handle_plugin_update( WP_REST_Request $request ) {
			$slug     = sanitize_key( (string) $request->get_param( 'slug' ) );
			$resolved = $this->uich_resolve_plugin_slug( $slug );

			if ( ! $resolved ) {
				return new WP_Error( 'invalid_slug', 'Unknown plugin slug.', array( 'status' => 400 ) );
			}

			if ( ! current_user_can( 'update_plugins' ) ) {
				return new WP_Error( 'forbidden', 'You do not have permission to update plugins.', array( 'status' => 403 ) );
			}

			$file = $resolved['file'];

			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$plugins = get_plugins();
			if ( ! isset( $plugins[ $file ] ) ) {
				return array(
					'success' => false,
					'reason'  => 'not_installed',
					'message' => 'Plugin is not installed.',
				);
			}

			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/misc.php';
			require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

			// Refresh update transient so Plugin_Upgrader sees the new version.
			wp_clean_plugins_cache( true );
			if ( function_exists( 'wp_update_plugins' ) ) {
				wp_update_plugins();
			}

			$skin     = new WP_Ajax_Upgrader_Skin();
			$upgrader = new Plugin_Upgrader( $skin );
			$result   = $upgrader->upgrade( $file );

			if ( is_wp_error( $result ) ) {
				return array(
					'success' => false,
					'reason'  => 'update_failed',
					'message' => $result->get_error_message(),
				);
			}

			if ( false === $result ) {
				return array(
					'success' => false,
					'reason'  => 'update_failed',
					'message' => 'Update could not be completed.',
				);
			}

			if ( $skin->get_errors() && $skin->get_errors()->has_errors() ) {
				return array(
					'success' => false,
					'reason'  => 'update_failed',
					'message' => $skin->get_error_messages(),
				);
			}

			// Re-activate if WP deactivated it during upgrade.
			if ( ! is_plugin_active( $file ) ) {
				activate_plugin( $file, '', false, true );
			}

			return array(
				'success' => true,
				'action'  => 'updated',
				'status'  => $this->uich_build_plugin_status( $slug ),
			);
		}


		public function uich_get_gutenberg_posts( WP_REST_Request $request ) {
			// fetch all post Types
			$all_post_types = get_post_types(
				array(
					'public'     => true,
					'can_export' => true,
					'_builtin'   => false,
				)
			);

			// Create a response
			$response = array(
				'success' => true,
			);

			// Establishing installed things
			$is_nexter_installed = array_key_exists( 'nxt_builder', $all_post_types );

			// To Check if required plugins have been installed
			$response['is_tpag_installed']   = defined( 'TPGB_VERSION' );
			$response['is_nexter_installed'] = $is_nexter_installed;

			// Initiate empty array for gathering posts
			$response['posts'] = array(
				'wp_block'    => array(),
				'page'        => array(),
				'nxt_builder' => array(),
			);

			// all post types to gather
			$post_types_to_query = array();

			// Add built-in post types
			$post_types_to_query['page']     = 'page';
			$post_types_to_query['wp_block'] = 'wp_block';
			if ( $is_nexter_installed ) {
				$post_types_to_query['nxt_builder'] = 'nxt_builder';
			}

			// Fetch posts for each post type
			foreach ( $post_types_to_query as $post_type ) {
				$args = array(
					'post_type'      => $post_type,
					'posts_per_page' => -1,
					'post_status'    => 'any',
				);

				$query = new WP_Query( $args );

				if ( $query->have_posts() ) {
					while ( $query->have_posts() ) {
						$query->the_post();

						array_push(
							$response['posts'][ $post_type ],
							array(
								'id'    => get_the_ID(),
								'title' => html_entity_decode( get_the_title() ),
							)
						);
					}

					wp_reset_postdata();
				}
			}

			return $response;
		}

		public function uich_get_gutenberg_config( WP_REST_Request $request ) {
			// Create a response
			$response = array(
				'success' => true,
				'version' => UICH_VERSION,
			);

			// fetch all post Types
			$all_post_types = get_post_types(
				array(
					'public'     => true,
					'can_export' => true,
					'_builtin'   => false,
				)
			);

			// Establishing installed things
			$is_nexter_installed = array_key_exists( 'nxt_builder', $all_post_types );

			// To Check if required plugins have been installed
			$response['is_tpag_installed']           = defined( 'TPGB_VERSION' );
			$response['is_nexter_installed']         = $is_nexter_installed;
			$response['is_spectra_installed']        = defined( 'UAGB_PLUGIN_NAME' );
			$response['is_kadence_installed']        = defined( 'KADENCE_BLOCKS_VERSION' );
			$response['is_generate_block_installed'] = defined( 'GENERATEBLOCKS_VERSION' );

			return $response;
		}


		public function uich_get_bricks_posts( WP_REST_Request $request ) {
			// Create a response
			$response = array(
				'success' => true,
			);

			// Establishing installed things
			$is_bricks_installed = ( class_exists( '\Bricks\Theme' ) && class_exists( ( '\Bricks\Templates' ) ) );

			// To Check if required plugins have been installed
			$response['is_bricks_installed'] = $is_bricks_installed;

			// Initiate empty array for gathering posts
			$response['posts'] = array(
				'page'            => array(),
				'bricks_template' => array(),
			);

			// all post types to gather
			$post_types_to_query = array();

			// Add built-in post types
			$post_types_to_query['page'] = 'page';
			if ( $is_bricks_installed ) {
				$post_types_to_query['bricks_template'] = 'bricks_template';
			}

			// Fetch posts for each post type
			foreach ( $post_types_to_query as $post_type ) {
				$args = array(
					'post_type'      => $post_type,
					'posts_per_page' => -1,
					'post_status'    => 'any',
				);

				$query = new WP_Query( $args );

				if ( $query->have_posts() ) {
					while ( $query->have_posts() ) {
						$query->the_post();
						$check_bricks = get_post_meta( get_the_ID(), '_bricks_editor_mode', true );

						if ( 'bricks' == $check_bricks ) {

							array_push(
								$response['posts'][ $post_type ],
								array(
									'id'    => get_the_ID(),
									'title' => html_entity_decode( get_the_title() ),
								)
							);

						}
					}
					wp_reset_postdata();
				}
			}

			return $response;
		}

		public function uich_get_bricks_config( WP_REST_Request $request ) {
			// Create a response
			$response = array(
				'success' => true,
				'version' => UICH_VERSION,
			);

			// Establishing installed things
			$is_bricks_installed = ( class_exists( '\Bricks\Theme' ) && class_exists( ( '\Bricks\Templates' ) ) );

			// To Check if required plugins have been installed
			$response['is_bricks_installed'] = $is_bricks_installed;

			return $response;
		}


		/**
		 * Check Handle import
		 *
		 * @since   1.0.0
		 *
		 * @param WP_REST_Request $request WP_REST_Request object.
		 */
		public function uich_handle_import( WP_REST_Request $request ) {

			$json = $request->get_body();

			// Check if JSON data is present.
			if ( ! empty( $json ) && class_exists( '\Elementor\Plugin' ) ) {

				$file_name = 'export.json';

				// Using the elementor tmp_file creator.
				$temp_filename = \Elementor\Plugin::$instance->uploads_manager->create_temp_file( $json, $file_name );
				$file_data     = array(
					'fileName' => $file_name,
					'fileData' => base64_encode( $json ),
				);

				$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

				// Set current user as admin.
				wp_set_current_user( null, $selected_user );

				// Disable Error Displaying
				ini_set( 'display_errors', 0 ); // phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged -- Suppress notices so the REST import returns clean JSON.

				// Start the import.
				$import_result = \Elementor\Plugin::$instance->templates_manager->import_template( $file_data );

				return array(
					'success' => true,
					'result'  => $import_result,
				);
			} else {
				// Return an error response.
				return array(
					'success' => false,
					'message' => esc_html__( 'No JSON data found.', 'uichemy' ),
				);
			}

			// Remove added filter.
			remove_filter( 'http_request_timeout', 'uich_modify_http_request_default_timeout', 1 );
		}

		/**
		 * Handle import v2
		 *
		 * @param WP_REST_Request $request WP_REST_Request object.
		 */
		public function uich_handle_elementor_import_v2( WP_REST_Request $request ) {

			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return array(
					'success' => false,
					'message' => esc_html__( 'Elementor is required. Please install and activate it.', 'uichemy' ),
				);
			}

			// Get Parameters
			$new_import              = ( isset( $_GET['newImport'] ) && ! empty( $_GET['newImport'] ) ) ? sanitize_text_field( wp_unslash( $_GET['newImport'] ) ) : 'true';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$post_type               = ( isset( $_GET['postType'] ) && ! empty( $_GET['postType'] ) ) ? sanitize_text_field( wp_unslash( $_GET['postType'] ) ) : 'elementor';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$elementor_post_sub_type = ( isset( $_GET['elementorPostSubType'] ) && ! empty( $_GET['elementorPostSubType'] ) ) ? sanitize_text_field( wp_unslash( $_GET['elementorPostSubType'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$nexter_post_sub_type    = ( isset( $_GET['nexterPostSubType'] ) && ! empty( $_GET['nexterPostSubType'] ) ) ? sanitize_text_field( wp_unslash( $_GET['nexterPostSubType'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

			// postType: 'page' | 'nexter' | 'elementor'
			$post_type_map = array(
				'page'      => 'page',
				'elementor' => 'elementor_library',
				'nexter'    => 'nxt_builder',
			);
			$post_type     = array_key_exists( $post_type, $post_type_map ) ? $post_type_map[ $post_type ] : 'elementor_library';

			// elementorPostSubType: "header" | "footer" | "single-post" | "single-page" | "archive-page" | "search-page" | "404-page" | null
			if ( 'elementor_library' === $post_type ) {
				$el_type_map = array(
					'standard-template' => 'page',
					'header'            => 'header',
					'footer'            => 'footer',
					'single-post'       => 'single-post',
					'single-page'       => 'single-page',
					'archive-page'      => 'archive',
					'search-page'       => 'search-results',
					'404-page'          => 'error-404',
				);

				$el_type = array_key_exists( $elementor_post_sub_type, $el_type_map )
					? $el_type_map[ $elementor_post_sub_type ]
					: 'single-page';

			} elseif ( 'nxt_builder' === $post_type ) {
				$el_type_map = array(
					'standard-template' => 'none',
					'header'            => 'header',
					'footer'            => 'footer',
					'singular'          => 'singular',
					'archive-page'      => 'archives',
					'404-page'          => 'page-404',
				);

				$el_type = array_key_exists( $nexter_post_sub_type, $el_type_map )
					? $el_type_map[ $nexter_post_sub_type ]
					: 'none';
			}

			// Get The Body
			$json = $request->get_body();

			// Check if Empty
			if ( empty( $json ) ) {
				// Return an error response.
				return array(
					'success' => false,
					'message' => esc_html__( 'No JSON data found.', 'uichemy' ),
				);
			}

			// Import
			if ( 'true' === $new_import ) {

				$json          = json_decode( $json, true );
				$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

				// Set current user as admin.
				wp_set_current_user( null, $selected_user );

				// Disable Error Displaying
				ini_set( 'display_errors', 0 ); // phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged -- Suppress notices so the REST import returns clean JSON.

				$post_title = ! empty( $json ) && isset( $json['title'] ) ? sanitize_text_field( $json['title'] ) : 'Temp 1';

				$post_attributes = array(
					'post_title'  => $post_title,
					'post_type'   => $post_type,
					'post_status' => 'draft',
				);

				if ( 'elementor_library' === $post_type ) {
					$ell_type     = empty( $el_type ) ? 'page' : $el_type;
					$new_document = \Elementor\Plugin::$instance->documents->create(
						$ell_type,
						$post_attributes
					);
				} else {
					$new_document = \Elementor\Plugin::$instance->documents->create(
						$post_attributes['post_type'],
						$post_attributes
					);
				}

				if ( is_wp_error( $new_document ) ) {
					return array(
						'success'       => false,
						'import_failed' => $new_document->get_error_message(),
						'code'          => $new_document->get_error_code(),
					);
				}

				$post_content  = isset( $json ) && ! empty( $json ) && isset( $json['content'] ) ? $json['content'] : array();
				$post_settings = isset( $json ) && ! empty( $json ) && isset( $json['page_settings'] ) ? $json['page_settings'] : array();
				$post_content  = $this->ele_media_import( $post_content );

				// Loop through each top-level element (For Atomic Images Upload)
				foreach ( $post_content as &$element ) {
					Uich_Elementor_Import_Images::process_and_upload_images( $element );
				}

				$new_document->save(
					array(
						'elements' => $post_content,
						'settings' => $post_settings,
					)
				);

				$inserted_id = $new_document->get_main_id();

				if ( 'nxt_builder' === $post_type && ! empty( $el_type ) ) {
					if ( '' === get_post_meta( $inserted_id, 'nxt-hooks-layout', true ) ) {
						if ( 'header' == $el_type || 'footer' == $el_type ) {
							add_post_meta( $inserted_id, 'nxt-hooks-layout-sections', $el_type );
							add_post_meta( $inserted_id, 'nxt-hooks-layout', 'sections' );
						}
						if ( 'page-404' == $el_type || 'singular' == $el_type || 'archives' == $el_type ) {
							add_post_meta( $inserted_id, 'nxt-hooks-layout-pages', $el_type );
							add_post_meta( $inserted_id, 'nxt-hooks-layout', 'pages' );
						}
					}
				}

				return array(
					'success' => true,
					'result'  => array(
						'title'     => get_the_title( $inserted_id ),
						'edit_link' => get_edit_post_link( $inserted_id, 'internal' ),
						'view'      => get_permalink( $inserted_id ),
					),
				);

			} elseif ( 'false' === $new_import ) {
				$exist_post_id     = ( isset( $_GET['importToPost'] ) && ! empty( $_GET['importToPost'] ) ) ? (int) sanitize_text_field( wp_unslash( $_GET['importToPost'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
				$importByReplacing = ( isset( $_GET['importByReplacing'] ) && ! empty( $_GET['importByReplacing'] ) ) ? sanitize_text_field( wp_unslash( $_GET['importByReplacing'] ) ) : 'false';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

				if ( empty( $exist_post_id ) ) {
					return array(
						'success' => false,
						'message' => esc_html__( 'Post ID not provided for Updating.', 'uichemy' ),
					);
				}

				$exits_post_type = get_post_type( $exist_post_id );

				if ( empty( $exits_post_type ) || $exits_post_type !== $post_type ) {
					return array(
						'success' => false,
						'message' => esc_html__( 'Post does not exist with given ID & Type.', 'uichemy' ),
					);
				}

				$document = Elementor\Plugin::$instance->documents->get_doc_or_auto_save( $exist_post_id );

				if ( $document ) {
					$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

					// Set current user as admin.
					wp_set_current_user( null, $selected_user );

					// Get the content and convert it to JSON
					$exits_content = $document->get_elements_data();

					$json_array     = json_decode( $json, true );
					$update_content = ! empty( $json_array ) && isset( $json_array['content'] ) ? $json_array['content'] : array();

					// Loop through each top-level element (For Atomic Images Upload)
					foreach ( $update_content as &$element ) {
						Uich_Elementor_Import_Images::process_and_upload_images( $element );
					}

					if ( ! empty( $importByReplacing ) && 'false' == $importByReplacing ) {
						$merged_content = array_merge( $exits_content, $update_content );
					} elseif ( ! empty( $importByReplacing ) && 'true' == $importByReplacing ) {
						$merged_content = $update_content;
					}

					// Save Images <-- Test this
					$merged_content = $this->ele_media_import( $merged_content );

					$document->save(
						array(
							'elements' => $merged_content,
						)
					);

					return array(
						'success' => true,
						'result'  => array(
							'title'     => get_the_title( $exist_post_id ),
							'edit_link' => get_edit_post_link( $exist_post_id, 'internal' ),
							'view'      => get_permalink( $exist_post_id ),
						),
					);

				} else {
					return array(
						'success' => false,
						'message' => esc_html__( 'This post doesn\'t have Elementor data.', 'uichemy' ),
					);
				}
			}

			// Remove added filter.
			remove_filter( 'http_request_timeout', 'uich_modify_http_request_default_timeout', 1 );
		}


		/**
		 * Handle Gutenberg import
		 *
		 * @param WP_REST_Request $request WP_REST_Request object.
		 */
		public function uich_handle_gutenberg_import( WP_REST_Request $request ) {
			// Sub builder type
			$builder = sanitize_text_field( $request->get_param( 'subBuilderType' ) ?? '' );

			// Get Parameters
			$new_import           = ( isset( $_GET['newImport'] ) && ! empty( $_GET['newImport'] ) ) ? sanitize_text_field( wp_unslash( $_GET['newImport'] ) ) : 'true';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$post_type            = ( isset( $_GET['postType'] ) && ! empty( $_GET['postType'] ) ) ? sanitize_text_field( wp_unslash( $_GET['postType'] ) ) : 'page';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$nexter_post_sub_type = ( isset( $_GET['nexterPostSubType'] ) && ! empty( $_GET['nexterPostSubType'] ) ) ? sanitize_text_field( wp_unslash( $_GET['nexterPostSubType'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$post_title           = ( isset( $_GET['postTitle'] ) && ! empty( $_GET['postTitle'] ) ) ? sanitize_text_field( wp_unslash( $_GET['postTitle'] ) ) : 'New Post - UiChemy';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

			// postType: 'page' | 'nexter' | 'gutenberg_pattern'
			$post_type_map = array(
				'page'              => 'page',
				'gutenberg_pattern' => 'wp_block',
				'nexter'            => 'nxt_builder',
			);
			$post_type     = array_key_exists( $post_type, $post_type_map )
				? $post_type_map[ $post_type ]
				: 'wp_block';

			// nexterPostSubType: "standard-template" | "header" | "footer" | "singular" | "archive-page" | "404-page" | null
			if ( 'nxt_builder' === $post_type ) {
				$temp_type_map = array(
					'standard-template' => 'none',
					'header'            => 'header',
					'footer'            => 'footer',
					'singular'          => 'singular',
					'archive-page'      => 'archives',
					'404-page'          => 'page-404',
				);

				$el_type = array_key_exists( $nexter_post_sub_type, $temp_type_map )
					? $temp_type_map[ $nexter_post_sub_type ]
					: 'none';
			}

			// Get the Data to Import
			$data = $request->get_body();

			// Check if Empty
			if ( empty( $data ) ) {
				// Return an error response.
				return array(
					'success' => false,
					'message' => esc_html__( 'No data was provided to import.', 'uichemy' ),
				);
			}

			if ( 'true' === $new_import ) {

				// Get the data & Import
				$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

				// Set current user as admin.
				wp_set_current_user( null, $selected_user );

				// Disable Error Displaying
				ini_set( 'display_errors', 0 ); // phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged -- Suppress notices so the REST import returns clean JSON.

				$data = $this->import_gutenberg_media( $data );

				// Replace \n with \\n for custom css
				$data = preg_replace( '/\\\\n/', "\\\\\\\\n", $data );

				$post_attributes = array(
					'post_title'   => $post_title,
					'post_content' => $data,
					'post_type'    => $post_type,
					'post_status'  => 'draft',
				);

				$inserted_id = wp_insert_post( $post_attributes );

				if ( is_wp_error( $inserted_id ) ) {
					return array(
						'success' => false,
						'message' => $inserted_id->get_error_message(),
					);
				} else {
					if ( 'nxt_builder' === $post_type && ! empty( $el_type ) ) {
						if ( '' === get_post_meta( $inserted_id, 'nxt-hooks-layout', true ) ) {
							if ( 'header' == $el_type || 'footer' == $el_type ) {
								add_post_meta( $inserted_id, 'nxt-hooks-layout-sections', $el_type );
								add_post_meta( $inserted_id, 'nxt-hooks-layout', 'sections' );
							}
							if ( 'page-404' == $el_type || 'singular' == $el_type || 'archives' == $el_type ) {
								add_post_meta( $inserted_id, 'nxt-hooks-layout-pages', $el_type );
								add_post_meta( $inserted_id, 'nxt-hooks-layout', 'pages' );
							}
						}
					}

					return array(
						'success' => true,
						'result'  => array(
							'title'     => get_the_title( $inserted_id ),
							'edit_link' => get_edit_post_link( $inserted_id, 'internal' ),
							'view'      => 'wp_block' === $post_type || 'GenBlocks' === $builder
								? get_edit_post_link( $inserted_id, 'internal' )
								: get_permalink( $inserted_id ),
						),
					);
				}
			} elseif ( 'false' === $new_import ) {
				// In case of Existing Import
				$exist_post_id     = ( isset( $_GET['importToPost'] ) && ! empty( $_GET['importToPost'] ) ) ? (int) sanitize_text_field( wp_unslash( $_GET['importToPost'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
				$importByReplacing = ( isset( $_GET['importByReplacing'] ) && ! empty( $_GET['importByReplacing'] ) ) ? sanitize_text_field( wp_unslash( $_GET['importByReplacing'] ) ) : 'false';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

				if ( empty( $exist_post_id ) ) {
					return array(
						'success' => false,
						'message' => esc_html__( 'Post ID not provided for Updating.', 'uichemy' ),
					);
				}

				$exits_post_type = get_post_type( $exist_post_id );

				if ( empty( $exits_post_type ) || $exits_post_type !== $post_type ) {
					return array(
						'success' => false,
						'message' => esc_html__( 'Post does not exist with given ID & Type.', 'uichemy' ),
					);
				}

				// Get selected user for Import
				$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

				// Set current user as admin.
				wp_set_current_user( null, $selected_user );

				// Get the content and convert it to JSON
				$post = get_post( $exist_post_id );

				// Initialize a variable to store the post content
				$exits_content = '';

				if ( ! empty( $post ) && isset( $post->post_content ) ) {
					$exits_content = $post->post_content;
				}

				// Content to Update
				$data = $this->import_gutenberg_media( $data );

				// Replace \n with \\n for custom css
				$data = preg_replace( '/\\\\n/', "\\\\\\\\n", $data );

				if ( ! empty( $importByReplacing ) && 'false' == $importByReplacing ) {
					$merged_content = $exits_content . $data;
				} elseif ( ! empty( $importByReplacing ) && 'true' == $importByReplacing ) {
					$merged_content = $data;
				}

				// Post to Update
				$post_attributes = array(
					'ID'           => $exist_post_id,
					'post_content' => $merged_content,
				);

				// Update the Post
				$update_post = wp_update_post( $post_attributes );

				if ( is_wp_error( $update_post ) ) {
					return array(
						'success' => false,
						'message' => $update_post->get_error_message(),
					);
				} else {
					// Remove Dynamic Cache
					// tpgb_library()->remove_dir_files(TPGB_ASSET_PATH);
					// tpgb_library()->remove_dir_dynamic_style_files(TPGB_ASSET_PATH);

					return array(
						'success' => true,
						'result'  => array(
							'title'     => get_the_title( $exist_post_id ),
							'edit_link' => get_edit_post_link( $exist_post_id, 'internal' ),
							'view'      => get_edit_post_link( $exist_post_id, 'internal' ), // Temp Fix for Caching Issue
						// 'view'      => $post_type === 'wp_block'
						// ? get_edit_post_link( $exist_post_id, 'internal' )
						// : get_permalink( $exist_post_id ),
						),
					);
				}
			}

			// Remove added filter.
			remove_filter( 'http_request_timeout', 'uich_modify_http_request_default_timeout', 1 );
		}


		/**
		 * Handle Bricks import
		 *
		 * @param WP_REST_Request $request WP_REST_Request object.
		 */
		public function uich_handle_bricks_import_v2( WP_REST_Request $request ) {
			// Check if Bricks Installed
			if ( ! class_exists( '\Bricks\Theme' ) || ! class_exists( ( '\Bricks\Templates' ) ) || ! class_exists( 'Bricks\Frontend' ) ) {
				return array(
					'success' => false,
					'message' => 'Please Install & Activate Bricks First.',
				);
			}

			// Get Parameters
			$new_import           = ( isset( $_GET['newImport'] ) && ! empty( $_GET['newImport'] ) ) ? sanitize_text_field( wp_unslash( $_GET['newImport'] ) ) : 'true';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$post_type            = ( isset( $_GET['postType'] ) && ! empty( $_GET['postType'] ) ) ? sanitize_text_field( wp_unslash( $_GET['postType'] ) ) : 'page';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			$bricks_post_sub_type = ( isset( $_GET['bricksPostSubType'] ) && ! empty( $_GET['bricksPostSubType'] ) ) ? sanitize_text_field( wp_unslash( $_GET['bricksPostSubType'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

			// postType: 'page' | 'bricks'
			$post_type_map = array(
				'page'   => 'page',
				'bricks' => 'bricks_template',
			);
			$post_type     = array_key_exists( $post_type, $post_type_map ) ? $post_type_map[ $post_type ] : 'page';

			// bricksPostSubType: "standard-template" | "header" | "footer" | "section" | "popup" | "archive" | "search-results" | "error-page" | null
			$el_type = 'content';
			if ( 'bricks_template' === $post_type ) {
				$temp_type_map = array(
					'standard-template' => 'content',
					'header'            => 'header',
					'footer'            => 'footer',
					'section'           => 'section',
					'popup'             => 'popup',
					'archive'           => 'archive',
					'search-results'    => 'search',
					'error-page'        => 'error',
				);

				$el_type = array_key_exists( $bricks_post_sub_type, $temp_type_map )
					? $temp_type_map[ $bricks_post_sub_type ]
					: 'content';
			}

			// Get The Body
			$json = $request->get_body();

			// Check if Empty
			if ( empty( $json ) ) {
				// Return an error response.
				return array(
					'success' => false,
					'message' => esc_html__( 'No JSON data found.', 'uichemy' ),
				);
			}

			// Import
			if ( 'true' === $new_import ) {

				// Get the data & Import
				$json = json_decode( $json, true );

				// Get selected user for Import
				$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

				// Set current user as admin.
				wp_set_current_user( null, $selected_user );

				// Disable Error Displaying
				ini_set( 'display_errors', 0 ); // phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged -- Suppress notices so the REST import returns clean JSON.

				$post_title   = ! empty( $json ) && isset( $json['title'] ) ? sanitize_text_field( $json['title'] ) : 'Bricks Template';
				$post_content = isset( $json ) && ! empty( $json ) && isset( $json['content'] ) ? $json['content'] : array();
				$post_content = $this->import_bricks_media( $post_content );

				// for page settings
				$page_settings = isset( $json ) && ! empty( $json ) && isset( $json['pageSettings'] ) ? $json['pageSettings'] : array();
				$page_settings = $this->import_bricks_media( $page_settings ); // Optional: Process media in pageSettings if needed

				$post_attributes = array(
					'post_title'   => $post_title,
					'post_content' => '',
					'post_type'    => $post_type,
					'post_status'  => 'draft',
				);

				$inserted_id = wp_insert_post( $post_attributes );

				if ( is_wp_error( $inserted_id ) ) {
					return array(
						'success' => false,
						'message' => $inserted_id->get_error_message(),
					);
				} else {
					$meta_el_type = 'header' === $el_type || 'footer' === $el_type
						? $el_type
						: 'content';

					// Add the Bricks content meta key
					update_post_meta( $inserted_id, '_bricks_page_' . esc_attr( $meta_el_type ) . '_2', $post_content );

					update_post_meta( $inserted_id, '_bricks_editor_mode', 'bricks' );
					update_post_meta( $inserted_id, '_bricks_template_type', esc_attr( $el_type ) );
					update_post_meta( $inserted_id, '_bricks_page_settings', $page_settings );

					return array(
						'success' => true,
						'result'  => array(
							'title'     => get_the_title( $inserted_id ),
							'edit_link' => get_edit_post_link( $inserted_id, 'internal' ),
							'view'      => get_permalink( $inserted_id ),
						),
					);
				}
			} elseif ( 'false' === $new_import ) {
				// In case of Existing Import
				$exist_post_id     = ( isset( $_GET['importToPost'] ) && ! empty( $_GET['importToPost'] ) ) ? (int) sanitize_text_field( wp_unslash( $_GET['importToPost'] ) ) : '';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
				$importByReplacing = ( isset( $_GET['importByReplacing'] ) && ! empty( $_GET['importByReplacing'] ) ) ? sanitize_text_field( wp_unslash( $_GET['importByReplacing'] ) ) : 'false';  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

				if ( empty( $exist_post_id ) ) {
					return array(
						'success' => false,
						'message' => esc_html__( 'Post ID not provided for Updating.', 'uichemy' ),
					);
				}

				$exits_post_type = get_post_type( $exist_post_id );

				if ( empty( $exits_post_type ) || $exits_post_type !== $post_type ) {
					return array(
						'success' => false,
						'message' => esc_html__( 'Post does not exist with given ID & Type.', 'uichemy' ),
					);
				}

				// Get the Selected Uer for Importing.
				$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

				// Set current user as admin.
				wp_set_current_user( null, $selected_user );

				// Get the content and convert it to JSON
				$post = get_post( $exist_post_id );

				// Initialize a variable to store the post content
				$exits_content       = array();
				$exits_page_settings = array();
				$get_temp_type       = 'content';
				if ( ! empty( $post ) ) {
					$get_temp_type = get_post_meta( $exist_post_id, '_bricks_template_type', true );

					// Content key
					$get_temp_type = 'header' === $get_temp_type || 'footer' === $get_temp_type
						? $get_temp_type
						: 'content';

					if ( ! empty( $get_temp_type ) ) {
						$exits_content       = get_post_meta( $exist_post_id, '_bricks_page_' . esc_attr( $get_temp_type ) . '_2', true );
						$exits_page_settings = get_post_meta( $exist_post_id, '_bricks_page_settings', true );
					}
				}

				$json_array           = json_decode( $json, true );
				$update_content       = ! empty( $json_array ) && isset( $json_array['content'] ) ? $json_array['content'] : array();
				$update_page_settings = ! empty( $json_array ) && isset( $json_array['pageSettings'] ) ? $json_array['pageSettings'] : array();
				$update_page_settings = $this->import_bricks_media( $update_page_settings );
				$update_content       = $this->import_bricks_media( $update_content );

				if ( ! empty( $importByReplacing ) && 'false' == $importByReplacing ) {
					$merged_content       = array_merge( $exits_content, $update_content );
					$merged_page_settings = array_merge( $exits_page_settings, $update_page_settings );
				} elseif ( ! empty( $importByReplacing ) && 'true' == $importByReplacing ) {
					$merged_content       = $update_content;
					$merged_page_settings = $update_page_settings;
				}

				if ( ! empty( $get_temp_type ) ) {

					update_post_meta( $exist_post_id, '_bricks_page_' . esc_attr( $get_temp_type ) . '_2', $merged_content );
					update_post_meta( $exist_post_id, '_bricks_page_settings', $merged_page_settings );
					return array(
						'success' => true,
						'result'  => array(
							'title'     => get_the_title( $exist_post_id ),
							'edit_link' => get_edit_post_link( $exist_post_id, 'internal' ),
							'view'      => get_permalink( $exist_post_id ),
						),
					);
				}

				return array(
					'success' => false,
					'message' => esc_html__( 'Could not update the data.', 'uichemy' ),
				);
			}
		}



		/**
		 * Check handle check
		 *
		 * @since   1.0.0
		 *
		 * @param WP_REST_Request $request get current page slug.
		 */
		public function uich_handle_check( WP_REST_Request $request ) {

			return array(
				'success' => true,
				'message' => esc_html__( 'All Good.', 'uichemy' ),
			);
		}

		/**
		 * Filter to allow "token" header in Requests.
		 *
		 * @since 1.0.0
		 *
		 * @param mixed $value The value to check and return.
		 */
		public function uiche_rest_send_cors_headers( $value ) {
			$origin     = get_http_origin();
			$requesturi = ( isset( $_SERVER['REQUEST_URI'] ) && ! empty( $_SERVER['REQUEST_URI'] ) ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';

			// In case of non-pretty REST URLs
			$rest_route_str = '';
			if ( isset( $_GET['rest_route'] ) && ! empty( $_GET['rest_route'] ) ) {  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
				// Sanitize GET param
				$rest_route_str = sanitize_text_field( wp_unslash( $_GET['rest_route'] ) );  // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
			}

			if ( ! empty( $origin )
				&& ( ( preg_match( '/\/wp-json\/uichemy\/v/', wp_parse_url( $requesturi, PHP_URL_PATH ) ) === 1 )
				|| ( preg_match( '/^\/uichemy\/v/', $rest_route_str ) === 1 ) )
			) {
				// WP REST Takes care of Access-Control-Allow-Origin
				header( 'Access-Control-Allow-Headers: Authorization, Content-Type' );
			}

			return $value;
		}

		/**
		 * Check http_request time
		 *
		 * @since   1.0.0
		 */
		public function uich_modify_http_request_default_timeout() {
			return 30;
		}

		/**
		 * Send nonce for Bricks Import
		 *
		 * @since   1.0.0
		 *
		 * @param WP_REST_Request $request WP_REST_Request object.
		 */
		public function uich_handle_bricks_get_nonce( WP_REST_Request $request ) {

			// Get the user to use
			$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );

			// Set current user as admin.
			wp_set_current_user( null, $selected_user );

			// Create Nonce
			$nonce = wp_create_nonce( 'bricks-nonce-admin' );

			return array(
				'success' => true,
				'nonce'   => $nonce,
			);
		}

		/**
		 * Handle import for Bricks
		 *
		 * @since   1.0.0
		 *
		 * @param WP_REST_Request $request WP_REST_Request object.
		 */
		public function uich_handle_bricks_import( WP_REST_Request $request ) {

			if ( ! class_exists( '\Bricks\Theme' ) || ! class_exists( ( '\Bricks\Templates' ) ) ) {
				return array(
					'success' => false,
					'message' => 'Please Install & Activate Bricks First.',
				);
			}

			if ( empty( $_FILES ) || empty( $_FILES['files'] ) ) {  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
				return array(
					'success' => false,
					'message' => 'No file provided',
				);
			}

			// Get the user to use & Set current user
			$selected_user = apply_filters( 'uich_manage_usermanager', 'get_user' );
			wp_set_current_user( null, $selected_user );

			// Load WP_WP_Filesystem for temp file URL access
			global $wp_filesystem;

			if ( empty( $wp_filesystem ) ) {
				require_once ABSPATH . '/wp-admin/includes/file.php';

				WP_Filesystem();
			}

			/**
			 * Safe template import with sanitization
			 */
			if ( isset( $_FILES['files']['tmp_name'][0] ) && isset( $_FILES['files']['name'][0] ) ) {  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
				// Sanitize uploaded file info
				$file_tmp  = sanitize_text_field( wp_unslash( $_FILES['files']['tmp_name'][0] ) );  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.
				$file_name = sanitize_file_name( wp_unslash( $_FILES['files']['name'][0] ) );  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

				// Verify JSON file type
				$filetype = wp_check_filetype_and_ext( $file_tmp, $file_name );
				if ( 'json' === $filetype['ext'] && 'application/json' === $filetype['type'] ) {

					// Read contents
					$contents = $wp_filesystem->get_contents( $file_tmp );

					if ( $contents ) {
						$template = json_decode( $contents, true );

						if ( is_array( $template ) && isset( $template['content'] ) && is_array( $template['content'] ) ) {

							$elements = $template['content'];

							\Bricks\Templates::$template_images = array();

							foreach ( $elements as $index => $element ) {
								if ( ! empty( $element['settings'] ) && is_array( $element['settings'] ) ) {
									\Bricks\Theme::instance()->templates->import_images(
										$element['settings'],
										true
									);
								}
							}

							// STEP: Replace remote image data with imported/existing image data.
							if ( count( \Bricks\Templates::$template_images ) ) {
								$elements_encoded = wp_json_encode( $elements );

								foreach ( \Bricks\Templates::$template_images as $template_image ) {
									$elements_encoded = str_replace(
										wp_json_encode( $template_image['old'] ),
										wp_json_encode( $template_image['new'] ),
										$elements_encoded
									);
								}

								$elements = json_decode( $elements_encoded, true );

								$template['content'] = $elements;

								// Replace Uploaded File Contents for Importing (safe JSON encoding)
								$wp_filesystem->put_contents( $file_tmp, wp_json_encode( $template ) );
							}

							// Import & Return the value
							\Bricks\Theme::instance()->templates->import_template();
						}
					}
				}
			}
		}

		/**
		 * Error JSON message
		 *
		 * @param array  $data give array.
		 * @param string $status api code number.
		 * */
		public function uich_error_msg( $data = null, $status = null ) {
			wp_send_json_error( $data );
			wp_die();
		}

		/**
		 * Response Message
		 *
		 * @param array   $success give array.
		 * @param message $status api code number.
		 * @param message $description api code number.
		 * @param message $data give array or string.
		 * */
		public function uich_response( $message = '', $description = '', $success = false, $data = '' ) {

			return array(
				'message'     => $message,
				'description' => $description,
				'success'     => $success,
				'data'        => $data,
			);
		}

		/**
		 * Create Default setting data in db
		 *
		 * @since 1.2.2
		 *
		 * @param string $type use for check page type.
		 */
		public function uich_recommended_settings( $type ) {

			if ( 'elementor_install' === $type ) {
				if ( is_plugin_active( $this->elementor_pluginpath ) ) {
					return $this->uich_response( 'Elementor Activated', 'Elementor Activated', true, '' );
				} else {
					return $this->uich_response( 'Elementor Not Activated', 'Elementor Not Activated', false, '' );
				}
			} elseif ( 'flexbox_container' === $type ) {
				$get_default = get_option( $this->flexbox_container_db );

				return $this->uich_response( '', '', true, $get_default );
			} elseif ( 'enable_unfiltered_file_uploads' === $type ) {
				$get_default = get_option( $this->file_uploads_db );

				return $this->uich_response( '', '', true, $get_default );
			} elseif ( 'bricks_svg_uploads' === $type ) {
				$uroles     = get_editable_roles();
				$capability = 'bricks_upload_svg';
				$briRole    = array();
				foreach ( $uroles as $role_key => $role_data ) {
					if ( isset( $role_data['capabilities'][ $capability ] ) && true === $role_data['capabilities'][ $capability ] ) {
						$briRole[ $role_key ] = $role_data;
					}
				}

				return $this->uich_response( '', '', true, $briRole );
			} elseif ( 'tpgb_install' === $type ) {
				if ( is_plugin_active( $this->tpgb_plugin_path ) ) {
					return $this->uich_response( 'The Plus Blocks for Block Editor Activated', 'The Plus Blocks for Block Edito Activated', true, '' );
				} else {
					return $this->uich_response( 'The Plus Blocks for Block Editor Not Activated', 'The Plus Blocks for Block Edito Not Activated', false, '' );
				}
			} elseif ( 'kadence_install' === $type ) {
				if ( is_plugin_active( 'kadence-blocks/kadence-blocks.php' ) ) {
					return $this->uich_response( 'Kadence Blocks Activated', 'Kadence Blocks Activated', true, '' );
				} else {
					return $this->uich_response( 'Kadence Blocks Not Activated', 'Kadence Blocks Not Activated', false, '' );
				}
			} elseif ( 'generateblocks_install' === $type ) {
				if ( is_plugin_active( 'generateblocks/plugin.php' ) ) {
					return $this->uich_response( 'GenerateBlocks Activated', 'GenerateBlocks Activated', true, '' );
				} else {
					return $this->uich_response( 'GenerateBlocks Not Activated', 'GenerateBlocks Not Activated', false, '' );
				}
			} elseif ( 'spectra_install' === $type ) {
				if ( is_plugin_active( 'ultimate-addons-for-gutenberg/ultimate-addons-for-gutenberg.php' ) ) {
					return $this->uich_response( 'Spectra Activated', 'Spectra Activated', true, '' );
				} else {
					return $this->uich_response( 'Spectra Not Activated', 'Spectra Not Activated', false, '' );
				}
			}
		}

		/**
		 * Get uichemy Api Call Ajax.
		 *
		 * @since 1.0.10
		 */
		public function uich_api_call() {

			check_ajax_referer( 'uichemy-ajax-nonce', 'nonce' );

			if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
				wp_send_json( $this->uich_response( 'User Roll Issue', 'is_user_logged_in', true, '' ) );
				wp_die();
			}

			$type = isset( $_POST['type'] ) ? strtolower( sanitize_text_field( wp_unslash( $_POST['type'] ) ) ) : false;
			if ( empty( $type ) ) {
				wp_send_json( $this->uich_response( 'Something went wrong.', 'Type Not Found', true, '' ) );
				wp_die();
			}

			$key = isset( $_POST['key'] ) ? strtolower( sanitize_text_field( wp_unslash( $_POST['key'] ) ) ) : false;

			switch ( $type ) {
				case 'install_elementor':
					$data = $this->uich_install_elementor();
					break;
				case 'flexbox_container':
					$data = $this->uich_flexbox_container();
					break;
				case 'elementor_file_uploads':
					$data = $this->uich_elementor_file_uploads();
					break;
				case 'bricks_file_uploads':
					$data = $this->uich_bricks_file_uploads();
					break;
				case 'install_tpgb':
					$data = $this->uich_install_tpgb();
					break;
				case 'add_custom_option':
					$data = $this->uich_add_option( $key );
					break;
			}

			wp_send_json( $data );
			wp_die();
		}

		/**
		 * Install Elementor
		 *
		 * @since 1.0.0
		 * */
		public function uich_install_elementor() {
			include_once ABSPATH . 'wp-admin/includes/file.php';
			include_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
			include_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';

			// Resolve the package from wordpress.org via WP's native plugins_api()
			// (HTTPS + JSON). Never unserialize() a raw remote HTTP body — a
			// tampered/MITM'd response would be a PHP object-injection sink.
			$wporg = $this->uich_lookup_wporg_info( 'elementor' );
			if ( ! $wporg || empty( $wporg['download_link'] ) ) {
				return $this->uich_response( 'Something Went Wrong', 'get body', false, '' );
			}

			$upgrad = new \Plugin_Upgrader( new \Automatic_Upgrader_Skin() );

			/**Install Plugin*/
			$elementor_Install = $upgrad->install( $wporg['download_link'] );
			if ( is_wp_error( $elementor_Install ) ) {
				return $this->uich_response( 'Something Went Wrong', 'Install Plugin', false, $elementor_Install );
			}

			/**Activate Plugin*/
			if ( true === $elementor_Install ) {
				$elementor_active = activate_plugin( $upgrad->plugin_info(), '', false, true );

				if ( is_wp_error( $elementor_active ) ) {
					return $this->uich_response( 'Something Went Wrong', 'Activate Plugin', false, $elementor_active );
				}

				$success = null === $elementor_active;

				return $this->uich_response( 'Successfully Activated!', 'Elementor Installed and Activated Successfully.', $success, '' );
			} else {
				activate_plugin( $this->elementor_pluginpath );

				if ( is_plugin_active( $this->elementor_pluginpath ) ) {
					return $this->uich_response( 'Successfully Activated!', 'Elementor Installed and Activated Successfully.', true, '' );
				} else {
					return $this->uich_response( 'Something Went Wrong', 'Not Activate Plugin', false, '' );
				}
			}
		}

		/**
		 * Flexbox Container
		 *
		 * @since 1.2.2
		 * */
		public function uich_flexbox_container() {

			if ( 'active' !== get_option( $this->flexbox_container_db ) ) {
				update_option( $this->flexbox_container_db, 'active' );

				return $this->uich_response( 'Successfully Enabled!', 'Flexbox Container activated Successfully.', true, '' );
			} else {
				return $this->uich_response( 'Something Went Wrong', 'Flexbox Container Alredy Activated', true, '' );
			}
		}

		/**
		 * Flexbox Container
		 *
		 * @since 1.2.2
		 * */
		public function uich_elementor_file_uploads() {
			$fileupload = get_option( $this->file_uploads_db );

			if ( empty( $fileupload ) && 1 !== $fileupload ) {
				update_option( $this->file_uploads_db, 1 );

				return $this->uich_response( 'Successfully Enabled!', 'Unfiltered File Uploads activated Successfully.', true, '' );
			} else {
				return $this->uich_response( 'Something Went Wrong', 'File Uploads Alredy Activated', true, '' );
			}
		}

		/**
		 * Bricks File Uploads
		 *
		 * @since 1.2.2
		 */
		public function uich_bricks_file_uploads() {

			$roles = wp_roles()->get_names();
			foreach ( $roles as $role_key => $label ) {
				$role = get_role( $role_key );
				if ( $role && $role->has_cap( 'import' ) ) {
					wp_roles()->add_cap( $role_key, 'bricks_upload_svg' );
				}
			}

			return $this->uich_response( 'Successfully Enabled!', 'Unfiltered File Uploads activated Successfully.', true, '' );
		}

		public function ele_media_import( $content = array() ) {
			if ( ! class_exists( 'Uich_Import_Images' ) ) {
				require_once UICH_PATH . 'includes/admin/class-uich-import-images.php';
			}
			if ( ! empty( $content ) ) {
				$media_import = array( $content );
				$media_import = Uich_Import_Images::widgets_elements_id_change( $media_import );
				$media_import = Uich_Import_Images::widgets_import_media_copy_content( $media_import );
				$content      = $media_import[0];
			}
			return $content;
		}


		public function import_gutenberg_media( $content = '' ) {
			if ( ! class_exists( 'Uich_Import_Images' ) ) {
				require_once UICH_PATH . 'includes/admin/class-uich-import-images.php';
			}

			if ( defined( 'TPGB_VERSION' ) && defined( 'TPGB_PATH' ) ) {

				require_once TPGB_PATH . 'classes/global-options/tp-import-media.php';

				$content = parse_blocks( $content );

				$new_content = Uich_Import_Images::gutenberg_import_media_copy_content( $content );

				$content = '';
				foreach ( $new_content as $block ) {
					$content .= serialize_block( $block );
				}
			} else {
				$content = parse_blocks( $content );

				$new_content = Uich_Import_Images::gutenberg_import_media_copy_content( $content );

				$content = '';
				foreach ( $new_content as $block ) {
					$content .= serialize_block( $block );
				}
			}

			return $content;
		}

		public function import_bricks_media( $content = array() ) {

			if ( ! empty( $content ) ) {
				$elements                           = $content;
				\Bricks\Templates::$template_images = array();

				foreach ( $elements as $index => $element ) {
					if ( ! empty( $element['settings'] ) ) {
						\Bricks\Theme::instance()->templates->import_images( $element['settings'], true );
					}
				}

				// STEP: Replace remote image data with imported/existing image data.
				if ( count( \Bricks\Templates::$template_images ) ) {
					$elements_encoded = wp_json_encode( $elements );

					foreach ( \Bricks\Templates::$template_images as $template_image ) {
						$elements_encoded = str_replace(
							wp_json_encode( $template_image['old'] ),
							wp_json_encode( $template_image['new'] ),
							$elements_encoded
						);
					}

					$content = json_decode( $elements_encoded, true );
				}
			}

			return $content;
		}

		/**
		 * Install The Plus Block For Editor
		 *
		 * @since 2.3.2
		 * */
		public function uich_install_tpgb() {
			include_once ABSPATH . 'wp-admin/includes/file.php';
			include_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
			include_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';

			$pluginName = isset( $_POST['pluginName'] ) ? strtolower( sanitize_text_field( wp_unslash( $_POST['pluginName'] ) ) ) : false;  // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Authorized admin REST/AJAX handler; nonce/capability enforced at entry.

			// Resolve the package from wordpress.org via WP's native plugins_api()
			// (HTTPS + JSON) instead of unserialize()-ing a raw remote HTTP body,
			// which is a PHP object-injection sink on a tampered/MITM'd response.
			$wporg = $pluginName ? $this->uich_lookup_wporg_info( $pluginName ) : null;
			if ( ! $wporg || empty( $wporg['download_link'] ) ) {
				return $this->uich_response( 'Something Went Wrong', 'get body', false, '' );
			}

			$upgrad = new \Plugin_Upgrader( new \Automatic_Upgrader_Skin() );

			/**Install Plugin*/
			$tpgb_plugin = $upgrad->install( $wporg['download_link'] );
			if ( is_wp_error( $tpgb_plugin ) ) {
				return $this->uich_response( 'Something Went Wrong', 'Install Plugin', false, $tpgb_plugin );
			}

			/**Activate Plugin*/
			if ( true === $tpgb_plugin ) {
				$tpgb_active = activate_plugin( $upgrad->plugin_info(), '', false, true );

				if ( is_wp_error( $tpgb_active ) ) {
					return $this->uich_response( 'Something Went Wrong', 'Activate Plugin', false, $tpgb_active );
				}

				$success = null === $tpgb_active;

				return $this->uich_response( 'Successfully Activated!', 'The Plus Blocks for Block Editor Installed and Activated Successfully.', $success, '' );
			} else {
				activate_plugin( $pluginName . '/' . $pluginName . '.php' );

				if ( is_plugin_active( $pluginName . '/' . $pluginName . '.php' ) ) {
					return $this->uich_response( 'Successfully Activated!', 'The Plus Blocks for Block Editor Installed and Activated Successfully.', true, '' );
				} else {
					return $this->uich_response( 'Something Went Wrong', 'Not Activate Plugin', false, '' );
				}
			}
		}

		public function uich_add_option( $key ) {
			/**
			 * Option keys this toggle is allowed to flip. The handler only ever
			 * exposes UiChemy's own "Custom CSS Field" switch, but $key arrives from
			 * the request ($_POST['key']); without this allowlist an admin request
			 * could toggle ANY option — users_can_register, default_role, another
			 * plugin's flag — to a boolean. Bound it to UiChemy-owned keys.
			 *
			 * @param string[] $keys Allowed option names.
			 */
			$allowed = (array) apply_filters( 'uich_custom_option_allowed_keys', array( 'uictmcss_enabled' ) );

			if ( ! in_array( (string) $key, $allowed, true ) ) {
				return $this->uich_response( 'Not Allowed', 'This option cannot be changed.', false, '' );
			}

			$current_value = get_option( $key );

			if ( ! empty( $current_value ) ) {
				update_option( $key, false );
				return $this->uich_response( 'Successfully Disabled!', 'Custom CSS Field Deactivated Successfully.', true, '' );
			} else {
				if ( get_option( $key ) === false ) {
					add_option( $key, true );
				} else {
					update_option( $key, true );
				}

				return $this->uich_response( 'Successfully Enabled!', 'Custom CSS Field Activated Successfully.', true, '' );
			}
		}
	}

	new Uich_Api();
}
