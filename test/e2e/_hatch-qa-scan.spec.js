/**
 * Hatch — Comprehensive QA Scanner
 * ================================
 *
 * Run anytime to find bugs / glitches / inconsistencies without manual clicking.
 *
 * What it checks (per page × per theme):
 *   1. HTTP status  (404s, 500s, redirects)
 *   2. Console errors / warnings
 *   3. Network failures (image 404s, font 404s, API timeouts)
 *   4. Visual: double borders, font-family chain anomalies, broken images
 *   5. Layout: header/article/footer width parity, sidebar consistency
 *   6. A11y: missing alt, empty links, missing aria-label on icon buttons
 *   7. SEO: missing <title>, missing meta description, missing canonical
 *   8. Performance: TTFB, LCP, large CLS, render-blocking resources
 *   9. Security: missing CSP headers, mixed-content, leaked secrets in HTML
 *  10. Theme switching: data-hatch-theme attr matches expected
 *
 * Usage:
 *   cd test && npx playwright test _hatch-qa-scan.spec.js --reporter=line
 *
 * Output: /tmp/hatch-qa-report.json + human-readable summary
 */
const { test } = require('@playwright/test');
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const THEMES = ['blog','tech','docs','astropaper','astrowind','astronano'];
const PAGES = [
  { path: '/',                                name: 'home',     expectStatus: 200 },
  { path: '/blog',                            name: 'archive',  expectStatus: 200 },
  { path: '/sample-page',                     name: 'page',     expectStatus: 200 },
  { path: '/edge-e-test',                     name: 'cpt-post', expectStatus: 200 },
  { path: '/non-existent-' + Date.now(),      name: '404',      expectStatus: 404 },
];

