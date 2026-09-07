// Inspector panel rebuilt to the shadcn print-editor layout.
//
// Structure mirrors ds.shadcn.com/examples/print: a Style / Document tab split,
// quiet uppercase group headers instead of accordion bars, paired fields on one
// row (X|Y, W|H), a drag handle inside every numeric field, and optional
// properties sitting in place showing "Add…" rather than hiding behind an Add
// Property dropdown.
//
// Built from the project's own shadcn primitives (components/ui/*) and the real
// LengthInput, so it inherits the composer's skins, tokens and unit handling.
// Icons are free Hugeicons via the `I` map — check any new one first with
//   node tools/icon-check.mjs <name>
//
// Not wired into the composer yet: mount it, look at it, then decide.
import React from 'react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { I } from './composer-icons';
import { LengthInput } from './composer-inputs';

/* ── layout atoms ─────────────────────────────────────────────────────────── */

/** Quiet uppercase group header — no chevron, no divider, no fill. */
function Group({ title, children }) {
  return (
    <div className="iv2-group">
      <div className="iv2-group-head">{title}</div>
      <div className="iv2-group-body">{children}</div>
    </div>
  );
}

/** One row: label left, controls right. The single row primitive — every row
 *  in the panel goes through it, so the label column can never drift. */
function Row({ label, children }) {
  return (
    <div className="iv2-row">
      <span className="iv2-label">{label}</span>
      <span className="iv2-ctl">{children}</span>
    </div>
  );
}

