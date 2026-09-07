<?php
/**
 * Chrome-free render mode for the bundled Hatch admin pages.
 *
 * The dashboard's "Sync with Elementor" screen shows Hatch's setup wizard and
 * Hatch's admin UI in its own content area, inside a same-origin iframe. An
 * iframe rather than a second React root on the page, deliberately:
 *
 *   - Hatch's admin is a complete React app with its OWN design system, its own
 *     resets and its own Inter web font. Mounted into this dashboard's DOM the
 *     two token sets and two resets would fight, and neither app's styling
 *     survives that intact.
 *   - Hatch's wizard advances through real form POSTs to `admin-post.php`
 *     handlers (see SetupApp.jsx) so that all of its server-side logic runs.
 *     Those are full page loads. Inside an iframe they are free; on the
 *     dashboard page itself every one of them would blow the SPA away.
 *   - Nothing about Hatch had to be rewritten to get there.
 *
 * What "chrome-free" means: the admin bar, the admin menu rail and the footer
 * are removed for the embedded request only, so the iframe carries just the
 * page body. Admin NOTICES are deliberately left visible — Hatch warns about a
 * missing libsodium and about plain permalinks that way, and silently hiding a
 * security warning to tidy up a layout is the wrong trade.
 *
 * Keeping the mode sticky across navigation
 * -----------------------------------------
 * Hatch builds well over a dozen `admin_url( 'admin.php?page=hatch…' )` links
 * and issues `wp_safe_redirect()` to more of them from its admin-post handlers.
 * Patching each call site would be a large, fragile diff, so the flag is
 * carried by two filters instead — `admin_url` for every URL Hatch mints and
 * `wp_redirect` for every hop it takes. Between them the whole surface stays
 * embedded without one edit to Hatch's own code.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Hatch_Embed' ) ) {

	/**
	 * Renders the bundled Hatch pages without WordPress admin chrome.
	 */
	final class Uich_Hatch_Embed {

		/**
		 * Query flag that asks for the chrome-free render.
		 *
		 * A presence-only display flag on a GET the user just followed: it
		 * authorises nothing, changes no state and reveals nothing that the
		 * page's own `manage_options` check does not already gate. So there is
		 * no nonce to verify — the same reasoning the dashboard's own
		 * `uich_tb_new` launcher flag is documented with.
		 */
		const FLAG = 'uich_hatch_embed';

		/**
		 * Memoised answer for this request.
		 *
		 * @var bool|null
		 */
		private static $is_embed;

		/**
		 * Register the hooks, but only for a request that is actually embedded.
		 *
		 * @return void
		 */
		public static function boot() {
			if ( ! self::is_embed() ) {
				return;
			}

			add_filter( 'show_admin_bar', '__return_false', 99 );
			add_filter( 'admin_url', array( __CLASS__, 'keep_flag_on_url' ), 10, 2 );
			add_filter( 'wp_redirect', array( __CLASS__, 'keep_flag_on_redirect' ), 10, 1 );
			add_filter( 'admin_body_class', array( __CLASS__, 'body_class' ) );
			add_action( 'admin_head', array( __CLASS__, 'strip_chrome_css' ), 99 );
		}

		/**
		 * Is this request an embedded Hatch page?
		 *
		 * Two conditions, both required:
		 *
		 *   1. A Hatch admin page (or an admin-post hop belonging to one). Never
		 *      strip the chrome off an unrelated admin screen.
		 *   2. The flag is present, OR the browser told us this navigation
		 *      targets an iframe.
		 *
		 * Condition 2's second half is what makes the mode robust: `Sec-Fetch-Dest:
		 * iframe` is sent by the browser on every navigation inside an iframe,
		 * including form POSTs, so it holds even where the flag was dropped. It
		 * is a hint, not the mechanism — the flag and the two filters in boot()
		 * work on their own for browsers that do not send Fetch Metadata.
		 *
		 * Deliberately NO capability check. boot() runs at plugin-load time, and
		 * calling current_user_can() there resolves the current user before
		 * `plugins_loaded` has finished — which preempts any auth plugin that
		 * registers a `determine_current_user` filter and can log the wrong user
		 * in, or nobody. There is nothing for a capability check to protect here
		 * either: this decides CSS and query-string cosmetics on a page whose own
		 * `manage_options` check already gates every byte of content. A visitor
		 * without the capability gets Hatch's "Permission denied" either way.
		 *
		 * @return bool
		 */
		public static function is_embed() {
			if ( null !== self::$is_embed ) {
				return self::$is_embed;
			}

			self::$is_embed = false;

			if ( ! is_admin() || ! self::is_hatch_request() ) {
				return self::$is_embed;
			}

			// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Presence-only display flag; see the FLAG docblock.
			$flagged = ! empty( $_GET[ self::FLAG ] ) || ! empty( $_POST[ self::FLAG ] );
			// phpcs:enable WordPress.Security.NonceVerification.Recommended

			$dest = isset( $_SERVER['HTTP_SEC_FETCH_DEST'] )
				? strtolower( sanitize_text_field( wp_unslash( (string) $_SERVER['HTTP_SEC_FETCH_DEST'] ) ) )
				: '';

			self::$is_embed = $flagged || 'iframe' === $dest;

			return self::$is_embed;
		}

		/**
		 * Does this request belong to the Hatch admin?
		 *
		 * Either an `admin.php?page=hatch…` screen, or an `admin-post.php` hop
		 * whose action is one of Hatch's. The second case is what carries the
		 * wizard's form POSTs, which land on admin-post.php rather than on a
		 * page of their own.
		 *
		 * @return bool
		 */
		private static function is_hatch_request() {
			// phpcs:disable WordPress.Security.NonceVerification.Recommended -- Read-only routing check; the handlers do their own nonce + capability checks.
			$page = isset( $_REQUEST['page'] ) ? sanitize_key( wp_unslash( (string) $_REQUEST['page'] ) ) : '';
			if ( 'hatch' === $page || 0 === strpos( $page, 'hatch-' ) ) {
				return true;
			}

			$action = isset( $_REQUEST['action'] ) ? sanitize_key( wp_unslash( (string) $_REQUEST['action'] ) ) : '';
			// phpcs:enable WordPress.Security.NonceVerification.Recommended

			return '' !== $action && 0 === strpos( $action, 'hatch_' );
		}

		/**
		 * The URL the dashboard should load in its iframe.
		 *
		 * @param string $page Admin page slug — 'hatch-setup' for the wizard,
		 *                     'hatch' for the full admin UI.
		 * @return string
		 */
		public static function url( $page = 'hatch-setup' ) {
			$page = sanitize_key( $page );
			if ( 'hatch' !== $page && 0 !== strpos( $page, 'hatch-' ) ) {
				$page = 'hatch-setup';
			}

			return add_query_arg(
				array(
					'page'      => $page,
					self::FLAG  => 1,
				),
				admin_url( 'admin.php' )
			);
		}

		/**
		 * Carry the flag on every admin URL Hatch mints for itself.
		 *
		 * Scoped to Hatch's own pages plus `admin-post.php`, which is where the
		 * wizard POSTs. Widening it to admin-post.php means an unrelated plugin's
		 * admin-post URL rendered on this page picks up a stray query arg too —
		 * harmless, since handlers read the args they know and ignore the rest,
		 * and the blast radius is one iframe showing one Hatch screen. The
		 * alternative is the wizard's POST landing outside embed mode, which
		 * breaks the flow visibly on the very next step.
		 *
		 * @param string $url  The complete admin URL.
		 * @param string $path Path relative to the admin URL, as passed in.
		 * @return string
		 */
		public static function keep_flag_on_url( $url, $path ) {
			$path = (string) $path;

			$is_hatch_page = false !== strpos( $path, 'page=hatch' );
			$is_admin_post = 0 === strpos( $path, 'admin-post.php' );

			if ( ! $is_hatch_page && ! $is_admin_post ) {
				return $url;
			}
			if ( false !== strpos( (string) $url, self::FLAG ) ) {
				return $url;
			}

			// add_query_arg(), never admin_url() — calling that from inside the
			// `admin_url` filter would recurse until the stack blows.
			return add_query_arg( self::FLAG, 1, $url );
		}

		/**
		 * Carry the flag across every redirect that lands back on a Hatch page.
		 *
		 * Hatch's admin-post handlers finish with `wp_safe_redirect( admin_url(
		 * 'admin.php?page=hatch…' ) )`. Those URLs are built through the filter
		 * above and so already carry the flag; this is the safety net for any
		 * redirect assembled some other way, and for external callers.
		 *
		 * @param string $location Redirect target.
		 * @return string
		 */
		public static function keep_flag_on_redirect( $location ) {
			$location = (string) $location;

			if ( false === strpos( $location, 'page=hatch' ) ) {
				return $location;
			}
			if ( false !== strpos( $location, self::FLAG ) ) {
				return $location;
			}

			return add_query_arg( self::FLAG, 1, $location );
		}

		/**
		 * A hook for the CSS below, and for anything Hatch may want to style
		 * differently when it knows it is embedded.
		 *
		 * @param string $classes Space-separated body classes.
		 * @return string
		 */
		public static function body_class( $classes ) {
			return trim( $classes . ' uich-hatch-embed' );
		}

		/**
		 * Remove the WordPress admin chrome for this request only.
		 *
		 * Printed at `admin_head` priority 99 so it lands after the admin
		 * stylesheets it has to beat, which is also why every rule is
		 * `!important` — core's own selectors are more specific.
		 *
		 * Notices are NOT hidden: see the file docblock.
		 *
		 * @return void
		 */
		public static function strip_chrome_css() {
			?>
<style id="uich-hatch-embed-css">
/* The rail, the bar and the footer belong to the OUTER page, not to this one. */
#adminmenumain,
#adminmenuback,
#adminmenuwrap,
#wpadminbar,
#wpfooter,
#screen-meta,
#screen-meta-links {
	display: none !important;
}
/* Reclaim the gutters those elements were holding open. */
html.wp-toolbar {
	padding-top: 0 !important;
}
#wpcontent,
#wpbody-content {
	margin-left: 0 !important;
	padding-left: 0 !important;
}
#wpbody-content {
	padding-bottom: 0 !important;
}
#wpbody {
	padding-top: 0 !important;
}
#wpwrap,
#wpcontent {
	min-height: 0 !important;
}
/* The iframe is measured from body.scrollHeight to size itself, so the document
   must not claim viewport height it isn't using, and must not paint a ground of
   its own over the dashboard's. */
html,
body.uich-hatch-embed {
	height: auto !important;
	min-height: 0 !important;
	background: transparent !important;
}
</style>
			<?php
		}
	}
}
