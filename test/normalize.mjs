/**
 * Self-check for the Smart UI spec normalizer.
 *
 * Run: node test/normalize.mjs
 *
 * The normalizer is the one piece of real logic in this plugin: it decides what
 * reaches the page. A regression here shows up as a silently empty or wrong
 * card, so every kind gets a happy path and the guards get a failing path.
 */

import assert from 'node:assert/strict'
import { normalizeSpec } from '../index.js'

let checks = 0
const check = (name, fn) => { fn(); checks += 1; console.log(`ok  ${name}`) }
const throws = (name, input) => check(name, () => assert.throws(() => normalizeSpec(input)))

// ── happy paths, one per kind ───────────────────────────────────────────────

check('compare keeps columns and rows', () => {
  const spec = normalizeSpec({
    kind: 'compare',
    title: 'Runtime',
    columns: ['Bun', 'Node'],
    rows: [{ label: 'Startup', cells: ['12ms', '40ms'] }],
  })
  assert.equal(spec.kind, 'compare')
  assert.equal(spec.title, 'Runtime')
  assert.deepEqual(spec.columns, ['Bun', 'Node'])
  assert.deepEqual(spec.rows[0].cells, ['12ms', '40ms'])
})

check('chart normalizes points and keeps unit', () => {
  const spec = normalizeSpec({
    kind: 'chart',
    unit: '%',
    series: [{ label: 'a', value: 3 }, { label: 'b', value: 7, hint: 'peak' }],
  })
  assert.equal(spec.unit, '%')
  assert.equal(spec.series.length, 2)
  assert.equal(spec.series[1].hint, 'peak')
  assert.equal(spec.series[0].hint, undefined)
})

check('stats normalizes figures', () => {
  const spec = normalizeSpec({ kind: 'stats', stats: [{ label: 'Latency', value: 128 }] })
  assert.equal(spec.stats[0].label, 'Latency')
  assert.equal(spec.stats[0].value, 128)
})

check('steps accepts bare strings and objects', () => {
  const spec = normalizeSpec({ kind: 'steps', steps: ['first', { text: 'second', detail: 'why' }] })
  assert.deepEqual(spec.steps, [{ text: 'first' }, { text: 'second', detail: 'why' }])
})

check('table keeps rectangular cells', () => {
  const spec = normalizeSpec({ kind: 'table', columns: ['a', 'b'], rows: [['1', '2']] })
  assert.deepEqual(spec.rows, [['1', '2']])
})

check('calculator defaults to split with no fields', () => {
  const spec = normalizeSpec({ kind: 'calculator' })
  assert.equal(spec.mode, 'split')
  assert.deepEqual(spec.fields, [])
})

check('calculator carries declared ranges', () => {
  const spec = normalizeSpec({
    kind: 'calculator',
    mode: 'tip',
    fields: [{ label: 'Tip %', value: 15, min: 0, max: 50 }],
  })
  assert.equal(spec.mode, 'tip')
  assert.deepEqual(spec.fields[0], { label: 'Tip %', value: 15, min: 0, max: 50 })
})

check('unit keeps units and factors', () => {
  const spec = normalizeSpec({
    kind: 'unit',
    units: ['m', 'ft'],
    factors: { m: 1, ft: 3.28084 },
    value: 2,
    from: 'm',
    to: 'ft',
  })
  assert.deepEqual(spec.units, ['m', 'ft'])
  assert.equal(spec.factors.ft, 3.28084)
  assert.equal(spec.to, 'ft')
})

check('note defaults to info tone', () => {
  assert.equal(normalizeSpec({ kind: 'note', text: 'hi' }).tone, 'info')
  assert.equal(normalizeSpec({ kind: 'note', text: 'hi', tone: 'warn' }).tone, 'warn')
})

// ── chart variants ──────────────────────────────────────────────────────────

check('chart defaults to a bar variant', () => {
  assert.equal(normalizeSpec({ kind: 'chart', series: [{ label: 'a', value: 1 }] }).variant, 'bar')
})

check('chart accepts pie, donut and line', () => {
  for (const variant of ['pie', 'donut', 'line']) {
    const spec = normalizeSpec({ kind: 'chart', variant, series: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] })
    assert.equal(spec.variant, variant)
  }
})

