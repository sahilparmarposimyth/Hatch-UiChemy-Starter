<?php
/**
 * UiChemy MCP v1 — the flat tool surface.
 *
 * This is the whole of what v1 is: a table of ~20 tool specs and the map from
 * each tool name to the handler that runs it. The handlers themselves live in
 * UiChemy_Composer_MCP_Server (includes/mcp/shared/) because v2 calls them too —
 * only the specs and the name→callable wiring are v1-specific, and only they
 * need to disappear when v1 is retired.
 *
 * Nothing here is referenced by the v2 abilities. Deleting this file and the
 * three lines in the loader that consume it removes the v1 surface completely.
 *
 * @link       https://posimyth.com/
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_MCP_V1_Tools' ) ) {

	/**
	 * The v1 tool specs and their handler wiring.
	 */
	class UiChemy_MCP_V1_Tools {

		/**
		 * The class that actually runs a v1 tool.
		 *
		 * Every handler below is a static method on the shared engine, which is what
		 * makes v1 and v2 impossible to drift apart — both surfaces call the same
		 * code. Named explicitly rather than via __CLASS__ because this table used to
		 * live on that class and no longer does.
		 */
		const ENGINE = 'UiChemy_Composer_MCP_Server';

		private static function tool_handlers() {
			return array(
				'uichemy_composer_convert'              => array( 'UiChemy_Composer_MCP_Server', 'execute_uichemy_composer_convert' ),
				'check_config'                          => array( 'UiChemy_Composer_MCP_Server', 'execute_check_config' ),
				'ensure_nav_menu'                       => array( 'UiChemy_Composer_MCP_Server', 'execute_ensure_nav_menu' ),
				'set_site_branding'                     => array( 'UiChemy_Composer_MCP_Server', 'execute_set_site_branding' ),
				'get_globals_css'                       => array( 'UiChemy_Composer_MCP_Server', 'execute_get_globals_css' ),
				'set_globals_css'                       => array( 'UiChemy_Composer_MCP_Server', 'execute_set_globals_css' ),
				'edit_globals_css'                      => array( 'UiChemy_Composer_MCP_Server', 'execute_edit_globals_css' ),
				'create_uichemy_composer_page'          => array( 'UiChemy_Composer_MCP_Server', 'execute_create_uichemy_composer_page' ),
				'add_uichemy_composer_section'          => array( 'UiChemy_Composer_MCP_Server', 'execute_add_uichemy_composer_section' ),
				'create_uichemy_composer_header_footer' => array( 'UiChemy_Composer_MCP_Server', 'execute_create_uichemy_composer_header_footer' ),
				'create_single_post_widget'             => array( 'UiChemy_Composer_MCP_Server', 'execute_create_single_post_widget' ),
				'set_page_site_code'                    => array( 'UiChemy_Composer_MCP_Server', 'execute_set_page_site_code' ),
				'list_pages'                            => array( 'UiChemy_Composer_MCP_Server', 'execute_list_pages' ),
				'list_templates'                        => array( 'UiChemy_Composer_MCP_Server', 'execute_list_templates' ),
				'get_post_structure'                    => array( 'UiChemy_Composer_MCP_Server', 'execute_get_post_structure' ),
				'find_and_update_section_code'          => array( 'UiChemy_Composer_MCP_Server', 'execute_find_and_update_section_code' ),
				'grab'                                   => array( 'UiChemy_Composer_MCP_Server', 'execute_grab' ),
				'update_code'                            => array( 'UiChemy_Composer_MCP_Server', 'execute_update_code' ),
				'insert_section_at_index'               => array( 'UiChemy_Composer_MCP_Server', 'execute_insert_section_at_index' ),
				'request_media_upload'                  => array( 'UiChemy_Composer_MCP_Server', 'execute_request_media_upload' ),
				'start_site_build'                      => array( 'UiChemy_Composer_MCP_Server', 'execute_start_site_build' ),
				'uichemy_composer_convert_code'         => array( 'UiChemy_Composer_MCP_Server', 'execute_uichemy_composer_convert_code' ),
			);
		}

		/**
		 * Plain tool definitions (spec + handler callable) for cross-plugin
		 * exposure. UiChemy collects these via the `uichemy_mcp_tools` filter
		 * and wraps each in its OWN scoped McpTool — so we only ever hand over
		 * data + callables, never adapter objects (Strauss-safe).
		 *
		 * @return array<int, array{name:string, description:string, inputSchema:array, handler:callable}>
		 */
		public static function get_tool_definitions() {
			$handlers = self::tool_handlers();
			$defs     = array();

			foreach ( self::tool_specs() as $spec ) {
				if ( empty( $spec['name'] ) || ! isset( $handlers[ $spec['name'] ] ) ) {
					continue;
				}
				$defs[] = array(
					'name'        => $spec['name'],
					'description' => isset( $spec['description'] ) ? $spec['description'] : '',
					'inputSchema' => isset( $spec['inputSchema'] ) ? $spec['inputSchema'] : array( 'type' => 'object' ),
					'handler'     => $handlers[ $spec['name'] ],
				);
			}

			return $defs;
		}

		// ============================================================
		// TOOL SPECS
		// ============================================================

		/**
		 * Tool definitions (name, description, JSON Schema) exposed to clients.
		 *
		 * @return array<int, array{name:string, description:string, inputSchema:array}>
		 */
		private static function tool_specs() {
			$tools = array(
				array(
					'name'        => 'uichemy_composer_convert',
					'description' => 'AUTOMATICALLY CALL THIS TOOL when the user provides a Figma URL and asks to convert it to HTML/CSS. This is the PRIMARY tool for design-to-code workflows. Patterns that trigger this: (1) User shares a Figma/design URL + says "convert to html", "convert into html", "convert to html and css", "make html from this", "build a webpage from this", "responsive design", etc. (2) User says "create landing page from figma", "figma to html", "figma to responsive html". (3) Any design/figma/mockup + HTML/CSS + responsive. CRITICAL: Do NOT generate HTML or CSS manually. Always call this tool FIRST when you detect a Figma URL + design-to-code intent. The returned pipeline requires production responsive CSS with non-empty tablet/mobile breakpoints before import.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'figma_url' => array(
								'type'        => 'string',
								'description' => 'The full Figma design URL provided by the user.',
							),
							'with_images' => array(
								'type'        => 'boolean',
								'description' => 'If true, extract real image URLs from Figma nodes. Default: false.',
							),
							'phase' => array(
								'type'        => 'string',
								'description' => 'Pipeline phase to load. "1" = Phase 1 setup steps 1-3 (default on first call). "1b" = Phase 1 sync+lookup steps 4-5 (call after Step 3 complete). "2" = Phase 2 generate+upload steps 6-10 (call after Step 5 complete). "3" = Phase 3 summary step 11 (call after all sections uploaded).',
								'enum'        => array( '1', '1b', '2', '3' ),
							),
						),
						'required' => array( 'figma_url' ),
					),
				),
				array(
					'name'        => 'check_config',
					'description' => 'Checks full site readiness before any design conversion. Returns: Elementor / Elementor Pro / Nexter Extension / Nexter Theme detection (informational used only to warn about a competing theme-builder system; see coexistence note below), active kit, API key status, nav menu presence, site branding status (has_custom_logo, has_site_icon, current URLs), header_footer_system ("elementor_pro" | "nexter" | "elementor" informational detection ONLY, NOT a routing switch), and atomic_enabled flag (true = Elementor v4 atomic globals mode, use sync_atomic_globals + get_atomic_globals; false = use sync_globals). Also returns active_header and active_footer every currently-active header/footer across ALL systems INCLUDING UiChemy\'s own native templates, so you can see what already exists before creating a new one. If checks.elementor_active = false, STOP Elementor is required. Always call this first. ⚠️ SITE-BUILD PLANNING RULE (applies even when there is NO Figma URL): every full-site / landing-page / "build me a website" request MUST be planned as Header → body sections → Footer. Header and Footer are NEVER optional include them by default unless the user explicitly says "no header" or "no footer". After check_config returns, your first announcement to the user must list a section plan that starts with "1. Header" and ends with "N. Footer". ⚠️ HEADER/FOOTER ROUTING: UiChemy\'s native Theme Builder engine works on ANY Elementor (free included) it does NOT require Elementor Pro or Nexter. ALWAYS use create_uichemy_composer_header_footer(type:"header"|"footer") for site-wide header/footer, regardless of header_footer_system, UNLESS the user explicitly said the header/footer should appear on ONE page only in that single case, inline it instead (Header = first section of create_uichemy_composer_page, Footer = last add_uichemy_composer_section). Before creating, check active_header/active_footer above if a template of that type is already active, creating a new one WILL silently deactivate it (UiChemy keeps only one active template per type); confirm with the user first if replacement is not the intent. If another theme-builder system is ALSO active, UiChemy\'s native template coexists alongside it rather than replacing it mention this generically to the user ("another active template system was detected on this site") WITHOUT naming the specific competing plugin.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => new stdClass(),
						'required'   => array(),
					),
				),
				array(
					'name'        => 'ensure_nav_menu',
					'description' => 'Check whether a WordPress navigation menu exists. If none exists, automatically creates a "Main Menu", adds existing published pages to it, and assigns it to all registered theme menu location slots. Call this during PHASE 1 when check_config returns has_nav_menu = false a header with <uichemy-nav-menu> will render an empty nav without a menu assigned.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'menu_name' => array(
								'type'        => 'string',
								'description' => 'Name for the new menu if creation is needed (default: "Main Menu").',
							),
						),
						'required'   => array(),
					),
				),
				array(
					'name'        => 'set_site_branding',
					'description' => 'Set the WordPress site logo and/or site icon from image URLs extracted from the Figma design. Sideloads the image into the media library (reuses existing if already uploaded), then sets it as the WordPress custom_logo (set_theme_mod) and/or site_icon (wp option). Only applies when the corresponding item is not already set, unless force = true. Call this during PHASE 1 when check_config reports has_custom_logo = false or has_site_icon = false and the design has a logo/icon asset in the header.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'logo_url' => array(
								'type'        => 'string',
								'description' => 'URL of the logo image to set as WordPress custom logo. Sideloaded into the media library. Skipped if a logo is already set unless force = true.',
							),
							'logo_width' => array(
								'type'        => 'integer',
								'description' => 'Intended display width (px) of the logo, from the source design. Optional when provided with logo_height, stored on the attachment so the logo renders at the design\'s intended size (also required for SVG logos, since WordPress cannot read intrinsic SVG dimensions on its own).',
							),
							'logo_height' => array(
								'type'        => 'integer',
								'description' => 'Intended display height (px) of the logo, from the source design. Optional see logo_width.',
							),
							'icon_url' => array(
								'type'        => 'string',
								'description' => 'URL of the site icon / favicon image. Square PNG or WebP recommended, at least 192×192px. Skipped if a site icon is already set unless force = true.',
							),
							'force' => array(
								'type'        => 'boolean',
								'description' => 'If true, replace an existing logo/icon even if one is already set. Default false.',
							),
						),
						'required'   => array(),
					),
				),
				array(
					'name'        => 'get_globals_css',
					'description' => 'Read the site design-system CSS the single source of truth for global tokens. Returns { css } for the #uichemy-globals <style> block: a plain CSS file whose :root {} custom properties are grouped into COLLECTIONS by a section comment (e.g. /* Colors */, /* Spacing */, /* Fonts */), optionally followed by reusable classes (.text-* typography, .pr-* components). Call this before set_globals_css so you edit the existing file instead of overwriting it, and reference these var(--name) tokens in the section CSS you generate.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => new stdClass(),
						'required'   => array(),
					),
				),
				array(
					'name'        => 'set_globals_css',
					'description' => 'Write the site design-system CSS (the #uichemy-globals block). Send the COMPLETE CSS file as { css } it replaces the block in place (surrounding head code is preserved). Rules: plain CSS, no @layer, no @-metadata. Put custom properties in :root {}, one per line (e.g. --brand: #FF9900;). GROUP related variables under a plain section comment that names their collection /* Colors */, /* Spacing */, /* Radius */, /* Shadows */, /* Fonts */, or any custom name you like; every variable until the next section comment belongs to that collection (this is the ONLY classifier do not rely on names or value types). Give a variable a stable name once and never rename it (that breaks var() references). Reusable text styles go in .text-* classes and components in .pr-* classes after :root. Always get_globals_css first and return the full merged file.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'css' => array(
								'type'        => 'string',
								'description' => 'The complete CSS for the #uichemy-globals block: :root {} with /* Collection */-grouped custom properties, plus optional .text-*/.pr-* classes.',
							),
						),
						'required'   => array( 'css' ),
					),
				),
				array(
					'name'        => 'edit_globals_css',
					'description' => 'Patch the site design-system CSS (#uichemy-globals) with literal find/replace edits so you change part of the block WITHOUT resending the whole file. Call get_globals_css first and copy the EXACT text you want to change into "find". Each edit replaces ALL exact, case-sensitive occurrences of "find" with "replace"; include enough surrounding text so "find" is unique. To change a value: find "--brand: #FF9900;", replace "--brand: #4B22CC;". To ADD a variable, anchor on a line you keep: find ":root {" → replace ":root {\n --accent: #00AAFF;". To delete: replace with "". Use set_globals_css for the initial full design system; use this for edits. Returns { success, css, replacements:[{find,count}] } count 0 means "find" was not present (fix it and retry).',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'edits' => array(
								'type'        => 'array',
								'description' => 'Find/replace patches, applied in order.',
								'items'       => array(
									'type'       => 'object',
									'properties' => array(
										'find'    => array( 'type' => 'string', 'description' => 'Exact text to find in the current block CSS (copy it from get_globals_css).' ),
										'replace' => array( 'type' => 'string', 'description' => 'Text to replace every occurrence of "find" with. Use "" to delete.' ),
									),
									'required'   => array( 'find', 'replace' ),
								),
							),
						),
						'required'   => array( 'edits' ),
					),
				),
				array(
					'name'        => 'create_uichemy_composer_page',
					'description' => 'Create a WordPress page with a Composer widget pre-filled with generated HTML/CSS/JS body content. Before save, matches literals to the active Elementor kit (colors → var(--e-global-color-*), typography → .text-{id} classes on HTML). Response may include dynamic_globals_matches. Use as section 1 in incremental multi-section imports or standalone single-widget pages. DEFAULT build order (site-wide header/footer via UiChemy\'s native Theme Builder works on ANY Elementor including free, does NOT depend on header_footer_system): (1) create_uichemy_composer_header_footer(type:"header"), (2) create_uichemy_composer_page for the first body section, (3) add_uichemy_composer_section for each subsequent body section, (4) create_uichemy_composer_header_footer(type:"footer"). Do NOT put header/footer markup inside create_uichemy_composer_page in this default case those go to the theme-builder tool. PAGE-ONLY EXCEPTION only when the user explicitly says the header/footer should appear on ONE page only: (1) create_uichemy_composer_page for the HEADER section pass title=<page title>, label="Header", html/css containing the site header markup (nav, logo, CTA). (2) add_uichemy_composer_section for every body section (Hero, Features, etc.). (3) add_uichemy_composer_section for the FOOTER section. Header and Footer become normal page widgets that render immediately when the page publishes no theme-builder activation required. Default to the site-wide path; only use the page-only exception on an explicit user request, never guess.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'title'            => array( 'type' => 'string', 'description' => 'Optional page title. Defaults to "UiChemy AI Landing Page".' ),
							'status'           => array( 'type' => 'string', 'enum' => array( 'draft', 'publish', 'private' ), 'description' => 'Optional post status. Defaults to draft.' ),
							'source'           => array( 'type' => 'string', 'description' => 'Optional source label used in code tags (default: mcp).' ),
							'label'            => array( 'type' => 'string', 'description' => 'Optional human-friendly label included in tags.' ),
							'html'             => array( 'type' => 'string', 'description' => 'Generated HTML to seed in the Composer widget.' ),
							'css'              => array( 'type' => 'string', 'description' => 'Generated responsive CSS. Must include real tablet and mobile rules.' ),
							'js'               => array( 'type' => 'string', 'description' => 'Generated JavaScript to seed in the Composer widget.' ),
							'page_before_head' => array( 'type' => 'string', 'description' => 'Code injected inside <head> on this page only.' ),
							'page_before_body' => array( 'type' => 'string', 'description' => 'Code injected before </body> on this page only.' ),
							'site_before_head' => array( 'type' => 'string', 'description' => 'Code injected inside <head> on every page of the site. Duplicate <link href> URLs are not stored twice.' ),
							'site_before_body' => array( 'type' => 'string', 'description' => 'Code injected before </body> on every page of the site. Content is deduplicated.' ),
							'upload_images'    => array( 'type' => 'boolean', 'description' => 'When true, sideload all <img> URLs from the HTML into the WordPress media library. Defaults to true.' ),
						),
						'required' => array(),
					),
				),
				array(
					'name'        => 'add_uichemy_composer_section',
					'description' => 'Append ONE Composer widget to an existing page (sections 2+ after create_uichemy_composer_page). Default multi-section flow: incremental imports on the same post_id. Runs kit matching on the new section before save. If page_before_head/page_before_body are passed, they merge into the first Composer widget on the page (single copy). Duplicate site_before_head <link href> URLs are skipped. Image uploads default to true.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'          => array( 'type' => 'integer', 'description' => 'Post ID of the existing page returned by create_uichemy_composer_page.' ),
							'label'            => array( 'type' => 'string', 'description' => 'Human-friendly section label shown in the Elementor navigator.' ),
							'html'             => array( 'type' => 'string', 'description' => 'HTML for this section only.' ),
							'css'              => array( 'type' => 'string', 'description' => 'Responsive CSS for this section only. Must include tablet and mobile blocks.' ),
							'js'               => array( 'type' => 'string', 'description' => 'Optional JS for this section only.' ),
							'page_before_head' => array( 'type' => 'string', 'description' => 'Optional page-level code for <head> on this page only. Merges into the first widget.' ),
							'page_before_body' => array( 'type' => 'string', 'description' => 'Optional page-level code before </body> on this page only. Merges into the first widget.' ),
							'site_before_head' => array( 'type' => 'string', 'description' => 'Optional site-wide head markup. Duplicate <link href> URLs are skipped.' ),
							'site_before_body' => array( 'type' => 'string', 'description' => 'Optional code injected before </body> on every page site-wide. Deduplicated.' ),
							'source'           => array( 'type' => 'string', 'description' => 'Optional source label (default: mcp).' ),
							'upload_images'    => array( 'type' => 'boolean', 'description' => 'When true, sideload <img> URLs into the WordPress media library. Defaults to true.' ),
						),
						'required' => array( 'post_id', 'label', 'html' ),
					),
				),
				array(
					'name'        => 'create_uichemy_composer_header_footer',
					'description' => 'Create a NATIVE UiChemy Theme Builder HEADER or FOOTER template seeded with a Composer widget, ACTIVE on the ENTIRE SITE. Works on ANY Elementor (free included) it does NOT require Elementor Pro or Nexter, and its behaviour does NOT depend on check_config\'s header_footer_system value. SELECT THIS TOOL for every header/footer during a conversion UNLESS the user explicitly said the header/footer should appear on ONE page only in that single case, inline it instead (Header = first section of create_uichemy_composer_page, Footer = last add_uichemy_composer_section). Rendering is owned by UiChemy\'s own engine (native uichemy_template), so the template is live immediately with an "entire site" display condition no manual activation step. Creating one automatically deactivates any other active UiChemy template of the same type, so there is never a duplicate. The "system" argument is DEPRECATED and IGNORED templates are always native UiChemy regardless of its value. If another theme-builder system (Elementor Pro / Nexter) is also active, it is DETECTED and reported in "coexistence_conflicts" but never modified. Response includes system:"uichemy_native" and active:true. NOTE: for any OTHER template type (single, archive, product, search, 404) or for non-entire-site placement, use the uichemy-composer/theme-builder ability with action="create" instead.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'type'          => array( 'type' => 'string', 'enum' => array( 'header', 'footer' ), 'description' => 'Template type: "header" or "footer".' ),
							'system'        => array( 'type' => 'string', 'enum' => array( 'auto', 'elementor_pro', 'nexter' ), 'description' => 'Which theme-builder system to create the template on. "auto" (default) = Elementor Pro if active, else Nexter. Pass an explicit value once the user has chosen site-wide placement (e.g. both systems installed, or user specifically wants Nexter). Errors cleanly if the requested system is not installed.' ),
							'title'         => array( 'type' => 'string', 'description' => 'Title of the template shown in Theme Builder.' ),
							'label'         => array( 'type' => 'string', 'description' => 'Human-friendly section label shown in the Elementor navigator.' ),
							'html'          => array( 'type' => 'string', 'description' => 'HTML for this template. Use <uichemy-nav-menu> tag for navigation.' ),
							'css'           => array( 'type' => 'string', 'description' => 'Scoped responsive CSS for this template.' ),
							'js'            => array( 'type' => 'string', 'description' => 'Optional JS for this template.' ),
							'site_css'      => array( 'type' => 'string', 'description' => 'Optional site-wide head markup (Google Fonts <link> tags). Pass on the first upload only.' ),
							'site_js'       => array( 'type' => 'string', 'description' => 'Optional site-wide JS injected before </body>.' ),
							'source'        => array( 'type' => 'string', 'description' => 'Optional source label (default: mcp).' ),
							'upload_images' => array( 'type' => 'boolean', 'description' => 'When true, sideload <img> URLs into the WordPress media library. Defaults to true.' ),
						),
						'required' => array( 'type', 'label', 'html' ),
					),
				),
				array(
					'name'        => 'create_single_post_widget',
					'description' => 'Create a WordPress single post theme-builder template seeded with a Composer widget. USE THIS TOOL only when: (1) AI detects the Figma design looks like a blog/article/single-post layout, AND (2) check_config confirms Elementor Pro OR Nexter Extension is active, AND (3) the user has explicitly confirmed they want a single post template. The tool automatically uses: Elementor Pro → elementor_library "single" template; Nexter → nxt_builder "singular" template; Neither → system=none (fall back to create_uichemy_composer_page). CRITICAL HTML RULES: NO header, NO footer, NO site logo, NO navigation. The body MUST use <uichemy-post-content />.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'title'               => array( 'type' => 'string', 'description' => 'Template title shown in Theme Builder. Defaults to "Single Post UiChemy".' ),
							'post_type'           => array( 'type' => 'string', 'description' => 'WordPress post type slug to target (default: "post").' ),
							'label'               => array( 'type' => 'string', 'description' => 'Human-friendly section label.' ),
							'source'              => array( 'type' => 'string', 'description' => 'Optional source label (default: mcp).' ),
							'html'                => array( 'type' => 'string', 'description' => 'Generated HTML for the article body ONLY. MUST include <uichemy-post-content />.' ),
							'css'                 => array( 'type' => 'string', 'description' => 'Responsive CSS. Must include non-empty tablet and mobile @media blocks.' ),
							'js'                  => array( 'type' => 'string', 'description' => 'Optional JavaScript.' ),
							'site_before_head'    => array( 'type' => 'string', 'description' => 'Code injected inside <head> on every page site-wide. Duplicate <link href> URLs are skipped.' ),
							'site_before_body'    => array( 'type' => 'string', 'description' => 'Code injected before </body> on every page site-wide. Deduplicated.' ),
							'upload_images'       => array( 'type' => 'boolean', 'description' => 'When true, sideload <img> URLs from the HTML into the WordPress media library. Defaults to true.' ),
							'force_deactivate'    => array( 'type' => 'boolean', 'description' => 'Default false. Set to true ONLY after the user has explicitly approved replacing an existing template.' ),
							'create_sample_post'  => array( 'type' => 'boolean', 'description' => 'When true AND sample_post_title is provided, creates a real WordPress post for preview.' ),
							'sample_post_title'   => array( 'type' => 'string', 'description' => 'Title for the sample post. Required when create_sample_post=true.' ),
							'sample_post_content' => array( 'type' => 'string', 'description' => 'Body content for the sample post. Used when create_sample_post=true.' ),
						),
						'required' => array(),
					),
				),
				array(
					'name'        => 'set_page_site_code',
					'description' => 'Set or update site-wide and page-level head/body code for an existing WordPress page. site_before_head and site_before_body apply to every page on the site; page_before_head and page_before_body apply to this page only. Duplicate <link href> URLs in site_before_head are automatically skipped.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'          => array( 'type' => 'integer', 'description' => 'Post ID of the existing page.' ),
							'site_before_head' => array( 'type' => 'string', 'description' => 'Code injected inside <head> on every page of the site.' ),
							'site_before_body' => array( 'type' => 'string', 'description' => 'Code injected before </body> on every page of the site.' ),
							'page_before_head' => array( 'type' => 'string', 'description' => 'Code injected inside <head> on this page only.' ),
							'page_before_body' => array( 'type' => 'string', 'description' => 'Code injected before </body> on this page only.' ),
						),
						'required' => array( 'post_id' ),
					),
				),
				array(
					'name'        => 'list_pages',
					'description' => 'List WordPress pages (or any post type) with their IDs, titles, statuses, and edit/preview URLs. Useful for finding a post_id before inspecting or editing a page.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_type' => array( 'type' => 'string', 'description' => 'Post type to list. Use "page" (default), "post", "elementor_library", or "nxt_builder".' ),
							'status'    => array( 'type' => 'string', 'enum' => array( 'any', 'publish', 'draft', 'private' ), 'description' => 'Filter by post status. Default: "any".' ),
							'per_page'  => array( 'type' => 'integer', 'description' => 'Max results to return (default: 20, max: 100).' ),
						),
						'required' => array(),
					),
				),
				array(
					'name'        => 'list_templates',
					'description' => 'List all Elementor Theme Builder templates (headers, footers, singles, etc.) from both elementor_library and nxt_builder post types. Returns template type, active status, and conditions so you know which templates are live on the site.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'type'     => array( 'type' => 'string', 'description' => 'Filter by template type: "header", "footer", "single", "page", or "all" (default: "all").' ),
							'per_page' => array( 'type' => 'integer', 'description' => 'Max results to return (default: 50).' ),
						),
						'required' => array(),
					),
				),
				array(
					'name'        => 'get_post_structure',
					'description' => 'Get a summary of the Elementor widget tree for a post or page sections, their elType/id, and the list of contained widgets (widgetType + label). Use this to inspect the layout before editing a section or to find the correct widget_index for find_and_update_section_code.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id' => array( 'type' => 'integer', 'description' => 'ID of the WordPress post/page to inspect.' ),
						),
						'required' => array( 'post_id' ),
					),
				),
				array(
					'name'        => 'find_and_update_section_code',
					'description' => 'Get or set the HTML/CSS/JS of a specific Composer widget on a page. Use action="get" to read the current code of a widget (identified by its 0-based widget_index among all Composer widgets). Use action="set" to replace its HTML/CSS/JS runs globals matching and image upload the same way as add_uichemy_composer_section.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'      => array( 'type' => 'integer', 'description' => 'Post/page ID.' ),
							'action'       => array( 'type' => 'string', 'enum' => array( 'get', 'set' ), 'description' => '"get" to read current code, "set" to update it.' ),
							'widget_index' => array( 'type' => 'integer', 'description' => '0-based index among all Composer widgets on the page (default: 0).' ),
							'html'         => array( 'type' => 'string', 'description' => 'New HTML content required for action="set".' ),
							'css'          => array( 'type' => 'string', 'description' => 'New CSS required for action="set".' ),
							'js'           => array( 'type' => 'string', 'description' => 'New JavaScript optional for action="set".' ),
							'upload_images'=> array( 'type' => 'boolean', 'description' => 'When true (default), sideload <img> URLs into the media library during action="set".' ),
						),
						'required' => array( 'post_id', 'action' ),
					),
				),
				array(
					'name'        => 'grab',
					'description' => 'Read the LAST element the user picked in the WordPress admin using the Composer\'s Editor tab element picker (the "Select / pick element" button). Returns { post_id, widget_id, tag, selector, path, html, saved_at } where html is the exact outerHTML of just that one element (not its whole widget). NOTE: this is a snapshot, not a live query there is no persistent connection to the user\'s browser, so it reflects whatever was picked most recently (kept for ~30 minutes). If nothing was picked yet, or the snapshot expired, this returns "found": false ask the user to click the picker and select an element, then call this again. Use this before update_code so you know exactly what you\'re changing without needing to fetch/re-read the whole widget with find_and_update_section_code.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id' => array( 'type' => 'integer', 'description' => 'Optional if given, only returns the snapshot if it was picked on this exact post/page (otherwise treated as nothing selected). Omit to accept a pick from any page.' ),
						),
						'required' => array(),
					),
				),
				array(
					'name'        => 'update_code',
					'description' => 'Surgically replace ONLY the element returned by grab not the rest of its widget. Call grab first (in the same turn or a recent one) so you know its current outerHTML before writing a new one. This tool re-reads the widget\'s current code and swaps just that one element\'s exact HTML for your replacement using a literal match, so if the widget changed since the element was picked (or the html you send doesn\'t exactly match what a fresh grab would return), it fails with a clear error instead of guessing call grab again and retry. CSS (optional) is appended to the widget\'s existing stylesheet; the widget\'s JS is left untouched.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'html' => array( 'type' => 'string', 'description' => 'The complete new outerHTML for the picked element, e.g. "<button class=\"btn\">New Label</button>". Replaces the element\'s previous outerHTML one-for-one.' ),
							'css'  => array( 'type' => 'string', 'description' => 'Optional CSS rules to append to the widget\'s stylesheet (e.g. a rule targeting the element\'s class/selector).' ),
						),
						'required' => array( 'html' ),
					),
				),
				array(
					'name'        => 'insert_section_at_index',
					'description' => 'Insert a new Composer widget at a specific 0-based position (insert_index) within a page\'s Elementor layout. Use insert_index=0 to prepend before all existing sections, or any positive integer to place it after that position. Unlike add_uichemy_composer_section (always appends), this gives precise control over section order. Runs globals matching and image upload just like add_uichemy_composer_section.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => array( 'type' => 'integer', 'description' => 'Post/page ID to insert the section into.' ),
							'insert_index'  => array( 'type' => 'integer', 'description' => '0-based insert position. 0 = before all existing sections.' ),
							'label'         => array( 'type' => 'string', 'description' => 'Human-friendly section label.' ),
							'html'          => array( 'type' => 'string', 'description' => 'HTML for this section.' ),
							'css'           => array( 'type' => 'string', 'description' => 'Responsive CSS for this section.' ),
							'js'            => array( 'type' => 'string', 'description' => 'Optional JavaScript for this section.' ),
							'source'        => array( 'type' => 'string', 'description' => 'Optional source label (default: mcp).' ),
							'upload_images' => array( 'type' => 'boolean', 'description' => 'When true (default), sideload <img> URLs into the WordPress media library.' ),
						),
						'required' => array( 'post_id', 'insert_index', 'label', 'html' ),
					),
				),
				array(
					'name'        => 'start_site_build',
					'description' => 'AUTOMATICALLY CALL this tool when the user asks for a website / landing page / homepage / template / section WITHOUT sharing a Figma or design URL. Returns the full UiChemy direct-prompt pipeline (Header → body → Footer planning, naming, image-upload flow, container rules, build order, verification). Patterns that trigger this match on the SHAPE of the request, not exact words: (1) "make X site/landing/page/design", "build me a Y website", "create a Z homepage/template", (2) "<noun> + service/product/feature design", e.g. "make docker service design", "saas product landing", "fintech app homepage", (3) "design a A for B", "I need a C page", "redesign my D", "spin up a E section", (4) any topic noun + page/site/landing/design/template keyword, however casual. Examples that MUST trigger: "make docker service design", "build a saas landing for my analytics tool", "create a coffee shop website", "I need a portfolio site", "design a pricing page for my plugin", "homepage for ai company". Examples that do NOT trigger: explicit Figma URLs (use uichemy_composer_convert), pure Q&A about WordPress, edits to existing posts. CRITICAL: do NOT start writing HTML/CSS/JS in chat. Call this tool FIRST the returned markdown is your blueprint and you MUST follow it for the rest of the conversation (Header is section 1, Footer is the last section, media uploads go through request_media_upload, naming is real, container is already zeroed). Do NOT ask the user clarifying questions before calling the pipeline itself contains the rules for inferring brand, style, and section plan from a one-line brief. ROUTING EXCEPTION: if the user PROVIDES existing HTML/CSS/JS to reproduce (pasted code, a .html file, or a local project folder), that is NOT this tool use uichemy_composer_convert_code instead (this tool INVENTS a design from a brief; that tool faithfully CONVERTS code the user already has).',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'brief'    => array(
								'type'        => 'string',
								'description' => 'The user\'s request verbatim or lightly paraphrased, e.g. "make docker service design", "build me a saas landing for analytics". Required.',
							),
							'industry' => array(
								'type'        => 'string',
								'description' => 'Optional industry/topic hint you have already inferred (saas, ecommerce, portfolio, agency, restaurant, etc.).',
							),
							'brand'    => array(
								'type'        => 'string',
								'description' => 'Optional brand name you have already picked. If omitted, the pipeline tells you how to infer one from the brief.',
							),
						),
						'required' => array( 'brief' ),
					),
				),
				array(
					'name'        => 'uichemy_composer_convert_code',
					'description' => 'AUTOMATICALLY CALL this tool when the user PROVIDES existing front-end code (HTML / CSS / JS) and wants it turned into a WordPress page NO Figma URL involved. This is the code-conversion counterpart to uichemy_composer_convert (Figma) and start_site_build (invent-from-brief). Trigger on the SHAPE of the request: (1) the user pastes HTML/CSS/JS into chat and says "convert this", "turn this into a page", "import this", "make this a WordPress/Elementor page", "build this on my site"; (2) the user points at local files or a folder "convert index.html", "the HTML in /path", "this landing page project", "my static site in ./dist"; (3) the user shares a self-contained page/component markup and wants it reproduced faithfully on WordPress. KEY DIFFERENCE from start_site_build: here the design ALREADY EXISTS as code and must be reproduced faithfully (same layout, copy, colors, fonts) do NOT redesign. KEY DIFFERENCE from uichemy_composer_convert: there is no Figma URL; the source of truth is the provided code. CRITICAL: do NOT paste the converted HTML back into chat and do NOT hand-write the conversion in chat. Call this tool FIRST the returned markdown is your blueprint (ingest the code, split into Header→body→Footer sections, scope+adapt each to Composer conventions, re-home images, upload via the Composer tools). If the user only gave a one-line brief with NO code and NO Figma URL, use start_site_build instead. If a Figma URL is present, use uichemy_composer_convert instead.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'source_html' => array(
								'type'        => 'string',
								'description' => 'The HTML markup the user provided (pasted in chat), if any. May be a full document or a fragment, and may contain inline <style> / <script>. Optional when project_path is given, but at least one of source_html / project_path is required.',
							),
							'source_css'  => array(
								'type'        => 'string',
								'description' => 'Separate CSS the user provided, if it was not inline in source_html. Optional.',
							),
							'source_js'   => array(
								'type'        => 'string',
								'description' => 'Separate JS the user provided, if it was not inline in source_html. Optional.',
							),
							'project_path' => array(
								'type'        => 'string',
								'description' => 'Absolute path to a local file or folder containing the source (e.g. "/Users/me/site/index.html" or "/Users/me/site"). The pipeline instructs you to load the entry HTML + its linked CSS/JS/images with the Read tool. Optional when source_html is given, but at least one of source_html / project_path is required.',
							),
							'notes'        => array(
								'type'        => 'string',
								'description' => 'Optional extra instructions from the user brand name, page title, "keep it exactly as-is", "make it responsive", which sections to include/skip, etc.',
							),
						),
					),
				),
				array(
					'name'        => 'request_media_upload',
					'description' => 'Issue ONE upload slot, then push every local media file for this build through it: images (AI-generated, screenshots, files on disk), SVG, video (mp4/m4v, webm, ogg, mov) and web fonts (woff2/woff/ttf/otf). Use this whenever you are about to send HTML that references media you do not already have a public https URL for. The other Composer tools sideload from <img src> and <video src> only: they cannot read data: URIs, blob: URIs, local paths, or any URL they cannot fetch over HTTPS. Workflow: (1) call this ONCE per build; the response returns { slot_url, request_header, usage_example, batch_usage_example, expiry }. (2) Run batch_usage_example with your bash tool: it loops over every file in a SINGLE command. Do NOT call this tool again for each file. (3) Each upload responds with { url, attachment_id }; put that url in your <img src> (images, SVG), <video src> (video) or CSS @font-face (fonts). Pass filename and alt as URL-encoded query params on each upload so alt text is written during the upload and needs no follow-up call. File type is detected from the bytes, so never declare it. SVG requires the unfiltered_html capability. Size ceiling is 25 MB per file, 100 MB for video.',
					'inputSchema' => array(
						'type'       => 'object',
						'properties' => array(
							'ttl_minutes' => array(
								'type'        => 'integer',
								'description' => 'How long the slot keeps accepting files. Clamped to 1-30. Defaults to 15, which comfortably covers a full page build.',
								'minimum'     => 1,
								'maximum'     => 30,
							),
						),
						'required' => array(),
					),
				),
			);

			return $tools;
		}

		// ============================================================
		// TOOL EXECUTORS
		//
		// Each returns raw data on success, or a WP_Error on failure. The
		// uichemy_composer_convert tool returns an MCP "resource" content block
		// so its markdown pipeline reaches the client unescaped.
		// ============================================================
	}
}
