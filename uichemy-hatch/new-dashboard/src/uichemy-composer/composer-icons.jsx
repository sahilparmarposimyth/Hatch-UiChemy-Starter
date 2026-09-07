import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  MinusSignIcon,
  AiMagicIcon,
  AlignVerticalDistributeCenterIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  Attachment01Icon,
  BorderAll01Icon,
  Cancel01Icon,
  Chat01Icon,
  ClipboardIcon,
  ColorPickerIcon,
  ComputerIcon,
  Copy01Icon,
  Copy02Icon,
  Cursor01Icon,
  CursorMagicSelection02Icon,
  Delete02Icon,
  Edit02Icon,
  FlashIcon,
  FormIcon,
  HistoryIcon,
  Image01Icon,
  Layers01Icon,
  Layout01Icon,
  Link01Icon,
  Moon02Icon,
  Move01Icon,
  More01Icon,
  More02Icon,
  PaintBoardIcon,
  ParagraphIcon,
  Scissor01Icon,
  Search01Icon,
  SentIcon,
  SidebarBottomIcon,
  SidebarRightIcon,
  SmartPhone01Icon,
  SourceCodeIcon,
  SourceCodeSquareIcon,
  SparklesIcon,
  SquareIcon,
  SquareLock01Icon,
  Sun03Icon,
  Tablet01Icon,
  Target02Icon,
  TextAlignCenterIcon,
  TextAlignJustifyCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextFontIcon,
  TextIcon,
  Tick02Icon,
  Upload03Icon,
  Download03Icon,
  ViewIcon,
  ViewOffIcon,
  RectangularIcon,
  RepeatIcon,
  SquareRoundCornerIcon,
  BorderInnerIcon,
  AngleIcon,
  RotateLeft01Icon,
  RotateRight01Icon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  Unlink01Icon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  QuoteDownIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  TextIndentIcon,
  TextIndentLessIcon,
  TextClearIcon,
  ALargeSmallIcon,
  Bookmark02Icon,
  HierarchyIcon,
  Menu02Icon,
  Note01Icon,
  StarSquareIcon,
  AlignBoxBottomCenterIcon,
  AlignBoxMiddleCenterIcon,
  AlignBoxTopCenterIcon,
  ArtboardIcon,
  Book02Icon,
  BrowserIcon,
  CellsIcon,
  CheckListIcon,
  CheckmarkSquare01Icon,
  Clock01Icon,
  ClosedCaptionAltIcon,
  ClosedCaptionIcon,
  CursorTextIcon,
  DropdownFieldTypeIcon,
  GaugeIcon,
  GroupItemsIcon,
  Heading01Icon,
  Heading02Icon,
  Heading03Icon,
  Heading04Icon,
  Heading05Icon,
  Heading06Icon,
  HighlighterIcon,
  Image02Icon,
  ImageCompositionIcon,
  KeyboardIcon,
  LabelIcon,
  LayoutBottomIcon,
  LayoutTable01Icon,
  LayoutTopIcon,
  ListViewIcon,
  Location01Icon,
  Menu01Icon,
  MusicNote01Icon,
  News01Icon,
  Progress01Icon,
  SectionIcon,
  SidebarLeftIcon,
  SquareArrowDown01Icon,
  Table01Icon,
  TableColumnsSplitIcon,
  TableRowsSplitIcon,
  Tag01Icon,
  TextSmallcapsIcon,
  TextSubscriptIcon,
  TextSuperscriptIcon,
  TextUnderlineIcon,
  TextWrapIcon,
  VectorSquareIcon,
  Video01Icon,
} from '@hugeicons/core-free-icons';

// Icon set, HugeIcons free (Stroke Rounded), wrapped to preserve the
// legacy `I.*` API: every icon is a component taking { size, sw } props.
//
// Stroke scales with size on the 24-unit Hugeicons canvas, so a flat stroke at
// 12–14px thins to <1px and reads lighter than the UI text beside it. When `sw`
// isn't given we hold a constant ~UC_ICON_STROKE px physical stroke
// (strokeWidth = stroke × 24 / size), matching the dashboard rule in
// components/icons.jsx. An explicit `sw` still wins.
const UC_ICON_STROKE = 1.25;
// Size-aware stroke: constant ~UC_ICON_STROKE px physical weight at any render
// size on the 24-unit canvas. Used by make() and the bespoke SVGs below, which
// are all drawn on the same viewBox="0 0 24 24".
const strokeFor = (size) => +((UC_ICON_STROKE * 24) / size).toFixed(2);
const make = (icon) => {
  const Cmp = ({ size = 14, sw, fill, ...p }) => (
    <HugeiconsIcon icon={icon} size={size} strokeWidth={sw ?? strokeFor(size)} {...p} />
  );
  return Cmp;
};

