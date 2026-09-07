## Step 4 — Compare Figma vs current design system → build the CSS block

Merge Step 2b's `get_globals_css` read with Step 3's `designTokenInventory`. The design system
is ONE plain-CSS block (`#uichemy-globals`) — there is no Elementor-kit split and `atomic_enabled`
does not affect this step.

### 4 pre-work — Extract content width (no extra API call)

`get_metadata` does NOT return padding, and top-level sections are usually full-bleed
(width = root width). So do NOT use `child.width − padding` on direct children — that
just returns the full-bleed width (e.g. 1440) and will overwrite the real boxed width.

Instead, scan EVERY descendant frame in the `get_metadata` tree and find the boxed
content width:
1. Let `rootW` = root frame width.
2. Collect the `width` of every descendant frame.
3. Discard any width within 2px of `rootW` (those are full-bleed sections), and any
   width < 800px (inner components, not containers).
4. `figmaContentWidth.value` = the most frequently repeated remaining width
   (must repeat ≥3 times across sections).
5. Fallback if nothing repeats ≥3×: `rootW − 2 × (most common left x-offset of the
   boxed content frames)`, flagged `estimated:true`.
6. If still nothing usable: if the block from `get_globals_css` already defines
   `--content-width`, keep that value unchanged. Otherwise fall back to `rootW` itself
   (the page is effectively full-bleed), flagged `estimated:true`. NEVER overwrite an
   existing `--content-width` from a guess.

```
figmaContentWidth = { value: <px>, count: <repeat count>, estimated: false|true }
```

### Matching rules

**Colors:** Exact lowercase hex. A `:root` var in the block already carrying that hex → matched, document the mapping.
**Typography:** Match on `(family, weight, sizePx)` against existing `.text-*` classes. Tolerance ±2px allowed — document it.
**Content width:** Compare `figmaContentWidth.value` vs the block's existing `--content-width` (if any).

### ADD rules

**Typography ADD when any:** Count ≥2 · role is `h1` · clear systemic role (primary body/button/heading scale).

**Color ADD when any:** Count ≥3 · brand/primary accent (saturated, on CTAs/links) · dominant text or background color.

**SKIP when:** Already in the block · pure decorative one-off (count ≤2, non-systemic) · gradient/image fill · `rgba()` alpha<1.

### Decision log (print before writing the block)

**MANDATORY — print ONE line before any write decision.** Never silently skip. The user has no other audit trail; if you skip the line they cannot tell whether the block changed, failed, or was already sufficient.

```
📋 Design system: N new colors · M new typography · content width Xpx (updated|unchanged|not detected)
(or)
📋 No changes required — block already covers all tokens · content width Xpx matched
```

If nothing to add AND content width MATCHED → skip the `set_globals_css` call, but still print the `No changes required` line.
Content width CHANGED alone is enough to trigger a write.

### Build the block — write the COMPLETE file, always

`set_globals_css` always replaces the whole block, so build the full text every time you write —
never send a partial fragment:

```css
:root {
  /* Colors */
  --brand-primary: #1a73e8;
  --text-default:  #1a1a1a;

  /* Fonts */
  --font-body:    Inter, sans-serif;
  --font-heading: "Poppins", sans-serif;

  /* Layout */
  --content-width: 1140px;
}

/* Typography classes */
.text-heading-h1 { font-family: var(--font-heading); font-size: 48px; font-weight: 700; line-height: 1.2; }
.text-body       { font-family: var(--font-body); font-size: 16px; line-height: 1.6; }

/* Layout classes */
.pr-boxed { max-width: var(--content-width); margin-left: auto; margin-right: auto; }
```

Rules:
- Carry forward every existing collection/var/class from the Step 2b read verbatim — this step
  only ADDS, it never deletes or renames an entry that already exists (renaming breaks every
  `var()`/class reference other sections or the user may already depend on).
- Group related vars under a plain `/* Name */` comment — that comment is the ONLY classifier
  (no `@`-rules, no id/label pairs, no `g-ut…`/`e-gv-…` prefixes — those are gone).
