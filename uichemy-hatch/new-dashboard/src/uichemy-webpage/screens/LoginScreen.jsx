import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';

import Button from '../components/Button.jsx';
import Spinner from '../components/Spinner.jsx';
import { getAuthorizeUrl } from '../lib/api.js';

/**
 * Step 1 of the flow: connect the account that holds the AI-generated projects.
 *
 * The standalone plugin rendered this as a full-viewport split screen (login
 * card on the left, a showcase collage on the right). Here it is a card inside
 * the Import tab's content area, this flow must not take the page over, and
 * the collage was a bundled ~1 MB PNG that carried no information.
 *
 * Clicking through leaves WordPress entirely: the server mints a PKCE
 * authorization URL and we navigate to it, returning to
 * `admin.php?page=uichemy#/import` once the account is connected (see
 * Uich_Webpage_Auth::handle_oauth_callback()).
 */
export default function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      window.location.href = await getAuthorizeUrl();
    } catch (e) {
      setError((e && e.message) || __( 'Could not start the connection. Please try again.', 'uichemy' ));
      setBusy(false);
    }
  };

  return (
    <div className="uich-wpc-login">
      <div className="uich-wpc-login__card">
        {/* Lightweight, export-safe preview of what connecting unlocks: a fanned
            stack of faux "generated site" thumbnails (pure CSS, no bundled
            image, the old showcase was a ~1 MB PNG). Decorative, hidden from AT. */}
        <div className="uich-wpc-login__preview" aria-hidden="true">
          <span className="uich-wpc-login__thumb uich-wpc-login__thumb--l" />
          <span className="uich-wpc-login__thumb uich-wpc-login__thumb--r" />
          <span className="uich-wpc-login__thumb uich-wpc-login__thumb--main">
            <span className="uich-wpc-login__bar">
              <i /><i /><i />
            </span>
            <span className="uich-wpc-login__body">
              <span className="uich-wpc-login__line uich-wpc-login__line--title" />
              <span className="uich-wpc-login__line" />
              <span className="uich-wpc-login__line uich-wpc-login__line--short" />
              <span className="uich-wpc-login__chip" />
            </span>
          </span>
        </div>

        <h3 className="uich-wpc-login__title">
          { __( 'Connect your UiChemy account', 'uichemy' ) }
        </h3>
        <p className="uich-wpc-login__desc">
          { __(
            'Sign in to load the websites you generated, then import one into this site. Theme, plugins, pages and settings are included.',
            'uichemy'
          ) }
        </p>

        { error ? (
          <p className="uich-wpc-login__error" role="alert">{ error }</p>
        ) : null }

        <Button
          variant="primary"
          size="large"
          className="uich-wpc-login__cta"
          disabled={ busy }
          onClick={ connect }
          leftIcon={ busy ? <Spinner size={ 16 } /> : null }
        >
          { busy ? __( 'Connecting…', 'uichemy' ) : __( 'Log in to continue', 'uichemy' ) }
        </Button>

        <ul className="uich-wpc-login__tags">
          { LOGIN_TAGS.map( ( t ) => (
            <li key={ t.label } className="uich-wpc-login__tag">
              <span className="uich-wpc-login__tag-ic" aria-hidden="true">{ t.icon }</span>
              { t.label }
            </li>
          ) ) }
        </ul>
      </div>
    </div>
  );
}

/* Three trust tags under the CTA, tiny inline glyphs keep the login card
   self-contained (no icon-set import for one screen). */
const LOGIN_TAGS = [
  {
    label: __( 'AI-generated sites', 'uichemy' ),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 3l2.2 6L21 11l-5.8 2L13 19l-2.2-6L5 11l5.8-2L13 3Z" />
        <path d="M5 4v3M3.5 5.5h3" />
      </svg>
    ),
  },
  {
    label: __( 'One-click import', 'uichemy' ),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M4 20h16" />
      </svg>
    ),
  },
  {
    label: __( 'Fully editable', 'uichemy' ),
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17.5V20Z" />
        <path d="M13.5 6.5l4 4" />
      </svg>
    ),
  },
];
