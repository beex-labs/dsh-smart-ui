/**
 * Render the Smart UI chart/diagram options to real SVG via ECharts SSR.
 *
 * The live DSH page is not reachable from a test script, so this harness is how
 * the visual layer gets checked: it builds the SAME option objects `client.js`
 * builds and renders them with echarts' own server-side renderer. That proves
 * the options are valid ECharts input and produces an image a human can inspect,
 * which assertions alone cannot.
 *
 * Run: node test/render-svg.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as echarts from 'echarts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })

// A concrete light-theme color set, standing in for what readColors() resolves.
const colors = {
  brand: '#247bbf', label: '#1a1a1a', muted: '#6b6b6b', layer: '#f0f0f0',
  border: '#e0e0e0', success: '#2e7d32', warn: '#b26a00', error: '#c62828', idle: '#9e9e9e',
}

const TONE = { neutral: 'idle', info: 'brand', success: 'success', warn: 'warn', error: 'error' }
const ALPHA = [1, 0.72, 0.52, 0.38, 0.27, 0.19, 0.13, 0.09]
const colorFor = (tone, i) => colors[tone ? TONE[tone] : 'brand'] ?? colors.brand
const alphaFor = (tone, i) => (tone ? 1 : ALPHA[i % ALPHA.length])
const fmt = (v) => (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 }))

// ── mirror of client.js chartOption ────────────────────────────────────────
function chartOption(spec) {
  const labels = spec.series.map((p) => p.label)
  const suffix = spec.unit ?? ''
  const axisText = { color: colors.muted, fontSize: 11 }
  const splitLine = { lineStyle: { color: colors.border } }
  const toned = spec.series.some((p) => p.tone)

  if (spec.variant === 'pie' || spec.variant === 'donut') {
    return {
      animation: false,
      textStyle: { color: colors.label, fontSize: 12 },
      legend: { bottom: 0, textStyle: axisText, icon: 'circle', itemWidth: 8, itemHeight: 8 },
      series: [{
        type: 'pie',
        radius: spec.variant === 'donut' ? ['46%', '70%'] : ['0%', '70%'],
        center: ['50%', '46%'],
        itemStyle: { borderColor: colors.layer, borderWidth: 2 },
        label: { color: colors.muted, fontSize: 11, formatter: '{b} {d}%' },
        labelLine: { lineStyle: { color: colors.border } },
        data: spec.series.map((p, i) => ({
          name: p.label, value: p.value,
          itemStyle: { color: colorFor(p.tone, i), opacity: alphaFor(p.tone, i) },
        })),
      }],
    }
  }

  const isLine = spec.variant === 'line'
  return {
    animation: false,
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    textStyle: { color: colors.label, fontSize: 12 },
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { ...axisText, interval: 0, hideOverlap: true },
      axisLine: { lineStyle: { color: colors.border } }, axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { ...axisText, formatter: (v) => `${fmt(v)}${suffix}` },
      splitLine,
    },
    series: [{
      type: isLine ? 'line' : 'bar',
      data: spec.series.map((p, i) => ({
        value: p.value,
        itemStyle: {
          color: colorFor(p.tone, i), opacity: alphaFor(p.tone, i),
          borderRadius: isLine ? 0 : [3, 3, 0, 0],
        },
      })),
      smooth: isLine, symbolSize: 6,
      lineStyle: { width: 2, color: colors.brand },
      areaStyle: isLine && !toned ? { color: colors.brand, opacity: 0.12 } : undefined,
      barMaxWidth: 48,
    }],
  }
}

// ── mirror of client.js layeredLayout + diagramOption ──────────────────────
function layeredLayout(nodes, edges, vertical) {
  const outgoing = new Map(nodes.map((n) => [n.id, []]))
  const indegree = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) { outgoing.get(e.from).push(e.to); indegree.set(e.to, indegree.get(e.to) + 1) }
  const depth = new Map()
  let frontier = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  if (frontier.length === 0) frontier = [nodes[0].id]
  for (const id of frontier) depth.set(id, 0)
  for (let pass = 0; pass <= nodes.length && frontier.length > 0; pass += 1) {
    const next = []
    for (const id of frontier) for (const to of outgoing.get(id) ?? []) {
      const c = depth.get(id) + 1
      if ((depth.get(to) ?? -1) < c) { depth.set(to, c); next.push(to) }
    }
    frontier = next
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0)
  const columns = new Map()
  for (const n of nodes) {
    const d = depth.get(n.id)
    if (!columns.has(d)) columns.set(d, [])
    columns.get(d).push(n)
  }
  const span = vertical ? 110 : 150
  const lane = vertical ? 130 : 64
  // Mirror of the client's overlap fix: a layer must clear its widest box.
  const widest = Math.max(...nodes.map((n) => Math.max(96, n.label.length * 7 + 28)))
  const step = vertical ? span : widest + 64
  const points = []
  for (const [d, column] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    column.forEach((n, i) => {
      const offset = (i - (column.length - 1) / 2) * lane
      points.push({
        ...n, x: vertical ? offset : d * step, y: vertical ? d * span : offset,
        symbolSize: [Math.max(96, n.label.length * 7 + 28), 36],
      })
    })
  }
  return { points, links: edges.map((e) => ({ source: e.from, target: e.to, label: e.label })) }
}

function diagramOption(spec) {
  const vertical = spec.layout === 'tree'
  const { points, links } = layeredLayout(spec.nodes, spec.edges, vertical)
  return {
    animation: false,
    textStyle: { color: colors.label, fontSize: 12 },
    series: [{
      type: 'graph', layout: 'none', roam: false, symbol: 'roundRect',
      label: { show: true, color: colors.label, fontSize: 12, formatter: (p) => p.data.name },
      edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 9,
      edgeLabel: { show: true, fontSize: 10, color: colors.muted, formatter: (p) => p.data.label ?? '' },
      lineStyle: { color: colors.muted, width: 1.5, curveness: 0.06, opacity: 0.85 },
      data: points.map((p) => ({
        id: p.id, name: p.label, detail: p.detail, x: p.x, y: p.y, symbolSize: p.symbolSize,
        itemStyle: {
          color: p.tone ? colorFor(p.tone, 0) : colors.layer,
          opacity: p.tone ? 0.9 : 1,
          borderColor: p.tone ? colorFor(p.tone, 0) : colors.border, borderWidth: 1.5,
        },
        label: { color: p.tone ? '#fff' : colors.label },
      })),
      links,
    }],
  }
}

/** Render one option to an SVG file and report its size. */
function render(name, option, width, height) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  chart.setOption(option)
  const svg = chart.renderToSVGString()
  chart.dispose()
  const file = join(outDir, `${name}.svg`)
  writeFileSync(file, svg, 'utf8')
  const nodes = (svg.match(/<(rect|circle|path|text|polyline|ellipse)\b/g) ?? []).length
  console.log(`${name.padEnd(22)} ${String(width).padStart(4)}x${String(height).padEnd(4)} ${String(svg.length).padStart(7)}B  ${nodes} drawables`)
  return { file, svg, nodes }
}

