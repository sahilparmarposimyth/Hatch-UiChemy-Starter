<?php
/**
 * UiChemy Theme Globals — publish UiChemy's colour tokens into the block
 * theme's global styles so they appear in Site Editor → Styles → Colors →
 * "Edit palette" under THEME, and in every block colour picker.
 *
 * Direction is UiChemy → theme.json, resolved live on each request: we filter
 * the theme-origin data instead of writing the theme's `theme.json` file or the
 * user's Global Styles post. So editing a colour in UiChemy's Globals manager
 * updates the FSE palette with no sync step, and deactivating the plugin leaves
 * nothing behind to clean up.
 *
 * The Globals manager already reads the other way (theme.json → Globals, the
 * add-only "Theme Sync" in the composer). This closes the loop.
 *
 * Values are resolved to a literal colour where possible so the palette swatch
 * renders in the Styles sidebar, which lives outside the editor canvas and does
 * not carry UiChemy's `:root` variable stylesheet.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Theme_Globals' ) ) {

	/**
	 * Bridges UiChemy colour variables into theme.json's theme-origin presets.
	 */
	class UiChemy_Theme_Globals {

		/**
		 * How many `var(--x)` hops to follow when resolving a token to a literal.
		 */
		const MAX_VAR_DEPTH = 5;

		/**
		 * Prefixed onto every palette label. WordPress groups the palette panel
		 * only by origin (Default / Theme / Custom) and a plugin can only reach
		 * the Theme origin, so without this our swatches are indistinguishable
		 * from the theme's own — the name is the single place the UI shows where
		 * a colour came from (swatch tooltip + the detail panel).
		 */
		const LABEL_PREFIX = 'UiChemy: ';

		/**
		 * Register hooks.
		 *
		 * @return void
		 */
		public static function init() {
			add_filter( 'wp_theme_json_data_theme', array( __CLASS__, 'filter_theme_json' ) );

			// Global styles are cached per request (and in the non-persistent
			// `theme_json` group), so a save made in the same request that then
			// renders the editor would otherwise serve the stale palette. Watch
			// BOTH token stores — the site head option carries the
			// #uichemy-globals block that the Globals manager and imports write.
			$options = array( UiChemy_Variables::OPTION );
			if ( class_exists( 'UiChemy_Composer_Manager' ) ) {
				$options[] = UiChemy_Composer_Manager::SITE_CUSTOM_CODE_OPTION;
			}
			foreach ( $options as $option ) {
				add_action( 'add_option_' . $option, array( __CLASS__, 'flush_theme_json_cache' ) );
				add_action( 'update_option_' . $option, array( __CLASS__, 'flush_theme_json_cache' ) );
			}
		}

		/**
		 * Merge UiChemy's colour tokens into the theme's palette + gradients.
		 *
		 * @param WP_Theme_JSON_Data $theme_json Theme-origin data.
		 * @return WP_Theme_JSON_Data
		 */
		public static function filter_theme_json( $theme_json ) {
			if ( ! is_object( $theme_json ) || ! method_exists( $theme_json, 'get_data' ) ) {
				return $theme_json;
			}

			$presets = self::build_presets();
			if ( empty( $presets['palette'] ) && empty( $presets['gradients'] ) ) {
				return $theme_json;
			}

			$data = $theme_json->get_data();
			if ( ! is_array( $data ) ) {
				return $theme_json;
			}

			foreach ( array( 'palette', 'gradients' ) as $key ) {
				if ( empty( $presets[ $key ] ) ) {
					continue;
				}
				$current                           = isset( $data['settings']['color'][ $key ] ) ? $data['settings']['color'][ $key ] : array();
				$data['settings']['color'][ $key ] = self::apply_presets( $current, $presets[ $key ] );
			}

			return $theme_json->update_with( $data );
		}

		/**
		 * Drop the cached global styles so the next read rebuilds the palette.
		 *
		 * @return void
		 */
		public static function flush_theme_json_cache() {
			if ( function_exists( 'wp_clean_theme_json_cache' ) ) {
				wp_clean_theme_json_cache();
			}
		}

		/**
		 * Every UiChemy design token, from BOTH stores, as { id, name, type, value }.
		 *
		 * UiChemy keeps tokens in two places and they are not mirrored:
		 *
		 *  1. The `#uichemy-globals` <style> block in the site head — the
		 *     documented source of truth, and what the Composer's Globals manager
		 *     (and an import that carries its own block) reads and writes.
		 *  2. The `uichemy_globals_variable` option (UiChemy_Variables) — typed
		 *     entries written by the Elementor globals migration, emitted as
		 *     `:root` custom properties on the front end.
		 *
		 * A site can have tokens in either or both, so publishing only one store
		 * silently drops half a design system. The block wins on an id clash,
		 * matching its source-of-truth status.
		 *
		 * Only the block's colour-valued tokens are taken — it also holds spacing,
		 * radius and font tokens, which have no place in a colour palette.
		 *
		 * @return array<int,array<string,mixed>>
		 */
		private static function collect_tokens() {
			$tokens = array();

			if ( class_exists( 'UiChemy_Composer_Manager' ) && class_exists( 'UiChemy_Globals_CSS' ) ) {
				$block = UiChemy_Composer_Manager::get_globals_block_css();
				if ( '' !== trim( (string) $block ) ) {
					$model = UiChemy_Globals_CSS::parse( $block );
					foreach ( $model['tokens'] as $t ) {
						$id = ltrim( (string) $t['name'], '-' );
						if ( '' === $id ) {
							continue;
						}
						$value = (string) $t['value'];
						// Skip non-colour tokens (spacing, radius, fonts). A var()
						// alias is kept — resolve_value() follows it to a literal.
						if ( ! self::is_publishable_value( $value ) ) {
							continue;
						}
						$tokens[] = array(
							'id'    => $id,
							'name'  => $id,
							'type'  => 'color',
							'value' => $value,
						);
					}
				}
			}

			if ( class_exists( 'UiChemy_Variables' ) ) {
				foreach ( UiChemy_Variables::get_variables() as $v ) {
					if ( ! empty( $v['id'] ) ) {
						$tokens[] = $v;
					}
				}
			}

			return $tokens;
		}

		/**
		 * UiChemy colour variables as theme.json presets, split by preset type.
		 *
		 * @return array{palette:array<int,array<string,string>>,gradients:array<int,array<string,string>>}
		 */
		private static function build_presets() {
			$out = array(
				'palette'   => array(),
				'gradients' => array(),
			);

			$vars = self::collect_tokens();
			if ( empty( $vars ) ) {
				return $out;
			}

			// id => raw value, so a token defined as `var(--other)` can be
			// followed to the literal colour it ultimately points at. First write
			// wins, so the block's value is what an alias resolves to — the same
			// precedence the $seen dedupe below applies to the presets themselves.
			$map = array();
			foreach ( $vars as $v ) {
				if ( ! empty( $v['id'] ) && isset( $v['value'] ) && is_string( $v['value'] ) && ! isset( $map[ $v['id'] ] ) ) {
					$map[ $v['id'] ] = $v['value'];
				}
			}

			$seen = array();
			foreach ( $vars as $v ) {
				if ( empty( $v['id'] ) || ! isset( $v['type'] ) || 'color' !== $v['type'] ) {
					continue;
				}

				$value = self::resolve_value( isset( $v['value'] ) && is_string( $v['value'] ) ? $v['value'] : '', $map );
				if ( ! self::is_publishable_value( $value ) ) {
					continue;
				}

				$slug = self::slug( $v['id'] );
				if ( '' === $slug || isset( $seen[ $slug ] ) ) {
					continue;
				}
				$seen[ $slug ] = true;

				$preset = array(
					'slug' => $slug,
					'name' => self::label( $v ),
				);

				// A gradient in `color.palette` renders as a broken swatch, so
				// send it to the Gradient tab instead.
				if ( preg_match( '/\bgradient\s*\(/i', $value ) ) {
					$preset['gradient'] = $value;
					$out['gradients'][] = $preset;
				} else {
					$preset['color']  = $value;
					$out['palette'][] = $preset;
				}
			}

			return $out;
		}

		/**
		 * Merge presets into an existing preset bucket. A UiChemy token replaces
		 * a theme entry with the same slug in place (UiChemy globals are the
		 * site's source of truth, and the theme's ordering is worth keeping);
		 * anything new is appended.
		 *
		 * @param mixed $bucket  Existing preset list from the theme data.
		 * @param array $presets UiChemy presets to merge in.
		 * @return array
		 */
		private static function apply_presets( $bucket, $presets ) {
			// Theme-origin data carries a flat list. Guard the origin-keyed shape
			// too in case a filter earlier in the chain hands us merged data.
			if ( is_array( $bucket ) && ! empty( $bucket ) && ! wp_is_numeric_array( $bucket ) ) {
				$theme           = isset( $bucket['theme'] ) && is_array( $bucket['theme'] ) ? $bucket['theme'] : array();
				$bucket['theme'] = self::merge_presets( $theme, $presets );
				return $bucket;
			}

			return self::merge_presets( is_array( $bucket ) ? $bucket : array(), $presets );
		}

		/**
		 * Replace-by-slug-then-append merge of two flat preset lists.
		 *
		 * @param array $existing Existing presets.
		 * @param array $presets  Presets to merge in.
		 * @return array
		 */
		private static function merge_presets( $existing, $presets ) {
			$by_slug = array();
			foreach ( $presets as $preset ) {
				$by_slug[ $preset['slug'] ] = $preset;
			}

			$out = array();
			foreach ( $existing as $row ) {
				if ( is_array( $row ) && isset( $row['slug'] ) && isset( $by_slug[ $row['slug'] ] ) ) {
					$out[] = $by_slug[ $row['slug'] ];
					unset( $by_slug[ $row['slug'] ] );
					continue;
				}
				$out[] = $row;
			}

			foreach ( $by_slug as $preset ) {
				$out[] = $preset;
			}

			return $out;
		}

		/**
		 * Follow `var(--x)` indirection within UiChemy's own tokens down to the
		 * literal value. A reference that leaves UiChemy (or bottoms out) is
		 * returned as the `var()` expression, which is still valid CSS.
		 *
		 * @param string $value Raw token value.
		 * @param array  $map   id => raw value.
		 * @return string
		 */
		private static function resolve_value( $value, $map ) {
			$value = trim( (string) $value );

			for ( $i = 0; '' !== $value && $i < self::MAX_VAR_DEPTH; $i++ ) {
				if ( ! preg_match( '/^var\(\s*--([A-Za-z0-9_-]+)\s*(?:,[\s\S]*)?\)$/', $value, $m ) ) {
					break;
				}
				if ( ! isset( $map[ $m[1] ] ) ) {
					break;
				}
				$next = trim( (string) $map[ $m[1] ] );
				if ( '' === $next || $next === $value ) {
					break; // Empty or self-referential — stop rather than loop.
				}
				$value = $next;
			}

			return $value;
		}

		/**
		 * Whether a resolved value belongs in the palette: a real colour (or
		 * gradient), or a `var()` expression we couldn't resolve but that the
		 * browser still evaluates.
		 *
		 * @param string $value Resolved value.
		 * @return bool
		 */
		private static function is_publishable_value( $value ) {
			if ( '' === $value ) {
				return false;
			}
			if ( class_exists( 'UiChemy_Globals_CSS' ) && UiChemy_Globals_CSS::is_color_value( $value ) ) {
				return true;
			}
			return (bool) preg_match( '/^var\(\s*--[A-Za-z0-9_-]+/', $value );
		}

		/**
		 * Variable id → theme.json preset slug (drives `--wp--preset--color--*`).
		 *
		 * @param string $id Variable id.
		 * @return string
		 */
		private static function slug( $id ) {
			return sanitize_title( str_replace( '_', '-', (string) $id ) );
		}

		/**
		 * Human label for the palette row, prefixed so the swatch is traceable
		 * back to UiChemy. Variables carry no separate name in the Globals
		 * manager UI, so title-case the id (`brand_primary` → `Brand Primary`)
		 * unless a distinct name was stored.
		 *
		 * Only the display name is prefixed — the slug (and therefore
		 * `--wp--preset--color--<slug>`) is untouched, so anything already
		 * referencing a preset keeps working.
		 *
		 * @param array $v Variable entry.
		 * @return string
		 */
		private static function label( $v ) {
			$id   = (string) $v['id'];
			$name = isset( $v['name'] ) ? trim( (string) $v['name'] ) : '';

			if ( '' === $name || $name === $id ) {
				$name = ucwords( trim( preg_replace( '/[\s_-]+/', ' ', $id ) ) );
			}

			return self::LABEL_PREFIX . $name;
		}
	}

	UiChemy_Theme_Globals::init();
}
