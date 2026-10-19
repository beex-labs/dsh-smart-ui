/**
 * Headless-DOM behaviour checks for `kind: "app"` and `kind: "playground"`.
 *
 * Run: node test/app-render.mjs
 *
 * Loads the real `client.js` and the generated `client.engine.js` chunk into
 * headless Chrome, mounts specs through the registered tool view, and drives
 * the DOM with real events (native setter + dispatched input/change/click — no
 * ReactTestUtils). The page reports measurements through `document.title`; the
 * assertions run here in Node with `node:assert`, so a failure names the
 * behaviour rather than a DOM dump.
 *
 * The chart/mermaid chunks are deliberately rejected here (see `reject` below):
 * a chart must degrade to its plain-bar fallback without crashing, and the
 * fallback keeps every series value in the DOM where a check can read it.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateApp } from '../engine.cjs'
import { pageHtml, dumpDom, titleResult, BROWSER } from './_app-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out-app')
mkdirSync(outDir, { recursive: true })

// ── specs ──────────────────────────────────────────────────────────────────
// One linked app: qty × price feeds KPI, chart and table from one compute, and
// `people` fans out to a second KPI plus the chart and the table.

const SPEC_LINKED = {
  kind: 'app',
  title: 'Linked',
  state: { qty: 2, price: 50, people: 2 },
  compute: { total: 'qty * price', per: 'total / people' },
  tree: {
    id: 'root', type: 'column',
    children: [
      {
        id: 'qty', type: 'input', props: { label: 'Qty', type: 'number' },
        bind: { value: 'qty' },
        on: { input: { action: 'set', path: 'qty' }, change: { action: 'set', path: 'qty' } },
      },
      {
        id: 'people', type: 'slider', props: { label: 'People', min: 1, max: 8, step: 1 },
        bind: { value: 'people' },
        on: { change: { action: 'set', path: 'people' } },
      },
      { id: 'k-total', type: 'kpi', props: { label: 'Total' }, bind: { value: 'total' } },
      { id: 'k-per', type: 'kpi', props: { label: 'Per person' }, bind: { value: 'per' } },
      {
        id: 'ch', type: 'barChart', props: { label: 'Totals' },
        bind: { series: '[{label: "total", value: total}, {label: "per", value: per}]' },
      },
      {
        id: 'tbl', type: 'dataTable', props: { columns: ['k', 'v'] },
        bind: { rows: '[["total", total], ["per", per]]' },
      },
    ],
  },
}

const button = (id, label, on) => ({ id, type: 'button', props: { label }, on })

const SPEC_COPY = {
  kind: 'app',
  tree: {
    id: 'root', type: 'column',
    children: [button('copy-btn', 'Copy', { click: { action: 'copy', text: 'hello world' } })],
  },
}

const SPEC_CALL = {
  kind: 'app',
  tree: {
    id: 'root', type: 'column',
    children: [button('call-btn', 'Call service', { click: { action: 'call', service: 'booking', payload: { id: 1 } } })],
  },
}

const SPEC_OPEN = {
  kind: 'app',
  tree: {
    id: 'root', type: 'column',
    children: [button('open-btn', 'Open docs', { click: { action: 'open', url: 'https://example.com/docs' } })],
  },
}

// A node whose render really throws: `children: 'oops'` where an array is
// required, so the child resolution blows up inside the node's own inner
// render. Its boundary must box it while the sibling survives. (Malformed
// *data* props no longer crash: chart series is shape-checked at validation
// and tolerated at render.)
const SPEC_THROW = {
  kind: 'app',
  tree: {
    id: 'root', type: 'column',
    children: [
      { id: 'survivor', type: 'text', props: { text: 'still here' } },
      { id: 'boom', type: 'box', props: {}, children: 'oops' },
    ],
  },
}

// Unvalidated trees below: the Host would reject them, the Client must degrade.
const SPEC_UNKNOWN = {
  kind: 'app',
  tree: {
    id: 'root', type: 'column',
    children: [
      { id: 'alive', type: 'text', props: { text: 'alive again' } },
      { id: 'weird', type: 'totallyUnknown', props: {} },
    ],
  },
}

const SPEC_BIND = {
  kind: 'app',
  tree: {
    id: 'root', type: 'column',
    children: [{ id: 'bound', type: 'text', bind: { text: 'total +' } }],
  },
}

const SPEC_STREAM = {
  kind: 'app',
  stream: { mode: 'mock', intervalMs: 40 },
  tree: {
    id: 'root', type: 'column',
    children: Array.from({ length: 6 }, (_, i) => ({
      id: `k${i + 1}`, type: 'kpi', props: { label: `k${i + 1}` },
    })),
  },
}

const PLAY_APP = { state: { x: 1 }, tree: { id: 'root', type: 'kpi', props: { label: 'X' }, bind: { value: 'x' } } }
const SPEC_PLAY_BAD = { kind: 'playground', source: '{"tree": ' }
const SPEC_PLAY_GOOD = { kind: 'playground', source: JSON.stringify(PLAY_APP, null, 2) }

// The page always receives the normalized spec, exactly what the Host stores
// in argsRaw after `validateApp` — a bare `set` action only means "the event
// value" after normalization turns it into `{$event: true}`.
const N = {}
for (const [name, spec] of Object.entries({
  SPEC_LINKED, SPEC_COPY, SPEC_CALL, SPEC_OPEN, SPEC_STREAM,
})) {
  N[name] = validateApp(spec)
}
// Unvalidated inputs travel to the page verbatim: the Host would reject these,
// the Client must degrade — SPEC_THROW is malformed on purpose (its children
// are not an array), so it can only reach the page unvalidated.
Object.assign(N, { SPEC_UNKNOWN, SPEC_BIND, SPEC_THROW, SPEC_PLAY_BAD, SPEC_PLAY_GOOD })

// ── the page ───────────────────────────────────────────────────────────────

const body = `
var R = { ctxErrors: window.__ctxErrors };
var A = window.H;

// Action effect stubs the runtime talks to.
window.__clip = { calls: [], reject: false };
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: function (text) {
    window.__clip.calls.push(text);
    return window.__clip.reject ? Promise.reject(new Error('permission denied')) : Promise.resolve();
  } },
  configurable: true,
});
window.__openCalls = []; window.__openBlocked = true;
window.open = function (url, target, features) {
  window.__openCalls.push([url, target, features]);
  return window.__openBlocked ? null : {};
};

(async function () {
  try {
    if (!A.mounted) throw new Error('the plugin did not register a tool view');

    // 1 + 2 + 3: bound tree, then one input change fanning out to KPI, chart
    // and table in the same tick cycle, then the slider fan-out.
    var h1 = A.mount(${JSON.stringify(N.SPEC_LINKED)});
    await A.wait(80);
    R.bound = A.readApp(h1);
    A.setValue(h1.q('#f-qty'), '5');
    await A.wait(80);
    R.afterQty = A.readApp(h1);
    A.setValue(h1.q('#f-people'), '5');
    await A.wait(80);
    R.afterPeople = A.readApp(h1);
    h1.unmount();

    // 4a: copy succeeds → clipboard + success toast; rejection → failure toast
    // with the reason.
    var h2 = A.mount(${JSON.stringify(N.SPEC_COPY)});
    await A.wait(60);
    window.__clip.calls = []; window.__clip.reject = false;
    A.click(A.button(h2, 'Copy'));
    await A.wait(60);
    R.copyOk = A.readApp(h2);
    R.copyText = window.__clip.calls.slice();
    window.__clip.calls = []; window.__clip.reject = true;
    A.click(A.button(h2, 'Copy'));
    await A.wait(60);
    R.copyFail = A.readApp(h2);
    R.copyFailText = window.__clip.calls.slice();
    h2.unmount();

    // 4b: an unregistered service reports "not connected", never a success.
    var h3 = A.mount(${JSON.stringify(N.SPEC_CALL)});
    await A.wait(60);
    A.click(A.button(h3, 'Call service'));
    await A.wait(80);
    R.call = A.readApp(h3);
    h3.unmount();

    // 4c: a blocked window.open reports the block.
    var h4 = A.mount(${JSON.stringify(N.SPEC_OPEN)});
    await A.wait(60);
    window.__openCalls = []; window.__openBlocked = true;
    A.click(A.button(h4, 'Open docs'));
    await A.wait(60);
    R.open = A.readApp(h4);
    R.openCalls = window.__openCalls.slice();
    h4.unmount();

    // 5: error boundary — the throwing node is boxed, its sibling survives.
    var h5 = A.mount(${JSON.stringify(N.SPEC_THROW)});
    await A.wait(100);
    R.boundary = A.readApp(h5);
    h5.unmount();

    // 6: unknown node type → the unknown-component box.
    var h6 = A.mount(${JSON.stringify(N.SPEC_UNKNOWN)});
    await A.wait(80);
    R.unknown = A.readApp(h6);
    h6.unmount();

    // 7: a broken binding surfaces inline as .iui-bind-error.
    var h7 = A.mount(${JSON.stringify(N.SPEC_BIND)});
    await A.wait(80);
    R.bind = A.readApp(h7);
    h7.unmount();

    // 8: mock streaming — empty first, fully rendered at stream.done.
    var h8 = A.mount(${JSON.stringify(N.SPEC_STREAM)});
    await A.wait(5);
    R.streamStart = A.readApp(h8);
    R.growth = [];
    var done = await A.waitFor(function () {
      var snap = A.readApp(h8);
      R.growth.push(snap.kpiCount);
      return snap.kpiCount === 6 && snap.stream.join(' ').indexOf('Stream complete') >= 0;
    }, 8000);
    R.streamEnd = A.readApp(h8);
    R.streamDone = Boolean(done);
    h8.unmount();

    // 9: playground — broken JSON reports, a valid schema validates + previews,
    // and editing the source then Apply re-validates.
    var h9 = A.mount(${JSON.stringify(N.SPEC_PLAY_BAD)});
    await A.waitFor(function () {
      var v = h9.q('.iui-validate');
      return v !== null && v.getAttribute('data-ok') === 'false' && v.textContent.trim() !== '';
    }, 6000);
    R.playBad = A.readApp(h9);
    h9.unmount();

    var h10 = A.mount(${JSON.stringify(N.SPEC_PLAY_GOOD)});
    await A.waitFor(function () {
      var v = h10.q('.iui-validate');
      return v !== null && v.getAttribute('data-ok') === 'true';
    }, 6000);
    R.playGood = A.readApp(h10);
    A.setValue(h10.q('.iui-editor'), '{"tree": ');
    A.click(A.button(h10, 'Apply'));
    await A.wait(100);
    R.playEdited = A.readApp(h10);
    h10.unmount();
  } catch (error) {
    R.fatal = String((error && error.stack) || error);
  }
  document.title = 'RESULT:' + JSON.stringify(R);
})();
`

const htmlPath = join(outDir, 'render.html')
writeFileSync(htmlPath, pageHtml({ body, reject: ['client.echarts.js', 'client.mermaid.js'] }), 'utf8')

const dom = dumpDom(htmlPath, join(outDir, 'render-dom.txt'), join(outDir, 'render-err.txt'), {
  profile: join(process.env.TEMP ?? '.', 'dsh-iui-app-render-profile'),
  width: 1280, height: 1200, budget: 30000,
})
writeFileSync(join(outDir, 'rendered.html'), dom, 'utf8')

const R = titleResult(dom, 'RESULT:')
if (R === null) {
  console.error('FAIL: the page did not report a result; is ' + BROWSER + ' runnable?')
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
const hasToast = (snap, tone, needle) => snap.toasts.some((t) => (tone === undefined || t.tone === tone) && t.text.includes(needle))

check('the page mounted the plugin and ran without a fatal error', () => {
  assert.equal(R.fatal, undefined, R.fatal ?? '')
  assert.deepEqual(R.ctxErrors, [], 'plugin ctx errors')
})

// ── 1: bindings render from compute ────────────────────────────────────────
console.log('\n-- bound tree --')
check('the KPI values come from compute, not literals', () => {
  assert.deepEqual(R.bound.kpis, ['100', '50'])
  assert.equal(R.bound.nodeErrors.length, 0)
})
check('the chart series and table rows are bound to the same compute', () => {
  assert.deepEqual(R.bound.barLabels, ['total', 'per'])
  assert.deepEqual(R.bound.bars, ['100', '50'])
  assert.deepEqual(R.bound.cells, ['total', '100', 'per', '50'])
})

// ── 2 + 3: one change propagates to several nodes ──────────────────────────
console.log('\n-- interactivity --')
check('an input change updates KPI, chart and table in one cycle', () => {
  assert.deepEqual(R.afterQty.kpis, ['250', '125'], JSON.stringify(R.afterQty.kpis))
  assert.deepEqual(R.afterQty.bars, ['250', '125'])
  assert.deepEqual(R.afterQty.cells, ['total', '250', 'per', '125'])
})
check('the slider change reaches two dependent nodes at once', () => {
  assert.notEqual(R.afterPeople.kpis[1], R.afterQty.kpis[1], 'the per-person KPI did not move')
  assert.notEqual(R.afterPeople.bars[1], R.afterQty.bars[1], 'the chart bar did not move')
  assert.notEqual(R.afterPeople.cells[3], R.afterQty.cells[3], 'the table cell did not move')
  assert.deepEqual(R.afterPeople.kpis, ['250', '50'])
  assert.deepEqual(R.afterPeople.bars, ['250', '50'])
  assert.deepEqual(R.afterPeople.cells, ['total', '250', 'per', '50'])
})
check('an unrelated node stays put', () => {
  assert.equal(R.afterPeople.kpis[0], R.afterQty.kpis[0])
})

// ── 4: action router ───────────────────────────────────────────────────────
console.log('\n-- action router --')
check('copy writes through the Clipboard API and toasts success', () => {
  assert.deepEqual(R.copyText, ['hello world'])
  assert.ok(hasToast(R.copyOk, 'success', 'Copied to clipboard'), JSON.stringify(R.copyOk.toasts))
})
check('a rejected copy shows the failure toast with the reason', () => {
  assert.deepEqual(R.copyFailText, ['hello world'], 'the write was still attempted')
  const fail = R.copyFail.toasts.find((t) => t.tone === 'error')
  assert.ok(fail, JSON.stringify(R.copyFail.toasts))
  assert.ok(fail.text.includes('Copy failed'), fail.text)
  assert.ok(fail.text.includes('permission denied'), fail.text)
})
check('an unregistered service reports "not connected" and never a success', () => {
  assert.ok(hasToast(R.call, 'error', 'booking: not connected'), JSON.stringify(R.call.toasts))
  assert.ok(!R.call.toasts.some((t) => t.tone === 'success'), JSON.stringify(R.call.toasts))
})
check('a blocked window.open reports the block and names the URL', () => {
  assert.deepEqual(R.openCalls.map((c) => c[0]), ['https://example.com/docs'])
  assert.ok(hasToast(R.open, 'error', 'The browser blocked the new window'), JSON.stringify(R.open.toasts))
  assert.ok(!R.open.toasts.some((t) => t.tone === 'success'), JSON.stringify(R.open.toasts))
})

// ── 5 + 6 + 7: degradation ─────────────────────────────────────────────────
console.log('\n-- error boundary and degradation --')
check('a throwing node renders its .iui-node-error box with the node id', () => {
  assert.equal(R.boundary.nodeErrors.length, 1, JSON.stringify(R.boundary.nodeErrors))
  assert.ok(R.boundary.nodeErrors[0].includes('boom'), R.boundary.nodeErrors[0])
})
check('the rest of the tree still renders around the failing node', () => {
  assert.ok(R.boundary.text.includes('still here'), R.boundary.text.slice(0, 200))
})
check('an unknown type degrades to the unknown-component box', () => {
  assert.equal(R.unknown.nodeErrors.length, 1, JSON.stringify(R.unknown.nodeErrors))
  assert.ok(R.unknown.nodeErrors[0].includes('Unknown component'), R.unknown.nodeErrors[0])
  assert.ok(R.unknown.nodeErrors[0].includes('totallyUnknown'), R.unknown.nodeErrors[0])
  assert.ok(R.unknown.text.includes('alive again'), 'the sibling node did not survive')
})
check('a broken binding surfaces .iui-bind-error instead of blanking', () => {
  assert.equal(R.bind.bindErrors.length, 1, JSON.stringify(R.bind.bindErrors))
  assert.ok(R.bind.bindErrors[0].includes('Binding error'), R.bind.bindErrors[0])
  assert.ok(R.bind.bindErrors[0].includes('text'), R.bind.bindErrors[0])
})

// ── 8: mock streaming ──────────────────────────────────────────────────────
console.log('\n-- mock streaming --')
check('the stream starts with an empty tree', () => {
  assert.equal(R.streamStart.kpiCount, 0)
  assert.ok(R.streamStart.text.includes('Preparing card…'), R.streamStart.text.slice(0, 120))
  assert.ok(R.streamStart.stream.join(' ').includes('Streaming…'), JSON.stringify(R.streamStart.stream))
})
check('the tree grows node by node', () => {
  assert.ok(R.growth.some((n) => n > 0 && n < 6), 'never observed a partial tree: ' + JSON.stringify(R.growth))
})
check('the stream ends fully rendered and reports completion', () => {
  assert.equal(R.streamDone, true, 'stream never finished: ' + JSON.stringify(R.growth))
  assert.equal(R.streamEnd.kpiCount, 6)
  assert.ok(R.streamEnd.stream.join(' ').includes('Stream complete'), JSON.stringify(R.streamEnd.stream))
})

// ── 9: playground ──────────────────────────────────────────────────────────
console.log('\n-- playground --')
check('broken JSON reports a validation error', () => {
  assert.equal(R.playBad.validate[0].ok, 'false')
  assert.ok(R.playBad.validate[0].text.length > 0, 'no error text')
})
check('a valid schema validates and renders its preview', () => {
  assert.equal(R.playGood.validate[0].ok, 'true')
  assert.ok(R.playGood.validate[0].text.includes('Schema is valid'), R.playGood.validate[0].text)
  assert.ok(R.playGood.kpiCount >= 1, 'no preview rendered')
  assert.ok(R.playGood.kpis.includes('1'), 'preview KPI did not read state: ' + JSON.stringify(R.playGood.kpis))
})
check('editing the source and pressing Apply re-validates', () => {
  assert.equal(R.playEdited.validate[0].ok, 'false', R.playEdited.validate[0].text)
})

console.log(`\npage: ${htmlPath}`)
if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`OK: ${checks} checks passed`)
