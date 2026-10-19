/**
 * Intelligent UI engine — the shared half.
 *
 * One source of truth for everything the Host and the Client must agree on:
 *
 *   1. the component registry (`TYPES`, `ALIASES`) — which node types exist,
 *      which props each accepts, which take children;
 *   2. the safe expression language (`parseExpression` / `evaluateExpression`)
 *      that binds node props to state and computed values — a hand-written
 *      tokenizer + parser, never `eval`/`new Function`, so model-authored JSON
 *      can never execute arbitrary JavaScript;
 *   3. `validateApp` — the full schema check the Host runs before a spec is
 *      accepted (ids, types, props, actions, nesting depth, budgets);
 *   4. `planAction` — the Action Router's decision step: permission checks and
 *      effect planning, pure and unit-testable, so the Client only executes
 *      what this function approved;
 *   5. `StreamPlayer` + `mockStreamEvents` — the streaming protocol
 *      (`node.add` / `node.patch` / `node.remove` / `stream.done` /
 *      `stream.error`) with sequence numbers, dedupe and out-of-order repair.
 *
 * Written as CommonJS on purpose: the Host imports it as ESM
 * (`import engine from './engine.cjs'`), and `build-engine.mjs` wraps the very
 * same file into the Client's `client.engine.js` loader chunk. Both halves then
 * validate and evaluate with identical code.
 */

'use strict'

// ── budgets ────────────────────────────────────────────────────────────────

const LIMITS = {
  /** Nesting depth of the node tree, root included. */
  maxDepth: 8,
  /** Nodes in one tree, so a runaway model cannot wedge the page. */
  maxNodes: 400,
  /** Characters in one expression source. */
  maxExprChars: 2000,
  /** Nested operator/call depth inside one expression. */
  maxExprDepth: 32,
  /** Serialized bytes of the `state` object. */
  maxStateBytes: 49152,
  /** Characters in any single string prop. */
  maxStringChars: 12000,
  /** Total JSON characters of one spec payload (state + tree). */
  maxSpecChars: 200000,
}

// ── registry ───────────────────────────────────────────────────────────────

/** Accepted semantic `tone` names. Never colors — the Client maps them to theme tokens. */
const TONES = ['neutral', 'info', 'success', 'warn', 'error']

/** Events a node may handle. The component decides which it actually fires. */
const EVENTS = ['click', 'change', 'input', 'submit', 'confirm', 'cancel']

/** Action verbs the Action Router knows how to plan. */
const ACTIONS = ['set', 'toggle', 'copy', 'open', 'submit', 'call']

/** Props every node may carry, whatever its type. */
const COMMON_PROPS = ['span', 'hidden', 'ariaLabel']

/**
 * The component registry: canonical node types.
 *
 * `props` is the complete allow-list per type — an unknown prop name is a
 * validation error, which catches the model's typos instead of silently
 * dropping a field, and every listed prop is read by the component of the
 * same name in `client.js`. `children` marks the container types.
 */
const TYPES = {
  // text ───────────────────────────────────────────────────────────────────
  text: { props: ['text', 'tone', 'size', 'align', 'bold', 'italic'], children: false },
  title: { props: ['text', 'level', 'align'], children: false },
  caption: { props: ['text'], children: false },
  label: { props: ['text'], children: false },
  bold: { props: ['text'], children: false },
  italic: { props: ['text'], children: false },
  badge: { props: ['text', 'tone'], children: false },
  link: { props: ['text', 'href', 'external'], children: false },
  quote: { props: ['text', 'cite'], children: false },
  markdown: { props: ['text'], children: false },
  code: { props: ['text', 'language', 'wrap'], children: false },
  math: { props: ['text', 'display'], children: false },
  list: { props: ['items', 'ordered'], children: false },
  timeline: { props: ['items'], children: false },
  sources: { props: ['items'], children: false },

  // layout ─────────────────────────────────────────────────────────────────
  box: { props: ['padding', 'gap', 'align', 'justify', 'wrap', 'tone'], children: true },
  row: { props: ['gap', 'align', 'justify', 'wrap'], children: true },
  column: { props: ['gap', 'align'], children: true },
  card: { props: ['title', 'subtitle', 'footer', 'accent'], children: true },
  grid: { props: ['columns', 'gap', 'minWidth'], children: true },
  bento: { props: ['gap'], children: true },
  flow: { props: ['gap'], children: true },
  divider: { props: ['label'], children: false },
  spacer: { props: ['size'], children: false },
  tabs: { props: ['tabs', 'active'], children: true },
  tab: { props: ['label'], children: true },
  accordion: { props: ['multiple'], children: true },
  accordionItem: { props: ['label', 'open'], children: true },
  popover: { props: ['title', 'trigger'], children: true },
  tooltip: { props: ['hint'], children: true },
  carousel: { props: ['height'], children: true },
  responsive: { props: ['gap'], children: true },

  // controls ───────────────────────────────────────────────────────────────
  button: { props: ['label', 'variant', 'tone', 'icon', 'disabled', 'fullWidth'], children: false },
  iconButton: { props: ['icon', 'label', 'tone', 'disabled'], children: false },
  input: { props: ['label', 'type', 'placeholder', 'value', 'required', 'min', 'max', 'step', 'name', 'help'], children: false },
  textarea: { props: ['label', 'rows', 'placeholder', 'value', 'required', 'name', 'help'], children: false },
  select: { props: ['label', 'options', 'value', 'placeholder', 'name', 'help'], children: false },
  combobox: { props: ['label', 'options', 'value', 'placeholder', 'name', 'help'], children: false },
  checkbox: { props: ['label', 'checked', 'name', 'help'], children: false },
  radio: { props: ['label', 'options', 'value', 'name', 'help'], children: false },
  switch: { props: ['label', 'checked', 'name'], children: false },
  slider: { props: ['label', 'min', 'max', 'step', 'value', 'unit'], children: false },
  datePicker: { props: ['label', 'value', 'min', 'max', 'name'], children: false },
  timePicker: { props: ['label', 'value', 'name'], children: false },
  segmented: { props: ['label', 'options', 'value'], children: false },
  form: { props: ['title', 'submitLabel'], children: true },
  fileUpload: { props: ['label', 'accept', 'multiple'], children: false },
  dialog: { props: ['title', 'open', 'confirmLabel', 'cancelLabel'], children: true },
  confirmDialog: { props: ['title', 'message', 'open', 'confirmLabel', 'cancelLabel', 'tone'], children: false },

  // data visualization ─────────────────────────────────────────────────────
  kpi: { props: ['label', 'value', 'unit', 'delta', 'tone', 'hint'], children: false },
  progress: { props: ['value', 'max', 'label', 'unit', 'tone', 'variant'], children: false },
  chart: { props: ['series', 'variant', 'unit', 'height', 'label'], children: false },
  dataTable: {
    props: ['columns', 'rows', 'pageSize', 'search', 'filterKey', 'selectable', 'exportable', 'caption', 'emptyText'],
    children: false,
  },

  // media & map ────────────────────────────────────────────────────────────
  image: { props: ['src', 'alt', 'caption', 'width', 'fit'], children: false },
  gallery: { props: ['images', 'columns', 'height'], children: true },
  lightbox: { props: ['src', 'alt', 'caption', 'width'], children: false },
  video: { props: ['src', 'poster', 'caption'], children: false },
  svg: { props: ['shapes', 'viewBox', 'caption'], children: false },
  diagram: { props: ['mermaid', 'layout', 'height'], children: false },
  map: { props: ['places', 'selected', 'height', 'caption'], children: false },
  places: { props: ['places', 'selected', 'label'], children: false },

  // system feedback ────────────────────────────────────────────────────────
  toast: { props: ['items'], children: false },
  loading: { props: ['label'], children: false },
  skeleton: { props: ['lines', 'height'], children: false },
  errorState: { props: ['message', 'hint', 'retryLabel'], children: false },
  emptyState: { props: ['message', 'hint'], children: false },
  checklist: { props: ['items', 'label'], children: false },
  stepper: { props: ['steps', 'current'], children: false },

  // instant micro-apps ─────────────────────────────────────────────────────
  quiz: { props: ['title', 'questions'], children: false },
  flashcard: { props: ['title', 'cards'], children: false },
  countdown: { props: ['label', 'target', 'seconds'], children: false },
}

