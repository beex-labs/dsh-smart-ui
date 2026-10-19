# Architecture

How `dsh-intelligent-ui` is put together and how data moves through it. The
rule the whole design follows: **the model writes data, never markup or code**,
and the Host and Client share one implementation of the rules.

---

## 1. Module layout

| File | Role | Loaded by |
|---|---|---|
| `index.js` | **Host half.** Registers the `ui_render` tool + one system-prompt section. Owns `normalizeSpec` (fixed cards), the tool parameter schema, the per-kind node budgets, and the `diagram` → Mermaid compilation (so the session log stores exactly what was drawn). | DSH Host (ESM) |
| `engine.cjs` | **Shared engine.** Component registry (`TYPES`/`ALIASES`), safe expression language (`parseExpression`/`evaluateExpression`), `validateApp`, `computeAll`/`resolveProps`, `planAction`, streaming (`StreamPlayer`/`applyStreamEvent`/`mockStreamEvents`), budgets (`LIMITS`). CommonJS on purpose: the Host `import`s it, and `build-engine.mjs` wraps the *same file* into the Client chunk. | Host + Client |
| `client.js` | **Client half.** Registers one view in the `tool.call.toolview` slot keyed `ui_render`. All rendering: the 10 fixed cards, the app runtime (`useAppRuntime`), the 71-component `REGISTRY` (77 names with chart aliases), Mock Streaming (`AppSurface`), the Schema Playground (`PlaygroundView`), theme/font tracking, styles, tone tokens. | DSH Client (module-loader factory) |
| `build-engine.mjs` | Wraps `engine.cjs` → `client.engine.js` (lazy chunk). | build |
| `build-echarts.mjs` | Wraps `echarts`' UMD dist → `client.echarts.js` (takes the `exports` branch, no global leak). | build |
| `build-mermaid.mjs` | Wraps `mermaid`'s IIFE dist → `client.mermaid.js` (captures the `globalThis` assignment, then deletes the global). | build |
| `client.engine.js`, `client.echarts.js`, `client.mermaid.js` | **Generated, git-ignored** lazy chunks loaded with `require.async('./client.*.js')` on first use. | DSH Client module loader |
| `test/*.mjs` | Self-checks ([testing.md](testing.md)). | node / headless browser |
| `demos/*.json` | Runnable `kind: "app"` specs ([demos.md](demos.md)). | by hand / playground |
| `locale/en.json`, `locale/zh.json` | Locale bundle metadata; the plugin's own strings live in `DICTS` inside `client.js` (the only static UI text it owns). | DSH Client locale |

The lazy-chunk trick is what lets a plain-JS plugin ship ECharts + Mermaid with
no bundler: DSH's Client ModuleLoader serves any sibling `client.<name>.js`
from the plugin route, and the wrapper is the loader envelope (`window.__ModuleLoader__.load({id, factory})`,
chunk id `<package>/<file>`).

---

## 2. Data & state flow

```text
model writes a spec (plain JSON)
   │
   ▼
index.js  ui_render.execute()
   ├─ normalizeSpec(spec)          fixed cards: shape-check, normalize
   ├─ validateApp(spec)  ────────► engine.cjs (same rules the Client uses)
   └─ nodeCount budget check       reject oversized cards
   │  on failure: corrective error back to the model (tool error)
   ▼
session log                       the NORMALIZED spec is stored (argsRaw)
   │                              — fork/resume/replay render identically
   ▼
client.js  IntelligentUiView      tool.call.toolview slot, key `ui_render`
   ├─ readSpec(block)             parse the accepted args from the tool block
   ├─ useTheme(theme)             theme snapshot + font size
   └─ per kind:
        fixed card                pure render of the spec
        app      → AppView → loadEngine() → AppSurface
        playground → PlaygroundView (edit → validateApp → preview)
   ▼
AppSurface
   ├─ useAppRuntime               state, computed, dispatch/fire, toasts
   ├─ (optional) Mock Streaming   spec.stream.mode "mock": StreamPlayer
   │                              replays mockStreamEvents at intervalMs
   ▼
AppNode (recursive)               resolveProps(node, scope) = literals ⊕ bind
   ├─ REGISTRY[node.type]         one component per node
   └─ NodeBoundary                per-node error isolation
   ▼
user interaction                  component fires ctx.fire(node, event, value)
   ▼
Action Router
   ├─ engine.planAction(action, {state, computed, eventValue, services})
   │     pure permission check + effect plan  (set/toggle/copy/open/submit/call/error)
   └─ useAppRuntime.dispatch      performs the effect, reports the REAL result
        set/toggle → engine.setPath → setState (immutable copy)
        copy       → navigator.clipboard.writeText → toast ok/fail
        open       → window.open(..., 'noopener,noreferrer') → toast url/blocked
        submit     → toast "Submitted"
        call       → services[name](payload) → toast ok / "not connected" / failed
   ▼
state change → computeAll(spec.compute, state) → new scope
   ▼
every bound prop re-resolves       KPIs, charts, tables update together
```

Key properties:

- **Pure spec → pure render.** Nothing is fetched from the Host at render
  time; the card is a function of the accepted tool arguments plus
  client-local interaction state. Reload, fork and resume redraw the same card
  from the session log.
- **One source of truth for rules.** The Host validates with `engine.cjs`; the
  Client renders with `engine.cjs` (via `client.engine.js`). They cannot drift.
- **Binding loop.** `bind` expressions read the scope
  `{...state, ...computeAll(compute, state)}`; actions write `state`; the write
  recomputes and every dependent prop re-resolves. One input change moves all
  dependent KPIs, charts and tables in one render.
