<?php
/**
 * UiChemy Skills
 *
 * A skill is a process document: the multi-step playbook an AI has to follow
 * to do a job properly. UiChemy has always had these, but they were only
 * reachable by calling one of three
 * tools that did nothing except read a hardcoded file off disk. That made the
 * process documents look like tools in every catalogue, and left content such
 * as the scope-decision rules unreachable because no tool pointed at them.
 *
 * This registry addresses skills by name instead. A skill is declared here as a
 * plain array (name, description, keywords, and the markdown files that make up
 * its body) and is read through the `uichemy-composer/read-skill` ability.
 *
 * Long form skills declare additional parts. `read-skill` returns the main body
 * by default and one named part on request, so a large pipeline can be pulled in
 * stages rather than in one 38 KB response. Whichever is read, the response names
 * the parts still outstanding, and the discovery index names them too, so the
 * model knows before and after reading that the main body is not the whole skill.
 *
 * That navigation metadata travels beside the markdown, never inside it, so an
 * author edits exactly one copy of every document.
 *
 * The v2 documents live in includes/mcp/skills/, named for the skill they serve.
 * includes/mcp/pipeline/ is the SEPARATE, frozen v1 copy: the legacy endpoint
 * concatenates those files by phase number, which is why they carry numeric
 * prefixes, and it must keep receiving v1 tool names. The two were one shared
 * set until the surfaces diverged far enough that every v2 improvement had to be
 * phrased in v1 vocabulary to avoid breaking the older reader. Edit the copy for
 * the surface you mean; nothing merges them back.
 *
 * Nothing is rewritten on the way out any more. These documents are authored in
 * v2 vocabulary - ability names, action names, and the `platform.`-nested shape
 * that describe-site actually returns - and are served verbatim. The old
 * retired_map()/field translation pass was removed once the v1 copy moved to
 * includes/mcp/pipeline/, because a translator that fires on one surface and not
 * the other is a second thing to keep in sync with the first.
 *
 * The definitions stay a PHP array on purpose. Discovery has to list every
 * skill on every call, and an array costs nothing to read, whereas parsing
 * front matter out of a directory scan costs a file read per skill. Bodies live
 * in markdown files and are only touched when a skill is actually read. When
 * user-authored skills arrive later, they can be merged in through the
 * `uichemy_skills` filter in exactly this shape.
 *
 * @link       https://posimyth.com/
 * @since      5.1.0
 *
 * @package    UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Skills' ) ) {

	/**
	 * Declares UiChemy's skills and serves their markdown.
	 */
	class UiChemy_Skills {

		/**
		 * Ability name used to read a skill.
		 */
		const ABILITY_NAME = 'uichemy-composer/read-skill';

		/**
		 * Cached, filtered skill definitions.
		 *
		 * @var array<string,array>|null
		 */
		private static $cache = null;

		/**
		 * Register the reader ability.
		 */
		public static function init() {
			if ( ! function_exists( 'wp_register_ability' ) ) {
				return;
			}

			// Priority 10 so UiChemy_Abilities (priority 5) has registered the
			// `uichemy` category first.
			add_action( 'wp_abilities_api_init', array( __CLASS__, 'register_ability' ), 10 );
		}

		// ============================================================
		// DEFINITIONS
		// ============================================================

		/**
		 * The skills UiChemy ships.
		 *
		 * `files` is the main body, concatenated in order. `additional_parts` are
		 * named follow-up documents the model can request once it has the main body.
		 * Paths are relative to includes/mcp/.
		 *
		 * @return array<string,array>
		 */
		private static function definitions() {
			return array(
				'figma-to-wordpress'      => array(
					'description' => 'Convert a Figma design into WordPress pages built from Composer widgets, section by section. Read this when the user gives a Figma or design URL and wants it turned into a site, page or section.',
					'keywords'    => array( 'figma', 'design', 'mockup', 'convert', 'design to code', 'redesign' ),
					'files'       => array(
						'skills/figma-to-wordpress/overview.md',
						'skills/figma-to-wordpress/structure.md',
						'skills/figma-to-wordpress/tokens.md',
					),
					'additional_parts' => array(
						'globals-sync'    => array(
							'description' => 'Sync and look up the site design tokens before generating any section.',
							'files'       => array( 'skills/figma-to-wordpress/globals-sync.md' ),
						),
						'generate'        => array(
							'description' => 'Generate section code and upload it, including the media flow.',
							'files'       => array(
								'skills/figma-to-wordpress/generate.md',
								'skills/figma-to-wordpress/upload.md',
							),
						),
						'scope-decision'  => array(
							'description' => 'Decide whether a link, style, script or meta tag belongs at site level or page level. Read before emitting any of those tags.',
							'files'       => array( 'skills/shared/scope-decision.md' ),
						),
						'appendix'        => array(
							'description' => 'Reference appendix for the conversion pipeline.',
							'files'       => array( 'skills/figma-to-wordpress/appendix.md' ),
						),
					),
				),
				'code-to-wordpress'       => array(
					'description' => 'Turn existing front-end code (pasted HTML/CSS/JS, a file, or a local project folder) into a WordPress page, reproducing it faithfully rather than redesigning it. Read this when the user supplies code and no Figma URL.',
					'keywords'    => array( 'html', 'css', 'code', 'import', 'static site', 'convert code', 'project folder' ),
					'files'       => array( 'skills/code-to-wordpress.md' ),
					'additional_parts' => array(
						'scope-decision' => array(
							'description' => 'Decide whether a link, style, script or meta tag belongs at site level or page level.',
							'files'       => array( 'skills/shared/scope-decision.md' ),
						),
					),
				),
				'brief-to-wordpress'      => array(
					'description' => 'Invent and build a complete site or landing page from a one-line brief, with no design and no code supplied. Read this when the user asks for a website, homepage, landing page or section and gives nothing but a description.',
					'keywords'    => array( 'brief', 'landing page', 'website', 'homepage', 'build me', 'design a', 'from scratch' ),
					'files'       => array( 'skills/brief-to-wordpress.md' ),
					'additional_parts' => array(
						'scope-decision' => array(
							'description' => 'Decide whether a link, style, script or meta tag belongs at site level or page level.',
							'files'       => array( 'skills/shared/scope-decision.md' ),
						),
					),
				),
				'dynamic-loops-and-forms' => array(
					// NOT YET WRITTEN, and said so here: advertising a process that
					// turns out to be a stub costs a read and teaches nothing. The
					// uichemy-composer/dynamic and uichemy-composer/forms abilities carry the working
					// mechanics in their own schemas meanwhile.
					'description' => 'NOT YET WRITTEN - skip it. Dynamic loops and forms have no process document yet; use the uichemy-composer/dynamic and uichemy-composer/forms abilities directly, reading their action schemas with get-ability-info.',
					'keywords'    => array( 'loop', 'query', 'cpt', 'custom post type', 'posts', 'form', 'submission', 'dynamic' ),
					'files'       => array( 'skills/dynamic-loops-and-forms.md' ),
					'additional_parts' => array(),
				),
			);
		}

		/**
		 * All skills, after the contribution filter.
		 *
		 * @return array<string,array> Keyed by skill name.
		 */
		public static function all() {
			if ( null !== self::$cache ) {
				return self::$cache;
			}

			/**
			 * Filters the registered UiChemy skills.
			 *
			 * Keys are skill names; each value takes the same shape as the
			 * built-in definitions (description, keywords, files, additional_parts).
			 *
			 * @since 5.1.0
			 *
			 * @param array<string,array> $skills Skill definitions.
			 */
			$skills = apply_filters( 'uichemy_skills', self::definitions() );

			self::$cache = is_array( $skills ) ? $skills : array();

			return self::$cache;
		}

		/**
		 * The skill index: what discovery advertises.
		 *
		 * @return array<int,array{name:string,keywords:array,description:string}>
		 */
		public static function index() {
			$index = array();

			foreach ( self::all() as $name => $skill ) {
				$record = array(
					'name'        => (string) $name,
					'description' => isset( $skill['description'] ) ? (string) $skill['description'] : '',
					'keywords'    => isset( $skill['keywords'] ) && is_array( $skill['keywords'] )
						? array_values( $skill['keywords'] )
						: array(),
				);

				// Names only. Their descriptions ride in the body header, where
				// they are actionable, but the names have to be visible here:
				// otherwise a staged skill looks self-contained at discovery and
				// the model can finish reading the main body believing it has the
				// whole process.
				$additional = isset( $skill['additional_parts'] ) && is_array( $skill['additional_parts'] )
					? $skill['additional_parts']
					: array();
				if ( ! empty( $additional ) ) {
					$record['additional_parts'] = array_keys( $additional );
				}

				$index[] = $record;
			}

			return $index;
		}

		// ============================================================
		// ABILITY
		// ============================================================

		/**
		 * Register `uichemy-composer/read-skill`.
		 */
		public static function register_ability() {
			if ( function_exists( 'wp_has_ability' ) && wp_has_ability( self::ABILITY_NAME ) ) {
				return;
			}

			wp_register_ability(
				self::ABILITY_NAME,
				array(
					'label'               => 'UiChemy Builder: Read Skill',
					'description'         => 'Load a UiChemy skill: the step-by-step process to follow for a job. Call it as name: "<skill-name>". Read the skill that matches the user request before starting work. Skill names and what each covers are listed in the instructions.',
					'category'            => 'uichemy-composer',
					'input_schema'        => array(
						'type'       => 'object',
						'properties' => array(
							'name'       => array(
								'type'        => 'string',
								'description' => 'Skill name, e.g. "figma-to-wordpress". Listed in the discovery instructions.',
							),
							'skill_name' => array(
								'type'        => 'string',
								'description' => 'Accepted alias for "name". Prefer "name".',
							),
							'part'       => array(
								'type'        => 'string',
								'description' => 'Optional. Load one of the skill\'s additional parts instead of its main body. The names are listed in the skills index and at the top of the main body.',
							),
						),
						// `name` is deliberately NOT in `required`: the briefing tells the
						// model to read a skill before anything else, so this is often its
						// first call and "skill_name" is the natural guess. Schema-level
						// validation would reject that guess before the handler could
						// accept it, costing a round trip to learn one parameter name.
						// The handler errors clearly when neither key is supplied.
						'required'   => array(),
					),
					'execute_callback'    => array( __CLASS__, 'execute' ),
					'permission_callback' => array( 'UiChemy_Abilities', 'permission_check' ),
					'meta'                => array(
						'show_in_rest' => true,
						'mcp'          => array( 'public' => true ),
						'annotations'  => array(
							'title'       => 'UiChemy Builder: Read Skill',
							'readonly'    => true,
							'destructive' => false,
							'idempotent'  => true,
						),
					),
				)
			);
		}

		/**
		 * Read a skill's main body, or one of its additional parts.
		 *
		 * @param array $arguments Ability input.
		 * @return array|WP_Error Markdown resource, or an error.
		 */
		public static function execute( $arguments ) {
			$arguments = is_array( $arguments ) ? $arguments : array();

			// Unwrap an action_parameters envelope. This ability is not action routed,
			// but almost every sibling is, and the briefing that sends a model here
			// teaches that shape — so arriving wrapped is the predictable mistake, not
			// a malformed call. Cheaper to accept than to spend a round trip refusing.
			if ( isset( $arguments['action_parameters'] ) && is_array( $arguments['action_parameters'] ) ) {
				$arguments = array_merge( $arguments, $arguments['action_parameters'] );
				unset( $arguments['action_parameters'] );
			}

			// "skill_name" is accepted alongside "name" — see the schema comment.
			$name = '';
			foreach ( array( 'name', 'skill_name' ) as $key ) {
				if ( isset( $arguments[ $key ] ) && '' !== trim( (string) $arguments[ $key ] ) ) {
					$name = trim( (string) $arguments[ $key ] );
					break;
				}
			}
			$part = isset( $arguments['part'] ) ? trim( (string) $arguments['part'] ) : '';

			$skills = self::all();

			if ( '' === $name ) {
				return new WP_Error(
					'uichemy_missing_skill_name',
					sprintf(
						'Which skill? Pass name: "<skill-name>". Available skills: %s.',
						implode( ', ', array_keys( $skills ) )
					)
				);
			}

			if ( ! isset( $skills[ $name ] ) ) {
				return new WP_Error(
					'uichemy_unknown_skill',
					sprintf(
						'Unknown skill "%s". Available skills: %s.',
						$name,
						implode( ', ', array_keys( $skills ) )
					)
				);
			}

			$skill = $skills[ $name ];
			$parts = isset( $skill['additional_parts'] ) && is_array( $skill['additional_parts'] )
				? $skill['additional_parts']
				: array();

			if ( '' !== $part ) {
				if ( ! isset( $parts[ $part ] ) ) {
					return new WP_Error(
						'uichemy_unknown_skill_part',
						sprintf(
							'Skill "%s" has no additional part "%s". Available: %s.',
							$name,
							$part,
							$parts ? implode( ', ', array_keys( $parts ) ) : 'none'
						)
					);
				}

				$files = isset( $parts[ $part ]['files'] ) ? $parts[ $part ]['files'] : array();
				$uri   = 'uichemy://skill/' . $name . '/' . $part;
			} else {
				$files = isset( $skill['files'] ) ? $skill['files'] : array();
				$uri   = 'uichemy://skill/' . $name;
			}

			$body = self::read_files( $files );
			if ( is_wp_error( $body ) ) {
				return $body;
			}

			// Nothing but the document, as an embedded text resource. Navigation
			// metadata does not ride along; `additional_parts` lives in the
			// discovery index.
			return array(
				'type'     => 'resource',
				'uri'      => $uri,
				'mimeType' => 'text/markdown',
				'text'     => $body,
			);
		}

		/**
		 * Concatenate a skill's markdown files.
		 *
		 * @param array<int,string> $files Paths relative to includes/mcp/.
		 * @return string|WP_Error
		 */
		private static function read_files( $files ) {
			if ( ! is_array( $files ) || empty( $files ) ) {
				return '';
			}

			// The documents live in includes/mcp/, one level above this v2 folder, and
			// are shared with v1 — so anchor on the plugin path rather than __FILE__.
			$base = UICHEMY_PATH . 'includes/mcp/';
			$parts = array();

			foreach ( $files as $relative ) {
				$path = $base . ltrim( (string) $relative, '/' );

				// Keep reads inside the plugin's mcp directory.
				$real = realpath( $path );
				if ( false === $real || 0 !== strpos( $real, realpath( $base ) ) ) {
					continue;
				}

				if ( ! is_readable( $real ) ) {
					continue;
				}

				$chunk = file_get_contents( $real ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Local plugin asset.
				if ( is_string( $chunk ) && '' !== trim( $chunk ) ) {
					$parts[] = $chunk;
				}
			}

			if ( empty( $parts ) ) {
				return new WP_Error( 'uichemy_empty_skill', 'This skill has no readable content yet.' );
			}

			return implode( "\n\n", $parts );
		}


	}
}
