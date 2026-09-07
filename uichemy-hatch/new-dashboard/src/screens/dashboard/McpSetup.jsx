import React, { useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Button, Card, Tabs, TabsList, TabsTrigger, Tooltip } from '../../design-system';
import { copyText } from '../../lib/api.js';
import { useAppPassword, regenerateAppPassword } from '../../lib/app-password.js';
import {
  MCP_TOOLS, OS_LABELS,
  buildMcp, toolConfig, toolPrompt, mcpPath, detectOS,
} from '../../lib/mcp-config.js';
import { AppPasswordForceRow } from './panels.jsx';

/**
 * AI Agent (MCP) setup, a minimal numbered stepper (Mobbin-style): connect →
 * pick your AI tool → add the config → restart. Deliberately light and subtle:
 * the config sits in a soft light code block (not the old dark one), the tool
 * picker uses our neutral card selection, and the whole thing lives in one DS
 * Card. All the config text comes from the shared `lib/mcp-config.js`.
 *
 * Step 3 has two panes per tool, on the DS pill Tabs:
 *   • Prompt (default), a tool-specific instruction to paste into that tool so
 *     its own AI edits the config file for you.
 *   • Config, the raw JSON/TOML to paste into that file by hand.
 * Both are pinned to the config path for the platform `detectOS()` reports, so
 * a Windows user sees %APPDATA%\Claude\… and a Mac user sees ~/Library/….
 */

const TOOL_ICON = {
  claude:      Icon.ClaudeTile,
  cursor:      Icon.CursorTile,
  codex:       Icon.CodexTile,
  antigravity: Icon.AntigravityTile,
  prompt:      Icon.Grid,
};

const PANES = [
  { id: 'prompt', label: __( 'Prompt', 'uichemy' ) },
  { id: 'config', label: __( 'Config', 'uichemy' ) },
];

/** The OS the config paths are resolved against. Detected once, per session. */
const OS = detectOS();

/** One numbered step: circle + connector line (via CSS) + body. */
function Step( { n, title, desc, last, children } ) {
  return (
    <li className={ `mcp-step${ last ? ' mcp-step--last' : '' }` }>
      <span className="mcp-step__n">{ n }</span>
      <div className="mcp-step__body">
        <div className="mcp-step__head">
          <b className="mcp-step__title">{ title }</b>
          { desc ? <p className="mcp-step__desc">{ desc }</p> : null }
        </div>
        { children }
      </div>
    </li>
  );
}

