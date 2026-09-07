import React from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Badge } from '../../design-system';
import { ToolLogosInline } from '../../components/ToolLogos.jsx';
import { MODES, modeSupportsBuilder } from '../../dashboard/modes.js';

/* ============================================================
   Step 1, Mode picker.

   Full-width rows (the base `.choice` card, logo left, title + one chip,
   description, and the springy `.choice__check` badge on the right). Selection
   is carried by the outline + check, not an in-card button; the wizard's
   Continue commits. Rows read cleaner here than a card grid, a short list of
   distinct options, each with a one-line description (Airwallex / Copy.ai /
   Semrush onboarding pattern).

   The card list comes from dashboard/modes.js so this screen and the Import
   tab's dropdown always offer the same options.
   ============================================================ */

export default function ModeScreen({ selected, onSelect, builder }) {
  return (
    <div className="choices">
      {MODES.map((m) => {
        const IconEl = m.icon;
        const isSelected = selected === m.id;
        // A builder mismatch disables a card, but ONLY once a builder is
        // actually chosen. In the onboarding order the mode is picked first
        // (no builder yet), so every option must stay selectable then; the
        // builder step enforces compatibility afterwards.
        const disabled = !!builder && !modeSupportsBuilder(m.id, builder);

        return (
          <button
            key={m.id}
            type="button"
            className={`choice ${isSelected ? 'choice--selected' : ''} ${disabled ? 'choice--disabled' : ''}`}
            onClick={() => !disabled && onSelect(m.id)}
            aria-disabled={disabled}
            aria-pressed={isSelected}
          >
            <span className={`choice__logo ${m.brandLogo ? 'choice__logo--brand' : ''}`}><IconEl size={22}/></span>
            <div className="choice__body">
              <div className="choice__title">
                {m.label}
                <span className="choice__pills">
                  {disabled
                    ? <Badge tone="warning" variant="soft">{__('Not available for this builder', 'uichemy')}</Badge>
                    : m.id === 'compose'
                      ? <ToolLogosInline />
                      : <Badge tone={m.badge.variant} variant="soft">{m.badge.text}</Badge>}
                  {/* Drop the neutral category chip when it just repeats the
                      status chip (e.g. "New" + "New"). */}
                  {(disabled || m.meta.toLowerCase() !== String(m.badge.text).toLowerCase()) && (
                    <Badge tone="neutral" variant="soft">{m.meta}</Badge>
                  )}
                </span>
              </div>
              <p className="choice__desc">{m.desc}</p>
            </div>
            {/* Selection badge, springs in when picked; disabled rows never
                show one. Occupies its 20px slot even when hidden so the rows
                stay aligned. */}
            {!disabled && <span className="choice__check" aria-hidden="true"><Icon.Check size={12}/></span>}
          </button>
        );
      })}
    </div>
  );
}
