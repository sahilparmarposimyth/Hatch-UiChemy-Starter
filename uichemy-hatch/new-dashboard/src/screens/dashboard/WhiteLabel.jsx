import React, { useState } from 'react';
import { __ } from '@wordpress/i18n';
import * as Icon from '../../components/icons.jsx';
import ScreenHead from '../../components/ScreenHead.jsx';
import {
  Button, Input, Textarea, Switch, Field, Card,
  Tabs, TabsList, TabsTrigger,
} from '../../design-system';
// Reuse the builder-island data bridge: white-label settings are localized on
// `window.uichemyDashboard` and saved through the same admin-ajax action, so
// the backend contract is unchanged — only the UI is rebuilt on our design
// system (was a Tailwind/shadcn island).
import { data, ajax } from '../../uichemy-composer/admin/data.js';

const WL_DEFAULTS = {
  enabled: 0, plugin_name: '', description: '', author: '', author_url: '', plugin_url: '',
  logo_url: '', hide_from_others: 0, widget_name: '', widget_icon: '', widget_category: '',
  hide_help_links: 0, hide_update_news: 0, hide_recommend_ads: 0, force_disable: 0,
};

const TABS = [
  { key: 'branding', icon: Icon.Home,     label: __( 'Branding', 'uichemy' ) },
  { key: 'plugins',  icon: Icon.Plug,     label: __( 'Plugins screen', 'uichemy' ) },
  { key: 'widget',   icon: Icon.Terminal, label: __( 'Widget', 'uichemy' ) },
  { key: 'advanced', icon: Icon.Sliders,  label: __( 'Advanced', 'uichemy' ) },
];

/** Label + description on the left, DS Switch on the right — one settings row. */
function SwitchRow( { id, label, desc, checked, onChange, danger } ) {
  return (
    <div className={ `wl-switchrow${ danger ? ' wl-switchrow--danger' : '' }` }>
      <label htmlFor={ id } className="wl-switchrow__text">
        <b>{ label }</b>
        <span>{ desc }</span>
      </label>
      <Switch id={ id } checked={ !! checked } onCheckedChange={ ( v ) => onChange( v ? 1 : 0 ) } />
    </div>
  );
}

const DEFAULT_DESC = __( 'One widget for your website. Build pages, posts, templates and layouts with AI.', 'uichemy' );

/** Brand mark used across every mini mockup. */
function BrandMark( { logo, size = 20 } ) {
  return (
    <span className="wl-pv__logo" style={ { width: size, height: size } }>
      { logo ? <img src={ logo } alt="" /> : <Icon.Sparkles size={ Math.round( size * 0.6 ) } /> }
    </span>
  );
}

/** Lightweight DS-token mockups — a hint of the real surface, not a pixel copy.
 *  One per tab, so the preview always reflects what you're editing. */
function MenuMock( { name, logo, siteName } ) {
  return (
    <div className="wl-pv wl-pv--menu">
      <div className="wl-pv__bar"><span className="wl-pv__dot" /> { siteName || 'WordPress' }</div>
      <div className="wl-pv__menu">
        <div className="wl-pv__item"><i /> Dashboard</div>
        <div className="wl-pv__item"><i /> Posts</div>
        <div className="wl-pv__item wl-pv__item--on">
          <BrandMark logo={ logo } />
          <span className="wl-pv__name">{ name }</span>
        </div>
        <div className="wl-pv__sub">Dashboard · Settings · White Label</div>
        <div className="wl-pv__item"><i /> Appearance</div>
      </div>
    </div>
  );
}

function PluginsMock( { name, description, author, hasSite, version } ) {
  return (
    <div className="wl-pv wl-pv--plugin">
      <div className="wl-pv__pname">{ name }</div>
      <div className="wl-pv__pact">{ __( 'Deactivate', 'uichemy' ) }</div>
      <p className="wl-pv__pdesc">{ description || DEFAULT_DESC }</p>
      <div className="wl-pv__pmeta">
        { __( 'Version', 'uichemy' ) } { version || '1.0' } · { __( 'By', 'uichemy' ) } { author || 'Posimyth' }
        { hasSite ? <> · { __( 'Visit plugin site', 'uichemy' ) }</> : null }
      </div>
    </div>
  );
}

