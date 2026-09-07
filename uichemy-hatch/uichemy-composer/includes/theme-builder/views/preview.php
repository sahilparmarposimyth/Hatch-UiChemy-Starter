<?php
/**
 * Isolated canvas preview of a single UiChemy template.
 *
 * Rendered by UiChemy_Template_Render::maybe_preview() (already capability- and
 * nonce-checked). Outputs a minimal HTML document — no theme header/footer — so
 * the template is seen on its own, with Elementor's frontend CSS (via wp_head)
 * and the template's own inlined CSS.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title><?php esc_html_e( 'Template Preview UiChemy', 'uichemy' ); ?></title>
	<?php wp_head(); ?>
	<style>
		html, body.uichemy-tb-preview { margin: 0; padding: 0; background: #fff; }
	</style>
</head>
<body <?php body_class( 'uichemy-tb-preview' ); ?>>
<?php
if ( class_exists( 'UiChemy_Template_Render' ) ) {
	// Trusted Elementor builder output (CSS inlined), echoed as-is.
	echo UiChemy_Template_Render::get_render_html(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}
wp_footer();
?>
</body>
</html>
