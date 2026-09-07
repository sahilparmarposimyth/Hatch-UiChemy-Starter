<?php
/**
 * Asset enqueue for the new dashboard.
 *
 * Loads new-dashboard/build/index.js + index.css on the UiChemy (New)
 * admin screen only, and localises the bootstrap payload into the global
 * `uich_nd_boot`.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Enqueue' ) ) {

	final class Uich_ND_Enqueue {

		const HANDLE_JS  = 'uich-nd-script';
		const HANDLE_CSS = 'uich-nd-style';

		public static function boot() {
			add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ), 10, 1 );
			add_action( 'enqueue_block_editor_assets', array( __CLASS__, 'enqueue_condition_launcher' ) );
		}

		/**
		 * Which admin page slugs the new dashboard renders on.
		 */
		public static function page_hooks() {
			return array(
				'toplevel_page_uichemy',
			);
		}

		public static function enqueue( $page ) {
			if ( ! in_array( $page, self::page_hooks(), true ) ) {
				return;
			}
			self::enqueue_bundle();
		}

		/**
		 * Load index.js + index.css and everything they expect on the page.
		 *
		 * Split out of enqueue() so the block editor's one-time Edit Condition
		 * launcher can mount the same React screens (it reuses the dashboard's
		 * ConditionsDialog) without a second copy of the asset wiring.
		 */
		/**
		 * @param bool $with_page_chrome Load the extras that only make sense on our
		 *                               own full-screen admin page. FALSE in the
		 *                               block editor: the legacy sheet zeroes
		 *                               #wpcontent's padding-left and hides
		 *                               #wpfooter with UNGATED rules, which would
		 *                               drag the editor under the admin menu.
		 */
		private static function enqueue_bundle( $with_page_chrome = true ) {
			$css_path = UICH_ND_BUILD_PATH . 'index.css';
			$js_path  = UICH_ND_BUILD_PATH . 'index.js';
			$ver_css  = file_exists( $css_path ) ? (string) filemtime( $css_path ) : UICH_VERSION;
			$ver_js   = file_exists( $js_path ) ? (string) filemtime( $js_path ) : UICH_VERSION;

			if ( file_exists( $css_path ) ) {
				wp_enqueue_style( self::HANDLE_CSS, UICH_ND_BUILD_URL . 'index.css', array(), $ver_css, 'all' );
			}

			// Fonts: the dashboard renders in Zalando Sans, which ships bundled via
			// @font-face inside index.css (design-system tokens) — no web-font
			// request needed. Plus Jakarta Sans was dropped when the builder island
			// was unified onto the design-system font; the editor panel's Roboto is
			// loaded from its own asset (uichemy-composer-editor-panel.css), not here.

			if ( file_exists( $js_path ) ) {
				/*
				 * Read the dependency list webpack computed rather than hard-coding it.
				 * The merged builder screens pull in the automatic JSX runtime, so the
				 * build now also needs 'react-jsx-runtime' — a hard-coded list silently
				 * omits it and the bundle dies at runtime on a missing jsx factory.
				 * Anything the build starts or stops importing is picked up from here.
				 */
				$asset_path = UICH_ND_BUILD_PATH . 'index.asset.php';
				$asset      = file_exists( $asset_path ) ? include $asset_path : array();
				$deps       = ( isset( $asset['dependencies'] ) && is_array( $asset['dependencies'] ) )
					? $asset['dependencies']
					: array( 'react', 'react-dom', 'wp-dom-ready', 'wp-element', 'wp-i18n' );

				wp_enqueue_script(
					self::HANDLE_JS,
					UICH_ND_BUILD_URL . 'index.js',
					$deps,
					isset( $asset['version'] ) ? (string) $asset['version'] : $ver_js,
					true
				);
				wp_localize_script( self::HANDLE_JS, 'uich_nd_boot', self::boot_payload() );
				wp_set_script_translations( self::HANDLE_JS, 'uichemy' );

				self::enqueue_builder_screen_deps( $with_page_chrome );
			} else {
				add_action( 'admin_notices', array( __CLASS__, 'missing_build_notice' ) );
			}
		}

		/**
		 * Everything the screens that came from the merged builder runtime need.
		 *
		 * Theme Builder, Settings and Form Submissions are UiChemy's own React
		 * screens, rendered as tabs of this dashboard (see BuilderScreenHost.jsx).
		 * They read `window.uichemyDashboard`, which the standalone plugin used to
		 * localize from UiChemy_Admin_Menu::enqueue(). That method is a no-op in a
		 * merged build — this plugin owns the one dashboard page — so the payload is
		 * attached to OUR script handle here instead, from the same builder.
		 *
		 * Nothing is enqueued when the builder isn't running (a standalone UiChemy
		 * plugin is still active and ours stood down), in which case those tabs fall
		 * back to their Placeholder.
		 *
		 * The guard is deliberately NOT class_exists(): when a standalone UiChemy /
		 * UiChemy Pro is active, Uich_Composer_Loader stands down so OUR copy of the
		 * runtime never loads — but the standalone plugin declares a
		 * `UiChemy_Admin_Menu` of its own, so the class name is present anyway.
		 * Checking the class name alone fatals the whole dashboard page with "Call
		 * to undefined method UiChemy_Admin_Menu::dashboard_data()".
		 *
		 * Two checks instead, because they answer different questions:
		 *
		 *   UICH_COMPOSER_MERGED  is defined only when our bundled runtime actually
		 *                        booted, so it is the direct answer to "is the class
		 *                        that is loaded OURS?"
		 *   method_exists()      covers the reverse case — our runtime booted, but
		 *                        from a build predating dashboard_data().
		 *
		 * @return void
		 */
		private static function enqueue_builder_screen_deps( $with_page_chrome = true ) {
			if ( ! defined( 'UICH_COMPOSER_MERGED' ) || ! method_exists( 'UiChemy_Admin_Menu', 'dashboard_data' ) ) {
				return;
			}

			// The payload is what the screens actually need — tbAjax reads its
			// nonce and ajaxUrl from it — so it loads in both places.
			wp_localize_script(
				self::HANDLE_JS,
				'uichemyDashboard',
				UiChemy_Admin_Menu::dashboard_data()
			);

			// Everything below dresses OUR admin page. None of it belongs in the
			// block editor, and the legacy sheet at the end would actively break it.
			if ( ! $with_page_chrome ) {
				return;
			}

			// The builder screens use Dashicons for the widget-icon picker, and
			// White Label opens the media library for its logo field.
			wp_enqueue_style( 'dashicons' );
			wp_enqueue_media();

			/*
			 * The legacy `ptn-` stylesheet. Not optional: White Label and the licence
			 * screen are only PARTLY Tailwind — their page head, tab strip, field grid
			 * and the whole live-preview mock (.ptn-wl-*, .ptn-pv-*, .ptn-pagehead,
			 * .ptn-card, .ptn-form-footer) are hand-written CSS that lives here. Without
			 * it those screens render as an unstyled vertical stack.
			 *
			 * Safe to load on this page: all 189 rules are namespaced under `.ptn-*`
			 * or `#ptn-app`, with no bare element selectors, so nothing can reach the
			 * dashboard's own styles. Its two global rules (#wpfooter display:none and
			 * #wpbody-content padding-bottom:0) are exactly what app.scss already sets
			 * for this mount, so they are duplicates rather than a conflict. `#ptn-app`
			 * itself is never rendered here — that id carries UiChemy's full-screen
			 * 100vh shell, which this dashboard deliberately does not use.
			 */
			$legacy = UICH_PATH . 'uichemy-composer/admin/css/uichemy-dashboard.css';
			if ( file_exists( $legacy ) ) {
				wp_enqueue_style(
					'uich-builder-legacy',
					UICH_URL . 'uichemy-composer/admin/css/uichemy-dashboard.css',
					array( 'dashicons' ),
					(string) filemtime( $legacy )
				);
			}

			// No Inter web font: the builder island now renders in the dashboard's
			// design-system font (Zalando Sans) like the rest of the dashboard, so
			// the typeface the UiChemy screens were originally designed in is no
			// longer loaded.
		}

		/**
		 * One-time "Edit Condition" launcher in the block editor.
		 *
		 * Deliberately one-time. The dashboard appends `uich_tb_new=1` to the URL
		 * it opens right after creating a template, which is the single moment the
		 * author is being asked "where should this appear?". The launcher strips
		 * that flag from the address bar as it mounts, so a refresh arrives without
		 * it and nothing here loads at all — from then on conditions are edited in
		 * the dashboard, which stays the one place that owns them.
		 *
		 * Gating on the flag SERVER-side is what keeps the cost at zero: on every
		 * ordinary edit of a template this method returns before enqueuing a thing.
		 *
		 * @return void
		 */
		public static function enqueue_condition_launcher() {
			// Presence-only flag on a GET the user just followed; it authorises
			// nothing and changes no state, so there is no nonce to check.
			// phpcs:disable WordPress.Security.NonceVerification.Recommended
			if ( empty( $_GET['uich_tb_new'] ) ) {
				return;
			}
			$post_id = isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;
			// phpcs:enable WordPress.Security.NonceVerification.Recommended

			if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
				return;
			}
			if ( ! class_exists( 'UiChemy_Template_CPT' )
				|| UiChemy_Template_CPT::POST_TYPE !== get_post_type( $post_id ) ) {
				return;
			}
			// Same two checks the dashboard tab makes before it will render these
			// screens at all — see enqueue_builder_screen_deps().
			if ( ! defined( 'UICH_COMPOSER_MERGED' )
				|| ! method_exists( 'UiChemy_Theme_Builder_Admin', 'template_payload' ) ) {
				return;
			}

			$tpl = UiChemy_Theme_Builder_Admin::template_payload( $post_id );
			if ( ! is_array( $tpl ) || empty( $tpl['type'] ) ) {
				return;
			}
			// Only the types that HAVE display conditions. Mirrors CONDITION_TYPES
			// in ThemeBuilder.jsx — a Search or 404 template has nowhere to target,
			// and the dashboard hides the menu item for those too.
			if ( ! in_array( $tpl['type'], array( 'header', 'footer', 'single', 'archive' ), true ) ) {
				return;
			}

			self::enqueue_bundle( false );

			wp_localize_script(
				self::HANDLE_JS,
				'uich_tb_condition_launcher',
				array(
					// The template in exactly the shape ConditionsDialog expects, so
					// the editor needs no extra round-trip before it can open.
					'tpl'  => $tpl,
					// Named here rather than hard-coded in JS: the same string has to
					// be added by the dashboard and removed by the launcher.
					'flag' => 'uich_tb_new',
				)
			);
		}

		public static function missing_build_notice() {
			?>
			<div class="notice notice-warning">
				<p><strong>UiChemy (New):</strong> the React build is missing.
				Run <code>cd new-dashboard &amp;&amp; npm install &amp;&amp; npm run build</code> from the plugin root.</p>
			</div>
			<?php
		}

		/**
		 * Base URL for the user-facing Connection Link.
		 *
		 * Pretty / index permalinks already give a clean, path-based REST
		 * root via rest_url() (".../wp-json/" or ".../index.php/wp-json/").
		 * Plain permalinks would give ".../?rest_route=/" — instead we return
		 * the bare ".../index.php" entry point and let the Figma plugin add
		 * the ?rest_route=/<endpoint> query itself at request time.
		 */
		public static function connect_url_base() {
			if ( get_option( 'permalink_structure' ) ) {
				return rest_url();
			}
			return home_url( '/index.php' );
		}

		/**
		 * Gravatar URL for the connected AI Website Creator account (the same
		 * email the profile menu shows), falling back to the WP user's email.
		 * Mirrors the Figma plugin — d=404 so the UI shows the name initial when
		 * the account has no Gravatar.
		 *
		 * @param WP_User|null $wp_user
		 * @return string
		 */
		private static function account_gravatar_url( $wp_user ) {
			$email = Uich_ND_Auth::get_account_email();
			if ( '' === $email && $wp_user ) {
				$email = (string) $wp_user->user_email;
			}
			if ( '' === $email ) {
				return '';
			}
			return esc_url_raw( 'https://www.gravatar.com/avatar/' . md5( strtolower( trim( $email ) ) ) . '?s=128&d=404' );
		}

		/**
		 * Bootstrap data injected as `window.uich_nd_boot`.
		 */
		public static function boot_payload() {
			$user = wp_get_current_user();

			return array(
				'mountId'    => UICH_ND_MOUNT,
				'restRoot'   => esc_url_raw( rest_url( Uich_ND_Api::NS ) ),
				'restNonce'  => wp_create_nonce( 'wp_rest' ),
				'ajaxUrl'    => admin_url( 'admin-ajax.php' ),
				'ajaxNonce'  => wp_create_nonce( Uich_ND_App_Password::NONCE_ACTION ),
				'adminUrl'   => admin_url(),
				'pluginUrl'  => UICH_URL,
				'version'    => UICH_VERSION,
				'siteName'   => get_bloginfo( 'name' ),
				// White Label branding for the dashboard chrome (sidebar rail,
				// onboarding wizard, login screen). Sent on the BOOT payload rather
				// than only on `uichemyDashboard` because that second payload is
				// attached by enqueue_builder_screen_deps(), which stands down when
				// the builder runtime is not ours — and the shell still has to
				// render something in that case.
				'brand'      => uich_brand_payload(),
				'siteUrl'    => get_option( 'siteurl' ),
				'restUrl'    => rest_url(),
				// Base for the user-facing Connection Link. On pretty
				// permalinks this is the clean ".../wp-json/" root; on plain
				// permalinks rest_url() would hand back ".../?rest_route=/",
				// so we expose the ".../index.php" entry point instead and let
				// the Figma plugin append ?rest_route=/<endpoint> itself. Keeps
				// the copied link short and route-free.
				'connectUrl' => esc_url_raw( self::connect_url_base() ),
				// Permalink-aware MCP endpoints. rest_url() handles pretty vs
				// plain permalinks (?rest_route= / index.php). Send the full
				// URLs from PHP so React never has to guess.
				//
				// v2 is the gateway surface an AI agent should connect to: it
				// serves the discovery briefing, the skills and the full ability
				// catalogue. v1 is the older flat tool list and stays where the
				// Figma plugin expects it (see connect_url_base above), which is
				// why only this AI-agent config moved.
				'mcpUrls'    => array(
					'regular' => esc_url_raw( rest_url( 'uichemy/v2/mcp' ) ),
				),
				'user'       => array(
					'id'       => $user ? (int) $user->ID : 0,
					'name'     => $user ? esc_html( $user->display_name ) : '',
					'login'    => $user ? sanitize_user( $user->user_login ) : '',
					'email'    => $user ? sanitize_email( $user->user_email ) : '',
					'avatar'   => $user ? esc_url( get_avatar_url( $user->ID ) ) : '',
					'gravatar' => self::account_gravatar_url( $user ),
					'isAdmin'  => current_user_can( 'manage_options' ),
				),
				'auth'       => Uich_ND_Auth::get_boot_state(),
				'state'      => array(
					'env'         => Uich_ND_Settings::env_check(),
					'connection'  => Uich_ND_Settings::connection_check(),
					'builders'    => Uich_ND_Settings::detect_builders(),
					'builder'     => Uich_ND_Settings::get_builder(),
					'mode'        => Uich_ND_Settings::get_mode(),
					'onboarded'   => Uich_ND_Settings::is_onboarded(),
					'appPassword' => Uich_ND_App_Password::get_dashboard_state(),
					'localEnv'    => Uich_ND_Settings::get_local_env_state(),
					'uichemy'     => Uich_ND_Settings::detect_uichemy(),
					'uichemyPro'  => Uich_ND_Settings::detect_uichemy_pro(),
				),
				'urls'       => array(
					'docs'      => 'https://uichemy.com/docs',
					'chat'      => 'https://uichemy.com/chat',
					'community' => 'https://store.posimyth.com/helpdesk',
				),
				// The merged Hatch runtime (hatch/), read by the "Sync with
				// Elementor" screen. Always present as a key so the screen can
				// tell "not available" apart from an older build whose payload
				// predates the merge, and never has to guess a URL.
				'hatch'      => class_exists( 'Uich_Hatch_Bridge' )
					? Uich_Hatch_Bridge::boot_payload()
					: array( 'available' => false, 'standalone' => false, 'buildMissing' => false ),
			);
		}
	}
}
