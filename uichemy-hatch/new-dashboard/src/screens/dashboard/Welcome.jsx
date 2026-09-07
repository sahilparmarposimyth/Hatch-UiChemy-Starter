import React, { useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../design-system';
import { getBoot } from '../../lib/api.js';
import { FigmaScreen, AiAgentScreen, AiWebsiteScreen } from './Import.jsx';

/**
 * Home, the "Create" hub.
 *
 * The three ways to bring a design into WordPress are one tabbed workspace,
 * built on the DS Tabs primitive (underline variant, animated indicator), the
 * same component the MCP client picker uses. Each tool's screen renders inline
 * as tab content, `embedded` (no big page title, since the tab already names it).
 */

function firstName() {
  const boot = getBoot();
  const account = boot?.auth?.licenseData?.data?.user || boot?.auth?.licenseData?.user || null;
  const raw = ( account?.name || boot?.user?.name || '' ).trim();
  if ( ! raw ) return __( 'there', 'uichemy' );
  const first = raw.split( ' ' )[ 0 ];
  return first.charAt( 0 ).toUpperCase() + first.slice( 1 );
}

const METHODS = [
  { id: 'figma', label: __( 'Figma Plugin', 'uichemy' ), icon: Icon.FigmaGlyph, Screen: FigmaScreen },
  { id: 'aiwebsite', label: __( 'AI Website Creator', 'uichemy' ), icon: Icon.Wand, badge: __( 'New', 'uichemy' ), Screen: AiWebsiteScreen },
  { id: 'aiagent', label: __( 'AI Agent (MCP)', 'uichemy' ), icon: Icon.Bot, Screen: AiAgentScreen },
];

// Which tab to open first, derived from the mode the user last picked.
const MODE_TO_TAB = { figma: 'figma', compose: 'aiagent', scratch: 'aiwebsite' };

export default function Welcome( props ) {
  const { initialTab, mode } = props;
  const [ active, setActive ] = useState(
    () => ( METHODS.some( ( m ) => m.id === initialTab ) ? initialTab : ( MODE_TO_TAB[ mode ] || 'figma' ) )
  );

  return (
    <div className="home-hub">
      <header className="home-hub__head">
        <h1 className="home-hub__greet">
          { sprintf( __( 'Howdy, %s', 'uichemy' ), firstName() ) }
        </h1>
        <p className="home-hub__sub">
          { __( 'Pick how you want to bring your design into WordPress.', 'uichemy' ) }
        </p>
      </header>

      <Tabs
        variant="pill"
        value={ active }
        onValueChange={ setActive }
        className="home-hub__tabs"
      >
        <TabsList aria-label={ __( 'Create with', 'uichemy' ) }>
          { METHODS.map( ( m ) => {
            const IconEl = m.icon;
            return (
              <TabsTrigger key={ m.id } value={ m.id }>
                <IconEl size={ 17 } />
                <span>{ m.label }</span>
                { m.badge ? <span className="hub-tab__badge">{ m.badge }</span> : null }
              </TabsTrigger>
            );
          } ) }
        </TabsList>

        { METHODS.map( ( m ) => {
          const Screen = m.Screen;
          return (
            <TabsContent key={ m.id } value={ m.id } className="home-hub__panel">
              <Screen { ...props } embedded />
            </TabsContent>
          );
        } ) }
      </Tabs>
    </div>
  );
}