console.log('rendering Smart UI options through ECharts SSR\n')

const results = {}
results.bar = render('chart-bar', chartOption({
  variant: 'bar', unit: 'ms',
  series: [{ label: 'Parse', value: 12 }, { label: 'Compile', value: 148 }, { label: 'Link', value: 63 }],
}), 520, 220)

results.toned = render('chart-bar-toned', chartOption({
  variant: 'bar',
  series: [
    { label: 'Passed', value: 45, tone: 'success' },
    { label: 'Skipped', value: 3, tone: 'warn' },
    { label: 'Failed', value: 2, tone: 'error' },
  ],
}), 520, 220)

results.line = render('chart-line', chartOption({
  variant: 'line', unit: 'K',
  series: [{ label: 'Q1', value: 412 }, { label: 'Q2', value: 388 }, { label: 'Q3', value: 505 }, { label: 'Q4', value: 297 }],
}), 520, 220)

results.donut = render('chart-donut', chartOption({
  variant: 'donut',
  series: [{ label: 'North', value: 412 }, { label: 'South', value: 388 }, { label: 'East', value: 505 }, { label: 'West', value: 297 }],
}), 520, 260)

results.pie = render('chart-pie', chartOption({
  variant: 'pie',
  series: [{ label: 'Core', value: 55 }, { label: 'UI', value: 30 }, { label: 'Tests', value: 15 }],
}), 520, 260)

// The user's own example: a linear call path, which is what `flow` is for.
results.flow = render('diagram-flow', diagramOption({
  layout: 'flow',
  nodes: [
    { id: 'ui', label: 'LoginWindow' },
    { id: 'api', label: 'ClientApi' },
    { id: 'sess', label: 'DeviceSessionService' },
    { id: 'http', label: 'V4ApiTransport' },
    { id: 'srv', label: 'Server', tone: 'info' },
  ],
  edges: [
    { from: 'ui', to: 'api', label: 'Submit' },
    { from: 'api', to: 'sess', label: 'Activate' },
    { from: 'sess', to: 'http', label: 'POST' },
    { from: 'http', to: 'srv', label: 'HTTPS' },
  ],
}), 760, 260)

// A hierarchy, which is what `tree` is for.
results.tree = render('diagram-tree', diagramOption({
  layout: 'tree',
  nodes: [
    { id: 'root', label: 'KePlugin' },
    { id: 'core', label: 'Core' }, { id: 'ui', label: 'UI' }, { id: 'revit', label: 'Revit' },
    { id: 'sess', label: 'DeviceSession' }, { id: 'login', label: 'LoginWindow' },
  ],
  edges: [
    { from: 'root', to: 'core' }, { from: 'root', to: 'ui' }, { from: 'root', to: 'revit' },
    { from: 'core', to: 'sess' }, { from: 'ui', to: 'login' },
  ],
}), 640, 380)

// A cycle must still lay out and terminate.
results.cycle = render('diagram-cycle', diagramOption({
  layout: 'flow',
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
}), 620, 240)

const total = Object.values(results).reduce((sum, r) => sum + r.nodes, 0)
console.log(`\n${Object.keys(results).length} figures, ${total} drawables, written to ${outDir}`)

// Every figure must carry real drawing commands, not an empty canvas.
const empty = Object.entries(results).filter(([, r]) => r.nodes < 3)
if (empty.length > 0) {
  console.error(`\nFAIL: figures with almost no drawables: ${empty.map(([k]) => k).join(', ')}`)
  process.exit(1)
}
console.log('OK: every figure drew content')
