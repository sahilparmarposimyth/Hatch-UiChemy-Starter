<?php
/**
 * Dynamic-data providers â€” typed, chainable objects exposed to templates.
 *
 * Each provider extends Uich_Provider and implements uich_get( $name, $args ) which is the
 * ONLY way the Twig sandbox reaches WordPress data. Missing fields return null (null-safe).
 * Sensitive fields are capability-gated. Relations return other providers so users can chain
 * (e.g. post.author.name, post.thumbnail.src('large')).
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Provider' ) ) {
	/**
	 * Base provider. Subclasses define a $map of field => callable|value, or override uich_get().
	 */
	abstract class Uich_Provider {

		/**
		 * Resolve a field. $args supports method-style calls e.g. post.date('F j, Y').
		 *
		 * @param string $name Field name.
		 * @param array  $args Optional call arguments.
		 * @return mixed scalar | array | Uich_Provider | null
		 */
		abstract public function uich_get( $name, $args = array() );

		/**
		 * The provider kind used for Free/Pro field tiering. Subclasses override.
		 *
		 * Uich_Product_Provider deliberately does NOT override it: a product reports
		 * `post`, so a product's title/content/image resolve in Free exactly like any
		 * other post while its commerce fields (price, sku, stock, â€¦) sit outside the
		 * free list and are refused.
		 *
		 * @return string post|term|image|user|site|request
		 */
		public function uich_kind() {
			return 'unknown';
		}

		/**
		 * Read a field through the Free/Pro gate. THE only entry point the template
		 * engine may use â€” uich_get() itself stays ungated so internal PHP callers
		 * (and Pro) keep direct access.
		 *
		 * In Free a field outside uichemy_dynamic_free_fields() returns null, which
		 * the engine renders as an empty string. This is deliberate and was chosen
		 * over "hide in the picker only": a Pro-only tag resolves to nothing in Free
		 * even in an imported template or on a site that downgraded from Pro.
		 *
		 * @param string $name Field name.
		 * @param array  $args Optional call arguments.
		 * @return mixed
		 */
		final public function uich_read( $name, $args = array() ) {
			if ( function_exists( 'uichemy_dynamic_field_allowed' )
				&& ! uichemy_dynamic_field_allowed( $this->uich_kind(), $name ) ) {
				return null;
			}

			return $this->uich_get( $name, $args );
		}

		/** Helper: format a date string. */
		protected function fmt_date( $value, $args ) {
			$format = ! empty( $args[0] ) ? (string) $args[0] : get_option( 'date_format' );
			$ts     = is_numeric( $value ) ? (int) $value : strtotime( (string) $value );
			if ( ! $ts ) {
				return '';
			}
			return wp_date( $format, $ts );
		}

		/**
		 * Decide whether a meta key may be read in a template. Protected/hidden meta
		 * (keys beginning with "_", e.g. _edit_lock, license keys, payment tokens) is
		 * blocked for users who cannot edit content, preventing private-data exposure
		 * via {{ post.meta('_secret') }} or the unknown-field meta fallback.
		 *
		 * @param string $key Meta key.
		 * @return bool
		 */
		protected function meta_allowed( $key ) {
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

if ( ! class_exists( 'Uich_Post_Provider' ) ) {
	/**
	 * Wraps a WP_Post. Exposed as `post` and as loop items for post queries.
	 */
	class Uich_Post_Provider extends Uich_Provider {

		protected $post;

		public function __construct( $post ) {
			$this->post = get_post( $post );
		}

		public function uich_kind() {
			return 'post';
		}

		/**
		 * The FREE post fields: Post Title, Post Content, Post URL and Post Image
		 * (plus `id`, which is loop plumbing rather than a pickable tag).
		 *
		 * Everything else â€” excerpt, date, author, categories, tags, custom fields,
		 * status, type and the meta fallback â€” lives in Uich_Post_Provider_Pro, which
		 * extends this class and ships only in Pro. Free does not contain that code,
		 * so those fields cannot resolve here at all.
		 * See docs/free-pro-split-plan.md.
		 */
		public function uich_get( $name, $args = array() ) {
			if ( ! $this->post instanceof WP_Post ) {
				return null;
			}
			$p = $this->post;

			switch ( $name ) {
				case '__toString':
				case 'title':
					return get_the_title( $p );
				case 'id':
				case 'ID':
					return (int) $p->ID;
				case 'link':
				case 'url':
				case 'permalink':
					return get_permalink( $p );
				case 'content':
					return apply_filters( 'the_content', $p->post_content ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Intentional WordPress core integration hook (the_content) so post content renders identically to the theme.
				case 'thumbnail':
				case 'featured_image':
					$tid = get_post_thumbnail_id( $p );
					return $tid ? new Uich_Image_Provider( (int) $tid ) : null;
			}

			return null;
		}
	}
}

if ( ! class_exists( 'Uich_Image_Provider' ) ) {
	class Uich_Image_Provider extends Uich_Provider {
		protected $id;

		public function __construct( $id ) {
			$this->id = (int) $id;
		}

		public function uich_kind() {
			return 'image';
		}

		public function uich_get( $name, $args = array() ) {
			if ( ! $this->id ) {
				return null;
			}
			switch ( $name ) {
				case '__toString':
				case 'src':
				case 'url':
					$size = ! empty( $args[0] ) ? $args[0] : 'full';
					$src  = wp_get_attachment_image_src( $this->id, $size );
					return $src ? $src[0] : '';
				case 'srcset':
					$size = ! empty( $args[0] ) ? $args[0] : 'full';
					return (string) wp_get_attachment_image_srcset( $this->id, $size );
				case 'img_sizes':
				case 'sizes':
					$size = ! empty( $args[0] ) ? $args[0] : 'full';
					return (string) wp_get_attachment_image_sizes( $this->id, $size );
				case 'alt':
					return (string) get_post_meta( $this->id, '_wp_attachment_image_alt', true );
				case 'width':
					$m = wp_get_attachment_metadata( $this->id );
					return isset( $m['width'] ) ? (int) $m['width'] : 0;
				case 'height':
					$m = wp_get_attachment_metadata( $this->id );
					return isset( $m['height'] ) ? (int) $m['height'] : 0;
				case 'caption':
					return wp_get_attachment_caption( $this->id );
				case 'id':
				case 'ID':
					return $this->id;
			}
			return null;
		}
	}
}
