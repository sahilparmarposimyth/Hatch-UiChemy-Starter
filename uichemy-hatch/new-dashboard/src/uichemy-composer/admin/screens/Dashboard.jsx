// Dashboard (Welcome) screen, rebuilt on the shadcn design system: neutral
// zinc tokens (bg-card / bg-primary / muted-foreground / border) and the shadcn
// primitives (Card family, Button, Input, Label, Badge) in place of the old
// hard-coded purple/pink brand palette. All content lives inside a single white
// panel that floats on the grey app background; inner cards are flat (border,
// no shadow) so they read as crisp sections. Scoped to its own `.uich-tw`
// island (see Shell) so the shadcn theme applies here only.
import React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { data } from '../data';
import { Icon } from '../icons';
import { WhatsNewDrawer } from '../WhatsNew';
import { LicenceStatus } from '../pro';

// Outbound destinations, in one place so a URL is never buried in markup and the
// campaign tagging cannot drift between links.
//
// Links to sites we own carry the same three parameters:
//   utm_source=wpbackend   the click came from the WordPress admin
//   utm_medium=dashboard   the UiChemy dashboard, not the editor or the front end
//   utm_campaign=welcome   the Welcome screen
//
// YouTube is left untagged on purpose: it does not forward query parameters into
// any analytics we can read, so the tags would be decoration on a URL users can
// see and copy.
const UTM = 'utm_source=wpbackend&utm_medium=dashboard&utm_campaign=welcome';

function outbound(url) {
  return `${url}${url.indexOf('?') === -1 ? '?' : '&'}${UTM}`;
}

const LINKS = {
  learnMore: outbound('https://uichemy.com/'),
  docs: outbound('https://docs.uichemy.com/'),
  requestFeature: outbound('https://uichemy.com/'),
  tutorials: 'https://www.youtube.com/@posimyth',
};

// Stat card, a grey frame with an eyebrow header (icon + label + info glyph)
// wrapping a white inner card that holds the metric and a footer link. Mirrors
// the "SALES TO DATE" reference layout.
function StatCard({ icon, label, value, hint, cta, ctaUrl }) {
  return (
    <div className="rounded-2xl bg-muted p-3">
      <div className="flex items-center justify-between px-1.5 pb-2.5 pt-0.5">
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Icon name={icon} className="size-4" />
          {label}
        </span>
        <Icon name="info" className="size-4 text-muted-foreground/50" />
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>
          {cta ? (
            <a href={ctaUrl} className="shrink-0 text-xs font-medium text-foreground underline underline-offset-4 hover:no-underline">
              {cta}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Compact, minimal resource link: the whole card is the link (no button), a
// small icon, title, one-line description, and a subtle external-arrow that
// nudges on hover.
function ResourceCard({ icon, title, desc, url }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      className="group flex items-center gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-[18px]">
        <Icon name={icon} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{desc}</p>
      </div>
      <Icon name="arrow-up-right" className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  );
}

export function Dashboard() {
  const siteName = data.siteName || 'Your Site';
  const userName = data.userName || '';
  const forms = Number(data.formsCount || 0);
  const urls = data.urls || {};
  const [whatsNew, setWhatsNew] = React.useState(false);

  return (
    <div className="uich-tw">
      <div className="ptn-scroll min-h-0 flex-1 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-6">
          {/* Page header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Welcome back{userName ? `, ${userName}` : ''}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Here&apos;s what&apos;s happening on {siteName}.
                </p>
              </div>
            </div>
            {/* No unread count until there is a feed to count. The badge used to
                be a hardcoded "1", so every user saw a permanent unread marker over
                a panel that says updates are still to come. When WhatsNew.jsx starts
                fetching posts, bring the badge back driven by a real number. */}
            <Button variant="outline" onClick={() => setWhatsNew(true)}>
              <Icon name="bulb" />
              What&apos;s New
            </Button>
          </div>

          {/* Licence state, for the build that has one. Free has no licence at
              all, so its tier module renders nothing here and the stats follow
              the header directly. */}
          <LicenceStatus />

          {/* Stats + promo */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <StatCard
              icon="code"
              label="Universal AI widget"
              value="1"
              hint="Powered by the Composer engine"
              cta="Start building"
              ctaUrl={urls.startBuilding}
            />
            <StatCard
              icon="inbox"
              label="Form submissions"
              value={forms.toLocaleString()}
              hint={forms > 0 ? 'Captured across your site' : 'No submissions yet'}
              cta="View submissions"
              ctaUrl={urls.forms}
            />

            {/* Promo, emphasized dark banner spanning both stat columns */}
            <Card className="flex flex-col justify-center border-0 bg-primary text-primary-foreground shadow-none md:col-span-2">
              <CardHeader>
                <span className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-foreground/10 text-primary-foreground [&_svg]:size-5">
                  <Icon name="code" />
                </span>
                <CardTitle className="text-2xl font-bold text-primary-foreground">
                  Build any section of any website with AI.
                </CardTitle>
                <CardDescription className="max-w-2xl text-primary-foreground/70">
                  Describe what you want and the Composer widget builds it, clean, responsive HTML &amp; CSS that respects your global styles.
                </CardDescription>
              </CardHeader>
              <CardFooter className="gap-2">
                <Button asChild variant="secondary">
                  <a href={urls.startBuilding}>Start Building</a>
                </Button>
                <a
                  href={LINKS.learnMore}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-9 items-center px-3 text-sm font-medium text-primary-foreground/80 underline-offset-4 transition-colors hover:text-primary-foreground hover:underline"
                >
                  Learn More
                </a>
              </CardFooter>
            </Card>
          </div>

          {/* Resources */}
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">Resources</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <ResourceCard icon="book" title="Documentation" desc="Guides for every UiChemy feature." url={LINKS.docs} />
              <ResourceCard icon="bulb" title="Request Feature" desc="Shape the UiChemy roadmap." url={LINKS.requestFeature} />
              <ResourceCard icon="video" title="Video Tutorials" desc="Watch UiChemy in action." url={LINKS.tutorials} />
            </div>
          </div>
        </div>
      </div>

      <WhatsNewDrawer open={whatsNew} onClose={() => setWhatsNew(false)} />
    </div>
  );
}
