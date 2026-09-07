import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from './icons.jsx';
import { Tabs, TabsList, TabsTrigger, Tooltip, ScrollArea, Button } from '../design-system';
import { copyText, getBoot } from '../lib/api.js';
import { useAppPassword, regenerateAppPassword } from '../lib/app-password.js';

/**
 * Shared MCP config tabs, used by both the dashboard's MCPPanel and the
 * wizard's ComposeBranch.
 *
 * Five tabs:
 *   • Prompt       , natural-language instructions any AI can act on
 *   • Claude Desktop, claude_desktop_config.json (JSON, `mcpServers`)
 *   • Codex        , ~/.codex/config.toml (TOML, `[mcp_servers.<n>]`)
 *   • Cursor       , ~/.cursor/mcp.json (JSON + one-click deeplink)
 *   • Antigravity  , ~/.gemini/config/mcp_config.json (JSON)
 *
 * All tabs target `@automattic/mcp-wordpress-remote` with WP_API_URL,
 * WP_API_USERNAME, WP_API_PASSWORD env vars. Application Password is
 * shared via `useAppPassword`, so regenerating in the dashboard's
 * Connection card updates this panel and vice versa.
 *
 * Props:
 *   • siteName    , used for the server-name slug. Falls back to boot.siteName.
 *   • showGenerate, render the Generate/Regenerate button in the codeblock bar.
 *                    Dashboard: true (user issues on demand).
 *                    Wizard:    false (ComposeBranch auto-issues on mount).
 */

const MCP_TABS = [
  { id: 'prompt',      label: __('Prompt', 'uichemy'), file: 'prompt.txt' },
  { id: 'claude',      label: 'Claude Desktop', file: 'claude_desktop_config.json' },
  { id: 'codex',       label: 'Codex',          file: 'config.toml' },
  { id: 'cursor',      label: 'Cursor',         file: 'mcp.json' },
  { id: 'antigravity', label: 'Antigravity',    file: 'mcp_config.json' },
];

const MCP_PATHS = {
  claude:      'macOS: ~/Library/Application Support/Claude/claude_desktop_config.json  ·  Windows: %APPDATA%\\Claude\\claude_desktop_config.json',
  codex:       '~/.codex/config.toml',
  cursor:      '~/.cursor/mcp.json  (or .cursor/mcp.json inside a project)',
  antigravity: '~/.gemini/config/mcp_config.json',
};

function siteSlug(name) {
  return (name || 'my-site').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'my-site';
}

