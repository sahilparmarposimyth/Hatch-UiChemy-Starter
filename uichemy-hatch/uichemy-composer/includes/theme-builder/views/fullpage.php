<?php
/**
 * Full-page view for a UiChemy native template rendered via template_include
 * (the 404 location and the single post/page location).
 *
 * Wraps the resolved template's Elementor content in the active theme's
 * header/footer so it integrates like any WordPress template. Any HTTP status
 * WordPress set for this request (e.g. 404) is left untouched.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

if ( class_exists( 'UiChemy_Template_Render' ) ) {
	// get_render_html() returns Elementor-rendered markup with the document CSS
	// inlined; it is trusted builder output, echoed as-is like Elementor's own
	// template loaders do.
	echo UiChemy_Template_Render::get_render_html(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

get_footer();
