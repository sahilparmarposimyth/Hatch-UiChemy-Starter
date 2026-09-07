// License screen — Pro only. Activates / deactivates the EDD license key against
// store.posimyth.com, matching how the other Posimyth Pro plugins work.
//
// IMPORTANT: this is a SOFT gate. UiChemy Pro works fully without a license, so
// nothing here unlocks a feature — it grants updates and support. The copy says
// so plainly rather than implying features are locked.
//
// Layout (Mobbin-informed — Midjourney / Whereby / Kajabi subscription screens):
// a top-down flow that fills the width instead of a cramped left/right split.
//   1. Activation HERO — a full-width card: license status on the left, the key
//      field + primary action inline on the right (split by a hairline divider).
//   2. Benefits BAND — "what a license gives you", full-width cards side by side.
//   3. Help ROW — a slim footer band of account / docs / support links.
// On-brand throughout; the mint/#0e7c6b active state and peach grace notice stay.
//
// The raw key is never rendered: PHP returns a masked value (`maskedKey`), so the
// field shows asterisks once a license is stored.
import React from 'react';
// Island (.uich-tw) controls: the builder's shadcn ui/* components, which
// brand.css already bridges to the UiChemy DS (monochrome surfaces/text, orange
// only on the primary CTA, Zalando Sans). These — NOT the main dashboard's DS
// React components — are what render correctly inside the island (the DS ones
// break under the island's different scope / Tailwind reset; see RoleManager).
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { data, ajax } from '../data';
import { Icon } from '../icons';

// EDD customer dashboard — where keys, sites and renewals are managed. Same store
// the license calls go to (store.posimyth.com), so both links stay consistent.
// Deliberately NOT campaign-tagged: it is an account destination the customer
// already paid to reach, not marketing traffic.
const STORE_ACCOUNT_URL = 'https://store.posimyth.com/dashboard/';

// Helpdesk — the "priority support" this screen promises, made reachable from it.
// Untagged for the same reason as the account link: support is an entitlement
// being redeemed, not a campaign to attribute.
const SUPPORT_URL = 'https://store.posimyth.com/helpdesk/';

// Docs, tagged the same way as the Welcome screen's outbound links. Source and
// medium match (the click is still the WordPress admin, still the dashboard);
// only the campaign changes, so License traffic is distinguishable from Welcome.
const DOCS_URL = 'https://docs.uichemy.com/?utm_source=wpbackend&utm_medium=dashboard&utm_campaign=license';

// What a license grants (soft gate — features already work). Sold as benefits.
const BENEFITS = [
  { icon: 'plug', title: 'Automatic updates', desc: 'New features & fixes the moment they ship.' },
  { icon: 'help', title: 'Priority support', desc: 'Direct help from the Posimyth team when you need it.' },
];

// Help destinations, rendered as a slim footer row of links.
const HELP_LINKS = [
  { icon: 'crown', label: 'Your account', href: STORE_ACCOUNT_URL },
  { icon: 'book', label: 'Documentation', href: DOCS_URL },
  { icon: 'help', label: 'Support', href: SUPPORT_URL },
];

