import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  Alert01Icon,
  Alert02Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Book02Icon,
  BotIcon,
  BubbleChatIcon,
  Cancel01Icon,
  ClaudeIcon,
  CloudOffIcon,
  Copy01Icon,
  Crown03Icon,
  Cursor01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  DiscordIcon,
  Download04Icon,
  Edit02Icon,
  ExchangeIcon,
  Facebook01Icon,
  FigmaIcon,
  GaugeIcon,
  HelpCircleIcon,
  Home01Icon,
  InboxIcon,
  InformationCircleIcon,
  Key01Icon,
  Archive02Icon,
  File01Icon,
  LayoutBottomIcon,
  LayoutTopIcon,
  Search01Icon,
  Store01Icon,
  LayoutTable01Icon,
  LicenseIcon,
  Link01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  Logout03Icon,
  MagicWand01Icon,
  MinusSignIcon,
  More01Icon,
  MoreVerticalIcon,
  PhpIcon,
  PlayIcon,
  PlugSocketIcon,
  PowerIcon,
  PowerOffIcon,
  PreferenceHorizontalIcon,
  PuzzleIcon,
  RefreshIcon,
  ServerStack01Icon,
  Settings01Icon,
  Shield01Icon,
  SidebarLeft01Icon,
  SourceCodeSquareIcon,
  SparklesIcon,
  SquareLock01Icon,
  Tag01Icon,
  Tick02Icon,
  User03Icon,
  UserGroupIcon,
  UserShield01Icon,
  VideoReplayIcon,
  ViewIcon,
  ViewOffIcon,
  WordpressIcon,
} from '@hugeicons/core-free-icons';

/**
 * Adapter: every generic UI glyph renders a Hugeicons free "stroke-rounded"
 * icon (@hugeicons/core-free-icons). Keeps our (size, ...props) API and
 * currentColor inheritance, so all <Icon.Name size=…/> call sites are unchanged.
 * Only the app/brand marks with no Hugeicons equivalent (Figma color mark,
 * Elementor / Bricks / Gutenberg app tiles, UiChemy Logo, SuccessArt) stay
 * hand-authored below.
 */
/* Stroke icons scale their stroke with render size (Hugeicons draw on a 24-unit
   canvas), so a 1.5 stroke at 12–14px thins to <1px and reads lighter than the
   500-weight label beside it. We instead hold a constant *physical* stroke
   (~UC_ICON_STROKE px) by scaling strokeWidth = stroke × 24 / size, so a 12px
   and a 20px glyph carry the same weight and both sit right against UI text.
   An explicit strokeWidth prop still wins. */
const UC_ICON_STROKE = 1.25;
const mk = (icon) => ({ size = 16, strokeWidth, ...p }) => (
  <HugeiconsIcon
    icon={icon}
    size={size}
    strokeWidth={strokeWidth ?? +(UC_ICON_STROKE * 24 / size).toFixed(2)}
    {...p}
  />
);

export const Plug = mk(PlugSocketIcon);
export const Key = mk(Key01Icon);
export const Link = mk(Link01Icon);
export const Grid = mk(DashboardSquare01Icon);
export const Sparkles = mk(SparklesIcon);
export const Bot = mk(BotIcon);
export const Terminal = mk(SourceCodeSquareIcon);
export const AutoConnect = mk(ArrowDataTransferHorizontalIcon);
export const Book = mk(Book02Icon);
export const Video = mk(VideoReplayIcon);
export const Chat = mk(BubbleChatIcon);
export const Help = mk(HelpCircleIcon);
export const Info = mk(InformationCircleIcon);
export const Gear = mk(Settings01Icon);
export const Warn = mk(Alert02Icon);
export const Lock = mk(SquareLock01Icon);
export const ChevR = mk(ArrowRight01Icon);
export const ChevL = mk(ArrowLeft01Icon);
export const ChevD = mk(ArrowDown01Icon);
export const PanelLeft = mk(SidebarLeft01Icon);
export const ChevU = mk(ArrowUp01Icon);
export const Play = mk(PlayIcon);
export const Copy = mk(Copy01Icon);
export const Check = mk(Tick02Icon);
export const Bang = mk(Alert01Icon);
export const InfoBare = mk(InformationCircleIcon);
export const Swap = mk(ExchangeIcon);
export const Layout = mk(LayoutTable01Icon);
/* Theme-Builder template-type marks: a distinct glyph per template type so the
   gallery cards read at a glance (header vs footer were previously identical). */
