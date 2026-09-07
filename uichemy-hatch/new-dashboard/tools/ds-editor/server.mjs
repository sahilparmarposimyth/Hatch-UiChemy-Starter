/**
 * UiChemy — internal Design-System editor server.
 *
 * INTERNAL DEV TOOL. Not shipped in the plugin, not enqueued anywhere.
 *
 * Serves:
 *   - the editor UI at            GET  /ds-editor
 *   - the live DS gallery (real   (static)  /new-dashboard/dev-preview.html?nd_preview=ds-gallery
 *     app, real components) which the editor embeds in an iframe
 *   - the token API:             GET  /ds-editor/api/tokens   → current values
 *                                POST /ds-editor/api/save     → patch tokens.css + rebuild
 *
 * The single source of truth for the look is the --uc-* tokens in
 * src/design-system/styles/tokens.css. Because every DS component reads those
 * tokens, editing them re-themes the whole system ("same colors and all").
 *
 * Run:  node tools/ds-editor/server.mjs   (from the new-dashboard/ folder)
 * Then: open http://localhost:8899/ds-editor
 */
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEW_DASH = path.resolve(__dirname, '../../');        // …/new-dashboard
const PLUGIN_ROOT = path.resolve(NEW_DASH, '../');         // plugin root = static serve root
const TOKENS_FILE = path.join(NEW_DASH, 'src/design-system/styles/tokens.css');
const COMPONENT_FILE = path.join(NEW_DASH, 'src/design-system/styles/component-tokens.css');
const FILES = { tokens: TOKENS_FILE, components: COMPONENT_FILE };
const EDITOR_HTML = path.join(__dirname, 'editor.html');
const PORT = Number(process.env.PORT || 8899);

/* ---- Which tokens are editable, grouped, and which scope block they live in.
   block 'base'  → surface-independent block (brand/status colors, radius, type)
   block 'light' → light content surface block (surfaces, text, borders, family) */
const GROUPS = [
  // ---- Global TOKENS (tokens.css) ------------------------------------------
  { key: 'brand',   title: 'Brand & status', file: 'tokens', block: 'base', kind: 'color',
    tokens: ['--uc-brand','--uc-brand-on','--uc-success','--uc-success-on','--uc-danger','--uc-danger-on','--uc-warning','--uc-warning-on'] },
  { key: 'surface', title: 'Surfaces', file: 'tokens', block: 'light', kind: 'color',
    tokens: ['--uc-surface-sunken','--uc-surface-base','--uc-surface-raised','--uc-surface-control'] },
  { key: 'text',    title: 'Text & inverse', file: 'tokens', block: 'light', kind: 'color',
    tokens: ['--uc-text-strong','--uc-text','--uc-text-muted','--uc-text-subtle','--uc-inverse-bg','--uc-inverse-fg'] },
  { key: 'border',  title: 'Borders & ring', file: 'tokens', block: 'light', kind: 'color',
    tokens: ['--uc-border-subtle','--uc-border','--uc-border-strong','--uc-ring'] },
  { key: 'family',  title: 'Per-family (fg / soft)', file: 'tokens', block: 'light', kind: 'color',
    tokens: ['--uc-brand-fg','--uc-brand-soft','--uc-success-fg','--uc-success-soft','--uc-danger-fg','--uc-danger-soft','--uc-warning-fg','--uc-warning-soft','--uc-accent-fg','--uc-accent-soft'] },
  { key: 'radius',  title: 'Radius', file: 'tokens', block: 'base', kind: 'dim',
    tokens: ['--uc-radius-2','--uc-radius-4','--uc-radius-6','--uc-radius-8','--uc-radius-12','--uc-radius-16','--uc-radius-24','--uc-radius-32'] },
  { key: 'type',    title: 'Type scale & weight', file: 'tokens', block: 'base', kind: 'dim',
    tokens: ['--uc-text-xs','--uc-text-sm','--uc-text-base','--uc-text-md','--uc-text-lg','--uc-text-xl','--uc-text-2xl','--uc-text-3xl','--uc-weight-regular','--uc-weight-medium','--uc-weight-semibold'] },

  // ---- Per-COMPONENT knobs (component-tokens.css). Change one component only.
  { key: 'c-button', title: 'Component · Button', file: 'components', block: 'base', kind: 'dim', component: true,
    tokens: ['--uc-btn-radius','--uc-btn-weight','--uc-btn-h','--uc-btn-px'] },
  { key: 'c-input',  title: 'Component · Input', file: 'components', block: 'base', kind: 'dim', component: true,
    tokens: ['--uc-input-radius','--uc-input-h','--uc-input-px'] },
  { key: 'c-card',   title: 'Component · Card', file: 'components', block: 'base', kind: 'dim', component: true,
    tokens: ['--uc-card-radius','--uc-card-pad'] },
  { key: 'c-tabs',   title: 'Component · Tabs (pill)', file: 'components', block: 'base', kind: 'dim', component: true,
    tokens: ['--uc-tab-track-bg','--uc-tab-track-stroke','--uc-tab-track-radius','--uc-tab-track-pad','--uc-tab-radius','--uc-tab-h','--uc-tab-px'] },
];

