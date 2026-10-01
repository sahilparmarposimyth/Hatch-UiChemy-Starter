<?php
/**
 * Custom Code block — security wiring.
 *
 * Three-layer defense:
 *   1. Authoring capability — only `unfiltered_html` users can save raw code.
 *      Lower-privileged users get the markup silently stripped from post_content.
 *   2. Execution mode — block has 3 modes (inline / shadow / iframe). Inline is
 *      the default and most restrictive — JS is dropped in this mode.
 *   3. Read-time sanitization — when the REST API serves content for a user
 *      WITHOUT `unfiltered_html`, custom-code blocks are stripped from the
 *      response.
 *
 * Astro frontend receives only what the WP user is allowed to see.
 *
 * @package HatchBlocks
 */

defined( 'ABSPATH' ) || exit;

/**
 * Hatch_Blocks_Custom_Code_Security
 */
class Hatch_Blocks_Custom_Code_Security {

	const BLOCK_NAME = 'hatch/custom-code';

	/**
	 * @var Hatch_Blocks_Custom_Code_Security|null
	 */
	private static $instance = null;

	/**
	 * Singleton accessor.
	 *
	 * @return Hatch_Blocks_Custom_Code_Security
	 */
	public static function instance(): Hatch_Blocks_Custom_Code_Security {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Wire filters.
	 */
	private function __construct() {
		// Strip on save by lower-privileged users.
		add_filter( 'wp_insert_post_data', array( $this, 'strip_for_save_if_no_cap' ), 10, 2 );

		// Strip on REST output for non-capable readers.
		add_filter( 'rest_prepare_post', array( $this, 'strip_for_rest_if_no_cap' ), 10, 3 );
		add_filter( 'rest_prepare_page', array( $this, 'strip_for_rest_if_no_cap' ), 10, 3 );

		// Strip on Hatch content filter for non-capable readers.
		add_filter( 'hatch/content/html', array( $this, 'filter_hatch_content_html' ), 10, 2 );
	}

	/**
	 * Strip custom-code blocks in Hatch /content REST endpoint for non-capable readers.
	 *
	 * @param string      $raw_html Raw or semi-rendered HTML content.
	 * @param WP_Post|null $post     Post object if available.
	 * @return string
	 */
	public function filter_hatch_content_html( $raw_html, $post = null ) {
		unset( $post );
		if ( ! is_string( $raw_html ) || '' === $raw_html ) {
			return $raw_html;
		}
		if ( current_user_can( 'unfiltered_html' ) ) {
			return $raw_html;
		}
		$stripped = self::strip_custom_code_blocks( $raw_html );
		return self::strip_rendered_custom_code( $stripped );
	}

	/**
	 * On save: if the user does NOT have unfiltered_html, remove all hatch/custom-code blocks.
	 *
	 * @param array $data    Post data (sanitized).
	 * @param array $postarr Original POST data.
	 * @return array
	 */
	public function strip_for_save_if_no_cap( array $data, array $postarr ): array {
		unset( $postarr );
		if ( current_user_can( 'unfiltered_html' ) ) {
			return $data;
		}
		if ( ! isset( $data['post_content'] ) || '' === $data['post_content'] ) {
			return $data;
		}
		$data['post_content'] = self::strip_custom_code_blocks( (string) $data['post_content'] );
		return $data;
	}

	/**
	 * On REST output: strip custom-code blocks from rendered HTML for non-capable users.
	 *
	 * @param WP_REST_Response $response Response.
	 * @param WP_Post          $post     Post.
	 * @param WP_REST_Request  $request  Request.
	 * @return WP_REST_Response
	 */
	public function strip_for_rest_if_no_cap( $response, $post, $request ) {
		unset( $post, $request );
		if ( ! ( $response instanceof WP_REST_Response ) ) {
			return $response;
		}
		if ( current_user_can( 'unfiltered_html' ) ) {
			return $response;
		}
		$data = $response->get_data();
		if ( isset( $data['content']['rendered'] ) && is_string( $data['content']['rendered'] ) ) {
			$data['content']['rendered'] = self::strip_rendered_custom_code( $data['content']['rendered'] );
		}
		if ( isset( $data['content']['raw'] ) && is_string( $data['content']['raw'] ) ) {
			$data['content']['raw'] = self::strip_custom_code_blocks( $data['content']['raw'] );
		}
		$response->set_data( $data );
		return $response;
	}

	/**
	 * Strip <!-- wp:hatch/custom-code ... --> ... <!-- /wp:hatch/custom-code --> sections.
	 *
	 * @param string $content Block markup.
	 * @return string
	 */
	public static function strip_custom_code_blocks( string $content ): string {
		if ( false === strpos( $content, 'wp:' . self::BLOCK_NAME ) ) {
			return $content;
		}
		// H-6: use the real block parser — a regex over block comments can be
		// defeated by a '>' (or '-->') inside a JSON attribute string.
		if ( function_exists( 'parse_blocks' ) && function_exists( 'serialize_blocks' ) ) {
			return serialize_blocks( self::remove_custom_code_from_blocks( parse_blocks( $content ) ) );
		}
		$pattern = '/<!--\s*wp:hatch\/custom-code(?:\s+.*?)?(?:\/-->|-->.*?<!--\s*\/wp:hatch\/custom-code\s*-->)/s';
		return (string) preg_replace( $pattern, '', $content );
	}

	/**
	 * Strip rendered output of custom-code blocks (wrappers with our marker class).
	 *
	 * @param string $html Rendered HTML.
	 * @return string
	 */
	public static function strip_rendered_custom_code( string $html ): string {
		if ( false === strpos( $html, 'hatch-custom-code' ) ) {
			return $html;
		}
		// H-6: walk the markup and drop each wrapper together with everything up to
		// ITS OWN closing tag, counting nested tags of the same name — a lazy regex
		// stops at the first closing tag and leaves the rest of the payload behind.
		// Done on the raw string (no DOM round-trip) so surrounding markup is left
		// byte-for-byte untouched.
		$open_re = '/<(div|section|iframe)\b[^>]*\bclass\s*=\s*("[^"]*hatch-custom-code[^"]*"|\'[^\']*hatch-custom-code[^\']*\')[^>]*>/i';
		for ( $guard = 0; $guard < 200; $guard++ ) {
			if ( ! preg_match( $open_re, $html, $m, PREG_OFFSET_CAPTURE ) ) {
				break;
			}
			$start = $m[0][1];
			$tag   = strtolower( $m[1][0] );
			$pos   = $start + strlen( $m[0][0] );
			$depth = 1;
			$end   = strlen( $html ); // Unclosed wrapper: drop to end of input, fail closed.
			if ( preg_match_all( '/<(\/?)' . $tag . '\b[^>]*>/i', $html, $tags, PREG_OFFSET_CAPTURE | PREG_SET_ORDER, $pos ) ) {
				foreach ( $tags as $t ) {
					$depth += ( '' === $t[1][0] ) ? 1 : -1;
					if ( 0 === $depth ) {
						$end = $t[0][1] + strlen( $t[0][0] );
						break;
					}
				}
			}
			$html = substr( $html, 0, $start ) . substr( $html, $end );
		}
		return $html;
	}

	/**
	 * Allowed sandbox flags for iframe-mode custom code.
	 *
	 * @return string
	 */
	public static function iframe_sandbox(): string {
		return 'allow-scripts allow-forms allow-popups';
	}
	/**
	 * Recursively drop hatch/custom-code blocks from a parsed block tree.
	 *
	 * @param array $blocks Output of parse_blocks().
	 * @return array
	 */
	private static function remove_custom_code_from_blocks( array $blocks ): array {
		$out = array();
		foreach ( $blocks as $block ) {
			if ( isset( $block['blockName'] ) && self::BLOCK_NAME === $block['blockName'] ) {
				continue;
			}
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = self::remove_custom_code_from_blocks( $block['innerBlocks'] );
			}
			$out[] = $block;
		}
		return $out;
	}

	/**
	 * Strip custom-code markup (block comments and rendered wrappers) unless the
	 * current reader holds unfiltered_html. Single entry point for every
	 * Hatch/Protuno response path (H-6).
	 *
	 * @param string $content Block markup or rendered HTML.
	 * @return string
	 */
	public static function strip_for_current_reader( string $content ): string {
		if ( '' === $content || current_user_can( 'unfiltered_html' ) ) {
			return $content;
		}
		return self::strip_rendered_custom_code( self::strip_custom_code_blocks( $content ) );
	}
}