/**
 * Chart aliases: one `chart` component, six spellings for the model's
 * convenience. Each alias fixes `variant` unless the spec overrides it.
 */
const ALIASES = {
  barChart: { type: 'chart', variant: 'bar' },
  lineChart: { type: 'chart', variant: 'line' },
  areaChart: { type: 'chart', variant: 'area' },
  pieChart: { type: 'chart', variant: 'pie' },
  donutChart: { type: 'chart', variant: 'donut' },
  scatterChart: { type: 'chart', variant: 'scatter' },
}

/** Every accepted node type name, canonical plus aliases. */
const TYPE_NAMES = Object.keys(TYPES).concat(Object.keys(ALIASES))

/** Small built-in icon vocabulary for `iconButton` / `button.icon`. */
const ICONS = ['check', 'close', 'plus', 'minus', 'copy', 'arrow-left', 'arrow-right', 'search', 'download', 'play', 'pause', 'refresh', 'info', 'warning', 'calendar', 'pin']

// ── prompt digest ──────────────────────────────────────────────────────────
//
// A model cannot use `kind: "app"` without the node type names. The tool schema
// describes only the four top-level fields, so a model told "trees are built
// from a registry" but not which types exist will invent component names and
// earn a validation error. This digest is generated from `TYPES`, so it cannot
// drift from the validator or the renderer. Measured with a blind probe: before
// the digest, the model knew `ui_render`, the 12 kinds and the `app` fields but
// not a single component `type` name.

/** The digest, grouped the way a human would scan it. Types missing from these
 * groups still appear (appended), so adding a type can never silently drop out
 * of the prompt. */
const DIGEST_GROUPS = [
  ['text', ['text', 'title', 'caption', 'label', 'bold', 'italic', 'badge', 'link', 'quote', 'markdown', 'code', 'math', 'list', 'timeline', 'sources']],
  ['layout', ['box', 'row', 'column', 'card', 'grid', 'bento', 'flow', 'divider', 'spacer', 'tabs', 'tab', 'accordion', 'accordionItem', 'popover', 'tooltip', 'carousel', 'responsive']],
  ['controls', ['button', 'iconButton', 'input', 'textarea', 'select', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'datePicker', 'timePicker', 'segmented', 'form', 'fileUpload', 'dialog', 'confirmDialog']],
  ['data', ['kpi', 'progress', 'chart', 'dataTable']],
  ['media', ['image', 'gallery', 'lightbox', 'video', 'svg', 'diagram', 'map', 'places']],
  ['feedback', ['toast', 'loading', 'skeleton', 'errorState', 'emptyState', 'checklist', 'stepper']],
  ['micro-apps', ['quiz', 'flashcard', 'countdown']],
]

/**
 * One line per group: `type(prop,prop,children?)`. A trailing `children` marks
 * a container type.
 * @returns {string} the prompt-ready registry digest.
 */
function registryDigest() {
  const grouped = new Set(DIGEST_GROUPS.flatMap(([, names]) => names))
  const rest = Object.keys(TYPES).filter((name) => !grouped.has(name))
  const groups = rest.length === 0 ? DIGEST_GROUPS : DIGEST_GROUPS.concat([['other', rest]])
  const describe = (name) => `${name}(${TYPES[name].props.join(',')}${TYPES[name].children ? ',children' : ''})`
  return [
    'Component registry for `kind: "app"` trees — the only accepted `type` names:',
    ...groups.map(([label, names]) => `- ${label}: ${names.map(describe).join(' ')}`),
    `Chart aliases (same props as \`chart\`, they only preset \`variant\`): ${Object.entries(ALIASES).map(([name, alias]) => `${name}=${alias.variant}`).join(', ')}.`,
    'Every type also accepts `span` (1-3, grid/bento only), `hidden` and `ariaLabel`.',
    `Expression functions (no others exist): ${FUNC_NAMES.join(', ')}.`,
    'Actions: `{action:"set",path,value?|expr?}` (neither value nor expr = the event value), `{action:"toggle",path}`, `{action:"copy",text|expr}`, `{action:"open",url}` (http(s) only), `{action:"submit",form?}`, `{action:"call",service,payload}` (reports "not connected" unless a service is registered).',
    'Events a node may handle in `on`: click, change, input, submit, confirm, cancel.',
  ].join('\n')
}

/** The registry digest text. Built lazily so `FUNC_NAMES` (declared below) is
 * initialized before the first call; cached for the process lifetime. */
let digestCache = null
function getRegistryDigest() {
  if (digestCache === null) digestCache = registryDigest()
  return digestCache
}

/** Build the digest without the cache. Only tests need this: the cached value
 * is what the prompt uses, and a fresh build is how a test proves a newly
 * registered type reaches the prompt. */
function registryDigestFresh() {
  return registryDigest()
}

// ── safe expression language ───────────────────────────────────────────────
//
// Literals, state paths, arithmetic, comparison, boolean logic, array/object
// literals and a fixed function table. No assignment, no member calls, no
// `eval` anywhere: the parser produces a plain AST and `evaluateExpression`
// walks it. `__proto__` / `constructor` / `prototype` segments are rejected.

const RESERVED = new Set(['true', 'false', 'null', 'and', 'or', 'not'])

/** The fixed function table. Everything else is a parse error.
 *
 * ponytail: no map/lambda — derived arrays are built with array/object literals
 * over computed scalars (see demos/3-invest.json), ceiling: one level of
 * derivation from a list in state; upgrade path: add `map(list, "expr")` with
 * a scoped `$item` binding if a demo ever needs per-element derivation. */
