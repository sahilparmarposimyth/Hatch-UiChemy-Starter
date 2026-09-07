import React from 'react';
import { Tooltip as DSTooltip } from '../../design-system';

/**
 * Webpage Tooltip, now a thin adapter over the design-system Tooltip (Radix).
 * API preserved (content / placement / children / className). Children are
 * wrapped in a single span so Radix's asChild trigger always gets exactly one
 * element, regardless of what the caller passes. A TooltipProvider is mounted
 * at the app root (index.js), which this flow renders inside.
 */
const SIDES = ['top', 'bottom', 'left', 'right'];

export default function Tooltip({ content, placement = 'top', children, className = '' }) {
  if (content == null || content === '') return children || null;
  const side = SIDES.includes(placement) ? placement : 'top';

  return (
    <DSTooltip content={content} side={side}>
      <span className={`uich-wpc-tt ${className}`.trim()} style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </DSTooltip>
  );
}
