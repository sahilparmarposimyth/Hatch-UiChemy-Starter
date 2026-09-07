import React from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Badge, Alert } from '../../design-system';

/* ============================================================
   Onboarding step 4, UiChemy Pro.

   Sits right after the page-builder step, because Pro's value is expressed in
   builder terms — it unlocks what you can do inside Elementor / Gutenberg /
   Bricks once your design lands there.

   The step has NO button of its own — the wizard's own footer button drives the
   install ("Install & Activate"), the same way the builder step's Continue drives
   its install. Two primary buttons on one step, one in the card and one in the
   footer, is the thing to avoid: the user has to work out which is the real one,
   and the footer is where every other step has taught them to look.

   So this screen's whole job is to answer "what happens if I press that?" — the
   three things we will do, and what it unlocks. The only case it offers an out is
   when no package URL is configured, because then there is nothing to press.

   All the install/activate work lives in useProSetup so the sidebar's Pro card
   behaves identically (see dashboard/use-pro-setup.js).
   ============================================================ */

const PERKS = [
  {
    icon: Icon.Layout,
    title: __( 'Theme Builder', 'uichemy' ),
    body: __( 'Build headers, footers and archive templates once, and use them across the whole site.', 'uichemy' ),
  },
  {
    icon: Icon.Users,
    title: __( 'Role Manager', 'uichemy' ),
    body: __( 'Decide who on your team can edit what, down to individual builder controls.', 'uichemy' ),
  },
  {
    icon: Icon.Tag,
    title: __( 'White Label', 'uichemy' ),
    body: __( 'Put your own name and logo on the builder before you hand a site to a client.', 'uichemy' ),
  },
  {
    icon: Icon.Terminal,
    title: __( 'Custom CSS & JS', 'uichemy' ),
    body: __( 'Write your own CSS and JavaScript straight into any Composer widget.', 'uichemy' ),
  },
];

export default function ProScreen( { pro } ) {
  const { installed, unlocked, zipConfigured, error } = pro;

  // What the footer button is about to do, spelled out. An installed-but-inactive
  // copy skips the first two — promising to "download" something already sitting
  // in wp-content/plugins would be a lie the user can check.
  const steps = installed
    ? [ __( 'Switch UiChemy Pro on for this site', 'uichemy' ) ]
    : [
      __( 'Download the UiChemy Pro package', 'uichemy' ),
      __( 'Install it on this site', 'uichemy' ),
      __( 'Switch it on, ready to use', 'uichemy' ),
    ];

  return (
    <div className="prostep">
      {/* Already sorted — say so plainly and get out of the way. */}
      { unlocked ? (
        <div className="prostep__done">
          <span className="prostep__done-ic"><Icon.Check size={ 18 } /></span>
          <div>
            <b>{ __( 'UiChemy Pro is active on this site.', 'uichemy' ) }</b>
            <p>{ __( 'Everything below is unlocked. Continue to the last step.', 'uichemy' ) }</p>
          </div>
        </div>
      ) : (
        <div className="prostep__pitch">
          <div className="prostep__pitch-head">
            <span className="prostep__crown"><Icon.Crown size={ 16 } /></span>
            <div>
              <b>{ __( 'Add UiChemy Pro', 'uichemy' ) }</b>
              <p>
                { installed
                  ? __( 'Pro is already on this site, it just needs switching on.', 'uichemy' )
                  : __( 'We will set it up for you as part of this step, no downloads to hunt for and no zip to upload.', 'uichemy' ) }
              </p>
            </div>
            { installed ? (
              <Badge tone="warning" variant="soft">{ __( 'Installed', 'uichemy' ) }</Badge>
            ) : null }
          </div>

          {/* The download URL ships with the plugin. Until it is filled in there
              is nothing to press, so say that plainly — that is the one case this
              step lets the user walk past it. */}
          { zipConfigured ? (
            <>
              <ol className="prostep__steps">
                { steps.map( ( text ) => (
                  <li key={ text } className="prostep__step">
                    <span className="prostep__step-dot" aria-hidden="true" />
                    { text }
                  </li>
                ) ) }
              </ol>
              <p className="prostep__hint">
                { installed
                  ? __( 'Press Activate below and it is ready. Nothing else on your site changes.', 'uichemy' )
                  : __( 'Press Install & Activate below and we handle all three. It usually takes a few seconds, and nothing you set up in the earlier steps changes.', 'uichemy' ) }
              </p>
            </>
          ) : (
            <Alert tone="accent" className="prostep__notice">
              { __( 'The UiChemy Pro download is not set up in this build, so it cannot be installed from here yet. Continue for now, you can add Pro any time from the dashboard.', 'uichemy' ) }
            </Alert>
          ) }

          { error ? (
            <Alert tone="danger" className="prostep__notice">{ error }</Alert>
          ) : null }
        </div>
      ) }

      <ul className="prostep__perks">
        { PERKS.map( ( p ) => {
          const IconEl = p.icon;
          return (
            <li key={ p.title } className="prostep__perk">
              <span className="prostep__perk-ic"><IconEl size={ 16 } /></span>
              <div>
                <b>{ p.title }</b>
                <p>{ p.body }</p>
              </div>
            </li>
          );
        } ) }
      </ul>

      { ! unlocked && ! zipConfigured ? (
        <p className="prostep__foot">
          { __( 'Everything you set up in the earlier steps works without Pro.', 'uichemy' ) }
        </p>
      ) : null }
    </div>
  );
}
