<?php
/**
 * File for handling Globals Operations
 *
 * @link       https://posimyth.com/
 * @since      1.0.0
 *
 * @package    UiChemy
 */

/**
 * Exit if accessed directly.
 * */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Atomic_Globals' ) ) {

	/**
	 * For handling Atomic Globals
	 */
	class UiChemy_Atomic_Globals {
		// ============================================================
		// CORE UTILITIES ATOMIC GLOBALS
		// ============================================================

		const CONTEXT_FRONTEND = 'frontend';
		const CONTEXT_PREVIEW  = 'preview';

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

		/** Get active kit's global classes as array — reads from Elementor's CPT-based repository. */
		private static function get_global_classes_array(): array {
			if ( ! class_exists( '\Elementor\Modules\GlobalClasses\Global_Classes_Repository' ) ) {
				return array(
					'items' => array(),
					'order' => array(),
				);
			}

			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit();
			if ( ! $kit ) {
				return array(
					'items' => array(),
					'order' => array(),
				);
			}

			$repository = \Elementor\Modules\GlobalClasses\Global_Classes_Repository::make( $kit );
			$order      = $repository->get_order();
			$items      = array();

			if ( ! empty( $order ) ) {
				$repository->each_item(
					function ( array $class_data ) use ( &$items ) {
						$items[ $class_data['id'] ] = $class_data;
					},
					true
				);
			}

			return array(
				'items' => $items,
				'order' => $order,
			);
		}

		/**
		 * Save global classes via Elementor's CPT-based repository so the editor picks them up.
		 * Repository's put() fires elementor/global_classes/update internally — no need to re-fire.
		 *
		 * put() only writes the FRONTEND context: it commits the class posts, the
		 * frontend order and labels, and clears stale preview data — but it never
		 * sets the PREVIEW order. The Elementor v4 editor's "Design system → Classes"
		 * panel reads the PREVIEW order, so classes we create/sync here would land on
		 * the frontend yet stay invisible in the editor until something else resynced
		 * preview. We therefore mirror order + labels into the preview context via
		 * Elementor's own update_order_and_labels() (its !is_preview branch copies the
		 * order to preview and clears per-id preview labels so they inherit).
		 */
		private static function save_global_classes_array( array $new, array $old ): void {
			if ( ! class_exists( '\Elementor\Modules\GlobalClasses\Global_Classes_Repository' ) ) {
				return;
			}

			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit();
			if ( ! $kit ) {
				return;
			}

			$order = isset( $new['order'] ) && is_array( $new['order'] ) ? array_values( $new['order'] ) : array();

			$repository = \Elementor\Modules\GlobalClasses\Global_Classes_Repository::make( $kit );
			$repository->put( $new['items'], $order );

			// Propagate the order + labels to the preview context so the editor lists
			// the same classes the frontend has. Guarded for older Elementor builds.
			if ( method_exists( $repository, 'update_order_and_labels' ) ) {
				$labels = array();
				foreach ( $order as $id ) {
					if ( isset( $new['items'][ $id ]['label'] ) ) {
						$labels[ $id ] = $new['items'][ $id ]['label'];
					}
				}
				$repository->update_order_and_labels( $order, $labels );
			}

			\Elementor\Plugin::$instance->files_manager->clear_cache();
		}

		/**
		 * Generic getter — filters items by ID prefix, extracts breakpoint values via callback.
		 *
		 * @param string   $prefix  e.g. 'g-up', 'g-ub'
		 * @param callable $extract fn(array $variant): ?array
		 */
		private static function get_classes_by_prefix( string $prefix, callable $extract ): array {
			$global_classes = self::get_global_classes_array();
			$result         = array();

			foreach ( $global_classes['items'] ?? array() as $class ) {
				if ( ! isset( $class['id'] ) || strpos( $class['id'], $prefix ) !== 0 ) {
					continue;
				}

				$breakpoint_values = array();
				foreach ( $class['variants'] ?? array() as $variant ) {
					$data = $extract( $variant );
					if ( null !== $data ) {
						$bp                       = $variant['meta']['breakpoint'] ?? 'desktop';
						$breakpoint_values[ $bp ] = $data;
					}
				}

				if ( ! empty( $breakpoint_values ) ) {
					$result[] = array(
						'id'    => $class['id'],
						'type'  => $class['type'] ?? 'class',
						'label' => $class['label'] ?? '',
						'value' => $breakpoint_values,
					);
				}
			}

			return $result;
		}

		/**
		 * Generic sync — applies ADD/SET/DEL CRUD for items matching a prefix.
		 *
		 * @param array    $items          Normalized items array
		 * @param string   $prefix         e.g. 'g-up'
		 * @param callable $build_variants fn(array $bpValues, string $bp): array
		 */
		private static function sync_classes( array $items, string $prefix, callable $build_variants ): void {
			$global_classes = self::get_global_classes_array();
			$old_value      = unserialize( serialize( $global_classes ) );

			$breakpoints = array( 'widescreen', 'desktop', 'laptop', 'tablet_extra', 'tablet', 'mobile_extra', 'mobile' );

			foreach ( $items as $item ) {
				$action   = $item['action'] ?? 'none';
				$itemData = $item['value'] ?? $item;

				if ( ! isset( $itemData['id'] ) || strpos( $itemData['id'], $prefix ) !== 0 ) {
					continue;
				}

				$id = $itemData['id'];

				// Build variants — only for breakpoints that actually have real data
				$variants = array();
				foreach ( $breakpoints as $bp ) {
					if ( ! isset( $itemData['value'][ $bp ] ) || ! is_array( $itemData['value'][ $bp ] ) ) {
						continue;
					}

					$bpValues = $itemData['value'][ $bp ];

					// Skip breakpoint if all values are null or empty string
					$hasData = array_filter( $bpValues, fn( $v ) => null !== $v && '' !== $v );
					if ( empty( $hasData ) ) {
						continue;
					}

					$variants[] = $build_variants( $bpValues, $bp );
				}

				// Preserve label and type
				$itemData['label']    = $itemData['label'] ?? $global_classes['items'][ $id ]['label'] ?? '';
				$itemData['type']     = $itemData['type'] ?? $global_classes['items'][ $id ]['type'] ?? 'class';
				$itemData['variants'] = $variants;

				// Clean temporary keys
				unset( $itemData['value'], $itemData['action'] );

				// CRUD operations
				if ( 'DEL' === $action ) {
					unset( $global_classes['items'][ $id ] );
					$global_classes['order'] = array_values( array_diff( $global_classes['order'] ?? array(), array( $id ) ) );
				} elseif ( 'SET' === $action && isset( $global_classes['items'][ $id ] ) ) {
					$global_classes['items'][ $id ] = $itemData;
				} elseif ( 'ADD' === $action && ! isset( $global_classes['items'][ $id ] ) ) {
					$global_classes['items'][ $id ] = $itemData;
					$global_classes['order'][]      = $id;
				}
			}

			self::save_global_classes_array( $global_classes, $old_value );
		}

		/** Normalize sync input: handle single item vs array */
		private static function normalize_sync_input( $raw ): array {
			$arr = self::object_to_array( $raw );
			return isset( $arr['id'] ) ? array( $arr ) : $arr;
		}

		/** Build Elementor size structure */
		private static function size( float $size, string $unit = 'px' ): array {
			return array(
				'$$type' => 'size',
				'value'  => array(
					'size' => $size,
					'unit' => $unit,
				),
			);
		}

		/**
		 * Inline-auto margin dimensions for the boxed-width class — always
		 * centers the container regardless of the surrounding parent's
		 * alignment. Only the inline sides are set so the kit/page can still
		 * control vertical spacing.
		 */
		private static function auto_inline_margin(): array {
			$auto = array(
				'$$type' => 'size',
				'value'  => array(
					'size' => '',
					'unit' => 'auto',
				),
			);
			return array(
				'$$type' => 'dimensions',
				'value'  => array(
					'inline-start' => $auto,
					'inline-end'   => $auto,
				),
			);
		}

		/** Build a standard variant meta wrapper */
		private static function variant_meta( string $breakpoint ): array {
			return array(
				'breakpoint' => $breakpoint,
				'state'      => null,
			);
		}

		/** Convert "12px" string → ['size' => 12, 'unit' => 'px'] */
		private static function parse_size_string( string $value ): array {
			preg_match( '/(-?\d+(?:\.\d+)?)(px|em|rem|%|vh|vw)?/', $value, $m );
			return array(
				'size' => (float) ( $m[1] ?? 0 ),
				'unit' => $m[2] ?? 'px',
			);
		}

		/** Convert rgba() or any color string to hex */
		private static function rgbaToHex( string $color ): string {
			if ( preg_match( '/^#([a-f0-9]{3,6})$/i', $color ) ) {
				return $color;
			}

			if ( preg_match( '/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,?\s*([\d.]+)?\s*\)/i', $color, $m ) ) {
				[$r, $g, $b] = array(
					max( 0, min( 255, (int) $m[1] ) ),
					max( 0, min( 255, (int) $m[2] ) ),
					max( 0, min( 255, (int) $m[3] ) ),
				);
				$a           = isset( $m[4] ) ? (float) $m[4] : 1.0;

				return $a >= 1
					? sprintf( '#%02x%02x%02x', $r, $g, $b )
					: sprintf( '#%02x%02x%02x%s', $r, $g, $b, str_pad( dechex( round( $a * 255 ) ), 2, '0', STR_PAD_LEFT ) );
			}

			return $color;
		}


		// ============================================================
		// COLOR VARIABLES
		// ============================================================

		public static function get_uich_elementor_variables(): array {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return array();
			}
			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();
			if ( ! $kit ) {
				return array();
			}
			$data = json_decode( $kit->get_meta( '_elementor_global_variables' ), true );

			$result = array();
			foreach ( $data['data'] ?? array() as $id => $variable ) {
				if ( ( $variable['type'] ?? '' ) !== 'global-color-variable' ) {
					continue;
				}
				$result[] = array(
					'id'    => $id,
					'type'  => $variable['type'],
					'label' => $variable['label'],
					'value' => self::rgbaToHex( $variable['value']['value'] ),
				);
			}
			return $result;
		}

		public static function sync_uich_elementor_variables( $sync_data ): array {
			if ( empty( $sync_data->data->color ) ) {
				return self::get_uich_elementor_variables();
			}

			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return array();
			}
			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();
			if ( ! $kit ) {
				return array();
			}
			$meta_key = '_elementor_global_variables';
			$vars     = self::object_to_array( json_decode( $kit->get_meta( $meta_key ) ) );

			// Ensure base structure exists
			if ( ! is_array( $vars ) || empty( $vars ) ) {
				$vars = array(
					'data'      => array(),
					'watermark' => 0,
					'version'   => 1,
				);
			}

			foreach ( self::object_to_array( $sync_data->data->color ) as $variable ) {
				$required = array( 'action', 'type', 'label', 'id', 'value' );
				if ( ! empty( array_diff( $required, array_keys( $variable ) ) ) ) {
					continue;
				}
				if ( 'global-color-variable' !== $variable['type'] ) {
					continue;
				}

				$id     = $variable['id'];
				$action = $variable['action'];

				if ( 'ADD' === $action || 'SET' === $action ) {
					$vars['data'][ $id ] = array(
						'type'  => $variable['type'],
						'label' => $variable['label'],
						'value' => array(
							'$$type' => 'color',
							'value'  => $variable['value'],
						),
					);
				}

				if ( 'DEL' === $action ) {
					unset( $vars['data'][ $id ] );
				}
			}

			$vars['watermark'] = ( $vars['watermark'] ?? 0 ) + 1;
			$kit->update_meta( $meta_key, json_encode( $vars ) );

			// Clear CSS cache
			\Elementor\Plugin::$instance->files_manager->clear_cache();

			return self::get_uich_elementor_variables();
		}


		// ============================================================
		// TYPOGRAPHY  (prefix: g-ut)
		// ============================================================

		// Props that use size+unit structure
		private const TYPO_SIZE_PROPS = array( 'font-size', 'line-height', 'letter-spacing' );

		// All typography props we read/write
		private const TYPO_PROPS = array(
			'font-family',
			'font-weight',
			'font-size',
			'font-style',
			'text-align',
			'text-transform',
			'line-height',
			'letter-spacing',
			'text-decoration',
		);

		public static function get_elementor_typo_classes(): array {
			// Typography classes are identified by their PROPS (font-*), not by a
			// 'g-ut' id prefix: Elementor-created global classes carry ids like
			// 'g-0da79e7', which a 'g-ut'-only filter silently missed (so their
			// typography never migrated/rendered). Every global-class id begins
			// with 'g-', so we scan them all and let the extractor below keep only
			// the ones that actually declare typography props.
			return self::get_classes_by_prefix(
				'g-',
				function ( array $variant ): ?array {
					if ( empty( $variant['props'] ) ) {
						return null;
					}

					$typo_value = array();
					foreach ( UiChemy_Atomic_Globals::TYPO_PROPS as $prop ) {
						if ( ! isset( $variant['props'][ $prop ] ) ) {
							continue;
						}
						$propData = $variant['props'][ $prop ];

						// Size props return "12px", string props return the value directly
						if ( isset( $propData['value']['size'] ) && isset( $propData['value']['unit'] ) ) {
							$typo_value[ $prop ] = $propData['value']['size'] . $propData['value']['unit'];
						} else {
							$typo_value[ $prop ] = $propData['value'] ?? $propData;
						}
					}

					return ! empty( $typo_value ) ? $typo_value : null;
				}
			);
		}

		public static function sync_elementor_typo_classes( $sync_data ): array {
			if ( ! empty( $sync_data->data->typography ) ) {
				self::sync_classes(
					self::normalize_sync_input( $sync_data->data->typography ),
					'g-ut',
					function ( array $bp, string $breakpoint ): array {
						$props = array();
						foreach ( $bp as $propName => $propValue ) {
							if ( in_array( $propName, UiChemy_Atomic_Globals::TYPO_SIZE_PROPS )
								&& preg_match( '/(-?\d+(?:\.\d+)?)(px|em|rem|%|vh|vw)?/', $propValue, $m )
							) {
								// Resolve the unit. When a value comes in unitless
								// (e.g. line-height "1.2"), the regex leaves $m[2]
								// empty. line-height is an em-ratio in our pipeline,
								// so defaulting it to px would render `line-height:1.2px`
								// and collapse every text line. Only font-size /
								// letter-spacing legitimately default to px.
								$unit = $m[2] ?? '';
								if ( '' === $unit ) {
									$unit = ( 'line-height' === $propName ) ? 'em' : 'px';
								}
								$props[ $propName ] = array(
									'$$type' => 'size',
									'value'  => array(
										'size' => (float) $m[1],
										'unit' => $unit,
									),
								);
							} else {
								$props[ $propName ] = array(
									'$$type' => 'string',
									'value'  => $propValue,
								);
							}
						}
						return array(
							'meta'  => UiChemy_Atomic_Globals::variant_meta( $breakpoint ),
							'props' => $props,
						);
					}
				);
			}

			return self::get_elementor_typo_classes();
		}


		// ============================================================
		// WIDTH  (prefix: g-uw — single persistent class)
		// ============================================================

		public static function get_global_width_class_id(): string {
			$option_key = 'uich_atomic_global_width_class_id';
			$id         = get_option( $option_key );

			if ( ! $id ) {
				$id = 'g-uw' . strtolower( wp_generate_password( 5, false, false ) ) . 'u';
				update_option( $option_key, $id );
			}

			return $id;
		}

		public static function get_elementor_width_class(): array {
			$global_classes = self::get_global_classes_array();
			$id             = self::get_global_width_class_id();
			$widths         = array();

			foreach ( $global_classes['items'][ $id ]['variants'] ?? array() as $variant ) {
				if ( ! isset( $variant['meta']['breakpoint'], $variant['props']['max-width']['value'] ) ) {
					continue;
				}
				$val = $variant['props']['max-width']['value'];
				if ( isset( $val['size'] ) ) {
					$widths[ $variant['meta']['breakpoint'] ] = $val['size'] . ( $val['unit'] ?? 'px' );
				}
			}

			// First-time defaults
			if ( empty( $widths ) ) {
				$widths    = array(
					'desktop' => '1440px',
					'tablet'  => '85%',
					'mobile'  => '90%',
				);
				$old_value = unserialize( serialize( $global_classes ) );

				$auto_margin                    = self::auto_inline_margin();
				$global_classes['items'][ $id ] = array(
					'id'       => $id,
					'type'     => 'class',
					'label'    => 'elementor-atomic-boxed-width',
					'variants' => array(
						array(
							'meta'  => self::variant_meta( 'desktop' ),
							'props' => array(
								'max-width' => self::size( 1440 ),
								'margin'    => $auto_margin,
							),
						),
						array(
							'meta'  => self::variant_meta( 'tablet' ),
							'props' => array(
								'max-width' => self::size( 85, '%' ),
								'margin'    => $auto_margin,
							),
						),
						array(
							'meta'  => self::variant_meta( 'mobile' ),
							'props' => array(
								'max-width' => self::size( 90, '%' ),
								'margin'    => $auto_margin,
							),
						),
					),
				);
				$global_classes['order'][]      = $id;
				self::save_global_classes_array( $global_classes, $old_value );
			}

			$widths['id']    = $id;
			$widths['label'] = isset( $global_classes['items'][ $id ]['label'] )
				? (string) $global_classes['items'][ $id ]['label']
				: '';
			return $widths;
		}

		public static function sync_elementor_width_class( $sync_data ): array {
			$widths = isset( $sync_data->data->width ) ? (array) $sync_data->data->width : array();

			// No width payload? Preserve whatever is already stored. Without
			// this guard, an MCP call that syncs only typography/colors would
			// overwrite the existing boxed-width variants with [] — silently
			// deleting the kit's boxed width across the whole site.
			$has_width_payload = false;
			foreach ( $widths as $bp => $value ) {
				if ( 'id' === $bp ) {
					continue;
				}
				if ( null !== $value && '' !== $value && array() !== $value ) {
					$has_width_payload = true;
					break;
				}
			}
			if ( ! $has_width_payload ) {
				return self::get_elementor_width_class();
			}

			$global_classes = self::get_global_classes_array();
			$old_value      = unserialize( serialize( $global_classes ) );
			$id             = self::get_global_width_class_id();

			if ( ! isset( $global_classes['items'][ $id ] ) ) {
				$global_classes['items'][ $id ] = array(
					'id'       => $id,
					'type'     => 'class',
					'label'    => 'elementor-atomic-boxed-width',
					'variants' => array(),
				);
				$global_classes['order'][]      = $id;
			}

			$variants    = array();
			$auto_margin = self::auto_inline_margin();
			foreach ( $widths as $breakpoint => $value ) {
				if ( 'id' === $breakpoint || empty( $value ) ) {
					continue;
				}

				preg_match( '/^(\d+(?:\.\d+)?)([a-z%]+)$/i', $value, $m );
				$variants[] = array(
					'meta'  => self::variant_meta( $breakpoint ),
					'props' => array(
						'max-width' => self::size( (float) ( $m[1] ?? $value ), $m[2] ?? 'px' ),
						'margin'    => $auto_margin,
					),
				);
			}

			$global_classes['items'][ $id ]['variants'] = $variants;

			self::save_global_classes_array( $global_classes, $old_value );

			return self::get_elementor_width_class();
		}


		// ============================================================
		// PADDING  (prefix: g-up)
		// ============================================================

		public static function get_elementor_padding_classes(): array {
			return self::get_classes_by_prefix(
				'g-up',
				function ( array $variant ): ?array {
					if ( ! isset( $variant['props']['padding']['value'] ) ) {
						return null;
					}
					$v = $variant['props']['padding']['value'];
					return array(
						'top'    => isset( $v['block-start']['value'] ) ? $v['block-start']['value']['size'] : null,
						'bottom' => isset( $v['block-end']['value'] ) ? $v['block-end']['value']['size'] : null,
						'left'   => isset( $v['inline-start']['value'] ) ? $v['inline-start']['value']['size'] : null,
						'right'  => isset( $v['inline-end']['value'] ) ? $v['inline-end']['value']['size'] : null,
					);
				}
			);
		}

		public static function sync_elementor_padding_classes( $sync_data ): array {
			if ( ! empty( $sync_data->data->padding ) ) {
				self::sync_classes(
					self::normalize_sync_input( $sync_data->data->padding ),
					'g-up',
					function ( array $bp, string $breakpoint ): array {
						return array(
							'meta'  => UiChemy_Atomic_Globals::variant_meta( $breakpoint ),
							'props' => array(
								'padding' => array(
									'$$type' => 'dimensions',
									'value'  => array(
										'block-start'  => array(
											'$$type' => 'size',
											'value'  => UiChemy_Atomic_Globals::parse_size_string( $bp['top'] ?? '0px' ),
										),
										'block-end'    => array(
											'$$type' => 'size',
											'value'  => UiChemy_Atomic_Globals::parse_size_string( $bp['bottom'] ?? '0px' ),
										),
										'inline-start' => array(
											'$$type' => 'size',
											'value'  => UiChemy_Atomic_Globals::parse_size_string( $bp['left'] ?? '0px' ),
										),
										'inline-end'   => array(
											'$$type' => 'size',
											'value'  => UiChemy_Atomic_Globals::parse_size_string( $bp['right'] ?? '0px' ),
										),
									),
								),
							),
						);
					}
				);
			}

			return self::get_elementor_padding_classes();
		}


		// ============================================================
		// BORDER  (prefix: g-ub)
		// ============================================================

		public static function get_elementor_border_classes(): array {
			$color_variable_map = array();
			foreach ( self::get_uich_elementor_variables() as $variable ) {
				if ( ! empty( $variable['id'] ) && ! empty( $variable['value'] ) ) {
					$color_variable_map[ $variable['id'] ] = $variable['value'];
				}
			}

			return self::get_classes_by_prefix(
				'g-ub',
				function ( array $variant ) use ( $color_variable_map ): ?array {
					if ( ! isset( $variant['props']['border-width']['value'] ) ) {
						return null;
					}
					$v = $variant['props']['border-width']['value'];

					return array(
						'width' => array(
							'top'    => $v['block-start']['value']['size'] ?? null,
							'bottom' => $v['block-end']['value']['size'] ?? null,
							'left'   => $v['inline-start']['value']['size'] ?? null,
							'right'  => $v['inline-end']['value']['size'] ?? null,
						),
						'color' => 'color' === $variant['props']['border-color']['$$type']
							? $variant['props']['border-color']['value']
							: $color_variable_map[ $variant['props']['border-color']['value'] ] ?? null,
						'style' => $variant['props']['border-style']['value'] ?? null,
					);
				}
			);
		}

		public static function sync_elementor_border_classes( $sync_data ): void {
			if ( empty( $sync_data->data->border ) ) {
				return;
			}

			// Build hex => id map from the incoming color data
			$color_variable_map = array();
			foreach ( self::get_uich_elementor_variables() as $variable ) {
				if ( ! empty( $variable['id'] ) && ! empty( $variable['value'] ) ) {
					$color_variable_map[ $variable['value'] ] = $variable['id'];
				}
			}

			self::sync_classes(
				self::normalize_sync_input( $sync_data->data->border ),
				'g-ub',
				function ( array $bp, string $breakpoint ) use ( $color_variable_map ): array {
					return array(
						'meta'  => UiChemy_Atomic_Globals::variant_meta( $breakpoint ),
						'props' => array(
							'border-width' => array(
								'$$type' => 'border-width',
								'value'  => array(
									'block-start'  => UiChemy_Atomic_Globals::size( $bp['width']['top'] ?? 0 ),
									'block-end'    => UiChemy_Atomic_Globals::size( $bp['width']['bottom'] ?? 0 ),
									'inline-start' => UiChemy_Atomic_Globals::size( $bp['width']['left'] ?? 0 ),
									'inline-end'   => UiChemy_Atomic_Globals::size( $bp['width']['right'] ?? 0 ),
								),
							),
							'border-color' => $bp['color'] && isset( $color_variable_map[ $bp['color'] ] )
								? array(
									'$$type' => 'global-color-variable',
									'value'  => $color_variable_map[ $bp['color'] ],
								)
								: array(
									'$$type' => 'color',
									'value'  => $bp['color'],
								),
							'border-style' => array(
								'$$type' => 'string',
								'value'  => $bp['style'],
							),
						),
					);
				}
			);
		}


		// ============================================================
		// BORDER RADIUS  (prefix: g-ur)
		// ============================================================

		public static function get_elementor_border_radius_classes(): array {
			return self::get_classes_by_prefix(
				'g-ur',
				function ( array $variant ): ?array {
					if ( ! isset( $variant['props']['border-radius']['value'] ) ) {
						return null;
					}
					$v = $variant['props']['border-radius']['value'];
					return array(
						'topLeft'     => $v['start-start']['value']['size'] ?? null,
						'topRight'    => $v['start-end']['value']['size'] ?? null,
						'bottomLeft'  => $v['end-start']['value']['size'] ?? null,
						'bottomRight' => $v['end-end']['value']['size'] ?? null,
					);
				}
			);
		}

		public static function sync_elementor_border_radius_classes( $sync_data ): void {
			if ( empty( $sync_data->data->borderRadius ) ) {
				return;
			}

			self::sync_classes(
				self::normalize_sync_input( $sync_data->data->borderRadius ),
				'g-ur',
				function ( array $bp, string $breakpoint ): array {
					return array(
						'meta'  => UiChemy_Atomic_Globals::variant_meta( $breakpoint ),
						'props' => array(
							'border-radius' => array(
								'$$type' => 'border-radius',
								'value'  => array(
									'start-start' => UiChemy_Atomic_Globals::size( $bp['topLeft'] ?? 0 ),
									'start-end'   => UiChemy_Atomic_Globals::size( $bp['topRight'] ?? 0 ),
									'end-start'   => UiChemy_Atomic_Globals::size( $bp['bottomLeft'] ?? 0 ),
									'end-end'     => UiChemy_Atomic_Globals::size( $bp['bottomRight'] ?? 0 ),
								),
							),
						),
					);
				}
			);
		}


		// ============================================================
		// SHADOW  (prefix: g-us)
		// ============================================================

		public static function get_elementor_shadow_classes(): array {
			return self::get_classes_by_prefix(
				'g-us',
				function ( array $variant ): ?array {
					if ( ! isset( $variant['props']['box-shadow']['value'] ) ) {
						return null;
					}
					$s = $variant['props']['box-shadow']['value'][0]['value'];
					return array(
						'hOffset'  => $s['hOffset']['value']['size'] ?? null,
						'vOffset'  => $s['vOffset']['value']['size'] ?? null,
						'blur'     => $s['blur']['value']['size'] ?? null,
						'spread'   => $s['spread']['value']['size'] ?? null,
						'color'    => $s['color']['value'] ?? null,
						'position' => $s['position']['value'] ?? 'outset',
					);
				}
			);
		}

		public static function sync_elementor_shadow_classes( $sync_data ): void {
			if ( empty( $sync_data->data->shadow ) ) {
				return;
			}

			self::sync_classes(
				self::normalize_sync_input( $sync_data->data->shadow ),
				'g-us',
				function ( array $bp, string $breakpoint ): array {
					$shadowValue = array(
						'hOffset' => UiChemy_Atomic_Globals::size( $bp['hOffset'] ?? 0 ),
						'vOffset' => UiChemy_Atomic_Globals::size( $bp['vOffset'] ?? 0 ),
						'blur'    => UiChemy_Atomic_Globals::size( $bp['blur'] ?? 0 ),
						'spread'  => UiChemy_Atomic_Globals::size( $bp['spread'] ?? 0 ),
						'color'   => array(
							'$$type' => 'color',
							'value'  => $bp['color'],
						),
					);

					// Only include position when not default "outset"
					if ( ( $bp['position'] ?? 'outset' ) !== 'outset' ) {
						$shadowValue['position'] = array(
							'$$type' => 'string',
							'value'  => $bp['position'],
						);
					}

					return array(
						'meta'  => UiChemy_Atomic_Globals::variant_meta( $breakpoint ),
						'props' => array(
							'box-shadow' => array(
								'$$type' => 'box-shadow',
								'value'  => array(
									array(
										'$$type' => 'shadow',
										'value'  => $shadowValue,
									),
								),
							),
						),
					);
				}
			);
		}


		// ============================================================
		// GAP  (prefix: g-ug)
		// ============================================================

		public static function get_elementor_gap_classes(): array {
			return self::get_classes_by_prefix(
				'g-ug',
				function ( array $variant ): ?array {
					if ( ! isset( $variant['props']['gap']['value'] ) ) {
						return null;
					}
					$v = $variant['props']['gap']['value'];
					return array(
						'row'    => $v['row']['value']['size'] ?? null,
						'column' => $v['column']['value']['size'] ?? null,
					);
				}
			);
		}

		public static function sync_elementor_gap_classes( $sync_data ): void {
			if ( empty( $sync_data->data->gap ) ) {
				return;
			}

			self::sync_classes(
				self::normalize_sync_input( $sync_data->data->gap ),
				'g-ug',
				function ( array $bp, string $breakpoint ): array {
					return array(
						'meta'  => UiChemy_Atomic_Globals::variant_meta( $breakpoint ),
						'props' => array(
							'gap' => array(
								'$$type' => 'layout-direction',
								'value'  => array(
									'row'    => UiChemy_Atomic_Globals::size( $bp['row'] ?? 0 ),
									'column' => UiChemy_Atomic_Globals::size( $bp['column'] ?? 0 ),
								),
							),
						),
					);
				}
			);
		}


		// ============================================================
		// AGGREGATE GET + SYNC
		// ============================================================

		public static function get_global_classes_and_variable(): array {
			return array(
				'width'        => self::get_elementor_width_class(),
				'color'        => self::get_uich_elementor_variables(),
				'typography'   => self::get_elementor_typo_classes(),
				'padding'      => self::get_elementor_padding_classes(),
				'border'       => self::get_elementor_border_classes(),
				'borderRadius' => self::get_elementor_border_radius_classes(),
				'gap'          => self::get_elementor_gap_classes(),
				'shadow'       => self::get_elementor_shadow_classes(),
			);
		}

		public static function sych_uich_elementor_classes_and_variables_sync( $sync_data ): array {
			self::sync_elementor_width_class( $sync_data );
			self::sync_uich_elementor_variables( $sync_data );
			self::sync_elementor_typo_classes( $sync_data );
			self::sync_elementor_padding_classes( $sync_data );
			self::sync_elementor_border_classes( $sync_data );
			self::sync_elementor_border_radius_classes( $sync_data );
			self::sync_elementor_gap_classes( $sync_data );
			self::sync_elementor_shadow_classes( $sync_data );

			return self::get_global_classes_and_variable();
		}
	}
}
