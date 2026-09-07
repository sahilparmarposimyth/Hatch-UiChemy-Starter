const path = require('path');
const base = require('../../webpack.config.js');
module.exports = {
  ...base,
  entry: { toolbar: path.resolve(__dirname, 'toolbar-harness.jsx') },
  output: { ...(base.output || {}), path: path.resolve(__dirname, '../../build-harness'), filename: '[name].js' },
};