const FUNCS = {
  round: (x, n = 0) => round(Number(x), Number(n)),
  floor: (x) => Math.floor(Number(x)),
  ceil: (x) => Math.ceil(Number(x)),
  abs: (x) => Math.abs(Number(x)),
  // min/max take either varargs or one array, so `max(pluck(rows, 'cost'))`
  // works the way `sum(pluck(...))` does.
  min: (...xs) => Math.min(...flattenNumbers(xs)),
  max: (...xs) => Math.max(...flattenNumbers(xs)),
  clamp: (x, lo, hi) => Math.min(Math.max(Number(x), Number(lo)), Number(hi)),
  sum: (xs) => (Array.isArray(xs) ? xs.reduce((a, b) => a + Number(b), 0) : Number(xs)),
  avg: (xs) => (Array.isArray(xs) && xs.length > 0 ? xs.reduce((a, b) => a + Number(b), 0) / xs.length : 0),
  pluck: (xs, key) => (Array.isArray(xs) ? xs.map((item) => item == null ? undefined : item[String(key)]) : []),
  len: (x) => (typeof x === 'string' || Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0),
  if: (c, a, b) => (c ? a : b),
  coalesce: (...xs) => xs.find((x) => x !== null && x !== undefined) ?? null,
  fmt: (x, n = 0) => formatNumber(Number(x), Number(n)),
  pct: (x, n = 0) => `${formatNumber(Number(x) * 100, Number(n))}%`,
  number: (x) => (x === '' || x === null || x === undefined ? 0 : Number(x)),
  lower: (x) => String(x ?? '').toLowerCase(),
  upper: (x) => String(x ?? '').toUpperCase(),
  join: (xs, sep = ', ') => (Array.isArray(xs) ? xs.join(String(sep)) : String(xs ?? '')),
}

/** Function names reserved by the language, so a path can never shadow a call. */
const FUNC_NAMES = Object.keys(FUNCS)

/** Round half away from zero, so 0.5 → 1 instead of JS's 0. */
function round(value, digits) {
  const f = 10 ** Math.min(Math.max(Number.isFinite(digits) ? digits : 0, 0), 10)
  return Math.sign(value) * Math.round(Math.abs(value) * f) / f
}

/** `min`/`max` arguments: a single array expands, everything else is a value. */
function flattenNumbers(xs) {
  return (xs.length === 1 && Array.isArray(xs[0]) ? xs[0] : xs).map(Number)
}

/** Locale-stable number formatting for display. */
function formatNumber(value, digits) {
  if (!Number.isFinite(value)) return String(value)
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(Math.max(digits, 0), 10),
    maximumFractionDigits: Math.min(Math.max(digits, 0), 10),
  })
}

/**
 * Tokenize an expression source.
 * @param {string} src - the expression.
 * @returns {Array<{t: string, v: *, at: number}>} tokens with an `end` marker.
 */
function tokenize(src) {
  const tokens = []
  let i = 0
  const push = (t, v, at) => tokens.push({ t, v, at })
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue }
    const at = i
    // number
    if (ch >= '0' && ch <= '9' || (ch === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i))
      push('num', Number(match[0]), at)
      i += match[0].length
      continue
    }
    // string, single or double quoted
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let out = ''
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const esc = src[j + 1]
          out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc
          j += 2
          continue
        }
        out += src[j]
        j += 1
      }
      if (j >= src.length) throw new Error(`unterminated string at ${at}`)
      push('str', out, at)
      i = j + 1
      continue
    }
    // identifier or path head
    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))
      push('ident', match[0], at)
      i += match[0].length
      continue
    }
    // multi-char operators first
    const two = src.slice(i, i + 2)
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
      push('op', two, at)
      i += 2
      continue
    }
    if ('+-*/%<>!?:(),.[]{}'.includes(ch)) {
      push('op', ch, at)
      i += 1
      continue
    }
    throw new Error(`unexpected character "${ch}" at ${at}`)
  }
  push('end', null, i)
  return tokens
}

/**
 * Parse an expression into an AST. Throws on any syntax problem, naming the
 * position, so the Host can hand the model a corrective error.
 * @param {string} src - the expression source.
 * @returns {object} the AST root.
 */
