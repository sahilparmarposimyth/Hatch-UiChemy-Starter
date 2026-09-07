<?php
/**
 * Run the Hatch deploy inline, on this screen, with no navigation to the broker.
 *
 * The deploy used to hand the browser to the broker's own build page on another
 * origin — first inside the frame (refused, because that page forbids framing),
 * then as a full-tab takeover. Either way the user left the dashboard to watch a
 * log render on somebody else's domain.
 *
 * None of that is necessary. The broker's `/deploy/<provider>/status?ticket=…`
 * already returns the whole thing:
 *
 *     { stage, log: [ … ], error, project_url, project_name, return_url }
 *
 * So the build log can be polled and drawn here, in this plugin's own styling,
 * and the browser never visits the broker at all.
 *
 * How the three pieces fit
 * -----------------------
 *   1. START.  Hatch's handler finishes with `wp_redirect( <broker>/start )`.
 *      Uich_Hatch_Embed hands that off to takeover_url() below, which fires the
 *      pipeline with a server-side request to `/build` and answers with THIS
 *      plugin's dashboard instead. The browser is never sent off-site.
 *   2. POLL.   route_status() proxies the broker's /status. A proxy is not
 *      optional: the broker sends no CORS headers, so a fetch() straight from
 *      wp-admin is blocked by the browser. It also keeps the ticket server-side
 *      and lets us refuse a ticket that is not this user's.
 *   3. FINISH. On success the React screen navigates to the `return_url` the
 *      broker hands back — `admin-post.php?action=hatch_deploy_callback&…`,
 *      same-origin. That runs Hatch's EXISTING callback untouched, so every bit
 *      of finalisation (project URL, hosting model, image proxy, companion
 *      theme) still happens exactly where it always did. Only the thing that
 *      triggers it changed.
 *
 * Requires no change to the broker: /status has always returned the log. The
 * `frameable` negotiation and the frame-ancestors header remain for what they
 * are still needed for — a provider OAuth screen genuinely needs a browser.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Hatch_Deploy' ) ) {

	/**
	 * Keeps the deploy on the dashboard instead of on the broker's domain.
	 */
	final class Uich_Hatch_Deploy {

		/**
		 * Same namespace the dashboard's own routes live in, so the React side
		 * reaches this through the existing `request()` helper and its nonce.
		 */
		const NS = 'uichemy/v2/nd';

		/**
		 * Query arg carrying the ticket back to the dashboard, so the screen
		 * knows a deploy is in flight and which one to poll.
		 */
		const ARG_TICKET = 'uich_hatch_deploy';

		/**
		 * Query arg carrying the provider, which /status needs in its path.
		 */
		const ARG_PROVIDER = 'uich_hatch_provider';

		/**
		 * Ticket and provider for THIS request, captured from the broker's
		 * /prepare reply. Request-scoped on purpose: it exists only between
		 * Hatch's handler getting a ticket and the redirect one statement later.
		 *
		 * @var array{ticket:string,provider:string}|null
		 */
		private static $pending;

		/**
		 * Register hooks.
		 *
		 * @return void
		 */
		public static function boot() {
			add_action( 'hatch_deploy_prepared', array( __CLASS__, 'on_prepared' ), 10, 2 );
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		}

		/**
		 * Remember the ticket Hatch just obtained.
		 *
		 * @param array  $data     Broker /prepare reply.
		 * @param string $provider Provider key.
		 * @return void
		 */
		public static function on_prepared( $data, $provider ) {
			if ( empty( $data['ticket'] ) ) {
				return;
			}
			self::$pending = array(
				'ticket'   => (string) $data['ticket'],
				'provider' => sanitize_key( (string) $provider ),
			);
		}

		/**
		 * Turn the hand-off to the broker into a stay-here redirect.
		 *
		 * Called by Uich_Hatch_Embed::filter_redirect() for an off-site target,
		 * BEFORE it falls back to taking over the top window. Returns the URL to
		 * go to instead, or null to let the normal off-site handling proceed —
		 * which is what happens for a provider OAuth screen, where the browser
		 * really does have to travel.
		 *
		 * @param string $location The off-site redirect Hatch asked for.
		 * @return string|null Replacement URL, or null to decline.
		 */
		public static function takeover_url( $location ) {
			if ( ! self::$pending ) {
				return null;
			}
			// Only the broker's own start page, and only for the ticket we just
			// watched Hatch obtain. Anything else off-site is not ours.
			if ( false === strpos( (string) $location, '/start?ticket=' ) ) {
				return null;
			}
			if ( false === strpos( (string) $location, rawurlencode( self::$pending['ticket'] ) ) ) {
				return null;
			}

			$ticket   = self::$pending['ticket'];
			$provider = self::$pending['provider'];
			self::$pending = null; // one shot

			if ( ! self::start_build( $provider, $ticket ) ) {
				// The pipeline never started, so there would be nothing to poll.
				// Decline and let the browser go to the broker as before — its
				// page can report the failure better than a blank progress bar.
				return null;
			}

			return add_query_arg(
				array(
					'page'             => 'uichemy',
					self::ARG_TICKET   => $ticket,
					self::ARG_PROVIDER => $provider,
				),
				admin_url( 'admin.php' )
			) . '#/sync-astro';
		}

		/**
		 * Kick the broker's pipeline without a browser.
		 *
		 * `/build` marks the ticket building and starts the run in a detached
		 * async task BEFORE it renders its page, so the run survives us dropping
		 * the response on the floor — which is all this does. The HTML it returns
		 * is the very page we are replacing.
		 *
		 * @param string $provider Provider key.
		 * @param string $ticket   Broker ticket.
		 * @return bool Whether the broker accepted the request.
		 */
		private static function start_build( $provider, $ticket ) {
			if ( ! class_exists( 'Hatch_Deploy_Broker' ) ) {
				return false;
			}

			$url = Hatch_Deploy_Broker::base_url() . '/deploy/' . $provider
				. '/build?ticket=' . rawurlencode( $ticket );

			$res = wp_remote_get(
				$url,
				array(
					// The page renders as soon as the run is queued, so this
					// returns quickly. Not `blocking => false`: we want to KNOW
					// the pipeline started before promising a progress screen.
					'timeout'     => 15,
					'redirection' => 2,
				)
			);

			if ( is_wp_error( $res ) ) {
				return false;
			}
			return 200 === (int) wp_remote_retrieve_response_code( $res );
		}

		/**
		 * The polling route the progress screen reads.
		 *
		 * @return void
		 */
		public static function register_routes() {
			register_rest_route(
				self::NS,
				'/hatch-deploy/status',
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'route_status' ),
					'permission_callback' => static function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'ticket'   => array( 'required' => true, 'type' => 'string' ),
						'provider' => array( 'required' => true, 'type' => 'string' ),
					),
				)
			);
		}

		/**
		 * Proxy the broker's /status for the ticket this user is deploying.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response|WP_Error
		 */
		public static function route_status( $request ) {
			$ticket   = (string) $request->get_param( 'ticket' );
			$provider = sanitize_key( (string) $request->get_param( 'provider' ) );

			if ( '' === $ticket || '' === $provider ) {
				return new WP_Error( 'uich_hatch_bad_request', __( 'Missing ticket or provider.', 'uichemy' ), array( 'status' => 400 ) );
			}

			/*
			 * The ticket has to be the one THIS user is deploying. Hatch stashes
			 * it in a per-user transient in handle_start_deploy(); without this
			 * check the route would happily read the status of any ticket a
			 * caller could name. `manage_options` alone is not the same thing on
			 * a multi-admin site.
			 */
			if ( ! self::owns_ticket( $ticket ) ) {
				return new WP_Error( 'uich_hatch_foreign_ticket', __( 'That deploy does not belong to this user.', 'uichemy' ), array( 'status' => 403 ) );
			}

			if ( ! class_exists( 'Hatch_Deploy_Broker' ) ) {
				return new WP_Error( 'uich_hatch_unavailable', __( 'The Hatch runtime is not available.', 'uichemy' ), array( 'status' => 503 ) );
			}

			$url = Hatch_Deploy_Broker::base_url() . '/deploy/' . $provider
				. '/status?ticket=' . rawurlencode( $ticket );

			$res = wp_remote_get( $url, array( 'timeout' => 15 ) );
			if ( is_wp_error( $res ) ) {
				return new WP_Error( 'uich_hatch_broker_unreachable', $res->get_error_message(), array( 'status' => 502 ) );
			}

			$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
			if ( ! is_array( $body ) ) {
				return new WP_Error( 'uich_hatch_broker_bad_reply', __( 'The deploy broker returned something unreadable.', 'uichemy' ), array( 'status' => 502 ) );
			}

			// Passed through as-is apart from being re-shaped to known keys, so a
			// broker that grows a field cannot inject anything unexpected into
			// the screen. `log` is rendered as text, never as markup.
			return new WP_REST_Response(
				array(
					'stage'       => isset( $body['stage'] ) ? (string) $body['stage'] : 'building',
					'log'         => isset( $body['log'] ) && is_array( $body['log'] )
						? array_values( array_map( 'strval', $body['log'] ) )
						: array(),
					'error'       => isset( $body['error'] ) && null !== $body['error'] ? (string) $body['error'] : null,
					'projectUrl'  => ! empty( $body['project_url'] ) ? esc_url_raw( (string) $body['project_url'] ) : '',
					'projectName' => isset( $body['project_name'] ) ? sanitize_text_field( (string) $body['project_name'] ) : '',
					// Only ever followed if it points back at THIS site — the
					// screen navigates to it, so a broker naming somewhere else
					// would be an open redirect.
					'returnUrl'   => self::same_site_url( isset( $body['return_url'] ) ? (string) $body['return_url'] : '' ),
					'httpStatus'  => (int) wp_remote_retrieve_response_code( $res ),
				),
				200
			);
		}

		/**
		 * Is this ticket the one the current user started?
		 *
		 * @param string $ticket Ticket id.
		 * @return bool
		 */
		private static function owns_ticket( $ticket ) {
			if ( ! class_exists( 'Hatch_Deploy_Broker' ) ) {
				return false;
			}
			$key   = Hatch_Deploy_Broker::TICKET_TRANSIENT_PREFIX . get_current_user_id();
			$known = (string) get_transient( $key );

			return '' !== $known && hash_equals( $known, $ticket );
		}

		/**
		 * Keep a broker-supplied URL only if it lives on this site.
		 *
		 * @param string $url Candidate URL.
		 * @return string Empty when it is not ours.
		 */
		private static function same_site_url( $url ) {
			$url = trim( $url );
			if ( '' === $url ) {
				return '';
			}
			$host = strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
			$home = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );

			return ( '' !== $host && $host === $home ) ? esc_url_raw( $url ) : '';
		}
	}
}
