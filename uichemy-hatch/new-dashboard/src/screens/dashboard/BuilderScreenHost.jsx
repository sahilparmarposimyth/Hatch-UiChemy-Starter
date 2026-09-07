import React from 'react';
import { __ } from '@wordpress/i18n';

// Tailwind utilities WITHOUT preflight, plus the shadcn design tokens. Imported
// here rather than in the dashboard entry so the island's CSS only ships if a
// builder screen is actually part of the bundle.
import '../../uichemy-composer/admin-island.css';
import '../../uichemy-composer/shadcn-tokens.css';
// UiChemy brand skin for the island, remaps the zinc shadcn tokens above to the
// UiChemy DS (orange brand, grey surfaces, Zalando Sans) and defines the --ptn-*
// vars the .ptn-dot-red motif / White Label markup rely on. Imported AFTER the
// tokens so its unlayered `.uich-tw` overrides win.
import '../../uichemy-composer/admin/brand.css';

import { PortalContainerProvider, ensurePortalRoot } from '@/components/ui/portal-context';
import { ProGate } from '../../uichemy-composer/admin/pro.jsx';
import { ThemeBuilder } from '../../uichemy-composer/admin/screens/ThemeBuilder.jsx';
import { Settings } from '../../uichemy-composer/admin/screens/Settings.jsx';
import { FormSubmissions } from '../../uichemy-composer/admin/screens/FormSubmissions.jsx';
import {
  RoleManagerScreen,
  WhiteLabelScreen,
  LicenseScreen,
} from '../../uichemy-composer/admin/plugin-screens.jsx';

/**
 * Mounts a screen that came from the merged UiChemy runtime.
 *
 * Those screens are Tailwind + shadcn, while the rest of this dashboard is plain
 * SCSS. Three things have to be true for them to render correctly here:
 *
 *  1. A `.uich-tw` wrapper. tailwind.config.js sets `important: '.uich-tw'`, so
 *     every utility is scoped to that class, outside it they are inert.
 *  2. Tokens, but no preflight. `@tailwind base` is a GLOBAL reset; loading it on
 *     a wp-admin page restyles WordPress's own admin menu and bar. admin-island.css
 *     ships utilities + a scoped mini-reset instead. (UiChemy's standalone
 *     dashboard did load full preflight, that is the one behaviour deliberately
 *     not carried over.)
 *  3. A scoped portal host. Radix (Dialog / Select / Popover / DropdownMenu)
 *     portals to document.body, which is outside the island, so a portaled menu
 *     would render completely unstyled. ensurePortalRoot() creates a `.uich-tw`
 *     host for them.
 *
 * Pro-gated screens go through the runtime's own ProGate so Free/Pro is decided
 * in one place. In the Free build plugin-screens.js exports null for them and
 * ProGate renders the upsell instead, the real component never mounts, so its
 * ajax calls never fire either.
 */
/**
 * Pro screens ship in this bundle and ProGate decides what renders: the real
 * screen when the UiChemy Pro plugin is active, the upsell when it isn't.
 *
 * ProGate keys off `proLocked`, which PHP fills from uichemy_pro_feature_map()
 *, the same uichemy_is_pro() that Pro flips by defining UICHEMY_PRO. So one
 * server-side fact drives both what is shown here and whether the save routes
 * accept anything (they answer 403 without Pro).
 *
 * ProGate does not mount the child when locked, so a free site never runs the
 * screen's effects or its ajax calls either.
 */
const SCREENS = {
  ThemeBuilder: () => <ThemeBuilder />,
  Settings: () => <Settings />,
  FormSubmissions: () => <FormSubmissions />,
  RoleManager: () => (
    <ProGate feature="role_manager"><RoleManagerScreen /></ProGate>
  ),
  WhiteLabel: () => (
    <ProGate feature="white_label"><WhiteLabelScreen /></ProGate>
  ),
  // Not ProGated: License is a SOFT gate (activation grants updates + support,
  // it doesn't unlock features), so a free user must be able to reach it to
  // enter a key. It handles an absent license gracefully.
  License: () => <LicenseScreen />,
};

export default function BuilderScreenHost( { name } ) {
  const portalRoot = React.useMemo(
    () => ( typeof document !== 'undefined' ? ensurePortalRoot( document ) : null ),
    []
  );

  const Screen = SCREENS[ name ];

  if ( ! Screen ) {
    return (
      <div className="dash">
        <div className="panel span-2 nd-pending">
          <b className="nd-pending__title">
            { __( 'This screen could not be loaded.', 'uichemy' ) }
          </b>
          <p className="nd-pending__desc">
            { __( 'The builder screen is missing from this build. Rebuilding the dashboard usually fixes it.', 'uichemy' ) }
          </p>
        </div>
      </div>
    );
  }

  return (
    <PortalContainerProvider container={ portalRoot }>
      {/* `nd-island` restores the page padding that `.dash` gives the other
          tabs, the builder screens bring their own internal spacing but
          assume a padded host. */}
      <div className="uich-tw nd-island">
        <Screen />
      </div>
    </PortalContainerProvider>
  );
}