export const LayoutTop = mk(LayoutTopIcon);
export const LayoutBottom = mk(LayoutBottomIcon);
export const FileDoc = mk(File01Icon);
export const Archive = mk(Archive02Icon);
export const Store = mk(Store01Icon);
export const Search = mk(Search01Icon);
export const Eye = mk(ViewIcon);
export const EyeOff = mk(ViewOffIcon);
export const More = mk(More01Icon);
export const MoreVertical = mk(MoreVerticalIcon);   // kebab, 3 vertical dots
export const Plus = mk(Add01Icon);
export const Minus = mk(MinusSignIcon);
export const Power = mk(PowerIcon);                 // activate (turn on)
export const PowerOff = mk(PowerOffIcon);           // deactivate (turn off)
export const Trash = mk(Delete02Icon);
export const Edit = mk(Edit02Icon);
export const Close = mk(Cancel01Icon);

/* Error / env state glyphs, one per state so each failure reads at a glance
   (see screens/errors/ErrorCard.jsx + screens/wizard/EnvBlocked.jsx). */
export const Server = mk(ServerStack01Icon);
export const Shield = mk(Shield01Icon);
export const CloudOff = mk(CloudOffIcon);
export const License = mk(LicenseIcon);
export const UserShield = mk(UserShield01Icon);
export const Puzzle = mk(PuzzleIcon);
export const Wordpress = mk(WordpressIcon);
export const Php = mk(PhpIcon);
export const Gauge = mk(GaugeIcon);

/* Dashboard sidebar + Import tab icons (see components/DashShell.jsx). */
export const Home = mk(Home01Icon);
export const Inbox = mk(InboxIcon);
export const Users = mk(UserGroupIcon);
export const Tag = mk(Tag01Icon);
export const Crown = mk(Crown03Icon);
export const Sliders = mk(PreferenceHorizontalIcon);
export const Import = mk(Download04Icon);
export const Wand = mk(MagicWand01Icon);
/* Monochrome Figma glyph (Hugeicons stroke-rounded), for the sidebar rail so
   it matches the other nav icons. The multicolor `Figma` mark below stays for
   brand contexts (Home quick-card, mode picker, connect steps, tokens). */
export const FigmaGlyph = mk(FigmaIcon);
/* Official multicolor Figma mark. */
export const Figma = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 24c2.208 0 4-1.792 4-4v-4H8c-2.208 0-4 1.792-4 4s1.792 4 4 4Z" fill="#0ACF83"/>
    <path d="M4 12c0-2.208 1.792-4 4-4h4v8H8c-2.208 0-4-1.792-4-4Z" fill="#A259FF"/>
    <path d="M4 4c0-2.208 1.792-4 4-4h4v8H8C5.792 8 4 6.208 4 4Z" fill="#F24E1E"/>
    <path d="M12 0h4c2.208 0 4 1.792 4 4s-1.792 4-4 4h-4V0Z" fill="#FF7262"/>
    <path d="M20 12c0 2.208-1.792 4-4 4s-4-1.792-4-4 1.792-4 4-4 4 1.792 4 4Z" fill="#1ABCFE"/>
  </svg>
);
export const Cursor = mk(Cursor01Icon);
export const Claude = mk(ClaudeIcon);
/* ── AI-tool brand marks for the "Works with" row on the AI Agent (MCP) panel.
   Claude uses the Hugeicons ClaudeIcon mark above; Cursor and Codex have no
   Hugeicons logo, so these are stylized monochrome (currentColor) stand-ins –
   swap for official brand SVGs when design supplies them, exactly like the
   builder tiles below. strokeWidth scales to a constant ~1.25px so they match
   the surrounding glyph weight (see UC_ICON_STROKE). ── */
const brandSw = (size) => +((1.25 * 24) / size).toFixed(2);
/* Cursor, isometric-cube wireframe (their hexagonal cube mark). */
export const CursorLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={brandSw(size)} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
    <path d="M4 7.5 12 12l8-4.5" />
    <path d="M12 12v9" />
  </svg>
);
/* Codex, hexagonal knot (OpenAI-style), abstract mark + centre hub. */
export const CodexLogo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={brandSw(size)} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
    <circle cx="12" cy="12" r="2.4" />
  </svg>
);
/* ── AI-tool app-tile logos, brand-coloured 100×100 rounded squares with a
   soft white inner stroke, matching the builder tiles below. Used by the
   "Pick your AI tool" picker on the AI Agent (MCP) panel. Marks are authored
   in each brand's own colour so the picker reads like a real integrations
   grid. ── */
