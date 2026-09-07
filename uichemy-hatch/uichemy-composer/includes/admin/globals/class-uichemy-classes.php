<?php
/**
 * UiChemy Global Classes — reusable, site-wide CSS classes.
 *
 * Stores named classes (e.g. `pr-blog-card`) with a raw CSS block each in a
 * single option, and emits them as real stylesheet rules (`.pr-blog-card{…}`)
 * on the frontend and inside the Elementor editor preview. Apply the class to
 * any element anywhere; editing the class here updates every usage.
 *
 * CSS block supports plain declarations plus `&` nesting:
 *   color: red; padding: 12px;
 *   &:hover { color: blue; }
 *   & .child { margin: 0; }
 *
 *   @media (max-width: 767px) { padding: 6px; &:hover { color: green; } }
 *
 * @link       https://posimyth.com
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

if ( ! class_exists( 'UiChemy_Classes' ) ) {

	/**
	 * Global CSS classes: storage, sanitization, CSS emit and REST endpoints.
	 */
	class UiChemy_Classes {

		const OPTION       = 'uichemy_globals_class';
		const STYLE_HANDLE = 'uichemy-classes';
		const REST_NS      = 'uichemy/v1';

		/**
		 * Register hooks.
		 *
		 * @return void
		 */
		public static function init() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
			add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_css' ) );
			add_action( 'elementor/preview/enqueue_styles', array( __CLASS__, 'enqueue_css' ) );
		}

		/**
		 * Read the stored classes.
		 *
		 * @return array
		 */
		public static function get_classes() {
			$val = get_option( self::OPTION, array() );
			return is_array( $val ) ? $val : array();
		}

		/**
		 * Sanitize + persist classes.
		 *
		 * @param array $classes Raw list.
		 * @return array Sanitized list that was saved.
		 */
		public static function update_classes( $classes ) {
			$clean = self::sanitize_classes( $classes );
			update_option( self::OPTION, $clean, true );
			return $clean;
		}

		/**
		 * Sanitize a raw class list: valid CSS class names, safe CSS bodies.
		 *
		 * @param mixed $raw Raw input.
		 * @return array
		 */
		public static function sanitize_classes( $raw ) {
			if ( ! is_array( $raw ) ) {
				return array();
			}

			$clean = array();
			$seen  = array();
			foreach ( $raw as $item ) {
				if ( ! is_array( $item ) ) {
					continue;
				}
				$id = self::sanitize_class_name( isset( $item['id'] ) ? $item['id'] : '' );
				if ( '' === $id || isset( $seen[ $id ] ) ) {
					continue;
				}
				$seen[ $id ] = true;

				$clean[] = array(
					'id'   => $id,
					'name' => isset( $item['name'] ) ? sanitize_text_field( (string) $item['name'] ) : $id,
					'css'  => self::sanitize_css( isset( $item['css'] ) ? $item['css'] : '' ),
				);
			}
			return $clean;
		}

		/**
		 * A valid CSS class name: letters/digits/_/- and cannot start with a digit.
		 *
		 * @param mixed $name Raw.
		 * @return string
		 */
		public static function sanitize_class_name( $name ) {
			$name = preg_replace( '/[^a-zA-Z0-9_-]+/', '-', (string) $name );
			$name = trim( $name, '-' );
			if ( '' !== $name && preg_match( '/^[0-9]/', $name ) ) {
				$name = 'c-' . $name;
			}
			return $name;
		}

		/**
		 * Keep the CSS body from breaking out of the emitted <style> context.
		 * Braces, `&` and `@` stay (nesting / media queries are supported).
		 *
		 * @param mixed $css Raw CSS text.
		 * @return string
		 */
		public static function sanitize_css( $css ) {
			$css = (string) $css;
			// Strip only angle brackets (prevents </style> breakout). CSS comments
			// are kept — a disabled declaration is stored as `/* prop: value; */`.
			$css = str_replace( array( '<', '>' ), '', $css );
			return trim( $css );
		}

		/**
		 * Build the full stylesheet for all classes.
		 *
		 * @return string
		 */
		public static function build_css() {
			$out = '';
			foreach ( self::get_classes() as $c ) {
				if ( empty( $c['id'] ) ) {
					continue;
				}
				$out .= self::compile_block( '.' . $c['id'], isset( $c['css'] ) ? $c['css'] : '' );
			}
			return $out;
		}

		/**
		 * Public compiler: render one class id + raw CSS body into `.<id>{…}`.
		 * Reused by UiChemy_Variables for `class`-type items.
		 *
		 * @param string $id  Class id (without dot).
		 * @param string $css Raw CSS body.
		 * @return string
		 */
		public static function render( $id, $css ) {
			$id = self::sanitize_class_name( $id );
			return '' === $id ? '' : self::compile_block( '.' . $id, (string) $css );
		}

		/**
		 * Compile one class body: loose declarations wrap in `sel{…}`; `&`-prefixed
		 * blocks have `&` replaced with the selector; `@…` blocks recurse.
		 *
		 * @param string $sel  Full selector (e.g. `.pr-blog-card`).
		 * @param string $body Raw CSS body.
		 * @return string
		 */
		private static function compile_block( $sel, $body ) {
			$loose  = '';   // completed loose declarations (including disabled comments).
			$blocks = '';
			$sbuf   = '';   // current selector-candidate / trailing text.
			$len    = strlen( $body );
			$i      = 0;

			while ( $i < $len ) {
				// CSS comment — copy through opaquely so its `{ } ;` are never structural.
				if ( '/' === $body[ $i ] && $i + 1 < $len && '*' === $body[ $i + 1 ] ) {
					$end = strpos( $body, '*/', $i + 2 );
					if ( false === $end ) {
						$sbuf .= substr( $body, $i );
						$i     = $len;
					} else {
						$sbuf .= substr( $body, $i, $end - $i + 2 );
						$i     = $end + 2;
					}
					continue;
				}

				$ch = $body[ $i ];
				if ( ';' === $ch ) {
					$loose .= $sbuf . ';';
					$sbuf   = '';
					++$i;
					continue;
				}
				if ( '{' === $ch ) {
					$selector = trim( $sbuf );
					$sbuf     = '';
					$depth    = 1;
					$inner    = '';
					++$i;
					while ( $i < $len && $depth > 0 ) {
						if ( '/' === $body[ $i ] && $i + 1 < $len && '*' === $body[ $i + 1 ] ) {
							$e = strpos( $body, '*/', $i + 2 );
							if ( false === $e ) {
								$inner .= substr( $body, $i );
								$i      = $len;
							} else {
								$inner .= substr( $body, $i, $e - $i + 2 );
								$i      = $e + 2;
							}
							continue;
						}
						$c2 = $body[ $i ];
						if ( '{' === $c2 ) {
							++$depth;
						} elseif ( '}' === $c2 ) {
							--$depth;
							if ( 0 === $depth ) {
								break;
							}
						}
						$inner .= $c2;
						++$i;
					}
					++$i; // past the closing brace.

					if ( '' === $selector ) {
						continue;
					}
					if ( '@' === $selector[0] ) {
						$blocks .= $selector . '{' . self::compile_block( $sel, $inner ) . '}';
					} else {
						if ( false !== strpos( $selector, '&' ) ) {
							$selector = str_replace( '&', $sel, $selector );
						} elseif ( ':' === $selector[0] ) {
							$selector = $sel . $selector;
						} else {
							$selector = $sel . ' ' . $selector;
						}
						$blocks .= $selector . '{' . trim( $inner ) . '}';
					}
					continue;
				}
				$sbuf .= $ch;
				++$i;
			}

			$loose = trim( $loose . $sbuf );
			$css   = '';
			if ( '' !== $loose ) {
				$css .= $sel . '{' . $loose . '}';
			}
			return $css . $blocks;
		}

		/**
		 * Enqueue the classes stylesheet (frontend + editor preview).
		 *
		 * @return void
		 */
		public static function enqueue_css() {
			$css = self::build_css();
			if ( '' === $css ) {
				return;
			}
			wp_register_style( self::STYLE_HANDLE, false, array(), UICHEMY_VERSION );
			wp_enqueue_style( self::STYLE_HANDLE );
			wp_add_inline_style( self::STYLE_HANDLE, $css );
		}

		/**
		 * REST: GET/POST /uichemy/v1/classes.
		 *
		 * @return void
		 */
		public static function register_routes() {
			register_rest_route(
				self::REST_NS,
				'/classes',
				array(
					array(
						'methods'             => 'GET',
						'callback'            => array( __CLASS__, 'rest_get' ),
						'permission_callback' => array( __CLASS__, 'rest_permission' ),
					),
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'rest_save' ),
						'permission_callback' => array( __CLASS__, 'rest_permission' ),
					),
				)
			);
		}

		/**
		 * Permission: admin-level access (same policy as Variables).
		 *
		 * @param WP_REST_Request $request Request.
		 * @return bool|WP_Error
		 */
		public static function rest_permission( $request ) {
			if ( class_exists( 'UiChemy_Rest_Permissions' ) ) {
				return UiChemy_Rest_Permissions::check_feature( 'design_system' );
			}
			return current_user_can( 'manage_options' );
		}

		/**
		 * REST GET handler.
		 *
		 * @return WP_REST_Response
		 */
		public static function rest_get() {
			return new WP_REST_Response(
				array(
					'classes' => self::get_classes(),
					'css'     => self::build_css(),
				),
				200
			);
		}

		/**
		 * REST POST handler.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return WP_REST_Response
		 */
		public static function rest_save( $request ) {
			$body    = $request->get_json_params();
			$classes = isset( $body['classes'] ) ? $body['classes'] : null;
			if ( ! is_array( $classes ) ) {
				return new WP_REST_Response( array( 'error' => 'classes array required' ), 400 );
			}
			$clean = self::update_classes( $classes );
			return new WP_REST_Response(
				array(
					'classes' => $clean,
					'css'     => self::build_css(),
				),
				200
			);
		}
	}

	UiChemy_Classes::init();
}
