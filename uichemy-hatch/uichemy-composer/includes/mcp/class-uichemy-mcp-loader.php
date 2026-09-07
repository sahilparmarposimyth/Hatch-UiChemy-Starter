<?php
/**
 * MCP Bootstrap for UiChemy
 *
 * UiChemy no longer runs its own MCP server. Its Composer pipeline tools are
 * registered as WordPress abilities (uichemy/ namespace — see
 * class-uichemy-abilities.php) and served through a single site-wide MCP
 * gateway. This removes the shared-hook collision that occurred
 * when both plugins booted a copy of wordpress/mcp-adapter.
 *
 * UiChemy_Composer_MCP_Server is still loaded — but only as the source of the
 * tool specs + handlers reused by the abilities layer and the UiChemy bridge
 * filter. Its adapter-backed methods (register_mcp_server / build_tools /
 * ensure_relay_session) are never invoked.
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// --- shared engine: the execute_* handlers BOTH surfaces call.
require_once plugin_dir_path( __FILE__ ) . 'shared/class-uichemy-composer-mcp-server.php';

// --- v1 surface: the flat tool specs. Delete this line and includes/mcp/v1/ to
// retire v1; nothing under v2/ references it.
require_once plugin_dir_path( __FILE__ ) . 'v1/class-uichemy-mcp-v1-tools.php';
require_once plugin_dir_path( __FILE__ ) . 'shared/class-uichemy-upload-slots.php';
require_once plugin_dir_path( __FILE__ ) . 'shared/class-uichemy-composer-upload.php';

// Per-plugin modules (AI chat + the agent endpoint today; the Pro dynamic-data
// and license modules from Phase 3 onward). Free and Pro each ship their own copy
// of includes/plugin-modules.php — it is the one file under includes/ allowed to
// differ, so this shared loader never has to ask which build it is in.
// See docs/free-pro-split-plan.md.
require_once UICHEMY_PATH . 'includes/plugin-modules.php';

/**
 * Expose Composer's pipeline tools as first-class WordPress abilities
 * (uichemy/ namespace, meta.mcp.public) so a single site-wide MCP gateway
 * serves them. This is the ONLY path UiChemy's tools reach MCP by.
 */
// --- v2 surface: routers first, then the abilities that dispatch into them.
require_once plugin_dir_path( __FILE__ ) . 'v2/class-uichemy-mcp-v2-router.php';
require_once plugin_dir_path( __FILE__ ) . 'v2/class-uichemy-abilities.php';
UiChemy_Abilities::init();

/**
 * Contribute UiChemy's briefing to UiChemy's v2 discovery document, so a client
 * learns what UiChemy is and how to sequence its tools from the first call
 * instead of from the user.
 */
require_once plugin_dir_path( __FILE__ ) . 'v2/class-uichemy-skills.php';
UiChemy_Skills::init();

require_once plugin_dir_path( __FILE__ ) . 'v2/class-uichemy-usage-guide.php';
UiChemy_Usage_Guide::init();

/**
 * The builder runtime's MCP endpoints. In this merged build there is exactly one
 * public MCP surface per version, and both live under the uichemy namespace:
 *
 *   /wp-json/uichemy/v1/mcp  — the flat tool table, served by UiChemy's own
 *                              Uich_MCP_Server, which collects these tools
 *                              through the `uichemy_mcp_tools` filter at the
 *                              bottom of this file
 *   /wp-json/uichemy/v2/mcp  — the discover/inspect/execute gateway
 *                              (UiChemy_MCP_Server_V2)
 *
 * The standalone plugin also published the same tools a second time under its
 * own retired namespace. Those routes are gone: its v1 would collide with
 * UiChemy's own uichemy/v1 server, and keeping a duplicate legacy surface alive
 * means two route tables to keep in step. v1's tool specs
 * (UiChemy_MCP_V1_Tools) are still loaded above — the bridge filter reads them.
 *
 * The bundled mcp-adapter fires shared, non-namespaced hooks
 * ('mcp_adapter_init', 'mcp_adapter_default_server_config',
 * 'mcp_adapter_create_default_server'), which is why running two copies used to
 * collide. Isolation is handled at the listener level instead: both server
 * classes type-guard their $adapter argument against the scoped McpAdapter, so a
 * foreign adapter firing the shared hook can never register our servers onto the
 * wrong instance — and vice versa.
 *
 * MERGED BUILD: these servers now run on UiChemy's single Strauss-prefixed
 * adapter copy (UiChemy\Deps\WP\MCP\) instead of a second UiChemy-prefixed one.
 * Both plugins pinned the same wordpress/mcp-adapter 0.5.0 and only differed in
 * prefix, so shipping two copies inside one plugin would have doubled the
 * dependency for no isolation benefit — the listener-level type guard above is
 * what keeps other plugins' adapters out, not the prefix.
 */
$uichemy_mcp_autoload = UICH_PATH . 'vendor-prefixed/autoload.php';

if ( is_readable( $uichemy_mcp_autoload ) ) {
	require_once $uichemy_mcp_autoload;

	if ( class_exists( '\UiChemy\Deps\WP\MCP\Core\McpAdapter' ) ) {
		require_once plugin_dir_path( __FILE__ ) . 'v2/class-uichemy-mcp-server-v2.php';

		/*
		 * Drop OUR copy's default server before it is built.
		 *
		 * McpAdapter::init() hooks its own DefaultServerFactory::create onto
		 * 'mcp_adapter_init' at priority 10, and that factory resolves the adapter
		 * through its own scoped singleton — it does not check whether the route is
		 * already taken. With two adapter copies on the site both would register
		 * REST routes at /wp-json/mcp/mcp-adapter-default-server and clash.
		 *
		 * Removing the callback at priority 1 (before 10 runs) targets ONLY the
		 * UiChemy-scoped factory: UiChemy's is a different class and therefore a
		 * different callable, so its default server — and the shared
		 * `mcp-adapter/*` abilities it registers — are left intact. Filtering
		 * 'mcp_adapter_create_default_server' instead would have hit every copy,
		 * since that hook is un-namespaced.
		 */
		add_action(
			'mcp_adapter_init',
			function () {
				remove_action(
					'mcp_adapter_init',
					array( \UiChemy\Deps\WP\MCP\Servers\DefaultServerFactory::class, 'create' )
				);
			},
			1
		);

		// Guarantee the adapter initializes so 'mcp_adapter_init' fires.
		\UiChemy\Deps\WP\MCP\Core\McpAdapter::instance();

		UiChemy_MCP_Server_V2::init();
	}
}

UiChemy_Composer_Upload::init();

// Whatever this build ships beyond the shared core (see plugin-modules.php).
uichemy_load_plugin_modules();

/**
 * Expose Composer's MCP tools through UiChemy's endpoint as well.
 *
 * UiChemy collects these via its `uichemy_mcp_tools` filter and wraps each in
 * its OWN scoped McpTool, so we only hand over plain spec data + handler
 * callables — never adapter objects (Strauss-safe). A no-op when UiChemy isn't
 * active (the filter simply never fires). Composer's own /uichemy/v1/mcp endpoint
 * keeps working independently — this is an additive bridge, not a replacement.
 */
add_filter(
	'uichemy_mcp_tools',
	function ( $tools ) {
		if ( ! is_array( $tools ) ) {
			$tools = array();
		}
		if ( class_exists( 'UiChemy_Composer_MCP_Server' ) ) {
			foreach ( UiChemy_Composer_MCP_Server::get_tool_definitions() as $def ) {
				$tools[] = $def;
			}
		}
		return $tools;
	}
);
