// Preserve the plain CJS object required by the DSH classic module loader.
const { apply, inject } = require('./index.ts')
module.exports = { apply, inject }
