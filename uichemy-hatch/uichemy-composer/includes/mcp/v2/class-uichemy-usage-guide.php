<?php
/**
 * UiChemy Usage Guide
 *
 * Contributes UiChemy's briefing to the UiChemy MCP v2 discovery document
 * (the `usage_guide` key returned by `uichemy/discover-abilities`), and opts
 * the `uichemy` namespace into that endpoint's ability list.
 *
 * The briefing is the text a user would otherwise have to type into every
 * session: what UiChemy is, which entry point matches which kind of request,
 * and the build order that the individual tool descriptions can only hint at.
 * Delivering it once at discovery is what lets the tool descriptions
 * themselves stay short.
 *
 * A no-op when UiChemy is not active: the filters simply never fire.
 *
 * @link       https://posimyth.com/
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Usage_Guide' ) ) {

	/**
	 * Supplies UiChemy's namespace, usage-guide block and skill index.
	 */
	class UiChemy_Usage_Guide {

		/**
		 * Ability namespace UiChemy registers under.
		 */
		const NAMESPACE_SLUG = 'uichemy-composer';

		/**
		 * Hook onto UiChemy's gateway filters.
		 */
		public static function init() {
			add_filter( 'uichemy_mcp_discover_namespaces', array( __CLASS__, 'add_namespace' ) );
			add_filter( 'uichemy_mcp_discover_exclude', array( __CLASS__, 'add_exclusions' ) );
			add_filter( 'uichemy_mcp_usage_guide', array( __CLASS__, 'add_guide' ) );
			add_filter( 'uichemy_mcp_skills', array( __CLASS__, 'add_skills' ) );
		}

		/**
		 * Opt the `uichemy` namespace into v2 discovery.
		 *
		 * @param array<int,string> $namespaces Existing namespace slugs.
		 * @return array<int,string>
		 */
		public static function add_namespace( $namespaces ) {
			if ( ! is_array( $namespaces ) ) {
				$namespaces = array();
			}

			$namespaces[] = self::NAMESPACE_SLUG;

			return $namespaces;
		}

		/**
		 * Hold the process-document abilities back from the UiChemy surface.
		 *
		 * convert / convert-code / start-site-build are now served as skills through
		 * uichemy-composer/read-skill. They remain abilities so the v1 endpoint and
		 * the Figma relay keep working unchanged, but are excluded from the v2 surface.
		 *
		 * @param array<int,string> $excluded Existing exclusions.
		 * @return array<int,string>
		 */
		public static function add_exclusions( $excluded ) {
			if ( ! is_array( $excluded ) ) {
				$excluded = array();
			}

			return array_merge(
				$excluded,
				array(
					// Process documents, now served as skills through
					// uichemy-composer/read-skill. They remain abilities so the v1
					// endpoint and the Figma relay keep working unchanged.
					'uichemy-composer/convert',
					'uichemy-composer/convert-code',
					'uichemy-composer/start-site-build',
				)
			);
		}

		/**
		 * Append UiChemy's briefing block.
		 *
		 * @param array<int,string> $blocks Existing markdown blocks.
		 * @return array<int,string>
		 */
		public static function add_guide( $blocks ) {
			if ( ! is_array( $blocks ) ) {
				$blocks = array();
			}

			$blocks[] = self::guide();

			return $blocks;
		}

		/**
		 * Advertise UiChemy's skills.
		 *
		 * @param array<int,array> $skills Existing skill records.
		 * @return array<int,array>
		 */
		public static function add_skills( $skills ) {
			if ( ! is_array( $skills ) ) {
				$skills = array();
			}

			if ( ! class_exists( 'UiChemy_Skills' ) ) {
				return $skills;
			}

			return array_merge( $skills, UiChemy_Skills::index() );
		}
		/**
		 * The briefing.
		 *
		 * The Skills section is generated from UiChemy_Skills so the list can
		 * never drift from what read-skill will actually serve.
		 *
		 * @return string Markdown.
		 */
		private static function guide() {
			$guide = <<<'GUIDE'
# UiChemy: build real WordPress pages from figma designs, code, or a brief

UiChemy is powered by the UiChemy plugin, which provides the Composer Elementor widget. The widget holds any HTML, CSS and JS, and gives the user a friendly editing interface for it directly inside the Elementor editor.

One Composer widget is meant to hold one section of a webpage, and the `uichemy/*` abilities are how you create and edit them.
	- **Conversion is meant to take place with per section code only**, because that is the only way the Composer editor can hand editability back to the user.

Apart from widget scoped code:
- UiChemy can also add, update and read HTML placed before the `</head>` and `</body>` of a single page, and site wide code through `uichemy-composer/platform`.
- Images, video and fonts go to the WordPress media library through `uichemy-composer/media`, which returns a URL to reference from your markup.
- On a WooCommerce site, the cart, checkout and account pages are STYLED, never replaced: UiChemy refuses to put a theme-builder template over them because that breaks the purchase flow. Build the page around `uichemy-composer/dynamic` (`action: "add-tag"`) tags instead - `woo-cart`, `woo-checkout`, `woo-my-account`, `woo-order-tracking`, and `woo-notices`, which any custom cart or checkout layout must include or the customer never sees an error.

## Do these two things before you build anything

1. **Read the matching skill**: call `uichemy-composer/read-skill` with `name: "<skill-name>"` - for example `{ "name": "code-to-wordpress" }`. The skill is the build process - section planning, naming, ordering, the media flow, the verification steps. Nothing below teaches you that, and a build that skips it gets the sequence wrong. Match on the user's intent using the Skills list at the end of this briefing.
2. **Call `uichemy-composer/describe-site`.** Its `platform` block decides how you build (`header_footer_system` routes header and footer work; stop if `checks.elementor_active` is false), and the rest is the real content model - post types, taxonomies, and the field `metaKey`s any dynamic binding must use. Never guess a field name.

Then, the moment you are about to write a dynamic binding, call **`uichemy-composer/dynamic` with `action: "list-fields"`**. `describe-site` carries the site's CUSTOM fields; that carries the BUILT-IN tokens - `post.*`, `product.*` (WooCommerce), `user.*`, `term.*`, `image.*`, `site.*`, `request.*`. An unknown token renders EMPTY rather than failing, so a guessed accessor produces a page that looks built and is blank, with nothing in the output to tell you.

When the ask is "what is this site missing", call **`uichemy-composer/theme-builder` with `action: "architecture"`** rather than `list`. `list` reports the templates that exist; `architecture` reports every slot the site HAS, which of them still fall through to the theme, and the exact call that fills each gap.

## How to call an ability - there are TWO levels of nesting

The gateway envelope is always `ability_name` and `parameters`. Those two key names are fixed and are the only ones `execute-ability` accepts - not `ability`, not `action_parameters`.

Most abilities are then **action routed** *inside* `parameters`: they take an `action` plus that action's own `action_parameters`. So a page call is:

```json
{ "ability_name": "uichemy-composer/page",
  "parameters": {
    "action": "append-section",
    "action_parameters": { "post_id": 123, "label": "Features", "html": "…" }
  } }
```

`action` and `action_parameters` live INSIDE `parameters`. They are never envelope keys.

A few abilities are **not** action routed - `uichemy-composer/read-skill` is one. Their parameters go straight into `parameters`, with no `action` and no `action_parameters`:

```json
{ "ability_name": "uichemy-composer/read-skill",
  "parameters": { "name": "code-to-wordpress" } }
```

Discovery lists each ability's actions, or shows none when it is not action routed. `get-ability-info` returns the exact parameter schema for the action you picked - read that instead of guessing parameter names.

Before telling the user a build is finished, run `uichemy-composer/audit`. Each finding names the ability that fixes it.

## Design system

The site design system is one plain CSS block with the id `uichemy-globals`, and it is the source of truth for global tokens. Read it with `uichemy-composer/design-system` (`action: "get"`) before you write section CSS, and reference its `var(--token)` names rather than repeating literal values.

When writing it: custom properties go in `:root {}`, one per line. Group related properties under a plain section comment naming the collection (`/* Colors */`, `/* Spacing */`, `/* Fonts */`); that comment is the only thing that classifies them. Never rename an existing token, because that breaks every `var()` referring to it. Reusable text styles go in `.text-*` classes and components in `.pr-*` classes, after `:root`. No `@layer`, no @-metadata.

Replace the whole block with `action: "set"` (send the complete merged file) or patch it with `action: "patch"` using exact find/replace.
GUIDE;

			return $guide . "\n\n" . self::skills_section();
		}

		/**
		 * Render the Skills section from the registry.
		 *
		 * Public because a sibling plugin may serve its own briefing in place of
		 * this one (see the Pro build) and still needs THIS list: it is generated
		 * from UiChemy_Skills, so a copy frozen into another document would start
		 * advertising skills that `read-skill` no longer serves. Exposing the
		 * renderer keeps one source for the list however many briefings exist.
		 *
		 * @return string Markdown, or '' when no skills are registered.
		 */
		public static function skills_section() {
			if ( ! class_exists( 'UiChemy_Skills' ) ) {
				return '';
			}

			$skills = UiChemy_Skills::index();
			if ( empty( $skills ) ) {
				return '';
			}

			$lines = array(
				'## Skills:',
				'',
				'A skill is the build PROCESS for one kind of job. Read the matching one with `'
					. UiChemy_Skills::ABILITY_NAME . '` BEFORE you plan or call any building ability - not after, and not only when you feel stuck.',
				'',
				'Call it as `' . UiChemy_Skills::ABILITY_NAME . '` with `name: "<skill-name>"`, using a name exactly as listed below. Add `part: "<part-name>"` to load one of a skill\'s extra documents once you have its main body.',
				'',
				'Match on the user\'s intent, without being asked. If more than one looks close, read the one whose description names what the user actually supplied (a design URL, their own code, or only a description). If none matches, say so rather than inventing a process.',
				'',
				'Keep this list, and any skill you have read, in memory for the whole task - including across a context compaction.',
				'',
			);

			foreach ( $skills as $skill ) {
				$lines[] = sprintf(
					'- %s: %s',
					isset( $skill['name'] ) ? (string) $skill['name'] : '',
					isset( $skill['description'] ) ? (string) $skill['description'] : ''
				);
				$lines[] = '';
			}

			return rtrim( implode( "\n", $lines ) );
		}
	}
}
