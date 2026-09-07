<?php
/**
 * UiChemy import: fetch JSON from download URLs and run import (globals + pages).
 *
 * @package Uichemy
 */

defined( 'ABSPATH' ) || exit;

/*
 * Import reads posts by builder-specific meta keys (e.g. _elementor_data /
 * _breakdance_data / builder flags); these meta_query lookups are inherent
 * to detecting and importing builder content and run only for
 * admin-triggered, one-shot import calls, never on front-end loads.
 * suppress_filters is used to read raw builder post data without
 * translation/query-filter interference.
 */
// phpcs:disable WordPress.DB.SlowDBQuery.slow_db_query_meta_key, WordPress.DB.SlowDBQuery.slow_db_query_meta_query, WordPress.DB.SlowDBQuery.slow_db_query_meta_value, WordPressVIPMinimum.Performance.WPQueryParams.SuppressFilters_suppress_filters

/**
 * Class Uich_Webpage_Import
 */
class Uich_Webpage_Import {

	/**
	 * Option key for stored globals (used in page content).
	 */
	const OPTION_GLOBALS = 'uich_webpage_replacement_globals';

	/**
	 * Option key for stored UiChemy globals list (uichemy-globals.json -> metadata.uichemy_composer_site_custom_code).
	 */
	const OPTION_UICHEMY_GLOBALS = 'uichemy_composer_site_custom_code';

	/**
	 * Option key for stored replacement data (pages, navbar, footer, etc.).
	 */
	const OPTION_REPLACEMENT_DATA = 'uich_webpage_replacement_data';

	/**
	 * Transient key: created blog-post IDs accumulated across batched import-blog-posts
	 * requests, so the listing-widget update can run once on the final batch with every post.
	 */
	const TRANSIENT_BLOG_IMPORT_CREATED = 'uich_webpage_blog_import_created';

	/**
	 * Option key for last import meta (projectId, generatedAt, etc.).
	 */
	const OPTION_IMPORT_META = 'uich_webpage_replacement_import_meta';

	/**
	 * Option key for persisted old→new template ID map.
	 * Built once during fetch phase when elementor_template files are imported.
	 * Read by every import-single-page call to remap widget template references.
	 */
	const OPTION_TEMPLATE_ID_MAP = 'uich_webpage_template_id_map';

	/**
	 * Option key for the _id values this plugin wrote into the Elementor kit's global
	 * colors/typography/Plus-Addons preset lists on the last import (per list name).
	 * Lets the next import remove exactly what it previously added instead of either
	 * appending forever or wiping entries the site owner added by hand.
	 */
	const OPTION_MANAGED_GLOBAL_IDS = 'uich_webpage_managed_global_ids';

	/**
	 * Transient key prefix for async import-pages jobs (mirrors Uich_Webpage_Api's
	 * project-replacement job/poll pattern so a full-project import can't 504
	 * on shared-hosting gateway/PHP time limits).
	 */
	const IMPORT_JOB_PREFIX = 'uich_webpage_import_job_';

	/**
	 * Max seconds allotted to the deferred (post-response) import-pages job run.
	 */
	const IMPORT_JOB_TIME_LIMIT = 300;

	/**
	 * Job id currently in flight, per job type. Read by find_live_job_of_type()
	 * so a retry joins the running job instead of starting a rival one.
	 */
	const OPTION_LIVE_JOBS = 'uich_webpage_live_import_jobs';

	/**
	 * Seconds without a progress write after which a job is presumed dead.
	 *
	 * Generous on purpose: one wp_remote_get() in the fetch loop is allowed 120s,
	 * so anything shorter would declare a merely slow download a crash.
	 */
	const JOB_STALL_SECONDS = 180;

	/**
	 * Auth instance for optional Bearer token when fetching download URLs.
	 *
	 * @var Uich_Webpage_Auth
	 */
	protected $auth;

	/**
	 * Jobs queued in this request to run after the 202 response (loopback HTTP is often blocked on managed hosts).
	 *
	 * @var array<int, array{job_id: string, secret: string}>
	 */
	protected $pending_import_jobs = array();

	/**
	 * Prefetched replacement-file bodies: URL => raw response body.
	 *
	 * Filled by prefetch_replacement_bodies() (parallel batch download) and
	 * consumed by fetch_raw_body_from_url(); any URL not in here takes that
	 * method's own sequential wp_remote_get() exactly as before.
	 *
	 * @var array<string,string>
	 */
	protected $prefetched_bodies = array();

	/**
	 * Prefetched asset bodies: URL => local temp-file path.
	 *
	 * Filled by prefetch_assets() (parallel batch download) and consumed by
	 * import_asset(), which falls back to its own sequential download_url()
	 * for any URL not in here — so every existing call path keeps working
	 * unchanged when prefetching was skipped or failed.
	 *
	 * @var array<string,string>
	 */
	protected $prefetched_assets = array();

	/**
	 * Transient key of the job currently executing, or '' outside a job.
	 *
	 * Set by run_import_job() around its dispatch so long-running work can report
	 * progress without every worker needing a job id threaded through its
	 * signature (run_fetch_only() is public and has two other callers).
	 *
	 * @var string
	 */
	protected $active_job_key = '';

	/**
	 * In-memory cache for TPAE extension slugs detected from replacement files.
	 * Populated on the first call to collect_all_tpae_extensions_from_files() and
	 * reused for every subsequent call within the same request, avoiding redundant
	 * full-file scans once per page during import.
	 *
	 * @var array|null
	 */
	protected $tpae_extensions_cache = null;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->auth = new Uich_Webpage_Auth();
	}

	/**
	 * Auto-report any 4xx/5xx response from UiChemy AI Website Creator REST routes to the error-tracking service.
	 * Fires on rest_post_dispatch; returns the response unchanged.
	 *
	 * @param WP_HTTP_Response $response The response object.
	 * @param WP_REST_Server   $server   The REST server.
	 * @param WP_REST_Request  $request  The request.
	 * @return WP_HTTP_Response
	 */
	public function maybe_report_rest_error( $response, $server, $request ) {
		if ( false === strpos( $request->get_route(), '/uichemy/v2/webpage/' ) ) {
			return $response;
		}

		$status = $response->get_status();
		if ( $status < 400 ) {
			return $response;
		}

		$data       = $response->get_data();
		$error_code = ( is_array( $data ) && isset( $data['code'] ) ) ? (string) $data['code'] : 'REST_ERROR';

		// Skip auth errors — the user is not connected; nothing to attribute the error to.
		if ( 'not_authenticated' === $error_code ) {
			return $response;
		}

		// Skip the report-error proxy itself to avoid loops.
		if ( false !== strpos( $request->get_route(), '/report-error' ) ) {
			return $response;
		}

		$message = ( is_array( $data ) && isset( $data['message'] ) ) ? (string) $data['message'] : '';

		$critical_codes = array(
			'IMPORT_REST_URL_MISSING',
			'IMPORT_BLOCK_FUNCTIONS_MISSING',
			'INSTALL_PLUGIN_FORBIDDEN',
			'IMPORT_ELEMENTOR_NOT_ACTIVE',
		);
		$level = in_array( $error_code, $critical_codes, true ) ? 'fatal' : 'error';

		$api = new Uich_Webpage_Api();
		$api->report_error(
			$error_code,
			array(
				'message' => $message,
				'source'  => 'uichemy-webpage',
				'level'   => $level,
				'context' => array(
					'route'          => $request->get_route(),
					'http_status'    => $status,
					'plugin_version' => defined( 'UICH_WEBPAGE_VERSION' ) ? UICH_WEBPAGE_VERSION : '',
				),
			)
		);

		return $response;
	}

	/**
	 * Initialize REST routes.
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
		add_filter( 'rest_post_dispatch', array( $this, 'maybe_report_rest_error' ), 10, 3 );
		add_action( 'shutdown', array( $this, 'process_import_job_after_response' ), 999 );
		// Enqueue plus-button-presets.css in the block editor so that
		// --tpgb-btnpreset-* CSS custom properties resolve correctly in the
		// editor preview. The file's own enqueue_preset_file() skips admin
		// via is_admin(), leaving the vars undefined in the editor iFrame —
		// buttons then fall back to unstyled defaults until the user
		// manually reselects a preset. Loading it here on
		// enqueue_block_editor_assets fixes the initial render.
		// Priority 20 ensures this runs after Nexter/Pro's editor_assets() (priority 10)
		// has already enqueued tpgb-block-editor-js, so wp_add_inline_script() can attach
		// the plusGlobalOpt pre-population snippet to that handle.
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_tpgb_button_presets_in_editor' ), 20 );
	}

	/**
	 * Load plus-button-presets.css inside the Gutenberg editor iFrame.
	 *
	 * Nexter Blocks' Tpgb_Button_Preset_Vars::enqueue_preset_file() intentionally
	 * skips is_admin(), so the :root CSS variable declarations for button presets
	 * are absent in the editor. This causes button blocks whose attributes contain
	 * var(--tpgb-btnpreset-*) references to render without preset styles until the
	 * user manually reselects the preset (which resolves vars to literal values).
	 *
	 * We call the same file URL with the same filemtime version so the browser
	 * uses its cached copy when it's already been loaded on the frontend.
	 */
	public function enqueue_tpgb_button_presets_in_editor() {
		// Path logic mirrors Tpgb_Button_Preset_Vars::preset_file_path/url() (those are private).
		// We intentionally do NOT guard on class_exists(Tpgb_Button_Preset_Vars) because that
		// class is only required during block rendering (REST), NOT during enqueue_block_editor_assets,
		// so the guard would always bail and the CSS would never load.
		$upload = wp_upload_dir( null, false );
		if ( ! empty( $upload['error'] ) ) {
			return;
		}
		$subdir = 'theplus_gutenberg/plus-button-presets.css';
		$path   = trailingslashit( $upload['basedir'] ) . $subdir;
		$url    = trailingslashit( $upload['baseurl'] ) . $subdir;
		if ( file_exists( $path ) ) {
			wp_enqueue_style(
				'tpgb-button-presets-editor',
				$url,
				array(),
				(string) filemtime( $path )
			);
		} elseif ( class_exists( 'Tpgb_Button_Preset_Vars' ) && method_exists( 'Tpgb_Button_Preset_Vars', 'write_preset_file' ) ) {
			// Attempt to materialise the file on demand (class may or may not be loaded).
			Tpgb_Button_Preset_Vars::write_preset_file();
			if ( file_exists( $path ) ) {
				wp_enqueue_style(
					'tpgb-button-presets-editor',
					$url,
					array(),
					(string) filemtime( $path )
				);
			}
		}

		// ── Pre-populate window.plusGlobalOpt synchronously ──────────────────────
		//
		// Root cause of the editor preview bug:
		// blocks.js fetches /tpgb/v1/theplus_global_settings asynchronously and
		// sets window.plusGlobalOpt AFTER the block editor has already rendered the
		// first time.  The GlobalButtonPreset component (gy) runs its useEffect on
		// that first render, calls At() to look up the selected preset, gets an
		// empty object back (fetch not done yet), cannot find the preset, and so
		// never applies the preset overrides to the block attributes.  Because no
		// subsequent re-render is triggered once the fetch completes, the wrong
		// (unstyled / default-preset) appearance persists until the user manually
		// reselects the preset.
		//
		// Fix: inject the same payload that the REST endpoint returns as an inline
		// script that runs BEFORE blocks.js so that window.plusGlobalOpt is already
		// populated when the first render fires.  The async fetch will overwrite it
		// later with fresher data, but by then the preset has already been applied
		// and buttonPresetBackup is non-empty, so the guard in jt() prevents a
		// redundant re-application.
		$raw = get_option( 'tpgb_global_options', '' );
		if ( is_array( $raw ) ) {
			$settings_obj = $raw;
		} elseif ( is_string( $raw ) && '' !== $raw ) {
			$settings_obj = json_decode( $raw );
			if ( json_last_error() !== JSON_ERROR_NONE ) {
				$settings_obj = (object) array();
			}
		} else {
			$settings_obj = (object) array();
		}

		$payload = wp_json_encode(
			array(
				'success'  => true,
				'settings' => $settings_obj,
			)
		);

		// Only pre-populate if the script handle exists; avoids polluting the page
		// when this fires outside a normal block-editor context.
		if ( wp_script_is( 'tpgb-block-editor-js', 'registered' ) || wp_script_is( 'tpgb-block-editor-js', 'enqueued' ) ) {
			// ── Inline 1: pre-populate plusGlobalOpt ──
			wp_add_inline_script(
				'tpgb-block-editor-js',
				'(function(){if(typeof window.plusGlobalOpt==="undefined"){window.plusGlobalOpt=' . $payload . ';}})();',
				'before'
			);

			// ── Inline 2: pre-create the global-style placeholder ─────────────────
			//
			// blocks.js injects global preset CSS (Ko → Xo("", css)) only AFTER its
			// async REST fetch for /tpgb/v1/theplus_global_settings finishes.  By that
			// time every block's useEffect has already appended its per-block <style>
			// to the editor <head>.  When Xo eventually runs it APPENDS a brand-new
			// <style id="tpgb-global-style"> at the END of <head> — after all per-block
			// styles — so equal-specificity !important rules in the global sheet win
			// over the per-block ones.
			//
			// Pre-creating the element here (before blocks.js even loads) means it
			// occupies an EARLY position in <head>.  Xo will find the existing element
			// and only UPDATE its innerHTML — keeping it in place — while per-block
			// <style> elements continue to be appended after it.  Per-block CSS then
			// comes later in the cascade and wins, as intended.
			wp_add_inline_script(
				'tpgb-block-editor-js',
				'(function(){' .
					'if(!document.getElementById("tpgb-global-style")){' .
						'var s=document.createElement("style");' .
						's.id="tpgb-global-style";' .
						's.type="text/css";' .
						'document.head.appendChild(s);' .
					'}' .
				'})();',
				'before'
			);
		}
	}

	/**
	 * Register REST API routes.
	 */
	public function register_rest_routes() {
		register_rest_route(
			'uichemy/v2/webpage',
			'/import-replacement',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_import_replacement' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Fetch JSON from URLs only (no page creation). Call before import-pages.
		register_rest_route(
			'uichemy/v2/webpage',
			'/fetch-replacement-json',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_fetch_replacement_json' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Import pages from stored JSON (after fetch-replacement-json). Runs as an async
		// job (202 + jobId) so a full-project import can't 504 on shared-hosting gateway
		// timeouts; poll /import-job/{job_id} for the created_pages result.
		register_rest_route(
			'uichemy/v2/webpage',
			'/import-pages',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_import_pages' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Poll async import-pages job status.
		register_rest_route(
			'uichemy/v2/webpage',
			'/import-job/(?P<job_id>[a-zA-Z0-9]+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'rest_get_import_job_status' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Check status of required plugins (Elementor, Nexter Extension, The Plus Addons).
		register_rest_route(
			'uichemy/v2/webpage',
			'/check-plugins',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_check_plugins' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Check status of required theme and plugins:
		// 3 fixed Nexter items + plugins from sitemaps project.requiredPlugins.
		register_rest_route(
			'uichemy/v2/webpage',
			'/check-requirements',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_check_requirements' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Install and activate a single plugin by slug.
		register_rest_route(
			'uichemy/v2/webpage',
			'/install-plugin',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_install_plugin' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Install and activate Nexter theme.
		register_rest_route(
			'uichemy/v2/webpage',
			'/install-theme',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_install_theme' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Download pro plugin zips from requiredPlugins URLs (no install/activation).
		register_rest_route(
			'uichemy/v2/webpage',
			'/download-pro-plugins',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_download_pro_plugins' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Install all requirements (3 Nexter items):
		// 1. Theme: Nexter.
		// 2. Plugin: nexter-extension.
		// 3. Plugin: the-plus-addons-for-block-editor.
		register_rest_route(
			'uichemy/v2/webpage',
			'/install-requirements',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_install_requirements' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Import a single page or Nexter template (navbar/footer) by name from stored JSON.
		register_rest_route(
			'uichemy/v2/webpage',
			'/import-single-page',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_import_single_page' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Apply Elementor plugin settings after import.
		register_rest_route(
			'uichemy/v2/webpage',
			'/apply-plugin-settings',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_apply_plugin_settings' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Delete stored import scratch data (uich_webpage_replacement_data, etc.). Called
		// unconditionally at the end of every import, unlike apply-plugin-settings which
		// only runs when the user has an "advanced config" toggle on — see
		// cleanup_stale_import_options() for why cleanup can't stay coupled to that.
		register_rest_route(
			'uichemy/v2/webpage',
			'/import-cleanup',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_import_cleanup' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Apply Nexter theme settings (fluid container layout) after import.
		register_rest_route(
			'uichemy/v2/webpage',
			'/apply-theme-settings',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_apply_theme_settings' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Enable TPAE (Elementor) widgets used in stored templates.
		register_rest_route(
			'uichemy/v2/webpage',
			'/enable-widgets',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_enable_widgets' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);
		// Enable Nexter / TPG blocks used in stored Gutenberg data (mirrors enable_widgets for Elementor).
		register_rest_route(
			'uichemy/v2/webpage',
			'/enable-blocks',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_enable_blocks' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);
		register_rest_route(
			'uichemy/v2/webpage',
			'/import-blog-posts',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_import_blog_posts' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Move all existing posts/pages/theme-builder templates to draft before a fresh import.
		register_rest_route(
			'uichemy/v2/webpage',
			'/reset-content',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_reset_content' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

	}

	/**
	 * REST callback: return status of required plugins.
	 *
	 * Checks Elementor (and UiChemy for the Elementor builder). Nexter Extension
	 * and The Plus Addons are no longer required or installed by the import.
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response
	 */
	public function rest_check_plugins( $request ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		$all_plugins = get_plugins();
		$builder     = is_object( $request ) && method_exists( $request, 'get_param' ) ? $request->get_param( 'builder' ) : '';
		$builder     = is_string( $builder ) && '' !== $builder ? sanitize_key( $builder ) : 'elementor';

		// Nexter Extension is intentionally NOT listed: the import no longer installs
		// or requires it — every Theme Builder template goes to the UiChemy Theme
		// Builder now, so the nxt_builder CPT is not needed for a new import.
		$plugins_to_check = array(
			array(
				'name'          => 'elementor',
				'label'         => 'Elementor',
				'plugin_slug'   => 'elementor/elementor.php',
				'original_slug' => 'elementor',
				'icon'          => 'elementor',
			),
		);

		// UiChemy itself is not listed here either — see rest_check_requirements()
		// for why reporting the plugin that serves this route is both pointless and
		// unsafe.

		$result = array();
		foreach ( $plugins_to_check as $plugin ) {
			if ( isset( $plugin['status'] ) ) {
				$result[] = $plugin;
				continue;
			}
			$is_active    = is_plugin_active( $plugin['plugin_slug'] );
			$is_installed = isset( $all_plugins[ $plugin['plugin_slug'] ] );
			$status       = $is_active ? 'active' : ( $is_installed ? 'inactive' : 'not_installed' );

			$result[] = array(
				'name'          => $plugin['name'],
				'label'         => $plugin['label'],
				'plugin_slug'   => $plugin['plugin_slug'],
				'original_slug' => $plugin['original_slug'],
				'icon'          => $plugin['icon'],
				'status'        => $status,
			);
		}

		return new WP_REST_Response(
			array(
				'success' => true,
				'plugins' => $result,
			)
		);
	}

	/**
	 * REST callback: return status of required theme and plugins for Nexter-based imports.
	 *
	 * requiredPlugins source: sitemaps API (project.requiredPlugins), NOT globals.json.
	 *
	 * Checks 3 fixed Nexter items + plugins from sitemaps project.requiredPlugins.
	 *
	 * @param WP_REST_Request $request Full request with requiredPlugins array from sitemaps.
	 * @return WP_REST_Response
	 */
	public function rest_check_requirements( $request ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		$params           = $request->get_json_params();
		$required_plugins = isset( $params['requiredPlugins'] ) && is_array( $params['requiredPlugins'] ) ? $params['requiredPlugins'] : array();
		// Only free plugin names (not zip URLs); pro URLs belong in download-pro-plugins.
		$required_plugins = array_values(
			array_filter(
				$required_plugins,
				function ( $item ) {
					return is_string( $item ) && '' !== $item
						&& 0 !== strpos( $item, 'http://' )
						&& 0 !== strpos( $item, 'https://' );
				}
			)
		);

		$all_plugins = get_plugins();

		// Check Nexter theme status.
		$theme_result = $this->get_nexter_theme_status();

		/*
		 * Nexter Extension is no longer force-installed. Every Theme Builder
		 * template the import creates — both editors, every type — now goes to the
		 * UiChemy Theme Builder (see create_or_update_theme_builder_template), so
		 * the nxt_builder CPT is not needed for a new import.
		 *
		 * It can still arrive through a project's own requiredPlugins list below,
		 * and sites imported before this change keep their nxt_builder templates;
		 * UiChemy's resolver defers to an active one, so nothing there breaks.
		 */
		/*
		 * UiChemy itself is deliberately NOT listed. It owns the Theme Builder for
		 * both builders, so it does have to be present — but it always already is:
		 * this REST route, and the dashboard that calls it, are served BY UiChemy.
		 * A row for it could therefore only ever render an instant tick, under a
		 * heading that says "Adding the theme and required plugins" — claiming
		 * credit for installing something that was running the whole time.
		 *
		 * Listing it was also actively unsafe. Detection matched the plugin folder
		 * name exactly ("uichemy/"), so a copy living in uichemy-main/ (a GitHub
		 * zip) or uichemy-2.0/ (a tagged download) read as not-installed on a
		 * Free-only site, and the row would then install UiChemy from wordpress.org
		 * alongside the copy already running — two active copies of the same
		 * plugin, duplicate class definitions, fatal.
		 */
		$plugins_to_check = array();

		// Add plugins from sitemaps project.requiredPlugins (e.g. "Elementor", "The Plus Addons for Elementor Free").
		$sitemaps_plugins = $this->map_sitemaps_required_plugins_to_slugs( $required_plugins );
		foreach ( $sitemaps_plugins as $sp ) {
			$exists = false;
			foreach ( $plugins_to_check as $existing ) {
				if ( $existing['name'] === $sp['name'] ) {
					$exists = true;
					break;
				}
			}
			if ( ! $exists ) {
				$plugins_to_check[] = $sp;
			}
		}

		$plugins_result = array();
		foreach ( $plugins_to_check as $plugin ) {
			// If plugin already has status (from map_sitemaps), use it.
			if ( isset( $plugin['status'] ) ) {
				$plugins_result[] = $plugin;
				continue;
			}

			$is_installed = false;
			$is_active    = false;
			$actual_slug  = $plugin['plugin_slug'];

			// Check by exact slug first.
			if ( isset( $all_plugins[ $plugin['plugin_slug'] ] ) ) {
				$is_installed = true;
				$is_active    = is_plugin_active( $plugin['plugin_slug'] );
			} else {
				// Check by folder name in case main file is different.
				$folder_name = dirname( $plugin['plugin_slug'] ) . '/';
				foreach ( $all_plugins as $key => $data ) {
					if ( strpos( $key, $folder_name ) === 0 ) {
						$is_installed = true;
						$actual_slug  = $key;
						$is_active    = is_plugin_active( $key );
						break;
					}
				}
			}

			$status = $is_active ? 'active' : ( $is_installed ? 'inactive' : 'not_installed' );

			$plugins_result[] = array(
				'name'          => $plugin['name'],
				'label'         => $plugin['label'],
				'plugin_slug'   => $actual_slug,
				'original_slug' => $plugin['original_slug'],
				'icon'          => $plugin['icon'],
				'status'        => $status,
			);
		}

		return new WP_REST_Response(
			array(
				'success' => true,
				'theme'   => $theme_result,
				'plugins' => $plugins_result,
			)
		);
	}

	/**
	 * Get Nexter theme installation status.
	 *
	 * @return array Theme status with name, label, slug, and status.
	 */
	protected function get_nexter_theme_status() {
		$theme_slug = 'nexter';
		$theme      = wp_get_theme( $theme_slug );
		$current    = wp_get_theme();

		$is_installed = $theme->exists();
		$is_active    = ( $current->get_stylesheet() === $theme_slug );
		$status       = $is_active ? 'active' : ( $is_installed ? 'inactive' : 'not_installed' );

		return array(
			'name'          => 'nexter',
			'label'         => 'Nexter',
			'slug'          => $theme_slug,
			'original_slug' => 'nexter',
			'icon'          => 'nexter',
			'status'        => $status,
		);
	}

	/**
	 * REST callback: install and activate a single plugin.
	 *
	 * Body: { original_slug: string, plugin_slug: string }
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_install_plugin( $request ) {
		$params        = $request->get_json_params();
		$original_slug = isset( $params['original_slug'] ) ? sanitize_key( $params['original_slug'] ) : '';
		$plugin_slug   = isset( $params['plugin_slug'] ) ? sanitize_text_field( $params['plugin_slug'] ) : '';

		if ( ! $original_slug || ! $plugin_slug ) {
			return new WP_Error(
				'INSTALL_PLUGIN_MISSING_PARAMS',
				__( 'original_slug and plugin_slug are required.', 'uichemy' ),
				array( 'status' => 400 )
			);
		}

		$success = $this->ensure_plugin_active_generic( $plugin_slug, $original_slug );

		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		$all_plugins = get_plugins();
		$resolved    = $this->resolve_plugin_file_from_slug( $plugin_slug, $all_plugins );
		$check_slug  = $resolved ? $resolved : $plugin_slug;
		$is_active   = is_plugin_active( $check_slug );
		$status      = $is_active ? 'active' : ( $success ? 'active' : 'failed' );

		if ( ! $is_active && ! $success ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'INSTALL_PLUGIN_FAILED', array( 'message' => 'Plugin installation failed: ' . $plugin_slug, 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'plugin_slug' => $plugin_slug ) ) );
		}

		return new WP_REST_Response(
			array(
				'success' => $is_active || $success,
				'status'  => $status,
				'message' => $is_active ? __( 'Plugin is active.', 'uichemy' ) : __( 'Plugin installation failed.', 'uichemy' ),
			)
		);
	}

	/**
	 * REST callback: install and activate Nexter theme.
	 *
	 * Body: { theme_slug: string } (optional, defaults to 'nexter')
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_install_theme( $request ) {
		$params     = $request->get_json_params();
		$theme_slug = isset( $params['theme_slug'] ) ? sanitize_key( $params['theme_slug'] ) : 'nexter';

		$success = $this->ensure_nexter_theme( $theme_slug );

		$theme     = wp_get_theme( $theme_slug );
		$current   = wp_get_theme();
		$is_active = ( $current->get_stylesheet() === $theme_slug );
		$status    = $is_active ? 'active' : ( $theme->exists() ? 'inactive' : 'failed' );

		if ( ! $is_active && ! $success ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'INSTALL_THEME_FAILED', array( 'message' => 'Theme installation failed: ' . $theme_slug, 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'theme_slug' => $theme_slug ) ) );
		}

		return new WP_REST_Response(
			array(
				'success' => $is_active || $success,
				'status'  => $status,
				'message' => $is_active ? __( 'Theme is active.', 'uichemy' ) : __( 'Theme installation failed.', 'uichemy' ),
			)
		);
	}

	/**
	 * REST callback: download, install, and activate pro plugin zips from requiredPlugins URLs.
	 * The download is authenticated with the user's OAuth Bearer token alone.
	 * Skips the remote download when the plugin is already installed (URL/sitemap heuristics) and active, or when installed but only activation is needed.
	 *
	 * Body: { requiredPlugins: string[] } (legacy) or { requiredPlugins: { free: string[], pro: string[] } } to map pro zips to known slugs via sitemap free names.
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response
	 */
	public function rest_download_pro_plugins( $request ) {
		$params           = $request->get_json_params();
		$required_plugins = isset( $params['requiredPlugins'] ) ? $params['requiredPlugins'] : array();
		$sitemap_free     = array();
		$http_filter      = function ( $item ) {
			return is_string( $item ) && ( strpos( $item, 'http://' ) === 0 || strpos( $item, 'https://' ) === 0 );
		};
		if ( is_array( $required_plugins ) && isset( $required_plugins['pro'] ) && is_array( $required_plugins['pro'] ) ) {
			$plugin_urls  = array_filter( $required_plugins['pro'], $http_filter );
			$plugin_urls  = array_values( array_unique( $plugin_urls ) );
			$sitemap_free = isset( $required_plugins['free'] ) && is_array( $required_plugins['free'] ) ? $required_plugins['free'] : array();
		} else {
			$required_plugins = is_array( $required_plugins ) ? $required_plugins : array();
			$plugin_urls      = array_filter( $required_plugins, $http_filter );
			$plugin_urls      = array_values( array_unique( $plugin_urls ) );
		}

		// The Plus Addons for Elementor Pro is no longer installed by an import; drop
		// its zip URL even if a project still lists it, so nothing is downloaded.
		$plugin_urls = array_values(
			array_filter(
				$plugin_urls,
				function ( $url ) {
					return ! $this->is_tpae_elementor_pro_zip_url( $url );
				}
			)
		);

		$results = array();

		if ( empty( $plugin_urls ) ) {
			return new WP_REST_Response(
				array(
					'success'    => true,
					'downloaded' => array(),
					'message'    => __( 'No pro plugin URLs to download.', 'uichemy' ),
				)
			);
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		$upload_dir = wp_upload_dir();
		$base_dir   = $upload_dir['basedir'] . '/uich-webpage-downloaded-plugins';
		if ( ! wp_mkdir_p( $base_dir ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'INSTALL_PRO_PLUGIN_NO_DIRECTORY', array( 'message' => 'Could not create pro plugin download directory.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'dir' => $base_dir ) ) );
			return new WP_REST_Response(
				array(
					'success'    => false,
					'downloaded' => array(),
					'message'    => __( 'Could not create download directory.', 'uichemy' ),
				),
				500
			);
		}

		global $wp_filesystem;
		if ( ! WP_Filesystem( false, $base_dir, true ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'INSTALL_PRO_PLUGIN_FILESYSTEM_ERROR', array( 'message' => 'WP_Filesystem initialisation failed for pro plugin download.', 'source' => 'uichemy-webpage', 'level' => 'error' ) );
			return new WP_REST_Response(
				array(
					'success'    => false,
					'downloaded' => array(),
					'message'    => __( 'Could not initialize filesystem.', 'uichemy' ),
				),
				500
			);
		}

		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		$all_plugins = get_plugins();

		foreach ( $plugin_urls as $url ) {
			$url_safe = esc_url_raw( $url );
			if ( $url_safe !== $url ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_INVALID_URL', array( 'message' => 'Invalid pro plugin URL.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					'error'   => __( 'Invalid URL.', 'uichemy' ),
				);
				continue;
			}

			// esc_url_raw() above only checks well-formedness, not the host — this request
			// attaches the UiChemy OAuth Bearer token below, so an attacker-influenced or
			// malformed requiredPlugins.pro URL pointing outside the UiChemy API host would
			// otherwise leak that token to an arbitrary host (same class of gap already
			// closed for downloadUrls in fetch_raw_body_from_url(); see is_allowed_fetch_url()).
			if ( ! $this->is_allowed_fetch_url( $url ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_DISALLOWED_HOST', array( 'message' => 'Refusing to fetch pro plugin from a non-UiChemy host.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					'error'   => __( 'This plugin download URL is not from a trusted host.', 'uichemy' ),
				);
				continue;
			}

			$existing = $this->find_installed_plugin_file_for_pro_zip_url( $url, $all_plugins, $sitemap_free );
			if ( $existing && is_plugin_active( $existing ) ) {
				$results[] = array(
					'url'         => $url,
					'success'     => true,
					'plugin_slug' => $existing,
					'skipped'     => 'already_active',
				);
				continue;
			}
			if ( $existing && is_plugin_inactive( $existing ) ) {
				$activate = $this->uich_webpage_activate_plugin( $existing );
				if ( is_wp_error( $activate ) ) {
					$api = new Uich_Webpage_Api();
					$api->report_error( 'IMPORT_ELEMENTOR_PRO_ACTIVATE_WP_ERROR', array( 'message' => $activate->get_error_message(), 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'plugin_file' => $existing, 'url' => $url ) ) );
					$results[] = array(
						'url'     => $url,
						'success' => false,
						'error'   => $activate->get_error_message(),
					);
					continue;
				}
				$results[] = array(
					'url'         => $url,
					'success'     => true,
					'plugin_slug' => $existing,
					'skipped'     => 'activated_existing',
				);
				continue;
			}

			$filename = basename( wp_parse_url( $url, PHP_URL_PATH ) ) ?: 'plugin-' . md5( $url ) . '.zip';
			if ( strtolower( substr( $filename, -4 ) ) !== '.zip' ) {
				$filename .= '.zip';
			}
			$filepath     = $base_dir . '/' . sanitize_file_name( $filename );
			$access_token = $this->auth->get_access_token();
			$request_args = array(
				'timeout'   => 120,
				'sslverify' => uich_webpage_http_sslverify(),
				'headers'   => array(),
			);
			if ( $access_token ) {
				$request_args['headers']['Authorization'] = 'Bearer ' . $access_token;
			}
			$response = wp_remote_get( $url, $request_args );
			if ( is_wp_error( $response ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_NETWORK_ERROR', array( 'message' => $response->get_error_message(), 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					'error'   => $response->get_error_message(),
				);
				continue;
			}
			$code         = wp_remote_retrieve_response_code( $response );
			$content_type = wp_remote_retrieve_header( $response, 'content-type' );
			$body         = wp_remote_retrieve_body( $response );
			if ( 200 !== $code ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_HTTP_ERROR', array( 'message' => sprintf( 'HTTP %d from pro plugin URL.', $code ), 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url, 'code' => $code ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					// translators: %d is the HTTP status code returned by the server.
					'error'   => sprintf( __( 'HTTP %d', 'uichemy' ), $code ),
				);
				continue;
			}
			if ( empty( $body ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_EMPTY_RESPONSE', array( 'message' => 'Empty response from pro plugin URL.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					'error'   => __( 'Empty response.', 'uichemy' ),
				);
				continue;
			}
			// zip magic bytes are PK (0x504B) — if absent the server returned an error/HTML page.
			if ( substr( $body, 0, 2 ) !== 'PK' ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_INVALID_ZIP', array( 'message' => 'Downloaded file is not a zip.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url, 'content_type' => $content_type ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					// translators: %s is the content-type header returned by the server.
					'error'   => sprintf( __( 'Response is not a zip (content-type: %s). Check URL/auth.', 'uichemy' ), $content_type ),
				);
				continue;
			}
			if ( ! $wp_filesystem->put_contents( $filepath, $body ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_SAVE_FAILED', array( 'message' => 'Could not save pro plugin zip to disk.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					'error'   => __( 'Could not save file.', 'uichemy' ),
				);
				continue;
			}

			$install_result = $this->install_and_activate_plugin_from_zip( $filepath );
			if ( is_wp_error( $install_result ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PRO_PLUGIN_WP_ERROR', array( 'message' => $install_result->get_error_message(), 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'url' => $url ) ) );
				$results[] = array(
					'url'     => $url,
					'success' => false,
					'error'   => $install_result->get_error_message(),
				);
				continue;
			}
			wp_delete_file( $filepath );
			$all_plugins = get_plugins();
			$results[] = array(
				'url'         => $url,
				'success'     => true,
				'plugin_slug' => $install_result,
			);
		}

		$this->remove_uich_webpage_plugins_dir( $base_dir );

		$installed = array_filter(
			$results,
			function ( $r ) {
				return ! empty( $r['success'] ) && empty( $r['skipped'] );
			}
		);
		$skipped = array_filter(
			$results,
			function ( $r ) {
				return ! empty( $r['skipped'] );
			}
		);
		return new WP_REST_Response(
			array(
				'success'    => true,
				'downloaded' => $results,
				'message'    => sprintf(
					/* translators: 1: installed count, 2: skipped count, 3: total */
					__( '%1$d of %3$d pro plugin(s) installed and activated, %2$d skipped (already active).', 'uichemy' ),
					count( $installed ),
					count( $skipped ),
					count( $plugin_urls )
				),
			)
		);
	}

	/**
	 * Install and activate a plugin from a local zip file.
	 *
	 * @param string $zip_path Full path to plugin zip file.
	 * @return string|WP_Error Plugin slug (e.g. 'plugin-folder/plugin.php') on success, WP_Error on failure.
	 */
	protected function install_and_activate_plugin_from_zip( $zip_path ) {
		if ( ! file_exists( $zip_path ) ) {
			return new WP_Error( 'INSTALL_PLUGIN_ZIP_MISSING', __( 'Zip file not found.', 'uichemy' ) );
		}
		if ( ! current_user_can( 'install_plugins' ) ) {
			return new WP_Error( 'INSTALL_PLUGIN_FORBIDDEN', __( 'Insufficient permissions.', 'uichemy' ) );
		}

		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader-skin.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

		$plugins_before = array_keys( get_plugins() );
		$skin           = new WP_Ajax_Upgrader_Skin();
		$upgrader       = new Plugin_Upgrader( $skin );
		// overwrite_package=true: allows installing over an existing plugin folder.
		// This is required when the free plugin is installed (same folder as pro).
		// Without it, Plugin_Upgrader returns WP_Error('folder_exists') and the pro zip is never applied.
		$result = $upgrader->install( $zip_path, array( 'overwrite_package' => true ) );


		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( is_wp_error( $skin->result ) ) {
			return $skin->result;
		}
		if ( $skin->get_errors()->has_errors() ) {
			$errors = $skin->get_errors();
			return new WP_Error( 'INSTALL_PLUGIN_WP_ERROR', $errors->get_error_message() ?: __( 'Installation failed.', 'uichemy' ) );
		}
		if ( true !== $result && null === $result ) {
			return new WP_Error( 'INSTALL_PLUGIN_GENERAL_FAILED', __( 'Installation failed.', 'uichemy' ) );
		}

		$plugins_after = array_keys( get_plugins() );
		$new_plugins   = array_diff( $plugins_after, $plugins_before );
		$plugin_to_use = reset( $new_plugins );

		if ( empty( $plugin_to_use ) ) {
			// When overwriting an existing plugin (e.g. free→pro same folder), $new_plugins is empty.
			// Fall back to detecting the slug from the zip root folder.
			$plugin_to_use = $this->guess_plugin_slug_from_zip( $zip_path );
		}
		if ( empty( $plugin_to_use ) ) {
			return new WP_Error( 'INSTALL_PLUGIN_NOT_DETECTED', __( 'Could not detect installed plugin.', 'uichemy' ) );
		}

		$activate_result = $this->uich_webpage_activate_plugin( $plugin_to_use );
		if ( is_wp_error( $activate_result ) ) {
			return $activate_result;
		}
		if ( ! $activate_result && ! is_plugin_active( $plugin_to_use ) ) {
			return new WP_Error( 'INSTALL_PLUGIN_ACTIVATE_FAILED', __( 'Plugin installed but could not be activated.', 'uichemy' ) );
		}

		return $plugin_to_use;
	}

	/**
	 * Remove uich-webpage-downloaded-plugins directory and any remaining files.
	 *
	 * @param string $dir Full path to the directory.
	 */
	protected function remove_uich_webpage_plugins_dir( $dir ) {
		if ( ! is_dir( $dir ) ) {
			return;
		}
		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		global $wp_filesystem;
		if ( ! WP_Filesystem( false, dirname( $dir ), true ) ) {
			return;
		}
		$wp_filesystem->delete( $dir, true );
	}

	/**
	 * Guess plugin slug from zip structure (root folder name).
	 * Used when install overwrites existing plugin (no "new" plugin in diff).
	 *
	 * @param string $zip_path Full path to plugin zip.
	 * @return string|null Plugin slug or null if not found.
	 */
	protected function guess_plugin_slug_from_zip( $zip_path ) {
		if ( ! class_exists( 'ZipArchive' ) ) {
			return null;
		}
		$zip = new ZipArchive();
		if ( true !== $zip->open( $zip_path, ZipArchive::RDONLY ) ) {
			return null;
		}
		$first = $zip->getNameIndex( 0 );
		$zip->close();
		if ( empty( $first ) ) {
			return null;
		}
		$folder = trim( $first, '/' );
		if ( strpos( $folder, '/' ) !== false ) {
			$folder = strtok( $folder, '/' );
		}
		$folder_slash = $folder . '/';
		foreach ( array_keys( get_plugins() ) as $plugin_file ) {
			if ( strpos( $plugin_file, $folder_slash ) === 0 ) {
				return $plugin_file;
			}
		}
		return null;
	}

	/**
	 * Resolve a plugin file path in get_plugins() from a known slug (or same folder, different main file).
	 *
	 * @param string $plugin_slug Expected slug e.g. folder/plugin.php.
	 * @param array  $all_plugins get_plugins() result.
	 * @return string|null Plugin file key or null.
	 */
	protected function resolve_plugin_file_from_slug( $plugin_slug, array $all_plugins ) {
		if ( isset( $all_plugins[ $plugin_slug ] ) ) {
			return $plugin_slug;
		}
		$folder = dirname( $plugin_slug ) . '/';
		foreach ( array_keys( $all_plugins ) as $key ) {
			if ( strpos( $key, $folder ) === 0 ) {
				return $key;
			}
		}
		return null;
	}

	/**
	 * Whether a pro zip download URL is likely the package for a sitemap-mapped plugin.
	 *
	 * @param string $url  Pro zip URL.
	 * @param array  $item Item from map_sitemaps_required_plugins_to_slugs().
	 * @return bool
	 */
	protected function pro_zip_url_likely_for_mapped_plugin( $url, array $item ) {
		$u    = strtolower( $url );
		$name = isset( $item['name'] ) ? $item['name'] : '';
		if ( 'theplus-elementor' === $name ) {
			return ( strpos( $u, 'block' ) === false
				&& ( strpos( $u, 'plus' ) !== false || strpos( $u, 'theplus' ) !== false
					|| strpos( $u, 'plus-addons' ) !== false || false !== preg_match( '/the[\-_]?plus/i', $url ) ) );
		}
		if ( 'theplus-block-editor' === $name ) {
			return ( strpos( $u, 'block' ) !== false
				&& ( strpos( $u, 'plus' ) !== false || strpos( $u, 'theplus' ) !== false || strpos( $u, 'plus-addons' ) !== false ) );
		}
		return false;
	}

	/**
	 * Whether a pro zip URL is The Plus Addons for Elementor Pro.
	 *
	 * UiChemy no longer installs that addon during an import, so such URLs are
	 * skipped in rest_download_pro_plugins(). The Block Editor pro package
	 * (…for-block-editor-pro) contains "block" and is deliberately excluded here.
	 *
	 * @param string $url Pro zip URL.
	 * @return bool
	 */
	protected function is_tpae_elementor_pro_zip_url( $url ) {
		$u = strtolower( (string) $url );
		if ( strpos( $u, 'block' ) !== false ) {
			return false;
		}
		if ( strpos( $u, 'theplus_elementor_addon' ) !== false ) {
			return true;
		}
		return ( strpos( $u, 'elementor' ) !== false
			&& ( strpos( $u, 'theplus' ) !== false || strpos( $u, 'the-plus' ) !== false || strpos( $u, 'plus-addons' ) !== false ) );
	}

	/**
	 * Map known pro zip URL patterns to an installed plugin file (The Plus, etc.).
	 *
	 * @param string $url         Pro zip URL.
	 * @param array  $all_plugins get_plugins() result.
	 * @return string|null Plugin file key.
	 */
	protected function match_known_pro_zip_url_to_plugin_file( $url, array $all_plugins ) {
		$u = strtolower( $url );
		// theplus_elementor_addon-*.zip → theplus_elementor_addon/theplus_elementor_addon.php
		if ( strpos( $u, 'theplus_elementor_addon' ) !== false
			|| ( strpos( $u, 'elementor' ) !== false && strpos( $u, 'block' ) === false
				&& ( strpos( $u, 'theplus' ) !== false || strpos( $u, 'the-plus' ) !== false ) ) ) {
			$cand = 'theplus_elementor_addon/theplus_elementor_addon.php';
			$file = $this->resolve_plugin_file_from_slug( $cand, $all_plugins );
			if ( $file ) {
				return $file;
			}
		}
		// the-plus-addons-for-block-editor-pro-*.zip → the-plus-addons-for-block-editor-pro/the-plus-addons-for-block-editor-pro.php
		if ( strpos( $u, 'block' ) !== false
			&& ( strpos( $u, 'the-plus' ) !== false || strpos( $u, 'theplus' ) !== false || strpos( $u, 'plus-addons' ) !== false ) ) {
			$cand = 'the-plus-addons-for-block-editor-pro/the-plus-addons-for-block-editor-pro.php';
			$file = $this->resolve_plugin_file_from_slug( $cand, $all_plugins );
			if ( $file ) {
				return $file;
			}
		}
		// nexter-pro-extensions-*.zip → nexter-pro-extensions/nexter-pro-extensions.php
		if ( strpos( $u, 'nexter' ) !== false && strpos( $u, 'extension' ) !== false ) {
			$cand = 'nexter-pro-extensions/nexter-pro-extensions.php';
			$file = $this->resolve_plugin_file_from_slug( $cand, $all_plugins );
			if ( $file ) {
				return $file;
			}
		}
		// uichemy-pro-*.zip or uichemy-*.zip → uichemy-pro or uichemy
		if ( strpos( $u, 'uichemy' ) !== false ) {
			$cand = 'uichemy-pro/uichemy-pro.php';
			$file = $this->resolve_plugin_file_from_slug( $cand, $all_plugins );
			if ( $file ) {
				return $file;
			}
			$cand = 'uichemy/uichemy.php';
			$file = $this->resolve_plugin_file_from_slug( $cand, $all_plugins );
			if ( $file ) {
				return $file;
			}
		}
		return null;
	}

	/**
	 * Match pro zip path basename to an installed plugin directory (hyphen/underscore/pro suffix variants).
	 *
	 * @param string $url         Pro zip URL.
	 * @param array  $all_plugins get_plugins() result.
	 * @return string|null Plugin file key.
	 */
	protected function match_plugin_file_by_zip_basename( $url, array $all_plugins ) {
		$path = wp_parse_url( $url, PHP_URL_PATH );
		if ( empty( $path ) ) {
			return null;
		}
		$filename = basename( $path );
		$filename = preg_replace( '/\?.*$/', '', $filename );
		$stem       = preg_replace( '/\.zip$/i', '', $filename );
		if ( '' === $stem ) {
			return null;
		}
		$strip_suffix = function ( $s ) {
			$s = strtolower( $s );
			$s = preg_replace( '/[\-_]?(pro|premium|licensed)$/i', '', $s );
			return $s;
		};
		$stem_l      = $strip_suffix( $stem );
		$stem_fold   = str_replace( array( '-', '_' ), '', $stem_l );
		$min_foldlen = 6;

		foreach ( array_keys( $all_plugins ) as $plugin_file ) {
			if ( false === strpos( $plugin_file, '/' ) ) {
				continue;
			}
			$folder   = strtolower( dirname( $plugin_file ) );
			$folder_s = $strip_suffix( $folder );
			if ( strtolower( $stem ) === $folder || $folder_s === $stem_l ) {
				return $plugin_file;
			}
			$folder_fold = str_replace( array( '-', '_' ), '', $folder_s );
			if ( strlen( $folder_fold ) >= $min_foldlen && strlen( $stem_fold ) >= $min_foldlen && $folder_fold === $stem_fold ) {
				return $plugin_file;
			}
		}
		return null;
	}

	/**
	 * Find an already-installed plugin for a pro zip URL (skip remote download if active or only activation needed).
	 *
	 * @param string $url                 Pro zip URL.
	 * @param array  $all_plugins         get_plugins() result.
	 * @param array  $sitemap_free_names  Optional project.requiredPlugins.free labels for slug mapping.
	 * @return string|null Plugin file key.
	 */
	protected function find_installed_plugin_file_for_pro_zip_url( $url, array $all_plugins, array $sitemap_free_names = array() ) {
		// Use explicit URL→pro-slug patterns first. Free and pro plugins have different
		// folder names, so the sitemap-free mapping (which resolves free slugs) must not
		// be used here — it would match the free plugin and incorrectly report it as active.
		$known = $this->match_known_pro_zip_url_to_plugin_file( $url, $all_plugins );
		if ( $known ) {
			return $known;
		}
		return $this->match_plugin_file_by_zip_basename( $url, $all_plugins );
	}

	/**
	 * Ensure Nexter theme is installed and activated.
	 * Uses same approach as WDesignKit: download from WordPress.org API and extract to themes folder.
	 *
	 * @param string $theme_slug Theme slug (default 'nexter').
	 * @return bool True if theme is active (or was installed/activated), false otherwise.
	 */
	protected function ensure_nexter_theme( $theme_slug = 'nexter' ) {
		$theme   = wp_get_theme( $theme_slug );
		$current = wp_get_theme();

		// Already active.
		if ( $current->get_stylesheet() === $theme_slug ) {
			return true;
		}

		// Installed but not active - activate it.
		if ( $theme->exists() ) {
			switch_theme( $theme_slug );
			return ( wp_get_theme()->get_stylesheet() === $theme_slug );
		}

		// Not installed - install from WordPress.org using WDesignKit approach.
		if ( ! current_user_can( 'install_themes' ) ) {
			return false;
		}

		if ( ! function_exists( 'themes_api' ) ) {
			require_once ABSPATH . 'wp-admin/includes/theme.php';
		}

		$theme_info = themes_api(
			'theme_information',
			array(
				'slug'   => $theme_slug,
				'fields' => array(
					'description'    => false,
					'sections'       => false,
					'rating'         => true,
					'downloaded'     => true,
					'download_link'  => true,
					'last_updated'   => true,
					'homepage'       => true,
					'tags'           => true,
					'template'       => true,
					'screenshot_url' => true,
				),
			)
		);

		if ( is_wp_error( $theme_info ) || empty( $theme_info->download_link ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'INSTALL_THEME_API_ERROR', array( 'message' => 'themes_api() failed or returned no download_link.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'theme_slug' => $theme_slug ) ) );
			return false;
		}

		$theme_zip_url = $theme_info->download_link;

		// Download and install theme (same as WDesignKit).
		global $wp_filesystem;

		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once wp_normalize_path( ABSPATH . '/wp-admin/includes/file.php' );
		}

		WP_Filesystem();

		$theme_response = wp_remote_get( $theme_zip_url, array( 'timeout' => 60 ) );
		if ( is_wp_error( $theme_response ) || empty( $theme_response['body'] ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'INSTALL_THEME_FETCH_ERROR', array( 'message' => 'Failed to download theme zip.', 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'theme_slug' => $theme_slug, 'zip_url' => $theme_zip_url ) ) );
			return false;
		}

		$zip_path = WP_CONTENT_DIR . '/themes/' . $theme_slug . '.zip';
		$wp_filesystem->put_contents( $zip_path, $theme_response['body'] );

		$zip = new ZipArchive();
		if ( $zip->open( $zip_path ) === true ) {
			$zip->extractTo( WP_CONTENT_DIR . '/themes/' );
			$zip->close();
		} else {
			$wp_filesystem->delete( $zip_path );
			return false;
		}

		$wp_filesystem->delete( $zip_path );

		// Activate the theme.
		switch_theme( $theme_slug );
		return ( wp_get_theme()->get_stylesheet() === $theme_slug );
	}

	/**
	 * REST callback: install all requirements (theme + plugins) at once.
	 *
	 * Installs and activates:
	 * 1. Theme: Nexter
	 * 2. Plugin: UiChemy (Elementor builder only — it owns the Theme Builder)
	 *
	 * Nexter Extension and The Plus Addons are no longer installed: every Theme
	 * Builder template now goes to the UiChemy Theme Builder.
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response
	 */
	public function rest_install_requirements( $request ) {
		$builder = is_object( $request ) && method_exists( $request, 'get_param' ) ? $request->get_param( 'builder' ) : '';
		$builder = is_string( $builder ) && '' !== $builder ? sanitize_key( $builder ) : 'elementor';
		$results = $this->ensure_all_nexter_requirements( $builder );

		// Check overall success.
		$all_success = $results['theme']['success'];
		foreach ( $results['plugins'] as $plugin ) {
			if ( ! $plugin['success'] ) {
				$all_success = false;
			}
		}

		return new WP_REST_Response(
			array(
				'success' => $all_success,
				'theme'   => $results['theme'],
				'plugins' => $results['plugins'],
				'message' => $all_success
					? __( 'All requirements installed and activated.', 'uichemy' )
					: __( 'Some requirements failed to install.', 'uichemy' ),
			)
		);
	}

	/**
	 * Check REST API permission.
	 *
	 * @return bool
	 */
	public function check_permission() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * REST callback: import from downloadUrls.
	 *
	 * Body: { downloadUrls: string[], projectId?: string, meta?: object, builder?: 'elementor'|'gutenberg'|'auto' }
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_import_replacement( $request ) {
		$params = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		if ( empty( $params['downloadUrls'] ) || ! is_array( $params['downloadUrls'] ) ) {
			return new WP_Error(
				'IMPORT_FETCH_MISSING_PARAMS',
				__( 'downloadUrls array is required.', 'uichemy' ),
				array( 'status' => 400 )
			);
		}

		$raw_urls      = $this->flatten_download_urls( $params['downloadUrls'] );
		$download_urls = array_values( array_filter( array_map( array( $this, 'normalize_download_url' ), $raw_urls ) ) );
		$project_id    = isset( $params['projectId'] ) ? sanitize_text_field( $params['projectId'] ) : '';
		$meta          = isset( $params['meta'] ) && is_array( $params['meta'] ) ? $params['meta'] : array();
		$fetch_builder = isset( $params['builder'] ) ? sanitize_text_field( $params['builder'] ) : 'auto';

		$result = $this->run_import( $download_urls, $project_id, $meta, $fetch_builder );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return new WP_REST_Response( $result );
	}

	/**
	 * REST callback: fetch JSON from downloadUrls, store, apply globals. Does NOT create pages.
	 *
	 * Body: { downloadUrls: string[], projectId?: string, meta?: object, builder?: 'elementor'|'gutenberg'|'auto' }
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_fetch_replacement_json( $request ) {
		$params = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		if ( empty( $params['downloadUrls'] ) || ! is_array( $params['downloadUrls'] ) ) {
			return new WP_Error(
				'IMPORT_FETCH_MISSING_PARAMS',
				__( 'downloadUrls array is required.', 'uichemy' ),
				array( 'status' => 400 )
			);
		}

		$raw_urls      = $this->flatten_download_urls( $params['downloadUrls'] );
		$download_urls = array_values( array_filter( array_map( array( $this, 'normalize_download_url' ), $raw_urls ) ) );
		$project_id    = isset( $params['projectId'] ) ? sanitize_text_field( $params['projectId'] ) : '';
		$meta          = isset( $params['meta'] ) && is_array( $params['meta'] ) ? $params['meta'] : array();
		$fetch_builder = isset( $params['builder'] ) ? sanitize_text_field( $params['builder'] ) : 'auto';

		/*
		 * Run as an async job rather than inline. Downloading every project file
		 * sequentially kept ONE HTTP request open for the whole run, and anything
		 * in the chain with less patience than that killed it: PHP-FPM
		 * request_terminate_timeout, nginx fastcgi_read_timeout, Cloudflare's 100s
		 * (524), an LB idle timeout. raise_execution_limit() only moves PHP's own
		 * max_execution_time — none of the others are PHP's to move, which is why
		 * this kept surfacing as WordPress's critical-error page inside the import
		 * UI. Returning 202 immediately and doing the work after the response is
		 * flushed takes every one of those limits out of play.
		 *
		 * Same pattern as rest_import_pages(); poll GET /import-job/{job_id}.
		 */
		$existing = $this->find_live_job_of_type( 'fetch' );
		if ( '' !== $existing ) {
			// A retry arriving while the first run is still going. Hand back the
			// job already in flight: a second one would race the first writing
			// OPTION_REPLACEMENT_DATA.
			return new WP_REST_Response(
				array(
					'jobId'  => $existing,
					'status' => 'running',
				),
				202
			);
		}

		$job_id = $this->create_import_job(
			'fetch',
			array(
				'download_urls' => $download_urls,
				'project_id'    => $project_id,
				'meta'          => $meta,
				'builder'       => $fetch_builder,
			)
		);

		return new WP_REST_Response(
			array(
				'jobId'  => $job_id,
				'status' => 'pending',
			),
			202
		);
	}

	/**
	 * REST callback: create pages from stored JSON (after fetch-replacement-json).
	 *
	 * Runs as an async job (like project-replacement) instead of inline: a full-project
	 * import can take several minutes, which reliably 504s on shared-hosting gateway/PHP
	 * time limits and leaves a partially-imported site. Returns 202 + jobId immediately;
	 * poll GET /import-job/{job_id} for the created_pages result.
	 *
	 * Body: { projectId?: string, meta?: object }
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_import_pages( $request ) {
		$params = $request->get_json_params();
		if ( ! is_array( $params ) ) {
			$params = array();
		}
		$project_id = isset( $params['projectId'] ) ? sanitize_text_field( $params['projectId'] ) : '';
		$meta       = isset( $params['meta'] ) && is_array( $params['meta'] ) ? $params['meta'] : array();

		$files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		if ( ! is_array( $files ) || empty( $files ) ) {
			return new WP_Error(
				'IMPORT_NO_STORED_DATA',
				__( 'No replacement data found. Run fetch-replacement-json first.', 'uichemy' ),
				array( 'status' => 400 )
			);
		}

		$job_id = $this->create_import_job(
			'pages',
			array(
				'project_id' => $project_id,
				'meta'       => $meta,
			)
		);

		return new WP_REST_Response(
			array(
				'jobId'  => $job_id,
				'status' => 'pending',
			),
			202
		);
	}

	/**
	 * Create an async import job of the given type; work runs on shutdown after the 202
	 * body is sent (loopback self-HTTP is unreliable on many hosts, mirrors
	 * Uich_Webpage_Api::create_replacement_job()). Shared by every import job kind
	 * ('pages' — full-project, 'single_page' — one page/template) so each gets the same
	 * 202-now/work-after-response protection against gateway timeouts, not just PHP's own
	 * max_execution_time.
	 *
	 * @param string $type   Job kind: 'pages' or 'single_page'.
	 * @param array  $params Params run_import_job() will dispatch on $type to interpret.
	 * @return string Job id.
	 */
	/**
	 * Record how far the running job has got.
	 *
	 * Also refreshes `updated`, which is what lets a client tell "still working"
	 * apart from "the worker died": a job killed by a PHP fatal leaves its
	 * transient frozen on the last value it wrote, and without a timestamp the
	 * poller cannot distinguish that from slow progress and would wait out its
	 * full timeout on a job that is never coming back.
	 *
	 * No-op outside a job, so the same worker code runs unchanged when called
	 * inline.
	 *
	 * @param array $progress { phase: string, current?: int, total?: int, label?: string }.
	 * @return void
	 */
	protected function update_job_progress( array $progress ) {
		if ( '' === $this->active_job_key ) {
			return;
		}
		$job = get_transient( $this->active_job_key );
		if ( ! is_array( $job ) ) {
			return;
		}
		$job['status']   = 'running';
		$job['progress'] = $progress;
		$job['updated']  = time();
		set_transient( $this->active_job_key, $job, HOUR_IN_SECONDS );
	}

	/**
	 * Job id of a job of this type that is still alive, or '' if there is none.
	 *
	 * Guards the retry path. Retrying the content step re-POSTs, and a second
	 * fetch job would run concurrently with the first — both writing
	 * OPTION_REPLACEMENT_DATA, with the loser's files silently lost. A job that
	 * has not reported progress within the stall window is treated as dead so a
	 * genuinely crashed run can still be retried.
	 *
	 * @param string $type Job kind.
	 * @return string Job id, or ''.
	 */
	protected function find_live_job_of_type( $type ) {
		$live = get_option( self::OPTION_LIVE_JOBS, array() );
		if ( ! is_array( $live ) || empty( $live[ $type ] ) ) {
			return '';
		}
		$job_id = (string) $live[ $type ];
		$job    = get_transient( self::IMPORT_JOB_PREFIX . $job_id );
		if ( ! is_array( $job ) ) {
			return '';
		}
		if ( ! in_array( $job['status'], array( 'pending', 'running' ), true ) ) {
			return '';
		}
		$last = isset( $job['updated'] ) ? (int) $job['updated'] : (int) $job['created'];
		if ( ( time() - $last ) > self::JOB_STALL_SECONDS ) {
			return '';
		}
		return $job_id;
	}

	protected function create_import_job( $type, array $params ) {
		$job_id = wp_generate_password( 32, false );
		$secret = wp_generate_password( 64, false );
		$job    = array(
			'status'     => 'pending',
			'secret'     => $secret,
			'type'       => $type,
			'params'     => $params,
			'wp_user_id' => get_current_user_id(),
			'created'    => time(),
			'result'     => null,
			'error'      => null,
		);
		set_transient( self::IMPORT_JOB_PREFIX . $job_id, $job, HOUR_IN_SECONDS );

		$live = get_option( self::OPTION_LIVE_JOBS, array() );
		$live = is_array( $live ) ? $live : array();
		$live[ $type ] = $job_id;
		update_option( self::OPTION_LIVE_JOBS, $live, false );

		$this->pending_import_jobs[] = array(
			'job_id' => $job_id,
			'secret' => $secret,
		);
		return $job_id;
	}

	/**
	 * Run queued import-pages jobs after output buffers flush (priority 999 runs after
	 * wp_ob_end_flush_all at 1). fastcgi_finish_request() lets the web server close the
	 * browser connection before the long-running import runs.
	 *
	 * @return void
	 */
	public function process_import_job_after_response() {
		if ( empty( $this->pending_import_jobs ) ) {
			return;
		}
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			fastcgi_finish_request();
		}
		$jobs                       = $this->pending_import_jobs;
		$this->pending_import_jobs = array();
		foreach ( $jobs as $job ) {
			$this->run_import_job( $job['job_id'], $job['secret'] );
		}
	}

	/**
	 * Execute a stored import job, dispatching on its type.
	 *
	 * @param string $job_id Job id.
	 * @param string $secret Must match transient (prevents unauthorized runs).
	 * @return void
	 */
	/**
	 * Give the current request a longer execution window.
	 *
	 * Import work is I/O bound on someone else's server: a single blog post
	 * downloads its featured and inline images and thumbnails each one
	 * synchronously, which routinely outlives PHP's default max_execution_time
	 * (30s on a stock MAMP/cPanel box). When it does, PHP kills the request
	 * mid-flight and the client receives an HTML error page rather than JSON —
	 * surfacing as "REST API error: 500 - the server returned an unexpected error
	 * page". Raising the window is the difference between a slow import and a
	 * failed one.
	 *
	 * Batching does not remove the need for this: the front end already requests
	 * ONE post per call, and one post alone can exceed 30s.
	 *
	 * @return void
	 */
	protected function raise_execution_limit() {
		if ( function_exists( 'set_time_limit' ) ) {
			// phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged -- Long-running import needs a raised execution window; guarded by function_exists.
			set_time_limit( self::IMPORT_JOB_TIME_LIMIT );
		}
	}

	protected function run_import_job( $job_id, $secret ) {
		$this->raise_execution_limit();
		if ( function_exists( 'ignore_user_abort' ) ) {
			ignore_user_abort( true );
		}

		$key = self::IMPORT_JOB_PREFIX . $job_id;
		$job = get_transient( $key );
		if ( ! is_array( $job ) ) {
			return;
		}
		if ( empty( $job['secret'] ) || ! hash_equals( (string) $job['secret'], $secret ) ) {
			return;
		}
		if ( isset( $job['status'] ) && 'pending' !== $job['status'] ) {
			return;
		}

		$job['status'] = 'running';
		set_transient( $key, $job, HOUR_IN_SECONDS );

		$type   = isset( $job['type'] ) ? $job['type'] : 'pages';
		$params = isset( $job['params'] ) && is_array( $job['params'] ) ? $job['params'] : array();

		// Scopes progress reporting to this job for the duration of the dispatch;
		// update_job_progress() is a no-op once it is cleared, so the same workers
		// stay callable inline.
		$this->active_job_key = $key;

		if ( 'single_page' === $type ) {
			$result = $this->run_import_single_page_job( $params );
		} elseif ( 'fetch' === $type ) {
			$result = $this->run_fetch_only(
				isset( $params['download_urls'] ) && is_array( $params['download_urls'] ) ? $params['download_urls'] : array(),
				isset( $params['project_id'] ) ? $params['project_id'] : '',
				isset( $params['meta'] ) && is_array( $params['meta'] ) ? $params['meta'] : array(),
				isset( $params['builder'] ) ? $params['builder'] : 'auto'
			);
		} else {
			$project_id = isset( $params['project_id'] ) ? $params['project_id'] : '';
			$meta       = isset( $params['meta'] ) && is_array( $params['meta'] ) ? $params['meta'] : array();
			$result     = $this->run_import_pages_only( $project_id, $meta );
		}

		$this->active_job_key = '';

		// This job is finished either way; drop the marker so the next request is
		// free to start a fresh one rather than joining a job that has ended.
		$live = get_option( self::OPTION_LIVE_JOBS, array() );
		if ( is_array( $live ) && isset( $live[ $type ] ) && $live[ $type ] === $job_id ) {
			unset( $live[ $type ] );
			update_option( self::OPTION_LIVE_JOBS, $live, false );
		}

		$job = get_transient( $key );
		if ( ! is_array( $job ) ) {
			return;
		}

		if ( is_wp_error( $result ) ) {
			$job['status'] = 'error';
			$job['error']  = $result->get_error_message();
		} else {
			$job['status'] = 'complete';
			$job['result'] = $result;
		}
		set_transient( $key, $job, HOUR_IN_SECONDS );
	}

	/**
	 * REST API callback: poll import-pages job status.
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_get_import_job_status( $request ) {
		$job_id = $request->get_param( 'job_id' );
		$key    = self::IMPORT_JOB_PREFIX . $job_id;
		$job    = get_transient( $key );

		if ( ! is_array( $job ) ) {
			return new WP_Error(
				'rest_not_found',
				__( 'Import job not found or expired.', 'uichemy' ),
				array( 'status' => 404 )
			);
		}

		if ( (int) get_current_user_id() !== (int) $job['wp_user_id'] ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have access to this job.', 'uichemy' ),
				array( 'status' => 403 )
			);
		}

		$out = array(
			'status' => $job['status'],
		);
		// `progress` drives a real counter in the UI instead of a timed animation;
		// `updated` lets the client spot a worker that died mid-run (see
		// update_job_progress()).
		if ( isset( $job['progress'] ) && is_array( $job['progress'] ) ) {
			$out['progress'] = $job['progress'];
		}
		$out['updated'] = isset( $job['updated'] ) ? (int) $job['updated'] : (int) $job['created'];
		$out['now']     = time();
		if ( 'complete' === $job['status'] && isset( $job['result'] ) ) {
			$out['result'] = $job['result'];
		}
		if ( 'error' === $job['status'] && isset( $job['error'] ) ) {
			$out['error'] = $job['error'];
		}

		return new WP_REST_Response( $out );
	}

	/**
	 * Recursively flatten a `downloadUrls` payload into a flat list of URL strings.
	 *
	 * The upstream replace-project API can return either a flat string[] or grouped
	 * buckets (e.g. { static_pages: [...], blog_pages: [...], globals: [...] }) — the
	 * JS client's normalizeDownloadUrls() already flattens before sending, but a caller
	 * hitting this REST route directly with the raw grouped shape must be handled the
	 * same way here. Without this, filtering for top-level strings only silently drops
	 * every URL (each bucket is an array, not a string) and the fetch reports success
	 * with zero files.
	 *
	 * @param mixed $raw Raw downloadUrls value (string, flat array, or nested array/object).
	 * @return string[] Flat list of URL strings.
	 */
	protected function flatten_download_urls( $raw ) {
		if ( is_string( $raw ) ) {
			return '' !== trim( $raw ) ? array( $raw ) : array();
		}
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $item ) {
			$out = array_merge( $out, $this->flatten_download_urls( $item ) );
		}
		return $out;
	}

	/**
	 * Normalize download URL (force HTTPS for our own API hosts to avoid fetch failures).
	 *
	 * The host is also derived from UICH_WEBPAGE_API_URL rather than only being
	 * named here, so switching that constant doesn't silently leave the upgrade
	 * behind on a host that no longer serves us.
	 *
	 * NOTE: no legacy host is listed any more. A download URL stored by an import
	 * that predates the current API host is left on plain http:// and will fail on
	 * any host that blocks plain-HTTP server-side fetches — such a project has to
	 * be re-imported to refresh its stored URLs.
	 *
	 * @param string $url URL.
	 * @return string URL.
	 */
	protected function normalize_download_url( $url ) {
		if ( ! is_string( $url ) || '' === $url ) {
			return '';
		}

		$hosts = array( 'creator-api.uichemy.com' );
		$api_host = wp_parse_url( UICH_WEBPAGE_API_URL, PHP_URL_HOST );
		if ( is_string( $api_host ) && '' !== $api_host ) {
			$hosts[] = $api_host;
		}

		// Some hosts block plain HTTP for server-side fetches, so upgrade our own
		// download URLs to HTTPS.
		foreach ( array_unique( $hosts ) as $host ) {
			$url = preg_replace(
				'#^http://' . preg_quote( $host, '#' ) . '/#i',
				'https://' . $host . '/',
				$url
			);
		}

		return $url;
	}

	/**
	 * Whether stored JSON is a Gutenberg markup payload (from URL override).
	 *
	 * @param mixed $data Decoded file data.
	 * @return bool
	 */
	protected function is_gutenberg_replacement_data( $data ) {
		return is_array( $data )
			&& ! empty( $data['_uich_webpage_gutenberg'] )
			&& isset( $data['markup'] )
			&& is_string( $data['markup'] )
			&& '' !== $data['markup'];
	}

	/**
	 * Normalize REST `builder` for fetch: elementor (JSON only), gutenberg (allow markup fallback), auto (legacy heuristic).
	 *
	 * @param mixed $builder Raw param.
	 * @return string One of elementor, gutenberg, auto.
	 */
	protected function normalize_fetch_builder( $builder ) {
		if ( ! is_string( $builder ) || '' === $builder ) {
			return 'auto';
		}
		$b = strtolower( trim( $builder ) );
		if ( in_array( $b, array( 'elementor', 'gutenberg', 'auto' ), true ) ) {
			return $b;
		}
		return 'auto';
	}

	/**
	 * Host allowlisted for outbound requests that attach the UiChemy OAuth Bearer token —
	 * derived from the configured UiChemy API base URL (UICH_WEBPAGE_API_URL), so a
	 * wp-config.php override for local/staging environments is respected automatically
	 * instead of a hardcoded hostname.
	 *
	 * @return string Lowercased host, or '' if it could not be determined.
	 */
	protected function allowed_fetch_host() {
		$host = wp_parse_url( Uich_Webpage_Api::API_BASE_URL, PHP_URL_HOST );
		return is_string( $host ) ? strtolower( $host ) : '';
	}

	/**
	 * Whether $url's host matches allowed_fetch_host(). Shared guard for every outbound
	 * request that attaches the UiChemy OAuth Bearer token (fetch_raw_body_from_url() for
	 * downloadUrls, rest_download_pro_plugins() for requiredPlugins.pro zip URLs) — without
	 * it, an admin-triggered (or attacker-influenced payload) request to an arbitrary host
	 * would leak that Bearer token to wherever the URL points. Route every such fetch
	 * through this one check so a future fetch path can't reintroduce the gap.
	 *
	 * @param mixed $url URL about to be requested.
	 * @return bool
	 */
	protected function is_allowed_fetch_url( $url ) {
		$host         = is_string( $url ) ? wp_parse_url( $url, PHP_URL_HOST ) : false;
		$allowed_host = $this->allowed_fetch_host();
		return '' !== $allowed_host && is_string( $host ) && strtolower( $host ) === $allowed_host;
	}

	/**
	 * Fetch raw HTTP body (for HTML or Gutenberg markup URLs).
	 *
	 * downloadUrls only ever legitimately point at the UiChemy API host — this is the
	 * sole caller of wp_remote_get() for those URLs, so restricting it here closes an
	 * admin-triggered SSRF surface: without a host check, an authenticated admin (or
	 * anyone able to influence the downloadUrls payload) could make the server fetch
	 * arbitrary internal/external URLs, and — since this request carries the user's
	 * UiChemy Bearer token — leak that token to whatever host was requested.
	 *
	 * @param string $url URL.
	 * @return string|WP_Error Body or error.
	 */
	/**
	 * Download the project's replacement files IN PARALLEL before the fetch loop.
	 *
	 * The loop in run_fetch_only() consumed one URL at a time — ~20 sequential
	 * round-trips to the creator API per import, pure network wait. Fetching
	 * the bodies concurrently removes most of that wall-clock; the loop itself
	 * still owns decoding, storage and error shapes, it just finds the body
	 * already in memory.
	 *
	 * Security is the reason this mirrors fetch_raw_body_from_url() so closely:
	 * every request carries the user's UiChemy Bearer token, so every URL must
	 * pass the SAME is_allowed_fetch_url() host check before it joins a batch —
	 * anything else re-opens the token-leak hole that check exists to close.
	 * A URL that fails here (batch exception, non-200) is simply left out of
	 * the map, and the sequential path retries it alone with its own error
	 * reporting, so behaviour on failure is byte-for-byte what it was.
	 *
	 * @param string[] $urls Download URLs (already normalized).
	 * @return void
	 */
	protected function prefetch_replacement_bodies( array $urls ) {
		if ( ! class_exists( '\\WpOrg\\Requests\\Requests' ) ) {
			return;
		}

		$headers      = array();
		$access_token = $this->auth->get_access_token();
		if ( $access_token ) {
			$headers['Authorization'] = 'Bearer ' . $access_token;
		}

		$queue = array();
		foreach ( array_unique( array_filter( $urls, 'is_string' ) ) as $url ) {
			if ( isset( $this->prefetched_bodies[ $url ] ) || ! $this->is_allowed_fetch_url( $url ) ) {
				continue;
			}
			$queue[] = $url;
		}
		if ( count( $queue ) < 2 ) {
			return; // nothing to parallelize.
		}

		foreach ( array_chunk( $queue, 6 ) as $batch ) {
			$requests = array();
			foreach ( $batch as $url ) {
				$requests[ $url ] = array(
					'url'     => $url,
					'type'    => 'GET',
					'headers' => $headers,
				);
			}
			try {
				$responses = \WpOrg\Requests\Requests::request_multiple(
					$requests,
					array(
						'timeout'          => 120,
						'connect_timeout'  => 10,
						'follow_redirects' => true,
						'verify'           => uich_webpage_http_sslverify() ? ABSPATH . WPINC . '/certificates/ca-bundle.crt' : false,
					)
				);
			} catch ( \Throwable $e ) {
				continue;
			}
			foreach ( $responses as $url => $response ) {
				if ( ! ( $response instanceof \WpOrg\Requests\Response ) ) {
					continue;
				}
				if ( (int) $response->status_code >= 400 || '' === (string) $response->body ) {
					continue;
				}
				$this->prefetched_bodies[ $url ] = (string) $response->body;
			}
		}
	}

	protected function fetch_raw_body_from_url( $url ) {
		if ( ! is_string( $url ) || '' === $url ) {
			return new WP_Error( 'IMPORT_FETCH_INVALID_URL', __( 'Invalid URL.', 'uichemy' ), array( 'status' => 400 ) );
		}

		if ( ! $this->is_allowed_fetch_url( $url ) ) {
			return new WP_Error(
				'IMPORT_FETCH_DISALLOWED_HOST',
				sprintf(
					/* translators: %s: the rejected URL */
					__( 'Refusing to fetch from a non-UiChemy host: %s', 'uichemy' ),
					$url
				),
				array( 'status' => 403 )
			);
		}

		// Prefetched in parallel by prefetch_replacement_bodies()? Serve that
		// body; the host check above has already run for this URL either way.
		if ( isset( $this->prefetched_bodies[ $url ] ) ) {
			$body = $this->prefetched_bodies[ $url ];
			unset( $this->prefetched_bodies[ $url ] );
			return $body;
		}

		$args = array(
			'timeout'   => 120,
			'sslverify' => uich_webpage_http_sslverify(),
			'headers'   => array(),
		);

		$access_token = $this->auth->get_access_token();
		if ( $access_token ) {
			$args['headers']['Authorization'] = 'Bearer ' . $access_token;
		}

		$response = wp_remote_get( $url, $args );

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'IMPORT_FETCH_NETWORK_ERROR',
				sprintf(
					// translators: %1$s is the error message, %2$s is the requested URL.
					__( 'Could not fetch URL: %1$s (%2$s)', 'uichemy' ),
					$response->get_error_message(),
					$url
				),
				array( 'status' => 502 )
			);
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );

		if ( $code >= 400 ) {
			return new WP_Error(
				'IMPORT_FETCH_HTTP_ERROR',
				sprintf(
					// translators: %1$d is the HTTP status code, %2$s is the requested URL.
					__( 'Failed to fetch %2$s (HTTP %1$d)', 'uichemy' ),
					$code,
					$url
				),
				array( 'status' => $code >= 400 && $code < 500 ? $code : 502 )
			);
		}

		return $body;
	}

	/**
	 * Extract Gutenberg block comment markup from a fetched string (JSON, HTML, or raw blocks).
	 *
	 * @param string $body Response body.
	 * @return string|WP_Error Block markup or error.
	 */
	protected function extract_gutenberg_markup_from_body( $body ) {
		if ( ! is_string( $body ) || '' === $body ) {
			return new WP_Error(
				'IMPORT_FETCH_EMPTY_BODY',
				__( 'Empty response when loading Gutenberg page URL.', 'uichemy' ),
				array( 'status' => 502 )
			);
		}

		$trim = trim( $body );
		// JSON: WordPress REST content.raw, or wrapped { "markup": "..." }.
		$decoded = json_decode( $trim, true );
		if ( is_array( $decoded ) ) {
			if ( isset( $decoded['content']['raw'] ) && is_string( $decoded['content']['raw'] ) && false !== strpos( $decoded['content']['raw'], '<!-- wp:' ) ) {
				return $decoded['content']['raw'];
			}
			if ( isset( $decoded['markup'] ) && is_string( $decoded['markup'] ) ) {
				return $decoded['markup'];
			}
		}

		$pos = strpos( $body, '<!-- wp:' );
		if ( false !== $pos ) {
			return substr( $body, $pos );
		}

		return new WP_Error(
			'IMPORT_FETCH_NO_BLOCK_MARKUP',
			__( 'Could not find Gutenberg block markup (<!-- wp:...) in the URL response. Use an export or REST URL that includes raw blocks.', 'uichemy' ),
			array( 'status' => 422 )
		);
	}

	/**
	 * Convert raw block markup to stored post_content (Nexter processor + local images).
	 *
	 * @param string $markup Serialized block comments + HTML.
	 * @return string|WP_Error
	 */
	protected function process_gutenberg_markup_to_post_content( $markup ) {
		if ( ! is_string( $markup ) || '' === $markup ) {
			return new WP_Error( 'IMPORT_FETCH_EMPTY_MARKUP', __( 'Empty Gutenberg markup.', 'uichemy' ), array( 'status' => 400 ) );
		}

		$markup = $this->replace_unicode_glitch( $markup );

		// WordPress's WP_Block_Parser only recognises JSON objects ({...}) as block attrs.
		// TPGB exports tp-anything-slide with `[]` (empty array) which fails the parser regex,
		// causing slide block comments to be ignored and all slides to collapse into one container.
		// Replace `[]` with `{}` in block opening/closing comments so parse_blocks sees them.
		$markup = preg_replace(
			'/<!--\s*(wp:[a-zA-Z0-9_\/-]+)\s*\[\]\s*(\/?)-->/',
			'<!-- $1 $2-->',
			$markup
		);

		if ( ! function_exists( 'parse_blocks' ) || ! function_exists( 'serialize_blocks' ) ) {
			return new WP_Error( 'IMPORT_BLOCK_FUNCTIONS_MISSING', __( 'Block editor functions are not available.', 'uichemy' ), array( 'status' => 500 ) );
		}

		$parsed_blocks = parse_blocks( $markup );
		if ( empty( $parsed_blocks ) ) {
			return new WP_Error( 'IMPORT_FETCH_PARSE_BLOCKS_FAILED', __( 'Could not parse Gutenberg blocks from markup.', 'uichemy' ), array( 'status' => 422 ) );
		}

		// Remove legacy (no-block_id) carousel slides before deduplication so that the
		// duplicate-detection pass does not strip inner blocks from the proper slides first.
		$parsed_blocks = $this->remove_legacy_carousel_slides( $parsed_blocks );

		// Same duplicate-export pattern for tabs tours: drop legacy (static-HTML) tab items
		// so deduplication keeps the proper copies, which carry the current image attrs.
		$processor     = new Uich_Webpage_Block_Processor();
		$parsed_blocks = $processor->remove_legacy_tab_items( $parsed_blocks );

		$seen_block_ids = array();
		$parsed_blocks  = $this->deduplicate_blocks_by_id( $parsed_blocks, $seen_block_ids );

		// Sync each TPGB block's tpgb-wrap-* / tpgb-block-* HTML classes in the stored static
		// HTML to match the block_id attribute. WDesignKit sometimes exports pages where the
		// block_id attribute was changed (to avoid CSS collisions across reused sections) but the
		// static HTML class was not updated, causing the block's CSS to target a class that no
		// longer exists in the markup. The Gutenberg editor fixes this on manual save; we fix it
		// here so styles apply immediately on first page load after import.
		$parsed_blocks = $this->sync_tpgb_block_ids_in_html( $parsed_blocks );

		// Remap globalTypo values from original slot numbers (e.g. 8, 9, 12) to compact
		// sequential positions (1, 2, 3 …) so they match the gap-free preset array.
		$typo_remap = get_option( 'uich_webpage_tpgb_typo_remap', array() );
		if ( ! empty( $typo_remap ) ) {
			$parsed_blocks = $this->remap_globalTypo_in_blocks( $parsed_blocks, $typo_remap );
		}

		$parsed_blocks = $processor->run( $parsed_blocks );
		$parsed_blocks = $this->resolve_site_logo_blocks( $parsed_blocks );
		// Must run BEFORE wrap_tpgb_css_var_refs_in_blocks so the promoted fontStyle gets var()-wrapped.
		$parsed_blocks = $this->fix_tpgb_preset_typography_in_blocks( $parsed_blocks );
		$parsed_blocks = $this->wrap_tpgb_css_var_refs_in_blocks( $parsed_blocks );
		$parsed_blocks = $this->fix_tp_button_core_global_class_in_blocks( $parsed_blocks );
		$parsed_blocks = $this->remap_button_preset_class_to_slug_in_blocks( $parsed_blocks );
		// Download remote images stored only in block JSON attrs (e.g. tp-team-listing TImage,
		// tp-container bgImage) and replace both url + id with local media-library values.
		// This must run before serialize_blocks so the saved post_content has local IDs.
		// Prefetch here, at the top-level call: the resolver recurses into
		// innerBlocks, so doing it inside would re-batch on every nesting level.
		// scan_elementor_assets() is a generic array walker — block trees expose
		// their image URLs the same two ways (bare string / ['url'] key).
		$this->prefetch_assets( $this->scan_elementor_assets( $parsed_blocks ) );
		$parsed_blocks = $this->resolve_block_attr_images( $parsed_blocks );
		$this->cleanup_prefetched_assets();
		$content = serialize_blocks( $parsed_blocks );
		$content = $this->resolve_post_content_images( $content );
		return $this->replace_unicode_glitch( $content );
	}

	/**
	 * Remove legacy (no-block_id) tp-anything-slide blocks from every tp-anything-carousel.
	 *
	 * WDesignKit exports each carousel slide TWICE:
	 *   1. Legacy format — <!-- wp:tpgb/tp-anything-slide --> (no attrs / no block_id).
	 *      The slide's own wrapper <div> lives in static innerHTML and the inner blocks are
	 *      nested inside it.
	 *   2. Proper format — <!-- wp:tpgb/tp-anything-slide {"block_id":"…"} -->.
	 *      No static HTML wrapper; inner blocks are referenced directly as innerBlocks.
	 *
	 * Both formats carry the SAME inner block_ids (e.g. the container inside each slide
	 * pair has the same block_id). If the legacy slides are left in place when
	 * deduplicate_blocks_by_id runs, the deduplicator marks those inner block_ids as
	 * "seen" while processing the legacy slides, then strips the SAME inner blocks from
	 * the proper slides — leaving them empty. Removing the legacy slides FIRST prevents
	 * that and ensures deduplication only runs against the correct set of blocks.
	 *
	 * This method must be called BEFORE deduplicate_blocks_by_id.
	 *
	 * @param array $blocks Parsed block tree.
	 * @return array Block tree with legacy carousel slides removed.
	 */
	protected function remove_legacy_carousel_slides( array $blocks ) {
		foreach ( $blocks as &$block ) {
			// Recurse into all inner blocks first.
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->remove_legacy_carousel_slides( $block['innerBlocks'] );
			}

			if ( 'tpgb/tp-anything-carousel' !== ( isset( $block['blockName'] ) ? $block['blockName'] : '' ) ) {
				continue;
			}
			if ( empty( $block['innerBlocks'] ) ) {
				continue;
			}

			// Separate slide innerBlocks into those with and without a block_id.
			$with_id_indices    = array();
			$without_id_indices = array();
			foreach ( $block['innerBlocks'] as $idx => $inner ) {
				if ( 'tpgb/tp-anything-slide' !== ( isset( $inner['blockName'] ) ? $inner['blockName'] : '' ) ) {
					continue;
				}
				if ( ! empty( $inner['attrs']['block_id'] ) ) {
					$with_id_indices[] = $idx;
				} else {
					$without_id_indices[] = $idx;
				}
			}

			// Only act when both kinds are present (the mixed-export case).
			if ( empty( $with_id_indices ) || empty( $without_id_indices ) ) {
				continue;
			}

			$remove_set = array_flip( $without_id_indices );

			// Drop legacy slides from innerBlocks.
			$new_inner_blocks = array();
			foreach ( $block['innerBlocks'] as $idx => $inner ) {
				if ( ! isset( $remove_set[ $idx ] ) ) {
					$new_inner_blocks[] = $inner;
				}
			}
			$block['innerBlocks'] = array_values( $new_inner_blocks );

			// Remove the corresponding null slots from innerContent.
			// The K-th null in innerContent is the placeholder for innerBlocks[K].
			$null_counter      = 0;
			$new_inner_content = array();
			foreach ( $block['innerContent'] as $chunk ) {
				if ( null === $chunk ) {
					if ( ! isset( $remove_set[ $null_counter ] ) ) {
						$new_inner_content[] = $chunk;
					}
					++$null_counter;
				} else {
					$new_inner_content[] = $chunk;
				}
			}
			$block['innerContent'] = $new_inner_content;
		}
		unset( $block );
		return $blocks;
	}

	/**
	 * Remove duplicate blocks from a parsed block array.
	 *
	 * WDesignKit occasionally exports the same section twice with identical block_id values,
	 * which causes TPGB to generate duplicate CSS for each block. Walk the tree recursively
	 * and skip any block whose block_id has already been seen.
	 *
	 * @param array $blocks   Parsed blocks (from parse_blocks).
	 * @param array &$seen    Block IDs already encountered — passed by reference across levels.
	 * @return array Filtered blocks with duplicates removed.
	 */
	protected function deduplicate_blocks_by_id( array $blocks, array &$seen ) {
		$result = array();
		foreach ( $blocks as $block ) {
			$block_id = isset( $block['attrs']['block_id'] ) ? (string) $block['attrs']['block_id'] : '';
			if ( '' !== $block_id ) {
				if ( isset( $seen[ $block_id ] ) ) {
					continue;
				}
				$seen[ $block_id ] = true;
			}
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->deduplicate_blocks_by_id( $block['innerBlocks'], $seen );
			}
			$result[] = $block;
		}
		return $result;
	}

	/**
	 * Sync each TPGB block's tpgb-wrap-* / tpgb-block-* HTML classes to match its block_id attribute.
	 *
	 * WDesignKit exports may change the `block_id` attribute (to avoid CSS collisions when a section
	 * template is reused) without updating the static HTML between the block comment delimiters. This
	 * causes a mismatch: the generated CSS targets `.tpgb-block-{new_id}` but the markup has
	 * `class="tpgb-block-{old_id}"`. The Gutenberg editor corrects this on save; we correct it here
	 * so the imported page renders correctly without requiring a manual edit.
	 *
	 * @param array $blocks Parsed block tree (from parse_blocks).
	 * @return array Blocks with HTML classes updated to match block_id attrs.
	 */
	protected function sync_tpgb_block_ids_in_html( array $blocks ) {
		foreach ( $blocks as &$block ) {
			$block_id = isset( $block['attrs']['block_id'] ) ? (string) $block['attrs']['block_id'] : '';

			if ( '' !== $block_id ) {
				// Replace any tpgb-wrap-{OLD} and tpgb-block-{OLD} with the correct block_id.
				// The OLD id is a 4-hex-char prefix + underscore + numeric suffix, e.g. "da90_4997".
				$pattern = '/\btpgb-(wrap|block)-[0-9a-f]{4}_\d+\b/i';
				$replace_fn = function( $matches ) use ( $block_id ) {
					return 'tpgb-' . $matches[1] . '-' . $block_id;
				};

				if ( isset( $block['innerHTML'] ) && '' !== $block['innerHTML'] ) {
					$updated = preg_replace_callback( $pattern, $replace_fn, $block['innerHTML'] );
					if ( null !== $updated ) {
						$block['innerHTML'] = $updated;
					}
				}

				if ( ! empty( $block['innerContent'] ) ) {
					foreach ( $block['innerContent'] as &$chunk ) {
						if ( is_string( $chunk ) && '' !== $chunk ) {
							$updated = preg_replace_callback( $pattern, $replace_fn, $chunk );
							if ( null !== $updated ) {
								$chunk = $updated;
							}
						}
					}
					unset( $chunk );
				}
			}

			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->sync_tpgb_block_ids_in_html( $block['innerBlocks'] );
			}
		}
		unset( $block );
		return $blocks;
	}

	/**
	 * Assign unique TPGB block_ids with the correct post_id suffix to every TPGB block.
	 *
	 * TPGB's Gutenberg JS normalises block_ids at editor load: it detects blocks whose
	 * block_id suffix doesn't match the current post_id and rewrites them to
	 * `{prefix}_{post_id}`.  When a page is imported from a template, ALL heading blocks
	 * (or any other blocks) that were originally created from the same template share the
	 * same 4-char hex prefix — e.g. every "Transform Your Look Today" heading block may
	 * have prefix `4e2d`.  After the JS normalises them they all become `4e2d_{post_id}`,
	 * sharing one CSS rule and thus all looking identical.
	 *
	 * This method pre-empts the JS by assigning each block a unique block_id with the
	 * correct `_{post_id}` suffix before the post is saved:
	 *   - The original prefix is kept for the first block that claims it.
	 *   - A random 4-char hex prefix is generated for any later block that would collide.
	 *   - The tpgb-wrap-* / tpgb-block-* HTML classes in innerHTML / innerContent are
	 *     updated to match the new block_id (also handles the WDesignKit mismatch where the
	 *     HTML class may differ from the block_id attribute).
	 *
	 * @param string $post_content Serialised Gutenberg block markup.
	 * @param int    $post_id      The WordPress post ID to use as the block_id suffix.
	 * @return string Updated block markup.
	 */
	protected function apply_unique_tpgb_block_ids( $post_content, $post_id ) {
		if ( ! function_exists( 'parse_blocks' ) || ! function_exists( 'serialize_blocks' ) ) {
			return $post_content;
		}
		if ( ! is_int( $post_id ) || $post_id <= 0 ) {
			return $post_content;
		}
		$blocks = parse_blocks( $post_content );
		if ( empty( $blocks ) ) {
			return $post_content;
		}
		$seen_prefixes = array();
		$blocks        = $this->assign_tpgb_block_ids_recursive( $blocks, $post_id, $seen_prefixes );
		return serialize_blocks( $blocks );
	}

	/**
	 * Recursive worker for apply_unique_tpgb_block_ids().
	 *
	 * @param array $blocks        Parsed block tree (or sub-tree).
	 * @param int   $post_id       Post ID used as suffix.
	 * @param array $seen_prefixes Registry of already-claimed 4-char prefixes, passed by reference.
	 * @return array Updated blocks.
	 */
	protected function assign_tpgb_block_ids_recursive( array $blocks, $post_id, array &$seen_prefixes ) {
		$pattern = '/\btpgb-(wrap|block)-[0-9a-f]{4}_\d+\b/i';
		foreach ( $blocks as &$block ) {
			// Recurse first so inner blocks claim their prefixes before outer containers.
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->assign_tpgb_block_ids_recursive( $block['innerBlocks'], $post_id, $seen_prefixes );
			}

			$old_block_id = isset( $block['attrs']['block_id'] ) ? (string) $block['attrs']['block_id'] : '';
			if ( '' === $old_block_id ) {
				continue;
			}

			// Extract the 4-char hex prefix (everything before the first underscore).
			$underscore_pos = strpos( $old_block_id, '_' );
			$orig_prefix    = ( false !== $underscore_pos ) ? substr( $old_block_id, 0, $underscore_pos ) : $old_block_id;

			// Claim a unique prefix for this block on this page.
			$new_prefix = $orig_prefix;
			$attempts   = 0;
			while ( isset( $seen_prefixes[ $new_prefix ] ) && $attempts < 200 ) {
				$new_prefix = sprintf( '%04x', wp_rand( 0, 0xffff ) );
				++$attempts;
			}
			$seen_prefixes[ $new_prefix ] = true;

			$new_block_id = $new_prefix . '_' . (string) $post_id;

			// Update the block_id attribute.
			$block['attrs']['block_id'] = $new_block_id;

			// Replace ANY tpgb-wrap-* / tpgb-block-* class in the block's own static HTML.
			// Using a broad pattern handles both the normal case (old HTML class == old block_id)
			// and the WDesignKit mismatch case (HTML class differs from block_id attribute).
			$replace_fn = static function ( $matches ) use ( $new_block_id ) {
				return 'tpgb-' . $matches[1] . '-' . $new_block_id;
			};

			if ( isset( $block['innerHTML'] ) && '' !== (string) $block['innerHTML'] ) {
				$updated = preg_replace_callback( $pattern, $replace_fn, (string) $block['innerHTML'] );
				if ( null !== $updated ) {
					$block['innerHTML'] = $updated;
				}
			}

			if ( ! empty( $block['innerContent'] ) ) {
				foreach ( $block['innerContent'] as &$chunk ) {
					if ( is_string( $chunk ) && '' !== $chunk ) {
						$updated = preg_replace_callback( $pattern, $replace_fn, $chunk );
						if ( null !== $updated ) {
							$chunk = $updated;
						}
					}
				}
				unset( $chunk );
			}
		}
		unset( $block );
		return $blocks;
	}

	/**
	 * Wrap raw TPGB CSS token refs in block attrs with var().
	 *
	 * Exported block attrs sometimes contain bare token names like `--tpgb-C11` for color / gradient /
	 * box-shadow tokens. The editor and frontend expect a valid CSS value, i.e. `var(--tpgb-C11)`.
	 * Walk attrs recursively and rewrite matching strings. Typography sub-tokens
	 * (`--tpgb-T11-font-size`, etc.) are left untouched — the renderer composes those via `globalTypo`.
	 *
	 * @param array $blocks Parsed blocks.
	 * @return array Blocks with attrs rewritten.
	 */
	protected function wrap_tpgb_css_var_refs_in_blocks( array $blocks ) {
		foreach ( $blocks as &$block ) {
			if ( ! empty( $block['attrs'] ) && is_array( $block['attrs'] ) ) {
				$block['attrs'] = $this->wrap_tpgb_css_var_refs( $block['attrs'] );
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->wrap_tpgb_css_var_refs_in_blocks( $block['innerBlocks'] );
			}
		}
		return $blocks;
	}

	/**
	 * Recursive walker: wrap any bare `--tpgb-*` CSS custom property name with var().
	 *
	 * Handles:
	 *  • Global tokens : --tpgb-C1, --tpgb-GC2, --tpgb-BS3, --tpgb-RAD4, --tpgb-R5
	 *  • Button-preset vars : --tpgb-btnpreset-secondary-button-btBg-color !important
	 *  • Any other --tpgb-* value, with or without a trailing " !important"
	 *
	 * The Nexter Blocks JS helpers (`It`, `Wt`) produce values like
	 * `var(--tpgb-btnpreset-secondary-button-btBg-color) !important`, but the
	 * source pages exported from another site often store the raw property name
	 * without the var() wrapper (e.g. `--tpgb-btnpreset-secondary-button-btBg-color
	 * !important`). The CSS generator in the editor then emits invalid CSS
	 * (`background-color: --tpgb-… !important`) so the button appears un-styled
	 * until the user manually reselects the preset (which re-runs the JS helper and
	 * writes the correctly-wrapped value). This function restores the wrapper at
	 * import time so the editor shows the correct preset style immediately.
	 *
	 * @param mixed $value Attribute value (scalar or nested array/object).
	 * @return mixed Rewritten value.
	 */
	protected function wrap_tpgb_css_var_refs( $value ) {
		if ( is_array( $value ) ) {
			foreach ( $value as $k => $v ) {
				$value[ $k ] = $this->wrap_tpgb_css_var_refs( $v );
			}
			return $value;
		}
		if ( ! is_string( $value ) ) {
			return $value;
		}
		// Match any bare --tpgb-* name, optionally followed by " !important".
		// The !important must sit OUTSIDE var(): var(--tpgb-C1) !important
		// Already-wrapped values (starting with "var(") are left untouched.
		if ( preg_match( '/^(--tpgb-[a-zA-Z0-9-]+)( !important)?$/', $value, $m ) ) {
			return 'var(' . $m[1] . ')' . ( ! empty( $m[2] ) ? $m[2] : '' );
		}
		// Fallback: WDesignKit sometimes exports global token refs WITHOUT the
		// leading `--` (observed in some tp-infobox `normalBG.bgDefaultColor`
		// values where the raw "tpgb-C31" is stored instead of "--tpgb-C31").
		// That value is neither a CSS var ref nor a valid color, so the CSS
		// generator emits `background-color: tpgb-C31;` and the browser drops
		// the declaration — leaving the box with no background.
		//
		// To repair, narrowly match the bare-prefix form for KNOWN global
		// token namespaces only (C / T / GC / CG / BS / R / RAD / B / BRT /
		// BRW / BRC / S / A). The token must start with an UPPERCASE letter
		// after `tpgb-` so we don't accidentally rewrite block-class strings
		// like `tpgb-block-12345` or `tpgb-container-md` which start with
		// lowercase letters.
		if ( preg_match( '/^tpgb-(?:C|T|GC|CG|BS|R|RAD|B|BRT|BRW|BRC|S|A)\d+(?:-[a-zA-Z][a-zA-Z0-9-]*)?( !important)?$/', $value, $m ) ) {
			// $m[0] without the optional " !important" suffix is the bare token.
			$token = preg_replace( '/( !important)?$/', '', $value );
			return 'var(--' . $token . ')' . ( ! empty( $m[1] ) ? $m[1] : '' );
		}
		return $value;
	}

	/**
	 * Repair button-preset typography exported as a nested `fontFamily` object.
	 *
	 * Some blocks (e.g. tp-post-comment's submit button) store typography that
	 * follows a button preset as:
	 *   "btnTypo": { "fontFamily": {
	 *       "family":     "--tpgb-btnpreset-primary-button-bTypo-family !important",
	 *       "fontWeight": "--tpgb-btnpreset-primary-button-bTypo-weight !important",
	 *       "fontStyle":  "--tpgb-btnpreset-primary-button-bTypo-style !important" } }
	 *
	 * The Nexter Blocks PHP CSS generator (tp-generate-block-css.php) mishandles this
	 * object form: it wraps the family in quotes (producing an invalid
	 * `font-family:'var(...) !important'`) and — because `fontWeight` is a STRING that
	 * contains letters — it strips the last character and FORCE-APPENDS
	 * `font-style:italic;` (see its `preg_match('/[a-z]/i', fontWeight)` branch). That
	 * is why an imported Theme Builder template renders the comment button italic until
	 * the user opens it in the editor and saves (the editor regenerates the CSS via JS,
	 * which has no such bug).
	 *
	 * We can't make the buggy PHP path emit correct family/weight from the object form,
	 * and those mangled declarations are invalid (ignored by the browser) anyway. So:
	 *   • promote the nested `fontStyle` to the top level, where the generator emits it
	 *     correctly (it reads `$val['fontStyle']`), then var()-wrapping turns it into a
	 *     valid `font-style:var(--…-bTypo-style)!important` (resolves to "normal"), and
	 *   • drop the nested `fontFamily` object so the buggy family/weight branch never runs.
	 * The button still inherits family/weight from the preset's own button CSS.
	 *
	 * @param array $blocks Parsed blocks.
	 * @return array
	 */
	protected function fix_tpgb_preset_typography_in_blocks( array $blocks ) {
		foreach ( $blocks as &$block ) {
			if ( ! empty( $block['attrs'] ) && is_array( $block['attrs'] ) ) {
				$block['attrs'] = $this->fix_tpgb_preset_typography( $block['attrs'] );
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->fix_tpgb_preset_typography_in_blocks( $block['innerBlocks'] );
			}
		}
		unset( $block );
		return $blocks;
	}

	/**
	 * Recursive worker for fix_tpgb_preset_typography_in_blocks().
	 *
	 * @param mixed $value Attribute value (scalar or nested array).
	 * @return mixed
	 */
	protected function fix_tpgb_preset_typography( $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		if ( isset( $value['fontFamily'] ) && is_array( $value['fontFamily'] ) ) {
			$ff            = $value['fontFamily'];
			$is_preset_ref = false;
			foreach ( array( 'family', 'fontWeight', 'fontStyle' ) as $k ) {
				if ( isset( $ff[ $k ] ) && is_string( $ff[ $k ] ) && false !== strpos( $ff[ $k ], '--tpgb-' ) ) {
					$is_preset_ref = true;
					break;
				}
			}
			if ( $is_preset_ref ) {
				// Promote fontStyle so the generator emits a valid font-style (no fabricated italic).
				if ( isset( $ff['fontStyle'] ) && is_string( $ff['fontStyle'] ) && ! isset( $value['fontStyle'] ) ) {
					$value['fontStyle'] = $ff['fontStyle'];
				}
				unset( $value['fontFamily'] );
			}
		}
		foreach ( $value as $k => $v ) {
			$value[ $k ] = $this->fix_tpgb_preset_typography( $v );
		}
		return $value;
	}

	/**
	 * Recursive walker: fix tp-button-core blocks that have a specific selectedButtonPreset
	 * by removing the "nxt-button-core-global" CSS class from their className attribute.
	 *
	 * Root-cause context
	 * ------------------
	 * blocks.js generates two competing CSS rules for every tpgb/tp-button-core block
	 * that uses a global button preset:
	 *
	 *   (A) Per-block:  .tpgb-block-{id} .tpgb-btn-wrap { background-color: var(--tpgb-btnpreset-secondary-button-btBg-color) !important; }
	 *   (B) Global:     .nxt-button-core-global .tpgb-btn-wrap { background-color: var(--tpgb-btnpreset-primary-button-btBg-color) !important; }
	 *
	 * Both rules have identical specificity (0,2,0) and both carry !important.  CSS
	 * resolves equal-specificity !important declarations by SOURCE ORDER — the later
	 * rule wins.
	 *
	 * (A) is injected via each block's useEffect as React renders the editor.
	 * (B) is injected only AFTER the async REST fetch in blocks.js completes
	 *     (the IIFE at the bottom of blocks.js does `await fetch(…); Ko(); Xo("",t)`).
	 *
	 * Because the async fetch finishes AFTER the editor has already rendered all
	 * blocks and run their useEffects, (B) always lands in the DOM AFTER (A).
	 * Result: the "active" (primary) preset's background colour overrides every
	 * secondary/tertiary button in the editor, regardless of which preset the block
	 * was configured with.
	 *
	 * Fix
	 * ---
	 * A block that carries its own selectedButtonPreset does NOT need the generic
	 * nxt-button-core-global class — that class is only meaningful for blocks whose
	 * styling should follow whichever preset is marked "active" globally.  Stripping
	 * nxt-button-core-global from the className of imported blocks that already have
	 * a specific preset means rule (B) simply does not match those elements any more,
	 * and rule (A) alone applies — showing the correct per-block preset style.
	 *
	 * This has no effect on the frontend: the frontend stylesheet uses the CSS-variable
	 * definitions from plus-button-presets.css (the :root rules produced by
	 * Tpgb_Button_Preset_Vars), not the JS-generated editor rules.
	 *
	 * @param array $blocks Parsed block tree.
	 * @return array Block tree with nxt-button-core-global stripped from qualifying blocks.
	 */
	protected function fix_tp_button_core_global_class_in_blocks( array $blocks ) {
		foreach ( $blocks as &$block ) {
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->fix_tp_button_core_global_class_in_blocks( $block['innerBlocks'] );
			}

			if ( 'tpgb/tp-button-core' !== ( isset( $block['blockName'] ) ? $block['blockName'] : '' ) ) {
				continue;
			}

			$attrs = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();

			// Generate static HTML when the block was exported without saved markup.
			// tp-button-core's render_callback returns $content verbatim — if it is
			// empty the button simply does not appear on the front end.
			$current_html = isset( $block['innerHTML'] ) ? trim( (string) $block['innerHTML'] ) : '';
			if ( '' === $current_html ) {
				$block_id   = isset( $attrs['block_id'] ) ? (string) $attrs['block_id'] : '';
				$btxt       = isset( $attrs['btxt'] ) ? (string) $attrs['btxt'] : '';
				$burl       = ( isset( $attrs['bUrl'] ) && '' !== (string) $attrs['bUrl'] ) ? (string) $attrs['bUrl'] : '#';
				$btarget    = ( isset( $attrs['bUrlTarget'] ) && '' !== (string) $attrs['bUrlTarget'] ) ? (string) $attrs['bUrlTarget'] : '_self';

				$generated = '<div class="wp-block-tpgb-tp-button-core tp-button-core'
					. ( '' !== $block_id ? ' tpgb-block-' . esc_attr( $block_id ) : '' )
					. ' nxt-button-core-global"><a href="' . esc_attr( $burl )
					. '" target="' . esc_attr( $btarget ) . '" rel="follow noopener" class="tpgb-btn-link">'
					. '<span class="tpgb-btn-wrap"><span class="tpgb-btn-txt">' . esc_html( $btxt ) . '</span></span>'
					. '</a></div>';

				$block['innerHTML']    = $generated;
				$block['innerContent'] = array( $generated );
			}

			// Only act when the block uses a specific preset (not the open "global active" one).
			$uses_global = ! empty( $attrs['useGlobalButtonSettings'] );
			$has_preset  = ! empty( $attrs['selectedButtonPreset'] );

			if ( ! $uses_global || ! $has_preset ) {
				continue;
			}

			$class_val = isset( $attrs['className'] ) ? (string) $attrs['className'] : '';

			// Derive the preset slug from any preset-namespaced CSS var ref already
			// in attrs — same pattern as extract_button_preset_slug_map(). Without a
			// slug we can't add the wrapper class, so the block keeps the (cleaned)
			// className it already had.
			$slug = '';
			$attrs_json = wp_json_encode( $attrs );
			if ( is_string( $attrs_json ) && preg_match(
				'/--tpgb-btnpreset-([a-z][a-z0-9-]*)-(?:bTypo|btColor|bthColor|btBg|bthBg|bBord|bthBColor|brad|btPad|btshadow|bthShadow|tShadow)/',
				$attrs_json,
				$slug_match
			) ) {
				$slug = $slug_match[1];
			}

			// Strip nxt-button-core-global and any stale nxt-btn-global* tokens.
			// (Re-import idempotency: if a previous import already added the
			// slug class, we want to drop it and re-derive so the slug reflects
			// the current preset state, not a stale one.)
			$classes = array_filter(
				array_map( 'trim', explode( ' ', $class_val ) ),
				function ( $c ) {
					if ( '' === $c ) {
						return false;
					}
					if ( 'nxt-button-core-global' === $c ) {
						return false;
					}
					if ( 'nxt-btn-global' === $c ) {
						return false;
					}
					if ( 0 === strpos( $c, 'nxt-btn-global-' ) ) {
						return false;
					}
					return true;
				}
			);

			// Bake the slug-based wrapper class into the STATIC save HTML so
			// plus-global.css's `.nxt-btn-global-btnpreset-{slug} .tpgb-btn-wrap`
			// rules (emitted by build_tpgb_button_preset_wrapper_css) match the
			// rendered DOM.
			//
			// Why patch innerHTML/innerContent, not attrs.className: tp-button-core's
			// render_callback `tpgb_tp_button_core_render($attr, $content)` returns
			// the static $content verbatim (if it contains `tpgb-wrap-`) or routes
			// to block_Wrap_Render — which builds its wrapClass from
			// `globalClasses`/animation/position ONLY, NEVER from
			// attributes['className']. With none of those set (the common case for
			// imported buttons), $hasWrapper=false and content is returned as-is.
			// attrs.className is therefore a dead letter on render; only the
			// static save HTML reaches the browser.
			//
			// CSS ordering in build_tpgb_button_preset_wrapper_css() emits
			// `.nxt-button-core-global` FIRST (carrying the active preset's
			// values, defaulting to primary), then per-preset rules
			// `.nxt-btn-global-btnpreset-{slug}` AFTER. Both at same specificity,
			// both with !important — later source order wins, so the slug rule
			// overrides the active-preset fallback for secondary/tertiary buttons.
			if ( '' !== $slug ) {
				// Patch the static wrapper div in innerHTML/innerContent. The
				// wrapper is the first div whose class contains both
				// `tp-button-core` and `tpgb-block-` — i.e. the save.js-generated
				// root element.
				$patch_html = function ( $html ) use ( $slug ) {
					if ( ! is_string( $html ) || '' === $html ) {
						return $html;
					}
					return preg_replace_callback(
						'/(<div\b[^>]*\bclass=")([^"]*\btp-button-core\b[^"]*\btpgb-block-[^"\s]+[^"]*)(")/i',
						function ( $m ) use ( $slug ) {
							// Strip any prior slug-form classes so re-imports
							// don't accumulate stale `nxt-btn-global-*` tokens
							// pointing at a different preset slug.
							$tokens = array_values( array_filter(
								preg_split( '/\s+/', $m[2] ),
								function ( $t ) {
									return '' !== $t
										&& 'nxt-btn-global' !== $t
										&& 0 !== strpos( $t, 'nxt-btn-global-' );
								}
							) );

							// Keep `nxt-button-core-global` (it's the active-preset
							// fallback selector, emitted FIRST in plus-global.css)
							// and append the slug class so the per-preset rule
							// wins by later source order at equal specificity.
							$tokens[] = 'nxt-btn-global';
							$tokens[] = 'nxt-btn-global-btnpreset-' . $slug;

							return $m[1] . implode( ' ', $tokens ) . $m[3];
						},
						$html,
						1 // Only the FIRST wrapper div — inner spans must not be touched.
					);
				};

				if ( isset( $block['innerHTML'] ) ) {
					$block['innerHTML'] = $patch_html( $block['innerHTML'] );
				}
				if ( isset( $block['innerContent'] ) && is_array( $block['innerContent'] ) ) {
					foreach ( $block['innerContent'] as $k => $chunk ) {
						if ( is_string( $chunk ) ) {
							// tp-button-core has no innerBlocks, so the wrapper
							// sits in innerContent[0]; loop is defensive only.
							$block['innerContent'][ $k ] = $patch_html( $chunk );
						}
					}
				}
			}

			$block['attrs']['className'] = implode( ' ', $classes );
		}
		return $blocks;
	}

	/**
	 * Inject the preset wrapper class into `attrs.className` on tp-button /
	 * tp-advanced-buttons blocks so the global preset CSS in plus-global.css
	 * actually matches the rendered element.
	 *
	 * Root cause this addresses
	 * -------------------------
	 * tp-button (and tp-advanced-buttons) are **server-side rendered** by TPGB.
	 * Their `tpgb_button_render_callback` in tp-button/index.php builds the
	 * wrapper HTML from scratch at render time:
	 *
	 *   $blockClass = Tp_Blocks_Helper::block_wrapper_classes( $attributes );
	 *   $output .= '<div class="tpgb-plus-button ... button-' . $styleType . ' '
	 *            . esc_attr( $blockClass ) . ' ">';
	 *
	 * and `block_wrapper_classes()` reads custom classes from EXACTLY ONE place:
	 * `$attributes['className']`. The static innerHTML/innerContent in the
	 * block comment is consulted only by the editor preview and is thrown
	 * away on every front-end render.
	 *
	 * WDesignKit exports leave `className` unset (the wrapper class is baked
	 * into the static HTML instead). After our import the front-end render
	 * therefore emits a wrapper with `tpgb-plus-button ... button-style-8`
	 * and an EMPTY className slot — no `nxt-btn-global-btnpreset-{slug}` class,
	 * no global preset CSS match, button renders with the default style-8
	 * outline. Symptom: cookie consent popup buttons look unstyled until the
	 * user opens the popup post in the editor and clicks Save (which lets
	 * TPGB's editor JS persist the missing className).
	 *
	 * Earlier attempts at fixing the static innerHTML/innerContent were
	 * pointless for this reason — they never reach the renderer.
	 *
	 * What this method does
	 * ---------------------
	 * For each tp-button / tp-advanced-buttons block whose attributes say
	 * "this block uses a preset":
	 *
	 *   1. Derive the preset slug from any `--tpgb-btnpreset-{slug}-*` CSS
	 *      var reference already present in the block attrs. (We don't need
	 *      a globally threaded key→slug map; each block carries enough
	 *      information to recover its own slug.)
	 *   2. Strip any stale `nxt-btn-global` / `nxt-btn-global-*` tokens from
	 *      the existing className so we don't accumulate duplicates on
	 *      re-import or carry a stale key-form like `nxt-btn-global-btnpreset1`.
	 *   3. Append the two classes plus-global.css needs to see:
	 *        `nxt-btn-global`                          ← marker
	 *        `nxt-btn-global-btnpreset-{slug}`         ← preset binder
	 *
	 * Why tp-button-core doesn't go through here
	 * -----------------------------------------
	 * tp-button-core uses a different wrapper-class scheme
	 * (`nxt-button-core-global`, no per-key suffix). `fix_tp_button_core_global_class_in_blocks()`
	 * already handles its specific edge cases.
	 *
	 * Idempotent across re-imports.
	 *
	 * @param array $blocks Parsed block tree.
	 * @return array Block tree with `attrs.className` extended on qualifying blocks.
	 */
	protected function remap_button_preset_class_to_slug_in_blocks( array $blocks ) {
		foreach ( $blocks as &$block ) {
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->remap_button_preset_class_to_slug_in_blocks( $block['innerBlocks'] );
			}

			$name = isset( $block['blockName'] ) ? $block['blockName'] : '';
			if ( 'tpgb/tp-button' !== $name && 'tpgb/tp-advanced-buttons' !== $name ) {
				continue;
			}

			$attrs = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
			if (
				empty( $attrs['useGlobalButtonSettings'] ) ||
				empty( $attrs['selectedButtonPreset'] ) ||
				! is_string( $attrs['selectedButtonPreset'] )
			) {
				continue;
			}
			$preset_key = $attrs['selectedButtonPreset'];

			// Derive the preset slug from any preset-namespaced CSS var ref in attrs
			// (same pattern as extract_button_preset_slug_map()).
			$attrs_json = wp_json_encode( $attrs );
			if ( ! is_string( $attrs_json ) ) {
				continue;
			}
			if ( ! preg_match(
				'/--tpgb-btnpreset-([a-z][a-z0-9-]*)-(?:bTypo|btColor|bthColor|btBg|bthBg|bBord|bthBColor|brad|btPad|btshadow|bthShadow|tShadow)/',
				$attrs_json,
				$slug_match
			) ) {
				continue;
			}
			$slug = $slug_match[1];

			// tp-button (and tp-advanced-buttons) are SERVER-SIDE RENDERED — their
			// render_callback in TPGB ignores the static innerHTML/innerContent
			// in the block comment and builds fresh HTML at render time from
			// block attributes. The wrapper class is composed via
			// Tp_Blocks_Helper::block_wrapper_classes() which reads exactly
			// one source for custom classes: `attributes['className']`.
			//
			// So to land the preset wrapper class on the rendered element, we
			// have to inject it into the block's `className` attribute, NOT
			// rewrite the static HTML (the static HTML is dead weight that
			// only the editor preview consults).
			//
			// Two classes are needed for plus-global.css's preset rules to
			// match — the marker class `nxt-btn-global` and the slug-based
			// `nxt-btn-global-btnpreset-{slug}`:
			$required_classes = array(
				'nxt-btn-global',
				'nxt-btn-global-btnpreset-' . $slug,
			);

			$existing_class = isset( $attrs['className'] ) && is_string( $attrs['className'] )
				? $attrs['className']
				: '';

			// Strip any prior key-form class (e.g. "nxt-btn-global-btnpreset1")
			// that might be left over from an earlier import or from a
			// hand-edited template. Also strip prior slug-form occurrences so
			// we don't accumulate duplicates on re-import.
			$tokens = preg_split( '/\s+/', $existing_class, -1, PREG_SPLIT_NO_EMPTY );
			$keep   = array();
			foreach ( $tokens as $tok ) {
				if ( 'nxt-btn-global' === $tok ) {
					continue; // re-added below.
				}
				if ( 0 === strpos( $tok, 'nxt-btn-global-' ) ) {
					continue; // strip any stale key-form or slug-form variant.
				}
				$keep[] = $tok;
			}

			$merged = array_merge( $keep, $required_classes );
			$block['attrs']['className'] = implode( ' ', $merged );
		}
		unset( $block );
		return $blocks;
	}

	/**
	 * Fetch one download URL: replacement JSON (Elementor/Gutenberg export) or HTML/JSON with Gutenberg block markup.
	 *
	 * @param string $url            Download URL (same list as downloadUrls).
	 * @param string $fetch_builder  elementor | gutenberg | auto — from project-replacement flow.
	 * @return array|WP_Error Decoded JSON array or Gutenberg payload { _uich_webpage_gutenberg, markup }.
	 */
	protected function fetch_replacement_file_from_url( $url, $fetch_builder = 'auto' ) {
		$fetch_builder = $this->normalize_fetch_builder( $fetch_builder );

		$body = $this->fetch_raw_body_from_url( $url );
		if ( is_wp_error( $body ) ) {
			return $body;
		}

		$trim = trim( $body );
		$trim = preg_replace( '/^\xEF\xBB\xBF/', '', $trim );

		$decoded = json_decode( $trim, true );
		$json_ok = JSON_ERROR_NONE === json_last_error();

		if ( $json_ok && is_array( $decoded ) ) {
			return $decoded;
		}

		// Double-encoded JSON: outer value is a string holding the real export.
		if ( $json_ok && is_string( $decoded ) ) {
			$inner = json_decode( $decoded, true );
			if ( JSON_ERROR_NONE === json_last_error() && is_array( $inner ) ) {
				return $inner;
			}
		}

		if ( 'elementor' === $fetch_builder ) {
			$first = isset( $trim[0] ) ? $trim[0] : '';
			if ( '{' === $first || '[' === $first ) {
				return new WP_Error(
					'IMPORT_FETCH_INVALID_ELEMENTOR_JSON',
					__( 'Downloaded file looks like JSON but could not be parsed as Elementor page data.', 'uichemy' ),
					array( 'status' => 422 )
				);
			}
			return new WP_Error(
				'IMPORT_FETCH_NOT_ELEMENTOR_JSON',
				__( 'Elementor import expects JSON from this URL.', 'uichemy' ),
				array( 'status' => 422 )
			);
		}

		// auto: JSON-shaped body that did not decode to an array — do not scan for <!-- wp: inside strings.
		if ( 'auto' === $fetch_builder ) {
			$first = isset( $trim[0] ) ? $trim[0] : '';
			if ( '{' === $first || '[' === $first ) {
				return new WP_Error(
					'IMPORT_FETCH_INVALID_JSON',
					__( 'Downloaded file looks like JSON but could not be parsed as page data.', 'uichemy' ),
					array( 'status' => 422 )
				);
			}
		}

		$markup = $this->extract_gutenberg_markup_from_body( $body );
		if ( is_wp_error( $markup ) ) {
			return $markup;
		}

		return array(
			'_uich_webpage_gutenberg' => true,
			'markup'            => $markup,
		);
	}

	/**
	 * Run fetch only: fetch all URLs, store, apply globals. Does NOT create pages.
	 *
	 * @param string[] $download_urls List of download URLs.
	 * @param string   $project_id    Optional project ID for meta.
	 * @param array    $meta          Optional meta (e.g. generatedAt, pages).
	 * @param string   $fetch_builder elementor | gutenberg | auto (from REST `builder`).
	 * @return array|WP_Error { success, globals, files, meta }
	 */
	public function run_fetch_only( array $download_urls, $project_id = '', array $meta = array(), $fetch_builder = 'auto' ) {
		if ( empty( $download_urls ) ) {
			return new WP_Error(
				'IMPORT_FETCH_NO_FILES',
				__( 'No valid download URLs were found to fetch. downloadUrls must contain at least one URL string (flat array or grouped buckets of URL strings).', 'uichemy' ),
				array( 'status' => 400 )
			);
		}

		// This runs INLINE inside the fetch-replacement-json request (not the async
		// job runner), and it downloads every project file sequentially — each
		// wp_remote_get() alone allows up to 120s. On a default PHP install
		// (max_execution_time = 30) a handful of files reliably trips
		// "Maximum execution time of 30 seconds exceeded" inside cURL, which the
		// REST layer returns as WordPress's generic critical-error HTML — surfacing
		// in the import UI as a failed "Importing Site Content" step. Raise the limit
		// (and keep going if the client disconnects) exactly like run_import_job().
		$this->raise_execution_limit();
		if ( function_exists( 'ignore_user_abort' ) ) {
			ignore_user_abort( true );
		}

		$fetch_builder        = $this->normalize_fetch_builder( $fetch_builder );
		$globals_data         = null;
		$uichemy_globals_data = null;
		$files                = array();

		// Sort so globals.json is processed first (fetch and store globals before pages).
		$sorted = $this->sort_urls_globals_first( $download_urls );

		$total_files = count( $sorted );
		$done_files  = 0;
		$this->update_job_progress(
			array(
				'phase'   => 'download',
				'current' => 0,
				'total'   => $total_files,
			)
		);

		// Pull every file down in parallel first; the loop below then runs at
		// decode/DB speed instead of one API round-trip per file.
		$this->prefetch_replacement_bodies( $sorted );

		foreach ( $sorted as $url ) {
			$decoded = $this->fetch_replacement_file_from_url( $url, $fetch_builder );
			if ( is_wp_error( $decoded ) ) {
				return $decoded;
			}

			$filename = $this->replacement_filename_from_url( $url );

			++$done_files;
			$this->update_job_progress(
				array(
					'phase'   => 'download',
					'current' => $done_files,
					'total'   => $total_files,
					'label'   => $filename,
				)
			);

			if ( 'globals.json' === strtolower( $filename ) && is_array( $decoded ) && empty( $decoded['_uich_webpage_gutenberg'] ) ) {
				$globals_data = $decoded;
			}

			if ( 'uichemy-globals.json' === strtolower( $filename ) && is_array( $decoded ) && empty( $decoded['_uich_webpage_gutenberg'] ) ) {
				if ( isset( $decoded['metadata']['uichemy_composer_site_custom_code'] ) && is_array( $decoded['metadata']['uichemy_composer_site_custom_code'] ) ) {
					$uichemy_globals_data = $decoded['metadata']['uichemy_composer_site_custom_code'];
				}
			}

			$files[ $filename ] = $decoded;
		}

		$this->prefetched_bodies = array();

		$this->update_job_progress(
			array(
				'phase'   => 'process',
				'current' => $total_files,
				'total'   => $total_files,
			)
		);

		// Store all replacement data (pages, navbar, footer, etc.) for use in page content.
		update_option( self::OPTION_REPLACEMENT_DATA, $files, false );

		if ( null !== $globals_data ) {
			update_option( self::OPTION_GLOBALS, $globals_data, false );
		}

		if ( null !== $uichemy_globals_data ) {
			update_option( self::OPTION_UICHEMY_GLOBALS, $uichemy_globals_data, false );
		}

		// Computed here (fetch phase, builder-agnostic) rather than inside apply_globals_to_elementor(),
		// since that function only runs for the Elementor-shaped branch — Gutenberg/TPGB kits use the
		// same globals.json "typography" section but take the apply_globals_to_tpgb_block_editor() branch.
		$body_font_family = null !== $globals_data ? $this->extract_majority_font_family_from_globals( $globals_data ) : '';

		// Also computed here rather than at finalize time, same reason as bodyFontFamily above:
		// used by Uich_Webpage_Nexter_Settings to decide whether to disable the theme's WooCommerce
		// CSS, which must stay enabled if the kit actually needs WooCommerce.
		$requires_woocommerce = false;
		if ( null !== $globals_data ) {
			foreach ( $this->extract_required_plugins_from_globals( $globals_data ) as $plugin_name ) {
				if ( false !== stripos( $plugin_name, 'woocommerce' ) ) {
					$requires_woocommerce = true;
					break;
				}
			}
		}

		$import_meta = array_merge(
			array(
				'projectId'         => $project_id,
				'importedAt'        => current_time( 'c' ),
				'filesCount'        => count( $files ),
				'hasGlobals'        => null !== $globals_data,
				'hasUiChemyGlobals' => null !== $uichemy_globals_data,
			),
			$meta,
			array(
				'fetchBuilder'        => $fetch_builder,
				'bodyFontFamily'      => $body_font_family,
				'requiresWooCommerce' => $requires_woocommerce,
			)
		);
		update_option( self::OPTION_IMPORT_META, $import_meta, false );

		// Keep Settings -> General in sync with whichever project was just imported,
		// including re-imports of a different project over an existing site.
		if ( ! empty( $import_meta['projectName'] ) ) {
			update_option( 'blogname', sanitize_text_field( $import_meta['projectName'] ) );
		}

		$tagline = '';
		if ( ! empty( $import_meta['tagline'] ) ) {
			$tagline = $import_meta['tagline'];
		}
		if ( ! empty( $tagline ) && is_string( $tagline ) ) {
			update_option( 'blogdescription', sanitize_text_field( $tagline ) );
		}

		/*
		 * From here to the end is the slow half of the fetch — plugin installs,
		 * image downloads, kit writes — and it used to run without reporting a
		 * thing. The heartbeat was written for the download loop only, so a job
		 * that had finished downloading went silent for however long this took;
		 * past JOB_STALL_SECONDS the client declared the worker dead and failed a
		 * run that was healthy and went on to complete. Every step below that can
		 * outlast that window now says so.
		 */
		if ( null !== $globals_data ) {
			$this->ensure_required_plugins_from_globals( $globals_data );
			$this->update_job_progress( array( 'phase' => 'apply_globals' ) );
			if ( $this->globals_json_is_tpgb_block_format( $globals_data ) ) {
				$btn_key_map = $this->extract_button_preset_slug_map( $files );
				$this->apply_globals_to_tpgb_block_editor( $globals_data, $btn_key_map );
			} else {
				$this->ensure_elementor_kit_exists();
				$this->apply_globals_to_elementor( $globals_data );
			}
		}

		// Ensure TPGB has at least a minimal valid preset structure so blocks
		// referencing global tokens don't render with empty values on fresh installs.
		$this->maybe_initialize_tpgb_global_options();

		// Import Elementor library templates (e.g. pricing-monthly.json) now — once, during the
		// fetch phase — so the old→new template ID map is persisted to the database before any
		// import-single-page REST call runs. Regular pages (Home, About, etc.) read this map
		// after creation to remap widget references such as tp-switcher's content_a_template /
		// content_b_template that point to the source-site post IDs.
		delete_option( self::OPTION_TEMPLATE_ID_MAP ); // always start fresh.
		$this->update_job_progress( array( 'phase' => 'import_templates' ) );
		$tpl_result = $this->import_elementor_library_templates( $files, $import_meta );
		if ( ! empty( $tpl_result['id_map'] ) ) {
			update_option( self::OPTION_TEMPLATE_ID_MAP, $tpl_result['id_map'], false );
		}

		// Scan JSON for TPAE widget/extension lists (for enable-widgets). Must not fail fetch:
		// library templates + template ID map are already persisted above.
		$widget_list     = array();
		$extensions_list = array();
		$block_list      = array();
		$this->update_job_progress( array( 'phase' => 'scan_widgets' ) );
		try {
			$widget_list     = array_values( $this->collect_all_widgets_from_files( $files ) );
			$extensions_list = array_values( $this->collect_all_tpae_extensions_from_files( $files ) );
		} catch ( \Throwable $e ) {
			if ( function_exists( 'error_log' ) ) {
				error_log( 'UiChemy: collect widget/extension lists failed ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			}
			$api = new Uich_Webpage_Api();
			$api->report_error( 'IMPORT_WIDGET_COLLECTION_DEGRADED', array( 'message' => $e->getMessage(), 'source' => 'uichemy-webpage', 'level' => 'warning', 'stack' => $e->getTraceAsString() ) );
		}
		try {
			$block_list = array_values(
				array_unique(
					array_merge(
						$this->collect_all_blocks_from_files( $files ),
						$this->collect_gutenberg_blocks_from_replacement_files( $files )
					)
				)
			);
		} catch ( \Throwable $e ) {
			if ( function_exists( 'error_log' ) ) {
				error_log( 'UiChemy: collect block list failed ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			}
			$api = new Uich_Webpage_Api();
			$api->report_error( 'IMPORT_BLOCK_COLLECTION_DEGRADED', array( 'message' => $e->getMessage(), 'source' => 'uichemy-webpage', 'level' => 'warning', 'stack' => $e->getTraceAsString() ) );
		}

		$this->update_job_progress( array( 'phase' => 'finishing' ) );

		// Match desired site layout: default Elementor content width 1240px (Site Settings → Layout).
		if ( 'gutenberg' !== $fetch_builder ) {
			$this->set_elementor_active_kit_content_width( 1240 );
		}

		$this->clear_elementor_files_cache();

		return array(
			'success'         => true,
			'globals'         => null !== $globals_data,
			'uichemyGlobals'  => null !== $uichemy_globals_data,
			'files'           => array_keys( $files ),
			'meta'            => $import_meta,
			'widget_list'     => $widget_list,
			'extensions_list' => $extensions_list,
			'block_list'      => $block_list,
		);
	}

	/**
	 * Run import pages only: create pages from stored replacement data.
	 *
	 * @param string $project_id Optional project ID for meta.
	 * @param array  $meta       Optional meta (e.g. pages). Merged with stored import meta.
	 * @return array|WP_Error { success, created_pages, warnings } with permalink for each page.
	 */
	public function run_import_pages_only( $project_id = '', array $meta = array() ) {
		$files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		if ( ! is_array( $files ) || empty( $files ) ) {
			return new WP_Error(
				'IMPORT_NO_STORED_DATA',
				__( 'No replacement data found. Run fetch-replacement-json first.', 'uichemy' ),
				array( 'status' => 400 )
			);
		}

		$stored_meta = get_option( self::OPTION_IMPORT_META, array() );
		$import_meta = array_merge(
			is_array( $stored_meta ) ? $stored_meta : array(),
			array( 'projectId' => $project_id ),
			$meta
		);

		$this->remove_hello_world_post();

		$pages_result  = $this->create_pages_from_import( $files, $import_meta );
		$created_pages = $pages_result['created'];
		$warnings      = $pages_result['warnings'];

		// Add permalink to each created page for Visit Site button.
		foreach ( $created_pages as &$page ) {
			$page['permalink'] = '';
			if ( ! empty( $page['post_id'] ) ) {
				$page['permalink'] = get_permalink( $page['post_id'] );
			}
		}

		// Set home page directly (WDesignKit approach): first page with "Home" or "Landing" in title.
		$this->set_home_page_from_created( $created_pages );

		// Import blog posts from blog-post-content.json (fetched via downloadUrls).
		$blog_posts_result = $this->import_blog_posts_from_json();

		// Inject category and tag IDs from created posts into blog template post listing widgets.
		$this->update_blog_template_post_listings( $blog_posts_result );

		// Enable TPAE widgets used in imported pages via WDesignKit hook.
		$widgets_result = $this->enable_widgets_from_files( $files );

		$this->clear_elementor_files_cache();

		if ( ! empty( $warnings ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error(
				'IMPORT_PAGES_PARTIAL',
				array(
					'message' => implode( ' | ', $warnings ),
					'source'  => 'uichemy-webpage',
					'level'   => 'warning',
				)
			);
		}

		return array(
			'success'        => true,
			'created_pages'  => $created_pages,
			'warnings'       => $warnings,
			'blog_posts'     => $blog_posts_result,
			'widgets_enable' => $widgets_result,
		);
	}

	/**
	 * Trash the default "Hello world!" post (ID 1) if it still exists.
	 * Called at the start of every import so the sample post is gone before new content lands.
	 */
	protected function remove_hello_world_post() {
		$hello_post = get_post( 1 );
		if ( ! $hello_post ) {
			return;
		}
		if ( 'post' !== $hello_post->post_type || 'Hello world!' !== $hello_post->post_title ) {
			return;
		}
		if ( 'trash' === $hello_post->post_status ) {
			return;
		}
		$result = wp_trash_post( 1 );
	}

	/**
	 * Import blog posts from dynamic blog-post-content.json stored in replacement data.
	 * Called automatically during run_import_pages_only so posts are always created alongside pages.
	 *
	 * @return array { created: int, posts: array, errors: array }
	 */
	protected function import_blog_posts_from_json() {
		$files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		if ( ! is_array( $files ) || empty( $files ) ) {
			return array(
				'created' => 0,
				'posts'   => array(),
				'errors'  => array( 'No replacement data found. Run fetch-replacement-json first.' ),
			);
		}

		// Find blog-post-content.json (case-insensitive) in stored replacement data.
		$filename = $this->find_file_key( $files, 'blog-post-content.json' );
		if ( null === $filename || ! isset( $files[ $filename ] ) || ! is_array( $files[ $filename ] ) ) {
			return array(
				'created' => 0,
				'posts'   => array(),
				'errors'  => array( 'blog-post-content.json not found in replacement data.' ),
			);
		}

		$data  = $files[ $filename ];

		// Pre-create/update categories and tags with description + thumbnail image BEFORE
		// creating posts, so that full term metadata is in place when posts are assigned.
		$categories_meta = isset( $data['categories'] ) && is_array( $data['categories'] ) ? $data['categories'] : array();
		$tags_meta       = isset( $data['tags'] ) && is_array( $data['tags'] ) ? $data['tags'] : array();
		if ( ! empty( $categories_meta ) ) {
			$this->import_terms_metadata( $categories_meta, 'category' );
		}
		if ( ! empty( $tags_meta ) ) {
			$this->import_terms_metadata( $tags_meta, 'post_tag' );
		}

		$posts = isset( $data['posts'] ) && is_array( $data['posts'] ) ? $data['posts'] : array();

		$created = array();
		$errors  = array();
		foreach ( $posts as $post_data ) {
			$result = $this->create_single_blog_post( $post_data );
			if ( $result && ! is_wp_error( $result ) ) {
				$created[] = $result;
			} elseif ( is_wp_error( $result ) ) {
				$errors[] = $result->get_error_message();
			}
		}

		return array(
			'created' => count( $created ),
			'posts'   => $created,
			'errors'  => $errors,
		);
	}

	/**
	 * Update blog template post listing widgets with category and tag IDs from created posts.
	 * Uses wp_get_post_categories / wp_get_post_tags on the posts we just created.
	 * Targets Nexter theme templates (Blog, Category Page, …), the Reading "Posts page" if set,
	 * and static pages titled "Blog Page" / "Blog" (filter: uich_webpage_blog_listing_page_titles).
	 *
	 * @param array $blog_posts_result Result from import_blog_posts_from_json: { created, posts, errors }.
	 */
	protected function update_blog_template_post_listings( array $blog_posts_result ) {
		$created_posts = isset( $blog_posts_result['posts'] ) && is_array( $blog_posts_result['posts'] ) ? $blog_posts_result['posts'] : array();
		$category_ids  = array();
		$tag_ids       = array();

		foreach ( $created_posts as $item ) {
			$post_id = isset( $item['post_id'] ) ? (int) $item['post_id'] : 0;
			if ( $post_id <= 0 ) {
				continue;
			}
			$cats = wp_get_post_categories( $post_id );
			if ( ! empty( $cats ) ) {
				$category_ids = array_merge( $category_ids, $cats );
			}
			$tags = wp_get_post_tags( $post_id );
			if ( ! empty( $tags ) ) {
				foreach ( $tags as $t ) {
					$tag_ids[] = (int) $t->term_id;
				}
			}
		}

		$category_ids = array_values( array_unique( array_map( 'intval', $category_ids ) ) );
		$tag_ids      = array_values( array_unique( $tag_ids ) );

		if ( empty( $category_ids ) && empty( $tag_ids ) ) {
			return;
		}

		// Build label→ID maps for Gutenberg tpgb/tp-post-listing attribute updates.
		$cat_label_to_id = $this->build_term_label_id_map( $category_ids, 'category' );
		$tag_label_to_id = $this->build_term_label_id_map( $tag_ids, 'post_tag' );

		$templates_to_update = array();

		// nxt_builder blog templates.
		$theme_titles = array( 'Blog', 'Blog Detail Page', 'Category Page', 'Tag Featured Page', 'Author Page', 'Search Results Page' );
		foreach ( $theme_titles as $title ) {
			$posts = get_posts(
				array(
					'post_type'      => 'nxt_builder',
					'post_status'    => 'any',
					'posts_per_page' => 1,
					'title'          => $title,
				)
			);
			if ( ! empty( $posts ) ) {
				$templates_to_update[] = $posts[0]->ID;
			}
		}

		// Posts page when set in Settings > Reading.
		$page_for_posts = (int) get_option( 'page_for_posts', 0 );
		if ( $page_for_posts > 0 ) {
			$templates_to_update[] = $page_for_posts;
		}

		// Imported blog listing pages (static Elementor pages; may not be assigned as Posts page or Posts archive).
		$blog_listing_titles = apply_filters(
			'uich_webpage_blog_listing_page_titles',
			// Default titles cover common blog/archive landing pages where a post listing widget lives.
			// Sites can further customize via the uich_webpage_blog_listing_page_titles filter.
			array( 'Blog Page', 'Blog', 'Home', 'Home Page', 'Homepage' )
		);
		if ( is_array( $blog_listing_titles ) ) {
			foreach ( $blog_listing_titles as $blog_title ) {
				if ( ! is_string( $blog_title ) || '' === $blog_title ) {
					continue;
				}
				$blog_page = $this->get_post_by_exact_title( $blog_title, 'page' );
				if ( $blog_page instanceof WP_Post ) {
					$templates_to_update[] = (int) $blog_page->ID;
				}
			}
		}

		// Additionally, dynamically detect Elementor pages that contain a supported post listing widget
		// (e.g. "tp-blog-listout"), so users don't have to rely on specific page titles.
		$post_widgets = apply_filters( 'uich_webpage_post_listing_widget_types', array( 'tp-blog-listout' ) );
		if ( ! empty( $post_widgets ) && is_array( $post_widgets ) ) {
			$like_fragments = array();
			foreach ( $post_widgets as $w ) {
				if ( is_string( $w ) && '' !== $w ) {
					$like_fragments[] = $w;
				}
			}

			if ( ! empty( $like_fragments ) ) {
				$meta_query = array( 'relation' => 'OR' );
				foreach ( $like_fragments as $frag ) {
					$meta_query[] = array(
						'key'     => '_elementor_data',
						'value'   => $frag,
						'compare' => 'LIKE',
					);
				}

				$dynamic_listing_pages = get_posts(
					array(
						'post_type'      => 'page',
						'post_status'    => 'any',
						'posts_per_page' => -1,
						'fields'         => 'ids',
						'meta_query'     => $meta_query,
					)
				);

				if ( ! empty( $dynamic_listing_pages ) ) {
					foreach ( $dynamic_listing_pages as $page_id ) {
						$templates_to_update[] = (int) $page_id;
					}
				}
			}
		}

		foreach ( array_unique( $templates_to_update ) as $post_id ) {
			$raw = get_post_meta( $post_id, '_elementor_data', true );
			if ( empty( $raw ) ) {
				continue;
			}
			$content = json_decode( $raw, true );
			if ( ! is_array( $content ) ) {
				continue;
			}
			$this->update_post_widget_query( $content, $category_ids, $tag_ids );
			$content = $this->ensure_elementor_ids_are_strings( $content );
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $content ) ) );
		}

		// Update Gutenberg tpgb/tp-post-listing blocks in post_content for pages that use the block editor.
		if ( ! empty( $cat_label_to_id ) || ! empty( $tag_label_to_id ) ) {
			foreach ( array_unique( $templates_to_update ) as $post_id ) {
				$post_obj = get_post( $post_id );
				if ( ! $post_obj || empty( $post_obj->post_content ) ) {
					continue;
				}
				if ( strpos( $post_obj->post_content, 'wp:tpgb/tp-post-listing' ) === false ) {
					continue;
				}
				$new_content = $this->update_tpgb_post_listing_categories_in_content(
					$post_obj->post_content,
					$cat_label_to_id,
					$tag_label_to_id
				);
				if ( $new_content !== $post_obj->post_content ) {
					wp_update_post(
						array(
							'ID'           => $post_id,
							'post_content' => wp_slash( $new_content ),
						)
					);
				}
			}
		}
	}

	/**
	 * Update post listing widgets in Elementor content with category and tag IDs.
	 *
	 * @param array $elements     Elementor elements (passed by reference).
	 * @param array $category_ids Category term IDs.
	 * @param array $tag_ids      Tag term IDs.
	 */
	protected function update_post_widget_query( &$elements, $category_ids, $tag_ids = array() ) {
		foreach ( $elements as &$el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}

			if ( ! empty( $el['elType'] ) && 'widget' === $el['elType'] ) {
				$widget_type  = isset( $el['widgetType'] ) ? $el['widgetType'] : '';
				$post_widgets = apply_filters( 'uich_webpage_post_listing_widget_types', array( 'tp-blog-listout' ) );
				if ( in_array( $widget_type, $post_widgets, true ) ) {
					if ( ! isset( $el['settings'] ) ) {
						$el['settings'] = array();
					}
					$el['settings']['post_category'] = $category_ids;
					$el['settings']['post_tags']     = $tag_ids;
				}
			}

			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				$this->update_post_widget_query( $el['elements'], $category_ids, $tag_ids );
			}
		}
	}

	/**
	 * Build a map of term name → term ID for a list of term IDs.
	 *
	 * @param int[]  $term_ids IDs to look up.
	 * @param string $taxonomy Taxonomy slug ('category', 'post_tag', …).
	 * @return array Map: term name (string) => term ID (int).
	 */
	protected function build_term_label_id_map( array $term_ids, $taxonomy ) {
		$map = array();
		foreach ( $term_ids as $id ) {
			$term = get_term( (int) $id, $taxonomy );
			if ( $term && ! is_wp_error( $term ) ) {
				$map[ $term->name ] = (int) $id;
			}
		}
		return $map;
	}

	/**
	 * Update postCategory / postTags attributes inside tpgb/tp-post-listing block comments.
	 *
	 * The Gutenberg block stores these as JSON-encoded strings like
	 * '[{"value":67,"label":"Digital Insights"}]'. This method replaces the `value`
	 * (term ID) for each entry whose `label` matches an entry in the provided maps,
	 * so the block queries the correct terms on the target site after import.
	 *
	 * @param string $content         Gutenberg post_content with block markup.
	 * @param array  $cat_label_to_id Map: category name => new category ID.
	 * @param array  $tag_label_to_id Map: tag name => new tag ID.
	 * @return string Updated post_content (unchanged if no blocks were modified).
	 */
	protected function update_tpgb_post_listing_categories_in_content( $content, array $cat_label_to_id, array $tag_label_to_id ) {
		if ( ! function_exists( 'parse_blocks' ) || ! function_exists( 'serialize_blocks' ) ) {
			return $content;
		}
		$blocks  = parse_blocks( $content );
		$changed = false;
		$this->update_tpgb_post_listing_blocks_recursive( $blocks, $cat_label_to_id, $tag_label_to_id, $changed );
		if ( $changed ) {
			return serialize_blocks( $blocks );
		}
		return $content;
	}

	/**
	 * Recursively walk blocks and update tpgb/tp-post-listing term attributes.
	 *
	 * @param array  $blocks          Parsed blocks (modified in place via reference).
	 * @param array  $cat_label_to_id Map: category name => category ID.
	 * @param array  $tag_label_to_id Map: tag name => tag ID.
	 * @param bool   $changed         Set to true if any attribute was modified.
	 */
	protected function update_tpgb_post_listing_blocks_recursive( array &$blocks, array $cat_label_to_id, array $tag_label_to_id, &$changed ) {
		foreach ( $blocks as &$block ) {
			if ( 'tpgb/tp-post-listing' === ( isset( $block['blockName'] ) ? $block['blockName'] : '' ) ) {
				$this->update_tpgb_post_listing_block_terms( $block, $cat_label_to_id, $tag_label_to_id, $changed );
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$this->update_tpgb_post_listing_blocks_recursive( $block['innerBlocks'], $cat_label_to_id, $tag_label_to_id, $changed );
			}
		}
		unset( $block );
	}

	/**
	 * Update the postCategory and postTags attributes of a single tpgb/tp-post-listing block.
	 *
	 * @param array  $block           Parsed block (modified in place via reference).
	 * @param array  $cat_label_to_id Map: category name => category ID.
	 * @param array  $tag_label_to_id Map: tag name => tag ID.
	 * @param bool   $changed         Set to true if any attribute was modified.
	 */
	protected function update_tpgb_post_listing_block_terms( array &$block, array $cat_label_to_id, array $tag_label_to_id, &$changed ) {
		// postCategory is stored as a JSON-encoded string: '[{"value":67,"label":"Digital Insights"}]'.
		if ( ! empty( $cat_label_to_id ) && isset( $block['attrs']['postCategory'] ) && is_string( $block['attrs']['postCategory'] ) ) {
			$cats        = json_decode( $block['attrs']['postCategory'], true );
			$has_unmatched = false;
			if ( is_array( $cats ) ) {
				foreach ( $cats as &$cat ) {
					$label = isset( $cat['label'] ) ? (string) $cat['label'] : '';
					if ( '' !== $label && isset( $cat_label_to_id[ $label ] ) ) {
						$cat['value'] = $cat_label_to_id[ $label ];
					} else {
						$has_unmatched = true;
					}
				}
				unset( $cat );
				if ( $has_unmatched ) {
					// Source labels don't match destination; use all imported categories.
					$cats = array();
					foreach ( $cat_label_to_id as $label => $id ) {
						$cats[] = array( 'value' => $id, 'label' => $label );
					}
				}
				$block['attrs']['postCategory'] = wp_json_encode( $cats );
				$changed = true;
			}
		}

		// postTag — set even when the attribute is absent from the block comment (default "[]" is
		// not serialized by Gutenberg, so parse_blocks won't have it in attrs).
		if ( ! empty( $tag_label_to_id ) ) {
			$tags = array();
			if ( isset( $block['attrs']['postTag'] ) && is_string( $block['attrs']['postTag'] ) ) {
				$decoded = json_decode( $block['attrs']['postTag'], true );
				if ( is_array( $decoded ) ) {
					$tags = $decoded;
				}
			}

			$has_unmatched = false;
			foreach ( $tags as &$tag ) {
				$label = isset( $tag['label'] ) ? (string) $tag['label'] : '';
				if ( '' !== $label && isset( $tag_label_to_id[ $label ] ) ) {
					$tag['value'] = $tag_label_to_id[ $label ];
				} else {
					$has_unmatched = true;
				}
			}
			unset( $tag );

			if ( $has_unmatched || empty( $tags ) ) {
				// Labels didn't match or attribute was empty/missing — use all imported tags.
				$tags = array();
				foreach ( $tag_label_to_id as $label => $id ) {
					$tags[] = array( 'value' => $id, 'label' => $label );
				}
			}

			$block['attrs']['postTag'] = wp_json_encode( $tags );
			$changed = true;
		}
	}

	/**
	 * Set WordPress front page to the first created page with "Home" or "Landing" in title.
	 * Mirrors WDesignKit: update_option( 'show_on_front', 'page' ) and update_option( 'page_on_front', $id ).
	 *
	 * @param array $created_pages List of { post_id, title, filename }.
	 */
	protected function set_home_page_from_created( array $created_pages ) {
		$home_page_id = null;
		$title_lower  = '';

		foreach ( $created_pages as $page ) {
			$title = isset( $page['title'] ) ? $page['title'] : '';
			if ( empty( $title ) || empty( $page['post_id'] ) ) {
				continue;
			}
			$title_lower = strtolower( $title );
			if ( strpos( $title_lower, 'home' ) !== false || strpos( $title_lower, 'landing' ) !== false ) {
				$home_page_id = (int) $page['post_id'];
				break;
			}
		}

		if ( $home_page_id > 0 ) {
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $home_page_id );
		}
	}

	/**
	 * Run import: fetch all URLs, then apply globals and store replacement data.
	 *
	 * Order: fetch globals.json first so globals are available for page content;
	 * then fetch and store all files.
	 *
	 * @param string[] $download_urls List of download URLs.
	 * @param string   $project_id    Optional project ID for meta.
	 * @param array    $meta          Optional meta (e.g. generatedAt, pages).
	 * @param string   $fetch_builder elementor | gutenberg | auto.
	 * @return array|WP_Error { success, globals, files, meta }
	 */
	public function run_import( array $download_urls, $project_id = '', array $meta = array(), $fetch_builder = 'auto' ) {
		$fetch_result = $this->run_fetch_only( $download_urls, $project_id, $meta, $fetch_builder );
		if ( is_wp_error( $fetch_result ) ) {
			return $fetch_result;
		}

		$import_result = $this->run_import_pages_only( $project_id, $meta );
		if ( is_wp_error( $import_result ) ) {
			return $import_result;
		}

		return array_merge( $fetch_result, $import_result );
	}

	/**
	 * Find file key in $files by case-insensitive filename (API may return Home.json, navbar.json, footer.json).
	 *
	 * @param array  $files   Map of filename => decoded JSON.
	 * @param string $wanted  Filename to find (e.g. "Home.json", "footer.json").
	 * @return string|null The actual key from $files, or null if not found.
	 */
	protected function find_file_key( array $files, $wanted ) {
		$wanted_lower = strtolower( $wanted );
		foreach ( array_keys( $files ) as $f ) {
			if ( strtolower( $f ) === $wanted_lower ) {
				return $f;
			}
		}
		return null;
	}

	/**
	 * Normalize pages list so each entry is array( 'pageName' => string ).
	 * API may send array of strings ("Home") or objects with pageName / name / title.
	 *
	 * @param array $pages Raw pages from meta.
	 * @return array List of array( 'pageName' => string ).
	 */
	protected function normalize_pages_list( array $pages ) {
		$out = array();
		foreach ( $pages as $item ) {
			$name = '';
			if ( is_string( $item ) ) {
				$name = trim( $item );
			} elseif ( is_array( $item ) ) {
				if ( ! empty( $item['pageName'] ) && is_string( $item['pageName'] ) ) {
					$name = trim( $item['pageName'] );
				} elseif ( ! empty( $item['name'] ) && is_string( $item['name'] ) ) {
					$name = trim( $item['name'] );
				} elseif ( ! empty( $item['title'] ) && is_string( $item['title'] ) ) {
					$name = trim( $item['title'] );
				}
			}
			if ( '' !== $name ) {
				$out[] = array( 'pageName' => $name );
			}
		}
		return $out;
	}

	/**
	 * List JSON filenames (lowercase) for Elementor library-only imports from meta.elementor_template.
	 *
	 * Accepts URLs or bare filenames; supports meta nested under `meta`.
	 *
	 * @param array $import_meta Import meta from API / stored option.
	 * @return string[] Unique filenames e.g. array( 'pricing-monthly.json' ).
	 */
	protected function get_elementor_template_filenames_from_meta( array $import_meta ) {
		$raw = null;
		if ( ! empty( $import_meta['elementor_template'] ) && is_array( $import_meta['elementor_template'] ) ) {
			$raw = $import_meta['elementor_template'];
		} elseif ( ! empty( $import_meta['meta'] ) && is_array( $import_meta['meta'] ) && ! empty( $import_meta['meta']['elementor_template'] ) && is_array( $import_meta['meta']['elementor_template'] ) ) {
			$raw = $import_meta['meta']['elementor_template'];
		}
		if ( empty( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $item ) {
			if ( ! is_string( $item ) ) {
				continue;
			}
			$item = trim( $item );
			if ( '' === $item ) {
				continue;
			}
			if ( preg_match( '#^https?://#i', $item ) || 0 === strpos( $item, '//' ) ) {
				$name = $this->replacement_filename_from_url( $item );
			} else {
				$name = basename( $item );
			}
			if ( '' === $name || '.json' !== strtolower( substr( $name, -5 ) ) ) {
				continue;
			}
			$out[] = strtolower( $name );
		}
		return array_values( array_unique( $out ) );
	}

	/**
	 * Human-readable template title from stored filename (e.g. pricing-monthly.json → Pricing Monthly).
	 *
	 * @param string $filename File key in replacement data (may include spaces).
	 * @return string
	 */
	protected function title_from_elementor_template_filename( $filename ) {
		$base = pathinfo( (string) $filename, PATHINFO_FILENAME );
		$base = str_replace( array( '-', '_' ), ' ', $base );
		return ucwords( $base );
	}

	/**
	 * Extract the source-site post ID from an Elementor template JSON.
	 *
	 * The UiChemy API embeds the original post ID as content[0].page_id (integer).
	 * Example: pricing-monthly.json → content[0].page_id = 47951.
	 *
	 * Static page files (e.g. Home.json) have no page_id in content[0] and
	 * will correctly return null, so they are never added to the id_map.
	 *
	 * Fallbacks cover alternative API shapes that may appear in future exports:
	 *   - Root-level integer 'id' key.
	 *   - Root-level 'source_id' key.
	 *
	 * @param mixed $data Decoded JSON for a single template file.
	 * @return int|null Source post ID, or null if not present / not a template.
	 */
	protected function extract_source_template_id( $data ) {
		if ( ! is_array( $data ) ) {
			return null;
		}

		// Primary: root-level page_id — format used by single template files (e.g. pricing-table-x2-monthly.json).
		if (
			isset( $data['page_id'] ) &&
			is_numeric( $data['page_id'] ) &&
			(int) $data['page_id'] > 0
		) {
			return (int) $data['page_id'];
		}

		// Secondary: content[0].page_id — older export format where the ID was nested.
		if (
			isset( $data['content'] ) &&
			is_array( $data['content'] ) &&
			isset( $data['content'][0]['page_id'] ) &&
			is_numeric( $data['content'][0]['page_id'] ) &&
			(int) $data['content'][0]['page_id'] > 0
		) {
			return (int) $data['content'][0]['page_id'];
		}

		// Fallback: root-level integer id (not a hex element id).
		if ( isset( $data['id'] ) && is_int( $data['id'] ) && $data['id'] > 0 ) {
			return $data['id'];
		}

		// Fallback: explicit source_id key.
		if (
			isset( $data['source_id'] ) &&
			is_numeric( $data['source_id'] ) &&
			(int) $data['source_id'] > 0
		) {
			return (int) $data['source_id'];
		}

		return null;
	}

	/**
	 * Import Elementor library templates (saved templates) from JSON files listed in meta.elementor_template.
	 *
	 * Also builds an old→new ID map so callers can rewrite stale source-site template
	 * IDs inside page content after all templates have been imported.
	 *
	 * @param array $files       Map of filename => decoded JSON.
	 * @param array $import_meta Meta containing elementor_template URL list.
	 * @return array {
	 *     created: array<array{ post_id: int, title: string, filename: string }>,
	 *     id_map:  array<int, int>  old_source_id => new_wp_post_id
	 * }
	 */
	protected function import_elementor_library_templates( array $files, array $import_meta ) {
		$filenames = $this->get_elementor_template_filenames_from_meta( $import_meta );
		if ( empty( $filenames ) ) {
			return array(
				'created' => array(),
				'id_map'  => array(),
			);
		}

		$created = array();
		$id_map  = array(); // old_source_id (int) => new_wp_post_id (int).

		$tpl_total = count( $filenames );
		$tpl_done  = 0;

		foreach ( $filenames as $fn_lower ) {
			// Creating a template resolves its assets, which downloads every image
			// it references — the single slowest thing in the fetch phase.
			++$tpl_done;
			$this->update_job_progress(
				array(
					'phase'   => 'import_templates',
					'current' => $tpl_done,
					'total'   => $tpl_total,
				)
			);

			$found = $this->find_file_key( $files, $fn_lower );
			if ( null === $found || ! isset( $files[ $found ] ) ) {
				continue;
			}
			$data = $files[ $found ];
			if ( $this->is_gutenberg_replacement_data( $data ) ) {
				continue;
			}

			// Capture source ID BEFORE content extraction strips the document wrapper.
			$source_id = $this->extract_source_template_id( $data );

			$title   = $this->title_from_elementor_template_filename( $found );
			$post_id = $this->create_or_update_elementor_template( $title, $data, 'page', array() );

			if ( $post_id && ! is_wp_error( $post_id ) ) {
				$created[] = array(
					'post_id'  => $post_id,
					'title'    => $title,
					'filename' => $found,
				);
				if ( null !== $source_id && $source_id !== $post_id ) {
					$id_map[ $source_id ] = $post_id;
				}

				// Activate widgets used inside this library template.
				$this->enable_widgets_for_single_file( $data );
			}
		}

		return array(
			'created' => $created,
			'id_map'  => $id_map,
		);
	}

	/**
	 * Rewrite stale source-site template IDs in all imported pages' Elementor data.
	 *
	 * When Elementor library templates are imported they receive new local WordPress
	 * post IDs. Pages that reference those templates still carry the original
	 * source-site IDs in widget settings and will render blank until remapped.
	 *
	 * Setting keys remapped (confirmed from actual UiChemy export JSON):
	 *   - content_a_template, content_b_template  — tp-switcher (value is a numeric STRING)
	 *   - templateId                               — global-widget (int or string)
	 *   - popup_id                                 — tp-popup
	 *   - offcanvas_id                             — tp-off-canvas
	 *   - template_id                              — generic fallback
	 *   - any key ending with '_template'          — catches future widget keys automatically
	 *
	 * Both string and integer representations of the source ID are matched.
	 * The original value type is preserved in the output (string stays string, int stays int).
	 *
	 * @param array $created_pages List of { post_id, title, filename }.
	 * @param array $id_map        Map: old_source_id (int) => new_wp_post_id (int).
	 */
	protected function remap_template_ids_in_pages( array $created_pages, array $id_map ) {

	if ( empty( $id_map ) || empty( $created_pages ) ) {
		return;
	}

	foreach ( $created_pages as $page ) {

		$post_id = isset( $page['post_id'] ) ? (int) $page['post_id'] : 0;

		if ( $post_id <= 0 ) {
			continue;
		}

		$raw = get_post_meta( $post_id, '_elementor_data', true );

		if ( empty( $raw ) ) {
			continue;
		}

		$content = json_decode( $raw, true );

		if ( ! is_array( $content ) ) {
			continue;
		}

		$changed = $this->remap_template_ids_recursive( $content, $id_map );

		if ( $changed ) {

			$content = $this->ensure_elementor_ids_are_strings( $content );

			update_post_meta(
				$post_id,
				'_elementor_data',
				wp_slash( wp_json_encode( $content ) )
			);
		}
	}
}

	/**
	 * Recursively walk Elementor element tree and remap template ID values.
	 *
	 * Only inspects widget settings (elType === 'widget'); containers and sections
	 * never hold template references so they are skipped for performance.
	 * Recurses into 'elements' at every depth to reach nested widgets.
	 *
	 * @param array    $elements     Elementor elements array (passed by reference).
	 * @param array    $id_map       old_source_id (int) => new_wp_post_id (int).
	 * @param string[] $exact_keys   Exact setting key names to remap.
	 * @param string   $suffix_match Any setting key ending with this suffix is also remapped.
	 * @param bool     $changed      Passed by reference; set to true when any replacement is made.
	 */
	protected function remap_template_ids_recursive( &$data, $template_id_map ) {

	if ( ! is_array( $data ) ) {
		return false;
	}

	$changed = false;

	foreach ( $data as $key => &$value ) {

		// Recursive arrays
		if ( is_array( $value ) ) {

			if ( $this->remap_template_ids_recursive( $value, $template_id_map ) ) {
				$changed = true;
			}

			continue;
		}

		// Match template reference keys:
		// - content_template (generic)
		// - content_a_template, content_b_template (tp-switcher)
		// - any key ending with _template (future widgets)
		$is_template_key = 'content_template' === $key
			|| 'content_a_template' === $key
			|| 'content_b_template' === $key
			|| 'popup_id' === $key
			|| 'offcanvas_id' === $key
			|| 'template_id' === $key
			|| ( strlen( $key ) > 9 && '_template' === substr( $key, -9 ) );

		if ( ! $is_template_key ) {
			continue;
		}

		$old_template_id = (string) $value;

		if ( isset( $template_id_map[ $old_template_id ] ) ) {

			$value   = (string) $template_id_map[ $old_template_id ];
			$changed = true;
		}
	}

	return $changed;
}

	/**
	 * Normalize a nav menu label for comparison (e.g. filterlabel vs page title).
	 *
	 * @param string $label Raw label from JSON or WordPress.
	 * @return string Lowercased trimmed text.
	 */
	protected function normalize_nav_menu_filterlabel( $label ) {
		return strtolower( trim( wp_strip_all_tags( (string) $label ) ) );
	}

	/**
	 * Build map filterlabel => permalink from pages just created in this import batch.
	 * Skips navbar/footer JSON rows so template posts are not treated as nav targets.
	 *
	 * @param array $created_pages List of { post_id, title, filename? }.
	 * @return array<string, string>
	 */
	protected function build_nav_menu_filterlabel_permalink_map_from_created( array $created_pages ) {
		$map = array();
		foreach ( $created_pages as $row ) {
			if ( empty( $row['post_id'] ) || empty( $row['title'] ) ) {
				continue;
			}
			if ( ! empty( $row['filename'] ) ) {
				$fl = strtolower( (string) $row['filename'] );
				if ( 'navbar.json' === $fl || 'footer.json' === $fl ) {
					continue;
				}
			}
			$key = $this->normalize_nav_menu_filterlabel( $row['title'] );
			if ( '' === $key ) {
				continue;
			}
			$map[ $key ] = get_permalink( (int) $row['post_id'] );
		}
		return $map;
	}

	/**
	 * Build map page title => permalink for all published pages (fallback when batch list is empty).
	 *
	 * @return array<string, string>
	 */
	protected function build_nav_menu_filterlabel_permalink_map_from_wp_pages() {
		$map   = array();
		$pages = get_posts(
			array(
				'post_type'              => 'page',
				'post_status'            => 'publish',
				'posts_per_page'         => -1,
				'orderby'                => 'title',
				'order'                  => 'ASC',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);
		foreach ( $pages as $p ) {
			if ( ! $p instanceof WP_Post ) {
				continue;
			}
			$key = $this->normalize_nav_menu_filterlabel( $p->post_title );
			if ( '' === $key ) {
				continue;
			}
			if ( ! isset( $map[ $key ] ) ) {
				$map[ $key ] = get_permalink( $p );
			}
		}
		return $map;
	}

	/**
	 * Set LinkFilter.url on tp-navigation-menu-lite (and similar) ItemMenu rows when filterlabel matches a page title.
	 *
	 * @param array $elements Elementor elements (by reference).
	 * @param array $label_to_url Map normalized label => permalink.
	 */
	protected function apply_tp_navigation_item_menu_links_recursive( array &$elements, array $label_to_url ) {
		if ( empty( $label_to_url ) ) {
			return;
		}
		foreach ( $elements as &$el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			if (
				! empty( $el['elType'] ) &&
				'widget' === $el['elType'] &&
				isset( $el['settings'] ) &&
				is_array( $el['settings'] ) &&
				! empty( $el['settings']['ItemMenu'] ) &&
				is_array( $el['settings']['ItemMenu'] )
			) {
				foreach ( $el['settings']['ItemMenu'] as &$item ) {
					if ( ! is_array( $item ) ) {
						continue;
					}
					$label = '';
					if ( isset( $item['filterlabel'] ) ) {
						$label = $item['filterlabel'];
					} elseif ( isset( $item['filterLabel'] ) ) {
						$label = $item['filterLabel'];
					}
					$key = $this->normalize_nav_menu_filterlabel( $label );
					if ( '' === $key || ! isset( $label_to_url[ $key ] ) ) {
						continue;
					}
					if ( ! isset( $item['LinkFilter'] ) || ! is_array( $item['LinkFilter'] ) ) {
						$item['LinkFilter'] = array(
							'url'               => '',
							'is_external'       => '',
							'nofollow'          => '',
							'custom_attributes' => '',
						);
					}
					$item['LinkFilter']['url'] = $label_to_url[ $key ];
				}
				unset( $item );
			}
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				$this->apply_tp_navigation_item_menu_links_recursive( $el['elements'], $label_to_url );
			}
		}
		unset( $el );
	}

	/**
	 * Rewrite placeholder anchor hrefs inside Composer widget raw_html by matching
	 * the anchor's label text to a page title.
	 *
	 * UiChemy header/footer exports carry the whole menu as plain HTML inside a
	 * single `composer` code widget — there is no ItemMenu structure to remap, and
	 * every link ships as href="#". Anchors whose visible label (first inner
	 * <span> when present — roll-animation markup duplicates the label across
	 * two spans — otherwise the whole inner text) matches a page title get that
	 * page's permalink. Anchors with a real URL or an unmatched label are left
	 * untouched.
	 *
	 * @param string $html         Composer widget raw_html.
	 * @param array  $label_to_url Map normalized label => permalink.
	 * @return string Updated HTML.
	 */
	protected function apply_composer_nav_links_to_raw_html( $html, array $label_to_url ) {
		if ( '' === (string) $html || empty( $label_to_url ) ) {
			return (string) $html;
		}
		$result = preg_replace_callback(
			'/<a\b([^>]*)>(.*?)<\/a>/su',
			function ( $m ) use ( $label_to_url ) {
				list( $tag, $attrs, $inner ) = $m;

				// Only rewrite placeholder links; never clobber a real URL.
				if ( ! preg_match( '/\bhref\s*=\s*("|\')(#?)\1/u', $attrs ) ) {
					return $tag;
				}

				$label = '';
				if ( preg_match( '/<span\b[^>]*>(.*?)<\/span>/su', $inner, $sm ) ) {
					$label = $sm[1];
				} else {
					$label = $inner;
				}
				$key = $this->normalize_nav_menu_filterlabel( $label );
				$url = $this->match_composer_nav_label_to_url( $key, $label_to_url );
				if ( '' === $url ) {
					return $tag;
				}

				$new_attrs = preg_replace( '/\bhref\s*=\s*("|\')#?\1/u', 'href="' . esc_url( $url ) . '"', $attrs, 1 );
				return '<a' . $new_attrs . '>' . $inner . '</a>';
			},
			$html
		);
		return null === $result ? (string) $html : $result;
	}

	/**
	 * Resolve a normalized nav label to a permalink: exact title match first,
	 * then a conservative prefix fallback — the label matches when exactly ONE
	 * page title starts with it as a whole word (e.g. footer label "About" →
	 * page "About Us"). Ambiguous or missing labels return '' so the anchor is
	 * left untouched.
	 *
	 * @param string $key          Normalized label.
	 * @param array  $label_to_url Map normalized page title => permalink.
	 * @return string Permalink or '' when no unambiguous match.
	 */
	protected function match_composer_nav_label_to_url( $key, array $label_to_url ) {
		if ( '' === $key ) {
			return '';
		}
		if ( isset( $label_to_url[ $key ] ) ) {
			return (string) $label_to_url[ $key ];
		}
		$prefix  = $key . ' ';
		$matches = array();
		foreach ( $label_to_url as $title_key => $url ) {
			if ( 0 === strpos( $title_key, $prefix ) ) {
				$matches[] = $url;
			}
		}
		return 1 === count( $matches ) ? (string) $matches[0] : '';
	}

	/**
	 * Walk an Elementor element tree and rewrite nav links inside every Composer
	 * widget's raw_html (see apply_composer_nav_links_to_raw_html).
	 *
	 * @param array $elements     Elementor elements (by reference).
	 * @param array $label_to_url Map normalized label => permalink.
	 */
	protected function apply_composer_nav_links_recursive( array &$elements, array $label_to_url ) {
		if ( empty( $label_to_url ) ) {
			return;
		}
		foreach ( $elements as &$el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			if (
				$this->is_composer_widget( $el ) &&
				isset( $el['settings']['raw_html'] ) &&
				is_string( $el['settings']['raw_html'] )
			) {
				$el['settings']['raw_html'] = $this->apply_composer_nav_links_to_raw_html( $el['settings']['raw_html'], $label_to_url );
			}
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				$this->apply_composer_nav_links_recursive( $el['elements'], $label_to_url );
			}
		}
		unset( $el );
	}

	/**
	 * Walk parsed Gutenberg blocks recursively and set nav item URLs on tpgb/tp-navigation-builder blocks.
	 * Mirrors apply_tp_navigation_item_menu_links_recursive for Elementor.
	 *
	 * @param array $blocks       Parsed blocks (by reference).
	 * @param array $label_to_url Map normalized label => permalink.
	 */
	protected function apply_gutenberg_nav_item_menu_links_recursive( array &$blocks, array $label_to_url ) {
		if ( empty( $label_to_url ) ) {
			return;
		}
		foreach ( $blocks as &$block ) {
			if ( ! is_array( $block ) ) {
				continue;
			}
			if (
				isset( $block['blockName'] ) &&
				'tpgb/tp-navigation-builder' === $block['blockName'] &&
				! empty( $block['attrs']['ItemMenu'] ) &&
				is_array( $block['attrs']['ItemMenu'] )
			) {
				foreach ( $block['attrs']['ItemMenu'] as &$item ) {
					if ( ! is_array( $item ) ) {
						continue;
					}
					$label = '';
					if ( ! empty( $item['name'] ) ) {
						$label = $item['name'];
					} elseif ( isset( $item['LinkFilter']['filter']['label'] ) ) {
						$label = $item['LinkFilter']['filter']['label'];
					}
					$key = $this->normalize_nav_menu_filterlabel( $label );
					if ( '' === $key || ! isset( $label_to_url[ $key ] ) ) {
						continue;
					}
					if ( ! isset( $item['LinkFilter'] ) || ! is_array( $item['LinkFilter'] ) ) {
						$item['LinkFilter'] = array();
					}
					if ( ! isset( $item['LinkFilter']['filter'] ) || ! is_array( $item['LinkFilter']['filter'] ) ) {
						$item['LinkFilter']['filter'] = array(
							'label'         => $label,
							'url'           => '',
							'id'            => '',
							'opensInNewTab' => false,
						);
					}
					$item['LinkFilter']['filter']['url'] = $label_to_url[ $key ];
				}
				unset( $item );
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$this->apply_gutenberg_nav_item_menu_links_recursive( $block['innerBlocks'], $label_to_url );
			}
		}
		unset( $block );
	}

	/**
	 * Apply nav item URLs to tpgb/tp-navigation-builder blocks in serialized post content.
	 *
	 * @param string $post_content Serialized block HTML.
	 * @param array  $label_to_url Map normalized label => permalink.
	 * @return string Updated post content.
	 */
	protected function apply_gutenberg_nav_item_menu_links( $post_content, array $label_to_url ) {
		if ( empty( $label_to_url ) || ! function_exists( 'parse_blocks' ) || ! function_exists( 'serialize_blocks' ) ) {
			return $post_content;
		}
		$blocks = parse_blocks( $post_content );
		if ( empty( $blocks ) ) {
			return $post_content;
		}
		$this->apply_gutenberg_nav_item_menu_links_recursive( $blocks, $label_to_url );
		return serialize_blocks( $blocks );
	}

	/**
	 * Re-apply nav links to all existing Gutenberg header (nxt_builder) templates.
	 * Called after each page is imported so that navbars already saved get updated
	 * when pages are imported after the navbar.
	 */
	protected function refresh_gutenberg_header_nav_links() {
		$nav_map = $this->build_nav_menu_filterlabel_permalink_map_from_wp_pages();
		if ( empty( $nav_map ) ) {
			return;
		}

		// New imports write Gutenberg headers to the UiChemy Theme Builder; sites
		// imported before that still have theirs in nxt_builder. Both are swept, so
		// a re-import on an older site keeps working.
		$headers = array();
		if ( $this->is_uichemy_theme_builder_available() && class_exists( 'UiChemy_Template_CPT' ) ) {
			$headers = get_posts(
				array(
					'post_type'      => UiChemy_Template_CPT::POST_TYPE,
					'post_status'    => 'publish',
					'posts_per_page' => -1,
					'meta_key'       => UiChemy_Template_CPT::META_TYPE,
					'meta_value'     => 'header',
				)
			);
		}
		if ( post_type_exists( 'nxt_builder' ) ) {
			$headers = array_merge(
				$headers,
				get_posts(
					array(
						'post_type'      => 'nxt_builder',
						'post_status'    => 'publish',
						'posts_per_page' => -1,
						'meta_key'       => 'nxt-hooks-layout-sections',
						'meta_value'     => 'header',
					)
				)
			);
		}

		// An Elementor template keeps its body in _elementor_data, so its
		// post_content is empty and the block-marker check below skips it — no
		// separate editor test is needed to tell the two apart.
		foreach ( $headers as $header_post ) {
			if ( false === strpos( $header_post->post_content, 'tpgb/tp-navigation-builder' ) ) {
				continue;
			}
			$updated_content = $this->apply_gutenberg_nav_item_menu_links( $header_post->post_content, $nav_map );
			if ( $updated_content === $header_post->post_content ) {
				continue;
			}
			wp_update_post(
				array(
					'ID'           => $header_post->ID,
					'post_content' => wp_slash( $updated_content ),
				)
			);
		}
	}

	/**
	 * Re-apply nav links to all published Elementor library templates.
	 * Handles off-canvas popup templates whose nav items live inside an elementor_library
	 * post referenced by content_template — the navbar itself only holds the toggle button.
	 * Called after each page import, mirroring refresh_gutenberg_header_nav_links for Elementor.
	 */
	protected function refresh_elementor_library_nav_links() {
		$nav_map = $this->build_nav_menu_filterlabel_permalink_map_from_wp_pages();
		if ( empty( $nav_map ) ) {
			return;
		}
		$templates = get_posts(
			array(
				'post_type'              => 'elementor_library',
				'post_status'            => 'publish',
				'posts_per_page'         => -1,
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);
		foreach ( $templates as $tpl ) {
			$raw = get_post_meta( $tpl->ID, '_elementor_data', true );
			if ( empty( $raw ) || false === strpos( $raw, 'ItemMenu' ) ) {
				continue;
			}
			$content = json_decode( $raw, true );
			if ( ! is_array( $content ) ) {
				continue;
			}
			$this->apply_tp_navigation_item_menu_links_recursive( $content, $nav_map );
			update_post_meta(
				$tpl->ID,
				'_elementor_data',
				wp_slash( wp_json_encode( $content ) )
			);
		}
	}

	/**
	 * Create or update WordPress pages and set Elementor document data from imported JSON.
	 * Imports pages from meta.pages (e.g. Home, Courses) and also navbar (header) and footer when their JSON files exist.
	 *
	 * @param array $files       Map of filename => decoded JSON.
	 * @param array $import_meta Meta containing 'pages' => [ { pageName: string }, ... ].
	 * @return array{created: array, warnings: string[]} `created` is the list of
	 *              { post_id, title, filename } for created/updated pages/templates;
	 *              `warnings` records anything that was skipped instead of created
	 *              (e.g. header/footer with no Nexter Extension installed) so the
	 *              caller can surface it instead of only ever returning `success: true`.
	 */
	protected function create_pages_from_import( array $files, array $import_meta ) {
		$created  = array();
		$warnings = array();
		$pages    = isset( $import_meta['pages'] ) && is_array( $import_meta['pages'] ) ? $import_meta['pages'] : array();

		// Theme Builder template filenames → el_type + optional archive rule (used by create_or_update_nexter_blog_template).
		$theme_builder_templates = array(
			'blog.json'                => array(
				'title'        => 'Blog',
				'el_type'      => 'archive',
				'archive_rule' => 'all',
			),
			'blog detail page.json'    => array(
				'title'        => 'Blog Detail Page',
				'el_type'      => 'single',
				'archive_rule' => '',
			),
			'author page.json'         => array(
				'title'        => 'Author Page',
				'el_type'      => 'archive',
				'archive_rule' => 'nxt_author',
			),
			'search results page.json' => array(
				'title'        => 'Search Results Page',
				'el_type'      => 'search-results',
				'archive_rule' => 'nxt_search',
			),
			'tag featured page.json'   => array(
				'title'        => 'Tag Featured Page',
				'el_type'      => 'archive',
				'archive_rule' => 'post_tag',
			),
			'category page.json'       => array(
				'title'        => 'Category Page',
				'el_type'      => 'archive',
				'archive_rule' => 'category',
			),
		);

		// Files that are never a regular page. Used both when meta carries no pages
		// list at all and when it carries a partial one (API may use a capital first
		// letter: Home.json), so the comparison is always lowercased.
		$skip_files = array_merge(
			array( 'globals.json', 'uichemy-globals.json', 'navbar.json', 'footer.json', 'blog-post-content.json' ),
			array_keys( $theme_builder_templates ),
			$this->get_elementor_template_filenames_from_meta( $import_meta )
		);
		if ( empty( $pages ) ) {
			foreach ( array_keys( $files ) as $filename ) {
				$base = strtolower( $filename );
				if ( in_array( $base, $skip_files, true ) ) {
					continue;
				}
				if ( substr( $base, -5 ) === '.json' ) {
					$pages[] = array( 'pageName' => basename( $filename, '.json' ) );
				}
			}
		} else {
			/*
			 * A non-empty `pages` list is not necessarily a complete one. The API
			 * has been seen to mint download URLs for a whole bucket (legal_pages
			 * — Privacy Policy, Terms, …) while leaving those pages out of `pages`,
			 * so the files were fetched into stored data and then never imported,
			 * with nothing reporting it. Sweep in every downloaded .json the list
			 * does not already mention, so one missing bucket cannot silently drop
			 * pages. 404.json is excluded on top of $skip_files: it has a dedicated
			 * template importer and must not also become a regular page.
			 */
			$listed = array();
			foreach ( $this->normalize_pages_list( $pages ) as $listed_page ) {
				$listed[ strtolower( $listed_page['pageName'] . '.json' ) ] = true;
			}
			$leftover_skip = array_merge( $skip_files, array( '404.json' ) );
			foreach ( array_keys( $files ) as $filename ) {
				$base = strtolower( $filename );
				if ( isset( $listed[ $base ] ) || in_array( $base, $leftover_skip, true ) ) {
					continue;
				}
				if ( substr( $base, -5 ) === '.json' ) {
					$pages[] = array( 'pageName' => basename( $filename, '.json' ) );
				}
			}
		}

		// Normalize pages: accept strings ("Home") or objects with pageName / name / title (API may vary).
		$pages = $this->normalize_pages_list( $pages );

		foreach ( $pages as $page_info ) {
			$page_name = isset( $page_info['pageName'] ) ? $page_info['pageName'] : '';
			if ( '' === $page_name ) {
				continue;
			}
			// Match file by case-insensitive name (API returns e.g. Home.json, navbar.json, footer.json).
			$filename = $this->find_file_key( $files, $page_name . '.json' );
			if ( null === $filename ) {
				continue;
			}
			// Never create navbar, footer, or theme builder templates as regular pages.
			$filename_lower = strtolower( $filename );
			if ( in_array( $filename_lower, array( 'navbar.json', 'footer.json' ), true ) ) {
				continue;
			}
			if ( isset( $theme_builder_templates[ $filename_lower ] ) ) {
				continue;
			}

			$data    = $files[ $filename ];
			$post_id = $this->create_or_update_elementor_page( $page_name, $data );
			if ( $post_id && ! is_wp_error( $post_id ) ) {
				$created[] = array(
					'post_id'  => $post_id,
					'title'    => $page_name,
					'filename' => $filename,
				);
			}
		}

		// Import header (navbar) and footer via Theme Builder (UiChemy for Elementor header/footer, Nexter Extension for Gutenberg).
		$header_footer           = array(
			'navbar.json' => array(
				'title'        => 'Navbar',
				'section_type' => 'header',
			),
			'footer.json' => array(
				'title'        => 'Footer',
				'section_type' => 'footer',
			),
		);
		$created_filenames_lower = array_map( 'strtolower', array_column( $created, 'filename' ) );

		foreach ( $header_footer as $fn => $config ) {
			if ( in_array( strtolower( $fn ), $created_filenames_lower, true ) ) {
				continue;
			}
			$found = $this->find_file_key( $files, $fn );
			if ( null === $found ) {
				continue;
			}
			$title        = $config['title'];
			$section_type = $config['section_type'];
			$post_id      = $this->create_or_update_theme_builder_template( $title, $files[ $found ], '', '', $section_type, $created );
			if ( $post_id && ! is_wp_error( $post_id ) ) {
				$created[] = array(
					'post_id'  => $post_id,
					'title'    => $title,
					'filename' => $found,
				);
			} elseif ( is_wp_error( $post_id ) ) {
				$warnings[] = sprintf(
					/* translators: 1: template title, 2: error message */
					__( '%1$s skipped: %2$s', 'uichemy' ),
					$title,
					$post_id->get_error_message()
				);
			}
		}

		// Import Blog Detail Page, Author Page, Search Results Page, Tag Featured Page, Category Page
		// as Nexter Theme Builder (nxt_builder) templates with appropriate display conditions.
		foreach ( $theme_builder_templates as $fn_lower => $config ) {
			$found = $this->find_file_key( $files, $fn_lower );
			if ( null === $found ) {
				continue;
			}
			$post_id = $this->create_or_update_theme_builder_template(
				$config['title'],
				$files[ $found ],
				$config['el_type'],
				$config['archive_rule']
			);
			if ( $post_id && ! is_wp_error( $post_id ) ) {
				$created[] = array(
					'post_id'  => $post_id,
					'title'    => $config['title'],
					'filename' => $found,
				);
			} elseif ( is_wp_error( $post_id ) ) {
				$warnings[] = sprintf(
					/* translators: 1: template title, 2: error message */
					__( '%1$s skipped: %2$s', 'uichemy' ),
					$config['title'],
					$post_id->get_error_message()
				);
			}
		}

		$library_result = $this->import_elementor_library_templates( $files, $import_meta );
		if ( ! empty( $library_result['created'] ) ) {
			$created = array_merge( $created, $library_result['created'] );
		}

		// Rewrite source-site template IDs (e.g. content_a_template / content_b_template
		// on tp-switcher widgets) to the new local WordPress post IDs created above.
		if ( ! empty( $library_result['id_map'] ) ) {
			$this->remap_template_ids_in_pages( $created, $library_result['id_map'] );
		}

		// Apply nav links to Elementor library templates (e.g. tp-off-canvas popup content
		// templates). Pages are fully created at this point so URLs are resolved correctly.
		$this->refresh_elementor_library_nav_links();

		return array(
			'created'  => $created,
			'warnings' => $warnings,
		);
	}

	/**
	 * Move an existing imported item to draft and change its slug so the new import can publish with the canonical URL.
	 *
	 * @param int    $post_id   Post ID.
	 * @param string $post_type Expected post type (empty = skip type check).
	 * @return bool True if the post was updated.
	 */
	protected function draft_existing_post_for_reimport( $post_id, $post_type = '' ) {
		$post_id = (int) $post_id;
		if ( $post_id <= 0 ) {
			return false;
		}
		$post = get_post( $post_id );
		if ( ! $post || ( '' !== $post_type && $post->post_type !== $post_type ) ) {
			return false;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return false;
		}
		$base = $post->post_name ? $post->post_name : sanitize_title( $post->post_title );
		if ( '' === $base ) {
			$base = 'post';
		}
		$new_slug = $base . '-archived-' . $post_id;
		$new_slug = wp_unique_post_slug( $new_slug, $post_id, 'draft', $post->post_type, (int) $post->post_parent );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'draft',
				'post_name'   => $new_slug,
			)
		);
		// Disable UiChemy Theme Builder templates when archiving so they stop rendering on the front end.
		if ( 'uichemy_template' === $post->post_type && class_exists( 'UiChemy_Template_CPT' ) ) {
			update_post_meta( $post_id, UiChemy_Template_CPT::META_STATUS, 'inactive' );
			if ( class_exists( 'UiChemy_Template_Resolver' ) ) {
				UiChemy_Template_Resolver::flush_cache();
			}
		}
		// Nexter Theme Builder templates.
		if ( 'nxt_builder' === $post->post_type ) {
			update_post_meta( $post_id, 'nxt_build_status', '0' );
			$this->bump_nexter_builder_cache();
		}
		clean_post_cache( $post_id );
		return true;
	}

	/**
	 * Bump the Nexter Theme Builder condition cache so changes to nxt_build_status
	 * take effect on the front end.
	 *
	 * Nexter caches the resolved template/condition map in the 'nxt-build-get-data'
	 * option and only rebuilds it when its 'saved' timestamp differs from the
	 * per-type "*_updated" timestamps. Bumping 'saved' forces that rebuild.
	 *
	 * @return void
	 */
	protected function bump_nexter_builder_cache() {
		$option   = 'nxt-build-get-data';
		$get_data = get_option( $option );
		if ( false === $get_data || empty( $get_data ) ) {
			$get_data = array(
				'saved'            => time(),
				'singular_updated' => '',
				'archives_updated' => '',
				'sections_updated' => '',
			);
			add_option( $option, $get_data, '', 'yes' );
		} else {
			$get_data['saved'] = time();
			update_option( $option, $get_data, true );
		}
	}

	/**
	 * Find first post with an exact title (replacement for deprecated get_page_by_title()).
	 *
	 * @param string $page_title Post title.
	 * @param string $post_type  Post type slug.
	 * @return WP_Post|null
	 */
	protected function get_post_by_exact_title( $page_title, $post_type = 'page' ) {
		if ( ! is_string( $page_title ) || '' === $page_title || ! is_string( $post_type ) || '' === $post_type ) {
			return null;
		}
		$query = new WP_Query(
			array(
				'post_type'              => $post_type,
				'title'                  => $page_title,
				'post_status'            => get_post_stati(),
				'posts_per_page'         => 1,
				'no_found_rows'          => true,
				'ignore_sticky_posts'    => true,
				'update_post_term_cache' => false,
				'update_post_meta_cache' => false,
			)
		);
		if ( empty( $query->posts ) ) {
			return null;
		}
		return $query->posts[0];
	}

	/**
	 * Create or update a page/post with Gutenberg block content (no Elementor meta).
	 *
	 * @param string $page_title   Title.
	 * @param string $post_content Processed block markup.
	 * @param string $post_type    Post type.
	 * @return int|WP_Error Post ID.
	 */
	protected function create_or_update_gutenberg_wp_page( $page_title, $post_content, $post_type = 'page' ) {
		$existing = $this->get_post_by_exact_title( $page_title, $post_type );
		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, $post_type );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $page_title,
				'post_name'   => sanitize_title( $page_title ),
				'post_status' => 'publish',
				'post_type'   => $post_type,
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		delete_post_meta( $post_id, '_elementor_data' );
		delete_post_meta( $post_id, '_elementor_edit_mode' );
		delete_post_meta( $post_id, '_elementor_template_type' );

		// Assign unique TPGB block_ids with the correct post_id suffix so all blocks have
		// distinct CSS classes and TPGB's JS won't collapse them on first editor load.
		$post_content = $this->apply_unique_tpgb_block_ids( $post_content, (int) $post_id );

		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( $post_content ),
			)
		);

		// Remove stale per-post CSS so TPGB regenerates it on the next real page load,
		// at which point all blocks are registered and globalTypo remapping is reflected.
		$this->invalidate_tpgb_block_css_file( $post_id );

		return $post_id;
	}

	/**
	 * Recursively search an extracted Elementor content array for the first widget of a given
	 * widgetType and return the value of the specified setting key, or null if not found.
	 *
	 * @param array  $elements   Flat or nested Elementor elements array.
	 * @param string $widget_type Widget type slug (e.g. 'tp-blog-listout').
	 * @param string $setting_key Setting key name to retrieve.
	 * @return string|null Setting value or null if the widget / key is absent.
	 */
	protected function find_widget_setting_in_content( array $elements, $widget_type, $setting_key ) {
		foreach ( $elements as $el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			if ( isset( $el['widgetType'] ) && $el['widgetType'] === $widget_type ) {
				return isset( $el['settings'][ $setting_key ] ) ? (string) $el['settings'][ $setting_key ] : '(key absent)';
			}
			// Recurse into elements or content children.
			foreach ( array( 'elements', 'content' ) as $child_key ) {
				if ( ! empty( $el[ $child_key ] ) && is_array( $el[ $child_key ] ) ) {
					$found = $this->find_widget_setting_in_content( $el[ $child_key ], $widget_type, $setting_key );
					if ( null !== $found ) {
						return $found;
					}
				}
			}
		}
		return null;
	}

	/**
	 * Recursively change blogs_post_listing from "archive_listing" to "normal"
	 * in all tp-blog-listout widgets within the decoded page JSON.
	 * Used for regular pages that should not use archive/query-based listing.
	 *
	 * @param mixed $data Decoded page JSON.
	 * @return mixed Same structure with setting changed where applicable.
	 */
	protected function normalize_blog_listing_mode( $data ) {
		if ( ! is_array( $data ) ) {
			return $data;
		}

		foreach ( $data as $i => $element ) {
			if ( ! is_array( $element ) ) {
				continue;
			}

			// Not an Elementor element object — plain list or page wrapper (no id/widgetType).
			// Recurse directly into it (e.g. data['content'] = [pageObj1, pageObj2]).
			if ( ! isset( $element['id'] ) && ! isset( $element['widgetType'] ) ) {
				$data[ $i ] = $this->normalize_blog_listing_mode( $element );
				continue;
			}

			// Fix tp-blog-listout widgets.
			if ( isset( $element['widgetType'] ) && 'tp-blog-listout' === $element['widgetType'] ) {
				if ( isset( $element['settings']['blogs_post_listing'] ) && 'archive_listing' === $element['settings']['blogs_post_listing'] ) {
					$data[ $i ]['settings']['blogs_post_listing'] = 'page_listing';
				}
			}

			// Recurse into child elements (Elementor container tree).
			if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
				$data[ $i ]['elements'] = $this->normalize_blog_listing_mode( $element['elements'] );
			}

			// Recurse into content key (page wrapper objects: { version, content[], metadata }).
			if ( ! empty( $element['content'] ) && is_array( $element['content'] ) ) {
				$data[ $i ]['content'] = $this->normalize_blog_listing_mode( $element['content'] );
			}
		}

		return $data;
	}

	/**
	 * Change postListing from "archive_listing" to "page_listing" in all tpgb/tp-post-listing
	 * blocks within Gutenberg post_content. Gutenberg counterpart of normalize_blog_listing_mode().
	 *
	 * @param string $post_content Serialised Gutenberg block markup.
	 * @return string Updated post_content (unchanged if no blocks were modified or WP functions unavailable).
	 */
	protected function normalize_tpgb_post_listing_mode( $post_content ) {
		if ( ! is_string( $post_content ) || '' === $post_content ) {
			return $post_content;
		}
		if ( ! function_exists( 'parse_blocks' ) || ! function_exists( 'serialize_blocks' ) ) {
			return $post_content;
		}
		$blocks  = parse_blocks( $post_content );
		$changed = false;
		$this->normalize_tpgb_post_listing_blocks_recursive( $blocks, $changed );
		if ( $changed ) {
			return serialize_blocks( $blocks );
		}
		return $post_content;
	}

	/**
	 * Recursively walk parsed blocks and set postListing = page_listing on tpgb/tp-post-listing blocks.
	 *
	 * @param array $blocks  Parsed blocks (modified in place via reference).
	 * @param bool  $changed Set to true if any attribute was modified.
	 */
	protected function normalize_tpgb_post_listing_blocks_recursive( array &$blocks, &$changed ) {
		foreach ( $blocks as &$block ) {
			if ( 'tpgb/tp-post-listing' === ( isset( $block['blockName'] ) ? $block['blockName'] : '' ) ) {
				$current = isset( $block['attrs']['postListing'] ) ? $block['attrs']['postListing'] : '';
				if ( 'archive_listing' === $current ) {
					$block['attrs']['postListing'] = 'page_listing';
					$changed = true;
				}
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$this->normalize_tpgb_post_listing_blocks_recursive( $block['innerBlocks'], $changed );
			}
		}
		unset( $block );
	}

	/**
	 * Create or update a single WordPress page with Elementor document data.
	 *
	 * @param string $page_title Page title (e.g. "Home", "Courses").
	 * @param mixed  $data       Decoded JSON from the API (array of elements or object with 'content' key).
	 * @param string $post_type  WordPress post type. Default 'page'.
	 * @return int|WP_Error Post ID or error.
	 */
	protected function create_or_update_elementor_page( $page_title, $data, $post_type = 'page' ) {
		// Titles of the 4 archive pages that must keep archive_listing.
		$archive_page_titles = array( 'search results page', 'author page', 'category page', 'tag featured page' );
		$is_archive          = in_array( strtolower( $page_title ), $archive_page_titles, true );

		if ( $this->is_gutenberg_replacement_data( $data ) ) {
			$post_content = $this->process_gutenberg_markup_to_post_content( $data['markup'] );
			if ( is_wp_error( $post_content ) ) {
				return $post_content;
			}
			// Normalize tpgb/tp-post-listing: change archive_listing → page_listing for every page
			// except the 4 dedicated archive pages which must keep archive_listing.
			if ( ! $is_archive ) {
				$post_content = $this->normalize_tpgb_post_listing_mode( $post_content );
			}
			return $this->create_or_update_gutenberg_wp_page( $page_title, $post_content, $post_type );
		}

		// Normalize tp-blog-listout: change archive_listing → page_listing for every page
		// except the 4 dedicated archive pages which must keep archive_listing.
		if ( ! $is_archive ) {
			$data = $this->normalize_blog_listing_mode( $data );
		}

		$content = $this->extract_elementor_content( $data );
		if ( null === $content ) {
			return new WP_Error( 'IMPORT_ELEMENTOR_PAGE_INVALID_JSON', __( 'Invalid page JSON structure.', 'uichemy' ) );
		}

		$existing = $this->get_post_by_exact_title( $page_title, $post_type );
		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, $post_type );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $page_title,
				'post_name'   => sanitize_title( $page_title ),
				'post_status' => 'publish',
				'post_type'   => $post_type,
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		// Resolve remote images (download, dedupe by URL hash, replace URLs in content).
		$content = $this->resolve_elementor_assets( $content );
		$content = $this->ensure_elementor_ids_are_strings( $content );

		// Elementor stores document content as JSON string in _elementor_data; wp_slash for WP storage.
		$json_string = wp_json_encode( $content );
		if ( false === $json_string ) {
			return new WP_Error( 'IMPORT_ELEMENTOR_PAGE_ENCODE_FAILED', __( 'Could not encode page data.', 'uichemy' ) );
		}
		$template_type = ( 'post' === $post_type ) ? 'wp-post' : 'wp-page';
		update_post_meta( $post_id, '_elementor_data', wp_slash( $json_string ) );
		update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
		update_post_meta( $post_id, '_elementor_template_type', $template_type );

		return $post_id;
	}

	/**
	 * Create or update a Theme Builder template.
	 *
	 * Routing: EVERYTHING goes to the UiChemy Theme Builder (uichemy_template CPT)
	 * — every type, both editors. Nexter Extension is no longer installed by the
	 * import flow, so `nxt_builder` cannot be assumed to exist.
	 *
	 * The Elementor and Gutenberg paths diverge inside
	 * create_or_update_uichemy_template(): an Elementor export is an element tree
	 * that becomes a Composer widget, a Gutenberg export is block markup that goes
	 * to post_content verbatim. The caller does not need to know which.
	 *
	 * The old Nexter creators (create_or_update_nexter_template /
	 * _nexter_blog_template) are deliberately left in place but unreachable from
	 * here: sites imported before this change still have nxt_builder templates, and
	 * UiChemy's resolver defers to an active one, so those sites keep rendering.
	 *
	 * @param string $title                         Template title.
	 * @param mixed  $data                          Decoded JSON or Gutenberg shape from API.
	 * @param string $el_type                       Elementor-style type (single, archive, search-results) or empty for header/footer/404.
	 * @param string $archive_rule                  Nexter archive rule when el_type is archive.
	 * @param string $section_type                  header|footer|page-404 when importing navbar/footer/404.
	 * @param array  $created_pages_for_nav_links   Pages created earlier in the same import (navbar link mapping).
	 * @return int|WP_Error Post ID or error.
	 */
	protected function create_or_update_theme_builder_template( $title, $data, $el_type = '', $archive_rule = '', $section_type = '', array $created_pages_for_nav_links = array() ) {
		// Creation only: which template wins a slot is decided by UiChemy's own
		// resolver and location handlers. This importer deliberately does not
		// disable other systems' templates or render into theme hooks — doing so
		// left the site with no header/footer at all on themes UiChemy does not
		// claim a location on.
		return $this->create_or_update_uichemy_template(
			$title,
			$data,
			$section_type,
			$created_pages_for_nav_links,
			$el_type,
			$archive_rule
		);
	}

	/**
	 * Whether the native UiChemy Theme Builder is available.
	 *
	 * Checks the public creation hook (`uichemy/theme_builder/create_template`,
	 * exposed by UiChemy_Theme_Builder_API) rather than UiChemy's internals, so
	 * this stays true regardless of how UiChemy wires the hook internally.
	 *
	 * @return bool
	 */
	protected function is_uichemy_theme_builder_available() {
		return has_filter( 'uichemy/theme_builder/create_template' ) && post_type_exists( 'uichemy_template' );
	}

	/**
	 * Find the first Composer code widget's settings in an Elementor element tree.
	 *
	 * Navbar/footer exports wrap the whole design in one `composer` widget carrying
	 * raw_html / raw_css / raw_js, which is what UiChemy's creation hook consumes.
	 *
	 * @param array $elements Elementor element tree.
	 * @return array|null Widget settings, or null when the tree has no Composer widget.
	 */
	/**
	 * Whether an element is the Composer widget.
	 *
	 * The registered slug is `uichemy-composer` — see
	 * UiChemy_Composer_Widget::get_name(). The three legacy slugs below are content
	 * contracts and are matched as well: `proton` is what every released Protuno
	 * stored, and `composer` / `uichemy-builder` are interim dev names, so any of
	 * them can still sit in a post's `_elementor_data`.
	 *
	 * Matching on only ONE of these slugs is what made header/footer imports fail
	 * with "At least html or css must be provided": the lookup never matched, so
	 * the caller fell through to a branch that sends an 'elements' key the creator
	 * does not read, leaving html and css empty. Accepting all three keeps exports
	 * made before either rename importing instead of failing the same way.
	 *
	 * @param array $el Elementor element.
	 * @return bool
	 */
	protected function is_composer_widget( $el ) {
		if ( ! is_array( $el ) || empty( $el['elType'] ) || 'widget' !== $el['elType'] ) {
			return false;
		}
		$type = isset( $el['widgetType'] ) ? (string) $el['widgetType'] : '';
		return in_array( $type, array( 'uichemy-composer', 'composer', 'proton', 'uichemy-builder' ), true );
	}

	/**
	 * Collect the settings of EVERY Composer widget in an element tree, in order.
	 *
	 * find_composer_widget_settings() returns the first match and stops, which
	 * is right when a template really is one widget — but an export routinely
	 * carries several, and what they MEAN depends on the template type:
	 *
	 * - header/footer: alternative designs of the same bar.
	 * - single/archive/404/search: SECTIONS of one layout (a Blog Detail Page
	 *   export ships hero, meta, content, author box and related posts as
	 *   separate documents).
	 *
	 * Either way, stopping at the first silently discarded the rest and still
	 * reported success. The caller decides which meaning applies.
	 *
	 * @param array $elements Elementor element tree.
	 * @return array<int,array> Settings arrays, document order.
	 */
	protected function collect_composer_widget_settings( array $elements ) {
		$found = array();
		foreach ( $elements as $el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			if ( $this->is_composer_widget( $el ) && isset( $el['settings'] ) && is_array( $el['settings'] ) ) {
				$found[] = $el['settings'];
				continue; // a Composer widget owns its subtree; do not recurse into it.
			}
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				foreach ( $this->collect_composer_widget_settings( $el['elements'] ) as $inner ) {
					$found[] = $inner;
				}
			}
		}
		return $found;
	}

	/**
	 * Stitch several Composer widgets into one, preserving document order.
	 *
	 * For the types whose multiple widgets are SECTIONS rather than
	 * alternatives. Concatenation is the right join because that is already
	 * what they are on a page: independent, self-contained blocks stacked in
	 * order, each carrying its own scoped CSS. Pages never needed this because
	 * create_or_update_elementor_page() stores the whole element tree; templates
	 * go through the Composer hook, so the pieces are reassembled here.
	 *
	 * Empty parts are skipped, and CSS/JS are newline-joined so a section
	 * missing a trailing brace or semicolon cannot swallow the next one's first
	 * rule.
	 *
	 * @param array<int,array> $settings Composer widget settings, document order.
	 * @return array Single settings array with merged raw_html / raw_css / raw_js.
	 */
	protected function merge_composer_widget_settings( array $settings ) {
		$html = array();
		$css  = array();
		$js   = array();

		foreach ( $settings as $one ) {
			if ( ! is_array( $one ) ) {
				continue;
			}
			$h = isset( $one['raw_html'] ) ? trim( (string) $one['raw_html'] ) : '';
			$c = isset( $one['raw_css'] ) ? trim( (string) $one['raw_css'] ) : '';
			$j = isset( $one['raw_js'] ) ? trim( (string) $one['raw_js'] ) : '';
			if ( '' !== $h ) {
				$html[] = $h;
			}
			if ( '' !== $c ) {
				$css[] = $c;
			}
			if ( '' !== $j ) {
				$js[] = $j;
			}
		}

		// Every other key comes from the first widget (it carries the widget's
		// own settings); only the three code fields are merged.
		$merged             = isset( $settings[0] ) && is_array( $settings[0] ) ? $settings[0] : array();
		$merged['raw_html'] = implode( "\n", $html );
		$merged['raw_css']  = implode( "\n", $css );
		$merged['raw_js']   = implode( "\n", $js );

		return $merged;
	}

	protected function find_composer_widget_settings( array $elements ) {
		foreach ( $elements as $el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			if ( $this->is_composer_widget( $el ) && isset( $el['settings'] ) && is_array( $el['settings'] ) ) {
				return $el['settings'];
			}
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				$found = $this->find_composer_widget_settings( $el['elements'] );
				if ( null !== $found ) {
					return $found;
				}
			}
		}
		return null;
	}

	/**
	 * Find an existing UiChemy template by title and location type.
	 *
	 * @param string $title Template title.
	 * @param string $type  UiChemy template type (header, footer, single, …).
	 * @return WP_Post|null
	 */
	protected function find_uichemy_template_by_title_and_type( $title, $type ) {
		if ( ! $this->is_uichemy_theme_builder_available() || ! class_exists( 'UiChemy_Template_CPT' ) ) {
			return null;
		}
		$candidates = get_posts(
			array(
				'post_type'      => UiChemy_Template_CPT::POST_TYPE,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'meta_key'       => UiChemy_Template_CPT::META_TYPE,
				'meta_value'     => $type,
			)
		);
		foreach ( $candidates as $post ) {
			if ( $post->post_title === $title ) {
				return $post;
			}
		}
		return null;
	}

	/**
	 * Create or update a UiChemy Theme Builder header/footer template from Elementor JSON.
	 *
	 * Only header and footer are handled by UiChemy; every other Theme Builder
	 * template stays on the Nexter Extension flow.
	 *
	 * @param string $title                         Template title (e.g. "Navbar", "Footer").
	 * @param mixed  $data                          Decoded Elementor JSON from the API.
	 * @param string $section_type                  'header' or 'footer'.
	 * @param array  $created_pages_for_nav_links   Pages created earlier in the same import (navbar link mapping).
	 * @return int|WP_Error Post ID or error.
	 */
	/**
	 * Translate the importer's Nexter-shaped descriptors into a UiChemy template
	 * type + placement.
	 *
	 * The import payload still speaks the vocabulary it always did — `section_type`
	 * for header/footer/404 and `el_type` + `archive_rule` for blog templates,
	 * because that is what the UiChemy export carries. Mapping it here keeps that
	 * contract untouched while the templates themselves move to UiChemy.
	 *
	 * @param string $section_type header|footer|page-404, or '' for a blog template.
	 * @param string $el_type      single|archive|search-results (blog templates only).
	 * @param string $archive_rule Nexter archive rule, e.g. category, post_tag, nxt_author.
	 * @return array{type:string,placement:array}|WP_Error
	 */
	protected function map_import_template_to_uichemy( $section_type, $el_type = '', $archive_rule = '' ) {
		$section = sanitize_key( (string) $section_type );
		$el      = sanitize_key( str_replace( '-', '_', (string) $el_type ) );
		$rule    = sanitize_key( (string) $archive_rule );

		// Whole-context types take no placement — they apply to their context
		// automatically (see UiChemy_Composer_Manager::normalize_theme_builder_placement).
		if ( 'header' === $section || 'footer' === $section ) {
			return array( 'type' => $section, 'placement' => array( 'scope' => 'entire' ) );
		}
		if ( 'page_404' === $section || 'page-404' === (string) $section_type ) {
			return array( 'type' => 'error_404', 'placement' => array() );
		}

		if ( 'single' === $el ) {
			// Nexter's "singular" covers posts; UiChemy wants the post type.
			return array( 'type' => 'single', 'placement' => array( 'post_type' => 'post' ) );
		}

		if ( 'search_results' === $el || 'nxt_search' === $rule ) {
			return array( 'type' => 'search', 'placement' => array() );
		}

		if ( 'archive' === $el ) {
			// Nexter archive rules → UiChemy's archive placement vocabulary.
			$archive = 'blog';
			if ( 'category' === $rule ) {
				$archive = 'tax:category';
			} elseif ( 'post_tag' === $rule ) {
				$archive = 'tax:post_tag';
			} elseif ( 'nxt_author' === $rule ) {
				$archive = 'author';
			} elseif ( 'date' === $rule ) {
				$archive = 'date';
			} elseif ( '' !== $rule && 0 === strpos( $rule, 'tax:' ) ) {
				$archive = $rule;
			} elseif ( '' !== $rule && taxonomy_exists( $rule ) ) {
				$archive = 'tax:' . $rule;
			}
			return array( 'type' => 'archive', 'placement' => array( 'archive' => $archive ) );
		}

		return new WP_Error(
			'IMPORT_UICHEMY_TMPL_BAD_TYPE',
			sprintf(
				/* translators: 1: section type, 2: elementor-style type */
				__( 'Could not map this template to a UiChemy type (section "%1$s", type "%2$s").', 'uichemy' ),
				$section_type,
				$el_type
			)
		);
	}

	protected function create_or_update_uichemy_template( $title, $data, $section_type, array $created_pages_for_nav_links = array(), $el_type = '', $archive_rule = '' ) {
		if ( ! $this->is_uichemy_theme_builder_available() ) {
			return new WP_Error(
				'IMPORT_UICHEMY_TB_NOT_ACTIVE',
				__( 'UiChemy Theme Builder is not active. Install and activate the UiChemy plugin.', 'uichemy' )
			);
		}

		$mapped = $this->map_import_template_to_uichemy( $section_type, $el_type, $archive_rule );
		if ( is_wp_error( $mapped ) ) {
			return $mapped;
		}
		$type      = $mapped['type'];
		$placement = $mapped['placement'];

		/*
		 * Archive / Search / the WooCommerce types are UiChemy Pro. On a Free build
		 * the template is SKIPPED, not failed: the rest of the import is perfectly
		 * usable without it, and stopping the whole run over one template the user
		 * cannot have would be a worse outcome than a missing archive layout.
		 *
		 * Its own error code, so callers can tell "you don't have this tier" apart
		 * from "the import broke" and word it for the user accordingly.
		 */
		if ( class_exists( 'UiChemy_Template_CPT' )
			&& ! in_array( $type, UiChemy_Template_CPT::allowed_types(), true ) ) {
			return new WP_Error(
				'IMPORT_UICHEMY_TMPL_PRO_ONLY',
				sprintf(
					/* translators: %s: template type, e.g. archive */
					__( 'Skipped "%s" templates. They need UiChemy Pro.', 'uichemy' ),
					str_replace( 'error_404', '404', $type )
				)
			);
		}

		/*
		 * Gutenberg export: block markup, not an Elementor tree. It goes to the
		 * Theme Builder as `content`, which the store writes to post_content
		 * verbatim — no asset resolving and no nav-link rewriting, because both of
		 * those walk an Elementor element array that does not exist here.
		 */
		if ( $this->is_gutenberg_replacement_data( $data ) ) {
			// Same re-import behaviour as the Elementor path: an earlier template
			// with this title+type is drafted, not left active alongside the new one.
			$existing_block = $this->find_uichemy_template_by_title_and_type( $title, $type );
			if ( $existing_block ) {
				$this->draft_existing_post_for_reimport( $existing_block->ID, 'uichemy_template' );
			}

			$result = apply_filters(
				'uichemy/theme_builder/create_template',
				null,
				array(
					'type'      => $type,
					'title'     => $title,
					'status'    => 'active',
					'editor'    => 'gutenberg',
					'placement' => $placement,
					'content'   => (string) $data['markup'],
					'source'    => 'uichemy-webpage',
				)
			);

			if ( is_wp_error( $result ) ) {
				return $result;
			}
			if ( null === $result ) {
				return new WP_Error(
					'IMPORT_UICHEMY_TB_NOT_ACTIVE',
					__( 'UiChemy Theme Builder did not handle the template creation request.', 'uichemy' )
				);
			}
			if ( is_array( $result ) && ! empty( $result['post_id'] ) ) {
				return (int) $result['post_id'];
			}
			return is_numeric( $result ) ? (int) $result : new WP_Error(
				'IMPORT_UICHEMY_TMPL_FAILED',
				__( 'UiChemy Theme Builder returned no template id.', 'uichemy' )
			);
		}

		$content = $this->extract_elementor_content( $data );
		if ( null === $content ) {
			return new WP_Error( 'IMPORT_UICHEMY_TMPL_INVALID_JSON', __( 'Invalid template JSON structure.', 'uichemy' ) );
		}

		// Match nav links to page permalinks — both header and footer carry menus.
		// Two shapes are supported: The Plus nav widget (ItemMenu/filterlabel) and
		// Composer code widgets, whose menu is plain <a href="#">Label</a> HTML.
		$wp_pages_map = $this->build_nav_menu_filterlabel_permalink_map_from_wp_pages();
		$created_map  = $this->build_nav_menu_filterlabel_permalink_map_from_created( $created_pages_for_nav_links );
		$nav_map      = array_merge( $wp_pages_map, $created_map );
		if ( ! empty( $nav_map ) ) {
			$this->apply_tp_navigation_item_menu_links_recursive( $content, $nav_map );
			$this->apply_composer_nav_links_recursive( $content, $nav_map );
		}

		$existing = $this->find_uichemy_template_by_title_and_type( $title, $type );
		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, 'uichemy_template' );
		}

		$content = $this->resolve_elementor_assets( $content );
		$content = $this->ensure_elementor_ids_are_strings( $content );

		// Build the hook payload. Navbar/footer exports are a single Composer code
		// widget, so pass its html/css/js — the shape UiChemy's own hook documents
		// for the import flow, and the one stock UiChemy supports out of the box
		// (it builds the container + Composer widget itself). Only fall back to
		// sending the raw element tree when the export is not Composer-based.
		$args = array(
			'type'          => $type,
			'title'         => $title,
			'status'        => 'active',
			'editor'        => 'elementor',
			'placement'     => $placement,
			// Assets were already sideloaded by resolve_elementor_assets() above.
			// Leaving this on would make UiChemy fetch every asset URL in the
			// markup, including site-relative font paths that loop back to this
			// site mid-request and stall the import.
			'upload_images' => false,
			'source'        => 'uichemy-webpage',
		);

		/*
		 * Several Composer widgets mean different things per type — see
		 * collect_composer_widget_settings(). header/footer are alternative
		 * designs: import the first, keep the rest as inactive drafts. Every
		 * other type is a stack of sections: merge them into one template, or
		 * six of seven sections vanish.
		 */
		$all_composers   = $this->collect_composer_widget_settings( $content );
		$is_multi_design = in_array( $type, array( 'header', 'footer' ), true );
		$alternates      = array();
		$section_tree    = null;
		$composer        = isset( $all_composers[0] ) ? $all_composers[0] : null;

		if ( $is_multi_design ) {
			$alternates = array_slice( $all_composers, 1 );
		} elseif ( count( $all_composers ) > 1 ) {
			/*
			 * Sections must stay SEPARATE widgets, one per section, exactly as they
			 * are on a page. Fusing them into a single Composer widget renders the
			 * same but destroys the structure: the editor would show one section
			 * instead of seven, and reordering, duplicating or deleting the author
			 * box would mean hand-editing HTML.
			 *
			 * The creation hook cannot express that — UiChemy_Composer_Manager
			 * mints exactly one container + one widget from html/css and ignores
			 * an `elements` payload. So the hook still runs (it owns type, status,
			 * placement, meta and the globals pass), and the real section tree is
			 * written over _elementor_data afterwards — the same meta, in the same
			 * shape, that create_or_update_elementor_page() writes for pages.
			 *
			 * Merged html is still handed to the hook rather than just the first
			 * section: if the post-write ever fails, the template that survives
			 * holds the WHOLE layout in one widget instead of one seventh of it.
			 */
			$composer      = $this->merge_composer_widget_settings( $all_composers );
			$section_tree  = $content;
		}

		if ( is_array( $composer ) ) {
			$args['html'] = isset( $composer['raw_html'] ) ? (string) $composer['raw_html'] : '';
			$args['css']  = isset( $composer['raw_css'] ) ? (string) $composer['raw_css'] : '';
			$args['js']   = isset( $composer['raw_js'] ) ? (string) $composer['raw_js'] : '';
		} else {
			// No Composer widget in the export (a plain Elementor container tree).
			// UiChemy_Template_Store::create() writes an `elements` tree to
			// _elementor_data directly, so this imports as-is.
			$args['elements'] = $content;
		}

		// Create through UiChemy's public hook rather than its internals, so this
		// keeps working if UiChemy changes its CPT/meta/store implementation.
		$result = apply_filters( 'uichemy/theme_builder/create_template', null, $args );

		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( null === $result ) {
			return new WP_Error(
				'IMPORT_UICHEMY_TB_NOT_ACTIVE',
				__( 'UiChemy Theme Builder did not handle the template creation request.', 'uichemy' )
			);
		}

		$post_id = 0;
		if ( is_array( $result ) && ! empty( $result['post_id'] ) ) {
			$post_id = (int) $result['post_id'];
		} elseif ( is_numeric( $result ) ) {
			$post_id = (int) $result;
		}

		if ( $post_id <= 0 ) {
			return new WP_Error(
				'IMPORT_UICHEMY_TMPL_CREATE_FAILED',
				__( 'UiChemy Theme Builder returned no template ID.', 'uichemy' )
			);
		}

		if ( null !== $section_tree ) {
			// Same meta, same shape, same slashing as the page importer uses.
			$json = wp_json_encode( $section_tree );
			if ( false !== $json ) {
				update_post_meta( $post_id, '_elementor_data', wp_slash( $json ) );
				$this->clear_elementor_files_cache();
			}
		}

		$this->create_alternate_uichemy_templates( $alternates, $title, $type, $placement );

		return $post_id;
	}

	/**
	 * Save the extra designs from a multi-design header/footer export as
	 * inactive templates.
	 *
	 * Deliberately non-fatal: the live template already exists by the time this
	 * runs, and losing a spare design is a far smaller failure than aborting an
	 * import over one. Each is numbered from the base title ("Navbar 2") and
	 * given the same placement, so activating one is a single click.
	 *
	 * @param array  $alternates Composer settings arrays after the first.
	 * @param string $title      Base title of the live template.
	 * @param string $type       UiChemy template type (header, footer).
	 * @param array  $placement  Placement of the live template.
	 * @return void
	 */
	protected function create_alternate_uichemy_templates( array $alternates, $title, $type, array $placement ) {
		if ( empty( $alternates ) ) {
			return;
		}

		foreach ( $alternates as $i => $settings ) {
			if ( ! is_array( $settings ) ) {
				continue;
			}
			$alt_title = sprintf( '%s %d', $title, $i + 2 );

			$existing = $this->find_uichemy_template_by_title_and_type( $alt_title, $type );
			if ( $existing ) {
				$this->draft_existing_post_for_reimport( $existing->ID, 'uichemy_template' );
			}

			apply_filters(
				'uichemy/theme_builder/create_template',
				null,
				array(
					'type'          => $type,
					'title'         => $alt_title,
					// The whole point: saved, switchable, and NOT rendering.
					'status'        => 'inactive',
					'editor'        => 'elementor',
					'placement'     => $placement,
					'upload_images' => false,
					'source'        => 'uichemy-webpage',
					'html'          => isset( $settings['raw_html'] ) ? (string) $settings['raw_html'] : '',
					'css'           => isset( $settings['raw_css'] ) ? (string) $settings['raw_css'] : '',
					'js'            => isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '',
				)
			);
		}
	}

	/**
	 * Re-apply nav links to UiChemy header AND footer templates (Elementor editor).
	 * Called after each page import so menus already saved get their placeholder
	 * links resolved once the target pages exist. Handles both The Plus nav
	 * widget (ItemMenu) and Composer code widgets (plain <a href="#">Label</a>).
	 *
	 * @return void
	 */
	protected function refresh_uichemy_header_nav_links() {
		if ( ! $this->is_uichemy_theme_builder_available() || ! class_exists( 'UiChemy_Template_CPT' ) ) {
			return;
		}
		$nav_map = $this->build_nav_menu_filterlabel_permalink_map_from_wp_pages();
		if ( empty( $nav_map ) ) {
			return;
		}
		$templates = get_posts(
			array(
				'post_type'      => UiChemy_Template_CPT::POST_TYPE,
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => UiChemy_Template_CPT::META_TYPE,
						'value'   => array( 'header', 'footer' ),
						'compare' => 'IN',
					),
				),
			)
		);
		foreach ( $templates as $tpl_post ) {
			$raw = get_post_meta( $tpl_post->ID, '_elementor_data', true );
			if ( empty( $raw ) || ( false === strpos( $raw, 'ItemMenu' ) && false === strpos( $raw, 'composer' ) ) ) {
				continue;
			}
			$content = json_decode( $raw, true );
			if ( ! is_array( $content ) ) {
				continue;
			}
			$this->apply_tp_navigation_item_menu_links_recursive( $content, $nav_map );
			$this->apply_composer_nav_links_recursive( $content, $nav_map );
			$updated = wp_json_encode( $content );
			if ( false === $updated || $updated === $raw ) {
				continue;
			}
			update_post_meta(
				$tpl_post->ID,
				'_elementor_data',
				wp_slash( $updated )
			);
		}
	}

	/**
	 * Ensure UiChemy plugin is installed and active.
	 *
	 * @return bool
	 */
	protected function ensure_uichemy_plugin() {
		$candidates = array(
			'uichemy/uichemy.php',
			'uichemy-pro/uichemy-pro.php',
		);
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		foreach ( $candidates as $plugin_slug ) {
			if ( is_plugin_active( $plugin_slug ) ) {
				return true;
			}
		}
		$all_plugins = get_plugins();
		foreach ( $candidates as $plugin_slug ) {
			$resolved = $this->resolve_plugin_file_from_slug( $plugin_slug, $all_plugins );
			if ( $resolved && is_plugin_active( $resolved ) ) {
				return true;
			}
			if ( $resolved ) {
				$activate_status = $this->uich_webpage_activate_plugin( $resolved );
				return ( $activate_status && ! is_wp_error( $activate_status ) );
			}
		}
		return $this->ensure_plugin_active_generic( 'uichemy/uichemy.php', 'uichemy' );
	}

	/**
	 * Header/footer Nexter template using block markup in post_content (Gutenberg URL import).
	 *
	 * @param string $title         Template title.
	 * @param string $post_content  Processed block markup.
	 * @param string $section_type  'header' or 'footer'.
	 * @return int|WP_Error Post ID or error.
	 */
	protected function create_or_update_nexter_template_gutenberg( $title, $post_content, $section_type ) {
		$cpt        = 'nxt_builder';
		$candidates = get_posts(
			array(
				'post_type'      => $cpt,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'meta_key'       => 'nxt-hooks-layout-sections',
				'meta_value'     => $section_type,
			)
		);
		$existing   = null;
		foreach ( $candidates as $p ) {
			if ( $p->post_title === $title ) {
				$existing = $p;
				break;
			}
		}

		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, $cpt );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
				'post_status' => 'publish',
				'post_type'   => $cpt,
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}
		add_post_meta( $post_id, 'nxt-hooks-layout-sections', $section_type, true );
		add_post_meta( $post_id, 'nxt_build_status', '1', true );

		// Assign unique TPGB block_ids with the correct post_id suffix.
		$post_content = $this->apply_unique_tpgb_block_ids( $post_content, (int) $post_id );

		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( $post_content ),
			)
		);

		delete_post_meta( $post_id, '_elementor_data' );
		delete_post_meta( $post_id, '_elementor_edit_mode' );
		delete_post_meta( $post_id, '_elementor_template_type' );

		update_post_meta( $post_id, 'nxt-add-display-rule', array( 'standard-universal' ) );
		add_post_meta( $post_id, 'nxt_build_status', '1', true );

		// Remove stale per-post CSS so TPGB regenerates it on the next real page load,
		// at which point all blocks are registered and globalTypo remapping is reflected.
		$this->invalidate_tpgb_block_css_file( $post_id );

		return $post_id;
	}

	/**
	 * Create or update a Nexter extension Theme Builder template (nxt_builder) for header or footer.
	 * Same flow as wdesignkit: nxt_builder post type with nxt-hooks-layout-sections and Elementor data.
	 *
	 * @param string $title        Template title (e.g. "Navbar", "Footer").
	 * @param mixed  $data        Decoded JSON from the API.
	 * @param string $section_type              Nexter section type: 'header', 'footer', or 'page-404'.
	 * @param array  $created_pages_for_nav_links Optional. Pages created earlier in the same import; used to set
	 *                                            tp-navigation-menu-lite ItemMenu LinkFilter URLs from filterlabel.
	 * @return int|WP_Error Post ID or error.
	 */
	protected function create_or_update_nexter_template( $title, $data, $section_type, array $created_pages_for_nav_links = array() ) {
		if ( $this->is_gutenberg_replacement_data( $data ) ) {
			$post_content = $this->process_gutenberg_markup_to_post_content( $data['markup'] );
			if ( is_wp_error( $post_content ) ) {
				return $post_content;
			}
			if ( 'header' === $section_type ) {
				$wp_pages_map = $this->build_nav_menu_filterlabel_permalink_map_from_wp_pages();
				$created_map  = $this->build_nav_menu_filterlabel_permalink_map_from_created( $created_pages_for_nav_links );
				$nav_map      = array_merge( $wp_pages_map, $created_map );
				if ( ! empty( $nav_map ) ) {
					$post_content = $this->apply_gutenberg_nav_item_menu_links( $post_content, $nav_map );
				}
			}
			return $this->create_or_update_nexter_template_gutenberg( $title, $post_content, $section_type );
		}

		$content = $this->extract_elementor_content( $data );
		if ( null === $content ) {
			return new WP_Error( 'IMPORT_NEXTER_TMPL_INVALID_JSON', __( 'Invalid template JSON structure.', 'uichemy' ) );
		}

		// Match nav menu filterlabel to page titles (see tp-navigation-menu-lite ItemMenu in navbar JSON).
		if ( 'header' === $section_type ) {
			$wp_pages_map = $this->build_nav_menu_filterlabel_permalink_map_from_wp_pages();
			$created_map  = $this->build_nav_menu_filterlabel_permalink_map_from_created( $created_pages_for_nav_links );
			$nav_map      = array_merge( $wp_pages_map, $created_map );
			if ( ! empty( $nav_map ) ) {
				$this->apply_tp_navigation_item_menu_links_recursive( $content, $nav_map );
			}
		}

		$cpt        = 'nxt_builder';
		$candidates = get_posts(
			array(
				'post_type'      => $cpt,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'meta_key'       => 'nxt-hooks-layout-sections',
				'meta_value'     => $section_type,
			)
		);
		$existing   = null;
		foreach ( $candidates as $p ) {
			if ( $p->post_title === $title ) {
				$existing = $p;
				break;
			}
		}

		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, $cpt );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
				'post_status' => 'publish',
				'post_type'   => $cpt,
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}
		add_post_meta( $post_id, 'nxt-hooks-layout-sections', $section_type, true );
		add_post_meta( $post_id, 'nxt_build_status', '1', true );

		// Resolve remote images (download, dedupe by URL hash, replace URLs in content).
		$content = $this->resolve_elementor_assets( $content );
		$content = $this->ensure_elementor_ids_are_strings( $content );

		$json_string = wp_json_encode( $content );
		if ( false === $json_string ) {
			return new WP_Error( 'IMPORT_NEXTER_TMPL_ENCODE_FAILED', __( 'Could not encode template data.', 'uichemy' ) );
		}
		update_post_meta( $post_id, '_elementor_data', wp_slash( $json_string ) );
		update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );

		// Display condition: show header/footer on entire website (same as wdesignkit).
		update_post_meta( $post_id, 'nxt-add-display-rule', array( 'standard-universal' ) );
		add_post_meta( $post_id, 'nxt_build_status', '1', true );

		return $post_id;
	}

	/**
	 * Create or update a Nexter Theme Builder hooks template (nxt_builder) for cookie-consent-style sections.
	 * Sets nxt-hooks-layout-sections = 'hooks' and nxt-display-hooks-action to the given action hook.
	 * Handles both Elementor JSON and Gutenberg HTML markup.
	 *
	 * @param string $title        Template title (e.g. "Cookie Policy").
	 * @param mixed  $data         Decoded JSON from the API (Elementor) or Gutenberg shape ({ _uich_webpage_gutenberg, markup }).
	 * @param string $hooks_action Nexter hooks action (e.g. 'nxt_footer_before').
	 * @return int|WP_Error Post ID or error.
	 */
	protected function create_or_update_nexter_hooks_template( $title, $data, $hooks_action = 'nxt_footer_before' ) {
		if ( ! post_type_exists( 'nxt_builder' ) ) {
			return new WP_Error( 'IMPORT_NEXTER_NOT_ACTIVE', __( 'Nexter Extension is not active.', 'uichemy' ) );
		}

		// ── Gutenberg path ────────────────────────────────────────────────────
		if ( $this->is_gutenberg_replacement_data( $data ) ) {
			$post_content = $this->process_gutenberg_markup_to_post_content( $data['markup'] );
			if ( is_wp_error( $post_content ) ) {
				return $post_content;
			}
			return $this->create_or_update_nexter_hooks_template_gutenberg( $title, $post_content, $hooks_action );
		}

		// ── Elementor path ────────────────────────────────────────────────────
		$content = $this->extract_elementor_content( $data );
		if ( null === $content ) {
			return new WP_Error( 'IMPORT_NEXTER_TMPL_INVALID_JSON', __( 'Invalid template JSON structure.', 'uichemy' ) );
		}

		$cpt        = 'nxt_builder';
		$candidates = get_posts(
			array(
				'post_type'      => $cpt,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'meta_key'       => 'nxt-hooks-layout-sections',
				'meta_value'     => 'hooks',
			)
		);
		$existing   = null;
		foreach ( $candidates as $p ) {
			if ( $p->post_title === $title ) {
				$existing = $p;
				break;
			}
		}

		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, $cpt );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
				'post_status' => 'publish',
				'post_type'   => $cpt,
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		add_post_meta( $post_id, 'nxt-hooks-layout-sections', 'hooks', true );
		add_post_meta( $post_id, 'nxt-display-hooks-action', $hooks_action, true );
		add_post_meta( $post_id, 'nxt_build_status', '1', true );

		// Resolve remote images (download, dedupe by URL hash, replace URLs in content).
		$content = $this->resolve_elementor_assets( $content );
		$content = $this->ensure_elementor_ids_are_strings( $content );

		$json_string = wp_json_encode( $content );
		if ( false === $json_string ) {
			return new WP_Error( 'IMPORT_NEXTER_TMPL_ENCODE_FAILED', __( 'Could not encode template data.', 'uichemy' ) );
		}
		update_post_meta( $post_id, '_elementor_data', wp_slash( $json_string ) );
		update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );

		// Display condition: show on front/home page only.
		update_post_meta( $post_id, 'nxt-add-display-rule', array( 'default-front' ) );

		return $post_id;
	}

	/**
	 * Gutenberg branch of create_or_update_nexter_hooks_template.
	 * Creates an nxt_builder hooks post whose content is Gutenberg block markup (e.g. Cookie Policy popup).
	 *
	 * @param string $title        Template title.
	 * @param string $post_content Processed Gutenberg block markup (from process_gutenberg_markup_to_post_content).
	 * @param string $hooks_action Nexter hooks action (e.g. 'nxt_footer_before').
	 * @return int|WP_Error Post ID or error.
	 */
	protected function create_or_update_nexter_hooks_template_gutenberg( $title, $post_content, $hooks_action ) {
		$cpt        = 'nxt_builder';
		$candidates = get_posts(
			array(
				'post_type'      => $cpt,
				'post_status'    => 'any',
				'posts_per_page' => -1,
				'meta_key'       => 'nxt-hooks-layout-sections',
				'meta_value'     => 'hooks',
			)
		);
		$existing = null;
		foreach ( $candidates as $p ) {
			if ( $p->post_title === $title ) {
				$existing = $p;
				break;
			}
		}
		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, $cpt );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
				'post_status' => 'publish',
				'post_type'   => $cpt,
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		add_post_meta( $post_id, 'nxt-hooks-layout-sections', 'hooks', true );
		add_post_meta( $post_id, 'nxt-display-hooks-action', $hooks_action, true );
		add_post_meta( $post_id, 'nxt_build_status', '1', true );

		// Assign unique TPGB block_ids scoped to this post (prevents CSS collisions with other templates).
		$post_content = $this->apply_unique_tpgb_block_ids( $post_content, (int) $post_id );

		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( $post_content ),
			)
		);

		// Clear any stale Elementor metas (safety: none should exist on a fresh post, but guard on re-import).
		delete_post_meta( $post_id, '_elementor_data' );
		delete_post_meta( $post_id, '_elementor_edit_mode' );
		delete_post_meta( $post_id, '_elementor_template_type' );

		// Cookie Policy popup is shown on the home page only.
		update_post_meta( $post_id, 'nxt-add-display-rule', array( 'default-front' ) );
		add_post_meta( $post_id, 'nxt_build_status', '1', true );

		// Remove stale per-post CSS so TPGB regenerates it on the next real page load.
		$this->invalidate_tpgb_block_css_file( $post_id );

		return $post_id;
	}

	/**
	 * Ensure Nexter Extension plugin is installed and active.
	 * Used by ensure_all_nexter_requirements() for /install-requirements endpoint.
	 *
	 * @return bool True if Nexter Extension is active (or was installed/activated), false otherwise.
	 */
	protected function ensure_nexter_extension() {
		return $this->ensure_plugin_active_generic(
			'nexter-extension/nexter-extension.php',
			'nexter-extension'
		);
	}

	/**
	 * Ensure The Plus Addons for Block Editor plugin is installed and active.
	 * Plugin slug: the-plus-addons-for-block-editor/the-plus-addons-for-block-editor.php
	 *
	 * @return bool True if plugin is active (or was installed/activated), false otherwise.
	 */
	protected function ensure_theplus_block_editor() {
		$plugin_slug   = 'the-plus-addons-for-block-editor/the-plus-addons-for-block-editor.php';
		$original_slug = 'the-plus-addons-for-block-editor';

		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		// Check if already active.
		if ( is_plugin_active( $plugin_slug ) ) {
			return true;
		}

		// Check by folder name in case main file is different.
		$all_plugins = get_plugins();
		foreach ( $all_plugins as $key => $data ) {
			if ( strpos( $key, 'the-plus-addons-for-block-editor/' ) === 0 ) {
				if ( is_plugin_active( $key ) ) {
					return true;
				}
				// Installed but not active - activate it.
				$activate_status = $this->uich_webpage_activate_plugin( $key );
				return ( $activate_status && ! is_wp_error( $activate_status ) );
			}
		}

		// Not installed - install from WordPress.org.
		return $this->ensure_plugin_active_generic( $plugin_slug, $original_slug );
	}

	/**
	 * Ensure all required dependencies for Nexter-based imports are installed and active.
	 *
	 * Checks and installs 3 fixed Nexter items:
	 * 1. Theme: Nexter
	 * 2. Plugin: nexter-extension
	 * 3. Plugin: the-plus-addons-for-block-editor
	 *
	 * Note: Elementor and The Plus Addons for Elementor are installed automatically
	 * during fetch phase via ensure_required_plugins_from_globals() based on globals.json.
	 *
	 * @return array Status of each requirement.
	 */
	public function ensure_all_nexter_requirements( $builder = 'elementor' ) {
		$results = array(
			'theme'   => array(
				'name'    => 'nexter',
				'success' => $this->ensure_nexter_theme(),
			),
			'plugins' => array(
				// Nexter Extension is no longer installed by the importer. Every
				// Theme Builder template — header, footer, and every other type,
				// both editors — now goes to the UiChemy Theme Builder
				// (uichemy_template CPT), so the nxt_builder CPT is not needed for a
				// new import. The only thing that ever needed it was the Cookie
				// Policy hooks template, which is now skipped when Nexter is absent.
				//
				// The Plus Addons (Elementor and Block Editor, free and pro) are
				// likewise not installed: they were never required to render an
				// imported design, and installing large addon suites unasked is not
				// something an import should decide for the user.
			),
		);

		// UiChemy owns the Theme Builder for BOTH builders now, so it is required
		// either way.
		if ( 'elementor' === $builder ) {
			$results['plugins'][] = array(
				'name'    => 'uichemy',
				'success' => $this->ensure_uichemy_plugin(),
			);
		}

		return $results;
	}

	/**
	 * Ensure a plugin is installed and active using WordPress.org API + Plugin_Upgrader.
	 *
	 * @param string $plugin_slug   Plugin file, e.g. 'elementor/elementor.php'.
	 * @param string $original_slug Plugin slug on wp.org, e.g. 'elementor'.
	 * @return bool True if active (or activated), false otherwise.
	 */
	protected function ensure_plugin_active_generic( $plugin_slug, $original_slug ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		$all_plugins = get_plugins();
		$resolved    = $this->resolve_plugin_file_from_slug( $plugin_slug, $all_plugins );
		if ( $resolved ) {
			$plugin_slug = $resolved;
		}

		if ( is_plugin_active( $plugin_slug ) ) {
			return true;
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		include_once ABSPATH . 'wp-admin/includes/plugin-install.php';

		$installed = isset( $all_plugins[ $plugin_slug ] );

		if ( $installed ) {
			$activate_status = $this->uich_webpage_activate_plugin( $plugin_slug );
			return ( $activate_status && ! is_wp_error( $activate_status ) );
		}

		if ( ! current_user_can( 'install_plugins' ) ) {
			return false;
		}

		$plugin_api = plugins_api(
			'plugin_information',
			array(
				'slug'   => sanitize_key( wp_unslash( $original_slug ) ),
				'fields' => array( 'sections' => false ),
			)
		);

		if ( is_wp_error( $plugin_api ) ) {
			return false;
		}

		$download_url = isset( $plugin_api->download_link ) ? $plugin_api->download_link : null;
		if ( empty( $download_url ) ) {
			return false;
		}

		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = new Plugin_Upgrader( $skin );
		$result   = $upgrader->install( $download_url );

		if ( is_wp_error( $result ) ) {
			return false;
		}
		if ( is_wp_error( $skin->result ) ) {
			return false;
		}
		if ( $skin->get_errors()->has_errors() ) {
			return false;
		}
		if ( is_null( $result ) ) {
			return false;
		}

		$install_status  = install_plugin_install_status( $plugin_api );
		$file_to_use     = ( ! empty( $install_status['file'] ) ) ? $install_status['file'] : $plugin_slug;
		$activate_status = $this->uich_webpage_activate_plugin( $file_to_use );

		return ( $activate_status && ! is_wp_error( $activate_status ) );
	}

	/**
	 * Activate a plugin (same logic as wdesignkit Wdkit_Depends_Installer::wdkit_activate_plugin).
	 *
	 * @param string $plugin_file Plugin basename (e.g. nexter-extension/nexter-extension.php).
	 * @return bool|WP_Error True on success, WP_Error on failure, false if not activated.
	 */
	protected function uich_webpage_activate_plugin( $plugin_file ) {
		if ( current_user_can( 'activate_plugin', $plugin_file ) && is_plugin_inactive( $plugin_file ) ) {
			$result = activate_plugin( $plugin_file, false, false );
			if ( is_wp_error( $result ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'INSTALL_PLUGIN_ACTIVATE_WP_ERROR', array( 'message' => $result->get_error_message(), 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'plugin_file' => $plugin_file ) ) );
				return $result;
			}
			return true;
		}
		if ( is_plugin_active( $plugin_file ) ) {
			return true;
		}
		return false;
	}

	/**
	 * Extract Elementor content array from API JSON (array of elements or object with 'content').
	 *
	 * @param mixed $data Decoded JSON.
	 * @return array|null Content array for _elementor_data, or null if invalid.
	 */
	protected function extract_elementor_content( $data ) {
		if ( ! is_array( $data ) ) {
			return null;
		}
		// Object with 'content' key (full document) – use inner content only.
		if ( isset( $data['content'] ) && is_array( $data['content'] ) ) {
			return $this->normalize_elementor_elements( $data['content'] );
		}
		// Object with 'elements' key.
		if ( isset( $data['elements'] ) && is_array( $data['elements'] ) ) {
			return $this->normalize_elementor_elements( $data['elements'] );
		}
		// Object with 'data' key (common API wrapper).
		if ( isset( $data['data'] ) && is_array( $data['data'] ) ) {
			return $this->extract_elementor_content( $data['data'] );
		}
		// Single element (section/container) – wrap in array.
		if ( isset( $data['id'] ) && isset( $data['elType'] ) ) {
			return array( $data );
		}
		// Already an array (e.g. [ document ] or [ element, element ]). Accept 0-based list or JSON with "0","1" keys.
		$keys = array_keys( $data );
		if ( range( 0, count( $data ) - 1 ) === $keys ) {
			return $this->normalize_elementor_elements( $data );
		}
		if ( ! empty( $data ) && array_filter( $keys, 'is_numeric' ) === $keys ) {
			return $this->normalize_elementor_elements( array_values( $data ) );
		}
		return null;
	}

	/**
	 * Ensure every top-level item is an Elementor element (has elType), not a document wrapper.
	 * Document wrappers have 'content' + ('type'|'version') and no 'elType' – replace with their inner content.
	 *
	 * @param array $elements Array of items (elements or document wrappers).
	 * @return array Flat list of Elementor elements only.
	 */
	protected function normalize_elementor_elements( array $elements ) {
		$out = array();
		foreach ( $elements as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			// Document wrapper: has content + type/version, no elType – unwrap and flatten.
			if ( isset( $item['content'] ) && is_array( $item['content'] ) && ( isset( $item['type'] ) || isset( $item['version'] ) ) && empty( $item['elType'] ) ) {
				$inner = $this->normalize_elementor_elements( $item['content'] );
				foreach ( $inner as $el ) {
					$out[] = $el;
				}
				continue;
			}
			$out[] = $item;
		}
		return $out;
	}

	/**
	 * Extract global color map from globals.json data.
	 *
	 * Supports:
	 * - Legacy: id => hex string, e.g. {"9f11cb7":"#6366F1"}.
	 * - Current: id => { "color": "#3328BF", "title": "Primary" } (title shown in Elementor kit).
	 * - Optional "colors" key with the same entry shapes.
	 * Skips requiredPlugins, typography, fonts, global_typography.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array Map of color_id => array{ hex: string, title: string }.
	 */
	protected function extract_global_colors_from_globals( array $globals ) {
		$colors = array();

		$add_color = function ( $id, $value ) use ( &$colors ) {
			$sid = sanitize_key( (string) $id );
			if ( '' === $sid ) {
				return;
			}
			// Legacy: id => "#RRGGBB" (or with alpha).
			if ( is_string( $value ) && preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $value ) ) {
				$colors[ $sid ] = array(
					'hex'   => $value,
					'title' => sprintf( 'Global %s', $sid ),
				);
				return;
			}
			// New: { "color": "#...", "title": "Primary" }.
			if ( is_array( $value ) && isset( $value['color'] ) && is_string( $value['color'] ) ) {
				$hex = trim( $value['color'] );
				if ( ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $hex ) ) {
					return;
				}
				$title = '';
				if ( isset( $value['title'] ) && is_string( $value['title'] ) && '' !== $value['title'] ) {
					$title = $value['title'];
				} elseif ( isset( $value['name'] ) && is_string( $value['name'] ) && '' !== $value['name'] ) {
					$title = $value['name'];
				} else {
					$title = sprintf( 'Global %s', $sid );
				}
				$colors[ $sid ] = array(
					'hex'   => $hex,
					'title' => $title,
				);
			}
		};

		// Explicit "colors" key.
		if ( isset( $globals['colors'] ) && is_array( $globals['colors'] ) ) {
			foreach ( $globals['colors'] as $id => $value ) {
				$add_color( $id, $value );
			}
			return $colors;
		}

		// Root-level id => hex or id => { color, title } (skip known meta keys).
		$skip_keys = array(
			'requiredPlugins',
			'typography',
			'fonts',
			'metadata',
			'global_typography',
			'global_button_styles',
			'global_dimensions',
			'global_box_shadows',
			'global_gsap_scroll',
			'global_scroll_animations',
		);
		foreach ( $globals as $key => $value ) {
			if ( in_array( $key, $skip_keys, true ) ) {
				continue;
			}
			$add_color( $key, $value );
		}

		return $colors;
	}

	/**
	 * Extract global typography map from globals.json data.
	 *
	 * Supports:
	 * - globals['global_typography'] as id => typography settings (Elementor-compatible keys)
	 * - globals['typography'] as id => typography settings
	 *
	 * Each entry is normalized to include an '_id' matching the map key.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array Map of typography_id => typography array.
	 */
	protected function extract_global_typography_from_globals( array $globals ) {
		$raw = array();

		if ( isset( $globals['global_typography'] ) && is_array( $globals['global_typography'] ) ) {
			$raw = $globals['global_typography'];
		} elseif ( isset( $globals['typography'] ) && is_array( $globals['typography'] ) ) {
			$raw = $globals['typography'];
		}

		if ( empty( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $id => $value ) {
			if ( ! is_array( $value ) ) {
				continue;
			}
			$tid = sanitize_key( (string) $id );
			if ( '' === $tid ) {
				continue;
			}
			$item        = $value;
			$item['_id'] = $tid;
			$out[ $tid ] = $item;
		}

		return $out;
	}

	/**
	 * Pick the kit's intended body font: the font-family that appears most often across
	 * its typography tokens. Kits have no single token flagged "this is body text", but
	 * they typically ship one workhorse family used by most "Text" tokens plus an accent
	 * family for a couple of "Display"/heading tokens — majority vote favors the workhorse
	 * family without needing to know which token id means "body".
	 *
	 * @param array $globals_data Decoded globals.json.
	 * @return string Bare font family name (e.g. "Libre Franklin"), or '' if none found.
	 */
	protected function extract_majority_font_family_from_globals( array $globals_data ) {
		$typo_map = $this->extract_global_typography_from_globals( $globals_data );
		if ( empty( $typo_map ) ) {
			return '';
		}

		$counts = array();
		foreach ( $typo_map as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			// Elementor-shaped globals.json (global_typography) uses typography_font_family
			// with a bare name ("Libre Franklin"); the Gutenberg/TPGB shape (typography) uses
			// font-family with a CSS-ready stack ("'Libre Franklin',sans-serif"). Check both.
			$raw = '';
			if ( ! empty( $item['typography_font_family'] ) && is_string( $item['typography_font_family'] ) ) {
				$raw = $item['typography_font_family'];
			} elseif ( ! empty( $item['font-family'] ) && is_string( $item['font-family'] ) ) {
				$raw = $item['font-family'];
			}
			if ( '' === $raw ) {
				continue;
			}
			// Nexter's body-font-family option wants just the bare family name (it adds its
			// own fallback), so strip any fallback stack and surrounding quotes either way.
			$name = trim( explode( ',', $raw )[0] );
			$name = trim( $name, "'\"" );
			if ( '' === $name ) {
				continue;
			}
			$counts[ $name ] = ( isset( $counts[ $name ] ) ? $counts[ $name ] : 0 ) + 1;
		}

		if ( empty( $counts ) ) {
			return '';
		}

		arsort( $counts );
		return (string) array_key_first( $counts );
	}

	/**
	 * Parse WDesignKit / export strings like "12px" into Elementor slider arrays for The Plus global controls.
	 *
	 * @param mixed $val Raw value from globals.json.
	 * @return array{ size: float, unit: string }
	 */
	protected function parse_tpae_slider_from_globals_value( $val ) {
		if ( is_array( $val ) ) {
			$size = isset( $val['size'] ) && is_numeric( $val['size'] ) ? (float) $val['size'] : 0.0;
			$unit = isset( $val['unit'] ) && is_string( $val['unit'] ) ? $val['unit'] : 'px';
			return array( 'size' => $size, 'unit' => $unit );
		}
		if ( is_numeric( $val ) ) {
			return array(
				'size' => (float) $val,
				'unit' => 'px',
			);
		}
		$s = is_string( $val ) ? trim( $val ) : '';
		if ( '' !== $s && preg_match( '/^(-?[0-9.]+)\s*(px|em|rem|%)?$/i', $s, $m ) ) {
			return array(
				'size' => (float) $m[1],
				'unit' => ! empty( $m[2] ) ? strtolower( $m[2] ) : 'px',
			);
		}
		return array(
			'size' => 0.0,
			'unit' => 'px',
		);
	}

	/**
	 * Build tp_global_button_style_list rows from globals.json (The Plus Addons kit repeater).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array<int, array<string, mixed>> Repeater rows with string _id.
	 */
	protected function extract_tp_global_button_style_list_from_globals( array $globals ) {
		if ( empty( $globals['global_button_styles'] ) || ! is_array( $globals['global_button_styles'] ) ) {
			return array();
		}

		$out = array();
		foreach ( $globals['global_button_styles'] as $id => $value ) {
			if ( ! is_array( $value ) ) {
				continue;
			}
			$tid = sanitize_key( (string) $id );
			if ( '' === $tid ) {
				continue;
			}
			$item = $value;
			if ( isset( $item['bg_color'] ) ) {
				if ( ! isset( $item['background_color'] ) || '' === (string) $item['background_color'] ) {
					$item['background_color'] = $item['bg_color'];
				}
				unset( $item['bg_color'] );
			}
			if ( isset( $item['hover_bg_color'] ) ) {
				if ( ! isset( $item['hover_background_color'] ) || '' === (string) $item['hover_background_color'] ) {
					$item['hover_background_color'] = $item['hover_bg_color'];
				}
				unset( $item['hover_bg_color'] );
			}

			$item['_id'] = $tid;
			if ( empty( $item['name'] ) || ! is_string( $item['name'] ) ) {
				$item['name'] = sprintf( 'Global %s', $tid );
			}
			$out[] = $item;
		}
		return $out;
	}

	/**
	 * Map one globals.json dimension block (or legacy flat top/right/unit) to a tpae tdm_values row.
	 *
	 * @param array<string, mixed> $raw Nested `tdm_values` / `tdm_values_tablet` / `tdm_values_mobile` object, or a legacy entry with top/right at root.
	 * @return array<string, mixed>
	 */
	protected function build_tpae_dimension_tdm_block_from_globals( array $raw ) {
		$unit = isset( $raw['unit'] ) && is_string( $raw['unit'] ) && '' !== $raw['unit'] ? $raw['unit'] : 'px';
		if ( array_key_exists( 'isLinked', $raw ) ) {
			$is_linked = (bool) $raw['isLinked'];
		} else {
			$is_linked = ! empty( $raw['linked'] );
		}
		$block  = array(
			'top'      => isset( $raw['top'] ) ? (string) $raw['top'] : '',
			'right'    => isset( $raw['right'] ) ? (string) $raw['right'] : '',
			'bottom'   => isset( $raw['bottom'] ) ? (string) $raw['bottom'] : '',
			'left'     => isset( $raw['left'] ) ? (string) $raw['left'] : '',
			'unit'     => $unit,
			'isLinked' => $is_linked,
		);
		$preset = $raw['tp_global_preset'] ?? null;
		if ( null !== $preset ) {
			$block['tp_global_preset'] = is_string( $preset ) ? $preset : '';
		} else {
			$block['tp_global_preset'] = '';
		}
		return $block;
	}

	/**
	 * Build tp_global_dimensions_list rows from globals.json (The Plus Addons kit repeater).
	 *
	 * Expects per-entry `tdm_values`, optional `tdm_values_tablet`, `tdm_values_mobile` (The Plus / Elementor-style boxes);
	 * also accepts legacy flat `top`/`right`/`unit`/`linked` on the entry root.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array<int, array<string, mixed>>
	 */
	protected function extract_tp_global_dimensions_list_from_globals( array $globals ) {
		if ( empty( $globals['global_dimensions'] ) || ! is_array( $globals['global_dimensions'] ) ) {
			return array();
		}
		$out = array();
		foreach ( $globals['global_dimensions'] as $id => $value ) {
			if ( ! is_array( $value ) ) {
				continue;
			}
			$tid = sanitize_key( (string) $id );
			if ( ! empty( $value['_id'] ) && is_string( $value['_id'] ) ) {
				$from_entry = sanitize_key( $value['_id'] );
				if ( '' !== $from_entry ) {
					$tid = $from_entry;
				}
			}
			if ( '' === $tid ) {
				continue;
			}
			if ( isset( $value['tdm_values'] ) && is_array( $value['tdm_values'] ) ) {
				$tdm = $this->build_tpae_dimension_tdm_block_from_globals( $value['tdm_values'] );
			} else {
				$tdm = $this->build_tpae_dimension_tdm_block_from_globals( $value );
			}
			$row = array(
				'_id'        => $tid,
				'name'       => ( ! empty( $value['name'] ) && is_string( $value['name'] ) ) ? $value['name'] : sprintf( 'Global %s', $tid ),
				'tdm_values' => $tdm,
			);
			if ( ! empty( $value['tdm_values_tablet'] ) && is_array( $value['tdm_values_tablet'] ) ) {
				$row['tdm_values_tablet'] = $this->build_tpae_dimension_tdm_block_from_globals( $value['tdm_values_tablet'] );
			}
			if ( ! empty( $value['tdm_values_mobile'] ) && is_array( $value['tdm_values_mobile'] ) ) {
				$row['tdm_values_mobile'] = $this->build_tpae_dimension_tdm_block_from_globals( $value['tdm_values_mobile'] );
			}
			$out[] = $row;
		}
		return $out;
	}

	/**
	 * Build tp_global_box_shadow_list rows from globals.json (The Plus Addons kit repeater).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array<int, array<string, mixed>>
	 */
	protected function extract_tp_global_box_shadow_list_from_globals( array $globals ) {
		if ( empty( $globals['global_box_shadows'] ) || ! is_array( $globals['global_box_shadows'] ) ) {
			return array();
		}

		$out = array();
		foreach ( $globals['global_box_shadows'] as $id => $value ) {
			if ( ! is_array( $value ) ) {
				continue;
			}
			$tid = sanitize_key( (string) $id );
			if ( '' === $tid ) {
				continue;
			}
			$item = $value;
			$item['_id'] = $tid;
			if ( empty( $item['name'] ) || ! is_string( $item['name'] ) ) {
				$item['name'] = sprintf( 'Global %s', $tid );
			}

			// Normalise gbs_type to TPAE expected values.
			$type_raw        = isset( $item['gbs_type'] ) ? strtolower( (string) $item['gbs_type'] ) : ( isset( $item['type'] ) ? strtolower( (string) $item['type'] ) : 'outset' );
			$item['gbs_type'] = ( 'inset' === $type_raw || 'bst_inset' === $type_raw ) ? 'bst_inset' : 'bst_outset';

			// Normalise slider fields.
			foreach ( array( 'gbs_x', 'gbs_y', 'gbs_blur', 'gbs_spread' ) as $slider ) {
				$fallback        = array( 'gbs_x' => 'x', 'gbs_y' => 'y', 'gbs_blur' => 'blur', 'gbs_spread' => 'spread' );
				$item[ $slider ] = $this->parse_tpae_slider_from_globals_value( $item[ $slider ] ?? $value[ $fallback[ $slider ] ] ?? 0 );
			}

			// Default gbs_color if missing.
			if ( empty( $item['gbs_color'] ) ) {
				$item['gbs_color'] = isset( $item['color'] ) ? $item['color'] : 'rgba(0,0,0,0.2)';
			}

			$out[] = $item;
		}
		return $out;
	}

	/**
	 * Build tp_global_gsap_list rows from globals.json (The Plus global scroll interactions / GSAP).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array<int, array<string, mixed>>
	 */
	protected function extract_tp_global_gsap_list_from_globals( array $globals ) {
		if ( empty( $globals['global_gsap_scroll'] ) || ! is_array( $globals['global_gsap_scroll'] ) ) {
			return array();
		}
		$out = array();
		foreach ( $globals['global_gsap_scroll'] as $id => $value ) {
			if ( ! is_array( $value ) ) {
				continue;
			}
			$tid = sanitize_key( (string) $id );
			if ( '' === $tid ) {
				continue;
			}
			$item        = $value;
			$item['_id'] = $tid;
			if ( empty( $item['name'] ) || ! is_string( $item['name'] ) ) {
				$item['name'] = sprintf( 'Global %s', $tid );
			}
			$out[] = $item;
		}
		return $out;
	}

	/**
	 * Build tp_global_scroll_animation_list rows from globals.json (The Plus global scroll animation presets).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array<int, array<string, mixed>>
	 */
	protected function extract_tp_global_scroll_animation_list_from_globals( array $globals ) {
		if ( empty( $globals['global_scroll_animations'] ) || ! is_array( $globals['global_scroll_animations'] ) ) {
			return array();
		}
		$out = array();
		foreach ( $globals['global_scroll_animations'] as $id => $value ) {
			if ( ! is_array( $value ) ) {
				continue;
			}
			$tid = sanitize_key( (string) $id );
			if ( '' === $tid ) {
				continue;
			}
			$item        = $value;
			$item['_id'] = $tid;
			if ( empty( $item['name'] ) || ! is_string( $item['name'] ) ) {
				$item['name'] = sprintf( 'Global %s', $tid );
			}
			$out[] = $item;
		}
		return $out;
	}

	/**
	 * Extract required plugins list from globals.json (requiredPlugins array of names).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of plugin names.
	 */
	protected function extract_required_plugins_from_globals( array $globals ) {
		if ( empty( $globals['requiredPlugins'] ) || ! is_array( $globals['requiredPlugins'] ) ) {
			return array();
		}

		$list = array();
		foreach ( $globals['requiredPlugins'] as $plugin_name ) {
			if ( is_string( $plugin_name ) && '' !== $plugin_name ) {
				$list[] = $plugin_name;
			}
		}

		return $list;
	}

	/**
	 * Ensure any plugins listed in globals.json->requiredPlugins are installed and active.
	 * Supports Elementor, The Plus Addons for Elementor, and Nexter Blocks / The Plus Addons for Block Editor.
	 *
	 * @param array $globals_data Decoded globals.json.
	 */
	protected function ensure_required_plugins_from_globals( array $globals_data ) {
		$required = $this->extract_required_plugins_from_globals( $globals_data );
		if ( empty( $required ) ) {
			return;
		}

		$plugin_total = count( $required );
		$plugin_done  = 0;

		foreach ( $required as $name ) {
			$name_lower = strtolower( $name );

			// One install is a wordpress.org lookup plus a zip download, so report
			// each one — a handful of them together can outlast the stall window.
			++$plugin_done;
			$this->update_job_progress(
				array(
					'phase'   => 'install_plugins',
					'current' => $plugin_done,
					'total'   => $plugin_total,
					'label'   => $name,
				)
			);

			// Nexter Blocks / The Plus Addons for Block Editor (wordpress.org/plugins/the-plus-addons-for-block-editor/).
			if ( false !== strpos( $name_lower, 'nexter blocks' )
				|| ( false !== strpos( $name_lower, 'plus addons' ) && false !== strpos( $name_lower, 'block' ) && false === strpos( $name_lower, 'elementor' ) ) ) {
				$this->ensure_plugin_active_generic(
					'the-plus-addons-for-block-editor/the-plus-addons-for-block-editor.php',
					'the-plus-addons-for-block-editor'
				);
				continue;
			}

			// Elementor.
			if ( false !== strpos( $name_lower, 'elementor' ) && false === strpos( $name_lower, 'plus' ) ) {
				$this->ensure_plugin_active_generic(
					'elementor/elementor.php',
					'elementor'
				);
				continue;
			}

			// The Plus Addons for Elementor (Free or Pro) is intentionally NOT installed:
			// UiChemy no longer requires it for an import, so a globals.json entry that
			// names it is ignored. Nexter Blocks / Block Editor (handled above) is unaffected.
		}
	}

	/**
	 * Map sitemaps project.requiredPlugins names to plugin slug format.
	 * Sitemaps returns names like "Elementor", "Nexter Blocks Free", "The Plus Addons for Elementor Free".
	 *
	 * @param array $required_plugins Array of plugin names from sitemaps project.requiredPlugins.
	 * @return array List of plugin configs with name, label, plugin_slug, original_slug, icon.
	 */
	protected function map_sitemaps_required_plugins_to_slugs( array $required_plugins ) {
		$result = array();

		foreach ( $required_plugins as $name ) {
			if ( ! is_string( $name ) || '' === $name ) {
				continue;
			}
			$name_lower = strtolower( $name );

			// Nexter Blocks / The Plus Addons for Block Editor (must run before generic "the plus addons" → Elementor).
			if ( false !== strpos( $name_lower, 'nexter blocks' )
				|| ( false !== strpos( $name_lower, 'plus addons' ) && false !== strpos( $name_lower, 'block' ) && false === strpos( $name_lower, 'elementor' ) ) ) {
				$result[] = array(
					'name'          => 'theplus-block-editor',
					'label'         => 'Nexter Blocks Free',
					'plugin_slug'   => 'the-plus-addons-for-block-editor/the-plus-addons-for-block-editor.php',
					'original_slug' => 'the-plus-addons-for-block-editor',
					'icon'          => 'theplus',
				);
				continue;
			}

			// Elementor.
			if ( false !== strpos( $name_lower, 'elementor' ) && false === strpos( $name_lower, 'plus' ) ) {
				$result[] = array(
					'name'          => 'elementor',
					'label'         => 'Elementor',
					'plugin_slug'   => 'elementor/elementor.php',
					'original_slug' => 'elementor',
					'icon'          => 'elementor',
				);
				continue;
			}

			// The Plus Addons for Elementor (Free or Pro) is intentionally NOT mapped:
			// UiChemy no longer requires, installs, or lists it for an import. The
			// block-editor branch above still handles Nexter Blocks / The Plus Addons
			// for Block Editor, which are unaffected.
		}

		return $result;
	}

	/**
	 * Get required plugins from globals.json with their installation status.
	 * Used by frontend to show these plugins in the UI steps.
	 *
	 * @param array $globals_data Decoded globals.json.
	 * @return array List of plugins with name, label, plugin_slug, original_slug, status.
	 */
	public function get_required_plugins_from_globals_with_status( array $globals_data ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';

		$required = $this->extract_required_plugins_from_globals( $globals_data );
		if ( empty( $required ) ) {
			return array();
		}

		$all_plugins = get_plugins();
		$result      = array();

		foreach ( $required as $name ) {
			$name_lower = strtolower( $name );
			$plugin     = null;

			// The Plus Addons for Block Editor / Nexter Blocks (before generic Plus → Elementor).
			if ( false !== strpos( $name_lower, 'nexter blocks' )
				|| ( false !== strpos( $name_lower, 'plus addons' ) && false !== strpos( $name_lower, 'block' ) && false === strpos( $name_lower, 'elementor' ) ) ) {
				$plugin = array(
					'name'          => 'theplus-block-editor',
					'label'         => 'The Plus Addons for Block Editor',
					'plugin_slug'   => 'the-plus-addons-for-block-editor/the-plus-addons-for-block-editor.php',
					'original_slug' => 'the-plus-addons-for-block-editor',
					'icon'          => 'theplus',
				);
			} elseif ( false !== strpos( $name_lower, 'elementor' ) && false === strpos( $name_lower, 'plus' ) ) {
				// Elementor.
				$plugin = array(
					'name'          => 'elementor',
					'label'         => 'Elementor',
					'plugin_slug'   => 'elementor/elementor.php',
					'original_slug' => 'elementor',
					'icon'          => 'elementor',
				);
			}
			// The Plus Addons for Elementor (Free or Pro) is intentionally NOT listed:
			// UiChemy no longer requires, installs, or shows it in the import UI.

			if ( $plugin ) {
				$is_active        = is_plugin_active( $plugin['plugin_slug'] );
				$is_installed     = isset( $all_plugins[ $plugin['plugin_slug'] ] );
				$plugin['status'] = $is_active ? 'active' : ( $is_installed ? 'inactive' : 'not_installed' );
				$result[]         = $plugin;
			}
		}

		return $result;
	}

	/**
	 * Detect globals.json shaped for The Plus Addons for Block Editor (Nexter Blocks palette tokens).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return bool
	 */
	protected function globals_json_is_tpgb_block_format( array $globals ) {
		foreach ( array_keys( $globals ) as $key ) {
			if ( ! is_string( $key ) ) {
				continue;
			}
			if ( preg_match( '/^tpgb-c\d+$/i', $key )
				|| preg_match( '/^tpgb-(gc|cg)\d+$/i', $key )
				|| preg_match( '/^tpgb-bs\d+$/i', $key )
				|| preg_match( '/^tpgb-s\d+$/i', $key )
				|| preg_match( '/^tpgb-b\d+$/i', $key )
				|| preg_match( '/^tpgb-r\d+$/i', $key )
				|| preg_match( '/^tpgb-a\d+$/i', $key ) ) {
				return true;
			}
		}
		if ( ! empty( $globals['typography'] ) && is_array( $globals['typography'] ) ) {
			foreach ( array_keys( $globals['typography'] ) as $key ) {
				if ( is_string( $key ) && preg_match( '/^tpgb-t\d+$/i', $key ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Normalize `tpgb_global_options` from the DB to an array (JSON string, array, or object).
	 *
	 * @param mixed $raw Value from get_option( 'tpgb_global_options' ).
	 * @return array
	 */
	protected function decode_tpgb_global_options_value( $raw ) {
		if ( is_array( $raw ) ) {
			return $raw;
		}
		if ( is_string( $raw ) && '' !== $raw ) {
			$decoded = json_decode( $raw, true );
			return is_array( $decoded ) ? $decoded : array();
		}
		if ( is_object( $raw ) ) {
			$as_array = json_decode( wp_json_encode( $raw ), true );
			return is_array( $as_array ) ? $as_array : array();
		}
		return array();
	}

	/**
	 * Merge globals.json into option `tpgb_global_options` (same as WDesignKit update_global_val for Gutenberg).
	 *
	 * Preset sections: tpgb-C* colors; typography.tpgb-T*; root tpgb-GC* or tpgb-CG* gradients; tpgb-BS* boxshadow;
	 * tpgb-S* spacing; tpgb-B* border (not BS); tpgb-R* radius; tpgb-A* animation names (Nexter / TPG block tokens).
	 *
	 * @param array $globals_data Decoded globals.json.
	 */
	protected function apply_globals_to_tpgb_block_editor( array $globals_data, array $btn_key_map = array() ) {
		$colors_out      = $this->build_tpgb_preset_colors_from_globals( $globals_data );
		$typo_out        = $this->build_tpgb_preset_typography_from_globals( $globals_data );
		$gradient_out    = $this->build_tpgb_preset_gradient_from_globals( $globals_data );
		$boxshadow_out   = $this->build_tpgb_preset_boxshadow_from_globals( $globals_data );
		$spacing_out     = $this->build_tpgb_preset_spacing_from_globals( $globals_data );
		$border_out      = $this->build_tpgb_preset_border_from_globals( $globals_data );
		$radius_out      = $this->build_tpgb_preset_radius_from_globals( $globals_data );
		$animation_out   = $this->build_tpgb_preset_animation_from_globals( $globals_data );
		$animrep_out     = $this->build_tpgb_animrep_from_globals( $globals_data );
		// Build the effective key map: existing DB slugs (lower priority) merged with
		// source-file slugs (higher priority, only populated when source has Gutenberg
		// button blocks). This ensures imported presets are stored under the same
		// internal key (e.g. "btnpreset1") that on-site button blocks already reference
		// via selectedButtonPreset, so the preset resolves without requiring a manual
		// reselect in the editor.
		$db_key_map        = $this->scan_existing_button_preset_key_map();
		$effective_key_map = array_merge( $db_key_map, $btn_key_map );
		$btnpreset_out     = $this->build_tpgb_button_presets_from_globals( $globals_data, $effective_key_map );

		// Build original-slot → new-sequential-position map (e.g. T8→1, T9→2, T12→3 …).
		// Stored in DB so page-content import (which may run in a separate request) can remap
		// globalTypo values in block attrs to match the compact preset positions.
		$typo_remap = $this->build_tpgb_typo_slot_remap( $typo_out );
		if ( ! empty( $typo_remap ) ) {
			update_option( 'uich_webpage_tpgb_typo_remap', $typo_remap, false );
			// Button presets reference globalTypo by original slot number; remap them now.
			$btnpreset_out = $this->remap_globalTypo_in_button_presets( $btnpreset_out, $typo_remap );
		} else {
			// No remap needed for THIS import (globals had no typography, or its slots are
			// already sequential 1..n). Clear any map left over from a PREVIOUS import — the
			// option is read unconditionally during page-content import (see build flow), so a
			// stale map would remap this project's globalTypo values to the wrong slots,
			// producing the intermittent cross-project typography mismatch.
			delete_option( 'uich_webpage_tpgb_typo_remap' );
		}

		if ( empty( $colors_out ) && empty( $typo_out ) && empty( $gradient_out ) && empty( $boxshadow_out )
			&& empty( $spacing_out ) && empty( $border_out ) && empty( $radius_out ) && empty( $animation_out )
			&& empty( $animrep_out ) && empty( $btnpreset_out ) ) {
			return;
		}

		$raw     = get_option( 'tpgb_global_options', false );
		$decoded = $this->decode_tpgb_global_options_value( $raw );

		$preset_key = 'uich_webpage_import';
		$base       = isset( $decoded['presets'] ) && is_array( $decoded['presets'] ) && isset( $decoded['active'] ) && isset( $decoded['presets'][ $decoded['active'] ] )
			? $decoded['presets'][ $decoded['active'] ]
			: array();

		if ( ! is_array( $base ) ) {
			$base = array();
		}

		$new_preset = array_merge(
			$base,
			array(
				'key'  => $preset_key,
				'name' => __( 'UiChemy Import', 'uichemy' ),
			)
		);
		if ( ! empty( $colors_out ) ) {
			$new_preset['colors'] = $this->merge_preset_category_by_slot(
				isset( $base['colors'] ) && is_array( $base['colors'] ) ? $base['colors'] : array(),
				$colors_out
			);
		}
		if ( ! empty( $typo_out ) ) {
			// Replace entirely — do NOT merge with existing preset typography.
			// Merging would cause duplicates on re-import: the existing compact positions
			// (1, 2, 3 …) and the incoming original slots (8, 9, 12 …) share no keys,
			// so array_replace would keep both sets, doubling every typography entry.
			ksort( $typo_out, SORT_NUMERIC );
			$new_preset['typography'] = array_values( $typo_out );
		}
		if ( ! empty( $gradient_out ) ) {
			$new_preset['gradient'] = $this->merge_preset_category_by_slot(
				isset( $base['gradient'] ) && is_array( $base['gradient'] ) ? $base['gradient'] : array(),
				$gradient_out
			);
		}
		if ( ! empty( $boxshadow_out ) ) {
			$new_preset['boxshadow'] = $this->merge_preset_category_by_slot(
				isset( $base['boxshadow'] ) && is_array( $base['boxshadow'] ) ? $base['boxshadow'] : array(),
				$boxshadow_out
			);
		}
		if ( ! empty( $spacing_out ) ) {
			$new_preset['spacing'] = $this->merge_preset_category_by_slot(
				isset( $base['spacing'] ) && is_array( $base['spacing'] ) ? $base['spacing'] : array(),
				$spacing_out
			);
		}
		if ( ! empty( $border_out ) ) {
			$new_preset['border'] = $this->merge_preset_category_by_slot(
				isset( $base['border'] ) && is_array( $base['border'] ) ? $base['border'] : array(),
				$border_out
			);
		}
		if ( ! empty( $radius_out ) ) {
			// Nexter expects this key as `borderradius` in `tpgb_global_options` (working shape in your DB).
			$new_preset['borderradius'] = $this->merge_preset_category_by_slot(
				isset( $base['borderradius'] ) && is_array( $base['borderradius'] ) ? $base['borderradius'] : array(),
				$radius_out
			);
		}
		if ( ! empty( $animation_out ) ) {
			$new_preset['animation'] = $this->merge_preset_category_by_slot(
				isset( $base['animation'] ) && is_array( $base['animation'] ) ? $base['animation'] : array(),
				$animation_out
			);
		}
		if ( ! empty( $animrep_out ) ) {
			$existing_animrep        = isset( $base['animRep'] ) && is_array( $base['animRep'] ) ? $base['animRep'] : array();
			$new_preset['animRep']   = $this->merge_tpgb_animrep( $existing_animrep, $animrep_out );
		}
		if ( ! empty( $btnpreset_out ) ) {
			// REPLACE, not merge — each import is a complete project.
			// Merging caused stale keys from previous imports to accumulate,
			// showing orphan chips in the editor's Button Presets panel.
			$new_preset['buttonPresets'] = $btnpreset_out;
		}

		if ( ! isset( $decoded['presets'] ) || ! is_array( $decoded['presets'] ) ) {
			$decoded['presets'] = array();
		}
		$decoded['presets'][ $preset_key ] = $new_preset;
		$decoded['active']                 = $preset_key;

		$this->apply_uich_webpage_tpgb_global_container( $decoded );

		update_option( 'tpgb_global_options', wp_json_encode( $decoded ), false );

		// Mirror button presets to tpgb-block-global-style.__buttonCore.buttonPresets.
		//
		// The editor JS reads /tpgb/v1/theplus_global_settings which returns BOTH
		// `settings` (tpgb_global_options) AND `block_global_style` (tpgb-block-global-style).
		// The GlobalButtonPreset component looks up the selected preset key (e.g. "btnpreset1")
		// from block_global_style.__buttonCore.buttonPresets — NOT from presets[active].buttonPresets.
		// Without writing here, the chip never shows as "selected" and the user has to
		// manually re-click it, which then triggers TPGB's own save flow that writes here.
		// We REPLACE (not merge) so prior-import keys don't pile up in the chip list.
		if ( ! empty( $new_preset['buttonPresets'] ) && is_array( $new_preset['buttonPresets'] ) ) {
			$this->sync_button_presets_to_block_global_style( $new_preset['buttonPresets'] );
		}

		if ( apply_filters( 'uich_webpage_tpgb_write_global_css', true, $new_preset ) ) {
			$this->write_tpgb_global_css_from_import_preset( $new_preset, $globals_data );
		}

		if ( apply_filters( 'uich_webpage_create_temp_gutenberg_page', true ) ) {
			$this->create_temp_gutenberg_page_and_delete();
		}
	}

	/**
	 * Write imported button presets into tpgb-block-global-style.__buttonCore.buttonPresets.
	 *
	 * The Gutenberg editor fetches /tpgb/v1/theplus_global_settings which returns both
	 * `settings` (tpgb_global_options) and `block_global_style` (tpgb-block-global-style).
	 * TPGB's GlobalButtonPreset JS component resolves the selected preset key (e.g. "btnpreset1")
	 * against block_global_style.__buttonCore.buttonPresets — not against
	 * settings.presets[active].buttonPresets. Without this write the chip is never highlighted
	 * in the editor and the user must manually re-select the preset to make styles appear.
	 *
	 * Existing __buttonCore sub-keys (textPresets, savedTypography, etc.) are preserved.
	 * buttonPresets is replaced entirely so stale keys from prior imports don't accumulate.
	 *
	 * @param array $button_presets Map of preset_key => preset object.
	 */
	protected function sync_button_presets_to_block_global_style( array $button_presets ) {
		$raw = get_option( 'tpgb-block-global-style', '' );
		if ( is_array( $raw ) ) {
			$existing = $raw;
		} elseif ( is_string( $raw ) && '' !== $raw ) {
			$existing = json_decode( $raw, true );
			if ( is_string( $existing ) ) {
				$existing = json_decode( $existing, true ); // handle double-encoded
			}
			if ( ! is_array( $existing ) ) {
				$existing = array();
			}
		} else {
			$existing = array();
		}

		if ( ! isset( $existing['__buttonCore'] ) || ! is_array( $existing['__buttonCore'] ) ) {
			$existing['__buttonCore'] = array();
		}

		// Replace buttonPresets entirely — each import is a complete project.
		$existing['__buttonCore']['buttonPresets'] = $button_presets;
		// Remove any stale activeButtonPreset so TPGB's own logic picks the first available.
		unset( $existing['__buttonCore']['activeButtonPreset'] );

		update_option( 'tpgb-block-global-style', wp_json_encode( $existing ), false );
		wp_cache_delete( 'tpgb-block-global-style', 'options' );
	}

	/**
	 * Create a temporary Gutenberg post, trigger save_post hooks, then force-delete it.
	 *
	 * Mirrors the WDesignKit wdkit_update_preset() workaround. Saving a post fires TPGB's
	 * plus_post_save_transient action which resets block-CSS transients, ensuring the freshly
	 * written global CSS is picked up on the next editor load without stale cache interference.
	 */
	protected function create_temp_gutenberg_page_and_delete() {
		$post_id = wp_insert_post(
			array(
				'post_title'   => 'UiChemy Import Temp',
				'post_status'  => 'publish',
				'post_type'    => 'post',
				'post_name'    => 'uich-webpage-import-temp-' . time(),
				'post_content' => '<!-- wp:heading --><h2 class="wp-block-heading">Heading</h2><!-- /wp:heading -->',
				'meta_input'   => array(
					'_uich_webpage_temp_page' => true,
					'_wp_page_template'    => 'default',
				),
			)
		);

		if ( is_wp_error( $post_id ) || ! $post_id ) {
			return;
		}

		$user_id = get_current_user_id() ?: 1;
		update_post_meta( $post_id, '_edit_lock', time() . ':' . $user_id );
		update_post_meta( $post_id, '_edit_last', $user_id );

		wp_update_post( array( 'ID' => $post_id ) );

		wp_delete_post( $post_id, true );
	}

	/**
	 * Ensure tpgb_global_options has at least a minimal valid preset structure.
	 *
	 * Called after globals are applied so that on fresh installs (no existing preset,
	 * no globals.json) blocks referencing --tpgb-C* / --tpgb-T* tokens don't get
	 * empty values. If the option already has content it is left untouched.
	 */
	protected function maybe_initialize_tpgb_global_options() {
		$raw = get_option( 'tpgb_global_options', false );
		if ( false !== $raw && '' !== $raw && '[]' !== $raw && '{}' !== $raw ) {
			return;
		}
		$defaults = array(
			'active'           => 'preset1',
			'globalContainer'  => $this->get_uich_webpage_tpgb_global_container_default(),
			'presets'          => array(
				'preset1' => array(
					'name'          => 'Preset 1',
					'key'           => 'preset1',
					'colors'        => array(),
					'typography'    => array(),
					'gradient'      => array(),
					'spacing'       => array(),
					'border'        => array(),
					'borderradius'  => array(),
					'boxshadow'     => array(),
					'animation'     => array(),
					'animRep'       => array(),
					'buttonPresets' => array(),
				),
			),
		);
		update_option( 'tpgb_global_options', wp_json_encode( $defaults ), false );
	}

	/**
	 * Default Nexter global container width (Site Builder → Container Width), root of tpgb_global_options.
	 *
	 * @return array{ md: string, unit: string }
	 */
	protected function get_uich_webpage_tpgb_global_container_default() {
		return apply_filters(
			'uich_webpage_tpgb_global_container',
			array(
				'md'   => '1240',
				'unit' => 'px',
			)
		);
	}

	/**
	 * Write globalContainer onto decoded tpgb_global_options before save.
	 *
	 * @param array $decoded Decoded tpgb_global_options.
	 */
	protected function apply_uich_webpage_tpgb_global_container( array &$decoded ) {
		$decoded['globalContainer'] = $this->get_uich_webpage_tpgb_global_container_default();
	}

	/**
	 * Merge two indexed preset-category arrays so incoming wins at shared indices
	 * and existing items beyond the incoming range are preserved.
	 *
	 * This lets re-imports add new entries without silently overwriting entries that
	 * already exist in the active preset.
	 *
	 * @param array $existing Current preset category rows (colors, typography, etc.).
	 * @param array $incoming Rows built from the imported globals.json.
	 * @return array Merged rows, re-indexed from 0.
	 */
	protected function merge_preset_category_additive( array $existing, array $incoming ) {
		if ( empty( $existing ) ) {
			return $incoming;
		}
		$merged = $incoming;
		foreach ( $existing as $idx => $item ) {
			if ( ! isset( $merged[ $idx ] ) ) {
				$merged[ $idx ] = $item;
			}
		}
		ksort( $merged, SORT_NUMERIC );
		return array_values( $merged );
	}

	/**
	 * Merge Nexter's existing sequential category rows with slot-keyed incoming rows.
	 *
	 * Nexter stores preset categories as sequential arrays (index 0 = slot 1, index 1 = slot 2, …).
	 * Builders now return slot-keyed arrays (key = slot number). This method converts Nexter's
	 * sequential array to slot-keyed, lets incoming slots win at overlapping positions, preserves
	 * Nexter's items at slots not present in incoming, then returns a sequential array sorted by slot.
	 *
	 * @param array $existing_sequential Nexter's current rows — sequential (0-based index → slot n+1).
	 * @param array $incoming_slots      Builder output — slot-keyed (key = slot number).
	 * @return array Sequential rows sorted by slot, re-indexed from 0.
	 */
	protected function merge_preset_category_by_slot( array $existing_sequential, array $incoming_slots ) {
		// Convert Nexter sequential to slot-keyed (index 0 → slot 1).
		$nexter_slots = array();
		foreach ( $existing_sequential as $idx => $item ) {
			$nexter_slots[ (int) $idx + 1 ] = $item;
		}
		// Incoming wins at any overlapping slot; Nexter data kept at non-overlapping slots.
		$merged = array_replace( $nexter_slots, $incoming_slots );
		ksort( $merged, SORT_NUMERIC );
		return array_values( $merged );
	}

	/**
	 * Merge Nexter's existing typography rows with slot-keyed incoming rows, keeping the array dense.
	 *
	 * Typography must be a dense sequential array because TPGB resolves `globalTypo` via
	 * `preset.typography[ globalTypo - 1 ]`. Gaps cause "none" in the editor. Any slot between 1
	 * and max(slot) that has no incoming value is filled with Nexter's existing value at that slot,
	 * or a neutral placeholder if Nexter has nothing there either.
	 *
	 * @param array $existing_sequential Nexter's current typography rows (sequential, 0-based).
	 * @param array $incoming_slots      Builder output — slot-keyed (key = slot number).
	 * @return array Dense sequential typography rows, re-indexed from 0.
	 */
	protected function merge_preset_typography_by_slot( array $existing_sequential, array $incoming_slots ) {
		// Convert Nexter sequential to slot-keyed (index 0 → slot 1).
		$nexter_slots = array();
		foreach ( $existing_sequential as $idx => $item ) {
			$nexter_slots[ (int) $idx + 1 ] = $item;
		}
		// Incoming wins at any overlapping slot; Nexter data kept at non-overlapping slots.
		$merged = array_replace( $nexter_slots, $incoming_slots );
		if ( empty( $merged ) ) {
			return array();
		}
		// No gap-filling — only real entries are stored.
		// globalTypo values in page content are remapped to these new sequential positions
		// by remap_globalTypo_in_blocks() during page import (see build_tpgb_typo_slot_remap).
		ksort( $merged, SORT_NUMERIC );
		return array_values( $merged );
	}

	/**
	 * Rebuild the TPGB per-post CSS file at import time.
	 *
	 * During import the Gutenberg editor JS never runs, so `plus-css-{id}.css` is either absent
	 * or stale (generated from the original template before globalTypo remapping). We first delete
	 * the stale file and `_tpgb_css` post meta, then PROACTIVELY regenerate the file from the saved
	 * (remapped) post content via TPGB's own `make_block_css_by_post_id()`.
	 *
	 * Why regenerate now instead of deferring to the next page load: when the file is missing,
	 * TPGB's front-end `enqueue_load_block_css_js()` calls `make_block_css_by_post_id()` to WRITE
	 * the file but does NOT enqueue it during that same request (see tp-core-init-blocks.php — the
	 * `! file_exists()` branch generates without a matching wp_enqueue_style). Result: the first
	 * visit renders with no per-block CSS (broken styling) and only the SECOND refresh — once the
	 * file exists — enqueues it. Pre-building here means the file already exists on the first visit,
	 * so it is enqueued immediately and styling is correct on first load.
	 *
	 * `generate_dynamic_css()` (used by make_block_css_by_post_id) works purely on the saved
	 * post_content (parse_blocks → attr→CSS); it does not require block render registration, so it
	 * is safe to run in the REST import context.
	 *
	 * @param int $post_id Post ID whose cached CSS should be rebuilt.
	 */
	protected function invalidate_tpgb_block_css_file( $post_id ) {
		$upload_dir = wp_upload_dir();
		if ( ! empty( $upload_dir['error'] ) ) {
			return;
		}
		$css_path = trailingslashit( $upload_dir['basedir'] ) . "theplus_gutenberg/plus-css-{$post_id}.css";
		if ( file_exists( $css_path ) ) {
			wp_delete_file( $css_path );
		}
		delete_post_meta( $post_id, '_tpgb_css' );

		// Bump _block_css[version] so TPGB enqueues plus-global.css and plus-css-{id}.css
		// with a new URL on the first frontend visit (browser cache bust).
		// TPGB's make_block_css_by_post_id does this internally but only when is_singular()
		// is true — in the REST import context is_singular() is false, so the update is skipped
		// and the browser keeps serving a stale cached plus-global.css until a second refresh.
		$block_css_meta            = get_post_meta( $post_id, '_block_css', true );
		$block_css_meta            = is_array( $block_css_meta ) ? $block_css_meta : array();
		$block_css_meta['version'] = time();
		update_post_meta( $post_id, '_block_css', $block_css_meta );

		// Proactively rebuild so the file exists on the first front-end load.
		if ( apply_filters( 'uich_webpage_pregenerate_tpgb_block_css', true, $post_id ) && class_exists( 'Tpgb_Core_Init_Blocks' ) ) {
			$regen_error = '';
			try {
				Tpgb_Core_Init_Blocks::get_instance()->make_block_css_by_post_id( $post_id );
			} catch ( \Throwable $e ) {
				// make_block_css_by_post_id throws on a filesystem-permission failure. Non-fatal:
				// the stale file is already cleared, so TPGB falls back to its lazy regen path
				// (the pre-existing two-load behaviour) rather than aborting the whole import —
				// but report it below instead of swallowing it outright.
				$regen_error = $e->getMessage();
			}

			// A no-op (no exception, but the file still wasn't written) is just as silent as a
			// thrown error, so check the actual result rather than trusting a clean try/catch.
			if ( '' !== $regen_error || ! file_exists( $css_path ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error(
					'IMPORT_TPGB_CSS_REGEN_FAILED',
					array(
						'message' => '' !== $regen_error ? $regen_error : ( "plus-css-{$post_id}.css was not produced." ),
						'source'  => 'uichemy-webpage',
						'level'   => 'warning',
						'context' => array( 'post_id' => $post_id ),
					)
				);
			}
		}
	}

	/**
	 * Persist Nexter global CSS variables to `_tpgb_global_css` and uploads `plus-global.css`.
	 *
	 * The block editor normally generates this when saving global styles; updating `tpgb_global_options`
	 * alone does not refresh the file, so `--tpgb-C*` / `--tpgb-T*` used in block JSON would not apply.
	 *
	 * @param array      $preset       Preset array (…, borderradius, animation).
	 * @param array|null $globals_data Original globals.json (typography and color / gradient / box-shadow variables use real tpgb-* indices).
	 */
	protected function write_tpgb_global_css_from_import_preset( array $preset, ?array $globals_data = null ) {
		$css       = $this->build_tpgb_root_css_from_import_preset( $preset, $globals_data );
		$font_link = $this->build_tpgb_google_font_link_from_import_preset( $preset );

		// Append the .nxt-btn-global-btnpreset-{slug} wrapper-class rules and the
		// .nxt-button-core-global active-preset rules. These come from TPGB's
		// editor-side blocks.js (the "buildActivePresetCss" path that runs on
		// preset save). The PHP side has no equivalent generator — without these
		// rules in plus-global.css, every imported button block falls back to
		// its default style-N outline because the wrapper-class selectors that
		// would otherwise apply preset color/border/padding/shadow are missing
		// from the stylesheet. Symptom: cookie popup primary/secondary buttons
		// render as plain outlined boxes until the user opens the popup post
		// in the editor and clicks Save (which triggers the JS that writes the
		// missing rules).
		$wrapper_css = $this->build_tpgb_button_preset_wrapper_css( $preset );
		if ( '' !== $wrapper_css ) {
			$css .= $wrapper_css;
		}

		// Append animation-preset :root vars (informational, lets the editor viewer list saved animations).
		if ( ! empty( $preset['animRep'] ) && is_array( $preset['animRep'] ) ) {
			if ( class_exists( 'Tpgb_Animation_Preset_Vars' ) ) {
				$anim_css = Tpgb_Animation_Preset_Vars::build_css( $preset['animRep'] );
				if ( '' !== $anim_css ) {
					$css .= "\n" . $anim_css;
				}
			}
		}

		$payload = array(
			'css'       => $css,
			'font_link' => $font_link,
		);

		update_option( '_tpgb_global_css', $payload, false );
		update_option( '_tpgb_global_css_version', time(), false );
		// Bump TPGB's global cache-bust timestamp so plus-global.css is served with a
		// new URL version on all pages that have no post-specific _block_css[version] yet
		// (get_enqueue_version falls back to this option when post meta is absent).
		update_option( 'tpgb_backend_cache_at', time(), false );

		$upload_dir = wp_upload_dir();
		if ( ! empty( $upload_dir['error'] ) ) {
			return;
		}

		$dir = trailingslashit( $upload_dir['basedir'] ) . 'theplus_gutenberg/';
		if ( ! wp_mkdir_p( $dir ) ) {
			return;
		}

		global $wp_filesystem;
		if ( empty( $wp_filesystem ) ) {
			require_once ABSPATH . '/wp-admin/includes/file.php';
			WP_Filesystem( false, $upload_dir['basedir'], true );
		}
		if ( ! empty( $wp_filesystem ) ) {
			$wp_filesystem->put_contents( $dir . 'plus-global.css', $css );
		}

		// Regenerate button-preset stylesheet if presets were stored (hook may not fire in all contexts).
		if ( ! empty( $preset['buttonPresets'] ) && class_exists( 'Tpgb_Button_Preset_Vars' ) ) {
			Tpgb_Button_Preset_Vars::invalidate_cache();
			Tpgb_Button_Preset_Vars::write_preset_file();
		}
	}

	/**
	 * Generate the wrapper-class CSS that TPGB's editor JavaScript normally produces.
	 *
	 * Background — why this is needed
	 * -------------------------------
	 * plus-global.css contains TWO kinds of declarations:
	 *
	 *   1. :root custom-property definitions (--tpgb-C1, --tpgb-T5, etc.)
	 *      → generated by our build_tpgb_root_css_from_import_preset()
	 *
	 *   2. WRAPPER-CLASS rules that bind preset CSS vars to the actual
	 *      `.nxt-btn-global-btnpreset-{slug} .button-link-wrap` selectors
	 *      → generated ONLY by blocks.js in the editor (the
	 *      "buildActivePresetCss" path that runs when a user saves a
	 *      preset in the global-settings modal).
	 *
	 * Our PHP import handles (1) but never triggers (2). Result: after every
	 * import, plus-global.css is rewritten with fresh :root vars but the
	 * wrapper-class rules are dropped. Every imported button then has the
	 * correct preset CSS variables defined upstream — but no rule selects the
	 * button wrapper class to actually apply them, so the button renders with
	 * its default style-N outline. Symptom: cookie consent popup buttons
	 * (and any tp-button using a preset) look unstyled until the user opens
	 * the post in the editor and clicks Save (which fires the JS path).
	 *
	 * What this method emits
	 * ----------------------
	 * For each button preset stored in $preset['buttonPresets'], one block of
	 * rules of the form:
	 *
	 *   .nxt-btn-global-btnpreset-{slug} #commentform #submit,
	 *   .nxt-btn-global-btnpreset-{slug} .adv-button-link-wrap,
	 *   .nxt-btn-global-btnpreset-{slug} .button-link-wrap,
	 *   .nxt-btn-global-btnpreset-{slug} .tpgb-btn-wrap,
	 *   .nxt-btn-global-btnpreset-{slug}.post-load-more {
	 *     color/background/padding/border/font/box-shadow → var(--tpgb-btnpreset-{slug}-*) !important
	 *   }
	 *   .nxt-btn-global-btnpreset-{slug} <same five selectors>:hover {
	 *     color/background/border/box-shadow → var(--tpgb-btnpreset-{slug}-bth*) !important
	 *   }
	 *
	 * Plus one block for `.nxt-button-core-global` that binds to the ACTIVE
	 * (first) preset's vars — this is the fallback wrapper class used by
	 * tp-button-core blocks that don't carry a specific selectedButtonPreset.
	 *
	 * Selector list and properties are kept in lockstep with the JS template
	 * extracted from blocks.js so the visual output matches what a manual
	 * editor save would produce.
	 *
	 * @param array $preset The import preset (tpgb_global_options.presets[active] shape).
	 *                      Reads only $preset['buttonPresets']: map of preset_key => preset object.
	 * @return string Concatenated CSS rules, or '' when there are no button presets.
	 */
	protected function build_tpgb_button_preset_wrapper_css( array $preset ) {
		if ( empty( $preset['buttonPresets'] ) || ! is_array( $preset['buttonPresets'] ) ) {
			return '';
		}

		// Per-preset rule template. {selectors} and {ns} are filled per preset.
		// {ns} is the slug-based namespace prefix without the leading "--": e.g.
		// "tpgb-btnpreset-primary-button" so the emitted vars become
		// var(--tpgb-btnpreset-primary-button-btColor) and so on.
		$base_selectors = array(
			'%s #commentform #submit',
			'%s .adv-button-link-wrap',
			'%s .button-link-wrap',
			'%s .tpgb-btn-wrap',
			'%s.post-load-more',
		);

		$emit_rule_block = function ( $wrapper_selector, $ns ) use ( $base_selectors ) {
			// Build the comma-joined selector list.
			$normal_list = array();
			$hover_list  = array();
			foreach ( $base_selectors as $tmpl ) {
				$base = sprintf( $tmpl, $wrapper_selector );
				$normal_list[] = $base;
				$hover_list[]  = $base . ':hover';
			}

			$normal_decls = implode( ';', array(
				'color:var(--' . $ns . '-btColor)!important',
				'background-color:var(--' . $ns . '-btBg-color)!important',
				'background-image:none!important',
				'padding:var(--' . $ns . '-btPad-top-md) var(--' . $ns . '-btPad-right-md) var(--' . $ns . '-btPad-bottom-md) var(--' . $ns . '-btPad-left-md)!important',
				'border-radius:var(--' . $ns . '-brad)!important',
				'border-style:var(--' . $ns . '-bBord-style)!important',
				'border-color:var(--' . $ns . '-bBord-color)!important',
				// Border width: TPGB's plus-button-presets.css defines the
				// shorthand `--{ns}-bBord-width` (a single 4-side value like
				// "1px 1px 1px 1px"), NOT per-side `-top/-right/-bottom/-left`
				// variables. Referencing the per-side names made the var()
				// resolve to its 0 fallback → border-width: 0 → no border on
				// secondary/tertiary preset buttons even though every other
				// rule (color, style, radius) was wired correctly. Use the
				// shorthand var name to match TPGB's emitter.
				'border-width:var(--' . $ns . '-bBord-width)!important',
				'font-family:var(--' . $ns . '-bTypo-family)!important',
				'font-weight:var(--' . $ns . '-bTypo-weight)!important',
				// font-style explicitly declared so this rule beats the buggy
				// `font-style: italic;` that tp-generate-block-css.php hardcodes
				// into the per-block CSS file for preset-namespaced typography
				// (a TPGB CSS-generator bug — visible in plus-css-{post_id}.css
				// as `.tpgb-block-XXX.tpgb-plus-button .button-link-wrap { font-style: italic }`).
				// That broken declaration has no !important, so our !important
				// here wins regardless of selector specificity.
				'font-style:var(--' . $ns . '-bTypo-style)!important',
				'font-size:var(--' . $ns . '-bTypo-size)!important',
				'line-height:var(--' . $ns . '-bTypo-height)!important',
				'letter-spacing:var(--' . $ns . '-bTypo-spacing)!important',
				'text-transform:var(--' . $ns . '-bTypo-transform)!important',
				'text-decoration:var(--' . $ns . '-bTypo-decoration)!important',
				'box-shadow:var(--' . $ns . '-btshadow)!important',
			) );

			$hover_decls = implode( ';', array(
				'color:var(--' . $ns . '-bthColor)!important',
				'background-color:var(--' . $ns . '-bthBg-color)!important',
				'background-image:none!important',
				'border-color:var(--' . $ns . '-bthBColor)!important',
				'box-shadow:var(--' . $ns . '-bthShadow)!important',
			) );

			return implode( ',', $normal_list ) . '{' . $normal_decls . '}'
				. implode( ',', $hover_list ) . '{' . $hover_decls . '}';
		};

		// Derive each preset's slug from its `name` field — mirrors
		// Tpgb_Button_Preset_Vars::preset_class_slug() exactly. (Doing it
		// inline rather than calling the static avoids a hard dependency on
		// TPGB being loaded at the moment this method runs.)
		$derive_slug = function ( $preset_key, $preset_obj ) {
			$name = is_array( $preset_obj ) && isset( $preset_obj['name'] ) ? (string) $preset_obj['name'] : '';
			if ( '' === $name ) {
				return $preset_key; // fall back so the var refs still resolve sanely.
			}
			$slug = strtolower( trim( $name ) );
			$slug = preg_replace( '/[^a-z0-9]+/', '-', $slug );
			$slug = trim( (string) $slug, '-' );
			return ( '' === $slug ) ? $preset_key : ( 'btnpreset-' . $slug );
		};

		// First pass: walk presets to collect (slug, namespace) for each, and
		// remember which one is "first" (the active fallback for tp-button-core).
		$preset_entries = array();
		$first_slug     = '';
		foreach ( $preset['buttonPresets'] as $preset_key => $preset_obj ) {
			if ( is_object( $preset_obj ) ) {
				$preset_obj = json_decode( wp_json_encode( $preset_obj ), true );
			}
			if ( ! is_array( $preset_obj ) ) {
				continue;
			}
			$slug = $derive_slug( (string) $preset_key, $preset_obj );
			if ( '' === $slug ) {
				continue;
			}
			$preset_entries[] = array(
				'slug' => $slug,
				'ns'   => 'tpgb-' . $slug,
			);
			if ( '' === $first_slug ) {
				$first_slug = $slug;
			}
		}

		// Emission order is intentional and matters for cascade resolution.
		//
		// The `.nxt-button-core-global` fallback rule and per-preset
		// `.nxt-btn-global-btnpreset-{slug}` rules all share the same selector
		// specificity (0,2,0) and all carry !important, so when both match the
		// same element the LATER declaration in source order wins.
		//
		// tp-button-core static HTML carries `.nxt-button-core-global` baked
		// into the inner div, AND we now inject `.nxt-btn-global-btnpreset-{slug}`
		// onto the OUTER wrap via fix_tp_button_core_global_class_in_blocks().
		// Both rules end up matching the same inner `.tpgb-btn-wrap` span.
		//
		// For a secondary/tertiary button we want the per-preset rule to win
		// over the fallback (otherwise the View Menu / Reject All / etc. button
		// would inherit primary preset's color & border). So:
		//
		//   1. .nxt-button-core-global rule FIRST  (primary preset values)
		//   2. .nxt-btn-global-btnpreset-{slug} rules AFTER  (each preset's own values)
		//
		// For the primary button itself this is a no-op — both rules emit the
		// same primary-preset values, so whichever wins yields the same output.
		$out = '';
		if ( '' !== $first_slug ) {
			$out .= $emit_rule_block( '.nxt-button-core-global', 'tpgb-' . $first_slug );
		}
		foreach ( $preset_entries as $entry ) {
			$out .= $emit_rule_block( '.nxt-btn-global-' . $entry['slug'], $entry['ns'] );
		}

		return $out;
	}

	/**
	 * Build :root color declarations from globals (actual tpgb-C{n} indices).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return string Semicolon-separated declarations (no outer :root).
	 */
	protected function build_tpgb_color_css_rules_from_globals( array $globals ) {
		$color_map = $this->extract_global_colors_from_globals( $globals );
		$parts     = array();
		foreach ( $color_map as $id => $entry ) {
			if ( ! preg_match( '/^tpgb-c(\d+)$/i', (string) $id, $m ) ) {
				continue;
			}
			$n   = (int) $m[1];
			$hex = '';
			if ( is_array( $entry ) && isset( $entry['hex'] ) ) {
				$hex = trim( (string) $entry['hex'] );
			} elseif ( is_string( $entry ) ) {
				$hex = trim( $entry );
			}
			if ( '' === $hex || ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $hex ) ) {
				continue;
			}
			$parts[] = '--tpgb-C' . $n . ':' . $hex;
		}
		return implode( ';', $parts );
	}

	/**
	 * Build :root gradient declarations from globals (actual tpgb-GC{n} / tpgb-CG{n} indices).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return string Semicolon-separated declarations (no outer :root).
	 */
	protected function build_tpgb_gradient_css_rules_from_globals( array $globals ) {
		$parts = array();
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-(?:gc|cg)(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n   = (int) $m[1];
			$val = isset( $entry['value'] ) && is_string( $entry['value'] ) ? trim( $entry['value'] ) : '';
			if ( '' === $val ) {
				continue;
			}
			$parts[] = '--tpgb-GC' . $n . ':' . $val;
		}
		return implode( ';', $parts );
	}

	/**
	 * Build :root box-shadow declarations from globals.
	 *
	 * Uses every entry in metadata.shadows verbatim as a CSS custom property
	 * (key → --key: value). This covers both tpgb-BS{n} tokens and all
	 * tpgb-btnpreset-* shadow component tokens in a single pass.
	 * Falls back to computing tpgb-BS{n} values from top-level entry['value']
	 * objects only when a key is absent from metadata.shadows.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return string Semicolon-separated declarations (no outer :root).
	 */
	protected function build_tpgb_boxshadow_css_rules_from_globals( array $globals ) {
		$parts        = array();
		$meta_emitted = array(); // tracks keys already emitted from metadata.shadows

		// ── 1. Emit every metadata.shadows entry verbatim. ───────────────────────
		if ( ! empty( $globals['metadata']['shadows'] ) && is_array( $globals['metadata']['shadows'] ) ) {
			foreach ( $globals['metadata']['shadows'] as $key => $val ) {
				if ( ! is_string( $key ) || ! is_string( $val ) ) {
					continue;
				}
				$shadow = trim( $val );
				if ( '' !== $shadow ) {
					$parts[]              = '--' . $key . ':' . $shadow;
					$meta_emitted[ $key ] = true;
				}
			}
		}

		// ── 2. Fall back: compute tpgb-BS{n} tokens not present in metadata.shadows.
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-bs(\d+)$/i', $key, $m ) ) {
				continue;
			}
			if ( isset( $meta_emitted[ $key ] ) ) {
				continue; // already emitted from metadata.shadows
			}
			if ( empty( $entry['value'] ) || ! is_array( $entry['value'] ) ) {
				continue;
			}
			$shadow = $this->build_tpgb_box_shadow_css_value( $entry['value'] );
			if ( '' !== $shadow ) {
				$parts[] = '--' . $key . ':' . $shadow;
			}
		}

		return implode( ';', $parts );
	}

	/**
	 * Build :root border declarations from globals (actual tpgb-B{n} indices).
	 *
	 * Uses every entry in metadata.borders verbatim as a CSS custom property
	 * (key → --key: value). This covers tpgb-BRT{n} and tpgb-BRW{n} tokens in
	 * a single pass, matching how metadata.shadows is handled for box-shadows.
	 * Falls back to computing from top-level tpgb-B{n} value objects for any
	 * token not already covered by metadata.borders.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return string Semicolon-separated declarations (no outer :root).
	 */
	protected function build_tpgb_border_css_rules_from_globals( array $globals ) {
		$parts        = array();
		$meta_emitted = array(); // tracks keys already emitted from metadata.borders

		// ── 1. Emit every metadata.borders entry verbatim. ────────────────────
		if ( ! empty( $globals['metadata']['borders'] ) && is_array( $globals['metadata']['borders'] ) ) {
			foreach ( $globals['metadata']['borders'] as $key => $val ) {
				if ( ! is_string( $key ) || ! is_string( $val ) ) {
					continue;
				}
				$border = trim( $val );
				if ( '' !== $border ) {
					$parts[]              = '--' . $key . ':' . $border;
					$meta_emitted[ $key ] = true;
				}
			}
		}

		// ── 2. Fall back: compute tpgb-B{n} tokens not present in metadata.borders.
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-b(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n = (int) $m[1];
			if ( empty( $entry['value'] ) || ! is_array( $entry['value'] ) ) {
				continue;
			}
			$val = $entry['value'];

			// Border style → --tpgb-BRT{n}.
			$brt_key = 'tpgb-BRT' . $n;
			if ( ! isset( $meta_emitted[ $brt_key ] ) ) {
				$style = '';
				if ( ! empty( $val['type'] ) && is_string( $val['type'] ) ) {
					$style = $val['type'];
				} elseif ( ! empty( $val['style'] ) && is_string( $val['style'] ) ) {
					$style = $val['style'];
				}
				if ( '' !== $style ) {
					$parts[] = '--tpgb-BRT' . $n . ':' . $style;
				}
			}

			// Border width → --tpgb-BRW{n}.
			$brw_key = 'tpgb-BRW' . $n;
			if ( ! isset( $meta_emitted[ $brw_key ] ) && isset( $val['width'] ) ) {
				$width_raw = $val['width'];
				if ( is_object( $width_raw ) ) {
					$width_raw = json_decode( wp_json_encode( $width_raw ), true );
				}
				$unit_raw = isset( $val['widthType'] ) ? (string) $val['widthType'] : 'px';
				$unit_map = array( 'pixel' => 'px', 'em' => 'em', 'percent' => '%', '%' => '%', 'px' => 'px' );
				$unit     = isset( $unit_map[ $unit_raw ] ) ? $unit_map[ $unit_raw ] : ( '' !== $unit_raw ? $unit_raw : 'px' );

				// Resolve to the md-breakpoint value (scalar or sides array).
				$width_md = null;
				if ( is_array( $width_raw ) ) {
					if ( isset( $width_raw['md'] ) ) {
						$width_md = $width_raw['md'];
					} elseif ( isset( $width_raw['top'] ) || isset( $width_raw['left'] ) ) {
						// width IS the sides object directly.
						$width_md = $width_raw;
					}
				} elseif ( is_numeric( $width_raw ) || ( is_string( $width_raw ) && '' !== $width_raw ) ) {
					$width_md = $width_raw;
				}

				$width_val = '';
				if ( is_array( $width_md ) ) {
					// Per-side object {top, right, bottom, left} → CSS shorthand.
					$sides = array();
					foreach ( array( 'top', 'right', 'bottom', 'left' ) as $side ) {
						$sv      = isset( $width_md[ $side ] ) && '' !== (string) $width_md[ $side ] ? (string) $width_md[ $side ] : '0';
						$sides[] = is_numeric( $sv ) ? ( $sv . $unit ) : $sv;
					}
					$width_val = implode( ' ', $sides );
				} elseif ( null !== $width_md ) {
					$sv = (string) $width_md;
					if ( '' !== $sv ) {
						$width_val = is_numeric( $sv ) ? ( $sv . $unit ) : $sv;
					}
				}

				if ( '' !== $width_val ) {
					$parts[] = '--tpgb-BRW' . $n . ':' . $width_val;
				}
			}

			// Border color → --tpgb-BRC{n}.
			$brc_key = 'tpgb-BRC' . $n;
			if ( ! isset( $meta_emitted[ $brc_key ] ) && ! empty( $val['color'] ) && is_string( $val['color'] ) ) {
				$parts[] = '--tpgb-BRC' . $n . ':' . $val['color'];
			}
		}
		return implode( ';', $parts );
	}

	/**
	 * Build a border-radius CSS value from a Nexter global radius object (md/sm/xs + corners).
	 *
	 * @param mixed $raw tpgb-R*.value.
	 * @return string
	 */
	protected function build_tpgb_border_radius_css_value( $raw ) {
		if ( is_object( $raw ) ) {
			$raw = json_decode( wp_json_encode( $raw ), true );
		}
		if ( ! is_array( $raw ) ) {
			return '';
		}
		$unit_fallback = 'px';
		if ( isset( $raw['unit'] ) && is_string( $raw['unit'] ) && '' !== $raw['unit'] ) {
			$unit_fallback = $raw['unit'];
		}
		$blk = null;
		foreach ( array( 'md', 'sm', 'xs' ) as $bp ) {
			if ( isset( $raw[ $bp ] ) && is_array( $raw[ $bp ] ) ) {
				$blk = $raw[ $bp ];
				break;
			}
		}
		if ( null === $blk && isset( $raw['top'] ) ) {
			$blk = $raw;
		}
		if ( ! is_array( $blk ) ) {
			return '';
		}
		$u = $unit_fallback;
		if ( isset( $blk['unit'] ) && is_string( $blk['unit'] ) && '' !== $blk['unit'] ) {
			$u = $blk['unit'];
		}
		$corners = array( 'top', 'right', 'bottom', 'left' );
		$parts   = array();
		foreach ( $corners as $c ) {
			$v = array_key_exists( $c, $blk ) ? $blk[ $c ] : 0;
			if ( null === $v || '' === $v ) {
				$v = 0;
			}
			if ( is_string( $v ) && ! is_numeric( $v ) ) {
				$v = preg_replace( '/[^0-9.\-]/', '', $v );
			}
			$parts[] = (string) $v . $u;
		}
		if ( 1 === count( array_unique( $parts ) ) ) {
			return $parts[0];
		}
		return implode( ' ', $parts );
	}

	/**
	 * Build :root border-radius declarations from globals (tpgb-R{n} and tpgb-RAD{n} for block runtime).
	 *
	 * Uses every entry in metadata.radius verbatim as a CSS custom property
	 * (key → --key: value). This covers tpgb-RAD{n} tokens in a single pass,
	 * matching how metadata.shadows is handled for box-shadows.
	 * Falls back to computing --tpgb-R{n} and any --tpgb-RAD{n} not already
	 * covered by metadata.radius from top-level tpgb-R{n} value objects.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return string Semicolon-separated declarations (no outer :root).
	 */
	protected function build_tpgb_radius_css_rules_from_globals( array $globals ) {
		$parts        = array();
		$meta_emitted = array(); // tracks tpgb-RAD{n} keys already emitted from metadata.radius

		// ── 1. Emit every metadata.radius entry verbatim. ─────────────────────
		if ( ! empty( $globals['metadata']['radius'] ) && is_array( $globals['metadata']['radius'] ) ) {
			foreach ( $globals['metadata']['radius'] as $key => $val ) {
				if ( ! is_string( $key ) || ! is_string( $val ) ) {
					continue;
				}
				$radius = trim( $val );
				if ( '' !== $radius ) {
					$parts[]              = '--' . $key . ':' . $radius;
					$meta_emitted[ $key ] = true;
				}
			}
		}

		// ── 2. Fall back: compute tpgb-R{n} tokens; emit --tpgb-R{n} always and
		//       --tpgb-RAD{n} only when not already covered by metadata.radius.
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-r(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n   = (int) $m[1];
			$val = isset( $entry['value'] ) ? $entry['value'] : null;
			if ( is_object( $val ) ) {
				$val = json_decode( wp_json_encode( $val ), true );
			}
			if ( ! is_array( $val ) ) {
				continue;
			}
			$css = $this->build_tpgb_border_radius_css_value( $val );
			if ( '' === $css ) {
				continue;
			}
			$parts[] = '--tpgb-R' . $n . ':' . $css;
			$rad_key = 'tpgb-RAD' . $n;
			if ( ! isset( $meta_emitted[ $rad_key ] ) ) {
				$parts[] = '--tpgb-RAD' . $n . ':' . $css;
			}
		}
		return implode( ';', $parts );
	}

	/**
	 * Build :root CSS for TPG global tokens (colors, typography, gradients, shadows, etc.).
	 *
	 * When globals.json is provided, color / gradient / box-shadow / radius variables use real token indices (e.g. --tpgb-C16),
	 * matching dense presets and block JSON. Without globals, preset row order is used (legacy).
	 *
	 * @param array      $preset       Import preset.
	 * @param array|null $globals_data Original globals.json (typography CSS uses tpgb-T{n} keys only, no gap fill; see filter below).
	 * @return string
	 */
	protected function build_tpgb_root_css_from_import_preset( array $preset, ?array $globals_data = null ) {
		$rules = array();

		if ( is_array( $globals_data ) ) {
			$color_css = $this->build_tpgb_color_css_rules_from_globals( $globals_data );
			if ( '' !== $color_css ) {
				$rules[] = $color_css;
			}
		} elseif ( ! empty( $preset['colors'] ) && is_array( $preset['colors'] ) ) {
			foreach ( $preset['colors'] as $idx => $row ) {
				if ( ! is_array( $row ) || ! isset( $row['value'] ) || ! is_string( $row['value'] ) ) {
					continue;
				}
				$hex = trim( $row['value'] );
				if ( ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $hex ) ) {
					continue;
				}
				$n       = (int) $idx + 1;
				$rules[] = '--tpgb-C' . $n . ':' . $hex;
			}
		}

		$typo_rules = $this->build_tpgb_typography_css_rules_from_globals_or_preset( $preset, $globals_data );
		if ( '' !== $typo_rules ) {
			$rules[] = $typo_rules;
		}

		if ( is_array( $globals_data ) ) {
			$grad_css = $this->build_tpgb_gradient_css_rules_from_globals( $globals_data );
			if ( '' !== $grad_css ) {
				$rules[] = $grad_css;
			}
		} elseif ( ! empty( $preset['gradient'] ) && is_array( $preset['gradient'] ) ) {
			foreach ( $preset['gradient'] as $idx => $row ) {
				if ( ! is_array( $row ) || ! isset( $row['value'] ) || ! is_string( $row['value'] ) ) {
					continue;
				}
				$val = trim( $row['value'] );
				if ( '' === $val ) {
					continue;
				}
				$n       = (int) $idx + 1;
				$rules[] = '--tpgb-GC' . $n . ':' . $val;
			}
		}

		if ( is_array( $globals_data ) ) {
			$bs_css = $this->build_tpgb_boxshadow_css_rules_from_globals( $globals_data );
			if ( '' !== $bs_css ) {
				$rules[] = $bs_css;
			}
		} elseif ( ! empty( $preset['boxshadow'] ) && is_array( $preset['boxshadow'] ) ) {
			foreach ( $preset['boxshadow'] as $idx => $row ) {
				if ( ! is_array( $row ) || empty( $row['value'] ) || ! is_array( $row['value'] ) ) {
					continue;
				}
				$shadow = $this->build_tpgb_box_shadow_css_value( $row['value'] );
				if ( '' === $shadow ) {
					continue;
				}
				$n       = (int) $idx + 1;
				$rules[] = '--tpgb-BS' . $n . ':' . $shadow;
			}
		}

		if ( is_array( $globals_data ) ) {
			$border_css = $this->build_tpgb_border_css_rules_from_globals( $globals_data );
			if ( '' !== $border_css ) {
				$rules[] = $border_css;
			}
		}

		if ( is_array( $globals_data ) ) {
			$r_css = $this->build_tpgb_radius_css_rules_from_globals( $globals_data );
			if ( '' !== $r_css ) {
				$rules[] = $r_css;
			}
		} else {
			$rad_rows = array();
			if ( ! empty( $preset['borderradius'] ) && is_array( $preset['borderradius'] ) ) {
				$rad_rows = $preset['borderradius'];
			}
			foreach ( $rad_rows as $idx => $row ) {
				if ( ! is_array( $row ) || ! isset( $row['value'] ) ) {
					continue;
				}
				$rad = $this->build_tpgb_border_radius_css_value( $row['value'] );
				if ( '' === $rad ) {
					continue;
				}
				$n       = (int) $idx + 1;
				$rules[] = '--tpgb-R' . $n . ':' . $rad;
				$rules[] = '--tpgb-RAD' . $n . ':' . $rad;
			}
		}

		if ( empty( $rules ) ) {
			return '';
		}

		$inner = implode( ';', $rules );

		$css = ':root{' . $inner . ';}';

		// Tablet responsive typography (compact positions, for remapped globalTypo).
		$tablet = $this->build_tpgb_responsive_typography_css( $preset, 'sm', '1024' );
		if ( '' !== $tablet ) {
			$css .= '@media (max-width:1024px){:root{' . $tablet . ';}}';
		}

		// Mobile responsive typography (compact positions, for remapped globalTypo).
		$mobile = $this->build_tpgb_responsive_typography_css( $preset, 'xs', '767' );
		if ( '' !== $mobile ) {
			$css .= '@media (max-width:767px){:root{' . $mobile . ';}}';
		}

		// Responsive CSS for original slot vars — block attrs reference these after var() wrapping.
		if ( is_array( $globals_data ) ) {
			$orig_tablet = $this->build_tpgb_responsive_typography_css_from_globals( $globals_data, 'sm' );
			if ( '' !== $orig_tablet ) {
				$css .= '@media (max-width:1024px){:root{' . $orig_tablet . ';}}';
			}
			$orig_mobile = $this->build_tpgb_responsive_typography_css_from_globals( $globals_data, 'xs' );
			if ( '' !== $orig_mobile ) {
				$css .= '@media (max-width:767px){:root{' . $orig_mobile . ';}}';
			}
		}

		return $css;
	}

	protected function build_tpgb_responsive_typography_css( array $preset, $device ) {

		if ( empty( $preset['typography'] ) || ! is_array( $preset['typography'] ) ) {
			return '';
		}

		$rules = array();

		foreach ( $preset['typography'] as $idx => $row ) {

			if ( empty( $row['value'] ) || ! is_array( $row['value'] ) ) {
				continue;
			}

			$n     = (int) $idx + 1;
			$value = $row['value'];

			// Font size.
			if (
				isset( $value['size'][ $device ] ) &&
				'' !== (string) $value['size'][ $device ]
			) {

				$unit = ! empty( $value['size']['unit'] )
					? $value['size']['unit']
					: 'px';

				$rules[] =
					'--tpgb-T' . $n . '-font-size:' .
					$this->format_tpgb_css_number_for_global( $value['size'][ $device ] ) .
					$unit;
			}

			// Line height.
			if (
				isset( $value['height'][ $device ] ) &&
				'' !== (string) $value['height'][ $device ]
			) {

				$unit = ! empty( $value['height']['unit'] )
					? $value['height']['unit']
					: 'px';

				$rules[] =
					'--tpgb-T' . $n . '-line-height:' .
					$this->format_tpgb_css_number_for_global( $value['height'][ $device ] ) .
					$unit;
			}
		}

		return implode( ';', $rules );
	}

	/**
	 * Responsive typography overrides using ORIGINAL slot numbers from globals.json.
	 *
	 * Block attrs reference original slot CSS vars (e.g. var(--tpgb-T25-font-size)).
	 * This emits responsive overrides for those same var names so they change at
	 * tablet/mobile breakpoints. Reads from metadata.typography (-sm/-xs suffix keys)
	 * when available, otherwise falls back to the structured typography section.
	 *
	 * @param array  $globals_data globals.json decoded array.
	 * @param string $device       'sm' (tablet) or 'xs' (mobile).
	 * @return string Semicolon-separated declarations (no outer block).
	 */
	protected function build_tpgb_responsive_typography_css_from_globals( array $globals_data, $device ) {
		$suffix = '-' . $device;
		$slen   = strlen( $suffix );

		// metadata.typography has pre-computed keys like "--tpgb-T25-font-size-sm" → "64px".
		if ( ! empty( $globals_data['metadata']['typography'] ) && is_array( $globals_data['metadata']['typography'] ) ) {
			$parts = array();
			foreach ( $globals_data['metadata']['typography'] as $key => $val ) {
				if ( ! is_string( $key ) || ! is_string( $val ) || '' === $val ) {
					continue;
				}
				if ( substr( $key, -$slen ) !== $suffix ) {
					continue;
				}
				// Strip -sm/-xs suffix: "--tpgb-T25-font-size-sm" → "--tpgb-T25-font-size"
				$base_key = substr( $key, 0, -$slen );
				$parts[]  = $base_key . ':' . $val;
			}
			return implode( ';', $parts );
		}

		// Fallback: compute from structured globals['typography'] with original slot numbers.
		if ( empty( $globals_data['typography'] ) || ! is_array( $globals_data['typography'] ) ) {
			return '';
		}

		$rules = array();
		foreach ( $globals_data['typography'] as $key => $entry ) {
			if ( ! is_array( $entry ) || ! preg_match( '/^tpgb-t(\d+)$/i', (string) $key, $m ) ) {
				continue;
			}
			$orig_slot = (int) $m[1];
			$row       = $this->convert_flat_tpgb_typography_to_preset_entry( $entry );
			$value     = $row['value'];

			if ( isset( $value['size'][ $device ] ) && '' !== (string) $value['size'][ $device ] ) {
				$unit    = ! empty( $value['size']['unit'] ) ? $value['size']['unit'] : 'px';
				$rules[] = '--tpgb-T' . $orig_slot . '-font-size:' . $this->format_tpgb_css_number_for_global( $value['size'][ $device ] ) . $unit;
			}
			if ( isset( $value['height'][ $device ] ) && '' !== (string) $value['height'][ $device ] ) {
				$unit    = ! empty( $value['height']['unit'] ) ? $value['height']['unit'] : 'px';
				$rules[] = '--tpgb-T' . $orig_slot . '-line-height:' . $this->format_tpgb_css_number_for_global( $value['height'][ $device ] ) . $unit;
			}
			if ( isset( $value['spacing'][ $device ] ) && '' !== (string) $value['spacing'][ $device ] ) {
				$unit    = ! empty( $value['spacing']['unit'] ) ? $value['spacing']['unit'] : 'px';
				$rules[] = '--tpgb-T' . $orig_slot . '-letter-spacing:' . $this->format_tpgb_css_number_for_global( $value['spacing'][ $device ] ) . $unit;
			}
		}
		return implode( ';', $rules );
	}

	/**
	 * Build all typography :root declarations.
	 *
	 * By default emits --tpgb-T{n} only for slots present in globals.json (no 1..max gap fillers). Preset and CSS
	 * then match the same token set. Pages must use globalTypo / --tpgb-T{n} for those slots only; if a page
	 * references a missing slot, use filter `uich_webpage_tpgb_typography_slots_for_css` to add slot numbers (placeholders
	 * are generated for slots listed there but absent from globals).
	 *
	 * @param array      $preset       Import preset.
	 * @param array|null $globals_data Original globals.json.
	 * @return string Semicolon-separated declarations (no outer :root).
	 */
	protected function build_tpgb_typography_css_rules_from_globals_or_preset( array $preset, ?array $globals_data = null ) {
		$chunks = array();

		if ( null !== $globals_data && ! empty( $globals_data['typography'] ) && is_array( $globals_data['typography'] ) ) {
			$slot_map = array();
			foreach ( $globals_data['typography'] as $key => $entry ) {
				if ( ! is_array( $entry ) || ! preg_match( '/^tpgb-t(\d+)$/i', (string) $key, $m ) ) {
					continue;
				}
				$slot_map[ (int) $m[1] ] = $entry;
			}
			if ( ! empty( $slot_map ) ) {
				// Build original-slot → compact-position map so CSS vars match the gap-free preset array.
				$typo_remap = $this->build_tpgb_typo_slot_remap_from_slot_map( $slot_map );

				$orig_slots = array_keys( $slot_map );
				sort( $orig_slots, SORT_NUMERIC );

				foreach ( $orig_slots as $orig_slot ) {
					$css_pos = isset( $typo_remap[ $orig_slot ] ) ? $typo_remap[ $orig_slot ] : $orig_slot;
					$row     = $this->convert_flat_tpgb_typography_to_preset_entry( $slot_map[ $orig_slot ] );
					// Use ORIGINAL slot number so block-attr CSS var refs like
					// "size":"--tpgb-T25-font-size" resolve after var() wrapping.
					$css = $this->build_tpgb_typography_css_variables_for_slot( $orig_slot, $row['value'] );
					if ( '' !== $css ) {
						$chunks[] = $css;
					}
					// Also emit compact-position alias so remapped globalTypo per-block vars resolve.
					if ( $css_pos !== $orig_slot ) {
						$css_compact = $this->build_tpgb_typography_css_variables_for_slot( $css_pos, $row['value'] );
						if ( '' !== $css_compact ) {
							$chunks[] = $css_compact;
						}
					}
				}
				return implode( ';', $chunks );
			}
		}

		if ( ! empty( $preset['typography'] ) && is_array( $preset['typography'] ) ) {
			foreach ( $preset['typography'] as $idx => $row ) {
				if ( ! is_array( $row ) || empty( $row['value'] ) || ! is_array( $row['value'] ) ) {
					continue;
				}
				$n   = (int) $idx + 1;
				$css = $this->build_tpgb_typography_css_variables_for_slot( $n, $row['value'] );
				if ( '' !== $css ) {
					$chunks[] = $css;
				}
			}
		}

		return implode( ';', $chunks );
	}

	/**
	 * Default typography value for gaps when padding the preset array so editor indices match globalTypo (1-based slot).
	 *
	 * @return array
	 */
	protected function get_tpgb_placeholder_typography_value() {
		return array(
			'openTypography' => 1,
			'size'           => array(
				'md'   => 16,
				'unit' => 'px',
			),
			'height'         => array(
				'md'   => 24,
				'unit' => 'px',
			),
			'fontFamily'     => array(
				'family'     => 'inherit',
				'type'       => 'sans-serif',
				'fontWeight' => 400,
			),
			'spacing'        => array(
				'md'   => 0,
				'unit' => 'px',
			),
		);
	}

	/**
	 * Emit typography custom properties for one preset slot (matches tp-generate-block-css cssTypography).
	 *
	 * @param int   $n     1-based slot (matches globalTypo / --tpgb-T{n}).
	 * @param array $value Preset typography value object.
	 * @return string Semicolon-separated declarations without leading selector.
	 */
	protected function build_tpgb_typography_css_variables_for_slot( $n, array $value ) {
		$prefix = '--tpgb-T' . (int) $n;

		$size   = isset( $value['size'] ) && is_array( $value['size'] ) ? $value['size'] : array();
		$height = isset( $value['height'] ) && is_array( $value['height'] ) ? $value['height'] : array();
		$space  = isset( $value['spacing'] ) && is_array( $value['spacing'] ) ? $value['spacing'] : array();
		$ff     = isset( $value['fontFamily'] ) && is_array( $value['fontFamily'] ) ? $value['fontFamily'] : array();

		$fs = '';
		if ( isset( $size['md'], $size['unit'] ) ) {
			$fs = $this->format_tpgb_css_number_for_global( $size['md'] ) . $size['unit'];
		}
		$lh = '';
		if ( isset( $height['md'], $height['unit'] ) ) {
			$lh = $this->format_tpgb_css_number_for_global( $height['md'] ) . $height['unit'];
		}
		$ls = '';
		if ( isset( $space['md'], $space['unit'] ) ) {
			$ls = $this->format_tpgb_css_number_for_global( $space['md'] ) . $space['unit'];
		}

		$family = '';
		$type   = 'sans-serif';
		if ( isset( $ff['family'] ) && is_string( $ff['family'] ) && '' !== $ff['family'] ) {
			$family = "'" . str_replace( "'", "\\'", $ff['family'] ) . "'";
		}
		if ( isset( $ff['type'] ) && is_string( $ff['type'] ) && '' !== $ff['type'] ) {
			$type = $ff['type'];
		}
		$font_stack = '' !== $family ? $family . ',' . $type : $type;

		$weight = 400;
		if ( isset( $ff['fontWeight'] ) ) {
			$weight = (int) $ff['fontWeight'];
		}
		if ( 1 > $weight ) {
			$weight = 400;
		}

		$style = 'normal';
		if ( isset( $value['fontStyle'] ) && is_string( $value['fontStyle'] ) && '' !== $value['fontStyle'] && 'default' !== $value['fontStyle'] ) {
			$style = $value['fontStyle'];
		}

		$tt = 'none';
		if ( isset( $value['textTransform'] ) && is_string( $value['textTransform'] ) && '' !== $value['textTransform'] ) {
			$tt = $value['textTransform'];
		}

		$td = 'none';
		if ( isset( $value['textDecoration'] ) && is_string( $value['textDecoration'] ) && '' !== $value['textDecoration'] && 'default' !== $value['textDecoration'] ) {
			$td = $value['textDecoration'];
		}

		$parts = array(
			$prefix . '-font-family:' . $font_stack,
			$prefix . '-font-weight:' . $weight,
			$prefix . '-font-style:' . $style,
			$prefix . '-font-size:' . ( '' !== $fs ? $fs : '16px' ),
			$prefix . '-line-height:' . ( '' !== $lh ? $lh : '24px' ),
			$prefix . '-letter-spacing:' . ( '' !== $ls ? $ls : '0px' ),
			$prefix . '-text-transform:' . $tt,
			$prefix . '-text-decoration:' . $td,
		);

		// Responsive font-size and line-height (sm = tablet, xs = mobile).
		foreach ( array( 'sm', 'xs' ) as $bp ) {
			if ( isset( $size[ $bp ] ) && '' !== (string) $size[ $bp ] ) {
				$unit    = isset( $size['unit'] ) ? $size['unit'] : 'px';
				$parts[] = $prefix . '-font-size-' . $bp . ':' . $this->format_tpgb_css_number_for_global( $size[ $bp ] ) . $unit;
			}
			if ( isset( $height[ $bp ] ) && '' !== (string) $height[ $bp ] ) {
				$unit    = isset( $height['unit'] ) ? $height['unit'] : 'px';
				$parts[] = $prefix . '-line-height-' . $bp . ':' . $this->format_tpgb_css_number_for_global( $height[ $bp ] ) . $unit;
			}
		}

		return implode( ';', $parts );
	}

	/**
	 * @param mixed $num Numeric value from preset.
	 * @return string
	 */
	protected function format_tpgb_css_number_for_global( $num ) {
		if ( is_numeric( $num ) ) {
			return (string) ( 0 + $num );
		}
		return (string) $num;
	}

	/**
	 * Box-shadow value for --tpgb-BS{n} (no `box-shadow:` prefix).
	 *
	 * @param array $val Shadow fields from preset.
	 * @return string
	 */
	protected function build_tpgb_box_shadow_css_value( array $val ) {
		if ( empty( $val['openShadow'] ) ) {
			return '';
		}
		$inset = ! empty( $val['inset'] ) ? 'inset ' : '';
		$h     = isset( $val['horizontal'] ) ? (int) $val['horizontal'] : 0;
		$v     = isset( $val['vertical'] ) ? (int) $val['vertical'] : 0;
		$b     = isset( $val['blur'] ) ? (int) $val['blur'] : 0;
		$s     = isset( $val['spread'] ) ? (int) $val['spread'] : 0;
		$col   = isset( $val['color'] ) && is_string( $val['color'] ) ? $val['color'] : 'rgba(0,0,0,0.15)';

		return trim( $inset . $h . 'px ' . $v . 'px ' . $b . 'px ' . $s . 'px ' . $col );
	}

	/**
	 * Google Fonts stylesheet URL for typography preset (legacy fonts.googleapis.com format).
	 *
	 * @param array $preset Import preset.
	 * @return string
	 */
	protected function build_tpgb_google_font_link_from_import_preset( array $preset ) {
		if ( empty( $preset['typography'] ) || ! is_array( $preset['typography'] ) ) {
			return '';
		}
		$families = array();
		foreach ( $preset['typography'] as $row ) {
			if ( ! is_array( $row ) || empty( $row['value']['fontFamily'] ) || ! is_array( $row['value']['fontFamily'] ) ) {
				continue;
			}
			$ff = $row['value']['fontFamily'];
			if ( empty( $ff['family'] ) || ! is_string( $ff['family'] ) ) {
				continue;
			}
			$fam = $ff['family'];
			if ( in_array( strtolower( $fam ), array( 'inherit', 'initial', 'sans-serif', 'serif', 'monospace', 'system-ui' ), true ) ) {
				continue;
			}
			$w = isset( $ff['fontWeight'] ) ? (int) $ff['fontWeight'] : 400;
			if ( 1 > $w ) {
				$w = 400;
			}
			// Collect weights as a de-duplicated set (key = weight). Accumulating a raw
			// comma string produced duplicates like "600,500,500,400,400".
			if ( ! isset( $families[ $fam ] ) ) {
				$families[ $fam ] = array();
			}
			$families[ $fam ][ $w ] = true;
		}
		if ( empty( $families ) ) {
			return '';
		}
		$join = '';
		foreach ( $families as $family => $weights ) {
			// Always include weight 400 (the universally-available base face). The legacy
			// Google Fonts API drops a family ENTIRELY — returning 200 but omitting its
			// @font-face — when every requested weight is unavailable for it (e.g. a
			// display/handwriting font like "Cedarville Cursive" requested at 500/600/700,
			// which only ships 400). Including 400 guarantees the family is served; the
			// browser faux-synthesises the heavier weights instead of falling back to a
			// completely different font. Weights are de-duplicated and sorted.
			$weights[400] = true;
			$weight_list  = array_keys( $weights );
			sort( $weight_list, SORT_NUMERIC );
			if ( '' !== $join ) {
				$join .= '|';
			}
			$join .= str_replace( ' ', '+', $family ) . ':' . implode( ',', $weight_list );
		}

		return 'https://fonts.googleapis.com/css?family=' . $join;
	}

	/**
	 * Build TPG preset colors from tpgb-C{n} keys (dense: only defined slots, sorted by n).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: string }.
	 */
	protected function build_tpgb_preset_colors_from_globals( array $globals ) {
		$color_map = $this->extract_global_colors_from_globals( $globals );
		$slots     = array();
		foreach ( $color_map as $id => $entry ) {
			if ( ! preg_match( '/^tpgb-c(\d+)$/i', (string) $id, $m ) ) {
				continue;
			}
			$n     = (int) $m[1];
			$hex   = '';
			$label = 'Color';
			if ( is_array( $entry ) && isset( $entry['hex'] ) ) {
				$hex = $entry['hex'];
				if ( isset( $entry['title'] ) && is_string( $entry['title'] ) && '' !== $entry['title'] ) {
					$label = $entry['title'];
				}
			} elseif ( is_string( $entry ) ) {
				$hex = $entry;
			}
			if ( '' === $hex || ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $hex ) ) {
				continue;
			}
			$slots[ $n ] = array(
				'label' => $label,
				'value' => $hex,
			);
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Build original-slot → compact-sequential-position map from a slot-keyed typography array.
	 *
	 * E.g. if globals defines tpgb-T8, tpgb-T9, tpgb-T12 the map is [ 8 => 1, 9 => 2, 12 => 3 ].
	 * Used both during globals import (stored in DB as uich_webpage_tpgb_typo_remap) and inline by the
	 * CSS-variable generator so that --tpgb-T1/T2/T3 match preset.typography[0/1/2].
	 *
	 * @param array $slot_map Slot-keyed array (int slot => entry).
	 * @return array Map of original slot number → 1-based compact position.
	 */
	protected function build_tpgb_typo_slot_remap_from_slot_map( array $slot_map ) {
		$orig_slots = array_keys( $slot_map );
		sort( $orig_slots, SORT_NUMERIC );
		$remap = array();
		foreach ( $orig_slots as $pos => $orig_slot ) {
			$remap[ $orig_slot ] = $pos + 1;
		}
		return $remap;
	}

	/**
	 * Build original-slot → compact-sequential-position map from the slot-keyed typography array.
	 *
	 * Accepts the output of build_tpgb_preset_typography_from_globals (slot-keyed: key = original slot number).
	 * E.g. [ 8 => {…}, 9 => {…}, 12 => {…} ] → [ 8 => 1, 9 => 2, 12 => 3 ].
	 * Returns empty array when slots are already sequential starting at 1 (no remap needed).
	 *
	 * @param array $typo_out Slot-keyed typography rows (output of build_tpgb_preset_typography_from_globals).
	 * @return array Map of original slot number → 1-based compact position, or empty array if nothing to remap.
	 */
	protected function build_tpgb_typo_slot_remap( array $typo_out ) {
		if ( empty( $typo_out ) ) {
			return array();
		}
		$orig_slots = array_keys( $typo_out );
		sort( $orig_slots, SORT_NUMERIC );
		// No remap needed if slots are already 1, 2, 3 … n.
		if ( range( 1, count( $orig_slots ) ) === $orig_slots ) {
			return array();
		}
		$remap = array();
		foreach ( $orig_slots as $pos => $orig_slot ) {
			$remap[ $orig_slot ] = $pos + 1;
		}
		return $remap;
	}

	/**
	 * Walk a parsed-blocks tree and remap every `globalTypo` attribute value.
	 *
	 * @param array $blocks     Parsed block array (from parse_blocks).
	 * @param array $typo_remap Map of original slot → compact position.
	 * @return array Updated blocks array.
	 */
	protected function remap_globalTypo_in_blocks( array $blocks, array $typo_remap ) {
		foreach ( $blocks as &$block ) {
			if ( ! empty( $block['attrs'] ) && is_array( $block['attrs'] ) ) {
				$block['attrs'] = $this->remap_globalTypo_in_attrs_recursive( $block['attrs'], $typo_remap );
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->remap_globalTypo_in_blocks( $block['innerBlocks'], $typo_remap );
			}
		}
		unset( $block );
		return $blocks;
	}

	/**
	 * Recursively remap `globalTypo` integer values within a block attrs array.
	 *
	 * @param array $attrs      Block attributes array (may be nested).
	 * @param array $typo_remap Map of original slot → compact position.
	 * @return array Updated attrs array.
	 */
	protected function remap_globalTypo_in_attrs_recursive( array $attrs, array $typo_remap ) {
		foreach ( $attrs as $key => &$val ) {
			if ( 'globalTypo' === $key ) {
				$orig_int = is_numeric( $val ) ? (int) $val : null;
				if ( null !== $orig_int && isset( $typo_remap[ $orig_int ] ) ) {
					// Store as integer — matches the type Gutenberg uses after a manual save.
					$val = (int) $typo_remap[ $orig_int ];
				}
			} elseif ( is_array( $val ) ) {
				$val = $this->remap_globalTypo_in_attrs_recursive( $val, $typo_remap );
			}
		}
		unset( $val );
		return $attrs;
	}

	/**
	 * Remap globalTypo values inside button preset entries.
	 *
	 * Button presets store typography settings that may reference globalTypo by original slot number.
	 *
	 * @param array $btnpresets Button preset rows.
	 * @param array $typo_remap Map of original slot → compact position.
	 * @return array Updated button preset rows.
	 */
	protected function remap_globalTypo_in_button_presets( array $btnpresets, array $typo_remap ) {
		foreach ( $btnpresets as &$preset ) {
			if ( is_array( $preset ) ) {
				$preset = $this->remap_globalTypo_in_attrs_recursive( $preset, $typo_remap );
			}
		}
		unset( $preset );
		return $btnpresets;
	}

	/**
	 * Build TPG preset typography from globals.typography tpgb-T{n} entries.
	 *
	 * Returns a slot-keyed array (key = original tpgb-T{n} slot number) so callers can derive the
	 * original→compact position remap. The array is NOT padded with placeholders; only real entries
	 * from globals.json are included. globalTypo values in page content are remapped to the compact
	 * sequential positions by remap_globalTypo_in_blocks() (see build_tpgb_typo_slot_remap).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: array }.
	 */
	protected function build_tpgb_preset_typography_from_globals( array $globals ) {
		if ( empty( $globals['typography'] ) || ! is_array( $globals['typography'] ) ) {
			return array();
		}
		$slots = array();
		foreach ( $globals['typography'] as $key => $entry ) {
			if ( ! is_array( $entry ) || ! preg_match( '/^tpgb-t(\d+)$/i', (string) $key, $m ) ) {
				continue;
			}
			$n           = (int) $m[1];
			$slots[ $n ] = $this->convert_flat_tpgb_typography_to_preset_entry( $entry );
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Build TPG preset gradient rows from root tpgb-GC{n} or tpgb-CG{n} (Nexter export) keys.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: string }.
	 */
	protected function build_tpgb_preset_gradient_from_globals( array $globals ) {
		$slots = array();
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-(?:gc|cg)(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n   = (int) $m[1];
			$val = isset( $entry['value'] ) && is_string( $entry['value'] ) ? trim( $entry['value'] ) : '';
			if ( '' === $val ) {
				continue;
			}
			$label = '';
			if ( isset( $entry['name'] ) && is_string( $entry['name'] ) && '' !== $entry['name'] ) {
				$label = $entry['name'];
			} elseif ( isset( $entry['title'] ) && is_string( $entry['title'] ) && '' !== $entry['title'] ) {
				$label = $entry['title'];
			} else {
				$label = sprintf( /* translators: %d: gradient slot */ __( 'Gradient %d', 'uichemy' ), $n );
			}
			$slots[ $n ] = array(
				'label' => $label,
				'value' => $val,
			);
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Parse a CSS box-shadow shorthand string into a structured preset value array.
	 *
	 * Handles the format: [inset] <h-offset> <v-offset> <blur> <spread> <color>
	 * where <color> may be a CSS variable like var(--tpgb-C11) or a plain color value.
	 *
	 * Returns null when the string cannot be parsed.
	 *
	 * @param string $css CSS shadow shorthand, e.g. "6px 6px 0px 0px var(--tpgb-C11)".
	 * @return array|null Structured preset object or null on failure.
	 */
	protected function parse_css_shadow_string_to_preset_value( $css ) {
		$css = trim( $css );
		if ( '' === $css || 'none' === strtolower( $css ) ) {
			return null;
		}

		$inset = 0;
		// Strip leading/trailing "inset" keyword (case-insensitive).
		if ( preg_match( '/^inset\s+/i', $css ) ) {
			$inset = 1;
			$css   = preg_replace( '/^inset\s+/i', '', $css );
		} elseif ( preg_match( '/\s+inset$/i', $css ) ) {
			$inset = 1;
			$css   = preg_replace( '/\s+inset$/i', '', $css );
		}

		// Extract var(...) color first so nested commas/parens don't confuse splitting.
		$color = '';
		if ( preg_match( '/\bvar\s*\(([^)]+)\)\s*$/i', $css, $vm ) ) {
			$color = trim( $vm[0] );
			$css   = trim( substr( $css, 0, strrpos( $css, $vm[0] ) ) );
		}

		// Remaining tokens should be: h-offset v-offset [blur [spread]] [color]
		$tokens = preg_split( '/\s+/', trim( $css ), -1, PREG_SPLIT_NO_EMPTY );
		if ( empty( $tokens ) ) {
			return null;
		}

		// If color was not captured by var() regex, last token may be a color.
		if ( '' === $color && count( $tokens ) >= 3 ) {
			$last = end( $tokens );
			// Treat as color if it starts with #, rgb, hsl, or is a named color keyword.
			if ( preg_match( '/^(#|rgb|hsl)/i', $last ) || ! preg_match( '/^-?[\d.]+/', $last ) ) {
				$color  = $last;
				$tokens = array_slice( $tokens, 0, -1 );
			}
		}

		if ( count( $tokens ) < 2 ) {
			return null;
		}

		$parse_px = static function ( $v ) {
			return (float) preg_replace( '/[^0-9.\-]/', '', $v );
		};

		$horizontal = $parse_px( $tokens[0] );
		$vertical   = $parse_px( $tokens[1] );
		$blur       = isset( $tokens[2] ) ? $parse_px( $tokens[2] ) : 0;
		$spread     = isset( $tokens[3] ) ? $parse_px( $tokens[3] ) : 0;

		return array(
			'openShadow' => 1,
			'inset'      => $inset,
			'horizontal' => $horizontal,
			'vertical'   => $vertical,
			'blur'       => $blur,
			'spread'     => $spread,
			'color'      => $color,
		);
	}

	/**
	 * Parse a CSS 4-side shorthand (e.g. "1px 1px 3px 1px") into a TPG preset
	 * sides object: { md: { top, right, bottom, left, unit }, unit }.
	 *
	 * Supports 1, 2, 3, and 4 token forms. Returns null on failure.
	 *
	 * @param string $css CSS shorthand string.
	 * @return array|null
	 */
	protected function parse_css_4side_string_to_preset_sides( $css ) {
		$css = trim( $css );
		if ( '' === $css || 'none' === strtolower( $css ) ) {
			return null;
		}
		$tokens = preg_split( '/\s+/', $css, -1, PREG_SPLIT_NO_EMPTY );
		if ( empty( $tokens ) ) {
			return null;
		}

		// Extract unit from the first token that has one.
		$unit = 'px';
		foreach ( $tokens as $t ) {
			if ( preg_match( '/([a-z%]+)$/i', $t, $um ) ) {
				$unit = strtolower( $um[1] );
				break;
			}
		}

		$parse = static function ( $v ) {
			return (string) preg_replace( '/[^0-9.\-]/', '', $v );
		};

		$count = count( $tokens );
		if ( 1 === $count ) {
			$v     = $parse( $tokens[0] );
			$sides = array( 'top' => $v, 'right' => $v, 'bottom' => $v, 'left' => $v );
		} elseif ( 2 === $count ) {
			$tb    = $parse( $tokens[0] );
			$lr    = $parse( $tokens[1] );
			$sides = array( 'top' => $tb, 'right' => $lr, 'bottom' => $tb, 'left' => $lr );
		} elseif ( 3 === $count ) {
			$top    = $parse( $tokens[0] );
			$lr     = $parse( $tokens[1] );
			$bottom = $parse( $tokens[2] );
			$sides  = array( 'top' => $top, 'right' => $lr, 'bottom' => $bottom, 'left' => $lr );
		} else {
			$sides = array(
				'top'    => $parse( $tokens[0] ),
				'right'  => $parse( $tokens[1] ),
				'bottom' => $parse( $tokens[2] ),
				'left'   => $parse( $tokens[3] ),
			);
		}
		$sides['unit'] = $unit;

		return array(
			'md'   => $sides,
			'unit' => $unit,
		);
	}

	/**
	 * Build TPG preset box-shadow rows from root tpgb-BS{n} keys (matches --tpgb-BS{n}).
	 *
	 * Prefers pre-computed values from metadata.shadows (which may include CSS variable
	 * color references like var(--tpgb-C11)) and falls back to the top-level entry['value']
	 * objects only when a metadata.shadows entry is absent.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: array }.
	 */
	protected function build_tpgb_preset_boxshadow_from_globals( array $globals ) {
		$meta_shadows = array();
		if ( ! empty( $globals['metadata']['shadows'] ) && is_array( $globals['metadata']['shadows'] ) ) {
			$meta_shadows = $globals['metadata']['shadows'];
		}

		$slots = array();
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-bs(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n = (int) $m[1];

			$label = '';
			if ( isset( $entry['name'] ) && is_string( $entry['name'] ) && '' !== $entry['name'] ) {
				$label = $entry['name'];
			} else {
				$label = sprintf( /* translators: %d: shadow slot */ __( 'Shadow %d', 'uichemy' ), $n );
			}

			// Prefer metadata.shadows value (preserves var() color references).
			// Try exact key first (metadata uses same casing as top-level, e.g. "tpgb-BS3"),
			// then try lowercase fallback for robustness.
			$preset_value = null;
			if ( isset( $meta_shadows[ $key ] ) && is_string( $meta_shadows[ $key ] ) ) {
				$preset_value = $this->parse_css_shadow_string_to_preset_value( $meta_shadows[ $key ] );
			}
			if ( null === $preset_value ) {
				$meta_key_lc = strtolower( $key );
				if ( isset( $meta_shadows[ $meta_key_lc ] ) && is_string( $meta_shadows[ $meta_key_lc ] ) ) {
					$preset_value = $this->parse_css_shadow_string_to_preset_value( $meta_shadows[ $meta_key_lc ] );
				}
			}

			// Fall back to top-level entry['value'] when metadata.shadows has no entry.
			if ( null === $preset_value ) {
				if ( empty( $entry['value'] ) || ! is_array( $entry['value'] ) ) {
					continue;
				}
				$preset_value = $this->normalize_tpgb_box_shadow_value_for_preset( $entry['value'] );
			}

			if ( null === $preset_value ) {
				continue;
			}

			$slots[ $n ] = array(
				'label' => $label,
				'value' => $preset_value,
			);
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Build TPG preset spacing rows from root tpgb-S{n} keys.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: array }.
	 */
	protected function build_tpgb_preset_spacing_from_globals( array $globals ) {
		$slots = array();
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-s(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n = (int) $m[1];
			if ( empty( $entry['value'] ) || ! is_array( $entry['value'] ) ) {
				continue;
			}
			$label = '';
			if ( isset( $entry['name'] ) && is_string( $entry['name'] ) && '' !== $entry['name'] ) {
				$label = $entry['name'];
			} else {
				$label = sprintf( /* translators: %d: spacing slot */ __( 'Spacing %d', 'uichemy' ), $n );
			}
			$slots[ $n ] = array(
				'label' => $label,
				'value' => $entry['value'],
			);
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Build TPG preset border rows from root tpgb-B{n} keys (not tpgb-BS — box shadow).
	 *
	 * Prefers pre-computed values from metadata.borders (tpgb-BRT{n} for style and
	 * tpgb-BRW{n} for width) and overrides the structured entry['value'] with those
	 * values, matching how metadata.shadows is used for box-shadow presets.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: array }.
	 */
	protected function build_tpgb_preset_border_from_globals( array $globals ) {
		$meta_borders = array();
		if ( ! empty( $globals['metadata']['borders'] ) && is_array( $globals['metadata']['borders'] ) ) {
			$meta_borders = $globals['metadata']['borders'];
		}

		$slots = array();
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-b(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n = (int) $m[1];
			if ( empty( $entry['value'] ) || ! is_array( $entry['value'] ) ) {
				continue;
			}
			$label = '';
			if ( isset( $entry['name'] ) && is_string( $entry['name'] ) && '' !== $entry['name'] ) {
				$label = $entry['name'];
			} else {
				$label = sprintf( /* translators: %d: border slot */ __( 'Border %d', 'uichemy' ), $n );
			}

			$preset_value = $this->normalize_tpgb_border_value_for_preset( $entry['value'] );

			// Override border-style (type) from metadata.borders tpgb-BRT{n} if present.
			$brt_key = 'tpgb-BRT' . $n;
			if ( isset( $meta_borders[ $brt_key ] ) && is_string( $meta_borders[ $brt_key ] ) ) {
				$brt_val = trim( $meta_borders[ $brt_key ] );
				if ( '' !== $brt_val ) {
					$preset_value['type'] = $brt_val;
				}
			}

			// Override border-width from metadata.borders tpgb-BRW{n} if present.
			$brw_key = 'tpgb-BRW' . $n;
			if ( isset( $meta_borders[ $brw_key ] ) && is_string( $meta_borders[ $brw_key ] ) ) {
				$parsed_width = $this->parse_css_4side_string_to_preset_sides( $meta_borders[ $brw_key ] );
				if ( null !== $parsed_width ) {
					$preset_value['width'] = $parsed_width;
				}
			}

			$slots[ $n ] = array(
				'label' => $label,
				'value' => $preset_value,
			);
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Build TPG preset radius rows from root tpgb-R{n} keys.
	 *
	 * Prefers pre-computed values from metadata.radius (tpgb-RAD{n} keys, e.g.
	 * "6px 6px 6px 6px") and parses them into the structured preset format,
	 * matching how metadata.shadows is used for box-shadow presets. Falls back
	 * to the top-level entry['value'] object when a metadata.radius entry is absent.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: array }.
	 */
	protected function build_tpgb_preset_radius_from_globals( array $globals ) {
		$meta_radius = array();
		if ( ! empty( $globals['metadata']['radius'] ) && is_array( $globals['metadata']['radius'] ) ) {
			$meta_radius = $globals['metadata']['radius'];
		}

		$slots = array();
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-r(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n = (int) $m[1];

			$label = '';
			if ( isset( $entry['name'] ) && is_string( $entry['name'] ) && '' !== $entry['name'] ) {
				$label = $entry['name'];
			} else {
				$label = sprintf( /* translators: %d: radius slot */ __( 'Radius %d', 'uichemy' ), $n );
			}

			// Prefer metadata.radius tpgb-RAD{n} (pre-computed CSS shorthand).
			$rad_key      = 'tpgb-RAD' . $n;
			$preset_value = null;
			if ( isset( $meta_radius[ $rad_key ] ) && is_string( $meta_radius[ $rad_key ] ) ) {
				$preset_value = $this->parse_css_4side_string_to_preset_sides( $meta_radius[ $rad_key ] );
			}

			// Fall back to top-level entry['value'] when metadata.radius has no entry.
			if ( null === $preset_value ) {
				if ( ! isset( $entry['value'] ) ) {
					continue;
				}
				$val = $entry['value'];
				if ( is_object( $val ) ) {
					$val = json_decode( wp_json_encode( $val ), true );
				}
				if ( ! is_array( $val ) || '' === $this->build_tpgb_border_radius_css_value( $val ) ) {
					continue;
				}
				$preset_value = $val;
			}

			$slots[ $n ] = array(
				'label' => $label,
				'value' => $preset_value,
			);
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Build TPG preset animation rows from root tpgb-A{n} keys (Nexter global animation tokens, e.g. fadeIn).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array List of array{ label: string, value: string }.
	 */
	protected function build_tpgb_preset_animation_from_globals( array $globals ) {
		$slots = array();
		foreach ( $globals as $key => $entry ) {
			if ( ! is_string( $key ) || ! is_array( $entry ) ) {
				continue;
			}
			if ( ! preg_match( '/^tpgb-a(\d+)$/i', $key, $m ) ) {
				continue;
			}
			$n = (int) $m[1];
			$val = '';
			if ( isset( $entry['value'] ) && is_string( $entry['value'] ) ) {
				$val = trim( $entry['value'] );
			}
			if ( '' === $val ) {
				continue;
			}
			$label = '';
			if ( isset( $entry['name'] ) && is_string( $entry['name'] ) && '' !== $entry['name'] ) {
				$label = $entry['name'];
			} elseif ( isset( $entry['title'] ) && is_string( $entry['title'] ) && '' !== $entry['title'] ) {
				$label = $entry['title'];
			} else {
				$label = sprintf( /* translators: %d: animation slot */ __( 'Animation %d', 'uichemy' ), $n );
			}
			$slots[ $n ] = array(
				'label' => $label,
				'value' => $val,
			);
		}
		if ( empty( $slots ) ) {
			return array();
		}
		ksort( $slots, SORT_NUMERIC );
		return $slots;
	}

	/**
	 * Build TPGB animRep array from globals.json metadata.animations.
	 *
	 * Each entry in metadata.animations is an animation configuration object consumed by the
	 * GSAP runtime (via data-nxt-gsap-scroll) and stored in tpgb_global_options.presets[active].animRep.
	 * The WDesignKit-internal `_key` field is stripped before storing.
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array Sequential list of animation config objects.
	 */
	protected function build_tpgb_animrep_from_globals( array $globals ) {
		$source = array();
		if ( ! empty( $globals['metadata']['animations'] ) && is_array( $globals['metadata']['animations'] ) ) {
			$source = $globals['metadata']['animations'];
		} elseif ( ! empty( $globals['animRep'] ) && is_array( $globals['animRep'] ) ) {
			// Some export formats may place animRep at the root level.
			return array_values( $globals['animRep'] );
		}
		if ( empty( $source ) ) {
			return array();
		}
		$out = array();
		foreach ( $source as $key => $anim ) {
			if ( is_object( $anim ) ) {
				$anim = json_decode( wp_json_encode( $anim ), true );
			}
			if ( ! is_array( $anim ) ) {
				continue;
			}
			// Ensure animName is set (may come from the map key when missing inside the object).
			if ( empty( $anim['animName'] ) ) {
				if ( is_string( $key ) && '' !== $key ) {
					$anim['animName'] = $key;
				} else {
					continue;
				}
			}
			unset( $anim['_key'] ); // WDesignKit internal — not used by TPGB.
			$out[] = $anim;
		}
		return $out;
	}

	/**
	 * Merge existing animRep entries with incoming ones, deduplicating by animName (import wins).
	 *
	 * @param array $existing Current animRep entries from the active preset.
	 * @param array $incoming Entries built from globals.json.
	 * @return array Merged sequential list.
	 */
	protected function merge_tpgb_animrep( array $existing, array $incoming ) {
		$by_name = array();
		foreach ( $existing as $anim ) {
			if ( ! empty( $anim['animName'] ) ) {
				$by_name[ $anim['animName'] ] = $anim;
			}
		}
		foreach ( $incoming as $anim ) {
			if ( ! empty( $anim['animName'] ) ) {
				$by_name[ $anim['animName'] ] = $anim;
			}
		}
		return array_values( $by_name );
	}

	/**
	 * Scan all downloaded files for wp:tpgb/tp-button-core block comments and extract the mapping
	 * of internal TPGB preset key → CSS slug (e.g. 'btnpreset1' => 'primary-button').
	 *
	 * Page content stores both selectedButtonPreset (the DB key, e.g. "btnpreset1") and the CSS
	 * variable references (e.g. "--tpgb-btnpreset-primary-button-btColor") in the same block
	 * comment, so we can derive the key→slug relationship without any external information.
	 *
	 * @param array $files Map of filename => decoded file (Gutenberg files have _uich_webpage_gutenberg + markup keys).
	 * @return array Map of internal key => CSS slug (e.g. ['btnpreset1' => 'primary-button']).
	 */
	protected function extract_button_preset_slug_map( array $files ) {
		$map = array();
		foreach ( $files as $content ) {
			// Gutenberg page files are stored as { _uich_webpage_gutenberg: true, markup: '...' }
			$markup = '';
			if ( is_array( $content ) && ! empty( $content['_uich_webpage_gutenberg'] ) && is_string( $content['markup'] ?? null ) ) {
				$markup = $content['markup'];
			} elseif ( is_string( $content ) ) {
				$markup = $content;
			}
			if ( '' === $markup ) {
				continue;
			}

			// Extract each wp:tpgb/tp-button-core opening block comment's JSON attributes.
			if ( ! preg_match_all( '/<!-- wp:tpgb\/tp-button-core (\{.*?\}) -->/s', $markup, $matches ) ) {
				continue;
			}

			foreach ( $matches[1] as $json_str ) {
				$attrs = json_decode( $json_str, true );
				if ( ! is_array( $attrs )
					|| empty( $attrs['useGlobalButtonSettings'] )
					|| empty( $attrs['selectedButtonPreset'] )
					|| ! is_string( $attrs['selectedButtonPreset'] ) ) {
					continue;
				}
				$internal_key = $attrs['selectedButtonPreset'];
				if ( isset( $map[ $internal_key ] ) ) {
					continue; // already resolved
				}

				// Derive slug from any CSS var reference in the block attributes.
				// After json_decode, - sequences become '-' so the CSS var names are plain.
				$attrs_json = json_encode( $attrs );
				if ( preg_match(
					'/--tpgb-btnpreset-([a-z][a-z0-9-]*)-(?:bTypo|btColor|bthColor|btBg|bthBg|bBord|bthBColor|brad|btPad|btshadow|bthShadow|tShadow)/',
					$attrs_json,
					$slug_match
				) ) {
					$map[ $internal_key ] = $slug_match[1];
				}
			}
		}
		return $map;
	}

	/**
	 * Build a CSS-slug → internal-key reverse map from button presets already stored in the DB.
	 *
	 * Used in apply_globals_to_tpgb_block_editor() to re-use existing internal keys (e.g. "btnpreset1")
	 * when the import writes new preset data. This prevents a key mismatch where on-site Gutenberg
	 * button blocks reference "btnpreset1" via selectedButtonPreset but the freshly-imported preset
	 * is stored under its CSS slug ("primary-button"), causing the preset lookup to fail and requiring
	 * a manual reselect in the editor.
	 *
	 * The slug is derived the same way preset_class_slug() (tp-button-preset-vars.php) does:
	 *   strtolower(name) → non-alphanumeric → '-' → trim '-'
	 * which matches the slug segment embedded in metadata.btnpreset CSS variable names.
	 *
	 * @return array Map of css_slug => internal_key (e.g. ['primary-button' => 'btnpreset1']).
	 */
	protected function scan_existing_button_preset_key_map() {
		$raw = get_option( 'tpgb_global_options', false );
		$dec = $this->decode_tpgb_global_options_value( $raw );

		$button_presets = array();
		// Primary: presets[active].buttonPresets.
		if ( is_array( $dec ) && isset( $dec['active'] ) && isset( $dec['presets'][ $dec['active'] ] ) ) {
			$active = $dec['presets'][ $dec['active'] ];
			if ( ! empty( $active['buttonPresets'] ) && is_array( $active['buttonPresets'] ) ) {
				$button_presets = $active['buttonPresets'];
			}
		}
		// Fallback: flat top-level buttonPresets (legacy).
		if ( empty( $button_presets ) && ! empty( $dec['buttonPresets'] ) && is_array( $dec['buttonPresets'] ) ) {
			$button_presets = $dec['buttonPresets'];
		}

		if ( empty( $button_presets ) ) {
			return array();
		}

		$map = array();
		foreach ( $button_presets as $internal_key => $preset ) {
			if ( ! is_string( $internal_key ) || '' === $internal_key ) {
				continue;
			}
			if ( is_object( $preset ) ) {
				$preset = json_decode( wp_json_encode( $preset ), true );
			}
			$name = ( is_array( $preset ) && isset( $preset['name'] ) && is_string( $preset['name'] ) ) ? $preset['name'] : '';
			if ( '' === $name ) {
				continue;
			}
			// Mirror preset_class_slug() slug logic (without the 'btnpreset-' prefix).
			$slug = strtolower( trim( $name ) );
			$slug = preg_replace( '/[^a-z0-9]+/', '-', $slug );
			$slug = trim( (string) $slug, '-' );
			if ( '' === $slug ) {
				continue;
			}
			// First key found for a given slug wins (preserves existing ordering).
			if ( ! isset( $map[ $slug ] ) ) {
				$map[ $slug ] = $internal_key;
			}
		}
		return $map;
	}

	/**
	 * Reconstruct TPGB buttonPresets map from globals.json metadata.btnpreset flat CSS variables.
	 *
	 * metadata.btnpreset stores pre-computed CSS variable values keyed as:
	 *   tpgb-btnpreset-{slug}-{attrKey}[-{sub}]
	 *
	 * This method reverses the naming to produce structured preset objects compatible with
	 * tpgb_global_options.presets[active].buttonPresets. When $btn_key_map is provided (slug→key pairs
	 * extracted from page content), presets are stored under the original internal key so that
	 * selectedButtonPreset references in blocks match the DB entry and the editor shows them as selected.
	 *
	 * @param array $globals     Decoded globals.json.
	 * @param array $btn_key_map Map of internal key → CSS slug extracted from page content (e.g. ['btnpreset1' => 'primary-button']).
	 * @return array Map of key => preset object.
	 */
	protected function build_tpgb_button_presets_from_globals( array $globals, array $btn_key_map = array() ) {
		if ( empty( $globals['metadata']['btnpreset'] ) || ! is_array( $globals['metadata']['btnpreset'] ) ) {
			return array();
		}

		$known_attrs = array( 'bTypo', 'btColor', 'bthColor', 'btBg', 'bthBg', 'bBord', 'bthBColor', 'brad', 'btPad', 'btshadow', 'bthShadow', 'tShadow' );
		$prefix      = 'tpgb-btnpreset-';
		$by_slug     = array();

		foreach ( $globals['metadata']['btnpreset'] as $css_var_key => $val ) {
			if ( ! is_string( $css_var_key ) || 0 !== strpos( $css_var_key, $prefix ) ) {
				continue;
			}
			$rest  = substr( $css_var_key, strlen( $prefix ) );
			$parts = explode( '-', $rest );
			$count = count( $parts );

			// Scan forward to find where a known attribute key begins.
			$attr_start = -1;
			for ( $i = 1; $i < $count; $i++ ) {
				$candidate = implode( '-', array_slice( $parts, $i ) );
				foreach ( $known_attrs as $known ) {
					if ( $candidate === $known || 0 === strpos( $candidate, $known . '-' ) ) {
						$attr_start = $i;
						break 2;
					}
				}
			}
			if ( $attr_start < 0 ) {
				continue;
			}

			$slug      = implode( '-', array_slice( $parts, 0, $attr_start ) );
			$attr_rest = implode( '-', array_slice( $parts, $attr_start ) );
			if ( '' === $slug ) {
				continue;
			}

			// Determine attribute key and optional sub-field.
			$attr = '';
			$sub  = '';
			foreach ( $known_attrs as $known ) {
				if ( $attr_rest === $known ) {
					$attr = $known;
					$sub  = '';
					break;
				}
				if ( 0 === strpos( $attr_rest, $known . '-' ) ) {
					$attr = $known;
					$sub  = substr( $attr_rest, strlen( $known ) + 1 );
					break;
				}
			}
			if ( '' === $attr ) {
				continue;
			}

			if ( ! isset( $by_slug[ $slug ] ) ) {
				$by_slug[ $slug ] = array();
			}
			$by_slug[ $slug ][] = array(
				'attr' => $attr,
				'sub'  => $sub,
				'val'  => $val,
			);
		}

		if ( empty( $by_slug ) ) {
			return array();
		}

		// Build reverse map: CSS slug → internal TPGB key (e.g. 'primary-button' → 'btnpreset1').
		// $btn_key_map is keyed by internal key; flip it for O(1) lookup by slug.
		$slug_to_key = array();
		foreach ( $btn_key_map as $internal_key => $slug ) {
			if ( is_string( $internal_key ) && is_string( $slug ) && '' !== $slug ) {
				$slug_to_key[ $slug ] = $internal_key;
			}
		}

		$presets = array();
		foreach ( $by_slug as $slug => $entries ) {
			$name   = ucwords( str_replace( '-', ' ', $slug ) );
			$preset = array( 'name' => $name );

			foreach ( $entries as $e ) {
				$attr = $e['attr'];
				$sub  = $e['sub'];
				$val  = $e['val'];

				switch ( $attr ) {
					case 'btColor':
					case 'bthColor':
					case 'bthBColor':
						$preset[ $attr ] = $val;
						break;

					case 'bTypo':
						if ( ! isset( $preset['bTypo'] ) ) {
							$preset['bTypo'] = array( 'openTypography' => 1 );
						}
						$this->apply_tpgb_btnpreset_typo_sub( $preset['bTypo'], $sub, $val );
						break;

					case 'btBg':
					case 'bthBg':
						if ( ! isset( $preset[ $attr ] ) ) {
							$preset[ $attr ] = array( 'openBg' => 1, 'bgType' => 'color' );
						}
						if ( 'color' === $sub ) {
							$preset[ $attr ]['bgDefaultColor'] = $val;
						} elseif ( 'image' === $sub ) {
							$preset[ $attr ]['bgGradient'] = $val;
							$preset[ $attr ]['bgType']     = 'gradient';
						}
						break;

					case 'bBord':
						if ( ! isset( $preset['bBord'] ) ) {
							$preset['bBord'] = array( 'openBorder' => 1 );
						}
						if ( 'style' === $sub ) {
							// var(--tpgb-BRT{N}) → globalBorder reference instead of inline type.
							// Stored as STRING (not int) to match the type WDesignKit writes in
							// block attrs (e.g. block.bBord.globalBorder = "6"). The editor's
							// preset-selection logic does strict-equality comparison between the
							// block attr and the preset value — a type mismatch (int vs string)
							// causes the preset chip to be detected as "drifted" and not selected.
							if ( preg_match( '/^var\(--tpgb-BRT(\d+)\)$/', $val, $m ) ) {
								$preset['bBord']['globalBorder'] = $m[1];
							} else {
								$preset['bBord']['type'] = $val;
							}
						} elseif ( 'color' === $sub ) {
							$preset['bBord']['color'] = $val;
						} elseif ( 'width' === $sub ) {
							// var(--tpgb-BRW{N}) → globalBorder reference; skip shorthand parse.
							if ( preg_match( '/^var\(--tpgb-BRW(\d+)\)$/', $val, $m ) ) {
								$preset['bBord']['globalBorder'] = $m[1];
							} else {
								$preset['bBord']['width'] = $this->parse_tpgb_border_width_shorthand( $val );
							}
						}
						break;

					case 'btshadow':
					case 'bthShadow':
					case 'tShadow':
						// Only handle the top-level (no sub-field) value.
						// Sub-field component vars (h, v, blur, spread, color) are
						// emitted as CSS custom properties separately and don't need
						// to be stored in the preset data object.
						if ( '' === $sub ) {
							if ( preg_match( '/^var\(--tpgb-BS(\d+)\)$/i', $val, $m ) ) {
								// Global shadow reference: e.g. var(--tpgb-BS1) → {openShadow:1, globalShadow:"1"}.
								// Stored as STRING to match WDesignKit's block-attr format
								// (block.btshadow.globalShadow = "1"). Editor's preset-selection
								// logic compares block↔preset by strict equality — int "1" !== string "1"
								// causes the preset chip to NOT show as selected for buttons that
								// declare a btshadow/bthShadow/tShadow in their stored attrs.
								$preset[ $attr ] = array(
									'openShadow'   => 1,
									'globalShadow' => $m[1],
								);
							}
							// 'initial' or any non-var value → leave unset (no shadow applied).
						}
						break;

					case 'brad':
					case 'btPad':
						if ( ! isset( $preset[ $attr ] ) ) {
							$preset[ $attr ] = array( 'md' => array(), 'unit' => 'px' );
						}
						if ( '' === $sub && 'brad' === $attr ) {
							// Global radius ref: var(--tpgb-RAD{N}, fallback).
							// Stored as STRING — same rationale as globalBorder/globalShadow above.
							if ( preg_match( '/^var\(--tpgb-RAD(\d+)(?:,\s*([^)]+))?\)$/', $val, $m ) ) {
								$preset['brad']['globalBorderRadius'] = $m[1];
								if ( ! empty( $m[2] ) ) {
									$preset['brad']['globalBorderRadiusFallback'] = trim( $m[2] );
								}
							}
						} elseif ( in_array( $sub, array( 'top', 'right', 'bottom', 'left' ), true ) ) {
							// Strip trailing unit (e.g. "6px" → "6").
							$preset[ $attr ]['md'][ $sub ] = preg_replace( '/[a-z%]+$/i', '', $val );
						} elseif ( preg_match( '/^(top|right|bottom|left)-(md|sm|xs)$/', $sub, $dm ) ) {
							// Device-specific side: e.g. btPad-top-md → btPad.md.top.
							$device_key = $dm[2];
							if ( ! isset( $preset[ $attr ][ $device_key ] ) ) {
								$preset[ $attr ][ $device_key ] = array();
							}
							$preset[ $attr ][ $device_key ][ $dm[1] ] = preg_replace( '/[a-z%]+$/i', '', $val );
						}
						break;
				}
			}
			// Use the original internal key when available so selectedButtonPreset in blocks matches.
			$store_key          = isset( $slug_to_key[ $slug ] ) ? $slug_to_key[ $slug ] : $slug;
			$presets[ $store_key ] = $preset;
		}

		return $presets;
	}

	/**
	 * Apply one typography sub-field from metadata.btnpreset into a bTypo preset object.
	 *
	 * @param array  $typo Typography preset object (modified in place).
	 * @param string $sub  Sub-field name (family, weight, style, size, height, spacing, transform, decoration).
	 * @param string $val  Raw CSS value.
	 */
	protected function apply_tpgb_btnpreset_typo_sub( array &$typo, $sub, $val ) {
		// Detect global typography reference: var(--tpgb-T{N}-{prop}).
		// Store the token ID in globalTypo and skip individual field assignment so
		// the CSS emitter chains through to the site-wide --tpgb-T{N}-* variables.
		if ( is_string( $val ) && preg_match( '/^var\(--tpgb-T(\d+)-/', $val, $m ) ) {
			$typo['globalTypo'] = (int) $m[1];
			return;
		}
		switch ( $sub ) {
			case 'family':
				if ( ! isset( $typo['fontFamily'] ) ) {
					$typo['fontFamily'] = array();
				}
				$typo['fontFamily']['family'] = trim( (string) $val, "' \"" );
				break;
			case 'weight':
				if ( ! isset( $typo['fontFamily'] ) ) {
					$typo['fontFamily'] = array();
				}
				$typo['fontFamily']['fontWeight'] = (int) $val;
				break;
			case 'style':
				if ( ! isset( $typo['fontFamily'] ) ) {
					$typo['fontFamily'] = array();
				}
				$typo['fontFamily']['fontStyle'] = $val;
				break;
			case 'size':
				$p            = $this->parse_tpgb_css_length( $val, '14', 'px' );
				$typo['size'] = array( 'md' => $p['num'], 'unit' => $p['unit'] );
				break;
			case 'height':
				$p              = $this->parse_tpgb_css_length( $val, '20', 'px' );
				$typo['height'] = array( 'md' => $p['num'], 'unit' => $p['unit'] );
				break;
			case 'spacing':
				$p               = $this->parse_tpgb_css_length( $val, '0', 'px' );
				$typo['spacing'] = array( 'md' => $p['num'], 'unit' => $p['unit'] );
				break;
			case 'transform':
				$typo['textTransform'] = $val;
				break;
			case 'decoration':
				$typo['textDecoration'] = $val;
				break;
		}
	}

	/**
	 * Parse a CSS border-width shorthand string ("1px 1px 1px 1px") into a TPGB dimension object.
	 *
	 * @param string $val Shorthand border-width value.
	 * @return array{ md: array{ top: string, right: string, bottom: string, left: string }, unit: string }
	 */
	protected function parse_tpgb_border_width_shorthand( $val ) {
		$raw_parts = preg_split( '/\s+/', trim( (string) $val ) );
		$unit      = 'px';
		$nums      = array();
		foreach ( $raw_parts as $p ) {
			if ( preg_match( '/^([\d.]+)([a-z%]*)$/i', $p, $m ) ) {
				$nums[] = $m[1];
				if ( '' !== $m[2] ) {
					$unit = strtolower( $m[2] );
				}
			}
		}
		$top    = isset( $nums[0] ) ? $nums[0] : '0';
		$right  = isset( $nums[1] ) ? $nums[1] : $top;
		$bottom = isset( $nums[2] ) ? $nums[2] : $top;
		$left   = isset( $nums[3] ) ? $nums[3] : $right;
		return array(
			'md'   => array(
				'top'    => $top,
				'right'  => $right,
				'bottom' => $bottom,
				'left'   => $left,
			),
			'unit' => $unit,
		);
	}

	/**
	 * Normalize box-shadow object for TPG preset (openShadow 1/0, inset numeric).
	 *
	 * @param array $val Raw shadow from globals.json.
	 * @return array
	 */
	protected function normalize_tpgb_box_shadow_value_for_preset( array $val ) {
		$out = $val;
		if ( isset( $out['openShadow'] ) ) {
			$out['openShadow'] = ! empty( $out['openShadow'] ) ? 1 : 0;
		}
		if ( array_key_exists( 'inset', $out ) && ( '' === $out['inset'] || null === $out['inset'] ) ) {
			$out['inset'] = 0;
		}
		return $out;
	}

	/**
	 * Normalize border object for TPG preset (openBorder 1/0).
	 *
	 * @param array $val Raw border from globals.json.
	 * @return array
	 */
	protected function normalize_tpgb_border_value_for_preset( array $val ) {
		$out = $val;
		if ( isset( $out['openBorder'] ) ) {
			$out['openBorder'] = ! empty( $out['openBorder'] ) ? 1 : 0;
		}
		return $out;
	}

	/**
	 * Convert globals.json typography object (flat CSS-like keys) to TPG preset row.
	 *
	 * @param array $flat Typography fields (name, font-size, font-family, ...).
	 * @return array{ label: string, value: array }
	 */
	protected function convert_flat_tpgb_typography_to_preset_entry( array $flat ) {
		$label = '';
		if ( isset( $flat['name'] ) && is_string( $flat['name'] ) && '' !== $flat['name'] ) {
			$label = $flat['name'];
		} elseif ( isset( $flat['title'] ) && is_string( $flat['title'] ) && '' !== $flat['title'] ) {
			$label = $flat['title'];
		} else {
			$label = __( 'Typography', 'uichemy' );
		}

		$size   = $this->parse_tpgb_css_length( isset( $flat['font-size'] ) ? (string) $flat['font-size'] : '16px', '16', 'px' );
		$height = $this->parse_tpgb_css_length( isset( $flat['line-height'] ) ? (string) $flat['line-height'] : '24px', '24', 'px', true );

		$size_arr = array( 'md' => $size['num'], 'unit' => $size['unit'] );
		foreach ( array( 'sm', 'xs' ) as $bp ) {
			$raw_key = 'font-size-' . $bp;
			if ( isset( $flat[ $raw_key ] ) && '' !== trim( (string) $flat[ $raw_key ] ) ) {
				$p                 = $this->parse_tpgb_css_length( (string) $flat[ $raw_key ], '16', 'px' );
				$size_arr[ $bp ]   = $p['num'];
			}
		}

		$height_arr = array( 'md' => $height['num'], 'unit' => $height['unit'] );
		foreach ( array( 'sm', 'xs' ) as $bp ) {
			$raw_key = 'line-height-' . $bp;
			if ( isset( $flat[ $raw_key ] ) && '' !== trim( (string) $flat[ $raw_key ] ) ) {
				$p                   = $this->parse_tpgb_css_length( (string) $flat[ $raw_key ], '24', 'px', true );
				$height_arr[ $bp ]   = $p['num'];
			}
		}

		$ff_raw = isset( $flat['font-family'] ) ? (string) $flat['font-family'] : 'sans-serif';
		$ff     = $this->parse_tpgb_font_family_string( $ff_raw );

		$weight = 400;
		if ( isset( $flat['font-weight'] ) ) {
			$weight = (int) preg_replace( '/\D+/', '', (string) $flat['font-weight'] );
		}
		if ( 1 > $weight ) {
			$weight = 400;
		}

		$spacing = $this->parse_tpgb_css_length( isset( $flat['letter-spacing'] ) ? (string) $flat['letter-spacing'] : '0px', '0', 'px' );

		$value = array(
			'openTypography' => 1,
			'size'           => $size_arr,
			'height'         => $height_arr,
			'fontFamily'     => array(
				'family'     => $ff['family'],
				'type'       => $ff['type'],
				'fontWeight' => $weight,
			),
			'spacing'        => array(
				'md'   => $spacing['num'],
				'unit' => $spacing['unit'],
			),
		);

		if ( isset( $flat['font-style'] ) && is_string( $flat['font-style'] ) && '' !== $flat['font-style'] ) {
			$value['fontStyle'] = $flat['font-style'];
		}
		if ( isset( $flat['text-transform'] ) && is_string( $flat['text-transform'] ) ) {
			$value['textTransform'] = $flat['text-transform'];
		}
		if ( isset( $flat['text-decoration'] ) && is_string( $flat['text-decoration'] ) ) {
			$value['textDecoration'] = $flat['text-decoration'];
		}

		return array(
			'label' => $label,
			'value' => $value,
		);
	}

	/**
	 * Parse "16px", "1.3em", "72px" into numeric + unit for TPG typography preset.
	 *
	 * @param string $raw Raw CSS value.
	 * @param string $default_num Default if parse fails.
	 * @param string $default_unit Default unit.
	 * @param bool   $allow_plain_number Treat unitless as em for line-height.
	 * @return array{ num: float|int, unit: string }
	 */
	protected function parse_tpgb_css_length( $raw, $default_num = '0', $default_unit = 'px', $allow_plain_number = false ) {
		$raw = trim( (string) $raw );
		if ( '' === $raw ) {
			return array(
				'num'  => (float) $default_num,
				'unit' => $default_unit,
			);
		}
		if ( preg_match( '/^([\d.]+)\s*(px|em|rem|%)?$/i', $raw, $m ) ) {
			$num  = (float) $m[1];
			$unit = isset( $m[2] ) && '' !== $m[2] ? strtolower( $m[2] ) : ( $allow_plain_number ? 'em' : $default_unit );
			return array(
				'num'  => $num,
				'unit' => $unit,
			);
		}
		if ( $allow_plain_number && is_numeric( $raw ) ) {
			return array(
				'num'  => (float) $raw,
				'unit' => 'em',
			);
		}
		return array(
			'num'  => (float) $default_num,
			'unit' => $default_unit,
		);
	}

	/**
	 * Parse "'Inter',sans-serif" into family + generic type.
	 *
	 * @param string $raw font-family CSS value.
	 * @return array{ family: string, type: string }
	 */
	protected function parse_tpgb_font_family_string( $raw ) {
		$raw = trim( (string) $raw );
		if ( '' === $raw ) {
			return array(
				'family' => 'inherit',
				'type'   => 'sans-serif',
			);
		}
		$first = $raw;
		if ( false !== strpos( $raw, ',' ) ) {
			$first = substr( $raw, 0, strpos( $raw, ',' ) );
		}
		$first = trim( $first, " \t\n\r\0\x0B\"'" );
		$type  = 'sans-serif';
		$lower = strtolower( $raw );
		if ( false !== strpos( $lower, 'serif' ) && false === strpos( $lower, 'sans' ) ) {
			$type = 'serif';
		} elseif ( false !== strpos( $lower, 'monospace' ) ) {
			$type = 'monospace';
		}
		return array(
			'family' => '' !== $first ? $first : 'inherit',
			'type'   => $type,
		);
	}

	/**
	 * Drop Elementor compiled CSS so the next front-end load regenerates from post meta.
	 *
	 * Imports update `_elementor_data` and kit `_elementor_page_settings` via `update_post_meta`,
	 * which bypasses Elementor's save flow. Without clearing files cache, a second import
	 * (e.g. light then dark) still serves the previous CSS from uploads/elementor/css.
	 *
	 * @return void
	 */
	protected function clear_elementor_files_cache() {
		if ( ! apply_filters( 'uich_webpage_clear_elementor_cache_after_import', true ) ) {
			return;
		}
		if ( ! did_action( 'elementor/loaded' ) ) {
			return;
		}
		if ( ! class_exists( '\Elementor\Plugin' ) ) {
			return;
		}
		$elementor = \Elementor\Plugin::instance();
		if ( ! is_object( $elementor ) || ! isset( $elementor->files_manager ) || ! is_object( $elementor->files_manager ) ) {
			return;
		}
		if ( method_exists( $elementor->files_manager, 'clear_cache' ) ) {
			$elementor->files_manager->clear_cache();
		}
	}

	/**
	 * Set Elementor Site Settings → Layout → Content Width on the active kit.
	 *
	 * Stored as kit `_elementor_page_settings['container_width']` (slider: size + unit).
	 *
	 * @param int    $size_px Content width in pixels.
	 * @param string $unit    CSS unit (default px).
	 * @return bool True if kit meta was updated, false if no active kit.
	 */
	protected function set_elementor_active_kit_content_width( $size_px = 1240, $unit = 'px' ) {
		$kit_id = get_option( 'elementor_active_kit' );
		if ( ! $kit_id || ! get_post( $kit_id ) ) {
			return false;
		}

		$settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
		if ( ! is_array( $settings ) ) {
			$settings = array();
		}

		$settings['container_width'] = array(
			'size' => (int) $size_px,
			'unit' => $unit,
		);

		$settings = $this->ensure_elementor_ids_are_strings( $settings );
		update_post_meta( $kit_id, '_elementor_page_settings', $settings );

		return true;
	}

	/**
	 * Merge a fresh batch of kit-managed global entries (colors, typography, Plus Addons
	 * presets) into an existing Elementor Kit settings list without growing on every
	 * re-import. Entries this plugin wrote on the previous import ($managed_ids, keyed by
	 * list name) are dropped before merging so a re-import replaces them cleanly; entries
	 * not in that list (added by hand in the Elementor editor) are left untouched. _id
	 * values are never renamed here — widgets can reference these presets by _id directly.
	 *
	 * @param array  $new_items    Freshly built entries for this import (each has an _id key).
	 * @param array  $existing     Existing list read from _elementor_page_settings.
	 * @param array  $managed_ids  Map of list name => _id values written by the previous import.
	 * @param string $list_name    Key into $managed_ids for this specific list.
	 * @param int    $limit        Max entries to keep (Elementor editor performance ceiling).
	 * @return array { list: array, ids: string[] } merged list and the _ids now managed.
	 */
	protected function merge_managed_global_list( array $new_items, array $existing, array $managed_ids, $list_name, $limit ) {
		$previously_managed = isset( $managed_ids[ $list_name ] ) && is_array( $managed_ids[ $list_name ] ) ? $managed_ids[ $list_name ] : array();
		$managed_lookup     = array_flip( array_map( 'strval', $previously_managed ) );

		$kept_existing = array();
		foreach ( $existing as $item ) {
			$uid = isset( $item['_id'] ) ? (string) $item['_id'] : '';
			if ( '' === $uid || isset( $managed_lookup[ $uid ] ) ) {
				continue; // Dropped: malformed, or written by this plugin on a previous import.
			}
			$kept_existing[] = $item;
		}

		// New items first so they win the dedupe below (matches prior WDesignKit-style behaviour).
		$merged = array_merge( $new_items, $kept_existing );
		$unique = array();
		foreach ( $merged as $item ) {
			$uid = isset( $item['_id'] ) ? (string) $item['_id'] : '';
			if ( '' !== $uid && ! isset( $unique[ $uid ] ) ) {
				$unique[ $uid ] = $item;
			}
		}

		$new_ids = array();
		foreach ( $new_items as $item ) {
			if ( isset( $item['_id'] ) ) {
				$new_ids[] = (string) $item['_id'];
			}
		}

		return array(
			'list' => array_values( array_slice( $unique, 0, $limit ) ),
			'ids'  => $new_ids,
		);
	}

	/**
	 * Apply globals (colors, typography, The Plus kit repeaters) to Elementor active kit.
	 *
	 * @param array $globals_data Decoded globals.json (may contain id=>hex map and/or requiredPlugins).
	 */
	/**
	 * Make sure Elementor has a valid active kit before the import writes to it.
	 *
	 * Sites arrive with the kit missing more often than you'd hope — demo hosts
	 * clean uploads and posts, users delete "Default Kit" from the template
	 * library not knowing what it is. On such a site everything downstream
	 * fails SILENTLY: apply_globals_to_elementor() and
	 * set_elementor_active_kit_content_width() both bail when the kit post is
	 * gone, so the import "succeeds" with no global colors, no typography and
	 * default container padding — and the broken result reads as an import bug
	 * (seen live on a tastewp site, 2026-08-25: body class `elementor-kit-`
	 * with no id, 10px phantom padding between every section for logged-in
	 * viewers).
	 *
	 * Creating the default kit is exactly what Elementor's own recovery does;
	 * on a healthy site this is a no-op.
	 *
	 * @return void
	 */
	protected function ensure_elementor_kit_exists() {
		if ( ! class_exists( '\\Elementor\\Plugin' ) ) {
			return;
		}
		$kit_id = (int) get_option( 'elementor_active_kit' );
		if ( $kit_id > 0 && get_post( $kit_id ) ) {
			return;
		}
		try {
			$kits = \Elementor\Plugin::$instance->kits_manager;
			$new_id = 0;
			if ( $kits && method_exists( $kits, 'create_default' ) ) {
				$new_id = (int) $kits->create_default();
			} elseif ( $kits && method_exists( $kits, 'create_default_kit' ) ) {
				$new_id = (int) $kits->create_default_kit();
			}
			if ( $new_id > 0 ) {
				update_option( 'elementor_active_kit', $new_id );
			}
		} catch ( \Throwable $e ) {
			// A kit we cannot rebuild reproduces the old silent-skip behaviour,
			// which is still a working import — just an unstyled kit. Record it
			// so the failure is at least visible in telemetry this time.
			$api = new Uich_Webpage_Api();
			$api->report_error(
				'IMPORT_KIT_REBUILD_FAILED',
				array(
					'message' => $e->getMessage(),
					'source'  => 'uichemy-webpage',
					'level'   => 'warning',
				)
			);
		}
	}

	protected function apply_globals_to_elementor( array $globals_data ) {
		$color_map      = $this->extract_global_colors_from_globals( $globals_data );
		$typo_map       = $this->extract_global_typography_from_globals( $globals_data );
		$btn_presets    = $this->extract_tp_global_button_style_list_from_globals( $globals_data );
		$dim_presets    = $this->extract_tp_global_dimensions_list_from_globals( $globals_data );
		$bs_presets     = $this->extract_tp_global_box_shadow_list_from_globals( $globals_data );
		$gsap_presets   = $this->extract_tp_global_gsap_list_from_globals( $globals_data );
		$scroll_presets = $this->extract_tp_global_scroll_animation_list_from_globals( $globals_data );
		if ( empty( $color_map ) && empty( $typo_map ) && empty( $btn_presets ) && empty( $dim_presets ) && empty( $bs_presets ) && empty( $gsap_presets ) && empty( $scroll_presets ) ) {
			return;
		}

		$kit_id = get_option( 'elementor_active_kit' );
		if ( ! $kit_id || ! get_post( $kit_id ) ) {
			return;
		}

		$settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
		if ( ! is_array( $settings ) ) {
			$settings = array();
		}

		// _id values this plugin wrote on the previous import, per list — used below so a
		// re-import (even of a different project) replaces what the UiChemy import wrote last time
		// instead of appending to it forever. Carried forward untouched for any list not
		// touched by this import (e.g. a kit with no button presets).
		$managed_ids     = get_option( self::OPTION_MANAGED_GLOBAL_IDS, array() );
		$managed_ids     = is_array( $managed_ids ) ? $managed_ids : array();
		$new_managed_ids = $managed_ids;

		// Apply global colors to custom_colors (leave existing system_colors intact).
		if ( ! empty( $color_map ) ) {
			$custom_colors = isset( $settings['custom_colors'] ) && is_array( $settings['custom_colors'] ) ? $settings['custom_colors'] : array();
			$new_colors    = array();
			foreach ( $color_map as $color_id => $entry ) {
				$color_id_str = (string) $color_id;
				$hex          = '';
				$title        = '';
				if ( is_array( $entry ) && isset( $entry['hex'] ) ) {
					$hex   = $entry['hex'];
					$title = isset( $entry['title'] ) && is_string( $entry['title'] ) && '' !== $entry['title']
						? $entry['title']
						: sprintf( 'Global %s', $color_id_str );
				} elseif ( is_string( $entry ) ) {
					// Legacy map: id => hex string only.
					$hex   = $entry;
					$title = sprintf( 'Global %s', $color_id_str );
				}
				if ( '' === $hex || ! preg_match( '/^#[0-9A-Fa-f]{3,8}$/', $hex ) ) {
					continue;
				}
				$new_colors[] = array(
					'_id'   => $color_id_str,
					'title' => $title,
					'color' => $hex,
				);
			}
			$result                           = $this->merge_managed_global_list( $new_colors, $custom_colors, $managed_ids, 'custom_colors', 50 );
			$settings['custom_colors']        = $result['list'];
			$new_managed_ids['custom_colors'] = $result['ids'];
		}

		// Apply global typography to custom_typography (leave existing system_typography intact).
		if ( ! empty( $typo_map ) ) {
			$custom_typography = isset( $settings['custom_typography'] ) && is_array( $settings['custom_typography'] ) ? $settings['custom_typography'] : array();
			$new_typography    = array();
			foreach ( $typo_map as $typo_id => $typo_item ) {
				$typo_id_str = (string) $typo_id;
				// Ensure minimum required fields.
				if ( empty( $typo_item['title'] ) ) {
					$typo_item['title'] = 'Global ' . $typo_id_str;
				}
				if ( empty( $typo_item['typography_typography'] ) ) {
					$typo_item['typography_typography'] = 'custom';
				}
				$typo_item['_id'] = $typo_id_str;

				$new_typography[] = $typo_item;
			}
			$result                               = $this->merge_managed_global_list( $new_typography, $custom_typography, $managed_ids, 'custom_typography', 50 );
			$settings['custom_typography']        = $result['list'];
			$new_managed_ids['custom_typography'] = $result['ids'];
		}

		// The Plus Addons: kit repeater settings (buttons, dimensions, shadows, GSAP scroll, scroll animation).
		// _id here is also referenced directly by widgets that pick a preset, so unlike colors/typography
		// above, these _ids are never renamed — only replaced wholesale via the same tracked-diff merge.
		$tp_repeater_limit = 100;
		$tp_lists          = array(
			'tp_global_button_style_list'    => $btn_presets,
			'tp_global_dimensions_list'      => $dim_presets,
			'tp_global_box_shadow_list'      => $bs_presets,
			'tp_global_gsap_list'            => $gsap_presets,
			'tp_global_scroll_animation_list' => $scroll_presets,
		);
		foreach ( $tp_lists as $settings_key => $new_rows ) {
			if ( empty( $new_rows ) ) {
				continue;
			}
			$existing                         = isset( $settings[ $settings_key ] ) && is_array( $settings[ $settings_key ] ) ? $settings[ $settings_key ] : array();
			$result                           = $this->merge_managed_global_list( $new_rows, $existing, $managed_ids, $settings_key, $tp_repeater_limit );
			$settings[ $settings_key ]        = $result['list'];
			$new_managed_ids[ $settings_key ] = $result['ids'];
		}

		update_option( self::OPTION_MANAGED_GLOBAL_IDS, $new_managed_ids, false );

		// Elementor expects id/_id as string; ensure all are strings (avoids "id invalid type: string").
		$settings = $this->ensure_elementor_ids_are_strings( $settings );

		update_post_meta( $kit_id, '_elementor_page_settings', $settings );
	}

	/**
	 * Recursively ensure all id and _id values in Elementor data are strings.
	 * Elementor expects id/_id as string; integer triggers "id invalid type: string" in Container.addRepeaterItem.
	 * Also fixes null settings and guards against malformed structures.
	 *
	 * @param mixed $data Elementor data (array, or scalar passed through).
	 * @return mixed Sanitized copy (array) or original if not array.
	 */
	protected function ensure_elementor_ids_are_strings( $data ) {
		if ( ! is_array( $data ) ) {
			return $data;
		}
		$out = array();
		foreach ( $data as $key => $value ) {
			if ( ( '_id' === $key || 'id' === $key ) && ! is_string( $value ) ) {
				$out[ $key ] = (string) $value;
			} elseif ( 'settings' === $key && ! is_array( $value ) ) {
				$out[ $key ] = array();
			} elseif ( is_array( $value ) ) {
				$out[ $key ] = $this->ensure_elementor_ids_are_strings( $value );
			} else {
				$out[ $key ] = $value;
			}
		}
		return $out;
	}

	/**
	 * Sort URL list so globals.json comes first.
	 *
	 * @param string[] $urls URLs.
	 * @return string[] Sorted copy.
	 */
	protected function sort_urls_globals_first( array $urls ) {
		$sorted = $urls;
		usort(
			$sorted,
			function ( $a, $b ) {
				$name_a = strtolower( $this->replacement_filename_from_url( $a ) );
				$name_b = strtolower( $this->replacement_filename_from_url( $b ) );
				if ( 'globals.json' === $name_a ) {
					return -1;
				}
				if ( 'globals.json' === $name_b ) {
					return 1;
				}
				return strcmp( $name_a, $name_b );
			}
		);
		return $sorted;
	}

	/**
	 * Get filename from URL (e.g. "Home.json" from "https://creator-api.uichemy.com/download/Home.json").
	 *
	 * @param string $url URL.
	 * @return string Filename or empty.
	 */
	protected function filename_from_url( $url ) {
		$path = wp_parse_url( $url, PHP_URL_PATH );
		return $path ? basename( $path ) : '';
	}

	/**
	 * Storage key for a download URL: same as basename for .json; .html/.htm map to matching .json stem.
	 *
	 * @param string $url Download URL.
	 * @return string Filename e.g. "Search Results Page.json".
	 */
	protected function replacement_filename_from_url( $url ) {
		$base = $this->filename_from_url( $url );
		if ( '' === $base ) {
			return 'page.json';
		}
		$lower = strtolower( $base );
		if ( substr( $lower, -5 ) === '.html' || substr( $lower, -4 ) === '.htm' ) {
			return pathinfo( $base, PATHINFO_FILENAME ) . '.json';
		}
		return $base;
	}

	/**
	 * Get stored globals (for use in page content).
	 *
	 * @return array|null Decoded globals or null.
	 */
	public static function get_stored_globals() {
		$raw = get_option( self::OPTION_GLOBALS, null );
		return is_array( $raw ) ? $raw : null;
	}

	/**
	 * Get stored UiChemy globals list (uichemy-globals.json -> metadata.uichemy_composer_site_custom_code).
	 *
	 * @return array|null List of uichemy global variable entries, or null.
	 */
	public static function get_stored_uichemy_globals() {
		$raw = get_option( self::OPTION_UICHEMY_GLOBALS, null );
		return is_array( $raw ) ? $raw : null;
	}

	/**
	 * Get stored replacement data by filename.
	 *
	 * @param string|null $filename Optional filename (e.g. 'Home.json'). If null, returns all.
	 * @return array|null Single file data or full files array or null.
	 */
	public static function get_stored_replacement_data( $filename = null ) {
		$data = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		if ( ! is_array( $data ) ) {
			return null;
		}
		if ( null === $filename ) {
			return $data;
		}
		return isset( $data[ $filename ] ) ? $data[ $filename ] : null;
	}

	/**
	 * Get last import meta.
	 *
	 * @return array|null
	 */
	public static function get_import_meta() {
		$meta = get_option( self::OPTION_IMPORT_META, null );
		return is_array( $meta ) ? $meta : null;
	}

	/**
	 * Get the persisted old→new template ID map built during the fetch phase.
	 *
	 * @return array<int, int> source_site_post_id => local_wp_post_id.
	 */
	protected function get_stored_template_id_map() {
		$map = get_option( self::OPTION_TEMPLATE_ID_MAP, array() );
		return is_array( $map ) ? $map : array();
	}

	/**
	 * Resolve Elementor assets: scan for remote image URLs, download into Media Library, replace URLs in content.
	 *
	 * @param array $content Elementor elements array.
	 * @return array Modified content with local attachment URLs and IDs.
	 */
	protected function resolve_elementor_assets( $content ) {
		$assets = $this->scan_elementor_assets( $content );
		if ( empty( $assets ) ) {
			return $content;
		}
		$map = $this->download_assets( $assets );
		return $this->replace_asset_urls( $content, $map );
	}

	/**
	 * Scan Elementor data for remote image URLs (stack-based traversal).
	 *
	 * @param array $data Elementor content or nested array.
	 * @return string[] List of unique remote image URLs.
	 */
	protected function scan_elementor_assets( $data ) {
		$assets = array();
		$stack  = array( $data );

		while ( $stack ) {
			$current = array_pop( $stack );
			if ( ! is_array( $current ) ) {
				continue;
			}
			foreach ( $current as $value ) {
				if ( is_string( $value ) && $this->is_remote_image( $value ) ) {
					$assets[ $value ] = $value;
				}
				if ( is_array( $value ) && isset( $value['url'] ) && $this->is_remote_image( $value['url'] ) ) {
					$assets[ $value['url'] ] = $value['url'];
				}
				if ( is_array( $value ) ) {
					$stack[] = $value;
				}
			}
		}

		return array_values( $assets );
	}

	/**
	 * Check if URL is a remote image (extension or known image CDN; excludes same-site URLs).
	 *
	 * @param string $url URL to check.
	 * @return bool
	 */
	protected function is_remote_image( $url ) {
		if ( ! is_string( $url ) || '' === $url ) {
			return false;
		}

		$host = wp_parse_url( $url, PHP_URL_HOST );
		$site = wp_parse_url( home_url(), PHP_URL_HOST );
		if ( ! $host || $host === $site ) {
			return false;
		}

		// Allow image extensions with optional query string.
		if ( preg_match( '/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i', $url ) ) {
			return true;
		}

		// Known image CDNs without file extension in URL.
		$image_hosts = array(
			'assets.lummi.ai',
			'images.unsplash.com',
			'cdn.dribbble.com',
		);
		foreach ( $image_hosts as $allowed ) {
			if ( strpos( $host, $allowed ) !== false ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Download a list of remote URLs into Media Library; returns map original_url => array( id, url ).
	 *
	 * @param string[] $assets List of remote image URLs.
	 * @return array Map of original URL => array( 'id' => int, 'url' => string ).
	 */
	protected function download_assets( $assets ) {
		// Pull every body down in parallel first; the loop below then runs at
		// disk/DB speed instead of one network round-trip per image.
		$this->prefetch_assets( $assets );

		$map = array();
		foreach ( $assets as $url ) {
			$new = $this->import_asset( $url );
			if ( $new ) {
				$map[ $url ] = $new;
			}
		}

		$this->cleanup_prefetched_assets();
		return $map;
	}

	/**
	 * Download many remote images IN PARALLEL into temp files for import_asset().
	 *
	 * The media queue is the import's single biggest cost: images were fetched
	 * one at a time (download_url, up to 30s each), so a 30-image project spent
	 * minutes doing serial network waits — long enough to cross shared hosts'
	 * hard worker-kill windows, which is what the stall/auto-retry machinery
	 * then has to paper over. Fetching the bodies concurrently removes most of
	 * that wall-clock without changing what gets imported: import_asset() still
	 * owns dedupe, sideload and meta exactly as before, it just finds the bytes
	 * already on disk.
	 *
	 * Deliberate scope limits:
	 * - URLs whose hash already has a live attachment are skipped here;
	 *   import_asset() will resolve them from the library without any network.
	 * - Every URL must pass wp_http_validate_url(). download_url() gets that
	 *   safety via wp_safe_remote_get(); going through Requests directly would
	 *   silently drop it otherwise.
	 * - Batches of a few at a time, not one giant burst — remote CDNs
	 *   rate-limit, and PHP holds each body in memory while writing it out.
	 * - Any failure just leaves the URL un-prefetched: the sequential fallback
	 *   in import_asset() retries it alone, so parallelism can only ever make
	 *   things faster, never break an import that used to work.
	 *
	 * @param string[] $urls Remote image URLs (any mix; non-importables are skipped).
	 * @return void
	 */
	protected function prefetch_assets( array $urls ) {
		if ( ! class_exists( '\\WpOrg\\Requests\\Requests' ) ) {
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';

		$queue = array();
		foreach ( array_unique( array_filter( $urls, 'is_string' ) ) as $url ) {
			if ( isset( $this->prefetched_assets[ $url ] ) || ! $this->is_remote_image( $url ) ) {
				continue;
			}
			if ( ! wp_http_validate_url( $url ) ) {
				continue;
			}
			$existing = get_posts(
				array(
					'post_type'   => 'attachment',
					'meta_key'    => '_uich_webpage_source',
					'meta_value'  => md5( $url ),
					'numberposts' => 1,
					'fields'      => 'ids',
				)
			);
			if ( ! empty( $existing ) && get_attached_file( $existing[0] ) && file_exists( get_attached_file( $existing[0] ) ) ) {
				continue;
			}
			$queue[] = $url;
		}
		if ( empty( $queue ) ) {
			return;
		}

		foreach ( array_chunk( $queue, 6 ) as $batch ) {
			$this->update_job_progress( array( 'phase' => 'media' ) );

			$requests = array();
			foreach ( $batch as $url ) {
				$requests[ $url ] = array( 'url' => $url, 'type' => 'GET' );
			}

			try {
				$responses = \WpOrg\Requests\Requests::request_multiple(
					$requests,
					array(
						'timeout'          => 30,
						'connect_timeout'  => 10,
						'follow_redirects' => true,
						'useragent'        => 'WordPress/' . get_bloginfo( 'version' ) . '; ' . home_url(),
					)
				);
			} catch ( \Throwable $e ) {
				continue; // whole batch falls back to sequential download_url().
			}

			foreach ( $responses as $url => $response ) {
				if ( ! ( $response instanceof \WpOrg\Requests\Response ) ) {
					continue; // an exception object — sequential fallback handles it.
				}
				if ( 200 !== (int) $response->status_code || '' === (string) $response->body ) {
					continue;
				}
				$tmp = wp_tempnam( $url );
				if ( ! $tmp ) {
					continue;
				}
				if ( false === file_put_contents( $tmp, $response->body ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- temp file in the uploads temp dir, same as download_url().
					wp_delete_file( $tmp );
					continue;
				}
				$this->prefetched_assets[ $url ] = $tmp;
			}
		}
	}

	/**
	 * Remove prefetched temp files nothing consumed (an import that skipped a
	 * URL after prefetch would otherwise leak its temp file until cron cleanup).
	 *
	 * @return void
	 */
	protected function cleanup_prefetched_assets() {
		foreach ( $this->prefetched_assets as $tmp ) {
			if ( is_string( $tmp ) && '' !== $tmp && file_exists( $tmp ) ) {
				wp_delete_file( $tmp );
			}
		}
		$this->prefetched_assets = array();
	}

	/**
	 * Import a single remote image into Media Library. Deduplicates by source URL hash (_uich_webpage_source meta).
	 *
	 * @param string $url Remote image URL.
	 * @return array|false Array( 'id' => int, 'url' => string ) or false on failure.
	 */
	protected function import_asset( $url ) {
		/*
		 * Every image the fetch phase pulls goes through here — templates, pages
		 * and blog posts alike — so this is the one place that keeps a job with a
		 * long media queue from looking dead. A per-template heartbeat is not
		 * enough on its own: download_url() below allows 30s per image, so a
		 * single image-heavy template can outlast JOB_STALL_SECONDS by itself.
		 *
		 * No current/total here (the caller owns the counter it is part way
		 * through); the client keeps the step it is on and just updates the copy.
		 */
		$this->update_job_progress( array( 'phase' => 'media' ) );

		$hash     = md5( $url );
		$existing = get_posts(
			array(
				'post_type'   => 'attachment',
				'meta_key'    => '_uich_webpage_source',
				'meta_value'  => $hash,
				'numberposts' => 1,
			)
		);

		if ( ! empty( $existing ) ) {
			$id            = $existing[0]->ID;
			$attached_file = get_attached_file( $id );

			// Verify the physical file exists before returning cached result.
			if ( $attached_file && file_exists( $attached_file ) ) {
				return array(
					'id'  => $id,
					'url' => wp_get_attachment_url( $id ),
				);
			}

			// File missing - delete orphaned attachment and re-download.
			wp_delete_attachment( $id, true );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		// Prefetched in parallel by prefetch_assets()? Consume that body instead
		// of re-downloading. Everything after this point (sideload, dedupe meta)
		// is identical either way.
		if ( isset( $this->prefetched_assets[ $url ] ) ) {
			$tmp = $this->prefetched_assets[ $url ];
			unset( $this->prefetched_assets[ $url ] );
			if ( ! is_string( $tmp ) || ! file_exists( $tmp ) ) {
				$tmp = download_url( $url, 30 );
			}
		} else {
			// Cap the timeout (default is 300s) so a single slow/unreachable image can't stall the
			// whole import for minutes.
			$tmp = download_url( $url, 30 );
		}
		if ( is_wp_error( $tmp ) ) {
			return false;
		}

		$path = wp_parse_url( $url, PHP_URL_PATH );
		$name = $path ? basename( $path ) : 'image';
		$name = sanitize_file_name( $name );
		if ( ! preg_match( '/\.(jpg|jpeg|png|gif|webp|svg)$/i', $name ) ) {
			$name .= '.png';
		}

		$file = array(
			'name'     => $name,
			'tmp_name' => $tmp,
		);

		$id = media_handle_sideload( $file, 0 );
		if ( is_wp_error( $id ) ) {
			wp_delete_file( $tmp );
			return false;
		}

		update_post_meta( $id, '_uich_webpage_source', $hash );

		return array(
			'id'  => $id,
			'url' => wp_get_attachment_url( $id ),
		);
	}

	/**
	 * Walk parsed blocks and download + localise every remote image referenced in block attributes.
	 *
	 * Covers TPGB blocks that store images purely in JSON attrs and never in innerHTML — e.g.
	 * tp-team-listing (TImage), tp-container (NormalBg.bgImage), tp-media-listing (Rimg), etc.
	 * Without this pass, serialize_blocks would write the remote URL and the remote site's
	 * attachment ID into the saved post_content; the block PHP renderer then looks up that ID
	 * locally, finds nothing, and renders an empty image placeholder.
	 *
	 * @param array $blocks Parsed block tree from parse_blocks().
	 * @return array Block tree with image attrs updated to local media-library values.
	 */
	protected function resolve_block_attr_images( array $blocks ) {
		$upload_check = wp_upload_dir();
		if ( ! empty( $upload_check['error'] ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'IMPORT_UPLOAD_DIR_BLOCK_IMAGES_ERROR', array( 'message' => $upload_check['error'], 'source' => 'uichemy-webpage', 'level' => 'warning', 'context' => array( 'plugin_version' => defined( 'UICH_WEBPAGE_VERSION' ) ? UICH_WEBPAGE_VERSION : '' ) ) );
		}

		foreach ( $blocks as &$block ) {
			if ( ! empty( $block['attrs'] ) && is_array( $block['attrs'] ) ) {
				// For tpgb/tp-image: capture the remote attachment ID before rewriting so we
				// can patch the innerHTML's wp-image-{id} class and src URL after the update.
				$old_timg_id = ( isset( $block['blockName'] ) && 'tpgb/tp-image' === $block['blockName']
					&& isset( $block['attrs']['tImg']['id'] )
					&& is_numeric( $block['attrs']['tImg']['id'] )
				) ? (int) $block['attrs']['tImg']['id'] : 0;

				$block['attrs'] = $this->rewrite_image_objects_in_data( $block['attrs'] );

				// DImgS defaults to true in block.json but may be omitted from stored attrs;
				// explicitly write it so the renderer's !empty($attrs['DImgS']) check is reliable.
				if ( isset( $block['blockName'] ) && 'tpgb/tp-team-listing' === $block['blockName'] ) {
					$img_size = isset( $block['attrs']['ImgSize'] ) ? $block['attrs']['ImgSize'] : '';
					if ( $img_size && 'full' !== $img_size && ! isset( $block['attrs']['DImgS'] ) ) {
						$block['attrs']['DImgS'] = true;
					}
				}

				if ( $old_timg_id > 0
					&& isset( $block['blockName'] ) && 'tpgb/tp-image' === $block['blockName']
					&& ! empty( $block['attrs']['tImg']['id'] )
				) {
					$new_id = (int) $block['attrs']['tImg']['id'];
					$isize  = isset( $block['attrs']['iSize'] ) ? $block['attrs']['iSize'] : 'full';
					$sizes  = isset( $block['attrs']['tImg']['sizes'] ) && is_array( $block['attrs']['tImg']['sizes'] )
						? $block['attrs']['tImg']['sizes']
						: array();

					if ( isset( $sizes[ $isize ]['url'] ) ) {
						$new_src = $sizes[ $isize ]['url'];
					} elseif ( isset( $sizes['full']['url'] ) ) {
						$new_src = $sizes['full']['url'];
					} else {
						$new_src = isset( $block['attrs']['tImg']['url'] ) ? $block['attrs']['tImg']['url'] : '';
					}

					if ( $new_src ) {
						$block = $this->rewrite_tp_image_html( $block, $old_timg_id, $new_id, $new_src );
					}
				}
			}
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->resolve_block_attr_images( $block['innerBlocks'] );
			}
		}
		unset( $block );
		return $blocks;
	}

	protected function rewrite_tp_image_html( array $block, int $old_id, int $new_id, string $new_src ) {
		$rewrite = function ( $html ) use ( $old_id, $new_id, $new_src ) {
			if ( ! is_string( $html ) || '' === $html ) {
				return $html;
			}
			if ( $old_id !== $new_id ) {
				$html = str_replace( 'wp-image-' . $old_id, 'wp-image-' . $new_id, $html );
			}
			$html = preg_replace_callback(
				'/(<img\b[^>]*?\bsrc=")[^"]*(")/is',
				function ( $m ) use ( $new_src ) {
					return $m[1] . esc_url( $new_src ) . $m[2];
				},
				$html
			);
			return $html;
		};

		$block['innerHTML'] = $rewrite( $block['innerHTML'] );
		if ( ! empty( $block['innerContent'] ) ) {
			foreach ( $block['innerContent'] as &$part ) {
				if ( is_string( $part ) ) {
					$part = $rewrite( $part );
				}
			}
			unset( $part );
		}
		return $block;
	}

	protected function rewrite_image_objects_in_data( $data ) {
		if ( ! is_array( $data ) ) {
			return $data;
		}

		// Detect a TPGB image object: string 'url' that is a remote image + an 'id' key.
		// id may be 0 for template placeholder images (e.g. tp-team-listing TImage) where
		// no real attachment ID was stored on the source site.
		if ( array_key_exists( 'url', $data )
			&& is_string( $data['url'] ) && '' !== $data['url']
			&& array_key_exists( 'id', $data )
			&& $this->is_remote_image( $data['url'] )
		) {
			$result = $this->import_asset( $data['url'] );
			if ( $result ) {
				$data['url'] = $result['url'];
				$data['id']  = $result['id'];
				// Fill size variants with real local URLs; add any registered sizes not yet present.
				if ( ! isset( $data['sizes'] ) || ! is_array( $data['sizes'] ) ) {
					$data['sizes'] = array();
				}
				foreach ( $data['sizes'] as $size_key => &$size ) {
					if ( is_array( $size ) && isset( $size['url'] ) ) {
						$src = wp_get_attachment_image_src( $result['id'], $size_key );
						$size['url'] = $src ? $src[0] : $result['url'];
						if ( $src ) {
							$size['width']  = $src[1];
							$size['height'] = $src[2];
						}
					}
				}
				unset( $size );
				$registered = function_exists( 'wp_get_registered_image_subsizes' )
					? wp_get_registered_image_subsizes()
					: array();
				foreach ( array_keys( $registered ) as $size_key ) {
					if ( isset( $data['sizes'][ $size_key ] ) ) {
						continue;
					}
					$src = wp_get_attachment_image_src( $result['id'], $size_key );
					if ( $src ) {
						$data['sizes'][ $size_key ] = array(
							'url'         => $src[0],
							'width'       => $src[1],
							'height'      => $src[2],
							'orientation' => $src[1] >= $src[2] ? 'landscape' : 'portrait',
						);
					}
				}
			}
			// This IS an image object — don't recurse further into it.
			return $data;
		}

		// Not an image object — recurse into every child value.
		foreach ( $data as &$value ) {
			$value = $this->rewrite_image_objects_in_data( $value );
		}
		unset( $value );
		return $data;
	}

	/**
	 * Resolve remote images in post content (Gutenberg block markup): scan for URLs, download, replace.
	 * Used for blog posts so inline/block images are downloaded like pages.
	 *
	 * @param string $content Post content (block markup or HTML).
	 * @return string Content with remote image URLs replaced by local attachment URLs.
	 */
	protected function resolve_post_content_images( $content ) {
		if ( ! is_string( $content ) || '' === $content ) {
			return $content;
		}
		$upload_check = wp_upload_dir();
		if ( ! empty( $upload_check['error'] ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'IMPORT_UPLOAD_DIR_CONTENT_IMAGES_ERROR', array( 'message' => $upload_check['error'], 'source' => 'uichemy-webpage', 'level' => 'warning', 'context' => array( 'plugin_version' => defined( 'UICH_WEBPAGE_VERSION' ) ? UICH_WEBPAGE_VERSION : '' ) ) );
		}

		$assets = $this->scan_markup_for_remote_images( $content );
		if ( empty( $assets ) ) {
			return $content;
		}
		$map = $this->download_assets( $assets );
		return $this->replace_urls_in_markup( $content, $map );
	}

	/**
	 * Scan block markup or HTML string for remote image URLs.
	 *
	 * @param string $markup Block markup or HTML.
	 * @return string[] List of unique remote image URLs.
	 */
	protected function scan_markup_for_remote_images( $markup ) {
		$assets = array();
		// serialize_blocks() JSON-encodes '&' as the 6-char sequence & inside
		// block comment attributes. Decode it before scanning so the regex captures
		// full query strings (e.g. ?auto=format&w=1500&h=1500) instead of stopping
		// at the backslash. chr(92) is backslash — used to avoid PHP escape processing.
		$json_amp    = chr( 92 ) . 'u0026';
		$scan_markup = str_replace( $json_amp, '&', $markup );
		// Match URLs in src, href, or JSON-like "url":"..." patterns.
		if ( preg_match_all( '#https?://[^\s"\'<>)\]\}\\\]+#', $scan_markup, $matches ) ) {
			foreach ( array_unique( $matches[0] ) as $url ) {
				// Remove trailing punctuation that regex may have captured.
				$url = rtrim( $url, '.,;:!?' );
				if ( $this->is_remote_image( $url ) ) {
					$assets[ $url ] = $url;
				}
			}
		}
		return array_values( $assets );
	}

	/**
	 * Replace remote image URLs in markup with local attachment URLs.
	 *
	 * @param string $markup Block markup or HTML.
	 * @param array  $map    Map of original URL => array( 'id' => int, 'url' => string ).
	 * @return string Modified markup.
	 */
	protected function replace_urls_in_markup( $markup, $map ) {
		$json_amp = chr( 92 ) . 'u0026'; // literal & as produced by serialize_blocks
		foreach ( $map as $original => $replacement ) {
			if ( isset( $replacement['url'] ) && is_string( $replacement['url'] ) ) {
				$markup = str_replace( $original, $replacement['url'], $markup );
				// serialize_blocks JSON-encodes & as & inside block comment attributes.
				// Replace that form too so block JSON attrs get the clean local URL.
				if ( strpos( $original, '&' ) !== false ) {
					$encoded_original = str_replace( '&', $json_amp, $original );
					$markup = str_replace( $encoded_original, $replacement['url'], $markup );
				}
			}
		}
		return $markup;
	}

	/**
	 * Recursively replace remote image URLs in Elementor data with local attachment id/url.
	 *
	 * @param array $data  Elementor content or nested array (passed by reference in recursion).
	 * @param array $map  Map of original URL => array( 'id' => int, 'url' => string ).
	 * @return array Modified data.
	 */
	protected function replace_asset_urls( $data, $map ) {
		if ( ! is_array( $data ) ) {
			return $data;
		}

		foreach ( $data as $key => &$value ) {
			if ( is_string( $value ) && isset( $map[ $value ] ) ) {
				$value = $map[ $value ]['url'];
			}
			if ( is_array( $value ) && isset( $value['url'] ) && isset( $map[ $value['url'] ] ) ) {
				$original_url = $value['url'];
				$value['url'] = $map[ $original_url ]['url'];
				$value['id']  = $map[ $original_url ]['id'];
			}
			if ( is_array( $value ) ) {
				$value = $this->replace_asset_urls( $value, $map );
			}
		}

		return $data;
	}

	/**
	 * REST callback: import a single page or Nexter template by pageName from stored replacement data.
	 * Mirrors wdesignkit's import_page_section_content() — creates one post at a time so the
	 * frontend can show per-item progress.
	 *
	 * @param WP_REST_Request $request Request with JSON body { pageName, type }.
	 * @return WP_REST_Response|WP_Error
	 */
	/**
	 * REST callback: enable TPAE widgets for all used widgets in stored replacement data.
	 *
	 * Called AFTER all pages are imported (Phase 3 complete) in a FRESH request,
	 * so TPAE is fully loaded and the tpae_enable_selected_widgets filter is registered.
	 * This mirrors how WDesignKit enables widgets via its wdkit_enable_template_widgets() AJAX handler.
	 *
	 * Body: { widget_list: string[], extensions_list?: string[] }
	 *       widget_list — array of Elementor widgetType slugs (e.g. ['tp-switcher', 'tp-button'])
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response
	 */
	public function rest_enable_widgets( WP_REST_Request $request ) {
		$params          = $request->get_json_params();
		$widget_list     = isset( $params['widget_list'] ) && is_array( $params['widget_list'] )
						? array_values( array_filter( array_map( 'sanitize_text_field', $params['widget_list'] ) ) )
						: array();
		$extensions_list = isset( $params['extensions_list'] ) && is_array( $params['extensions_list'] )
						? array_values( array_filter( array_map( 'sanitize_text_field', $params['extensions_list'] ) ) )
						: array();

		// If lists omitted or empty, scan stored replacement JSON (same rules as WDesignKit get_widget_list).
		$stored_files = array();
		if ( empty( $widget_list ) || empty( $extensions_list ) ) {
			$stored_files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		}
		if ( empty( $widget_list ) && ! empty( $stored_files ) && is_array( $stored_files ) ) {
			try {
				$widget_list = array_values( $this->collect_all_widgets_from_files( $stored_files ) );
			} catch ( \Throwable $e ) {
				$widget_list = array();
				$api = new Uich_Webpage_Api();
				$api->report_error( 'IMPORT_WIDGET_LIST_LOAD_FAILED', array( 'message' => $e->getMessage(), 'source' => 'uichemy-webpage', 'level' => 'warning', 'stack' => $e->getTraceAsString() ) );
			}
		}
		if ( empty( $extensions_list ) && ! empty( $stored_files ) && is_array( $stored_files ) ) {
			try {
				$extensions_list = array_values( $this->collect_all_tpae_extensions_from_files( $stored_files ) );
			} catch ( \Throwable $e ) {
				$extensions_list = array();
				$api = new Uich_Webpage_Api();
				$api->report_error( 'IMPORT_EXTENSION_LIST_LOAD_FAILED', array( 'message' => $e->getMessage(), 'source' => 'uichemy-webpage', 'level' => 'warning', 'stack' => $e->getTraceAsString() ) );
			}
		}

		if ( empty( $widget_list ) && empty( $extensions_list ) ) {
			return new WP_REST_Response(
				array(
					'success' => false,
					'message' => __( 'No widgets found.', 'uichemy' ),
				)
			);
		}

		if ( ! has_filter( 'tpae_enable_selected_widgets' ) ) {
			return new WP_REST_Response(
				array(
					'success' => false,
					'message' => __( 'The Plus Addons for Elementor is not active.', 'uichemy' ),
				)
			);
		}

		$w_list = array(
			'widgets'    => $widget_list,
			'extensions' => $extensions_list,
		);

		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Third-party (The Plus Addons) integration hook; the name is owned by that plugin and must not be prefixed.
		$result = apply_filters( 'tpae_enable_selected_widgets', $w_list );

		if ( ! empty( $result['success'] ) ) {
			return new WP_REST_Response(
				array(
					'success'    => true,
					'message'    => __( 'Widgets enabled successfully.', 'uichemy' ),
					'widgets'    => $widget_list,
					'extensions' => $extensions_list,
				)
			);
		}

		$api = new Uich_Webpage_Api();
		$api->report_error( 'IMPORT_WIDGET_LIST_LOAD_FAILED', array( 'message' => isset( $result['message'] ) ? $result['message'] : 'Failed to enable widgets.', 'source' => 'uichemy-webpage', 'level' => 'warning' ) );

		return new WP_REST_Response(
			array(
				'success'     => false,
				'message'     => isset( $result['message'] ) ? $result['message'] : __( 'Failed to enable widgets.', 'uichemy' ),
				'description' => isset( $result['description'] ) ? $result['description'] : '',
			)
		);
	}

	/**
	 * REST callback: enable Nexter / TPG Gutenberg blocks used in stored replacement data.
	 *
	 * Called after page import (finalize). Body: { block_list?: string[] } — block names like tpgb/tp-button.
	 * If block_list is omitted or empty, scans stored JSON the same way as enable_widgets_from_files().
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response
	 */
	public function rest_enable_blocks( WP_REST_Request $request ) {
		$params     = $request->get_json_params();
		$block_list = isset( $params['block_list'] ) && is_array( $params['block_list'] )
					? array_values( array_filter( array_map( 'sanitize_text_field', $params['block_list'] ) ) )
					: array();

		// Always load stored files so we can scan block attrs for extras detection.
		$stored_files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		$stored_files = is_array( $stored_files ) ? $stored_files : array();

		if ( empty( $block_list ) && ! empty( $stored_files ) ) {
			try {
				$block_list = array_values(
					array_unique(
						array_merge(
							$this->collect_all_blocks_from_files( $stored_files ),
							$this->collect_gutenberg_blocks_from_replacement_files( $stored_files )
						)
					)
				);
			} catch ( \Throwable $e ) {
				$block_list = array();
				$api = new Uich_Webpage_Api();
				$api->report_error( 'IMPORT_BLOCK_LIST_LOAD_FAILED', array( 'message' => $e->getMessage(), 'source' => 'uichemy-webpage', 'level' => 'warning', 'stack' => $e->getTraceAsString() ) );
			}
		}

		$result = $this->enable_nexter_blocks( $block_list );

		// Enable Gutenberg extras (tp-equal-height, tp-gsap-animation, etc.) from stored files.
		if ( ! empty( $stored_files ) ) {
			try {
				$extras = $this->collect_all_gutenberg_extras_from_files( $stored_files );
				if ( ! empty( $extras ) ) {
					$this->enable_gutenberg_extras( $extras );
				}
			} catch ( \Throwable $e ) {
				// Non-fatal — extras may already be enabled.
				$api = new Uich_Webpage_Api();
				$api->report_error( 'IMPORT_BLOCK_EXTRAS_FAILED', array( 'message' => $e->getMessage(), 'source' => 'uichemy-webpage', 'level' => 'info', 'stack' => $e->getTraceAsString() ) );
			}
		}

		if ( ! empty( $result['success'] ) ) {
			return new WP_REST_Response(
				array(
					'success' => true,
					'message' => isset( $result['message'] ) ? $result['message'] : __( 'Blocks enabled successfully.', 'uichemy' ),
					'blocks'  => $block_list,
				)
			);
		}

		$api = new Uich_Webpage_Api();
		$api->report_error( 'IMPORT_BLOCK_LIST_LOAD_FAILED', array( 'message' => isset( $result['message'] ) ? $result['message'] : 'Failed to enable blocks.', 'source' => 'uichemy-webpage', 'level' => 'warning' ) );

		return new WP_REST_Response(
			array(
				'success'     => false,
				'message'     => isset( $result['message'] ) ? $result['message'] : __( 'Failed to enable blocks.', 'uichemy' ),
				'description' => isset( $result['description'] ) ? $result['description'] : '',
			)
		);
	}

	/**
	 * REST callback: import one page (or navbar/footer/404/theme-template) from stored
	 * replacement data. Called once per page by the dashboard's per-page import loop.
	 *
	 * Runs as an async job (like /import-pages and project-replacement), not inline. A
	 * synchronous response here previously 504'd on real hosting: image-heavy pages
	 * trigger media_handle_sideload() -> wp_generate_attachment_metadata(), which
	 * regenerates every registered image size via Imagick and can easily take longer than
	 * a gateway's upstream-read timeout — confirmed live (504, nothing in debug.log, which
	 * is the signature of a reverse-proxy timeout, not a PHP fatal). Raising PHP's own
	 * max_execution_time (previously done here) doesn't help against that: the proxy gives
	 * up independently of whatever PHP is willing to run for. Returning 202 + jobId
	 * immediately and doing the real work after the response (via the shared
	 * create_import_job()/run_import_job() job runner) means the client gets its response
	 * long before any gateway timeout could fire, exactly like the other endpoints already
	 * protected this way.
	 *
	 * Body: { pageName: string, type?: string, el_type?, archive_rule?, hooks_action? }
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_import_single_page( WP_REST_Request $request ) {
		$params    = $request->get_json_params();
		$page_name = isset( $params['pageName'] ) ? sanitize_text_field( $params['pageName'] ) : '';

		if ( empty( $page_name ) ) {
			return new WP_Error( 'IMPORT_PAGE_MISSING_NAME', __( 'pageName is required.', 'uichemy' ), array( 'status' => 400 ) );
		}

		$files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		if ( empty( $files ) || ! is_array( $files ) ) {
			return new WP_Error( 'IMPORT_NO_STORED_DATA', __( 'No replacement data found. Run fetch-replacement-json first.', 'uichemy' ), array( 'status' => 400 ) );
		}

		$job_id = $this->create_import_job(
			'single_page',
			array(
				'pageName'     => $page_name,
				'type'         => isset( $params['type'] ) ? sanitize_text_field( $params['type'] ) : 'page',
				'el_type'      => isset( $params['el_type'] ) ? sanitize_text_field( $params['el_type'] ) : '',
				'archive_rule' => isset( $params['archive_rule'] ) ? sanitize_text_field( $params['archive_rule'] ) : '',
				'hooks_action' => isset( $params['hooks_action'] ) ? sanitize_text_field( $params['hooks_action'] ) : '',
			)
		);

		return new WP_REST_Response(
			array(
				'jobId'  => $job_id,
				'status' => 'pending',
			),
			202
		);
	}

	/**
	 * Execute a single_page import job. This is the actual work rest_import_single_page()
	 * used to do inline before returning a WP_REST_Response directly; now it returns a
	 * plain array (or WP_Error) for run_import_job() to store in the job transient.
	 *
	 * @param array $params { pageName, type, el_type, archive_rule, hooks_action } — already
	 *                       sanitized by rest_import_single_page() before the job was created.
	 * @return array|WP_Error
	 */
	protected function run_import_single_page_job( array $params ) {
		$page_name    = isset( $params['pageName'] ) ? $params['pageName'] : '';
		$type         = isset( $params['type'] ) ? $params['type'] : 'page';
		$el_type      = isset( $params['el_type'] ) ? $params['el_type'] : '';
		$archive_rule = isset( $params['archive_rule'] ) ? $params['archive_rule'] : '';
		$hooks_action = isset( $params['hooks_action'] ) ? $params['hooks_action'] : '';

		if ( '' === $page_name ) {
			return new WP_Error( 'IMPORT_PAGE_MISSING_NAME', __( 'pageName is required.', 'uichemy' ), array( 'status' => 400 ) );
		}

		$this->remove_hello_world_post();

		$files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		if ( empty( $files ) || ! is_array( $files ) ) {
			return new WP_Error( 'IMPORT_NO_STORED_DATA', __( 'No replacement data found. Run fetch-replacement-json first.', 'uichemy' ), array( 'status' => 400 ) );
		}

		// Handle navbar / footer — import as Theme Builder templates (UiChemy for Elementor, Nexter Extension for Gutenberg).
		if ( in_array( $type, array( 'navbar', 'footer' ), true ) ) {
			$fn    = $type . '.json';
			$found = $this->find_file_key( $files, $fn );
			if ( ! $found ) {
				return array(
					'success' => false,
					'message' => $fn . ' not found in stored data.',
				);
			}
			$section = ( 'navbar' === $type ) ? 'header' : 'footer';
			$post_id = $this->create_or_update_theme_builder_template( $page_name, $files[ $found ], '', '', $section, array() );
			if ( is_wp_error( $post_id ) ) {
				return new WP_Error( 'IMPORT_NAVBAR_FOOTER_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			$stored_id_map = $this->get_stored_template_id_map();
			if ( ! empty( $stored_id_map ) ) {
				$this->remap_template_ids_in_pages( array( array( 'post_id' => $post_id ) ), $stored_id_map );
			}
			// Enable widgets used in this template.
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $found ] );
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $page_name,
				'widgets_enable' => $widgets_result,
			);
		}

		// Handle 404 page — import as Nexter Theme Builder 404 template (nxt-hooks-layout-sections = 'page-404').
		if ( '404' === $type ) {
			$found = $this->find_file_key( $files, '404.json' );
			if ( ! $found ) {
				return array(
					'success' => false,
					'message' => '404.json not found in stored data.',
				);
			}
			$post_id = $this->create_or_update_theme_builder_template( $page_name, $files[ $found ], '', '', 'page-404', array() );
			if ( is_wp_error( $post_id ) ) {
				return new WP_Error( 'IMPORT_404_PAGE_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			// Disable header and footer on the 404 page (Nexter reads these metas in nexter-404-page-extra.php).
			update_post_meta( $post_id, 'nxt-404-disable-header', 'on' );
			update_post_meta( $post_id, 'nxt-404-disable-footer', 'on' );
			// Clear the generic 'standard-universal' display rule set by create_or_update_nexter_template —
			// 404 templates are identified purely by nxt-hooks-layout-sections = 'page-404', not by display rules.
			delete_post_meta( $post_id, 'nxt-add-display-rule' );
			$stored_id_map = $this->get_stored_template_id_map();
			if ( ! empty( $stored_id_map ) ) {
				$this->remap_template_ids_in_pages( array( array( 'post_id' => $post_id ) ), $stored_id_map );
			}
			// Enable widgets used in this template.
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $found ] );
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $page_name,
				'widgets_enable' => $widgets_result,
			);
		}

		// Handle theme builder templates (Blog Detail Page, Author Page, Search Results Page, Tag Featured Page, Category Page).
		if ( 'theme-template' === $type ) {
			$el_type      = '' !== $el_type ? $el_type : 'single';
			$filename     = $this->find_file_key( $files, $page_name . '.json' );
			if ( ! $filename ) {
				return array(
					'success' => false,
					'message' => $page_name . '.json not found in stored data.',
				);
			}
			$post_id = $this->create_or_update_theme_builder_template( $page_name, $files[ $filename ], $el_type, $archive_rule );
			if ( is_wp_error( $post_id ) ) {
				// A Pro-only type on a Free build is a skip, not a failure — the
				// caller shows it as skipped and carries on with the rest of the
				// import. Anything else is a real error.
				if ( 'IMPORT_UICHEMY_TMPL_PRO_ONLY' === $post_id->get_error_code() ) {
					return array(
						'success' => true,
						'skipped' => true,
						'reason'  => 'pro_only',
						'title'   => $page_name,
						'message' => $post_id->get_error_message(),
					);
				}
				return new WP_Error( 'IMPORT_THEME_TEMPLATE_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			$stored_id_map = $this->get_stored_template_id_map();
			if ( ! empty( $stored_id_map ) ) {
				$this->remap_template_ids_in_pages( array( array( 'post_id' => $post_id ) ), $stored_id_map );
			}
			// Enable widgets used in this theme template.
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $filename ] );
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $page_name,
				'widgets_enable' => $widgets_result,
			);
		}

		// Handle hooks templates (e.g. Cookie Policy) — imported as Nexter Theme Builder hooks sections.
		if ( 'hooks-template' === $type ) {
			$hooks_action = '' !== $hooks_action ? $hooks_action : 'nxt_footer_before';
			$filename     = $this->find_file_key( $files, $page_name . '.json' );
			if ( ! $filename ) {
				return array(
					'success' => false,
					'message' => $page_name . '.json not found in stored data.',
				);
			}
			/*
			 * A hooks template (the Cookie Policy banner is the only one today) is
			 * not a Theme Builder layout — it is content injected at a Nexter action
			 * such as nxt_footer_before. UiChemy has no equivalent type, so this is
			 * the one thing the import still needs Nexter Extension for, and Nexter
			 * is no longer installed by default.
			 *
			 * It is SKIPPED rather than failed. A failure here sets hadPageFailure in
			 * the UI, which stops the whole finalize phase — widget enabling, plugin,
			 * theme and Nexter settings — so one missing cookie banner would leave
			 * the rest of the import half-applied. Losing the banner is the far
			 * smaller loss.
			 */
			if ( ! post_type_exists( 'nxt_builder' ) ) {
				return array(
					'success' => true,
					'skipped' => true,
					'reason'  => 'requires_nexter',
					'title'   => $page_name,
					'message' => __( 'Skipped Cookie Policy. It needs Nexter Extension, which this import no longer installs.', 'uichemy' ),
				);
			}

			$post_id = $this->create_or_update_nexter_hooks_template( $page_name, $files[ $filename ], $hooks_action );
			if ( is_wp_error( $post_id ) ) {
				return new WP_Error( 'IMPORT_HOOKS_TEMPLATE_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			$stored_id_map = $this->get_stored_template_id_map();
			if ( ! empty( $stored_id_map ) ) {
				$this->remap_template_ids_in_pages( array( array( 'post_id' => $post_id ) ), $stored_id_map );
			}
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $filename ] );
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $page_name,
				'widgets_enable' => $widgets_result,
			);
		}

		// Elementor saved templates (elementor_library) from JSON — not site pages.
		if ( 'elementor-template' === $type ) {
			$filename = $this->find_file_key( $files, $page_name . '.json' );
			if ( ! $filename ) {
				return array(
					'success' => false,
					'message' => $page_name . '.json not found in stored data.',
				);
			}
			$data = $files[ $filename ];
			if ( $this->is_gutenberg_replacement_data( $data ) ) {
				return new WP_Error( 'IMPORT_ELEMENTOR_TEMPLATE_INVALID_JSON', __( 'Invalid template JSON for Elementor.', 'uichemy' ), array( 'status' => 400 ) );
			}
			$title   = $this->title_from_elementor_template_filename( $filename );
			$post_id = $this->create_or_update_elementor_template( $title, $data, 'page', array() );
			if ( is_wp_error( $post_id ) ) {
				return new WP_Error( 'IMPORT_ELEMENTOR_TEMPLATE_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $filename ] );
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $title,
				'widgets_enable' => $widgets_result,
			);
		}

		// Elementor Theme Builder templates (header, footer, single, archive) stored as elementor_library.
		if ( 'elementor-theme-template' === $type ) {
			$filename = $this->find_file_key( $files, $page_name . '.json' );
			if ( ! $filename ) {
				return array(
					'success' => false,
					'message' => $page_name . '.json not found in stored data.',
				);
			}
			$data = $files[ $filename ];
			if ( $this->is_gutenberg_replacement_data( $data ) ) {
				return new WP_Error( 'IMPORT_ELEMENTOR_THEME_TMPL_INVALID_JSON', __( 'Invalid theme template JSON for Elementor.', 'uichemy' ), array( 'status' => 400 ) );
			}
			$title   = $this->title_from_elementor_template_filename( $filename );
			$post_id = $this->create_or_update_elementor_template( $title, $data, 'page', array() );
			if ( is_wp_error( $post_id ) ) {
				$inner_code = $post_id->get_error_code();
				if ( 'IMPORT_ELEMENTOR_TMPL_INVALID_JSON' === $inner_code ) {
					return new WP_Error( 'IMPORT_ELEMENTOR_THEME_TMPL_INVALID_JSON', $post_id->get_error_message(), array( 'status' => 400 ) );
				}
				if ( 'IMPORT_ELEMENTOR_TMPL_ENCODE_FAILED' === $inner_code ) {
					return new WP_Error( 'IMPORT_ELEMENTOR_THEME_TMPL_ENCODE_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
				}
				return new WP_Error( 'IMPORT_ELEMENTOR_THEME_TEMPLATE_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $filename ] );
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $title,
				'widgets_enable' => $widgets_result,
			);
		}

		// Handle blog design pages (blog detail, author, category, tag, search) — imported as WP posts.
		if ( 'blog-post' === $type ) {
			$filename = $this->find_file_key( $files, $page_name . '.json' );
			if ( ! $filename ) {
				return array(
					'success' => false,
					'message' => $page_name . '.json not found in stored data.',
				);
			}
			$post_id = $this->create_or_update_elementor_page( $page_name, $files[ $filename ], 'post' );
			if ( is_wp_error( $post_id ) ) {
				return new WP_Error( 'IMPORT_PAGE_CREATION_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			$stored_id_map = $this->get_stored_template_id_map();
			if ( ! empty( $stored_id_map ) ) {
				$this->remap_template_ids_in_pages( array( array( 'post_id' => $post_id ) ), $stored_id_map );
			}
			// Enable widgets used in this blog post.
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $filename ] );
			$this->refresh_gutenberg_header_nav_links();
			$this->refresh_elementor_library_nav_links();
			$this->refresh_uichemy_header_nav_links();
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $page_name,
				'widgets_enable' => $widgets_result,
			);
		}

		// Handle blog listing page — import as a normal page (do not assign Settings > Reading > Posts page).
		if ( 'blog-page' === $type ) {
			$filename = $this->find_file_key( $files, $page_name . '.json' );
			// Fallback: "Blog Page" from frontend label may look for Blog Page.json; actual file is Blog.json.
			if ( ! $filename && strtolower( $page_name ) === 'blog page' ) {
				$filename  = $this->find_file_key( $files, 'blog.json' );
				$page_name = 'Blog';
			}
			if ( ! $filename ) {
				return array(
					'success' => false,
					'message' => $page_name . '.json not found in stored data.',
				);
			}
			$post_id = $this->create_or_update_elementor_page( $page_name, $files[ $filename ] );
			if ( is_wp_error( $post_id ) ) {
				return new WP_Error( 'IMPORT_PAGE_CREATION_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
			}
			$stored_id_map = $this->get_stored_template_id_map();
			if ( ! empty( $stored_id_map ) ) {
				$this->remap_template_ids_in_pages( array( array( 'post_id' => $post_id ) ), $stored_id_map );
			}
			// Enable widgets used in this blog listing page.
			$widgets_result = $this->enable_widgets_for_single_file( $files[ $filename ] );
			$this->refresh_gutenberg_header_nav_links();
			$this->refresh_elementor_library_nav_links();
			$this->refresh_uichemy_header_nav_links();
			$this->clear_elementor_files_cache();
			return array(
				'success'        => true,
				'post_id'        => $post_id,
				'permalink'      => get_permalink( $post_id ),
				'title'          => $page_name,
				'widgets_enable' => $widgets_result,
			);
		}

		// Reject completely unknown page types before falling through to the regular-page handler.
		$known_types = array( 'navbar', 'footer', '404', 'theme-template', 'hooks-template', 'elementor-template', 'elementor-theme-template', 'blog-post', 'blog-page', 'page' );
		if ( ! in_array( $type, $known_types, true ) ) {
			/* translators: %s: page type identifier. */
			return new WP_Error( 'IMPORT_PAGE_UNKNOWN_FAILED', sprintf( __( 'Unknown page type: %s', 'uichemy' ), $type ), array( 'status' => 400 ) );
		}

		// Regular page.
		$filename = $this->find_file_key( $files, $page_name . '.json' );
		if ( ! $filename ) {
			return array(
				'success' => false,
				'message' => $page_name . '.json not found in stored data.',
			);
		}

		$post_id = $this->create_or_update_elementor_page( $page_name, $files[ $filename ] );
		if ( is_wp_error( $post_id ) ) {
			return new WP_Error( 'IMPORT_PAGE_CREATION_FAILED', $post_id->get_error_message(), array( 'status' => 500 ) );
		}

		// Set as front page if title contains "Home" or "Landing" (mirrors wdesignkit behaviour).
		$title_lower = strtolower( $page_name );
		if ( strpos( $title_lower, 'home' ) !== false || strpos( $title_lower, 'landing' ) !== false ) {
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $post_id );
		}

		// Remap widget template references (e.g. tp-switcher content_a_template / content_b_template)
		// from source-site post IDs to the new local WordPress post IDs. The map was built during
		// the fetch phase when elementor_template files were imported via run_fetch_only().
		$stored_id_map = $this->get_stored_template_id_map();
		if ( ! empty( $stored_id_map ) ) {
			$this->remap_template_ids_in_pages( array( array( 'post_id' => $post_id ) ), $stored_id_map );
		}

		// Enable widgets used in this page.
		$widgets_result = $this->enable_widgets_for_single_file( $files[ $filename ] );
		$this->refresh_gutenberg_header_nav_links();
		$this->refresh_elementor_library_nav_links();
		$this->refresh_uichemy_header_nav_links();

		$this->clear_elementor_files_cache();

		return array(
			'success'        => true,
			'post_id'        => $post_id,
			'permalink'      => get_permalink( $post_id ),
			'title'          => $page_name,
			'widgets_enable' => $widgets_result,
		);
	}

	/**
	 * REST callback: apply Elementor plugin settings after import.
	 * Mirrors wdesignkit's update_plugin_setting() (class-api.php:3418).
	 *
	 * @param WP_REST_Request $request Request (body unused).
	 * @return WP_REST_Response
	 */
	public function rest_apply_plugin_settings( WP_REST_Request $request ) {
		if ( $this->is_elementor_active() ) {
			update_option( 'elementor_unfiltered_files_upload', 1 );
			update_option( 'elementor_load_fa4_shim', 'yes' );
			update_option( 'elementor_experiment-container', 'active' );
			update_option( 'elementor_experiment-e_font_icon_svg', 'inactive' );
		}
		$this->set_elementor_active_kit_content_width( 1240 );
		$this->clear_elementor_files_cache();

		// NOTE: this step only runs when the front-end's "advanced config" (SEO/Performance/
		// Security) toggle is on, so option cleanup can't live only here — see import-cleanup
		// below, which the front-end calls unconditionally instead.
		$this->cleanup_stale_import_options();

		return rest_ensure_response( array( 'success' => true ) );
	}

	/**
	 * REST callback: delete stored import scratch data. Called unconditionally at the end
	 * of every import (see cleanup_stale_import_options() for why this can't be left to
	 * apply-plugin-settings alone).
	 *
	 * @param WP_REST_Request $request Request (body unused).
	 * @return WP_REST_Response
	 */
	public function rest_import_cleanup( WP_REST_Request $request ) {
		$this->cleanup_stale_import_options();
		return rest_ensure_response( array( 'success' => true ) );
	}

	/**
	 * Delete the stored-JSON options an import no longer needs once page creation and the
	 * enable-widgets/enable-blocks finalize step have run. uich_webpage_replacement_data alone
	 * can be several MB; all three are autoload=off (no per-request performance cost either
	 * way), but they're one-shot import scratch data with no reason to persist afterward.
	 *
	 * Previously only deleted inside rest_apply_plugin_settings(), which the front-end calls
	 * conditionally (only when an "advanced config" toggle is on) — so a plain import with
	 * those toggles off left this data behind indefinitely. rest_import_cleanup() now calls
	 * this unconditionally at the true end of the front-end's finalize sequence.
	 *
	 * @return void
	 */
	protected function cleanup_stale_import_options() {
		delete_option( self::OPTION_REPLACEMENT_DATA );
		delete_option( self::OPTION_GLOBALS );
		delete_option( self::OPTION_TEMPLATE_ID_MAP );
	}

	/**
	 * Whether Elementor is loaded on this site. Elementor-only settings must be
	 * gated behind this so a Gutenberg-only import never silently enables them
	 * (e.g. unfiltered SVG uploads) without the site owner choosing to.
	 *
	 * @return bool
	 */
	protected function is_elementor_active() {
		return did_action( 'elementor/loaded' ) && class_exists( '\Elementor\Plugin' );
	}

	/**
	 * REST callback: apply Nexter theme container/spacing settings after import.
	 * Mirrors wdesignkit's update_theme_setting() (class-api.php:3586).
	 *
	 * @param WP_REST_Request $request Request (body unused).
	 * @return WP_REST_Response
	 */
	public function rest_apply_theme_settings( WP_REST_Request $request ) {
		$nexter_setting = get_option( 'nxt-theme-options', array() );
		if ( ! is_array( $nexter_setting ) ) {
			$nexter_setting = array();
		}

		$nexter_setting['site-header-container'] = 'container-fluid';
		$nexter_setting['site-footer-container'] = 'container-fluid';
		$nexter_setting['site-layout-container'] = 'container-fluid';
		$nexter_setting['site-page-container']   = 'container-fluid';

		$fluid_spacing                          = array(
			'md'      => array(
				'left'  => '0',
				'right' => '0',
			),
			'sm'      => array(
				'left'  => '',
				'right' => '',
			),
			'xs'      => array(
				'left'  => '',
				'right' => '',
			),
			'md-unit' => 'px',
			'sm-unit' => 'px',
			'xs-unit' => 'px',
		);
		$nexter_setting['header-fluid-spacing'] = $fluid_spacing;
		$nexter_setting['footer-fluid-spacing'] = $fluid_spacing;
		$nexter_setting['site-fluid-spacing']   = $fluid_spacing;
		$nexter_setting['page-fluid-spacing']   = $fluid_spacing;

		// Body font from the kit's typography (computed at fetch time in run_fetch_only(),
		// stored in import meta rather than re-read from globals here, since OPTION_GLOBALS
		// is already cleared by the time this finalize step runs — see rest_apply_plugin_settings()).
		$import_meta      = get_option( self::OPTION_IMPORT_META, array() );
		$body_font_family = is_array( $import_meta ) && ! empty( $import_meta['bodyFontFamily'] ) && is_string( $import_meta['bodyFontFamily'] )
			? $import_meta['bodyFontFamily']
			: '';
		if ( '' !== $body_font_family ) {
			$nexter_setting['body-font-family'] = $body_font_family;
		}

		update_option( 'nxt-theme-options', $nexter_setting );

		// Generate and persist TPGB global container CSS for tpgb-nxtcont-type blocks (replicates JS Yo() call).
		$this->write_tpgb_global_container_css( 1240, 960 );

		return rest_ensure_response( array( 'success' => true ) );
	}

	/**
	 * REST callback: move all existing posts, pages, and Nexter Theme Builder
	 * templates to draft before a fresh import.
	 *
	 * Nothing is deleted — content is set to 'draft' so the user can restore it
	 * afterwards. Items already in draft/trash/auto-draft are left untouched.
	 * Triggered only when the "Reset Previous Content Before Import" option is on.
	 *
	 * @param WP_REST_Request $request Request (body unused).
	 * @return WP_REST_Response
	 */
	public function rest_reset_content( WP_REST_Request $request ) {
		$post_types = array( 'post', 'page' );
		// Theme Builder templates the import creates now live in UiChemy's own CPT.
		// class_exists first: the builder runtime stands down when a standalone
		// UiChemy is active, and the constant would fatal without it.
		$uich_tpl_type = class_exists( 'UiChemy_Template_CPT' ) ? UiChemy_Template_CPT::POST_TYPE : '';
		if ( '' !== $uich_tpl_type && post_type_exists( $uich_tpl_type ) ) {
			$post_types[] = $uich_tpl_type;
		}
		// Sites imported before the switch still have theirs in nxt_builder, so a
		// reset has to sweep both or it leaves half the old site rendering.
		if ( post_type_exists( 'nxt_builder' ) ) {
			$post_types[] = 'nxt_builder';
		}

		$ids = get_posts(
			array(
				'post_type'              => $post_types,
				'post_status'            => array( 'publish', 'future', 'pending', 'private' ),
				'posts_per_page'         => -1,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'suppress_filters'       => true,
				'update_post_term_cache' => false,
				'update_post_meta_cache' => false,
			)
		);

		$moved          = 0;
		$disabled_nxt   = false;
		foreach ( $ids as $post_id ) {
			$post_id = (int) $post_id;
			if ( $post_id <= 0 || ! current_user_can( 'edit_post', $post_id ) ) {
				continue;
			}
			$this_type      = get_post_type( $post_id );
			$is_nxt_builder = ( 'nxt_builder' === $this_type );
			$is_uich_tpl    = ( '' !== $uich_tpl_type && $uich_tpl_type === $this_type );
			$result         = wp_update_post(
				array(
					'ID'          => $post_id,
					'post_status' => 'draft',
				),
				true
			);
			if ( ! is_wp_error( $result ) && $result ) {
				// Disable Nexter Theme Builder templates so drafted ones stop rendering on the front end.
				if ( $is_nxt_builder ) {
					update_post_meta( $post_id, 'nxt_build_status', '0' );
					$disabled_nxt = true;
				}
				// Same for UiChemy's: its resolver keys off the active/inactive meta,
				// not post_status, so drafting alone would leave the template live.
				if ( $is_uich_tpl ) {
					update_post_meta( $post_id, UiChemy_Template_CPT::META_STATUS, 'inactive' );
				}
				clean_post_cache( $post_id );
				$moved++;
			}
		}

		// Nexter build status is independent of post status: a template can already be
		// in draft yet still render because nxt_build_status is '1'. Disable those too.
		$disabled = 0;
		if ( post_type_exists( 'nxt_builder' ) ) {
			$nxt_ids = get_posts(
				array(
					'post_type'              => 'nxt_builder',
					'post_status'            => 'any',
					'posts_per_page'         => -1,
					'fields'                 => 'ids',
					'no_found_rows'          => true,
					'suppress_filters'       => true,
					'update_post_term_cache' => false,
					'update_post_meta_cache' => false,
					'meta_query'             => array(
						array(
							'key'     => 'nxt_build_status',
							'value'   => '0',
							'compare' => '!=',
						),
					),
				)
			);
			foreach ( $nxt_ids as $nxt_id ) {
				$nxt_id = (int) $nxt_id;
				if ( $nxt_id <= 0 || ! current_user_can( 'edit_post', $nxt_id ) ) {
					continue;
				}
				update_post_meta( $nxt_id, 'nxt_build_status', '0' );
				clean_post_cache( $nxt_id );
				$disabled++;
			}
		}

		// Bump the Nexter condition cache once so the disabled templates stop rendering.
		if ( $disabled_nxt || $disabled > 0 ) {
			$this->bump_nexter_builder_cache();
		}

		return rest_ensure_response(
			array(
				'success'  => true,
				'moved'    => $moved,
				'disabled' => $disabled,
				'types'    => $post_types,
			)
		);
	}

	/**
	 * Create or update a Nexter theme builder template (blog/archive/search) using Gutenberg post_content.
	 *
	 * @param string $title         Template title.
	 * @param string $post_content  Processed block markup.
	 * @param string $el_type       'single', 'archive', or 'search-results'.
	 * @param string $archive_rule  Archive rule for nxt-archive-group.
	 * @return int|WP_Error Post ID.
	 */
	protected function create_or_update_nexter_blog_template_gutenberg( $title, $post_content, $el_type, $archive_rule = '' ) {
		$section_type = ( 'single' === $el_type ) ? 'singular' : 'archives';

		foreach ( array( 'post', 'page' ) as $wrong_type ) {
			$wrong_posts = get_posts(
				array(
					'post_type'      => $wrong_type,
					'post_status'    => 'any',
					'posts_per_page' => -1,
					'meta_key'       => '_elementor_edit_mode',
					'meta_value'     => 'builder',
					'title'          => $title,
				)
			);
			foreach ( $wrong_posts as $wrong_post ) {
				wp_delete_post( $wrong_post->ID, true );
			}
		}

		$existing = get_posts(
			array(
				'post_type'      => 'nxt_builder',
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'meta_key'       => 'nxt-hooks-layout-sections',
				'meta_value'     => $section_type,
				'title'          => $title,
			)
		);

		if ( ! empty( $existing ) ) {
			$this->draft_existing_post_for_reimport( $existing[0]->ID, 'nxt_builder' );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
				'post_status' => 'publish',
				'post_type'   => 'nxt_builder',
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		update_post_meta( $post_id, 'nxt-hooks-layout-sections', $section_type );
		update_post_meta( $post_id, 'nxt_build_status', '1' );

		if ( 'singular' === $section_type ) {
			update_post_meta(
				$post_id,
				'nxt-singular-group',
				array(
					array(
						'nxt-singular-include-exclude'  => 'include',
						'nxt-singular-conditional-rule' => 'post',
						'nxt-singular-conditional-type' => array(),
					),
				)
			);
		} else {
			$rule = ! empty( $archive_rule ) ? $archive_rule : 'all';
			update_post_meta(
				$post_id,
				'nxt-archive-group',
				array(
					array(
						'nxt-archive-include-exclude'  => 'include',
						'nxt-archive-conditional-rule' => $rule,
						'nxt-archive-conditional-type' => array(),
					),
				)
			);
		}

		// Assign unique TPGB block_ids with the correct post_id suffix.
		$post_content = $this->apply_unique_tpgb_block_ids( $post_content, (int) $post_id );

		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( $post_content ),
			)
		);

		delete_post_meta( $post_id, '_elementor_data' );
		delete_post_meta( $post_id, '_elementor_edit_mode' );
		delete_post_meta( $post_id, '_elementor_template_type' );

		return $post_id;
	}

	/**
	 * Create or update a Nexter Theme Builder template for blog-related pages.
	 * Uses nxt_builder post type (same as header/footer) so Elementor Pro is not required.
	 *
	 * el_type mapping → Nexter section type + archive rule:
	 *   'single'         → 'singular'  (Blog Detail Page)     — nxt-singular-group rule: 'post'
	 *   'archive'        → 'archives'  (Author Page)          — nxt-archive-group rule: 'nxt_author'
	 *   'archive'        → 'archives'  (Category Page)        — nxt-archive-group rule: 'category'
	 *   'archive'        → 'archives'  (Tag Featured Page)    — nxt-archive-group rule: 'post_tag'
	 *   'search-results' → 'archives'  (Search Results Page)  — nxt-archive-group rule: 'nxt_search'
	 *
	 * @param string $title        Template title.
	 * @param mixed  $data         Decoded JSON from the API.
	 * @param string $el_type      Elementor-style type: 'single', 'archive', 'search-results'.
	 * @param string $archive_rule Nexter archive condition rule (e.g. 'nxt_author', 'category', 'post_tag', 'nxt_search'). Empty = all archives.
	 * @return int|WP_Error Post ID on success or WP_Error.
	 */
	protected function create_or_update_nexter_blog_template( $title, $data, $el_type, $archive_rule = '' ) {
		// Requires /install-requirements endpoint to be called first.
		if ( ! post_type_exists( 'nxt_builder' ) ) {
			return new WP_Error( 'IMPORT_NEXTER_BLOG_NOT_ACTIVE', __( 'Nexter Extension is not active.', 'uichemy' ) );
		}

		// archive_rules for the 4 dedicated archive pages that must keep archive_listing.
		$skip_archive_rules = array( 'category', 'post_tag', 'nxt_author', 'nxt_search' );

		if ( $this->is_gutenberg_replacement_data( $data ) ) {
			$post_content = $this->process_gutenberg_markup_to_post_content( $data['markup'] );
			if ( is_wp_error( $post_content ) ) {
				return $post_content;
			}
			// Normalize tpgb/tp-post-listing: change archive_listing → page_listing for all templates
			// except the 4 dedicated archive pages (category, tag, author, search).
			if ( ! in_array( $archive_rule, $skip_archive_rules, true ) ) {
				$post_content = $this->normalize_tpgb_post_listing_mode( $post_content );
			}
			return $this->create_or_update_nexter_blog_template_gutenberg( $title, $post_content, $el_type, $archive_rule );
		}

		// Normalize tp-blog-listout: change archive_listing → page_listing for all templates
		// except the 4 dedicated archive pages (category, tag, author, search).
		if ( ! in_array( $archive_rule, $skip_archive_rules, true ) ) {
			$data = $this->normalize_blog_listing_mode( $data );
		}

		$content = $this->extract_elementor_content( $data );
		if ( null === $content ) {
			return new WP_Error( 'IMPORT_BLOG_TMPL_INVALID_JSON', __( 'Invalid template JSON structure.', 'uichemy' ) );
		}

		// Map el_type → Nexter nxt-hooks-layout-sections value.
		$section_type = ( 'single' === $el_type ) ? 'singular' : 'archives';

		// Clean up any wrongly-created posts/pages with this title that are not nxt_builder templates.
		// These can appear when a previous import placed theme builder files in the wrong post type.
		foreach ( array( 'post', 'page' ) as $wrong_type ) {
			$wrong_posts = get_posts(
				array(
					'post_type'      => $wrong_type,
					'post_status'    => 'any',
					'posts_per_page' => -1,
					'meta_key'       => '_elementor_edit_mode',
					'meta_value'     => 'builder',
					'title'          => $title,
				)
			);
			foreach ( $wrong_posts as $wrong_post ) {
				wp_delete_post( $wrong_post->ID, true );
			}
		}

		// Find existing template by title + section type to avoid duplicates.
		$existing = get_posts(
			array(
				'post_type'      => 'nxt_builder',
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'meta_key'       => 'nxt-hooks-layout-sections',
				'meta_value'     => $section_type,
				'title'          => $title,
			)
		);

		if ( ! empty( $existing ) ) {
			$this->draft_existing_post_for_reimport( $existing[0]->ID, 'nxt_builder' );
		}

		$post_id = wp_insert_post(
			array(
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
				'post_status' => 'publish',
				'post_type'   => 'nxt_builder',
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		update_post_meta( $post_id, 'nxt-hooks-layout-sections', $section_type );
		update_post_meta( $post_id, 'nxt_build_status', '1' );

		// Set display conditions so template is applied to the right pages.
		if ( 'singular' === $section_type ) {
			// Blog Detail Page → show on all single posts.
			update_post_meta(
				$post_id,
				'nxt-singular-group',
				array(
					array(
						'nxt-singular-include-exclude'  => 'include',
						'nxt-singular-conditional-rule' => 'post',
						'nxt-singular-conditional-type' => array(),
					),
				)
			);
		} else {
			// Archive templates: Author, Category, Tag, Search Results.
			// Use specific archive rule when provided (nxt_author, category, post_tag, nxt_search).
			$rule = ! empty( $archive_rule ) ? $archive_rule : 'all';
			update_post_meta(
				$post_id,
				'nxt-archive-group',
				array(
					array(
						'nxt-archive-include-exclude'  => 'include',
						'nxt-archive-conditional-rule' => $rule,
						'nxt-archive-conditional-type' => array(),
					),
				)
			);
		}

		// Resolve remote images in content.
		$content = $this->resolve_elementor_assets( $content );
		$content = $this->ensure_elementor_ids_are_strings( $content );

		$json_string = wp_json_encode( $content );
		if ( false === $json_string ) {
			return new WP_Error( 'IMPORT_BLOG_TMPL_ENCODE_FAILED', __( 'Could not encode template data.', 'uichemy' ) );
		}

		update_post_meta( $post_id, '_elementor_data', wp_slash( $json_string ) );
		update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );

		return $post_id;
	}

	/**
	 * Create or update an Elementor library template (elementor_library post type).
	 * Used for blog-related archive/single/search templates: Blog Detail Page, Category Page,
	 * Tag Featured Page, Author Page, Search Results Page.
	 *
	 * Mirrors wdesignkit import_page_section_content() Elementor path (class-api.php:3250) where
	 * post_type = 'elementor_library' and el_type comes from JSON or is passed explicitly.
	 *
	 * @param string   $title      Template title.
	 * @param mixed    $data       Decoded JSON from the API.
	 * @param string   $el_type    Elementor document type: 'single', 'archive', 'search-results'.
	 * @param string[] $conditions Elementor display conditions e.g. ['include/singular/post'].
	 * @return int|WP_Error Post ID on success or WP_Error.
	 */
	protected function create_or_update_elementor_template( $title, $data, $el_type, array $conditions = array() ) {
		if ( ! did_action( 'elementor/loaded' ) ) {
			return new WP_Error( 'IMPORT_ELEMENTOR_NOT_ACTIVE', __( 'Elementor is not active.', 'uichemy' ) );
		}

		$content = $this->extract_elementor_content( $data );
		if ( null === $content ) {
			return new WP_Error( 'IMPORT_ELEMENTOR_TMPL_INVALID_JSON', __( 'Invalid template JSON structure.', 'uichemy' ) );
		}

		// Map el_type → Elementor _elementor_template_type meta value.
		$template_type_map = array(
			'single'         => 'single-post',
			'archive'        => 'archive',
			'search-results' => 'search-results',
			'page'           => 'page',
		);
		$template_type     = isset( $template_type_map[ $el_type ] ) ? $template_type_map[ $el_type ] : $el_type;

		// Find existing template by title and type to avoid duplicates.
		$existing_posts = get_posts(
			array(
				'post_type'      => 'elementor_library',
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'title'          => $title,
				'meta_key'       => '_elementor_template_type',
				'meta_value'     => $template_type,
			)
		);

		if ( ! empty( $existing_posts ) ) {
			$this->draft_existing_post_for_reimport( $existing_posts[0]->ID, 'elementor_library' );
		}

		// Use wp_insert_post directly — documents->create() requires Elementor Pro for
		// theme template types (single, archive, search-results) and throws
		// "Type X does not exist." on free Elementor. All required meta is set below.
		$post_id = wp_insert_post(
			array(
				'post_title'  => $title,
				'post_name'   => sanitize_title( $title ),
				'post_status' => 'publish',
				'post_type'   => 'elementor_library',
				'post_author' => get_current_user_id() ? get_current_user_id() : 1,
			)
		);
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		// Resolve remote images in content.
		$content = $this->resolve_elementor_assets( $content );
		$content = $this->ensure_elementor_ids_are_strings( $content );

		$json_string = wp_json_encode( $content );
		if ( false === $json_string ) {
			return new WP_Error( 'IMPORT_ELEMENTOR_TMPL_ENCODE_FAILED', __( 'Could not encode template data.', 'uichemy' ) );
		}

		update_post_meta( $post_id, '_elementor_data', wp_slash( $json_string ) );
		update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
		update_post_meta( $post_id, '_elementor_template_type', $template_type );

		// Set Elementor Pro display conditions so the template renders on the right pages.
		if ( ! empty( $conditions ) ) {
			update_post_meta( $post_id, '_elementor_conditions', $conditions );
		}

		return $post_id;
	}

	/**
	 * REST callback: create WordPress blog posts from dynamic blog-post-content.json or request payload.
	 *
	 * When no posts array is provided in the request, reads from blog-post-content.json stored in
	 * replacement data fetched via downloadUrls (same source as pages/navbar/footer).
	 *
	 * Each post: title, slug, excerpt, category (single string), tags (array), featuredImage (URL),
	 * isPublished, content (array of {type: paragraph|heading, text}).
	 *
	 * Mirrors wdesignkit's wkit_generate_post_data / AI blog post creation flow.
	 *
	 * @param WP_REST_Request $request JSON body optionally contains { posts: [] }.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_import_blog_posts( WP_REST_Request $request ) {
		// Images are fetched and thumbnailed inline, so even a single-post batch can
		// outrun the default execution window — see raise_execution_limit().
		$this->raise_execution_limit();
		$params = $request->get_json_params();
		$posts  = isset( $params['posts'] ) && is_array( $params['posts'] ) ? $params['posts'] : null;

		// When no posts are passed explicitly, import from stored blog-post-content.json (dynamic flow).
		// Batched by offset/limit so each HTTP request stays short: featured + inline images are
		// downloaded and thumbnailed synchronously per post, so importing all posts in one request
		// runs for minutes and gets killed by PHP max_execution_time / proxy / Cloudflare timeouts.
		// The front-end loops this endpoint (offset advancing by `processed`) until `done` is true.
		if ( empty( $posts ) ) {
			return rest_ensure_response( $this->import_blog_posts_batch( $params ) );
		}

		if ( empty( $posts ) ) {
			return rest_ensure_response(
				array(
					'success' => true,
					'created' => 0,
					'posts'   => array(),
				)
			);
		}

		// Pre-create/update categories and tags with metadata if provided in the request.
		$req_categories = isset( $params['categories'] ) && is_array( $params['categories'] ) ? $params['categories'] : array();
		$req_tags       = isset( $params['tags'] ) && is_array( $params['tags'] ) ? $params['tags'] : array();
		if ( ! empty( $req_categories ) ) {
			$this->import_terms_metadata( $req_categories, 'category' );
		}
		if ( ! empty( $req_tags ) ) {
			$this->import_terms_metadata( $req_tags, 'post_tag' );
		}

		$created = array();
		$errors  = array();
		foreach ( $posts as $post_data ) {
			$result = $this->create_single_blog_post( $post_data );
			if ( $result && ! is_wp_error( $result ) ) {
				$created[] = $result;
			} elseif ( is_wp_error( $result ) ) {
				$errors[] = $result->get_error_message();
			}
		}

		// Inject category/tag IDs into blog template post listing widgets.
		$this->update_blog_template_post_listings( array( 'posts' => $created ) );

		// Enable blocks used in imported posts (Dashboard flow).
		$files          = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		$widgets_result = array();
		if ( ! empty( $files ) && is_array( $files ) ) {
			$widgets_result = $this->enable_widgets_from_files( $files );
		}

		return rest_ensure_response(
			array(
				'success'        => true,
				'created'        => count( $created ),
				'posts'          => $created,
				'errors'         => $errors,
				'widgets_enable' => $widgets_result,
			)
		);
	}

	/**
	 * Import a slice of blog posts from the stored blog-post-content.json.
	 *
	 * Called by rest_import_blog_posts() when no explicit posts payload is provided. The work is
	 * batched so each HTTP request stays short: the front-end loops, advancing `offset` by the
	 * returned `processed` count until `done` is true. Heavy one-time work is scoped correctly —
	 * category/tag metadata is created on the first batch, and the listing-widget update +
	 * block-enable run once on the final batch over every created post (accumulated in a transient).
	 *
	 * @param array $params Request params. Recognized: offset (int, default 0), limit (int, default = all remaining).
	 * @return array { success, created, total, processed, offset, next_offset, done, posts, errors, widgets_enable? }
	 */
	protected function import_blog_posts_batch( array $params ) {
		$files    = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		$filename = is_array( $files ) ? $this->find_file_key( $files, 'blog-post-content.json' ) : null;

		if ( null === $filename || ! isset( $files[ $filename ] ) || ! is_array( $files[ $filename ] ) ) {
			return array(
				'success'   => true,
				'skipped'   => true,
				'created'   => 0,
				'total'     => 0,
				'processed' => 0,
				'offset'    => 0,
				'next_offset' => null,
				'done'      => true,
				'posts'     => array(),
				'errors'    => array(),
			);
		}

		$data      = $files[ $filename ];
		$all_posts = isset( $data['posts'] ) && is_array( $data['posts'] ) ? array_values( $data['posts'] ) : array();
		$total     = count( $all_posts );

		$offset = isset( $params['offset'] ) ? max( 0, (int) $params['offset'] ) : 0;
		// Default limit = all remaining (single-shot back-compat when no offset/limit sent).
		$limit  = isset( $params['limit'] ) ? max( 1, (int) $params['limit'] ) : max( 1, $total );

		if ( 0 === $total ) {
			return array(
				'success'   => true,
				'created'   => 0,
				'total'     => 0,
				'processed' => 0,
				'offset'    => 0,
				'next_offset' => null,
				'done'      => true,
				'posts'     => array(),
				'errors'    => array(),
			);
		}

		// First batch: pre-create category/tag metadata once, and reset the cross-batch accumulator.
		if ( 0 === $offset ) {
			$categories_meta = isset( $data['categories'] ) && is_array( $data['categories'] ) ? $data['categories'] : array();
			$tags_meta       = isset( $data['tags'] ) && is_array( $data['tags'] ) ? $data['tags'] : array();
			if ( ! empty( $categories_meta ) ) {
				$this->import_terms_metadata( $categories_meta, 'category' );
			}
			if ( ! empty( $tags_meta ) ) {
				$this->import_terms_metadata( $tags_meta, 'post_tag' );
			}
			delete_transient( self::TRANSIENT_BLOG_IMPORT_CREATED );
		}

		$slice   = array_slice( $all_posts, $offset, $limit );
		$created = array();
		$errors  = array();
		foreach ( $slice as $post_data ) {
			if ( ! is_array( $post_data ) ) {
				continue;
			}
			$result = $this->create_single_blog_post( $post_data );
			if ( $result && ! is_wp_error( $result ) ) {
				$created[] = $result;
			} elseif ( is_wp_error( $result ) ) {
				$errors[] = $result->get_error_message();
			}
		}

		// Accumulate created post IDs so the final batch can update listing widgets over every post.
		$accumulated = get_transient( self::TRANSIENT_BLOG_IMPORT_CREATED );
		$accumulated = is_array( $accumulated ) ? $accumulated : array();
		foreach ( $created as $c ) {
			if ( ! empty( $c['post_id'] ) ) {
				$accumulated[] = array( 'post_id' => (int) $c['post_id'] );
			}
		}
		set_transient( self::TRANSIENT_BLOG_IMPORT_CREATED, $accumulated, HOUR_IN_SECONDS );

		$processed = $offset + count( $slice );
		$done      = $processed >= $total;

		// A batch is only a hard failure when it created nothing AND hit errors — surface it so the
		// front-end (failureMessageFromRestPayload) marks the step failed instead of silently passing.
		$batch_failed = empty( $created ) && ! empty( $errors );

		$response = array(
			'success'     => ! $batch_failed,
			'created'     => count( $created ),
			'total'       => $total,
			'processed'   => $processed,
			'offset'      => $offset,
			'next_offset' => $done ? null : $processed,
			'done'        => $done,
			'posts'       => $created,
			'errors'      => $errors,
		);

		if ( $batch_failed ) {
			$response['message']     = __( 'Could not create blog posts.', 'uichemy' );
			$response['description'] = implode( ' ', array_slice( $errors, 0, 3 ) );
		}

		if ( $done ) {
			// Inject category/tag IDs into blog template post listing widgets using every created post.
			$this->update_blog_template_post_listings( array( 'posts' => $accumulated ) );
			delete_transient( self::TRANSIENT_BLOG_IMPORT_CREATED );

			// Enable blocks used in imported posts (Dashboard flow runs this here, not in import-pages).
			$enable_files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
			if ( ! empty( $enable_files ) && is_array( $enable_files ) ) {
				$response['widgets_enable'] = $this->enable_widgets_from_files( $enable_files );
			}
		}

		return $response;
	}

	/**
	 * Create a single WordPress post from blog-post-content.json post data.
	 *
	 * @param array $post_data Post data from blog-post-content.json.
	 * @return array|WP_Error { post_id, title, permalink } or WP_Error.
	 */
	/**
	 * Create or update WordPress taxonomy terms with description and thumbnail image.
	 *
	 * Called before blog posts are created so that every category and tag has full rich
	 * metadata (description, thumbnail image) from blog-post-content.json ready by the
	 * time posts are assigned to them.
	 *
	 * Each entry in $terms_data must be an array with keys:
	 *   - name        (string) Term name — required.
	 *   - description (string) Human-readable description — optional.
	 *   - img         (string) Remote image URL to sideload as the term thumbnail — optional.
	 *
	 * The sideloaded image is stored as term meta under key `thumbnail_id` (attachment ID),
	 * which is the standard key used by WooCommerce, many themes, and the Nexter framework
	 * for displaying term images on archive pages.
	 *
	 * On re-import the method updates the description if it changed, but skips re-downloading
	 * the image when a valid attachment already exists for the term.
	 *
	 * @param array  $terms_data Taxonomy term definitions from blog-post-content.json.
	 * @param string $taxonomy   WordPress taxonomy slug: 'category' or 'post_tag'.
	 * @return void
	 */
	protected function import_terms_metadata( array $terms_data, $taxonomy ) {
		if ( empty( $terms_data ) ) {
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		foreach ( $terms_data as $term_data ) {
			$name        = isset( $term_data['name'] ) ? sanitize_text_field( $term_data['name'] ) : '';
			$description = isset( $term_data['description'] ) ? sanitize_textarea_field( $term_data['description'] ) : '';
			$img_url     = isset( $term_data['img'] ) ? esc_url_raw( $term_data['img'] ) : '';

			if ( '' === $name ) {
				continue;
			}

			// Get existing term or create a new one.
			$existing = get_term_by( 'name', $name, $taxonomy );
			if ( $existing ) {
				$term_id = (int) $existing->term_id;
				// Update description if it has changed or was previously empty.
				if ( '' !== $description && $existing->description !== $description ) {
					wp_update_term( $term_id, $taxonomy, array( 'description' => $description ) );
				}
			} else {
				$insert_args = array();
				if ( '' !== $description ) {
					$insert_args['description'] = $description;
				}
				$result = wp_insert_term( $name, $taxonomy, $insert_args );
				if ( is_wp_error( $result ) ) {
					continue;
				}
				$term_id = (int) $result['term_id'];
			}

			// Download image into the local Media Library and store the attachment ID as
			// term meta. Save to both tpgb_category_id (used by TPGB admin column and
			// frontend blocks) and thumbnail_id (WooCommerce / fallback).
			if ( '' !== $img_url ) {
				$asset = $this->import_asset( $img_url );
				if ( $asset && ! empty( $asset['id'] ) ) {
					$attachment_id = (int) $asset['id'];
					// Save to all known meta keys so any installed plugin renders the image:
					// tpgb_category_id   — TPGB Pro (block editor) category image feature
					// tp_taxonomy_image_id — TPAE Elementor taxonomy image feature
					// thumbnail_id       — WooCommerce / fallback
					update_term_meta( $term_id, 'tpgb_category_id', $attachment_id );
					update_term_meta( $term_id, 'tp_taxonomy_image_id', $attachment_id );
					update_term_meta( $term_id, 'thumbnail_id', $attachment_id );
				}
			}
		}
	}

	protected function create_single_blog_post( array $post_data ) {
		$title      = isset( $post_data['title'] ) ? sanitize_text_field( $post_data['title'] ) : '';
		$slug       = isset( $post_data['slug'] ) ? sanitize_title( $post_data['slug'] ) : sanitize_title( $title );
		$excerpt    = isset( $post_data['excerpt'] ) ? sanitize_textarea_field( $post_data['excerpt'] ) : '';
		$is_publish = ! isset( $post_data['isPublished'] ) || ! empty( $post_data['isPublished'] );
		$date_raw   = isset( $post_data['date'] ) ? $post_data['date'] : '';

		if ( empty( $title ) ) {
			return new WP_Error( 'IMPORT_BLOG_POST_MISSING_TITLE', __( 'Blog post title is required.', 'uichemy' ) );
		}

		// Convert content array to post_content: use Gutenberg block markup when TPGB blocks present so Nexter blocks show in editor (like WDesignKit).
		$content_blocks = isset( $post_data['content'] ) && is_array( $post_data['content'] ) ? $post_data['content'] : array();
		$post_content   = $this->blog_content_to_post_content( $content_blocks );
		// Resolve remote images (download, replace URLs) like pages do.
		$post_content = $this->resolve_post_content_images( $post_content );

		// Parse date.
		$post_date = '';
		if ( ! empty( $date_raw ) ) {
			$ts = strtotime( $date_raw );
			if ( $ts ) {
				$post_date = date( 'Y-m-d H:i:s', $ts ); // phpcs:ignore WordPress.DateTime.RestrictedFunctions.date_date
			}
		}

		$post_args = array(
			'post_title'   => $title,
			'post_name'    => $slug,
			'post_excerpt' => $excerpt,
			'post_content' => wp_slash( $post_content ),
			'post_status'  => $is_publish ? 'publish' : 'draft',
			'post_type'    => 'post',
			'post_author'  => get_current_user_id() ? get_current_user_id() : 1,
		);
		if ( $post_date ) {
			$post_args['post_date'] = $post_date;
		}

		// If a post with this slug already exists, move it to draft and keep the new import as published.
		$existing = get_page_by_path( $slug, OBJECT, 'post' );
		if ( $existing ) {
			$this->draft_existing_post_for_reimport( $existing->ID, 'post' );
			$post_id = wp_insert_post( $post_args, true );
		} else {
			$post_id = wp_insert_post( $post_args, true );
		}

		if ( is_wp_error( $post_id ) ) {
			$api = new Uich_Webpage_Api();
			$api->report_error( 'IMPORT_BLOG_POST_CREATION_FAILED', array( 'message' => $post_id->get_error_message(), 'source' => 'uichemy-webpage', 'level' => 'error', 'context' => array( 'title' => $title ) ) );
			return $post_id;
		}

		// Match the page import: give every TPGB block a unique post-scoped ID and drop any
		// stale per-post CSS. Blog posts imported from a shared source template otherwise carry
		// duplicate block_ids across posts, so the dynamic block CSS doesn't match the rendered
		// markup on the first front-end load — the post looks unstyled until a manual refresh
		// regenerates it. Pages already do this; the blog-post path didn't.
		if ( false !== strpos( (string) $post_content, 'wp:tpgb/' ) ) {
			$unique_content = $this->apply_unique_tpgb_block_ids( $post_content, (int) $post_id );
			wp_update_post(
				array(
					'ID'           => $post_id,
					'post_content' => wp_slash( $unique_content ),
				)
			);
			$this->invalidate_tpgb_block_css_file( $post_id );
		}

		// Assign category. Terms may have already been created with full metadata by
		// import_terms_metadata(); here we just look up the ID and assign to the post.
		$category_name = isset( $post_data['category'] ) ? sanitize_text_field( $post_data['category'] ) : '';
		if ( ! empty( $category_name ) ) {
			$existing_cat = get_term_by( 'name', $category_name, 'category' );
			if ( $existing_cat ) {
				$cat_id = (int) $existing_cat->term_id;
			} else {
				// No pre-created term; create a plain one (no metadata available here).
				$term   = wp_insert_term( $category_name, 'category' );
				$cat_id = is_wp_error( $term ) ? 0 : (int) $term['term_id'];
			}
			if ( $cat_id > 0 ) {
				wp_set_post_categories( $post_id, array( $cat_id ) );
			}
		}

		// Assign tags. Terms may already exist with full metadata from import_terms_metadata().
		// wp_set_post_tags assigns existing terms and creates missing ones (name-only fallback).
		$tags = isset( $post_data['tags'] ) && is_array( $post_data['tags'] ) ? $post_data['tags'] : array();
		if ( ! empty( $tags ) ) {
			$clean_tags = array_map( 'sanitize_text_field', $tags );
			wp_set_post_tags( $post_id, $clean_tags );
		}

		// Sideload featured image.
		$featured_url = isset( $post_data['featuredImage'] ) ? esc_url_raw( $post_data['featuredImage'] ) : '';
		if ( ! empty( $featured_url ) ) {
			$upload_check = wp_upload_dir();
			if ( ! empty( $upload_check['error'] ) ) {
				$api = new Uich_Webpage_Api();
				$api->report_error( 'IMPORT_UPLOAD_DIR_FEATURED_IMAGE_ERROR', array( 'message' => $upload_check['error'], 'source' => 'uichemy-webpage', 'level' => 'warning', 'context' => array( 'url' => $featured_url ) ) );
			}
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';

			// Cap the timeout (default 300s) so a slow featured image can't stall the import.
			$tmp = download_url( $featured_url, 30 );
			if ( ! is_wp_error( $tmp ) ) {
				$file_array = array(
					'name'     => wp_basename( $featured_url ),
					'tmp_name' => $tmp,
				);
				$image_id   = media_handle_sideload( $file_array, $post_id );
				wp_delete_file( $tmp );
				if ( ! is_wp_error( $image_id ) ) {
					set_post_thumbnail( $post_id, $image_id );
				}
			}
		}

		return array(
			'post_id'   => $post_id,
			'title'     => $title,
			'permalink' => get_permalink( $post_id ),
		);
	}

	/**
	 * Convert blog-post-content.json content array to post_content.
	 * Follows WDesignKit approach: serialize blocks, parse, process with Nexter, serialize again.
	 *
	 * @param array $blocks Content blocks array from blog-post-content.json.
	 * @return string post_content (Gutenberg block markup).
	 */
	protected function blog_content_to_post_content( array $blocks ) {
		if ( empty( $blocks ) ) {
			return '';
		}

		// Convert JSON block array to Gutenberg block markup.
		$markup = $this->blog_blocks_to_block_markup( $blocks );

		// Process through Nexter block processor (like WDesignKit).
		if ( ! function_exists( 'parse_blocks' ) || ! function_exists( 'serialize_blocks' ) ) {
			return $markup;
		}

		$parsed_blocks = parse_blocks( $markup );
		if ( empty( $parsed_blocks ) ) {
			return $markup;
		}

		// Run Nexter block processor.
		$processor     = new Uich_Webpage_Block_Processor();
		$parsed_blocks = $processor->run( $parsed_blocks );
		$parsed_blocks = $this->wrap_tpgb_css_var_refs_in_blocks( $parsed_blocks );

		// Serialize and fix unicode.
		$content = serialize_blocks( $parsed_blocks );
		return $this->replace_unicode_glitch( $content );
	}

	/**
	 * Serialize TPGB block array from blog-post-content.json to Gutenberg block comment markup.
	 *
	 * @param array $blocks Blocks with blockName, attrs, innerHTML, innerBlocks.
	 * @return string Serialized block markup.
	 */
	protected function blog_blocks_to_block_markup( array $blocks ) {
		$out = '';
		foreach ( $blocks as $block ) {
			$name = isset( $block['blockName'] ) ? $block['blockName'] : '';
			if ( empty( $name ) ) {
				continue;
			}

			$attrs        = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
			$inner_html   = isset( $block['innerHTML'] ) ? (string) $block['innerHTML'] : '';
			$inner_blocks = isset( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ? $block['innerBlocks'] : array();

			$attrs_json = ! empty( $attrs ) ? ' ' . wp_json_encode( $attrs ) : '';
			$out       .= '<!-- wp:' . $name . $attrs_json . ' -->' . "\n";

			if ( ! empty( $inner_blocks ) ) {
				$out .= $this->blog_blocks_to_block_markup( $inner_blocks );
			} elseif ( '' !== $inner_html ) {
				$out .= $inner_html . "\n";
			}

			$out .= '<!-- /wp:' . $name . ' -->' . "\n";
		}
		return $out;
	}

	/**
	 * Fix escaped unicode in block markup (e.g. \\u002d for hyphen in WDesignKit CSS-var exports).
	 * Mirrors WDesignKit class-api.php replace_unicode_glitch so post_content saves correctly.
	 *
	 * IMPORTANT: WordPress's serialize_block_attributes() deliberately encodes five characters
	 * as unicode escapes for HTML/JSON safety inside block comments:
	 *   \\u0022 ("), \\u003c (<), \\u003e (>), \\u0026 (&), \\u005c (\\)
	 * Converting these back to literal characters BREAKS the block comment JSON — json_decode()
	 * fails and the render callback receives empty attrs, falling back to all defaults (style-1,
	 * grid, etc.). Those five codes are therefore left as-is; all other \\uXXXX sequences
	 * (e.g. \\u002d for hyphen in CSS-var names like --tpgb-C11) are decoded to their literal chars.
	 *
	 * @param string $content Serialized block markup.
	 * @return string
	 */
	protected function replace_unicode_glitch( $content ) {
		if ( ! is_string( $content ) || '' === $content ) {
			return $content;
		}
		// These codes are HTML/JSON-safety escapes added by serialize_block_attributes().
		// Converting them to literal chars would produce invalid JSON inside block comments.
		$preserve = array( '0022', '003c', '003e', '0026', '005c' );
		$content   = preg_replace_callback(
			'/\\\\u([0-9a-fA-F]{4})/',
			function ( $match ) use ( $preserve ) {
				if ( in_array( strtolower( $match[1] ), $preserve, true ) ) {
					return $match[0]; // Keep the \\uXXXX escape as-is.
				}
				return html_entity_decode(
					mb_convert_encoding(
						pack( 'H*', $match[1] ),
						'UTF-8',
						'UCS-2BE'
					),
					ENT_QUOTES,
					'UTF-8'
				);
			},
			$content
		);
		return $content;
	}

	/**
	 * Collect all Elementor widget types from content recursively.
	 *
	 * @param array $elements Elementor elements array.
	 * @return array Unique widget type names (e.g., ['tp-heading-title', 'tp-tabs-tours']).
	 */
	protected function collect_elementor_widgets( array $elements ) {
		$widgets = array();

		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) ) {
				continue;
			}
			if ( isset( $element['elType'] ) && 'widget' === $element['elType'] && ! empty( $element['widgetType'] ) ) {
				// $widgets[] = $element['widgetType'];

				$widget_slug_map = array(
					'tp-mailchimp-subscribe' => 'tp_mailchimp',
				);
				
				$widgets[] = $widget_slug_map[ $element['widgetType'] ] ?? $element['widgetType'];
			}

			if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
				$widgets = array_merge( $widgets, $this->collect_elementor_widgets( $element['elements'] ) );
			}
		}

		return array_unique( $widgets );
	}

	/**
	 * Collect all Gutenberg block names from content recursively.
	 *
	 * @param array $blocks Parsed blocks array.
	 * @return array Unique block names (e.g., ['tpgb/tp-heading', 'tpgb/tp-container']).
	 */
	protected function collect_gutenberg_blocks( array $blocks ) {
		$block_names = array();

		foreach ( $blocks as $block ) {
			if ( ! empty( $block['blockName'] ) ) {
				$block_names[] = $block['blockName'];
			}

			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$block_names = array_merge( $block_names, $this->collect_gutenberg_blocks( $block['innerBlocks'] ) );
			}
		}

		return array_unique( $block_names );
	}

	/**
	 * Collect widgets from all stored replacement files (pages, navbar, footer, etc.).
	 *
	 * @param array $files Map of filename => decoded JSON.
	 * @return array Unique widget type names.
	 */
	protected function collect_all_widgets_from_files( array $files ) {
		$all_widgets = array();

		foreach ( $files as $filename => $data ) {
			// Kit/globals JSON is not page content; scanning it can error on non-page shapes.
			if ( in_array( strtolower( (string) $filename ), array( 'globals.json', 'uichemy-globals.json' ), true ) ) {
				continue;
			}
			$content = $this->extract_elementor_content( $data );
			if ( $content && is_array( $content ) ) {
				$widgets     = $this->collect_elementor_widgets( $content );
				$all_widgets = array_merge( $all_widgets, $widgets );
			}
		}

		return array_unique( $all_widgets );
	}

	/**
	 * Collect TPAE extension slugs implied by Elementor settings (matches WDesignKit get_widget_list / template_card.js).
	 *
	 * @param array $elements Elementor elements tree.
	 * @return array Unique extension slugs (e.g. plus_section_column_link).
	 */
	protected function collect_tpae_extensions_from_elements( array $elements ) {
		/*
		 * Map: settings key => extension slug(s).
		 * A key is considered "used" when it is present and non-empty in element settings.
		 * Keys and their corresponding extensions were derived from inspecting real Elementor
		 * template JSON files (footer.json, navbar.json, Services.json).
		 */
		$simple_map = array(
			// Section / column structural extensions.
			'sc_link_switch'                      => array( 'plus_section_column_link' ),
			'seh_switch'                           => array( 'plus_equal_height' ),
			'scwbf_options'                        => array( 'plus_glass_morphism' ),
			'tp_col_sticky'                        => array( 'column_sticky' ),
			'tp_col_order_sort'                    => array( 'order_sort_column' ),
			'tp_col_mouse_cursor'                  => array( 'column_mouse_cursor' ),
			'tp_col_custom_width'                  => array( 'custom_width_column' ),
			'plus_cross_domains'                   => array( 'plus_cross_cp' ),
			// CSS & display extensions.
			'tp_section_custom_css'                => array( 'section_custom_css' ),
			'tp_col_custom_css'                    => array( 'column_custom_css' ),
			'tp_custom_css'                        => array( 'plus_custom_css' ),
			'tp_display_rules'                     => array( 'plus_display_rules' ),
			// Animation / motion extensions.
			'eventRepeater'                        => array( 'plus_event_tracker' ),
			'MSFrame'                              => array( 'plus_magic_scroll' ),
			'plus_tilt_opt_tilt_easing_custom'     => array( 'plus_tilt_parallax' ),
			'tp_mouse_move_opt'                    => array( 'plus_mouse_move_parallax' ),
			'plus_overlay_type'                    => array( 'plus_overlay_effect' ),
			'plus_continuous_type'                 => array( 'plus_continuous_animation' ),
			// Tooltip.
			'plus_tooltip_content_desc'            => array( 'plus_tooltip' ),
			// Advanced shadow.
			'adv_shadow_boxshadow'                 => array( 'plus_adv_shadow' ),
			// Global presets detected directly on settings keys.
			'_box_shadow_tp_bs_global_preset'      => array( 'plus_global_box_shadow' ),
			'_gradient_color_tp_gc_global_preset'  => array( 'plus_global_gradient_color' ),
			'button_global_style_preset'           => array( 'plus_global_button' ),
			'tp_select_global_animation'           => array( 'plus_global_scroll_animation' ),
		);

		$extensions = array();

		foreach ( $elements as $element ) {
			if ( ! is_array( $element ) ) {
				continue;
			}
			$settings = isset( $element['settings'] ) && is_array( $element['settings'] ) ? $element['settings'] : array();

			// Simple key-presence checks.
			foreach ( $simple_map as $key => $slugs ) {
				if ( ! empty( $settings[ $key ] ) ) {
					$extensions = array_merge( $extensions, $slugs );
				}
			}

			// GSAP animation type (non-empty / not 'none') → all three scroll-animation extensions.
			if (
				! empty( $settings['plus_gsap_animation_type'] ) &&
				'none' !== $settings['plus_gsap_animation_type']
			) {
				$extensions[] = 'plus_adv_scroll_interactions';
				$extensions[] = 'plus_text_global_animation';
				$extensions[] = 'plus_image_global_animation';
			}

			// Global dimensions: tp_global_preset key inside any dimension / border value object.
			foreach ( $settings as $val ) {
				if ( is_array( $val ) && ! empty( $val['tp_global_preset'] ) ) {
					$extensions[] = 'plus_global_dimensions';
					break;
				}
			}

			// form_button_style_type === 'global' also signals plus_global_button.
			if ( isset( $settings['form_button_style_type'] ) && 'global' === $settings['form_button_style_type'] ) {
				$extensions[] = 'plus_global_button';
			}

			// Recurse into nested elements.
			if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
				$extensions = array_merge( $extensions, $this->collect_tpae_extensions_from_elements( $element['elements'] ) );
			}
		}

		return array_unique( $extensions );
	}

	/**
	 * Collect TPAE extension slugs from globals.json (The Plus kit globals).
	 *
	 * @param array $globals Decoded globals.json.
	 * @return array Extension slugs (non-unique; caller may merge and unique).
	 */
	protected function collect_tpae_extensions_from_globals( array $globals ) {
		$map        = array(
			'global_button_styles'     => 'plus_global_button',
			'global_dimensions'        => 'plus_global_dimensions',
			'global_box_shadows'       => 'plus_global_box_shadow',
			'global_gsap_scroll'       => 'plus_adv_scroll_interactions',
			'global_scroll_animations' => 'plus_global_scroll_animation',
		);
		$extensions = array();
		foreach ( $map as $key => $slug ) {
			if ( ! empty( $globals[ $key ] ) && is_array( $globals[ $key ] ) ) {
				$extensions[] = $slug;
			}
		}
		return $extensions;
	}

	/**
	 * Collect TPAE extensions from all stored replacement Elementor files.
	 *
	 * @param array $files Map of filename => decoded JSON.
	 * @return array Unique extension slugs.
	 */
	protected function collect_all_tpae_extensions_from_files( array $files ) {
		// Return cached result if already computed this request — avoids scanning
		// all 20+ files once per page during a full import run.
		if ( null !== $this->tpae_extensions_cache ) {
			return $this->tpae_extensions_cache;
		}

		$all          = array();
		$has_blog     = false;
		$blog_files   = array( 'blog.json', 'blog detail page.json', 'blog-post-content.json' );

		foreach ( $files as $filename => $data ) {
			$filename_lower = strtolower( (string) $filename );

			if ( in_array( $filename_lower, $blog_files, true ) ) {
				$has_blog = true;
			}

			if ( 'globals.json' === $filename_lower ) {
				if ( is_array( $data ) ) {
					$all = array_merge( $all, $this->collect_tpae_extensions_from_globals( $data ) );
				}
				continue;
			}
			if ( 'uichemy-globals.json' === $filename_lower ) {
				continue;
			}
			$content = $this->extract_elementor_content( $data );
			if ( $content && is_array( $content ) ) {
				$all = array_merge( $all, $this->collect_tpae_extensions_from_elements( $content ) );
			}
		}

		// Enable dynamic tag extension whenever blog pages are present.
		if ( $has_blog ) {
			$all[] = 'plus_dynamic_tag';
		}

		$this->tpae_extensions_cache = array_unique( $all );
		return $this->tpae_extensions_cache;
	}

	/**
	 * Collect Gutenberg extra slugs (tp_extra_option) from a parsed block tree.
	 *
	 * Mirrors collect_tpae_extensions_from_elements() for the Gutenberg builder.
	 *
	 * @param array $blocks Parsed Gutenberg blocks (from parse_blocks).
	 * @return array Unique extra slugs (e.g. 'tp-equal-height', 'tp-gsap-animation').
	 */
	protected function collect_gutenberg_extras( array $blocks ) {
		$extras = array();
		foreach ( $blocks as $block ) {
			if ( ! is_array( $block ) ) {
				continue;
			}
			$attrs = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
			if ( ! empty( $attrs['tpgbEqualHeight'] ) ) {
				$extras[] = 'tp-equal-height';
			}
			if ( ! empty( $attrs['plus_gsap_animation_type'] ) && 'none' !== $attrs['plus_gsap_animation_type'] ) {
				$extras[] = 'tp-gsap-animation';
			}
			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$extras = array_merge( $extras, $this->collect_gutenberg_extras( $block['innerBlocks'] ) );
			}
		}
		return array_unique( $extras );
	}

	/**
	 * Collect Gutenberg extras from all replacement files (page overrides + blog posts).
	 *
	 * @param array $files Map of filename => decoded JSON.
	 * @return array Unique extra slugs.
	 */
	protected function collect_all_gutenberg_extras_from_files( array $files ) {
		$all = array();
		if ( ! function_exists( 'parse_blocks' ) ) {
			return $all;
		}
		foreach ( $files as $filename => $data ) {
			if ( $this->is_gutenberg_replacement_data( $data ) ) {
				$parsed = parse_blocks( $this->replace_unicode_glitch( $data['markup'] ) );
				$all    = array_merge( $all, $this->collect_gutenberg_extras( $parsed ) );
				continue;
			}
			// blog-post-content.json.
			if ( strtolower( (string) $filename ) === 'blog-post-content.json' && is_array( $data ) ) {
				$posts = isset( $data['posts'] ) && is_array( $data['posts'] ) ? $data['posts'] : array();
				foreach ( $posts as $post_data ) {
					$content = isset( $post_data['content'] ) && is_array( $post_data['content'] ) ? $post_data['content'] : array();
					if ( ! empty( $content ) ) {
						$all = array_merge( $all, $this->collect_gutenberg_extras( $content ) );
					}
				}
			}
		}
		return array_unique( $all );
	}

	/**
	 * Enable Gutenberg extras (tp_extra_option) in tpgb_normal_blocks_opts.
	 *
	 * @param array $extras Extra slugs (e.g. ['tp-equal-height', 'tp-gsap-animation']).
	 * @return array Result.
	 */
	protected function enable_gutenberg_extras( array $extras ) {
		$extras = array_values( array_unique( array_filter( array_map( 'sanitize_text_field', $extras ) ) ) );
		if ( empty( $extras ) ) {
			return array(
				'success' => true,
				'message' => __( 'No Gutenberg extras to enable', 'uichemy' ),
			);
		}
		$opt                     = get_option( 'tpgb_normal_blocks_opts', array() );
		$opt                     = is_array( $opt ) ? $opt : array();
		$current                 = isset( $opt['tp_extra_option'] ) && is_array( $opt['tp_extra_option'] ) ? $opt['tp_extra_option'] : array();
		$opt['tp_extra_option']  = array_values( array_unique( array_merge( $current, $extras ) ) );
		update_option( 'tpgb_normal_blocks_opts', $opt );
		return array(
			'success' => true,
			'message' => 'success',
		);
	}

	/**
	 * Generate the CSS equivalent of the JS Yo() function from TPGB blocks.js.
	 * Produces :root CSS variables + @media rules for tpgb-nxtcont-type containers.
	 *
	 * @param int    $desktop_px Desktop max-width in px (default 1240).
	 * @param int    $tablet_px  Tablet max-width in px (default 960).
	 * @param string $mobile_px  Mobile max-width in px (empty = not set).
	 * @return string Generated CSS string.
	 */
	protected function generate_tpgb_nxtcont_global_css( $desktop_px = 1240, $tablet_px = 960, $mobile_px = '' ) {
		$root_vars = '';
		$media_css  = '';

		$wide_selectors = implode( ',', array(
			'.tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
			'#nxt-header .tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
			'#nxt-footer .tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
		) );
		$full_selectors = implode( ',', array(
			'.tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
			'#nxt-header .tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
			'#nxt-footer .tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
		) );

		if ( ! empty( $desktop_px ) ) {
			$root_vars .= '--tpgb-container-md:' . (int) $desktop_px . 'px !important;';
			$media_css .= '@media (min-width:1200px){';
			$media_css .= $wide_selectors . '{max-width:' . (int) $desktop_px . 'px;--tpgb-container-md:' . (int) $desktop_px . 'px;}';
			$media_css .= $full_selectors . '{--tpgb-container-md:' . (int) $desktop_px . 'px;}';
			$media_css .= '}';
		}

		if ( ! empty( $tablet_px ) ) {
			$wide_sm = implode( ',', array(
				'.tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
				'#nxt-header .tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
				'#nxt-footer .tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
			) );
			$full_sm = implode( ',', array(
				'.tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
				'#nxt-header .tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
				'#nxt-footer .tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
			) );
			$root_vars .= '--tpgb-container-sm:' . (int) $tablet_px . 'px !important;';
			$media_css .= '@media (min-width:992px){';
			$media_css .= $wide_sm . '{max-width:' . (int) $tablet_px . 'px;--tpgb-container-sm:' . (int) $tablet_px . 'px;}';
			$media_css .= $full_sm . '{--tpgb-container-sm:' . (int) $tablet_px . 'px;}';
			$media_css .= '}';
		}

		if ( ! empty( $mobile_px ) ) {
			$wide_xs = implode( ',', array(
				'.tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
				'#nxt-header .tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
				'#nxt-footer .tpgb-container-row.tpgb-container-wide.alignwide.tpgb-nxtcont-type',
			) );
			$full_xs = implode( ',', array(
				'.tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
				'#nxt-header .tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
				'#nxt-footer .tpgb-container-row.tpgb-container-wide.alignfull.tpgb-nxtcont-type',
			) );
			$root_vars .= '--tpgb-container-xs:' . (int) $mobile_px . 'px !important;';
			$media_css .= '@media (min-width:768px){';
			$media_css .= $wide_xs . '{max-width:' . (int) $mobile_px . 'px;--tpgb-container-xs:' . (int) $mobile_px . 'px;}';
			$media_css .= $full_xs . '{--tpgb-container-xs:' . (int) $mobile_px . 'px;}';
			$media_css .= '}';
		}

		$root = ( '' !== $root_vars ) ? ':root{' . $root_vars . '}' : '';
		return $root . $media_css;
	}

	/**
	 * Generate and persist TPGB global container CSS (nxtcont-type breakpoints).
	 * Merges into the existing _tpgb_global_css option, writes plus-global.css,
	 * updates _tpgb_global_css_version, and stores globalContainer in tpgb_global_options.
	 *
	 * @param int    $desktop_px Desktop max-width (default 1240).
	 * @param int    $tablet_px  Tablet max-width (default 960).
	 * @param string $mobile_px  Mobile max-width (empty = not set).
	 */
	protected function write_tpgb_global_container_css( $desktop_px = 1240, $tablet_px = 960, $mobile_px = '' ) {
		$container_css = $this->generate_tpgb_nxtcont_global_css( $desktop_px, $tablet_px, $mobile_px );
		if ( '' === $container_css ) {
			return;
		}

		// Merge with existing global CSS (preserve colors/fonts already saved).
		$existing = get_option( '_tpgb_global_css', array() );
		$existing = is_array( $existing ) ? $existing : array();
		$prev_css  = isset( $existing['css'] ) ? (string) $existing['css'] : '';
		$font_link = isset( $existing['font_link'] ) ? (string) $existing['font_link'] : '';

		// Remove any previously generated nxtcont-type container CSS block so we don't duplicate.
		$prev_css = preg_replace( '/:root\{[^}]*--tpgb-container-[^}]+\}/', '', $prev_css );
		$prev_css = preg_replace( '/@media\s*\([^)]+\)\s*\{[^{}]*tpgb-nxtcont-type[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/', '', $prev_css );

		$merged_css = trim( $prev_css ) . "\n" . $container_css;

		update_option( '_tpgb_global_css', array( 'css' => $merged_css, 'font_link' => $font_link ), false );
		update_option( '_tpgb_global_css_version', time(), false );

		// Write plus-global.css file.
		$upload_dir = wp_upload_dir();
		if ( empty( $upload_dir['error'] ) ) {
			$dir = trailingslashit( $upload_dir['basedir'] ) . 'theplus_gutenberg/';
			if ( wp_mkdir_p( $dir ) ) {
				global $wp_filesystem;
				if ( empty( $wp_filesystem ) ) {
					require_once ABSPATH . '/wp-admin/includes/file.php';
					WP_Filesystem( false, $upload_dir['basedir'], true );
				}
				if ( ! empty( $wp_filesystem ) ) {
					$wp_filesystem->put_contents( $dir . 'plus-global.css', $merged_css );
				}
			}
		}

		// Update tpgb_global_options so the editor reflects the correct container width.
		// The option is stored as a JSON-encoded string — always decode/re-encode to avoid
		// destroying preset data already written by apply_globals_to_tpgb_block_editor()
		// (those preset names come from the export JSON, not from this plugin).
		$raw_opts    = get_option( 'tpgb_global_options', false );
		$global_opts = $this->decode_tpgb_global_options_value( $raw_opts );
		$global_opts['globalContainer'] = array(
			'md'   => $desktop_px,
			'sm'   => $tablet_px,
			'xs'   => $mobile_px,
			'unit' => 'px',
		);
		update_option( 'tpgb_global_options', wp_json_encode( $global_opts ), false );
	}

	/**
	 * Collect Gutenberg block names from URL-override / markup payloads in replacement files.
	 *
	 * @param array $files Map of filename => decoded JSON.
	 * @return array Unique block names.
	 */
	protected function collect_gutenberg_blocks_from_replacement_files( array $files ) {
		$all_blocks = array();
		if ( ! function_exists( 'parse_blocks' ) ) {
			return $all_blocks;
		}
		foreach ( $files as $data ) {
			if ( ! $this->is_gutenberg_replacement_data( $data ) ) {
				continue;
			}
			$parsed     = parse_blocks( $this->replace_unicode_glitch( $data['markup'] ) );
			$all_blocks = array_merge( $all_blocks, $this->collect_gutenberg_blocks( $parsed ) );
		}
		return array_unique( $all_blocks );
	}

	/**
	 * Collect Gutenberg blocks from blog-post-content.json posts.
	 *
	 * @param array $files Map of filename => decoded JSON.
	 * @return array Unique block names (tpgb/* blocks).
	 */
	protected function collect_all_blocks_from_files( array $files ) {
		$all_blocks = array();

		$filename = $this->find_file_key( $files, 'blog-post-content.json' );
		if ( null === $filename || ! isset( $files[ $filename ] ) ) {
			return $all_blocks;
		}

		$data  = $files[ $filename ];
		$posts = isset( $data['posts'] ) && is_array( $data['posts'] ) ? $data['posts'] : array();

		foreach ( $posts as $post_data ) {
			$content = isset( $post_data['content'] ) && is_array( $post_data['content'] ) ? $post_data['content'] : array();
			if ( ! empty( $content ) ) {
				$blocks     = $this->collect_gutenberg_blocks( $content );
				$all_blocks = array_merge( $all_blocks, $blocks );
			}
		}

		return array_unique( $all_blocks );
	}

	/**
	 * Run TPAE unused-widget scan (same as TPAE dashboard tpae_get_elements_status_scan).
	 *
	 * @return mixed Scan output from The Plus Addons, or null if the plugin is not active.
	 */
	protected function run_tpae_unused_widgets_scan() {
		if ( ! has_filter( 'tpae_widget_scan' ) ) {
			return null;
		}

		$type = array( 'get_unused_widgets' );

		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Third-party (The Plus Addons) integration hook; the name is owned by that plugin and must not be prefixed.
		return apply_filters( 'tpae_widget_scan', $type );
	}

	/**
	 * Enable TPAE widgets using WDesignKit hook.
	 *
	 * @param array $widget_list    Array of widget type names.
	 * @param array $extensions_list Array of extension names (optional).
	 * @return array Result with success status.
	 */
	protected function enable_tpae_widgets( array $widget_list, array $extensions_list = array() ) {
		if ( ! has_filter( 'tpae_enable_selected_widgets' ) ) {
			return array(
				'success'     => false,
				'message'     => __( 'The Plus Addons for Elementor not active', 'uichemy' ),
				'description' => __( 'TPAE plugin is required to enable widgets', 'uichemy' ),
			);
		}

		if ( empty( $widget_list ) ) {
			return array(
				'success' => true,
				'message' => __( 'No widgets to enable', 'uichemy' ),
			);
		}

		$w_list = array(
			'widgets'    => $widget_list,
			'extensions' => $extensions_list,
		);

		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Third-party (The Plus Addons) integration hook; the name is owned by that plugin and must not be prefixed.
		return apply_filters( 'tpae_enable_selected_widgets', $w_list );
	}

	/**
	 * Enable Nexter blocks via nexter_block_list_merge hook when available; else update option directly.
	 *
	 * @param array $block_names Block names (e.g. ['tpgb/tp-video']).
	 * @return array Result.
	 */
	protected function enable_nexter_blocks( array $block_names ) {
		$tpgb = array_filter(
			$block_names,
			function ( $n ) {
				return strpos( $n, 'tpgb/' ) === 0;
			}
		);
		if ( empty( $tpgb ) ) {
			return array(
				'success' => true,
				'message' => __( 'No Nexter blocks to enable', 'uichemy' ),
			);
		}

		$block_ids = array_unique(
			array_map(
				'sanitize_text_field',
				array_map(
					function ( $n ) {
						return ( strpos( $n, 'tpgb/' ) === 0 ) ? substr( $n, 5 ) : $n;
					},
					array_values( $tpgb )
				)
			)
		);

		if ( has_filter( 'nexter_block_list_merge' ) ) {
			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Third-party (Nexter Blocks) integration hook; the name is owned by that plugin and must not be prefixed.
			return apply_filters( 'nexter_block_list_merge', $block_ids );
		}

		$opt                         = get_option( 'tpgb_normal_blocks_opts', array() );
		$opt                         = is_array( $opt ) ? $opt : array();
		$opt['enable_normal_blocks'] = array_unique(
			array_merge(
				isset( $opt['enable_normal_blocks'] ) && is_array( $opt['enable_normal_blocks'] ) ? $opt['enable_normal_blocks'] : array(),
				$block_ids
			)
		);
		update_option( 'tpgb_normal_blocks_opts', $opt );

		if ( in_array( 'tp-google-map', $block_ids, true ) ) {
			$conn = get_option( 'tpgb_connection_data', array() );
			if ( is_array( $conn ) && ( ! isset( $conn['gmap_api_switch'] ) || 'disable' === $conn['gmap_api_switch'] ) ) {
				$conn['gmap_api_switch'] = 'enable';
				update_option( 'tpgb_connection_data', $conn );
			}
		}

		return array(
			'success' => true,
			'message' => 'success',
		);
	}

	/**
	 * Enable widgets for a single file (used by rest_import_single_page).
	 *
	 * @param mixed $data Decoded JSON data for a single file.
	 * @return array Result with widget enable status.
	 */
	public function enable_widgets_for_single_file( $data ) {
		if ( $this->is_gutenberg_replacement_data( $data ) ) {
			if ( ! function_exists( 'parse_blocks' ) ) {
				return array(
					'success' => true,
					'message' => 'parse_blocks unavailable',
					'widgets' => array(),
				);
			}
			$parsed = parse_blocks( $this->replace_unicode_glitch( $data['markup'] ) );
			$names  = $this->collect_gutenberg_blocks( $parsed );
			if ( ! empty( $names ) ) {
				$this->enable_nexter_blocks( $names );
			}
			$extras = $this->collect_gutenberg_extras( $parsed );
			if ( ! empty( $extras ) ) {
				$this->enable_gutenberg_extras( $extras );
			}
			return array(
				'success' => true,
				'message' => 'Gutenberg blocks',
				'widgets' => array(),
			);
		}

		$content = $this->extract_elementor_content( $data );
		if ( ! $content || ! is_array( $content ) ) {
			return array(
				'success' => true,
				'message' => 'No Elementor content found',
				'widgets' => array(),
			);
		}

		$widgets = $this->collect_elementor_widgets( $content );
		if ( empty( $widgets ) ) {
			return array(
				'success' => true,
				'message' => 'No widgets found to enable',
				'widgets' => array(),
			);
		}

		// Also collect extensions stored across ALL replacement files so per-page
		// imports get the full extension list (not just what this one page uses).
		$stored_files = get_option( self::OPTION_REPLACEMENT_DATA, array() );
		$extensions   = is_array( $stored_files ) && ! empty( $stored_files )
			? $this->collect_all_tpae_extensions_from_files( $stored_files )
			: $this->collect_tpae_extensions_from_elements( $content );

		$result = $this->enable_tpae_widgets( $widgets, $extensions );

		return array(
			'success'          => ! empty( $result['success'] ),
			'message'          => isset( $result['message'] ) ? $result['message'] : '',
			'widgets'          => $widgets,
			'extensions'       => $extensions,
			'tpae_widget_scan' => $this->run_tpae_unused_widgets_scan(),
		);
	}

	/**
	 * Enable widgets and blocks from imported files using WDesignKit hooks.
	 *
	 * @param array $files Map of filename => decoded JSON.
	 * @return array Result with widget/block enable status.
	 */
	public function enable_widgets_from_files( array $files ) {
		$result = array(
			'widgets' => array(
				'success' => true,
				'message' => '',
				'list'    => array(),
			),
			'blocks'  => array(
				'success' => true,
				'message' => '',
				'list'    => array(),
			),
		);

		// Enable Elementor (TPAE) widgets.
		$widgets    = $this->collect_all_widgets_from_files( $files );
		$extensions = $this->collect_all_tpae_extensions_from_files( $files );
		if ( ! empty( $widgets ) ) {
			$widgets_result    = $this->enable_tpae_widgets( $widgets, $extensions );
			$result['widgets'] = array(
				'success'    => ! empty( $widgets_result['success'] ),
				'message'    => isset( $widgets_result['message'] ) ? $widgets_result['message'] : '',
				'list'       => $widgets,
				'extensions' => $extensions,
			);
		}

		// Enable Gutenberg (Nexter) blocks from blog posts and from Gutenberg URL page overrides.
		$blocks = array_unique(
			array_merge(
				$this->collect_all_blocks_from_files( $files ),
				$this->collect_gutenberg_blocks_from_replacement_files( $files )
			)
		);
		if ( ! empty( $blocks ) ) {
			$blocks_result    = $this->enable_nexter_blocks( $blocks );
			$result['blocks'] = array(
				'success' => ! empty( $blocks_result['success'] ),
				'message' => isset( $blocks_result['message'] ) ? $blocks_result['message'] : '',
				'list'    => $blocks,
			);
		}

		// Enable Gutenberg extras (tp-equal-height, tp-gsap-animation, etc.).
		$gutenberg_extras = $this->collect_all_gutenberg_extras_from_files( $files );
		if ( ! empty( $gutenberg_extras ) ) {
			$this->enable_gutenberg_extras( $gutenberg_extras );
		}

		$result['tpae_widget_scan'] = $this->run_tpae_unused_widgets_scan();

		return $result;
	}

	/**
	 * Walk parsed blocks and sideload the logo image for tpgb/tp-site-logo blocks.
	 *
	 * The block stores the source-site attachment ID in imageStore.id / svgStore.id.
	 * After a simple URL string-replace those IDs remain stale, causing the block renderer
	 * to call wp_get_attachment_url() with a non-existent ID and produce a broken src.
	 * This method sideloads the logo into the local media library and rewrites both the
	 * URL strings and the attachment ID so the block renders correctly after import.
	 *
	 * @param array $blocks Parsed blocks (from parse_blocks).
	 * @return array Blocks with tp-site-logo attachment IDs and URLs updated.
	 */
	protected function resolve_site_logo_blocks( array $blocks ): array {
		foreach ( $blocks as &$block ) {
			if ( isset( $block['blockName'] ) && 'tpgb/tp-site-logo' === $block['blockName'] ) {
				$block = $this->process_site_logo_block( $block );
			}
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->resolve_site_logo_blocks( $block['innerBlocks'] );
			}
		}
		return $blocks;
	}

	/**
	 * Sideload the logo image and update attachment ID + URL fields for a tp-site-logo block.
	 *
	 * @param array $block Parsed block array.
	 * @return array Updated block.
	 */
	private function process_site_logo_block( array $block ): array {
		$attrs = isset( $block['attrs'] ) ? $block['attrs'] : array();

		// Prefer svgStore URL for SVG logos; fall back to imageStore URL.
		$logo_url = '';
		if ( ! empty( $attrs['svgStore']['url'] ) ) {
			$logo_url = $attrs['svgStore']['url'];
		} elseif ( ! empty( $attrs['imageStore']['url'] ) ) {
			$logo_url = $attrs['imageStore']['url'];
		}

		if ( ! $logo_url || ! $this->is_remote_image( $logo_url ) ) {
			return $block;
		}

		$result = $this->import_asset( $logo_url );
		if ( ! $result ) {
			return $block;
		}

		$local_id  = $result['id'];
		$local_url = $result['url'];

		// Update svgStore.
		if ( isset( $block['attrs']['svgStore'] ) ) {
			$block['attrs']['svgStore']['id']  = $local_id;
			$block['attrs']['svgStore']['url'] = $local_url;
			if ( isset( $block['attrs']['svgStore']['sizes']['full']['url'] ) ) {
				$block['attrs']['svgStore']['sizes']['full']['url'] = $local_url;
			}
		}

		// Replace imageStore with a slim version containing only rendering-relevant fields.
		// The original imageStore carries editor-only metadata (compat HTML, nonces, editLink,
		// uploadedToLink, etc.) that, when JSON-encoded in the block comment, creates complex
		// escaped HTML sequences. After replace_unicode_glitch converts \uXXXX back to literal
		// chars, subsequent parse_blocks calls fail to decode the block attrs, stripping them
		// entirely. Keeping only the fields TPGB's render_callback actually uses avoids this.
		if ( isset( $block['attrs']['imageStore'] ) ) {
			$old = $block['attrs']['imageStore'];
			$w   = isset( $old['width'] ) ? (int) $old['width'] : 0;
			$h   = isset( $old['height'] ) ? (int) $old['height'] : 0;
			$block['attrs']['imageStore'] = array(
				'id'          => $local_id,
				'url'         => $local_url,
				'alt'         => isset( $old['alt'] ) ? (string) $old['alt'] : '',
				'title'       => isset( $old['title'] ) ? (string) $old['title'] : '',
				'mime'        => isset( $old['mime'] ) ? (string) $old['mime'] : 'image/svg+xml',
				'type'        => isset( $old['type'] ) ? (string) $old['type'] : 'image',
				'subtype'     => isset( $old['subtype'] ) ? (string) $old['subtype'] : 'svg+xml',
				'width'       => $w,
				'height'      => $h,
				'orientation' => isset( $old['orientation'] ) ? (string) $old['orientation'] : 'landscape',
				'image'       => array( 'src' => $local_url, 'width' => $w, 'height' => $h ),
				'thumb'       => array( 'src' => $local_url, 'width' => $w, 'height' => $h ),
				'sizes'       => array(
					'full' => array(
						'url'         => $local_url,
						'height'      => $h,
						'width'       => $w,
						'orientation' => isset( $old['orientation'] ) ? (string) $old['orientation'] : 'landscape',
					),
				),
			);
		}

		return $block;
	}
}