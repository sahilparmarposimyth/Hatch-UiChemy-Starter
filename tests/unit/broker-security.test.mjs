// Deploy broker security checks (plugin audit H-5).
//   node tests/unit/broker-security.test.mjs
import crypto from 'node:crypto';
import http from 'node:http';
import {
  buildEnv, createRateLimiter, isPrivateAddress, makeRedactor, notifyWordPress, productionWarnings, safeProjectUrl, validatePrepare,
} from '../../hatch-deploy/lib/security.js';

let failures = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) failures++; };

const SECRET = 'whsec_' + 'a'.repeat(40);
const TOKEN = 'tok_' + 'b'.repeat(30);
const base = (over = {}) => ({
  wp_url: 'https://93.184.216.34',
  wp_user: 'uichemy-deploy',
  wp_pass: 'abcd efgh ijkl mnop',
  webhook_secret: SECRET,
  return_url: 'https://93.184.216.34/wp-admin/admin-post.php?action=hatch_deploy_callback&provider=vercel',
  vercel_token: TOKEN,
  ...over,
});
const check = (over) => validatePrepare(base(over), 'vercel_token');

console.log('/prepare validation');
const good = await check({});
ok(good.ok && good.value.wp_url === 'https://93.184.216.34', 'a normal request is accepted and normalised');

const rejects = [
  ['plain http site', { wp_url: 'http://93.184.216.34', return_url: 'http://93.184.216.34/wp-admin/admin-post.php' }],
  ['loopback target (SSRF)', { wp_url: 'https://127.0.0.1', return_url: 'https://127.0.0.1/wp-admin/admin-post.php' }],
  ['cloud metadata target (SSRF)', { wp_url: 'https://169.254.169.254', return_url: 'https://169.254.169.254/wp-admin/admin-post.php' }],
  ['private 10.x target', { wp_url: 'https://10.0.0.5', return_url: 'https://10.0.0.5/wp-admin/admin-post.php' }],
  ['IPv6 loopback target', { wp_url: 'https://[::1]', return_url: 'https://[::1]/wp-admin/admin-post.php' }],
  ['localhost name', { wp_url: 'https://localhost', return_url: 'https://localhost/wp-admin/admin-post.php' }],
  ['return_url over plain http', { return_url: 'http://93.184.216.34/wp-admin/admin-post.php' }],
  ['return_url not admin-post', { return_url: 'https://93.184.216.34/phishing' }],
  ['newline in wp_pass (.env injection)', { wp_pass: 'x\nHATCH_TARGET=evil' }],
  ['newline in wp_user', { wp_user: 'u\rX=1' }],
  ['credentials in wp_url', { wp_url: 'https://u:p@93.184.216.34' }],
  ['short webhook secret', { webhook_secret: 'short' }],
  ['token with shell characters', { vercel_token: 'tok_' + 'b'.repeat(20) + '; rm -rf /' }],
  ['missing user', { wp_user: '' }],
  ['non-string field', { wp_pass: { $ne: 1 } }],
];
for (const [label, over] of rejects) {
  const r = await check(over);
  ok(r.ok === false, `rejects ${label}`);
}
ok(isPrivateAddress('192.168.1.10') && isPrivateAddress('172.20.0.1') && !isPrivateAddress('8.8.8.8'), 'private-range classifier');

console.log('Secrets never leak');
const redact = makeRedactor(['p4ssw0rd-secret', SECRET, TOKEN]);
const line = `error: auth failed for p4ssw0rd-secret using ${TOKEN} (hook ${SECRET})`;
ok(!/p4ssw0rd-secret|whsec_|tok_b/.test(redact(line)), 'passwords, secrets and tokens are masked in log lines');
ok(redact('nothing secret here') === 'nothing secret here', 'ordinary lines are untouched');
ok(makeRedactor(['abc'])('abc') === 'abc', 'very short values are not treated as secrets (avoids mangling output)');

console.log('Build environment');
process.env.BROKER_SECRET_FOR_TEST = 'must-not-leak';
process.env.VERCEL_TOKEN = 'broker-level-token';
const env = buildEnv({ WP_API_PASS: 'step-needs-this' });
ok(env.BROKER_SECRET_FOR_TEST === undefined && env.VERCEL_TOKEN === undefined, 'npm/build subprocesses do not inherit the broker\'s secrets');
ok(env.WP_API_PASS === 'step-needs-this', 'variables a step explicitly asks for are passed');
ok(typeof env.PATH === 'string', 'PATH is preserved so tools still run');

console.log('Result URL');
ok(safeProjectUrl('https://my-site.vercel.app/path?x=1') === 'https://my-site.vercel.app', 'https URL reduced to its origin');
ok(safeProjectUrl('javascript:alert(1)') === null, 'javascript: URL refused');
ok(safeProjectUrl('http://my-site.vercel.app') === null, 'plain http refused');
ok(safeProjectUrl('https://user:pw@x.example') === null, 'URL with credentials refused');

console.log('Rate limit');
const limit = createRateLimiter({ max: 3, windowMs: 60_000 });
ok([1, 2, 3].every(() => limit('ip-a')) && limit('ip-a') === false, 'fourth request from one client is refused');
ok(limit('ip-b') === true, 'a different client is unaffected');

console.log('WordPress finish notice');
let received = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { received = { url: req.url, body: JSON.parse(body) }; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const acked = await notifyWordPress({ wpUrl: `http://127.0.0.1:${port}`, secret: SECRET, ticketId: 'T-123', status: 'success', provider: 'vercel' });
server.close();
ok(acked === true && received?.url === '/wp-json/hatch/v1/deploy/finished', 'posts to the plugin\'s finished route and is acknowledged');
const p = received.body;
const expected = crypto.createHmac('sha256', SECRET).update(`finished|${p.ticket}|${p.status}|${p.provider}|${p.ts}`).digest('hex');
ok(p.sig === expected, 'signature matches the formula the plugin verifies');
ok(Math.abs(Date.now() / 1000 - Number(p.ts)) < 5, 'timestamp is current');
ok(!JSON.stringify(p).includes(SECRET), 'the secret itself is never sent');
ok(await notifyWordPress({ wpUrl: 'http://127.0.0.1:9', secret: SECRET, ticketId: 't', status: 'failed', provider: 'vercel' }) === false, 'an unreachable site is reported as not acknowledged, not thrown');

console.log('Startup warnings');
ok(productionWarnings({}).length === 4, 'a default production setup is warned about proxy, branch and CLI pins');
ok(productionWarnings({ HATCH_TRUST_PROXY: '1', HATCH_BRANCH: 'v1.2.0', HATCH_VERCEL_CLI_VERSION: '39.0.0', HATCH_WRANGLER_VERSION: '4.0.0' }).length === 0, 'a pinned, proxied setup is not');
ok(productionWarnings({ HATCH_ALLOW_INSECURE: '1' }).some((w) => w.includes('SSRF')), 'insecure mode is called out');

console.log('\n' + (failures ?`${failures} failure(s)` : 'All checks passed'));
process.exit(failures ? 1 : 0);
