const { test } = require('@playwright/test');
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const THEMES = ['blog','tech','docs','astropaper','astrowind','astronano'];
const PAGES = [
  { path: '/', name: 'home' },
  { path: '/blog', name: 'archive' },
  { path: '/sample-page', name: 'page' },
  { path: '/edge-e-test', name: 'cpt-post' },
  { path: '/non-existent-' + Date.now(), name: '404' },
];

// Pull HATCH_WEBHOOK_SECRET from .env to call /api/revalidate
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
  // Bust Astro's 60s cache via revalidate webhook
  if (SECRET) {
    try { execSync(`curl -sf -H "X-Hatch-Secret: ${SECRET}" "http://localhost:4321/api/revalidate"`, { stdio: 'pipe' }); } catch {}
  }
}

test('Full theme x page sweep (with cache bust)', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const issues = [];

  for (const theme of THEMES) {
    setTheme(theme);
    await new Promise(r => setTimeout(r, 600));

    for (const p of PAGES) {
      try {
        const res = await page.goto('http://localhost:4321' + p.path, { waitUntil: 'domcontentloaded', timeout: 8000 });
        const status = res ? res.status() : 0;

        const findings = await page.evaluate((expectedTheme) => {
          const r = {};
          let dbl = 0;
          document.querySelectorAll('header, footer, main, article, section').forEach(el => {
            const cs = getComputedStyle(el);
            if (cs.borderTopWidth !== '0px' && el.firstElementChild) {
              const c = getComputedStyle(el.firstElementChild);
              if (c.borderTopWidth !== '0px' && cs.borderTopColor === c.borderTopColor) dbl++;
            }
          });
          r.doubleBorders = dbl;
          const h = document.querySelector('header > div');
          const a = document.querySelector('article, main > div[style*="max-width"]');
          r.headerMaxW = h ? getComputedStyle(h).maxWidth : null;
          r.articleMaxW = a ? getComputedStyle(a).maxWidth : null;
          // Check ONLY the primary font, not fallback chain (fallbacks
          // like `system-ui, monospace` would false-positive every theme).
          const inMono = (el) => {
            const first = (getComputedStyle(el).fontFamily || '').split(',')[0].trim().replace(/['"]/g, '');
            return /mono|menlo|consolas|courier|jetbrains/i.test(first);
          };
          r.headerMono = h ? inMono(h) : false;
          const footerEl = document.querySelector('footer');
          r.footerMono = footerEl ? inMono(footerEl) : false;
          r.themeAttr = document.documentElement.getAttribute('data-hatch-theme');
          r.themeAttrMatches = r.themeAttr === expectedTheme;
          const h1 = document.querySelector('h1');
          r.h1Text = h1 ? h1.textContent.slice(0, 50) : null;
          let brokenImg = 0;
          document.querySelectorAll('img').forEach(i => { if (i.complete && i.naturalWidth === 0) brokenImg++; });
          r.brokenImages = brokenImg;
          // Sidebar check (only if expected to have one)
          r.hasSidebar = !!document.querySelector('aside, .docs-sidebar');
          return r;
        }, theme);

        issues.push({ theme, page: p.name, status, ...findings });
      } catch (e) {
        issues.push({ theme, page: p.name, error: e.message.slice(0, 150) });
      }
    }
  }

  console.log('===SWEEP_RESULTS_BEGIN===');
  console.log(JSON.stringify(issues, null, 2));
  console.log('===SWEEP_RESULTS_END===');

  setTheme('blog');
  await browser.close();
});
