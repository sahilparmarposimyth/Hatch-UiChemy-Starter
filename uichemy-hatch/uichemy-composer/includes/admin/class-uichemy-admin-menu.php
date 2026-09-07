<?php
/**
 * UiChemy_Admin_Menu — the UiChemy control panel.
 *
 * Registers the top-level "UiChemy" admin menu (with the composer "1" mark) and
 * its submenus — Settings, Form Submissions and White Label — and renders the
 * framed, card-based dashboard shared across the UiChemy screens.
 *
 * @package UiChemy
 * @subpackage UiChemy/admin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Admin_Menu' ) ) {

	/**
	 * UiChemy admin menu + dashboard.
	 */
	class UiChemy_Admin_Menu {

		const SLUG          = 'uichemy';
		const SLUG_SETTINGS = 'uichemy-settings';
		const SLUG_WHITE    = 'uichemy-white-label';
		const SLUG_THEME    = 'uichemy-theme-builder';
		const SLUG_ROLES    = 'uichemy-role-manager';
		const SLUG_LICENSE  = 'uichemy-license'; // Pro only.
		const SLUG_FORMS    = 'uich-atom-forms'; // Owned by Uich_Forms_Admin; kept so its links stay valid.

		/**
		 * Boot the menu, settings and assets.
		 */
		public static function init() {
			// Priority 9 so the parent menu exists before the Form Submissions
			// submenu (registered at the default priority) attaches to it.
			add_action( 'admin_menu', array( __CLASS__, 'register_menu' ), 9 );
			add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
			add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );

			// React dashboard save endpoint (settings + white label).
			add_action( 'wp_ajax_uichemy_dashboard', array( __CLASS__, 'ajax' ) );

			// White-label rename of the plugin's own row on the Plugins screen.
			add_filter( 'all_plugins', array( __CLASS__, 'filter_plugins_list' ) );

			// "Hide all help links": strip the plugin's row-meta links.
			add_filter( 'plugin_row_meta', array( __CLASS__, 'filter_plugin_row_meta' ), 10, 2 );

			// "Force disable" is cleared on deactivation, so re-activating restores
			// the White Label page (matching the documented behaviour).
			if ( defined( 'UICHEMY_FILE' ) ) {
				register_deactivation_hook( UICHEMY_FILE, array( __CLASS__, 'on_deactivate' ) );
			}

			// When Force Disable is switched on the White Label page is removed, so
			// redirect the admin to the Dashboard instead of the now-gone page.
			add_action( 'update_option_uichemy_white_label', array( __CLASS__, 'after_wl_save' ), 10, 2 );
		}

		/**
		 * After saving White Label: if Force Disable was just turned on, the page
		 * is gone — bounce to the Dashboard so the admin never hits a dead screen.
		 *
		 * @param mixed $old Previous option value.
		 * @param mixed $new New option value.
		 */
		public static function after_wl_save( $old, $new ) {
			// The React dashboard saves via admin-ajax and handles the redirect
			// itself (response flag `reload`); never redirect mid-ajax.
			if ( wp_doing_ajax() ) {
				return;
			}
			$old = is_array( $old ) ? $old : array();
			$new = is_array( $new ) ? $new : array();
			if ( empty( $old['force_disable'] ) && ! empty( $new['force_disable'] ) ) {
				wp_safe_redirect( admin_url( 'admin.php?page=' . self::SLUG ) );
				exit;
			}
		}

		/* ── Menu ─────────────────────────────────────────────────────────── */

		/**
		 * Register the UiChemy top-level menu and its submenus.
		 */
		public static function register_menu() {
			/*
			 * Merged into UiChemy: that plugin owns the one admin menu and renders
			 * these screens as tabs in its React dashboard, so registering a second
			 * top-level "UiChemy" menu here would duplicate every screen.
			 *
			 * Only the MENU is skipped. init() still runs, so the `uichemy_dashboard`
			 * ajax endpoint, the settings/white-label option registration and the
			 * Plugins-screen white-label filters all stay live — the tabs depend on
			 * them. Old `page=uichemy*` URLs are redirected by Uich_ND_Menu.
			 */
			if ( defined( 'UICH_COMPOSER_MERGED' ) && UICH_COMPOSER_MERGED ) {
				return;
			}

			// Respect white-label branding for the top-level admin menu.
			$wl    = (array) uichemy_white_label_settings();
			$wl_on = ! empty( $wl['enabled'] );

			// "Hide from other admins": when enabled, only the administrator who
			// configured it (the recorded owner) sees the UiChemy menu at all.
			if ( $wl_on && ! empty( $wl['hide_from_others'] ) && ! empty( $wl['owner_id'] )
				&& get_current_user_id() !== (int) $wl['owner_id'] ) {
				return;
			}

			$label = ( $wl_on && ! empty( $wl['plugin_name'] ) ) ? $wl['plugin_name'] : __( 'UiChemy', 'uichemy' );
			$icon  = ( $wl_on && ! empty( $wl['logo_url'] ) ) ? esc_url_raw( $wl['logo_url'] ) : self::menu_icon();

			add_menu_page(
				$label,
				$label,
				'manage_options',
				self::SLUG,
				array( __CLASS__, 'render_dashboard' ),
				$icon,
				58
			);

			// Page title (the browser tab) uses $label so the tab reads "UiChemy ‹ …"
			// rather than a generic "Dashboard ‹ …" — and stays correct on a
			// white-labelled site, where $label is the custom plugin name. The menu
			// title stays "Dashboard", which is the WordPress convention for the
			// first submenu item.
			add_submenu_page(
				self::SLUG,
				$label,
				__( 'Dashboard', 'uichemy' ),
				'manage_options',
				self::SLUG,
				array( __CLASS__, 'render_dashboard' )
			);

			// Theme Builder — native header/footer/404 templates. Always on; the
			// class is only absent if the feature module failed to load.
			if ( class_exists( 'UiChemy_Theme_Builder' ) ) {
				add_submenu_page(
					self::SLUG,
					__( 'Theme Builder', 'uichemy' ),
					__( 'Theme Builder', 'uichemy' ),
					'manage_options',
					self::SLUG_THEME,
					array( __CLASS__, 'render_theme_builder' )
				);
			}

			// Order below mirrors the dashboard sidebar exactly (Welcome, Theme
			// Builder, Form Submissions, Role Manager, White Label, Settings) — WP
			// renders submenu items in registration order, so the two menus agree.

			// Form Submissions — rendered by the existing forms subsystem.
			add_submenu_page(
				self::SLUG,
				__( 'Form Submissions', 'uichemy' ),
				__( 'Form Submissions', 'uichemy' ),
				'manage_options',
				self::SLUG_FORMS,
				class_exists( 'Uich_Forms_Admin' ) ? array( 'Uich_Forms_Admin', 'render' ) : '__return_null'
			);

			// Role Manager — per-role editor access (like Elementor's Role Manager).
			add_submenu_page(
				self::SLUG,
				__( 'Role Manager', 'uichemy' ),
				__( 'Role Manager', 'uichemy' ),
				'manage_options',
				self::SLUG_ROLES,
				array( __CLASS__, 'render_role_manager' )
			);

			add_submenu_page(
				self::SLUG,
				__( 'White Label', 'uichemy' ),
				__( 'White Label', 'uichemy' ),
				'manage_options',
				self::SLUG_WHITE,
				array( __CLASS__, 'render_white_label' )
			);

			add_submenu_page(
				self::SLUG,
				__( 'Settings', 'uichemy' ),
				__( 'Settings', 'uichemy' ),
				'manage_options',
				self::SLUG_SETTINGS,
				array( __CLASS__, 'render_settings' )
			);

			// License — Pro only. Never registered in Free, so there is no page to
			// reach and nothing to upsell here (Free's upsell lives on the Pro
			// feature screens instead).
			if ( uichemy_is_pro() ) {
				add_submenu_page(
					self::SLUG,
					__( 'Activate License', 'uichemy' ),
					__( 'Activate License', 'uichemy' ),
					'manage_options',
					self::SLUG_LICENSE,
					array( __CLASS__, 'render_license' )
				);
			}

			// "Force disable" locks the White Label page: remove it from the menu
			// (the page stays registered so the post-save redirect still resolves
			// to a "locked" notice instead of a broken screen).
			if ( $wl_on && ! empty( $wl['force_disable'] ) ) {
				remove_submenu_page( self::SLUG, self::SLUG_WHITE );
			}
		}

		/**
		 * White-label the plugin's own row on the Plugins screen.
		 *
		 * @param array $plugins All plugins keyed by plugin file.
		 * @return array
		 */
		public static function filter_plugins_list( $plugins ) {
			$wl = (array) uichemy_white_label_settings();
			if ( empty( $wl['enabled'] ) ) {
				return $plugins;
			}

			$file = defined( 'UICHEMY_PBNAME' ) ? UICHEMY_PBNAME : 'uichemy/uichemy.php';

			/*
			 * The Pro add-on has its own row, with its own "UiChemy Pro / POSIMYTH /
			 * uichemy.com" header. Renaming only the free row left our name and our
			 * author link sitting one line below the rebranded one on every
			 * white-labelled site, which defeats the whole feature.
			 *
			 * Its NAME gets the " Pro" suffix so the two rows stay distinguishable —
			 * they are separate plugins the admin activates and updates separately.
			 */
			foreach ( self::white_label_plugin_files() as $slug => $is_pro ) {
				if ( ! isset( $plugins[ $slug ] ) ) {
					continue;
				}

				if ( ! empty( $wl['plugin_name'] ) ) {
					$name = $is_pro
						/* translators: %s: white-labelled plugin name. */
						? sprintf( __( '%s Pro', 'uichemy' ), $wl['plugin_name'] )
						: $wl['plugin_name'];

					$plugins[ $slug ]['Name']  = $name;
					$plugins[ $slug ]['Title'] = $name;
				}
				// The description is written for the free plugin, so it is applied to
				// that row only; Pro keeps its own (which names no brand).
				if ( ! $is_pro && ! empty( $wl['description'] ) ) {
					$plugins[ $slug ]['Description'] = $wl['description'];
				}
				if ( ! empty( $wl['author'] ) ) {
					$plugins[ $slug ]['Author']     = $wl['author'];
					$plugins[ $slug ]['AuthorName'] = $wl['author'];
				}
				if ( ! empty( $wl['author_url'] ) ) {
					$plugins[ $slug ]['AuthorURI'] = $wl['author_url'];
				}
				if ( ! empty( $wl['plugin_url'] ) ) {
					$plugins[ $slug ]['PluginURI'] = $wl['plugin_url'];
				} elseif ( ! empty( $wl['hide_help_links'] ) ) {
					$plugins[ $slug ]['PluginURI'] = '';
				}
			}

			return $plugins;
		}

		/**
		 * The plugin rows White Label rewrites, as `file => is_pro`.
		 *
		 * Pro is found by header rather than hard-coded: it is an add-on the user
		 * installs separately, so its folder is whatever the zip unpacked to.
		 *
		 * @return array<string,bool>
		 */
		private static function white_label_plugin_files() {
			$files = array(
				( defined( 'UICHEMY_PBNAME' ) ? UICHEMY_PBNAME : 'uichemy/uichemy.php' ) => false,
			);

			if ( defined( 'UICH_PRO_PBNAME' ) ) {
				$files[ UICH_PRO_PBNAME ] = true;
			}

			return $files;
		}

		/**
		 * "Hide all help links": strip the plugin's row-meta (version/author/links)
		 * on the Plugins screen, leaving only the brand name.
		 *
		 * @param array  $meta Plugin row meta links.
		 * @param string $file Plugin file the meta belongs to.
		 * @return array
		 */
		public static function filter_plugin_row_meta( $meta, $file ) {
			$wl = (array) uichemy_white_label_settings();
			if ( empty( $wl['enabled'] ) || empty( $wl['hide_help_links'] ) ) {
				return $meta;
			}
			return isset( self::white_label_plugin_files()[ $file ] ) ? array() : $meta;
		}

		/**
		 * On deactivation, clear "force disable" so re-activating the plugin
		 * brings the White Label page back (documented behaviour).
		 */
		public static function on_deactivate() {
			$wl = get_option( 'uichemy_white_label', array() );
			if ( is_array( $wl ) && ! empty( $wl['force_disable'] ) ) {
				$wl['force_disable'] = 0;
				update_option( 'uichemy_white_label', $wl );
			}
		}

		/**
		 * Is the current screen one of our framed pages (dashboard/settings/white-label)?
		 *
		 * EVERY screen that renders `#uichemy-dashboard-root` must be listed here —
		 * this allowlist is what enqueues the stylesheet, the app bundle and the
		 * localized config. A screen missing from it renders an empty div with no
		 * error anywhere, which is exactly how Pro's License page went blank.
		 * SLUG_LICENSE is registered only in Pro, but naming it here is harmless in
		 * Free (the page does not exist, so `$page` can never match it) and keeps
		 * this file identical in both builds.
		 *
		 * @return bool
		 */
		private static function is_framed_screen() {
			/*
			 * Merged into UiChemy: none of these pages are registered any more, and
			 * the standalone dashboard bundle they enqueued (composer/build/admin.js)
			 * does not exist in this build — the composer's bundle moved to
			 * new-dashboard/build/ and the dashboard itself is UiChemy's React app.
			 *
			 * Returning false here keeps enqueue() a no-op rather than leaving it
			 * one stray `?page=uichemy` away from enqueueing missing files.
			 */
			if ( defined( 'UICH_COMPOSER_MERGED' ) && UICH_COMPOSER_MERGED ) {
				return false;
			}

			// phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
			return in_array( $page, array( self::SLUG, self::SLUG_SETTINGS, self::SLUG_WHITE, self::SLUG_THEME, self::SLUG_ROLES, self::SLUG_LICENSE ), true );
		}

		/**
		 * Enqueue the dashboard stylesheet on UiChemy framed screens only.
		 *
		 * @param string $hook Current admin page hook.
		 */
		public static function enqueue( $hook ) {
			if ( ! self::is_framed_screen() ) {
				return;
			}
			// Inter (variable) — the UiChemy brand typeface, matching the marketing
			// site. Loaded on the framed dashboard screens only, and listed as a
			// dependency below so the stylesheets that use it load after it.
			wp_enqueue_style(
				'uichemy-inter',
				'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400..700;1,14..32,400..700&display=swap',
				array(),
				null // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion -- External Google Fonts stylesheet; versioning not applicable.
			);

			$dash_css = UICHEMY_PATH . 'admin/css/uichemy-dashboard.css';
			wp_enqueue_style(
				'uichemy-dashboard',
				plugins_url( 'admin/css/uichemy-dashboard.css', UICHEMY_FILE ),
				array( 'dashicons', 'uichemy-inter' ),
				file_exists( $dash_css ) ? filemtime( $dash_css ) : UICHEMY_VERSION,
				'all'
			);

			// shadcn theme + Tailwind utilities for the redesigned Dashboard and
			// sidebar (built from composer/src/admin). Scoped to `.uich-tw` islands
			// so it never reaches the still-legacy Settings / White Label markup.
			// Loaded after the legacy sheet so the shadcn islands win any tie.
			$admin_css = plugin_dir_path( UICHEMY_FILE ) . 'composer/build/admin.css';
			if ( file_exists( $admin_css ) ) {
				wp_enqueue_style(
					'uichemy-dashboard-app',
					plugins_url( 'composer/build/admin.css', UICHEMY_FILE ),
					array( 'uichemy-dashboard' ),
					filemtime( $admin_css ),
					'all'
				);
				// Load the RTL build (admin-rtl.css) automatically on RTL locales.
				wp_style_add_data( 'uichemy-dashboard-app', 'rtl', 'replace' );
			}

			// React dashboard app (build produced by composer's wp-scripts build).
			$asset_path = plugin_dir_path( UICHEMY_FILE ) . 'composer/build/admin.asset.php';
			$asset      = file_exists( $asset_path )
				? require $asset_path
				: array(
					'dependencies' => array( 'wp-element' ),
					'version'      => UICHEMY_VERSION,
				);

			// Media picker (logo upload) + Dashicons are used by the White Label screen.
			wp_enqueue_media();

			wp_enqueue_script(
				'uichemy-dashboard-app',
				plugins_url( 'composer/build/admin.js', UICHEMY_FILE ),
				$asset['dependencies'],
				$asset['version'],
				true
			);

			// White Label is Pro. In Free we deliberately ignore the STORED option and
			// hand the app defaults instead — hiding the screen alone would let a site
			// that configured white-label under Pro keep UiChemy's branding hidden
			// after downgrading. The stored option itself is left untouched, so
			// reactivating Pro restores the exact same configuration.
			$wl   = uichemy_is_pro()
				? wp_parse_args( (array) get_option( 'uichemy_white_label', array() ), self::white_label_defaults() )
				: self::white_label_defaults();
			$opts = wp_parse_args( (array) get_option( 'uichemy_settings', array() ), self::settings_defaults() );

			wp_localize_script( 'uichemy-dashboard-app', 'uichemyDashboard', self::dashboard_data() );
		}

		/**
		 * The `uichemyDashboard` payload the React screens read.
		 *
		 * Extracted from enqueue() so the MERGED build can hand the same data to
		 * UiChemy's dashboard script (see Uich_ND_Enqueue) — in that build enqueue()
		 * never runs, because this plugin owns the one dashboard page.
		 *
		 * @return array
		 */
		public static function dashboard_data() {
			$wl   = uichemy_is_pro()
				? wp_parse_args( (array) get_option( 'uichemy_white_label', array() ), self::white_label_defaults() )
				: self::white_label_defaults();
			$opts = wp_parse_args( (array) get_option( 'uichemy_settings', array() ), self::settings_defaults() );

			return array(
				'version'     => UICHEMY_VERSION,
				'isPro'       => uichemy_is_pro(),
				'upgradeUrl'  => uichemy_upgrade_url( 'dashboard' ),
				// Masked status only — the raw key never leaves the server. The class
				// ships with Pro's license module; Free has no license at all.
				'license'     => class_exists( 'UiChemy_License' )
					? UiChemy_License::instance()->get_status()
					: null,
				'proLocked'   => uichemy_pro_feature_map(),
				'proTypes'    => class_exists( 'UiChemy_Template_CPT' )
					? array_values( array_diff( UiChemy_Template_CPT::TYPES, UiChemy_Template_CPT::FREE_TYPES ) )
					: array( 'archive', 'single_product', 'product_archive', 'search' ),
				'siteName'    => get_bloginfo( 'name' ),
				// First name for a friendly greeting; fall back to the display
				// name (always set) so the dashboard can say "Welcome back, …".
				'userName'    => wp_get_current_user()->first_name ? wp_get_current_user()->first_name : wp_get_current_user()->display_name,
				'formsCount'  => self::forms_count(),
				'ajaxUrl'     => admin_url( 'admin-ajax.php' ),
				'nonce'       => wp_create_nonce( 'uichemy_dashboard' ),
				'urls'        => array(
					'dashboard'     => menu_page_url( self::SLUG, false ),
					'settings'      => menu_page_url( self::SLUG_SETTINGS, false ),
					'themeBuilder'  => menu_page_url( self::SLUG_THEME, false ),
					'roleManager'   => menu_page_url( self::SLUG_ROLES, false ),
					'forms'         => menu_page_url( self::SLUG_FORMS, false ),
					// CSV export endpoint for the Form Submissions screen. The
					// screen appends form_key / status to it, so the file matches
					// whatever the list is filtered to.
					'formsExport'   => class_exists( 'Uich_Forms_Dashboard' )
						? Uich_Forms_Dashboard::export_url()
						: '',
					'white'         => menu_page_url( self::SLUG_WHITE, false ),
					// Pro only. menu_page_url() returns '' for a page that was never
					// registered, so in Free this is simply empty and the submenu
					// highlighter below skips it — no tier test needed here.
					'license'       => menu_page_url( self::SLUG_LICENSE, false ),
					'startBuilding' => admin_url( 'edit.php?post_type=page' ),
				),
				// The four fields the sidebar chrome brands itself with. Needed in
				// BOTH builds — Shell.jsx reads this one, not `whiteLabel` below.
				'wl'          => array(
					'enabled'       => (int) $wl['enabled'],
					'plugin_name'   => $wl['plugin_name'],
					'logo_url'      => $wl['logo_url'],
					'force_disable' => (int) $wl['force_disable'],
				),
				'settings'    => $opts,
				// Full config for the two screens that edit it. Those screens live
				// only in Pro (WhiteLabel.jsx / RoleManager.jsx), so in Free these
				// would ship to a page that renders the upsell instead and reads
				// neither. Sent empty there rather than as unused payload.
				'whiteLabel'  => uichemy_is_pro() ? $wl : array(),
				'dashicons'   => self::dashicons_list(),
				'roles'       => class_exists( 'UiChemy_Roles' ) ? UiChemy_Roles::editable_roles() : array(),
				// slug => bool. Roles without `edit_posts` (Subscriber, WooCommerce
				// Customer, …) are offered No Access only — see role_can_edit().
				'roleCanEdit' => class_exists( 'UiChemy_Roles' ) && method_exists( 'UiChemy_Roles', 'roles_can_edit' )
					? UiChemy_Roles::roles_can_edit()
					: array(),
				'roleManager' => ( uichemy_is_pro() && class_exists( 'UiChemy_Roles' ) )
					? UiChemy_Roles::get_resolved_settings()
					: array(),
			);
		}

		/**
		 * REST-like admin-ajax endpoint for the React dashboard. Routes by `type`
		 * and reuses the existing sanitizers so save behaviour is unchanged.
		 */
		public static function ajax() {
			check_ajax_referer( 'uichemy_dashboard', 'nonce' );
			if ( ! current_user_can( 'manage_options' ) ) {
				wp_send_json_error( array( 'message' => 'forbidden' ), 403 );
			}

			$type = isset( $_POST['type'] ) ? sanitize_key( wp_unslash( $_POST['type'] ) ) : '';

			if ( 'save_settings' === $type ) {
				$raw   = isset( $_POST['settings'] ) ? json_decode( wp_unslash( $_POST['settings'] ), true ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
				$clean = self::sanitize_settings( is_array( $raw ) ? $raw : array() );
				update_option( 'uichemy_settings', $clean );
				wp_send_json_success( array( 'settings' => $clean ) );
			}

			/**
			 * Let this build handle its own dashboard ajax types.
			 *
			 * Pro hooks this from includes/admin/class-uichemy-admin-ajax-pro.php to
			 * serve the `license_*` routes, whose UiChemy_License class does not exist
			 * in Free. A handler answers by calling wp_send_json_*(), which exits — so
			 * anything left unhandled falls through to the shared types below and
			 * finally to the "unknown type" error.
			 *
			 * @param string $type The sanitized ajax type.
			 */
			do_action( 'uichemy/admin/ajax', $type );

			// Free has no License screen and no license class, so any license_* type
			// that reaches here was not handled by a Pro module.
			if ( 0 === strpos( $type, 'license_' ) ) {
				wp_send_json_error( array( 'message' => 'This is a UiChemy Pro feature.' ), 403 );
			}

			// Both writers below are Pro-only. The React screens are already locked,
			// but the ajax route has to refuse too — otherwise a crafted POST could
			// still persist settings the Free UI can't display or undo.
			if ( in_array( $type, array( 'save_role_manager', 'save_white_label' ), true ) && ! uichemy_is_pro() ) {
				wp_send_json_error( 'This is a UiChemy Pro feature.', 403 );
			}

			if ( 'save_role_manager' === $type && class_exists( 'UiChemy_Roles' ) ) {
				$raw   = isset( $_POST['role_manager'] ) ? json_decode( wp_unslash( $_POST['role_manager'] ), true ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
				$clean = UiChemy_Roles::sanitize( is_array( $raw ) ? $raw : array() );
				update_option( UiChemy_Roles::OPTION, $clean );
				wp_send_json_success( array( 'roleManager' => UiChemy_Roles::get_resolved_settings() ) );
			}

			if ( 'save_white_label' === $type ) {
				$raw   = isset( $_POST['white_label'] ) ? json_decode( wp_unslash( $_POST['white_label'] ), true ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
				$clean = self::sanitize_white_label( is_array( $raw ) ? $raw : array() );
				update_option( 'uichemy_white_label', $clean );
				wp_send_json_success(
					array(
						'whiteLabel' => $clean,
						'reload'     => ! empty( $clean['force_disable'] ), // WL page vanishes → client redirects.
					)
				);
			}

			wp_send_json_error( array( 'message' => 'unknown type' ), 400 );
		}

		/* ── Branding marks ───────────────────────────────────────────────── */

		/**
		 * Menu icon: a composer disc with the numeral "1" knocked out, as a data URI.
		 *
		 * @return string
		 */
		private static function menu_icon() {
			/*
			 * The current UiChemy app mark: a rounded square with the monogram knocked
			 * out of it (fill-rule evenodd). Drawn WHITE so it reads on the dark admin
			 * menu and on the highlighted current item — WordPress does not recolour a
			 * data-URI menu icon, so the colour is baked in here rather than inherited.
			 */
			$svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40' fill='none'>"
				. "<path d='M29.9051 21.3778V24.409C29.9028 25.8619 29.3149 27.2547 28.2694 28.2821C27.2239 29.3094 25.8065 29.8872 24.328 29.8895H20.7909C21.1677 29.5927 21.4973 29.2425 21.7694 28.8504C22.6079 27.6333 22.7157 26.2714 22.7157 25.2235L22.7264 21.3778H29.9051Z' fill='white'/>"
				. "<path fill-rule='evenodd' clip-rule='evenodd' d='M4.19223 4.19223C9.78187 -1.39741 30.2178 -1.39741 35.8075 4.19223C41.3971 9.78187 41.3971 30.2178 35.8075 35.8075C30.2178 41.3971 9.78187 41.3971 4.19223 35.8075C-1.39741 30.2178 -1.39741 9.78187 4.19223 4.19223ZM9.32797 9.33383V24.495C9.32797 26.124 9.98678 27.6868 11.159 28.8387C12.3312 29.9904 13.9213 30.6375 15.5789 30.6375H15.5877C16.0116 30.6768 16.4383 30.6768 16.8622 30.6375H24.328C26.0077 30.6375 27.6188 29.9814 28.8065 28.8143C29.9941 27.6472 30.6609 26.0643 30.661 24.4139V20.6414H21.9774L21.9579 25.2225C21.9579 25.2225 18.0147 25.4457 18.0145 22.4627V14.8553C18.0145 14.1301 17.8692 13.412 17.5868 12.742C17.3043 12.072 16.89 11.4628 16.368 10.95C15.8462 10.4374 15.2265 10.0312 14.5448 9.75375C13.8628 9.47629 13.1315 9.33371 12.3934 9.33383H9.32797ZM27.0282 9.33383C25.6876 9.33384 24.402 9.8566 23.4539 10.7879C22.506 11.7193 21.9729 12.9825 21.9725 14.2997V17.2782H30.659V9.33383H27.0282Z' fill='white'/></svg>";

			return 'data:image/svg+xml;base64,' . base64_encode( $svg ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		}



		/* ── Shared shell (sidebar + frame) ───────────────────────────────── */




		/* ── Dashboard ────────────────────────────────────────────────────── */

		/**
		 * Render the UiChemy dashboard (Welcome).
		 */
		public static function render_dashboard() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			// React dashboard mounts here (see composer/src/admin). Data is provided
			// via wp_localize_script() in enqueue().
			echo '<div id="uichemy-dashboard-root" data-screen="dashboard"></div>';
		}



		/**
		 * Count stored form submissions (0 if the table is missing).
		 *
		 * @return int
		 */
		private static function forms_count() {
			global $wpdb;
			if ( ! class_exists( 'Uich_Forms_DB' ) ) {
				return 0;
			}
			$table = Uich_Forms_DB::table_submissions();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
			$exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );
			if ( $exists !== $table ) {
				return 0;
			}
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL, PluginCheck.Security.DirectDB.UnescapedDBParameter -- Table name is a trusted $wpdb->prefix constant; the query takes no user input.
			return (int) $wpdb->get_var( "SELECT COUNT(*) FROM `{$table}`" );
		}

		/* ── Settings ─────────────────────────────────────────────────────── */

		/**
		 * Register Settings + White Label option stores.
		 */
		public static function register_settings() {
			register_setting( 'ptn_settings_group', 'uichemy_settings', array( 'sanitize_callback' => array( __CLASS__, 'sanitize_settings' ) ) );
			register_setting( 'ptn_wl_group', 'uichemy_white_label', array( 'sanitize_callback' => array( __CLASS__, 'sanitize_white_label' ) ) );
		}

		/**
		 * Settings defaults.
		 *
		 * @return array
		 */
		private static function settings_defaults() {
			return array(
				// One switch per builder. `enable_widget` used to sit here as a single
				// flag, but nothing ever read it — the widget registered regardless.
				// These three replace it and are actually enforced, in
				// uichemy_composer_enabled().
				'enable_elementor'       => 1,
				'enable_gutenberg'       => 1,
				'enable_bricks'          => 1,
				'enable_mcp'             => 1,
				'store_forms'            => 1,
				'enable_frontend_editor' => 1,
				'delete_on_uninstall'    => 0,
				// Which editor mode the composer exposes: 'both' shows the
				// Design/Developer switch; 'design' locks to Design (Chat + Editor);
				// 'developer' locks to Developer (Chat + Editor + Code). String value,
				// special-cased in sanitize_settings().
				'editor_mode'            => 'both',
			);
		}

		/**
		 * Sanitize the settings option.
		 *
		 * @param array $input Raw input.
		 * @return array
		 */
		public static function sanitize_settings( $input ) {
			$out = array();
			foreach ( array_keys( self::settings_defaults() ) as $key ) {
				// editor_mode is a 3-way string choice, not a boolean — whitelist it.
				if ( 'editor_mode' === $key ) {
					$v           = isset( $input[ $key ] ) ? sanitize_key( (string) $input[ $key ] ) : 'both';
					$out[ $key ] = in_array( $v, array( 'both', 'design', 'developer' ), true ) ? $v : 'both';
					continue;
				}
				$out[ $key ] = empty( $input[ $key ] ) ? 0 : 1;
			}
			return $out;
		}

		/**
		 * Render the Settings page.
		 */
		public static function render_settings() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div id="uichemy-dashboard-root" data-screen="settings"></div>';
		}

		/**
		 * Render the Theme Builder page (React screen mounts here).
		 */
		public static function render_theme_builder() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div id="uichemy-dashboard-root" data-screen="theme-builder"></div>';
		}

		/**
		 * Render the Role Manager page (React screen mounts here).
		 */
		public static function render_role_manager() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div id="uichemy-dashboard-root" data-screen="role-manager"></div>';
		}

		/**
		 * License screen mount point (Pro only — the page isn't registered in Free).
		 *
		 * @return void
		 */
		public static function render_license() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div id="uichemy-dashboard-root" data-screen="license"></div>';
		}


		/* ── White Label ──────────────────────────────────────────────────── */

		/**
		 * White Label defaults.
		 *
		 * @return array
		 */
		private static function white_label_defaults() {
			return array(
				'enabled'            => 0,
				'plugin_name'        => '',
				'description'        => '',
				'author'             => '',
				'author_url'         => '',
				'plugin_url'         => '',
				'logo_url'           => '',
				'hide_from_others'   => 0,
				'owner_id'           => 0,
				'widget_name'        => '',
				'widget_icon'        => '',
				'widget_category'    => '',
				'hide_help_links'    => 0,
				'hide_update_news'   => 0,
				'hide_recommend_ads' => 0,
				'force_disable'      => 0,
			);
		}

		/**
		 * Sanitize the White Label option.
		 *
		 * @param array $input Raw input.
		 * @return array
		 */
		public static function sanitize_white_label( $input ) {
			$hide = empty( $input['hide_from_others'] ) ? 0 : 1;

			// The admin who turns "hide from other admins" on becomes the owner
			// (they are, by definition, the only one able to reach this form when
			// it is already on). Cleared when the option is turned off.
			$owner_id = $hide ? get_current_user_id() : 0;

			return array(
				'enabled'            => empty( $input['enabled'] ) ? 0 : 1,
				'plugin_name'        => isset( $input['plugin_name'] ) ? sanitize_text_field( $input['plugin_name'] ) : '',
				'description'        => isset( $input['description'] ) ? sanitize_textarea_field( $input['description'] ) : '',
				'author'             => isset( $input['author'] ) ? sanitize_text_field( $input['author'] ) : '',
				'author_url'         => isset( $input['author_url'] ) ? esc_url_raw( $input['author_url'] ) : '',
				'plugin_url'         => isset( $input['plugin_url'] ) ? esc_url_raw( $input['plugin_url'] ) : '',
				'logo_url'           => isset( $input['logo_url'] ) ? esc_url_raw( $input['logo_url'] ) : '',
				'hide_from_others'   => $hide,
				'owner_id'           => $owner_id,
				'widget_name'        => isset( $input['widget_name'] ) ? sanitize_text_field( $input['widget_name'] ) : '',
				'widget_icon'        => isset( $input['widget_icon'] ) ? sanitize_html_class( $input['widget_icon'] ) : '',
				'widget_category'    => isset( $input['widget_category'] ) ? sanitize_text_field( $input['widget_category'] ) : '',
				'hide_help_links'    => empty( $input['hide_help_links'] ) ? 0 : 1,
				'hide_update_news'   => empty( $input['hide_update_news'] ) ? 0 : 1,
				'hide_recommend_ads' => empty( $input['hide_recommend_ads'] ) ? 0 : 1,
				'force_disable'      => empty( $input['force_disable'] ) ? 0 : 1,
			);
		}

		/**
		 * Render the White Label page — a tabbed configurator with live previews.
		 */
		public static function render_white_label() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return;
			}
			echo '<div id="uichemy-dashboard-root" data-screen="white"></div>';
		}



		/**
		 * A curated set of WordPress Dashicons for the widget icon picker.
		 *
		 * @return array
		 */
		private static function dashicons_list() {
			return array(
				'dashicons-editor-code',
				'dashicons-html',
				'dashicons-media-code',
				'dashicons-block-default',
				'dashicons-layout',
				'dashicons-grid-view',
				'dashicons-screenoptions',
				'dashicons-align-wide',
				'dashicons-align-full-width',
				'dashicons-columns',
				'dashicons-table-row-after',
				'dashicons-editor-table',
				'dashicons-admin-customizer',
				'dashicons-art',
				'dashicons-admin-appearance',
				'dashicons-color-picker',
				'dashicons-star-filled',
				'dashicons-star-half',
				'dashicons-heart',
				'dashicons-flag',
				'dashicons-lightbulb',
				'dashicons-superhero',
				'dashicons-buddicons-activity',
				'dashicons-hammer',
				'dashicons-admin-tools',
				'dashicons-admin-settings',
				'dashicons-admin-generic',
				'dashicons-admin-site',
				'dashicons-admin-page',
				'dashicons-admin-post',
				'dashicons-admin-media',
				'dashicons-admin-links',
				'dashicons-welcome-widgets-menus',
				'dashicons-welcome-write-blog',
				'dashicons-welcome-view-site',
				'dashicons-format-image',
				'dashicons-format-gallery',
				'dashicons-format-video',
				'dashicons-format-aside',
				'dashicons-images-alt2',
				'dashicons-camera',
				'dashicons-video-alt3',
				'dashicons-media-document',
				'dashicons-text',
				'dashicons-editor-paragraph',
				'dashicons-editor-textcolor',
				'dashicons-editor-bold',
				'dashicons-list-view',
				'dashicons-menu',
				'dashicons-menu-alt',
				'dashicons-index-card',
				'dashicons-cover-image',
				'dashicons-slides',
				'dashicons-tickets-alt',
				'dashicons-megaphone',
				'dashicons-cart',
				'dashicons-products',
				'dashicons-store',
				'dashicons-money-alt',
				'dashicons-chart-bar',
				'dashicons-chart-pie',
				'dashicons-analytics',
				'dashicons-dashboard',
				'dashicons-performance',
				'dashicons-marker',
				'dashicons-location',
				'dashicons-calendar-alt',
				'dashicons-clock',
				'dashicons-email-alt',
				'dashicons-phone',
				'dashicons-microphone',
				'dashicons-cloud',
				'dashicons-database',
				'dashicons-open-folder',
				'dashicons-portfolio',
				'dashicons-tag',
				'dashicons-category',
				'dashicons-book',
				'dashicons-welcome-learn-more',
				'dashicons-groups',
				'dashicons-businessperson',
				'dashicons-id',
				'dashicons-awards',
				'dashicons-shield',
				'dashicons-lock',
				'dashicons-privacy',
				'dashicons-visibility',
				'dashicons-smartphone',
				'dashicons-tablet',
				'dashicons-desktop',
				'dashicons-laptop',
			);
		}

		/* ── Form field partials ──────────────────────────────────────────── */




		/* ── Inline icons (Lucide-style, MIT) ─────────────────────────────── */
	}
}