export const ClaudeTile = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M0 24C0 10.7452 10.7452 0 24 0H76C89.2548 0 100 10.7452 100 24V76C100 89.2548 89.2548 100 76 100H24C10.7452 100 0 89.2548 0 76V24Z" fill="#D97757"/>
    <path d="M24 2H76C88.1503 2 98 11.8497 98 24V76C98 88.1503 88.1503 98 76 98H24C11.8497 98 2 88.1503 2 76V24L2.00684 23.4326C2.30301 11.7331 11.7331 2.30301 23.4326 2.00684L24 2Z" stroke="white" strokeOpacity="0.4" strokeWidth="4"/>
    {/* Official Claude sunburst, scaled ~0.58 and centred in the tile. */}
    <g transform="translate(50 50) scale(0.58) translate(-53 -50)" fill="#fff">
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"/>
    </g>
  </svg>
);
export const CursorTile = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M0 24C0 10.7452 10.7452 0 24 0H76C89.2548 0 100 10.7452 100 24V76C100 89.2548 89.2548 100 76 100H24C10.7452 100 0 89.2548 0 76V24Z" fill="#0F0F0F"/>
    <path d="M24 2H76C88.1503 2 98 11.8497 98 24V76C98 88.1503 88.1503 98 76 98H24C11.8497 98 2 88.1503 2 76V24L2.00684 23.4326C2.30301 11.7331 11.7331 2.30301 23.4326 2.00684L24 2Z" stroke="white" strokeOpacity="0.25" strokeWidth="4"/>
    {/* Official Cursor cube (747×851), scaled to fit and centred in the tile. */}
    <g transform="translate(50 50) scale(0.0705) translate(-373.5 -425.5)" fill="#fff">
      <path d="M731.545 201.413L390.888 4.73778C379.949 -1.57926 366.452 -1.57926 355.513 4.73778L14.8731 201.413C5.67749 206.723 0.00012207 216.542 0.00012207 227.177V623.776C0.00012207 634.394 5.67749 644.23 14.8731 649.539L355.529 846.214C366.468 852.532 379.966 852.532 390.905 846.214L731.56 649.539C740.756 644.23 746.434 634.409 746.434 623.776V227.177C746.434 216.558 740.756 206.723 731.56 201.413H731.545ZM710.147 243.074L381.293 812.663C379.07 816.501 373.201 814.933 373.201 810.487V437.526C373.201 430.074 369.218 423.18 362.757 419.438L39.7735 232.966C35.9353 230.744 37.5026 224.874 41.9484 224.874H699.655C708.996 224.874 714.833 234.997 710.162 243.09H710.147V243.074Z"/>
    </g>
  </svg>
);
export const CodexTile = ({ size = 16 }) => (
  /* Official Codex icon, already a full app tile (white ground + gradient mark).
     A faint edge stroke keeps it legible on the light card behind it. */
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z" fill="#fff" stroke="rgba(0,0,0,0.14)" strokeWidth="0.4"/>
    <path d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="url(#uicCodexGrad)"/>
    <defs>
      <linearGradient id="uicCodexGrad" gradientUnits="userSpaceOnUse" x1="12" x2="12" y1="3" y2="21">
        <stop stopColor="#B1A7FF"/>
        <stop offset=".5" stopColor="#7A9DFF"/>
        <stop offset="1" stopColor="#3941FF"/>
      </linearGradient>
    </defs>
  </svg>
);
export const AntigravityTile = ({ size = 16 }) => (
  /* Official Antigravity mark (multi-colour blurred orbit, lobe-icons) centred
     on a white app-tile with a faint edge stroke, matching the Codex tile. */
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M0 24C0 10.7452 10.7452 0 24 0H76C89.2548 0 100 10.7452 100 24V76C100 89.2548 89.2548 100 76 100H24C10.7452 100 0 89.2548 0 76V24Z" fill="#fff"/>
    <path d="M24 2H76C88.1503 2 98 11.8497 98 24V76C98 88.1503 88.1503 98 76 98H24C11.8497 98 2 88.1503 2 76V24L2.00684 23.4326C2.30301 11.7331 11.7331 2.30301 23.4326 2.00684L24 2Z" stroke="rgba(0,0,0,0.14)" strokeWidth="3"/>
    <svg x="22" y="22" width="56" height="56" viewBox="0 0 24 24">
      <mask id="uicAgMask" maskUnits="userSpaceOnUse" x="0" y="1" width="24" height="23">
        <path d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z" fill="#fff"/>
      </mask>
      <g mask="url(#uicAgMask)">
        <g filter="url(#uicAgF1)"><path d="M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z" fill="#FFE432"/></g>
        <g filter="url(#uicAgF2)"><path d="M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z" fill="#FC413D"/></g>
        <g filter="url(#uicAgF3)"><path d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z" fill="#00B95C"/></g>
        <g filter="url(#uicAgF5)"><path d="M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z" fill="#00B95C"/></g>
        <g filter="url(#uicAgF6)"><path d="M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z" fill="#3186FF"/></g>
        <g filter="url(#uicAgF7)"><path d="M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z" fill="#FBBC04"/></g>
        <g filter="url(#uicAgF8)"><path d="M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z" fill="#3186FF"/></g>
        <g filter="url(#uicAgF9)"><path d="M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z" fill="#749BFF"/></g>
        <g filter="url(#uicAgF10)"><path d="M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z" fill="#FC413D"/></g>
        <g filter="url(#uicAgF11)"><path d="M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z" fill="#FFEE48"/></g>
      </g>
      <defs>
        <filter id="uicAgF1" filterUnits="userSpaceOnUse" x="-3.288" y="-11.917" width="19.838" height="17.587" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="1.117"/></filter>
        <filter id="uicAgF2" filterUnits="userSpaceOnUse" x="4.251" y="-13.493" width="38.9" height="38.565" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="5.4"/></filter>
        <filter id="uicAgF3" filterUnits="userSpaceOnUse" x="-21.889" y="-10.592" width="40.955" height="36.517" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="4.591"/></filter>
        <filter id="uicAgF5" filterUnits="userSpaceOnUse" x="-19.099" y="-10.278" width="36.632" height="36.595" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="4.591"/></filter>
        <filter id="uicAgF6" filterUnits="userSpaceOnUse" x=".981" y="8.758" width="33.533" height="34.087" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="4.363"/></filter>
        <filter id="uicAgF7" filterUnits="userSpaceOnUse" x="-6.143" y="-21.659" width="35.978" height="35.276" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="3.954"/></filter>
        <filter id="uicAgF8" filterUnits="userSpaceOnUse" x="-11.96" y="-.46" width="45.114" height="46.523" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="3.531"/></filter>
        <filter id="uicAgF9" filterUnits="userSpaceOnUse" x="10.485" y=".58" width="25.094" height="24.054" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="3.159"/></filter>
        <filter id="uicAgF10" filterUnits="userSpaceOnUse" x="5.833" y="-12.467" width="33.508" height="30.007" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="2.669"/></filter>
        <filter id="uicAgF11" filterUnits="userSpaceOnUse" x="-8.355" y="-8.876" width="22.194" height="26.151" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="3.303"/></filter>
      </defs>
    </svg>
  </svg>
);
/* ── Builder marks, official app-tile logos (100×100 rounded squares
   with a soft white inner stroke), supplied by the design team. ── */
