/**
 * Check that cards follow the user's content font size and cap long tables.
 *
 * Run: node test/font-and-overflow.mjs
 *
 * Two behaviours can only be judged in a real layout engine, so this loads the
 * actual `client.js` into a headless browser and measures the result:
 *
 *   1. the card's type must track `--dsh-content-font-size` on `document.body`,
 *      the one variable DSH's theme presenter publishes the setting through;
 *   2. a table over 15 rows must scroll vertically inside the card, while a wide
 *      one scrolls horizontally with no column limit.
 *
 * Assertions alone cannot see either, because both are computed styles.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(here, 'out-font')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// A Windows GUI-subsystem binary detaches from the calling console, so plain
// spawn/stdout capture yields nothing. Launch through PowerShell's
// Start-Process with explicit redirection instead.
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const BROWSER = CHROME_CANDIDATES.find((p) => existsSync(p))
if (BROWSER === undefined) throw new Error('no Chromium browser found for headless rendering')

/**
 * Render one local HTML file headlessly and return its post-script DOM.
 * @param htmlPath - absolute path of the page to load.
 * @returns the dumped DOM.
 */
function dumpDom(htmlPath) {
  const profile = join(tmpdir(), 'dsh-intelligent-ui-font-profile')
  const outFile = join(outDir, 'dom.txt')
  const errFile = join(outDir, 'err.txt')
  const script = `
$p = Start-Process -FilePath ${JSON.stringify(BROWSER)} -ArgumentList @(
  '--headless=new','--disable-gpu','--no-sandbox','--no-first-run',
  '--disable-extensions','--virtual-time-budget=20000',
  '--user-data-dir=${profile.replace(/\\/g, '\\\\')}',
  '--dump-dom', ${JSON.stringify('file:///' + htmlPath.replace(/\\/g, '/'))}
) -Wait -PassThru -NoNewWindow -RedirectStandardOutput ${JSON.stringify(outFile)} -RedirectStandardError ${JSON.stringify(errFile)}
exit $p.ExitCode
`
  try {
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
    })
  } catch (error) {
    if (!existsSync(outFile)) throw error
  }
  return readFileSync(outFile, 'utf8')
}

const client = readFileSync(join(root, 'client.js'), 'utf8')

// Node stubs for the bare module ids the loader would resolve.
const REACT = 'https://unpkg.com/react@18/umd/react.production.min.js'
const REACT_DOM = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js'

