<?php
/**
 * Atom Dynamic Tags — abstract bases + shared context trait.
 *
 * Loaded lazily from Uich_Dynamic_Tags::register() (the
 * `elementor/dynamic_tags/register` hook), so the Elementor parent classes are
 * guaranteed to exist before these definitions run.
 *
 * @link    https://posimyth.com/
 * @since   5.1.0
 *
 * @package Uichemy
 */

use Elementor\Core\DynamicTags\Tag;
use Elementor\Core\DynamicTags\Data_Tag;
use Elementor\Modules\DynamicTags\Module as Tags_Module;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Shared resolution helpers for every Atom dynamic tag.
 *
 * Resolution mirrors the Twig provider layer (Uich_Dynamic) so the visual
 * picker and typed expressions return the same value for the same field.
 *
 * @since 5.1.0
 */
if ( ! trait_exists( 'Uich_DT_Context' ) ) {

	trait Uich_DT_Context {

		/**
		 * Current post ID in the active query context.
		 *
		 * @since 5.1.0
		 * @return int
		 */
		protected function uich_post_id() {
			$id = get_the_ID();
			return $id ? (int) $id : 0;
		}

		/**
		 * Resolve the "current user" — the queried user on an author archive,
		 * otherwise the author of the current post.
		 *
		 * @since 5.1.0
		 * @return WP_User|null
		 */
		protected function uich_user() {
			$obj = get_queried_object();
			if ( $obj instanceof WP_User ) {
				return $obj;
			}

			$post_id = $this->uich_post_id();
			if ( $post_id ) {
				$author_id = (int) get_post_field( 'post_author', $post_id );
				if ( $author_id ) {
					$user = get_user_by( 'id', $author_id );
					return $user ? $user : null;
				}
			}

			return null;
		}

		/**
		 * Resolve the queried term on a taxonomy/category/tag archive.
		 *
		 * @since 5.1.0
		 * @return WP_Term|null
		 */
		protected function uich_term() {
			$obj = get_queried_object();
			return ( $obj instanceof WP_Term ) ? $obj : null;
		}

		/**
		 * Whether a meta key may be read in the current view.
		 *
		 * ONE policy for the visual tags and the Twig provider (mirrors
		 * Uich_Provider::meta_allowed()): an empty key is refused; a protected
		 * `_`-prefixed key is refused unless the current viewer can `edit_posts`,
		 * so internal meta — auth tokens, licence keys, password-reset flags —
		 * never renders to the public, unauthenticated frontend; and the
		 * `uich_dynamic_block_meta` filter can block any further key.
		 *
		 * Every arbitrary-key meta tag (Post/User/Term Custom Field, JetEngine)
		 * MUST route its get_post_meta()/get_user_meta()/get_term_meta() read
		 * through this gate — the picker only shows safe keys, but the stored key
		 * setting is attacker-influenceable and renders on the front end.
		 *
		 * @since 5.1.0
		 * @param string $key Meta key.
		 * @return bool
		 */
		protected function uich_meta_allowed( $key ) {
			$key = (string) $key;
			if ( '' === $key ) {
				return false;
			}
			if ( '_' === $key[0] && ! current_user_can( 'edit_posts' ) ) {
				return false;
			}
			return ! (bool) apply_filters( 'uich_dynamic_block_meta', false, $key );
		}
	}
}

/**
 * Base for TEXT-category tags. Concrete classes implement get_value().
 *
 * @since 5.1.0
 */
if ( ! class_exists( 'Uich_DT_Text_Base' ) ) {

	abstract class Uich_DT_Text_Base extends Tag {

		use Uich_DT_Context;

		public function get_categories(): array {
			return array( Tags_Module::TEXT_CATEGORY );
		}

		public function is_settings_required() {
			return false;
		}

		/**
		 * Echo the resolved value (escaped for content).
		 *
		 * @since 5.1.0
		 * @return void
		 */
		public function render(): void {
			echo wp_kses_post( (string) $this->get_value() );
		}

		/**
		 * @since 5.1.0
		 * @param array $options Optional rendering options.
		 * @return string
		 */
		abstract public function get_value( array $options = array() );
	}
}

/**
 * Base for URL-category tags (link controls). Returns a plain URL string.
 *
 * @since 5.1.0
 */
if ( ! class_exists( 'Uich_DT_Url_Base' ) ) {

	abstract class Uich_DT_Url_Base extends Data_Tag {

		use Uich_DT_Context;

		public function get_categories(): array {
			return array( Tags_Module::URL_CATEGORY );
		}

		public function is_settings_required() {
			return false;
		}
	}
}

/**
 * Base for IMAGE-category tags (media controls). get_value() must return
 * array( 'id' => int, 'url' => string ) as Elementor expects for media.
 *
 * @since 5.1.0
 */
if ( ! class_exists( 'Uich_DT_Image_Base' ) ) {

	abstract class Uich_DT_Image_Base extends Data_Tag {

		use Uich_DT_Context;

		public function get_categories(): array {
			return array( Tags_Module::IMAGE_CATEGORY );
		}

		public function is_settings_required() {
			return false;
		}

		/**
		 * Build the Elementor media array from an attachment ID.
		 *
		 * @since 5.1.0
		 * @param int $attachment_id Attachment ID (0 = none).
		 * @return array
		 */
		protected function uich_image_value( $attachment_id ) {
			$attachment_id = (int) $attachment_id;
			$url           = $attachment_id ? wp_get_attachment_image_url( $attachment_id, 'full' ) : '';

			return array(
				'id'  => $attachment_id,
				'url' => $url ? $url : '',
			);
		}
	}
}