// Custom "global" icon (world/meridian), used everywhere a value can resolve
// to a UiChemy global. Same { size, sw } interface as make() so it drops into
// the `I` map. Strokes inherit `currentColor` from the host button.
const GlobeWorld = ({ size = 14, sw, fill = 'none', ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw ?? strokeFor(size)}
    {...p}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12C8 18 12 22 12 22C12 22 16 18 16 12C16 6 12 2 12 2C12 2 8 6 8 12Z" strokeLinejoin="round" />
    <path d="M21 15H3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M21 9H3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Custom paper-plane "send" icon, used for the Chat prompt's icon-only Send
// button in the Gutenberg panel. Same { size, sw } interface as make() so it
// drops into the `I` map. Kept alongside the existing `send` icon rather than
// replacing it, so Elementor and Bricks keep the glyph they ship with today.
const SendPlane = ({ size = 14, sw, fill = 'none', ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw ?? strokeFor(size)}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M10.325 5.33455L16.1084 8.24495C19.3643 9.88342 20.9922 10.7027 20.9922 12C20.9922 13.2973 19.3643 14.1166 16.1084 15.7551L10.325 18.6655C6.63532 20.5223 4.79046 21.4507 3.7862 20.7851C3.57349 20.6441 3.38825 20.4651 3.23962 20.2569C2.53788 19.2741 3.3843 17.381 5.07715 13.5948C5.39957 12.8736 5.56078 12.5131 5.58462 12.1319C5.59011 12.044 5.59011 11.956 5.58462 11.8681C5.56078 11.4869 5.39957 11.1264 5.07715 10.4052C3.3843 6.61898 2.53788 4.72586 3.23962 3.74307C3.38825 3.53492 3.57349 3.35593 3.7862 3.21495C4.79046 2.54933 6.63532 3.47774 10.325 5.33455Z" />
    <path d="M9.49219 12H13.4922" />
  </svg>
);

// Custom paint-palette icon, used for the "Design" (visual editing) button.
// Same { size, sw } interface as make() so it drops into the `I` map.
const PalettePaint = ({ size = 14, sw, fill = 'none', ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw ?? strokeFor(size)}
    {...p}
  >
    <path d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C12.8417 22 14 22.1163 14 21C14 20.391 13.6832 19.9212 13.3686 19.4544C12.9082 18.7715 12.4523 18.0953 13 17C13.6667 15.6667 14.7778 15.6667 16.4815 15.6667C17.3334 15.6667 18.3334 15.6667 19.5 15.5C21.601 15.1999 22 13.9084 22 12Z" />
    <circle cx="9.5" cy="8.5" r="1.5" />
    <circle cx="16.5" cy="9.5" r="1.5" />
    <path d="M7.125 15H7M7.25 15C7.25 15.1381 7.13807 15.25 7 15.25C6.86193 15.25 6.75 15.1381 6.75 15C6.75 14.8619 6.86193 14.75 7 14.75C7.13807 14.75 7.25 14.8619 7.25 15Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Custom browser-window icon, used for the "Site" code scope (injected on
// every page). Same { size, sw } interface as make() so it drops into `I`.
const SiteWindow = ({ size = 14, sw, fill = 'none', ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw ?? strokeFor(size)}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M3 12C3 7.75736 3 5.63604 4.31802 4.31802C5.63604 3 7.75736 3 12 3C16.2426 3 18.364 3 19.682 4.31802C21 5.63604 21 7.75736 21 12C21 16.2426 21 18.364 19.682 19.682C18.364 21 16.2426 21 12 21C7.75736 21 5.63604 21 4.31802 19.682C3 18.364 3 16.2426 3 12Z" />
    <path d="M3 9H21" />
  </svg>
);

// Custom database icon, used for the "Insert dynamic value" binding button
// (dynamic data comes from the database / query). Same { size, sw } interface
// as make() so it drops into the `I` map; strokes inherit `currentColor`.
const DatabaseDynamic = ({ size = 14, sw, fill = 'none', ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw ?? strokeFor(size)}
    {...p}
  >
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M7 10.842C7.60158 11.0229 8.27434 11.1718 9 11.282" strokeLinecap="round" />
    <path d="M20 12C20 13.6569 16.4183 15 12 15C7.58172 15 4 13.6569 4 12" />
    <path d="M7 17.842C7.60158 18.0229 8.27434 18.1718 9 18.282" strokeLinecap="round" />
    <path d="M20 5V19C20 20.6569 16.4183 22 12 22C7.58172 22 4 20.6569 4 19V5" />
  </svg>
);

// Custom "variable" icon (linked molecules), marks the editable CSS-variable
// id column in the Globals studio. Same { size, sw } interface as make() so it
// drops into the `I` map; strokes inherit `currentColor` from the host.
const VariableMolecule = ({ size = 14, sw, fill = 'none', ...p }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw ?? strokeFor(size)}
    strokeLinecap="round"
    {...p}
  >
    <path d="M17.5798 9.71016C17.0765 9.57314 16.5468 9.5 16 9.5C13.4668 9.5 11.3002 11.0699 10.4202 13.2898M17.5798 9.71016C20.1271 10.4036 22 12.7331 22 15.5C22 18.8137 19.3137 21.5 16 21.5C14.4633 21.5 13.0615 20.9223 12 19.9722M17.5798 9.71016C17.851 9.02618 18 8.2805 18 7.5C18 4.18629 15.3137 1.5 12 1.5C8.68629 1.5 6 4.18629 6 7.5C6 8.2805 6.14903 9.02618 6.42018 9.71016M10.4202 13.2898C10.149 13.9738 10 14.7195 10 15.5C10 17.277 10.7725 18.8736 12 19.9722M10.4202 13.2898C8.59146 12.792 7.11029 11.451 6.42018 9.71016M6.42018 9.71016C3.87294 10.4036 2 12.7331 2 15.5C2 18.8137 4.68629 21.5 8 21.5C9.53671 21.5 10.9385 20.9223 12 19.9722" />
  </svg>
);

export const I = {
  caretDown: make(ArrowDown01Icon),
  caretLeft: make(ArrowLeft01Icon),
  caretRight: make(ArrowRight01Icon),
  caretUp: make(ArrowUp01Icon),
  chevron: make(ArrowDown01Icon),
  search: make(Search01Icon),
  plus: make(Add01Icon),
  minus: make(MinusSignIcon),
  x: make(Cancel01Icon),
  eye: make(ViewIcon),
  eyeOff: make(ViewOffIcon),
  lock: make(SquareLock01Icon),
  link: make(Link01Icon),
  code: make(SourceCodeIcon),
  pencil: make(Edit02Icon),
  chat: make(Chat01Icon),
  sparkles: make(SparklesIcon),
  bolt: make(FlashIcon),
  layers: make(Layers01Icon),
  text: make(TextIcon),
  box: make(SquareIcon),
  paragraph: make(ParagraphIcon),
  image: make(Image01Icon),
  pageCode: make(SourceCodeSquareIcon),
  btn: make(RectangularIcon),
  type: make(TextFontIcon),
  layout: make(Layout01Icon),
  spacing: make(AlignVerticalDistributeCenterIcon),
  effect: make(AiMagicIcon),
  paint: make(PaintBoardIcon),
  design: PalettePaint,
  border: make(BorderAll01Icon),
  alignL: make(TextAlignLeftIcon),
  alignC: make(TextAlignCenterIcon),
  alignR: make(TextAlignRightIcon),
  alignJ: make(TextAlignJustifyCenterIcon),
  send: make(SentIcon),
  attach: make(Attachment01Icon),
  copy: make(Copy01Icon),
  duplicate: make(Copy02Icon),
  scissors: make(Scissor01Icon),
  clipboard: make(ClipboardIcon),
  trash: make(Delete02Icon),
  crosshair: make(Target02Icon),
  check: make(Tick02Icon),
  reset: make(ArrowTurnBackwardIcon),
  desktop: make(ComputerIcon),
  tablet: make(Tablet01Icon),
  mobile: make(SmartPhone01Icon),
  selectArea: make(CursorMagicSelection02Icon),
  more: make(More01Icon),
  moreVertical: make(More02Icon),
  history: make(HistoryIcon),
  globe: GlobeWorld,
  sendPlane: SendPlane,
  site: SiteWindow,
  pipette: make(ColorPickerIcon),
  cursor: make(Cursor01Icon),
  upload: make(Upload03Icon),
  download: make(Download03Icon),
  sun: make(Sun03Icon),
  moon: make(Moon02Icon),
  dockRight: make(SidebarRightIcon),
  dockBottom: make(SidebarBottomIcon),
  move: make(Move01Icon),
  dynamic: DatabaseDynamic,
  loop: make(RepeatIcon),
  form: make(FormIcon),
  variable: VariableMolecule,
  // Inspector field glyphs. `radius` is SquareRoundCorner, NOT the free set's
  // RadiusIcon — that one is a geometric radius (circle + arrow), wrong concept.
  radius: make(SquareRoundCornerIcon),
  padding: make(BorderInnerIcon),
  angle: make(AngleIcon),
  rotateCcw: make(RotateLeft01Icon),
  rotateCw: make(RotateRight01Icon),
  flipH: make(FlipHorizontalIcon),
  flipV: make(FlipVerticalIcon),
  unlink: make(Unlink01Icon),
  // Rich-text formatting glyphs for the canvas text toolbar.
  bold: make(TextBoldIcon),
  italic: make(TextItalicIcon),
  strike: make(TextStrikethroughIcon),
  quote: make(QuoteDownIcon),
  listBullet: make(LeftToRightListBulletIcon),
  listNumber: make(LeftToRightListNumberIcon),
  indentMore: make(TextIndentIcon),
  indentLess: make(TextIndentLessIcon),
  clearFormat: make(TextClearIcon),

  htmlLogo: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" {...p}>
      <path fill="#E44D26" d="M3 2l1.8 19.4L12 23l7.3-1.6L21 2H3z" />
      <path fill="#F16529" d="M12 4v17.5l5.7-1.3 1.5-15.7H12z" />
      <path fill="#EBEBEB" d="M7.4 8.5h4.6V6.6H5.6l.5 6.4h5.9v-1.9H7.7l-.3-2.6z" />
      <path fill="#fff" d="M12 11.1v1.9h3.7l-.4 3.9-3.3.9v2l5.2-1.5.7-7.2H12z" />
      <path fill="#EBEBEB" d="M12 19.8v-2L8.7 16.9l-.2-2.5H6.6l.4 4 5 1.4z" />
      <path fill="#fff" d="M12 8.5v1.9h6.4l.2-1.9H12z" />
    </svg>
  ),
  cssLogo: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" {...p}>
      <path fill="#1572B6" d="M3 2l1.8 19.4L12 23l7.3-1.6L21 2H3z" />
      <path fill="#33A9DC" d="M12 4v17.5l5.7-1.3 1.5-15.7H12z" />
      <path fill="#fff" d="M12 11.1H8.5l-.2-2.6h3.7V6.6H6.2l.5 6.4H12v-1.9z" />
      <path fill="#EBEBEB" d="M12 16l-3.3-.9-.2-2.4H6.6l.4 4 5 1.4v-2.1z" />
      <path fill="#fff" d="M12 11.1v1.9h2.9l-.3 3-2.6.8v2l5.1-1.4.7-8.3H12z" />
      <path fill="#EBEBEB" d="M12 6.6v1.9h5.9l.1-1.9H12z" />
    </svg>
  ),
  jsLogo: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" {...p}>
      <rect width="24" height="24" rx="3" fill="#F7DF1E" />
      <text x="13" y="18" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fontWeight="700" fill="#020202">JS</text>
    </svg>
  ),
  // Elementor brand mark (rounded square, one tall bar + two short bars).
  elementor: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" {...p}>
      <rect width="24" height="24" rx="4" fill="#92003B" />
      <rect x="7" y="6.5" width="2.4" height="11" rx="0.4" fill="#fff" />
      <rect x="11.6" y="6.5" width="5.4" height="2.4" rx="0.4" fill="#fff" />
      <rect x="11.6" y="10.8" width="5.4" height="2.4" rx="0.4" fill="#fff" />
      <rect x="11.6" y="15.1" width="5.4" height="2.4" rx="0.4" fill="#fff" />
    </svg>
  ),
};

