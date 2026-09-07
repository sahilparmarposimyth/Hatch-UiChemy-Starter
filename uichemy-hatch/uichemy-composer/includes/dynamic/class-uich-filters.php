<?php
/**
 * Uich_Filters — the pipe ( | ) filter library for the dynamic-data engine.
 *
 * Mirrors the UnblockWP/Twig filter set: string, number, date, array, WordPress, WooCommerce,
 * plus a `raw` filter that opts a value out of auto-escaping. Register more via the
 * `uich_dynamic_filters` filter hook.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Filters' ) ) {
	class Uich_Filters {

		const RAW_PREFIX = "\0UICH_RAW\0";

		/** @var array<string,callable> */
		private static $registry = null;

		public static function apply( $name, $value, $args = array() ) {
			$reg = self::registry();
			if ( ! isset( $reg[ $name ] ) ) {
				return $value;
			}
			return call_user_func( $reg[ $name ], $value, $args );
		}

		public static function is_marked_raw( $v ) {
			return is_string( $v ) && 0 === strpos( $v, self::RAW_PREFIX );
		}
		public static function unmark_raw( $v ) {
			return substr( $v, strlen( self::RAW_PREFIX ) );
		}

		private static function registry() {
			if ( null !== self::$registry ) {
				return self::$registry;
			}

			$f = array();

			/* raw / escaping --------------------------------------------------- */
			$f['raw']      = function ( $v ) {
				return self::RAW_PREFIX . (string) $v;
			};
			$f['e']        = function ( $v ) {
				return esc_html( (string) $v );
			};
			$f['esc_attr'] = function ( $v ) {
				return esc_attr( (string) $v );
			};
			$f['esc_url']  = function ( $v ) {
				return esc_url( (string) $v );
			};

			/* string ----------------------------------------------------------- */
			$f['upper']      = function ( $v ) {
				return strtoupper( (string) $v );
			};
			$f['lower']      = function ( $v ) {
				return strtolower( (string) $v );
			};
			$f['capitalize'] = function ( $v ) {
				return ucfirst( strtolower( (string) $v ) );
			};
			$f['title']      = function ( $v ) {
				return ucwords( strtolower( (string) $v ) );
			};
			$f['trim']       = function ( $v ) {
				return trim( (string) $v );
			};
			$f['nl2br']      = function ( $v ) {
				return self::RAW_PREFIX . nl2br( esc_html( (string) $v ) );
			};
			$f['striptags']  = function ( $v ) {
				return wp_strip_all_tags( (string) $v );
			};
			$f['slug']       = function ( $v ) {
				return sanitize_title( (string) $v );
			};
			$f['truncate']   = function ( $v, $a ) {
				$len = isset( $a[0] ) ? (int) $a[0] : 100;
				$end = isset( $a[1] ) ? (string) $a[1] : '…';
				$s   = (string) $v;
				return ( mb_strlen( $s ) > $len ) ? mb_substr( $s, 0, $len ) . $end : $s;
			};
			$f['excerpt']    = function ( $v, $a ) {
				$words = isset( $a[0] ) ? (int) $a[0] : 25;
				return wp_trim_words( (string) $v, $words, '…' );
			};
			$f['replace']    = function ( $v, $a ) {
				return ( isset( $a[0], $a[1] ) ) ? str_replace( (string) $a[0], (string) $a[1], (string) $v ) : $v;
			};
			$f['split']      = function ( $v, $a ) {
				$d = isset( $a[0] ) ? (string) $a[0] : ',';
				return explode( $d, (string) $v );
			};
			$f['default']    = function ( $v, $a ) {
				$fallback = isset( $a[0] ) ? $a[0] : '';
				if ( null === $v || '' === $v || ( is_array( $v ) && empty( $v ) ) ) {
					return $fallback;
				}
				return $v;
			};
			$f['format']     = function ( $v, $a ) {
				$fmt = (string) $v;

				// The format string is template-authored, so a width or precision
				// like %1$999999999d would make vsprintf allocate a ~gigabyte string
				// — a memory-exhaustion DoS. Refuse any conversion spec whose width
				// or precision exceeds a sane cap; the format is emitted literally.
				if ( preg_match_all( '/%(?:\d+\$)?(?:[-+ 0#]|\'.)*(\d+)?(?:\.(\d+))?[bcdeEfFgGosuxX]/', $fmt, $specs, PREG_SET_ORDER ) ) {
					foreach ( $specs as $spec ) {
						$width = isset( $spec[1] ) && '' !== $spec[1] ? (int) $spec[1] : 0;
						$prec  = isset( $spec[2] ) && '' !== $spec[2] ? (int) $spec[2] : 0;
						if ( $width > 4096 || $prec > 4096 ) {
							return $fmt;
						}
					}
				}

				return vsprintf( $fmt, $a );
			};

			/* number ----------------------------------------------------------- */
			$f['number_format'] = function ( $v, $a ) {
				$dec = isset( $a[0] ) ? (int) $a[0] : 0;
				return number_format( (float) $v, $dec );
			};
			$f['abs']           = function ( $v ) {
				return abs( (float) $v );
			};
			$f['round']         = function ( $v, $a ) {
				$prec = isset( $a[0] ) ? (int) $a[0] : 0;
				return round( (float) $v, $prec );
			};

			/* date ------------------------------------------------------------- */
			$f['date']     = function ( $v, $a ) {
				$format = isset( $a[0] ) ? (string) $a[0] : get_option( 'date_format' );
				$ts     = is_numeric( $v ) ? (int) $v : strtotime( (string) $v );
				if ( 'now' === (string) $v ) {
					$ts = time();
				}
				return $ts ? wp_date( $format, $ts ) : '';
			};
			$f['time_ago'] = function ( $v ) {
				$ts = is_numeric( $v ) ? (int) $v : strtotime( (string) $v );
				return $ts ? human_time_diff( $ts, time() ) . ' ' . __( 'ago', 'uichemy' ) : '';
			};

			/* array ------------------------------------------------------------ */
			$f['first']   = function ( $v ) {
				return is_array( $v ) ? reset( $v ) : $v;
			};
			$f['last']    = function ( $v ) {
				return is_array( $v ) ? end( $v ) : $v;
			};
			$f['length']  = function ( $v ) {
				return is_array( $v ) ? count( $v ) : mb_strlen( (string) $v );
			};
			$f['keys']    = function ( $v ) {
				return is_array( $v ) ? array_keys( $v ) : array();
			};
			$f['reverse'] = function ( $v ) {
				return is_array( $v ) ? array_reverse( $v ) : strrev( (string) $v );
			};
			$f['join']    = function ( $v, $a ) {
				$glue = isset( $a[0] ) ? (string) $a[0] : ', ';
				if ( ! is_array( $v ) ) {
					return (string) $v;
				}
				$parts = array_map(
					function ( $item ) {
						if ( $item instanceof Uich_Provider ) {
								return (string) $item->uich_read( '__toString', array() ); // Gated read: `post.tags|join` prints nothing in Free.
						}
						return is_scalar( $item ) ? (string) $item : '';
					},
					$v
				);
				return implode( $glue, $parts );
			};
			$f['slice']   = function ( $v, $a ) {
				$offset = isset( $a[0] ) ? (int) $a[0] : 0;
				$len    = isset( $a[1] ) ? (int) $a[1] : null;
				return is_array( $v ) ? array_slice( $v, $offset, $len ) : mb_substr( (string) $v, $offset, $len );
			};
			// NOTE: the callable argument to map/filter/sort/find MUST be a Closure
			// (produced by a template arrow function, e.g. `x => x.title`). Accepting
			// a plain `is_callable()` value would let a template pass a PHP function
			// NAME as a string (`|map('system')`, `|map('file_get_contents')`), which
			// array_map()/call_user_func() would then execute — a template-injection
			// RCE / arbitrary-file-read. Restricting to \Closure blocks string
			// callables while preserving every legitimate arrow-function template.
			$f['map']    = function ( $v, $a ) {
				$fn = isset( $a[0] ) ? $a[0] : null;
				if ( ! is_array( $v ) || ! ( $fn instanceof \Closure ) ) {
					return $v;
				}
				return array_map( $fn, $v );
			};
			$f['filter'] = function ( $v, $a ) {
				$fn = isset( $a[0] ) ? $a[0] : null;
				if ( ! is_array( $v ) || ! ( $fn instanceof \Closure ) ) {
					return $v;
				}
				return array_values( array_filter( $v, $fn ) );
			};
			$f['sort']   = function ( $v, $a ) {
				if ( ! is_array( $v ) ) {
					return $v;
				}
				$fn = isset( $a[0] ) ? $a[0] : null;
				if ( $fn instanceof \Closure ) {
					usort(
						$v,
						function ( $x, $y ) use ( $fn ) {
							$xa = $fn( $x );
							$yb = $fn( $y );
							return $xa <=> $yb;
						}
					);
				} else {
					sort( $v );
				}
				return $v;
			};
			$f['find']   = function ( $v, $a ) {
				$fn = isset( $a[0] ) ? $a[0] : null;
				if ( is_array( $v ) && $fn instanceof \Closure ) {
					foreach ( $v as $item ) {
						if ( $fn( $item ) ) {
							return $item;
						}
					}
				}
				return null;
			};

			/* WordPress -------------------------------------------------------- */
			$f['wpautop']    = function ( $v ) {
				return self::RAW_PREFIX . wpautop( (string) $v );
			};
			$f['shortcodes'] = function ( $v ) {
				/**
				 * Whether the `shortcodes` filter may execute shortcodes at render
				 * time. On by default — this mirrors how WordPress runs do_shortcode()
				 * on ordinary post content, within the same author trust boundary — but
				 * a site that does not want template-authored shortcodes executed can
				 * turn it off, in which case the value is rendered (kses'd) but inert.
				 *
				 * @param bool $allow Default true.
				 */
				if ( ! apply_filters( 'uich_dynamic_allow_shortcodes', true ) ) {
					return self::RAW_PREFIX . wp_kses_post( (string) $v );
				}
				return self::RAW_PREFIX . do_shortcode( (string) $v );
			};
			$f['kses_post']  = function ( $v ) {
				return self::RAW_PREFIX . wp_kses_post( (string) $v );
			};

			/* WooCommerce ------------------------------------------------------ */
			$f['currency'] = function ( $v ) {
				if ( function_exists( 'wc_price' ) ) {
					return self::RAW_PREFIX . wc_price( (float) $v );
				}
				return number_format( (float) $v, 2 );
			};

			/* utility ---------------------------------------------------------- */
			$f['json_encode'] = function ( $v ) {
				return wp_json_encode( $v );
			};

			/**
			 * Allow extensions to register/override filters.
			 *
			 * @param array $f Map of name => callable( $value, array $args ).
			 */
			self::$registry = apply_filters( 'uich_dynamic_filters', $f );
			return self::$registry;
		}
	}
}
