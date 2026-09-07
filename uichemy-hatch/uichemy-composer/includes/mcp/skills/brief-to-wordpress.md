# UiChemy Site Build — Direct Prompt Pipeline

You were called because the user asked for a website / landing page / template / section without sharing a Figma URL. Their brief may be as short as **"make docker service design"** or **"build me a saas landing"** — that is normal. Your job is to turn that brief into a complete site (Header → body → Footer), using the Composer MCP tools, with NO follow-up questions to the user unless something is truly ambiguous.

---

## Step 0 — Read this first

You are NOT generating loose HTML to chat. Every section ends up as a real Elementor template on the user's WordPress site, via these abilities:

- `uichemy-composer/describe-site` — site readiness (call once, first)
- `uichemy-composer/design-system (action="get")` / `uichemy-composer/design-system (action="set")` — read/write your palette + type scale as the site's design-system CSS block (`#uichemy-globals`)
- `uichemy-composer/template (action="create") { type:"header"|"footer", ... }` — Header / Footer via UiChemy's native Theme Builder (works on ANY Elementor, Pro/Nexter NOT required); see Build order
- `uichemy-composer/page (action="create") { ... }` — first body section, creates the page
- `uichemy-composer/page (action="append-section") { post_id, ... }` — every subsequent body section
- `uichemy-composer/media (action="request-upload") { filename, mime }` — upload AI-generated images, SVG, or mp4/webm/ogg/mov video so `<img src>` / `<video src>` is a real URL
- `uichemy-composer/code-file` — store a .css/.js file and reference it by URL, for code genuinely shared across sections (one animation or utility system). Not for section-specific code, which stays in the section.

**Globals sync is ON for this build.** After you pick a palette + type scale (Step 3), write them into the `#uichemy-globals` CSS block, then reference them as globals in your CSS: colors as `var(--name)`, typography via the matched `.text-*` class (font shorthand omitted from the CSS rule), and boxed content width via the `.pr-boxed` class. This keeps the whole site editable from the Composer's Globals manager. See Step 3 for the write, Step 4 for how to apply.

If you ever feel the urge to print large HTML in chat instead of calling these abilities — stop. The user wants a built site, not a code dump.

---

## Step 1 — Plan from the brief (no questions yet)

Infer four things from the user's brief in this order:

| Inferred | Source |
|---|---|
| **Brand / topic** | The noun in the brief. "docker service design" → brand="Docker", topic="developer tooling / container platform". "coffee shop site" → brand="Aurora Roasters" (invent a plausible name if not given), topic="café". |
| **Page title** | `<Brand> — <Page kind>`. Examples: "Docker — Service Design", "Aurora Roasters — Homepage", "Lumen — Pricing". NEVER `"UiChemy AI Landing Page"`. |
| **Style direction** | One sentence: typography family hint, palette hint, tone (e.g. "modern dark technical, Inter + Geist Mono, teal accent on near-black"). Pick something sensible — do not ask the user. |
| **Section plan** | See below. |

**Default section plan for any "build me a site" prompt** — six to eight sections, ALWAYS starting with Header and ending with Footer:

```
🧩 SECTION PLAN — "Docker — Service Design"
   1. Header   — logo + nav + CTA
   2. Hero     — headline + sub + 2 CTAs
   3. Features — 3 to 6 capability cards
   4. How it works — 3-step process or pipeline diagram
   5. Social proof — logos OR a testimonial block
   6. Pricing  — 2 to 3 tiers (skip if the brief implies "no pricing")
   7. CTA banner — single conversion block
   8. Footer   — links + small copyright
→ Mode: MULTI-WIDGET (N sections)
```

