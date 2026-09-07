/**
 * Dashboard tab registry, the single source of truth for the sidebar.
 *
 * DashShell renders the nav from this list and DashboardApp registers one
 * <Route> per entry, so adding a tab means adding one object here plus its
 * screen. Nothing else needs touching.
 *
 * The rail is a flat list split into labelled SECTIONS (see below), Create and
 * Manage, so the nav reads by user journey rather than as one long pile. Each tab carries a `section` id; DashShell draws a small heading before
 * the first tab of each section. There are no collapsible groups anymore.
 *
 * `screen` names the component key in DashboardApp's SCREENS map.
 * `builderScreen` instead names a screen that came from the merged UiChemy
 * runtime (uichemy-composer/admin/screens/), those render inside a Tailwind
 * island, so DashboardApp wraps them differently. See BuilderScreenHost.
 * `pending` means no screen exists yet and Placeholder stands in, with the
 * value saying why ('uichemy' = came from UiChemy but not wired, 'planned' =
 * never built).
 * `pro: true` draws the crown affordance; the upsell itself is rendered by the
 * builder runtime's own ProGate, which decides Free vs Pro.
 * `badge` draws a tiny text pill after the label (e.g. 'New', 'Optional').
 */
import { __ } from '@wordpress/i18n';
import * as Icon from '../components/icons.jsx';

/**
 * Rail sections, in order. A section's heading only renders if it has at least
 * one tab, so pruning a tab can't leave an orphan label.
 */
export const SECTIONS = [
  // Create has only Home + Theme Builder now, so it needs no caption, an empty
  // label renders no heading (see NavSection). Manage keeps its heading.
  // (The old "Account" section is gone along with the AI Tokens and
  //  Account & License screens; Settings now lives under Manage.)
  { id: 'create', label: '' },
  { id: 'manage', label: __( 'Manage', 'uichemy' ) },
];

export const TABS = [
  // ── Create, everything that gets a design into this site ──────────────
  {
    key: 'welcome',
    path: '/',
    label: __( 'Home', 'uichemy' ),
    icon: Icon.Home,
    screen: 'welcome',
    section: 'create',
  },
  // Figma Plugin, AI Website Creator and AI Agent (MCP) are no longer separate
  // nav items, they're merged into a tabbed workspace ON Home (see Welcome.jsx).
  // Their old routes (/figma, /ai-website, /ai-agent) still resolve, opening Home
  // with that tab preselected (see DashboardApp).
  // ── Manage, Theme Builder + running the site day to day ───────────────
  {
    key: 'theme-builder',
    path: '/theme-builder',
    label: __( 'Theme Builder', 'uichemy' ),
    icon: Icon.Layout,
    screen: 'themebuilder',
    section: 'manage',
  },
  {
    key: 'forms',
    path: '/forms',
    label: __( 'Form Submissions', 'uichemy' ),
    icon: Icon.Inbox,
    builderScreen: 'FormSubmissions',
    section: 'manage',
  },
  {
    key: 'role-manager',
    path: '/role-manager',
    label: __( 'Role Manager', 'uichemy' ),
    icon: Icon.Users,
    builderScreen: 'RoleManager',
    pro: true,
    section: 'manage',
  },
  {
    key: 'white-label',
    path: '/white-label',
    label: __( 'White Label', 'uichemy' ),
    icon: Icon.Tag,
    screen: 'whitelabel',
    pro: true,
    section: 'manage',
  },
  {
    key: 'settings',
    path: '/settings',
    label: __( 'Settings', 'uichemy' ),
    icon: Icon.Gear,
    builderScreen: 'Settings',
    section: 'manage',
  },
  // The merged Hatch runtime (hatch/): publish this site as a static headless
  // frontend. Its setup wizard and its whole admin UI render in the content
  // area from here — see screens/dashboard/SyncElementor.jsx. Last in the rail
  // because it is the one row that leads out of UiChemy's own surface.
  {
    key: 'sync-elementor',
    path: '/sync-elementor',
    label: __( 'Sync with Elementor', 'uichemy' ),
    icon: Icon.Swap,
    screen: 'syncelementor',
    section: 'manage',
  },
];

/**
 * Every routable tab. The list is already flat (no groups), so this is just
 * TABS, the helper stays for the call sites that document intent.
 */
export function routableTabs() {
  return TABS;
}

/** The tabs belonging to a section, in registry order. Hidden tabs (reached
 *  from the profile menu, not the rail) are excluded. */
export function tabsInSection( sectionId ) {
  return TABS.filter( ( t ) => t.section === sectionId && ! t.hidden );
}

/** Look a tab up by its route path. */
export function tabByPath( path ) {
  return TABS.find( ( t ) => t.path === path ) || null;
}
