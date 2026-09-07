# Scope Decision — Site-Level vs Page-Level

Whenever you're about to emit a `<link>`, `<style>`, `<script>`, or `<meta>` tag (Google Fonts, Bunny Fonts, CDN libs, analytics, pixels, custom CSS, etc.) you must consciously choose **site scope** or **page scope**. Picking the wrong scope means either bloat (asset loaded on every page when only one needs it) or breakage (font missing on a page that uses it).

## The fields

| Field | Where it lands | When emitted |
|---|---|---|
| `site_before_head` | Site option `uichemy_composer_site_custom_code.head` → printed in `<head>` of **every** page on the site | First upload of the pipeline only |
| `site_before_body` | Site option `…footer` → printed before `</body>` of **every** page | First upload of the pipeline only |
| `page_before_head` | Stored on the first Composer widget of the page (`page_custom_code_head`) → printed in `<head>` of **that page only** | First upload of the page only (sections 2+ skip) |
| `page_before_body` | Stored on the first widget (`page_custom_code_footer`) → printed before `</body>` of **that page only** | First upload of the page only |
| `css` / `js` | Scoped to the widget instance | Every section |

## Decision rubric

For each asset you'd otherwise drop into a `<link>`/`<style>`/`<script>` tag, ask in order:

1. **Is it used by the header or footer template?** → **site_before_head**. The header/footer renders on every page, so its dependencies must too. Judge this by what the file *contains*, not by its name: a `home.css` very often holds the footer rules too, and then it is header/footer-scoped no matter what it is called (grep it for the footer's selectors before you decide). Load such a file site-wide rather than trying to split the footer rules out of it — those rules are usually scattered across the file and interleaved with page-only rules inside shared `@media` blocks, so splitting risks a footer that looks right on desktop and breaks on mobile, on every page of the site. Say in the summary that you loaded it site-wide and why.
2. **Will it be needed by ≥2 different pages in this build?** → **site_before_head**. One cached copy is cheaper than re-fetching per page. Brand fonts are almost always this case.
3. **Is it a global concern (analytics, tag manager, GA4, Meta Pixel, cookie banner, A/B testing harness)?** → **site_before_head** / **site_before_body**.
4. **Is it specific to one page only?** (campaign pixel, chart library only used by a report page, page-only hero font, page-only animation lib) → **page_before_head** / **page_before_body**.
5. **Tiebreaker for fonts:** when you genuinely can't tell, prefer **site_before_head**. Font files are cache-friendly across pages and the cost of double-importing on the one page that uses them is much smaller than the cost of a missing font on a page you forgot.

## Second decision — inline, or a real file?

Scope is *where the tag goes*. This is a separate question: should these bytes be a file at all?

**Default: inline.** Section CSS and JS belong in the section, and page-shell code belongs in
`page_before_head` / `page_before_body`. That is what stays editable for the user in the UiChemy
editor, and it is right for the overwhelming majority of what you write.

**Use a code file** — `uichemy-composer/code-file`, if that ability is in your list — when the code
is genuinely SHARED and sizeable: a vendor library you could not reimplement, one animation or
utility system several sections depend on, the same block appearing in three or more sections, or
anything past roughly 20 KB that two or more pages need. Upload it with `action: "request-upload"`
when the file is already on disk, and reference the returned path with a `<link>` or `<script src>`.

Not reasons to reach for a file: "the code is long" (a long section-specific block still belongs to
its section) and "I want it out of the way" (the user loses the ability to edit it). Global design
tokens are never a code file — they belong in `uichemy-composer/design-system`.

**The two decisions compose.** A code file changes where the bytes live, not which scope the tag
belongs to: you still run the rubric above on the resulting `<link>`/`<script src>` and put it in
`site_before_head` or `page_before_head` accordingly.

## Concrete font handling

- The families the design system reuses are the **site-level** font set (in the Figma pipeline this is the `unmatchedFonts[]` list built in Phase 1; in the other skills it is simply the fonts the source uses throughout). Emit them in `site_before_head` on the first upload of the pipeline (header, footer, or first section — whichever runs first).
- If a single section introduces a font that is **not** in `unmatchedFonts[]` and the design clearly uses it on this section only (e.g., a quote-card display face used only on the "Testimonials" page), emit it via `page_before_head` on that page's first upload — not site-wide.
- Never duplicate: if a family is already in the site-level set, do not re-emit it at page level.

## Format

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap">
```

Use raw `<link>` tags — do **not** wrap them in `<style>`. The composer storage layer preserves `<link>`/`<style>`/`<script>`/`<meta>` tags exactly when sent through MCP.

## Anti-patterns

- ❌ Putting every font at site level "to be safe" — bloats every page on the site.
- ❌ Putting brand fonts at page level — they'll be missing on every other page that uses them.
- ❌ Re-sending `site_before_head` on sections 2+ — duplicate `<link>` URLs are skipped, but it's wasted payload.
- ❌ Wrapping `<link>` tags inside `<style>` — browsers ignore that.

## Page-global visuals & behaviour

Effects that span the WHOLE page — a fixed ambient background (aurora / gradient glow / floating orbs behind every section) or a single on-scroll reveal system — do not belong to any one section, so scoping them per-widget drops them. Route them through the page-shell lanes instead:

- **Fixed ambient background:** layer CSS + keyframes → `page_before_head` (one `<style>`); the fixed, behind-everything layer element (`position:fixed; inset:0; z-index:-1; pointer-events:none`) → `page_before_body`.
- **Page-level scroll-reveal / small effects:** reimplement as ONE dependency-free vanilla `IntersectionObserver` (or equivalent) in `page_before_body`; put the transition CSS in `page_before_head`; tag section elements with `data-reveal`. Do NOT paste a CDN library — reimplement small effects in vanilla; only a genuinely heavy lib (Swiper, Lottie) gets deferred to the user.
- **Capability caveat:** page-level `<style>`/`<script>` survive only for authors WordPress trusts with raw code (`unfiltered_html` — admins); for others they are `wp_kses_post()`-stripped on output.

Shape of it:

```html
<!-- page_before_body -->
<div class="pr-aurora" aria-hidden="true"></div>
```
```css
/* page_before_head */
.pr-aurora { position:fixed; inset:0; z-index:-1; pointer-events:none;
             background: radial-gradient(/* the source's exact colours */);
             animation: pr-aurora-drift 18s ease-in-out infinite; }
@keyframes pr-aurora-drift { /* the source's exact keyframes */ }
```

`position:fixed; z-index:-1` puts it behind every section without touching any single widget.
Keep the source's exact colours and timing. Never silently flatten these — either reproduce them
through the page-shell lanes or tell the user they were omitted and why.
