// Sample layers tree, class defs, code samples, sample chat data.

export const LAYERS = [
  { id: 'root', tag: 'section', name: 'Hero Section', expanded: true, visible: true, children: [
    { id: 'container', tag: 'div', name: 'Container', expanded: true, visible: true, children: [
      { id: 'eyebrow', tag: 'span', name: 'Eyebrow', visible: true, children: [] },
      { id: 'h1', tag: 'h1', name: 'Hero Heading', visible: true, children: [], selected: true },
      { id: 'lede',  tag: 'p',  name: 'Lede paragraph', visible: true, children: [] },
      { id: 'ctas', tag: 'div', name: 'CTA Row', expanded: true, visible: true, children: [
        { id: 'btn1', tag: 'a', name: 'Primary CTA', visible: true, children: [] },
        { id: 'btn2', tag: 'a', name: 'Secondary CTA', visible: true, children: [] },
      ] },
      { id: 'media', tag: 'div', name: 'Media Placeholder', visible: true, children: [] },
    ] },
  ]},
  { id: 'footer', tag: 'footer', name: 'Footer', visible: false, children: [] },
];

export function emptyProps() {
  return {
    typography: { fontSize: '', fontFamily: '', fontWeight: '', lineHeight: '', letterSpacing: '', textAlign: '', fontStyle: '', textTransform: '', textDecoration: '', textColor: '' },
    layout:     { display: '', position: '', top: '', right: '', bottom: '', left: '', zIndex: '', overflow: '', width: '', height: '' },
    spacing:    { padTop: '', padRight: '', padBottom: '', padLeft: '', marTop: '', marRight: '', marBottom: '', marLeft: '' },
    background: { bgColor: '', bgImage: '' },
    border:     { radius: '', width: '', style: '', color: '' },
    effects:    { opacity: '', shadow: '', blur: '' },
  };
}

export const CLASS_DEFS = {
  display: {
    ...emptyProps(),
    typography: { fontSize: '56', fontFamily: 'Inter', fontWeight: '700', lineHeight: '1.05', letterSpacing: '-0.02', textAlign: 'left', fontStyle: 'normal', textTransform: 'none', textDecoration: 'none', textColor: '#15151A' },
    spacing: { padTop: '0', padRight: '0', padBottom: '18', padLeft: '0', marTop: '0', marRight: '0', marBottom: '0', marLeft: '0' },
    layout: { display: 'block', position: 'static', top: '', right: '', bottom: '', left: '', zIndex: '', overflow: 'visible', width: '100%', height: 'auto' },
    background: { bgColor: '', bgImage: '' },
    border: { radius: '0', width: '0', style: 'none', color: '#E5E6EB' },
    effects: { opacity: '', shadow: 'none', blur: '0' },
  },
  tight: {
    ...emptyProps(),
    typography: { ...emptyProps().typography, letterSpacing: '-0.03', lineHeight: '1' },
  },
  eyebrow: {
    ...emptyProps(),
    typography: { fontSize: '13', fontFamily: 'JetBrains Mono', fontWeight: '500', lineHeight: '1.2', letterSpacing: '0.08', textAlign: 'left', fontStyle: 'normal', textTransform: 'uppercase', textDecoration: 'none', textColor: '#4B22CC' },
    spacing: { ...emptyProps().spacing, marBottom: '12' },
  },
};

export const LOCAL_OVERRIDES = emptyProps();

export const SELECTED_ELEMENT = {
  tag: 'h1',
  slot: 1,
  text: 'Compose smarter pages',
  classes: ['display', 'tight'],
};

export const CLASS_SUGGESTIONS = [
  'display', 'tight', 'eyebrow', 'lede', 'container', 'btn', 'primary',
  'secondary', 'section', 'hero', 'muted', 'highlight', 'card', 'sticky',
];

