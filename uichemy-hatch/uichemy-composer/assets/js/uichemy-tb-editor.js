/**
 * UiChemy Theme Builder — block-editor integration.
 *
 * Adds an "Edit with Elementor" panel to the block editor when editing a
 * Gutenberg-authored UiChemy template. Clicking it switches the template to
 * Elementor (server-side) and opens the Elementor editor.
 *
 * Written against the global wp.* APIs so it needs no build step; enqueued only
 * on the uichemy_template edit screen (see UiChemy_Theme_Builder_Admin).
 */
( function ( wp ) {
	if ( ! wp || ! wp.plugins || ! wp.element ) {
		return;
	}

	var el             = wp.element.createElement;
	var useState       = wp.element.useState;
	var registerPlugin = wp.plugins.registerPlugin;
	var Button         = wp.components && wp.components.Button;

	// PluginDocumentSettingPanel moved from wp.editPost to wp.editor in newer
	// WordPress; support both so it works across versions.
	var editPost = wp.editPost || {};
	var editor   = wp.editor || {};
	var Panel    = editPost.PluginDocumentSettingPanel || editor.PluginDocumentSettingPanel;

	if ( ! Panel || ! Button ) {
		return;
	}

	var data = window.uichemyTBEditor || {};

	function EditWithElementor() {
		var state   = useState( false );
		var busy    = state[0];
		var setBusy = state[1];

		function go() {
			setBusy( true );
			var body = new FormData();
			body.append( 'action', 'uichemy_theme_builder' );
			body.append( 'nonce', data.nonce || '' );
			body.append( 'type', 'tb_set_editor' );
			body.append( 'id', data.postId || 0 );
			body.append( 'editor', 'elementor' );

			fetch( data.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body } )
				.then( function ( r ) { return r.json(); } )
				.then( function ( j ) {
					var url = j && j.success && j.data ? j.data.elementorUrl : '';
					if ( url ) {
						window.location.href = url;
					} else {
						setBusy( false );
						window.alert( 'Could not switch to Elementor.' );
					}
				} )
				.catch( function () {
					setBusy( false );
					window.alert( 'Could not switch to Elementor.' );
				} );
		}

		return el(
			Panel,
			{ name: 'uichemy-theme-builder', title: 'UiChemy', className: 'uichemy-tb-panel' },
			el( 'p', { style: { marginTop: 0 } }, 'Editing this template with the block editor. Prefer Elementor?' ),
			el( Button, { variant: 'secondary', isBusy: busy, disabled: busy, onClick: go }, busy ? 'Switching…' : 'Edit with Elementor' )
		);
	}

	registerPlugin( 'uichemy-theme-builder-editor', { render: EditWithElementor } );
}( window.wp ) );
