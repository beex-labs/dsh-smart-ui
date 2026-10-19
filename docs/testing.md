# Testing

What each test script checks, and what has actually been run. **Rule of this
document: a result is only written down when the command was executed in this
documentation pass.** Everything else is explicitly marked as pending.

## Test report — documentation pass, 2026-10-19

Executed in this pass, from the plugin root, with `node`:

| Command | Result | Exit |
|---|---|---|
| `node test/engine.mjs` | **69 checks passed** (expressions incl. the `min`/`max` array-argument cases, state paths, app validation, compute/binding, action planning incl. `set` without value/expr writing the event value, `chart.series` shape guards, streaming) | 0 |
| `node test/normalize.mjs` | **78 checks passed** (fixed-card kinds as before, extended with 24 `app`/`playground` normalizer checks) | 0 |
| `node demos/check.mjs` | **all demos pass (14 checks)** — every `demos/*.json` validates through `validateApp` and its scenario check holds | 0 |
| `node test/app-interaction.mjs` | **22 checks passed across 7 demos** — every demo renders without error boxes and a real interaction moves the DOM | 0 |
| `node test/app-render.mjs` | **20 checks** (binding render, interactive linking, action routing clipboard/open/call, error boundary, unknown component, bind error, Mock streaming, Playground) — **green per the test pass**; a local re-run here was blocked because Chrome is not runnable in this environment ("the page did not report a result"), so this number is the test pass's and is not claimed as re-verified here | test pass |
| `node test/shot-app.mjs` | **5 screenshots** in `test/out-app/` (`shot-travel.png`, `shot-analytics.png`, `shot-quiz.png`, `shot-stream-midflight.png`, `shot-analytics-dark.png`) — produced by the test pass; the artifacts were verified present in this pass | test pass |

One browser suite was executed in this pass (`app-interaction`, 22 checks) and
one attempted (`app-render`, blocked by the local Chrome); the remaining
browser scripts belong to the test pass and are marked accordingly. Nothing
below claims a pass that was not executed.

## Test scripts

| Script | Command | What it checks | Status in this pass |
|---|---|---|---|
| `test/engine.mjs` | `node test/engine.mjs` | The engine contract in executable form: expression grammar + precedence + functions, rejection of `eval`/unknown functions/prototype paths/deep nesting, state-path parsing and immutable `setPath`, `validateApp` acceptance and every guard (unknown type/prop/event/action, duplicate & bad ids, children-on-leaf, depth and node budgets, non-JSON state, oversized strings, compute cycles and state shadowing, stream options), `computeAll` dependency order, `resolveProps` overlay + broken-binding degradation, `planAction` for all six verbs (incl. `open` http(s)-only, `call` "not connected", and `set` without value/expr writing the event value), the `chart.series` shape guards, `mockStreamEvents` determinism, `StreamPlayer` dedupe / out-of-order repair / `stream.error` park + `retry()` tail resume, nested `node.patch`/`node.remove` | ✅ ran: 69 checks passed |
| `test/normalize.mjs` | `node test/normalize.mjs` | `normalizeSpec`: one happy path per kind for the fixed cards (chart variants and the one-point `line` guard, semantic-tone enforcement, progress bounds, `diagram` structured/raw forms with Mermaid compilation, tone classes, quote escaping, 12 000-char cap), the "blank optional field means absent, blank required field fails" rule, plus `app`/`playground` normalization checks | ✅ ran: 78 checks passed |
| `test/echarts-chunk.mjs` | `node test/echarts-chunk.mjs` | Loads the generated `client.echarts.js` **without a browser** through a fake `window.__ModuleLoader__` and asserts the UMD wrapper yields a usable ECharts (no global leak) | ⏳ see lead's report |
| `test/render-svg.mjs` | `node test/render-svg.mjs` | ECharts SSR renders chart/diagram options to real SVG/PNG in `test/out/` for eyeballing (the live DSH page is not reachable from a test script) | ⏳ see lead's report |
| `test/render-mermaid.mjs` | `node test/render-mermaid.mjs` | Headless Edge renders the Mermaid diagram families (flow, sequence, state, ER, mind map, Gantt, …) into `test/out-mermaid/` | ⏳ see lead's report |
| `test/shot-mermaid.mjs` | `node test/shot-mermaid.mjs` | Chrome screenshots of the rendered Mermaid diagrams (their labels are `foreignObject` HTML, so rasterizing offline drops them) | ⏳ see lead's report |
| `test/font-and-overflow.mjs` | `node test/font-and-overflow.mjs` | Headless layout measurements: type follows `--dsh-content-font-size`, wide tables scroll sideways, 15+ row tables scroll inside with a pinned header — all computed styles, invisible to plain assertions | ⏳ see lead's report |
| `test/font-live.mjs` | `node test/font-live.mjs` | Changing the font-size setting re-renders an already-mounted card **and** its chart | ⏳ see lead's report |
| `test/shot-font.mjs` | `node test/shot-font.mjs` | Screenshots at 10/14/22px into `test/out-font/` (fetches React from a CDN) | ⏳ see lead's report |
| `test/app-render.mjs` | `node test/app-render.mjs` | App engine rendering in a real browser: bound render, interactive linking, action routing (clipboard / open / call), error boundary, unknown component, bind error, Mock streaming, Playground | ⚠️ 20 checks green per the test pass; local re-run blocked (Chrome not runnable here) — not claimed as re-verified |
| `test/app-interaction.mjs` | `node test/app-interaction.mjs` | Every demo renders without error boxes and a real interaction drives a DOM change (state write-back, bindings updating) | ✅ ran: 22 checks passed across 7 demos |
| `test/shot-app.mjs` | `node test/shot-app.mjs` | App screenshots for inspection: travel / analytics / quiz / stream-midflight / analytics-dark | test pass produced 5 PNGs in `test/out-app/` (artifacts verified present) |
| `demos/check.mjs` | `node demos/check.mjs` | One-off script (not a test): validates every `demos/*.json` through `validateApp` and runs each scenario's interaction check | ✅ ran: all demos pass (14 checks) |

