// pro.jsx, the per-plugin tier module for the ADMIN DASHBOARD.
//
// THIS FILE IS ALLOWED TO DIFFER between the Free and Pro repos; it is on the
// allowlist in tools/parity-config.json. Everything else under composer/src must stay
// byte-identical. See docs/free-pro-split-plan.md.
//
// >>> THIS IS THE **FREE** VERSION. <<<
//
// Every upsell surface the dashboard can show lives HERE, not in the shared screens:
// the crown pill, the upgrade CTA, the full-screen stand-in, the sidebar card, the
// Canvas locked-slot panel and the marketing copy for each. Pro's copy of this file
// is a set of inert stubs with the same export surface, so none of this markup is
// compiled into the Pro bundle. The shared screens import the same names in both
// builds and never ask which tier they are running in.
//
// Keep the export surface identical to Pro's copy. A shared file importing a name
// that exists in only one build is exactly the breakage the parity check exists to
// prevent, and a missing component reads as `undefined` in JSX, which throws.
//
// PHP localises what the gates need onto window.uichemyDashboard: `isPro`,
// `upgradeUrl`, `proLocked` (per-screen map) and `proTypes` (the Pro-only Theme
// Builder types), the JS never hard-codes the list, so PHP stays the single source
// of truth.
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
// Dashboard design-system (same package FormSubmissions uses in this admin
// context) — the Pro upsell CTAs + feature cards render through it.
import { Button, Card } from '../../design-system';
import { data } from './data';
import { Icon } from './icons';

/** True only in the Pro build (PHP: uichemy_is_pro()). */
export function isPro() {
  return !!data.isPro;
}

/** Upgrade/pricing URL. PHP: uichemy_upgrade_url(). */
export function upgradeUrl() {
  return data.upgradeUrl || 'https://uichemy.com/pricing/';
}

/** Whether a named dashboard screen is locked in this build. */
export function isLocked(feature) {
  return !!(data.proLocked || {})[feature];
}

/** The Theme Builder template types that require Pro. */
export function proTypes() {
  return Array.isArray(data.proTypes) ? data.proTypes : [];
}

/** Whether a Theme Builder template type is locked in this build. */
export function isTypeLocked(type) {
  return !isPro() && proTypes().indexOf(type) !== -1;
}

/** Small inline "PRO" pill, matches the composer's ProBadge. */
export function ProBadge({ small, className }) {
  if (isPro()) { return null; }
  return (
    <span
      title="Pro"
      aria-label="Pro"

      className={[
        'inline-flex items-center justify-center text-[#171717]',
        className || '',
      ].join(' ')}
    >
      <Icon name="crown" className={small ? 'size-3.5' : 'size-4'} />
    </span>
  );
}

/** The shared "Upgrade to Pro" call-to-action button. */
export function UpgradeButton({ source, children }) {
  const href = source ? `${upgradeUrl()}${upgradeUrl().indexOf('?') === -1 ? '?' : '&'}utm_content=${encodeURIComponent(source)}` : upgradeUrl();
  return (
    // DS Button, brand tone (orange from --uc-brand, no hardcoded hex); asChild
    // renders it as the upgrade link. `text-white` is required because the
    // `.uich-tw` Tailwind preflight resets `a { color: inherit }`, which would
    // otherwise override the DS button's on-brand white to dark ink on orange.
    <Button asChild variant="solid" tone="brand" className="text-white [&_svg]:size-4">
      <a href={href} target="_blank" rel="noreferrer">
        <Icon name="crown" />
        {children || 'Upgrade to Pro'}
      </a>
    </Button>
  );
}

/**
 * Full-screen stand-in rendered in place of a locked screen (Role Manager, White
 * Label). Not decorative, in the Free build it is the ONLY thing rendered at
 * that route, so the real screen's markup never reaches the browser.
 *
 * Sits inside the same white `bg-card` panel every other dashboard screen uses
 * (Dashboard/Settings), so a locked tab reads as a first-class screen, a floated
 * white sheet on the warm ground, not a bare message dropped on the canvas. The
 * panel holds a tinted hero (badge → title → tagline → CTA) and a scannable
 * two-column grid of the features Pro unlocks.
 */
