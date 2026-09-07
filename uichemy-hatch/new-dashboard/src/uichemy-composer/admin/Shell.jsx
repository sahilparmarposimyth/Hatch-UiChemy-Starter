// Shared framed shell. The sidebar is rebuilt on shadcn (scoped to its own
// `.uich-tw` island so the shadcn reset never leaks into the still-`ptn-`
// Settings / White Label screens, which render untouched inside `.ptn-main`).
// The outer .ptn-wrap / .ptn-main / .ptn-appfoot frame is kept verbatim so
// those screens sit exactly where they did before.
import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { data } from './data';
import { Icon, UiChemyMark, UiChemyLogo } from './icons';
import { ProBadge, SidebarUpsell, TierBadge, isLocked, tierNavItems } from './pro';

const WORDMARK_CLASS = 'text-lg font-bold leading-none tracking-tight text-foreground';

// Brand lockup for the sidebar header. Default → the official UiChemy logo.
// White-label: a custom logo/name replaces it so no UiChemy branding leaks.
function Brand() {
  const wl = data.wl || {};
  if (wl.enabled && wl.logo_url) {
    const name = wl.plugin_name || 'uichemy';
    return (
      <span className="flex items-center gap-2.5">
        <img className="h-6 w-6 rounded-md object-cover" src={wl.logo_url} alt={name} />
        <span className={WORDMARK_CLASS}>{name}</span>
      </span>
    );
  }
  if (wl.enabled && wl.plugin_name) {
    return (
      <span className="flex items-center gap-2.5">
        <UiChemyMark className="h-6 w-6" />
        <span className={WORDMARK_CLASS}>{wl.plugin_name}</span>
      </span>
    );
  }
  return <UiChemyLogo className="h-8 w-auto text-foreground" />;
}

// Sidebar sits directly on the grey app background (no card wrapper), so the
// active item reads as a raised white "pill" and inactive items are plain text
// with a faint hover wash, the shadcn sidebar pattern.
const NAV_BASE =
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors '
  + '[&_svg]:size-[18px] [&_svg]:shrink-0';
const NAV_INACTIVE = 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground';
// Active item is a raised white pill on the warm ground. Its leading icon tracks
// the ink text colour so icon and label read as one; the red accent is carried by
// the Pro crown badge only (which keeps its own colour).
const NAV_ACTIVE = 'bg-background font-semibold text-foreground shadow';

export function Shell({ children }) {
  const wl = data.wl || {};
  const urls = data.urls || {};
  const brand = Brand();

  // Reveal a `.ptn-scroll` element's scrollbar only while it's actively
  // scrolling: add `is-scrolling` on scroll, drop it ~700ms after it stops.
  // Scroll doesn't bubble, so listen in the capture phase at the document.
  React.useEffect(() => {
    const onScroll = (e) => {
      const el = e.target;
      if (el && el.nodeType === 1 && el.classList && el.classList.contains('ptn-scroll')) {
        el.classList.add('is-scrolling');
        window.clearTimeout(el._ptnScrollTimer);
        el._ptnScrollTimer = window.setTimeout(() => el.classList.remove('is-scrolling'), 700);
      }
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  // `locked` items stay CLICKABLE on purpose, they route to the upsell screen,
  // which converts better than a dead disabled row (and matches how the composer
  // handles its own Pro surfaces).
  const nav = [
    { key: 'dashboard', to: '/', label: 'Welcome', icon: 'home' },
    { key: 'theme-builder', to: '/theme-builder', label: 'Theme Builder', icon: 'layout' },
    { key: 'forms', to: '/forms', label: 'Form Submissions', icon: 'inbox' },
    { key: 'role-manager', to: '/role-manager', label: 'Role Manager', icon: 'users', locked: isLocked('role_manager') },
    { key: 'white', to: '/white', label: 'White Label', icon: 'tag', locked: isLocked('white_label') },
    { key: 'settings', to: '/settings', label: 'Settings', icon: 'settings' },
    // Rows only one build has. Each plugin's tier module supplies its own, so
    // Free never carries a route it cannot reach and Pro never carries the test
    // that would hide one.
    ...tierNavItems(),
  ].filter((item) => !(item.key === 'white' && wl.enabled && wl.force_disable));

  return (
    <div id="ptn-app">
      <div className="ptn-wrap">
        <aside
          className="uich-tw"
          style={{ flex: '0 0 240px', width: 240, alignSelf: 'stretch' }}
        >
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-center justify-between gap-2 pt-1">
              {/* Header row is flush on both edges: the logo chip aligns with the
                  nav icons on the left, and the version badge aligns with the nav
                  pills' right edge, the whole sidebar shares one boundary. */}
              <span className="inline-flex items-center px-1 py-2">
                {brand}
              </span>
              {/* The badge that sits opposite the logo differs per build, Free
                  shows the version pill, Pro shows its crowned PRO badge. Both
                  live in the tier module so neither build ships the other's. */}
              <TierBadge />
            </div>

            <nav className="flex flex-col gap-1">
              {nav.map((item) => (
                item.to ? (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => cn(NAV_BASE, isActive ? NAV_ACTIVE : NAV_INACTIVE)}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {item.locked && <ProBadge small className="ml-auto" />}
                  </NavLink>
                ) : (
                  <a key={item.key} className={cn(NAV_BASE, NAV_INACTIVE)} href={item.href}>
                    <Icon name={item.icon} />
                    {item.label}
                  </a>
                )
              ))}
            </nav>

            {/* The upgrade card pinned to the bottom of the sidebar. Its markup and
                copy live in the per-plugin pro module, Free renders the card, Pro's
                stub returns null, so the sidebar just ends after the nav and the Pro
                bundle carries none of it. */}
            <SidebarUpsell />
          </div>
        </aside>

        <main className="ptn-main">{children}</main>
      </div>
    </div>
  );
}