- `--content-width` + `.pr-boxed` always live in the block (Layout collection) — never write
  `max-width` by hand on a section wrapper; add the `.pr-boxed` class instead.
- Plain CSS colors (hex/rgb/hsl), plain CSS everywhere else.

### Sync result — verify after the call

After `set_globals_css` returns, print a one-line confirmation:
```
✅ Design system saved: N colors · M typography · content width Xpx (updated|unchanged)
```
If the returned `css` doesn't contain what you sent → STOP, print the discrepancy, do not enter Phase 2.

---

### Typography value derivation (compute per style — never guess)

For every `.text-*` class you CREATE, derive each property from `get_variable_defs` /
design_context for that exact style — do not reuse a default like `1.2`/`1.5`:

- **line-height:**
  - design shows `normal` / Figma AUTO        → `normal`
  - unitless ratio (e.g. `1.4`)               → `1.4`
  - pixels (`Npx` on a style of size `Spx`)   → `round(N/Spx, 2)` (unitless)
  - percent (`P%`)                            → `round(P/100, 2)` (unitless)
- **letter-spacing:** px → `<px>px`; percent → `round(P/100, 2)em`; `0`/none → omit the property
- **font-weight:** the style's real weight as a bare number (`400`, `500`, `600`, `700`)
- **font-size:** a single desktop px value — `.text-*` classes are NOT responsive; if a section
  needs a different size at a breakpoint, that section's own scoped CSS overrides it inside its
  `@media` rules (Phase 2), never the global class.

Matched styles are NOT recomputed — they reuse the existing `.text-*` class as-is.

---

## Step 5 — Build lookup tables

Built exclusively from the CSS block you just wrote (or read, if no changes were required).

```js
colorLookup["#1a73e8"] = { cssVar: "var(--brand-primary)", name: "brand-primary" }
typoLookup["Poppins|700|48"] = { class: "text-heading-h1", name: "Heading H1" }
```

**Key construction rules:**
- Color key: always lowercase 6-digit hex (no shorthand, no alpha).
- Typography key: `"${fontFamily}|${fontWeight}|${Math.round(fontSizePx)}"` — weight as string (e.g. `"700"`).
- `fontSizePx` — the `font-size` value you wrote into the `.text-*` class, in px.

**Naming rule (applies to both `--var` names and `.text-*`/`.pr-*` class names):**
1. Lowercase the name.
2. Trim whitespace.
3. Replace every char that is NOT `[a-z0-9_-]` with `-`.
4. Strip leading and trailing `-`.
   - `"Heading XL"` → `"heading-xl"` · `"Brand / Primary"` → `"brand-primary"`
5. There is no separate id vs. label — the sanitized name IS the `var()`/class you write into
   HTML and CSS. Once set, never rename it (it breaks every existing reference).
- Color is applied via `var(--name)` directly on the CSS property (`color`, `background`, `border-color`, …) — no wrapper class.

**Google Fonts:** Record all `fontFamily` values not covered by a `.text-*` class as `unmatchedFonts[]` — required in `site_before_head` on first section upload.

Store `contentWidthPx` frozen for Phase 2 — referenced via the `.pr-boxed` class (never write `max-width` manually).

**Build the lookup tables internally** (no API call — built from the block you just wrote or read):
`colorLookup` (hex → cssVar), `typoLookup` (`Family|Weight|SizePx` → class), `contentWidthPx`, `unmatchedFonts[]`.

**Do NOT print the raw lookup tables** — they are internal jargon (hex maps, class names) that the user doesn't need. Print only a one-line, human-readable summary:
```
🎨 Matched to your design system: N colors · M type styles · content width 1140px · fonts to load: Poppins, Inter
```
Keep `colorLookup` / `typoLookup` / `contentWidthPx` / `unmatchedFonts[]` in working memory for Phase 2.

⟹ **After Step 5 complete and lookup tables confirmed built:**
   call `uichemy_composer_convert(figma_url, phase="2")`
