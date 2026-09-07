import { __ } from '@wordpress/i18n';
import * as Icon from '../components/icons.jsx';

/**
 * Persona options for the onboarding "About you" step.
 *
 * Each persona maps to the `mode` we recommend (and pre-select) for that kind
 * of user, so the rest of the wizard, and the Mode step's default, reflects
 * how they'll actually work. Kept client-side (localStorage, `uich_nd_persona`)
 * so it tailors copy + the mode default with no server round-trip.
 */
export const PERSONAS = [
  {
    id: 'designer',
    label: __( 'Designer', 'uichemy' ),
    desc: __( 'I design in Figma and want it live in WordPress.', 'uichemy' ),
    icon: Icon.FigmaGlyph,
    mode: 'figma',
  },
  {
    id: 'agency',
    label: __( 'Agency / Freelancer', 'uichemy' ),
    desc: __( 'I build sites for clients and need to ship fast.', 'uichemy' ),
    icon: Icon.Users,
    mode: 'figma',
  },
  {
    id: 'developer',
    label: __( 'Developer', 'uichemy' ),
    desc: __( 'I build with AI tools like Claude, Cursor or Codex.', 'uichemy' ),
    icon: Icon.Terminal,
    mode: 'compose',
  },
  {
    id: 'nocode',
    label: __( 'No-code / Founder', 'uichemy' ),
    desc: __( 'I want AI to generate a full site for me.', 'uichemy' ),
    icon: Icon.Wand,
    mode: 'scratch',
  },
];

export const personaById = ( id ) => PERSONAS.find( ( p ) => p.id === id ) || null;
