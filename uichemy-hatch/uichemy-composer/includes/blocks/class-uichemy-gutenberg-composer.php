<?php
/**
 * UiChemy Composer Gutenberg block.
 *
 * Server-rendered (dynamic) block that mirrors the Elementor Composer/Composer
 * widget. It stores the Composer settings map (raw_html / raw_css / raw_js,
 * slots, custom code, deps) in a single `settings` object attribute and renders
 * through the shared UiChemy_Composer_Renderer so both builders produce
 * identical output. Dynamic data resolves through uichemy's Twig engine
 * (Uich_Dynamic), exactly as the Elementor widget does.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Gutenberg_Composer' ) ) {
	class UiChemy_Gutenberg_Composer {

		/**
		 * Block name (namespace/name).
		 */
		const BLOCK_NAME = 'uichemy/composer';

		/**
		 * Hook registration.
		 */
		public function __construct() {
			// One switch per builder (Settings). Skipping the registration is what
			// actually keeps the block out of the inserter — hiding it in the UI
			// alone would still load its editor assets.
			if ( uichemy_composer_enabled( 'gutenberg' ) ) {
				add_action( 'init', array( $this, 'register_block' ) );
			}
			add_filter( 'block_categories_all', array( $this, 'register_category' ), 10, 1 );
			// wpautop/wptexturize mis-parse inline <script>/<style> containing `<`
			// and re-encode `&`→`&#038;` inside them. Re-decode afterward. Classic
			// themes route through the_content; FSE's core/post-content block runs
			// those filters directly and bypasses the_content, so we also hook
			// render_block (which wraps the post-content output).
			add_filter( 'the_content', array( __CLASS__, 'fix_inline_code_entities' ), 100 );
			add_filter( 'render_block', array( __CLASS__, 'fix_rendered_inline_code' ), 100, 2 );
		}

		/**
		 * Repair inline code bodies in a rendered block's output (FSE path).
		 *
		 * @param string $block_content Rendered block HTML.
		 * @param array  $block         Block data.
		 * @return string
		 */
		public static function fix_rendered_inline_code( $block_content, $block = array() ) {
			if ( false === strpos( (string) $block_content, 'uichemy-composer-' ) || ! class_exists( 'UiChemy_Composer_Renderer' ) ) {
				return $block_content;
			}
			return UiChemy_Composer_Renderer::decode_inline_code_blocks( $block_content );
		}

		/**
		 * Repair inline <script>/<style> bodies of our block that content filters
		 * (wptexturize/wpautop) may have entity-encoded.
		 *
		 * @param string $content Post content.
		 * @return string
		 */
		public static function fix_inline_code_entities( $content ) {
			if ( false === strpos( (string) $content, 'uichemy-composer-' ) || ! class_exists( 'UiChemy_Composer_Renderer' ) ) {
				return $content;
			}
			return UiChemy_Composer_Renderer::decode_inline_code_blocks( $content );
		}

		/**
		 * Register the "UiChemy" block category (shared slug with the Elementor side).
		 *
		 * @param array $categories Existing block categories.
		 * @return array
		 */
		public function register_category( $categories ) {
			if ( ! is_array( $categories ) ) {
				return $categories;
			}

			foreach ( $categories as $category ) {
				if ( isset( $category['slug'] ) && 'uichemy' === $category['slug'] ) {
					return $categories;
				}
			}

			// White-label the category heading — parity with the Elementor widget's
			// register_widget_category(): use the configured widget_category when
			// white-labeling is on, else the default "UiChemy".
			// Pro-gated read — see uichemy_white_label_settings(). Reading the raw
			// option here left a downgraded site with its custom category heading.
			$wl    = function_exists( 'uich_brand_wl' ) ? uich_brand_wl() : array();
			$title = ( ! empty( $wl['widget_category'] ) )
				? sanitize_text_field( $wl['widget_category'] )
				: esc_html__( 'UiChemy', 'uichemy' );

			array_unshift(
				$categories,
				array(
					'slug'  => 'uichemy',
					'title' => esc_html( $title ),
					'icon'  => null,
				)
			);

			return $categories;
		}

		/**
		 * Register the dynamic block from its block.json metadata.
		 */
		public function register_block() {
			if ( ! function_exists( 'register_block_type' ) ) {
				return;
			}

			// Avoid double registration (e.g. if init fires twice in some setups).
			if ( class_exists( '\WP_Block_Type_Registry' ) && \WP_Block_Type_Registry::get_instance()->is_registered( self::BLOCK_NAME ) ) {
				return;
			}

			register_block_type(
				UICHEMY_PATH . 'assets/blocks/uichemy-composer',
				array(
					'render_callback' => array( $this, 'render' ),
				)
			);
		}

		/**
		 * Server render callback. Delegates to the shared renderer.
		 *
		 * @param array  $attributes Block attributes (expects `settings` map + `uid`).
		 * @param string $content    Inner content (unused — dynamic block).
		 * @param mixed  $block      Block instance.
		 * @return string
		 */
		public function render( $attributes, $content = '', $block = null ) {
			$attributes = is_array( $attributes ) ? $attributes : array();

			$settings = ( isset( $attributes['settings'] ) && is_array( $attributes['settings'] ) ) ? $attributes['settings'] : array();

			if ( empty( $settings['raw_html'] ) ) {
				// Nothing authored yet — render nothing on the front end.
				return '';
			}

			$uid = ( isset( $attributes['uid'] ) && '' !== (string) $attributes['uid'] )
				? sanitize_html_class( (string) $attributes['uid'] )
				: substr( md5( (string) wp_json_encode( $settings ) ), 0, 7 );

			if ( ! class_exists( 'UiChemy_Composer_Renderer' ) ) {
				require_once UICHEMY_PATH . 'includes/admin/widgets/class-uichemy-composer-renderer.php';
			}

			$scope_class = 'uichemy-composer-' . $uid;
			$scope       = '.' . $scope_class;

			// Render HTML + CSS inline, but DEFER the JS to wp_footer. An inline
			// <script> inside the_content is fragile on the front end: wpautop can
			// mangle multi-line JS, and JS optimizers frequently delay or skip
			// in-content inline scripts. Printing it in the footer runs it once,
			// after the full DOM, outside the_content's filters.
			$raw_js          = isset( $settings['raw_js'] ) ? (string) $settings['raw_js'] : '';
			$render_settings = $settings;
			unset( $render_settings['raw_js'] );

			// Dynamic data: run the Twig engine over the authored HTML so {{ values }},
			// {% for loops %} and {% if conditions %} resolve before slots / CSS
			// scoping run on the result — mirroring the Elementor widget exactly.
			$raw_html    = (string) $render_settings['raw_html'];
			$had_dynamic = class_exists( 'Uich_Dynamic' ) && Uich_Dynamic::has_dynamic( $raw_html );
			if ( $had_dynamic ) {
				$raw_html                    = Uich_Dynamic::render_html( $raw_html, array( 'widget_id' => $uid ) );
				$render_settings['raw_html'] = $raw_html;

				// Position-indexed slots (slot_0…slot_19) only line up with static
				// HTML. When Twig ran, loops/conditions change the node count, so
				// slots would clobber the rendered output — drop them entirely.
				foreach ( array_keys( $render_settings ) as $k ) {
					if ( 0 === strpos( $k, 'slot_' ) ) {
						unset( $render_settings[ $k ] );
					}
				}
			}

			// Move inline <script> tags out of the in-content HTML to the footer.
			// Content filters (wptexturize/wpautop) mis-parse inline scripts that
			// contain `<` (JS comparisons, template strings) and corrupt them
			// (`&&` → `&#038;&#038;`). The footer is outside all content filters.
			if ( ! empty( $render_settings['raw_html'] ) ) {
				$render_settings['raw_html'] = self::extract_inline_scripts_to_footer( (string) $render_settings['raw_html'] );
			}

			// Opt-in: full-page designs that style <body> or inject elements onto
			// <body> via JS (e.g. confetti) need the CSS emitted as-authored.
			$scope_css = empty( $settings['css_unscoped'] );

			$html = UiChemy_Composer_Renderer::render_html( $render_settings, $scope, $uid, false, $scope_css );

			if ( '' !== trim( $raw_js ) ) {
				self::queue_footer_js( $uid, $raw_js );
			}

			// `wp-block-uichemy-composer` is the marker the front-end picker looks for
			// (uichemy-frontend-bridge.js WIDGET_SELECTOR). For a DYNAMIC block
			// get_block_wrapper_attributes() does NOT add the auto `wp-block-<name>`
			// class the way a static save-side useBlockProps would, so emit it here or
			// the whole-page picker never sees Gutenberg composer instances.
			$marker_class       = 'wp-block-uichemy-composer ' . $scope_class;
			$wrapper_attributes = function_exists( 'get_block_wrapper_attributes' )
				? get_block_wrapper_attributes( array( 'class' => $marker_class ) )
				: 'class="' . esc_attr( $marker_class ) . '"';

			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			return '<div ' . $wrapper_attributes . '>' . $html . '</div>';
		}

		/**
		 * Queued per-block JS to print in the footer. Keyed by uid to dedupe when a
		 * block is rendered more than once in a request.
		 *
		 * @var array<string,string>
		 */
		private static $footer_js = array();

		/**
		 * Inline <script> tags lifted verbatim out of raw_html, printed in the footer.
		 *
		 * @var array<int,string>
		 */
		private static $footer_html = array();

		/** Whether the wp_footer printer has been registered. */
		private static $footer_hooked = false;

		/** Register the footer printer once. */
		private static function ensure_footer_hook() {
			if ( ! self::$footer_hooked ) {
				self::$footer_hooked = true;
				add_action( 'wp_footer', array( __CLASS__, 'print_footer_js' ), 99 );
			}
		}

		/**
		 * Strip inline <script> tags from raw_html and queue them (verbatim) for the
		 * footer. Returns the HTML without those scripts.
		 *
		 * @param string $html Raw HTML.
		 * @return string
		 */
		private static function extract_inline_scripts_to_footer( $html ) {
			return (string) preg_replace_callback(
				'#<script\b[^>]*>.*?</script>#is',
				function ( $m ) {
					self::$footer_html[] = $m[0];
					self::ensure_footer_hook();
					return '';
				},
				(string) $html
			);
		}

		/**
		 * Queue a block's JS for footer output (and register the printer once).
		 *
		 * @param string $uid    Block instance id.
		 * @param string $raw_js The JavaScript to run.
		 */
		private static function queue_footer_js( $uid, $raw_js ) {
			self::$footer_js[ $uid ] = $raw_js;
			self::ensure_footer_hook();
		}

		/**
		 * Print queued inline scripts + block JS in the footer (outside content filters).
		 */
		public static function print_footer_js() {
			// The design's own inline scripts (libraries, importmaps, module code),
			// lifted verbatim from raw_html so content filters never touched them.
			foreach ( self::$footer_html as $tag ) {
				if ( class_exists( 'UiChemy_Composer_Renderer' ) ) {
					$tag = UiChemy_Composer_Renderer::decode_inline_code_blocks( $tag );
				}
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
				echo "\n" . $tag . "\n";
			}
			self::$footer_html = array();

			foreach ( self::$footer_js as $uid => $raw_js ) {
				// Decode any HTML entities kses may have injected into the code
				// (e.g. `&&` → `&#038;&#038;`), then prevent a literal "</script>"
				// inside the JS from closing the tag early.
				if ( class_exists( 'UiChemy_Composer_Renderer' ) ) {
					$raw_js = UiChemy_Composer_Renderer::decode_code_entities( $raw_js );
				}
				$safe_js = preg_replace( '#</(script)#i', '<\\\\/$1', $raw_js );
				// data-cfasync="false" => skip Cloudflare Rocket Loader.
				// data-no-optimize / data-no-defer => skip common WP JS optimizers.
				echo "\n<script id=\"uichemy-composer-js-" . esc_attr( $uid ) . '" data-cfasync="false" data-no-optimize="1" data-no-defer="1" data-no-minify="1">';
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
				echo $safe_js;
				echo "</script>\n";
			}
			self::$footer_js = array();
		}
	}

	new UiChemy_Gutenberg_Composer();
}
