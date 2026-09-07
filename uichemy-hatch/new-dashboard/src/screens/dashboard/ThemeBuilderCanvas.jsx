/**
 * Theme Builder, Canvas (site-architecture) view.
 *
 * A pannable / zoomable map of the WordPress template hierarchy in four groups
 * (Structural / Singular / Archives / Special), driven by the tb_architecture
 * endpoint. Custom-built rather than pulled from a flow library: SVG edges plus
 * absolutely-positioned nodes inside a CSS-transformed "world", with zoom, pan,
 * wheel-zoom, fit, full-screen and a minimap.
 *
 * This is the native design-system port of the Tailwind island version that
 * still lives at uichemy-composer/admin/screens/ThemeBuilderCanvas.jsx. The graph
 * maths and the interaction model are carried over unchanged, they were already
 * correct, while every Tailwind utility became a `tb-cv-*` class in app.scss so
 * the map matches the rest of this screen instead of the island's shadcn look.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import { Badge, Button, Switch } from '../../design-system';
import { data, tbAjax } from '../../uichemy-composer/admin/data.js';
import { ConditionsDialog } from './ThemeBuilderConditions.jsx';

/* ── Layout constants (world coordinates, unscaled px) ───────────────────── */
const COLS = 3;
/* 280 x 124, the sitemap card's true size. Its Figma frame sits at 0.88 scale
   (246.4 = 280 x 0.88, 14.08 = 16 x 0.88, 8.8 = 10 x 0.88), so these are the
   unscaled originals rather than measurements off a screenshot. CAT_WIDTH is
   derived from CARD_W, so the whole graph reflows with it. */
const CARD_W = 280;
// Was 168, most of which was an empty preview box. A compact card fits far
// more of the tree on screen, which is what makes the hierarchy readable.
const CARD_H = 124;
const CARD_GAP = 22;
const ROW_GAP = 56;
const CAT_W = 206;
const CAT_H = 52;
const CAT_GAP = 60;
const HUB_W = 236;
const HUB_H = 70;
const HUB_Y = 0;
const CAT_Y = 152;
const CHILD_Y = 286;
const CAT_WIDTH = COLS * CARD_W + ( COLS - 1 ) * CARD_GAP;
const ZERO = { dx: 0, dy: 0 };

const MIN_SCALE = 0.2;
const MAX_SCALE = 1.8;

