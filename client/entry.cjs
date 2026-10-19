// Bundle entry. DSH expects the factory to return a plain CJS object with
// `inject` and `apply`; keeping the entry in CJS avoids an `__esModule` wrapper.
const { apply, inject } = require('./index.js')

module.exports = { apply, inject }
