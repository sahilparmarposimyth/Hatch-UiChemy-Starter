import React from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from './icons.jsx';

/**
 * The AI tools the built-in MCP server works with. Single source of truth so
 * the dashboard AI Agent (MCP) panel and the onboarding mode card always show
 * the same set and the same brand marks. Claude uses the real Hugeicons mark;
 * Cursor / Codex use the hand-authored stand-ins in icons.jsx (swap for
 * official brand SVGs when design supplies them).
 */
export const MCP_TOOLS = [
  { name: __( 'Claude', 'uichemy' ), Mark: Icon.Claude },
  { name: __( 'Cursor', 'uichemy' ), Mark: Icon.CursorLogo },
  { name: __( 'Codex', 'uichemy' ), Mark: Icon.CodexLogo },
];

/**
 * Compact inline marks + names for tight spots (e.g. the onboarding mode card),
 * where the labelled strip would be too heavy.
 */
export function ToolLogosInline( { size = 15 } ) {
  return (
    <span className="tool-logos">
      { MCP_TOOLS.map( ( { name, Mark } ) => (
        <span className="tool-logos__item" key={ name }>
          <Mark size={ size } /> { name }
        </span>
      ) ) }
    </span>
  );
}
