<?php
/**
 * UiChemy — Bricks Builder integration bootstrap.
 *
 * UNVERIFIED INTEGRATION — no Bricks core install was available to test
 * against; see includes/bricks/class-uichemy-bricks-composer.php's header
 * comment for exactly what's verified vs. best-effort here.
 *
 * Safe to require unconditionally: this file never references any
 * \Bricks\* symbol at top level, only inside callbacks gated by
 * class_exists() and hooked late enough (`init`, priority 11) for Bricks —
 * a THEME, which finishes loading after plugins do — to actually be ready.
 * Mirrors the verified pattern from a real third-party Bricks addon.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the UiChemy Composer element with Bricks. No-ops when Bricks
 * isn't the active theme. Priority 11 matches the reference addon's own
 * registration timing — after Bricks' own core elements register on `init`.
 */
add_action(
	'init',
	function () {
		if ( ! class_exists( '\Bricks\Elements' ) ) {
			return;
		}
		// One switch per builder (Settings). Not registering is what actually keeps
		// the element out of Bricks' panel.
		if ( ! uichemy_composer_enabled( 'bricks' ) ) {
			return;
		}
		\Bricks\Elements::register_element( UICHEMY_PATH . 'includes/bricks/class-uichemy-bricks-composer.php' );
	},
	11
);

// Panel-asset enqueueing (bricks_is_builder() gated) lives in
// UiChemy_Composer_Enqueue::enqueue_bricks_editor_script(), hooked on
// `get_footer` alongside the Elementor/Gutenberg equivalents for consistency.
