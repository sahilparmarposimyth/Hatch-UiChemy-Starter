<?php
/**
 * REST API for the new dashboard.
 *
 * Namespace: `uichemy/v2/nd`. All routes require `manage_options`.
 *
 *   GET  /env             — env_check() snapshot
 *   GET  /builders        — detect_builders() snapshot
 *   GET  /state           — full dashboard state (env + builders + mode + onboarded)
 *   POST /builder         — { builder } persists builder choice
 *   POST /mode            — { mode }    persists mode choice
 *   POST /onboarded       — { done }    marks wizard complete
 *
 * Phase 1: read routes implemented; write routes implemented with light
 * validation. Token / MCP routes land in Phase 2.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_ND_Api' ) ) {

	final class Uich_ND_Api {

		const NS = 'uichemy/v2/nd';

		public static function boot() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		}

		public static function register_routes() {
			$auth = array( __CLASS__, 'permission_check' );

			register_rest_route(
				self::NS,
				'/env',
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'route_env' ),
					'permission_callback' => $auth,
				)
			);

			register_rest_route(
				self::NS,
				'/builders',
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'route_builders' ),
					'permission_callback' => $auth,
				)
			);

			register_rest_route(
				self::NS,
				'/state',
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'route_state' ),
					'permission_callback' => $auth,
				)
			);

			register_rest_route(
				self::NS,
				'/builder',
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'route_set_builder' ),
					'permission_callback' => $auth,
					'args'                => array(
						'builder' => array(
							'required' => true,
							'type'     => 'string',
						),
					),
				)
			);

			register_rest_route(
				self::NS,
				'/mode',
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'route_set_mode' ),
					'permission_callback' => $auth,
					'args'                => array(
						'mode' => array(
							'required' => true,
							'type'     => 'string',
						),
					),
				)
			);

			register_rest_route(
				self::NS,
				'/onboarded',
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'route_set_onboarded' ),
					'permission_callback' => $auth,
					'args'                => array(
						'done'    => array(
							'required' => false,
							'type'     => 'boolean',
							'default'  => true,
						),
						'consent' => array(
							'required' => false,
							'type'     => 'boolean',
							'default'  => false,
						),
					),
				)
			);

			register_rest_route(
				self::NS,
				'/install',
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'route_install' ),
					'permission_callback' => array( __CLASS__, 'permission_install' ),
					'args'                => array(
						'builder' => array(
							'required' => true,
							'type'     => 'string',
						),
					),
				)
			);

			register_rest_route(
				self::NS,
				'/uichemy/install',
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'route_uichemy_install' ),
					'permission_callback' => array( __CLASS__, 'permission_uichemy_install' ),
				)
			);

			/*
			 * UiChemy Pro — install-from-zip then activate, or just activate when
			 * it is already on the site. Same capability gate as the free install:
			 * this writes to wp-content/plugins and flips active_plugins.
			 */
			register_rest_route(
				self::NS,
				'/uichemy-pro/install',
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'route_uichemy_pro_install' ),
					'permission_callback' => array( __CLASS__, 'permission_uichemy_install' ),
				)
			);

			/*
			 * The /register-session and /change-license routes were removed with
			 * the app.uichemy.com SSO they proxied. Sign-in is an OAuth flow
			 * against the AI Website Creator now (Uich_ND_Auth →
			 * Uich_Webpage_Auth), and there is no per-site license session to
			 * register or switch.
			 */

			/*
			 * /licenses/user survived that removal because the dashboard still
			 * calls it on every visit as its session check (getSession() in
			 * new-dashboard/src/lib/api.js): a 401 signs the user out, anything
			 * else is ignored. With the route gone it answered 404 — not 401 — so
			 * the sign-out branch could never run and a site stayed "logged in"
			 * long after its account had been disconnected from the app.
			 *
			 * It no longer proxies anything; it just reports this site's own auth
			 * state, which is what the caller actually wanted.
			 */
			register_rest_route(
				self::NS,
				'/licenses/user',
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'route_licenses_user' ),
					'permission_callback' => $auth,
				)
			);
		}

		/**
		 * Report the connected AI Website Creator account.
		 *
		 * 401 when nothing is connected — the dashboard treats that as "sign out",
		 * so it must stay a 401 and not a 200 with an empty body.
		 *
		 * @return WP_REST_Response|WP_Error
		 */
		public static function route_licenses_user() {
			if ( ! class_exists( 'Uich_ND_Auth' ) || ! Uich_ND_Auth::is_authed() ) {
				return new WP_Error(
					'uich_not_connected',
					__( 'No UiChemy account is connected to this site.', 'uichemy' ),
					array( 'status' => 401 )
				);
			}

			$account = Uich_ND_Auth::get_account();

			return new WP_REST_Response(
				array(
					'user' => array(
						'id'    => isset( $account['sub'] ) ? $account['sub'] : '',
						'name'  => isset( $account['name'] ) ? $account['name'] : '',
						'email' => isset( $account['email'] ) ? $account['email'] : '',
					),
				),
				200
			);
		}

		/**
		 * Installing UiChemy needs install_plugins + activate_plugins.
		 */
		public static function permission_uichemy_install() {
			return current_user_can( 'install_plugins' ) && current_user_can( 'activate_plugins' );
		}

		/**
		 * Installer needs install_plugins / switch_themes — stricter than
		 * the rest of the REST surface.
		 */
		public static function permission_install() {
			return current_user_can( 'install_plugins' ) && current_user_can( 'switch_themes' );
		}

		public static function permission_check() {
			return current_user_can( 'manage_options' );
		}

		public static function route_env() {
			return rest_ensure_response( Uich_ND_Settings::env_check() );
		}

		public static function route_builders() {
			return rest_ensure_response( Uich_ND_Settings::detect_builders() );
		}

		public static function route_state( WP_REST_Request $req ) {
			return rest_ensure_response(
				array(
					'auth'        => Uich_ND_Auth::get_boot_state(),
					'env'         => Uich_ND_Settings::env_check(),
					'builders'    => Uich_ND_Settings::detect_builders(),
					'builder'     => Uich_ND_Settings::get_builder(),
					'mode'        => Uich_ND_Settings::get_mode(),
					'onboarded'   => Uich_ND_Settings::is_onboarded(),
					'appPassword' => Uich_ND_App_Password::get_dashboard_state(),
					'localEnv'    => Uich_ND_Settings::get_local_env_state(),
					'uichemy'     => Uich_ND_Settings::detect_uichemy(),
					'uichemyPro'  => Uich_ND_Settings::detect_uichemy_pro(),
					'site'        => array(
						'name'       => get_bloginfo( 'name' ),
						'url'        => get_option( 'siteurl' ),
						'restUrl'    => rest_url(),
						'connectUrl' => esc_url_raw( Uich_ND_Enqueue::connect_url_base() ),
					),
				)
			);
		}

		public static function route_set_builder( WP_REST_Request $req ) {
			$builder = sanitize_key( (string) $req->get_param( 'builder' ) );
			if ( ! in_array( $builder, Uich_ND_Settings::BUILDERS, true ) ) {
				return new WP_Error( 'invalid_builder', __( 'Unknown builder.', 'uichemy' ), array( 'status' => 400 ) );
			}

			// Persist — `update_option` returns false when the value didn't
			// change, but that's fine; we still want the recommended
			// settings to run on every Continue press.
			Uich_ND_Settings::set_builder( $builder );

			$recommended = Uich_ND_Recommended_Settings::apply_for( $builder );

			return rest_ensure_response(
				array(
					'builder'     => Uich_ND_Settings::get_builder(),
					'recommended' => $recommended,
				)
			);
		}

		public static function route_set_mode( WP_REST_Request $req ) {
			$ok = Uich_ND_Settings::set_mode( (string) $req->get_param( 'mode' ) );
			if ( ! $ok ) {
				return new WP_Error( 'invalid_mode', __( 'Unknown mode.', 'uichemy' ), array( 'status' => 400 ) );
			}
			return rest_ensure_response( array( 'mode' => Uich_ND_Settings::get_mode() ) );
		}

		public static function route_set_onboarded( WP_REST_Request $req ) {
			$done    = (bool) $req->get_param( 'done' );
			$consent = (bool) $req->get_param( 'consent' );
			Uich_ND_Settings::set_onboarded( $done );

			// Best-effort analytics ping — only on completion, only once,
			// and only with the user's explicit opt-in consent. WordPress.org
			// guidelines require opt-in before sending site data to an
			// external server. Failures are swallowed; never blocks the user.
			$ping = null;
			if ( $done && $consent ) {
				$ping = Uich_ND_Analytics::ping_onboarding( $consent );
			}

			return rest_ensure_response(
				array(
					'onboarded' => Uich_ND_Settings::is_onboarded(),
					'analytics' => $ping,
				)
			);
		}

		public static function route_install( WP_REST_Request $req ) {
			$result = Uich_ND_Installer::install_or_activate( (string) $req->get_param( 'builder' ) );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			return rest_ensure_response( $result );
		}

		public static function route_uichemy_install() {
			$result = Uich_ND_Installer::install_uichemy();
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			return rest_ensure_response( $result );
		}

		/**
		 * Install + activate UiChemy Pro (or activate an already-installed copy).
		 *
		 * @return WP_REST_Response|WP_Error
		 */
		public static function route_uichemy_pro_install() {
			$result = Uich_ND_Installer::install_uichemy_pro();
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			return rest_ensure_response( $result );
		}
	}
}
