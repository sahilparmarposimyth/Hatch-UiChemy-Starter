<?php
/**
 * plugin-modules.php — the per-plugin module list.
 *
 * THIS FILE IS ALLOWED TO DIFFER between the Free and Pro repos; it is on the
 * allowlist in tools/parity-config.json. Everything else under includes/ must stay
 * byte-identical. See docs/free-pro-split-plan.md.
 *
 * >>> THIS IS THE **FREE** VERSION. <<<
 *
 * UiChemy ships as two standalone plugins and Pro is a complete superset, so the
 * shared bootstrap cannot know which features exist in the build it is running in.
 * It calls uichemy_load_plugin_modules() and each plugin's own copy of this file
 * decides what to require and init.
 *
 * Free ships no Pro modules, so this is intentionally empty. AI Chat lives only in
 * Pro: includes/chat/, includes/mcp/class-uichemy-agent-endpoint.php and the two
 * chat runtime scripts are not part of this plugin at all. That is what keeps the
 * 16 chat/agent REST routes and the 4 chat DB tables off Free installs.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'uichemy_load_plugin_modules' ) ) {
	/**
	 * Require + init the modules that belong to THIS build.
	 *
	 * Called once from UiChemy_MCP_Loader (see includes/mcp/class-uichemy-mcp-loader.php),
	 * which runs after UICHEMY_PATH is defined and after the shared MCP/abilities
	 * layer is in place.
	 *
	 * @return void
	 */
	function uichemy_load_plugin_modules() {
		/*
		 * MERGED BUILD — this is the extension point the Pro add-on hooks.
		 *
		 * UiChemy shipped Pro as a full REPLACEMENT plugin, so Pro simply shipped its
		 * own copy of this file with the Pro module list in it. UiChemy Pro is an
		 * ADD-ON instead: both plugins are active at once, this plugin owns the only
		 * copy of the runtime, and Pro cannot swap a shared file out from under it.
		 *
		 * So the list becomes a hook. UiChemy Pro (uichemy-pro/) answers this with
		 * its own modules — licence, AI Chat, the Pro dynamic tags / functions /
		 * providers — loaded from ITS directory, not this one.
		 *
		 * Fires inside UiChemy_MCP_Loader, i.e. on `plugins_loaded` after
		 * UICHEMY_PATH is defined and the shared MCP/abilities layer is in place, so
		 * a listener can rely on the whole free runtime already being present.
		 */
		do_action( 'uich_composer_load_pro_modules' );
	}
}
