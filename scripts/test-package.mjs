#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// macOS resolves /var to /private/var; compare against the real path so the
// module-resolution assertions below match what Node reports.
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-package-')))
const require = createRequire(path.join(root, 'package.json'))
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

try {
  const [packed] = JSON.parse(
    run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]),
  )
  const files = new Set(packed.files.map((file) => file.path))
  for (const file of [
    'build/index.js',
    'build/client.js',
    'package.json',
    'cordis.patch.yml',
    'locale/en.json',
    'locale/zh.json',
    'icon.svg',
  ])
    assert(files.has(file), `Missing package file: ${file}`)
  assert(
    ![...files].some((file) => /^(src|tests|node_modules|scripts)\//.test(file)),
    'Development files leaked into the runtime package',
  )
  assert(
    !files.has('index.js') && !files.has('client.js'),
    'Legacy root bundles leaked into the package',
  )
  const sandbox = path.join(temporary, 'installed')
  run('npm', [
    'install',
    '--prefix',
    sandbox,
    '--omit=dev',
    '--ignore-scripts',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    path.join(temporary, packed.filename),
  ])
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict'
    import * as plugin from '@local/dsh-prompt-suggestion'
    assert.deepEqual(plugin.inject, ['webServer', 'sessions', 'llm'])
    assert.equal(typeof plugin.apply, 'function')
    assert(plugin.Config)
    assert.equal(plugin.resolveSettings({}).maxContextMessages, 16)
    assert.equal(plugin.parseSuggestion('1. “继续测试”'), '继续测试')
  `,
    ],
    sandbox,
  )

  const packageRoot = path.join(sandbox, 'node_modules/@local/dsh-prompt-suggestion')
  const installedRequire = createRequire(path.join(sandbox, 'package.json'))
  assert.equal(
    installedRequire.resolve('@local/dsh-prompt-suggestion'),
    path.join(packageRoot, 'build/index.js'),
  )
  const clientPath = installedRequire.resolve('@local/dsh-prompt-suggestion/client')
  assert.equal(clientPath, path.join(packageRoot, 'build/client.js'))
  const registrations = []
  vm.runInNewContext(
    await readFile(clientPath, 'utf8'),
    {
      window: { __ModuleLoader__: { load: (entry) => registrations.push(entry) } },
    },
    { timeout: 5_000 },
  )
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, '@local/dsh-prompt-suggestion')
  const client = registrations[0].factory((name) => {
    assert.equal(name, 'react', 'Unexpected client runtime dependency')
    return require('react')
  })
  assert.deepEqual(Object.keys(client).sort(), ['apply', 'inject'])
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale', 'configForms'])
  console.log(
    'PASS: runtime-only tarball installs, Host exports load, and classic Client factory resolves host-provided React.',
  )
} catch (error) {
  if (error.stderr) process.stderr.write(error.stderr)
  throw error
} finally {
  await rm(temporary, { recursive: true, force: true })
}