// Two specs: a plain table, and one well past the 15-row cap.
const MKS = (kind, columns, rows) => ({ kind, columns, rows })
const wideColumns = Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`)
const shortRows = Array.from({ length: 4 }, () => wideColumns.map((_, i) => `v${i}`))
const tallRows = Array.from({ length: 40 }, (_, r) => wideColumns.map((_, i) => `r${r}c${i}`))

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;width:760px}
#harness{width:760px}</style>
</head><body>
<div id="harness"></div>
<script src="${REACT}"></script>
<script src="${REACT_DOM}"></script>
<script>window.__pending=[];window.__ModuleLoader__={load:function(r){window.__pending.push(r)}};</script>
<script>${client}</script>
<script>
// Stand in for the shell: DSH's theme presenter writes the setting here.
document.body.style.setProperty('--dsh-content-font-size', '14px');

var React = window.React, ReactDOM = window.ReactDOM;
var reg = window.__pending[0];
var mounted = null, slots = {}, localeT = function (k) { return k };

// The slot factory calls ctx.slots.register with the options object; capture the
// component so the test can mount it directly, which is what the shell does.
var ctx = {
  effect: function (fn) { try { fn() } catch (e) { window.__ctxError = String(e) } return function () {} },
  on: function () { return function () {} },
  locale: { register: function () { return function () {} } },
  slots: {
    inject: function (key, cb) { slots.key = key; try { cb() } catch (e) { window.__ctxError = String(e) } return function () {} },
    register: function (options, component) { mounted = component; return function () {} },
  },
};
var api = reg.factory(function (id) {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
window.__ctxError = null;
try { api.apply(ctx) } catch (e) { window.__ctxError = String(e && e.message || e) }

var COLORS = {
  brand: '#247bbf', label: '#111', muted: '#666', layer: '#eee', border: '#ddd',
  success: '#2e7d32', warn: '#b26a00', error: '#c62828', idle: '#999',
};

var wideColumns = ${JSON.stringify(wideColumns)};
var shortRows = ${JSON.stringify(shortRows)};
var tallRows = ${JSON.stringify(tallRows)};

function block(spec) {
  return { kind: 'tool', call: { argsRaw: JSON.stringify({ spec: spec }) } };
}

var results = { ctxError: window.__ctxError, mounted: !!mounted, sizes: {}, overflow: {}, errors: [] };

/** Mount one spec at one font size and measure the rendered card. */
async function measure(spec, px) {
  document.body.style.setProperty('--dsh-content-font-size', px + 'px');
  var host = document.createElement('div');
  host.style.width = '760px';
  document.getElementById('harness').appendChild(host);
  var root = ReactDOM.createRoot(host);
  root.render(React.createElement(mounted, { block: block(spec), t: localeT }));
  await new Promise(function (r) { setTimeout(r, 60) });
  var card = host.querySelector('.iui-card');
  if (!card) { root.unmount(); host.remove(); throw new Error('no card rendered at ' + px + 'px') }
  var box = host.querySelector('.iui-scroll, .iui-scroll-y') || card;
  var cardPx = parseFloat(getComputedStyle(card).fontSize);
  var cellPx = parseFloat(getComputedStyle(card.querySelector('td') || card).fontSize);
  // The progress ring draws its figure as SVG text inside a CSS class, so this
  // is the check that the SVG path follows the setting too.
  var ringPx = card.querySelector('.iui-ring-num')
    ? parseFloat(getComputedStyle(card.querySelector('.iui-ring-num')).fontSize)
    : null;
  var out = {
    card: cardPx,
    cell: cellPx,
    ring: ringPx,
    scrollH: box.scrollHeight,
    clientH: box.clientHeight,
    scrollW: box.scrollWidth,
    clientW: box.clientWidth,
    rows: card.querySelectorAll('tbody tr').length,
    cols: card.querySelectorAll('thead th').length,
    scrollableY: box.scrollHeight > box.clientHeight + 1,
    scrollableX: box.scrollWidth > box.clientWidth + 1,
    scrollClass: box.className,
  };
  root.unmount(); host.remove();
  return out;
}

(async function () {
  if (!mounted) { document.title = 'RESULT:' + JSON.stringify(results); return }
  try {
    // 1. the type follows the setting at both ends of DSH's 10..22 range
    for (var px of [10, 14, 22]) {
      results.sizes[px] = await measure({ kind: 'table', title: 'T', columns: wideColumns.slice(0, 3), rows: shortRows.slice(0, 3).map(function (r) { return r.slice(0, 3) }) }, px);
    }
    // 2. a short wide table scrolls sideways and is NOT height-capped
    results.overflow.short = await measure({ kind: 'table', columns: wideColumns, rows: shortRows }, 14);
    // 3. a 40-row table is capped and scrolls vertically
    results.overflow.tall = await measure({ kind: 'table', columns: wideColumns, rows: tallRows }, 14);
    // 4. exactly 15 rows must NOT be capped (the boundary)
    results.overflow.exact = await measure({ kind: 'table', columns: wideColumns, rows: tallRows.slice(0, 15) }, 14);
    // 5. the cap grows with the type, so it stays "15 rows" at 22px
    results.overflow.tall22 = await measure({ kind: 'table', columns: wideColumns, rows: tallRows }, 22);
    // 6. compare uses the same cap
    results.overflow.compare = await measure({
      kind: 'compare', columns: wideColumns,
      rows: tallRows.map(function (r, i) { return { label: 'row ' + i, cells: r } }),
    }, 14);
    // 7. the progress ring's SVG figure follows the setting
    results.ring = {
      small: await measure({ kind: 'progress', value: 42, max: 60, label: 'Covered' }, 10),
      base: await measure({ kind: 'progress', value: 42, max: 60, label: 'Covered' }, 14),
      large: await measure({ kind: 'progress', value: 42, max: 60, label: 'Covered' }, 22),
    };
  } catch (e) {
    results.errors.push(String(e && e.stack || e));
  }
  document.title = 'RESULT:' + JSON.stringify(results);
})();
</script></body></html>`

