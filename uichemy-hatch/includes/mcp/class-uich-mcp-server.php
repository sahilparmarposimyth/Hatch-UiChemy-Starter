<?php
/**
 * MCP Server for UiChemy
 *
 * Exposes UiChemy's Elementor-globals tools to MCP clients (Claude Desktop,
 * etc.) through the official WordPress MCP Adapter (wordpress/mcp-adapter).
 * Tools are registered as callable-backed McpTool instances so the exact
 * client-facing tool names (check_config, get_globals, ...) are preserved.
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Api' ) ) {
	require_once UICH_PATH . 'includes/admin/class-uich-api.php';
}

if ( ! class_exists( 'Uich_MCP_Server' ) ) {

	/**
	 * Registers the UiChemy MCP server (route /wp-json/uichemy/v1/mcp) on the
	 * MCP Adapter and maps each tool to a handler that runs UiChemy logic.
	 */
	class Uich_MCP_Server {

		// ============================================================
		// CONSTANTS
		// ============================================================

		const SERVER_ID          = 'uichemy-wordpress-mcp';
		const SERVER_NAME        = 'UiChemy WordPress MCP';
		const SERVER_VERSION     = '1.0.0';
		const SERVER_DESCRIPTION = 'UiChemy WordPress MCP aggregation endpoint that exposes MCP tools registered by active UiChemy-family plugins (e.g. UiChemy / Composer).';
		const REST_NAMESPACE     = 'uichemy/v1';
		const REST_ROUTE         = 'mcp';

		// ============================================================
		// INITIALIZATION
		// ============================================================

		/**
		 * Hook server registration onto the MCP Adapter.
		 */
		public static function init() {
			add_action( 'mcp_adapter_init', array( __CLASS__, 'register_mcp_server' ) );
			// Auto-mint an MCP session for the Figma plugin relay (see ensure_relay_session).
			add_filter( 'rest_pre_dispatch', array( __CLASS__, 'ensure_relay_session' ), 10, 3 );
		}

		/**
		 * Auto-create and inject an MCP session for uichemy/v1/mcp requests that arrive
		 * without one.
		 *
		 * The MCP HTTP transport (wordpress/mcp-adapter) requires a valid `Mcp-Session-Id`
		 * header on every non-initialize call, and only returns that id in the `initialize`
		 * RESPONSE header. The UiChemy Figma plugin relays these calls through Figma's
		 * main-thread fetch, which strips custom response headers — so the plugin can never
		 * read the session id and every tools/call would fail with
		 * "Missing Mcp-Session-Id header" (HTTP 400).
		 *
		 * To bridge that, when an authenticated request hits our MCP route WITHOUT a session
		 * header, we mint a real session for the current user (the same store the adapter's
		 * validator reads) and inject it into the request so validate_session() passes.
		 * Standard MCP clients that manage their own sessions send the header themselves and
		 * are left untouched.
		 *
		 * @param mixed            $result  Dispatch short-circuit value (passed through unchanged).
		 * @param \WP_REST_Server  $server  The REST server instance.
		 * @param \WP_REST_Request $request The request object.
		 * @return mixed The unchanged $result.
		 */
		public static function ensure_relay_session( $result, $server, $request ) {
			if ( ! $request instanceof \WP_REST_Request ) {
				return $result;
			}

			// Only our MCP route.
			if ( false === strpos( (string) $request->get_route(), '/' . self::REST_NAMESPACE . '/' . self::REST_ROUTE ) ) {
				return $result;
			}

			// A real MCP client already supplied a session — leave it alone.
			if ( $request->get_header( 'Mcp-Session-Id' ) ) {
				return $result;
			}

			// Need an authenticated user to own the session; if none, let the normal
			// auth/permission flow reject the request.
			$user_id = get_current_user_id();
			if ( ! $user_id ) {
				return $result;
			}

			$session_manager = '\UiChemy\Deps\WP\MCP\Transport\Infrastructure\SessionManager';
			if ( ! class_exists( $session_manager ) ) {
				return $result;
			}

			$session_id = $session_manager::create_session( $user_id );
			if ( is_string( $session_id ) && '' !== $session_id ) {
				$request->set_header( 'Mcp-Session-Id', $session_id );
			}

			return $result;
		}

		/**
		 * Register this server and its tools with the MCP Adapter.
		 *
		 * @param \UiChemy\Deps\WP\MCP\Core\McpAdapter $adapter The MCP Adapter instance.
		 */
		public static function register_mcp_server( $adapter ) {
			if ( ! $adapter instanceof \UiChemy\Deps\WP\MCP\Core\McpAdapter ) {
				return;
			}

			$adapter->create_server(
				self::SERVER_ID,
				self::REST_NAMESPACE,
				self::REST_ROUTE,
				self::SERVER_NAME,
				self::SERVER_DESCRIPTION,
				self::SERVER_VERSION,
				array( \UiChemy\Deps\WP\MCP\Transport\HttpTransport::class ),
				\UiChemy\Deps\WP\MCP\Infrastructure\ErrorHandling\ErrorLogMcpErrorHandler::class,
				\UiChemy\Deps\WP\MCP\Infrastructure\Observability\NullMcpObservabilityHandler::class,
				self::build_tools(),
				array(),
				array(),
				array( __CLASS__, 'check_permission' )
			);
		}

		/**
		 * Build the McpTool instances from tool specs + handlers.
		 *
		 * @return array<\UiChemy\Deps\WP\MCP\Domain\Tools\McpTool>
		 */
		private static function build_tools() {
			$tools = array();
			$used  = array();

			// UiChemy no longer ships its own MCP tools — this endpoint is now a
			// pure aggregation host: it only exposes tools that other plugins
			// (e.g. UiChemy) register through the `uichemy_mcp_tools` filter.
			// Each entry is plain data + a PHP callable:
			// array( 'name', 'description', 'inputSchema', 'handler', 'permission'? )
			// The McpTool is built here in UiChemy's own scoped namespace, so
			// contributors never need UiChemy's adapter classes (avoids Strauss
			// clashes between separately-prefixed adapter copies). Duplicate tool
			// names (first contributor wins) are skipped.
			$external = apply_filters( 'uichemy_mcp_tools', array() );
			if ( is_array( $external ) ) {
				foreach ( $external as $ext ) {
					if ( ! is_array( $ext ) || empty( $ext['name'] ) || empty( $ext['handler'] ) || ! is_callable( $ext['handler'] ) ) {
						continue;
					}

					$name = (string) $ext['name'];
					if ( isset( $used[ $name ] ) ) {
						continue;
					}

					$input_schema = ( isset( $ext['inputSchema'] ) && is_array( $ext['inputSchema'] ) )
						? $ext['inputSchema']
						: array( 'type' => 'object' );
					if ( isset( $input_schema['properties'] ) && ! is_array( $input_schema['properties'] ) ) {
						unset( $input_schema['properties'] );
					}

					$tool = \UiChemy\Deps\WP\MCP\Domain\Tools\McpTool::fromArray(
						array(
							'name'        => $name,
							'description' => isset( $ext['description'] ) ? (string) $ext['description'] : '',
							'inputSchema' => $input_schema,
							'handler'     => $ext['handler'],
							'permission'  => ( isset( $ext['permission'] ) && is_callable( $ext['permission'] ) )
								? $ext['permission']
								: array( __CLASS__, 'default_tool_permission' ),
						)
					);

					if ( $tool instanceof \UiChemy\Deps\WP\MCP\Domain\Tools\McpTool ) {
						$tools[]       = $tool;
						$used[ $name ] = true;
					}
				}
			}

			return $tools;
		}

		// ============================================================
		// AUTHENTICATION & GATING
		// ============================================================

		/**
		 * Transport-level permission: authenticated administrators only.
		 *
		 * Delegates to Uich_Rest_Permissions, which accepts WP cookies/nonces
		 * and native Application Password (HTTP Basic) authentication.
		 *
		 * @param WP_REST_Request $request Incoming request.
		 * @return bool|WP_Error
		 */
		public static function check_permission( WP_REST_Request $request ) {
			return Uich_Rest_Permissions::check_admin( $request );
		}

		/**
		 * Default per-tool permission when a contributed tool supplies none.
		 *
		 * Requires manage_options, matching the transport gate. Never
		 * '__return_true' — see build_tools().
		 *
		 * @return bool
		 */
		public static function default_tool_permission() {
			return current_user_can( 'manage_options' );
		}
	}
}
