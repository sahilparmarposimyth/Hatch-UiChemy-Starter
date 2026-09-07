/**
 * Mode registry, how a design gets into this site.
 *
 * Single source of truth for the three modes, shared by the onboarding step 2
 * card picker (screens/wizard/ModeScreen.jsx) and the Import tab's dropdown
 * (screens/dashboard/Import.jsx), so the two surfaces can never drift apart.
 *
 * `id` is the slug persisted in the `uich_nd_mode` option, it must stay in
 * sync with Uich_ND_Settings::MODES on the PHP side, which validates writes.
 *
 * `builders` limits a mode to specific page builders (absent = all of them).
 * `pending: true` means the mode is selectable but its screen isn't built yet,
 * so the Import tab shows a coming-soon card instead of connection details.
 */
import { __ } from '@wordpress/i18n';
import * as Icon from '../components/icons.jsx';

export const MODES = [
  {
    id: 'figma',
    label: __( 'UiChemy Figma Plugin', 'uichemy' ),
    icon: Icon.FigmaGlyph,
    badge: { variant: 'success', text: __( 'Recommended', 'uichemy' ) },
    meta: __( 'For designers', 'uichemy' ),
    desc: __( 'Design in Figma, send it straight to WordPress. This is all you need.', 'uichemy' ),
  },
  {
    // Slug stays 'compose', it is the persisted `uich_nd_mode` value that
    // Uich_ND_Settings::MODES validates. Only the label is user-facing.
    id: 'compose',
    label: __( 'AI Agent to WordPress', 'uichemy' ),
    icon: Icon.Sparkles,
    brandLogo: true,
    badge: { variant: 'brand', text: 'Claude · Cursor · Codex' },
    meta: __( 'Optional', 'uichemy' ),
    desc: __( 'Prefer building with AI tools like Claude or Cursor? Generate pages by chatting with them.', 'uichemy' ),
    // MCP support is Elementor-only for now.
    builders: [ 'elementor' ],
  },
  {
    // Slug stays 'scratch': it is the value persisted in `uich_nd_mode` and
    // validated by Uich_ND_Settings::MODES, so renaming it would orphan sites
    // that already stored it. Only the label is user-facing.
    //
    // No longer `pending`, the Import tab now renders the real flow for this
    // mode (see screens/dashboard/Import.jsx → uichemy-webpage/). Elementor and
    // Gutenberg are both supported; the user picks per project.
    id: 'scratch',
    label: __( 'AI Website Creator', 'uichemy' ),
    icon: Icon.Wand,
    badge: { variant: 'brand', text: __( 'New', 'uichemy' ) },
    meta: __( 'New', 'uichemy' ),
    desc: __( 'No design to start from? Bring in a website you generated with AI, fully built out.', 'uichemy' ),
    builders: [ 'elementor', 'gutenberg' ],
  },
];

export const DEFAULT_MODE = 'figma';

export function modeById( id ) {
  return MODES.find( ( m ) => m.id === id ) || null;
}

/** Is this mode usable with the given page builder? */
export function modeSupportsBuilder( id, builder ) {
  const mode = modeById( id );
  if ( ! mode || ! mode.builders ) return true;
  return mode.builders.includes( String( builder || '' ).toLowerCase() );
}
