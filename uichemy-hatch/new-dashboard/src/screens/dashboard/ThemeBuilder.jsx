import React, { useState, useRef, useEffect, useCallback } from 'react';
import { __, _n, sprintf } from '@wordpress/i18n';
import ScreenHead from '../../components/ScreenHead.jsx';
import * as Icon from '../../components/icons.jsx';
import {
  Button, Badge, Card, Input, Label, Skeleton, Alert, Switch,
  Select, SelectValue, SelectTrigger, SelectContent, SelectItem,
  Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator,
  Tabs, TabsList, TabsTrigger,
  Dialog, DialogContent, DialogCard, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter, DialogClose,
  Tooltip,
} from '../../design-system';
// Same backend as the island version, only the UI is rebuilt on our design
// system. All data flows through the uichemy_theme_builder admin-ajax endpoint.
import { data, tbAjax } from '../../uichemy-composer/admin/data.js';
import CanvasView from './ThemeBuilderCanvas.jsx';
import { ConditionsDialog, conditionSummary } from './ThemeBuilderConditions.jsx';

/* ── Native pro-gating (was pro.jsx in the Tailwind island) ──────────────────
   Reads the same PHP-localized flags on window.uichemyDashboard, so PHP stays
   the single source of truth for which types are Pro. */
const isPro = () => !! data.isPro;
const upgradeUrl = () => data.upgradeUrl || 'https://uichemy.com/pricing/';
const proTypes = () => ( Array.isArray( data.proTypes ) ? data.proTypes : [] );
const isTypeLocked = ( type ) => ! isPro() && proTypes().indexOf( type ) !== -1;
const openUpgrade = ( source ) => {
  const base = upgradeUrl();
  const href = source ? `${ base }${ base.indexOf( '?' ) === -1 ? '?' : '&' }utm_content=${ encodeURIComponent( source ) }` : base;
  window.open( href, '_blank', 'noopener' );
};
/** True when the upsell took over a create() for a locked type. */
const upsellForType = ( type ) => { if ( ! isTypeLocked( type ) ) return false; openUpgrade( `theme-builder-${ type }` ); return true; };

/* ── Local aliases to the shared Hugeicons set (keeps call sites unchanged) ─ */
const MoreIcon  = Icon.MoreVertical;   // kebab (vertical 3 dots) card menu trigger
const PlusIcon  = Icon.Plus;
const MinusIcon = Icon.Minus;
const TrashIcon = Icon.Trash;
const EyeIcon   = Icon.Eye;
const EditIcon  = Icon.Edit;
const CloseIcon = Icon.Close;
const ExtIcon   = Icon.ExtLink;

const TYPES = [
  { key: 'header',          label: __( 'Header', 'uichemy' ),            icon: Icon.LayoutTop },
  { key: 'footer',          label: __( 'Footer', 'uichemy' ),            icon: Icon.LayoutBottom },
  { key: 'single',          label: __( 'Single (Post / Page)', 'uichemy' ), icon: Icon.FileDoc },
  { key: 'archive',         label: __( 'Archive', 'uichemy' ),           icon: Icon.Archive },
  { key: 'single_product',  label: __( 'Single Product', 'uichemy' ),    woo: true, icon: Icon.Tag },
  { key: 'product_archive', label: __( 'Products Archive', 'uichemy' ),  woo: true, icon: Icon.Store },
  { key: 'search',          label: __( 'Search Results', 'uichemy' ),    icon: Icon.Search },
  { key: 'error_404',       label: __( '404 Page', 'uichemy' ),          icon: Icon.Warn },
];
const CONDITION_TYPES = [ 'header', 'footer', 'single', 'archive' ];
const LABEL_BY_TYPE = Object.fromEntries( TYPES.map( ( t ) => [ t.key, t.label ] ) );
const TYPE_BY_KEY = Object.fromEntries( TYPES.map( ( t ) => [ t.key, t ] ) );
const EMPTY_TEMPLATES = Object.fromEntries( TYPES.map( ( t ) => [ t.key, [] ] ) );

