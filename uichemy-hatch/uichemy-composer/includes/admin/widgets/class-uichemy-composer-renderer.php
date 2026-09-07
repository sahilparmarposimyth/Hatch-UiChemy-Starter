<?php
/**
 * UiChemy Composer shared renderer.
 *
 * Builder-agnostic engine that turns a Composer settings map (raw_html / raw_css /
 * raw_js, slots, custom code, deps) into final HTML. Shared by the Elementor widget
 * (Uich_UiChemy_Composer_Widget) and the Gutenberg block (Uich_Gutenberg_Composer)
 * so both builders render identically.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Composer_Renderer' ) ) {
	class UiChemy_Composer_Renderer {

		/**
		 * Convenience static entry point.
		 *
		 * @param array  $settings       Composer settings map (same shape as the Elementor widget settings).
		 * @param string $scope_selector CSS scope selector unique to this instance (e.g. ".uichemy-composer-ab12cd3").
		 * @param string $uid            Stable instance id used for editor <head> style injection.
		 * @param bool   $is_editor      Whether we are rendering inside a builder editor.
		 * @return string
		 */
		public static function render_html( $settings, $scope_selector, $uid, $is_editor = false, $scope_css = true, $obfuscate_scripts = false ) {
			$renderer = new self();
			return $renderer->render( $settings, $scope_selector, $uid, $is_editor, $scope_css, $obfuscate_scripts );
		}

		/**
		 * Decode HTML entities from a raw CSS/JS blob. WordPress's kses/save pipeline
		 * can normalize `&` → `&#038;`, `<` → `&lt;`, etc. inside stored code, which
		 * breaks JS operators (`&&`) and CSS combinators (`>`). Code fields never
		 * legitimately contain HTML entities, so decoding restores the source.
		 *
		 * @param string $code Raw code.
		 * @return string
		 */
		public static function decode_code_entities( $code ) {
			$code = (string) $code;
			if ( false === strpos( $code, '&' ) ) {
				return $code;
			}
			return html_entity_decode( $code, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		}

		/**
		 * Decode HTML entities inside the bodies of inline <script> / <style> tags
		 * (leaving the surrounding HTML text untouched, where entities are legit).
		 *
		 * @param string $html Serialized HTML.
		 * @return string
		 */
		public static function decode_inline_code_blocks( $html ) {
			$html = (string) $html;
			if ( false === strpos( $html, '&' ) ) {
				return $html;
			}
			return (string) preg_replace_callback(
				'#(<(script|style)\b[^>]*>)(.*?)(</\2>)#is',
				function ( $m ) {
					return $m[1] . self::decode_code_entities( $m[3] ) . $m[4];
				},
				$html
			);
		}

		/**
		 * Replace inline <script>/<style> blocks in raw_html with HTML-comment
		 * placeholders (which DOMDocument preserves untouched). <style> bodies are
		 * entity-decoded + scoped now; <script> bodies are entity-decoded + kept
		 * verbatim. Restored after serialization via strtr().
		 *
		 * @param string $html      Raw HTML.
		 * @param bool   $scope_css Whether to scope style bodies.
		 * @param string $scope     Scope selector.
		 * @param array  $store      Placeholder → block map (by reference).
		 * @return string HTML with placeholders.
		 */
		private function protect_code_blocks( $html, $scope_css, $scope, &$store ) {
			$store = array();
			$i     = 0;
			$self  = $this;
			return (string) preg_replace_callback(
				'#<(script|style)\b[^>]*>.*?</\1>#is',
				function ( $m ) use ( &$store, &$i, $scope_css, $scope, $self ) {
					$tag   = strtolower( $m[1] );
					$block = $m[0];
					if ( 'style' === $tag ) {
						$block = preg_replace_callback(
							'#(<style\b[^>]*>)(.*?)(</style>)#is',
							function ( $s ) use ( $scope_css, $scope, $self ) {
								$css = UiChemy_Composer_Renderer::decode_code_entities( $s[2] );
								if ( $scope_css ) {
									$css = $self->scope_css_to_widget( $css, $scope );
								}
								return $s[1] . $css . $s[3];
							},
							$block
						);
					} else {
						$block = preg_replace_callback(
							'#(<script\b[^>]*>)(.*?)(</script>)#is',
							function ( $s ) {
								return $s[1] . UiChemy_Composer_Renderer::decode_code_entities( $s[2] ) . $s[3];
							},
							$block
						);
					}
					$token           = '<!--UICHPROT' . ( $i++ ) . '-->';
					$store[ $token ] = $block;
					return $token;
				},
				(string) $html
			);
		}

		/**
		 * Render the Composer HTML for a given settings map.
		 *
		 * @param array  $settings       Composer settings map.
		 * @param string $scope_selector CSS scope selector unique to this instance.
		 * @param string $uid            Stable instance id used for editor <head> style injection.
		 * @param bool   $is_editor      Whether we are rendering inside a builder editor.
		 * @param bool   $scope_css      When false, emit CSS as-authored (unscoped) — for
		 *                               full-page designs that style <body> or inject elements
		 *                               (e.g. confetti) onto <body> via JS.
		 * @return string
		 */
		public function render( $settings, $scope_selector, $uid, $is_editor = false, $scope_css = true, $obfuscate_scripts = false ) {
			if ( ! is_array( $settings ) ) {
				$settings = array();
			}

			if ( empty( $settings['raw_html'] ) ) {
				return '';
			}

			// Protect inline <script>/<style> bodies from DOMDocument, which
			// entity-encodes (`&&`→`&amp;&amp;`) and can split them on `<`. Styles
			// are scoped here (DOM won't see them); scripts are kept verbatim.
			$protected_code = array();
			$html_source    = $this->protect_code_blocks( (string) $settings['raw_html'], $scope_css, $scope_selector, $protected_code );

			// Extract <uichemy:*> dynamic tags before DOMDocument sees them so
			// libxml does not mangle the custom namespace-like tag names.
			[ $raw_html_for_dom, $dynamic_tag_map ] = $this->extract_dynamic_tags( $html_source );

			$dom                     = new \DOMDocument();
			$dom->preserveWhiteSpace = true;

			libxml_use_internal_errors( true );
			$dom->loadHTML( '<?xml encoding="utf-8" ?>' . $raw_html_for_dom, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
			libxml_clear_errors();

			$text_nodes = $this->get_text_nodes( $dom );

			foreach ( $text_nodes as $i => $node ) {
				if ( $i >= 20 ) {
					break;
				}
				$this->apply_slot_settings_to_node( $node, $settings, $i );
			}

			$widget_scope_selector = $scope_selector;
			$style_nodes           = $dom->getElementsByTagName( 'style' );
			if ( $style_nodes && $style_nodes->length > 0 ) {
				for ( $s = 0; $s < $style_nodes->length; $s++ ) {
					$style_node = $style_nodes->item( $s );
					if ( ! $style_node instanceof \DOMElement ) {
						continue;
					}
					$raw_style_css = '';
					foreach ( $style_node->childNodes as $style_child ) {
						$raw_style_css .= $style_child->nodeValue;
					}
					$style_node->nodeValue = $scope_css ? $this->scope_css_to_widget( $raw_style_css, $widget_scope_selector ) : $raw_style_css;
				}
			}

			$output = '';
			foreach ( $dom->childNodes as $child ) {
				$output .= $dom->saveHTML( $child );
			}

			$output = str_replace( '<?xml encoding="utf-8" ?>', '', $output );

			// DOMDocument lowercases attribute names; put the SVG casing back.
			$output = self::restore_svg_attribute_case( $output );

			// Safety net for any <script>/<style> the DOM still emitted (not protected).
			$output = self::decode_inline_code_blocks( $output );

			// Restore dynamic tags with their rendered content.
			$output = $this->restore_dynamic_tags( $output, $dynamic_tag_map, $is_editor );

			// Restore the protected (verbatim / pre-scoped) <script>/<style> blocks.
			if ( ! empty( $protected_code ) ) {
				$output = strtr( $output, $protected_code );
			}

			// Inject standard-scope 3rd-party assets.
			[ $deps_before, $deps_after ] = $this->build_standard_deps_output(
				! empty( $settings['raw_deps_standard'] ) ? $settings['raw_deps_standard'] : '',
				$is_editor
			);

			$out = '';

			if ( '' !== $deps_before ) {
				$out .= $deps_before;
			}

			$out .= $output;

			if ( ! empty( $settings['raw_css'] ) ) {
				$raw_css_src = self::decode_code_entities( (string) $settings['raw_css'] );
				$scoped_css  = $scope_css ? $this->scope_css_to_widget( $raw_css_src, $widget_scope_selector ) : $raw_css_src;

				if ( $is_editor ) {
					// In the editor, inject CSS via JS into <head> so it is never inside
					// the widget's inner HTML. This means the CSS survives the editor's
					// re-render cycle without any flash or layout collapse.
					$widget_id = esc_js( $uid );
					$css_json  = wp_json_encode( $scoped_css );
					// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					$out      .= "<script>(function(){var id='uich-w-" . $widget_id . "';var old=document.getElementById(id);if(old)old.parentNode.removeChild(old);var s=document.createElement('style');s.id=id;s.textContent=" . $css_json . ";document.head.appendChild(s);})();</script>";
				} else {
					// On the frontend there are no re-renders — inline <style> is fine.
					$out .= '<style>' . $scoped_css . '</style>';
				}
			}

			if ( ! empty( $settings['raw_js'] ) ) {
				if ( $obfuscate_scripts ) {
					// Bricks' own builder JS mounts an element's render() output via a
					// reactive HTML-injection step (confirmed live: every node it produces
					// carries a `brx-child-node` class) that strips out ANY <script> tag
					// with inline content entirely — confirmed empirically: a <script>
					// with a deliberately non-standard `type` attribute (tried first,
					// expecting it to be invisible to a type-based sniff in iframe.min.js)
					// was STILL completely absent from the mounted DOM, same as a plain
					// <script> tag, meaning whatever strips it matches on the tag itself,
					// not attributes. This is presumably a safety measure against injecting
					// arbitrary executable script into the reactive DOM, common to
					// frameworks rendering untrusted "raw HTML" — so no `<script>` tag of
					// any kind survives to be revived here.
					//
					// Workaround: don't emit a <script> tag at all in the builder — hide
					// the code as text inside a `data-*` attribute on a plain, inert
					// element (never stripped, since it's not a script). This attribute is
					// deliberately not a real class name / anything Bricks itself reads —
					// uichemy-composer-bricks-adapter.js's reviveCanvasScripts() finds it,
					// decodes it, and creates a genuine <script> element with that content
					// AFTER the surrounding raw_html markup has actually mounted, in the
					// same relative order 3rd-party "before" dependencies already use.
					$out .= '<div class="uichemy-deferred-js" style="display:none" data-uichemy-js="' . esc_attr( self::decode_code_entities( (string) $settings['raw_js'] ) ) . '"></div>';
				} else {
					$out .= '<script>' . self::decode_code_entities( (string) $settings['raw_js'] ) . '</script>';
				}
			}

			if ( '' !== $deps_after ) {
				$out .= $deps_after;
			}

			// Adopt any <form data-atom-form="..."> in the output: inject the REST
			// endpoint, nonce, honeypot and per-form settings, and register the
			// front-end submit handler. Shared here (not per-builder) so a form
			// authored in either Elementor or Gutenberg actually submits somewhere —
			// previously this never ran anywhere, so forms rendered inert markup.
			if ( class_exists( 'Uich_Forms' ) ) {
				$out = Uich_Forms::process_output( $out, (string) $uid, (int) get_the_ID() );
			}

			return $out;
		}

		/**
		 * Build an HTML asset tag (<link> or <script>) from a dep config array.
		 *
		 * @param array $dep Dep entry from raw_deps_* JSON.
		 * @return string HTML tag or empty string.
		 */
		private function build_asset_tag_html( $dep ) {
			$url   = isset( $dep['url'] ) ? trim( (string) $dep['url'] ) : '';
			$ver   = isset( $dep['v'] ) ? trim( (string) $dep['v'] ) : '';
			$kind  = isset( $dep['kind'] ) ? (string) $dep['kind'] : 'script';
			$attrs = isset( $dep['attrs'] ) && is_array( $dep['attrs'] ) ? $dep['attrs'] : array();

			if ( '' === $url ) {
				return '';
			}

			// Replace {v} placeholder.
			if ( '' !== $ver && '—' !== $ver ) {
				$url = str_replace( '{v}', $ver, $url );
			} else {
				$url = str_replace( '{v}', '', $url );
			}

			$url = esc_url( $url );

			if ( 'style' === $kind ) {
				$media = '';
				if ( in_array( 'print', $attrs, true ) ) {
					$media = ' media="print"';
				} elseif ( in_array( 'all', $attrs, true ) ) {
					$media = ' media="all"';
				}
				return '<link rel="stylesheet" href="' . $url . '"' . $media . ' />';
			} else {
				$extra = '';
				if ( in_array( 'defer', $attrs, true ) ) {
					$extra .= ' defer';
				} elseif ( in_array( 'async', $attrs, true ) ) {
					$extra .= ' async';
				}
				if ( in_array( 'module', $attrs, true ) ) {
					$extra .= ' type="module"';
				}
				return '<script src="' . $url . '"' . $extra . '></script>';
			}
		}

		/**
		 * Build asset injection HTML (before-position or after-position) from a JSON deps string.
		 * Returns [ before_html, after_html ].
		 *
		 * @param string $raw_deps_json JSON string from widget setting.
		 * @param bool   $is_editor     Whether we are in the Elementor editor.
		 * @return array{ 0: string, 1: string }
		 */
		private function build_standard_deps_output( $raw_deps_json, $is_editor ) {
			static $injected_urls = array();

			$before = '';
			$after  = '';

			if ( empty( $raw_deps_json ) ) {
				return array( $before, $after );
			}

			$deps = json_decode( $raw_deps_json, true );
			if ( ! is_array( $deps ) ) {
				return array( $before, $after );
			}

			foreach ( $deps as $dep ) {
				if ( empty( $dep['enabled'] ) ) {
					continue;
				}

				$url_key = isset( $dep['url'] ) ? trim( (string) $dep['url'] ) : '';
				if ( '' === $url_key ) {
					continue;
				}

				// Deduplicate across multiple widgets on the same page.
				if ( isset( $injected_urls[ $url_key ] ) ) {
					continue;
				}
				$injected_urls[ $url_key ] = true;

				$tag = $this->build_asset_tag_html( $dep );
				if ( '' === $tag ) {
					continue;
				}

				$position = isset( $dep['position'] ) ? (string) $dep['position'] : 'before';

				// In editor, inject <link> tags via JS into <head> to avoid layout shifts.
				if ( $is_editor && isset( $dep['kind'] ) && 'style' === $dep['kind'] ) {
					$ver     = isset( $dep['v'] ) ? trim( (string) $dep['v'] ) : '';
					$url_raw = isset( $dep['url'] ) ? trim( (string) $dep['url'] ) : '';
					if ( '' !== $ver && '—' !== $ver ) {
						$url_raw = str_replace( '{v}', $ver, $url_raw );
					} else {
						$url_raw = str_replace( '{v}', '', $url_raw );
					}
					$url_raw  = esc_url( $url_raw );
					$url_js   = esc_js( $url_raw );
					$media_attr = '';
					$attrs    = isset( $dep['attrs'] ) && is_array( $dep['attrs'] ) ? $dep['attrs'] : array();
					if ( in_array( 'print', $attrs, true ) ) {
						$media_attr = 'print';
					} elseif ( in_array( 'all', $attrs, true ) ) {
						$media_attr = 'all';
					}
					$media_js = esc_js( $media_attr );
					$js_tag   = "<script>(function(){var u='" . $url_js . "';if(!document.querySelector('link[href=\"'+u+'\"]')){var l=document.createElement('link');l.rel='stylesheet';l.href=u;" . ( $media_attr ? "l.media='" . $media_js . "';" : '' ) . "document.head.appendChild(l);}})();</script>";
					if ( 'after' === $position ) {
						$after .= $js_tag . "\n";
					} else {
						$before .= $js_tag . "\n";
					}
					continue;
				}

				if ( 'after' === $position ) {
					$after .= $tag . "\n";
				} else {
					$before .= $tag . "\n";
				}
			}

			return array( $before, $after );
		}

		private function get_media_url_from_setting( $setting ) {
			if ( is_array( $setting ) ) {
				return trim( (string) ( $setting['url'] ?? '' ) );
			}
			return trim( (string) $setting );
		}

		private function is_svg_url_value( $value ) {
			$normalized = strtolower( trim( (string) $value ) );
			if ( '' === $normalized ) {
				return false;
			}
			if ( preg_match( '/^data:image\/svg\+xml(?:[;,]|$)/i', $normalized ) ) {
				return true;
			}
			return (bool) preg_match( '/\.svg(?:[?#]|$)/i', $normalized );
		}

		private function get_slot_kind( $node ) {
			if ( ! $node instanceof \DOMNode ) {
				return null;
			}
			if ( XML_TEXT_NODE === $node->nodeType ) {
				return 'text';
			}
			if ( XML_ELEMENT_NODE !== $node->nodeType ) {
				return null;
			}
			$tag_name = strtolower( $node->nodeName );
			if ( 'a' === $tag_name ) {
				return 'anchor';
			}
			if ( 'img' === $tag_name ) {
				return $this->is_svg_url_value( $node->getAttribute( 'src' ) ) ? 'svg' : 'image';
			}
			if ( 'svg' === $tag_name ) {
				return 'svg';
			}
			return 'text';
		}

		private function get_text_nodes( $node ) {
			$text_nodes  = array();
			$inline_tags = array( 'a', 'span', 'strong', 'em', 'b', 'i', 'u', 'label', 'button' );
			$ignore_tags = array( 'style', 'script', 'noscript', 'template' );

			foreach ( $node->childNodes as $child ) {
				if ( XML_TEXT_NODE === $child->nodeType ) {
					$val = trim( $child->nodeValue );
					if ( ! empty( $val ) ) {
						$text_nodes[] = $child;
					}
				} elseif ( XML_ELEMENT_NODE === $child->nodeType ) {
					$tag_name = strtolower( $child->nodeName );
					// Skip <uichemy-*> custom elements and their entire subtree.
					// Their inner template tokens (e.g. {nav_item}) are rendered
					// server-side by the PHP extraction layer and must never be
					// treated as editable text slots.
					if ( strncmp( $tag_name, 'uichemy-', 8 ) === 0 ) {
						continue;
					}
					if ( in_array( $tag_name, $ignore_tags, true ) ) {
						continue;
					}
					if ( in_array( $tag_name, array( 'img', 'svg' ), true ) ) {
						$text_nodes[] = $child;
					} elseif ( in_array( $tag_name, $inline_tags, true ) ) {
						$inline_text = trim( (string) $child->textContent );
						if ( '' !== $inline_text ) {
							$text_nodes[] = $child;
						}
					} else {
						$child_text_nodes = $this->get_text_nodes( $child );
						$text_nodes       = array_merge( $text_nodes, $child_text_nodes );
					}
				}
			}

			return $text_nodes;
		}

		private function apply_slot_settings_to_node( $node, $settings, $slot_index ) {
			if ( ! $node instanceof \DOMNode ) {
				return;
			}

			$kind = $this->get_slot_kind( $node );

			if ( 'image' === $kind && $node instanceof \DOMElement ) {
				$is_image = isset( $settings[ "slot_{$slot_index}_is_image" ] ) ? $settings[ "slot_{$slot_index}_is_image" ] : 'no';
				if ( 'yes' !== $is_image ) {
					return;
				}
				$image_setting = isset( $settings[ "slot_{$slot_index}_image" ] ) ? $settings[ "slot_{$slot_index}_image" ] : array();
				$url           = $this->get_media_url_from_setting( $image_setting );
				if ( '' !== $url ) {
					$node->setAttribute( 'src', htmlspecialchars( $url, ENT_QUOTES, 'UTF-8' ) );
				} else {
					$node->removeAttribute( 'src' );
				}
				$alt = isset( $settings[ "slot_{$slot_index}_image_alt" ] ) ? trim( (string) $settings[ "slot_{$slot_index}_image_alt" ] ) : '';
				if ( '' !== $alt ) {
					$node->setAttribute( 'alt', htmlspecialchars( $alt, ENT_QUOTES, 'UTF-8' ) );
				} else {
					$node->removeAttribute( 'alt' );
				}
				return;
			}

			if ( 'svg' === $kind && $node instanceof \DOMElement ) {
				$is_svg = isset( $settings[ "slot_{$slot_index}_is_svg" ] ) ? $settings[ "slot_{$slot_index}_is_svg" ] : 'no';
				if ( 'yes' !== $is_svg ) {
					return;
				}
				$svg_mode = isset( $settings[ "slot_{$slot_index}_svg_mode" ] ) ? (string) $settings[ "slot_{$slot_index}_svg_mode" ] : 'code';
				if ( 'url' === $svg_mode ) {
					$url_setting = isset( $settings[ "slot_{$slot_index}_svg_url" ] ) ? $settings[ "slot_{$slot_index}_svg_url" ] : array();
					$url         = $this->get_media_url_from_setting( $url_setting );
					if ( '' === $url ) {
						$tag_name_check = strtolower( $node->nodeName );
						if ( 'svg' === $tag_name_check ) {
							$node->removeAttribute( 'data-uc-svg-source' );
							while ( $node->firstChild ) {
								$node->removeChild( $node->firstChild );
							}
						} elseif ( 'img' === $tag_name_check ) {
							$node->removeAttribute( 'src' );
						}
						return;
					}
					$tag_name = strtolower( $node->nodeName );
					if ( 'img' === $tag_name ) {
						$node->setAttribute( 'src', htmlspecialchars( $url, ENT_QUOTES, 'UTF-8' ) );
						return;
					}
					if ( 'svg' !== $tag_name ) {
						return;
					}
					$node->setAttribute( 'data-uc-svg-source', htmlspecialchars( $url, ENT_QUOTES, 'UTF-8' ) );
					while ( $node->firstChild ) {
						$node->removeChild( $node->firstChild );
					}
					$doc        = $node->ownerDocument;
					$image_node = $doc->createElementNS( 'http://www.w3.org/2000/svg', 'image' );
					$image_node->setAttribute( 'href', $url );
					$image_node->setAttributeNS( 'http://www.w3.org/1999/xlink', 'xlink:href', $url );
					$image_node->setAttribute( 'width', '100%' );
					$image_node->setAttribute( 'height', '100%' );
					$image_node->setAttribute( 'preserveAspectRatio', 'xMidYMid meet' );
					$node->appendChild( $image_node );
					return;
				}

				$svg_code = isset( $settings[ "slot_{$slot_index}_svg_code" ] ) ? trim( (string) $settings[ "slot_{$slot_index}_svg_code" ] ) : '';
				if ( '' === $svg_code || ! preg_match( '/^\s*<svg\b/i', $svg_code ) ) {
					$code_media_setting = isset( $settings[ "slot_{$slot_index}_svg_code_media" ] ) ? $settings[ "slot_{$slot_index}_svg_code_media" ] : array();
					$code_media_url     = $this->get_media_url_from_setting( $code_media_setting );
					if ( '' === $code_media_url ) {
						return;
					}
					$tag_name = strtolower( $node->nodeName );
					if ( 'img' === $tag_name ) {
						$node->setAttribute( 'src', htmlspecialchars( $code_media_url, ENT_QUOTES, 'UTF-8' ) );
						return;
					}
					if ( 'svg' !== $tag_name ) {
						return;
					}
					$node->setAttribute( 'data-uc-svg-source', htmlspecialchars( $code_media_url, ENT_QUOTES, 'UTF-8' ) );
					while ( $node->firstChild ) {
						$node->removeChild( $node->firstChild );
					}
					$doc        = $node->ownerDocument;
					$image_node = $doc->createElementNS( 'http://www.w3.org/2000/svg', 'image' );
					$image_node->setAttribute( 'href', $code_media_url );
					$image_node->setAttributeNS( 'http://www.w3.org/1999/xlink', 'xlink:href', $code_media_url );
					$image_node->setAttribute( 'width', '100%' );
					$image_node->setAttribute( 'height', '100%' );
					$image_node->setAttribute( 'preserveAspectRatio', 'xMidYMid meet' );
					$node->appendChild( $image_node );
					return;
				}
				$parsed_dom = new \DOMDocument();
				libxml_use_internal_errors( true );
				$parsed_dom->loadHTML( '<?xml encoding="utf-8" ?>' . $svg_code, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
				libxml_clear_errors();
				$parsed_svg = $parsed_dom->getElementsByTagName( 'svg' )->item( 0 );
				if ( ! $parsed_svg instanceof \DOMElement || ! $node->parentNode instanceof \DOMNode ) {
					return;
				}
				$imported = $node->ownerDocument->importNode( $parsed_svg, true );
				$node->parentNode->replaceChild( $imported, $node );
				return;
			}

			$slot_val = isset( $settings[ "slot_{$slot_index}" ] ) ? trim( $settings[ "slot_{$slot_index}" ] ) : '';
			if ( '' !== $slot_val ) {
				if ( XML_TEXT_NODE === $node->nodeType ) {
					$node->nodeValue = htmlspecialchars( $slot_val, ENT_QUOTES, 'UTF-8' );
				} elseif ( XML_ELEMENT_NODE === $node->nodeType ) {
					$node->nodeValue = htmlspecialchars( $slot_val, ENT_QUOTES, 'UTF-8' );
				}
			}

			if ( 'anchor' === $kind && $node instanceof \DOMElement ) {
				$link_setting = isset( $settings[ "slot_{$slot_index}_link" ] ) ? $settings[ "slot_{$slot_index}_link" ] : array();
				$url          = isset( $link_setting['url'] ) ? trim( $link_setting['url'] ) : '';
				if ( ! empty( $url ) ) {
					$node->setAttribute( 'href', htmlspecialchars( $url, ENT_QUOTES, 'UTF-8' ) );
				}
				// The link control only owns target once the slot has been synced; every
				// control is returned with its default, so empty says nothing about
				// intent. Mirrors the Elementor widget renderer.
				$slot_is_link = isset( $settings[ "slot_{$slot_index}_is_link" ] ) && 'yes' === $settings[ "slot_{$slot_index}_is_link" ];
				if ( ! empty( $link_setting['is_external'] ) ) {
					$node->setAttribute( 'target', '_blank' );
				} elseif ( $slot_is_link ) {
					$node->removeAttribute( 'target' );
				}
				if ( ! empty( $link_setting['nofollow'] ) ) {
					$node->setAttribute( 'rel', 'nofollow' );
				}
				if ( ! empty( $link_setting['custom_attributes'] ) ) {
					$custom_attributes = preg_split( '/((\r?\n)|\|\||\|)/', $link_setting['custom_attributes'] );
					foreach ( $custom_attributes as $attr ) {
						$attr = explode( '|', trim( $attr ), 2 );
						if ( isset( $attr[0], $attr[1] ) ) {
							$node->setAttribute( trim( $attr[0] ), trim( $attr[1] ) );
						}
					}
				}
			}
		}

		/**
		 * Restore camelCase SVG attribute names after DOMDocument serialization, which
		 * lowercases them. Only text inside an <svg> … </svg> region is rewritten, and
		 * names that are kebab-case in SVG and only camelCase in React (stop-color,
		 * clip-path) are deliberately absent from the map.
		 *
		 * Duplicated from UiChemy_Composer_Widget on purpose: this is the Gutenberg
		 * path and must not depend on the Elementor widget being loaded.
		 *
		 * @param string $html Serialized markup.
		 * @return string
		 */
		public static function restore_svg_attribute_case( $html ) {
			$text = (string) $html;
			if ( '' === $text || false === stripos( $text, '<svg' ) ) {
				return $text;
			}

			static $map = null;
			if ( null === $map ) {
				$names = array(
					'viewBox',
					'preserveAspectRatio',
					'patternUnits',
					'patternContentUnits',
					'patternTransform',
					'gradientUnits',
					'gradientTransform',
					'spreadMethod',
					'clipPathUnits',
					'maskUnits',
					'maskContentUnits',
					'markerWidth',
					'markerHeight',
					'markerUnits',
					'refX',
					'refY',
					'stdDeviation',
					'textLength',
					'lengthAdjust',
					'startOffset',
					'pathLength',
					'baseFrequency',
					'numOctaves',
					'filterUnits',
					'primitiveUnits',
					'kernelMatrix',
					'kernelUnitLength',
					'preserveAlpha',
					'edgeMode',
					'targetX',
					'targetY',
					'tableValues',
					'xChannelSelector',
					'yChannelSelector',
					'diffuseConstant',
					'specularConstant',
					'specularExponent',
					'surfaceScale',
					'limitingConeAngle',
					'pointsAtX',
					'pointsAtY',
					'pointsAtZ',
					'systemLanguage',
					'requiredExtensions',
					'requiredFeatures',
					'attributeName',
					'attributeType',
					'calcMode',
					'keyTimes',
					'keySplines',
					'keyPoints',
					'repeatCount',
					'repeatDur',
					'baseProfile',
					'zoomAndPan',
				);
				$map = array();
				foreach ( $names as $name ) {
					$map[ strtolower( $name ) ] = $name;
				}
			}

			$restored = preg_replace_callback(
				'#<svg\b[^>]*>.*?</svg\s*>#is',
				static function ( $region ) use ( $map ) {
					return preg_replace_callback(
						'/(\s)([A-Za-z][A-Za-z0-9_-]*)(\s*=)/',
						static function ( $attr ) use ( $map ) {
							$lower = strtolower( $attr[2] );
							return isset( $map[ $lower ] )
								? $attr[1] . $map[ $lower ] . $attr[3]
								: $attr[0];
						},
						$region[0]
					);
				},
				$text
			);

			// preg failure returns null; keep the original rather than emitting nothing.
			return ( null === $restored ) ? $text : $restored;
		}

		private function scope_css_to_widget( $raw_css, $widget_scope_selector ) {
			$css   = trim( (string) $raw_css );
			$scope = trim( (string) $widget_scope_selector );
			if ( '' === $css || '' === $scope ) {
				return $css;
			}

			$scoped = $this->scope_css_block_to_widget( $css, $scope );
			return $this->reorder_responsive_media_queries_to_end( $scoped );
		}

		/**
		 * Sort top-level @media rules to the END of the scoped CSS so they take precedence over base
		 * rules at the same specificity. Without this, a desktop/base rule written after a @media rule
		 * in raw_css collapses to identical specificity once scoped and wins the cascade by source
		 * order — defeating the breakpoint override on small viewports.
		 */
		private function reorder_responsive_media_queries_to_end( $css ) {
			$text = (string) $css;
			if ( '' === trim( $text ) || false === strpos( $text, '@media' ) ) {
				return $text;
			}

			$blocks = array();
			$offset = 0;
			$len    = strlen( $text );

			while ( $offset < $len ) {
				$pre_start = $offset;
				while ( $offset < $len ) {
					$c = $text[ $offset ];
					if ( ctype_space( $c ) ) {
						$offset++;
						continue;
					}
					if ( '/' === $c && $offset + 1 < $len && '*' === $text[ $offset + 1 ] ) {
						$end = strpos( $text, '*/', $offset + 2 );
						if ( false === $end ) {
							$offset = $len;
							break;
						}
						$offset = $end + 2;
						continue;
					}
					break;
				}
				$prelude = substr( $text, $pre_start, $offset - $pre_start );
				if ( $offset >= $len ) {
					if ( '' !== $prelude ) {
						$blocks[] = array(
							'type' => 'rule',
							'text' => $prelude,
							'max'  => 0.0,
							'min'  => 0.0,
						);
					}
					break;
				}

				$header_start = $offset;
				$quote        = '';
				while ( $offset < $len ) {
					$c = $text[ $offset ];
					$n = $offset + 1 < $len ? $text[ $offset + 1 ] : '';
					if ( '' !== $quote ) {
						if ( '\\' === $c ) {
							$offset += 2;
							continue;
						}
						if ( $c === $quote ) {
							$quote = '';
						}
						$offset++;
						continue;
					}
					if ( '"' === $c || "'" === $c ) {
						$quote = $c;
						$offset++;
						continue;
					}
					if ( '/' === $c && '*' === $n ) {
						$end = strpos( $text, '*/', $offset + 2 );
						if ( false === $end ) {
							$offset = $len;
							break;
						}
						$offset = $end + 2;
						continue;
					}
					if ( '{' === $c || ';' === $c ) {
						break;
					}
					$offset++;
				}
				if ( $offset >= $len ) {
					$blocks[] = array(
						'type' => 'rule',
						'text' => $prelude . substr( $text, $header_start ),
						'max'  => 0.0,
						'min'  => 0.0,
					);
					break;
				}
				if ( ';' === $text[ $offset ] ) {
					$offset++;
					$blocks[] = array(
						'type' => 'rule',
						'text' => $prelude . substr( $text, $header_start, $offset - $header_start ),
						'max'  => 0.0,
						'min'  => 0.0,
					);
					continue;
				}

				$header     = trim( substr( $text, $header_start, $offset - $header_start ) );
				$depth      = 1;
				$body_quote = '';
				$offset++;
				while ( $offset < $len && $depth > 0 ) {
					$c = $text[ $offset ];
					$n = $offset + 1 < $len ? $text[ $offset + 1 ] : '';
					if ( '' !== $body_quote ) {
						if ( '\\' === $c ) {
							$offset += 2;
							continue;
						}
						if ( $c === $body_quote ) {
							$body_quote = '';
						}
						$offset++;
						continue;
					}
					if ( '"' === $c || "'" === $c ) {
						$body_quote = $c;
						$offset++;
						continue;
					}
					if ( '/' === $c && '*' === $n ) {
						$end = strpos( $text, '*/', $offset + 2 );
						if ( false === $end ) {
							$offset = $len;
							break;
						}
						$offset = $end + 2;
						continue;
					}
					if ( '{' === $c ) {
						$depth++;
					} elseif ( '}' === $c ) {
						$depth--;
					}
					$offset++;
				}
				$block_text = $prelude . substr( $text, $header_start, $offset - $header_start );

				if ( preg_match( '/^\s*@media\b/i', $header ) ) {
					$media_text = preg_replace( '/^\s*@media\s+/i', '', $header );
					$max_w      = PHP_INT_MAX;
					$min_w      = 0.0;
					if ( preg_match( '/max-width\s*:\s*([\d.]+)\s*px/i', $media_text, $m ) ) {
						$max_w = (float) $m[1];
					}
					if ( preg_match( '/min-width\s*:\s*([\d.]+)\s*px/i', $media_text, $m ) ) {
						$min_w = (float) $m[1];
					}
					$blocks[] = array(
						'type' => 'media',
						'text' => $block_text,
						'max'  => $max_w,
						'min'  => $min_w,
						'idx'  => count( $blocks ),
					);
				} else {
					$blocks[] = array(
						'type' => 'rule',
						'text' => $block_text,
						'max'  => 0.0,
						'min'  => 0.0,
					);
				}
			}

			$base_blocks  = array();
			$media_blocks = array();
			foreach ( $blocks as $b ) {
				if ( 'media' === $b['type'] ) {
					$media_blocks[] = $b;
				} else {
					$base_blocks[] = $b;
				}
			}
			usort(
				$media_blocks,
				function ( $a, $b ) {
					if ( $a['max'] !== $b['max'] ) {
						return ( $b['max'] - $a['max'] ) > 0 ? 1 : -1;
					}
					if ( $a['min'] !== $b['min'] ) {
						return ( $a['min'] - $b['min'] ) > 0 ? 1 : -1;
					}
					return ( isset( $a['idx'] ) ? $a['idx'] : 0 ) - ( isset( $b['idx'] ) ? $b['idx'] : 0 );
				}
			);

			$out = '';
			foreach ( $base_blocks as $b ) {
				$out .= $b['text'];
			}
			foreach ( $media_blocks as $b ) {
				$out .= $b['text'];
			}
			return $out;
		}

		private function scope_css_block_to_widget( $css, $scope, $base_scope = null ) {
			$css    = (string) $css;
			$output = '';
			$offset = 0;
			$length = strlen( $css );
			$base   = null === $base_scope ? $scope : (string) $base_scope;

			while ( $offset < $length ) {
				$open = $this->find_next_css_open_brace( $css, $offset );
				if ( false === $open ) {
					$output .= substr( $css, $offset );
					break;
				}

				$close = $this->find_matching_css_brace( $css, $open );
				if ( false === $close ) {
					$output .= substr( $css, $offset );
					break;
				}

				$prelude = substr( $css, $offset, $open - $offset );
				$body    = substr( $css, $open + 1, $close - $open - 1 );

				$at_rule_prelude = $prelude;
				$is_at_rule      = (bool) preg_match( '/^\s*@([a-z-]+)/i', $prelude, $matches );
				if ( ! $is_at_rule && preg_match( '/@(media|supports|container|layer|scope|document)\b/i', $prelude, $embedded ) ) {
					// Strip leading garbage (e.g. stale `.elementor-element-x @media (...)` prefix).
					$at_pos          = strpos( $prelude, $embedded[0] );
					$at_rule_prelude = false === $at_pos ? $prelude : substr( $prelude, $at_pos );
					$is_at_rule      = (bool) preg_match( '/^\s*@([a-z-]+)/i', $at_rule_prelude, $matches );
				}
				if ( $is_at_rule ) {
					$at_rule = strtolower( $matches[1] );
					if ( in_array( $at_rule, array( 'media', 'supports', 'container', 'layer', 'scope', 'document' ), true ) ) {
						// Bump specificity inside @media by doubling the base scope. Keeps breakpoint
						// rules winning over higher-specificity base selectors that authored complex
						// chains like `.scope .a .b img { width: 100% }`.
						$inner_scope = 'media' === $at_rule ? $base . $base : $scope;
						$body        = $this->scope_css_block_to_widget( $body, $inner_scope, $base );
					}
					$output .= $at_rule_prelude . '{' . $body . '}';
				} else {
					$scoped_prelude = $this->prefix_css_selector_group( $prelude, $scope, $base );
					$output        .= ( '' === $scoped_prelude ? $prelude : $scoped_prelude ) . '{' . $body . '}';
				}

				$offset = $close + 1;
			}

			return $output;
		}

		private function prefix_css_selector_group( $selector_group, $scope, $base_scope = null ) {
			if ( preg_match( '/^\s*@/', (string) $selector_group ) ) {
				return '';
			}
			$base = null === $base_scope ? $scope : (string) $base_scope;

			$leading_group = '';
			if ( preg_match( '/^(\s*(?:\/\*.*?\*\/\s*)*)(.*)$/s', (string) $selector_group, $group_matches ) ) {
				$leading_group  = isset( $group_matches[1] ) ? $group_matches[1] : '';
				$selector_group = isset( $group_matches[2] ) ? $group_matches[2] : $selector_group;
			}

			$parts  = explode( ',', (string) $selector_group );
			$scoped = array();
			foreach ( $parts as $part ) {
				$selector_leading = '';
				$selector         = (string) $part;
				if ( preg_match( '/^(\s*(?:\/\*.*?\*\/\s*)*)(.*)$/s', $selector, $selector_matches ) ) {
					$selector_leading = isset( $selector_matches[1] ) ? $selector_matches[1] : '';
					$selector         = isset( $selector_matches[2] ) ? $selector_matches[2] : $selector;
				}
				$selector = trim( $selector );
				if ( '' === $selector ) {
					continue;
				}

				$selector = str_ireplace( '{{WRAPPER}}', $scope, $selector );
				$selector = preg_replace(
					'/(^|[\s>+~,(])selector(?=$|[\s>+~#.:,\[])/i',
					'$1' . $scope,
					$selector
				);
				$selector = trim( (string) $selector );
				if ( '' === $selector ) {
					continue;
				}

				$selector_lower = strtolower( $selector );
				if ( 'from' === $selector_lower || 'to' === $selector_lower || preg_match( '/^\d+%$/', $selector ) ) {
					$scoped[] = $selector_leading . $selector;
					continue;
				}
				if ( ':root' === $selector ) {
					$scoped[] = $selector_leading . $scope;
					continue;
				}
				if ( 0 === strpos( $selector, $base ) ) {
					// Already prefixed with the base scope — replace the base with the active (possibly
					// boosted) scope so @media bodies still pick up the doubled-scope specificity.
					$tail     = substr( $selector, strlen( $base ) );
					$scoped[] = $selector_leading . $scope . $tail;
					continue;
				}
				$scoped[] = $selector_leading . $scope . ' ' . $selector;
			}

			return empty( $scoped ) ? '' : $leading_group . implode( ', ', $scoped );
		}

		private function find_next_css_open_brace( $css, $offset ) {
			$length = strlen( $css );
			$quote  = '';

			for ( $i = (int) $offset; $i < $length; $i++ ) {
				$char = $css[ $i ];
				$next = $i + 1 < $length ? $css[ $i + 1 ] : '';

				if ( '' !== $quote ) {
					if ( '\\' === $char ) {
						$i++;
						continue;
					}
					if ( $char === $quote ) {
						$quote = '';
					}
					continue;
				}

				if ( '"' === $char || "'" === $char ) {
					$quote = $char;
					continue;
				}

				if ( '/' === $char && '*' === $next ) {
					$end = strpos( $css, '*/', $i + 2 );
					if ( false === $end ) {
						return false;
					}
					$i = $end + 1;
					continue;
				}

				if ( '{' === $char ) {
					return $i;
				}
			}

			return false;
		}

		private function find_matching_css_brace( $css, $open_index ) {
			$length = strlen( $css );
			$depth  = 0;
			$quote  = '';

			for ( $i = (int) $open_index; $i < $length; $i++ ) {
				$char = $css[ $i ];
				$next = $i + 1 < $length ? $css[ $i + 1 ] : '';

				if ( '' !== $quote ) {
					if ( '\\' === $char ) {
						$i++;
						continue;
					}
					if ( $char === $quote ) {
						$quote = '';
					}
					continue;
				}

				if ( '"' === $char || "'" === $char ) {
					$quote = $char;
					continue;
				}

				if ( '/' === $char && '*' === $next ) {
					$end = strpos( $css, '*/', $i + 2 );
					if ( false === $end ) {
						return false;
					}
					$i = $end + 1;
					continue;
				}

				if ( '{' === $char ) {
					$depth++;
					continue;
				}

				if ( '}' === $char ) {
					$depth--;
					if ( 0 === $depth ) {
						return $i;
					}
				}
			}

			return false;
		}

		/**
		 * Extract <uichemy:*> dynamic tags from HTML before DOMDocument processing.
		 * Replaces each tag with an HTML comment placeholder and returns the
		 * modified HTML plus a map of placeholder index → tag info.
		 *
		 * @param string $html Raw HTML string.
		 * @return array{ 0: string, 1: array } [ modified_html, tag_map ]
		 */
		private function extract_dynamic_tags( $html ) {
			$tag_map  = array();
			$index    = 0;
			$last_pos = 0;

			// Captures: $m[1]=type, $m[2]=attrs, $m[3]=inner content (empty for self-closing tags).
			$html = preg_replace_callback(
				'/<uichemy-([a-z0-9_-]+)((?:\s[^>]*)?)\s*(?:\/>\s*|>([\s\S]*?)<\/uichemy-\1>)/is',
				function ( $m ) use ( &$tag_map, &$index, &$last_pos, $html ) {
					$type    = strtolower( $m[1] );
					$attrs   = trim( $m[2] );
					$content = isset( $m[3] ) ? $m[3] : '';

					// Dynamically find preceding HTML to check if we are wrapped inside an open <nav> tag.
					$pos = strpos( $html, $m[0], $last_pos );
					if ( false === $pos ) {
						$pos = $last_pos;
					}
					$preceding_html = substr( $html, 0, $pos );
					$last_pos       = $pos + strlen( $m[0] );

					$is_wrapped_in_nav    = false;
					$is_wrapped_in_anchor = false;
					if ( '' !== $preceding_html ) {
						$nav_open_count  = preg_match_all( '/<nav\b/i', $preceding_html );
						$nav_close_count = preg_match_all( '/<\/nav\b/i', $preceding_html );
						if ( $nav_open_count > $nav_close_count ) {
							$is_wrapped_in_nav = true;
						}
						// Same balance for <a>: a tag that renders its own anchor must not
						// emit one inside an existing link, because the parser hoists the
						// inner <a> out of the outer one.
						$a_open_count  = preg_match_all( '/<a\b/i', $preceding_html );
						$a_close_count = preg_match_all( '/<\/a\b/i', $preceding_html );
						if ( $a_open_count > $a_close_count ) {
							$is_wrapped_in_anchor = true;
						}
					}

					$tag_map[ $index ] = array(
						'type'                 => $type,
						'attrs'                => $attrs,
						'content'              => $content,
						'is_wrapped_in_nav'    => $is_wrapped_in_nav,
						'is_wrapped_in_anchor' => $is_wrapped_in_anchor,
					);
					$placeholder = "<!-- uich-dyn-{$index} -->";
					$index++;
					return $placeholder;
				},
				$html
			);
			return array( $html, $tag_map );
		}

		/**
		 * Replace comment placeholders produced by extract_dynamic_tags() with
		 * the actual rendered content for each dynamic tag type.
		 *
		 * @param string $output    HTML output string containing placeholders.
		 * @param array  $tag_map   Map of index → ['type', 'attrs'].
		 * @param bool   $is_editor Whether rendering inside the Elementor editor.
		 * @return string Final HTML with dynamic tags resolved.
		 */
		private function restore_dynamic_tags( $output, $tag_map, $is_editor ) {
			if ( empty( $tag_map ) ) {
				return $output;
			}
			return preg_replace_callback(
				'/<!-- uich-dyn-(\d+) -->/',
				function ( $m ) use ( $tag_map, $is_editor ) {
					$key = (int) $m[1];
					if ( ! isset( $tag_map[ $key ] ) ) {
						return '';
					}
					return $this->render_dynamic_tag_content(
						$tag_map[ $key ]['type'],
						$tag_map[ $key ]['attrs'],
						$is_editor,
						$tag_map[ $key ]['content'] ?? '',
						$tag_map[ $key ]['is_wrapped_in_nav'] ?? false,
						$tag_map[ $key ]['is_wrapped_in_anchor'] ?? false
					);
				},
				$output
			);
		}

		/**
		 * Resolve which post ID to pull content from.
		 * In the editor the global post is the template — walk up to the current
		 * Elementor document, or fall back to the latest published post.
		 *
		 * @param bool $is_editor
		 * @return int Post ID, or 0 if none found.
		 */
		private function resolve_preview_post_id( $is_editor ) {
			$post_id = get_the_ID();

			if ( ! $is_editor ) {
				return (int) $post_id;
			}

			$editor_post_id = 0;
			if ( class_exists( '\Elementor\Plugin' )
				&& isset( \Elementor\Plugin::$instance->documents )
			) {
				$current_doc = \Elementor\Plugin::$instance->documents->get_current();
				if ( $current_doc ) {
					$editor_post_id = $current_doc->get_main_id();
				}
			}

			if ( ! $editor_post_id ) {
				$editor_post_id = (int) $post_id;
			}

			$post_type       = $editor_post_id ? get_post_type( $editor_post_id ) : false;
			$is_real_content = $editor_post_id && $post_type && 'elementor_library' !== $post_type;

			if ( ! $is_real_content ) {
				$fallback = get_posts( array(
					'numberposts' => 1,
					'post_status' => 'publish',
					'post_type'   => 'post',
					'orderby'     => 'date',
					'order'       => 'DESC',
				) );
				$editor_post_id = ! empty( $fallback ) ? (int) $fallback[0]->ID : 0;
			}

			return $editor_post_id;
		}

		/**
		 * Walk the filtered post content and ensure every heading has an id=""
		 * attribute. Headings that already carry an id are left untouched.
		 * Duplicate slugs get a numeric suffix (-2, -3 …).
		 *
		 * @param string $content Filtered post content HTML.
		 * @return string Content with id attributes injected on headings.
		 */
		private function apply_heading_ids( $content ) {
			$id_count = array();
			return preg_replace_callback(
				'/<(h[1-6])([^>]*?)>(.*?)<\/h[1-6]>/is',
				function ( $m ) use ( &$id_count ) {
					$tag   = $m[1];
					$attrs = $m[2];
					$inner = $m[3];
					if ( preg_match( '/\bid\s*=/i', $attrs ) ) {
						return $m[0]; // already has id
					}
					$base = sanitize_title( wp_strip_all_tags( $inner ) );
					if ( ! $base ) {
						return $m[0];
					}
					$id = $base;
					if ( isset( $id_count[ $base ] ) ) {
						$id_count[ $base ]++;
						$id = $base . '-' . $id_count[ $base ];
					} else {
						$id_count[ $base ] = 0;
					}
					return "<{$tag}{$attrs} id=\"" . esc_attr( $id ) . "\">{$inner}</{$tag}>";
				},
				$content
			);
		}

		/**
		 * Extract an ordered list of headings from filtered content, resolving
		 * the same id="" values that apply_heading_ids() would produce.
		 *
		 * @param string $content Filtered post content HTML (already has heading ids, or not).
		 * @return array[] Each entry: [ 'level' => int, 'text' => string, 'id' => string ]
		 */
		private function extract_headings( $content ) {
			preg_match_all( '/<h([1-6])([^>]*?)>(.*?)<\/h[1-6]>/is', $content, $matches, PREG_SET_ORDER );
			$id_count = array();
			$headings = array();
			foreach ( $matches as $m ) {
				$level = (int) $m[1];
				$attrs = $m[2];
				$inner = $m[3];
				$text  = wp_strip_all_tags( $inner );
				if ( preg_match( '/\bid\s*=\s*["\']([^"\']*)["\']/', $attrs, $id_m ) ) {
					$id = trim( $id_m[1] );
				} else {
					$base = sanitize_title( $text );
					if ( ! $base ) {
						continue;
					}
					$id = $base;
					if ( isset( $id_count[ $base ] ) ) {
						$id_count[ $base ]++;
						$id = $base . '-' . $id_count[ $base ];
					} else {
						$id_count[ $base ] = 0;
					}
				}
				if ( $id ) {
					$headings[] = array(
						'level' => $level,
						'text'  => $text,
						'id'    => $id,
					);
				}
			}
			return $headings;
		}

		/**
		 * Parse the template content inside <uichemy-nav-menu> to extract class names
		 * and structural options for the rendered menu.
		 *
		 * Recognises:
		 *   <li for="nav_item in nav_menu" class="…">
		 *   <ul if="sub_items in nav_item" class="…">
		 *   <li for="sub_item in nav_item.sub_items" class="…">
		 *
		 * @param string $content Inner HTML of the <uichemy-nav-menu> tag.
		 * @return array{item_class:string, has_submenu:bool, submenu_attrs:string, sub_item_class:string}
		 */
		private function parse_nav_template( $content ) {
			$item_class     = '';
			$has_submenu    = false;
			$submenu_attrs  = '';
			$sub_item_class = '';

			// Top-level item: <li for="nav_item in nav_menu" …>
			if ( preg_match( '/<li\b([^>]*?)\bfor=["\']nav_item\s+in\s+nav_menu["\'][^>]*>/i', $content, $m ) ) {
				if ( preg_match( '/\bclass=["\']([^"\']*)["\']/', $m[0], $cm ) ) {
					$item_class = trim( $cm[1] );
				}
			}

			// Submenu container: <ul if="sub_items in nav_item" …>
			if ( preg_match( '/<ul\b([^>]*?)\bif=["\']sub_items\s+in\s+nav_item["\'][^>]*>/i', $content, $m ) ) {
				$has_submenu = true;
				// Collect attrs from the <ul> tag excluding the if="" directive.
				$ul_tag     = $m[0];
				$clean_tag  = preg_replace( '/\s*\bif=["\'][^"\']*["\']/', '', $ul_tag );
				$inner_attrs = preg_replace( '/^<ul\s*|\s*>$/', '', trim( $clean_tag ) );
				$submenu_attrs = trim( (string) $inner_attrs );
			}

			// Sub-item: <li for="sub_item in nav_item.sub_items" …>
			if ( preg_match( '/<li\b[^>]*\bfor=["\']sub_item\s+in\s+nav_item\.sub_items["\'][^>]*>/i', $content, $m ) ) {
				if ( preg_match( '/\bclass=["\']([^"\']*)["\']/', $m[0], $cm ) ) {
					$sub_item_class = trim( $cm[1] );
				}
			}

			return array(
				'item_class'    => $item_class,
				'has_submenu'   => $has_submenu,
				'submenu_attrs' => $submenu_attrs,
				'sub_item_class' => $sub_item_class,
			);
		}

		/**
		 * Fetch the active WordPress navigation menu items.
		 * Tries common theme location names in priority order, then falls back
		 * to the first registered location.
		 *
		 * @return array{ top: WP_Post[], by_parent: array<int, WP_Post[]> }|array Empty on failure.
		 */
		private function get_active_nav_menu_items() {
			$locations = get_nav_menu_locations();
			$menu_id   = 0;

			if ( ! empty( $locations ) && is_array( $locations ) ) {
				// Normalize keys to lowercase for a case-insensitive search
				$normalized_locations = array();
				foreach ( $locations as $k => $v ) {
					$normalized_locations[ strtolower( $k ) ] = (int) $v;
				}

				foreach ( array( 'primary', 'main', 'header', 'primary-menu', 'main-navigation', 'header-menu', 'menu-1' ) as $loc ) {
					if ( ! empty( $normalized_locations[ $loc ] ) ) {
						$menu_id = $normalized_locations[ $loc ];
						break;
					}
				}

				// If priority locations are not found/assigned, look for ANY active assigned location
				if ( ! $menu_id ) {
					foreach ( $locations as $loc_slug => $loc_menu_id ) {
						if ( ! empty( $loc_menu_id ) ) {
							$menu_id = (int) $loc_menu_id;
							break;
						}
					}
				}
			}

			// No location-assigned menu found — fall back to the first registered menu
			if ( ! $menu_id ) {
				$all_menus = wp_get_nav_menus();
				if ( ! empty( $all_menus ) && ! is_wp_error( $all_menus ) ) {
					$menu_id = (int) $all_menus[0]->term_id;
				}
			}

			if ( ! $menu_id ) {
				return array();
			}

			$items = wp_get_nav_menu_items( $menu_id );
			if ( ! $items || is_wp_error( $items ) ) {
				return array();
			}

			$top_level = array();
			$by_parent = array();
			foreach ( $items as $item ) {
				$pid = (int) $item->menu_item_parent;
				if ( 0 === $pid ) {
					$top_level[] = $item;
				} else {
					$by_parent[ $pid ][] = $item;
				}
			}

			return array( 'top' => $top_level, 'by_parent' => $by_parent );
		}

		/**
		 * Build the final <nav> HTML for a nav-menu tag using parsed template config
		 * and fetched menu items.
		 *
		/**
		 * Build the final <nav> or <ul> HTML for a nav-menu tag using parsed template config
		 * and fetched menu items.
		 *
		 * @param array  $tpl        Output of parse_nav_template().
		 * @param array  $menu_data  Output of get_active_nav_menu_items().
		 * @param string $outer_attrs Attribute string for the outer <nav> (from the tag).
		 * @param bool   $is_wrapped_in_nav Whether the tag is already wrapped in a <nav> container.
		 * @return string
		 */
		private function render_nav_menu_html( $tpl, $menu_data, $outer_attrs, $is_wrapped_in_nav = false ) {
			$top       = $menu_data['top'];
			$by_parent = $menu_data['by_parent'];

			$item_class     = $tpl['item_class'];
			$sub_item_class = $tpl['sub_item_class'];
			$submenu_attrs  = $tpl['submenu_attrs'];

			$items_html = '';
			foreach ( $top as $item ) {
				$item_id      = (int) $item->ID;
				$sub_items    = isset( $by_parent[ $item_id ] ) ? $by_parent[ $item_id ] : array();
				$has_children = count( $sub_items ) > 0;

				// Use only user-defined classes — no auto-injected modifiers.
				$li_attr = $item_class ? ' class="' . esc_attr( $item_class ) . '"' : '';
				$link    = '<a href="' . esc_url( $item->url ) . '">' . esc_html( $item->title ) . '</a>';

				$submenu_html = '';
				if ( $has_children ) {
					$sub_html = '';
					foreach ( $sub_items as $sub ) {
						$sub_link  = '<a href="' . esc_url( $sub->url ) . '">' . esc_html( $sub->title ) . '</a>';
						$sub_class = $sub_item_class ? ' class="' . esc_attr( $sub_item_class ) . '"' : '';
						$sub_html .= '<li' . $sub_class . '>' . $sub_link . '</li>';
					}
					// Wrap submenu with user-defined attrs (class, etc.) from <ul if="…">.
					$ul_open      = '<ul' . ( $submenu_attrs ? ' ' . $submenu_attrs : '' ) . '>';
					$submenu_html = $ul_open . $sub_html . '</ul>';
				}

				$items_html .= '<li' . $li_attr . '>' . $link . $submenu_html . '</li>';
			}

			$outer_attr = $outer_attrs ? ' ' . $outer_attrs : '';
			if ( $is_wrapped_in_nav ) {
				// Render direct <ul> so horizontal/vertical flex/grid layouts and BEM selector specificity are perfectly preserved
				return '<ul' . $outer_attr . '>' . $items_html . '</ul>';
			}

			// Outer tag becomes <nav> with a <ul> wrapper so <li> items are
			// valid HTML children and browsers / DOMDocument never auto-insert
			// an implicit <ul> that would shift CSS selector specificity.
			return '<nav' . $outer_attr . '><ul>' . $items_html . '</ul></nav>';
		}

		/**
		 * Parse the template content inside <uichemy-toc> to extract class names
		 * and structural options for the rendered TOC.
		 *
		 * Recognises:
		 *   <li for="heading in headings" class="…">
		 *   <ul if="sub_headings in heading" class="…">
		 *   <li for="sub_heading in heading.sub_headings" class="…">
		 *
		 * @param string $content Inner HTML of the <uichemy-toc> tag.
		 * @return array{item_class:string, has_submenu:bool, submenu_attrs:string, sub_item_class:string}
		 */
		private function parse_toc_template( $content ) {
			$item_class     = '';
			$has_submenu    = false;
			$submenu_attrs  = '';
			$sub_item_class = '';

			// Top-level item: <li for="heading in headings" …>
			if ( preg_match( '/<li\b[^>]*\bfor=["\']heading\s+in\s+headings["\'][^>]*>/i', $content, $m ) ) {
				if ( preg_match( '/\bclass=["\']([^"\']*)["\']/', $m[0], $cm ) ) {
					$item_class = trim( $cm[1] );
				}
			}

			// Submenu container: <ul if="sub_headings in heading" …>
			if ( preg_match( '/<ul\b[^>]*\bif=["\']sub_headings\s+in\s+heading["\'][^>]*>/i', $content, $m ) ) {
				$has_submenu = true;
				$ul_tag      = $m[0];
				$clean_tag   = preg_replace( '/\s*\bif=["\'][^"\']*["\']/', '', $ul_tag );
				$inner_attrs = preg_replace( '/^<ul\s*|\s*>$/', '', trim( $clean_tag ) );
				$submenu_attrs = trim( (string) $inner_attrs );
			}

			// Sub-item: <li for="sub_heading in heading.sub_headings" …>
			if ( preg_match( '/<li\b[^>]*\bfor=["\']sub_heading\s+in\s+heading\.sub_headings["\'][^>]*>/i', $content, $m ) ) {
				if ( preg_match( '/\bclass=["\']([^"\']*)["\']/', $m[0], $cm ) ) {
					$sub_item_class = trim( $cm[1] );
				}
			}

			return array(
				'item_class'     => $item_class,
				'has_submenu'    => $has_submenu,
				'submenu_attrs'  => $submenu_attrs,
				'sub_item_class' => $sub_item_class,
			);
		}

		/**
		 * Convert a flat ordered heading list into a two-level tree:
		 * top-level headings (those with no shallower ancestor in the list)
		 * and their direct/indirect children grouped by parent heading id.
		 *
		 * Uses a depth-stack so the parent of any heading is always the nearest
		 * preceding heading at a shallower level, regardless of how many levels
		 * are skipped.
		 *
		 * @param array[] $headings Output of extract_headings().
		 * @return array{ top: array[], by_parent: array<string, array[]> }
		 */
		private function build_heading_tree( $headings ) {
			$top       = array();
			$by_parent = array();
			$stack     = array(); // each entry is a heading array

			foreach ( $headings as $h ) {
				$level = (int) $h['level'];

				// Pop entries at the same or deeper level — they are closed.
				while ( ! empty( $stack ) && (int) end( $stack )['level'] >= $level ) {
					array_pop( $stack );
				}

				if ( empty( $stack ) ) {
					$top[] = $h;
				} else {
					$parent_id                 = end( $stack )['id'];
					$by_parent[ $parent_id ][] = $h;
				}

				$stack[] = $h;
			}

			return array( 'top' => $top, 'by_parent' => $by_parent );
		}

		/**
		 * Build the final TOC HTML using parsed template config and the heading tree.
		 * Rendering is fully recursive — h3 inside h2 inside h1 all work correctly,
		 * with the sub-item template (class + ul attrs) re-applied at every depth.
		 *
		 * @param array  $tpl          Output of parse_toc_template().
		 * @param array  $heading_data Output of build_heading_tree().
		 * @param string $outer_attrs  Attribute string for the outer <nav> (from the tag).
		 * @return string
		 */
		private function render_toc_html( $tpl, $heading_data, $outer_attrs ) {
			$by_parent      = $heading_data['by_parent'];
			$item_class     = $tpl['item_class'];
			$sub_item_class = $tpl['sub_item_class'];
			$submenu_attrs  = $tpl['submenu_attrs'];
			$has_sub_tpl    = $tpl['has_submenu'];

			/**
			 * Recursively render a list of headings.
			 * Top-level items use $item_class; every deeper level uses $sub_item_class.
			 * The same $submenu_attrs <ul> wrapper is applied at every nesting depth.
			 */
			$render_items = null;
			$render_items = function( $items, $is_top_level ) use (
				&$render_items, $by_parent,
				$item_class, $sub_item_class, $submenu_attrs, $has_sub_tpl
			) {
				$html = '';
				foreach ( $items as $h ) {
					$li_class = $is_top_level ? $item_class : $sub_item_class;
					$li_attr  = $li_class ? ' class="' . esc_attr( $li_class ) . '"' : '';
					$link     = '<a href="#' . esc_attr( $h['id'] ) . '">' . esc_html( $h['text'] ) . '</a>';

					$sub_items    = $has_sub_tpl && isset( $by_parent[ $h['id'] ] ) ? $by_parent[ $h['id'] ] : array();
					$submenu_html = '';
					if ( ! empty( $sub_items ) ) {
						$ul_open      = '<ul' . ( $submenu_attrs ? ' ' . $submenu_attrs : '' ) . '>';
						$submenu_html = $ul_open . $render_items( $sub_items, false ) . '</ul>';
					}

					$html .= '<li' . $li_attr . '>' . $link . $submenu_html . '</li>';
				}
				return $html;
			};

			$nav_attr = $outer_attrs ? ' ' . $outer_attrs : '';
			return '<nav' . $nav_attr . '>' . $render_items( $heading_data['top'], true ) . '</nav>';
		}

		/**
		 * Render the output for a single <uichemy-*> dynamic tag.
		 *
		 * @param string $type              Tag type slug (e.g. 'post-content', 'toc', 'nav-menu').
		 * @param string $attrs_str         Raw attribute string from the original tag.
		 * @param bool   $is_editor         Whether rendering inside the Elementor editor.
		 * @param string $content           Inner HTML content of the tag (for content-bearing tags).
		 * @param bool   $is_wrapped_in_nav Whether the tag is already wrapped in a <nav> container.
		 * @return string Rendered HTML.
		 */
		private function render_dynamic_tag_content( $type, $attrs_str, $is_editor, $content = '', $is_wrapped_in_nav = false, $is_wrapped_in_anchor = false ) {
			$attrs_str = trim( $attrs_str );
			$attr_open = $attrs_str ? ' ' . $attrs_str : '';
			$open_tag  = "<div{$attr_open}>";
			$close_tag = '</div>';

			$post_id = $this->resolve_preview_post_id( $is_editor );

			// ── post-content ──────────────────────────────────────────────────────
			if ( 'post-content' === $type ) {
				$post_content = '';
				if ( $post_id ) {
					$post_content = apply_filters( 'the_content', get_post_field( 'post_content', $post_id ) );
					// Ensure headings carry id="" so <uichemy-toc /> links resolve.
					$post_content = $this->apply_heading_ids( $post_content );
				}
				if ( $attrs_str ) {
					return $open_tag . $post_content . $close_tag;
				}
				return $post_content;
			}

			// ── toc ───────────────────────────────────────────────────────────────
			if ( 'toc' === $type ) {
				$heading_data = array( 'top' => array(), 'by_parent' => array() );
				if ( $post_id ) {
					$post_content = apply_filters( 'the_content', get_post_field( 'post_content', $post_id ) );
					$headings     = $this->extract_headings( $post_content );
					$heading_data = $this->build_heading_tree( $headings );
				}
				if ( empty( $heading_data['top'] ) ) {
					$nav_attr = $attrs_str ? ' ' . $attrs_str : '';
					return '<nav' . $nav_attr . '></nav>';
				}
				$tpl = $content
					? $this->parse_toc_template( $content )
					: array(
						'item_class'     => '',
						'has_submenu'    => true,
						'submenu_attrs'  => '',
						'sub_item_class' => '',
					);
				return $this->render_toc_html( $tpl, $heading_data, $attrs_str );
			}

			// ── site-logo ─────────────────────────────────────────────────────────
			// Renders the WordPress "Site Logo" (set via Appearance → Customize →
			// Site Identity → Logo). The default output is a clickable link to
			// the home URL wrapping an <img> with width/height/alt resolved from
			// the attachment. Any attrs on the tag are passed through to the
			// wrapping <a> element (e.g. `class="site-logo"` or `data-foo="bar"`).
			//
			//   Self-closing:   <uichemy-site-logo />
			//   With class:     <uichemy-site-logo class="header-logo" />
			//
			// If no custom logo is configured on the site, the site name is
			// rendered as a text fallback inside the same <a> wrapper so the
			// header doesn't collapse during preview.
			if ( 'site-logo' === $type ) {
				$logo_url    = '';
				$logo_width  = 0;
				$logo_height = 0;
				$logo_alt    = '';

				$logo_id = (int) get_theme_mod( 'custom_logo' );
				if ( $logo_id ) {
					$logo_src = wp_get_attachment_image_src( $logo_id, 'full' );
					if ( $logo_src ) {
						$logo_url    = (string) $logo_src[0];
						$logo_width  = (int) $logo_src[1];
						$logo_height = (int) $logo_src[2];
						$logo_alt    = (string) get_post_meta( $logo_id, '_wp_attachment_image_alt', true );
					}
				}
				if ( '' === $logo_alt ) {
					$logo_alt = (string) get_bloginfo( 'name' );
				}

				$home_url = esc_url( home_url( '/' ) );
				$a_attr   = $attrs_str ? ' ' . $attrs_str : '';

				// Already inside a link — emit the mark alone; the surrounding anchor
				// provides the link.
				if ( $is_wrapped_in_anchor ) {
					if ( '' === $logo_url ) {
						return '<span' . $a_attr . '>' . esc_html( get_bloginfo( 'name' ) ) . '</span>';
					}
					return sprintf(
						'<img%s src="%s" width="%d" height="%d" alt="%s" />',
						$a_attr,
						esc_url( $logo_url ),
						$logo_width,
						$logo_height,
						esc_attr( $logo_alt )
					);
				}

				if ( '' === $logo_url ) {
					// No custom logo set — render the site name as a text
					// fallback so the user can see/style something while
					// previewing in the editor.
					return '<a' . $a_attr . ' href="' . $home_url . '"><span>' . esc_html( get_bloginfo( 'name' ) ) . '</span></a>';
				}

				return sprintf(
					'<a%s href="%s"><img src="%s" width="%d" height="%d" alt="%s" /></a>',
					$a_attr,
					$home_url,
					esc_url( $logo_url ),
					$logo_width,
					$logo_height,
					esc_attr( $logo_alt )
				);
			}

			// ── site-icon ─────────────────────────────────────────────────────────
			// Renders the WordPress "Site Icon" — the favicon set via Appearance
			// → Customize → Site Identity → Site Icon. This is a DIFFERENT
			// setting from the Site Logo (favicons live in `option('site_icon')`,
			// not in the `custom_logo` theme mod). Useful when you want the
			// browser-tab icon inside your header (e.g. as a small avatar next
			// to the brand name, or as a mobile-only logo).
			//
			//   Self-closing:        <uichemy-site-icon />
			//   With class + size:   <uichemy-site-icon class="favicon" data-size="64" />
			//
			// Attrs are forwarded to the wrapping <a>. The optional `data-size`
			// attr picks which generated favicon size to load (WordPress emits
			// 32 / 192 / 270 / 512 by default — 192 is the safe default for a
			// crisp render at normal CSS sizes).
			if ( 'site-icon' === $type ) {
				$icon_size = 192;
				if ( $attrs_str && preg_match( '/\bdata-size\s*=\s*"(\d+)"/i', $attrs_str, $sm ) ) {
					$icon_size = max( 16, (int) $sm[1] );
				}

				$icon_url = function_exists( 'get_site_icon_url' ) ? (string) get_site_icon_url( $icon_size ) : '';
				$home_url = esc_url( home_url( '/' ) );
				$a_attr   = $attrs_str ? ' ' . $attrs_str : '';

				if ( '' === $icon_url ) {
					// No site icon configured — fall back to a clearly-empty
					// link so the user sees that the slot exists in the layout
					// but knows they still need to upload one in Customize.
					return '<a' . $a_attr . ' href="' . $home_url . '"></a>';
				}

				$icon_alt = (string) get_bloginfo( 'name' );

				return sprintf(
					'<a%s href="%s"><img src="%s" width="%d" height="%d" alt="%s" /></a>',
					$a_attr,
					$home_url,
					esc_url( $icon_url ),
					$icon_size,
					$icon_size,
					esc_attr( $icon_alt )
				);
			}

			// ── nav-menu ──────────────────────────────────────────────────────────
			if ( 'nav-menu' === $type ) {
				$menu_data = $this->get_active_nav_menu_items();
				if ( empty( $menu_data ) ) {
					$nav_attr = $attrs_str ? ' ' . $attrs_str : '';
					return $is_wrapped_in_nav ? '<ul' . $nav_attr . '></ul>' : '<nav' . $nav_attr . '></nav>';
				}
				$tpl = $content
					? $this->parse_nav_template( $content )
					: array(
						'item_class'     => '',
						'has_submenu'    => true,
						'submenu_attrs'  => '',
						'sub_item_class' => '',
					);
				return $this->render_nav_menu_html( $tpl, $menu_data, $attrs_str, $is_wrapped_in_nav );
			}

			// ── woo-* ─────────────────────────────────────────────────────────────
			// WooCommerce's own cart, checkout, my-account, order-tracking and
			// notice output, dropped inside a UiChemy layout.
			//
			//   <uichemy-woo-cart />
			//   <uichemy-woo-checkout class="checkout-wrap" />
			//
			// These exist so a store's functional pages can be STYLED rather than
			// REPLACED. UiChemy deliberately refuses to swap a theme-builder
			// template over cart, checkout and my-account — see
			// UiChemy_Template_Render::is_protected_singular() — because those pages
			// carry the purchase flow, and a template that replaces them produces a
			// site that looks finished and cannot take money. A tag is the way in:
			// the surrounding markup is yours, the flow stays WooCommerce's.
			if ( 0 === strpos( $type, 'woo-' ) ) {
				return $this->render_woo_tag( $type, $attrs_str, $is_editor );
			}

			return '';
		}

		/**
		 * WooCommerce shortcode tags: <uichemy-woo-cart />, -checkout, -my-account,
		 * -order-tracking, -notices.
		 *
		 * Never renders the real thing in the editor. Woo's cart and checkout read
		 * `WC()->cart` and the customer session, neither of which exists on an admin
		 * request — calling them there is a fatal, not a blank. The editor gets a
		 * labelled placeholder of roughly the right shape instead, which is also
		 * what a designer wants: a live checkout form is not something to lay out
		 * against.
		 *
		 * @param string $type      Full tag type, e.g. 'woo-cart'.
		 * @param string $attrs_str Raw attribute string from the tag.
		 * @param bool   $is_editor Whether rendering inside the Elementor editor.
		 * @return string
		 */
		private function render_woo_tag( $type, $attrs_str, $is_editor ) {
			$map = array(
				'woo-cart'           => array( 'woocommerce_cart', 'Cart' ),
				'woo-checkout'       => array( 'woocommerce_checkout', 'Checkout' ),
				'woo-my-account'     => array( 'woocommerce_my_account', 'My Account' ),
				'woo-order-tracking' => array( 'woocommerce_order_tracking', 'Order Tracking' ),
				'woo-notices'        => array( 'woocommerce_messages', 'Store Notices' ),
			);

			if ( ! isset( $map[ $type ] ) ) {
				return '';
			}

			list( $shortcode, $label ) = $map[ $type ];

			$attr_open = $attrs_str ? ' ' . $attrs_str : '';

			if ( ! class_exists( 'WooCommerce' ) || ! shortcode_exists( $shortcode ) ) {
				// Rendering nothing on the front end is right — an empty wrapper is
				// better than a PHP notice on a site that simply has no store. The
				// editor still says why, so the tag does not look broken.
				return $is_editor
					? $this->render_woo_placeholder( $label, $attr_open, 'WooCommerce is not active on this site, so this tag renders nothing.' )
					: '';
			}

			if ( $is_editor ) {
				return $this->render_woo_placeholder(
					$label,
					$attr_open,
					sprintf( 'WooCommerce renders %s here on the front end.', strtolower( $label ) )
				);
			}

			$html = do_shortcode( '[' . $shortcode . ']' );

			if ( '' === trim( (string) $html ) ) {
				return '';
			}

			return $attrs_str ? '<div' . $attr_open . '>' . $html . '</div>' : $html;
		}

		/**
		 * The editor stand-in for a WooCommerce tag.
		 *
		 * Styled inline rather than through a stylesheet: this markup only ever
		 * exists inside the editor preview, so a class would need a rule shipped to
		 * the front end that nothing there would use.
		 *
		 * @param string $label     Human label, e.g. 'Checkout'.
		 * @param string $attr_open Leading-space attribute string, or ''.
		 * @param string $note      One line explaining what happens on the front end.
		 * @return string
		 */
		private function render_woo_placeholder( $label, $attr_open, $note ) {
			return sprintf(
				'<div%s><div style="border:1px dashed currentColor;border-radius:6px;padding:24px;text-align:center;opacity:.65;font:500 14px/1.5 system-ui,sans-serif">'
					. '<div style="font-weight:600;margin-bottom:4px">WooCommerce: %s</div><div style="font-size:12px">%s</div></div></div>',
				$attr_open,
				esc_html( $label ),
				esc_html( $note )
			);
		}
	}
}
