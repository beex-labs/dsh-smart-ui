/**
 * Smart UI — host half.
 *
 * Owns the model-facing `ui_render` tool and the one prompt section that tells
 * the model when a card beats prose. All rendering happens in `client.js`; this
 * half only validates the spec, normalizes it, and keeps the text the model
 * reads in the transcript as the source of truth.
 *
 * The spec vocabulary is deliberately small and declarative: the model writes
 * data, never markup. Every kind is a plain JSON value, so the spec survives
 * the session log, a fork, and a resume unchanged.
 */

export const name = 'smart-ui'

/** The tool registry and the prompt registry must exist. */
export const inject = ['tools', 'systemPrompt']

/** Maximum nodes accepted in one spec, so a runaway model cannot wedge the page. */
const MAX_NODES = 400

/**
 * The prompt section: the model's contract for choosing a card over prose.
 * Kept next to the validator so the two cannot drift.
 *
 * The trigger list is deliberately concrete and countable. An earlier version
 * said only "when a visual layout communicates better than prose, otherwise
 * answer in text", and measured behaviour was that the model took the escape
 * hatch almost every time (1 of 3 neutral probes rendered a card; the other two
 * answered the calculator and steps cases as prose). A model cannot act on
 * "clearer" — it can act on "three or more things compared on shared criteria".
 */
const SECTION = `Prefer \`ui_render\` for any answer that is really a structure. Render a card when the answer has any of these shapes, and keep your prose as the short answer around it:

- three or more things compared on shared criteria → \`compare\`
- a series of magnitudes → \`chart\` variant \`bar\`; a trend across ordered points → \`line\`; parts of one whole → \`donut\` or \`pie\`
- two to six headline figures → \`stats\`
- one ratio the reader should feel at a glance, such as tests passed, a quota used, or progress toward a target → \`progress\`
- a procedure of three or more ordered steps → \`steps\`
- rows and columns of records → \`table\`
- boxes joined by arrows — a flow, a pipeline, a decision tree, a hierarchy or mind map, a dependency sketch, or a class/entity sketch → \`diagram\`. For a flowchart, mind map, class or ER sketch, pass \`nodes\`+\`edges\` (and \`layout: "tree"\` for a hierarchy). For a sequence diagram, state machine, Gantt chart or anything else, pass \`mermaid\` with the diagram source directly.
- any arithmetic the user may want to redo with their own numbers, such as a bill split, a tip, or a total → \`calculator\`
- a quantity converted between units → \`unit\`
- one thing the user must not miss → \`note\`

Set \`tone\` on a point or node only when it carries meaning the reader should catch at a glance — \`success\` for passing or good, \`error\` for failing or bad, \`warn\` for attention, \`neutral\` for context, \`info\` for emphasis. Leave \`tone\` unset for plain data: an untoned series already cycles a theme-correct palette, and a tone that means nothing is noise. Never invent colors — tones resolve to the application's own theme, so they stay correct in light and dark.

When several shapes apply, render the one that carries the most meaning and let the prose cover the rest; a second card is warranted only when the answer genuinely has two independent structures. Answer in plain text only when the answer is a single fact, a short explanation, or a narrative that has no structure to show — not merely because it is short. A card that repeats one sentence is worse than the sentence.

Write only data. The spec is JSON, never HTML or markup, and every string is rendered as text. Prefer the smallest spec that carries the meaning.`

/**
 * Read a required non-empty string.
 * @param value - candidate field.
 * @param path - field path for the error message.
 * @returns the trimmed string.
 */
function str(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value
}

/**
 * Read an optional string. A blank value means the field was not provided, so
 * the model gets a rendered card instead of a round-trip over an empty suffix.
 * @param value - candidate field.
 * @param path - field path for the error message.
 * @returns the string, or undefined when absent or blank.
 */
function optStr(value, path) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value.trim() === '' ? undefined : value
}

/**
 * Read a finite number.
 * @param value - candidate field.
 * @param path - field path for the error message.
 * @returns the number.
 */