- **Success is an execution fact.** A plan is a *permission*, not a result;
  `dispatch` toasts success only after the clipboard write, the popup, the
  form, or the service call actually happened (see §5).

---

## 3. How a component participates in AI-driven composition

1. **The model writes JSON.** The prompt section in `index.js` tells it when a
   structure beats prose and the tool schema shows the vocabulary. It emits
   `{id, type, props, bind?, on?, children?}` nodes — data only.
2. **The registry validates.** `engine.cjs`'s `TYPES` decides which types
   exist, which props each accepts (typos become tool errors, not silent
   drops), which take children, and how deep/large the tree may be.
3. **The registry renders.** `client.js`'s `REGISTRY` maps `type` → component.
   A spec that passed validation always finds its component (and vice versa —
   `test/engine.mjs` checks every registered name resolves).
4. **State makes it interactive.** Controls write `state` through actions;
   `compute` derives; `bind` re-renders. The model composes behaviour
   declaratively (`on.change → set path`), it does not program it.
5. **Feedback feeds back.** Events carry component-specific values (form maps,
   quiz scores, place ids); a `set` with neither `value` nor `expr` writes that
   event value, so simple two-way binding is two lines of JSON.

The `playground` kind closes the loop for humans: paste a schema, see
`validateApp`'s exact error, see the preview — the same code path as the model.

---

## 4. Adding a new component

Two edits, one per registry — nothing else is required for a plain component.

1. **Engine registry** — add its type to `TYPES` in `engine.cjs`:

   ```js
   stepper2: { props: ['steps', 'current'], children: false },
   ```

   Declare the complete prop allow-list and whether it takes `children`. The
   Host-side validator, the tool docs (`docs/schema.md` table), the budgets and
   the Client's prop resolution all pick it up from here.

2. **Client registry** — implement and register the component in `client.js`:

   ```js
   function AppStepper2({ props, ctx, node }) { /* render from props; ctx.fire(node, 'change', value) */ }
   // …
   const REGISTRY = { …, stepper2: AppStepper2 }
   ```

   Conventions to follow (all established in `client.js`):
   - props arrive **resolved** (`resolveProps` merged `bind` over literals);
     read only your allow-listed names;
   - use `ctx.fire(node, <event>, <value>)` for `on` handlers, `ctx.toast(text, tone)`
     for transient feedback, `ctx.t(key)` for static strings (add to `DICTS`);
   - keep colors semantic — `colorFor(props.tone, …, ctx.colors)` or theme
     tokens, never literal colors;
   - follow the font-size variables (`calc(<px> + var(--iui-fs-delta))`) and
     the accessibility conventions (`role="alert"` boxes, `aria-label` on icon
     buttons);
   - if it needs a new event name, add it to `EVENTS` in `engine.cjs` too.
3. If the type has chart aliases or fixed-card variants, wire those in the
   obvious places (`ALIASES`, `normalizeSpec`); for a pure `app` node there is
   nothing more.

A component that needs a new action verb is a bigger change: `ACTIONS` +
`normalizeAction` in `engine.cjs`, `planAction` (the permission check), and the
`switch` in `useAppRuntime.dispatch`. Keep the plan/execute split — it is what
makes actions testable without a browser.

---

## 5. Wiring a real backend / external service

The plugin ships **no backend**. Everything below is the prepared seam.

### External service calls (`action: "call"`)

- Spec side: `on.<event>: {action: "call", service: "weather", payload: {...}}`.
- Planning side: `planAction` looks the name up in `ctx.services`; missing →
  the explicit error plan `service "weather" is not connected`
  (`notConnected: true`) which the user sees as a toast — never a fake success.
- Execution side: `useAppRuntime` holds the registry as a ref:

  ```js
  const services = useRef({})           // currently empty by design
  // planAction returns {kind:'call', service, payload, run}; dispatch awaits run(payload)
  ```

  To connect one, register an async function in that registry (this is the one
  place the plugin expects integration code to land):

  ```js
  services.current.weather = async (payload) => {
    const res = await fetch('https://example.com/api/weather?city=' + encodeURIComponent(payload.city))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  ```

  `dispatch` already handles the promise: loading toast → success toast or
  `Service call failed: <reason>`. A future version could populate the registry
  from plugin config or a host service — 待确认 (no such loader exists today).

### Real LLM streaming (SSE)

- Protocol side is done: `StreamPlayer` consumes
  `node.add` / `node.patch` / `node.remove` / `stream.done` / `stream.error`
  with sequence numbers, session checks, dedupe, out-of-order repair and
  error-park + `retry()` resume ([schema.md](schema.md) §9). `mockStreamEvents`
  proves the shape deterministically.
- The reserved source is `createSseSource(url)` in `client.js`: today
  `connect()` rejects with *"SSE source is not connected: configure a backend
  endpoint to stream real LLM events"*. A real implementation returns an event
  source whose parsed JSON events are pushed into the same `StreamPlayer`
  (`player.push(event)`); the reconnect story is `player.retry()` after
  re-establishing the stream from `lastSeq + 1`.
- `AppSurface` currently drives the player from `mockStreamEvents` on a timer
  (`intervalMs`, default 90 ms) with **Replay**/**Retry** buttons (the mock
  Retry restarts the replay; the engine-level `retry()` is what an SSE source
  would use).

### Why not a map/math/markdown/full-HTML backend?

Deliberate self-containment (details in the README's *What is real vs mock*):
the map is an SVG schematic (no tile service), math is a formula subset (KaTeX
fonts cannot ship through the plugin route), markdown is a safe subset (never
HTML), `fileUpload` never transfers files. Each has the upgrade path noted at
the definition site in `client.js`.
