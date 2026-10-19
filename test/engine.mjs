/**
 * Self-check for the shared engine (expressions, app validation, actions,
 * streaming). This is the runnable check for the logic that decides what the
 * page renders and what actions may execute.
 *
 * Run: node test/engine.mjs
 */

import assert from 'node:assert/strict'
import {
  parseExpression, evaluateExpression, expressionRoots,
  parseStatePath, getPath, setPath,
  validateApp, computeAll, resolveProps, planAction,
  StreamPlayer, mockStreamEvents, applyStreamEvent,
  TYPES, ALIASES, TYPE_NAMES, LIMITS,
  getRegistryDigest, registryDigestFresh, FUNC_NAMES, EVENTS, ACTIONS,
} from '../engine.cjs'

let checks = 0
const check = (name, fn) => { fn(); checks += 1; console.log(`ok  ${name}`) }
const throws = (name, fn, pattern) => check(name, () => {
  assert.throws(fn, (error) => {
    if (pattern !== undefined) assert.match(String(error.message), pattern)
    return true
  })
})
const evals = (name, src, scope, expected) => check(name, () => {
  const actual = evaluateExpression(parseExpression(src), scope)
  assert.deepEqual(actual, expected)
})

const SCOPE = {
  people: 4, budget: 8000, rate: 0.18, tip: 15,
  trip: { days: 5, city: 'Kyoto' },
  items: [{ price: 12 }, { price: 30 }],
  name: 'Ada',
  flags: { vip: true },
}

// ── expressions ────────────────────────────────────────────────────────────

evals('arithmetic with precedence', 'budget / people + 2 * 3', SCOPE, 2006)
evals('parentheses override', '(budget / people + 2) * 3', SCOPE, 6006)
evals('unary minus', '-people + 6', SCOPE, 2)
evals('string concat with +', "'total ' + budget", SCOPE, 'total 8000')
evals('path with dot', 'trip.city', SCOPE, 'Kyoto')
evals('path with index', 'items[1].price', SCOPE, 30)
evals('comparison and logic', 'people > 2 && trip.days < 7', SCOPE, true)
evals('ternary', 'flags.vip ? "VIP" : "std"', SCOPE, 'VIP')
evals('array literal', '[people, budget]', SCOPE, [4, 8000])
evals('object literal', '{per: budget / people}', SCOPE, { per: 2000 })
evals('functions round/fmt', 'round(budget / 7, 2)', SCOPE, 1142.86)
evals('pluck then sum over records', 'sum(pluck(items, "price"))', SCOPE, 42)
evals('min/max accept one array or varargs', '[min(pluck(items, "price")), max(items[0].price, items[1].price)]', SCOPE, [12, 30])
evals('function if and clamp', 'if(clamp(people, 1, 3) == 3, "ok", "no")', SCOPE, 'ok')
evals('coalesce falls through', 'coalesce(missing, trip.city)', SCOPE, 'Kyoto')
evals('pct formats a ratio', 'pct(rate, 1)', SCOPE, '18.0%')
evals('missing path reads as undefined', 'trip.missing.deep', SCOPE, undefined)
evals('prototype-like key reads as undefined', 'flags.toString', SCOPE, undefined)

throws('rejects unknown function', () => parseExpression('alert(1)'), /unknown function/)
throws('rejects eval-shaped input', () => parseExpression('eval("x")'), /unknown function/)
throws('rejects constructor path', () => parseExpression('trip.constructor.x'), /not allowed/)
throws('rejects unterminated string', () => parseExpression("'abc"), /unterminated/)
throws('rejects trailing input', () => parseExpression('1 2'), /trailing/)
throws('rejects empty expression', () => parseExpression('   '), /empty/)
throws('rejects deep nesting', () => parseExpression('('.repeat(40) + '1' + ')'.repeat(40)), /nests deeper/)

