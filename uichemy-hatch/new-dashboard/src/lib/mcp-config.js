/**
 * MCP config generation, the per-client configs for the AI Agent setup
 * stepper (McpSetup). Everything targets `@automattic/mcp-wordpress-remote`
 * with WP_API_URL / WP_API_USERNAME / WP_API_PASSWORD env vars.
 *
 * Each client gets TWO deliverables (the two panes in step 3 of McpSetup):
 *   • Config, the raw JSON/TOML block the user pastes into that client's
 *     config file by hand.
 *   • Prompt, a client-specific instruction the user pastes INTO that client
 *     so the AI edits its own config file. The prompt names the exact config
 *     path, which depends on the user's OS, so it is resolved against the
 *     detected platform (`detectOS`) and can be overridden in the UI.
 *
 * Pure module (only reads `getBoot()` / `navigator`). The escaping here is
 * fiddly (see the auto-connect command). NOTE: `components/MCPConfigTabs.jsx`
 * (the dashboard MCPPanel) still has a verbatim inline copy of the config
 * generators, keep the two in sync until that component is migrated onto this
 * module.
 */
import { getBoot } from './api.js';

/** The clients we hand out a config for. `fmt` picks the generator + highlighter. */
export const MCP_TOOLS = [
  { id: 'claude',      label: 'Claude Desktop', file: 'claude_desktop_config.json', fmt: 'json' },
  { id: 'cursor',      label: 'Cursor',         file: 'mcp.json',                   fmt: 'json' },
  { id: 'codex',       label: 'Codex',          file: 'config.toml',                fmt: 'toml' },
  { id: 'antigravity', label: 'Antigravity',    file: 'mcp_config.json',            fmt: 'json' },
  { id: 'prompt',      label: 'Other',          file: 'prompt.txt',                 fmt: 'prompt' },
];

/* ============================================================
   Platform detection + per-OS config paths
   ============================================================ */

export const OS_LABELS = { mac: 'macOS', windows: 'Windows', linux: 'Linux' };

/**
 * Best-effort guess of the OS the browser is running on, so the prompt can
 * name a real path instead of listing every platform. Order matters:
 * `MacIntel` / `Win32` come from the legacy `navigator.platform`, and the
 * UA-CH `platform` string ("macOS", "Windows", "Linux") wins when present.
 * Falls back to macOS. There is no manual override in the UI, the detected
 * platform is what both step-3 panes resolve their paths against.
 */
export function detectOS() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if ( ! nav ) return 'mac';
  const hint = String(
    nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  ).toLowerCase();
  if ( /mac|darwin|iphone|ipad|ipod/.test( hint ) ) return 'mac';
  if ( /win/.test( hint ) ) return 'windows';
  if ( /linux|x11|cros|android/.test( hint ) ) return 'linux';
  return 'mac';
}

/** Where each client keeps its MCP config, per platform. */
export const MCP_PATHS_BY_OS = {
  claude: {
    mac:     '~/Library/Application Support/Claude/claude_desktop_config.json',
    windows: '%APPDATA%\\Claude\\claude_desktop_config.json',
    linux:   '~/.config/Claude/claude_desktop_config.json',
  },
  cursor: {
    mac:     '~/.cursor/mcp.json',
    windows: '%USERPROFILE%\\.cursor\\mcp.json',
    linux:   '~/.cursor/mcp.json',
  },
  codex: {
    mac:     '~/.codex/config.toml',
    windows: '%USERPROFILE%\\.codex\\config.toml',
    linux:   '~/.codex/config.toml',
  },
  antigravity: {
    mac:     '~/.gemini/config/mcp_config.json',
    windows: '%USERPROFILE%\\.gemini\\config\\mcp_config.json',
    linux:   '~/.gemini/config/mcp_config.json',
  },
};

/** The config path for one client on one OS ('' for the generic prompt tool). */
export function mcpPath( toolId, os ) {
  const byOs = MCP_PATHS_BY_OS[ toolId ];
  if ( ! byOs ) return '';
  return byOs[ os ] || byOs.mac;
}

