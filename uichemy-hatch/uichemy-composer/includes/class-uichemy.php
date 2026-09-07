<?php

/**
 * The file that defines the core plugin class
 *
 * A class definition that includes attributes and functions used across both the
 * public-facing side of the site and the admin area.
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
 * The core plugin class.
 *
 * This is used to define internationalization, admin-specific hooks, and
 * public-facing site hooks.
 *
 * Also maintains the unique identifier of this plugin as well as the current
 * version of the plugin.
 *
 * @since      1.0.0
 * @package    UiChemy
 * @subpackage UiChemy/includes
 * @author     Posimyth <posimyth@gmail.com>
 */
class UiChemy {

	/**
	 * The loader that's responsible for maintaining and registering all hooks that power
	 * the plugin.
	 *
	 * @since    1.0.0
	 * @access   protected
	 * @var      UiChemy_Loader    $loader    Maintains and registers all hooks for the plugin.
	 */
	protected $loader;

	/**
	 * The unique identifier of this plugin.
	 *
	 * @since    1.0.0
	 * @access   protected
	 * @var      string    $plugin_name    The string used to uniquely identify this plugin.
	 */
	protected $plugin_name;

	/**
	 * The current version of the plugin.
	 *
	 * @since    1.0.0
	 * @access   protected
	 * @var      string    $version    The current version of the plugin.
	 */
	protected $version;

	/**
	 * Define the core functionality of the plugin.
	 *
	 * Set the plugin name and the plugin version that can be used throughout the plugin.
	 * Load the dependencies, define the locale, and set the hooks for the admin area and
	 * the public-facing side of the site.
	 *
	 * @since    1.0.0
	 */
	public function __construct() {
		if ( defined( 'UICHEMY_VERSION' ) ) {
			$this->version = UICHEMY_VERSION;
		} else {
			$this->version = '1.0.0';
		}
		$this->plugin_name = 'uichemy';

		$this->load_dependencies();
		$this->define_admin_hooks();
		$this->define_public_hooks();
	}

	/**
	 * Load the required dependencies for this plugin.
	 *
	 * Include the following files that make up the plugin:
	 *
	 * - UiChemy_Loader. Orchestrates the hooks of the plugin.
	 *
	 * Create an instance of the loader which will be used to register the hooks
	 * with WordPress.
	 *
	 * @since    1.0.0
	 * @access   private
	 */
	private function load_dependencies() {

		/**
		 * The class responsible for orchestrating the actions and filters of the
		 * core plugin.
		 */
		require_once plugin_dir_path( __DIR__ ) . 'includes/class-uichemy-loader.php';

		$this->loader = new UiChemy_Loader();

		// Load the Composer composer module (Elementor widget, editor assets,
		// REST endpoints, globals helpers and the isolated MCP server) once
		// WordPress and Elementor are available.
		add_action( 'plugins_loaded', array( $this, 'load_composer_module' ) );
	}

