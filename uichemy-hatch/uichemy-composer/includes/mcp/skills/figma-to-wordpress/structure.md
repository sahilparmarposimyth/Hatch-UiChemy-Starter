# PHASE 1 — Global Setup

## Step 1 — Design structure (metadata only)

**Goal:** Build frozen `sectionPlan[]`. No screenshots, no design_context.

### 1a — Discover structure
Call `get_metadata` on root frame URL → list direct children. If names are generic ("Frame 47", "Group 12") → recurse one level deeper until named, full-width UI blocks are visible. Repeat until plan is grounded in real section names.

### 1b — Multi-widget vs single-widget

| Multi-widget ✅ | Single-widget ❌ |
|---|---|
| ≥3 distinct full-width sections | <3 sections |
| Total height >3000px | Height <3000px with no header/footer |
| Header AND Footer both present | Isolated component |

Recognised types: `Header · Hero · Features/Cards · About · Stats · Testimonials · Pricing · FAQ · Logo Strip · Gallery · CTA Banner · Newsletter · Footer`

If URL has no `node-id` → ask user which frame, then stop and wait.

### 1c — Print and freeze

```
🧩 SECTION PLAN — "Acme Studio — Homepage"
  1. Header   — logo + nav + CTA  (nodeId: 12:34)
  2. Hero     — heading + 2 CTAs  (nodeId: 12:56)
  3. Features — 3 cards           (nodeId: 12:78)
  4. Footer   — links + copyright (nodeId: 12:90)
→ Mode: MULTI-WIDGET (4 sections)
```

**Pick the page title up-front, never at upload time.**

The first line of the section-plan print MUST include the human-readable page title. Derive it from the Figma file/frame name (`Acme Studio — Homepage`), the brand on the design (`Acme Studio Pricing`), or the dominant content (`Founders — About`). Store it as `pipelineState.pageTitle` and reuse it verbatim when Step 9 calls `uichemy-composer/page (action="create") { title }`. Never let the title fall back to the ability's `"UiChemy AI Landing Page"` placeholder — that placeholder is a sign the plan wasn't named, not an acceptable default. Same rule for header/footer templates: name them from the design (`Acme Header`, `Acme Footer`), not generic `Header — UiChemy`.

`sectionPlan[]` is now **frozen**. Node IDs and `pageTitle` must not change after this point.

---

## Step 2 — Site readiness + WordPress globals

### 2a — describe the site

Call **`uichemy-composer/describe-site`** with `action: "schema"` and store the following. **Every one of
these lives inside the response's `platform` object** — read `platform.checks.elementor_active`,
not `platform.checks.elementor_active`. A path read at the wrong level comes back undefined, and an
undefined `elementor_active` is falsy, which would abort the build on a site where Elementor
is running perfectly well.

| Field | Action |
|---|---|
| `platform.checks.elementor_active` | If `false` → STOP: "Elementor not active. Install and activate before running." |
| `platform.atomic_enabled` | Informational only — no longer affects the design system (see Step 2b) |
| `platform.header_footer_system` | Informational only. Header/Footer always go through UiChemy's native Theme Builder (site-wide, any Elementor) — never print this value or name the specific competing plugin to the user. |
| `platform.checks.has_nav_menu` | If `false` AND Header in sectionPlan[] → call `uichemy-composer/platform (action="update-menu")` now |
| `platform.checks.has_custom_logo` | Used in Step 2d |
| `platform.checks.has_site_icon` | Used in Step 2d |
| `platform.active_header[]` | Non-empty → trigger Step 2c prompt |
| `platform.active_footer[]` | Non-empty → trigger Step 2c prompt |

The same call also returns `post_types`, `taxonomies`, `fields`, `meta_keys`, `menus` and
`woocommerce` — the content model. You do not need it for a static conversion, so do not
spend attention on it here; it is what any later data binding must be built from.

Print config summary:
```
⚙️  SITE CONFIG
   Nav menu             : ✅ exists | ⚠️ none → creating now
   Site logo            : ✅ set (<url>) | ⚠️ not set
   Site icon            : ✅ set | ⚠️ not set
   Active header        : "Title" | none
   Active footer        : "Title" | none
```

### 2b — Fetch the current design-system CSS block

Call **`uichemy-composer/design-system (action="get")`** → store the returned `css` as `existingGlobalsCss` (the current
`#uichemy-globals` block, or `""` on a fresh site). The design system is ONE plain-CSS block —
do not branch on `platform.atomic_enabled` here, it plays no part in this step.

**If result overflows to temp file:** Use the Read tool only (offset/limit chunks). Extract every
`:root` var and `.text-*`/`.pr-*` class in one pass. Never use bash.

Do not call `uichemy-composer/design-system (action="set")` before Step 4 issues its decision.

### 2c — Confirm existing header/footer (ask the user)

For each non-empty `platform.active_header` / `platform.active_footer`, ask the user. If your
client has a structured question tool such as `AskUserQuestion`, use it; otherwise ask in plain
text and wait for the answer. The shape matters less than the fact that you stop and wait:

```json
{
  "question": "An active Header exists: \"[title]\" ([system]). What should I do?",
  "header": "Existing Header",
  "multiSelect": false,
  "options": [
    { "label": "Replace it", "description": "Deactivate existing, import new design header." },
    { "label": "Keep existing", "description": "Skip header creation. Current header stays." }
  ]
}
```

- "Replace it" → proceed; old template auto-deactivated on new import
- "Keep existing" → set `pipelineState.skip_header = true` (or `skip_footer`)

Combine the header and footer questions into one turn when both are non-empty.

### 2d — Confirm logo and icon (ask the user)

Build questions dynamically — only include when action is needed:

- `platform.checks.has_custom_logo=false` → ask "Set from design" / "Skip for now"
- `platform.checks.has_custom_logo=true`  → ask "Keep existing" / "Replace with design logo"
- Apply the same pattern for `platform.checks.has_site_icon`

Ask all of these in **one turn**, not one at a time.

Store: `pipelineState.branding_action = { logo: 'set'|'replace'|'skip', icon: 'set'|'replace'|'skip' }`

**⚠️ DO NOT start PHASE 2 until 2c and 2d are answered.**
