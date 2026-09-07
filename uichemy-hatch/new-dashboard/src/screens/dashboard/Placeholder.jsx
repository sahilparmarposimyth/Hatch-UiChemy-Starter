import React from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { useLocation } from 'react-router-dom';
import * as Icon from '../../components/icons.jsx';
import ScreenHead from '../../components/ScreenHead.jsx';
import { tabByPath } from '../../dashboard/tabs.js';

/**
 * Stand-in for a tab whose screen doesn't exist yet. Reads the tab's own
 * label/icon/reason from the registry, so a `pending` entry needs no per-tab
 * code, and says plainly why the screen is empty — a bare panel reads as a bug.
 */
const COPY = {
  uichemy: {
    subtitle: __( 'Not wired up yet.', 'uichemy' ),
    /* translators: %s: tab name. */
    title: __( '%s is not connected yet', 'uichemy' ),
    desc: __( 'The builder is merged into UiChemy, but this particular screen still needs wiring into the dashboard.', 'uichemy' ),
  },
  planned: {
    subtitle: __( 'Not built yet.', 'uichemy' ),
    /* translators: %s: tab name. */
    title: __( '%s is coming', 'uichemy' ),
    desc: __( 'This screen is not available yet. It will appear here once it ships.', 'uichemy' ),
  },
};

export default function Placeholder() {
  const { pathname } = useLocation();
  const tab = tabByPath( pathname );
  const label = tab?.label || __( 'This screen', 'uichemy' );
  const IconEl = tab?.icon || Icon.Layout;
  const copy = COPY[ tab?.pending ] || COPY.uichemy;

  return (
    <div className="dash">
      <ScreenHead title={ label } subtitle={ copy.subtitle } />
      <div className="dash__grid">
        <div className="panel span-2 nd-pending">
          <span className="nd-pending__ic"><IconEl size={ 26 } /></span>
          <b className="nd-pending__title">{ sprintf( copy.title, label ) }</b>
          <p className="nd-pending__desc">{ copy.desc }</p>
        </div>
      </div>
    </div>
  );
}
