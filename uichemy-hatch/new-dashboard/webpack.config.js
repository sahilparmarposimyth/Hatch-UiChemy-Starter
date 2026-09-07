const path = require('path');
const defaults = require('@wordpress/scripts/config/webpack.config');

/**
 * One build, two entries.
 *
 *   index    → the UiChemy dashboard + onboarding wizard (src/index.js)
 *   composer → the merged UiChemy composer panel (src/uichemy-composer/index.jsx),
 *              which mounts inside the Elementor / Gutenberg / Bricks editors
 *
 * The composer entry is named `composer`, not `index`, because both entries emit
 * into the same build/ directory and would otherwise overwrite each other's
 * index.js / index.css. PHP reads the renamed files through UICHEMY_BUILD_URL
 * (see Uich_Composer_Loader).
 *
 * Keeping them as separate entries — rather than importing the composer from the
 * dashboard — is what keeps Tailwind out of the dashboard's CSS. The `@tailwind`
 * directives live only in src/uichemy-composer/shadcn.css, which only the composer
 * entry imports, so composer.css carries the preflight/utilities and index.css
 * stays the plain SCSS it always was.
 */
module.exports = {
  ...defaults,
  entry: {
    index: path.resolve(__dirname, 'src/index.js'),
    composer: path.resolve(__dirname, 'src/uichemy-composer/index.jsx'),
    // Style-only third entry: the design system WITHOUT Tailwind's preflight,
    // for the document that hosts the page rather than the panel (the Elementor
    // preview iframe). composer.css cannot be used there — its reset would
    // restyle the user's own page. See src/uichemy-composer/canvas.css.
    canvas: path.resolve(__dirname, 'src/uichemy-composer/canvas-entry.js'),
  },
  // Babel transform (incl. TypeScript for design-system/) is defined in
  // babel.config.js, read by wp-scripts' default babel-loader rule — so no
  // custom module rule is needed here anymore.
  resolve: {
    ...defaults.resolve,
    // `.ts`/`.tsx` added for the design-system/ components (TypeScript + CSS
    // Modules). Overriding this array drops the wp-scripts defaults, so the
    // full set must be listed explicitly.
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    alias: {
      ...(defaults.resolve && defaults.resolve.alias),
      // 46 files under src/uichemy-composer/ import via '@/components/ui/…' and
      // '@/lib/utils'. In the standalone plugin '@' resolved to composer/src; here
      // it resolves to the folder those files moved into.
      '@': path.resolve(__dirname, 'src/uichemy-composer'),
    },
  },
};
