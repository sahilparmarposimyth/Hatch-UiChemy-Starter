(function ($) {
	'use strict';
	var UichSHE = window.UichUiChemyComposerEditor;
	if (!UichSHE || UichSHE.__uichUiChemyComposerPanelRegistered) {
		return;
	}
	UichSHE.__uichUiChemyComposerPanelRegistered = true;

	function injectFloatingPanel() {
		if (document.getElementById('uichemy-composer-floating-panel')) return;

		const panel = document.createElement('div');
		panel.id = 'uichemy-composer-floating-panel';
		panel.className = 'uichemy-composer-floating-panel uich-dock-right';
		const uiChemyComposerPanelCfg = window.uichComposerEditorCfg || {};
		panel.innerHTML = typeof uiChemyComposerPanelCfg.panelHtml === 'string' ? uiChemyComposerPanelCfg.panelHtml : '';

		UichSHE.removeLeadingBlankDropdownOptionRows(panel);

		function mountUiChemyComposerFloatingPanelToPreview() {
			const previewRoot = document.getElementById('elementor-preview');
			if (!previewRoot) {
				return false;
			}
			if (panel.parentNode !== previewRoot) {
				previewRoot.appendChild(panel);
			}
			return true;
		}

		/*
		 * document.getElementById only sees nodes in the document tree. While `panel` is detached,
		 * ids inside it (uichemy-composer-panel-header, etc.) are invisible — so we must connect `panel`
		 * before querying those elements below.
		 */
		if (!mountUiChemyComposerFloatingPanelToPreview()) {
			document.body.appendChild(panel);
			let rafAttempts = 0;
			const maxRafAttempts = 240;
			const tryMoveToPreview = function () {
				const previewRoot = document.getElementById('elementor-preview');
				if (!previewRoot || panel.parentNode === previewRoot) {
					return !!previewRoot;
				}
				previewRoot.appendChild(panel);
				return true;
			};
			const rafMove = function () {
				if (tryMoveToPreview()) {
					return;
				}
				rafAttempts += 1;
				if (rafAttempts < maxRafAttempts) {
					window.requestAnimationFrame(rafMove);
				}
			};
			window.requestAnimationFrame(rafMove);
			if (window.elementor && typeof window.elementor.on === 'function') {
				const onPreviewLoaded = function () {
					if (tryMoveToPreview() && window.elementor && typeof window.elementor.off === 'function') {
						window.elementor.off('preview:loaded', onPreviewLoaded);
					}
				};
				window.elementor.on('preview:loaded', onPreviewLoaded);
			}
		}

		const globalsDocTextarea = document.getElementById('uichemy-composer-globals-doc');
		const globalsAiDataTextarea = document.getElementById('uichemy-composer-globals-ai-data');
		if (globalsAiDataTextarea) {
			const globalsAiDataEditor = UichSHE.initializeUiChemyComposerCodeEditor(globalsAiDataTextarea, 'js');
			if (globalsAiDataEditor && globalsAiDataEditor.codemirror) {
				globalsAiDataEditor.codemirror.setOption('readOnly', true);
			}
		}
		if (globalsDocTextarea) {
			const globalsDocEditor = UichSHE.initializeUiChemyComposerCodeEditor(globalsDocTextarea, 'js');
			if (globalsDocEditor && globalsDocEditor.codemirror) {
				globalsDocEditor.codemirror.setOption('readOnly', true);
				globalsDocEditor.codemirror.setValue(
					'{\n  elementor_v3: {\n    global_colors: {},\n    global_typography: {}\n  }\n}\n'
				);
			}
		}

		// Toggle logic
		const header = document.getElementById('uichemy-composer-panel-header');
		const toggleBtn = document.getElementById('uichemy-composer-panel-toggle');
		const hoverToggleBtn = document.getElementById('uichemy-composer-panel-hover-toggle');
		UichSHE.setPreviewSelectionEnabled(UichSHE.activePreviewSelectionEnabled);
		const resizer = document.getElementById('uichemy-composer-panel-resizer');
		const tabButtons = Array.from(panel.querySelectorAll('[data-uichemy-composer-tab]'));
		const tabPanels = Array.from(panel.querySelectorAll('[data-uichemy-composer-panel]'));
		const codeRowTabs = Array.from(panel.querySelectorAll('[data-uichemy-composer-code-tab]'));
		const codeRowPanels = Array.from(panel.querySelectorAll('[data-uichemy-composer-code-panel]'));
		const directSvgModeTabs = Array.from(panel.querySelectorAll('[data-uichemy-composer-direct-svg-mode]'));
		let globalsPollTimer = null;
		const directList = document.getElementById('uichemy-composer-direct-list');
		const directMeta = document.getElementById('uichemy-composer-direct-meta');
		const directClassesWrap = document.getElementById('uichemy-composer-direct-classes-wrap');
		const directClassesChips = document.getElementById('uichemy-composer-direct-classes-chips');
		const directClassInput = document.getElementById('uichemy-composer-direct-class-input');
		const directClassUnselect = document.getElementById('uichemy-composer-direct-class-unselect');
		const directClassSuggestions = document.getElementById('uichemy-composer-direct-class-suggestions');
		const directImageSection = document.getElementById('uichemy-composer-direct-image-section');
		const directImageSectionTitle = document.getElementById('uichemy-composer-direct-image-section-title');
		const directMediaGrid = document.getElementById('uichemy-composer-direct-media-grid');
		const directImageUrlWrap = document.getElementById('uichemy-composer-direct-image-url-wrap');
		const directImagePathLabel = document.getElementById('uichemy-composer-direct-image-path-label');
		const directImageOverlayText = document.getElementById('uichemy-composer-direct-image-overlay-text');
		const directImagePath = document.getElementById('uichemy-composer-direct-image-path');
		const directImagePreview = document.getElementById('uichemy-composer-direct-image-preview');
		const directImagePreviewImg = document.getElementById('uichemy-composer-direct-image-preview-img');
		const directImageEmpty = document.getElementById('uichemy-composer-direct-image-empty');
		if (directImagePreviewImg && directImageEmpty) {
			directImagePreviewImg.addEventListener('error', function () {
				directImagePreviewImg.style.display = 'none';
				directImageEmpty.style.display = '';
			});
			directImagePreviewImg.addEventListener('load', function () {
				directImagePreviewImg.style.display = 'block';
				directImageEmpty.style.display = 'none';
			});
		}
		const directSvgCodeWrap = document.getElementById('uichemy-composer-direct-svg-code-wrap');
		const directSvgModeWrap = document.getElementById('uichemy-composer-direct-svg-mode-wrap');
		const directSvgMode = document.getElementById('uichemy-composer-direct-svg-mode');
		const directSvgCode = document.getElementById('uichemy-composer-direct-svg-code');
		const directSvgCodeEditor = UichSHE.initializeUiChemyComposerCodeEditor(directSvgCode, 'svg');
		if (directSvgCodeEditor && directSvgCodeEditor.codemirror) {
			directSvgCodeEditor.codemirror.setOption('mode', 'xml');
			directSvgCodeEditor.codemirror.setSize('100%', '138px');
		}
		const directTypographySection = document.getElementById('uichemy-composer-direct-typography-section');
		const directLayoutSection = document.getElementById('uichemy-composer-direct-layout-section');
		const directTextField = document.getElementById('uichemy-composer-direct-text-field');
		const directLinkWrap = document.getElementById('uichemy-composer-direct-link-wrap');
		const directText = document.getElementById('uichemy-composer-direct-text');
		const directSvgActions = document.getElementById('uichemy-composer-direct-svg-actions');
		const directSvgUrl = document.getElementById('uichemy-composer-direct-svg-url');
		const directSvgUrlApplyBtn = document.getElementById('uichemy-composer-direct-svg-url-apply-btn');
		const directSvgWordpressBtn = document.getElementById('uichemy-composer-direct-svg-wordpress-btn');
		const directUrl = document.getElementById('uichemy-composer-direct-url');
		const directExternal = document.getElementById('uichemy-composer-direct-external');
		const directNofollow = document.getElementById('uichemy-composer-direct-nofollow');
		const directCustom = document.getElementById('uichemy-composer-direct-custom');
		const directFontSize = document.getElementById('uichemy-composer-direct-font-size');
		const directFontFamily = document.getElementById('uichemy-composer-direct-font-family');
		const directFontWeight = document.getElementById('uichemy-composer-direct-font-weight');
		const directLineHeight = document.getElementById('uichemy-composer-direct-line-height');
		const directTextAlign = document.getElementById('uichemy-composer-direct-text-align');
		const directFontStyle = document.getElementById('uichemy-composer-direct-font-style');
		const directLetterSpacing = document.getElementById('uichemy-composer-direct-letter-spacing');
		const directTextTransform = document.getElementById('uichemy-composer-direct-text-transform');
		const directTextDecoration = document.getElementById('uichemy-composer-direct-text-decoration');
		const directTextColor = document.getElementById('uichemy-composer-direct-text-color');
		const directTextColorPicker = document.getElementById('uichemy-composer-direct-text-color-picker');
		const directTextColorGlobalBtn = document.getElementById('uichemy-composer-direct-text-color-global-btn');
		const directTextColorInlineRemove = document.getElementById('uichemy-composer-direct-text-color-inline-remove');
		const directTextColorGlobalChip = document.getElementById('uichemy-composer-direct-text-color-global-chip');
		const directTextColorGlobalName = document.getElementById('uichemy-composer-direct-text-color-global-name');
		const directTextColorGlobalRemove = document.getElementById('uichemy-composer-direct-text-color-global-remove');
		const directLayoutBgColor = document.getElementById('uichemy-composer-direct-layout-bg-color');
		const directLayoutBgColorPicker = document.getElementById('uichemy-composer-direct-layout-bg-color-picker');
		const directLayoutBgColorGlobalBtn = document.getElementById('uichemy-composer-direct-layout-bg-color-global-btn');
		const directLayoutBgColorInlineRemove = document.getElementById('uichemy-composer-direct-layout-bg-color-inline-remove');
		const directLayoutBgColorGlobalChip = document.getElementById('uichemy-composer-direct-layout-bg-color-global-chip');
		const directLayoutBgColorGlobalName = document.getElementById('uichemy-composer-direct-layout-bg-color-global-name');
		const directLayoutBgColorGlobalRemove = document.getElementById('uichemy-composer-direct-layout-bg-color-global-remove');
		const directLayoutBorderStyle = document.getElementById('uichemy-composer-direct-layout-border-style');
		const directLayoutBorderColor = document.getElementById('uichemy-composer-direct-layout-border-color');
		const directLayoutBorderColorPicker = document.getElementById('uichemy-composer-direct-layout-border-color-picker');
		const directLayoutBorderColorGlobalBtn = document.getElementById('uichemy-composer-direct-layout-border-color-global-btn');
		const directLayoutBorderColorInlineRemove = document.getElementById('uichemy-composer-direct-layout-border-color-inline-remove');
		const directLayoutBorderColorGlobalChip = document.getElementById('uichemy-composer-direct-layout-border-color-global-chip');
		const directLayoutBorderColorGlobalName = document.getElementById('uichemy-composer-direct-layout-border-color-global-name');
		const directLayoutBorderColorGlobalRemove = document.getElementById('uichemy-composer-direct-layout-border-color-global-remove');
		const directGlobalColorPopover = document.getElementById('uichemy-composer-direct-global-color-popover');
		const directLayoutDisplay = document.getElementById('uichemy-composer-direct-layout-display');
		const directLayoutPosition = document.getElementById('uichemy-composer-direct-layout-position');
		const layoutStyleFields = Array.from(panel.querySelectorAll('[data-layout-style]'));
		const sidesFields = Array.from(panel.querySelectorAll('.uichemy-composer-direct-sides-field'));
		const layoutStyleProperties = Array.from(new Set([
			...layoutStyleFields.map(field => field.getAttribute('data-layout-style')),
			...sidesFields.map(field => field.getAttribute('data-sides-type'))
		].filter(Boolean)));
		const directReset = document.getElementById('uichemy-composer-direct-reset');
		const directStatus = document.getElementById('uichemy-composer-direct-status');
		const chatLog = document.getElementById('uichemy-composer-chat-log');
		const chatInput = document.getElementById('uichemy-composer-chat-input');
		const chatSend = document.getElementById('uichemy-composer-chat-send');
		const chatClear = document.getElementById('uichemy-composer-chat-clear');
		const directLayerActionMenuEl = document.createElement('div');
		directLayerActionMenuEl.id = 'uichemy-composer-direct-layer-menu';
		directLayerActionMenuEl.className = 'uichemy-composer-direct-layer-menu';
		directLayerActionMenuEl.style.display = 'none';
		directLayerActionMenuEl.style.position = 'fixed';
		directLayerActionMenuEl.style.zIndex = '2147483647';
		directLayerActionMenuEl.setAttribute('role', 'menu');
		directLayerActionMenuEl.innerHTML = (
			'<button type="button" class="uichemy-composer-direct-layer-menu-item" role="menuitem" data-layer-action="copy">Copy</button>'
			+ '<button type="button" class="uichemy-composer-direct-layer-menu-item" role="menuitem" data-layer-action="cut">Cut</button>'
			+ '<button type="button" class="uichemy-composer-direct-layer-menu-item" role="menuitem" data-layer-action="paste">Paste</button>'
			+ '<button type="button" class="uichemy-composer-direct-layer-menu-item" role="menuitem" data-layer-action="delete">Delete</button>'
		);
		document.body.appendChild(directLayerActionMenuEl);
		let activeTab = 'direct';
		let selectedSlotIndex = 0;
		let selectedLayerId = '';
		let selectedAppliedClassToken = '';
		const collapsedLayerIds = new Set();
		let directLayerDragSourceId = '';
		let directLayerDragDidReorder = false;
		let directLayerDragGhostEl = null;
		let directLayerDropPlacement = 'before';
		let directLayerClipboardSerialized = '';
		let directLayerClipboardMode = 'copy';
		let directLayerMenuTargetLayerId = '';
		let autoExpandSelectedAncestors = true;
		let isDirectSyncing = false;
		/** Prevents color pickers' programmatic `value` updates from firing `input` and echoing into text fields (e.g. #000000 → class `color`). */
		let directColorPickerProgrammaticDepth = 0;
		function assignDirectColorPickerValue(picker, nextValue) {
			if (!picker) {
				return;
			}
			directColorPickerProgrammaticDepth += 1;
			try {
				picker.value = String(nextValue != null ? nextValue : '#000000');
			} finally {
				directColorPickerProgrammaticDepth -= 1;
			}
		}
		let directEditorV3TypographyNames = [];
		const directEditorV3TypographyByTitle = Object.create(null);
		const directEditorV3TypographyById = Object.create(null);
		const directEditorV3TypographyByClassToken = Object.create(null);
		const directAtomicClassByToken = Object.create(null);
		let directEditorV3ColorNames = [];
		const directEditorV3ColorById = Object.create(null);
		const directEditorV3ColorByTitle = Object.create(null);
		const directAtomicColorByVarName = Object.create(null);
		let activeDirectGlobalColorTarget = '';
		let directClassSuggestionTimer = null;
		let isChatSyncing = false;
		let chatBridgeSessionId = '';
		let chatPickPointerTimer = null;
		let directSvgPreviewObjectUrl = '';
		let directContextualClassTokens = [];
		/** @type {{ token: string, selector: string }[]} */
		let directContextualClassEntries = [];
		const directContextualSelectorByToken = Object.create(null);
		let selectedAppliedClassSelector = '';
		let selectedAppliedClassMediaText = '';
		let selectedAppliedClassBreakpointKey = '';
		/** @type {{ token: string, selector: string, mediaText: string }[]} */
		let directMediaClassEntries = [];
		let directCurrentElementorBreakpoint = '';
		let directBreakpointListenerBound = false;

		function getSelectedDirectSvgMode(isSvgElementLayer, isSvgUrlLayer) {
			if (directSvgMode && (directSvgMode.value === 'code' || directSvgMode.value === 'url')) {
				return directSvgMode.value;
			}
			return isSvgElementLayer ? 'code' : (isSvgUrlLayer ? 'url' : 'code');
		}

		function svgMarkupToPreviewDataUri(svgMarkup) {
			const markup = String(svgMarkup || '').trim();
			if (!markup || !/^<svg[\s>]/i.test(markup)) {
				return '';
			}
			try {
				if (directSvgPreviewObjectUrl && window.URL && typeof window.URL.revokeObjectURL === 'function') {
					window.URL.revokeObjectURL(directSvgPreviewObjectUrl);
					directSvgPreviewObjectUrl = '';
				}
				if (window.URL && typeof window.URL.createObjectURL === 'function' && window.Blob) {
					directSvgPreviewObjectUrl = window.URL.createObjectURL(
						new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
					);
					return directSvgPreviewObjectUrl;
				}
			} catch (e) { }
			return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
		}

		function syncDirectSvgCodePreviewFromMarkup(svgMarkup) {
			if (!directImagePreviewImg || !directImageEmpty || !directSvgMode) {
				return;
			}
			if (!isCurrentDirectLayerSvg() || directSvgMode.value !== 'code') {
				return;
			}
			const previewSrc = svgMarkupToPreviewDataUri(svgMarkup);
			if (previewSrc) {
				directImagePreviewImg.src = previewSrc;
				directImagePreviewImg.style.display = 'block';
				directImageEmpty.style.display = 'none';
			} else {
				directImagePreviewImg.removeAttribute('src');
				directImagePreviewImg.style.display = 'none';
				directImageEmpty.style.display = '';
			}
		}

		function clearDirectSvgPreviewObjectUrl() {
			if (directSvgPreviewObjectUrl && window.URL && typeof window.URL.revokeObjectURL === 'function') {
				window.URL.revokeObjectURL(directSvgPreviewObjectUrl);
				directSvgPreviewObjectUrl = '';
			}
		}

		function setActiveDirectSvgMode(nextMode) {
			const mode = String(nextMode || '').toLowerCase() === 'url' ? 'url' : 'code';
			if (directSvgMode) {
				directSvgMode.value = mode;
			}
			directSvgModeTabs.forEach((tabButton) => {
				const isActive = tabButton.getAttribute('data-uichemy-composer-direct-svg-mode') === mode;
				tabButton.classList.toggle('is-active', isActive);
				tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
			});
		}

		function setActiveTab(tabName) {
			activeTab = tabName;
			tabButtons.forEach(button => {
				const isActive = button.getAttribute('data-uichemy-composer-tab') === tabName;
				button.classList.toggle('is-active', isActive);
				button.setAttribute('aria-selected', isActive ? 'true' : 'false');
			});
			tabPanels.forEach(panelEl => {
				panelEl.classList.toggle('is-active', panelEl.getAttribute('data-uichemy-composer-panel') === tabName);
			});
			if (tabName === 'code') {
				requestAnimationFrame(() => {
					UichSHE.refreshUiChemyComposerCodeEditors();
				});
			}
		}

		function setActiveCodeRowTab(tabName) {
			UichSHE.uiChemyComposerActiveCodeRowTab = tabName;
			codeRowTabs.forEach((button) => {
				const isActive = button.getAttribute('data-uichemy-composer-code-tab') === tabName;
				button.classList.toggle('is-active', isActive);
				button.setAttribute('aria-selected', isActive ? 'true' : 'false');
			});
			codeRowPanels.forEach((panelEl) => {
				panelEl.classList.toggle('is-active', panelEl.getAttribute('data-uichemy-composer-code-panel') === tabName);
			});
			if (globalsPollTimer) {
				clearInterval(globalsPollTimer);
				globalsPollTimer = null;
			}
			if (tabName === 'site') {
				UichSHE.fetchSharedSiteCustomCode().then(() => {
					UichSHE.applySharedSiteCustomCodeToSettings(UichSHE.activeWidgetSettings, UichSHE.activePanelView);
					UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-site-head', UichSHE.sharedSiteCustomCode.head, false);
					UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-site-footer', UichSHE.sharedSiteCustomCode.footer, false);
				});
			}
			if (tabName === 'globals') {
				UichSHE.refreshUiChemyComposerGlobalsPanel();
				globalsPollTimer = setInterval(() => {
					UichSHE.refreshUiChemyComposerGlobalsPanel();
				}, 1200);
			}
			requestAnimationFrame(() => {
				UichSHE.refreshUiChemyComposerCodeEditors();
			});
		}

		function appendChatMessage(type, message) {
			if (!chatLog) return;
			const entry = document.createElement('div');
			entry.className = `uichemy-composer-chat-message ${type}`;
			entry.textContent = message;
			chatLog.appendChild(entry);
			chatLog.scrollTop = chatLog.scrollHeight;
		}

		function getTypographyTargetNode(node) {
			if (!node) return null;
			if (node.nodeType === Node.ELEMENT_NODE) {
				return node;
			}
			if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
				// For mixed heading structures like: h1 -> text + span,
				// typography should still target the parent heading element.
				return node.parentElement;
			}
			return null;
		}

		function hasDirectTextChild(node) {
			if (!node || node.nodeType !== Node.ELEMENT_NODE || !node.childNodes) {
				return false;
			}
			for (let i = 0; i < node.childNodes.length; i++) {
				const child = node.childNodes[i];
				if (child && child.nodeType === Node.TEXT_NODE && String(child.nodeValue || '').trim() !== '') {
					return true;
				}
			}
			return false;
		}

		function canEditTypographyTarget(node) {
			if (!node || node.nodeType !== Node.ELEMENT_NODE) {
				return false;
			}
			if (node.tagName === 'IMG') {
				return false;
			}
			if (node.tagName === 'DIV') {
				return hasDirectTextChild(node);
			}
			return true;
		}

		function resolveNodeByLayerPath(rootNode, path) {
			if (!rootNode || !path) return null;
			const segments = String(path).split('.').slice(1);
			let current = rootNode;
			for (let i = 0; i < segments.length; i++) {
				const childIndex = parseInt(segments[i], 10);
				const pathChildren = UichSHE.getPathRelevantChildren(current);
				if (!current || Number.isNaN(childIndex) || !pathChildren[childIndex]) {
					return null;
				}
				current = pathChildren[childIndex];
			}
			return current;
		}

		const DIRECT_LAYER_CLIP_PREFIX = '__UICH_UC_LAYER__:';

		function persistDirectHtmlFromDoc(doc) {
			const nextHtml = doc.innerHTML;
			UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
			markEditorDirty();
			if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
				const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
				if (input.length && input.val() !== nextHtml) {
					input.val(nextHtml).trigger('input').trigger('change');
				}
			}
		}

		function serializeDirectLayerNode(node) {
			if (!node) {
				return '';
			}
			if (node.nodeType === Node.TEXT_NODE) {
				return DIRECT_LAYER_CLIP_PREFIX + JSON.stringify({
					v: 1,
					k: 'text',
					t: node.nodeValue
				});
			}
			if (node.nodeType === Node.ELEMENT_NODE) {
				const holder = document.createElement('div');
				holder.appendChild(node.cloneNode(true));
				return DIRECT_LAYER_CLIP_PREFIX + JSON.stringify({
					v: 1,
					k: 'element',
					t: holder.innerHTML
				});
			}
			return '';
		}

		function closeDirectLayerActionMenu() {
			if (!directLayerActionMenuEl) {
				return;
			}
			directLayerActionMenuEl.style.display = 'none';
			directLayerMenuTargetLayerId = '';
		}

		function positionDirectLayerActionMenu(anchorEl) {
			if (!directLayerActionMenuEl || !anchorEl) {
				return;
			}
			directLayerActionMenuEl.style.display = 'block';
			const r = anchorEl.getBoundingClientRect();
			const mw = directLayerActionMenuEl.offsetWidth || 160;
			const mh = directLayerActionMenuEl.offsetHeight || 120;
			let left = Math.round(r.right - mw);
			let top = Math.round(r.bottom + 4);
			const pad = 6;
			if (left < pad) {
				left = pad;
			}
			if (left + mw > window.innerWidth - pad) {
				left = Math.max(pad, window.innerWidth - mw - pad);
			}
			if (top + mh > window.innerHeight - pad) {
				top = Math.max(pad, Math.round(r.top - mh - 4));
			}
			directLayerActionMenuEl.style.left = `${left}px`;
			directLayerActionMenuEl.style.top = `${top}px`;
		}

		function openDirectLayerActionMenu(anchorEl, layerId) {
			if (!directLayerActionMenuEl || !anchorEl || !layerId) {
				return;
			}
			directLayerMenuTargetLayerId = layerId;
			const pasteBtn = directLayerActionMenuEl.querySelector('[data-layer-action="paste"]');
			if (pasteBtn) {
				pasteBtn.disabled = !directLayerClipboardSerialized;
			}
			positionDirectLayerActionMenu(anchorEl);
		}

		function commitDirectLayerDragMove(dragLayerId, dropLayerId, dropPlacement) {
			if (!UichSHE.activeWidgetSettings || !dragLayerId || !dropLayerId || dragLayerId === dropLayerId) {
				return false;
			}
			const placement = dropPlacement === 'after' ? 'after' : 'before';
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') {
				return false;
			}

			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const layerRoot = UichSHE.getLayerRoot(doc);
			if (!layerRoot) {
				return false;
			}

			const slotNodesBefore = UichSHE.extractTextNodes(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, slotNodesBefore);
			const entryById = new Map(layerEntries.map((e) => [e.id, e]));
			const dragEntry = entryById.get(dragLayerId);
			const dropEntry = entryById.get(dropLayerId);
			if (!dragEntry || !dropEntry) {
				return false;
			}

			const dragNode = resolveNodeByLayerPath(layerRoot, dragEntry.path);
			const dropNode = resolveNodeByLayerPath(layerRoot, dropEntry.path);
			if (!dragNode || !dropNode) {
				return false;
			}
			if (!layerRoot.contains(dragNode) || !layerRoot.contains(dropNode)) {
				return false;
			}
			if (dragNode.contains(dropNode)) {
				return false;
			}

			const parent = dropNode.parentNode;
			if (!parent || !layerRoot.contains(parent)) {
				return false;
			}

			if (placement === 'before') {
				if (dragNode.parentNode === parent && dragNode.nextSibling === dropNode) {
					return false;
				}
				parent.insertBefore(dragNode, dropNode);
			} else {
				if (dragNode.parentNode === parent && dragNode.previousSibling === dropNode) {
					return false;
				}
				parent.insertBefore(dragNode, dropNode.nextSibling);
			}

			const selectedEntry = selectedLayerId ? entryById.get(selectedLayerId) : null;
			let selectionAnchorNode = null;
			if (selectedEntry && selectedEntry.path) {
				selectionAnchorNode = resolveNodeByLayerPath(layerRoot, selectedEntry.path);
			}
			if (!selectionAnchorNode && selectedEntry && typeof selectedEntry.slotIndex === 'number') {
				selectionAnchorNode = slotNodesBefore[selectedEntry.slotIndex] || null;
			}

			persistDirectHtmlFromDoc(doc);

			const slotNodesAfter = UichSHE.extractTextNodes(doc);
			const nextLayerEntries = UichSHE.extractLayerEntries(layerRoot, slotNodesAfter);

			function remapEntryIdFromDomNode(node) {
				if (!node || !layerRoot.contains(node)) {
					return;
				}
				const nextPath = UichSHE.normalizeLayerPath(
					UichSHE.getPreviewElementLayerPath(node, layerRoot) || ''
				);
				const matched = nextPath
					? nextLayerEntries.find((ent) => ent.path === nextPath)
					: null;
				if (matched) {
					selectedLayerId = matched.id;
					if (typeof matched.slotIndex === 'number') {
						selectedSlotIndex = matched.slotIndex;
					}
				}
			}

			if (selectionAnchorNode) {
				remapEntryIdFromDomNode(selectionAnchorNode);
			}

			syncDirectInputsFromSelection();
			return true;
		}

		function directLayerRemapSelectionToNode(layerRoot, node, entriesAfter) {
			if (!node || !layerRoot.contains(node)) {
				const fallback = entriesAfter[0] || null;
				if (fallback) {
					selectedLayerId = fallback.id;
					if (typeof fallback.slotIndex === 'number') {
						selectedSlotIndex = fallback.slotIndex;
					}
				} else {
					selectedLayerId = '';
				}
				return;
			}
			const nextPath = UichSHE.normalizeLayerPath(
				UichSHE.getPreviewElementLayerPath(node, layerRoot) || ''
			);
			const matched = nextPath
				? entriesAfter.find((ent) => ent.path === nextPath)
				: null;
			if (matched) {
				selectedLayerId = matched.id;
				if (typeof matched.slotIndex === 'number') {
					selectedSlotIndex = matched.slotIndex;
				}
			} else {
				const fallback = entriesAfter[0] || null;
				if (fallback) {
					selectedLayerId = fallback.id;
					if (typeof fallback.slotIndex === 'number') {
						selectedSlotIndex = fallback.slotIndex;
					}
				} else {
					selectedLayerId = '';
				}
			}
		}

		function directLayerCopyFromLayerId(layerId, mode) {
			if (!UichSHE.activeWidgetSettings || !layerId) {
				return false;
			}
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') {
				return false;
			}
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const layerRoot = UichSHE.getLayerRoot(doc);
			if (!layerRoot) {
				return false;
			}
			const slotNodes = UichSHE.extractTextNodes(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, slotNodes);
			const entry = layerEntries.find((e) => e.id === layerId);
			if (!entry || !entry.path) {
				return false;
			}
			const node = resolveNodeByLayerPath(layerRoot, entry.path);
			if (!node || !layerRoot.contains(node)) {
				return false;
			}
			const serialized = serializeDirectLayerNode(node);
			if (!serialized) {
				return false;
			}
			directLayerClipboardSerialized = serialized;
			directLayerClipboardMode = mode === 'cut' ? 'cut' : 'copy';
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(serialized);
				}
			} catch (clipErr) {
				// ignore
			}
			if (mode === 'cut') {
				const parent = node.parentNode;
				if (!parent || !layerRoot.contains(parent)) {
					return false;
				}
				const kidsBefore = UichSHE.getPathRelevantChildren(parent);
				const ix = kidsBefore.indexOf(node);
				node.remove();
				persistDirectHtmlFromDoc(doc);
				const slotAfter = UichSHE.extractTextNodes(doc);
				const entriesAfter = UichSHE.extractLayerEntries(layerRoot, slotAfter);
				const afterKids = UichSHE.getPathRelevantChildren(parent);
				let anchor = afterKids[ix] || afterKids[ix - 1] || null;
				if (!anchor || !layerRoot.contains(anchor)) {
					anchor = (parent && layerRoot.contains(parent)) ? parent : layerRoot;
				}
				directLayerRemapSelectionToNode(layerRoot, anchor === layerRoot ? (afterKids[0] || null) : anchor, entriesAfter);
				syncDirectInputsFromSelection();
				return true;
			}
			syncDirectInputsFromSelection();
			return true;
		}

		function directLayerPasteBeforeLayerId(targetLayerId) {
			if (!UichSHE.activeWidgetSettings || !targetLayerId || !directLayerClipboardSerialized) {
				return false;
			}
			const clip = String(directLayerClipboardSerialized || '').trim();
			if (clip.indexOf(DIRECT_LAYER_CLIP_PREFIX) !== 0) {
				return false;
			}
			let parsed;
			try {
				parsed = JSON.parse(clip.slice(DIRECT_LAYER_CLIP_PREFIX.length));
			} catch (parseErr) {
				return false;
			}
			if (!parsed || parsed.v !== 1) {
				return false;
			}
			const wrap = document.createElement('div');
			if (parsed.k === 'text') {
				wrap.appendChild(document.createTextNode(parsed.t != null ? String(parsed.t) : ''));
			} else if (parsed.k === 'element') {
				wrap.innerHTML = String(parsed.t || '');
			} else {
				return false;
			}
			if (!wrap.firstChild) {
				return false;
			}

			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') {
				return false;
			}
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const layerRoot = UichSHE.getLayerRoot(doc);
			if (!layerRoot) {
				return false;
			}
			const slotNodesBefore = UichSHE.extractTextNodes(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, slotNodesBefore);
			const entry = layerEntries.find((e) => e.id === targetLayerId);
			if (!entry || !entry.path) {
				return false;
			}
			const targetNode = resolveNodeByLayerPath(layerRoot, entry.path);
			if (!targetNode || !layerRoot.contains(targetNode)) {
				return false;
			}
			if (targetNode.nodeType !== Node.ELEMENT_NODE) {
				return false;
			}
			for (let c = wrap.firstChild; c; c = c.nextSibling) {
				if (c.nodeType === Node.ELEMENT_NODE && typeof c.contains === 'function' && c.contains(targetNode)) {
					return false;
				}
			}
			let firstInserted = null;
			while (wrap.firstChild) {
				const child = wrap.firstChild;
				if (!firstInserted) {
					firstInserted = child;
				}
				targetNode.appendChild(child);
			}
			persistDirectHtmlFromDoc(doc);
			const wasCut = directLayerClipboardMode === 'cut';
			if (wasCut) {
				directLayerClipboardSerialized = '';
				directLayerClipboardMode = 'copy';
			}
			const slotAfter = UichSHE.extractTextNodes(doc);
			const entriesAfter = UichSHE.extractLayerEntries(layerRoot, slotAfter);
			directLayerRemapSelectionToNode(layerRoot, firstInserted, entriesAfter);
			syncDirectInputsFromSelection();
			return true;
		}

		function directLayerDeleteLayerId(layerId) {
			if (!UichSHE.activeWidgetSettings || !layerId) {
				return false;
			}
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') {
				return false;
			}
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const layerRoot = UichSHE.getLayerRoot(doc);
			if (!layerRoot) {
				return false;
			}
			const slotNodes = UichSHE.extractTextNodes(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, slotNodes);
			const entry = layerEntries.find((e) => e.id === layerId);
			if (!entry || !entry.path) {
				return false;
			}
			const node = resolveNodeByLayerPath(layerRoot, entry.path);
			if (!node || !layerRoot.contains(node)) {
				return false;
			}
			const parent = node.parentNode;
			if (!parent || !layerRoot.contains(parent)) {
				return false;
			}
			const kidsBefore = UichSHE.getPathRelevantChildren(parent);
			const ix = kidsBefore.indexOf(node);
			node.remove();
			persistDirectHtmlFromDoc(doc);
			const slotAfter = UichSHE.extractTextNodes(doc);
			const entriesAfter = UichSHE.extractLayerEntries(layerRoot, slotAfter);
			const afterKids = UichSHE.getPathRelevantChildren(parent);
			let anchor = afterKids[ix] || afterKids[ix - 1] || null;
			if (!anchor || !layerRoot.contains(anchor)) {
				anchor = (parent && layerRoot.contains(parent)) ? parent : layerRoot;
			}
			directLayerRemapSelectionToNode(layerRoot, anchor === layerRoot ? (afterKids[0] || null) : anchor, entriesAfter);
			syncDirectInputsFromSelection();
			return true;
		}

		function colorStringToPickerHex(value) {
			const raw = String(value || '').trim();
			if (!raw) return '#000000';
			const probe = document.createElement('span');
			probe.style.color = '';
			probe.style.color = raw;
			if (!probe.style.color) return '#000000';
			document.body.appendChild(probe);
			const computed = window.getComputedStyle(probe).color;
			probe.remove();
			const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
			if (!match) return '#000000';
			const r = Number(match[1]).toString(16).padStart(2, '0');
			const g = Number(match[2]).toString(16).padStart(2, '0');
			const b = Number(match[3]).toString(16).padStart(2, '0');
			return `#${r}${g}${b}`;
		}

		function getInlineStyleValue(style, property) {
			if (!style || !property) return '';
			const direct = style.getPropertyValue(property);
			if (direct) return direct;
			return '';
		}

		function getResolvedStyleSnapshot(rawHtml, rawCss, layerPath, layoutProperties) {
			const styles = {};
			const declaredProperties = new Set();
			const result = {
				className: '',
				styles,
				declaredProperties
			};
			if (!rawHtml || !layerPath) return result;

			const sandbox = document.createElement('div');
			sandbox.style.position = 'absolute';
			sandbox.style.left = '-99999px';
			sandbox.style.top = '-99999px';
			sandbox.style.visibility = 'hidden';
			sandbox.style.pointerEvents = 'none';

			const styleTag = document.createElement('style');
			styleTag.textContent = rawCss || '';
			const wrapper = document.createElement('div');
			wrapper.innerHTML = rawHtml;
			sandbox.appendChild(styleTag);
			sandbox.appendChild(wrapper);
			document.body.appendChild(sandbox);

			try {
				const layerRoot = UichSHE.getLayerRoot(wrapper);
				const layerNode = resolveNodeByLayerPath(layerRoot, layerPath);
				const targetNode = getTypographyTargetNode(layerNode);
				if (!targetNode || targetNode.nodeType !== Node.ELEMENT_NODE) {
					return result;
				}

				result.className = getDomElementClassString(targetNode).trim();

				const computed = window.getComputedStyle(targetNode);
				const tracked = [
					'font-size',
					'font-family',
					'font-weight',
					'line-height',
					'text-align',
					'font-style',
					'letter-spacing',
					'text-transform',
					'text-decoration',
					'color',
					...layoutProperties
				];

				tracked.forEach((property) => {
					const inlineValue = targetNode.style.getPropertyValue(property);
					if (inlineValue && inlineValue.trim() !== '') {
						declaredProperties.add(property);
					}
				});

				function selectorTargetsElementDirectly(selectorText) {
					if (!selectorText) return false;
					const matchesSelector = (selector) => {
						if (!selector) return false;
						try {
							return !!targetNode.matches(selector);
						} catch (e) {
							return false;
						}
					};
					const getTerminalSelector = (selector) => {
						const raw = String(selector || '').trim();
						if (!raw) return '';
						// Fallback for context selectors like ".hero-content h1 span":
						// when ancestor context is unavailable in sandbox, match by terminal part.
						const parts = raw.split(/[\s>+~]+/).filter(Boolean);
						if (!parts.length) return '';
						let terminal = String(parts[parts.length - 1] || '').trim();
						if (!terminal || terminal.indexOf('::') !== -1) {
							return '';
						}
						terminal = terminal.replace(/:(before|after|first-line|first-letter|selection|backdrop|placeholder)$/i, '').trim();
						return terminal;
					};
					const parts = String(selectorText).split(',');
					for (let i = 0; i < parts.length; i++) {
						const selector = parts[i].trim();
						if (!selector) continue;
						if (matchesSelector(selector)) {
							return true;
						}
						const terminalSelector = getTerminalSelector(selector);
						if (terminalSelector && matchesSelector(terminalSelector)) {
							return true;
						}
						// Keep matched contextual selectors (e.g. ".hero span") so Direct Editor
						// can surface where a value originates from in authored CSS.
					}
					return false;
				}

				function collectDeclaredFromRules(rules) {
					if (!rules) return;
					for (let i = 0; i < rules.length; i++) {
						const rule = rules[i];
						if (!rule) continue;
						if (rule.type === 1 && rule.selectorText) {
							if (!selectorTargetsElementDirectly(rule.selectorText)) continue;
							tracked.forEach((property) => {
								const val = rule.style && rule.style.getPropertyValue(property);
								if (val && String(val).trim() !== '') {
									declaredProperties.add(property);
								}
							});
						} else if (rule.cssRules && rule.cssRules.length) {
							collectDeclaredFromRules(rule.cssRules);
						}
					}
				}

				try {
					const styleSheets = [styleTag].concat(Array.from(wrapper.querySelectorAll('style')));
					styleSheets.forEach((styleEl) => {
						if (styleEl && styleEl.sheet && styleEl.sheet.cssRules) {
							collectDeclaredFromRules(styleEl.sheet.cssRules);
						}
					});
				} catch (e) {
					// Ignore stylesheet parsing failures and fallback to inline declarations.
				}

				[
					'font-size',
					'font-family',
					'font-weight',
					'line-height',
					'text-align',
					'font-style',
					'letter-spacing',
					'text-transform',
					'text-decoration',
					'color',
					...layoutProperties
				].forEach((property) => {
					styles[property] = computed.getPropertyValue(property) || '';
				});
			} finally {
				sandbox.remove();
			}

			return result;
		}

		function setLayoutControlVisibility(options) {
			const displayValue = String((options && options.display) || '').trim().toLowerCase();
			const positionValue = String((options && options.position) || '').trim().toLowerCase();
			const canEditLayout = !!(options && options.canEditLayout);
			const readOnlyByBreakpoint = !!(options && options.readOnlyByBreakpoint);

			const showForDisplay = function (value, allowed) {
				return allowed.indexOf(value) !== -1;
			};

			layoutStyleFields.forEach((field) => {
				const property = field.getAttribute('data-layout-style');
				const fieldWrap = field.closest('.uichemy-composer-direct-field-input');
				if (!fieldWrap || !property) return;

				let isContextVisible = true;
				if (property === 'top' || property === 'right' || property === 'bottom' || property === 'left') {
					isContextVisible = positionValue === 'absolute';
				} else if (property === 'z-index') {
					isContextVisible = positionValue === 'absolute' || positionValue === 'relative' || positionValue === 'fixed' || positionValue === 'sticky';
				} else if (property === 'flex-direction' || property === 'flex-wrap' || property === 'justify-content' || property === 'align-items') {
					isContextVisible = showForDisplay(displayValue, ['flex', 'inline-flex']);
				} else if (property === 'gap' || property === 'row-gap' || property === 'column-gap') {
					isContextVisible = showForDisplay(displayValue, ['flex', 'inline-flex', 'grid', 'inline-grid']);
				} else if (property === 'grid-template-columns' || property === 'grid-template-rows' || property === 'grid-column' || property === 'grid-row') {
					isContextVisible = showForDisplay(displayValue, ['grid', 'inline-grid']);
				}

				fieldWrap.style.display = isContextVisible ? '' : 'none';
				field.disabled = !canEditLayout || !isContextVisible || readOnlyByBreakpoint;
				fieldWrap.setAttribute('aria-hidden', isContextVisible ? 'false' : 'true');
			});

			updateBorderControlVisibility();
		}

		function updateBorderControlVisibility() {
			if (!directLayoutBorderStyle) return;
			const style = String(directLayoutBorderStyle.value || '').trim();
			const borderWidthField = sidesFields.find((f) => f.getAttribute('data-sides-type') === 'border-width');
			let hasDraftBorderWidth = false;
			if (borderWidthField) {
				const bwInputs = Array.from(borderWidthField.querySelectorAll('.uichemy-composer-side-input'));
				hasDraftBorderWidth = bwInputs.some((i) => String(i.value || '').trim() !== '');
			}
			const show = (style && style !== 'none') || hasDraftBorderWidth;

			sidesFields.forEach(field => {
				if (field.getAttribute('data-sides-type') === 'border-width') {
					field.style.display = show ? '' : 'none';
				}
			});

			if (directLayoutBorderColor) {
				const wrap = directLayoutBorderColor.closest('.uichemy-composer-direct-field-input');
				if (wrap) wrap.style.display = show ? '' : 'none';
			}
		}

		function rebuildDirectTypographyCaches(typographyMap) {
			const names = uiChemyComposerCollectV3TypographyTitles(typographyMap || {});
			const lookupByTitle = uiChemyComposerBuildV3TypographyLookup((typographyMap) || {});
			const lookupById = Object.create(null);
			const lookupByClassToken = Object.create(null);
			Object.values(typographyMap || {}).forEach((item) => {
				if (!item || uiChemyComposerShouldSkipGlobalItem(item)) {
					return;
				}
				const id = String(item.id || '').trim();
				if (!id || lookupById[id]) {
					return;
				}
				const value = item.value || {};
				lookupById[id] = value;
				lookupByClassToken[`text-${id}`.toLowerCase()] = value;
			});

			directEditorV3TypographyNames = names;
			Object.keys(directEditorV3TypographyByTitle).forEach((key) => delete directEditorV3TypographyByTitle[key]);
			Object.keys(lookupByTitle).forEach((key) => {
				directEditorV3TypographyByTitle[key] = lookupByTitle[key];
			});
			Object.keys(directEditorV3TypographyById).forEach((key) => delete directEditorV3TypographyById[key]);
			Object.keys(lookupById).forEach((key) => {
				directEditorV3TypographyById[key] = lookupById[key];
			});
			Object.keys(directEditorV3TypographyByClassToken).forEach((key) => delete directEditorV3TypographyByClassToken[key]);
			Object.keys(lookupByClassToken).forEach((key) => {
				directEditorV3TypographyByClassToken[key] = lookupByClassToken[key];
			});
		}

		function ensureDirectEditorV3TypographyNameCache() {
			try {
				const live = uiChemyComposerGetLiveKitGlobalsMaps();
				if (live && live.typography) {
					rebuildDirectTypographyCaches(live.typography);
					return;
				}
				if (directEditorV3TypographyNames.length) {
					return;
				}
				if (!$e || !$e.data || typeof $e.data.get !== 'function') {
					return;
				}
				uiChemyComposerFetchGlobalsIndexFresh().then((data) => {
					const typographyMap = (data && data.typography) || {};
					rebuildDirectTypographyCaches(typographyMap);
				});
			} catch (err) {
				// Ignore cache failures.
			}
		}

		function rebuildDirectColorCaches(colorsMap) {
			const names = [];
			const lookupById = Object.create(null);
			const lookupByTitle = Object.create(null);
			Object.values(colorsMap || {}).forEach((item) => {
				if (!item || uiChemyComposerShouldSkipGlobalItem(item)) {
					return;
				}
				const id = String(item.id || '').trim();
				if (!id) {
					return;
				}
				const title = String(item.title || '').trim() || id;
				const value = String(item.value || '').trim();
				if (lookupById[id]) {
					return;
				}
				lookupById[id] = { id, title, value };
				if (!lookupByTitle[title]) {
					lookupByTitle[title] = { id, title, value };
				}
				names.push(title);
			});
			directEditorV3ColorNames = names.sort((a, b) => a.localeCompare(b));
			Object.keys(directEditorV3ColorById).forEach((key) => delete directEditorV3ColorById[key]);
			Object.keys(lookupById).forEach((key) => {
				directEditorV3ColorById[key] = lookupById[key];
			});
			Object.keys(directEditorV3ColorByTitle).forEach((key) => delete directEditorV3ColorByTitle[key]);
			Object.keys(lookupByTitle).forEach((key) => {
				directEditorV3ColorByTitle[key] = lookupByTitle[key];
			});
		}

		function rebuildDirectAtomicCaches(atomicSnapshot) {
			const snapshot = atomicSnapshot || { variables: [], classes: [] };
			Object.keys(directAtomicColorByVarName).forEach((key) => delete directAtomicColorByVarName[key]);
			(snapshot.variables || []).forEach((item) => {
				const type = String((item && item.type) || '').trim();
				if (!item || type.indexOf('color-variable') === -1) {
					return;
				}
				const id = String(item.id || '').trim();
				const label = String(item.label || item.id || '').trim();
				const value = uiChemyComposerResolveAtomicCssValue(item && item.value);
				const varCandidates = [];
				if (label) {
					varCandidates.push(`--${label.replace(/^\-+/, '')}`);
				}
				if (id) {
					varCandidates.push(`--${id.replace(/^\-+/, '')}`);
				}
				varCandidates.forEach((varName) => {
					if (!varName) {
						return;
					}
					directAtomicColorByVarName[varName] = {
						id,
						label,
						value,
						varName,
					};
				});
			});

			Object.keys(directAtomicClassByToken).forEach((key) => delete directAtomicClassByToken[key]);
			(snapshot.classes || []).forEach((item) => {
				const token = sanitizeNewClassToken(item && item.label ? item.label : '');
				if (!token) {
					return;
				}
				const styleMap = {};
				typographyPresetStyleProperties.forEach((property) => {
					styleMap[property] = '';
				});
				const variants = Array.isArray(item.variants) ? item.variants : [];
				variants.forEach((variant) => {
					const props = variant && variant.props && typeof variant.props === 'object' ? variant.props : {};
					typographyPresetStyleProperties.forEach((property) => {
						if (styleMap[property]) {
							return;
						}
						const raw = props[property];
						if (raw === undefined || raw === null || raw === '') {
							return;
						}
						const resolved = uiChemyComposerResolveAtomicCssValue(raw);
						if (resolved) {
							styleMap[property] = resolved;
						}
					});
				});
				directAtomicClassByToken[token.toLowerCase()] = {
					id: String(item.id || '').trim(),
					token,
					label: String(item.label || '').trim(),
					styleMap,
				};
			});
		}

		function ensureDirectEditorV3ColorCache() {
			try {
				const live = uiChemyComposerGetLiveKitGlobalsMaps();
				if (live && live.colors) {
					rebuildDirectColorCaches(live.colors);
					return;
				}
				if (directEditorV3ColorNames.length) {
					return;
				}
				if (!$e || !$e.data || typeof $e.data.get !== 'function') {
					return;
				}
				uiChemyComposerFetchGlobalsIndexFresh().then((data) => {
					rebuildDirectColorCaches((data && data.colors) || {});
				});
			} catch (err) {
				// Ignore cache failures.
			}
		}

		function buildDimensionValue(top, right, bottom, left, unit, isLinked) {
			const t = String(top || '').trim();
			const r = String(right || '').trim();
			const b = String(bottom || '').trim();
			const l = String(left || '').trim();

			if (!t && !r && !b && !l) return '';

			const format = (v) => {
				if (!v || v === '0') return '0';
				return v + unit;
			};

			if (isLinked) {
				const val = format(t || '0');
				return val;
			}

			const valT = format(t || '0');
			const valR = format(r || '0');
			const valB = format(b || '0');
			const valL = format(l || '0');

			if (valT === valR && valT === valB && valT === valL) return valT;
			if (valT === valB && valR === valL) return `${valT} ${valR}`;
			if (valR === valL) return `${valT} ${valR} ${valB}`;
			return `${valT} ${valR} ${valB} ${valL}`;
		}

		function parseDimensionValue(value) {
			if (!value) return { top: '', right: '', bottom: '', left: '', unit: 'px' };
			const parts = String(value).split(/\s+/).filter(Boolean);
			let unit = 'px';
			const rawValues = parts.map(p => {
				const match = p.match(/^([-+]?[0-9]*\.?[0-9]+)(.*)$/);
				if (match) {
					unit = match[2] || unit;
					return match[1];
				}
				return p;
			});

			let top = '', right = '', bottom = '', left = '';
			if (rawValues.length === 1) {
				top = right = bottom = left = rawValues[0];
			} else if (rawValues.length === 2) {
				top = bottom = rawValues[0];
				right = left = rawValues[1];
			} else if (rawValues.length === 3) {
				top = rawValues[0];
				right = left = rawValues[1];
				bottom = rawValues[2];
			} else if (rawValues.length >= 4) {
				top = rawValues[0];
				right = rawValues[1];
				bottom = rawValues[2];
				left = rawValues[3];
			}
			return { top, right, bottom, left, unit };
		}

		function directBorderWidthCssShowsStroke(cssValue) {
			const parsed = parseDimensionValue(String(cssValue || '').trim());
			return ['top', 'right', 'bottom', 'left'].some((side) => {
				const raw = String(parsed[side] || '').trim();
				if (raw === '') {
					return false;
				}
				const n = parseFloat(raw);
				return !Number.isNaN(n) && n !== 0;
			});
		}

		function normalizeCssColorToHex(value) {
			const raw = String(value || '').trim();
			if (!raw) {
				return null;
			}
			if (/^var\(/i.test(raw)) {
				return null;
			}
			const probe = document.createElement('span');
			probe.style.color = '';
			probe.style.color = raw;
			if (!probe.style.color) {
				return null;
			}
			document.body.appendChild(probe);
			const computed = window.getComputedStyle(probe).color;
			probe.remove();
			const match = computed.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
			if (!match) {
				return null;
			}
			const alpha = match[4] != null ? Number(match[4]) : 1;
			if (!(alpha > 0)) {
				return null;
			}
			const r = Number(match[1]).toString(16).padStart(2, '0');
			const g = Number(match[2]).toString(16).padStart(2, '0');
			const b = Number(match[3]).toString(16).padStart(2, '0');
			return alpha < 1
				? `#${r}${g}${b}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`.toLowerCase()
				: `#${r}${g}${b}`.toLowerCase();
		}

		function findGlobalColorIdByValue(value) {
			const targetHex = normalizeCssColorToHex(value);
			if (!targetHex) {
				return '';
			}
			let foundId = '';
			Object.keys(directEditorV3ColorById).forEach((id) => {
				if (foundId) return;
				const item = directEditorV3ColorById[id];
				if (!item || !item.value) return;
				const itemHex = normalizeCssColorToHex(item.value);
				if (itemHex && itemHex === targetHex) {
					foundId = `v3:${id}`;
				}
			});
			if (!foundId) {
				Object.keys(directAtomicColorByVarName).forEach((varName) => {
					if (foundId) return;
					const item = directAtomicColorByVarName[varName];
					if (!item || !item.value) return;
					const itemHex = normalizeCssColorToHex(item.value);
					if (itemHex && itemHex === targetHex) {
						foundId = `atomic:${varName}`;
					}
				});
			}
			return foundId;
		}

		function parseGlobalColorVarId(value) {
			const s = String(value || '').trim();
			const v3Match = s.match(/^var\(\s*--e-global-color-([a-z0-9_-]+)\s*\)$/i);
			if (v3Match) {
				return `v3:${String(v3Match[1] || '').trim()}`;
			}
			const anyMatch = s.match(/^var\(\s*(--[a-z0-9_-]+)\s*\)$/i);
			if (!anyMatch) {
				return '';
			}
			const varName = String(anyMatch[1] || '').trim();
			if (!varName) {
				return '';
			}
			if (directAtomicColorByVarName[varName]) {
				return `atomic:${varName}`;
			}
			return '';
		}

		function getDirectGlobalColorFieldConfig(targetKey) {
			if (targetKey === 'text') {
				return {
					field: directTextColor,
					picker: directTextColorPicker,
					chip: directTextColorGlobalChip,
					name: directTextColorGlobalName,
				};
			}
			if (targetKey === 'background') {
				return {
					field: directLayoutBgColor,
					picker: directLayoutBgColorPicker,
					chip: directLayoutBgColorGlobalChip,
					name: directLayoutBgColorGlobalName,
				};
			}
			if (targetKey === 'border') {
				return {
					field: directLayoutBorderColor,
					picker: directLayoutBorderColorPicker,
					chip: directLayoutBorderColorGlobalChip,
					name: directLayoutBorderColorGlobalName,
				};
			}
			return null;
		}

		function syncDirectGlobalColorChip(targetKey, globalId) {
			const config = getDirectGlobalColorFieldConfig(targetKey);
			if (!config || !config.field) {
				return;
			}
			const field = config.field;
			if (!globalId) {
				if (field.dataset) {
					delete field.dataset.ucGlobalColorId;
					delete field.dataset.ucGlobalColorVar;
					delete field.dataset.ucGlobalColorName;
				}
				if (config.chip) {
					config.chip.hidden = true;
				}
				if (config.name) {
					config.name.textContent = '';
				}
				return;
			}
			ensureDirectEditorV3ColorCache();
			const token = String(globalId || '');
			const isAtomic = token.indexOf('atomic:') === 0;
			const atomicVarName = isAtomic ? token.slice(7) : '';
			const v3Id = token.indexOf('v3:') === 0 ? token.slice(3) : token;
			const colorItem = isAtomic
				? (directAtomicColorByVarName[atomicVarName] || null)
				: (directEditorV3ColorById[v3Id] || null);
			const displayName = colorItem ? (colorItem.title || colorItem.label || v3Id || atomicVarName) : token;
			if (field.dataset) {
				field.dataset.ucGlobalColorId = token;
				field.dataset.ucGlobalColorVar = isAtomic ? `var(${atomicVarName})` : `var(--e-global-color-${v3Id})`;
				field.dataset.ucGlobalColorName = displayName;
			}
			if (config.name) {
				config.name.textContent = displayName;
			}
			if (config.chip) {
				config.chip.hidden = true;
			}
		}

		function collectWidgetUsedGlobalColorIds(rawCss) {
			const css = String(rawCss || '');
			const out = [];
			const seen = new Set();
			const re = /var\(\s*(--[a-z0-9_-]+)\s*\)/ig;
			let match = null;
			while ((match = re.exec(css)) !== null) {
				const varName = String(match[1] || '').trim();
				if (!varName || seen.has(varName)) {
					continue;
				}
				seen.add(varName);
				if (/^--e-global-color-/i.test(varName)) {
					out.push(`v3:${varName.replace(/^--e-global-color-/i, '')}`);
				} else {
					out.push(`atomic:${varName}`);
				}
			}
			return out;
		}

		function hideDirectGlobalColorPopover() {
			if (!directGlobalColorPopover) {
				return;
			}
			directGlobalColorPopover.hidden = true;
			directGlobalColorPopover.innerHTML = '';
			activeDirectGlobalColorTarget = '';
		}

		function applyDirectGlobalColorSelection(targetKey, globalId) {
			const config = getDirectGlobalColorFieldConfig(targetKey);
			if (!config || !config.field) {
				return;
			}
			const token = String(globalId || '');
			const isAtomic = token.indexOf('atomic:') === 0;
			const atomicVarName = isAtomic ? token.slice(7) : '';
			const v3Id = token.indexOf('v3:') === 0 ? token.slice(3) : token;
			const colorItem = isAtomic
				? (directAtomicColorByVarName[atomicVarName] || null)
				: (directEditorV3ColorById[v3Id] || null);
			if (!colorItem) {
				return;
			}
			const field = config.field;
			const nextVar = isAtomic ? `var(${atomicVarName})` : `var(--e-global-color-${v3Id})`;
			field.value = colorItem.title || colorItem.label || v3Id || atomicVarName;
			if (field.dataset) {
				// Force the next commit cycle to detect this as a real user change.
				field.dataset.ucDisplayValue = '';
				field.dataset.ucGlobalColorVar = nextVar;
				field.dataset.ucGlobalColorName = colorItem.title || colorItem.label || v3Id || atomicVarName;
				field.dataset.ucGlobalColorId = token;
			}
			if (config.picker && colorItem.value) {
				config.picker.value = colorStringToPickerHex(colorItem.value);
			}
			syncDirectGlobalColorChip(targetKey, token);
			debouncedDirectTypographyCommit();
		}

		function openDirectGlobalColorPopover(targetKey, anchorEl) {
			if (!directGlobalColorPopover || !anchorEl) {
				return;
			}
			if (directGlobalColorPopover.parentNode !== document.body) {
				document.body.appendChild(directGlobalColorPopover);
			}
			const rect = anchorEl.getBoundingClientRect();
			const popoverWidth = 300;
			const maxPopoverHeight = 220;
			const margin = 8;
			const gap = 6;
			const canPlaceRight = (rect.right + gap + popoverWidth + margin) <= window.innerWidth;
			const left = canPlaceRight
				? (rect.right + gap)
				: Math.max(margin, rect.left - popoverWidth - gap);
			const spaceBelow = window.innerHeight - rect.bottom - margin;
			const spaceAbove = rect.top - margin;
			const shouldPlaceAbove = spaceBelow < 140 && spaceAbove > spaceBelow;
			let top = shouldPlaceAbove
				? (rect.top - maxPopoverHeight - gap)
				: (rect.bottom + gap);
			top = Math.max(margin, Math.min(top, window.innerHeight - maxPopoverHeight - margin));
			directGlobalColorPopover.style.left = `${left}px`;
			directGlobalColorPopover.style.top = `${top}px`;
			directGlobalColorPopover.innerHTML = '<div class="uichemy-composer-direct-global-color-group-title">Loading global colors...</div>';
			directGlobalColorPopover.hidden = false;
			activeDirectGlobalColorTarget = targetKey;

			const renderPopoverRows = () => {
				const elementorItems = Object.values(directEditorV3ColorById)
					.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
				const atomicByLogicalId = Object.create(null);
				Object.keys(directAtomicColorByVarName).forEach((varName) => {
					const item = directAtomicColorByVarName[varName];
					if (!item) {
						return;
					}
					const logicalId = String(item.id || item.label || varName || '').trim();
					if (!logicalId || atomicByLogicalId[logicalId]) {
						return;
					}
					atomicByLogicalId[logicalId] = item;
				});
				const atomicItems = Object.values(atomicByLogicalId)
					.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
				const renderRows = (items, source) => {
					const seen = new Set();
					return items.map((item) => {
						const swatch = UichSHE.escapeHtml(item.value || '#666666');
						const title = UichSHE.escapeHtml(item.title || item.label || item.id);
						const idToken = source === 'atomic' ? `atomic:${item.varName}` : `v3:${item.id}`;
						if (!idToken || seen.has(idToken)) {
							return '';
						}
						seen.add(idToken);
						const meta = source === 'widget' ? 'Widget CSS' : (source === 'atomic' ? 'Elementor Atomic variable' : 'Elementor global');
						return `<button type="button" class="uichemy-composer-direct-global-color-option" data-global-color-id="${encodeURIComponent(idToken)}"><span class="uichemy-composer-direct-global-color-swatch" style="background:${swatch};"></span><span>${title}<span class="uichemy-composer-direct-global-color-option-meta">${meta}</span></span></button>`;
					}).filter(Boolean).join('');
				};
				if (!elementorItems.length && !atomicItems.length) {
					directGlobalColorPopover.innerHTML = '<div class="uichemy-composer-direct-global-color-group-title">No global colors found.</div>';
					return;
				}
				const atomicHtml = atomicItems.length
					? `<div class="uichemy-composer-direct-global-color-group-title">Elementor Atomic Variables</div>${renderRows(atomicItems, 'atomic')}`
					: '';
				directGlobalColorPopover.innerHTML = `
					${atomicHtml}
					<div class="uichemy-composer-direct-global-color-group-title">Elementor Global Colors</div>
					${renderRows(elementorItems, 'elementor')}
				`;
			};

			ensureDirectEditorV3ColorCache();
			if (Object.keys(directEditorV3ColorById).length || Object.keys(directAtomicColorByVarName).length) {
				renderPopoverRows();
				return;
			}
			Promise.all([
				uiChemyComposerFetchGlobalsIndexFresh().then((data) => {
					rebuildDirectColorCaches((data && data.colors) || {});
				}),
				ensureAtomicSnapshotCache(),
			])
				.then(() => {
					renderPopoverRows();
				})
				.catch(() => {
					directGlobalColorPopover.innerHTML = '<div class="uichemy-composer-direct-global-color-group-title">Unable to load global colors.</div>';
				});
		}

		function parseClassNameString(className) {
			return String(className || '').trim().split(/\s+/).filter(Boolean);
		}

		/** Read `class` reliably for HTML and SVG (serialized markup matches the attribute). */
		function getDomElementClassString(el) {
			if (!el || el.nodeType !== Node.ELEMENT_NODE) {
				return '';
			}
			if (typeof el.getAttribute === 'function' && el.getAttribute('class') != null) {
				return String(el.getAttribute('class') || '');
			}
			if (typeof el.className === 'string') {
				return el.className;
			}
			if (el.className && typeof el.className.baseVal === 'string') {
				return el.className.baseVal;
			}
			return '';
		}

		/** Write `class` so `innerHTML` / raw_html serialization keeps tokens like `foo:hover`. */
		function setDomElementClassString(el, classString) {
			if (!el || el.nodeType !== Node.ELEMENT_NODE || typeof el.setAttribute !== 'function') {
				return;
			}
			const v = String(classString || '').trim();
			if (!v) {
				el.removeAttribute('class');
				return;
			}
			el.setAttribute('class', v);
		}

		function escapeRegexForDirectEditor(value) {
			return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}

		/** Escape a simple class name (no structural `:` pseudo) for use after `.` in a selector. */
		function cssIdentifierForSimpleClass(ident) {
			const t = String(ident || '');
			if (!t) {
				return '';
			}
			if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
				try {
					return window.CSS.escape(t);
				} catch (e) {
					// fall through
				}
			}
			return t.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
		}

		const DIRECT_EDITOR_HTML_TAGS = new Set([
			'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote',
			'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd',
			'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure',
			'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i',
			'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu',
			'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'picture', 'pre',
			'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source',
			'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'g', 'defs', 'use', 'symbol', 'marker',
			'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
		]);

		const DIRECT_EDITOR_PSEUDO_CLASS_TAIL = /:((?:hover|focus(?:-(?:within|visible))?|active|visited|link|target|disabled|enabled|checked|placeholder|root|empty|first-child|last-child|only-child|first-of-type|last-of-type|only-of-type)(?:\([^)]*\))?)$/i;
		const DIRECT_EDITOR_PSEUDO_ELEMENT_TAIL = /::(before|after|first-line|first-letter|placeholder|selection|backdrop|marker|file-selector-button)$/i;

		/**
		 * Turn a panel "class token" into a full selector for typography blocks in raw_css.
		 * - `card-content:hover` → `.card-content:hover` (real pseudo-class, not a literal colon in the class name)
		 * - `h3:hover` → `h3:hover` (type selector; no leading `.`)
		 * - `hover:bg-red` / other utility stacks → `.` + escaped identifier (literal class name)
		 */
		function classTokenToTypographyRuleSelector(rawToken) {
			const raw = String(rawToken || '').trim();
			if (!raw) {
				return '';
			}
			if (
				raw.startsWith('.')
				|| raw.startsWith('#')
				|| raw.startsWith('[')
				|| raw.startsWith('*')
				|| raw.startsWith('>')
				|| raw.startsWith('~')
				|| raw.startsWith('+')
				|| /\s/.test(raw)
			) {
				return raw;
			}
			const appendClassOrTag = (base, pseudoSuffix) => {
				const b = String(base || '');
				const hasHyphen = b.indexOf('-') !== -1;
				if (!hasHyphen && DIRECT_EDITOR_HTML_TAGS.has(b.toLowerCase())) {
					return `${b.toLowerCase()}${pseudoSuffix}`;
				}
				return `.${cssIdentifierForSimpleClass(b)}${pseudoSuffix}`;
			};
			let m = raw.match(DIRECT_EDITOR_PSEUDO_ELEMENT_TAIL);
			if (m) {
				const base = raw.slice(0, raw.length - m[0].length);
				const suf = m[0];
				if (base) {
					return appendClassOrTag(base, suf);
				}
			}
			m = raw.match(DIRECT_EDITOR_PSEUDO_CLASS_TAIL);
			if (m) {
				const base = raw.slice(0, raw.length - m[0].length);
				const suf = m[0];
				if (base) {
					return appendClassOrTag(base, suf);
				}
			}
			return `.${cssIdentifierForSimpleClass(raw)}`;
		}

		function sanitizeNewClassToken(raw) {
			const s = String(raw || '').trim();
			if (!s) {
				return '';
			}
			if (/[\s<>"'`]/.test(s)) {
				return '';
			}
			// Allow ':' (and brackets/slash) for utility-style tokens, e.g. hover:, focus:, sm:, arbitrary [...].
			if (!/^[-_a-zA-Z0-9:[\]#./]+$/i.test(s)) {
				return '';
			}
			return s;
		}

		/**
		 * Contextual CSS can match the same class token with both `.foo` and `.foo:hover`.
		 * We skip showing a duplicate contextual chip when the selector is exactly `.token`
		 * (no pseudo-elements/classes) because the local class chip already represents that case.
		 */
		function isRedundantContextualClassChip(token, selector) {
			const t = sanitizeNewClassToken(token);
			if (!t) {
				return true;
			}
			const sel = String(selector || '').trim();
			if (!sel) {
				return true;
			}
			if (/::?[\w-]+(?:\([^)]*\))?/.test(sel)) {
				return false;
			}
			return sel === `.${t}`;
		}

		function selectorsMatchForDirectClassSelection(a, b) {
			return String(a || '').trim() === String(b || '').trim();
		}

		function typographyTitleToSuggestionClass(title) {
			const s = String(title || '')
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9_-]+/g, '-')
				.replace(/^-+|-+$/g, '');
			return s || '';
		}

		function getTypographyPresetScalar(value) {
			if (value === undefined || value === null) {
				return '';
			}
			if (typeof value === 'object') {
				if (value.value !== undefined && value.value !== null && value.value !== '') {
					return String(value.value).trim();
				}
				if (value.size !== undefined && value.size !== null && value.size !== '') {
					return String(value.size).trim();
				}
				return '';
			}
			return String(value).trim();
		}

		function normalizeTypographyPresetLength(value, unit) {
			const raw = getTypographyPresetScalar(value);
			if (!raw) {
				return '';
			}
			const unitFromValue = (value && typeof value === 'object')
				? String(value.unit || '').trim()
				: '';
			const unitRaw = unitFromValue || String(unit || '').trim();
			if (!unitRaw) {
				return raw;
			}
			if (/^-?\d+(\.\d+)?$/.test(raw)) {
				return `${raw}${unitRaw}`;
			}
			return raw;
		}

		function buildTypographyPresetStyleMap(presetValue) {
			const value = presetValue && typeof presetValue === 'object' ? presetValue : {};
			return {
				'font-family': String(value.typography_font_family || value['font-family'] || '').trim(),
				'font-size': normalizeTypographyPresetLength(
					value.typography_font_size !== undefined ? value.typography_font_size : value['font-size'],
					value.typography_font_size_unit
				),
				'font-weight': String(value.typography_font_weight || value['font-weight'] || '').trim(),
				'line-height': normalizeTypographyPresetLength(
					value.typography_line_height !== undefined ? value.typography_line_height : value['line-height'],
					value.typography_line_height_unit
				),
				'letter-spacing': normalizeTypographyPresetLength(
					value.typography_letter_spacing !== undefined ? value.typography_letter_spacing : value['letter-spacing'],
					value.typography_letter_spacing_unit
				),
				'text-transform': String(value.typography_text_transform || value['text-transform'] || '').trim(),
				'text-decoration': String(value.typography_text_decoration || value['text-decoration'] || '').trim(),
				'font-style': String(value.typography_font_style || value['font-style'] || '').trim(),
			};
		}

		const typographyPresetStyleProperties = [
			'font-family',
			'font-size',
			'font-weight',
			'line-height',
			'letter-spacing',
			'text-transform',
			'text-decoration',
			'font-style',
		];
		// Properties allowed in raw_css / <style> when a local class (or contextual selector) is targeted.
		// Must include every direct-editor layout field so upsertLocalClassTypographyInCss does not drop them.
		const directClassEditableTypographyProperties = Array.from(new Set([
			'font-family',
			'font-size',
			'font-weight',
			'line-height',
			'text-align',
			'font-style',
			'letter-spacing',
			'text-transform',
			'text-decoration',
			'color',
			...layoutStyleProperties,
		]));

		const globalIndicatorPalette = ['#22d3ee', '#a78bfa', '#f59e0b', '#34d399', '#fb7185', '#60a5fa', '#f97316', '#e879f9'];

		function getV3TypographyPresetByClassToken(classToken) {
			const wantedToken = String(classToken || '').trim().toLowerCase();
			if (!wantedToken) {
				return null;
			}
			ensureDirectEditorV3TypographyNameCache();
			if (directEditorV3TypographyByClassToken[wantedToken]) {
				return directEditorV3TypographyByClassToken[wantedToken];
			}
			if (directAtomicClassByToken[wantedToken] && directAtomicClassByToken[wantedToken].styleMap) {
				return directAtomicClassByToken[wantedToken].styleMap;
			}
			return null;
		}

		function buildTypographyStyleMapFromClassTokens(classTokens) {
			const merged = {};
			const sourceByProperty = {};
			typographyPresetStyleProperties.forEach((property) => {
				merged[property] = '';
				sourceByProperty[property] = '';
			});

			(classTokens || []).forEach((token) => {
				const normalizedToken = String(token || '').trim();
				const preset = getV3TypographyPresetByClassToken(normalizedToken);
				if (!preset) {
					return;
				}
				const styleMap = buildTypographyPresetStyleMap(preset);
				typographyPresetStyleProperties.forEach((property) => {
					if (merged[property]) {
						return;
					}
					const nextValue = String(styleMap[property] || '').trim();
					if (nextValue) {
						const tokenLower = normalizedToken.toLowerCase();
						const globalId = tokenLower.indexOf('text-') === 0 ? tokenLower.slice(5) : '';
						const shouldUseVarAlias = globalId && !/^var\(/i.test(nextValue);
						merged[property] = shouldUseVarAlias ? `var(--e-global-typography-${globalId}-${property})` : nextValue;
						sourceByProperty[property] = tokenLower;
					}
				});
			});

			return { styleMap: merged, sourceByProperty };
		}

		function buildGlobalClassColorMap(classTokens) {
			const out = Object.create(null);
			let colorIndex = 0;
			(classTokens || []).forEach((token) => {
				const tokenLower = String(token || '').trim().toLowerCase();
				if (!tokenLower || out[tokenLower]) {
					return;
				}
				if (!getV3TypographyPresetByClassToken(tokenLower)) {
					return;
				}
				out[tokenLower] = globalIndicatorPalette[colorIndex % globalIndicatorPalette.length];
				colorIndex += 1;
			});
			return out;
		}

		function setDirectFieldGlobalIndicator(field, color) {
			if (!field) {
				return;
			}
			const wrap = field.closest('.uichemy-composer-direct-field-input');
			if (!wrap) {
				return;
			}
			if (color) {
				wrap.classList.add('has-global-source');
				wrap.style.setProperty('--uc-global-dot-color', color);
			} else {
				wrap.classList.remove('has-global-source');
				wrap.style.removeProperty('--uc-global-dot-color');
			}
		}

		/**
		 * Walk applied class tokens and determine the LAST class providing each property's value.
		 * Mirrors the CSS cascade order — the last token wins for the same specificity, which matches
		 * how the panel surfaces the "effective" source for each input.
		 */
		function buildClassSourceMapForApplied(rawCss, classTokens, activeMediaText, properties) {
			const sourceByProperty = Object.create(null);
			const valueByProperty = Object.create(null);
			(properties || []).forEach((property) => {
				sourceByProperty[property] = '';
				valueByProperty[property] = '';
			});
			if (!classTokens || !classTokens.length || !properties || !properties.length) {
				return { sourceByProperty, valueByProperty };
			}
			const cssText = String(rawCss || '');
			const mediaTrim = String(activeMediaText || '').trim();
			(classTokens || []).forEach((token) => {
				const tokenLower = String(token || '').trim().toLowerCase();
				if (!tokenLower) {
					return;
				}
				const globalPreset = getV3TypographyPresetByClassToken(tokenLower);
				if (globalPreset) {
					const styleMap = buildTypographyPresetStyleMap(globalPreset);
					properties.forEach((property) => {
						const v = String(styleMap[property] || '').trim();
						if (v) {
							sourceByProperty[property] = tokenLower;
							valueByProperty[property] = v;
						}
					});
					return;
				}
				const baseStyleMap = getLocalClassTypographyStyleMap(cssText, tokenLower, '', '');
				properties.forEach((property) => {
					const v = String(baseStyleMap[property] || '').trim();
					if (v) {
						sourceByProperty[property] = tokenLower;
						valueByProperty[property] = v;
					}
				});
				if (mediaTrim) {
					const mediaStyleMap = getLocalClassTypographyStyleMap(cssText, tokenLower, '', mediaTrim);
					properties.forEach((property) => {
						const v = String(mediaStyleMap[property] || '').trim();
						if (v) {
							sourceByProperty[property] = tokenLower;
							valueByProperty[property] = v;
						}
					});
				}
			});
			return { sourceByProperty, valueByProperty };
		}

		/**
		 * Stable color-per-class map used for the dot indicator next to fields whose value originates
		 * from a class rule. Same palette as `buildGlobalClassColorMap`, extended to ALL applied class
		 * tokens (not only V3 typography presets) so local class sources also get a recognizable color.
		 */
		function buildAllClassColorMap(classTokens) {
			const out = Object.create(null);
			let colorIndex = 0;
			(classTokens || []).forEach((token) => {
				const tokenLower = String(token || '').trim().toLowerCase();
				if (!tokenLower || out[tokenLower]) {
					return;
				}
				out[tokenLower] = globalIndicatorPalette[colorIndex % globalIndicatorPalette.length];
				colorIndex += 1;
			});
			return out;
		}

		/**
		 * Build the responsive-cascade priority chain for the active viewport. Order is
		 * most-specific → least-specific so a `for…of` walk stops at the first matching value.
		 *
		 * Desktop  → [''] (base only)
		 * Tablet   → ['tablet', ''] (tablet, fall back to base)
		 * Mobile   → ['mobile', 'tablet', ''] (mobile, fall back to tablet, then base)
		 */
		function buildResponsiveFallbackChainForBreakpoint(currentBpKey) {
			const activeBp = String(currentBpKey || 'desktop').toLowerCase();
			if (!activeBp || activeBp === 'desktop') {
				return [''];
			}
			const bpList = getElementorActiveBreakpointsList();
			const currentBp = bpList.find((b) => b.key === activeBp);
			if (!currentBp || !currentBp.direction) {
				return [activeBp, ''];
			}
			// Pull in every breakpoint that ALSO applies at the current viewport (e.g. on mobile, the
			// tablet's max-width rule also matches), then sort most-specific first so the first hit
			// in a value lookup wins.
			const applicable = bpList.filter((bp) => {
				if (!bp.value) return false;
				if ('max' === bp.direction && 'max' === currentBp.direction) {
					return (bp.value || 0) >= (currentBp.value || 0);
				}
				if ('min' === bp.direction && 'min' === currentBp.direction) {
					return (bp.value || 0) <= (currentBp.value || 0);
				}
				return false;
			});
			applicable.sort((a, b) => {
				if ('max' === a.direction && 'max' === b.direction) {
					// Smaller max-width = more specific (mobile beats tablet).
					return (a.value || 0) - (b.value || 0);
				}
				if ('min' === a.direction && 'min' === b.direction) {
					// Larger min-width = more specific (1025+ beats 768+).
					return (b.value || 0) - (a.value || 0);
				}
				return 0;
			});
			const chain = applicable.map((bp) => bp.key);
			chain.push('');
			return chain;
		}

		/**
		 * Collect class contributors for a single CSS property. Pushes ONE entry per applied class —
		 * the effective value at the active viewport (using `buildResponsiveFallbackChainForBreakpoint`
		 * to walk most-specific → least-specific until a rule is found). Multiple entries appear only
		 * when more than one class contributes; the LAST class in HTML order becomes `isWinner`.
		 */
		function collectStyleOriginsForProperty(rawCss, classTokens, property, currentBpKey) {
			const entries = [];
			if (!property || !classTokens || !classTokens.length) {
				return entries;
			}
			const cssText = String(rawCss || '');
			const fallbackChain = buildResponsiveFallbackChainForBreakpoint(currentBpKey);
			(classTokens || []).forEach((token) => {
				const tokenLower = String(token || '').trim().toLowerCase();
				if (!tokenLower) {
					return;
				}
				const globalPreset = getV3TypographyPresetByClassToken(tokenLower);
				if (globalPreset) {
					const styleMap = buildTypographyPresetStyleMap(globalPreset);
					const v = String(styleMap[property] || '').trim();
					if (v) {
						entries.push({ token: tokenLower, breakpointKey: '', value: v, isGlobal: true });
					}
					return;
				}
				let effectiveValue = '';
				let effectiveBpKey = '';
				for (let i = 0; i < fallbackChain.length; i++) {
					const bpKey = fallbackChain[i];
					const mediaText = bpKey ? getMediaTextForElementorBreakpointKey(bpKey) : '';
					const styleMap = getLocalClassTypographyStyleMap(cssText, tokenLower, '', mediaText);
					const v = String(styleMap[property] || '').trim();
					if (v) {
						effectiveValue = v;
						effectiveBpKey = bpKey;
						break;
					}
				}
				if (effectiveValue) {
					entries.push({ token: tokenLower, breakpointKey: effectiveBpKey, value: effectiveValue, isGlobal: false });
				}
			});
			if (entries.length) {
				// Cross-class cascade winner = LAST class in HTML order with a value. Single-class case
				// auto-marks that one as the winner.
				entries.forEach((e, i) => {
					e.isWinner = (i === entries.length - 1);
				});
			}
			return entries;
		}

		function ensureDirectStyleOriginPopover() {
			let pop = document.getElementById('uichemy-composer-direct-style-origin-popover');
			if (pop) {
				return pop;
			}
			pop = document.createElement('div');
			pop.id = 'uichemy-composer-direct-style-origin-popover';
			pop.className = 'uichemy-composer-direct-style-origin-popover';
			pop.hidden = true;
			document.body.appendChild(pop);
			return pop;
		}

		function hideDirectStyleOriginPopover() {
			const pop = document.getElementById('uichemy-composer-direct-style-origin-popover');
			if (!pop) {
				return;
			}
			pop.hidden = true;
			pop.innerHTML = '';
			delete pop.dataset.activeProperty;
		}

		function openDirectStyleOriginPopover(anchorEl, property, entries) {
			const pop = ensureDirectStyleOriginPopover();
			if (!anchorEl || !entries || !entries.length) {
				hideDirectStyleOriginPopover();
				return;
			}
			const propertyLabel = String(property || '');
			// Order: winner first, then overridden rules (matches the typical "active style first"
			// pattern used by browser devtools' style-origin views).
			const sortedEntries = entries.slice().sort((a, b) => {
				if (!!a.isWinner === !!b.isWinner) return 0;
				return a.isWinner ? -1 : 1;
			});
			const rowsHtml = sortedEntries.map((entry) => {
				const tokenStr = String(entry.token || '');
				const valueStr = String(entry.value || '');
				const cls = entry.isWinner
					? 'uichemy-composer-direct-style-origin-item'
					: 'uichemy-composer-direct-style-origin-item is-overridden';
				return `<li class="${cls}">`
					+ `<span class="uichemy-composer-direct-style-origin-token">${UichSHE.escapeHtml(tokenStr)}</span>`
					+ `<span class="uichemy-composer-direct-style-origin-value">${UichSHE.escapeHtml(valueStr)}</span>`
					+ `</li>`;
			}).join('');
			pop.innerHTML = `<div class="uichemy-composer-direct-style-origin-header">`
				+ `<span class="uichemy-composer-direct-style-origin-title">Style Origin</span>`
				+ `<button type="button" class="uichemy-composer-direct-style-origin-close" aria-label="Close style origin">×</button>`
				+ `</div>`
				+ `<ul class="uichemy-composer-direct-style-origin-list">${rowsHtml}</ul>`;
			pop.dataset.activeProperty = propertyLabel;
			pop.hidden = false;
			// Open upward: measure rendered height after content insertion, place ABOVE the anchor so
			// the popover never covers the field the user is inspecting.
			const rect = anchorEl.getBoundingClientRect();
			const popWidth = 260;
			const margin = 8;
			const gap = 6;
			const left = Math.min(
				Math.max(margin, rect.left - 8),
				window.innerWidth - popWidth - margin
			);
			const popHeight = pop.offsetHeight || 0;
			let top = rect.top - popHeight - gap;
			// If there isn't enough room above (e.g. the field is at the very top of the panel),
			// fall back to opening below so the popover never clips out of the viewport.
			if (top < margin) {
				top = Math.min(rect.bottom + gap, window.innerHeight - popHeight - margin);
			}
			pop.style.left = `${left}px`;
			pop.style.top = `${Math.max(margin, top)}px`;
		}

		function setDirectFieldOriginDot(field, sourceToken, color, property, entries) {
			if (!field) return;
			const wrap = field.closest('.uichemy-composer-direct-field-input');
			if (!wrap) return;
			const labelTarget = wrap.querySelector(':scope > label');
			let dot = (labelTarget && labelTarget.querySelector(':scope > .uichemy-composer-direct-style-origin-dot'))
				|| wrap.querySelector(':scope > .uichemy-composer-direct-style-origin-dot');
			const token = String(sourceToken || '').trim();
			if (!token) {
				if (dot) dot.remove();
				return;
			}
			if (!dot) {
				dot = document.createElement('button');
				dot.type = 'button';
				dot.className = 'uichemy-composer-direct-style-origin-dot';
				if (labelTarget) {
					// Append inside the <label> so the dot flows inline with the label text. The
					// .uichemy-composer-direct-field-input wrap is flex-column, so a sibling element would
					// land on its own row.
					labelTarget.appendChild(dot);
				} else {
					wrap.insertBefore(dot, wrap.firstChild);
				}
			}
			dot.style.background = String(color || '#7dd3fc');
			dot.setAttribute('aria-label', `Style origin: from .${token}`);
			dot.title = `Style origin: from .${token}`;
			dot.dataset.styleOriginProperty = String(property || '');
			dot.__ucStyleOriginEntries = entries || [];
		}

		function setDirectSidesOriginDot(sidesField, sourceToken, color, property, entries) {
			if (!sidesField) return;
			const header = sidesField.querySelector(':scope > .uichemy-composer-direct-sides-header');
			if (!header) return;
			const labelTarget = header.querySelector(':scope > label');
			let dot = (labelTarget && labelTarget.querySelector(':scope > .uichemy-composer-direct-style-origin-dot'))
				|| header.querySelector(':scope > .uichemy-composer-direct-style-origin-dot');
			const token = String(sourceToken || '').trim();
			if (!token) {
				if (dot) dot.remove();
				return;
			}
			if (!dot) {
				dot = document.createElement('button');
				dot.type = 'button';
				dot.className = 'uichemy-composer-direct-style-origin-dot';
				if (labelTarget) {
					labelTarget.appendChild(dot);
				} else {
					header.insertBefore(dot, header.firstChild);
				}
			}
			dot.style.background = String(color || '#7dd3fc');
			dot.setAttribute('aria-label', `Style origin: from .${token}`);
			dot.title = `Style origin: from .${token}`;
			dot.dataset.styleOriginProperty = String(property || '');
			dot.__ucStyleOriginEntries = entries || [];
		}

		function ensureDirectPlaceholderCached(field) {
			if (!field || field.nodeType !== Node.ELEMENT_NODE) {
				return;
			}
			const tag = field.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
				return;
			}
			if (!field.dataset || field.dataset.ucDefaultPlaceholder !== undefined) {
				return;
			}
			field.dataset.ucDefaultPlaceholder = field.getAttribute('placeholder') || '';
		}

		function setDirectTextInputPlaceholder(field, hasAuthoredValue) {
			if (!field || field.nodeType !== Node.ELEMENT_NODE) {
				return;
			}
			if (field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA') {
				return;
			}
			ensureDirectPlaceholderCached(field);
			if (!field.dataset) {
				return;
			}
			field.placeholder = hasAuthoredValue ? String(field.dataset.ucDefaultPlaceholder || '') : '';
		}

		function setInputValuePreserveActiveTyping(field, nextValue) {
			if (!field) {
				return;
			}
			const normalized = String(nextValue || '');
			const isTypingHere = document.activeElement === field;
			if (isTypingHere) {
				return;
			}
			field.value = normalized;
		}

		function applyTypographyStyleMapToTarget(targetEl, styleMap) {
			if (!targetEl || targetEl.nodeType !== Node.ELEMENT_NODE) {
				return;
			}
			Object.keys(styleMap).forEach((property) => {
				const nextValue = String(styleMap[property] || '').trim();
				if (nextValue) {
					targetEl.style.setProperty(property, nextValue);
				} else {
					targetEl.style.removeProperty(property);
				}
			});
		}

		function markRawHtmlChanged(nextHtml) {
			if (!UichSHE.activeWidgetSettings) {
				return;
			}
			UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
			if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
				const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
				if (input.length && input.val() !== nextHtml) {
					input.val(nextHtml).trigger('input').trigger('change').trigger('keyup');
				}
			}
			try {
				if (elementor && elementor.saver && typeof elementor.saver.setFlagEditorChange === 'function') {
					elementor.saver.setFlagEditorChange(true);
				}
			} catch (e) {
				// Ignore saver API differences between Elementor versions.
			}
		}

		function markEditorDirty() {
			try {
				if (elementor && elementor.saver && typeof elementor.saver.setFlagEditorChange === 'function') {
					elementor.saver.setFlagEditorChange(true);
				}
			} catch (e) {
				// Ignore saver API differences between Elementor versions.
			}
		}

		function getV3TypographyPresetByTitle(title) {
			const wanted = String(title || '').trim();
			if (!wanted) {
				return null;
			}

			// Fast path: cached lookup populated from globals refresh.
			if (directEditorV3TypographyByTitle[wanted]) {
				return directEditorV3TypographyByTitle[wanted];
			}

			// Case-insensitive fallback in cache.
			const wantedLower = wanted.toLowerCase();
			const cachedKeys = Object.keys(directEditorV3TypographyByTitle);
			for (let i = 0; i < cachedKeys.length; i++) {
				const key = cachedKeys[i];
				if (key.toLowerCase() === wantedLower) {
					return directEditorV3TypographyByTitle[key];
				}
			}

			// Live kit fallback (works even if globals tab was never opened).
			const live = uiChemyComposerGetLiveKitGlobalsMaps();
			if (live && live.typography) {
				const liveLookup = uiChemyComposerBuildV3TypographyLookup(live.typography);
				if (liveLookup[wanted]) {
					return liveLookup[wanted];
				}
				const liveKeys = Object.keys(liveLookup);
				for (let i = 0; i < liveKeys.length; i++) {
					const key = liveKeys[i];
					if (key.toLowerCase() === wantedLower) {
						return liveLookup[key];
					}
				}
			}

			return null;
		}

		function getDirectEditorClassTargetContext() {
			if (!UichSHE.activeWidgetSettings) {
				return null;
			}
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') {
				return null;
			}
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const node = layerNode || nodes[selectedSlotIndex];
			const typographyTarget = getTypographyTargetNode(node);
			const canEditClasses = !!(typographyTarget && typographyTarget.nodeType === Node.ELEMENT_NODE);
			if (!canEditClasses || !typographyTarget) {
				return null;
			}
			return { doc, typographyTarget };
		}

		function commitDirectClassesFromTokens(nextTokens, typographyPresetValue, typographyPresetToken) {
			if (isDirectSyncing) {
				setTimeout(() => {
					commitDirectClassesFromTokens(nextTokens, typographyPresetValue, typographyPresetToken);
				}, 0);
				return;
			}
			const ctx = getDirectEditorClassTargetContext();
			if (!ctx || !UichSHE.activeWidgetSettings) {
				return;
			}
			const previousTokens = parseClassNameString(getDomElementClassString(ctx.typographyTarget));
			const seen = new Set();
			const uniq = [];
			nextTokens.forEach((t) => {
				if (!t || seen.has(t)) {
					return;
				}
				seen.add(t);
				uniq.push(t);
			});
			setDomElementClassString(ctx.typographyTarget, uniq.join(' '));

			// Also persist class-level typography declarations into raw_css when a preset class is added.
			if (typographyPresetValue && typeof typographyPresetValue === 'object' && UichSHE.activeWidgetSettings) {
				const targetClassToken = sanitizeNewClassToken(
					String(typographyPresetToken || '').trim()
					|| String(uniq.find((token) => previousTokens.indexOf(token) === -1) || '').trim()
				);
				if (targetClassToken) {
					const presetStyleMap = buildTypographyStyleMapFromClassTokens([targetClassToken]).styleMap;
					const cssUpdates = Object.keys(presetStyleMap)
						.map((property) => [property, String(presetStyleMap[property] || '').trim()])
						.filter(([, value]) => value);
					if (cssUpdates.length) {
						const nextCss = upsertLocalClassTypographyInCss(
							UichSHE.activeWidgetSettings.get('raw_css') || '',
							targetClassToken,
							cssUpdates,
							'',
							getActiveBreakpointMediaText()
						);
						UichSHE.activeWidgetSettings.set('raw_css', nextCss);
						if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
							const cssInput = UichSHE.activePanelView.$el.find('[data-setting="raw_css"]');
							if (cssInput.length && cssInput.val() !== nextCss) {
								cssInput.val(nextCss).trigger('input').trigger('change');
							}
						}
					}
				}
			}
			const nextHtml = ctx.doc.innerHTML;
			markRawHtmlChanged(nextHtml);
			syncDirectInputsFromSelection();
		}

		function renderDirectAppliedClassChips(classStr, interactive, selectedToken, contextualEntries, mediaEntries) {
			if (!directClassesChips) {
				return;
			}
			const directTokens = parseClassNameString(classStr);
			const entries = Array.isArray(contextualEntries) ? contextualEntries : [];
			const mediaEntriesArr = Array.isArray(mediaEntries) ? mediaEntries : [];
			const normSelectorKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
			// Canonical selectors already represented by a local class chip (e.g. class "foo:hover" → rule ".foo:hover").
			const localRuleSelectorKeys = new Set();
			directTokens.forEach((dt) => {
				const st = sanitizeNewClassToken(dt);
				if (!st) {
					return;
				}
				const canon = classTokenToTypographyRuleSelector(st);
				const k = normSelectorKey(canon);
				if (k) {
					localRuleSelectorKeys.add(k);
				}
			});
			const extraContextual = [];
			const seenPairKey = new Set();
			const seenContextualSelectorKey = new Set();
			entries.forEach((entry) => {
				const token = sanitizeNewClassToken(entry && entry.token);
				const selector = String(entry && entry.selector || '').trim();
				if (!token || !selector || isRedundantContextualClassChip(token, selector)) {
					return;
				}
				const pairKey = `${String(token).toLowerCase()}|||${selector}`;
				if (seenPairKey.has(pairKey)) {
					return;
				}
				const selKey = normSelectorKey(selector);
				if (seenContextualSelectorKey.has(selKey)) {
					return;
				}
				if (localRuleSelectorKeys.has(selKey)) {
					return;
				}
				seenPairKey.add(pairKey);
				seenContextualSelectorKey.add(selKey);
				extraContextual.push({ token, selector });
			});
			/*
			 * Per-class single chip: even when a class has rules at multiple breakpoints (base + tablet
			 * + mobile), we render ONE chip per class. Switching Elementor's responsive mode redirects
			 * edits to the matching @media bucket via `directTokenBreakpointInfo` for the ACTIVE
			 * breakpoint — non-active breakpoints stay reachable by switching the Elementor toggle.
			 */
			const directTokenBreakpointInfo = Object.create(null);
			const activeBpKey = directCurrentElementorBreakpoint || getElementorCurrentDeviceMode();
			const activeBpMediaTextLocal = getActiveBreakpointMediaText();
			if (mediaEntriesArr.length) {
				const breakpointsList = getElementorActiveBreakpointsList();
				const directTokenLowerSet = new Set(directTokens.map((t) => String(t || '').toLowerCase()).filter(Boolean));
				mediaEntriesArr.forEach((entry) => {
					const t = sanitizeNewClassToken(entry && entry.token);
					const s = String(entry && entry.selector || '').trim();
					if (!t || !s) {
						return;
					}
					const bpKey = mapMediaTextToElementorBreakpointKey(entry.mediaText, breakpointsList);
					if (!bpKey) {
						return;
					}
					const tokenLower = String(t || '').toLowerCase();
					const ruleSelectorForToken = classTokenToTypographyRuleSelector(t);
					const sameAsDirect = String(s).trim() === String(ruleSelectorForToken).trim();
					const isActiveBp = normalizeMediaTextForCompare(entry.mediaText) === normalizeMediaTextForCompare(activeBpMediaTextLocal);
					if (sameAsDirect && directTokenLowerSet.has(tokenLower) && isActiveBp && !directTokenBreakpointInfo[tokenLower]) {
						directTokenBreakpointInfo[tokenLower] = {
							mediaText: entry.mediaText,
							breakpointKey: bpKey,
							selector: s
						};
					}
				});
			}
			const tokensForColorMap = directTokens.slice();
			extraContextual.forEach(({ token }) => {
				const tokenLower = String(token || '').toLowerCase();
				if (!tokenLower || tokensForColorMap.some((existing) => String(existing || '').toLowerCase() === tokenLower)) {
					return;
				}
				tokensForColorMap.push(token);
			});
			const globalClassColorMap = buildGlobalClassColorMap(tokensForColorMap);
			const selectedTokenLower = String(selectedToken || '').toLowerCase();
			const selectedSelectorTrim = String(selectedAppliedClassSelector || '').trim();
			const selectedMediaTextTrim = String(selectedAppliedClassMediaText || '').trim();
			const localChipClass = !selectedTokenLower ? 'is-selected' : '';
			const localChipHtml = `<span class="uichemy-composer-class-chip ${localChipClass}" role="listitem" data-class-token="__uc_local__"><span class="uichemy-composer-class-chip-text">Local</span></span>`;
			const hasAnyClassChip = directTokens.length > 0 || extraContextual.length > 0;
			if (!hasAnyClassChip) {
				directClassesChips.innerHTML = interactive
					? localChipHtml
					: '<span class="uichemy-composer-direct-classes-empty">No classes on this element</span>';
				return;
			}
			// Selection identity = (token, contextual selector). Breakpoint is intentionally NOT part
			// of the identity — switching Elementor's responsive toggle should keep the same chip
			// selected while edits dynamically retarget the active breakpoint's @media bucket.
			const chipIsSelected = (tokenLower, contextualSelector /*, mediaText, breakpointKey */) => {
				if (tokenLower !== selectedTokenLower) {
					return false;
				}
				const ctxSel = String(contextualSelector || '').trim();
				if (!ctxSel) {
					return !selectedSelectorTrim;
				}
				return selectorsMatchForDirectClassSelection(ctxSel, selectedSelectorTrim);
			};
			if (!interactive) {
				const readonlyParts = [];
				directTokens.forEach((t) => {
					const tokenLower = String(t || '').toLowerCase();
					const bpInfo = directTokenBreakpointInfo[tokenLower];
					const directMediaForSelected = bpInfo ? bpInfo.mediaText : '';
					const directBpKeyForSelected = bpInfo ? (bpInfo.breakpointKey || '') : '';
					readonlyParts.push(
						`<span class="uichemy-composer-class-chip uichemy-composer-class-chip--readonly ${chipIsSelected(tokenLower, '', directMediaForSelected, directBpKeyForSelected) ? 'is-selected' : ''}" role="listitem">${globalClassColorMap[tokenLower] ? `<span class="uichemy-composer-class-chip-global-dot" style="--uc-global-dot-color:${UichSHE.escapeHtml(globalClassColorMap[tokenLower])};"></span>` : ''}<span class="uichemy-composer-class-chip-text">${UichSHE.escapeHtml(t)}</span></span>`
					);
				});
				extraContextual.forEach(({ token, selector }) => {
					const tokenLower = String(token || '').toLowerCase();
					const safe = UichSHE.escapeHtml(selector);
					readonlyParts.push(
						`<span class="uichemy-composer-class-chip uichemy-composer-class-chip--readonly ${chipIsSelected(tokenLower, selector, '', '') ? 'is-selected' : ''}" role="listitem">${globalClassColorMap[tokenLower] ? `<span class="uichemy-composer-class-chip-global-dot" style="--uc-global-dot-color:${UichSHE.escapeHtml(globalClassColorMap[tokenLower])};"></span>` : ''}<span class="uichemy-composer-class-chip-text">${safe}</span></span>`
					);
				});
				directClassesChips.innerHTML = readonlyParts.join('');
				return;
			}
			const tokenChipHtmlParts = [];
			directTokens.forEach((t) => {
				const enc = encodeURIComponent(t);
				const tokenLower = String(t || '').toLowerCase();
				const safe = UichSHE.escapeHtml(t);
				const globalDot = globalClassColorMap[tokenLower]
					? `<span class="uichemy-composer-class-chip-global-dot" style="--uc-global-dot-color:${UichSHE.escapeHtml(globalClassColorMap[tokenLower])};"></span>`
					: '';
				const bpInfo = directTokenBreakpointInfo[tokenLower];
				const directMediaForSelected = bpInfo ? bpInfo.mediaText : '';
				const directBpKeyForSelected = bpInfo ? (bpInfo.breakpointKey || '') : '';
				const mediaTextAttr = bpInfo ? ` data-class-media-text="${encodeURIComponent(bpInfo.mediaText)}"` : '';
				const breakpointKeyAttr = bpInfo ? ` data-class-breakpoint-key="${encodeURIComponent(bpInfo.breakpointKey || '')}"` : '';
				const isSelected = chipIsSelected(tokenLower, '', directMediaForSelected, directBpKeyForSelected);
				const removeBtn = `<button type="button" class="uichemy-composer-class-chip-remove" title="Delete class" aria-label="Delete ${safe}" data-class-token="${enc}">×</button>`;
				tokenChipHtmlParts.push(`<span class="uichemy-composer-class-chip ${isSelected ? 'is-selected' : ''}" role="listitem" data-class-token="${enc}"${mediaTextAttr}${breakpointKeyAttr}>${globalDot}<span class="uichemy-composer-class-chip-text">${safe}</span>${removeBtn}</span>`);
			});
			extraContextual.forEach(({ token, selector }) => {
				const enc = encodeURIComponent(token);
				const tokenLower = String(token || '').toLowerCase();
				const contextualSelector = String(selector || '').trim();
				const safe = UichSHE.escapeHtml(contextualSelector);
				const globalDot = globalClassColorMap[tokenLower]
					? `<span class="uichemy-composer-class-chip-global-dot" style="--uc-global-dot-color:${UichSHE.escapeHtml(globalClassColorMap[tokenLower])};"></span>`
					: '';
				const isSelected = chipIsSelected(tokenLower, contextualSelector, '', '');
				const contextualSelectorAttr = ` data-class-selector="${encodeURIComponent(contextualSelector)}"`;
				const removeBtn = `<button type="button" class="uichemy-composer-class-chip-remove" title="Delete rule" aria-label="Delete ${safe}" data-class-token="${enc}">×</button>`;
				tokenChipHtmlParts.push(`<span class="uichemy-composer-class-chip ${isSelected ? 'is-selected' : ''}" role="listitem" data-class-token="${enc}" data-class-contextual="true"${contextualSelectorAttr}>${globalDot}<span class="uichemy-composer-class-chip-text">${safe}</span>${removeBtn}</span>`);
			});
			directClassesChips.innerHTML = localChipHtml + tokenChipHtmlParts.join('');
		}

		function ensureDirectElementorBreakpointListener() {
			if (directBreakpointListenerBound) {
				return;
			}
			try {
				if (window.elementor && window.elementor.channels && window.elementor.channels.deviceMode
					&& typeof window.elementor.channels.deviceMode.on === 'function') {
					window.elementor.channels.deviceMode.on('change', function () {
						const prev = directCurrentElementorBreakpoint;
						directCurrentElementorBreakpoint = getElementorCurrentDeviceMode();
						if (prev !== directCurrentElementorBreakpoint && UichSHE.activeWidgetSettings) {
							// Re-sync only. Read/write paths derive the media text from the LIVE active
							// breakpoint, so there's no per-chip state to update on bp change.
							syncDirectInputsFromSelection();
						}
					});
					directBreakpointListenerBound = true;
				}
			} catch (e) {
				// ignore — listener will be retried on next sync
			}
		}

		function getBreakpointKeyIconSvg(breakpointKey) {
			const key = String(breakpointKey || '').toLowerCase();
			if (key === 'desktop' || key === 'widescreen' || key === 'laptop') {
				return '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 13.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
			}
			if (key.indexOf('tablet') === 0) {
				return '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="3" y="1.5" width="10" height="13" rx="1.2" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="12.5" r="0.6" fill="currentColor"/></svg>';
			}
			if (key.indexOf('mobile') === 0) {
				return '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="4.5" y="1.5" width="7" height="13" rx="1.2" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="12.5" r="0.6" fill="currentColor"/></svg>';
			}
			// Fallback for custom breakpoints
			return '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.2" stroke="currentColor" stroke-width="1.2"/></svg>';
		}

		function getMediaTextForElementorBreakpointKey(breakpointKey) {
			if (!breakpointKey) {
				return '';
			}
			const list = getElementorActiveBreakpointsList();
			const bp = list.find((b) => b.key === breakpointKey);
			if (!bp || !bp.value) {
				return '';
			}
			return `(${bp.direction}-width: ${bp.value}px)`;
		}

		function getActiveBreakpointMediaText() {
			const key = directCurrentElementorBreakpoint || getElementorCurrentDeviceMode();
			if (!key || key === 'desktop') {
				return '';
			}
			return getMediaTextForElementorBreakpointKey(key);
		}

		function normalizeMediaTextForCompare(mediaText) {
			return String(mediaText || '')
				.toLowerCase()
				.replace(/^\s*(only\s+screen|not\s+all|screen|all)\s+and\s+/, '')
				.replace(/\s+/g, '')
				.trim();
		}

		function mediaTextMatchesBreakpointKey(mediaText, breakpointKey) {
			if (!mediaText || !breakpointKey) {
				return false;
			}
			const breakpointsList = getElementorActiveBreakpointsList();
			const mapped = mapMediaTextToElementorBreakpointKey(mediaText, breakpointsList);
			return mapped === breakpointKey;
		}

		function collectLocalClassTokensFromRawHtml(rawHtml) {
			if (!rawHtml || typeof rawHtml !== 'string') {
				return [];
			}
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const out = [];
			doc.querySelectorAll('[class]').forEach((el) => {
				parseClassNameString(getDomElementClassString(el)).forEach((token) => {
					const clean = sanitizeNewClassToken(token);
					if (clean) {
						out.push(clean);
					}
				});
			});
			return out;
		}

		function collectLocalClassTokensFromRawCss(rawCss) {
			if (!rawCss || typeof rawCss !== 'string') {
				return [];
			}
			const out = [];
			const re = /(?:^|[\s,{>+~])\.([_a-zA-Z][-_a-zA-Z0-9]*)/g;
			let match = null;
			while ((match = re.exec(rawCss)) !== null) {
				const clean = sanitizeNewClassToken(match[1] || '');
				if (clean) {
					out.push(clean);
				}
			}
			return out;
		}

		function extractStyleTagCssFromRawHtml(rawHtml) {
			if (!rawHtml || typeof rawHtml !== 'string') {
				return '';
			}
			const wrap = document.createElement('div');
			wrap.innerHTML = rawHtml;
			return Array.from(wrap.querySelectorAll('style'))
				.map((styleEl) => String(styleEl.textContent || ''))
				.filter(Boolean)
				.join('\n');
		}

		function getDirectEditorCombinedCss(rawHtml, rawCss) {
			const cssFromSetting = String(rawCss || '').trim();
			const cssFromHtmlStyleTags = extractStyleTagCssFromRawHtml(rawHtml);
			if (cssFromSetting && cssFromHtmlStyleTags) {
				return `${cssFromSetting}\n${cssFromHtmlStyleTags}`;
			}
			return cssFromSetting || cssFromHtmlStyleTags || '';
		}

		function getElementorActiveBreakpointsList() {
			try {
				if (window.elementorFrontend && window.elementorFrontend.config && window.elementorFrontend.config.responsive) {
					const responsive = window.elementorFrontend.config.responsive;
					const source = responsive.activeBreakpoints || responsive.breakpoints || {};
					const out = [];
					Object.keys(source).forEach((k) => {
						const v = source[k] || {};
						if (v.is_enabled === false) {
							return;
						}
						out.push({
							key: k,
							value: Number(v.value) || 0,
							direction: String(v.direction || 'max'),
							label: v.label || k
						});
					});
					return out;
				}
			} catch (e) {
				// ignore — return empty list
			}
			return [];
		}

		function getElementorCurrentDeviceMode() {
			try {
				if (window.elementor && window.elementor.channels && window.elementor.channels.deviceMode) {
					return String(window.elementor.channels.deviceMode.request('currentMode') || '');
				}
			} catch (e) {
				// ignore
			}
			return '';
		}

		function parseMediaTextWidths(mediaText) {
			const out = { maxWidth: null, minWidth: null };
			if (!mediaText) {
				return out;
			}
			const text = String(mediaText);
			const maxMatch = text.match(/max-width\s*:\s*(\d+(?:\.\d+)?)/i);
			const minMatch = text.match(/min-width\s*:\s*(\d+(?:\.\d+)?)/i);
			if (maxMatch) {
				out.maxWidth = parseFloat(maxMatch[1]);
			}
			if (minMatch) {
				out.minWidth = parseFloat(minMatch[1]);
			}
			return out;
		}

		function mapMediaTextToElementorBreakpointKey(mediaText, breakpointsList) {
			if (!mediaText || !breakpointsList || !breakpointsList.length) {
				return '';
			}
			const parsed = parseMediaTextWidths(mediaText);
			if (parsed.maxWidth == null && parsed.minWidth == null) {
				return '';
			}
			let bestKey = '';
			let bestDiff = Infinity;
			breakpointsList.forEach((bp) => {
				if (!bp.value) {
					return;
				}
				if (bp.direction === 'max' && parsed.maxWidth != null) {
					const diff = Math.abs(parsed.maxWidth - bp.value);
					if (diff < bestDiff && diff <= 1) {
						bestDiff = diff;
						bestKey = bp.key;
					}
				} else if (bp.direction === 'min' && parsed.minWidth != null) {
					const diff = Math.abs(parsed.minWidth - bp.value);
					if (diff < bestDiff && diff <= 1) {
						bestDiff = diff;
						bestKey = bp.key;
					}
				}
			});
			if (bestKey) {
				return bestKey;
			}
			// Fallback: closest by value regardless of direction
			breakpointsList.forEach((bp) => {
				if (!bp.value) {
					return;
				}
				const candidate = parsed.maxWidth != null ? parsed.maxWidth : parsed.minWidth;
				if (candidate == null) {
					return;
				}
				const diff = Math.abs(candidate - bp.value);
				if (diff < bestDiff) {
					bestDiff = diff;
					bestKey = bp.key;
				}
			});
			return bestKey;
		}

		function findNearestBreakpointKeyWithEntries(currentKey, availableKeys, breakpointsList) {
			if (!availableKeys || !availableKeys.length) {
				return '';
			}
			if (currentKey && availableKeys.indexOf(currentKey) !== -1) {
				return currentKey;
			}
			if (!currentKey) {
				return availableKeys[0];
			}
			const currentBp = breakpointsList.find((b) => b.key === currentKey);
			if (!currentBp) {
				return availableKeys[0];
			}
			let nearest = '';
			let nearestDiff = Infinity;
			availableKeys.forEach((k) => {
				const bp = breakpointsList.find((b) => b.key === k);
				if (!bp) {
					return;
				}
				const diff = Math.abs((bp.value || 0) - (currentBp.value || 0));
				if (diff < nearestDiff) {
					nearestDiff = diff;
					nearest = k;
				}
			});
			return nearest || availableKeys[0];
		}

		function collectContextualClassSelectorsForElement(rawCss, targetEl) {
			const outEntries = [];
			const selectorByToken = Object.create(null);
			const outMediaEntries = [];
			if (!rawCss || !targetEl) {
				return { entries: outEntries, selectorByToken, tokens: [], mediaEntries: outMediaEntries };
			}
			const styleEl = document.createElement('style');
			styleEl.textContent = String(rawCss || '');
			document.head.appendChild(styleEl);
			const seenEntryKeys = new Set();
			const selectorScore = (selector) => {
				const s = String(selector || '').trim();
				if (!s) return 0;
				const combinators = (s.match(/\s+|>|\+|~/g) || []).length;
				const classCount = (s.match(/\.[_a-zA-Z][-_a-zA-Z0-9]*/g) || []).length;
				const tagCount = (s.match(/\b[a-zA-Z][a-zA-Z0-9-]*\b/g) || []).length;
				const idCount = (s.match(/#[_a-zA-Z][-_a-zA-Z0-9]*/g) || []).length;
				return (combinators * 1000) + (idCount * 200) + (classCount * 50) + (tagCount * 10) + s.length;
			};
			const preferSelectorForTokenMap = (existing, candidate) => {
				const a = String(existing || '').trim();
				const b = String(candidate || '').trim();
				if (!a) return b;
				if (!b) return a;
				const aPseudo = /::?[\w-]+(?:\([^)]*\))?/.test(a);
				const bPseudo = /::?[\w-]+(?:\([^)]*\))?/.test(b);
				if (aPseudo && !bPseudo) {
					return b;
				}
				if (!aPseudo && bPseudo) {
					return a;
				}
				return selectorScore(b) > selectorScore(a) ? b : a;
			};
			const seenMediaEntryKeys = new Set();
			const pushEntry = (token, selector, mediaText) => {
				const clean = sanitizeNewClassToken(token);
				const selTrim = String(selector || '').trim();
				const mediaTrim = String(mediaText || '').trim();
				if (!clean || !selTrim) {
					return;
				}
				const tokenKey = String(clean).toLowerCase();
				selectorByToken[tokenKey] = preferSelectorForTokenMap(selectorByToken[tokenKey], selTrim);
				if (mediaTrim) {
					const mediaKey = `${tokenKey}|||${selTrim}|||${mediaTrim}`;
					if (!seenMediaEntryKeys.has(mediaKey)) {
						seenMediaEntryKeys.add(mediaKey);
						outMediaEntries.push({ token: clean, selector: selTrim, mediaText: mediaTrim });
					}
					return;
				}
				const key = `${tokenKey}|||${selTrim}`;
				if (!seenEntryKeys.has(key)) {
					seenEntryKeys.add(key);
					outEntries.push({ token: clean, selector: selTrim });
				}
			};
			const walkRules = (rulesList, mediaContext) => {
				if (!rulesList) {
					return;
				}
				const currentMedia = String(mediaContext || '');
				for (let i = 0; i < rulesList.length; i++) {
					const rule = rulesList[i];
					if (!rule) {
						continue;
					}
					if (rule.type === 1) {
						const selectorText = String(rule.selectorText || '');
						if (!selectorText || selectorText.indexOf('.') === -1) {
							continue;
						}
						const selectors = selectorText.split(',');
						for (let j = 0; j < selectors.length; j++) {
							const selector = String(selectors[j] || '').trim();
							if (!selector || selector.indexOf('.') === -1) {
								continue;
							}
							const normalizedSelector = selector.replace(/::?[\w-]+(?:\([^)]*\))?/g, '').trim();
							let matches = false;
							try {
								matches = !!targetEl.matches(normalizedSelector || selector);
							} catch (e) {
								matches = false;
							}
							if (!matches && normalizedSelector) {
								const selectorParts = normalizedSelector
									.split(/\s+|>|\+|~/)
									.map((part) => String(part || '').trim())
									.filter(Boolean);
								if (selectorParts.length > 1) {
									const tailSelector = selectorParts[selectorParts.length - 1];
									try {
										if (targetEl.matches(tailSelector)) {
											const ancestorParts = selectorParts.slice(0, -1);
											const ancestorClassTokens = [];
											ancestorParts.forEach((part) => {
												const classMatchRe = /\.([_a-zA-Z][-_a-zA-Z0-9]*)/g;
												let classMatch = null;
												while ((classMatch = classMatchRe.exec(part)) !== null) {
													ancestorClassTokens.push(classMatch[1] || '');
												}
											});
											matches = ancestorClassTokens.some((ancestorToken) => {
												const ancClean = sanitizeNewClassToken(ancestorToken);
												return ancClean && !!targetEl.closest(`.${ancClean}`);
											});
										}
									} catch (e) {
										matches = false;
									}
								}
							}
							if (!matches) {
								continue;
							}
							const classMatchRe = /\.([_a-zA-Z][-_a-zA-Z0-9]*)/g;
							let classMatch = null;
							while ((classMatch = classMatchRe.exec(selector)) !== null) {
								const matchedToken = sanitizeNewClassToken(classMatch[1] || '');
								if (!matchedToken) {
									continue;
								}
								pushEntry(matchedToken, selector, currentMedia);
							}
						}
						continue;
					}
					if (rule.cssRules && rule.cssRules.length) {
						let nextMedia = currentMedia;
						if (rule.type === 4 && rule.media && rule.media.mediaText) {
							const inner = String(rule.media.mediaText || '').trim();
							nextMedia = currentMedia ? `${currentMedia} and ${inner}` : inner;
						}
						walkRules(rule.cssRules, nextMedia);
					}
				}
			};
			try {
				walkRules(styleEl.sheet && styleEl.sheet.cssRules ? styleEl.sheet.cssRules : [], '');
			} catch (e) {
				// ignore css parse failures
			}
			styleEl.remove();
			const uniqTokens = [];
			const tokenSeen = new Set();
			outEntries.forEach((entry) => {
				const k = String(entry.token || '').toLowerCase();
				if (!k || tokenSeen.has(k)) {
					return;
				}
				tokenSeen.add(k);
				uniqTokens.push(entry.token);
			});
			outMediaEntries.forEach((entry) => {
				const k = String(entry.token || '').toLowerCase();
				if (!k || tokenSeen.has(k)) {
					return;
				}
				tokenSeen.add(k);
				uniqTokens.push(entry.token);
			});
			return { entries: outEntries, selectorByToken, tokens: uniqTokens, mediaEntries: outMediaEntries };
		}

		function getLocalClassTokensForSuggestions() {
			if (!UichSHE.activeWidgetSettings) {
				return [];
			}
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html') || '';
			const rawCss = getDirectEditorCombinedCss(rawHtml, UichSHE.activeWidgetSettings.get('raw_css') || '');
			const merged = collectLocalClassTokensFromRawHtml(rawHtml)
				.concat(collectLocalClassTokensFromRawCss(rawCss));
			const seen = new Set();
			const uniq = [];
			merged.forEach((token) => {
				const key = String(token || '').toLowerCase();
				if (!key || seen.has(key)) {
					return;
				}
				seen.add(key);
				uniq.push(token);
			});
			return uniq;
		}

		function getLocalClassTypographyStyleMap(rawCss, classToken, preferredSelector, mediaTextFilter) {
			const token = sanitizeNewClassToken(classToken);
			const out = {};
			directClassEditableTypographyProperties.forEach((property) => {
				out[property] = '';
			});
			if (!token || !rawCss) {
				return out;
			}
			const styleEl = document.createElement('style');
			styleEl.textContent = String(rawCss || '');
			document.head.appendChild(styleEl);
			try {
				const normSel = (s) => String(s || '').trim().replace(/\s+/g, ' ');
				const ruleSel = classTokenToTypographyRuleSelector(token);
				const ruleNorm = normSel(ruleSel);
				const matchesToken = (selectorText) => {
					if (!selectorText) return false;
					const parts = String(selectorText).split(',').map((s) => normSel(s)).filter(Boolean);
					for (let i = 0; i < parts.length; i++) {
						if (parts[i] === ruleNorm) {
							return true;
						}
					}
					if (!String(token).includes(':')) {
						return new RegExp(`\\.${escapeRegexForDirectEditor(token)}(?![-_a-zA-Z0-9:])`).test(selectorText);
					}
					return false;
				};
				const preferredSelectorNorm = String(preferredSelector || '').trim();
				const preferredNorm = normSel(preferredSelectorNorm);
				const filterMediaTrim = String(mediaTextFilter || '').trim();
				const filterMediaNorm = normalizeMediaTextForCompare(filterMediaTrim);
				const walkRulesForStyles = (rules, currentMedia) => {
					if (!rules) return;
					for (let i = 0; i < rules.length; i++) {
						const rule = rules[i];
						if (!rule) continue;
						if (rule.type === 1) {
							if (!matchesToken(rule.selectorText)) continue;
							if (preferredSelectorNorm) {
								const selectorParts = String(rule.selectorText || '').split(',').map((s) => normSel(s)).filter(Boolean);
								if (!selectorParts.some((s) => s === preferredNorm)) continue;
							}
							const currentMediaNorm = normalizeMediaTextForCompare(currentMedia);
							if (filterMediaTrim) {
								if (currentMediaNorm !== filterMediaNorm) continue;
							} else {
								if (currentMediaNorm) continue;
							}
							directClassEditableTypographyProperties.forEach((property) => {
								const val = rule.style && rule.style.getPropertyValue(property);
								if (val && String(val).trim() !== '') {
									out[property] = String(val).trim();
								}
							});
							continue;
						}
						if (rule.cssRules && rule.cssRules.length) {
							let nextMedia = currentMedia;
							if (rule.type === 4 && rule.media && rule.media.mediaText) {
								const inner = String(rule.media.mediaText || '').trim();
								nextMedia = currentMedia ? `${currentMedia} and ${inner}` : inner;
							}
							walkRulesForStyles(rule.cssRules, nextMedia);
						}
					}
				};
				walkRulesForStyles(styleEl.sheet && styleEl.sheet.cssRules ? styleEl.sheet.cssRules : [], '');
			} catch (e) {
				// ignore css parse failures
			}
			styleEl.remove();
			return out;
		}

		function findMatchingBraceIndex(text, openBraceIdx) {
			let depth = 1;
			for (let i = openBraceIdx + 1; i < text.length; i++) {
				const ch = text[i];
				if (ch === '{') {
					depth++;
				} else if (ch === '}') {
					depth--;
					if (depth === 0) {
						return i;
					}
				}
			}
			return -1;
		}

		function findMediaBlockRange(cssText, targetMediaText) {
			const targetNorm = normalizeMediaTextForCompare(targetMediaText);
			if (!targetNorm) {
				return null;
			}
			const headerRe = /@media\s+([^{]+)\{/g;
			let m;
			while ((m = headerRe.exec(cssText)) !== null) {
				const headerMedia = String(m[1] || '').trim();
				if (normalizeMediaTextForCompare(headerMedia) !== targetNorm) {
					continue;
				}
				const openBraceIdx = m.index + m[0].length - 1;
				const closeBraceIdx = findMatchingBraceIndex(cssText, openBraceIdx);
				if (closeBraceIdx === -1) {
					continue;
				}
				return {
					startIdx: m.index,
					headerEndIdx: openBraceIdx,
					openBraceIdx,
					closeBraceIdx,
					bodyStart: openBraceIdx + 1,
					bodyEnd: closeBraceIdx
				};
			}
			return null;
		}

		function findRuleBlockRange(cssText, targetSelector, regionStart, regionEnd) {
			const targetNorm = String(targetSelector || '').trim().replace(/\s+/g, ' ').toLowerCase();
			if (!targetNorm) {
				return null;
			}
			const end = typeof regionEnd === 'number' ? regionEnd : cssText.length;
			let i = Math.max(0, regionStart || 0);
			while (i < end) {
				while (i < end && /\s/.test(cssText[i])) i++;
				if (i >= end) break;
				if (cssText[i] === '/' && cssText[i + 1] === '*') {
					const e = cssText.indexOf('*/', i + 2);
					if (e === -1 || e >= end) break;
					i = e + 2;
					continue;
				}
				if (cssText[i] === '@') {
					let j = i;
					while (j < end && cssText[j] !== '{' && cssText[j] !== ';') j++;
					if (j >= end) break;
					if (cssText[j] === ';') {
						i = j + 1;
						continue;
					}
					const close = findMatchingBraceIndex(cssText, j);
					if (close === -1 || close >= end) break;
					i = close + 1;
					continue;
				}
				if (cssText[i] === '}') {
					i++;
					continue;
				}
				const headerStart = i;
				while (i < end && cssText[i] !== '{' && cssText[i] !== '}') i++;
				if (i >= end || cssText[i] !== '{') break;
				const selectorText = cssText.substring(headerStart, i).trim();
				const openBraceIdx = i;
				const closeBraceIdx = findMatchingBraceIndex(cssText, openBraceIdx);
				if (closeBraceIdx === -1 || closeBraceIdx >= end) break;
				const parts = selectorText
					.split(',')
					.map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
					.filter(Boolean);
				if (parts.indexOf(targetNorm) !== -1) {
					return {
						startIdx: headerStart,
						headerEndIdx: openBraceIdx,
						openBraceIdx,
						closeBraceIdx,
						bodyStart: openBraceIdx + 1,
						bodyEnd: closeBraceIdx,
						selectorText
					};
				}
				i = closeBraceIdx + 1;
			}
			return null;
		}

		function parseRuleBodyDeclarations(body) {
			const order = [];
			const map = Object.create(null);
			const text = String(body || '');
			let i = 0;
			while (i < text.length) {
				// Skip whitespace and comments
				while (i < text.length && /\s/.test(text[i])) i++;
				if (i >= text.length) break;
				if (text[i] === '/' && text[i + 1] === '*') {
					const endComment = text.indexOf('*/', i + 2);
					if (endComment === -1) break;
					i = endComment + 2;
					continue;
				}
				// Property name
				let nameStart = i;
				while (i < text.length && text[i] !== ':' && text[i] !== ';' && text[i] !== '{' && text[i] !== '}') {
					i++;
				}
				if (i >= text.length || text[i] !== ':') {
					// Skip past unexpected char
					if (text[i] === ';') {
						i++;
						continue;
					}
					break;
				}
				const name = text.substring(nameStart, i).trim();
				i++; // skip ':'
				// Value: up to ';' or end, accounting for parens/quotes
				let valueStart = i;
				let depth = 0;
				let quote = '';
				while (i < text.length) {
					const ch = text[i];
					if (quote) {
						if (ch === '\\') {
							i += 2;
							continue;
						}
						if (ch === quote) {
							quote = '';
						}
					} else if (ch === '"' || ch === '\'') {
						quote = ch;
					} else if (ch === '(') {
						depth++;
					} else if (ch === ')') {
						if (depth > 0) depth--;
					} else if (ch === ';' && depth === 0) {
						break;
					} else if (ch === '}' && depth === 0) {
						break;
					}
					i++;
				}
				const value = text.substring(valueStart, i).trim();
				if (name) {
					if (!(name in map)) {
						order.push(name);
					}
					map[name] = value;
				}
				if (i < text.length && text[i] === ';') {
					i++;
				}
			}
			return { order, map };
		}

		function serializeRuleBody(declOrder, declMap, indent) {
			const pad = indent || '  ';
			return declOrder
				.filter((name) => String(declMap[name] || '').length > 0)
				.map((name) => `${pad}${name}: ${declMap[name]};`)
				.join('\n');
		}

		function applyPropMapToDeclarations(declOrder, declMap, propMap) {
			Object.keys(propMap).forEach((property) => {
				const value = String(propMap[property] || '').trim();
				if (value) {
					if (!(property in declMap)) {
						declOrder.push(property);
					}
					declMap[property] = value;
				} else if (property in declMap) {
					delete declMap[property];
					const idx = declOrder.indexOf(property);
					if (idx !== -1) {
						declOrder.splice(idx, 1);
					}
				}
			});
		}

		function upsertSelectorRuleInRegion(cssText, regionStart, regionEnd, selector, propMap, indent) {
			const block = findRuleBlockRange(cssText, selector, regionStart, regionEnd);
			if (block) {
				const body = cssText.substring(block.bodyStart, block.bodyEnd);
				const { order, map } = parseRuleBodyDeclarations(body);
				applyPropMapToDeclarations(order, map, propMap);
				const serialized = serializeRuleBody(order, map, indent);
				if (!serialized.trim()) {
					// Remove the rule entirely (header to closing brace).
					// Trim trailing whitespace/newline after the closing brace too.
					let removeStart = block.startIdx;
					let removeEnd = block.closeBraceIdx + 1;
					while (removeEnd < cssText.length && (cssText[removeEnd] === '\n' || cssText[removeEnd] === ' ' || cssText[removeEnd] === '\t')) {
						if (cssText[removeEnd] === '\n') {
							removeEnd++;
							break;
						}
						removeEnd++;
					}
					return cssText.substring(0, removeStart) + cssText.substring(removeEnd);
				}
				const outerIndent = indent && indent.length >= 2 ? indent.substring(0, indent.length - 2) : '';
				return cssText.substring(0, block.bodyStart)
					+ `\n${serialized}\n${outerIndent}`
					+ cssText.substring(block.bodyEnd);
			}
			// Rule does not exist — insert before regionEnd.
			const hasAnyValue = Object.keys(propMap).some((k) => String(propMap[k] || '').trim() !== '');
			if (!hasAnyValue) {
				return cssText;
			}
			const order = [];
			const map = Object.create(null);
			applyPropMapToDeclarations(order, map, propMap);
			const serialized = serializeRuleBody(order, map, indent);
			if (!serialized.trim()) {
				return cssText;
			}
			const outerIndent = indent && indent.length >= 2 ? indent.substring(0, indent.length - 2) : '';
			const insertion = `${outerIndent}${selector} {\n${serialized}\n${outerIndent}}\n`;
			// Insert just before regionEnd. Ensure newline separation.
			const before = cssText.substring(0, regionEnd);
			const after = cssText.substring(regionEnd);
			const needsLeadingNewline = before.length > 0 && before[before.length - 1] !== '\n';
			return before + (needsLeadingNewline ? '\n' : '') + insertion + after;
		}

		function upsertLocalClassTypographyInCss(rawCss, classToken, styleUpdates, preferredSelector, mediaText) {
			const token = sanitizeNewClassToken(classToken);
			if (!token) {
				return String(rawCss || '');
			}
			const cssText = String(rawCss || '');
			const ruleSel = classTokenToTypographyRuleSelector(token);
			const normalized = styleUpdates
				.map(([property, value]) => [String(property || '').trim(), String(value || '').trim()])
				.filter(([property]) => directClassEditableTypographyProperties.indexOf(property) !== -1);
			const propMap = Object.create(null);
			normalized.forEach(([property, value]) => {
				propMap[property] = value;
			});
			const preferred = String(preferredSelector || '').trim();
			const selectorToUpsert = preferred || ruleSel;
			const mediaTrim = String(mediaText || '').trim();
			if (mediaTrim) {
				const mediaBlock = findMediaBlockRange(cssText, mediaTrim);
				if (mediaBlock) {
					return upsertSelectorRuleInRegion(
						cssText,
						mediaBlock.bodyStart,
						mediaBlock.bodyEnd,
						selectorToUpsert,
						propMap,
						'    '
					);
				}
				// No matching @media — create a new block at end.
				const hasAnyValue = Object.keys(propMap).some((k) => String(propMap[k] || '').trim() !== '');
				if (!hasAnyValue) {
					return cssText;
				}
				const order = [];
				const map = Object.create(null);
				applyPropMapToDeclarations(order, map, propMap);
				const serialized = serializeRuleBody(order, map, '    ');
				if (!serialized.trim()) {
					return cssText;
				}
				const prefix = cssText.trim() ? cssText.replace(/\s+$/, '') + '\n\n' : '';
				return `${prefix}@media ${mediaTrim} {\n  ${selectorToUpsert} {\n${serialized}\n  }\n}\n`;
			}
			return upsertSelectorRuleInRegion(
				cssText,
				0,
				cssText.length,
				selectorToUpsert,
				propMap,
				'  '
			);
		}

		function upsertLocalClassTypographyInRawHtmlStyles(rawHtml, classToken, styleUpdates, preferredSelector, mediaText) {
			const htmlText = String(rawHtml || '');
			if (!htmlText) {
				return { html: htmlText, changed: false };
			}
			const doc = document.createElement('div');
			doc.innerHTML = htmlText;
			const styleTags = Array.from(doc.querySelectorAll('style'));
			if (!styleTags.length) {
				return { html: htmlText, changed: false };
			}
			for (let i = 0; i < styleTags.length; i++) {
				const styleEl = styleTags[i];
				const currentCss = String(styleEl.textContent || '');
				const nextCss = upsertLocalClassTypographyInCss(currentCss, classToken, styleUpdates, preferredSelector, mediaText);
				if (nextCss !== currentCss) {
					styleEl.textContent = nextCss;
					return { html: doc.innerHTML, changed: true };
				}
			}
			return { html: htmlText, changed: false };
		}

		function removeLocalClassSelectorsInCss(rawCss, classToken, preferredSelector) {
			const token = sanitizeNewClassToken(classToken);
			const cssText = String(rawCss || '');
			if (!token || !cssText.trim()) {
				return cssText;
			}

			const preferredNorm = String(preferredSelector || '').trim();
			const normalizeSelector = (selector) => String(selector || '').trim().replace(/\s+/g, ' ');
			// Only remove selectors that exactly match the preferred rule (after whitespace normalize).
			// Do not strip pseudo-classes for comparison — otherwise removing `.btn:hover` also removes `.btn`.
			const selectorMatchesPreferred = (selector) => {
				if (!preferredNorm) {
					return false;
				}
				return normalizeSelector(selector) === normalizeSelector(preferredNorm);
			};
			const removeByTextFallback = (text) => {
				if (!preferredNorm) {
					return text;
				}
				const styleNode = document.createElement('style');
				styleNode.textContent = String(text || '');
				document.head.appendChild(styleNode);
				const localSheet = styleNode.sheet;
				if (!localSheet) {
					styleNode.remove();
					return text;
				}
				try {
					let changed = false;
					for (let i = localSheet.cssRules.length - 1; i >= 0; i--) {
						const rule = localSheet.cssRules[i];
						if (!rule || rule.type !== 1 || !rule.selectorText) continue;
						const selectors = String(rule.selectorText).split(',').map((s) => s.trim()).filter(Boolean);
						const keptSelectors = selectors.filter((selector) => !selectorMatchesPreferred(selector));
						if (keptSelectors.length === selectors.length) continue;
						changed = true;
						if (!keptSelectors.length) {
							localSheet.deleteRule(i);
						} else {
							rule.selectorText = keptSelectors.join(', ');
						}
					}
					if (!changed) {
						styleNode.remove();
						return text;
					}
					const rebuilt = Array.from(localSheet.cssRules || [])
						.map((rule) => String(rule.cssText || ''))
						.filter(Boolean)
						.join('\n');
					styleNode.remove();
					return rebuilt;
				} catch (e) {
					styleNode.remove();
					return text;
				}
			};

			const styleEl = document.createElement('style');
			styleEl.textContent = cssText;
			document.head.appendChild(styleEl);
			const sheet = styleEl.sheet;
			if (!sheet) {
				styleEl.remove();
				return cssText;
			}

			const mutateRules = (rules) => {
				if (!rules || !rules.length) {
					return;
				}
				for (let i = rules.length - 1; i >= 0; i--) {
					const rule = rules[i];
					if (!rule) continue;
					if (rule.type === 1 && rule.selectorText) {
						const selectors = String(rule.selectorText).split(',').map((s) => s.trim()).filter(Boolean);
						if (!selectors.length) continue;
						const keptSelectors = selectors.filter((selector) => {
							if (!preferredNorm) {
								return true;
							}
							return !selectorMatchesPreferred(selector);
						});
						if (keptSelectors.length === selectors.length) continue;
						if (!keptSelectors.length) {
							rules.deleteRule(i);
						} else {
							rule.selectorText = keptSelectors.join(', ');
						}
						continue;
					}
					if (rule.cssRules && rule.cssRules.length) {
						mutateRules(rule.cssRules);
					}
				}
			};

			try {
				mutateRules(sheet.cssRules || []);
				const nextCss = Array.from(sheet.cssRules || [])
					.map((rule) => String(rule.cssText || ''))
					.filter(Boolean)
					.join('\n');
				styleEl.remove();
				if (nextCss !== cssText) {
					return nextCss;
				}
				return removeByTextFallback(nextCss);
			} catch (e) {
				styleEl.remove();
				return removeByTextFallback(cssText);
			}
		}

		function removeLocalClassSelectorsInRawHtmlStyles(rawHtml, classToken, preferredSelector) {
			const htmlText = String(rawHtml || '');
			if (!htmlText) {
				return { html: htmlText, changed: false };
			}
			const doc = document.createElement('div');
			doc.innerHTML = htmlText;
			const styleTags = Array.from(doc.querySelectorAll('style'));
			if (!styleTags.length) {
				return { html: htmlText, changed: false };
			}
			let changed = false;
			for (let i = 0; i < styleTags.length; i++) {
				const styleEl = styleTags[i];
				const currentCss = String(styleEl.textContent || '');
				const nextCss = removeLocalClassSelectorsInCss(currentCss, classToken, preferredSelector);
				if (nextCss !== currentCss) {
					styleEl.textContent = nextCss;
					changed = true;
				}
			}
			return changed ? { html: doc.innerHTML, changed: true } : { html: htmlText, changed: false };
		}

		function deleteLocalClassDefinitions(classToken, preferredSelector) {
			const token = sanitizeNewClassToken(classToken);
			if (!token || !UichSHE.activeWidgetSettings) {
				return;
			}

			const rawCss = UichSHE.activeWidgetSettings.get('raw_css') || '';
			const nextCss = removeLocalClassSelectorsInCss(rawCss, token, preferredSelector);
			if (nextCss !== rawCss) {
				UichSHE.activeWidgetSettings.set('raw_css', nextCss);
				markEditorDirty();
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const cssInput = UichSHE.activePanelView.$el.find('[data-setting="raw_css"]');
					if (cssInput.length && cssInput.val() !== nextCss) {
						cssInput.val(nextCss).trigger('input').trigger('change');
					}
				}
			}

			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html') || '';
			const styleHtmlUpdate = removeLocalClassSelectorsInRawHtmlStyles(rawHtml, token, preferredSelector);
			if (styleHtmlUpdate.changed) {
				markRawHtmlChanged(styleHtmlUpdate.html);
			}

			const selTok = String(selectedAppliedClassToken || '').toLowerCase();
			const selSel = String(selectedAppliedClassSelector || '').trim();
			if (selTok === String(token || '').toLowerCase() && (!preferredSelector || selectorsMatchForDirectClassSelection(selSel, preferredSelector))) {
				selectedAppliedClassToken = '';
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
			}
		}

		function filterClassSuggestionsForInput(query) {
			const q = String(query || '').trim().toLowerCase();
			if (!q) {
				return [];
			}

			ensureDirectEditorV3TypographyNameCache();
			if (!Object.keys(directAtomicClassByToken).length) {
				ensureAtomicSnapshotCache();
			}
			const suggestions = [];
			const seenTokens = new Set();

			Object.keys(directEditorV3TypographyById).forEach((id) => {
				const title = Object.keys(directEditorV3TypographyByTitle).find((name) => directEditorV3TypographyByTitle[name] === directEditorV3TypographyById[id]) || id;
				const token = `text-${id}`;
				const tokenLower = token.toLowerCase();
				const titleLower = String(title || '').toLowerCase();
				if (!tokenLower.includes(q) && !titleLower.includes(q)) {
					return;
				}
				if (seenTokens.has(tokenLower)) {
					return;
				}
				seenTokens.add(tokenLower);
				suggestions.push({
					source: 'typography',
					token,
					label: token,
					meta: `Elementor v3 global typography · ${title}`,
					typographyTitle: title,
				});
			});

			Object.keys(directAtomicClassByToken).forEach((tokenLower) => {
				const atomicClass = directAtomicClassByToken[tokenLower];
				if (!atomicClass) {
					return;
				}
				const token = atomicClass.token;
				const title = atomicClass.label || token;
				if (!tokenLower.includes(q) && !String(title).toLowerCase().includes(q)) {
					return;
				}
				if (seenTokens.has(tokenLower)) {
					return;
				}
				seenTokens.add(tokenLower);
				suggestions.push({
					source: 'atomic_class',
					token,
					label: token,
					meta: `Elementor Atomic global class · ${title}`,
					typographyTitle: '',
				});
			});

			getLocalClassTokensForSuggestions().forEach((token) => {
				const lowerToken = token.toLowerCase();
				if (!lowerToken.includes(q)) {
					return;
				}
				if (seenTokens.has(lowerToken)) {
					return;
				}
				seenTokens.add(lowerToken);
				suggestions.push({
					source: 'local',
					token,
					label: token,
					meta: 'Local class from this widget HTML/CSS',
					typographyTitle: '',
				});
			});

			return suggestions.slice(0, 10);
		}

		function hideDirectClassSuggestions() {
			if (!directClassSuggestions) {
				return;
			}
			directClassSuggestions.innerHTML = '';
			directClassSuggestions.hidden = true;
			if (directClassInput) {
				directClassInput.setAttribute('aria-expanded', 'false');
			}
		}

		function showDirectClassSuggestionsForQuery(query) {
			if (!directClassSuggestions || !directClassInput) {
				return;
			}
			const matches = filterClassSuggestionsForInput(query);
			if (!matches.length) {
				hideDirectClassSuggestions();
				return;
			}
			directClassSuggestions.innerHTML = matches.map((entry) => {
				return `<li class="uichemy-composer-direct-class-suggestion" role="option" data-class-token="${encodeURIComponent(entry.token)}" data-source="${encodeURIComponent(entry.source)}" data-typography-title="${encodeURIComponent(entry.typographyTitle || '')}"><span class="uichemy-composer-direct-class-suggestion-title">${UichSHE.escapeHtml(entry.label)}</span><span class="uichemy-composer-direct-class-suggestion-meta">${UichSHE.escapeHtml(entry.meta)}</span></li>`;
			}).join('');
			directClassSuggestions.hidden = false;
			directClassInput.setAttribute('aria-expanded', 'true');
		}

		function syncDirectInputsFromSelection() {
			if (!UichSHE.activeWidgetSettings) {
				if (directList) {
					directList.innerHTML = '<div class="uichemy-composer-direct-empty">Open a UiChemy Composer widget to inspect its HTML layers.</div>';
				}
				if (directMeta) {
					directMeta.textContent = 'No active UiChemy Composer widget context found.';
				}
				if (directClassesChips) {
					directClassesChips.innerHTML = '<span class="uichemy-composer-direct-classes-empty">No classes on this element</span>';
				}
				if (directClassInput) {
					directClassInput.value = '';
					directClassInput.disabled = true;
					directClassInput.setAttribute('aria-expanded', 'false');
				}
				if (directClassSuggestions) {
					directClassSuggestions.innerHTML = '';
					directClassSuggestions.hidden = true;
				}
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
				directContextualClassTokens = [];
				directContextualClassEntries = [];
				directMediaClassEntries = [];
				Object.keys(directContextualSelectorByToken).forEach((key) => delete directContextualSelectorByToken[key]);
				if (directImageSection) {
					directImageSection.style.display = 'none';
				}
				if (directImagePath) {
					directImagePath.value = '';
					directImagePath.disabled = true;
				}
				if (directImagePreview) {
					directImagePreview.disabled = true;
				}
				if (directImagePreviewImg) {
					directImagePreviewImg.removeAttribute('src');
					directImagePreviewImg.style.display = 'none';
				}
				if (directImageEmpty) {
					directImageEmpty.style.display = '';
				}
				if (directMediaGrid) {
					directMediaGrid.classList.remove('is-svg');
				}
				if (directSvgCodeWrap) {
					directSvgCodeWrap.style.display = 'none';
				}
				if (directSvgCode) {
					UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-direct-svg-code', '', false);
					directSvgCode.disabled = true;
				}
				if (directSvgMode) {
					setActiveDirectSvgMode('code');
					directSvgMode.disabled = true;
				}
				if (directSvgModeWrap) {
					directSvgModeWrap.style.display = 'none';
				}
				if (directText) {
					directText.value = '';
					directText.disabled = true;
				}
				if (directTextField) {
					directTextField.style.display = 'none';
				}
				if (directSvgActions) {
					directSvgActions.style.display = 'none';
				}
				if (directSvgUrl) {
					directSvgUrl.value = '';
					directSvgUrl.disabled = true;
				}
				if (directSvgUrlApplyBtn) {
					directSvgUrlApplyBtn.disabled = true;
				}
				if (directSvgWordpressBtn) {
					directSvgWordpressBtn.disabled = true;
				}
				if (directLinkWrap) {
					directLinkWrap.style.display = 'none';
				}
				if (directUrl) {
					directUrl.value = '';
					directUrl.disabled = true;
				}
				if (directExternal) {
					directExternal.checked = false;
					directExternal.disabled = true;
				}
				if (directNofollow) {
					directNofollow.checked = false;
					directNofollow.disabled = true;
				}
				if (directCustom) {
					directCustom.value = '';
					directCustom.disabled = true;
				}
				if (directFontSize) {
					directFontSize.value = '';
					directFontSize.disabled = true;
				}
				if (directFontWeight) {
					directFontWeight.value = '';
					directFontWeight.disabled = true;
				}
				if (directFontFamily) {
					directFontFamily.value = '';
					directFontFamily.disabled = true;
				}
				if (directLineHeight) {
					directLineHeight.value = '';
					directLineHeight.disabled = true;
				}
				if (directTextAlign) {
					directTextAlign.value = '';
					directTextAlign.disabled = true;
				}
				if (directFontStyle) {
					directFontStyle.value = '';
					directFontStyle.disabled = true;
				}
				if (directLetterSpacing) {
					directLetterSpacing.value = '';
					directLetterSpacing.disabled = true;
				}
				if (directTextTransform) {
					directTextTransform.value = '';
					directTextTransform.disabled = true;
				}
				if (directTextDecoration) {
					directTextDecoration.value = '';
					directTextDecoration.disabled = true;
				}
				if (directTextColor) {
					directTextColor.value = '';
					directTextColor.disabled = true;
					if (directTextColor.dataset) {
						directTextColor.dataset.ucDisplayValue = '';
					}
				}
				if (directTextColorPicker) {
					assignDirectColorPickerValue(directTextColorPicker, '#000000');
					directTextColorPicker.disabled = true;
				}
				if (directLayoutBgColor) {
					directLayoutBgColor.value = '';
					directLayoutBgColor.disabled = true;
					if (directLayoutBgColor.dataset) {
						directLayoutBgColor.dataset.ucDisplayValue = '';
					}
				}
				if (directLayoutBgColorPicker) {
					assignDirectColorPickerValue(directLayoutBgColorPicker, '#000000');
					directLayoutBgColorPicker.disabled = true;
				}
				layoutStyleFields.forEach((field) => {
					if (field === directLayoutBgColor) return;
					field.value = '';
					field.disabled = true;
				});
				if (directReset) {
					directReset.disabled = true;
				}
				if (directStatus) {
					directStatus.textContent = 'Layers are available after opening a UiChemy Composer widget in the editor.';
				}
				syncDirectGlobalColorChip('text', '');
				syncDirectGlobalColorChip('background', '');
				hideDirectGlobalColorPopover();
				return;
			}

			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html') || '';
			const rawCssCombined = getDirectEditorCombinedCss(rawHtml, UichSHE.activeWidgetSettings.get('raw_css') || '');
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const slotNodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, slotNodes);
			if (!slotNodes.length) {
				selectedSlotIndex = 0;
			}

			if (selectedSlotIndex >= slotNodes.length) {
				selectedSlotIndex = Math.max(0, slotNodes.length - 1);
			}

			if (!directList || !directMeta || !directClassesWrap || !directClassesChips || !directClassInput || !directClassSuggestions || !directImageSection || !directImagePath || !directImagePreview || !directImagePreviewImg || !directImageEmpty || !directText || !directUrl || !directExternal || !directNofollow || !directCustom || !directFontSize || !directFontFamily || !directFontWeight || !directLineHeight || !directTextAlign || !directFontStyle || !directLetterSpacing || !directTextTransform || !directTextDecoration || !directTextColor || !directTextColorPicker || !directLayoutBgColor || !directLayoutBgColorPicker || !layoutStyleFields.length || !directStatus) {
				return;
			}

			const dynamics = UichSHE.activeWidgetSettings.get('__dynamic__') || {};
			const selectedLayer = layerEntries.find(entry => entry.id === selectedLayerId);
			if (!selectedLayer) {
				const fallback = layerEntries.find(entry => entry.slotIndex === selectedSlotIndex) || layerEntries[0] || null;
				selectedLayerId = fallback ? fallback.id : '';
			}

			const layerMap = new Map();
			layerEntries.forEach(entry => layerMap.set(entry.id, entry));

			const activeForExpand = layerMap.get(selectedLayerId);
			if (autoExpandSelectedAncestors && activeForExpand) {
				let parentId = activeForExpand.parentId;
				while (parentId) {
					collapsedLayerIds.delete(parentId);
					const parent = layerMap.get(parentId);
					parentId = parent ? parent.parentId : null;
				}
			}
			autoExpandSelectedAncestors = false;

			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			let listHtml = '';
			layerEntries.forEach((entry) => {
				let hiddenByCollapsedParent = false;
				let currentParentId = entry.parentId;
				while (currentParentId) {
					if (collapsedLayerIds.has(currentParentId)) {
						hiddenByCollapsedParent = true;
						break;
					}
					const parent = layerMap.get(currentParentId);
					currentParentId = parent ? parent.parentId : null;
				}

				if (hiddenByCollapsedParent) {
					return;
				}

				const isActive = !!(activeLayer && activeLayer.id === entry.id);
				const isEditable = typeof entry.slotIndex === 'number';
				const slotAttr = isEditable ? `data-slot-index="${entry.slotIndex}"` : '';
				const hasChildren = !!entry.hasChildren;
				const isCollapsed = hasChildren && collapsedLayerIds.has(entry.id);
				const toggleHtml = hasChildren
					? `<button class="uichemy-composer-layer-toggle" type="button" draggable="false" data-layer-toggle="${entry.id}" aria-label="Toggle ${UichSHE.escapeHtml(entry.label)}">${isCollapsed ? '▸' : '▾'}</button>`
					: '<span class="uichemy-composer-layer-toggle-spacer"></span>';
				const pKeyForSiblings = entry.parentId || '';
				const parentIdAttr = UichSHE.escapeHtml(pKeyForSiblings);
				const titleInnerHtml = entry.contentPreview
					? `<span class="uichemy-composer-direct-item-title-label">${UichSHE.escapeHtml(entry.label)}</span><span class="uichemy-composer-direct-item-content"> - ${UichSHE.escapeHtml(entry.contentPreview)}</span>`
					: UichSHE.escapeHtml(entry.label);
				const titleBlockHtml = `<span class="uichemy-composer-direct-item-title">${titleInnerHtml}</span>`;
				listHtml += `
					<div role="button" tabindex="0" class="uichemy-composer-direct-item ${isActive ? 'is-active' : ''} ${isEditable ? 'is-editable' : ''} is-layer-draggable" draggable="true" title="Drag to move layer; use ⋯ for copy, cut, paste, delete" data-layer-id="${entry.id}" data-layer-parent="${parentIdAttr}" ${slotAttr}>
						<span class="uichemy-composer-direct-item-depth" style="--uc-layer-depth: ${entry.depth};">
							<span class="uichemy-composer-direct-item-title-wrap">
								<span class="uichemy-composer-layer-left">
									${toggleHtml}
									${titleBlockHtml}
								</span>
								<button type="button" class="uichemy-composer-layer-menu-btn" draggable="false" data-layer-menu="${entry.id}" aria-label="Layer actions" aria-haspopup="true" aria-expanded="false" title="Copy, cut, paste, delete">⋯</button>
							</span>
						</span>
					</div>
				`;
			});

			directList.innerHTML = listHtml || '<div class="uichemy-composer-direct-empty">No HTML layers were found in the current content.</div>';

			const activeSlotIndex = activeLayer && typeof activeLayer.slotIndex === 'number' ? activeLayer.slotIndex : null;
			if (typeof activeSlotIndex === 'number') {
				selectedSlotIndex = activeSlotIndex;
			}

			const slotNode = typeof activeSlotIndex === 'number' ? slotNodes[activeSlotIndex] : null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const node = layerNode || slotNode;
			const slotKey = typeof activeSlotIndex === 'number' ? `slot_${activeSlotIndex}` : '';
			const linkKey = typeof activeSlotIndex === 'number' ? `slot_${activeSlotIndex}_link` : '';
			const isDynamicText = !!(slotKey && dynamics[slotKey] && dynamics[slotKey] !== '');
			const linkTargetNode = (layerNode && layerNode.nodeType === Node.ELEMENT_NODE && layerNode.tagName === 'A')
				? layerNode
				: slotNode;
			const isAnchor = !!(linkTargetNode && linkTargetNode.nodeType === Node.ELEMENT_NODE && linkTargetNode.tagName === 'A');
			const currentLink = linkKey ? (UichSHE.activeWidgetSettings.get(linkKey) || {}) : {};
			const typographyTarget = getTypographyTargetNode(node);
			const nodeTag = UichSHE.getTagNameUpper(node);
			const typographyTargetTag = UichSHE.getTagNameUpper(typographyTarget);
			const isSvgElementLayer = nodeTag === 'SVG';
			const isSvgUrlLayer = typographyTargetTag === 'IMG' && UichSHE.isSvgUrlValue(typographyTarget.getAttribute('src') || '');
			const isSvgLayer = isSvgElementLayer || isSvgUrlLayer;
			const canEditElementText = !!(
				layerNode
				&& layerNode.nodeType === Node.ELEMENT_NODE
				&& !UichSHE.isDirectTextDisallowedElement(layerNode)
				&& !isSvgLayer
				&& !Array.from(layerNode.childNodes || []).some((child) => child.nodeType === Node.ELEMENT_NODE && !UichSHE.isLayerSkippedElement(child))
			);
			const canEditSelection = !!slotNode || canEditElementText || isSvgLayer;
			const isImageLayer = typographyTargetTag === 'IMG' && !isSvgUrlLayer;
			const canEditTypography = !!(typographyTarget && !isSvgLayer && canEditTypographyTarget(typographyTarget));
			const canEditLayout = !!typographyTarget;
			const resolvedSnapshot = activeLayer && activeLayer.path
				? getResolvedStyleSnapshot(rawHtml, rawCssCombined, activeLayer.path, layoutStyleProperties)
				: { className: '', styles: {}, declaredProperties: new Set() };

			isDirectSyncing = true;
			const slotMeta = typeof activeSlotIndex === 'number' ? ` · slot ${activeSlotIndex + 1}` : '';
			directMeta.textContent = node
				? `${UichSHE.getNodeLabel(node, typeof activeSlotIndex === 'number' ? activeSlotIndex : 0)}${slotMeta}${isAnchor ? ' · anchor element' : ''}${isDynamicText ? ' · dynamic text enabled' : ''}`
				: (activeLayer ? `${activeLayer.label} is currently a non-editable layer. Select a row tagged with a slot number to edit text.` : 'No editable element is currently selected.');
			const canEditClasses = !!(typographyTarget && typographyTarget.nodeType === Node.ELEMENT_NODE);
			ensureDirectEditorV3TypographyNameCache();
			const appliedClassTokens = parseClassNameString(resolvedSnapshot.className || '');
			const contextualClassData = canEditClasses
				? collectContextualClassSelectorsForElement(rawCssCombined, typographyTarget)
				: { entries: [], selectorByToken: Object.create(null), tokens: [], mediaEntries: [] };
			directContextualClassEntries = contextualClassData.entries || [];
			directContextualClassTokens = contextualClassData.tokens || [];
			directMediaClassEntries = contextualClassData.mediaEntries || [];
			Object.keys(directContextualSelectorByToken).forEach((key) => delete directContextualSelectorByToken[key]);
			Object.keys(contextualClassData.selectorByToken || {}).forEach((key) => {
				directContextualSelectorByToken[String(key || '').toLowerCase()] = contextualClassData.selectorByToken[key];
			});
			const mergedAppliedTokenLowerSet = new Set(appliedClassTokens.map((token) => String(token || '').toLowerCase()));
			directContextualClassTokens.forEach((token) => {
				mergedAppliedTokenLowerSet.add(String(token || '').toLowerCase());
			});
			if (selectedAppliedClassToken && !mergedAppliedTokenLowerSet.has(String(selectedAppliedClassToken).toLowerCase())) {
				selectedAppliedClassToken = '';
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
			}
			directCurrentElementorBreakpoint = getElementorCurrentDeviceMode();
			renderDirectAppliedClassChips(
				resolvedSnapshot.className || '',
				canEditClasses,
				selectedAppliedClassToken,
				directContextualClassEntries,
				directMediaClassEntries
			);
			ensureDirectElementorBreakpointListener();
			const mergedGlobalClassTypography = buildTypographyStyleMapFromClassTokens(appliedClassTokens);
			const globalClassColorMap = buildGlobalClassColorMap(appliedClassTokens);
			// Per-property source class (local + global) for the dot indicator next to each field.
			const activeBreakpointMediaTextForSource = getActiveBreakpointMediaText();
			const classPropertySourceMap = buildClassSourceMapForApplied(
				rawCssCombined,
				appliedClassTokens,
				activeBreakpointMediaTextForSource,
				directClassEditableTypographyProperties
			);
			const allClassColorMap = buildAllClassColorMap(appliedClassTokens);
			const activeBpKeyForOrigin = directCurrentElementorBreakpoint || getElementorCurrentDeviceMode() || 'desktop';
			const selectedClassTokenLower = String(selectedAppliedClassToken || '').toLowerCase();
			const isSelectedGlobalClass = !!(selectedClassTokenLower && getV3TypographyPresetByClassToken(selectedClassTokenLower));
			const isSelectedLocalClass = !!(selectedClassTokenLower && !isSelectedGlobalClass && (
				appliedClassTokens.some((t) => String(t).toLowerCase() === selectedClassTokenLower)
				|| directContextualClassEntries.some((e) => String(e.token || '').toLowerCase() === selectedClassTokenLower)
				|| directMediaClassEntries.some((e) => String(e.token || '').toLowerCase() === selectedClassTokenLower)
			));
			const selectedPreferredSelector = selectedAppliedClassSelector
				|| String(directContextualSelectorByToken[selectedClassTokenLower] || '').trim();
			// Chips always edit at the CURRENT active breakpoint — the chip's stored media/bp from
			// click-time is ignored so switching Elementor's responsive toggle automatically retargets
			// reads and writes to the right @media bucket without relying on a deviceMode listener.
			const readMediaTextForSelected = getActiveBreakpointMediaText();
			const selectedLocalClassStyles = isSelectedLocalClass
				? getLocalClassTypographyStyleMap(rawCssCombined, selectedClassTokenLower, selectedPreferredSelector, readMediaTextForSelected)
				: null;
			const isSelectedChipReadOnly = false;
			if (panel) {
				panel.classList.toggle('uichemy-composer-direct-readonly-breakpoint', false);
			}
			if (directClassInput) {
				directClassInput.value = '';
				directClassInput.disabled = !canEditClasses;
				directClassInput.setAttribute('aria-expanded', 'false');
			}
			if (directClassUnselect) {
				directClassUnselect.style.display = selectedAppliedClassToken ? '' : 'none';
				directClassUnselect.disabled = !selectedAppliedClassToken;
			}
			hideDirectClassSuggestions();
			const isMediaLayer = isImageLayer || isSvgLayer;
			directImageSection.style.display = isMediaLayer ? '' : 'none';
			directImageSection.classList.toggle('is-svg-layer', isSvgLayer);
			if (directImageSectionTitle) {
				directImageSectionTitle.textContent = isSvgLayer ? '' : 'Image';
				directImageSectionTitle.style.display = isSvgLayer ? 'none' : '';
			}
			if (directMediaGrid) {
				directMediaGrid.classList.toggle('is-svg', isSvgElementLayer);
			}
			const selectedSvgMode = getSelectedDirectSvgMode(isSvgElementLayer, isSvgUrlLayer);
			const inlineSvgMarkup = (isSvgElementLayer && selectedSvgMode === 'code')
				? String((node && node.outerHTML) || '')
				: '';
			const inlineSvgSourceUrl = isSvgElementLayer ? String((node && node.getAttribute && node.getAttribute('data-uc-svg-source')) || '').trim() : '';
			const inlineSvgPreviewSrc = svgMarkupToPreviewDataUri(inlineSvgMarkup);
			const imageSrc = isImageLayer
				? (typographyTarget.getAttribute('src') || '')
				: ((selectedSvgMode === 'url' && isSvgLayer)
					? (isSvgUrlLayer ? (typographyTarget.getAttribute('src') || '') : inlineSvgSourceUrl)
					: inlineSvgPreviewSrc);
			if (directSvgMode) {
				directSvgMode.disabled = !isSvgLayer;
				if (!isSvgLayer) {
					setActiveDirectSvgMode('code');
				} else if (directSvgMode.value !== selectedSvgMode) {
					setActiveDirectSvgMode(selectedSvgMode);
				}
			}
			directSvgModeTabs.forEach((tabButton) => {
				tabButton.disabled = !isSvgLayer;
			});
			if (directSvgModeWrap) {
				directSvgModeWrap.style.display = isSvgLayer ? '' : 'none';
			}
			const isSvgCodeMode = isSvgLayer && selectedSvgMode === 'code';
			if (directImagePathLabel) {
				directImagePathLabel.textContent = isSvgLayer ? 'SVG URL' : 'Image URL';
			}
			if (directImageOverlayText) {
				directImageOverlayText.textContent = isSvgLayer ? 'Select SVG' : 'Change Image';
			}
			if (directImageUrlWrap) {
				directImageUrlWrap.style.display = isSvgCodeMode ? 'none' : '';
			}
			setInputValuePreserveActiveTyping(directImagePath, isSvgCodeMode ? '' : imageSrc);
			directImagePath.disabled = !isMediaLayer;
			directImagePath.placeholder = isSvgLayer ? 'https://example.com/icon.svg' : 'https://example.com/image.jpg';
			directImagePreview.disabled = !isMediaLayer;
			directImagePreview.setAttribute('aria-label', isSvgLayer ? 'Select SVG' : 'Change Image');
			directImageEmpty.textContent = isSvgLayer ? 'No SVG selected' : 'No image selected';
			const svgCodePreviewSrc = isSvgCodeMode
				? svgMarkupToPreviewDataUri(UichSHE.getUiChemyComposerEditorValueById('uichemy-composer-direct-svg-code') || inlineSvgMarkup)
				: '';
			const previewSrc = isSvgCodeMode ? svgCodePreviewSrc : imageSrc;
			if (!(isSvgCodeMode && /^blob:/i.test(previewSrc || ''))) {
				clearDirectSvgPreviewObjectUrl();
			}
			if (isMediaLayer && previewSrc) {
				directImagePreviewImg.src = previewSrc;
				directImagePreviewImg.style.display = 'block';
				directImageEmpty.style.display = 'none';
			} else {
				directImagePreviewImg.removeAttribute('src');
				directImagePreviewImg.style.display = 'none';
				directImageEmpty.style.display = '';
			}
			if (directSvgCodeWrap) {
				directSvgCodeWrap.style.display = (isSvgLayer && selectedSvgMode === 'code') ? '' : 'none';
			}
			if (directSvgCode) {
				UichSHE.setUiChemyComposerEditorValueById(
					'uichemy-composer-direct-svg-code',
					(isSvgLayer && selectedSvgMode === 'code' && isSvgElementLayer) ? (node.outerHTML || '') : '',
					false
				);
				directSvgCode.disabled = !(isSvgLayer && selectedSvgMode === 'code');
			}
			if (directSvgCodeEditor && directSvgCodeEditor.codemirror) {
				directSvgCodeEditor.codemirror.setOption('readOnly', !(isSvgLayer && selectedSvgMode === 'code'));
				directSvgCodeEditor.codemirror.refresh();
			}
			let directEditorTextValue = '';
			if (isSvgElementLayer) {
				directEditorTextValue = node.outerHTML || '';
			} else if (isSvgUrlLayer) {
				directEditorTextValue = typographyTarget.getAttribute('src') || '';
			} else if (slotKey) {
				const storedSlot = UichSHE.activeWidgetSettings.get(slotKey);
				let slotStr = storedSlot !== undefined && storedSlot !== null ? String(storedSlot) : '';
				if (slotStr === '\u200B') {
					slotStr = '';
				}
				directEditorTextValue = slotStr;
			} else {
				directEditorTextValue = node ? UichSHE.getSlotTextValue(node) : '';
			}
			setInputValuePreserveActiveTyping(directText, directEditorTextValue);
			setDirectTextInputPlaceholder(directText, !!String(directEditorTextValue || '').trim());
			directText.disabled = !canEditSelection || isDynamicText || isSvgLayer;
			if (directTextField) {
				directTextField.style.display = (canEditSelection && !isSvgLayer && !isImageLayer) ? '' : 'none';
			}
			if (directSvgActions) {
				directSvgActions.style.display = 'none';
			}
			if (directSvgUrl) {
				setInputValuePreserveActiveTyping(directSvgUrl, isSvgUrlLayer ? (typographyTarget.getAttribute('src') || '') : '');
				directSvgUrl.disabled = !isSvgLayer;
			}
			if (directSvgUrlApplyBtn) {
				directSvgUrlApplyBtn.disabled = true;
			}
			if (directSvgWordpressBtn) {
				directSvgWordpressBtn.disabled = true;
			}
			if (directLinkWrap) {
				directLinkWrap.style.display = isAnchor ? '' : 'none';
			}
			setInputValuePreserveActiveTyping(directUrl, isAnchor ? (currentLink.url || '') : '');
			directExternal.checked = isAnchor && currentLink.is_external === 'on';
			directNofollow.checked = isAnchor && currentLink.nofollow === 'on';
			setInputValuePreserveActiveTyping(directCustom, isAnchor ? (currentLink.custom_attributes || '') : '');
			directUrl.disabled = !isAnchor;
			directExternal.disabled = !isAnchor;
			directNofollow.disabled = !isAnchor;
			directCustom.disabled = !isAnchor;
			const getResolvedTypographyFieldValue = (property) => {
				const inlineValue = String(getInlineStyleValue(typographyTarget.style, property) || '').trim();
				const computedValue = String(resolvedSnapshot.styles[property] || '').trim();
				const hasDeclared = !!(resolvedSnapshot.declaredProperties && resolvedSnapshot.declaredProperties.has(property));
				const styleMapFromGlobals = mergedGlobalClassTypography && mergedGlobalClassTypography.styleMap
					? mergedGlobalClassTypography.styleMap
					: null;
				const fromGlobalClasses = styleMapFromGlobals ? String(styleMapFromGlobals[property] || '').trim() : '';
				const isGlobalVar = /^var\(\s*--e-global-typography-[^)]+\)$/i.test(inlineValue);
				if (isGlobalVar) {
					const sourceToken = String((mergedGlobalClassTypography.sourceByProperty && mergedGlobalClassTypography.sourceByProperty[property]) || '').toLowerCase();
					const sourcePreset = sourceToken ? getV3TypographyPresetByClassToken(sourceToken) : null;
					if (sourcePreset) {
						const sourceStyleMap = buildTypographyPresetStyleMap(sourcePreset);
						const sourceAuthoredValue = String(sourceStyleMap[property] || '').trim();
						if (sourceAuthoredValue) {
							return sourceAuthoredValue;
						}
					}
					return computedValue || inlineValue;
				}
				if (inlineValue) {
					return inlineValue;
				}
				if (hasDeclared) {
					return computedValue || '';
				}
				if (fromGlobalClasses) {
					return fromGlobalClasses;
				}
				return '';
			};
			const getGlobalSourceColor = (property) => {
				const sourceToken = String((mergedGlobalClassTypography.sourceByProperty && mergedGlobalClassTypography.sourceByProperty[property]) || '').toLowerCase();
				return sourceToken ? (globalClassColorMap[sourceToken] || '') : '';
			};

			const getDisplayValueForProperty = (property) => {
				if (isSelectedLocalClass && selectedLocalClassStyles) {
					return String(selectedLocalClassStyles[property] || '').trim();
				}
				if (isSelectedGlobalClass) {
					const inlineCurrent = String(getInlineStyleValue(typographyTarget.style, property) || '').trim();
					if (inlineCurrent && !/^var\(\s*--e-global-typography-[^)]+\)$/i.test(inlineCurrent)) {
						return inlineCurrent;
					}
					// Get the preset for the selected global class and extract the actual value
					const selectedPreset = getV3TypographyPresetByClassToken(selectedClassTokenLower);
					if (selectedPreset) {
						const presetStyleMap = buildTypographyPresetStyleMap(selectedPreset);
						const presetValue = String(presetStyleMap[property] || '').trim();
						if (presetValue) {
							return presetValue;
						}
					}
					return '';
				}
				return getResolvedTypographyFieldValue(property);
			};

			const getLayoutFieldRawValue = (property) => {
				if (!property) {
					return '';
				}
				if (isSelectedLocalClass && selectedLocalClassStyles) {
					return String(selectedLocalClassStyles[property] || '').trim();
				}
				const hasDeclaredValue = resolvedSnapshot.declaredProperties && resolvedSnapshot.declaredProperties.has(property);
				if (!canEditLayout || !hasDeclaredValue) {
					return '';
				}
				return String(getInlineStyleValue(typographyTarget.style, property) || resolvedSnapshot.styles[property] || '').trim();
			};

			const fontSizeVal = canEditTypography ? getDisplayValueForProperty('font-size') : '';
			setInputValuePreserveActiveTyping(directFontSize, fontSizeVal);
			setDirectTextInputPlaceholder(directFontSize, !!String(fontSizeVal || '').trim());
			const fontFamilyVal = canEditTypography ? getDisplayValueForProperty('font-family') : '';
			setInputValuePreserveActiveTyping(directFontFamily, fontFamilyVal);
			setDirectTextInputPlaceholder(directFontFamily, !!String(fontFamilyVal || '').trim());
			setInputValuePreserveActiveTyping(directFontWeight, canEditTypography ? getDisplayValueForProperty('font-weight') : '');
			const lineHeightVal = canEditTypography ? getDisplayValueForProperty('line-height') : '';
			setInputValuePreserveActiveTyping(directLineHeight, lineHeightVal);
			setDirectTextInputPlaceholder(directLineHeight, !!String(lineHeightVal || '').trim());
			setInputValuePreserveActiveTyping(directTextAlign, canEditTypography ? getDisplayValueForProperty('text-align') : '');
			setInputValuePreserveActiveTyping(directFontStyle, canEditTypography ? getDisplayValueForProperty('font-style') : '');
			const letterSpacingVal = canEditTypography ? getDisplayValueForProperty('letter-spacing') : '';
			setInputValuePreserveActiveTyping(directLetterSpacing, letterSpacingVal);
			setDirectTextInputPlaceholder(directLetterSpacing, !!String(letterSpacingVal || '').trim());
			setInputValuePreserveActiveTyping(directTextTransform, canEditTypography ? getDisplayValueForProperty('text-transform') : '');
			setInputValuePreserveActiveTyping(directTextDecoration, canEditTypography ? getDisplayValueForProperty('text-decoration') : '');
			// Check for var() reference in inline style first (preserves global color info)
			const inlineTextColor = String(getInlineStyleValue(typographyTarget.style, 'color') || '').trim();
			let textColorGlobalId = parseGlobalColorVarId(inlineTextColor);
			const displayTextColorValue = canEditTypography ? getDisplayValueForProperty('color') : '';
			if (!textColorGlobalId) {
				textColorGlobalId = parseGlobalColorVarId(displayTextColorValue);
			}
			// Reverse-lookup: resolved HEX/rgb/keyword values that match a known global color's value
			// should still display the global's title (the global IS being used, just stored as a literal).
			if (!textColorGlobalId) {
				ensureDirectEditorV3ColorCache();
				const valueForLookup = displayTextColorValue || inlineTextColor;
				textColorGlobalId = findGlobalColorIdByValue(valueForLookup) || '';
			}
			if (textColorGlobalId) {
				ensureDirectEditorV3ColorCache();
				const isAtomicColor = textColorGlobalId.indexOf('atomic:') === 0;
				const atomicVarName = isAtomicColor ? textColorGlobalId.slice(7) : '';
				const v3Id = textColorGlobalId.indexOf('v3:') === 0 ? textColorGlobalId.slice(3) : textColorGlobalId;
				const colorItem = isAtomicColor ? (directAtomicColorByVarName[atomicVarName] || null) : (directEditorV3ColorById[v3Id] || null);
				setInputValuePreserveActiveTyping(directTextColor, colorItem ? (colorItem.title || colorItem.label) : (v3Id || atomicVarName));
				if (directTextColor && directTextColor.dataset) {
					directTextColor.dataset.ucGlobalColorId = textColorGlobalId;
					directTextColor.dataset.ucGlobalColorVar = isAtomicColor ? `var(${atomicVarName})` : `var(--e-global-color-${v3Id})`;
					directTextColor.dataset.ucGlobalColorName = colorItem ? (colorItem.title || colorItem.label) : (v3Id || atomicVarName);
				}
				assignDirectColorPickerValue(directTextColorPicker, colorStringToPickerHex(colorItem ? colorItem.value : ''));
			} else {
				setInputValuePreserveActiveTyping(directTextColor, displayTextColorValue);
				assignDirectColorPickerValue(directTextColorPicker, canEditTypography ? colorStringToPickerHex(directTextColor.value) : '#000000');
				if (directTextColor && directTextColor.dataset) {
					delete directTextColor.dataset.ucGlobalColorId;
					delete directTextColor.dataset.ucGlobalColorVar;
					delete directTextColor.dataset.ucGlobalColorName;
				}
			}
			setDirectTextInputPlaceholder(directTextColor, !!(directTextColor && String(directTextColor.value || '').trim()));
			if (directFontSize && directFontSize.dataset && document.activeElement !== directFontSize) directFontSize.dataset.ucDisplayValue = String(directFontSize.value || '');
			if (directFontFamily && directFontFamily.dataset && document.activeElement !== directFontFamily) directFontFamily.dataset.ucDisplayValue = String(directFontFamily.value || '');
			if (directFontWeight && directFontWeight.dataset && document.activeElement !== directFontWeight) directFontWeight.dataset.ucDisplayValue = String(directFontWeight.value || '');
			if (directLineHeight && directLineHeight.dataset && document.activeElement !== directLineHeight) directLineHeight.dataset.ucDisplayValue = String(directLineHeight.value || '');
			if (directTextAlign && directTextAlign.dataset && document.activeElement !== directTextAlign) directTextAlign.dataset.ucDisplayValue = String(directTextAlign.value || '');
			if (directFontStyle && directFontStyle.dataset && document.activeElement !== directFontStyle) directFontStyle.dataset.ucDisplayValue = String(directFontStyle.value || '');
			if (directLetterSpacing && directLetterSpacing.dataset && document.activeElement !== directLetterSpacing) directLetterSpacing.dataset.ucDisplayValue = String(directLetterSpacing.value || '');
			if (directTextTransform && directTextTransform.dataset && document.activeElement !== directTextTransform) directTextTransform.dataset.ucDisplayValue = String(directTextTransform.value || '');
			if (directTextDecoration && directTextDecoration.dataset && document.activeElement !== directTextDecoration) directTextDecoration.dataset.ucDisplayValue = String(directTextDecoration.value || '');
			if (directTextColor && directTextColor.dataset && document.activeElement !== directTextColor) directTextColor.dataset.ucDisplayValue = String(directTextColor.value || '');
			syncDirectGlobalColorChip('text', parseGlobalColorVarId(directTextColor.value));
			const getIndicatorColor = (property) => {
				if (!canEditTypography) return '';
				if (isSelectedGlobalClass) {
					const inlineCurrent = String(getInlineStyleValue(typographyTarget.style, property) || '').trim();
					if (inlineCurrent && !/^var\(\s*--e-global-typography-[^)]+\)$/i.test(inlineCurrent)) {
						return '';
					}
					// Check if the selected global class has this property
					const selectedPreset = getV3TypographyPresetByClassToken(selectedClassTokenLower);
					const hasProp = selectedPreset ? (String((buildTypographyPresetStyleMap(selectedPreset)[property]) || '').trim() !== '') : false;
					return hasProp ? (globalClassColorMap[selectedClassTokenLower] || '#7dd3fc') : '';
				}
				if (isSelectedLocalClass) return '';
				const inlineCurrent = String(getInlineStyleValue(typographyTarget.style, property) || '').trim();
				if (!inlineCurrent) {
					return '';
				}
				if (!/^var\(\s*--e-global-typography-[^)]+\)$/i.test(inlineCurrent)) {
					return '';
				}
				return getGlobalSourceColor(property);
			};
			setDirectFieldGlobalIndicator(directFontSize, getIndicatorColor('font-size'));
			setDirectFieldGlobalIndicator(directFontFamily, getIndicatorColor('font-family'));
			setDirectFieldGlobalIndicator(directFontWeight, getIndicatorColor('font-weight'));
			setDirectFieldGlobalIndicator(directLineHeight, getIndicatorColor('line-height'));
			setDirectFieldGlobalIndicator(directFontStyle, getIndicatorColor('font-style'));
			setDirectFieldGlobalIndicator(directLetterSpacing, getIndicatorColor('letter-spacing'));
			setDirectFieldGlobalIndicator(directTextTransform, getIndicatorColor('text-transform'));
			setDirectFieldGlobalIndicator(directTextDecoration, getIndicatorColor('text-decoration'));
			layoutStyleFields.forEach((field) => {
				const property = field.getAttribute('data-layout-style');
				if (!property) {
					return;
				}
				const rawVal = getLayoutFieldRawValue(property);
				field.value = rawVal;
				if (field.dataset) {
					field.dataset.ucDisplayValue = String(field.value || '');
				}
				setDirectTextInputPlaceholder(field, !!String(rawVal || '').trim());
			});

			sidesFields.forEach(field => {
				const property = field.getAttribute('data-sides-type');
				const rawValue = getLayoutFieldRawValue(property);
				const parsed = parseDimensionValue(rawValue);
				const sidesHaveValue = !!String(rawValue || '').trim();

				const unitSelect = field.querySelector('.uichemy-composer-sides-unit');
				if (unitSelect) {
					unitSelect.value = parsed.unit;
					if (unitSelect.dataset) unitSelect.dataset.ucDisplayValue = parsed.unit;
				}

				const inputs = Array.from(field.querySelectorAll('.uichemy-composer-side-input'));
				inputs.forEach(input => {
					const side = input.getAttribute('data-side');
					input.value = parsed[side] || '';
					if (input.dataset) {
						input.dataset.ucDisplayValue = String(input.value || '');
					}
					setDirectTextInputPlaceholder(input, sidesHaveValue);
				});

				const linkBtn = field.querySelector('.uichemy-composer-sides-link-btn');
				if (linkBtn) {
					const isLinked = (parsed.top === parsed.right && parsed.top === parsed.bottom && parsed.top === parsed.left && parsed.top !== '');
					if (isLinked || rawValue === '') {
						linkBtn.classList.add('is-active');
					} else {
						linkBtn.classList.remove('is-active');
					}
				}
				// Save initial state for change detection
				if (field.dataset) {
					field.dataset.ucDisplayValue = rawValue;
				}
			});
			const bgFromClassOnly = isSelectedLocalClass && selectedLocalClassStyles
				? String(selectedLocalClassStyles['background-color'] || '').trim()
				: '';
			const hasBgDeclared = resolvedSnapshot.declaredProperties && resolvedSnapshot.declaredProperties.has('background-color');
			const hasBgColor = !!(canEditLayout && (bgFromClassOnly || hasBgDeclared));
			const inlineBgColor = canEditLayout && hasBgColor ? getInlineStyleValue(typographyTarget.style, 'background-color') : '';
			let bgGlobalId = parseGlobalColorVarId(inlineBgColor);
			const bgRawValue = canEditLayout && hasBgColor
				? (inlineBgColor || bgFromClassOnly || (hasBgDeclared ? String(resolvedSnapshot.styles['background-color'] || '').trim() : ''))
				: '';
			if (!bgGlobalId) {
				bgGlobalId = parseGlobalColorVarId(bgRawValue);
			}
			if (!bgGlobalId && bgRawValue) {
				ensureDirectEditorV3ColorCache();
				bgGlobalId = findGlobalColorIdByValue(bgRawValue) || '';
			}
			if (bgGlobalId) {
				ensureDirectEditorV3ColorCache();
				const isAtomicColor = bgGlobalId.indexOf('atomic:') === 0;
				const atomicVarName = isAtomicColor ? bgGlobalId.slice(7) : '';
				const v3Id = bgGlobalId.indexOf('v3:') === 0 ? bgGlobalId.slice(3) : bgGlobalId;
				const bgItem = isAtomicColor ? (directAtomicColorByVarName[atomicVarName] || null) : (directEditorV3ColorById[v3Id] || null);
				directLayoutBgColor.value = bgItem ? (bgItem.title || bgItem.label) : (v3Id || atomicVarName);
				if (directLayoutBgColor.dataset) {
					directLayoutBgColor.dataset.ucGlobalColorId = bgGlobalId;
					directLayoutBgColor.dataset.ucGlobalColorVar = isAtomicColor ? `var(${atomicVarName})` : `var(--e-global-color-${v3Id})`;
					directLayoutBgColor.dataset.ucGlobalColorName = bgItem ? (bgItem.title || bgItem.label) : (v3Id || atomicVarName);
				}
				assignDirectColorPickerValue(directLayoutBgColorPicker, colorStringToPickerHex(bgItem ? bgItem.value : ''));
			} else {
				directLayoutBgColor.value = bgRawValue;
				assignDirectColorPickerValue(directLayoutBgColorPicker, canEditLayout && hasBgColor ? colorStringToPickerHex(directLayoutBgColor.value) : '#000000');
				if (directLayoutBgColor.dataset) {
					delete directLayoutBgColor.dataset.ucGlobalColorId;
					delete directLayoutBgColor.dataset.ucGlobalColorVar;
					delete directLayoutBgColor.dataset.ucGlobalColorName;
				}
			}
			if (directLayoutBgColor && directLayoutBgColor.dataset) {
				directLayoutBgColor.dataset.ucDisplayValue = String(directLayoutBgColor.value || '');
			}
			setDirectTextInputPlaceholder(directLayoutBgColor, !!(directLayoutBgColor && String(directLayoutBgColor.value || '').trim()));
			syncDirectGlobalColorChip('background', parseGlobalColorVarId(directLayoutBgColor.value));

			const borderFromClassOnly = isSelectedLocalClass && selectedLocalClassStyles
				? String(selectedLocalClassStyles['border-color'] || '').trim()
				: '';
			const hasBorderDeclared = resolvedSnapshot.declaredProperties && resolvedSnapshot.declaredProperties.has('border-color');
			const hasBorderColor = !!(canEditLayout && (borderFromClassOnly || hasBorderDeclared));
			const inlineBorderColor = canEditLayout && hasBorderColor ? getInlineStyleValue(typographyTarget.style, 'border-color') : '';
			let borderGlobalId = parseGlobalColorVarId(inlineBorderColor);
			const borderColorRawValue = canEditLayout && hasBorderColor
				? (inlineBorderColor || borderFromClassOnly || (hasBorderDeclared ? String(resolvedSnapshot.styles['border-color'] || '').trim() : ''))
				: '';
			if (!borderGlobalId) {
				borderGlobalId = parseGlobalColorVarId(borderColorRawValue);
			}
			if (!borderGlobalId && borderColorRawValue) {
				ensureDirectEditorV3ColorCache();
				borderGlobalId = findGlobalColorIdByValue(borderColorRawValue) || '';
			}
			if (borderGlobalId && directLayoutBorderColor) {
				ensureDirectEditorV3ColorCache();
				const isAtomicColor = borderGlobalId.indexOf('atomic:') === 0;
				const atomicVarName = isAtomicColor ? borderGlobalId.slice(7) : '';
				const v3Id = borderGlobalId.indexOf('v3:') === 0 ? borderGlobalId.slice(3) : borderGlobalId;
				const borderItem = isAtomicColor ? (directAtomicColorByVarName[atomicVarName] || null) : (directEditorV3ColorById[v3Id] || null);
				directLayoutBorderColor.value = borderItem ? (borderItem.title || borderItem.label) : (v3Id || atomicVarName);
				if (directLayoutBorderColor.dataset) {
					directLayoutBorderColor.dataset.ucGlobalColorId = borderGlobalId;
					directLayoutBorderColor.dataset.ucGlobalColorVar = isAtomicColor ? `var(${atomicVarName})` : `var(--e-global-color-${v3Id})`;
					directLayoutBorderColor.dataset.ucGlobalColorName = borderItem ? (borderItem.title || borderItem.label) : (v3Id || atomicVarName);
				}
				if (directLayoutBorderColorPicker) assignDirectColorPickerValue(directLayoutBorderColorPicker, colorStringToPickerHex(borderItem ? borderItem.value : ''));
			} else if (directLayoutBorderColor) {
				directLayoutBorderColor.value = borderColorRawValue;
				if (directLayoutBorderColorPicker) assignDirectColorPickerValue(directLayoutBorderColorPicker, canEditLayout && hasBorderColor ? colorStringToPickerHex(directLayoutBorderColor.value) : '#000000');
				if (directLayoutBorderColor.dataset) {
					delete directLayoutBorderColor.dataset.ucGlobalColorId;
					delete directLayoutBorderColor.dataset.ucGlobalColorVar;
					delete directLayoutBorderColor.dataset.ucGlobalColorName;
				}
			}
			if (directLayoutBorderColor && directLayoutBorderColor.dataset) {
				directLayoutBorderColor.dataset.ucDisplayValue = String(directLayoutBorderColor.value || '');
			}
			setDirectTextInputPlaceholder(directLayoutBorderColor, !!(directLayoutBorderColor && String(directLayoutBorderColor.value || '').trim()));
			syncDirectGlobalColorChip('border', parseGlobalColorVarId(directLayoutBorderColor ? directLayoutBorderColor.value : ''));

			const activeDisplay = canEditLayout ? (directLayoutDisplay.value || resolvedSnapshot.styles.display || '') : '';
			const activePosition = canEditLayout ? (directLayoutPosition.value || resolvedSnapshot.styles.position || '') : '';
			setLayoutControlVisibility({
				display: activeDisplay,
				position: activePosition,
				canEditLayout,
				readOnlyByBreakpoint: isSelectedChipReadOnly
			});
			const typographyLockedByClassSelection = isSelectedGlobalClass || isSelectedChipReadOnly;
			directFontSize.disabled = !canEditTypography || typographyLockedByClassSelection;
			directFontFamily.disabled = !canEditTypography || typographyLockedByClassSelection;
			directFontWeight.disabled = !canEditTypography || typographyLockedByClassSelection;
			directLineHeight.disabled = !canEditTypography || typographyLockedByClassSelection;
			directTextAlign.disabled = !canEditTypography || typographyLockedByClassSelection;
			directFontStyle.disabled = !canEditTypography || typographyLockedByClassSelection;
			directLetterSpacing.disabled = !canEditTypography || typographyLockedByClassSelection;
			directTextTransform.disabled = !canEditTypography || typographyLockedByClassSelection;
			directTextDecoration.disabled = !canEditTypography || typographyLockedByClassSelection;
			directTextColor.disabled = !canEditTypography || typographyLockedByClassSelection;
			directTextColorPicker.disabled = !canEditTypography || typographyLockedByClassSelection;
			directLayoutBgColorPicker.disabled = directLayoutBgColor.disabled;
			if (directTextColorGlobalBtn) {
				directTextColorGlobalBtn.disabled = false;
			}
			if (directLayoutBgColorGlobalBtn) {
				directLayoutBgColorGlobalBtn.disabled = false;
			}
			if (directLayoutBorderColorGlobalBtn) {
				directLayoutBorderColorGlobalBtn.disabled = false;
			}
			if (directLayoutBorderColorPicker) {
				directLayoutBorderColorPicker.disabled = !canEditLayout;
			}
			if (directTypographySection) {
				directTypographySection.style.display = canEditTypography ? '' : 'none';
			}
			if (directLayoutSection) {
				directLayoutSection.style.display = canEditLayout ? '' : 'none';
			}
			directReset.disabled = !(canEditSelection || canEditLayout);
			directStatus.textContent = node ? '' : 'This layer is for structure only. Choose a slot-backed layer to edit values.';
			UichSHE.setUiChemyComposerPreviewSelectionPath(activeLayer && activeLayer.path ? activeLayer.path : '');

			/*
			 * Per-field "Style origin" indicator: when no chip is selected and a value comes from a
			 * class rule (not an inline override on this element), show a colored dot next to the field.
			 * Click the dot to open a popover listing every class contributor (with strike-through on
			 * overridden values) so the user can see exactly WHICH class wins for that property.
			 */
			const fieldHasInlineDeclaration = (property) => {
				if (!typographyTarget || !typographyTarget.style) return false;
				return !!String(typographyTarget.style.getPropertyValue(property) || '').trim();
			};
			const resolveSourceClassForField = (property) => {
				if (!property) return '';
				if (isSelectedLocalClass || isSelectedGlobalClass) return '';
				if (fieldHasInlineDeclaration(property)) return '';
				return String(classPropertySourceMap.sourceByProperty[property] || '');
			};
			const applyOriginIndicatorForField = (field, property) => {
				if (!field) return;
				const sourceToken = resolveSourceClassForField(property);
				if (!sourceToken) {
					setDirectFieldOriginDot(field, '', '', property, []);
					return;
				}
				const entries = collectStyleOriginsForProperty(
					rawCssCombined,
					appliedClassTokens,
					property,
					activeBpKeyForOrigin
				);
				const color = allClassColorMap[sourceToken] || '#7dd3fc';
				setDirectFieldOriginDot(field, sourceToken, color, property, entries);
			};
			const typographyFieldByProperty = {
				'font-size': directFontSize,
				'font-family': directFontFamily,
				'font-weight': directFontWeight,
				'line-height': directLineHeight,
				'text-align': directTextAlign,
				'font-style': directFontStyle,
				'letter-spacing': directLetterSpacing,
				'text-transform': directTextTransform,
				'text-decoration': directTextDecoration,
				'color': directTextColor,
			};
			Object.keys(typographyFieldByProperty).forEach((property) => {
				applyOriginIndicatorForField(typographyFieldByProperty[property], property);
			});
			layoutStyleFields.forEach((field) => {
				const property = field.getAttribute('data-layout-style');
				if (!property) return;
				if (property === 'background-color' || property === 'border-color') return;
				applyOriginIndicatorForField(field, property);
			});
			sidesFields.forEach((field) => {
				const property = field.getAttribute('data-sides-type');
				const sourceToken = resolveSourceClassForField(property);
				if (!sourceToken) {
					setDirectSidesOriginDot(field, '', '', property, []);
					return;
				}
				const entries = collectStyleOriginsForProperty(
					rawCssCombined,
					appliedClassTokens,
					property,
					activeBpKeyForOrigin
				);
				const color = allClassColorMap[sourceToken] || '#7dd3fc';
				setDirectSidesOriginDot(field, sourceToken, color, property, entries);
			});
			if (directLayoutBgColor) {
				applyOriginIndicatorForField(directLayoutBgColor, 'background-color');
			}
			if (directLayoutBorderColor) {
				applyOriginIndicatorForField(directLayoutBorderColor, 'border-color');
			}

			/*
			 * Chip-selected responsive fallback: when a class chip is selected and the active
			 * breakpoint has no rule for a property, walk the inheritance chain (mobile → tablet →
			 * desktop) and surface the first matching value as a PLACEHOLDER. The user sees the
			 * "currently applied" cascade value greyed out, so they can decide whether to author a
			 * breakpoint-specific override or leave the inherited value in place.
			 */
			if (isSelectedLocalClass && selectedClassTokenLower) {
				const activeBpKeyForFallback = directCurrentElementorBreakpoint || getElementorCurrentDeviceMode() || 'desktop';
				const fallbackChainForChip = buildResponsiveFallbackChainForBreakpoint(activeBpKeyForFallback);
				// Index 0 in the chain IS the active breakpoint — already covered by selectedLocalClassStyles.
				// Walk indices 1+ for the inherited fallback.
				const lookupChipFallbackValue = (property) => {
					for (let i = 1; i < fallbackChainForChip.length; i++) {
						const bpKey = fallbackChainForChip[i];
						const mediaText = bpKey ? getMediaTextForElementorBreakpointKey(bpKey) : '';
						const styleMap = getLocalClassTypographyStyleMap(
							rawCssCombined,
							selectedClassTokenLower,
							selectedPreferredSelector,
							mediaText
						);
						const v = String(styleMap[property] || '').trim();
						if (v) {
							return v;
						}
					}
					return '';
				};
				const setChipFallbackForField = (field, property) => {
					if (!field || !property) return;
					if (document.activeElement === field) return;
					if (String(field.value || '').trim()) return;
					const fallbackVal = lookupChipFallbackValue(property);
					if (!fallbackVal) return;
					ensureDirectPlaceholderCached(field);
					field.placeholder = fallbackVal;
				};
				Object.keys(typographyFieldByProperty).forEach((property) => {
					setChipFallbackForField(typographyFieldByProperty[property], property);
				});
				layoutStyleFields.forEach((field) => {
					const property = field.getAttribute('data-layout-style');
					if (!property) return;
					if (property === 'background-color' || property === 'border-color') return;
					setChipFallbackForField(field, property);
				});
				sidesFields.forEach((field) => {
					const property = field.getAttribute('data-sides-type');
					if (!property) return;
					const inputs = Array.from(field.querySelectorAll('.uichemy-composer-side-input'));
					// If any side already has an explicit value at the active bp, leave the field alone.
					if (inputs.some((input) => String(input.value || '').trim())) return;
					const fallbackVal = lookupChipFallbackValue(property);
					if (!fallbackVal) return;
					const parsedFallback = parseDimensionValue(fallbackVal);
					inputs.forEach((input) => {
						if (document.activeElement === input) return;
						const side = input.getAttribute('data-side');
						ensureDirectPlaceholderCached(input);
						input.placeholder = String(parsedFallback[side] || '');
					});
					const unitSelect = field.querySelector('.uichemy-composer-sides-unit');
					if (unitSelect && parsedFallback.unit && !String(unitSelect.dataset.ucDisplayValue || '').trim()) {
						unitSelect.value = parsedFallback.unit;
					}
				});
				if (directLayoutBgColor) {
					setChipFallbackForField(directLayoutBgColor, 'background-color');
				}
				if (directLayoutBorderColor) {
					setChipFallbackForField(directLayoutBorderColor, 'border-color');
				}
			}

			isDirectSyncing = false;
		}

		function commitDirectText() {
			if (isDirectSyncing) return;
			if (!UichSHE.activeWidgetSettings) return;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return;

			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const activeSlotIndex = activeLayer && typeof activeLayer.slotIndex === 'number' ? activeLayer.slotIndex : null;
			const canUseLayerNodeForTextEdit = !!(
				layerNode
				&& layerNode.nodeType === Node.ELEMENT_NODE
				&& !UichSHE.isDirectTextDisallowedElement(layerNode)
				&& !Array.from(layerNode.childNodes || []).some((child) => child.nodeType === Node.ELEMENT_NODE && !UichSHE.isLayerSkippedElement(child))
			);
			const node = canUseLayerNodeForTextEdit
				? layerNode
				: (typeof activeSlotIndex === 'number' ? nodes[activeSlotIndex] : null);
			if (!node) return;
			const isElementLayerTextEdit = !!canUseLayerNodeForTextEdit;

			if (UichSHE.getTagNameUpper(node) === 'SVG') {
				const svgMarkup = String(directText.value || '').trim();
				if (!svgMarkup) {
					if (directStatus) {
						directStatus.textContent = 'Inline SVG code cannot be empty.';
					}
					return;
				}
				const parsedWrap = document.createElement('div');
				parsedWrap.innerHTML = svgMarkup;
				const nextSvg = parsedWrap.querySelector('svg');
				if (!nextSvg) {
					if (directStatus) {
						directStatus.textContent = 'Please provide valid inline SVG code starting with <svg>.';
					}
					return;
				}
				node.replaceWith(nextSvg.cloneNode(true));
				const nextHtml = doc.innerHTML;
				UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
				markEditorDirty();
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
					if (input.length && input.val() !== nextHtml) {
						input.val(nextHtml).trigger('input').trigger('change');
					}
				}
				syncDirectInputsFromSelection();
				return;
			}

			if (UichSHE.getTagNameUpper(node) === 'IMG' && UichSHE.isSvgUrlValue(node.getAttribute('src') || '')) {
				const nextSvgUrl = String(directText.value || '').trim();
				if (nextSvgUrl) {
					node.setAttribute('src', nextSvgUrl);
				} else {
					node.removeAttribute('src');
				}
				const nextHtml = doc.innerHTML;
				UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
				markEditorDirty();
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
					if (input.length && input.val() !== nextHtml) {
						input.val(nextHtml).trigger('input').trigger('change');
					}
				}
				syncDirectInputsFromSelection();
				return;
			}

			const slotKey = (!isElementLayerTextEdit && typeof activeSlotIndex === 'number') ? `slot_${activeSlotIndex}` : '';
			const dynamics = UichSHE.activeWidgetSettings.get('__dynamic__') || {};
			if (slotKey && dynamics[slotKey] && dynamics[slotKey] !== '') return;

			let nextValue = directText.value;
			if (nextValue.trim() === '' && node.nodeType === Node.TEXT_NODE) {
				nextValue = '\u200B';
			}

			if (node.nodeType === Node.TEXT_NODE) {
				node.nodeValue = nextValue;
			} else {
				node.textContent = nextValue;
			}

			const nextHtml = doc.innerHTML;
			markRawHtmlChanged(nextHtml);
			if (slotKey) {
				UichSHE.activeWidgetSettings.set(slotKey, nextValue);
			}
			syncDirectInputsFromSelection();
		}

		function commitDirectLink() {
			if (isDirectSyncing) return;
			if (!UichSHE.activeWidgetSettings) return;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return;

			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const activeSlotIndex = activeLayer && typeof activeLayer.slotIndex === 'number' ? activeLayer.slotIndex : selectedSlotIndex;
			const slotNode = typeof activeSlotIndex === 'number' ? nodes[activeSlotIndex] : null;
			const node = (layerNode && layerNode.nodeType === Node.ELEMENT_NODE && layerNode.tagName === 'A')
				? layerNode
				: slotNode;
			if (!node || node.nodeType !== Node.ELEMENT_NODE || node.tagName !== 'A') return;
			if (typeof activeSlotIndex !== 'number' || activeSlotIndex < 0) return;

			const linkKey = `slot_${activeSlotIndex}_link`;
			const dynamics = UichSHE.activeWidgetSettings.get('__dynamic__') || {};
			if (dynamics[linkKey] && dynamics[linkKey] !== '') return;

			const nextLink = {
				url: directUrl.value.trim(),
				is_external: directExternal.checked ? 'on' : '',
				nofollow: directNofollow.checked ? 'on' : '',
				custom_attributes: String(directCustom.value || '').trim()
			};

			UichSHE.activeWidgetSettings.set(linkKey, nextLink);
			markEditorDirty();
			if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
				const controlWrap = UichSHE.activePanelView.$el.find(`.elementor-control-${linkKey}`);
				if (controlWrap.length) {
					const urlInput = controlWrap.find('[data-setting="url"]');
					if (urlInput.length) {
						urlInput.val(nextLink.url).trigger('input').trigger('change');
					}
					const externalInput = controlWrap.find('[data-setting="is_external"]');
					if (externalInput.length) {
						externalInput.prop('checked', nextLink.is_external === 'on').trigger('change');
					}
					const nofollowInput = controlWrap.find('[data-setting="nofollow"]');
					if (nofollowInput.length) {
						nofollowInput.prop('checked', nextLink.nofollow === 'on').trigger('change');
					}
					const customInput = controlWrap.find('[data-setting="custom_attributes"]');
					if (customInput.length) {
						customInput.val(nextLink.custom_attributes).trigger('input').trigger('change');
					}
				}
			}
		}

		function commitDirectTypography() {
			if (isDirectSyncing) return;
			if (!UichSHE.activeWidgetSettings) return;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return;

			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const node = layerNode || nodes[selectedSlotIndex];
			const activeSlotIndex = activeLayer && typeof activeLayer.slotIndex === 'number' ? activeLayer.slotIndex : null;
			const typographyTarget = getTypographyTargetNode(node);
			if (!typographyTarget) return;
			const canEditTypography = !!(typographyTarget
				&& !(typographyTarget.nodeType === Node.ELEMENT_NODE && typographyTarget.tagName === 'IMG'));
			const appliedClassTokens = parseClassNameString(getDomElementClassString(typographyTarget));
			const selectedTokenLower = String(selectedAppliedClassToken || '').toLowerCase();
			const isSelectedGlobalClass = !!(selectedTokenLower && getV3TypographyPresetByClassToken(selectedTokenLower));
			const isSelectedContextualClass = !!(selectedTokenLower && directContextualClassEntries.some((e) => String(e.token || '').toLowerCase() === selectedTokenLower));
			const isSelectedMediaClass = !!(selectedTokenLower && directMediaClassEntries.some((e) => String(e.token || '').toLowerCase() === selectedTokenLower));
			const isSelectedLocalClass = !!(selectedTokenLower && !isSelectedGlobalClass && (
				appliedClassTokens.some((t) => String(t).toLowerCase() === selectedTokenLower) || isSelectedContextualClass || isSelectedMediaClass
			));
			const computedTypography = typographyTarget && typographyTarget.nodeType === Node.ELEMENT_NODE
				? window.getComputedStyle(typographyTarget)
				: null;
			const typographyFieldByProperty = {
				'font-size': directFontSize,
				'font-family': directFontFamily,
				'font-weight': directFontWeight,
				'line-height': directLineHeight,
				'font-style': directFontStyle,
				'letter-spacing': directLetterSpacing,
				'text-transform': directTextTransform,
				'text-decoration': directTextDecoration,
			};
			const preserveGlobalVarIfUnchanged = (property, uiValue) => {
				const enteredValue = String(uiValue || '').trim();
				const existingInline = String(typographyTarget.style.getPropertyValue(property) || '').trim();
				const isGlobalVar = /^var\(\s*--e-global-typography-[^)]+\)$/i.test(existingInline);
				if (!isGlobalVar) {
					return enteredValue;
				}
				const fieldEl = typographyFieldByProperty[property];
				const baselineDisplayValue = fieldEl && fieldEl.dataset ? String(fieldEl.dataset.ucDisplayValue || '').trim() : '';
				if (baselineDisplayValue !== '' && enteredValue === baselineDisplayValue) {
					return existingInline;
				}
				const resolvedValue = computedTypography ? String(computedTypography.getPropertyValue(property) || '').trim() : '';
				if (enteredValue && resolvedValue && enteredValue === resolvedValue) {
					return existingInline;
				}
				return enteredValue;
			};
			const fieldIsChanged = (fieldEl) => {
				if (!fieldEl) {
					return false;
				}
				const current = String(fieldEl.value || '').trim();
				const baseline = fieldEl.dataset ? String(fieldEl.dataset.ucDisplayValue || '').trim() : '';
				return current !== baseline;
			};
			const buildTypographyUpdate = (property, fieldEl, preserveGlobalVar) => {
				if (!fieldIsChanged(fieldEl)) {
					return null;
				}
				const rawValue = fieldEl ? fieldEl.value : '';
				let nextValue = preserveGlobalVar ? preserveGlobalVarIfUnchanged(property, rawValue) : String(rawValue || '').trim();
				if ((property === 'color' || property === 'background-color') && fieldEl && fieldEl.dataset && fieldEl.dataset.ucGlobalColorVar) {
					nextValue = String(fieldEl.dataset.ucGlobalColorVar || '').trim() || nextValue;
				}
				return [property, nextValue];
			};

			const typographyUpdates = [];
			if (canEditTypography) {
				[
					buildTypographyUpdate('font-size', directFontSize, true),
					buildTypographyUpdate('font-family', directFontFamily, true),
					buildTypographyUpdate('font-weight', directFontWeight, true),
					buildTypographyUpdate('line-height', directLineHeight, true),
					buildTypographyUpdate('text-align', directTextAlign, false),
					buildTypographyUpdate('font-style', directFontStyle, true),
					buildTypographyUpdate('letter-spacing', directLetterSpacing, true),
					buildTypographyUpdate('text-transform', directTextTransform, true),
					buildTypographyUpdate('text-decoration', directTextDecoration, true),
					buildTypographyUpdate('color', directTextColor, false),
				].forEach((entry) => {
					if (entry) {
						typographyUpdates.push(entry);
					}
				});
			}
			const layoutUpdates = layoutStyleFields
				.filter((field) => !field.disabled)
				.map((field) => {
					const property = field.getAttribute('data-layout-style');
					const current = String(field.value || '').trim();
					const baseline = field.dataset ? String(field.dataset.ucDisplayValue || '').trim() : '';
					if (current === baseline) {
						return null;
					}
					if ((property === 'background-color' || property === 'border-color') && field.dataset && field.dataset.ucGlobalColorVar) {
						return [property, field.dataset.ucGlobalColorVar];
					}
					return [property, field.value || ''];
				})
				.filter(Boolean);

			sidesFields.forEach(field => {
				const property = field.getAttribute('data-sides-type');
				const inputs = Array.from(field.querySelectorAll('.uichemy-composer-side-input'));
				let isChanged = false;
				const currentValues = {};
				inputs.forEach(input => {
					const side = input.getAttribute('data-side');
					currentValues[side] = input.value;
					const baseline = input.dataset ? String(input.dataset.ucDisplayValue || '').trim() : '';
					if (input.value !== baseline) {
						isChanged = true;
					}
				});
				const unitSelect = field.querySelector('.uichemy-composer-sides-unit');
				const currentUnit = unitSelect ? unitSelect.value : 'px';

				const baselineUnit = unitSelect && unitSelect.dataset ? String(unitSelect.dataset.ucDisplayValue || 'px').trim() : 'px';
				if (currentUnit !== baselineUnit) isChanged = true;

				if (isChanged) {
					const linkBtn = field.querySelector('.uichemy-composer-sides-link-btn');
					const isLinked = linkBtn && linkBtn.classList.contains('is-active');
					const newValue = buildDimensionValue(
						currentValues.top,
						currentValues.right,
						currentValues.bottom,
						currentValues.left,
						currentUnit,
						isLinked
					);
					layoutUpdates.push([property, newValue]);
					// Update baselines immediately to prevent double-commits
					inputs.forEach(input => { if (input.dataset) input.dataset.ucDisplayValue = input.value; });
					if (unitSelect && unitSelect.dataset) unitSelect.dataset.ucDisplayValue = currentUnit;
					if (field.dataset) field.dataset.ucDisplayValue = newValue;
				}
			});

			const borderWidthUpdateEntry = layoutUpdates.find(([p]) => p === 'border-width');
			const alreadyHasBorderStyleUpdate = layoutUpdates.some(([p]) => p === 'border-style');
			if (borderWidthUpdateEntry && !alreadyHasBorderStyleUpdate && directBorderWidthCssShowsStroke(borderWidthUpdateEntry[1])) {
				const bsUi = directLayoutBorderStyle ? String(directLayoutBorderStyle.value || '').trim() : '';
				if (!bsUi) {
					layoutUpdates.push(['border-style', 'solid']);
				}
			}

			const borderStyleEntryForDefaultColor = layoutUpdates.find(([p]) => p === 'border-style');
			const layoutHasBorderColor = layoutUpdates.some(([p]) => p === 'border-color');
			if (borderStyleEntryForDefaultColor && !layoutHasBorderColor) {
				const bsValNorm = String(borderStyleEntryForDefaultColor[1] || '').trim().toLowerCase();
				if (bsValNorm && bsValNorm !== 'none') {
					const rawBcField = directLayoutBorderColor ? String(directLayoutBorderColor.value || '').trim() : '';
					const hasBcGlobal = !!(directLayoutBorderColor && directLayoutBorderColor.dataset && directLayoutBorderColor.dataset.ucGlobalColorVar);
					if (!rawBcField && !hasBcGlobal) {
						layoutUpdates.push(['border-color', 'transparent']);
					}
				}
			}

			const classTargetToken = selectedTokenLower && (
				appliedClassTokens.some((t) => String(t).toLowerCase() === selectedTokenLower)
				|| isSelectedContextualClass
				|| isSelectedMediaClass
			)
				? selectedTokenLower
				: '';
			const classStyleUpdates = typographyUpdates.concat(layoutUpdates);
			// Writes always target the CURRENT active breakpoint — the chip's stored media/bp is
			// ignored here too, mirroring the read path in syncDirectInputsFromSelection. This is
			// what makes "edit a class on Tablet → goes to Tablet @media" work regardless of when
			// the chip was originally clicked.
			const activeBpMediaTextForWrite = getActiveBreakpointMediaText();
			const writeBlockedByBreakpoint = false;
			if (classTargetToken && classStyleUpdates.length && !writeBlockedByBreakpoint) {
				const preferredSelector = String(
					selectedAppliedClassSelector || directContextualSelectorByToken[classTargetToken] || ''
				).trim();
				const writeMediaText = activeBpMediaTextForWrite;
				const currentRawCss = UichSHE.activeWidgetSettings.get('raw_css') || '';
				const nextCss = upsertLocalClassTypographyInCss(
					currentRawCss,
					classTargetToken,
					classStyleUpdates,
					preferredSelector,
					writeMediaText
				);
				let wroteToRawCss = false;
				if (nextCss !== currentRawCss || currentRawCss.trim() !== '') {
					UichSHE.activeWidgetSettings.set('raw_css', nextCss);
					wroteToRawCss = true;
					markEditorDirty();
					if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
						const input = UichSHE.activePanelView.$el.find('[data-setting="raw_css"]');
						if (input.length && input.val() !== nextCss) {
							input.val(nextCss).trigger('input').trigger('change');
						}
					}
				}
				if (!wroteToRawCss && typeof rawHtml === 'string' && rawHtml.indexOf('<style') !== -1) {
					const styleHtmlUpdate = upsertLocalClassTypographyInRawHtmlStyles(
						rawHtml,
						classTargetToken,
						classStyleUpdates,
						preferredSelector,
						writeMediaText
					);
					if (styleHtmlUpdate.changed) {
						markRawHtmlChanged(styleHtmlUpdate.html);
					}
				}
			}

			// Local target = inline styles only. Selected class target = class CSS only.
			// Never write inline styles when the selected chip belongs to a non-active breakpoint —
			// those edits would leak out of the @media scope.
			const shouldInlineTypography = !classTargetToken && !writeBlockedByBreakpoint;
			const forceInlineRemovalProps = [];
			typographyUpdates.concat(layoutUpdates).forEach(([property, value]) => {
				const cleanValue = String(value || '').trim();
				if (!cleanValue && (property === 'color' || property === 'background-color')) {
					forceInlineRemovalProps.push(property);
				}
			});
			if (shouldInlineTypography) {
				layoutUpdates.forEach(([property, value]) => {
					const cleanValue = String(value || '').trim();
					if (cleanValue) {
						typographyTarget.style.setProperty(property, cleanValue);
					} else {
						typographyTarget.style.removeProperty(property);
					}
				});
				typographyUpdates.forEach(([property, value]) => {
					const cleanValue = String(value || '').trim();
					if (cleanValue) {
						typographyTarget.style.setProperty(property, cleanValue);
					} else {
						typographyTarget.style.removeProperty(property);
					}
				});
			} else if (forceInlineRemovalProps.length) {
				forceInlineRemovalProps.forEach((property) => {
					typographyTarget.style.removeProperty(property);
				});
			}

			const hasHtmlMutation = (shouldInlineTypography && (layoutUpdates.length || typographyUpdates.length))
				|| (!shouldInlineTypography && forceInlineRemovalProps.length);
			if (hasHtmlMutation) {
				const nextHtml = doc.innerHTML;
				UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
				markEditorDirty();
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
					if (input.length && input.val() !== nextHtml) {
						input.val(nextHtml).trigger('input').trigger('change');
					}
				}
			}

			// Avoid forcing a full sync after each keystroke for class CSS updates,
			// which can override in-progress input values.
		}

		function commitDirectImageSource(nextSrc) {
			if (!UichSHE.activeWidgetSettings) return;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return;

			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const node = layerNode || nodes[selectedSlotIndex];
			const imageTarget = getTypographyTargetNode(node);
			if (!imageTarget || imageTarget.nodeType !== Node.ELEMENT_NODE || imageTarget.tagName !== 'IMG') return;

			const nextValue = String(nextSrc || '').trim();
			if (nextValue) {
				imageTarget.setAttribute('src', nextValue);
			} else {
				imageTarget.removeAttribute('src');
			}

			const nextHtml = doc.innerHTML;
			UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
			if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
				const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
				if (input.length && input.val() !== nextHtml) {
					input.val(nextHtml).trigger('input').trigger('change');
				}
			}
			syncDirectInputsFromSelection();
		}

		function openDirectImagePicker() {
			const mediaFactory = (window.wp && window.wp.media)
				|| (window.parent && window.parent.wp && window.parent.wp.media)
				|| null;
			if (!mediaFactory) {
				if (directStatus) {
					directStatus.textContent = 'WordPress media library is unavailable in this context.';
				}
				return;
			}

			const frame = mediaFactory({
				title: 'Select Image',
				button: { text: 'Use Image' },
				library: { type: 'image' },
				multiple: false
			});

			frame.on('select', function () {
				const selection = frame.state().get('selection');
				const attachment = selection && selection.first ? selection.first().toJSON() : null;
				if (!attachment || !attachment.url) return;
				commitDirectImageSource(attachment.url);
			});

			frame.open();
		}

		function openDirectSvgPicker() {
			const mediaFactory = (window.wp && window.wp.media)
				|| (window.parent && window.parent.wp && window.parent.wp.media)
				|| null;
			if (!mediaFactory) {
				if (directStatus) {
					directStatus.textContent = 'WordPress media library is unavailable in this context.';
				}
				return;
			}

			const frame = mediaFactory({
				title: 'Select SVG',
				button: { text: 'Use SVG' },
				library: { type: 'image' },
				multiple: false
			});

			frame.on('select', function () {
				const selection = frame.state().get('selection');
				const attachment = selection && selection.first ? selection.first().toJSON() : null;
				const attachmentUrl = attachment && attachment.url ? String(attachment.url) : '';
				const attachmentMime = attachment && attachment.mime ? String(attachment.mime).toLowerCase() : '';
				const attachmentSubtype = attachment && attachment.subtype ? String(attachment.subtype).toLowerCase() : '';
				const attachmentFilename = attachment && attachment.filename ? String(attachment.filename).toLowerCase() : '';
				if (!attachmentUrl) return;
				const isSvgAttachment =
					attachmentMime === 'image/svg+xml'
					|| attachmentMime === 'image/svg'
					|| attachmentSubtype === 'svg+xml'
					|| attachmentSubtype === 'svg'
					|| /\.svg(?:[?#]|$)/i.test(attachmentFilename)
					|| UichSHE.isSvgUrlValue(attachmentUrl);
				if (!isSvgAttachment) {
					if (directStatus) {
						directStatus.textContent = 'Please select an SVG file from the WordPress media library.';
					}
					return;
				}
				if (directSvgUrl) {
					directSvgUrl.value = attachmentUrl;
				}
				if (directImagePath) {
					directImagePath.value = attachmentUrl;
				}
				if (directSvgMode) {
					setActiveDirectSvgMode('url');
				}
				commitDirectSvgUrl(attachmentUrl);
			});

			frame.open();
		}

		function commitDirectSvgUrl(urlValue) {
			if (!UichSHE.activeWidgetSettings) return;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return;
			const selectedSvgMode = getSelectedDirectSvgMode(true, true);
			if (selectedSvgMode === 'code') {
				if (directSvgCode) {
					UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-direct-svg-code', '', false);
				}
				if (directStatus) {
					directStatus.textContent = 'SVG Type is set to SVG Code. Switch to SVG URL to apply a URL.';
				}
				return;
			}
			const nextUrl = String(urlValue || '').trim();
			if (!nextUrl) return;

			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const node = layerNode || nodes[selectedSlotIndex];
			if (!node) return;
			const nodeTag = UichSHE.getTagNameUpper(node);

			if (nodeTag === 'SVG') {
				// Keep inline SVG tag and map URL via inner <image>.
				node.setAttribute('data-uc-svg-source', nextUrl);
				while (node.firstChild) {
					node.removeChild(node.firstChild);
				}
				const imageNode = doc.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'image');
				imageNode.setAttribute('href', nextUrl);
				imageNode.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', nextUrl);
				imageNode.setAttribute('width', '100%');
				imageNode.setAttribute('height', '100%');
				imageNode.setAttribute('preserveAspectRatio', 'xMidYMid meet');
				node.appendChild(imageNode);
			} else if (nodeTag === 'IMG' && UichSHE.isSvgUrlValue(node.getAttribute('src') || '')) {
				node.setAttribute('src', nextUrl);
			} else {
				return;
			}

			const nextHtml = doc.innerHTML;
			UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
			markEditorDirty();
			if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
				const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
				if (input.length && input.val() !== nextHtml) {
					input.val(nextHtml).trigger('input').trigger('change');
				}
			}
			syncDirectInputsFromSelection();
		}

		function commitDirectSvgUrlForInlineLayer(urlValue) {
			const nextUrl = String(urlValue || '').trim();
			if (!nextUrl) return;
			if (!UichSHE.activeWidgetSettings) return;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return;

			const applyInlineSvgMarkup = function (svgMarkupText) {
				const markup = String(svgMarkupText || '').trim();
				if (!markup) {
					if (directStatus) {
						directStatus.textContent = 'Selected SVG file appears empty.';
					}
					return;
				}
				const parsedWrap = document.createElement('div');
				parsedWrap.innerHTML = markup;
				const nextSvg = parsedWrap.querySelector('svg');
				if (!nextSvg) {
					if (directStatus) {
						directStatus.textContent = 'Selected file is not valid SVG markup.';
					}
					return;
				}
				nextSvg.setAttribute('data-uc-svg-source', nextUrl);

				const doc = document.createElement('div');
				doc.innerHTML = rawHtml;
				const nodes = UichSHE.extractTextNodes(doc);
				const layerRoot = UichSHE.getLayerRoot(doc);
				const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
				const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
				const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
				const node = layerNode || nodes[selectedSlotIndex];
				if (!node || UichSHE.getTagNameUpper(node) !== 'SVG') {
					return;
				}

				node.replaceWith(nextSvg.cloneNode(true));
				const nextHtml = doc.innerHTML;
				UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
				markEditorDirty();
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
					if (input.length && input.val() !== nextHtml) {
						input.val(nextHtml).trigger('input').trigger('change');
					}
				}
				syncDirectInputsFromSelection();
			};

			if (window.fetch) {
				window.fetch(nextUrl, { credentials: 'same-origin' })
					.then((response) => {
						if (!response || !response.ok) {
							throw new Error('SVG fetch failed');
						}
						return response.text();
					})
					.then((svgText) => {
						applyInlineSvgMarkup(svgText);
					})
					.catch(() => {
						if (directStatus) {
							directStatus.textContent = 'Could not load SVG content from URL. Please use SVG Code mode or check file access.';
						}
					});
				return;
			}

			if (directStatus) {
				directStatus.textContent = 'This browser cannot load SVG URL content automatically.';
			}
		}

		function commitDirectImageUrlFromField() {
			if (isDirectSyncing) return;
			if (!directImagePath || directImagePath.disabled) return;
			if (isCurrentDirectLayerSvg()) {
				if (directSvgMode && directSvgMode.value === 'url' && directSvgCode && !directSvgCode.disabled) {
					commitDirectSvgUrlForInlineLayer(directImagePath.value);
					return;
				}
				commitDirectSvgUrl(directImagePath.value);
				return;
			}
			commitDirectImageSource(directImagePath.value);
		}

		function commitDirectSvgCode() {
			if (isDirectSyncing) return;
			if (!directSvgCode || directSvgCode.disabled || !UichSHE.activeWidgetSettings) return;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return;
			const svgMarkup = String(UichSHE.getUiChemyComposerEditorValueById('uichemy-composer-direct-svg-code') || '').trim();
			if (!svgMarkup) {
				if (directStatus) {
					directStatus.textContent = 'Inline SVG code cannot be empty.';
				}
				return;
			}
			const parsedWrap = document.createElement('div');
			parsedWrap.innerHTML = svgMarkup;
			const nextSvg = parsedWrap.querySelector('svg');
			if (!nextSvg) {
				if (directStatus) {
					directStatus.textContent = 'Please provide valid inline SVG code starting with <svg>.';
				}
				return;
			}

			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const node = layerNode || nodes[selectedSlotIndex];
			if (!node) return;

			if (UichSHE.getTagNameUpper(node) === 'SVG') {
				node.replaceWith(nextSvg.cloneNode(true));
			} else if (UichSHE.getTagNameUpper(node) === 'IMG' && UichSHE.isSvgUrlValue(node.getAttribute('src') || '')) {
				node.replaceWith(nextSvg.cloneNode(true));
			} else {
				return;
			}

			const nextHtml = doc.innerHTML;
			UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
			markEditorDirty();
			if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
				const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
				if (input.length && input.val() !== nextHtml) {
					input.val(nextHtml).trigger('input').trigger('change');
				}
			}
			syncDirectInputsFromSelection();
		}

		function isCurrentDirectLayerSvg() {
			if (!UichSHE.activeWidgetSettings) return false;
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') return false;
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const nodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
			const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
			const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
			const node = layerNode || nodes[selectedSlotIndex];
			const typographyTarget = getTypographyTargetNode(node);
			const nodeTag = UichSHE.getTagNameUpper(node);
			const typographyTag = UichSHE.getTagNameUpper(typographyTarget);
			return nodeTag === 'SVG' || (typographyTag === 'IMG' && UichSHE.isSvgUrlValue(typographyTarget.getAttribute('src') || ''));
		}

		const debouncedDirectTextCommit = UichSHE.debounce(commitDirectText, 500);
		const debouncedDirectLinkCommit = UichSHE.debounce(commitDirectLink, 500);
		const debouncedDirectTypographyCommit = UichSHE.debounce(commitDirectTypography, 400);

		tabButtons.forEach(button => {
			button.addEventListener('click', function (e) {
				e.stopPropagation();
				setActiveTab(this.getAttribute('data-uichemy-composer-tab'));
				if (activeTab === 'direct') {
					syncDirectInputsFromSelection();
				}
			});
		});
		codeRowTabs.forEach((button) => {
			button.addEventListener('click', function (e) {
				e.stopPropagation();
				setActiveCodeRowTab(this.getAttribute('data-uichemy-composer-code-tab'));
			});
		});
		setActiveCodeRowTab('core');

		function clearDirectLayerDragClasses() {
			if (!directList) {
				return;
			}
			directList.classList.remove('is-layer-dragging');
			directList.querySelectorAll('.uichemy-composer-direct-item.is-layer-drag-source').forEach((el) => {
				el.classList.remove('is-layer-drag-source');
			});
			directList.querySelectorAll('.uichemy-composer-direct-item').forEach((el) => {
				el.classList.remove('is-layer-drop-target', 'is-layer-drop-before', 'is-layer-drop-after');
			});
			if (directLayerDragGhostEl && directLayerDragGhostEl.parentNode) {
				directLayerDragGhostEl.parentNode.removeChild(directLayerDragGhostEl);
			}
			directLayerDragGhostEl = null;
			directLayerDropPlacement = 'before';
		}

		if (directList) {
			directList.addEventListener('dragstart', function (e) {
				const row = e.target.closest('.uichemy-composer-direct-item[data-layer-id]');
				if (!row || !directList.contains(row)) {
					return;
				}
				if (row.getAttribute('draggable') !== 'true') {
					return;
				}
				if (e.target.closest('[data-layer-toggle], .uichemy-composer-layer-menu-btn, [data-layer-menu]')) {
					e.preventDefault();
					return;
				}
				const dragId = row.getAttribute('data-layer-id') || '';
				if (!dragId) {
					e.preventDefault();
					return;
				}
				directLayerDragSourceId = dragId;
				directLayerDragDidReorder = false;
				directLayerDropPlacement = 'before';
				try {
					e.dataTransfer.setData('text/plain', dragId);
					e.dataTransfer.effectAllowed = 'move';
				} catch (err) {
					// ignore
				}
				directList.classList.add('is-layer-dragging');
				row.classList.add('is-layer-drag-source');
				try {
					const ghost = row.cloneNode(true);
					ghost.classList.add('is-layer-drag-ghost-float');
					ghost.classList.remove('is-active', 'is-layer-drag-source');
					ghost.removeAttribute('draggable');
					ghost.querySelectorAll('button.uichemy-composer-layer-menu-btn').forEach((btn) => {
						btn.setAttribute('disabled', 'disabled');
						btn.setAttribute('aria-hidden', 'true');
					});
					ghost.querySelectorAll('button.uichemy-composer-layer-toggle').forEach((btn) => {
						btn.setAttribute('disabled', 'disabled');
						btn.setAttribute('aria-hidden', 'true');
					});
					const w = Math.ceil(row.getBoundingClientRect().width);
					ghost.style.width = `${Math.max(w, 40)}px`;
					ghost.style.boxSizing = 'border-box';
					ghost.style.position = 'fixed';
					ghost.style.left = '-10000px';
					ghost.style.top = '0';
					ghost.style.margin = '0';
					ghost.style.pointerEvents = 'none';
					ghost.style.zIndex = '2147483646';
					document.body.appendChild(ghost);
					directLayerDragGhostEl = ghost;
					const rowRect = row.getBoundingClientRect();
					const gx = Math.max(8, Math.min(Math.floor(rowRect.width) - 8, Math.round(e.clientX - rowRect.left)));
					const gy = Math.max(10, Math.min(Math.floor(rowRect.height) - 2, Math.round(e.clientY - rowRect.top)));
					e.dataTransfer.setDragImage(ghost, gx, gy);
				} catch (ghostErr) {
					if (directLayerDragGhostEl && directLayerDragGhostEl.parentNode) {
						directLayerDragGhostEl.parentNode.removeChild(directLayerDragGhostEl);
					}
					directLayerDragGhostEl = null;
				}
			});

			directList.addEventListener('dragend', function () {
				directLayerDragSourceId = '';
				clearDirectLayerDragClasses();
			});

			directList.addEventListener('dragover', function (e) {
				if (!directLayerDragSourceId) {
					return;
				}
				const row = e.target.closest('.uichemy-composer-direct-item[data-layer-id]');
				if (!row || !directList.contains(row)) {
					return;
				}
				const overId = row.getAttribute('data-layer-id') || '';
				if (!overId || overId === directLayerDragSourceId) {
					e.dataTransfer.dropEffect = 'none';
					directList.querySelectorAll('.uichemy-composer-direct-item').forEach((el) => {
						el.classList.remove('is-layer-drop-target', 'is-layer-drop-before', 'is-layer-drop-after');
					});
					return;
				}
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				directList.querySelectorAll('.uichemy-composer-direct-item').forEach((el) => {
					el.classList.remove('is-layer-drop-target', 'is-layer-drop-before', 'is-layer-drop-after');
				});
				const rect = row.getBoundingClientRect();
				const after = e.clientY > rect.top + rect.height * 0.5;
				directLayerDropPlacement = after ? 'after' : 'before';
				row.classList.add('is-layer-drop-target', after ? 'is-layer-drop-after' : 'is-layer-drop-before');
			});

			directList.addEventListener('dragleave', function (e) {
				const related = e.relatedTarget;
				if (related && directList.contains(related)) {
					return;
				}
				directList.querySelectorAll('.uichemy-composer-direct-item').forEach((el) => {
					el.classList.remove('is-layer-drop-target', 'is-layer-drop-before', 'is-layer-drop-after');
				});
			});

			directList.addEventListener('drop', function (e) {
				if (!directLayerDragSourceId) {
					return;
				}
				const row = e.target.closest('.uichemy-composer-direct-item[data-layer-id]');
				if (!row || !directList.contains(row)) {
					return;
				}
				const overId = row.getAttribute('data-layer-id') || '';
				if (!overId || overId === directLayerDragSourceId) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				const placement = directLayerDropPlacement === 'after' ? 'after' : 'before';
				const ok = commitDirectLayerDragMove(directLayerDragSourceId, overId, placement);
				if (ok) {
					directLayerDragDidReorder = true;
				} else if (directStatus) {
					directStatus.textContent = 'Cannot move this layer here (for example into its own descendant).';
				}
				clearDirectLayerDragClasses();
				directLayerDragSourceId = '';
			});

			directList.addEventListener('click', function (e) {
				if (directLayerDragDidReorder) {
					directLayerDragDidReorder = false;
					e.preventDefault();
					e.stopPropagation();
					return;
				}
				const menuBtn = e.target.closest('[data-layer-menu]');
				if (menuBtn) {
					e.preventDefault();
					e.stopPropagation();
					const layerIdMenu = menuBtn.getAttribute('data-layer-menu') || '';
					if (layerIdMenu) {
						if (directLayerActionMenuEl.style.display !== 'none' && directLayerMenuTargetLayerId === layerIdMenu) {
							closeDirectLayerActionMenu();
						} else {
							openDirectLayerActionMenu(menuBtn, layerIdMenu);
						}
					}
					return;
				}
				const toggle = e.target.closest('[data-layer-toggle]');
				if (toggle) {
					e.preventDefault();
					e.stopPropagation();
					const layerId = toggle.getAttribute('data-layer-toggle');
					if (!layerId) return;
					if (collapsedLayerIds.has(layerId)) {
						collapsedLayerIds.delete(layerId);
					} else {
						collapsedLayerIds.add(layerId);
					}
					autoExpandSelectedAncestors = false;
					syncDirectInputsFromSelection();
					return;
				}

				const item = e.target.closest('.uichemy-composer-direct-item[data-layer-id]');
				if (!item) return;
				selectedLayerId = item.getAttribute('data-layer-id') || '';
				if (item.hasAttribute('data-slot-index')) {
					selectedSlotIndex = parseInt(item.getAttribute('data-slot-index'), 10) || 0;
				}
				selectedAppliedClassToken = '';
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
				autoExpandSelectedAncestors = true;
				syncDirectInputsFromSelection();
			});

			directList.addEventListener('keydown', function (e) {
				if (e.key !== 'Enter' && e.key !== ' ') {
					return;
				}
				const row = e.target.closest('.uichemy-composer-direct-item[data-layer-id]');
				if (!row || !directList.contains(row)) {
					return;
				}
				if (e.target.closest('[data-layer-menu], [data-layer-toggle]')) {
					return;
				}
				e.preventDefault();
				selectedLayerId = row.getAttribute('data-layer-id') || '';
				if (row.hasAttribute('data-slot-index')) {
					selectedSlotIndex = parseInt(row.getAttribute('data-slot-index'), 10) || 0;
				}
				selectedAppliedClassToken = '';
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
				autoExpandSelectedAncestors = true;
				syncDirectInputsFromSelection();
			});
		}

		if (directLayerActionMenuEl) {
			directLayerActionMenuEl.addEventListener('click', function (e) {
				const act = e.target.closest('[data-layer-action]');
				if (!act || !directLayerActionMenuEl.contains(act)) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				const action = act.getAttribute('data-layer-action') || '';
				const lid = directLayerMenuTargetLayerId;
				closeDirectLayerActionMenu();
				if (!lid) {
					if (directStatus) {
						directStatus.textContent = 'No layer selected for action.';
					}
					return;
				}
				if (action === 'copy') {
					const ok = directLayerCopyFromLayerId(lid, 'copy');
					if (ok && directStatus) {
						directStatus.textContent = 'Layer copied to clipboard.';
					}
				} else if (action === 'cut') {
					const ok = directLayerCopyFromLayerId(lid, 'cut');
					if (ok && directStatus) {
						directStatus.textContent = 'Layer cut to clipboard.';
					}
				} else if (action === 'paste') {
					const ok = directLayerPasteBeforeLayerId(lid);
					if (ok && directStatus) {
						directStatus.textContent = 'Layer pasted successfully.';
					} else if (directStatus) {
						directStatus.textContent = 'Cannot paste: clipboard is empty or paste location invalid.';
					}
				} else if (action === 'delete') {
					const ok = directLayerDeleteLayerId(lid);
					if (ok && directStatus) {
						directStatus.textContent = 'Layer deleted.';
					}
				}
			});
		}

		document.addEventListener('click', function (e) {
			if (!directLayerActionMenuEl || directLayerActionMenuEl.style.display === 'none') {
				return;
			}
			if (directLayerActionMenuEl.contains(e.target)) {
				return;
			}
			if (e.target.closest && e.target.closest('[data-layer-menu]')) {
				return;
			}
			closeDirectLayerActionMenu();
		}, true);

		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && directLayerActionMenuEl && directLayerActionMenuEl.style.display !== 'none') {
				e.preventDefault();
				closeDirectLayerActionMenu();
				return;
			}
			if (!panel.contains(e.target)) {
				return;
			}
			if (activeTab !== 'direct') {
				return;
			}
			const t = e.target;
			if (!t || !t.closest) {
				return;
			}
			const inDirectTab = t.closest('[data-uichemy-composer-panel="direct"]');
			if (!inDirectTab) {
				return;
			}
			if (t.closest('input, textarea, select, [contenteditable="true"]')) {
				return;
			}
			const mod = e.metaKey || e.ctrlKey;
			if (mod && (e.key === 'c' || e.key === 'C')) {
				if (!selectedLayerId) {
					return;
				}
				e.preventDefault();
				const ok = directLayerCopyFromLayerId(selectedLayerId, 'copy');
				if (ok && directStatus) {
					directStatus.textContent = 'Layer copied (Ctrl/Cmd+C).';
				}
				return;
			}
			if (mod && (e.key === 'x' || e.key === 'X')) {
				if (!selectedLayerId) {
					return;
				}
				e.preventDefault();
				const ok = directLayerCopyFromLayerId(selectedLayerId, 'cut');
				if (ok && directStatus) {
					directStatus.textContent = 'Layer cut (Ctrl/Cmd+X).';
				}
				return;
			}
			if (mod && (e.key === 'v' || e.key === 'V')) {
				if (!selectedLayerId) {
					return;
				}
				e.preventDefault();
				if (!directLayerClipboardSerialized && navigator.clipboard && navigator.clipboard.readText) {
					navigator.clipboard.readText().then((txt) => {
						if (txt && txt.indexOf(DIRECT_LAYER_CLIP_PREFIX) === 0) {
							directLayerClipboardSerialized = txt;
							const ok = directLayerPasteBeforeLayerId(selectedLayerId);
							if (ok && directStatus) {
								directStatus.textContent = 'Layer pasted from system clipboard (Ctrl/Cmd+V).';
							}
						} else if (directStatus) {
							directStatus.textContent = 'Clipboard does not contain a valid layer.';
						}
					}).catch(() => {
						if (directStatus) {
							directStatus.textContent = 'Cannot access system clipboard.';
						}
					});
					return;
				}
				const ok = directLayerPasteBeforeLayerId(selectedLayerId);
				if (ok && directStatus) {
					directStatus.textContent = 'Layer pasted (Ctrl/Cmd+V).';
				} else if (directStatus) {
					directStatus.textContent = 'Cannot paste: clipboard is empty.';
				}
				return;
			}
			if (e.key === 'Delete') {
				if (!selectedLayerId) {
					return;
				}
				e.preventDefault();
				const ok = directLayerDeleteLayerId(selectedLayerId);
				if (ok && directStatus) {
					directStatus.textContent = 'Layer deleted.';
				}
			}
		}, true);

		if (directText) {
			directText.addEventListener('input', debouncedDirectTextCommit);
		}
		if (directUrl) {
			directUrl.addEventListener('input', debouncedDirectLinkCommit);
		}
		if (directExternal) {
			directExternal.addEventListener('change', debouncedDirectLinkCommit);
		}
		if (directNofollow) {
			directNofollow.addEventListener('change', debouncedDirectLinkCommit);
		}
		if (directCustom) {
			directCustom.addEventListener('input', debouncedDirectLinkCommit);
		}
		if (directFontSize) {
			directFontSize.addEventListener('input', debouncedDirectTypographyCommit);
		}
		if (directFontFamily) {
			directFontFamily.addEventListener('input', debouncedDirectTypographyCommit);
		}
		if (directFontWeight) {
			directFontWeight.addEventListener('change', debouncedDirectTypographyCommit);
		}
		if (directLineHeight) {
			directLineHeight.addEventListener('input', debouncedDirectTypographyCommit);
		}
		if (directTextAlign) {
			directTextAlign.addEventListener('change', debouncedDirectTypographyCommit);
		}
		if (directFontStyle) {
			directFontStyle.addEventListener('change', debouncedDirectTypographyCommit);
		}
		if (directLetterSpacing) {
			directLetterSpacing.addEventListener('input', debouncedDirectTypographyCommit);
		}
		if (directTextTransform) {
			directTextTransform.addEventListener('change', debouncedDirectTypographyCommit);
		}
		if (directTextDecoration) {
			directTextDecoration.addEventListener('change', debouncedDirectTypographyCommit);
		}
		if (directTextColor) {
			directTextColor.addEventListener('input', function () {
				if (directTextColorPicker) {
					assignDirectColorPickerValue(directTextColorPicker, colorStringToPickerHex(directTextColor.value));
				}
				if (directTextColor.dataset) {
					delete directTextColor.dataset.ucGlobalColorId;
					delete directTextColor.dataset.ucGlobalColorVar;
					delete directTextColor.dataset.ucGlobalColorName;
				}
				syncDirectGlobalColorChip('text', parseGlobalColorVarId(directTextColor.value));
				debouncedDirectTypographyCommit();
			});
		}
		if (directTextColorPicker) {
			directTextColorPicker.addEventListener('input', function () {
				if (isDirectSyncing || directColorPickerProgrammaticDepth > 0) {
					return;
				}
				if (directTextColor) {
					directTextColor.value = directTextColorPicker.value;
					if (directTextColor.dataset) {
						delete directTextColor.dataset.ucGlobalColorId;
						delete directTextColor.dataset.ucGlobalColorVar;
						delete directTextColor.dataset.ucGlobalColorName;
					}
				}
				syncDirectGlobalColorChip('text', '');
				debouncedDirectTypographyCommit();
			});
		}
		layoutStyleFields.forEach((field) => {
			if (field === directLayoutBgColor) return;
			const eventName = field.tagName === 'SELECT' ? 'change' : 'input';
			field.addEventListener(eventName, debouncedDirectTypographyCommit);
		});
		if (directLayoutBorderStyle) {
			directLayoutBorderStyle.addEventListener('change', function () {
				const styleNorm = String(directLayoutBorderStyle.value || '').trim().toLowerCase();
				if (styleNorm && styleNorm !== 'none' && directLayoutBorderColor) {
					const rawBc = String(directLayoutBorderColor.value || '').trim();
					const hasGlobalBc = !!(directLayoutBorderColor.dataset && directLayoutBorderColor.dataset.ucGlobalColorVar);
					if (!rawBc && !hasGlobalBc) {
						directLayoutBorderColor.value = 'transparent';
						if (directLayoutBorderColor.dataset) {
							delete directLayoutBorderColor.dataset.ucGlobalColorId;
							delete directLayoutBorderColor.dataset.ucGlobalColorVar;
							delete directLayoutBorderColor.dataset.ucGlobalColorName;
						}
						if (directLayoutBorderColorPicker) {
							assignDirectColorPickerValue(directLayoutBorderColorPicker, colorStringToPickerHex('transparent'));
						}
						syncDirectGlobalColorChip('border', '');
					}
				}
				updateBorderControlVisibility();
			});
		}

		sidesFields.forEach(field => {
			const inputs = Array.from(field.querySelectorAll('.uichemy-composer-side-input'));
			const linkBtn = field.querySelector('.uichemy-composer-sides-link-btn');
			const unitSelect = field.querySelector('.uichemy-composer-sides-unit');

			const syncLinked = (sourceInput) => {
				if (linkBtn && linkBtn.classList.contains('is-active')) {
					inputs.forEach(other => {
						if (other !== sourceInput) other.value = sourceInput.value;
					});
				}
			};

			inputs.forEach(input => {
				input.addEventListener('input', function () {
					syncLinked(this);
					if (field.getAttribute('data-sides-type') === 'border-width') {
						updateBorderControlVisibility();
					}
					debouncedDirectTypographyCommit();
				});
			});

			if (linkBtn) {
				linkBtn.addEventListener('click', function (e) {
					e.preventDefault();
					this.classList.toggle('is-active');
					if (this.classList.contains('is-active')) {
						const topInput = inputs.find(i => i.getAttribute('data-side') === 'top');
						if (topInput) {
							syncLinked(topInput);
							debouncedDirectTypographyCommit();
						}
					}
				});
			}

			if (unitSelect) {
				unitSelect.addEventListener('change', debouncedDirectTypographyCommit);
			}
		});
		if (directLayoutDisplay) {
			directLayoutDisplay.addEventListener('change', function () {
				setLayoutControlVisibility({
					display: directLayoutDisplay.value,
					position: directLayoutPosition ? directLayoutPosition.value : '',
					canEditLayout: true
				});
			});
		}
		if (directLayoutPosition) {
			directLayoutPosition.addEventListener('change', function () {
				setLayoutControlVisibility({
					display: directLayoutDisplay ? directLayoutDisplay.value : '',
					position: directLayoutPosition.value,
					canEditLayout: true
				});
			});
		}
		if (directLayoutBgColor) {
			directLayoutBgColor.addEventListener('input', function () {
				if (directLayoutBgColorPicker) {
					assignDirectColorPickerValue(directLayoutBgColorPicker, colorStringToPickerHex(directLayoutBgColor.value));
				}
				if (directLayoutBgColor.dataset) {
					delete directLayoutBgColor.dataset.ucGlobalColorId;
					delete directLayoutBgColor.dataset.ucGlobalColorVar;
					delete directLayoutBgColor.dataset.ucGlobalColorName;
				}
				syncDirectGlobalColorChip('background', parseGlobalColorVarId(directLayoutBgColor.value));
				debouncedDirectTypographyCommit();
			});
		}
		if (directLayoutBgColorPicker) {
			directLayoutBgColorPicker.addEventListener('input', function () {
				if (isDirectSyncing || directColorPickerProgrammaticDepth > 0) {
					return;
				}
				if (directLayoutBgColor) {
					directLayoutBgColor.value = directLayoutBgColorPicker.value;
					if (directLayoutBgColor.dataset) {
						delete directLayoutBgColor.dataset.ucGlobalColorId;
						delete directLayoutBgColor.dataset.ucGlobalColorVar;
						delete directLayoutBgColor.dataset.ucGlobalColorName;
					}
				}
				syncDirectGlobalColorChip('background', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directLayoutBorderColor) {
			directLayoutBorderColor.addEventListener('input', function () {
				if (directLayoutBorderColorPicker) {
					assignDirectColorPickerValue(directLayoutBorderColorPicker, colorStringToPickerHex(directLayoutBorderColor.value));
				}
				if (directLayoutBorderColor.dataset) {
					delete directLayoutBorderColor.dataset.ucGlobalColorId;
					delete directLayoutBorderColor.dataset.ucGlobalColorVar;
					delete directLayoutBorderColor.dataset.ucGlobalColorName;
				}
				syncDirectGlobalColorChip('border', parseGlobalColorVarId(directLayoutBorderColor.value));
				debouncedDirectTypographyCommit();
			});
		}
		if (directLayoutBorderColorPicker) {
			directLayoutBorderColorPicker.addEventListener('input', function () {
				if (isDirectSyncing || directColorPickerProgrammaticDepth > 0) {
					return;
				}
				if (directLayoutBorderColor) {
					directLayoutBorderColor.value = directLayoutBorderColorPicker.value;
					if (directLayoutBorderColor.dataset) {
						delete directLayoutBorderColor.dataset.ucGlobalColorId;
						delete directLayoutBorderColor.dataset.ucGlobalColorVar;
						delete directLayoutBorderColor.dataset.ucGlobalColorName;
					}
				}
				syncDirectGlobalColorChip('border', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directTextColorGlobalBtn) {
			directTextColorGlobalBtn.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				openDirectGlobalColorPopover('text', directTextColorGlobalBtn);
			});
		}
		if (directLayoutBgColorGlobalBtn) {
			directLayoutBgColorGlobalBtn.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				openDirectGlobalColorPopover('background', directLayoutBgColorGlobalBtn);
			});
		}
		if (directLayoutBorderColorGlobalBtn) {
			directLayoutBorderColorGlobalBtn.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				openDirectGlobalColorPopover('border', directLayoutBorderColorGlobalBtn);
			});
		}
		if (directTextColorGlobalRemove) {
			directTextColorGlobalRemove.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directTextColor) {
					directTextColor.value = '';
					if (directTextColor.dataset) {
						delete directTextColor.dataset.ucGlobalColorId;
						delete directTextColor.dataset.ucGlobalColorVar;
						delete directTextColor.dataset.ucGlobalColorName;
					}
					if (directTextColorPicker) {
						assignDirectColorPickerValue(directTextColorPicker, '#000000');
					}
				}
				syncDirectGlobalColorChip('text', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directTextColorInlineRemove) {
			directTextColorInlineRemove.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directTextColor) {
					directTextColor.value = '';
					if (directTextColor.dataset) {
						delete directTextColor.dataset.ucGlobalColorId;
						delete directTextColor.dataset.ucGlobalColorVar;
						delete directTextColor.dataset.ucGlobalColorName;
					}
				}
				if (directTextColorPicker) {
					assignDirectColorPickerValue(directTextColorPicker, '#000000');
				}
				syncDirectGlobalColorChip('text', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directLayoutBgColorGlobalRemove) {
			directLayoutBgColorGlobalRemove.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directLayoutBgColor) {
					directLayoutBgColor.value = '';
					if (directLayoutBgColor.dataset) {
						delete directLayoutBgColor.dataset.ucGlobalColorId;
						delete directLayoutBgColor.dataset.ucGlobalColorVar;
						delete directLayoutBgColor.dataset.ucGlobalColorName;
					}
					if (directLayoutBgColorPicker) {
						assignDirectColorPickerValue(directLayoutBgColorPicker, '#000000');
					}
				}
				syncDirectGlobalColorChip('background', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directLayoutBorderColorGlobalRemove) {
			directLayoutBorderColorGlobalRemove.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directLayoutBorderColor) {
					directLayoutBorderColor.value = '';
					if (directLayoutBorderColor.dataset) {
						delete directLayoutBorderColor.dataset.ucGlobalColorId;
						delete directLayoutBorderColor.dataset.ucGlobalColorVar;
						delete directLayoutBorderColor.dataset.ucGlobalColorName;
					}
					if (directLayoutBorderColorPicker) {
						assignDirectColorPickerValue(directLayoutBorderColorPicker, '#000000');
					}
				}
				syncDirectGlobalColorChip('border', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directLayoutBgColorInlineRemove) {
			directLayoutBgColorInlineRemove.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directLayoutBgColor) {
					directLayoutBgColor.value = '';
					if (directLayoutBgColor.dataset) {
						delete directLayoutBgColor.dataset.ucGlobalColorId;
						delete directLayoutBgColor.dataset.ucGlobalColorVar;
						delete directLayoutBgColor.dataset.ucGlobalColorName;
					}
				}
				if (directLayoutBgColorPicker) {
					assignDirectColorPickerValue(directLayoutBgColorPicker, '#000000');
				}
				syncDirectGlobalColorChip('background', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directLayoutBorderColorInlineRemove) {
			directLayoutBorderColorInlineRemove.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directLayoutBorderColor) {
					directLayoutBorderColor.value = '';
					if (directLayoutBorderColor.dataset) {
						delete directLayoutBorderColor.dataset.ucGlobalColorId;
						delete directLayoutBorderColor.dataset.ucGlobalColorVar;
						delete directLayoutBorderColor.dataset.ucGlobalColorName;
					}
				}
				if (directLayoutBorderColorPicker) {
					assignDirectColorPickerValue(directLayoutBorderColorPicker, '#000000');
				}
				syncDirectGlobalColorChip('border', '');
				debouncedDirectTypographyCommit();
			});
		}
		if (directGlobalColorPopover) {
			directGlobalColorPopover.addEventListener('mousedown', function (e) {
				const option = e.target.closest('[data-global-color-id]');
				if (!option) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				const globalId = decodeURIComponent(option.getAttribute('data-global-color-id') || '');
				if (!globalId || !activeDirectGlobalColorTarget) {
					return;
				}
				applyDirectGlobalColorSelection(activeDirectGlobalColorTarget, globalId);
				hideDirectGlobalColorPopover();
			});
		}
		document.addEventListener('mousedown', function (e) {
			const target = e.target;
			const clickedPopover = !!(target && directGlobalColorPopover && directGlobalColorPopover.contains(target));
			const clickedToggle = !!(target && (
				(directTextColorGlobalBtn && directTextColorGlobalBtn.contains(target))
				|| (directLayoutBgColorGlobalBtn && directLayoutBgColorGlobalBtn.contains(target))
			));
			if (!clickedPopover && !clickedToggle) {
				hideDirectGlobalColorPopover();
			}
			const styleOriginPop = document.getElementById('uichemy-composer-direct-style-origin-popover');
			const clickedStyleOriginPopover = !!(target && styleOriginPop && styleOriginPop.contains(target));
			const clickedStyleOriginDot = !!(target && target.closest && target.closest('.uichemy-composer-direct-style-origin-dot'));
			if (!clickedStyleOriginPopover && !clickedStyleOriginDot) {
				hideDirectStyleOriginPopover();
			}
		});
		// Open the Style Origin popover when a dot is clicked. Bound at the document level so dots
		// injected lazily into any field wrap are picked up without per-field rebinds.
		document.addEventListener('click', function (e) {
			const target = e.target;
			if (!target || !target.closest) return;
			const closeBtn = target.closest('.uichemy-composer-direct-style-origin-close');
			if (closeBtn) {
				e.preventDefault();
				e.stopPropagation();
				hideDirectStyleOriginPopover();
				return;
			}
			const dot = target.closest('.uichemy-composer-direct-style-origin-dot');
			if (!dot) return;
			e.preventDefault();
			e.stopPropagation();
			const property = String(dot.dataset.styleOriginProperty || '');
			const entries = dot.__ucStyleOriginEntries || [];
			openDirectStyleOriginPopover(dot, property, entries);
		});
		if (directImagePreview) {
			directImagePreview.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directImagePreview.disabled) return;
				if (isCurrentDirectLayerSvg()) {
					openDirectSvgPicker();
					return;
				}
				openDirectImagePicker();
			});
		}
		if (directImagePath) {
			directImagePath.addEventListener('change', commitDirectImageUrlFromField);
			directImagePath.addEventListener('keydown', function (e) {
				if (e.key === 'Enter') {
					e.preventDefault();
					commitDirectImageUrlFromField();
				}
			});
		}
		if (directSvgCode) {
			const debouncedDirectSvgCodeCommit = UichSHE.debounce(commitDirectSvgCode, 500);
			if (directSvgCodeEditor && directSvgCodeEditor.codemirror) {
				directSvgCodeEditor.codemirror.on('change', function () {
					syncDirectSvgCodePreviewFromMarkup(UichSHE.getUiChemyComposerEditorValueById('uichemy-composer-direct-svg-code'));
					debouncedDirectSvgCodeCommit();
				});
				directSvgCodeEditor.codemirror.on('blur', commitDirectSvgCode);
			} else {
				directSvgCode.addEventListener('input', function () {
					syncDirectSvgCodePreviewFromMarkup(directSvgCode.value);
					debouncedDirectSvgCodeCommit();
				});
				directSvgCode.addEventListener('change', commitDirectSvgCode);
			}
		}
		if (directSvgMode) {
			directSvgModeTabs.forEach((tabButton) => {
				tabButton.addEventListener('click', function () {
					if (tabButton.disabled) return;
					const selectedSvgMode = tabButton.getAttribute('data-uichemy-composer-direct-svg-mode') === 'url' ? 'url' : 'code';
					setActiveDirectSvgMode(selectedSvgMode);
				if (selectedSvgMode === 'url' && directSvgCode) {
					UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-direct-svg-code', '', false);
				} else if (selectedSvgMode === 'code') {
					if (directImagePath) {
						directImagePath.value = '';
					}
					if (directImagePreviewImg) {
						directImagePreviewImg.removeAttribute('src');
						directImagePreviewImg.style.display = 'none';
					}
					if (directImageEmpty) {
						directImageEmpty.style.display = '';
					}
				}
				syncDirectInputsFromSelection();
				});
			});
		}
		if (directSvgWordpressBtn) {
			directSvgWordpressBtn.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directSvgWordpressBtn.disabled) return;
				openDirectSvgPicker();
			});
		}
		if (directSvgUrlApplyBtn) {
			directSvgUrlApplyBtn.addEventListener('click', function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (directSvgUrlApplyBtn.disabled || !directSvgUrl) return;
				commitDirectSvgUrl(directSvgUrl.value);
			});
		}
		if (directSvgUrl) {
			directSvgUrl.addEventListener('keydown', function (e) {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				commitDirectSvgUrl(directSvgUrl.value);
			});
			directSvgUrl.addEventListener('change', function () {
				commitDirectSvgUrl(directSvgUrl.value);
			});
		}

		function handleDirectClassChipsClick(e) {
			const btn = e.target.closest('.uichemy-composer-class-chip-remove');
			if (btn && btn.getAttribute('data-class-token')) {
				e.preventDefault();
				const token = decodeURIComponent(btn.getAttribute('data-class-token'));
				const ctx = getDirectEditorClassTargetContext();
				if (!ctx) {
					return;
				}
				const parentChip = btn.closest('.uichemy-composer-class-chip[data-class-token]');
				const isContextual = parentChip ? parentChip.getAttribute('data-class-contextual') === 'true' : false;
				const contextualSelector = parentChip
					? decodeURIComponent(parentChip.getAttribute('data-class-selector') || '')
					: '';
				const chipMediaText = parentChip
					? decodeURIComponent(parentChip.getAttribute('data-class-media-text') || '')
					: '';
				const normChipSel = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
				const normSelForClassChip = (s) => normChipSel(String(s || '').replace(/\\:/g, ':'));
				const cur = parseClassNameString(getDomElementClassString(ctx.typographyTarget));
				let nextCur;
				if (isContextual && String(contextualSelector || '').trim()) {
					const ctxSelNorm = normSelForClassChip(contextualSelector);
					const hadLiteralClassForRule = cur.some((cl) => {
						const st = sanitizeNewClassToken(String(cl || '').trim());
						if (!st) {
							return false;
						}
						return normSelForClassChip(classTokenToTypographyRuleSelector(st)) === ctxSelNorm;
					});
					if (hadLiteralClassForRule) {
						nextCur = cur.filter((cl) => {
							const st = sanitizeNewClassToken(String(cl || '').trim());
							if (!st) {
								return true;
							}
							return normSelForClassChip(classTokenToTypographyRuleSelector(st)) !== ctxSelNorm;
						});
					} else {
						// e.g. element has `card` and rule is `.card:hover` — no literal `card:hover` class to strip; remove the CSS rule only.
						deleteLocalClassDefinitions(token, contextualSelector || '');
						nextCur = cur;
					}
				} else {
					const rawTok = String(token || '').trim();
					const wantRemove = sanitizeNewClassToken(rawTok) || rawTok;
					const removeCanon = normSelForClassChip(classTokenToTypographyRuleSelector(wantRemove));
					nextCur = cur.filter((cl) => {
						const rawCl = String(cl || '').trim();
						const sc = sanitizeNewClassToken(rawCl) || rawCl;
						if (!sc) {
							return true;
						}
						if (sc === wantRemove || rawCl === rawTok) {
							return false;
						}
						return normSelForClassChip(classTokenToTypographyRuleSelector(sc)) !== removeCanon;
					});
				}
				if (
					String(selectedAppliedClassToken || '').toLowerCase() === String(token || '').toLowerCase()
					&& (!contextualSelector || selectorsMatchForDirectClassSelection(selectedAppliedClassSelector, contextualSelector))
					&& String(selectedAppliedClassMediaText || '').trim() === String(chipMediaText || '').trim()
				) {
					selectedAppliedClassToken = '';
					selectedAppliedClassSelector = '';
					selectedAppliedClassMediaText = '';
					selectedAppliedClassBreakpointKey = '';
				} else if (
					isContextual
					&& String(contextualSelector || '').trim()
					&& String(selectedAppliedClassSelector || '').trim()
					&& normSelForClassChip(selectedAppliedClassSelector) === normSelForClassChip(contextualSelector)
					&& String(selectedAppliedClassMediaText || '').trim() === String(chipMediaText || '').trim()
				) {
					selectedAppliedClassToken = '';
					selectedAppliedClassSelector = '';
					selectedAppliedClassMediaText = '';
					selectedAppliedClassBreakpointKey = '';
				}
				// Local chip: DOM only. Contextual with a matching literal class on the element: DOM only.
				// Contextual with no matching literal class (e.g. `.card:hover` while element only has `card`): remove that CSS rule.
				commitDirectClassesFromTokens(nextCur);
				return;
			}

			const chip = e.target.closest('.uichemy-composer-class-chip[data-class-token]');
			if (!chip) {
				return;
			}
			const token = decodeURIComponent(chip.getAttribute('data-class-token') || '');
			if (!token || token === '__uc_local__') {
				selectedAppliedClassToken = '';
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
				syncDirectInputsFromSelection();
				return;
			}
			const contextualSelector = decodeURIComponent(chip.getAttribute('data-class-selector') || '');
			// Selection identity = (token, contextual selector). Re-clicking the same chip toggles it
			// off regardless of which breakpoint Elementor is showing — the chip's edit context
			// always follows the active breakpoint at write-time.
			const sameToken = String(selectedAppliedClassToken || '').toLowerCase() === String(token || '').toLowerCase();
			const sameSelector = selectorsMatchForDirectClassSelection(
				String(selectedAppliedClassSelector || '').trim(),
				String(contextualSelector || '').trim()
			);
			if (sameToken && (!contextualSelector ? !String(selectedAppliedClassSelector || '').trim() : sameSelector)) {
				selectedAppliedClassToken = '';
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
			} else {
				selectedAppliedClassToken = token;
				selectedAppliedClassSelector = contextualSelector || '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
			}
			syncDirectInputsFromSelection();
		}

		if (directClassesChips) {
			directClassesChips.addEventListener('click', handleDirectClassChipsClick);
		}
		if (directClassSuggestions) {
			directClassSuggestions.addEventListener('mousedown', function (e) {
				const row = e.target.closest('[data-class-token]');
				if (!row) {
					return;
				}
				e.preventDefault();
				const token = sanitizeNewClassToken(decodeURIComponent(row.getAttribute('data-class-token') || ''));
				if (!token) {
					return;
				}
				const ctx = getDirectEditorClassTargetContext();
				if (!ctx) {
					return;
				}
				const cur = parseClassNameString(getDomElementClassString(ctx.typographyTarget));
				if (cur.indexOf(token) === -1) {
					cur.push(token);
				}
				const source = decodeURIComponent(row.getAttribute('data-source') || '');
				const typographyTitle = decodeURIComponent(row.getAttribute('data-typography-title') || '');
				const presetValue = source === 'typography' ? getV3TypographyPresetByTitle(typographyTitle) : null;
				const activeBpKeyForNewClass = directCurrentElementorBreakpoint || getElementorCurrentDeviceMode() || '';
				selectedAppliedClassToken = token;
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = getActiveBreakpointMediaText();
				selectedAppliedClassBreakpointKey = activeBpKeyForNewClass === 'desktop' ? '' : activeBpKeyForNewClass;
				commitDirectClassesFromTokens(cur, presetValue, token);
				if (directClassInput) {
					directClassInput.value = '';
				}
				hideDirectClassSuggestions();
			});
		}
		if (directClassInput) {
			directClassInput.addEventListener('keydown', function (e) {
				if (e.key !== 'Enter') {
					return;
				}
				e.preventDefault();
				const token = sanitizeNewClassToken(directClassInput.value);
				if (!token) {
					hideDirectClassSuggestions();
					return;
				}
				const ctx = getDirectEditorClassTargetContext();
				if (!ctx) {
					return;
				}
				const cur = parseClassNameString(getDomElementClassString(ctx.typographyTarget));
				if (cur.indexOf(token) === -1) {
					cur.push(token);
				}
				const activeBpKeyForEnter = directCurrentElementorBreakpoint || getElementorCurrentDeviceMode() || '';
				selectedAppliedClassToken = token;
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = getActiveBreakpointMediaText();
				selectedAppliedClassBreakpointKey = activeBpKeyForEnter === 'desktop' ? '' : activeBpKeyForEnter;
				commitDirectClassesFromTokens(cur);
				directClassInput.value = '';
				hideDirectClassSuggestions();
			});
			directClassInput.addEventListener('input', function () {
				clearTimeout(directClassSuggestionTimer);
				const q = directClassInput.value;
				directClassSuggestionTimer = setTimeout(() => {
					showDirectClassSuggestionsForQuery(q);
				}, 120);
			});
			directClassInput.addEventListener('blur', function () {
				setTimeout(() => hideDirectClassSuggestions(), 200);
			});
		}
		if (directClassUnselect) {
			directClassUnselect.addEventListener('click', function (e) {
				e.preventDefault();
				selectedAppliedClassToken = '';
				selectedAppliedClassSelector = '';
				selectedAppliedClassMediaText = '';
				selectedAppliedClassBreakpointKey = '';
				syncDirectInputsFromSelection();
			});
		}
		if (panel && directClassesWrap) {
			panel.addEventListener('click', function (e) {
				if (!directClassSuggestions || directClassSuggestions.hidden) {
					return;
				}
				if (directClassesWrap.contains(e.target)) {
					return;
				}
				hideDirectClassSuggestions();
			});
		}

		if (panel) {
			panel.querySelectorAll('.uichemy-composer-accordion-header').forEach(header => {
				header.addEventListener('click', function (e) {
					e.stopPropagation();
					const accordion = this.closest('.uichemy-composer-accordion');
					if (accordion) {
						accordion.classList.toggle('is-active');
					}
				});
			});
		}

		if (directReset) {
			directReset.addEventListener('click', function (e) {
				e.stopPropagation();
				if (!UichSHE.activeWidgetSettings) return;
				const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
				if (typeof rawHtml !== 'string') return;
				const doc = document.createElement('div');
				doc.innerHTML = rawHtml;
				const nodes = UichSHE.extractTextNodes(doc);
				const layerRoot = UichSHE.getLayerRoot(doc);
				const layerEntries = UichSHE.extractLayerEntries(layerRoot, nodes);
				const activeLayer = layerEntries.find(entry => entry.id === selectedLayerId) || null;
				const layerNode = activeLayer && activeLayer.path ? resolveNodeByLayerPath(layerRoot, activeLayer.path) : null;
				const node = layerNode || nodes[selectedSlotIndex];
				if (!node) return;
				const activeSlotIndex = activeLayer && typeof activeLayer.slotIndex === 'number' ? activeLayer.slotIndex : null;
				const slotKey = typeof activeSlotIndex === 'number' ? `slot_${activeSlotIndex}` : '';
				const typographyTarget = getTypographyTargetNode(node);
				const dynamics = UichSHE.activeWidgetSettings.get('__dynamic__') || {};
				if (typeof activeSlotIndex === 'number' && !(dynamics[slotKey] && dynamics[slotKey] !== '')) {
					UichSHE.activeWidgetSettings.set(slotKey, UichSHE.getSlotTextValue(node));
				}
				if (typographyTarget) {
					const canEditTypography = !!(typographyTarget && canEditTypographyTarget(typographyTarget));
					const propsToReset = canEditTypography
						? [
							'font-size',
							'font-family',
							'font-weight',
							'line-height',
							'text-align',
							'font-style',
							'letter-spacing',
							'text-transform',
							'text-decoration',
							'color',
							...layoutStyleProperties
						]
						: [...layoutStyleProperties];
					propsToReset.forEach((property) => typographyTarget.style.removeProperty(property));
				}
				const nextHtml = doc.innerHTML;
				UichSHE.activeWidgetSettings.set('raw_html', nextHtml);
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const input = UichSHE.activePanelView.$el.find('[data-setting="raw_html"]');
					if (input.length && input.val() !== nextHtml) {
						input.val(nextHtml).trigger('input').trigger('change');
					}
				}
				syncDirectInputsFromSelection();
			});
		}

		function clearChatElementPickBridge() {
			if (chatPickPointerTimer) {
				clearTimeout(chatPickPointerTimer);
				chatPickPointerTimer = null;
			}
			if (UichSHE.chatPickAbortController) {
				try { UichSHE.chatPickAbortController.abort(); } catch (err) {}
				UichSHE.chatPickAbortController = null;
			}
			// Remove purple hover highlight from last hovered element.
			if (UichSHE.chatPickHoverElement && UichSHE.chatPickHoverElement.classList) {
				UichSHE.chatPickHoverElement.classList.remove('uichemy-composer-chat-pick-hover');
			}
			UichSHE.chatPickHoverElement = null;
			// Remove persistent selected outline from the picked element.
			if (UichSHE.chatPickSelectedElement && UichSHE.chatPickSelectedElement.classList) {
				UichSHE.chatPickSelectedElement.classList.remove('uichemy-composer-chat-pick-selected');
			}
			UichSHE.chatPickSelectedElement = null;
			UichSHE.chatPickSelectedInfo = null;
		}

		function selectionSelectorFromElement(el) {
			if (!el || !el.tagName) {
				return '';
			}
			const tag = String(el.tagName || '').toLowerCase();
			if (el.id) {
				return `#${el.id}`;
			}
			let classPart = '';
			if (el.className && typeof el.className === 'string') {
				classPart = `.${el.className.split(/\s+/).filter(Boolean).join('.')}`;
			}
			return tag + classPart;
		}

		/**
		 * Build a unique CSS selector path from rootEl down to el using :nth-of-type.
		 * e.g. "nav > a:nth-of-type(2)" — targets exactly one element in the tree.
		 *
		 * @param {Element} el      The picked element.
		 * @param {Element} rootEl  Stop walking when we reach this ancestor.
		 * @returns {string}
		 */
		function buildNthSelector(el, rootEl) {
			if (!el || !el.tagName) return '';
			const parts = [];
			let current = el;

			while (current && current !== rootEl && current.parentElement) {
				const parent = current.parentElement;
				const tag    = current.tagName.toLowerCase();

				// Count same-tag siblings to decide if :nth-of-type is needed.
				const sameTag = Array.from(parent.children).filter(c => c.tagName === current.tagName);
				if (sameTag.length <= 1) {
					parts.unshift(tag); // unique tag in parent — no positional qualifier needed
				} else {
					const nthPos = sameTag.indexOf(current) + 1; // 1-based
					parts.unshift(`${tag}:nth-of-type(${nthPos})`);
				}

				current = parent;
				if (parts.length >= 6) break; // don't build an absurdly long selector
			}

			return parts.join(' > ');
		}

		function getBridgeMutationLayerPath() {
			const pick = UichSHE.chatPickSelectedInfo;
			if (pick && pick.path) {
				return String(pick.path).trim();
			}
			let path = String(UichSHE.uiChemyComposerPreviewSelectionPathCache || '').trim();
			if (path) {
				return path;
			}
			const previewEl = UichSHE.activePreviewSelectedElement;
			if (!previewEl || !UichSHE.activeWidgetPreviewView || !UichSHE.activeWidgetPreviewView.$el) {
				return '';
			}
			const widgetContainer = UichSHE.activeWidgetPreviewView.$el.find('.elementor-widget-container');
			if (!widgetContainer.length) {
				return '';
			}
			const containerEl = widgetContainer[0];
			const layerRootEl = UichSHE.getLayerRoot(containerEl) || containerEl;
			return UichSHE.getPreviewElementLayerPath(previewEl, layerRootEl)
				|| UichSHE.getPreviewElementLayerPath(previewEl, containerEl)
				|| '';
		}

		function findResolvedMutationNodeForBridge() {
			if (!UichSHE.activeWidgetSettings) {
				return null;
			}
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html');
			if (typeof rawHtml !== 'string') {
				return null;
			}
			const layerPath = getBridgeMutationLayerPath();
			if (!layerPath) {
				return null;
			}
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const layerRoot = UichSHE.getLayerRoot(doc);
			const candidates = UichSHE.getLayerPathCandidates(layerPath);
			for (let i = 0; i < candidates.length; i++) {
				let node = resolveNodeByLayerPath(layerRoot, candidates[i]);
				if (!node && layerRoot !== doc) {
					node = resolveNodeByLayerPath(doc, candidates[i]);
				}
				if (node) {
					return { doc, node };
				}
			}
			return null;
		}

		function commitBridgeRawMutation(doc) {
			const nextHtml = doc.innerHTML;
			markRawHtmlChanged(nextHtml);
			UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-html', nextHtml, true);
			syncDirectInputsFromSelection();
		}

		function startChatElementPickBridge(onPick, onCancel) {
			clearChatElementPickBridge();
			if (!UichSHE.activeWidgetPreviewView || !UichSHE.activeWidgetPreviewView.$el) {
				if (typeof onCancel === 'function') onCancel();
				return;
			}
			const widgetContainer = UichSHE.activeWidgetPreviewView.$el.find('.elementor-widget-container');
			if (!widgetContainer.length) {
				if (typeof onCancel === 'function') onCancel();
				return;
			}
			const containerEl   = widgetContainer[0];
			const layerRootEl   = UichSHE.getLayerRoot(containerEl) || containerEl;

			// The preview lives inside the Elementor preview iframe — get its document
			// so events fire in the right context and styles inject into the right DOM.
			const previewDocument = (containerEl.ownerDocument) || document;

			// Inject purple pick-mode styles into the preview document (once).
			const pickStyleId = 'uichemy-composer-chat-pick-styles';
			if (!previewDocument.getElementById(pickStyleId)) {
				const style = previewDocument.createElement('style');
				style.id    = pickStyleId;
				style.textContent = [
					/* Hover while in pick mode — dashed blue-violet outline */
					'.uichemy-composer-chat-pick-hover{',
					'  outline:2px dashed #a78bfa!important;',
					'  outline-offset:3px!important;',
					'  box-shadow:0 0 0 3px rgba(167,139,250,.15)!important;',
					'  cursor:crosshair!important;',
					'}',
					/* Persistent selection — solid bright outline + stronger glow */
					'.uichemy-composer-chat-pick-selected{',
					'  outline:2px solid #a78bfa!important;',
					'  outline-offset:2px!important;',
					'  box-shadow:0 0 0 4px rgba(167,139,250,.35),0 0 12px rgba(167,139,250,.2)!important;',
					'}',
				].join('');
				if (previewDocument.head) previewDocument.head.appendChild(style);
			}

			const ac = new AbortController();
			UichSHE.chatPickAbortController = ac;

			// Escape — listen on both documents so it always works.
			function onKey(e) {
				if (e.key !== 'Escape' || ac.signal.aborted) return;
				e.preventDefault();
				try { ac.abort(); } catch (_) {}
				UichSHE.chatPickAbortController = null;
				if (UichSHE.chatPickHoverElement && UichSHE.chatPickHoverElement.classList) {
					UichSHE.chatPickHoverElement.classList.remove('uichemy-composer-chat-pick-hover');
				}
				UichSHE.chatPickHoverElement = null;
				clearChatElementPickBridge();
				if (typeof onCancel === 'function') onCancel();
			}

			// Hover — shows purple outline as user moves over elements.
			function onPointerMove(e) {
				if (ac.signal.aborted) return;
				const rawTarget = UichSHE.getPreviewSelectionTargetFromEvent(e, containerEl);
				const targetEl  = (rawTarget && rawTarget !== containerEl) ? rawTarget : null;
				if (UichSHE.chatPickHoverElement !== targetEl) {
					if (UichSHE.chatPickHoverElement && UichSHE.chatPickHoverElement.classList) {
						UichSHE.chatPickHoverElement.classList.remove('uichemy-composer-chat-pick-hover');
					}
					UichSHE.chatPickHoverElement = targetEl;
					if (targetEl && targetEl.classList) {
						targetEl.classList.add('uichemy-composer-chat-pick-hover');
					}
				}
			}

			// Click — pick the element.
			function onPointerDown(e) {
				if (ac.signal.aborted) return;
				try { ac.abort(); } catch (_) {}
				UichSHE.chatPickAbortController = null;
				// Remove hover highlight.
				if (UichSHE.chatPickHoverElement && UichSHE.chatPickHoverElement.classList) {
					UichSHE.chatPickHoverElement.classList.remove('uichemy-composer-chat-pick-hover');
				}
				UichSHE.chatPickHoverElement = null;

				if (!containerEl.contains(e.target)) {
					clearChatElementPickBridge();
					if (typeof onCancel === 'function') onCancel();
					return;
				}
				const rawTarget = UichSHE.getPreviewSelectionTargetFromEvent(e, containerEl);
				let targetEl = rawTarget;
				if (targetEl === containerEl) {
					targetEl = UichSHE.getFirstSelectableContentElement(containerEl);
				}
				if (!targetEl || !containerEl.contains(targetEl)) {
					clearChatElementPickBridge();
					if (typeof onCancel === 'function') onCancel();
					return;
				}
				if (targetEl.tagName && UichSHE.IGNORE_TAGS.includes(targetEl.tagName.toUpperCase())) {
					clearChatElementPickBridge();
					if (typeof onCancel === 'function') onCancel();
					return;
				}
				let path = UichSHE.getPreviewElementLayerPath(targetEl, layerRootEl);
				if (!path) path = UichSHE.getPreviewElementLayerPath(targetEl, containerEl);
				const tagName = targetEl.tagName ? String(targetEl.tagName).toLowerCase() : '';
				let htmlSnippet = '';
				try { htmlSnippet = targetEl.outerHTML ? String(targetEl.outerHTML).slice(0, 8000) : ''; } catch (_) {}
				UichSHE.chatPickSelectedInfo = {
					tagName,
					selector:    selectionSelectorFromElement(targetEl),
					nthSelector: buildNthSelector(targetEl, containerEl),
					html:        htmlSnippet,
					path:        path || '',
				};
				// Apply persistent "selected" outline to the picked element.
				// Remove any outline from a previously picked element first.
				if (UichSHE.chatPickSelectedElement && UichSHE.chatPickSelectedElement !== targetEl &&
				    UichSHE.chatPickSelectedElement.classList) {
					UichSHE.chatPickSelectedElement.classList.remove('uichemy-composer-chat-pick-selected');
				}
				UichSHE.chatPickSelectedElement = targetEl;
				if (targetEl && targetEl.classList) {
					targetEl.classList.add('uichemy-composer-chat-pick-selected');
				}
				if (typeof onPick === 'function') onPick(UichSHE.chatPickSelectedInfo);
			}

			// Bind Escape to both documents.
			document.addEventListener('keydown', onKey, true);
			previewDocument.addEventListener('keydown', onKey, true);

			// Bind hover + click to the preview document (where elements actually live).
			chatPickPointerTimer = setTimeout(function () {
				chatPickPointerTimer = null;
				if (ac.signal.aborted) return;
				previewDocument.addEventListener('pointermove', onPointerMove, { capture: true, signal: ac.signal });
				previewDocument.addEventListener('pointerdown', onPointerDown, { capture: true, signal: ac.signal });
			}, 0);
		}

		window.uiChemyComposerWidget = {
			appendChatMessage,
			// Overridden by claude-chat.js while a request is in-flight to update
			// the loading bubble text with real-time progress from the agent.
			updateChatProgress( message ) {}, // eslint-disable-line no-unused-vars
			// Overridden by claude-chat.js — called whenever the user opens a
			// different UiChemy Composer widget so the chat can reload its history.
			onWidgetChange( newWidgetId ) {}, // eslint-disable-line no-unused-vars
			getChatLog() {
				return chatLog;
			},
			getHtmlCode() {
				if (UichSHE.activeWidgetSettings && typeof UichSHE.activeWidgetSettings.get === 'function') {
					const fromModel = UichSHE.activeWidgetSettings.get('raw_html');
					if (typeof fromModel === 'string') {
						return fromModel;
					}
				}
				return UichSHE.getUiChemyComposerEditorValueById('uichemy-composer-panel-html') || '';
			},
			setHtmlCode(code, notify) {
				const next = String(code || '');
				markRawHtmlChanged(next);
				UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-html', next, notify !== false);
				if (notify !== false) {
					syncDirectInputsFromSelection();
				}
			},
			applyHtmlCode(code) {
				const next = String(code || '');
				markRawHtmlChanged(next);
				UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-html', next, true);
				// If the user has a chat-picked element, auto-switch the Layers panel
				// selection to that element so the Direct panel reflects the classes /
				// styles that Claude just applied to it.
				const pickPath = UichSHE.chatPickSelectedInfo && UichSHE.chatPickSelectedInfo.path;
				if (pickPath) {
					const targetLayerId = `layer${pickPath}-el`;
					selectedLayerId = targetLayerId;
					autoExpandSelectedAncestors = true;
				}
				syncDirectInputsFromSelection();
			},
			getCssCode() {
				if (UichSHE.activeWidgetSettings && typeof UichSHE.activeWidgetSettings.get === 'function') {
					const fromModel = UichSHE.activeWidgetSettings.get('raw_css');
					if (typeof fromModel === 'string') {
						return fromModel;
					}
				}
				return UichSHE.getUiChemyComposerEditorValueById('uichemy-composer-panel-css') || '';
			},
			setCssCode(code, notify) {
				if (!UichSHE.activeWidgetSettings) {
					return;
				}
				const next = String(code || '');
				UichSHE.activeWidgetSettings.set('raw_css', next);
				markEditorDirty();
				UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-css', next, notify !== false);
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const cssInput = UichSHE.activePanelView.$el.find('[data-setting="raw_css"]');
					if (cssInput.length && cssInput.val() !== next) {
						cssInput.val(next).trigger('input').trigger('change');
					}
				}
			},
			appendAndApplyCss(newCss) {
				if (!UichSHE.activeWidgetSettings) {
					return;
				}
				const cur = String(UichSHE.activeWidgetSettings.get('raw_css') || '').trim();
				const append = String(newCss || '').trim();
				if (!append) {
					return;
				}
				const next = cur ? `${cur}\n\n${append}` : append;
				UichSHE.activeWidgetSettings.set('raw_css', next);
				markEditorDirty();
				UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-css', next, true);
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const cssInput = UichSHE.activePanelView.$el.find('[data-setting="raw_css"]');
					if (cssInput.length && cssInput.val() !== next) {
						cssInput.val(next).trigger('input').trigger('change');
					}
				}
				// Auto-switch the Layers panel to the chat-picked element so its
				// contextual classes (from the newly added CSS) are visible.
				const pickPath = UichSHE.chatPickSelectedInfo && UichSHE.chatPickSelectedInfo.path;
				if (pickPath) {
					const targetLayerId = `layer${pickPath}-el`;
					selectedLayerId = targetLayerId;
					autoExpandSelectedAncestors = true;
					syncDirectInputsFromSelection();
				}
			},
			getJsCode() {
				if (UichSHE.activeWidgetSettings && typeof UichSHE.activeWidgetSettings.get === 'function') {
					const fromModel = UichSHE.activeWidgetSettings.get('raw_js');
					if (typeof fromModel === 'string') {
						return fromModel;
					}
				}
				return UichSHE.getUiChemyComposerEditorValueById('uichemy-composer-panel-js') || '';
			},
			applyJsCode(code) {
				if (!UichSHE.activeWidgetSettings) {
					return;
				}
				const next = String(code || '');
				UichSHE.activeWidgetSettings.set('raw_js', next);
				markEditorDirty();
				UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-js', next, true);
				if (UichSHE.activePanelView && UichSHE.activePanelView.$el) {
					const jsInput = UichSHE.activePanelView.$el.find('[data-setting="raw_js"]');
					if (jsInput.length && jsInput.val() !== next) {
						jsInput.val(next).trigger('input').trigger('change');
					}
				}
			},
			getSessionId() {
				if (!chatBridgeSessionId) {
					chatBridgeSessionId = `uich-${Date.now()}-${Math.random().toString(16).slice(2)}`;
				}
				return chatBridgeSessionId;
			},
			getWidgetId() {
				// Returns the Elementor element ID for the currently open widget.
				// This is stable — same widget always returns the same ID.
				if (UichSHE.activeWidgetSettings) {
					return String(UichSHE.activeWidgetSettings.id || UichSHE.activeWidgetSettings.cid || '');
				}
				return '';
			},
			getSelectedElement() {
				return UichSHE.activePreviewSelectedElement;
			},
			getChatPickInfo() {
				return UichSHE.chatPickSelectedInfo;
			},
			getElementContext() {
				const info = UichSHE.chatPickSelectedInfo;
				if (!info) return null;
				// Collect the nearest meaningful ancestor of the picked element
				// (one level below the widget container) so AI gets focused context.
				let contextHtml = '';
				const picked    = UichSHE.chatPickSelectedElement;
				if (picked && UichSHE.activeWidgetPreviewView) {
					const widgetContainer = UichSHE.activeWidgetPreviewView.$el &&
						UichSHE.activeWidgetPreviewView.$el.find('.elementor-widget-container');
					if (widgetContainer && widgetContainer.length) {
						const containerEl = widgetContainer[0];
						// Walk up from the picked element until we hit a direct child of containerEl.
						let contextEl = picked;
						let ancestor  = picked.parentElement;
						while (ancestor && ancestor !== containerEl && ancestor.parentElement) {
							contextEl = ancestor;
							ancestor  = ancestor.parentElement;
						}
						try {
							contextHtml = contextEl !== picked
								? (String(contextEl.outerHTML || '').slice(0, 12000))
								: '';
						} catch (_) {}
					}
				}
				return { element: info, contextHtml };
			},
			applyElementUpdate(newHtml, newCss) {
				const info = UichSHE.chatPickSelectedInfo;
				if (!info || !info.nthSelector) return false;
				const picked = UichSHE.chatPickSelectedElement;
				if (!picked || !UichSHE.activeWidgetPreviewView) return false;
				const widgetContainer = UichSHE.activeWidgetPreviewView.$el &&
					UichSHE.activeWidgetPreviewView.$el.find('.elementor-widget-container');
				if (!widgetContainer || !widgetContainer.length) return false;
				const containerEl = widgetContainer[0];
				try {
					// Locate the element precisely via its recorded nthSelector.
					const targetEl = containerEl.querySelector(info.nthSelector);
					if (!targetEl) return false;
					// Replace outerHTML in the live DOM.
					const tmp = containerEl.ownerDocument.createElement('div');
					tmp.innerHTML = newHtml;
					const replacement = tmp.firstElementChild;
					if (replacement) {
						targetEl.replaceWith(replacement);
						UichSHE.chatPickSelectedElement = replacement;
					} else {
						targetEl.outerHTML = newHtml;
						UichSHE.chatPickSelectedElement = null;
					}
					// Read back the full container HTML and push it into the editor.
					const updatedHtml = containerEl.innerHTML;
					const next        = String(updatedHtml || '');
					markRawHtmlChanged(next);
					UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-html', next, true);
					const pickPath = info.path;
					if (pickPath) {
						selectedLayerId            = `layer${pickPath}-el`;
						autoExpandSelectedAncestors = true;
					}
					syncDirectInputsFromSelection();
					// Append CSS if provided.
					if (newCss && typeof newCss === 'string' && newCss.trim()) {
						const cur    = String(UichSHE.activeWidgetSettings &&
							UichSHE.activeWidgetSettings.get('raw_css') || '').trim();
						const append = newCss.trim();
						const merged = cur ? `${cur}\n\n${append}` : append;
						if (UichSHE.activeWidgetSettings) {
							UichSHE.activeWidgetSettings.set('raw_css', merged);
							markEditorDirty();
							UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-panel-css', merged, true);
						}
					}
					return true;
				} catch (_) { return false; }
			},
			clearChatElementPick: clearChatElementPickBridge,
			startChatElementPick: startChatElementPickBridge,
			getSelectedTagName() {
				const hit = findResolvedMutationNodeForBridge();
				const probe = hit ? getTypographyTargetNode(hit.node) : null;
				if (probe && probe.tagName) {
					return String(probe.tagName).toLowerCase();
				}
				const el = UichSHE.activePreviewSelectedElement;
				if (el) {
					const t = getTypographyTargetNode(el);
					return t && t.tagName ? String(t.tagName).toLowerCase() : '';
				}
				return '';
			},
			getSelectedAttribute(name) {
				const hit = findResolvedMutationNodeForBridge();
				if (!hit || !hit.node) {
					return '';
				}
				let target = getTypographyTargetNode(hit.node) || hit.node;
				if (target.nodeType !== Node.ELEMENT_NODE) {
					target = target.parentElement;
				}
				if (!target || !target.getAttribute) {
					return '';
				}
				return target.getAttribute(name) || '';
			},
			setSelectedAttribute(name, val) {
				const hit = findResolvedMutationNodeForBridge();
				if (!hit || !hit.node) {
					return false;
				}
				let target = getTypographyTargetNode(hit.node) || hit.node;
				if (target.nodeType !== Node.ELEMENT_NODE) {
					target = target.parentElement;
				}
				if (!target || !target.setAttribute) {
					return false;
				}
				const attrName = String(name || '');
				if (!attrName) {
					return false;
				}
				if (val === null || val === undefined || String(val) === '') {
					target.removeAttribute(attrName);
				} else {
					target.setAttribute(attrName, String(val));
				}
				commitBridgeRawMutation(hit.doc);
				return true;
			},
			setSelectedTextContent(value) {
				const hit = findResolvedMutationNodeForBridge();
				if (!hit || !hit.node) {
					return false;
				}
				const node = hit.node;
				let nextValue = String(value != null ? value : '');
				const tEl = getTypographyTargetNode(node);
				if (UichSHE.getTagNameUpper(tEl) === 'SVG') {
					return false;
				}
				if (tEl && tEl.nodeType === Node.TEXT_NODE) {
					if (nextValue.trim() === '') {
						nextValue = '\u200B';
					}
					tEl.nodeValue = nextValue;
				} else if (tEl && tEl.nodeType === Node.ELEMENT_NODE) {
					tEl.textContent = nextValue;
				} else {
					return false;
				}
				commitBridgeRawMutation(hit.doc);
				return true;
			},
			applySelectedStyleMap(styleMap) {
				if (!styleMap || typeof styleMap !== 'object') {
					return false;
				}
				const hit = findResolvedMutationNodeForBridge();
				if (!hit || !hit.node) {
					return false;
				}
				const targetEl = getTypographyTargetNode(hit.node);
				if (!targetEl || targetEl.nodeType !== Node.ELEMENT_NODE) {
					return false;
				}
				applyTypographyStyleMapToTarget(targetEl, styleMap);
				commitBridgeRawMutation(hit.doc);
				return true;
			}
		};

		// ── WebSocket client — DISABLED (superseded by React composer's _wsMgr) ──
		// The new React composer (composer/src/composer-chat.jsx) owns the WS
		// connection via the _wsMgr singleton and registers stable `widget-{id}`
		// sessions. This legacy IIFE used to create a SECOND WS connection with
		// random `uich-*` session IDs and only handled the old GET_HTML / GET_CSS /
		// GET_JS message types — not the new unified GET_WIDGET_CODE /
		// GET_PAGE_WIDGETS / GET_GLOBALS_CSS, so when the agent picked it (because its
		// 25s PING bumped lastSeen above the React session), new tool calls
		// silently dropped → 10s timeout. Early-return keeps the legacy block
		// in source for reference but skips all execution.
		( function initEditorWebSocket() {
			return; // ← disabled: see comment above

			const WS_URL  = 'ws://127.0.0.1:3131/ws';
			const PING_MS = 25000;
			let   ws        = null;
			let   pingTimer = null;

			// Ensure the session ID is generated before first connect so that
			// bridge.getSessionId() and the REGISTER message use the same value.
			if ( !chatBridgeSessionId ) {
				chatBridgeSessionId = 'uich-' + Date.now() + '-' + Math.random().toString(16).slice(2);
			}
			const sessionId = chatBridgeSessionId;

			function getPageTitle() {
				try { return document.title || 'Elementor Editor'; } catch (_) { return 'Elementor Editor'; }
			}

			function wsSend( obj ) {
				if ( ws && ws.readyState === WebSocket.OPEN ) {
					ws.send( JSON.stringify( obj ) );
				}
			}

			function connect() {
				try { ws = new WebSocket( WS_URL ); } catch (_) { setTimeout( connect, 3000 ); return; }

				ws.onopen = function () {
					const widgetId = UichSHE.activeWidgetSettings
						? String( UichSHE.activeWidgetSettings.id || UichSHE.activeWidgetSettings.cid || '' )
						: '';
					wsSend( { type: 'REGISTER', sessionId, widgetId, pageTitle: getPageTitle() } );
					clearInterval( pingTimer );
					pingTimer = setInterval( function () { wsSend( { type: 'PING', sessionId } ); }, PING_MS );
				};

				ws.onmessage = function ( evt ) {
					let msg;
					try { msg = JSON.parse( evt.data ); } catch (_) { return; }
					const bridge = window.uiChemyComposerWidget;
					if ( !bridge ) return;

					if ( msg.type === 'GET_HTML' ) {
						const html = typeof bridge.getHtmlCode === 'function' ? bridge.getHtmlCode() : '';
						wsSend( { type: 'RESPONSE', requestId: msg.requestId, data: html } );
						return;
					}
					if ( msg.type === 'GET_CSS' ) {
						const css = typeof bridge.getCssCode === 'function' ? bridge.getCssCode() : '';
						wsSend( { type: 'RESPONSE', requestId: msg.requestId, data: css } );
						return;
					}
					if ( msg.type === 'GET_SELECTED' ) {
						const info = typeof bridge.getChatPickInfo === 'function' ? bridge.getChatPickInfo() : null;
						wsSend( { type: 'RESPONSE', requestId: msg.requestId, data: info || null } );
						return;
					}
					if ( msg.type === 'APPLY_HTML' && typeof msg.html === 'string' ) {
						if ( typeof bridge.applyHtmlCode === 'function' ) bridge.applyHtmlCode( msg.html );
						wsSend( { type: 'RESPONSE', requestId: msg.requestId, data: 'ok' } );
						return;
					}
					if ( msg.type === 'APPLY_CSS' && typeof msg.css === 'string' ) {
						if ( typeof bridge.appendAndApplyCss === 'function' ) bridge.appendAndApplyCss( msg.css );
						wsSend( { type: 'RESPONSE', requestId: msg.requestId, data: 'ok' } );
						return;
					}
					if ( msg.type === 'GET_JS' ) {
						const js = typeof bridge.getJsCode === 'function' ? bridge.getJsCode() : '';
						wsSend( { type: 'RESPONSE', requestId: msg.requestId, data: js } );
						return;
					}
					if ( msg.type === 'APPLY_JS' && typeof msg.js === 'string' ) {
						if ( typeof bridge.applyJsCode === 'function' ) bridge.applyJsCode( msg.js );
						wsSend( { type: 'RESPONSE', requestId: msg.requestId, data: 'ok' } );
						return;
					}
					// Real-time progress event — Claude calling a tool or writing text.
					// Pass the full event object so the chat UI can distinguish
					// tool steps from streaming text.
					if ( msg.type === 'PROGRESS' ) {
						if ( typeof bridge.updateChatProgress === 'function' ) {
							bridge.updateChatProgress( msg );
						}
						return;
					}

				// Model discovery completed in the background — push the real
				// list so the dropdown updates without a page refresh.
				if ( msg.type === 'MODELS_UPDATED' && Array.isArray( msg.models ) ) {
					if ( typeof bridge.onModelsUpdated === 'function' ) {
						bridge.onModelsUpdated( msg.models, msg.installed );
					}
					return;
				}

				// Codex model discovery — push OpenAI models to the provider selector.
				if ( msg.type === 'CODEX_MODELS_UPDATED' && Array.isArray( msg.models ) ) {
					if ( typeof bridge.onCodexModelsUpdated === 'function' ) {
						bridge.onCodexModelsUpdated( msg.models, msg.installed );
					}
					return;
				}

				// Gemini model discovery — push Google models to the provider selector.
				if ( msg.type === 'GEMINI_MODELS_UPDATED' && Array.isArray( msg.models ) ) {
					if ( typeof bridge.onGeminiModelsUpdated === 'function' ) {
						bridge.onGeminiModelsUpdated( msg.models, msg.installed );
					}
					return;
				}

				// OpenCode model push — passes the full payload so the chat
				// layer can read `authed` (list of configured providers) too.
				if ( msg.type === 'OPENCODE_MODELS_UPDATED' && Array.isArray( msg.models ) ) {
					if ( typeof bridge.onOpenCodeModelsUpdated === 'function' ) {
						bridge.onOpenCodeModelsUpdated( msg.models, msg.authed || [], msg.installed );
					}
					return;
				}
				};

				ws.onclose = function () { clearInterval( pingTimer ); setTimeout( connect, 3000 ); };
				ws.onerror = function () { /* onclose handles reconnect */ };
			}

			connect();
		} )();
		// ── End WebSocket client ──────────────────────────────────────────────────

		if (chatSend) {
			chatSend.addEventListener('click', function (e) {
				e.stopPropagation();
				const text = chatInput && chatInput.value ? chatInput.value.trim() : '';
				if (!text || isChatSyncing) return;
				isChatSyncing = true;
				const bridge = window.uiChemyComposerWidget;
				if (bridge && typeof bridge.onChatSend === 'function') {
					bridge.onChatSend(text, null, {
						autoApply: true,
						onDone() {
							isChatSyncing = false;
						}
					});
				} else {
					appendChatMessage('user', text);
					appendChatMessage('assistant', 'Chat bridge is not ready yet. Wait a moment and try again, or reload the Elementor editor.');
					isChatSyncing = false;
				}
				if (chatInput) {
					chatInput.value = '';
				}
			});
		}

		if (chatClear) {
			chatClear.addEventListener('click', function (e) {
				e.stopPropagation();
				if (!chatLog) return;
				chatLog.innerHTML = '';
				appendChatMessage('system', 'Chat history cleared.');
			});
		}

		if (chatInput) {
			chatInput.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					if (chatSend) chatSend.click();
				}
			});
		}
		if (resizer) {
			let isResizingPanel = false;
			let resizeStartY = 0;
			let resizeStartHeight = 0;

			function onPointerMove(moveEvent) {
				if (!isResizingPanel) return;
				const minHeight = 48;
				const maxHeight = Math.round(window.innerHeight * 0.85);
				const delta = resizeStartY - moveEvent.clientY;
				const nextHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartHeight + delta));
				panel.style.height = `${nextHeight}px`;
			}

			function stopResize() {
				isResizingPanel = false;
				document.removeEventListener('pointermove', onPointerMove);
				document.removeEventListener('pointerup', stopResize);
				document.removeEventListener('pointercancel', stopResize);
			}

			resizer.addEventListener('pointerdown', function (e) {
				e.preventDefault();
				e.stopPropagation();
				isResizingPanel = true;
				resizeStartY = e.clientY;
				resizeStartHeight = panel.getBoundingClientRect().height;
				try {
					resizer.setPointerCapture(e.pointerId);
				} catch (err) {
					// Ignore capture failures and continue with document listeners.
				}
				document.addEventListener('pointermove', onPointerMove);
				document.addEventListener('pointerup', stopResize);
				document.addEventListener('pointercancel', stopResize);
			});
		}
		if (hoverToggleBtn) {
			hoverToggleBtn.addEventListener('click', function (e) {
				e.stopPropagation();
				UichSHE.setPreviewSelectionEnabled(!UichSHE.activePreviewSelectionEnabled);
				if (UichSHE.activePreviewSelectionEnabled) {
					UichSHE.bindUiChemyComposerPreviewSelectionHandlers(UichSHE.activeWidgetPreviewView);
				}
			});
		}
		if (header && toggleBtn) {
			header.addEventListener('click', function (e) {
				if (e.target.tagName === 'BUTTON') return; // let toggle handle itself if clicked directly
				const svgDown = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
				const svgUp = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';

				if (panel.classList.contains('minimized')) {
					panel.classList.remove('minimized');
					toggleBtn.innerHTML = svgDown;
					if (activeTab === 'code') {
						requestAnimationFrame(() => {
							UichSHE.refreshUiChemyComposerCodeEditors();
						});
					}
				} else {
					panel.classList.add('minimized');
					toggleBtn.innerHTML = svgUp;
				}
			});
			toggleBtn.addEventListener('click', function (e) {
				e.stopPropagation(); // prevent header click
				const svgDown = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
				const svgUp = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';

				if (panel.classList.contains('minimized')) {
					panel.classList.remove('minimized');
					toggleBtn.innerHTML = svgDown;
					if (activeTab === 'code') {
						requestAnimationFrame(() => {
							UichSHE.refreshUiChemyComposerCodeEditors();
						});
					}
				} else {
					panel.classList.add('minimized');
					toggleBtn.innerHTML = svgUp;
				}
			});
		}

		// Copy functionality
		panel.querySelectorAll('.copy-btn').forEach(btn => {
			btn.addEventListener('click', function (e) {
				e.stopPropagation();
				const targetId = this.getAttribute('data-target');
				const code = UichSHE.getUiChemyComposerEditorValueById(targetId);
				if (typeof code === 'string' && code.length) {
					const onCopied = () => {
						const originalText = this.textContent;
						this.textContent = 'Copied!';
						setTimeout(() => this.textContent = originalText, 2000);
					};
					if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
						navigator.clipboard.writeText(code).then(onCopied).catch(() => {
							const temp = document.createElement('textarea');
							temp.value = code;
							temp.setAttribute('readonly', 'readonly');
							temp.style.position = 'fixed';
							temp.style.opacity = '0';
							document.body.appendChild(temp);
							temp.select();
							document.execCommand('copy');
							temp.remove();
							onCopied();
						});
					} else {
						const temp = document.createElement('textarea');
						temp.value = code;
						temp.setAttribute('readonly', 'readonly');
						temp.style.position = 'fixed';
						temp.style.opacity = '0';
						document.body.appendChild(temp);
						temp.select();
						document.execCommand('copy');
						temp.remove();
						onCopied();
					}
				}
			});
		});

		// Format functionality (Basic)
		panel.querySelectorAll('.format-btn').forEach(btn => {
			btn.addEventListener('click', function (e) {
				e.stopPropagation();
				const targetId = this.getAttribute('data-target');
				const currentCode = UichSHE.getUiChemyComposerEditorValueById(targetId);
				if (!currentCode) return;

				let code = currentCode;
				let formatted = '';
				let indentLevel = 0;
				const tab = '  ';

				if (targetId === 'uichemy-composer-panel-html') {
					code = code.replace(/>\s*</g, '><');
					code.split(/(<[^>]+>)/g).forEach(function (node) {
						if (!node.trim()) return;
						let isEndTag = node.match(/^<\//);
						let isSelfClosing = node.match(/\/>$/) || node.match(/^<(img|hr|br|meta|link|input|area|base|col|command|embed|keygen|param|source|track|wbr)/);
						let isStartTag = node.match(/^<[^?\/!]/) && !isSelfClosing;
						if (isEndTag) indentLevel--;
						formatted += '\n' + tab.repeat(Math.max(0, indentLevel)) + node;
						if (isStartTag) indentLevel++;
					});
					formatted = formatted.trim();
				} else {
					// CSS and JS basic formatter
					code = code.replace(/\s+/g, ' ').replace(/ ?\{ ?/g, '{').replace(/ ?\} ?/g, '}').replace(/ ?; ?/g, ';');
					let inString = false;
					let stringChar = '';
					for (let i = 0; i < code.length; i++) {
						let char = code[i];
						if ((char === "'" || char === '"' || char === '\`') && code[i - 1] !== '\\') {
							if (!inString) { inString = true; stringChar = char; }
							else if (stringChar === char) { inString = false; }
						}

						if (!inString && char === '{') {
							indentLevel++;
							formatted += ' {\n' + tab.repeat(indentLevel);
						} else if (!inString && char === '}') {
							indentLevel--;
							formatted += '\n' + tab.repeat(Math.max(0, indentLevel)) + '}\n' + tab.repeat(Math.max(0, indentLevel));
						} else if (!inString && char === ';') {
							formatted += ';\n' + tab.repeat(Math.max(0, indentLevel));
						} else {
							formatted += char;
						}
					}
					formatted = formatted.replace(/\n\s*\n/g, '\n').trim();
				}

				if (UichSHE.normalizeUiChemyComposerLineEndings(formatted) === UichSHE.normalizeUiChemyComposerLineEndings(currentCode).trim()) {
					return;
				}

				UichSHE.setUiChemyComposerEditorValueById(targetId, formatted, true);
			});
		});

		function focusDirectLayerByPath(layerPath) {
			if (!UichSHE.activeWidgetSettings || !layerPath) return false;
			// Preview picks run while a Direct Editor control may still be document.activeElement.
			// setInputValuePreserveActiveTyping skips updates for the focused field — blur first so the full panel refreshes.
			const activeEl = document.activeElement;
			if (activeEl && typeof activeEl.blur === 'function' && panel && panel.contains(activeEl)) {
				activeEl.blur();
			}
			UichSHE.uiChemyComposerDebugLog('focusDirectLayerByPath:start', { layerPath });
			const rawHtml = UichSHE.activeWidgetSettings.get('raw_html') || '';
			const doc = document.createElement('div');
			doc.innerHTML = rawHtml;
			const slotNodes = UichSHE.extractTextNodes(doc);
			const layerRoot = UichSHE.getLayerRoot(doc);
			const layerEntries = UichSHE.extractLayerEntries(layerRoot, slotNodes);
			UichSHE.uiChemyComposerDebugLog('focusDirectLayerByPath:layerEntries', {
				count: layerEntries.length,
				slotCount: slotNodes.length
			});
			const layerPathMap = new Map();
			layerEntries.forEach((entry) => {
				if (entry && entry.path && !layerPathMap.has(entry.path)) {
					layerPathMap.set(entry.path, entry);
				}
			});

			let nextLayer = null;
			const candidates = UichSHE.getLayerPathCandidates(layerPath);
			UichSHE.uiChemyComposerDebugLog('focusDirectLayerByPath:candidates', candidates);
			for (let i = 0; i < candidates.length; i++) {
				nextLayer = layerPathMap.get(candidates[i]) || null;
				if (nextLayer) {
					break;
				}
			}
			if (!nextLayer) {
				UichSHE.uiChemyComposerDebugWarn('focusDirectLayerByPath:no-match', {
					inputPath: layerPath,
					candidates,
					availableLayerPathsSample: layerEntries.slice(0, 40).map((entry) => entry.path)
				});
				return false;
			}

			UichSHE.uiChemyComposerDebugLog('focusDirectLayerByPath:matched', {
				selectedLayerId: nextLayer.id,
				matchedPath: nextLayer.path,
				slotIndex: nextLayer.slotIndex
			});

			selectedLayerId = nextLayer.id;
			if (typeof nextLayer.slotIndex === 'number') {
				selectedSlotIndex = nextLayer.slotIndex;
			}
			autoExpandSelectedAncestors = true;
			// Match in-panel layer row behavior: clear class-chip scope so classes/typography reflect the new node.
			selectedAppliedClassToken = '';
			selectedAppliedClassSelector = '';
			selectedAppliedClassMediaText = '';
			selectedAppliedClassBreakpointKey = '';
			setActiveTab('direct');
			syncDirectInputsFromSelection();
			if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
				window.requestAnimationFrame(function () {
					const activeBtn = directList && directList.querySelector('.uichemy-composer-direct-item.is-active');
					if (activeBtn && typeof activeBtn.scrollIntoView === 'function') {
						try {
							activeBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
						} catch (err) {
							activeBtn.scrollIntoView();
						}
					}
				});
			}
			return true;
		}

		// REST kit items omit `group`; filtered extras (v4, etc.) set `group`. Live kit rows use `kit-live`.
		// Nexter-style theme palette rows use ids like `nxt-global1` inside the kit repeater.
		function uiChemyComposerShouldSkipGlobalItem(item) {
			if (!item) {
				return true;
			}
			const g = item.group;
			if (g && g !== 'kit-live') {
				return true;
			}
			const id = String(item.id || '').trim();
			if (/^nxt-global/i.test(id)) {
				return true;
			}
			return false;
		}

		function uiChemyComposerCollectV3TypographyTitles(typographyMap) {
			const names = [];
			Object.values(typographyMap || {}).forEach((item) => {
				if (!item || uiChemyComposerShouldSkipGlobalItem(item)) {
					return;
				}
				const t = String(item.title || '').trim();
				if (t) {
					names.push(t);
				}
			});
			return names.sort((a, b) => a.localeCompare(b));
		}

		function uiChemyComposerBuildV3TypographyLookup(typographyMap) {
			const byTitle = Object.create(null);
			Object.values(typographyMap || {}).forEach((item) => {
				if (!item || uiChemyComposerShouldSkipGlobalItem(item)) {
					return;
				}
				const title = String(item.title || '').trim();
				if (!title || byTitle[title]) {
					return;
				}
				byTitle[title] = item.value || {};
			});
			return byTitle;
		}

		function uiChemyComposerGlobalsDocPropertyKey(label) {
			const s = String(label || '').trim() || 'Untitled';
			if (/^[a-zA-Z_$][\w$]*$/.test(s)) {
				return s;
			}
			return JSON.stringify(s);
		}

		function uiChemyComposerGlobalsDisplayNamesForItems(items) {
			const titleUseCount = new Map();
			return items.map((item) => {
				const base = String(item.title || '').trim() || 'Untitled';
				const n = (titleUseCount.get(base) || 0) + 1;
				titleUseCount.set(base, n);
				const label = n === 1 ? base : `${base} (${n})`;
				return { item, label };
			});
		}

		function uiChemyComposerBuildGlobalsDocText(colorsMap, typographyMap, options) {
			const opts = options || {};
			const useTypographyVars = opts.useTypographyVars !== false;
			const includeRootWrappers = opts.includeRootWrappers !== false;
			const includeColorVariables = opts.includeColorVariables !== false;
			const includeAtomicVariables = opts.includeAtomicVariables !== false;
			const mergeAtomicVariablesIntoRoot = !!opts.mergeAtomicVariablesIntoRoot;
			const atomicSnapshot = opts.atomicSnapshot || { variables: [], classes: [] };
			const preferredGlobalIds = ['primary', 'secondary', 'text', 'accent'];
			const colorItems = Object.values(colorsMap || {})
				.filter((item) => item && !uiChemyComposerShouldSkipGlobalItem(item))
				.sort((a, b) => {
					const aId = String(a.id || '');
					const bId = String(b.id || '');
					const aPref = preferredGlobalIds.indexOf(aId);
					const bPref = preferredGlobalIds.indexOf(bId);
					if (aPref !== -1 || bPref !== -1) {
						if (aPref === -1) return 1;
						if (bPref === -1) return -1;
						return aPref - bPref;
					}
					const ta = String(a.title || '').localeCompare(String(b.title || ''));
					if (ta !== 0) {
						return ta;
					}
					return aId.localeCompare(bId);
				});

			const typoItems = Object.values(typographyMap || {})
				.filter((item) => item && !uiChemyComposerShouldSkipGlobalItem(item))
				.sort((a, b) => {
					const aId = String(a.id || '');
					const bId = String(b.id || '');
					const aPref = preferredGlobalIds.indexOf(aId);
					const bPref = preferredGlobalIds.indexOf(bId);
					if (aPref !== -1 || bPref !== -1) {
						if (aPref === -1) return 1;
						if (bPref === -1) return -1;
						return aPref - bPref;
					}
					const ta = String(a.title || '').localeCompare(String(b.title || ''));
					if (ta !== 0) {
						return ta;
					}
					return aId.localeCompare(bId);
				});

			const rootLines = [];
			if (includeColorVariables) {
				colorItems.forEach((item, idx) => {
					const id = String(item.id || '').trim();
					if (!id) {
						return;
					}
					const value = String(item.value || '').trim();
					if (!value) {
						return;
					}
					const title = String(item.title || '').trim();
					const isPreferred = preferredGlobalIds.indexOf(id) !== -1;
					if (title && !isPreferred) {
						if (idx > 0) {
							rootLines.push('');
						}
						rootLines.push(`    /* ${title} */`);
					}
					rootLines.push(`    --e-global-color-${id}: ${value};`);
				});
			}

			const typographyPropertyBuilders = [
				{ css: 'font-family', key: (v) => String(v.typography_font_family || '').trim() },
				{ css: 'font-size', key: (v) => normalizeTypographyPresetLength(v.typography_font_size, v.typography_font_size_unit) },
				{ css: 'font-weight', key: (v) => String(v.typography_font_weight || '').trim() },
				{ css: 'line-height', key: (v) => normalizeTypographyPresetLength(v.typography_line_height, v.typography_line_height_unit) },
				{ css: 'letter-spacing', key: (v) => normalizeTypographyPresetLength(v.typography_letter_spacing, v.typography_letter_spacing_unit) },
				{ css: 'text-transform', key: (v) => String(v.typography_text_transform || '').trim() },
				{ css: 'text-decoration', key: (v) => String(v.typography_text_decoration || '').trim() },
				{ css: 'font-style', key: (v) => String(v.typography_font_style || '').trim() },
			];

			const typographyBlocks = [];
			typoItems.forEach((item) => {
				const id = String(item.id || '').trim();
				if (!id) {
					return;
				}
				const value = item.value && typeof item.value === 'object' ? item.value : {};
				const propertyLines = typographyPropertyBuilders
					.map((entry) => {
						const cssValue = entry.key(value);
						if (!cssValue) {
							return '';
						}
						if (useTypographyVars) {
							const varName = `--e-global-typography-${id}-${entry.css}`;
							return `    ${entry.css}: var(${varName});`;
						}
						return `    ${entry.css}: ${cssValue};`;
					})
					.filter(Boolean);
				if (!propertyLines.length) {
					return;
				}

				const title = String(item.title || '').trim();
				if (title) {
					typographyBlocks.push(`/* ${title} */`);
				}
				typographyBlocks.push(`.text-${id} {`);
				typographyBlocks.push(...propertyLines);
				typographyBlocks.push('}');
			});

			const out = [];
			if (includeRootWrappers) {
				out.push(':root {');
				if (rootLines.length) {
					out.push(...rootLines);
				}
				const atomicVariables = Array.isArray(atomicSnapshot.variables) ? atomicSnapshot.variables : [];
				if (mergeAtomicVariablesIntoRoot && includeAtomicVariables && atomicVariables.length) {
					atomicVariables.forEach((variable) => {
						const varName = String(variable.varName || '').trim();
						const value = variable && variable.value !== undefined && variable.value !== null ? String(variable.value) : '';
						const title = String(variable.label || '').trim();
						if (!varName || !value) {
							return;
						}
						if (title) {
							out.push(`    /* ${title} */`);
						}
						out.push(`    ${varName}: ${value};`);
					});
				}
				out.push('}');
			} else if (rootLines.length) {
				out.push(...rootLines.map((line) => line.replace(/^\s{4}/, '')));
			}

			if (typographyBlocks.length) {
				out.push('');
				out.push(...typographyBlocks.reduce((acc, line, idx) => {
					if (idx > 0 && line.startsWith('/* ')) {
						acc.push('');
					}
					acc.push(line);
					return acc;
				}, []));
			}

			const atomicVariables = Array.isArray(atomicSnapshot.variables) ? atomicSnapshot.variables : [];
			const atomicClasses = Array.isArray(atomicSnapshot.classes) ? atomicSnapshot.classes : [];
			if (atomicVariables.length || atomicClasses.length) {
				out.push('');
				out.push('/* Elementor Atomic */');
				if (atomicVariables.length && includeAtomicVariables && !mergeAtomicVariablesIntoRoot) {
					if (includeRootWrappers) {
						out.push(':root {');
						atomicVariables.forEach((variable) => {
							const varName = String(variable.varName || '').trim();
							const value = variable && variable.value !== undefined && variable.value !== null ? String(variable.value) : '';
							const title = String(variable.label || '').trim();
							if (!varName || !value) {
								return;
							}
							if (title) {
								out.push(`    /* ${title} */`);
							}
							out.push(`    ${varName}: ${value};`);
						});
						out.push('}');
					} else {
						atomicVariables.forEach((variable) => {
							const varName = String(variable.varName || '').trim();
							const value = variable && variable.value !== undefined && variable.value !== null ? String(variable.value) : '';
							const title = String(variable.label || '').trim();
							if (!varName || !value) {
								return;
							}
							if (title) {
								out.push(`/* ${title} */`);
							}
							out.push(`${varName}: ${value};`);
						});
					}
				}
				if (atomicClasses.length) {
					atomicClasses.forEach((item) => {
						const token = sanitizeNewClassToken(item && item.label ? item.label : '');
						if (!token) {
							return;
						}
						const styleMap = (directAtomicClassByToken[token.toLowerCase()] && directAtomicClassByToken[token.toLowerCase()].styleMap) || {};
						const rows = typographyPresetStyleProperties
							.map((property) => {
								const value = String(styleMap[property] || '').trim();
								return value ? `    ${property}: ${value};` : '';
							})
							.filter(Boolean);
						if (!rows.length) {
							return;
						}
						out.push('');
						out.push(`/* ${String(item.label || token)} */`);
						out.push(`${classTokenToTypographyRuleSelector(token)} {`);
						out.push(...rows);
						out.push('}');
					});
				}
			}

			return `${out.join('\n')}\n`;
		}

		function uiChemyComposerInvalidateGlobalsIndexCache() {
			try {
				const globalsComponent = $e.components.get('globals');
				if (globalsComponent && $e.data && typeof $e.data.deleteCache === 'function') {
					$e.data.deleteCache(globalsComponent, 'globals/index');
				}
			} catch (e) {
				// Elementor internals may differ across versions; ignore.
			}
		}

		function uiChemyComposerFetchGlobalsIndexFresh() {
			uiChemyComposerInvalidateGlobalsIndexCache();
			if (!$e || !$e.data || typeof $e.data.get !== 'function') {
				return Promise.resolve({});
			}
			return $e.data.get('globals/index').then((response) => {
				if (response && response.data) {
					return response.data;
				}
				return {};
			});
		}

		function uiChemyComposerGetRestApiBaseUrl() {
			try {
				if (window.wpApiSettings && window.wpApiSettings.root) {
					return String(window.wpApiSettings.root).replace(/\/+$/, '');
				}
			} catch (e) {
				// ignore
			}
			return `${window.location.origin}/wp-json`;
		}

		function uiChemyComposerGetRestNonce() {
			try {
				if (window.wpApiSettings && window.wpApiSettings.nonce) {
					return String(window.wpApiSettings.nonce);
				}
			} catch (e) {
				// ignore
			}
			return '';
		}

		function uiChemyComposerFetchAtomicSnapshot() {
			const base = uiChemyComposerGetRestApiBaseUrl();
			const nonce = uiChemyComposerGetRestNonce();
			const headers = nonce ? { 'X-WP-Nonce': nonce } : {};
			const req = (url) => {
				return fetch(url, {
					method: 'GET',
					credentials: 'same-origin',
					headers,
				}).then((resp) => {
					if (!resp.ok) {
						throw new Error(`Atomic endpoint failed: ${resp.status}`);
					}
					return resp.json();
				});
			};

			const variablesUrl = `${base}/elementor/v1/variables/list`;
			const classesUrl = `${base}/elementor/v1/global-classes?context=preview`;

			return Promise.all([
				req(variablesUrl).catch(() => ({})),
				req(classesUrl).catch(() => ({})),
			]).then(([varsResp, classesResp]) => {
				const varsObj = (varsResp && varsResp.data && varsResp.data.variables && typeof varsResp.data.variables === 'object')
					? varsResp.data.variables
					: {};
				const itemsObj = (classesResp && classesResp.data && typeof classesResp.data === 'object') ? classesResp.data : {};
				const orderArr = (classesResp && classesResp.meta && Array.isArray(classesResp.meta.order)) ? classesResp.meta.order : Object.keys(itemsObj);

				const variables = Object.keys(varsObj).map((id) => {
					const row = varsObj[id] || {};
					const label = String(row.label || id).trim();
					const value = uiChemyComposerResolveAtomicCssValue(row.value);
					const type = String(row.type || '').trim();
					const isDeleted = !!row.deleted_at || !!row.deleted;
					return {
						id: String(id || '').trim(),
						type,
						label,
						value,
						sync_to_v3: !!row.sync_to_v3,
						isDeleted,
						varName: label ? `--${label.replace(/^\-+/, '')}` : '',
					};
				}).filter((item) => item.id && !item.isDeleted);

				const classes = orderArr
					.map((id) => itemsObj[id])
					.filter(Boolean)
					.map((item) => {
						const variants = Array.isArray(item.variants) ? item.variants : [];
						return {
							id: String(item.id || '').trim(),
							label: String(item.label || item.id || '').trim(),
							type: String(item.type || '').trim(),
							sync_to_v3: !!item.sync_to_v3,
							variants,
						};
					})
					.filter((item) => item.id && item.label);

				return { variables, classes };
			});
		}

		function uiChemyComposerResolveAtomicCssValue(raw) {
			if (raw === undefined || raw === null) {
				return '';
			}
			if (typeof raw === 'string') {
				return raw.trim();
			}
			if (typeof raw === 'number') {
				return String(raw);
			}
			if (Array.isArray(raw)) {
				const joined = raw.map((entry) => uiChemyComposerResolveAtomicCssValue(entry)).filter(Boolean).join(' ');
				return joined.trim();
			}
			if (typeof raw === 'object') {
				if (raw.$$type === 'variable' && raw.value !== undefined && raw.value !== null) {
					const variableName = String(raw.value).trim().replace(/^\-+/, '');
					return variableName ? `var(--${variableName})` : '';
				}
				if (raw.value !== undefined && raw.value !== null) {
					const nested = uiChemyComposerResolveAtomicCssValue(raw.value);
					const unit = raw.unit !== undefined && raw.unit !== null ? String(raw.unit).trim() : '';
					if (nested && unit && /^-?\d+(\.\d+)?$/.test(nested)) {
						return `${nested}${unit}`;
					}
					if (nested) {
						return nested;
					}
				}
				if (raw.color !== undefined && raw.color !== null) {
					return uiChemyComposerResolveAtomicCssValue(raw.color);
				}
				if (raw.size !== undefined && raw.size !== null) {
					const size = uiChemyComposerResolveAtomicCssValue(raw.size);
					const unit = raw.unit !== undefined && raw.unit !== null ? String(raw.unit).trim() : '';
					if (size && unit && /^-?\d+(\.\d+)?$/.test(size)) {
						return `${size}${unit}`;
					}
					return size;
				}
			}
			return '';
		}

		function ensureAtomicSnapshotCache() {
			if ((UichSHE.uiChemyComposerAtomicSnapshot.variables && UichSHE.uiChemyComposerAtomicSnapshot.variables.length)
				|| (UichSHE.uiChemyComposerAtomicSnapshot.classes && UichSHE.uiChemyComposerAtomicSnapshot.classes.length)) {
				return Promise.resolve(UichSHE.uiChemyComposerAtomicSnapshot);
			}
			return uiChemyComposerFetchAtomicSnapshot()
				.then((snapshot) => {
					UichSHE.uiChemyComposerAtomicSnapshot = snapshot || { variables: [], classes: [] };
					rebuildDirectAtomicCaches(UichSHE.uiChemyComposerAtomicSnapshot);
					return UichSHE.uiChemyComposerAtomicSnapshot;
				})
				.catch(() => UichSHE.uiChemyComposerAtomicSnapshot);
		}

		function uiChemyComposerBuildGlobalsMapsFromKitAttrs(attrs) {
			if (!attrs) {
				return null;
			}
			const colors = {};
			const typography = {};

			const pushColors = (rows) => {
				if (!Array.isArray(rows)) {
					return;
				}
				rows.forEach((row) => {
					if (!row || !row._id) {
						return;
					}
					colors[row._id] = {
						id: row._id,
						title: row.title || '',
						value: row.color || '',
						group: 'kit-live',
					};
				});
			};

			const pushTypography = (rows) => {
				if (!Array.isArray(rows)) {
					return;
				}
				rows.forEach((row) => {
					if (!row || !row._id) {
						return;
					}
					const value = {};
					Object.keys(row).forEach((key) => {
						if (key === '_id' || key === 'title') {
							return;
						}
						const newKey = key.replace(/^styles_/, '');
						value[newKey] = row[key];
					});
					typography[row._id] = {
						id: row._id,
						title: row.title || '',
						value,
						group: 'kit-live',
					};
				});
			};

			pushColors(attrs.system_colors);
			pushColors(attrs.custom_colors);
			pushTypography(attrs.system_typography);
			pushTypography(attrs.custom_typography);

			if (!Object.keys(colors).length && !Object.keys(typography).length) {
				return null;
			}
			return { colors, typography };
		}

		function uiChemyComposerGetLiveKitGlobalsMaps() {
			try {
				const documents = elementor.documents && elementor.documents.documents;
				if (!documents) {
					return null;
				}
				let attrs = null;
				Object.keys(documents).forEach((docId) => {
					const doc = documents[docId];
					if (!doc || !doc.config || doc.config.type !== 'kit') {
						return;
					}
					const settingsModel = doc.container && doc.container.settings;
					if (!settingsModel || typeof settingsModel.get !== 'function') {
						return;
					}
					attrs = {
						system_colors: settingsModel.get('system_colors'),
						custom_colors: settingsModel.get('custom_colors'),
						system_typography: settingsModel.get('system_typography'),
						custom_typography: settingsModel.get('custom_typography'),
					};
				});
				return uiChemyComposerBuildGlobalsMapsFromKitAttrs(attrs);
			} catch (e) {
				return null;
			}
		}

		function uiChemyComposerRenderGlobalsEditor(colorsMap, typographyMap, atomicSnapshot) {
			const docEl = document.getElementById('uichemy-composer-globals-doc');
			const aiEl = document.getElementById('uichemy-composer-globals-ai-data');
			const statusEl = document.getElementById('uichemy-composer-globals-status');
			if (!docEl && !aiEl) {
				return;
			}
			if (docEl) {
				const text = uiChemyComposerBuildGlobalsDocText(colorsMap, typographyMap, {
					useTypographyVars: true,
					includeRootWrappers: false,
					includeColorVariables: false,
					includeAtomicVariables: false,
					atomicSnapshot,
				});
				UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-globals-doc', text, true);
			}
			if (aiEl) {
				const aiText = uiChemyComposerBuildGlobalsDocText(colorsMap, typographyMap, {
					useTypographyVars: false,
					mergeAtomicVariablesIntoRoot: true,
					atomicSnapshot,
				});
				UichSHE.setUiChemyComposerEditorValueById('uichemy-composer-globals-ai-data', aiText, true);
			}
			if (statusEl) {
				statusEl.textContent = '';
			}
			rebuildDirectTypographyCaches((typographyMap) || {});
			rebuildDirectColorCaches((colorsMap) || {});
			rebuildDirectAtomicCaches(atomicSnapshot || { variables: [], classes: [] });
		}

		UichSHE.refreshUiChemyComposerGlobalsPanel = function () {
			if (!document.getElementById('uichemy-composer-globals-doc')) {
				return;
			}
			const liveMaps = uiChemyComposerGetLiveKitGlobalsMaps();
			Promise.all([
				liveMaps ? Promise.resolve(liveMaps) : uiChemyComposerFetchGlobalsIndexFresh().then((data) => ({
					colors: (data && data.colors) || {},
					typography: (data && data.typography) || {},
				})),
				uiChemyComposerFetchAtomicSnapshot().catch(() => UichSHE.uiChemyComposerAtomicSnapshot || { variables: [], classes: [] }),
			])
				.then(([maps, atomicSnapshot]) => {
					UichSHE.uiChemyComposerAtomicSnapshot = atomicSnapshot || { variables: [], classes: [] };
					uiChemyComposerRenderGlobalsEditor((maps && maps.colors) || {}, (maps && maps.typography) || {}, UichSHE.uiChemyComposerAtomicSnapshot);
				})
				.catch(() => {
					const statusEl = document.getElementById('uichemy-composer-globals-status');
					UichSHE.setUiChemyComposerEditorValueById(
						'uichemy-composer-globals-doc',
						'// Could not load Elementor globals. Open Site Settings or reload the editor.\n',
						true
					);
					if (statusEl) {
						statusEl.textContent = 'Globals unavailable (open Site Settings or reload editor)';
					}
				});
		};

		UichSHE.refreshUiChemyComposerLayersPanel = syncDirectInputsFromSelection;
		UichSHE.focusUiChemyComposerLayerByPath = focusDirectLayerByPath;
		UichSHE.setUiChemyComposerPreviewSelectionPath = UichSHE.syncPreviewSelectedTargetByPath;
		UichSHE.openComposerPanelTab = function (tabName) {
			const tab = String(tabName || 'direct');
			setActiveTab(tab);
			document.body.classList.add('uichemy-composer-active');
			const floatPanel = document.getElementById('uichemy-composer-floating-panel');
			if (floatPanel) {
				floatPanel.classList.add('active');
				floatPanel.classList.remove('minimized');
			}
			if (tab === 'direct') {
				syncDirectInputsFromSelection();
			}
		};
	}

	UichSHE.injectFloatingPanel = injectFloatingPanel;
})(jQuery);