// ── Per-tag icons ─────────────────────────────────────────────────────────────
// One glyph per HTML tag, for the Add Layer picker and the layer tree. The old
// `tagIcon()` knew ~15 tags and returned a plain square for the other ~55, so
// div / section / header / footer / main / aside / nav all drew the SAME box and
// the picker read as a wall of identical squares.
//
// The mapping follows three rules, in order:
//   1. A real object icon when the element IS one — image, video, link, table.
//   2. A layout-shape icon for containers, drawing WHERE the element sits on the
//      page: `header` a band at the top, `footer` at the bottom, `aside` down the
//      side, `main` a filled centre block. You read the layout, not the tag name.
//   3. A typographic icon for the text long tail, where no honest object exists —
//      h1..h6 get their own numbered marks, sub/sup/u/s get the letterform.
//
// Deliberately NOT colour-coded: composer chrome stays monochrome (see the
// panel/toolbar/dock palette rule), so the tile behind these keeps `bg-muted`
// and only the glyph carries the meaning.
export const TAG_ICON = {
  // Containers — layout shapes.
  div: make(SquareIcon),
  section: make(SectionIcon),
  article: make(News01Icon),
  header: make(LayoutTopIcon),
  footer: make(LayoutBottomIcon),
  main: make(AlignBoxMiddleCenterIcon),
  nav: make(Menu01Icon),
  aside: make(SidebarLeftIcon),
  figure: make(Image02Icon),
  figcaption: make(ClosedCaptionIcon),
  address: make(Location01Icon),

  // Headings and text.
  h1: make(Heading01Icon),
  h2: make(Heading02Icon),
  h3: make(Heading03Icon),
  h4: make(Heading04Icon),
  h5: make(Heading05Icon),
  h6: make(Heading06Icon),
  p: make(ParagraphIcon),
  blockquote: make(QuoteDownIcon),
  pre: make(SourceCodeSquareIcon),
  hr: make(MinusSignIcon),
  br: make(ArrowTurnBackwardIcon),

  // Inline — the letterform is the icon.
  span: make(TextIcon),
  strong: make(TextBoldIcon),
  em: make(TextItalicIcon),
  mark: make(HighlighterIcon),
  small: make(ALargeSmallIcon),
  s: make(TextStrikethroughIcon),
  u: make(TextUnderlineIcon),
  code: make(SourceCodeIcon),
  kbd: make(KeyboardIcon),
  sub: make(TextSubscriptIcon),
  sup: make(TextSuperscriptIcon),
  abbr: make(TextSmallcapsIcon),
  cite: make(Book02Icon),
  time: make(Clock01Icon),

  // Interactive.
  a: make(Link01Icon),
  button: make(RectangularIcon),
  details: make(SquareArrowDown01Icon),
  summary: make(LabelIcon),

  // Media.
  img: make(Image01Icon),
  video: make(Video01Icon),
  audio: make(MusicNote01Icon),
  picture: make(ImageCompositionIcon),
  source: make(Attachment01Icon),
  iframe: make(BrowserIcon),
  canvas: make(ArtboardIcon),
  svg: make(VectorSquareIcon),

  // Lists.
  ul: make(LeftToRightListBulletIcon),
  ol: make(LeftToRightListNumberIcon),
  li: make(ListViewIcon),
  dl: make(CheckListIcon),
  dt: make(LabelIcon),
  dd: make(TextIndentIcon),

  // Forms.
  form: make(FormIcon),
  label: make(Tag01Icon),
  input: make(CursorTextIcon),
  textarea: make(TextWrapIcon),
  select: make(DropdownFieldTypeIcon),
  option: make(CheckmarkSquare01Icon),
  fieldset: make(GroupItemsIcon),
  legend: make(LabelIcon),
  progress: make(Progress01Icon),
  meter: make(GaugeIcon),

  // Table — the cell or band the tag occupies.
  table: make(Table01Icon),
  thead: make(AlignBoxTopCenterIcon),
  tbody: make(LayoutTable01Icon),
  tfoot: make(AlignBoxBottomCenterIcon),
  tr: make(TableRowsSplitIcon),
  th: make(TableColumnsSplitIcon),
  td: make(CellsIcon),
  caption: make(ClosedCaptionAltIcon),

  // Dynamic (UiChemy) — these five used to share one `dynamic` glyph, so a logo
  // was indistinguishable from a favicon. They get their own marks; the mono tag
  // name beside them (`uichemy-…`) is what still reads as dynamic.
  'uichemy-nav-menu': make(Menu02Icon),
  'uichemy-toc': make(HierarchyIcon),
  'uichemy-post-content': make(Note01Icon),
  'uichemy-site-logo': make(StarSquareIcon),
  // Not SiteWindow: at 12px it is indistinguishable from <iframe>'s browser
  // glyph. A favicon is what sits beside a bookmark, so use that instead.
  'uichemy-site-icon': make(Bookmark02Icon),
};
