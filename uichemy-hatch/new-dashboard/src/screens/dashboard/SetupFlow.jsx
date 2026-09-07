import React, { useState, useRef, useEffect, useMemo } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { useNavigate } from 'react-router-dom';
import * as Icon from '../../components/icons.jsx';
import { Button, Alert } from '../../design-system';
import { BrandFull } from '../../components/brand-logos.jsx';
import { getBoot, request, hasQuery, isAuthed } from '../../lib/api.js';
import BuilderScreen from '../wizard/BuilderScreen.jsx';
import ModeScreen from '../wizard/ModeScreen.jsx';
import ConnectScreen from '../wizard/ConnectScreen.jsx';
import PersonalizeScreen from '../wizard/PersonalizeScreen.jsx';
import WelcomeScreen from '../wizard/WelcomeScreen.jsx';
import ProScreen from '../wizard/ProScreen.jsx';
import { modeById, modeSupportsBuilder } from '../../dashboard/modes.js';
import LoginScreen from '../auth/LoginScreen.jsx';
import { personaById } from '../../dashboard/personas.js';
import { useBuilderSetup } from '../../dashboard/use-builder-setup.js';
import { useProSetup } from '../../dashboard/use-pro-setup.js';

/**
 * SetupFlow, the onboarding wizard, redesigned as a two-pane layout: a left
 * "steps" rail (brand + the three steps with done/current/upcoming state) and a
 * right panel with the current step's cards + Back / Continue. (Mercury /
 * Airwallex / Deel pattern.) It renders in the WP-admin content area, no
 * dashboard rail, no full-screen takeover, so WordPress's own menu stays put.
 *
 * Order leads with the use-case ("How will you use UiChemy?") the way Notion /
 * Fabric / Docusign do, THEN the builder, then connect. Choices persist to the
 * same REST endpoints; "Finish" marks onboarded and drops the user on Home.
 */

const STEP_COPY = {
  personalize: {
    label: __( 'About you', 'uichemy' ),
    title: __( 'What best describes you?', 'uichemy' ),
    sub: __( 'We’ll tailor the setup to how you work. You can change anything later.', 'uichemy' ),
  },
  mode: {
    label: __( 'How you’ll use it', 'uichemy' ),
    title: __( 'How will you use UiChemy?', 'uichemy' ),
    sub: __( 'Most designers pick the Figma plugin. You can switch anytime.', 'uichemy' ),
  },
  builder: {
    label: __( 'Page builder', 'uichemy' ),
    title: __( 'Which builder do you build in?', 'uichemy' ),
    sub: __( 'Your design converts into editable elements in the builder you pick.', 'uichemy' ),
  },
  pro: {
    label: __( 'UiChemy Pro', 'uichemy' ),
    title: __( 'Want the Pro features too?', 'uichemy' ),
    sub: __( 'Optional, and you can add it later. We’ll set it up for you if you want it now.', 'uichemy' ),
  },
  connect: {
    label: __( 'Connect', 'uichemy' ),
    title: __( 'Connect your WordPress site', 'uichemy' ),
    sub: __( 'Pair this site with UiChemy to start converting.', 'uichemy' ),
  },
  login: {
    label: __( 'Sign in', 'uichemy' ),
    title: __( 'Sign in to UiChemy', 'uichemy' ),
    sub: __( 'The AI Website Creator builds against your UiChemy account, so this is the last thing it needs.', 'uichemy' ),
  },
};

/**
 * Step order. `pro` follows `builder` deliberately: everything Pro unlocks
 * (Theme Builder, Role Manager, White Label, custom CSS/JS) happens INSIDE the
 * builder the previous step just chose, so it only reads as relevant once that
 * choice is made. It stays ahead of `connect` because connecting is the step
 * that ends onboarding, and asking after that reads as an afterthought.
 *
 * `connect` and `login` are the two possible ENDINGS, never both: `connect`
 * pairs this site with the Figma plugin / MCP, while AI Website Creator needs a
 * signed-in UiChemy account instead. Which one survives is decided by the mode
 * (see the `steps` filter), so they sit side by side here in the order they
 * would appear.
 */
const STEPS = [ 'personalize', 'mode', 'builder', 'pro', 'connect', 'login' ];

/**
 * StepsRail, the persistent left panel: brand mark on top, then the three
 * steps as a vertical list. A finished step shows a check, the current step is
 * emphasised (filled dot + darkened label), upcoming steps stay quiet.
 */