function WidgetMock( { widgetName, icon } ) {
  const label = widgetName || 'Composer';
  return (
    <div className="wl-pv wl-pv--ele">
      <div className="wl-pv__search">{ label.toLowerCase() }</div>
      <div className="wl-pv__grid">
        <div className="wl-pv__card wl-pv__card--on">
          <span className="wl-pv__wico">
            { icon && icon.indexOf( 'dashicons-' ) === 0 ? <span className={ `dashicons ${ icon }` } /> : <Icon.Terminal size={ 18 } /> }
          </span>
          <span>{ label }</span>
        </div>
        <div className="wl-pv__card"><span className="wl-pv__wico wl-pv__wico--ghost" /> { __( 'Heading', 'uichemy' ) }</div>
        <div className="wl-pv__card"><span className="wl-pv__wico wl-pv__wico--ghost" /> { __( 'Image', 'uichemy' ) }</div>
      </div>
    </div>
  );
}

/** The preview card — swaps its mockup + caption to match the active tab. */
function LivePreview( { tab, wl, name, siteName, version } ) {
  let body, caption;
  if ( tab === 'plugins' ) {
    body = <PluginsMock name={ name } description={ wl.description } author={ wl.author } hasSite={ !! wl.plugin_url } version={ version } />;
    caption = __( 'Your row on the Plugins screen', 'uichemy' );
  } else if ( tab === 'widget' ) {
    body = <WidgetMock widgetName={ wl.widget_name } icon={ wl.widget_icon } />;
    caption = __( 'How the widget appears in Elementor', 'uichemy' );
  } else {
    body = <MenuMock name={ name } logo={ wl.logo_url } siteName={ siteName } />;
    caption = __( 'Your plugin in the WordPress admin menu', 'uichemy' );
  }
  return (
    <Card className="wl-preview">
      <span className="wl-preview__cap">{ __( 'Live preview', 'uichemy' ) }</span>
      { body }
      <p className="wl-preview__by">{ caption }</p>
    </Card>
  );
}

