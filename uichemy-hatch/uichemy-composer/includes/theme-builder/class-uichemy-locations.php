<?php
/**
 * UiChemy_Locations — inject native header/footer templates into theme locations.
 *
 * Three handlers, chosen by environment:
 *
 *  A. Block themes (FSE): filter `render_block` and replace the output of a
 *     `core/template-part` block in the header/footer area with the active
 *     UiChemy template.
 *
 *  B. Classic Elementor-location-aware themes (Hello & similar): those themes
 *     call `elementor_theme_do_location('header'|'footer')` and render their own
 *     part only when it returns false. On free Elementor that function does not
 *     exist, so we define a minimal shim (only when Elementor Pro has not already
 *     defined it — preserving coexistence).
 *
 *  C. Classic themes that fire their OWN header/footer actions with a default
 *     callback attached (e.g. Nexter: `nexter_header` -> nexter_header_template).
 *     We take that exact action + priority, remove the theme's callback and render
 *     the active UiChemy template. If our render is empty the theme's original
 *     callback is called instead, so a location is never left blank.
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Locations' ) ) {

	/**
	 * Header/footer location rendering for classic + block themes.
	 */
	class UiChemy_Locations {

		/**
		 * Theme callbacks removed by Handler C, keyed by location type. Used as the
		 * fallback so a location is never left empty when our render is empty.
		 *
		 * @var array<string, callable|string>
		 */
		private static $replaced_defaults = array();

		/**
		 * Register hooks. No-op in the admin.
		 *
		 * @return void
		 */
		public static function init() {
			if ( is_admin() ) {
				return;
			}

			// Environment detection needs the theme fully set up, so defer to
			// after_setup_theme (fires after plugins_loaded, before templates).
			add_action( 'after_setup_theme', array( __CLASS__, 'register_handlers' ), 20 );

			// Ensure Elementor's base frontend CSS is present whenever a
			// header/footer will render (static-guarded inside Elementor).
			add_action( 'wp_enqueue_scripts', array( __CLASS__, 'maybe_enqueue_styles' ), 5 );

			// Front-end admin-bar shortcuts to edit whichever UiChemy templates
			// render on the current page.
			add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar_links' ), 100 );
		}

		/**
		 * Add "Edit … (UiChemy)" admin-bar links for the templates rendering on
		 * the current front-end request.
		 *
		 * @param WP_Admin_Bar $bar Admin bar instance.
		 * @return void
		 */
		public static function admin_bar_links( $bar ) {
			if ( is_admin() || ! is_admin_bar_showing() ) {
				return;
			}
			if ( ! class_exists( '\Elementor\Plugin' ) || ! class_exists( 'UiChemy_Template_Resolver' ) ) {
				return;
			}

			// One resolved brand name for every label below — white-labelled when the
			// site configured it, "UiChemy" otherwise.
			$brand = function_exists( 'uich_brand_name' ) ? uich_brand_name() : __( 'UiChemy', 'uichemy' );

			$candidates = array(
				'header' => sprintf( /* translators: %s: plugin name. */ __( 'Edit Header (%s)', 'uichemy' ), $brand ),
				'footer' => sprintf( /* translators: %s: plugin name. */ __( 'Edit Footer (%s)', 'uichemy' ), $brand ),
			);
			if ( is_singular() ) {
				$candidates['single'] = sprintf( /* translators: %s: plugin name. */ __( 'Edit Single Template (%s)', 'uichemy' ), $brand );
			}
			if ( is_404() ) {
				$candidates['error_404'] = sprintf( /* translators: %s: plugin name. */ __( 'Edit 404 Template (%s)', 'uichemy' ), $brand );
			}

			$nodes = array();
			foreach ( $candidates as $type => $label ) {
				$id = UiChemy_Template_Resolver::resolve( $type );
				if ( $id && current_user_can( 'edit_post', $id ) ) {
					$nodes[ $type ] = array(
						'label' => $label,
						'id'    => $id,
					);
				}
			}

			if ( empty( $nodes ) ) {
				return;
			}

			$bar->add_node(
				array(
					'id'    => 'uichemy-theme-builder',
					// White-labelled: this node sits in the front-end admin bar, the
					// most visible place our name appeared on a rebranded site.
					/* translators: %s: plugin name (white-labelled when configured). */
					'title' => sprintf( __( '%s Templates', 'uichemy' ), $brand ),
				)
			);

			foreach ( $nodes as $type => $node ) {
				$bar->add_node(
					array(
						'parent' => 'uichemy-theme-builder',
						'id'     => 'uichemy-tb-' . $type,
						'title'  => $node['label'],
						'href'   => add_query_arg(
							array(
								'post'   => $node['id'],
								'action' => 'elementor',
							),
							admin_url( 'post.php' )
						),
					)
				);
			}
		}

		/**
		 * Describe the current theme environment for the admin UI: which handler
		 * applies, whether header/footer rendering is supported, and whether
		 * another theme-builder system is active (coexistence warning).
		 *
		 * Safe to call in the admin (theme is set up by then).
		 *
		 * @return array{type:string,headerFooterSupported:bool,conflicts:string[],woocommerce:bool}
		 */
		public static function environment() {
			if ( function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() ) {
				$type      = 'block';
				$supported = true;
			} elseif ( self::is_nexter_theme() ) {
				// Nexter theme: header/footer render through the nexter_header /
				// nexter_footer actions (not the Elementor Locations API); our
				// Nexter handler drives them.
				$type      = 'nexter';
				$supported = true;
			} elseif ( current_theme_supports( 'elementor-header-footer' ) || has_action( 'elementor/theme/register_locations' ) ) {
				// Themes (e.g. Hello Elementor) that gate header/footer on the
				// Elementor Theme Locations API — our shim drives them.
				$type      = 'elementor';
				$supported = true;
			} elseif ( self::has_theme_action_slots() ) {
				// Handler C — theme fires its own header/footer actions (e.g. Nexter)
				// and we take that slot.
				$type      = 'theme-actions';
				$supported = true;
			} else {
				// Generic classic theme with no recognised header/footer hook: those
				// two locations are best-effort only.
				$type      = 'generic';
				$supported = false;
			}

			$conflicts = array();
			if ( class_exists( '\ElementorPro\Plugin' ) || defined( 'ELEMENTOR_PRO_VERSION' ) ) {
				$conflicts[] = 'elementor_pro';
			}
			if ( post_type_exists( 'nxt_builder' ) ) {
				$conflicts[] = 'nexter';
			}

			return array(
				'type'                  => $type,
				'headerFooterSupported' => $supported,
				'conflicts'             => $conflicts,
				'woocommerce'           => class_exists( 'WooCommerce' ),
			);
		}

		/**
		 * Pick and register the right handler for the active theme.
		 *
		 * @return void
		 */
		public static function register_handlers() {
			if ( function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() ) {
				// Handler A — block theme.
				add_filter( 'render_block', array( __CLASS__, 'filter_template_part_block' ), 10, 2 );
				return;
			}

			// Handler B — classic Elementor-location-aware theme (Hello & similar).
			// The shim is deferred to a late `init`; see maybe_define_do_location().
			self::schedule_do_location_shim();

			// Handler C — themes that fire their own header/footer actions. Deferred
			// to `wp` because resolving a template evaluates display conditions,
			// which need the main query; `wp` still runs before template loading, so
			// the swap lands before the theme outputs its header.
			add_action( 'wp', array( __CLASS__, 'register_theme_action_handlers' ), 5 );
		}

		/**
		 * Whether the active theme is Nexter (or a Nexter child theme). Used only to
		 * label the environment report — the actual header/footer takeover always
		 * goes through the generic Handler C map below, which already includes
		 * Nexter's hooks by default. get_template() returns the parent slug
		 * ('nexter') for child themes too; the function check is a belt-and-braces
		 * fallback.
		 *
		 * @return bool
		 */
		private static function is_nexter_theme() {
			return 'nexter' === get_template() || function_exists( 'nexter_header_template' );
		}

		/**
		 * Whether the active theme fires a header/footer action Handler C can take.
		 *
		 * @return bool
		 */
		private static function has_theme_action_slots() {
			foreach ( self::theme_header_footer_actions() as $slots ) {
				foreach ( (array) $slots as $slot ) {
					if ( ! empty( $slot['action'] ) && has_action( $slot['action'] ) ) {
						return true;
					}
				}
			}
			return false;
		}

		/**
		 * Theme header/footer action slots for Handler C, keyed by location type.
		 *
		 * Each slot names the action the theme fires and the default callback it
		 * attaches, so we can take that exact slot (same action, same priority).
		 * Filterable so a theme or site can register its own hooks.
		 *
		 * @return array<string, array<int, array{action:string,default_callback:string}>>
		 */
		public static function theme_header_footer_actions() {
			$map = array(
				'header' => array(
					// Nexter theme.
					array(
						'action'           => 'nexter_header',
						'default_callback' => 'nexter_header_template',
					),
				),
				'footer' => array(
					array(
						'action'           => 'nexter_footer',
						'default_callback' => 'nexter_footer_template',
					),
				),
			);

			/**
			 * Filter the theme action slots UiChemy takes over for header/footer.
			 *
			 * @param array $map Slots keyed by 'header'/'footer'.
			 */
			$map = apply_filters( 'uichemy/theme_builder/header_footer_actions', $map );

			return is_array( $map ) ? $map : array();
		}

		/**
		 * Handler C — swap the theme's own header/footer callback for ours, but only
		 * for locations where an active UiChemy template actually resolves.
		 *
		 * @return void
		 */
		public static function register_theme_action_handlers() {
			if ( is_admin() || ! class_exists( 'UiChemy_Template_Resolver' ) || ! class_exists( 'UiChemy_Template_Render' ) ) {
				return;
			}

			foreach ( self::theme_header_footer_actions() as $type => $slots ) {
				if ( ! in_array( $type, array( 'header', 'footer' ), true ) || ! is_array( $slots ) ) {
					continue;
				}

				// No active template for this location -> leave the theme alone.
				if ( ! UiChemy_Template_Resolver::resolve( $type ) ) {
					continue;
				}

				foreach ( $slots as $slot ) {
					$action = isset( $slot['action'] ) ? (string) $slot['action'] : '';
					if ( '' === $action || ! has_action( $action ) ) {
						continue;
					}

					$priority = 10;
					$default  = isset( $slot['default_callback'] ) ? $slot['default_callback'] : '';
					if ( $default ) {
						$found = has_action( $action, $default );
						if ( false !== $found ) {
							$priority = (int) $found;
							remove_action( $action, $default, $priority );
							self::$replaced_defaults[ $type ] = $default;
						}
					}

					add_action(
						$action,
						'header' === $type
							? array( __CLASS__, 'render_header_location' )
							: array( __CLASS__, 'render_footer_location' ),
						$priority
					);
				}
			}
		}

		/**
		 * Handler C header callback.
		 *
		 * @return void
		 */
		public static function render_header_location() {
			self::render_theme_action_location( 'header' );
		}

		/**
		 * Handler C footer callback.
		 *
		 * @return void
		 */
		public static function render_footer_location() {
			self::render_theme_action_location( 'footer' );
		}

		/**
		 * Output the active UiChemy template for a theme-action location, falling
		 * back to the theme's own callback when we have nothing to show — a location
		 * must never end up empty just because we claimed it.
		 *
		 * @param string $type 'header' or 'footer'.
		 * @return void
		 */
		private static function render_theme_action_location( $type ) {
			static $done = array();
			if ( isset( $done[ $type ] ) ) {
				return;
			}
			$done[ $type ] = true;

			$id   = UiChemy_Template_Resolver::resolve( $type );
			$html = $id ? UiChemy_Template_Render::get_render_html_for( $id ) : '';

			if ( '' !== $html ) {
				echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Trusted Elementor/UiChemy builder output.
				return;
			}

			if ( ! empty( self::$replaced_defaults[ $type ] ) && is_callable( self::$replaced_defaults[ $type ] ) ) {
				call_user_func( self::$replaced_defaults[ $type ] );
			}
		}

		/**
		 * Replace a block theme's header/footer template-part output with the
		 * active UiChemy template.
		 *
		 * @param string $html  Rendered block HTML.
		 * @param array  $block Parsed block.
		 * @return string
		 */
		public static function filter_template_part_block( $html, $block ) {
			if ( empty( $block['blockName'] ) || 'core/template-part' !== $block['blockName'] ) {
				return $html;
			}

			$attrs = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
			$area  = isset( $attrs['area'] ) ? (string) $attrs['area'] : '';
			$slug  = isset( $attrs['slug'] ) ? (string) $attrs['slug'] : '';

			$type = '';
			if ( 'header' === $area || 'header' === $slug ) {
				$type = 'header';
			} elseif ( 'footer' === $area || 'footer' === $slug ) {
				$type = 'footer';
			}

			if ( '' === $type || ! class_exists( 'UiChemy_Template_Resolver' ) ) {
				return $html;
			}

			$id = UiChemy_Template_Resolver::resolve( $type );
			if ( ! $id ) {
				return $html;
			}

			$rendered = UiChemy_Template_Render::get_render_html_for( $id );
			return ( '' !== $rendered ) ? $rendered : $html;
		}

		/**
		 * Render (echo) the active UiChemy template for an Elementor theme
		 * location, matching the `elementor_theme_do_location()` contract:
		 * returns true when we output a template (theme skips its own), false
		 * otherwise (theme renders normally).
		 *
		 * @param string $location Elementor location slug (header|footer|single|...).
		 * @return bool
		 */
		public static function do_location( $location ) {
			$map = array(
				'header' => 'header',
				'footer' => 'footer',
			);

			if ( ! isset( $map[ $location ] ) || ! class_exists( 'UiChemy_Template_Resolver' ) ) {
				return false;
			}

			$id = UiChemy_Template_Resolver::resolve( $map[ $location ] );
			if ( ! $id ) {
				return false;
			}

			// Trusted Elementor builder output (CSS inlined). Echoed as-is like
			// Elementor's own location renderer.
			echo UiChemy_Template_Render::get_render_html_for( $id ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			return true;
		}

		/**
		 * Enqueue Elementor base frontend styles when a header/footer applies.
		 *
		 * @return void
		 */
		public static function maybe_enqueue_styles() {
			if ( is_admin() || ! class_exists( '\Elementor\Plugin' ) || ! class_exists( 'UiChemy_Template_Resolver' ) ) {
				return;
			}
			if ( UiChemy_Template_Resolver::has_active( 'header' ) || UiChemy_Template_Resolver::has_active( 'footer' ) ) {
				if ( isset( \Elementor\Plugin::$instance->frontend ) ) {
					\Elementor\Plugin::$instance->frontend->enqueue_styles();
				}
				// Header/footer may be Gutenberg-authored — ensure block styles too.
				if ( class_exists( 'UiChemy_Template_Render' ) ) {
					UiChemy_Template_Render::enqueue_block_styles();
				}
			}
		}

		/**
		 * Defer the shim decision until every plugin has had its chance to declare
		 * `elementor_theme_do_location()` itself.
		 *
		 * This cannot be decided from `after_setup_theme`, where register_handlers()
		 * runs. Elementor Pro declares the real function from
		 * `modules/theme-builder/api.php`, required by Theme_Builder_Module's
		 * constructor — which runs on `elementor/init`, inside WordPress `init`, and
		 * therefore LATER than `after_setup_theme`. Checking function_exists() there
		 * always sees "not declared yet", so we would declare the shim first and
		 * Pro's own declaration — a plain top-level `function` with no guard of its
		 * own — would then fatal with "Cannot redeclare".
		 *
		 * Waiting for late `init` inverts that: by then Pro has declared it, our
		 * guard sees it and stands down, and Pro wins as intended. When Pro is not
		 * active (or its theme-builder module never loads) nothing has declared it
		 * and we do, still comfortably before any theme's header.php can call it.
		 *
		 * @return void
		 */
		private static function schedule_do_location_shim() {
			// register_handlers() normally runs on after_setup_theme, so init is
			// still ahead of us. Should this ever be reached after init has already
			// fired, add_action() would never run — decide immediately instead.
			if ( did_action( 'init' ) ) {
				self::maybe_define_do_location();
				return;
			}

			add_action( 'init', array( __CLASS__, 'maybe_define_do_location' ), 99 );
		}

		/**
		 * Declare the shim unless something else already provides the function.
		 *
		 * @return void
		 */
		public static function maybe_define_do_location() {
			if ( function_exists( 'elementor_theme_do_location' ) ) {
				return;
			}

			self::define_do_location_shim();
		}

		/**
		 * Define the minimal `elementor_theme_do_location()` shim.
		 *
		 * Kept in its own method with a guard so it is declared exactly once.
		 *
		 * @return void
		 */
		private static function define_do_location_shim() {
			if ( function_exists( 'elementor_theme_do_location' ) ) {
				return;
			}

			/**
			 * Compatibility shim for themes (e.g. Hello Elementor) that gate their
			 * header/footer on Elementor's Theme Locations API. Present only when
			 * Elementor Pro has not defined the real one.
			 *
			 * @param string $location Location slug.
			 * @return bool True if a UiChemy template was output for the location.
			 */
			function elementor_theme_do_location( $location ) {
				return UiChemy_Locations::do_location( $location );
			}
		}
	}
}
