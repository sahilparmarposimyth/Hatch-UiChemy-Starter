# UiChemy Site Build — Code Input Pipeline (HTML / CSS / JS)

You were called because the user gave you **existing front-end code** — pasted HTML/CSS/JS in chat, a single `.html` file, or a local project folder — and wants it turned into a real WordPress page built out of Composer (UiChemy Composer) widgets. There is **no Figma URL** here. Unlike the `brief-to-wordpress` pipeline (which invents a design from a one-line brief), your source of truth is **the code the user provided** — reproduce it faithfully, then adapt it to Composer conventions. Do NOT redesign it, restyle it, or "improve" it unless the user explicitly asked.

---

## Step 0 — Read this first

You are NOT pasting the user's code back into chat. Every section of their markup ends up as a real Elementor template on their WordPress site, via these abilities:

- `uichemy-composer/describe-site` — site readiness (call once, first)
- `uichemy-composer/design-system (action="get")` / `uichemy-composer/design-system (action="set")` — read/write the source's palette + type scale as the site's design-system CSS block (`#uichemy-globals`)
- `uichemy-composer/template (action="create") { type:"header"|"footer", ... }` — Header / Footer via UiChemy's native Theme Builder (works on ANY Elementor, Pro/Nexter NOT required); site-wide by default, page-only only on explicit user request; see Build order
- `uichemy-composer/page (action="create") { ... }` — first body section, creates the page
- `uichemy-composer/page (action="append-section") { post_id, ... }` — every subsequent body section
- `uichemy-composer/media (action="request-upload") { filename, mime }` — upload local media (images, SVG, or mp4/webm/ogg/mov video) so `<img src>` / `<video src>` becomes a real URL
- `uichemy-composer/code-file` — store a .css/.js file the source ships (a vendor library, one stylesheet several sections share) and reference it by URL instead of inlining it into every widget. Not for section-specific code, which stays in the section.

**Globals sync is ON for this build.** Fidelity still comes first — you keep the source's exact colors and fonts — but instead of scattering raw values, you write the source's own palette + type scale into the `#uichemy-globals` CSS block (Step 3) and then reference them as globals (`var(--name)` / matched `.text-*` class). Same pixels on screen, but now editable from the Composer's Globals manager. See Step 3 to write, Step 4 to apply.

If you feel the urge to print the converted HTML in chat instead of calling these abilities — stop. The user wants a built page, not a code dump.

---

## Step 1 — Ingest the source code (this is your design)

Where the code lives determines how you read it:

| Source | How to load it |
|---|---|
| **Pasted in chat** (`source_html` / `source_css` / `source_js`) | Already in the tool arguments / conversation. Use it directly. |
| **Local folder or file** (`project_path`) | Use the **Read tool** (never Bash `cat`/`head`) to open the entry HTML (`index.html`, or the file named), then any linked `.css` / `.js` files it references. Read images' filenames but not their bytes. |

**Loading rules:**
- Read the **entire** HTML, plus every stylesheet and script it links (`<link rel="stylesheet">`, `<script src>`). Inline `<style>` / `<script>` blocks count too.
- If `project_path` points at a folder, list it first (Read tool on the dir, or check the provided file tree) and load the entry document + its local assets. Ignore `node_modules`, build output, and vendored libraries unless the design depends on them.
- Preserve the source's **text content, colors, fonts, spacing, and layout exactly.** This is a conversion, not a rewrite.
- Note any external resources the markup depends on: Google Fonts `<link>`s, CDN icon fonts, background images, `<img>` sources. You'll re-home these in later steps.

Print one compact line confirming what you ingested, then move on:

```
📥  Ingested source: 1 HTML doc · 2 CSS files · 1 JS file · 6 images · fonts: Inter, Geist Mono
```

---

## Step 1.5 — Split the markup into sections

Composer builds a page as an **ordered list of section widgets**, so slice the user's document into logical sections — the same Header → body → Footer shape as every UiChemy build:

