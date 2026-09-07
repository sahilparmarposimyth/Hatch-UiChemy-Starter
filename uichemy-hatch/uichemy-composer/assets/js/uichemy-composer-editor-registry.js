(function ($) {
	'use strict';
	var UichSHE = window.UichUiChemyComposerEditor = window.UichUiChemyComposerEditor || {};
	Object.assign(UichSHE, {
		INLINE_TAGS: ['A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'LABEL', 'BUTTON'],
		IGNORE_TAGS: ['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE'],
		LAYER_SKIP_TAGS: ['HTML', 'HEAD', 'META', 'TITLE', 'BASE', 'STYLE', 'BR'],
		activeWidgetSettings: null,
		activePanelView: null,
		activeWidgetPreviewView: null,
		activePreviewSelectionAbortController: null,
		activePreviewSelectionEnabled: false,
		activePreviewHoverElement: null,
		activePreviewSelectedElement: null,
		chatPickAbortController: null,
		chatPickHoverElement: null,
		chatPickSelectedInfo: null,
		chatPickSelectedElement: null,
		uiChemyComposerPreviewSelectionPathCache: '',
		refreshUiChemyComposerLayersPanel: function () {},
		focusUiChemyComposerLayerByPath: function () { return false; },
		setUiChemyComposerPreviewSelectionPath: function () {},
		refreshUiChemyComposerGlobalsPanel: function () {},
		uiChemyComposerActiveCodeRowTab: 'core',
		uiChemyComposerGlobalsHooksBound: false,
		uiChemyComposerStyleTabHooksBound: false,
		openComposerPanelTab: function () {},
		uiChemyComposerAtomicSnapshot: { variables: [], classes: [] },
		floatingCodeEditors: Object.create(null),
		sharedSiteCustomCode: { head: '', footer: '' },
		sharedSiteCustomCodeInitialized: false,
		sharedSiteCodeSaveTimeout: null,
		sharedSiteCustomCodeRevision: 0,
		sharedSiteCodeHasPendingLocalChanges: false
	});
})(jQuery);
