<?php
/**
 * Free / Pro gating helpers shared by both builds.
 *
 * This file is IDENTICAL in Free and Pro (only the main plugin file differs
 * between them), so every gate reads the same code. `uichemy_is_pro()` itself is
 * defined in each main plugin file — the guarded copy below is only a safety net
 * for the case where this include is reached first.
 *
 * @link       https://posimyth.com
 * @since      5.1.0
 *
 * @package    UiChemy
 * @subpackage UiChemy/includes
 */

// If this file is called directly, abort.
if ( ! defined( 'WPINC' ) ) {
	die;
}

if ( ! function_exists( 'uichemy_custom_code_allowed' ) ) {
	/**
	 * Whether Composer widgets may STORE and RENDER their raw_css / raw_js.
	 *
	 * This governs the code that already lives in a widget, not the editor UI that
	 * authors it — the CSS/JS panel stays a Pro feature either way. It must stay
	 * true for imported designs to work at all: an imported header, footer or page
	 * carries its entire design in raw_css, so gating the render path renders the
	 * imported site unstyled, and gating the save path erases that CSS the first
	 * time anyone presses Update in Elementor.
	 *
	 * Return uichemy_is_pro() from the filter to restrict stored code to Pro:
	 *
	 *     add_filter( 'uichemy/composer/allow_custom_code', 'uichemy_is_pro' );
	 *
	 * @return bool
	 */
	function uichemy_custom_code_allowed() {
		/**
		 * Filter whether stored Composer raw_css / raw_js may be kept and emitted.
		 *
		 * @param bool $allowed Default true (imported designs must render).
		 */
		return (bool) apply_filters( 'uichemy/composer/allow_custom_code', true );
	}
}

if ( ! function_exists( 'uichemy_composer_enabled' ) ) {
	/**
	 * Whether the Composer element should be registered for a given page builder.
	 *
	 * Three independent switches in Settings, one per builder, so a site that only
	 * uses (say) Gutenberg is not offered a Composer widget in the other two — and,
	 * more usefully, does not pay for their editor assets.
	 *
	 * Defaults to ON for every builder: this reads a stored option, and a site that
	 * upgrades into this feature has no value stored yet. Defaulting to off there
	 * would silently unregister a widget that is already sitting in live pages,
	 * which renders them blank.
	 *
	 * @param string $builder elementor | gutenberg | bricks.
	 * @return bool
	 */
	function uichemy_composer_enabled( $builder ) {
		$builder = sanitize_key( (string) $builder );
		if ( ! in_array( $builder, array( 'elementor', 'gutenberg', 'bricks' ), true ) ) {
			return false;
		}

		$opts = get_option( 'uichemy_settings', array() );
		$key  = 'enable_' . $builder;
		$on   = ! is_array( $opts ) || ! array_key_exists( $key, $opts ) ? true : ! empty( $opts[ $key ] );

		/**
		 * Filter whether the Composer registers for one builder.
		 *
		 * @param bool   $on      Whether it is enabled.
		 * @param string $builder Builder slug.
		 */
		return (bool) apply_filters( 'uichemy/builder/enabled', $on, $builder );
	}
}

/**
 * Safety net only — both uichemy.php and uichemy-pro.php define this before any
 * include runs. Kept guarded so it can never redeclare.
 */
if ( ! function_exists( 'uichemy_is_pro' ) ) {
	function uichemy_is_pro() {
		return defined( 'UICHEMY_PRO' ) && UICHEMY_PRO;
	}
}

if ( ! function_exists( 'uichemy_upgrade_url' ) ) {
	/**
	 * The single upgrade/pricing URL behind every "Upgrade to Pro" CTA — admin
	 * dashboard, composer upsell modal and locked feature cards alike. Keeping it
	 * in one function means the link is changed once, and `$source` lets us tell
	 * which CTA converted without hard-coding query strings at each call site.
	 *
	 * @param string $source Optional CTA identifier (e.g. 'theme-builder', 'role-manager').
	 * @return string
	 */
	function uichemy_upgrade_url( $source = '' ) {
		$url = 'https://uichemy.com/pricing/';

		if ( '' !== (string) $source ) {
			$url = add_query_arg( 'utm_source', sanitize_key( $source ), $url );
		}

		/**
		 * Filter the UiChemy upgrade URL.
		 *
		 * @param string $url    The pricing URL (with any source arg already applied).
		 * @param string $source The CTA identifier passed by the caller.
		 */
		return (string) apply_filters( 'uichemy_upgrade_url', $url, (string) $source );
	}
}