- Split on top-level landmarks in document order: `<header>`, each top-level `<section>` / `<div class="...">` band, `<footer>`. One visual band = one section.
- If the source is a single flat blob with no landmarks, segment it by visual role (hero, features, testimonials, pricing, CTA, …) using headings and background changes as boundaries.
- **Header is section 1, Footer is the last section.** If the source has no header/footer, tell the user and proceed with what exists — do NOT invent a header/footer that wasn't in their code (that is the `brief-to-wordpress` pipeline's job, not this one).

Print the plan before any tool calls:

```
🧩 SECTION PLAN — from provided code
   1. Header    — logo + nav + CTA        (from <header>)
   2. Hero      — headline + sub + CTA     (from <section class="hero">)
   3. Features  — 4 cards                  (from <section class="features">)
   4. Pricing   — 3 tiers                  (from <section id="pricing">)
   5. Footer    — links + copyright        (from <footer>)
→ Mode: MULTI-WIDGET (5 sections)   ·   single-section source → SINGLE-WIDGET
```

If the source is genuinely one component (a single card, one hero), it's fine to build it as a single `uichemy-composer/page (action="create")` widget — say so in the plan.

---

## Step 2 — Site readiness

Call `uichemy-composer/describe-site` once. Store from the response:

- `platform.checks.elementor_active` — if false, STOP and tell the user to activate Elementor.
- `platform.checks.elementor_pro_active` + `platform.checks.nexter_extension` — informational only; UiChemy's native Theme Builder works site-wide on ANY Elementor without either of these, so they no longer gate Step 2.5's question. If one IS active, mention the coexistence note in Step 2.5.
- `platform.header_footer_system` — informational detection only (`elementor_pro` / `nexter` / `elementor`); NOT a routing switch, do not branch on it.
- `platform.checks.has_nav_menu` — relevant only if Step 2.5 ends up `hf_placement = "site"`: if the source Header has a real navigation and this is false, call `uichemy-composer/platform (action="update-menu")` now (the `<uichemy-nav-menu>` you'll swap in renders empty without an assigned menu). Not needed for `hf_placement = "page"` — that path keeps the source's literal `<li>` items, no WP menu involved.
- `platform.active_header[]` / `platform.active_footer[]` — now includes UiChemy's own native templates too. If non-empty and you're about to build a header/footer, mention you'll be replacing the existing one (UiChemy keeps only one active template per type).

Print one compact line, then move on:

```
⚙️  SITE READY — nav=✅ · existing header will be replaced
```

---

## Step 2.5 — MANDATORY: ask the user where Header & Footer go

If the source has a Header and/or Footer (per Step 1.5), you **MUST stop and ask the user** exactly two options before doing anything else:

1. **Entire site** — Header/Footer become a site-wide template via UiChemy's own native Theme Builder. Works on ANY Elementor (free included) — no Elementor Pro or Nexter required. Every page on the site gets this Header/Footer, live immediately.
2. **This page only** — Header/Footer are converted as regular sections inside this one page. Nothing else on the site changes.

**This question is NOT optional and NOT skippable, and it has NO exception** — UiChemy's native engine always supports the "Entire site" option, regardless of what `platform.header_footer_system` reports. Do not infer the answer from the user's original wording, do not assume "entire site" because that's the recommended default, and do not silently proceed with either path — always ask and WAIT for the reply before Step 3/4 build calls involving the header/footer. Body-only sections (no header/footer in the source) are unaffected — proceed normally if the source has neither.

If `platform.active_header[]` / `platform.active_footer[]` from Step 2 already has an entry, mention in the same message that choosing "Entire site" will replace it (UiChemy keeps only one active template per type).

Ask:

```
🧭 Header/Footer ko site ke Entire site pe set karna hai ya sirf is Page tak?
   1. Entire site (Recommended) — UiChemy Theme Builder, har page pe active
   2. Page only — sirf is page ke first/last section ke roop mein
```

Store the answer as `hf_placement` (`"site"` | `"page"`). No further follow-up question is needed — `uichemy-composer/template (action="create", type="header"|"footer")` does not require choosing between Elementor Pro / Nexter / native; it is always native UiChemy. If `platform.checks.elementor_pro_active` or `platform.checks.nexter_extension` is also true, mention ONCE, generically, that another active template system was detected on this site and the two will coexist — do NOT name the specific competing plugin to the user.

---

## Step 3 — Lift the palette + type scale FROM the source, then write it to the design system

Globals sync is ON. First **extract** the design tokens already present in the user's code (do not invent — fidelity comes first), then write those exact values into the `#uichemy-globals` CSS block so they become editable globals.

**3a — Extract from the source (verbatim):**

- **Palette** — collect the hex / rgb(a) colors the source actually uses (brand, accent, ink, surface, border). Keep them verbatim — do not swap them for a palette you prefer.
- **Type scale** — collect the `font-family` / `font-weight` / `font-size` / `line-height` / `letter-spacing` combos the source uses per heading/body level. Keep them verbatim.
- **Content width** — the source's own boxed max-width (e.g. `1200`).
- **Resolve the source's own custom properties.** If the source uses `:root { --brand: #22D3EE }` + `var(--brand)`, resolve `--brand` to its raw hex first — you'll re-map it to a *design-system* global in 3b, not the source's `--brand` (which won't exist on the WP page).
- **Fonts** — note every font family + weight referenced. If loaded via a Google Fonts `<link>` / `@import`, re-add it once via `site_before_head` on the first upload (Step 4). Local/self-hosted font → fall back to the nearest Google Font and tell the user.