function parseExpression(src) {
  if (typeof src !== 'string') throw new Error('expression must be a string')
  const trimmed = src.trim()
  if (trimmed === '') throw new Error('expression must not be empty')
  if (trimmed.length > LIMITS.maxExprChars) {
    throw new Error(`expression is ${trimmed.length} chars, over the ${LIMITS.maxExprChars}-char limit`)
  }
  const tokens = tokenize(trimmed)
  let pos = 0
  let depth = 0

  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (value) => {
    const token = next()
    if (token.t !== 'op' || token.v !== value) {
      throw new Error(`expected "${value}" at ${token.at}, got ${token.t === 'end' ? 'end of expression' : JSON.stringify(token.v)}`)
    }
    return token
  }
  const enter = () => {
    depth += 1
    if (depth > LIMITS.maxExprDepth) throw new Error(`expression nests deeper than ${LIMITS.maxExprDepth} levels`)
  }
  const leave = () => { depth -= 1 }

  function parseTernary() {
    const cond = parseOr()
    if (peek().t === 'op' && peek().v === '?') {
      enter()
      next()
      const a = parseTernary()
      expect(':')
      const b = parseTernary()
      leave()
      return { k: 'if', cond, a, b }
    }
    return cond
  }
  function parseOr() {
    let left = parseAnd()
    while (peek().t === 'op' && (peek().v === '||' || peek().v === 'or')) {
      next()
      left = { k: 'logic', op: '||', left, right: parseAnd() }
    }
    return left
  }
  function parseAnd() {
    let left = parseCmp()
    while (peek().t === 'op' && (peek().v === '&&' || peek().v === 'and')) {
      next()
      left = { k: 'logic', op: '&&', left, right: parseCmp() }
    }
    return left
  }
  function parseCmp() {
    let left = parseAdd()
    while (peek().t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().v)) {
      const op = next().v
      left = { k: 'cmp', op, left, right: parseAdd() }
    }
    return left
  }
  function parseAdd() {
    let left = parseMul()
    while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v
      left = { k: 'arith', op, left, right: parseMul() }
    }
    return left
  }
  function parseMul() {
    let left = parseUnary()
    while (peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = next().v
      left = { k: 'arith', op, left, right: parseUnary() }
    }
    return left
  }
  function parseUnary() {
    if (peek().t === 'op' && (peek().v === '-' || peek().v === '!')) {
      enter()
      const op = next().v
      const operand = parseUnary()
      leave()
      return { k: 'unary', op, operand }
    }
    return parsePrimary()
  }
  function parsePrimary() {
    const token = next()
    if (token.t === 'num') return { k: 'lit', value: token.v }
    if (token.t === 'str') return { k: 'lit', value: token.v }
    if (token.t === 'ident') {
      if (token.v === 'true') return { k: 'lit', value: true }
      if (token.v === 'false') return { k: 'lit', value: false }
      if (token.v === 'null') return { k: 'lit', value: null }
      if (RESERVED.has(token.v)) throw new Error(`reserved word "${token.v}" at ${token.at}`)
      if (FUNC_NAMES.includes(token.v) && peek().t === 'op' && peek().v === '(') {
        enter()
        next()
        const args = []
        if (!(peek().t === 'op' && peek().v === ')')) {
          args.push(parseTernary())
          while (peek().t === 'op' && peek().v === ',') {
            next()
            args.push(parseTernary())
          }
        }
        expect(')')
        leave()
        return { k: 'call', name: token.v, args }
      }
      if (peek().t === 'op' && peek().v === '(') {
        throw new Error(`unknown function ${token.v}() at ${token.at}; the language has no user-defined functions`)
      }
      if (FUNC_NAMES.includes(token.v)) {
        throw new Error(`"${token.v}" is a function; call it as ${token.v}(...)`)
      }
      return parsePath(token.v, token.at)
    }
    if (token.t === 'op' && token.v === '(') {
      enter()
      const inner = parseTernary()
      expect(')')
      leave()
      return inner
    }
    if (token.t === 'op' && token.v === '[') {
      enter()
      const items = []
      if (!(peek().t === 'op' && peek().v === ']')) {
        items.push(parseTernary())
        while (peek().t === 'op' && peek().v === ',') {
          next()
          if (peek().t === 'op' && peek().v === ']') break
          items.push(parseTernary())
        }
      }
      expect(']')
      leave()
      return { k: 'array', items }
    }
    if (token.t === 'op' && token.v === '{') {
      enter()
      const entries = []
      if (!(peek().t === 'op' && peek().v === '}')) {
        for (;;) {
          const key = next()
          const name = key.t === 'str' ? key.v : key.t === 'ident' ? key.v : null
          if (name === null) throw new Error(`object key must be a name or string at ${key.at}`)
          expect(':')
          entries.push({ name, value: parseTernary() })
          if (peek().t === 'op' && peek().v === ',') {
            next()
            if (peek().t === 'op' && peek().v === '}') break
            continue
          }
          break
        }
      }
      expect('}')
      leave()
      return { k: 'object', entries }
    }
    throw new Error(`unexpected ${token.t === 'end' ? 'end of expression' : JSON.stringify(token.v)} at ${token.at}`)
  }

  /** `a.b[0].c` — one path node, with prototype segments rejected. */
  function parsePath(head, at) {
    const path = [head]
    for (;;) {
      if (peek().t === 'op' && peek().v === '.') {
        next()
        const seg = next()
        if (seg.t !== 'ident') throw new Error(`expected a property name at ${seg.at}`)
        path.push(seg.v)
        continue
      }
      if (peek().t === 'op' && peek().v === '[') {
        enter()
        next()
        const index = parseTernary()
        expect(']')
        leave()
        path.push(index)
        continue
      }
      break
    }
    for (const seg of path) {
      if (typeof seg === 'string' && FORBIDDEN_KEYS.has(seg)) {
        throw new Error(`"${seg}" is not allowed in a path at ${at}`)
      }
    }
    return { k: 'path', path, at }
  }

  const ast = parseTernary()
  const end = peek()
  if (end.t !== 'end') throw new Error(`unexpected trailing input at ${end.at}`)
  return ast
}

/** Property names that may never be read or written, whatever the path. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Evaluate a parsed expression against a scope object.
 * @param {object} ast - from `parseExpression`.
 * @param {object} scope - plain object of state + computed values.
 * @returns {*} the value: JSON data plus numbers/strings/booleans.
 */
function evaluateExpression(ast, scope) {
  switch (ast.k) {
    case 'lit': return ast.value
    case 'array': return ast.items.map((item) => evaluateExpression(item, scope))
    case 'object': {
      const out = {}
      for (const entry of ast.entries) {
        if (FORBIDDEN_KEYS.has(entry.name)) continue
        out[entry.name] = evaluateExpression(entry.value, scope)
      }
      return out
    }
    case 'path': {
      let value = scope
      for (const seg of ast.path) {
        const key = typeof seg === 'string' ? seg : evaluateExpression(seg, scope)
        if (FORBIDDEN_KEYS.has(String(key))) throw new Error(`"${key}" is not allowed in a path`)
        if (value === null || value === undefined) return undefined
        // Own properties only: an expression must never reach a prototype
        // method like `toString` through a plain-object path.
        if (!Object.prototype.hasOwnProperty.call(Object(value), String(key))) return undefined
        value = value[String(key)]
      }
      return value
    }
    case 'call': {
      const fn = FUNCS[ast.name]
      if (fn === undefined) throw new Error(`unknown function ${ast.name}()`)
      return fn(...ast.args.map((arg) => evaluateExpression(arg, scope)))
    }
    case 'unary': {
      const value = evaluateExpression(ast.operand, scope)
      return ast.op === '-' ? -Number(value) : !value
    }
    case 'logic': {
      const left = evaluateExpression(ast.left, scope)
      if (ast.op === '&&') return left ? evaluateExpression(ast.right, scope) : left
      return left ? left : evaluateExpression(ast.right, scope)
    }
    case 'cmp': {
      const left = evaluateExpression(ast.left, scope)
      const right = evaluateExpression(ast.right, scope)
      switch (ast.op) {
        case '==': return left === right
        case '!=': return left !== right
        case '<': return left < right
        case '<=': return left <= right
        case '>': return left > right
        default: return left >= right
      }
    }
    case 'arith': {
      const left = evaluateExpression(ast.left, scope)
      const right = evaluateExpression(ast.right, scope)
      switch (ast.op) {
        case '+': return typeof left === 'string' || typeof right === 'string'
          ? String(left ?? '') + String(right ?? '')
          : Number(left) + Number(right)
        case '-': return Number(left) - Number(right)
        case '*': return Number(left) * Number(right)
        case '/': return Number(left) / Number(right)
        default: return Number(left) % Number(right)
      }
    }
    case 'if': return evaluateExpression(ast.cond, scope) ? evaluateExpression(ast.a, scope) : evaluateExpression(ast.b, scope)
    default: throw new Error(`unknown expression node ${ast.k}`)
  }
}

/**
 * Root identifiers an expression reads. Used for the compute graph.
 * @param {object} ast - a parsed expression.
 * @param {Set<string>} [out] - accumulator.
 * @returns {Set<string>} the root names in source order.
 */
function expressionRoots(ast, out = new Set()) {
  switch (ast.k) {
    case 'path': out.add(ast.path[0]); break
    case 'call': for (const arg of ast.args) expressionRoots(arg, out); break
    case 'array': for (const item of ast.items) expressionRoots(item, out); break
    case 'object': for (const entry of ast.entries) expressionRoots(entry.value, out); break
    case 'unary': expressionRoots(ast.operand, out); break
    case 'logic': case 'cmp': case 'arith': expressionRoots(ast.left, out); expressionRoots(ast.right, out); break
    case 'if': expressionRoots(ast.cond, out); expressionRoots(ast.a, out); expressionRoots(ast.b, out); break
    default: break
  }
  return out
}

