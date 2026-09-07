<?php
/**
 * UiChemy_Conditions — evaluate a template's display conditions for the request.
 *
 * Two coexisting shapes (additive, backward compatible):
 *
 *  Legacy (v1): entire site + explicit include/exclude of post IDs.
 *     array( 'scope' => 'entire'|'specific', 'include' => int[], 'exclude' => int[] )
 *
 *  Rules (v2): a list of include/exclude rules. When a non-empty `rules` array
 *  is present it takes precedence; otherwise the legacy fields are used, so old
 *  saved templates (and the pre-rebuild UI) keep working unchanged.
 *     array( 'rules' => array(
 *        array( 'match' => 'include'|'exclude', 'type' => 'entire' ),
 *        array( 'match' => ..., 'type' => 'post_type', 'value' => 'post' ),
 *        array( 'match' => ..., 'type' => 'taxonomy', 'taxonomy' => 'category', 'term' => 0 ),
 *        array( 'match' => ..., 'type' => 'author', 'value' => 0 ),
 *        array( 'match' => ..., 'type' => 'singular', 'value' => 123 ),
 *        array( 'match' => ..., 'type' => 'search' ),
 *     ) )
 *
 * @package UiChemy
 * @subpackage UiChemy/theme-builder
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Conditions' ) ) {

	/**
	 * Matches template display conditions against the current request.
	 */
	class UiChemy_Conditions {

		/** Specificity weights, broad → narrow. Higher wins in the resolver. */
		const SPEC_ENTIRE   = 1;
		const SPEC_ARCHIVE  = 4;  // search / any-author / any-term archive kind
		const SPEC_POSTTYPE = 5;  // all of a post type
		const SPEC_GROUP    = 7;  // any-term-in-taxonomy / specific author
		const SPEC_SPECIFIC = 10; // a specific term or a specific post ID

		/**
		 * Evaluate a conditions set against the current request.
		 *
		 * @param mixed $conditions Raw or normalized conditions.
		 * @return array{match:bool,specificity:int}
		 */
		public static function evaluate( $conditions ) {
			$c = class_exists( 'UiChemy_Template_Store' )
				? UiChemy_Template_Store::sanitize_conditions( $conditions )
				: self::fallback_normalize( $conditions );

			if ( ! empty( $c['rules'] ) && is_array( $c['rules'] ) ) {
				return self::evaluate_rules( $c['rules'] );
			}

			return self::evaluate_legacy( $c );
		}

		/**
		 * Whether the conditions match the current request.
		 *
		 * @param mixed $conditions Conditions.
		 * @return bool
		 */
		public static function matches( $conditions ) {
			$result = self::evaluate( $conditions );
			return (bool) $result['match'];
		}

		/* ── Rules (v2) ──────────────────────────────────────────────────── */

		/**
		 * Evaluate the rule list. An exclude rule that matches removes the whole
		 * template (even site-wide); otherwise the highest-specificity matching
		 * include rule wins.
		 *
		 * @param array $rules Sanitized rules.
		 * @return array{match:bool,specificity:int}
		 */
		private static function evaluate_rules( array $rules ) {
			$best = -1;
			foreach ( $rules as $rule ) {
				$spec = self::rule_specificity( $rule );
				$hit  = self::rule_matches( $rule );
				if ( ! $hit ) {
					continue;
				}
				if ( 'exclude' === $rule['match'] ) {
					return array(
						'match'       => false,
						'specificity' => 0,
					);
				}
				if ( $spec > $best ) {
					$best = $spec;
				}
			}

			return array(
				'match'       => $best >= 0,
				'specificity' => max( 0, $best ),
			);
		}

		/**
		 * Whether a single rule matches the current request.
		 *
		 * @param array $rule Sanitized rule.
		 * @return bool
		 */
		private static function rule_matches( array $rule ) {
			$type = isset( $rule['type'] ) ? (string) $rule['type'] : '';

			switch ( $type ) {
				case 'entire':
					return true;

				case 'post_type':
					if ( ! is_singular() ) {
						return false;
					}
					return get_post_type( self::object_id() ) === (string) $rule['value'];

				case 'singular':
					return self::object_id() === (int) $rule['value'];

				case 'author':
					$author = (int) $rule['value'];
					if ( is_singular() ) {
						$post = get_post( self::object_id() );
						return $post && ( 0 === $author || (int) $post->post_author === $author );
					}
					if ( is_author() ) {
						return 0 === $author || (int) get_queried_object_id() === $author;
					}
					return false;

				case 'search':
					return is_search();

				case 'taxonomy':
					return self::taxonomy_matches(
						(string) $rule['taxonomy'],
						(int) $rule['term']
					);
			}

			return false;
		}

		/**
		 * Taxonomy rule: on a singular request the queried post must carry the
		 * term (or any term of the taxonomy when term = 0); on an archive request
		 * the queried term/taxonomy must match.
		 *
		 * @param string $taxonomy Taxonomy slug.
		 * @param int    $term     Term ID, or 0 for "any term in this taxonomy".
		 * @return bool
		 */
		private static function taxonomy_matches( $taxonomy, $term ) {
			if ( '' === $taxonomy || ! taxonomy_exists( $taxonomy ) ) {
				return false;
			}

			if ( is_singular() ) {
				if ( $term > 0 ) {
					return has_term( $term, $taxonomy, self::object_id() );
				}
				$terms = get_the_terms( self::object_id(), $taxonomy );
				return is_array( $terms ) && ! empty( $terms );
			}

			if ( is_tax( $taxonomy ) || ( 'category' === $taxonomy && is_category() ) || ( 'post_tag' === $taxonomy && is_tag() ) ) {
				if ( 0 === $term ) {
					return true;
				}
				return (int) get_queried_object_id() === $term;
			}

			return false;
		}

		/**
		 * Specificity weight for a rule (used for resolver tie-breaks).
		 *
		 * @param array $rule Rule.
		 * @return int
		 */
		private static function rule_specificity( array $rule ) {
			switch ( isset( $rule['type'] ) ? $rule['type'] : '' ) {
				case 'singular':
					return self::SPEC_SPECIFIC;
				case 'taxonomy':
					return ( (int) $rule['term'] > 0 ) ? self::SPEC_SPECIFIC : self::SPEC_GROUP;
				case 'author':
					return ( (int) $rule['value'] > 0 ) ? self::SPEC_GROUP : self::SPEC_ARCHIVE;
				case 'post_type':
					return self::SPEC_POSTTYPE;
				case 'search':
					return self::SPEC_ARCHIVE;
				case 'entire':
				default:
					return self::SPEC_ENTIRE;
			}
		}

		/* ── Legacy (v1) ─────────────────────────────────────────────────── */

		/**
		 * Evaluate the legacy scope/include/exclude shape (unchanged behaviour).
		 *
		 * @param array $c Normalized legacy conditions.
		 * @return array{match:bool,specificity:int}
		 */
		private static function evaluate_legacy( array $c ) {
			$object_id = self::object_id();

			if ( $object_id && in_array( $object_id, $c['exclude'], true ) ) {
				return array(
					'match'       => false,
					'specificity' => 0,
				);
			}

			if ( 'specific' === $c['scope'] ) {
				if ( $object_id && in_array( $object_id, $c['include'], true ) ) {
					return array(
						'match'       => true,
						'specificity' => self::SPEC_SPECIFIC,
					);
				}
				return array(
					'match'       => false,
					'specificity' => 0,
				);
			}

			return array(
				'match'       => true,
				'specificity' => self::SPEC_ENTIRE,
			);
		}

		/* ── Helpers ─────────────────────────────────────────────────────── */

		/**
		 * The current request's primary object ID (0 when none, e.g. archives).
		 *
		 * @return int
		 */
		private static function object_id() {
			$id = (int) get_queried_object_id();
			return $id > 0 ? $id : 0;
		}

		/**
		 * Minimal normalizer used only if the store class is unavailable.
		 *
		 * @param mixed $conditions Conditions.
		 * @return array
		 */
		private static function fallback_normalize( $conditions ) {
			$conditions = is_array( $conditions ) ? $conditions : array();
			$scope      = ( isset( $conditions['scope'] ) && 'specific' === $conditions['scope'] ) ? 'specific' : 'entire';
			$ids        = static function ( $list ) {
				return is_array( $list ) ? array_values( array_unique( array_filter( array_map( 'absint', $list ) ) ) ) : array();
			};
			return array(
				'scope'   => $scope,
				'include' => isset( $conditions['include'] ) ? $ids( $conditions['include'] ) : array(),
				'exclude' => isset( $conditions['exclude'] ) ? $ids( $conditions['exclude'] ) : array(),  // phpcs:ignore WordPressVIPMinimum.Performance.WPQueryParams.PostNotIn_exclude -- Small admin-scoped exclusion list.
				'rules'   => array(),
			);
		}
	}
}
