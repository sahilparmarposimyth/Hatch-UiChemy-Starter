<?php
/**
 * Composer widget integration.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Composer_Manager' ) ) {

	/**
	 * Registers and handles Composer widget functionality.
	 */
	class UiChemy_Composer_Manager {

		/**
		 * Shared site-level custom code option key.
		 */
		const SITE_CUSTOM_CODE_OPTION = 'uichemy_composer_site_custom_code';

		/**
		 * Shared site-level 3rd-party deps option key.
		 */
		const SITE_DEPS_OPTION = 'uichemy_composer_site_deps';

		/**
		 * AJAX nonce action/key for editor sync.
		 */
		const EDITOR_AJAX_NONCE_ACTION = 'uichemy_composer_editor_custom_code';

		/**
		 * Constructor.
		 */
		public function __construct() {
			// Builder-agnostic wiring — the shared site-level custom-code / deps
			// AJAX endpoints and the front-end head/footer print hooks. These power
			// the Gutenberg and Bricks composer panels and print #uichemy-globals +
			// site custom code on EVERY front end, so they must NOT be gated behind
			// Elementor. Without this, on a site where Elementor is inactive the
			// save endpoint 400s (globals never persist to the option) AND the
			// wp_head printer never runs (globals never reach the front end).
			// NOTE: keep init_shared() unconditional — a fresh checkout that folds
			// these back into the Elementor-gated init() reintroduces that bug.
			$this->init_shared();

			if ( did_action( 'elementor/loaded' ) ) {
				$this->init();
				return;
			}

			add_action( 'elementor/loaded', array( $this, 'init' ) );
		}

		/**
		 * Builder-agnostic initialization — runs on every request regardless of
		 * Elementor. Site-level custom code + deps are shared across all builders
		 * (Elementor / Gutenberg / Bricks), and the front-end print hooks output
		 * them site-wide.
		 *
		 * @return void
		 */
		public function init_shared() {
			add_action( 'wp_ajax_uichemy_composer_get_site_custom_code', array( $this, 'ajax_get_site_custom_code' ) );
			add_action( 'wp_ajax_uichemy_composer_save_site_custom_code', array( $this, 'ajax_save_site_custom_code' ) );
			add_action( 'wp_ajax_uichemy_composer_get_site_deps', array( $this, 'ajax_get_site_deps' ) );
			add_action( 'wp_ajax_uichemy_composer_save_site_deps', array( $this, 'ajax_save_site_deps' ) );

			// Frontend output locations (equivalent to Elementor custom code
			// placement) — print #uichemy-globals + site custom code into the page
			// head/footer on every builder's front end.
			add_action( 'wp_head', array( $this, 'print_head_custom_code' ), 100 );
			add_action( 'wp_footer', array( $this, 'print_body_end_custom_code' ), 21 );
		}

		/**
		 * Initialize Elementor-specific integrations when Elementor is available.
		 *
		 * @return void
		 */
		public function init() {
			if ( ! did_action( 'elementor/loaded' ) ) {
				return;
			}

			// Settings carries one switch per builder; a site that does not build in
			// Elementor should not be offered the widget there, nor pay for its
			// category. Gated at the hook so nothing downstream has to re-check.
			if ( uichemy_composer_enabled( 'elementor' ) ) {
				add_action( 'elementor/elements/categories_registered', array( $this, 'register_widget_category' ) );
				add_action( 'elementor/widgets/register', array( $this, 'register_widget' ) );
			}
			add_filter( 'get_post_metadata', array( $this, 'normalize_elementor_page_settings_meta' ), 10, 4 );

			// Sanitize Composer widget code fields (raw_js / raw_css) on save for any
			// user who lacks the `unfiltered_html` capability. Elementor's own save
			// pipeline already kses-filters markup fields (raw_html, page/site
			// custom-code head/footer) for these users, but raw_js / raw_css are
			// stored as plain text, so kses never sees them — we strip them here.
			add_filter( 'elementor/document/save/data', array( $this, 'sanitize_composer_widget_code_on_save' ), 10, 2 );

			// Admin bar edit shortcuts for UiChemy-created Nexter header/footer templates.
			add_action( 'admin_bar_menu', array( $this, 'add_header_footer_edit_links' ), 100 );
		}

		/**
		 * Register Elementor widget.
		 *
		 * @param \Elementor\Widgets_Manager $widgets_manager Elementor widgets manager.
		 * @return void
		 */
		public function register_widget_category( $elements_manager ) {
			$wl    = uichemy_white_label_settings();
			$title = ( ! empty( $wl['enabled'] ) && ! empty( $wl['widget_category'] ) )
				? sanitize_text_field( $wl['widget_category'] )
				: esc_html__( 'UiChemy', 'uichemy' );

			$elements_manager->add_category(
				'uichemy',
				array(
					'title' => esc_html( $title ),
					'icon'  => 'fa fa-plug',
				)
			);
		}

		public function register_widget( $widgets_manager ) {
			require_once UICHEMY_PATH . 'includes/admin/widgets/class-uichemy-composer-widget.php';
			$widgets_manager->register( new \UiChemy_Composer_Widget() );

			/*
			 * …and the same widget again under the names it used to have, hidden from
			 * the panel. Content saved as `proton` (released Protuno) or
			 * `uichemy-builder` (an interim dev name) would otherwise render as
			 * nothing until Uich_Composer_Migration got round to its row — and the
			 * migration never runs on the frontend, so a visitor could hit that gap
			 * even on a site whose admin has already been through wp-admin.
			 *
			 * Registered unconditionally rather than behind an is_complete() check:
			 * the migration marks itself complete as soon as it finds no LEGACY rows,
			 * which says nothing about a row imported afterwards (a content export
			 * from an unmigrated site, a database restore). Two hidden widget types
			 * cost nothing to keep.
			 */
			require_once UICHEMY_PATH . 'includes/admin/widgets/class-uichemy-composer-widget-legacy.php';
			$widgets_manager->register( new \UiChemy_Composer_Widget_Composer() );
			$widgets_manager->register( new \UiChemy_Composer_Widget_Proton() );
			$widgets_manager->register( new \UiChemy_Composer_Widget_Uichemy_Builder() );
		}

		/**
		 * Normalize broken Elementor page settings meta from "{}" string to array.
		 *
		 * Some previously created pages stored `_elementor_page_settings` as a JSON string,
		 * but Elementor expects an array and can fatal on strict type checks.
		 *
		 * @param mixed       $value     The value to return, or null to continue normal retrieval.
		 * @param int         $object_id Post ID.
		 * @param string      $meta_key  Meta key.
		 * @param bool|string $single    Whether a single value was requested.
		 * @return mixed
		 */
		public function normalize_elementor_page_settings_meta( $value, $object_id, $meta_key, $single ) {
			if ( '_elementor_page_settings' !== $meta_key ) {
				return $value;
			}

			global $wpdb;
			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Direct read of _elementor_page_settings from postmeta inside a get_post_metadata filter; get_post_meta() here would recurse.
			$raw_value = $wpdb->get_var(
				$wpdb->prepare(
					"SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s LIMIT 1",
					$object_id,
					$meta_key
				)
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

			if ( '{}' === $raw_value ) {
				update_post_meta( $object_id, '_elementor_page_settings', array() );
				return $single ? array() : array( array() );
			}

			return $value;
		}

		/**
		 * Get shared site-level custom code option.
		 *
		 * @return array<string, string>
		 */
		public static function get_site_custom_code_option() {
			$option = get_option( self::SITE_CUSTOM_CODE_OPTION, array() );

			if ( ! is_array( $option ) ) {
				$option = array();
			}

			return array(
				'head'   => isset( $option['head'] ) ? (string) $option['head'] : '',
				'footer' => isset( $option['footer'] ) ? (string) $option['footer'] : '',
			);
		}

		/**
		 * Update shared site-level custom code option.
		 *
		 * @param string $head   Site head code.
		 * @param string $footer  Site footer code.
		 * @return array<string, string>
		 */
		public static function update_site_custom_code_option( $head, $footer ) {
			$data = array(
				'head'   => self::sanitize_custom_code( $head ),
				'footer' => self::sanitize_custom_code( $footer ),
			);

			update_option( self::SITE_CUSTOM_CODE_OPTION, $data, false );

			return $data;
		}

		/**
		 * Wrap raw CSS in a <style> tag if it is not already wrapped.
		 *
		 * @param string $css Raw CSS or already-wrapped block.
		 * @return string
		 */
		private static function mcp_ensure_style_tag( $css ) {
			$css = trim( (string) $css );
			if ( '' === $css ) {
				return '';
			}

			// Head code can be markup, such as Google Fonts <link> tags. Preserve it
			// instead of placing markup inside <style>, which browsers ignore.
			if ( preg_match( '/<(style|link|meta)\b/i', $css ) ) {
				return $css;
			}

			return "<style>\n" . $css . "\n</style>";
		}

		/**
		 * Wrap raw JS in a <script> tag if it is not already wrapped.
		 *
		 * @param string $js Raw JavaScript or already-wrapped block.
		 * @return string
		 */
		private static function mcp_ensure_script_tag( $js ) {
			$js = trim( (string) $js );
			if ( '' === $js ) {
				return '';
			}
			if ( 0 === stripos( $js, '<script' ) ) {
				return $js;
			}
			// Body code can be markup, such as a fixed background layer or a modal
			// root. Preserve it instead of wrapping markup in <script>, which browsers
			// treat as dead text. Bare JS can never begin with "<".
			if ( '<' === $js[0] ) {
				return $js;
			}
			return "<script>\n" . $js . "\n</script>";
		}

		/**
		 * Append CSS and/or JS to the site-level custom code option.
		 * Deduplicates by exact string — if the same block is already present it is not added twice.
		 *
		 * @param string $site_css Optional CSS to append to site head (wrapped in <style> if needed).
		 * @param string $site_js  Optional JS to append to site footer (wrapped in <script> if needed).
		 * @return void
		 */
		private static function mcp_append_site_custom_code( $site_css, $site_js ) {
			$site_css = trim( (string) $site_css );
			$site_js  = trim( (string) $site_js );

			if ( '' === $site_css && '' === $site_js ) {
				return;
			}

			$current = self::get_site_custom_code_option();
			$head    = $current['head'];
			$footer  = $current['footer'];
			$changed = false;

			if ( '' !== $site_css ) {
				$site_css_candidate = $site_css;
				if ( preg_match( '/<link\b/i', $site_css_candidate ) ) {
					$site_css_candidate = self::mcp_filter_duplicate_link_tags_from_markup( $head, $site_css_candidate );
				}
				if ( '' !== trim( $site_css_candidate ) ) {
					$wrapped = self::mcp_ensure_style_tag( $site_css_candidate );
					if ( false === strpos( $head, $wrapped ) ) {
						$head    = '' === $head ? $wrapped : $head . "\n" . $wrapped;
						$changed = true;
					}
				}
			}

			if ( '' !== $site_js ) {
				$wrapped = self::mcp_ensure_script_tag( $site_js );
				if ( false === strpos( $footer, $wrapped ) ) {
					$footer  = '' === $footer ? $wrapped : $footer . "\n" . $wrapped;
					$changed = true;
				}
			}

			if ( $changed ) {
				self::update_site_custom_code_option( $head, $footer );
			}
		}

		/**
		 * Read the inner CSS of the #uichemy-globals block from the site head.
		 *
		 * The block is the single source of truth for site design tokens; this is
		 * the canonical read used by the Globals Manager and the MCP get_globals
		 * tool, and by the section rewriter to source var() definitions.
		 *
		 * @return string Inner CSS ('' when the block is absent).
		 */
		public static function get_globals_block_css() {
			if ( ! class_exists( 'UiChemy_Globals_CSS' ) ) {
				return '';
			}
			$head = self::get_site_custom_code_option()['head'];
			return UiChemy_Globals_CSS::extract_css( $head );
		}

		/**
		 * Replace (or create) the #uichemy-globals <style> block in the site head,
		 * in place, leaving all surrounding head markup byte-identical.
		 *
		 * This is the ONLY write path for globals — it does not append/dedupe like
		 * mcp_append_site_custom_code(); it upserts a single owned block so edits
		 * never stack duplicates. The CSS is stored trusted (admin-authored tokens).
		 *
		 * @param string $css Inner CSS for the block.
		 * @return string The stored inner CSS (trimmed).
		 */
		public static function upsert_globals_block( $css ) {
			if ( ! class_exists( 'UiChemy_Globals_CSS' ) ) {
				return '';
			}
			// Prevent breaking out of the <style id="uichemy-globals"> wrapper. The
			// ONLY sequence that ends a raw-text <style> element is a literal
			// "</style", which can never legitimately appear inside CSS anyway — so
			// neutralising just that closes stored-XSS while preserving every valid
			// '<': inline SVG data URIs (url("data:image/svg+xml,<svg…")), media
			// range queries ((width < 600px)), and content strings all pass through.
			$css     = trim( str_ireplace( '</style', '< /style', (string) $css ) );
			$current = self::get_site_custom_code_option();
			$head    = UiChemy_Globals_CSS::upsert_block( $current['head'], $css );
			// The #uichemy-globals block is plugin-generated design-token CSS (not
			// user-entered arbitrary code) with its </style> breakout already
			// neutralised above, so it is stored via a direct option write rather
			// than self::update_site_custom_code_option(). That path runs
			// self::sanitize_custom_code(), which would strip this owned <style>
			// block for a manage_options admin who lacks `unfiltered_html`
			// (e.g. on multisite, or when DISALLOW_UNFILTERED_HTML is set) and
			// break the globals feature. The existing head/footer are already
			// stored, previously sanitised values.
			update_option(
				self::SITE_CUSTOM_CODE_OPTION,
				array(
					'head'   => $head,
					'footer' => $current['footer'],
				),
				false
			);
			return $css;
		}

		/**
		 * Edit the #uichemy-globals block with literal find/replace patches, so a
		 * caller can change part of the block without resending the whole file.
		 * Each edit replaces ALL exact (case-sensitive) occurrences of `find`.
		 * Insertion is a find/replace whose replacement re-includes the anchor
		 * (e.g. find ":root {" → replace ":root {\n  --new: 8px;").
		 *
		 * @param array $edits List of { find, replace } patches, applied in order.
		 * @return array { css: string, replacements: array<int,{find,count}> }
		 */
		public static function edit_globals_block( $edits ) {
			if ( ! class_exists( 'UiChemy_Globals_CSS' ) ) {
				return array(
					'css'          => '',
					'replacements' => array(),
				);
			}
			$css    = self::get_globals_block_css();
			$report = array();
			foreach ( (array) $edits as $edit ) {
				if ( ! is_array( $edit ) ) {
					continue;
				}
				$find = isset( $edit['find'] ) ? (string) $edit['find'] : '';
				if ( '' === $find ) {
					continue;
				}
				$replace = isset( $edit['replace'] ) ? (string) $edit['replace'] : '';
				$count   = 0;
				$css     = str_replace( $find, $replace, $css, $count );
				$report[] = array(
					'find'  => $find,
					'count' => $count,
				);
			}
			return array(
				'css'          => self::upsert_globals_block( $css ),
				'replacements' => $report,
			);
		}

		/**
		 * Remove <link> lines whose href is already present in site head markup (avoids duplicate font preconnect/CSS URLs).
		 *
		 * @param string $existing_head Current aggregated head HTML.
		 * @param string $markup        New markup (may contain multiple lines of <link> tags).
		 * @return string
		 */
		private static function mcp_filter_duplicate_link_tags_from_markup( $existing_head, $markup ) {
			$existing_head = (string) $existing_head;
			$markup        = (string) $markup;
			$lines         = preg_split( '/\r\n|\r|\n/', $markup );
			if ( ! is_array( $lines ) ) {
				return $markup;
			}
			$keep = array();
			foreach ( $lines as $line ) {
				$line = trim( (string) $line );
				if ( '' === $line ) {
					continue;
				}
				if ( preg_match( '/<link\b[^>]*\bhref\s*=\s*(["\'])([^"\']*)\1/i', $line, $m ) ) {
					$href = isset( $m[2] ) ? trim( (string) $m[2] ) : '';
					if ( '' !== $href && self::mcp_site_head_contains_link_href( $existing_head, $href ) ) {
						continue;
					}
				}
				$keep[] = $line;
			}
			return implode( "\n", $keep );
		}

		/**
		 * Whether site head markup already includes a <link> with the same href (case-insensitive).
		 *
		 * @param string $head Site head HTML.
		 * @param string $href URL from a candidate <link href="...">.
		 * @return bool
		 */
		private static function mcp_site_head_contains_link_href( $head, $href ) {
			$head = (string) $head;
			$href = strtolower( trim( (string) $href ) );
			if ( '' === $href ) {
				return false;
			}
			if ( ! preg_match_all( '/<link\b[^>]*\bhref\s*=\s*(["\'])([^"\']*)\1/i', $head, $matches ) ) {
				return false;
			}
			foreach ( $matches[2] as $existing ) {
				if ( strtolower( trim( (string) $existing ) ) === $href ) {
					return true;
				}
			}
			return false;
		}

		/**
		 * Collect first non-empty page head/footer custom code from Composer widgets (document order).
		 *
		 * @param array  $elements Elementor elements tree.
		 * @param string $head     Output canonical head markup.
		 * @param string $footer   Output canonical footer markup.
		 * @return void
		 */
		private static function mcp_collect_first_page_custom_code_from_elements( $elements, &$head, &$footer ) {
			foreach ( $elements as $element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}
				$el_type     = isset( $element['elType'] ) ? $element['elType'] : '';
				$widget_type = isset( $element['widgetType'] ) ? $element['widgetType'] : '';
				if ( 'widget' === $el_type && uichemy_is_composer_widget_type( $widget_type ) ) {
					$settings = isset( $element['settings'] ) && is_array( $element['settings'] ) ? $element['settings'] : array();
					if ( '' === $head ) {
						$h = isset( $settings['page_custom_code_head'] ) ? trim( (string) $settings['page_custom_code_head'] ) : '';
						if ( '' !== $h ) {
							$head = $h;
						}
					}
					if ( '' === $footer ) {
						$f = isset( $settings['page_custom_code_footer'] ) ? trim( (string) $settings['page_custom_code_footer'] ) : '';
						if ( '' !== $f ) {
							$footer = $f;
						}
					}
				}
				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					self::mcp_collect_first_page_custom_code_from_elements( $element['elements'], $head, $footer );
				}
				if ( '' !== $head && '' !== $footer ) {
					break;
				}
			}
		}

		/**
		 * Copy canonical page head/footer onto every Composer widget so Elementor shows the same page-level fields for each section.
		 *
		 * @param array  $elements         Elementor elements tree (by reference).
		 * @param string $canonical_head   Head markup.
		 * @param string $canonical_footer Footer markup.
		 * @return void
		 */
		private static function mcp_apply_canonical_page_custom_code_to_all_widgets( array &$elements, $canonical_head, $canonical_footer ) {
			foreach ( $elements as &$element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}
				$el_type     = isset( $element['elType'] ) ? $element['elType'] : '';
				$widget_type = isset( $element['widgetType'] ) ? $element['widgetType'] : '';
				if ( 'widget' === $el_type && uichemy_is_composer_widget_type( $widget_type ) ) {
					if ( ! isset( $element['settings'] ) || ! is_array( $element['settings'] ) ) {
						$element['settings'] = array();
					}
					if ( '' !== $canonical_head ) {
						$element['settings']['page_custom_code_head'] = $canonical_head;
					}
					if ( '' !== $canonical_footer ) {
						$element['settings']['page_custom_code_footer'] = $canonical_footer;
					}
				}
				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					self::mcp_apply_canonical_page_custom_code_to_all_widgets( $element['elements'], $canonical_head, $canonical_footer );
				}
			}
			unset( $element );
		}

		/**
		 * After MCP builds/updates a multi-widget page, mirror page custom code to every Composer widget (editor UX + consistent JSON).
		 *
		 * @param array $elements Elementor elements tree (by reference).
		 * @return void
		 */
		private static function mcp_sync_page_custom_code_across_widgets( array &$elements ) {
			$head   = '';
			$footer = '';
			self::mcp_collect_first_page_custom_code_from_elements( $elements, $head, $footer );
			if ( '' === $head && '' === $footer ) {
				return;
			}
			self::mcp_apply_canonical_page_custom_code_to_all_widgets( $elements, $head, $footer );
		}

		/**
		 * Merge page-level head/footer custom code into the first Composer widget on the page (single copy per page).
		 *
		 * @param array  $elements Elementor elements tree (by reference).
		 * @param string $page_css Raw page CSS (wrapped if needed).
		 * @param string $page_js  Raw page JS (wrapped if needed).
		 * @return bool True if an existing Composer widget was updated.
		 */
		private static function mcp_merge_page_custom_code_into_first_widget( array &$elements, $page_css, $page_js ) {
			$page_css = trim( (string) $page_css );
			$page_js  = trim( (string) $page_js );
			if ( '' === $page_css && '' === $page_js ) {
				return false;
			}
			foreach ( $elements as &$el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				$el_type     = isset( $el['elType'] ) ? $el['elType'] : '';
				$widget_type = isset( $el['widgetType'] ) ? $el['widgetType'] : '';
				if ( 'widget' === $el_type && uichemy_is_composer_widget_type( $widget_type ) ) {
					if ( ! isset( $el['settings'] ) || ! is_array( $el['settings'] ) ) {
						$el['settings'] = array();
					}
					if ( '' !== $page_css ) {
						$block    = self::mcp_ensure_style_tag( $page_css );
						$existing = isset( $el['settings']['page_custom_code_head'] ) ? (string) $el['settings']['page_custom_code_head'] : '';
						if ( false === strpos( $existing, $block ) ) {
							$el['settings']['page_custom_code_head'] = '' === $existing ? $block : $existing . "\n" . $block;
						}
					}
					if ( '' !== $page_js ) {
						$block    = self::mcp_ensure_script_tag( $page_js );
						$existing = isset( $el['settings']['page_custom_code_footer'] ) ? (string) $el['settings']['page_custom_code_footer'] : '';
						if ( false === strpos( $existing, $block ) ) {
							$el['settings']['page_custom_code_footer'] = '' === $existing ? $block : $existing . "\n" . $block;
						}
					}
					unset( $el );
					return true;
				}
				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					if ( self::mcp_merge_page_custom_code_into_first_widget( $el['elements'], $page_css, $page_js ) ) {
						unset( $el );
						return true;
					}
				}
			}
			unset( $el );
			return false;
		}

		/**
		 * Match generated section HTML/CSS to Elementor globals (colors → vars, typography → .text-{id} classes).
		 * Called automatically on MCP import so existing kit typography applies without a separate tool call.
		 *
		 * @param string $html Section HTML.
		 * @param string $css  Section CSS.
		 * @return array{ html: string, css: string, dynamic_globals: ?array }
		 */
		private static function mcp_prepare_import_html_css_with_globals( $html, $css ) {
			$html = (string) $html;
			$css  = (string) $css;
			if ( '' === trim( $css ) && '' === trim( $html ) ) {
				return array(
					'html'            => $html,
					'css'             => $css,
					'dynamic_globals' => null,
				);
			}
			$snapshot = self::get_globals_block_css();
			if ( '' === trim( $snapshot ) ) {
				return array(
					'html'            => $html,
					'css'             => $css,
					'dynamic_globals' => null,
				);
			}
			$result = self::mcp_apply_global_matches_dynamic(
				array(
					'html'                    => $html,
					'css'                     => $css,
					'globals_ai_data'         => $snapshot,
					'prefer_typography_class' => true,
				)
			);
			if ( is_wp_error( $result ) ) {
				return array(
					'html'            => $html,
					'css'             => $css,
					'dynamic_globals' => null,
				);
			}
			return array(
				'html'            => isset( $result['html'] ) ? (string) $result['html'] : $html,
				'css'             => isset( $result['css'] ) ? (string) $result['css'] : $css,
				'dynamic_globals' => isset( $result['matches'] ) ? $result['matches'] : array(),
			);
		}

		/**
		 * Sync MCP-generated HTML/CSS/JS into a Composer widget on a post.
		 *
		 * @param int   $post_id  Target post ID containing Elementor data.
		 * @param array $payload  Sync payload.
		 * @return array|\WP_Error
		 */
		public static function mcp_sync_generated_code_to_widget( $post_id, $payload ) {
			$post_id = absint( $post_id );
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id provided.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$mode      = isset( $payload['mode'] ) ? strtolower( (string) $payload['mode'] ) : 'replace';
			$mode      = in_array( $mode, array( 'replace', 'append' ), true ) ? $mode : 'replace';
			$widget_id = isset( $payload['widget_id'] ) ? (string) $payload['widget_id'] : '';
			$source    = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';
			$label     = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : '';

			$raw_html      = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$raw_css       = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$raw_js        = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;

			if ( $upload_images ) {
				$html_media_result = self::mcp_upload_html_images_to_media_library( $raw_html, $raw_css );
				$raw_html          = $html_media_result['html'];
				if ( isset( $html_media_result['css'] ) ) {
					$raw_css = (string) $html_media_result['css'];
				}
			} else {
				$html_media_result = array( 'html' => $raw_html, 'uploaded' => array(), 'failed' => array() );
			}

			if ( '' === trim( $raw_html ) && '' === trim( $raw_css ) && '' === trim( $raw_js ) ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least one of html, css, or js must be provided.' );
			}

			$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $raw_html, $raw_css );
			$raw_html         = $globals_prepared['html'];
			$raw_css          = $globals_prepared['css'];

			$elementor_data_raw = get_post_meta( $post_id, '_elementor_data', true );
			if ( ! is_string( $elementor_data_raw ) || '' === $elementor_data_raw ) {
				return new \WP_Error( 'uich_missing_elementor_data', 'No Elementor data found on the provided post.' );
			}

			$elements = json_decode( $elementor_data_raw, true );
			if ( ! is_array( $elements ) ) {
				return new \WP_Error( 'uich_invalid_elementor_data', 'Elementor data is not valid JSON.' );
			}

			$tagged_html = self::build_mcp_tagged_code_block( 'html', $raw_html, $source, $label );
			$tagged_css  = self::build_mcp_tagged_code_block( 'css', $raw_css, $source, $label );
			$tagged_js   = self::build_mcp_tagged_code_block( 'js', $raw_js, $source, $label );

			$sync_result = self::apply_mcp_generated_code_to_elements(
				$elements,
				array(
					'mode'      => $mode,
					'widget_id' => $widget_id,
					'html'      => $tagged_html,
					'css'       => $tagged_css,
					'js'        => $tagged_js,
				)
			);

			if ( empty( $sync_result['updated'] ) ) {
				$error_message = ! empty( $sync_result['message'] ) ? $sync_result['message'] : 'No matching Composer widget found.';
				return new \WP_Error( 'uich_widget_not_found', $error_message );
			}

			self::apply_dynamic_tag_bindings( $elements ); // opt-in: {{ tokens }} → bound dynamic tags
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );

			// files_manager->clear_cache() only flushes CSS. Elementor also caches
			// rendered element markup in the '_elementor_element_cache' post meta,
			// which a direct data write does not invalidate — delete it so the new
			// HTML actually renders on the front end.
			delete_post_meta( $post_id, '_elementor_element_cache' );

			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'          => $post_id,
				'widget_id'        => $sync_result['widget_id'],
				'mode'             => $mode,
				'updated_fields'   => $sync_result['updated_fields'],
				'matched_by'       => $sync_result['matched_by'],
				'image_uploads'    => $html_media_result['uploaded'],
				'image_failures'   => $html_media_result['failed'],
				'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				'message'          => 'Generated code synced to Composer widget successfully.',
			);
		}

		/**
		 * Default settings for the outer Elementor container that wraps a
		 * Composer widget.
		 *
		 * Elementor's default container ships with non-zero padding and a
		 * flex gap inherited from the active kit — those values fight the
		 * Composer widget's own `padding-inline: clamp(...)` and gap rules
		 * and shift the layout one extra time on every page. We zero out
		 * padding / margin / flex_gap on the outer wrapper so the widget's
		 * CSS is the single source of truth for spacing.
		 *
		 * Callers pass any extras (e.g. `html_tag` for header/footer) via
		 * $extra; those are merged on top.
		 *
		 * @param array $extra Additional settings to merge in.
		 * @return array
		 */
		private static function mcp_widget_container_default_settings( array $extra = array() ) {
			$zero_box = array(
				'unit'     => 'px',
				'top'      => '0',
				'right'    => '0',
				'bottom'   => '0',
				'left'     => '0',
				'isLinked' => true,
			);
			$defaults = array(
				'content_width' => 'full',
				'padding'       => $zero_box,
				'margin'        => $zero_box,
				'flex_gap'      => array(
					'unit'     => 'px',
					'size'     => 0,
					'sizes'    => array(),
					'column'   => '0',
					'row'      => '0',
					'isLinked' => true,
				),
			);
			return array_merge( $defaults, $extra );
		}

		/**
		 * Create a new Elementor page with one Composer widget seeded by generated code.
		 *
		 * @param array $payload Page + code payload.
		 * @return array|\WP_Error
		 */
		public static function mcp_create_page_with_generated_code( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$title  = isset( $payload['title'] ) ? sanitize_text_field( (string) $payload['title'] ) : 'UiChemy AI Landing Page';
			$status = isset( $payload['status'] ) ? sanitize_key( (string) $payload['status'] ) : 'draft';
			$status = in_array( $status, array( 'draft', 'publish', 'private' ), true ) ? $status : 'draft';
			$source = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';
			$label  = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : '';

			$raw_html      = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$raw_css       = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$raw_js        = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$page_css      = isset( $payload['page_css'] ) ? (string) $payload['page_css'] : '';
			$page_js       = isset( $payload['page_js'] ) ? (string) $payload['page_js'] : '';
			$site_css      = isset( $payload['site_css'] ) ? (string) $payload['site_css'] : '';
			$site_js       = isset( $payload['site_js'] ) ? (string) $payload['site_js'] : '';
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;

			if ( $upload_images ) {
				$html_media_result = self::mcp_upload_html_images_to_media_library( $raw_html, $raw_css );
				$raw_html          = $html_media_result['html'];
				if ( isset( $html_media_result['css'] ) ) {
					$raw_css = (string) $html_media_result['css'];
				}
			} else {
				$html_media_result = array( 'html' => $raw_html, 'uploaded' => array(), 'failed' => array() );
			}

			if ( '' === trim( $raw_html ) && '' === trim( $raw_css ) && '' === trim( $raw_js ) ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least one of html, css, or js must be provided.' );
			}

			$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $raw_html, $raw_css );
			$raw_html         = $globals_prepared['html'];
			$raw_css          = $globals_prepared['css'];

			$post_attributes = array(
				'post_title'  => $title,
				'post_type'   => self::mcp_resolve_post_type( $payload ),
				'post_status' => $status,
			);

			// Elementor's document type stays 'page' whatever the post type is: it
			// selects the wp-page editing experience (no theme-builder conditions),
			// which is what a Composer-built post wants too.
			$document = \Elementor\Plugin::$instance->documents->create( 'page', $post_attributes );
			if ( is_wp_error( $document ) ) {
				return new \WP_Error( 'uich_page_create_failed', $document->get_error_message() );
			}

			$post_id = $document->get_main_id();
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_page_create_failed', 'Failed to create Elementor page document.' );
			}

			// Persist site-level CSS/JS to the global site option before saving the page.
			self::mcp_append_site_custom_code( $site_css, $site_js );

			$widget_id    = strtolower( wp_generate_password( 7, false, false ) );
			$container_id = strtolower( wp_generate_password( 7, false, false ) );

			$widget_settings = array(
				'_title'               => $label,
				'raw_html'             => self::build_mcp_tagged_code_block( 'html', $raw_html, $source, $label ),
				'raw_css'              => self::build_mcp_tagged_code_block( 'css', $raw_css, $source, $label ),
				'raw_js'              => self::build_mcp_tagged_code_block( 'js', $raw_js, $source, $label ),
			);
			if ( '' !== trim( $page_css ) ) {
				$widget_settings['page_custom_code_head'] = self::mcp_ensure_style_tag( $page_css );
			}
			if ( '' !== trim( $page_js ) ) {
				$widget_settings['page_custom_code_footer'] = self::mcp_ensure_script_tag( $page_js );
			}

			// Keep widget directly under a container (no section/column wrappers).
			$elements = array(
				array(
					'id'       => $container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => self::mcp_widget_container_default_settings( array( '_title' => $title ) ),
					'elements' => array(
						array(
							'id'         => $widget_id,
							'elType'     => 'widget',
							'widgetType' => 'uichemy-composer',
							'settings'   => $widget_settings,
							'elements'   => array(),
						),
					),
				),
			);

			$save_payload = array(
				'elements' => $elements,
				'settings' => array(),
			);

			try {
				$document->save( $save_payload );
			} catch ( \Throwable $e ) {
				// Continue to explicit meta writes below.
			}

			// Ensure the newly created page always has persisted Elementor structure.
			self::apply_dynamic_tag_bindings( $elements ); // opt-in: {{ tokens }} → bound dynamic tags
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
			// Elementor expects this meta as an array. A JSON string (e.g. "{}") can trigger a type error.
			update_post_meta( $post_id, '_elementor_page_settings', array() );
			update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );

			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'       => $post_id,
				'widget_id'     => $widget_id,
				'title'         => get_the_title( $post_id ),
				'status'        => get_post_status( $post_id ),
				'edit_link'     => get_edit_post_link( $post_id, 'internal' ),
				'elementor_link'=> add_query_arg(
					array(
						'post'   => $post_id,
						'action' => 'elementor',
					),
					admin_url( 'post.php' )
				),
				'preview_link'  => get_permalink( $post_id ),
				'image_uploads' => $html_media_result['uploaded'],
				'image_failures'=> $html_media_result['failed'],
				'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				'message'       => 'New page created with Composer widget content.',
			);
		}

		/**
		 * MCP — create a NATIVE UiChemy Theme Builder template (header, footer or 404).
		 *
		 * Creates a uichemy_template post (via UiChemy_Template_Store) holding a
		 * single Composer widget, active on the entire site by default. Rendering is
		 * owned by UiChemy's own engine, so this no longer depends on Elementor Pro
		 * or the Nexter Extension. When either of those theme-builder systems is
		 * active we DETECT and report it in the response, but never modify or
		 * disable their templates.
		 *
		 * @param array $payload Template + code payload.
		 * @return array|\WP_Error
		 */
		public static function mcp_create_header_footer_template( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! class_exists( 'UiChemy_Template_Store' ) || ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return new \WP_Error( 'uich_theme_builder_disabled', 'The UiChemy Theme Builder is disabled. Enable it in UiChemy → Settings.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$type = isset( $payload['type'] ) ? sanitize_key( (string) $payload['type'] ) : 'header';
			if ( ! UiChemy_Template_CPT::is_valid_type( $type ) ) {
				$type = 'header';
			}

			$title         = isset( $payload['title'] ) ? sanitize_text_field( (string) $payload['title'] ) : ( ucfirst( $type ) . ' UiChemy' );
			$label         = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : ucfirst( $type );
			$source        = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';
			$raw_html      = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$raw_css       = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$raw_js        = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$site_css      = isset( $payload['site_css'] ) ? (string) $payload['site_css'] : '';
			$site_js       = isset( $payload['site_js'] ) ? (string) $payload['site_js'] : '';
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;

			if ( '' === trim( $raw_html ) && '' === trim( $raw_css ) ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least html or css must be provided.' );
			}

			if ( $upload_images ) {
				$html_media_result = self::mcp_upload_html_images_to_media_library( $raw_html, $raw_css );
				$raw_html          = $html_media_result['html'];
				if ( isset( $html_media_result['css'] ) ) {
					$raw_css = (string) $html_media_result['css'];
				}
			} else {
				$html_media_result = array( 'html' => $raw_html, 'uploaded' => array(), 'failed' => array() );
			}

			$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $raw_html, $raw_css );
			$raw_html         = $globals_prepared['html'];
			$raw_css          = $globals_prepared['css'];

			// Persist site-level CSS/JS before creating template.
			self::mcp_append_site_custom_code( $site_css, $site_js );

			$widget_id    = strtolower( wp_generate_password( 7, false, false ) );
			$container_id = strtolower( wp_generate_password( 7, false, false ) );

			$widget_settings = array(
				'raw_html' => self::build_mcp_tagged_code_block( 'html', $raw_html, $source, $label ),
				'raw_css'  => self::build_mcp_tagged_code_block( 'css', $raw_css, $source, $label ),
				'raw_js'   => self::build_mcp_tagged_code_block( 'js', $raw_js, $source, $label ),
			);

			// header → <header>, footer → <footer>, 404 → <div> on the container.
			$container_html_tag = UiChemy_Template_CPT::container_tag_for_type( $type );

			$elements = array(
				array(
					'id'       => $container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => self::mcp_widget_container_default_settings( array( 'html_tag' => $container_html_tag ) ),
					'elements' => array(
						array(
							'id'         => $widget_id,
							'elType'     => 'widget',
							'widgetType' => 'uichemy-composer',
							'settings'   => $widget_settings,
							'elements'   => array(),
						),
					),
				),
			);

			// Detect (but never touch) other theme-builder systems so we can warn
			// about a possible double header/footer. Coexistence is deliberate:
			// UiChemy owns its own templates and leaves Pro/Nexter alone (the
			// takeover behaviour is a separate, deferred product decision).
			$conflicts = array();
			if ( ( class_exists( '\ElementorPro\Plugin' ) || defined( 'ELEMENTOR_PRO_VERSION' ) ) && 'error_404' !== $type ) {
				$conflicts[] = 'elementor_pro';
			}
			if ( post_type_exists( 'nxt_builder' ) ) {
				$conflicts[] = 'nexter';
			}

			// Create the native UiChemy template, active on the entire site.
			// UiChemy_Template_Store::create() also deactivates any other active
			// UiChemy template of the same type so there is never a duplicate.
			$post_id = UiChemy_Template_Store::create(
				array(
					'type'       => $type,
					'title'      => $title,
					'status'     => 'active',
					'conditions' => array( 'scope' => 'entire' ),
					'elements'   => $elements,
				)
			);

			if ( is_wp_error( $post_id ) ) {
				return $post_id;
			}

			$type_label = ucfirst( str_replace( 'error_404', '404', $type ) );
			$message    = $type_label . ' template created via the UiChemy Theme Builder and is ACTIVE on the entire site.';
			if ( ! empty( $conflicts ) ) {
				$message .= ' Note: another theme-builder system (' . implode( ', ', $conflicts ) . ') is active on this site; UiChemy has NOT changed it, so you may need to disable its ' . $type . ' template to avoid a duplicate.';
			}

			return array(
				'post_id'                 => $post_id,
				'system'                  => 'uichemy_native',
				'type'                    => $type,
				'active'                  => true,
				'title'                   => get_the_title( $post_id ),
				'elementor_link'          => add_query_arg(
					array( 'post' => $post_id, 'action' => 'elementor' ),
					admin_url( 'post.php' )
				),
				'coexistence_conflicts'   => $conflicts,
				'image_uploads'           => $html_media_result['uploaded'],
				'image_failures'          => $html_media_result['failed'],
				'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				'message'                 => $message,
			);
		}

		/**
		 * Ability/MCP — create ANY native UiChemy Theme Builder template.
		 *
		 * Generalises mcp_create_header_footer_template() to every Theme Builder
		 * type (header, footer, single, archive, single_product, product_archive,
		 * search, error_404) with a TYPE-AWARE placement model:
		 *
		 *  - header / footer            → display conditions (entire | specific IDs)
		 *  - single                     → target post type (pt:{type} | front | any)
		 *  - archive                    → target archive   (blog | author | date | tax:{tax} | any)
		 *  - single_product / product_archive / search / error_404 → whole context
		 *
		 * The friendly `placement` argument is normalised into the store's internal
		 * conditions + target by self::normalize_theme_builder_placement(). Rendering
		 * is owned by UiChemy's native engine, so this works on free Elementor and
		 * never depends on Elementor Pro or Nexter.
		 *
		 * @param array $payload Template + code + placement payload.
		 * @return array|\WP_Error
		 */
		public static function create_theme_builder_template( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! class_exists( 'UiChemy_Template_Store' ) || ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return new \WP_Error( 'uich_theme_builder_disabled', 'The UiChemy Theme Builder is not available.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$type = isset( $payload['type'] ) ? sanitize_key( (string) $payload['type'] ) : '';
			if ( ! UiChemy_Template_CPT::is_valid_type( $type ) ) {
				// Closes the AI/MCP route too — otherwise an ability could create a
				// Pro-only template type in the Free build.
				if ( UiChemy_Template_CPT::is_known_type( $type ) ) {
					return new \WP_Error(
						'uich_pro_template_type',
						'"' . $type . '" templates are a UiChemy Pro feature.'
					);
				}
				return new \WP_Error(
					'uich_bad_template_type',
					'Unknown template type "' . $type . '". Valid types: ' . implode( ', ', UiChemy_Template_CPT::allowed_types() ) . '.'
				);
			}

			// WooCommerce types require WooCommerce so the location actually resolves.
			if ( in_array( $type, array( 'single_product', 'product_archive' ), true ) && ! class_exists( 'WooCommerce' ) ) {
				return new \WP_Error( 'uich_woocommerce_missing', 'WooCommerce must be active to create a "' . $type . '" template.' );
			}

			// Resolve the friendly placement into internal conditions + target.
			$placement = isset( $payload['placement'] ) && is_array( $payload['placement'] ) ? $payload['placement'] : array();
			$resolved  = self::normalize_theme_builder_placement( $type, $placement );
			if ( is_wp_error( $resolved ) ) {
				return $resolved;
			}

			$title         = isset( $payload['title'] ) ? sanitize_text_field( (string) $payload['title'] ) : ( ucfirst( str_replace( 'error_404', '404', $type ) ) . ' UiChemy' );
			$label         = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : ucfirst( $type );
			$source        = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';
			$raw_html      = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$raw_css       = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$raw_js        = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$site_css      = isset( $payload['site_css'] ) ? (string) $payload['site_css'] : '';
			$site_js       = isset( $payload['site_js'] ) ? (string) $payload['site_js'] : '';
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;
			$status        = ( isset( $payload['status'] ) && 'inactive' === $payload['status'] ) ? 'inactive' : 'active';
			$editor        = ( isset( $payload['editor'] ) && 'gutenberg' === $payload['editor'] ) ? 'gutenberg' : 'elementor';

			/*
			 * A Gutenberg template is block markup, not generated code: it goes into
			 * post_content verbatim and there is no Composer widget to build. The
			 * html/css path below is the Elementor one, so a block template short
			 * -circuits here rather than being wrapped in an element tree it would
			 * never render from.
			 */
			$block_content = isset( $payload['content'] ) ? (string) $payload['content'] : '';
			if ( 'gutenberg' === $editor && '' !== trim( $block_content ) ) {
				$post_id = UiChemy_Template_Store::create(
					array(
						'type'       => $type,
						'title'      => $title,
						'label'      => $label,
						'status'     => $status,
						'editor'     => 'gutenberg',
						'conditions' => $resolved['conditions'],
						'target'     => $resolved['target'],
						'content'    => $block_content,
					)
				);

				if ( is_wp_error( $post_id ) ) {
					return $post_id;
				}

				return array(
					'post_id'           => $post_id,
					'system'            => 'uichemy_native',
					'type'              => $type,
					'editor'            => 'gutenberg',
					'active'            => ( 'active' === $status ),
					'status'            => $status,
					'target'            => $resolved['target'],
					'conditions'        => $resolved['conditions'],
					'placement_summary' => $resolved['summary'],
					'title'             => get_the_title( $post_id ),
					'edit_link'         => get_edit_post_link( $post_id, 'raw' ),
					'message'           => ucfirst( str_replace( 'error_404', '404', $type ) )
						. ' template created via the UiChemy Theme Builder as Gutenberg blocks (' . $resolved['summary'] . ').',
				);
			}

			if ( '' === trim( $raw_html ) && '' === trim( $raw_css ) ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least html or css must be provided or "content" for a Gutenberg template.' );
			}

			if ( $upload_images ) {
				$html_media_result = self::mcp_upload_html_images_to_media_library( $raw_html, $raw_css );
				$raw_html          = $html_media_result['html'];
				if ( isset( $html_media_result['css'] ) ) {
					$raw_css = (string) $html_media_result['css'];
				}
			} else {
				$html_media_result = array( 'html' => $raw_html, 'uploaded' => array(), 'failed' => array() );
			}

			$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $raw_html, $raw_css );
			$raw_html         = $globals_prepared['html'];
			$raw_css          = $globals_prepared['css'];

			// Persist site-level CSS/JS before creating the template.
			self::mcp_append_site_custom_code( $site_css, $site_js );

			$widget_id    = strtolower( wp_generate_password( 7, false, false ) );
			$container_id = strtolower( wp_generate_password( 7, false, false ) );

			$widget_settings = array(
				'raw_html' => self::build_mcp_tagged_code_block( 'html', $raw_html, $source, $label ),
				'raw_css'  => self::build_mcp_tagged_code_block( 'css', $raw_css, $source, $label ),
				'raw_js'   => self::build_mcp_tagged_code_block( 'js', $raw_js, $source, $label ),
			);

			$container_html_tag = UiChemy_Template_CPT::container_tag_for_type( $type );

			$elements = array(
				array(
					'id'       => $container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => self::mcp_widget_container_default_settings( array( 'html_tag' => $container_html_tag ) ),
					'elements' => array(
						array(
							'id'         => $widget_id,
							'elType'     => 'widget',
							'widgetType' => 'uichemy-composer',
							'settings'   => $widget_settings,
							'elements'   => array(),
						),
					),
				),
			);

			// Detect (but never touch) other theme-builder systems so we can warn
			// about a possible duplicate location.
			$conflicts = array();
			if ( ( class_exists( '\ElementorPro\Plugin' ) || defined( 'ELEMENTOR_PRO_VERSION' ) ) && 'error_404' !== $type ) {
				$conflicts[] = 'elementor_pro';
			}
			if ( post_type_exists( 'nxt_builder' ) ) {
				$conflicts[] = 'nexter';
			}

			$post_id = UiChemy_Template_Store::create(
				array(
					'type'       => $type,
					'title'      => $title,
					'label'      => $label,
					'status'     => $status,
					'editor'     => $editor,
					'conditions' => $resolved['conditions'],
					'target'     => $resolved['target'],
					'elements'   => $elements,
				)
			);

			if ( is_wp_error( $post_id ) ) {
				return $post_id;
			}

			$type_label = ucfirst( str_replace( 'error_404', '404', $type ) );
			$message    = $type_label . ' template created via the UiChemy Theme Builder (' . $resolved['summary'] . ').';
			if ( 'active' === $status && ! empty( $conflicts ) ) {
				$message .= ' Note: another theme-builder system (' . implode( ', ', $conflicts ) . ') is active; UiChemy has NOT changed it, so you may need to disable its ' . $type . ' template to avoid a duplicate.';
			}

			return array(
				'post_id'                 => $post_id,
				'system'                  => 'uichemy_native',
				'type'                    => $type,
				'active'                  => ( 'active' === $status ),
				'status'                  => $status,
				'target'                  => $resolved['target'],
				'conditions'              => $resolved['conditions'],
				'placement_summary'       => $resolved['summary'],
				'title'                   => get_the_title( $post_id ),
				'elementor_link'          => add_query_arg(
					array( 'post' => $post_id, 'action' => 'elementor' ),
					admin_url( 'post.php' )
				),
				'coexistence_conflicts'   => $conflicts,
				'image_uploads'           => $html_media_result['uploaded'],
				'image_failures'          => $html_media_result['failed'],
				'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				'message'                 => $message,
			);
		}

		/**
		 * Translate a friendly, TYPE-AWARE `placement` payload into the store's
		 * internal { conditions, target } pair, with per-type defaults and strict
		 * validation of nonsensical combinations.
		 *
		 * @param string $type      Template type (already validated).
		 * @param array  $placement Friendly placement payload.
		 * @return array|\WP_Error   array{ conditions:array, target:string, summary:string }
		 */
		private static function normalize_theme_builder_placement( $type, $placement ) {
			$placement = is_array( $placement ) ? $placement : array();

			$to_ids = static function ( $list ) {
				if ( ! is_array( $list ) ) {
					return array();
				}
				return array_values( array_unique( array_filter( array_map( 'absint', $list ) ) ) );
			};

			$include = isset( $placement['include'] ) ? $to_ids( $placement['include'] ) : array();
			$exclude = isset( $placement['exclude'] ) ? $to_ids( $placement['exclude'] ) : array();

			// v2 rules passthrough — lets create() reach the full conditions matrix
			// (specific page/post IDs, specific terms, authors, mixed include+exclude)
			// at create time; the store re-sanitizes the rules on save.
			if ( ! empty( $placement['rules'] ) && is_array( $placement['rules'] ) ) {
				$rules_target = isset( $placement['target'] ) ? UiChemy_Template_Store::sanitize_target( $placement['target'] ) : 'any';
				return array(
					'conditions' => array(
						'rules'   => $placement['rules'],
						'include' => $include,
						'exclude' => $exclude,  // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_exclude -- Small admin-scoped exclusion list.
					),
					'target'     => $rules_target,
					'summary'    => 'custom rules (' . count( $placement['rules'] ) . ')',
				);
			}

			switch ( $type ) {
				case 'header':
				case 'footer':
					$scope      = ( isset( $placement['scope'] ) && 'specific' === $placement['scope'] ) ? 'specific' : 'entire';
					$conditions = array( 'scope' => $scope, 'include' => $include, 'exclude' => $exclude );  // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_exclude -- Small admin-scoped exclusion list.
					$summary    = ( 'specific' === $scope )
						? 'specific pages (' . count( $include ) . ' included / ' . count( $exclude ) . ' excluded)'
						: 'entire site';
					return array( 'conditions' => $conditions, 'target' => 'any', 'summary' => $summary );

				case 'single':
					$pt = isset( $placement['post_type'] ) ? sanitize_key( (string) $placement['post_type'] ) : 'post';
					if ( '' === $pt || 'all' === $pt ) {
						$target  = 'any';
						$summary = 'all singular content';
					} elseif ( 'front' === $pt ) {
						$target  = 'front';
						$summary = 'the front page';
					} else {
						if ( ! post_type_exists( $pt ) ) {
							return new \WP_Error( 'uich_bad_post_type', 'placement.post_type "' . $pt . '" is not a registered post type.' );
						}
						$target  = 'pt:' . $pt;
						$summary = 'all "' . $pt . '" posts';
					}
					$scope      = ( $include || $exclude ) ? 'specific' : 'entire';
					$conditions = array( 'scope' => $scope, 'include' => $include, 'exclude' => $exclude );  // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_exclude -- Small admin-scoped exclusion list.
					if ( 'specific' === $scope ) {
						$summary .= ' (narrowed to specific IDs)';
					}
					return array( 'conditions' => $conditions, 'target' => $target, 'summary' => $summary );

				case 'archive':
					$arch = isset( $placement['archive'] ) ? trim( (string) $placement['archive'] ) : 'blog';
					if ( '' === $arch || 'all' === $arch ) {
						return array( 'conditions' => array( 'scope' => 'entire' ), 'target' => 'any', 'summary' => 'all archives' );
					}
					if ( 0 === strpos( $arch, 'tax:' ) ) {
						$tax = sanitize_key( substr( $arch, 4 ) );
						if ( '' === $tax || ! taxonomy_exists( $tax ) ) {
							return new \WP_Error( 'uich_bad_taxonomy', 'placement.archive taxonomy "' . $tax . '" is not registered.' );
						}
						return array( 'conditions' => array( 'scope' => 'entire' ), 'target' => 'tax:' . $tax, 'summary' => '"' . $tax . '" term archives' );
					}
					if ( in_array( $arch, array( 'blog', 'author', 'date' ), true ) ) {
						return array( 'conditions' => array( 'scope' => 'entire' ), 'target' => $arch, 'summary' => $arch . ' archive' );
					}
					return new \WP_Error( 'uich_bad_archive', 'placement.archive must be one of: blog, author, date, tax:{taxonomy}, all.' );

				// Whole-context types: single_product, product_archive, search, error_404.
				default:
					$summaries = array(
						'single_product'  => 'all products',
						'product_archive' => 'the shop / product archives',
						'search'          => 'all search results',
						'error_404'       => 'all 404 pages',
					);
					return array(
						'conditions' => array( 'scope' => 'entire' ),
						'target'     => 'any',
						'summary'    => isset( $summaries[ $type ] ) ? $summaries[ $type ] : 'entire site',
					);
			}
		}

		/**
		 * Ability/MCP — build a DYNAMIC LOOP section: a `{% for item in get_posts({…}) %}`
		 * block whose per-item template binds real data with `{{ item.* }}` Twig
		 * expressions. This is the dynamic equivalent of a static listing/grid — a
		 * blog roll, a product grid, a team list, a category menu.
		 *
		 * The rendering engine (Uich_Dynamic / Uich_Twig + Uich_Functions) already
		 * runs this markup; this method just composes + validates it (mirroring the
		 * composer's Construct-tab buildForArgs) and either appends it to a page as a
		 * section (when a post_id is given) or returns the composed markup for the
		 * caller to place into any page / section / theme-builder template.
		 *
		 * @param array $payload Loop config + per-item template.
		 * @return array|\WP_Error
		 */
		public static function create_dynamic_loop_section( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$sources = array(
				'posts'    => array( 'fn' => 'get_posts', 'alias' => 'post' ),
				'products' => array( 'fn' => 'get_products', 'alias' => 'product' ),
				'terms'    => array( 'fn' => 'get_terms', 'alias' => 'term' ),
				'users'    => array( 'fn' => 'get_users', 'alias' => 'user' ),
				'api'      => array( 'fn' => 'get_api', 'alias' => 'item' ),
			);

			$source = isset( $payload['source'] ) ? sanitize_key( (string) $payload['source'] ) : 'posts';
			if ( ! isset( $sources[ $source ] ) ) {
				return new \WP_Error( 'uich_bad_loop_source', 'source must be one of: ' . implode( ', ', array_keys( $sources ) ) . '.' );
			}

			$item_html = isset( $payload['item_html'] ) ? (string) $payload['item_html'] : '';
			if ( '' === trim( $item_html ) ) {
				return new \WP_Error( 'uich_empty_item_template', 'item_html (the per-item template) is required use {{ ' . $sources[ $source ]['alias'] . '.title }} etc. to bind fields.' );
			}

			$alias = isset( $payload['item_alias'] ) && '' !== trim( (string) $payload['item_alias'] )
				? preg_replace( '/[^a-zA-Z0-9_]/', '', (string) $payload['item_alias'] )
				: $sources[ $source ]['alias'];
			if ( '' === $alias ) {
				$alias = $sources[ $source ]['alias'];
			}

			$query = isset( $payload['query'] ) && is_array( $payload['query'] ) ? $payload['query'] : array();

			// WooCommerce gate for products.
			if ( 'products' === $source && ! class_exists( 'WooCommerce' ) ) {
				return new \WP_Error( 'uich_woocommerce_missing', 'WooCommerce must be active to loop over products.' );
			}

			// Compose + validate the loop args string.
			$args = self::build_loop_args_string( $source, $query );
			if ( is_wp_error( $args ) ) {
				return $args;
			}

			// Assemble the full markup: [wrapper_start] {% for … %} item [{% else %} empty] {% endfor %} [wrapper_end].
			$empty_html    = isset( $payload['empty_html'] ) ? (string) $payload['empty_html'] : '';
			$wrapper_start = isset( $payload['wrapper_start'] ) ? (string) $payload['wrapper_start'] : '';
			$wrapper_end   = isset( $payload['wrapper_end'] ) ? (string) $payload['wrapper_end'] : '';

			$loop  = '{% for ' . $alias . ' in ' . $sources[ $source ]['fn'] . '(' . $args . ') %}' . "\n";
			$loop .= $item_html . "\n";
			if ( '' !== trim( $empty_html ) ) {
				$loop .= '{% else %}' . "\n" . $empty_html . "\n";
			}
			$loop .= '{% endfor %}';

			$markup = $wrapper_start . "\n" . $loop . "\n" . $wrapper_end;
			$markup = trim( $markup );

			$css = isset( $payload['item_css'] ) ? (string) $payload['item_css'] : '';
			$js  = isset( $payload['js'] ) ? (string) $payload['js'] : '';

			// Write mode A — append to an existing page as a section.
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( $post_id ) {
				$result = self::mcp_add_section_to_page(
					array(
						'post_id'       => $post_id,
						'label'         => isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : ( ucfirst( $source ) . ' Loop' ),
						'source'        => isset( $payload['source_label'] ) ? sanitize_text_field( (string) $payload['source_label'] ) : 'mcp',
						'html'          => $markup,
						'css'           => $css,
						'js'            => $js,
						'upload_images' => isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true,
					)
				);
				if ( is_wp_error( $result ) ) {
					return $result;
				}
				$result['loop_expr'] = $loop;
				$result['mode']      = 'appended_to_page';
				$result['message']   = 'Dynamic ' . $source . ' loop appended to page ' . $post_id . '.';
				return $result;
			}

			// Write mode B — return the composed markup for the caller to place.
			return array(
				'mode'      => 'composed',
				'source'    => $source,
				'alias'     => $alias,
				'html'      => $markup,
				'css'       => $css,
				'js'        => $js,
				'loop_expr' => $loop,
				'message'   => 'Dynamic ' . $source . ' loop composed. Pass "html" into create_uichemy_composer_page / add_uichemy_composer_section / a theme-builder template body.',
			);
		}

		/**
		 * Build the argument object string for a loop source, mirroring the
		 * composer Construct-tab buildForArgs(). Validates post types / taxonomies
		 * and caps the item count. Returns the "{ … }" string or a WP_Error.
		 *
		 * @param string $source One of posts|products|terms|users|api.
		 * @param array  $query  Structured query config.
		 * @return string|\WP_Error
		 */
		private static function build_loop_args_string( $source, $query ) {
			$query = is_array( $query ) ? $query : array();

			$q       = static function ( $s ) { return "'" . str_replace( "'", "\\'", (string) $s ) . "'"; };
			$id_list = static function ( $list ) {
				if ( ! is_array( $list ) ) {
					$list = preg_split( '/[,\s]+/', (string) $list );
				}
				return array_values( array_unique( array_filter( array_map( 'absint', (array) $list ) ) ) );
			};

			$count       = isset( $query['count'] ) ? max( 1, min( 100, (int) $query['count'] ) ) : ( 'products' === $source ? 12 : 9 );
			$orderby_in  = isset( $query['orderby'] ) ? sanitize_key( (string) $query['orderby'] ) : 'date';
			$orderby_ok  = array( 'date', 'title', 'menu_order', 'rand', 'id', 'name', 'count', 'modified' );
			$orderby     = in_array( $orderby_in, $orderby_ok, true ) ? ( 'id' === $orderby_in ? 'ID' : $orderby_in ) : 'date';
			$order       = ( isset( $query['order'] ) && 'ASC' === strtoupper( (string) $query['order'] ) ) ? 'ASC' : 'DESC';

			$p = array();

			if ( 'posts' === $source || 'products' === $source ) {
				if ( 'posts' === $source ) {
					$post_type = isset( $query['post_type'] ) ? sanitize_key( (string) $query['post_type'] ) : 'post';
					if ( ! post_type_exists( $post_type ) ) {
						return new \WP_Error( 'uich_bad_post_type', 'query.post_type "' . $post_type . '" is not a registered post type.' );
					}
					$p[] = 'post_type: ' . $q( $post_type );
				}
				$p[] = 'posts_per_page: ' . $count;
				$p[] = 'orderby: ' . $q( $orderby );
				$p[] = 'order: ' . $q( $order );

				// Taxonomy filter.
				$default_tax = ( 'products' === $source ) ? 'product_cat' : 'category';
				$taxonomy    = isset( $query['taxonomy'] ) ? sanitize_key( (string) $query['taxonomy'] ) : $default_tax;
				$terms       = isset( $query['terms'] ) ? $query['terms'] : '';
				$slugs       = is_array( $terms ) ? $terms : preg_split( '/\s*,\s*/', (string) $terms );
				$slugs       = array_values( array_filter( array_map( 'sanitize_title', (array) $slugs ) ) );
				if ( ! empty( $slugs ) ) {
					if ( ! taxonomy_exists( $taxonomy ) ) {
						return new \WP_Error( 'uich_bad_taxonomy', 'query.taxonomy "' . $taxonomy . '" is not registered.' );
					}
					$terms_val = ( count( $slugs ) > 1 )
						? '[ ' . implode( ', ', array_map( $q, $slugs ) ) . ' ]'
						: $q( $slugs[0] );
					$p[] = "tax_query: [ { taxonomy: " . $q( $taxonomy ) . ", field: 'slug', terms: " . $terms_val . ' } ]';
				}

				// Filtering.
				$status = isset( $query['post_status'] ) ? sanitize_key( (string) $query['post_status'] ) : 'publish';
				if ( 'publish' !== $status && in_array( $status, array( 'any', 'draft', 'pending', 'private', 'future' ), true ) ) {
					$p[] = 'post_status: ' . $q( $status );
				}
				$offset = isset( $query['offset'] ) ? (int) $query['offset'] : 0;
				if ( $offset > 0 ) {
					$p[] = 'offset: ' . $offset;
				}
				$inc = $id_list( isset( $query['include'] ) ? $query['include'] : array() );
				if ( ! empty( $inc ) ) {
					$p[] = 'post__in: [ ' . implode( ', ', $inc ) . ' ]';
				}
				$exc = $id_list( isset( $query['exclude'] ) ? $query['exclude'] : array() );
				if ( ! empty( $query['exclude_current'] ) ) {
					$exc[] = 'post.id';
				}
				if ( ! empty( $exc ) ) {
					$p[] = 'post__not_in: [ ' . implode( ', ', $exc ) . ' ]';
				}
				$au = $id_list( isset( $query['author'] ) ? $query['author'] : array() );
				if ( ! empty( $au ) ) {
					$p[] = 'author__in: [ ' . implode( ', ', $au ) . ' ]';
				}

				// Date range.
				$date_relative = array( 'day' => '1 day ago', 'week' => '1 week ago', 'month' => '1 month ago', 'year' => '1 year ago' );
				$date_mode     = isset( $query['date_mode'] ) ? sanitize_key( (string) $query['date_mode'] ) : '';
				if ( 'custom' === $date_mode ) {
					$dq = array();
					if ( ! empty( $query['date_after'] ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $query['date_after'] ) ) {
						$dq[] = 'after: ' . $q( $query['date_after'] );
					}
					if ( ! empty( $query['date_before'] ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $query['date_before'] ) ) {
						$dq[] = 'before: ' . $q( $query['date_before'] );
					}
					if ( ! empty( $dq ) ) {
						$p[] = 'date_query: [ { ' . implode( ', ', $dq ) . ', inclusive: true } ]';
					}
				} elseif ( isset( $date_relative[ $date_mode ] ) ) {
					$p[] = 'date_query: [ { after: ' . $q( $date_relative[ $date_mode ] ) . ' } ]';
				}

				// Single meta clause.
				if ( ! empty( $query['meta_key'] ) ) {
					$cmp_ok  = array( '=', '!=', '>', '>=', '<', '<=', 'LIKE', 'IN', 'EXISTS', 'NOT EXISTS' );
					$cmp     = isset( $query['meta_compare'] ) && in_array( $query['meta_compare'], $cmp_ok, true ) ? $query['meta_compare'] : '=';
					$numeric = in_array( $cmp, array( '>', '>=', '<', '<=' ), true );
					$novalue = ( 'EXISTS' === $cmp || 'NOT EXISTS' === $cmp );
					$parts   = array( 'key: ' . $q( $query['meta_key'] ) );
					if ( ! $novalue && isset( $query['meta_value'] ) && '' !== (string) $query['meta_value'] ) {
						$parts[] = 'value: ' . $q( $query['meta_value'] );
					}
					$parts[] = 'compare: ' . $q( $cmp );
					if ( $numeric ) {
						$parts[] = "type: 'NUMERIC'";
					}
					$p[] = 'meta_query: [ { ' . implode( ', ', $parts ) . ' } ]';
				}

				if ( ! empty( $query['avoid_duplicates'] ) ) {
					$p[] = 'avoid_duplicates: true';
				}
				if ( ! empty( $query['pagination'] ) ) {
					$p[] = 'paged: current_page()';
				}
			} elseif ( 'terms' === $source ) {
				$taxonomy = isset( $query['taxonomy'] ) ? sanitize_key( (string) $query['taxonomy'] ) : 'category';
				if ( ! taxonomy_exists( $taxonomy ) ) {
					return new \WP_Error( 'uich_bad_taxonomy', 'query.taxonomy "' . $taxonomy . '" is not registered.' );
				}
				$p[] = 'taxonomy: ' . $q( $taxonomy );
				$p[] = 'number: ' . $count;
				$p[] = 'orderby: ' . $q( 'name' === $orderby || 'count' === $orderby ? $orderby : 'name' );
				$p[] = 'order: ' . $q( $order );
				$p[] = 'hide_empty: ' . ( isset( $query['hide_empty'] ) && ! $query['hide_empty'] ? 'false' : 'true' );
				if ( isset( $query['parent'] ) && '' !== (string) $query['parent'] && (int) $query['parent'] >= 0 ) {
					$p[] = 'parent: ' . (int) $query['parent'];
				}
			} elseif ( 'users' === $source ) {
				$p[] = 'number: ' . $count;
				if ( ! empty( $query['role'] ) ) {
					$p[] = 'role: ' . $q( sanitize_key( (string) $query['role'] ) );
				}
				$offset = isset( $query['offset'] ) ? (int) $query['offset'] : 0;
				if ( $offset > 0 ) {
					$p[] = 'offset: ' . $offset;
				}
			} elseif ( 'api' === $source ) {
				$url = isset( $query['url'] ) ? esc_url_raw( (string) $query['url'] ) : '';
				if ( '' === $url ) {
					return new \WP_Error( 'uich_missing_api_url', 'query.url is required for an external API loop.' );
				}
				$p[] = 'url: ' . $q( $url );
				if ( ! empty( $query['path'] ) ) {
					$p[] = 'path: ' . $q( (string) $query['path'] );
				}
				if ( ! empty( $query['method'] ) && 'GET' !== strtoupper( (string) $query['method'] ) ) {
					$p[] = 'method: ' . $q( strtoupper( sanitize_key( (string) $query['method'] ) ) );
				}
				$p[] = 'limit: ' . $count;
			}

			return '{ ' . implode( ', ', $p ) . ' }';
		}

		/**
		 * Ability wrapper — create a page with ONE Composer widget per section.
		 *
		 * Maps the ability's friendly field names (site_before_head / page_before_head,
		 * etc.) onto mcp_create_page_with_sections()'s native keys, so each item in the
		 * `sections` array becomes its own Composer widget inside one outer container, in
		 * a single call.
		 *
		 * @param array $payload Ability input.
		 * @return array|\WP_Error
		 */
		public static function create_page_with_sections( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			return self::mcp_create_page_with_sections(
				array(
					'title'         => isset( $payload['title'] ) ? $payload['title'] : '',
					'status'        => isset( $payload['status'] ) ? $payload['status'] : 'draft',
					'source'        => isset( $payload['source'] ) ? $payload['source'] : 'mcp',
					'sections'      => isset( $payload['sections'] ) && is_array( $payload['sections'] ) ? $payload['sections'] : array(),
					'upload_images' => isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true,
					'page_css'      => isset( $payload['page_before_head'] ) ? (string) $payload['page_before_head'] : '',
					'page_js'       => isset( $payload['page_before_body'] ) ? (string) $payload['page_before_body'] : '',
					'site_css'      => isset( $payload['site_before_head'] ) ? (string) $payload['site_before_head'] : '',
					'site_js'       => isset( $payload['site_before_body'] ) ? (string) $payload['site_before_body'] : '',
				)
			);
		}

		/**
		 * MCP — create a single WordPress page populated with MULTIPLE Composer widgets,
		 * one per detected design section (header, hero, features, footer, etc.).
		 *
		 * All section widgets are placed inside ONE outer Elementor container, stacked
		 * top-to-bottom in the order they were given.
		 *
		 * Expected payload:
		 *   - title    string
		 *   - status   string  draft|publish|private
		 *   - source   string  source label written into code tags
		 *   - sections array<array{ label:string, html:string, css:string, js?:string }>
		 *
		 * @param array $payload Page + sections payload.
		 * @return array|\WP_Error
		 */
		public static function mcp_create_page_with_sections( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$title  = isset( $payload['title'] ) ? sanitize_text_field( (string) $payload['title'] ) : 'UiChemy AI Landing Page';
			$status = isset( $payload['status'] ) ? sanitize_key( (string) $payload['status'] ) : 'draft';
			$status = in_array( $status, array( 'draft', 'publish', 'private' ), true ) ? $status : 'draft';
			$source = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';

			$sections      = isset( $payload['sections'] ) && is_array( $payload['sections'] ) ? $payload['sections'] : array();
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;
			$page_css      = isset( $payload['page_css'] ) ? (string) $payload['page_css'] : '';
			$page_js       = isset( $payload['page_js'] ) ? (string) $payload['page_js'] : '';
			$site_css      = isset( $payload['site_css'] ) ? (string) $payload['site_css'] : '';
			$site_js       = isset( $payload['site_js'] ) ? (string) $payload['site_js'] : '';

			if ( empty( $sections ) ) {
				return new \WP_Error( 'uich_no_sections', 'At least one section is required.' );
			}

			$post_attributes = array(
				'post_title'  => $title,
				'post_type'   => self::mcp_resolve_post_type( $payload ),
				'post_status' => $status,
			);

			// Elementor's document type stays 'page' whatever the post type is: it
			// selects the wp-page editing experience (no theme-builder conditions),
			// which is what a Composer-built post wants too.
			$document = \Elementor\Plugin::$instance->documents->create( 'page', $post_attributes );
			if ( is_wp_error( $document ) ) {
				return new \WP_Error( 'uich_page_create_failed', $document->get_error_message() );
			}

			$post_id = $document->get_main_id();
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_page_create_failed', 'Failed to create Elementor page document.' );
			}

			// Persist site-level CSS/JS before creating page widgets.
			self::mcp_append_site_custom_code( $site_css, $site_js );

			$widget_elements  = array();
			$widgets_meta     = array();
			$image_uploads    = array();
			$image_failures   = array();
			$outer_container_id = strtolower( wp_generate_password( 7, false, false ) );
			$first_widget_index = null;

			foreach ( $sections as $index => $section ) {
				if ( ! is_array( $section ) ) {
					continue;
				}

				$section_label = isset( $section['label'] ) ? sanitize_text_field( (string) $section['label'] ) : ( 'Section ' . ( $index + 1 ) );
				$section_html  = isset( $section['html'] ) ? (string) $section['html'] : '';
				$section_css   = isset( $section['css'] ) ? (string) $section['css'] : '';
				$section_js    = isset( $section['js'] ) ? (string) $section['js'] : '';

				if ( '' === trim( $section_html ) && '' === trim( $section_css ) && '' === trim( $section_js ) ) {
					// Skip empty section, but record so caller knows.
					$widgets_meta[] = array(
						'index'   => $index,
						'label'   => $section_label,
						'skipped' => true,
						'reason'  => 'empty section payload',
					);
					continue;
				}

				if ( $upload_images ) {
					$media_result   = self::mcp_upload_html_images_to_media_library( $section_html, $section_css );
					$section_html   = $media_result['html'];
					if ( isset( $media_result['css'] ) ) {
						$section_css = (string) $media_result['css'];
					}
					$image_uploads  = array_merge( $image_uploads, $media_result['uploaded'] );
					$image_failures = array_merge( $image_failures, $media_result['failed'] );
				}

				$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $section_html, $section_css );
				$section_html     = $globals_prepared['html'];
				$section_css      = $globals_prepared['css'];

				$widget_id       = strtolower( wp_generate_password( 7, false, false ) );
				$widget_settings = array(
					'_title'   => $section_label,
					'raw_html' => self::build_mcp_tagged_code_block( 'html', $section_html, $source, $section_label ),
					'raw_css'  => self::build_mcp_tagged_code_block( 'css', $section_css, $source, $section_label ),
					'raw_js'   => self::build_mcp_tagged_code_block( 'js', $section_js, $source, $section_label ),
				);

				// Attach page-level CSS/JS to the first real widget only.
				if ( null === $first_widget_index ) {
					$first_widget_index = count( $widget_elements );
					if ( '' !== trim( $page_css ) ) {
						$widget_settings['page_custom_code_head'] = self::mcp_ensure_style_tag( $page_css );
					}
					if ( '' !== trim( $page_js ) ) {
						$widget_settings['page_custom_code_footer'] = self::mcp_ensure_script_tag( $page_js );
					}
				}

				$widget_elements[] = array(
					'id'         => $widget_id,
					'elType'     => 'widget',
					'widgetType' => 'uichemy-composer',
					'settings'   => $widget_settings,
					'elements'   => array(),
				);

				$widgets_meta[] = array(
					'index'                   => $index,
					'label'                   => $section_label,
					'widget_id'               => $widget_id,
					'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				);
			}

			if ( empty( $widget_elements ) ) {
				wp_delete_post( $post_id, true );
				return new \WP_Error( 'uich_all_sections_empty', 'All sections were empty page not created.' );
			}

			// Wrap all section widgets inside a single outer container.
			$elements = array(
				array(
					'id'       => $outer_container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => self::mcp_widget_container_default_settings( array( '_title' => $title ) ),
					'elements' => $widget_elements,
				),
			);

			self::mcp_sync_page_custom_code_across_widgets( $elements );

			$save_payload = array(
				'elements' => $elements,
				'settings' => array(),
			);

			try {
				$document->save( $save_payload );
			} catch ( \Throwable $e ) {
				// Continue to explicit meta writes below.
			}

			self::apply_dynamic_tag_bindings( $elements ); // opt-in: {{ tokens }} → bound dynamic tags
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
			update_post_meta( $post_id, '_elementor_page_settings', array() );
			update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );

			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'        => $post_id,
				'title'          => get_the_title( $post_id ),
				'status'         => get_post_status( $post_id ),
				'container_id'   => $outer_container_id,
				'sections_count' => count( $widget_elements ),
				'widgets'        => $widgets_meta,
				'edit_link'      => get_edit_post_link( $post_id, 'internal' ),
				'elementor_link' => add_query_arg(
					array(
						'post'   => $post_id,
						'action' => 'elementor',
					),
					admin_url( 'post.php' )
				),
				'preview_link'   => get_permalink( $post_id ),
				'image_uploads'  => $image_uploads,
				'image_failures' => $image_failures,
				'message'        => sprintf( 'New page created with 1 container holding %d Composer widget section(s).', count( $widget_elements ) ),
			);
		}

		/**
		 * Find a container that already has (or is ready for) Composer widgets and append the widget.
		 *
		 * @param array  $elements     Elementor elements tree (by reference).
		 * @param array  $new_widget   New composer element.
		 * @param string $container_id Output: container element id when appended.
		 * @return bool True if appended into an existing container branch.
		 */
		private static function mcp_append_widget_to_section_container( array &$elements, array $new_widget, &$container_id ) {
			foreach ( $elements as &$el ) {
				if ( ! is_array( $el ) || ! isset( $el['elType'] ) ) {
					continue;
				}

				if ( 'container' === $el['elType'] ) {
					$children = isset( $el['elements'] ) && is_array( $el['elements'] ) ? $el['elements'] : array();
					$has_widget = false;
					foreach ( $children as $child ) {
						if ( uichemy_is_composer_widget_node( $child ) ) {
							$has_widget = true;
							break;
						}
					}
					if ( $has_widget || empty( $children ) ) {
						if ( ! isset( $el['elements'] ) || ! is_array( $el['elements'] ) ) {
							$el['elements'] = array();
						}
						$el['elements'][] = $new_widget;
						$container_id     = isset( $el['id'] ) ? (string) $el['id'] : '';
						unset( $el );
						return true;
					}
				}

				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					if ( self::mcp_append_widget_to_section_container( $el['elements'], $new_widget, $container_id ) ) {
						unset( $el );
						return true;
					}
				}
			}
			unset( $el );
			return false;
		}

		/**
		 * MCP — append ONE new Composer widget to an existing page that already has a container.
		 *
		 * Used in the sequential multi-widget flow: after the first section creates the page
		 * via mcp_create_page_with_generated_code, every subsequent section calls this method
		 * to append a new widget inside the same outer container — no new containers are created.
		 *
		 * Expected payload:
		 *   - post_id  int     Existing page post ID
		 *   - label    string  Section label shown in Elementor navigator
		 *   - html     string  Section HTML
		 *   - css      string  Section CSS
		 *   - js       string  Section JS (optional)
		 *   - source   string  Source tag label (optional)
		 *
		 * @param array $payload Section payload.
		 * @return array|\WP_Error
		 */
		public static function mcp_add_section_to_page( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'A valid post_id is required.' );
			}

			$label    = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : 'Section';
			$source   = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';
			$html     = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$css      = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$js       = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$page_css = isset( $payload['page_css'] ) ? (string) $payload['page_css'] : '';
			$page_js  = isset( $payload['page_js'] ) ? (string) $payload['page_js'] : '';
			$site_css = isset( $payload['site_css'] ) ? (string) $payload['site_css'] : '';
			$site_js  = isset( $payload['site_js'] ) ? (string) $payload['site_js'] : '';

			if ( '' === trim( $html ) && '' === trim( $css ) && '' === trim( $js ) ) {
				return new \WP_Error( 'uich_empty_section', 'At least one of html, css, or js must be provided.' );
			}

			// Upload any external images embedded in the HTML (only when explicitly requested).
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;
			if ( $upload_images ) {
				$media_result = self::mcp_upload_html_images_to_media_library( $html, $css );
				$html         = $media_result['html'];
				if ( isset( $media_result['css'] ) ) {
					$css = (string) $media_result['css'];
				}
			} else {
				$media_result = array( 'html' => $html, 'uploaded' => array(), 'failed' => array() );
			}

			$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $html, $css );
			$html             = $globals_prepared['html'];
			$css              = $globals_prepared['css'];

			// Persist site-level CSS/JS to global option.
			self::mcp_append_site_custom_code( $site_css, $site_js );

			// Read the existing Elementor data.
			$elementor_data_raw = get_post_meta( $post_id, '_elementor_data', true );
			if ( ! is_string( $elementor_data_raw ) || '' === $elementor_data_raw ) {
				return new \WP_Error( 'uich_missing_elementor_data', 'No Elementor data found on the provided post.' );
			}

			$elements = json_decode( $elementor_data_raw, true );
			if ( ! is_array( $elements ) ) {
				return new \WP_Error( 'uich_invalid_elementor_data', 'Elementor data is not valid JSON.' );
			}

			// Build the new widget element.
			$widget_id       = strtolower( wp_generate_password( 7, false, false ) );
			$widget_settings = array(
				'_title'   => $label,
				'raw_html' => self::build_mcp_tagged_code_block( 'html', $html, $source, $label ),
				'raw_css'  => self::build_mcp_tagged_code_block( 'css', $css, $source, $label ),
				'raw_js'   => self::build_mcp_tagged_code_block( 'js', $js, $source, $label ),
			);
			$page_css_trim = trim( (string) $page_css );
			$page_js_trim  = trim( (string) $page_js );
			if ( '' !== $page_css_trim || '' !== $page_js_trim ) {
				$merged_into_first = self::mcp_merge_page_custom_code_into_first_widget( $elements, $page_css_trim, $page_js_trim );
				if ( ! $merged_into_first ) {
					if ( '' !== $page_css_trim ) {
						$widget_settings['page_custom_code_head'] = self::mcp_ensure_style_tag( $page_css_trim );
					}
					if ( '' !== $page_js_trim ) {
						$widget_settings['page_custom_code_footer'] = self::mcp_ensure_script_tag( $page_js_trim );
					}
				}
			}
			$new_widget = array(
				'id'         => $widget_id,
				'elType'     => 'widget',
				'widgetType' => 'uichemy-composer',
				'settings'   => $widget_settings,
				'elements'   => array(),
			);

			// Append into the same outer container that already holds Composer sections
			// (depth-first: supports section/column wrappers from other Elementor layouts).
			$container_id = '';
			$appended     = self::mcp_append_widget_to_section_container( $elements, $new_widget, $container_id );

			if ( ! $appended ) {
				$container_id = strtolower( wp_generate_password( 7, false, false ) );
				$elements[]   = array(
					'id'       => $container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => self::mcp_widget_container_default_settings(),
					'elements' => array( $new_widget ),
				);
			}

			self::mcp_sync_page_custom_code_across_widgets( $elements );

			$document = \Elementor\Plugin::$instance->documents->get_doc_or_auto_save( $post_id );
			if ( $document ) {
				try {
					$document->save(
						array(
							'elements' => $elements,
						)
					);
				} catch ( \Throwable $e ) {
					// Meta write below still applies structure.
				}
			}

			// Persist and clear cache.
			self::apply_dynamic_tag_bindings( $elements ); // opt-in: {{ tokens }} → bound dynamic tags
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );

			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'        => $post_id,
				'widget_id'      => $widget_id,
				'container_id'   => $container_id,
				'label'          => $label,
				'appended'       => $appended,
				'edit_link'      => get_edit_post_link( $post_id, 'internal' ),
				'elementor_link' => add_query_arg(
					array(
						'post'   => $post_id,
						'action' => 'elementor',
					),
					admin_url( 'post.php' )
				),
				'preview_link'   => get_permalink( $post_id ),
				'image_uploads'  => $media_result['uploaded'],
				'image_failures' => $media_result['failed'],
				'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				'message'        => "Section \"{$label}\" appended to page {$post_id}.",
			);
		}

		// ============================================================
		// MCP — SECTION READ / WRITE / INSERT BY INDEX
		// ============================================================

		/**
		 * Recursively collect all composer widgets from an Elementor element tree.
		 *
		 * @param array  $elements Elementor elements (top-level array from _elementor_data).
		 * @param array &$widgets  Accumulated widget elements (passed by reference).
		 */
		private static function collect_uichemy_composer_widgets( array $elements, array &$widgets ) {
			foreach ( $elements as $el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				if ( isset( $el['elType'] ) && 'widget' === $el['elType']
					&& uichemy_is_composer_widget_type( $el['widgetType'] ) ) {
					$widgets[] = $el;
				}
				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					self::collect_uichemy_composer_widgets( $el['elements'], $widgets );
				}
			}
		}

		/**
		 * MCP — get the HTML/CSS/JS from a specific Composer widget by 0-based index.
		 *
		 * @param int $post_id      Post ID.
		 * @param int $widget_index 0-based index among all composer widgets on the page.
		 * @return array|\WP_Error
		 */
		public static function mcp_get_section_code( $post_id, $widget_index = 0, $element_id = '', $include_site_code = true ) {
			$post_id      = absint( $post_id );
			$widget_index = (int) $widget_index;
			$element_id   = (string) $element_id;
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}

			$raw = get_post_meta( $post_id, '_elementor_data', true );
			if ( ! is_string( $raw ) || '' === $raw ) {
				return new \WP_Error( 'uich_missing_elementor_data', 'No Elementor data found for this post.' );
			}

			$elements = json_decode( $raw, true );
			if ( ! is_array( $elements ) ) {
				return new \WP_Error( 'uich_invalid_elementor_data', 'Elementor data is not valid JSON.' );
			}

			$widgets = array();
			self::collect_uichemy_composer_widgets( $elements, $widgets );

			if ( empty( $widgets ) ) {
				return new \WP_Error( 'uich_no_widgets', 'No Composer widgets found on this post.' );
			}

			$total = count( $widgets );

			// Prefer an exact element-id match (robust against DOM-vs-data ordering);
			// fall back to positional widget_index when no id is supplied.
			if ( '' !== $element_id ) {
				$widget = null;
				foreach ( $widgets as $i => $w ) {
					if ( isset( $w['id'] ) && (string) $w['id'] === $element_id ) {
						$widget       = $w;
						$widget_index = (int) $i;
						break;
					}
				}
				if ( null === $widget ) {
					return new \WP_Error( 'uich_widget_not_found', "No Composer widget with id \"{$element_id}\" on this post." );
				}
			} else {
				if ( $widget_index < 0 || $widget_index >= $total ) {
					return new \WP_Error(
						'uich_invalid_widget_index',
						"widget_index {$widget_index} is out of range found {$total} widget(s) (indices 0–" . ( $total - 1 ) . ').'
					);
				}
				$widget = $widgets[ $widget_index ];
			}
			$settings = isset( $widget['settings'] ) && is_array( $widget['settings'] ) ? $widget['settings'] : array();

			$response = array(
				'post_id'                => $post_id,
				'widget_id'              => isset( $widget['id'] ) ? (string) $widget['id'] : '',
				'widget_index'           => $widget_index,
				'total_widgets'          => $total,
				'label'                  => isset( $settings['_title'] ) ? (string) $settings['_title'] : '',
				'html'                   => isset( $settings['raw_html'] ) ? (string) $settings['raw_html'] : '',
				'css'                    => isset( $settings['raw_css'] ) ? (string) $settings['raw_css'] : '',
				'js'                     => isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '',
				// Page code is per-widget and small, so it is always returned.
				'page_custom_code_head'   => isset( $settings['page_custom_code_head'] ) ? (string) $settings['page_custom_code_head'] : '',
				'page_custom_code_footer' => isset( $settings['page_custom_code_footer'] ) ? (string) $settings['page_custom_code_footer'] : '',
			);

			// Site-wide custom code is the single site-wide <style>/<script> option and
			// can be ~130 KB, so echoing it on every per-widget read blows automation
			// token caps. It is included ONLY when the caller opts in ($include_site_code).
			// The editor Page/Site Code panes (composer-code.jsx PagePanes/SitePanes) need
			// it: the editor gets it from Elementor's Backbone model directly, and the
			// frontend bridge (class-uichemy-frontend-rest.php handle_get) requests it
			// explicitly with include_site_code=true, so those panes never render blank.
			// The MCP tool (find_and_update_section_code) defaults to false to stay lean.
			if ( $include_site_code ) {
				$site_code = self::get_site_custom_code_option();
				$response['site_custom_code_head']   = $site_code['head'];
				$response['site_custom_code_footer'] = $site_code['footer'];
			}

			return $response;
		}

		/**
		 * Every Composer widget on a post, with its code, in ONE pass.
		 *
		 * The front-end editor uses this to warm a client-side cache when the page
		 * loads, so hovering and switching between sections costs no requests at all.
		 * Calling mcp_get_section_code() in a loop would re-read and re-decode the
		 * post's `_elementor_data` once per widget (up to 21 on real pages here);
		 * this decodes and walks the tree exactly once.
		 *
		 * Site-wide custom code is returned ONCE at the top level rather than on each
		 * widget — it is a single site-wide option and can run to ~130 KB, so copying
		 * it per widget would dwarf the actual payload.
		 *
		 * @param int  $post_id           Post holding the Elementor data.
		 * @param bool $include_site_code Include the site-wide custom code block.
		 * @return array|\WP_Error
		 */
		public static function mcp_get_all_section_code( $post_id, $include_site_code = true ) {
			$post_id = absint( $post_id );
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}

			$raw = get_post_meta( $post_id, '_elementor_data', true );
			if ( ! is_string( $raw ) || '' === $raw ) {
				return new \WP_Error( 'uich_missing_elementor_data', 'No Elementor data found for this post.' );
			}

			$elements = json_decode( $raw, true );
			if ( ! is_array( $elements ) ) {
				return new \WP_Error( 'uich_invalid_elementor_data', 'Elementor data is not valid JSON.' );
			}

			$widgets = array();
			self::collect_uichemy_composer_widgets( $elements, $widgets );

			$out = array();
			foreach ( $widgets as $i => $widget ) {
				$settings = isset( $widget['settings'] ) && is_array( $widget['settings'] ) ? $widget['settings'] : array();
				$out[]    = array(
					'widget_id'               => isset( $widget['id'] ) ? (string) $widget['id'] : '',
					'widget_index'            => (int) $i,
					'label'                   => isset( $settings['_title'] ) ? (string) $settings['_title'] : '',
					'html'                    => isset( $settings['raw_html'] ) ? (string) $settings['raw_html'] : '',
					'css'                     => isset( $settings['raw_css'] ) ? (string) $settings['raw_css'] : '',
					'js'                      => isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '',
					'page_custom_code_head'   => isset( $settings['page_custom_code_head'] ) ? (string) $settings['page_custom_code_head'] : '',
					'page_custom_code_footer' => isset( $settings['page_custom_code_footer'] ) ? (string) $settings['page_custom_code_footer'] : '',
				);
			}

			$response = array(
				'post_id'       => $post_id,
				'total_widgets' => count( $out ),
				'widgets'       => $out,
			);

			if ( $include_site_code ) {
				$site_code                           = self::get_site_custom_code_option();
				$response['site_custom_code_head']   = $site_code['head'];
				$response['site_custom_code_footer'] = $site_code['footer'];
			}

			return $response;
		}

		/**
		 * Recursively find the first container that holds composer widgets (or is empty)
		 * and insert a new widget element at the given 0-based index within it.
		 *
		 * @param array  &$elements    Elementor elements (by reference).
		 * @param array   $new_widget  Widget element to insert.
		 * @param int     $index       Target 0-based position (clamped to valid range).
		 * @param bool   &$inserted    Set to true once inserted.
		 * @param string &$container_id Set to the container id when found.
		 */
		private static function insert_widget_at_index_in_container( array &$elements, array $new_widget, $index, &$inserted, &$container_id ) {
			foreach ( $elements as &$el ) {
				if ( ! is_array( $el ) || ! isset( $el['elType'] ) ) {
					continue;
				}
				if ( 'container' === $el['elType'] ) {
					$children    = isset( $el['elements'] ) && is_array( $el['elements'] ) ? $el['elements'] : array();
					$has_uichemy = false;
					foreach ( $children as $child ) {
						if ( uichemy_is_composer_widget_node( $child ) ) {
							$has_uichemy = true;
							break;
						}
					}
					if ( $has_uichemy || empty( $children ) ) {
						if ( ! isset( $el['elements'] ) || ! is_array( $el['elements'] ) ) {
							$el['elements'] = array();
						}
						$clamped      = max( 0, min( $index, count( $el['elements'] ) ) );
						array_splice( $el['elements'], $clamped, 0, array( $new_widget ) );
						$container_id = isset( $el['id'] ) ? (string) $el['id'] : '';
						$inserted     = true;
						unset( $el );
						return;
					}
				}
				if ( ! $inserted && ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					self::insert_widget_at_index_in_container( $el['elements'], $new_widget, $index, $inserted, $container_id );
					if ( $inserted ) {
						unset( $el );
						return;
					}
				}
			}
			unset( $el );
		}

		/**
		 * MCP — insert a new Composer widget at a specific 0-based index within the page
		 * layout. Unlike mcp_add_section_to_page (always appends), this allows precise positioning.
		 *
		 * Payload keys: post_id, insert_index, label, html, css, js, source, upload_images.
		 *
		 * @param array $payload
		 * @return array|\WP_Error
		 */
		public static function mcp_insert_section_at_index( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$post_id       = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$insert_index  = isset( $payload['insert_index'] ) ? (int) $payload['insert_index'] : 0;
			$label         = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : 'Section';
			$source        = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';
			$html          = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$css           = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$js            = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;

			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}
			if ( '' === trim( $html ) && '' === trim( $css ) ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least html or css must be provided.' );
			}

			// Document::save() publishes as a side effect; capture to restore after.
			$status_before_save = get_post_status( $post_id );

			// Upload images
			if ( $upload_images && '' !== trim( $html ) ) {
				$media_result = self::mcp_upload_html_images_to_media_library( $html, $css );
				$html         = $media_result['html'];
				if ( isset( $media_result['css'] ) ) {
					$css = (string) $media_result['css'];
				}
			} else {
				$media_result = array( 'uploaded' => array(), 'failed' => array() );
			}

			// Apply globals matching
			$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $html, $css );
			$html = $globals_prepared['html'];
			$css  = $globals_prepared['css'];

			// Read existing Elementor data
			$raw = get_post_meta( $post_id, '_elementor_data', true );
			if ( ! is_string( $raw ) || '' === $raw ) {
				return new \WP_Error( 'uich_missing_elementor_data', 'No Elementor data found for this post.' );
			}
			$elements = json_decode( $raw, true );
			if ( ! is_array( $elements ) ) {
				return new \WP_Error( 'uich_invalid_elementor_data', 'Elementor data is not valid JSON.' );
			}

			// Build new widget element
			$widget_id  = strtolower( wp_generate_password( 7, false, false ) );
			$new_widget = array(
				'id'         => $widget_id,
				'elType'     => 'widget',
				'widgetType' => 'uichemy-composer',
				'settings'   => array(
					'_title'   => $label,
					'raw_html' => self::build_mcp_tagged_code_block( 'html', $html, $source, $label ),
					'raw_css'  => self::build_mcp_tagged_code_block( 'css', $css, $source, $label ),
					'raw_js'   => self::build_mcp_tagged_code_block( 'js', $js, $source, $label ),
				),
				'elements'   => array(),
			);

			// Insert into the existing composer container at the requested index
			$inserted     = false;
			$container_id = '';
			self::insert_widget_at_index_in_container( $elements, $new_widget, $insert_index, $inserted, $container_id );

			if ( ! $inserted ) {
				// No suitable container found — create a new top-level container with the widget
				$container_id  = strtolower( wp_generate_password( 7, false, false ) );
				$new_container = array(
					'id'       => $container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => self::mcp_widget_container_default_settings(),
					'elements' => array( $new_widget ),
				);
				$clamped = max( 0, min( $insert_index, count( $elements ) ) );
				array_splice( $elements, $clamped, 0, array( $new_container ) );
			}

			// Save via Elementor document API (with direct meta fallback)
			$document = \Elementor\Plugin::$instance->documents->get_doc_or_auto_save( $post_id );
			if ( $document ) {
				try {
					$document->save( array( 'elements' => $elements ) );
				} catch ( \Throwable $e ) {
					// Meta write below still applies structure.
				}
				self::mcp_restore_post_status( $post_id, $status_before_save );
			}

			self::apply_dynamic_tag_bindings( $elements ); // opt-in: {{ tokens }} → bound dynamic tags
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );

			if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'                 => $post_id,
				'widget_id'               => $widget_id,
				'container_id'            => $container_id,
				'insert_index'            => $insert_index,
				'label'                   => $label,
				'edit_link'               => get_edit_post_link( $post_id, 'internal' ),
				'elementor_link'          => add_query_arg(
					array(
						'post'   => $post_id,
						'action' => 'elementor',
					),
					admin_url( 'post.php' )
				),
				'preview_link'            => get_permalink( $post_id ),
				'image_uploads'           => $media_result['uploaded'],
				'image_failures'          => $media_result['failed'],
				'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				'message'                 => "Section \"{$label}\" inserted at index {$insert_index} on page {$post_id}.",
			);
		}

		/**
		 * Resolve a single external image URL via the media library, with de-dupe cache + logs.
		 *
		 * @param string              $original_url Original URL.
		 * @param array<string,string> $url_cache    Map original → resolved (by ref).
		 * @param array<int,array<string,string>> $uploaded Successful uploads (by ref).
		 * @param array<int,array<string,string>> $failed   Failures (by ref).
		 * @return string Resolved URL (may equal original on failure).
		 */
		private static function mcp_resolve_external_image_url_for_mcp_import( $original_url, array &$url_cache, array &$uploaded, array &$failed ) {
			// NOTE: callers pass an already-decoded value. DOM getAttribute() decodes
			// entities for us, so decoding again here corrupted the URL before it was
			// ever fetched — "img&amp;copy;2024.jpg" arrives as "img&copy;2024.jpg"
			// and a second pass turned it into "img©2024.jpg". The CSS rewriter reads
			// raw text out of a regex, so it does its own decode before calling.
			$original_url = trim( (string) $original_url );
			if ( '' === $original_url ) {
				return '';
			}

			// A dynamic-data token is not a URL. Fetching it always fails and pollutes
			// the import's "failed" manifest with an entry that was never an image.
			// '' means "leave the value exactly as it is" — every caller honours that.
			if ( false !== strpos( $original_url, '{{' ) || false !== strpos( $original_url, '{%' ) ) {
				return '';
			}

			if ( isset( $url_cache[ $original_url ] ) ) {
				return $url_cache[ $original_url ];
			}

			$uploaded_url = self::mcp_sideload_image_from_url( $original_url );
			if ( is_wp_error( $uploaded_url ) ) {
				// Leave the original attribute untouched rather than rewriting it with
				// a round-tripped copy of itself.
				$url_cache[ $original_url ] = '';
				$failed[]                   = array(
					'from'   => $original_url,
					'error'  => $uploaded_url->get_error_message(),
					'code'   => $uploaded_url->get_error_code(),
					'source' => 'html',
				);
				return '';
			}

			$url_cache[ $original_url ] = $uploaded_url;
			if ( $uploaded_url !== $original_url ) {
				$uploaded[] = array(
					'from' => $original_url,
					'to'   => $uploaded_url,
				);
			}

			return $uploaded_url;
		}

		/**
		 * Rewrite url(...) references inside arbitrary CSS text (widget CSS, inline styles).
		 *
		 * @param string   $css          CSS fragment.
		 * @param array    $url_cache    URL cache (by ref).
		 * @param array    $uploaded     Upload log (by ref).
		 * @param array    $failed       Failure log (by ref).
		 * @return string Rewritten CSS.
		 */
		private static function mcp_rewrite_css_url_functions_with_sideload( $css, array &$url_cache, array &$uploaded, array &$failed ) {
			$css = (string) $css;
			if ( '' === trim( $css ) || ! preg_match( '/\burl\s*\(/i', $css ) ) {
				return $css;
			}

			return (string) preg_replace_callback(
				'/\burl\s*\(\s*([\'"]?)([^\'"()]+)\1\s*\)/i',
				function ( $m ) use ( &$url_cache, &$uploaded, &$failed ) {
					$raw = isset( $m[2] ) ? trim( (string) $m[2] ) : '';
					if ( '' === $raw ) {
						return $m[0];
					}
					// Raw regex text, not DOM output — decode here (the shared resolver
					// no longer decodes, because its DOM callers hand over decoded values).
					$raw   = html_entity_decode( $raw, ENT_QUOTES, 'UTF-8' );
					$lower = strtolower( $raw );
					// Inline data: URIs and in-document #fragments render fine as-is —
					// not a failed import, leave untouched.
					if ( 0 === strpos( $lower, 'data:' ) || 0 === strpos( $raw, '#' ) ) {
						return $m[0];
					}
					// A dynamic-data token resolves at render time; it is neither a
					// fetchable URL nor a missing asset, so don't report it as failed.
					if ( false !== strpos( $raw, '{{' ) || false !== strpos( $raw, '{%' ) ) {
						return $m[0];
					}
					// Fetchable / resolvable: http(s), protocol-relative //, root-relative /.
					if ( preg_match( '#^(https?:)?//#i', $raw ) || 0 === strpos( $raw, '/' ) ) {
						$next = self::mcp_resolve_external_image_url_for_mcp_import( $raw, $url_cache, $uploaded, $failed );
						// '' means "left alone" — keep the declaration byte-for-byte
						// instead of emitting url().
						if ( '' === $next ) {
							return $m[0];
						}
						$q = isset( $m[1] ) ? (string) $m[1] : '';
						return 'url(' . $q . $next . $q . ')';
					}
					// Anything else (blob:, ./assets/x, relative paths) is a local asset
					// the server can't fetch — record it so the caller can surface a
					// "couldn't import" manifest instead of silently shipping a broken url().
					$failed[] = array(
						'from'   => $raw,
						'error'  => 'Local or non-fetchable asset in CSS url() re-home it with request_image_upload before import.',
						'code'   => 'uich_local_asset',
						'source' => 'css',
					);
					return $m[0];
				},
				$css
			);
		}

		/**
		 * Upload externally referenced images to the media library and rewrite URLs in HTML and optional CSS.
		 *
		 * Supports: `<img src>`, `srcset` on `<img>` / `<source>`, `<video>` / `<audio>` /
		 * `<source>` `src`, `<video poster>`, `style="... url(https://...) ..."`, and
		 * `url(...)` inside widget CSS (covers Figma `background-image` exports).
		 *
		 * @param string      $html Raw HTML.
		 * @param string|null $css  Optional widget CSS to rewrite; pass null to skip CSS (legacy callers).
		 * @return array<string,mixed> Keys: html, uploaded, failed, and `css` when $css was a string.
		 */
		private static function mcp_upload_html_images_to_media_library( $html, $css = null ) {
			$html = (string) $html;
			$process_css = null !== $css && is_string( $css );
			$css_in      = $process_css ? (string) $css : '';

			$result = array(
				'html'     => $html,
				'uploaded' => array(),
				'failed'   => array(),
			);
			if ( $process_css ) {
				$result['css'] = $css_in;
			}

			if ( '' === trim( $html ) && '' === trim( $css_in ) ) {
				return $result;
			}

			$needs_dom = ( '' !== trim( $html ) ) && (
				false !== stripos( $html, '<img' )
				|| false !== stripos( $html, 'srcset=' )
				|| false !== stripos( $html, 'style=' )
				|| false !== stripos( $html, '<video' )
				|| false !== stripos( $html, '<audio' )
				|| false !== stripos( $html, '<source' )
				|| false !== stripos( $html, 'poster=' )
			);
			if ( ! $needs_dom && ( ! $process_css || ! preg_match( '/\burl\s*\(/i', $css_in ) ) ) {
				return $result;
			}

			if ( $needs_dom && ( ! class_exists( '\DOMDocument' ) || ! class_exists( '\DOMXPath' ) ) ) {
				if ( $process_css && preg_match( '/\burl\s*\(/i', $css_in ) ) {
					$url_cache  = array();
					$uploaded   = array();
					$failed     = array();
					$result['css'] = self::mcp_rewrite_css_url_functions_with_sideload( $css_in, $url_cache, $uploaded, $failed );
					$result['uploaded'] = array_values( array_unique( $uploaded, SORT_REGULAR ) );
					$result['failed']   = array_values( array_unique( $failed, SORT_REGULAR ) );
				}
				return $result;
			}

			$url_cache = array();
			$uploaded  = array();
			$failed    = array();

			$resolve_url = function ( $original_url ) use ( &$url_cache, &$uploaded, &$failed ) {
				return self::mcp_resolve_external_image_url_for_mcp_import( $original_url, $url_cache, $uploaded, $failed );
			};

			if ( '' !== trim( $html ) && $needs_dom ) {
				$doc = new \DOMDocument();
				$libxml_previous = libxml_use_internal_errors( true );
				$loaded = $doc->loadHTML(
					'<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' . $html . '</body></html>',
					LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
				);
				libxml_clear_errors();
				libxml_use_internal_errors( $libxml_previous );

				if ( $loaded ) {
					$img_nodes = $doc->getElementsByTagName( 'img' );
					foreach ( $img_nodes as $img_node ) {
						if ( ! $img_node->hasAttribute( 'src' ) ) {
							continue;
						}
						$src_url  = $img_node->getAttribute( 'src' );
						$next_src = $resolve_url( $src_url );
						if ( '' !== $next_src ) {
							$img_node->setAttribute( 'src', $next_src );
						}
					}

					$xpath = new \DOMXPath( $doc );

					// <video src> / <audio src> / <source src> (inside <video>/<audio>)
					// and <video poster>. The <img>/srcset/style passes above never
					// touch these, so a .webm/.mp4 export would otherwise keep its
					// original (often temporary/external) URL and never be added to the
					// media library.
					$media_src_nodes = $xpath->query( '//video[@src] | //audio[@src] | //source[@src]' );
					if ( $media_src_nodes instanceof \DOMNodeList ) {
						foreach ( $media_src_nodes as $node ) {
							if ( ! ( $node instanceof \DOMElement ) ) {
								continue;
							}
							$next_media = $resolve_url( $node->getAttribute( 'src' ) );
							if ( '' !== $next_media ) {
								$node->setAttribute( 'src', $next_media );
							}
						}
					}
					$poster_nodes = $xpath->query( '//video[@poster]' );
					if ( $poster_nodes instanceof \DOMNodeList ) {
						foreach ( $poster_nodes as $node ) {
							if ( ! ( $node instanceof \DOMElement ) ) {
								continue;
							}
							$next_poster = $resolve_url( $node->getAttribute( 'poster' ) );
							if ( '' !== $next_poster ) {
								$node->setAttribute( 'poster', $next_poster );
							}
						}
					}

					$srcset_nodes = $xpath->query( '//*[@srcset]' );
					if ( $srcset_nodes instanceof \DOMNodeList ) {
						foreach ( $srcset_nodes as $node ) {
							if ( ! ( $node instanceof \DOMElement ) ) {
								continue;
							}
							$srcset      = $node->getAttribute( 'srcset' );
							$next_srcset = self::mcp_rewrite_srcset_with_uploaded_images( $srcset, $resolve_url );
							$node->setAttribute( 'srcset', $next_srcset );
						}
					}

					$styled = $xpath->query( '//*[@style]' );
					if ( $styled instanceof \DOMNodeList ) {
						foreach ( $styled as $node ) {
							if ( ! ( $node instanceof \DOMElement ) ) {
								continue;
							}
							$style_val = (string) $node->getAttribute( 'style' );
							if ( '' === $style_val || false === stripos( $style_val, 'url(' ) ) {
								continue;
							}
							$next_style = self::mcp_rewrite_css_url_functions_with_sideload( $style_val, $url_cache, $uploaded, $failed );
							$node->setAttribute( 'style', $next_style );
						}
					}

					$body = $doc->getElementsByTagName( 'body' )->item( 0 );
					if ( $body ) {
						$rewritten_html = '';
						foreach ( $body->childNodes as $child ) {
							$rewritten_html .= $doc->saveHTML( $child );
						}
						$result['html'] = $rewritten_html;
					}
				}
			}

			if ( $process_css && '' !== trim( $css_in ) ) {
				$result['css'] = self::mcp_rewrite_css_url_functions_with_sideload( $css_in, $url_cache, $uploaded, $failed );
			}

			$result['uploaded'] = array_values( array_unique( $uploaded, SORT_REGULAR ) );
			$result['failed']   = array_values( array_unique( $failed, SORT_REGULAR ) );

			return $result;
		}

		/**
		 * Rewrite each URL candidate in an srcset string.
		 *
		 * @param string   $srcset      Raw srcset value.
		 * @param callable $resolve_url URL resolver callback.
		 * @return string
		 */
		private static function mcp_rewrite_srcset_with_uploaded_images( $srcset, $resolve_url ) {
			$srcset = (string) $srcset;
			if ( '' === trim( $srcset ) ) {
				return $srcset;
			}

			$parts = preg_split( '/\s*,\s*/', $srcset );
			if ( ! is_array( $parts ) ) {
				return $srcset;
			}

			$rewritten = array();
			foreach ( $parts as $part ) {
				$part = trim( (string) $part );
				if ( '' === $part ) {
					continue;
				}

				$candidate = preg_split( '/\s+/', $part, 2 );
				$url = isset( $candidate[0] ) ? (string) $candidate[0] : '';
				$descriptor = isset( $candidate[1] ) ? (string) $candidate[1] : '';
				$next_url = call_user_func( $resolve_url, $url );
				// '' means the resolver left it alone (token / failed fetch) — keep the
				// original candidate rather than emitting an empty srcset entry.
				if ( '' === $next_url ) {
					$next_url = $url;
				}

				$rewritten[] = '' !== $descriptor ? $next_url . ' ' . $descriptor : $next_url;
			}

			return implode( ', ', $rewritten );
		}

		/**
		 * Sideload a single image URL into WordPress media library.
		 *
		 * @param string $url Image URL.
		 * @return string|\WP_Error Uploaded URL or error.
		 */
		/**
		 * Batch-import a list of remote image URLs into the media library,
		 * reusing the per-URL sideloader (which dedupes against already-imported
		 * sources). Returns an original→local URL map for HTML/CSS rewriting.
		 *
		 * @param array $urls Remote image URLs.
		 * @return array { imported_count, failed_count, map, imported[], failed[] }
		 */
		public static function mcp_import_image_urls( $urls ) {
			if ( ! is_array( $urls ) ) {
				$urls = array();
			}
			$map      = array();
			$imported = array();
			$failed   = array();
			$seen     = array();

			foreach ( $urls as $raw ) {
				$u = trim( (string) $raw );
				if ( '' === $u || isset( $seen[ $u ] ) ) {
					continue;
				}
				$seen[ $u ] = true;

				$local = self::mcp_sideload_image_from_url( $u );
				if ( is_wp_error( $local ) || ! is_string( $local ) || '' === $local ) {
					$failed[] = $u;
					continue;
				}
				$map[ $u ]  = $local;
				$imported[] = array( 'source' => $u, 'local' => $local );
			}

			return array(
				'imported_count' => count( $imported ),
				'failed_count'   => count( $failed ),
				'map'            => $map,
				'imported'       => $imported,
				'failed'         => $failed,
			);
		}

		private static function mcp_sideload_image_from_url( $url ) {
			$url = html_entity_decode( trim( (string) $url ), ENT_QUOTES, 'UTF-8' );
			self::mcp_image_import_debug_log( 'sideload:start', array( 'url' => $url ) );
			if ( '' === $url ) {
				self::mcp_image_import_debug_log( 'sideload:skip_empty_url' );
				return new \WP_Error( 'uich_empty_image_url', 'Image URL is empty.' );
			}

			if ( 0 === strpos( $url, 'data:' ) || 0 === strpos( $url, 'blob:' ) || 0 === strpos( $url, 'javascript:' ) ) {
				self::mcp_image_import_debug_log( 'sideload:skip_scheme', array( 'url' => $url ) );
				return new \WP_Error( 'uich_unsupported_image_url', 'Image URL scheme is not supported for upload.' );
			}

			if ( 0 === strpos( $url, '//' ) ) {
				$url = ( is_ssl() ? 'https:' : 'http:' ) . $url;
			}

			if ( 0 === strpos( $url, '/' ) ) {
				$url = home_url( $url );
			}

			if ( ! wp_http_validate_url( $url ) ) {
				self::mcp_image_import_debug_log( 'sideload:invalid_url', array( 'url' => $url ) );
				return new \WP_Error( 'uich_invalid_image_url', 'Image URL is invalid.' );
			}

			$existing_by_source = self::mcp_find_existing_attachment_by_source_url( $url );
			if ( $existing_by_source ) {
				$existing_by_source_url = wp_get_attachment_url( $existing_by_source );
				if ( $existing_by_source_url ) {
					self::mcp_image_import_debug_log( 'sideload:reuse_source_map', array(
						'url' => $url,
						'attachment_id' => (int) $existing_by_source,
						'attachment_url' => $existing_by_source_url,
					) );
					return esc_url_raw( $existing_by_source_url );
				}
			}

			$existing_attachment_id = attachment_url_to_postid( $url );
			if ( $existing_attachment_id ) {
				$existing_url = wp_get_attachment_url( $existing_attachment_id );
				if ( $existing_url ) {
					self::mcp_image_import_debug_log( 'sideload:reuse_existing_attachment_url', array(
						'url' => $url,
						'attachment_id' => (int) $existing_attachment_id,
						'attachment_url' => $existing_url,
					) );
					return $existing_url;
				}
			}

			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';

			$uploaded_url = media_sideload_image( $url, 0, null, 'src' );
			if ( is_wp_error( $uploaded_url ) ) {
				self::mcp_image_import_debug_log( 'sideload:media_sideload_failed', array(
					'url' => $url,
					'error' => $uploaded_url->get_error_message(),
				) );
				$fallback_uploaded_url = self::mcp_sideload_image_from_url_fallback( $url );
				if ( ! is_wp_error( $fallback_uploaded_url ) ) {
					self::mcp_image_import_debug_log( 'sideload:fallback_success', array(
						'url' => $url,
						'uploaded_url' => $fallback_uploaded_url,
					) );
					return esc_url_raw( $fallback_uploaded_url );
				}
				self::mcp_image_import_debug_log( 'sideload:fallback_failed', array(
					'url' => $url,
					'error' => $fallback_uploaded_url->get_error_message(),
				) );
				return $fallback_uploaded_url;
			}
			$uploaded_attachment_id = self::mcp_find_existing_attachment_by_meta_value( '_source_url', self::mcp_normalize_source_image_url( $url ) );
			if ( ! $uploaded_attachment_id ) {
				$uploaded_attachment_id = attachment_url_to_postid( $uploaded_url );
			}
			if ( $uploaded_attachment_id ) {
				self::mcp_mark_attachment_source_url( $uploaded_attachment_id, $url );
			}
			self::mcp_image_import_debug_log( 'sideload:success', array(
				'url' => $url,
				'uploaded_url' => $uploaded_url,
				'attachment_id' => (int) $uploaded_attachment_id,
			) );

			return esc_url_raw( $uploaded_url );
		}

		/**
		 * Fallback sideload for extension-less image URLs (e.g. Figma MCP assets).
		 *
		 * @param string $url Source image URL.
		 * @return string|\WP_Error Uploaded attachment URL or error.
		 */
		private static function mcp_sideload_image_from_url_fallback( $url ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';

			$temp_file = download_url( $url, 60 );
			if ( is_wp_error( $temp_file ) ) {
				self::mcp_image_import_debug_log( 'fallback:download_failed', array(
					'url' => $url,
					'error' => $temp_file->get_error_message(),
				) );
				return $temp_file;
			}

			$path_name = (string) wp_parse_url( $url, PHP_URL_PATH );
			$base_name = sanitize_file_name( wp_basename( $path_name ) );
			if ( '' === $base_name || '.' === $base_name || '..' === $base_name ) {
				$base_name = 'uichemy-mcp-image';
			}

			$image_mime = self::mcp_detect_downloaded_image_mime( $temp_file, $base_name );
			$mime_to_ext = array(
				'image/jpeg'    => 'jpg',
				'image/jpg'     => 'jpg',
				'image/png'     => 'png',
				'image/gif'     => 'gif',
				'image/webp'    => 'webp',
				'image/svg+xml' => 'svg',
				'image/bmp'     => 'bmp',
				'image/x-icon'  => 'ico',
				'image/vnd.microsoft.icon' => 'ico',
				// Video / audio — a Figma or AI export can reference a .webm/.mp4
				// clip; without these an extension-less media URL would be renamed
				// to .jpg below and rejected by media_handle_sideload.
				'video/mp4'     => 'mp4',
				'video/webm'    => 'webm',
				'video/ogg'     => 'ogv',
				'audio/mpeg'    => 'mp3',
				'audio/ogg'     => 'ogg',
				'audio/wav'     => 'wav',
			);

			$current_ext = strtolower( (string) pathinfo( $base_name, PATHINFO_EXTENSION ) );
			if ( '' === $current_ext && isset( $mime_to_ext[ $image_mime ] ) ) {
				$base_name .= '.' . $mime_to_ext[ $image_mime ];
			}

			if ( '' === strtolower( (string) pathinfo( $base_name, PATHINFO_EXTENSION ) ) ) {
				// Only assume .jpg for image or unknown sources; a detected video/audio
				// mime that had no mapped extension must not be renamed to .jpg.
				if ( '' === $image_mime || 0 === strpos( $image_mime, 'image/' ) ) {
					$base_name .= '.jpg';
				}
			}
			self::mcp_image_import_debug_log( 'fallback:prepared_file', array(
				'url' => $url,
				'mime' => $image_mime,
				'name' => $base_name,
			) );

			$file_array = array(
				'name'     => $base_name,
				'tmp_name' => $temp_file,
			);
			if ( $image_mime ) {
				$file_array['type'] = $image_mime;
			}

			$svg_mime_filter = null;
			if ( 'image/svg+xml' === $image_mime ) {
				$svg_mime_filter = array( __CLASS__, 'mcp_allow_svg_upload_mimes' );
				add_filter( 'upload_mimes', $svg_mime_filter, 99 );

				// Scrub script/XSS vectors from the downloaded SVG before it is
				// stored. The dedicated upload endpoint already sanitises SVG the
				// same way; this import fallback must not be the weaker path (an
				// extension-less remote SVG would otherwise be stored raw → stored
				// XSS when the attachment URL is opened directly).
				if ( ! class_exists( 'UiChemy_Composer_Upload' ) ) {
					require_once UICHEMY_PATH . 'includes/mcp/shared/class-uichemy-composer-upload.php';
				}
				if ( method_exists( 'UiChemy_Composer_Upload', 'sanitize_svg_bytes' ) ) {
					$svg_raw = file_get_contents( $temp_file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local temp file from download_url().
					if ( is_string( $svg_raw ) && '' !== $svg_raw ) {
						file_put_contents( $temp_file, UiChemy_Composer_Upload::sanitize_svg_bytes( $svg_raw ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- local temp file, mirrors handle_upload().
					}
				}
			}

			try {
				$attachment_id = media_handle_sideload( $file_array, 0 );
			} finally {
				if ( $svg_mime_filter ) {
					remove_filter( 'upload_mimes', $svg_mime_filter, 99 );
				}
			}

			if ( is_wp_error( $attachment_id ) ) {
				wp_delete_file( $temp_file );
				self::mcp_image_import_debug_log( 'fallback:media_handle_failed', array(
					'url' => $url,
					'mime' => $image_mime,
					'name' => $base_name,
					'allowed_svg' => (bool) self::mcp_is_svg_upload_allowed(),
					'error' => $attachment_id->get_error_message(),
				) );
				return $attachment_id;
			}

			$attachment_url = wp_get_attachment_url( $attachment_id );
			if ( ! $attachment_url ) {
				self::mcp_image_import_debug_log( 'fallback:no_attachment_url', array(
					'url' => $url,
					'attachment_id' => (int) $attachment_id,
				) );
				return new \WP_Error( 'uich_sideload_fallback_no_url', 'Image uploaded but attachment URL could not be resolved.' );
			}

			self::mcp_mark_attachment_source_url( (int) $attachment_id, $url );
			self::mcp_image_import_debug_log( 'fallback:success', array(
				'url' => $url,
				'attachment_id' => (int) $attachment_id,
				'attachment_url' => $attachment_url,
				'mime' => $image_mime,
			) );

			return esc_url_raw( $attachment_url );
		}

		/**
		 * Detect MIME for downloaded images including SVG.
		 *
		 * @param string $temp_file Downloaded temp file path.
		 * @param string $base_name Candidate filename.
		 * @return string
		 */
		private static function mcp_detect_downloaded_image_mime( $temp_file, $base_name = '' ) {
			$temp_file = (string) $temp_file;
			$base_name = strtolower( (string) $base_name );
			if ( '' === $temp_file ) {
				return '';
			}

			// getimagesize handles raster formats, but often misses SVG.
			$image_meta = @getimagesize( $temp_file );
			if ( is_array( $image_meta ) && ! empty( $image_meta['mime'] ) ) {
				return strtolower( (string) $image_meta['mime'] );
			}

			// finfo fallback.
			if ( function_exists( 'finfo_open' ) ) {
				$finfo = @finfo_open( FILEINFO_MIME_TYPE );
				if ( $finfo ) {
					$mime = @finfo_file( $finfo, $temp_file );
					@finfo_close( $finfo );
					if ( is_string( $mime ) && '' !== trim( $mime ) ) {
						$mime = strtolower( trim( $mime ) );
						// Some systems report SVG as text/plain or text/xml.
						if ( 'text/plain' !== $mime && 'text/xml' !== $mime ) {
							return $mime;
						}
					}
				}
			}

			// SVG sniff fallback by content and filename hint.
			$snippet = @file_get_contents( $temp_file, false, null, 0, 1024 );
			$snippet = is_string( $snippet ) ? strtolower( $snippet ) : '';
			if ( false !== strpos( $base_name, '.svg' ) || false !== strpos( $snippet, '<svg' ) ) {
				return 'image/svg+xml';
			}

			return '';
		}

		/**
		 * Check whether SVG uploads are allowed on this site.
		 *
		 * @return bool
		 */
		private static function mcp_is_svg_upload_allowed() {
			$allowed = get_allowed_mime_types();
			foreach ( $allowed as $ext => $mime ) {
				if ( 'image/svg+xml' === $mime && false !== strpos( (string) $ext, 'svg' ) ) {
					return true;
				}
			}
			return false;
		}

		/**
		 * Temporarily allow SVG uploads for trusted MCP sideloads.
		 *
		 * @param array<string, string> $mimes Allowed mime types.
		 * @return array<string, string>
		 */
		public static function mcp_allow_svg_upload_mimes( $mimes ) {
			if ( is_array( $mimes ) ) {
				$mimes['svg'] = 'image/svg+xml';
			}

			return $mimes;
		}

		/**
		 * Find an existing attachment ID by previously recorded source URL hash.
		 *
		 * @param string $url Source URL.
		 * @return int Attachment ID or 0.
		 */
		private static function mcp_find_existing_attachment_by_source_url( $url ) {
			$normalized_url = self::mcp_normalize_source_image_url( $url );
			if ( '' === $normalized_url ) {
				return 0;
			}

			$existing_by_wp_source = self::mcp_find_existing_attachment_by_meta_value( '_source_url', $normalized_url );
			if ( $existing_by_wp_source ) {
				return $existing_by_wp_source;
			}

			$existing_by_custom_url = self::mcp_find_existing_attachment_by_meta_value( '_uich_mcp_source_image_url', $normalized_url );
			if ( $existing_by_custom_url ) {
				return $existing_by_custom_url;
			}

			$source_hash = md5( $normalized_url );
			return self::mcp_find_existing_attachment_by_meta_value( '_uich_mcp_source_image_hash', $source_hash );
		}

		/**
		 * Persist source URL mapping metadata on uploaded attachment.
		 *
		 * @param int    $attachment_id  Attachment ID.
		 * @param string $source_url     Original source URL.
		 * @return void
		 */
		private static function mcp_mark_attachment_source_url( $attachment_id, $source_url ) {
			$attachment_id = absint( $attachment_id );
			$source_url    = self::mcp_normalize_source_image_url( $source_url );
			if ( ! $attachment_id || '' === $source_url ) {
				return;
			}

			update_post_meta( $attachment_id, '_source_url', $source_url );
			update_post_meta( $attachment_id, '_uich_mcp_source_image_url', $source_url );
			update_post_meta( $attachment_id, '_uich_mcp_source_image_hash', md5( $source_url ) );
		}

		/**
		 * Find one attachment ID by exact post meta key/value.
		 *
		 * @param string $meta_key   Meta key.
		 * @param string $meta_value Meta value.
		 * @return int
		 */
		private static function mcp_find_existing_attachment_by_meta_value( $meta_key, $meta_value ) {
			$meta_key   = (string) $meta_key;
			$meta_value = (string) $meta_value;
			if ( '' === $meta_key || '' === $meta_value ) {
				return 0;
			}

			$attachment_posts = get_posts(
				array(
					'post_type'      => 'attachment',
					'post_status'    => 'inherit',
					'posts_per_page' => 1,
					'fields'         => 'ids',
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
					'meta_key'       => $meta_key,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
					'meta_value'     => $meta_value,
					'orderby'        => 'ID',
					'order'          => 'DESC',
					'no_found_rows'  => true,
				)
			);

			if ( empty( $attachment_posts ) || ! isset( $attachment_posts[0] ) ) {
				return 0;
			}

			return absint( $attachment_posts[0] );
		}

		/**
		 * Normalize source image URL to keep dedupe keys consistent.
		 *
		 * @param string $url Raw URL.
		 * @return string
		 */
		private static function mcp_normalize_source_image_url( $url ) {
			$url = html_entity_decode( trim( (string) $url ), ENT_QUOTES, 'UTF-8' );
			if ( '' === $url ) {
				return '';
			}

			if ( 0 === strpos( $url, '//' ) ) {
				$url = ( is_ssl() ? 'https:' : 'http:' ) . $url;
			}

			if ( 0 === strpos( $url, '/' ) ) {
				$url = home_url( $url );
			}

			return esc_url_raw( $url );
		}

		/**
		 * Debug logger for MCP image import.
		 *
		 * @param string $event   Event key.
		 * @param array  $context Optional context.
		 * @return void
		 */
		private static function mcp_image_import_debug_log( $event, $context = array() ) {
			$event = (string) $event;
			$context = is_array( $context ) ? $context : array();
			$line = '[UiChemy MCP Image] ' . $event;
			if ( ! empty( $context ) ) {
				$line .= ' ' . wp_json_encode( $context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
			}
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( $line ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- Diagnostic logging only when WP_DEBUG is enabled.
			}
		}

		/**
		 * Apply tagged generated code to the first matching Composer widget.
		 *
		 * @param array $elements Elementor elements tree.
		 * @param array $payload  Tagged payload.
		 * @return array<string, mixed>
		 */
		private static function apply_mcp_generated_code_to_elements( &$elements, $payload ) {
			$result = array(
				'updated'        => false,
				'widget_id'      => '',
				'matched_by'     => '',
				'updated_fields' => array(),
				'message'        => 'No Composer widget found on this post.',
			);

			if ( ! is_array( $elements ) ) {
				$result['message'] = 'Elementor elements are invalid.';
				return $result;
			}

			$target_widget_id = isset( $payload['widget_id'] ) ? (string) $payload['widget_id'] : '';
			$mode             = isset( $payload['mode'] ) ? (string) $payload['mode'] : 'replace';
			$mode             = in_array( $mode, array( 'replace', 'append' ), true ) ? $mode : 'replace';

			foreach ( $elements as &$element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}

				$el_type     = isset( $element['elType'] ) ? (string) $element['elType'] : '';
				$widget_type = isset( $element['widgetType'] ) ? (string) $element['widgetType'] : '';
				$element_id  = isset( $element['id'] ) ? (string) $element['id'] : '';

				if ( 'widget' === $el_type && uichemy_is_composer_widget_type( $widget_type ) ) {
					$id_matches = '' !== $target_widget_id && $target_widget_id === $element_id;
					$first_hit  = '' === $target_widget_id;

					if ( $id_matches || $first_hit ) {
						if ( ! isset( $element['settings'] ) || ! is_array( $element['settings'] ) ) {
							$element['settings'] = array();
						}

						$fields = array(
							'raw_html' => isset( $payload['html'] ) ? (string) $payload['html'] : '',
							'raw_css'  => isset( $payload['css'] ) ? (string) $payload['css'] : '',
							'raw_js'   => isset( $payload['js'] ) ? (string) $payload['js'] : '',
						);

						foreach ( $fields as $field_key => $next_value ) {
							if ( '' === trim( $next_value ) ) {
								continue;
							}

							$current_value = isset( $element['settings'][ $field_key ] ) ? (string) $element['settings'][ $field_key ] : '';
							$merged_value  = 'append' === $mode && '' !== trim( $current_value )
								? rtrim( $current_value ) . "\n\n" . $next_value
								: $next_value;

							$element['settings'][ $field_key ] = $merged_value;
							$result['updated_fields'][]        = $field_key;
						}

						if ( in_array( 'raw_html', $result['updated_fields'], true ) ) {
							foreach ( array_keys( $element['settings'] ) as $setting_key ) {
								if ( 0 === strpos( (string) $setting_key, 'slot_' ) ) {
									unset( $element['settings'][ $setting_key ] );
								}
							}
						}

						$result['updated']        = true;
						$result['widget_id']      = $element_id;
						$result['matched_by']     = $id_matches ? 'widget_id' : 'first_widget';
						$result['updated_fields'] = array_values( array_unique( $result['updated_fields'] ) );
						$result['message']        = 'Composer widget updated.';
						return $result;
					}
				}

				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					$nested_result = self::apply_mcp_generated_code_to_elements( $element['elements'], $payload );
					if ( ! empty( $nested_result['updated'] ) ) {
						return $nested_result;
					}
				}
			}
			unset( $element );

			if ( '' !== $target_widget_id ) {
				$result['message'] = 'Composer widget with provided widget_id was not found.';
			}

			return $result;
		}

		/**
		 * OPT-IN: convert standalone {{ … }} data tokens in every Composer widget's
		 * raw_html into bound Elementor dynamic tags (settings.__dynamic__), so an
		 * imported page shows its tags already auto-selected instead of only resolving
		 * through Twig. No-op unless the `uichemy_autobind_dynamic_tags` filter (or the
		 * matching option) returns true — normal imports are unchanged until enabled.
		 * Widgets containing {% for %}/{% if %} control flow are left on the Twig path
		 * (they can't use slot bindings). Safe to call before any _elementor_data save.
		 *
		 * @param array $elements Elementor element tree (by reference).
		 * @return int Number of Composer widgets bound.
		 */
		private static function apply_dynamic_tag_bindings( &$elements ) {
			if ( ! is_array( $elements ) ) {
				return 0;
			}
			$enabled = apply_filters( 'uichemy_autobind_dynamic_tags', (bool) get_option( 'uichemy_autobind_dynamic_tags', false ) );
			if ( ! $enabled ) {
				return 0;
			}
			if ( ! class_exists( 'UiChemy_Token_Binder' ) && defined( 'UICHEMY_PATH' ) ) {
				$file = UICHEMY_PATH . 'includes/dynamic/class-uichemy-token-binder.php';
				if ( is_readable( $file ) ) {
					require_once $file;
				}
			}
			if ( ! class_exists( 'UiChemy_Token_Binder' ) ) {
				return 0;
			}
			return self::walk_bind_dynamic_tags( $elements );
		}

		/**
		 * Recurse the element tree, binding tokens on each Composer widget. See
		 * {@see apply_dynamic_tag_bindings()}.
		 *
		 * @param array $elements By reference.
		 * @return int
		 */
		private static function walk_bind_dynamic_tags( &$elements ) {
			$count = 0;
			foreach ( $elements as &$element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}
				$is_composer = isset( $element['elType'], $element['widgetType'] )
					&& uichemy_is_composer_widget_node( $element );
				if ( $is_composer && ! empty( $element['settings']['raw_html'] ) ) {
					$res = UiChemy_Token_Binder::bind( (string) $element['settings']['raw_html'] );
					if ( ! empty( $res['bindings'] ) ) {
						$element['settings']['raw_html'] = $res['html'];
						$existing = ( isset( $element['settings']['__dynamic__'] ) && is_array( $element['settings']['__dynamic__'] ) )
							? $element['settings']['__dynamic__'] : array();
						// Existing bindings win over ours (never clobber a user's explicit tag).
						$element['settings']['__dynamic__'] = array_merge( $res['dynamic'], $existing );
						// Slot flags the render path needs for image bindings to apply.
						// Only fill gaps — an explicit saved value always wins.
						if ( ! empty( $res['settings'] ) && is_array( $res['settings'] ) ) {
							foreach ( $res['settings'] as $flag_key => $flag_val ) {
								if ( ! isset( $element['settings'][ $flag_key ] ) ) {
									$element['settings'][ $flag_key ] = $flag_val;
								}
							}
						}
						$count++;
					}
				}
				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					$count += self::walk_bind_dynamic_tags( $element['elements'] );
				}
			}
			unset( $element );
			return $count;
		}

		/**
		 * Build tagged code block for generated markup/styles/scripts.
		 *
		 * @param string $type   html|css|js.
		 * @param string $code   Raw code.
		 * @param string $source Source label.
		 * @param string $label  Optional label.
		 * @return string
		 */
		private static function build_mcp_tagged_code_block( $type, $code, $source, $label ) {
			$code = (string) $code;
			if ( '' === trim( $code ) ) {
				return '';
			}

			// Keep MCP output clean: do not inject wrapper comments around generated code.
			return trim( $code );
		}

		/**
		 * Sanitize custom head/footer code keyed to the current user's capability.
		 *
		 * Mirrors WordPress core's own model for the Custom HTML block: users who
		 * hold `unfiltered_html` (administrators on a single-site install; disabled
		 * on multisite and when DISALLOW_UNFILTERED_HTML is set) may author raw
		 * markup, and everyone else has their input passed through wp_kses_post(),
		 * which strips <script>/<style>/<iframe> and other executable markup. There
		 * is deliberately no "trusted" bypass: the capability check is the only
		 * gate, so nothing — including internal import/MCP paths — can store raw
		 * code on behalf of a user who is not permitted to.
		 *
		 * @param mixed $value Raw code value.
		 * @return string
		 */
		private static function sanitize_custom_code( $value ) {
			$value = is_string( $value ) ? $value : '';

			if ( current_user_can( 'unfiltered_html' ) ) {
				return $value;
			}

			return wp_kses_post( $value );
		}

		/**
		 * Strip privileged Composer widget code fields on save for users who lack
		 * `unfiltered_html`.
		 *
		 * Elementor already kses-filters markup fields (raw_html and the
		 * page/site custom-code head/footer editors) for these users once our
		 * former kses-widening filter is gone. The raw_js and raw_css fields are
		 * stored as plain text, so kses never inspects them — this filter walks
		 * the saved element tree and neutralises those fields for unprivileged
		 * savers, so a Contributor/Author (or a multisite admin without
		 * `unfiltered_html`) can never persist executable JavaScript, even when
		 * editing a page authored by an administrator.
		 *
		 * @param array $data     Elementor document data ('elements', 'settings', ...).
		 * @param mixed $document Elementor document instance (unused).
		 * @return array
		 */
		public function sanitize_composer_widget_code_on_save( $data, $document = null ) {
			unset( $document );

			// Stored raw_css / raw_js is preserved unless a site opts out via
			// uichemy/composer/allow_custom_code. Stripping on every save destroys
			// imported designs: an imported header/footer/page keeps its whole design
			// in raw_css, so the first Update in Elementor would erase it for good.
			if ( ! uichemy_custom_code_allowed() && is_array( $data ) && ! empty( $data['elements'] ) && is_array( $data['elements'] ) ) {
				$data['elements'] = self::strip_pro_widget_code( $data['elements'] );
			}

			if ( current_user_can( 'unfiltered_html' ) ) {
				return $data;
			}

			if ( is_array( $data ) && ! empty( $data['elements'] ) && is_array( $data['elements'] ) ) {
				$data['elements'] = self::strip_privileged_widget_code( $data['elements'] );
			}

			return $data;
		}

		/**
		 * Recursively blank the Pro-only raw_css / raw_js fields on Composer widgets.
		 * Runs on every save in the Free build (see sanitize_composer_widget_code_on_save)
		 * so custom CSS/JS is never stored — leaving raw_html and everything else
		 * untouched (only the CSS/JS editor is the Pro feature being removed).
		 *
		 * @param array $elements Elementor elements.
		 * @return array
		 */
		private static function strip_pro_widget_code( array $elements ) {
			foreach ( $elements as &$element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}
				if ( isset( $element['settings'] ) && is_array( $element['settings'] ) ) {
					if ( isset( $element['settings']['raw_css'] ) ) {
						$element['settings']['raw_css'] = '';
					}
					if ( isset( $element['settings']['raw_js'] ) ) {
						$element['settings']['raw_js'] = '';
					}
				}
				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					$element['elements'] = self::strip_pro_widget_code( $element['elements'] );
				}
			}
			unset( $element );

			return $elements;
		}

		/**
		 * Recursively remove executable code fields from Composer widgets in an
		 * Elementor element tree. Called only for unprivileged saves.
		 *
		 * @param array $elements Elementor elements.
		 * @return array
		 */
		private static function strip_privileged_widget_code( array $elements ) {
			foreach ( $elements as &$element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}

				if ( isset( $element['settings'] ) && is_array( $element['settings'] ) ) {
					// Executable JS is never allowed for unprivileged users.
					if ( isset( $element['settings']['raw_js'] ) ) {
						$element['settings']['raw_js'] = '';
					}
					// CSS cannot break out of its <style> wrapper or carry markup.
					if ( isset( $element['settings']['raw_css'] ) ) {
						$element['settings']['raw_css'] = self::sanitize_css_block( (string) $element['settings']['raw_css'] );
					}
					// The per-widget 3rd-party dependency lists emit external
					// <script src>/<link> tags on the front end — adding those is
					// equivalent to arbitrary code and is reserved for
					// `unfiltered_html`. Neutralise them for unprivileged savers so a
					// Contributor/Author cannot inject an external script, even when
					// editing an administrator-authored page.
					foreach ( array( 'raw_deps_standard', 'raw_deps_page', 'raw_deps_site' ) as $deps_key ) {
						if ( isset( $element['settings'][ $deps_key ] ) ) {
							$element['settings'][ $deps_key ] = '';
						}
					}
				}

				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					$element['elements'] = self::strip_privileged_widget_code( $element['elements'] );
				}
			}
			unset( $element );

			return $elements;
		}

		// ============================================================
		// AUDIT
		// ============================================================

		/**
		 * MCP — read-only site-readiness findings, each naming the ability that fixes it.
		 *
		 * Composed from the same reads the other abilities already do, so it adds no
		 * new source of truth: its value is that a build can ask "what did I leave
		 * broken?" once instead of remembering ten separate things to re-check.
		 *
		 * @param array $payload [post_id] to scope page-level checks to one page.
		 * @return array
		 */
		public static function mcp_audit_run( $payload = array() ) {
			$payload  = is_array( $payload ) ? $payload : array();
			$findings = array();

			$add = function ( $severity, $check, $message, $fix ) use ( &$findings ) {
				$findings[] = array(
					'severity' => $severity,
					'check'    => $check,
					'message'  => $message,
					'fix'      => $fix,
				);
			};

			// --- Platform -----------------------------------------------------
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				$add( 'blocker', 'elementor_active', 'Elementor is not active nothing UiChemy builds will render.', 'Activate Elementor.' );
			}
			if ( class_exists( 'UiChemy_Globals_CSS' ) && '' === trim( (string) self::get_globals_block_css() ) ) {
				$add( 'warning', 'design_system', 'The #uichemy-globals block is empty, so sections have no tokens to reference.', 'uichemy-composer/design-system (action="set")' );
			}

			// --- Branding + identity ------------------------------------------
			$site = self::mcp_platform_get_site();
			if ( '' === trim( (string) $site['tagline'] ) ) {
				$add( 'notice', 'tagline', 'The site has no tagline.', 'uichemy-composer/platform (action="update-site-settings")' );
			}
			if ( ! $site['branding']['logo_id'] ) {
				$add( 'warning', 'site_logo', 'No site logo is set, so <uichemy-site-logo /> renders nothing.', 'uichemy-composer/platform (action="update-site-settings")' );
			}
			if ( ! $site['branding']['icon_id'] ) {
				$add( 'notice', 'site_icon', 'No site icon (favicon) is set.', 'uichemy-composer/platform (action="update-site-settings")' );
			}

			// --- Nav menus ----------------------------------------------------
			$menus = self::mcp_menu_get();
			if ( empty( $menus['menus'] ) ) {
				$add( 'warning', 'nav_menu', 'No nav menu exists, so <uichemy-nav-menu /> renders an empty nav.', 'uichemy-composer/platform (action="update-menu")' );
			} else {
				$unassigned = array();
				foreach ( $menus['locations'] as $loc ) {
					if ( ! $loc['assigned'] ) {
						$unassigned[] = $loc['slug'];
					}
				}
				if ( $unassigned ) {
					$add( 'notice', 'menu_locations', 'Theme menu locations with no menu assigned: ' . implode( ', ', $unassigned ) . '.', 'uichemy-composer/platform (action="update-menu", locations=[...])' );
				}
			}

			// --- Theme-builder templates that exist but render nowhere --------
			if ( post_type_exists( 'elementor_library' ) ) {
				$inactive = array();
				foreach ( get_posts( array( 'post_type' => 'elementor_library', 'post_status' => 'publish', 'posts_per_page' => 50, 'no_found_rows' => true ) ) as $tpl ) {
					$type = (string) get_post_meta( $tpl->ID, '_elementor_template_type', true );
					if ( ! in_array( $type, array( 'header', 'footer', 'single', 'archive' ), true ) ) {
						continue;
					}
					$conditions = get_post_meta( $tpl->ID, '_elementor_conditions', true );
					if ( empty( $conditions ) || ! is_array( $conditions ) ) {
						$inactive[] = $tpl->post_title . ' (#' . $tpl->ID . ', ' . $type . ')';
					}
				}
				if ( $inactive ) {
					$add(
						'warning',
						'inactive_templates',
						'Theme-builder templates exist but have no display conditions, so they render nowhere: ' . implode( '; ', $inactive ) . '.',
						'uichemy-composer/template (action="set-conditions", scope="site")'
					);
				}
			}

			// --- Forms with nowhere to deliver --------------------------------
			if ( class_exists( 'Uich_Forms' ) ) {
				$formless = array();
				foreach ( get_posts( array( 'post_type' => array( 'page', 'post' ), 'post_status' => 'publish', 'posts_per_page' => 100, 'fields' => 'ids', 'no_found_rows' => true ) ) as $pid ) {
					$config = get_post_meta( $pid, Uich_Forms::CONFIG_META, true );
					if ( ! is_array( $config ) ) {
						continue;
					}
					foreach ( $config as $key => $conf ) {
						if ( empty( $conf['email_to'] ) ) {
							$formless[] = get_the_title( $pid ) . ' (#' . $pid . ', form "' . $key . '")';
						}
					}
				}
				if ( $formless ) {
					$add( 'warning', 'form_recipient', 'Forms with no recipient email submissions are stored but nobody is notified: ' . implode( '; ', $formless ) . '.', 'uichemy-composer/forms (action="configure", email_to="…")' );
				}
			}

			// --- Media without alt text ---------------------------------------
			$no_alt = get_posts(
				array(
					'post_type'      => 'attachment',
					'post_status'    => 'inherit',
					'post_mime_type' => 'image',
					'posts_per_page' => 25,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Alt text is only queryable through meta.
					'meta_query'     => array(
						'relation' => 'OR',
						array( 'key' => '_wp_attachment_image_alt', 'compare' => 'NOT EXISTS' ),
						array( 'key' => '_wp_attachment_image_alt', 'value' => '', 'compare' => '=' ),
					),
				)
			);
			if ( $no_alt ) {
				$add( 'notice', 'image_alt', count( $no_alt ) . ' image(s) have no alt text (first 25 checked). Ids: ' . implode( ', ', array_slice( $no_alt, 0, 10 ) ) . '.', 'uichemy-composer/media (action="update", alt="…")' );
			}

			// --- Code files: references that 404, and files nothing references ---
			// Either half can fail silently: the tag can point at a file that no
			// longer exists, or the file can exist with no tag referencing it.
			if ( class_exists( 'Uich_Code_Files' ) ) {
				$code_scan = self::get_site_custom_code_option();
				$code_blob = (string) $code_scan['head'] . "\n" . (string) $code_scan['footer'];

				$scan_post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
				if ( $scan_post_id ) {
					$page_blob = get_post_meta( $scan_post_id, '_elementor_data', true );
					if ( is_string( $page_blob ) ) {
						$code_blob .= "\n" . $page_blob;
					}
				}

				$referenced = array();
				if ( preg_match_all( '#uichemy-composer/([A-Za-z0-9._-]+\.(?:css|js))#i', $code_blob, $ref_matches ) ) {
					$referenced = array_values( array_unique( $ref_matches[1] ) );
				}

				$missing = array();
				foreach ( $referenced as $ref_name ) {
					if ( ! Uich_Code_Files::exists( $ref_name ) ) {
						$missing[] = $ref_name;
					}
				}
				if ( $missing ) {
					$add(
						'warning',
						'code_file_missing',
						'Code file(s) referenced by site or page code do not exist, so the request 404s on every page it is injected into: ' . implode( ', ', $missing ) . '.',
						'uichemy-composer/code-file (action="list") to see what is really there, then fix or remove the tag with uichemy-composer/platform (action="set-site-code").'
					);
				}

				$stored = Uich_Code_Files::all();
				if ( is_array( $stored ) ) {
					$orphans = array();
					foreach ( $stored as $stored_file ) {
						$stored_name = is_array( $stored_file ) && isset( $stored_file['filename'] )
							? (string) $stored_file['filename']
							: (string) $stored_file;
						if ( '' === $stored_name ) {
							continue;
						}
						if ( ! in_array( $stored_name, $referenced, true ) ) {
							$orphans[] = $stored_name;
						}
					}
					if ( $orphans ) {
						$add(
							'warning',
							'code_file_unreferenced',
							'Code file(s) exist but nothing references them, so their CSS/JS never loads: ' . implode( ', ', $orphans ) . '.',
							'Add the <link>/<script src> with uichemy-composer/platform (action="update-site-code") for site-wide, or uichemy-composer/page (action="update-page-code") for one page then read it back to confirm it landed.'
						);
					}
				}
			}

			// --- Page-scoped check --------------------------------------------
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( $post_id ) {
				$structure = self::mcp_load_elements_for_structural_op( $post_id );
				if ( is_wp_error( $structure ) ) {
					$add( 'warning', 'page_empty', "Post {$post_id} has no Elementor content.", 'uichemy-composer/page (action="create-with-sections")' );
				} else {
					$widgets = array();
					self::collect_uichemy_composer_widgets( $structure, $widgets );
					if ( ! $widgets ) {
						$add( 'warning', 'page_sections', "Post {$post_id} has Elementor content but no Composer sections.", 'uichemy-composer/page (action="append-section")' );
					}
				}
			}

			/**
			 * Let another plugin contribute findings for a surface this build does
			 * not own.
			 *
			 * This exists rather than a WooCommerce block written here, and the
			 * reason is the contract in this method's own docblock: the audit adds no
			 * new source of truth. Store readiness is already computed by
			 * uichemy-composer/store in UiChemy Pro, and a second copy here would be
			 * two implementations of "is the checkout usable" that drift apart.
			 *
			 * It also keeps the audit honest about what it can offer: every finding
			 * names the ability that fixes it, so a site with no Pro should report no
			 * store findings — there would be no call to name.
			 *
			 * @param array $findings Findings so far, each { severity, check, message, fix }.
			 * @param array $payload  The audit payload, e.g. [post_id].
			 */
			$contributed = apply_filters( 'uichemy_audit_findings', $findings, $payload );

			if ( is_array( $contributed ) ) {
				$findings = array();

				// Re-validate rather than trusting the filter: a malformed row would
				// otherwise reach the severity tally below and fatal on an undefined
				// index, taking the whole audit down with it.
				foreach ( $contributed as $finding ) {
					if ( ! is_array( $finding ) || empty( $finding['check'] ) || empty( $finding['message'] ) ) {
						continue;
					}

					$severity = isset( $finding['severity'] ) ? (string) $finding['severity'] : 'notice';

					$findings[] = array(
						'severity' => in_array( $severity, array( 'blocker', 'warning', 'notice' ), true ) ? $severity : 'notice',
						'check'    => (string) $finding['check'],
						'message'  => (string) $finding['message'],
						'fix'      => isset( $finding['fix'] ) ? (string) $finding['fix'] : '',
					);
				}
			}

			$by_severity = array( 'blocker' => 0, 'warning' => 0, 'notice' => 0 );
			foreach ( $findings as $f ) {
				++$by_severity[ $f['severity'] ];
			}

			return array(
				'ok'       => empty( $findings ),
				'counts'   => $by_severity,
				'findings' => $findings,
				'message'  => $findings
					? count( $findings ) . ' finding(s). Each names the ability that fixes it.'
					: 'No findings the site looks ready.',
			);
		}

		/**
		 * MCP — what the audit looks at, without running it.
		 *
		 * @return array
		 */
		public static function mcp_audit_list_checks() {
			$checks = array(
				'checks' => array(
					array( 'check' => 'elementor_active', 'scope' => 'platform', 'severity' => 'blocker' ),
					array( 'check' => 'design_system', 'scope' => 'platform', 'severity' => 'warning' ),
					array( 'check' => 'tagline', 'scope' => 'site', 'severity' => 'notice' ),
					array( 'check' => 'site_logo', 'scope' => 'site', 'severity' => 'warning' ),
					array( 'check' => 'site_icon', 'scope' => 'site', 'severity' => 'notice' ),
					array( 'check' => 'nav_menu', 'scope' => 'menus', 'severity' => 'warning' ),
					array( 'check' => 'menu_locations', 'scope' => 'menus', 'severity' => 'notice' ),
					array( 'check' => 'inactive_templates', 'scope' => 'templates', 'severity' => 'warning' ),
					array( 'check' => 'form_recipient', 'scope' => 'forms', 'severity' => 'warning' ),
					array( 'check' => 'image_alt', 'scope' => 'media', 'severity' => 'notice' ),
					array( 'check' => 'code_file_missing', 'scope' => 'code files', 'severity' => 'warning' ),
					array( 'check' => 'code_file_unreferenced', 'scope' => 'code files', 'severity' => 'warning' ),
					array( 'check' => 'page_empty', 'scope' => 'page (needs post_id)', 'severity' => 'warning' ),
					array( 'check' => 'page_sections', 'scope' => 'page (needs post_id)', 'severity' => 'warning' ),
				),
			);

			/**
			 * Checks contributed by another plugin, matching the findings filter.
			 *
			 * Kept in step with `uichemy_audit_findings` on purpose: a check that can
			 * appear in a run but not in list-checks makes list-checks a lie, and it
			 * is the call a build makes to decide whether running the audit is worth
			 * it at all.
			 *
			 * @param array $checks Checks so far, each { check, scope, severity }.
			 */
			$contributed = apply_filters( 'uichemy_audit_checks', $checks['checks'] );

			if ( is_array( $contributed ) ) {
				$checks['checks'] = array_values( array_filter( $contributed, 'is_array' ) );
			}

			return $checks;
		}

		// ============================================================
		// PLATFORM — SITE LEVEL
		// ============================================================

		/**
		 * MCP — read the site-level settings a build actually touches.
		 *
		 * describe-site reports whether a logo exists; this reports what it IS, plus
		 * the identity fields (title, tagline) a generated header has to render and
		 * the front-page wiring that decides which page a visitor lands on.
		 *
		 * @return array
		 */
		public static function mcp_platform_get_site() {
			$logo_id = absint( get_theme_mod( 'custom_logo', 0 ) );
			$icon_id = absint( get_option( 'site_icon', 0 ) );
			$front   = absint( get_option( 'page_on_front', 0 ) );
			$posts   = absint( get_option( 'page_for_posts', 0 ) );

			return array(
				'title'       => get_bloginfo( 'name' ),
				'tagline'     => get_bloginfo( 'description' ),
				'url'         => home_url( '/' ),
				'admin_email' => get_option( 'admin_email' ),
				'language'    => get_bloginfo( 'language' ),
				'timezone'    => wp_timezone_string(),
				'front_page'  => array(
					'shows'          => get_option( 'show_on_front' ),
					'page_on_front'  => $front,
					'front_title'    => $front ? get_the_title( $front ) : '',
					'page_for_posts' => $posts,
					'posts_title'    => $posts ? get_the_title( $posts ) : '',
				),
				'branding'    => array(
					'logo_id'  => $logo_id && get_post( $logo_id ) ? $logo_id : 0,
					'logo_url' => ( $logo_id && get_post( $logo_id ) ) ? (string) wp_get_attachment_url( $logo_id ) : '',
					'icon_id'  => $icon_id && get_post( $icon_id ) ? $icon_id : 0,
					'icon_url' => ( $icon_id && get_post( $icon_id ) ) ? get_site_icon_url( 192 ) : '',
				),
			);
		}

		/**
		 * MCP — write site-level settings.
		 *
		 * $force separates the two verbs the ability exposes: "set" replaces whatever
		 * is there, "update" only fills in what is missing. A build that invents a
		 * logo should not silently overwrite the one the site owner chose, which is
		 * why filling-in is the softer default and replacing has to be asked for.
		 *
		 * Only the fields present in the payload are touched either way.
		 *
		 * @param array $payload [title], [tagline], [logo_url], [icon_url], [front_page_id], [posts_page_id].
		 * @param bool  $force   Replace values that are already set.
		 * @return array|\WP_Error
		 */
		public static function mcp_platform_set_site( $payload, $force = false ) {
			$payload = is_array( $payload ) ? $payload : array();
			$updated = array();
			$skipped = array();

			foreach ( array( 'title' => 'blogname', 'tagline' => 'blogdescription' ) as $key => $option ) {
				if ( ! isset( $payload[ $key ] ) ) {
					continue;
				}
				$current = (string) get_option( $option, '' );
				if ( '' !== $current && ! $force ) {
					$skipped[ $key ] = 'Already set to "' . $current . '". Use action="set-site-settings" to replace it.';
					continue;
				}
				update_option( $option, sanitize_text_field( (string) $payload[ $key ] ) );
				$updated[] = $key;
			}

			foreach ( array( 'front_page_id' => 'page_on_front', 'posts_page_id' => 'page_for_posts' ) as $key => $option ) {
				if ( ! isset( $payload[ $key ] ) ) {
					continue;
				}
				$page_id = absint( $payload[ $key ] );
				if ( $page_id && ! get_post( $page_id ) ) {
					return new \WP_Error( 'uich_invalid_post_id', "No post with id {$page_id} for {$key}." );
				}
				$current = absint( get_option( $option, 0 ) );
				if ( $current && ! $force ) {
					$skipped[ $key ] = "Already set to post {$current}. Use action=\"set-site-settings\" to replace it.";
					continue;
				}
				update_option( $option, $page_id );
				// A front page only takes effect once the reading setting says so.
				if ( 'page_on_front' === $option && $page_id ) {
					update_option( 'show_on_front', 'page' );
				}
				$updated[] = $key;
			}

			// Branding goes through the existing sideloading handler, which resolves
			// URLs to attachments and enforces the same already-set rule.
			$branding = null;
			if ( isset( $payload['logo_url'] ) || isset( $payload['icon_url'] ) ) {
				$branding = self::mcp_set_site_branding(
					array(
						'logo_url'    => isset( $payload['logo_url'] ) ? (string) $payload['logo_url'] : '',
						'logo_width'  => isset( $payload['logo_width'] ) ? absint( $payload['logo_width'] ) : 0,
						'logo_height' => isset( $payload['logo_height'] ) ? absint( $payload['logo_height'] ) : 0,
						'icon_url'    => isset( $payload['icon_url'] ) ? (string) $payload['icon_url'] : '',
						'force'       => (bool) $force,
					)
				);
				if ( is_wp_error( $branding ) ) {
					return $branding;
				}
				$updated[] = 'branding';
			}

			if ( ! $updated && ! $skipped ) {
				return new \WP_Error( 'uich_missing_param', 'Nothing to write supply at least one of title, tagline, logo_url, icon_url, front_page_id, posts_page_id.' );
			}

			return array(
				'mode'     => $force ? 'set' : 'update',
				'updated'  => $updated,
				'skipped'  => $skipped,
				'branding' => $branding,
				'site'     => self::mcp_platform_get_site(),
			);
		}

		// ============================================================
		// PLATFORM — SITE-WIDE HEAD + BODY CODE
		// ============================================================

		/**
		 * MCP — read the site-wide head and body code.
		 *
		 * Site scope lives in one option shared by every page, which is why it belongs
		 * here rather than on a page: writing it from a page action made it look like
		 * a property of that page when it is a property of the site.
		 *
		 * @return array
		 */
		public static function mcp_site_code_get() {
			$site = self::get_site_custom_code_option();

			return array(
				'site_before_head' => (string) $site['head'],
				'site_before_body' => (string) $site['footer'],
			);
		}

		/**
		 * MCP — REPLACE the site-wide head and/or body code.
		 *
		 * Only the scopes present in the payload are touched, so rewriting head cannot
		 * clear body; pass an empty string to deliberately clear one.
		 *
		 * @param array $payload [site_before_head], [site_before_body].
		 * @return array|\WP_Error
		 */
		public static function mcp_site_code_set( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$current = self::get_site_custom_code_option();
			$touched = array();

			$head = $current['head'];
			if ( isset( $payload['site_before_head'] ) ) {
				$head      = self::mcp_ensure_style_tag( (string) $payload['site_before_head'] );
				$touched[] = 'site_before_head';
			}

			$body = $current['footer'];
			if ( isset( $payload['site_before_body'] ) ) {
				$body      = self::mcp_ensure_script_tag( (string) $payload['site_before_body'] );
				$touched[] = 'site_before_body';
			}

			if ( ! $touched ) {
				return new \WP_Error( 'uich_missing_param', 'Nothing to set supply site_before_head and/or site_before_body.' );
			}

			self::update_site_custom_code_option( $head, $body );

			return array(
				'updated' => $touched,
				'code'    => self::mcp_site_code_get(),
				'message' => 'Replaced ' . implode( ', ', $touched ) . ' site-wide.',
			);
		}

		/**
		 * MCP — APPEND to the site-wide head and/or body code, skipping blocks that
		 * are already present. Duplicate <link href> URLs are dropped, so adding the
		 * same font link on every section upload cannot stack up.
		 *
		 * @param array $payload [site_before_head], [site_before_body].
		 * @return array|\WP_Error
		 */
		public static function mcp_site_code_update( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$head    = isset( $payload['site_before_head'] ) ? (string) $payload['site_before_head'] : '';
			$body    = isset( $payload['site_before_body'] ) ? (string) $payload['site_before_body'] : '';

			if ( '' === trim( $head ) && '' === trim( $body ) ) {
				return new \WP_Error( 'uich_missing_param', 'Nothing to append supply site_before_head and/or site_before_body.' );
			}

			self::mcp_append_site_custom_code( $head, $body );

			return array(
				'code'    => self::mcp_site_code_get(),
				'message' => 'Appended site-wide code (blocks already present were skipped).',
			);
		}

		// ============================================================
		// PLATFORM — NAV MENUS
		// ============================================================

		/**
		 * MCP — every nav menu with its items and theme locations.
		 *
		 * A <uichemy-nav-menu> placeholder renders whatever WordPress has assigned to
		 * the location, so "what will my header actually show?" is answered here and
		 * nowhere else — describe-site only counts the items.
		 *
		 * @param array $payload [menu_id] to read one menu.
		 * @return array
		 */
		public static function mcp_menu_get( $payload = array() ) {
			$payload  = is_array( $payload ) ? $payload : array();
			$only     = isset( $payload['menu_id'] ) ? absint( $payload['menu_id'] ) : 0;
			$assigned = get_nav_menu_locations();
			$menus    = array();

			foreach ( wp_get_nav_menus() as $menu ) {
				if ( $only && (int) $menu->term_id !== $only ) {
					continue;
				}

				$items = array();
				foreach ( (array) wp_get_nav_menu_items( $menu->term_id ) as $item ) {
					$items[] = array(
						'id'        => (int) $item->ID,
						'title'     => $item->title,
						'url'       => $item->url,
						'type'      => $item->type,
						'object'    => $item->object,
						'object_id' => (int) $item->object_id,
						'parent'    => (int) $item->menu_item_parent,
						'order'     => (int) $item->menu_order,
					);
				}

				$menus[] = array(
					'id'        => (int) $menu->term_id,
					'name'      => $menu->name,
					'slug'      => $menu->slug,
					'count'     => (int) $menu->count,
					'locations' => array_values( array_keys( $assigned, (int) $menu->term_id, true ) ),
					'items'     => $items,
				);
			}

			$locations = array();
			foreach ( get_registered_nav_menus() as $slug => $label ) {
				$locations[] = array(
					'slug'     => $slug,
					'label'    => $label,
					'menu_id'  => isset( $assigned[ $slug ] ) ? (int) $assigned[ $slug ] : 0,
					'assigned' => ! empty( $assigned[ $slug ] ),
				);
			}

			return array(
				'menus'     => $menus,
				'locations' => $locations,
				'message'   => $menus ? '' : 'No nav menus exist. action="update-menu" creates one from the published pages and assigns it to every theme location.',
			);
		}

		/**
		 * MCP — create or amend a nav menu.
		 *
		 * With no menu_id and nothing else, this is the old ensure-nav-menu: build a
		 * menu from the published pages and assign it everywhere, which is what a
		 * generated header needs before <uichemy-nav-menu> renders anything. With
		 * arguments it becomes targeted — rename, add pages or custom links, assign
		 * to specific locations.
		 *
		 * @param array $payload [menu_id], [menu_name], [name], [add_pages], [add_links], [locations], [replace_items].
		 * @return array|\WP_Error
		 */
		public static function mcp_menu_update( $payload = array() ) {
			$payload   = is_array( $payload ) ? $payload : array();
			$menu_id   = isset( $payload['menu_id'] ) ? absint( $payload['menu_id'] ) : 0;
			$add_pages = isset( $payload['add_pages'] ) && is_array( $payload['add_pages'] ) ? $payload['add_pages'] : array();
			$add_links = isset( $payload['add_links'] ) && is_array( $payload['add_links'] ) ? $payload['add_links'] : array();
			$locations = isset( $payload['locations'] ) && is_array( $payload['locations'] ) ? $payload['locations'] : array();
			$rename    = isset( $payload['name'] ) ? sanitize_text_field( (string) $payload['name'] ) : '';
			$replace   = ! empty( $payload['replace_items'] );

			// Nothing specific asked for: fall through to the from-scratch behaviour,
			// which already handles "a menu exists, leave it alone".
			if ( ! $menu_id && ! $add_pages && ! $add_links && ! $locations && '' === $rename ) {
				return self::mcp_ensure_nav_menu( $payload );
			}

			if ( ! $menu_id ) {
				$existing = wp_get_nav_menus();
				if ( $existing ) {
					$menu_id = (int) $existing[0]->term_id;
				} else {
					$name    = '' !== $rename ? $rename : ( isset( $payload['menu_name'] ) ? sanitize_text_field( (string) $payload['menu_name'] ) : 'Main Menu' );
					$created = wp_create_nav_menu( $name );
					if ( is_wp_error( $created ) ) {
						return $created;
					}
					$menu_id = (int) $created;
				}
			}

			$menu = wp_get_nav_menu_object( $menu_id );
			if ( ! $menu ) {
				return new \WP_Error( 'uich_menu_not_found', "No nav menu with id {$menu_id}." );
			}

			$changed = array();

			if ( '' !== $rename && $rename !== $menu->name ) {
				wp_update_nav_menu_object( $menu_id, array( 'menu-name' => $rename ) );
				$changed[] = 'name';
			}

			if ( $replace ) {
				foreach ( (array) wp_get_nav_menu_items( $menu_id ) as $item ) {
					wp_delete_post( (int) $item->ID, true );
				}
				$changed[] = 'cleared existing items';
			}

			$added = array();
			foreach ( $add_pages as $page_id ) {
				$page_id = absint( $page_id );
				$post    = $page_id ? get_post( $page_id ) : null;
				if ( ! $post ) {
					return new \WP_Error( 'uich_invalid_post_id', "No post with id {$page_id} to add to the menu." );
				}
				$item_id = wp_update_nav_menu_item(
					$menu_id,
					0,
					array(
						'menu-item-title'     => get_the_title( $page_id ),
						'menu-item-object'    => $post->post_type,
						'menu-item-object-id' => $page_id,
						'menu-item-type'      => 'post_type',
						'menu-item-status'    => 'publish',
					)
				);
				if ( ! is_wp_error( $item_id ) ) {
					$added[] = array( 'item_id' => (int) $item_id, 'post_id' => $page_id, 'title' => get_the_title( $page_id ) );
				}
			}

			foreach ( $add_links as $link ) {
				if ( ! is_array( $link ) || empty( $link['url'] ) ) {
					continue;
				}
				$item_id = wp_update_nav_menu_item(
					$menu_id,
					0,
					array(
						'menu-item-title'  => isset( $link['title'] ) ? sanitize_text_field( (string) $link['title'] ) : (string) $link['url'],
						'menu-item-url'    => esc_url_raw( (string) $link['url'] ),
						'menu-item-type'   => 'custom',
						'menu-item-status' => 'publish',
					)
				);
				if ( ! is_wp_error( $item_id ) ) {
					$added[] = array( 'item_id' => (int) $item_id, 'url' => (string) $link['url'] );
				}
			}
			if ( $added ) {
				$changed[] = count( $added ) . ' item(s) added';
			}

			if ( $locations ) {
				$registered = array_keys( get_registered_nav_menus() );
				$assigned   = get_nav_menu_locations();
				$applied    = array();
				foreach ( $locations as $slug ) {
					$slug = sanitize_key( (string) $slug );
					if ( ! in_array( $slug, $registered, true ) ) {
						return new \WP_Error(
							'uich_unknown_menu_location',
							sprintf( 'Unknown menu location "%s". This theme registers: %s.', $slug, implode( ', ', $registered ) )
						);
					}
					$assigned[ $slug ] = $menu_id;
					$applied[]         = $slug;
				}
				set_theme_mod( 'nav_menu_locations', $assigned );
				$changed[] = 'assigned to ' . implode( ', ', $applied );
			}

			$state = self::mcp_menu_get( array( 'menu_id' => $menu_id ) );

			return array(
				'menu_id' => $menu_id,
				'changed' => $changed,
				'added'   => $added,
				'menu'    => isset( $state['menus'][0] ) ? $state['menus'][0] : null,
				'message' => $changed
					? 'Menu ' . $menu_id . ': ' . implode( '; ', $changed ) . '.'
					: 'Nothing changed on menu ' . $menu_id . '.',
			);
		}

		/**
		 * MCP — delete a nav menu, guarded by the same stateless double-confirmation
		 * as delete-section. The token is bound to the menu and its item count, so it
		 * self-invalidates if the menu changes between the two calls.
		 *
		 * Deleting a menu unassigns it from every theme location, which silently
		 * empties any <uichemy-nav-menu> in a live header — hence the confirmation.
		 *
		 * @param array $payload menu_id, [confirm_token].
		 * @return array|\WP_Error
		 */
		public static function mcp_menu_delete( $payload ) {
			$payload  = is_array( $payload ) ? $payload : array();
			$menu_id  = isset( $payload['menu_id'] ) ? absint( $payload['menu_id'] ) : 0;
			$supplied = isset( $payload['confirm_token'] ) ? (string) $payload['confirm_token'] : '';

			if ( ! $menu_id ) {
				return new \WP_Error( 'uich_missing_param', 'delete-menu requires a menu_id. Call action="get-menu" to see them.' );
			}

			$menu = wp_get_nav_menu_object( $menu_id );
			if ( ! $menu ) {
				return new \WP_Error( 'uich_menu_not_found', "No nav menu with id {$menu_id}." );
			}

			$assigned = array_values( array_keys( get_nav_menu_locations(), $menu_id, true ) );
			$scope    = 'uichemy-del-menu|' . $menu_id . '|' . $menu->name . '|' . (int) $menu->count;
			$expected = substr( wp_hash( $scope ), 0, 16 );

			if ( '' === $supplied || ! hash_equals( $expected, $supplied ) ) {
				return array(
					'requires_confirmation' => true,
					'confirm_token'         => $expected,
					'menu_id'               => $menu_id,
					'name'                  => $menu->name,
					'items'                 => (int) $menu->count,
					'locations'             => $assigned,
					'message'               => $assigned
						? 'Deleting this menu is permanent and will empty the nav in ' . implode( ', ', $assigned ) . '. Re-call action=delete-menu with this exact confirm_token to proceed.'
						: 'Deleting this menu is permanent. Re-call action=delete-menu with this exact confirm_token to proceed.',
				);
			}

			$deleted = wp_delete_nav_menu( $menu_id );
			if ( is_wp_error( $deleted ) || ! $deleted ) {
				return new \WP_Error( 'uich_menu_delete_failed', "Could not delete nav menu {$menu_id}." );
			}

			return array(
				'deleted_menu_id' => $menu_id,
				'name'            => $menu->name,
				'freed_locations' => $assigned,
				'remaining_menus' => count( wp_get_nav_menus() ),
				'message'         => "Deleted nav menu \"{$menu->name}\" ({$menu_id}).",
			);
		}

		// ============================================================
		// MEDIA LIBRARY
		// ============================================================

		/**
		 * One attachment, described the way a caller about to put it in HTML needs it.
		 *
		 * The full-size URL alone is not enough: a hero wants a large size, a logo
		 * wants its intrinsic dimensions, and alt text has to come from somewhere. All
		 * of it is cheap to read here and expensive to discover one call at a time.
		 *
		 * @param int|\WP_Post $post Attachment.
		 * @return array
		 */
		private static function mcp_media_describe( $post ) {
			$post = get_post( $post );
			if ( ! $post ) {
				return array();
			}

			$id       = (int) $post->ID;
			$meta     = wp_get_attachment_metadata( $id );
			$file     = get_attached_file( $id );
			$is_image = wp_attachment_is_image( $id );

			$sizes = array();
			if ( $is_image && ! empty( $meta['sizes'] ) && is_array( $meta['sizes'] ) ) {
				foreach ( $meta['sizes'] as $size => $info ) {
					$src = wp_get_attachment_image_src( $id, $size );
					if ( $src ) {
						$sizes[ $size ] = array(
							'url'    => $src[0],
							'width'  => (int) $src[1],
							'height' => (int) $src[2],
						);
					}
				}
			}

			return array(
				'id'          => $id,
				'title'       => $post->post_title,
				'filename'    => $file ? wp_basename( $file ) : '',
				'url'         => (string) wp_get_attachment_url( $id ),
				'mime'        => get_post_mime_type( $id ),
				'alt'         => (string) get_post_meta( $id, '_wp_attachment_image_alt', true ),
				'caption'     => $post->post_excerpt,
				'description' => $post->post_content,
				'width'       => isset( $meta['width'] ) ? (int) $meta['width'] : 0,
				'height'      => isset( $meta['height'] ) ? (int) $meta['height'] : 0,
				'filesize'    => ( $file && file_exists( $file ) ) ? (int) filesize( $file ) : 0,
				'uploaded'    => $post->post_date_gmt,
				'sizes'       => $sizes,
				'edit_link'   => get_edit_post_link( $id, 'raw' ),
			);
		}

		/**
		 * MCP — list media library items, newest first.
		 *
		 * @param array $payload [mime], [per_page], [page].
		 * @return array
		 */
		public static function mcp_media_list( $payload ) {
			$payload  = is_array( $payload ) ? $payload : array();
			$mime     = isset( $payload['mime'] ) ? (string) $payload['mime'] : '';
			$per_page = isset( $payload['per_page'] ) ? max( 1, min( 100, (int) $payload['per_page'] ) ) : 20;
			$page     = isset( $payload['page'] ) ? max( 1, (int) $payload['page'] ) : 1;

			$query = new \WP_Query(
				array(
					'post_type'      => 'attachment',
					'post_status'    => 'inherit',
					'posts_per_page' => $per_page,
					'paged'          => $page,
					'orderby'        => 'date',
					'order'          => 'DESC',
					'post_mime_type' => '' !== $mime ? $mime : array( 'image', 'video' ),
				)
			);

			$items = array();
			foreach ( $query->posts as $attachment ) {
				$items[] = self::mcp_media_describe( $attachment );
			}

			return array(
				'items'       => $items,
				'count'       => count( $items ),
				'total'       => (int) $query->found_posts,
				'page'        => $page,
				'total_pages' => (int) $query->max_num_pages,
			);
		}

		/**
		 * MCP — search the media library by text, so a caller can reuse an asset that
		 * is already uploaded instead of requesting a slot and uploading it twice.
		 *
		 * Matches WordPress's own admin search (title, caption, description, filename)
		 * and additionally alt text, which the core search ignores but which is often
		 * the only place a logo is described as "logo".
		 *
		 * @param array $payload query, [mime], [per_page].
		 * @return array|\WP_Error
		 */
		public static function mcp_media_find( $payload ) {
			$payload  = is_array( $payload ) ? $payload : array();
			$query    = isset( $payload['query'] ) ? trim( (string) $payload['query'] ) : '';
			$mime     = isset( $payload['mime'] ) ? (string) $payload['mime'] : '';
			$per_page = isset( $payload['per_page'] ) ? max( 1, min( 100, (int) $payload['per_page'] ) ) : 20;

			if ( '' === $query ) {
				return new \WP_Error( 'uich_missing_param', 'find requires a "query".' );
			}

			$base = array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'posts_per_page' => $per_page,
				'post_mime_type' => '' !== $mime ? $mime : array( 'image', 'video' ),
				'fields'         => 'ids',
				'no_found_rows'  => true,
			);

			$by_text = get_posts( array_merge( $base, array( 's' => $query ) ) );

			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Alt text is only reachable through meta; the core 's' search does not cover it.
			$by_alt = get_posts(
				array_merge(
					$base,
					array(
						'meta_query' => array(  // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Admin scan; meta query acceptable here.
							array(
								'key'     => '_wp_attachment_image_alt',
								'value'   => $query,
								'compare' => 'LIKE',
							),
						),
					)
				)
			);

			$ids   = array_slice( array_unique( array_merge( $by_text, $by_alt ) ), 0, $per_page );
			$items = array();
			foreach ( $ids as $id ) {
				$items[] = self::mcp_media_describe( $id );
			}

			return array(
				'query'   => $query,
				'count'   => count( $items ),
				'items'   => $items,
				'message' => $items
					? ''
					: 'Nothing matched the asset is probably not uploaded yet, so request an upload slot for it.',
			);
		}

		/**
		 * MCP — one attachment by id, or by a URL already in the media library.
		 *
		 * @param array $payload [id], [url].
		 * @return array|\WP_Error
		 */
		public static function mcp_media_get( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$id      = isset( $payload['id'] ) ? absint( $payload['id'] ) : 0;
			$url     = isset( $payload['url'] ) ? (string) $payload['url'] : '';

			if ( ! $id && '' !== $url ) {
				$id = (int) attachment_url_to_postid( $url );
				if ( ! $id ) {
					return new \WP_Error( 'uich_media_not_found', 'That URL is not an attachment in this media library: ' . $url );
				}
			}

			if ( ! $id ) {
				return new \WP_Error( 'uich_missing_param', 'get requires an "id" or a media-library "url".' );
			}
			if ( 'attachment' !== get_post_type( $id ) ) {
				return new \WP_Error( 'uich_media_not_found', "No attachment with id {$id}." );
			}

			return self::mcp_media_describe( $id );
		}

		/**
		 * MCP — update an attachment's text fields.
		 *
		 * Alt text is the one that matters for a built page: a sideloaded image starts
		 * with none, and every <img> UiChemy writes should have it. Only the fields
		 * present in the payload are written, so setting alt cannot blank a caption.
		 *
		 * @param array $payload id, [alt], [title], [caption], [description].
		 * @return array|\WP_Error
		 */
		public static function mcp_media_update( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$id      = isset( $payload['id'] ) ? absint( $payload['id'] ) : 0;

			if ( ! $id || 'attachment' !== get_post_type( $id ) ) {
				return new \WP_Error( 'uich_media_not_found', 'update requires the "id" of an existing attachment.' );
			}

			$updated = array();

			if ( isset( $payload['alt'] ) ) {
				update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( (string) $payload['alt'] ) );
				$updated[] = 'alt';
			}

			$post_fields = array();
			if ( isset( $payload['title'] ) ) {
				$post_fields['post_title'] = sanitize_text_field( (string) $payload['title'] );
				$updated[]                 = 'title';
			}
			if ( isset( $payload['caption'] ) ) {
				$post_fields['post_excerpt'] = wp_kses_post( (string) $payload['caption'] );
				$updated[]                   = 'caption';
			}
			if ( isset( $payload['description'] ) ) {
				$post_fields['post_content'] = wp_kses_post( (string) $payload['description'] );
				$updated[]                   = 'description';
			}

			if ( $post_fields ) {
				$post_fields['ID'] = $id;
				$result            = wp_update_post( $post_fields, true );
				if ( is_wp_error( $result ) ) {
					return $result;
				}
			}

			if ( ! $updated ) {
				return new \WP_Error( 'uich_missing_param', 'Nothing to update supply at least one of alt, title, caption, description.' );
			}

			return array(
				'updated' => $updated,
				'media'   => self::mcp_media_describe( $id ),
				'message' => 'Updated ' . implode( ', ', $updated ) . " on attachment {$id}.",
			);
		}

		// ============================================================
		// NATIVE THEME BUILDER — conditions / list / toggle / delete
		// ============================================================
		//
		// The NATIVE UiChemy theme builder: templates live in UiChemy's own CPT
		// rather than Elementor Pro's elementor_library or Nexter's nxt_builder,
		// which is what lets it work on free Elementor and support archive /
		// product / search / 404 types that neither of those exposes here.
		//
		// The engine ships in includes/theme-builder/ (UiChemy_Template_Store,
		// UiChemy_Template_CPT, UiChemy_Template_Resolver). Every method below
		// still guards on those classes, so a build without them answers with a
		// clean "unavailable" error instead of fataling.
		//
		// Creation lives further up in this class — see
		// create_theme_builder_template() and normalize_theme_builder_placement().
		//
		// NOTE: this overlaps uichemy-composer/template, which drives the Pro/Nexter builders.
		// They are different backends, not duplicates — decide later whether one
		// absorbs the other.

		/**
		 * MCP — attach v2 display conditions (and optional target) to a native
		 * UiChemy theme-builder template. THE unlock: specific page/post IDs, whole
		 * post-types, authors, specific taxonomy terms, front/blog/date/search/404,
		 * mixed include+exclude. Reuses the store's rule sanitizer.
		 *
		 * @param array $payload post_id, [rules], [scope], [include], [exclude], [target].
		 * @return array|\WP_Error
		 */
		public static function mcp_set_theme_builder_conditions( $payload ) {
			if ( ! class_exists( 'UiChemy_Template_Store' ) || ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return new \WP_Error( 'uich_tb_unavailable', 'The UiChemy Theme Builder is not available.' );
			}
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( ! $post_id || ! UiChemy_Template_Store::is_template( $post_id ) ) {
				return new \WP_Error( 'uich_tb_not_found', 'post_id is not a UiChemy theme-builder template.' );
			}

			$has_rules  = isset( $payload['rules'] ) && is_array( $payload['rules'] );
			$has_legacy = isset( $payload['scope'] ) || isset( $payload['include'] ) || isset( $payload['exclude'] );
			$has_target = isset( $payload['target'] );
			if ( ! $has_rules && ! $has_legacy && ! $has_target ) {
				return new \WP_Error( 'uich_tb_no_conditions', 'set-conditions needs at least one of: rules, scope, include, exclude, target.' );
			}

			$conditions = array();
			if ( $has_rules ) {
				$conditions['rules'] = $payload['rules'];
			}
			if ( isset( $payload['scope'] ) ) {
				$conditions['scope'] = ( 'specific' === $payload['scope'] ) ? 'specific' : 'entire';
			}
			if ( isset( $payload['include'] ) && is_array( $payload['include'] ) ) {
				$conditions['include'] = array_values( array_filter( array_map( 'absint', $payload['include'] ) ) );
			}
			if ( isset( $payload['exclude'] ) && is_array( $payload['exclude'] ) ) {
				$conditions['exclude'] = array_values( array_filter( array_map( 'absint', $payload['exclude'] ) ) );  // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_exclude -- Small admin-scoped exclusion list.
			}

			if ( ! empty( $conditions ) ) {
				UiChemy_Template_Store::update_conditions( $post_id, $conditions );
			}
			if ( $has_target ) {
				update_post_meta( $post_id, UiChemy_Template_CPT::META_TARGET, UiChemy_Template_Store::sanitize_target( $payload['target'] ) );
			}
			if ( class_exists( 'UiChemy_Template_Resolver' ) && method_exists( 'UiChemy_Template_Resolver', 'flush_cache' ) ) {
				UiChemy_Template_Resolver::flush_cache();
			}

			$stored = get_post_meta( $post_id, UiChemy_Template_CPT::META_CONDITIONS, true );
			$stored = is_array( $stored ) ? $stored : array();
			return array(
				'post_id'    => $post_id,
				'type'       => (string) get_post_meta( $post_id, UiChemy_Template_CPT::META_TYPE, true ),
				'target'     => UiChemy_Template_CPT::target_for( $post_id ),
				'conditions' => $stored,
				'rule_count' => ( isset( $stored['rules'] ) && is_array( $stored['rules'] ) ) ? count( $stored['rules'] ) : 0,
				'message'    => 'Display conditions updated. (Note: on single/archive templates, page-ID / term rules only fire when the template TARGET matches the request first for specific-page or specific-term targeting prefer a header/footer template.)',
			);
		}

		/**
		 * MCP — list native UiChemy theme-builder templates (uichemy_template posts),
		 * NOT the Elementor Pro / Nexter templates that uichemy/list-templates returns.
		 *
		 * @param array $payload [type], [status].
		 * @return array|\WP_Error
		 */

		/**
		 * MCP — list native UiChemy theme-builder templates (uichemy_template posts),
		 * NOT the Elementor Pro / Nexter templates that uichemy/list-templates returns.
		 *
		 * @param array $payload [type], [status].
		 * @return array|\WP_Error
		 */
		public static function mcp_list_theme_builder_templates( $payload ) {
			if ( ! class_exists( 'UiChemy_Template_Store' ) || ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return new \WP_Error( 'uich_tb_unavailable', 'The UiChemy Theme Builder is not available.' );
			}
			$payload       = is_array( $payload ) ? $payload : array();
			$type_filter   = isset( $payload['type'] ) ? sanitize_key( (string) $payload['type'] ) : '';
			$status_filter = isset( $payload['status'] ) ? sanitize_key( (string) $payload['status'] ) : '';
			$types         = ( '' !== $type_filter && UiChemy_Template_CPT::is_valid_type( $type_filter ) )
				? array( $type_filter )
				: UiChemy_Template_CPT::TYPES;

			$templates = array();
			foreach ( $types as $type ) {
				foreach ( (array) UiChemy_Template_Store::get_by_type( $type ) as $tid ) {
					$tid    = (int) $tid;
					$status = (string) get_post_meta( $tid, UiChemy_Template_CPT::META_STATUS, true );
					$status = ( 'active' === $status ) ? 'active' : 'inactive';
					if ( '' !== $status_filter && $status_filter !== $status ) {
						continue;
					}
					$conditions  = get_post_meta( $tid, UiChemy_Template_CPT::META_CONDITIONS, true );
					$templates[] = array(
						'id'           => $tid,
						'title'        => get_the_title( $tid ),
						'type'         => $type,
						'status'       => $status,
						'target'       => UiChemy_Template_CPT::target_for( $tid ),
						'editor'       => UiChemy_Template_CPT::editor_for( $tid ),
						'conditions'   => is_array( $conditions ) ? $conditions : array(),
						'edit_link'    => add_query_arg( array( 'post' => $tid, 'action' => 'elementor' ), admin_url( 'post.php' ) ),
						'preview_link' => get_permalink( $tid ),
					);
				}
			}
			return array( 'total' => count( $templates ), 'templates' => $templates );
		}

		/**
		 * MCP — activate/deactivate a UiChemy theme-builder template. Activating
		 * re-runs the one-active-per-slot dedupe.
		 *
		 * @param array $payload post_id, status (active|inactive).
		 * @return array|\WP_Error
		 */

		/**
		 * MCP — activate/deactivate a UiChemy theme-builder template. Activating
		 * re-runs the one-active-per-slot dedupe.
		 *
		 * @param array $payload post_id, status (active|inactive).
		 * @return array|\WP_Error
		 */
		public static function mcp_toggle_theme_builder_template( $payload ) {
			if ( ! class_exists( 'UiChemy_Template_Store' ) || ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return new \WP_Error( 'uich_tb_unavailable', 'The UiChemy Theme Builder is not available.' );
			}
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( ! $post_id || ! UiChemy_Template_Store::is_template( $post_id ) ) {
				return new \WP_Error( 'uich_tb_not_found', 'post_id is not a UiChemy theme-builder template.' );
			}
			$raw = isset( $payload['status'] ) ? sanitize_key( (string) $payload['status'] ) : '';
			if ( ! in_array( $raw, array( 'active', 'inactive' ), true ) ) {
				return new \WP_Error( 'uich_tb_bad_status', 'toggle requires status = "active" or "inactive".' );
			}
			UiChemy_Template_Store::set_status( $post_id, $raw );
			if ( class_exists( 'UiChemy_Template_Resolver' ) && method_exists( 'UiChemy_Template_Resolver', 'flush_cache' ) ) {
				UiChemy_Template_Resolver::flush_cache();
			}
			return array(
				'post_id' => $post_id,
				'type'    => (string) get_post_meta( $post_id, UiChemy_Template_CPT::META_TYPE, true ),
				'status'  => $raw,
				'active'  => ( 'active' === $raw ),
				'message' => 'Template set to ' . $raw . '.',
			);
		}

		/**
		 * MCP — delete a UiChemy theme-builder template, guarded by the same stateless
		 * double-confirmation as section delete (token bound to id + title + type).
		 *
		 * @param array $payload post_id, [confirm_token].
		 * @return array|\WP_Error
		 */

		/**
		 * MCP — delete a UiChemy theme-builder template, guarded by the same stateless
		 * double-confirmation as section delete (token bound to id + title + type).
		 *
		 * @param array $payload post_id, [confirm_token].
		 * @return array|\WP_Error
		 */
		public static function mcp_delete_theme_builder_template( $payload ) {
			if ( ! class_exists( 'UiChemy_Template_Store' ) || ! class_exists( 'UiChemy_Template_CPT' ) ) {
				return new \WP_Error( 'uich_tb_unavailable', 'The UiChemy Theme Builder is not available.' );
			}
			$payload  = is_array( $payload ) ? $payload : array();
			$post_id  = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$supplied = isset( $payload['confirm_token'] ) ? (string) $payload['confirm_token'] : '';
			if ( ! $post_id || ! UiChemy_Template_Store::is_template( $post_id ) ) {
				return new \WP_Error( 'uich_tb_not_found', 'post_id is not a UiChemy theme-builder template.' );
			}
			$type   = (string) get_post_meta( $post_id, UiChemy_Template_CPT::META_TYPE, true );
			$title  = get_the_title( $post_id );
			$status = (string) get_post_meta( $post_id, UiChemy_Template_CPT::META_STATUS, true );

			$scope    = 'uichemy-del-template|' . $post_id . '|' . md5( $title . '|' . $type );
			$expected = substr( wp_hash( $scope ), 0, 16 );

			if ( '' === $supplied || ! hash_equals( $expected, $supplied ) ) {
				return array(
					'requires_confirmation' => true,
					'confirm_token'         => $expected,
					'post_id'               => $post_id,
					'type'                  => $type,
					'title'                 => $title,
					'status'                => ( 'active' === $status ) ? 'active' : 'inactive',
					'target'                => UiChemy_Template_CPT::target_for( $post_id ),
					'message'               => 'Deleting this template is permanent. Re-call action=delete with this exact confirm_token to proceed.',
				);
			}

			UiChemy_Template_Store::delete( $post_id, true );
			if ( class_exists( 'UiChemy_Template_Resolver' ) && method_exists( 'UiChemy_Template_Resolver', 'flush_cache' ) ) {
				UiChemy_Template_Resolver::flush_cache();
			}
			return array(
				'post_id' => $post_id,
				'deleted' => true,
				'type'    => $type,
				'message' => 'Deleted the "' . $type . '" theme-builder template.',
			);
		}

		/**
		 * Resolve a single external image URL via the media library, with de-dupe cache + logs.
		 *
		 * @param string              $original_url Original URL.
		 * @param array<string,string> $url_cache    Map original → resolved (by ref).
		 * @param array<int,array<string,string>> $uploaded Successful uploads (by ref).
		 * @param array<int,array<string,string>> $failed   Failures (by ref).
		 * @return string Resolved URL (may equal original on failure).
		 */

		// ============================================================
		// THEME BUILDER — CONDITIONS / ACTIVATION / DELETE
		// ============================================================

		/**
		 * Which builder owns a template post, and where its activation state lives.
		 *
		 * Elementor Pro stores display conditions in `_elementor_conditions` and treats
		 * a non-empty array as active. Nexter keeps a separate `nxt_build_status` flag
		 * beside its own section meta. Everything below branches on this once instead
		 * of re-deriving it per operation.
		 *
		 * @param int $post_id Template post ID.
		 * @return array|\WP_Error { system, post_type, type }
		 */
		private static function mcp_template_system( $post_id ) {
			$post_id   = absint( $post_id );
			$post_type = $post_id ? get_post_type( $post_id ) : '';

			if ( 'elementor_library' === $post_type ) {
				return array(
					'system'    => 'elementor_pro',
					'post_type' => $post_type,
					'type'      => (string) get_post_meta( $post_id, '_elementor_template_type', true ),
				);
			}
			if ( 'nxt_builder' === $post_type ) {
				return array(
					'system'    => 'nexter',
					'post_type' => $post_type,
					'type'      => (string) get_post_meta( $post_id, 'nxt-hooks-layout-sections', true ),
				);
			}

			return new \WP_Error( 'uich_not_a_template', 'post_id ' . $post_id . ' is not a theme-builder template (expected elementor_library or nxt_builder).' );
		}

		/**
		 * MCP — set a template's display conditions.
		 *
		 * A template with no conditions renders nowhere, which is the trap on plain
		 * Elementor: the template exists, the build looks finished, and the site is
		 * unchanged. `scope="site"` is the common case and is spelled out here so the
		 * caller does not have to know Elementor's `include/general` syntax.
		 *
		 * @param array $payload post_id, [scope], [rules].
		 * @return array|\WP_Error
		 */
		public static function mcp_template_set_conditions( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$scope   = isset( $payload['scope'] ) ? sanitize_key( (string) $payload['scope'] ) : '';
			$rules   = isset( $payload['rules'] ) && is_array( $payload['rules'] ) ? array_map( 'strval', $payload['rules'] ) : array();

			$system = self::mcp_template_system( $post_id );
			if ( is_wp_error( $system ) ) {
				return $system;
			}

			if ( ! $rules ) {
				$presets = array(
					'site'     => array( 'include/general' ),
					'front'    => array( 'include/general/front_page' ),
					'singular' => array( 'include/singular' ),
					'archive'  => array( 'include/archive' ),
					'none'     => array(),
				);
				if ( '' === $scope || ! isset( $presets[ $scope ] ) ) {
					return new \WP_Error(
						'uich_missing_param',
						'set-conditions needs "scope" (site | front | singular | archive | none) or an explicit "rules" array.'
					);
				}
				$rules = $presets[ $scope ];
			}

			if ( 'elementor_pro' === $system['system'] ) {
				if ( $rules ) {
					update_post_meta( $post_id, '_elementor_conditions', $rules );
				} else {
					delete_post_meta( $post_id, '_elementor_conditions' );
				}
			} else {
				// Nexter has no per-rule condition store here; site-wide vs off is the
				// distinction it exposes, so map onto its status flag and say so.
				update_post_meta( $post_id, 'nxt_build_status', $rules ? '1' : '0' );
			}

			if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'    => $post_id,
				'system'     => $system['system'],
				'type'       => $system['type'],
				'conditions' => $rules,
				'active'     => (bool) $rules,
				'message'    => 'nexter' === $system['system']
					? 'Nexter templates are either on site-wide or off; conditions were applied as ' . ( $rules ? 'on' : 'off' ) . '.'
					: 'Conditions set to ' . ( $rules ? implode( ', ', $rules ) : 'none (template renders nowhere)' ) . '.',
			);
		}

		/**
		 * MCP — turn a template on or off without losing its conditions.
		 *
		 * Elementor's only "off" is having no conditions, so the current set is stashed
		 * before deactivating and restored on the way back — otherwise toggling twice
		 * would silently discard the site-wide rule the build set up.
		 *
		 * @param array $payload post_id, active.
		 * @return array|\WP_Error
		 */
		public static function mcp_template_toggle( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;

			if ( ! isset( $payload['active'] ) ) {
				return new \WP_Error( 'uich_missing_param', 'toggle requires "active" (true to activate, false to deactivate).' );
			}
			$active = (bool) $payload['active'];

			$system = self::mcp_template_system( $post_id );
			if ( is_wp_error( $system ) ) {
				return $system;
			}

			if ( 'elementor_pro' === $system['system'] ) {
				$current = get_post_meta( $post_id, '_elementor_conditions', true );

				if ( $active ) {
					$restore = get_post_meta( $post_id, '_uichemy_stashed_conditions', true );
					$rules   = ( is_array( $current ) && $current )
						? $current
						: ( is_array( $restore ) && $restore ? $restore : array( 'include/general' ) );
					update_post_meta( $post_id, '_elementor_conditions', $rules );
					delete_post_meta( $post_id, '_uichemy_stashed_conditions' );
				} else {
					if ( is_array( $current ) && $current ) {
						update_post_meta( $post_id, '_uichemy_stashed_conditions', $current );
					}
					delete_post_meta( $post_id, '_elementor_conditions' );
					$rules = array();
				}
			} else {
				update_post_meta( $post_id, 'nxt_build_status', $active ? '1' : '0' );
				$rules = $active ? array( 'include/general' ) : array();
			}

			if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'    => $post_id,
				'system'     => $system['system'],
				'type'       => $system['type'],
				'active'     => $active,
				'conditions' => $rules,
				'message'    => ( $active ? 'Activated' : 'Deactivated' ) . ' template ' . $post_id . '.',
			);
		}

		/**
		 * MCP — delete a theme-builder template, guarded by the same stateless
		 * double-confirmation as delete-section and delete-menu.
		 *
		 * An active header or footer disappearing changes every page on the site at
		 * once, so the first call only reports what would go.
		 *
		 * @param array $payload post_id, [confirm_token].
		 * @return array|\WP_Error
		 */
		public static function mcp_template_delete( $payload ) {
			$payload  = is_array( $payload ) ? $payload : array();
			$post_id  = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$supplied = isset( $payload['confirm_token'] ) ? (string) $payload['confirm_token'] : '';

			$system = self::mcp_template_system( $post_id );
			if ( is_wp_error( $system ) ) {
				return $system;
			}

			$title      = get_the_title( $post_id );
			$conditions = get_post_meta( $post_id, '_elementor_conditions', true );
			$is_active  = 'nexter' === $system['system']
				? '1' === get_post_meta( $post_id, 'nxt_build_status', true )
				: ( is_array( $conditions ) && $conditions );

			$scope    = 'uichemy-del-template|' . $post_id . '|' . $title . '|' . ( $is_active ? '1' : '0' );
			$expected = substr( wp_hash( $scope ), 0, 16 );

			if ( '' === $supplied || ! hash_equals( $expected, $supplied ) ) {
				return array(
					'requires_confirmation' => true,
					'confirm_token'         => $expected,
					'post_id'               => $post_id,
					'title'                 => $title,
					'system'                => $system['system'],
					'type'                  => $system['type'],
					'active'                => (bool) $is_active,
					'message'               => $is_active
						? 'This template is ACTIVE deleting it changes every page it renders on. Re-call action=delete with this exact confirm_token to proceed.'
						: 'Deleting this template is permanent. Re-call action=delete with this exact confirm_token to proceed.',
				);
			}

			$deleted = wp_delete_post( $post_id, true );
			if ( ! $deleted ) {
				return new \WP_Error( 'uich_template_delete_failed', "Could not delete template {$post_id}." );
			}

			if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'deleted_post_id' => $post_id,
				'title'           => $title,
				'system'          => $system['system'],
				'was_active'      => (bool) $is_active,
				'message'         => "Deleted template \"{$title}\" ({$post_id}).",
			);
		}

		// ============================================================
		// DYNAMIC DATA — BINDINGS AND TAGS
		// ============================================================

		/**
		 * MCP — the exact Twig token for one field on one provider.
		 *
		 * The failure this prevents is a plausible-looking guess: `{{ post.subtitle }}`
		 * when the engine only exposes `{{ post.meta('subtitle') }}`, which renders
		 * empty instead of erroring. Native accessors are listed per provider, and
		 * anything not in that list is a meta key.
		 *
		 * @param array $payload provider, field, [size].
		 * @return array|\WP_Error
		 */
		public static function mcp_dynamic_bind_field( $payload ) {
			$payload  = is_array( $payload ) ? $payload : array();
			$provider = isset( $payload['provider'] ) ? sanitize_key( (string) $payload['provider'] ) : '';
			$field    = isset( $payload['field'] ) ? trim( (string) $payload['field'] ) : '';
			$size     = isset( $payload['size'] ) ? sanitize_key( (string) $payload['size'] ) : '';

			$natives = array(
				'post'    => array( 'title', 'content', 'excerpt', 'permalink', 'date', 'thumbnail', 'id', 'slug' ),
				'product' => array( 'title', 'permalink', 'price', 'regular_price', 'sale_price', 'sku', 'stock_status', 'thumbnail' ),
				'term'    => array( 'name', 'slug', 'description', 'link', 'count', 'id' ),
				'user'    => array( 'name', 'display_name', 'email', 'bio', 'avatar', 'url', 'id' ),
				'author'  => array( 'name', 'display_name', 'email', 'bio', 'avatar', 'url', 'id' ),
				'site'    => array( 'name', 'title', 'description', 'url', 'logo' ),
			);

			if ( ! isset( $natives[ $provider ] ) ) {
				return new \WP_Error(
					'uich_unknown_provider',
					'Unknown provider "' . $provider . '". Valid: ' . implode( ', ', array_keys( $natives ) ) . '.'
				);
			}
			if ( '' === $field ) {
				return new \WP_Error( 'uich_missing_param', 'bind-field requires a "field". Call uichemy-composer/describe-site for the real field names and metaKeys.' );
			}

			$is_native = in_array( $field, $natives[ $provider ], true );
			$token     = $is_native
				? '{{ ' . $provider . '.' . $field . ' }}'
				: '{{ ' . $provider . ".meta('" . $field . "') }}";

			// An image field needs a size before it is a usable src.
			if ( '' !== $size ) {
				$token = $is_native
					? '{{ ' . $provider . '.' . $field . ".src('" . $size . "') }}"
					: '{{ ' . $provider . ".meta('" . $field . "').src('" . $size . "') }}";
			}

			return array(
				'provider' => $provider,
				'field'    => $field,
				'kind'     => $is_native ? 'native accessor' : 'custom field (meta)',
				'token'    => $token,
				'natives'  => $natives[ $provider ],
				'message'  => $is_native
					? 'Paste this token straight into your section HTML.'
					: 'Treated as a meta key. Confirm it against the field map from uichemy-composer/describe-site a key that does not exist renders empty rather than failing.',
			);
		}

		/**
		 * MCP — emit a UiChemy placeholder tag.
		 *
		 * These are resolved server-side at render time, so they are the only correct
		 * way to output a nav menu, the post body or the site logo: hand-written markup
		 * would freeze whatever was true when the section was generated.
		 *
		 * @param array $payload tag.
		 * @return array|\WP_Error
		 */
		public static function mcp_dynamic_add_tag( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$tag     = isset( $payload['tag'] ) ? sanitize_key( str_replace( '_', '-', (string) $payload['tag'] ) ) : '';

			$tags = array(
				'post-content' => 'The post/page body, rendered by WordPress. Required in a single template; never put it on a normal page.',
				'nav-menu'     => 'The nav menu assigned to the theme location. Renders empty when no menu is assigned uichemy-composer/platform update-menu fixes that.',
				'site-logo'    => 'The site custom_logo. Set it with uichemy-composer/platform update-site-settings.',
				'site-icon'    => 'The site icon (favicon).',
				'toc'          => 'A table of contents built from the headings in the post content.',
			);

			// WooCommerce tags. Offered only when Woo is active: a tag that always
			// renders nothing is worse than one that is absent, because the absence
			// is the answer to "can I build a checkout here?".
			$woo_tags = array(
				'woo-cart'           => 'WooCommerce\'s cart. Put it on the page assigned as the CART page (uichemy-composer/store, action="describe-store" reports which that is) put your own markup around it, never in place of it.',
				'woo-checkout'       => 'WooCommerce\'s checkout form, and the thank-you view on the order-received endpoint. Belongs on the assigned CHECKOUT page some gateways check is_checkout(), which is only true there.',
				'woo-my-account'     => 'WooCommerce\'s account area login, orders, addresses. Belongs on the assigned MY-ACCOUNT page.',
				'woo-order-tracking' => 'The "track your order" form, for a page where customers look up an order by number and email.',
				'woo-notices'        => 'WooCommerce\'s notices coupon applied, item added, checkout errors. A custom cart or checkout layout that omits this swallows every error message the customer needs to see.',
			);

			if ( class_exists( 'WooCommerce' ) ) {
				$tags = array_merge( $tags, $woo_tags );
			}

			if ( ! isset( $tags[ $tag ] ) ) {
				// Naming a Woo tag that exists but is unavailable is more useful than
				// listing it among unknown names it tells the caller to activate
				// WooCommerce rather than to look for a typo.
				if ( isset( $woo_tags[ $tag ] ) ) {
					return new \WP_Error(
						'uich_woo_inactive',
						'The "' . $tag . '" tag needs WooCommerce, which is not active on this site.'
					);
				}

				return new \WP_Error(
					'uich_unknown_tag',
					'Unknown tag "' . $tag . '". Valid: ' . implode( ', ', array_keys( $tags ) ) . '.'
				);
			}

			$is_woo = isset( $woo_tags[ $tag ] );

			return array(
				'tag'   => $tag,
				'html'  => '<uichemy-' . $tag . ' />',
				'note'  => $tags[ $tag ],
				'usage' => $is_woo
					? 'Insert this element into the section HTML you pass to uichemy-composer/page. It renders WooCommerce\'s own output, so style AROUND it and with CSS do not rebuild the flow as markup. In the UiChemy editor it shows a labelled placeholder rather than a live cart, because the cart needs a customer session that does not exist there.'
					: 'Insert this element into the section HTML you pass to uichemy-composer/page, post or template.',
			);
		}

		/**
		 * MCP — build a data-bound Twig listing over real content.
		 *
		 * Emits the `{% for %}` wrapper around the caller's per-item template rather
		 * than inventing the item markup: the loop mechanics are what get guessed
		 * wrong, the design is not. The post type and any taxonomy filter are validated
		 * against what is actually registered, so a loop cannot be built over a type
		 * that does not exist.
		 *
		 * @param array $payload source, item_html, [post_type], [taxonomy], [term], [limit], [orderby], [order].
		 * @return array|\WP_Error
		 */
		public static function mcp_dynamic_create_loop( $payload ) {
			$payload   = is_array( $payload ) ? $payload : array();
			$source    = isset( $payload['source'] ) ? sanitize_key( (string) $payload['source'] ) : 'posts';
			$item_html = isset( $payload['item_html'] ) ? (string) $payload['item_html'] : '';
			$post_type = isset( $payload['post_type'] ) ? sanitize_key( (string) $payload['post_type'] ) : '';
			$taxonomy  = isset( $payload['taxonomy'] ) ? sanitize_key( (string) $payload['taxonomy'] ) : '';
			$term      = isset( $payload['term'] ) ? (string) $payload['term'] : '';
			$limit     = isset( $payload['limit'] ) ? max( 1, min( 100, (int) $payload['limit'] ) ) : 6;
			$orderby   = isset( $payload['orderby'] ) ? sanitize_key( (string) $payload['orderby'] ) : 'date';
			$order     = isset( $payload['order'] ) && 'asc' === strtolower( (string) $payload['order'] ) ? 'asc' : 'desc';

			if ( '' === trim( $item_html ) ) {
				return new \WP_Error( 'uich_missing_param', 'create-loop requires "item_html" the markup for ONE item, using tokens like {{ post.title }}.' );
			}
			if ( ! in_array( $source, array( 'posts', 'products', 'terms', 'users' ), true ) ) {
				return new \WP_Error( 'uich_invalid_source', 'Unknown source "' . $source . '". Valid: posts, products, terms, users.' );
			}

			if ( 'products' === $source ) {
				if ( ! post_type_exists( 'product' ) ) {
					return new \WP_Error( 'uich_woo_missing', 'source="products" needs WooCommerce it is not active on this site.' );
				}
				$post_type = 'product';
			} elseif ( 'posts' === $source ) {
				if ( '' === $post_type ) {
					$post_type = 'post';
				}
				$object = get_post_type_object( $post_type );
				if ( ! $object || empty( $object->public ) ) {
					return new \WP_Error(
						'uich_unknown_post_type',
						sprintf( 'Unknown post type "%s". This site has: %s. Run uichemy-composer/describe-site.', $post_type, implode( ', ', get_post_types( array( 'public' => true ), 'names' ) ) )
					);
				}
			}

			if ( '' !== $taxonomy && ! taxonomy_exists( $taxonomy ) ) {
				return new \WP_Error(
					'uich_unknown_taxonomy',
					sprintf( 'Unknown taxonomy "%s". This site has: %s.', $taxonomy, implode( ', ', get_taxonomies( array( 'public' => true ), 'names' ) ) )
				);
			}

			$item_var = ( 'terms' === $source ) ? 'term' : ( ( 'users' === $source ) ? 'user' : ( ( 'products' === $source ) ? 'product' : 'post' ) );
			$fn_map   = array( 'posts' => 'get_posts', 'products' => 'get_products', 'terms' => 'get_terms', 'users' => 'get_users' );
			$fn       = $fn_map[ $source ];

			/*
			 * raw_query is the escape hatch, and it mirrors the composer's own
			 * "Custom query" mode: the caller writes the argument object itself, so
			 * a query the structured builder has no field for — several post types,
			 * OR between taxonomies, more than one meta clause — is still reachable.
			 * Taken verbatim; nothing below runs.
			 */
			$raw = isset( $payload['raw_query'] ) ? trim( (string) $payload['raw_query'] ) : '';
			if ( '' !== $raw ) {
				if ( '{' !== substr( $raw, 0, 1 ) || '}' !== substr( $raw, -1 ) ) {
					return new \WP_Error(
						'uich_bad_raw_query',
						'raw_query must be the whole argument object including braces, e.g. { post_type: [ \'post\', \'page\' ], posts_per_page: 6 }.'
					);
				}
				$call = $fn . '(' . $raw . ')';
				$html = "{% for {$item_var} in {$call} %}\n" . rtrim( $item_html ) . "\n{% endfor %}";

				return array(
					'source'   => $source,
					'item_var' => $item_var,
					'query'    => $call,
					'html'     => $html,
					'message'  => 'Built from raw_query, unvalidated. Pass this html as a section to uichemy-composer/page, post or template. Inside the loop the item is "' . $item_var . '".',
				);
			}

			/*
			 * Structured path. This used to assemble its own short list of arguments,
			 * which meant the ability an agent is told to use could express less than
			 * the composer's own Loop panel — no status, offset, include/exclude,
			 * author, date range or meta filter. It now shares build_loop_args_string()
			 * with the loop-section builder, so both speak the same query language and
			 * neither can quietly fall behind the other.
			 */
			$query = isset( $payload['query'] ) && is_array( $payload['query'] ) ? $payload['query'] : array();
			// The flat top-level parameters stay supported and simply seed the query
			// object; anything given in `query` wins.
			$seed = array( 'count' => $limit, 'orderby' => $orderby, 'order' => strtoupper( $order ) );
			if ( 'posts' === $source && '' !== $post_type ) {
				$seed['post_type'] = $post_type;
			}
			if ( '' !== $taxonomy ) {
				$seed['taxonomy'] = $taxonomy;
			}
			if ( '' !== $term ) {
				$seed['terms'] = $term;
			}
			$query = array_merge( $seed, $query );

			$args = self::build_loop_args_string( $source, $query );
			if ( is_wp_error( $args ) ) {
				return $args;
			}

			$call = $fn . '(' . $args . ')';
			$html = "{% for {$item_var} in {$call} %}\n" . rtrim( $item_html ) . "\n{% endfor %}";

			return array(
				'source'   => $source,
				'item_var' => $item_var,
				'query'    => $call,
				'html'     => $html,
				'message'  => 'Pass this html as a section to uichemy-composer/page, post or template. Inside the loop the item is "' . $item_var . '" e.g. {{ ' . $item_var . '.title }}. Custom fields need meta(): {{ ' . $item_var . ".meta('key') }}. Token names: uichemy-composer/dynamic (action=\"list-fields\").",
			);
		}

		// ============================================================
		// FORMS
		// ============================================================

		/**
		 * MCP — read or write a form's delivery configuration.
		 *
		 * The config is per-post, keyed by the form_key in the markup's
		 * data-atom-form attribute, so a page can carry more than one form. Without a
		 * recipient a form still stores submissions but emails nobody, which is the
		 * usual reason a built contact form looks broken.
		 *
		 * @param array $payload post_id, form_key, [email_to], [subject], [success_message], [store].
		 * @return array|\WP_Error
		 */
		public static function mcp_forms_configure( $payload ) {
			if ( ! class_exists( 'Uich_Forms' ) ) {
				return new \WP_Error( 'uich_forms_unavailable', 'The forms subsystem is unavailable.' );
			}

			$payload  = is_array( $payload ) ? $payload : array();
			$post_id  = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$form_key = isset( $payload['form_key'] ) ? sanitize_text_field( (string) $payload['form_key'] ) : '';

			if ( ! $post_id || ! get_post( $post_id ) ) {
				return new \WP_Error( 'uich_invalid_post_id', 'configure requires the post_id of the page holding the form.' );
			}
			if ( '' === $form_key ) {
				return new \WP_Error( 'uich_missing_param', 'configure requires the "form_key" the data-atom-form value in your form markup.' );
			}

			$all     = get_post_meta( $post_id, Uich_Forms::CONFIG_META, true );
			$all     = is_array( $all ) ? $all : array();
			$current = isset( $all[ $form_key ] ) && is_array( $all[ $form_key ] ) ? $all[ $form_key ] : array();

			$map = array(
				'email_to'        => 'sanitize_email',
				'subject'         => 'sanitize_text_field',
				'success_message' => 'sanitize_text_field',
			);

			$updated = array();
			foreach ( $map as $key => $sanitizer ) {
				if ( isset( $payload[ $key ] ) ) {
					$current[ $key ] = call_user_func( $sanitizer, (string) $payload[ $key ] );
					$updated[]       = $key;
				}
			}
			if ( isset( $payload['store'] ) ) {
				$current['store'] = (bool) $payload['store'];
				$updated[]        = 'store';
			}

			if ( $updated ) {
				$all[ $form_key ] = $current;
				update_post_meta( $post_id, Uich_Forms::CONFIG_META, $all );
			}

			return array(
				'post_id'  => $post_id,
				'form_key' => $form_key,
				'updated'  => $updated,
				'config'   => $current,
				'message'  => $updated
					? 'Updated ' . implode( ', ', $updated ) . " for form \"{$form_key}\"."
					: 'Read only pass email_to, subject, success_message or store to change anything.',
			);
		}

		/**
		 * MCP — list forms that have received submissions, or the submissions of one.
		 *
		 * @param array $payload [form_key], [limit], [offset], [status].
		 * @return array|\WP_Error
		 */
		public static function mcp_forms_list_submissions( $payload ) {
			if ( ! class_exists( 'Uich_Forms_DB' ) ) {
				return new \WP_Error( 'uich_forms_unavailable', 'The forms subsystem is unavailable.' );
			}

			$payload  = is_array( $payload ) ? $payload : array();
			$form_key = isset( $payload['form_key'] ) ? sanitize_text_field( (string) $payload['form_key'] ) : '';
			$limit    = isset( $payload['limit'] ) ? max( 1, min( 200, (int) $payload['limit'] ) ) : 50;
			$offset   = isset( $payload['offset'] ) ? max( 0, (int) $payload['offset'] ) : 0;
			$status   = isset( $payload['status'] ) ? sanitize_key( (string) $payload['status'] ) : 'all';
			$status   = in_array( $status, array( 'all', 'read', 'unread' ), true ) ? $status : 'all';

			if ( '' === $form_key ) {
				$forms = Uich_Forms_DB::get_forms();
				return array(
					'forms'   => is_array( $forms ) ? $forms : array(),
					'message' => $forms
						? 'Pass one of these form_key values to read its submissions.'
						: 'No form has received a submission yet.',
				);
			}

			$rows = Uich_Forms_DB::get_submissions( $form_key, $limit, $offset, $status );

			return array(
				'form_key'    => $form_key,
				'status'      => $status,
				'count'       => is_array( $rows ) ? count( $rows ) : 0,
				'submissions' => is_array( $rows ) ? $rows : array(),
			);
		}

		/**
		 * MCP — one submission with its field values.
		 *
		 * Reading a submission does NOT mark it read: that is a human action in the
		 * dashboard, and an AI reading the row should not change what the site owner
		 * sees as new.
		 *
		 * @param array $payload id.
		 * @return array|\WP_Error
		 */
		public static function mcp_forms_get_submission( $payload ) {
			if ( ! class_exists( 'Uich_Forms_DB' ) ) {
				return new \WP_Error( 'uich_forms_unavailable', 'The forms subsystem is unavailable.' );
			}

			$payload = is_array( $payload ) ? $payload : array();
			$id      = isset( $payload['id'] ) ? absint( $payload['id'] ) : 0;
			if ( ! $id ) {
				return new \WP_Error( 'uich_missing_param', 'get-submission requires an "id" from list-submissions.' );
			}

			$row = Uich_Forms_DB::get_submission( $id );
			if ( ! $row ) {
				return new \WP_Error( 'uich_submission_not_found', "No submission with id {$id}." );
			}

			return array(
				'submission' => $row,
				'values'     => Uich_Forms_DB::get_values( $id ),
			);
		}

		// ============================================================
		// SEO
		// ============================================================

		/**
		 * Which plugin owns SEO output on this site.
		 *
		 * UiChemy does not emit head tags itself in this build, so writing SEO values
		 * is only meaningful when something is there to render them. Detecting the
		 * owner up front means a write can refuse honestly instead of storing meta
		 * that nothing ever reads.
		 *
		 * @return array { backend, label, keys }
		 */
		private static function mcp_seo_backend() {
			if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Options' ) ) {
				return array(
					'backend' => 'yoast',
					'label'   => 'Yoast SEO',
					'keys'    => array(
						'title'       => '_yoast_wpseo_title',
						'description' => '_yoast_wpseo_metadesc',
						'canonical'   => '_yoast_wpseo_canonical',
					),
				);
			}
			if ( defined( 'RANK_MATH_VERSION' ) || class_exists( 'RankMath' ) ) {
				return array(
					'backend' => 'rankmath',
					'label'   => 'Rank Math',
					'keys'    => array(
						'title'       => 'rank_math_title',
						'description' => 'rank_math_description',
						'canonical'   => 'rank_math_canonical_url',
					),
				);
			}
			return array( 'backend' => 'none', 'label' => '', 'keys' => array() );
		}

		/**
		 * MCP — read the effective SEO metadata for a post.
		 *
		 * @param array $payload post_id.
		 * @return array|\WP_Error
		 */
		public static function mcp_seo_get( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( ! $post_id || ! get_post( $post_id ) ) {
				return new \WP_Error( 'uich_invalid_post_id', 'get requires an existing post_id.' );
			}

			$backend = self::mcp_seo_backend();
			$values  = array( 'title' => '', 'description' => '', 'canonical' => '' );
			foreach ( $backend['keys'] as $field => $meta_key ) {
				$values[ $field ] = (string) get_post_meta( $post_id, $meta_key, true );
			}

			return array(
				'post_id'   => $post_id,
				'backend'   => $backend['backend'],
				'seo'       => $values,
				'fallbacks' => array(
					'title'     => get_the_title( $post_id ),
					'canonical' => (string) get_permalink( $post_id ),
					'excerpt'   => (string) get_the_excerpt( $post_id ),
				),
				'sitemap'   => home_url( '/wp-sitemap.xml' ),
				'message'   => 'none' === $backend['backend']
					? 'No SEO plugin is active. "set" will still write a description and a canonical as real tags into the page\'s own before-</head> code, which render; the <title> is left to WordPress, because the theme already prints one. Install Yoast SEO or Rank Math for full control.'
					: $backend['label'] . ' owns SEO output on this site; values are read from and written to its own meta keys.',
			);
		}

		/**
		 * MCP — write SEO metadata into the detected plugin's meta keys.
		 *
		 * Refuses when nothing would render the values, rather than storing meta that
		 * no code reads and reporting success.
		 *
		 * @param array $payload post_id, [title], [description], [canonical].
		 * @return array|\WP_Error
		 */
		/**
		 * Markers fencing the SEO tags written into a page's head code when no SEO
		 * plugin owns the head, so a repeat call replaces the previous block.
		 */
		const SEO_HEAD_BLOCK_START = '<!-- uichemy:seo -->';
		const SEO_HEAD_BLOCK_END   = '<!-- /uichemy:seo -->';

		/**
		 * Fallback for `seo set` when no SEO plugin owns the head.
		 *
		 * Writes the description and canonical as real tags into the page's own
		 * before-</head> code. Replaces any block this fallback wrote before.
		 *
		 * @param int   $post_id Target post.
		 * @param array $payload title / description / canonical.
		 * @return array|\WP_Error
		 */
		private static function mcp_seo_set_via_page_head( $post_id, $payload ) {
			$description = isset( $payload['description'] ) ? sanitize_text_field( (string) $payload['description'] ) : '';
			$canonical   = isset( $payload['canonical'] ) ? esc_url_raw( (string) $payload['canonical'] ) : '';
			$title       = isset( $payload['title'] ) ? sanitize_text_field( (string) $payload['title'] ) : '';

			if ( '' === $description && '' === $canonical ) {
				return new \WP_Error(
					'uich_seo_no_backend',
					'No SEO plugin is active. Without one UiChemy can still emit a description and a canonical into this page\'s head, but not the <title> (the theme already prints one, and a second would be a duplicate). Pass description and/or canonical here, set the visible title with uichemy-composer/page, or install Yoast SEO / Rank Math for full control.'
				);
			}

			$tags = array();
			if ( '' !== $description ) {
				$tags[] = '<meta name="description" content="' . esc_attr( $description ) . '">';
			}
			if ( '' !== $canonical ) {
				$tags[] = '<link rel="canonical" href="' . esc_url( $canonical ) . '">';
			}

			$block = self::SEO_HEAD_BLOCK_START . "\n" . implode( "\n", $tags ) . "\n" . self::SEO_HEAD_BLOCK_END;

			$existing = self::mcp_get_page_code( array( 'post_id' => $post_id ) );
			$head     = ( is_array( $existing ) && isset( $existing['page_before_head'] ) ) ? (string) $existing['page_before_head'] : '';
			$cleaned  = trim(
				(string) preg_replace(
					'/' . preg_quote( self::SEO_HEAD_BLOCK_START, '/' ) . '.*?' . preg_quote( self::SEO_HEAD_BLOCK_END, '/' ) . '/s',
					'',
					$head
				)
			);

			$written = self::mcp_set_page_site_code(
				array(
					'post_id'  => $post_id,
					'page_css' => trim( $cleaned . "\n" . $block ),
				)
			);
			if ( is_wp_error( $written ) ) {
				return $written;
			}

			$updated = array();
			if ( '' !== $description ) {
				$updated[] = 'description';
			}
			if ( '' !== $canonical ) {
				$updated[] = 'canonical';
			}

			$message = 'No SEO plugin is active, so the ' . implode( ' and ', $updated )
				. ( count( $updated ) > 1 ? ' were' : ' was' )
				. ' written as ' . ( count( $updated ) > 1 ? 'real tags' : 'a real tag' )
				. ' into this page\'s before-</head> code and will render.';
			if ( '' !== $title ) {
				$message .= ' The title was NOT written: the theme already emits a <title> and a second one would be a duplicate — set it with uichemy-composer/page, or install Yoast SEO / Rank Math.';
			}

			return array(
				'post_id'      => $post_id,
				'backend'      => 'uichemy_page_head',
				'updated'      => $updated,
				'not_updated'  => ( '' !== $title ) ? array( 'title' ) : array(),
				'seo'          => self::mcp_seo_get( array( 'post_id' => $post_id ) ),
				'message'      => $message,
			);
		}

		public static function mcp_seo_set( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( ! $post_id || ! get_post( $post_id ) ) {
				return new \WP_Error( 'uich_invalid_post_id', 'set requires an existing post_id.' );
			}

			$backend = self::mcp_seo_backend();
			if ( 'none' === $backend['backend'] ) {
				// Fall back to the page's own before-</head> lane, which does render.
				return self::mcp_seo_set_via_page_head( $post_id, $payload );
			}

			$updated = array();
			foreach ( $backend['keys'] as $field => $meta_key ) {
				if ( ! isset( $payload[ $field ] ) ) {
					continue;
				}
				$value = 'canonical' === $field
					? esc_url_raw( (string) $payload[ $field ] )
					: sanitize_text_field( (string) $payload[ $field ] );
				update_post_meta( $post_id, $meta_key, $value );
				$updated[] = $field;
			}

			if ( ! $updated ) {
				return new \WP_Error( 'uich_missing_param', 'Nothing to set supply at least one of title, description, canonical.' );
			}

			return array(
				'post_id' => $post_id,
				'backend' => $backend['backend'],
				'updated' => $updated,
				'seo'     => self::mcp_seo_get( array( 'post_id' => $post_id ) ),
				'message' => 'Wrote ' . implode( ', ', $updated ) . ' into ' . $backend['label'] . "'s meta for post {$post_id}.",
			);
		}

		/**
		 * Which post type a create-* call should write to.
		 *
		 * Everything in WordPress is a post, and a Composer section tree is identical
		 * whatever the type carrying it — so the creators take a post_type instead of
		 * being duplicated per type. Defaults to page, and refuses a type that is not
		 * registered and public rather than silently creating an orphan.
		 *
		 * @param array $payload Create payload.
		 * @return string A registered public post type.
		 */
		private static function mcp_resolve_post_type( $payload ) {
			$requested = isset( $payload['post_type'] ) ? sanitize_key( (string) $payload['post_type'] ) : '';
			if ( '' === $requested ) {
				return 'page';
			}
			$object = get_post_type_object( $requested );
			if ( ! $object || empty( $object->public ) ) {
				return 'page';
			}
			return $requested;
		}

		// ============================================================
		// STRUCTURAL SECTION OPS (move / duplicate / delete)
		// ============================================================

		/**
		 * Persist a mutated Elementor element tree. Mirrors the save recipe used by
		 * mcp_insert_section_at_index — document save (best effort) + authoritative
		 * meta write + cache busting.
		 *
		 * @param int   $post_id  Post ID.
		 * @param array $elements The full element tree to persist.
		 * @return void
		 */
		private static function mcp_persist_elements( $post_id, array $elements ) {
			// Document::save() publishes as a side effect; every structural op routes
			// through here, so capture the status and put it back afterwards.
			$status_before_save = get_post_status( $post_id );

			$document = \Elementor\Plugin::$instance->documents->get_doc_or_auto_save( $post_id );
			if ( $document ) {
				try {
					$document->save( array( 'elements' => $elements ) );
				} catch ( \Throwable $e ) {
					// Meta write below still applies the authoritative structure.
					unset( $e );
				}
				self::mcp_restore_post_status( $post_id, $status_before_save );
			}
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
			delete_post_meta( $post_id, '_elementor_element_cache' );
			if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}
		}

		/**
		 * Put a post's status back after an Elementor document save, which flips the
		 * post to publish. Only restores when the status actually changed, and never
		 * touches auto-drafts (which Elementor legitimately promotes on first save).
		 *
		 * @param int    $post_id Post ID.
		 * @param string $before  Status captured before the save.
		 * @return void
		 */
		private static function mcp_restore_post_status( $post_id, $before ) {
			$before = (string) $before;
			if ( '' === $before || 'auto-draft' === $before ) {
				return;
			}
			$after = (string) get_post_status( $post_id );
			if ( $after === $before || '' === $after ) {
				return;
			}
			wp_update_post(
				array(
					'ID'          => (int) $post_id,
					'post_status' => $before,
				)
			);
		}

		/**
		 * Load + decode a post's _elementor_data for a structural op.
		 *
		 * @param int $post_id Post ID.
		 * @return array|\WP_Error The element tree, or an error matching the sibling writers.
		 */
		private static function mcp_load_elements_for_structural_op( $post_id ) {
			$raw = get_post_meta( $post_id, '_elementor_data', true );
			if ( ! is_string( $raw ) || '' === $raw ) {
				return new \WP_Error( 'uich_missing_elementor_data', 'No Elementor data found for this post.' );
			}
			$elements = json_decode( $raw, true );
			if ( ! is_array( $elements ) ) {
				return new \WP_Error( 'uich_invalid_elementor_data', 'Elementor data is not valid JSON.' );
			}
			return $elements;
		}

		/**
		 * Depth-first: remove the Composer widget with the given id from its parent array.
		 *
		 * @param array      &$elements Element tree (by reference).
		 * @param string      $id       Target widget id.
		 * @param array|null &$removed  Set to the removed element on success.
		 * @return bool True once removed.
		 */
		private static function delete_composer_widget_by_id( array &$elements, $id, &$removed ) {
			foreach ( $elements as $i => &$el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				if ( isset( $el['elType'], $el['widgetType'] )
					&& uichemy_is_composer_widget_node( $el )
					&& isset( $el['id'] ) && (string) $el['id'] === (string) $id ) {
					$removed = $el;
					array_splice( $elements, $i, 1 );
					return true;
				}
				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					if ( self::delete_composer_widget_by_id( $el['elements'], $id, $removed ) ) {
						unset( $el );
						return true;
					}
				}
			}
			unset( $el );
			return false;
		}

		/**
		 * Depth-first: detach the Composer widget with the given id AND report the id of
		 * the container it lived in, so a move can re-home it in the same container.
		 *
		 * @param array      &$elements     Element tree (by reference).
		 * @param string      $id           Target widget id.
		 * @param array|null &$removed      Set to the detached element on success.
		 * @param string     &$container_id Set to the enclosing container id ('' if at root).
		 * @param string      $parent_id    Enclosing container id passed down the recursion.
		 * @return bool True once detached.
		 */
		private static function detach_composer_widget_by_id( array &$elements, $id, &$removed, &$container_id, $parent_id = '' ) {
			foreach ( $elements as $i => &$el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				if ( isset( $el['elType'], $el['widgetType'] )
					&& uichemy_is_composer_widget_node( $el )
					&& isset( $el['id'] ) && (string) $el['id'] === (string) $id ) {
					$removed      = $el;
					$container_id = (string) $parent_id;
					array_splice( $elements, $i, 1 );
					return true;
				}
				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					$child_parent = ( isset( $el['elType'] ) && 'container' === $el['elType'] && isset( $el['id'] ) )
						? (string) $el['id'] : (string) $parent_id;
					if ( self::detach_composer_widget_by_id( $el['elements'], $id, $removed, $container_id, $child_parent ) ) {
						unset( $el );
						return true;
					}
				}
			}
			unset( $el );
			return false;
		}

		/**
		 * Depth-first: insert a widget element into the container with the given id at
		 * a clamped 0-based index. Mirrors insert_widget_at_index_in_container.
		 *
		 * @param array  &$elements     Element tree (by reference).
		 * @param array   $widget       Widget element to insert.
		 * @param string  $container_id Target container id.
		 * @param int     $index        Target position (clamped).
		 * @param bool   &$inserted     Set true once inserted.
		 * @return void
		 */
		private static function insert_widget_into_container_by_id( array &$elements, array $widget, $container_id, $index, &$inserted ) {
			foreach ( $elements as &$el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				if ( isset( $el['elType'] ) && 'container' === $el['elType']
					&& isset( $el['id'] ) && (string) $el['id'] === (string) $container_id ) {
					if ( ! isset( $el['elements'] ) || ! is_array( $el['elements'] ) ) {
						$el['elements'] = array();
					}
					$clamped = max( 0, min( (int) $index, count( $el['elements'] ) ) );
					array_splice( $el['elements'], $clamped, 0, array( $widget ) );
					$inserted = true;
					unset( $el );
					return;
				}
				if ( ! $inserted && ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					self::insert_widget_into_container_by_id( $el['elements'], $widget, $container_id, $index, $inserted );
					if ( $inserted ) {
						unset( $el );
						return;
					}
				}
			}
			unset( $el );
		}

		/**
		 * Depth-first: clone the Composer widget with the given id (fresh element id) and
		 * splice the copy in immediately after the original. Original untouched.
		 *
		 * @param array      &$elements       Element tree (by reference).
		 * @param string      $id             Source widget id.
		 * @param string      $new_id         Id for the clone.
		 * @param string      $label_override Optional new _title for the clone.
		 * @param array|null &$dup            Set to the clone on success.
		 * @return bool True once duplicated.
		 */
		private static function duplicate_composer_widget_by_id( array &$elements, $id, $new_id, $label_override, &$dup ) {
			foreach ( $elements as $i => &$el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				if ( isset( $el['elType'], $el['widgetType'] )
					&& uichemy_is_composer_widget_node( $el )
					&& isset( $el['id'] ) && (string) $el['id'] === (string) $id ) {
					$clone       = $el;
					$clone['id'] = (string) $new_id;
					if ( '' !== (string) $label_override ) {
						if ( ! isset( $clone['settings'] ) || ! is_array( $clone['settings'] ) ) {
							$clone['settings'] = array();
						}
						$clone['settings']['_title'] = (string) $label_override;
					}
					// Composer section widgets carry no child elements; drop any defensively
					// so Elementor never sees a duplicated nested data-id.
					$clone['elements'] = array();
					array_splice( $elements, $i + 1, 0, array( $clone ) );
					$dup = $clone;
					return true;
				}
				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					if ( self::duplicate_composer_widget_by_id( $el['elements'], $id, $new_id, $label_override, $dup ) ) {
						unset( $el );
						return true;
					}
				}
			}
			unset( $el );
			return false;
		}

		/**
		 * MCP — move a Composer section to a new 0-based slot within its own container.
		 * Target by section_index (global composer order) or element_id. Cross-container
		 * moves are out of scope (re-inserts into the source container / root).
		 *
		 * @param array $payload post_id, to_index, [section_index], [element_id].
		 * @return array|\WP_Error
		 */
		public static function mcp_move_section( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}
			$payload       = is_array( $payload ) ? $payload : array();
			$post_id       = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$section_index = isset( $payload['section_index'] ) ? (int) $payload['section_index'] : 0;
			$element_id    = isset( $payload['element_id'] ) ? (string) $payload['element_id'] : '';
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}
			if ( ! isset( $payload['to_index'] ) ) {
				return new \WP_Error( 'uich_missing_param', 'move-section requires to_index.' );
			}
			$to_index = (int) $payload['to_index'];

			$target = self::mcp_get_section_code( $post_id, $section_index, $element_id );
			if ( is_wp_error( $target ) ) {
				return $target;
			}
			$widget_id  = (string) $target['widget_id'];
			$from_index = (int) $target['widget_index'];

			$elements = self::mcp_load_elements_for_structural_op( $post_id );
			if ( is_wp_error( $elements ) ) {
				return $elements;
			}

			$removed      = null;
			$container_id = '';
			self::detach_composer_widget_by_id( $elements, $widget_id, $removed, $container_id );
			if ( null === $removed ) {
				return new \WP_Error( 'uich_widget_not_found', "Could not locate Composer widget \"{$widget_id}\" to move." );
			}

			$inserted = false;
			if ( '' !== $container_id ) {
				self::insert_widget_into_container_by_id( $elements, $removed, $container_id, $to_index, $inserted );
			}
			if ( ! $inserted ) {
				$clamped = max( 0, min( $to_index, count( $elements ) ) );
				array_splice( $elements, $clamped, 0, array( $removed ) );
			}

			self::mcp_persist_elements( $post_id, $elements );

			return array(
				'post_id'    => $post_id,
				'widget_id'  => $widget_id,
				'from_index' => $from_index,
				'to_index'   => $to_index,
				'message'    => "Moved section \"{$widget_id}\" from index {$from_index} toward index {$to_index} on page {$post_id}.",
			);
		}

		/**
		 * MCP — duplicate a Composer section (fresh id) immediately after the original.
		 * Non-destructive. Target by section_index or element_id.
		 *
		 * @param array $payload post_id, [section_index], [element_id], [label].
		 * @return array|\WP_Error
		 */
		public static function mcp_duplicate_section( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}
			$payload       = is_array( $payload ) ? $payload : array();
			$post_id       = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$section_index = isset( $payload['section_index'] ) ? (int) $payload['section_index'] : 0;
			$element_id    = isset( $payload['element_id'] ) ? (string) $payload['element_id'] : '';
			$label         = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : '';
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}

			$target = self::mcp_get_section_code( $post_id, $section_index, $element_id );
			if ( is_wp_error( $target ) ) {
				return $target;
			}
			$widget_id = (string) $target['widget_id'];

			$elements = self::mcp_load_elements_for_structural_op( $post_id );
			if ( is_wp_error( $elements ) ) {
				return $elements;
			}

			$new_id = strtolower( wp_generate_password( 7, false, false ) );
			$dup    = null;
			self::duplicate_composer_widget_by_id( $elements, $widget_id, $new_id, $label, $dup );
			if ( null === $dup ) {
				return new \WP_Error( 'uich_widget_not_found', "Could not locate Composer widget \"{$widget_id}\" to duplicate." );
			}

			self::mcp_persist_elements( $post_id, $elements );

			return array(
				'post_id'          => $post_id,
				'new_widget_id'    => $new_id,
				'source_widget_id' => $widget_id,
				'source_index'     => (int) $target['widget_index'],
				'label'            => '' !== $label ? $label : (string) $target['label'],
				'message'          => "Duplicated section \"{$widget_id}\" as \"{$new_id}\" on page {$post_id}.",
			);
		}

		/**
		 * MCP — delete a Composer section, guarded by a stateless double-confirmation.
		 * First call (no/invalid confirm_token) returns requires_confirmation + a
		 * confirm_token bound to post + widget + a fingerprint of the section HTML
		 * (so it self-invalidates if the section is edited). The caller must echo the
		 * exact token in a second call to actually remove the widget.
		 *
		 * @param array $payload post_id, [section_index], [element_id], [confirm_token].
		 * @return array|\WP_Error
		 */
		public static function mcp_delete_section( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}
			$payload       = is_array( $payload ) ? $payload : array();
			$post_id       = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$section_index = isset( $payload['section_index'] ) ? (int) $payload['section_index'] : 0;
			$element_id    = isset( $payload['element_id'] ) ? (string) $payload['element_id'] : '';
			$supplied      = isset( $payload['confirm_token'] ) ? (string) $payload['confirm_token'] : '';
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}

			$target = self::mcp_get_section_code( $post_id, $section_index, $element_id );
			if ( is_wp_error( $target ) ) {
				return $target;
			}
			$widget_id = (string) $target['widget_id'];
			$raw_html  = (string) $target['html'];
			$label     = (string) $target['label'];

			$scope    = 'uichemy-del-section|' . $post_id . '|' . $widget_id . '|' . md5( $raw_html );
			$expected = substr( wp_hash( $scope ), 0, 16 );

			if ( '' === $supplied || ! hash_equals( $expected, $supplied ) ) {
				return array(
					'requires_confirmation' => true,
					'confirm_token'         => $expected,
					'post_id'               => $post_id,
					'section_index'         => (int) $target['widget_index'],
					'widget_id'             => $widget_id,
					'label'                 => $label,
					'preview'               => mb_substr( trim( wp_strip_all_tags( $raw_html ) ), 0, 160 ),
					'message'               => 'Deleting this section is permanent. Re-call action=delete-section with this exact confirm_token to proceed.',
				);
			}

			$elements = self::mcp_load_elements_for_structural_op( $post_id );
			if ( is_wp_error( $elements ) ) {
				return $elements;
			}

			$removed = null;
			self::delete_composer_widget_by_id( $elements, $widget_id, $removed );
			if ( null === $removed ) {
				return new \WP_Error( 'uich_widget_not_found', "Could not locate Composer widget \"{$widget_id}\" to delete." );
			}

			self::mcp_persist_elements( $post_id, $elements );

			$remaining = array();
			self::collect_uichemy_composer_widgets( $elements, $remaining );

			return array(
				'post_id'           => $post_id,
				'deleted_widget_id' => $widget_id,
				'label'             => $label,
				'remaining_widgets' => count( $remaining ),
				'message'           => "Deleted section \"{$widget_id}\" from page {$post_id}.",
			);
		}

		// ============================================================
		// SECTION CODE PATCHING
		// ============================================================

		/**
		 * MCP — literal find/replace edits against one section's html / css / js.
		 *
		 * The alternative is resending the whole section to change one class name,
		 * which costs the section's full byte count per edit and risks the model
		 * silently rewriting the parts it was not asked to touch. Each edit reports
		 * its own replacement count, so a find that matched nothing is visible rather
		 * than silently dropped.
		 *
		 * @param array $payload post_id, [section_index], [element_id], edits[]{find,replace,[field]}.
		 * @return array|\WP_Error
		 */
		public static function mcp_patch_section_code( $payload ) {
			$payload       = is_array( $payload ) ? $payload : array();
			$post_id       = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$section_index = isset( $payload['section_index'] ) ? (int) $payload['section_index'] : 0;
			$element_id    = isset( $payload['element_id'] ) ? (string) $payload['element_id'] : '';
			$edits         = isset( $payload['edits'] ) && is_array( $payload['edits'] ) ? $payload['edits'] : array();

			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}
			if ( empty( $edits ) ) {
				return new \WP_Error( 'uich_missing_param', 'patch-section-code requires a non-empty edits[] of { find, replace, field }.' );
			}

			$target = self::mcp_get_section_code( $post_id, $section_index, $element_id );
			if ( is_wp_error( $target ) ) {
				return $target;
			}

			$code = array(
				'html' => (string) $target['html'],
				'css'  => (string) $target['css'],
				'js'   => (string) $target['js'],
			);

			$applied = array();
			foreach ( $edits as $edit ) {
				if ( ! is_array( $edit ) || ! isset( $edit['find'] ) ) {
					continue;
				}
				$find    = (string) $edit['find'];
				$replace = isset( $edit['replace'] ) ? (string) $edit['replace'] : '';
				$field   = isset( $edit['field'] ) ? strtolower( (string) $edit['field'] ) : 'html';
				if ( ! isset( $code[ $field ] ) ) {
					$field = 'html';
				}
				if ( '' === $find ) {
					continue;
				}

				$count          = 0;
				$code[ $field ] = str_replace( $find, $replace, $code[ $field ], $count );
				$applied[]      = array(
					'field' => $field,
					'find'  => $find,
					'count' => (int) $count,
				);
			}

			$total = 0;
			foreach ( $applied as $a ) {
				$total += $a['count'];
			}

			if ( 0 === $total ) {
				return array(
					'post_id'       => $post_id,
					'widget_id'     => (string) $target['widget_id'],
					'section_index' => (int) $target['widget_index'],
					'replacements'  => $applied,
					'changed'       => false,
					'message'       => 'No edit matched nothing was written. Read the section with action=get-section-code and make each "find" match its field exactly.',
				);
			}

			$result = self::mcp_sync_generated_code_to_widget(
				$post_id,
				array(
					'mode'          => 'replace',
					'widget_id'     => (string) $target['widget_id'],
					'html'          => $code['html'],
					'css'           => $code['css'],
					'js'            => $code['js'],
					'label'         => (string) $target['label'],
					'source'        => 'mcp',
					// The bytes came from this same widget a moment ago, so any <img>
					// in them is already a media-library URL.
					'upload_images' => false,
				)
			);
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return array(
				'post_id'       => $post_id,
				'widget_id'     => (string) $target['widget_id'],
				'section_index' => (int) $target['widget_index'],
				'replacements'  => $applied,
				'changed'       => true,
				'message'       => "Applied {$total} replacement(s) to section \"{$target['widget_id']}\" on page {$post_id}.",
			);
		}

		// ============================================================
		// PAGE HEAD + BODY CODE
		// ============================================================

		/**
		 * MCP — read the PAGE-level head/body code for one page.
		 *
		 * Page scope only. Site-wide code is a property of the site, not of any page,
		 * so it is read and written through uichemy-composer/platform instead — reporting it
		 * here made it look like something this page owned.
		 *
		 * It is stored on the page's first Composer widget, which is where the Page Code
		 * pane and the front-end renderer both look for it.
		 *
		 * @param array $payload post_id.
		 * @return array|\WP_Error
		 */
		public static function mcp_get_page_code( $payload ) {
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}

			$section = self::mcp_get_section_code( $post_id, 0, '' );
			if ( is_wp_error( $section ) ) {
				return $section;
			}

			return array(
				'post_id'          => $post_id,
				'page_before_head' => (string) $section['page_custom_code_head'],
				'page_before_body' => (string) $section['page_custom_code_footer'],
				'site_code_note'   => 'Site-wide head/body code lives in uichemy-composer/platform (get-site-code / set-site-code / update-site-code).',
			);
		}

		/**
		 * MCP — REPLACE page-level and/or site-wide head/body code.
		 *
		 * Only the scopes present in the payload are touched, so a caller can rewrite
		 * page head without clearing site head; pass an empty string to deliberately
		 * clear one. Page code is written to the first Composer widget, which is where
		 * the Page Code pane and the front-end renderer both read it from.
		 *
		 * @param array $payload post_id, [page_css], [page_js], [site_css], [site_js].
		 * @return array|\WP_Error
		 */
		public static function mcp_set_page_site_code( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}
			$payload = is_array( $payload ) ? $payload : array();
			$post_id = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}

			$touched = array();

			// --- Site scope: whole-value replace, only when the key was supplied.
			if ( isset( $payload['site_css'] ) || isset( $payload['site_js'] ) ) {
				$site = self::get_site_custom_code_option();
				$head = isset( $payload['site_css'] ) ? self::mcp_ensure_style_tag( (string) $payload['site_css'] ) : $site['head'];
				$foot = isset( $payload['site_js'] ) ? self::mcp_ensure_script_tag( (string) $payload['site_js'] ) : $site['footer'];
				self::update_site_custom_code_option( $head, $foot );
				if ( isset( $payload['site_css'] ) ) {
					$touched[] = 'site_before_head';
				}
				if ( isset( $payload['site_js'] ) ) {
					$touched[] = 'site_before_body';
				}
			}

			// --- Page scope: written onto the first Composer widget.
			if ( isset( $payload['page_css'] ) || isset( $payload['page_js'] ) ) {
				$elements = self::mcp_load_elements_for_structural_op( $post_id );
				if ( is_wp_error( $elements ) ) {
					return $elements;
				}

				$written = self::mcp_replace_page_custom_code_on_first_widget(
					$elements,
					isset( $payload['page_css'] ) ? self::mcp_ensure_style_tag( (string) $payload['page_css'] ) : null,
					isset( $payload['page_js'] ) ? self::mcp_ensure_script_tag( (string) $payload['page_js'] ) : null
				);
				if ( ! $written ) {
					return new \WP_Error( 'uich_no_widgets', 'No Composer widget found on this page to hold the page code. Create a section first.' );
				}

				// Re-mirror onto every Composer widget. The write above lands on the
				// FIRST widget only, but the frontend printer
				// (extract_widget_custom_code_from_elements) dedupes by md5 of the
				// whole block - so on a page with two or more sections, a first-widget
				// write leaves the others holding the PREVIOUS block, two different
				// signatures survive the dedupe, and the page emits the code twice.
				// A duplicated <link> is merely wasteful; a duplicated <script> runs
				// twice. The section create/append paths already sync for this reason.
				self::mcp_sync_page_custom_code_across_widgets( $elements );

				self::mcp_persist_elements( $post_id, $elements );
				if ( isset( $payload['page_css'] ) ) {
					$touched[] = 'page_before_head';
				}
				if ( isset( $payload['page_js'] ) ) {
					$touched[] = 'page_before_body';
				}
			}

			if ( empty( $touched ) ) {
				return new \WP_Error( 'uich_missing_param', 'Nothing to set supply at least one of page_before_head, page_before_body, site_before_head, site_before_body.' );
			}

			$current = self::mcp_get_page_code( array( 'post_id' => $post_id ) );

			return array(
				'post_id' => $post_id,
				'updated' => $touched,
				'code'    => is_wp_error( $current ) ? array() : $current,
				'message' => 'Replaced ' . implode( ', ', $touched ) . " on page {$post_id}.",
			);
		}

		/**
		 * MCP — APPEND to page-level and/or site-wide head/body code, skipping blocks
		 * that are already present. The additive counterpart to mcp_set_page_site_code:
		 * this is what a section upload uses, so adding a font <link> twice cannot
		 * duplicate it.
		 *
		 * @param array $payload post_id, [page_css], [page_js], [site_css], [site_js].
		 * @return array|\WP_Error
		 */
		public static function mcp_update_page_code( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}
			$payload  = is_array( $payload ) ? $payload : array();
			$post_id  = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$page_css = isset( $payload['page_css'] ) ? (string) $payload['page_css'] : '';
			$page_js  = isset( $payload['page_js'] ) ? (string) $payload['page_js'] : '';
			$site_css = isset( $payload['site_css'] ) ? (string) $payload['site_css'] : '';
			$site_js  = isset( $payload['site_js'] ) ? (string) $payload['site_js'] : '';

			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}
			if ( '' === trim( $page_css ) && '' === trim( $page_js ) && '' === trim( $site_css ) && '' === trim( $site_js ) ) {
				return new \WP_Error( 'uich_missing_param', 'Nothing to append supply at least one of page_before_head, page_before_body, site_before_head, site_before_body.' );
			}

			// Site scope dedupes duplicate <link href> URLs on its own.
			self::mcp_append_site_custom_code( $site_css, $site_js );

			if ( '' !== trim( $page_css ) || '' !== trim( $page_js ) ) {
				$elements = self::mcp_load_elements_for_structural_op( $post_id );
				if ( is_wp_error( $elements ) ) {
					return $elements;
				}
				if ( ! self::mcp_merge_page_custom_code_into_first_widget( $elements, $page_css, $page_js ) ) {
					return new \WP_Error( 'uich_no_widgets', 'No Composer widget found on this page to hold the page code. Create a section first.' );
				}

				// Same reason as in mcp_set_page_code: the merge above touches the
				// first widget only, and an un-mirrored page emits its page code once
				// per distinct block.
				self::mcp_sync_page_custom_code_across_widgets( $elements );

				self::mcp_persist_elements( $post_id, $elements );
			}

			$current = self::mcp_get_page_code( array( 'post_id' => $post_id ) );

			return array(
				'post_id' => $post_id,
				'code'    => is_wp_error( $current ) ? array() : $current,
				'message' => "Appended head/body code on page {$post_id} (blocks already present were skipped).",
			);
		}

		/**
		 * Depth-first: REPLACE the page custom code on the first Composer widget.
		 * A null argument leaves that scope untouched; '' clears it.
		 *
		 * @param array       &$elements Element tree (by reference).
		 * @param string|null  $head     New head block, or null to leave alone.
		 * @param string|null  $footer   New footer block, or null to leave alone.
		 * @return bool True if a widget was found and written.
		 */
		private static function mcp_replace_page_custom_code_on_first_widget( array &$elements, $head, $footer ) {
			foreach ( $elements as &$el ) {
				if ( ! is_array( $el ) ) {
					continue;
				}
				if ( isset( $el['elType'], $el['widgetType'] )
					&& uichemy_is_composer_widget_node( $el ) ) {
					if ( ! isset( $el['settings'] ) || ! is_array( $el['settings'] ) ) {
						$el['settings'] = array();
					}
					if ( null !== $head ) {
						$el['settings']['page_custom_code_head'] = $head;
					}
					if ( null !== $footer ) {
						$el['settings']['page_custom_code_footer'] = $footer;
					}
					unset( $el );
					return true;
				}
				if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
					if ( self::mcp_replace_page_custom_code_on_first_widget( $el['elements'], $head, $footer ) ) {
						unset( $el );
						return true;
					}
				}
			}
			unset( $el );
			return false;
		}

		// ============================================================
		// SEARCH
		// ============================================================

		/**
		 * MCP — grep the site's Composer sections, in the spirit of `grep -rn`.
		 *
		 * Finding "the section with the old brand colour" otherwise means listing
		 * pages, reading each one's structure, then reading every section's code —
		 * many calls to answer one question. This walks the sections server-side and
		 * returns only the matching lines, each with the post_id / section_index the
		 * editing actions need.
		 *
		 * @param array $payload pattern, [regex], [ignore_case], [field], [post_id],
		 *                       [post_type], [max_results].
		 * @return array|\WP_Error
		 */
		public static function mcp_grep_sections( $payload ) {
			$payload     = is_array( $payload ) ? $payload : array();
			$pattern     = isset( $payload['pattern'] ) ? (string) $payload['pattern'] : '';
			$is_regex    = ! empty( $payload['regex'] );
			$ignore_case = ! empty( $payload['ignore_case'] );
			$field       = isset( $payload['field'] ) ? strtolower( (string) $payload['field'] ) : 'all';
			$only_post   = isset( $payload['post_id'] ) ? absint( $payload['post_id'] ) : 0;
			$post_type   = isset( $payload['post_type'] ) ? sanitize_key( (string) $payload['post_type'] ) : '';
			$max         = isset( $payload['max_results'] ) ? max( 1, min( 500, (int) $payload['max_results'] ) ) : 100;

			if ( '' === $pattern ) {
				return new \WP_Error( 'uich_missing_param', 'grep requires a "pattern".' );
			}

			$fields = in_array( $field, array( 'html', 'css', 'js' ), true ) ? array( $field ) : array( 'html', 'css', 'js' );

			if ( $is_regex ) {
				$delimited = '~' . str_replace( '~', '\~', $pattern ) . '~' . ( $ignore_case ? 'i' : '' );
				// Validate before walking the whole site, so a bad pattern is one
				// clear error instead of a warning per line.
				if ( false === @preg_match( $delimited, '' ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Validating user-supplied regex; the boolean result is the check.
					return new \WP_Error( 'uich_invalid_regex', 'Invalid regular expression: ' . $pattern );
				}
			}

			if ( $only_post ) {
				$post_ids = array( $only_post );
			} else {
				$post_ids = get_posts(
					array(
						'post_type'        => $post_type ? $post_type : array( 'page', 'post', 'elementor_library', 'nxt_builder' ),
						'post_status'      => array( 'publish', 'draft', 'private', 'pending' ),
						'posts_per_page'   => 200,
						'fields'           => 'ids',
						'no_found_rows'    => true,
						// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Only Elementor-built posts can hold Composer sections; scanning the rest would be wasted work.
						'meta_query'       => array( array( 'key' => '_elementor_data', 'compare' => 'EXISTS' ) ),
						'suppress_filters' => true, // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.SuppressFilters_suppress_filters -- Intentional; VIP-only advisory.
					)
				);
			}

			$matches   = array();
			$scanned   = 0;
			$truncated = false;

			foreach ( $post_ids as $pid ) {
				$elements = self::mcp_load_elements_for_structural_op( $pid );
				if ( is_wp_error( $elements ) ) {
					continue;
				}
				$widgets = array();
				self::collect_uichemy_composer_widgets( $elements, $widgets );

				foreach ( $widgets as $index => $widget ) {
					++$scanned;
					$settings = isset( $widget['settings'] ) && is_array( $widget['settings'] ) ? $widget['settings'] : array();
					$source   = array(
						'html' => isset( $settings['raw_html'] ) ? (string) $settings['raw_html'] : '',
						'css'  => isset( $settings['raw_css'] ) ? (string) $settings['raw_css'] : '',
						'js'   => isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '',
					);

					foreach ( $fields as $f ) {
						if ( '' === $source[ $f ] ) {
							continue;
						}
						foreach ( explode( "\n", $source[ $f ] ) as $line_no => $line ) {
							$hit = $is_regex
								? (bool) preg_match( '~' . str_replace( '~', '\~', $pattern ) . '~' . ( $ignore_case ? 'i' : '' ), $line )
								: ( $ignore_case
									? false !== stripos( $line, $pattern )
									: false !== strpos( $line, $pattern ) );
							if ( ! $hit ) {
								continue;
							}
							if ( count( $matches ) >= $max ) {
								$truncated = true;
								break 4;
							}
							$matches[] = array(
								'post_id'       => (int) $pid,
								'post_title'    => get_the_title( $pid ),
								'section_index' => (int) $index,
								'element_id'    => isset( $widget['id'] ) ? (string) $widget['id'] : '',
								'label'         => isset( $settings['_title'] ) ? (string) $settings['_title'] : '',
								'field'         => $f,
								'line'          => $line_no + 1,
								'text'          => mb_substr( trim( $line ), 0, 300 ),
							);
						}
					}
				}
			}

			return array(
				'pattern'          => $pattern,
				'regex'            => $is_regex,
				'fields'           => $fields,
				'pages_searched'   => count( $post_ids ),
				'sections_scanned' => $scanned,
				'match_count'      => count( $matches ),
				'truncated'        => $truncated,
				'matches'          => $matches,
				'message'          => $truncated
					? 'Result list capped at ' . $max . ' matches narrow the pattern or raise max_results.'
					: '',
			);
		}

		/**
		 * Neutralise a raw CSS block so it cannot break out of a <style> context
		 * or smuggle markup. Strips any tags and a defensive set of CSS vectors.
		 * CSS is not run through kses (that would corrupt valid rules); instead we
		 * remove the handful of constructs that make inline CSS dangerous.
		 *
		 * @param string $css Raw CSS.
		 * @return string
		 */
		public static function sanitize_css_block( $css ) {
			$css = (string) $css;
			// No markup, no </style> breakout.
			$css = wp_strip_all_tags( $css );
			// Remove legacy/script CSS vectors.
			$css = preg_replace( '/expression\s*\(/i', '', $css );
			$css = preg_replace( '/(javascript|vbscript)\s*:/i', '', $css );
			$css = preg_replace( '/@import\b/i', '', $css );
			return trim( (string) $css );
		}

		/**
		 * AJAX: return shared site-level custom code.
		 *
		 * @return void
		 */
		public function ajax_get_site_custom_code() {
			check_ajax_referer( self::EDITOR_AJAX_NONCE_ACTION, 'nonce' );

			if ( ! current_user_can( 'edit_posts' ) ) {
				wp_send_json_error( array( 'message' => 'Unauthorized' ), 403 );
			}

			wp_send_json_success( self::get_site_custom_code_option() );
		}

		/**
		 * AJAX: save shared site-level custom code.
		 *
		 * @return void
		 */
		public function ajax_save_site_custom_code() {
			check_ajax_referer( self::EDITOR_AJAX_NONCE_ACTION, 'nonce' );

			// Site-wide head/footer code is administrator territory, matching
			// WordPress core's own `unfiltered_html` gate. On multisite this is
			// limited to super admins; when DISALLOW_UNFILTERED_HTML is defined
			// nobody qualifies. Lower roles that can build pages should use the
			// per-widget HTML/CSS panels and the structured dependencies picker,
			// which generate escaped tags programmatically.
			if ( ! current_user_can( 'unfiltered_html' ) ) {
				wp_send_json_error( array( 'message' => 'Unauthorized' ), 403 );
			}

			// phpcs:disable WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Sanitized immediately below via self::update_site_custom_code_option() → self::sanitize_custom_code(), which is capability-scoped: only unfiltered_html users store raw markup, everyone else is passed through wp_kses_post().
			$head   = isset( $_POST['head'] ) ? wp_unslash( $_POST['head'] ) : '';
			$footer = isset( $_POST['footer'] ) ? wp_unslash( $_POST['footer'] ) : '';
			// phpcs:enable WordPress.Security.ValidatedSanitizedInput.InputNotSanitized

			wp_send_json_success( self::update_site_custom_code_option( $head, $footer ) );
		}

		// ── Site-level 3rd-party deps ──────────────────────────────────────────

		/**
		 * Get shared site-level deps option.
		 *
		 * @return array
		 */
		public static function get_site_deps_option() {
			$option = get_option( self::SITE_DEPS_OPTION, array() );
			return is_array( $option ) ? $option : array();
		}

		/**
		 * Update shared site-level deps option.
		 *
		 * @param array $deps Array of dep entries.
		 * @return array
		 */
		public static function update_site_deps_option( $deps ) {
			if ( ! is_array( $deps ) ) {
				$deps = array();
			}
			update_option( self::SITE_DEPS_OPTION, $deps, false );
			return $deps;
		}

		/**
		 * AJAX: return shared site-level deps.
		 *
		 * @return void
		 */
		public function ajax_get_site_deps() {
			check_ajax_referer( self::EDITOR_AJAX_NONCE_ACTION, 'nonce' );

			if ( ! current_user_can( 'edit_posts' ) ) {
				wp_send_json_error( array( 'message' => 'Unauthorized' ), 403 );
			}

			wp_send_json_success( self::get_site_deps_option() );
		}

		/**
		 * AJAX: save shared site-level deps.
		 *
		 * @return void
		 */
		public function ajax_save_site_deps() {
			check_ajax_referer( self::EDITOR_AJAX_NONCE_ACTION, 'nonce' );

			// Site-level deps emit external <script src>/<link> tags on every page.
			// Adding those is equivalent to arbitrary code insertion, so the save is
			// gated on `unfiltered_html` — the same capability WordPress core uses
			// for raw markup (administrators on single-site; super admins only on
			// multisite; nobody when DISALLOW_UNFILTERED_HTML is defined). Reading
			// the list stays at edit_posts so lower roles can still see what is set.
			if ( ! current_user_can( 'unfiltered_html' ) ) {
				wp_send_json_error( array( 'message' => 'Unauthorized' ), 403 );
			}

			// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Raw JSON string; each decoded value is sanitized below via map_deep( ..., 'sanitize_text_field' ).
			$raw  = isset( $_POST['deps'] ) ? wp_unslash( $_POST['deps'] ) : '[]';
			$deps = json_decode( $raw, true );
			if ( ! is_array( $deps ) ) {
				$deps = array();
			}
			$deps = map_deep( $deps, 'sanitize_text_field' );

			wp_send_json_success( self::update_site_deps_option( $deps ) );
		}

		/**
		 * Build an HTML asset tag from a dep config array (same logic as the widget).
		 *
		 * @param array $dep Dep config.
		 * @return string HTML tag or empty string.
		 */
		private static function build_dep_asset_tag( $dep ) {
			$url   = isset( $dep['url'] ) ? trim( (string) $dep['url'] ) : '';
			$ver   = isset( $dep['v'] ) ? trim( (string) $dep['v'] ) : '';
			$kind  = isset( $dep['kind'] ) ? (string) $dep['kind'] : 'script';
			$attrs = isset( $dep['attrs'] ) && is_array( $dep['attrs'] ) ? $dep['attrs'] : array();

			if ( '' === $url ) {
				return '';
			}

			if ( '' !== $ver && '—' !== $ver ) {
				$url = str_replace( '{v}', $ver, $url );
			} else {
				$url = str_replace( '{v}', '', $url );
			}

			$url = esc_url( $url );

			if ( 'style' === $kind ) {
				$media = '';
				if ( in_array( 'print', $attrs, true ) ) {
					$media = ' media="print"';
				} elseif ( in_array( 'all', $attrs, true ) ) {
					$media = ' media="all"';
				}
				// phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedStylesheet -- User-configured third-party dependency injected inline at a builder-defined position; URL escaped via esc_url(); not eligible for the standard enqueue pipeline.
				return '<link rel="stylesheet" href="' . $url . '"' . $media . ' />';
			} else {
				$extra = '';
				if ( in_array( 'defer', $attrs, true ) ) {
					$extra .= ' defer';
				} elseif ( in_array( 'async', $attrs, true ) ) {
					$extra .= ' async';
				}
				if ( in_array( 'module', $attrs, true ) ) {
					$extra .= ' type="module"';
				}
				// phpcs:ignore WordPress.WP.EnqueuedResources.NonEnqueuedScript -- User-configured third-party dependency injected inline at a builder-defined position; URL escaped via esc_url(); not eligible for the standard enqueue pipeline.
				return '<script src="' . $url . '"' . $extra . '></script>';
			}
		}

		/**
		 * Print custom code in <head>.
		 *
		 * @return void
		 */
		public function print_head_custom_code() {
			if ( is_admin() ) {
				return;
			}

			$this->print_location_custom_code( 'head' );
		}

		/**
		 * Print custom code before </body>.
		 *
		 * @return void
		 */
		public function print_body_end_custom_code() {
			if ( is_admin() ) {
				return;
			}

			$this->print_location_custom_code( 'body_end' );
		}

		/**
		 * Print merged site-level and page-level code for a location.
		 *
		 * @param string $location Location key.
		 * @return void
		 */
		private function print_location_custom_code( $location ) {
			$site_codes = $this->get_site_level_custom_code( $location );
			$page_codes = $this->get_page_level_widget_custom_code( $location );

			// NOTE: 3rd-party asset deps for the page/site scopes are NOT emitted
			// here from the raw_deps_* JSON lists. The composer panel writes the
			// resulting <script>/<link> tag directly into the page_custom_code_*
			// and site_custom_code_* code-editor settings — which we emit below —
			// so the code editor is the single source of truth. Emitting the
			// JSON-derived tags too would produce duplicate <script> tags on the
			// published page (and worse, the dup could load AFTER inline widget
			// scripts that depend on the library).

			// Escaping note: these values are author markup that is sanitized at
			// STORE time, keyed to capability — the site option via
			// self::sanitize_custom_code() (wp_kses_post() for anyone without
			// `unfiltered_html`) and the page/widget code via Elementor's own kses
			// on save. Emitting them raw here is therefore equivalent to core's
			// Custom HTML block: re-escaping on output would corrupt valid markup.
			// The location label interpolated into the comment is a fixed internal
			// string ('head' / 'body_end'), never user input.
			foreach ( $site_codes as $site_code ) {
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Sanitized on save per capability (see note above).
				echo "\n<!-- Composer: Site Custom Code (" . esc_html( $location ) . ") -->\n" . $site_code . "\n";
			}

			// Page-level code lives in widget settings. Elementor's editor save
			// kses-filters it per capability, but direct-to-meta import paths (MCP)
			// bypass that pipeline, so gate emission on the page author's
			// `unfiltered_html` capability as well — script only survives for
			// authors WordPress itself would trust with raw markup.
			$page_author_trusted = self::page_author_allows_raw_code();

			foreach ( $page_codes as $page_code ) {
				if ( ! $page_author_trusted ) {
					$page_code = wp_kses_post( $page_code );
				}
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Sanitized on save per capability, and re-filtered above for untrusted page authors (see notes).
				echo "\n<!-- Composer: Page Custom Code (" . esc_html( $location ) . ") -->\n" . $page_code . "\n";
			}
		}

		/**
		 * Whether the currently queried post's author may emit raw code. Mirrors
		 * the widget-level check; used to gate page-level custom-code output that
		 * may have been written directly to post meta by an import path.
		 *
		 * @return bool
		 */
		private static function page_author_allows_raw_code() {
			$post_id = get_queried_object_id();
			if ( ! $post_id ) {
				return current_user_can( 'unfiltered_html' );
			}
			$author_id = (int) get_post_field( 'post_author', $post_id );
			return $author_id > 0 && user_can( $author_id, 'unfiltered_html' );
		}

		/**
		 * Get asset tags for page-level deps at a specific position.
		 *
		 * @param string $position 'before' (head) or 'after' (footer).
		 * @return array<int, string> HTML tag strings.
		 */
		private function get_page_level_widget_deps( $position ) {
			if ( ! is_singular() ) {
				return array();
			}

			$post_id = get_queried_object_id();
			if ( ! $post_id ) {
				return array();
			}

			$elements = $this->get_elementor_data_from_post( $post_id );
			if ( empty( $elements ) ) {
				return array();
			}

			// Collect deps JSON from the first Composer widget that has it set.
			$raw_deps_json = $this->extract_first_widget_setting_from_elements( $elements, 'raw_deps_page' );
			if ( empty( $raw_deps_json ) ) {
				return array();
			}

			$deps = json_decode( $raw_deps_json, true );
			if ( ! is_array( $deps ) ) {
				return array();
			}

			$tags        = array();
			$seen_urls   = array();
			foreach ( $deps as $dep ) {
				if ( empty( $dep['enabled'] ) ) {
					continue;
				}
				$pos = isset( $dep['position'] ) ? (string) $dep['position'] : 'before';
				if ( $pos !== $position ) {
					continue;
				}
				$url_key = isset( $dep['url'] ) ? trim( (string) $dep['url'] ) : '';
				if ( '' === $url_key || isset( $seen_urls[ $url_key ] ) ) {
					continue;
				}
				$seen_urls[ $url_key ] = true;
				$tag = self::build_dep_asset_tag( $dep );
				if ( '' !== $tag ) {
					$tags[] = $tag;
				}
			}

			return $tags;
		}

		/**
		 * Recursively find the first Composer widget and return a setting value from it.
		 *
		 * @param array  $elements Elementor elements tree.
		 * @param string $setting_key Setting key to extract.
		 * @return string
		 */
		private function extract_first_widget_setting_from_elements( $elements, $setting_key ) {
			foreach ( $elements as $element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}
				$el_type     = isset( $element['elType'] ) ? $element['elType'] : '';
				$widget_type = isset( $element['widgetType'] ) ? $element['widgetType'] : '';
				$settings    = isset( $element['settings'] ) && is_array( $element['settings'] ) ? $element['settings'] : array();

				if ( 'widget' === $el_type && uichemy_is_composer_widget_type( $widget_type ) ) {
					$value = isset( $settings[ $setting_key ] ) ? trim( (string) $settings[ $setting_key ] ) : '';
					if ( '' !== $value ) {
						return $value;
					}
				}

				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					$found = $this->extract_first_widget_setting_from_elements( $element['elements'], $setting_key );
					if ( '' !== $found ) {
						return $found;
					}
				}
			}
			return '';
		}

		/**
		 * Get current page custom code from widget instances.
		 *
		 * @param string $location Location key.
		 * @return array<int, string>
		 */
		private function get_page_level_widget_custom_code( $location ) {
			if ( ! is_singular() ) {
				return array();
			}

			$post_id = get_queried_object_id();
			if ( ! $post_id ) {
				return array();
			}

			$elements = $this->get_elementor_data_from_post( $post_id );
			if ( empty( $elements ) ) {
				return array();
			}

			return $this->extract_widget_custom_code_from_elements( $elements, $location, 'page' );
		}

		/**
		 * Get site-wide custom code from shared option.
		 *
		 * @param string $location Location key.
		 * @return array<int, string>
		 */
		private function get_site_level_custom_code( $location ) {
			$site_code = self::get_site_custom_code_option();
			$field     = 'head' === $location ? 'head' : 'footer';
			$value     = trim( $site_code[ $field ] );

			if ( '' === $value ) {
				return array();
			}

			return array( $value );
		}

		/**
		 * Read Elementor data array from post meta.
		 *
		 * @param int $post_id Post ID.
		 * @return array
		 */
		private function get_elementor_data_from_post( $post_id ) {
			$raw_data = get_post_meta( $post_id, '_elementor_data', true );

			if ( empty( $raw_data ) || ! is_string( $raw_data ) ) {
				return array();
			}

			$elements = json_decode( $raw_data, true );

			return is_array( $elements ) ? $elements : array();
		}

		/**
		 * Recursively extract custom code from Composer widget elements.
		 *
		 * @param array  $elements Elements tree.
		 * @param string $location head|body_end.
		 * @param string $scope    page|site.
		 * @return array<int, string>
		 */
		private function extract_widget_custom_code_from_elements( $elements, $location, $scope, &$seen_signatures = null ) {
			if ( null === $seen_signatures ) {
				$seen_signatures = array();
			}

			$codes     = array();
			$field_map = array(
				'page' => array(
					'head'     => 'page_custom_code_head',
					'body_end' => 'page_custom_code_footer',
				),
				'site' => array(
					'head'     => 'site_custom_code_head',
					'body_end' => 'site_custom_code_footer',
				),
			);

			if ( ! isset( $field_map[ $scope ][ $location ] ) ) {
				return $codes;
			}

			$field = $field_map[ $scope ][ $location ];

			foreach ( $elements as $element ) {
				if ( ! is_array( $element ) ) {
					continue;
				}

				$el_type     = isset( $element['elType'] ) ? $element['elType'] : '';
				$widget_type = isset( $element['widgetType'] ) ? $element['widgetType'] : '';
				$settings    = isset( $element['settings'] ) && is_array( $element['settings'] ) ? $element['settings'] : array();

				if ( 'widget' === $el_type && uichemy_is_composer_widget_type( $widget_type ) ) {
					$code = isset( $settings[ $field ] ) ? trim( (string) $settings[ $field ] ) : '';

					if ( '' !== $code ) {
						$sig = md5( $code );
						if ( ! isset( $seen_signatures[ $sig ] ) ) {
							$seen_signatures[ $sig ] = true;
							$codes[]                 = $code;
						}
					}
				}

				if ( ! empty( $element['elements'] ) && is_array( $element['elements'] ) ) {
					$codes = array_merge( $codes, $this->extract_widget_custom_code_from_elements( $element['elements'], $location, $scope, $seen_signatures ) );
				}
			}

			return $codes;
		}

		/**
		 * Collect class tokens that appear on the same element as an Elementor global `text-*` preset class.
		 * Used to strip redundant typography declarations from scoped CSS when globals already apply.
		 *
		 * @param string $html                 HTML fragment.
		 * @param array  $typography_presets Presets from mcp_parse_globals_ai_css_snapshot().
		 * @return array<string,bool> Map of class token => true.
		 */
		private static function mcp_build_strippable_typography_classes_from_html( $html, $typography_presets ) {
			$html = (string) $html;
			if ( '' === trim( $html ) || empty( $typography_presets ) || ! class_exists( '\DOMDocument' ) || ! class_exists( '\DOMXPath' ) ) {
				return array();
			}

			$preset_lookup = array();
			foreach ( (array) $typography_presets as $preset ) {
				$cn = isset( $preset['class_name'] ) ? sanitize_html_class( (string) $preset['class_name'] ) : '';
				if ( '' !== $cn ) {
					$preset_lookup[ $cn ] = true;
				}
			}
			if ( empty( $preset_lookup ) ) {
				return array();
			}

			$dom = new \DOMDocument();
			$libxml_previous = libxml_use_internal_errors( true );
			$loaded = $dom->loadHTML(
				'<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' . $html . '</body></html>',
				LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
			);
			libxml_clear_errors();
			libxml_use_internal_errors( $libxml_previous );

			if ( ! $loaded ) {
				return array();
			}

			$xpath      = new \DOMXPath( $dom );
			$strippable = array();
			$nodes      = $xpath->query( '//*[@class]' );
			if ( ! ( $nodes instanceof \DOMNodeList ) ) {
				return array();
			}

			foreach ( $nodes as $node ) {
				if ( ! ( $node instanceof \DOMElement ) ) {
					continue;
				}
				$parts = preg_split( '/\s+/', trim( (string) $node->getAttribute( 'class' ) ) );
				if ( ! is_array( $parts ) ) {
					continue;
				}
				$has_preset = false;
				foreach ( $parts as $p ) {
					if ( isset( $preset_lookup[ $p ] ) ) {
						$has_preset = true;
						break;
					}
				}
				if ( ! $has_preset ) {
					continue;
				}
				foreach ( $parts as $p ) {
					if ( '' === $p || isset( $preset_lookup[ $p ] ) ) {
						continue;
					}
					$strippable[ $p ] = true;
				}
			}

			return $strippable;
		}

		/**
		 * Whether a selector's last compound contains a class that shares a node with a global typography class.
		 *
		 * @param string $selector       One comma-free selector fragment.
		 * @param array  $strippable_map Map from mcp_build_strippable_typography_classes_from_html().
		 * @return bool
		 */
		private static function mcp_css_selector_targets_strippable_typography_class( $selector, array $strippable_map ) {
			if ( empty( $strippable_map ) ) {
				return false;
			}
			$selector = trim( (string) preg_replace( '/\s+/', ' ', (string) $selector ) );
			if ( '' === $selector || false !== strpos( $selector, '@' ) ) {
				return false;
			}

			$toks = preg_split( '/\s+/', $selector );
			if ( ! is_array( $toks ) || empty( $toks ) ) {
				return false;
			}
			$last = (string) end( $toks );
			if ( preg_match_all( '/\.([a-zA-Z_][a-zA-Z0-9_-]*)/', $last, $mm ) ) {
				foreach ( $mm[1] as $cn ) {
					if ( isset( $strippable_map[ $cn ] ) ) {
						return true;
					}
				}
			}

			return false;
		}

		/**
		 * Remove font-* / text-* declarations from rules targeting BEM classes that already use Elementor `text-*` on the same element.
		 *
		 * @param string $html                 HTML after global class application.
		 * @param string $css                  Scoped widget CSS.
		 * @param array  $typography_presets Presets from snapshot parse.
		 * @return string
		 */
		private static function mcp_strip_typography_decls_for_preset_global_classes_on_html( $html, $css, $typography_presets ) {
			$html = (string) $html;
			$css  = (string) $css;
			if ( '' === trim( $css ) || '' === trim( $html ) || empty( $typography_presets ) ) {
				return $css;
			}

			$strippable = self::mcp_build_strippable_typography_classes_from_html( $html, $typography_presets );
			if ( empty( $strippable ) ) {
				return $css;
			}

			$typography_props = array(
				'font-family'     => true,
				'font-size'       => true,
				'font-weight'     => true,
				'line-height'     => true,
				'letter-spacing'  => true,
				'text-transform'  => true,
				'text-decoration' => true,
				'font-style'      => true,
			);

			$next = preg_replace_callback(
				'/([^{]+)\{([^}]*)\}/s',
				function ( $m ) use ( $strippable, $typography_props ) {
					$selector = isset( $m[1] ) ? trim( (string) $m[1] ) : '';
					$body     = isset( $m[2] ) ? (string) $m[2] : '';
					if ( '' === $selector || '' === trim( $body ) ) {
						return $m[0];
					}
					if ( false !== strpos( $selector, '@' ) ) {
						return $m[0];
					}

					$sel_parts = array_map( 'trim', explode( ',', $selector ) );
					$strip_sel = array();
					$keep_sel  = array();
					foreach ( $sel_parts as $p ) {
						if ( '' === $p ) {
							continue;
						}
						if ( self::mcp_css_selector_targets_strippable_typography_class( $p, $strippable ) ) {
							$strip_sel[] = $p;
						} else {
							$keep_sel[] = $p;
						}
					}

					$decls = self::mcp_parse_css_declarations( $body, true );
					if ( empty( $decls ) ) {
						return $m[0];
					}

					$out = array();
					if ( ! empty( $strip_sel ) ) {
						$filtered = array_values(
							array_filter(
								$decls,
								function ( $row ) use ( $typography_props ) {
									$prop = isset( $row['property'] ) ? self::mcp_normalize_css_property( (string) $row['property'] ) : '';
									return '' === $prop || ! isset( $typography_props[ $prop ] );
								}
							)
						);
						if ( ! empty( $filtered ) ) {
							$nb = self::mcp_build_css_declarations( $filtered );
							if ( '' !== trim( $nb ) ) {
								$out[] = implode( ', ', $strip_sel ) . " {\n" . $nb . "\n}";
							}
						}
					}
					if ( ! empty( $keep_sel ) ) {
						$out[] = implode( ', ', $keep_sel ) . " {\n" . trim( $body ) . "\n}";
					}

					if ( empty( $out ) ) {
						return '';
					}

					return implode( "\n", $out );
				},
				$css
			);

			return is_string( $next ) ? $next : $css;
		}

		/**
		 * Match section CSS/HTML against the #uichemy-globals block and apply the
		 * site design system.
		 *
		 * - Converts matched literal colour values to var(--<name>) (the block's :root tokens)
		 * - Adds the matched .text-* typography class to HTML elements for safe selector types
		 *
		 * @param array $payload Input payload.
		 * @return array|\WP_Error
		 */
		public static function mcp_apply_global_matches_dynamic( $payload ) {
			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$html = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$css = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$globals_ai_data = isset( $payload['globals_ai_data'] ) ? (string) $payload['globals_ai_data'] : '';
			$prefer_typography_class = ! isset( $payload['prefer_typography_class'] ) || (bool) $payload['prefer_typography_class'];

			// If snapshot not provided, fetch it automatically from the active Elementor kit
			// using the same mechanism as the Composer widget's "AI Data Sending" panel.
			if ( '' === trim( $globals_ai_data ) ) {
				// Source globals from the #uichemy-globals CSS block (the site-wide
				// design system), replacing the legacy Elementor-kit snapshot.
				$globals_ai_data = self::get_globals_block_css();
			}

			// If still no snapshot available, skip matching — page will use raw CSS values.
			if ( '' === trim( $globals_ai_data ) ) {
				return array(
					'html' => $html,
					'css' => $css,
					'matches' => array(
						'color_replacements' => 0,
						'typography_rules_matched' => 0,
						'html_elements_class_applied' => 0,
					),
					'unmatched' => array(),
					'message' => 'AI Data Sharing snapshot not available Elementor globals could not be read. Proceeding with raw CSS values.',
				);
			}

			$globals = self::mcp_parse_globals_ai_css_snapshot( $globals_ai_data );
			$color_value_to_id = isset( $globals['color_value_to_id'] ) ? $globals['color_value_to_id'] : array();
			$typography_presets = isset( $globals['typography_presets'] ) ? $globals['typography_presets'] : array();

			if ( '' === trim( $css ) ) {
				return array(
					'html' => $html,
					'css' => $css,
					'matches' => array(
						'color_replacements' => 0,
						'typography_rules_matched' => 0,
						'html_elements_class_applied' => 0,
					),
					'unmatched' => array(),
					'message' => 'No CSS provided. Nothing to match.',
				);
			}

			$result = self::mcp_apply_dynamic_globals_to_css( $css, $color_value_to_id, $typography_presets );
			$next_css = isset( $result['css'] ) ? (string) $result['css'] : $css;
			$typography_class_targets = isset( $result['typography_class_targets'] ) ? $result['typography_class_targets'] : array();

			$html_apply_count = 0;
			$next_html = $html;
			if ( $prefer_typography_class && ! empty( $typography_class_targets ) && '' !== trim( $html ) ) {
				$apply_html = self::mcp_apply_typography_classes_to_html( $html, $typography_class_targets );
				$next_html = isset( $apply_html['html'] ) ? (string) $apply_html['html'] : $html;
				$html_apply_count = isset( $apply_html['applied'] ) ? (int) $apply_html['applied'] : 0;
			}

			if ( '' !== trim( $next_css ) && '' !== trim( $next_html ) && ! empty( $typography_presets ) ) {
				$next_css = self::mcp_strip_typography_decls_for_preset_global_classes_on_html( $next_html, $next_css, $typography_presets );
			}

			return array(
				'html' => $next_html,
				'css' => $next_css,
				'matches' => array(
					'color_replacements' => isset( $result['color_replacements'] ) ? (int) $result['color_replacements'] : 0,
					'color_matches' => isset( $result['color_matches_detail'] ) ? $result['color_matches_detail'] : array(),
					'typography_rules_matched' => isset( $result['typography_rules_matched'] ) ? (int) $result['typography_rules_matched'] : 0,
					'html_elements_class_applied' => $html_apply_count,
				),
				'unmatched' => isset( $result['unmatched'] ) ? $result['unmatched'] : array(),
				'message' => 'Dynamic global matching applied.',
			);
		}

		/**
		 * Parse AI globals CSS snapshot into color and typography maps.
		 *
		 * @param string $globals_ai_data AI globals CSS snapshot.
		 * @return array<string, mixed>
		 */
		private static function mcp_parse_globals_ai_css_snapshot( $globals_ai_data ) {
			$globals_ai_data = (string) $globals_ai_data;
			$color_value_to_id = array();
			$typography_presets = array();

			if ( preg_match_all( '/--([a-zA-Z0-9_-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([^;]*\))\s*;/i', $globals_ai_data, $color_matches, PREG_SET_ORDER ) ) {
				foreach ( $color_matches as $match ) {
					$color_id = isset( $match[1] ) ? trim( (string) $match[1] ) : '';
					$color_value = isset( $match[2] ) ? self::mcp_normalize_css_value( $match[2] ) : '';
					if ( '' === $color_id || '' === $color_value ) {
						continue;
					}
					$color_value_to_id[ $color_value ] = $color_id;
				}
			}

			if ( preg_match_all( '/\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/s', $globals_ai_data, $class_blocks, PREG_SET_ORDER ) ) {
				foreach ( $class_blocks as $block ) {
					$class_name = isset( $block[1] ) ? trim( (string) $block[1] ) : '';
					$body = isset( $block[2] ) ? (string) $block[2] : '';
					if ( '' === $class_name || 0 !== strpos( $class_name, 'text-' ) ) {
						continue;
					}

					$preset_id = preg_replace( '/^text-/', '', $class_name );
					$decls = self::mcp_parse_css_declarations( $body );
					if ( empty( $decls ) ) {
						continue;
					}
					$typography_presets[] = array(
						'class_name' => $class_name,
						'preset_id' => $preset_id,
						'decls' => $decls,
					);
				}
			}

			return array(
				'color_value_to_id' => $color_value_to_id,
				'typography_presets' => $typography_presets,
			);
		}

		/**
		 * Apply color + typography dynamic vars to CSS.
		 *
		 * @param string $css Input css.
		 * @param array  $color_value_to_id Color map normalized value => global id.
		 * @param array  $typography_presets Typography presets.
		 * @return array<string, mixed>
		 */
		private static function mcp_apply_dynamic_globals_to_css( $css, $color_value_to_id, $typography_presets ) {
			$css = (string) $css;
			$color_replacements = 0;
			$color_matches_detail = array();
			$typography_rules_matched = 0;
			$unmatched_selectors = array();
			$typography_class_targets = array();

			$typography_map = array(
				'font-family' => 'font-family',
				'font-size' => 'font-size',
				'font-weight' => 'font-weight',
				'line-height' => 'line-height',
				'letter-spacing' => 'letter-spacing',
				'text-transform' => 'text-transform',
				'text-decoration' => 'text-decoration',
				'font-style' => 'font-style',
			);

			$color_prop_regex = '/(?:^|[^-])(color|background-color|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline-color|text-decoration-color|column-rule-color|fill|stroke)$/i';

			$next_css = preg_replace_callback(
				'/([^{]+)\{([^}]*)\}/s',
				function ( $rule_match ) use (
					$color_value_to_id,
					$typography_presets,
					$typography_map,
					$color_prop_regex,
					&$color_replacements,
					&$color_matches_detail,
					&$typography_rules_matched,
					&$unmatched_selectors,
					&$typography_class_targets
				) {
					$selector = isset( $rule_match[1] ) ? trim( (string) $rule_match[1] ) : '';
					$body = isset( $rule_match[2] ) ? (string) $rule_match[2] : '';
					if ( '' === $selector ) {
						return $rule_match[0];
					}

					$decls = self::mcp_parse_css_declarations( $body, true );
					if ( empty( $decls ) ) {
						return $rule_match[0];
					}

					$decl_map = array();
					foreach ( $decls as $idx => $d ) {
						$prop_key = self::mcp_normalize_css_property( $d['property'] );
						$decl_map[ $prop_key ] = $idx;
					}

					// Typography preset match.
					$matched_preset = null;
					foreach ( $typography_presets as $preset ) {
						$preset_decls = isset( $preset['decls'] ) && is_array( $preset['decls'] ) ? $preset['decls'] : array();
						if ( empty( $preset_decls ) ) {
							continue;
						}

						// Properties whose preset value equals the CSS default — omitting
						// them in generated CSS is semantically identical, so don't fail
						// the match when the CSS doesn't declare them explicitly.
						$css_default_values = array(
							'font-style'      => array( 'normal' ),
							'text-transform'  => array( 'none' ),
							'text-decoration' => array( 'none' ),
							'letter-spacing'  => array( '0', '0px', 'normal' ),
							'line-height'     => array( 'normal' ),
						);

						$all_match = true;
						foreach ( $typography_map as $prop => $suffix ) {
							if ( ! isset( $preset_decls[ $prop ] ) ) {
								continue;
							}
							if ( ! isset( $decl_map[ $prop ] ) ) {
								// If the preset value is a CSS default for this property,
								// not writing it in CSS is equivalent — treat as matched.
								$preset_normalized = self::mcp_normalize_css_value( $preset_decls[ $prop ] );
								if ( isset( $css_default_values[ $prop ] ) && in_array( $preset_normalized, $css_default_values[ $prop ], true ) ) {
									continue;
								}
								$all_match = false;
								break;
							}
							$decl_row     = $decls[ $decl_map[ $prop ] ];
							$current_raw  = isset( $decl_row['value'] ) ? (string) $decl_row['value'] : '';
							$expected_raw = isset( $preset_decls[ $prop ] ) ? (string) $preset_decls[ $prop ] : '';
							if ( ! self::mcp_typography_decl_values_match( $prop, $current_raw, $expected_raw ) ) {
								$all_match = false;
								break;
							}
						}

						if ( $all_match ) {
							$matched_preset = $preset;
							break;
						}
					}

					if ( $matched_preset ) {
						$preset_id = isset( $matched_preset['preset_id'] ) ? sanitize_key( (string) $matched_preset['preset_id'] ) : '';
						$class_name = isset( $matched_preset['class_name'] ) ? sanitize_html_class( (string) $matched_preset['class_name'] ) : '';
						if ( '' !== $preset_id ) {
							// Strip matched typography properties from this selector — the
							// text-* Elementor global class added to the HTML element is the
							// single source of truth for typography. Keeping var() duplicates
							// here would conflict with or override the global.
							$decls = array_values(
								array_filter(
									$decls,
									function ( $decl_row ) use ( $typography_map ) {
										$prop_name = isset( $decl_row['property'] ) ? self::mcp_normalize_css_property( $decl_row['property'] ) : '';
										return ! isset( $typography_map[ $prop_name ] );
									}
								)
							);
							$typography_rules_matched++;
							if ( '' !== $class_name ) {
								$replace_class = self::mcp_extract_typography_only_selector_class( $selector );
								$typography_class_targets[] = array(
									'selector' => $selector,
									'class_name' => $class_name,
									'replace_class' => $replace_class,
								);
							}
						}
					} else {
						$unmatched_selectors[] = $selector;
					}

					// Color replacements.
					foreach ( $decls as $idx => $decl ) {
						$prop = self::mcp_normalize_css_property( $decl['property'] );
						if ( ! preg_match( $color_prop_regex, $prop ) ) {
							continue;
						}
						$normalized_value = self::mcp_normalize_css_value( $decl['value'] );
						if ( isset( $color_value_to_id[ $normalized_value ] ) ) {
							$color_id = sanitize_key( (string) $color_value_to_id[ $normalized_value ] );
							if ( '' !== $color_id ) {
								$decls[ $idx ]['value'] = 'var(--' . $color_id . ')';
								$color_replacements++;
								$color_pair = $normalized_value . '||' . $color_id;
								if ( ! isset( $color_matches_detail[ $color_pair ] ) ) {
									$color_matches_detail[ $color_pair ] = array(
										'value' => $normalized_value,
										'global_id' => $color_id,
									);
								}
							}
						}
					}

					if ( empty( $decls ) ) {
						return '';
					}

					$next_body = self::mcp_build_css_declarations( $decls );
					return $selector . " {\n" . $next_body . "\n}";
				},
				$css
			);

			if ( ! is_string( $next_css ) ) {
				$next_css = $css;
			}

			// Dedupe typography class targets — duplicate selector+class pairs
			// (e.g. when the same selector appears twice in CSS) would otherwise
			// queue the same DOM mutation more than once downstream.
			$dedupe_seen = array();
			$dedupe_targets = array();
			foreach ( $typography_class_targets as $target ) {
				$selector_key = isset( $target['selector'] ) ? trim( (string) $target['selector'] ) : '';
				$class_key = isset( $target['class_name'] ) ? trim( (string) $target['class_name'] ) : '';
				if ( '' === $selector_key || '' === $class_key ) {
					continue;
				}
				$pair = $selector_key . '|' . $class_key;
				if ( isset( $dedupe_seen[ $pair ] ) ) {
					continue;
				}
				$dedupe_seen[ $pair ] = true;
				$dedupe_targets[] = $target;
			}

			return array(
				'css' => $next_css,
				'color_replacements' => $color_replacements,
				'color_matches_detail' => array_values( $color_matches_detail ),
				'typography_rules_matched' => $typography_rules_matched,
				'typography_class_targets' => $dedupe_targets,
				'unmatched' => array_values( array_unique( array_filter( $unmatched_selectors ) ) ),
			);
		}

		/**
		 * Apply typography class names to HTML for safely mappable selectors.
		 * Supported target forms:
		 * - .class, #id, tag
		 * - chained/simple descendant selectors where the terminal token is one of
		 *   the safe forms above (e.g. ".hero .title", "section .copy")
		 *
		 * @param string $html Raw HTML.
		 * @param array  $targets Selector/class targets.
		 * @return array<string, mixed>
		 */
		private static function mcp_apply_typography_classes_to_html( $html, $targets ) {
			$html = (string) $html;
			if ( '' === trim( $html ) || empty( $targets ) || ! class_exists( '\DOMDocument' ) || ! class_exists( '\DOMXPath' ) ) {
				return array(
					'html' => $html,
					'applied' => 0,
				);
			}

			$dom = new \DOMDocument();
			$previous = libxml_use_internal_errors( true );
			$loaded = $dom->loadHTML(
				'<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' . $html . '</body></html>',
				LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
			);
			libxml_clear_errors();
			libxml_use_internal_errors( $previous );

			if ( ! $loaded ) {
				return array(
					'html' => $html,
					'applied' => 0,
				);
			}

			$xpath = new \DOMXPath( $dom );
			$applied = 0;
			$seen = array();

			foreach ( $targets as $target ) {
				$selector_raw = isset( $target['selector'] ) ? (string) $target['selector'] : '';
				$class_name = isset( $target['class_name'] ) ? sanitize_html_class( (string) $target['class_name'] ) : '';
				$replace_class = isset( $target['replace_class'] ) ? sanitize_html_class( (string) $target['replace_class'] ) : '';
				if ( '' === $selector_raw || '' === $class_name ) {
					continue;
				}

				$selectors = array_map( 'trim', explode( ',', $selector_raw ) );
				foreach ( $selectors as $selector ) {
					$selector = self::mcp_get_selector_terminal_target( $selector );
					if ( '' === $selector ) {
						continue;
					}

					$query = '';
					if ( '.' === substr( $selector, 0, 1 ) ) {
						$token = sanitize_html_class( substr( $selector, 1 ) );
						if ( '' === $token ) {
							continue;
						}
						$query = "//*[contains(concat(' ', normalize-space(@class), ' '), ' " . $token . " ')]";
					} elseif ( '#' === substr( $selector, 0, 1 ) ) {
						$id = sanitize_key( substr( $selector, 1 ) );
						if ( '' === $id ) {
							continue;
						}
						$query = "//*[@id='" . $id . "']";
					} elseif ( preg_match( '/^[a-zA-Z][a-zA-Z0-9-]*$/', $selector ) ) {
						$query = '//' . strtolower( $selector );
					}

					if ( '' === $query ) {
						continue;
					}

					$nodes = $xpath->query( $query );
					if ( ! ( $nodes instanceof \DOMNodeList ) ) {
						continue;
					}

					foreach ( $nodes as $node ) {
						if ( ! ( $node instanceof \DOMElement ) ) {
							continue;
						}
						$key = spl_object_hash( $node ) . '|' . $class_name;
						if ( isset( $seen[ $key ] ) ) {
							continue;
						}
						$seen[ $key ] = true;
						$current = trim( (string) $node->getAttribute( 'class' ) );
						$class_parts = preg_split( '/\s+/', $current );
						if ( ! is_array( $class_parts ) ) {
							$class_parts = array();
						}

						if ( '' !== $replace_class ) {
							$class_parts = array_values(
								array_filter(
									$class_parts,
									function ( $token ) use ( $replace_class ) {
										return trim( (string) $token ) !== $replace_class;
									}
								)
							);
						}

						if ( ! in_array( $class_name, $class_parts, true ) ) {
							$class_parts[] = $class_name;
						}
						$class_parts = array_values( array_filter( array_unique( $class_parts ) ) );
						$next_class_attr = implode( ' ', $class_parts );
						if ( $next_class_attr !== $current ) {
							$node->setAttribute( 'class', $next_class_attr );
							$applied++;
						}
					}
				}
			}

			// Final compaction pass — walk every element with a class attribute
			// and dedupe its class tokens. Belt-and-suspenders defense against
			// any path that could have produced repeats (legacy classes already
			// in the source HTML, multiple matchers, etc.).
			$all_elements = $xpath->query( '//*[@class]' );
			if ( $all_elements instanceof \DOMNodeList ) {
				foreach ( $all_elements as $el ) {
					if ( ! ( $el instanceof \DOMElement ) ) {
						continue;
					}
					$raw = trim( (string) $el->getAttribute( 'class' ) );
					if ( '' === $raw ) {
						continue;
					}
					$parts = preg_split( '/\s+/', $raw );
					if ( ! is_array( $parts ) ) {
						continue;
					}
					$parts = array_values( array_filter( array_unique( $parts ), function ( $token ) {
						return '' !== trim( (string) $token );
					} ) );
					$compact = implode( ' ', $parts );
					if ( $compact !== $raw ) {
						$el->setAttribute( 'class', $compact );
					}
				}
			}

			$body = $dom->getElementsByTagName( 'body' )->item( 0 );
			if ( ! $body ) {
				return array(
					'html' => $html,
					'applied' => $applied,
				);
			}

			$next_html = '';
			foreach ( $body->childNodes as $child ) {
				$next_html .= $dom->saveHTML( $child );
			}

			return array(
				'html' => $next_html,
				'applied' => $applied,
			);
		}

		/**
		 * Reduce a potentially complex CSS selector to a safe terminal target token
		 * for DOMXPath matching.
		 *
		 * Examples:
		 * - ".hero .title"        => ".title"
		 * - "section .copy:hover" => ".copy"
		 * - ".card[data-x='1']"   => ".card"
		 * - "#main > h2"          => "h2"
		 *
		 * @param string $selector CSS selector.
		 * @return string Safe terminal target token (.class, #id, tag) or empty when unsupported.
		 */
		private static function mcp_get_selector_terminal_target( $selector ) {
			$selector = trim( (string) $selector );
			if ( '' === $selector ) {
				return '';
			}

			// Ignore unsupported selector constructs entirely.
			if ( preg_match( '/\*/', $selector ) ) {
				return '';
			}

			// Use the right-most compound token after combinators.
			$parts = preg_split( '/\s+|>|~|\+/', $selector );
			if ( ! is_array( $parts ) || empty( $parts ) ) {
				return '';
			}
			$token = trim( (string) end( $parts ) );
			if ( '' === $token ) {
				return '';
			}

			// Drop pseudo classes/elements and attribute selectors from terminal token.
			$token = preg_replace( '/:{1,2}[a-zA-Z0-9_-]+(?:\([^)]*\))?$/', '', $token );
			$token = preg_replace( '/\[[^\]]*\]/', '', $token );
			$token = trim( (string) $token );
			if ( '' === $token ) {
				return '';
			}

			// Keep only one terminal target kind.
			if ( preg_match( '/\.([a-zA-Z0-9_-]+)$/', $token, $m ) ) {
				return '.' . sanitize_html_class( $m[1] );
			}
			if ( preg_match( '/#([a-zA-Z0-9_-]+)$/', $token, $m ) ) {
				return '#' . sanitize_key( $m[1] );
			}
			if ( preg_match( '/^[a-zA-Z][a-zA-Z0-9-]*$/', $token ) ) {
				return strtolower( $token );
			}

			return '';
		}

		/**
		 * Detect dedicated typography-only utility class selectors that are safe to replace.
		 * Contract for generated CSS: single class selector with one of these prefixes:
		 * - .uich-typo-*
		 * - .uich-text-*
		 *
		 * @param string $selector CSS selector.
		 * @return string Class token (without dot) or empty string when not replaceable.
		 */
		private static function mcp_extract_typography_only_selector_class( $selector ) {
			$selector = trim( (string) $selector );
			if ( '' === $selector ) {
				return '';
			}

			// Only a single simple class selector is eligible.
			if ( ! preg_match( '/^\.([a-zA-Z0-9_-]+)$/', $selector, $match ) ) {
				return '';
			}

			$class_name = isset( $match[1] ) ? sanitize_html_class( (string) $match[1] ) : '';
			if ( '' === $class_name ) {
				return '';
			}

			if ( 0 === strpos( $class_name, 'uich-typo-' ) || 0 === strpos( $class_name, 'uich-text-' ) ) {
				return $class_name;
			}

			return '';
		}

		/**
		 * Parse CSS declaration block into array map or list.
		 *
		 * @param string $body CSS declaration body.
		 * @param bool   $keep_order Keep ordered rows when true.
		 * @return array
		 */
		private static function mcp_parse_css_declarations( $body, $keep_order = false ) {
			$body = (string) $body;
			$rows = preg_split( '/;/', $body );
			if ( ! is_array( $rows ) ) {
				return array();
			}

			if ( $keep_order ) {
				$out_rows = array();
				foreach ( $rows as $row ) {
					$pair = explode( ':', $row, 2 );
					if ( ! isset( $pair[1] ) ) {
						continue;
					}
					$prop = self::mcp_normalize_css_property( $pair[0] );
					$val = trim( (string) $pair[1] );
					if ( '' === $prop || '' === $val ) {
						continue;
					}
					$out_rows[] = array(
						'property' => $prop,
						'value' => $val,
					);
				}
				return $out_rows;
			}

			$out = array();
			foreach ( $rows as $row ) {
				$pair = explode( ':', $row, 2 );
				if ( ! isset( $pair[1] ) ) {
					continue;
				}
				$prop = self::mcp_normalize_css_property( $pair[0] );
				$val = trim( (string) $pair[1] );
				if ( '' === $prop || '' === $val ) {
					continue;
				}
				$out[ $prop ] = $val;
			}

			return $out;
		}

		/**
		 * Build CSS declarations from ordered rows.
		 *
		 * @param array $decls Declaration rows.
		 * @return string
		 */
		private static function mcp_build_css_declarations( $decls ) {
			$out = array();
			if ( ! is_array( $decls ) ) {
				return '';
			}
			foreach ( $decls as $row ) {
				$prop = isset( $row['property'] ) ? self::mcp_normalize_css_property( $row['property'] ) : '';
				$val = isset( $row['value'] ) ? trim( (string) $row['value'] ) : '';
				if ( '' === $prop || '' === $val ) {
					continue;
				}
				$out[] = '    ' . $prop . ': ' . $val . ';';
			}
			return implode( "\n", $out );
		}

		/**
		 * Normalize CSS property for matching.
		 *
		 * @param string $property Property.
		 * @return string
		 */
		private static function mcp_normalize_css_property( $property ) {
			return strtolower( trim( (string) $property ) );
		}

		/**
		 * Normalize CSS values for matching.
		 *
		 * @param string $value Css value.
		 * @return string
		 */
		private static function mcp_normalize_css_value( $value ) {
			$value = strtolower( trim( (string) $value ) );
			$value = preg_replace( '/\s+/', ' ', $value );
			return is_string( $value ) ? trim( $value ) : '';
		}

		/**
		 * Normalize font-weight tokens so kit vs generated CSS compares reliably.
		 *
		 * @param string $weight Raw weight.
		 * @return string
		 */
		private static function mcp_normalize_font_weight_for_match( $weight ) {
			$w = strtolower( trim( (string) $weight ) );
			$map = array(
				'normal'  => '400',
				'bold'    => '700',
				'bolder'  => '700',
				'lighter' => '300',
			);
			if ( isset( $map[ $w ] ) ) {
				return $map[ $w ];
			}
			if ( is_numeric( $w ) ) {
				return (string) (int) $w;
			}
			return $w;
		}

		/**
		 * True if two typography declaration values match for globals pairing (tolerances for px rounding, weight aliases).
		 *
		 * @param string $prop         Normalized CSS property name.
		 * @param string $css_value    Value from generated CSS.
		 * @param string $preset_value Value from kit AI snapshot / global preset.
		 * @return bool
		 */
		private static function mcp_typography_decl_values_match( $prop, $css_value, $preset_value ) {
			$css_value    = self::mcp_normalize_css_value( $css_value );
			$preset_value = self::mcp_normalize_css_value( $preset_value );
			if ( '' === $css_value || '' === $preset_value ) {
				return false;
			}
			if ( 'font-family' === $prop ) {
				$css_value    = self::mcp_extract_first_font_family( $css_value );
				$preset_value = self::mcp_extract_first_font_family( $preset_value );
				return '' !== $css_value && $css_value === $preset_value;
			}
			if ( 'font-weight' === $prop ) {
				return self::mcp_normalize_font_weight_for_match( $css_value ) === self::mcp_normalize_font_weight_for_match( $preset_value );
			}
			if ( 'font-size' === $prop ) {
				if ( $css_value === $preset_value ) {
					return true;
				}
				if ( preg_match( '/^(-?[\d.]+)px$/', $css_value, $ma ) && preg_match( '/^(-?[\d.]+)px$/', $preset_value, $mb ) ) {
					return abs( (float) $ma[1] - (float) $mb[1] ) <= 2.0;
				}
				return false;
			}
			if ( 'letter-spacing' === $prop ) {
				if ( $css_value === $preset_value ) {
					return true;
				}
				$za = preg_replace( '/px$/', '', $css_value );
				$zb = preg_replace( '/px$/', '', $preset_value );
				if ( is_numeric( $za ) && is_numeric( $zb ) && abs( (float) $za ) < 0.001 && abs( (float) $zb ) < 0.001 ) {
					return true;
				}
			}
			if ( 'line-height' === $prop ) {
				if ( $css_value === $preset_value ) {
					return true;
				}
				if ( is_numeric( $css_value ) && is_numeric( $preset_value ) ) {
					return abs( (float) $css_value - (float) $preset_value ) < 0.02;
				}
				if ( preg_match( '/^(-?[\d.]+)px$/', $css_value, $ma ) && preg_match( '/^(-?[\d.]+)px$/', $preset_value, $mb ) ) {
					return abs( (float) $ma[1] - (float) $mb[1] ) <= 2.0;
				}
			}
			return $css_value === $preset_value;
		}

		/**
		 * Extract the first font-family token from a CSS font-family value.
		 *
		 * Examples:
		 * - "Inter, Arial, sans-serif" => "inter"
		 * - "'Open Sans', sans-serif" => "open sans"
		 *
		 * @param string $font_family Raw font-family value.
		 * @return string
		 */
		private static function mcp_extract_first_font_family( $font_family ) {
			$font_family = trim( (string) $font_family );
			if ( '' === $font_family ) {
				return '';
			}

			$parts = explode( ',', $font_family );
			$first = isset( $parts[0] ) ? trim( (string) $parts[0] ) : '';
			if ( '' === $first ) {
				return '';
			}

			// Remove surrounding single/double quotes if present.
			$first = preg_replace( '/^([\'"])(.*)\1$/', '$2', $first );
			$first = self::mcp_normalize_css_value( $first );

			return is_string( $first ) ? $first : '';
		}

		// ── Nav menu helpers ──────────────────────────────────────────────────

		/**
		 * MCP — ensure a WordPress nav menu exists.
		 * If no menus are present, creates "Main Menu", populates it with existing
		 * published pages, and assigns it to all unoccupied registered menu locations.
		 *
		 * @param array $payload Optional { menu_name: string }.
		 * @return array|\WP_Error
		 */
		public static function mcp_ensure_nav_menu( $payload = array() ) {
			$nav_menus = wp_get_nav_menus();

			if ( ! empty( $nav_menus ) ) {
				$names = array_values( array_map( function ( $m ) { return $m->name; }, $nav_menus ) );
				return array(
					'created'   => false,
					'menu_id'   => (int) $nav_menus[0]->term_id,
					'menu_name' => $nav_menus[0]->name,
					'all_menus' => $names,
					'message'   => 'Navigation menu already exists no action taken.',
				);
			}

			$menu_name = isset( $payload['menu_name'] ) && '' !== trim( (string) $payload['menu_name'] )
				? sanitize_text_field( (string) $payload['menu_name'] )
				: 'Main Menu';

			$menu_id = wp_create_nav_menu( $menu_name );
			if ( is_wp_error( $menu_id ) ) {
				return new \WP_Error( 'uich_menu_create_failed', $menu_id->get_error_message() );
			}

			$pages_added = array();

			// Front page first.
			$front_page_id = (int) get_option( 'page_on_front' );
			if ( $front_page_id && 'page' === get_option( 'show_on_front' ) ) {
				wp_update_nav_menu_item(
					$menu_id,
					0,
					array(
						'menu-item-title'     => get_the_title( $front_page_id ),
						'menu-item-object'    => 'page',
						'menu-item-object-id' => $front_page_id,
						'menu-item-type'      => 'post_type',
						'menu-item-status'    => 'publish',
					)
				);
				$pages_added[] = get_the_title( $front_page_id );
			} else {
				// No static front page — add a plain Home link.
				wp_update_nav_menu_item(
					$menu_id,
					0,
					array(
						'menu-item-title'  => 'Home',
						'menu-item-type'   => 'custom',
						'menu-item-url'    => home_url( '/' ),
						'menu-item-status' => 'publish',
					)
				);
				$pages_added[] = 'Home';
			}

			// Add up to 4 more top-level published pages (menu_order ASC).
			$extra_pages = get_posts(
				array(
					'post_type'      => 'page',
					'post_status'    => 'publish',
					'post_parent'    => 0,
					'posts_per_page' => 4,
					'orderby'        => 'menu_order',
					'order'          => 'ASC',
					// phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_post__not_in -- Bounded single-item exclusion (front page) in an admin/editor query.
					'post__not_in'   => $front_page_id ? array( $front_page_id ) : array(),
					'no_found_rows'  => true,
				)
			);
			foreach ( $extra_pages as $page ) {
				wp_update_nav_menu_item(
					$menu_id,
					0,
					array(
						'menu-item-title'     => $page->post_title,
						'menu-item-object'    => 'page',
						'menu-item-object-id' => $page->ID,
						'menu-item-type'      => 'post_type',
						'menu-item-status'    => 'publish',
					)
				);
				$pages_added[] = $page->post_title;
			}

			// Assign to all unoccupied registered menu locations.
			$registered_locations = get_registered_nav_menus();
			$current_locations    = get_nav_menu_locations();
			$assigned_to          = array();

			foreach ( $registered_locations as $location_slug => $location_label ) {
				if ( empty( $current_locations[ $location_slug ] ) ) {
					$current_locations[ $location_slug ] = $menu_id;
					$assigned_to[] = $location_label;
				}
			}

			if ( ! empty( $assigned_to ) ) {
				set_theme_mod( 'nav_menu_locations', $current_locations );
			}

			return array(
				'created'     => true,
				'menu_id'     => (int) $menu_id,
				'menu_name'   => $menu_name,
				'pages_added' => $pages_added,
				'assigned_to' => $assigned_to,
				'message'     => sprintf(
					'Navigation menu "%s" created with %d item(s) and assigned to %d location(s). The <uichemy-nav-menu> tag will now render these items in the header.',
					$menu_name,
					count( $pages_added ),
					count( $assigned_to )
				),
			);
		}

		// ── Site branding helpers ─────────────────────────────────────────────

		/**
		 * MCP — set site logo and/or site icon from image URLs.
		 * Sideloads each URL into the media library (reuses existing upload if already present)
		 * and sets the corresponding WordPress option/theme_mod.
		 *
		 * Skips an item when it is already set unless `force` = true.
		 *
		 * @param array $payload { logo_url?: string, icon_url?: string, force?: bool }
		 * @return array|\WP_Error
		 */
		public static function mcp_set_site_branding( $payload = array() ) {
			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$logo_url    = isset( $payload['logo_url'] ) ? trim( (string) $payload['logo_url'] ) : '';
			$logo_width  = isset( $payload['logo_width'] ) ? absint( $payload['logo_width'] ) : 0;
			$logo_height = isset( $payload['logo_height'] ) ? absint( $payload['logo_height'] ) : 0;
			$icon_url    = isset( $payload['icon_url'] ) ? trim( (string) $payload['icon_url'] ) : '';
			$force       = ! empty( $payload['force'] );

			if ( '' === $logo_url && '' === $icon_url ) {
				return new \WP_Error( 'uich_branding_no_input', 'At least one of logo_url or icon_url must be provided.' );
			}

			$result = array(
				'logo' => null,
				'icon' => null,
			);

			// ── Logo ──────────────────────────────────────────────────────────
			if ( '' !== $logo_url ) {
				$current_logo_id = absint( get_theme_mod( 'custom_logo', 0 ) );
				if ( $current_logo_id && ! $force ) {
					$result['logo'] = array(
						'set'     => false,
						'skipped' => true,
						'reason'  => 'Custom logo already set (attachment_id: ' . $current_logo_id . '). Pass force=true to replace.',
						'current_url' => (string) wp_get_attachment_url( $current_logo_id ),
					);
				} else {
					$uploaded_url = self::mcp_sideload_image_from_url( $logo_url );
					if ( is_wp_error( $uploaded_url ) ) {
						$result['logo'] = array(
							'set'   => false,
							'error' => $uploaded_url->get_error_message(),
							'url'   => $logo_url,
						);
					} else {
						$attachment_id = self::mcp_find_attachment_id_by_url( $uploaded_url, $logo_url );
						if ( $attachment_id ) {
							set_theme_mod( 'custom_logo', $attachment_id );
							// Design-intended display size, from the AI-detected logo node
							// (plugin export). Read by the site-logo widget render — also
							// the only way an SVG logo gets a width/height at all, since
							// WordPress core can't read intrinsic SVG dimensions.
							if ( $logo_width && $logo_height ) {
								update_post_meta( $attachment_id, '_uich_logo_width', $logo_width );
								update_post_meta( $attachment_id, '_uich_logo_height', $logo_height );
							}
							$result['logo'] = array(
								'set'           => true,
								'attachment_id' => $attachment_id,
								'url'           => $uploaded_url,
							);
						} else {
							$result['logo'] = array(
								'set'   => false,
								'error' => 'Image uploaded but attachment ID could not be resolved.',
								'url'   => $uploaded_url,
							);
						}
					}
				}
			}

			// ── Site icon ─────────────────────────────────────────────────────
			if ( '' !== $icon_url ) {
				$current_icon_id = absint( get_option( 'site_icon', 0 ) );
				// The option can outlive the attachment. A dangling ID is not a site
				// icon, so fall through and set a real one rather than refusing.
				if ( $current_icon_id && ! get_post( $current_icon_id ) ) {
					$current_icon_id = 0;
				}
				if ( $current_icon_id && ! $force ) {
					$result['icon'] = array(
						'set'     => false,
						'skipped' => true,
						'reason'  => 'Site icon already set (attachment_id: ' . $current_icon_id . '). Pass force=true to replace.',
						'current_url' => get_site_icon_url( 192 ),
					);
				} else {
					$uploaded_url = self::mcp_sideload_image_from_url( $icon_url );
					if ( is_wp_error( $uploaded_url ) ) {
						$result['icon'] = array(
							'set'   => false,
							'error' => $uploaded_url->get_error_message(),
							'url'   => $icon_url,
						);
					} else {
						$attachment_id = self::mcp_find_attachment_id_by_url( $uploaded_url, $icon_url );
						if ( $attachment_id ) {
							update_option( 'site_icon', $attachment_id );
							$result['icon'] = array(
								'set'           => true,
								'attachment_id' => $attachment_id,
								'url'           => $uploaded_url,
							);
						} else {
							$result['icon'] = array(
								'set'   => false,
								'error' => 'Image uploaded but attachment ID could not be resolved.',
								'url'   => $uploaded_url,
							);
						}
					}
				}
			}

			// Build summary message.
			$logo_ok = isset( $result['logo']['set'] ) && $result['logo']['set'];
			$icon_ok = isset( $result['icon']['set'] ) && $result['icon']['set'];
			$parts   = array();
			if ( null !== $result['logo'] ) {
				$parts[] = 'logo: ' . ( $logo_ok ? '✅ set' : ( isset( $result['logo']['skipped'] ) ? 'skipped (already exists)' : '❌ failed' ) );
			}
			if ( null !== $result['icon'] ) {
				$parts[] = 'icon: ' . ( $icon_ok ? '✅ set' : ( isset( $result['icon']['skipped'] ) ? 'skipped (already exists)' : '❌ failed' ) );
			}
			$result['message'] = 'Site branding: ' . implode( ', ', $parts ) . '.';

			return $result;
		}

		/**
		 * Resolve attachment ID from an uploaded URL + original source URL.
		 * Tries WordPress built-in lookup first, falls back to source meta query.
		 *
		 * @param string $uploaded_url URL returned by media_sideload_image / sideload helper.
		 * @param string $source_url   Original source URL before sideloading.
		 * @return int Attachment ID, or 0 if not found.
		 */
		private static function mcp_find_attachment_id_by_url( $uploaded_url, $source_url ) {
			// Primary: WordPress core lookup.
			$id = attachment_url_to_postid( $uploaded_url );
			if ( $id ) {
				return $id;
			}
			// Fallback: source URL meta recorded during sideload.
			$id = self::mcp_find_existing_attachment_by_source_url( $source_url );
			if ( $id ) {
				return $id;
			}
			// Last resort: query by the uploaded URL as source.
			return self::mcp_find_existing_attachment_by_source_url( $uploaded_url );
		}

		// ── Header/footer template helpers ────────────────────────────────────

		/**
		 * Deactivate ALL existing active header or footer templates across both
		 * Elementor Pro (elementor_library) and Nexter (nxt_builder) systems.
		 * Called automatically before creating a new template of the same type.
		 *
		 * @param string $type 'header' or 'footer'.
		 * @return array List of deactivated template descriptors { system, post_id, title }.
		 */
		/**
		 * MCP — create a single post theme builder template with a Composer widget.
		 *
		 * Priority chain:
		 *  1. Elementor Pro  → elementor_library "single" template, conditions: singular/{post_type}
		 *  2. Nexter         → nxt_builder "singular" template, active immediately
		 *  3. Neither        → returns system=none; caller should fall back to create_uichemy_composer_page
		 *
		 * Always returns published_posts_count so the caller knows whether to prompt for a sample post.
		 *
		 * @param array $payload Tool payload.
		 * @return array|\WP_Error
		 */
		public static function mcp_create_single_post_template( $payload ) {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return new \WP_Error( 'uich_elementor_missing', 'Elementor is not active.' );
			}

			if ( ! is_array( $payload ) ) {
				$payload = array();
			}

			$post_type = isset( $payload['post_type'] ) ? sanitize_key( (string) $payload['post_type'] ) : 'post';
			if ( '' === $post_type ) {
				$post_type = 'post';
			}

			$title         = isset( $payload['title'] ) ? sanitize_text_field( (string) $payload['title'] ) : 'Single Post UiChemy';
			$label         = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : 'Single Post';
			$source        = isset( $payload['source'] ) ? sanitize_text_field( (string) $payload['source'] ) : 'mcp';
			$raw_html      = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$raw_css       = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$raw_js        = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$site_css      = isset( $payload['site_css'] ) ? (string) $payload['site_css'] : '';
			$site_js       = isset( $payload['site_js'] ) ? (string) $payload['site_js'] : '';
			$upload_images = isset( $payload['upload_images'] ) ? (bool) $payload['upload_images'] : true;

			// Sample post parameters.
			$create_sample_post  = isset( $payload['create_sample_post'] ) ? (bool) $payload['create_sample_post'] : false;
			$sample_post_title   = isset( $payload['sample_post_title'] ) ? sanitize_text_field( (string) $payload['sample_post_title'] ) : '';
			$sample_post_content = isset( $payload['sample_post_content'] ) ? wp_kses_post( (string) $payload['sample_post_content'] ) : '';

			// When true, deactivate existing active single-post templates before creating the new one.
			// When false (default), return existing templates so the caller can ask the user first.
			$force_deactivate = isset( $payload['force_deactivate'] ) ? (bool) $payload['force_deactivate'] : false;

			// Always return published post count so AI can decide to prompt for sample creation.
			$post_counts           = wp_count_posts( $post_type );
			$published_posts_count = isset( $post_counts->publish ) ? (int) $post_counts->publish : 0;

			$has_elementor_pro = class_exists( '\ElementorPro\Plugin' ) || defined( 'ELEMENTOR_PRO_VERSION' );
			$has_nexter        = post_type_exists( 'nxt_builder' );

			// No theme builder available — caller should use create_uichemy_composer_page.
			if ( ! $has_elementor_pro && ! $has_nexter ) {
				return array(
					'system'                => 'none',
					'published_posts_count' => $published_posts_count,
					'message'               => 'Neither Elementor Pro nor Nexter Extension is active. Use create_uichemy_composer_page to build a regular page instead.',
				);
			}

			// Check for existing active single-post templates BEFORE doing any work.
			// If found and force_deactivate is false, return them so the caller can ask the user.
			$existing_active = self::mcp_detect_active_single_post_templates( $post_type );
			if ( ! empty( $existing_active ) && ! $force_deactivate ) {
				return array(
					'status'                  => 'existing_templates_found',
					'system'                  => 'none',
					'existing_active_templates' => $existing_active,
					'published_posts_count'   => $published_posts_count,
					'message'                 => 'Active single post template(s) already exist. Ask the user: "An active single post template already exists (' . implode( ', ', array_column( $existing_active, 'title' ) ) . '). Should I replace it with the new design?" If yes, call this tool again with force_deactivate=true.',
				);
			}

			if ( '' === trim( $raw_html ) && '' === trim( $raw_css ) && '' === trim( $raw_js ) ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least one of html, css, or js must be provided.' );
			}

			// Upload images.
			if ( $upload_images ) {
				$html_media_result = self::mcp_upload_html_images_to_media_library( $raw_html, $raw_css );
				$raw_html          = $html_media_result['html'];
				if ( isset( $html_media_result['css'] ) ) {
					$raw_css = (string) $html_media_result['css'];
				}
			} else {
				$html_media_result = array( 'html' => $raw_html, 'uploaded' => array(), 'failed' => array() );
			}

			// Run global matching (colors → vars, typography → .text-{id}) server-side.
			$globals_prepared = self::mcp_prepare_import_html_css_with_globals( $raw_html, $raw_css );
			$raw_html         = $globals_prepared['html'];
			$raw_css          = $globals_prepared['css'];

			// Persist site-level CSS/JS.
			self::mcp_append_site_custom_code( $site_css, $site_js );

			// Build Elementor widget/container structure.
			$widget_id    = strtolower( wp_generate_password( 7, false, false ) );
			$container_id = strtolower( wp_generate_password( 7, false, false ) );

			$widget_settings = array(
				'raw_html' => self::build_mcp_tagged_code_block( 'html', $raw_html, $source, $label ),
				'raw_css'  => self::build_mcp_tagged_code_block( 'css', $raw_css, $source, $label ),
				'raw_js'   => self::build_mcp_tagged_code_block( 'js', $raw_js, $source, $label ),
			);

			$elements = array(
				array(
					'id'       => $container_id,
					'elType'   => 'container',
					'isInner'  => false,
					'settings' => self::mcp_widget_container_default_settings(),
					'elements' => array(
						array(
							'id'         => $widget_id,
							'elType'     => 'widget',
							'widgetType' => 'uichemy-composer',
							'settings'   => $widget_settings,
							'elements'   => array(),
						),
					),
				),
			);

			// Deactivate existing active single-post templates across both systems.
			$deactivated = self::mcp_deactivate_existing_single_post_templates( $post_type );

			// Create sample post if requested and approved.
			$sample_post_result = null;
			if ( $create_sample_post && '' !== $sample_post_title ) {
				$fallback_content   = '<p>This is a sample post created by UiChemy to preview the single post template.</p>';
				$sample_post_id     = wp_insert_post( array(
					'post_title'   => $sample_post_title,
					'post_content' => '' !== $sample_post_content ? $sample_post_content : $fallback_content,
					'post_status'  => 'publish',
					'post_type'    => $post_type,
				) );
				if ( ! is_wp_error( $sample_post_id ) && $sample_post_id ) {
					$sample_post_result = array(
						'post_id'   => (int) $sample_post_id,
						'title'     => $sample_post_title,
						'permalink' => get_permalink( $sample_post_id ),
					);
					$published_posts_count++;
				}
			}

			// Resolve a preview URL (sample post first, then first existing post).
			$preview_url = '';
			if ( $sample_post_result ) {
				$preview_url = $sample_post_result['permalink'];
			} elseif ( $published_posts_count > 0 ) {
				$first_posts = get_posts( array(
					'numberposts' => 1,
					'post_type'   => $post_type,
					'post_status' => 'publish',
					'fields'      => 'ids',
					'orderby'     => 'date',
					'order'       => 'DESC',
				) );
				if ( ! empty( $first_posts ) ) {
					$preview_url = (string) get_permalink( (int) $first_posts[0] );
				}
			}

			// ── Priority 1: Elementor Pro ──────────────────────────────────────
			if ( $has_elementor_pro ) {
				$ep_post_id = 0;
				$document   = null;

				if ( isset( \Elementor\Plugin::$instance->documents )
					&& method_exists( \Elementor\Plugin::$instance->documents, 'create' )
				) {
					try {
						$document = \Elementor\Plugin::$instance->documents->create(
							'single',
							array(
								'post_title'  => $title,
								'post_status' => 'publish',
							)
						);
						if ( is_wp_error( $document ) || ! $document ) {
							$document = null;
						} else {
							$ep_post_id = $document->get_main_id();
						}
					} catch ( \Throwable $e ) {
						$document = null;
					}
				}

				// Fallback: plain wp_insert_post.
				if ( ! $ep_post_id ) {
					$ep_post_id = wp_insert_post( array(
						'post_title'  => $title,
						'post_type'   => 'elementor_library',
						'post_status' => 'publish',
					) );
					if ( is_wp_error( $ep_post_id ) || ! $ep_post_id ) {
						return new \WP_Error( 'uich_template_create_failed', 'Failed to create Elementor Pro single post template.' );
					}
					update_post_meta( $ep_post_id, '_elementor_document_type', 'single' );
				}

				update_post_meta( $ep_post_id, '_elementor_template_type', 'single' );
				self::apply_dynamic_tag_bindings( $elements ); // opt-in: {{ tokens }} → bound dynamic tags
				update_post_meta( $ep_post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
				update_post_meta( $ep_post_id, '_elementor_edit_mode', 'builder' );
				update_post_meta( $ep_post_id, '_elementor_page_settings', array() );

				wp_set_object_terms( $ep_post_id, 'single', 'elementor_library_type' );

				if ( 'publish' !== get_post_status( $ep_post_id ) ) {
					wp_update_post( array( 'ID' => $ep_post_id, 'post_status' => 'publish' ) );
				}

				// Activate conditions: target all posts of the given post type.
				$condition_str  = 'include/singular/' . $post_type;
				$conditions_set = false;
				if ( class_exists( '\ElementorPro\Modules\ThemeBuilder\Module' ) ) {
					try {
						$cm = \ElementorPro\Modules\ThemeBuilder\Module::instance()->get_conditions_manager();
						if ( $cm && method_exists( $cm, 'save_conditions' ) ) {
							$cm->save_conditions( $ep_post_id, array( $condition_str ) );
							$conditions_set = true;
						}
					} catch ( \Throwable $e ) {
						// Fall through to raw fallback.
					}
				}

				if ( ! $conditions_set ) {
					update_post_meta( $ep_post_id, '_elementor_conditions', array( $condition_str ) );
					foreach ( array( 'elementor_pro_theme_builder_conditions', '_elementor_pro_conditions_index' ) as $_k ) {
						delete_option( $_k );
						wp_cache_delete( $_k, 'options' );
					}
					if ( class_exists( '\ElementorPro\Modules\ThemeBuilder\Module' ) ) {
						try {
							\ElementorPro\Modules\ThemeBuilder\Module::instance()
								->get_conditions_manager()
								->get_cache()
								->regenerate();
						} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement
						}
					}
				}

				if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
					\Elementor\Plugin::$instance->files_manager->clear_cache();
				}

				return array(
					'post_id'                 => $ep_post_id,
					'system'                  => 'elementor_pro',
					'type'                    => 'single',
					'target_post_type'        => $post_type,
					'active'                  => true,
					'conditions_api_used'     => $conditions_set,
					'title'                   => get_the_title( $ep_post_id ),
					'published_posts_count'   => $published_posts_count,
					'sample_post'             => $sample_post_result,
					'elementor_link'          => add_query_arg( array( 'post' => $ep_post_id, 'action' => 'elementor' ), admin_url( 'post.php' ) ),
					'theme_builder_link'      => admin_url( 'edit.php?post_type=elementor_library&tabs_group=theme' ),
					'preview_link'            => $preview_url,
					'deactivated_templates'   => $deactivated,
					'image_uploads'           => $html_media_result['uploaded'],
					'image_failures'          => $html_media_result['failed'],
					'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
					'message'                 => 'Single post template created via Elementor Pro and is ACTIVE for all "' . $post_type . '" posts.',
				);
			}

			// ── Priority 2: Nexter Extension ──────────────────────────────────
			$nxt_post_id = wp_insert_post( array(
				'post_title'  => $title,
				'post_type'   => 'nxt_builder',
				'post_status' => 'publish',
			) );

			if ( is_wp_error( $nxt_post_id ) || ! $nxt_post_id ) {
				return new \WP_Error( 'uich_template_create_failed', 'Failed to create nxt_builder singular post template.' );
			}

			// nxt-hooks-layout-sections = 'singular' tells Nexter this is a singular page template.
			update_post_meta( $nxt_post_id, 'nxt-hooks-layout-sections', 'singular' );

			// Condition group: include all posts of the target post type.
			update_post_meta( $nxt_post_id, 'nxt-singular-group', array(
				array(
					'nxt-singular-include-exclude'  => 'include',
					'nxt-singular-conditional-rule' => $post_type,
					'nxt-singular-conditional-type' => array( 'all' ),
				),
			) );

			update_post_meta( $nxt_post_id, 'nxt_build_status', '1' );
			self::apply_dynamic_tag_bindings( $elements ); // opt-in: {{ tokens }} → bound dynamic tags
			update_post_meta( $nxt_post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
			update_post_meta( $nxt_post_id, '_elementor_edit_mode', 'builder' );

			if ( 'publish' !== get_post_status( $nxt_post_id ) ) {
				wp_update_post( array( 'ID' => $nxt_post_id, 'post_status' => 'publish' ) );
			}

			// Bust Nexter's singular condition cache so the new template is picked up immediately.
			delete_option( 'nxt-build-cache-singular' );
			wp_cache_delete( 'nxt-build-cache-singular', 'options' );

			if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			return array(
				'post_id'                 => $nxt_post_id,
				'system'                  => 'nexter',
				'type'                    => 'singular',
				'target_post_type'        => $post_type,
				'active'                  => true,
				'title'                   => get_the_title( $nxt_post_id ),
				'published_posts_count'   => $published_posts_count,
				'sample_post'             => $sample_post_result,
				'elementor_link'          => add_query_arg( array( 'post' => $nxt_post_id, 'action' => 'elementor' ), admin_url( 'post.php' ) ),
				'builder_link'            => admin_url( 'edit.php?post_type=nxt_builder' ),
				'preview_link'            => $preview_url,
				'deactivated_templates'   => $deactivated,
				'image_uploads'           => $html_media_result['uploaded'],
				'image_failures'          => $html_media_result['failed'],
				'dynamic_globals_matches' => $globals_prepared['dynamic_globals'],
				'message'                 => 'Single post template created via Nexter Theme Builder and is ACTIVE for all "' . $post_type . '" posts.',
			);
		}

		/**
		 * Detect all currently active single-post templates across Elementor Pro and Nexter.
		 * Returns descriptors without making any changes.
		 *
		 * @param string $post_type Target post type slug.
		 * @return array Active template descriptors { system, post_id, title }.
		 */
		private static function mcp_detect_active_single_post_templates( $post_type ) {
			$active = array();

			// Elementor Pro: elementor_library posts of type 'single' with non-empty conditions.
			$ep_posts = get_posts( array(
				'post_type'      => 'elementor_library',
				'post_status'    => 'publish',
				'posts_per_page' => 10,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
				'meta_query'     => array(
					array( 'key' => '_elementor_template_type', 'value' => 'single' ),
				),
			) );
			foreach ( $ep_posts as $pid ) {
				$conditions = get_post_meta( (int) $pid, '_elementor_conditions', true );
				if ( ! empty( $conditions ) && is_array( $conditions ) ) {
					$active[] = array(
						'system'  => 'elementor_pro',
						'post_id' => (int) $pid,
						'title'   => get_the_title( (int) $pid ),
					);
				}
			}

			// Nexter: nxt_builder posts for 'singular' with build status active.
			if ( post_type_exists( 'nxt_builder' ) ) {
				$nxt_posts = get_posts( array(
					'post_type'      => 'nxt_builder',
					'post_status'    => 'publish',
					'posts_per_page' => 10,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
					'meta_query'     => array(
						'relation' => 'AND',
						array( 'key' => 'nxt-hooks-layout-sections', 'value' => 'singular' ),
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

			return $active;
		}

		/**
		 * Deactivate all currently active single-post templates across both Elementor Pro
		 * and Nexter so only the newly created template is active.
		 *
		 * @param string $post_type Target post type slug (used to scope Elementor Pro lookup).
		 * @return array Descriptors of deactivated templates.
		 */
		private static function mcp_deactivate_existing_single_post_templates( $post_type ) {
			$deactivated   = array();
			$ep_had_active = false;

			// ── Elementor Pro / elementor_library ─────────────────────────────
			$ep_posts = get_posts( array(
				'post_type'      => 'elementor_library',
				'post_status'    => 'publish',
				'posts_per_page' => 10,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
				'meta_query'     => array(
					array( 'key' => '_elementor_template_type', 'value' => 'single' ),
				),
			) );

			foreach ( $ep_posts as $pid ) {
				$pid        = (int) $pid;
				$conditions = get_post_meta( $pid, '_elementor_conditions', true );
				if ( empty( $conditions ) || ! is_array( $conditions ) ) {
					continue;
				}

				$api_deactivated = false;
				if ( class_exists( '\ElementorPro\Modules\ThemeBuilder\Module' ) ) {
					try {
						$cm = \ElementorPro\Modules\ThemeBuilder\Module::instance()->get_conditions_manager();
						if ( $cm && method_exists( $cm, 'save_conditions' ) ) {
							$cm->save_conditions( $pid, array() );
							$api_deactivated = true;
						}
					} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement
					}
				}
				if ( ! $api_deactivated ) {
					update_post_meta( $pid, '_elementor_conditions', array() );
				}

				$ep_had_active = true;
				$deactivated[] = array(
					'system'  => 'elementor_pro',
					'post_id' => $pid,
					'title'   => get_the_title( $pid ),
				);
			}

			// ── Nexter Extension ──────────────────────────────────────────────
			if ( post_type_exists( 'nxt_builder' ) ) {
				$nxt_posts = get_posts( array(
					'post_type'      => 'nxt_builder',
					'post_status'    => 'publish',
					'posts_per_page' => 10,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
					'meta_query'     => array(
						'relation' => 'AND',
						array( 'key' => 'nxt-hooks-layout-sections', 'value' => 'singular' ),
						array( 'key' => 'nxt_build_status', 'value'   => '1' ),
					),
				) );
				foreach ( $nxt_posts as $pid ) {
					update_post_meta( (int) $pid, 'nxt_build_status', '0' );
					$deactivated[] = array(
						'system'  => 'nexter',
						'post_id' => (int) $pid,
						'title'   => get_the_title( (int) $pid ),
					);
				}
			}

			if ( empty( $deactivated ) ) {
				return $deactivated;
			}

			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			if ( $ep_had_active ) {
				if ( class_exists( '\ElementorPro\Modules\ThemeBuilder\Module' ) ) {
					try {
						\ElementorPro\Modules\ThemeBuilder\Module::instance()
							->get_conditions_manager()
							->get_cache()
							->regenerate();
					} catch ( \Throwable $e ) { // phpcs:ignore Generic.CodeAnalysis.EmptyStatement
					}
				}
				foreach ( array( 'elementor_pro_theme_builder_conditions', '_elementor_pro_conditions_index' ) as $_k ) {
					delete_option( $_k );
					wp_cache_delete( $_k, 'options' );
				}
			}

			return $deactivated;
		}

		private static function mcp_deactivate_existing_header_footer_templates( $type ) {
			$deactivated      = array();
			$ep_had_active    = false;

			// ── Elementor Pro / elementor_library templates ────────────────────
			$ep_posts = get_posts(
				array(
					'post_type'      => 'elementor_library',
					'post_status'    => 'publish',
					'posts_per_page' => 20,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
					'meta_query'     => array(
						array( 'key' => '_elementor_template_type', 'value' => $type ),
					),
				)
			);

			foreach ( $ep_posts as $pid ) {
				$pid        = (int) $pid;
				$conditions = get_post_meta( $pid, '_elementor_conditions', true );

				if ( empty( $conditions ) || ! is_array( $conditions ) ) {
					continue; // already inactive.
				}

				// Prefer Elementor Pro's own save_conditions() so it handles
				// its internal cache automatically.
				$api_deactivated = false;
				if ( class_exists( '\ElementorPro\Modules\ThemeBuilder\Module' ) ) {
					try {
						$cm = \ElementorPro\Modules\ThemeBuilder\Module::instance()->get_conditions_manager();
						if ( $cm && method_exists( $cm, 'save_conditions' ) ) {
							$cm->save_conditions( $pid, array() );
							$api_deactivated = true;
						}
					} catch ( \Throwable $e ) {
						// Fall through to raw meta update below.
					}
				}

				if ( ! $api_deactivated ) {
					// Fallback: direct meta clear.
					update_post_meta( $pid, '_elementor_conditions', array() );
				}

				$ep_had_active = true;
				$deactivated[] = array(
					'system'  => 'elementor_pro',
					'post_id' => $pid,
					'title'   => get_the_title( $pid ),
				);
			}

			// ── Nexter Extension templates ─────────────────────────────────────
			if ( post_type_exists( 'nxt_builder' ) ) {
				$nxt_posts = get_posts(
					array(
						'post_type'      => 'nxt_builder',
						'post_status'    => 'publish',
						'posts_per_page' => 20,
						'fields'         => 'ids',
						'no_found_rows'  => true,
						// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
						'meta_query'     => array(
							'relation' => 'AND',
							array( 'key' => 'nxt-hooks-layout-sections', 'value' => $type ),
							array( 'key' => 'nxt_build_status', 'value'   => '1' ),
						),
					)
				);
				foreach ( $nxt_posts as $pid ) {
					update_post_meta( (int) $pid, 'nxt_build_status', '0' );
					$deactivated[] = array(
						'system'  => 'nexter',
						'post_id' => (int) $pid,
						'title'   => get_the_title( (int) $pid ),
					);
				}
			}

			if ( empty( $deactivated ) ) {
				return $deactivated;
			}

			// ── Flush all caches ───────────────────────────────────────────────

			// 1. Elementor files cache (CSS/JS regeneration).
			if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}

			// 2. Elementor Pro conditions cache — two strategies.
			if ( $ep_had_active ) {
				// Strategy A: call regenerate() via the conditions manager API.
				if ( class_exists( '\ElementorPro\Modules\ThemeBuilder\Module' ) ) {
					try {
						\ElementorPro\Modules\ThemeBuilder\Module::instance()
							->get_conditions_manager()
							->get_cache()
							->regenerate();
					} catch ( \Throwable $e ) {
						// Swallow — strategy B below will cover it.
					}
				}

				// Strategy B: hard-delete known compiled conditions option keys
				// so Elementor Pro rebuilds them fresh on the next request.
				// These keys cover all known Elementor Pro versions.
				$ep_cache_keys = array(
					'elementor_pro_theme_builder_conditions',
					'_elementor_pro_conditions_index',
				);
				foreach ( $ep_cache_keys as $opt_key ) {
					delete_option( $opt_key );
				}
				// Also clear any object cache copy.
				wp_cache_delete( 'elementor_pro_theme_builder_conditions', 'options' );
				wp_cache_delete( '_elementor_pro_conditions_index', 'options' );
			}

			return $deactivated;
		}

		// ── Admin bar shortcuts ────────────────────────────────────────────────

		/**
		 * Add "Edit Header" / "Edit Footer" shortcuts to the WordPress admin bar.
		 *
		 * Shows links for:
		 *  - Elementor Pro active templates (elementor_library with _elementor_conditions set)
		 *  - Nexter active templates (nxt_builder with nxt_build_status = 1)
		 *
		 * Only fires on the front-end for users with edit_posts capability.
		 *
		 * @param \WP_Admin_Bar $wp_admin_bar Admin bar instance.
		 * @return void
		 */
		public function add_header_footer_edit_links( $wp_admin_bar ) {
			if ( is_admin() ) {
				return;
			}

			if ( ! current_user_can( 'edit_posts' ) ) {
				return;
			}

			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return;
			}

			$type_labels = array(
				'header' => __( 'Edit Header', 'uichemy' ),
				'footer' => __( 'Edit Footer', 'uichemy' ),
			);

			foreach ( $type_labels as $type => $label ) {
				$posts = array(); // [ ['post_id' => int, 'title' => string] ]

				// 1. Elementor Pro active templates for this type.
				$ep_posts = get_posts(
					array(
						'post_type'      => 'elementor_library',
						'post_status'    => 'publish',
						'posts_per_page' => 5,
						'fields'         => 'ids',
						'no_found_rows'  => true,
						'orderby'        => 'ID',
						'order'          => 'DESC',
						// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
						'meta_query'     => array(
							array( 'key' => '_elementor_template_type', 'value' => $type ),
						),
					)
				);
				foreach ( $ep_posts as $pid ) {
					$conditions = get_post_meta( (int) $pid, '_elementor_conditions', true );
					if ( ! empty( $conditions ) && is_array( $conditions ) ) {
						$posts[] = array( 'post_id' => (int) $pid, 'title' => get_the_title( (int) $pid ) );
					}
				}

				// 2. Nexter active templates for this type.
				if ( post_type_exists( 'nxt_builder' ) ) {
					$nxt_posts = get_posts(
						array(
							'post_type'      => 'nxt_builder',
							'post_status'    => 'publish',
							'posts_per_page' => 5,
							'fields'         => 'ids',
							'no_found_rows'  => true,
							'orderby'        => 'ID',
							'order'          => 'DESC',
							// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Meta-based query required for template/widget matching; runs in admin/editor context on a small dataset.
							'meta_query'     => array(
								'relation' => 'AND',
								array( 'key' => 'nxt-hooks-layout-sections', 'value' => $type ),
								array( 'key' => 'nxt_build_status', 'value'   => '1' ),
							),
						)
					);
					foreach ( $nxt_posts as $pid ) {
						$posts[] = array( 'post_id' => (int) $pid, 'title' => get_the_title( (int) $pid ) );
					}
				}

				if ( empty( $posts ) ) {
					continue;
				}

				$node_id    = 'uichemy-edit-' . $type;
				$icon_html  = '<span class="ab-icon dashicons dashicons-edit" style="font-size:16px;vertical-align:middle;margin-right:4px;"></span>';

				if ( 1 === count( $posts ) ) {
					$post_id  = $posts[0]['post_id'];
					$edit_url = add_query_arg(
						array( 'post' => $post_id, 'action' => 'elementor' ),
						admin_url( 'post.php' )
					);
					$wp_admin_bar->add_node(
						array(
							'id'    => $node_id,
							'title' => $icon_html . esc_html( $label ),
							'href'  => esc_url( $edit_url ),
							'meta'  => array( 'target' => '_blank' ),
						)
					);
				} else {
					$wp_admin_bar->add_node(
						array(
							'id'    => $node_id,
							'title' => $icon_html . esc_html( $label ),
							'href'  => '#',
						)
					);
					foreach ( $posts as $entry ) {
						$post_id  = $entry['post_id'];
						$edit_url = add_query_arg(
							array( 'post' => $post_id, 'action' => 'elementor' ),
							admin_url( 'post.php' )
						);
						$wp_admin_bar->add_node(
							array(
								'parent' => $node_id,
								'id'     => $node_id . '-' . $post_id,
								'title'  => esc_html( $entry['title'] ),
								'href'   => esc_url( $edit_url ),
								'meta'   => array( 'target' => '_blank' ),
							)
						);
					}
				}
			}
		}

		/**
		 * Gutenberg counterpart to mcp_get_section_code() — reads a UiChemy
		 * Composer block's raw_html/raw_css/raw_js directly from post_content
		 * (parse_blocks()), keyed by the block's `uid` attribute rather than
		 * Elementor's `_elementor_data`/widget_index/data-id. No image upload
		 * or globals-matching step — this backs only the frontend live-editor
		 * bridge's read side.
		 *
		 * @param int    $post_id Post id.
		 * @param string $uid     Composer block's `uid` attribute.
		 * @return array|\WP_Error
		 */
		public static function mcp_get_gutenberg_section_code( $post_id, $uid ) {
			$post_id = absint( $post_id );
			$uid     = sanitize_text_field( (string) $uid );
			if ( ! $post_id || '' === $uid ) {
				return new \WP_Error( 'uich_invalid_args', 'post_id and uid are required.' );
			}

			$post = get_post( $post_id );
			if ( ! $post ) {
				return new \WP_Error( 'uich_post_not_found', 'Post not found.' );
			}

			$blocks = parse_blocks( (string) $post->post_content );
			$block  = self::find_gutenberg_composer_block_by_uid( $blocks, $uid );
			if ( ! $block ) {
				return new \WP_Error( 'uich_widget_not_found', 'No UiChemy Composer block found with that uid.' );
			}

			$settings = isset( $block['attrs']['settings'] ) && is_array( $block['attrs']['settings'] ) ? $block['attrs']['settings'] : array();

			return array(
				'widget_id' => $uid,
				'label'     => isset( $settings['_title'] ) ? (string) $settings['_title'] : '',
				'html'      => isset( $settings['raw_html'] ) ? (string) $settings['raw_html'] : '',
				'css'       => isset( $settings['raw_css'] ) ? (string) $settings['raw_css'] : '',
				'js'        => isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '',
			);
		}

		/**
		 * Bricks counterpart to mcp_get_gutenberg_section_code(). Bricks stores each
		 * content area as a FLAT array of element arrays under its own post meta key,
		 * and the composer element's code lives in a JSON blob at
		 * settings['uichemy_settings']. The element's uid is its Bricks element id
		 * (the renderer sanitizes it into the `uichemy-composer-<uid>` scope class).
		 *
		 * @param int    $post_id Post id.
		 * @param string $uid     Composer element id / uid.
		 * @return array|\WP_Error { widget_id, label, html, css, js } or error.
		 */
		public static function mcp_get_bricks_section_code( $post_id, $uid ) {
			$post_id = absint( $post_id );
			$uid     = sanitize_text_field( (string) $uid );
			if ( ! $post_id || '' === $uid ) {
				return new \WP_Error( 'uich_invalid_args', 'post_id and uid are required.' );
			}

			$element = self::find_bricks_composer_element_by_uid( $post_id, $uid );
			if ( ! is_array( $element ) ) {
				return new \WP_Error( 'uich_widget_not_found', 'No UiChemy Composer element found with that uid.' );
			}

			$raw      = isset( $element['settings']['uichemy_settings'] ) ? (string) $element['settings']['uichemy_settings'] : '{}';
			$settings = json_decode( $raw, true );
			if ( ! is_array( $settings ) ) {
				$settings = array();
			}

			return array(
				'widget_id' => $uid,
				'label'     => isset( $settings['_title'] ) ? (string) $settings['_title'] : '',
				'html'      => isset( $settings['raw_html'] ) ? (string) $settings['raw_html'] : '',
				'css'       => isset( $settings['raw_css'] ) ? (string) $settings['raw_css'] : '',
				'js'        => isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '',
			);
		}

		/**
		 * Append a NEW UiChemy Composer block to a Gutenberg post from the front end.
		 * The block is server-rendered (render_callback reads attrs.uid + attrs.settings),
		 * so a self-closing block with those attrs is all that is needed. Mirrors the
		 * Elementor inserter's globals + image passes. wp_update_post() unslashes, so
		 * the serialized blocks are wp_slash()'d — same reason as the setter.
		 *
		 * @param int   $post_id Post id.
		 * @param array $payload { html?, css?, js?, label? }.
		 * @return array|\WP_Error
		 */
		public static function mcp_insert_gutenberg_section( $post_id, array $payload ) {
			$post_id = absint( $post_id );
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}
			$post = get_post( $post_id );
			if ( ! $post ) {
				return new \WP_Error( 'uich_post_not_found', 'Post not found.' );
			}

			$html  = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$css   = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$js    = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$label = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : 'New Section';

			if ( '' !== trim( $html ) && method_exists( __CLASS__, 'mcp_upload_html_images_to_media_library' ) ) {
				$media = self::mcp_upload_html_images_to_media_library( $html, $css );
				$html  = $media['html'];
				if ( isset( $media['css'] ) ) {
					$css = (string) $media['css'];
				}
			}
			if ( method_exists( __CLASS__, 'mcp_prepare_import_html_css_with_globals' ) ) {
				$globals = self::mcp_prepare_import_html_css_with_globals( $html, $css );
				$html    = $globals['html'];
				$css     = $globals['css'];
			}

			$uid    = strtolower( wp_generate_password( 7, false, false ) );
			$blocks = parse_blocks( (string) $post->post_content );
			$blocks[] = array(
				'blockName'    => 'uichemy/composer',
				'attrs'        => array(
					'uid'      => $uid,
					'settings' => array(
						'_title'   => $label,
						'raw_html' => $html,
						'raw_css'  => $css,
						'raw_js'   => $js,
					),
				),
				'innerBlocks'  => array(),
				'innerHTML'    => '',
				'innerContent' => array(),
			);

			$result = wp_update_post(
				array(
					'ID'           => $post_id,
					'post_content' => wp_slash( serialize_blocks( $blocks ) ),
				),
				true
			);
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return array(
				'post_id'   => $post_id,
				'widget_id' => $uid,
				'label'     => $label,
				'message'   => "Section \"{$label}\" added to page {$post_id}.",
			);
		}

		/**
		 * Append a NEW UiChemy Composer element to a Bricks page body from the front
		 * end. Bricks stores each content area as a FLAT element array; a top-level
		 * element has parent 0. Stored via update_post_meta (a PHP array), which
		 * unslashes the whole value, so wp_slash() the array — same trap the Bricks
		 * setter documents.
		 *
		 * @param int   $post_id Post id.
		 * @param array $payload { html?, css?, js?, label? }.
		 * @return array|\WP_Error
		 */
		public static function mcp_insert_bricks_section( $post_id, array $payload ) {
			$post_id = absint( $post_id );
			if ( ! $post_id ) {
				return new \WP_Error( 'uich_invalid_post_id', 'Invalid post_id.' );
			}

			$html  = isset( $payload['html'] ) ? (string) $payload['html'] : '';
			$css   = isset( $payload['css'] ) ? (string) $payload['css'] : '';
			$js    = isset( $payload['js'] ) ? (string) $payload['js'] : '';
			$label = isset( $payload['label'] ) ? sanitize_text_field( (string) $payload['label'] ) : 'New Section';

			if ( '' !== trim( $html ) && method_exists( __CLASS__, 'mcp_upload_html_images_to_media_library' ) ) {
				$media = self::mcp_upload_html_images_to_media_library( $html, $css );
				$html  = $media['html'];
				if ( isset( $media['css'] ) ) {
					$css = (string) $media['css'];
				}
			}
			if ( method_exists( __CLASS__, 'mcp_prepare_import_html_css_with_globals' ) ) {
				$globals = self::mcp_prepare_import_html_css_with_globals( $html, $css );
				$html    = $globals['html'];
				$css     = $globals['css'];
			}

			$key      = '_bricks_page_content_2';
			$elements = get_post_meta( $post_id, $key, true );
			if ( ! is_array( $elements ) ) {
				$elements = array();
			}

			$uid      = strtolower( wp_generate_password( 6, false, false ) );
			$settings = wp_json_encode(
				array(
					'_title'   => $label,
					'raw_html' => $html,
					'raw_css'  => $css,
					'raw_js'   => $js,
				),
				JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
			);

			$elements[] = array(
				'id'       => $uid,
				'name'     => 'uichemy-composer',
				'parent'   => 0,
				'children' => array(),
				'settings' => array( 'uichemy_settings' => $settings ),
			);

			update_post_meta( $post_id, $key, wp_slash( $elements ) );

			return array(
				'post_id'   => $post_id,
				'widget_id' => $uid,
				'label'     => $label,
				'message'   => "Section \"{$label}\" added to Bricks page {$post_id}.",
			);
		}

		/**
		 * Locate a UiChemy Composer Bricks element by uid across a post's Bricks
		 * content areas (body / header / footer). Match is on the element id
		 * (sanitized the same way the renderer does) AND the element name.
		 *
		 * @param int    $post_id Post id.
		 * @param string $uid     Element id / uid.
		 * @return array|null The matching element array, or null.
		 */
		private static function find_bricks_composer_element_by_uid( $post_id, $uid ) {
			$keys = array( '_bricks_page_content_2', '_bricks_page_header_2', '_bricks_page_footer_2' );
			foreach ( $keys as $key ) {
				$elements = get_post_meta( $post_id, $key, true );
				if ( ! is_array( $elements ) ) {
					continue;
				}
				foreach ( $elements as $el ) {
					if ( ! is_array( $el ) || ! isset( $el['id'], $el['name'] ) ) {
						continue;
					}
					if ( 'uichemy-composer' === $el['name'] && sanitize_html_class( (string) $el['id'] ) === $uid ) {
						return $el;
					}
				}
			}
			return null;
		}

		/**
		 * Bricks counterpart to mcp_set_gutenberg_section_code() — merges html/css/js
		 * into the matching element's settings['uichemy_settings'] JSON blob and
		 * persists the content area's flat element array. Unlike the Gutenberg path
		 * (which round-trips through wp_update_post/wp_unslash), this stores a PHP
		 * array via update_post_meta, so NO wp_slash() is applied.
		 *
		 * @param int    $post_id Post id.
		 * @param string $uid     Composer element id / uid.
		 * @param array  $payload { html?, css?, js? } — at least one required.
		 * @return array|\WP_Error
		 */
		public static function mcp_set_bricks_section_code( $post_id, $uid, array $payload ) {
			$post_id = absint( $post_id );
			$uid     = sanitize_text_field( (string) $uid );
			if ( ! $post_id || '' === $uid ) {
				return new \WP_Error( 'uich_invalid_args', 'post_id and uid are required.' );
			}

			$html = isset( $payload['html'] ) ? (string) $payload['html'] : null;
			$css  = isset( $payload['css'] ) ? (string) $payload['css'] : null;
			$js   = isset( $payload['js'] ) ? (string) $payload['js'] : null;
			if ( null === $html && null === $css && null === $js ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least one of html, css, or js must be provided.' );
			}

			$keys  = array( '_bricks_page_content_2', '_bricks_page_header_2', '_bricks_page_footer_2' );
			$found = false;
			foreach ( $keys as $key ) {
				$elements = get_post_meta( $post_id, $key, true );
				if ( ! is_array( $elements ) ) {
					continue;
				}
				if ( self::update_bricks_composer_element_by_uid( $elements, $uid, $payload ) ) {
					// update_post_meta() → update_metadata() runs wp_unslash() over the
					// WHOLE value. We read $elements UNslashed from get_post_meta(), so
					// without re-slashing, that unslash strips backslashes from every
					// string in EVERY element on the page (CSS escapes, JS, JSON quotes),
					// corrupting the entire Bricks content and blanking the page. wp_slash
					// the array so the unslash returns it intact — same reason the
					// Gutenberg path wp_slash()es before wp_update_post().
					update_post_meta( $post_id, $key, wp_slash( $elements ) );
					$found = true;
					break;
				}
			}
			if ( ! $found ) {
				return new \WP_Error( 'uich_widget_not_found', 'No UiChemy Composer element found with that uid.' );
			}

			return self::mcp_get_bricks_section_code( $post_id, $uid );
		}

		/**
		 * In-place merge of html/css/js into a Bricks composer element's
		 * settings['uichemy_settings'] JSON blob, matched by uid (= element id).
		 *
		 * @param array  $elements Flat Bricks element array (by reference).
		 * @param string $uid      Element id / uid.
		 * @param array  $payload  { html?, css?, js? }.
		 * @return bool True if the element was found and updated.
		 */
		private static function update_bricks_composer_element_by_uid( array &$elements, $uid, array $payload ) {
			foreach ( $elements as &$el ) {
				if ( ! is_array( $el ) || ! isset( $el['id'], $el['name'] ) ) {
					continue;
				}
				if ( 'uichemy-composer' !== $el['name'] || sanitize_html_class( (string) $el['id'] ) !== $uid ) {
					continue;
				}
				if ( ! isset( $el['settings'] ) || ! is_array( $el['settings'] ) ) {
					$el['settings'] = array();
				}
				$raw      = isset( $el['settings']['uichemy_settings'] ) ? (string) $el['settings']['uichemy_settings'] : '{}';
				$settings = json_decode( $raw, true );
				if ( ! is_array( $settings ) ) {
					$settings = array();
				}
				if ( isset( $payload['html'] ) ) {
					$settings['raw_html'] = (string) $payload['html'];
				}
				if ( isset( $payload['css'] ) ) {
					$settings['raw_css'] = (string) $payload['css'];
				}
				if ( isset( $payload['js'] ) ) {
					$settings['raw_js'] = (string) $payload['js'];
				}
				$el['settings']['uichemy_settings'] = wp_json_encode( $settings, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
				unset( $el );
				return true;
			}
			unset( $el );
			return false;
		}

		/**
		 * Gutenberg counterpart to mcp_sync_generated_code_to_widget() — writes
		 * html/css/js back onto the matching block's `settings` attribute and
		 * re-serializes post_content. wp_update_post() unconditionally runs
		 * wp_unslash() on its input, so the serialized blocks must be wp_slash()'d
		 * first or literal characters like `<` get corrupted (`<`).
		 *
		 * @param int    $post_id Post id.
		 * @param string $uid     Composer block's `uid` attribute.
		 * @param array  $payload { html?, css?, js? } — at least one required.
		 * @return array|\WP_Error
		 */
		public static function mcp_set_gutenberg_section_code( $post_id, $uid, array $payload ) {
			$post_id = absint( $post_id );
			$uid     = sanitize_text_field( (string) $uid );
			if ( ! $post_id || '' === $uid ) {
				return new \WP_Error( 'uich_invalid_args', 'post_id and uid are required.' );
			}

			$html = isset( $payload['html'] ) ? (string) $payload['html'] : null;
			$css  = isset( $payload['css'] ) ? (string) $payload['css'] : null;
			$js   = isset( $payload['js'] ) ? (string) $payload['js'] : null;
			if ( null === $html && null === $css && null === $js ) {
				return new \WP_Error( 'uich_empty_generated_code', 'At least one of html, css, or js must be provided.' );
			}

			$post = get_post( $post_id );
			if ( ! $post ) {
				return new \WP_Error( 'uich_post_not_found', 'Post not found.' );
			}

			$blocks = parse_blocks( (string) $post->post_content );
			$found  = self::update_gutenberg_composer_block_by_uid( $blocks, $uid, $payload );
			if ( ! $found ) {
				return new \WP_Error( 'uich_widget_not_found', 'No UiChemy Composer block found with that uid.' );
			}

			$result = wp_update_post(
				array(
					'ID'           => $post_id,
					'post_content' => wp_slash( serialize_blocks( $blocks ) ),
				),
				true
			);
			if ( is_wp_error( $result ) ) {
				return $result;
			}

			return self::mcp_get_gutenberg_section_code( $post_id, $uid );
		}

		/**
		 * Depth-first search for the UiChemy Composer block whose `uid` attr matches.
		 *
		 * @param array  $blocks parse_blocks() tree.
		 * @param string $uid    Target uid.
		 * @return array|null Matching block (by reference semantics not needed — read-only).
		 */
		private static function find_gutenberg_composer_block_by_uid( array $blocks, $uid ) {
			foreach ( $blocks as $block ) {
				if ( isset( $block['blockName'] ) && 'uichemy/composer' === $block['blockName']
					&& isset( $block['attrs']['uid'] ) && (string) $block['attrs']['uid'] === (string) $uid
				) {
					return $block;
				}
				if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
					$found = self::find_gutenberg_composer_block_by_uid( $block['innerBlocks'], $uid );
					if ( $found ) {
						return $found;
					}
				}
			}
			return null;
		}

		/**
		 * Depth-first, in-place update of the UiChemy Composer block whose `uid`
		 * attr matches — merges html/css/js into its `settings` attribute.
		 *
		 * @param array  $blocks  parse_blocks() tree (by reference).
		 * @param string $uid     Target uid.
		 * @param array  $payload { html?, css?, js? }.
		 * @return bool True if a matching block was found and updated.
		 */
		private static function update_gutenberg_composer_block_by_uid( array &$blocks, $uid, array $payload ) {
			foreach ( $blocks as &$block ) {
				if ( isset( $block['blockName'] ) && 'uichemy/composer' === $block['blockName']
					&& isset( $block['attrs']['uid'] ) && (string) $block['attrs']['uid'] === (string) $uid
				) {
					if ( ! isset( $block['attrs']['settings'] ) || ! is_array( $block['attrs']['settings'] ) ) {
						$block['attrs']['settings'] = array();
					}
					if ( isset( $payload['html'] ) ) {
						$block['attrs']['settings']['raw_html'] = (string) $payload['html'];
					}
					if ( isset( $payload['css'] ) ) {
						$block['attrs']['settings']['raw_css'] = (string) $payload['css'];
					}
					if ( isset( $payload['js'] ) ) {
						$block['attrs']['settings']['raw_js'] = (string) $payload['js'];
					}
					unset( $block );
					return true;
				}
				if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
					if ( self::update_gutenberg_composer_block_by_uid( $block['innerBlocks'], $uid, $payload ) ) {
						unset( $block );
						return true;
					}
				}
			}
			unset( $block );
			return false;
		}
	}

	new UiChemy_Composer_Manager();
}