'use strict'
// Absolute paths: ams-dev resolves relative DCL/DCN folders from process.cwd(),
// which is the repository root when tests launch this sample.
const path = require('path')

module.exports = {
  requires: {
    auth: {
      ams: {
        dclRoot: path.join(__dirname, 'ams/dcl'),
        dcnRoot: path.join(__dirname, 'gen/ams/dcn'),
      },
    },
  },
}