**3b — Read the current block, then write:**

1. `uichemy-composer/design-system (action="get")` once → note any existing vars/classes.
2. If the block is EMPTY, build the complete block and call `uichemy-composer/design-system (action="set")`. If it already has content, ADD to it with `uichemy-composer/design-system (action="patch")` instead — anchor on a line you keep (find `:root {`, replace with `:root {` plus the source's new vars). Anything omitted from a `set` payload is deleted, so `set` on a populated block risks dropping tokens the user already depends on; `patch` cannot. Either way the shape is:

```css
:root {
  /* Colors */
  --accent: #22D3EE;
  ...

  /* Fonts */
  --font-heading: Inter, sans-serif;
  ...

  /* Layout */
  --content-width: 1200px;
}

/* Typography classes */
.text-heading-h1 { font-family: var(--font-heading); font-size: 48px; font-weight: 700; line-height: 1.1; }

/* Layout classes */
.pr-boxed { max-width: var(--content-width); margin-left: auto; margin-right: auto; }
```

Plain CSS only — no ids, no `typography_*` schema, no atomic/standard split. Stable names —
never rename an entry already in the block.

Print `📋 Design system: N colors · M typography · content width Xpx`, then after the call `✅ Saved: N colors · M typography · content width Xpx`.

**3c — Build lookup tables from the block you just wrote** (do NOT call `uichemy-composer/design-system (action="get")` again):

```js
colorLookup["#22d3ee"] = "var(--accent)"
typoLookup["Inter|700|48"] = "text-heading-h1"
```

Color key = lowercase 6-digit hex. Typo key = `"Family|Weight|RoundedSizePx"`. These lookups are how you keep the source's exact look while pointing at editable globals in Step 4.

---

## Step 4 — Convert each section to a Composer widget (atomic per-section loop)

For each section in your plan, do convert → verify → upload in one shot. Go one by one so an error in section 4 doesn't waste sections 5+.

### Per-section log (print before each upload)

```
🔧  Converting section N/T: <Label>
🛡️  Section N/T: PASS
⬆️  Uploading section N/T: <Label>
✅  Section N/T uploaded (post_id=…)
```

### HTML conversion rules — every section

- **Root:** wrap the section in `<div class="uichemy-{slug}-{index}">` where slug = kebab-case label, index = 1-based. If the source used `<section>` / `<header>` / `<footer>` as its outer tag, you may keep an inner semantic tag, but the widget's outermost element is a `<div>` with the scope class (the Header root MUST be a `<div>`, never `<header>`).
- **Preserve the source's inner structure and copy verbatim** — same headings, same body text, same order, same links. Do not paraphrase or shorten the user's content.
- **Rename classes to be scoped + collision-safe.** The source's global class names (`.container`, `.btn`, `.row`) can clash with theme/Elementor CSS. Re-namespace children under the section (BEM-style: `.uichemy-hero-2__title`, `.uichemy-hero-2__cta`) and update the matching CSS selectors. Keep the mapping 1:1 so nothing visual changes.
- **Append the matched typography class** from `typoLookup` (e.g. `text-heading-h1`) alongside the section's BEM class on each text element (never replace BEM). Text whose style isn't in `typoLookup` → BEM only, styled inline in CSS.
- **Header specifics — branch on `hf_placement` from Step 2.5:**

  - **`hf_placement = "site"`** (site-wide Theme Builder template): if the source header has a logo, replace the `<img>`/text logo with `<uichemy-site-logo class="..." />`. If it has a real nav list, replace the hardcoded `<ul><li>` with `<uichemy-nav-menu>` (the template engine renders the WP menu — do NOT keep hardcoded `<li>` items):

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

    Keep the source's nav styling so the menu still looks the same, but mind the rendered DOM: `<uichemy-nav-menu class="hdr__nav">` becomes `<nav class="hdr__nav"><ul><li class="hdr__nav-item">…</li></ul></nav>`, and that `<ul>` is auto-injected with **no class**. Move the source's horizontal/row layout (`display:flex`, `gap`, `list-style:none`) onto `.hdr__nav > ul`, **not** `.hdr__nav` — flex on the nav only lays out its single `<ul>` child, so the items would stack. This binding makes sense here because the template renders on every page site-wide, so it should track the site's real WP menu/logo rather than a frozen snapshot.

  - **`hf_placement = "page"`** (this page only): do **NOT** swap in `<uichemy-site-logo>` or `<uichemy-nav-menu>`. This is a one-off, static section — convert the header **exactly as given**: keep the source's literal `<img>`/text logo and literal `<ul><li>` nav items verbatim, same hrefs, same labels, same order. No dynamic tags, no WP-menu binding. Treat it like any other body section under the general "preserve the source's inner structure and copy verbatim" rule above.
- **Images** — see Step 5. Never keep `data:` URIs, `blob:` URIs, local `./img/x.png` paths, or unreachable URLs in the final `<img src>`. Either re-home local images through `uichemy-composer/media (action="request-upload")`, keep an already-public HTTPS URL the source used, or convert a purely decorative image to the CSS-only equivalent the source implied.
- **Strip document chrome:** drop `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, `<meta>`, `<title>` — a widget is body-level markup only. `<head>` contents (font links, favicons) are handled via `site_before_head` (fonts) or dropped (favicons/meta).

### CSS conversion rules — every section

Before the first `<link>`/`<style>`/`<script>`/`<meta>` you emit, read the scope rubric once:
`uichemy-composer/read-skill` with `{ name: "code-to-wordpress", part: "scope-decision" }`. It covers
site-wide vs page-level, and when shared CSS/JS should become a real file rather than inline code.

- **Scope every rule under `.uichemy-{slug}-{index}`.** Prefix the source's selectors so they only apply inside this widget. Global resets the source did on `body` / `html` / `*` become scoped resets (see the required block below). No `@import`, no `<link>` in widget CSS — Google Fonts go through `site_before_head` once on the first upload.
 - **A vendor or framework stylesheet the source links** (Bootstrap, a Tailwind build, an icon font such as Font Awesome) must NOT be scope-rewritten into every section - it expects to be global and unscoped, and scoping it is what breaks it. Upload it as a code file and reference it with a `<link>`; the `scope-decision` part carries the rubric and the upload flow. An icon font also needs its `.woff2` / `.ttf` uploaded through `uichemy-composer/media`, or every glyph renders as a box. If `uichemy-composer/code-file` is not in your ability list, reproduce only the rules the sections actually use and tell the user what you left out.
- **Colors — map the source's colors to design-system globals.** Each source color that's in `colorLookup` → `var(--name)`. Same color on screen, now a global. A source color NOT in the lookup (a one-off) → keep the raw hex + `/* untracked: #hex */`. `rgba(…, α<1)` stays raw inline. Resolve any source `var(--…)` to its hex first, then map that hex through `colorLookup`.
- **Typography — matched elements carry NO font shorthand.** If a text element's style is in `typoLookup`, attach its `.text-*` class (HTML rules above) and DO NOT write `font-family` / `font-weight` / `font-size` / `line-height` / `letter-spacing` in its CSS rule — the global class supplies them (this reproduces the source's exact type). Unmatched text → full font shorthand inline.
- **Content width — use `.pr-boxed`, don't hardcode.** You wrote the source's max-width as `--content-width`, so add the `.pr-boxed` class on the inner container instead of a `max-width`. Never write `max-width` on a boxed wrapper — the class supplies it.
- Always include the safety block (adapt the source's own reset into it):
  ```css
  *, *::before, *::after { box-sizing: border-box; }
  img, video, iframe { max-width: 100%; }
  .uichemy-{slug}-{index} { width: 100%; max-width: 100%; overflow-x: clip; }
  .uichemy-{slug}-{index} * { min-width: 0; }
  ```
- **Responsive:** keep the source's existing media queries (re-scoped). If the source had none, add the three standard breakpoints, all non-empty:
  ```css
  @media (max-width: 1024px) { /* tablet */ }
  @media (max-width: 768px)  { /* mobile */ }
  @media (max-width: 480px)  { /* small mobile */ }
  ```
- **Inner container spacing — the widget owns it.** Move the section's horizontal padding onto its inner container (`padding-inline: clamp(16px, 5vw, {target}px)` or the source's own value). The outer Elementor container is already `padding=0, margin=0, gap=0` — do not compensate for it.

### JS conversion rules

- **No `<script>` tags in HTML.** Take the source's JS for this section, keep its behavior, and hand it over as bare JS wrapped + scoped to the section root:
  ```js
  (function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', function () {
      var root = document.querySelector('.uichemy-{slug}-{index}');
      if (!root) return;
      // source behavior, re-scoped: query via root.querySelector*()
    });
  })();
  ```
- Rewrite global `document.querySelector` calls that target this section to go through `root` so multiple widgets don't collide.
- If the source depends on a **heavy** external JS library (Swiper, Lottie, full GSAP timelines, jQuery), tell the user it needs to be enqueued separately. Do NOT paste a CDN `<script>` into the widget. But a **small** effect (fade-in-on-scroll, parallax, count-up, marquee) is a few lines of vanilla — reimplement it, don't drop it (see "Page-global visuals" below for effects that span the whole page).
 - **That heavy library is not a dead end.** Upload the vendor `.js` from the project folder as a code file and reference it with a `<script src>`, loaded BEFORE the section JS that depends on it; the `scope-decision` part carries the rubric and the upload flow. If `uichemy-composer/code-file` is not in your ability list, fall back to asking the user to enqueue it.
- Section with no JS → `js: ""`.

### Page-global visuals & behaviour (ambient backgrounds, scroll-reveal)

Some effects belong to the WHOLE page, not one section — a **fixed ambient background** (aurora / gradient glow / floating orbs behind every section) or a single **on-scroll reveal** that fades sections in as you scroll. Per-section scope has no home for these, so they used to be dropped (sections went flat / appeared instantly). Route them through the page-shell lanes instead — do NOT omit them and do NOT silently flatten them. Send `page_before_head` / `page_before_body` on the **first upload of the page only** (they merge into the first widget; never re-send on sections 2+).

- **Fixed ambient background** → layer CSS + keyframes in `page_before_head` (one `<style>`), the layer element in `page_before_body`, fixed and behind everything:
  ```html
  <!-- page_before_body -->
  <div class="pr-aurora" aria-hidden="true"></div>
  ```
  ```css
  /* page_before_head */
  .pr-aurora{position:fixed;inset:0;z-index:-1;pointer-events:none;
    background:radial-gradient(/* source's exact colours */);
    animation:pr-aurora-drift 18s ease-in-out infinite}
  @keyframes pr-aurora-drift{/* source's exact keyframes */}
  ```
  `position:fixed; z-index:-1` puts it behind every section without touching any single widget. Keep the source's exact colours/timing.

- **Page-level scroll-reveal** → reimplement as ONE dependency-free vanilla `IntersectionObserver` in `page_before_body`; add the source's `data-reveal` attribute onto section elements as you convert each section; put the transition CSS in `page_before_head` so it applies across every section:
  ```html
  <!-- page_before_body -->
  <script>
  (function(){var els=document.querySelectorAll('[data-reveal]');
    if(!('IntersectionObserver' in window)||!els.length){els.forEach(function(el){el.classList.add('is-revealed');});return;}
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-revealed');io.unobserve(e.target);}});},{threshold:0.12});
    els.forEach(function(el){io.observe(el);});})();
  </script>
  ```
  ```css
  /* page_before_head */
  [data-reveal]{opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease}
  [data-reveal].is-revealed{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){[data-reveal]{opacity:1;transform:none;transition:none}}
  ```

- **Capability note:** page-level `<style>`/`<script>` render only for a page author WordPress trusts with raw code (`unfiltered_html` — administrators). If the importing user is not an admin these are `wp_kses_post()`-stripped on output — say so in the Step 7 summary so the user knows why ambient/reveal effects didn't appear.

### Build order — branch on the user's Step 2.5 answer (`hf_placement`)

Step 2.5 is mandatory when the source has a header/footer, so by this point you already have `hf_placement` (`"site"` | `"page"`). Branch on THAT, never on `platform.header_footer_system`, and never guess or skip ahead.

#### Case A — `hf_placement` is `"site"` (native Theme Builder path)

No `system` argument needed — `uichemy-composer/template (action="create", type="header"|"footer")` is always UiChemy's native engine (the `system` argument on this ability is deprecated/ignored):

```
1. uichemy-composer/template (action="create") { type:"header",
                                           title:"<Brand> Header", html, css, js,
                                           site_before_head:"<Google Fonts links from the source — only on this first call>",
                                           upload_images:true }