// Highlighters return a SINGLE HTML string (not a React node array) so the
// codeblock renders as one block via dangerouslySetInnerHTML, eliminates
// any whitespace artifacts from per-line span wrapping / React array
// reconciliation that browsers sometimes surface inside `white-space: pre`.
function renderJSON(text) {
  return text
    .split('\n')
    .map((ln) => ln
      .replace(/("[^"]*"):/g, '<span class="code-k">$1</span>:')
      .replace(/("[^"]*")(,?)$/g, '<span class="code-s">$1</span>$2'))
    .join('\n');
}

function renderTOML(text) {
  // Order matters: wrap strings FIRST so subsequent header/key regexes
  // never see naked quotes again. If we wrapped headers/keys first, the
  // string regex would match `"code-k"` inside our injected
  // <span class="code-k"> attribute and produce broken HTML.
  return text
    .split('\n')
    .map((ln) => ln
      .replace(/("[^"]*")/g, '<span class="code-s">$1</span>')
      .replace(/^(\[[^\]]+\])$/, '<span class="code-k">$1</span>')
      .replace(/^([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)/, '<span class="code-k">$1</span>$2'))
    .join('\n');
}

export default function MCPConfigTabs({ siteName, showGenerate = true }) {
  const boot = getBoot();
  // PHP-computed URL respects permalink settings (?rest_route= on plain).
  const url = boot?.mcpUrls?.regular
    || (boot?.siteUrl || 'http://localhost').replace(/\/+$/, '') + '/?rest_route=/uichemy/v2/mcp';
  const slug = siteSlug(siteName || boot?.siteName);
  const configKey = `${slug}-wordpress-uichemy-mcp`;
  const username = boot?.user?.login || 'your-wp-username';

  const ap = useAppPassword();
  const [activeTab, setActiveTab] = useState('prompt');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoCopied, setAutoCopied] = useState(false);
  const [error, setError] = useState('');

  const generated = ap.hasToken;
  const pwdPlaceholder = 'your-application-password';
  const pwdReal = ap.password || pwdPlaceholder;

  const envFor = (pwd) => ({
    WP_API_URL: url,
    WP_API_USERNAME: username,
    WP_API_PASSWORD: pwd,
  });

  const q = (v) => JSON.stringify(String(v));
  const jsonText = (pwd) => {
    const env = envFor(pwd);
    return [
      `"mcpServers": {`,
      `  ${q(configKey)}: {`,
      `    "command": "npx",`,
      `    "args": ["-y", "@automattic/mcp-wordpress-remote"],`,
      `    "env": {`,
      `      "WP_API_URL": ${q(env.WP_API_URL)},`,
      `      "WP_API_USERNAME": ${q(env.WP_API_USERNAME)},`,
      `      "WP_API_PASSWORD": ${q(env.WP_API_PASSWORD)}`,
      `    }`,
      `  }`,
      `}`,
    ].join('\n');
  };

  const tomlText = (pwd) => {
    const env = envFor(pwd);
    return [
      `[mcp_servers.${configKey}]`,
      `command = "npx"`,
      `args = ["-y", "@automattic/mcp-wordpress-remote"]`,
      ``,
      `[mcp_servers.${configKey}.env]`,
      `WP_API_URL = ${q(env.WP_API_URL)}`,
      `WP_API_USERNAME = ${q(env.WP_API_USERNAME)}`,
      `WP_API_PASSWORD = ${q(env.WP_API_PASSWORD)}`,
    ].join('\n');
  };

  const promptText = (pwd) => `Add this MCP server to the config of the app you are running in right now, then restart that app.

You are already running inside an AI client or IDE (for example Claude Desktop, Cursor, Codex, Antigravity, Windsurf, VS Code, or similar). Do NOT ask me which app you are in or where to add this figure it out yourself from your own environment, pick that app's MCP config file, and edit it directly. Use that app's correct format (JSON with an "mcpServers" object for most apps, or TOML with a "[mcp_servers.${configKey}]" table for Codex). Create the config file if it does not exist, and keep any MCP servers that are already there.

Before editing, quickly verify my machine is ready:
  1. Node.js is installed (\`node --version\`, v18 or newer). If it is missing or too old, tell me to install the LTS from https://nodejs.org/ and stop here.
  2. \`npx\` is available (\`npx --version\`). It ships with Node.js, so if step 1 passed this works too.

Server name: ${configKey}
Package: @automattic/mcp-wordpress-remote (launched via npx)

Required environment variables:
  WP_API_URL=${url}
  WP_API_USERNAME=${username}
  WP_API_PASSWORD=${pwd}

Add the entry, save the file, then tell me to restart the app. Confirm once it is connected.`;

  const cursorDeeplink = (pwd) => {
    const entry = {
      command: 'npx',
      args: ['-y', '@automattic/mcp-wordpress-remote'],
      env: envFor(pwd),
    };
    const b64 = typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(JSON.stringify(entry))))
      : '';
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(configKey)}&config=${b64}`;
  };

  // Single-line `node -e "..."` command. Pasted into Terminal / PowerShell /
  // cmd, it merges this MCP entry into Claude Desktop's config, creating the
  // file/dir if missing, preserving any existing mcpServers. Inner JS uses
  // ONLY single-quoted strings so the outer shell `"…"` quoting never breaks.
  const jsStr = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const claudeAutoConnectCommand = (pwd) => {
    const env = envFor(pwd);
    const inner = [
      // Match the Prompt tab's preflight: @automattic/mcp-wordpress-remote
      // needs Node 18+ (npx, modern ESM-friendly runtime). Bail loudly here
      // so the user gets a clear next step instead of a runtime error later.
      "const nv=parseInt(process.versions.node.split('.')[0],10);",
      "if(nv<18){console.error('Node.js 18 or newer required. You have v'+process.versions.node+'. Install the LTS from https://nodejs.org/ and re-run this command.');process.exit(1);}",
      "const fs=require('fs'),path=require('path'),os=require('os');",
      "const dir=process.platform==='darwin'",
      "?path.join(os.homedir(),'Library','Application Support','Claude')",
      ":process.platform==='win32'",
      "?path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Claude')",
      ":path.join(os.homedir(),'.config','Claude');",
      "const fp=path.join(dir,'claude_desktop_config.json');",
      "fs.mkdirSync(dir,{recursive:true});",
      "let cfg={};try{cfg=JSON.parse(fs.readFileSync(fp,'utf8'))||{}}catch(e){}",
      "cfg.mcpServers=cfg.mcpServers||{};",
      `cfg.mcpServers[${jsStr(configKey)}]={command:'npx',args:['-y','@automattic/mcp-wordpress-remote'],env:{WP_API_URL:${jsStr(env.WP_API_URL)},WP_API_USERNAME:${jsStr(env.WP_API_USERNAME)},WP_API_PASSWORD:${jsStr(env.WP_API_PASSWORD)}}};`,
      "fs.writeFileSync(fp,JSON.stringify(cfg,null,2));",
      "console.log('UiChemy MCP added to '+fp+'. Restart Claude Desktop.');",
    ].join(' ');
    return `node -e "${inner}"`;
  };

  let displayText, copyContent, htmlText;
  if (activeTab === 'prompt') {
    displayText = promptText(pwdReal);
    copyContent = displayText;
    htmlText    = null;
  } else if (activeTab === 'codex') {
    displayText = tomlText(pwdReal);
    copyContent = displayText;
    htmlText    = renderTOML(displayText);
  } else {
    displayText = jsonText(pwdReal);
    copyContent = displayText;
    htmlText    = renderJSON(displayText);
  }

  const generate = async () => {
    setError(''); setGenerating(true);
    try { await regenerateAppPassword('mcp'); }
    catch (e) { setError(e.message || __('Could not generate Application Password.', 'uichemy')); }
    finally { setGenerating(false); }
  };

  const copy = async () => {
    if (!generated) return;
    const ok = await copyText(copyContent);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };

  const copyAutoConnect = async () => {
    if (!generated) return;
    const ok = await copyText(claudeAutoConnectCommand(pwdReal));
    if (ok) { setAutoCopied(true); setTimeout(() => setAutoCopied(false), 1800); }
  };

  const active = MCP_TABS.find((t) => t.id === activeTab) || MCP_TABS[0];

  return (
    <>
      <Tabs
        variant="pill"
        size="sm"
        value={activeTab}
        onValueChange={(v) => { setActiveTab(v); setCopied(false); }}
        className="mcp-tabs__nav"
      >
        <TabsList>
          {MCP_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="codeblock">
        <div className="codeblock__bar">
          <span>{active.file}</span>
          {/* uc-pop-dark remaps the surface/text/border tokens to their dark
              values, so the DS Buttons render light-on-dark to match the
              code bar (their default neutral tone is tuned for light). */}
          <div className="row uc-pop-dark" style={{ gap: 8 }}>
            {showGenerate ? (
              <Button
                variant="outline"
                tone="neutral"
                size="sm"
                onClick={generate}
                loading={generating}
                disabled={generating}
              >
                <Icon.Key size={12}/> {generated ? __('Regenerate', 'uichemy') : __('Generate', 'uichemy')}
              </Button>
            ) : null}
            {activeTab === 'cursor' && generated ? (
              <Tooltip content={__('Open Cursor and install the server', 'uichemy')}>
                <Button variant="outline" tone="neutral" size="sm" asChild>
                  <a href={cursorDeeplink(pwdReal)}>
                    <Icon.ExtLink size={12}/> {__('Add to Cursor', 'uichemy')}
                  </a>
                </Button>
              </Tooltip>
            ) : null}
            <Button
              variant="outline"
              tone="neutral"
              size="sm"
              onClick={copy}
              disabled={!generated}
            >
              {copied ? <><Icon.Check size={12}/> {__('Copied', 'uichemy')}</> : <><Icon.Copy size={12}/> {__('Copy', 'uichemy')}</>}
            </Button>
            {activeTab === 'claude' ? (
              <Tooltip content={__('Copy & paste this command into your terminal to automatically add the Claude Desktop MCP. Needs Node.js 18+.', 'uichemy')}>
                <Button
                  variant="outline"
                  tone="neutral"
                  size="sm"
                  onClick={copyAutoConnect}
                  disabled={!generated}
                >
                  {autoCopied ? <><Icon.Check size={12}/> {__('Copied', 'uichemy')}</> : <><Icon.AutoConnect size={12}/> {__('Auto Connect', 'uichemy')}</>}
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
        {/* DS ScrollArea: consistent, dark-themed scrollbars across browsers
            (uc-pop-dark scopes the scrollbar tokens to the dark code surface). */}
        <ScrollArea className="codeblock__scroll uc-pop-dark">
          <pre>{htmlText
            ? <code dangerouslySetInnerHTML={{ __html: htmlText }} />
            : <code>{displayText}</code>}</pre>
        </ScrollArea>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-4)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Icon.Info size={13} style={{ flexShrink: 0, marginTop: 2 }}/>
        {error ? (
          <span style={{ color: 'var(--status-err)' }}>{error}</span>
        ) : !generated ? (
          <span>{__('Generate an Application Password to reveal and copy the real config.', 'uichemy')}</span>
        ) : activeTab === 'prompt' ? (
          <span>{__('Paste this prompt into Claude Desktop, Cursor, Codex or Antigravity. The AI will add the config for you.', 'uichemy')}</span>
        ) : activeTab === 'claude' ? (
          <span><b>{__('Save to:', 'uichemy')}</b> <span style={{ fontFamily: 'var(--font-mono)' }}>{MCP_PATHS[activeTab]}</span>. {__('Or click', 'uichemy')} <b>{__('Auto Connect', 'uichemy')}</b>, {__('paste in your terminal, and restart Claude Desktop.', 'uichemy')}</span>
        ) : (
          <span><b>{__('Save to:', 'uichemy')}</b> <span style={{ fontFamily: 'var(--font-mono)' }}>{MCP_PATHS[activeTab]}</span>. {__('Then restart the client.', 'uichemy')}</span>
        )}
      </div>
    </>
  );
}
