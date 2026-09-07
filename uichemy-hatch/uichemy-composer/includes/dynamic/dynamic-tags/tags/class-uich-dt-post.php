<?php
/**
 * UiChemy Dynamic Tags - Post group (the FREE four).
 *
 * Post Title, Post Content, Post URL and Post Image. These four are the whole
 * dynamic-tag library in the Free build.
 *
 * Post ID, Post Excerpt, Post Date and Post Custom Field live in the PRO-ONLY
 * class-uich-dt-post-pro.php, which Free does not ship. See
 * docs/free-pro-split-plan.md.
 *
 * @link    https://posimyth.com/
 * @since   5.1.0
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

if ( ! class_exists( 'Uich_DT_Post_Title' ) ) {

	/**
	 * Current post title.
	 *
	 * @since 5.1.0
	 */
	class Uich_DT_Post_Title extends Uich_DT_Text_Base {

		public function get_name(): string {
			return 'composer-post-title';
		}

		public function get_title(): string {
			return esc_html__( 'Post Title', 'uichemy' );
		}

		public function get_group(): array {
			return array( Uich_Dynamic_Tags::GROUP_POST );
		}

		public function get_value( array $options = array() ) {
			$id = $this->uich_post_id();
			return $id ? get_the_title( $id ) : '';
		}
	}
}

if ( ! class_exists( 'Uich_DT_Post_Content' ) ) {

	/**
	 * Current post content (filtered).
	 *
	 * @since 5.1.0
	 */
	class Uich_DT_Post_Content extends Uich_DT_Text_Base {

		public function get_name(): string {
			return 'composer-post-content';
		}

		public function get_title(): string {
			return esc_html__( 'Post Content', 'uichemy' );
		}

		public function get_group(): array {
			return array( Uich_Dynamic_Tags::GROUP_POST );
		}

		public function get_value( array $options = array() ) {
			$id = $this->uich_post_id();
			if ( ! $id ) {
				return '';
			}

			$content = get_post_field( 'post_content', $id );
			return (string) apply_filters( 'the_content', $content ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Intentional WordPress core integration hook (the_content) so post content renders identically to the theme.
		}
	}
}

if ( ! class_exists( 'Uich_DT_Post_Permalink' ) ) {

	/**
	 * Current post permalink (URL category â€” for link controls).
	 *
	 * @since 5.1.0
	 */
	class Uich_DT_Post_Permalink extends Uich_DT_Url_Base {

		public function get_name(): string {
			return 'composer-post-permalink';
		}

		public function get_title(): string {
			return esc_html__( 'Post Permalink', 'uichemy' );
		}

		public function get_group(): array {
			return array( Uich_Dynamic_Tags::GROUP_POST );
		}

		public function get_value( array $options = array() ) {
			$id  = $this->uich_post_id();
			$url = $id ? get_permalink( $id ) : '';
			return $url ? $url : '';
		}
	}
}

if ( ! class_exists( 'Uich_DT_Post_Featured_Image' ) ) {

	/**
	 * Current post featured image (image category â€” for media controls).
	 *
	 * @since 5.1.0
	 */
	class Uich_DT_Post_Featured_Image extends Uich_DT_Image_Base {

		public function get_name(): string {
			return 'composer-post-featured-image';
		}

		public function get_title(): string {
			return esc_html__( 'Featured Image', 'uichemy' );
		}

		public function get_group(): array {
			return array( Uich_Dynamic_Tags::GROUP_POST );
		}

		public function get_value( array $options = array() ) {
			$id = $this->uich_post_id();
			return $this->uich_image_value( $id ? get_post_thumbnail_id( $id ) : 0 );
		}
	}
}
