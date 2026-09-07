import React from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { PERSONAS } from '../../dashboard/personas.js';

/* ============================================================
   Onboarding, Step 1: Personalization ("About you").

   Full-width rows with the springy check badge, the same design as the Builder
   / Mode steps (no in-card "Select" button; selection is the outline + check,
   the wizard's Continue commits). The pick is stored client-side and pre-selects
   the recommended mode, so the rest of the wizard reflects how the user works.
   ============================================================ */

export default function PersonalizeScreen({ selected, onSelect }) {
  return (
    <div className="choices">
      {PERSONAS.map((p) => {
        const IconEl = p.icon;
        const isSelected = selected === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`choice ${isSelected ? 'choice--selected' : ''}`}
            onClick={() => onSelect(p.id)}
            aria-pressed={isSelected}
          >
            <span className={`choice__logo ${p.brandLogo ? 'choice__logo--brand' : ''}`}><IconEl size={22}/></span>
            <div className="choice__body">
              <div className="choice__title">{p.label}</div>
              <p className="choice__desc">{p.desc}</p>
            </div>
            <span className="choice__check" aria-hidden="true"><Icon.Check size={12}/></span>
          </button>
        );
      })}
    </div>
  );
}
