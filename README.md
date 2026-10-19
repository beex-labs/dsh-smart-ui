**English** | [简体中文](README.zh-CN.md)

# dsh-intelligent-ui

Generative UI for DSH conversations. The model calls one tool, `ui_render`,
writes a JSON UI Schema — and the page renders a live, state-bound interactive
interface: forms, KPIs, charts and tables linked by shared state, micro-apps,
maps, streaming growth. The same tool also renders ten fixed card kinds for
answers that are a single static structure, and a Schema Playground for humans.

The model writes **data, never HTML/JSX/JavaScript**. Specs are plain JSON, so
they survive the session log, a fork and a resume unchanged. Bindings run in a
hand-written safe expression language (no `eval`, fixed function table), state
changes flow through an Action Router that reports only effects that really
happened, and semantic tones resolve to theme tokens so every card works in
light and dark.

## Two vocabularies

**Fixed cards** — one structure per answer, render instantly, no state:

| `kind` | When to use | Main fields |
|--------|-------------|-------------|
| `compare` | three or more things compared on shared criteria | `columns`, `rows[{label, cells[]}]` |
| `chart` | a series of magnitudes (`bar`), a trend (`line`), parts of one whole (`pie` / `donut`) | `series[{label, value, tone?, hint?}]`, `variant`, `unit` |
| `stats` | two to six headline figures | `stats[{label, value, tone?, hint?}]` |
| `progress` | one ratio to feel at a glance — pass rate, quota used | `value`, `max`, `label`, `unit`, `tone` |
| `steps` | three or more ordered steps | `steps["text" \| {text, detail?}]` |
| `table` | rows and columns of records | `columns`, `rows[][]` |
| `diagram` | boxes joined by arrows, or any Mermaid family | `nodes[{id, label, detail?, tone?}]` + `edges[{from, to, label?}]` + `layout`, or raw `mermaid` |
| `calculator` | arithmetic the user will redo with their own numbers | `mode: split \| tip`, `fields[{label, value, min?, max?}]` |
| `unit` | a quantity converted between units | `units`, `factors?`, `from`, `to`, `value` |
| `note` | one thing the reader must not miss | `text`, `tone` |

**Generative UI** — `kind: "app"`, the interactive vocabulary:

| `kind` | When to use | Main fields |
|--------|-------------|-------------|
| `app` | an interactive tool, simulator or dashboard the user adjusts and watches update live | `state`, `compute`, `tree` (`{id, type, props, bind, on, children}`), `stream` |
| `playground` | an editable JSON UI Schema with live validation and preview | `source` (JSON text; a broken schema is expected and shown) |

An `app` is a component tree drawn from a 71-type registry — 77 names with the
chart aliases (text, layout,
controls, charts, tables, maps, media, feedback, `quiz`/`flashcard`/
`countdown`), wired together by `bind` expressions over `state` + `compute`
and `on` actions (`set`, `toggle`, `copy`, `open`, `submit`, `call`). One input
change updates every dependent KPI, chart and table at once.

## How it works

```text
the model writes a spec (plain JSON)
   ↓
index.js      host half: ui_render tool + one prompt section;
              normalizeSpec (fixed cards) and the node budget
   ↓
engine.cjs    shared half: registry, safe expression language,
              validateApp, computeAll/resolveProps, planAction,
              streaming protocol — same code on both sides
              (build-engine.mjs wraps it into client.engine.js)
   ↓
client.js     client half: renders into the tool.call.toolview slot —
              fixed cards, the app runtime (state, actions, toasts),
              the 71-component REGISTRY, Mock Streaming, the Playground
```

- **Host half** (`index.js`): the tool schema and prompt section live next to
  the validator; structured `diagram` specs are compiled to Mermaid source on
  the Host, so the session log stores exactly the diagram that was drawn.
- **Shared engine** (`engine.cjs`, CommonJS on purpose): the Host `import`s it,
  the Client loads `client.engine.js`. Both halves validate and evaluate with
  identical code — they cannot drift.
