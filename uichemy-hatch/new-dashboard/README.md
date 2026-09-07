# UiChemy — New Dashboard (React app)

Companion to `includes/new-dashboard/`. Build artefacts live in `build/` and are loaded by `Uich_ND_Enqueue` on the **UiChemy → UiChemy (New)** admin submenu.

## Install & build

```bash
cd new-dashboard
npm install
npm run build         # production build → build/index.{js,css}
npm run start         # watch mode while iterating
```

Both `index.js` and `index.css` are produced by `@wordpress/scripts` (matches the old `dashboard/` toolchain).

## Mount point

The React tree mounts on `#uich-new-dash`, which is rendered by `Uich_ND_Menu::render_page()`.

## Source layout

```
src/
  index.js              Entry — wraps domReady + createRoot
  App.jsx               Top-level state machine; picks a screen from boot state
  lib/api.js            REST wrapper + `getBoot()` for window.uich_nd_boot
  components/
    WPChrome.jsx        Calm WP-Admin canvas
    WebShell.jsx        Post-onboarding top bar
    WizardShell.jsx     Brand header + progress rail + footer
  screens/
    wizard/             Builder, Mode, Connect, Success, EnvBlocked
    dashboard/          Dashboard (panels + FAQ + tokens)
    errors/             Calm ErrorCard (permalinks / REST / security / …)
  styles/
    tokens.scss         Design-token variables (scoped to #uich-new-dash)
    app.scss            Ported app stylesheet
    main.scss           Entry
```

## Visual system

Set via data attributes on the root `<div>` rendered inside `App.jsx`:

- `data-vs="uichemy"` (premium violet) or `data-vs="wp"` (calmer WP blue).
- `data-accent="full"` | `"noLime"` | `"flat"` — accent intensity.

## What's stubbed for Phase 2

- Generate Application Password (currently disabled button with a placeholder note)
- MCP config copy + Add-to-Cursor / Add-to-Claude one-click buttons
- Persisting wizard selections back to REST (`POST /builder`, `POST /mode`, `POST /onboarded`)
- Real Phosphor icon set + unDraw success illustration (currently text glyphs)
- Token/MCP error variants and Connect-screen state machine
