<?php
/**
 * UiChemy Container Width — a tiny read-only shim for the active Elementor kit's
 * container-width breakpoints.
 *
 * This is NOT a design token in the #uichemy-globals sense — it is an Elementor
 * layout setting the composer needs when sizing containers. It was the one piece
 * of the removed UiChemy_Globals Elementor engine still worth keeping, so it
 * lives here as a self-contained getter (reads the kit's display settings).
 *
 * @package UiChemy
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

if ( ! class_exists( 'UiChemy_Container_Width' ) ) {

	/**
	 * Reads the active kit's container-width breakpoints for the composer.
	 */
	class UiChemy_Container_Width {

		/**
		 * Container widths keyed by device (desktop is raw; the rest are normalized
		 * to null when unset), matching the shape the composer JS expects.
		 *
		 * @return array<string,mixed>|false False when Elementor is inactive.
		 */
		public static function get() {
			if ( ! class_exists( '\Elementor\Plugin' ) ) {
				return false;
			}
			$kit = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend();
			if ( ! $kit ) {
				return false;
			}

			$norm = static function ( $v ) {
				if ( empty( $v ) || ! is_array( $v ) ) {
					return null;
				}
				if ( ! isset( $v['unit'] ) || null === $v['unit'] ) {
					return null;
				}
				if ( ! isset( $v['size'] ) || '' === $v['size'] ) {
					return null;
				}
				return $v;
			};

			return array(
				'desktop'      => $kit->get_settings_for_display( 'container_width' ),
				'tablet'       => $norm( $kit->get_settings_for_display( 'container_width_tablet' ) ),
				'tablet_extra' => $norm( $kit->get_settings_for_display( 'container_width_tablet_extra' ) ),
				'mobile'       => $norm( $kit->get_settings_for_display( 'container_width_mobile' ) ),
				'mobile_extra' => $norm( $kit->get_settings_for_display( 'container_width_mobile_extra' ) ),
				'widescreen'   => $norm( $kit->get_settings_for_display( 'container_width_widescreen' ) ),
				'laptop'       => $norm( $kit->get_settings_for_display( 'container_width_laptop' ) ),
			);
		}
	}
}
