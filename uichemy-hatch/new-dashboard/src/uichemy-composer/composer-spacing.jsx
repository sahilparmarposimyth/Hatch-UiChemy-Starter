// Visual Spacing widget, Webflow/Framer-style nested margin / padding.
import React from 'react';
import { I } from './composer-icons';
import { UnitPill } from './composer-inputs';

export function SpacingBox({
  spacing, getUnit, setUnit, onChange, widthLabel, heightLabel,
  cellData, setValue, setBoxUnit, getBoxUnit,
}) {
  const T = I;
  const [linkMar, setLinkMar] = React.useState(false);
  const [linkPad, setLinkPad] = React.useState(false);
  // Units are stored per-side in the scope (`spacing.marTop`, `spacing.padRight`, …)
  //, that's the canonical shape the CSS parser/writer read. The pill is a single
  // shared control per box. `getBoxUnit` reflects the unit of whichever side
  // actually carries a value (or the pending pill choice), so a single-side
  // value like padding-left still drives the pill instead of always reading Top.
  const marUnit = getBoxUnit ? getBoxUnit('mar') : getUnit('spacing.marTop', 'px');
  const padUnit = getBoxUnit ? getBoxUnit('pad') : getUnit('spacing.padTop', 'px');

  // Cascade-aware helpers come from the inspector so the box behaves like every
  // other field: it shows a class/parent-inherited value as the placeholder,
  // keeps the inherited unit when a value is typed over it, and materialises the
  // inherited value when the unit pill is changed. Fallbacks below keep the box
  // functional (own-value only) if the host doesn't pass the helpers.
  const cData = cellData || ((prefix, side) => ({
    value: spacing[`${prefix}${side}`] || '',
    placeholder: '0',
  }));

  function set(prefix, side, v, linked) {
    if (setValue) { setValue(prefix, side, v, linked); return; }
    if (linked) {
      onChange({
        [`${prefix}Top`]: v, [`${prefix}Right`]: v,
        [`${prefix}Bottom`]: v, [`${prefix}Left`]: v,
      });
    } else {
      onChange({ [`${prefix}${side}`]: v });
    }
  }

  function setSideUnit(prefix, u) {
    if (setBoxUnit) { setBoxUnit(prefix, u); return; }
    ['Top', 'Right', 'Bottom', 'Left'].forEach((side) => {
      setUnit(`spacing.${prefix}${side}`, u);
    });
  }

  const cell = (prefix, side) => {
    const d = cData(prefix, side);
    return (
      <input
        className="sb-cell"
        value={d.value}
        placeholder={d.placeholder || '0'}
        onChange={(e) => set(prefix, side, e.target.value, prefix === 'mar' ? linkMar : linkPad)}
      />
    );
  };

  return (
    <div className="sb">
      <div className="sb-row">
        <span className="sb-label">Margin</span>
        <div className="sb-tools">
          <button
            className={`sb-link${linkMar ? ' on' : ''}`}
            onClick={() => setLinkMar(l => !l)}
            title={linkMar ? 'Unlink sides' : 'Link all sides'}
          >
            <T.link size={10} />
          </button>
          <UnitPill unit={marUnit} units={['px','%','em','rem','vw','vh','auto']} onChange={(u) => setSideUnit('mar', u)} />
        </div>
      </div>

      <div className="sb-mar">
        {cell('mar', 'Top')}
        <div className="sb-mar-mid">
          {cell('mar', 'Left')}
          <div className="sb-pad-wrap">
            <div className="sb-row sb-pad-row">
              <span className="sb-label sb-label-inner">Padding</span>
              <div className="sb-tools">
                <button
                  className={`sb-link${linkPad ? ' on' : ''}`}
                  onClick={() => setLinkPad(l => !l)}
                  title={linkPad ? 'Unlink sides' : 'Link all sides'}
                >
                  <T.link size={10} />
                </button>
                <UnitPill unit={padUnit} units={['px','%','em','rem','vw','vh']} onChange={(u) => setSideUnit('pad', u)} />
              </div>
            </div>
            <div className="sb-pad">
              {cell('pad', 'Top')}
              <div className="sb-pad-mid">
                {cell('pad', 'Left')}
                <div className="sb-content">
                  <span>{widthLabel || 'auto'}</span>
                  <span className="sb-x">×</span>
                  <span>{heightLabel || 'auto'}</span>
                </div>
                {cell('pad', 'Right')}
              </div>
              {cell('pad', 'Bottom')}
            </div>
          </div>
          {cell('mar', 'Right')}
        </div>
        {cell('mar', 'Bottom')}
      </div>
    </div>
  );
}
