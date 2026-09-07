// Style-only entry for the canvas design system. Emits build/canvas.css, which
// PHP enqueues into the Elementor PREVIEW document (see
// Uichemy_Composer_Enqueue::enqueue_preview_canvas_css) so the on-canvas
// toolbar's controls are styled by the real design system rather than patched
// part-by-part in the toolbar's own stylesheet.
//
// Enqueued by PHP into the document that needs it, not injected at runtime: the
// preview is a normal WordPress request with its own hook, so there is no reason
// for JavaScript to be involved in getting a stylesheet onto the page.
import './canvas.css';
import './shadcn-tokens.css';
// The composer skin palette — the same file the panel imports. This is what
// lets the on-canvas toolbar resolve --panel-*, --text-* and --accent-* to
// the values the panel and dock are already using.
import './composer-skin-tokens.css';