/** Icon-only button sitting outside a field (link-sides, rotate nudge, remove). */
function IconBtn({ icon, title, active, onClick }) {
  return (
    <button
      type="button"
      className={cn('iv2-iconbtn', active && 'is-on')}
      title={title}
      aria-label={title}
      aria-pressed={active ? 'true' : undefined}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/** Numeric field with a glyph handle inside. Thin wrapper so every numeric row
 *  in this panel is declared the same way. */
function Num({ glyph, value, unit, units, onChange, onUnit, placeholder, hideUnit }) {
  return (
    <LengthInput
      glyph={glyph}
      hideUnit={hideUnit}
      value={value}
      unit={unit}
      units={units || ['px', '%', 'em', 'rem', 'vw', 'vh']}
      placeholder={placeholder}
      onChange={onChange}
      onUnit={onUnit}
    />
  );
}

/** Optional property: shows "Add…" until it has a value, then the value plus a
 *  swatch and a remove button. Replaces hunting in the Add Property dropdown. */
function AddField({ value, swatch, placeholder = 'Add…', onAdd, onRemove }) {
  const has = !!value;
  return (
    <>
      <button type="button" className="iv2-addfield" onClick={onAdd}>
        <span className={cn('iv2-addfield-text', !has && 'is-empty')}>
          {has ? value : placeholder}
        </span>
        {swatch !== undefined && (
          <span
            className={cn('iv2-swatch', has && 'is-filled')}
            style={has && swatch ? { background: swatch } : undefined}
          />
        )}
      </button>
      <IconBtn icon={<I.x size={12} sw={2} />} title="Remove" onClick={has ? onRemove : undefined} />
    </>
  );
}

/* ── panel ────────────────────────────────────────────────────────────────── */

const PAPER_SIZES = [
  ['a4', 'A4 (2480 × 3508)'],
  ['a3', 'A3 (3508 × 4961)'],
  ['letter', 'Letter (2550 × 3300)'],
];

export function InspectorV2({ value, onChange }) {
  // Uncontrolled fallback so the panel is mountable on its own for review.
  const [own, setOwn] = React.useState(() => ({
    x: '188', y: '2123', w: '2104', h: '448',
    radius: '0', padding: '0', rotate: '0',
    border: '', shadow: '', fill: '#3B82F6',
    radiusLinked: true, paddingLinked: true,
    paper: 'a4', orientation: 'portrait',
  }));
  const v = value ?? own;
  const set = (patch) => (onChange ? onChange({ ...v, ...patch }) : setOwn((p) => ({ ...p, ...patch })));

  const [unit, setUnit] = React.useState('px');

  return (
    <div className="iv2">
      <Tabs defaultValue="style" className="iv2-tabs">
        <TabsList className="iv2-tablist">
          <TabsTrigger value="style" className="iv2-tab">Style</TabsTrigger>
          <TabsTrigger value="document" className="iv2-tab">Document</TabsTrigger>
        </TabsList>

        <TabsContent value="style" className="iv2-tabpanel">
          <Group title="Layer">
            <Row label="Position">
              <Num hideUnit glyph="X" value={v.x} unit={unit} onChange={(x) => set({ x })} onUnit={setUnit} />
              <Num hideUnit glyph="Y" value={v.y} unit={unit} onChange={(y) => set({ y })} onUnit={setUnit} />
            </Row>
            <Row label="Size">
              <Num hideUnit glyph="W" value={v.w} unit={unit} onChange={(w) => set({ w })} onUnit={setUnit} />
              <Num hideUnit glyph="H" value={v.h} unit={unit} onChange={(h) => set({ h })} onUnit={setUnit} />
            </Row>
          </Group>

          <Group title="Styles">
            <Row label="Radius">
              <Num
                glyph={<I.radius size={12} sw={2} />}
                value={v.radius}
                unit={unit}
                onChange={(radius) => set({ radius })}
                onUnit={setUnit}
              />
              <IconBtn
                icon={v.radiusLinked ? <I.link size={12} sw={2} /> : <I.unlink size={12} sw={2} />}
                title={v.radiusLinked ? 'Corners linked — click to set each' : 'Corners independent'}
                active={v.radiusLinked}
                onClick={() => set({ radiusLinked: !v.radiusLinked })}
              />
            </Row>
            <Row label="Padding">
              <Num
                glyph={<I.padding size={12} sw={2} />}
                value={v.padding}
                unit={unit}
                onChange={(padding) => set({ padding })}
                onUnit={setUnit}
              />
              <IconBtn
                icon={v.paddingLinked ? <I.link size={12} sw={2} /> : <I.unlink size={12} sw={2} />}
                title={v.paddingLinked ? 'Sides linked — click to set each' : 'Sides independent'}
                active={v.paddingLinked}
                onClick={() => set({ paddingLinked: !v.paddingLinked })}
              />
            </Row>
            <Row label="Border">
              <AddField
                value={v.border}
                swatch={null}
                onAdd={() => set({ border: '1px solid' })}
                onRemove={() => set({ border: '' })}
              />
            </Row>
            <Row label="Shadow">
              <AddField
                value={v.shadow}
                swatch={null}
                onAdd={() => set({ shadow: '0 1px 2px' })}
                onRemove={() => set({ shadow: '' })}
              />
            </Row>
            <Row label="Fill">
              <AddField
                value={v.fill}
                swatch={v.fill}
                onAdd={() => set({ fill: v.fill || '#3B82F6' })}
                onRemove={() => set({ fill: '' })}
              />
            </Row>
          </Group>

          <Group title="Transforms">
            <Row label="Rotate">
              <Num
                glyph={<I.angle size={12} sw={2} />}
                value={v.rotate}
                unit="deg"
                units={['deg', 'turn', 'rad']}
                onChange={(rotate) => set({ rotate })}
                onUnit={() => {}}
              />
              <IconBtn
                icon={<I.rotateCcw size={12} sw={2} />}
                title="Rotate counter-clockwise"
                onClick={() => set({ rotate: String((parseFloat(v.rotate) || 0) - 90) })}
              />
              <IconBtn
                icon={<I.rotateCw size={12} sw={2} />}
                title="Rotate clockwise"
                onClick={() => set({ rotate: String((parseFloat(v.rotate) || 0) + 90) })}
              />
            </Row>
            <Row label="Flip">
              <span className="iv2-btn-pair">
                <IconBtn icon={<I.flipH size={12} sw={2} />} title="Flip horizontally" />
                <IconBtn icon={<I.flipV size={12} sw={2} />} title="Flip vertically" />
              </span>
            </Row>
          </Group>
        </TabsContent>

        <TabsContent value="document" className="iv2-tabpanel">
          <Group title="Paper">
            <Row label="Size">
              <select
                className="iv2-select"
                value={v.paper}
                onChange={(e) => set({ paper: e.target.value })}
              >
                {PAPER_SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Row>
            <Row label="Orientation">
              <select
                className="iv2-select"
                value={v.orientation}
                onChange={(e) => set({ orientation: e.target.value })}
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </Row>
          </Group>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default InspectorV2;
