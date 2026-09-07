// plugin-screens.jsx, the Pro-only dashboard screens.
//
// There is ONE dashboard build and it lives in the free plugin, so these screens
// ship here and are gated at render time instead of being swapped per build.
//
// That is safe because the gate was never really in JavaScript. The boundary is
// server-side: UiChemy_Admin_Menu::ajax() answers 403 to `save_role_manager` and
// `save_white_label` whenever uichemy_is_pro() is false, so a free site can reach
// the markup but cannot persist anything. What decides which of the two the user
// SEES is `proLocked`, PHP's uichemy_pro_feature_map(), which reads the same
// uichemy_is_pro(), consumed by ProGate.
//
// History worth knowing: these were briefly moved into the Pro plugin with its own
// bundle and a window registry. That was dropped, it meant a second webpack
// build, a second Tailwind config, and a published bridge API, all to avoid
// shipping markup that is GPL and unusable without the Pro plugin anyway. It also
// broke White Label: Tailwind only generates classes it finds in its `content`
// glob, and free's glob never scanned the Pro plugin.

export { RoleManager as RoleManagerScreen } from './screens/RoleManager';
export { WhiteLabel as WhiteLabelScreen } from './screens/WhiteLabel';
export { License as LicenseScreen } from './screens/License';
