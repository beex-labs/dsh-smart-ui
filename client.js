/**
 * Smart UI — Client half.
 *
 * Registers one view in the keyed `tool.call.toolview` slot under the wire name
 * `ui_render`, so every call renders as an interactive card in the conversation
 * flow instead of a generic tool row.
 *
 * The card is a pure function of the tool arguments: it reads `block` (the
 * dispatched call, whose `argsRaw` holds the normalized spec the Host accepted)
 * and renders. Nothing is fetched from the Host and no state outlives the
 * component, so a reload, a fork, and a resume all redraw the same card from the
 * session log.
 *
 * Charts and diagrams render through Apache ECharts, loaded lazily as the
 * sibling chunk `client.echarts.js` (see build-echarts.mjs). Everything else is
 * plain React over theme tokens, so light and dark both work.
 */

window.__ModuleLoader__.load({
  id: 'dsh-smart-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useMemo, useEffect, useRef, useCallback } = React

    const NS = 'smart-ui'
    const PKG = 'dsh-smart-ui'

    /** The only static UI text this plugin owns; every other string is model data. */
    const DICTS = {
      en: {
        preparing: 'Preparing card…', unsupported: 'Unsupported card', rendering: 'Rendering chart…',
        chartFailed: 'Chart library unavailable — showing a plain summary.',
        amount: 'Amount', from: 'From', to: 'To', convertFrom: 'Convert from', convertTo: 'Convert to', slider: 'slider',
        of: 'of',
      },
      zh: {
        preparing: '正在准备卡片…', unsupported: '不支持的卡片', rendering: '正在渲染图表…',
        chartFailed: '图表库不可用——改为纯文本摘要。',
        amount: '数值', from: '从', to: '到', convertFrom: '转换自', convertTo: '转换为', slider: '滑块',
        of: '/',
      },
    }

    /** Semantic tone → theme token. A spec never carries a literal color. */
    const TONE_TOKEN = {
      neutral: '--dsw-alias-state-idle-primary',
      info: '--dsw-alias-brand-primary',
      success: '--dsw-alias-state-success-primary',
      warn: '--dsw-alias-state-warn-primary',
      error: '--dsw-alias-state-error-primary',
    }

    /**
     * Opacity steps for an untoned categorical series. The theme exposes five
     * semantic colors and none of them means "category 3", so plain data cycles
     * the brand color at decreasing opacity instead — theme-correct in both
     * schemes, and it never implies a status the data does not have.
     */
    const PALETTE_ALPHA = [1, 0.72, 0.52, 0.38, 0.27, 0.19, 0.13, 0.09]

    const CSS = `
.sui-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:14px;font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5;overflow:hidden}
.sui-title{font-weight:600;margin-bottom:10px;font-size:13px}
.sui-caption{margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:12px}
.sui-scroll{overflow-x:auto}
.sui-table{border-collapse:collapse;width:100%;font-size:12.5px}
.sui-table th,.sui-table td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.sui-table th{color:var(--dsw-alias-label-secondary);font-weight:600;font-size:12px}
.sui-table tr:last-child td{border-bottom:none}
.sui-table td.sui-num{font-variant-numeric:tabular-nums}
.sui-rowhead{color:var(--dsw-alias-label-secondary);font-weight:600}
.sui-chart{display:flex;flex-direction:column;gap:6px}
.sui-bar-row{display:grid;grid-template-columns:minmax(72px,26%) 1fr auto;align-items:center;gap:10px}
.sui-bar-label{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sui-bar-track{background:var(--dsw-alias-bg-layer-2);border-radius:4px;height:16px;overflow:hidden}
.sui-bar-fill{height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary);min-width:2px;transition:width .18s ease}
.sui-bar-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:12px}
.sui-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.sui-stat{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:10px;border-left:3px solid transparent}
.sui-stat-value{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.sui-stat-label{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.sui-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.sui-step{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start}
.sui-step-n{width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600}
.sui-step-detail{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.sui-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px}
.sui-field{display:flex;flex-direction:column;gap:4px}
.sui-field span{color:var(--dsw-alias-label-secondary);font-size:12px}
.sui-input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums}
.sui-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:var(--dsw-alias-brand-primary)}
.sui-range{width:100%;accent-color:var(--dsw-alias-brand-primary)}
.sui-result{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:6px}
.sui-result-row{display:flex;justify-content:space-between;gap:12px}
.sui-result-row b{font-variant-numeric:tabular-nums}
.sui-total{border-top:1px solid var(--dsw-alias-border-l1);padding-top:6px;font-weight:600}
.sui-note{display:flex;gap:10px;align-items:flex-start;border-left:3px solid var(--dsw-alias-brand-primary);padding:10px 12px;background:var(--dsw-alias-bg-layer-2);border-radius:0 8px 8px 0}
.sui-note-warn{border-left-color:var(--dsw-alias-state-warn-primary)}
.sui-note-success{border-left-color:var(--dsw-alias-state-success-primary)}
.sui-note-error{border-left-color:var(--dsw-alias-state-error-primary)}
.sui-note-neutral{border-left-color:var(--dsw-alias-state-idle-primary)}
.sui-empty{color:var(--dsw-alias-label-secondary)}
.sui-progress{display:flex;align-items:center;gap:16px}
.sui-ring{flex:none}
.sui-ring-track{stroke:var(--dsw-alias-bg-layer-2)}
.sui-ring-value{transition:stroke-dashoffset .3s ease}
.sui-ring-num{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;fill:var(--dsw-alias-label-primary)}
.sui-ring-unit{font-size:11px;fill:var(--dsw-alias-label-secondary)}
.sui-progress-body{min-width:0}
.sui-progress-label{font-weight:600}
.sui-progress-sub{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.sui-canvas{width:100%}
.sui-mermaid{width:100%;overflow-x:auto;text-align:center}
.sui-mermaid svg{max-width:100%;height:auto}
.sui-mmd-error{margin:8px 0 0;padding:8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-x:auto}
`

    /**
     * Resolve a theme token to a concrete color at call time.
     * @param name - the CSS custom property name.
     * @param fallback - used when the token is absent or the DOM is unavailable.
     * @returns a CSS color string.
     */
    function token(name, fallback) {
      if (typeof document === 'undefined') return fallback
      const value = getComputedStyle(document.documentElement).getPropertyValue(name)
      return value.trim() === '' ? fallback : value.trim()
    }

    /** Snapshot the theme colors a card needs, so a scheme switch re-renders. */
    function readColors() {
      return {
        brand: token('--dsw-alias-brand-primary', '#247bbf'),
        label: token('--dsw-alias-label-primary', '#111'),
        muted: token('--dsw-alias-label-secondary', '#666'),
        layer: token('--dsw-alias-bg-layer-2', '#eee'),
        border: token('--dsw-alias-border-l1', '#ddd'),
        success: token('--dsw-alias-state-success-primary', '#2e7d32'),
        warn: token('--dsw-alias-state-warn-primary', '#b26a00'),
        error: token('--dsw-alias-state-error-primary', '#c62828'),
        idle: token('--dsw-alias-state-idle-primary', '#999'),
      }
    }

    /**
     * Read the normalized spec from one tool block.
     * @param block - preparing, dispatched, or settled Tool block from the slot.
     * @returns the spec, or null when arguments are unavailable or malformed.
     */
    function readSpec(block) {
      const call = block && 'kind' in block ? block.call : block
      if (!call || typeof call.argsRaw !== 'string' || call.argsRaw === '') return null
      try {
        const parsed = JSON.parse(call.argsRaw)
        const spec = parsed && parsed.spec
        return spec && typeof spec === 'object' && typeof spec.kind === 'string' ? spec : null
      } catch {
        return null
      }
    }

    /**
     * Format a number for display without inventing precision.
     * @param value - the number to format.
     * @returns the display string.
     */
    function fmt(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '')
      if (Number.isInteger(value)) return value.toLocaleString()
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    /**
     * Resolve a semantic tone, or a positional palette step, to a color.
     * @param tone - the semantic name, when the spec set one.
     * @param index - the point's position, for the untoned palette.
     * @param colors - the current theme snapshot.
     * @returns a CSS color string.
     */
    function colorFor(tone, index, colors) {
      if (tone && TONE_TOKEN[tone]) return colors[tone === 'neutral' ? 'idle' : tone] ?? colors.brand
      return colors.brand
    }

    /** The opacity a point's series step uses; toned points are fully opaque. */
    function alphaFor(tone, index) {
      if (tone) return 1
      return PALETTE_ALPHA[index % PALETTE_ALPHA.length]
    }

    function Frame({ spec, children }) {
      return h('div', { className: 'sui-card' },
        spec.title ? h('div', { className: 'sui-title' }, spec.title) : null,
        children,
        spec.caption ? h('div', { className: 'sui-caption' }, spec.caption) : null)
    }

    function Compare({ spec }) {
      return h('div', { className: 'sui-scroll' },
        h('table', { className: 'sui-table' },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col' }, ''),
            spec.columns.map((column, index) => h('th', { key: index, scope: 'col' }, column)))),
          h('tbody', null, spec.rows.map((row, rowIndex) => h('tr', { key: rowIndex },
            h('th', { scope: 'row', className: 'sui-rowhead' }, row.label),
            row.cells.map((cell, cellIndex) => h('td', { key: cellIndex }, cell)))))))
    }

    function Stats({ spec, colors }) {
      const stats = Array.isArray(spec.stats) ? spec.stats : []
      return h('div', { className: 'sui-stats' }, stats.map((stat, index) => h('div', {
        key: index,
        className: 'sui-stat',
        style: stat.tone ? { borderLeftColor: colorFor(stat.tone, index, colors) } : undefined,
      },
      h('div', { className: 'sui-stat-value' }, fmt(stat.value)),
      h('div', { className: 'sui-stat-label' }, stat.hint ? `${stat.label} · ${stat.hint}` : stat.label))))
    }

    function Steps({ spec }) {
      return h('ol', { className: 'sui-steps' }, spec.steps.map((step, index) => h('li', { className: 'sui-step', key: index },
        h('div', { className: 'sui-step-n', 'aria-hidden': true }, index + 1),
        h('div', null,
          h('div', null, step.text),
          step.detail ? h('div', { className: 'sui-step-detail' }, step.detail) : null))))
    }

    function Table({ spec }) {
      return h('div', { className: 'sui-scroll' },
        h('table', { className: 'sui-table' },
          h('thead', null, h('tr', null, spec.columns.map((column, index) => h('th', { key: index, scope: 'col' }, column)))),
          h('tbody', null, spec.rows.map((row, rowIndex) => h('tr', { key: rowIndex },
            row.map((cell, cellIndex) => h('td', {
              key: cellIndex,
              className: cellIndex === 0 ? 'sui-rowhead' : 'sui-num',
            }, cell)))))))
    }

    function Note({ spec }) {
      const tone = spec.tone && spec.tone !== 'info' ? ` sui-note-${spec.tone}` : ''
      return h('div', { className: `sui-note${tone}` }, h('div', null, spec.text))
    }

    /**
     * A ratio as a ring plus its figure — the "how many of these passed" shape.
     * Drawn as inline SVG rather than through ECharts: one arc does not justify
     * waiting for the chart chunk.
     * @param props - the spec and the current theme colors.
     * @returns the progress card body.
     */
    function Progress({ spec, colors, t }) {
      const pct = Math.max(0, Math.min(spec.value / spec.max, 1))
      const size = 96
      const stroke = 9
      const radius = (size - stroke) / 2
      const circumference = 2 * Math.PI * radius
      const color = colorFor(spec.tone, 0, colors)
      const shown = Math.round(pct * 1000) / 10

      return h('div', { className: 'sui-progress' },
        h('svg', {
          className: 'sui-ring',
          width: size, height: size, viewBox: `0 0 ${size} ${size}`,
          role: 'img',
          'aria-label': `${fmt(spec.value)} ${t('of')} ${fmt(spec.max)}${spec.unit ?? ''} (${shown}%)`,
        },
        h('circle', {
          className: 'sui-ring-track', cx: size / 2, cy: size / 2, r: radius,
          fill: 'none', strokeWidth: stroke,
        }),
        h('circle', {
          className: 'sui-ring-value', cx: size / 2, cy: size / 2, r: radius,
          fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round',
          strokeDasharray: circumference,
          strokeDashoffset: circumference * (1 - pct),
          transform: `rotate(-90 ${size / 2} ${size / 2})`,
        }),
        h('text', { className: 'sui-ring-num', x: size / 2, y: size / 2 + 2, textAnchor: 'middle' }, `${shown}%`),
        h('text', { className: 'sui-ring-unit', x: size / 2, y: size / 2 + 18, textAnchor: 'middle' }, spec.unit ?? '')),
        h('div', { className: 'sui-progress-body' },
          h('div', { className: 'sui-progress-label' }, spec.label ?? `${fmt(spec.value)} ${t('of')} ${fmt(spec.max)}`),
          h('div', { className: 'sui-progress-sub' }, `${fmt(spec.value)} / ${fmt(spec.max)}${spec.unit ?? ''}`)))
    }

    /**
     * Mount an ECharts instance, loading the library chunk on first use.
     *
     * The chunk is a sibling file served from the plugin route, so a plain-JS
     * plugin ships a real charting library without a bundler. If it fails to
     * load, the caller's fallback renders instead of an empty box.
     * @param props - the ECharts option, height, and the fallback element.
     * @returns the chart host, or the fallback.
     */
    function EChart({ option, height, fallback, t }) {
      const host = useRef(null)
      const chart = useRef(null)
      const [lib, setLib] = useState(null)
      const [failed, setFailed] = useState(false)

      useEffect(() => {
        let alive = true
        require.async('./client.echarts.js')
          .then((mod) => { if (alive) setLib(mod) })
          .catch(() => { if (alive) setFailed(true) })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (lib === null || host.current === null) return undefined
        const instance = lib.init(host.current, null, { renderer: 'svg' })
        chart.current = instance
        const observer = typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => instance.resize())
        observer?.observe(host.current)
        return () => {
          observer?.disconnect()
          instance.dispose()
          chart.current = null
        }
      }, [lib])

      useEffect(() => {
        if (chart.current === null || option === null) return
        chart.current.setOption(option, true)
        chart.current.resize()
      }, [option, lib])

      if (failed) return fallback
      return h('div', null,
        h('div', { ref: host, className: 'sui-canvas', style: { height } }),
        lib === null && fallback !== null ? h('div', { className: 'sui-empty' }, t('rendering')) : null)
    }

    /**
     * Build the ECharts option for one chart spec.
     * @param spec - the normalized chart spec.
     * @param colors - the current theme snapshot.
     * @param t - the locale lookup.
     * @returns an ECharts option object.
     */
    function chartOption(spec, colors, t) {
      const labels = spec.series.map((point) => point.label)
      const values = spec.series.map((point) => point.value)
      const suffix = spec.unit ?? ''
      const axisText = { color: colors.muted, fontSize: 11 }
      const splitLine = { lineStyle: { color: colors.border } }
      const toned = spec.series.some((point) => point.tone)

      if (spec.variant === 'pie' || spec.variant === 'donut') {
        return {
          animationDuration: 260,
          textStyle: { color: colors.label, fontSize: 12 },
          tooltip: { trigger: 'item', valueFormatter: (value) => `${fmt(value)}${suffix}` },
          legend: { bottom: 0, textStyle: axisText, icon: 'circle', itemWidth: 8, itemHeight: 8 },
          series: [{
            type: 'pie',
            radius: spec.variant === 'donut' ? ['46%', '70%'] : ['0%', '70%'],
            center: ['50%', '46%'],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: colors.layer, borderWidth: 2 },
            label: { color: colors.muted, fontSize: 11, formatter: '{b} {d}%' },
            labelLine: { lineStyle: { color: colors.border } },
            data: spec.series.map((point, index) => ({
              name: point.label,
              value: point.value,
              itemStyle: {
                color: colorFor(point.tone, index, colors),
                opacity: alphaFor(point.tone, index),
              },
            })),
          }],
        }
      }

      const isLine = spec.variant === 'line'
      return {
        animationDuration: 260,
        grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
        textStyle: { color: colors.label, fontSize: 12 },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (value) => `${fmt(value)}${suffix}`,
        },
        xAxis: {
          type: 'category',
          data: labels,
          axisLabel: { ...axisText, interval: 0, hideOverlap: true },
          axisLine: { lineStyle: { color: colors.border } },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: { ...axisText, formatter: (value) => `${fmt(value)}${suffix}` },
          splitLine,
        },
        series: [{
          type: isLine ? 'line' : 'bar',
          data: spec.series.map((point, index) => ({
            value: point.value,
            itemStyle: {
              color: colorFor(point.tone, index, colors),
              opacity: alphaFor(point.tone, index),
              borderRadius: isLine ? 0 : [3, 3, 0, 0],
            },
          })),
          smooth: isLine,
          symbolSize: 6,
          lineStyle: { width: 2, color: colors.brand },
          areaStyle: isLine && !toned ? { color: colors.brand, opacity: 0.12 } : undefined,
          barMaxWidth: 48,
        }],
      }
    }

    /** A plain bar fallback, so a chart still reads when the chunk cannot load. */
    function PlainBars({ spec, colors }) {
      const peak = Math.max(...spec.series.map((point) => Math.abs(point.value)), 0) || 1
      return h('div', { className: 'sui-chart' }, spec.series.map((point, index) => {
        const text = `${fmt(point.value)}${spec.unit ?? ''}`
        return h('div', { className: 'sui-bar-row', key: index },
          h('div', { className: 'sui-bar-label', title: point.label }, point.label),
          h('div', { className: 'sui-bar-track', role: 'img', 'aria-label': `${point.label}: ${text}` },
            h('div', {
              className: 'sui-bar-fill',
              style: {
                width: `${Math.max((Math.abs(point.value) / peak) * 100, 1)}%`,
                background: colorFor(point.tone, index, colors),
                opacity: alphaFor(point.tone, index),
              },
            })),
          h('div', { className: 'sui-bar-value' }, text))
      }))
    }

    function Chart({ spec, colors, t }) {
      const option = useMemo(() => chartOption(spec, colors, t), [spec, colors, t])
      const height = spec.variant === 'pie' || spec.variant === 'donut' ? 240 : 220
      return h(EChart, {
        option,
        height,
        t,
        fallback: h(PlainBars, { spec, colors }),
      })
    }

    /**
     * Render Mermaid source to SVG.
     *
     * Mermaid owns the diagram family: real orthogonal routing and the UML
     * shapes (class, sequence, state, ER, mind map, Gantt), which a charting
     * library's relationship-graph mode does not. Its chunk is a sibling file
     * served from the plugin route, loaded on first use.
     *
     * Mermaid needs a document-attached container and throws on invalid source,
     * so both are handled here: a bad diagram degrades to its own message
     * instead of blanking the slot entry.
     *
     * @param props - the diagram source, the theme snapshot, and the locale lookup.
     * @returns the rendered diagram, a loading note, or the failure message.
     */
    function Mermaid({ source, colors, t }) {
      const [svg, setSvg] = useState(null)
      const [error, setError] = useState(null)
      const id = useRef(`sui-mmd-${Math.random().toString(36).slice(2, 10)}`)

      useEffect(() => {
        let alive = true
        setError(null)
        require.async('./client.mermaid.js')
          .then(async (mermaid) => {
            if (!alive) return
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: 'strict',
              theme: 'base',
              fontFamily: 'inherit',
              themeVariables: {
                fontFamily: 'inherit',
                fontSize: '13px',
                background: 'transparent',
                primaryColor: colors.layer,
                primaryTextColor: colors.label,
                primaryBorderColor: colors.border,
                lineColor: colors.muted,
                textColor: colors.label,
                // The tone classes the Host compiles resolve to these.
                ...Object.fromEntries(Object.entries(TONE_TOKEN).map(([tone]) => [`suiTone${tone}`, ''])),
              },
            })
            try {
              const out = await mermaid.render(id.current, source)
              if (alive) setSvg(out.svg)
            } catch (renderError) {
              if (alive) setError(String((renderError && renderError.message) || renderError))
            }
          })
          .catch(() => { if (alive) setError(t('chartFailed')) })
        return () => { alive = false }
      }, [source, colors, t])

      if (error !== null) {
        return h('div', null,
          h('div', { className: 'sui-empty' }, t('chartFailed')),
          h('pre', { className: 'sui-mmd-error' }, error))
      }
      if (svg === null) return h('div', { className: 'sui-empty' }, t('rendering'))
      // The markup is Mermaid's own output, not model-authored HTML, and
      // `securityLevel: 'strict'` sanitizes the labels that came from the model.
      return h('div', { className: 'sui-mermaid', dangerouslySetInnerHTML: { __html: svg } })
    }

    function Diagram({ spec, colors, t }) {
      const source = typeof spec.mermaid === 'string' ? spec.mermaid : ''
      if (source === '') {
        return h('div', { className: 'sui-empty' }, t('chartFailed'))
      }
      return h(Mermaid, { source, colors, t })
    }

    /** A labelled numeric input with an optional drag range. */
    function Field({ field, value, onChange, t }) {
      const id = `sui-${field.label.replace(/\W+/g, '-').toLowerCase()}`
      const hasRange = typeof field.min === 'number' && typeof field.max === 'number'
      return h('div', { className: 'sui-field' },
        h('label', { htmlFor: id }, field.label),
        h('input', {
          id,
          className: 'sui-input',
          type: 'number',
          value,
          min: field.min,
          max: field.max,
          step: 'any',
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        hasRange ? h('input', {
          className: 'sui-range',
          type: 'range',
          'aria-label': `${field.label} ${t('slider')}`,
          value: Number.isFinite(value) ? value : field.min,
          min: field.min,
          max: field.max,
          step: (field.max - field.min) / 100,
          onChange: (event) => onChange(Number(event.target.value)),
        }) : null)
    }

    function Calculator({ spec, t }) {
      const initial = useMemo(() => {
        const state = {}
        for (const field of spec.fields ?? []) state[field.label] = field.value
        if (Object.keys(state).length === 0) {
          Object.assign(state, spec.mode === 'tip'
            ? { 'Bill amount': 100, 'Tip %': 15, People: 2 }
            : { 'Bill amount': 100, People: 4, 'Tip %': 0 })
        }
        return state
      }, [spec])

      const [values, setValues] = useState(initial)
      const set = (label) => (next) => setValues((current) => ({ ...current, [label]: next }))

      const pick = (needle) => {
        const key = Object.keys(values).find((name) => name.toLowerCase().includes(needle))
        return key === undefined ? 0 : Number(values[key]) || 0
      }
      const amount = pick('bill') || pick('amount')
      const people = Math.max(Math.floor(pick('people')) || 1, 1)
      const rate = pick('tip')
      const tip = amount * (rate / 100)
      const total = amount + tip
      const each = total / people

      const rows = [
        ...(rate ? [['Tip', tip]] : []),
        ['Total', total],
        [`Per person (${people})`, each],
      ]

      return h('div', null,
        h('div', { className: 'sui-fields' }, Object.entries(values).map(([label, value]) => h(Field, {
          key: label,
          field: { label, value, ...(spec.fields ?? []).find((field) => field.label === label) },
          value,
          onChange: set(label),
          t,
        }))),
        h('div', { className: 'sui-result', role: 'status', 'aria-live': 'polite' },
          rows.map(([label, value], index) => h('div', {
            key: label,
            className: index === rows.length - 1 ? 'sui-result-row sui-total' : 'sui-result-row',
          }, h('span', null, label), h('b', null, fmt(Math.round(value * 100) / 100))))))
    }

    function Unit({ spec, t }) {
      const factors = useMemo(() => {
        const declared = spec.factors
        const out = {}
        spec.units.forEach((unit, index) => {
          out[unit] = declared && typeof declared[unit] === 'number' ? declared[unit] : index + 1
        })
        return out
      }, [spec])

      const [value, setValue] = useState(typeof spec.value === 'number' ? spec.value : 1)
      const [from, setFrom] = useState(spec.from && factors[spec.from] !== undefined ? spec.from : spec.units[0])
      const [to, setTo] = useState(spec.to && factors[spec.to] !== undefined ? spec.to : spec.units[1])
      const converted = (value * factors[from]) / factors[to]

      const select = (selected, onSelect, label) => h('select', {
        className: 'sui-input',
        'aria-label': label,
        value: selected,
        onChange: (event) => onSelect(event.target.value),
      }, spec.units.map((unit) => h('option', { key: unit, value: unit }, unit)))

      return h('div', null,
        h('div', { className: 'sui-fields' },
          h('div', { className: 'sui-field' },
            h('label', { htmlFor: 'sui-unit-value' }, t('amount')),
            h('input', {
              id: 'sui-unit-value',
              className: 'sui-input',
              type: 'number',
              step: 'any',
              value,
              onChange: (event) => setValue(Number(event.target.value)),
            })),
          h('div', { className: 'sui-field' }, h('span', null, t('from')), select(from, setFrom, t('convertFrom'))),
          h('div', { className: 'sui-field' }, h('span', null, t('to')), select(to, setTo, t('convertTo')))),
        h('div', { className: 'sui-result', role: 'status', 'aria-live': 'polite' },
          h('div', { className: 'sui-result-row sui-total' },
            h('span', null, `${fmt(value)} ${from} =`),
            h('b', null, `${fmt(Math.round(converted * 1e6) / 1e6)} ${to}`))))
    }

    /**
     * Render one `ui_render` call.
     * @param props - keyed Tool slot props: `block`, the locale lookup, and the theme store.
     * @returns the interactive card, or a fallback while arguments are incomplete.
     */
    function SmartUiView({ block, t, theme }) {
      // The slot's `locale` option supplies `t`; falling back keeps a missing
      // dictionary from throwing, which would blank the whole slot entry.
      const tr = useCallback((key) => (typeof t === 'function' ? t(key) : DICTS.en[key]), [t])
      const colors = useTheme(theme)

      const spec = readSpec(block)
      if (spec === null) {
        return h('div', { className: 'sui-card' }, h('div', { className: 'sui-empty' }, tr('preparing')))
      }
      let body
      switch (spec.kind) {
        case 'compare': body = h(Compare, { spec }); break
        case 'chart': body = h(Chart, { spec, colors, t: tr }); break
        case 'stats': body = h(Stats, { spec, colors }); break
        case 'progress': body = h(Progress, { spec, colors, t: tr }); break
        case 'steps': body = h(Steps, { spec }); break
        case 'table': body = h(Table, { spec }); break
        case 'diagram': body = h(Diagram, { spec, colors, t: tr }); break
        case 'calculator': body = h(Calculator, { spec, t: tr }); break
        case 'unit': body = h(Unit, { spec, t: tr }); break
        case 'note': body = h(Note, { spec }); break
        default: body = h('div', { className: 'sui-empty' }, `${tr('unsupported')}: ${spec.kind}`)
      }
      return h(Frame, { spec }, body)
    }

    /**
     * Subscribe to the theme store so a light/dark switch re-resolves colors.
     * @param theme - the store supplied through the slot's `inject`.
     * @returns the current color snapshot.
     */
    function useTheme(theme) {
      const [colors, setColors] = useState(() => (theme ? theme.getSnapshot() : readColors()))
      useEffect(() => {
        if (!theme) return undefined
        setColors(theme.getSnapshot())
        return theme.subscribe(() => setColors(theme.getSnapshot()))
      }, [theme])
      return colors
    }

    return {
      name: 'smart-ui',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'smart-ui: dictionaries')

        // Charts read concrete colors out of the theme, so a scheme switch has to
        // invalidate them; the snapshot identity changes only when it really did.
        let snapshot = null
        const listeners = new Set()
        const theme = {
          getSnapshot() {
            if (snapshot === null) snapshot = readColors()
            return snapshot
          },
          subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        }
        ctx.effect(() => ctx.on('theme/change', () => {
          snapshot = null
          for (const listener of listeners) listener()
        }), 'smart-ui: theme invalidation')

        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'ui_render',
          locale: NS,
          inject: () => ({ theme }),
        }, SmartUiView)), 'smart-ui: tool view')

        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const marker = `${PKG}/smart-ui.css`
          if (document.querySelector(`style[data-plugin-css=${JSON.stringify(marker)}]`) !== null) return () => {}
          const tag = document.createElement('style')
          tag.dataset.plugin = PKG
          tag.dataset.pluginCss = marker
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'smart-ui: styles')

        // The Host compiles `tone` into Mermaid classes that reference these
        // custom properties; publishing them keeps tone resolution on the theme
        // (and therefore correct in both schemes) rather than in the spec.
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const marker = `${PKG}/smart-ui-tones`
          if (document.querySelector(`style[data-plugin-css=${JSON.stringify(marker)}]`) !== null) return () => {}
          const rules = Object.entries(TONE_TOKEN)
            .map(([tone, token]) => `:root{--sui-tone-${tone}:var(${token})}`)
            .join('')
          const tag = document.createElement('style')
          tag.dataset.plugin = PKG
          tag.dataset.pluginCss = marker
          tag.textContent = rules
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'smart-ui: tone tokens')
      },
    }
  },
})
