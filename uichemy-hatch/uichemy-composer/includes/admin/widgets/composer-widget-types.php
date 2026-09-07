<?php
/**
 * The set of Elementor widget types that ARE the Composer widget.
 *
 * Deliberately dependency-free — no classes, nothing that touches Elementor — so
 * it can be loaded unconditionally and used from the manager, the enqueue layer,
 * the globals migration and the MCP server alike. The Elementor-dependent widget
 * classes (class-uichemy-composer-widget*.php) are loaded far later, only once
 * Elementor has registered its widget manager.
 *
 * `composer` is the current type. The other two are what the widget was called
 * before, and both can still be sitting in a site's `_elementor_data`:
 *
 *   proton          — every released Protuno wrote this, so customer sites have
 *                     it until Uich_Composer_Migration rewrites the row.
 *   uichemy-builder — an interim development name that never shipped; only our
 *                     own dev and staging sites carry it.
 *
 * Anything that WRITES a widget type must use the current name only (there is no
 * helper for that on purpose — write `'uichemy-composer'` literally). Anything that READS
 * or MATCHES one should go through here, otherwise a not-yet-migrated widget gets
 * silently skipped: it renders (see class-uichemy-composer-widget-legacy.php) but
 * loses its globals, its shared custom code and its MCP visibility.
 *
 * Keep in step with Uich_Composer_Migration::NEW_WIDGET / OLD_WIDGET / DEV_WIDGET.
 *
 * @package UiChemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'uichemy_composer_widget_types' ) ) {

	/**
	 * Every widget type that is the Composer widget, current name first.
	 *
	 * @return string[]
	 */
	function uichemy_composer_widget_types() {
		return array( 'uichemy-composer', 'composer', 'proton', 'uichemy-builder' );
	}
}

if ( ! function_exists( 'uichemy_is_composer_widget_type' ) ) {

	/**
	 * Is this Elementor widget type the Composer widget, under any of its names?
	 *
	 * @param mixed $type Value of a node's `widgetType`.
	 * @return bool
	 */
	function uichemy_is_composer_widget_type( $type ) {
		return is_string( $type ) && in_array( $type, uichemy_composer_widget_types(), true );
	}
}

if ( ! function_exists( 'uichemy_is_composer_widget_node' ) ) {

	/**
	 * Is this `_elementor_data` node a Composer widget, under any of its names?
	 *
	 * Checks `elType` too, because a container can legitimately carry a
	 * `widgetType` key left over from an editor round-trip.
	 *
	 * @param mixed $node Decoded element from an Elementor tree.
	 * @return bool
	 */
	function uichemy_is_composer_widget_node( $node ) {
		return is_array( $node )
			&& isset( $node['elType'], $node['widgetType'] )
			&& 'widget' === $node['elType']
			&& uichemy_is_composer_widget_type( $node['widgetType'] );
	}
}

if ( ! function_exists( 'uichemy_composer_widget_json_needles' ) ) {

	/**
	 * The `"widgetType":"…"` fragments to search for in stored JSON, one per name.
	 *
	 * Plain form only — callers that also have to cope with double-encoded rows
	 * (see Uich_Composer_Migration::legacy_widget_needles()) build the slashed
	 * variants themselves.
	 *
	 * @return string[]
	 */
	function uichemy_composer_widget_json_needles() {
		$needles = array();

		foreach ( uichemy_composer_widget_types() as $type ) {
			$needles[] = '"widgetType":"' . $type . '"';
		}

		return $needles;
	}
}
