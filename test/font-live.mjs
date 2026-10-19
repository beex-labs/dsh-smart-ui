/**
 * Prove a card re-renders when the user changes the content font size.
 *
 * Run: node test/font-live.mjs
 *
 * The static check proves the type follows the variable. This one proves the
 * *live* path works: DSH's theme service writes `--dsh-content-font-size` on the
 * body and emits `theme/change`, and the already-mounted card has to pick that
 * up without a reload. A card that only scales on first paint would pass the
 * other check and still be wrong here.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(here, 'out-font')
mkdirSync(outDir, { recursive: true })

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const BROWSER = CHROME_CANDIDATES.find((p) => existsSync(p))
if (BROWSER === undefined) throw new Error('no Chromium browser found')

const client = readFileSync(join(root, 'client.js'), 'utf8')
const echartsChunk = existsSync(join(root, 'client.echarts.js')) ? readFileSync(join(root, 'client.echarts.js'), 'utf8') : ''

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif}#harness{width:700px}</style>
</head><body>
<div id="harness"></div>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script>window.__pending=[];window.__ModuleLoader__={load:function(r){window.__pending.push(r)}};</script>
<script>${client}</script>
<script>${echartsChunk}</script>
<script>
var React = window.React, ReactDOM = window.ReactDOM;
var reg = window.__pending[0], engine = window.__pending[1];
var engineApi = engine ? engine.factory(function () { throw new Error('engine requires nothing') }) : null;
var mounted = null, slotOptions = null;
// The theme change handler the plugin registers through ctx.on('theme/change').
var changeHandlers = [];
var ctx = {
  effect: function (fn) { try { fn() } catch (e) { window.__ctxError = String(e) } return function () {} },
  on: function (name, fn) { if (name === 'theme/change') changeHandlers.push(fn); return function () {} },
  locale: { register: function () { return function () {} } },
  slots: {
    inject: function (k, cb) { try { cb() } catch (e) { window.__ctxError = String(e) } return function () {} },
    // The real slot calls the registration's inject callback and spreads the
    // result as props, which is how the store reaches the component. Capture
    // both so the harness can do the same instead of passing an undefined store.
    register: function (o, c) { slotOptions = o; mounted = c; return function () {} },
  },
};
var require = function () { return React };
require.async = function () { return Promise.resolve(engineApi) };
reg.factory(require).apply(ctx);

document.body.style.setProperty('--dsh-content-font-size', '14px');

// Exactly what the slot does with the plugin's inject callback.
var injected = slotOptions && typeof slotOptions.inject === 'function' ? slotOptions.inject() : {};

var results = { ctxError: window.__ctxError, mounted: !!mounted, handlers: changeHandlers.length, steps: [], errors: [] };
var spec = { kind: 'chart', variant: 'bar', title: 'Build', unit: 'ms',
  series: [{ label: 'Parse', value: 12 }, { label: 'Compile', value: 148 }, { label: 'Link', value: 63 }] };

var host = document.createElement('div');
host.style.width = '700px';
document.getElementById('harness').appendChild(host);
var root = ReactDOM.createRoot(host);
if (mounted) {
  root.render(React.createElement(mounted, Object.assign({
    block: { kind: 'tool', call: { argsRaw: JSON.stringify({ spec: spec }) } },
    t: function (k) { return k },
  }, injected)));
}

/** Read what is on screen right now. */
function snap() {
  var card = host.querySelector('.iui-card');
  var svgText = host.querySelector('.iui-canvas svg text');
  return {
    card: card ? parseFloat(getComputedStyle(card).fontSize) : null,
    // The inline variables are what the plugin itself wrote, so they separate
    // "the store did not invalidate" from "the CSS did not follow".
    inlineVar: card ? card.style.getPropertyValue('--dsh-content-font-size') : null,
    inlineDelta: card ? card.style.getPropertyValue('--iui-fs-delta') : null,
    cards: host.querySelectorAll('.iui-card').length,
    // ECharts draws its own labels into the SVG; that text is the proof the
    // engine took the new size, not just the CSS around it.
    chartLabel: svgText ? parseFloat(getComputedStyle(svgText).fontSize) : null,
    canvasH: (function () { var c = host.querySelector('.iui-canvas'); return c ? Math.round(c.getBoundingClientRect().height) : null })(),
  };
}

var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) };