export const Elementor = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M0 24C0 10.7452 10.7452 0 24 0H76C89.2548 0 100 10.7452 100 24V76C100 89.2548 89.2548 100 76 100H24C10.7452 100 0 89.2548 0 76V24Z" fill="#92003B"/>
    <path d="M24 2H76C88.1503 2 98 11.8497 98 24V76C98 88.1503 88.1503 98 76 98H24C11.8497 98 2 88.1503 2 76V24L2.00684 23.4326C2.30301 11.7331 11.7331 2.30301 23.4326 2.00684L24 2Z" stroke="white" strokeOpacity="0.4" strokeWidth="4"/>
    <path d="M29.1735 70.8308H37.5023V29.1692H29.1735V70.8308Z" fill="white"/>
    <path d="M45.8311 70.8308H70.8266V62.5024H45.8311V70.8308Z" fill="white"/>
    <path d="M45.8311 54.1646H70.8266V45.8358H45.8311V54.1646Z" fill="white"/>
    <path d="M45.8311 37.498H70.8266V29.1692H45.8311V37.498Z" fill="white"/>
  </svg>
);
export const Bricks = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M0 24C0 10.7452 10.7452 0 24 0H76C89.2548 0 100 10.7452 100 24V76C100 89.2548 89.2548 100 76 100H24C10.7452 100 0 89.2548 0 76V24Z" fill="#FFD53E"/>
    <path d="M24 2H76C88.1503 2 98 11.8497 98 24V76C98 88.1503 88.1503 98 76 98H24C11.8497 98 2 88.1503 2 76V24L2.00684 23.4326C2.30301 11.7331 11.7331 2.30301 23.4326 2.00684L24 2Z" stroke="white" strokeOpacity="0.4" strokeWidth="4"/>
    <path d="M41.7082 43.9771C42.7167 42.4831 44.0986 41.2692 45.8541 40.3355C47.6469 39.4017 49.6825 38.9348 51.9609 38.9348C54.6128 38.9348 57.0032 39.5885 59.1322 40.8957C61.2985 42.203 62.9979 44.0705 64.2305 46.4983C65.5004 48.8887 66.1354 51.6713 66.1354 54.8461C66.1354 58.0209 65.5004 60.8408 64.2305 63.306C62.9979 65.7337 61.2985 67.6199 59.1322 68.9646C57.0032 70.3092 54.6128 70.9815 51.9609 70.9815C49.6452 70.9815 47.6096 70.5333 45.8541 69.6369C44.136 68.7031 42.754 67.5079 41.7082 66.0512V70.4772H33.8646V29.0183H41.7082V43.9771ZM58.1237 54.8461C58.1237 52.9786 57.7315 51.3725 56.9472 50.0279C56.2002 48.6459 55.1917 47.6001 53.9218 46.8905C52.6892 46.1808 51.3446 45.826 49.8879 45.826C48.4686 45.826 47.124 46.1995 45.8541 46.9465C44.6215 47.6562 43.6131 48.702 42.8287 50.0839C42.0817 51.4659 41.7082 53.0906 41.7082 54.9582C41.7082 56.8257 42.0817 58.4504 42.8287 59.8324C43.6131 61.2143 44.6215 62.2788 45.8541 63.0258C47.124 63.7355 48.4686 64.0903 49.8879 64.0903C51.3446 64.0903 52.6892 63.7168 53.9218 62.9698C55.1917 62.2228 56.2002 61.1583 56.9472 59.7764C57.7315 58.3944 58.1237 56.751 58.1237 54.8461Z" fill="#020202"/>
  </svg>
);
export const Gutenberg = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M0 24C0 10.7452 10.7452 0 24 0H76C89.2548 0 100 10.7452 100 24V76C100 89.2548 89.2548 100 76 100H24C10.7452 100 0 89.2548 0 76V24Z" fill="#287CB2"/>
    <path d="M24 2H76C88.1503 2 98 11.8497 98 24V76C98 88.1503 88.1503 98 76 98H24C11.8497 98 2 88.1503 2 76V24L2.00684 23.4326C2.30301 11.7331 11.7331 2.30301 23.4326 2.00684L24 2Z" stroke="white" strokeOpacity="0.4" strokeWidth="4"/>
    <path d="M37.9572 28.4582C30.3997 31.744 27.5053 38.7849 28.0681 52.3193C28.3897 59.2038 28.7917 61.7073 30.1585 64.2107C33.6156 70.7823 39.324 73.5987 47.6855 72.8946C53.635 72.5035 57.8962 70.2347 59.8258 66.636C60.6298 65.1495 61.273 61.5508 61.5142 57.7174C61.8358 51.537 61.9162 51.3023 64.0065 50.8329C66.9813 50.207 72.1269 45.9824 72.1269 44.1048C72.1269 41.9143 69.9561 42.2272 66.8205 44.8871C65.0517 46.3736 62.6398 47.4688 59.5042 48.0947C50.5799 49.8158 48.9719 50.4417 46.4795 53.1799C43.7459 56.2309 43.3439 58.0303 45.2735 58.8126C46.0775 59.1256 47.2835 58.3432 48.8915 56.4656C51.1427 53.884 55.4038 51.6152 56.3686 52.554C56.6098 52.8669 56.851 54.901 56.851 57.248C56.851 65.5407 53.3938 69.2177 45.7559 69.2177C41.0928 69.2177 37.2336 67.0271 34.8216 62.959C33.3744 60.612 33.1332 58.8909 33.1332 50.4417C33.1332 39.2543 34.3392 35.7339 39.0828 32.6828C44.8715 28.9276 53.8762 31.0399 55.9666 36.7509C57.7354 41.2884 59.3434 42.2272 60.871 39.4108C61.5946 38.1591 61.4338 37.142 60.067 34.4039C56.851 27.8323 45.9167 24.9377 37.9572 28.4582Z" fill="white"/>
  </svg>
);
export const Discord = mk(DiscordIcon);
export const Facebook = mk(Facebook01Icon);
export const Refresh = mk(RefreshIcon);
export const Spinner = mk(Loading03Icon);
export const ExtLink = mk(LinkSquare02Icon);
export const User = mk(User03Icon);
export const LogOut = mk(Logout03Icon);

