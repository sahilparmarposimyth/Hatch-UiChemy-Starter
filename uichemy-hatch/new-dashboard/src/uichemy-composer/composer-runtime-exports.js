// composer-runtime-exports.js, the window API the PRO editor bundle builds on.
//
// The Pro plugin ships the Chat/Draw UI in its own webpack bundle
// (uichemy-pro/editor/), compiled with `externals: { '@uich/runtime':
// window.UichComposerRuntime }`. Everything the chat needs from the shared
// panel, hooks, singletons, UI primitives, is re-exported here ONCE.
//
// Why exports and not a second compile: the values below close over
// module-level singletons (composer-elementor's active-widget store, the
// tab-slots registry, the pick-mode style/state). If the Pro bundle compiled
// its own copies, it would get DIFFERENT instances, a chat that never sees
// the active widget. Sharing the live bindings is the whole point.
//
// Ordering contract: this module is imported from index.jsx, so the global is
// assigned while composer.js evaluates. The Pro bundle's script handle depends
// on `uichemy-composer-composer` (see uichemy-pro's UiChemy_Chat_Assets), so it
// always evaluates after, the global is guaranteed to exist by then.
//
// This is a deliberate, stable surface, treat renames/removals here as
// breaking changes for the Pro plugin and version them together.

import { registerChatTab, PassthroughProvider } from './composer-tab-slots';
import {
  useActiveWidget,
  useWidgetSetting,
  getActiveWidgetSync,
  getRestApiBaseUrl,
  getRestNonce,
  applyGlobalsCss,
} from './composer-elementor';
import {
  useChatPickMode,
  useChatTargetDecorator,
  switchToSectionForNode,
  getWidgetRoot,
} from './composer-pick';
import { computePathForNode, pathRelevantChildren } from './composer-layer-tree';
import { upsertGlobalsBlock } from './composer-globals-css';
import { I } from './composer-icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ensurePortalRoot } from '@/components/ui/portal-context';
import { useSlidingSeg } from '@/components/ui/use-sliding-seg';

if (typeof window !== 'undefined') {
  window.UichComposerRuntime = {
    // Chat-slot registration (subscribable, late registration re-renders the panel).
    registerChatTab,
    PassthroughProvider,
    // Active-widget store + REST plumbing (live singletons).
    useActiveWidget,
    useWidgetSetting,
    getActiveWidgetSync,
    getRestApiBaseUrl,
    getRestNonce,
    applyGlobalsCss,
    // Element pick-mode hooks + cross-section switch.
    useChatPickMode,
    useChatTargetDecorator,
    switchToSectionForNode,
    getWidgetRoot,
    computePathForNode,
    pathRelevantChildren,
    // Globals CSS block writer.
    upsertGlobalsBlock,
    // Segmented-control pill: measures the active item and publishes its
    // offset/size so the `seg-slide` track can draw ONE chip that travels.
    // Shared rather than recompiled so Pro's segmented controls animate exactly
    // like the panel's — same easing, same measurement, one implementation.
    useSlidingSeg,
    // Shared UI primitives.
    I,
    cn,
    Button,
    ensurePortalRoot,
  };
}