/**
 * Full-size preview of one template, rendered on a clean page in an iframe.
 *
 * Everything lives inside a single DialogCard: the DS tray only pads 4px, so a
 * header dropped straight into it sits flush against the dialog edge. The card
 * is what gives the modal its even gutter, the same one the frame gets.
 *
 * `showClose={false}` turns off the DS close button, which is positioned
 * OUTSIDE the dialog's top-right corner. On a modal this wide it lands away
 * from the content it closes, so the dismiss control is rendered in the header
 * bar instead, next to the "Open in a new tab" action.
 *
 * The frame renders a skeleton until the iframe fires `load`. A template page
 * is a full WordPress request, theme, assets, the lot, so the frame is blank
 * for a beat, and a bare white rectangle reads as "the preview is broken".
 * `aria-describedby={undefined}` is required: Radix warns when a Dialog has no
 * DialogDescription, and this one deliberately has none.
 */
function PreviewDialog( { tpl, onClose } ) {
  const [ loaded, setLoaded ] = useState( false );

  // Safety net: `load` never fires if the request hangs. Reveal the frame
  // anyway rather than shimmering forever with no way to see what happened.
  useEffect( () => {
    const t = setTimeout( () => setLoaded( true ), 10000 );
    return () => clearTimeout( t );
  }, [] );

  return (
    <Dialog open onOpenChange={ ( v ) => { if ( ! v ) onClose(); } }>
      <DialogContent className="tb-dlg tb-dlg--preview" showClose={ false } aria-describedby={ undefined }>
        <DialogCard className="tb-preview">
          <div className="tb-preview__bar">
            <DialogHeader className="tb-preview__head">
              <DialogTitle className="tb-preview__title">
                { sprintf( __( 'Preview, %s', 'uichemy' ), tpl.title || __( '(untitled)', 'uichemy' ) ) }
              </DialogTitle>
            </DialogHeader>
            <div className="tb-preview__acts">
              <Button
                variant="outline"
                tone="neutral"
                size="sm"
                onClick={ () => window.open( tpl.previewUrl, '_blank', 'noopener' ) }
              >
                <ExtIcon size={ 13 } /> { __( 'Open in a new tab', 'uichemy' ) }
              </Button>
              <DialogClose asChild>
                <Button variant="ghost" tone="neutral" size="sm" iconOnly aria-label={ __( 'Close preview', 'uichemy' ) }>
                  <CloseIcon size={ 15 } />
                </Button>
              </DialogClose>
            </div>
          </div>
          <div className={ `tb-preview-frame${ loaded ? '' : ' tb-preview-frame--loading' }` }>
            { ! loaded ? (
              <div className="tb-preview__skel">
                <div className="tb-preview__skel-bar">
                  <Skeleton className="tb-preview__skel-logo" />
                  <div className="tb-preview__skel-navs">
                    <Skeleton className="tb-preview__skel-nav" />
                    <Skeleton className="tb-preview__skel-nav" />
                    <Skeleton className="tb-preview__skel-cta" />
                  </div>
                </div>
                <Skeleton className="tb-preview__skel-hero" />
                <div className="tb-preview__skel-grid">
                  <Skeleton className="tb-preview__skel-tile" />
                  <Skeleton className="tb-preview__skel-tile" />
                  <Skeleton className="tb-preview__skel-tile" />
                </div>
              </div>
            ) : null }
            <iframe
              title={ __( 'Template preview', 'uichemy' ) }
              src={ tpl.previewUrl }
              onLoad={ () => setLoaded( true ) }
            />
          </div>
        </DialogCard>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog( { tpl, onCancel, onConfirm } ) {
  return (
    <Dialog open onOpenChange={ ( v ) => { if ( ! v ) onCancel(); } }>
      <DialogContent className="tb-dlg">
        <DialogCard className="tb-dlg__card">
          <DialogHeader>
            <DialogTitle>{ __( 'Delete this template?', 'uichemy' ) }</DialogTitle>
            <DialogDescription>
              <b>“{ tpl.title || __( 'This template', 'uichemy' ) }”</b> { __( 'will be permanently deleted. This can’t be undone. It does not go to Trash.', 'uichemy' ) }
            </DialogDescription>
          </DialogHeader>
        </DialogCard>
        <DialogFooter>
          <Button variant="outline" tone="neutral" onClick={ onCancel }>{ __( 'Cancel', 'uichemy' ) }</Button>
          <Button variant="solid" tone="danger" onClick={ onConfirm }><TrashIcon size={ 14 } /> { __( 'Delete permanently', 'uichemy' ) }</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Zoomed-out live preview thumbnail (iframe scaled to card width).
function ScaledPreview( { url, title, IconEl } ) {
  const boxRef = useRef( null );
  const [ scale, setScale ] = useState( 0.22 );
  const BASE_W = 1440;
  useEffect( () => {
    if ( ! boxRef.current || typeof ResizeObserver === 'undefined' ) return undefined;
    const el = boxRef.current;
    const ro = new ResizeObserver( () => { const w = el.clientWidth; if ( w ) setScale( w / BASE_W ); } );
    ro.observe( el );
    return () => ro.disconnect();
  }, [] );
  return (
    <div ref={ boxRef } className="tb-thumb">
      { url ? (
        <>
          <iframe title={ title || __( 'Template preview', 'uichemy' ) } src={ url } loading="lazy" tabIndex={ -1 } scrolling="no"
            style={ { width: BASE_W, height: Math.round( BASE_W * 0.75 ), transform: `scale(${ scale })`, transformOrigin: 'top left', border: 0, pointerEvents: 'none' } } />
          <div className="tb-thumb__fade" />
        </>
      ) : (
        <div className="tb-thumb__empty">
          <span className="tb-thumb__ic">{ IconEl ? <IconEl size={ 20 } /> : <Icon.Layout size={ 20 } /> }</span>
          <span>{ __( 'No preview', 'uichemy' ) }</span>
        </div>
      ) }
    </div>
  );
}

// Type filter pills.
function TypeTabs( { active, onSelect } ) {
  const tabs = [ { key: 'all', label: __( 'All', 'uichemy' ) }, ...TYPES ];
  return (
    <div className="tb-typetabs">
      { tabs.map( ( f ) => (
        <button key={ f.key } type="button" onClick={ () => onSelect( f.key ) } className={ `tb-typetab${ active === f.key ? ' is-on' : '' }` }>
          { f.label }
          { isTypeLocked( f.key ) ? <Icon.Crown size={ 12 } className="tb-typetab__crown" /> : null }
        </button>
      ) ) }
    </div>
  );
}

/**
 * Copy text, resolving true/false so the caller can show what happened.
 *
 * navigator.clipboard needs a secure context, and plenty of WordPress installs
 * are plain http on a LAN — so the execCommand path is not legacy cruft here, it
 * is the branch that actually runs on those sites.
 */
function copyText( text ) {
  try {
    if ( navigator.clipboard && window.isSecureContext ) {
      return navigator.clipboard.writeText( text ).then( () => true ).catch( () => false );
    }
  } catch ( e ) { /* fall through to the textarea path */ }
  try {
    const ta = document.createElement( 'textarea' );
    ta.value = text;
    ta.setAttribute( 'readonly', '' );
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild( ta );
    ta.select();
    const ok = document.execCommand( 'copy' );
    document.body.removeChild( ta );
    return Promise.resolve( !! ok );
  } catch ( e ) {
    return Promise.resolve( false );
  }
}

function GridCard( { tpl, typeLabel, onToggle, onDelete, onConditions, onPreview, onEditElementor } ) {
  // Copy confirmation is per-card and momentary, so it lives here rather than in
  // the screen's state — nothing outside this card cares that it happened.
  const [ copied, setCopied ] = useState( false );
  const copyTimer = useRef( null );
  useEffect( () => () => window.clearTimeout( copyTimer.current ), [] );
  const onCopyShortcode = ( t ) => {
    copyText( t.shortcode || '' ).then( ( ok ) => {
      if ( ! ok ) return;
      setCopied( true );
      window.clearTimeout( copyTimer.current );
      copyTimer.current = window.setTimeout( () => setCopied( false ), 2000 );
    } );
  };
  const isGutenberg = tpl.editor === 'gutenberg';
  const t = TYPE_BY_KEY[ tpl.type ] || {};
  const IconEl = t.icon || Icon.Layout;
  const isActive = tpl.status === 'active';
  const editorLabel = isGutenberg ? 'Gutenberg' : 'Elementor';
  const isConditionType = CONDITION_TYPES.includes( tpl.type );
  const hasTarget = isConditionType && tpl.targetLabel && ( tpl.type === 'single' || tpl.type === 'archive' );
  const condSummary = conditionSummary( tpl );
  return (
    <Card className="tb-card">
      {/* White content panel floating on the grey card tray (reference layering). */}
      <div className="tb-card__inner">
      {/* Identity row: type-icon avatar + title, menu at the end. No type blurb:
          it repeated on every card of a type and said nothing about THIS
          template — the type is already carried by the avatar icon and the pills
          below. */}
      <div className="tb-card__top">
        <span className="tb-card__avatar"><IconEl size={ 16 } /></span>
        <div className="tb-card__titles">
          <p className="tb-card__title">{ tpl.title || __( '(untitled)', 'uichemy' ) }</p>
        </div>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" tone="neutral" size="sm" iconOnly aria-label={ __( 'More actions', 'uichemy' ) }><MoreIcon size={ 16 } /></Button>
          </MenuTrigger>
          <MenuContent align="end">
            { isGutenberg ? <MenuItem onSelect={ () => onEditElementor( tpl ) }><Icon.Terminal size={ 14 } /> { __( 'Edit in Elementor', 'uichemy' ) }</MenuItem> : null }
            {/* Drops the template anywhere shortcodes run, for the cases its own
                location + conditions cannot express. */}
            { tpl.shortcode ? (
              <MenuItem onSelect={ () => onCopyShortcode( tpl ) }>
                <Icon.Copy size={ 14 } /> { copied ? __( 'Shortcode copied', 'uichemy' ) : __( 'Copy shortcode', 'uichemy' ) }
              </MenuItem>
            ) : null }
            {/* Preview lived in the footer until the conditions button took that
                slot. Kept here rather than dropped: it is the only way to see the
                template rendered on a clean page. */}
            <MenuItem onSelect={ () => onPreview( tpl ) }><EyeIcon size={ 14 } /> { __( 'Preview', 'uichemy' ) }</MenuItem>
            {/* No Activate / Deactivate here: the pill row above carries the status
                SWITCH, and the same action in two places invites them to disagree. */}
            <MenuSeparator />
            <MenuItem onSelect={ () => onDelete( tpl ) } className="tb-menu__danger"><TrashIcon size={ 14 } /> { __( 'Delete', 'uichemy' ) }</MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {/* Status + editor pills, with a status dot (reference-style pill row). */}
      <div className="tb-card__pills">
        {/* The status is the CONTROL now, not a read-only pill — activating used to
            be buried in the ⋯ menu, two clicks away from the state it changed.
            onToggle already deactivates any sibling of the same type (only one
            template can own a slot) and rolls back by reloading on failure. */}
        <label className={ `tb-status-switch tb-status-switch--${ isActive ? 'on' : 'off' }` }>
          <Switch
            size="sm"
            checked={ isActive }
            onCheckedChange={ ( v ) => onToggle( tpl, v ? 'active' : 'inactive' ) }
            aria-label={ sprintf(
              /* translators: %s: template title */
              isActive ? __( 'Deactivate %s', 'uichemy' ) : __( 'Activate %s', 'uichemy' ),
              tpl.title || typeLabel
            ) }
          />
        </label>
        <Badge tone="neutral" variant="soft">{ editorLabel }</Badge>
        { hasTarget ? <Badge tone="neutral" variant="soft">{ tpl.targetLabel }</Badge> : null }
      </div>

      {/* Compact live preview. */}
      <div className="tb-card__thumb">
        <ScaledPreview url={ tpl.previewUrl } title={ tpl.title } IconEl={ t.icon } />
      </div>
      </div>

      {/* Footer action row: Edit carries the row, with display conditions beside it
          as an icon. Conditions were two clicks deep in the kebab menu and
          invisible until opened — as an icon with the rules on hover they can be
          read without opening anything. */}
      <div className="tb-card__foot">
        <Button variant="outline" tone="neutral" className="tb-card__fbtn" asChild>
          <a href={ tpl.editUrl } target="_blank" rel="noreferrer"><EditIcon size={ 14 } /> { __( 'Edit', 'uichemy' ) }</a>
        </Button>
        { isConditionType ? (
          <Tooltip
            content={
              <span className="tb-cond-tip">
                <span className="tb-cond-tip__head">
                  { sprintf(
                    /* translators: %d: number of display conditions in force. */
                    _n( '%d display condition', '%d display conditions', condSummary.length, 'uichemy' ),
                    condSummary.length
                  ) }
                </span>
                { condSummary.map( ( c2, i ) => (
                  <span key={ i } className="tb-cond-tip__row">
                    <span className={ `tb-cond-tip__match tb-cond-tip__match--${ c2.match }` }>
                      { c2.match === 'exclude' ? __( 'Exclude', 'uichemy' ) : __( 'Include', 'uichemy' ) }
                    </span>
                    { c2.label }
                  </span>
                ) ) }
              </span>
            }
          >
            <Button
              variant="outline"
              tone="neutral"
              className="tb-card__fbtn"
              onClick={ () => onConditions( tpl ) }
              aria-label={ __( 'Display conditions', 'uichemy' ) }
            >
              <Icon.Sliders size={ 15 } /> { __( 'Conditions', 'uichemy' ) }
            </Button>
          </Tooltip>
        ) : null }
      </div>
    </Card>
  );
}

export default function ThemeBuilder() {
  const [ templates, setTemplates ] = useState( EMPTY_TEMPLATES );
  const [ view, setView ] = useState( 'grid' );
  const [ gridType, setGridType ] = useState( 'all' );
  const [ env, setEnv ] = useState( null );
  const [ loading, setLoading ] = useState( true );
  const [ error, setError ] = useState( '' );
  const [ creating, setCreating ] = useState( '' );
  const [ condTpl, setCondTpl ] = useState( null );
  const [ previewTpl, setPreviewTpl ] = useState( null );
  const [ deleteTpl, setDeleteTpl ] = useState( null );

  const reload = useCallback( ( opts = {} ) => {
    const silent = !! ( opts && opts.silent );
    if ( ! silent ) setLoading( true );
    return tbAjax( 'tb_list' )
      .then( ( d ) => { setTemplates( { ...EMPTY_TEMPLATES, ...( d.templates || {} ) } ); setEnv( d.env || null ); setError( '' ); } )
      .catch( ( e ) => setError( ( e && e.message ) || __( 'Failed to load templates.', 'uichemy' ) ) )
      .finally( () => { if ( ! silent ) setLoading( false ); } );
  }, [] );
  useEffect( () => { reload(); }, [ reload ] );

  const conflictLabel = ( c ) => ( c === 'elementor_pro' ? 'Elementor Pro' : c === 'nexter' ? 'Nexter' : c );

  const create = ( type ) => {
    if ( upsellForType( type ) ) return;
    setCreating( type );
    tbAjax( 'tb_create', { tpl_type: type } )
      .then( ( tpl ) => {
        if ( tpl && tpl.editUrl ) {
          // Mark THIS editor tab as "just created" so it offers Edit Condition
          // once. Only here, never on the card's own Edit link: the flag is what
          // separates "I just made this, where does it go?" from every later
          // visit. PHP reads it, and the launcher strips it from the address bar
          // so a refresh drops the offer.
          const sep = tpl.editUrl.indexOf( '?' ) === -1 ? '?' : '&';
          const url = CONDITION_TYPES.includes( tpl.type || type )
            ? `${ tpl.editUrl }${ sep }uich_tb_new=1`
            : tpl.editUrl;
          window.open( url, '_blank', 'noreferrer' );
        }
        reload( { silent: true } );
      } )
      .catch( ( e ) => setError( ( e && e.message ) || __( 'Could not create template.', 'uichemy' ) ) )
      .finally( () => setCreating( '' ) );
  };
  const editWithElementor = ( tpl ) => {
    tbAjax( 'tb_set_editor', { id: tpl.id, editor: 'elementor' } )
      .then( ( updated ) => { if ( updated && updated.elementorUrl ) window.open( updated.elementorUrl, '_blank', 'noreferrer' ); reload( { silent: true } ); } )
      .catch( () => reload( { silent: true } ) );
  };
  const toggle = ( tpl, status ) => {
    setTemplates( ( prev ) => ( {
      ...prev,
      [ tpl.type ]: prev[ tpl.type ].map( ( t ) => {
        if ( t.id === tpl.id ) return { ...t, status };
        return status === 'active' ? { ...t, status: 'inactive' } : t;
      } ),
    } ) );
    tbAjax( 'tb_set_status', { id: tpl.id, status } ).then( () => reload( { silent: true } ) ).catch( () => reload( { silent: true } ) );
  };
  const confirmDelete = () => {
    const tpl = deleteTpl;
    if ( ! tpl ) return;
    setDeleteTpl( null );
    setTemplates( ( prev ) => ( { ...prev, [ tpl.type ]: prev[ tpl.type ].filter( ( t ) => t.id !== tpl.id ) } ) );
    tbAjax( 'tb_delete', { id: tpl.id } ).then( () => reload( { silent: true } ) ).catch( () => reload( { silent: true } ) );
  };
  const onConditionsSaved = ( updated ) => {
    setTemplates( ( prev ) => ( { ...prev, [ updated.type ]: prev[ updated.type ].map( ( t ) => ( t.id === updated.id ? updated : t ) ) } ) );
  };

  const viewToggle = (
    <Tabs variant="pill" size="sm" value={ view } onValueChange={ ( v ) => v && setView( v ) }>
      <TabsList>
        <TabsTrigger value="grid"><Icon.Grid size={ 14 } /> { __( 'Grid', 'uichemy' ) }</TabsTrigger>
        <TabsTrigger value="canvas"><Icon.Layout size={ 14 } /> { __( 'Canvas', 'uichemy' ) }</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const flatAll = TYPES.flatMap( ( t ) => templates[ t.key ] || [] );
  const items = gridType === 'all' ? flatAll : ( templates[ gridType ] || [] );
  const activeType = TYPES.find( ( t ) => t.key === gridType );
  const activeLocked = activeType && isTypeLocked( activeType.key );

  return (
    <div className="dash tb">
      <ScreenHead
        title={ __( 'Theme Builder', 'uichemy' ) }
        subtitle={ __( 'Build and manage your site’s templates with UiChemy.', 'uichemy' ) }
        action={ viewToggle }
      />

      <div className="tb-body">
        { error ? <Alert tone="danger" className="tb-alert">{ error }</Alert> : null }
        { env && ! env.headerFooterSupported ? (
          <Alert tone="warning" className="tb-alert">
            <b>{ __( 'Heads up:', 'uichemy' ) }</b> { __( 'your active theme doesn’t expose header/footer locations, so Header and Footer templates may not appear on the front end. Single and 404 templates work on any theme.', 'uichemy' ) }
          </Alert>
        ) : null }
        { env && env.conflicts && env.conflicts.length > 0 ? (
          <Alert tone="warning" className="tb-alert">
            <b>{ __( 'Another theme builder is active', 'uichemy' ) }</b> ({ env.conflicts.map( conflictLabel ).join( ', ' ) }). { __( 'Avoid activating a UiChemy header/footer at the same time to prevent a duplicate.', 'uichemy' ) }
          </Alert>
        ) : null }

        { view === 'grid' ? (
          <div className="tb-grid-wrap">
            <div className="tb-toolbar">
              <TypeTabs active={ gridType } onSelect={ setGridType } />
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="solid" tone="brand" size="sm" disabled={ !! creating }>
                    <PlusIcon size={ 13 } /> { creating ? __( 'Creating…', 'uichemy' ) : __( 'Add New', 'uichemy' ) } <Icon.ChevD size={ 13 } />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  { TYPES.map( ( t ) => (
                    <MenuItem key={ t.key } onSelect={ () => create( t.key ) } className={ isTypeLocked( t.key ) ? 'tb-menu__locked' : '' }>
                      { t.label }{ isTypeLocked( t.key ) ? <Icon.Crown size={ 12 } className="tb-menu__crown" /> : null }
                    </MenuItem>
                  ) ) }
                </MenuContent>
              </Menu>
            </div>

            { activeLocked ? (
              <div className="tb-lockpanel">
                <span className="tb-lockpanel__ic"><Icon.Crown size={ 20 } /></span>
                <div className="tb-lockpanel__body">
                  <b>{ sprintf( __( 'Unlock %s templates', 'uichemy' ), activeType.label ) }</b>
                  <p>{ sprintf( __( '%s templates are part of UiChemy Pro, upgrade to design and use them on your site.', 'uichemy' ), activeType.label ) }</p>
                </div>
                <Button variant="solid" tone="brand" size="sm" onClick={ () => openUpgrade( `theme-builder-${ activeType.key }` ) }><Icon.Crown size={ 13 } /> { __( 'Upgrade to Pro', 'uichemy' ) }</Button>
              </div>
            ) : null }

            { activeType && activeType.woo && ! activeLocked && env && ! env.woocommerce ? (
              <p className="tb-hint">{ __( 'Renders only when WooCommerce is active. You can design it now.', 'uichemy' ) }</p>
            ) : null }

            { loading ? (
              <div className="tb-grid">
                { [ 0, 1, 2 ].map( ( k ) => (
                  <div key={ k } className="tb-card tb-card--skel">
                    <Skeleton className="tb-skel-thumb" />
                    <Skeleton className="tb-skel-line" />
                    <Skeleton className="tb-skel-line tb-skel-line--sm" />
                  </div>
                ) ) }
              </div>
            ) : items.length === 0 && ! activeLocked ? (
              <div className="tb-empty">
                <span className="tb-empty__ic"><Icon.Layout size={ 22 } /></span>
                <p className="tb-empty__title">{ activeType ? sprintf( __( 'No %s templates yet', 'uichemy' ), activeType.label.toLowerCase() ) : __( 'No templates yet', 'uichemy' ) }</p>
                <p className="tb-empty__sub">{ sprintf( __( 'Use Add New above to create your first %s.', 'uichemy' ), activeType ? activeType.label.toLowerCase() : __( 'template', 'uichemy' ) ) }</p>
              </div>
            ) : items.length > 0 ? (
              <div className="tb-grid">
                { items.map( ( tpl ) => (
                  <GridCard key={ tpl.id } tpl={ tpl } typeLabel={ LABEL_BY_TYPE[ tpl.type ] || tpl.type }
                    onToggle={ toggle } onDelete={ setDeleteTpl } onConditions={ setCondTpl } onPreview={ setPreviewTpl } onEditElementor={ editWithElementor } />
                ) ) }
              </div>
            ) : null }
          </div>
        ) : (
          <CanvasView />
        ) }
      </div>

      { condTpl ? <ConditionsDialog tpl={ condTpl } onClose={ () => setCondTpl( null ) } onSaved={ onConditionsSaved } /> : null }
      { previewTpl ? <PreviewDialog tpl={ previewTpl } onClose={ () => setPreviewTpl( null ) } /> : null }
      { deleteTpl ? <DeleteDialog tpl={ deleteTpl } onCancel={ () => setDeleteTpl( null ) } onConfirm={ confirmDelete } /> : null }
    </div>
  );
}
