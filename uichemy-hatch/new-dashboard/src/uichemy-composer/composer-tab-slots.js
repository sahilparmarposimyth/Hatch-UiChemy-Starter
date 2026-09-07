// composer-tab-slots.js, the seam that lets the Pro plugin supply the Chat tab.
//
// The Chat tab's real implementation lives in the PRO plugin's own bundle
// (uichemy-pro/editor/), which loads AFTER this (free) bundle and registers
// itself through window.UichComposerRuntime.registerChatTab, see
// composer-runtime-exports.js. Free's plugin-registrations.js registers the
// upsell stand-in first, so the slot is never empty; a later Pro registration
// simply replaces it (last one wins).
//
// Because the Pro registration arrives after the panel has mounted, the registry
// is a tiny subscribable store: composer-app.jsx reads it via
// useSyncExternalStore(subscribeChatTab, getChatTab) so a late registration
// re-renders the panel instead of being silently ignored.
//
// Only Chat is pluggable. The Editor and Code tabs ship in full in Free, so they
// stay hardcoded in composer-app.jsx, a generic tab framework would mean
// threading ~25 Inspector props through a registry for no benefit.

import React from 'react';

/** Layout-transparent wrapper used when a Chat tab needs no provider. */
export function PassthroughProvider({ children }) {
  return <>{children}</>;
}

/**
 * @typedef {Object} ChatTabImpl
 * @property {React.ComponentType} Tab              Rendered in the always-mounted chat slot.
 * @property {React.ComponentType} [SessionProvider] Wraps the whole panel body. Pro passes
 *   ChatSessionProvider so queue/WS state survives tab switches and panel collapse; Free
 *   omits it and gets PassthroughProvider.
 * @property {string} [label]  Tab label. Defaults to 'Chat'.
 * @property {string} [badge]  Small pill next to the label, e.g. 'AI'. Omit for none.
 * @property {boolean} [pro]   True when this is the upsell stand-in, so the panel can show
 *   a PRO pill instead of `badge` without asking which build it is.
 */

let impl = null;
const listeners = new Set();

/**
 * Register (or replace) the Chat tab. Free calls this at boot with the upsell
 * stand-in; the Pro bundle calls it again later with the real implementation.
 */
export function registerChatTab(next) {
  if (!next || typeof next.Tab !== 'function') {
    // Never throw: a broken registration must not take the whole panel down.
    // Without a registration the panel simply renders no Chat tab.
    return;
  }
  impl = {
    label: 'Chat',
    SessionProvider: PassthroughProvider,
    ...next,
  };
  // Wake any mounted panel, the Pro bundle registers after first render.
  listeners.forEach((fn) => {
    try { fn(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  });
}

/** The registered Chat tab, or null when none has been registered. */
export function getChatTab() {
  return impl;
}

/**
 * useSyncExternalStore-compatible subscription, so composer-app re-renders when
 * the Pro bundle swaps the upsell stand-in for the real Chat tab.
 */
export function subscribeChatTab(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
