<?php
/**
 * Chrome-free render mode for the bundled Hatch admin pages.
 *
 * The dashboard's "Sync with Astro" screen shows Hatch's setup wizard and
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
 * Knowing when to LEAVE the frame
 * -------------------------------
 * Not every hop should stay inside it. Hatch hands off to external origins
 * mid-flow — the deploy broker, and any provider OAuth screen — and no such
 * service allows itself to be framed, so those navigations died on
 * "refused to connect". The same `wp_redirect` filter therefore splits on the
 * target's host: same-site keeps the 302 and the flag, off-site is answered
 * with a document that moves the TOP window instead. See break_out_of_frame().
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
			add_filter( 'wp_redirect', array( __CLASS__, 'filter_redirect' ), 10, 1 );
			add_filter( 'admin_body_class', array( __CLASS__, 'body_class' ) );
			add_action( 'admin_head', array( __CLASS__, 'strip_chrome_css' ), 99 );

			// Priority 11: Hatch enqueues its bundle and localises
			// `window.hatchBoot` at priority 10, and `before` inline scripts on a
			// handle are emitted in the order they were added. Later priority =
			// our line lands after that assignment rather than before it, where
			// it would be overwritten.
			add_action( 'admin_enqueue_scripts', array( __CLASS__, 'pin_light_theme' ), 11 );
		}

		/**
		 * Pin Hatch's palette to light for the embedded render.
		 *
		 * Hatch's admin resolves its own theme from localStorage, then from
		 * `prefers-color-scheme` — so a visitor whose OS is in dark mode got a
		 * dark panel dropped into the middle of this plugin's light dashboard,
		 * which reads as a rendering fault rather than a choice. Inside the frame
		 * the palette has to match the host page, not the OS.
		 *
		 * Set through Hatch's own boot payload rather than by re-declaring its
		 * ~34 dark-palette tokens in the stylesheet below. Duplicating the values
		 * would work — an important rule at higher specificity beats
		 * `[data-hx-theme="dark"] .hatch-react` — but it forks Hatch's palette,
		 * and the copy would drift silently the first time Hatch retunes a
		 * colour. This way there is one palette and the app genuinely runs in
		 * light mode, so its own React theme state stays truthful.
		 *
		 * Nothing is written to localStorage: Hatch's full-screen admin is one
		 * click away on this same screen ("Open full screen") and still follows
		 * whatever the user picked for it.
		 *
		 * @param string $page Current admin page hook.
		 * @return void
		 */
		public static function pin_light_theme( $page ) {
			// Same test Hatch's own enqueue uses to decide these are its screens.
			if ( false === strpos( (string) $page, 'hatch' ) ) {
				return;
			}
			if ( ! wp_script_is( 'hatch-admin-react', 'enqueued' ) ) {
				return;
			}

			wp_add_inline_script(
				'hatch-admin-react',
				'window.hatchBoot = window.hatchBoot || {}; window.hatchBoot.forceTheme = "light";',
				'before'
			);
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
		public static function filter_redirect( $location ) {
			$location = (string) $location;
			if ( '' === $location ) {
				return $location;
			}

			$host = strtolower( (string) wp_parse_url( $location, PHP_URL_HOST ) );
			$home = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );

			// Relative, or somewhere on this site: an ordinary 302 inside the
			// frame is exactly right. Just keep the embed flag attached.
			if ( '' === $host || $host === $home ) {
				return self::keep_flag_on_redirect( $location );
			}

			// Off-site, but explicitly cleared to render inside the frame.
			// Leave the 302 alone so the flow never leaves this screen.
			if ( in_array( $host, self::frameable_hosts(), true ) ) {
				return $location;
			}

			return self::break_out_of_frame( $location );
		}

		/**
		 * Off-site hosts allowed to stay INSIDE the frame.
		 *
		 * Empty by default. Every off-site hop escapes to the top window unless
		 * something puts its host on this list, because a page that forbids
		 * framing renders the browser's "refused to connect" rather than
		 * anything useful.
		 *
		 * The deploy broker is normally added here for the duration of one hop,
		 * by Uich_Hatch_Bridge::on_deploy_prepared(), and only because the broker
		 * said it would work: its /prepare reply carries `frameable`, which it
		 * sends when its build page emits
		 *
		 *     Content-Security-Policy: frame-ancestors <this site>
		 *
		 * scoped to the site that owns the ticket, never `*`. A broker that
		 * predates that simply omits the flag and the deploy keeps taking over
		 * the tab, so there is no version to sniff and nothing to regress.
		 *
		 * (`frame-ancestors` rather than removing the `X-Frame-Options:
		 * SAMEORIGIN` the edge in front of the broker adds: per the CSP spec, a
		 * response carrying frame-ancestors makes the browser ignore
		 * X-Frame-Options outright. So it works with that header still there.)
		 *
		 * The constant and the filter below stay for the cases negotiation
		 * cannot cover — a self-hosted broker behind a proxy that strips the
		 * header, or some other off-site step that turns out to be frameable:
		 *
		 *     define( 'UICH_HATCH_FRAMEABLE_HOSTS', 'deploy.example.com' );
		 *
		 *     add_filter( 'uich_hatch_frameable_hosts', function ( $hosts ) {
		 *         $hosts[] = 'deploy.example.com';
		 *         return $hosts;
		 *     } );
		 *
		 * Nothing about the deploy protocol changes when a host is on the list:
		 * the browser still loads the broker's /start, the broker still redirects
		 * back to `admin-post.php?action=hatch_deploy_callback`, and that hop is
		 * same-origin so it comes back through the filters above and stays
		 * embedded. The whole round trip just happens without leaving the screen.
		 *
		 * @return string[] Lower-case hostnames.
		 */
		private static function frameable_hosts() {
			$hosts = array();

			if ( defined( 'UICH_HATCH_FRAMEABLE_HOSTS' ) ) {
				$hosts = explode( ',', (string) UICH_HATCH_FRAMEABLE_HOSTS );
			}

			/**
			 * Filter the off-site hosts that may render inside the embedded
			 * Hatch frame instead of taking over the top window.
			 *
			 * Only add a host that actually permits framing from this site (see
			 * frameable_hosts() for the header it has to send) — otherwise the
			 * browser refuses the frame and the panel shows its error page.
			 *
			 * @param string[] $hosts Hostnames, no scheme.
			 */
			$hosts = (array) apply_filters( 'uich_hatch_frameable_hosts', $hosts );

			$clean = array();
			foreach ( $hosts as $host ) {
				$host = strtolower( trim( (string) $host ) );
				if ( '' !== $host ) {
					$clean[] = $host;
				}
			}

			return array_values( array_unique( $clean ) );
		}

		/**
		 * Same-site redirect: carry the flag so the next page stays embedded.
		 *
		 * Hatch's admin-post handlers finish with `wp_safe_redirect( admin_url(
		 * 'admin.php?page=hatch…' ) )`. Those URLs are built through the
		 * `admin_url` filter above and so already carry the flag; this is the
		 * safety net for any redirect assembled some other way.
		 *
		 * @param string $location Redirect target.
		 * @return string
		 */
		private static function keep_flag_on_redirect( $location ) {
			if ( false === strpos( $location, 'page=hatch' ) ) {
				return $location;
			}
			if ( false !== strpos( $location, self::FLAG ) ) {
				return $location;
			}

			return add_query_arg( self::FLAG, 1, $location );
		}

		/**
		 * Off-site redirect: navigate the TOP window instead of the frame.
		 *
		 * Hatch hands off to external origins mid-flow. The one that matters is
		 * the deploy broker — Hatch_Deploy_Broker::handle_start_deploy() ends in
		 * `wp_redirect( <broker>/deploy/<provider>/start?ticket=… )`, and its own
		 * comment there says "send the BROWSER to the broker's live-log page".
		 * Framed, that 302 navigated the iframe instead, and the broker (like any
		 * sensible service) refuses to be framed, so the panel showed
		 *
		 *     hatch.adityaarsharma.com refused to connect.
		 *
		 * A cross-origin hand-off simply cannot complete inside the frame: the
		 * frame is the wrong target for it. So this stops the 302 and returns a
		 * document that moves the top-level window instead. Returning '' is what
		 * stops it — wp_redirect() bails on a falsy filtered location without
		 * sending headers, and every caller does `wp_redirect(); exit;`, so the
		 * body printed here becomes the response.
		 *
		 * Where the user ends up: the broker sends them back to
		 * `admin-post.php?action=hatch_deploy_callback`, which is now a top-level
		 * request, and Hatch's callback lands them on `admin.php?page=hatch`. That
		 * is full-screen rather than back inside the dashboard — deliberate, since
		 * a deploy is long-running and worth watching full-screen. They return to
		 * this screen through the plugin's own menu.
		 *
		 * @param string $location Off-site redirect target.
		 * @return string Empty string, which suppresses the redirect.
		 */
		private static function break_out_of_frame( $location ) {
			// Only real web navigations. Anything else falls through to the
			// normal redirect rather than being turned into a scripted one.
			$scheme = strtolower( (string) wp_parse_url( $location, PHP_URL_SCHEME ) );
			if ( 'http' !== $scheme && 'https' !== $scheme ) {
				return $location;
			}
			// Headers already gone (an unusual caller) — a scripted breakout
			// cannot win against a redirect that is already on the wire.
			if ( headers_sent() ) {
				return $location;
			}

			nocache_headers();
			header( 'Content-Type: text/html; charset=utf-8' );

			printf(
				'<!doctype html><meta charset="utf-8"><title>%1$s</title>'
				// The frame is same-origin with its host, so it is allowed to
				// navigate the top window. `replace` keeps this hop out of the
				// history, so Back does not bounce through it.
				. '<script>try{window.top.location.replace(%2$s);}catch(e){window.location.replace(%2$s);}</script>'
				. '<p style="font:14px/1.6 system-ui,sans-serif;padding:24px">%1$s<br><a href="%3$s">%4$s</a></p>',
				esc_html__( 'Continuing…', 'uichemy' ),
				wp_json_encode( $location ),
				esc_url( $location ),
				esc_html__( 'Continue', 'uichemy' )
			);

			return '';
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
/* The iframe is measured from the document's scrollHeight to size itself, so the
   document must not claim viewport height it isn't using, and must not paint a
   ground of its own over the dashboard's. */
html,
body.uich-hatch-embed {
	height: auto !important;
	min-height: 0 !important;
	background: transparent !important;
}
/* THE rule that makes the auto-height work at all.
 *
 * Both Hatch admin apps set `minHeight: '100vh'` INLINE on their root
 * `.hatch-react` div (admin-react/src/index.jsx and setup/SetupApp.jsx). In a
 * normal admin page that fills the window; inside an iframe `100vh` resolves to
 * the IFRAME's height, which makes the measurement self-referential — the
 * content is always at least as tall as the frame, so scrollHeight can never
 * report that the frame is too small, the height settles early and everything
 * past it becomes an inner scrollbar.
 *
 * `!important` here beats the inline declaration (an important author rule wins
 * over a normal inline one), so the height becomes content-driven and the frame
 * can grow to fit. The alternative was threading an "embedded" flag through
 * Hatch's boot payload and editing both JSX roots; this leaves Hatch's source
 * alone. The app's own background and padding are untouched — only the
 * viewport-height floor goes.
 */
.hatch-react {
	min-height: 0 !important;
}
/* The palette is pinned to light for this render (see pin_light_theme), so the
   app's own light/dark switch would only ever contradict what is on screen —
   its icon says one thing while the panel stays the other. Hidden rather than
   disabled: "Open full screen" is right above the frame and Hatch's own admin
   still honours the user's choice there. */
.hx-theme-toggle {
	display: none !important;
}
</style>
			<?php
		}
	}
}
