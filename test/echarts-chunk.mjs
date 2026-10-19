/**
 * Verify the generated `client.echarts.js` chunk without a browser.
 *
 * The riskiest part of shipping ECharts as a lazy chunk is the UMD wrapper: the
 * library must take its `exports` branch (handing us the API) rather than its
 * `globalThis.echarts = {}` branch (leaking a global and returning nothing).
 * This harness fakes `window.__ModuleLoader__`, loads the chunk exactly as the
 * real loader does, and asserts the factory returns a usable ECharts.
 *
 * Run: node test/echarts-chunk.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const chunkPath = join(here, '..', 'client.echarts.js')
const source = readFileSync(chunkPath, 'utf8')

const CHUNK_ID = 'dsh-intelligent-ui/client.echarts.js'

let checks = 0
const check = (name, fn) => { fn(); checks += 1; console.log(`ok  ${name}`) }

// A minimal DOM shim: ECharts touches document/window at module scope.
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  document: {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, getContext: () => null }),
    documentElement: { style: {} },
    addEventListener() {},
    removeEventListener() {},
  },
  navigator: { userAgent: 'node' },
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox

const registrations = []
sandbox.__ModuleLoader__ = { load: (registration) => registrations.push(registration) }

const context = vm.createContext(sandbox)
vm.runInContext(source, context, { filename: 'client.echarts.js' })

check('the chunk registers exactly one module', () => {
  assert.equal(registrations.length, 1)
})

check('it registers under the id require.async resolves to', () => {
  assert.equal(registrations[0].id, CHUNK_ID)
})

const exports = registrations[0].factory(() => { throw new Error('the chunk must not require anything') })

check('the factory returns the ECharts API, not an empty object', () => {
  assert.equal(typeof exports, 'object')
  assert.ok(Object.keys(exports).length > 0, 'expected exported members')
})

check('the expected ECharts entry points are present', () => {
  for (const name of ['init', 'use', 'graphic', 'registerTheme', 'version']) {
    assert.ok(name in exports, `missing export: ${name}`)
  }
})

check('it reports a real version', () => {
  assert.match(String(exports.version), /^\d+\.\d+\.\d+/)
})

check('it did not leak a global', () => {
  assert.equal(sandbox.echarts, undefined, 'the UMD fell through to its global branch')
})

check('init is callable (ECharts can build a chart against a DOM node)', () => {
  assert.equal(typeof exports.init, 'function')
})

console.log(`\n${checks} checks passed (echarts ${exports.version})`)
