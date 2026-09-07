// Standalone build for the bar harness — reuses the plugin webpack config so
// aliases/babel match, swaps entry + output. Does not touch webpack.config.js.
const path = require('path');
const base = require('../../webpack.config.js');
module.exports = {
  ...base,
  entry: { bar: path.resolve(__dirname, 'bar-harness.jsx') },
  // Output goes in a SUBDIRECTORY. wp-scripts cleans the output dir via a
  // plugin, not the `clean` flag, so `clean: false` does not stop it — it
  // emptied build-harness/ twice, taking the harness generator scripts with
  // it. A subdirectory is the only thing that reliably keeps them safe.
  output: {
    ...(base.output || {}),
    path: path.resolve(__dirname, '../../build-harness/bundles'),
    filename: '[name].js',
    clean: false,
  },
};
