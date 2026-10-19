# Testing

What each test script checks, and what has actually been run. **Rule of this
document: a result is only written down when the command was executed in this
documentation pass.** Everything else is explicitly marked as pending.

## Test report — documentation pass, 2026-10-19

Executed in this pass, from the plugin root, with `node`:

| Command | Result | Exit |
|---|---|---|
| `node test/engine.mjs` | **65 checks passed** (expressions incl. the `min`/`max` array-argument cases, state paths, app validation, compute/binding, action planning, streaming) | 0 |
| `node test/normalize.mjs` | **54 checks passed** (per-kind happy paths + guards for the 10 fixed cards and `diagram` compilation) | 0 |
| `node demos/check.mjs` | **all demos pass (14 checks)** — every `demos/*.json` validates through `validateApp` and its scenario check holds | 0 |

No browser-based script was run in this pass — those results belong to the
test pass (`tests` teammate) and are summarized in the lead's report. Nothing
below claims a pass that was not executed.

## Test scripts

| Script | Command | What it checks | Status in this pass |
|---|---|---|---|
| `test/engine.mjs` | `node test/engine.mjs` | The engine contract in executable form: expression grammar + precedence + functions, rejection of `eval`/unknown functions/prototype paths/deep nesting, state-path parsing and immutable `setPath`, `validateApp` acceptance and every guard (unknown type/prop/event/action, duplicate & bad ids, children-on-leaf, depth and node budgets, non-JSON state, oversized strings, compute cycles and state shadowing, stream options), `computeAll` dependency order, `resolveProps` overlay + broken-binding degradation, `planAction` for all six verbs (incl. `open` http(s)-only and `call` "not connected"), `mockStreamEvents` determinism, `StreamPlayer` dedupe / out-of-order repair / `stream.error` park + `retry()` tail resume, nested `node.patch`/`node.remove` | ✅ ran: 65 checks passed |
| `test/normalize.mjs` | `node test/normalize.mjs` | `normalizeSpec` for the fixed cards: one happy path per kind, chart variants and the one-point `line` guard, semantic-tone enforcement (literal colors rejected), progress bounds, `diagram` structured/raw forms (Mermaid compilation, tone classes, quote escaping, 12 000-char cap), and the "blank optional field means absent, blank required field fails" rule | ✅ ran: 54 checks passed |
| `test/echarts-chunk.mjs` | `node test/echarts-chunk.mjs` | Loads the generated `client.echarts.js` **without a browser** through a fake `window.__ModuleLoader__` and asserts the UMD wrapper yields a usable ECharts (no global leak) | ⏳ see lead's report |
| `test/render-svg.mjs` | `node test/render-svg.mjs` | ECharts SSR renders chart/diagram options to real SVG/PNG in `test/out/` for eyeballing (the live DSH page is not reachable from a test script) | ⏳ see lead's report |
| `test/render-mermaid.mjs` | `node test/render-mermaid.mjs` | Headless Edge renders the Mermaid diagram families (flow, sequence, state, ER, mind map, Gantt, …) into `test/out-mermaid/` | ⏳ see lead's report |
| `test/shot-mermaid.mjs` | `node test/shot-mermaid.mjs` | Chrome screenshots of the rendered Mermaid diagrams (their labels are `foreignObject` HTML, so rasterizing offline drops them) | ⏳ see lead's report |
| `test/font-and-overflow.mjs` | `node test/font-and-overflow.mjs` | Headless layout measurements: type follows `--dsh-content-font-size`, wide tables scroll sideways, 15+ row tables scroll inside with a pinned header — all computed styles, invisible to plain assertions | ⏳ see lead's report |
| `test/font-live.mjs` | `node test/font-live.mjs` | Changing the font-size setting re-renders an already-mounted card **and** its chart | ⏳ see lead's report |
| `test/shot-font.mjs` | `node test/shot-font.mjs` | Screenshots at 10/14/22px into `test/out-font/` (fetches React from a CDN) | ⏳ see lead's report |
| `test/app-render.mjs` | `node test/app-render.mjs` | **Being written by the `tests` teammate** — app engine rendering in a real browser | ⏳ PLACEHOLDER: run by the test pass; see lead's report |
| `test/app-interaction.mjs` | `node test/app-interaction.mjs` | **Being written by the `tests` teammate** — Action Router interactions (state write-back, bindings updating, actions) in a real browser | ⏳ PLACEHOLDER: run by the test pass; see lead's report |
| `test/shot-app.mjs` | `node test/shot-app.mjs` | **Being written by the `tests` teammate** — app screenshots for inspection | ⏳ PLACEHOLDER: run by the test pass; see lead's report |
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
| Action **execution** in a browser (Clipboard API, `window.open`, submit toast, `call` toast path) | **Not verified** in this pass | `test/app-interaction.mjs` — test pass |
| App component rendering, state binding re-render loop, dataTable/map/quiz interactions | **Not verified** in this pass | `test/app-render.mjs`, `test/app-interaction.mjs`, `test/shot-app.mjs` — test pass |
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