if ( ! function_exists( 'uichemy_white_label_settings' ) ) {
	/**
	 * The effective White Label settings for this build.
	 *
	 * White Label is a Pro feature, so in Free this returns an EMPTY array — every
	 * consumer already treats a missing `enabled` flag as "white label off", so
	 * branding falls back to UiChemy's own name, icon and widget labels.
	 *
	 * This must be the ONLY way white-label settings are read. Hiding the settings
	 * screen is not enough on its own: a site that configured White Label under Pro
	 * and then downgraded would otherwise keep its custom branding — including
	 * "hide from other admins" — with no UI left to turn it off. The stored option
	 * is never deleted, so reactivating Pro restores the exact configuration.
	 *
	 * @return array
	 */
	function uichemy_white_label_settings() {
		if ( ! uichemy_is_pro() ) {
			return array();
		}

		$wl = get_option( 'uichemy_white_label', array() );

		return is_array( $wl ) ? $wl : array();
	}
}

if ( ! function_exists( 'uichemy_editor_pro_features' ) ) {
	/**
	 * Editor (composer) features that require Pro.
	 *
	 * `ai_chat` covers the whole Chat tab — the conversation UI, the Agent Bridge
	 * connect flow, model selection, history and the Draw→Ask-AI hand-off — plus
	 * every REST route behind them (`/agent/turn`, `/agent/models`, `/chat/*`).
	 * It is also a `UiChemy_Roles::FEATURES` slug, so two gates stack there: the
	 * Role Manager decides whether a role may use it, this list decides whether the
	 * build ships it, and it must clear both.
	 *
	 * `loop_pagination` covers the loop's Numbered page links and Load more button
	 * (`loop_pagination()` / `loop_load_more()` in Uich_Dynamic_Functions). It is NOT
	 * a role slug — entries here don't have to be. `UiChemy_Rest_Permissions::
	 * check_feature()` only ever receives role slugs, so a non-role entry simply
	 * never reaches it.
	 *
	 * @return string[]
	 */
	function uichemy_editor_pro_features() {
		/**
		 * Filter the editor features that require Pro.
		 *
		 * @param string[] $features Feature slugs.
		 */
		return (array) apply_filters( 'uichemy/editor/pro_features', array( 'ai_chat', 'loop_pagination', 'loop_custom_query' ) );
	}
}

if ( ! function_exists( 'uichemy_editor_feature_allowed' ) ) {
	/**
	 * Whether this build may run the given editor feature at all.
	 *
	 * Pro runs everything. In Free anything listed by uichemy_editor_pro_features()
	 * is refused — and refused at the REST layer too (see
	 * UiChemy_Rest_Permissions::check_feature()), not just hidden in the UI, so the
	 * lock cannot be bypassed by calling the endpoints directly.
	 *
	 * @param string $feature Feature slug.
	 * @return bool
	 */
	function uichemy_editor_feature_allowed( $feature ) {
		if ( uichemy_is_pro() ) {
			return true;
		}

		return ! in_array( (string) $feature, uichemy_editor_pro_features(), true );
	}
}

if ( ! function_exists( 'uichemy_dynamic_free_fields' ) ) {
	/**
	 * The ONLY dynamic-data fields Free may resolve, keyed by provider kind.
	 *
	 * Free ships four dynamic tags: Post Title, Post Image, Post Content and Post
	 * URL. Everything else — the rest of Post, ALL Term/Category fields, Site, User,
	 * Archive, Request, WooCommerce, ACF, JetEngine and the raw-Twig tags — is Pro.
	 *
	 * Notes on the entries that are not literally one of the four:
	 * - `url` / `permalink` are aliases of `link`, and `featured_image` of
	 *   `thumbnail` (see Uich_Post_Provider::uich_get) — the same tag by another name.
	 * - the whole `image` chain is allowed because it IS Post Image: an <img> needs
	 *   src/alt/width/height to render at all.
	 * - `term` is present but EMPTY, and `post.categories` is absent: Category Title
	 *   became Pro on 2026-07-31, so neither the category hop nor any term field
	 *   resolves in Free. The empty array is kept (rather than the key removed) so
	 *   the tiering reads explicitly instead of relying on the unknown-kind refusal.
	 * - `post.id` is PLUMBING, not a tag. The Loop tab's "Exclude current post"
	 *   option compiles to `post.id` (class-uichemy-composer-manager.php,
	 *   composer-construct-tab.jsx), and loops are a Free feature — blocking it
	 *   would break that option. The pickable "Post ID" tag stays Pro: it is hidden
	 *   from the picker and its Elementor tag class is not registered in Free.
	 *
	 * WooCommerce products need no entry: Uich_Product_Provider extends
	 * Uich_Post_Provider and reports kind `post`, so a product's title/content/
	 * image still resolve while every commerce field (price, sku, stock, …) falls
	 * outside this list and is refused.
	 *
	 * @return array<string,string[]> Provider kind => allowed field names.
	 */
	function uichemy_dynamic_free_fields() {
		$fields = array(
			'post'    => array( '__toString', 'title', 'content', 'link', 'url', 'permalink', 'thumbnail', 'featured_image', 'id', 'ID' ),
			'term'    => array(),
			'image'   => array( '__toString', 'src', 'url', 'srcset', 'img_sizes', 'sizes', 'alt', 'width', 'height', 'caption', 'id', 'ID' ),
			'user'    => array(),
			'site'    => array(),
			'request' => array(),
		);

		/**
		 * Filter the dynamic fields Free may resolve.
		 *
		 * @param array<string,string[]> $fields Provider kind => allowed field names.
		 */
		return (array) apply_filters( 'uichemy/dynamic/free_fields', $fields );
	}
}