/* Bigger illustration used on the success screen, violet-tinted shapes
   inspired by unDraw "celebration". Single SVG, no external deps. */
export function SuccessArt({ size = 180 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id="nd-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#525252"/>
          <stop offset="100%" stopColor="#171717"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#nd-grad)" opacity="0.10"/>
      <circle cx="100" cy="100" r="56" fill="url(#nd-grad)" opacity="0.18"/>
      <circle cx="100" cy="100" r="36" fill="url(#nd-grad)"/>
      <path d="M84 102l11 11 22-26" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="40"  cy="56"  r="4"  fill="#A3A3A3"/>
      <circle cx="160" cy="48"  r="3"  fill="#737373"/>
      <circle cx="170" cy="140" r="5"  fill="#A3A3A3"/>
      <circle cx="32"  cy="148" r="3"  fill="#737373"/>
      <path d="M30 30l6 6M170 30l-6 6M30 170l6-6M170 170l-6-6" stroke="#737373" strokeWidth="2" strokeLinecap="round" opacity=".5"/>
    </svg>
  );
}

/* Full UiChemy wordmark, icon mark + logotype. Pass height to scale. */
export function Logo({ height = 22, color = '#FD6A35' }) {
  const width = Math.round(height * (270 / 48));
  return (
    <svg width={width} height={height} viewBox="0 0 270 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="UiChemy">
      <path fillRule="evenodd" clipRule="evenodd" d="M18.8529 28.9894C18.8529 35.5796 27.4059 35.0854 27.4059 35.0854L27.4368 24.9709H46.2543V33.3035C46.2543 35.1079 45.8989 36.8946 45.2084 38.5616C44.5179 40.2287 43.5058 41.7435 42.2299 43.0194C40.9539 44.2953 39.4392 45.3074 37.7721 45.998C36.1051 46.6885 34.3183 47.0439 32.5139 47.0439H16.3165C15.3967 47.1311 14.4706 47.1311 13.5508 47.0439C11.7702 47.0439 10.007 46.6929 8.36206 46.0111C6.71714 45.3293 5.22273 44.33 3.96425 43.0702C2.70577 41.8105 1.70792 40.3151 1.02771 38.6695C0.347498 37.0239 -0.00173243 35.2605 6.46186e-06 33.4799V0H6.67394C9.90597 0.00350778 13.0044 1.29015 15.2881 3.5772C17.5718 5.86424 18.854 8.96449 18.8529 12.1965V28.9894ZM44.6487 26.5942H29.0733L29.0336 35.0899C29.0336 37.4057 28.7998 40.4141 26.978 43.1004C26.3884 43.9673 25.6716 44.7405 24.8519 45.3941H32.5448C35.7539 45.3906 38.8305 44.1143 41.0997 41.8451C43.3689 39.576 44.6452 36.4993 44.6487 33.2902V26.5942ZM30.6436 3.2119C32.7001 1.15539 35.4893 9.63531e-05 38.3976 9.63531e-05H46.2758V17.5429H27.4318V10.9659C27.4318 8.05759 28.5871 5.2684 30.6436 3.2119ZM92.7385 9.37626C92.9725 9.37626 93.1969 9.46917 93.3623 9.63461C93.5278 9.80006 93.6207 10.0245 93.6207 10.2585V26.0147C93.6207 37.0424 86.563 38.5686 78.4908 38.5686C70.4186 38.5686 63.3609 37.0556 63.3609 26.0147V10.2585C63.3609 10.0245 63.4538 9.80006 63.6193 9.63461C63.7847 9.46917 64.0091 9.37626 64.2431 9.37626H70.6347C70.8687 9.37626 71.0931 9.46917 71.2585 9.63461C71.424 9.80006 71.5169 10.0245 71.5169 10.2585V26.0147C71.5169 31.8638 74.6046 32.8033 78.5084 32.8033C82.4122 32.8033 85.5 31.8638 85.5 26.0147V10.2585C85.5 10.0245 85.5929 9.80006 85.7583 9.63461C85.9238 9.46917 86.1482 9.37626 86.3822 9.37626H92.7385ZM104.599 19.0719H99.0102C98.7911 19.0585 98.5757 19.1321 98.4105 19.2766C98.2454 19.4211 98.1438 19.6249 98.128 19.8438V37.2277C98.1438 37.4466 98.2454 37.6504 98.4105 37.7949C98.5757 37.9394 98.7911 38.013 99.0102 37.9997H104.599C104.818 38.0118 105.033 37.9379 105.198 37.7936C105.362 37.6494 105.464 37.4462 105.481 37.2277V19.8438C105.464 19.6253 105.362 19.4222 105.198 19.2779C105.033 19.1336 104.818 19.0597 104.599 19.0719ZM135.001 26.2651H141.617C141.752 26.2618 141.885 26.2892 142.007 26.3451C142.129 26.4011 142.236 26.4841 142.321 26.5879C142.407 26.6917 142.467 26.8134 142.498 26.944C142.529 27.0746 142.529 27.2106 142.5 27.3415C140.66 35.5284 133.069 38.572 125.813 38.572C117.551 38.572 108.76 34.6021 108.76 23.6847C108.76 12.7674 117.551 8.76209 125.813 8.76209C133.069 8.76209 140.66 11.8498 142.5 20.0324C142.529 20.1633 142.529 20.2991 142.498 20.4297C142.467 20.5603 142.407 20.6822 142.321 20.786C142.236 20.8898 142.129 20.9728 142.007 21.0287C141.885 21.0846 141.752 21.1119 141.617 21.1086H135.001C134.809 21.1093 134.621 21.0473 134.468 20.9318C134.314 20.8163 134.202 20.6538 134.15 20.469C133.131 16.9005 130.621 14.5274 125.808 14.5274C119.959 14.5274 117.017 18.1268 117.017 23.6847C117.017 29.2427 119.959 32.8068 125.808 32.8068C130.638 32.8068 133.131 30.4381 134.15 26.9004C134.203 26.7164 134.315 26.5548 134.469 26.4402C134.622 26.3256 134.809 26.2642 135.001 26.2651ZM170.342 37.1826V23.6362H170.337C170.337 18.7488 166.822 15.661 161.219 15.661C158.546 15.6018 155.957 16.6006 154.016 18.44C153.948 18.5062 153.862 18.5507 153.769 18.5681C153.676 18.5854 153.579 18.5748 153.492 18.5376C153.405 18.5003 153.331 18.4381 153.279 18.3587C153.227 18.2793 153.199 18.1864 153.2 18.0915V10.3325C153.2 10.0986 153.107 9.87413 152.942 9.70868C152.776 9.54324 152.552 9.45033 152.318 9.45033H146.734C146.5 9.45033 146.275 9.54324 146.11 9.70868C145.944 9.87413 145.851 10.0986 145.851 10.3325V37.1826C145.851 37.4166 145.944 37.641 146.11 37.8064C146.275 37.9719 146.5 38.0648 146.734 38.0648H152.336C152.57 38.0648 152.794 37.9719 152.959 37.8064C153.125 37.641 153.218 37.4166 153.218 37.1826V25.2727C153.218 22.8599 154.943 21.0161 158.211 21.0161C161.48 21.0161 162.993 22.8599 162.993 25.2727V37.1826C162.993 37.4166 163.086 37.641 163.251 37.8064C163.417 37.9719 163.641 38.0648 163.875 38.0648H169.459C169.693 38.0648 169.918 37.9719 170.083 37.8064C170.249 37.641 170.342 37.4166 170.342 37.1826ZM181.03 28.7225C180.964 28.7251 180.9 28.7423 180.843 28.7727C180.785 28.8032 180.734 28.8462 180.695 28.8985C180.656 28.9509 180.628 29.0113 180.615 29.0755C180.602 29.1396 180.604 29.2059 180.62 29.2694C181.334 31.7661 183.315 33.5481 186.822 33.5481C189.861 33.5481 191.493 32.4322 192.415 30.8398C192.456 30.768 192.515 30.7083 192.586 30.6665C192.657 30.6247 192.738 30.6023 192.821 30.6016H198.67C198.72 30.6012 198.769 30.6125 198.815 30.6344C198.86 30.6564 198.899 30.6885 198.93 30.7282C198.961 30.7679 198.982 30.8141 198.992 30.8633C199.002 30.9125 199 30.9633 198.987 31.0118C197.448 36.5123 192.212 38.5768 186.822 38.5768C180.567 38.5768 173.738 35.3038 173.738 27.086C173.738 18.8682 180.567 15.5951 186.822 15.5951C193.076 15.5951 199.786 19.1592 199.45 28.1357C199.442 28.2941 199.374 28.4434 199.259 28.5526C199.144 28.6618 198.991 28.7227 198.833 28.7225H181.03ZM181.418 24.4702H191.938C192.008 24.4675 192.075 24.4483 192.136 24.4145C192.196 24.3806 192.248 24.333 192.287 24.2754C192.326 24.2178 192.35 24.1519 192.359 24.0831C192.367 24.0142 192.359 23.9443 192.335 23.8791C191.533 21.9162 189.839 20.6238 186.817 20.6238C183.796 20.6238 181.965 21.9471 181.025 23.857C180.998 23.9227 180.986 23.9942 180.992 24.0653C180.998 24.1364 181.021 24.2051 181.059 24.2654C181.097 24.3257 181.149 24.3759 181.211 24.4115C181.273 24.4472 181.342 24.4674 181.414 24.4702H181.418ZM241.342 37.1167V23.5704H241.373C241.373 18.6829 238.224 15.5951 232.622 15.5951C228.674 15.5951 225.851 18.1712 225.013 19.2608C224.994 19.2841 224.971 19.3024 224.944 19.3142C224.917 19.3259 224.887 19.3308 224.858 19.3282C224.828 19.3255 224.8 19.3155 224.775 19.2991C224.751 19.2827 224.731 19.2604 224.717 19.2343C223.363 16.9185 220.716 15.5951 217.042 15.5951C215.785 15.5949 214.544 15.8775 213.41 16.4219C212.277 16.9663 211.281 17.7587 210.496 18.7403C210.474 18.7719 210.443 18.7955 210.407 18.8078C210.37 18.8201 210.331 18.8203 210.295 18.8083C210.259 18.7964 210.227 18.7729 210.205 18.7416C210.183 18.7102 210.172 18.6726 210.174 18.6344V17.095C210.174 16.861 210.081 16.6366 209.915 16.4711C209.75 16.3057 209.525 16.2128 209.292 16.2128H205.635C204.888 16.2139 204.172 16.5114 203.645 17.0398C203.117 17.5683 202.821 18.2846 202.821 19.0314V37.1167C202.821 37.3507 202.913 37.5751 203.079 37.7406C203.244 37.906 203.469 37.9989 203.703 37.9989H209.287C209.521 37.9989 209.746 37.906 209.911 37.7406C210.076 37.5751 210.169 37.3507 210.169 37.1167V25.2069C210.169 22.1368 212.132 20.9502 214.377 20.9502C216.623 20.9502 218.387 22.0132 218.387 25.2069V37.1167C218.387 37.3507 218.48 37.5751 218.646 37.7406C218.811 37.906 219.035 37.9989 219.269 37.9989H224.854C225.088 37.9989 225.312 37.906 225.478 37.7406C225.643 37.5751 225.736 37.3507 225.736 37.1167V25.2069C225.736 22.1368 227.708 20.9502 229.949 20.9502C232.189 20.9502 233.954 22.0132 233.954 25.2069V37.1167C233.954 37.3507 234.047 37.5751 234.212 37.7406C234.378 37.906 234.602 37.9989 234.836 37.9989H240.46C240.694 37.9989 240.918 37.906 241.084 37.7406C241.249 37.5751 241.342 37.3507 241.342 37.1167ZM269.573 17.4638L257.297 44.314C257.227 44.4695 257.114 44.6013 256.971 44.6937C256.828 44.7861 256.661 44.835 256.49 44.8345H250.99C250.837 44.8367 250.686 44.7992 250.552 44.7255C250.417 44.6518 250.305 44.5445 250.225 44.4141C250.145 44.2838 250.1 44.1349 250.095 43.982C250.09 43.8291 250.124 43.6775 250.195 43.5421L253.098 37.865C253.159 37.7424 253.191 37.6072 253.191 37.4702C253.191 37.3331 253.159 37.1979 253.098 37.0754L243.588 17.4903C243.52 17.3549 243.489 17.2043 243.497 17.0532C243.504 16.9021 243.551 16.7555 243.631 16.6275C243.712 16.4995 243.824 16.3944 243.957 16.3222C244.09 16.25 244.239 16.2134 244.391 16.2156H250.032C250.206 16.2149 250.377 16.2655 250.522 16.3613C250.667 16.457 250.781 16.5936 250.848 16.7537L256.274 29.4002C256.311 29.4713 256.368 29.5308 256.436 29.5724C256.505 29.6139 256.584 29.6359 256.664 29.6359C256.745 29.6359 256.824 29.6139 256.892 29.5724C256.961 29.5308 257.017 29.4713 257.055 29.4002L262.251 16.7757C262.317 16.6124 262.43 16.4726 262.577 16.3743C262.723 16.2761 262.895 16.2238 263.071 16.2243H268.744C268.893 16.2228 269.04 16.2594 269.172 16.3303C269.303 16.4012 269.414 16.5043 269.495 16.6299C269.576 16.7555 269.623 16.8995 269.633 17.0485C269.643 17.1974 269.615 17.3464 269.551 17.4815L269.573 17.4638ZM98.1241 15.3451V11.6531L98.1285 11.6575C98.1285 10.8912 98.433 10.1563 98.9748 9.6145C99.5166 9.07267 100.252 8.76826 101.018 8.76826H104.6C104.834 8.76826 105.058 8.86117 105.223 9.02661C105.389 9.19206 105.482 9.4165 105.482 9.65047V15.3451C105.482 15.5791 105.389 15.8035 105.223 15.969C105.058 16.1344 104.834 16.2273 104.6 16.2273H99.0063C98.7724 16.2273 98.548 16.1344 98.3825 15.969C98.2171 15.8035 98.1241 15.5791 98.1241 15.3451Z" fill={color}/>
    </svg>
  );
}