// ── state paths ────────────────────────────────────────────────────────────

const PATH_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:(?:\.[A-Za-z_$][A-Za-z0-9_$]*)|(?:\[\d+\]))*$/

/**
 * Validate a state path such as `trip.days` or `items[0].price`.
 * @param {string} path - the candidate.
 * @returns {string[]} the segments, numbers for indexes.
 */
function parseStatePath(path) {
  if (typeof path !== 'string' || !PATH_RE.test(path)) {
    throw new Error(`state path must look like "name" or "name.field[0]", got ${JSON.stringify(path)}`)
  }
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg))
  for (const seg of segments) {
    if (typeof seg === 'string' && FORBIDDEN_KEYS.has(seg)) {
      throw new Error(`state path segment "${seg}" is not allowed`)
    }
  }
  return segments
}

/**
 * Read a value out of an object along a parsed path.
 * @param {object} root - the object.
 * @param {Array<string|number>} segments - from `parseStatePath`.
 * @returns {*} the value, or undefined.
 */
function getPath(root, segments) {
  let value = root
  for (const seg of segments) {
    if (value === null || value === undefined) return undefined
    if (typeof seg === 'string' && FORBIDDEN_KEYS.has(seg)) return undefined
    if (!Object.prototype.hasOwnProperty.call(Object(value), seg)) return undefined
    value = value[seg]
  }
  return value
}

/**
 * Write a value into a **copy** of the object along a path, leaving the input
 * untouched so React state updates stay immutable.
 * @param {object} root - the object.
 * @param {Array<string|number>} segments - from `parseStatePath`.
 * @param {*} value - the value to write.
 * @returns {object} a new root with the write applied.
 */
function setPath(root, segments, value) {
  const clone = shallow(root)
  let cursor = clone
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]
    if (typeof seg === 'string' && FORBIDDEN_KEYS.has(seg)) return clone
    const child = cursor[seg]
    cursor[seg] = shallow(child)
    cursor = cursor[seg]
  }
  const last = segments[segments.length - 1]
  if (typeof last === 'string' && FORBIDDEN_KEYS.has(last)) return clone
  cursor[last] = value
  return clone
}

function shallow(value) {
  if (Array.isArray(value)) return value.slice()
  if (value !== null && typeof value === 'object') return { ...value }
  return {}
}

// ── app spec validation ────────────────────────────────────────────────────

/** Plain JSON data only: no functions, no cycles, no non-finite numbers. */
function assertJsonData(value, path, depth = 0) {
  if (depth > 12) throw new Error(`${path} nests deeper than 12 levels`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > LIMITS.maxStringChars) {
      throw new Error(`${path} is ${value.length} chars, over the ${LIMITS.maxStringChars}-char limit`)
    }
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonData(item, `${path}[${index}]`, depth + 1))
    return
  }
  if (typeof value === 'object') {
    // Plain objects only: a Date, Map or class instance is not JSON data and
    // must not reach the session log.
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path} must be JSON data, got ${proto?.constructor?.name ?? 'a non-plain object'}`)
    }
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}.${key} is not allowed`)
      assertJsonData(item, `${path}.${key}`, depth + 1)
    }
    return
  }
  throw new Error(`${path} must be JSON data, got ${typeof value}`)
}

/** Read a required non-empty string. */
function str(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

/** Read an optional string; blank counts as absent. */
function optStr(value, path) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value.trim() === '' ? undefined : value
}

/** Read an optional finite number. */
function optNum(value, path) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

/** Read an optional semantic tone, rejecting an unknown name. */
function optTone(value, path) {
  const tone = optStr(value, path)
  if (tone !== undefined && !TONES.includes(tone)) {
    throw new Error(`${path} must be one of ${TONES.join(', ')}`)
  }
  return tone
}

/**
 * Validate one action object and normalize it.
 * @param {object} input - the raw action.
 * @param {string} path - for error messages.
 * @returns {object} the normalized action.
 */
function normalizeAction(input, path) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${path} must be an object`)
  }
  const action = str(input.action, `${path}.action`)
  if (!ACTIONS.includes(action)) {
    throw new Error(`${path}.action must be one of ${ACTIONS.join(', ')}`)
  }
  switch (action) {
    case 'set': {
      const target = parseStatePath(str(input.path, `${path}.path`))
      const hasValue = input.value !== undefined
      const hasExpr = input.expr !== undefined
      if (hasValue && hasExpr) throw new Error(`${path} takes either "value" or "expr", not both`)
      const out = { action, path: input.path }
      if (hasValue) {
        assertJsonData(input.value, `${path}.value`)
        out.value = input.value
      }
      if (hasExpr) {
        out.expr = str(input.expr, `${path}.expr`)
        parseExpression(out.expr)
      }
      if (!hasValue && !hasExpr) out.value = { $event: true }
      void target
      return out
    }
    case 'toggle': {
      const target = str(input.path, `${path}.path`)
      parseStatePath(target)
      return { action, path: target }
    }
    case 'copy': {
      const hasText = input.text !== undefined
      const hasExpr = input.expr !== undefined
      if (hasText === hasExpr) throw new Error(`${path} needs exactly one of "text" or "expr"`)
      const out = { action }
      if (hasText) out.text = str(input.text, `${path}.text`)
      else {
        out.expr = str(input.expr, `${path}.expr`)
        parseExpression(out.expr)
      }
      return out
    }
    case 'open': {
      const url = str(input.url, `${path}.url`)
      if (!/^https?:\/\//i.test(url)) throw new Error(`${path}.url must start with http:// or https://`)
      return { action, url }
    }
    case 'submit': {
      const form = optStr(input.form, `${path}.form`)
      return { action, ...form === undefined ? {} : { form } }
    }
    default: {
      // call: an external service invocation. The service name must exist in
      // the runtime's registry; an unregistered name is a run-time failure the
      // user sees as "not connected", never a silent success.
      const service = str(input.service, `${path}.service`)
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(service)) {
        throw new Error(`${path}.service must be a simple service name`)
      }
      const payload = input.payload === undefined ? {} : input.payload
      assertJsonData(payload, `${path}.payload`)
      return { action, service, payload }
    }
  }
}

/**
 * Validate and normalize one node subtree.
 * @param {object} input - the raw node.
 * @param {string} path - for error messages.
 * @param {object} ctx - {ids, count, depth}.
 * @returns {object} the normalized node.
 */
