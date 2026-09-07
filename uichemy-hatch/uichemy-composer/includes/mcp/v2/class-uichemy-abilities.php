<?php
/**
 * UiChemy Abilities Registrar
 *
 * Registers the Composer pipeline as first-class WordPress Abilities (Abilities
 * API, WP 7.0+) under the `uichemy/` namespace, flagged meta.mcp.public = true
 * so an MCP gateway exposes them automatically.
 *
 * The v2 surface is deliberately NOT one ability per legacy tool. Related tools
 * are folded into action-routed abilities (page, post, template, platform,
 * media, design-system, …) so a client learns one door per job instead of
 * twenty names and the ordering between them. The v1 endpoint keeps serving its
 * original flat tools unchanged — retired_map() records where each one went.
 *
 * @link       https://posimyth.com/
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Abilities' ) ) {

	/**
	 * Maps Composer's tool definitions onto the WordPress Abilities API.
	 */
	class UiChemy_Abilities {

		/**
		 * Ability namespace / category slug.
		 */
		const CATEGORY = 'uichemy-composer';

		/**
		 * Legacy-tool-name → uichemy ability-name map, for the tools still surfaced
		 * one-to-one.
		 *
		 * Almost everything has been folded into an action-routed ability instead —
		 * see retired_map(). What is left are the ingestion entry points, which
		 * mostly returned pipeline documents and are excluded from v2 discovery in
		 * favour of uichemy-composer/read-skill.
		 *
		 * @return array<string,string>
		 */
		private static function name_map() {
			// Ability names must match ^[a-z0-9-]+\/[a-z0-9-]+$ (WP core) — slugs
			// use hyphens, never underscores.
			return array(
				'uichemy_composer_convert'      => 'uichemy-composer/convert',
				'uichemy_composer_convert_code' => 'uichemy-composer/convert-code',
				'start_site_build'              => 'uichemy-composer/start-site-build',
			);
		}

		/**
		 * Retired v1 tool name → the v2 ability that absorbed its job.
		 *
		 * A row here means the tool is deliberately absent from name_map, so no
		 * ability is registered for it, but v1 spec prose still mentions it by name.
		 * rebrand() rewrites those mentions to the new home.
		 *
		 * Public because UiChemy_Skills consumes the same map to translate the
		 * pipeline documents for the v2 surface. One table, so a fold can never be
		 * reflected in an ability description but missed in the process document
		 * that tells the model to call it.
		 *
		 * @return array<string,string>
		 */
		public static function retired_map() {
			return array(
				'check_config'                          => 'uichemy-composer/describe-site',
				'create_uichemy_composer_page'          => 'uichemy-composer/page (action="create")',
				'add_uichemy_composer_section'          => 'uichemy-composer/page (action="append-section")',
				'insert_section_at_index'               => 'uichemy-composer/page (action="insert-section")',
				'set_page_site_code'                    => 'uichemy-composer/page (action="set-page-code")',
				'list_pages'                            => 'uichemy-composer/page (action="list")',
				'get_post_structure'                    => 'uichemy-composer/page (action="get-structure")',
				'find_and_update_section_code'          => 'uichemy-composer/page (action="get-section-code" / "set-section-code")',
				// NOTE: "grab" is deliberately absent — it is an ordinary English word
				// that appears in prose ("grab again before each update"), and rebrand()
				// substitutes by substring, so a row here would rewrite sentences.
				'update_code'                           => 'uichemy-composer/page (action="patch-section-code")',
				'list_templates'                        => 'uichemy-composer/template (action="list")',
				'create_uichemy_composer_header_footer' => 'uichemy-composer/template (action="create", type="header"|"footer")',
				'create_single_post_widget'             => 'uichemy-composer/template (action="create", type="single")',
				'create_theme_builder_template'         => 'uichemy-composer/theme-builder (action="create")',
				'get_globals_css'                       => 'uichemy-composer/design-system (action="get")',
				'set_globals_css'                       => 'uichemy-composer/design-system (action="set")',
				'edit_globals_css'                      => 'uichemy-composer/design-system (action="patch")',
				'request_media_upload'                  => 'uichemy-composer/media (action="request-upload")',
				'ensure_nav_menu'                       => 'uichemy-composer/platform (action="update-menu")',
				'set_site_branding'                     => 'uichemy-composer/platform (action="update-site-settings")',
			);
		}

		/**
		 * Short descriptions, and long-form prose relocated to the input schema.
		 *
		 * A tool description exists to help a model decide WHETHER to call the tool,
		 * and is paid for on every discovery call whether or not the tool is used.
		 * Almost every entry that used to live here belongs to an ability that has
		 * since been folded, so the table is empty — the consolidated abilities write
		 * their own short descriptions at registration instead. It stays as the hook
		 * for any name_map tool that needs its spec text overridden.
		 *
		 * @return array<string,array{description?:string,schema_description?:string}>
		 */
		private static function overrides() {
			return array();
		}

		/**
		 * Tools that only read state — surfaced as readonly in the catalogue.
		 *
		 * @return array<int,string>
		 */
		private static function readonly_tools() {
			return array();
		}

		/**
		 * The three content abilities and what makes each one different.
		 *
		 * Everything they have in common lives in content_actions() and the shared
		 * router; this table is only the part that genuinely varies — the slug, how
		 * the ability introduces itself, and which entry point it calls.
		 *
		 * @return array<string,array>
		 */
		private static function content_domains() {
			$shared = ' FIND: "list", "grep" (search every section\'s code, like grep -rn), "get-structure" (sections with the section_index / element_id everything else targets by). '
				. 'CREATE: "create", "create-with-sections", "append-section", "insert-section" (at a 0-based insert_index). '
				. 'EDIT: "get-section-code", "set-section-code" (replace wholesale), "patch-section-code" (literal find/replace edits - cheaper and safer for small changes). '
				. 'ARRANGE: "move-section", "duplicate-section", "delete-section" (DESTRUCTIVE, two-step confirm_token). '
				. 'CODE: "get-page-code", "set-page-code" (replace), "update-page-code" (append, deduped) - page-level only; site-wide head/body code belongs to uichemy-composer/platform. '
				. 'Target a section by element_id (exact, survives reordering) or section_index (positional). '
				. 'Every section write runs kit matching on the CSS and sideloads <img> URLs into the media library.';

			$preamble = 'Pick "action", then pass that action\'s own parameters as "action_parameters" - meta.actions carries the exact schema for each one.';

			return array(
				'page'     => array(
					'slug'               => 'uichemy-composer/page',
					'label'              => 'UiChemy Builder: Page',
					'description'        => 'Everything about a WordPress page and its Composer sections (one section = one editable widget): find, create, edit, reorder, delete, and page head-body code.',
					'schema_description' => $preamble . $shared . ' Fixed to the "page" post type - for posts and custom post types use uichemy-composer/post, for theme-builder templates use uichemy-composer/template. Whole-page deletion is not here; use your WordPress tools.',
					'handler'            => 'execute_page',
				),
				'post'     => array(
					'slug'               => 'uichemy-composer/post',
					'label'              => 'UiChemy Builder: Post',
					'description'        => 'The same section toolkit as uichemy-composer/page, pointed at posts and custom post types. Pass post_type to work on products, portfolio items or any other public type.',
					'schema_description' => $preamble . $shared . ' Defaults to the "post" type; "list", "create" and "create-with-sections" accept a post_type, so one ability covers every public custom post type. Whole-post deletion is not here; use your WordPress tools.',
					'handler'            => 'execute_post',
				),
				'template' => array(
					'slug'               => 'uichemy-composer/template',
					'label'              => 'UiChemy Builder: Template',
					'description'        => 'The same section toolkit as uichemy-composer/page, pointed at theme-builder templates (header, footer, single). "list" shows type, active status and conditions; "create" takes a type.',
					'schema_description' => $preamble . $shared . ' "create" needs a type (header | footer | single) and an optional system (elementor_pro | nexter | auto). THEME BUILDER: "set-conditions" decides where a template renders (a template with no conditions renders nowhere), "toggle" turns one on or off without losing its conditions, "delete" removes one (DESTRUCTIVE, two-step confirm_token). Plain Elementor produces an INACTIVE template on create - set-conditions fixes that, or build the header/footer as page sections instead. There is no create-with-sections: make the template, then append-section for the rest.',
					'handler'            => 'execute_template',
				),
			);
		}

		/**
		 * Per-action parameter schemas for the content trio.
		 *
		 * The abilities' own input schema is deliberately tiny — `action` plus an
		 * opaque `action_parameters` object — because a flat union of every action's
		 * parameters cannot express that post_id is required for append-section but
		 * meaningless for create. Each action carries its own schema here instead,
		 * served under meta.actions, so a client reads the exact contract for the one
		 * action it is about to run.
		 *
		 * @param string $domain page | post | template.
		 * @return array<int,array{name:string,description:string,action_parameters_schema:array}>
		 */
		private static function content_actions( $domain ) {
			$is_template = ( 'template' === $domain );
			$is_post     = ( 'post' === $domain );
			// What one item is called, so a description reads naturally in whichever
			// ability is serving it.
			$noun = $is_template ? 'template' : ( $is_post ? 'post' : 'page' );

			// Shared parameter fragments — the same field means the same thing in
			// every action that accepts it.
			$html = array( 'type' => 'string', 'description' => 'Section HTML.' );
			$css  = array( 'type' => 'string', 'description' => 'Responsive CSS for this section. Must include real tablet and mobile rules.' );
			$js   = array( 'type' => 'string', 'description' => 'Optional JavaScript for this section.' );

			$label   = array( 'type' => 'string', 'description' => 'Human-friendly section label shown in the Elementor navigator.' );
			$post_id = array( 'type' => 'integer', 'description' => 'ID of the existing ' . $noun . ', as returned by action="create".' );
			$source  = array( 'type' => 'string', 'description' => 'Optional source label used in code tags (default "mcp").' );
			$uploads = array( 'type' => 'boolean', 'description' => 'Sideload <img> URLs from the HTML into the media library (default true).' );

			$page_head = array( 'type' => 'string', 'description' => 'Code for <head> on this ' . $noun . ' only.' );
			$page_body = array( 'type' => 'string', 'description' => 'Code for just before </body> on this ' . $noun . ' only. Bare JavaScript is wrapped in <script> for you; markup (a fixed background layer, a modal root, a <noscript> pixel) is stored exactly as written.' );
			$site_head = array( 'type' => 'string', 'description' => 'Code for <head> on every page of the site.' );
			$site_body = array( 'type' => 'string', 'description' => 'Code for just before </body> on every page of the site.' );

			// Section targeting: element_id is exact, section_index is positional.
			$section_index = array( 'type' => 'integer', 'description' => '0-based section order from action="get-structure". Alternative to element_id.' );
			$element_id    = array( 'type' => 'string', 'description' => 'Exact Elementor element id of the section. Preferred over section_index - it survives reordering.' );

			$actions = array(
				// ---------- Discovery ----------
				$is_template
					? array(
						'name'                     => 'list',
						'description'              => 'List theme-builder templates with their type, active status and display conditions, so you can see which templates are live.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'type'     => array( 'type' => 'string', 'enum' => array( 'all', 'header', 'footer', 'single', 'page' ), 'description' => 'Filter by template type (default "all").' ),
								'per_page' => array( 'type' => 'integer', 'description' => 'Max results (default 50).' ),
							),
							'required'   => array(),
						),
					)
					: array(
						'name'                     => 'list',
						'description'              => 'List ' . $noun . 's with their IDs, titles, statuses and edit/preview URLs. Use it to find a post_id.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array_merge(
								$is_post
									? array( 'post_type' => array( 'type' => 'string', 'description' => 'Which post type to list (default "post"). Any public type works - "product", "portfolio", a custom one.' ) )
									: array(),
								array(
									'status'   => array( 'type' => 'string', 'description' => 'Post status filter, or "any" (default).' ),
									'per_page' => array( 'type' => 'integer', 'description' => 'How many to return, 1-100 (default 20).' ),
								)
							),
							'required'   => array(),
						),
					),
				array(
					'name'                     => 'grep',
					'description'              => 'Search the text of every Composer section, like grep -rn. Returns each matching line with the post_id and section_index needed to edit it.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'pattern'     => array( 'type' => 'string', 'description' => 'What to search for. A literal substring unless regex is true.' ),
							'regex'       => array( 'type' => 'boolean', 'description' => 'Treat pattern as a regular expression (no delimiters - pass "class=\"btn-.*\"", not "/class.../"). Default false.' ),
							'ignore_case' => array( 'type' => 'boolean', 'description' => 'Case-insensitive match, like grep -i. Default false.' ),
							'field'       => array( 'type' => 'string', 'enum' => array( 'all', 'html', 'css', 'js' ), 'description' => 'Which part of each section to search (default "all").' ),
							'post_id'     => array( 'type' => 'integer', 'description' => 'Search only this one. Omit to search them all.' ),
							'post_type'   => array( 'type' => 'string', 'description' => 'Restrict the sweep to one post type.' ),
							'max_results' => array( 'type' => 'integer', 'description' => 'Cap on matches returned, 1-500 (default 100). The response flags when it truncated.' ),
						),
						'required'   => array( 'pattern' ),
					),
				),
				array(
					'name'                     => 'get-structure',
					'description'              => 'Summarise this ' . $noun . '\'s Elementor widget tree and return the section_index / element_id values every other section action needs.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array( 'post_id' => $post_id ),
						'required'   => array( 'post_id' ),
					),
				),

				// ---------- Creation ----------
				$is_template
					? array(
						'name'                     => 'create',
						'description'              => 'Create a theme-builder template (header, footer or single) seeded with a Composer widget. Elementor Pro and Nexter activate it site-wide on creation; plain Elementor produces an INACTIVE template, so on that setup build the header/footer as page sections instead.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'type'             => array( 'type' => 'string', 'enum' => array( 'header', 'footer', 'single' ), 'description' => 'Which template to create. "single" needs Elementor Pro or Nexter and its body MUST use <uichemy-post-content /> with no header, footer or nav.' ),
								'system'           => array( 'type' => 'string', 'enum' => array( 'auto', 'elementor_pro', 'nexter' ), 'description' => 'Which theme builder receives it. "auto" (default) prefers Pro when both are installed - pass one explicitly when the user chose.' ),
								'title'            => array( 'type' => 'string', 'description' => 'Template title.' ),
								'label'            => $label,
								'html'             => $html,
								'css'              => $css,
								'js'               => $js,
								'site_before_head' => $site_head,
								'site_before_body' => $site_body,
								'source'           => $source,
								'upload_images'    => $uploads,
							),
							'required'   => array( 'type' ),
						),
					)
					: array(
						'name'                     => 'create',
						'description'              => 'Create a ' . $noun . ' with ONE section. Use create-with-sections instead when you already have every section.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array_merge(
								array(
									'title'  => array( 'type' => 'string', 'description' => ucfirst( $noun ) . ' title. Defaults to "UiChemy AI Landing Page".' ),
									'status' => array( 'type' => 'string', 'enum' => array( 'draft', 'publish', 'private' ), 'description' => 'Post status. Defaults to draft.' ),
								),
								$is_post
									? array( 'post_type' => array( 'type' => 'string', 'description' => 'Which post type to create (default "post"). Any public type works - "product", "portfolio", a custom one.' ) )
									: array(),
								array(
									'label'            => $label,
									'html'             => $html,
									'css'              => $css,
									'js'               => $js,
									'page_before_head' => $page_head,
									'page_before_body' => $page_body,
									'site_before_head' => $site_head,
									'site_before_body' => $site_body,
									'source'           => $source,
									'upload_images'    => $uploads,
								)
							),
							'required'   => array(),
						),
					),

				// ---------- Theme-builder verbs — only meaningful on a template ----------
				$is_template
					? array(
						'name'                     => 'set-conditions',
						'description'              => 'Set where a template renders. A template with no conditions renders NOWHERE - that is the usual reason a finished-looking build leaves the site unchanged. scope="site" is the common case.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'post_id' => array( 'type' => 'integer', 'description' => 'Template post ID from action="list".' ),
								'scope'   => array( 'type' => 'string', 'enum' => array( 'site', 'front', 'singular', 'archive', 'none' ), 'description' => 'Preset: site = entire site, front = front page only, singular = all single posts, archive = archives, none = renders nowhere.' ),
								'rules'   => array(
									'type'        => 'array',
									'description' => 'Explicit Elementor condition strings instead of a preset, e.g. ["include/general"]. Nexter has no per-rule store - it maps to on/off.',
									'items'       => array( 'type' => 'string' ),
								),
							),
							'required'   => array( 'post_id' ),
						),
					)
					: null,
				$is_template
					? array(
						'name'                     => 'toggle',
						'description'              => 'Turn a template on or off without losing its conditions - they are stashed on deactivate and restored on activate.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'post_id' => array( 'type' => 'integer', 'description' => 'Template post ID.' ),
								'active'  => array( 'type' => 'boolean', 'description' => 'true to activate, false to deactivate.' ),
							),
							'required'   => array( 'post_id', 'active' ),
						),
					)
					: null,
				$is_template
					? array(
						'name'                     => 'delete',
						'description'              => 'Delete a template. DESTRUCTIVE and TWO-STEP: the first call returns requires_confirmation plus a confirm_token, and says whether the template is currently active. Deleting an active header or footer changes every page it renders on.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'post_id'       => array( 'type' => 'integer', 'description' => 'Template post ID.' ),
								'confirm_token' => array( 'type' => 'string', 'description' => 'Echo back the exact token from the first call.' ),
							),
							'required'   => array( 'post_id' ),
						),
					)
					: null,

				$is_template
					? null
					: array(
						'name'                     => 'create-with-sections',
						'description'              => 'Create a ' . $noun . ' where EACH item in sections[] becomes its own editable widget, in one call. The default when you already have every section.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array_merge(
								array(
									'title'  => array( 'type' => 'string', 'description' => ucfirst( $noun ) . ' title.' ),
									'status' => array( 'type' => 'string', 'enum' => array( 'draft', 'publish', 'private' ), 'description' => 'Post status. Defaults to draft.' ),
								),
								$is_post
									? array( 'post_type' => array( 'type' => 'string', 'description' => 'Which post type to create (default "post"). Any public type works.' ) )
									: array(),
								array(
									'sections'         => array(
										'type'        => 'array',
										'description' => 'Ordered sections; each becomes its own Composer widget, top to bottom.',
										'items'       => array(
											'type'       => 'object',
											'properties' => array(
												'label' => $label,
												'html'  => $html,
												'css'   => $css,
												'js'    => $js,
											),
											'required'   => array( 'label', 'html' ),
										),
									),
									'page_before_head' => $page_head,
									'page_before_body' => $page_body,
									'site_before_head' => $site_head,
									'site_before_body' => $site_body,
									'source'           => $source,
									'upload_images'    => $uploads,
								)
							),
							'required'   => array( 'sections' ),
						),
					),

				// ---------- Section creation ----------
				array(
					'name'                     => 'append-section',
					'description'              => 'Append one section to the end of an existing ' . $noun . '. One call per section, same post_id.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'          => $post_id,
							'label'            => $label,
							'html'             => $html,
							'css'              => $css,
							'js'               => $js,
							'page_before_head' => array( 'type' => 'string', 'description' => 'Page-level <head> code. Merges into the first Composer widget as a single copy.' ),
							'page_before_body' => array( 'type' => 'string', 'description' => 'Page-level pre-</body> code. Merges into the first Composer widget.' ),
							'site_before_head' => $site_head,
							'site_before_body' => $site_body,
							'source'           => $source,
							'upload_images'    => $uploads,
						),
						'required'   => array( 'post_id', 'label', 'html' ),
					),
				),
				array(
					'name'                     => 'insert-section',
					'description'              => 'Insert a section at a specific 0-based position instead of appending. Use when order matters.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'insert_index'  => array( 'type' => 'integer', 'description' => '0-based insert position. 0 prepends before all existing sections.' ),
							'label'         => $label,
							'html'          => $html,
							'css'           => $css,
							'js'            => $js,
							'source'        => $source,
							'upload_images' => $uploads,
						),
						'required'   => array( 'post_id', 'insert_index', 'label', 'html' ),
					),
				),

				// ---------- Section code ----------
				array(
					'name'                     => 'get-section-code',
					'description'              => 'Read one section\'s current HTML, CSS and JS. Do this before set-section-code or patch-section-code.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'section_index' => $section_index,
							'element_id'    => $element_id,
						),
						'required'   => array( 'post_id' ),
					),
				),
				array(
					'name'                     => 'set-section-code',
					'description'              => 'Replace one section\'s HTML/CSS/JS wholesale. For a small change prefer patch-section-code, which cannot silently rewrite the rest.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'section_index' => $section_index,
							'element_id'    => $element_id,
							'html'          => $html,
							'css'           => $css,
							'js'            => $js,
							'upload_images' => $uploads,
						),
						'required'   => array( 'post_id' ),
					),
				),
				array(
					'name'                     => 'patch-section-code',
					'description'              => 'Apply literal find/replace edits to one section instead of resending it. Each edit reports its own match count, so a find that matched nothing is visible rather than silently dropped.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'section_index' => $section_index,
							'element_id'    => $element_id,
							'edits'         => array(
								'type'        => 'array',
								'description' => 'Edits applied in order. Every exact, case-sensitive occurrence of find is replaced, so include enough surrounding text to make find unique.',
								'items'       => array(
									'type'       => 'object',
									'properties' => array(
										'find'    => array( 'type' => 'string', 'description' => 'Exact text to look for.' ),
										'replace' => array( 'type' => 'string', 'description' => 'What to put in its place. Empty string deletes.' ),
										'field'   => array( 'type' => 'string', 'enum' => array( 'html', 'css', 'js' ), 'description' => 'Which part of the section to edit (default "html").' ),
									),
									'required'   => array( 'find' ),
								),
							),
						),
						'required'   => array( 'post_id', 'edits' ),
					),
				),

				// ---------- Section structure ----------
				array(
					'name'                     => 'move-section',
					'description'              => 'Reorder a section to a new 0-based slot within its container.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'to_index'      => array( 'type' => 'integer', 'description' => 'Destination 0-based slot.' ),
							'section_index' => $section_index,
							'element_id'    => $element_id,
						),
						'required'   => array( 'post_id', 'to_index' ),
					),
				),
				array(
					'name'                     => 'duplicate-section',
					'description'              => 'Clone a section (fresh element id) directly after the original. Non-destructive.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'section_index' => $section_index,
							'element_id'    => $element_id,
							'label'         => array( 'type' => 'string', 'description' => 'Optional label for the clone. Defaults to the original\'s.' ),
						),
						'required'   => array( 'post_id' ),
					),
				),
				array(
					'name'                     => 'delete-section',
					'description'              => 'Remove a section. DESTRUCTIVE and TWO-STEP: the first call returns requires_confirmation plus a confirm_token; call again with that exact token to actually delete.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'section_index' => $section_index,
							'element_id'    => $element_id,
							'confirm_token' => array( 'type' => 'string', 'description' => 'Echo back the exact token from the first call. It is bound to this section\'s current content, so it stops working if the section changes in between.' ),
						),
						'required'   => array( 'post_id' ),
					),
				),

				// ---------- Page head + body code (page scope only) ----------
				array(
					'name'                     => 'get-page-code',
					'description'              => 'Read this ' . $noun . '\'s own head/body code. Site-wide code is not here - it belongs to the site, so uichemy-composer/platform owns it (get-site-code).',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array( 'post_id' => $post_id ),
						'required'   => array( 'post_id' ),
					),
				),
				array(
					'name'                     => 'set-page-code',
					'description'              => 'REPLACE this ' . $noun . '\'s own head/body code. Only the scopes you pass are touched; pass an empty string to clear one. For code that must appear on every page use uichemy-composer/platform set-site-code.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'          => $post_id,
							'page_before_head' => $page_head,
							'page_before_body' => $page_body,
						),
						'required'   => array( 'post_id' ),
					),
				),
				array(
					'name'                     => 'update-page-code',
					'description'              => 'APPEND to this ' . $noun . '\'s own head/body code, skipping blocks already present. For a font <link> or analytics tag that belongs on every page use uichemy-composer/platform update-site-code instead.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'          => $post_id,
							'page_before_head' => $page_head,
							'page_before_body' => $page_body,
						),
						'required'   => array( 'post_id' ),
					),
				),
			);

			// The theme-builder verbs are null off-template, and create-with-sections
			// is null on it; drop the holes rather than shipping null rows.
			return array_values( array_filter( $actions ) );
		}

		/**
		 * Per-action schemas for uichemy-composer/describe-site.
		 *
		 * @return array<int,array>
		 */
		private static function describe_site_actions() {
			return array(
				array(
					'name'                     => 'schema',
					'description'              => 'The whole site in one payload: build readiness (Elementor / Nexter, header_footer_system, active kit, atomic mode, active header and footer, branding) plus the content model - public post types, taxonomies, the ACF and registered-meta field map with each field\'s metaKey, nav menus with their locations, and WooCommerce presence.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => new stdClass(),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'entities',
					'description'              => 'Resolve concrete records to real IDs. Use it for the exact id of a post, term or user before you reference one in a loop, a template condition, or a menu.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'kind'      => array( 'type' => 'string', 'enum' => array( 'posts', 'terms', 'users' ), 'description' => 'Which record type to resolve. Default "posts".' ),
							'search'    => array( 'type' => 'string', 'description' => 'Filter records by a search string.' ),
							'post_type' => array( 'type' => 'string', 'description' => 'With kind="posts": which post type to search (default "post").' ),
							'taxonomy'  => array( 'type' => 'string', 'description' => 'With kind="terms": which taxonomy (default "category").' ),
							'include'   => array( 'type' => 'string', 'description' => 'CSV of ids or slugs to resolve back to their labels.' ),
							'limit'     => array( 'type' => 'integer', 'description' => 'Soft cap on results.' ),
						),
						'required'   => array(),
					),
				),
			);
		}

		/**
		 * Per-action schemas for uichemy-composer/theme-builder.
		 *
		 * Lifted from the ability-share package, so the contract is already the one
		 * the native engine expects when it lands. `placement` is deliberately typed
		 * as a free-form object: what it means depends on `type`, and a single flat
		 * schema cannot say "post_type here, archive there, omit entirely for these" —
		 * the description does that instead.
		 *
		 * @return array<int,array>
		 */
		private static function theme_builder_actions() {
			$post_id = array( 'type' => 'integer', 'description' => 'Template post ID from action="list".' );

			return array(
				array(
					'name'                     => 'architecture',
					'description'              => 'The site\'s template MAP: every slot the WordPress hierarchy has here (header, footer, each public post type, each taxonomy archive, author, date, search, 404, and the WooCommerce ones when Woo is active), which of them a UiChemy template already fills, and which still fall through to the active theme. Returns a "gaps" list naming the exact create call that fills each one, and marks any slot whose type this build cannot create. Start here when asked what a site is missing - action="list" only reports templates that already exist, so it cannot answer that.',
					'action_parameters_schema' => array( 'type' => 'object', 'properties' => new stdClass(), 'required' => array() ),
				),
				array(
					'name'                     => 'create',
					'description'              => 'Create a NATIVE UiChemy theme-builder template from HTML/CSS/JS. Works on ANY Elementor including free - no Pro and no Nexter. Templates are ACTIVE by default, and activating one deactivates any other active UiChemy template in the same slot.',
					'action_parameters_schema' => array(
						'type'        => 'object',
						'description' => 'Choose "type" strictly by the user\'s wording: "header" → header; "footer" → footer; "single post / blog post / article template" → single; "archive / blog listing / category / tag / author / date" → archive; "product page / single product" → single_product (WooCommerce); "shop / product listing" → product_archive (WooCommerce); "search results" → search; "404 / not found" → error_404. PLACEMENT is type-aware: header/footer → { scope: "entire" (default) | "specific", include: [ids], exclude: [ids] }; single → { post_type: "post" (default) | "page" | "{cpt}" | "all" | "front", include: [ids], exclude: [ids] }; archive → { archive: "blog" (default) | "author" | "date" | "tax:{taxonomy}" | "all" }; single_product / product_archive / search / error_404 → OMIT placement, they apply to their whole context automatically. A single/archive body should use dynamic bindings (uichemy-composer/dynamic) rather than hardcoded content.',
						'properties'  => array(
							'type'      => array(
								'type'        => 'string',
								'enum'        => array( 'header', 'footer', 'single', 'archive', 'single_product', 'product_archive', 'search', 'error_404' ),
								'description' => 'Which template slot to build.',
							),
							'title'     => array( 'type' => 'string', 'description' => 'Template title.' ),
							'label'     => array( 'type' => 'string', 'description' => 'Section label shown in the Elementor navigator.' ),
							'html'      => array( 'type' => 'string', 'description' => 'Template body HTML. For single/archive types, bind live data instead of hardcoding it.' ),
							'css'       => array( 'type' => 'string', 'description' => 'Responsive CSS. Must include real tablet and mobile rules.' ),
							'js'        => array( 'type' => 'string', 'description' => 'Optional JavaScript.' ),
							'status'    => array( 'type' => 'string', 'enum' => array( 'active', 'inactive' ), 'description' => 'Defaults to active. Pass "inactive" for a draft that renders nowhere.' ),
							'placement' => array( 'type' => 'object', 'description' => 'Where the template renders - shape depends on "type", see the description above.' ),
						),
						'required'    => array( 'type' ),
					),
				),
				array(
					'name'                     => 'list',
					'description'              => 'List the native UiChemy templates with their type, status, target and conditions, so you can see which slot is filled and which are live.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'type' => array( 'type' => 'string', 'description' => 'Filter to one template type. Omit for all of them.' ),
						),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'set-conditions',
					'description'              => 'Change where an existing template renders, without rebuilding it. Same type-aware placement rules as create.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'   => $post_id,
							'placement' => array( 'type' => 'object', 'description' => 'New placement - shape depends on the template\'s type, see action="create".' ),
						),
						'required'   => array( 'post_id' ),
					),
				),
				array(
					'name'                     => 'toggle',
					'description'              => 'Activate or deactivate a template. Activating one deactivates any other active template in the same slot.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id' => $post_id,
							'status'  => array( 'type' => 'string', 'enum' => array( 'active', 'inactive' ), 'description' => 'Target status.' ),
						),
						'required'   => array( 'post_id' ),
					),
				),
				array(
					'name'                     => 'delete',
					'description'              => 'Delete a native template. DESTRUCTIVE and TWO-STEP: the first call returns requires_confirmation plus a confirm_token; call again with that exact token to remove it.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id'       => $post_id,
							'confirm_token' => array( 'type' => 'string', 'description' => 'Echo back the exact token from the first call.' ),
						),
						'required'   => array( 'post_id' ),
					),
				),
			);
		}

		/**
		 * Per-action schemas for uichemy-composer/platform.
		 *
		 * @return array<int,array>
		 */
		private static function platform_actions() {
			$site_fields = array(
				'title'         => array( 'type' => 'string', 'description' => 'Site title.' ),
				'tagline'       => array( 'type' => 'string', 'description' => 'Site tagline / description.' ),
				'logo_url'      => array( 'type' => 'string', 'description' => 'Logo image URL - sideloaded into the media library. Must be fetchable over HTTPS or already a library URL; use uichemy-composer/media to upload a local file first.' ),
				'logo_width'    => array( 'type' => 'integer', 'description' => 'Optional intrinsic logo width.' ),
				'logo_height'   => array( 'type' => 'integer', 'description' => 'Optional intrinsic logo height.' ),
				'icon_url'      => array( 'type' => 'string', 'description' => 'Site icon (favicon) image URL, sideloaded the same way. Square, at least 512px.' ),
				'front_page_id' => array( 'type' => 'integer', 'description' => 'Post ID to use as the static front page. Also flips the reading setting to "page".' ),
				'posts_page_id' => array( 'type' => 'integer', 'description' => 'Post ID to use as the blog posts page.' ),
			);
			$menu_id   = array( 'type' => 'integer', 'description' => 'Nav menu ID from action="get-menu".' );
			$site_head = array( 'type' => 'string', 'description' => 'Code injected into <head> on EVERY page of the site - e.g. a Google Fonts <link>, an analytics snippet, a <style> block.' );
			$site_body = array( 'type' => 'string', 'description' => 'Code injected just before </body> on EVERY page of the site. Bare JavaScript is wrapped in <script> for you; markup is stored exactly as written.' );

			return array(
				array(
					'name'                     => 'get-site-settings',
					'description'              => 'Read site settings: title, tagline, url, language, timezone, front-page wiring, and the current logo and site icon with their URLs.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => new stdClass(),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'update-site-settings',
					'description'              => 'Write site settings but only where nothing is set yet - the safe default. An invented logo will not overwrite the one the site owner chose; the response reports what was skipped and why.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => $site_fields,
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'set-site-settings',
					'description'              => 'Write site settings, REPLACING whatever is already there. Use only when the user asked for the change explicitly - otherwise prefer update-site-settings.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => $site_fields,
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'get-site-code',
					'description'              => 'Read the site-wide head and body code - what is injected into EVERY page. Do this before set-site-code so you send back a merged value.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => new stdClass(),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'update-site-code',
					'description'              => 'APPEND to the site-wide head/body code, skipping blocks already present. Duplicate <link href> URLs are dropped, so adding the same font link twice cannot stack it up. This is the one to use for a font or analytics tag.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'site_before_head' => $site_head,
							'site_before_body' => $site_body,
						),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'set-site-code',
					'description'              => 'REPLACE the site-wide head/body code. Only the scopes you pass are touched; pass an empty string to clear one. Prefer update-site-code unless you are deliberately rewriting what is there.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'site_before_head' => $site_head,
							'site_before_body' => $site_body,
						),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'get-menu',
					'description'              => 'Read every nav menu with its items and which theme locations it is assigned to, plus the locations this theme registers. This is what a <uichemy-nav-menu> placeholder will actually render.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'menu_id' => array( 'type' => 'integer', 'description' => 'Read just this menu. Omit for all of them.' ),
						),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'update-menu',
					'description'              => 'Create or amend a nav menu. Called with no parameters it builds a Main Menu from the published pages and assigns it to every theme location - what a generated header needs before <uichemy-nav-menu> renders anything. With parameters it is targeted: rename, add items, assign locations.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'menu_id'       => array( 'type' => 'integer', 'description' => 'Menu to amend. Omit to use the existing menu, or create one if there is none.' ),
							'name'          => array( 'type' => 'string', 'description' => 'Rename the menu (or name a newly created one).' ),
							'add_pages'     => array(
								'type'        => 'array',
								'description' => 'Post IDs to add as menu items, in order.',
								'items'       => array( 'type' => 'integer' ),
							),
							'add_links'     => array(
								'type'        => 'array',
								'description' => 'Custom links to add.',
								'items'       => array(
									'type'       => 'object',
									'properties' => array(
										'url'   => array( 'type' => 'string', 'description' => 'Link URL.' ),
										'title' => array( 'type' => 'string', 'description' => 'Link label. Defaults to the URL.' ),
									),
									'required'   => array( 'url' ),
								),
							),
							'locations'     => array(
								'type'        => 'array',
								'description' => 'Theme location slugs to assign this menu to. Must be locations the theme registers - get-menu lists them.',
								'items'       => array( 'type' => 'string' ),
							),
							'replace_items' => array( 'type' => 'boolean', 'description' => 'Delete the menu\'s existing items before adding. DESTRUCTIVE to the old items; default false (append).' ),
						),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'delete-menu',
					'description'              => 'Delete a nav menu. DESTRUCTIVE and TWO-STEP: the first call returns requires_confirmation plus a confirm_token; call again with that exact token to delete. It also unassigns the menu from every location, which empties the nav in any live header.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'menu_id'       => $menu_id,
							'confirm_token' => array( 'type' => 'string', 'description' => 'Echo back the exact token from the first call. It is bound to the menu and its item count, so it stops working if the menu changes in between.' ),
						),
						'required'   => array( 'menu_id' ),
					),
				),
			);
		}

		/**
		 * Per-action schemas for uichemy-composer/media.
		 *
		 * @return array<int,array>
		 */
		private static function media_actions() {
			$mime = array( 'type' => 'string', 'description' => 'Filter by MIME type or prefix - "image", "video", "image/svg+xml". Omit for images and video together.' );

			return array(
				array(
					'name'                     => 'find',
					'description'              => 'Search the library by text before uploading anything - an asset already in there should be reused, not uploaded twice. Matches title, caption, description, filename AND alt text.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'query'    => array( 'type' => 'string', 'description' => 'What to look for, e.g. "logo", "hero", "team-photo".' ),
							'mime'     => $mime,
							'per_page' => array( 'type' => 'integer', 'description' => 'Max results, 1-100 (default 20).' ),
						),
						'required'   => array( 'query' ),
					),
				),
				array(
					'name'                     => 'request-upload',
					'description'              => 'Get ONE upload slot and push every local file for this build through it (images, SVG, video, web fonts). Required whenever your HTML references media that is not already fetchable over HTTPS.',
					'action_parameters_schema' => array(
						'type'        => 'object',
						'description' => 'Call this ONCE per build, not once per file. The response returns { slot_url, request_header, usage_example, batch_usage_example, expiry, limits }. Run batch_usage_example with your bash tool: it loops over every file in a single command, which is what keeps a 40-image build to two round trips. Method is PUT with the raw bytes as the body. Pass filename and alt as URL-encoded query params on each upload; alt is written during the upload, so no follow-up call is needed to set it. Each upload responds with { url, attachment_id }: put that url in your <img src> (images, SVG), <video src> (video) or CSS @font-face (fonts). File type is detected from the bytes, so never declare it. The page, post, template and site-branding writers sideload from <img src> and <video src> only: they cannot read data: URIs, blob: URIs, local paths, or any URL they cannot already fetch over HTTPS. SVG requires the unfiltered_html capability. For video prefer mp4, webm or ogg, which play natively everywhere; mov uploads fine but only plays reliably in Safari. Size ceiling is 25 MB per file and 100 MB for video.',
						'properties'  => array(
							'ttl_minutes' => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 30, 'description' => 'How long the slot keeps accepting files. Clamped to 1-30. Defaults to 15, which comfortably covers a full page build.' ),
						),
						'required'    => array(),
					),
				),
				array(
					'name'                     => 'get',
					'description'              => 'Read one attachment in full - url, mime, dimensions, filesize, alt, caption, and every registered image size with its own url and dimensions. Target by id, or by a URL already in the library.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'id'  => array( 'type' => 'integer', 'description' => 'Attachment ID.' ),
							'url' => array( 'type' => 'string', 'description' => 'A media-library URL to resolve back to its attachment. Alternative to id.' ),
						),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'update',
					'description'              => 'Set an attachment\'s alt text, title, caption or description. Only the fields you pass are written. Sideloaded images start with no alt text, and every <img> you write should have some.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'id'          => array( 'type' => 'integer', 'description' => 'Attachment ID.' ),
							'alt'         => array( 'type' => 'string', 'description' => 'Alt text - what the image conveys, not "image of a photo".' ),
							'title'       => array( 'type' => 'string', 'description' => 'Media library title.' ),
							'caption'     => array( 'type' => 'string', 'description' => 'Caption.' ),
							'description' => array( 'type' => 'string', 'description' => 'Longer description.' ),
						),
						'required'   => array( 'id' ),
					),
				),
				array(
					'name'                     => 'list',
					'description'              => 'Page through the library newest first. Use find when you know what you are looking for; use list to see what is there.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'mime'     => $mime,
							'per_page' => array( 'type' => 'integer', 'description' => 'How many per page, 1-100 (default 20).' ),
							'page'     => array( 'type' => 'integer', 'description' => '1-based page number (default 1).' ),
						),
						'required'   => array(),
					),
				),
			);
		}

		/**
		 * The three ways of writing the #uichemy-globals block, for uichemy-composer/design-system.
		 *
		 * Deliberately only three. UiChemy's design system IS that one CSS file — the
		 * tokens are its custom properties and the reusable styles are its .text-* /
		 * .pr-* classes — so read, replace and patch is the whole surface. Anything
		 * else here would be a second way to write the same bytes.
		 *
		 * @return array<int,array>
		 */
		private static function design_system_actions() {
			return array(
				array(
					'name'                     => 'get',
					'description'              => 'Read the whole design-system CSS. Do this before set or patch so you edit the existing file instead of overwriting it, and so each patch "find" matches exactly.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => new stdClass(),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'set',
					'description'              => 'Replace the whole block with a COMPLETE CSS file. For laying the design system down the first time - to change part of an existing one use patch.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'css' => array(
								'type'        => 'string',
								'description' => 'The complete CSS for the #uichemy-globals block. Plain CSS, no @layer and no @-metadata. Custom properties go in :root {}, one per line (--brand: #FF9900;), GROUPED under a plain section comment naming their collection - /* Colors */, /* Spacing */, /* Radius */, /* Shadows */, /* Fonts */, or any name you like. That comment is the ONLY classifier: every variable up to the next one belongs to that collection, so never rely on names or value types instead. Name a variable once and never rename it - that breaks every var() referencing it. Reusable text styles go in .text-* classes and components in .pr-* classes after :root.',
							),
						),
						'required'   => array( 'css' ),
					),
				),
				array(
					'name'                     => 'patch',
					'description'              => 'Change part of the block with literal find/replace edits, without resending the whole file. Each edit reports its own match count, so a find that matched nothing is visible rather than silently dropped.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'edits' => array(
								'type'        => 'array',
								'description' => 'Applied in order. Every exact, case-sensitive occurrence of find is replaced, so include enough surrounding text to make find unique. Change a value: find "--brand: #FF9900;", replace "--brand: #4B22CC;". ADD one by anchoring on a line you keep: find ":root {", replace ":root {\n  --accent: #00AAFF;". Delete by replacing with "".',
								'items'       => array(
									'type'       => 'object',
									'properties' => array(
										'find'    => array( 'type' => 'string', 'description' => 'Exact text to find - copy it from action="get".' ),
										'replace' => array( 'type' => 'string', 'description' => 'What to put in its place. Empty string deletes.' ),
									),
									'required'   => array( 'find', 'replace' ),
								),
							),
						),
						'required'   => array( 'edits' ),
					),
				),
			);
		}

		/**
		 * Per-action schemas for uichemy-composer/dynamic, forms, seo and audit.
		 *
		 * Grouped in one table because each is small and they share nothing with the
		 * bigger catalogues; keeping four two-line builders apart would be noise.
		 *
		 * @param string $group dynamic | forms | seo | audit.
		 * @return array<int,array>
		 */
		private static function small_actions( $group ) {
			$post_id = array( 'type' => 'integer', 'description' => 'Post ID.' );
			$empty   = array( 'type' => 'object', 'properties' => new stdClass(), 'required' => array() );

			if ( 'dynamic' === $group ) {
				return array(
					array(
						'name'                     => 'list-fields',
						'description'              => 'The dynamic tokens this site can actually resolve, per provider (post, product, user, term, image, site, request) plus the custom ACF / registered-meta fields. Call this BEFORE writing any binding: a token that does not exist renders EMPTY rather than failing, so a guessed field name produces a page that looks built and is silently blank.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'provider' => array( 'type' => 'string', 'enum' => array( 'post', 'product', 'user', 'term', 'image', 'site', 'request' ), 'description' => 'Limit to one provider. Omit for all of them.' ),
							),
							'required'   => array(),
						),
					),
					array(
						'name'                     => 'create-loop',
						'description'              => 'Build a data-bound Twig listing over real content. You supply the markup for ONE item; this wraps it in the {% for %} and the query. The post type and taxonomy are validated against what is registered, so a loop cannot be built over something that does not exist.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'source'    => array( 'type' => 'string', 'enum' => array( 'posts', 'products', 'terms', 'users' ), 'description' => 'What to iterate. "products" needs WooCommerce.' ),
								'item_html' => array( 'type' => 'string', 'description' => 'Markup for ONE item, using the loop variable - {{ post.title }}, {{ term.name }}, {{ product.price }}. Get the real token names from action="list-fields"; custom fields need meta(): {{ post.meta(\'key\') }}.' ),
								'post_type' => array( 'type' => 'string', 'description' => 'With source="posts": which type (default "post"). Get real names from uichemy-composer/describe-site.' ),
								'taxonomy'  => array( 'type' => 'string', 'description' => 'Filter by this taxonomy (with "term"), or the taxonomy to list when source="terms".' ),
								'term'      => array( 'type' => 'string', 'description' => 'Term SLUG to filter by. Resolve it with uichemy-composer/describe-site (action="entities", kind="terms").' ),
								'limit'     => array( 'type' => 'integer', 'description' => 'How many items, 1-100 (default 6).' ),
								'orderby'   => array( 'type' => 'string', 'description' => 'WP_Query orderby (default "date").' ),
								'order'     => array( 'type' => 'string', 'enum' => array( 'asc', 'desc' ), 'description' => 'Sort direction (default desc).' ),
								'query'     => array(
									'type'        => 'object',
									'description' => 'Everything beyond the basics, validated the same way the composer\'s own Loop panel validates it. Keys: post_type, count, orderby, order, taxonomy, terms (slug or list), post_status, offset, include (ids), exclude (ids), exclude_current (bool - drops the post being viewed), author (ids), date_mode ("day"|"week"|"month"|"year"|"custom"), date_after / date_before (YYYY-MM-DD), meta_key, meta_compare, meta_value, avoid_duplicates, pagination. For terms: taxonomy, hide_empty, parent. Anything set here overrides the flat parameters above.',
								),
								'raw_query' => array(
									'type'        => 'string',
									'description' => 'ESCAPE HATCH, unvalidated: the whole argument object as Twig, braces included { post_type: [ \'post\', \'page\' ], posts_per_page: 6, tax_query: [ { relation: \'OR\' }, { … }, { … } ] }. Use it only for a query "query" cannot express: several post types at once, OR between taxonomies, more than one meta clause. When present it is used verbatim and every other parameter here is ignored.',
								),
							),
							'required'   => array( 'source', 'item_html' ),
						),
					),
					array(
						'name'                     => 'bind-field',
						'description'              => 'Get the EXACT Twig token for one field, so you never guess accessor-vs-meta. A guessed binding renders empty instead of failing, which is why this exists. The response also lists that provider\'s native accessors.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'provider' => array( 'type' => 'string', 'enum' => array( 'post', 'product', 'term', 'user', 'author', 'site' ), 'description' => 'What the field belongs to.' ),
								'field'    => array( 'type' => 'string', 'description' => 'Field name or metaKey. Anything not a native accessor is treated as a meta key - confirm it against uichemy-composer/describe-site.' ),
								'size'     => array( 'type' => 'string', 'description' => 'For an image field, the registered size to output, e.g. "large". Adds .src(...) to the token.' ),
							),
							'required'   => array( 'provider', 'field' ),
						),
					),
					array(
						'name'                     => 'add-tag',
						'description'              => 'Get a UiChemy placeholder element. These resolve server-side at render time, so they are the only correct way to output a nav menu, the post body, the site logo or icon, a table of contents, or WooCommerce\'s cart / checkout / account area - hand-written markup would freeze whatever was true when the section was generated.',
						'action_parameters_schema' => array(
							'type'        => 'object',
							'description' => 'The woo-* tags are how a store\'s FUNCTIONAL pages get styled. UiChemy deliberately refuses to put a theme-builder template over cart, checkout or my-account, because replacing those pages breaks the purchase flow - so build the page around the tag instead: your header, your layout, your CSS, with WooCommerce\'s own cart or checkout form inside it. Put each on the page WooCommerce has assigned for it (uichemy-composer/store, action="describe-store" reports the assignments), and include woo-notices in any custom cart or checkout layout or the customer never sees an error. They are only offered when WooCommerce is active.',
							'properties'  => array(
								'tag' => array(
									'type'        => 'string',
									'enum'        => array( 'post-content', 'nav-menu', 'site-logo', 'site-icon', 'toc', 'woo-cart', 'woo-checkout', 'woo-my-account', 'woo-order-tracking', 'woo-notices' ),
									'description' => 'Which placeholder to emit. woo-checkout also renders the thank-you view on the order-received endpoint, so it covers both.',
								),
							),
							'required'    => array( 'tag' ),
						),
					),
				);
			}

			if ( 'forms' === $group ) {
				return array(
					array(
						'name'                     => 'configure',
						'description'              => 'Set where a form delivers. Without a recipient a form still stores submissions but emails nobody - the usual reason a built contact form looks broken. Call with just post_id and form_key to read the current config.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'post_id'         => array( 'type' => 'integer', 'description' => 'The page holding the form.' ),
								'form_key'        => array( 'type' => 'string', 'description' => 'The data-atom-form value in your form markup. A page can carry several forms, one config each.' ),
								'email_to'        => array( 'type' => 'string', 'description' => 'Where submissions are emailed.' ),
								'subject'         => array( 'type' => 'string', 'description' => 'Notification subject line.' ),
								'success_message' => array( 'type' => 'string', 'description' => 'Shown to the visitor after a successful submit.' ),
								'store'           => array( 'type' => 'boolean', 'description' => 'Keep submissions in the database as well as emailing them.' ),
							),
							'required'   => array( 'post_id', 'form_key' ),
						),
					),
					array(
						'name'                     => 'list-submissions',
						'description'              => 'With no form_key: every form that has received something, with totals and unread counts. With a form_key: that form\'s submissions, newest first.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'form_key' => array( 'type' => 'string', 'description' => 'Omit to list the forms themselves.' ),
								'limit'    => array( 'type' => 'integer', 'description' => 'How many, 1-200 (default 50).' ),
								'offset'   => array( 'type' => 'integer', 'description' => 'Skip this many for paging.' ),
								'status'   => array( 'type' => 'string', 'enum' => array( 'all', 'read', 'unread' ), 'description' => 'Filter by read state (default all).' ),
							),
							'required'   => array(),
						),
					),
					array(
						'name'                     => 'get-submission',
						'description'              => 'One submission with its field values. Reading does NOT mark it read - that stays a human action in the dashboard.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array( 'id' => array( 'type' => 'integer', 'description' => 'Submission ID from list-submissions.' ) ),
							'required'   => array( 'id' ),
						),
					),
				);
			}

			if ( 'seo' === $group ) {
				return array(
					array(
						'name'                     => 'get',
						'description'              => 'Read a post\'s SEO metadata and report which plugin owns SEO output on this site, plus the WordPress fallbacks and the sitemap URL.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array( 'post_id' => $post_id ),
							'required'   => array( 'post_id' ),
						),
					),
					array(
						'name'                     => 'set',
						'description'              => 'Write title, description or canonical into the detected SEO plugin\'s own meta keys. With no SEO plugin active it falls back to emitting the description and canonical as real tags in the page\'s own before-</head> code, which renders either way; the title is reported back as unwritten, because the theme already prints one.',
						'action_parameters_schema' => array(
							'type'       => 'object',
							'properties' => array(
								'post_id'     => $post_id,
								'title'       => array( 'type' => 'string', 'description' => 'SEO title (the <title> tag), not the post title.' ),
								'description' => array( 'type' => 'string', 'description' => 'Meta description, roughly 150-160 characters.' ),
								'canonical'   => array( 'type' => 'string', 'description' => 'Canonical URL, if it differs from the permalink.' ),
							),
							'required'   => array( 'post_id' ),
						),
					),
				);
			}

			// audit
			return array(
				array(
					'name'                     => 'run',
					'description'              => 'Run every readiness check and return the findings, each with a severity and the ability that fixes it. Do this before telling the user a build is finished.',
					'action_parameters_schema' => array(
						'type'       => 'object',
						'properties' => array(
							'post_id' => array( 'type' => 'integer', 'description' => 'Also run the page-level checks against this post.' ),
						),
						'required'   => array(),
					),
				),
				array(
					'name'                     => 'list-checks',
					'description'              => 'What the audit looks at, without running it.',
					'action_parameters_schema' => $empty,
				),
			);
		}

		/**
		 * The four small action-routed abilities, beside the bigger ones.
		 *
		 * @return array<string,array>
		 */
		private static function small_domains() {
			$preamble = 'Pick "action", then pass that action\'s own parameters as "action_parameters" - meta.actions carries the exact schema for each one.';

			return array(
				'dynamic' => array(
					'slug'               => 'uichemy-composer/dynamic',
					'label'              => 'UiChemy Builder: Dynamic',
					'description'        => 'Bind LIVE WordPress content into a section instead of hardcoding it: list the tokens this site can resolve, build a data-bound listing, get the exact Twig token for one field, or emit a UiChemy placeholder tag.',
					'schema_description' => $preamble . ' "list-fields" is the catalog of every token this build resolves - post, product (WooCommerce), user, term, image, site, request - plus the site\'s own ACF / meta fields. Read it BEFORE writing a binding: an unknown token renders EMPTY rather than failing, so a guessed name yields a page that looks built and is blank. "create-loop" wraps your per-item markup in a validated {% for %} over posts, products, terms or users; its "query" object carries the full filter set (status, offset, include/exclude, author, date range, one meta clause) and "raw_query" is the unvalidated escape hatch for what that cannot express - several post types, OR between taxonomies, several meta clauses. "bind-field" returns the EXACT token for one field on one provider. "add-tag" emits a placeholder (post-content, nav-menu, site-logo, site-icon, toc) that resolves server-side at render time. Everything except list-fields returns MARKUP and writes nothing: pass the html to uichemy-composer/page, post or template. Call uichemy-composer/describe-site FIRST so every taxonomy and term you reference is real.',
					'handler'            => 'execute_dynamic',
					'readonly'           => true,
				),
				'forms'   => array(
					'slug'               => 'uichemy-composer/forms',
					'label'              => 'UiChemy Builder: Forms',
					'description'        => 'Form delivery and submissions: set where a form emails, list what has come in, and read one submission.',
					'schema_description' => $preamble . ' Build the <form data-atom-form="key"> markup with uichemy-composer/page first, then "configure" that same key with a recipient - a form with no recipient stores submissions but emails nobody, which is the usual reason a built contact form looks broken. "list-submissions" with no form_key lists the forms themselves; "get-submission" reads one in full and does not mark it read.',
					'handler'            => 'execute_forms',
					'readonly'           => false,
				),
				'seo'     => array(
					'slug'               => 'uichemy-composer/seo',
					'label'              => 'UiChemy Builder: SEO',
					'description'        => 'Per-post SEO metadata - title, description and canonical - written through whichever SEO plugin owns output on this site.',
					'schema_description' => $preamble . ' BASIC for now: this build has no head emitter of its own, so "get" reports which plugin owns SEO (Yoast, Rank Math or none) alongside the WordPress fallbacks, and "set" writes into that plugin\'s own meta keys. With no SEO plugin active, "set" writes the description and canonical into the page\'s own before-</head> code (real tags, they render) and reports the title back as not written, since the theme already emits one. JSON-LD schema and head previews are not implemented yet. No keyword scoring, and no sitemap generation - WordPress already serves /wp-sitemap.xml.',
					'handler'            => 'execute_seo',
					'readonly'           => false,
				),
				'audit'   => array(
					'slug'               => 'uichemy-composer/audit',
					'label'              => 'UiChemy Builder: Audit',
					'description'        => 'Read-only site-readiness findings, each naming the ability that fixes it. Run this before calling a build finished.',
					'schema_description' => $preamble . ' "run" checks the things a build commonly leaves broken: Elementor missing, an empty design system, no site logo or tagline, no nav menu or an unassigned theme location, theme-builder templates with no display conditions (they render nowhere), forms with no recipient, and images with no alt text. Pass post_id to also check one page for missing sections. Each finding carries a severity (blocker | warning | notice) and the ability that fixes it. "list-checks" shows what it looks at without running it. Reads only - nothing is changed.',
					'handler'            => 'execute_audit',
					'readonly'           => true,
				),
			);
		}

		/**
		 * Wire the category + ability registration onto the Abilities API.
		 */
		public static function init() {
			if ( ! function_exists( 'wp_register_ability' ) ) {
				// Abilities API not present (pre-WP 7.0) — nothing to do.
				return;
			}

			add_action( 'wp_abilities_api_categories_init', array( __CLASS__, 'register_category' ), 5 );
			add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_abilities' ), 5 );
		}

		/**
		 * Register the `uichemy` ability category.
		 */
		public static function register_category() {
			if ( ! function_exists( 'wp_register_ability_category' ) ) {
				return;
			}

			if ( function_exists( 'wp_has_ability_category' ) && wp_has_ability_category( self::CATEGORY ) ) {
				return;
			}

			wp_register_ability_category(
				self::CATEGORY,
				array(
					'label'       => __( 'UiChemy', 'uichemy' ),
					'description' => __( 'UiChemy pipeline: Figma-to-HTML conversion, Elementor globals, and full WordPress site building.', 'uichemy' ),
				)
			);
		}

		/**
		 * Register every Composer ability.
		 */
		public static function register_abilities() {
			if ( ! class_exists( 'UiChemy_Composer_MCP_Server' )
				|| ! method_exists( 'UiChemy_Composer_MCP_Server', 'get_tool_definitions' ) ) {
				return;
			}

			$name_map       = self::name_map();
			$readonly_tools = self::readonly_tools();
			$overrides      = self::overrides();

			foreach ( UiChemy_Composer_MCP_Server::get_tool_definitions() as $def ) {
				$tool_name = isset( $def['name'] ) ? (string) $def['name'] : '';

				// Only register tools we have an explicit uichemy name for.
				if ( '' === $tool_name || ! isset( $name_map[ $tool_name ] ) ) {
					continue;
				}

				$ability_name = $name_map[ $tool_name ];

				// Don't double-register (idempotent across reloads).
				if ( function_exists( 'wp_has_ability' ) && wp_has_ability( $ability_name ) ) {
					continue;
				}

				$description = isset( $def['description'] ) ? (string) $def['description'] : '';
				$description = self::rebrand( $description, $name_map );

				$input_schema = isset( $def['inputSchema'] ) && is_array( $def['inputSchema'] )
					? $def['inputSchema']
					: array( 'type' => 'object' );

				if ( isset( $overrides[ $ability_name ]['description'] ) ) {
					$description = $overrides[ $ability_name ]['description'];
				}
				if ( isset( $overrides[ $ability_name ]['schema_description'] ) ) {
					$input_schema['description'] = $overrides[ $ability_name ]['schema_description'];
				}

				$is_readonly = in_array( $tool_name, $readonly_tools, true );

				wp_register_ability(
					$ability_name,
					array(
						'label'               => self::label_for( $ability_name ),
						'description'         => $description,
						'category'            => self::CATEGORY,
						'input_schema'        => $input_schema,
						'execute_callback'    => $def['handler'],
						'permission_callback' => array( __CLASS__, 'permission_check' ),
						'meta'                => array(
							'show_in_rest' => true,
							'mcp'          => array( 'public' => true ),
							'annotations'  => array(
								'title'       => self::label_for( $ability_name ),
								'readonly'    => $is_readonly,
								'destructive' => false,
								'idempotent'  => $is_readonly,
							),
						),
					)
				);
			}

			// describe-site — read-only introspection of what this site can do and
			// what content it holds. Action-routed like the rest, so discovery lists
			// its two actions rather than showing it as one opaque call; the
			// introspection itself stays in Uich_Dynamic beside the engine whose
			// field map it reports.
			if ( class_exists( 'Uich_Dynamic' )
				&& method_exists( 'Uich_Dynamic', 'describe_site' )
				&& method_exists( 'UiChemy_MCP_V2_Router', 'execute_describe_site' ) ) {
				self::register_standalone_ability(
					'uichemy-composer/describe-site',
					'UiChemy Builder: Describe Site',
					'Call first on any build: what this site can do (Elementor/Nexter, header_footer_system, kit, logo) and what content it has (post types, taxonomies, real field metaKeys, menus, Woo). Required before any data binding.',
					array(
						'type'        => 'object',
						'description' => 'Pick "action", then pass that action\'s own parameters as "action_parameters" - meta.actions carries the exact schema for each one. "schema" (the default) returns the whole site: "platform" is build readiness - Elementor / Elementor Pro / Nexter detection, active kit, header_footer_system ("elementor_pro" | "nexter" | "elementor" - route header/footer work by this), atomic_enabled, active_header / active_footer, branding; STOP the build if platform.checks.elementor_active is false. The rest is the content model: public post types, taxonomies, the ACF / registered-meta FIELD MAP (name, type and metaKey, grouped by post/product/user/term), registered meta keys, nav menus + locations, and WooCommerce presence + product count. Bind fields by the metaKey it returns, never by a guessed name. "entities" resolves concrete records to real IDs. Read-only either way.',
						'properties'  => array(
							'action'            => array(
								'type'        => 'string',
								'enum'        => array( 'schema', 'entities' ),
								'description' => 'Which operation to run. Defaults to "schema".',
							),
							'action_parameters' => array(
								'type'        => 'object',
								'description' => 'The parameters for this action - check the "actions" key in meta for the accurate schema.',
							),
						),
						'required'    => array(),
					),
					array( 'UiChemy_MCP_V2_Router', 'execute_describe_site' ),
					array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ),
					array( 'actions' => self::describe_site_actions() )
				);
			}

			// page / post / template — the content trio. A Composer section tree is the
			// same object whichever post type carries it, so all three share one
			// action catalogue, one router, and one registrar loop: only list and
			// create differ, because only they have to know what kind of thing they
			// are addressing.
			if ( method_exists( 'UiChemy_MCP_V2_Router', 'execute_page' ) ) {
				foreach ( self::content_domains() as $domain => $spec ) {
					self::register_standalone_ability(
						$spec['slug'],
						$spec['label'],
						$spec['description'],
						array(
							'type'        => 'object',
							'description' => $spec['schema_description'],
							'properties'  => array(
								'action'            => array(
									'type'        => 'string',
									'enum'        => wp_list_pluck( self::content_actions( $domain ), 'name' ),
									'description' => 'Which operation to run.',
								),
								'action_parameters' => array(
									'type'        => 'object',
									'description' => 'The parameters for this action - check the "actions" key in meta for the accurate schema.',
								),
							),
							'required'    => array( 'action' ),
						),
						array( 'UiChemy_MCP_V2_Router', $spec['handler'] ),
						array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
						array( 'actions' => self::content_actions( $domain ) )
					);
				}
			}

			// theme-builder — the NATIVE template engine (UiChemy's own CPT), which is
			// what makes archive / product / search / 404 templates possible on free
			// Elementor. Registered now with the contract the engine will expect; the
			// router reports cleanly until UiChemy_Template_Store lands. Separate from
			// uichemy-composer/template, which drives Pro/Nexter.
			if ( method_exists( 'UiChemy_MCP_V2_Router', 'execute_theme_builder' ) ) {
				self::register_standalone_ability(
					'uichemy-composer/theme-builder',
					'UiChemy Builder: Theme Builder',
					'Native UiChemy theme-builder templates - header, footer, single, archive, product, search and 404 - on ANY Elementor including free. No Elementor Pro and no Nexter required.',
					array(
						'type'        => 'object',
						'description' => 'Pick "action", then pass that action\'s own parameters as "action_parameters" - meta.actions carries the exact schema for each one. "architecture" maps every slot the site HAS and which ones still fall through to the theme, with a "gaps" list naming the call that fills each - start there when asked what a site is missing, because "list" only reports templates that already exist. "create" builds a template and places it (placement is type-aware; see the create action\'s schema), "set-conditions" moves an existing one, "toggle" activates or deactivates, "delete" removes it (DESTRUCTIVE, two-step confirm_token). Templates are ACTIVE by default and activating one deactivates any other in the same slot. This is the native engine, stored in UiChemy\'s own CPT; uichemy-composer/template is the separate path that drives Elementor Pro and Nexter, and it only covers header, footer and single.',
						'properties'  => array(
							'action'            => array(
								'type'        => 'string',
								'enum'        => wp_list_pluck( self::theme_builder_actions(), 'name' ),
								'description' => 'Which operation to run.',
							),
							'action_parameters' => array(
								'type'        => 'object',
								'description' => 'The parameters for this action - check the "actions" key in meta for the accurate schema.',
							),
						),
						'required'    => array( 'action' ),
					),
					array( 'UiChemy_MCP_V2_Router', 'execute_theme_builder' ),
					array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
					array( 'actions' => self::theme_builder_actions() )
				);
			}

			// platform — site-level settings, site-wide code and nav menus: the things
			// a build wires up around the pages rather than inside them.
			if ( method_exists( 'UiChemy_MCP_V2_Router', 'execute_platform' ) ) {
				self::register_standalone_ability(
					'uichemy-composer/platform',
					'UiChemy Builder: Platform',
					'Site-level configuration: the site title, tagline, logo, icon and front page; the head and body code injected into every page; and the WordPress nav menus a header renders from.',
					array(
						'type'        => 'object',
						'description' => 'Pick "action", then pass that action\'s own parameters as "action_parameters" - meta.actions carries the exact schema for each one. SETTINGS: "get-site-settings" reads title, tagline, url, language, timezone, front-page wiring and current branding; "update-site-settings" writes only where nothing is set yet (the safe default); "set-site-settings" REPLACES what is there. SITE CODE: "get-site-code" / "update-site-code" (append, deduped) / "set-site-code" (replace) manage the head and body code injected into EVERY page - this is the only place site-wide code is written; the page, post and template abilities handle page-level code only. MENUS: "get-menu" reads every menu with its items and theme locations - what a <uichemy-nav-menu> placeholder will actually render; "update-menu" creates or amends one (with no parameters it builds a Main Menu from the published pages and assigns it everywhere); "delete-menu" removes one (DESTRUCTIVE, two-step confirm_token). Logo and icon URLs are sideloaded, so they must be fetchable over HTTPS - upload a local file through uichemy-composer/media first.',
						'properties'  => array(
							'action'            => array(
								'type'        => 'string',
								'enum'        => wp_list_pluck( self::platform_actions(), 'name' ),
								'description' => 'Which operation to run.',
							),
							'action_parameters' => array(
								'type'        => 'object',
								'description' => 'The parameters for this action - check the "actions" key in meta for the accurate schema.',
							),
						),
						'required'    => array( 'action' ),
					),
					array( 'UiChemy_MCP_V2_Router', 'execute_platform' ),
					array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
					array( 'actions' => self::platform_actions() )
				);
			}

			// media — the media library. request-upload and find answer the same
			// question, and find is the cheaper answer, so they belong side by side.
			if ( method_exists( 'UiChemy_MCP_V2_Router', 'execute_media' ) ) {
				self::register_standalone_ability(
					'uichemy-composer/media',
					'UiChemy Builder: Media',
					'The WordPress media library: search what is already uploaded, read an attachment in full, set alt text and captions, and get an upload slot for a file you have locally.',
					array(
						'type'        => 'object',
						'description' => 'Pick "action", then pass that action\'s own parameters as "action_parameters" - meta.actions carries the exact schema for each one. "find" searches by text (title, caption, description, filename and alt); "list" pages through everything newest first; "get" reads one attachment in full including every image size; "update" sets alt, title, caption or description; "request-upload" issues a one-time slot for a local file and hands back a real public URL. Always "find" before "request-upload": an asset already in the library should be reused rather than uploaded again. Whatever the source, only a real media-library URL belongs in your HTML - never a data: URI, a blob: URI or a local path.',
						'properties'  => array(
							'action'            => array(
								'type'        => 'string',
								'enum'        => wp_list_pluck( self::media_actions(), 'name' ),
								'description' => 'Which operation to run.',
							),
							'action_parameters' => array(
								'type'        => 'object',
								'description' => 'The parameters for this action - check the "actions" key in meta for the accurate schema.',
							),
						),
						'required'    => array( 'action' ),
					),
					array( 'UiChemy_MCP_V2_Router', 'execute_media' ),
					array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
					array( 'actions' => self::media_actions() )
				);
			}

			// design-system — the #uichemy-globals block, which IS UiChemy's design
			// system: get / set / patch are three ways of writing one file, and using
			// any of them correctly means knowing about the other two.
			if ( method_exists( 'UiChemy_MCP_V2_Router', 'execute_design_system' ) ) {
				self::register_standalone_ability(
					'uichemy-composer/design-system',
					'UiChemy Builder: Design System',
					'The site design system - the #uichemy-globals CSS block holding every global token (colors, spacing, type scale) and reusable .text-* / .pr-* class. Read it before writing any section CSS.',
					array(
						'type'        => 'object',
						'description' => 'Pick "action", then pass that action\'s own parameters as "action_parameters" - meta.actions carries the exact schema for each one. "get" reads the block; "set" replaces it with a complete file; "patch" applies literal find/replace edits. Always "get" first: "set" without it overwrites the existing design system, and a "patch" find has to match the current text exactly. Reference these tokens from section CSS as var(--name), and use the matched .text-* class for typography rather than repeating font declarations.',
						'properties'  => array(
							'action'            => array(
								'type'        => 'string',
								'enum'        => wp_list_pluck( self::design_system_actions(), 'name' ),
								'description' => 'Which operation to run.',
							),
							'action_parameters' => array(
								'type'        => 'object',
								'description' => 'The parameters for this action - check the "actions" key in meta for the accurate schema.',
							),
						),
						'required'    => array( 'action' ),
					),
					array( 'UiChemy_MCP_V2_Router', 'execute_design_system' ),
					array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
					array( 'actions' => self::design_system_actions() )
				);
			}

			// dynamic / forms / seo / audit — the four small action-routed abilities.
			foreach ( self::small_domains() as $group => $spec ) {
				if ( ! method_exists( 'UiChemy_MCP_V2_Router', $spec['handler'] ) ) {
					continue;
				}
				self::register_standalone_ability(
					$spec['slug'],
					$spec['label'],
					$spec['description'],
					array(
						'type'        => 'object',
						'description' => $spec['schema_description'],
						'properties'  => array(
							'action'            => array(
								'type'        => 'string',
								'enum'        => wp_list_pluck( self::small_actions( $group ), 'name' ),
								'description' => 'Which operation to run.',
							),
							'action_parameters' => array(
								'type'        => 'object',
								'description' => 'The parameters for this action - check the "actions" key in meta for the accurate schema.',
							),
						),
						'required'    => array( 'action' ),
					),
					array( 'UiChemy_MCP_V2_Router', $spec['handler'] ),
					array( 'readonly' => (bool) $spec['readonly'], 'destructive' => false, 'idempotent' => (bool) $spec['readonly'] ),
					array( 'actions' => self::small_actions( $group ) )
				);
			}

		}

		/**
		 * Register an ability that has no entry in name_map — i.e. one that is not
		 * backed by a v1 Composer tool spec and so cannot ride the register loop.
		 *
		 * @param string   $slug         Ability name, e.g. 'uichemy-composer/describe-site'.
		 * @param string   $label        Human label, reused as the annotation title.
		 * @param string   $description  Model-facing description.
		 * @param array    $input_schema JSON Schema for the ability input.
		 * @param callable $execute      Execute callback.
		 * @param array    $annotations  readonly / destructive / idempotent overrides.
		 * @param array    $extra_meta   Extra meta keys merged into the registration,
		 *                               e.g. `actions` for an action-routed ability.
		 */
		private static function register_standalone_ability( $slug, $label, $description, $input_schema, $execute, $annotations = array(), $extra_meta = array() ) {
			if ( ! function_exists( 'wp_register_ability' ) ) {
				return;
			}
			if ( function_exists( 'wp_has_ability' ) && wp_has_ability( $slug ) ) {
				return;
			}

			$ann = wp_parse_args(
				$annotations,
				array(
					'readonly'    => false,
					'destructive' => false,
					'idempotent'  => false,
				)
			);

			wp_register_ability(
				$slug,
				array(
					'label'               => $label,
					'description'         => $description,
					'category'            => self::CATEGORY,
					'input_schema'        => $input_schema,
					'execute_callback'    => $execute,
					'permission_callback' => array( __CLASS__, 'permission_check' ),
					'meta'                => array_merge(
						array(
							'show_in_rest' => true,
							'mcp'          => array( 'public' => true ),
							'annotations'  => array(
								'title'       => $label,
								'readonly'    => (bool) $ann['readonly'],
								'destructive' => (bool) $ann['destructive'],
								'idempotent'  => (bool) $ann['idempotent'],
							),
						),
						is_array( $extra_meta ) ? $extra_meta : array()
					),
				)
			);
		}

		/**
		 * Admin-only gate for ability execution, honouring the existing Composer
		 * MCP enable toggle so a disabled dashboard state still blocks calls.
		 *
		 * @return bool
		 */
		public static function permission_check() {
			if ( ! current_user_can( 'manage_options' ) ) {
				return false;
			}

			// Honour the existing Composer MCP enable toggle: a disabled dashboard
			// state blocks ability execution just as it blocked the MCP server.
			if ( class_exists( 'UiChemy_Composer_MCP_Server' ) ) {
				$enabled = get_option( UiChemy_Composer_MCP_Server::ENABLED_OPTION, '1' );
				if ( '1' !== $enabled ) {
					return false;
				}
			}

			return true;
		}

		/**
		 * Rewrite legacy tool-name cross-references (and the "composer" brand
		 * word) inside a description to the new uichemy naming.
		 *
		 * strtr() replaces the longest keys first and never re-processes text it
		 * has already substituted, so overlapping names are handled safely.
		 *
		 * @param string               $text     Raw description.
		 * @param array<string,string> $name_map Tool → ability name map.
		 * @return string
		 */
		private static function rebrand( $text, $name_map ) {
			// 1) Swap every legacy tool identifier for its uichemy ability name.
			//    retired_map() rides along so a v1 spec that still names a tool with
			//    no v2 ability points at the ability that absorbed it, rather than
			//    leaving a tool name a v2 caller cannot resolve.
			$text = strtr( $text, array_merge( $name_map, self::retired_map() ) );

			// 2) Rebrand any remaining standalone "Composer" brand word. Runs
			//    AFTER step 1 so it never touches an identifier. "Composer" (the
			//    widget) and "UiChemy" (the plugin) are intentionally untouched.
			$text = str_replace(
				array( 'UiChemy Composer', 'Uichemy Composer', 'Composer', 'composer' ),
				array( 'UiChemy', 'UiChemy', 'UiChemy', 'uichemy' ),
				$text
			);

			return $text;
		}

		/**
		 * Human-friendly label from an ability name, e.g.
		 * "uichemy-composer/create-page" → "UiChemy Builder: Create Page".
		 *
		 * The label is what a client shows in a tool picker and what the model reads
		 * as the tool's title, so it tracks the product name rather than the
		 * namespace slug's capitalisation.
		 *
		 * @param string $ability_name Full ability name.
		 * @return string
		 */
		private static function label_for( $ability_name ) {
			$slug = strpos( $ability_name, '/' ) !== false
				? substr( $ability_name, strpos( $ability_name, '/' ) + 1 )
				: $ability_name;

			$words = ucwords( str_replace( array( '_', '-' ), ' ', $slug ) );

			return 'UiChemy Builder: ' . $words;
		}
	}
}