/* Icon-only UiChemy mark (the "U" glyph, no logotype), shown in the rail when
   it's collapsed. Placeholder derived from the full logo; swap the path/SVG here
   when the dedicated icon asset is provided. */
export function LogoIcon({ size = 26, color = '#FD6A35' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="UiChemy">
      <path fillRule="evenodd" clipRule="evenodd" d="M18.8529 28.9894C18.8529 35.5796 27.4059 35.0854 27.4059 35.0854L27.4368 24.9709H46.2543V33.3035C46.2543 35.1079 45.8989 36.8946 45.2084 38.5616C44.5179 40.2287 43.5058 41.7435 42.2299 43.0194C40.9539 44.2953 39.4392 45.3074 37.7721 45.998C36.1051 46.6885 34.3183 47.0439 32.5139 47.0439H16.3165C15.3967 47.1311 14.4706 47.1311 13.5508 47.0439C11.7702 47.0439 10.007 46.6929 8.36206 46.0111C6.71714 45.3293 5.22273 44.33 3.96425 43.0702C2.70577 41.8105 1.70792 40.3151 1.02771 38.6695C0.347498 37.0239 -0.00173243 35.2605 6.46186e-06 33.4799V0H6.67394C9.90597 0.00350778 13.0044 1.29015 15.2881 3.5772C17.5718 5.86424 18.854 8.96449 18.8529 12.1965V28.9894ZM44.6487 26.5942H29.0733L29.0336 35.0899C29.0336 37.4057 28.7998 40.4141 26.978 43.1004C26.3884 43.9673 25.6716 44.7405 24.8519 45.3941H32.5448C35.7539 45.3906 38.8305 44.1143 41.0997 41.8451C43.3689 39.576 44.6452 36.4993 44.6487 33.2902V26.5942ZM30.6436 3.2119C32.7001 1.15539 35.4893 9.63531e-05 38.3976 9.63531e-05H46.2758V17.5429H27.4318V10.9659C27.4318 8.05759 28.5871 5.2684 30.6436 3.2119Z" fill={color}/>
    </svg>
  );
}