check('roots list only the head names', () => {
  const roots = expressionRoots(parseExpression('a.b + min(d, e[0]) * f'))
  assert.deepEqual([...roots].sort(), ['a', 'd', 'e', 'f'])
})

// ── state paths ────────────────────────────────────────────────────────────

check('state path parses segments', () => {
  assert.deepEqual(parseStatePath('trip.days'), ['trip', 'days'])
  assert.deepEqual(parseStatePath('items[2].price'), ['items', 2, 'price'])
})
throws('rejects bad state path', () => parseStatePath('trip days'), /state path/)
throws('rejects proto state path', () => parseStatePath('__proto__.x'), /state path/)

check('getPath reads and setPath copies', () => {
  assert.equal(getPath(SCOPE, parseStatePath('trip.city')), 'Kyoto')
  const next = setPath(SCOPE, parseStatePath('trip.days'), 9)
  assert.equal(next.trip.days, 9)
  assert.equal(SCOPE.trip.days, 5, 'input must stay untouched')
  assert.equal(next.people, 4, 'sibling keys survive')
})

// ── app validation ─────────────────────────────────────────────────────────

const MINIMAL = {
  kind: 'app',
  state: { budget: 8000, people: 2 },
  compute: { per: 'budget / people' },
  tree: {
    id: 'root', type: 'column',
    children: [
      { id: 'kpi1', type: 'kpi', props: { label: 'Per person' }, bind: { value: 'per' } },
      { id: 'btn1', type: 'button', props: { label: 'Add person' }, on: { click: { action: 'set', path: 'people', expr: 'people + 1' } } },
    ],
  },
}

check('minimal app validates and normalizes', () => {
  const app = validateApp(MINIMAL)
  assert.equal(app.kind, 'app')
  assert.equal(app.tree.children[0].bind.value, 'per')
  assert.equal(app.tree.children[1].on.click.expr, 'people + 1')
})

check('chart alias normalizes to chart + variant', () => {
  const app = validateApp({ ...MINIMAL, tree: { id: 'r', type: 'donutChart', props: { series: [{ label: 'a', value: 1 }] } } })
  assert.equal(app.tree.type, 'chart')
  assert.equal(app.tree.props.variant, 'donut')
})

check('every registered type accepts its own name', () => {
  for (const type of TYPE_NAMES) {
    const alias = ALIASES[type]
    const canonical = alias ? alias.type : type
    assert.ok(TYPES[canonical], `${type} must resolve to a registered type`)
  }
})

// ── prompt digest: the model must be told what the validator accepts ───────
//
// A blind probe showed the model knew `ui_render`, its 12 kinds and the `app`
// fields, but not a single component `type` name — so it could not write a tree
// that validates. The digest is generated from the registry; these checks keep
// the prompt honest as the registry grows.

check('the prompt digest names every registered component type and alias', () => {
  const digest = getRegistryDigest()
  for (const name of Object.keys(TYPES)) {
    assert.ok(digest.includes(`${name}(`), `digest is missing type ${name}`)
  }
  for (const name of Object.keys(ALIASES)) {
    assert.ok(digest.includes(`${name}=`), `digest is missing alias ${name}`)
  }
})

check('the prompt digest lists each type props exactly as TYPES declares them', () => {
  const digest = getRegistryDigest()
  for (const [name, meta] of Object.entries(TYPES)) {
    const expected = `${name}(${meta.props.join(',')}${meta.children ? ',children' : ''})`
    assert.ok(digest.includes(expected), `digest disagrees with TYPES for ${name}`)
  }
})

check('the prompt digest lists the function table, events and actions', () => {
  const digest = getRegistryDigest()
  for (const fn of FUNC_NAMES) assert.ok(digest.includes(fn), `digest is missing function ${fn}`)
  for (const event of EVENTS) assert.ok(digest.includes(event), `digest is missing event ${event}`)
  for (const action of ACTIONS) assert.ok(digest.includes(`"${action}"`), `digest is missing action ${action}`)
})

