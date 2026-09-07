import React, { useEffect, useState } from 'react';
import { __ } from '@wordpress/i18n';
import Modal from './Modal.jsx';
import Button from './Button.jsx';
import { RadioGroup, RadioItem } from '../../design-system';

/* Builder badges, exact glyphs from Figma node 1114:32917, recreated as
   inline SVG (white logo on a rounded brand-color square). */
const ElementorBadge = () => (
  <svg className="uich-wpc-builder-modal__badge" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect width="20" height="20" rx="6" fill="#92003B" />
    <g transform="translate(5.835 5.834)" fill="#ffffff">
      <path d="M0 8.33233H1.66577V0H0V8.33233Z" />
      <path d="M3.33153 8.33233H8.33063V6.66664H3.33153V8.33233Z" />
      <path d="M3.33153 4.99907H8.33063V3.33333H3.33153V4.99907Z" />
      <path d="M3.33153 1.66576H8.33063V0H3.33153V1.66576Z" />
    </g>
  </svg>
);

const GutenbergBadge = () => (
  <svg className="uich-wpc-builder-modal__badge" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect width="20" height="20" rx="6" fill="#287CB2" />
    <path
      transform="translate(5.587 14.605) scale(1 -1)"
      fill="#ffffff"
      d="M1.99144 8.90837C0.479931 8.25121 -0.0989437 6.84301 0.0136153 4.13614C0.0779347 2.75924 0.158334 2.25855 0.431691 1.75785C1.12313 0.443536 2.26479 -0.119744 3.9371 0.0210763C5.12701 0.0993094 5.97924 0.553062 6.36516 1.27281C6.52596 1.57009 6.65459 2.28984 6.70283 3.05652C6.76715 4.29261 6.78323 4.33955 7.20131 4.43343C7.79626 4.5586 8.82537 5.40352 8.82537 5.77904C8.82537 6.21715 8.39122 6.15456 7.7641 5.62257C7.41035 5.32529 6.92795 5.10623 6.30084 4.98106C4.51597 4.63683 4.19438 4.51166 3.6959 3.96403C3.14919 3.35381 3.06879 2.99394 3.4547 2.83747C3.6155 2.77488 3.8567 2.93135 4.1783 3.30687C4.62853 3.82321 5.48077 4.27696 5.67372 4.0892C5.72196 4.02662 5.7702 3.6198 5.7702 3.1504C5.7702 1.49186 5.07877 0.756468 3.55118 0.756468C2.61855 0.756468 1.84672 1.19457 1.36432 2.0082C1.07489 2.4776 1.02665 2.82182 1.02665 4.51166C1.02665 6.74913 1.26784 7.45323 2.21656 8.06345C3.3743 8.81449 5.17525 8.39203 5.59332 7.24982C5.94708 6.34232 6.26868 6.15456 6.5742 6.71784C6.71891 6.96818 6.68675 7.17159 6.4134 7.71922C5.7702 9.03354 3.58334 9.61247 1.99144 8.90837Z"
    />
  </svg>
);

const BUILDERS = {
  elementor: { label: 'Elementor', Badge: ElementorBadge },
  gutenberg: { label: 'Gutenberg', Badge: GutenbergBadge },
};

/**
 * "Choose Your Builder" modal (Figma node 1114:32917). Asks which builder the
 * user wants to export the selected website in. Built on the shared <Modal>.
 *
 * @param {boolean}                 props.open
 * @param {() => void}              props.onClose
 * @param {(builder:string)=>void}  props.onConfirm          fired with the chosen builder on Next
 * @param {string[]}                [props.builders=['elementor','gutenberg']]
 * @param {string}                  [props.defaultBuilder='elementor']
 */
export default function BuilderModal({
  open,
  onClose,
  onConfirm,
  builders = ['elementor', 'gutenberg'],
  defaultBuilder = 'elementor',
}) {
  const options = builders.filter((b) => BUILDERS[b]);
  const [selected, setSelected] = useState(defaultBuilder);

  // Reset the selection each time the modal opens.
  useEffect(() => {
    if (open) {
      setSelected(options.includes(defaultBuilder) ? defaultBuilder : options[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultBuilder]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ __( 'Choose Your Builder', 'uichemy' ) }
      description={ __( 'Select the builder you want to import this website into.', 'uichemy' ) }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            { __( 'Cancel', 'uichemy' ) }
          </Button>
          <Button variant="primary" onClick={() => onConfirm?.(selected)}>
            { __( 'Next', 'uichemy' ) }
          </Button>
        </>
      }
    >
      <RadioGroup
        className="uich-wpc-builder-modal__options"
        aria-label={ __( 'Export builder', 'uichemy' ) }
        value={selected}
        onValueChange={setSelected}
      >
        {options.map((key) => {
          const { label, Badge } = BUILDERS[key];
          const isSelected = selected === key;
          const id = `uich-wpc-builder-${key}`;
          return (
            <label
              key={key}
              htmlFor={id}
              className={`uich-wpc-builder-modal__option${isSelected ? ' is-selected' : ''}`}
            >
              <span className="uich-wpc-builder-modal__option-left">
                <Badge />
                <span className="uich-wpc-builder-modal__option-label">{label}</span>
              </span>
              <RadioItem value={key} id={id} />
            </label>
          );
        })}
      </RadioGroup>
    </Modal>
  );
}