throws('rejects an unknown chart variant', { kind: 'chart', variant: 'radar', series: [{ label: 'a', value: 1 }] })
throws('rejects a one-point line chart', { kind: 'chart', variant: 'line', series: [{ label: 'a', value: 1 }] })

// ── tone: semantic only, never a color ──────────────────────────────────────

check('keeps a semantic tone on a chart point', () => {
  const spec = normalizeSpec({
    kind: 'chart',
    series: [{ label: 'pass', value: 9, tone: 'success' }, { label: 'fail', value: 1, tone: 'error' }],
  })
  assert.equal(spec.series[0].tone, 'success')
  assert.equal(spec.series[1].tone, 'error')
  assert.equal(spec.series[0].hint, undefined)
})

check('accepts neutral and info tones', () => {
  const spec = normalizeSpec({ kind: 'stats', stats: [{ label: 'a', value: 1, tone: 'neutral' }, { label: 'b', value: 2, tone: 'info' }] })
  assert.equal(spec.stats[0].tone, 'neutral')
  assert.equal(spec.stats[1].tone, 'info')
})

throws('rejects a literal color where a tone belongs', { kind: 'chart', series: [{ label: 'a', value: 1, tone: '#ff0000' }] })
throws('rejects an unknown tone name', { kind: 'stats', stats: [{ label: 'a', value: 1, tone: 'good' }] })

// ── progress ────────────────────────────────────────────────────────────────

check('progress defaults max to 100', () => {
  const spec = normalizeSpec({ kind: 'progress', value: 42, label: 'Tests passing' })
  assert.equal(spec.max, 100)
  assert.equal(spec.value, 42)
  assert.equal(spec.label, 'Tests passing')
})

check('progress takes an explicit max and unit', () => {
  const spec = normalizeSpec({ kind: 'progress', value: 7, max: 9, unit: ' suites', tone: 'success' })
  assert.equal(spec.max, 9)
  assert.equal(spec.unit, ' suites')
  assert.equal(spec.tone, 'success')
})

throws('rejects progress without a value', { kind: 'progress' })
throws('rejects a non-positive progress max', { kind: 'progress', value: 1, max: 0 })
throws('rejects a negative progress value', { kind: 'progress', value: -1 })

// ── diagram ─────────────────────────────────────────────────────────────────

check('diagram normalizes nodes and edges', () => {
  const spec = normalizeSpec({
    kind: 'diagram',
    nodes: [{ id: 'a', label: 'Request' }, { id: 'b', label: 'Auth', tone: 'warn' }],
    edges: [{ from: 'a', to: 'b', label: 'token' }],
  })
  assert.equal(spec.layout, 'flow')
  assert.equal(spec.nodes.length, 2)
  assert.equal(spec.nodes[1].tone, 'warn')
  assert.equal(spec.edges[0].label, 'token')
})

check('diagram accepts a tree layout with no edges', () => {
  const spec = normalizeSpec({ kind: 'diagram', layout: 'tree', nodes: [{ id: 'root', label: 'Root' }] })
  assert.equal(spec.layout, 'tree')
  assert.deepEqual(spec.edges, [])
})

throws('rejects a diagram edge naming an undeclared node', {
  kind: 'diagram', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'ghost' }],
})
throws('rejects duplicate diagram node ids', {
  kind: 'diagram', nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }],
})
throws('rejects an unknown diagram layout', { kind: 'diagram', layout: 'radial', nodes: [{ id: 'a', label: 'A' }] })
throws('rejects an empty diagram', { kind: 'diagram', nodes: [] })

// ── diagram: the structured form compiles to Mermaid on the Host ────────────

check('compiles a structured diagram to Mermaid flowchart source', () => {
  const spec = normalizeSpec({
    kind: 'diagram',
    layout: 'flow',
    nodes: [{ id: 'a', label: 'Login' }, { id: 'b', label: 'Server' }],
    edges: [{ from: 'a', to: 'b', label: 'POST' }],
  })
  assert.equal(spec.origin, 'structured')
  assert.match(spec.mermaid, /^flowchart LR/)
  assert.match(spec.mermaid, /a\["Login"\]/)
  assert.match(spec.mermaid, /a -->\|"POST"\| b/)
})

check('a tree layout compiles top-down', () => {
  const spec = normalizeSpec({ kind: 'diagram', layout: 'tree', nodes: [{ id: 'r', label: 'Root' }] })
  assert.match(spec.mermaid, /^flowchart TD/)
})