check('the digest is cached, so it is not rebuilt on every prompt assembly', () => {
  assert.equal(getRegistryDigest(), getRegistryDigest())
})

check('a type added to TYPES automatically reaches the prompt', () => {
  TYPES.probeWidget = { props: ['text'], children: false }
  try {
    const fresh = registryDigestFresh()
    assert.ok(!getRegistryDigest().includes('probeWidget(text)'), 'the cache should not update by itself')
    assert.ok(fresh.includes('probeWidget(text)'), 'a newly registered type must reach the prompt')
  } finally {
    delete TYPES.probeWidget
  }
})

throws('unknown type is rejected', () => validateApp({ ...MINIMAL, tree: { id: 'r', type: 'iframe' } }), /not a known component/)
throws('unknown prop is rejected', () => validateApp({ ...MINIMAL, tree: { id: 'r', type: 'kpi', props: { value: 1, colour: 'red' } } }), /is not a prop/)
throws('duplicate id is rejected', () => validateApp({
  ...MINIMAL,
  tree: { id: 'root', type: 'column', children: [{ id: 'root', type: 'text', props: { text: 'x' } }] },
}), /used twice/)
throws('bad id is rejected', () => validateApp({ ...MINIMAL, tree: { id: '9lives', type: 'text', props: { text: 'x' } } }), /must match/)
throws('children on a leaf is rejected', () => validateApp({
  ...MINIMAL, tree: { id: 'r', type: 'text', props: { text: 'x' }, children: [] },
}), /does not take children/)
throws('deep nesting is rejected', () => {
  let node = { id: 'leaf', type: 'text', props: { text: 'x' } }
  for (let i = 0; i < 12; i += 1) node = { id: `n${i}`, type: 'column', children: [node] }
  validateApp({ ...MINIMAL, tree: node })
}, /nests deeper/)
throws('node budget is enforced', () => validateApp({
  ...MINIMAL,
  tree: { id: 'root', type: 'column', children: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, type: 'text', props: { text: 'x' } })) },
}, { maxNodes: 3 }), /more than 3 nodes/)
throws('unknown action is rejected', () => validateApp({
  ...MINIMAL,
  tree: { id: 'r', type: 'button', on: { click: { action: 'eval' } } },
}), /must be one of/)
throws('unknown event is rejected', () => validateApp({
  ...MINIMAL,
  tree: { id: 'r', type: 'button', on: { hover: { action: 'copy', text: 'x' } } },
}), /not an event/)
throws('open rejects non-http url', () => validateApp({
  ...MINIMAL,
  tree: { id: 'r', type: 'link', props: { text: 'x' }, on: { click: { action: 'open', url: 'javascript:alert(1)' } } },
}), /http/)
throws('bad bind expression is rejected', () => validateApp({
  ...MINIMAL,
  tree: { id: 'r', type: 'kpi', bind: { value: 'budget /' } },
}), /expected/)
throws('compute cycle is rejected', () => validateApp({
  ...MINIMAL,
  compute: { a: 'b + 1', b: 'a + 1' },
}), /cycle/)
throws('compute may not shadow state', () => validateApp({
  ...MINIMAL, compute: { budget: '1' },
}), /shadows/)
throws('state must be JSON data', () => validateApp({
  ...MINIMAL, state: { when: new Date() },
}), /JSON data/)
throws('oversized string prop is rejected', () => validateApp({
  ...MINIMAL,
  tree: { id: 'r', type: 'text', props: { text: 'x'.repeat(LIMITS.maxStringChars + 1) } },
}), /char limit/)
throws('stream mode is checked', () => validateApp({ ...MINIMAL, stream: { mode: 'sse' } }), /mock|off/)
throws('chart series points are shape-checked', () => validateApp({
  ...MINIMAL,
  tree: { id: 'r', type: 'chart', props: { series: [null] } },
}), /must be an object/)
throws('chart series value must be finite', () => validateApp({
  ...MINIMAL,
  tree: { id: 'r', type: 'chart', props: { series: [{ label: 'a', value: 'x' }] } },
}), /finite number/)