const htmlPath = join(outDir, 'font.html')
writeFileSync(htmlPath, html, 'utf8')

const dom = dumpDom(htmlPath)
writeFileSync(join(outDir, 'rendered.html'), dom, 'utf8')

const title = dom.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
if (!title.startsWith('RESULT:')) {
  console.error('FAIL: the page did not report a result; first 800 chars of <title>:')
  console.error(title.slice(0, 800))
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

if (result.ctxError) { console.error('plugin apply() threw:', result.ctxError); process.exit(1) }
if (result.errors.length > 0) { console.error('page errors:\n' + result.errors.join('\n')); process.exit(1) }
check('the plugin registered a tool view', result.mounted)

console.log('\n-- type follows --dsh-content-font-size --')
for (const [px, m] of Object.entries(result.sizes)) {
  const want = Number(px)
  // The card is authored at 13px against the 14px default, so it tracks the
  // setting 1:1 rather than landing on it exactly.
  check(`card type tracks ${px}px`, Math.abs(m.card - (13 + (want - 14))) < 0.6, `card=${m.card}px cell=${m.cell}px`)
}
const [s10, , s22] = [result.sizes['10'], result.sizes['14'], result.sizes['22']]
check('type strictly grows with the setting', s10.card < s22.card, `${s10.card} < ${s22.card}`)
check('cells grow with the setting too', s10.cell < s22.cell, `${s10.cell} < ${s22.cell}`)

console.log('\n-- table overflow --')
const wide = result.overflow.short
check('a wide table scrolls horizontally', wide.scrollableX, `scrollW=${wide.scrollW} clientW=${wide.clientW}`)
check('a short table is not height-capped', !wide.scrollableY, `scrollH=${wide.scrollH} clientH=${wide.clientH}`)
check('no column limit is applied', wide.cols === 12, `${wide.cols} columns rendered`)

const tall = result.overflow.tall
check('a 40-row table is height-capped', tall.scrollableY, `scrollH=${tall.scrollH} clientH=${tall.clientH}`)
check('every row still renders inside the scroller', tall.rows === 40, `${tall.rows} rows in the DOM`)
check('the capped table scrolls sideways as well', tall.scrollableX)

const exact = result.overflow.exact
check('exactly 15 rows is not capped', !exact.scrollableY, `scrollH=${exact.scrollH} clientH=${exact.clientH}`)

const tall22 = result.overflow.tall22
// The cap is 15 rows, each of line box + 2 x padding + half the shared 1px
// collapsed border — the same arithmetic fontStyle() publishes as --iui-row-h.
// Sizes shift by the setting's offset from 14px rather than scaling by a ratio.
const rowH = (px) => (20 + (px - 14)) + (4 + (px - 14)) * 2 + 1.5
check('the cap grows with the type', tall22.clientH > tall.clientH, `14px cap=${tall.clientH}px, 22px cap=${tall22.clientH}px`)
// The cap must hold all 15 rows, and must not hold 16: that pins it to the
// boundary instead of merely "somewhere under the next row".
const holds = (clientH, px, rows) => clientH >= rows * (rowH(px) - 1) && clientH < (rows + 1) * (rowH(px) - 1)
check('the 14px cap holds exactly 15 rows', holds(tall.clientH, 14, 15), `${tall.clientH}px, 15 rows is ${Math.round(15 * (rowH(14) - 1))}px`)
check('the 22px cap holds exactly 15 rows', holds(tall22.clientH, 22, 15), `${tall22.clientH}px, 15 rows is ${Math.round(15 * (rowH(22) - 1))}px`)

check('compare uses the same cap', result.overflow.compare.scrollableY, `scrollH=${result.overflow.compare.scrollH} clientH=${result.overflow.compare.clientH}`)

console.log('\n-- the progress ring follows too --')
const ring = result.ring
check('the ring figure grows with the setting', ring.small.ring < ring.large.ring, `${ring.small.ring}px -> ${ring.base.ring}px -> ${ring.large.ring}px`)
check('the ring tracks the setting one for one', ring.large.ring - ring.base.ring === 8, `${ring.base.ring}px at 14px, ${ring.large.ring}px at 22px`)

console.log(`\npage: ${htmlPath}`)
if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('OK: type follows the setting, long tables cap and scroll')
