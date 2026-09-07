// chat-upsell.jsx — the stand-in for the AI Chat tab.
//
// Free ships no chat code: the real conversation UI lives in the PRO plugin's own
// bundle (uichemy-pro/editor/), which replaces this registration at load time via
// window.UichComposerRuntime.registerChatTab. This card is registered
// unconditionally by plugin-registrations.js so the Chat slot is never empty.
//
// Deliberately a first-class tab rather than a hidden one: a feature nobody can see
// sells nothing.

import React from 'react';
import { I } from './composer-icons';
import { ProLock } from './composer-pro';

export function ChatUpsellTab() {
  return (
    // Same wrapper classes the real chat uses, so the panel lays this out
    // identically — .chat2-wrap--locked centres the card in the tab body.
    <div className="chat2-wrap side-closed chat2-wrap--locked">
      <ProLock
        icon={I.sparkles}
        title="AI Chat"
        subtitle="Build and edit any widget just by chatting."
        features={[
          {
            icon: I.chat,
            title: 'Chat to build',
            desc: 'Describe a widget in plain English and AI builds or edits it for you.',
          },
          {
            icon: I.link,
            title: 'Bring your own AI',
            desc: 'Connect Claude, Codex, Gemini or OpenCode.',
          },
          {
            icon: I.bolt,
            title: 'Or use WordPress AI',
            desc: 'Use the AI provider already set up on your site.',
          },
        ]}
        cta="Upgrade to Pro"
      />
    </div>
  );
}
