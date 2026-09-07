# UiChemy — Dashboard (PHP backend)

This folder holds **all PHP for the rebuilt UiChemy dashboard and onboarding wizard**. The companion React app lives in `<plugin-root>/new-dashboard/` and builds to `<plugin-root>/new-dashboard/build/index.{js,css}`.

This dashboard owns the top-level **UiChemy** admin page (`admin.php?page=uichemy`). The legacy `uichemy-welcome` slug redirects here, so the old `dashboard/` UI is no longer reachable from the menu.

> **Rename pending:** once this PR merges, `new-dashboard/` will be renamed to `dashboard/`. The matching `UICH_ND_BUILD_*` constants in `class-uich-nd-loader.php` (which still point at `new-dashboard/build/`) must be updated as part of that rename.

---

## Files

`class-uich-nd-loader.php` is the single entry point. It defines the `UICH_ND_*` constants, then `require`s and `boot()`s every class below in order.

| File | Purpose |
|---|---|
| `class-uich-nd-loader.php` | Entry point. Defines `UICH_ND_*` constants and boots all classes. |
| `class-uich-nd-settings.php` | Centralised option getters/setters (all keys prefixed `uich_nd_`) plus the `env_check()`, `connection_check()`, `detect_builders()`, and `detect_uichemy()` state snapshots. Feature code reads/writes options only through here. |
| `class-uich-nd-auth.php` | SSO against `app.uichemy.com` — initiates the login redirect, handles the signed callback, exposes `get_boot_state()`, and manages logout. |
| `class-uich-nd-app-password.php` | WP application-password handling (AJAX `wp_ajax_uich_nd_{generate,enable,disable}_app_passwords`). Uses the `uichemy-nd-` name prefix and its own meta keys so its state is independent of the legacy `Uich_App_Password`. |
| `class-uich-nd-recommended-settings.php` | On first builder selection, silently enables the settings UiChemy needs for clean conversion. Applied once per builder, tracked via `uich_nd_recommended_applied`. |
| `class-uich-nd-installer.php` | Drives the wizard's "Install \<builder\>" action — installs/activates Elementor from wordpress.org, activates the Bricks theme, etc. |
| `class-uich-nd-analytics.php` | Best-effort one-shot POST to POSIMYTH's intake endpoint when onboarding finishes, capturing the host environment. Port of the legacy `uich_boarding_store`. |
| `class-uich-nd-api.php` | REST namespace `uichemy/v2/nd` (see routes below). All routes require `manage_options`. |
| `class-uich-nd-enqueue.php` | Enqueues `new-dashboard/build/index.{js,css}` on the dashboard page and injects the bootstrap payload as `window.uich_nd_boot`. |
| `class-uich-nd-menu.php` | Registers the top-level **UiChemy** menu (`admin_menu` priority 11), redirects the legacy slug, and bounces users back to the dashboard after builder activation. |
| `index.php` | Silence-is-golden guard. |

---

## REST API — `uichemy/v2/nd`

All routes require `manage_options`. Defined in `class-uich-nd-api.php`.

| Method | Route | Purpose |
|---|---|---|
| GET  | `/env` | Environment snapshot (`env_check()`). |
| GET  | `/builders` | Installed/active page builders (`detect_builders()`). |
| GET  | `/state` | Full dashboard state (env + builders + mode + onboarded + …). |
| POST | `/builder` | Persist the selected builder (`{ builder }`). |
| POST | `/mode` | Persist the conversion mode (`{ mode }`). |
| POST | `/onboarded` | Mark onboarding complete. |
| POST | `/install` | Install/activate the selected builder. |
| POST | `/uichemy/install` | Install/activate the UiChemy companion. |
| POST | `/register-session` | Register a connection session for the Figma plugin. |

---

## Options & dev toggles

All persistent state lives in `uich_nd_*` options (managed via `Uich_ND_Settings`): `uich_nd_builder`, `uich_nd_mode`, `uich_nd_onboarded`, `uich_nd_recommended_applied`, the SSO token keys, etc.

| Constant (in `class-uich-nd-loader.php`) | Default | Effect |
|---|---|---|
| `UICH_ND_ONBOARDING_PERSIST` | `true` | `true` → onboarding shows once, then lands on the dashboard (production). `false` → onboarding shows on every refresh (testing only). |
| `UICH_ND_MOUNT` | `uich-new-dash` | DOM id the React app mounts into. |
| `UICH_ND_MENU_SLUG` | `uichemy-new-dashboard` | (Reserved) menu slug constant. |

---

## Bootstrap payload (`window.uich_nd_boot`)

Built by `Uich_ND_Enqueue::boot_payload()` and localised onto the dashboard script.

```jsonc
{
  "mountId":    "uich-new-dash",
  "restRoot":   "https://site/wp-json/uichemy/v2/nd",
  "restNonce":  "...",                  // wp_rest nonce
  "ajaxUrl":    "/wp-admin/admin-ajax.php",
  "ajaxNonce":  "...",                  // for wp_ajax_uich_nd_* app-password actions
  "adminUrl":   "/wp-admin/",
  "pluginUrl":  "https://site/wp-content/plugins/uichemy/",
  "version":    "x.y.z",
  "siteName":   "My Site",
  "siteUrl":    "https://site",
  "restUrl":    "https://site/wp-json/",
  "connectUrl": "https://site/index.php", // route-free base for the Figma connection link
  "mcpUrls":    { "regular": "https://site/wp-json/uichemy/v2/mcp" },
  "user":       { "id": 1, "name": "Admin", "login": "admin", "email": "...", "avatar": "...", "isAdmin": true },
  "auth":       { /* Uich_ND_Auth::get_boot_state() — SSO status */ },
  "state": {
    "env":         { "wp_version": "...", "wp_ok": true, "php_version": "8.2.x", "php_ok": true, "is_admin": true, "memory": "256M" },
    "connection":  { /* connection_check() */ },
    "builders":    { "elementor": { "installed": true, "active": true }, "bricks": {...}, "gutenberg": {...} },
    "builder":     "elementor",
    "mode":        "figma",
    "onboarded":   false,
    "appPassword": { "available": true, "has_token": false, "masked": "", "name": "" },
    "localEnv":    { /* get_local_env_state() */ },
    "uichemy":     { /* detect_uichemy() */ }
  },
  "urls": { "docs": "https://uichemy.com/docs", "chat": "https://uichemy.com/chat", "community": "https://store.posimyth.com/helpdesk" }
}
```
