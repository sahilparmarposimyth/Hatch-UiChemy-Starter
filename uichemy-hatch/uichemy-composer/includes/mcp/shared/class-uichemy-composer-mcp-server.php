<?php
/**
 * Composer pipeline tool definitions for UiChemy
 *
 * Provides the Composer pipeline tool specs + handlers (Figma-to-HTML, Elementor
 * globals, full-site building). UiChemy no longer runs its own MCP server —
 * these tools are surfaced as WordPress abilities (see
 * class-uichemy-abilities.php) and served through the site-wide MCP gateway.
 * This class is now a spec/handler provider only, consumed via
 * get_tool_definitions().
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Composer_MCP_Server' ) ) {

	/**
	 * Holds the Composer pipeline tool specs and their handler callables,
	 * exposed to the abilities layer via get_tool_definitions().
	 */
	class UiChemy_Composer_MCP_Server {

		// ============================================================
		// CONSTANTS
		// ============================================================

		const SERVER_ID          = 'uichemy-composer-mcp';
		const SERVER_NAME        = 'Composer';
		const SERVER_VERSION     = '1.0.0';
		const SERVER_DESCRIPTION = 'Composer MCP convert Figma designs to HTML/CSS, manage Elementor globals, and build full WordPress sites using the Composer pipeline.';
		const REST_NAMESPACE     = 'uichemy/v1';
		const REST_ROUTE         = 'mcp';
		const PIPELINE_DIR       = UICHEMY_PATH . 'includes/mcp/pipeline/';
		// Enable flag read by UiChemy_Abilities (class-uichemy-abilities.php). The
		// class referenced this constant without defining it, which fatals on every
		// ability call; define it so the check works. Absent option → default '1'
		// (enabled), matching uichemy_settings['enable_mcp'] = 1.
		const ENABLED_OPTION     = 'uichemy_composer_mcp_enabled';

		// ============================================================
		// TOOL SOURCE ONLY
		//
		// UiChemy no longer registers its own MCP server (retired during the
		// gateway consolidation). The former init() / ensure_relay_session() /
		// register_mcp_server() methods were removed. This class now exists only
		// to supply tool specs + handlers to the abilities layer
		// (class-uichemy-abilities.php) and the uichemy_mcp_tools bridge filter
		// via get_tool_definitions().
		// ============================================================

		/**
		 * Tool name → handler callable map. Consumed by get_tool_definitions(),
		 * which feeds the abilities layer (class-uichemy-abilities.php) and the
		 * `uichemy_mcp_tools` bridge filter.
		 *
		 * @return array<string, callable>
		 */
		/**
		 * The v1 tool definitions, kept on this class so every existing caller —
		 * the loader's uichemy_mcp_tools bridge and the abilities registrar — keeps
		 * working unchanged. The table itself now lives in UiChemy_MCP_V1_Tools
		 * (includes/mcp/v1/), so retiring v1 is a matter of deleting that file.
		 *
		 * @return array<int,array>
		 */
		public static function get_tool_definitions() {
			if ( ! class_exists( 'UiChemy_MCP_V1_Tools' ) ) {
				return array();
			}

			return UiChemy_MCP_V1_Tools::get_tool_definitions();
		}

		public static function execute_uichemy_composer_convert( $arguments ) {
			$arguments   = is_array( $arguments ) ? $arguments : array();
			$figma_url   = isset( $arguments['figma_url'] ) ? (string) $arguments['figma_url'] : '';
			$phase       = isset( $arguments['phase'] ) ? (string) $arguments['phase'] : '1';

			if ( '' === trim( $figma_url ) ) {
				return new WP_Error( 'uich_mcp_error', 'Missing required parameter: figma_url' );
			}

			// Phase 1b loads the sync/lookup doc (globals sync is ON). To disable
			// globals again, remap '1b' => array() and restore the short-circuit
			// below that returns a "skip" instruction (see git history).
			$phase_files = array(
				'1'  => array( '01-overview.md', '02-phase1-structure.md', '03-phase1-tokens.md' ),
				'1b' => array( '04-phase1-sync-lookup.md' ),
				'2'  => array( '05-phase2-generate.md', '06-phase2-upload.md' ),
				'3'  => array( '07-phase3-appendix.md' ),
			);

			if ( ! isset( $phase_files[ $phase ] ) ) {
				return new WP_Error( 'uich_mcp_error', 'Invalid phase "' . $phase . '". Valid values: 1, 1b, 2, 3' );
			}

			$pipeline_dir = self::PIPELINE_DIR;
			$file_names   = $phase_files[ $phase ];
			$parts        = array();

			foreach ( $file_names as $name ) {
				$path = $pipeline_dir . $name;
				if ( ! is_readable( $path ) ) {
					continue;
				}
				$chunk = file_get_contents( $path );
				if ( is_string( $chunk ) && '' !== trim( $chunk ) ) {
					$parts[] = $chunk;
				}
			}

			if ( empty( $parts ) ) {
				return new WP_Error( 'uich_mcp_error', 'Pipeline phase "' . $phase . '" files not found or empty. Expected: ' . implode( ', ', $file_names ) );
			}

			$pipeline = str_replace( '{{FIGMA_URL}}', $figma_url, implode( "\n\n", $parts ) );

			return array(
				'type'     => 'resource',
				'uri'      => 'uichemy://composer/pipeline/phase-' . $phase,
				'mimeType' => 'text/markdown',
				'text'     => self::get_pipeline_enforce_block( $phase ) . $pipeline,
			);
		}

		private static function get_pipeline_enforce_block( $phase ) {
			if ( '1' === $phase ) {
				return "## ⚠️ PHASE 1 — READ FIRST (server-injected)

**⛔ TEMP FILE RULE — HARD STOP (read this first)**
When ANY tool result (get_globals_css, get_variable_defs, get_design_context) is saved to a temp file path instead of returned inline — STOP. Do NOT touch the Bash tool. Note: Step 3 uses per-section parallel calls (not root) — each section with excludeScreenshot:true is typically small (~2,000 tokens) and fits inline.
- ❌ FORBIDDEN: `bash head file.txt`, `bash grep \"#\" file.txt`, `bash wc -l`, `bash awk`, `bash sed`, `bash python` — any shell command on the file
- ✅ ONLY ALLOWED: Read tool with `file_path`, `offset`, `limit`
- Why: Each bash command = 3,000–5,000 wasted tokens. 14 bash commands (a common failure) = ~50,000 tokens — more than the entire pipeline. Use Read tool only.

**Temp file extraction algorithm (follow exactly):**
1. Read tool: `{ file_path: \"<temp path>\", offset: 0, limit: 300 }`
2. From that chunk extract all hex colors, font-family+weight+size combos, image URLs, variable names
3. If file has more lines: Read tool again with `offset: 300, limit: 300` — repeat until done
4. Accumulate into `designTokenInventory`. Stop. Do not open a bash terminal.

**A — Token inventory gate (Step 3)**
Before Step 4: print one summary line → `✅ Inventory: N colors · M typography combos · X opacity values`. Stop at Step 3 if inventory not complete. Do NOT print raw JSON blocks or plain-text duplicates of tables — summary line only.

**B — Globals routing**
The design system lives in ONE CSS block (`#uichemy-globals`), not the Elementor kit. Ignore
`atomic_enabled` for globals — it no longer affects this step.
1. `get_globals_css` — read the current block so you extend it, not overwrite it.
2. From your token inventory, build the FULL block: group vars under a `/* Name */` comment
   (Colors / Spacing / Fonts / any name — that comment is the only classifier), reusable text
   styles as `.text-*` classes, components as `.pr-*` classes. Stable names — never rename one
   that already exists, renaming breaks every `var()` reference to it.
3. `set_globals_css` with the complete block — BEFORE Step 4 / any section generation.
4. Build `colorLookup` (hex → `var(--name)`) and `typoLookup` (font combo → `.text-*` class)
   directly from the block you just wrote. Never call `get_globals_css` again after this —
   use what you just built.

**C — Phase gate (mandatory)**
After Steps 1–3 complete and designTokenInventory is stored → call `uichemy_composer_convert(figma_url, phase=\"1b\")`. Do NOT call phase=\"2\" before phase=\"1b\" is processed and lookup tables are confirmed built.

---
";
			}

			if ( '2' === $phase ) {
				return "## ⚠️ PHASE 2 — READ FIRST (server-injected)

**⛔ TEMP FILE RULE — HARD STOP (read this first)**
When get_screenshot or get_design_context saves result to a temp file — STOP. Do NOT use Bash tool.
- ❌ FORBIDDEN: bash head, grep, wc, awk, sed, python on the temp file — any shell command
- ✅ ONLY ALLOWED: Read tool with `file_path`, `offset`, `limit`
- Why: 14 bash commands (seen in real runs) = ~50,000 wasted tokens per section. With 5 sections that is 250,000 tokens wasted on file parsing alone.

**Temp file extraction algorithm (follow exactly, one pass only):**
1. Read tool: `{ file_path: \"<temp path>\", offset: 0, limit: 300 }`
2. Extract from that chunk: layout mode, padding/gap, ALL text nodes (content+font+size+weight), ALL hex colors, ALL image URLs, ALL component refs
3. More lines remaining? Read tool: `offset: 300, limit: 300` — continue until EOF
4. Store everything extracted into `currentSectionMemory`. Stop reading. Never re-read for a different extraction.

**Critical reminders from Phase 1 (still enforced):**
- Steps 6→9 are atomic per section — never pre-fetch next section while current is unsent
- Wipe `currentSectionMemory` after each successful Step 9
- Globals sync is ON: colors that exist in `colorLookup` MUST use `var(--name)` from the `#uichemy-globals` block; typography that exists in `typoLookup` MUST use the matched `.text-*` class and OMIT the font shorthand from CSS. A boxed/constrained content wrapper → add the `.pr-boxed` class (it already reads `var(--content-width)` from the block) instead of writing `max-width` by hand. Unmatched tokens → raw hex / full font shorthand inline.
- `site_before_head` / `site_css` → first upload only, never repeat

**Section flow**
After Step 6 (screenshot + design context): run Steps 7→8→9 in the same turn — generate → verify → upload before starting Step 6 of the next section.

**WordPress upload**
`create_uichemy_composer_page` / `add_uichemy_composer_section` run AI Data Sharing + globals matching server-side — the matcher maps any literal hex/typography left in your CSS to the synced `#uichemy-globals` block, so keep using `colorLookup` / `typoLookup` as you generate.

---
";
			}

			// Other phases (1b, 3) have no extra phase-specific gates injected.
			return '';
		}

		public static function execute_check_config( $arguments = array() ) {
			$has_globals_class  = class_exists( 'UiChemy_Globals_CSS' ) && method_exists( 'UiChemy_Composer_Manager', 'get_globals_block_css' );
			$has_elementor      = class_exists( '\Elementor\Plugin' );
			$has_elementor_pro  = class_exists( '\ElementorPro\Plugin' ) || defined( 'ELEMENTOR_PRO_VERSION' );
			$has_nexter_ext     = post_type_exists( 'nxt_builder' );
			$kit_available      = false;
			$active_kit_id      = null;

			$active_theme     = wp_get_theme();
			$has_nexter_theme = (
				strtolower( (string) $active_theme->get( 'TextDomain' ) ) === 'nexter' ||
				strtolower( (string) $active_theme->get( 'Name' ) ) === 'nexter' ||
				strtolower( get_template() ) === 'nexter'
			);

			if ( $has_elementor ) {
				$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();
				if ( $kit ) {
					$kit_available = true;
					$active_kit_id = $kit->get_id();
				}
			}

			$nav_menus      = wp_get_nav_menus();
			$has_nav_menu   = ! empty( $nav_menus );
			$nav_menu_names = array_values(
				array_map( function ( $m ) { return $m->name; }, $nav_menus )
			);

			if ( $has_elementor_pro ) {
				$header_footer_system = 'elementor_pro';
			} elseif ( $has_nexter_ext ) {
				$header_footer_system = 'nexter';
			} else {
				$header_footer_system = 'elementor';
			}

			$active_header = self::detect_active_header_footer_templates( 'header' );
			$active_footer = self::detect_active_header_footer_templates( 'footer' );

			$custom_logo_id  = absint( get_theme_mod( 'custom_logo', 0 ) );
			$has_custom_logo = $custom_logo_id > 0 && (bool) get_post( $custom_logo_id );
			$custom_logo_url = $has_custom_logo ? (string) wp_get_attachment_url( $custom_logo_id ) : null;

			$site_icon_id  = absint( get_option( 'site_icon', 0 ) );
			$has_site_icon = $site_icon_id > 0 && (bool) get_post( $site_icon_id );
			$site_icon_url = $has_site_icon ? get_site_icon_url( 192 ) : null;

			$experiments    = $has_elementor ? \Elementor\Plugin::$instance->experiments : null;
			$atomic_enabled = $has_elementor
				&& $experiments
				&& method_exists( $experiments, 'is_feature_active' )
				&& (bool) $experiments->is_feature_active( 'e_atomic_elements' );

			$is_ready = $has_globals_class && $has_elementor && $kit_available;

			return array(
				'ready'                => $is_ready,
				'header_footer_system' => $header_footer_system,
				'atomic_enabled'       => $atomic_enabled,
				'checks'               => array(
					'uichemy_globals_class' => $has_globals_class,
					'elementor_active'      => $has_elementor,
					'elementor_pro_active'  => $has_elementor_pro,
					'nexter_extension'      => $has_nexter_ext,
					'nexter_theme'          => $has_nexter_theme,
					'active_kit_found'      => $kit_available,
					'has_nav_menu'          => $has_nav_menu,
					'has_custom_logo'       => $has_custom_logo,
					'has_site_icon'         => $has_site_icon,
				),
				'nav_menus'            => $nav_menu_names,
				'active_header'        => $active_header,
				'active_footer'        => $active_footer,
				'branding'             => array(
					'custom_logo_id'  => $has_custom_logo ? $custom_logo_id : null,
					'custom_logo_url' => $custom_logo_url,
					'site_icon_id'    => $has_site_icon ? $site_icon_id : null,
					'site_icon_url'   => $site_icon_url,
				),
				'diagnostics'          => array(
					'active_kit_id'  => $active_kit_id,
					'wp_version'     => get_bloginfo( 'version' ),
					'php_version'    => phpversion(),
					'site_url'       => get_site_url(),
					'server'         => self::SERVER_ID,
					'server_version' => self::SERVER_VERSION,
				),
				'message'              => $is_ready
					? 'Configuration looks good. Sync tools are ready.'
					: 'Configuration issue detected. Check failed flags in "checks" before running sync.',
			);
		}

		private static function detect_active_header_footer_templates( $type ) {
			$active = array();

			// Cap well above any realistic template count so an active header/footer
			// is never missed past a low limit (the result drives the merge-conflict
			// warning — under-counting silently clobbers an existing header/footer).
			$ep_posts = get_posts( array(
				'post_type'      => 'elementor_library',
				'post_status'    => 'publish',
				'posts_per_page' => 50,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Required meta query for template/widget matching; runs in admin/editor context.
				'meta_query'     => array(
					array( 'key' => '_elementor_template_type', 'value' => $type ),
				),
			) );
			foreach ( $ep_posts as $pid ) {
				$conditions = get_post_meta( (int) $pid, '_elementor_conditions', true );
				if ( ! empty( $conditions ) && is_array( $conditions ) ) {
					$active[] = array(
						'system'     => 'elementor_pro',
						'post_id'    => (int) $pid,
						'title'      => get_the_title( (int) $pid ),
						'conditions' => $conditions,
					);
				}
			}

			if ( post_type_exists( 'nxt_builder' ) ) {
				$nxt_posts = get_posts( array(
					'post_type'      => 'nxt_builder',
					'post_status'    => 'publish',
					'posts_per_page' => 50,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Required meta query for template/widget matching; runs in admin/editor context.
					'meta_query'     => array(
						'relation' => 'AND',
						array( 'key' => 'nxt-hooks-layout-sections', 'value' => $type ),
						array( 'key' => 'nxt_build_status', 'value'   => '1' ),
					),
				) );
				foreach ( $nxt_posts as $pid ) {
					$active[] = array(
						'system'  => 'nexter',
						'post_id' => (int) $pid,
						'title'   => get_the_title( (int) $pid ),
					);
				}
			}

			if ( class_exists( 'UiChemy_Template_CPT' ) ) {
				$native_posts = get_posts( array(
					'post_type'      => UiChemy_Template_CPT::POST_TYPE,
					'post_status'    => 'publish',
					'posts_per_page' => 50,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Required meta query for template/widget matching; runs in admin/editor context.
					'meta_query'     => array(
						'relation' => 'AND',
						array( 'key' => UiChemy_Template_CPT::META_TYPE, 'value' => $type ),
						array( 'key' => UiChemy_Template_CPT::META_STATUS, 'value' => 'active' ),
					),
				) );
				foreach ( $native_posts as $pid ) {
					$active[] = array(
						'system'  => 'uichemy_native',
						'post_id' => (int) $pid,
						'title'   => get_the_title( (int) $pid ),
					);
				}
			}

			return $active;
		}

		public static function execute_ensure_nav_menu( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$payload   = array(
				'menu_name' => isset( $arguments['menu_name'] ) ? sanitize_text_field( (string) $arguments['menu_name'] ) : 'Main Menu',
			);

			$result = UiChemy_Composer_Manager::mcp_ensure_nav_menu( $payload );
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return $result;
		}

		public static function execute_set_site_branding( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$payload   = array(
				'logo_url'    => isset( $arguments['logo_url'] ) ? (string) $arguments['logo_url'] : '',
				'logo_width'  => isset( $arguments['logo_width'] ) ? absint( $arguments['logo_width'] ) : 0,
				'logo_height' => isset( $arguments['logo_height'] ) ? absint( $arguments['logo_height'] ) : 0,
				'icon_url'    => isset( $arguments['icon_url'] ) ? (string) $arguments['icon_url'] : '',
				'force'       => isset( $arguments['force'] ) ? (bool) $arguments['force'] : false,
			);

			$result = UiChemy_Composer_Manager::mcp_set_site_branding( $payload );
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return $result;
		}

		/**
		 * Read the #uichemy-globals CSS block (the design-system source of truth).
		 *
		 * @param array $arguments Unused.
		 * @return array|WP_Error { css: string }
		 */
		public static function execute_get_globals_css( $arguments = array() ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) || ! method_exists( 'UiChemy_Composer_Manager', 'get_globals_block_css' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer Manager unavailable. Ensure UiChemy plugin is active.' );
			}
			return array( 'css' => UiChemy_Composer_Manager::get_globals_block_css() );
		}

		/**
		 * Replace the #uichemy-globals CSS block with the supplied full CSS.
		 *
		 * @param array $arguments { css: string }.
		 * @return array|WP_Error { success: bool, css: string }
		 */
		public static function execute_set_globals_css( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) || ! method_exists( 'UiChemy_Composer_Manager', 'upsert_globals_block' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer Manager unavailable. Ensure UiChemy plugin is active.' );
			}
			$arguments = is_array( $arguments ) ? $arguments : array();
			$css       = isset( $arguments['css'] ) ? (string) $arguments['css'] : '';
			$saved     = UiChemy_Composer_Manager::upsert_globals_block( $css );
			return array(
				'success' => true,
				'css'     => $saved,
			);
		}


		/**
		 * Incrementally merge edit ops into the #uichemy-globals block.
		 *
		 * @param array $arguments { set, remove, set_classes, remove_classes }.
		 * @return array|WP_Error { success, css }
		 */
		public static function execute_edit_globals_css( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) || ! method_exists( 'UiChemy_Composer_Manager', 'edit_globals_block' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer Manager unavailable. Ensure UiChemy plugin is active.' );
			}
			$arguments = is_array( $arguments ) ? $arguments : array();
			$edits     = isset( $arguments['edits'] ) && is_array( $arguments['edits'] ) ? $arguments['edits'] : array();
			// Also accept a single top-level find/replace as a convenience.
			if ( empty( $edits ) && isset( $arguments['find'] ) ) {
				$edits = array(
					array(
						'find'    => $arguments['find'],
						'replace' => isset( $arguments['replace'] ) ? $arguments['replace'] : '',
					),
				);
			}
			$result       = UiChemy_Composer_Manager::edit_globals_block( $edits );
			$replacements = isset( $result['replacements'] ) ? $result['replacements'] : array();

			// A count:0 entry means that edit's `find` text wasn't present in the block —
			// nothing changed for it. Report success only when EVERY edit in the batch
			// actually matched; otherwise a caller (human or AI) that only checks the
			// top-level flag would be told "done" while a requested change silently
			// never applied (the bug this guards against: an AI reports "added" to the
			// user off a bare `success: true` without inspecting `replacements`).
			$all_matched = ! empty( $replacements );
			foreach ( $replacements as $r ) {
				if ( empty( $r['count'] ) ) {
					$all_matched = false;
					break;
				}
			}

			return array(
				'success'      => $all_matched,
				'css'          => isset( $result['css'] ) ? $result['css'] : '',
				'replacements' => $replacements,
			);
		}
		private static function is_atomic_enabled() {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return false;
			}
			$experiments = \Elementor\Plugin::$instance->experiments;
			if ( ! $experiments || ! method_exists( $experiments, 'is_feature_active' ) ) {
				return false;
			}
			return (bool) $experiments->is_feature_active( 'e_atomic_elements' );
		}

		public static function execute_create_uichemy_composer_page( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$payload   = array(
				'title'         => isset( $arguments['title'] ) ? sanitize_text_field( (string) $arguments['title'] ) : 'UiChemy AI Landing Page',
				'status'        => isset( $arguments['status'] ) ? sanitize_key( (string) $arguments['status'] ) : 'draft',
				'source'        => isset( $arguments['source'] ) ? sanitize_text_field( (string) $arguments['source'] ) : 'mcp',
				'label'         => isset( $arguments['label'] ) ? sanitize_text_field( (string) $arguments['label'] ) : '',
				'html'          => isset( $arguments['html'] ) ? (string) $arguments['html'] : '',
				'css'           => isset( $arguments['css'] ) ? (string) $arguments['css'] : '',
				'js'            => isset( $arguments['js'] ) ? (string) $arguments['js'] : '',
				'page_css'      => isset( $arguments['page_before_head'] ) ? (string) $arguments['page_before_head'] : '',
				'page_js'       => isset( $arguments['page_before_body'] ) ? (string) $arguments['page_before_body'] : '',
				'site_css'      => isset( $arguments['site_before_head'] ) ? (string) $arguments['site_before_head'] : '',
				'site_js'       => isset( $arguments['site_before_body'] ) ? (string) $arguments['site_before_body'] : '',
				'upload_images' => isset( $arguments['upload_images'] ) ? (bool) $arguments['upload_images'] : true,
			);

			// Only forwarded when supplied, so the manager keeps defaulting to page.
			// uichemy-composer/post sets this; uichemy-composer/page pins it to "page" upstream.
			if ( ! empty( $arguments['post_type'] ) ) {
				$payload['post_type'] = sanitize_key( (string) $arguments['post_type'] );
			}

			$create_result = UiChemy_Composer_Manager::mcp_create_page_with_generated_code( $payload );
			if ( is_wp_error( $create_result ) ) {
				return $create_result;
			}

			return $create_result;
		}

		public static function execute_add_uichemy_composer_section( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$post_id   = isset( $arguments['post_id'] ) ? absint( $arguments['post_id'] ) : 0;
			if ( ! $post_id ) {
				return new WP_Error( 'uich_mcp_error', 'Missing required parameter: post_id' );
			}

			$payload = array(
				'post_id'       => $post_id,
				'label'         => isset( $arguments['label'] ) ? sanitize_text_field( (string) $arguments['label'] ) : 'Section',
				'source'        => isset( $arguments['source'] ) ? sanitize_text_field( (string) $arguments['source'] ) : 'mcp',
				'html'          => isset( $arguments['html'] ) ? (string) $arguments['html'] : '',
				'css'           => isset( $arguments['css'] ) ? (string) $arguments['css'] : '',
				'js'            => isset( $arguments['js'] ) ? (string) $arguments['js'] : '',
				'page_css'      => isset( $arguments['page_before_head'] ) ? (string) $arguments['page_before_head'] : '',
				'page_js'       => isset( $arguments['page_before_body'] ) ? (string) $arguments['page_before_body'] : '',
				'site_css'      => isset( $arguments['site_before_head'] ) ? (string) $arguments['site_before_head'] : '',
				'site_js'       => isset( $arguments['site_before_body'] ) ? (string) $arguments['site_before_body'] : '',
				'upload_images' => isset( $arguments['upload_images'] ) ? (bool) $arguments['upload_images'] : true,
			);

			$add_result = UiChemy_Composer_Manager::mcp_add_section_to_page( $payload );
			if ( is_wp_error( $add_result ) ) {
				return $add_result;
			}

			return $add_result;
		}

		public static function execute_create_uichemy_composer_header_footer( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$type      = isset( $arguments['type'] ) ? sanitize_key( (string) $arguments['type'] ) : 'header';
			if ( ! in_array( $type, array( 'header', 'footer' ), true ) ) {
				return new WP_Error( 'uich_mcp_error', 'Parameter "type" must be "header" or "footer".' );
			}

			$payload = array(
				'type'          => $type,
				'title'         => isset( $arguments['title'] ) ? sanitize_text_field( (string) $arguments['title'] ) : ( ucfirst( $type ) . ' UiChemy' ),
				'label'         => isset( $arguments['label'] ) ? sanitize_text_field( (string) $arguments['label'] ) : ucfirst( $type ),
				'source'        => isset( $arguments['source'] ) ? sanitize_text_field( (string) $arguments['source'] ) : 'mcp',
				'system'        => isset( $arguments['system'] ) ? sanitize_key( (string) $arguments['system'] ) : 'auto',
				'html'          => isset( $arguments['html'] ) ? (string) $arguments['html'] : '',
				'css'           => isset( $arguments['css'] ) ? (string) $arguments['css'] : '',
				'js'            => isset( $arguments['js'] ) ? (string) $arguments['js'] : '',
				// Caller-facing names first, like the other creators; internal names
				// stay supported for in-process callers.
				'site_css'      => isset( $arguments['site_before_head'] )
					? (string) $arguments['site_before_head']
					: ( isset( $arguments['site_css'] ) ? (string) $arguments['site_css'] : '' ),
				'site_js'       => isset( $arguments['site_before_body'] )
					? (string) $arguments['site_before_body']
					: ( isset( $arguments['site_js'] ) ? (string) $arguments['site_js'] : '' ),
				'upload_images' => isset( $arguments['upload_images'] ) ? (bool) $arguments['upload_images'] : true,
			);

			$result = UiChemy_Composer_Manager::mcp_create_header_footer_template( $payload );
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return $result;
		}

		public static function execute_create_single_post_widget( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$payload   = array(
				'post_type'           => isset( $arguments['post_type'] ) ? sanitize_key( (string) $arguments['post_type'] ) : 'post',
				'title'               => isset( $arguments['title'] ) ? sanitize_text_field( (string) $arguments['title'] ) : 'Single Post UiChemy',
				'label'               => isset( $arguments['label'] ) ? sanitize_text_field( (string) $arguments['label'] ) : 'Single Post',
				'source'              => isset( $arguments['source'] ) ? sanitize_text_field( (string) $arguments['source'] ) : 'mcp',
				'html'                => isset( $arguments['html'] ) ? (string) $arguments['html'] : '',
				'css'                 => isset( $arguments['css'] ) ? (string) $arguments['css'] : '',
				'js'                  => isset( $arguments['js'] ) ? (string) $arguments['js'] : '',
				'site_css'            => isset( $arguments['site_before_head'] ) ? (string) $arguments['site_before_head'] : '',
				'site_js'             => isset( $arguments['site_before_body'] ) ? (string) $arguments['site_before_body'] : '',
				'upload_images'       => isset( $arguments['upload_images'] ) ? (bool) $arguments['upload_images'] : true,
				'force_deactivate'    => isset( $arguments['force_deactivate'] ) ? (bool) $arguments['force_deactivate'] : false,
				'create_sample_post'  => isset( $arguments['create_sample_post'] ) ? (bool) $arguments['create_sample_post'] : false,
				'sample_post_title'   => isset( $arguments['sample_post_title'] ) ? sanitize_text_field( (string) $arguments['sample_post_title'] ) : '',
				'sample_post_content' => isset( $arguments['sample_post_content'] ) ? (string) $arguments['sample_post_content'] : '',
			);

			$result = UiChemy_Composer_Manager::mcp_create_single_post_template( $payload );
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return $result;
		}

		public static function execute_set_page_site_code( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$post_id   = isset( $arguments['post_id'] ) ? (int) $arguments['post_id'] : 0;
			if ( $post_id <= 0 ) {
				return new WP_Error( 'uich_mcp_error', 'Missing or invalid post_id.' );
			}

			// Only forward the scopes the caller actually supplied. The manager treats
			// a present key as "replace this scope", so passing all four unconditionally
			// would clear the three the caller never mentioned.
			$payload = array( 'post_id' => $post_id );
			$map     = array(
				'site_before_head' => 'site_css',
				'site_before_body' => 'site_js',
				'page_before_head' => 'page_css',
				'page_before_body' => 'page_js',
			);
			foreach ( $map as $public_key => $payload_key ) {
				if ( isset( $arguments[ $public_key ] ) ) {
					$payload[ $payload_key ] = (string) $arguments[ $public_key ];
				}
			}

			if ( ! method_exists( 'UiChemy_Composer_Manager', 'mcp_set_page_site_code' ) ) {
				return new WP_Error( 'uich_mcp_error', 'mcp_set_page_site_code is not yet implemented.' );
			}

			$update_result = UiChemy_Composer_Manager::mcp_set_page_site_code( $payload );
			if ( is_wp_error( $update_result ) ) {
				return $update_result;
			}

			return $update_result;
		}

		public static function execute_list_pages( $arguments ) {
			$arguments = is_array( $arguments ) ? $arguments : array();
			$post_type = isset( $arguments['post_type'] ) ? sanitize_key( (string) $arguments['post_type'] ) : 'page';
			$status    = isset( $arguments['status'] ) ? sanitize_key( (string) $arguments['status'] ) : 'any';
			$per_page  = isset( $arguments['per_page'] ) ? min( 100, max( 1, (int) $arguments['per_page'] ) ) : 20;

			$posts = get_posts( array(
				'post_type'      => $post_type,
				'post_status'    => $status,
				'posts_per_page' => $per_page,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			) );

			$items = array();
			foreach ( $posts as $post ) {
				$items[] = array(
					'id'             => $post->ID,
					'title'          => $post->post_title,
					'status'         => $post->post_status,
					'type'           => $post->post_type,
					'modified'       => $post->post_modified,
					'url'            => get_permalink( $post->ID ),
					'edit_link'      => get_edit_post_link( $post->ID, 'internal' ),
					'elementor_link' => add_query_arg(
						array( 'post' => $post->ID, 'action' => 'elementor' ),
						admin_url( 'post.php' )
					),
				);
			}

			return array(
				'post_type' => $post_type,
				'status'    => $status,
				'total'     => count( $items ),
				'pages'     => $items,
			);
		}

		public static function execute_list_templates( $arguments ) {
			$arguments   = is_array( $arguments ) ? $arguments : array();
			$type_filter = isset( $arguments['type'] ) ? sanitize_key( (string) $arguments['type'] ) : 'all';
			$per_page    = isset( $arguments['per_page'] ) ? min( 100, max( 1, (int) $arguments['per_page'] ) ) : 50;

			$templates  = array();
			$meta_query = array();
			if ( 'all' !== $type_filter ) {
				$meta_query[] = array( 'key' => '_elementor_template_type', 'value' => $type_filter );
			}

			$el_posts = get_posts( array(
				'post_type'      => 'elementor_library',
				'post_status'    => 'any',
				'posts_per_page' => $per_page,
				'no_found_rows'  => true,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Required meta query for template/widget matching; runs in admin/editor context.
				'meta_query'     => $meta_query,
			) );
			foreach ( $el_posts as $post ) {
				$template_type = get_post_meta( $post->ID, '_elementor_template_type', true );
				$conditions    = get_post_meta( $post->ID, '_elementor_conditions', true );
				$is_active     = ! empty( $conditions ) && is_array( $conditions );
				$templates[]   = array(
					'id'             => $post->ID,
					'title'          => $post->post_title,
					'system'         => 'elementor_library',
					'template_type'  => $template_type ? $template_type : 'unknown',
					'status'         => $post->post_status,
					'active'         => $is_active,
					'conditions'     => $is_active ? $conditions : array(),
					'edit_link'      => get_edit_post_link( $post->ID, 'internal' ),
					'elementor_link' => add_query_arg( array( 'post' => $post->ID, 'action' => 'elementor' ), admin_url( 'post.php' ) ),
				);
			}

			if ( post_type_exists( 'nxt_builder' ) ) {
				$nxt_meta = array();
				if ( 'all' !== $type_filter ) {
					$nxt_meta[] = array( 'key' => 'nxt-hooks-layout-sections', 'value' => $type_filter );
				}
				$nxt_posts = get_posts( array(
					'post_type'      => 'nxt_builder',
					'post_status'    => 'any',
					'posts_per_page' => $per_page,
					'no_found_rows'  => true,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Required meta query for template/widget matching; runs in admin/editor context.
					'meta_query'     => $nxt_meta,
				) );
				foreach ( $nxt_posts as $post ) {
					$nxt_type    = get_post_meta( $post->ID, 'nxt-hooks-layout-sections', true );
					$is_active   = '1' === get_post_meta( $post->ID, 'nxt_build_status', true );
					$templates[] = array(
						'id'             => $post->ID,
						'title'          => $post->post_title,
						'system'         => 'nexter',
						'template_type'  => $nxt_type ? $nxt_type : 'unknown',
						'status'         => $post->post_status,
						'active'         => $is_active,
						'conditions'     => array(),
						'edit_link'      => get_edit_post_link( $post->ID, 'internal' ),
						'elementor_link' => add_query_arg( array( 'post' => $post->ID, 'action' => 'elementor' ), admin_url( 'post.php' ) ),
					);
				}
			}

			return array(
				'type_filter' => $type_filter,
				'total'       => count( $templates ),
				'templates'   => $templates,
			);
		}

		public static function execute_get_post_structure( $arguments ) {
			$arguments = is_array( $arguments ) ? $arguments : array();
			$post_id   = isset( $arguments['post_id'] ) ? absint( $arguments['post_id'] ) : 0;
			if ( ! $post_id ) {
				return new WP_Error( 'uich_mcp_error', 'Missing required parameter: post_id' );
			}

			$post = get_post( $post_id );
			if ( ! $post ) {
				return new WP_Error( 'uich_mcp_error', "Post ID {$post_id} not found." );
			}

			$raw       = get_post_meta( $post_id, '_elementor_data', true );
			$edit_mode = get_post_meta( $post_id, '_elementor_edit_mode', true );

			if ( ! is_string( $raw ) || '' === $raw ) {
				return array(
					'post_id'           => $post_id,
					'post_title'        => $post->post_title,
					'post_type'         => $post->post_type,
					'elementor_enabled' => false,
					'message'           => 'This post has no Elementor data (_elementor_data is empty).',
				);
			}

			$elements = json_decode( $raw, true );
			if ( ! is_array( $elements ) ) {
				return new WP_Error( 'uich_mcp_error', 'Elementor data for this post is not valid JSON.' );
			}

			$uichemy_widget_counter = 0;
			$sections_summary       = self::summarize_elementor_tree( $elements, $uichemy_widget_counter );

			return array(
				'post_id'               => $post_id,
				'post_title'            => $post->post_title,
				'post_type'             => $post->post_type,
				'post_status'           => $post->post_status,
				'elementor_edit_mode'   => $edit_mode ?: 'builder',
				'top_level_count'       => count( $elements ),
				'total_uichemy_widgets' => $uichemy_widget_counter,
				'structure'             => $sections_summary,
				'edit_link'             => get_edit_post_link( $post_id, 'internal' ),
				'elementor_link'        => add_query_arg( array( 'post' => $post_id, 'action' => 'elementor' ), admin_url( 'post.php' ) ),
				'preview_link'          => get_permalink( $post_id ),
			);
		}

		private static function summarize_elementor_tree( array $elements, &$uichemy_widget_counter ) {
			$summary = array();
			foreach ( $elements as $index => $el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				$el_type    = isset( $el['elType'] ) ? $el['elType'] : 'unknown';
				$widget_type = isset( $el['widgetType'] ) ? $el['widgetType'] : null;
				$el_id      = isset( $el['id'] ) ? $el['id'] : '';
				$settings   = isset( $el['settings'] ) && is_array( $el['settings'] ) ? $el['settings'] : array();

				$node = array( 'index' => $index, 'id' => $el_id, 'elType' => $el_type );

				if ( $widget_type ) {
					$node['widgetType'] = $widget_type;
				}
				if ( uichemy_is_composer_widget_type( $widget_type ) ) {
					$node['uichemy_widget_index'] = $uichemy_widget_counter++;
					$node['label']    = isset( $settings['_title'] ) ? $settings['_title'] : '';
					$node['has_html'] = isset( $settings['raw_html'] ) && '' !== trim( $settings['raw_html'] );
					$node['has_css']  = isset( $settings['raw_css'] ) && '' !== trim( $settings['raw_css'] );
					$node['has_js']   = isset( $settings['raw_js'] ) && '' !== trim( $settings['raw_js'] );
				} elseif ( isset( $settings['_title'] ) && '' !== $settings['_title'] ) {
					$node['label'] = $settings['_title'];
				}

				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					$node['children'] = self::summarize_elementor_tree( $el['elements'], $uichemy_widget_counter );
				}

				$summary[] = $node;
			}
			return $summary;
		}

		public static function execute_find_and_update_section_code( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments    = is_array( $arguments ) ? $arguments : array();
			$post_id      = isset( $arguments['post_id'] ) ? absint( $arguments['post_id'] ) : 0;
			$action       = isset( $arguments['action'] ) ? sanitize_key( (string) $arguments['action'] ) : 'get';
			$widget_index = isset( $arguments['widget_index'] ) ? (int) $arguments['widget_index'] : 0;
			$element_id   = isset( $arguments['element_id'] ) ? sanitize_text_field( (string) $arguments['element_id'] ) : '';
			// Site-wide custom code (~130 KB) is omitted by default so a plain `get`
			// does not blow the tool-result token cap. Opt in with include_site_code=true.
			$include_site_code = isset( $arguments['include_site_code'] ) ? (bool) $arguments['include_site_code'] : false;

			if ( ! $post_id ) {
				return new WP_Error( 'uich_mcp_error', 'Missing required parameter: post_id' );
			}
			if ( ! in_array( $action, array( 'get', 'set' ), true ) ) {
				return new WP_Error( 'uich_mcp_error', 'Parameter "action" must be "get" or "set".' );
			}

			// element_id (Elementor data-id) resolves the exact widget regardless of
			// DOM/data ordering; widget_index is the positional fallback.
			$get_result = UiChemy_Composer_Manager::mcp_get_section_code( $post_id, $widget_index, $element_id, $include_site_code );
			if ( is_wp_error( $get_result ) ) {
				return $get_result;
			}

			if ( 'get' === $action ) {
				return $get_result;
			}

			$html          = isset( $arguments['html'] ) ? (string) $arguments['html'] : '';
			$css           = isset( $arguments['css'] ) ? (string) $arguments['css'] : '';
			$js            = isset( $arguments['js'] ) ? (string) $arguments['js'] : '';
			$upload_images = isset( $arguments['upload_images'] ) ? (bool) $arguments['upload_images'] : true;

			if ( '' === trim( $html ) && '' === trim( $css ) && '' === trim( $js ) ) {
				return new WP_Error( 'uich_mcp_error', 'For action="set" at least one of html, css, or js must be provided.' );
			}

			$widget_id  = $get_result['widget_id'];
			$set_result = UiChemy_Composer_Manager::mcp_sync_generated_code_to_widget(
				$post_id,
				array(
					'mode'          => 'replace',
					'widget_id'     => $widget_id,
					'html'          => $html,
					'css'           => $css,
					'js'            => $js,
					'upload_images' => $upload_images,
					'source'        => 'mcp',
					'label'         => $get_result['label'],
				)
			);
			if ( is_wp_error( $set_result ) ) {
				return $set_result;
			}

			return $set_result;
		}

		/**
		 * Read the last-picked-element snapshot (see class-uichemy-frontend-rest.php's
		 * selected-element storage, at the bottom of UiChemy_Frontend_REST).
		 *
		 * @param array $arguments { post_id?: int }.
		 * @return array|WP_Error
		 */
		public static function execute_grab( $arguments ) {
			if ( ! class_exists( 'UiChemy_Frontend_REST' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Selected-element store not available.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$post_id   = isset( $arguments['post_id'] ) ? absint( $arguments['post_id'] ) : 0;

			$snapshot = UiChemy_Frontend_REST::read_selected_element( $post_id );
			if ( ! $snapshot ) {
				return array(
					'found'   => false,
					'message' => 'No element has been picked yet (or the pick is older than 30 minutes / was on a different page). Ask the user to click "Select / pick element" in the Composer\'s Editor tab and choose one, then call this again.',
				);
			}

			return array_merge( array( 'found' => true ), $snapshot );
		}

		/**
		 * Surgically replace the last-picked element's outerHTML inside its
		 * widget, by literal string match against the snapshot's recorded
		 * `html` (see class-uichemy-frontend-rest.php's selected-element
		 * storage). Reuses the same whole-widget writer as
		 * execute_find_and_update_section_code — this just computes the new full
		 * widget HTML first and always passes the widget's OWN current css/js
		 * through unchanged unless css is given.
		 *
		 * @param array $arguments { html: string, css?: string }.
		 * @return array|WP_Error
		 */
		public static function execute_update_code( $arguments ) {
			if ( ! class_exists( 'UiChemy_Frontend_REST' ) || ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Selected-element store or Composer manager not available.' );
			}

			$arguments   = is_array( $arguments ) ? $arguments : array();
			$new_element = isset( $arguments['html'] ) ? trim( (string) $arguments['html'] ) : '';
			$extra_css   = isset( $arguments['css'] ) ? (string) $arguments['css'] : '';

			if ( '' === $new_element ) {
				return new WP_Error( 'uich_mcp_error', 'Missing required parameter: html' );
			}

			$snapshot = UiChemy_Frontend_REST::read_selected_element();
			if ( ! $snapshot ) {
				return new WP_Error(
					'uich_mcp_no_selection',
					'No element has been picked yet. Call grab first if it also returns nothing, ask the user to pick an element in the Composer\'s Editor tab.'
				);
			}

			$post_id    = (int) $snapshot['post_id'];
			$widget_id  = (string) $snapshot['widget_id'];
			$old_element = (string) $snapshot['html'];

			// This path only needs the widget's own html/css/js/label — never the
			// site-wide code — so skip it to keep the internal read lean.
			$current = UiChemy_Composer_Manager::mcp_get_section_code( $post_id, 0, $widget_id, false );
			if ( is_wp_error( $current ) ) {
				return $current;
			}

			$widget_html = (string) $current['html'];
			$occurrences = ( '' !== $old_element ) ? substr_count( $widget_html, $old_element ) : 0;

			if ( 1 !== $occurrences ) {
				return new WP_Error(
					'uich_mcp_stale_selection',
					$occurrences > 1
						? 'The picked element\'s HTML matches more than one spot in its widget, so a safe surgical replacement isn\'t possible. Call grab again after re-picking a more specific element, then retry.'
						: 'The picked element\'s HTML no longer matches its widget\'s current code (something else changed it since it was picked). Ask the user to re-pick the element, call grab again, then retry.'
				);
			}

			$new_widget_html = str_replace( $old_element, $new_element, $widget_html );
			$new_widget_css  = '' !== trim( $extra_css ) ? trim( $current['css'] . "\n" . $extra_css ) : $current['css'];

			$set_result = UiChemy_Composer_Manager::mcp_sync_generated_code_to_widget(
				$post_id,
				array(
					'mode'          => 'replace',
					'widget_id'     => $widget_id,
					'html'          => $new_widget_html,
					'css'           => $new_widget_css,
					'js'            => $current['js'], // never touched by this tool
					'upload_images' => true,
					'source'        => 'mcp',
					'label'         => $current['label'],
				)
			);
			if ( is_wp_error( $set_result ) ) {
				return $set_result;
			}

			// Keep the snapshot in sync so a follow-up edit can chain without
			// requiring the user to re-pick the same element.
			UiChemy_Frontend_REST::update_selected_element_html( $new_element );

			return $set_result;
		}

		public static function execute_insert_section_at_index( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {
				return new WP_Error( 'uich_mcp_error', 'Composer manager class not found.' );
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$post_id   = isset( $arguments['post_id'] ) ? absint( $arguments['post_id'] ) : 0;
			if ( ! $post_id ) {
				return new WP_Error( 'uich_mcp_error', 'Missing required parameter: post_id' );
			}

			$payload = array(
				'post_id'       => $post_id,
				'insert_index'  => isset( $arguments['insert_index'] ) ? (int) $arguments['insert_index'] : 0,
				'label'         => isset( $arguments['label'] ) ? sanitize_text_field( (string) $arguments['label'] ) : 'Section',
				'source'        => isset( $arguments['source'] ) ? sanitize_text_field( (string) $arguments['source'] ) : 'mcp',
				'html'          => isset( $arguments['html'] ) ? (string) $arguments['html'] : '',
				'css'           => isset( $arguments['css'] ) ? (string) $arguments['css'] : '',
				'js'            => isset( $arguments['js'] ) ? (string) $arguments['js'] : '',
				'upload_images' => isset( $arguments['upload_images'] ) ? (bool) $arguments['upload_images'] : true,
			);

			$result = UiChemy_Composer_Manager::mcp_insert_section_at_index( $payload );
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return $result;
		}

		/**
		 * Direct-prompt entry tool — returns the no-Figma site-build
		 * pipeline as a resource so it lands in the AI context verbatim.
		 *
		 * Aggressively-triggered (see tool description) so casual prompts
		 * like "make docker service design" land here BEFORE the AI
		 * starts hand-writing HTML and skipping Header / Footer.
		 */
		public static function execute_start_site_build( $arguments ) {
			$arguments = is_array( $arguments ) ? $arguments : array();
			$brief     = isset( $arguments['brief'] ) ? trim( (string) $arguments['brief'] ) : '';

			if ( '' === $brief ) {
				return new WP_Error( 'uich_mcp_error', 'Missing required parameter: brief (the user\'s request, e.g. "make docker service design").' );
			}

			$path = self::PIPELINE_DIR . '08-direct-prompt.md';
			if ( ! is_readable( $path ) ) {
				return new WP_Error( 'uich_mcp_error', 'Direct-prompt pipeline file is missing: 08-direct-prompt.md.' );
			}

			$body = file_get_contents( $path );
			if ( ! is_string( $body ) || '' === trim( $body ) ) {
				return new WP_Error( 'uich_mcp_error', 'Direct-prompt pipeline file is empty.' );
			}

			$industry = isset( $arguments['industry'] ) ? trim( (string) $arguments['industry'] ) : '';
			$brand    = isset( $arguments['brand'] ) ? trim( (string) $arguments['brand'] ) : '';

			$header = "## User brief (received)\n\n> " . $brief . "\n\n";
			if ( '' !== $industry ) {
				$header .= "**Industry hint:** " . $industry . "  \n";
			}
			if ( '' !== $brand ) {
				$header .= "**Brand hint:** " . $brand . "  \n";
			}
			$header .= "\n---\n\n";

			return array(
				'type'     => 'resource',
				'uri'      => 'uichemy://composer/pipeline/direct-prompt',
				'mimeType' => 'text/markdown',
				'text'     => $header . $body,
			);
		}

		public static function execute_uichemy_composer_convert_code( $arguments ) {
			$arguments = is_array( $arguments ) ? $arguments : array();

			$source_html  = isset( $arguments['source_html'] ) ? (string) $arguments['source_html'] : '';
			$source_css   = isset( $arguments['source_css'] ) ? (string) $arguments['source_css'] : '';
			$source_js    = isset( $arguments['source_js'] ) ? (string) $arguments['source_js'] : '';
			$project_path = isset( $arguments['project_path'] ) ? trim( (string) $arguments['project_path'] ) : '';
			$notes        = isset( $arguments['notes'] ) ? trim( (string) $arguments['notes'] ) : '';

			if ( '' === trim( $source_html ) && '' === $project_path ) {
				return new WP_Error( 'uich_mcp_error', 'Provide at least one source: source_html (pasted markup) or project_path (a local file/folder).' );
			}

			$path = self::PIPELINE_DIR . '09-code-input.md';
			if ( ! is_readable( $path ) ) {
				return new WP_Error( 'uich_mcp_error', 'Code-input pipeline file is missing: 09-code-input.md.' );
			}

			$body = file_get_contents( $path );
			if ( ! is_string( $body ) || '' === trim( $body ) ) {
				return new WP_Error( 'uich_mcp_error', 'Code-input pipeline file is empty.' );
			}

			// Echo back a compact manifest of what the caller supplied so the AI
			// knows where the design lives (inline args vs. files on disk). We do
			// NOT inline the full source here — for pasted code it is already in
			// the conversation, and for large blobs re-embedding would bloat the
			// resource. The pipeline (Step 1) tells the AI how to load each case.
			$manifest = array();
			if ( '' !== trim( $source_html ) ) {
				$manifest[] = '- `source_html` provided inline (' . number_format_i18n( strlen( $source_html ) ) . ' chars)'
					. ( false !== stripos( $source_html, '<style' ) ? ' contains inline `<style>`' : '' )
					. ( false !== stripos( $source_html, '<script' ) ? ' contains inline `<script>`' : '' );
			}
			if ( '' !== trim( $source_css ) ) {
				$manifest[] = '- `source_css` provided inline (' . number_format_i18n( strlen( $source_css ) ) . ' chars)';
			}
			if ( '' !== trim( $source_js ) ) {
				$manifest[] = '- `source_js` provided inline (' . number_format_i18n( strlen( $source_js ) ) . ' chars)';
			}
			if ( '' !== $project_path ) {
				$manifest[] = '- `project_path`: `' . $project_path . '` load the entry HTML + its linked CSS/JS/images with the **Read tool** (Step 1).';
			}

			$header  = "## Source (received)\n\n" . implode( "\n", $manifest ) . "\n\n";
			if ( '' !== $notes ) {
				$header .= "**User notes:** " . $notes . "\n\n";
			}
			$header .= "---\n\n";

			return array(
				'type'     => 'resource',
				'uri'      => 'uichemy://composer/pipeline/code-input',
				'mimeType' => 'text/markdown',
				'text'     => $header . $body,
			);
		}

		/**
		 * Issue a temporary upload slot for an AI-generated image.
		 *
		 * Thin wrapper around UiChemy_Composer_Upload::issue_slot — the heavy
		 * lifting (token mint, transient store, curl example) lives in
		 * class-uichemy-composer-upload.php. We just sanitize the MCP-side
		 * inputs and forward.
		 */
		public static function execute_request_media_upload( $arguments ) {
			if ( ! class_exists( 'UiChemy_Composer_Upload' ) ) {
				require_once UICHEMY_PATH . 'includes/mcp/shared/class-uichemy-composer-upload.php';
			}

			$arguments = is_array( $arguments ) ? $arguments : array();
			$payload   = array();
			if ( isset( $arguments['ttl_minutes'] ) ) {
				$payload['ttl_minutes'] = (int) $arguments['ttl_minutes'];
			}

			return UiChemy_Composer_Upload::issue_slot( $payload );
		}
	}
}
