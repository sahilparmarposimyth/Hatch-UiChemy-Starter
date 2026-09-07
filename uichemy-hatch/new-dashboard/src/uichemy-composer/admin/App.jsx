// Admin dashboard root, a true SPA: HashRouter switches
// screens with no page reload. The WP page that mounted us passes initialScreen
// (from data-screen); we route to it once, then in-app nav is client-side.
import React from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PortalContainerProvider, ensurePortalRoot } from '@/components/ui/portal-context';
import { Shell } from './Shell';
import { Dashboard } from './screens/Dashboard';
import { Settings } from './screens/Settings';
import { ThemeBuilder } from './screens/ThemeBuilder';
import { FormSubmissions } from './screens/FormSubmissions';
// The Pro screens come from the per-plugin registry, not a direct import: Pro
// ships them, Free does not, and this file is shared between both plugins. A null
// export means "not in this build", see plugin-screens.jsx.
import { RoleManagerScreen, WhiteLabelScreen, LicenseScreen } from './plugin-screens';
import { ProGate } from './pro';
import { data } from './data';

const PATH_BY_SCREEN = { dashboard: '/', 'theme-builder': '/theme-builder', forms: '/forms', settings: '/settings', 'role-manager': '/role-manager', white: '/white', license: '/license' };

// Which localized `urls` entry each in-app route corresponds to. Slugs are never
// written here, PHP owns them, so this keeps working if a page slug changes, and
// `license` is simply an empty string in the build that has no License page.
const URL_KEY_BY_PATH = {
  '/': 'dashboard',
  '/theme-builder': 'themeBuilder',
  '/forms': 'forms',
  '/settings': 'settings',
  '/role-manager': 'roleManager',
  '/white': 'white',
  '/license': 'license',
};

/** The `page` query arg of a WP admin URL, or '', the only part worth comparing. */
function pageSlug(url) {
  const m = /[?&]page=([^&#]+)/.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * Keep WordPress's own submenu highlight in step with the in-app route.
 *
 * The dashboard is a single WP page (`admin.php?page=uichemy`) with hash routing on
 * top, and WP decides the highlight server-side at render time. So without this the
 * marker never moves off "Dashboard" no matter which tab you open.
 *
 * Scoped to `.toplevel_page_uichemy .wp-submenu` on purpose: other plugins' menu
 * items can carry our slug inside their own query args (Elementor's "Theme Builder"
 * has `return_to=…page=uichemy`), and a looser match would steal their highlight.
 */
function useSubmenuHighlight(pathname) {
  React.useEffect(() => {
    const menu = document.querySelector('#adminmenu .toplevel_page_uichemy .wp-submenu');
    if (!menu) return;

    const wanted = pageSlug((data.urls || {})[URL_KEY_BY_PATH[pathname]]);
    if (!wanted) return;

    menu.querySelectorAll('li').forEach((li) => {
      const a = li.querySelector('a');
      if (!a) return;
      // WP marks BOTH the <li> and the <a>; miss either and the highlight is
      // half-applied (background without the arrow, or vice versa).
      const on = pageSlug(a.getAttribute('href')) === wanted;
      li.classList.toggle('current', on);
      a.classList.toggle('current', on);
    });
  }, [pathname]);
}

function Inner({ initialScreen, hasHashLocation }) {
  const navigate = useNavigate();
  const location = useLocation();
  const didInit = React.useRef(false);

  useSubmenuHighlight(location.pathname);

  React.useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    // Reload after in-app navigation carries a hash (e.g. #/white), respect it
    // so the current view is preserved. Only a fresh WP-page load (no hash)
    // honors the WP page's data-screen and routes to it once.
    if (hasHashLocation) return;
    const target = PATH_BY_SCREEN[initialScreen];
    if (location.pathname === '/' && target && target !== '/') {
      navigate(target, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/theme-builder" element={<ThemeBuilder />} />
        <Route path="/forms" element={<FormSubmissions />} />
        <Route path="/settings" element={<Settings />} />
        {/* Pro-gated screens. In Free the real component is never mounted, so its
            ajax calls never fire either, the upsell renders in its place. Both the
            sidebar link and the WP submenu page land here.

            The upsell title/tagline/features live in the per-plugin pro module, keyed
            by `feature`, so this shared file carries no marketing copy and Pro's stub
            ProGate is a plain passthrough. */}
        <Route
          path="/role-manager"
          element={(
            <ProGate feature="role_manager">
              {RoleManagerScreen ? <RoleManagerScreen /> : null}
            </ProGate>
          )}
        />
        <Route
          path="/white"
          element={(
            <ProGate feature="white_label">
              {WhiteLabelScreen ? <WhiteLabelScreen /> : null}
            </ProGate>
          )}
        />
        {/* License exists only in Pro. Free's plugin-screens.jsx exports `null`
            for it, so the route simply isn't registered there and /license falls
            through to the catch-all redirect below. The build declares itself –
            no tier test needed. */}
        {LicenseScreen && <Route path="/license" element={<LicenseScreen />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

export function AdminApp({ initialScreen, hasHashLocation }) {
  // Radix portals (Dialog/Select/Popover/DropdownMenu) default to document.body,
  // which sits OUTSIDE the `.uich-tw` Tailwind scope, so a portaled dialog would
  // render completely unstyled/invisible. Give every portal a `.uich-tw` host to
  // render into, mirroring how the composer app wires this up.
  const portalRoot = React.useMemo(
    () => (typeof document !== 'undefined' ? ensurePortalRoot(document) : null),
    []
  );
  return (
    <PortalContainerProvider container={portalRoot}>
      <HashRouter>
        <Inner initialScreen={initialScreen} hasHashLocation={hasHashLocation} />
      </HashRouter>
    </PortalContainerProvider>
  );
}
