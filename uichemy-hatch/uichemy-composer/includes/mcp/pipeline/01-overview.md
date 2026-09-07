# Composer Pipeline

Convert Figma → WordPress Composer — section-by-section.

**Input:** `{{FIGMA_URL}}`

**Key invariants:**

| Rule | Why |
|---|---|
| Step 2 before Step 3 | WP baseline must exist before token inventory |
| Step 3 uses variable defs + per-section design context (parallel) | Accurate cross-section counts without single huge root call |
| Steps 4-5 before any Phase 2 | Lookup tables frozen before any HTML is written |
| Steps 6→9 atomic per section | Prevents memory bleed, stale data |
| Step 9 error preserves memory | Safe resume without re-fetching Figma |
| `site_before_head` / `site_css` on first upload only | Prevents duplicate font injection |
| One section in working memory | Wipe `currentSectionMemory` before next section |

---

## Pipeline at a glance

```
PHASE 1 — ONCE (Steps 1–5)
  Step 1  Structure — get_metadata only → frozen sectionPlan[]
  Step 2  Site readiness — check_config + globals fetch + user confirmations
  Step 3  Token inventory — get_variable_defs + get_design_context on ALL sections in parallel (excludeScreenshot:true)

  ⟹ After Step 3 complete + designTokenInventory stored:
     call uichemy_composer_convert(figma_url, phase="1b")

  Step 4  Compare Figma vs the #uichemy-globals CSS block → write decision → set_globals_css
  Step 5  Build colorLookup + typoLookup — frozen for Phase 2

  ⟹ After Step 5 complete + lookup tables confirmed built:
     call uichemy_composer_convert(figma_url, phase="2")

PHASE 2 — PER SECTION (Steps 6–10) — instructions in phase="2"
  For each section N = 1..total (sectionPlan[] order):
    Step 6   Screenshot + design context — this section only
    Step 7   Generate HTML, CSS, JS
    Step 8   Verify globals (BLOCKS upload if FAIL)
    Step 9   Upload to WordPress
    Step 10  Wipe currentSectionMemory → next section

  ⟹ After ALL sections uploaded:
     call uichemy_composer_convert(figma_url, phase="3")

PHASE 3 — ONCE (Step 11) — instructions in phase="3"
  Step 11  Final summary (editor link + preview link first)
```

---

## ❗ Hard rules

### Ordering
- PHASE 1 must complete in full before PHASE 2 starts. No per-section `get_design_context` / `get_screenshot` until Step 5 lookup tables are built.
- Steps 6→7→8→9 are atomic. A section may not move to Step 6 of the next until Step 9 of the current succeeds.
- Never interleave two sections in memory. Never pre-fetch section N+1 while N is in `currentSectionMemory`.

### Memory isolation
```
currentSectionMemory = {
  label, nodeId, screenshot, designContext,
  extraContexts[], images[], html, css, js, verificationResult
}
```
After Step 9 succeeds → wipe completely. If Step 9 fails → preserve for manual resume.

### Responsive + JS — mandatory
- Every CSS block MUST contain non-empty tablet (`≤1024px`), mobile (`≤768px`), and small-mobile (`≤480px`) rules.
- Every section with any interactive signal MUST emit scoped IIFE JS. `js: ""` only for provably static sections.

### ❌ Forbidden
- One root-only `get_design_context` as sole source for all sections and global counts.
- Fetching design_context for section N+1 before section N is uploaded.
- Generating HTML for section N while section N−1 is unsent.
- Calling `create_uichemy_composer_page` or `add_uichemy_composer_section` for a Header or Footer.
- Starting PHASE 2 before Steps 2c and 2d are answered.
- Inventing Figma CDN URLs — only use URLs returned by `get_design_context` or `get_screenshot`.
- Omitting the pre-generation typography matching report (Step 7a).
- Skipping Step 2 globals fetch or Step 3 token inventory — even for small designs.
- **Using the Bash tool to read, grep, parse, or extract data from any temp file produced by a tool result.** Every bash command on a temp file adds 3,000–5,000 tokens. 14 bash commands = ~50,000 wasted tokens — more than the entire pipeline instruction set. Use the Read tool only.