check('a tone becomes a Mermaid class assignment', () => {
  const spec = normalizeSpec({
    kind: 'diagram',
    nodes: [{ id: 'a', label: 'Ok', tone: 'success' }, { id: 'b', label: 'Bad', tone: 'error' }],
  })
  assert.match(spec.mermaid, /classDef tone_success/)
  assert.match(spec.mermaid, /class a tone_success/)
  assert.match(spec.mermaid, /class b tone_error/)
})

check('escapes a quote in a label so the source stays parseable', () => {
  const spec = normalizeSpec({ kind: 'diagram', nodes: [{ id: 'a', label: 'say "hi"' }] })
  assert.match(spec.mermaid, /a\["say &quot;hi&quot;"\]/)
  assert.ok(!/say "hi"/.test(spec.mermaid), 'a raw quote would break the Mermaid parse')
})

// ── diagram: the raw Mermaid form ───────────────────────────────────────────

check('accepts raw Mermaid source', () => {
  const spec = normalizeSpec({ kind: 'diagram', mermaid: 'sequenceDiagram\n  A->>B: hi' })
  assert.equal(spec.origin, 'raw')
  assert.match(spec.mermaid, /^sequenceDiagram/)
})

check('accepts every UML family as raw source', () => {
  for (const source of [
    'classDiagram\n  A --> B',
    'stateDiagram-v2\n  [*] --> A',
    'erDiagram\n  A ||--o{ B : has',
    'mindmap\n  root((x))',
    'gantt\n  title t',
    'pie title t\n  "a" : 1',
  ]) {
    assert.equal(normalizeSpec({ kind: 'diagram', mermaid: source }).mermaid, source)
  }
})

throws('rejects a diagram with neither source nor nodes', { kind: 'diagram' })
throws('rejects combining mermaid with nodes', {
  kind: 'diagram', mermaid: 'flowchart LR\n a-->b', nodes: [{ id: 'a', label: 'A' }],
})
throws('rejects over-long Mermaid source', { kind: 'diagram', mermaid: `flowchart LR\n${'x'.repeat(13000)}` })

// ── guards: each must reach the model as a corrective error ────────────────

throws('rejects a non-object spec', 'compare')
throws('rejects an unknown kind', { kind: 'pie' })
throws('rejects compare with one column', { kind: 'compare', columns: ['only'], rows: [] })
throws('rejects a row whose cells do not match the columns', {
  kind: 'compare', columns: ['a', 'b'], rows: [{ label: 'r', cells: ['1'] }],
})
throws('rejects an empty chart', { kind: 'chart', series: [] })
throws('rejects a non-numeric chart value', { kind: 'chart', series: [{ label: 'a', value: 'x' }] })
throws('rejects a NaN stat', { kind: 'stats', stats: [{ label: 'a', value: Number.NaN }] })
throws('rejects an empty step list', { kind: 'steps', steps: [] })
throws('rejects a ragged table row', { kind: 'table', columns: ['a', 'b'], rows: [['1']] })
throws('rejects an unknown calculator mode', { kind: 'calculator', mode: 'compound' })
throws('rejects a unit list of one', { kind: 'unit', units: ['m'] })
throws('rejects an unknown tone', { kind: 'note', text: 'x', tone: 'loud' })

// ── optional fields: blank means absent, never an error ─────────────────────
// A model that fills an optional suffix with "" must still get its card; only a
// required field may fail on blank.

check('drops a blank optional title instead of failing', () => {
  const spec = normalizeSpec({ kind: 'note', text: 'x', title: '   ', caption: '' })
  assert.equal(spec.title, undefined)
  assert.equal(spec.caption, undefined)
})

check('drops a blank chart unit', () => {
  const spec = normalizeSpec({ kind: 'chart', series: [{ label: 'a', value: 1 }], unit: '' })
  assert.equal(spec.unit, undefined)
})

check('drops a blank step detail', () => {
  const spec = normalizeSpec({ kind: 'steps', steps: [{ text: 'go', detail: '' }] })
  assert.deepEqual(spec.steps, [{ text: 'go' }])
})

throws('still rejects a blank required field', { kind: 'note', text: '   ' })
throws('rejects a non-string optional field', { kind: 'note', text: 'x', title: 7 })

console.log(`\n${checks} checks passed`)