2. uichemy-composer/page (action="create") { title:"<Page title>", status:"draft", label:"<first body label>",
                                  html, css, js, upload_images:true }       ← FIRST body section only
3. uichemy-composer/page (action="append-section") { post_id, label, html, css, js, upload_images:true }
                                                                              ← repeat once per remaining body section
4. uichemy-composer/template (action="create") { type:"footer",
                                           title:"<Brand> Footer", html, css, js,
                                           upload_images:true }
```

Header/Footer NEVER go through `uichemy-composer/page (action="create")` here. Confirm each response has `active:true` and `system:"uichemy_native"`.

#### Case B — `hf_placement` is `"page"` (in-page path)

The user explicitly chose page-only. Embed the Header and Footer as the first and last sections of the page itself:

```
1. uichemy-composer/page (action="create") { title:"<Page title>", status:"draft", label:"Header",
                                  html, css, js,
                                  site_before_head:"<Google Fonts from the source — only on this first call>",
                                  upload_images:true }                      ← HEADER as section 1
2. uichemy-composer/page (action="append-section") { post_id, label:"<body label>", html, css, js, upload_images:true }
                                                                              ← repeat per body section
3. uichemy-composer/page (action="append-section") { post_id, label:"Footer", html, css, js, upload_images:true }
                                                                              ← FOOTER as the LAST section
