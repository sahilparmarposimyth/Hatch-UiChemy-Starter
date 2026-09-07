<?php
/**
 * Settings + option getters for the new dashboard.
 *
 * Centralises every option key used by the new dashboard so feature code
 * never reads/writes options directly. Add a getter here when you add a
 * new piece of dashboard state.
 *
 * Option keys (all prefixed `uich_nd_`):
 *   uich_nd_builder       — selected page builder slug.
 *   uich_nd_mode          — 'figma' | 'compose'.
 *   uich_nd_onboarded     — '1' once wizard finishes.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Settings' ) ) {

	final class Uich_ND_Settings {

		const OPT_BUILDER   = 'uich_nd_builder';
		const OPT_MODE      = 'uich_nd_mode';
		const OPT_ONBOARDED = 'uich_nd_onboarded';

		const BUILDERS = array( 'elementor', 'bricks', 'gutenberg' );

		/**
		 * Import modes, matching `MODES` in new-dashboard/src/dashboard/modes.js.
		 *
		 * 'scratch' is the AI Website Creator. It was listed on the React side
		 * before its screen existed, but never here — so while it was a
		 * coming-soon card that mismatch was invisible, and the moment the flow
		 * went live picking it would have failed validation on write and been
		 * read back as ''. Both lists have to carry every selectable mode.
		 */
		const MODES = array( 'figma', 'compose', 'scratch' );

		public static function boot() {
			// No hooks yet. REST routes for read/write live in Uich_ND_Api.
		}

		public static function get_builder() {
			$v = (string) get_option( self::OPT_BUILDER, '' );
			return in_array( $v, self::BUILDERS, true ) ? $v : '';
		}

		public static function set_builder( $v ) {
			$v = sanitize_key( (string) $v );
			if ( ! in_array( $v, self::BUILDERS, true ) ) {
				return false;
			}
			return update_option( self::OPT_BUILDER, $v );
		}

		public static function get_mode() {
			$v = (string) get_option( self::OPT_MODE, '' );
			return in_array( $v, self::MODES, true ) ? $v : '';
		}

		public static function set_mode( $v ) {
			$v = sanitize_key( (string) $v );
			if ( ! in_array( $v, self::MODES, true ) ) {
				return false;
			}
			return update_option( self::OPT_MODE, $v );
		}

		public static function is_onboarded() {
			// Dev toggle in class-uich-nd-loader.php:
			// UICH_ND_ONBOARDING_PERSIST = false → har refresh pe wizard.
			if ( defined( 'UICH_ND_ONBOARDING_PERSIST' ) && false === UICH_ND_ONBOARDING_PERSIST ) {
				return false;
			}
			return '1' === (string) get_option( self::OPT_ONBOARDED, '0' );
		}

		public static function set_onboarded( $done = true ) {
			return update_option( self::OPT_ONBOARDED, $done ? '1' : '0' );
		}

		/**
		 * Detect which page builders are installed / active on this site.
		 *
		 * @return array { elementor:{installed,active}, bricks:..., gutenberg:... }
		 */
		public static function detect_builders() {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$plugins = get_plugins();

			$elementor_file = 'elementor/elementor.php';
			$bricks_theme   = wp_get_theme( 'bricks' );

			return array(
				'elementor' => array(
					'installed' => isset( $plugins[ $elementor_file ] ),
					'active'    => is_plugin_active( $elementor_file ),
				),
				'bricks'    => array(
					'installed' => $bricks_theme->exists(),
					'active'    => 'bricks' === get_stylesheet(),
				),
				'gutenberg' => array(
					// Core block editor always present on supported WP.
					'installed' => true,
					'active'    => true,
				),
			);
		}

		/**
		 * Locate the installed UiChemy plugin file (folder/main.php).
		 *
		 * Matched by TextDomain / Name rather than a fixed folder path, so it
		 * works regardless of the folder name the install zip unpacks to.
		 *
		 * @return string Plugin file relative to wp-content/plugins, or '' if absent.
		 */
		public static function find_uichemy_file() {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			foreach ( get_plugins() as $file => $data ) {
				$text_domain = isset( $data['TextDomain'] ) ? strtolower( (string) $data['TextDomain'] ) : '';
				$name        = isset( $data['Name'] ) ? strtolower( (string) $data['Name'] ) : '';
				if ( 'uichemy' === $text_domain || 'uichemy' === $name ) {
					return (string) $file;
				}
			}
			return '';
		}

		/**
		 * Raw fetch of the full /plugins/versions payload from the UiChemy API,
		 * with NO persistent cache — memoized only within the current request so
		 * repeated reads on one page load don't refetch. This is what makes a
		 * "check every time" read possible (see get_uichemy_latest).
		 *
		 * @return array  slug => array (e.g. [ 'latest_version' => '1.2.3' ]).
		 */
		private static function fetch_managed_versions_raw() {
			static $memo = null;
			if ( is_array( $memo ) ) {
				return $memo;
			}

			$result = array();

			$base = class_exists( 'Uich_ND_Auth' ) ? Uich_ND_Auth::API_BASE : 'https://core.uichemy.com';
			$url  = rtrim( $base, '/' ) . '/plugins/versions';

			$response = wp_remote_get(
				$url,
				array(
					'timeout' => 10,
					'headers' => array( 'Accept' => 'application/json' ),
				)
			);

			if ( ! is_wp_error( $response ) ) {
				$code = (int) wp_remote_retrieve_response_code( $response );
				if ( $code >= 200 && $code < 300 ) {
					$decoded = json_decode( wp_remote_retrieve_body( $response ), true );
					if ( isset( $decoded['data'] ) && is_array( $decoded['data'] ) ) {
						$result = $decoded['data'];
					}
				}
			}

			$memo = $result;
			return $result;
		}

		/**
		 * Latest versions of every managed plugin (uichemy + the wp.org-hosted
		 * elementor / uichemy / nexter / wp), read fresh from the API. There's NO
		 * WP-side persistent cache — the API already Redis-caches the wp.org
		 * lookups (~1 hr), so a WP transient would only add duplicate staleness.
		 * Memoized per request via fetch_managed_versions_raw().
		 *
		 * @return array  slug => array (e.g. [ 'latest_version' => '1.2.3' ]).
		 */
		public static function get_managed_versions() {
			return self::fetch_managed_versions_raw();
		}

		/**
		 * API-reported latest version for a single wp.org-hosted managed plugin
		 * slug (elementor / uichemy / nexter / wp), or '' if the API has no value.
		 *
		 * @param string $slug
		 * @return string
		 */
		public static function get_managed_latest( $slug ) {
			$all = self::get_managed_versions();
			if ( isset( $all[ $slug ]['latest_version'] ) && '' !== (string) $all[ $slug ]['latest_version'] ) {
				return (string) $all[ $slug ]['latest_version'];
			}
			return '';
		}

		/**
		 * Latest published UiChemy release (version + zip URL). Read FRESH from the
		 * API on every request (no persistent cache) — UiChemy's version is set
		 * manually on the API, so a change must reflect immediately rather than
		 * waiting up to an hour like the wp.org plugins.
		 *
		 * @return array { version:string, zip_url:string }  Empty strings on failure.
		 */
		public static function get_uichemy_latest() {
			$all = self::fetch_managed_versions_raw();
			$p   = isset( $all['uichemy'] ) && is_array( $all['uichemy'] ) ? $all['uichemy'] : array();
			return array(
				'version' => isset( $p['latest_version'] ) ? (string) $p['latest_version'] : '',
				'zip_url' => isset( $p['zip_url'] ) ? (string) $p['zip_url'] : '',
			);
		}

		/**
		 * Latest published UiChemy Pro release (version + zip URL), from the API's
		 * `uichemy_pro` entry. Pro is not on wordpress.org, so that entry is the only
		 * place its version and package live; it is set manually on the API and read
		 * fresh here (no persistent cache) so a release reflects immediately.
		 *
		 * The version is reported through detect_uichemy_pro() for display; the
		 * package itself is fetched through the API's /plugins/uichemy-pro/download
		 * redirect (Uich_ND_Installer::uichemy_pro_zip_url) rather than this zip_url,
		 * so the installer never hardcodes a host.
		 *
		 * @return array { version:string, zip_url:string }  Empty strings on failure.
		 */
		public static function get_uichemy_pro_latest() {
			$all = self::fetch_managed_versions_raw();
			$p   = isset( $all['uichemy_pro'] ) && is_array( $all['uichemy_pro'] ) ? $all['uichemy_pro'] : array();
			return array(
				'version' => isset( $p['latest_version'] ) ? (string) $p['latest_version'] : '',
				'zip_url' => isset( $p['zip_url'] ) ? (string) $p['zip_url'] : '',
			);
		}


		/**
		 * Report the UiChemy (Composer widget + MCP) runtime state to the dashboard.
		 *
		 * UiChemy is BUNDLED — its runtime ships inside this plugin under
		 * uichemy-composer/ (see Uich_Composer_Loader). There is no separate plugin
		 * to find, install, activate or update, so this always reports
		 * installed + active + bundled, which retires every dependent surface at
		 * once with no JS changes:
		 *   • App.jsx's `error:uichemy` full-page gate never triggers
		 *     (it keys off `uichemy.active === false`)
		 *   • the builder step's Continue stops running the install path
		 *     (builderContinueIntent resolves to 'continue')
		 *   • UiChemyUpdateNotice returns null (`update_available` false)
		 *   • BuilderScreen's "Required · UiChemy" card hides itself (`bundled`)
		 *
		 * This used to be conditional on UICH_COMPOSER_MERGED, which was wrong:
		 * that constant is only defined when the merged runtime actually boots,
		 * and Uich_Composer_Loader deliberately stands down (without defining it)
		 * whenever a standalone UiChemy / UiChemy Pro plugin is active. On such a
		 * site detection fell through to hunting for a standalone plugin, matched
		 * the FIRST one whose text domain is `uichemy` — the inactive free copy,
		 * even when Pro was the active one — and reported active:false, which
		 * blocked the entire dashboard behind an "Activate UiChemy" screen for a
		 * plugin that is bundled and cannot be activated separately.
		 *
		 * Shipping the runtime is what makes it installed, so this no longer
		 * depends on load-order or on what else happens to be active.
		 *
		 * @return array { installed:bool, active:bool, bundled:bool, file:string,
		 *                 version:string, latest_version:?string, update_available:bool }
		 */
		public static function detect_uichemy() {
			return array(
				'installed'        => true,
				'active'           => true,
				'bundled'          => true,
				'file'             => '',
				'version'          => defined( 'UICHEMY_VERSION' ) ? (string) UICHEMY_VERSION : UICH_VERSION,
				'latest_version'   => null,
				'update_available' => false,
			);
		}

		/* ---------- UiChemy Pro (separate premium plugin) ---------- */

		/**
		 * Plugin FILE names a UiChemy Pro build ships as.
		 *
		 * Matched on the file's basename rather than a `folder/file.php` slug,
		 * because the folder the zip unpacks to is not guaranteed (it can carry a
		 * version suffix, or be renamed by whoever repackaged it) — the same
		 * reasoning Uich_Composer_Takeover::standalone_plugins() uses.
		 *
		 * Free UiChemy shares the `uichemy` text domain with Pro, so matching on
		 * text domain alone cannot tell them apart; that is exactly the bug called
		 * out in detect_uichemy()'s docblock, where detection picked the inactive
		 * FREE copy while Pro was the active one. Filenames can.
		 *
		 * Extend via the `uich_uichemy_pro_files` filter if a build ever ships
		 * under a different name.
		 *
		 * @return string[]
		 */
		public static function uichemy_pro_files() {
			$files = array( 'uichemy-pro.php' );

			/**
			 * Filter the plugin filenames recognised as UiChemy Pro.
			 *
			 * @param string[] $files Basenames, e.g. 'uichemy-pro.php'.
			 */
			$files = (array) apply_filters( 'uich_uichemy_pro_files', $files );

			return array_values( array_filter( array_map( 'strval', $files ) ) );
		}

		/**
		 * Locate an installed UiChemy Pro plugin.
		 *
		 * Two passes, cheapest first: the filename match above, then a header
		 * fallback for a build whose file was renamed but whose `Name` still says
		 * so. The fallback deliberately requires BOTH the uichemy text domain and
		 * "pro" in the name, so the free copy can never satisfy it.
		 *
		 * @return string Plugin file relative to wp-content/plugins, or '' if absent.
		 */
		public static function find_uichemy_pro_file() {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$plugins   = get_plugins();
			$pro_files = self::uichemy_pro_files();

			foreach ( $plugins as $file => $data ) {
				if ( in_array( basename( (string) $file ), $pro_files, true ) ) {
					return (string) $file;
				}
			}

			foreach ( $plugins as $file => $data ) {
				$domain = isset( $data['TextDomain'] ) ? strtolower( (string) $data['TextDomain'] ) : '';
				$name   = isset( $data['Name'] ) ? strtolower( (string) $data['Name'] ) : '';
				if ( 'uichemy' === $domain && false !== strpos( $name, 'pro' ) ) {
					return (string) $file;
				}
			}

			return '';
		}

		/**
		 * Report the UiChemy Pro state to the dashboard.
		 *
		 * Unlike detect_uichemy(), this is a REAL detection: the free runtime is
		 * bundled inside this plugin, but Pro is a separate premium plugin that
		 * has to be downloaded, installed and activated (see
		 * Uich_ND_Installer::install_uichemy_pro).
		 *
		 * `is_pro` is the answer the UI should actually gate on — it is the same
		 * `uichemy_is_pro()` every Pro feature reads, so it stays true for a site
		 * that unlocks Pro some other way (the UICHEMY_PRO constant, or the
		 * `uich_composer_is_pro` filter) and would otherwise be nagged to install a
		 * plugin it does not need. `installed` / `active` describe the plugin
		 * itself, which is what the install button needs to pick its next step.
		 *
		 * @return array { installed:bool, active:bool, is_pro:bool, file:string,
		 *                 version:string, latest_version:string, update_available:bool,
		 *                 zip_configured:bool }
		 */
		public static function detect_uichemy_pro() {
			if ( ! function_exists( 'is_plugin_active' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$file    = self::find_uichemy_pro_file();
			$active  = '' !== $file && is_plugin_active( $file );
			$version = '';

			// The installed version comes from WordPress' own plugin data (the `Version:`
			// header), NOT from a constant the Pro plugin defines. Same as every other
			// managed plugin here, and it works for an inactive copy too — a constant only
			// exists once that plugin has actually loaded.
			if ( '' !== $file ) {
				$all     = function_exists( 'get_plugins' ) ? get_plugins() : array();
				$version = isset( $all[ $file ]['Version'] ) ? (string) $all[ $file ]['Version'] : '';
			}

			// Latest published Pro version, from the API's `uichemy_pro` entry. Only
			// looked up for a site that HAS Pro installed — an absent plugin has
			// nothing to compare against, and the call is a remote request.
			//
			// `update_available` is actionable: Uich_ND_Installer::install_uichemy_pro()
			// routes to its update branch when this is true, so the WP dashboard's Pro
			// card and the Figma Site Check both get a button that can actually clear
			// the state.
			$latest = '';
			if ( '' !== $file ) {
				$pro_latest = self::get_uichemy_pro_latest();
				$latest     = (string) $pro_latest['version'];
			}
			$update_available = ( '' !== $latest && '' !== $version )
				? version_compare( $version, $latest, '<' )
				: false;

			return array(
				'installed'        => '' !== $file,
				'active'           => $active,
				'is_pro'           => function_exists( 'uichemy_is_pro' ) ? (bool) uichemy_is_pro() : false,
				'file'             => $file,
				'version'          => $version,
				'latest_version'   => $latest,
				'update_available' => $update_available,
				// Lets the UI say "ask your administrator to configure the download"
				// instead of firing a request that can only fail.
				'zip_configured'   => class_exists( 'Uich_ND_Installer' )
					? Uich_ND_Installer::has_uichemy_pro_zip()
					: false,
			);
		}

		/**
		 * Snapshot of the environment for the wizard's Step 0.
		 *
		 * Each field is mirrored by an *_ok boolean so the React side
		 * routes to the right calm-error card without re-running checks.
		 */
		public static function env_check() {
			global $wp_version;

			$required_ext = array( 'json', 'mbstring' );
			$missing_ext  = array_values(
				array_filter(
					$required_ext,
					static function ( $ext ) {
						return ! extension_loaded( $ext ); }
				)
			);

			$memory_raw   = (string) ini_get( 'memory_limit' );
			$memory_bytes = wp_convert_hr_to_bytes( $memory_raw );
			$memory_ok    = $memory_bytes >= ( 128 * 1024 * 1024 );

			return array(
				'wp_version'   => $wp_version,
				// Minimum is 6.9.0, but compare against '6.9': WP reports majors
				// without a patch part, so '6.9.0' would reject 6.9 itself.
				'wp_ok'        => version_compare( $wp_version, '6.9', '>=' ),
				'php_version'  => PHP_VERSION,
				'php_ok'       => version_compare( PHP_VERSION, '7.4', '>=' ),
				'is_admin'     => current_user_can( 'manage_options' ),
				'memory'       => $memory_raw,
				'memory_bytes' => (int) $memory_bytes,
				'memory_ok'    => $memory_ok,
				'missing_ext'  => $missing_ext,
				'ext_ok'       => empty( $missing_ext ),
			);
		}

		/**
		 * Snapshot of connection-time checks (permalinks, REST, site
		 * reachability, app-passwords availability).
		 *
		 * Run at boot so the wizard surfaces the right calm-error card
		 * before the user wastes time clicking through.
		 */
		public static function connection_check() {
			$permalinks_pretty = '' !== get_option( 'permalink_structure' );

			// REST API "disabled" detection — the two common patterns.
			$rest_disabled_plugin = false;
			if ( function_exists( 'is_plugin_active' ) ) {
				$rest_disabled_plugin = is_plugin_active( 'disable-json-api/disable-json-api.php' )
					|| is_plugin_active( 'disable-wp-rest-api/disable-wp-rest-api.php' );
			}
			$rest_filter_blocking = false;
			if ( has_filter( 'rest_authentication_errors' ) ) {
				$saved_user_id = get_current_user_id();
				$probe         = apply_filters( 'rest_authentication_errors', null );
				if ( is_wp_error( $probe ) ) {
					// WordPress core itself hooks this filter (rest_cookie_check_errors).
					// This check runs on a normal admin page load — NOT inside a REST
					// request — so core returns an expected cookie/nonce/not-logged-in
					// error. That does NOT mean REST is blocked, so ignore those codes;
					// only a different error (a plugin hard-disabling REST) counts.
					$expected_codes       = array( 'rest_cookie_invalid_nonce', 'rest_not_logged_in', 'rest_cookie_invalid_token' );
					$rest_filter_blocking = ! in_array( $probe->get_error_code(), $expected_codes, true );
				}
				if ( get_current_user_id() !== $saved_user_id ) {
					wp_set_current_user( $saved_user_id );
				}
			}
			$rest_ok = ! ( $rest_disabled_plugin || $rest_filter_blocking );

			// Reachable: localhost / private IPs / .local TLDs fail
			// reachability from public Figma plugin / MCP servers.
			$host       = (string) wp_parse_url( get_option( 'siteurl' ), PHP_URL_HOST );
			$private_re = '/(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^172\.(1[6-9]|2[0-9]|3[01])\.)|(\.(test|local|localhost)$)/i';
			$reachable  = ! preg_match( $private_re, (string) $host );

			// Honor the actual filtered availability — including our own
			// `wp_is_application_passwords_available` force-override.
			// Using `is_native_site_available()` here temporarily strips
			// the force filter, which made the error screen re-appear
			// even after the user clicked "Enable for my account".
			$app_passwords_ok = function_exists( 'wp_is_application_passwords_available' )
				? (bool) wp_is_application_passwords_available()
				: false;

			// Attribution, only when there is a real block to attribute.
			$blocker = ( ! $app_passwords_ok && class_exists( 'Uich_ND_App_Password' ) )
				? Uich_ND_App_Password::detect_blocker()
				: null;

			return array(
				'permalinks_pretty' => $permalinks_pretty,
				'permalinks_ok'     => $permalinks_pretty,
				'rest_ok'           => $rest_ok,
				'security_blocking' => $blocker,
				'reachable'         => $reachable,
				'reachable_ok'      => $reachable,
				'host'              => $host,
				'app_passwords_ok'  => $app_passwords_ok,
			);
		}

		/**
		 * True when the current request is served from a local host
		 * (localhost / 127.0.0.1 / ::1 / *.local / *.test / *.localhost).
		 */
		public static function is_localhost() {
			// Derive the host from the site's OWN configured URL, not the request
			// Host header ($_SERVER['HTTP_HOST']), which a client can spoof (e.g.
			// `Host: localhost`) to force a localhost verdict. home_url() is
			// admin-set and stable per site.
			$host = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
			if ( '' === $host ) {
				return false;
			}
			return 0 === strpos( $host, 'localhost' )
				|| 0 === strpos( $host, '127.0.0.1' )
				|| 0 === strpos( $host, '[::1]' )
				|| (bool) preg_match( '/\.(local|test|localhost)(:\d+)?$/', $host );
		}

		/**
		 * Read-only snapshot for the dashboard's local-env error card.
		 * No setter — the user edits wp-config.php themselves.
		 *
		 *   available — render the card at all? True for a hostname-detected
		 *               localhost OR any non-SSL (HTTP) site. WordPress blocks
		 *               Application Passwords over HTTP unless the environment
		 *               is 'local'/'development', so the wp-config snippet is
		 *               the fix on every HTTP host — not just *.local / 127.0.0.1
		 *               (covers QA running on a LAN IP or a custom HTTP domain).
		 *   current   — current value of WP_ENVIRONMENT_TYPE
		 *   snippet   — exact line to paste into wp-config.php
		 */
		public static function get_local_env_state() {
			$current = function_exists( 'wp_get_environment_type' )
				? wp_get_environment_type()
				: ( defined( 'WP_ENVIRONMENT_TYPE' ) ? WP_ENVIRONMENT_TYPE : 'production' );
			return array(
				'available' => self::is_localhost() || ! is_ssl(),
				'current'   => (string) $current,
				'snippet'   => "define( 'WP_ENVIRONMENT_TYPE', 'local' );",
			);
		}
	}
}