Browser scripts look for Chrome/Edge at the default Windows install paths and
drive a headless instance with a temp profile. `shot-font` additionally fetches
React from a CDN.

## Verified / mocked / not verified

| Capability | Status | Evidence |
|---|---|---|
| Safe expression language (parse + evaluate, precedence, functions, lazy ternary) | **Verified** | `test/engine.mjs` (ran) |
| Expression safety guards (`eval`/unknown function/prototype path/depth/length rejection) | **Verified** | `test/engine.mjs` (ran) |
| State paths + immutable `setPath` | **Verified** | `test/engine.mjs` (ran) |
| `validateApp` schema rules and budgets (`LIMITS`) | **Verified** | `test/engine.mjs` (ran) |
| `compute` dependency order, `resolveProps` binding overlay, broken-binding degradation | **Verified** | `test/engine.mjs` (ran) |
| Action **planning** (`planAction`: all verbs, http(s)-only `open`, `call` "not connected") | **Verified** (pure function) | `test/engine.mjs` (ran) |
| Streaming protocol mechanics (seq/session, dedupe, out-of-order repair, `stream.error` + `retry()` tail resume) | **Verified** | `test/engine.mjs` (ran) |
| Mock Streaming determinism (`mockStreamEvents`) | **Verified** | `test/engine.mjs` (ran) |
| Fixed-card normalization incl. host-side Mermaid compilation & quote escaping | **Verified** | `test/normalize.mjs` (ran) |
| Action **execution** in a browser (Clipboard API, `window.open`, submit toast, `call` toast path) | **Verified** | `test/app-render.mjs` — 20 checks green per the test pass (local Chrome blocked); `test/app-interaction.mjs` (ran here, 22 checks) |
| App component rendering, state binding re-render loop, dataTable/map/quiz interactions | **Verified** | `test/app-render.mjs` (test pass) + `test/app-interaction.mjs` (ran here, 7/7 demos) + `test/shot-app.mjs` screenshots |
| ECharts/Mermaid chunk loading and real chart/diagram output | **Not verified** in this pass | `test/echarts-chunk.mjs`, `test/render-svg.mjs`, `test/render-mermaid.mjs`, `test/shot-mermaid.mjs` — test pass |
| Font-size following, table overflow behaviour | **Not verified** in this pass | `test/font-and-overflow.mjs`, `test/font-live.mjs`, `test/shot-font.mjs` — test pass |
| External service `call` execution | **Mocked by design** — no service ships registered; the unregistered path ("not connected") is verified, a registered-service run exists only in the engine test with an inline stub | `test/engine.mjs` (ran) + `useAppRuntime` |
| Real LLM SSE streaming | **Not implemented** — `createSseSource` is a reserved seam whose `connect()` rejects by design | `client.js` |
| Map tiles, KaTeX-grade math, HTML markdown | **Deliberately not implemented** (schematic SVG map, formula subset, safe markdown subset) — see README, *What is real vs mock* | `client.js` |

## Fixed issues

| Issue | Fix |
|---|---|
| `SPEC_PROPERTIES` in `index.js` declared `value` twice (progress's number, then the playground's JSON text) — one entry silently overwrote the other in the tool schema the model sees. Found during the documentation review. | Fixed in the source: the playground field was renamed to `source` (`normalizeSpec` case `playground` reads `spec.source`; `PlaygroundView` reads `spec.source`). Docs use `source` throughout. |
| `dataTable`'s filter "All" option called `t('all')`, but `all` was missing from the plugin dictionaries (`DICTS`) — the label depended on the host locale's missing-key fallback. | Fixed: `all` added to `DICTS` (en "All" / zh "全部"); the label renders normally. |
| `carousel.auto`, `quiz.shuffle`, `map.center`/`zoom` were accepted by the engine allow-lists but unused by the renderers — contract wider than implementation. | Fixed: removed from the `TYPES` allow-lists; docs updated accordingly. |
| `text`'s allow-list rejected `bold`/`italic` although the renderer already styled them — supported props unreachable. | Fixed: `bold`/`italic` added to the `text` allow-list. |
| `sui-caption` / `sui-total` class names had no stylesheet rule (typo of `iui-*`), so those elements were unstyled. | Fixed: renamed to `iui-caption` / `iui-total`. |
| `app` charts validated `series` by name only: `series: [null]` passed validation and crashed at render into the node error box — inconsistent with the fixed-card `chart` kind. | Fixed: `validateApp` now shape-checks `chart.series` points (`label`/`value`/`tone`, see `engine.cjs`); the renderer keeps its tolerance as a fallback for streaming patches. |
| A node's error boundary wrapped the component but not the children expansion, so malformed `children` could crash past it and blank the whole card. | Fixed: `AppNode` wraps itself in `NodeBoundary`, so every failure boxes at its node id. |
| A bare `{action: 'set', path}` that bypassed normalization wrote `undefined` into state. | Fixed: `planAction` defaults a `set` with neither `value` nor `expr` to the event value (same as `normalizeAction`'s `{$event: true}`). |
