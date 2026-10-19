/**
 * One-off check for the demos/ specs (ponytail: smallest thing that fails
 * if a demo stops validating, stops computing, or stops being interactive).
 *
 * Run from the plugin root: node demos/check.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateApp, computeAll, parseExpression, evaluateExpression } from '../engine.cjs'

const dir = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(dir).filter((f) => /^\d-.*\.json$/.test(f)).sort()
assert.equal(files.length, 7, `expected 7 demo specs, found ${files.length}`)

const NUMERIC_KEYS = {
  '1-travel.json': ['perPerson', 'dailyBudget', 'lodging', 'food', 'transport', 'tickets', 'buffer'],
  '2-analytics.json': ['weeklyBase', 'weeklyOrders', 'weeklyUnits', 'total', 'avgWeek', 'peak'],
  '3-invest.json': ['fv', 'contributed', 'gains'],
  '4-learn.json': ['c2', 'area'],
  '5-split.json': ['tipAmt', 'total', 'perPerson'],
  '6-quiz.json': ['score', 'maxScore'],
  '7-stream.json': ['throughput', 'latency', 'errRate'],
}

const specOf = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'))
const computeOf = (file, mutate = () => {}) => {
  const spec = specOf(file)
  const state = structuredClone(spec.state)
  mutate(state)
  return computeAll(spec.compute ?? {}, state)
}

let checks = 0
const ok = (msg) => { checks += 1; console.log(`ok  ${msg}`) }

const walk = (node, fn) => { fn(node); for (const child of node.children ?? []) walk(child, fn) }

// 1. every spec validates, computes finite numbers, and every bind resolves
for (const file of files) {
  const spec = specOf(file)
  const app = validateApp({ ...spec, kind: 'app' })
  assert.equal(app.kind, 'app')
  const computed = computeAll(spec.compute ?? {}, spec.state)
  for (const [key, value] of Object.entries(computed)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${file} compute.${key} must be finite, got ${value}`)
  }
  for (const key of NUMERIC_KEYS[file]) {
    assert.equal(typeof computed[key], 'number', `${file} compute.${key} should be a number`)
    assert.ok(Number.isFinite(computed[key]), `${file} compute.${key} must be finite`)
  }
  const scope = { ...spec.state, ...computed }
  walk(app.tree, (node) => {
    for (const [key, src] of Object.entries(node.bind ?? {})) {
      const value = evaluateExpression(parseExpression(src), scope)
      assert.ok(value !== undefined, `${file} ${node.id}.bind.${key} evaluated to undefined`)
    }
  })
  ok(`${file} validates · ${Object.keys(computed).length} compute keys finite · binds resolve`)
}

// 2. one input change per demo must move a bound value
{
  const base = computeOf('1-travel.json')
  const more = computeOf('1-travel.json', (s) => { s.people = 8 })
  assert.equal(base.perPerson, 8000, 'travel: 32000/4 = 8000')
  assert.equal(more.perPerson, 4000, 'travel: 32000/8 = 4000')
  ok('1-travel  people 4→8 halves perPerson 8000→4000')
}
{
  const rev = computeOf('2-analytics.json')
  const ord = computeOf('2-analytics.json', (s) => { s.segment = 'orders' })
  const hot = computeOf('2-analytics.json', (s) => { s.traffic = 2000 })
  assert.notDeepEqual(rev.chartSeries, ord.chartSeries, 'analytics: segment switches the chart series')
  assert.notEqual(rev.total, ord.total, 'analytics: KPI total follows the segment')
  assert.ok(hot.total > rev.total * 1.9, 'analytics: doubling traffic nearly doubles the total')
  ok('2-analytics  segment swaps series · traffic 1000→2000 scales totals')
}
{
  const low = computeOf('3-invest.json')
  const high = computeOf('3-invest.json', (s) => { s.rate = 0.08 })
  assert.ok(low.fv > low.contributed, 'invest: default scenario gains')
  assert.ok(high.fv > low.fv, 'invest: rate 6%→8% raises future value')
  ok(`3-invest  rate 0.06→0.08 raises fv ${Math.round(low.fv)}→${Math.round(high.fv)}`)
}
{
  const base = computeOf('4-learn.json')
  const wider = computeOf('4-learn.json', (s) => { s.a = 6 })
  assert.equal(base.c2, 25, 'learn: 3²+4² = 25')
  assert.equal(wider.c2, 52, 'learn: 6²+4² = 52')
  assert.equal(wider.area, 12, 'learn: area 6*4/2 = 12')
  ok('4-learn  a 3→6 moves c² 25→52 and area 6→12')
}
{
  const base = computeOf('5-split.json')
  const more = computeOf('5-split.json', (s) => { s.people = 8 })
  assert.equal(base.perPerson, 66, 'split: (240+24)/4 = 66')
  assert.equal(more.perPerson, 33, 'split: (240+24)/8 = 33')
  ok('5-split  people 4→8 halves perPerson 66→33')
}
{
  const mid = computeOf('6-quiz.json')
  const full = computeOf('6-quiz.json', (s) => { s.quiz = { score: 4, total: 4, index: 3 } })
  assert.equal(mid.isFull, false, 'quiz: 0/4 is not a pass')
  assert.equal(full.isFull, true, 'quiz: 4/4 flips isFull')
  assert.match(full.statusText, /全部答对/, 'quiz: status text flips on pass')
  ok('6-quiz  score 0→4 flips isFull false→true')
}
{
  const base = computeOf('7-stream.json')
  const hot = computeOf('7-stream.json', (s) => { s.load = 70 })
  assert.ok(hot.throughput > base.throughput * 1.8, 'stream: load 35→70 nearly doubles throughput')
  assert.ok(hot.latency > base.latency, 'stream: load 35→70 raises latency')
  ok(`7-stream  load 35→70 moves throughput ${base.throughput}→${hot.throughput}`)
}

console.log(`\nall demos pass (${checks} checks)`)
