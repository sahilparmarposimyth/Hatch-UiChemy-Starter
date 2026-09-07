/**
 * Single Babel source of truth for the dashboard build.
 *
 * wp-scripts' default babel-loader rule carries no inline presets, so the
 * transform is defined here instead (read by babel-loader for every
 * js/jsx/ts/tsx module). This replaces the previous inline preset rule in
 * webpack.config.js and adds TypeScript support for the design-system/
 * components (.tsx + type annotations).
 *
 * `runtime: 'automatic'` lets JSX compile without an explicit `import React`
 * (several design-system components rely on that), while existing files that
 * do import React keep working unchanged.
 */
module.exports = {
  presets: [
    '@babel/preset-env',
    ['@babel/preset-react', { runtime: 'automatic' }],
    '@babel/preset-typescript',
  ],
};
