# UiChemy + Hatch — how the merge works

This plugin is UiChemy with the **Hatch** plugin bundled inside it, reached from a
`Sync with Elementor` row in the dashboard rail. It is a *separate copy*: the
standalone `uichemy-wordpress-main` and `wp-plugin/` (Hatch) sources in this repo
are untouched.

```
uichemy-hatch/
├── uichemy.php                      requires the loader (last line)
├── includes/hatch/
│   ├── class-uich-hatch-loader.php    boots or stands down the runtime
│   ├── class-uich-hatch-takeover.php  retires a standalone Hatch plugin
│   ├── class-uich-hatch-embed.php     chrome-free render of Hatch's pages
│   └── class-uich-hatch-bridge.php    boot payload + (de)activation calls
├── hatch/                           the Hatch runtime, near-verbatim
└── new-dashboard/src/
    ├── dashboard/tabs.js                    + the rail row
    ├── screens/dashboard/SyncElementor.jsx  + the screen
    └── screens/dashboard/DashboardApp.jsx   + the route
```

It follows the pattern this codebase already uses for `uichemy-composer/`
(`includes/composer/class-uich-composer-loader.php`) — a bundled runtime
re-pointed by constants rather than rewritten.

## The three edits inside `hatch/`

Everything else moved across verbatim. All three are guarded by
`UICH_HATCH_MERGED`, so `hatch/` still runs unchanged as its own plugin.

| File | Change | Why |
|---|---|---|
| `hatch.php` | 4 path constants became `defined() \|\| define()` | lets a host pre-point them |
| `admin/dashboard.php` | `hatch_register_admin_menu()` registers a **hidden submenu** instead of a top-level menu | one product, one sidebar entry |
| `admin/setup-wizard.php` | first-run redirect stands down | the host owns post-activation landing |

## Two decisions worth knowing

**`HATCH_PLUGIN_FILE` is deliberately NOT re-pointed at the host plugin file,**
even though doing so is what would make `register_activation_hook()` fire. Four
call sites feed it to `plugins_url()` — `pluginUrl` in the React boot state, the
VPS installer script, and `Hatch_Setup`'s boilerplate doc — and each would then
resolve one directory too high and 404. Instead `Uich_Hatch_Bridge` calls
`hatch_on_activation()` and `Hatch::on_activate()` from the host's own activation
hook. Leaving the constant alone also defuses `on_activate()`'s
network-activation branch, which calls
`deactivate_plugins( plugin_basename( HATCH_PLUGIN_FILE ) )` — a no-op against a
path that is not an active plugin, but the whole merged product if it pointed at
the host file.

**Hatch's admin renders in an iframe, not inline.** Hatch's admin is its own
complete React app with its own design tokens, reset and web font; mounted into
the dashboard's DOM the two systems fight and neither survives. Its wizard also
advances through real form POSTs to `admin-post.php` so all its server logic runs
— full page loads, which are free inside a frame and would destroy the SPA on the
dashboard page. `Uich_Hatch_Embed` strips the WP chrome (admin bar, rail, footer)
from those requests; `SyncElementor.jsx` measures the same-origin document and
sizes the frame to it, so there is no inner scrollbar.

Admin **notices are left visible** inside the frame on purpose — Hatch warns
about missing libsodium and plain permalinks that way, and hiding a security
warning to tidy a layout is the wrong trade.

The embed flag stays attached across navigation via two filters rather than by
patching Hatch's ~20 URL-building sites: `admin_url` (every URL Hatch mints) and
`wp_redirect` (every hop its handlers take). `Sec-Fetch-Dest: iframe` is honoured
as an additional hint, not as the mechanism.

## Plugin conflicts

- **Standalone Hatch** — handled automatically. Both copies declare the same 57
  global `hatch_*` functions and 56 `Hatch_*` classes, so loading both fatals the
  whole site. `Uich_Hatch_Loader` stands down when it detects one, and
  `Uich_Hatch_Takeover` deactivates it on the next `admin_init`; the request after
  that boots the bundled runtime. Settings carry over untouched — the bundled copy
  reads the same `hatch_*` options, so there is no migration and the files are
  **not** deleted (unlike the composer takeover, which only deletes because a
  migration gates it). Set `HATCH_STANDALONE` to opt out.
- **Standalone UiChemy** — ⚠️ **not** handled. This plugin *is* UiChemy, so
  running both means two copies of every `Uich_*` class, menu, REST route and
  option. Deactivate the standalone UiChemy before activating this one.

## Building

Neither build output is committed — both upstream sources exclude it
(`/new-dashboard/build/`, `hatch/build/`) and release packaging rebuilds from
source. The shipped zip contains both.

```bash
cd new-dashboard && npm install && npm run build   # dashboard bundle
cd ../hatch       && npm install && npm run build:admin   # Hatch admin bundle
```

## Known gaps

- **MCP / "AI Agent" is inert in a zip built from this source.** The MCP adapter
  is loaded from `vendor-prefixed/autoload.php`, which upstream gitignores and
  which no source checkout contains — so it is absent here too. `class-uich-mcp-loader.php`
  guards on `is_readable()`, so the plugin activates and everything else works;
  the AI Agent tab simply has no server behind it. Pre-existing, not caused by the
  merge — run `composer install` plus the upstream prefixing step to restore it.
  `scripts/build.sh` asserts the two prefixed licence files exist, so the official
  release path fails loudly rather than shipping without them.

- **The WP media modal inside the frame.** Hatch calls `wp_enqueue_media()` for
  its logo / favicon / OG-image pickers. The modal is `position: fixed`, which
  inside an iframe anchors to the FRAME's box — and the frame is sized to its
  content, so on a tall page the modal centres somewhere the viewer has scrolled
  past. The "Open full screen" button in the screen header is the escape hatch;
  it opens the same page as a normal admin screen where the modal behaves. Capping
  the frame at viewport height would fix the modal but reintroduce an inner
  scrollbar on every screen, which is the worse trade for the common case.
- **Licensing.** Hatch is AGPL-3.0-or-later; UiChemy's header says GPLv3. GPLv3
  §13 explicitly permits the combination, but the combined work's header
  understates the AGPL terms that travel with `hatch/`. Both are POSIMYTH/Etica
  code, so this is a labelling call for the owner — not changed here.
- **Uninstall.** `hatch/uninstall.php` is no longer WordPress's uninstall handler
  for this plugin (only the root one is), so Hatch's opt-in data wipe does not run
  on delete. Hatch's default is "preserve everything" anyway, so nothing leaks —
  the wipe is simply unreachable.
- **Multisite network activation** skips Hatch's activation routine; see the
  `Uich_Hatch_Bridge::on_host_activation()` docblock.