check('chart series points are normalized to label/value pairs', () => {
  const app = validateApp({
    ...MINIMAL,
    tree: { id: 'r', type: 'chart', props: { series: [{ label: 3, value: 7, tone: 'info' }] } },
  })
  assert.deepEqual(app.tree.props.series, [{ label: '3', value: 7, tone: 'info' }])
})

// ── compute + binding ──────────────────────────────────────────────────────

check('compute resolves in dependency order', () => {
  const out = computeAll({ per: 'round(total / people, 2)', total: 'budget * 1.1' }, { budget: 8000, people: 2 })
  assert.equal(out.total, 8000 * 1.1)
  assert.equal(out.per, 4400)
})

check('resolveProps overlays bindings over literals', () => {
  const node = { id: 'n', type: 'kpi', props: { label: 'Per' }, bind: { value: 'budget / people' } }
  const props = resolveProps(node, { budget: 8000, people: 4 })
  assert.equal(props.label, 'Per')
  assert.equal(props.value, 2000)
})

check('a broken binding degrades to an inline error, not a throw', () => {
  const node = { id: 'n', type: 'kpi', bind: { value: 'nope(' } }
  const props = resolveProps(node, {})
  assert.equal(props.value, undefined)
  assert.match(props['__bindError:value'], /./)
})

// ── action routing ─────────────────────────────────────────────────────────

check('set plans a write of the event value', () => {
  const plan = planAction({ action: 'set', path: 'people', value: { $event: true } }, {
    state: { people: 1 }, eventValue: 7,
  })
  assert.equal(plan.kind, 'set')
  assert.deepEqual(plan.path, ['people'])
  assert.equal(plan.value, 7)
})

check('set without value or expr writes the event value, normalized or not', () => {
  const plan = planAction({ action: 'set', path: 'people' }, { state: { people: 1 }, eventValue: 7 })
  assert.equal(plan.value, 7)
})

check('set with expr computes against state + computed', () => {
  const plan = planAction({ action: 'set', path: 'budget', expr: 'budget + bonus' }, {
    state: { budget: 100 }, computed: { bonus: 50 },
  })
  assert.equal(plan.value, 150)
})

check('toggle flips the current value', () => {
  const plan = planAction({ action: 'toggle', path: 'flags.vip' }, { state: { flags: { vip: false } } })
  assert.equal(plan.kind, 'toggle')
  assert.equal(plan.value, true)
})

check('copy plans the rendered text', () => {
  const plan = planAction({ action: 'copy', expr: "'每人 ' + per" }, { computed: { per: 4400 } })
  assert.equal(plan.kind, 'copy')
  assert.equal(plan.text, '每人 4400')
})

check('open allows only http(s)', () => {
  assert.equal(planAction({ action: 'open', url: 'https://example.com' }, {}).kind, 'open')
  assert.equal(planAction({ action: 'open', url: 'file:///etc/passwd' }, {}).kind, 'error')
})

check('call reports an unconfigured service instead of faking success', () => {
  const plan = planAction({ action: 'call', service: 'weather', payload: {} }, { services: {} })
  assert.equal(plan.kind, 'error')
  assert.equal(plan.notConnected, true)
  assert.match(plan.message, /not connected/)
})

check('call runs a registered service', () => {
  const plan = planAction({ action: 'call', service: 'weather', payload: { city: 'Kyoto' } }, {
    services: { weather: () => ({ ok: true }) },
  })
  assert.equal(plan.kind, 'call')
  assert.deepEqual(plan.run(plan.payload), { ok: true })
})

// ── streaming ──────────────────────────────────────────────────────────────

const STREAM_TREE = {
  id: 'root', type: 'column', children: [
    { id: 'a', type: 'text', props: { text: 'A' } },
    { id: 'b', type: 'column', children: [{ id: 'c', type: 'text', props: { text: 'C' } }] },
  ],
}

