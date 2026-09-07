// Curated 3rd-party library directory.
//
// Every entry carries a PINNED CDN url, so picking one in the Add-library
// catalog adds it as a real asset (via onPendingSelect → commitDep) instead of
// bouncing the user to a docs site to copy a URL by hand.
//
// `url` uses the `{v}` placeholder that buildAssetTagHtml substitutes from `v`,
// so the version shows in the dep row and stays editable in one place. Scripts
// resolve to a UMD/global build wherever the package still ships one; the two
// that are ESM-only (three, ogl) carry attrs:['module'] so the emitted tag is
// `<script type="module">` and actually executes.
//
// Versions here were resolved from the jsDelivr registry and every URL was
// checked to return 200. They are PINNED on purpose — an unpinned CDN URL
// silently changes what a published page loads.
//
// `kind` drives both the JS / CSS / FONT pill and the tag that gets emitted.
//
// NOTE: because the plugin now ships these endpoints rather than only accepting
// a URL the user typed, cdn.jsdelivr.net and fonts.googleapis.com are disclosed
// under "External Services" in readme.txt. Anything added here needs the same
// treatment.

const JSD = 'https://cdn.jsdelivr.net/npm';
const GF = 'https://fonts.googleapis.com/css2?family=';

export const LIBRARY_CATALOG = [
  // ── Animation (JS) ──────────────────────────────────────────────────────────
  { id: 'lenis', name: 'Lenis', category: 'Animation', kind: 'script',
    url: `${JSD}/lenis@{v}/dist/lenis.min.js`, v: '1.3.26',
    site: 'https://github.com/darkroomengineering/lenis', brief: 'Buttery-smooth scroll.' },
  { id: 'anime', name: 'Anime.js', category: 'Animation', kind: 'script',
    url: `${JSD}/animejs@{v}/dist/bundles/anime.umd.min.js`, v: '4.5.0',
    site: 'https://animejs.com/', brief: 'Lightweight JS animation engine.' },
  { id: 'lottie', name: 'Lottie', category: 'Animation', kind: 'script',
    url: `${JSD}/lottie-web@{v}/build/player/lottie.min.js`, v: '5.13.0',
    site: 'https://airbnb.io/lottie/', brief: 'Render After Effects animations as JSON.' },
  { id: 'motionone', name: 'Motion One', category: 'Animation', kind: 'script',
    url: `${JSD}/motion@{v}/dist/motion.min.js`, v: '13.1.1',
    site: 'https://motion.dev/', brief: 'Modern Web Animations API library.' },

  // ── 3D (JS) ────────────────────────────────────────────────────────────────
  // three and ogl ship ESM only — no global build exists to link, hence module.
  { id: 'three', name: 'Three.js', category: '3D', kind: 'script',
    url: `${JSD}/three@{v}/build/three.module.min.js`, v: '0.185.1',
    site: 'https://threejs.org/', brief: 'WebGL 3D engine. ES module.', attrs: ['module'] },
  { id: 'ogl', name: 'OGL', category: '3D', kind: 'script',
    url: `${JSD}/ogl@{v}/src/index.js`, v: '1.0.11',
    site: 'https://github.com/oframe/ogl', brief: 'Minimal WebGL library, ~8kb. ES module.', attrs: ['module'] },
  { id: 'p5', name: 'p5.js', category: '3D', kind: 'script',
    url: `${JSD}/p5@{v}/lib/p5.min.js`, v: '2.3.2',
    site: 'https://p5js.org/', brief: 'Creative-coding canvas + 3D.' },
  { id: 'pixi', name: 'PixiJS', category: '3D', kind: 'script',
    url: `${JSD}/pixi.js@{v}/dist/pixi.min.js`, v: '8.20.1',
    site: 'https://pixijs.com/', brief: '2D WebGL renderer.' },

  // ── UI (JS + paired CSS) ───────────────────────────────────────────────────
  // The sliders and Prism are inert/unstyled without their stylesheet, so each
  // ships as a pair the user can add together.
  { id: 'swiper', name: 'Swiper', category: 'UI', kind: 'script',
    url: `${JSD}/swiper@{v}/swiper-bundle.min.js`, v: '14.2.0',
    site: 'https://swiperjs.com/', brief: 'Touch slider. JS + CSS pair.' },
  { id: 'swiper-css', name: 'Swiper CSS', category: 'UI', kind: 'style',
    url: `${JSD}/swiper@{v}/swiper-bundle.min.css`, v: '14.2.0',
    site: 'https://swiperjs.com/', brief: 'Swiper stylesheet.' },
  { id: 'splide', name: 'Splide', category: 'UI', kind: 'script',
    url: `${JSD}/@splidejs/splide@{v}/dist/js/splide.min.js`, v: '4.1.4',
    site: 'https://splidejs.com/', brief: 'Accessible slider/carousel. JS + CSS pair.' },
  { id: 'splide-css', name: 'Splide CSS', category: 'UI', kind: 'style',
    url: `${JSD}/@splidejs/splide@{v}/dist/css/splide.min.css`, v: '4.1.4',
    site: 'https://splidejs.com/', brief: 'Splide stylesheet.' },
  { id: 'aos', name: 'AOS', category: 'UI', kind: 'script',
    url: `${JSD}/aos@{v}/dist/aos.js`, v: '2.3.4',
    site: 'https://github.com/michalsnik/aos', brief: 'Animate-on-scroll attrs. JS + CSS pair.' },
  { id: 'aos-css', name: 'AOS CSS', category: 'UI', kind: 'style',
    url: `${JSD}/aos@{v}/dist/aos.css`, v: '2.3.4',
    site: 'https://github.com/michalsnik/aos', brief: 'AOS stylesheet.' },
  { id: 'tippy', name: 'Tippy.js', category: 'UI', kind: 'script',
    url: `${JSD}/tippy.js@{v}/dist/tippy-bundle.umd.min.js`, v: '6.3.7',
    site: 'https://atomiks.github.io/tippyjs/', brief: 'Tooltips & popovers. Bundle includes CSS.' },

  // ── Utility (JS) ───────────────────────────────────────────────────────────
  { id: 'alpine', name: 'Alpine.js', category: 'Utility', kind: 'script',
    url: `${JSD}/alpinejs@{v}/dist/cdn.min.js`, v: '3.16.3',
    site: 'https://alpinejs.dev/', brief: 'Tiny reactive framework.', attrs: ['defer'] },
  { id: 'htmx', name: 'htmx', category: 'Utility', kind: 'script',
    url: `${JSD}/htmx.org@{v}/dist/htmx.min.js`, v: '2.0.10',
    site: 'https://htmx.org/', brief: 'HTML-first interactivity.' },
  { id: 'dayjs', name: 'Day.js', category: 'Utility', kind: 'script',
    url: `${JSD}/dayjs@{v}/dayjs.min.js`, v: '1.11.23',
    site: 'https://day.js.org/', brief: '2kb date library.' },
  { id: 'marked', name: 'Marked', category: 'Utility', kind: 'script',
    url: `${JSD}/marked@{v}/lib/marked.umd.min.js`, v: '18.0.11',
    site: 'https://marked.js.org/', brief: 'Markdown parser.' },
  { id: 'prism', name: 'Prism', category: 'Utility', kind: 'script',
    url: `${JSD}/prismjs@{v}/prism.min.js`, v: '1.30.0',
    site: 'https://prismjs.com/', brief: 'Syntax highlighting. JS + CSS pair.' },
  { id: 'prism-css', name: 'Prism CSS', category: 'Utility', kind: 'style',
    url: `${JSD}/prismjs@{v}/themes/prism.min.css`, v: '1.30.0',
    site: 'https://prismjs.com/', brief: 'Prism default theme.' },

  // ── CSS-only libraries ─────────────────────────────────────────────────────
  { id: 'animate-css', name: 'Animate.css', category: 'CSS', kind: 'style',
    url: `${JSD}/animate.css@{v}/animate.min.css`, v: '4.1.1',
    site: 'https://animate.style/', brief: 'Ready-to-use cross-browser CSS animations.' },
  { id: 'hover-css', name: 'Hover.css', category: 'CSS', kind: 'style',
    url: `${JSD}/hover.css@{v}/css/hover-min.css`, v: '2.3.2',
    site: 'https://ianlunn.github.io/Hover/', brief: 'CSS hover effects (buttons, icons, links).' },
  { id: 'bootstrap-css', name: 'Bootstrap CSS', category: 'CSS', kind: 'style',
    url: `${JSD}/bootstrap@{v}/dist/css/bootstrap.min.css`, v: '5.3.8',
    site: 'https://getbootstrap.com/', brief: 'Bootstrap grid + components stylesheet.' },
  { id: 'normalize-css', name: 'normalize.css', category: 'CSS', kind: 'style',
    url: `${JSD}/normalize.css@{v}/normalize.css`, v: '8.0.1',
    site: 'https://necolas.github.io/normalize.css/', brief: 'Cross-browser CSS reset.' },
  { id: 'modern-normalize', name: 'modern-normalize', category: 'CSS', kind: 'style',
    url: `${JSD}/modern-normalize@{v}/modern-normalize.css`, v: '3.0.1',
    site: 'https://github.com/sindresorhus/modern-normalize', brief: 'Modern CSS reset (post-IE).' },
  { id: 'pico-css', name: 'Pico.css', category: 'CSS', kind: 'style',
    url: `${JSD}/@picocss/pico@{v}/css/pico.min.css`, v: '2.1.1',
    site: 'https://picocss.com/', brief: 'Minimal classless CSS framework.' },
  { id: 'mvp-css', name: 'MVP.css', category: 'CSS', kind: 'style',
    url: `${JSD}/mvp.css@{v}/mvp.css`, v: '1.17.3',
    site: 'https://andybrewer.github.io/mvp/', brief: 'Classless stylesheet for HTML prototypes.' },
  { id: 'water-css', name: 'Water.css', category: 'CSS', kind: 'style',
    url: `${JSD}/water.css@{v}/out/water.css`, v: '2.1.1',
    site: 'https://watercss.kognise.dev/', brief: 'Just-add-water classless CSS.' },
  { id: 'fontawesome', name: 'Font Awesome', category: 'CSS', kind: 'style',
    url: `${JSD}/@fortawesome/fontawesome-free@{v}/css/all.min.css`, v: '7.3.1',
    site: 'https://fontawesome.com/', brief: 'Icon library with thousands of vector icons.' },

  // ── Fonts ──────────────────────────────────────────────────────────────────
  // Google Fonts CSS2 URLs. Unversioned by design — the endpoint has no version,
  // hence v: '–', which buildAssetTagHtml reads as "no {v} to substitute".
  { id: 'gf-inter', name: 'Inter', category: 'Fonts', kind: 'font',
    url: `${GF}Inter:wght@100..900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Inter', brief: 'Neutral UI sans-serif. Variable weights 100–900.' },
  { id: 'gf-roboto', name: 'Roboto', category: 'Fonts', kind: 'font',
    url: `${GF}Roboto:wght@100..900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Roboto', brief: "Google's flagship sans-serif." },
  { id: 'gf-poppins', name: 'Poppins', category: 'Fonts', kind: 'font',
    url: `${GF}Poppins:wght@300;400;500;600;700&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Poppins', brief: 'Geometric sans, popular for landing pages.' },
  { id: 'gf-manrope', name: 'Manrope', category: 'Fonts', kind: 'font',
    url: `${GF}Manrope:wght@200..800&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Manrope', brief: 'Modern variable sans. Weights 200–800.' },
  { id: 'gf-plus-jakarta', name: 'Plus Jakarta Sans', category: 'Fonts', kind: 'font',
    url: `${GF}Plus+Jakarta+Sans:wght@200..800&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Plus+Jakarta+Sans', brief: 'Friendly variable sans, great for SaaS.' },
  { id: 'gf-dm-sans', name: 'DM Sans', category: 'Fonts', kind: 'font',
    url: `${GF}DM+Sans:wght@100..1000&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/DM+Sans', brief: 'Low-contrast geometric sans.' },
  { id: 'gf-outfit', name: 'Outfit', category: 'Fonts', kind: 'font',
    url: `${GF}Outfit:wght@100..900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Outfit', brief: 'Display-friendly variable sans.' },
  { id: 'gf-open-sans', name: 'Open Sans', category: 'Fonts', kind: 'font',
    url: `${GF}Open+Sans:wght@300..800&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Open+Sans', brief: 'Optimised for legibility.' },
  { id: 'gf-lato', name: 'Lato', category: 'Fonts', kind: 'font',
    url: `${GF}Lato:wght@100;300;400;700;900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Lato', brief: 'Warm-but-neutral humanist sans.' },
  { id: 'gf-montserrat', name: 'Montserrat', category: 'Fonts', kind: 'font',
    url: `${GF}Montserrat:wght@100..900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Montserrat', brief: 'Geometric sans inspired by urban signage.' },
  { id: 'gf-nunito', name: 'Nunito', category: 'Fonts', kind: 'font',
    url: `${GF}Nunito:wght@200..1000&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Nunito', brief: 'Rounded sans, friendly tone.' },
  { id: 'gf-raleway', name: 'Raleway', category: 'Fonts', kind: 'font',
    url: `${GF}Raleway:wght@100..900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Raleway', brief: 'Elegant display sans.' },
  { id: 'gf-work-sans', name: 'Work Sans', category: 'Fonts', kind: 'font',
    url: `${GF}Work+Sans:wght@100..900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Work+Sans', brief: 'Optimised for body + UI.' },
  { id: 'gf-playfair', name: 'Playfair Display', category: 'Fonts', kind: 'font',
    url: `${GF}Playfair+Display:wght@400..900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Playfair+Display', brief: 'High-contrast serif. Editorial headlines.' },
  { id: 'gf-merriweather', name: 'Merriweather', category: 'Fonts', kind: 'font',
    url: `${GF}Merriweather:wght@300;400;700;900&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Merriweather', brief: 'Readable serif for long-form copy.' },
  { id: 'gf-lora', name: 'Lora', category: 'Fonts', kind: 'font',
    url: `${GF}Lora:wght@400..700&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Lora', brief: 'Well-balanced contemporary serif.' },
  { id: 'gf-jetbrains-mono', name: 'JetBrains Mono', category: 'Fonts', kind: 'font',
    url: `${GF}JetBrains+Mono:wght@100..800&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/JetBrains+Mono', brief: 'Coding monospace with ligatures.' },
  { id: 'gf-fira-code', name: 'Fira Code', category: 'Fonts', kind: 'font',
    url: `${GF}Fira+Code:wght@300..700&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Fira+Code', brief: 'Monospace with programming ligatures.' },
  { id: 'gf-caveat', name: 'Caveat', category: 'Fonts', kind: 'font',
    url: `${GF}Caveat:wght@400..700&display=swap`, v: '–',
    site: 'https://fonts.google.com/specimen/Caveat', brief: 'Casual handwriting display face.' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * True if a dep/catalog entry represents a font. Catalog entries carry
 * category: 'Fonts'; real deps added via the Custom URL tab are detected by
 * their font-host URL. Used to render a distinct "FONT" pill.
 */
export function isFontDep(dep) {
  if (!dep) return false;
  if (dep.category === 'Fonts' || dep.kind === 'font') return true;
  const url = String(dep.url || dep.site || '').toLowerCase();
  return url.includes('fonts.googleapis.com') || url.includes('fonts.bunny.net');
}

/**
 * Pill metadata for a dep/catalog entry, used by the dep row and the catalog
 * directory to pick the right visual treatment (label + CSS class).
 */
export function depKindPill(dep) {
  if (isFontDep(dep)) {
    return { label: 'FONT', cls: 'font', title: 'Font (stylesheet)' };
  }
  if (dep && dep.kind === 'script') {
    return { label: 'JS', cls: 'script', title: 'JavaScript' };
  }
  return { label: 'CSS', cls: 'style', title: 'Stylesheet' };
}