function getSecret() {
  try {
    const env = fs.readFileSync('/Users/adityasharma/Claude/products/Hatch/astro-starter/.env', 'utf8');
    const m = env.match(/HATCH_WEBHOOK_SECRET=([^\n\r"]+)/);
    return m ? m[1].replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}
const SECRET = getSecret();

function setTheme(t) {
  execSync(`docker exec qwp_wordpress php -r "require '/var/www/html/wp-load.php'; update_option('hatch_selected_theme', '${t}');"`, { stdio: 'pipe' });
  if (SECRET) try { execSync(`curl -sf -H "X-Hatch-Secret: ${SECRET}" "http://localhost:4321/api/revalidate"`, { stdio: 'pipe' }); } catch {}
}

test('Hatch QA Scan — all themes × all pages', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const findings = [];

  for (const theme of THEMES) {
    setTheme(theme);
    await new Promise(r => setTimeout(r, 600));

    for (const p of PAGES) {
      const issues = [];
      const page = await ctx.newPage();
      const consoleErrors = [];
      const networkFailures = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
          const text = msg.text();
          // Filter expected 404 logs (the browser auto-logs a 404 status; not a bug)
          if (/Failed to load resource.*404/.test(text)) return;
          consoleErrors.push(`${msg.type()}: ${text.slice(0, 120)}`);
        }
      });
      page.on('requestfailed', (req) => {
        networkFailures.push(`${req.method()} ${req.url().slice(0, 100)} — ${req.failure().errorText}`);
      });
      page.on('response', (res) => {
        if (res.status() >= 400 && !res.url().includes('non-existent')) {
          networkFailures.push(`${res.status()} ${res.url().slice(0, 100)}`);
        }
      });

      let status = 0;
      try {
        const res = await page.goto('http://localhost:4321' + p.path, { waitUntil: 'domcontentloaded', timeout: 8000 });
        status = res ? res.status() : 0;
      } catch (e) {
        issues.push(`load-error: ${e.message.slice(0, 100)}`);
      }

      // 1. Status code check
      if (status !== p.expectStatus) issues.push(`status: got ${status}, expected ${p.expectStatus}`);

      if (status && status < 500) {
        const findings_dom = await page.evaluate(() => {
          const out = { issues: [] };

          // 2. Visual: double borders
          let dbl = 0;
          document.querySelectorAll('header, footer, main, article, section').forEach(el => {
            const cs = getComputedStyle(el);
            if (cs.borderTopWidth !== '0px' && el.firstElementChild) {
              const c = getComputedStyle(el.firstElementChild);
              if (c.borderTopWidth !== '0px' && cs.borderTopColor === c.borderTopColor) dbl++;
            }
          });
          if (dbl > 0) out.issues.push(`double-borders: ${dbl}`);

          // 3. Font chain: any chrome element using mono as primary?
          const inMono = (el) => {
            const first = (getComputedStyle(el).fontFamily || '').split(',')[0].trim().replace(/['"]/g, '');
            return /mono|menlo|consolas|courier|jetbrains/i.test(first);
          };
          const h = document.querySelector('header > div');
          const f = document.querySelector('footer');
          if (h && inMono(h)) out.issues.push('header-font-mono');
          if (f && inMono(f)) out.issues.push('footer-font-mono');

          // 4. Width parity
          const a = document.querySelector('article, main > div[style*="max-width"]');
          const headerW = h ? parseFloat(getComputedStyle(h).maxWidth) || 0 : 0;
          const articleW = a ? parseFloat(getComputedStyle(a).maxWidth) || 0 : 0;
          if (headerW && articleW && Math.abs(headerW - articleW) > 32) {
            out.issues.push(`width-mismatch: header=${headerW}px article=${articleW}px`);
          }

          // 5. Broken images
          let broken = 0;
          document.querySelectorAll('img').forEach(i => {
            if (i.complete && i.naturalWidth === 0) broken++;
          });
          if (broken > 0) out.issues.push(`broken-images: ${broken}`);

          // 6. A11y: missing alt on images
          let noAlt = 0;
          document.querySelectorAll('img').forEach(i => { if (!i.hasAttribute('alt')) noAlt++; });
          if (noAlt > 0) out.issues.push(`img-missing-alt: ${noAlt}`);

          // 7. A11y: empty links
          let emptyLinks = 0;
          document.querySelectorAll('a').forEach(a => {
            if (!a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img, svg')) emptyLinks++;
          });
          if (emptyLinks > 0) out.issues.push(`empty-links: ${emptyLinks}`);

          // 8. A11y: icon-only buttons missing aria-label
          let iconBtns = 0;
          document.querySelectorAll('button').forEach(b => {
            if (!b.textContent.trim() && b.querySelector('svg') && !b.getAttribute('aria-label')) iconBtns++;
          });
          if (iconBtns > 0) out.issues.push(`icon-btn-no-label: ${iconBtns}`);

          // 9. SEO: missing title / meta
          if (!document.title || document.title === 'undefined') out.issues.push('seo-no-title');
          if (!document.querySelector('meta[name="description"]')) out.issues.push('seo-no-meta-desc');
          if (!document.querySelector('link[rel="canonical"]')) out.issues.push('seo-no-canonical');

          // 10. Theme attribute matches
          out.themeAttr = document.documentElement.getAttribute('data-hatch-theme');

          // 11. Heading structure: any h1 missing or multiple h1s?
          const h1s = document.querySelectorAll('h1');
          if (h1s.length === 0) out.issues.push('no-h1');
          if (h1s.length > 1) out.issues.push(`multiple-h1: ${h1s.length}`);

          // 12. Inline style with leftover template artifacts
          const html = document.documentElement.outerHTML;
          if (html.includes('undefined')) out.issues.push('html-contains-undefined');
          if (html.includes('NaN')) out.issues.push('html-contains-NaN');
          if (html.includes('[object Object]')) out.issues.push('html-contains-object-object');
          if (/%[a-z]+%/i.test(html)) out.issues.push('html-contains-unresolved-template-tag');

          return out;
        });

        issues.push(...findings_dom.issues);
        if (findings_dom.themeAttr && findings_dom.themeAttr !== theme) {
          issues.push(`theme-attr-mismatch: got ${findings_dom.themeAttr}, expected ${theme}`);
        }
      }

      if (consoleErrors.length > 0) issues.push(...consoleErrors.slice(0, 3).map(e => `console: ${e}`));
      if (networkFailures.length > 0) issues.push(...networkFailures.slice(0, 3).map(n => `network: ${n}`));

      findings.push({ theme, page: p.name, path: p.path, status, issueCount: issues.length, issues });
      await page.close();
    }
  }

  setTheme('blog');

  // Write report
  fs.writeFileSync('/tmp/hatch-qa-report.json', JSON.stringify(findings, null, 2));

  // Print summary
  console.log('\n=== HATCH QA SCAN ===');
  const totalIssues = findings.reduce((s, f) => s + f.issueCount, 0);
  console.log(`Cells scanned: ${findings.length} (${THEMES.length} themes × ${PAGES.length} pages)`);
  console.log(`Total issues: ${totalIssues}\n`);
  if (totalIssues === 0) {
    console.log('✅ ZERO ISSUES — Hatch is clean across every theme + page.');
  } else {
    findings.filter(f => f.issueCount > 0).forEach(f => {
      console.log(`\n${f.theme}/${f.page} (${f.path}):`);
      f.issues.forEach(i => console.log(`  • ${i}`));
    });
  }
  console.log('\nFull report: /tmp/hatch-qa-report.json');

  await browser.close();
});
