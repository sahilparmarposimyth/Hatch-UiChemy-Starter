# PHASE 3 — Final summary

## Step 11 — Final code injection (optional) + Summary

If any site-wide or page-level code was deferred, write it now. The two scopes are **separate
abilities** — one call each, and only for the scope you actually deferred:

```
site-wide  → uichemy-composer/platform  action="update-site-code"
             { site_before_head, site_before_body }
page-level → uichemy-composer/page      action="set-page-code"
             { post_id, page_before_head, page_before_body }
```

Do not put `site_before_head` / `site_before_body` into the page call — it is refused with an
error telling you to use `platform`, so the deferred code simply does not land. Prefer
`update-site-code` over `set-site-code`: it appends and de-duplicates `<link href>` URLs, so
re-sending a font link cannot stack it up, whereas `set` replaces whatever is already there.

Skip this step entirely if everything was already sent on the first section upload.

**Before you print it, run `uichemy-composer/audit`** with `action: "run"` (pass `post_id` to also check this page), if that ability is in your list. It looks for what a build most commonly leaves broken and cannot see from inside the loop: an empty design system, no site logo or tagline, a nav menu with no theme location, theme-builder templates with no display conditions (they render nowhere), forms with no recipient, images with no alt text. Every finding carries a severity and names the ability that fixes it. Fix the blockers before you summarise, and state any warning you chose to leave rather than letting the user discover it.

```
✅  Page created successfully

   🖊️  Edit in Elementor:  <elementor_link>
   👁️   Live Preview:       <preview_link>
```

**Single post template — print by `system` value:**

| system | Output |
|---|---|
| `elementor_pro` | `📄 Single Post → <link> (ACTIVE on all posts ✅)` |
| `nexter` | `📄 Single Post → <link> (ACTIVE on all posts ✅)` |
| `none` | `ℹ️ No theme builder — imported as regular page instead` |

If sample post created: `📝 Sample post: <title> → <permalink>`

**Header/Footer:** UiChemy's native Theme Builder always activates it immediately on creation (`system:"uichemy_native"`, `active:true`) — regardless of `platform.header_footer_system`. Print: `🧩 Header/Footer → ACTIVE on entire site ✅`. Never name a specific competing theme-builder plugin in this message.

If `uichemy-composer/platform (action="update-site-settings")` was called: `🎨 Logo → ✅ set | skipped | ❌ failed · Icon → ✅ set | skipped | ❌ failed`

Then 3–5 line paragraph: design system saved/skipped · sections completed · notable JS/responsive features.

---

## Appendix A — Common failure modes

| Symptom | Root cause | Fix |
|---|---|---|
| `uichemy-composer/design-system (action="set")` returns unexpected `css` | Sent a partial fragment instead of the complete block | `uichemy-composer/design-system (action="set")` always replaces the WHOLE block — send the full text every time, or use `uichemy-composer/design-system (action="patch")` instead, which only touches what it matches |
| `uichemy-composer/design-system (action="patch")` returns `count: 0` for a `find` | The `find` text doesn't exactly match the current block | `uichemy-composer/design-system (action="get")` first, copy the exact text (including whitespace) into `find` |
| CSS uses raw hex that's in colorLookup | Step 8 missed a CSS property | Search full CSS string for every colorLookup key before upload |
| Matched element still has `font-size` in CSS | CSS not cleaned after adding class | Strip font props from all selectors targeting matched elements |
| Responsive rules are empty blocks | Didn't review Figma layout signals | Re-read design_context for `primaryAxisSizingMode`, `layoutWrap`, child counts |
| JS re-binds on every render | Missing `data-bound="1"` | Wrap every listener block in bound guard |
| `site_before_head` missing fonts from later sections | Built from section 1 only | Build from full `unmatchedFonts[]` collected in Step 5 |
| Upload fails "post_id not found" on section 2+ | `pipelineState.post_id` not saved | Always save post_id from `uichemy-composer/page (action="create")` before clearing section 1 memory |
| Token counts swing between runs | Skipped `get_variable_defs` or root `get_design_context` | Always call both in Step 3 |
| Generic nodeIds after `get_metadata` | Children are wrapper groups | Recurse deeper until real section names appear |
| A `var()` reference broke after a re-run | A `--name`/`.text-*` class got renamed in `uichemy-composer/design-system (action="set")` | Never rename an existing entry — only ADD; carry forward every existing name verbatim |
