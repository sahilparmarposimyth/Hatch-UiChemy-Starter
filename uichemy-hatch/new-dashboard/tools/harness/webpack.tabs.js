const path = require('path');
const base = require('../../webpack.config.js');
module.exports = {
  ...base,
  entry: { tabs: path.resolve(__dirname, 'tabs-harness.jsx') },
  output: { ...(base.output || {}), path: path.resolve(__dirname, '../../build-harness'), filename: '[name].js' },
};
