<?php
/**
 * UiChemy MCP Server v1 — UiChemy's own flat-tool endpoint.
 *
 * Serves the v1 tool table (UiChemy_MCP_V1_Tools) at
 * /wp-json/uichemy/v1/mcp on UiChemy's OWN Strauss-prefixed copy of the MCP
 * adapter, so the endpoint exists whether or not UiChemy is installed.
 *
 * This restores the route the SERVER_ID / REST_NAMESPACE constants on
 * UiChemy_Composer_MCP_Server always described but that nothing registered after
 * UiChemy's server was retired during the gateway consolidation. The
 * `uichemy_mcp_tools` bridge in the loader is untouched: when UiChemy is
 * active the same tools keep appearing on /wp-json/uichemy/v1/mcp too, so
 * existing clients pointed at that URL do not move.
 *
 * Isolation: `mcp_adapter_init` is un-namespaced and therefore fired by every
 * mcp-adapter copy on the site. register_mcp_server() type-guards its $adapter
 * against the UiChemy-scoped McpAdapter, so a foreign adapter firing the shared
 * hook can never register this server onto the wrong instance.
 *
 * @link       https://posimyth.com/
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_MCP_Server_V1' ) ) {

	/**
	 * Registers UiChemy's flat-tool MCP server.
	 */
	class UiChemy_MCP_Server_V1 {

		// ============================================================
		// CONSTANTS
		// ============================================================

		const SERVER_ID          = 'uichemy-wordpress-mcp-v1';
		const SERVER_NAME        = 'UiChemy WordPress MCP v1';
		const SERVER_VERSION     = '1.0.0';
		const REST_NAMESPACE     = 'uichemy/v1';
		const REST_ROUTE         = 'mcp';
		const SERVER_DESCRIPTION = 'Composer MCP - convert Figma designs to HTML/CSS, manage Elementor globals, and build full WordPress sites using the Composer pipeline.';

		// ============================================================
		// INITIALIZATION
		// ============================================================

		/**
		 * Hook server registration onto the MCP Adapter.
		 */
		public static function init() {
			add_action( 'mcp_adapter_init', array( __CLASS__, 'register_mcp_server' ) );
			// Auto-mint an MCP session for relay clients (see ensure_relay_session).
			add_filter( 'rest_pre_dispatch', array( __CLASS__, 'ensure_relay_session' ), 10, 3 );
		}

		/**
		 * Auto-create and inject an MCP session for uichemy/*\/mcp requests that
		 * arrive without one.
		 *
		 * The MCP HTTP transport requires a valid `Mcp-Session-Id` header on every
		 * non-initialize call, and only returns that id in the `initialize` RESPONSE
		 * header. The Figma plugin relays these calls through Figma's main-thread
		 * fetch, which strips custom response headers — so the plugin can never read
		 * the session id and every tools/call would fail with
		 * "Missing Mcp-Session-Id header" (HTTP 400).
		 *
		 * When an authenticated request hits our MCP route WITHOUT a session header,
		 * mint a real session for the current user and inject it so the transport's
		 * validator passes. Standard MCP clients that manage their own sessions send
		 * the header themselves and are left untouched.
		 *
		 * Covers both UiChemy MCP versions, so v2 gets the same treatment.
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

			// Any versioned UiChemy MCP endpoint (v1, v2, ...).
			if ( ! preg_match( '#/uichemy/v\d+/' . preg_quote( self::REST_ROUTE, '#' ) . '#', (string) $request->get_route() ) ) {
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

			$tools = self::build_tools();
			if ( empty( $tools ) ) {
				// No tool table (v1 surface retired) — a server with no tools is
				// useless and create_server() would only fail later.
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
				$tools,
				array(),
				array(),
				array( __CLASS__, 'check_permission' )
			);
		}

		/**
		 * Wrap the v1 tool definitions as McpTool instances.
		 *
		 * The specs and handlers come from UiChemy_MCP_V1_Tools — the same table the
		 * `uichemy_mcp_tools` bridge publishes — so the two v1 surfaces cannot drift.
		 * Duplicate tool names are skipped (first wins).
		 *
		 * @return array<int,\UiChemy\Deps\WP\MCP\Domain\Tools\McpTool>
		 */
		private static function build_tools() {
			if ( ! class_exists( 'UiChemy_MCP_V1_Tools' ) ) {
				return array();
			}

			$tools = array();
			$used  = array();

			foreach ( UiChemy_MCP_V1_Tools::get_tool_definitions() as $def ) {
				if ( ! is_array( $def ) || empty( $def['name'] ) || empty( $def['handler'] ) || ! is_callable( $def['handler'] ) ) {
					continue;
				}

				$name = (string) $def['name'];
				if ( isset( $used[ $name ] ) ) {
					continue;
				}

				$input_schema = ( isset( $def['inputSchema'] ) && is_array( $def['inputSchema'] ) )
					? $def['inputSchema']
					: array( 'type' => 'object' );
				// An empty PHP array re-encodes as [], which providers reject for
				// "properties" (it must be an object) — drop the key instead.
				if ( isset( $input_schema['properties'] ) && ! is_array( $input_schema['properties'] ) ) {
					unset( $input_schema['properties'] );
				}

				$tool = \UiChemy\Deps\WP\MCP\Domain\Tools\McpTool::fromArray(
					array(
						'name'        => $name,
						'description' => isset( $def['description'] ) ? (string) $def['description'] : '',
						'inputSchema' => $input_schema,
						'handler'     => $def['handler'],
						'permission'  => array( __CLASS__, 'default_tool_permission' ),
					)
				);

				if ( $tool instanceof \UiChemy\Deps\WP\MCP\Domain\Tools\McpTool ) {
					$tools[]       = $tool;
					$used[ $name ] = true;
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
		 * Delegates to UiChemy_Rest_Permissions, which accepts WP cookies/nonces and
		 * native Application Password (HTTP Basic) authentication.
		 *
		 * @param WP_REST_Request $request Incoming request.
		 * @return bool|\WP_Error
		 */
		public static function check_permission( WP_REST_Request $request ) {
			return UiChemy_Rest_Permissions::check_admin( $request );
		}

		/**
		 * Per-tool permission. Requires manage_options, matching the transport gate.
		 *
		 * @return bool
		 */
		public static function default_tool_permission() {
			return current_user_can( 'manage_options' );
		}
	}
}