- **Client half** (`client.js`): everything visual. Charts and diagrams go
  through ECharts/Mermaid lazy chunks (`client.echarts.js` / `client.mermaid.js`,
  generated, git-ignored); everything else is plain React over theme tokens.

Details: [docs/architecture.md](docs/architecture.md) ·
[docs/schema.md](docs/schema.md) · [docs/components.md](docs/components.md).

### Following the font size

DSH's theme presenter writes the user's content font size to `document.body` as
`--dsh-content-font-size` (10–22px) and emits `theme/change` on every change.
Stylesheet rules are `calc(<authored size> + var(--iui-fs-delta))`, so a whole
card scales from one write; ECharts and Mermaid get real px numbers from the
same variable, with a floor so the smallest labels stay readable.

### Table overflow

Columns are unbounded — a wide table scrolls sideways. Rows cap at 15: past
that the body scrolls inside the card with a pinned header. The cap is a row
count, not a pixel height, so it stays 15 rows at every font size.

## Quick start

### Build

The three chunks are **generated** and git-ignored. Build them after
installing, or charts degrade to a plain-text summary and apps cannot load the
engine:

```bash
pnpm install
node build-engine.mjs && node build-echarts.mjs && node build-mermaid.mjs
```

The scripts wrap the sources in DSH's module-loader envelope: `engine.cjs`
verbatim, ECharts through its UMD `exports` branch (no global leak), Mermaid's
`globalThis` assignment captured and removed again.

### Install into a DSH profile

Add this repo to your DSH profile dependencies — a local `link:` or a GitHub
URL both work:

```json
{
  "dependencies": { "dsh-intelligent-ui": "link:<absolute path>" },
  "dsh": { "profile": { "bundles": ["dsh-intelligent-ui"] } }
}
```

Insert the plugin line in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: intelligent-ui
      name: 'dsh-intelligent-ui'
