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

The first line of the section-plan print MUST include the human-readable page title. Derive it from the Figma file/frame name (`Acme Studio — Homepage`), the brand on the design (`Acme Studio Pricing`), or the dominant content (`Founders — About`). Store it as `pipelineState.pageTitle` and reuse it verbatim when Step 9 calls `create_uichemy_composer_page({ title })`. Never let the title fall back to the tool's `"UiChemy AI Landing Page"` placeholder — that placeholder is a sign the plan wasn't named, not an acceptable default. Same rule for header/footer templates: name them from the design (`Acme Header`, `Acme Footer`), not generic `Header — UiChemy`.

`sectionPlan[]` is now **frozen**. Node IDs and `pageTitle` must not change after this point.

---

## Step 2 — Site readiness + WordPress globals

### 2a — check_config

Call **`check_config`** and store:

| Field | Action |
|---|---|
| `checks.elementor_active` | If `false` → STOP: "Elementor not active. Install and activate before running." |
| `atomic_enabled` | Informational only — no longer affects globals tools (see Step 2b) |
| `header_footer_system` | Informational only. Header/Footer always go through UiChemy's native Theme Builder (site-wide, any Elementor) — never print this value or name the specific competing plugin to the user. |
| `checks.has_nav_menu` | If `false` AND Header in sectionPlan[] → call `ensure_nav_menu` now |
| `checks.has_custom_logo` | Used in Step 2d |
| `checks.has_site_icon` | Used in Step 2d |
| `active_header[]` | Non-empty → trigger Step 2c prompt |
| `active_footer[]` | Non-empty → trigger Step 2c prompt |

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

Call **`get_globals_css`** → store the returned `css` as `existingGlobalsCss` (the current
`#uichemy-globals` block, or `""` on a fresh site). The design system is ONE plain-CSS block —
do not branch on `atomic_enabled` here, it plays no part in this step.

**If result overflows to temp file:** Use the Read tool only (offset/limit chunks). Extract every
`:root` var and `.text-*`/`.pr-*` class in one pass. Never use bash.

Do not call `set_globals_css` before Step 4 issues its decision.

### 2c — Confirm existing header/footer (AskUserQuestion)

For each non-empty `active_header` / `active_footer`, ask:

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

Combine header + footer questions in one `AskUserQuestion` call when both non-empty.

### 2d — Confirm logo and icon (AskUserQuestion)

Build questions dynamically — only include when action is needed:

- `has_custom_logo=false` → ask "Set from design" / "Skip for now"
- `has_custom_logo=true`  → ask "Keep existing" / "Replace with design logo"
- Apply same pattern for `has_site_icon`

Pass all questions in **one `AskUserQuestion` call**.

Store: `pipelineState.branding_action = { logo: 'set'|'replace'|'skip', icon: 'set'|'replace'|'skip' }`

**⚠️ DO NOT start PHASE 2 until 2c and 2d are answered.**
