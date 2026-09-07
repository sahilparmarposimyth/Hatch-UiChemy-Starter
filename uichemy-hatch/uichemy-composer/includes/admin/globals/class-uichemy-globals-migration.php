<?php
/**
 * UiChemy Globals Migration — one-time, non-destructive import of Elementor
 * globals that older UiChemy (v2) designs still reference into v3's own globals
 * store, plus back-compat aliases so those designs keep rendering.
 *
 * v2 leaned on Elementor's native kit for globals — both the classic kit
 * (system/custom colors + typography, container width) and the v4 "atomic"
 * kit (global color variables + CPT global classes). v3 owns its globals in the
 * #uichemy-globals <style> block (site head) and the uichemy_globals_variable
 * option, and references them as var(--<id>) / .text-<id>. v3 never emits the
 * old --e-global-* / atomic var names, so a v2-converted design loses its
 * colours and fonts on upgrade.
 *
 * This migration (Strategy A — import + alias, no design rewrites):
 *   1. Detects which globals the UiChemy `composer` widgets actually reference
 *      (scoped scan of _elementor_data), classic + atomic.
 *   2. Imports them into v3's own store keeping the SAME id/title (renaming
 *      breaks references) — native --<id> tokens + .text-<id> classes.
 *   3. Emits compatibility aliases (--e-global-color-*, --e-global-typography-*,
 *      --e-global-container-width, atomic --<var> defs, atomic-label classes)
 *      into the #uichemy-globals block so old references resolve.
 *
 * One-time, flag-gated (uichemy_globals_migration), idempotent, non-destructive
 * — it NEVER rewrites any post's _elementor_data. Follows the maybe_upgrade()
 * convention used by Uich_Forms_DB / UiChemy_Chat_DB.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Globals_Migration' ) ) {

	/**
	 * One-time v2→v3 globals migration + alias emission.
	 */
	class UiChemy_Globals_Migration {

		/**
		 * wp_options key holding the one-time migration flag (boolean true once run).
		 */
		const FLAG_OPTION = 'uichemy_global_migration_v2_to_v3';

		/**
		 * Marker comment prefixing the appended alias section in the block, so a
		 * human reading the block knows where the migrated CSS came from.
		 */
		const BLOCK_MARKER = '/* UiChemy v2->v3 globals migration (compatibility aliases) */';

		/**
		 * The four classic system colour ids — always aliased as a safety net even
		 * when a scan turns up nothing, since virtually every v2 design used them.
		 *
		 * @var string[]
		 */
		private static $system_color_ids = array( 'primary', 'secondary', 'text', 'accent' );

		/**
		 * Run the migration once, gated on the flag. Safe to call on every load.
		 *
		 * @return void
		 */
		public static function maybe_migrate() {
			if ( self::is_migrated() ) {
				return;
			}

			// Needs Elementor + a resolvable active kit to read anything. When it's
			// not available we return WITHOUT stamping the flag, so the migration
			// retries on a later load once Elementor is active / a kit exists
			// (e.g. the user upgrades v3 before finishing kit setup). The scan is
			// only reached once a kit is present, so this is not a per-request cost
			// on Elementor-less sites beyond a class_exists check.
			if ( ! class_exists( 'UiChemy_Elementor_Globals' ) || ! UiChemy_Elementor_Globals::is_available() ) {
				return;
			}

			// A site upgrading from the standalone plugin still has its v2→v3 flag
			// (and its globals block) under the old `protuno_` names, so is_migrated()
			// above reads false even though this migration HAS already run there.
			//
			// We hook `init` (pri 25) and Uich_Composer_Migration hooks `admin_init`
			// (pri 5), which is later in the same request — so without this guard we
			// would run first, decide the site is fresh, and CREATE the
			// uichemy_composer_site_custom_code row with a default four-colour block.
			// step_options() would then have to reconcile a collision against the
			// customer's real block. Yield until the rename has happened; we return
			// WITHOUT stamping the flag, so the next load (or the migration's own
			// cron tick) retries and by then either the flag or the block is ours.
			//
			// Ordered after the Elementor gate above so the extra query only runs on
			// sites that are actually ready to migrate.
			if ( class_exists( 'Uich_Composer_Migration' )
				&& Uich_Composer_Migration::has_pending_legacy_options() ) {
				return;
			}

			self::run();
		}

		/**
		 * True once the migration has completed (any source, including "none").
		 *
		 * @return bool
		 */
		private static function is_migrated() {
			return (bool) get_option( self::FLAG_OPTION, false );
		}

		/**
		 * Whether Elementor's v4 atomic experiment is active on this site.
		 *
		 * @return bool
		 */
		private static function is_atomic_enabled() {
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
		 * Perform the migration: detect → resolve → import + alias → cache → flag.
		 *
		 * @return void
		 */
		private static function run() {
			$atomic_enabled = self::is_atomic_enabled()
				&& class_exists( 'UiChemy_Atomic_Globals' );

			$refs = self::detect_references();

			// Accumulators shared by the classic + atomic passes.
			$root_aliases  = array(); // Lines for a :root {} block (compat + atomic defs).
			$class_blocks  = array(); // [ '.selector' => 'body' ] class rules.
			$native_tokens = array(); // Rows for uichemy_globals_variable (UI/edit).
			$counts        = array(
				'colors'     => 0,
				'typography' => 0,
				'atomic'     => 0,
				'width'      => 0,
			);
			$ids           = array();

			self::migrate_classic( $refs, $root_aliases, $class_blocks, $native_tokens, $counts, $ids );

			if ( $atomic_enabled ) {
				self::migrate_atomic( $refs, $root_aliases, $class_blocks, $native_tokens, $counts, $ids );
			}

			$wrote_block  = self::apply_to_block( $root_aliases, $class_blocks );
			$wrote_tokens = self::apply_native_tokens( $native_tokens );

			if ( $wrote_block || $wrote_tokens ) {
				self::regenerate_cache();
			}

			self::write_flag();
		}

		// ── Detection (usage-based, scoped to UiChemy widgets) ─────────────────

		/**
		 * Scan UiChemy `composer` widgets across the site and collect the global ids
		 * / labels they reference.
		 *
		 * @return array{
		 *   color:string[], typography:string[], width:bool,
		 *   atomic_vars:string[], atomic_labels:string[]
		 * }
		 */
		private static function detect_references() {
			$refs = array(
				'color'         => array(),
				'typography'    => array(),
				'width'         => false,
				'atomic_vars'   => array(),
				'atomic_labels' => array(),
			);

			foreach ( self::collect_composer_settings() as $s ) {
				$css  = isset( $s['raw_css'] ) ? (string) $s['raw_css'] : '';
				$html = isset( $s['raw_html'] ) ? (string) $s['raw_html'] : '';

				// Classic colours: var(--e-global-color-<id>).
				if ( preg_match_all( '/var\(\s*--e-global-color-([\w-]+)\s*\)/i', $css, $m ) ) {
					foreach ( $m[1] as $id ) {
						$refs['color'][ $id ] = true;
					}
				}

				// Classic typography: var(--e-global-typography-<id>-<prop>).
				if ( preg_match_all( '/var\(\s*--e-global-typography-([\w-]+?)-(?:font-family|font-size|font-weight|line-height|letter-spacing|text-transform|text-decoration|font-style)\s*\)/i', $css, $m ) ) {
					foreach ( $m[1] as $id ) {
						$refs['typography'][ $id ] = true;
					}
				}

				// Classic typography also appears as a `.text-<id>` html class
				// (the font shorthand is omitted in raw_html). Over-capture here is
				// harmless: ids are intersected with the kit's typography on resolve.
				if ( preg_match_all( '/(?<![\w-])text-([\w-]+)/i', $html, $m ) ) {
					foreach ( $m[1] as $id ) {
						$refs['typography'][ $id ] = true;
					}
				}

				// Classic container width.
				if ( false !== stripos( $css, 'var(--e-global-container-width)' ) ) {
					$refs['width'] = true;
				}

				// Atomic colours: plain var(--<name>) where <name> isn't the classic
				// --e-global-* family. Intersected with the atomic variable map on
				// resolve, so unrelated var()s (native tokens etc.) drop out.
				if ( preg_match_all( '/var\(\s*--([\w-]+)\s*\)/i', $css, $m ) ) {
					foreach ( $m[1] as $name ) {
						if ( 0 === stripos( $name, 'e-global-' ) ) {
							continue;
						}
						$refs['atomic_vars'][ $name ] = true;
					}
				}

				// Atomic classes are referenced in raw_html by their sanitized
				// label. Collect every class token; intersected with atomic global
				// class labels on resolve.
				if ( preg_match_all( '/class\s*=\s*"([^"]*)"/i', $html, $m ) ) {
					foreach ( $m[1] as $class_attr ) {
						foreach ( preg_split( '/\s+/', trim( $class_attr ) ) as $cls ) {
							if ( '' !== $cls ) {
								$refs['atomic_labels'][ $cls ] = true;
							}
						}
					}
				}
			}

			return array(
				'color'         => array_keys( $refs['color'] ),
				'typography'    => array_keys( $refs['typography'] ),
				'width'         => $refs['width'],
				'atomic_vars'   => array_keys( $refs['atomic_vars'] ),
				'atomic_labels' => array_keys( $refs['atomic_labels'] ),
			);
		}

		/**
		 * Every `composer` widget's raw_css/raw_html across all posts that use the
		 * widget. Paginated so large sites don't load every _elementor_data at once.
		 *
		 * @return array<int,array{raw_css:string,raw_html:string}>
		 */
		private static function collect_composer_settings() {
			global $wpdb;

			$out    = array();
			$batch  = 50;
			$offset = 0;

			// One LIKE per widget name, so rows still stored under a pre-rename type
			// are collected too. LIMIT/OFFSET is safe here: this only reads.
			$likes = array();
			foreach ( uichemy_composer_widget_json_needles() as $needle ) {
				$likes[] = '%' . $wpdb->esc_like( $needle ) . '%';
			}
			$where_like = implode( ' OR ', array_fill( 0, count( $likes ), 'meta_value LIKE %s' ) );

			do {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$rows = $wpdb->get_col(
					$wpdb->prepare( // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where_like is a generated %s-only list; values bound as args.
						// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed placeholder string, not input.
						"SELECT meta_value FROM {$wpdb->postmeta} WHERE meta_key = '_elementor_data' AND ( {$where_like} ) LIMIT %d OFFSET %d",
						array_merge( $likes, array( $batch, $offset ) )
					)
				);

				$fetched = is_array( $rows ) ? count( $rows ) : 0;

				foreach ( (array) $rows as $json ) {
					$data = json_decode( (string) $json, true );
					if ( is_array( $data ) ) {
						self::walk_tree( $data, $out );
					}
				}

				$offset += $batch;
			} while ( $fetched === $batch );

			return $out;
		}

		/**
		 * Recursively walk an Elementor element tree, collecting composer widgets'
		 * raw_css/raw_html.
		 *
		 * @param array $node Element or element list.
		 * @param array $out  Accumulator (by reference).
		 * @return void
		 */
		private static function walk_tree( $node, &$out ) {
			if ( ! is_array( $node ) ) {
				return;
			}

			$is_composer = uichemy_is_composer_widget_type( $node['widgetType'] );
			if ( $is_composer && isset( $node['settings'] ) && is_array( $node['settings'] ) ) {
				$out[] = array(
					'raw_css'  => isset( $node['settings']['raw_css'] ) ? (string) $node['settings']['raw_css'] : '',
					'raw_html' => isset( $node['settings']['raw_html'] ) ? (string) $node['settings']['raw_html'] : '',
				);
			}

			if ( isset( $node['elements'] ) && is_array( $node['elements'] ) ) {
				foreach ( $node['elements'] as $child ) {
					self::walk_tree( $child, $out );
				}
			}

			// Also handle a bare top-level list of elements.
			if ( ! isset( $node['elements'] ) && ! isset( $node['widgetType'] ) ) {
				foreach ( $node as $child ) {
					if ( is_array( $child ) ) {
						self::walk_tree( $child, $out );
					}
				}
			}
		}

		// ── Classic kit migration ──────────────────────────────────────────────

		/**
		 * Resolve + import classic kit colours, typography and container width.
		 *
		 * @param array $refs          Detected references.
		 * @param array $root_aliases  :root lines accumulator (by reference).
		 * @param array $class_blocks  Class rules accumulator (by reference).
		 * @param array $native_tokens Native token rows accumulator (by reference).
		 * @param array $counts        Counts accumulator (by reference).
		 * @param array $ids           Migrated-id accumulator (by reference).
		 * @return void
		 */
		private static function migrate_classic( $refs, &$root_aliases, &$class_blocks, &$native_tokens, &$counts, &$ids ) {
			// Colours — referenced ids plus the four system colours as a safety net.
			$wanted_colors = array_flip( array_merge( $refs['color'], self::$system_color_ids ) );
			foreach ( UiChemy_Elementor_Globals::get_colors() as $c ) {
				$id  = isset( $c['id'] ) ? (string) $c['id'] : '';
				$val = isset( $c['value'] ) ? (string) $c['value'] : '';
				if ( '' === $id || '' === $val || ! isset( $wanted_colors[ $id ] ) ) {
					continue;
				}
				$title = isset( $c['title'] ) && '' !== $c['title'] ? (string) $c['title'] : $id;

				// Compat alias so old raw_css `var(--e-global-color-<id>)` resolves.
				$root_aliases[] = '--e-global-color-' . $id . ': ' . $val . ';';

				// Native token so the v3 UI shows/edits it and var(--<id>) works.
				$native_tokens[] = array(
					'id'    => $id,
					'name'  => $title,
					'type'  => 'color',
					'value' => $val,
				);

				++$counts['colors'];
				$ids[] = $id;
			}

			// Typography — only ids that actually resolve in the kit.
			$wanted_typo = array_flip( $refs['typography'] );
			foreach ( UiChemy_Elementor_Globals::get_typography() as $t ) {
				$id = isset( $t['id'] ) ? (string) $t['id'] : '';
				if ( '' === $id || ! isset( $wanted_typo[ $id ] ) ) {
					continue;
				}
				$value    = isset( $t['value'] ) && is_array( $t['value'] ) ? $t['value'] : array();
				$rendered = self::render_classic_typography( $id, $value );
				if ( empty( $rendered['decls'] ) ) {
					continue;
				}

				// Per-property --e-global-typography-<id>-* compat aliases.
				foreach ( $rendered['vars'] as $line ) {
					$root_aliases[] = $line;
				}
				// The .text-<id> class the raw_html applies (also the v3-native form).
				$class_blocks[ '.text-' . $id ] = $rendered['decls'];

				++$counts['typography'];
				$ids[] = $id;
			}

			// Container width.
			if ( $refs['width'] && class_exists( 'UiChemy_Container_Width' ) ) {
				$cw  = UiChemy_Container_Width::get();
				$val = self::classic_width_value( $cw );
				if ( '' !== $val ) {
					$root_aliases[]  = '--e-global-container-width: ' . $val . ';';
					$counts['width'] = 1;
				}
			}
		}

		/**
		 * Render a classic typography item into a .text-<id> declaration body plus
		 * its per-property --e-global-typography-<id>-* alias lines.
		 *
		 * @param string $id    Typography id.
		 * @param array  $value Elementor typography_* keys.
		 * @return array{decls:string,vars:string[]}
		 */
		private static function render_classic_typography( $id, $value ) {
			// Elementor key → CSS property.
			$map = array(
				'typography_font_family'     => array( 'font-family', 'font-family' ),
				'typography_font_size'       => array( 'font-size', 'font-size' ),
				'typography_font_weight'     => array( 'font-weight', 'font-weight' ),
				'typography_line_height'     => array( 'line-height', 'line-height' ),
				'typography_letter_spacing'  => array( 'letter-spacing', 'letter-spacing' ),
				'typography_text_transform'  => array( 'text-transform', 'text-transform' ),
				'typography_text_decoration' => array( 'text-decoration', 'text-decoration' ),
				'typography_font_style'      => array( 'font-style', 'font-style' ),
			);

			$decls = array();
			$vars  = array();
			foreach ( $map as $key => $props ) {
				if ( ! isset( $value[ $key ] ) ) {
					continue;
				}
				$css_val = self::typography_value_to_css( $value[ $key ] );
				if ( '' === $css_val ) {
					continue;
				}
				$css_prop   = $props[0];
				$var_suffix = $props[1];

				$decls[] = $css_prop . ': ' . $css_val . ';';
				$vars[]  = '--e-global-typography-' . $id . '-' . $var_suffix . ': ' . $css_val . ';';
			}

			return array(
				'decls' => implode( ' ', $decls ),
				'vars'  => $vars,
			);
		}

		/**
		 * Normalize an Elementor typography value (string or { size, unit }) to a
		 * CSS value string.
		 *
		 * @param mixed $v Raw value.
		 * @return string
		 */
		private static function typography_value_to_css( $v ) {
			if ( is_array( $v ) ) {
				if ( ! isset( $v['size'] ) || '' === $v['size'] ) {
					return '';
				}
				$unit = isset( $v['unit'] ) ? (string) $v['unit'] : '';
				// Elementor stores line-height sometimes as a unitless ratio; keep as-is.
				return $v['size'] . $unit;
			}
			return trim( (string) $v );
		}

		/**
		 * The desktop container-width value as a CSS length ("1140px").
		 *
		 * @param mixed $cw Result of UiChemy_Container_Width::get().
		 * @return string
		 */
		private static function classic_width_value( $cw ) {
			if ( ! is_array( $cw ) || ! isset( $cw['desktop'] ) || ! is_array( $cw['desktop'] ) ) {
				return '';
			}
			$d = $cw['desktop'];
			if ( ! isset( $d['size'] ) || '' === $d['size'] ) {
				return '';
			}
			$unit = isset( $d['unit'] ) && '' !== $d['unit'] ? (string) $d['unit'] : 'px';
			return $d['size'] . $unit;
		}

		// ── Atomic (Elementor v4) migration ─────────────────────────────────────

		/**
		 * Resolve + import atomic color variables and global classes referenced by
		 * UiChemy designs.
		 *
		 * @param array $refs          Detected references.
		 * @param array $root_aliases  :root lines accumulator (by reference).
		 * @param array $class_blocks  Class rules accumulator (by reference).
		 * @param array $native_tokens Native token rows accumulator (by reference).
		 * @param array $counts        Counts accumulator (by reference).
		 * @param array $ids           Migrated-id accumulator (by reference).
		 * @return void
		 */
		private static function migrate_atomic( $refs, &$root_aliases, &$class_blocks, &$native_tokens, &$counts, &$ids ) {
			$wanted_vars   = array_flip( $refs['atomic_vars'] );
			$wanted_labels = array_flip( $refs['atomic_labels'] );

			// Atomic colour variables. Elementor v4 emits `--<id>` and references
			// `var(--<id>)`, so the id IS the var name — define it verbatim in the
			// block :root (authoritative for compatibility) and add a native token.
			foreach ( UiChemy_Atomic_Globals::get_uich_elementor_variables() as $v ) {
				$id  = isset( $v['id'] ) ? (string) $v['id'] : '';
				$val = isset( $v['value'] ) ? (string) $v['value'] : '';
				if ( '' === $id || '' === $val || ! isset( $wanted_vars[ $id ] ) ) {
					continue;
				}
				$label = isset( $v['label'] ) && '' !== $v['label'] ? (string) $v['label'] : $id;

				$root_aliases[]  = '--' . $id . ': ' . $val . ';';
				$native_tokens[] = array(
					'id'    => $id,
					'name'  => $label,
					'type'  => 'color',
					'value' => $val,
				);
				++$counts['atomic'];
				$ids[] = $id;
			}

			// Atomic global classes (typography + spacing) are referenced in
			// raw_html by their sanitized label. Emit `.<label>{…}` for every
			// referenced class so those designs render.
			$aggregate = UiChemy_Atomic_Globals::get_global_classes_and_variable();

			$type_renderers = array(
				'typography'   => array( __CLASS__, 'atomic_typography_body' ),
				'padding'      => array( __CLASS__, 'atomic_padding_body' ),
				'gap'          => array( __CLASS__, 'atomic_gap_body' ),
				'border'       => array( __CLASS__, 'atomic_border_body' ),
				'borderRadius' => array( __CLASS__, 'atomic_border_radius_body' ),
				'shadow'       => array( __CLASS__, 'atomic_shadow_body' ),
			);

			foreach ( $type_renderers as $type => $renderer ) {
				if ( empty( $aggregate[ $type ] ) || ! is_array( $aggregate[ $type ] ) ) {
					continue;
				}
				foreach ( $aggregate[ $type ] as $entry ) {
					if ( ! is_array( $entry ) ) {
						continue;
					}
					$label = isset( $entry['label'] ) ? trim( (string) $entry['label'] ) : '';
					if ( '' === $label || ! isset( $wanted_labels[ $label ] ) ) {
						continue;
					}
					$value   = isset( $entry['value'] ) && is_array( $entry['value'] ) ? $entry['value'] : array();
					$desktop = isset( $value['desktop'] ) && is_array( $value['desktop'] ) ? $value['desktop'] : array();
					if ( empty( $desktop ) ) {
						continue;
					}
					$body = call_user_func( $renderer, $desktop );
					if ( '' === $body ) {
						continue;
					}
					$class_blocks[ '.' . $label ] = $body;
					++$counts['atomic'];
					$ids[] = isset( $entry['id'] ) ? (string) $entry['id'] : $label;
				}
			}
		}

		/**
		 * .<label> body for an atomic typography class (desktop props map 1:1 to
		 * CSS properties in the v2 reader's output).
		 *
		 * @param array $d Desktop prop map.
		 * @return string
		 */
		private static function atomic_typography_body( $d ) {
			$decls = array();
			foreach ( $d as $prop => $val ) {
				$val = trim( (string) $val );
				if ( '' === $val ) {
					continue;
				}
				$decls[] = $prop . ': ' . $val . ';';
			}
			return implode( ' ', $decls );
		}

		/**
		 * .<label> body for an atomic padding class (values are unitless px sizes).
		 *
		 * @param array $d Desktop { top, right, bottom, left }.
		 * @return string
		 */
		private static function atomic_padding_body( $d ) {
			$sides = array(
				'padding-top'    => isset( $d['top'] ) ? $d['top'] : null,
				'padding-right'  => isset( $d['right'] ) ? $d['right'] : null,
				'padding-bottom' => isset( $d['bottom'] ) ? $d['bottom'] : null,
				'padding-left'   => isset( $d['left'] ) ? $d['left'] : null,
			);
			$decls = array();
			foreach ( $sides as $prop => $v ) {
				if ( null === $v || '' === $v ) {
					continue;
				}
				$decls[] = $prop . ': ' . self::px( $v ) . ';';
			}
			return implode( ' ', $decls );
		}

		/**
		 * .<label> body for an atomic gap class.
		 *
		 * @param array $d Desktop { row, column }.
		 * @return string
		 */
		private static function atomic_gap_body( $d ) {
			$row = isset( $d['row'] ) && '' !== $d['row'] ? self::px( $d['row'] ) : null;
			$col = isset( $d['column'] ) && '' !== $d['column'] ? self::px( $d['column'] ) : null;
			if ( null === $row && null === $col ) {
				return '';
			}
			if ( null === $row ) {
				$row = $col;
			}
			if ( null === $col ) {
				$col = $row;
			}
			return 'gap: ' . $row . ' ' . $col . ';';
		}

		/**
		 * .<label> body for an atomic border class.
		 *
		 * @param array $d Desktop { width:{top,right,bottom,left}, color, style }.
		 * @return string
		 */
		private static function atomic_border_body( $d ) {
			$decls = array();
			$w     = isset( $d['width'] ) && is_array( $d['width'] ) ? $d['width'] : array();
			$sides = array(
				'border-top-width'    => isset( $w['top'] ) ? $w['top'] : null,
				'border-right-width'  => isset( $w['right'] ) ? $w['right'] : null,
				'border-bottom-width' => isset( $w['bottom'] ) ? $w['bottom'] : null,
				'border-left-width'   => isset( $w['left'] ) ? $w['left'] : null,
			);
			foreach ( $sides as $prop => $v ) {
				if ( null === $v || '' === $v ) {
					continue;
				}
				$decls[] = $prop . ': ' . self::px( $v ) . ';';
			}
			if ( ! empty( $d['style'] ) ) {
				$decls[] = 'border-style: ' . trim( (string) $d['style'] ) . ';';
			}
			if ( ! empty( $d['color'] ) ) {
				$decls[] = 'border-color: ' . trim( (string) $d['color'] ) . ';';
			}
			return implode( ' ', $decls );
		}

		/**
		 * .<label> body for an atomic border-radius class.
		 *
		 * @param array $d Desktop { topLeft, topRight, bottomRight, bottomLeft }.
		 * @return string
		 */
		private static function atomic_border_radius_body( $d ) {
			$corners = array( 'topLeft', 'topRight', 'bottomRight', 'bottomLeft' );
			$vals    = array();
			$any     = false;
			foreach ( $corners as $c ) {
				$v = isset( $d[ $c ] ) && '' !== $d[ $c ] ? self::px( $d[ $c ] ) : '0';
				if ( isset( $d[ $c ] ) && '' !== $d[ $c ] ) {
					$any = true;
				}
				$vals[] = $v;
			}
			if ( ! $any ) {
				return '';
			}
			return 'border-radius: ' . implode( ' ', $vals ) . ';';
		}

		/**
		 * .<label> body for an atomic shadow class.
		 *
		 * @param array $d Desktop { hOffset, vOffset, blur, spread, color, position }.
		 * @return string
		 */
		private static function atomic_shadow_body( $d ) {
			if ( empty( $d['color'] ) ) {
				return '';
			}
			$parts  = array(
				self::px( isset( $d['hOffset'] ) ? $d['hOffset'] : 0 ),
				self::px( isset( $d['vOffset'] ) ? $d['vOffset'] : 0 ),
				self::px( isset( $d['blur'] ) ? $d['blur'] : 0 ),
				self::px( isset( $d['spread'] ) ? $d['spread'] : 0 ),
				trim( (string) $d['color'] ),
			);
			$shadow = implode( ' ', $parts );
			if ( isset( $d['position'] ) && 'inset' === $d['position'] ) {
				$shadow = 'inset ' . $shadow;
			}
			return 'box-shadow: ' . $shadow . ';';
		}

		/**
		 * Render a numeric size as a px length; pass through values that already
		 * carry a unit.
		 *
		 * @param mixed $v Size (number or string).
		 * @return string
		 */
		private static function px( $v ) {
			$s = trim( (string) $v );
			if ( '' === $s ) {
				return '0';
			}
			if ( preg_match( '/[a-z%]$/i', $s ) ) {
				return $s; // Already has a unit.
			}
			return $s . 'px';
		}

		// ── Persistence ─────────────────────────────────────────────────────────

		/**
		 * Append the compatibility aliases + classes to the #uichemy-globals block,
		 * skipping any token/class already present so we never clobber the user's
		 * own globals. Non-destructive: existing block CSS is preserved verbatim.
		 *
		 * @param array $root_aliases :root lines (may contain dupes; deduped here).
		 * @param array $class_blocks [ '.selector' => 'body' ].
		 * @return bool Whether anything was written.
		 */
		private static function apply_to_block( $root_aliases, $class_blocks ) {
			if ( empty( $root_aliases ) && empty( $class_blocks ) ) {
				return false;
			}
			if ( ! class_exists( 'UiChemy_Composer_Manager' ) || ! class_exists( 'UiChemy_Globals_CSS' ) ) {
				return false;
			}

			$existing = UiChemy_Composer_Manager::get_globals_block_css();

			// Dedupe is done with a raw-string scan of the existing block rather
			// than the structured parser: the parser skips :root tokens that sit in
			// a block following a top-level /* comment */ (which our own appended
			// section starts with), so a parse-based check missed our aliases on a
			// re-run and re-appended them. A membership scan is format-independent
			// and keeps the migration truly idempotent even if it runs twice. It
			// also guarantees we never clobber a same-named token/class the user
			// already defined.
			$root_out = array();
			$seen     = array();
			foreach ( $root_aliases as $line ) {
				$line = trim( $line );
				if ( '' === $line || isset( $seen[ $line ] ) ) {
					continue;
				}
				$name = '';
				if ( preg_match( '/^(--[\w-]+)\s*:/', $line, $mm ) ) {
					$name = $mm[1];
				}
				// Skip when a declaration of the same custom property already exists
				// anywhere in the block. The lookbehind + `\s*:` avoids a false hit
				// on a longer name that shares this prefix (--primary vs --primary-x).
				if ( '' !== $name
					&& preg_match( '/(?<![\w-])' . preg_quote( $name, '/' ) . '\s*:/', $existing ) ) {
					continue;
				}
				$seen[ $line ] = true;
				$root_out[]    = $line;
			}

			// Group the :root lines into a Colors collection and a compatibility
			// collection using IN-BLOCK section-header comments (/* Colors */ …),
			// which is the format the Globals manager expects. Crucially there is
			// NO top-level comment before `:root` — a comment there makes both the
			// PHP parser and the composer's JS parser read the selector as
			// "/* … */ :root" instead of ":root", so the whole token block is
			// dropped and colours never appear in the Globals manager.
			$color_lines  = array();
			$compat_lines = array();
			foreach ( $root_out as $line ) {
				$value = '';
				if ( preg_match( '/:\s*(.+?);?$/', $line, $vm ) ) {
					$value = trim( $vm[1] );
				}
				if ( '' !== $value && class_exists( 'UiChemy_Globals_CSS' ) && UiChemy_Globals_CSS::is_color_value( $value ) ) {
					$color_lines[] = $line;
				} else {
					$compat_lines[] = $line;
				}
			}

			$chunk = '';
			if ( ! empty( $color_lines ) || ! empty( $compat_lines ) ) {
				$root = ":root {\n";
				if ( ! empty( $color_lines ) ) {
					$root .= "\t/* Colors */\n\t" . implode( "\n\t", $color_lines ) . "\n";
				}
				if ( ! empty( $compat_lines ) ) {
					$root .= "\t/* Elementor Migration */\n\t" . implode( "\n\t", $compat_lines ) . "\n";
				}
				$root  .= "}\n";
				$chunk .= $root;
			}
			foreach ( $class_blocks as $selector => $body ) {
				// Skip when the selector already has a rule in the block, so we
				// preserve the user's own class of the same name.
				if ( preg_match( '/(?<![\w.-])' . preg_quote( $selector, '/' ) . '\s*\{/', $existing ) ) {
					continue;
				}
				$body = trim( $body );
				if ( '' === $body ) {
					continue;
				}
				$chunk .= $selector . " {\n\t" . $body . "\n}\n";
			}

			if ( '' === trim( $chunk ) ) {
				return false;
			}

			$new = trim( $existing );
			$new = ( '' === $new ? '' : $new . "\n\n" ) . trim( $chunk );
			UiChemy_Composer_Manager::upsert_globals_block( $new );
			return true;
		}

		/**
		 * Merge native tokens into uichemy_globals_variable, never overwriting an
		 * id the user already has.
		 *
		 * @param array $native_tokens Token rows.
		 * @return bool Whether anything was written.
		 */
		private static function apply_native_tokens( $native_tokens ) {
			if ( empty( $native_tokens ) || ! class_exists( 'UiChemy_Variables' ) ) {
				return false;
			}

			$current = UiChemy_Variables::get_variables();
			$have    = array();
			foreach ( $current as $v ) {
				if ( ! empty( $v['id'] ) ) {
					$have[ $v['id'] ] = true;
				}
			}

			$added = false;
			foreach ( $native_tokens as $t ) {
				$id = isset( $t['id'] ) ? sanitize_key( (string) $t['id'] ) : '';
				if ( '' === $id || isset( $have[ $id ] ) ) {
					continue;
				}
				$have[ $id ] = true;
				$current[]   = $t;
				$added       = true;
			}

			if ( $added ) {
				UiChemy_Variables::update_variables( $current );
			}
			return $added;
		}

		/**
		 * Clear the Elementor CSS cache so regenerated kit/page CSS is served. The
		 * UiChemy block + variables are read live per request, so no UiChemy-side
		 * cache needs clearing.
		 *
		 * @return void
		 */
		private static function regenerate_cache() {
			if ( class_exists( '\Elementor\Plugin' )
				&& isset( \Elementor\Plugin::$instance->files_manager )
				&& method_exists( \Elementor\Plugin::$instance->files_manager, 'clear_cache' ) ) {
				\Elementor\Plugin::$instance->files_manager->clear_cache();
			}
		}

		/**
		 * Stamp the one-time migration flag. Stored as a simple boolean `true`
		 * (autoload off) — the flag only needs to record that the migration has
		 * run so it never repeats.
		 *
		 * @return void
		 */
		private static function write_flag() {
			update_option( self::FLAG_OPTION, true, false );
		}
	}
}