```

Then install:

```bash
cd "$DSH_PROFILE_DIR"
pnpm install --no-frozen-lockfile
```

## Demos

Seven runnable app specs live under [`demos/`](demos) — full descriptions in
[docs/demos.md](docs/demos.md). Each file is an `app` spec without the `kind`
wrapper; wrap it as `{"spec": {"kind": "app", …}}` or paste it into a
`playground` card's `source`.

| File | Scenario | Highlights |
|------|----------|------------|
| `demos/1-travel.json` | 京都旅行规划助手 / Kyoto trip planner | linked `map` + `places` selection, cost donut, itinerary table |
| `demos/2-analytics.json` | 销售分析仪表盘 / sales analytics dashboard | KPI row, segmented-control area chart, searchable/filterable/exportable `dataTable` |
| `demos/3-invest.json` | 理财复利模拟器 / compound-interest simulator | inputs → KPIs → line chart → progress bar, plus a `call` action that honestly reports "not connected" |
| `demos/4-learn.json` | 勾股定理互动讲解 / Pythagoras theorem lesson | safe-shape SVG triangle, `math` formula subset, tabs, flashcards |
| `demos/5-split.json` | AA 分账计算器 / bill split | compute + donut + per-person table, `copy` via `expr`, `form` + `submit` |
| `demos/6-quiz.json` | 世界地理问答闯关 / geography quiz | `quiz` micro-app, score → state (`on.change` expr), badge flips on pass |
| `demos/7-stream.json` | 流式渲染演示 · 服务负载看板 / streaming service-load dashboard | Mock Streaming (`stream: {mode: "mock"}`) progressive growth |

## Testing

```bash
node test/engine.mjs           # engine contract: expressions, validation, actions, streaming (69 checks)
node test/normalize.mjs        # fixed cards + app/playground normalization: happy paths + guards (78 checks)
node test/echarts-chunk.mjs    # loads the generated ECharts chunk without a browser
node test/render-svg.mjs       # ECharts SSR renders charts into test/out for inspection
node test/render-mermaid.mjs   # headless Mermaid diagram families into test/out-mermaid
node test/shot-mermaid.mjs     # Chrome screenshots (Mermaid labels are foreignObject HTML)
node test/font-and-overflow.mjs# headless: font tracking, wide-table scroll, 15-row cap
node test/font-live.mjs        # headless: a font-size change re-renders a mounted card + chart
node test/shot-font.mjs        # screenshots at 10/14/22px into test/out-font
node test/app-render.mjs       # app engine rendering in a real browser
node test/app-interaction.mjs  # Action Router interactions in a real browser
node test/shot-app.mjs         # app screenshots for inspection
node demos/check.mjs           # validates every demos/*.json through validateApp
```

The browser-based checks look for Chrome/Edge (default Windows install paths)
and measure computed styles in a real layout engine where assertions cannot
judge. Test report with per-script status: [docs/testing.md](docs/testing.md).

## Deliberate limits

| Limit | Value | Why |
|-------|-------|-----|
| nodes per `app` tree | 400 (`apply(ctx, { maxNodes })`) | a runaway model cannot wedge the page |
| tree nesting | 8 levels (root included) | readability and render cost |
| `state` size | 49 152 bytes serialized | it lives in the session log |
| one string value | 12 000 chars | one prop cannot swallow the card |
| one spec | 200 000 JSON chars | the whole payload budget |
| one expression | 2 000 chars, 32 nesting levels | bindings are formulas, not programs |
| expression vocabulary | fixed function table; no `eval`, no user functions, no assignment | model-authored JSON can never execute JavaScript |
| raw `mermaid` source | 12 000 chars | one diagram cannot swallow the page |
| `diagram` forms | exactly one of `mermaid` or `nodes`+`edges` | the two paths can never disagree |
| table rows before inner scroll | 15 | long tables scroll, they don't stretch the page |

## What is real vs mock

| Mechanism | Status |
|-----------|--------|
| Rendering of all 71 components (77 names with chart aliases), nesting, `hidden`/`span` | **Real** |
| State binding (`bind`), `compute` derivation, one-input→many-views re-render | **Real** |
| Actions `set`, `toggle`, `copy` (Clipboard API), `open` (`window.open` + popup-block detection), `submit` | **Real** — success is toasted only after the effect really happened |
| `dataTable` sorting / search / filter / pagination / selection / CSV export | **Real** (view-local) |
| Streaming protocol mechanics (sequence numbers, dedupe, out-of-order repair, `stream.error` + `retry()` resume) and Mock Streaming replay | **Real** |
| External service `call` | **Mocked** — no service ships registered, so a `call` explicitly reports *"service … is not connected"*, never a fake success. Wiring seam: the `services` registry in `useAppRuntime` ([docs/architecture.md](docs/architecture.md)) |
| Real LLM SSE streaming | **Reserved** — `createSseSource` exists as the integration point and rejects with "not connected" until a backend endpoint is configured |
| `map` | **Schematic** — an equirectangular SVG projection of the declared places (real math, no tile service). MapLibre/Leaflet were not used: both need network raster tiles and a much larger payload inside a chat card; a tile map can replace it behind the same node type |
| `math` | **Formula subset** — `x^2`, `x_i`, `\frac{a}{b}`, `\sqrt{x}`, degrading to plain text. KaTeX was not used: its renderer needs 20+ woff2 fonts the plugin route cannot serve |
| `markdown` | **Safe subset** — headings, lists, quotes, fenced code, inline bold/italic/code/links, rendered as React elements; never HTML |
| `fileUpload` | **Metadata only** — the action receives file names and sizes; nothing is transferred (no upload backend) |

Per-component behaviour and edge cases are documented in
[docs/components.md](docs/components.md).

## Acknowledgments

Thanks to everyone who contributed to this project:

[<img src="https://github.com/windzxy.png?size=80" width="80" alt="@windzxy">](https://github.com/windzxy) [<img src="https://github.com/anyiba.png?size=80" width="80" alt="@anyiba">](https://github.com/anyiba)

## License

MIT, see [LICENSE](LICENSE).

This repo contains no chart-library code (the generated chunks are git-ignored);
the build pulls them from npm: ECharts under Apache License 2.0, Mermaid under
MIT.
