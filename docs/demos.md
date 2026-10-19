# Demo scenarios

Seven runnable app specs live under [`demos/`](../demos). Each file is a
`kind: "app"` spec **without** the `kind` wrapper — the object holds
`{title, caption, state, compute, tree, stream?}` and validation supplies
`kind: 'app'` (validated by `demos/check.mjs`, a one-off script, not a demo —
`node demos/check.mjs` currently reports "all demos pass (14 checks)").
To render one in DSH, wrap it: `{"spec": {"kind": "app", ...file contents}}`,
or paste the contents into a `playground` card's `source`.

| File | Scenario | What it exercises |
|---|---|---|
| `demos/1-travel.json` | 京都旅行规划助手 / Kyoto trip planner | `state` + `compute` inputs (people/budget/days/date), KPI row, linked `map` + `places` list sharing a `selected` binding, cost-breakdown `donutChart`, day-by-day itinerary `dataTable` |
| `demos/2-analytics.json` | 销售分析仪表盘 / sales analytics dashboard | KPI row, 10-point `areaChart` switched by a `segmented` control (revenue/orders/units), searchable + filterable + exportable `dataTable` (`pageSize: 5`) |
| `demos/3-invest.json` | 理财复利模拟器 / compound-interest simulator | principal/rate/years/monthly inputs, future-value KPIs, year-by-year `lineChart`, goal `progress` bar, assumptions `stepper`, and one `call` action button that deliberately reports **"not connected"** |
| `demos/4-learn.json` | 勾股定理互动讲解 / Pythagoras theorem lesson | interactive `svg` right triangle (whitelisted shape vocabulary only), `math` formula node (`^`, `_`, `\frac`, `\sqrt`), 3-step `tabs` explanation, 3-card `flashcard` |
| `demos/5-split.json` | AA 分账计算器 / bill split | bill/people/tip inputs, KPI results, donut of cost shares, per-person `dataTable`, `copy` action via `expr` (copy-summary button), `form` with a required field + `submit` action |
| `demos/6-quiz.json` | 世界地理问答闯关 / geography quiz | `quiz` node (4 questions), score display, a "passed" flag written via `on.change` with an `expr` comparing state, `badge` that flips on pass, reset wired to the quiz's `click` |
| `demos/7-stream.json` | 流式渲染演示 · 服务负载看板 / streaming service-load dashboard | `stream: {mode: "mock", intervalMs: 80}` progressive rendering over a slider control + bound KPIs + chart |

Notes:

- The scenarios deliberately cover every app component family: text, layout,
  controls, data visualization, media/map, system feedback and micro-apps —
  see [components.md](components.md).
- `3-invest.json` is the canonical "what is real vs mock" demo: the `call`
  action runs the full Action-Router path and ends in the explicit
  `not connected` toast, by design (see README, *What is real vs mock*).
- `7-stream.json` is the Mock Streaming demo: the same deterministic
  `mockStreamEvents` replay a real LLM stream would produce
  ([schema.md](schema.md) §9).