function normalizeNode(input, path, ctx) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${path} must be an object`)
  }
  ctx.count.value += 1
  if (ctx.count.value > ctx.maxNodes) {
    throw new Error(`the tree has more than ${ctx.maxNodes} nodes; split it or trim the data`)
  }
  if (ctx.depth > LIMITS.maxDepth) {
    throw new Error(`${path} nests deeper than ${LIMITS.maxDepth} levels`)
  }

  const id = str(input.id, `${path}.id`)
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new Error(`${path}.id must match [A-Za-z][A-Za-z0-9_-]{0,63}, got ${JSON.stringify(id)}`)
  }
  if (ctx.ids.has(id)) throw new Error(`${path}.id "${id}" is used twice; ids must be unique`)
  ctx.ids.add(id)

  const rawType = str(input.type, `${path}.type`)
  const alias = ALIASES[rawType]
  const type = alias ? alias.type : rawType
  const meta = TYPES[type]
  if (meta === undefined) {
    throw new Error(`${path}.type "${rawType}" is not a known component; see the registry in docs/schema.md`)
  }

  const allowed = new Set(meta.props.concat(COMMON_PROPS))
  // ponytail: prop *names* are validated per type, prop *value shapes* are
  // only checked for JSON-safety here — a wrong value shape degrades to that
  // node's fallback at render time; upgrade path: a per-prop value checker if
  // a model ever ships systematically wrong data for one type.
  const props = {}
  if (input.props !== undefined) {
    if (typeof input.props !== 'object' || input.props === null || Array.isArray(input.props)) {
      throw new Error(`${path}.props must be an object`)
    }
    for (const [key, value] of Object.entries(input.props)) {
      if (!allowed.has(key)) {
        throw new Error(`${path}.props.${key} is not a prop of "${type}"; allowed: ${[...allowed].join(', ')}`)
      }
      assertJsonData(value, `${path}.props.${key}`)
      props[key] = value
    }
  }
  if (alias && props.variant === undefined) props.variant = alias.variant

  // Chart series is the one prop whose shape is checked, not just its name:
  // a fabricated point would otherwise reach the renderer and degrade the
  // whole node. Fixed-card charts reject the same data in `index.js`, so the
  // two vocabularies agree. (`shortcut:` every other prop keeps name-level
  // validation only, upgrade path: a per-prop value schema per type.)
  if (type === 'chart' && props.series !== undefined) {
    if (!Array.isArray(props.series)) throw new Error(`${path}.props.series must be an array of {label, value} points`)
    props.series = props.series.map((point, index) => {
      const at = `${path}.props.series[${index}]`
      if (typeof point !== 'object' || point === null || Array.isArray(point)) {
        throw new Error(`${at} must be an object like {label, value}`)
      }
      if (typeof point.label !== 'string' && typeof point.label !== 'number') {
        throw new Error(`${at}.label must be a string or number`)
      }
      const value = point.value
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${at}.value must be a finite number`)
      }
      const tone = optTone(point.tone, `${at}.tone`)
      return {
        label: String(point.label),
        value,
        ...point.hint === undefined ? {} : { hint: String(point.hint) },
        ...tone === undefined ? {} : { tone },
        ...typeof point.x === 'number' && Number.isFinite(point.x) ? { x: point.x } : {},
      }
    })
    if (props.series.length === 0) throw new Error(`${path}.props.series must not be empty`)
  }

  const bind = {}
  if (input.bind !== undefined) {
    if (typeof input.bind !== 'object' || input.bind === null || Array.isArray(input.bind)) {
      throw new Error(`${path}.bind must be an object`)
    }
    for (const [key, source] of Object.entries(input.bind)) {
      if (!allowed.has(key)) {
        throw new Error(`${path}.bind.${key} is not a prop of "${type}"; allowed: ${[...allowed].join(', ')}`)
      }
      bind[key] = str(source, `${path}.bind.${key}`)
      parseExpression(bind[key])
    }
  }

  const on = {}
  if (input.on !== undefined) {
    if (typeof input.on !== 'object' || input.on === null || Array.isArray(input.on)) {
      throw new Error(`${path}.on must be an object`)
    }
    for (const [event, action] of Object.entries(input.on)) {
      if (!EVENTS.includes(event)) {
        throw new Error(`${path}.on.${event} is not an event; allowed: ${EVENTS.join(', ')}`)
      }
      on[event] = normalizeAction(action, `${path}.on.${event}`)
    }
  }

  const out = { id, type, ...isEmpty(props) ? {} : { props }, ...isEmpty(bind) ? {} : { bind }, ...isEmpty(on) ? {} : { on } }

  if (input.children !== undefined) {
    if (!meta.children) throw new Error(`${path}.type "${type}" does not take children`)
    if (!Array.isArray(input.children)) throw new Error(`${path}.children must be an array`)
    out.children = input.children.map((child, index) =>
      normalizeNode(child, `${path}.children[${index}]`, { ...ctx, depth: ctx.depth + 1 }))
  } else if (meta.children) {
    out.children = []
  }
  return out
}

function isEmpty(obj) {
  return Object.keys(obj).length === 0
}

/**
 * Validate and normalize a whole `kind: "app"` spec.
 *
 * The normalized result is exactly what the Client renders and what the
 * session log stores, so the transcript, a fork and a resume all agree.
 * @param {object} input - the raw spec.
 * @param {{maxNodes?: number}} [opts] - budget overrides.
 * @returns {object} the normalized app spec.
 */
function validateApp(input, opts = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('spec must be an object')
  }
  const maxNodes = Number.isFinite(opts.maxNodes) ? opts.maxNodes : LIMITS.maxNodes

  // state
  const state = input.state === undefined ? {} : input.state
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new Error('spec.state must be an object')
  }
  assertJsonData(state, 'spec.state')
  const stateJson = JSON.stringify(state)
  if (stateJson.length > LIMITS.maxStateBytes) {
    throw new Error(`spec.state is ${stateJson.length} bytes, over the ${LIMITS.maxStateBytes}-byte limit`)
  }

  // compute: identifier keys, parseable expressions, acyclic references
  const compute = {}
  if (input.compute !== undefined) {
    if (typeof input.compute !== 'object' || input.compute === null || Array.isArray(input.compute)) {
      throw new Error('spec.compute must be an object')
    }
    for (const [key, source] of Object.entries(input.compute)) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || RESERVED.has(key) || FUNC_NAMES.includes(key)) {
        throw new Error(`spec.compute key "${key}" must be a plain name, not a reserved word or function`)
      }
      if (key in state) throw new Error(`spec.compute.${key} shadows a state key; rename one of them`)
      compute[key] = str(source, `spec.compute.${key}`)
      parseExpression(compute[key])
    }
    const roots = {}
    for (const [key, source] of Object.entries(compute)) {
      roots[key] = [...expressionRoots(parseExpression(source))].filter((name) => name in compute)
    }
    const visiting = new Set()
    const done = new Set()
    const walk = (key) => {
      if (done.has(key)) return
      if (visiting.has(key)) throw new Error(`spec.compute has a cycle through "${key}"`)
      visiting.add(key)
      for (const dep of roots[key]) walk(dep)
      visiting.delete(key)
      done.add(key)
    }
    for (const key of Object.keys(compute)) walk(key)
  }

  // tree
  if (input.tree === undefined) throw new Error('spec.tree is required')
  const tree = normalizeNode(input.tree, 'spec.tree', { ids: new Set(), count: { value: 0 }, depth: 1, maxNodes })

  // stream
  let stream
  if (input.stream !== undefined) {
    if (typeof input.stream !== 'object' || input.stream === null || Array.isArray(input.stream)) {
      throw new Error('spec.stream must be an object')
    }
    const mode = input.stream.mode === undefined ? 'mock' : str(input.stream.mode, 'spec.stream.mode')
    if (!['mock', 'off'].includes(mode)) throw new Error('spec.stream.mode must be "mock" or "off"')
    const intervalMs = optNum(input.stream.intervalMs, 'spec.stream.intervalMs')
    if (intervalMs !== undefined && (intervalMs < 16 || intervalMs > 2000)) {
      throw new Error('spec.stream.intervalMs must be between 16 and 2000')
    }
    stream = { mode, ...intervalMs === undefined ? {} : { intervalMs } }
  }

  const head = {
    kind: 'app',
    ...optStr(input.title, 'spec.title') === undefined ? {} : { title: input.title },
    ...optStr(input.caption, 'spec.caption') === undefined ? {} : { caption: input.caption },
    state,
    ...isEmpty(compute) ? {} : { compute },
    tree,
    ...stream === undefined ? {} : { stream },
  }
  const totalChars = JSON.stringify(head).length
  if (totalChars > LIMITS.maxSpecChars) {
    throw new Error(`the spec is ${totalChars} chars, over the ${LIMITS.maxSpecChars}-char limit`)
  }
  return head
}

