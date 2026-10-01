// Sliding-session refresh (starter side).
//   node --experimental-strip-types tests/unit/refresh.test.mts   (Node 22.6+)
import http from 'node:http';
import { refreshSessionIfDue, tokenExpiry } from '../../astro-starter/src/lib/wp-auth.ts';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (expInSeconds: number) => `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + expInSeconds })}.sig${Math.random().toString(36).slice(2)}`;
const req = (token?: string) => new Request('https://site.example/account', { headers: token ? { cookie: `hatch_jwt=${token}` } : {} });

let calls = 0;
let nextStatus = 200;
let seenAuth = '';
const server = http.createServer((r, res) => {
  calls++;
  seenAuth = String(r.headers.authorization || '');
  if (nextStatus === 200) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'hatch_jwt=NEWTOKEN; Path=/; Domain=wp.internal; HttpOnly; SameSite=Lax' });
    res.end('{"ok":true}');
  } else {
    res.writeHead(nextStatus, { 'Content-Type': 'application/json' });
    res.end('{"code":"x"}');
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

ok(tokenExpiry(jwt(100)) !== null, 'expiry is read from the token payload');
ok(tokenExpiry('garbage') === null && tokenExpiry('a.b.c') === null, 'malformed tokens give null, not a throw');

console.log('When to refresh');
calls = 0;
ok((await refreshSessionIfDue(req(), base)).length === 0 && calls === 0, 'signed-out visitor: no call');
ok((await refreshSessionIfDue(req(jwt(20 * 3600)), base)).length === 0 && calls === 0, 'fresh token (20 h left): no call');
ok((await refreshSessionIfDue(req(jwt(-5)), base)).length === 0 && calls === 0, 'already-expired token: no call');

console.log('Refreshing');
const t1 = jwt(3600);
const cookies = await refreshSessionIfDue(req(t1), base);
ok(calls === 1 && seenAuth === `Bearer ${t1}`, 'token in its last 2 h is traded, sent as a Bearer header');
ok(cookies.length === 1 && cookies[0].startsWith('hatch_jwt=NEWTOKEN'), 'the new session cookie is returned');
ok(!/Domain=/i.test(cookies[0]) && /; Secure/.test(cookies[0]), 'cookie bound to the site origin and Secure on https');

console.log('Concurrency');
calls = 0;
const t2 = jwt(3000);
const results = await Promise.all([1, 2, 3, 4, 5].map(() => refreshSessionIfDue(req(t2), base)));
ok(calls === 1, 'five simultaneous page loads cause ONE refresh call (token rotates once)');
ok(results.every((r) => r.length === 1), 'every one of them still gets the new cookie');

console.log('Failure handling');
nextStatus = 401;
const dead = await refreshSessionIfDue(req(jwt(1000)), base);
ok(dead.length === 1 && /Max-Age=0/.test(dead[0]), 'a token WordPress rejects gets its cookie cleared');
nextStatus = 500;
ok((await refreshSessionIfDue(req(jwt(1000)), base)).length === 0, 'a WordPress error leaves the session alone');
server.close();
ok((await refreshSessionIfDue(req(jwt(1000)), 'http://127.0.0.1:9')).length === 0, 'WordPress unreachable: no throw, session untouched');

process.exitCode = fail ? 1 : 0;
