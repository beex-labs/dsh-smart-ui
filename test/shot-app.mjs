/**
 * Screenshots of representative demo apps, for eyeballing.
 *
 * Run: node test/shot-app.mjs
 *
 * Renders the real `client.js` with its generated chart/diagram chunks in
 * headless Chrome at 1280px wide and shoots PNGs into test/out-app/:
 * travel, analytics, quiz, a Mock-Streaming frame captured mid-flight (the
 * virtual-time budget expires before the stream finishes), and one dark-mode
 * shot that fakes the theme by overriding the --dsw-alias-* tokens `readColors`
 * resolves. Each page is also dumped as DOM afterwards so render errors are
 * read off it — a screenshot alone cannot report them.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateApp } from '../engine.cjs'
import { pageHtml, shoot, dumpDom, domErrors, chunkSource, BROWSER } from './_app-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(here, 'out-app')
mkdirSync(outDir, { recursive: true })

// Which demos make the picture: one per layout family the cards cover.
const PLAN = [
  { name: 'travel', file: '1-travel.json' },
  { name: 'analytics', file: '2-analytics.json' },
  { name: 'quiz', file: '6-quiz.json' },
  // Mid-flight: 5 mock events at 400ms, budget expires at 1300ms → the tree is
  // still growing when the shutter fires.
  {
    name: 'stream-midflight', file: '7-stream.json', budget: 1300, height: 900,
    tweak: (spec) => ({ ...spec, stream: { mode: 'mock', intervalMs: 400 } }),
  },
  { name: 'analytics-dark', file: '2-analytics.json', dark: true },
]

const body = (spec) => `
var A = window.H;
A.mount(${JSON.stringify(spec)}, { width: 1208 });
setTimeout(function () {
  var pre = document.createElement('pre');
  pre.id = 'errors';
  pre.textContent = 'ERRORS:' + JSON.stringify(window.H.pageErrors.concat(window.H.errors));
  document.body.appendChild(pre);
  document.title = 'SHOT:ready errors=' + (window.H.pageErrors.length + window.H.errors.length);
}, 3000);
`

let failures = 0
for (const shot of PLAN) {
  const path = join(root, 'demos', shot.file)
  if (!existsSync(path)) {
    console.log(`skip  ${shot.name}: demos/${shot.file} is missing`)
    continue
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  let spec = { ...raw, kind: 'app' }
  try {
    spec = validateApp(spec)
  } catch (error) {
    console.log(`note  ${shot.name}: demos/${shot.file} does not validateApp (${error.message}); shooting it raw`)
  }
  if (shot.tweak) spec = shot.tweak(spec)

  const chunks = ['client.engine.js', 'client.echarts.js']
  if (JSON.stringify(spec).includes('"diagram"') && chunkSource('client.mermaid.js') !== '') {
    chunks.push('client.mermaid.js')
  }
  const htmlPath = join(outDir, `shot-${shot.name}.html`)
  writeFileSync(htmlPath, pageHtml({ body: body(spec), chunks, dark: shot.dark ?? false }), 'utf8')

  const png = join(outDir, `shot-${shot.name}.png`)
  const profile = join(process.env.TEMP ?? '.', 'dsh-iui-app-shot-profile')
  shoot(htmlPath, png, join(outDir, `shot-${shot.name}-shot.err.txt`), {
    profile, width: 1280, height: shot.height ?? 1500, budget: shot.budget ?? 15000,
  })
  const dom = dumpDom(htmlPath, join(outDir, `shot-${shot.name}.dom.txt`), join(outDir, `shot-${shot.name}-dom.err.txt`), {
    profile, width: 1280, height: shot.height ?? 1500, budget: 20000,
  })
  writeFileSync(join(outDir, `shot-${shot.name}.rendered.html`), dom, 'utf8')

  const errors = domErrors(dom)
  const ok = existsSync(png) && errors.length === 0
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${shot.name} -> ${png}${errors.length > 0 ? '  page errors: ' + JSON.stringify(errors) : ''}`)
  if (!ok) failures += 1
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} shot(s) failed`)
  process.exit(1)
}
console.log(`\nOK: screenshots in ${outDir} (browser: ${BROWSER})`)
