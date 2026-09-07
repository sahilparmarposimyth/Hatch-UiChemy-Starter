<?php
/**
 * Nexter (TPGB) block processor for blog post import.
 *
 * Ensures TPGB blocks from blog-content.json are in the shape expected by the block editor.
 * Logic adapted from WDesignKit so the UiChemy import does not depend on WDesignKit for blog import.
 *
 * @package Uichemy
 */

defined( 'ABSPATH' ) || exit;

/**
 * Class Uich_Webpage_Block_Processor
 */
class Uich_Webpage_Block_Processor {

	/**
	 * Run the block processor.
	 *
	 * @param array $blocks Parsed blocks from parse_blocks().
	 * @return array Processed blocks.
	 */
	public function run( $blocks ) {
		return $this->process_blocks( $blocks );
	}

	/**
	 * Process blocks recursively.
	 *
	 * @param array $blocks Blocks array.
	 * @return array Processed blocks.
	 */
	private function process_blocks( $blocks ) {
		foreach ( $blocks as &$block ) {
			$name  = isset( $block['blockName'] ) ? $block['blockName'] : '';
			$attrs = isset( $block['attrs'] ) ? $block['attrs'] : array();

			switch ( $name ) {
				case 'tpgb/tp-accordion':
					$block = $this->process_accordion( $block, $attrs );
					break;
				case 'tpgb/tp-accordion-inner':
					$block = $this->process_accordion_inner( $block, $attrs );
					break;
				case 'tpgb/tp-heading':
					$block = $this->process_heading( $block );
					break;
				case 'tpgb/tp-pro-paragraph':
					$block = $this->process_pro_paragraph( $block, $attrs );
					break;
				case 'tpgb/tp-button-core':
					$block = $this->process_button_core( $block, $attrs );
					break;
				case 'tpgb/tp-image':
					$block = $this->process_image( $block, $attrs );
					break;
				case 'tpgb/tp-tabs-tours':
					$block = $this->process_tabs_tours( $block, $attrs );
					break;
				case 'tpgb/tp-tab-item':
					$block = $this->process_tab_item( $block, $attrs );
					break;
				case 'tpgb/tp-anything-carousel':
					$block = $this->process_anything_carousel( $block, $attrs );
					break;
				case 'tpgb/tp-anything-slide':
					$block = $this->process_anything_slide( $block, $attrs );
					break;
				case 'tpgb/tp-switcher':
					$block = $this->process_switcher( $block, $attrs );
					break;
				case 'tpgb/tp-switch-inner':
					$block = $this->process_switch_inner( $block, $attrs );
					break;
			}

			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->process_blocks( $block['innerBlocks'] );
			}
		}
		return $blocks;
	}

	/**
	 * Process accordion block.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_accordion( $block, $attrs ) {
		$is_editor   = isset( $attrs['accorType'] ) && 'editor' === $attrs['accorType'];
		$carousel_id = isset( $attrs['carouselId'] ) ? sanitize_text_field( $attrs['carouselId'] ) : '';

		// For editor-type accordions with a carouselId, the saved outer wrapper HTML may have
		// stale connection IDs from a previous save. Clear innerHTML so the PHP render_callback
		// regenerates the wrapper fresh from block attributes (Path 2), which correctly writes
		// id="tptab_{carouselId}", data-accordion-id, and data-connection attributes.
		if ( $is_editor && ! empty( $carousel_id ) && ! empty( $block['innerHTML'] ) ) {
			$block['innerHTML']       = '';
			$block['innerContent'][0] = '';
			return $block;
		}

		if ( empty( $attrs['accordianList'] ) || empty( $block['innerHTML'] ) ) {
			return $block;
		}
		if ( $is_editor ) {
			return $block;
		}
		// The block editor's save() only emits the .accordion-toggle-icon wrapper when
		// toggleIcon is truthy AND iconFont isn't "none" (see tp-accordion's JS save()).
		// WDesignKit's exported static HTML includes that markup unconditionally, so an
		// accordion imported with the toggle icon turned off still shows it on the front
		// end until a manual editor save regenerates the HTML from these same attrs.
		// Sync the markup here so the imported HTML already matches what a save produces.
		$show_toggle = ! empty( $attrs['toggleIcon'] ) && 'none' !== ( $attrs['iconFont'] ?? 'font_awesome' );
		$icon_font   = $attrs['iconFont'] ?? 'font_awesome';
		$icon_name   = ( $attrs['iconName'] ?? '' ) !== '' ? $attrs['iconName'] : 'fas fa-plus';
		$act_icon    = ( $attrs['ActiconName'] ?? '' ) !== '' ? $attrs['ActiconName'] : 'fas fa-minus';

		libxml_use_internal_errors( true );
		$dom = new DOMDocument();
		$dom->loadHTML( '<?xml encoding="utf-8" ?>' . $block['innerHTML'] );
		$xpath = new DOMXPath( $dom );
		$items = $xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " tpgb-accor-item ")]' );
		foreach ( $items as $index => $item ) {
			if ( ! isset( $attrs['accordianList'][ $index ] ) ) {
				continue;
			}
			$title      = wp_kses_post( $attrs['accordianList'][ $index ]['title'] ?? '' );
			$desc       = wp_kses_post( $attrs['accordianList'][ $index ]['desc'] ?? '' );
			$title_node = $xpath->query( './/*[contains(concat(" ", normalize-space(@class), " "), " accordion-title ")]', $item )->item( 0 );
			if ( $title_node ) {
				$title_node->nodeValue = $title;
			}
			$desc_node = $xpath->query( './/*[contains(concat(" ", normalize-space(@class), " "), " tpgb-content-editor ")]', $item )->item( 0 );
			if ( $desc_node ) {
				$desc_node->nodeValue = $desc;
			}

			$toggle_node = $xpath->query( './/*[contains(concat(" ", normalize-space(@class), " "), " accordion-toggle-icon ")]', $item )->item( 0 );
			if ( ! $show_toggle ) {
				if ( $toggle_node ) {
					$toggle_node->parentNode->removeChild( $toggle_node );
				}
			} elseif ( $toggle_node ) {
				$close_i = $xpath->query( './/*[contains(concat(" ", normalize-space(@class), " "), " close-toggle-icon ")]//i', $toggle_node )->item( 0 );
				$open_i  = $xpath->query( './/*[contains(concat(" ", normalize-space(@class), " "), " open-toggle-icon ")]//i', $toggle_node )->item( 0 );
				if ( 'font_awesome' === $icon_font ) {
					if ( $close_i ) {
						$close_i->setAttribute( 'class', $icon_name );
					}
					if ( $open_i ) {
						$open_i->setAttribute( 'class', $act_icon );
					}
				} else {
					if ( $close_i ) {
						$close_i->parentNode->removeChild( $close_i );
					}
					if ( $open_i ) {
						$open_i->parentNode->removeChild( $open_i );
					}
				}
			}
		}

		// Sync tpgb-accor-wrap connection attributes with the current carouselId so stale
		// saved HTML (from a prior save with a different ID) doesn't break the connection.
		if ( ! empty( $carousel_id ) ) {
			$wrap_node = $xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " tpgb-accor-wrap ")]' )->item( 0 );
			if ( $wrap_node ) {
				$tab_id = 'tptab_' . $carousel_id;
				$wrap_node->setAttribute( 'id', $tab_id );
				$wrap_node->setAttribute( 'data-accordion-id', $tab_id );
				$wrap_node->setAttribute( 'data-connection', 'tpca-' . $carousel_id );
			}
		}

		$body                     = $dom->getElementsByTagName( 'body' )->item( 0 );
		$new_html                 = $body ? $dom->saveHTML( $body ) : '';
		$new_html                 = preg_replace( '/^<body>|<\/body>$/', '', $new_html );
		$block['innerHTML']       = $new_html;
		$block['innerContent'][0] = $new_html;
		return $block;
	}

	/**
	 * Process accordion inner block.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_accordion_inner( $block, $attrs ) {
		if ( empty( $block['innerContent'] ) ) {
			return $block;
		}
		$is_editor = isset( $attrs['contentType'] ) && 'editor' === $attrs['contentType'];
		foreach ( $block['innerContent'] as $i => $chunk ) {
			if ( null === $chunk ) {
				continue;
			}
			if ( ! empty( $attrs['title'] ) && strpos( $chunk, 'accordion-title' ) !== false ) {
				$chunk = preg_replace_callback(
					'/(<([a-z][a-z0-9]*)\b[^>]*?class="[^"]*\baccordion-title\b[^"]*"[^>]*?>)([^<]*)(<\/\2>)/si',
					function ( $m ) use ( $attrs ) {
						return $m[1] . esc_html( $attrs['title'] ) . $m[4];
					},
					$chunk,
					1
				);
			}
			if ( ! $is_editor && ! empty( $attrs['desc'] ) && strpos( $chunk, 'tpgb-content-editor' ) !== false ) {
				$chunk = preg_replace(
					'/(<div\b[^>]*class="[^"]*\btpgb-content-editor\b[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/i',
					'$1' . wp_kses_post( $attrs['desc'] ) . '$3',
					$chunk,
					1
				);
			}
			$block['innerContent'][ $i ] = $chunk;
		}
		// When using editor content, the innerBlocks must render inside the tpgb-content-editor wrapper.
		if ( $is_editor && ! empty( $block['innerBlocks'] ) ) {
			$block = $this->fix_content_editor_wrap( $block );
		}
		return $block;
	}

	/**
	 * Process tab item block.
	 *
	 * When tabType is "editor" on the parent tabs-tours block, each tp-tab-item
	 * carries its content as innerBlocks (Gutenberg nested blocks). The exported
	 * HTML closes the tpgb-content-editor wrapper before the innerBlock null-slots,
	 * which causes WordPress to render the block content outside the tab wrapper on
	 * the frontend. This method restructures innerContent so innerBlocks are placed
	 * inside the wrapper.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_tab_item( $block, $attrs ) {
		if ( ! empty( $block['innerBlocks'] ) ) {
			$block = $this->fix_content_editor_wrap( $block );
		}
		return $block;
	}

	/**
	 * Process tp-anything-carousel block.
	 *
	 * TPGB's PHP render_callback has two paths:
	 *   Path 1: if $content already contains `tpgb-block-{id}`, return it as-is.
	 *   Path 2: regenerate the carousel wrapper from attributes (correct frontend HTML).
	 *
	 * Source templates export the block editor's edit() HTML (including the carousel
	 * wrapper div with the block ID) into innerContent[0]. This causes Path 1 to
	 * fire, returning broken/incomplete HTML from the source template.
	 *
	 * The fix: clear all string chunks in innerContent so $content contains only the
	 * inner-block slides with no carousel wrapper. The render_callback then takes
	 * Path 2 and regenerates the carousel HTML correctly from block attributes.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	/**
	 * Process tp-anything-carousel block (editor slide type).
	 *
	 * TPGB's render_callback has two paths:
	 *   Path 1 — $content contains tpgb-block-{id}: return source HTML as-is.
	 *            The source HTML was captured in the block editor's edit() context,
	 *            so Splide never initialises on the frontend.
	 *   Path 2 — $content has no tpgb-block-{id}: regenerate carousel HTML from
	 *            block attributes. This is what fires after a manual edit+save and
	 *            produces the correct working carousel.
	 *
	 * Fix: clear only innerContent[0] (the carousel wrapper div that carries the
	 * block ID). The null slots and between-slide whitespace are left intact.
	 * $content at render time then contains only the rendered slide blocks, Path 2
	 * fires, and the carousel works without requiring a manual page save.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	/**
	 * Process tp-anything-carousel block (editor slide type).
	 *
	 * TPGB's render_callback has two paths:
	 *   Path 1 — $content contains tpgb-block-{id}: returns source HTML as-is.
	 *            Source HTML was captured in the block editor's edit() context so
	 *            Splide never initialises correctly on the frontend.
	 *   Path 2 — $content has no tpgb-block-{id}: regenerates the carousel outer
	 *            div from block attributes. For editor-type it does:
	 *            $output .= $content  (no splide__track/list added by PHP).
	 *
	 * Splide requires a track/list element — Path 2 editor mode doesn't add one,
	 * but after a manual block-editor save the JS save() function stores those
	 * wrappers in innerContent.
	 *
	 * Fix:
	 *  1. Replace innerContent[0] (carousel wrapper with tpgb-block-{id}) with
	 *     a splide__track + splide__list opener — Path 2 fires because $content
	 *     no longer has the carousel block ID.
	 *  2. Append the matching </div></div> to the last string chunk so the track
	 *     and list are properly closed inside Path 2's outer carousel div.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_anything_carousel( $block, $attrs ) {
		if ( empty( $block['innerContent'] ) ) {
			return $block;
		}

		// Only act on editor-type carousels — template type is handled correctly by Path 1.
		if ( empty( $attrs['caroslideType'] ) || 'editor' !== $attrs['caroslideType'] ) {
			return $block;
		}

		$count = count( $block['innerContent'] );

		// Replace the first string chunk (carousel wrapper div carrying tpgb-block-{id})
		// with the splide__track + splide__list opener.
		for ( $i = 0; $i < $count; $i++ ) {
			if ( null !== $block['innerContent'][ $i ] ) {
				$block['innerContent'][ $i ] = "\n" . '<div class="tpgb-carousel-wrap tpgb-relative-block tpgb-trans-easeinout post-loop-inner splide__track"><div class="splide__list">';
				break;
			}
		}

		// Append closing tags to the last string chunk to close splide__list + splide__track.
		for ( $i = $count - 1; $i >= 0; $i-- ) {
			if ( null !== $block['innerContent'][ $i ] ) {
				$block['innerContent'][ $i ] .= '</div></div>';
				break;
			}
		}

		return $block;
	}

	/**
	 * Process tp-anything-slide block.
	 *
	 * When caroslideType is "editor", each slide carries its content as innerBlocks.
	 * The exported HTML self-closes the tpgb-slide-content wrapper before the inner
	 * block null slots, so inner blocks render outside the slide div. This moves the
	 * closing tag to after the last inner block so they render inside the wrapper.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_anything_slide( $block, $attrs ) {
		$block_id = isset( $attrs['block_id'] ) ? $attrs['block_id'] : '(none)';

		if ( ! empty( $block['innerBlocks'] ) ) {
			$block = $this->fix_content_editor_wrap( $block, 'tpgb-slide-content' );
		}
		return $block;
	}

	/**
	 * Process tp-switcher block.
	 *
	 * The exported HTML closes `switch-toggle-content` inside innerContent[0] before the null
	 * slots for the tp-switch-inner child blocks, so all switch panels render outside the
	 * switcher wrapper on the frontend. This strips the premature closing tags and appends
	 * them after the last null slot — identical fix to process_tabs_tours.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_switcher( $block, $attrs ) {
		if ( empty( $block['innerBlocks'] ) || ! isset( $block['innerContent'][0] ) ) {
			return $block;
		}

		$chunk = $block['innerContent'][0];
		if (
			strpos( $chunk, 'switch-toggle-content' ) !== false &&
			preg_match( '/(<div\b[^>]*\bswitch-toggle-content\b[^>]*>)\s*(<\/div>\s*)+$/s', $chunk, $m )
		) {
			$opening_tag  = $m[1];
			$removed_part = substr( $m[0], strlen( $opening_tag ) );
			$close_count  = substr_count( $removed_part, '</div>' );
			$closing_tags = str_repeat( '</div>', $close_count );

			$block['innerContent'][0] = preg_replace(
				'/(<div\b[^>]*\bswitch-toggle-content\b[^>]*>)\s*(<\/div>\s*)+$/s',
				'$1',
				$chunk
			);

			$count     = count( $block['innerContent'] );
			$last_null = -1;
			for ( $j = $count - 1; $j >= 0; $j-- ) {
				if ( null === $block['innerContent'][ $j ] ) {
					$last_null = $j;
					break;
				}
			}
			if ( $last_null >= 0 ) {
				$tail = $last_null + 1;
				if ( $tail < $count ) {
					$block['innerContent'][ $tail ] = $closing_tags . ( (string) $block['innerContent'][ $tail ] );
				} else {
					$block['innerContent'][] = $closing_tags;
				}
			}
		}

		return $block;
	}

	/**
	 * Process tp-switch-inner block.
	 *
	 * Each switch panel's exported HTML self-closes `switch-content-{n}` before the null
	 * slots for its child blocks, so the pricing table blocks render outside the panel div.
	 * Delegates to fix_content_editor_wrap using the panel's index to build the class name.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_switch_inner( $block, $attrs ) {
		if ( ! empty( $block['innerBlocks'] ) ) {
			$index         = isset( $attrs['index'] ) ? intval( $attrs['index'] ) : 1;
			$wrapper_class = 'switch-content-' . $index;
			$block         = $this->fix_content_editor_wrap( $block, $wrapper_class );
		}
		return $block;
	}

	/**
	 * Fix innerContent so innerBlocks are placed inside the wrapper div.
	 *
	 * The exported HTML for editor-type blocks (accordion-inner, tab-item, anything-slide,
	 * etc.) closes the wrapper div before the null slots that represent innerBlocks in
	 * innerContent. As a result, WordPress renders the innerBlock content after the closed
	 * wrapper, breaking the layout.
	 *
	 * This method finds the chunk that contains a fully-closed wrapper div followed by null
	 * slots, strips the premature closing tags from that chunk, and appends them after the
	 * last null slot so innerBlocks render inside the wrapper.
	 *
	 * @param array  $block         Block data with innerBlocks and innerContent.
	 * @param string $wrapper_class CSS class identifying the wrapper div (default: tpgb-content-editor).
	 * @return array Block with corrected innerContent.
	 */
	private function fix_content_editor_wrap( $block, $wrapper_class = 'tpgb-content-editor' ) {
		if ( empty( $block['innerBlocks'] ) || empty( $block['innerContent'] ) ) {
			return $block;
		}

		$content = $block['innerContent'];
		$count   = count( $content );

		for ( $i = 0; $i < $count; $i++ ) {
			$chunk = $content[ $i ];
			if ( null === $chunk || ! is_string( $chunk ) || false === strpos( $chunk, $wrapper_class ) ) {
				continue;
			}

			// Only act when there is a null (innerBlock placeholder) AFTER this chunk.
			$has_null_after = false;
			for ( $j = $i + 1; $j < $count; $j++ ) {
				if ( null === $content[ $j ] ) {
					$has_null_after = true;
					break;
				}
			}
			if ( ! $has_null_after ) {
				continue;
			}

			// Match the wrapper div (self-closed or empty) followed by closing tags at the end of this chunk.
			// Capture the opening tag so we can keep it open for innerBlocks.
			$pattern = '/(<div\b[^>]*\b' . preg_quote( $wrapper_class, '/' ) . '\b[^>]*>)\s*(<\/div>\s*)+$/s';
			if ( ! preg_match( $pattern, $chunk, $m ) ) {
				continue;
			}

			$opening_tag = $m[1];
			$full_match  = $m[0];
			// Count how many closing tags were part of the match (after the opening tag).
			$removed_part = substr( $full_match, strlen( $opening_tag ) );
			$close_count  = substr_count( $removed_part, '</div>' );
			$closing_tags = str_repeat( '</div>', $close_count );

			// Remove the premature closing tag(s) from this chunk, keeping the wrapper div open.
			$block['innerContent'][ $i ] = preg_replace(
				$pattern,
				'$1',
				$chunk
			);

			// Append the closing tags to the entry immediately after the last null slot.
			$last_null = -1;
			for ( $j = $count - 1; $j >= 0; $j-- ) {
				if ( null === $block['innerContent'][ $j ] ) {
					$last_null = $j;
					break;
				}
			}
			if ( $last_null >= 0 ) {
				$tail = $last_null + 1;
				if ( $tail < $count ) {
					$block['innerContent'][ $tail ] = $closing_tags . ( (string) $block['innerContent'][ $tail ] );
				} else {
					$block['innerContent'][] = $closing_tags;
				}
			}

			break; // Only fix the first occurrence per block.
		}

		return $block;
	}

	/**
	 * Process heading block.
	 *
	 * @param array $block Block data.
	 * @return array Block.
	 */
	private function process_heading( $block ) {

		$new_title = isset( $block['attrs']['exTitle'] ) ? $block['attrs']['exTitle'] : '';
		if ( '' === $new_title || empty( $block['innerHTML'] ) ) {
			return $block;
		}

		// ---- locate the heading node and replace its content (unchanged) ----
		libxml_use_internal_errors( true );
		$dom = new DOMDocument();
		$dom->loadHTML(
			'<?xml encoding="utf-8" ?>' . $block['innerHTML'],
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);

		$xpath        = new DOMXPath( $dom );
		$heading_node = $xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " tp-core-heading ")]' )->item( 0 );

		if ( $heading_node ) {
			while ( $heading_node->firstChild ) {
				$heading_node->removeChild( $heading_node->firstChild );
			}

			if ( wp_strip_all_tags( $new_title ) !== $new_title ) {
				// Title carries markup (e.g. a dynamic span) — import as real nodes.
				$frag = new DOMDocument();
				$frag->loadHTML(
					'<?xml encoding="utf-8" ?><div>' . $new_title . '</div>',
					LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
				);
				$wrap = $frag->getElementsByTagName( 'div' )->item( 0 );
				if ( $wrap ) {
					foreach ( iterator_to_array( $wrap->childNodes ) as $child ) {
						$heading_node->appendChild( $dom->importNode( $child, true ) );
					}
				}
			} else {
				$heading_node->appendChild( $dom->createTextNode( $new_title ) );
			}
		}

		$new_html = $dom->saveHTML();
		libxml_clear_errors();

		// ---- THE FIX: normalise dynamic spans to the resolver-readable form ----
		// libxml's saveHTML() emits attributes with literal double quotes as
		// data-tpgb-dynamic='{"…"}' (single-quote delimited). Nexter Blocks'
		// stock resolver cannot parse that form, so the field never resolves on
		// the frontend. Force the double-quote + "-encoded form it expects.
		// html_entity_decode() first makes this idempotent (no double-encoding).
		$new_html = preg_replace_callback(
			'/data-tpgb-dynamic=([\'"])(.*?)\1/s',
			static function ( $m ) {
				$json = html_entity_decode( $m[2], ENT_QUOTES | ENT_HTML5, 'UTF-8' );
				return 'data-tpgb-dynamic="' . htmlspecialchars( $json, ENT_QUOTES, 'UTF-8' ) . '"';
			},
			$new_html
		);

		$block['innerHTML'] = $new_html;
		if ( isset( $block['innerContent'][0] ) ) {
			$block['innerContent'][0] = $new_html;
		}

		return $block;
	}

	/**
	 * Process pro paragraph block.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_pro_paragraph( $block, $attrs ) {
		// Match WDesignKit: use innerContent[0] when innerHTML is missing.
		$html = isset( $block['innerHTML'] ) ? trim( (string) $block['innerHTML'] ) : '';
		if ( '' === $html && ! empty( $block['innerContent'][0] ) && is_string( $block['innerContent'][0] ) ) {
			$html               = trim( $block['innerContent'][0] );
			$block['innerHTML'] = $html;
		}
		if ( '' === $html ) {
			return $block;
		}

		$new_title   = ! empty( $attrs['exTitle'] ) ? wp_kses_post( $attrs['exTitle'] ) : '';
		$new_content = ! empty( $attrs['exproCnt'] ) ? wp_kses_post( $attrs['exproCnt'] ) : '';

		// Populate from innerHTML when both attrs are empty so content appears in editor.
		if ( '' === $new_title && '' === $new_content ) {
			$prev    = libxml_use_internal_errors( true );
			$tmp_dom = new DOMDocument();
			$tmp_dom->loadHTML( '<?xml encoding="utf-8" ?>' . $html );
			$tmp_xpath = new DOMXPath( $tmp_dom );

			// Extract title from .pro-heading-inner
			$heading_nodes = $tmp_xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " pro-heading-inner ")]' );
			if ( $heading_nodes && $heading_nodes->length > 0 ) {
				$new_title = wp_kses_post( trim( $heading_nodes->item( 0 )->textContent ) );
			}

			// Extract content from .pro-paragraph-inner
			$para_nodes = $tmp_xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " pro-paragraph-inner ")]' );
			if ( $para_nodes && $para_nodes->length > 0 ) {
				// Preserve inner HTML (e.g. <p> tags) not just text
				$inner = '';
				foreach ( $para_nodes->item( 0 )->childNodes as $child ) {
					$inner .= $tmp_dom->saveHTML( $child );
				}
				$new_content = wp_kses_post( trim( $inner ) );
			}

			libxml_clear_errors();
			libxml_use_internal_errors( $prev );
		}

		$title_tag = ! empty( $attrs['titleTag'] ) ? strtolower( $attrs['titleTag'] ) : 'h3';
		$desc_tag  = ! empty( $attrs['descTag'] ) ? strtolower( $attrs['descTag'] ) : 'p';

		// ✅ FIX #4: Capture previous state and restore after to avoid leaking errors.
		$prev_libxml = libxml_use_internal_errors( true );

		$dom = new DOMDocument();
		$dom->loadHTML( '<?xml encoding="utf-8" ?>' . $html );
		$xpath = new DOMXPath( $dom );

		$set_inner_html = function ( DOMDocument $dom, DOMNode $node, string $new_html ) {

			// Remove existing children.
			while ( $node->firstChild ) {
				$node->removeChild( $node->firstChild );
			}

			$new_html = trim( $new_html );

			if ( '' === $new_html ) {
				return;
			}

			$tmp = new DOMDocument();
			libxml_use_internal_errors( true );

			$tmp->loadHTML(
				'<?xml encoding="utf-8" ?><body>' . $new_html . '</body>',
				LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
			);

			libxml_clear_errors();

			$body = $tmp->getElementsByTagName( 'body' )->item( 0 );

			if ( $body ) {
				foreach ( iterator_to_array( $body->childNodes ) as $child ) {
					$node->appendChild(
						$dom->importNode( $child, true )
					);
				}
			} else {
				$node->appendChild(
					$dom->createTextNode(
						html_entity_decode( wp_strip_all_tags( $new_html ) )
					)
				);
			}
		};

		if ( '' !== $new_title ) {
			$title_nodes = $xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " pro-heading-inner ")]' );
			$title_node  = $title_nodes ? $title_nodes->item( 0 ) : null;
			if ( $title_node ) {
				if ( strtolower( $title_node->nodeName ) !== $title_tag ) {
					// ✅ FIX #1: Replace tag but preserve inner HTML via saveHTML children.
					$new_node = $dom->createElement( $title_tag );
					$new_node->setAttribute( 'class', $title_node->getAttribute( 'class' ) );
					$set_inner_html( $dom, $new_node, $new_title );
					$title_node->parentNode->replaceChild( $new_node, $title_node );
				} else {
					// ✅ FIX #1: Use helper instead of nodeValue to preserve child elements.
					$set_inner_html( $dom, $title_node, $new_title );
				}
			}
			$block['attrs']['title']   = $new_title;
			$block['attrs']['exTitle'] = $new_title;
		}

		if ( '' !== $new_content ) {

			$desc_nodes = $xpath->query(
				'//*[contains(concat(" ", normalize-space(@class), " "), " pro-paragraph-inner ")]'
			);

			$desc_node = $desc_nodes ? $desc_nodes->item( 0 ) : null;

			if ( $desc_node ) {

				$current_tag = strtolower( $desc_node->nodeName );

				$replace_tag = $desc_tag;

				/*
				 * Prevent invalid HTML:
				 *
				 * <p class="pro-paragraph-inner">
				 *     <p>...</p>
				 * </p>
				 */
				$is_html = wp_strip_all_tags( $new_content ) !== $new_content;

				if ( 'p' === $replace_tag && $is_html ) {
					$replace_tag = 'div';
				}

				if ( $current_tag !== $replace_tag ) {

					$new_node = $dom->createElement( $replace_tag );

					$new_node->setAttribute(
						'class',
						$desc_node->getAttribute( 'class' )
					);

					$set_inner_html(
						$dom,
						$new_node,
						$new_content
					);

					$desc_node->parentNode->replaceChild(
						$new_node,
						$desc_node
					);

				} else {

					$set_inner_html(
						$dom,
						$desc_node,
						$new_content
					);
				}
			}

			$block['attrs']['content']  = $new_content;
			$block['attrs']['exproCnt'] = $new_content;
		}

		$body_nodes = $dom->getElementsByTagName( 'body' );
		$body       = $body_nodes->length > 0 ? $body_nodes->item( 0 ) : null;

		// ✅ FIX #5: Strip opening/closing <body ...> tag robustly, not with fragile regex.
		$new_html = '';
		if ( $body ) {
			foreach ( $body->childNodes as $child ) {
				$new_html .= $dom->saveHTML( $child );
			}
		}
		$new_html = trim( $new_html );

		// ✅ FIX #4: Restore previous libxml error state.
		libxml_clear_errors();
		libxml_use_internal_errors( $prev_libxml );

		$block['innerHTML'] = $new_html;

		// ✅ FIX #6: Preserve existing innerContent structure (null slots = inner block placeholders).
		if ( ! isset( $block['innerContent'] ) || ! is_array( $block['innerContent'] ) ) {
			$block['innerContent'] = array( $new_html );
		} else {
			// Only update the first string slot — leave null slots untouched.
			foreach ( $block['innerContent'] as $i => $slot ) {
				if ( is_string( $slot ) ) {
					$block['innerContent'][ $i ] = $new_html;
					break;
				}
			}
		}

		return $block;
	}

	/**
	 * Process button core block.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_button_core( $block, $attrs ) {
		if ( empty( $block['innerHTML'] ) ) {
			return $block;
		}
		$new_text = ! empty( $attrs['exbtxt'] ) ? wp_kses_post( $attrs['exbtxt'] ) : '';
		$new_link = ! empty( $attrs['bLink']['url'] ) ? esc_url( $attrs['bLink']['url'] ) : '';
		libxml_use_internal_errors( true );
		$dom = new DOMDocument();
		$dom->loadHTML( '<?xml encoding="utf-8" ?>' . $block['innerHTML'] );
		$xpath = new DOMXPath( $dom );
		if ( $new_text ) {
			$text_node = $xpath->query( '//*[contains(concat(" ", normalize-space(@class), " "), " tpgb-btn-txt ")]' )->item( 0 );
			if ( $text_node ) {
				$text_node->nodeValue = $new_text;
			}
			$block['attrs']['btxt']   = $new_text;
			$block['attrs']['exbtxt'] = $new_text;
		}
		if ( $new_link ) {
			$link_node = $xpath->query( '//a[contains(@class,"tpgb-btn-link")]' )->item( 0 );
			if ( $link_node ) {
				$link_node->setAttribute( 'href', $new_link );
			}
			$block['attrs']['bLink'] = $new_link;
		}
		$body                     = $dom->getElementsByTagName( 'body' )->item( 0 );
		$new_html                 = $body ? $dom->saveHTML( $body ) : '';
		$new_html                 = preg_replace( '/^<body>|<\/body>$/', '', $new_html );
		$block['innerHTML']       = $new_html;
		$block['innerContent'][0] = $new_html;
		return $block;
	}

	/**
	 * Process image block.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_image( $block, $attrs ) {
		if ( empty( $block['innerHTML'] ) ) {
			return $block;
		}
		$new_img  = ! empty( $attrs['tImg']['url'] ) ? esc_url( $attrs['tImg']['url'] ) : '';
		$new_alt  = isset( $attrs['tImg']['alt'] ) ? wp_kses_post( $attrs['tImg']['alt'] ) : '';
		$new_id   = ! empty( $attrs['tImg']['id'] ) ? intval( $attrs['tImg']['id'] ) : '';
		$new_link = ! empty( $attrs['tiLink']['url'] ) ? esc_url( $attrs['tiLink']['url'] ) : '';
		libxml_use_internal_errors( true );
		$dom = new DOMDocument();
		$dom->loadHTML( '<?xml encoding="utf-8" ?>' . $block['innerHTML'] );
		$xpath    = new DOMXPath( $dom );
		$img_node = $xpath->query( '//img[contains(@class,"tpgb-img-inner")]' )->item( 0 );
		if ( $img_node ) {
			if ( $new_img ) {
				$img_node->setAttribute( 'src', $new_img );
				$block['attrs']['tImg']['url'] = $new_img;
			}
			if ( $new_alt ) {
				$img_node->setAttribute( 'alt', $new_alt );
				$block['attrs']['tImg']['alt'] = $new_alt;
			}
			if ( $new_id ) {
				$img_node->setAttribute( 'class', 'tpgb-img-inner wp-image-' . $new_id );
				$block['attrs']['tImg']['id'] = $new_id;
			}
		}
		if ( $new_link ) {
			$link_node = $xpath->query( '//a' )->item( 0 );
			if ( $link_node ) {
				$link_node->setAttribute( 'href', $new_link );
			}
			$block['attrs']['tiLink']['url'] = $new_link;
		}
		$body                     = $dom->getElementsByTagName( 'body' )->item( 0 );
		$new_html                 = $body ? $dom->saveHTML( $body ) : '';
		$new_html                 = preg_replace( '/^<body>|<\/body>$/', '', $new_html );
		$block['innerHTML']       = $new_html;
		$block['innerContent'][0] = $new_html;
		return $block;
	}

	/**
	 * Remove legacy (static-HTML) tp-tab-item blocks from every tp-tabs-tours.
	 *
	 * WDesignKit exports each tabs-tours tab item TWICE, like carousel slides:
	 *   1. Legacy format — the tab item's tab-mobile-title / tpgb-tab-content wrapper <div>s
	 *      live in static innerHTML and the inner blocks are nested inside them. The inner
	 *      blocks here are a STALE serialization (e.g. tp-image without iHeig / imgFit).
	 *   2. Proper format — no static HTML wrapper; inner blocks are referenced directly as
	 *      innerBlocks and carry the current attrs. The tp-tab-item render callback generates
	 *      the tpgb-tab-content wrapper itself when it is absent, so no markup is lost.
	 *
	 * Tab items never carry a block_id, so unlike carousel slides the two formats are told
	 * apart by the static wrapper markup in innerHTML. Both formats share the SAME inner
	 * block_ids, so if the legacy items are left in place when the importer's
	 * deduplicate_blocks_by_id runs, the deduplicator keeps the stale legacy inner blocks and
	 * strips the proper ones — silently dropping attrs like iHeig / imgFit.
	 *
	 * Additionally, INSIDE each proper tab item the exporter can serialize the same inner
	 * block twice as siblings (same block_id): first the stale copy (image attrs still
	 * pointing at the design-site placeholder), then the refreshed copy (image attrs pointing
	 * at the user's library image). The importer's deduplicator keeps the FIRST duplicate, so
	 * the stale placeholder image would win — keep_last_duplicate_inner_blocks resolves those
	 * in favour of the LAST (newest) copy before deduplication runs.
	 *
	 * Public (not part of run()) because it must be called BEFORE the importer's
	 * deduplicate_blocks_by_id pass, while run() executes after it.
	 *
	 * @param array $blocks Parsed block tree.
	 * @return array Block tree with legacy tab items removed.
	 */
	public function remove_legacy_tab_items( array $blocks ) {
		foreach ( $blocks as &$block ) {
			// Recurse into all inner blocks first.
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->remove_legacy_tab_items( $block['innerBlocks'] );
			}

			if ( 'tpgb/tp-tabs-tours' !== ( isset( $block['blockName'] ) ? $block['blockName'] : '' ) ) {
				continue;
			}
			if ( empty( $block['innerBlocks'] ) ) {
				continue;
			}

			// Separate tab-item innerBlocks into legacy (static wrapper HTML) and proper,
			// keyed by tabtoIndex so a legacy item is only removed when its proper
			// counterpart exists.
			$legacy_indices = array();
			$proper_keys    = array();
			foreach ( $block['innerBlocks'] as $idx => $inner ) {
				if ( 'tpgb/tp-tab-item' !== ( isset( $inner['blockName'] ) ? $inner['blockName'] : '' ) ) {
					continue;
				}
				$key        = isset( $inner['attrs']['tabtoIndex'] ) ? (string) $inner['attrs']['tabtoIndex'] : '';
				$inner_html = isset( $inner['innerHTML'] ) && is_string( $inner['innerHTML'] ) ? $inner['innerHTML'] : '';
				if ( false !== strpos( $inner_html, 'tpgb-tab-content' ) ) {
					$legacy_indices[ $idx ] = $key;
				} else {
					$proper_keys[ $key ] = true;
				}
			}

			// Only act when both kinds are present (the mixed-export case).
			if ( ! empty( $legacy_indices ) && ! empty( $proper_keys ) ) {
				$remove_set = array();
				foreach ( $legacy_indices as $idx => $key ) {
					if ( isset( $proper_keys[ $key ] ) ) {
						$remove_set[ $idx ] = true;
					}
				}
				if ( ! empty( $remove_set ) ) {
					$block = $this->remove_inner_blocks_by_index( $block, $remove_set );
				}
			}

			// Resolve duplicated siblings inside each remaining tab item in favour of
			// the LAST (newest) copy, so the importer's keep-first deduplicator doesn't
			// preserve the stale placeholder-image copy.
			foreach ( $block['innerBlocks'] as $i => $inner ) {
				if ( 'tpgb/tp-tab-item' === ( isset( $inner['blockName'] ) ? $inner['blockName'] : '' ) ) {
					$block['innerBlocks'][ $i ] = $this->keep_last_duplicate_inner_blocks( $inner );
				}
			}
		}
		unset( $block );
		return $blocks;
	}

	/**
	 * Keep only the LAST copy of direct inner blocks sharing the same block_id.
	 *
	 * The exporter can serialize an updated version of a block AFTER its stale version
	 * within the same parent (observed inside proper tp-tab-item blocks: the first
	 * container copy still references the design-site placeholder image, the second
	 * carries the user's library image). Later copies are the newest, so earlier
	 * duplicates are dropped. Applied recursively to the whole subtree.
	 *
	 * @param array $block Block whose innerBlocks are filtered.
	 * @return array Block with earlier duplicate siblings removed.
	 */
	private function keep_last_duplicate_inner_blocks( array $block ) {
		if ( empty( $block['innerBlocks'] ) ) {
			return $block;
		}

		foreach ( $block['innerBlocks'] as $idx => $inner ) {
			$block['innerBlocks'][ $idx ] = $this->keep_last_duplicate_inner_blocks( $inner );
		}

		$last_index = array();
		foreach ( $block['innerBlocks'] as $idx => $inner ) {
			$bid = isset( $inner['attrs']['block_id'] ) ? (string) $inner['attrs']['block_id'] : '';
			if ( '' !== $bid ) {
				$last_index[ $bid ] = $idx;
			}
		}

		$remove_set = array();
		foreach ( $block['innerBlocks'] as $idx => $inner ) {
			$bid = isset( $inner['attrs']['block_id'] ) ? (string) $inner['attrs']['block_id'] : '';
			if ( '' !== $bid && $last_index[ $bid ] !== $idx ) {
				$remove_set[ $idx ] = true;
			}
		}
		if ( empty( $remove_set ) ) {
			return $block;
		}

		return $this->remove_inner_blocks_by_index( $block, $remove_set );
	}

	/**
	 * Remove the given innerBlocks (by index) from a block, keeping innerContent aligned.
	 *
	 * The K-th null in innerContent is the placeholder for innerBlocks[K], so the
	 * matching null slots are dropped alongside the blocks.
	 *
	 * @param array $block      Block to filter.
	 * @param array $remove_set innerBlocks indexes to remove, as array keys.
	 * @return array Block with the blocks and their null slots removed.
	 */
	private function remove_inner_blocks_by_index( array $block, array $remove_set ) {
		$new_inner_blocks = array();
		foreach ( $block['innerBlocks'] as $idx => $inner ) {
			if ( ! isset( $remove_set[ $idx ] ) ) {
				$new_inner_blocks[] = $inner;
			}
		}
		$block['innerBlocks'] = array_values( $new_inner_blocks );

		$null_counter      = 0;
		$new_inner_content = array();
		foreach ( $block['innerContent'] as $chunk ) {
			if ( null === $chunk ) {
				if ( ! isset( $remove_set[ $null_counter ] ) ) {
					$new_inner_content[] = $chunk;
				}
				++$null_counter;
			} else {
				$new_inner_content[] = $chunk;
			}
		}
		$block['innerContent'] = $new_inner_content;

		return $block;
	}

	/**
	 * Process tabs tours block.
	 *
	 * @param array $block Block data.
	 * @param array $attrs Block attrs.
	 * @return array Block.
	 */
	private function process_tabs_tours( $block, $attrs ) {
		if ( empty( $attrs['tablistRepeater'] ) ) {
			return $block;
		}
		$is_editor = isset( $attrs['tabType'] ) && 'editor' === $attrs['tabType'];

		// When using editor content type the tab items are innerBlocks. The exported HTML
		// closes tpgb-tabs-content-wrapper inside innerContent[0] — before any null slots —
		// so all tp-tab-item blocks render outside the wrapper on the frontend.
		// Fix: strip the closing tags from the end of innerContent[0] and append them after
		// the last null slot so the tab items land inside tpgb-tabs-content-wrapper.
		if ( $is_editor && ! empty( $block['innerBlocks'] ) && isset( $block['innerContent'][0] ) ) {
			$chunk = $block['innerContent'][0];
			if (
				strpos( $chunk, 'tpgb-tabs-content-wrapper' ) !== false &&
				preg_match( '/(<div\b[^>]*\btpgb-tabs-content-wrapper\b[^>]*>)\s*(<\/div>\s*)+$/s', $chunk, $m )
			) {
				$opening_tag  = $m[1];
				$removed_part = substr( $m[0], strlen( $opening_tag ) );
				$close_count  = substr_count( $removed_part, '</div>' );
				$closing_tags = str_repeat( '</div>', $close_count );

				$block['innerContent'][0] = preg_replace(
					'/(<div\b[^>]*\btpgb-tabs-content-wrapper\b[^>]*>)\s*(<\/div>\s*)+$/s',
					'$1',
					$chunk
				);

				$count     = count( $block['innerContent'] );
				$last_null = -1;
				for ( $j = $count - 1; $j >= 0; $j-- ) {
					if ( null === $block['innerContent'][ $j ] ) {
						$last_null = $j;
						break;
					}
				}
				if ( $last_null >= 0 ) {
					$tail = $last_null + 1;
					if ( $tail < $count ) {
						$block['innerContent'][ $tail ] = $closing_tags . ( (string) $block['innerContent'][ $tail ] );
					} else {
						$block['innerContent'][] = $closing_tags;
					}
				}
			}
		}

		foreach ( $attrs['tablistRepeater'] as $index => $item ) {
			$tab_number = $index + 1;
			$title      = sanitize_text_field( $item['tabTitle'] ?? '' );
			$desc       = wp_kses_post( $item['tabDescription'] ?? '' );
			if ( isset( $block['innerContent'][0] ) ) {
				$block['innerContent'][0] = preg_replace(
					'/(<div[^>]*class="[^"]*tpgb-tab-header[^"]*"[^>]*data-tab="' . $tab_number . '"[^>]*>\s*<span>)(.*?)(<\/span>)/s',
					'$1' . esc_html( $title ) . '$3',
					$block['innerContent'][0],
					1
				);
			}
			$block['attrs']['tablistRepeater'][ $index ]['tabTitle'] = $title;
			if ( ! $is_editor && ! empty( $desc ) ) {
				if ( isset( $block['innerContent'][0] ) ) {
					$block['innerContent'][0] = preg_replace(
						'/(<div[^>]*class="[^"]*tab-mobile-title[^"]*"[^>]*data-tab="' . $tab_number . '"[^>]*>\s*<span>)(.*?)(<\/span>)/s',
						'$1' . esc_html( $title ) . '$3',
						$block['innerContent'][0],
						1
					);
				}
				if ( isset( $block['innerContent'][0] ) ) {
					$block['innerContent'][0] = preg_replace(
						'/(<div[^>]*class="[^"]*tpgb-tab-content[^"]*"[^>]*data-tab="' . $tab_number . '"[^>]*>.*?<div[^>]*class="[^"]*tpgb-content-editor[^"]*"[^>]*>)(.*?)(<\/div>\s*<\/div>)/s',
						'$1' . $desc . '$3',
						$block['innerContent'][0],
						1
					);
				}
				$block['attrs']['tablistRepeater'][ $index ]['tabDescription'] = $desc;
			}
		}
		return $block;
	}
}
