## Step 8 — Verification (blocks upload if FAIL)

**Typography:**
- Matched elements: HTML has the `.text-*` class from `typoLookup` AND CSS rule has NO `font-family`, `font-weight`, `font-size`, `line-height`, `letter-spacing`.
- Unmatched elements: CSS rule HAS all font properties.

**Colors:**
- Every hex in CSS that exists in `colorLookup` MUST use `var(--name)` (from the `#uichemy-globals` block).
- Exception: `rgba()` alpha<1 may remain raw.

**Boxed width:**
- Any boxed content wrapper uses the `.pr-boxed` class, never a hand-written `max-width`.

**Output:**

PASS → print one line:
```
🛡️  Section N/T: PASS
```

FAIL → print full detail:
```
❌  Section N/T: FAIL
    [list every failing selector with what's wrong]
    [fix, then re-verify before uploading]
```

Do not upload until PASS.

---

## Step 9 — Upload to WordPress

### Tool routing decision tree ⚠️ MANDATORY

```
Header or Footer section?
  YES → uichemy-composer/template (action="create", type="header"|"footer")  ← UiChemy's native Theme Builder, works on
        ANY Elementor (Pro/Nexter NOT required), activates site-wide immediately.
        header_footer_system from uichemy-composer/describe-site (Step 2a) is informational only — do not
        branch on it. Only skip this ability and inline the section instead if the user has
        explicitly asked for page-only placement:
            • Header → make it section 1 of uichemy-composer/page (action="create")
            • Footer → make it the LAST uichemy-composer/page (action="append-section") call (after every body section)

  NO  → Single-post / blog-article design?
        (signals: post title hero, author/date meta, long article body,
         comments, related posts, ToC sidebar)
         YES → Theme builder active (Elementor Pro or Nexter)?
                NO  → uichemy-composer/page (action="create") (fallback)
                YES → User confirmed "build as single post template"?
                       NO  → ask user first, wait for answer
                       YES → uichemy-composer/template (action="create", type="single")(force_deactivate=false)
                              status="existing_templates_found"?
                                ask user → YES: call again force_deactivate=true
                                         → NO:  use uichemy-composer/page (action="create")
                              published_posts_count=0?
                                offer sample post → YES: call again create_sample_post=true

         NO  → First regular section? → uichemy-composer/page (action="create")
               Subsequent sections?  → uichemy-composer/page (action="append-section")
```

---

### Single post template → `uichemy-composer/template (action="create", type="single")`

⚠️ **Critical rules:**
1. **NO header, NO footer** — generate ONLY the article body area.
2. **NO hardcoded post metadata** — use placeholder styled HTML; actual values come from WordPress at render time.
3. **NO hardcoded article body** — use `<uichemy-post-content />` for the content.

**Dynamic tags (only these two exist):**

| Tag | Renders |
|---|---|
| `<uichemy-post-content />` | Full post body (`the_content`) — required |
| `<uichemy-toc>...</uichemy-toc>` | Table of contents from post headings — optional |

**`<uichemy-toc>` syntax:**
```html
<uichemy-toc class="toc-nav">
  <li for="heading in headings" class="toc-item">
    <ul if="sub_headings in heading" class="toc-sub">
      <li for="sub_heading in heading.sub_headings" class="toc-sub-item"></li>
    </ul>
  </li>
</uichemy-toc>
```
Rules: `for=` on `<li>`, `if=` on `<ul>`. Never hardcode `<li>` items. Must be `<uichemy-toc>...</uichemy-toc>` — not self-closing. Omit `<ul if=...>` block for flat list (no sub-headings shown).

Payload:
```
{ title, post_type:"post", label, html, css, js,
  site_before_head:"<Google Fonts — only if not sent yet>",
  force_deactivate:false, upload_images:true }
```

Save from response: `post_id`, `system`, `active`, `preview_link` → `pipelineState`.
- `system="elementor_pro"` or `"nexter"` → ACTIVE immediately on all posts
- `system="none"` → fall back to `uichemy-composer/page (action="create")`

---

### Header/Footer routing — always native Theme Builder unless page-only requested

**9a — Site branding (Header only, before upload — applies to BOTH paths):**

Using `pipelineState.branding_action` from Step 2d:
- Pass `logo_url` if `branding_action.logo = 'set'|'replace'` · `force:true` only when `'replace'`
- Pass `icon_url` if `branding_action.icon = 'set'|'replace'`
- Skip `uichemy-composer/platform (action="update-site-settings")` entirely if both are `'skip'`

Call `uichemy-composer/platform (action="update-site-settings")` **before** the header upload (default path) or **before** the page is created (page-only exception).

#### Default — site-wide via `uichemy-composer/template (action="create", type="header"|"footer")`

UiChemy's native Theme Builder engine — works on ANY Elementor (Pro/Nexter NOT required). `platform.header_footer_system` is informational only; do not branch on it.

Payload:
```
{ type:"header"|"footer", title, label, html, css, js,
  site_before_head:"<Google Fonts links — first upload in pipeline only>",
  upload_images:true }
```

Response has `active:true` and `system:"uichemy_native"` immediately — no manual activation step. Old active templates of the same type (header or footer) are deactivated automatically on import.

