import React from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { Badge } from '../design-system';
import { getBoot } from '../lib/api.js';

/**
 * Title block shared by every dashboard tab. Reuses the existing `.dash__head`
 * styles so the tabs match the pre-merge single-screen dashboard exactly.
 *
 * `showVersion` is opt-in: the plugin version belongs on the home tab, not
 * repeated at the top of all nine.
 */
export default function ScreenHead( { title, subtitle, showVersion = false, action = null } ) {
  const version = getBoot()?.version;
  return (
    <div className="dash__head">
      <div>
        <h1>{ title }</h1>
        { subtitle ? <p>{ subtitle }</p> : null }
      </div>
      { action }
      { showVersion && version ? (
        <Badge tone="brand" variant="soft" className="dash__version-badge">{ sprintf( __( 'v%s', 'uichemy' ), version ) }</Badge>
      ) : null }
    </div>
  );
}
