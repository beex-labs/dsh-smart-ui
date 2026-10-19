/**
 * Demo sweep: mount every demos/*.json through the real client and interact.
 *
 * Run: node test/app-interaction.mjs
 *
 * For each demo the page mounts the normalized spec (exactly what the Host
 * stores in argsRaw), waits for the engine and any Mock Streaming to finish,
 * asserts that no `.iui-node-error`/`.iui-bind-error` box appeared, then drives
 * one real control after another until something in the DOM visibly changes.
 * A demo that fails is reported with the reason — the demo itself is never
 * edited here.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateApp } from '../engine.cjs'
import { pageHtml, dumpDom, titleResult } from './_app-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(here, 'out-app')
mkdirSync(outDir, { recursive: true })

const demoDir = join(root, 'demos')
const files = existsSync(demoDir)
  ? readdirSync(demoDir).filter((file) => file.endsWith('.json')).sort()
  : []
if (files.length === 0) {
  console.log('no demos/*.json found — nothing to sweep yet')
  process.exit(0)
}

const demos = files.map((file) => {
  const raw = JSON.parse(readFileSync(join(demoDir, file), 'utf8'))
  const spec = raw.kind ? raw : { ...raw, kind: 'app' }
  let invalid = null
  let normalized = spec
  try {
    normalized = validateApp(spec)
  } catch (error) {
    invalid = error.message
  }
  return { name: file, spec: normalized, invalid }
})

const body = `
var R = { ctxErrors: window.__ctxErrors, demos: [] };
var A = window.H;
// Action effects the demos may reach: clipboard resolves, popups open.
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: function () { return Promise.resolve() } },
  configurable: true,
});
window.open = function () { return {} };

(async function () {
  var DEMOS = window.__DEMOS;
  for (var d = 0; d < DEMOS.length; d += 1) {
    var entry = DEMOS[d];
    var out = { name: entry.name, errorBoxes: [], moved: null };
    try {
      var h = A.mount(entry.spec);
      var ready = await A.waitFor(function () {
        var snap = A.readApp(h);
        return (h.q('.iui-app') !== null || snap.nodeErrors.length > 0)
          && (snap.stream.length === 0 || snap.stream.join(' ').indexOf('Stream complete') >= 0);
      }, 10000);
      await A.wait(80);
      var snap = A.readApp(h);
      out.ready = Boolean(ready);
      out.errorBoxes = snap.nodeErrors.concat(snap.bindErrors);
      out.chars = snap.text.length;
      if (out.errorBoxes.length === 0) out.moved = await A.autoInteract(h);
      h.unmount();
    } catch (error) {
      out.fatal = String((error && error.stack) || error);
    }
    R.demos.push(out);
  }
  document.title = 'RESULT:' + JSON.stringify(R);
})();
`

const htmlPath = join(outDir, 'interact.html')
const page = pageHtml({ body, chunks: ['client.engine.js', 'client.echarts.js'] })
  .replace('window.__reject=[];', `window.__reject=[];window.__DEMOS=${JSON.stringify(demos)};`)
writeFileSync(htmlPath, page, 'utf8')

const dom = dumpDom(htmlPath, join(outDir, 'interact-dom.txt'), join(outDir, 'interact-err.txt'), {
  profile: join(process.env.TEMP ?? '.', 'dsh-iui-app-interact-profile'),
  width: 1280, height: 1200, budget: 60000,
})
writeFileSync(join(outDir, 'interacted.html'), dom, 'utf8')

const R = titleResult(dom, 'RESULT:')
if (R === null) {
  console.error('FAIL: the page did not report a result')
  process.exit(1)
}

let checks = 0
const failures = []
const check = (name, fn) => {
  try { fn(); checks += 1; console.log(`ok    ${name}`) } catch (error) {
    console.log(`FAIL  ${name}   ${error.message}`)
    failures.push(name)
  }
}

check('the page ran without a fatal harness error', () => {
  if (R.demos.some((d) => d.fatal)) {
    throw new Error(R.demos.filter((d) => d.fatal).map((d) => `${d.name}: ${d.fatal}`).join(' | '))
  }
  if (R.ctxErrors.length > 0) throw new Error('plugin ctx errors: ' + R.ctxErrors.join(' | '))
})

for (let i = 0; i < demos.length; i += 1) {
  const demo = demos[i]
  const out = R.demos[i]
  console.log(`\n-- ${demo.name} --`)
  check(`${demo.name}: the spec passes validateApp`, () => {
    if (demo.invalid) throw new Error(demo.invalid)
  })
  check(`${demo.name}: renders with no error box`, () => {
    if (!out || out.fatal) throw new Error(out?.fatal ?? 'no result')
    assertErrors(out)
  })
  check(`${demo.name}: a real interaction moves the DOM`, () => {
    if (!out?.moved?.ok) {
      throw new Error('nothing moved; tried: ' + JSON.stringify(out?.moved?.tried ?? out?.errorBoxes))
    }
    console.log(`      via ${out.moved.via}`)
  })
}

function assertErrors(out) {
  if (out.errorBoxes.length > 0) throw new Error(out.errorBoxes.join(' | '))
  if (out.chars < 40) throw new Error('rendered almost nothing (' + out.chars + ' chars)')
}

console.log(`\npage: ${htmlPath}`)
if (failures.length > 0) {
  console.error(`\nFAIL (demo-specific, report to the demo author): ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`OK: ${checks} checks passed across ${demos.length} demos`)