```

Skip `uichemy-composer/template (action="create", type="header"|"footer")` entirely in this case. (If the source had no header/footer at all, just build the body sections in order.)

Save from each response: `post_id` (after the first call — reuse it in every subsequent `uichemy-composer/page (action="append-section")`), `active`, `preview_link`.

---

## Step 5 — Media: re-home the source's assets (images AND video/audio)

The upload abilities sideload media by **fetching the URL over HTTP from the WP server.** They cannot read `data:` URIs, `blob:` URIs, local paths (`./assets/hero.png`, `./assets/demo.webm`), or any URL the server cannot reach. This applies to **every** media reference — `<img src>`, `srcset`, `<video src>`, `<source src>`, `<video poster>`, `<audio src>`, and `url(...)` backgrounds — not just `<img>`. So for each media file the source references:

1. **Already a public HTTPS URL** the WP server can reach (a CDN, the source's live domain) → keep it as-is; `upload_images:true` sideloads it (video/audio included).
2. **Local file** (in `project_path`, or a path the source uses) → upload it:
   1. Call `uichemy-composer/media (action="request-upload") { ttl_minutes }` **once for the whole build** → response has `slot_url`, `request_header`, `usage_example`, `batch_usage_example`, `expiry`.
   2. Run `batch_usage_example` via bash as ONE command: it loops over every file with `--data-binary @…`. Do NOT call the ability again per image.
   3. Pass `filename` and `alt` as URL-encoded query params on each upload; `alt` is stored during the upload, so it needs no follow-up call.
   4. Read each upload response → put the returned `url` into that `<img src>`. One slot serves the whole build.
3. **`data:` / `blob:` / decorative** → if it's a pure gradient/shape, convert to the CSS-only equivalent; otherwise decode+save the data URI to a local file and upload it as in (2).

**Do NOT downgrade a real local `.webm`/`.mp4` demo to a static mock or placeholder** — that was the old limitation; the upload path now handles video, so re-home it like any other asset.

Never leave a `data:`, `blob:`, local, or unreachable URL in the final HTML.

---

## Step 6 — Verification before each upload (fidelity + safety)

Before each `create_*` / `add_*` call, PASS these checks:

- **Fidelity:** the converted section's text, colors, fonts, and layout match the source section. No content dropped, no palette swapped, no copy paraphrased.
- Scope: every CSS rule prefixed with `.uichemy-{slug}-{index}`. No leaked global selectors (`body`, bare `.container`, bare `.btn`).
- Images: no `data:` / `blob:` / local paths / unreachable URLs remain.
- Responsive: tablet, mobile, and small-mobile blocks all non-empty (source's own queries re-scoped, or the three standard ones added).
- Typography: matched text elements carry their `typoLookup` class and NO font shorthand in CSS; unmatched text has full font-family / weight / size / line-height inline. Still visually identical to the source.
- Colors: every source color in `colorLookup` uses `var(--name)`; only untracked one-offs are raw hex; no unresolved source `var(--…)` left.
- Header dynamic tags match `hf_placement`: `"site"` → `<uichemy-site-logo>` / `<uichemy-nav-menu>` used (if the source header had a logo/nav); `"page"` → the source's literal logo `<img>`/text and literal `<ul><li>` nav items are kept verbatim, NO dynamic tags. Root is a `<div>` either way, placed correctly for your branch (section 1 in Case B; separate template in Case A). Footer at the end.
- `hf_placement` came from an actual Step 2.5 answer — not inferred, not defaulted.
- JS: bare, wrapped, scoped to root — no `<script>` tags, no CDN libraries pasted in.
- **After the FIRST upload only:** read the code back (`uichemy-composer/platform` `action="get-site-code"`, or `uichemy-composer/page` `action="get-page-code"`) and confirm every `<link>` and `<script src>` you sent is actually there. This is the one failure that costs a whole build — a page whose stylesheets never landed looks completely unstyled, and every later section uploads cleanly on top of it.

PASS → print `🛡️  Section N/T: PASS` and upload. FAIL → fix and re-check. Don't ship FAILing sections.

---

## Step 7 — Final summary

**Before you print it, run `uichemy-composer/audit`** with `action: "run"` (pass `post_id` to also check this page), if that ability is in your list. It looks for what a build most commonly leaves broken and cannot see from inside the loop: an empty design system, no site logo or tagline, a nav menu with no theme location, theme-builder templates with no display conditions (they render nowhere), forms with no recipient, images with no alt text. Every finding carries a severity and names the ability that fixes it. Fix the blockers before you summarise, and state any warning you chose to leave rather than letting the user discover it.

When the loop ends, print one summary block:

```
✅  Page built from provided code — "<Page title>"
    Header:  post_id=… · system=<system> · active=<true|false>
    Page:    post_id=… · preview=<preview_link>
    Footer:  post_id=… · system=<system> · active=<true|false>
    Sections converted: N
    Site-wide CSS/JS: <files> — loaded on every page because the header/footer need them
    Source: <what you ingested>  ·  Fidelity: preserved copy, palette, type scale
    Open the page link to preview.
