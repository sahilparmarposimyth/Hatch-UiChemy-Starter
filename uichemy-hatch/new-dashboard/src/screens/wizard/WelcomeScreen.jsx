import React from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';

/* ============================================================
   Onboarding, Welcome / value screen.

   The intro panel of the two-pane setup (see SetupFlow): it shares the same
   rail + chrome as the numbered steps, so Welcome → About you is seamless. A
   soft icon tile with a halo ring, the value points as clean rows, and a time
   estimate, the same premium language as the rest of the flow.
   ============================================================ */

const POINTS = [
  { icon: Icon.Figma, text: __( 'Design in Figma, send it straight to WordPress', 'uichemy' ) },
  { icon: Icon.Grid, text: __( 'Native Elementor, Gutenberg or Bricks, fully editable', 'uichemy' ) },
  { icon: Icon.Wand, text: __( 'AI website generation and conversions, on tap', 'uichemy' ) },
];

export default function WelcomeScreen() {
  return (
    <div className="sf-welcome">
      <span className="sf-welcome__ico"><Icon.Sparkles size={ 24 } /></span>
      <span className="sf-welcome__eyebrow">{ __( 'Welcome', 'uichemy' ) }</span>
      <h1 className="sf-welcome__title">{ __( 'Welcome to UiChemy', 'uichemy' ) }</h1>
      <p className="sf-welcome__lead">
        { __( 'Turn your Figma designs into native, editable WordPress pages, no rebuilds. Let’s get you set up in about a minute.', 'uichemy' ) }
      </p>
      <ul className="sf-welcome__points">
        { POINTS.map( ( p ) => {
          const IconEl = p.icon;
          return (
            <li key={ p.text } className="sf-welcome__pt">
              <span className="sf-welcome__pt-ic"><IconEl size={ 17 } /></span>
              <span>{ p.text }</span>
            </li>
          );
        } ) }
      </ul>
      <span className="sf-welcome__note">
        <Icon.Info size={ 13 } /> { __( 'Takes about a minute · you can change anything later', 'uichemy' ) }
      </span>
    </div>
  );
}