export function License() {
  const [status, setStatus] = React.useState(data.license || null);
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [msg, setMsg] = React.useState(null); // { ok: bool, text: string }

  const active = !!(status && status.isValid);

  const run = (type, fields, okText) => {
    setBusy(type);
    setMsg(null);
    ajax(type, fields)
      .then((res) => {
        if (res && res.license) setStatus(res.license);
        setKey('');
        // Our own copy wins over the server's generic message so the wording
        // matches the sibling Pro plugins exactly.
        setMsg({ ok: true, text: okText || (res && res.message) });
      })
      .catch((e) => setMsg({ ok: false, text: (e && e.message) || 'Something went wrong. Please try again.' }))
      .finally(() => setBusy(''));
  };

  // Clean, professional confirmations (no celebratory emoji).
  const activate = () => run('license_activate', { license: key }, 'License activated successfully.');
  const deactivate = () => run('license_deactivate', {}, 'License deactivated.');

  return (
    <div className="uich-tw">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 pb-4">
          <h1 className="text-2xl font-medium tracking-tight text-foreground">Activate License</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Activate your license to receive automatic updates and priority support. Every Pro feature works whether or not a license is active.
          </p>
        </div>

        <div className="ptn-scroll flex min-h-0 flex-1 flex-col gap-6 pb-2">

          {/* 1 ─ Activation hero: status on the left, key + action on the right. */}
          <div className="rounded-2xl bg-muted/50 p-3">
          <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your license</p>
          <Card className="overflow-hidden border shadow-none">
            <div className="flex flex-col divide-y lg:flex-row lg:divide-x lg:divide-y-0">
              {/* Status — the persistent, at-a-glance state. */}
              <div className="flex items-start gap-4 p-5 sm:p-6 lg:w-[38%]">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px] ${active ? 'bg-[#0e7c6b]/10 text-[#0e7c6b]' : 'bg-muted text-muted-foreground'}`}>
                  <Icon name={active ? 'check-circle' : 'lock'} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-sm font-semibold text-foreground">
                      {active ? 'License active' : 'License not active'}
                    </span>
                    {active && status && status.expires && (
                      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground [&_svg]:size-3.5">
                        <Icon name="calendar" />
                        {status.expires === 'lifetime'
                          ? 'Lifetime, never expires'
                          : `Valid until ${String(status.expires).split(' ')[0]}`}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                    {active
                      ? (status && status.customer ? `Registered to ${status.customer}.` : 'Automatic updates and support are enabled.')
                      : 'Your Pro features are fully working. A license adds automatic updates and priority support.'}
                  </p>
                </div>
              </div>

              {/* Key + action */}
              <div className="flex-1 p-5 sm:p-6">
                {active ? (
                  <div className="flex flex-col gap-3">
                    <Label className="text-[13px] font-medium">License key</Label>
                    <div className="flex flex-col gap-2.5 sm:flex-row">
                      <Input value={status.maskedKey || ''} readOnly className="flex-1 font-mono" />
                      <Button variant="outline" onClick={deactivate} disabled={!!busy} className="sm:shrink-0">
                        {busy === 'license_deactivate' ? 'Deactivating…' : 'Deactivate'}
                      </Button>
                    </div>
                    <a
                      href={STORE_ACCOUNT_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Manage your licenses
                    </a>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <Label htmlFor="ptn-license-key" className="text-[13px] font-medium">License key</Label>
                    <div className="flex flex-col gap-2.5 sm:flex-row">
                      <Input
                        id="ptn-license-key"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && key.trim() && !busy) activate(); }}
                        placeholder="Paste your license key"
                        className="flex-1 font-mono"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button onClick={activate} disabled={!!busy || !key.trim()} className="sm:shrink-0">
                        {busy === 'license_activate' ? 'Activating…' : 'Activate license'}
                      </Button>
                    </div>
                    <a
                      href={STORE_ACCOUNT_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Where do I find my key?
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Result message — full width under the hero. */}
            {msg && (
              <div className="border-t p-4 sm:px-6">
                <p
                  className={[
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] [&_svg]:size-4 [&_svg]:shrink-0',
                    msg.ok ? 'border-[#0e7c6b]/20 bg-[#0e7c6b]/[0.06] text-[#0e7c6b]' : 'border-destructive/20 bg-destructive/10 text-destructive',
                  ].join(' ')}
                >
                  <Icon name={msg.ok ? 'check-circle' : 'info'} aria-hidden="true" />
                  {msg.text}
                </p>
              </div>
            )}
          </Card>
          </div>

          {/* Offline grace: the store couldn't be reached on the last check. */}
          {status && status.graceUntil > 0 && (
            <p className="rounded-lg border border-[#b4603a]/20 bg-[#fbe0d0]/40 px-4 py-2.5 text-[13px] text-[#b4603a]">
              The license server couldn&apos;t be reached on the last check. Your license stays
              active until {new Date(status.graceUntil * 1000).toLocaleDateString()} while we keep
              retrying. No action needed.
            </p>
          )}

          {/* 2 ─ Benefits band — full width, side by side. */}
          <section className="rounded-2xl bg-muted/50 p-3">
            <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              What a license gives you
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {BENEFITS.map((b) => (
                <Card key={b.title} className="flex items-start gap-3 p-4 shadow-none">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-[18px]">
                    <Icon name={b.icon} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground">{b.title}</div>
                    <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{b.desc}</div>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          {/* 3 ─ Help footer row. */}
          <Card className="flex flex-col gap-3 bg-muted/30 p-4 shadow-none sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">Need a hand?</p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                Manage sites &amp; renewals, read the setup guide, or contact support.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              {HELP_LINKS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-1.5 font-medium text-foreground [&_svg]:size-4 hover:text-[#171717]"
                >
                  <Icon name={l.icon} />
                  {l.label}
                  <Icon name="arrow-up-right" className="text-muted-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </a>
              ))}
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
