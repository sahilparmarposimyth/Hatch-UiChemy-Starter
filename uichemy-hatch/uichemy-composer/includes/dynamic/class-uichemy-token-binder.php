<?php
/**
 * UiChemy_Token_Binder — map Twig data tokens to Elementor dynamic-tag bindings.
 *
 * When a page is auto-imported from HTML, its markup can already carry Twig data
 * tokens ({{ post.title }}, {{ post.thumbnail.src }}, …). This class maps such a
 * token to the equivalent registered Elementor dynamic tag (the composer-* tags) and
 * builds the [elementor-tag …] shortcode Elementor stores under settings.__dynamic__
 * so the imported element shows up as a properly-bound dynamic tag (auto-selected),
 * rather than only resolving invisibly through the Twig engine.
 *
 * Scope: every tag group EXCEPT ACF — Post, Site, Archive, User, Term, WooCommerce,
 * JetEngine — plus a Twig-bridge fallback (composer-twig-text / -url / -image) so ANY
 * token that doesn't match a named tag still binds cleanly and nothing is left over.
 *
 * IMPORTANT (render constraint): a slot dynamic-tag binding and a Twig token cannot
 * coexist in one widget — UiChemy_Composer_Widget::render() skips ALL slot processing
 * when raw_html still contains any {{ }} / {% %}. So a caller that converts tokens to
 * bindings must also blank the token in raw_html, and must leave tokens that sit
 * inside {% for %} / {% if %} on the Twig path (they cannot become slot tags).
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Token_Binder' ) ) {

	class UiChemy_Token_Binder {

		/**
		 * Map a Twig expression (the inner text of a {{ … }} token, without braces)
		 * to a dynamic-tag descriptor.
		 *
		 * @param string $expr Inner expression, e.g. "post.title" or "post.meta('city')".
		 * @return array|null { name: string tag id, category: text|url|image, settings: array } or null.
		 */
		public static function map_expression( $expr ) {
			$e = trim( (string) $expr );
			if ( '' === $e ) {
				return null;
			}

			// A token carrying a filter ( post.title|upper ) or operator can't be
			// represented by a simple named tag — the named tag wouldn't apply the
			// filter. Route the whole expression through the Twig-bridge tag, which
			// evaluates it verbatim. Category is refined by the caller (node type).
			if ( preg_match( '/[|?:~]|\band\b|\bor\b/i', $e ) ) {
				return array(
					'name'     => 'composer-twig-text',
					'category' => 'text',
					'settings' => array( 'expression' => $e ),
				);
			}

			$map = self::named_map();
			foreach ( $map as $entry ) {
				if ( preg_match( $entry['re'], $e, $m ) ) {
					$settings = array();
					if ( isset( $entry['settings'] ) && is_callable( $entry['settings'] ) ) {
						$settings = call_user_func( $entry['settings'], $m );
					} elseif ( isset( $entry['settings'] ) && is_array( $entry['settings'] ) ) {
						$settings = $entry['settings'];
					}
					return array(
						'name'     => $entry['name'],
						'category' => $entry['category'],
						'settings' => $settings,
					);
				}
			}

			// Fallback: any remaining clean expression → Twig-bridge text tag.
			return array(
				'name'     => 'composer-twig-text',
				'category' => 'text',
				'settings' => array( 'expression' => $e ),
			);
		}

		/**
		 * The ordered pattern → tag table. Order matters (specific before generic).
		 * Each entry: re (regex on the trimmed expression), name (tag id), category
		 * (text|url|image), optional settings (array or callable($matches):array).
		 *
		 * Covers Post / Site / Archive / User / Term / Woo / Jet. ACF is intentionally
		 * excluded (its tags need live field introspection, not a token mapping).
		 *
		 * @return array
		 */
		private static function named_map() {
			$q = "\\s*'([^']*)'\\s*"; // a single-quoted arg capture

			return array(
				// ── Post ───────────────────────────────────────────────────────────
				array(
					're'       => '/^post\.title$/i',
					'name'     => 'composer-post-title',
					'category' => 'text',
				),
				array(
					're'       => '/^post\.(id)$/i',
					'name'     => 'composer-post-id',
					'category' => 'text',
				),
				array(
					're'       => '/^post\.excerpt$/i',
					'name'     => 'composer-post-excerpt',
					'category' => 'text',
				),
				array(
					're'       => '/^post\.content$/i',
					'name'     => 'composer-post-content',
					'category' => 'text',
				),
				array(
					're'       => '/^post\.date(?:\(' . $q . '\))?$/i',
					'name'     => 'composer-post-date',
					'category' => 'text',
					'settings' => function ( $m ) {
						return isset( $m[1] ) && '' !== $m[1] ? array( 'format' => $m[1] ) : array(); },
				),
				array(
					're'       => '/^post\.(link|permalink)$/i',
					'name'     => 'composer-post-permalink',
					'category' => 'url',
				),
				array(
					're'       => '/^post\.thumbnail\b/i',
					'name'     => 'composer-post-featured-image',
					'category' => 'image',
				),
				array(
					're'       => '/^post\.meta\(' . $q . '\)$/i',
					'name'     => 'composer-post-meta',
					'category' => 'text',
					'settings' => function ( $m ) {
						return array( 'key' => isset( $m[1] ) ? $m[1] : '' ); },
				),

				// ── Site ───────────────────────────────────────────────────────────
				array(
					're'       => '/^site\.(name|title)$/i',
					'name'     => 'composer-site-title',
					'category' => 'text',
				),
				array(
					're'       => '/^site\.(description|tagline)$/i',
					'name'     => 'composer-site-tagline',
					'category' => 'text',
				),
				array(
					're'       => '/^site\.url$/i',
					'name'     => 'composer-site-url',
					'category' => 'url',
				),
				array(
					're'       => '/^site\.logo\b/i',
					'name'     => 'composer-site-logo',
					'category' => 'image',
				),

				// ── Archive ─────────────────────────────────────────────────────────
				array(
					're'       => '/^archive\.title$/i',
					'name'     => 'composer-archive-title',
					'category' => 'text',
				),
				array(
					're'       => '/^archive\.description$/i',
					'name'     => 'composer-archive-description',
					'category' => 'text',
				),
				array(
					're'       => '/^archive\.url$/i',
					'name'     => 'composer-archive-url',
					'category' => 'url',
				),
				array(
					're'       => '/^archive\.meta\(' . $q . '\)$/i',
					'name'     => 'composer-archive-meta',
					'category' => 'text',
					'settings' => function ( $m ) {
						return array( 'key' => isset( $m[1] ) ? $m[1] : '' ); },
				),

				// ── User / Author ────────────────────────────────────────────────────
				array(
					're'       => '/^(?:user|author)\.(name|display_name)$/i',
					'name'     => 'composer-user-info',
					'category' => 'text',
					'settings' => array( 'field' => 'display_name' ),
				),
				array(
					're'       => '/^(?:user|author)\.(first_name)$/i',
					'name'     => 'composer-user-info',
					'category' => 'text',
					'settings' => array( 'field' => 'first_name' ),
				),
				array(
					're'       => '/^(?:user|author)\.(last_name)$/i',
					'name'     => 'composer-user-info',
					'category' => 'text',
					'settings' => array( 'field' => 'last_name' ),
				),
				array(
					're'       => '/^(?:user|author)\.(nickname)$/i',
					'name'     => 'composer-user-info',
					'category' => 'text',
					'settings' => array( 'field' => 'nickname' ),
				),
				array(
					're'       => '/^(?:user|author)\.(bio|description)$/i',
					'name'     => 'composer-user-info',
					'category' => 'text',
					'settings' => array( 'field' => 'description' ),
				),
				array(
					're'       => '/^(?:user|author)\.email$/i',
					'name'     => 'composer-user-info',
					'category' => 'text',
					'settings' => array( 'field' => 'user_email' ),
				),
				array(
					're'       => '/^(?:user|author)\.url$/i',
					'name'     => 'composer-user-url',
					'category' => 'url',
				),
				array(
					're'       => '/^(?:user|author)\.link$/i',
					'name'     => 'composer-user-posts-url',
					'category' => 'url',
				),
				array(
					're'       => '/^(?:user|author)\.avatar\b/i',
					'name'     => 'composer-user-avatar',
					'category' => 'image',
				),
				array(
					're'       => '/^(?:user|author)\.meta\(' . $q . '\)$/i',
					'name'     => 'composer-user-meta',
					'category' => 'text',
					'settings' => function ( $m ) {
						return array( 'key' => isset( $m[1] ) ? $m[1] : '' ); },
				),

				// ── Term ─────────────────────────────────────────────────────────────
				array(
					're'       => '/^term\.(name|title)$/i',
					'name'     => 'composer-term-title',
					'category' => 'text',
				),
				array(
					're'       => '/^term\.description$/i',
					'name'     => 'composer-term-description',
					'category' => 'text',
				),
				array(
					're'       => '/^term\.link$/i',
					'name'     => 'composer-term-url',
					'category' => 'url',
				),
				array(
					're'       => '/^term\.count$/i',
					'name'     => 'composer-term-count',
					'category' => 'text',
				),
				array(
					're'       => '/^term\.image\b/i',
					'name'     => 'composer-term-image',
					'category' => 'image',
				),

				// ── WooCommerce (product provider) ────────────────────────────────────
				array(
					're'       => '/^product\.title$/i',
					'name'     => 'composer-woo-title',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.(id)$/i',
					'name'     => 'composer-woo-id',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.sku$/i',
					'name'     => 'composer-woo-sku',
					'category' => 'text',
				),
				// The Price tag formats via its own `price_type` control, so the three
				// price tokens all bind to it with different settings rather than
				// needing a tag each.
				array(
					're'       => '/^product\.(?:price|price_html)$/i',
					'name'     => 'composer-woo-price',
					'category' => 'text',
					'settings' => array( 'price_type' => 'auto' ),
				),
				array(
					're'       => '/^product\.regular_price$/i',
					'name'     => 'composer-woo-price',
					'category' => 'text',
					'settings' => array( 'price_type' => 'regular' ),
				),
				array(
					're'       => '/^product\.sale_price$/i',
					'name'     => 'composer-woo-price',
					'category' => 'text',
					'settings' => array( 'price_type' => 'sale' ),
				),
				array(
					're'       => '/^product\.stock_status$/i',
					'name'     => 'composer-woo-stock-status',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.stock_quantity$/i',
					'name'     => 'composer-woo-stock-qty',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.(?:type|product_type)$/i',
					'name'     => 'composer-woo-type',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.average_rating$/i',
					'name'     => 'composer-woo-rating',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.review_count$/i',
					'name'     => 'composer-woo-review-count',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.total_sales$/i',
					'name'     => 'composer-woo-total-sales',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.sale_percentage$/i',
					'name'     => 'composer-woo-sale-percentage',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.availability$/i',
					'name'     => 'composer-woo-availability',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.short_description$/i',
					'name'     => 'composer-woo-short-description',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.description$/i',
					'name'     => 'composer-woo-description',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.purchase_note$/i',
					'name'     => 'composer-woo-purchase-note',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.category_list$/i',
					'name'     => 'composer-woo-category',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.tag_list$/i',
					'name'     => 'composer-woo-tags',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.brand$/i',
					'name'     => 'composer-woo-brand',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.attribute\(' . $q . '\)$/i',
					'name'     => 'composer-woo-attribute',
					'category' => 'text',
					'settings' => function ( $m ) {
						return array( 'attribute' => isset( $m[1] ) ? $m[1] : '' ); },
				),
				array(
					're'       => '/^product\.weight$/i',
					'name'     => 'composer-woo-weight',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.dimensions$/i',
					'name'     => 'composer-woo-dimensions',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.slug$/i',
					'name'     => 'composer-woo-slug',
					'category' => 'text',
				),
				array(
					're'       => '/^product\.(link|permalink|url)$/i',
					'name'     => 'composer-woo-url',
					'category' => 'url',
				),
				array(
					're'       => '/^product\.add_to_cart_url$/i',
					'name'     => 'composer-woo-add-to-cart-url',
					'category' => 'url',
				),
				array(
					're'       => '/^product\.cart_url$/i',
					'name'     => 'composer-woo-cart-url',
					'category' => 'url',
				),
				array(
					're'       => '/^product\.checkout_url$/i',
					'name'     => 'composer-woo-checkout-url',
					'category' => 'url',
				),
				array(
					're'       => '/^product\.shop_url$/i',
					'name'     => 'composer-woo-shop-url',
					'category' => 'url',
				),
				array(
					're'       => '/^product\.thumbnail\b/i',
					'name'     => 'composer-woo-featured-image',
					'category' => 'image',
				),
				// `gallery` is an array token — only an indexed read maps to a tag,
				// since the Gallery Image tag returns ONE image by index.
				array(
					're'       => '/^product\.gallery\[(\d+)\]$/i',
					'name'     => 'composer-woo-gallery-image',
					'category' => 'image',
					'settings' => function ( $m ) {
						return array( 'gallery_index' => isset( $m[1] ) ? (int) $m[1] : 0 ); },
				),
				array(
					're'       => '/^product\.meta\(' . $q . '\)$/i',
					'name'     => 'composer-post-meta',
					'category' => 'text',
					'settings' => function ( $m ) {
						return array( 'key' => isset( $m[1] ) ? $m[1] : '' ); },
				),

				// ── JetEngine (no dedicated Twig provider; map explicit jet.field) ─────
				array(
					're'       => '/^jet\.field\(' . $q . '\)$/i',
					'name'     => 'composer-jet-field',
					'category' => 'text',
					'settings' => function ( $m ) {
						return array( 'jet_field_key' => isset( $m[1] ) ? $m[1] : '' ); },
				),
			);
		}

		/**
		 * Build the Elementor dynamic-tag shortcode string stored in settings.__dynamic__.
		 * Format: [elementor-tag id="XXXXXXX" name="TAG" settings="URLENCODED_JSON"].
		 *
		 * @param string $name     Tag id (get_name()).
		 * @param array  $settings Tag control values (empty for control-less tags).
		 * @param string $seed     Deterministic seed for the element id (keeps re-imports stable).
		 * @return string
		 */
		public static function build_tag_shortcode( $name, array $settings = array(), $seed = '' ) {
			// Elementor uses a 7-char id. Derive it deterministically from the tag +
			// settings + seed so the same import produces the same id (no churn), while
			// distinct bindings stay unique.
			$id      = substr( md5( $name . wp_json_encode( $settings ) . (string) $seed ), 0, 7 );
			$json    = empty( $settings ) ? '{}' : wp_json_encode( $settings );
			$encoded = rawurlencode( $json );
			return '[elementor-tag id="' . $id . '" name="' . esc_attr( $name ) . '" settings="' . $encoded . '"]';
		}

		/**
		 * The widget-settings control key a mapped tag binds to, for a given slot index
		 * and the tag's category. Mirrors UiChemy_Composer_Widget's slot control names.
		 *
		 * @param int    $slot_index Positional slot index (as get_text_nodes() computes).
		 * @param string $category   text|url|image.
		 * @return string Control name, e.g. slot_5 / slot_5_link / slot_5_image.
		 */
		public static function slot_key_for( $slot_index, $category ) {
			$i = (int) $slot_index;
			switch ( $category ) {
				case 'url':
					return "slot_{$i}_link";
				case 'image':
					return "slot_{$i}_image";
				case 'text':
				default:
					return "slot_{$i}";
			}
		}

		/**
		 * True when a raw_html string still carries Twig control flow ({% for %}/{% if %}).
		 * Tokens inside control flow must stay on the Twig path — they cannot become slot
		 * dynamic tags — so a converter uses this to decide whether the whole widget is
		 * eligible for slot binding.
		 *
		 * @param string $raw_html
		 * @return bool
		 */
		public static function has_control_flow( $raw_html ) {
			return (bool) preg_match( '/\{%\s*(for|if)\b/', (string) $raw_html );
		}

		/**
		 * Extract the lone inner expression of a value that is exactly a single {{ … }}
		 * token (optionally surrounded by whitespace). Returns null when the value is not
		 * a standalone token (mixed text, multiple tokens, etc.) — only standalone tokens
		 * map cleanly to a slot binding.
		 *
		 * @param string $value
		 * @return string|null
		 */
		public static function lone_token_expr( $value ) {
			$v = trim( (string) $value );
			if ( preg_match( '/^\{\{\s*(.+?)\s*\}\}$/s', $v, $m ) && false === strpos( $m[1], '{{' ) ) {
				return trim( $m[1] );
			}
			return null;
		}

		/**
		 * Convert standalone {{ … }} tokens in a raw_html string into Elementor
		 * dynamic-tag slot bindings.
		 *
		 * Walks the HTML in the SAME document order the Composer widget uses to number
		 * slots (text nodes, then <img>/<svg>, then anchors/inline — skipping
		 * <uichemy-*>/<style>/<script>), and for each slot whose value is a lone token:
		 *   • picks the required category from the slot kind (text → text-category tag,
		 *     <img> → image, <a href> → url), mapping via map_expression() and falling
		 *     back to the composer-twig-* bridge when the named tag's category doesn't fit;
		 *   • records settings['__dynamic__'][slot_key] = [elementor-tag …];
		 *   • blanks the token in the HTML so has_dynamic() is false and the slot path runs.
		 *
		 * Bails (returns the HTML untouched, no bindings) when the markup contains
		 * {% for %}/{% if %} control flow — those widgets stay on the Twig path.
		 *
		 * @param string $raw_html
		 * @param int    $slot_count Max slots (mirror of UiChemy_Composer_Widget::SLOT_COUNT).
		 * @return array { html: string, dynamic: array<string,string>, bindings: array, skipped?: string }
		 */
		public static function bind( $raw_html, $slot_count = 60 ) {
			$html   = (string) $raw_html;
			$result = array(
				'html'     => $html,
				'dynamic'  => array(),
				'bindings' => array(),
			);

			if ( self::has_control_flow( $html ) ) {
				$result['skipped'] = 'control_flow';
				return $result;
			}
			if ( false === strpos( $html, '{{' ) ) {
				return $result;
			}

			$dom = new \DOMDocument();
			libxml_use_internal_errors( true );
			$dom->loadHTML( '<?xml encoding="utf-8" ?>' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
			libxml_clear_errors();

			$nodes = array();
			self::collect_slot_nodes( $dom, $nodes );

			$dynamic  = array();
			$bindings = array();
			$flags    = array();

			foreach ( $nodes as $i => $node ) {
				if ( $i >= (int) $slot_count ) {
					break;
				}
				$kind = $node['kind'];
				$el   = $node['node'];

				if ( 'text' === $kind ) {
					$expr = self::lone_token_expr( $el->nodeValue );
					if ( null === $expr ) {
						continue;
					}
					$tag = self::fit( self::map_expression( $expr ), 'text', $expr );
					$dynamic[ self::slot_key_for( $i, 'text' ) ] = self::build_tag_shortcode( $tag['name'], $tag['settings'], 'slot' . $i );
					$bindings[]                                  = array(
						'slot'    => $i,
						'control' => self::slot_key_for( $i, 'text' ),
						'token'   => $expr,
						'tag'     => $tag['name'],
					);
					$el->nodeValue                               = ''; // blank the token so the slot supplies the value
				} elseif ( 'image' === $kind ) {
					$src = self::lone_token_expr( $el->getAttribute( 'src' ) );
					if ( null === $src ) {
						continue;
					}
					$tag = self::fit( self::map_expression( $src ), 'image', $src );
					$dynamic[ self::slot_key_for( $i, 'image' ) ] = self::build_tag_shortcode( $tag['name'], $tag['settings'], 'slot' . $i );
					$bindings[]                                   = array(
						'slot'    => $i,
						'control' => self::slot_key_for( $i, 'image' ),
						'token'   => $src,
						'tag'     => $tag['name'],
					);
					// Unlike text and url slots, the render path gates image slots on
					// these flags — apply_slot_settings_to_node() bails when
					// slot_{i}_is_image !== 'yes'. Nothing else server-side sets them
					// (only the editor's slot sync does), so without this the bound tag
					// resolves and is then thrown away, shipping the src="" we just
					// blanked above. See UiChemy_Composer_Widget::apply_slot_settings_to_node().
					$flags[ "slot_{$i}_visible" ]  = 'yes';
					$flags[ "slot_{$i}_is_image" ] = 'yes';
					$el->setAttribute( 'src', '' );
				} elseif ( 'anchor' === $kind ) {
					$href = self::lone_token_expr( $el->getAttribute( 'href' ) );
					if ( null === $href ) {
						continue;
					}
					$tag                                        = self::fit( self::map_expression( $href ), 'url', $href );
					$dynamic[ self::slot_key_for( $i, 'url' ) ] = self::build_tag_shortcode( $tag['name'], $tag['settings'], 'slot' . $i );
					$bindings[]                                 = array(
						'slot'    => $i,
						'control' => self::slot_key_for( $i, 'url' ),
						'token'   => $href,
						'tag'     => $tag['name'],
					);
					$el->setAttribute( 'href', '' );
				}
			}

			if ( ! empty( $bindings ) ) {
				$out = '';
				foreach ( $dom->childNodes as $child ) {
					$out .= $dom->saveHTML( $child );
				}
				$result['html'] = str_replace( '<?xml encoding="utf-8" ?>', '', $out );
			}
			$result['dynamic']  = $dynamic;
			$result['bindings'] = $bindings;
			$result['settings'] = $flags;
			return $result;
		}

		/**
		 * Force a mapped tag to a slot's required category. A text slot only accepts a
		 * text-category tag, a url slot a url tag, an image slot an image tag — Elementor
		 * filters tags by the control's category. When the named tag's category doesn't
		 * match the slot, fall back to the same-category composer-twig-* bridge carrying the
		 * original expression, so the binding is always valid.
		 *
		 * @param array  $tag      Descriptor from map_expression().
		 * @param string $need     Required category: text|url|image.
		 * @param string $expr     Original expression (for the bridge fallback).
		 * @return array { name, category, settings }
		 */
		private static function fit( $tag, $need, $expr ) {
			if ( is_array( $tag ) && isset( $tag['category'] ) && $tag['category'] === $need ) {
				return $tag;
			}
			$bridge = array(
				'text'  => 'composer-twig-text',
				'url'   => 'composer-twig-url',
				'image' => 'composer-twig-image',
			);
			return array(
				'name'     => isset( $bridge[ $need ] ) ? $bridge[ $need ] : 'composer-twig-text',
				'category' => $need,
				'settings' => array( 'expression' => $expr ),
			);
		}

		/**
		 * Collect slottable nodes in the Composer widget's slot order. Faithful to
		 * UiChemy_Composer_Widget::get_text_nodes() for standard markup: depth-first;
		 * non-empty text nodes, <img>/<svg> and anchors become slots; <uichemy-*>,
		 * <style>, <script> subtrees are skipped.
		 *
		 * @param \DOMNode $node
		 * @param array    $out  Accumulator of { kind: text|image|svg|anchor, node: DOMNode }.
		 * @return void
		 */
		private static function collect_slot_nodes( $node, array &$out ) {
			if ( ! $node->childNodes ) {
				return;
			}
			$inline = array( 'a', 'span', 'strong', 'em', 'b', 'i', 'u', 'label', 'button' );
			$ignore = array( 'style', 'script', 'noscript', 'template' );

			foreach ( $node->childNodes as $child ) {
				if ( XML_TEXT_NODE === $child->nodeType ) {
					if ( '' !== trim( (string) $child->nodeValue ) ) {
						$out[] = array(
							'kind' => 'text',
							'node' => $child,
						);
					}
					continue;
				}
				if ( XML_ELEMENT_NODE !== $child->nodeType ) {
					continue;
				}
				$tag = strtolower( $child->nodeName );
				if ( 0 === strncmp( $tag, 'uichemy-', 8 ) || in_array( $tag, $ignore, true ) ) {
					continue;
				}
				if ( 'img' === $tag ) {
					$out[] = array(
						'kind' => 'image',
						'node' => $child,
					);
				} elseif ( 'svg' === $tag ) {
					$out[] = array(
						'kind' => 'svg',
						'node' => $child,
					);
				} elseif ( 'a' === $tag ) {
					// Anchor is one slot (its href/link-text). If it wraps media/block
					// content, also recurse so nested tokens (e.g. an <img> inside the
					// link) still become slots — matching the widget's walk.
					$out[] = array(
						'kind' => 'anchor',
						'node' => $child,
					);
					if ( self::wraps_media_or_block( $child ) ) {
						self::collect_slot_nodes( $child, $out );
					}
				} elseif ( in_array( $tag, $inline, true ) ) {
					// Inline (span/button/…): a single text slot, unless it wraps
					// media/block content — then recurse into it instead.
					if ( self::wraps_media_or_block( $child ) ) {
						self::collect_slot_nodes( $child, $out );
					} else {
						$out[] = array(
							'kind' => 'text',
							'node' => $child,
						);
					}
				} else {
					self::collect_slot_nodes( $child, $out );
				}
			}
		}

		/**
		 * True when an element contains nested <img>/<svg> media or a block-level
		 * element — mirrors the widget's anchor_wraps_slot_content / inline_wraps_block
		 * checks that decide whether to recurse into an inline/anchor node.
		 *
		 * @param \DOMElement $el
		 * @return bool
		 */
		private static function wraps_media_or_block( $el ) {
			$inline = array( 'a', 'span', 'strong', 'em', 'b', 'i', 'u', 'label', 'button' );
			$ignore = array( 'style', 'script', 'noscript', 'template' );
			$void   = array( 'br', 'wbr', 'hr', 'area', 'base', 'col', 'embed', 'input', 'link', 'meta', 'param', 'source', 'track' );
			if ( ! method_exists( $el, 'getElementsByTagName' ) ) {
				return false;
			}
			foreach ( $el->getElementsByTagName( '*' ) as $desc ) {
				$t = strtolower( $desc->nodeName );
				if ( 0 === strncmp( $t, 'uichemy-', 8 ) || in_array( $t, $ignore, true ) ) {
					continue;
				}
				if ( in_array( $t, array( 'img', 'svg' ), true ) ) {
					return true;
				}
				if ( ! in_array( $t, $inline, true ) && ! in_array( $t, $void, true ) ) {
					return true;
				}
			}
			return false;
		}
	}
}
