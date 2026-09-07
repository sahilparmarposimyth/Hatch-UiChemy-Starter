## Step 3 — Design token inventory

**HARD GATE:** Do not enter Step 4 until `designTokenInventory` is fully built and stored.

Print one summary line when complete:
```
✅ Inventory: N colors · M typography combos · X opacity values · Y variables
```

**Forbidden:** `use_figma`, canvas scripts. Layout stays frozen from Step 1 — do not re-plan sections from design context.

---

## ⚠️ Overflow handling rule — applies to ALL tool calls in this step

When any tool result (get_variable_defs, get_design_context) is saved to a temp file:

**First: probe the size.** Read the file with `{ offset: 0, limit: 300 }`. Judge from what
comes back: if the response reaches line 300 and the content is clearly still going, treat the
file as LARGE; if it ends before that, you already have the whole thing. Do not assume a Read
returns a total line count - some clients report one, most do not, and the probe above works
either way.

**If the file ends within ~400 lines:** keep reading in 300-line chunks. Extract colors +
typography from each chunk as you go and accumulate into `designTokenInventory`, so no chunk
needs to stay in context after you have mined it. Never use bash.

**If the file is LARGE:** do NOT read it into your main context — that spikes context by
30,000–50,000 tokens for data you only need three small lists from. Delegate the extraction if
your client can (a subagent, a sub-task, a separate worker), using this exact prompt so it
returns findings rather than the file:
```
Read the file at <temp path> in full using the Read tool with offset/limit chunks.
Extract and return ONLY:
1. All unique hex colors (lowercase #rrggbb) with occurrence counts
2. All font-family + font-weight + font-size (px) combos with occurrence counts
3. All rgba() colors with alpha < 1
Return as compact JSON only — no explanations, no HTML, no CSS blocks.
Format: { colors:[{hex,count}], typography:[{family,weight,sizePx,count}], opacity:[{value,count}] }
```
That returns ~300 tokens of compact JSON. Store it directly as `designTokenInventory`.

**If your client has no way to delegate,** fall back to chunked reads: 300 lines at a time,
extract the colors and typography from each chunk immediately, and carry forward only the
running counts — never the raw chunk. It costs more turns than delegating but keeps the
context flat.

**Never:** run bash/grep/awk/sed on the temp file. Never delegate with a vaguer prompt than the
one above — open-ended exploration dumps the whole file back into your context, which is the
cost this rule exists to avoid.

---

### 3a — Source A: get_variable_defs

Call **`get_variable_defs`** once on the root frame node.
- Non-empty → treat each entry (color hex, or font family+weight+size) as a **candidate** named token (name → resolved value). Candidates are NOT auto-synced — a candidate becomes a global only if Source B shows it is actually used (see 3c). Also use names to resolve `var(--...)` references in later design context output.
- Empty → skip silently; rely on Source B only (fully-raw design — counts from B drive everything).
- If result overflows to temp file → Read once, extract all variable name+value pairs in one pass.

**Both sources always run.** A design may use variables, raw values, or a mix of both — even within one category (some colors as variables, some raw). Running A + B and merging in 3c handles all three uniformly; never skip B just because A is non-empty.

### 3b — Source B: get_design_context on ALL sections in parallel

Call **`get_design_context`** on every section node in `sectionPlan[]` **simultaneously in one turn** — not on root, not sequentially.
Always pass `excludeScreenshot: true` — token counting only, not visual reference.

**Why parallel and not root:**
- Root call = entire design HTML/CSS = ~39,000 tokens, often overflows to file
- Per-section parallel = each section ~2,000–3,000 tokens, fits inline, same API time
- Total parallel: 8 sections × ~2,500 = ~20,000 tokens vs 39,000 for root

**How to call in parallel (one turn):**
Make all section calls at the same time in a single assistant turn:
```
get_design_context(sectionPlan[0].nodeId, excludeScreenshot:true)
get_design_context(sectionPlan[1].nodeId, excludeScreenshot:true)
get_design_context(sectionPlan[2].nodeId, excludeScreenshot:true)
... all sections simultaneously
```

**Extraction (aggregate across all section responses):**
1. **Colors:** from each section response → normalize to lowercase 6-digit hex → increment global count. `rgba` with alpha<1 → opacity-only track.
2. **Typography:** from each section response → for each `font-family` + numeric `font-weight` + `font-size` (px) combo → increment global count keyed `Family|Weight|SizePx`.

After all section responses received → aggregate counts across all sections → `designTokenInventory` now has complete cross-section counts.

**If any individual section response overflows to temp file:** follow the overflow rule above (probe, then chunk or delegate). Each section is typically <200 lines with `excludeScreenshot` — overflow is unlikely.

### 3c — Merge A + B into the inventory

Variables (A) are candidates; usage (B) decides what is real. Merge:

1. **Variable used in B** → attach its real usage count, keep the variable's semantic name (e.g. `main-text-color`).
2. **Variable with count 0** (defined in the file but unused in this frame) → **DROP it.** Never sync unused variables. `get_variable_defs` returns every variable in the file, not only the used ones.
3. **Two+ variables sharing one value** (e.g. `Transparent` and `White Color` both `#ffffff`) → keep the first name, **sum** their counts (dedup by value).
4. **Raw value in B with no matching variable** → promote to a global candidate only if systemic: **color used ≥3×, typography used ≥2×** (same thresholds as Step 4 ADD rules). Below threshold → leave as an inline one-off, not a global.
5. **`rgba()` alpha<1** → opacity-only track (never a global color). Gradient / image fills → skipped (no flat hex).
6. **Variable-bound colors** → match Step 4 against the resolved hex from A.

This produces the same correct result for a fully-tokenized design, a fully-raw design, and a mixed design.

### 3d — Store inventory

Store as `designTokenInventory` in working memory. Do NOT print the raw JSON — print only the summary line from the HARD GATE above.

```js
// Internal structure (not printed):
designTokenInventory = {
  colors:       [ { hex: "#1a73e8", count: 14 } ],
  typography:   [ { family: "Poppins", weight: "700", sizePx: 48, count: 2 } ],
  opacityOnly:  [ { value: "rgba(0,0,0,0.4)", count: 3 } ],
  figmaVariables: [ { name: "icon/default/secondary", value: "#949494" } ]
}
```
