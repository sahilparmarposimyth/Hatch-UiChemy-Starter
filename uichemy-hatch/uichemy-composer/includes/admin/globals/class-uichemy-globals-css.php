<?php
/**
 * UiChemy Globals CSS — locate / extract / upsert / parse the #uichemy-globals
 * <style> block. PHP mirror of composer/src/composer-globals-css.jsx.
 *
 * The authoritative artifact is one `<style id="uichemy-globals">…</style>`
 * block inside the site-level `</head>` custom code
 * (UiChemy_Composer_Manager::SITE_CUSTOM_CODE_OPTION → 'head'). Variables are
 * grouped into COLLECTIONS by the section comment that precedes them in :root
 * (e.g. `/* Colors *&#47;`); that comment is the only classifier — there is no
 * value/name inference and no @-rules. Each value is a colour or a plain string.
 *
 * The UI parses the block in JS; on the server this class powers the block
 * locate/extract/upsert (used by Composer Manager) and a matching parse() for the
 * REST payload. The section rewriter uses its own regex over the same block.
 *
 * @package UiChemy
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

if ( ! class_exists( 'UiChemy_Globals_CSS' ) ) {

	/**
	 * Locate/parse/emit helpers for the #uichemy-globals style block.
	 */
	class UiChemy_Globals_CSS {

		/**
		 * The id attribute that marks our owned <style> block.
		 */
		const BLOCK_ID = 'uichemy-globals';

		/**
		 * Default collection for variables written with no section comment above them.
		 */
		const DEFAULT_COLLECTION = 'Variables';

		// ── Block location / extraction / upsert ───────────────────────────────

		/**
		 * Find the <style id="uichemy-globals">…</style> block inside head markup.
		 *
		 * @param string $head Full head markup.
		 * @return array|null { start, end, inner }
		 */
		public static function locate_block( $head ) {
			$head    = (string) $head;
			$pattern = '/<style\b[^>]*\bid\s*=\s*(["\'])' . preg_quote( self::BLOCK_ID, '/' ) . '\1[^>]*>(.*?)<\/style\s*>/is';
			if ( ! preg_match( $pattern, $head, $m, PREG_OFFSET_CAPTURE ) ) {
				return null;
			}
			$whole = $m[0][0];
			$start = $m[0][1];
			return array(
				'start' => $start,
				'end'   => $start + strlen( $whole ),
				'inner' => $m[2][0],
			);
		}

		/**
		 * Inner CSS of the block (trimmed), or '' when there is none.
		 *
		 * @param string $head Full head markup.
		 * @return string
		 */
		public static function extract_css( $head ) {
			$loc = self::locate_block( $head );
			return null === $loc ? '' : trim( $loc['inner'] );
		}

		/**
		 * Wrap inner CSS in the canonical block element.
		 *
		 * @param string $css Inner CSS.
		 * @return string
		 */
		public static function wrap( $css ) {
			return '<style id="' . self::BLOCK_ID . '">' . "\n" . trim( (string) $css ) . "\n" . '</style>';
		}

		/**
		 * Replace the block's inner CSS in place — or append the block once when it
		 * is absent — leaving all other head markup byte-identical.
		 *
		 * @param string $head Current head markup.
		 * @param string $css  New inner CSS for the block.
		 * @return string New head markup.
		 */
		public static function upsert_block( $head, $css ) {
			$head  = (string) $head;
			$block = self::wrap( $css );
			$loc   = self::locate_block( $head );

			if ( null === $loc ) {
				return '' === trim( $head ) ? $block : $head . "\n" . $block;
			}

			return substr( $head, 0, $loc['start'] ) . $block . substr( $head, $loc['end'] );
		}

		// ── Value helpers ──────────────────────────────────────────────────────

		/**
		 * Whether a value looks like a colour (picks colour picker vs text field).
		 *
		 * @param string $value Raw CSS value.
		 * @return bool
		 */
		public static function is_color_value( $value ) {
			$v = trim( (string) $value );
			if ( '' === $v ) {
				return false;
			}
			if ( preg_match( '/\bgradient\s*\(/i', $v ) ) {
				return true;
			}
			if ( preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i', $v ) ) {
				return true;
			}
			if ( preg_match( '/^(rgb|hsl)a?\s*\(/i', $v ) ) {
				return true;
			}
			return self::is_named_color( $v );
		}

		// ── Parsing ────────────────────────────────────────────────────────────

		/**
		 * Parse the block's inner CSS into { tokens, collections, classes, preserved }.
		 *
		 *   tokens      : array of { name, value, collection }
		 *   collections : ordered collection names (incl. empty headers)
		 *   classes     : array of { selector, kind, body }
		 *   preserved   : raw strings for @media / other at-rules & bare selectors
		 *
		 * @param string $css Inner CSS of the block.
		 * @return array
		 */
		public static function parse( $css ) {
			$css         = (string) $css;
			$tokens      = array();
			$collections = array();
			$classes     = array();
			$preserved   = array();
			$seen_name   = array();
			$seen_col    = array();

			$add_col = static function ( $name ) use ( &$collections, &$seen_col ) {
				if ( ! isset( $seen_col[ $name ] ) ) {
					$seen_col[ $name ] = true;
					$collections[]     = $name;
				}
			};

			foreach ( self::split_top_level( $css ) as $node ) {
				$sel = $node['selector'];

				if ( ':root' === $sel ) {
					$current = '';
					foreach ( self::scan_root_entries( $node['body'] ) as $entry ) {
						if ( 'header' === $entry['t'] ) {
							$current = $entry['name'];
							$add_col( $current );
							continue;
						}
						if ( '--' !== substr( $entry['prop'], 0, 2 ) || isset( $seen_name[ $entry['prop'] ] ) ) {
							continue;
						}
						$col = '' !== $current ? $current : self::DEFAULT_COLLECTION;
						if ( '' === $current ) {
							$add_col( self::DEFAULT_COLLECTION );
						}
						$seen_name[ $entry['prop'] ] = true;
						$tokens[]                    = array(
							'name'       => $entry['prop'],
							'value'      => $entry['value'],
							'collection' => $col,
						);
					}
					continue;
				}

				if ( '.' === substr( $sel, 0, 1 ) ) {
					$classes[] = self::raw_class( $sel, $node['body'] );
					continue;
				}

				if ( '' !== $sel ) {
					$preserved[] = $sel . " {\n" . trim( $node['body'] ) . "\n}"; // @media, keyframes, bare selectors.
				}
			}

			return array(
				'tokens'      => $tokens,
				'collections' => $collections,
				'classes'     => $classes,
				'preserved'   => $preserved,
			);
		}

		// ── Internal parsing helpers ───────────────────────────────────────────

		/**
		 * Top-level { selector, body } nodes — comment- and brace-aware.
		 *
		 * @param string $css CSS text.
		 * @return array<int,array>
		 */
		private static function split_top_level( $css ) {
			$nodes     = array();
			$len       = strlen( $css );
			$i         = 0;
			$sel_start = 0;

			while ( $i < $len ) {
				if ( '/' === $css[ $i ] && $i + 1 < $len && '*' === $css[ $i + 1 ] ) {
					$e   = strpos( $css, '*/', $i + 2 );
					$end = ( false === $e ) ? $len : $e + 2;
					// A comment that precedes a selector (only whitespace before it)
					// is not part of the selector. Drop it from the pending selector
					// so "/* note */\n:root { … }" parses as ":root", not
					// "/* note */ :root" (which failed the ':root' match, so the whole
					// token block — e.g. the migration's colour aliases — was skipped
					// and never showed in the Globals manager).
					if ( '' === trim( substr( $css, $sel_start, $i - $sel_start ) ) ) {
						$sel_start = $end;
					}
					$i = $end;
					continue;
				}
				if ( '{' === $css[ $i ] ) {
					$selector   = trim( substr( $css, $sel_start, $i - $sel_start ) );
					$body_start = $i + 1;
					$depth      = 1;
					$j          = $i + 1;
					while ( $j < $len && $depth > 0 ) {
						if ( '/' === $css[ $j ] && $j + 1 < $len && '*' === $css[ $j + 1 ] ) {
							$e = strpos( $css, '*/', $j + 2 );
							$j = ( false === $e ) ? $len : $e + 2;
							continue;
						}
						if ( '{' === $css[ $j ] ) {
							++$depth;
						} elseif ( '}' === $css[ $j ] ) {
							--$depth;
							if ( 0 === $depth ) {
								break;
							}
						}
						++$j;
					}
					$nodes[]   = array(
						'selector' => $selector,
						'body'     => substr( $css, $body_start, $j - $body_start ),
					);
					$i         = $j + 1;
					$sel_start = $i;
					continue;
				}
				++$i;
			}

			return $nodes;
		}

		/**
		 * Walk a :root body into ordered entries: section-header comments
		 * (collection names) and `--name: value;` declarations. A comment is a
		 * header only when preceded solely by whitespace; `@`-comments are ignored.
		 *
		 * @param string $body Rule body.
		 * @return array<int,array>
		 */
		private static function scan_root_entries( $body ) {
			$out = array();
			$len = strlen( $body );
			$i   = 0;
			$seg = 0;

			while ( $i <= $len ) {
				if ( $i < $len && '/' === $body[ $i ] && $i + 1 < $len && '*' === $body[ $i + 1 ] ) {
					$e   = strpos( $body, '*/', $i + 2 );
					$end = ( false === $e ) ? $len : $e + 2;
					if ( '' === trim( substr( $body, $seg, $i - $seg ) ) ) {
						$name = trim( ( false === $e ) ? substr( $body, $i + 2 ) : substr( $body, $i + 2, $e - ( $i + 2 ) ) );
						if ( '' !== $name && '@' !== $name[0] ) {
							$out[] = array(
								't'    => 'header',
								'name' => $name,
							);
						}
						$seg = $end;
					}
					$i = $end;
					continue;
				}
				if ( $i === $len || ';' === $body[ $i ] ) {
					$segment = substr( $body, $seg, $i - $seg );
					$colon   = strpos( $segment, ':' );
					if ( false !== $colon ) {
						$prop  = trim( substr( $segment, 0, $colon ) );
						$value = trim( preg_replace( '/\/\*.*?\*\//s', '', substr( $segment, $colon + 1 ) ) );
						if ( '' !== $prop ) {
							$out[] = array(
								't'     => 'decl',
								'prop'  => $prop,
								'value' => $value,
							);
						}
					}
					++$i;
					$seg = $i;
					continue;
				}
				++$i;
			}

			return $out;
		}

		/**
		 * A raw-preserved class node with a typography|component kind.
		 *
		 * @param string $selector Selector.
		 * @param string $body     Rule body.
		 * @return array
		 */
		private static function raw_class( $selector, $body ) {
			return array(
				'selector' => $selector,
				'kind'     => self::classify_class( $selector, $body ),
				'body'     => trim( $body ),
			);
		}

		/**
		 * Typography if the selector is `.text-*` OR the body sets a font/text rule.
		 *
		 * @param string $selector Selector.
		 * @param string $body     Body.
		 * @return string typography|component
		 */
		private static function classify_class( $selector, $body ) {
			if ( preg_match( '/^\.text-/i', $selector ) ) {
				return 'typography';
			}
			if ( preg_match( '/\bfont-size\b|\bfont-family\b|\bfont-weight\b|\bfont-style\b|\bfont\s*:|\bline-height\b|\bletter-spacing\b|\btext-transform\b/i', $body ) ) {
				return 'typography';
			}
			return 'component';
		}

		/**
		 * Whether a value is a CSS named colour we recognise.
		 *
		 * @param string $v Value.
		 * @return bool
		 */
		private static function is_named_color( $v ) {
			static $named = null;
			if ( null === $named ) {
				$named = array_flip(
					array(
						'transparent',
						'currentcolor',
						'black',
						'white',
						'red',
						'green',
						'blue',
						'yellow',
						'orange',
						'purple',
						'pink',
						'gray',
						'grey',
						'brown',
						'cyan',
						'magenta',
						'lime',
						'navy',
						'teal',
						'maroon',
						'olive',
						'silver',
						'gold',
						'beige',
						'coral',
						'crimson',
						'indigo',
						'ivory',
						'khaki',
						'lavender',
						'salmon',
						'tan',
						'turquoise',
						'violet',
						'aqua',
						'fuchsia',
					)
				);
			}
			return isset( $named[ strtolower( $v ) ] );
		}
	}
}