(async function () {
  if (!mounted) { document.title = 'RESULT:' + JSON.stringify(results); return }
  try {
    await sleep(900); // let the chart chunk resolve and paint
    results.steps.push({ at: 'initial 14px', state: snap() });

    // Exactly what the theme service's setFontSize does: write the variable,
    // then emit theme/change.
    for (var px of [10, 22, 14]) {
      document.body.style.setProperty('--dsh-content-font-size', px + 'px');
      changeHandlers.forEach(function (fn) { fn() });
      await sleep(700);
      results.steps.push({ at: 'changed to ' + px + 'px', state: snap() });
    }
  } catch (e) {
    results.errors.push(String(e && e.stack || e));
  }
  document.title = 'RESULT:' + JSON.stringify(results);
})();
</script></body></html>`

const htmlPath = join(outDir, 'live.html')
writeFileSync(htmlPath, html, 'utf8')

const profile = join(tmpdir(), 'dsh-intelligent-ui-live-profile')
const outFile = join(outDir, 'live-dom.txt')
const script = `
$p = Start-Process -FilePath ${JSON.stringify(BROWSER)} -ArgumentList @(
  '--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--hide-scrollbars',
  '--virtual-time-budget=30000','--window-size=800,900',
  '--user-data-dir=${profile.replace(/\\/g, '\\\\')}',
  '--dump-dom', ${JSON.stringify('file:///' + htmlPath.replace(/\\/g, '/'))}
) -Wait -PassThru -NoNewWindow -RedirectStandardOutput ${JSON.stringify(outFile)} -RedirectStandardError ${JSON.stringify(join(outDir, 'live-err.txt'))}
exit $p.ExitCode
`
execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 })

const dom = readFileSync(outFile, 'utf8')
const title = dom.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
if (!title.startsWith('RESULT:')) {
  console.error('FAIL: no result; first 600 chars of <title>:')
  console.error(title.slice(0, 600))
  process.exit(1)
}
const decoded = title.slice('RESULT:'.length)
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const result = JSON.parse(decoded)

const failures = []
const check = (name, ok, detail) => {
  if (ok) console.log(`ok    ${name}${detail ? `   ${detail}` : ''}`)
  else { console.log(`FAIL  ${name}${detail ? `   ${detail}` : ''}`); failures.push(name) }
}

if (result.ctxError) { console.error('apply() threw:', result.ctxError); process.exit(1) }
if (result.errors.length > 0) { console.error('page errors:\n' + result.errors.join('\n')); process.exit(1) }

check('the plugin registered a tool view', result.mounted)
check('the plugin subscribed to theme/change', result.handlers > 0, `${result.handlers} handler(s)`)

for (const step of result.steps) console.log(`      ${step.at.padEnd(18)} card=${step.state.card}px  inline=${step.state.inlineVar}  chartLabel=${step.state.chartLabel}px  canvas=${step.state.canvasH}px  cards=${step.state.cards}`)

const by = (label) => result.steps.find((s) => s.at === label)?.state
const at14 = by('initial 14px')
const at10 = by('changed to 10px')
const at22 = by('changed to 22px')
const back14 = by('changed to 14px')

check('the mounted card re-renders on the change', at14 && at10 && at14.card !== at10.card, `${at14?.card}px -> ${at10?.card}px`)
check('card type shrinks and grows with the setting', at10 && at22 && at10.card < at22.card, `${at10?.card}px < ${at22?.card}px`)
check('the chart labels follow too', at10 && at22 && at10.chartLabel !== null && at10.chartLabel < at22.chartLabel, `${at10?.chartLabel}px < ${at22?.chartLabel}px`)
// Labels shift by the setting's offset, so they stay legible at the low end
// instead of shrinking in proportion.
check('chart labels stay legible at the smallest setting', at10 && at10.chartLabel >= 8, `${at10?.chartLabel}px`)
check('the chart canvas grows with the type', at10 && at22 && at10.canvasH < at22.canvasH, `${at10?.canvasH}px < ${at22?.canvasH}px`)
check('the chart canvas does not collapse at the smallest setting', at10 && at10.canvasH >= 220, `${at10?.canvasH}px`)
check('returning to 14px restores the original size', back14 && at14 && back14.card === at14.card, `${back14?.card}px === ${at14?.card}px`)

console.log(`\npage: ${htmlPath}`)
if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('OK: a live font-size change re-renders the card and its chart')
