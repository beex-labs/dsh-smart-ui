/**
 * Screenshot Intelligent UI cards at three content font sizes, for eyeballing.
 *
 * Run: node test/shot-font.mjs
 *
 * The headless check proves the numbers move; this produces the picture that
 * says whether the result is legible. It renders a chart, a long table and a
 * stats row at DSH's smallest, default and largest settings side by side.
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
// Charts and diagrams pull their engine in through require.async, so the real
// chunk has to be reachable for the same reason the browser needs it.
const echartsChunk = existsSync(join(root, 'client.echarts.js'))
  ? readFileSync(join(root, 'client.echarts.js'), 'utf8')
  : ''
const REACT = 'https://unpkg.com/react@18/umd/react.production.min.js'
const REACT_DOM = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js'

const tallRows = Array.from({ length: 24 }, (_, r) => [`row ${r + 1}`, `${r * 7}`, `${r * 3}`, `${r * 11}`, `${r * 2}`, `${r * 5}`, `${r * 13}`, `${r * 17}`])

const SPECS = {
  table: { kind: 'table', title: 'Long table (24 rows, 8 columns)', columns: Array.from({ length: 8 }, (_, i) => `Column ${i + 1}`), rows: tallRows },
  stats: { kind: 'stats', title: 'Headline figures', stats: [{ label: 'Latency', value: 128, hint: 'p95' }, { label: 'Throughput', value: 4820 }, { label: 'Errors', value: 3, tone: 'error' }] },
  chart: { kind: 'chart', variant: 'bar', title: 'Build phase', unit: 'ms', series: [{ label: 'Parse', value: 12 }, { label: 'Compile', value: 148 }, { label: 'Link', value: 63 }] },
  steps: { kind: 'steps', title: 'Procedure', steps: [{ text: 'Collect the inputs', detail: 'from the workspace' }, { text: 'Validate the spec' }, { text: 'Render the card' }] },
  progress: { kind: 'progress', title: 'Coverage', value: 42, max: 60, unit: ' files', label: 'Files covered', tone: 'success' },
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:20px;background:#fff;font-family:system-ui,sans-serif;width:1180px}
.col{width:360px} h2{font:600 12px system-ui;color:#888;margin:0 0 8px}
.row{display:flex;gap:20px;align-items:flex-start;margin-bottom:24px}</style>
</head><body>
<div id="harness"></div>
<script src="${REACT}"></script>
<script src="${REACT_DOM}"></script>
<script>window.__pending=[];window.__ModuleLoader__={load:function(r){window.__pending.push(r)}};</script>
<script>${client}</script>
<script>${echartsChunk}</script>
<script>
var React = window.React, ReactDOM = window.ReactDOM;
var SPE = ${JSON.stringify(SPECS)};
// The first registration is the plugin; the second is the chart engine chunk,
// which the loader would resolve on require.async('./client.echarts.js').
var reg = window.__pending[0];
var engine = window.__pending[1];
var engineApi = engine ? engine.factory(function () { throw new Error('engine requires nothing') }) : null;
var mounted = null;
var ctx = {
  effect: function (fn) { try { fn() } catch (e) {} return function () {} },
  on: function () { return function () {} },
  locale: { register: function () { return function () {} } },
  slots: {
    inject: function (k, cb) { try { cb() } catch (e) {} return function () {} },
    register: function (o, c) { mounted = c; return function () {} },
  },
};
var require = function () { return React };
require.async = function (id) {
  if (!engineApi) return Promise.reject(new Error('no engine chunk at ' + id));
  return Promise.resolve(engineApi);
};
reg.factory(require).apply(ctx);

var sizes = [10, 14, 22];
var names = Object.keys(SPE);
var harness = document.getElementById('harness');
window.__errors = [];
var origError = console.error;
console.error = function () { window.__errors.push([].join.call(arguments, ' ')); origError.apply(console, arguments) };
window.addEventListener('error', function (e) { window.__errors.push('window.onerror: ' + (e.message || e)) });
names.forEach(function (name) {
  var row = document.createElement('div'); row.className = 'row';
  sizes.forEach(function (px) {
    var col = document.createElement('div'); col.className = 'col';
    col.style.setProperty('--dsh-content-font-size', px + 'px');
    var h = document.createElement('h2'); h.textContent = name + ' @ ' + px + 'px';
    var host = document.createElement('div');
    col.appendChild(h); col.appendChild(host); row.appendChild(col);
    harness.appendChild(row);
    try {
      ReactDOM.createRoot(host).render(React.createElement(mounted, {
        block: { kind: 'tool', call: { argsRaw: JSON.stringify({ spec: SPE[name] }) } },
        t: function (k) { return k },
      }));
    } catch (e) { window.__errors.push(name + '@' + px + ': ' + (e && e.message || e)) }
  });
});
setTimeout(function () {
  var mark = document.createElement('pre');
  mark.id = 'errors';
  mark.textContent = 'ERRORS:' + JSON.stringify(window.__errors);
  document.body.appendChild(mark);
  document.title = 'SHOT:ready errors=' + window.__errors.length;
}, 3000);
</script></body></html>`

const htmlPath = join(outDir, 'sheet.html')
writeFileSync(htmlPath, html, 'utf8')

const profile = join(tmpdir(), 'dsh-intelligent-ui-shot-profile')
const shot = join(outDir, 'font-sheet.png')
// A screenshot cannot report a thrown error, so the same page is dumped as DOM
// on the next run and the collected messages read off it.
const domFile = join(outDir, 'shot-dom.txt')
const script = `
$p = Start-Process -FilePath ${JSON.stringify(BROWSER)} -ArgumentList @(
  '--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--hide-scrollbars',
  '--virtual-time-budget=15000','--window-size=1220,2400',
  '--user-data-dir=${profile.replace(/\\/g, '\\\\')}',
  '--screenshot=${shot.replace(/\\/g, '\\\\')}',
  ${JSON.stringify('file:///' + htmlPath.replace(/\\/g, '/'))}
) -Wait -PassThru -NoNewWindow -RedirectStandardError ${JSON.stringify(join(outDir, 'shot-err.txt'))}
$p2 = Start-Process -FilePath ${JSON.stringify(BROWSER)} -ArgumentList @(
  '--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--hide-scrollbars',
  '--virtual-time-budget=15000','--window-size=1220,2400',
  '--user-data-dir=${profile.replace(/\\/g, '\\\\')}',
  '--dump-dom', ${JSON.stringify('file:///' + htmlPath.replace(/\\/g, '/'))}
) -Wait -PassThru -NoNewWindow -RedirectStandardOutput ${JSON.stringify(domFile)} -RedirectStandardError ${JSON.stringify(join(outDir, 'shot-dom-err.txt'))}
exit $p.ExitCode
`
execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 })
console.log(`wrote ${shot}`)

const dom = readFileSync(domFile, 'utf8')
const errors = dom.match(/ERRORS:(\[.*?\])<\/pre>/s)?.[1] ?? '[]'
const list = JSON.parse(errors.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
console.log(`page errors: ${list.length}`)
for (const e of list) console.log(`  ${e}`)
