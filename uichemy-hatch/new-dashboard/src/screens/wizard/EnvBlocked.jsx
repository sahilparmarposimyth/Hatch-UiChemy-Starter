import React from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Button } from '../../design-system';

// Environment checks. `tone` drives the severity dot + eyebrow; each state gets
// its own glyph so it reads at a glance (matches screens/errors/ErrorCard.jsx).
const COPY = {
  // Keep this number in step with the `wp_ok` gate in class-uich-nd-settings.php.
  'wp-old':      { tone: 'info', icon: Icon.Wordpress,  eyebrow: __('Update needed', 'uichemy'), title: __('WordPress is a little out of date', 'uichemy'), body: __('UiChemy needs WordPress 6.9 or newer. Update from Dashboard → Updates and re-run the check.', 'uichemy'), action: __('Update WordPress', 'uichemy'), actionHref: 'update-core.php' },
  'php-old':     { tone: 'info', icon: Icon.Php,        eyebrow: __('Update needed', 'uichemy'), title: __('Your PHP version is too old', 'uichemy'), body: __('UiChemy needs PHP 7.4 or newer. Your host can switch the PHP version in seconds.', 'uichemy'), action: __('Contact your host', 'uichemy') },
  'missing-ext': { tone: 'warn', icon: Icon.Puzzle,     title: __('A PHP extension is missing', 'uichemy'), body: __('UiChemy needs the JSON and mbstring extensions to be enabled. Ask your host to enable them.', 'uichemy'), action: __('Show me how', 'uichemy') },
  'low-memory':  { tone: 'info', icon: Icon.Gauge,      eyebrow: __('Heads up', 'uichemy'), title: __('Low memory', 'uichemy'), body: __('You can keep going, but conversions of large designs may fail. Bumping memory_limit to 256M is recommended.', 'uichemy'), action: __('Continue anyway', 'uichemy') },
  'not-admin':   { tone: 'warn', icon: Icon.UserShield, eyebrow: __('Access required', 'uichemy'), title: __('Administrator access required', 'uichemy'), body: __("You'll need an Administrator account to set up UiChemy. Ask your site admin to finish this step.", 'uichemy'), action: __('OK', 'uichemy') },
};

const EYEBROW = { warn: __('Action needed', 'uichemy'), info: __('Heads up', 'uichemy') };

export default function EnvBlocked({ variant = 'wp-old', env = {}, onContinue }) {
  const c = COPY[variant] || COPY['wp-old'];
  const IconEl = c.icon || Icon.Warn;
  const eyebrow = c.eyebrow || EYEBROW[c.tone] || EYEBROW.warn;
  const hasVersion = variant === 'wp-old' || variant === 'php-old';
  // "Continue anyway" is a soft dismiss (non-blocking), so it stays neutral;
  // every other env action is the real fix, so it takes the brand button.
  const isDismiss = variant === 'low-memory';
  return (
    <div className={`calm calm--${c.tone}`} role="alert">
      <div className="calm__badge">
        <span className="calm__icon"><IconEl size={24}/></span>
        <span className="calm__sev" aria-hidden="true" />
      </div>
      <span className="calm__eyebrow">{eyebrow}</span>
      <h2>{c.title}</h2>
      <p>{c.body}</p>
      {hasVersion && (
        <div className="calm__detail">
          <div className="calm__detail-cell">
            <span className="calm__detail-label">{__('Your version', 'uichemy')}</span>
            <span className="calm__detail-val calm__detail-val--fail">
              <Icon.Warn size={14} />
              {variant === 'wp-old' ? (env.wp_version || '–') : (env.php_version || '–')}
            </span>
          </div>
          <div className="calm__detail-cell">
            <span className="calm__detail-label">{__('Required', 'uichemy')}</span>
            <span className="calm__detail-val">
              {variant === 'wp-old' ? __('6.9 or newer', 'uichemy') : __('7.4 or newer', 'uichemy')}
            </span>
          </div>
        </div>
      )}
      <div className="calm__actions">
        {c.actionHref ? (
          <Button variant="solid" tone="brand" asChild><a href={c.actionHref}>{c.action}</a></Button>
        ) : (
          <Button variant={isDismiss ? 'outline' : 'solid'} tone={isDismiss ? 'neutral' : 'brand'} onClick={onContinue}>{c.action}</Button>
        )}
      </div>
    </div>
  );
}