/* Selector signatures that identify the two blocks we edit. The base block lists
   all four scopes (incl. .uc-chrome); the light block lists three (no chrome). */
const SIG = {
  base:  /\.uc-scope\s*,\s*\.uc-content\s*,\s*\.uc-chrome\s*,\s*\.uc-portal\s*\{/,
  light: /\.uc-scope\s*,\s*\.uc-content\s*,\s*\.uc-portal\s*\{/,
};

function blockRange(css, which) {
  const m = SIG[which].exec(css);
  if (!m) throw new Error('token block not found: ' + which);
  const open = m.index + m[0].length - 1;   // index of '{'
  const close = css.indexOf('}', open);      // these blocks have no nested braces
  return { open, close };
}

function tokenRe(name) {
  return new RegExp('(' + name.replace(/[-]/g, '\\-') + '\\s*:\\s*)([^;]+)(;)');
}

function readVal(body, name) {
  const m = tokenRe(name).exec(body);
  return m ? m[2].trim() : null;
}

function setVal(css, which, name, value) {
  const { open, close } = blockRange(css, which);
  const before = css.slice(0, open + 1);
  let body = css.slice(open + 1, close);
  const after = css.slice(close);
  const safe = String(value).replace(/\$/g, '$$$$');
  const re = tokenRe(name);
  if (re.test(body)) body = body.replace(re, `$1${safe}$3`);
  return before + body + after;
}

function bodyOf(css, which) {
  const r = blockRange(css, which);
  return css.slice(r.open + 1, r.close);
}

async function currentTokens() {
  const src = { tokens: await readFile(TOKENS_FILE, 'utf8'), components: await readFile(COMPONENT_FILE, 'utf8') };
  const bodies = {
    tokens: { base: bodyOf(src.tokens, 'base'), light: bodyOf(src.tokens, 'light') },
    components: { base: bodyOf(src.components, 'base') },
  };
  return GROUPS.map((g) => ({
    ...g,
    rows: g.tokens.map((name) => ({ name, value: readVal(bodies[g.file][g.block], name) })),
  }));
}

function runBuild() {
  return new Promise((resolve) => {
    exec('npm run build', { cwd: NEW_DASH, maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      const log = (stdout + '\n' + stderr).trim().split('\n').slice(-6).join('\n');
      resolve({ ok: !err, log });
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
  '.php': 'text/plain; charset=utf-8',
};

function sendJson(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    // ---- Editor UI
    if (pathname === '/ds-editor' || pathname === '/ds-editor/') {
      const html = await readFile(EDITOR_HTML);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // ---- API: current token values
    if (pathname === '/ds-editor/api/tokens') {
      return sendJson(res, 200, { groups: await currentTokens() });
    }

    // ---- API: save (patch tokens.css) + rebuild
    if (pathname === '/ds-editor/api/save' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { edits = [], rebuild = true } = JSON.parse(raw || '{}');
      // Group edits by target file, patch each file once.
      const byFile = {};
      for (const e of edits) {
        if (!e || !e.name || e.value == null) continue;
        const file = FILES[e.file] ? e.file : 'tokens';
        (byFile[file] ||= []).push(e);
      }
      for (const [file, list] of Object.entries(byFile)) {
        let css = await readFile(FILES[file], 'utf8');
        for (const e of list) css = setVal(css, e.block === 'light' ? 'light' : 'base', e.name, e.value);
        await writeFile(FILES[file], css, 'utf8');
      }
      const build = rebuild ? await runBuild() : { ok: true, log: '(skipped)' };
      return sendJson(res, 200, { ok: true, saved: edits.length, build });
    }

    // ---- Static (serve plugin root so /new-dashboard/* + ../uichemy-composer/* resolve)
    let rel = pathname.replace(/^\/+/, '');
    if (rel === '') rel = 'new-dashboard/dev-preview.html';
    const filePath = path.resolve(PLUGIN_ROOT, rel);
    if (!filePath.startsWith(PLUGIN_ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    const st = await stat(filePath).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  UiChemy DS editor → http://localhost:${PORT}/ds-editor`);
  console.log(`  Editing: ${path.relative(PLUGIN_ROOT, TOKENS_FILE)}`);
  console.log(`  (internal tool — serves the live gallery + saves to source)\n`);
});