export default function McpSetup( { siteName, embedded } ) {
  const ap = useAppPassword();
  const [ tool, setTool ] = useState( 'claude' );
  const [ pane, setPane ] = useState( 'prompt' );
  const [ generating, setGenerating ] = useState( false );
  const [ copied, setCopied ] = useState( false );
  const [ autoCopied, setAutoCopied ] = useState( false );
  const [ error, setError ] = useState( '' );

  const generated = ap.hasToken;
  const pwd = ap.password || 'your-application-password';
  const ctx = buildMcp( siteName, pwd );
  const { text: configText, html: configHtml, tool: active } = toolConfig( ctx, tool );

  // "Other" has no config file of its own, only the self-detecting prompt, so
  // it collapses to a single pane instead of showing an empty Config tab.
  const promptOnly = active.fmt === 'prompt';
  const activePane = promptOnly ? 'prompt' : pane;
  const path       = mcpPath( tool, OS );

  const showText = activePane === 'prompt' ? toolPrompt( ctx, tool, OS ) : configText;
  const showHtml = activePane === 'prompt' ? null : configHtml;

  const generate = async () => {
    setError( '' ); setGenerating( true );
    try { await regenerateAppPassword( 'mcp' ); }
    catch ( e ) { setError( e.message || __( 'Could not generate the connection.', 'uichemy' ) ); }
    finally { setGenerating( false ); }
  };
  const copy = async () => {
    if ( ! generated ) return;
    if ( await copyText( showText ) ) { setCopied( true ); setTimeout( () => setCopied( false ), 1800 ); }
  };
  const copyAuto = async () => {
    if ( ! generated ) return;
    if ( await copyText( ctx.claudeAutoConnect ) ) { setAutoCopied( true ); setTimeout( () => setAutoCopied( false ), 1800 ); }
  };

  const steps = (
    <ol className="mcp-steps">
        {/* 1, connection (our equivalent of Mobbin's upgrade/authorize). */}
        <Step
          n={ 1 }
          title={ __( 'Generate your connection', 'uichemy' ) }
          desc={ __( 'Issue a secure Application Password so your AI tool can reach this site.', 'uichemy' ) }
        >
          <div className="mcp-row">
            { generated ? (
              <span className="mcp-connected"><Icon.Check size={ 13 } /> { __( 'Connected', 'uichemy' ) }</span>
            ) : (
              <Button variant="solid" tone="brand" onClick={ generate } loading={ generating }>
                <Icon.Key size={ 13 } /> { __( 'Generate connection', 'uichemy' ) }
              </Button>
            ) }
            { generated ? (
              <Button variant="outline" tone="brand" size="sm" onClick={ generate } loading={ generating }>
                { __( 'Regenerate', 'uichemy' ) }
              </Button>
            ) : null }
          </div>
          { error ? <p className="mcp-err"><Icon.Warn size={ 12 } /> { error }</p> : null }
          {/* Only renders when App Passwords are blocked or force-enabled –
              the fix-it right where "Generate connection" would otherwise fail. */}
          <AppPasswordForceRow />
        </Step>

        {/* 2, pick the AI tool. */}
        <Step
          n={ 2 }
          title={ __( 'Pick your AI tool', 'uichemy' ) }
          desc={ __( 'We’ll give you the exact config to add.', 'uichemy' ) }
        >
          <div className="mcp-tools">
            { MCP_TOOLS.map( ( t ) => {
              const IconEl = TOOL_ICON[ t.id ] || Icon.Grid;
              return (
                <button
                  key={ t.id }
                  type="button"
                  className={ `mcp-tool${ tool === t.id ? ' is-on' : '' }` }
                  onClick={ () => { setTool( t.id ); setCopied( false ); } }
                  aria-pressed={ tool === t.id }
                >
                  <span className="mcp-tool__ic"><IconEl size={ 20 } /></span>
                  <span className="mcp-tool__label">{ t.label }</span>
                </button>
              );
            } ) }
          </div>
        </Step>

        {/* 3, the config / prompt, in a light subtle code block. */}
        <Step
          n={ 3 }
          title={ __( 'Add the MCP server', 'uichemy' ) }
          desc={ activePane === 'prompt'
            ? ( promptOnly
                ? __( 'Paste this prompt into your AI tool. It adds the config for you.', 'uichemy' )
                /* translators: %s: AI tool name, e.g. Claude Desktop. */
                : sprintf( __( 'Paste this prompt into %s. It edits its own config file for you.', 'uichemy' ), active.label ) )
            : __( 'Copy this into your tool’s config file.', 'uichemy' ) }
        >
          { ! generated ? (
            <p className="mcp-hint"><Icon.Info size={ 12 } /> { __( 'Generate the connection above to reveal your real config.', 'uichemy' ) }</p>
          ) : null }

          {/* Prompt | Config, the same DS pill Tabs the rest of the dashboard
              uses, so this reads as one system with the MCP panel's client tabs. */}
          { promptOnly ? null : (
            <Tabs
              variant="pill"
              size="sm"
              value={ activePane }
              onValueChange={ ( v ) => { setPane( v ); setCopied( false ); } }
              className="mcp-panes"
            >
              <TabsList aria-label={ __( 'Setup method', 'uichemy' ) }>
                { PANES.map( ( p ) => (
                  <TabsTrigger key={ p.id } value={ p.id }>{ p.label }</TabsTrigger>
                ) ) }
              </TabsList>
            </Tabs>
          ) }

          <div className={ `mcp-code${ activePane === 'prompt' ? ' mcp-code--prompt' : '' }` }>
            <pre>{ showHtml
              ? <code dangerouslySetInnerHTML={ { __html: showHtml } } />
              : <code>{ showText }</code> }</pre>
            <Button variant="ghost" tone="neutral" size="sm" className="mcp-code__copy" onClick={ copy } disabled={ ! generated }>
              { copied ? <><Icon.Check size={ 12 } /> { __( 'Copied', 'uichemy' ) }</> : <><Icon.Copy size={ 12 } /> { __( 'Copy', 'uichemy' ) }</> }
            </Button>
          </div>

          {/* One-click installers belong to the manual (Config) route only, the
              Prompt route hands the whole job to the AI. */}
          { activePane === 'config' && ( tool === 'cursor' || tool === 'claude' ) && generated ? (
            <div className="mcp-actions">
              { tool === 'cursor' ? (
                <Button variant="outline" tone="neutral" size="sm" asChild>
                  <a href={ ctx.cursorDeeplink }><Icon.ExtLink size={ 12 } /> { __( 'Add to Cursor', 'uichemy' ) }</a>
                </Button>
              ) : null }
              { tool === 'claude' ? (
                <Tooltip content={ __( 'Copy a one-line terminal command that adds this to Claude Desktop automatically. Needs Node.js 18+.', 'uichemy' ) }>
                  <Button variant="outline" tone="neutral" size="sm" onClick={ copyAuto }>
                    { autoCopied ? <><Icon.Check size={ 12 } /> { __( 'Copied', 'uichemy' ) }</> : <><Icon.AutoConnect size={ 12 } /> { __( 'Auto Connect', 'uichemy' ) }</> }
                  </Button>
                </Tooltip>
              ) : null }
            </div>
          ) : null }

          { path ? (
            <p className="mcp-path">
              <b>{ activePane === 'prompt' ? __( 'The prompt points at:', 'uichemy' ) : __( 'Save to:', 'uichemy' ) }</b>
              { ' ' }<span>{ path }</span>
              { ' ' }<em>{ sprintf( /* translators: %s: detected OS name. */ __( '(detected %s)', 'uichemy' ), OS_LABELS[ OS ] ) }</em>
            </p>
          ) : null }
        </Step>

        {/* 4, restart. */}
        <Step
          n={ 4 }
          last
          title={ __( 'Restart & start building', 'uichemy' ) }
          desc={ __( 'Restart your AI tool, then ask it to build or edit a page. It works through UiChemy on this site.', 'uichemy' ) }
        />
    </ol>
  );

  // Embedded (onboarding Connect step): no outer Card, it already sits inside
  // the SetupFlow panel, so a bordered card here would be a card-in-card.
  if ( embedded ) {
    return <div className="mcp-setup mcp-setup--bare">{ steps }</div>;
  }
  // Dashboard: a white card on the grey group behind the Home tabs.
  return <Card className="panel span-2 mcp-setup">{ steps }</Card>;
}
