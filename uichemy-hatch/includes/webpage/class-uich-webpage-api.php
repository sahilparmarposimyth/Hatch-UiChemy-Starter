<?php
/**
 * UiChemy API client for making authenticated requests.
 *
 * @package Uichemy
 */

defined( 'ABSPATH' ) || exit;

/**
 * Class Uich_Webpage_Api
 */
class Uich_Webpage_Api {

	/**
	 * UiChemy API base URL.
	 */
	const API_BASE_URL = UICH_WEBPAGE_API_URL;

	/**
	 * Default HTTP timeout for UiChemy API requests (seconds).
	 */
	const DEFAULT_API_TIMEOUT = 120;

	/**
	 * Timeout for project replacement endpoints (Elementor/Gutenberg); upstream can be slow.
	 */
	const REPLACEMENT_API_TIMEOUT = 600;

	/**
	 * Transient key prefix for async replacement jobs (avoids gateway 504 on long upstream calls).
	 */
	const REPLACEMENT_JOB_PREFIX = 'uich_webpage_repl_';

	/**
	 * Upper bound for the (1-based) conceptNumber param. The shipped UI only ever sends 1
	 * (see Dashboard.jsx's hardcoded conceptNumber={1}); there's no documented upstream
	 * concept count above the single digits, so this just rejects obvious garbage
	 * (0, negative, 9999, ...) here with a clear 400 instead of forwarding it upstream.
	 */
	const MAX_CONCEPT_NUMBER = 20;

	/**
	 * Jobs queued in this request to run after the 202 response (loopback HTTP is often blocked on managed hosts).
	 *
	 * @var array<int, array{job_id: string, secret: string}>
	 */
	protected $pending_replacement_jobs = array();