check('mock stream is deterministic and grows the tree', () => {
  const first = mockStreamEvents(STREAM_TREE, { session: 's1' })
  const second = mockStreamEvents(STREAM_TREE, { session: 's1' })
  assert.deepEqual(first, second, 'same tree in, same events out')
  assert.equal(first.filter((e) => e.type === 'node.add').length, 4)
  assert.equal(first[first.length - 1].type, 'stream.done')
  assert.equal(first[0].node.children, undefined, 'wire nodes carry no children')
})

check('player replays a mock stream into the same tree', () => {
  let snap = null
  const player = new StreamPlayer({ session: 's1', onUpdate: (s) => { snap = s } })
  for (const event of mockStreamEvents(STREAM_TREE, { session: 's1' })) player.push(event)
  assert.equal(snap.status, 'done')
  assert.deepEqual(player.tree, STREAM_TREE)
})

check('player drops duplicates and repairs out-of-order delivery', () => {
  let snap = null
  const player = new StreamPlayer({ session: 's1', onUpdate: (s) => { snap = s } })
  const events = mockStreamEvents(STREAM_TREE, { session: 's1' })
  // shuffled deterministically: node 3 first, then 1 twice, 2, 4 twice, 5
  const order = [2, 0, 0, 1, 3, 3, 4]
  for (const index of order) player.push(events[index])
  assert.equal(player.dropped, 2, 'two duplicates dropped')
  assert.equal(snap.status, 'done')
  assert.deepEqual(player.tree, STREAM_TREE)
})

check('player parks on stream.error and resumes the tail on retry', () => {
  const player = new StreamPlayer({ session: 's1' })
  const root = { seq: 1, session: 's1', type: 'node.add', node: { id: 'root', type: 'column' } }
  const a = { seq: 2, session: 's1', type: 'node.add', node: { id: 'a', type: 'text', props: { text: 'A' } }, parentId: 'root', index: 0 }
  const err = { seq: 3, session: 's1', type: 'stream.error', message: 'boom' }
  const b = { seq: 4, session: 's1', type: 'node.add', node: { id: 'b', type: 'text', props: { text: 'B' } }, parentId: 'root', index: 1 }
  const done = { seq: 5, session: 's1', type: 'stream.done' }
  player.push(root)
  player.push(a)
  player.push(err)
  assert.equal(player.status, 'error')
  assert.equal(player.errorMessage, 'boom')
  // the tail arrives while parked: buffered, not applied
  player.push(b)
  player.push(done)
  assert.equal(player.status, 'error')
  assert.deepEqual(player.tree.children.map((n) => n.id), ['a'])
  player.retry()
  assert.equal(player.status, 'done')
  assert.deepEqual(player.tree.children.map((n) => n.id), ['a', 'b'])
  // a replayed duplicate after the reconnect is dropped, not applied twice
  player.push(b)
  assert.equal(player.tree.children.length, 2)
})

check('patch and remove reach nested nodes', () => {
  let tree = applyStreamEvent(null, { type: 'node.add', node: STREAM_TREE })
  tree = applyStreamEvent(tree, { type: 'node.patch', nodeId: 'c', props: { text: 'C2' } })
  assert.equal(tree.children[1].children[0].props.text, 'C2')
  tree = applyStreamEvent(tree, { type: 'node.remove', nodeId: 'a' })
  assert.deepEqual(tree.children.map((n) => n.id), ['b'])
})

check('foreign sessions and bad sequences are dropped, not applied', () => {
  const player = new StreamPlayer({ session: 's1' })
  player.push({ seq: 1, session: 'other', type: 'node.add', node: STREAM_TREE })
  player.push({ seq: 0, type: 'node.add', node: STREAM_TREE })
  player.push({ seq: 1, type: 'teleport' })
  assert.equal(player.tree, null)
  assert.equal(player.dropped, 3)
})

console.log(`\n${checks} checks passed`)
