<?php
/**
 * UiChemy Variables — site-wide design tokens (color, spacing, dimensions,
 * radius, shadow, …) stored in a single option and emitted as CSS custom
 * properties (var(--<id>)) on the frontend and inside the editor preview.
 *
 * This is the .org-compliant "structured values, plugin generates the CSS"
 * model: the user supplies typed values (not code); the plugin emits the CSS.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Variables' ) ) {

	/**
	 * Stores and emits UiChemy design-token variables.
	 */
	class UiChemy_Variables {

		const OPTION       = 'uichemy_globals_variable';
		const STYLE_HANDLE = 'uichemy-variables';
		const VAR_PREFIX   = '--';
		const REST_NS      = 'uichemy/v1';

		/**
		 * Allowed variable types.
		 *
		 * @return string[]
		 */
		private static function allowed_types() {
			// Structured design-token types the panel can create. Each is a typed
			// value (not raw code) that the plugin compiles to CSS custom
			// properties — Color/Text/Font/Shadow emit a string var, Number emits a
			// unit+sides dimension. `class`/`button` remain intentionally excluded
			// (they emit rule blocks, not tokens). Anything not listed is rejected
			// on save AND ignored on read, so a raw import can't smuggle one in.
			// `dimensions` is the legacy alias of `number` and is kept for
			// back-compat with any previously stored data.
			return array( 'color', 'text', 'number', 'dimensions', 'shadow', 'font' );
		}

		/**
		 * Register hooks.
		 *
		 * @return void
		 */
		public static function init() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
			add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_root_css' ) );
			add_action( 'elementor/preview/enqueue_styles', array( __CLASS__, 'enqueue_root_css' ) );
		}

		/**
		 * Read all stored variables.
		 *
		 * @return array<int,array>
		 */
		public static function get_variables() {
			$list = get_option( self::OPTION, array() );
			if ( ! is_array( $list ) ) {
				return array();
			}
			// Surface only supported types. The stored option can be written raw
			// by an external importer (which bypasses our sanitizer), so guard the
			// read too — a disallowed type never reaches the panel or the CSS emit.
			$allowed = self::allowed_types();
			$out     = array();
			foreach ( $list as $v ) {
				if ( is_array( $v ) && isset( $v['type'] ) && in_array( $v['type'], $allowed, true ) ) {
					$out[] = $v;
				}
			}
			return $out;
		}

		/**
		 * Sanitize and persist a list of variables.
		 *
		 * @param array $variables Raw variable list.
		 * @return array Saved (clean) list.
		 */
		public static function update_variables( $variables ) {
			update_option( self::OPTION, self::sanitize_variables( $variables ), false );
			return self::get_variables();
		}

		/**
		 * Sanitize a raw list of variables.
		 *
		 * @param mixed $raw Raw value list.
		 * @return array<int,array>
		 */
		public static function sanitize_variables( $raw ) {
			if ( ! is_array( $raw ) ) {
				return array();
			}

			$clean = array();
			foreach ( $raw as $item ) {
				if ( ! is_array( $item ) ) {
					continue;
				}

				$id   = isset( $item['id'] ) ? sanitize_key( $item['id'] ) : '';
				$type = isset( $item['type'] ) ? sanitize_key( $item['type'] ) : '';

				if ( '' === $id || ! in_array( $type, self::allowed_types(), true ) ) {
					continue;
				}

				if ( 'button' === $type ) {
					$entry = self::sanitize_button( $id, $item );
				} elseif ( 'class' === $type ) {
					$entry = array(
						'id'   => $id,
						'name' => isset( $item['name'] ) ? sanitize_text_field( (string) $item['name'] ) : $id,
						'type' => 'class',
						'css'  => self::sanitize_class_css( isset( $item['css'] ) ? $item['css'] : '' ),
					);
				} else {
					$entry = array(
						'id'    => $id,
						'name'  => isset( $item['name'] ) ? sanitize_text_field( (string) $item['name'] ) : $id,
						'type'  => $type,
						'value' => self::sanitize_value( $type, isset( $item['value'] ) ? $item['value'] : '' ),
					);

					// Optional responsive overrides (tablet / mobile). Stored only when
					// actually provided; empty/absent → inherits the desktop value.
					foreach ( array( 'tablet', 'mobile' ) as $dev ) {
						if ( isset( $item[ $dev ] ) && ( is_array( $item[ $dev ] ) || ( is_string( $item[ $dev ] ) && '' !== $item[ $dev ] ) ) ) {
							$entry[ $dev ] = self::sanitize_value( $type, $item[ $dev ] );
						}
					}
				}

				// Tab/group membership — a UI-only grouping (name + stable id).
				// Not used by the CSS emit; every item still emits regardless.
				if ( isset( $item['group'] ) && '' !== (string) $item['group'] ) {
					$entry['group'] = sanitize_key( $item['group'] );
				}
				if ( isset( $item['group_name'] ) && '' !== (string) $item['group_name'] ) {
					$entry['group_name'] = sanitize_text_field( (string) $item['group_name'] );
				}

				$clean[] = $entry;
			}

			return $clean;
		}

		/**
		 * Sanitize a value according to its type.
		 *
		 * @param string $type  Variable type.
		 * @param mixed  $value Raw value.
		 * @return mixed Clean value.
		 */
		private static function sanitize_value( $type, $value ) {
			switch ( $type ) {
				case 'number':
				case 'dimensions':
					$v = is_array( $value ) ? $value : array();
					return array(
						'unit'   => self::safe_unit( isset( $v['unit'] ) ? $v['unit'] : 'px' ),
						'top'    => self::num( isset( $v['top'] ) ? $v['top'] : 0 ),
						'right'  => self::num( isset( $v['right'] ) ? $v['right'] : 0 ),
						'bottom' => self::num( isset( $v['bottom'] ) ? $v['bottom'] : 0 ),
						'left'   => self::num( isset( $v['left'] ) ? $v['left'] : 0 ),
					);

				case 'color':
				case 'text':
				case 'custom':
				case 'shadow':
				case 'font':
				default:
					return self::css_safe( is_string( $value ) ? $value : '' );
			}
		}

		/**
		 * Sanitize a `class` item's raw CSS body: strip only angle brackets
		 * (prevents </style> breakout); comments kept (disabled declarations).
		 *
		 * @param mixed $css Raw CSS.
		 * @return string
		 */
		private static function sanitize_class_css( $css ) {
			return trim( str_replace( array( '<', '>' ), '', (string) $css ) );
		}

		/**
		 * One-time migration: fold the legacy `uichemy_globals_class` option into
		 * this option as `class`-type items, then empty it so nothing double-emits.
		 *
		 * @return void
		 */
		public static function migrate_legacy_classes() {
			$legacy = get_option( 'uichemy_globals_class', false );
			if ( ! is_array( $legacy ) || empty( $legacy ) ) {
				return;
			}
			$current = self::get_variables();
			$have    = array();
			foreach ( $current as $v ) {
				if ( ! empty( $v['id'] ) ) {
					$have[ $v['id'] ] = true;
				}
			}
			foreach ( $legacy as $c ) {
				if ( empty( $c['id'] ) || isset( $have[ $c['id'] ] ) ) {
					continue;
				}
				$current[] = array(
					'id'   => $c['id'],
					'name' => isset( $c['name'] ) ? $c['name'] : $c['id'],
					'type' => 'class',
					'css'  => isset( $c['css'] ) ? $c['css'] : '',
				);
			}
			update_option( self::OPTION, $current, true );
			update_option( 'uichemy_globals_class', array(), true ); // stop legacy emit.
		}

		/**
		 * Sanitize a dimensions value (unit + 4 sides).
		 *
		 * @param mixed $v Raw.
		 * @return array
		 */
		private static function sanitize_dim( $v ) {
			$v = is_array( $v ) ? $v : array();
			return array(
				'unit'   => self::safe_unit( isset( $v['unit'] ) ? $v['unit'] : 'px' ),
				'top'    => self::num( isset( $v['top'] ) ? $v['top'] : 0 ),
				'right'  => self::num( isset( $v['right'] ) ? $v['right'] : 0 ),
				'bottom' => self::num( isset( $v['bottom'] ) ? $v['bottom'] : 0 ),
				'left'   => self::num( isset( $v['left'] ) ? $v['left'] : 0 ),
			);
		}

		/**
		 * Whitelist a CSS border-style.
		 *
		 * @param mixed $s Raw.
		 * @return string
		 */
		private static function safe_border_style( $s ) {
			$s       = strtolower( (string) $s );
			$allowed = array( 'none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset' );
			return in_array( $s, $allowed, true ) ? $s : 'solid';
		}

		/**
		 * Sanitize a button global (compound). Normal state is always stored.
		 * Hover mirrors every Normal option but each hover property is an opt-in
		 * override — stored only when provided, so unset ones inherit Normal.
		 * Responsive tablet/mobile overrides apply to padding / margin /
		 * border-width in both Normal and Hover.
		 *
		 * @param string $id   Sanitized id.
		 * @param array  $item Raw item.
		 * @return array
		 */
		private static function sanitize_button( $id, $item ) {
			$btn = array(
				'id'                 => $id,
				'type'               => 'button',
				'name'               => isset( $item['name'] ) ? sanitize_text_field( (string) $item['name'] ) : $id,

				// Normal state (always present).
				'bg'                 => self::css_safe( isset( $item['bg'] ) ? $item['bg'] : '' ),
				'text'               => self::css_safe( isset( $item['text'] ) ? $item['text'] : '' ),
				'icon'               => self::css_safe( isset( $item['icon'] ) ? $item['icon'] : '' ),
				'border_color'       => self::css_safe( isset( $item['border_color'] ) ? $item['border_color'] : '' ),
				'border_style'       => self::safe_border_style( isset( $item['border_style'] ) ? $item['border_style'] : 'solid' ),
				'border_radius'      => self::sanitize_dim( isset( $item['border_radius'] ) ? $item['border_radius'] : array() ),
				'padding'            => self::sanitize_dim( isset( $item['padding'] ) ? $item['padding'] : array() ),
				'margin'             => self::sanitize_dim( isset( $item['margin'] ) ? $item['margin'] : array() ),
				'border_width'       => self::sanitize_dim( isset( $item['border_width'] ) ? $item['border_width'] : array() ),
				'box_shadow'         => self::css_safe( isset( $item['box_shadow'] ) ? $item['box_shadow'] : '' ),

				// Hover colours (empty allowed — empty = inherit Normal).
				'hover_bg'           => self::css_safe( isset( $item['hover_bg'] ) ? $item['hover_bg'] : '' ),
				'hover_text'         => self::css_safe( isset( $item['hover_text'] ) ? $item['hover_text'] : '' ),
				'hover_icon'         => self::css_safe( isset( $item['hover_icon'] ) ? $item['hover_icon'] : '' ),
				'hover_border_color' => self::css_safe( isset( $item['hover_border_color'] ) ? $item['hover_border_color'] : '' ),
				'hover_border_style' => ( isset( $item['hover_border_style'] ) && '' !== $item['hover_border_style'] ) ? self::safe_border_style( $item['hover_border_style'] ) : '',
				'hover_box_shadow'   => self::css_safe( isset( $item['hover_box_shadow'] ) ? $item['hover_box_shadow'] : '' ),
			);

			// Optional hover dimension overrides — stored only when provided
			// (absent = hover keeps the Normal value).
			foreach ( array( 'hover_border_width', 'hover_border_radius', 'hover_padding', 'hover_margin' ) as $f ) {
				if ( isset( $item[ $f ] ) && is_array( $item[ $f ] ) ) {
					$btn[ $f ] = self::sanitize_dim( $item[ $f ] );
				}
			}

			// Responsive (tablet/mobile) overrides for the responsive dimension fields.
			foreach ( array( 'padding', 'margin', 'border_width', 'hover_padding', 'hover_margin', 'hover_border_width' ) as $f ) {
				foreach ( array( 'tablet', 'mobile' ) as $dev ) {
					$key = $f . '_' . $dev;
					if ( isset( $item[ $key ] ) && is_array( $item[ $key ] ) ) {
						$btn[ $key ] = self::sanitize_dim( $item[ $key ] );
					}
				}
			}

			return $btn;
		}

		/**
		 * Cast to a number.
		 *
		 * @param mixed $n Raw.
		 * @return float
		 */
		private static function num( $n ) {
			return (float) $n;
		}

		/**
		 * Whitelist a CSS unit.
		 *
		 * @param mixed $u Raw unit.
		 * @return string
		 */
		private static function safe_unit( $u ) {
			$u = strtolower( (string) $u );
			return in_array( $u, array( 'px', 'em', 'rem', '%', 'vh', 'vw', 'pt' ), true ) ? $u : 'px';
		}

		/**
		 * Strip characters that could break out of a CSS value context.
		 *
		 * @param string $v Raw value.
		 * @return string
		 */
		private static function css_safe( $v ) {
			$v = (string) $v;
			$v = preg_replace( '/[<>{};@]/', '', $v );
			return trim( $v );
		}

		/**
		 * CSS declaration line(s) for one value of a variable.
		 *
		 * @param string $name Full CSS var name (e.g. --foo).
		 * @param string $type Variable type.
		 * @param mixed  $val  Value (string, or dimensions array).
		 * @return string[]
		 */
		private static function value_lines( $name, $type, $val ) {
			$out = array();
			if ( 'dimensions' === $type || 'number' === $type ) {
				if ( ! is_array( $val ) ) {
					return $out;
				}
				$u     = isset( $val['unit'] ) ? $val['unit'] : 'px';
				$t     = isset( $val['top'] ) ? $val['top'] : 0;
				$r     = isset( $val['right'] ) ? $val['right'] : 0;
				$b     = isset( $val['bottom'] ) ? $val['bottom'] : 0;
				$l     = isset( $val['left'] ) ? $val['left'] : 0;
				$out[] = $name . ':' . $t . $u . ' ' . $r . $u . ' ' . $b . $u . ' ' . $l . $u . ';';
				$out[] = $name . '-top:' . $t . $u . ';';
				$out[] = $name . '-right:' . $r . $u . ';';
				$out[] = $name . '-bottom:' . $b . $u . ';';
				$out[] = $name . '-left:' . $l . $u . ';';
			} elseif ( '' !== $val ) {
				$out[] = $name . ':' . $val . ';';
			}
			return $out;
		}

		/**
		 * Build the responsive :root {} CSS from stored variables.
		 *
		 * Desktop values → :root. Tablet/mobile overrides → max-width media
		 * queries (Elementor breakpoints: tablet 1024px, mobile 767px). The
		 * mobile block is emitted last so it wins on small screens.
		 *
		 * @return string CSS (empty if no variables).
		 */
		public static function build_root_css() {
			$vars = self::get_variables();
			if ( empty( $vars ) ) {
				return '';
			}

			$root   = array();
			$tablet = array();
			$mobile = array();

			foreach ( $vars as $v ) {
				$vtype = isset( $v['type'] ) ? $v['type'] : '';
				if ( 'button' === $vtype || 'class' === $vtype ) {
					continue; // Buttons + classes emit CSS rules, not :root vars.
				}
				$name = self::VAR_PREFIX . $v['id'];
				$type = $v['type'];

				$root = array_merge( $root, self::value_lines( $name, $type, $v['value'] ) );

				if ( isset( $v['tablet'] ) ) {
					$tablet = array_merge( $tablet, self::value_lines( $name, $type, $v['tablet'] ) );
				}
				if ( isset( $v['mobile'] ) ) {
					$mobile = array_merge( $mobile, self::value_lines( $name, $type, $v['mobile'] ) );
				}
			}

			if ( empty( $root ) ) {
				return '';
			}

			$css = ':root{' . implode( '', $root ) . '}';
			if ( ! empty( $tablet ) ) {
				$css .= '@media(max-width:1024px){:root{' . implode( '', $tablet ) . '}}';
			}
			if ( ! empty( $mobile ) ) {
				$css .= '@media(max-width:767px){:root{' . implode( '', $mobile ) . '}}';
			}
			return $css;
		}

		/**
		 * Format a dimensions array as a CSS shorthand value (T R B L).
		 *
		 * @param mixed $d Dimensions array.
		 * @return string
		 */
		private static function dim_css( $d ) {
			if ( ! is_array( $d ) ) {
				return '';
			}
			$u = isset( $d['unit'] ) ? $d['unit'] : 'px';
			$t = isset( $d['top'] ) ? $d['top'] : 0;
			$r = isset( $d['right'] ) ? $d['right'] : 0;
			$b = isset( $d['bottom'] ) ? $d['bottom'] : 0;
			$l = isset( $d['left'] ) ? $d['left'] : 0;
			return $t . $u . ' ' . $r . $u . ' ' . $b . $u . ' ' . $l . $u;
		}

		/**
		 * Build CSS classes for button globals.
		 *
		 * Each button emits a `.<id>` rule (+ `:hover`) with desktop
		 * values, and tablet/mobile media-query overrides for padding, margin,
		 * border-width and hover border-width (Elementor breakpoints 1024/767).
		 *
		 * @return string CSS (empty if no button globals).
		 */
		public static function build_button_css() {
			$vars = self::get_variables();
			if ( empty( $vars ) ) {
				return '';
			}

			$out = '';
			foreach ( $vars as $v ) {
				if ( 'button' !== ( isset( $v['type'] ) ? $v['type'] : '' ) ) {
					continue;
				}
				$sel = '.' . $v['id'];

				// Normal state.
				$d = array();
				if ( '' !== $v['bg'] ) {
					$d[] = 'background-color:' . $v['bg'] . ';';
				}
				if ( '' !== $v['text'] ) {
					$d[] = 'color:' . $v['text'] . ';';
				}
				$d[] = 'border-style:' . $v['border_style'] . ';';
				if ( '' !== $v['border_color'] ) {
					$d[] = 'border-color:' . $v['border_color'] . ';';
				}
				$d[] = 'border-width:' . self::dim_css( $v['border_width'] ) . ';';
				$d[] = 'border-radius:' . self::dim_css( $v['border_radius'] ) . ';';
				if ( '' !== ( isset( $v['box_shadow'] ) ? $v['box_shadow'] : '' ) ) {
					$d[] = 'box-shadow:' . $v['box_shadow'] . ';';
				}
				$d[]  = 'padding:' . self::dim_css( $v['padding'] ) . ';';
				$d[]  = 'margin:' . self::dim_css( $v['margin'] ) . ';';
				$out .= $sel . '{' . implode( '', $d ) . '}';

				// Icon color.
				if ( '' !== $v['icon'] ) {
					$out .= $sel . ' svg,' . $sel . ' i{color:' . $v['icon'] . ';fill:' . $v['icon'] . ';}';
				}

				// Hover state — emit only the properties that were set; the rest
				// inherit the Normal state on :hover.
				$hbg = isset( $v['hover_bg'] ) ? $v['hover_bg'] : '';
				$htx = isset( $v['hover_text'] ) ? $v['hover_text'] : '';
				$hbc = isset( $v['hover_border_color'] ) ? $v['hover_border_color'] : '';
				$hbs = isset( $v['hover_border_style'] ) ? $v['hover_border_style'] : '';
				$hic = isset( $v['hover_icon'] ) ? $v['hover_icon'] : '';
				$h   = array();
				if ( '' !== $hbg ) {
					$h[] = 'background-color:' . $hbg . ';';
				}
				if ( '' !== $htx ) {
					$h[] = 'color:' . $htx . ';';
				}
				if ( '' !== $hbs ) {
					$h[] = 'border-style:' . $hbs . ';';
				}
				if ( '' !== $hbc ) {
					$h[] = 'border-color:' . $hbc . ';';
				}
				if ( isset( $v['hover_border_width'] ) ) {
					$h[] = 'border-width:' . self::dim_css( $v['hover_border_width'] ) . ';';
				}
				if ( isset( $v['hover_border_radius'] ) ) {
					$h[] = 'border-radius:' . self::dim_css( $v['hover_border_radius'] ) . ';';
				}
				if ( isset( $v['hover_box_shadow'] ) && '' !== $v['hover_box_shadow'] ) {
					$h[] = 'box-shadow:' . $v['hover_box_shadow'] . ';';
				}
				if ( isset( $v['hover_padding'] ) ) {
					$h[] = 'padding:' . self::dim_css( $v['hover_padding'] ) . ';';
				}
				if ( isset( $v['hover_margin'] ) ) {
					$h[] = 'margin:' . self::dim_css( $v['hover_margin'] ) . ';';
				}
				if ( ! empty( $h ) ) {
					$out .= $sel . ':hover{' . implode( '', $h ) . '}';
				}

				// Hover icon color.
				if ( '' !== $hic ) {
					$out .= $sel . ':hover svg,' . $sel . ':hover i{color:' . $hic . ';fill:' . $hic . ';}';
				}

				// Responsive overrides (tablet 1024 / mobile 767).
				$breakpoints = array(
					'tablet' => '1024',
					'mobile' => '767',
				);
				foreach ( $breakpoints as $dev => $bp ) {
					$base  = array();
					$hover = array();
					$map   = array(
						'padding'      => 'padding',
						'margin'       => 'margin',
						'border_width' => 'border-width',
					);
					foreach ( $map as $f => $css_prop ) {
						$k = $f . '_' . $dev;
						if ( isset( $v[ $k ] ) ) {
							$base[] = $css_prop . ':' . self::dim_css( $v[ $k ] ) . ';';
						}
					}
					$hmap = array(
						'hover_padding'      => 'padding',
						'hover_margin'       => 'margin',
						'hover_border_width' => 'border-width',
					);
					foreach ( $hmap as $f => $css_prop ) {
						$hk = $f . '_' . $dev;
						if ( isset( $v[ $hk ] ) ) {
							$hover[] = $css_prop . ':' . self::dim_css( $v[ $hk ] ) . ';';
						}
					}
					if ( ! empty( $base ) || ! empty( $hover ) ) {
						$mq = '@media(max-width:' . $bp . 'px){';
						if ( ! empty( $base ) ) {
							$mq .= $sel . '{' . implode( '', $base ) . '}';
						}
						if ( ! empty( $hover ) ) {
							$mq .= $sel . ':hover{' . implode( '', $hover ) . '}';
						}
						$mq  .= '}';
						$out .= $mq;
					}
				}
			}

			return $out;
		}

		/**
		 * Build CSS rules for `class` items — each emits `.<id>{…}` from its raw
		 * CSS body (supports `&` nesting / @media / disabled comments), reusing
		 * the shared UiChemy_Classes compiler.
		 *
		 * @return string
		 */
		public static function build_class_css() {
			if ( ! class_exists( 'UiChemy_Classes' ) ) {
				return '';
			}
			$out = '';
			foreach ( self::get_variables() as $v ) {
				if ( 'class' !== ( isset( $v['type'] ) ? $v['type'] : '' ) || empty( $v['id'] ) ) {
					continue;
				}
				$out .= UiChemy_Classes::render( $v['id'], isset( $v['css'] ) ? $v['css'] : '' );
			}
			return $out;
		}

		/**
		 * The complete emitted stylesheet: :root variables (+ responsive @media),
		 * button presets and global classes. Single source of truth reused by the
		 * enqueue and the REST responses (so the editor can live-inject it).
		 *
		 * @return string
		 */
		public static function build_all_css() {
			return self::build_root_css() . self::build_button_css() . self::build_class_css();
		}

		/**
		 * Enqueue the variables as an inline stylesheet (frontend + editor preview).
		 *
		 * @return void
		 */
		public static function enqueue_root_css() {
			$css = self::build_all_css();
			if ( '' === $css ) {
				return;
			}

			wp_register_style( self::STYLE_HANDLE, false, array(), UICHEMY_VERSION );
			wp_enqueue_style( self::STYLE_HANDLE );
			wp_add_inline_style( self::STYLE_HANDLE, $css );
		}

		/**
		 * Register REST routes for reading/saving variables.
		 *
		 * @return void
		 */
		public static function register_routes() {
			register_rest_route(
				self::REST_NS,
				'/variables',
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
		 * REST permission — administrators only.
		 *
		 * @param \WP_REST_Request $request Request.
		 * @return bool|\WP_Error
		 */
		public static function rest_permission( $request ) {
			if ( class_exists( 'UiChemy_Rest_Permissions' ) ) {
				return UiChemy_Rest_Permissions::check_feature( 'design_system' );
			}
			return current_user_can( 'manage_options' );
		}

		/**
		 * GET handler.
		 *
		 * @return \WP_REST_Response
		 */
		public static function rest_get() {
			return rest_ensure_response(
				array(
					'variables' => self::get_variables(),
					'css'       => self::build_all_css(),
				)
			);
		}

		/**
		 * POST handler — replace the variable list.
		 *
		 * @param \WP_REST_Request $request Request.
		 * @return \WP_REST_Response
		 */
		public static function rest_save( $request ) {
			$body     = $request->get_json_params();
			$incoming = ( is_array( $body ) && isset( $body['variables'] ) && is_array( $body['variables'] ) ) ? $body['variables'] : array();
			$saved    = self::update_variables( $incoming );

			return rest_ensure_response(
				array(
					'success'   => true,
					'variables' => $saved,
					'css'       => self::build_all_css(),
				)
			);
		}
	}

	UiChemy_Variables::init();
}