export const CODE_LINES = [
  ['<', 'tag', 'section', ' ', 'attr', 'class', '=', 'str', '"hero"', '>'],
  ['  <', 'tag', 'div', ' ', 'attr', 'class', '=', 'str', '"container"', '>'],
  ['    <', 'tag', 'span', ' ', 'attr', 'class', '=', 'str', '"eyebrow"', '>', 'txt', 'New release', '</', 'tag', 'span', '>'],
  ['    <', 'tag', 'h1', ' ', 'attr', 'class', '=', 'str', '"display"', '>', 'txt', 'Compose smarter pages', '</', 'tag', 'h1', '>', '  ', '__active'],
  ['    <', 'tag', 'p', ' ', 'attr', 'class', '=', 'str', '"lede"', '>'],
  ['      ', 'txt', 'Drag, drop, refine. UiChemy turns paste-in HTML into structured, editable widgets.'],
  ['    </', 'tag', 'p', '>'],
  ['    <', 'tag', 'div', ' ', 'attr', 'class', '=', 'str', '"ctas"', '>'],
  ['      <', 'tag', 'a', ' ', 'attr', 'class', '=', 'str', '"btn primary"', ' ', 'attr', 'href', '=', 'str', '"#"', '>', 'txt', 'Get started', '</', 'tag', 'a', '>'],
  ['      <', 'tag', 'a', ' ', 'attr', 'class', '=', 'str', '"btn secondary"', ' ', 'attr', 'href', '=', 'str', '"#"', '>', 'txt', 'Watch demo', '</', 'tag', 'a', '>'],
  ['    </', 'tag', 'div', '>'],
  ['  </', 'tag', 'div', '>'],
  ['</', 'tag', 'section', '>'],
];

export const CODE_CSS = [
  ['.hero ', '{'],
  ['  ', 'attr', 'padding', ': ', 'str', '64px 80px', ';'],
  ['  ', 'attr', 'background', ': ', 'str', '#ffffff', ';'],
  ['  ', 'attr', 'border-radius', ': ', 'str', '12px', ';'],
  ['}'],
  [''],
  ['.hero .display ', '{'],
  ['  ', 'attr', 'font-size', ': ', 'str', 'clamp(40px, 5vw, 64px)', ';'],
  ['  ', 'attr', 'line-height', ': ', 'str', '1.05', ';'],
  ['  ', 'attr', 'letter-spacing', ': ', 'str', '-0.02em', ';'],
  ['  ', 'attr', 'font-weight', ': ', 'str', '700', ';'],
  ['}'],
];

export const CODE_JS = [
  ['document.querySelectorAll(', 'str', '\'.btn\'', ').forEach((b) => {'],
  ['  b.addEventListener(', 'str', '\'click\'', ', (e) => {'],
  ['    ', 'tag', 'console', '.log(', 'str', '\'cta\'', ', b.dataset.label);'],
  ['  });'],
  ['});'],
];

export const PAGE_CSS = [
  ['/* CSS injected before this page only */'],
  ['.hero ', '{'],
  ['  ', 'attr', 'background', ': ', 'str', 'var(--page-bg, #fff)', ';'],
  ['}'],
];

export const PAGE_JS = [
  ['// JS injected before this page only'],
  ['window.UICHEMY_PAGE = { id: ', 'str', '\'hero-landing\'', ' };'],
];

export const SITE_CSS = [
  ['/* CSS applied across the entire site */'],
  [':root ', '{'],
  ['  ', 'attr', '--brand', ': ', 'str', '#4B22CC', ';'],
  ['  ', 'attr', '--surface', ': ', 'str', '#FFFFFF', ';'],
  ['  ', 'attr', '--text', ': ', 'str', '#15151A', ';'],
  ['}'],
  ['body ', '{ ', 'attr', 'font-family', ': ', 'str', '\'Inter\'', ', sans-serif; }'],
];

export const SITE_JS = [
  ['// Loaded on every page'],
  ['window.dataLayer = window.dataLayer || [];'],
  ['function gtag(){ dataLayer.push(arguments); }'],
  ['gtag(', 'str', '\'js\'', ', ', 'tag', 'new', ' Date());'],
];

export const CHATS = [
  { id: 1, title: 'Convert Tailwind cards', sub: 'Refactor 3 nested grids…', active: true },
  { id: 2, title: 'Make hero responsive',  sub: 'Stack at < 768px and…' },
  { id: 3, title: 'Audit accessibility',   sub: 'Heading order, alt text…' },
  { id: 4, title: 'Brand color sweep',     sub: 'Replace #0066ff with…' },
];

export const MESSAGES = [
  { role: 'user', who: 'You', text: 'Make the hero heading tighter. Drop line-height to 1, bump weight to 800, and pull the letter-spacing in a notch.', ref: 'h1.display' },
  { role: 'ai', who: 'Composer', text: 'Done. I tightened line-height to 1.0, set font-weight to 800, and pulled letter-spacing to -0.03em. Applied to the desktop breakpoint only, so your tablet and mobile rules are untouched. Want me to also reduce the bottom margin to keep proportions?', actions: ['Tighten bottom margin', 'Revert'] },
];
