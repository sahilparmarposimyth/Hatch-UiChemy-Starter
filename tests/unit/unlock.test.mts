// Run: node --experimental-strip-types tests/unit/unlock.test.mts  (Node 22.6+)
import { getUnlockToken, safeNextPath, unlockCookieName, unlockUrl } from '../../astro-starter/src/lib/unlock.ts';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };
const req = (cookie: string) => new Request('https://site.example/x', { headers: { cookie } });

ok(unlockCookieName('My-Secret/Page') === 'hatch_pp_my-secret_page', 'cookie name is slug-derived and cookie-safe');
ok(unlockCookieName('a'.repeat(500)).length <= 'hatch_pp_'.length + 120, 'cookie name length is capped');
ok(getUnlockToken(req('x=1; hatch_pp_secret=abc.def; y=2'), 'secret') === 'abc.def', 'reads the token for that post');
ok(getUnlockToken(req('hatch_pp_other=zzz'), 'secret') === '', 'a different post\'s token is not used');
ok(getUnlockToken(req(''), 'secret') === '', 'no cookie -> no token');

ok(safeNextPath('/blog/x') === '/blog/x', 'relative path allowed');
ok(safeNextPath('//evil.example/x') === '/', 'protocol-relative URL rejected');
ok(safeNextPath('https://evil.example') === '/', 'absolute URL rejected');
ok(safeNextPath('/\\evil.example') === '/', 'backslash trick rejected');
ok(safeNextPath(null, '/home') === '/home', 'missing value uses the fallback');
ok(unlockUrl('secret', 'https://evil.example') === '/unlock?slug=secret&next=%2F', 'unlock URL never carries an external next');

process.exit(fail ? 1 : 0);