	/**
	 * Load the Composer composer module.
	 *
	 * Hooked on `plugins_loaded` so Elementor and the WordPress AI Client are
	 * available. The widget manager and enqueue classes self-instantiate on
	 * include; the MCP loader registers the isolated MCP server.
	 *
	 * @since    1.0.0
	 */
	public function load_composer_module() {
		// Free/Pro gating helpers (uichemy_upgrade_url(), the Pro feature map).
		// Loaded first so every gate below can rely on them.
		require_once UICHEMY_PATH . 'includes/uichemy-pro-gate.php';
		// The license manager (EDD) is Pro-only and no longer exists in this plugin —
		// Pro loads it from its own includes/plugin-modules.php. It grants update and
		// support entitlement and never unlocks a feature, so Free needs nothing here.
		// What counts as "a Composer widget" — the current type plus the names the
		// widget shipped under before. Plain functions, no Elementor dependency, and
		// read by the manager, the enqueue layer, the globals migration and the MCP
		// server, so it loads ahead of all of them.
		require_once UICHEMY_PATH . 'includes/admin/widgets/composer-widget-types.php';

		// Role-based access resolver — consulted by every gate (composer load,
		// frontend REST, feature REST), so it is loaded before them.
		require_once UICHEMY_PATH . 'includes/admin/class-uichemy-roles.php';
		require_once UICHEMY_PATH . 'includes/admin/class-uichemy-rest-permissions.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-container-width.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-variables.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-classes.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-globals-css.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-globals-css-rest.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-elementor-globals.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-elementor-globals-rest.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-atomic-globals.php';
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-globals-migration.php';
		require_once UICHEMY_PATH . 'includes/admin/class-uichemy-composer-enqueue.php';
		require_once UICHEMY_PATH . 'includes/admin/class-uichemy-composer-manager.php';
		// Publishes UiChemy's colour globals into the block theme's theme.json
		// palette (Site Editor → Styles → Colors → Edit palette, THEME row).
		// Reads BOTH token stores, so it must load after UiChemy_Variables,
		// UiChemy_Globals_CSS AND UiChemy_Composer_Manager — its init() hooks the
		// site-code option by class constant at include time, so an earlier
		// position silently drops that cache-flush hook.
		require_once UICHEMY_PATH . 'includes/admin/globals/class-uichemy-theme-globals.php';
		require_once UICHEMY_PATH . 'includes/mcp/class-uichemy-mcp-loader.php';
		require_once UICHEMY_PATH . 'includes/frontend/class-uichemy-frontend-rest.php';

		// Native Theme Builder (header / footer / single / 404). Registers the
		// uichemy_template CPT, resolver, rendering, REST and the public
		// `uichemy/theme_builder/create_template` creation hook.
		require_once UICHEMY_PATH . 'includes/theme-builder/class-uichemy-theme-builder.php';
		UiChemy_Theme_Builder::init();

		// Shared HTML renderer + the Gutenberg Composer block (uichemy/composer).
		// The block class self-instantiates on include and registers on `init`.
		require_once UICHEMY_PATH . 'includes/admin/widgets/class-uichemy-composer-renderer.php';
		require_once UICHEMY_PATH . 'includes/blocks/class-uichemy-gutenberg-composer.php';

		// Bricks Builder integration (UNVERIFIED — no Bricks core install was
		// available to test against; see includes/bricks/ for exactly what's
		// confirmed vs. best-effort). Safe to require unconditionally: it never
		// touches a \Bricks\* symbol outside an `init`-hooked, class_exists()-
		// gated callback, since Bricks (a theme) loads after plugins do.
		require_once UICHEMY_PATH . 'includes/bricks/class-uichemy-bricks-loader.php';

		// Dynamic-data engine (Twig: values, loops, conditions, filters),
		// dynamic tags, and the Atom forms subsystem.
		require_once UICHEMY_PATH . 'includes/dynamic/class-uich-dynamic.php';
		// Generated token catalog (see new-dashboard/tools/build-dd-catalog.js).
		// Pure data, no hooks — it just has to be loaded before anything asks for it.
		require_once UICHEMY_PATH . 'includes/dynamic/class-uich-dd-catalog.php';
		require_once UICHEMY_PATH . 'includes/dynamic/class-uich-dd-enqueue.php';
		require_once UICHEMY_PATH . 'includes/dynamic/dynamic-tags/class-uich-dynamic-tags.php';
		require_once UICHEMY_PATH . 'includes/forms/class-uich-forms-db.php';
		require_once UICHEMY_PATH . 'includes/forms/class-uich-forms.php';
		// Serves form submissions to the React dashboard's "Form Submissions" screen.
		require_once UICHEMY_PATH . 'includes/forms/class-uich-forms-dashboard.php';

		Uich_Dynamic::init();
		Uich_DD_Enqueue::init();
		Uich_Forms_DB::maybe_upgrade();
		Uich_Forms::init();
		Uich_Forms_Dashboard::init();

		// One-time, non-destructive import of the Elementor globals that v2
		// (classic kit + v4 atomic) designs reference into v3's own globals
		// store, with back-compat aliases. Flag-gated + idempotent. Hooked on
		// init (pri 25, after UiChemy_Variables' legacy-class migration on 20) so
		// Elementor's active kit is resolvable.
		add_action( 'init', array( 'UiChemy_Globals_Migration', 'maybe_migrate' ), 25 );

		// NOTE: ongoing globals sync is intentionally NOT automatic. After this
		// one-time migration the user edits globals in UiChemy's own Globals
		// manager; if they want to push those to / pull from the Elementor kit
		// they use the on-demand "Elementor Sync" action (UiChemy_Elementor_Globals
		// via the composer), so no background sync + no sync-state option is kept.

		if ( is_admin() ) {
			require_once UICHEMY_PATH . 'includes/forms/class-uich-forms-admin.php';
			Uich_Forms_Admin::init();

			// UiChemy control panel: top-level menu, dashboard, Settings,
			// Form Submissions and White Label. Required after the forms admin
			// so it can reference Uich_Forms_Admin::render.
			require_once UICHEMY_PATH . 'includes/admin/class-uichemy-admin-menu.php';
			UiChemy_Admin_Menu::init();
		}
	}

	/**
	 * Register all of the hooks related to the admin area functionality
	 * of the plugin.
	 *
	 * @since    1.0.0
	 * @access   private
	 */
	private function define_admin_hooks() {
		// The WPPB boilerplate demo enqueues (uichemy-admin.css/js, jQuery-dependent,
		// "for demonstration purposes only") were removed — they loaded on every
		// wp-admin page for no functional reason. Real admin assets are enqueued by
		// UiChemy_Admin_Menu, scoped to UiChemy screens only.
	}

	/**
	 * Register all of the hooks related to the public-facing functionality
	 * of the plugin.
	 *
	 * @since    1.0.0
	 * @access   private
	 */
	private function define_public_hooks() {
		// The WPPB boilerplate demo enqueues (uichemy-public.css/js, jQuery-dependent,
		// "for demonstration purposes only") were removed — they forced jQuery and an
		// empty stylesheet onto every front-end page. Front-end assets are enqueued
		// conditionally by the composer / dynamic-data modules where actually needed.
	}

	/**
	 * Run the loader to execute all of the hooks with WordPress.
	 *
	 * @since    1.0.0
	 */
	public function run() {
		$this->loader->run();
	}

	/**
	 * The name of the plugin used to uniquely identify it within the context of
	 * WordPress and to define internationalization functionality.
	 *
	 * @since     1.0.0
	 * @return    string    The name of the plugin.
	 */
	public function get_plugin_name() {
		return $this->plugin_name;
	}

	/**
	 * The reference to the class that orchestrates the hooks with the plugin.
	 *
	 * @since     1.0.0
	 * @return    UiChemy_Loader    Orchestrates the hooks of the plugin.
	 */
	public function get_loader() {
		return $this->loader;
	}

	/**
	 * Retrieve the version number of the plugin.
	 *
	 * @since     1.0.0
	 * @return    string    The version number of the plugin.
	 */
	public function get_version() {
		return $this->version;
	}
}
