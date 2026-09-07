<?php
/**
 * UiChemy Elementor Globals — a focused read/write bridge to the active
 * Elementor kit's global Colors and Typography.
 *
 * The #uichemy-globals CSS block is UiChemy's own source of truth for design
 * tokens; this class exists ONLY so the Globals Manager can offer a two-way
 * "Elementor Sync" (UiChemy globals ⇄ Elementor Site Settings globals). It is
 * a trimmed revival of the read/write parts of the old UiChemy_Globals engine
 * (kept just get/set for colours + typography, plus the kit save + CSS refresh
 * plumbing those writes require).
 *
 * @package UiChemy
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

if ( ! class_exists( 'UiChemy_Elementor_Globals' ) ) {

	/**
	 * Read/write the active kit's global colours and typography.
	 */
	class UiChemy_Elementor_Globals {

		/**
		 * True when Elementor is active and a frontend kit is resolvable.
		 *
		 * @return bool
		 */
		public static function is_available() {
			return class_exists( '\Elementor\Plugin' ) && (bool) self::get_kit();
		}

		/**
		 * Active kit document (or null when Elementor is inactive).
		 *
		 * @return \Elementor\Core\Kits\Documents\Kit|null
		 */
		private static function get_kit() {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return null;
			}
			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();
			return $kit ? $kit : null;
		}

		/**
		 * The kit's stored settings meta merged with the four repeaters we edit,
		 * mirroring the shape Elementor's page-settings manager expects on save.
		 *
		 * @return array
		 */
		private static function get_all_kit_settings() {
			$kit = self::get_kit();
			if ( ! $kit ) {
				return array();
			}

			$page_settings_manager = \Elementor\Core\Settings\Manager::get_settings_managers( 'page' );
			$meta_key              = $page_settings_manager::META_KEY;
			$document_settings     = $kit->get_meta( $meta_key );

			if ( ! $document_settings ) {
				$document_settings = array();
			}

			$defaults = array(
				'custom_colors'     => $kit->get_settings_for_display( 'custom_colors' ),
				'system_colors'     => $kit->get_settings_for_display( 'system_colors' ),
				'custom_typography' => $kit->get_settings_for_display( 'custom_typography' ),
				'system_typography' => $kit->get_settings_for_display( 'system_typography' ),
			);

			foreach ( array( 'custom_colors', 'system_colors', 'custom_typography', 'system_typography' ) as $key ) {
				if ( isset( $document_settings[ $key ] ) ) {
					continue;
				}
				$document_settings[ $key ] = ! empty( $defaults[ $key ] ) ? $defaults[ $key ] : array();
			}

			return $document_settings;
		}

		/**
		 * Persist kit settings to the kit document (and every user autosave), then
		 * regenerate the kit CSS so changes show on the frontend immediately.
		 *
		 * @param array $document_settings Full settings array.
		 * @return void
		 */
		private static function save_all_kit_settings( $document_settings ) {
			$kit = self::get_kit();
			if ( ! $kit ) {
				return;
			}

			$page_settings_manager = \Elementor\Core\Settings\Manager::get_settings_managers( 'page' );

			$page_settings_manager->save_settings( $document_settings, $kit->get_id() );

			$all_users = get_users( array( 'fields' => array( 'ID' ) ) );
			foreach ( $all_users as $user ) {
				$autosave = $kit->get_autosave( $user->ID );
				if ( $autosave ) {
					$page_settings_manager->save_settings( $document_settings, $autosave->get_id() );
					self::refresh_css_and_clear_cache( $autosave->get_id() );
				}
			}

			self::refresh_css_and_clear_cache( $kit->get_id() );
		}

		/**
		 * Delete + re-enqueue the post CSS for a document so the kit's regenerated
		 * global CSS is served.
		 *
		 * @param int $id Document id.
		 * @return void
		 */
		private static function refresh_css_and_clear_cache( $id ) {
			$post_css = \Elementor\Core\Files\CSS\Post::create( $id );
			$post_css->delete();

			\Elementor\Plugin::$instance->documents->get( $id, false );

			$post_css = \Elementor\Core\Files\CSS\Post::create( $id );
			$post_css->enqueue();
		}

		/**
		 * All kit global colours (system + custom), normalized to { id, title, value }.
		 *
		 * @return array<int,array<string,string>>
		 */
		public static function get_colors() {
			$kit = self::get_kit();
			if ( ! $kit ) {
				return array();
			}

			$system = $kit->get_settings_for_display( 'system_colors' );
			$custom = $kit->get_settings_for_display( 'custom_colors' );
			$items  = array_merge( is_array( $system ) ? $system : array(), is_array( $custom ) ? $custom : array() );

			$out = array();
			foreach ( $items as $item ) {
				if ( empty( $item['_id'] ) ) {
					continue;
				}
				$out[] = array(
					'id'    => $item['_id'],
					'title' => isset( $item['title'] ) ? $item['title'] : $item['_id'],
					'value' => isset( $item['color'] ) ? $item['color'] : '',
				);
			}
			return $out;
		}

		/**
		 * All kit global typography (system + custom), normalized to
		 * { id, title, value: { typography_* } }.
		 *
		 * @return array<int,array<string,mixed>>
		 */
		public static function get_typography() {
			$kit = self::get_kit();
			if ( ! $kit ) {
				return array();
			}

			$system = $kit->get_settings_for_display( 'system_typography' );
			$custom = $kit->get_settings_for_display( 'custom_typography' );
			$items  = array_merge( is_array( $system ) ? $system : array(), is_array( $custom ) ? $custom : array() );

			$out = array();
			foreach ( $items as $item ) {
				if ( empty( $item['_id'] ) ) {
					continue;
				}
				$id    = $item['_id'];
				$title = isset( $item['title'] ) ? $item['title'] : $id;
				unset( $item['_id'], $item['title'] );
				$out[] = array(
					'id'    => $id,
					'title' => $title,
					'value' => $item,
				);
			}
			return $out;
		}

		/**
		 * Create-or-update a global colour by id (matches system first, then
		 * custom; appends to custom when absent).
		 *
		 * @param string $id    Colour id.
		 * @param string $title Display title.
		 * @param string $val   Colour value.
		 * @return void
		 */
		public static function set_or_create_color( $id, $title, $val ) {
			$document_settings = self::get_all_kit_settings();
			self::apply_color_row( $document_settings, $id, $title, $val );
			self::save_all_kit_settings( $document_settings );
		}

		/**
		 * Create-or-update many colours + typography in ONE kit read/save cycle.
		 *
		 * The per-item set_or_create_* helpers each re-read and re-save the whole
		 * kit (and every user autosave + CSS regeneration); calling them once per
		 * token turns a sync into O(tokens × users) writes. This batches all
		 * changes into a single settings mutation and a single save.
		 *
		 * @param array<int,array<string,string>> $colors     Rows of { id, title, value }.
		 * @param array<int,array<string,mixed>>  $typography Rows of { id, title, value }.
		 * @return array{colors:int,typography:int} Applied counts.
		 */
		public static function set_or_create_many( $colors, $typography ) {
			$document_settings = self::get_all_kit_settings();

			$n_colors = 0;
			foreach ( (array) $colors as $c ) {
				if ( empty( $c['id'] ) ) {
					continue;
				}
				self::apply_color_row( $document_settings, $c['id'], isset( $c['title'] ) ? $c['title'] : $c['id'], isset( $c['value'] ) ? $c['value'] : '' );
				++$n_colors;
			}

			$n_typo = 0;
			foreach ( (array) $typography as $t ) {
				if ( empty( $t['id'] ) ) {
					continue;
				}
				self::apply_typography_row( $document_settings, $t['id'], isset( $t['title'] ) ? $t['title'] : $t['id'], isset( $t['value'] ) ? $t['value'] : array() );
				++$n_typo;
			}

			if ( $n_colors || $n_typo ) {
				self::save_all_kit_settings( $document_settings );
			}

			return array(
				'colors'     => $n_colors,
				'typography' => $n_typo,
			);
		}

		/**
		 * Replace-or-append a colour row inside an in-memory settings array
		 * (matches system first, then custom; appends to custom when absent). No
		 * DB write — the caller persists once.
		 *
		 * @param array  $document_settings Settings array (by reference).
		 * @param string $id                Colour id.
		 * @param string $title             Display title.
		 * @param string $val               Colour value.
		 * @return void
		 */
		private static function apply_color_row( &$document_settings, $id, $title, $val ) {
			$db_item = array(
				'_id'   => $id,
				'title' => $title,
				'color' => $val,
			);

			$system = &$document_settings['system_colors'];
			$custom = &$document_settings['custom_colors'];
			$found  = false;

			foreach ( $system as &$row ) {
				if ( isset( $row['_id'] ) && $row['_id'] === $id ) {
					$row   = $db_item;
					$found = true;
					break;
				}
			}
			unset( $row );

			if ( ! $found ) {
				foreach ( $custom as &$row ) {
					if ( isset( $row['_id'] ) && $row['_id'] === $id ) {
						$row   = $db_item;
						$found = true;
						break;
					}
				}
				unset( $row );
			}

			if ( ! $found ) {
				$custom[] = $db_item;
			}
		}

		/**
		 * Create-or-update a global typography item by id. `$value` is a flat map
		 * of Elementor typography_* keys (font_size etc. as { unit, size } arrays).
		 *
		 * @param string $id    Typography id.
		 * @param string $title Display title.
		 * @param array  $value Typography_* properties.
		 * @return void
		 */
		public static function set_or_create_typography( $id, $title, $value ) {
			$document_settings = self::get_all_kit_settings();
			self::apply_typography_row( $document_settings, $id, $title, $value );
			self::save_all_kit_settings( $document_settings );
		}

		/**
		 * Replace-or-append a typography row inside an in-memory settings array.
		 * No DB write — the caller persists once.
		 *
		 * @param array  $document_settings Settings array (by reference).
		 * @param string $id                Typography id.
		 * @param string $title             Display title.
		 * @param array  $value             Typography_* properties.
		 * @return void
		 */
		private static function apply_typography_row( &$document_settings, $id, $title, $value ) {
			$db_item = array(
				'_id'   => $id,
				'title' => $title,
			);
			foreach ( (array) $value as $key => $v ) {
				$db_item[ $key ] = is_object( $v ) ? (array) $v : $v;
			}

			$system = &$document_settings['system_typography'];
			$custom = &$document_settings['custom_typography'];
			$found  = false;

			foreach ( $system as &$row ) {
				if ( isset( $row['_id'] ) && $row['_id'] === $id ) {
					$row   = $db_item;
					$found = true;
					break;
				}
			}
			unset( $row );

			if ( ! $found ) {
				foreach ( $custom as &$row ) {
					if ( isset( $row['_id'] ) && $row['_id'] === $id ) {
						$row   = $db_item;
						$found = true;
						break;
					}
				}
				unset( $row );
			}

			if ( ! $found ) {
				$custom[] = $db_item;
			}
		}
	}
}