export function ProScreen({ title, tagline, features, source }) {
  // `uich-tw` is REQUIRED: Tailwind is built with `important: '.uich-tw'`, so every
  // utility below is scoped to that class. `.ptn-main` is outside the island (the
  // legacy ptn- screens live there), so without this the whole card renders
  // completely unstyled. Every other screen roots itself the same way.
  const hasFeatures = Array.isArray(features) && features.length > 0;
  return (
    <div className="uich-tw">
      {/* White panel, mirrors Dashboard's outer sheet so every tab shares one
          frame. `flex` lets the inner block use `m-auto` to sit dead-centre of the
          sheet (both axes), so a locked tab reads as a balanced empty-state rather
          than content stacked in the top-left corner. */}
      <div className="ptn-scroll flex min-h-0 flex-1 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="m-auto flex w-full max-w-2xl flex-col items-center gap-7 py-8 text-center">
          {/* Crown chip, the single spot red is allowed to breathe. */}
          <div className="flex size-16 items-center justify-center rounded-2xl bg-[#171717]/10 text-[#171717] [&_svg]:size-8">
            <Icon name="crown" />
          </div>

          {/* Title + tagline */}
          <div className="flex flex-col items-center gap-2">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              {title} <span className="text-[#171717]">Pro</span>
            </h2>
            {tagline && (
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{tagline}</p>
            )}
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <UpgradeButton source={source} />
            <Button asChild variant="ghost" tone="neutral" className="[&_svg]:size-4">
              <a href={upgradeUrl()} target="_blank" rel="noreferrer">
                See everything in Pro
                <Icon name="arrow-up-right" />
              </a>
            </Button>
          </div>

          {/* Feature grid, three equal cards centred (icon → bold lead → detail),
              each with its own icon. Falls back to a plain string if given one. */}
          {hasFeatures && (
            <div className="w-full">
              <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                What you&apos;ll unlock
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {features.map((f) => (
                  <Card
                    key={f.title || f}
                    className="flex flex-col items-center gap-2.5 p-4 text-center transition-colors hover:bg-muted/40"
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-[#171717]/[0.07] text-[#171717] [&_svg]:size-[18px]">
                      <Icon name={(f && f.icon) || 'star-fill'} />
                    </span>
                    <span className="block text-sm font-semibold leading-snug text-foreground">{f.title || f}</span>
                    {f && f.desc && (
                      <span className="block text-[13px] leading-relaxed text-muted-foreground">{f.desc}</span>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Route guard. Renders `children` in Pro; in Free renders the upsell instead.
 * Used for whole screens in App.jsx, the locked screen's component is never
 * mounted, so it can't fire its ajax calls either.
 */
export function ProGate({ feature, children }) {
  if (!isLocked(feature)) {
    return children || null;
  }
  const copy = LOCKED_SCREENS[feature] || {};
  return <ProScreen title={copy.title} tagline={copy.tagline} features={copy.features} source={feature} />;
}

/**
 * The upsell copy for each gated screen. It lives here rather than in App.jsx so the
 * marketing text ships only in the build that can show it, App.jsx just names the
 * feature and Pro's stub ProGate ignores it entirely.
 */
const LOCKED_SCREENS = {
  role_manager: {
    title: 'Role Manager',
    tagline: 'Decide exactly which roles can use UiChemy, and which parts they can reach.',
    features: [
      { icon: 'users',   title: 'Per-role access',  desc: 'No access, content-only, or full editing.' },
      { icon: 'sliders', title: 'Toggle per role',  desc: 'Theme Builder, Design System and AI Chat.' },
      { icon: 'lock',    title: 'Safe client mode', desc: 'Keep clients in content-only editing.' },
    ],
  },
  white_label: {
    title: 'White Label',
    tagline: 'Ship UiChemy as your own product, your name, your logo, no UiChemy branding.',
    features: [
      { icon: 'edit',   title: 'Rebrand it fully',   desc: 'Name, logo, author and description.' },
      { icon: 'layout', title: 'Rename the widget',  desc: 'Composer widget name, icon and category.' },
      { icon: 'eye',    title: 'Control visibility', desc: 'Hide help links; restrict to one owner.' },
    ],
  },
};

/**
 * The Theme Builder's sub-heading. It names the template types the build actually
 * ships, so each plugin owns its own sentence, Free must not promise archive and
 * search (they are Pro), and Pro must not carry Free's shortened copy.
 */
export function themeBuilderTagline() {
  return 'Build and manage your site’s templates with UiChemy.';
}

/**
 * The Canvas panel shown when a slot's template type is not in this build. The slot
 * itself is real, the site has that position in its hierarchy either way, so the
 * copy says so rather than pretending the slot does not exist.
 *
 * `onUpgrade` is the shared screen's own handler; it already routes a locked type to
 * pricing instead of to tb_create.
 */
export function LockedSlotPanel({ slot, onUpgrade }) {
  if (isPro()) { return null; }
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-[13px] text-muted-foreground">
        {slot && slot.label} templates are part of UiChemy Pro. The slot still exists on
        your site, visitors get the active theme’s default until you build one.
      </p>
      <button
        type="button"
        onClick={onUpgrade}
        className="mt-3 inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 [&_svg]:size-3.5"
      >
        <Icon name="crown" />Upgrade to Pro
      </button>
    </div>
  );
}

/* ── Sidebar chrome ───────────────────────────────────────────────────────── */

/**
 * Nav rows only this build has. Free ships no License screen, so it contributes
 * none, the "Upgrade to Pro" card at the bottom of the sidebar stands in for it.
 * Pro's copy returns its License row instead, which is why Shell.jsx needs no test.
 */
export function tierNavItems() {
  if (isPro()) {
    // Pro swaps the "Upgrade" row for the licence row. Matches the label the
    // sibling Posimyth Pro plugins use.
    return [{ key: 'license', to: '/license', label: 'Activate License', icon: 'crown' }];
  }
  return [];
}

/**
 * The badge opposite the sidebar logo. Free shows the plain version pill; Pro
 * shows its crowned PRO badge. Neither build carries the other's markup.
 */
export function TierBadge() {
  return (
    <Badge variant="outline" className="shrink-0 bg-background/60 text-[11px] uppercase tracking-wide">
      v{data.version}
    </Badge>
  );
}

/**
 * Licence state on the Welcome screen. Free has no licence concept at all, PHP
 * sends `license: null` because the UiChemy_License class ships only with Pro –
 * so there is nothing to report and nothing to render.
 */
export function LicenceStatus() {
  return null;
}

/* ── Theme Builder: types this build does not ship ────────────────────────── */

/**
 * The crown pill next to a locked type's filter tab. Renders nothing for a type
 * this build does ship, so the caller needs no condition of its own.
 */
export function TypeBadge({ type, small, className }) {
  if (isPro()) { return null; }
  if (!isTypeLocked(type)) {
    return null;
  }
  return <ProBadge small={small} className={className} />;
}

/**
 * Whether this build can create `type` at all. Always true in Pro, so the Woo
 * "you can design it now" hint is never suppressed there.
 */
export function typeIsAvailable(type) {
  if (isPro()) { return true; }
  return !isTypeLocked(type);
}

/**
 * Intercepts a create() for a type this build does not ship: sends the user to
 * pricing and reports that it handled the click, so the caller just returns.
 * Pro's stub always returns false and creation proceeds, no branch at the call
 * site mentions tiers at all.
 *
 * @return {boolean} true when the upsell took over.
 */
export function upsellForType(type) {
  if (!isTypeLocked(type)) {
    return false;
  }
  window.open(upgradeUrl(), '_blank', 'noopener');
  return true;
}

/**
 * The "Add New" dropdown row for a locked type, badged, and opening pricing
 * instead of creating. `null` for an available type, which is what makes the
 * shared `lockedTypeItem(t) || <normal row>` fall through.
 */
export function lockedTypeItem(t) {
  if (!t || !isTypeLocked(t.key)) {
    return null;
  }
  return (
    <DropdownMenuItem
      key={t.key}
      onSelect={() => window.open(upgradeUrl(), '_blank', 'noopener')}
      className="text-muted-foreground"
    >
      {t.label}
      <ProBadge small />
    </DropdownMenuItem>
  );
}

/**
 * Shown under the Theme Builder's filter pills when the selected type is one this
 * build does not ship, so the empty grid reads as "this is Pro" rather than as
 * "you have not made one yet". Crown chip → title → subtext → CTA, with a soft
 * crown watermark, matching the dashboard's other Pro surfaces.
 */
export function LockedTypePanel({ type }) {
  if (isPro()) { return null; }
  if (!type || !isTypeLocked(type.key)) {
    return null;
  }
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#171717]/20 bg-gradient-to-br from-[#171717]/[0.07] via-card to-card p-5">
      <div className="pointer-events-none absolute -right-6 -top-8 text-[#171717]/[0.06] [&_svg]:size-36">
        <Icon name="crown" />
      </div>
      <div className="relative flex flex-wrap items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#171717]/10 text-[#171717] [&_svg]:size-5">
          <Icon name="crown" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Unlock {type.label} templates
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            {type.label} templates are part of UiChemy Pro, upgrade to design and use them on your site.
          </p>
        </div>
        <div className="shrink-0">
          <UpgradeButton source={`theme-builder-${type.key}`} />
        </div>
      </div>
    </div>
  );
}

/* ── Theme Builder Canvas ─────────────────────────────────────────────────── */

/**
 * The complete appearance of a Canvas slot whose type this build does not ship –
 * status word, corner badge, hover label and icon, and the drag tooltip. Returning
 * one object keeps all five pieces of copy in this file; the Canvas merges it over
 * its ordinary presentation. `null` means "nothing special about this slot", which
 * is every slot in Pro.
 */
export function slotPresentation(slot) {
  if (isPro()) { return null; }
  if (!slot || !isTypeLocked(slot.type)) {
    return null;
  }
  return {
    statusText: 'Pro',
    badge: 'UiChemy Pro',
    hoverIcon: 'crown',
    hoverLabel: 'Upgrade to Pro',
    title: `Drag to move · ${slot.label} templates are part of UiChemy Pro`,
  };
}

/**
 * The "N slots in Pro" pill on a Canvas category card. `count` is computed by the
 * shared view and is always 0 in the build that ships every type, but the wording
 * lives here so that build compiles none of it.
 */
export function LockedSlotCount({ count }) {
  if (isPro()) { return null; }
  if (!count || count < 1) {
    return null;
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 gap-0.5 px-1.5 text-[10px] text-muted-foreground"
      title={`${count} slot${count > 1 ? 's' : ''} available in UiChemy Pro`}
    >
      <ProBadge small />{count}
    </Badge>
  );
}

/**
 * The upgrade card pinned to the bottom of the sidebar. `mt-auto` on the last child
 * of the full-height column consumes the space above it, anchoring the card to the
 * bottom. Pro's stub returns null, so the sidebar simply ends after the nav.
 */
export function SidebarUpsell() {
  if (isPro()) { return null; }
  return (
    <div className="ptn-upgrade-card mt-auto">
      <a
        href={upgradeUrl()}
        target="_blank"
        rel="noreferrer"
        className="group flex cursor-pointer flex-col gap-1.5 rounded-[15px] bg-background p-3 transition-colors duration-200 ease-in-out hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-[#171717]/10 text-[#171717] [&_svg]:size-3.5">
            <Icon name="crown" />
          </span>
          <span className="text-sm font-semibold text-foreground">Upgrade to Pro</span>
        </span>
        <span className="block text-xs leading-relaxed text-muted-foreground">
          Unlock Role Manager, White Label, Pro theme templates and more.
        </span>
      </a>
    </div>
  );
}
