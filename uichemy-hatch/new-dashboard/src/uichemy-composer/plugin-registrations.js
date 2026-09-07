// plugin-registrations.js, seed the Chat slot with the Free upsell stand-in.
//
// Free ships NO chat code: the real Chat tab (and Draw) live in the PRO plugin's
// own bundle (uichemy-pro/editor/), which loads after this one and replaces this
// registration through window.UichComposerRuntime.registerChatTab, see
// composer-runtime-exports.js. Registration is last-one-wins and subscribable
// (composer-tab-slots.js), so the panel re-renders when the Pro tab arrives.
//
// The upsell is registered UNCONDITIONALLY, even on a Pro site. It is only the
// baseline so the slot is never empty; with Pro active its bundle overwrites it
// before the user can blink, and if that bundle ever fails to load the tab
// degrades to the upsell card instead of vanishing without explanation.

import { registerChatTab } from './composer-tab-slots';
import { ChatUpsellTab } from './chat-upsell';

// `pro: true` puts the PRO pill on the tab.
registerChatTab( {
  Tab: ChatUpsellTab,
  label: 'Chat',
  pro: true,
} );