/* ── Small inline glyphs the shared icon set doesn't carry ───────────────── */
const G = ( d ) => ( { size = 16, ...p } ) => (
  <svg width={ size } height={ size } viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" { ...p }>
    { d }
  </svg>
);
const PlusIcon    = G( <path d="M12 5v14M5 12h14" /> );
const MinusIcon   = G( <path d="M5 12h14" /> );
const FitIcon     = G( <><path d="M3 8V5a2 2 0 0 1 2-2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /></> );
const ExpandIcon  = G( <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></> );
const ShrinkIcon  = G( <><path d="M9 3v6H3" /><path d="M15 21v-6h6" /><path d="M3 9l7-7" /><path d="M21 15l-7 7" /></> );
/* Drawn with the same G() helper as the rest of this file (24 viewBox, 1.7
   stroke) so the ribbon's tick is in the same line language as every other glyph
   here, rather than imported from a second icon set. */
const CheckIcon   = G( <path d="M4.5 12.5l5 5 10-11" /> );
const EditIcon    = G( <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></> );
const TrashIcon   = G( <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></> );
const CloseIcon   = G( <path d="M6 6l12 12M18 6L6 18" /> );

/* ── Slot identity ───────────────────────────────────────────────────────────
   Every card used to carry the SAME muted layout glyph, so nothing on the canvas
   was scannable and the eye had to read every title. A distinct icon per slot
   type — and one hue per family — is what makes a node graph legible at a
   glance; it is the single biggest difference from the reference sitemaps.

   Falls back to the category's own icon, so a slot the backend adds later still
   gets a sensible tile instead of a blank. */
const SLOT_ICON = {
  header: Icon.LayoutTop,
  footer: Icon.LayoutBottom,
  front_page: Icon.Home,
  blog_home: Icon.Book,
  single_post: Icon.FileDoc,
  single_page: Icon.FileDoc,
  any_singular: Icon.FileDoc,
  category_archive: Icon.Inbox,
  tag_archive: Icon.Tag,
  author_archive: Icon.Users,
  date_archive: Icon.Archive,
  any_archive: Icon.Archive,
  search_results: Icon.Search,
  '404_page': Icon.Warn,
};

const CATS = [
  { key: 'structural', label: __( 'Structural', 'uichemy' ), icon: Icon.Layout },
  { key: 'singular',   label: __( 'Singular', 'uichemy' ),   icon: Icon.Book },
  { key: 'archive',    label: __( 'Archives', 'uichemy' ),   icon: Icon.Inbox },
  { key: 'special',    label: __( 'Special', 'uichemy' ),    icon: Icon.Sparkles },
];

/* ── Pro gating ──────────────────────────────────────────────────────────────
   Same PHP-localized flags the rest of the screen reads (see ThemeBuilder.jsx).
   The architecture endpoint returns the FULL hierarchy whatever the build, the
   slots do exist on the site either way, so which of them this build can
   actually fill is answered here, in the view. */
const isPro = () => !! data.isPro;
const proTypes = () => ( Array.isArray( data.proTypes ) ? data.proTypes : [] );
const slotIsPro = ( slot ) => ! isPro() && !! slot && proTypes().indexOf( slot.type ) !== -1;
const upgradeUrl = () => data.upgradeUrl || 'https://uichemy.com/pricing/';
const openUpgrade = ( source ) => {
  const base = upgradeUrl();
  const href = source ? `${ base }${ base.indexOf( '?' ) === -1 ? '?' : '&' }utm_content=${ encodeURIComponent( source ) }` : base;
  window.open( href, '_blank', 'noopener' );
};

/**
 * Place every node and edge.
 *
 * Category groups sit side by side; each group's slots wrap into a COLS-wide
 * block beneath it, and one hub node above the lot is centred on the whole span.
 */
function buildGraph( slots, site ) {
  const groups = {};
  CATS.forEach( ( c ) => { groups[ c.key ] = []; } );
  slots.forEach( ( s ) => { ( groups[ s.group ] || ( groups[ s.group ] = [] ) ).push( s ); } );

  const nodes = [];
  const edges = [];
  const catCenter = {};
  let left = Infinity;
  let right = -Infinity;
  let bottom = CHILD_Y;

  CATS.forEach( ( cat, ci ) => {
    const list = groups[ cat.key ] || [];
    const blockX = ci * ( CAT_WIDTH + CAT_GAP );
    const catCardX = blockX + ( CAT_WIDTH - CAT_W ) / 2;
    catCenter[ cat.key ] = catCardX + CAT_W / 2;

    // "built / total" counts only slots this build can actually fill, so Free
    // never shows an all-Pro group as "0/9" unfinished work. The Pro slots are
    // still drawn (and counted separately) so the hierarchy stays complete.
    const own = list.filter( ( s ) => ! slotIsPro( s ) );
    nodes.push( {
      id: `cat-${ cat.key }`, kind: 'cat', x: catCardX, y: CAT_Y, cat,
      total: own.length,
      built: own.filter( ( s ) => s.filled ).length,
      pro: list.length - own.length,
    } );
    left = Math.min( left, catCardX );
    right = Math.max( right, catCardX + CAT_W );

    list.forEach( ( slot, i ) => {
      const x = blockX + ( i % COLS ) * ( CARD_W + CARD_GAP );
      const y = CHILD_Y + Math.floor( i / COLS ) * ( CARD_H + ROW_GAP );
      nodes.push( { id: `slot-${ slot.key }`, kind: 'slot', x, y, slot, catKey: cat.key } );
      left = Math.min( left, x );
      right = Math.max( right, x + CARD_W );
      bottom = Math.max( bottom, y + CARD_H );
      const empty = ! slot.filled;
      // A Pro slot is never "missing" in Free, that styling means "you should
      // fix this", and there is nothing here for a Free user to fix.
      edges.push( {
        id: `e-${ slot.key }`, nodeKey: slot.key,
        x1: catCenter[ cat.key ], y1: CAT_Y + CAT_H,
        x2: x + CARD_W / 2, y2: y,
        empty, missing: empty && slot.critical && ! slotIsPro( slot ),
      } );
    } );
  } );

  const hubX = ( left + right ) / 2 - HUB_W / 2;
  const gaps = slots.filter( ( s ) => s.critical && ! s.filled && ! slotIsPro( s ) ).length;
  nodes.unshift( { id: 'hub', kind: 'hub', x: hubX, y: HUB_Y, site, gaps } );
  CATS.forEach( ( cat ) => {
    if ( ( groups[ cat.key ] || [] ).length ) {
      edges.unshift( {
        id: `eh-${ cat.key }`, hub: true,
        x1: hubX + HUB_W / 2, y1: HUB_Y + HUB_H,
        x2: catCenter[ cat.key ], y2: CAT_Y,
      } );
    }
  } );

  return { nodes, edges, worldW: Math.max( right, hubX + HUB_W ) + 40, worldH: bottom + 40 };
}

function slotStatus( slot ) {
  // Locked comes before missing/empty: a Pro slot is not a gap this build's user
  // can close, so it must never be painted as a problem to fix.
  if ( slotIsPro( slot ) ) return 'pro';
  if ( ! slot.filled ) return slot.critical ? 'missing' : 'empty';
  return ( slot.templates || [] ).some( ( t ) => t.status === 'active' ) ? 'active' : 'inactive';
}

const STATUS_TEXT = {
  active:   __( 'Active', 'uichemy' ),
  inactive: __( 'Inactive', 'uichemy' ),
  missing:  __( 'Missing', 'uichemy' ),
  empty:    __( 'Empty', 'uichemy' ),
  pro:      __( 'Pro', 'uichemy' ),
};

function SlotCard( { slot, x, y, onDragStart, catKey } ) {
	const n = ( slot.templates || [] ).length;
	const pro = slotIsPro( slot );
	const status = slotStatus( slot );

	// ONE action, and it names what happens — the old card said its state twice
	// (a status word top-left and a "No templates" badge top-right) and put the
	// action behind a hover overlay, so at rest a card was two labels of noise
	// and no verb.
	const action = pro
		? __( 'Upgrade to Pro', 'uichemy' )
		: n > 0
			? __( 'Edit', 'uichemy' )
			: __( 'Create', 'uichemy' );
	const ActionIcon = pro ? Icon.Crown : n > 0 ? EditIcon : PlusIcon;
	// The count as a quiet figure, not a pill. "—" when there is nothing, which
	// reads faster than the words "No templates".
	const count = pro ? '' : n > 0 ? String( n ) : '—';
	const TypeIcon = SLOT_ICON[ slot.key ] || ( CATS.find( ( c ) => c.key === catKey ) || CATS[ 0 ] ).icon;
	const title = pro
		? sprintf( __( 'Drag to move · %s templates are part of UiChemy Pro', 'uichemy' ), slot.label )
		: n > 0
			? __( 'Drag to move · click to manage templates', 'uichemy' )
			: __( 'Drag to move · click to set up this slot', 'uichemy' );

	return (
		<div
			role="button"
			tabIndex={ 0 }
			onMouseDown={ ( e ) => { e.stopPropagation(); onDragStart( slot.key, e ); } }
			title={ title }
			className={ `tb-cv__card tb-cv__card--${ status }` }
			style={ { left: x, top: y, width: CARD_W, minHeight: CARD_H } }
		>
			{/* Connector handle. Every node carries exactly ONE, sited where its
			    edge actually joins — a child at the top, a parent at its bottom. The
			    slot edge ends at (x + CARD_W / 2, y), i.e. precisely here. */}
			<span className="tb-cv__handle" aria-hidden="true" />

			{/* State as a corner flag. It replaces the 2px left edge: that bar was
			    the only colour on the card, but it also ran flush against the
			    connector line arriving at the card's left, and at low zoom the two
			    read as one mark. Only `active` and `missing` fly a flag — an empty
			    non-critical slot is not a problem to announce. */}
			{ ( status === 'active' || status === 'missing' ) && (
				<span className={ `tb-cv__flag tb-cv__flag--${ status }` } aria-hidden="true">
					{ status === 'active' ? <CheckIcon size={ 11 } /> : <MinusIcon size={ 11 } /> }
				</span>
			) }
			<span className="tb-cv__sr">{ STATUS_TEXT[ status ] }</span>

			<div className="tb-cv__card-head">
				{/* Monochrome. The glyph distinguishes the slot TYPE by shape; giving it
				    a saturated tile as well put two colour systems on one canvas. */}
				<span className="tb-cv__glyph">
					{ pro ? <Icon.Crown size={ 15 } /> : <TypeIcon size={ 15 } /> }
				</span>
				<p className="tb-cv__card-title">{ slot.label }</p>
			</div>

			{ slot.sub_label ? <p className="tb-cv__card-sub">{ slot.sub_label }</p> : null }

			{/* The action moves OUT of a hover reveal and onto its own row under a
			    rule, so a node states its verb at rest. It used to be absolutely
			    positioned at opacity 0 precisely so revealing it could not change the
			    card's height; the card is now tall enough to hold it in flow, which
			    is simpler and keeps it readable without a pointer (it was invisible
			    to touch and to anyone scanning the canvas). */}
			<div className="tb-cv__card-foot">
				<span className="tb-cv__act">
					<ActionIcon size={ 13 } /> { action }
				</span>
				{ count ? <em className="tb-cv__act-n">{ count }</em> : null }
			</div>
		</div>
	);
}

/**
 * Slot detail popup. Rendered INSIDE the canvas wrapper on purpose, that is the
 * element that goes full-screen, and a modal portaled to <body> would vanish
 * behind it there.
 */
// The template types that have display conditions at all. Mirrors
// CONDITION_TYPES in ThemeBuilder.jsx — a Search or 404 template has nothing to
// target, so it gets no conditions button.
const CONDITION_TYPES = [ 'header', 'footer', 'single', 'archive' ];

function SlotModal( { slot, onClose, onCreate, onStatus, onDelete, onConditions, busy } ) {
  const templates = slot.templates || [];
  const active = templates.filter( ( t ) => t.status === 'active' ).length;
  const pro = slotIsPro( slot );

  return (
    <div className="tb-cv__scrim" onMouseDown={ ( e ) => { e.stopPropagation(); onClose(); } }>
      <div
        className="tb-cv__modal"
        onMouseDown={ ( e ) => e.stopPropagation() }
        onClick={ ( e ) => e.stopPropagation() }
      >
        {/* Close floats just outside the tray's top-right corner, matching the
            DS Dialog (`.closeOutside`). */}
        <button
          type="button"
          className="tb-cv__modal-close"
          onClick={ onClose }
          aria-label={ __( 'Close', 'uichemy' ) }
        >
          <CloseIcon size={ 16 } />
        </button>

        {/* White content card inside the grey tray (header + body). */}
        <div className="tb-cv__modal-card">
          <div className="tb-cv__modal-head">
            <div className="tb-cv__modal-titlerow">
              <h2 className="tb-cv__modal-title">{ slot.label }</h2>
              { pro ? <Badge variant="soft" tone="brand"><Icon.Crown size={ 10 } /> { __( 'Pro', 'uichemy' ) }</Badge> : null }
              { ! pro && ! templates.length && slot.critical
                ? <Badge variant="soft" tone="danger">{ __( 'Missing', 'uichemy' ) }</Badge> : null }
            </div>
            <p className="tb-cv__modal-sub">
              { slot.sub_label ? `${ slot.sub_label } · ` : '' }
              { templates.length
                ? sprintf( __( '%1$d/%2$d active', 'uichemy' ), active, templates.length )
                : __( 'No templates yet', 'uichemy' ) }
            </p>
          </div>

          <div className="tb-cv__modal-body">
            { pro ? (
            <div className="tb-cv__lock">
              <span className="tb-cv__lock-ic"><Icon.Crown size={ 20 } /></span>
              <b>{ sprintf( __( '%s templates are a Pro feature', 'uichemy' ), slot.label ) }</b>
              <p>{ __( 'Upgrade to design this part of your site with UiChemy, along with Archives, WooCommerce and Search templates.', 'uichemy' ) }</p>
              <Button variant="solid" tone="brand" size="sm" onClick={ () => onCreate( slot ) }>
                <Icon.Crown size={ 13 } /> { __( 'Upgrade to Pro', 'uichemy' ) }
              </Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="tb-cv__empty">
              <p>
                { slot.critical
                  ? __( 'No template here. Visitors get the active theme’s default.', 'uichemy' )
                  : __( 'No template assigned to this slot yet.', 'uichemy' ) }
              </p>
              <Button variant="solid" tone="brand" size="sm" disabled={ busy } onClick={ () => onCreate( slot ) }>
                <PlusIcon size={ 13 } /> { busy ? __( 'Creating…', 'uichemy' ) : __( 'Create template', 'uichemy' ) }
              </Button>
            </div>
          ) : templates.map( ( t ) => (
            <div key={ t.id } className={ `tb-cv__row${ t.status === 'active' ? '' : ' tb-cv__row--off' }` }>
              <div className="tb-cv__row-main">
                <a href={ t.editUrl } target="_blank" rel="noreferrer" className="tb-cv__row-title">{ t.title || __( '(untitled)', 'uichemy' ) }</a>
                <span className="tb-cv__row-meta">
                  { t.status === 'active' ? __( 'Active', 'uichemy' ) : __( 'Inactive', 'uichemy' ) }
                  { ' · ' }
                  { t.editor === 'gutenberg' ? 'Gutenberg' : 'Elementor' }
                </span>
              </div>
              <Switch size="sm" checked={ t.status === 'active' } onCheckedChange={ ( v ) => onStatus( t, v ? 'active' : 'inactive' ) } />
              { CONDITION_TYPES.includes( t.type ) ? (
                <button
                  type="button"
                  className="tb-cv__row-act"
                  onClick={ () => onConditions( t ) }
                  title={ __( 'Display conditions', 'uichemy' ) }
                  aria-label={ __( 'Display conditions', 'uichemy' ) }
                >
                  <Icon.Sliders size={ 14 } />
                </button>
              ) : null }
              <a href={ t.editUrl } target="_blank" rel="noreferrer" className="tb-cv__row-act" title={ __( 'Edit', 'uichemy' ) }><EditIcon size={ 14 } /></a>
              <button type="button" className="tb-cv__row-act tb-cv__row-act--danger" onClick={ () => onDelete( t ) } title={ __( 'Delete', 'uichemy' ) }><TrashIcon size={ 14 } /></button>
            </div>
          ) ) }
          </div>
        </div>

        { ! pro && templates.length > 0 ? (
          <div className="tb-cv__modal-foot">
            <Button variant="outline" tone="neutral" size="sm" disabled={ busy } onClick={ () => onCreate( slot ) }>
              <PlusIcon size={ 13 } /> { busy ? __( 'Creating…', 'uichemy' ) : __( 'Add another template', 'uichemy' ) }
            </Button>
          </div>
        ) : null }
      </div>
    </div>
  );
}

export default function CanvasView() {
  const wrapRef = useRef( null );
  const dragRef = useRef( null );
  const nodeDragRef = useRef( null );

  const [ arch, setArch ] = useState( null );
  const [ error, setError ] = useState( '' );
  const [ size, setSize ] = useState( { w: 1000, h: 560 } );
  const [ view, setView ] = useState( { scale: 0.8, x: 40, y: 20 } );
  const [ dragging, setDragging ] = useState( false );
  const [ fs, setFs ] = useState( false );
  const [ openKey, setOpenKey ] = useState( null );
  const [ busy, setBusy ] = useState( false );
  const [ nodePos, setNodePos ] = useState( {} );

  const load = useCallback( () => {
    tbAjax( 'tb_architecture' )
      .then( ( d ) => { setArch( d ); setError( '' ); } )
      .catch( ( e ) => setError( ( e && e.message ) || __( 'Failed to load the site map.', 'uichemy' ) ) );
  }, [] );
  useEffect( () => { load(); }, [ load ] );

  const graph = useMemo( () => ( arch ? buildGraph( arch.slots || [], arch.site || {} ) : null ), [ arch ] );
  const worldW = graph ? graph.worldW : 1200;
  const worldH = graph ? graph.worldH : 700;

  useEffect( () => {
    if ( ! wrapRef.current || typeof ResizeObserver === 'undefined' ) return undefined;
    const el = wrapRef.current;
    const ro = new ResizeObserver( () => setSize( { w: el.clientWidth, h: el.clientHeight } ) );
    ro.observe( el );
    return () => ro.disconnect();
  }, [] );

  const fit = useCallback( () => {
    const pad = 40;
    const s = Math.max( MIN_SCALE, Math.min( ( size.w - pad * 2 ) / worldW, ( size.h - pad * 2 ) / worldH, 1.1 ) );
    setView( { scale: s, x: ( size.w - worldW * s ) / 2, y: Math.max( pad, ( size.h - worldH * s ) / 2 ) } );
  }, [ size, worldW, worldH ] );
  useEffect( () => { fit(); }, [ fit ] );

  // Non-passive so the page doesn't scroll under a zoom/pan gesture; React's
  // onWheel is passive, which is why this is attached by hand.
  useEffect( () => {
    const el = wrapRef.current;
    if ( ! el ) return undefined;
    const onWheel = ( e ) => {
      e.preventDefault();
      // Ctrl/Cmd + wheel → zoom toward the cursor. Shift + wheel → pan sideways.
      // Plain wheel → pan (and sideways too on trackpads that send deltaX).
      if ( e.ctrlKey || e.metaKey ) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        setView( ( p ) => {
          const scale = Math.min( MAX_SCALE, Math.max( MIN_SCALE, + ( p.scale * ( e.deltaY < 0 ? 1.1 : 1 / 1.1 ) ).toFixed( 3 ) ) );
          const k = scale / p.scale;
          return { scale, x: px - ( px - p.x ) * k, y: py - ( py - p.y ) * k };
        } );
      } else if ( e.shiftKey ) {
        const dx = e.deltaX || e.deltaY;
        setView( ( p ) => ( { ...p, x: p.x - dx } ) );
      } else {
        setView( ( p ) => ( { ...p, x: p.x - ( e.deltaX || 0 ), y: p.y - e.deltaY } ) );
      }
    };
    el.addEventListener( 'wheel', onWheel, { passive: false } );
    return () => el.removeEventListener( 'wheel', onWheel );
  }, [] );

  useEffect( () => {
    const onFsChange = () => setFs( document.fullscreenElement === wrapRef.current );
    document.addEventListener( 'fullscreenchange', onFsChange );
    return () => document.removeEventListener( 'fullscreenchange', onFsChange );
  }, [] );

  const toggleFs = () => {
    const el = wrapRef.current;
    if ( ! el ) return;
    if ( document.fullscreenElement ) {
      if ( document.exitFullscreen ) document.exitFullscreen();
    } else if ( el.requestFullscreen ) {
      el.requestFullscreen();
    }
  };

  const zoomBy = ( dir ) => setView( ( p ) => {
    const scale = Math.min( MAX_SCALE, Math.max( MIN_SCALE, + ( p.scale * ( dir > 0 ? 1.15 : 1 / 1.15 ) ).toFixed( 3 ) ) );
    const cx = size.w / 2;
    const cy = size.h / 2;
    const k = scale / p.scale;
    return { scale, x: cx - ( cx - p.x ) * k, y: cy - ( cy - p.y ) * k };
  } );

  const startNodeDrag = ( key, e ) => {
    const cur = nodePos[ key ] || ZERO;
    nodeDragRef.current = { key, sx: e.clientX, sy: e.clientY, ox: cur.dx, oy: cur.dy, moved: false };
    setDragging( true );
  };

  const onDown = ( e ) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    setDragging( true );
  };
  const onMove = ( e ) => {
    if ( nodeDragRef.current ) {
      const d = nodeDragRef.current;
      if ( Math.abs( e.clientX - d.sx ) + Math.abs( e.clientY - d.sy ) > 4 ) d.moved = true;
      const dx = d.ox + ( e.clientX - d.sx ) / view.scale;
      const dy = d.oy + ( e.clientY - d.sy ) / view.scale;
      setNodePos( ( p ) => ( { ...p, [ d.key ]: { dx, dy } } ) );
      return;
    }
    if ( ! dragRef.current ) return;
    const d = dragRef.current;
    setView( ( p ) => ( { ...p, x: d.ox + ( e.clientX - d.sx ), y: d.oy + ( e.clientY - d.sy ) } ) );
  };
  const onUp = () => {
    if ( nodeDragRef.current ) {
      const d = nodeDragRef.current;
      nodeDragRef.current = null;
      setDragging( false );
      // A press that never moved is a click, and opens the slot.
      if ( ! d.moved ) setOpenKey( d.key );
      return;
    }
    dragRef.current = null;
    setDragging( false );
  };

  const doCreate = ( slot ) => {
    // Mirrors the grid's create(): a type this build doesn't ship goes to
    // pricing, not to tb_create, which would reject it as an invalid template
    // type and show a validation error where an upgrade prompt belongs.
    if ( slotIsPro( slot ) ) {
      openUpgrade( `canvas-${ slot.type }` );
      return;
    }
    setBusy( true );
    tbAjax( 'tb_create', { tpl_type: slot.type, target: slot.target } )
      .then( ( tpl ) => { if ( tpl && tpl.editUrl ) window.open( tpl.editUrl, '_blank', 'noreferrer' ); load(); } )
      .catch( ( e ) => setError( ( e && e.message ) || __( 'Could not create the template.', 'uichemy' ) ) )
      .finally( () => setBusy( false ) );
  };
  const [ condTpl, setCondTpl ] = useState( null );
  const doStatus = ( tpl, status ) => { tbAjax( 'tb_set_status', { id: tpl.id, status } ).then( load ).catch( load ); };
  const doDelete = ( tpl ) => { tbAjax( 'tb_delete', { id: tpl.id } ).then( load ).catch( load ); };

  const openSlot = ( arch && openKey ) ? ( arch.slots || [] ).find( ( s ) => s.key === openKey ) : null;

  /* Minimap */
  const mmW = 176;
  const mmH = 120;
  const mmPad = 6;
  const mmScale = Math.min( ( mmW - mmPad * 2 ) / worldW, ( mmH - mmPad * 2 ) / worldH );
  const vpX = -view.x / view.scale;
  const vpY = -view.y / view.scale;

  /* The flow lines are GREY, not brand orange. A filled edge used to draw in
     `--uc-brand`, so on a full graph the accent repeated on every connection and
     became the loudest thing on the canvas — the cards it links are the content.
     Grey at low opacity lets the lines do their one job (showing what hangs off
     what) and stay behind the cards.
     `--uc-danger` survives for a critical slot with nothing in it, because that
     line is a signal rather than structure. */
  const edgeStroke = ( e ) => (
    e.missing ? 'var(--uc-danger)' : 'var(--uc-text-muted)'
  );

  return (
    <div
      ref={ wrapRef }
      className={ `tb-cv${ fs ? ' tb-cv--fs' : '' }${ dragging ? ' tb-cv--grabbing' : '' }` }
      onMouseDown={ onDown }
      onMouseMove={ onMove }
      onMouseUp={ onUp }
      onMouseLeave={ onUp }
      onDoubleClick={ toggleFs }
    >
      { error ? <div className="tb-cv__error">{ error }</div> : null }
      { ! graph && ! error ? (
        <div className="tb-cv__loading">{ __( 'Loading site map…', 'uichemy' ) }</div>
      ) : null }

      { graph ? (
        <div
          className="tb-cv__world"
          style={ { transform: `translate(${ view.x }px, ${ view.y }px) scale(${ view.scale })`, width: worldW, height: worldH } }
        >
          <svg className="tb-cv__edges" width={ worldW } height={ worldH }>
            { graph.edges.map( ( e ) => {
              const o = e.nodeKey ? ( nodePos[ e.nodeKey ] || ZERO ) : ZERO;
              const x2 = e.x2 + o.dx;
              const y2 = e.y2 + o.dy;
              const my = ( e.y1 + y2 ) / 2;
              return (
                <path
                  key={ e.id }
                  d={ `M ${ e.x1 } ${ e.y1 } C ${ e.x1 } ${ my }, ${ x2 } ${ my }, ${ x2 } ${ y2 }` }
                  fill="none"
                  stroke={ edgeStroke( e ) }
                  strokeWidth={ e.hub ? 1.4 : 1.2 }
                  strokeDasharray={ e.empty ? '4 4' : '0' }
                  /* Thinner and quieter, now the colour no longer carries the
                     emphasis. The dashed empty edges keep the HIGHEST of the
                     three values: a broken line reads lighter than a solid one at
                     the same opacity, so matching them would make the empty slots
                     the faintest thing rather than the clearest gap. */
                  opacity={ e.hub ? 0.4 : e.empty ? 0.55 : 0.45 }
                />
              );
            } ) }
          </svg>

          { graph.nodes.map( ( nd ) => {
            if ( nd.kind === 'hub' ) {
              return (
                <div key={ nd.id } className="tb-cv__hub" style={ { left: nd.x, top: nd.y, width: HUB_W, height: HUB_H } }>
                  <span className="tb-cv__hub-name">{ nd.site.name || __( 'Your site', 'uichemy' ) }</span>
                  { nd.site.url ? <span className="tb-cv__hub-url">{ nd.site.url }</span> : null }
                  <span className="tb-cv__hub-gaps">
                    { nd.gaps > 0
                      ? sprintf( nd.gaps > 1 ? __( '%d slots missing', 'uichemy' ) : __( '%d slot missing', 'uichemy' ), nd.gaps )
                      : __( 'All key slots filled', 'uichemy' ) }
                  </span>
                  {/* Root parent: one handle, at the bottom edge its group edges
                      leave from. Same rule as the cards and the group nodes. */}
                  <span className="tb-cv__handle tb-cv__handle--out tb-cv__handle--on-brand" aria-hidden="true" />
                </div>
              );
            }

            if ( nd.kind === 'cat' ) {
              const CatIcon = nd.cat.icon;
              return (
                <div key={ nd.id } className="tb-cv__cat" style={ { left: nd.x, top: nd.y, width: CAT_W, height: CAT_H } }>
                  <span className="tb-cv__cat-ic"><CatIcon size={ 15 } /></span>
                  <span className="tb-cv__cat-label">{ nd.cat.label }</span>
                  { nd.total > 0 ? (
                    <Badge variant="outline" tone="neutral" className="tb-cv__cat-count">{ nd.built }/{ nd.total }</Badge>
                  ) : null }
                  { nd.pro > 0 ? (
                    <Badge
                      variant="outline"
                      tone="neutral"
                      className="tb-cv__cat-pro"
                      title={ sprintf( nd.pro > 1 ? __( '%d slots available in UiChemy Pro', 'uichemy' ) : __( '%d slot available in UiChemy Pro', 'uichemy' ), nd.pro ) }
                    >
                      <Icon.Crown size={ 9 } />{ nd.pro }
                    </Badge>
                  ) : null }
                  {/* Parent handle, bottom edge — where this group's edges to its
                      slot cards leave. */}
                  <span className="tb-cv__handle tb-cv__handle--out" aria-hidden="true" />
                </div>
              );
            }

            const o = nodePos[ nd.slot.key ] || ZERO;
            return <SlotCard key={ nd.id } slot={ nd.slot } catKey={ nd.catKey } x={ nd.x + o.dx } y={ nd.y + o.dy } onDragStart={ startNodeDrag } />;
          } ) }
        </div>
      ) : null }

      { openSlot ? (
        <SlotModal
          slot={ openSlot }
          busy={ busy }
          onClose={ () => setOpenKey( null ) }
          onCreate={ doCreate }
          onStatus={ doStatus }
          onDelete={ doDelete }
          onConditions={ setCondTpl }
        />
      ) : null }

      {/* Same dialog the grid and the block editor open — one conditions editor,
          one write path. Rendered outside SlotModal so saving does not depend on
          that modal staying mounted. */}
      { condTpl ? (
        <ConditionsDialog
          tpl={ condTpl }
          onClose={ () => setCondTpl( null ) }
          onSaved={ () => { setCondTpl( null ); load(); } }
        />
      ) : null }

      <button
        type="button"
        className="tb-cv__fs"
        title={ fs ? __( 'Exit full screen', 'uichemy' ) : __( 'Full screen', 'uichemy' ) }
        onMouseDown={ ( e ) => e.stopPropagation() }
        onClick={ toggleFs }
      >
        { fs ? <ShrinkIcon size={ 14 } /> : <ExpandIcon size={ 14 } /> }
        { fs ? __( 'Exit', 'uichemy' ) : __( 'Full screen', 'uichemy' ) }
      </button>

      <div className="tb-cv__zoom">
        <button type="button" title={ __( 'Zoom in', 'uichemy' ) } onMouseDown={ ( e ) => e.stopPropagation() } onClick={ () => zoomBy( 1 ) }><PlusIcon size={ 15 } /></button>
        <button type="button" title={ __( 'Zoom out', 'uichemy' ) } onMouseDown={ ( e ) => e.stopPropagation() } onClick={ () => zoomBy( -1 ) }><MinusIcon size={ 15 } /></button>
        <button type="button" title={ __( 'Fit to screen', 'uichemy' ) } onMouseDown={ ( e ) => e.stopPropagation() } onClick={ fit }><FitIcon size={ 15 } /></button>
      </div>

      { graph ? (
        <div className="tb-cv__mini" style={ { width: mmW, height: mmH } }>
          <svg width={ mmW } height={ mmH }>
            <g transform={ `translate(${ mmPad }, ${ mmPad }) scale(${ mmScale })` }>
              { graph.nodes.map( ( nd ) => {
                const w = nd.kind === 'hub' ? HUB_W : nd.kind === 'cat' ? CAT_W : CARD_W;
                const h = nd.kind === 'hub' ? HUB_H : nd.kind === 'cat' ? CAT_H : CARD_H;
                // Opacity rather than the -soft token variants: those sit close
                // to the card background, which would leave the minimap blank.
                let fill = 'var(--uc-text-subtle)';
                let alpha = 0.3;
                if ( nd.kind === 'hub' ) { fill = 'var(--uc-brand)'; alpha = 1; }
                else if ( nd.kind === 'cat' ) { fill = 'var(--uc-brand)'; alpha = 0.55; }
                else if ( nd.slot.filled ) { fill = 'var(--uc-brand)'; alpha = 0.45; }
                else if ( nd.slot.critical && ! slotIsPro( nd.slot ) ) { fill = 'var(--uc-danger)'; alpha = 0.5; }
                const o = nd.kind === 'slot' ? ( nodePos[ nd.slot.key ] || ZERO ) : ZERO;
                return <rect key={ nd.id } x={ nd.x + o.dx } y={ nd.y + o.dy } width={ w } height={ h } rx="10" fill={ fill } fillOpacity={ alpha } />;
              } ) }
              <rect
                x={ vpX } y={ vpY }
                width={ size.w / view.scale } height={ size.h / view.scale }
                fill="none" stroke="var(--uc-brand)" strokeWidth={ 2 / mmScale } rx={ 6 }
              />
            </g>
          </svg>
        </div>
      ) : null }
    </div>
  );
}