// ── runtime: computed values and prop binding ──────────────────────────────

/**
 * Evaluate the `compute` block against a state snapshot.
 *
 * Keys may reference each other; the dependency order comes from the parsed
 * expressions, so `perPerson` can read `total` regardless of key order.
 * @param {object} compute - `{key: exprSource}`.
 * @param {object} state - the state snapshot.
 * @returns {object} the computed values, keyed like `compute`.
 */
function computeAll(compute, state) {
  // Dependency order first, then plain evaluation into one flat scope object.
  // `validateApp` has already rejected cycles, so this walk always terminates.
  const order = []
  const seen = new Set()
  const visit = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    for (const dep of expressionRoots(parseCached(compute[key]))) {
      if (Object.prototype.hasOwnProperty.call(compute, dep)) visit(dep)
    }
    order.push(key)
  }
  for (const key of Object.keys(compute)) visit(key)

  const scope = { ...state }
  for (const key of order) {
    scope[key] = evaluateExpression(parseCached(compute[key]), scope)
  }
  const out = {}
  for (const key of Object.keys(compute)) out[key] = scope[key]
  return out
}

/** Parse memo: bindings re-evaluate on every keystroke, the grammar is fixed. */
const astCache = new Map()

/**
 * Parse with a memo, for hot paths (`resolveProps`, `computeAll`).
 * @param {string} src - the expression source.
 * @returns {object} the AST.
 */
function parseCached(src) {
  let ast = astCache.get(src)
  if (ast === undefined) {
    ast = parseExpression(src)
    if (astCache.size > 2000) astCache.clear()
    astCache.set(src, ast)
  }
  return ast
}

/**
 * Resolve one node's effective props: literals overlaid with bindings.
 * @param {object} node - a normalized node.
 * @param {object} scope - state + computed.
 * @returns {object} the props to render with.
 */
function resolveProps(node, scope) {
  const props = { ...(node.props ?? {}) }
  for (const [key, source] of Object.entries(node.bind ?? {})) {
    try {
      props[key] = evaluateExpression(parseCached(source), scope)
    } catch (error) {
      props[key] = undefined
      props[`__bindError:${key}`] = String((error && error.message) || error)
    }
  }
  return props
}

// ── action router ──────────────────────────────────────────────────────────

/**
 * Plan an action: the permission-check step of the Action Router.
 *
 * Pure — it decides *what* may happen and with which arguments; the Client
 * performs the effect and reports success only once the effect really
 * happened. An unconfigured service yields an explicit "not connected" plan,
 * never a fake success.
 *
 * @param {object} action - a normalized action.
 * @param {object} ctx - {state, computed, eventValue, services}.
 * @returns {object} a plan: {kind: 'set'|'toggle'|'copy'|'open'|'submit'|'call'|'error', ...}.
 */
function planAction(action, ctx) {
  const scope = { ...(ctx.state ?? {}), ...(ctx.computed ?? {}) }
  try {
    switch (action.action) {
      case 'set': {
        const segments = parseStatePath(action.path)
        // Missing value/expr means "write the event value" — the same rule
        // `normalizeAction` bakes in as `{$event: true}`. Spelled out here so a
        // plan built without that normalization step behaves identically.
        const value = action.expr !== undefined
          ? evaluateExpression(parseExpression(action.expr), scope)
          : action.value === undefined || action.value?.$event === true
            ? ctx.eventValue
            : action.value
        return { kind: 'set', path: segments, value }
      }
      case 'toggle': {
        const segments = parseStatePath(action.path)
        return { kind: 'toggle', path: segments, value: !Boolean(getPath(ctx.state ?? {}, segments)) }
      }
      case 'copy': {
        const text = action.expr !== undefined
          ? evaluateExpression(parseExpression(action.expr), scope)
          : action.text
        const asText = typeof text === 'string' ? text : JSON.stringify(text)
        return { kind: 'copy', text: asText }
      }
      case 'open':
        // Protocol already checked at validation; re-check at execution time
        // because a plan can also come from a resumed session.
        return /^https?:\/\//i.test(action.url)
          ? { kind: 'open', url: action.url }
          : { kind: 'error', message: `refusing to open ${action.url}: only http(s) URLs are allowed` }
      case 'submit':
        return { kind: 'submit', form: action.form ?? null }
      case 'call': {
        const registry = ctx.services ?? {}
        const service = registry[action.service]
        if (service === undefined) {
          return { kind: 'error', message: `service "${action.service}" is not connected`, notConnected: true, service: action.service }
        }
        return { kind: 'call', service: action.service, payload: action.payload ?? {}, run: service }
      }
      default:
        return { kind: 'error', message: `unknown action ${action.action}` }
    }
  } catch (error) {
    return { kind: 'error', message: String((error && error.message) || error) }
  }
}

// ── streaming ──────────────────────────────────────────────────────────────

/** Event types the stream protocol defines. */
const STREAM_EVENTS = ['node.add', 'node.patch', 'node.remove', 'stream.done', 'stream.error']

/**
 * Apply one stream event to a tree, immutably.
 *
 * ponytail: `node.patch` merges shallowly (props/bind/on replaced key by key,
 * children swapped only when sent) — fine for the mock replay and a real LLM
 * stream that patches leaf props; upgrade path: path-scoped patches
 * (`props.series[2].value`) if a stream ever needs surgical edits.
 * @param {object|null} tree - the current root node or null.
 * @param {object} event - a validated stream event.
 * @returns {object|null} the new tree.
 */
