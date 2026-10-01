// Agent + installer checks (plugin audit H-4, M-6).
//   node tests/unit/agent-installer.test.mjs
//
// 1. install-template.sh: hostile values, delivered base64-encoded the way the
//    plugin delivers them, must be rejected by validation and never executed.
// 2. agent.js: serves HTTPS, signs every response (including errors) with the
//    formula the plugin verifies, rejects unsigned requests, and presents the
//    certificate whose public-key hash the plugin pins.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentDir = path.resolve(here, '../../wp-plugin/agent');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-agent-test-'));
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) failures++; };
const have = (cmd) => { try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };

// ---------------------------------------------------------------- template
console.log('install-template.sh rejects hostile values');
if (!have('bash')) {
  console.log('  SKIP  bash not available');
} else {
  const template = fs.readFileSync(path.join(agentDir, 'install-template.sh'), 'utf8');
  const head = template.split('# ---- preflight ----')[0];
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const render = (v) => head
    .replaceAll('{{HATCH_SECRET_B64}}', b64('a'.repeat(48)))
    .replaceAll('{{HATCH_PORT}}', '34210')
    .replaceAll('{{HATCH_WORKDIR_B64}}', b64(v.workdir ?? '/var/www/hatch-frontend'))
    .replaceAll('{{HATCH_WP_URL_B64}}', b64(v.wp ?? 'https://wp.example.com'))
    .replaceAll('{{HATCH_GIT_REPO_B64}}', b64(v.repo ?? ''))
    .replaceAll('{{HATCH_BRANCH_B64}}', b64(v.branch ?? 'main'))
    .replaceAll('{{HATCH_PM2_NAME_B64}}', b64(v.pm2 ?? 'hatch-frontend'));
  const run = (v) => {
    fs.rmSync(path.join(tmp, 'PWNED'), { force: true });
    let out = '';
    // The script goes in on stdin: no path quirks between Windows and bash.
    try { out = execFileSync('bash', ['-s'], { cwd: tmp, input: render(v) + '\necho VALID\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { out = String(e.stderr || '') + String(e.stdout || ''); }
    return { out, pwned: fs.existsSync(path.join(tmp, 'PWNED')) };
  };
  const good = run({});
  ok(good.out.includes('VALID'), 'sane values pass validation');
  const evil = [
    ['workdir', '/var/www/x"; touch PWNED; #'],
    ['workdir', '/var/www/$(touch PWNED)'],
    ['workdir', '/var/../etc'],
    ['repo', 'https://x/y.git"; touch PWNED; "'],
    ['repo', '`touch PWNED`'],
    ['branch', 'main; touch PWNED'],
    ['pm2', 'x$(touch PWNED)'],
    ['wp', 'https://wp.example.com"; touch PWNED; "'],
  ];
  for (const [field, value] of evil) {
    const r = run({ [field]: value });
    ok(!r.pwned && !r.out.includes('VALID'), `${field} = ${JSON.stringify(value)} rejected, nothing executed`);
  }
}

// ------------------------------------------------------------------- agent
console.log('agent.js: HTTPS, signed responses, pinnable certificate');
if (!have('openssl')) {
  console.log('  SKIP  openssl not available');
} else {
  const secret = 'b'.repeat(48);
  const port = 34900 + Math.floor(Math.random() * 90);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=hatch-agent', '-keyout', 'key.pem', '-out', 'cert.pem'], { cwd: tmp, stdio: 'ignore' });
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ secret, port, bind: '127.0.0.1', workdir: '.', pm2_name: 'x', tls_cert: 'cert.pem', tls_key: 'key.pem' }));
  const child = spawn(process.execPath, [path.join(agentDir, 'agent.js')], { cwd: tmp, env: { ...process.env, HATCH_AGENT_CONFIG: 'config.json' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));

  const spki = (der) => crypto.createHash('sha256').update(new crypto.X509Certificate(der).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const call = (p, signed) => new Promise((resolve, reject) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(8).toString('hex');
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${nonce}.GET.${p}.`).digest('hex');
    const req = https.request({ host: '127.0.0.1', port, path: p, method: 'GET', rejectUnauthorized: false,
      headers: signed ? { 'X-Hatch-Timestamp': ts, 'X-Hatch-Nonce': nonce, 'X-Hatch-Signature': sig } : {} }, (resp) => {
      const peer = resp.socket.getPeerCertificate(true);
      let body = '';
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body, peer }));
    });
    req.on('error', reject);
    req.end();
  });
  const signatureOk = (r) => crypto.createHmac('sha256', secret)
    .update(`${r.headers['x-hatch-timestamp']}.${r.headers['x-hatch-nonce']}.${r.body}`).digest('hex') === r.headers['x-hatch-signature'];

  try {
    const h = await call('/v1/healthz', true);
    ok(h.status === 200, 'signed request answered over HTTPS');
    ok(signatureOk(h), 'response signature verifies with the plugin\'s formula');
    ok(spki(h.peer.raw) === spki(fs.readFileSync(path.join(tmp, 'cert.pem'))), 'served certificate matches the file (stable pin)');
    const u = await call('/v1/status', false);
    ok(u.status === 401, 'unsigned request rejected');
    ok(signatureOk(u), 'error responses are signed too');
  } finally {
    child.kill();
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may still hold the agent's files; the OS cleans the temp dir later */ }
console.log('\n' + (failures ? `${failures} failure(s)` : 'All checks passed'));
process.exit(failures ? 1 : 0);
