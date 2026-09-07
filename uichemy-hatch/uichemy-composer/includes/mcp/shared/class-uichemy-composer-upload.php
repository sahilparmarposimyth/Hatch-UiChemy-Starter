<?php
/**
 * Multi-file media upload slots for the Composer pipeline.
 *
 * Why: `media_sideload_image` (used by `add_uichemy_composer_section` /
 * `create_uichemy_composer_page` / `set_site_branding`) needs a real
 * public URL inside `<img src="…">` / `<video src="…">`. Figma works
 * because Figma serves public CDN URLs. AI-generated images, video
 * clips, screenshots and other local files have no such URL, so the
 * sideload step silently fails or fabricates a broken `src`.
 *
 * One slot accepts many files. The MCP surfaces call `issue_slot()` and
 * hand the caller a URL + header + curl examples; the caller then loops
 * over every asset for the build in a single shell command, PUTting each
 * one to `/wp-json/uichemy/v1/composer-upload`. A 43-image page build is
 * two round trips (issue the slot, run the loop) instead of two per file.
 *
 * Per-file metadata rides along on the query string, so `alt` is stored
 * during the upload and needs no follow-up call. The file type is
 * detected from the bytes rather than declared up front, which is both
 * simpler for the caller and stricter than trusting a claim made minutes
 * earlier.
 *
 * Supported media: raster images (png/jpeg/webp/gif), SVG (gated on the
 * `unfiltered_html` capability and sanitised on the way in), video
 * (mp4/m4v, webm, ogg, mov), and web fonts (woff2/woff/ttf/otf). Note that
 * mp4/webm/ogg play natively in an HTML5 `<video>` element everywhere; mov
 * (QuickTime) uploads fine but only plays reliably in Safari. Font files are
 * referenced from CSS via `@font-face { src: url(...) }`; WordPress blocks
 * font MIME types by default, so the sideload temporarily allows them.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'UiChemy_Composer_Upload' ) ) {

	final class UiChemy_Composer_Upload {

		const REST_NAMESPACE        = 'uichemy/v1';
		const REST_ROUTE            = 'composer-upload';
		const SLOT_TRANSIENT_PREFIX = 'uich_upl_';

		const DEFAULT_TTL_MINUTES = 15;
		const MIN_TTL_MINUTES     = 1;
		const MAX_TTL_MINUTES     = 30;

		// Max files a single slot may upload before it must be re-issued. Bounds a
		// leaked token's reach (the slot stays open for its whole TTL); well above
		// any real editor batch. Filterable via `uich_composer_upload_max_files`.
		const MAX_SLOT_FILES = 500;

		/**
		 * Per-file size ceilings. There is no slot-wide budget: the number of
		 * files is bounded by the TTL rather than by a counter, which keeps the
		 * slot record immutable and removes any read-modify-write race between
		 * uploads running in parallel.
		 */
		const MAX_FILE_BYTES  = 26214400;  // 25 MB for images, SVG and fonts.
		const MAX_VIDEO_BYTES = 104857600; // 100 MB for video.

		/**
		 * Longest filename stem kept before the extension. Filesystems cap a
		 * single name at 255 bytes and wp_tempnam wraps it further.
		 */
		const MAX_FILENAME_STEM = 100;

		/**
		 * Placeholder path claimed by reserve_unique_filename(), so a failed
		 * sideload can remove it again.
		 *
		 * @var string|null
		 */
		private static $reserved_path = null;

		/**
		 * Allowed MIME → extension map. Anything outside this is rejected.
		 *
		 * Raster images are inert. SVG is XML that can carry script, so it is
		 * additionally gated on `unfiltered_html` + sanitised at upload time.
		 * Video/audio are inert media WordPress allows by default; they let the
		 * import pipeline re-home a local `.webm`/`.mp4` demo that has no public
		 * URL (the biggest source of "video became a placeholder" on HTML import).
		 */
		private static function allowed_mimes() {
			return array(
				'image/png'       => 'png',
				'image/jpeg'      => 'jpg',
				'image/webp'      => 'webp',
				'image/gif'       => 'gif',
				'image/svg+xml'   => 'svg',
				'video/mp4'       => 'mp4',
				'video/webm'      => 'webm',
				'video/ogg'       => 'ogv',
				'video/quicktime' => 'mov',
				'font/woff2'      => 'woff2',
				'font/woff'       => 'woff',
				'font/ttf'        => 'ttf',
				'font/otf'        => 'otf',
			);
		}

		/**
		 * Whether a MIME type is one of the accepted video formats. Video
		 * gets a larger size ceiling and a `<video src>` embed hint.
		 *
		 * @param string $mime MIME type.
		 * @return bool
		 */
		private static function is_video_mime( $mime ) {
			return 0 === strpos( (string) $mime, 'video/' );
		}

		/**
		 * Whether a MIME type is one of the accepted web-font formats. Fonts
		 * are referenced from CSS `@font-face`, and WordPress blocks their MIME
		 * types by default, so the sideload allows them explicitly. Both the
		 * canonical `font/*` types and the legacy `application/*` aliases some
		 * finfo builds report count as fonts here.
		 *
		 * @param string $mime MIME type.
		 * @return bool
		 */
		private static function is_font_mime( $mime ) {
			$mime = strtolower( (string) $mime );
			if ( 0 === strpos( $mime, 'font/' ) ) {
				return true;
			}
			return in_array(
				$mime,
				array(
					'application/font-woff',
					'application/font-woff2',
					'application/x-font-woff',
					'application/x-font-ttf',
					'application/x-font-truetype',
					'application/x-font-opentype',
					'application/font-sfnt',
					'application/vnd.ms-opentype',
				),
				true
			);
		}

		/**
		 * Size ceiling for one file of this type.
		 *
		 * @param string $mime Resolved MIME type.
		 * @return int
		 */
		private static function max_bytes_for_mime( $mime ) {
			return self::is_video_mime( $mime ) ? self::MAX_VIDEO_BYTES : self::MAX_FILE_BYTES;
		}

		/**
		 * upload_mimes filter: allow web-font extensions during a font sideload.
		 * Registered only for the duration of a font upload, then removed.
		 *
		 * @param array $mimes Ext => mime map.
		 * @return array
		 */
		public static function allow_font_upload_mimes( $mimes ) {
			$mimes['woff2'] = 'font/woff2';
			$mimes['woff']  = 'font/woff';
			$mimes['ttf']   = 'font/ttf';
			$mimes['otf']   = 'font/otf';
			return $mimes;
		}

		/**
		 * upload_mimes filter: allow SVG for the duration of one sideload. The
		 * capability gate and the sanitiser have already run by this point; this
		 * only stops WordPress rejecting the extension outright on sites that do
		 * not permit SVG globally.
		 *
		 * @param array $mimes Ext => mime map.
		 * @return array
		 */
		public static function allow_svg_upload_mimes( $mimes ) {
			$mimes['svg'] = 'image/svg+xml';
			return $mimes;
		}

		/**
		 * wp_check_filetype_and_ext filter: assert the correct ext/type for a
		 * font whose real MIME sniffs inconsistently (finfo often reports fonts
		 * as octet-stream, application/font-sfnt, or nothing). Registered only
		 * for the duration of a font sideload, then removed.
		 *
		 * @param array  $data     { ext, type, proper_filename }.
		 * @param string $file     Full path to the file.
		 * @param string $filename Original filename.
		 * @return array
		 */
		public static function fix_font_filetype_check( $data, $file, $filename ) {
			$ext = strtolower( (string) pathinfo( (string) $filename, PATHINFO_EXTENSION ) );
			$map = array(
				'woff2' => 'font/woff2',
				'woff'  => 'font/woff',
				'ttf'   => 'font/ttf',
				'otf'   => 'font/otf',
			);
			if ( isset( $map[ $ext ] ) ) {
				$data['ext']  = $ext;
				$data['type'] = $map[ $ext ];
			}
			return $data;
		}

		/**
		 * wp_check_filetype_and_ext filter: same idea for SVG, whose type WP
		 * reports as false on sites that do not allow the extension globally.
		 *
		 * @param array  $data     { ext, type, proper_filename }.
		 * @param string $file     Full path to the file.
		 * @param string $filename Original filename.
		 * @return array
		 */
		public static function fix_svg_filetype_check( $data, $file, $filename ) {
			if ( 'svg' === strtolower( (string) pathinfo( (string) $filename, PATHINFO_EXTENSION ) ) ) {
				$data['ext']  = 'svg';
				$data['type'] = 'image/svg+xml';
			}
			return $data;
		}

		/**
		 * Strip the common script/XSS vectors out of an SVG before it is stored.
		 *
		 * SVG is served as an active document, so an uploaded file can execute
		 * script when opened directly. This removes <script>/<foreignObject>
		 * blocks, inline on* event handlers, javascript:/data: URLs in
		 * href/xlink:href/src, and DOCTYPE/ENTITY declarations (XXE / entity
		 * expansion). It is a defence-in-depth pass on top of the
		 * `unfiltered_html` capability gate on the caller.
		 *
		 * @param string $svg Raw SVG bytes.
		 * @return string Sanitised SVG bytes.
		 */
		public static function sanitize_svg_bytes( $svg ) {
			$svg = (string) $svg;
			// <script> ... </script> and self-closing/empty script tags.
			$svg = preg_replace( '#<script\b[^>]*>.*?</script>#is', '', $svg );
			$svg = preg_replace( '#<script\b[^>]*/?>#i', '', $svg );
			// <foreignObject> can embed arbitrary HTML/JS.
			$svg = preg_replace( '#<foreignObject\b[^>]*>.*?</foreignObject>#is', '', $svg );
			// Inline event handlers (onload, onclick, onmouseover, ...).
			$svg = preg_replace( '#\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)#i', '', $svg );
			// Scheme checks run on the DECODED value, because the browser decodes
			// before it parses the URL. Chasing each encoding with its own pattern
			// loses: &#106;avascript:, java&#9;script: and " javascript:" all have
			// to be caught, and only decoding sees them as the same string. The
			// value is inspected, not rewritten, so nothing can inject markup.
			$svg = preg_replace_callback(
				'#(href|xlink:href|src)\s*=\s*(["\'])(.*?)\2#is',
				array( __CLASS__, 'neutralize_svg_url_attribute' ),
				$svg
			);
			// Unquoted attribute values.
			$svg = preg_replace( '#(href|xlink:href|src)\s*=\s*(?:javascript|vbscript|data)\s*:[^\s>]*#i', '$1="#"', $svg );
			// Backstop: neutralise the scheme wherever it still appears, whatever
			// attribute or quoting style carries it.
			$svg = preg_replace( '#(?:java|vb)\s*script\s*:#i', '', $svg );
			// DOCTYPE, including an internal subset. Matching up to the first ">"
			// stops inside the subset and leaves a stray "]>" behind, which breaks
			// the document instead of cleaning it.
			$svg = preg_replace( '#<!DOCTYPE\b[^\[>]*(?:\[.*?\])?\s*>#is', '', $svg );
			$svg = preg_replace( '#<!ENTITY[^>]*>#is', '', $svg );
			// Any remaining custom entity reference is now undefined, and an
			// undefined reference is a hard XML parse error. Only the five
			// predefined names and numeric references are safe to keep.
			$svg = preg_replace( '#&(?!(?:amp|lt|gt|quot|apos);|\#)[A-Za-z_][A-Za-z0-9_.:-]*;#', '', $svg );
			return $svg;
		}

		/**
		 * Replace one SVG URL attribute with "#" when its decoded value carries an
		 * executable or document-bearing scheme.
		 *
		 * Inert raster data URIs are left alone: an embedded PNG or JPEG cannot
		 * execute, and dropping them would silently break legitimate artwork.
		 * data:image/svg+xml is NOT inert, since a nested SVG can carry script.
		 *
		 * @param array $matches [ full, attribute, quote, value ].
		 * @return string
		 */
		public static function neutralize_svg_url_attribute( $matches ) {
			$decoded = html_entity_decode( (string) $matches[3], ENT_QUOTES | ENT_HTML5, 'UTF-8' );
			// html_entity_decode leaves the numeric references HTML5 calls
			// disallowed, CR (&#13;) among them, so a reference can still sit
			// between the scheme and the colon after decoding. Drop every
			// reference to a control or space code point before testing.
			$decoded = preg_replace( '#&\#x0*(?:[0-9a-f]|1[0-9a-f]|20);#i', '', (string) $decoded );
			$decoded = preg_replace( '#&\#0*(?:[0-9]|1[0-9]|2[0-9]|3[0-2]);#', '', (string) $decoded );
			$decoded = preg_replace( '#[\s\x00-\x1f]+#', '', (string) $decoded );

			$blocked = (bool) preg_match( '#^(?:javascript|vbscript):#i', (string) $decoded );
			if ( ! $blocked && preg_match( '#^data:#i', (string) $decoded ) ) {
				$blocked = ! preg_match( '#^data:image/(?:png|jpe?g|gif|webp)[;,]#i', (string) $decoded );
			}

			if ( ! $blocked ) {
				return $matches[0];
			}
			return $matches[1] . '=' . $matches[2] . '#' . $matches[2];
		}

		// ============================================================
		// BOOTSTRAP
		// ============================================================

		public static function init() {
			add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );

			// Called directly, not hooked: the MCP loader runs this during
			// plugins_loaded, so any further plugins_loaded callback would be
			// registered after that hook had already passed. The REST server does
			// not read the body until parse_request, so here is early enough.
			UiChemy_Upload_Slots::capture_body( self::REST_NAMESPACE, self::REST_ROUTE, self::MAX_VIDEO_BYTES );
		}

		public static function register_routes() {
			$args = array(
				'slot'     => array(
					'type'              => 'string',
					'required'          => true,
					'sanitize_callback' => 'sanitize_key',
				),
				'filename' => array(
					'type'              => 'string',
					'required'          => false,
					'sanitize_callback' => 'sanitize_file_name',
				),
				'alt'      => array(
					'type'              => 'string',
					'required'          => false,
					'sanitize_callback' => 'sanitize_text_field',
				),
				'title'    => array(
					'type'              => 'string',
					'required'          => false,
					'sanitize_callback' => 'sanitize_text_field',
				),
				'caption'  => array(
					'type'              => 'string',
					'required'          => false,
					'sanitize_callback' => 'sanitize_text_field',
				),
			);

			// PUT is what the examples advertise: it bypasses PHP's
			// upload_max_filesize / post_max_size, which are tuned for form posts
			// and are commonly lower than the per-file ceilings here. POST stays
			// registered for hosts and proxies that refuse PUT outright.
			register_rest_route(
				self::REST_NAMESPACE,
				'/' . self::REST_ROUTE,
				array(
					array(
						'methods'             => 'PUT',
						'callback'            => array( __CLASS__, 'handle_upload' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
						'args'                => $args,
					),
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'handle_upload' ),
						'permission_callback' => array( __CLASS__, 'check_permission' ),
						'args'                => $args,
					),
				)
			);
		}

		/**
		 * Authorize the request from the slot's secret token.
		 *
		 * A curl PUT carries no WP login cookie, so the token is the whole
		 * credential. Every check, and every distinct refusal, comes from the
		 * shared slot service, so this endpoint and the code-file endpoint answer
		 * the same failure the same way. Authorization only: the acting user is
		 * adopted in `handle_upload`, so no gate mutates global user state.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return true|WP_Error
		 */
		public static function check_permission( WP_REST_Request $request ) {
			$payload = UiChemy_Upload_Slots::validate( $request, self::SLOT_TRANSIENT_PREFIX );
			return is_wp_error( $payload ) ? $payload : true;
		}

		// ============================================================
		// SLOT ISSUE
		// ============================================================

		/**
		 * Issue a multi-file upload slot. Called from the MCP surfaces after
		 * auth + per-tool gating.
		 *
		 * @param array{ttl_minutes?:int} $args Slot options.
		 * @return array|WP_Error
		 */
		public static function issue_slot( $args = array() ) {
			$args = is_array( $args ) ? $args : array();

			$slot = UiChemy_Upload_Slots::issue(
				array(
					'prefix'      => self::SLOT_TRANSIENT_PREFIX,
					'ttl_minutes' => isset( $args['ttl_minutes'] ) ? (int) $args['ttl_minutes'] : 0,
					'min_ttl'     => self::MIN_TTL_MINUTES,
					'max_ttl'     => self::MAX_TTL_MINUTES,
					'default_ttl' => self::DEFAULT_TTL_MINUTES,
				)
			);
			if ( is_wp_error( $slot ) ) {
				return $slot;
			}

			$slot_url = UiChemy_Upload_Slots::slot_url( self::REST_NAMESPACE, self::REST_ROUTE, $slot['slot'] );
			$header     = UiChemy_Upload_Slots::request_header( $slot['token'] );

			return array(
				'slot'           => $slot['slot'],
				'slot_url'       => $slot_url,
				'request_header'      => $header,
				'expiry'         => UiChemy_Upload_Slots::iso8601( $slot['expires_at'] ),
				'ttl_minutes'    => $slot['ttl_minutes'],
				'limits'              => array(
					'per_file_mb'  => (int) round( self::MAX_FILE_BYTES / MB_IN_BYTES ),
					'per_video_mb' => (int) round( self::MAX_VIDEO_BYTES / MB_IN_BYTES ),
				),
				'usage_example'       => self::usage_example( $header, $slot_url ),
				'batch_usage_example' => self::batch_usage_example( $header, $slot_url ),
				'instructions'        => self::instructions( $slot['ttl_minutes'] ),
			);
		}

		/**
		 * Single-file curl example.
		 *
		 * @param string $header     Full "Name: value" token header.
		 * @param string $slot_url Slot URL.
		 * @return string
		 */
		private static function usage_example( $header, $slot_url ) {
			return sprintf(
				"curl -s -X PUT -H %s --data-binary @'hero.png' \\\n  %s",
				escapeshellarg( $header ),
				escapeshellarg( $slot_url . '&filename=hero.png&alt=Team+collaborating+at+a+whiteboard' )
			);
		}

		/**
		 * Many-file curl example. This is the shape that keeps a whole page
		 * build to one shell command, so it is what the caller should copy.
		 *
		 * @param string $header     Full "Name: value" token header.
		 * @param string $slot_url Slot URL.
		 * @return string
		 */
		private static function batch_usage_example( $header, $slot_url ) {
			return "for f in hero.png team.jpg logo.svg; do\n"
				. '  curl -s -X PUT -H ' . escapeshellarg( $header ) . " --data-binary @\"\$f\" \\\n"
				. '    ' . escapeshellarg( $slot_url ) . "\"&filename=\$f&alt=short+description\"\ndone";
		}

		/**
		 * Caller-facing usage notes. Written for an agent reading it once:
		 * imperative, ordered by what it has to decide first.
		 *
		 * @param int $ttl TTL in minutes.
		 * @return string
		 */
		private static function instructions( $ttl ) {
			return 'Upload every file for this build through this one slot. '
				. 'Loop over your files in a single shell command as shown in batch_usage_example. '
				. 'Do not call this tool again for each file. '
				. 'Method is PUT with the raw bytes as the body. '
				. 'Pass filename and alt as URL-encoded query params on each upload. '
				. 'Each response returns url and attachment_id. '
				. 'Use that url in <img src> for images and SVG, <video src> for video, or CSS @font-face for fonts. '
				. 'File type is detected from the bytes you send, so do not declare it. '
				. 'alt is saved during the upload, so no follow-up call is needed to set it. '
				. 'SVG requires the unfiltered_html capability. '
				. 'The slot accepts files until it expires in ' . (int) $ttl . ' minute(s).';
		}

		// ============================================================
		// UPLOAD HANDLER
		// ============================================================

		public static function handle_upload( WP_REST_Request $request ) {
			$payload = UiChemy_Upload_Slots::validated( self::SLOT_TRANSIENT_PREFIX );
			if ( ! is_array( $payload ) ) {
				// Defensive: the permission gate is the only path here.
				return self::rest_error( 'slot_unknown', 'Upload slot could not be validated. Request a new upload slot.', 404 );
			}

			// The slot's issuing user becomes the acting user: needed for the
			// unfiltered_html SVG gate below and for the attachment author. The
			// slot is NOT spent here, it stays open for the rest of the batch.
			UiChemy_Upload_Slots::adopt_user( $payload );

			// Bound how many files one (possibly leaked) slot may push into the
			// media library. A legitimate editor batch stays well under this; the
			// short TTL plus this cap keep a leaked token's blast radius small.
			$max_files = (int) apply_filters( 'uich_composer_upload_max_files', self::MAX_SLOT_FILES );
			$within    = UiChemy_Upload_Slots::register_use(
				self::SLOT_TRANSIENT_PREFIX,
				(string) ( isset( $payload['slot'] ) ? $payload['slot'] : '' ),
				$max_files
			);
			if ( is_wp_error( $within ) ) {
				return self::rest_error( $within->get_error_code(), $within->get_error_message(), 429 );
			}

			if ( UiChemy_Upload_Slots::body_overflowed() ) {
				return self::rest_error(
					'file_too_large',
					sprintf( 'Upload exceeds the %d byte ceiling for any single file.', self::MAX_VIDEO_BYTES ),
					413,
					array( 'limit_bytes' => self::MAX_VIDEO_BYTES )
				);
			}

			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';

			// PHP only parses multipart bodies for POST, so a multipart PUT
			// arrives as an unparsed envelope and would otherwise be sniffed as
			// text and rejected as an unsupported type. Name the real problem.
			if ( 0 === stripos( (string) $request->get_header( 'content_type' ), 'multipart/form-data' )
				&& ! $request->get_file_params()
			) {
				return self::rest_error(
					'multipart_needs_post',
					'Multipart bodies are only parsed on POST. Either PUT the raw file bytes with --data-binary, or switch this request to POST.',
					400
				);
			}

			$tmp_path = self::resolve_source_file( $request );
			if ( is_wp_error( $tmp_path ) ) {
				return $tmp_path;
			}

			$size = (int) filesize( $tmp_path );
			if ( ! $size ) {
				self::discard( $tmp_path );
				return self::rest_error( 'empty_file', 'Upload body was empty. PUT the raw file bytes, or POST a multipart "file" field.', 400 );
			}

			$filename = self::resolve_filename( $request );

			$resolved = self::resolve_upload_type( $tmp_path, $filename );
			if ( is_wp_error( $resolved ) ) {
				self::discard( $tmp_path );
				return $resolved;
			}
			list( $mime, $filename ) = $resolved;

			$max_bytes = self::max_bytes_for_mime( $mime );
			if ( $size > $max_bytes ) {
				self::discard( $tmp_path );
				return self::rest_error(
					'file_too_large',
					sprintf( '%s is %d bytes, over the %d byte ceiling for %s.', $filename, $size, $max_bytes, $mime ),
					413,
					array(
						'limit_bytes' => $max_bytes,
						'mime'        => $mime,
					)
				);
			}

			// SVG is XML markup that can carry executable scripts, so it is served
			// as an active document. Restrict SVG uploads to users WordPress itself
			// trusts with raw markup (`unfiltered_html`: administrators on
			// single-site; nobody on multisite or when DISALLOW_UNFILTERED_HTML is
			// set). Raster formats (png/jpg/webp/gif) are inert and stay allowed.
			if ( 'image/svg+xml' === $mime ) {
				if ( ! current_user_can( 'unfiltered_html' ) ) {
					self::discard( $tmp_path );
					return self::rest_error( 'svg_capability', 'SVG uploads require the unfiltered_html capability. Upload a PNG or WebP instead.', 403 );
				}
				$sanitised = self::sanitize_svg_bytes( (string) file_get_contents( $tmp_path ) );
				if ( false === file_put_contents( $tmp_path, $sanitised ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- writing our own temp file.
					self::discard( $tmp_path );
					return self::rest_error( 'store_failed', 'Could not write the sanitised SVG to a temp file.', 500 );
				}
				$size = strlen( $sanitised );
				unset( $sanitised );
			}

			$sideload = self::sideload( $tmp_path, $filename, $mime );
			if ( is_wp_error( $sideload ) ) {
				self::discard( $tmp_path );
				return $sideload;
			}
			// WordPress has moved the bytes; the streamed temp file is gone.
			UiChemy_Upload_Slots::release_body( $tmp_path );

			$attach_id = wp_insert_attachment(
				array(
					'post_mime_type' => $sideload['type'],
					'post_title'     => self::resolve_title( $request, $filename ),
					'post_excerpt'   => (string) $request->get_param( 'caption' ),
					'post_content'   => '',
					'post_status'    => 'inherit',
				),
				$sideload['file'],
				0
			);
			if ( is_wp_error( $attach_id ) || ! $attach_id ) {
				return self::rest_error( 'store_failed', 'Could not create the media attachment.', 500 );
			}

			$meta = wp_generate_attachment_metadata( $attach_id, $sideload['file'] );
			wp_update_attachment_metadata( $attach_id, $meta );

			// Stored during the upload so the caller never needs a second call to
			// set it. Sideloaded images start with no alt text and every <img>
			// written into a page should have some.
			$alt = trim( (string) $request->get_param( 'alt' ) );
			if ( '' !== $alt ) {
				update_post_meta( $attach_id, '_wp_attachment_image_alt', $alt );
			}

			return rest_ensure_response(
				array(
					'attachment_id' => (int) $attach_id,
					'url'           => wp_get_attachment_url( $attach_id ),
					'mime'          => (string) $sideload['type'],
					'width'         => isset( $meta['width'] ) ? (int) $meta['width'] : null,
					'height'        => isset( $meta['height'] ) ? (int) $meta['height'] : null,
					'bytes'         => (int) $size,
					'alt'           => $alt,
				)
			);
		}

		/**
		 * Hand the file to WordPress, allowing the extensions WP blocks by
		 * default for the duration of this one sideload. `wp_handle_sideload`
		 * runs its own filetype test and stays the authoritative gate.
		 *
		 * @param string $tmp_path Temp file path.
		 * @param string $filename Target filename.
		 * @param string $mime     Resolved MIME type.
		 * @return array|WP_Error
		 */
		private static function sideload( $tmp_path, $filename, $mime ) {
			$filters = array();
			if ( self::is_font_mime( $mime ) ) {
				$filters = array( 'allow_font_upload_mimes', 'fix_font_filetype_check' );
			} elseif ( 'image/svg+xml' === $mime ) {
				$filters = array( 'allow_svg_upload_mimes', 'fix_svg_filetype_check' );
			}

			if ( $filters ) {
				add_filter( 'upload_mimes', array( __CLASS__, $filters[0] ), 99 );
				add_filter( 'wp_check_filetype_and_ext', array( __CLASS__, $filters[1] ), 99, 3 );
			}
			// wp_handle_sideload() takes $file by reference, so it needs a
			// variable rather than an inline array.
			$file_array = array(
				'name'     => $filename,
				'tmp_name' => $tmp_path,
			);
			self::$reserved_path = null;
			try {
				$sideload = wp_handle_sideload(
					$file_array,
					array(
						'test_form'                => false,
						'unique_filename_callback' => array( __CLASS__, 'reserve_unique_filename' ),
					)
				);
			} finally {
				if ( $filters ) {
					remove_filter( 'upload_mimes', array( __CLASS__, $filters[0] ), 99 );
					remove_filter( 'wp_check_filetype_and_ext', array( __CLASS__, $filters[1] ), 99 );
				}
			}

			if ( ! empty( $sideload['error'] ) ) {
				// Drop the placeholder so a failed upload leaves nothing behind.
				if ( self::$reserved_path && file_exists( self::$reserved_path ) && ! filesize( self::$reserved_path ) ) {
					wp_delete_file( self::$reserved_path );
				}
				self::$reserved_path = null;
				return self::rest_error( 'store_failed', 'WordPress rejected the file: ' . (string) $sideload['error'], 500 );
			}
			self::$reserved_path = null;
			return $sideload;
		}

		/**
		 * Claim a filename in the uploads directory atomically.
		 *
		 * wp_unique_filename() asks whether a name is free and the caller writes
		 * it a moment later. Two uploads racing on the same name both see it as
		 * free, both write, and the second silently overwrites the first, leaving
		 * two attachments pointing at one file. Creating the name with the "x"
		 * flag makes the check and the claim a single operation, so exactly one
		 * caller can win it. WordPress then moves the real bytes over the empty
		 * placeholder we left behind.
		 *
		 * @param string $dir  Target directory.
		 * @param string $name Desired filename, including extension.
		 * @param string $ext  Extension including the leading dot.
		 * @return string Filename that is now claimed.
		 */
		public static function reserve_unique_filename( $dir, $name, $ext ) {
			$dir  = rtrim( (string) $dir, '/\\' );
			$ext  = (string) $ext;
			$stem = (string) pathinfo( (string) $name, PATHINFO_FILENAME );
			if ( '' === $stem ) {
				$stem = 'uichemy-' . wp_generate_password( 6, false, false );
			}

			for ( $suffix = 0; $suffix < 500; $suffix++ ) {
				$candidate = ( 0 === $suffix ) ? $stem . $ext : $stem . '-' . $suffix . $ext;
				$path      = $dir . '/' . $candidate;

				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- an existing name is the expected outcome, not an error to report.
				$handle = @fopen( $path, 'xb' );
				if ( $handle ) {
					fclose( $handle );
					self::$reserved_path = $path;
					return $candidate;
				}
			}

			$candidate           = $stem . '-' . wp_generate_password( 8, false, false ) . $ext;
			self::$reserved_path = $dir . '/' . $candidate;
			return $candidate;
		}

		// ============================================================
		// HELPERS
		// ============================================================

		/**
		 * Work out the MIME type from the bytes on disk.
		 *
		 * The content decides, not the filename: a caller-supplied name is a
		 * hint that can be absent, wrong, or deliberately misleading. The
		 * extension is only consulted for the families that sniff badly across
		 * finfo builds (video containers, web fonts) where a silent or generic
		 * sniff is expected rather than suspicious.
		 *
		 * @param string $tmp_path Temp file path.
		 * @param string $filename Caller-supplied filename, possibly empty.
		 * @return array{0:string,1:string}|WP_Error [ mime, filename ]
		 */
		private static function resolve_upload_type( $tmp_path, $filename ) {
			$allowed  = self::allowed_mimes();
			$ext      = strtolower( (string) pathinfo( $filename, PATHINFO_EXTENSION ) );
			$ext_mime = self::mime_from_ext( $ext );
			$sniffed  = self::sniff_mime( $tmp_path );

			$mime = '';
			if ( $sniffed && isset( $allowed[ $sniffed ] ) ) {
				$mime = $sniffed;
			} elseif ( $ext_mime && isset( $allowed[ $ext_mime ] ) ) {
				// Video containers report inconsistently (an .ogv as
				// application/ogg, an .mp4 as video/quicktime, nothing at all
				// where finfo lacks the magic). Fonts commonly report as
				// octet-stream or application/font-sfnt. In those two families a
				// silent or generic sniff corroborates the extension rather than
				// contradicting it. wp_handle_sideload still runs the
				// authoritative filetype test, so a genuinely wrong file fails.
				if ( self::is_video_mime( $ext_mime )
					&& ( '' === $sniffed || self::is_video_mime( $sniffed ) || 'application/ogg' === $sniffed )
				) {
					$mime = $ext_mime;
				} elseif ( self::is_font_mime( $ext_mime )
					&& ( '' === $sniffed || self::is_font_mime( $sniffed ) || 'application/octet-stream' === $sniffed )
				) {
					$mime = $ext_mime;
				}
			}

			if ( '' === $mime ) {
				return self::rest_error(
					'type_blocked',
					sprintf(
						'File type is not accepted. Detected: %s. Allowed: %s.',
						$sniffed ? $sniffed : 'unknown',
						implode( ', ', array_keys( $allowed ) )
					),
					415,
					array( 'detected_type' => $sniffed )
				);
			}

			// Name the file after what it actually is. An extension that already
			// resolves to this type is kept as the caller wrote it (jpg/jpeg,
			// m4v/mp4, qt/mov), so a valid name is never rewritten.
			$stem = (string) pathinfo( $filename, PATHINFO_FILENAME );
			if ( '' === $stem ) {
				$stem = 'uichemy-' . wp_generate_password( 6, false, false );
			}
			// Filesystems cap a single name at 255 bytes and wp_tempnam adds a
			// prefix and suffix of its own, so a long descriptive name would fail
			// at fopen rather than at validation. Truncate instead of rejecting.
			if ( strlen( $stem ) > self::MAX_FILENAME_STEM ) {
				$stem = rtrim( substr( $stem, 0, self::MAX_FILENAME_STEM ), '-_.' );
				if ( '' === $stem ) {
					$stem = 'uichemy-' . wp_generate_password( 6, false, false );
				}
			}
			if ( $ext !== $allowed[ $mime ] && $ext_mime !== $mime ) {
				$filename = $stem . '.' . $allowed[ $mime ];
			} else {
				$filename = $stem . '.' . $ext;
			}

			return array( $mime, $filename );
		}

		/**
		 * Detect a MIME type from file contents alone.
		 *
		 * @param string $tmp_path Temp file path.
		 * @return string MIME type, or '' when nothing could be determined.
		 */
		private static function sniff_mime( $tmp_path ) {
			if ( function_exists( 'wp_get_image_mime' ) ) {
				$image_mime = wp_get_image_mime( $tmp_path );
				if ( $image_mime ) {
					return strtolower( (string) $image_mime );
				}
			}

			$mime = '';
			if ( function_exists( 'finfo_open' ) ) {
				$finfo = finfo_open( FILEINFO_MIME_TYPE );
				if ( $finfo ) {
					$detected = finfo_file( $finfo, $tmp_path );
					finfo_close( $finfo );
					if ( is_string( $detected ) && '' !== $detected ) {
						$mime = strtolower( $detected );
					}
				}
			}

			// SVG is XML, so finfo reports it as markup or plain text rather than
			// as an image. Confirm from the document itself.
			if ( ( '' === $mime || in_array( $mime, array( 'text/html', 'text/plain', 'text/xml', 'application/xml', 'image/svg' ), true ) )
				&& self::looks_like_svg( $tmp_path )
			) {
				return 'image/svg+xml';
			}

			return $mime;
		}

		/**
		 * Whether the head of a file reads as an SVG document.
		 *
		 * @param string $tmp_path Temp file path.
		 * @return bool
		 */
		private static function looks_like_svg( $tmp_path ) {
			$head = file_get_contents( $tmp_path, false, null, 0, 1024 );
			if ( ! is_string( $head ) || '' === $head ) {
				return false;
			}
			return false !== stripos( $head, '<svg' );
		}

		/**
		 * Path to the bytes for this upload.
		 *
		 * Preference order: the file streamed off the socket before the REST
		 * server booted, then a multipart field, then the buffered request body.
		 * The last case only applies when the early streamer did not run, and is
		 * kept so the endpoint still works if that hook is bypassed.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return string|WP_Error Temp file path.
		 */
		private static function resolve_source_file( WP_REST_Request $request ) {
			$streamed = UiChemy_Upload_Slots::body_path();
			if ( $streamed ) {
				return $streamed;
			}

			$files = $request->get_file_params();
			if ( ! empty( $files['file']['tmp_name'] ) && is_uploaded_file( $files['file']['tmp_name'] ) ) {
				return (string) $files['file']['tmp_name'];
			}

			$body = $request->get_body();
			if ( ! is_string( $body ) || '' === $body ) {
				return self::rest_error( 'empty_file', 'Upload body was empty. PUT the raw file bytes, or POST a multipart "file" field.', 400 );
			}

			$path = wp_tempnam( 'uich-upload' );
			if ( ! $path ) {
				return self::rest_error( 'store_failed', 'Could not allocate a temp file for the upload.', 500 );
			}
			if ( false === file_put_contents( $path, $body ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- writing our own temp file.
				wp_delete_file( $path );
				return self::rest_error( 'store_failed', 'Could not write the upload to a temp file.', 500 );
			}
			return $path;
		}

		/**
		 * Remove a temp file that will not be handed to WordPress.
		 *
		 * @param string $path Temp file path.
		 * @return void
		 */
		private static function discard( $path ) {
			if ( $path && file_exists( $path ) ) {
				wp_delete_file( $path );
			}
			UiChemy_Upload_Slots::release_body( $path );
		}

		/**
		 * Filename for this upload: the query param when given, the multipart
		 * field name as a fallback, otherwise a generated stem. The extension
		 * is corrected later against the real type.
		 *
		 * @param WP_REST_Request $request Request.
		 * @return string
		 */
		private static function resolve_filename( WP_REST_Request $request ) {
			$filename = sanitize_file_name( (string) $request->get_param( 'filename' ) );
			if ( '' !== $filename ) {
				return $filename;
			}

			$files = $request->get_file_params();
			if ( ! empty( $files['file']['name'] ) ) {
				$filename = sanitize_file_name( (string) $files['file']['name'] );
				if ( '' !== $filename ) {
					return $filename;
				}
			}

			return 'uichemy-' . wp_generate_password( 6, false, false );
		}

		/**
		 * Media library title: the caller's title when given, otherwise the
		 * filename stem.
		 *
		 * @param WP_REST_Request $request  Request.
		 * @param string          $filename Resolved filename.
		 * @return string
		 */
		private static function resolve_title( WP_REST_Request $request, $filename ) {
			$title = trim( (string) $request->get_param( 'title' ) );
			if ( '' !== $title ) {
				return $title;
			}
			return sanitize_file_name( (string) pathinfo( $filename, PATHINFO_FILENAME ) );
		}

		private static function mime_from_ext( $ext ) {
			$ext = strtolower( (string) $ext );
			$map = array(
				'png'   => 'image/png',
				'jpg'   => 'image/jpeg',
				'jpeg'  => 'image/jpeg',
				'webp'  => 'image/webp',
				'gif'   => 'image/gif',
				'svg'   => 'image/svg+xml',
				'mp4'   => 'video/mp4',
				'm4v'   => 'video/mp4',
				'webm'  => 'video/webm',
				'ogv'   => 'video/ogg',
				'mov'   => 'video/quicktime',
				'qt'    => 'video/quicktime',
				'woff2' => 'font/woff2',
				'woff'  => 'font/woff',
				'ttf'   => 'font/ttf',
				'otf'   => 'font/otf',
			);
			return isset( $map[ $ext ] ) ? $map[ $ext ] : '';
		}

		private static function rest_error( $code, $message, $status, $data = array() ) {
			return UiChemy_Upload_Slots::error( $code, $message, $status, $data );
		}
	}
}