function applyStreamEvent(tree, event) {
  switch (event.type) {
    case 'node.add': {
      const node = event.node
      if (node === null || typeof node !== 'object') throw new Error('node.add needs a node')
      if (event.parentId === undefined) return node
      return mapNode(tree, event.parentId, (parent) => {
        const children = Array.isArray(parent.children) ? parent.children.slice() : []
        const index = Number.isInteger(event.index) ? Math.min(Math.max(event.index, 0), children.length) : children.length
        children.splice(index, 0, node)
        return { ...parent, children }
      }) ?? node
    }
    case 'node.patch': {
      return mapNode(tree, event.nodeId, (node) => ({
        ...node,
        ...event.props === undefined ? {} : { props: { ...(node.props ?? {}), ...event.props } },
        ...event.bind === undefined ? {} : { bind: { ...(node.bind ?? {}), ...event.bind } },
        ...event.on === undefined ? {} : { on: { ...(node.on ?? {}), ...event.on } },
      }))
    }
    case 'node.remove': {
      if (tree !== null && tree.id === event.nodeId) return null
      return stripChild(tree, event.nodeId)
    }
    default:
      return tree
  }
}

/** Rebuild the tree with one node transformed; returns the tree unchanged when the id is absent. */
function mapNode(tree, id, fn) {
  if (tree === null || tree === undefined) return tree
  if (tree.id === id) return fn(tree)
  if (!Array.isArray(tree.children)) return tree
  let changed = false
  const children = tree.children.map((child) => {
    const next = mapNode(child, id, fn)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...tree, children } : tree
}

/** Rebuild the tree without one child node, at any depth. */
function stripChild(tree, id) {
  if (tree === null || tree === undefined || !Array.isArray(tree.children)) return tree
  if (tree.children.some((child) => child && child.id === id)) {
    return { ...tree, children: tree.children.filter((child) => child && child.id !== id) }
  }
  let changed = false
  const children = tree.children.map((child) => {
    const next = stripChild(child, id)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...tree, children } : tree
}

/**
 * The streaming client: sequence bookkeeping, dedupe, out-of-order repair.
 *
 * Feed it events in any order and with duplicates; it calls `onUpdate` with a
 * `{tree, status, lastSeq}` snapshot whenever the visible tree changes. A gap
 * is held back until the missing events arrive; a `stream.error` parks the
 * stream until `retry()`, which resumes from the next expected sequence, so a
 * reconnect replays exactly the lost tail.
 */
class StreamPlayer {
  /**
   * @param {object} options - {session, onUpdate}.
   */
  constructor(options = {}) {
    this.session = options.session ?? 'mock'
    this.onUpdate = options.onUpdate ?? (() => {})
    this.tree = null
    this.status = 'streaming'
    this.lastSeq = 0
    this.nextSeq = 1
    this.pending = new Map()
    this.dropped = 0
    this.errorMessage = null
    this.emit()
  }

  /**
   * Push one event. Invalid, duplicate, foreign-session and out-of-order
   * events are handled here, not by the caller. While the stream is parked on
   * an error, events are still buffered so `retry()` can resume the tail.
   * @param {object} event - {seq, session?, type, ...}.
   */
  push(event) {
    if (this.status === 'done') return
    if (typeof event !== 'object' || event === null) { this.dropped += 1; return }
    if (event.session !== undefined && event.session !== this.session) { this.dropped += 1; return }
    if (!Number.isInteger(event.seq) || event.seq < 1) { this.dropped += 1; return }
    if (event.seq <= this.lastSeq || this.pending.has(event.seq)) { this.dropped += 1; return }
    if (!STREAM_EVENTS.includes(event.type)) { this.dropped += 1; return }
    this.pending.set(event.seq, event)
    if (this.status !== 'error') this.drain()
  }

  /** Apply every contiguous pending event. */
  drain() {
    while (this.pending.has(this.nextSeq)) {
      const event = this.pending.get(this.nextSeq)
      this.pending.delete(this.nextSeq)
      this.nextSeq += 1
      this.lastSeq = event.seq
      if (event.type === 'stream.done') {
        this.status = 'done'
        this.pending.clear()
        this.emit()
        return
      }
      if (event.type === 'stream.error') {
        // Park, do not clear: events already buffered past the gap are the
        // tail a reconnect would otherwise have to replay.
        this.status = 'error'
        this.errorMessage = event.message ?? 'stream failed'
        this.emit()
        return
      }
      try {
        this.tree = applyStreamEvent(this.tree, event)
      } catch (error) {
        this.status = 'error'
        this.errorMessage = String((error && error.message) || error)
        this.emit()
        return
      }
    }
    this.emit()
  }

  /** Clear an error and accept events again from the next expected sequence. */
  retry() {
    if (this.status !== 'error') return
    this.status = 'streaming'
    this.errorMessage = null
    this.drain()
  }

  /** Deliver the current snapshot to the renderer. */
  emit() {
    this.onUpdate({ tree: this.tree, status: this.status, lastSeq: this.lastSeq, errorMessage: this.errorMessage })
  }
}

/**
 * Deterministic mock stream: replay a finished tree as `node.add` events plus
 * `stream.done`. Same tree in, same event list out — the reproducible Mock
 * Streaming the spec asks for. The real LLM source is a drop-in replacement
 * that emits the same event shape over SSE (see `createSseSource` in client.js).
 * @param {object} tree - a normalized node tree.
 * @param {object} [opts] - {session, intervalMs}.
 * @returns {Array<object>} the event list.
 */
function mockStreamEvents(tree, opts = {}) {
  const session = opts.session ?? 'mock-session'
  const events = []
  let seq = 0
  const add = (node, parentId, index) => {
    // The wire node carries no children: they arrive as their own events, so
    // the client sees the tree grow exactly as a real stream would grow it.
    const { children, ...wire } = node
    seq += 1
    events.push({
      seq,
      session,
      type: 'node.add',
      nodeId: node.id,
      node: wire,
      ...parentId === undefined ? {} : { parentId },
      ...index === undefined ? {} : { index },
    })
    if (Array.isArray(node.children)) {
      node.children.forEach((child, i) => add(child, node.id, i))
    }
  }
  add(tree, undefined, undefined)
  seq += 1
  events.push({ seq, session, type: 'stream.done' })
  return events
}

module.exports = {
  LIMITS,
  TONES,
  EVENTS,
  ACTIONS,
  TYPES,
  ALIASES,
  TYPE_NAMES,
  ICONS,
  COMMON_PROPS,
  getRegistryDigest,
  registryDigestFresh,
  STREAM_EVENTS,
  FUNC_NAMES,
  tokenize,
  parseExpression,
  evaluateExpression,
  expressionRoots,
  parseStatePath,
  getPath,
  setPath,
  validateApp,
  normalizeAction,
  computeAll,
  resolveProps,
  planAction,
  applyStreamEvent,
  StreamPlayer,
  mockStreamEvents,
}