```

Echo the user's Step 2.5 answer in the summary: `hf_placement="page"` → say the header/footer live on this page only; `hf_placement="site"` → confirm it's active site-wide via UiChemy's native Theme Builder. If a header/footer template was created but `active=false`, tell them to assign it under WP Admin → Templates → Theme Builder. Flag anything you had to change from the source (fallback font, heavy JS library not enqueued).

**Asset import manifest (mandatory).** Every `uichemy-composer/page (action="create")` / `uichemy-composer/page (action="append-section")` response returns an `image_failures` array — each entry `{ from, error, code, source }` is a media reference (image / video / audio, in HTML `src`/`poster` or CSS `url()`) the server could **not** fetch. Collect them across ALL upload calls, dedupe by `from`, and if any remain, print a manifest so the user never has to discover a broken or placeholder asset by eye:

```
⚠️  Couldn't import N asset(s) — these still point at unreachable/local URLs:
    • assets/demo.webm      → local path (re-home via uichemy-composer/media (action="request-upload"))
    • https://cdn.x/y.mp4   → fetch failed (403)
    Fix: upload each local file with uichemy-composer/media (action="request-upload") (images + video/audio),
         or give me a public URL, and I'll re-run the affected section(s).
```

Do NOT silently leave a failed asset as a placeholder or mock without listing it here. `code = uich_local_asset` (or an invalid-URL code) → a local/relative path, fix is `uichemy-composer/media (action="request-upload")`; a fetch/HTTP error → the source URL isn't publicly reachable.

---

## Anti-patterns — do not do these

- **Redesigning instead of converting.** Swapping the source's colors, fonts, spacing, or copy for your own. This flow is faithful reproduction — the `brief-to-wordpress` pipeline is the one that invents a design.
- Pasting the source's raw code into chat instead of calling the upload abilities.
- Leaving global/unscoped CSS selectors (`body`, `.container`, `.btn`) that collide with the theme.
- Keeping `data:` / `blob:` / local image paths, or CDN `<script>` tags, in the widget.
- Hardcoding `<li>` nav items in the Header instead of `<uichemy-nav-menu>` when `hf_placement = "site"` (the source had a real nav, but it went to a site-wide template).
- The reverse mistake: swapping in `<uichemy-site-logo>` / `<uichemy-nav-menu>` when `hf_placement = "page"`. Page-only sections are a static, faithful conversion — keep the source's literal logo and nav `<li>` items, no dynamic tags.
- Leaving unresolved source `var(--…)` in the widget CSS (the source's custom properties don't exist on the WP page — resolve to hex, then map through `colorLookup` to a kit global).
- Skipping the Step 3 write and scattering raw hex / full font shorthand everywhere (globals sync is ON — write the source's palette + type scale into the design system, then reference them as globals).
- **Skipping the Step 2.5 question, or guessing the answer.** If the source has a header/footer, you MUST ask "entire site vs this page only" and wait for the reply — every time, no exceptions.
- Building header/footer sections before the user answered Step 2.5 (body sections can't start either — the build order depends on the answer).
- Putting header/footer markup inside `uichemy-composer/page (action="create")` when `hf_placement` is `"site"`.
- Calling `uichemy-composer/template (action="create", type="header"|"footer")` when `hf_placement` is `"page"` — use the in-page path instead.
- Naming the specific competing theme-builder plugin (Elementor Pro / Nexter) to the user — coexistence should be mentioned generically only.
- Inventing a header/footer the source didn't have (that's the `brief-to-wordpress` pipeline, not this flow).