function StepsRail( { steps, active } ) {
  return (
    <aside className="setupflow__rail">
      <div className="setupflow__brand"><BrandFull /></div>
      <ol className="setupflow__steplist">
        { steps.map( ( key, i ) => {
          const state = i < active ? 'done' : i === active ? 'on' : 'todo';
          return (
            <li key={ key } className={ `setupflow__step setupflow__step--${ state }` }>
              <span className="setupflow__step-dot">
                { state === 'done' ? <Icon.Check size={ 12 } /> : i + 1 }
              </span>
              <span className="setupflow__step-label">{ STEP_COPY[ key ].label }</span>
            </li>
          );
        } ) }
      </ol>
    </aside>
  );
}

export default function SetupFlow() {
  const navigate = useNavigate();
  const boot = getBoot();

  /*
   * Test hatch: `&onboard` on the admin URL replays the wizard from the very
   * top — Welcome intro, step 1 — on a site that is already set up and has
   * every choice saved. Without it, resume logic (below) would drop a
   * configured site straight on the last step, which is the one thing you
   * can't review.
   *
   * Read-only: it changes where the flow STARTS, never what is stored. The
   * steps still persist their choices exactly as they normally do, so walking
   * through re-saves the same values rather than clearing them.
   */
  const replay = hasQuery( 'onboard' );

  // Builder selection + the real install/activate orchestration (shared hook).
  const bset = useBuilderSetup();
  const { builder } = bset;

  // UiChemy Pro install/activate, the same hook the rail's Pro card uses.
  const pset = useProSetup();

  const [ persona, setPersona ] = useState( () => {
    try { return localStorage.getItem( 'uich_nd_persona' ) || ''; } catch ( _ ) { return ''; }
  } );
  const [ mode, setMode ] = useState( boot?.state?.mode || '' );
  // Welcome is the pre-step intro; only show it on a truly fresh run. Resuming
  // mid-setup (any prior choice saved) skips straight to the first open step.
  const [ intro, setIntro ] = useState(
    () => replay || ( ! persona && ! boot?.state?.mode && ! boot?.state?.builder )
  );
  // Land on the first unfinished step (about you → use-case → builder → …).
  //
  // Resume never lands on `pro` (index 3): Pro is optional, so "not active" is a
  // perfectly finished state and dropping a returning user there would nag them
  // about a step they already declined. Anyone past the builder resumes on
  // connect; the Pro step is still reachable by walking Back.
  const [ stepIdx, setStepIdx ] = useState(
    () => ( replay ? 0 : ! persona ? 0 : ! boot?.state?.mode ? 1 : ! boot?.state?.builder ? 2 : 4 )
  );
  const [ busy, setBusy ] = useState( false );

  /*
   * Drop the Pro step once Pro is already unlocked.
   *
   * Nothing on that screen applies to a site that has it: the copy is an offer,
   * and the footer button installs. Showing it anyway asks the user to walk past
   * a step whose only content is "you already have this".
   *
   * Indices survive the removal because `pro` sits SECOND-TO-LAST: personalize /
   * mode / builder keep positions 0-2, and the resume initialiser's `4` (connect)
   * is clamped by the Math.min below, which lands on connect either way.
   *
   * Reactive rather than computed once: `unlocked` starts false and flips true
   * when the Pro check resolves. If that happens while the user is standing on
   * the Pro step, the clamp moves them forward to connect, which is what
   * "you already have Pro" should do.
   */
  /*
   * The tail of the flow depends on the mode picked two steps earlier.
   *
   * AI Website Creator ('scratch') has nothing to pair: it does not talk to this
   * site through the Figma plugin or MCP, it builds against the user's UiChemy
   * ACCOUNT. So `connect` is dropped for it and `login` takes its place — and
   * only when the account is not signed in already, because a step that says
   * "sign in" to someone who is signed in is a step with nothing to do.
   *
   * Signing in leaves WordPress for the OAuth round trip and comes back on a
   * fresh mount, so this recomputes with isAuthed() true and the step is simply
   * gone. That is why nothing here tries to advance past it by hand.
   */
  const authed = isAuthed();
  const steps = useMemo(
    () => STEPS.filter( ( s ) => {
      if ( 'pro' === s ) return ! pset.unlocked;
      if ( 'connect' === s ) return 'scratch' !== mode;
      if ( 'login' === s ) return 'scratch' === mode && ! authed;
      return true;
    } ),
    [ pset.unlocked, mode, authed ]
  );
  const current = steps[ Math.min( stepIdx, steps.length - 1 ) ];
  const isLast = stepIdx >= steps.length - 1;

  /*
   * Leave the current step: go to the NEXT one in the list, or finish when there
   * is none.
   *
   * Never by number. The list is filtered, so a hard-coded index lands on
   * whatever happens to sit there — and "the step after builder" is Pro on one
   * site, sign-in on another, and nothing at all on a third.
   *
   * Finishing when the list runs out is the part that has to be explicit.
   * Clamping to the last index instead makes the final step a DEAD END: its
   * button is pressed, the index is already the last one, and nothing happens.
   * That is exactly what a scratch + signed-in + Pro-unlocked site hit, where
   * `builder` is the last step.
   */
  const advance = async () => {
    const at = steps.indexOf( current );
    if ( at === -1 || at >= steps.length - 1 ) { await finish(); return; }
    setStepIdx( at + 1 );
  };

  /*
   * Can the Pro step be left WITHOUT installing?
   *
   * Normally no — while a package URL is configured, pressing the button is how
   * you leave, so there is no skip to tempt people past a one-click setup.
   *
   * Three exceptions, all of them "there is nothing to press":
   *   unlocked   → already Pro.
   *   no zip URL → nothing to install from.
   *   errored    → the attempt failed. Without this the step is a dead end: a
   *                site that can't write to wp-content/plugins, or can't reach
   *                the package, could never finish onboarding at all. The way
   *                out only appears AFTER a real attempt, so it costs nothing
   *                up front.
   */
  const proCanPass = pset.unlocked || ! pset.zipConfigured || !! pset.error;

  // On the builder step, is the picked builder compatible with the chosen mode?
  const builderOk = modeSupportsBuilder( mode, builder );

  const persist = async ( path, body ) => {
    try { await request( path, { method: 'POST', body } ); }
    catch ( e ) { console.warn( '[nd] setup persist failed', path, e ); }
  };

  const finish = async () => {
    await persist( '/onboarded', { done: true } );
    navigate( '/' );
  };

  // Exit from the Welcome intro. Marks onboarding done on the server the same way
  // Finish does, so FirstRunGate does NOT force /setup again on the next refresh —
  // exiting means "I'm done here", not "ask me again every reload". Reachable
  // later via the ?onboard hatch. Optimistically flip the local boot flag too so
  // nothing re-gates before the page reloads.
  const exitOnboarding = async () => {
    try { const b = getBoot(); if ( b && b.state ) b.state.onboarded = true; } catch ( _ ) { /* ignore */ }
    navigate( '/' );
    await persist( '/onboarded', { done: true } );
  };

  const onNext = async () => {
    if ( current === 'personalize' ) {
      try { localStorage.setItem( 'uich_nd_persona', persona ); } catch ( _ ) { /* ignore */ }
      // Pre-select the persona's recommended mode when nothing's chosen yet, so
      // the "How you'll use it" step reflects how the user actually works.
      const rec = personaById( persona )?.mode;
      if ( rec && ! mode && modeSupportsBuilder( rec, builder ) ) setMode( rec );
      await advance();
      return;
    }
    if ( current === 'builder' ) {
      if ( bset.intent === null || ! builderOk ) return;
      await bset.run( () => { advance(); } );
      return;
    }
    // Pro's Continue IS the install button, mirroring the builder step: it runs
    // install-then-activate and only advances once that lands. See proCanPass
    // above for the cases where it just moves on instead.

    if ( current === 'pro' ) {
      // Whatever follows Pro — connect, sign-in, or the end of setup.
      if ( proCanPass ) {
        await advance();
        return;
      }
      await pset.run( () => { advance(); } );
      return;
    }
    if ( busy ) return;
    setBusy( true );
    try {
      if ( current === 'mode' ) {
        await persist( '/mode', { mode } );
        await advance();
      } else {
        await finish();
      }
    } finally { setBusy( false ); }
  };

  const onBack = () => {
    if ( stepIdx === 0 ) { setIntro( true ); return; }  // back to the Welcome intro
    setStepIdx( stepIdx - 1 );
  };

  // Pro's install is driven by its in-card button, but the footer has to know
  // about it too — otherwise "Skip for now" stays clickable mid-download and the
  // user advances out of a step that is still working.
  const busyNow =
    current === 'builder' ? bset.busy :
    current === 'pro' ? pset.busy :
    busy;
  const canNext =
    current === 'personalize' ? !! persona :
    current === 'mode' ? !! mode :
    current === 'builder' ? ( bset.intent !== null && builderOk ) :
    true;
  // Pro's button names the work: "Install & Activate" (or "Activate UiChemy Pro"
  // for an installed copy) comes straight from the hook, so the label can never
  // disagree with what pressing it actually does. It falls back to Continue only
  // when there is nothing to install.
  //
  // On the LAST step the button ends onboarding, so it has to say so — builder
  // and Pro can both be last now (a signed-in AI Website Creator site with Pro
  // already unlocked ends on `builder`), and both used to keep saying "Continue"
  // while the press finished setup.
  //
  // The one case where the last step does NOT say "Finish setup" is when there
  // is still something to INSTALL: `bset.label` / `pset.label` name that work
  // ("Install & Activate"), which is what the press actually does first. Setup
  // finishes right after, on the same press.
  const finishLabel = __( 'Finish setup', 'uichemy' );
  const nextLabel = current === 'builder'
    ? ( isLast && bset.intent === 'continue' ? finishLabel : bset.label )
    : current === 'pro'
      ? ( pset.error && ! pset.unlocked
          // It failed and we are letting them past: name that honestly rather
          // than a bare "Continue", which would hide that Pro is still off.
          ? ( isLast ? finishLabel : __( 'Skip for now', 'uichemy' ) )
          : proCanPass
            ? ( isLast ? finishLabel : __( 'Continue', 'uichemy' ) )
            : pset.label )
      : ( isLast ? finishLabel : __( 'Continue', 'uichemy' ) );
  const showChevron = ! isLast
    && ( current !== 'builder' || bset.intent === 'continue' )
    && ( current !== 'pro' || proCanPass );

  const copy = STEP_COPY[ current ];
  const modeLabel = modeById( mode )?.label || __( 'This option', 'uichemy' );

  // Scroll-aware edge fade for the panel body: reveal the top white fade only
  // once scrolled down, and the bottom fade only while more content sits below –
  // driving the --fade-top / --fade-bottom vars the Connect-step mask reads.
  const bodyRef = useRef( null );
  useEffect( () => {
    const el = bodyRef.current;
    if ( ! el ) return undefined;
    const update = () => {
      el.style.setProperty( '--fade-top', el.scrollTop > 1 ? '24px' : '0px' );
      el.style.setProperty(
        '--fade-bottom',
        el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? '24px' : '0px'
      );
    };
    update();
    el.addEventListener( 'scroll', update, { passive: true } );
    const ro = new ResizeObserver( update );
    ro.observe( el );
    const mo = new MutationObserver( update );
    mo.observe( el, { childList: true, subtree: true } );
    return () => {
      el.removeEventListener( 'scroll', update );
      ro.disconnect();
      mo.disconnect();
    };
  }, [ intro, current ] );

  return (
    <div className="setupflow">
      { /* During the Welcome intro no step is active yet, the rail shows the
           journey ahead (active = -1 → every step reads as upcoming). */ }
      <StepsRail steps={ steps } active={ intro ? -1 : stepIdx } />

      <section className="setupflow__panel">
        { intro ? (
          <div className="setupflow__welcome">
            <WelcomeScreen />
          </div>
        ) : (
          <>
            <div className="setupflow__panelhead">
              <h1>{ copy.title }</h1>
              <p>{ copy.sub }</p>
            </div>

            <div className="setupflow__body" ref={ bodyRef }>
              { current === 'personalize' ? (
                <PersonalizeScreen selected={ persona } onSelect={ setPersona } />
              ) : current === 'mode' ? (
                // No builder chosen yet at this step, leave every mode selectable.
                <ModeScreen selected={ mode } onSelect={ setMode } builder="" />
              ) : current === 'builder' ? (
                <BuilderScreen detected={ bset.detected } selected={ bset.builder } onSelect={ bset.setBuilder } uichemy={ bset.uichemy } />
              ) : current === 'pro' ? (
                <ProScreen pro={ pset } />
              ) : current === 'login' ? (
                <LoginScreen embedded />
              ) : (
                <ConnectScreen mode={ mode } builder={ builder } boot={ boot } />
              ) }
            </div>

            { current === 'builder' && bset.error ? (
              <p className="setupflow__err"><Icon.Warn size={ 13 } /> { bset.error }</p>
            ) : null }

            { current === 'builder' && builder && ! builderOk ? (
              <Alert tone="warning" className="setupflow__notice">
                { sprintf( __( '%s isn’t available for this builder. Pick one it supports.', 'uichemy' ), modeLabel ) }
              </Alert>
            ) : null }
          </>
        ) }

        <footer className="setupflow__foot">
          { intro ? (
            <>
              <Button variant="outline" tone="neutral" onClick={ exitOnboarding }>
                <Icon.ChevL size={ 14 } /> { __( 'Exit', 'uichemy' ) }
              </Button>
              <Button tone="brand" onClick={ () => setIntro( false ) }>
                { __( 'Get Started', 'uichemy' ) } <Icon.ChevR size={ 14 } />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" tone="neutral" onClick={ onBack }>
                <Icon.ChevL size={ 14 } /> { __( 'Back', 'uichemy' ) }
              </Button>
              <Button tone="brand" onClick={ onNext } disabled={ ! canNext || busyNow } loading={ busyNow }>
                { nextLabel }
                { showChevron ? <Icon.ChevR size={ 14 } /> : null }
              </Button>
            </>
          ) }
        </footer>
      </section>
    </div>
  );
}