	/**
	 * Authentication instance.
	 *
	 * @var Uich_Webpage_Auth
	 */
	protected $auth;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->auth = new Uich_Webpage_Auth();
	}

	/**
	 * Initialize API endpoints.
	 */
	public function init() {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
		add_action( 'shutdown', array( $this, 'process_replacement_job_after_response' ), 999 );
	}

	/**
	 * Make an authenticated request to the UiChemy API.
	 *
	 * @param string $endpoint API endpoint (e.g., '/sitemaps').
	 * @param string $method HTTP method (GET, POST, etc.).
	 * @param array  $body Optional request body.
	 * @param int    $timeout HTTP timeout in seconds (default DEFAULT_API_TIMEOUT).
	 * @return array|WP_Error Response data or error.
	 */
	public function request( $endpoint, $method = 'GET', $body = array(), $timeout = null ) {
		$access_token = $this->auth->get_access_token();

		if ( ! $access_token ) {
			return new WP_Error( 'not_authenticated', __( 'User is not authenticated.', 'uichemy' ), array( 'status' => 401 ) );
		}

		$url = self::API_BASE_URL . $endpoint;

		if ( null === $timeout ) {
			$timeout = self::DEFAULT_API_TIMEOUT;
		}

		$args = array(
			'method'    => $method,
			'headers'   => array(
				'Authorization' => 'Bearer ' . $access_token,
				'Content-Type'  => 'application/json',
			),
			'timeout'   => (int) $timeout,
			'sslverify' => uich_webpage_http_sslverify(),
		);

		if ( ! empty( $body ) && in_array( $method, array( 'POST', 'PUT', 'PATCH' ), true ) ) {
			$args['body'] = wp_json_encode( $body );
		}

		$response = wp_remote_request( $url, $args );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$response_code = wp_remote_retrieve_response_code( $response );

		// Access token likely expired — refresh once and replay the request.
		if ( 401 === $response_code && $this->auth->refresh_access_token() ) {
			$args['headers']['Authorization'] = 'Bearer ' . $this->auth->get_access_token();
			$response                         = wp_remote_request( $url, $args );
			if ( is_wp_error( $response ) ) {
				return $response;
			}
			$response_code = wp_remote_retrieve_response_code( $response );
		}

		$response_body = wp_remote_retrieve_body( $response );

		// Still unauthorized after the refresh attempt → both tokens are dead.
		// Use the same 'not_authenticated' code as the no-token case so the
		// frontend can route the user back through login, and set status 401.
		if ( 401 === $response_code ) {
			return new WP_Error(
				'not_authenticated',
				__( 'Your UiChemy session has expired. Please reconnect.', 'uichemy' ),
				array( 'status' => 401 )
			);
		}

		if ( $response_code >= 400 ) {
			return new WP_Error(
				'api_error',
				sprintf(
					/* translators: %d: HTTP response code */
					__( 'UiChemy API error: %d', 'uichemy' ),
					$response_code
				),
				array( 'response' => $response_body )
			);
		}

		return json_decode( $response_body, true );
	}

	/**
	 * Get all exported projects for the authenticated user.
	 * Returns projects with pages, sections, and design concepts.
	 * Uses Bearer token Authorization header for the authenticated user.
	 *
	 * @return array|WP_Error Response with success, total, and projects array.
	 */
	public function get_sitemaps() {
		return $this->request( '/exported-projects', 'GET' );
	}

	/**
	 * Report an error to the UiChemy error-tracking service.
	 * Best-effort — never throws; logs locally on failure.
	 *
	 * @param string $error_code Stable error identifier (e.g. 'IMPORT_PAGE_CREATION_FAILED').
	 * @param array  $opts       Optional: level, message, source, stack, context.
	 * @return void
	 */
	public function report_error( $error_code, $opts = array() ) {
		$allowed_levels = array( 'fatal', 'error', 'warning', 'info' );
		$level          = isset( $opts['level'] ) && in_array( $opts['level'], $allowed_levels, true )
			? $opts['level'] : 'error';

		$payload = array(
			'errorCode' => (string) $error_code,
			'level'     => $level,
		);

		foreach ( array( 'message', 'source', 'stack' ) as $field ) {
			if ( ! empty( $opts[ $field ] ) ) {
				$payload[ $field ] = (string) $opts[ $field ];
			}
		}

		if ( isset( $opts['context'] ) && is_array( $opts['context'] ) ) {
			$payload['context'] = $opts['context'];
		}

		$result = $this->request( '/errors', 'POST', $payload, 10 );

		if ( is_wp_error( $result ) && defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Debug-only diagnostic for a best-effort telemetry POST; gated behind WP_DEBUG.
			error_log( '[UiChemy] error report failed: ' . $result->get_error_message() );
		}
	}

	/**
	 * Register REST API routes.
	 */
	public function register_rest_routes() {
		// Proxy endpoint for fetching exported projects (projects, pages, design concepts).
		register_rest_route(
			'uichemy/v2/webpage',
			'/sitemaps',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'rest_get_sitemaps' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Proxy endpoint for project-replacement-elementor (Elementor replacement).
		register_rest_route(
			'uichemy/v2/webpage',
			'/project-replacement-elementor',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_replace_project_elementor' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Proxy endpoint for project-replacement-gutenberg (Gutenberg replacement).
		register_rest_route(
			'uichemy/v2/webpage',
			'/project-replacement-gutenberg',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_replace_project_gutenberg' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Poll async replacement job status (Elementor/Gutenberg).
		register_rest_route(
			'uichemy/v2/webpage',
			'/replacement-job/(?P<job_id>[a-zA-Z0-9]+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'rest_get_replacement_job_status' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);

		// Proxy endpoint for reporting errors to UICH_WEBPAGE_API_URL /errors.
		register_rest_route(
			'uichemy/v2/webpage',
			'/report-error',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_report_error' ),
				'permission_callback' => array( $this, 'check_permission' ),
			)
		);
	}

	/**
	 * REST API callback: Get exported projects (success, total, projects).
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_get_sitemaps() {
		$response = $this->get_sitemaps();

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		return new WP_REST_Response( $response );
	}

	/**
	 * Call project-replacement-elementor API.
	 *
	 * @param string $project_id    Project ID.
	 * @param int    $concept_number Concept number (1-based).
	 * @param array  $pages_list    List of page names (e.g. ['Home']).
	 * @return array|WP_Error
	 */
	public function replace_project_elementor( $project_id, $concept_number, $pages_list ) {
		return $this->request(
			'/project-replacement-elementor',
			'POST',
			array(
				'projectId'     => $project_id,
				'conceptNumber' => (int) $concept_number,
				'pagesList'     => $pages_list,
			),
			self::REPLACEMENT_API_TIMEOUT
		);
	}

	/**
	 * Validate replacement POST body.
	 *
	 * pagesList must be non-empty: an empty selection is never a legitimate request here
	 * (the caller asked to replace zero pages), but the upstream UiChemy API treats an
	 * empty pagesList as "no filter" and generates every page in the project — a costly,
	 * surprising full-project generation triggered by what looks like a no-op request.
	 *
	 * Every pagesList entry must be a plain page-name string, and conceptNumber (when
	 * present) must be a sane 1-based integer. Without this, e.g. passing the sitemap
	 * page objects straight through (instead of their pageName strings) forwards garbage
	 * upstream, which throws an unhandled `p.trim is not a function` there and comes back
	 * as an opaque 500 — a shape error we can and should catch here with a clear 400.
	 *
	 * @param array $params JSON params.
	 * @return true|WP_Error
	 */
	protected function validate_replacement_params( $params ) {
		if ( empty( $params['projectId'] ) || ! isset( $params['pagesList'] ) || ! is_array( $params['pagesList'] ) || empty( $params['pagesList'] ) ) {
			return new WP_Error(
				'rest_missing_param',
				__( 'projectId and a non-empty pagesList are required.', 'uichemy' ),
				array( 'status' => 400 )
			);
		}

		foreach ( $params['pagesList'] as $page_name ) {
			if ( ! is_string( $page_name ) || '' === trim( $page_name ) ) {
				return new WP_Error(
					'rest_invalid_param',
					__( 'pagesList must be an array of non-empty page name strings (e.g. sitemap page objects must be reduced to their pageName first).', 'uichemy' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( isset( $params['conceptNumber'] ) ) {
			$concept_number = $params['conceptNumber'];
			$is_valid_int   = is_numeric( $concept_number ) && (int) $concept_number == $concept_number; // phpcs:ignore Universal.Operators.StrictComparisons.LooseNotEqual -- intentional loose comparison to detect non-integer numerics (e.g. 1.5).
			if ( ! $is_valid_int || (int) $concept_number < 1 || (int) $concept_number > self::MAX_CONCEPT_NUMBER ) {
				return new WP_Error(
					'rest_invalid_param',
					sprintf(
						/* translators: %d: maximum allowed concept number */
						__( 'conceptNumber must be an integer between 1 and %d.', 'uichemy' ),
						self::MAX_CONCEPT_NUMBER
					),
					array( 'status' => 400 )
				);
			}
		}

		return true;
	}

	/**
	 * Create async job; work runs on shutdown after the 202 body is sent (loopback self-HTTP is unreliable on many hosts).
	 *
	 * @param string $type 'elementor'|'gutenberg'.
	 * @param array  $params Request params.
	 * @return string Job id.
	 */
	protected function create_replacement_job( $type, $params ) {
		$job_id = wp_generate_password( 32, false );
		$secret = wp_generate_password( 64, false );
		$job    = array(
			'type'       => $type,
			'status'     => 'pending',
			'secret'     => $secret,
			'params'     => $params,
			'wp_user_id' => get_current_user_id(),
			'created'    => time(),
			'result'     => null,
			'error'      => null,
		);
		set_transient( self::REPLACEMENT_JOB_PREFIX . $job_id, $job, HOUR_IN_SECONDS );
		$this->pending_replacement_jobs[] = array(
			'job_id' => $job_id,
			'secret' => $secret,
		);
		return $job_id;
	}

	/**
	 * Run UiChemy replacement after output buffers flush (priority 999 runs after wp_ob_end_flush_all at 1).
	 * fastcgi_finish_request() lets OpenResty/nginx close the browser connection before the long upstream call.
	 *
	 * @return void
	 */
	public function process_replacement_job_after_response() {
		if ( empty( $this->pending_replacement_jobs ) ) {
			return;
		}
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			fastcgi_finish_request();
		}
		$jobs                           = $this->pending_replacement_jobs;
		$this->pending_replacement_jobs = array();
		foreach ( $jobs as $job ) {
			$this->run_replacement_job( $job['job_id'], $job['secret'] );
		}
	}

	/**
	 * Execute UiChemy replacement for a stored job.
	 *
	 * @param string $job_id Job id.
	 * @param string $secret Must match transient (prevents unauthorized runs).
	 * @return void
	 */
	protected function run_replacement_job( $job_id, $secret ) {
		if ( function_exists( 'set_time_limit' ) ) {
			// phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged -- Long-running replacement job needs a raised execution window; guarded by function_exists.
			set_time_limit( self::REPLACEMENT_API_TIMEOUT );
		}
		if ( function_exists( 'ignore_user_abort' ) ) {
			ignore_user_abort( true );
		}

		$key = self::REPLACEMENT_JOB_PREFIX . $job_id;
		$job = get_transient( $key );
		if ( ! is_array( $job ) || empty( $job['params'] ) ) {
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

		$params = $job['params'];
		$pid    = $params['projectId'];
		$cn     = isset( $params['conceptNumber'] ) ? (int) $params['conceptNumber'] : 1;
		$pages  = $params['pagesList'];

		if ( 'gutenberg' === $job['type'] ) {
			$response = $this->replace_project_gutenberg( $pid, $cn, $pages );
		} else {
			$response = $this->replace_project_elementor( $pid, $cn, $pages );
		}

		$job = get_transient( $key );
		if ( ! is_array( $job ) ) {
			return;
		}

		if ( is_wp_error( $response ) ) {
			$job['status'] = 'error';
			$job['error']  = $response->get_error_message();
			$data          = $response->get_error_data();
			if ( is_array( $data ) && isset( $data['response'] ) ) {
				$job['error_detail'] = $data['response'];
			}
		} else {
			$job['status'] = 'complete';
			$job['result'] = $response;
		}
		set_transient( $key, $job, HOUR_IN_SECONDS );
	}

	/**
	 * REST API callback: Poll replacement job status.
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_get_replacement_job_status( $request ) {
		$job_id = $request->get_param( 'job_id' );
		$key    = self::REPLACEMENT_JOB_PREFIX . $job_id;
		$job    = get_transient( $key );

		if ( ! is_array( $job ) ) {
			return new WP_Error(
				'rest_not_found',
				__( 'Replacement job not found or expired.', 'uichemy' ),
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
		if ( 'complete' === $job['status'] && isset( $job['result'] ) ) {
			$out['result'] = $job['result'];
		}
		if ( 'error' === $job['status'] && isset( $job['error'] ) ) {
			$out['error'] = $job['error'];
			if ( ! empty( $job['error_detail'] ) ) {
				$out['errorDetail'] = $this->sanitize_error_detail_for_response( $job['error_detail'] );
			}
		}

		return new WP_REST_Response( $out );
	}

	/**
	 * Extract a short, safe-to-display message from a raw upstream error response body.
	 *
	 * run_replacement_job() stores the full upstream body (which can pinpoint the real
	 * cause, e.g. a malformed pagesList) but the job-status REST callback only ever
	 * returned the generic "UiChemy API error: %d" message — the admin had no way to
	 * see it short of reading the transient directly in the DB. This decodes a JSON
	 * body's message/error field when present, otherwise strips tags and truncates.
	 *
	 * @param string $raw Raw upstream response body.
	 * @return string Sanitized, display-safe detail (may be empty).
	 */
	protected function sanitize_error_detail_for_response( $raw ) {
		if ( ! is_string( $raw ) || '' === $raw ) {
			return '';
		}

		$decoded = json_decode( $raw, true );
		if ( JSON_ERROR_NONE === json_last_error() && is_array( $decoded ) ) {
			foreach ( array( 'message', 'error', 'detail' ) as $key ) {
				if ( ! empty( $decoded[ $key ] ) && is_string( $decoded[ $key ] ) ) {
					return sanitize_text_field( mb_substr( $decoded[ $key ], 0, 300 ) );
				}
			}
		}

		return sanitize_text_field( mb_substr( wp_strip_all_tags( $raw ), 0, 300 ) );
	}

	/**
	 * REST API callback: Project replacement (Elementor).
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_replace_project_elementor( $request ) {
		$params = $request->get_json_params();
		$valid  = $this->validate_replacement_params( $params );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		$job_id = $this->create_replacement_job( 'elementor', $params );

		return new WP_REST_Response(
			array(
				'jobId'  => $job_id,
				'status' => 'pending',
			),
			202
		);
	}

	/**
	 * Call project-replacement-gutenberg API.
	 *
	 * @param string $project_id    Project ID.
	 * @param int    $concept_number Concept number (1-based).
	 * @param array  $pages_list    List of page names (e.g. ['Home']).
	 * @return array|WP_Error
	 */
	public function replace_project_gutenberg( $project_id, $concept_number, $pages_list ) {
		return $this->request(
			'/project-replacement-gutenberg',
			'POST',
			array(
				'projectId'     => $project_id,
				'conceptNumber' => (int) $concept_number,
				'pagesList'     => $pages_list,
			),
			self::REPLACEMENT_API_TIMEOUT
		);
	}

	/**
	 * REST API callback: Project replacement (Gutenberg).
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_replace_project_gutenberg( $request ) {
		$params = $request->get_json_params();
		$valid  = $this->validate_replacement_params( $params );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		$job_id = $this->create_replacement_job( 'gutenberg', $params );

		return new WP_REST_Response(
			array(
				'jobId'  => $job_id,
				'status' => 'pending',
			),
			202
		);
	}

	/*
	 * The design-feedback proxy (`/feedback`) that the standalone plugin exposed
	 * is deliberately not ported: it collected product feedback for that plugin,
	 * which is nothing to do with running an import here, and its "rate this
	 * design" modal was dropped from the UI along with it.
	 */

	/**
	 * REST API callback: Proxy an error report from the frontend to the project API /errors.
	 * Best-effort — always returns 200 to the client so a failed report never breaks the UI.
	 *
	 * @param WP_REST_Request $request Full request.
	 * @return WP_REST_Response
	 */
	public function rest_report_error( $request ) {
		$params = $request->get_json_params();

		$error_code = isset( $params['errorCode'] ) ? sanitize_text_field( $params['errorCode'] ) : '';
		if ( empty( $error_code ) ) {
			return new WP_REST_Response(
				array(
					'success' => false,
					'error'   => 'errorCode is required',
				),
				400
			);
		}

		$allowed_levels = array( 'fatal', 'error', 'warning', 'info' );
		$level          = isset( $params['level'] ) && in_array( $params['level'], $allowed_levels, true )
			? $params['level'] : 'error';
		$source         = ! empty( $params['source'] ) ? sanitize_text_field( $params['source'] ) : 'uichemy-webpage';
		$message        = ! empty( $params['message'] ) ? sanitize_textarea_field( $params['message'] ) : '';
		$stack          = ! empty( $params['stack'] ) ? substr( (string) $params['stack'], 0, 20000 ) : '';
		$context        = isset( $params['context'] ) && is_array( $params['context'] ) ? $params['context'] : array();

		$context['plugin_version'] = defined( 'UICH_WEBPAGE_VERSION' ) ? UICH_WEBPAGE_VERSION : '';
		$context['wp_version']     = get_bloginfo( 'version' );

		$opts = array(
			'level'   => $level,
			'source'  => $source,
			'context' => $context,
		);
		if ( ! empty( $message ) ) {
			$opts['message'] = $message;
		}
		if ( ! empty( $stack ) ) {
			$opts['stack'] = $stack;
		}

		$this->report_error( $error_code, $opts );

		return new WP_REST_Response( array( 'success' => true ), 200 );
	}

	/**
	 * Check REST API permission.
	 *
	 * @return bool
	 */
	public function check_permission() {
		return current_user_can( 'manage_options' );
	}
}
