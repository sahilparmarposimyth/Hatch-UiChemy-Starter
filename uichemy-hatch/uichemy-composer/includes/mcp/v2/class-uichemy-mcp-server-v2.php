<?php
/**
 * UiChemy MCP Server v2 — the builder runtime's gateway endpoint.
 *
 * Registers /wp-json/uichemy/v2/mcp, built on the gateway pattern
 * (discover, inspect, execute) rather than one tool per operation:
 *
 *   - discover-abilities  (usage guide + skills + the abilities we serve)
 *   - get-ability-info    (inspect one ability's schema)
 *   - execute-ability     (run one ability)
 *
 * The triad is implemented here rather than borrowed from the adapter's bundled
 * `mcp-adapter/*` abilities on purpose: those are registered by whichever
 * mcp-adapter copy happens to boot its default server first, so depending on
 * them would make this endpoint work or not depending on which sibling plugin
 * is active. Everything below resolves through the Abilities API directly, so
 * /wp-json/uichemy/v2/mcp stands on its own.
 *
 * The ability list, exclusions, briefing and skill index all come from
 * UiChemy_Usage_Guide / UiChemy_Skills.
 *
 * Both the endpoint and the ability names moved in v1.0.0: the route is
 * /wp-json/uichemy/v2/mcp and every ability is `uichemy-composer/…`. An ability
 * name is the tool id an MCP client stores, so a client that was talking to the
 * standalone plugin has to re-run discover-abilities once — which is the first
 * call the gateway asks for anyway.
 *
 * The namespace is `uichemy-composer` rather than plain `uichemy` so the builder's
 * abilities stay separable from anything UiChemy itself registers later. That
 * separation is exactly what NAMESPACE_SLUG below filters on.
 *
 * The flat v1 tool table (UiChemy_MCP_Server_V1) is NOT registered in this
 * merged build. It used to live at /wp-json/uichemy/v1/mcp; those same tools
 * already reach /wp-json/uichemy/v1/mcp through the `uichemy_mcp_tools` bridge
 * in class-uichemy-mcp-loader.php, so a second copy of them under a uichemy/
 * route would only be a duplicate surface to keep in sync.
 *
 * @link       https://posimyth.com/
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_MCP_Server_V2' ) ) {

	/**
	 * Registers the gateway-surface UiChemy MCP v2 server.
	 */
	class UiChemy_MCP_Server_V2 {

		// ============================================================
		// CONSTANTS
		// ============================================================

		const SERVER_ID      = 'uichemy-wordpress-mcp-v2';
		const SERVER_NAME    = 'UiChemy WordPress MCP v2';
		const SERVER_VERSION = '2.0.0';
		const REST_NAMESPACE = 'uichemy/v2';
		const REST_ROUTE     = 'mcp';

		/**
		 * Baseline server description.
		 *
		 * @var string
		 */
		const SERVER_DESCRIPTION = 'UiChemy MCP v2 gateway endpoint. Call discover-abilities first for the usage guide and the ability catalogue, then get-ability-info to inspect one, then execute-ability to run it.';

		/**
		 * The ability namespace this endpoint serves. Abilities are matched by
		 * `NAMESPACE_SLUG . '/'` prefix, so this must track the names registered in
		 * UiChemy_Abilities exactly.
		 */
		const NAMESPACE_SLUG = 'uichemy-composer';

		// ============================================================
		// INITIALIZATION
		// ============================================================

		/**
		 * Hook server registration onto the MCP Adapter.
		 */
		public static function init() {
			add_action( 'mcp_adapter_init', array( __CLASS__, 'register_mcp_server' ) );
			add_filter( 'mcp_adapter_tool_call_result', array( __CLASS__, 'unwrap_resource_result' ), 10, 5 );
			add_filter( 'rest_pre_dispatch', array( __CLASS__, 'ensure_relay_session' ), 10, 3 );
		}

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
		 * Let an ability's resource result reach the client as a resource.
		 *
		 * execute-ability wraps whatever the ability returned in
		 * array( 'success' => true, 'data' => ... ). ToolsHandler only emits an
		 * embedded resource block when the result it receives has `type` =>
		 * 'resource' at the TOP level, so that envelope hides it and the whole thing
		 * gets JSON-encoded into a text block instead. For a markdown pipeline
		 * document that means the model reads `\n` and `—` rather than line breaks
		 * and dashes, and pays about 12% in escaping.
		 *
		 * Unwrapping the envelope here, before the conversion runs, restores the
		 * resource path: one JSON encode by the transport, which the client decodes,
		 * so the model gets the real document.
		 *
		 * Only applies to our own v2 server. The filter name is un-namespaced and
		 * therefore shared with every other mcp-adapter copy on the site.
		 *
		 * @param mixed  $result    Raw tool result.
		 * @param array  $args      Tool arguments.
		 * @param string $tool_name Tool that ran.
		 * @param mixed  $mcp_tool  The tool instance.
		 * @param mixed  $server    The server that ran it.
		 * @return mixed
		 */
		public static function unwrap_resource_result( $result, $args = array(), $tool_name = '', $mcp_tool = null, $server = null ) {
			if ( ! is_object( $server ) || ! method_exists( $server, 'get_server_id' ) ) {
				return $result;
			}

			if ( self::SERVER_ID !== $server->get_server_id() ) {
				return $result;
			}

			if ( ! is_array( $result )
				|| true !== ( $result['success'] ?? null )
				|| ! isset( $result['data'] )
				|| ! is_array( $result['data'] ) ) {
				return $result;
			}

			$data = $result['data'];

			// Must be a complete text resource, or the conversion would fall through
			// and we would have thrown the envelope away for nothing.
			if ( ! isset( $data['type'], $data['uri'], $data['text'] )
				|| 'resource' !== $data['type']
				|| ! is_string( $data['uri'] )
				|| '' === trim( $data['uri'] )
				|| ! is_string( $data['text'] ) ) {
				return $result;
			}

			return $data;
		}

		/**
		 * Register the v2 server on our scoped adapter instance.
		 *
		 * `mcp_adapter_init` is un-namespaced and therefore fired by every
		 * mcp-adapter copy on the site, so the instanceof guard is what keeps us from
		 * registering onto a foreign adapter.
		 *
		 * @param \UiChemy\Deps\WP\MCP\Core\McpAdapter $adapter The MCP Adapter instance.
		 */
		public static function register_mcp_server( $adapter ) {
			if ( ! $adapter instanceof \UiChemy\Deps\WP\MCP\Core\McpAdapter ) {
				return;
			}

			$tools = self::gateway_tools();
			if ( empty( $tools ) ) {
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
				self::discover_abilities_by_type( 'resource' ),
				self::discover_abilities_by_type( 'prompt' ),
				array( __CLASS__, 'check_permission' )
			);
		}

		// ============================================================
		// SURFACE
		// ============================================================

		/**
		 * Build the gateway triad.
		 *
		 * Plain verbs, because tool names only have to be unique within one server —
		 * publishing the ability names would surface them with the namespace
		 * flattened in (`mcp-adapter-execute-ability`), which is noise.
		 *
		 * @return array<int,\UiChemy\Deps\WP\MCP\Domain\Tools\McpTool>
		 */
		private static function gateway_tools() {
			if ( ! function_exists( 'wp_get_ability' ) ) {
				return array();
			}

			$specs = array(
				array(
					'name'        => 'discover-abilities',
					'description' => 'Start here. Returns the instructions for this site (what UiChemy is for and how to sequence it), the skills you can load, and every ability you can run. Read instructions before calling anything else.',
					'inputSchema' => array( 'type' => 'object' ),
					'handler'     => array( __CLASS__, 'handle_discover' ),
				),
				array(
					'name'        => 'get-ability-info',
					'description' => 'Inspect one ability before running it: returns its description and full input schema, including the per-action schemas carried in meta.actions.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'name' => array(
								'type'        => 'string',
								'description' => 'Full ability name, e.g. "uichemy-composer/page".',
							),
						),
						'required'   => array( 'name' ),
					),
					'handler'     => array( __CLASS__, 'handle_get_info' ),
				),
				array(
					'name'        => 'execute-ability',
					'description' => 'Run one ability. Pass its name and the arguments its input schema declares for the action-routed abilities that means { action, action_parameters }.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'name'      => array(
								'type'        => 'string',
								'description' => 'Full ability name, e.g. "uichemy-composer/page".',
							),
							'arguments' => array(
								'type'        => 'object',
								'description' => 'Arguments for the ability, matching its input schema.',
							),
						),
						'required'   => array( 'name' ),
					),
					'handler'     => array( __CLASS__, 'handle_execute' ),
				),
			);

			$tools = array();

			foreach ( $specs as $spec ) {
				$tool = \UiChemy\Deps\WP\MCP\Domain\Tools\McpTool::fromArray(
					array(
						'name'        => $spec['name'],
						'description' => $spec['description'],
						'inputSchema' => $spec['inputSchema'],
						'handler'     => $spec['handler'],
						'permission'  => array( __CLASS__, 'default_tool_permission' ),
					)
				);

				if ( $tool instanceof \UiChemy\Deps\WP\MCP\Domain\Tools\McpTool ) {
					$tools[] = $tool;
				}
			}

			return $tools;
		}

		// ============================================================
		// GATEWAY HANDLERS
		// ============================================================

		/**
		 * discover-abilities — the briefing, the skill index and the catalogue.
		 *
		 * @param array $arguments Unused.
		 * @return array{instructions?:string, skills?:array, abilities:array}
		 */
		public static function handle_discover( $arguments = array() ) {
			$document = array();

			$instructions = self::build_instructions();
			if ( '' !== $instructions ) {
				$document['instructions'] = $instructions;
			}

			$skills = self::skills();
			if ( ! empty( $skills ) ) {
				$document['skills'] = $skills;
			}

			$document['abilities'] = self::list_abilities();

			return $document;
		}

		/**
		 * get-ability-info — one ability's description and schema.
		 *
		 * @param array $arguments { name: string }.
		 * @return array|WP_Error
		 */
		public static function handle_get_info( $arguments = array() ) {
			$arguments = is_array( $arguments ) ? $arguments : array();
			$name      = isset( $arguments['name'] ) ? (string) $arguments['name'] : '';

			$ability = self::resolve_served_ability( $name );
			if ( is_wp_error( $ability ) ) {
				return $ability;
			}

			$input_schema = $ability->get_input_schema();

			return array(
				'name'          => $ability->get_name(),
				'label'         => $ability->get_label(),
				'description'   => $ability->get_description(),
				'input_schema'  => ( is_array( $input_schema ) && ! empty( $input_schema ) ) ? $input_schema : array( 'type' => 'object' ),
				'output_schema' => $ability->get_output_schema(),
				'meta'          => $ability->get_meta(),
			);
		}

		/**
		 * execute-ability — run one ability.
		 *
		 * The ability is resolved at call time rather than captured at registration,
		 * so a re-registered ability is still picked up.
		 *
		 * @param array $arguments { name: string, arguments?: array }.
		 * @return mixed Ability result, or WP_Error.
		 */
		public static function handle_execute( $arguments = array() ) {
			$arguments = is_array( $arguments ) ? $arguments : array();
			$name      = isset( $arguments['name'] ) ? (string) $arguments['name'] : '';

			$ability = self::resolve_served_ability( $name );
			if ( is_wp_error( $ability ) ) {
				return $ability;
			}

			$input = ( isset( $arguments['arguments'] ) && is_array( $arguments['arguments'] ) )
				? $arguments['arguments']
				: array();

			$permitted = $ability->check_permissions( $input );
			if ( is_wp_error( $permitted ) ) {
				return $permitted;
			}
			if ( ! $permitted ) {
				return new WP_Error(
					'uichemy_mcp_forbidden',
					sprintf( 'You are not allowed to run "%s".', $name )
				);
			}

			return $ability->execute( $input );
		}

		/**
		 * Resolve an ability name to an ability this endpoint actually serves.
		 *
		 * Refusing names outside the served catalogue keeps the gateway scoped to
		 * UiChemy instead of turning it into a site-wide ability runner — an
		 * arbitrary-ability escape hatch is exactly what the namespace scoping in
		 * list_abilities() exists to prevent.
		 *
		 * @param string $name Full ability name.
		 * @return \WP_Ability|WP_Error
		 */
		private static function resolve_served_ability( $name ) {
			if ( '' === trim( $name ) ) {
				return new WP_Error( 'uichemy_mcp_missing_name', 'Missing required parameter: name.' );
			}

			if ( ! function_exists( 'wp_get_ability' ) ) {
				return new WP_Error( 'uichemy_mcp_no_abilities_api', 'The WordPress Abilities API is not available on this site.' );
			}

			if ( ! in_array( $name, self::served_ability_names(), true ) ) {
				return new WP_Error(
					'uichemy_mcp_unknown_ability',
					sprintf( 'Ability "%s" is not served by this endpoint. Call discover-abilities for the catalogue.', $name )
				);
			}

			$ability = wp_get_ability( $name );
			if ( ! $ability instanceof \WP_Ability ) {
				return new WP_Error(
					'uichemy_mcp_missing_ability',
					sprintf( 'Ability "%s" is not registered.', $name )
				);
			}

			return $ability;
		}

		// ============================================================
		// CATALOGUE
		// ============================================================

		/**
		 * The abilities this endpoint serves: public `uichemy/*` tools, minus the
		 * ones held back from the v2 surface.
		 *
		 * Exclusions come from UiChemy_Usage_Guide so the two v2 gateways (ours and
		 * UiChemy's) hide exactly the same abilities.
		 *
		 * Mirrors Uich_MCP_Discover::list_abilities() in the UiChemy plugin: each
		 * action-routed ability also carries its action names here, so a client
		 * can see at discovery time that one ability covers several operations
		 * without calling get-ability-info first. The full per-action parameter
		 * schemas stay in meta.actions, served on demand by get-ability-info.
		 *
		 * @return array<int,array{name:string,label:string,description:string,actions?:array<int,string>}>
		 */
		private static function list_abilities() {
			if ( ! function_exists( 'wp_get_abilities' ) ) {
				return array();
			}

			$excluded = self::excluded_ability_names();
			$found    = array();

			foreach ( wp_get_abilities() as $ability ) {
				$name = $ability->get_name();

				if ( ! self::is_served_namespace( $name ) ) {
					continue;
				}

				$meta = $ability->get_meta();
				if ( empty( $meta['mcp']['public'] ) ) {
					continue;
				}
				if ( ( $meta['mcp']['type'] ?? 'tool' ) !== 'tool' ) {
					continue;
				}
				if ( in_array( $name, $excluded, true ) ) {
					continue;
				}

				$record = array(
					'name'        => $name,
					'label'       => $ability->get_label(),
					'description' => $ability->get_description(),
				);

				if ( ! empty( $meta['actions'] ) && is_array( $meta['actions'] ) ) {
					$actions = array();
					foreach ( $meta['actions'] as $action ) {
						if ( is_array( $action ) && isset( $action['name'] ) ) {
							$actions[] = (string) $action['name'];
						} elseif ( is_string( $action ) ) {
							$actions[] = $action;
						}
					}
					if ( $actions ) {
						$record['actions'] = $actions;
					}
				}

				$found[] = $record;
			}

			return $found;
		}

		/**
		 * Just the names from list_abilities(), for membership checks.
		 *
		 * @return array<int,string>
		 */
		private static function served_ability_names() {
			return wp_list_pluck( self::list_abilities(), 'name' );
		}

		/**
		 * Abilities held back from the v2 surface.
		 *
		 * @return array<int,string>
		 */
		private static function excluded_ability_names() {
			if ( ! class_exists( 'UiChemy_Usage_Guide' ) ) {
				return array();
			}

			$excluded = UiChemy_Usage_Guide::add_exclusions( array() );

			return is_array( $excluded ) ? $excluded : array();
		}

		/**
		 * Is this ability in the namespace we serve?
		 *
		 * @param string $name Full ability name.
		 * @return bool
		 */
		private static function is_served_namespace( $name ) {
			return 0 === strpos( (string) $name, self::NAMESPACE_SLUG . '/' );
		}

		/**
		 * Collect public abilities of a given MCP type, scoped to our namespace.
		 *
		 * Nothing in UiChemy declares these types yet, so both lists are empty today,
		 * but they are wired now so contributed resources/prompts appear without
		 * further changes.
		 *
		 * @param string $type One of 'tool', 'resource', 'prompt'.
		 * @return array<int,string> Ability names.
		 */
		private static function discover_abilities_by_type( $type ) {
			if ( ! function_exists( 'wp_get_abilities' ) ) {
				return array();
			}

			$found = array();

			foreach ( wp_get_abilities() as $ability ) {
				$name = $ability->get_name();
				if ( ! self::is_served_namespace( $name ) ) {
					continue;
				}

				$meta = $ability->get_meta();
				if ( empty( $meta['mcp']['public'] ) ) {
					continue;
				}
				if ( ( $meta['mcp']['type'] ?? 'tool' ) !== $type ) {
					continue;
				}

				$found[] = $name;
			}

			return $found;
		}

		/**
		 * The machine-readable skill index.
		 *
		 * @return array<int,array>
		 */
		private static function skills() {
			if ( ! class_exists( 'UiChemy_Skills' ) ) {
				return array();
			}

			$skills = UiChemy_Skills::index();

			return is_array( $skills ) ? $skills : array();
		}

		/**
		 * The briefing, from the same source that feeds UiChemy's gateway.
		 *
		 * The block list runs through `uichemy_mcp_usage_guide` so a sibling plugin
		 * that registers abilities into this namespace can brief the model on them
		 * too. UiChemy's own block arrives through the same filter (see
		 * UiChemy_Usage_Guide::init), so contributions simply append after it.
		 *
		 * @return string Markdown.
		 */
		private static function build_instructions() {
			if ( ! class_exists( 'UiChemy_Usage_Guide' ) ) {
				return '';
			}

			/**
			 * Filters the markdown blocks that make up the MCP discovery briefing.
			 *
			 * @since 5.0.2
			 *
			 * @param array<int,string> $blocks Markdown blocks, joined with a blank line.
			 */
			// Seeded EMPTY, not with add_guide(): UiChemy_Usage_Guide::init() has
			// already hooked add_guide() onto this filter, so passing its output in
			// as the seed would run it twice and emit the briefing twice over.
			$blocks = apply_filters( 'uichemy_mcp_usage_guide', array() );
			if ( ! is_array( $blocks ) ) {
				return '';
			}

			$blocks = array_filter(
				array_map( 'trim', array_filter( $blocks, 'is_string' ) ),
				static function ( $block ) {
					return '' !== $block;
				}
			);

			return implode( "\n\n", $blocks );
		}

		// ============================================================
		// AUTHENTICATION & GATING
		// ============================================================

		/**
		 * Transport-level permission: authenticated administrators only.
		 *
		 * Same gate as v1: accepts WP cookies/nonces and native Application Password
		 * (HTTP Basic) auth. Per-ability permission callbacks still run on top of
		 * this when execute-ability runs one.
		 *
		 * @param WP_REST_Request $request Incoming request.
		 * @return bool|\WP_Error
		 */
		public static function check_permission( WP_REST_Request $request ) {
			return UiChemy_Rest_Permissions::check_admin( $request );
		}

		/**
		 * Per-tool permission for the gateway triad itself.
		 *
		 * @return bool
		 */
		public static function default_tool_permission() {
			return current_user_can( 'manage_options' );
		}
	}
}
