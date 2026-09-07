// Standalone harness build. Reuses the plugin's own webpack config (so the '@'
// alias, babel and loaders match exactly) but swaps in a single entry and a
// separate output dir. Does not touch webpack.config.js.
const path = require('path');
const base = require('../../webpack.config.js');

module.exports = {
  ...base,
  entry: { harness: path.resolve(__dirname, 'field-harness.jsx') },
  output: {
    ...(base.output || {}),
    path: path.resolve(__dirname, '../../build-harness'),
    filename: '[name].js',
  },
  externals: {},
};
