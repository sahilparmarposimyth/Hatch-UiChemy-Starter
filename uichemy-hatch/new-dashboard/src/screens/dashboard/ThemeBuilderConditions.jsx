/**
 * Display-conditions editor — the rules UI and the dialog that saves them.
 *
 * Its own module because THREE surfaces open it: the Theme Builder grid, the
 * canvas view's Manage popup, and the block editor's one-time Edit Condition
 * launcher. It used to sit in ThemeBuilder.jsx, which meant the canvas — already
 * imported BY ThemeBuilder — had to import back out of it. That cycle happens to
 * work under ES module live bindings, which is exactly what makes it a trap for
 * whoever touches it next.
 *
 * One dialog and one `tb_update_conditions` write, wherever it is opened from.
 */
import React, { useState, useRef, useEffect } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import {
  Button, Badge, Input, Alert,
  Select, SelectValue, SelectTrigger, SelectContent, SelectItem,
  Dialog, DialogContent, DialogCard, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter, DialogClose,
} from '../../design-system';
import * as Icon from '../../components/icons.jsx';
import { tbAjax } from '../../uichemy-composer/admin/data.js';

const PlusIcon = Icon.Plus;

/* ── Conditions rules editor (ported) ────────────────────────────────────── */
function ruleTypeChoices( tplType ) {
  if ( tplType === 'archive' ) {
    return [
      { v: 'entire', t: __( 'All archives', 'uichemy' ) },
      { v: 'taxonomy', t: __( 'Taxonomy archive', 'uichemy' ) },
      { v: 'author', t: __( 'Author archive', 'uichemy' ) },
      { v: 'search', t: __( 'Search results', 'uichemy' ) },
    ];
  }
  return [
    { v: 'entire', t: __( 'Entire site', 'uichemy' ) },
    { v: 'post_type', t: __( 'All of a post type', 'uichemy' ) },
    { v: 'taxonomy', t: __( 'In a taxonomy term', 'uichemy' ) },
    { v: 'author', t: __( 'By author', 'uichemy' ) },
    { v: 'singular', t: __( 'Specific page / post', 'uichemy' ) },
  ];
}

/**
 * The conditions actually in force on a template, as label rows.
 *
 * Mirrors what the SERVER does at render time: a non-empty v2 `rules` list wins
 * outright, and with no rules at all it falls back to the legacy
 * scope/include/exclude — where the default scope, `entire`, means the template
 * shows everywhere (see UiChemy_Conditions::evaluate). So an untouched template
 * honestly reads "Entire site" rather than "nothing set".
 */
export function conditionSummary( tpl ) {
  const rl = tpl.rulesLabels || [];
  if ( rl.length ) {
    return rl.map( ( r ) => ( {
      match: r.match === 'exclude' ? 'exclude' : 'include',
      label: r.label || r.type || '',
    } ) );
  }
  const c = tpl.conditions || {};
  if ( c.scope === 'specific' ) {
    return ( tpl.includeLabels || [] ).map( ( pg ) => ( { match: 'include', label: pg.title } ) );
  }
  return [ { match: 'include', label: __( 'Entire site', 'uichemy' ) } ];
}

function initConditionRules( tpl ) {
  const rl = tpl.rulesLabels || [];
  if ( rl.length ) {
    return rl.map( ( r ) => ( {
      match: r.match === 'exclude' ? 'exclude' : 'include',
      type: r.type || 'entire',
      value: r.value != null ? r.value : undefined,
      taxonomy: r.taxonomy || undefined,
      term: r.term || 0,
      _label: r.type === 'singular' ? r.label : undefined,
      _termLabel: ( r.type === 'taxonomy' && r.term ) ? String( r.label ).split( ': ' ).slice( 1 ).join( ': ' ) : undefined,
    } ) );
  }
  const c = tpl.conditions || {};
  const out = [];
  if ( c.scope === 'specific' ) {
    ( tpl.includeLabels || [] ).forEach( ( p ) => out.push( { match: 'include', type: 'singular', value: p.id, _label: p.title } ) );
  } else {
    out.push( { match: 'include', type: 'entire' } );
  }
  ( tpl.excludeLabels || [] ).forEach( ( p ) => out.push( { match: 'exclude', type: 'singular', value: p.id, _label: p.title } ) );
  return out.length ? out : [ { match: 'include', type: 'entire' } ];
}