Save: push `{ type, post_id, system, active }` to `pipelineState.templates[]`.

#### Page-only exception — only if the user explicitly requested this

Skip `uichemy-composer/template (action="create", type="header"|"footer")` and embed Header and Footer as page sections instead:

1. **Header** → make it the section that goes into `uichemy-composer/page (action="create")` (label:"Header", html/css = the header markup). Pass `site_before_head` with the Google Fonts links on this call (since this is now your first upload). Set `pipelineState.headerInline = true`.
2. **Body sections** → `uichemy-composer/page (action="append-section")` per section as usual.
3. **Footer** → the very last `uichemy-composer/page (action="append-section")` call (label:"Footer", html/css = the footer markup). Set `pipelineState.footerInline = true`.

In Step 11 (Phase 3 summary), report `"header+footer mode: inline (page-only, per user request)"` so the user knows why no theme template was created.

---

### First regular section → `uichemy-composer/page (action="create")`

Payload:
```
{ title:"<pipelineState.pageTitle>", status:"draft", label, html, css, js,
  site_before_head:"<Google Fonts from unmatchedFonts[] — once only>",
  upload_images:true }
```

**`title` MUST come from `pipelineState.pageTitle`** (set in Step 1c). Never send an empty string, never let it fall back to the ability's `"UiChemy AI Landing Page"` placeholder — that placeholder is a smell that Step 1c didn't name the plan.

**Outer container spacing — already handled.** `uichemy-composer/page (action="create")` creates the wrapping Elementor container with `padding: 0`, `margin: 0`, `flex_gap: 0` so the widget's own CSS is the single source of truth for spacing. Do NOT compensate for kit-inherited padding in your widget CSS — assume the outer container contributes zero. Use `padding-inline: clamp(16px, 5vw, {figma}px)` on the widget's `.{block}__container` as Step 7c specifies.

`site_before_head` format:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap">
```

Save: `post_id`, `elementor_link`, `preview_link` → `pipelineState`.

---

### Subsequent regular sections → `uichemy-composer/page (action="append-section")`

Payload: `{ post_id, label, html, css, js, upload_images:true }`

`upload_images:true` sideloads `<img src="…">` URLs only when the WP server can fetch them over HTTP. If this section's HTML references an AI-generated or local image, you must have already promoted it to a public URL via `uichemy-composer/media (action="request-upload")` (see Step 7b earlier in this `generate` part). `data:`, `blob:`, and local paths cause silent failures.

Do NOT re-send `site_before_head`, `page_before_head`, `page_before_body`, `site_before_body` on sections 2+.

### Field scope reference

| Field | Scope | Sent on |
|---|---|---|
| `site_before_head` | All pages on site | First upload only |
| `site_before_body` | All pages on site | First upload only |
| `page_before_head` | This page, all widgets | Section 1 only |
| `page_before_body` | This page, all widgets | Section 1 only, and only if there is page-level JS |
| `css` | This widget only | Every section |
| `js` | This widget only | Every section |

**Picking the right scope for a `<link>`/`<style>`/`<script>`/`<meta>` tag is a deliberate decision — never default to site-level for everything.** Read the `scope-decision` part before emitting any of these tags; it covers the site-vs-page rubric, font-specific handling, and anti-patterns.

### Asset failures

Every `create_*` / `add_*` response includes an `image_failures` array — media (image / video / audio, in HTML `src`/`poster` or CSS `url()`) the server could not fetch. Each entry is `{ from, error, code, source }`. Read the code: `uich_local_asset` or an invalid URL means a local/relative path (fix: `uichemy-composer/media (action="request-upload")`); a fetch/HTTP error means the URL is not publicly reachable.

**Collect these across ALL upload calls, dedupe by `from`, and if any remain, print a manifest in your final summary** — never leave a failed asset as a silent placeholder for the user to find by eye:

```
⚠️  Couldn't import N asset(s) — these still point at unreachable/local URLs:
    • assets/demo.webm      → local path (re-home via uichemy-composer/media (action="request-upload"))
    • https://cdn.x/y.mp4   → fetch failed (403)
    Fix: upload each local file with uichemy-composer/media (action="request-upload") (images + video/audio),
         or give me a public URL, and I'll re-run the affected section(s).
```

### Error handling

If API returns `isError: true`:
1. Stop loop immediately.
2. **Preserve** `currentSectionMemory` — do not wipe.
3. Print error with `post_id` + resume instructions.
4. Wait for user. On resume: re-run Step 9 only (data preserved).

---

## Step 10 — Clear memory and continue

1. Set `currentSectionMemory = null`.
2. Print `🧹  Memory cleared → Section N+1/T: <Next Label>`.
3. Loop back to Step 6.

If N = total → read the final part: `uichemy-composer/read-skill` with `{ name: "figma-to-wordpress", part: "appendix" }`.

---

## Pre-upload CSS checks (unique items not in Step 7c)

- [ ] Grid `minmax()` floor value reduced at ≤768px / ≤480px if the desktop floor causes overflow at small screens.
- [ ] Modals: `width: min({figma}px, 92vw)` — never fixed width that overflows on mobile.
