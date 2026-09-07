<?php
/**
 * Plugin Name:       UiChemy + Hatch — Figma Converter for Elementor, Gutenberg and Bricks
 * Plugin URI:        https://uichemy.com
 * Description:       Convert Figma Design to 100% Editable WordPress websites in Elementor Website Builder and Gutenberg aka WordPress Block Editor. Bundles Hatch, which publishes the result as a static headless frontend — see "Sync with Elementor" in the dashboard. SUPERSEDES the standalone UiChemy and Hatch plugins: deactivate UiChemy before activating this, and a standalone Hatch is retired automatically.
 * Version:           5.1.0
 * Author:            POSIMYTH
 * Author URI:        https://posimyth.com
 * License:           GPLv3
 * License URI:       https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain:       uichemy
 * Requires at least: 6.9
 * Tested up to:      7.1
 * Requires PHP:      7.4
 *
 * @link              https://posimyth.com
 * @package           Uichemy
 */

/** If this file is called directly, abort. */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'UICH_VERSION', '5.1.0' );
define( 'UICH_FILE', __FILE__ );
define( 'UICH_PATH', plugin_dir_path( __FILE__ ) );
define( 'UICH_URL', plugins_url( '/', __FILE__ ) );
define( 'UICH_BDNAME', basename( __DIR__ ) );
define( 'UICH_PBNAME', plugin_basename( __FILE__ ) );
define( 'UICH_USER_OPTION', 'uichemy_user' );
define( 'UICH_ADMIN_NOTICE_FALG', 1 );

/**
 * Brand helpers (name / logo / menu icon) — see includes/class-uich-brand.php.
 *
 * Required here, before anything else, because `admin_menu`, the editor enqueues
 * and the dashboard boot payload all brand themselves through these functions.
 */
require UICH_PATH . 'includes/class-uich-brand.php';

require UICH_PATH . 'includes/class-uich-uichemy.php';

/**
 * The merged UiChemy builder runtime (uichemy-composer/).
 *
 * Required here, at plugin-file load time, rather than from
 * Uich_Uichemy::uich_load_dependencies() — that method already runs INSIDE
 * `plugins_loaded`, and the runtime registers its own `plugins_loaded` callback,
 * which is unreliable to add while that same hook is mid-flight.
 */
require UICH_PATH . 'includes/composer/class-uich-composer-loader.php';

/**
 * The merged Hatch runtime (hatch/) — headless WordPress, reached from the
 * dashboard's "Sync with Elementor" screen.
 *
 * Required here for two reasons. Hatch calls `Hatch::instance()` on the last
 * line of its own plugin file and registers every one of its hooks at top
 * level, so loading it before `plugins_loaded` is what reproduces the exact
 * timing it had as a standalone plugin. And its loader calls
 * `register_activation_hook()`, which only takes effect when it runs during the
 * activation request itself — i.e. at plugin-file load time, not from inside a
 * hook that fires later.
 */
require UICH_PATH . 'includes/hatch/class-uich-hatch-loader.php';