// Search-backed single-value picker (posts / terms).
function SearchPick( { placeholder, action, extra, value, label, onPick } ) {
  const [ q, setQ ] = useState( '' );
  const [ results, setResults ] = useState( [] );
  const [ open, setOpen ] = useState( false );
  const timer = useRef( null );
  const run = ( val ) => {
    setQ( val );
    window.clearTimeout( timer.current );
    if ( ! val.trim() ) { setResults( [] ); setOpen( false ); return; }
    timer.current = window.setTimeout( () => {
      tbAjax( action, { q: val, ...( extra || {} ) } )
        .then( ( d ) => { setResults( d.results || [] ); setOpen( true ); } )
        .catch( () => { setResults( [] ); setOpen( false ); } );
    }, 250 );
  };
  if ( value ) {
    return (
      <Badge tone="neutral" variant="soft" className="tb-chip">
        { label || `#${ value }` }
        <button type="button" className="tb-chip__x" onClick={ () => onPick( 0, '' ) } aria-label={ __( 'Remove', 'uichemy' ) }>×</button>
      </Badge>
    );
  }
  return (
    <div className="tb-search">
      <Input value={ q } onChange={ ( e ) => run( e.target.value ) } placeholder={ placeholder } />
      { open && results.length > 0 ? (
        <div className="tb-search__pop">
          { results.map( ( r ) => (
            <button key={ r.id } type="button" className="tb-search__opt" onClick={ () => { onPick( r.id, r.title ); setQ( '' ); setResults( [] ); setOpen( false ); } }>
              <span className="tb-search__opt-t">{ r.title }</span>
              <span className="tb-search__opt-k">{ r.type }</span>
            </button>
          ) ) }
        </div>
      ) : null }
    </div>
  );
}

function RuleValue( { rule, opts, onChange } ) {
  if ( rule.type === 'post_type' ) {
    return (
      <Select value={ rule.value || '' } onValueChange={ ( v ) => onChange( { ...rule, value: v } ) }>
        <SelectTrigger className="tb-sel"><SelectValue placeholder={ __( 'Choose post type', 'uichemy' ) } /></SelectTrigger>
        <SelectContent>{ ( opts.postTypes || [] ).map( ( p ) => <SelectItem key={ p.slug } value={ p.slug }>{ p.label }</SelectItem> ) }</SelectContent>
      </Select>
    );
  }
  if ( rule.type === 'author' ) {
    return (
      <Select value={ String( rule.value != null ? rule.value : 0 ) } onValueChange={ ( v ) => onChange( { ...rule, value: Number( v ) } ) }>
        <SelectTrigger className="tb-sel"><SelectValue placeholder={ __( 'Author', 'uichemy' ) } /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0">{ __( 'Any author', 'uichemy' ) }</SelectItem>
          { ( opts.authors || [] ).map( ( a ) => <SelectItem key={ a.id } value={ String( a.id ) }>{ a.name }</SelectItem> ) }
        </SelectContent>
      </Select>
    );
  }
  if ( rule.type === 'taxonomy' ) {
    return (
      <div className="tb-rule__tax">
        <Select value={ rule.taxonomy || '' } onValueChange={ ( v ) => onChange( { ...rule, taxonomy: v, term: 0, _termLabel: '' } ) }>
          <SelectTrigger className="tb-sel"><SelectValue placeholder={ __( 'Taxonomy', 'uichemy' ) } /></SelectTrigger>
          <SelectContent>{ ( opts.taxonomies || [] ).map( ( t ) => <SelectItem key={ t.slug } value={ t.slug }>{ t.label }</SelectItem> ) }</SelectContent>
        </Select>
        { rule.taxonomy ? (
          <SearchPick placeholder={ __( 'Any term, search to narrow…', 'uichemy' ) } action="tb_search_terms" extra={ { taxonomy: rule.taxonomy } } value={ rule.term || 0 } label={ rule._termLabel } onPick={ ( id, title ) => onChange( { ...rule, term: id, _termLabel: title } ) } />
        ) : null }
      </div>
    );
  }
  if ( rule.type === 'singular' ) {
    return <SearchPick placeholder={ __( 'Search page / post…', 'uichemy' ) } action="tb_search_posts" value={ rule.value || 0 } label={ rule._label } onPick={ ( id, title ) => onChange( { ...rule, value: id, _label: title } ) } />;
  }
  // Scopes that need no specific value (e.g. "Entire site") render nothing –
  // the picked type already says it all.
  return null;
}