function num(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`)
  }
  return value
}

/**
 * Read an optional finite number.
 * @param value - candidate field.
 * @param path - field path for the error message.
 * @returns the number, or undefined when absent.
 */
function optNum(value, path) {
  if (value === undefined || value === null) return undefined
  return num(value, path)
}

/**
 * Read an array of strings, used for a series of plain labels.
 * @param value - candidate field.
 * @param path - field path for the error message.
 * @returns the strings.
 */
function strList(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((entry, index) => str(entry, `${path}[${index}]`))
}

/**
 * Read a list of `{ label, value }` pairs, the shared shape of stats and chart
 * series. `tone` is optional and only ever names a semantic meaning; the Client
 * resolves it to a theme token, so a spec never carries a literal color.
 * @param value - candidate field.
 * @param path - field path for the error message.
 * @returns the normalized points.
 */
function points(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((entry, index) => {
    const at = `${path}[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${at} must be an object`)
    }
    const hint = optStr(entry.hint, `${at}.hint`)
    const tone = optStr(entry.tone, `${at}.tone`)
    if (tone !== undefined && !TONES.has(tone)) {
      throw new Error(`${at}.tone must be one of ${[...TONES].join(', ')}`)
    }
    return {
      label: str(entry.label, `${at}.label`),
      value: num(entry.value, `${at}.value`),
      ...hint === undefined ? {} : { hint },
      ...tone === undefined ? {} : { tone },
    }
  })
}

/**
 * Read an optional `tone` field, rejecting an unknown name.
 * @param value - candidate field.
 * @param path - field path for the error message.
 * @returns the tone, or undefined when absent.
 */
function optTone(value, path) {
  const tone = optStr(value, path)
  if (tone !== undefined && !TONES.has(tone)) {
    throw new Error(`${path} must be one of ${[...TONES].join(', ')}`)
  }
  return tone
}

/**
 * Validate and normalize one spec into the exact shape the Client renders.
 * Unknown kinds and malformed fields throw, so the model receives a corrective
 * error instead of a silently empty card.
 * @param input - the raw `spec` argument.
 * @returns the normalized spec.
 */
export function normalizeSpec(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('spec must be an object')
  }
  const kind = str(input.kind, 'spec.kind')
  if (!KIND_NAMES.has(kind)) {
    throw new Error(`spec.kind must be one of ${[...KIND_NAMES].join(', ')}`)
  }
  const title = optStr(input.title, 'spec.title')
  const caption = optStr(input.caption, 'spec.caption')
  const head = { kind, ...title === undefined ? {} : { title }, ...caption === undefined ? {} : { caption } }

  switch (kind) {
    case 'compare': {
      const columns = strList(input.columns, 'spec.columns')
      if (columns.length < 2) throw new Error('spec.columns needs at least 2 entries')
      if (!Array.isArray(input.rows)) throw new Error('spec.rows must be an array')
      const rows = input.rows.map((row, index) => {
        const at = `spec.rows[${index}]`
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          throw new Error(`${at} must be an object`)
        }
        if (!Array.isArray(row.cells) || row.cells.length !== columns.length) {
          throw new Error(`${at}.cells must have exactly ${columns.length} entries`)
        }
        return {
          label: str(row.label, `${at}.label`),
          cells: row.cells.map((cell, cellIndex) => str(cell, `${at}.cells[${cellIndex}]`)),
        }
      })
      return { ...head, columns, rows }
    }
    case 'chart': {
      const series = points(input.series, 'spec.series')
      if (series.length === 0) throw new Error('spec.series must not be empty')
      const variant = input.variant === undefined ? 'bar' : str(input.variant, 'spec.variant')
      if (!CHART_VARIANTS.has(variant)) {
        throw new Error(`spec.variant must be one of ${[...CHART_VARIANTS].join(', ')}`)
      }
      if (variant === 'line' && series.length < 2) {
        throw new Error('a line chart needs at least 2 points; use `bar` for a single value')
      }
      const unit = optStr(input.unit, 'spec.unit')
      return { ...head, variant, series, ...unit === undefined ? {} : { unit } }
    }
    case 'stats': {
      const stats = points(input.stats, 'spec.stats')
      if (stats.length === 0) throw new Error('spec.stats must not be empty')
      return { ...head, stats }
    }
    case 'progress': {
      const value = num(input.value, 'spec.value')
      const max = optNum(input.max, 'spec.max') ?? 100
      if (max <= 0) throw new Error('spec.max must be greater than 0')
      if (value < 0) throw new Error('spec.value must not be negative')
      const label = optStr(input.label, 'spec.label')
      const unit = optStr(input.unit, 'spec.unit')
      const tone = optTone(input.tone, 'spec.tone')
      return {
        ...head,
        value,
        max,
        ...label === undefined ? {} : { label },
        ...unit === undefined ? {} : { unit },
        ...tone === undefined ? {} : { tone },
      }
    }
    case 'diagram': {
      // Two ways in: raw Mermaid source (the full diagram vocabulary) or a
      // structured node/edge list compiled to a flowchart. Exactly one, so the
      // two can never disagree about what to draw.
      const mermaid = optStr(input.mermaid, 'spec.mermaid')
      const structured = input.nodes !== undefined || input.edges !== undefined
      if (mermaid !== undefined && structured) {
        throw new Error('spec.diagram takes either `mermaid` or `nodes`/`edges`, not both')
      }
      if (mermaid === undefined && !structured) {
        throw new Error('spec.diagram needs either `mermaid` source or `nodes`+`edges`')
      }
      if (mermaid !== undefined) {
        if (mermaid.length > MAX_MERMAID_CHARS) {
          throw new Error(`spec.mermaid is ${mermaid.length} chars, over the ${MAX_MERMAID_CHARS}-char limit`)
        }
        return { ...head, mermaid, origin: 'raw' }
      }

      if (!Array.isArray(input.nodes)) throw new Error('spec.nodes must be an array')
      const ids = new Set()
      const nodes = input.nodes.map((node, index) => {
        const at = `spec.nodes[${index}]`
        if (typeof node !== 'object' || node === null || Array.isArray(node)) {
          throw new Error(`${at} must be an object`)
        }
        const id = str(node.id, `${at}.id`)
        if (ids.has(id)) throw new Error(`${at}.id "${id}" is used twice; ids must be unique`)
        ids.add(id)
        const detail = optStr(node.detail, `${at}.detail`)
        const tone = optTone(node.tone, `${at}.tone`)
        return {
          id,
          label: str(node.label, `${at}.label`),
          ...detail === undefined ? {} : { detail },
          ...tone === undefined ? {} : { tone },
        }
      })
      if (nodes.length === 0) throw new Error('spec.nodes must not be empty')
      const edges = Array.isArray(input.edges)
        ? input.edges.map((edge, index) => {
          const at = `spec.edges[${index}]`
          if (typeof edge !== 'object' || edge === null || Array.isArray(edge)) {
            throw new Error(`${at} must be an object`)
          }
          const from = str(edge.from, `${at}.from`)
          const to = str(edge.to, `${at}.to`)
          if (!ids.has(from)) throw new Error(`${at}.from "${from}" is not a declared node id`)
          if (!ids.has(to)) throw new Error(`${at}.to "${to}" is not a declared node id`)
          const label = optStr(edge.label, `${at}.label`)
          return { from, to, ...label === undefined ? {} : { label } }
        })
        : []
      const layout = input.layout === undefined ? 'flow' : str(input.layout, 'spec.layout')
      if (!DIAGRAM_LAYOUTS.has(layout)) {
        throw new Error(`spec.layout must be one of ${[...DIAGRAM_LAYOUTS].join(', ')}`)
      }
      // Compile the source HERE, not in the Client: the stored spec then carries
      // the exact diagram that was drawn, so the transcript, a fork and a resume
      // all agree, and a validation error reaches the model as a tool error.
      return { ...head, layout, nodes, edges, mermaid: compileFlowchart(nodes, edges, layout), origin: 'structured' }
    }
    case 'steps': {
      if (!Array.isArray(input.steps)) throw new Error('spec.steps must be an array')
      const steps = input.steps.map((step, index) => {
        const at = `spec.steps[${index}]`
        if (typeof step === 'object' && step !== null && !Array.isArray(step)) {
          return {
            text: str(step.text, `${at}.text`),
            ...optStr(step.detail, `${at}.detail`) === undefined ? {} : { detail: optStr(step.detail, `${at}.detail`) },
          }
        }
        return { text: str(step, at) }
      })
      if (steps.length === 0) throw new Error('spec.steps must not be empty')
      return { ...head, steps }
    }
    case 'table': {
      const columns = strList(input.columns, 'spec.columns')
      if (!Array.isArray(input.rows)) throw new Error('spec.rows must be an array')
      const rows = input.rows.map((row, index) => {
        const at = `spec.rows[${index}]`
        if (!Array.isArray(row) || row.length !== columns.length) {
          throw new Error(`${at} must be an array of exactly ${columns.length} cells`)
        }
        return row.map((cell, cellIndex) => str(cell, `${at}[${cellIndex}]`))
      })
      return { ...head, columns, rows }
    }
    case 'calculator': {
      const mode = input.mode === undefined ? 'split' : str(input.mode, 'spec.mode')
      if (!CALC_MODES.has(mode)) throw new Error(`spec.mode must be one of ${[...CALC_MODES].join(', ')}`)
      const fields = Array.isArray(input.fields)
        ? input.fields.map((field, index) => {
          const at = `spec.fields[${index}]`
          if (typeof field !== 'object' || field === null || Array.isArray(field)) {
            throw new Error(`${at} must be an object`)
          }
          return {
            label: str(field.label, `${at}.label`),
            value: num(field.value, `${at}.value`),
            ...optNum(field.min, `${at}.min`) === undefined ? {} : { min: optNum(field.min, `${at}.min`) },
            ...optNum(field.max, `${at}.max`) === undefined ? {} : { max: optNum(field.max, `${at}.max`) },
          }
        })
        : []
      return { ...head, mode, fields }
    }
    case 'unit': {
      const units = strList(input.units, 'spec.units')
      if (units.length < 2) throw new Error('spec.units needs at least 2 entries')
      return {
        ...head,
        units,
        ...input.factors === undefined ? {} : { factors: input.factors },
        ...optNum(input.value, 'spec.value') === undefined ? {} : { value: optNum(input.value, 'spec.value') },
        ...optStr(input.from, 'spec.from') === undefined ? {} : { from: optStr(input.from, 'spec.from') },
        ...optStr(input.to, 'spec.to') === undefined ? {} : { to: optStr(input.to, 'spec.to') },
      }
    }
    case 'note': {
      const tone = input.tone === undefined ? 'info' : str(input.tone, 'spec.tone')
      if (!TONES.has(tone)) throw new Error(`spec.tone must be one of ${[...TONES].join(', ')}`)
      return { ...head, tone, text: str(input.text, 'spec.text') }
    }
    default:
      throw new Error(`unsupported kind: ${kind}`)
  }
}

/** Accepted `spec.kind` values. */
const KIND_NAMES = new Set(['compare', 'chart', 'stats', 'progress', 'steps', 'table', 'diagram', 'calculator', 'unit', 'note'])

/** Accepted `spec.variant` values for the chart kind. */
const CHART_VARIANTS = new Set(['bar', 'line', 'pie', 'donut'])

/** Accepted `spec.layout` values for a structured diagram. */
const DIAGRAM_LAYOUTS = new Set(['flow', 'tree'])

/** Cap on raw Mermaid source, so one card cannot swallow the whole page. */
const MAX_MERMAID_CHARS = 12000

/**
 * Escape a label for Mermaid's quoted-string syntax.
 * Mermaid reads `"..."` literally, so a quote must become the HTML entity it
 * renders back as — otherwise a label containing one breaks the parse.
 * @param text - the label.
 * @returns the escaped label.
 */
function mermaidLabel(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\n/g, ' ')
}

/**
 * Compile a structured node/edge list into Mermaid flowchart source.
 *
 * Kept on the Host half so the spec that reaches the session log already
 * contains the exact source that was drawn.
 * @param nodes - normalized nodes.
 * @param edges - normalized edges.
 * @param layout - `flow` for left-to-right, `tree` for top-down.
 * @returns Mermaid `flowchart` source.
 */
function compileFlowchart(nodes, edges, layout) {
  const direction = layout === 'tree' ? 'TD' : 'LR'
  const lines = [`flowchart ${direction}`]
  for (const node of nodes) {
    // The id is already validated; emit it raw so edges can reference it.
    lines.push(`  ${node.id}["${mermaidLabel(node.label)}"]`)
  }
  for (const edge of edges) {
    lines.push(edge.label === undefined
      ? `  ${edge.from} --> ${edge.to}`
      : `  ${edge.from} -->|"${mermaidLabel(edge.label)}"| ${edge.to}`)
  }
  // Tones become class assignments, resolved to theme tokens by the Client.
  for (const tone of TONES) {
    const members = nodes.filter((node) => node.tone === tone).map((node) => node.id)
    if (members.length > 0) lines.push(`  classDef tone_${tone} fill:var(--sui-tone-${tone}),stroke:var(--sui-tone-${tone})`)
    if (members.length > 0) lines.push(`  class ${members.join(',')} tone_${tone}`)
  }
  return lines.join('\n')
}

/** Accepted `spec.mode` values for the calculator kind. */
const CALC_MODES = new Set(['split', 'tip'])

/** Accepted semantic `tone` names. Never colors — the Client resolves them to theme tokens. */
const TONES = new Set(['neutral', 'info', 'success', 'warn', 'error'])

/** Fields the model may set, per kind — used for the tool's parameter schema. */
const SPEC_PROPERTIES = {
  kind: { type: 'string', enum: [...KIND_NAMES], description: 'Card type; it decides which other fields apply.' },
  title: { type: 'string', description: 'Optional heading above the card.' },
  caption: { type: 'string', description: 'Optional one-line footnote below the card.' },
  columns: { type: 'array', items: { type: 'string' }, description: 'compare/table: column headers, 2 or more.' },
  rows: { type: 'array', items: {}, description: 'compare: [{label, cells[]}]; table: array of cell arrays.' },
  series: { type: 'array', items: {}, description: 'chart: [{label, value, tone?, hint?}], one point per entry.' },
  variant: { type: 'string', enum: [...CHART_VARIANTS], description: 'chart: bar (default), line for a trend, pie or donut for parts of one whole.' },
  unit: { type: 'string', description: 'chart/progress: suffix shown on values, such as "%" or "ms".' },
  stats: { type: 'array', items: {}, description: 'stats: [{label, value, tone?, hint?}], 2 to 6 headline figures.' },
  value: { type: 'number', description: 'progress: the current amount.' },
  max: { type: 'number', description: 'progress: the amount that counts as full; defaults to 100.' },
  label: { type: 'string', description: 'progress: what the ratio measures.' },
  tone: { type: 'string', enum: [...TONES], description: 'progress/note: semantic emphasis. Resolves to a theme color; never pass a literal color.' },
  steps: { type: 'array', items: {}, description: 'steps: ["text"] or [{text, detail?}], rendered in order.' },
  nodes: { type: 'array', items: {}, description: 'diagram: [{id, label, detail?, tone?}], each id unique. Use with `edges` for a flowchart, mind map or class sketch.' },
  edges: { type: 'array', items: {}, description: 'diagram: [{from, to, label?}] naming declared node ids.' },
  mermaid: { type: 'string', description: 'diagram: raw Mermaid source, for a sequence diagram, state machine, Gantt chart, ER diagram, pie chart or any other type. Do not combine with `nodes`/`edges`.' },
  layout: { type: 'string', enum: [...DIAGRAM_LAYOUTS], description: 'diagram: flow (default) for a left-to-right graph, tree for a top-down hierarchy or mind map.' },
  mode: { type: 'string', enum: [...CALC_MODES], description: 'calculator: split a bill, or work out a tip.' },
  fields: { type: 'array', items: {}, description: 'calculator: [{label, value, min?, max?}] as starting inputs.' },
  units: { type: 'array', items: { type: 'string' }, description: 'unit: unit names, 2 or more.' },
  factors: { type: 'object', description: 'unit: optional multipliers keyed by unit name; equal spacing when omitted.' },
  from: { type: 'string', description: 'unit: unit to convert from; defaults to the first.' },
  to: { type: 'string', description: 'unit: unit to convert to; defaults to the second.' },
  text: { type: 'string', description: 'note: the callout text.' },
}

/** Count the payload entries a normalized spec carries, for the node budget. */
function nodeCount(spec) {
  switch (spec.kind) {
    case 'compare': return spec.columns.length + spec.rows.length * (1 + spec.columns.length)
    case 'chart': return spec.series.length
    case 'stats': return spec.stats.length
    case 'progress': return 1
    case 'steps': return spec.steps.length
    case 'table': return spec.columns.length + spec.rows.length * spec.columns.length
    case 'diagram': return spec.origin === 'raw' ? spec.mermaid.split('\n').length : spec.nodes.length + spec.edges.length
    case 'calculator': return spec.fields.length
    case 'unit': return spec.units.length
    default: return 1
  }
}

/** A one-line plain-text summary, so the transcript still reads without the card. */
function summarize(spec) {
  switch (spec.kind) {
    case 'compare': return `${spec.columns.length} columns × ${spec.rows.length} rows`
    case 'chart': return `${spec.variant} chart, ${spec.series.length} points`
    case 'stats': return spec.stats.map((point) => `${point.label}: ${point.value}`).join(' · ')
    case 'progress': return `${spec.value} / ${spec.max}`
    case 'steps': return `${spec.steps.length} steps`
    case 'table': return `${spec.columns.length} columns × ${spec.rows.length} rows`
    case 'diagram': return spec.origin === 'raw' ? `mermaid source, ${spec.mermaid.split('\n').length} lines` : `${spec.nodes.length} nodes, ${spec.edges.length} edges`
    case 'calculator': return `${spec.mode} calculator`
    case 'unit': return `convert between ${spec.units.join(', ')}`
    default: return spec.text
  }
}

export function apply(ctx, config = {}) {
  const maxNodes = Number.isFinite(config.maxNodes) ? config.maxNodes : MAX_NODES

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'smart-ui',
    order: 950,
    text: SECTION,
  }), 'smart-ui: prompt section')

  ctx.effect(() => ctx.tools.register({
    name: 'ui_render',
    description: 'Render an interactive visual card inside the conversation: a side-by-side comparison, a bar chart, headline figures, an ordered procedure, a table, a bill-split or tip calculator, a unit converter, or a short callout. Pass one declarative JSON spec of data — never HTML or markup. Reach for this whenever the answer is a structure rather than a sentence: three or more things compared on shared criteria, a series of magnitudes, two to six headline figures, three or more ordered steps, rows of records, arithmetic the user may want to redo with their own numbers, or a unit conversion. Keep your prose as the answer and let the card carry the structure. Plain text fits a single fact or a narrative with no structure to show — not merely a short answer.',
    parameters: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          description: 'The card to render. `kind` selects the layout and decides which other fields apply.',
          properties: SPEC_PROPERTIES,
          required: ['kind'],
          additionalProperties: false,
        },
      },
      required: ['spec'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { kind: { type: 'string' }, title: { type: 'string' } },
        additionalProperties: true,
      },
      render(args, value) {
        const spec = value ?? {}
        const heading = spec.title ?? spec.kind ?? 'card'
        return [{ type: 'text', text: `Rendered ${spec.kind ?? 'card'} card: ${heading} — ${summarize(spec)}` }]
      },
    },
    execute(args) {
      const spec = normalizeSpec(args?.spec)
      const nodes = nodeCount(spec)
      if (nodes > maxNodes) {
        throw new Error(`spec renders ${nodes} nodes, over the ${maxNodes}-node limit; split it or trim the data`)
      }
      return spec
    },
  }), 'smart-ui: ui_render tool')
}