export default function WhiteLabel() {
  const initial = { ...WL_DEFAULTS, ...( data.whiteLabel || {} ) };
  const [ wl, setWl ] = useState( initial );
  const [ tab, setTab ] = useState( 'branding' );
  const [ iconQuery, setIconQuery ] = useState( '' );
  const [ saving, setSaving ] = useState( false );
  const [ saved, setSaved ] = useState( false );
  const set = ( k, v ) => setWl( ( o ) => ( { ...o, [ k ]: v } ) );

  const enabled = !! wl.enabled;
  const name = wl.plugin_name || 'UiChemy';
  const dashicons = data.dashicons || [];

  // Force-disabled: the page stays reachable but the configurator is locked.
  if ( initial.enabled && initial.force_disable ) {
    return (
      <div className="dash">
        <ScreenHead title={ __( 'White Label', 'uichemy' ) } subtitle={ __( 'Rebrand UiChemy everywhere it shows.', 'uichemy' ) } />
        <Card className="wl-locked-card">
          <span className="wl-locked-card__ic"><Icon.Lock size={ 22 } /></span>
          <b>{ __( 'White Label settings are locked', 'uichemy' ) }</b>
          <p>{ __( 'Force Disable is on, so these options are hidden from all administrators. To unlock them, deactivate and reactivate the plugin.', 'uichemy' ) }</p>
        </Card>
      </div>
    );
  }

  function pickLogo() {
    if ( ! window.wp || ! window.wp.media ) return;
    const frame = window.wp.media( { title: __( 'Select brand logo', 'uichemy' ), button: { text: __( 'Use this logo', 'uichemy' ) }, multiple: false, library: { type: 'image' } } );
    frame.on( 'select', () => set( 'logo_url', frame.state().get( 'selection' ).first().toJSON().url ) );
    frame.open();
  }

  function save() {
    setSaving( true ); setSaved( false );
    ajax( 'save_white_label', { white_label: wl } )
      .then( ( res ) => {
        if ( res && res.reload && data.urls ) { window.location.href = data.urls.dashboard; return; }
        setSaved( true ); setTimeout( () => setSaved( false ), 2200 );
      } )
      .finally( () => setSaving( false ) );
  }

  return (
    <div className="dash">
      <ScreenHead
        title={ __( 'White Label', 'uichemy' ) }
        subtitle={ __( 'Rebrand UiChemy everywhere it shows.', 'uichemy' ) }
      />

      {/* Master switch — the single most important control, up top. */}
      <Card className="wl-master">
        <label htmlFor="wl-enabled" className="wl-master__text">
          <b>{ __( 'Enable white label', 'uichemy' ) }</b>
          <span>{ __( 'Apply the branding below across the admin, Plugins screen and Elementor.', 'uichemy' ) }</span>
        </label>
        <Switch id="wl-enabled" checked={ enabled } onCheckedChange={ ( v ) => set( 'enabled', v ? 1 : 0 ) } />
      </Card>

      {/* Everything below is inert + dimmed until the master switch is on. */}
      <div className={ `wl-body${ enabled ? '' : ' wl-body--off' }` } { ...( enabled ? {} : { inert: '' } ) }>
        <Tabs variant="underline" value={ tab } onValueChange={ setTab } className="wl-tabs">
          <TabsList>
            { TABS.map( ( t ) => {
              const IconEl = t.icon;
              return (
                <TabsTrigger key={ t.key } value={ t.key }>
                  <IconEl size={ 15 } /> { t.label }
                </TabsTrigger>
              );
            } ) }
          </TabsList>
        </Tabs>

        <div className="wl-cols">
          <div className="wl-fields">
            { tab === 'branding' && (
              <>
                <Field label={ __( 'Plugin / brand name', 'uichemy' ) } hint={ __( 'Shown in place of “UiChemy” in the menu and dashboard.', 'uichemy' ) } htmlFor="wl-name">
                  <Input id="wl-name" value={ wl.plugin_name } onChange={ ( e ) => set( 'plugin_name', e.target.value ) } placeholder={ __( 'e.g. Studio Builder', 'uichemy' ) } />
                </Field>
                <Field label={ __( 'Brand logo', 'uichemy' ) } hint={ __( 'Replaces the composer mark. Square PNG/SVG works best.', 'uichemy' ) }>
                  <div className="wl-row">
                    <Input className="wl-row__grow" value={ wl.logo_url } onChange={ ( e ) => set( 'logo_url', e.target.value ) } placeholder="https://…" />
                    <Button type="button" variant="outline" tone="neutral" onClick={ pickLogo }>{ __( 'Upload', 'uichemy' ) }</Button>
                    { wl.logo_url ? <Button type="button" variant="ghost" tone="neutral" onClick={ () => set( 'logo_url', '' ) }>{ __( 'Clear', 'uichemy' ) }</Button> : null }
                  </div>
                </Field>
                <Field label={ __( 'Author / agency name', 'uichemy' ) } htmlFor="wl-author">
                  <Input id="wl-author" value={ wl.author } onChange={ ( e ) => set( 'author', e.target.value ) } placeholder={ __( 'e.g. Your Agency', 'uichemy' ) } />
                </Field>
                <Field label={ __( 'Author URL', 'uichemy' ) } htmlFor="wl-author-url">
                  <Input id="wl-author-url" type="url" value={ wl.author_url } onChange={ ( e ) => set( 'author_url', e.target.value ) } placeholder="https://…" />
                </Field>
              </>
            ) }

            { tab === 'plugins' && (
              <>
                <Field label={ __( 'Plugin description', 'uichemy' ) } hint={ __( 'The text under the plugin on the Plugins list.', 'uichemy' ) } htmlFor="wl-desc">
                  <Textarea id="wl-desc" rows={ 3 } value={ wl.description } onChange={ ( e ) => set( 'description', e.target.value ) } placeholder={ __( 'One widget for your website…', 'uichemy' ) } />
                </Field>
                <Field label={ __( 'Plugin site URL', 'uichemy' ) } hint={ __( 'The “Visit plugin site” link.', 'uichemy' ) } htmlFor="wl-plugin-url">
                  <Input id="wl-plugin-url" type="url" value={ wl.plugin_url } onChange={ ( e ) => set( 'plugin_url', e.target.value ) } placeholder="https://…" />
                </Field>
                <SwitchRow id="wl-hide" label={ __( 'Hide from other admins', 'uichemy' ) } desc={ __( 'Only show the menu to the current administrator.', 'uichemy' ) } checked={ wl.hide_from_others } onChange={ ( v ) => set( 'hide_from_others', v ) } />
              </>
            ) }

            { tab === 'widget' && (
              <>
                <Field label={ __( 'Widget name', 'uichemy' ) } hint={ __( 'Label in the Elementor Elements panel and the “Edit …” header.', 'uichemy' ) } htmlFor="wl-widget-name">
                  <Input id="wl-widget-name" value={ wl.widget_name } onChange={ ( e ) => set( 'widget_name', e.target.value ) } placeholder="Composer" />
                </Field>
                <Field label={ __( 'Widget category', 'uichemy' ) } hint={ __( 'Category heading in the Elementor Elements panel.', 'uichemy' ) } htmlFor="wl-widget-cat">
                  <Input id="wl-widget-cat" value={ wl.widget_category } onChange={ ( e ) => set( 'widget_category', e.target.value ) } placeholder="UiChemy" />
                </Field>
                <Field label={ __( 'Widget icon', 'uichemy' ) } hint={ __( 'Pick from the WordPress Dashicons library, or keep the default.', 'uichemy' ) }>
                  <div className="wl-iconpicker">
                    <div className="wl-iconpicker__bar">
                      <Input type="search" className="wl-row__grow" placeholder={ __( 'Search icons…', 'uichemy' ) } value={ iconQuery } onChange={ ( e ) => setIconQuery( e.target.value ) } />
                      <Button type="button" variant="outline" tone="neutral" size="sm" onClick={ () => set( 'widget_icon', '' ) }>{ __( 'Default', 'uichemy' ) }</Button>
                    </div>
                    <div className="wl-iconpicker__grid">
                      { dashicons.map( ( slug ) => {
                        const hidden = iconQuery && slug.toLowerCase().indexOf( iconQuery.toLowerCase().trim() ) === -1;
                        if ( hidden ) return null;
                        return (
                          <button
                            key={ slug }
                            type="button"
                            title={ slug }
                            className={ `wl-iconbtn${ wl.widget_icon === slug ? ' is-on' : '' }` }
                            onClick={ () => set( 'widget_icon', slug ) }
                          >
                            <span className={ `dashicons ${ slug }` } />
                          </button>
                        );
                      } ) }
                    </div>
                  </div>
                </Field>
              </>
            ) }

            { tab === 'advanced' && (
              <div className="wl-adv">
                <SwitchRow id="wl-hide-help" label={ __( 'Hide all help links', 'uichemy' ) } desc={ __( 'Hide every link (except the brand name) from the plugin’s row on the Plugins page.', 'uichemy' ) } checked={ wl.hide_help_links } onChange={ ( v ) => set( 'hide_help_links', v ) } />
                <SwitchRow id="wl-hide-news" label={ __( 'Hide plugin update news', 'uichemy' ) } desc={ __( 'Hide future news and update banners shown by the plugin.', 'uichemy' ) } checked={ wl.hide_update_news } onChange={ ( v ) => set( 'hide_update_news', v ) } />
                <SwitchRow id="wl-hide-ads" label={ __( 'Hide recommended-plugin ads', 'uichemy' ) } desc={ __( 'Hide the “recommended plugins” promotions shown by the plugin.', 'uichemy' ) } checked={ wl.hide_recommend_ads } onChange={ ( v ) => set( 'hide_recommend_ads', v ) } />
                <SwitchRow id="wl-force" danger label={ __( 'Enable Force Disable', 'uichemy' ) } desc={ __( 'Remove the White Label page entirely so clients can’t change these. To restore it, deactivate and reactivate the plugin, then save again.', 'uichemy' ) } checked={ wl.force_disable } onChange={ ( v ) => set( 'force_disable', v ) } />
              </div>
            ) }
          </div>

          <aside className="wl-aside">
            <LivePreview tab={ tab } wl={ wl } name={ name } siteName={ data.siteName } version={ data.version } />
          </aside>
        </div>
      </div>

      <div className="wl-footer">
        <Button variant="solid" tone="brand" onClick={ save } loading={ saving } disabled={ ! enabled }>
          { saved ? <><Icon.Check size={ 14 } /> { __( 'Saved', 'uichemy' ) }</> : __( 'Save changes', 'uichemy' ) }
        </Button>
      </div>
    </div>
  );
}
