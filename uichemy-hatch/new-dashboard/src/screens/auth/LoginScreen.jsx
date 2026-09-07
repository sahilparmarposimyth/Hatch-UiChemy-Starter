import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Button, Alert } from '../../design-system';
import { BrandFull } from '../../components/brand-logos.jsx';
import { getAuthorizeUrl } from '../../lib/api.js';

/* ============================================================
   LoginScreen — sign-in gate. Split card matching the onboarding shell:
   LEFT = the focused sign-in action; RIGHT = a soft marketing panel with a
   floating value card (Remote / Hotjar / Fibery pattern). Neutral + on-brand:
   the only colour is the orange sign-in CTA.

   Flow: ask the server for a PKCE authorization URL and send the admin there;
   once they sign in — and consent, the first time — the app relays an
   authorization code back to admin.php?page=uichemy, where Uich_Webpage_Auth
   exchanges it for tokens. With tokens stored, App's auth gate lets the user
   through to the wizard / dashboard.

   The same OAuth client backs the Import tab, so signing in here signs the
   user in there too.
   ============================================================ */

const PERKS = [
  { icon: Icon.Wand,     text: __( 'Convert Figma designs into WordPress', 'uichemy' ) },
  { icon: Icon.Layout,   text: __( 'Editable in Elementor, Gutenberg & Bricks', 'uichemy' ) },
  { icon: Icon.Sparkles, text: __( 'Build & edit pages with AI', 'uichemy' ) },
];

export default function LoginScreen( { error, embedded = false } ) {
  const [ busy, setBusy ] = useState( false );
  const [ failure, setFailure ] = useState( '' );

  const signIn = async () => {
    if ( busy ) return;
    setBusy( true );
    setFailure( '' );
    // The server mints the authorization URL: that call generates the PKCE pair,
    // stores the verifier, and registers this site with the app. Then we leave
    // WordPress with a full-page redirect and return through the callback.
    try {
      window.location.href = await getAuthorizeUrl();
    } catch ( e ) {
      setFailure( ( e && e.message ) || __( 'Could not start the sign-in. Please try again.', 'uichemy' ) );
      setBusy( false );
    }
  };

  // The caller passes failures carried back on the URL; `failure` covers the
  // ones that happen before we ever leave the page.
  const shownError = error || failure;

  /* Embedded in the onboarding wizard's `login` step.
     The wizard already draws the brand mark (steps rail), the "Sign in to
     UiChemy" heading with its sub-line, and the Back / Finish setup footer. So
     rendering the full gate below produced two logos and two <h1>s — and, worse,
     `.login-flow`'s `min-height: 480px` inside a 328px `.setupflow__body` scroll
     box, which pushed the secured note, the error slot and the "Get UiChemy"
     link out of sight. Here we render the ACTION only, on the step's own white
     panel: no nested card, no second brand, no fixed height. The perks aside is
     dropped too — it is `aria-hidden` decoration, and three onboarding steps
     have already made that case. */
  if ( embedded ) {
    return (
      <div className="login-embed">
        <Button
          variant="solid"
          tone="brand"
          size="lg"
          onClick={ signIn }
          loading={ busy }
        >
          { busy
            ? __( 'Redirecting…', 'uichemy' )
            : <>{ __( 'Sign in with UiChemy', 'uichemy' ) } <Icon.ExtLink size={ 15 } /></> }
        </Button>
        <p className="login-embed__secure">
          <Icon.Lock size={ 12 } /> { __( 'Secured by UiChemy · you stay in control', 'uichemy' ) }
        </p>
        { shownError ? <Alert tone="danger" className="login-embed__error">{ shownError }</Alert> : null }

        {/* The same three perks the standalone gate shows in its floating card.
            Kept here — rather than dropped with the rest of the aside — because
            this is the moment of commitment, and they are the one thing on the
            step that answers "what am I signing in FOR". Rendered as a plain
            list on the panel, not a card: the step is minimal by house rule. */}
        <ul className="login-embed__perks">
          { PERKS.map( ( p, i ) => {
            const IconEl = p.icon;
            return (
              <li key={ i } className="login-embed__perk">
                <span className="login-embed__perk-ic"><IconEl size={ 15 } /></span>
                { p.text }
              </li>
            );
          } ) }
        </ul>

        <p className="login-embed__foot">
          { __( 'No account yet?', 'uichemy' ) }{ ' ' }
          <a href="https://uichemy.com/pricing" target="_blank" rel="noreferrer">{ __( 'Get UiChemy', 'uichemy' ) }</a>
        </p>
      </div>
    );
  }

  return (
    <div className="setupflow login-flow">
      {/* Left, the focused sign-in. */}
      <section className="login-flow__signin">
        <div className="login-flow__brand"><BrandFull /></div>

        <div className="login-flow__signin-body">
          <h1 className="login-flow__title">{ __( 'Connect this site to UiChemy', 'uichemy' ) }</h1>
          <p className="login-flow__sub">
            { __( 'Sign in to link your UiChemy account. Every design you convert publishes here as a draft, ready to review and go live.', 'uichemy' ) }
          </p>
          <Button
            variant="solid"
            tone="brand"
            size="lg"
            className="login-flow__cta"
            onClick={ signIn }
            loading={ busy }
          >
            { busy
              ? __( 'Redirecting…', 'uichemy' )
              : <>{ __( 'Sign in with UiChemy', 'uichemy' ) } <Icon.ExtLink size={ 15 } /></> }
          </Button>
          <div className="login-flow__secure">
            <Icon.Lock size={ 12 } /> { __( 'Secured by UiChemy · you stay in control', 'uichemy' ) }
          </div>
          { shownError ? <Alert tone="danger" className="login-flow__error">{ shownError }</Alert> : null }
        </div>

        <p className="login-flow__foot">
          { __( 'No account yet?', 'uichemy' ) }{ ' ' }
          <a href="https://uichemy.com/pricing" target="_blank" rel="noreferrer">{ __( 'Get UiChemy', 'uichemy' ) }</a>
        </p>
      </section>

      {/* Right, soft panel + a floating "what you get" card. */}
      <aside className="login-flow__aside" aria-hidden="true">
        <div className="login-flow__promo">
          <span className="login-flow__promo-eyebrow">{ __( 'What you can do', 'uichemy' ) }</span>
          <ul className="login-flow__perks">
            { PERKS.map( ( p, i ) => {
              const IconEl = p.icon;
              return (
                <li key={ i } className="login-flow__perk">
                  <span className="login-flow__perk-ic"><IconEl size={ 15 } /></span>
                  { p.text }
                </li>
              );
            } ) }
          </ul>
        </div>
      </aside>
    </div>
  );
}