Adjust the body sections to fit the brief (a portfolio doesn't have pricing, a blog homepage swaps Pricing for "Latest posts" — use judgment). **Header is section 1, Footer is the last section. Never optional.** Print the section-plan block to the user before any tool calls.

---

## Step 2 — Site readiness

Call `uichemy-composer/describe-site` once. **Everything below lives inside the response's `platform` object** —
read `platform.checks.elementor_active`, not `platform.checks.elementor_active`. A path read at the wrong
level comes back undefined, and an undefined `elementor_active` is falsy, which would abort the
build on a site where Elementor is running perfectly well.

- `platform.checks.elementor_active` — if false, STOP and tell the user to activate Elementor.
- `platform.header_footer_system` — informational only; do NOT reveal this value or name the specific competing plugin to the user. Header/Footer always go through UiChemy's native Theme Builder, site-wide, regardless of this value.
- `platform.checks.has_nav_menu` — if false, call `uichemy-composer/platform (action="update-menu")` now (the Header you're about to build uses `<uichemy-nav-menu>`, which renders empty without an assigned menu).
- `platform.active_header[]` / `platform.active_footer[]` — if non-empty, mention to the user that you'll be replacing them when your new templates publish.

Print one compact line, then move on:

```
⚙️  SITE READY — nav=✅ · existing header/footer will be replaced
```

---

## Step 3 — Pick a palette + type scale, then write it to the design system

Globals sync is ON. Pick a small design system once, write it into the `#uichemy-globals` CSS
block, and then reference it as globals everywhere — so the whole site stays editable from the
Composer's Globals manager.

**3a — Pick the tokens (once):**

- **Palette** — 4 to 6 colors as hex (`#0A0F1E`, `#22D3EE`, `#E5E7EB`, …). Pick: brand, accent, ink-1, ink-2, surface, border. Give each a clear, stable name.
- **Type scale** — 4 to 6 typography combos `{family, weight, size, line-height, letter-spacing}` (e.g. `Inter / 700 / 48px / 1.1em / -0.02em` for H1). Name each by role (Heading H1, Heading H2, Body, Button, …).
- **Content width** — pick one boxed width in px for the page (e.g. `1280`).

**3b — Read the current block, then write:**

1. `uichemy-composer/design-system (action="get")` once → note any existing vars/classes.
2. If the block is EMPTY (a fresh site, the usual case here) build the complete block and call
   `uichemy-composer/design-system (action="set")`. If it already has content, do NOT rewrite it wholesale — add your tokens
   with `uichemy-composer/design-system (action="patch")` instead, anchoring on a line you keep (find `:root {`, replace with
   `:root {` plus your new vars). Anything omitted from a `uichemy-composer/design-system (action="set")` payload is deleted,
   and the user's existing tokens are exactly what you must not drop.

```css
:root {
  /* Colors */
  --brand: #0A0F1E;
  --accent: #22D3EE;
  ...

  /* Fonts */
  --font-heading: Inter, sans-serif;
  --font-body: Inter, sans-serif;

  /* Layout */
  --content-width: 1280px;
}

/* Typography classes */
.text-heading-h1 { font-family: var(--font-heading); font-size: 48px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; }
...

/* Layout classes */
.pr-boxed { max-width: var(--content-width); margin-left: auto; margin-right: auto; }
```

Plain CSS only — no ids, no `typography_*` schema, no atomic/standard split. Stable names —
never rename an entry already in the block.

Print one line: `📋 Design system: N colors · M typography · content width 1280px`, then after the call `✅ Saved: N colors · M typography · content width 1280px`.

**3c — Build lookup tables from the block you just wrote** (do NOT call `uichemy-composer/design-system (action="get")` again):

```js
colorLookup["#22d3ee"] = "var(--accent)"
typoLookup["Inter|700|48"] = "text-heading-h1"
```

Color key = lowercase 6-digit hex. Typo key = `"Family|Weight|RoundedSizePx"`. Record every font family+weight for the Google Fonts `<link>` (loaded once via `site_before_head` on the first upload).

**Before you emit that `<link>` — or any `<style>`, `<script>` or `<meta>` — read the scope rubric
once:** `uichemy-composer/read-skill` with `{ name: "brief-to-wordpress", part: "scope-decision" }`.
It covers site-wide vs page-level, and when shared CSS/JS should become a real file instead of
inline code.

Now go to Step 4 and apply these lookups.

---

## Step 4 — Build the site (atomic per-section loop)

For each section in your plan, do generate → upload in one shot. Don't pre-write all sections then upload — go one by one so an error in section 4 doesn't waste sections 5–8.

### Per-section log (print before each upload)

```
🔨  Generating section N/T: <Label>
🛡️  Section N/T: PASS
⬆️  Uploading section N/T: <Label>
✅  Section N/T uploaded (post_id=…)
```

### HTML rules — every section

- Root: `<div class="uichemy-{slug}-{index}">` where slug = kebab-case label, index = 1-based.
- Semantic HTML5: `<nav>`, `<section>`, `<ul>`, `<button>`, `<a>` — BEM class names for children.
- BEM class names for children. **Append the matched typography class** (from `typoLookup`, e.g. `text-heading-h1`) alongside the BEM class on each text element — never replace BEM. Text whose style isn't in `typoLookup` → BEM only, style it inline in CSS.
- **Real text content from your brief — never lorem ipsum.** Make up plausible product copy that fits the brand and topic.
- **Images** — see Step 5 for the upload flow. Never use `data:` URIs, `blob:` URIs, `/local/paths.png`, or made-up URLs like `https://example.com/hero.png`. Either go through `uichemy-composer/media (action="request-upload")`, OR omit the `<img>` and use a CSS-only visual.
- **Header specifics:** root stays `<div>` (NOT `<header>`). Use `<uichemy-site-logo class="..." />` for the brand mark, `<uichemy-nav-menu class="..." role="navigation">` for the menu (the template engine renders the WP menu — do NOT hardcode `<li>` items). Pattern:

  ```html
  <uichemy-nav-menu class="hdr__nav" role="navigation" aria-label="Main navigation">
    <li for="nav_item in nav_menu" class="hdr__nav-item">
      {nav_item}
      <ul if="sub_items in nav_item" class="hdr__dropdown">
        <li for="sub_item in nav_item.sub_items" class="hdr__dropdown-item">{sub_item}</li>
      </ul>
    </li>
  </uichemy-nav-menu>
  ```

  The renderer injects a bare `<ul>`: `<uichemy-nav-menu class="hdr__nav">` becomes `<nav class="hdr__nav"><ul><li class="hdr__nav-item">…</li></ul></nav>`, and that `<ul>` has **no class**. Put the menu's row layout on `.hdr__nav > ul` (`display:flex; gap; list-style:none; margin:0; padding:0`), **not** on `.hdr__nav` — flex on the nav only lays out its single `<ul>` child, so the items stack.

### CSS rules — every section

- Scope every rule under `.uichemy-{slug}-{index}`. No `@import`, no `<link>` in widget CSS (use `site_before_head` for Google Fonts, once, on the first upload).
- **Colors — use globals.** Any color in `colorLookup` → `var(--name)`. Color NOT in the lookup → raw hex + `/* untracked: #hex */`. `rgba(…, α<1)` stays raw inline.
- **Typography — matched elements carry NO font shorthand.** If a text element's style is in `typoLookup`, attach its `.text-*` class (Step 4 HTML rules) and DO NOT write `font-family` / `font-weight` / `font-size` / `line-height` / `letter-spacing` in its CSS rule — the global class supplies them. Unmatched text → full font shorthand inline as usual.
- **Content width — use `.pr-boxed`, don't hardcode.** You wrote `--content-width` into the design system, so add `.pr-boxed` on the inner container instead of a `max-width`. Never write `max-width` on a boxed wrapper — the class supplies it.
  ```html
  <div class="{block}__container pr-boxed"></div>
  ```
- Always include:
  ```css
  *, *::before, *::after { box-sizing: border-box; }
  img, video, iframe { max-width: 100%; }
  .uichemy-{slug}-{index} { width: 100%; max-width: 100%; overflow-x: clip; }
  .uichemy-{slug}-{index} * { min-width: 0; }
  ```
- Three breakpoints, all non-empty:
  ```css
  @media (max-width: 1024px) { /* tablet */ }
  @media (max-width: 768px)  { /* mobile */ }
  @media (max-width: 480px)  { /* small mobile */ }
  ```
- **Inner container spacing — the widget owns it.** Use `padding-inline: clamp(16px, 5vw, {target}px)` on the section's inner container. The outer Elementor container is already `padding=0, margin=0, gap=0` — do not compensate for it.

### JS rules

- No `<script>` tags in HTML. Bare JS only, wrapped:
  ```js
  (function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', function () {
      var root = document.querySelector('.uichemy-{slug}-{index}');
      if (!root) return;
      // queries via root.querySelector*()
    });
  })();
  ```
- Static section → `js: ""`

- **Repeating the same behaviour in section after section?** Once one reveal/animation/utility
  system is carried by three or more sections, stop copying it into each widget: put it in a
  code file with `uichemy-composer/code-file` and load it once from site or page code. Anything
  a single section owns still belongs to that section..

### Build order — Header and Footer via UiChemy's native Theme Builder

`uichemy-composer/template (action="create", type="header"|"footer")` is UiChemy's native Theme Builder engine — it works on ANY Elementor (Pro/Nexter NOT required) and activates site-wide immediately on creation. `platform.header_footer_system` from Step 2 is informational only; do not branch on it, and do not silently fall back to inlining the header/footer into the page unless the user has explicitly asked for page-only placement.

```
1. uichemy-composer/template (action="create") { type:"header", title:"<Brand> Header", html, css, js,
                                           site_before_head:"<Google Fonts links — only on this first call>",
                                           upload_images:true }
2. uichemy-composer/page (action="create") { title:"<Brand> — <Page kind>", status:"draft", label:"<first body label>",
                                  html, css, js, upload_images:true }       ← FIRST body section only
3. uichemy-composer/page (action="append-section") { post_id, label, html, css, js, upload_images:true }
                                                                              ← repeat once per remaining body section
4. uichemy-composer/template (action="create") { type:"footer", title:"<Brand> Footer", html, css, js,
                                           upload_images:true }
```

Header/Footer NEVER go through `uichemy-composer/page (action="create")` — that creates a body section, not a theme-builder template, and the live site keeps its old header/footer. Confirm each header_footer response has `active:true` and `system:"uichemy_native"`.

**Page-only exception** — only if the user explicitly asked for page-only placement, embed the Header and Footer as the first and last sections inside the page itself instead, and skip `uichemy-composer/template (action="create", type="header"|"footer")` entirely:

```
1. uichemy-composer/page (action="create") { title:"<Brand> — <Page kind>", status:"draft", label:"Header",
                                  html, css, js,
                                  site_before_head:"<Google Fonts — only on this first call>",
                                  upload_images:true }                      ← HEADER as section 1
2. uichemy-composer/page (action="append-section") { post_id, label:"<body label>", html, css, js, upload_images:true }
                                                                              ← repeat once per body section (Hero, Features, …)
3. uichemy-composer/page (action="append-section") { post_id, label:"Footer", html, css, js, upload_images:true }
                                                                              ← FOOTER as the LAST section
```

Tell the user during the summary (Step 7) which path you took: `"theme-builder header+footer"` (default), or `"inline header+footer (page-only, per user request)"`.

Save from each response: `post_id` (after the very first call — reuse in every subsequent `uichemy-composer/page (action="append-section")`), `active`, `preview_link`.

---

## Step 5 — Images: the only correct way to inject one

The upload abilities sideload `<img src="…">` by **fetching the URL over HTTP from the WP server.** They cannot read `data:` URIs, `blob:` URIs, local paths, or any URL the server cannot reach. So when the brief implies an image (hero illustration, feature icon, screenshot) you have three options:

1. **CSS-only** — gradient + shape + maybe an SVG inline in the HTML. Best for backgrounds and abstract visuals.
2. **External public URL** — only if you actually have a known-good HTTPS URL the WP server can reach. Most placeholder/CDN services count, but you cannot invent one — if you're guessing, don't use it.
3. **Generate + upload via `uichemy-composer/media (action="request-upload")`** — if you have access to an image-generation model + a bash tool:
   1. Generate the image, save it to a local path.
   2. Call `uichemy-composer/media (action="request-upload") { ttl_minutes }` **once for the whole build** → response contains `slot_url`, `request_header`, `usage_example`, `batch_usage_example`, `expiry`.
   3. Run `batch_usage_example` via bash as ONE command: it loops over every file with `--data-binary @…`. Do NOT call the ability again per image.
   4. Pass `filename` and `alt` as URL-encoded query params on each upload; `alt` is stored during the upload, so it needs no follow-up call.
   5. Read each upload response → use the returned `url` in your `<img src="…">`. One slot serves the whole build.

Default to option 1 (CSS-only) unless the brief specifically needs a photo/screenshot you can actually produce. Never embed `data:`, `blob:`, or invented URLs.

---

## Step 6 — Verification before each upload

Before each `create_*` / `add_*` call, do a quick PASS check:

- Scope: every CSS rule under `.uichemy-{slug}-{index}`.
- Images: no `data:` / `blob:` / local paths / invented URLs.
- Responsive: tablet, mobile, and small-mobile blocks all non-empty.
- Typography: matched text elements carry their `typoLookup` class and NO font shorthand in CSS; unmatched text has full font-family / weight / size / line-height inline.
- Colors: every color in `colorLookup` uses `var(--name)`; only untracked colors are raw hex.
- Header/Footer are separate Theme Builder templates by default (not part of the page), unless the page-only exception applies. Footer at the end. Real content (no lorem).

If everything passes → print `🛡️  Section N/T: PASS` and call the upload ability. If anything fails → fix and re-check before uploading. Don't ship FAILing sections.

---

## Step 7 — Final summary

**Before you print it, run `uichemy-composer/audit`** with `action: "run"` (pass `post_id` to also check this page), if that ability is in your list. It looks for what a build most commonly leaves broken and cannot see from inside the loop: an empty design system, no site logo or tagline, a nav menu with no theme location, theme-builder templates with no display conditions (they render nowhere), forms with no recipient, images with no alt text. Every finding carries a severity and names the ability that fixes it. Fix the blockers before you summarise, and state any warning you chose to leave rather than letting the user discover it.

**Asset manifest.** Every `create_*` / `add_*` response carries an `image_failures` array — each
entry `{ from, error, code, source }` is media the server could not fetch. Collect them across all
uploads, dedupe by `from`, and if any remain, say so rather than leaving a broken image for the
user to find:

```
⚠️  Couldn't import N asset(s) — these still point at unreachable URLs:
    • https://cdn.x/y.png   → fetch failed (403)
    Fix: give me a public URL, or I'll swap in a CSS-only visual.
```

When the loop ends, print one summary block to the user:

```
✅  Site built — "<Page title>"
    Header:  post_id=… · system=<system> · active=<true|false>
    Page:    post_id=… · preview=<preview_link>
    Footer:  post_id=… · system=<system> · active=<true|false>
    Sections uploaded: N
    Open the page link to preview. Header/footer are live across the site.
```

---

## Anti-patterns — do not do these

- Skipping Header or Footer because the user didn't say "header".
- Putting nav/logo/footer HTML inside `uichemy-composer/page (action="create")` instead of `uichemy-composer/template (action="create", type="header"|"footer")` — UiChemy's native Theme Builder handles it site-wide regardless of `platform.header_footer_system`.
- Naming the specific competing theme-builder plugin (Elementor Pro / Nexter) to the user — coexistence should be mentioned generically only.
- Default-naming pages `"UiChemy AI Landing Page"` or templates `"Header — UiChemy"`.
- Lorem ipsum text. Use real brand-appropriate copy.
- `<img src="https://example.com/something-i-just-invented.png">`.
- Compensating for kit-inherited container padding in widget CSS (the outer container is already zeroed).
- Writing huge HTML blocks to chat instead of calling the upload abilities.
