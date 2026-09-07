// Radix portals default to the top window's document.body, but the composer
// can mount inside the Elementor preview iframe and must carry the `.uich-tw`
// Tailwind scope + theme class with it. Every portal-bearing shadcn component
// reads its default container from this context; ensurePortalRoot() creates a
// scoped, theme-synced host in the right document.
import React, { createContext, useContext } from 'react';

const PortalContainerContext = createContext(null);

export function PortalContainerProvider({ container, children }) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  );
}

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

const ROOT_CLASS = 'uich-portal-root';

/**
 * Get (or create) the scoped portal host for a document.
 * @param {Document} doc     document that hosts the composer panel
 * @param {string} [theme]   'dark' | 'light', omit to keep the current theme
 * @param {string} [skin]    'elementor' | 'gutenberg' | 'brand', omit to keep
 *                           the current skin
 */
export function ensurePortalRoot(doc, theme, skin) {
  const d = doc || document;
  let root = d.body.querySelector(`:scope > .${ROOT_CLASS}`);
  if (!root) {
    root = d.createElement('div');
    root.className = `uich-tw ${ROOT_CLASS}`;
    d.body.appendChild(root);
  }
  if (theme === 'dark' || theme === 'light') {
    root.classList.toggle('dark', theme === 'dark');
    // The ATTRIBUTE as well as the class, because the two token families are
    // keyed differently and both reach this host. `.dark` drives the shadcn
    // tokens (--popover, --border, --accent) in shadcn-tokens.css; the legacy
    // `--panel-*` / `--text-*` ramp in composer-skin-tokens.css is keyed on
    // `[data-uich-composer-theme]`, and in that file DARK is the default for a
    // skin — light is the variant that has to be asked for. So a host carrying
    // only `.dark` served dark shadcn tokens over a dark legacy ramp (right by
    // accident), and a host in LIGHT mode served light shadcn tokens over the
    // DARK legacy ramp: a white menu with #313336 fills inside it. Setting both
    // is what makes a portalled menu match the panel in either theme.
    root.dataset.uichComposerTheme = theme;
    root.style.colorScheme = theme;
  }
  // Skin travels with the portal host so portaled popovers/menus pick up the
  // same palette as the panel. Set both the class (shadcn tokens) and the
  // data-attr (legacy `--panel-*` tokens are keyed on the attribute).
  //
  // 'gutenberg' is handled here too. It used to fall through the guard below,
  // so a portalled menu in the block editor kept whatever skin it was last
  // given — in practice none — and rendered in the base UiChemy palette while
  // the panel behind it was in the WordPress one.
  if (skin === 'elementor' || skin === 'gutenberg' || skin === 'brand') {
    root.classList.toggle('skin-elementor', skin === 'elementor');
    root.classList.toggle('skin-gutenberg', skin === 'gutenberg');
    // 'brand' is the absence of a skin — the base tokens already are it.
    if (skin === 'brand') delete root.dataset.uichComposerSkin;
    else root.dataset.uichComposerSkin = skin;
  }
  return root;
}