/** Legacy every-platform-on-one-line strings (still used by MCPConfigTabs). */
export const MCP_PATHS = {
  claude:      `macOS: ${ MCP_PATHS_BY_OS.claude.mac }  ·  Windows: ${ MCP_PATHS_BY_OS.claude.windows }`,
  codex:       MCP_PATHS_BY_OS.codex.mac,
  cursor:      `${ MCP_PATHS_BY_OS.cursor.mac }  (or .cursor/mcp.json inside a project)`,
  antigravity: MCP_PATHS_BY_OS.antigravity.mac,
};

/** Per-client facts the generated prompt needs: display name, format, restart step. */
const CLIENT_META = {
  claude: {
    name: 'Claude Desktop',
    fmt: 'json',
    note: 'Claude Desktop only reads this file at launch.',
    restart: 'Tell me to quit Claude Desktop completely (Cmd/Ctrl+Q, not just closing the window) and reopen it.',
  },
  cursor: {
    name: 'Cursor',
    fmt: 'json',
    note: 'A project-level .cursor/mcp.json also works if I only want the server in one project.',
    restart: 'Tell me to reload Cursor, then check Settings → MCP that the server is listed and green.',
  },
  codex: {
    name: 'Codex',
    fmt: 'toml',
    note: 'Codex uses TOML, not JSON, keep the existing tables in the file intact.',
    restart: 'Tell me to restart Codex (or start a new Codex session).',
  },
  antigravity: {
    name: 'Antigravity',
    fmt: 'json',
    note: 'Create the ~/.gemini/config folder if it is not there yet.',
    restart: 'Tell me to restart Antigravity, then confirm the server shows up in its MCP list.',
  },
};

export function siteSlug(name) {
  return (name || 'my-site').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'my-site';
}

