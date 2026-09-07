<?php
/**
 * Builder installer / activator for the new dashboard.
 *
 * Drives the wizard's "Install <builder>" affordance:
 *
 *   elementor → install from wordpress.org if missing, then activate.
 *   bricks    → activate the theme if already installed (it's premium,
 *               so we can't pull it from WP repo); otherwise return a
 *               `redirect` action pointing at bricksbuilder.io so the
 *               React side can open the buy page in a new tab.
 *   gutenberg → always present; nothing to do.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Installer' ) ) {

	final class Uich_ND_Installer {

		const ELEMENTOR_FILE      = 'elementor/elementor.php';
		const ELEMENTOR_WPORG_URL = 'https://wordpress.org/plugins/elementor/';
		const BRICKS_BUY_URL      = 'https://bricksbuilder.io/';

		/**
		 * UiChemy install package — resolved from the UiChemy API rather than a
		 * hardcoded URL, so the published zip can move without a plugin update.
		 *
		 * `{API_BASE}/plugins/uichemy/download` 302-redirects to the currently
		 * hosted package; WP's upgrader follows the redirect transparently.
		 * Overridable at runtime via the `uich_uichemy_zip_url` filter.
		 *
		 * @return string
		 */
		private static function uichemy_zip_url() {
			$base = class_exists( 'Uich_ND_Auth' ) ? Uich_ND_Auth::API_BASE : 'http://localhost:8000';
			return rtrim( $base, '/' ) . '/plugins/uichemy/download';
		}

		public static function boot() {
			// Self-heal on every admin request: a site provisioned by seeding
			// `active_plugins` directly (e.g. via REST) never runs Elementor's
			// `register_activation_hook`, so `elementor_active_kit` is never
			// set and Elementor's editor shows its "no default kit" dialog.
			// That dialog's own "Recreate Kit" button just opens Elementor's
			// Tools page in a new tab and doesn't reload the original editor,
			// so proactively repairing the option here is what actually fixes it.
			add_action( 'admin_init', array( __CLASS__, 'ensure_elementor_kit' ) );

			// On-demand class — REST handler in Uich_ND_Api calls install_or_activate.
		}

		/**
		 * @param string $builder One of 'elementor' | 'bricks' | 'gutenberg'.
		 * @return array|WP_Error  { ok, action, builder, message, redirect?, detected }
		 */
		public static function install_or_activate( $builder ) {
			$builder = sanitize_key( $builder );

			switch ( $builder ) {
				case 'elementor':
					return self::handle_elementor();

				case 'bricks':
					return self::handle_bricks();

				case 'gutenberg':
					return array(
						'ok'       => true,
						'action'   => 'noop',
						'builder'  => 'gutenberg',
						'message'  => __( 'Gutenberg is built into WordPress.', 'uichemy' ),
						'detected' => Uich_ND_Settings::detect_builders(),
					);

				default:
					return new WP_Error( 'invalid_builder', __( 'Unknown builder.', 'uichemy' ), array( 'status' => 400 ) );
			}
		}

		/* ---------- Elementor ---------- */

		private static function handle_elementor() {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$plugins = get_plugins();
			$file    = self::ELEMENTOR_FILE;

			if ( ! isset( $plugins[ $file ] ) ) {
				// Not installed → send the user to the wordpress.org page
				// so they install it from the trusted source themselves.
				return array(
					'ok'       => true,
					'action'   => 'redirect',
					'builder'  => 'elementor',
					'message'  => __( 'Install Elementor from WordPress.org, then come back.', 'uichemy' ),
					'redirect' => self::ELEMENTOR_WPORG_URL,
					'detected' => Uich_ND_Settings::detect_builders(),
				);
			}

			if ( is_plugin_active( $file ) ) {
				self::ensure_elementor_kit();
				return self::success( 'elementor', 'already_active', __( 'Elementor is already active.', 'uichemy' ) );
			}

			$result = self::activate_or_link( $file, 'elementor', __( 'Elementor activated.', 'uichemy' ) );

			if ( is_plugin_active( $file ) ) {
				self::ensure_elementor_kit();
			}

			return $result;
		}

		public static function ensure_elementor_kit() {
			if ( ! defined( 'ELEMENTOR_VERSION' ) ) {
				return;
			}

			$active_id = get_option( 'elementor_active_kit' );
			if ( $active_id && 'elementor_library' === get_post_type( $active_id ) && 'trash' !== get_post_status( $active_id ) ) {
				return; // Already have a valid kit.
			}

			// NOTE: Elementor's static `Manager::create_default_kit()` is NOT safe
			// to call here — it early-returns whenever `elementor_active_kit` is
			// already set at all, even to a broken/trashed/deleted post id, so it
			// can't repair the exact situation we're in. Use the kits_manager
			// instance's `create_default()`, which unconditionally creates a kit,
			// and set the option ourselves.
			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->kits_manager ) ) {
				$kits_manager = \Elementor\Plugin::$instance->kits_manager;
				$new_id       = 0;

				if ( method_exists( $kits_manager, 'create_default' ) ) {
					$new_id = (int) $kits_manager->create_default();
				} elseif ( method_exists( $kits_manager, 'create_default_kit' ) ) {
					$new_id = (int) $kits_manager->create_default_kit();
				}

				if ( $new_id > 0 ) {
					update_option( 'elementor_active_kit', $new_id );
					return;
				}
			}

			// Fallback mirroring Manager::create_default_kit(), in case Elementor's
			// classes aren't autoloadable yet in this request.
			$id = wp_insert_post(
				array(
					'post_title'  => __( 'Default Kit', 'uichemy' ),
					'post_type'   => 'elementor_library',
					'post_status' => 'publish',
					'meta_input'  => array(
						'_elementor_edit_mode'     => 'builder',
						'_elementor_template_type' => 'kit',
					),
				)
			);

			if ( $id && ! is_wp_error( $id ) ) {
				update_option( 'elementor_active_kit', $id );
			}
		}

		/**
		 * Try silent activation in-process. If the plugin's bootstrap
		 * throws (e.g. Elementor 4.1.x cloud-library uncaught 403), or
		 * activation otherwise fails, hand the user a one-click WP
		 * activation URL — `plugins.php` sandboxes the plugin include
		 * and surfaces errors gracefully, where our REST request just
		 * returns a "critical error" 500.
		 *
		 * @return array Response payload (ok+action) — never a WP_Error,
		 *               because the activate_url fallback always works.
		 */
		private static function activate_or_link( $file, $builder, $success_message ) {
			$threw = null;
			try {
				$result = activate_plugin( $file, '', false, true );
				if ( is_wp_error( $result ) ) {
					$threw = $result->get_error_message();
				}
			} catch ( \Throwable $e ) {
				$threw = $e->getMessage();
			}

			// Belt-and-braces — re-check the live state. activate_plugin
			// can persist into active_plugins even when its sandbox
			// include throws; conversely a successful return on a stale
			// cache can lie.
			$is_active = function_exists( 'is_plugin_active' ) ? is_plugin_active( $file ) : false;
			if ( $is_active && ! $threw ) {
				return self::success( $builder, 'activated', $success_message );
			}

			return array(
				'ok'           => true,
				'action'       => 'activate_url',
				'builder'      => $builder,
				'message'      => $threw
					? __( 'Activation needs to finish in WP-Admin.', 'uichemy' )
					: __( 'Click to activate in WP-Admin.', 'uichemy' ),
				'activate_url' => self::activation_url( $file ),
				'detected'     => Uich_ND_Settings::detect_builders(),
			);
		}

		/**
		 * Standard WP activation URL with nonce. plugins.php's activate
		 * action sandboxes the include — if the plugin's bootstrap
		 * throws, WP surfaces the error instead of 500'ing the response.
		 * Tagged with `from=uichemy` so the post-activate hook (in
		 * class-uich-nd-menu.php) can bounce the user back here.
		 */
		private static function activation_url( $plugin_file ) {
			return wp_nonce_url(
				self_admin_url( 'plugins.php?action=activate&from=uichemy&plugin=' . urlencode( $plugin_file ) ),
				'activate-plugin_' . $plugin_file
			);
		}

		/* ---------- Bricks ---------- */

		private static function handle_bricks() {
			$theme = wp_get_theme( 'bricks' );

			// Premium theme — can't pull from a public repo. If absent
			// we point the user at the buy page; if present, just switch.
			if ( ! $theme->exists() ) {
				return array(
					'ok'       => true,
					'action'   => 'redirect',
					'builder'  => 'bricks',
					'message'  => __( 'Bricks is a premium theme. Install it from bricksbuilder.io, then come back.', 'uichemy' ),
					'redirect' => self::BRICKS_BUY_URL,
					'detected' => Uich_ND_Settings::detect_builders(),
				);
			}

			if ( 'bricks' === get_stylesheet() ) {
				return self::success( 'bricks', 'already_active', __( 'Bricks theme is already active.', 'uichemy' ) );
			}

			switch_theme( 'bricks' );

			return self::success( 'bricks', 'activated', __( 'Bricks theme activated.', 'uichemy' ) );
		}

		/* ---------- UiChemy (Composer widget + MCP) ---------- */

		/**
		 * One-click install + activate for the UiChemy plugin.
		 *
		 * Flow:
		 *   active            → already_active (noop).
		 *   installed/inactive → activate in-process (WP-Admin fallback on throw).
		 *   not installed     → download the hosted zip, install, then activate.
		 *
		 * @return array|WP_Error
		 */
		public static function install_uichemy() {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$file = Uich_ND_Settings::find_uichemy_file();

			// Already present.
			if ( $file ) {
				// An update is available (installed < API latest) → overwrite-install
				// the newer package and restore its active state. install_uichemy()
				// is the single endpoint behind both the WP dashboard and the Figma
				// "Update" button, so the update path lives here too.
				$detect = Uich_ND_Settings::detect_uichemy();
				if ( ! empty( $detect['update_available'] ) ) {
					return self::update_uichemy( $file );
				}

				if ( is_plugin_active( $file ) ) {
					return self::uichemy_payload( 'already_active', __( 'UiChemy is already active.', 'uichemy' ) );
				}
				return self::activate_uichemy_file( $file );
			}

			// Not installed → pull the hosted package (via the API redirect) and install it.
			$zip_url = (string) apply_filters( 'uich_uichemy_zip_url', self::uichemy_zip_url() );
			if ( '' === trim( $zip_url ) ) {
				return new WP_Error( 'uichemy_no_zip', __( 'UiChemy download URL is not configured.', 'uichemy' ), array( 'status' => 500 ) );
			}

			$installed = self::install_plugin_from_zip( $zip_url );
			if ( is_wp_error( $installed ) ) {
				return $installed;
			}

			// Locate the freshly unpacked plugin (folder name comes from the zip).
			$file = Uich_ND_Settings::find_uichemy_file();
			if ( ! $file ) {
				return new WP_Error(
					'uichemy_post_install_missing',
					__( 'UiChemy was installed but could not be located. Activate it from the Plugins screen.', 'uichemy' ),
					array( 'status' => 500 )
				);
			}

			return self::activate_uichemy_file( $file );
		}

		/**
		 * Update an already-installed UiChemy to the latest hosted package.
		 *
		 * UiChemy isn't on wp.org and its zip can unpack to a version-specific
		 * folder name, so we can't rely on WP's in-place upgrader (which keys off
		 * the wp.org update transient and a stable folder). Instead we deactivate,
		 * delete the old copy, install the fresh zip, then reactivate if it was
		 * active before — a clean-slate replace that works regardless of folder
		 * naming.
		 *
		 * @param string $file Currently-installed UiChemy plugin file.
		 * @return array|WP_Error
		 */
		private static function update_uichemy( $file ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/plugin.php';

			$zip_url = (string) apply_filters( 'uich_uichemy_zip_url', self::uichemy_zip_url() );
			if ( '' === trim( $zip_url ) ) {
				return new WP_Error( 'uichemy_no_zip', __( 'UiChemy download URL is not configured.', 'uichemy' ), array( 'status' => 500 ) );
			}

			$was_active = is_plugin_active( $file );

			// Deactivate before deleting so no stale hooks fire mid-swap.
			if ( $was_active ) {
				deactivate_plugins( $file, true );
			}

			// Remove the old install (the whole plugin folder).
			$deleted = delete_plugins( array( $file ) );
			if ( is_wp_error( $deleted ) ) {
				return $deleted;
			}
			if ( false === $deleted ) {
				return new WP_Error( 'uichemy_delete_failed', __( 'Could not remove the old UiChemy before updating.', 'uichemy' ), array( 'status' => 500 ) );
			}

			// Install the fresh package.
			$installed = self::install_plugin_from_zip( $zip_url );
			if ( is_wp_error( $installed ) ) {
				return $installed;
			}

			// Re-locate the plugin (its folder name may differ between versions)
			// so detect_uichemy() reflects the freshly-installed state. No cache
			// to flush — versions are read fresh from the API each request.
			$file = Uich_ND_Settings::find_uichemy_file();
			if ( ! $file ) {
				return new WP_Error(
					'uichemy_post_update_missing',
					__( 'UiChemy was updated but could not be located. Activate it from the Plugins screen.', 'uichemy' ),
					array( 'status' => 500 )
				);
			}

			// Restore the previous active state.
			if ( $was_active ) {
				return self::activate_uichemy_file( $file, 'updated', __( 'UiChemy updated to the latest version.', 'uichemy' ) );
			}
			return self::uichemy_payload( 'updated', __( 'UiChemy updated to the latest version.', 'uichemy' ) );
		}

		/**
		 * Activate the UiChemy plugin file in-process; fall back to a sandboxed
		 * WP-Admin activation URL if its bootstrap throws (so we never 500).
		 *
		 * @param string $file            Plugin file relative to the plugins dir.
		 * @param string $success_action  Payload action on success (activated | updated).
		 * @param string $success_message Payload message on success; defaults to install copy.
		 * @return array
		 */
		private static function activate_uichemy_file( $file, $success_action = 'activated', $success_message = null ) {
			if ( null === $success_message ) {
				$success_message = __( 'UiChemy installed and activated.', 'uichemy' );
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

			$is_active = function_exists( 'is_plugin_active' ) ? is_plugin_active( $file ) : false;
			if ( $is_active && ! $threw ) {
				return self::uichemy_payload( $success_action, $success_message );
			}

			return array(
				'ok'           => true,
				'action'       => 'activate_url',
				'plugin'       => 'uichemy',
				'message'      => $threw
					? __( 'UiChemy installed. Finish activation in WP-Admin.', 'uichemy' )
					: __( 'UiChemy installed. Click to activate in WP-Admin.', 'uichemy' ),
				'activate_url' => self::activation_url( $file ),
				'uichemy'      => Uich_ND_Settings::detect_uichemy(),
			);
		}

		/* ---------- UiChemy Pro (premium plugin, installed from a zip) ---------- */

		/**
		 * UiChemy Pro install package — resolved from the UiChemy API instead of a
		 * hardcoded URL, exactly like uichemy_zip_url() does for the free build.
		 *
		 * `{API_BASE}/plugins/uichemy-pro/download` 302-redirects to the currently
		 * published package; WP's upgrader follows the redirect transparently (see
		 * download_package_to_temp). The version behind that redirect is the
		 * `uichemy_pro` entry of `/plugins/versions`, which is where the Pro release
		 * is managed — so moving the hosted zip never needs a plugin update.
		 *
		 * The filter is the only override, and it exists for the case the endpoint
		 * can't cover: a URL that has to be built at runtime (a per-site token, a
		 * staging mirror). Returning '' from it keeps the whole Pro flow visible but
		 * inert — the onboarding step and the rail card then say the download isn't
		 * configured rather than firing a request that can only fail
		 * (detect_uichemy_pro() ships `zip_configured` for exactly that).
		 *
		 * @return string Empty string when the filter clears it.
		 */
		private static function uichemy_pro_zip_url() {
			$base = class_exists( 'Uich_ND_Auth' ) ? Uich_ND_Auth::API_BASE : 'http://localhost:8000';
			$url  = rtrim( $base, '/' ) . '/plugins/uichemy-pro/download';

			/**
			 * Filter the UiChemy Pro download URL.
			 *
			 * @param string $url The API download endpoint, or '' to disable the flow.
			 */
			return trim( (string) apply_filters( 'uich_uichemy_pro_zip_url', $url ) );
		}

		/**
		 * Is a Pro package URL configured at all?
		 *
		 * Read by Uich_ND_Settings::detect_uichemy_pro() so the UI can offer the
		 * step honestly — describing what Pro unlocks and saying the download
		 * isn't set up yet — instead of showing a button that always errors.
		 *
		 * @return bool
		 */
		public static function has_uichemy_pro_zip() {
			return '' !== self::uichemy_pro_zip_url();
		}

		/**
		 * One-click install + activate for UiChemy Pro.
		 *
		 * Mirrors install_uichemy() (the path built for the old standalone free
		 * plugin), because the user-visible contract is the same three cases:
		 *
		 *   already active     → already_active (noop)
		 *   installed/inactive → activate in-process, WP-Admin fallback on throw
		 *   not installed      → download the zip, install, then activate
		 *
		 * A fourth case sits in front of those: when the installed version is behind
		 * the API's published one, this routes to update_uichemy_pro() instead. Same
		 * shape as install_uichemy() — ONE endpoint behind every surface, so the WP
		 * dashboard's Pro card and the Figma Site Check's "Update" button both post
		 * here and the server decides what the site actually needs.
		 *
		 * @return array|WP_Error
		 */
		public static function install_uichemy_pro() {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}

			$file = Uich_ND_Settings::find_uichemy_pro_file();

			// Already installed → update it if it's behind, else activate it (or report
			// that it already is).
			if ( $file ) {
				$detect = Uich_ND_Settings::detect_uichemy_pro();
				if ( ! empty( $detect['update_available'] ) ) {
					return self::update_uichemy_pro( $file );
				}

				if ( is_plugin_active( $file ) ) {
					return self::uichemy_pro_payload( 'already_active', __( 'UiChemy Pro is already active.', 'uichemy' ) );
				}
				return self::activate_uichemy_pro_file( $file, 'activated', __( 'UiChemy Pro activated.', 'uichemy' ) );
			}

			// Not installed → fetch the package and install it.
			$zip_url = self::uichemy_pro_zip_url();
			if ( '' === $zip_url ) {
				return new WP_Error(
					'uichemy_pro_no_zip',
					__( 'The UiChemy Pro download link has not been set up yet. Add it in the plugin settings, then try again.', 'uichemy' ),
					array( 'status' => 501 )
				);
			}

			$installed = self::install_plugin_from_zip( $zip_url );
			if ( is_wp_error( $installed ) ) {
				return $installed;
			}

			// Re-locate it: the folder name comes from whatever the zip unpacked to.
			$file = Uich_ND_Settings::find_uichemy_pro_file();
			if ( ! $file ) {
				return new WP_Error(
					'uichemy_pro_post_install_missing',
					__( 'UiChemy Pro was installed but could not be found. Activate it from the Plugins screen.', 'uichemy' ),
					array( 'status' => 500 )
				);
			}

			return self::activate_uichemy_pro_file( $file, 'installed', __( 'UiChemy Pro installed and activated.', 'uichemy' ) );
		}

		/**
		 * Update an already-installed UiChemy Pro to the latest published package.
		 *
		 * OVERWRITE-installs, and never deletes first — that is the whole point of
		 * this method existing separately from update_uichemy(). `delete_plugins()`
		 * runs each plugin's uninstall routine (uninstall.php / the uninstall hook)
		 * before removing its folder, which on a premium plugin can drop the licence
		 * key and any Pro settings stored in its own options. `overwrite_package`
		 * replaces the files in place, so nothing in the database is touched and the
		 * site stays licensed across the update.
		 *
		 * The plugin also stays ACTIVE throughout: WordPress keeps the entry in
		 * `active_plugins` because the folder path doesn't change, so there is no
		 * deactivate/reactivate cycle to lose state in. The Pro package is expected
		 * to keep its folder name (`uichemy-pro/`) between releases for that reason;
		 * a renamed folder would install alongside the old copy instead of replacing
		 * it, which the post-update re-location below reports rather than hides.
		 *
		 * @param string $file Currently-installed UiChemy Pro plugin file.
		 * @return array|WP_Error
		 */
		private static function update_uichemy_pro( $file ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/plugin.php';

			$zip_url = self::uichemy_pro_zip_url();
			if ( '' === $zip_url ) {
				return new WP_Error(
					'uichemy_pro_no_zip',
					__( 'The UiChemy Pro download link has not been set up yet. Add it in the plugin settings, then try again.', 'uichemy' ),
					array( 'status' => 501 )
				);
			}

			$was_active = is_plugin_active( $file );

			$installed = self::install_plugin_from_zip( $zip_url, array( 'overwrite_package' => true ) );
			if ( is_wp_error( $installed ) ) {
				return $installed;
			}

			// Re-locate: an overwrite keeps the folder, but a package that renamed it
			// would land elsewhere and we'd rather say so than report a phantom update.
			$file = Uich_ND_Settings::find_uichemy_pro_file();
			if ( ! $file ) {
				return new WP_Error(
					'uichemy_pro_post_update_missing',
					__( 'UiChemy Pro was updated but could not be found. Activate it from the Plugins screen.', 'uichemy' ),
					array( 'status' => 500 )
				);
			}

			// Overwriting the files of an ACTIVE plugin leaves it active, so there is
			// normally nothing to switch back on. Only a copy that was inactive before
			// (or one whose folder moved) needs the activation path.
			if ( $was_active && ! is_plugin_active( $file ) ) {
				return self::activate_uichemy_pro_file( $file, 'updated', __( 'UiChemy Pro updated to the latest version.', 'uichemy' ) );
			}

			return self::uichemy_pro_payload( 'updated', __( 'UiChemy Pro updated to the latest version.', 'uichemy' ) );
		}

		/**
		 * Activate a located Pro plugin file in-process, falling back to a
		 * sandboxed WP-Admin activation URL if its bootstrap throws — same
		 * belt-and-braces as activate_uichemy_file(), and for the same reason: a
		 * plugin that fatals inside our REST request returns an opaque 500, while
		 * plugins.php sandboxes the include and reports the real error.
		 *
		 * @param string $file            Plugin file relative to the plugins dir.
		 * @param string $success_action  Payload action on success.
		 * @param string $success_message Payload message on success.
		 * @return array
		 */
		private static function activate_uichemy_pro_file( $file, $success_action, $success_message ) {
			$threw = null;
			try {
				$result = activate_plugin( $file, '', false, true );
				if ( is_wp_error( $result ) ) {
					$threw = $result->get_error_message();
				}
			} catch ( \Throwable $e ) {
				$threw = $e->getMessage();
			}

			$is_active = function_exists( 'is_plugin_active' ) ? is_plugin_active( $file ) : false;
			if ( $is_active && ! $threw ) {
				return self::uichemy_pro_payload( $success_action, $success_message );
			}

			return array(
				'ok'           => true,
				'action'       => 'activate_url',
				'plugin'       => 'uichemy-pro',
				'message'      => $threw
					? __( 'UiChemy Pro is installed. Finish activating it in WP-Admin.', 'uichemy' )
					: __( 'UiChemy Pro is installed. Click to activate it in WP-Admin.', 'uichemy' ),
				'activate_url' => self::activation_url( $file ),
				'uichemyPro'   => Uich_ND_Settings::detect_uichemy_pro(),
			);
		}

		/**
		 * Success payload. Carries fresh detection so the caller can flip its UI
		 * without a reload.
		 *
		 * NOTE on `is_pro`: the freshly activated plugin defines UICHEMY_PRO on
		 * ITS next request, not this one — our process already ran past the point
		 * where that constant is read. So `uichemy_is_pro()` can still answer
		 * false here even on a completely successful activation. The React side
		 * treats `active` as the source of truth for "done" and only reads
		 * `is_pro` from a fresh boot payload; see use-pro-setup.js.
		 *
		 * @param string $action  activated | installed | updated | already_active.
		 * @param string $message Human-readable result.
		 * @return array
		 */
		private static function uichemy_pro_payload( $action, $message ) {
			return array(
				'ok'         => true,
				'action'     => $action,
				'plugin'     => 'uichemy-pro',
				'message'    => $message,
				'uichemyPro' => Uich_ND_Settings::detect_uichemy_pro(),
			);
		}

		/**
		 * Download + install a plugin from a remote .zip URL using WordPress'
		 * own upgrader, with a silent (non-interactive) skin.
		 *
		 * @param string $zip_url Publicly reachable plugin .zip URL.
		 * @param array  $args    Extra Plugin_Upgrader::install() args. Pass
		 *                        `overwrite_package => true` to replace an existing
		 *                        copy in place instead of failing on "already installed".
		 * @return true|WP_Error
		 */
		private static function install_plugin_from_zip( $zip_url, $args = array() ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/misc.php';
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
			require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

			if ( ! class_exists( 'Plugin_Upgrader' ) || ! class_exists( 'Automatic_Upgrader_Skin' ) ) {
				return new WP_Error( 'uichemy_upgrader_missing', __( 'WordPress plugin installer is unavailable.', 'uichemy' ), array( 'status' => 500 ) );
			}

			$package = self::download_package_to_temp( $zip_url );
			if ( is_wp_error( $package ) ) {
				return $package;
			}

			$skin     = new Automatic_Upgrader_Skin();
			$upgrader = new Plugin_Upgrader( $skin );
			$result   = $upgrader->install( $package, $args );

			if ( file_exists( $package ) ) {
				wp_delete_file( $package );
			}

			if ( is_wp_error( $result ) ) {
				return self::clarify_install_error( $result );
			}
			if ( is_wp_error( $skin->result ) ) {
				return self::clarify_install_error( $skin->result );
			}
			if ( true !== $result ) {
				$messages = method_exists( $skin, 'get_upgrade_messages' ) ? $skin->get_upgrade_messages() : array();
				$detail   = is_array( $messages ) ? trim( implode( ' ', $messages ) ) : '';
				return new WP_Error(
					'uichemy_install_failed',
					trim( __( 'UiChemy installation failed.', 'uichemy' ) . ' ' . $detail ),
					array( 'status' => 500 )
				);
			}

			return true;
		}

		/**
		 * Turn WordPress core's terse upgrader errors into an actionable message.
		 *
		 * On a WP/PHP version mismatch, core returns the generic message "The
		 * package could not be installed." and stashes the useful detail (e.g.
		 * "Your WordPress version is 6.9.5, however the uploaded plugin requires
		 * 7.0.") in the error data, which the dashboard never surfaces. Promote
		 * that detail into the message so the user knows what to do.
		 *
		 * @param WP_Error $error Error returned by Plugin_Upgrader / its skin.
		 * @return WP_Error Same error, with a clearer message where possible.
		 */
		private static function clarify_install_error( $error ) {
			if ( ! is_wp_error( $error ) ) {
				return $error;
			}

			$compat_codes = array(
				'incompatible_wp_required_version',
				'incompatible_php_required_version',
				'incompatible_wp_php_required_version',
			);

			$code   = $error->get_error_code();
			$detail = $error->get_error_data();

			if ( in_array( $code, $compat_codes, true ) && is_string( $detail ) && '' !== trim( $detail ) ) {
				return new WP_Error( $code, trim( $detail ), array( 'status' => 400 ) );
			}

			return $error;
		}

		/**
		 * Download a remote package to a temp file.
		 *
		 * The SSRF-safe transport (wp_safe_remote_get) is preferred: it re-validates
		 * EVERY redirect hop, so a compromised or MITM'd 302 cannot point the
		 * download — which is then installed as live plugin code — at an internal
		 * host (loopback, LAN, cloud metadata). That transport rejects private hosts
		 * and non-standard ports, which a local dev API base (http://localhost:8000)
		 * legitimately uses, so a URL that wp_http_validate_url() rejects keeps the
		 * plain transport (the base is a trusted configured constant, not request
		 * input). In production the base is https://core.uichemy.com, so the safe
		 * path is taken and the whole redirect chain is validated.
		 *
		 * @param string $url
		 * @return string|WP_Error  Temp file path, or WP_Error on failure.
		 */
		private static function download_package_to_temp( $url ) {
			if ( '' === trim( (string) $url ) ) {
				return new WP_Error( 'uichemy_no_zip', __( 'UiChemy download URL is not configured.', 'uichemy' ), array( 'status' => 500 ) );
			}

			// Fetch into memory (not stream-to-file): the package is small and this
			// avoids a WP_Http quirk where `stream => true` + a redirect can write
			// the redirect's empty body instead of the final zip. redirection=5
			// follows the API's 302 to the real zip.
			$args = array(
				'timeout'     => 300,
				'redirection' => 5,
			);

			// Public URL (production) → SSRF-safe transport, validating the initial
			// URL and each redirect target. A local/dev base that fails validation
			// (private host / non-standard port) falls back to the plain transport.
			$response = wp_http_validate_url( $url )
				? wp_safe_remote_get( $url, $args )
				: wp_remote_get( $url, $args );

			if ( is_wp_error( $response ) ) {
				return $response;
			}

			$code = (int) wp_remote_retrieve_response_code( $response );
			if ( $code < 200 || $code >= 300 ) {
				return new WP_Error(
					'uichemy_download_failed',
					sprintf( __( 'UiChemy download failed (HTTP %d).', 'uichemy' ), $code ),
					array( 'status' => 500 )
				);
			}

			$body = wp_remote_retrieve_body( $response );
			if ( '' === $body ) {
				return new WP_Error( 'uichemy_download_empty', __( 'UiChemy download returned an empty package.', 'uichemy' ), array( 'status' => 500 ) );
			}

			$tmp = wp_tempnam( 'uichemy-' );
			if ( ! $tmp ) {
				return new WP_Error( 'uichemy_tmp_failed', __( 'Could not create a temporary file for the download.', 'uichemy' ), array( 'status' => 500 ) );
			}

			if ( false === file_put_contents( $tmp, $body ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
				wp_delete_file( $tmp );
				return new WP_Error( 'uichemy_write_failed', __( 'Could not write the downloaded package.', 'uichemy' ), array( 'status' => 500 ) );
			}

			return $tmp;
		}

		/**
		 * Standard UiChemy success payload with a fresh detection snapshot.
		 *
		 * @param string $action  already_active | activated.
		 * @param string $message Human-readable status.
		 * @return array
		 */
		private static function uichemy_payload( $action, $message ) {
			return array(
				'ok'      => true,
				'action'  => $action,
				'plugin'  => 'uichemy',
				'message' => $message,
				'uichemy' => Uich_ND_Settings::detect_uichemy(),
			);
		}

		/* ---------- helpers ---------- */

		private static function success( $builder, $action, $message ) {
			return array(
				'ok'       => true,
				'action'   => $action,
				'builder'  => $builder,
				'message'  => $message,
				'detected' => Uich_ND_Settings::detect_builders(),
			);
		}
	}
}
