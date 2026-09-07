<?php
/**
 * File for handling Globals Operations
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    Uichemy
 */

/**
 * Exit if accessed directly.
 * */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Globals' ) ) {

	/**
	 * For handling Global Colors/Typography Operations
	 */
	class Uich_Globals {

		// Modification helpers
		private static function get_all_kit_settings() {
			// Kit
			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();

			$page_settings_manager = \Elementor\Core\Settings\Manager::get_settings_managers( 'page' );

			$meta_key = $page_settings_manager::META_KEY;

			$document_settings = $kit->get_meta( $meta_key );

			$meta_key          = $page_settings_manager::META_KEY;
			$document_settings = $kit->get_meta( $meta_key );

			if ( ! $document_settings ) {
				$document_settings = array();
			}

			$default_settings = array(
				'custom_colors'     => $kit->get_settings_for_display( 'custom_colors' ),
				'system_colors'     => $kit->get_settings_for_display( 'system_colors' ),
				'custom_typography' => $kit->get_settings_for_display( 'custom_typography' ),
				'system_typography' => $kit->get_settings_for_display( 'system_typography' ),
			);

			$required_keys = array(
				'custom_colors',
				'system_colors',
				'custom_typography',
				'system_typography',
			);

			foreach ( $required_keys as $key ) {
				if ( isset( $document_settings[ $key ] ) ) {
					continue;
				}

				$document_settings[ $key ] = ! empty( $default_settings[ $key ] ) ? $default_settings[ $key ] : array();
			}

			return $document_settings;
		}

		private static function save_all_kit_settings( $document_settings ) {
			// Kit
			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();

			$page_settings_manager = \Elementor\Core\Settings\Manager::get_settings_managers( 'page' );

			// Save to DB
			$page_settings_manager->save_settings( $document_settings, $kit->get_id() );

			// Update all the auto saves as well
			$all_users = get_users( array( 'ID' ) );
			$autosaves = array();

			foreach ( $all_users as $user ) {
				$autosave = $kit->get_autosave( $user->ID );
				if ( $autosave ) {
					$autosaves[] = $autosave;

					// Save to DB
					$page_settings_manager->save_settings( $document_settings, $autosave->get_id() );

					// Clear Cache & reset CSS
					self::elementor_refresh_css_and_clear_cache( $autosave->get_id() );
				}
			}

			// Clear Cache & reset CSS
			self::elementor_refresh_css_and_clear_cache( $kit->get_id() );
		}

		// Helper function to ensure default values are set in Elementor kit
		private static function ensure_default_container_widths( $all_settings ) {

			// Ensure it's an array
			if ( ! is_array( $all_settings ) ) {
				$all_settings = array();
			}

			// Default container widths
			$defaults = array(
				'desktop' => array(
					'unit'  => 'px',
					'size'  => 1140,
					'sizes' => array(),
				),
				'tablet'  => array(
					'unit'  => '%',
					'size'  => 85,
					'sizes' => array(),
				),
				'mobile'  => array(
					'unit'  => '%',
					'size'  => 90,
					'sizes' => array(),
				),
			);

			$needs_update = false;

			// desktop
			if ( empty( $all_settings['container_width'] ) ) {
				$all_settings['container_width'] = $defaults['desktop'];
				$needs_update                    = true;
			}

			// tablet
			if ( empty( $all_settings['container_width_tablet'] ) ) {
				$all_settings['container_width_tablet'] = $defaults['tablet'];
				$needs_update                           = true;
			}

			// mobile
			if ( empty( $all_settings['container_width_mobile'] ) ) {
				$all_settings['container_width_mobile'] = $defaults['mobile'];
				$needs_update                           = true;
			}

			if ( $needs_update ) {
				self::save_all_kit_settings( $all_settings );
			}

			return $all_settings;
		}

		public static function get_elementor_container_breakpoints_width() {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return false;
			}

			$all_settings                                   = self::ensure_default_container_widths( self::get_all_kit_settings() );
			$container_width_from_all_settings              = array_key_exists( 'container_width', $all_settings ) ? $all_settings['container_width'] : null;
			$container_width_tablet_from_all_settings       = array_key_exists( 'container_width_tablet', $all_settings ) ? $all_settings['container_width_tablet'] : null;
			$container_width_mobile_from_all_settings       = array_key_exists( 'container_width_mobile', $all_settings ) ? $all_settings['container_width_mobile'] : null;
			$container_width_tablet_extra_from_all_settings = array_key_exists( 'container_width_tablet_extra', $all_settings ) ? $all_settings['container_width_tablet_extra'] : null;
			$container_width_mobile_extra_from_all_settings = array_key_exists( 'container_width_mobile_extra', $all_settings ) ? $all_settings['container_width_mobile_extra'] : null;
			$container_width_widescreen_from_all_settings   = array_key_exists( 'container_width_widescreen', $all_settings ) ? $all_settings['container_width_widescreen'] : null;
			$container_width_laptop_from_all_settings       = array_key_exists( 'container_width_laptop', $all_settings ) ? $all_settings['container_width_laptop'] : null;

			$kit                              = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();
			$container_width_kit              = $kit->get_settings_for_display( 'container_width' );
			$container_width_tablet_kit       = $kit->get_settings_for_display( 'container_width_tablet' );
			$container_width_mobile_kit       = $kit->get_settings_for_display( 'container_width_mobile' );
			$container_width_tablet_extra_kit = $kit->get_settings_for_display( 'container_width_tablet_extra' );
			$container_width_mobile_extra_kit = $kit->get_settings_for_display( 'container_width_mobile_extra' );
			$container_width_widescreen_kit   = $kit->get_settings_for_display( 'container_width_widescreen' );
			$container_width_laptop_kit       = $kit->get_settings_for_display( 'container_width_laptop' );

			$container_width_normalize = function ( $value ) {
				if ( empty( $value ) || ! is_array( $value ) ) {
					return null;
				}
				if ( ! isset( $value['unit'] ) || null === $value['unit'] ) {
					return null;
				}
				if ( ! isset( $value['size'] ) || '' === $value['size'] ) {
					return null;
				}
				return $value;
			};

			$container_width_array = array();

			// desktop
			$desktop                          = $container_width_from_all_settings ?? $container_width_kit;
			$container_width_array['desktop'] = $desktop;

			// tablet
			$tablet                          = $container_width_tablet_from_all_settings ?? $container_width_tablet_kit ?? null;
			$container_width_array['tablet'] = $container_width_normalize( $tablet );

			// tablet extra
			$tablet_extra                          = $container_width_tablet_extra_from_all_settings ?? $container_width_tablet_extra_kit ?? null;
			$container_width_array['tablet_extra'] = $container_width_normalize( $tablet_extra );

			// mobile
			$mobile                          = $container_width_mobile_from_all_settings ?? $container_width_mobile_kit ?? null;
			$container_width_array['mobile'] = $container_width_normalize( $mobile );

			// mobile extra
			$mobile_extra                          = $container_width_mobile_extra_from_all_settings ?? $container_width_mobile_extra_kit ?? null;
			$container_width_array['mobile_extra'] = $container_width_normalize( $mobile_extra );

			// widescreen
			$widescreen                          = $container_width_widescreen_from_all_settings ?? $container_width_widescreen_kit ?? null;
			$container_width_array['widescreen'] = $container_width_normalize( $widescreen );

			// laptop
			$laptop                          = $container_width_laptop_from_all_settings ?? $container_width_laptop_kit ?? null;
			$container_width_array['laptop'] = $container_width_normalize( $laptop );

			return $container_width_array;
		}

		// Lists
		public static function get_typography() {

			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return false;
			}

			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();

			$system_typography = $kit->get_settings_for_display( 'system_typography' );
			$custom_typography = $kit->get_settings_for_display( 'custom_typography' );

			if ( ! $system_typography ) {
				$system_typography = array();
			}

			if ( ! $custom_typography ) {
				$custom_typography = array();
			}

			$combined_typography = array_merge( $system_typography, $custom_typography );

			$typography_array = array();

			foreach ( $combined_typography as $item ) {
				$id    = $item['_id'];
				$title = $item['title'];

				// $item To be set as `value`
				unset( $item['_id'], $item['title'] );

				// Convert the value to an object if it's an array
				if ( is_array( $item ) ) {
					$item = (object) $item;
				}

				$typography_array[] = array(
					'id'    => $id,
					'title' => $title,
					'value' => $item,
				);
			}

			return $typography_array;
		}

		public static function get_colors() {
			$result = array();
			$kit    = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();

			$system_items = $kit->get_settings_for_display( 'system_colors' );
			$custom_items = $kit->get_settings_for_display( 'custom_colors' );

			if ( ! $system_items ) {
				$system_items = array();
			}

			if ( ! $custom_items ) {
				$custom_items = array();
			}

			$items = array_merge( $system_items, $custom_items );

			foreach ( $items as $index => $item ) {
				$id       = $item['_id'];
				$result[] = array(
					'id'    => $id,
					'title' => $item['title'],
					'value' => $item['color'],
				);
			}

			return $result;
		}

		public static function set_container_breakpoints_width( $new_container_width ) {

			// Get the current container width
			$document_settings = self::get_all_kit_settings();

			// Convert object -> array
			if ( is_object( $new_container_width ) ) {
				$new_container_width = (array) $new_container_width;
			}

			foreach ( $new_container_width as $device => $val ) {
				$key = "container_width_{$device}";

				if ( 'desktop' === $device ) {
					$document_settings['container_width'] = array(
						'unit'  => ! empty( $val->size ) ? $val->unit : 'px',
						'size'  => ! empty( $val->size ) ? $val->size : 1140,
						'sizes' => $val->sizes ?? array(),
					);
				} elseif ( ! isset( $val ) || ! isset( $val->size ) || '' === $val->size ) {
						$document_settings[ $key ] = array(
							'unit'  => null,
							'size'  => '',
							'sizes' => null,
						);
				} else {
					$document_settings[ $key ] = array(
						'unit'  => $val->unit,
						'size'  => $val->size,
						'sizes' => $val->sizes,
					);
				}
			}

			// Save the settings
			self::save_all_kit_settings( $document_settings );

			return $document_settings;
		}

		// Modifiers
		public static function set_or_create_color( $id, $title, $val ) {

			// Random ID: Math.random().toString(16).slice(2, 9)

			$db_item = array(
				'_id'   => $id,
				'title' => $title,
				'color' => $val,
			);

			// Get the current set of settings
			$document_settings = self::get_all_kit_settings();

			// Both colors
			$system_colors = &$document_settings['system_colors'];
			$custom_colors = &$document_settings['custom_colors'];

			$found_and_set = false;

			// Check system colors
			foreach ( $system_colors as &$val ) {
				if ( $val['_id'] !== $id ) {
					continue;
				}

				$val = $db_item;

				// Set the color & break
				// error_log( 'found a pre-existing system color' );

				// Set the flag to disallow further modification
				$found_and_set = true;

				break;
			}

			// Check system colors
			foreach ( $custom_colors as &$val ) {
				if ( $val['_id'] !== $id ) {
					continue;
				}

				$val = $db_item;

				// error_log( 'found a pre-existing custom color' );

				// Set the flag to disallow further modification
				$found_and_set = true;

				break;
			}

			// Create a new color if not already found
			if ( ! $found_and_set ) {
				$custom_colors[] = $db_item;
			}

			// Save the settings
			self::save_all_kit_settings( $document_settings );

			return $document_settings;
		}

		public static function set_or_create_typography( $id, $title, $value ) {

			$db_item = array(
				'_id'   => $id,
				'title' => $title,
				'value' => $value,
			);

			$valueObject = $db_item['value'];
			unset( $db_item['value'] );

			foreach ( $valueObject as $key => $value ) {
				if ( is_object( $value ) ) {
					$db_item[ $key ] = (array) $value;
				} else {
					$db_item[ $key ] = $value;
				}
			}

			// Get the current set of settings
			$document_settings = self::get_all_kit_settings();

			// Both typography
			$system_typography = &$document_settings['system_typography'];
			$custom_typography = &$document_settings['custom_typography'];
			$found_and_set     = false;

			// var_dump($system_typography);

			// Check system typography
			foreach ( $system_typography as &$val ) {
				if ( $val['_id'] !== $id ) {
					continue;
				}

				$val = $db_item;

				// Set the typography & break
				// error_log( 'found a pre-existing system typography' );

				// Set the flag to disallow further modification
				$found_and_set = true;

				break;
			}

			// Check system typography
			foreach ( $custom_typography as &$val ) {
				if ( $val['_id'] !== $id ) {
					continue;
				}

				$val = $db_item;

				// error_log( 'found a pre-existing custom typography' );

				// Set the flag to disallow further modification
				$found_and_set = true;

				break;
			}

			// Create a new typography if not already found
			if ( ! $found_and_set ) {
				$custom_typography[] = $db_item;
			}

			// Save the settings
			self::save_all_kit_settings( $document_settings );

			return $document_settings;
		}

		public static function delete_global_color( $id ) {

			// Get the current set of settings
			$document_settings = self::get_all_kit_settings();

			// colors
			$custom_colors = &$document_settings['custom_colors'];

			$match = null;
			foreach ( $custom_colors as $key => $val ) {
				if ( $val['_id'] !== $id ) {
					continue;
				}

				$match = $key;
				break;
			}

			if ( null === $match ) {
				return null;
			}

			// Remove
			array_splice( $custom_colors, $match, 1 );

			// Save
			self::save_all_kit_settings( $document_settings );
		}

		public static function delete_global_typography( $id ) {

			// Get the current set of settings
			$document_settings = self::get_all_kit_settings();

			// colors
			$custom_typography = &$document_settings['custom_typography'];

			$match = null;
			foreach ( $custom_typography as $key => $val ) {
				if ( $val['_id'] !== $id ) {
					continue;
				}

				$match = $key;
				break;
			}

			if ( null === $match ) {
				return null;
			}

			// Remove
			array_splice( $custom_typography, $match, 1 );

			// Save
			return self::save_all_kit_settings( $document_settings );
		}

		private static function elementor_refresh_css_and_clear_cache( $id ) {
			// Remove Post CSS.
			$post_css = \Elementor\Core\Files\CSS\Post::create( $id );

			$post_css->delete();

			// Refresh Cache.
			\Elementor\Plugin::$instance->documents->get( $id, false );

			$post_css = \Elementor\Core\Files\CSS\Post::create( $id );

			$post_css->enqueue();
		}

		// End Points
		public static function get_globals() {
			return array(
				'success'         => true,
				'typography'      => self::get_typography(),
				'colors'          => self::get_colors(),
				'container_width' => self::get_elementor_container_breakpoints_width(),
			);
		}

		/**
		 * True when the Elementor e_atomic_elements experiment is active.
		 */
		private static function is_atomic_enabled(): bool {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return false;
			}
			$experiments = \Elementor\Plugin::$instance->experiments;
			if ( ! $experiments || ! method_exists( $experiments, 'is_feature_active' ) ) {
				return false;
			}
			return (bool) $experiments->is_feature_active( 'e_atomic_elements' );
		}

		/**
		 * Build the AI snapshot for atomic mode.
		 * Format:
		 *   :root { --label: #hex; }
		 *   /* Container Width *\/
		 *   .g-uwXXXu { max-width: 1140px; }
		 *   /* heading-xl *\/
		 *   .g-utabc12 { font-family: Poppins; font-size: 48px; ... }
		 */
		private static function build_atomic_ai_snapshot(): string {
			if ( ! class_exists( 'Uich_Atomic_Globals' ) ) {
				return '';
			}

			$atomic = Uich_Atomic_Globals::get_global_classes_and_variable();
			$out    = array();

			// ---- :root color variables ----------------------------------------
			$color_lines = array();
			foreach ( $atomic['color'] ?? array() as $color ) {
				$label = isset( $color['label'] ) ? trim( (string) $color['label'] ) : '';
				$value = isset( $color['value'] ) ? trim( (string) $color['value'] ) : '';
				if ( '' === $label || '' === $value ) {
					continue;
				}
				$color_lines[] = '    --' . $label . ': ' . $value . ';';
			}
			$out[] = ':root {';
			if ( ! empty( $color_lines ) ) {
				$out = array_merge( $out, $color_lines );
			}
			$out[] = '}';

			// ---- Container width -----------------------------------------------
			$width         = $atomic['width'] ?? array();
			$desktop_width = isset( $width['desktop'] ) ? trim( (string) $width['desktop'] ) : '';
			if ( '' !== $desktop_width ) {
				$out[] = '';
				$out[] = '/* Container Width */';
				$out[] = '.elementor-atomic-boxed-width {';
				$out[] = '    max-width: ' . $desktop_width . ';';
				$out[] = '    margin-left: auto;';
				$out[] = '    margin-right: auto;';
				$out[] = '}';
			}

			// ---- Typography classes --------------------------------------------
			$typo_props = array(
				'font-family',
				'font-size',
				'font-weight',
				'line-height',
				'letter-spacing',
				'text-transform',
				'text-decoration',
				'font-style',
			);
			foreach ( $atomic['typography'] ?? array() as $typo ) {
				$id      = isset( $typo['id'] ) ? trim( (string) $typo['id'] ) : '';
				$label   = isset( $typo['label'] ) ? trim( (string) $typo['label'] ) : '';
				$desktop = isset( $typo['value']['desktop'] ) && is_array( $typo['value']['desktop'] )
					? $typo['value']['desktop']
					: array();
				if ( '' === $id || empty( $desktop ) ) {
					continue;
				}

				$prop_lines = array();
				foreach ( $typo_props as $prop ) {
					$val = isset( $desktop[ $prop ] ) ? trim( (string) $desktop[ $prop ] ) : '';
					if ( '' === $val ) {
						continue;
					}
					$prop_lines[] = '    ' . $prop . ': ' . $val . ';';
				}
				if ( empty( $prop_lines ) ) {
					continue;
				}

				$out[] = '';
				$out[] = '.' . ( '' !== $label ? $label : $id ) . ' {';
				$out   = array_merge( $out, $prop_lines );
				$out[] = '}';
			}

			return implode( "\n", $out );
		}

		/**
		 * Build the AI Data Sharing CSS snapshot — server-side equivalent of
		 * the read-only textarea inside the Smart HTML widget editor.
		 *
		 * Output format (same shape `mcp_parse_globals_ai_css_snapshot()` expects):
		 *
		 *     :root {
		 *         --e-global-color-primary: #6EC1E4;
		 *         --e-global-color-secondary: #54595F;
		 *         ...
		 *     }
		 *
		 *     .text-primary {
		 *         font-family: Roboto;
		 *         font-size: 60px;
		 *         ...
		 *     }
		 *
		 * Always uses **fixed CSS values** for the .text-* blocks (not vars) so the
		 * dynamic matcher can compare them against generated CSS literals.
		 *
		 * @return string
		 */
		public static function get_ai_data_snapshot() {
			if ( self::is_atomic_enabled() ) {
				return self::build_atomic_ai_snapshot();
			}

			$globals    = self::get_globals();
			$colors     = isset( $globals['colors'] ) && is_array( $globals['colors'] ) ? $globals['colors'] : array();
			$typography = isset( $globals['typography'] ) && is_array( $globals['typography'] ) ? $globals['typography'] : array();

			// Mirror the JS sort: preferred system IDs first, then alpha by title.
			$preferred = array( 'primary', 'secondary', 'text', 'accent' );

			$sort_fn = function ( $a, $b ) use ( $preferred ) {
				$a_id   = isset( $a['id'] ) ? (string) $a['id'] : '';
				$b_id   = isset( $b['id'] ) ? (string) $b['id'] : '';
				$a_pref = array_search( $a_id, $preferred, true );
				$b_pref = array_search( $b_id, $preferred, true );
				if ( false !== $a_pref || false !== $b_pref ) {
					if ( false === $a_pref ) {
						return 1;
					}
					if ( false === $b_pref ) {
						return -1;
					}
					return $a_pref - $b_pref;
				}
				$a_title = isset( $a['title'] ) ? (string) $a['title'] : '';
				$b_title = isset( $b['title'] ) ? (string) $b['title'] : '';
				$cmp     = strcmp( $a_title, $b_title );
				return 0 !== $cmp ? $cmp : strcmp( $a_id, $b_id );
			};

			$colors_sorted = $colors;
			usort( $colors_sorted, $sort_fn );

			$typography_sorted = $typography;
			usort( $typography_sorted, $sort_fn );

			// ---- :root color variables block ------------------------------
			$root_lines = array();
			foreach ( $colors_sorted as $idx => $color ) {
				$id    = isset( $color['id'] ) ? trim( (string) $color['id'] ) : '';
				$value = isset( $color['value'] ) ? trim( (string) $color['value'] ) : '';
				if ( '' === $id || '' === $value ) {
					continue;
				}
				$title        = isset( $color['title'] ) ? trim( (string) $color['title'] ) : '';
				$is_preferred = in_array( $id, $preferred, true );
				if ( '' !== $title && ! $is_preferred ) {
					if ( $idx > 0 ) {
						$root_lines[] = '';
					}
					$root_lines[] = '    /* ' . $title . ' */';
				}
				$root_lines[] = '    --e-global-color-' . $id . ': ' . $value . ';';
			}

			// ---- .text-{id} typography blocks ------------------------------
			// Mapping of CSS prop -> array of (typography_value_key, optional_unit_key).
			$prop_map = array(
				'font-family'     => array( 'typography_font_family', null ),
				'font-size'       => array( 'typography_font_size', 'typography_font_size_unit' ),
				'font-weight'     => array( 'typography_font_weight', null ),
				'line-height'     => array( 'typography_line_height', 'typography_line_height_unit' ),
				'letter-spacing'  => array( 'typography_letter_spacing', 'typography_letter_spacing_unit' ),
				'text-transform'  => array( 'typography_text_transform', null ),
				'text-decoration' => array( 'typography_text_decoration', null ),
				'font-style'      => array( 'typography_font_style', null ),
			);

			$typography_blocks = array();
			foreach ( $typography_sorted as $typo ) {
				$id = isset( $typo['id'] ) ? trim( (string) $typo['id'] ) : '';
				if ( '' === $id ) {
					continue;
				}
				$value = isset( $typo['value'] ) ? (array) $typo['value'] : array();
				if ( empty( $value ) ) {
					continue;
				}

				$prop_lines = array();
				foreach ( $prop_map as $css_prop => $keys ) {
					list( $value_key, $unit_key ) = $keys;
					$raw                          = isset( $value[ $value_key ] ) ? $value[ $value_key ] : '';

					// Elementor stores size+unit objects for some props.
					if ( is_array( $raw ) ) {
						$size = isset( $raw['size'] ) ? trim( (string) $raw['size'] ) : '';
						$unit = isset( $raw['unit'] ) ? trim( (string) $raw['unit'] ) : '';
						if ( '' === $size ) {
							continue;
						}
						$prop_lines[] = '    ' . $css_prop . ': ' . $size . $unit . ';';
						continue;
					}

					$raw = trim( (string) $raw );
					if ( '' === $raw ) {
						continue;
					}

					if ( null !== $unit_key && isset( $value[ $unit_key ] ) ) {
						$unit = trim( (string) $value[ $unit_key ] );
						if ( '' !== $unit && ! preg_match( '/(px|em|rem|%|vw|vh)$/i', $raw ) ) {
							$raw .= $unit;
						}
					}
					$prop_lines[] = '    ' . $css_prop . ': ' . $raw . ';';
				}

				if ( empty( $prop_lines ) ) {
					continue;
				}

				$title = isset( $typo['title'] ) ? trim( (string) $typo['title'] ) : '';
				if ( '' !== $title ) {
					$typography_blocks[] = '/* ' . $title . ' */';
				}
				$typography_blocks[] = '.text-' . $id . ' {';
				$typography_blocks   = array_merge( $typography_blocks, $prop_lines );
				$typography_blocks[] = '}';
				$typography_blocks[] = '';
			}

			// ---- Desktop container width — standalone, outside :root {} ----
			// Shown the same way as the Globals Editor tab: a plain CSS custom
			// property declaration with a comment, not nested inside :root {}.
			// Only the desktop value is exposed; responsive @media overrides are
			// omitted so the AI receives a clean single-value reference.
			$container_width_out = array();
			$container_widths    = self::get_elementor_container_breakpoints_width();

			if ( is_array( $container_widths ) ) {
				$desktop = isset( $container_widths['desktop'] ) ? $container_widths['desktop'] : null;
				$size    = '';
				$unit    = 'px';

				if ( is_array( $desktop ) ) {
					$size = isset( $desktop['size'] ) ? trim( (string) $desktop['size'] ) : '';
					$unit = isset( $desktop['unit'] ) && '' !== trim( (string) $desktop['unit'] )
						? trim( (string) $desktop['unit'] )
						: 'px';
				} elseif ( null !== $desktop && '' !== (string) $desktop ) {
					// Fallback: desktop stored as a plain scalar (e.g. integer from older kit).
					$size = trim( (string) $desktop );
					$unit = 'px';
				}

				if ( '' !== $size && '0' !== $size ) {
					$container_width_out[] = '/* Container Width */';
					$container_width_out[] = '.elementor-global-boxed-width {';
					$container_width_out[] = '    max-width: ' . $size . $unit . ';';
					$container_width_out[] = '    margin-left: auto;';
					$container_width_out[] = '    margin-right: auto;';
					$container_width_out[] = '}';
				}
			}

			// ---- Stitch output ---------------------------------------------
			$out   = array();
			$out[] = ':root {';
			if ( ! empty( $root_lines ) ) {
				$out = array_merge( $out, $root_lines );
			}
			$out[] = '}';

			if ( ! empty( $container_width_out ) ) {
				$out[] = '';
				$out   = array_merge( $out, $container_width_out );
			}

			if ( ! empty( $typography_blocks ) ) {
				$out[] = '';
				$out   = array_merge( $out, $typography_blocks );
			}

			return implode( "\n", $out );
		}

		/**
		 * Generate dynamic .text-{id} CSS classes that consume Elementor's own
		 * CSS custom properties (--e-global-typography-{id}-*). Elementor outputs
		 * those vars on its kit element on every page load, so these classes stay
		 * in sync with the kit automatically — no hardcoded values here.
		 *
		 * Only properties that have a non-empty value in the kit are emitted, so
		 * we never override inherited styles with an undefined var().
		 *
		 * @return string
		 */
		public static function get_globals_dynamic_css() {
			$blocks = array();

			// ---- Typography classes (.text-{id}) ----------------------------
			$typography = self::get_typography();
			if ( ! empty( $typography ) && is_array( $typography ) ) {
				$prop_map = array(
					'font-family'     => 'typography_font_family',
					'font-size'       => 'typography_font_size',
					'font-weight'     => 'typography_font_weight',
					'font-style'      => 'typography_font_style',
					'line-height'     => 'typography_line_height',
					'letter-spacing'  => 'typography_letter_spacing',
					'text-transform'  => 'typography_text_transform',
					'text-decoration' => 'typography_text_decoration',
				);

				foreach ( $typography as $typo ) {
					$id    = isset( $typo['id'] ) ? trim( (string) $typo['id'] ) : '';
					$value = isset( $typo['value'] ) ? (array) $typo['value'] : array();
					if ( '' === $id || empty( $value ) ) {
						continue;
					}

					$prop_lines = array();
					foreach ( $prop_map as $css_prop => $value_key ) {
						$raw = isset( $value[ $value_key ] ) ? $value[ $value_key ] : '';

						if ( is_array( $raw ) || is_object( $raw ) ) {
							$raw  = (array) $raw;
							$size = isset( $raw['size'] ) ? trim( (string) $raw['size'] ) : '';
							if ( '' === $size ) {
								continue;
							}
						} else {
							$raw = trim( (string) $raw );
							if ( '' === $raw ) {
								continue;
							}
						}

						$prop_lines[] = '    ' . $css_prop . ': var(--e-global-typography-' . $id . '-' . $css_prop . ');';
					}

					if ( empty( $prop_lines ) ) {
						continue;
					}

					$blocks[] = '.text-' . $id . ' {';
					foreach ( $prop_lines as $line ) {
						$blocks[] = $line;
					}
					$blocks[] = '}';
				}
			}

			// ---- Container width class (.elementor-global-boxed-width) ------
			$container_widths = self::get_elementor_container_breakpoints_width();
			if ( is_array( $container_widths ) ) {
				$desktop = isset( $container_widths['desktop'] ) ? $container_widths['desktop'] : null;
				$size    = '';
				$unit    = 'px';

				if ( is_array( $desktop ) ) {
					$size = isset( $desktop['size'] ) ? trim( (string) $desktop['size'] ) : '';
					$unit = isset( $desktop['unit'] ) && '' !== trim( (string) $desktop['unit'] )
						? trim( (string) $desktop['unit'] )
						: 'px';
				} elseif ( null !== $desktop && '' !== (string) $desktop ) {
					$size = trim( (string) $desktop );
					$unit = 'px';
				}

				if ( '' !== $size && '0' !== $size ) {
					if ( ! empty( $blocks ) ) {
						$blocks[] = '';
					}
					$blocks[] = '.elementor-global-boxed-width {';
					$blocks[] = '    max-width: ' . $size . $unit . ';';
					$blocks[] = '    margin-left: auto;';
					$blocks[] = '    margin-right: auto;';
					$blocks[] = '}';
				}
			}

			// ---- Atomic global classes CSS (injected when atomic mode is active) ----
			if ( self::is_atomic_enabled() && class_exists( 'Uich_Atomic_Globals' ) ) {
				$atomic     = Uich_Atomic_Globals::get_global_classes_and_variable();
				$typo_props = array(
					'font-family',
					'font-size',
					'font-weight',
					'line-height',
					'letter-spacing',
					'text-transform',
					'text-decoration',
					'font-style',
				);

				// Container width — fixed class name for atomic mode
				$width         = $atomic['width'] ?? array();
				$desktop_width = isset( $width['desktop'] ) ? trim( (string) $width['desktop'] ) : '';
				if ( '' !== $desktop_width ) {
					if ( ! empty( $blocks ) ) {
						$blocks[] = '';
					}
					$blocks[] = '.elementor-atomic-boxed-width {';
					$blocks[] = '    max-width: ' . $desktop_width . ';';
					$blocks[] = '    margin-left: auto;';
					$blocks[] = '    margin-right: auto;';
					$blocks[] = '}';
				}

				// Typography classes using label as class name
				foreach ( $atomic['typography'] ?? array() as $typo ) {
					$id        = isset( $typo['id'] ) ? trim( (string) $typo['id'] ) : '';
					$label     = isset( $typo['label'] ) ? trim( (string) $typo['label'] ) : '';
					$desktop_v = isset( $typo['value']['desktop'] ) && is_array( $typo['value']['desktop'] )
						? $typo['value']['desktop']
						: array();
					if ( '' === $id || empty( $desktop_v ) ) {
						continue;
					}
					$class_name = '' !== $label ? $label : $id;
					$prop_lines = array();
					foreach ( $typo_props as $prop ) {
						$val = isset( $desktop_v[ $prop ] ) ? trim( (string) $desktop_v[ $prop ] ) : '';
						if ( '' === $val ) {
							continue;
						}
						$prop_lines[] = '    ' . $prop . ': ' . $val . ';';
					}
					if ( empty( $prop_lines ) ) {
						continue;
					}
					if ( ! empty( $blocks ) ) {
						$blocks[] = '';
					}
					$blocks[] = '.' . $class_name . ' {';
					foreach ( $prop_lines as $line ) {
						$blocks[] = $line;
					}
					$blocks[] = '}';
				}
			}

			return implode( "\n", $blocks );
		}

		public static function sync_globals( $sync_data ) {

			// Defensive: any of colors / typography / container_width may be
			// omitted by the MCP caller. Without these guards PHP 8 throws
			// "Cannot access property on null" the moment the foreach below
			// runs, which surfaces as a 500 to the AI — the convert pipeline
			// then prints no sync log line at all and silently moves on.
			$sync_color           = isset( $sync_data->colors ) ? $sync_data->colors : array();
			$sync_typography      = isset( $sync_data->typography ) ? $sync_data->typography : array();
			$sync_container_width = isset( $sync_data->container_width ) ? $sync_data->container_width : null;

			if ( ! is_array( $sync_color ) && ! ( $sync_color instanceof \Traversable ) ) {
				$sync_color = array();
			}
			if ( ! is_array( $sync_typography ) && ! ( $sync_typography instanceof \Traversable ) ) {
				$sync_typography = array();
			}

			// set container width
			if ( isset( $sync_container_width ) ) {
				self::set_container_breakpoints_width( $sync_container_width );
			}

			// apply color changes
			foreach ( $sync_color as $color ) {

				$action     = $color->action;
				$color_data = $color->value;

				if ( 'DEL' === $action ) {
					self::delete_global_color( $color_data->id );
				}

				if ( 'ADD' === $action || 'SET' === $action ) {
					self::set_or_create_color( $color_data->id, $color_data->title, $color_data->value );
				}
			}

			// apply typography changes
			foreach ( $sync_typography as $typography ) {

				$action          = $typography->action;
				$typography_data = $typography->value;

				if ( 'DEL' === $action ) {
					self::delete_global_typography( $typography_data->id );
				}

				if ( 'ADD' === $action || 'SET' === $action ) {
					self::set_or_create_typography( $typography_data->id, $typography_data->title, $typography_data->value );
				}
			}

			// Return the saved -> updated data
			return self::get_globals();
		}
	}
}
