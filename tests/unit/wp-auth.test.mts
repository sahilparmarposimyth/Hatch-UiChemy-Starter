// Run: node --experimental-strip-types tests/unit/wp-auth.test.mts  (Node 22.6+)
import { getSessionToken, sessionAuthHeaders, cookiesForWordPress, clientIpHeaders, relaySessionCookie, clearSessionCookie, redactToken } from '../../astro-starter/src/lib/wp-auth.ts';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };
const req = (cookie?: string) => new Request('https://site.example/x', { headers: cookie ? { cookie } : {} });

ok(getSessionToken(req('a=1; hatch_jwt=abc.def.ghi; b=2')) === 'abc.def.ghi', 'reads the session token');
ok(getSessionToken(req('a=1')) === '', 'no cookie -> empty token');
ok(sessionAuthHeaders(req('hatch_jwt=t1')).Authorization === 'Bearer t1', 'Bearer header built from cookie');
ok(Object.keys(sessionAuthHeaders(req())).length === 0, 'anonymous -> no Authorization header');

const fwd = cookiesForWordPress(req('wp_woocommerce_session_x=cart; hatch_jwt=SECRET; wordpress_logged_in_abc=ADMIN; wp-settings-1=a; woocommerce_items_in_cart=1'));
ok(fwd === 'wp_woocommerce_session_x=cart; woocommerce_items_in_cart=1', 'Woo cart cookies kept, identity cookies dropped: ' + fwd);
ok(!/SECRET|ADMIN/.test(fwd), 'no JWT or WP login cookie leaks to WordPress');

ok(clientIpHeaders('203.0.113.9')['CF-Connecting-IP'] === '203.0.113.9', 'client IP forwarded');
ok(Object.keys(clientIpHeaders('1.2.3.4, evil')).length === 0, 'junk IP not forwarded');
ok(Object.keys(clientIpHeaders(undefined)).length === 0, 'missing IP not forwarded');

const up = new Response('{}', { headers: [['set-cookie', 'hatch_jwt=tok; Path=/; Domain=wp.internal; HttpOnly; SameSite=Lax'], ['set-cookie', 'wordpress_logged_in_x=adm; Path=/'], ['set-cookie', 'wp-settings-1=a']] });
const out = new Headers();
relaySessionCookie(up, out, 'https://site.example/api/auth/login');
const cookies = (out as any).getSetCookie();
ok(cookies.length === 1 && cookies[0].startsWith('hatch_jwt=tok'), 'only the session cookie is relayed');
ok(!/Domain=/i.test(cookies[0]), 'Domain stripped');
ok(/; Secure/.test(cookies[0]), 'Secure added on https');
const out2 = new Headers();
relaySessionCookie(up, out2, 'http://localhost:4321/api/auth/login');
ok(!/; Secure/.test((out2 as any).getSetCookie()[0]), 'no Secure on plain http dev');
ok(/Max-Age=0/.test(clearSessionCookie('https://site.example/')) && /Secure/.test(clearSessionCookie('https://site.example/')), 'clear cookie expires + Secure');
ok(JSON.stringify(redactToken({ ok: true, token: 'JWT', user: { id: 1 } })) === '{"ok":true,"user":{"id":1}}', 'token stripped from JSON body');
process.exit(fail ? 1 : 0);
