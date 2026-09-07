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

if ( ! class_exists( 'Uich_Bricks_Globals' ) ) {

	/**
	 * For handling Global Colors/Typography Operations for bricks-builder
	 */
	class Uich_Bricks_Globals {

		const TYPO_CLASS_CATEGORY_ID          = 'UICH_TYPO';
		const PADDING_CLASS_CATEGORY_ID       = 'UICH_PADDING';
		const SHADOW_CLASS_CATEGORY_ID        = 'UICH_SHADOW';
		const BORDER_CLASS_CATEGORY_ID        = 'UICH_BORDER';
		const BORDER_RADIUS_CLASS_CATEGORY_ID = 'UICH_BORDER_RADIUS';
		const GAP_CLASS_CATEGORY_ID           = 'UICH_GAP';
		const DEFAULT_CONTAINER_WIDTH         = '1100px';
		const DEFAULT_CONTAINER_TABLET_WIDTH  = '85%';
		const DEFAULT_CONTAINER_MOBILE_WIDTH  = '90%';
		const UICH_THEME_ID                   = 'uichemy_theme';
		const UICH_PALETTE_NAME               = 'UiChemy Palette';

		// Helper method to safely retrieve and ensure an option is an array.
		private static function get_option_as_array( $optionName ) {
			$option = get_option( $optionName, array() );
			return is_array( $option ) ? $option : array();
		}

		public static function object_to_array( $obj ) {
			if ( is_object( $obj ) || is_array( $obj ) ) {
				$ret = (array) $obj;
				foreach ( $ret as &$item ) {
					$item = self::object_to_array( $item );
				}
				return $ret;
			}
			return $obj;
		}

		// Check if a category exists in the class categories.
		private static function category_exists( $categories, $categoryId ) {
			foreach ( $categories as $category ) {
				if ( ( $category['id'] ?? '' ) === $categoryId ) {
					return true;
				}
			}
			return false;
		}

		// Initialize and retrieve the Uichemy container width.
		public static function get_or_create_container_width() {
			$theme_styles_array = self::get_option_as_array( 'bricks_theme_styles' );

			// Check for existing Uichemy Theme
			foreach ( $theme_styles_array as $key => $style ) {
				if ( self::UICH_THEME_ID === $key ) {
					$desktop          = sanitize_text_field( $style['settings']['container']['width'] ?? self::DEFAULT_CONTAINER_WIDTH );
					$tablet_portrait  = isset( $style['settings']['container']['width:tablet_portrait'] ) ? sanitize_text_field( $style['settings']['container']['width:tablet_portrait'] ) : null;
					$mobile_landscape = isset( $style['settings']['container']['width:mobile_landscape'] ) ? sanitize_text_field( $style['settings']['container']['width:mobile_landscape'] ) : null;
					$mobile_portrait  = isset( $style['settings']['container']['width:mobile_portrait'] ) ? sanitize_text_field( $style['settings']['container']['width:mobile_portrait'] ) : null;

					// Reindex: Remove the current theme and append it to the end
					$uichemy_theme_style = $style;
					unset( $theme_styles_array[ $key ] );
					$theme_styles_array[ $key ] = $uichemy_theme_style;

					update_option( 'bricks_theme_styles', $theme_styles_array );

					$width_data = array( 'desktop' => $desktop );

					if ( null !== $tablet_portrait ) {
						$width_data['tablet_portrait'] = $tablet_portrait;
					}
					if ( null !== $mobile_landscape ) {
						$width_data['mobile_landscape'] = $mobile_landscape;
					}
					if ( null !== $mobile_portrait ) {
						$width_data['mobile_portrait'] = $mobile_portrait;
					}

					return (object) array(
						'width'   => (object) $width_data,
						'themeID' => $key,
					);
				}
			}

			// Check for theme with 'any' condition
			foreach ( array_reverse( $theme_styles_array, true ) as $key => $style ) {
				if ( isset( $style['settings'] )
					&& isset( $style['settings']['conditions'] )
					&& isset( $style['settings']['conditions']['conditions'] )
					&& isset( $style['settings']['conditions']['conditions'][0] )
					&& isset( $style['settings']['conditions']['conditions'][0]['main'] )
					&& 'any' === $style['settings']['conditions']['conditions'][0]['main']
				) {
					$desktop          = sanitize_text_field( $style['settings']['container']['width'] ?? self::DEFAULT_CONTAINER_WIDTH );
					$tablet_portrait  = isset( $style['settings']['container']['width:tablet_portrait'] ) ? sanitize_text_field( $style['settings']['container']['width:tablet_portrait'] ) : null;
					$mobile_landscape = isset( $style['settings']['container']['width:mobile_landscape'] ) ? sanitize_text_field( $style['settings']['container']['width:mobile_landscape'] ) : null;
					$mobile_portrait  = isset( $style['settings']['container']['width:mobile_portrait'] ) ? sanitize_text_field( $style['settings']['container']['width:mobile_portrait'] ) : null;

					$width_data = array( 'desktop' => $desktop );

					if ( null !== $tablet_portrait ) {
						$width_data['tablet_portrait'] = $tablet_portrait;
					}
					if ( null !== $mobile_landscape ) {
						$width_data['mobile_landscape'] = $mobile_landscape;
					}
					if ( null !== $mobile_portrait ) {
						$width_data['mobile_portrait'] = $mobile_portrait;
					}

					return (object) array(
						'width'   => (object) $width_data,
						'themeID' => $key ?? '',
					);
				}
			}

			// Create new Uichemy Theme if none found
			$themeStyles[ self::UICH_THEME_ID ] = array(
				'label'    => 'UICHEMY THEME',
				'settings' => array(
					'_custom'    => true,
					'conditions' => array(
						'conditions' => array(
							array(
								'id'   => 'uichem',
								'main' => 'any',
							),
						),
					),
					'container'  => array(
						'width'                 => self::DEFAULT_CONTAINER_WIDTH,
						'width:tablet_portrait' => self::DEFAULT_CONTAINER_TABLET_WIDTH,
						'width:mobile_portrait' => self::DEFAULT_CONTAINER_MOBILE_WIDTH,
					),
				),
			);

			update_option( 'bricks_theme_styles', $themeStyles );

			return (object) array(
				'width'   => array(
					'desktop'         => self::DEFAULT_CONTAINER_WIDTH,
					'tablet_portrait' => self::DEFAULT_CONTAINER_TABLET_WIDTH,
					'mobile_portrait' => self::DEFAULT_CONTAINER_MOBILE_WIDTH,
				),
				'themeID' => self::UICH_THEME_ID,
			);
		}

		// Retrieve or create the Uichemy color palette.
		public static function get_or_create_uich_color_palette() {
			$color_palettes = self::get_option_as_array( 'bricks_color_palette' );

			// Search for the Uichemy palette (case-insensitive for robustness)
			foreach ( $color_palettes as $palette ) {
				if ( isset( $palette['name'] ) && isset( $palette['colors'] ) && strcasecmp( $palette['name'], self::UICH_PALETTE_NAME ) === 0 ) {
					return $palette['colors'];
				}
			}

			// Create new Uichemy palette
			$uichemy_palette = array(
				'id'     => 'uichemy_palette_' . uniqid(), // Unique ID to avoid conflicts
				'name'   => self::UICH_PALETTE_NAME,
				'colors' => array(),
			);

			$color_palettes[] = $uichemy_palette;
			update_option( 'bricks_color_palette', $color_palettes );

			return $uichemy_palette['colors'];
		}

		// Retrieve Uichemy typography classes.
		public static function get_uich_typography_classes() {
			$uichemy_category_id = self::TYPO_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );
			$class_categories    = self::get_option_as_array( 'bricks_global_classes_categories' );

			// Ensure Uichemy typography category exists
			if ( ! self::category_exists( $class_categories, $uichemy_category_id ) ) {
				$class_categories[] = array(
					'id'   => $uichemy_category_id,
					'name' => 'UiChemy Typography',
				);
				update_option( 'bricks_global_classes_categories', $class_categories );
			}

			$typography_classes = array();
			foreach ( $global_classes as $class ) {
				if ( isset( $class['category'] ) && $class['category'] === $uichemy_category_id && isset( $class['settings'] ) ) {
					$value = array();

					if ( isset( $class['settings']['_typography'] ) ) {
						$value['_typography'] = $class['settings']['_typography'];
					}
					if ( isset( $class['settings']['_typography:tablet_portrait'] ) ) {
						$value['_typography:tablet_portrait'] = $class['settings']['_typography:tablet_portrait'];
					}
					if ( isset( $class['settings']['_typography:mobile_portrait'] ) ) {
						$value['_typography:mobile_portrait'] = $class['settings']['_typography:mobile_portrait'];
					}

					$typography_classes[] = array(
						'id'    => sanitize_text_field( $class['id'] ?? '' ),
						'name'  => sanitize_text_field( $class['name'] ?? '' ),
						'value' => $value,
					);
				}
			}

			return $typography_classes;
		}

		// Retrieve Uichemy padding classes.
		public static function get_uich_padding_classes() {
			$uichemy_category_id = self::PADDING_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );
			$class_categories    = self::get_option_as_array( 'bricks_global_classes_categories' );

			// Ensure Uichemy padding category exists
			if ( ! self::category_exists( $class_categories, $uichemy_category_id ) ) {
				$class_categories[] = array(
					'id'   => $uichemy_category_id,
					'name' => 'UiChemy Padding',
				);
				update_option( 'bricks_global_classes_categories', $class_categories );
			}

			// Collect padding classes for the Uichemy category
			$padding_classes = array();
			foreach ( $global_classes as $class ) {
				if ( isset( $class['category'] ) && $class['category'] === $uichemy_category_id && isset( $class['settings'] ) ) {
					$value = array();

					if ( isset( $class['settings']['_padding'] ) ) {
						$value['_padding'] = $class['settings']['_padding'];
					}
					if ( isset( $class['settings']['_padding:tablet_portrait'] ) ) {
						$value['_padding:tablet_portrait'] = $class['settings']['_padding:tablet_portrait'];
					}
					if ( isset( $class['settings']['_padding:mobile_landscape'] ) ) {
						$value['_padding:mobile_landscape'] = $class['settings']['_padding:mobile_landscape'];
					}
					if ( isset( $class['settings']['_padding:mobile_portrait'] ) ) {
						$value['_padding:mobile_portrait'] = $class['settings']['_padding:mobile_portrait'];
					}

					$padding_classes[] = array(
						'id'    => sanitize_text_field( $class['id'] ?? '' ),
						'name'  => sanitize_text_field( $class['name'] ?? '' ),
						'value' => $value,
					);
				}
			}

			return $padding_classes;
		}

		public static function get_uich_shadow_classes() {

			$uichemy_category_id = self::SHADOW_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );
			$class_categories    = self::get_option_as_array( 'bricks_global_classes_categories' );

			// Ensure category exists
			if ( ! self::category_exists( $class_categories, $uichemy_category_id ) ) {
				$class_categories[] = array(
					'id'   => $uichemy_category_id,
					'name' => 'UiChemy Shadow',
				);
				update_option( 'bricks_global_classes_categories', $class_categories );
			}

			$shadow_classes = array();

			foreach ( $global_classes as $class ) {

				if (
					! isset( $class['category'] ) ||
					$class['category'] !== $uichemy_category_id ||
					! isset( $class['settings']['_boxShadow'] )
				) {
					continue;
				}

				$shadow = $class['settings']['_boxShadow'];

				// Convert values to numbers
				$converted = array(
					'offsetX' => isset( $shadow['values']['offsetX'] ) ? floatval( $shadow['values']['offsetX'] ) : 0,
					'offsetY' => isset( $shadow['values']['offsetY'] ) ? floatval( $shadow['values']['offsetY'] ) : 0,
					'blur'    => isset( $shadow['values']['blur'] ) ? floatval( $shadow['values']['blur'] ) : 0,
					'spread'  => isset( $shadow['values']['spread'] ) ? floatval( $shadow['values']['spread'] ) : 0,

					// Color stays string/object
					'color'   => isset( $shadow['color'] ) ? $shadow['color'] : array( 'hex' => '#000000' ),
				);

				// Optional inset (boolean)
				if ( isset( $shadow['inset'] ) ) {
					$converted['inset'] = 1;
				}

				$shadow_classes[] = array(
					'id'    => sanitize_text_field( $class['id'] ),
					'name'  => sanitize_text_field( $class['name'] ),
					'value' => $converted,
				);
			}

			return $shadow_classes;
		}

		public static function get_uich_border_classes() {

			$uichemy_category_id = self::BORDER_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );
			$class_categories    = self::get_option_as_array( 'bricks_global_classes_categories' );

			// Ensure Uichemy Border category exists
			if ( ! self::category_exists( $class_categories, $uichemy_category_id ) ) {
				$class_categories[] = array(
					'id'   => $uichemy_category_id,
					'name' => 'UiChemy Border',
				);
				update_option( 'bricks_global_classes_categories', $class_categories );
			}

			$border_classes = array();

			foreach ( $global_classes as $class ) {

				if (
					isset( $class['category'] ) &&
					$class['category'] === $uichemy_category_id &&
					isset( $class['settings']['_border'] )
				) {
					$border = $class['settings']['_border'];
					$value  = array();

					// Width: convert strings → number
					if ( isset( $border['width'] ) ) {
						$value['width'] = array(
							'top'    => isset( $border['width']['top'] ) ? floatval( $border['width']['top'] ) : 0,
							'right'  => isset( $border['width']['right'] ) ? floatval( $border['width']['right'] ) : 0,
							'bottom' => isset( $border['width']['bottom'] ) ? floatval( $border['width']['bottom'] ) : 0,
							'left'   => isset( $border['width']['left'] ) ? floatval( $border['width']['left'] ) : 0,
						);
					}

					// Style = string
					if ( isset( $border['style'] ) ) {
						$value['style'] = $border['style'];
					}

					// Color = object
					if ( isset( $border['color'] ) ) {
						$value['color'] = $border['color'];
					}

					// Final return format
					$border_classes[] = array(
						'id'    => sanitize_text_field( $class['id'] ?? '' ),
						'name'  => sanitize_text_field( $class['name'] ?? '' ),
						'value' => $value,
					);
				}
			}

			return $border_classes;
		}

		// get the border radius classes
		public static function get_uich_border_radius_classes() {
			$uichemy_category_id = self::BORDER_RADIUS_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );
			$class_categories    = self::get_option_as_array( 'bricks_global_classes_categories' );

			// Ensure Uichemy Border category exists
			if ( ! self::category_exists( $class_categories, $uichemy_category_id ) ) {
				$class_categories[] = array(
					'id'   => $uichemy_category_id,
					'name' => 'UiChemy Border Radius',
				);
				update_option( 'bricks_global_classes_categories', $class_categories );
			}

			$border_radius_classes = array();

			foreach ( $global_classes as $class ) {

				if (
					isset( $class['category'] ) &&
					$class['category'] === $uichemy_category_id &&
					isset( $class['settings']['_border'] )
				) {
					$border = $class['settings']['_border'];
					$value  = array();

					// Radius: convert strings → number
					if ( isset( $border['radius'] ) ) {
						$value = array(
							'topLeft'     => isset( $border['radius']['top'] ) ? floatval( $border['radius']['top'] ) : 0,
							'topRight'    => isset( $border['radius']['right'] ) ? floatval( $border['radius']['right'] ) : 0,
							'bottomRight' => isset( $border['radius']['bottom'] ) ? floatval( $border['radius']['bottom'] ) : 0,
							'bottomLeft'  => isset( $border['radius']['left'] ) ? floatval( $border['radius']['left'] ) : 0,
						);
					}

					// Final return format
					$border_radius_classes[] = array(
						'id'    => sanitize_text_field( $class['id'] ?? '' ),
						'name'  => sanitize_text_field( $class['name'] ?? '' ),
						'value' => $value,
					);
				}
			}

			return $border_radius_classes;
		}

		public static function get_uich_gap_classes() {

			$uichemy_category_id = self::GAP_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );
			$class_categories    = self::get_option_as_array( 'bricks_global_classes_categories' );

			// Ensure category exists
			if ( ! self::category_exists( $class_categories, $uichemy_category_id ) ) {
				$class_categories[] = array(
					'id'   => $uichemy_category_id,
					'name' => 'UiChemy Gap',
				);
				update_option( 'bricks_global_classes_categories', $class_categories );
			}

			$gap_classes = array();

			foreach ( $global_classes as $class ) {

				if (
					isset( $class['category'] ) &&
					$class['category'] === $uichemy_category_id &&
					isset( $class['settings'] )
				) {
					$settings = $class['settings'];

					$value = array(
						'columnGap' => isset( $settings['_columnGap'] ) ? floatval( $settings['_columnGap'] ) : 0,
						'rowGap'    => isset( $settings['_rowGap'] ) ? floatval( $settings['_rowGap'] ) : 0,
					);

					$gap_classes[] = array(
						'id'    => sanitize_text_field( $class['id'] ?? '' ),
						'name'  => sanitize_text_field( $class['name'] ?? '' ),
						'value' => array( 'desktop' => $value ),
					);
				}
			}

			return $gap_classes;
		}

		// Set the Uichemy container width.
		public static function set_uich_container_width( $container_width ) {
			$theme_id           = self::get_or_create_container_width()->themeID;
			$theme_styles_array = self::get_option_as_array( 'bricks_theme_styles' );

			if ( empty( $theme_styles_array ) ) {
				return false;
			}

			// Set desktop width (required)
			$theme_styles_array[ $theme_id ]['settings']['container']['width'] = sanitize_text_field( $container_width->desktop );

			// Handle tablet_portrait
			if ( isset( $container_width->tablet_portrait ) && ! empty( $container_width->tablet_portrait ) ) {
				$theme_styles_array[ $theme_id ]['settings']['container']['width:tablet_portrait'] = sanitize_text_field( $container_width->tablet_portrait );
			} else {
				unset( $theme_styles_array[ $theme_id ]['settings']['container']['width:tablet_portrait'] );
			}

			// Handle mobile_landscape
			if ( isset( $container_width->mobile_landscape ) && ! empty( $container_width->mobile_landscape ) ) {
				$theme_styles_array[ $theme_id ]['settings']['container']['width:mobile_landscape'] = sanitize_text_field( $container_width->mobile_landscape );
			} else {
				unset( $theme_styles_array[ $theme_id ]['settings']['container']['width:mobile_landscape'] );
			}

			// Handle mobile_portrait
			if ( isset( $container_width->mobile_portrait ) && ! empty( $container_width->mobile_portrait ) ) {
				$theme_styles_array[ $theme_id ]['settings']['container']['width:mobile_portrait'] = sanitize_text_field( $container_width->mobile_portrait );
			} else {
				unset( $theme_styles_array[ $theme_id ]['settings']['container']['width:mobile_portrait'] );
			}

			return update_option( 'bricks_theme_styles', $theme_styles_array );
		}

		// Sync the Uichemy color palette with updates.
		public static function sync_uich_color_palette( $color_updates ) {
			$uichemy_palette = self::get_or_create_uich_color_palette();
			$color_palettes  = self::get_option_as_array( 'bricks_color_palette' );
			$palette_key     = null;

			function extractHexCode( $hex ) {
				// Remove any whitespace
				$hex = trim( $hex );

				// Check if hex code is 9 characters (# + 8 digits for RGBA)
				if ( strlen( $hex ) === 9 ) {
					// Return only first 7 characters (# + 6 digits)
					return sanitize_hex_color( substr( $hex, 0, 7 ) );
				}

				// Return original hex if not RGBA
				return sanitize_hex_color( $hex );
			}

			foreach ( $color_palettes as $key => $palette ) {
				if ( isset( $palette['name'] ) && strcasecmp( $palette['name'], self::UICH_PALETTE_NAME ) === 0 ) {

					$palette_key = $key;
					break;
				}
			}

			if ( null === $palette_key ) {
				$color_palettes[] = $uichemy_palette;
				$palette_key      = array_key_last( $color_palettes );
			}

			$color_palettes[ $palette_key ]['colors'] = $color_palettes[ $palette_key ]['colors'] ?? array();

			foreach ( $color_updates as $update ) {
				if ( ! is_object( $update ) || ! isset( $update->action, $update->id ) ) {
					continue;
				}

				$action = sanitize_text_field( $update->action );
				$id     = sanitize_text_field( $update->id );

				if ( 'DEL' === $action ) {
					$color_palettes[ $palette_key ]['colors'] = array_values(
						array_filter(
							$color_palettes[ $palette_key ]['colors'],
							fn( $color ) => ! isset( $color['id'] ) || $color['id'] !== $id
						)
					);
				} elseif ( 'SET' === $action || 'ADD' === $action ) {

					if ( ! isset( $update->hex ) ) {
						continue;
					}

					$hex  = extractHexCode( $update->hex );
					$name = isset( $update->name ) ? sanitize_text_field( $update->name ) : '';
					$rgb  = isset( $update->rgb ) ? $update->rgb : '';

					$found = false;
					foreach ( $color_palettes[ $palette_key ]['colors'] as &$color ) {
						if ( isset( $color['id'] ) && $color['id'] === $id ) {
							$color['hex']  = $hex;
							$color['name'] = $name;
							if ( ! empty( $rgb ) ) {
								$color['rgb'] = $rgb;
							}
							$found = true;
							break;
						}
					}

					if ( ! $found ) {
						$new_color = array(
							'id'   => $id,
							'hex'  => $hex,
							'name' => $name,
						);
						if ( ! empty( $rgb ) ) {
							$new_color['rgb'] = $rgb;
						}
						$color_palettes[ $palette_key ]['colors'][] = $new_color;
					}
				}
			}

			return update_option( 'bricks_color_palette', $color_palettes );
		}

		// Sync Uichemy typography classes with updates.
		public static function sync_uich_typography_classes( $typography_updates ) {
			self::get_uich_typography_classes();
			$uichemy_category_id = self::TYPO_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );

			$convertIntoArray = self::object_to_array( $typography_updates );

			foreach ( $convertIntoArray as $update ) {

				if ( ! isset( $update['action'], $update['value']['id'] ) ) {
					continue;
				}

				$action = sanitize_text_field( $update['action'] );
				$id     = sanitize_text_field( $update['value']['id'] );

				if ( 'DEL' === $action ) {
					$global_classes = array_values(
						array_filter(
							$global_classes,
							fn( $class ) => ! isset( $class['id'], $class['category'] ) || $class['id'] !== $id || $class['category'] !== $uichemy_category_id
						)
					);
				} elseif ( 'SET' === $action || 'ADD' === $action ) {
					if ( ! isset( $update['value']['value'] ) ) {
						continue;
					}

					// Sanitize name and typography settings
					$typography = $update['value']['value'];
					$name       = sanitize_text_field( $update['value']['name'] ?? '' );

					$found = false;
					foreach ( $global_classes as &$class ) {
						if ( isset( $class['id'], $class['category'] ) && $class['id'] === $id && $class['category'] === $uichemy_category_id ) {
							// Update existing class
							$class['settings'] = $typography;
							$class['name']     = $name;
							$found             = true;
							break;
						}
					}

					if ( ! $found ) {
						$global_classes[] = array(
							'id'       => $id,
							'category' => $uichemy_category_id,
							'settings' => $typography,
							'name'     => $name,
						);
					}
				}
			}

			return update_option( 'bricks_global_classes', $global_classes );
		}

		public static function sync_uich_padding_classes( $padding_updates ) {
			self::get_uich_padding_classes();
			$uichemy_category_id = self::PADDING_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );

			$convertIntoArray = self::object_to_array( $padding_updates );

			foreach ( $convertIntoArray as $update ) {
				if ( ! isset( $update['action'], $update['value']['id'] ) ) {
					continue;
				}

				$action = sanitize_text_field( $update['action'] );
				$id     = sanitize_text_field( $update['value']['id'] );

				if ( 'DEL' === $action ) {
					$global_classes = array_values(
						array_filter(
							$global_classes,
							fn( $class ) => ! isset( $class['id'], $class['category'] ) || $class['id'] !== $id || $class['category'] !== $uichemy_category_id
						)
					);
				} elseif ( 'SET' === $action || 'ADD' === $action ) {
					if ( ! isset( $update['value']['value'] ) ) {
						continue;
					}

					// Sanitize name and typography settings
					$padding = $update['value']['value'];
					$name    = sanitize_text_field( $update['value']['name'] ?? '' );

					$found = false;
					foreach ( $global_classes as &$class ) {
						if ( isset( $class['id'], $class['category'] ) && $class['id'] === $id && $class['category'] === $uichemy_category_id ) {
							// Update existing class
							$class['settings'] = $padding;
							$class['name']     = $name;
							$found             = true;
							break;
						}
					}

					if ( ! $found ) {
						$global_classes[] = array(
							'id'       => $id,
							'category' => $uichemy_category_id,
							'settings' => $padding,
							'name'     => $name,
						);
					}
				}
			}

			return update_option( 'bricks_global_classes', $global_classes );
		}

		// Sync shadow classes
		public static function sync_uich_shadow_classes( $shadow_updates ) {
			self::get_uich_shadow_classes();
			$uichemy_category_id = self::SHADOW_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );

			$convertIntoArray = self::object_to_array( $shadow_updates );

			foreach ( $convertIntoArray as $update ) {

				if ( ! isset( $update['action'], $update['value']['id'] ) ) {
					continue;
				}

				$action = sanitize_text_field( $update['action'] );
				$id     = sanitize_text_field( $update['value']['id'] );
				$name   = sanitize_text_field( $update['value']['name'] ?? '' );

				// DELETE
				if ( 'DEL' === $action ) {
					$global_classes = array_values(
						array_filter(
							$global_classes,
							fn( $class ) => ! isset( $class['id'], $class['category'] ) ||
										$class['id'] !== $id ||
										$class['category'] !== $uichemy_category_id
						)
					);
					continue;
				}

				// ADD or SET
				if ( ( 'SET' === $action || 'ADD' === $action ) && isset( $update['value']['value'] ) ) {

					$incoming = $update['value']['value'];

					// Convert FE → Bricks string values
					$converted_shadow = array(
						'values' => array(
							'offsetX' => isset( $incoming['offsetX'] ) ? strval( $incoming['offsetX'] ) : '0',
							'offsetY' => isset( $incoming['offsetY'] ) ? strval( $incoming['offsetY'] ) : '0',
							'blur'    => isset( $incoming['blur'] ) ? strval( $incoming['blur'] ) : '0',
							'spread'  => isset( $incoming['spread'] ) ? strval( $incoming['spread'] ) : '0',
						),
						'color'  => $incoming['color'] ?? array( 'hex' => '#000000' ),
					);

					if ( isset( $incoming['inset'] ) && 1 === $incoming['inset'] ) {
						$converted_shadow['inset'] = 'true';
					}

					// UPDATE
					$found = false;
					foreach ( $global_classes as &$class ) {
						if ( isset( $class['id'], $class['category'] ) &&
						$class['id'] === $id &&
						$class['category'] === $uichemy_category_id ) {
							$class['settings'] = array( '_boxShadow' => $converted_shadow );
							$class['name']     = $name;
							$found             = true;
							break;
						}
					}

					// ADD
					if ( ! $found ) {
						$global_classes[] = array(
							'id'       => $id,
							'category' => $uichemy_category_id,
							'settings' => array( '_boxShadow' => $converted_shadow ),
							'name'     => $name,
						);
					}
				}
			}

			return update_option( 'bricks_global_classes', $global_classes );
		}


		// Sync Border classes
		public static function sync_uich_border_classes( $border_updates ) {
			self::get_uich_border_classes();
			$uichemy_category_id = self::BORDER_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );
			$color_palettes      = self::get_option_as_array( 'bricks_color_palette' );

			$convertIntoArray = self::object_to_array( $border_updates );

			foreach ( $convertIntoArray as $update ) {

				if ( ! isset( $update['action'], $update['value']['id'] ) ) {
					continue;
				}

				$action = sanitize_text_field( $update['action'] );
				$id     = sanitize_text_field( $update['value']['id'] );
				$name   = sanitize_text_field( $update['value']['name'] ?? '' );

				// DELETE
				if ( 'DEL' === $action ) {
					$global_classes = array_values(
						array_filter(
							$global_classes,
							fn( $class ) => ! isset( $class['id'], $class['category'] ) ||
										$class['id'] !== $id ||
										$class['category'] !== $uichemy_category_id
						)
					);
					continue;
				}

				// ADD or SET
				if ( ( 'SET' === $action || 'ADD' === $action ) && isset( $update['value']['value'] ) ) {

					$incoming = $update['value']['value']; // FE border JSON

					// For applying global palette in border class
					foreach ( $color_palettes as $palette ) {
						if ( isset( $palette['colors'] ) ) {
							foreach ( $palette['colors'] as $color ) {
								if ( isset( $color['hex'] ) && isset( $incoming['color']['hex'] )
									&& $color['hex'] == $incoming['color']['hex']
								) {
									$incoming['color'] = array(
										'id'   => $color['id'],
										'hex'  => $color['hex'],
										'name' => $color['name'],
									);
								}
							}
						}
					}

					// Convert FE → Bricks string format
					$converted_border = array(
						'_border' => array(
							'width' => array(
								'top'    => isset( $incoming['width']['top'] ) ? strval( $incoming['width']['top'] ) : '0',
								'right'  => isset( $incoming['width']['right'] ) ? strval( $incoming['width']['right'] ) : '0',
								'bottom' => isset( $incoming['width']['bottom'] ) ? strval( $incoming['width']['bottom'] ) : '0',
								'left'   => isset( $incoming['width']['left'] ) ? strval( $incoming['width']['left'] ) : '0',
							),
							'style' => $incoming['style'] ?? 'solid',

							'color' => $incoming['color'] ?? array( 'hex' => '#000000' ),
						),
					);

					// UPDATE existing
					$found = false;
					foreach ( $global_classes as &$class ) {
						if ( isset( $class['id'], $class['category'] ) &&
						$class['id'] === $id &&
						$class['category'] === $uichemy_category_id ) {
							$class['settings'] = $converted_border;
							$class['name']     = $name;
							$found             = true;
							break;
						}
					}

					// ADD new
					if ( ! $found ) {
						$global_classes[] = array(
							'id'       => $id,
							'category' => $uichemy_category_id,
							'settings' => $converted_border,
							'name'     => $name,
						);
					}
				}
			}

			return update_option( 'bricks_global_classes', $global_classes );
		}

		// Sync Border radius classes
		public static function sync_uich_border_radius_classes( $border_updates ) {
			self::get_uich_border_classes();
			$uichemy_category_id = self::BORDER_RADIUS_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );

			$convertIntoArray = self::object_to_array( $border_updates );

			foreach ( $convertIntoArray as $update ) {

				if ( ! isset( $update['action'], $update['value']['id'] ) ) {
					continue;
				}

				$action = sanitize_text_field( $update['action'] );
				$id     = sanitize_text_field( $update['value']['id'] );
				$name   = sanitize_text_field( $update['value']['name'] ?? '' );

				// DELETE
				if ( 'DEL' === $action ) {
					$global_classes = array_values(
						array_filter(
							$global_classes,
							fn( $class ) => ! isset( $class['id'], $class['category'] ) ||
										$class['id'] !== $id ||
										$class['category'] !== $uichemy_category_id
						)
					);
					continue;
				}

				// ADD or SET
				if ( ( 'SET' === $action || 'ADD' === $action ) && isset( $update['value']['value'] ) ) {

					$incoming = $update['value']['value']; // FE border JSON

					// Convert FE → Bricks string format
					$converted_border = array(
						'_border' => array(
							'radius' => array(
								'top'    => isset( $incoming['topLeft'] ) ? strval( $incoming['topLeft'] ) : '0',
								'right'  => isset( $incoming['topRight'] ) ? strval( $incoming['topRight'] ) : '0',
								'bottom' => isset( $incoming['bottomRight'] ) ? strval( $incoming['bottomRight'] ) : '0',
								'left'   => isset( $incoming['bottomLeft'] ) ? strval( $incoming['bottomLeft'] ) : '0',
							),
						),
					);

					// UPDATE existing
					$found = false;
					foreach ( $global_classes as &$class ) {
						if ( isset( $class['id'], $class['category'] ) &&
						$class['id'] === $id &&
						$class['category'] === $uichemy_category_id ) {
							$class['settings'] = $converted_border;
							$class['name']     = $name;
							$found             = true;
							break;
						}
					}

					// ADD new
					if ( ! $found ) {
						$global_classes[] = array(
							'id'       => $id,
							'category' => $uichemy_category_id,
							'settings' => $converted_border,
							'name'     => $name,
						);
					}
				}
			}

			return update_option( 'bricks_global_classes', $global_classes );
		}


		// Sync Gap classes
		public static function sync_uich_gap_classes( $gap_updates ) {
			self::get_uich_gap_classes();
			$uichemy_category_id = self::GAP_CLASS_CATEGORY_ID;
			$global_classes      = self::get_option_as_array( 'bricks_global_classes' );

			$convertIntoArray = self::object_to_array( $gap_updates );

			foreach ( $convertIntoArray as $update ) {

				if ( ! isset( $update['action'], $update['value']['id'] ) ) {
					continue;
				}

				$action = sanitize_text_field( $update['action'] );
				$id     = sanitize_text_field( $update['value']['id'] );
				$name   = sanitize_text_field( $update['value']['name'] ?? '' );

				// DELETE
				if ( 'DEL' === $action ) {
					$global_classes = array_values(
						array_filter(
							$global_classes,
							fn( $class ) => ! isset( $class['id'], $class['category'] ) ||
										$class['id'] !== $id ||
										$class['category'] !== $uichemy_category_id
						)
					);
					continue;
				}

				// ADD or SET
				if ( ( 'SET' === $action || 'ADD' === $action ) && isset( $update['value']['value'] ) ) {

					$incoming = $update['value']['value'];

					$converted_gap = array();

					// Define the gap properties to process
					$gap_properties = array( 'columnGap', 'rowGap' );

					// Get all available breakpoints from incoming data
					$breakpoints = array_keys( $incoming );

					// Process each gap property for each breakpoint
					foreach ( $gap_properties as $property ) {
						foreach ( $breakpoints as $breakpoint ) {
							if ( isset( $incoming[ $breakpoint ][ $property ] ) ) {
								// Create the key based on property and breakpoint
								$key = ( 'desktop' === $breakpoint )
									? '_' . $property
									: '_' . $property . ':' . $breakpoint;

								$converted_gap[ $key ] = strval( $incoming[ $breakpoint ][ $property ] );
							}
						}
					}

					$found = false;

					foreach ( $global_classes as &$class ) {
						if ( isset( $class['id'], $class['category'] ) &&
							$class['id'] === $id &&
							$class['category'] === $uichemy_category_id ) {
							// Update existing
							$class['settings'] = $converted_gap;
							$class['name']     = $name;
							$found             = true;
							break;
						}
					}

					// ADD new
					if ( ! $found ) {
						$global_classes[] = array(
							'id'       => $id,
							'category' => $uichemy_category_id,
							'settings' => $converted_gap,
							'name'     => $name,
						);
					}
				}
			}

			return update_option( 'bricks_global_classes', $global_classes );
		}

		// Get current active globals
		public static function get_uich_bricks_globals() {
			return array(
				'width'         => self::get_or_create_container_width()->width,
				'colors'        => self::get_or_create_uich_color_palette(),
				'typography'    => self::get_uich_typography_classes(),
				'padding'       => self::get_uich_padding_classes(),
				'shadow'        => self::get_uich_shadow_classes(),
				'border'        => self::get_uich_border_classes(),
				'border_radius' => self::get_uich_border_radius_classes(),
				'gap'           => self::get_uich_gap_classes(),
			);
		}

		// Sync all Uichemy globals (width, colors, typography, padding).
		public static function sync_uich_globals( $global_data ) {

			if ( isset( $global_data->width ) ) {
				self::set_uich_container_width( $global_data->width );
			}

			if ( ! empty( $global_data->colors ) && is_array( $global_data->colors ) ) {
				self::sync_uich_color_palette( $global_data->colors );
			}

			if ( ! empty( $global_data->typography ) && is_array( $global_data->typography ) ) {
				self::sync_uich_typography_classes( $global_data->typography );
			}

			if ( ! empty( $global_data->padding ) && is_array( $global_data->padding ) ) {
				self::sync_uich_padding_classes( $global_data->padding );
			}

			if ( ! empty( $global_data->shadow ) && is_array( $global_data->shadow ) ) {
				self::sync_uich_shadow_classes( $global_data->shadow );
			}

			if ( ! empty( $global_data->border ) && is_array( $global_data->border ) ) {
				self::sync_uich_border_classes( $global_data->border );
			}

			if ( ! empty( $global_data->border_radius ) && is_array( $global_data->border_radius ) ) {
				self::sync_uich_border_radius_classes( $global_data->border_radius );
			}

			if ( ! empty( $global_data->gap ) && is_array( $global_data->gap ) ) {
				self::sync_uich_gap_classes( $global_data->gap );
			}

			return self::get_uich_bricks_globals();
		}
	}
}
