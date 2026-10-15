**English** | [简体中文](README.zh-CN.md)

# dsh-smart-ui

Structured UI cards for DSH conversations. The model calls one tool, `ui_render`, writes a JSON spec — and the page renders an interactive card: comparisons, charts, headline figures, ordered steps, tables, live calculators, unit conversions, flowcharts.

Answers are often structures: three or more things compared on shared criteria, a series of magnitudes, a handful of headline numbers, ordered steps, rows of records, arithmetic the user wants to redo with their own numbers. In plain text those cost tokens and read badly. This plugin hands the structure to a card and leaves the prose as the conclusion.

- **The model writes data, never HTML/JSX.** The spec is plain JSON; it goes into the session log and redraws identically after a fork or a resume.
- **The card is a pure function of the tool arguments.** Nothing is fetched from the host, so a reload or a resumed session gets the same card.
- **Light and dark both work.** A spec only carries semantic tones (`success`, `warn`, …); the client resolves them to theme tokens, so the model never writes a literal color.

## Card types

| `kind` | When to use | Main fields |
|--------|-------------|-------------|
| `compare` | three or more things compared on shared criteria | `columns`, `rows[{label, cells[]}]` |
| `chart` | a series of magnitudes (`bar`), a trend (`line`), parts of one whole (`pie` / `donut`) | `series[{label, value, tone?, hint?}]`, `variant`, `unit` |
| `stats` | two to six headline figures | `stats[{label, value, tone?, hint?}]` |
| `progress` | one ratio to feel at a glance — pass rate, quota used | `value`, `max`, `label`, `unit`, `tone` |
| `steps` | three or more ordered steps | `steps["text" \| {text, detail?}]` |
| `table` | rows and columns of records | `columns`, `rows[][]` |
| `diagram` | boxes joined by arrows: flow, decision tree, hierarchy, dependency or class sketch | `nodes[{id, label, detail?, tone?}]` + `edges[{from, to, label?}]` + `layout`, or raw `mermaid` |
| `calculator` | arithmetic the user will redo with their own numbers — bill split, tip | `mode: split \| tip`, `fields[{label, value, min?, max?}]` |
| `unit` | a quantity converted between units | `units`, `factors?`, `from`, `to`, `value` |
| `note` | one thing the reader must not miss | `text`, `tone` |

Every card also takes `title` (heading) and `caption` (footnote).

`diagram` has two forms: a structured `nodes` + `edges` list (compiled to a Mermaid flowchart; `layout: "tree"` draws a top-down hierarchy) or complete `mermaid` source (sequence, state machine, Gantt, ER, and the rest of the diagram family). Exactly one of the two.

## How it works

```text
the model writes a spec (plain JSON)
   ↓
index.js   registers the ui_render tool and one prompt section:
           validation, normalization, oversize errors back to the model
   ↓
client.js  renders the card in the tool.call.toolview slot
```

- `index.js` is the host half: the tool schema, `normalizeSpec` and the Mermaid compilation all live here, so the session log stores exactly the diagram that was drawn.
- `client.js` is the client half: `compare` / `stats` / `steps` / `table` / `note` / `calculator` / `unit` are plain React, `progress` is inline SVG, `chart` goes through ECharts, `diagram` through Mermaid.
- The chart libraries are **lazy chunks**: `client.echarts.js` / `client.mermaid.js` are generated, loaded on first use, and never committed.

## Install

Add this repo to your DSH profile dependencies — a local `link:` or a GitHub URL both work:

```json
{
  "dependencies": { "dsh-smart-ui": "link:<absolute path>" },
  "dsh": { "profile": { "bundles": ["dsh-smart-ui"] } }
}
```

Insert the plugin line in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: smart-ui
      name: 'dsh-smart-ui'
```

Then install:

```bash
cd "$DSH_PROFILE_DIR"
pnpm install --no-frozen-lockfile
```

## Build

The two chart chunks are **generated** and git-ignored. Build them after installing, or charts fall back to a plain-text summary:

```bash
pnpm install
node build-echarts.mjs     # writes client.echarts.js
node build-mermaid.mjs     # writes client.mermaid.js
```

The scripts wrap the npm dist files in DSH's module-loader envelope: ECharts takes its UMD `exports` branch (no global leak), and Mermaid's API is captured off `globalThis` before the global is deleted again.

## Tests

```bash
node test/normalize.mjs      # spec normalizer self-check: happy path + guards, per kind
node test/echarts-chunk.mjs  # loads the generated chunk without a browser, asserts a usable ECharts
node test/render-svg.mjs     # ECharts SSR renders charts and flowcharts into test/out for inspection
node test/render-mermaid.mjs # renders the Mermaid diagram families headless into test/out-mermaid
node test/shot-mermaid.mjs   # Chrome screenshots (Mermaid labels are foreignObject HTML)
```

The last two look for Chrome / Edge (default Windows install paths).

## Deliberate limits

| Limit | Value | Why |
|-------|-------|-----|
| nodes per spec | 400 (`apply(ctx, { maxNodes })`) | a runaway model cannot wedge the page |
| raw `mermaid` source | 12000 chars | one card cannot swallow the page |
| `diagram` forms | exactly one | the two paths can never disagree |

## Acknowledgments

Thanks to everyone who contributed to this project:

[<img src="https://github.com/windzxy.png?size=80" width="80" alt="@windzxy">](https://github.com/windzxy) [<img src="https://github.com/anyiba.png?size=80" width="80" alt="@anyiba">](https://github.com/anyiba)

## License

MIT, see [LICENSE](LICENSE).

This repo contains no chart-library code (the generated chunks are git-ignored); the build pulls them from npm: ECharts under Apache License 2.0, Mermaid under MIT.