if ( ! function_exists( 'uichemy_free_loop_sources' ) ) {
	/**
	 * Loop sources Free may query. Free loops over POSTS only.
	 *
	 * Pro adds Products (WooCommerce), Terms / Categories, Users and External API
	 * (JSON) — the `get_*` Twig functions behind the Loop panel's "Show" select.
	 *
	 * @return string[] Twig function names.
	 */
	function uichemy_free_loop_sources() {
		/**
		 * Filter the loop sources available in Free.
		 *
		 * @param string[] $sources Twig function names (e.g. get_posts).
		 */
		return (array) apply_filters( 'uichemy/dynamic/free_loop_sources', array( 'get_posts' ) );
	}
}

if ( ! function_exists( 'uichemy_loop_source_allowed' ) ) {
	/**
	 * Whether this build may run the given loop source.
	 *
	 * In Free a Pro source returns an EMPTY collection, so the loop falls through to
	 * its `{% else %}` empty state instead of silently rendering Pro data — the same
	 * rule the field allowlist follows, and it applies to imported templates and to
	 * sites that downgraded from Pro.
	 *
	 * @param string $source Twig function name.
	 * @return bool
	 */
	function uichemy_loop_source_allowed( $source ) {
		if ( uichemy_is_pro() ) {
			return true;
		}

		return in_array( (string) $source, uichemy_free_loop_sources(), true );
	}
}

if ( ! function_exists( 'uichemy_dynamic_field_allowed' ) ) {
	/**
	 * Whether this build may resolve `<kind>.<field>`.
	 *
	 * Enforced at the Twig sandbox boundary (Uich_Provider::uich_read), so it covers
	 * every chained hop — `post.author.name`, `product.price`,
	 * `post.thumbnail.src('large')` — no matter how the template was authored.
	 * Hiding fields in the picker is the courtesy; this is the rule.
	 *
	 * @param string $kind  Provider kind: post|term|image|user|site|request.
	 * @param string $field Field name being read.
	 * @return bool
	 */
	function uichemy_dynamic_field_allowed( $kind, $field ) {
		if ( uichemy_is_pro() ) {
			return true;
		}

		$free = uichemy_dynamic_free_fields();
		$kind = (string) $kind;

		// An unknown provider kind is refused rather than allowed: a new provider
		// must be tiered deliberately, not leak into Free by being forgotten.
		if ( ! isset( $free[ $kind ] ) || ! is_array( $free[ $kind ] ) ) {
			return false;
		}

		return in_array( (string) $field, $free[ $kind ], true );
	}
}

if ( ! function_exists( 'uichemy_pro_feature_map' ) ) {
	/**
	 * Which dashboard surfaces are Pro-only. Consumed by the admin menu (to build
	 * the localized payload the React app gates on) so PHP stays the single source
	 * of truth — the JS never hard-codes the list.
	 *
	 * Only surfaces that exist in BOTH builds belong here — the map answers "is
	 * this locked behind Pro", and a screen Free does not ship at all has no
	 * meaningful answer. The License screen is one of those: it is registered only
	 * in Pro and its nav item is gated on isPro(), not on this map. It used to
	 * carry a `license => false` entry, which read as "License is not a Pro
	 * feature" in Free — the opposite of the truth, for a key nothing read.
	 *
	 * @return array<string,bool> Keyed by feature slug; true = requires Pro.
	 */
	function uichemy_pro_feature_map() {
		$is_pro = uichemy_is_pro();

		return array(
			'role_manager' => ! $is_pro,
			'white_label'  => ! $is_pro,
		);
	}
}