export function ConditionsDialog( { tpl, onClose, onSaved } ) {
  const choices = ruleTypeChoices( tpl.type );
  const [ opts, setOpts ] = useState( { postTypes: [], taxonomies: [], authors: [] } );
  const [ rules, setRules ] = useState( () => initConditionRules( tpl ) );
  const [ saving, setSaving ] = useState( false );
  // Two failures used to be invisible here, and between them they made a save
  // that kept nothing look like a save that worked. Both are surfaced now.
  const [ optsError, setOptsError ] = useState( false );
  const [ error, setError ] = useState( '' );
  useEffect( () => {
    let alive = true;
    tbAjax( 'tb_condition_options' )
      .then( ( d ) => { if ( alive ) { setOpts( d || {} ); setOptsError( false ); } } )
      .catch( () => { if ( alive ) setOptsError( true ); } );
    return () => { alive = false; };
  }, [] );
  const updateAt = ( i, r ) => setRules( rules.map( ( x, idx ) => ( idx === i ? r : x ) ) );
  const removeAt = ( i ) => setRules( rules.filter( ( _, idx ) => idx !== i ) );
  const addRule = () => setRules( [ ...rules, { match: 'include', type: choices[ 0 ].v } ] );
  const save = () => {
    setError( '' );
    const clean = rules.map( ( r ) => {
      const out = { match: r.match === 'exclude' ? 'exclude' : 'include', type: r.type };
      if ( r.type === 'post_type' ) out.value = r.value || '';
      if ( r.type === 'author' ) out.value = Number( r.value || 0 );
      if ( r.type === 'singular' ) out.value = Number( r.value || 0 );
      if ( r.type === 'taxonomy' ) { out.taxonomy = r.taxonomy || ''; out.term = Number( r.term || 0 ); }
      return out;
    } );

    // A rule with no value chosen used to be DISCARDED here, silently, and the
    // save then reported success — so picking "All of a post type" without
    // choosing the post type saved nothing and said it had worked. The server
    // drops the same rules for the same reason (sanitize_one_condition_rule), so
    // refusing here, by name, is the only way the user finds out.
    const incomplete = clean.filter( ( r ) => {
      if ( r.type === 'post_type' ) return ! r.value;
      if ( r.type === 'singular' ) return ! ( r.value > 0 );
      if ( r.type === 'taxonomy' ) return ! r.taxonomy;
      return false;
    } );
    if ( incomplete.length ) {
      const names = incomplete.map( ( r ) => {
        const ch = choices.find( ( x ) => x.v === r.type );
        return ch ? ch.t : r.type;
      } );
      setError( sprintf(
        /* translators: %s: comma-separated list of condition names. */
        __( 'Choose a value for: %s, or remove the rule. Nothing is saved until then.', 'uichemy' ),
        names.join( ', ' )
      ) );
      return;
    }

    setSaving( true );
    const conditions = { rules: clean, scope: 'entire', include: [], exclude: [] };
    tbAjax( 'tb_update_conditions', { id: tpl.id, conditions } )
      .then( ( updated ) => { onSaved( updated ); onClose(); } )
      .catch( ( err ) => {
        setSaving( false );
        setError( ( err && err.message )
          ? String( err.message )
          : __( 'Could not save the conditions. Please try again.', 'uichemy' ) );
      } );
  };
  return (
    <Dialog open onOpenChange={ ( v ) => { if ( ! v ) onClose(); } }>
      <DialogContent className="tb-dlg tb-dlg--wide">
        {/* overflow:visible, the card would otherwise clip the searchable
            select's absolute dropdown (.tb-search__pop). */}
        <DialogCard className="tb-dlg__card tb-dlg__card--flow">
          <DialogHeader>
            <DialogTitle>{ __( 'Display conditions', 'uichemy' ) }</DialogTitle>
            <DialogDescription>{ sprintf( __( 'Choose where “%s” appears. Rules stack, an Exclude always wins.', 'uichemy' ), tpl.title || '' ) }</DialogDescription>
          </DialogHeader>
          <DialogBody className="tb-cond">
            { optsError ? (
              <Alert tone="warning">
                { __( 'Could not load the post types, taxonomies and authors to choose from, so only site-wide rules can be set right now. Reload and try again.', 'uichemy' ) }
              </Alert>
            ) : null }
            { error ? <Alert tone="danger">{ error }</Alert> : null }
            {/* Rows + "Add condition" live in ONE bordered group so they read as a
                single conditions list rather than separate floating boxes. */}
            <div className="tb-cond__group">
            { rules.map( ( r, i ) => (
              <div key={ i } className="tb-rule">
                <Select value={ r.match } onValueChange={ ( v ) => updateAt( i, { ...r, match: v } ) }>
                  <SelectTrigger className="tb-sel tb-sel--sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="include">{ __( 'Include', 'uichemy' ) }</SelectItem>
                    <SelectItem value="exclude">{ __( 'Exclude', 'uichemy' ) }</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={ r.type } onValueChange={ ( v ) => updateAt( i, { match: r.match, type: v } ) }>
                  <SelectTrigger className="tb-sel"><SelectValue /></SelectTrigger>
                  <SelectContent>{ choices.map( ( t ) => <SelectItem key={ t.v } value={ t.v }>{ t.t }</SelectItem> ) }</SelectContent>
                </Select>
                <div className="tb-rule__val"><RuleValue rule={ r } opts={ opts } onChange={ ( nr ) => updateAt( i, nr ) } /></div>
                <button type="button" className="tb-rule__x" onClick={ () => removeAt( i ) } aria-label={ __( 'Remove condition', 'uichemy' ) }>×</button>
              </div>
            ) ) }
            <button type="button" className="tb-cond__add" onClick={ addRule }><PlusIcon size={ 13 } /> { __( 'Add condition', 'uichemy' ) }</button>
            </div>
          </DialogBody>
        </DialogCard>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" tone="neutral" disabled={ saving }>{ __( 'Cancel', 'uichemy' ) }</Button></DialogClose>
          <Button variant="solid" tone="brand" onClick={ save } loading={ saving }>{ __( 'Save Conditions', 'uichemy' ) }</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