// Highlighters return a SINGLE HTML string (not a React node array) so the
// codeblock renders as one block via dangerouslySetInnerHTML, eliminates
// whitespace artifacts from per-line span wrapping inside `white-space: pre`.
export function renderJSON(text) {
  return text
    .split('\n')
    .map((ln) => ln
      .replace(/("[^"]*"):/g, '<span class="code-k">$1</span>:')
      .replace(/("[^"]*")(,?)$/g, '<span class="code-s">$1</span>$2'))
    .join('\n');
}

export function renderTOML(text) {
  // Order matters: wrap strings FIRST so subsequent header/key regexes never
  // see naked quotes again (else the string regex matches `"code-k"` inside an
  // injected attribute and produces broken HTML).
  return text
    .split('\n')
    .map((ln) => ln
      .replace(/("[^"]*")/g, '<span class="code-s">$1</span>')
      .replace(/^(\[[^\]]+\])$/, '<span class="code-k">$1</span>')
      .replace(/^([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)/, '<span class="code-k">$1</span>$2'))
    .join('\n');
}

/**
 * Build the resolved MCP configs for a site + Application Password. Returns the
 * connection facts plus every client's config text (and the Cursor deeplink /
 * Claude auto-connect command). `pwd` is the plain Application Password, or a
 * placeholder before one is issued.
 */
export function buildMcp(siteName, pwd) {
  const boot = getBoot();
  // PHP-computed URL respects permalink settings (?rest_route= on plain).
  const url = boot?.mcpUrls?.regular
    || (boot?.siteUrl || 'http://localhost').replace(/\/+$/, '') + '/?rest_route=/uichemy/v2/mcp';
  const slug = siteSlug(siteName || boot?.siteName);
  const configKey = `${slug}-wordpress-uichemy-mcp`;
  const username = boot?.user?.login || 'your-wp-username';
  const env = { WP_API_URL: url, WP_API_USERNAME: username, WP_API_PASSWORD: pwd };

  const q = (v) => JSON.stringify(String(v));

  const jsonText = [
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

  // Same entry as a complete, standalone JSON document. The Config pane shows
  // the fragment (it gets merged into an existing file), but a prompt reads
  // better with a valid whole-file example.
  const jsonFullText = ['{', ...jsonText.split('\n').map((l) => `  ${l}`), '}'].join('\n');

  const tomlText = [
    `[mcp_servers.${configKey}]`,
    `command = "npx"`,
    `args = ["-y", "@automattic/mcp-wordpress-remote"]`,
    ``,
    `[mcp_servers.${configKey}.env]`,
    `WP_API_URL = ${q(env.WP_API_URL)}`,
    `WP_API_USERNAME = ${q(env.WP_API_USERNAME)}`,
    `WP_API_PASSWORD = ${q(env.WP_API_PASSWORD)}`,
  ].join('\n');

  const promptText = `Add this MCP server to the config of the app you are running in right now, then restart that app.

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

  const entry = {
    command: 'npx',
    args: ['-y', '@automattic/mcp-wordpress-remote'],
    env,
  };
  const b64 = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(JSON.stringify(entry))))
    : '';
  const cursorDeeplink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(configKey)}&config=${b64}`;

  // Single-line `node -e "..."` command. Pasted into a terminal it merges this
  // MCP entry into Claude Desktop's config, creating the file/dir if missing,
  // preserving existing mcpServers. Inner JS uses ONLY single-quoted strings so
  // the outer shell `"…"` quoting never breaks.
  const jsStr = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const inner = [
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
  const claudeAutoConnect = `node -e "${inner}"`;

  return { url, username, configKey, env, jsonText, jsonFullText, tomlText, promptText, cursorDeeplink, claudeAutoConnect };
}

/** The config text + highlighted HTML for one tool id, given a built context. */
export function toolConfig(ctx, toolId) {
  const tool = MCP_TOOLS.find((t) => t.id === toolId) || MCP_TOOLS[0];
  if (tool.fmt === 'prompt') return { text: ctx.promptText, html: null, tool };
  if (tool.fmt === 'toml')   return { text: ctx.tomlText, html: renderTOML(ctx.tomlText), tool };
  return { text: ctx.jsonText, html: renderJSON(ctx.jsonText), tool };
}

/**
 * The client-specific prompt: same connection facts as the config, but written
 * as an instruction for that client's own AI, and pinned to the config path for
 * `os` so the model never has to guess between the macOS and Windows location.
 *
 * The generic "Other" tool has no known path, so it keeps the self-detecting
 * prompt (`ctx.promptText`) that asks the model to work out its own home.
 */
export function toolPrompt( ctx, toolId, os ) {
  const meta = CLIENT_META[ toolId ];
  if ( ! meta ) return ctx.promptText;

  const osId    = OS_LABELS[ os ] ? os : 'mac';
  const osLabel = OS_LABELS[ osId ];
  const path    = mcpPath( toolId, osId );
  const isToml  = meta.fmt === 'toml';
  const snippet = isToml ? ctx.tomlText : ctx.jsonFullText;
  const fmtName = isToml ? 'TOML' : 'JSON';
  // Windows paths use backslashes and env vars (%APPDATA%), which shells and
  // editors expand differently, so spell out the literal expansion too.
  const pathNote = osId === 'windows'
    ? '\n(%APPDATA% is normally C:\\Users\\<you>\\AppData\\Roaming, and %USERPROFILE% is C:\\Users\\<you>.)'
    : '';

  return `You are ${ meta.name }. Add the UiChemy WordPress MCP server to your own MCP config file on this machine, then tell me to restart you.

My machine: ${ osLabel }
Config file to edit: ${ path }${ pathNote }

Rules for editing that file:
  - Create the file and any missing folders if they do not exist.
  - If the file already contains other MCP servers, KEEP them. Only add the one below.
  - Keep the file valid ${ fmtName }. ${ meta.note }

Before you edit, check my machine is ready:
  1. Node.js v18 or newer is installed (\`node --version\`). If it is missing or too old, tell me to install the LTS from https://nodejs.org/ and stop here.
  2. \`npx\` works (\`npx --version\`). It ships with Node.js, so if step 1 passed this does too.

Server name: ${ ctx.configKey }
Package: @automattic/mcp-wordpress-remote (launched with npx)

Add exactly this entry:

${ snippet }

When you are done:
  - Save the file and show me the final contents (you may mask the password).
  - ${ meta.restart }
  - After the restart, call one of the UiChemy MCP tools to prove the connection works, and report the result.

Do not paste WP_API_PASSWORD anywhere except inside that config file.`;
}
