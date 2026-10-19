# JSON UI Schema protocol

The contract between the model and the page. The model calls one tool,
`ui_render`, with `{ "spec": { … } }`; everything below describes what a spec
may contain and what the Host does with it before anything is rendered.

Two vocabularies live under `spec.kind`:

| Vocabulary | `kind` values | Validated by | Purpose |
|---|---|---|---|
| Fixed cards | `compare`, `chart`, `stats`, `progress`, `steps`, `table`, `diagram`, `calculator`, `unit`, `note` | `normalizeSpec` in `index.js` | one structure per answer, render instantly, no state |
| Generative UI | `app` | `validateApp` in `engine.cjs` | state-bound interactive interface: controls, computed values, actions, streaming |
| Schema Playground | `playground` | `normalizeSpec` in `index.js` (shallow) | an editable JSON UI Schema with live validation and preview; broken input is expected |

Every spec is plain JSON data. The Host validates and **normalizes** it in
`execute()`; the normalized form is what the session log stores and what the
Client renders, so a transcript, a fork and a resume all draw the same thing.
Validation errors throw and reach the model as corrective tool errors — never a
silently empty card.

Source of truth: [`engine.cjs`](../engine.cjs) (registry, expressions, `validateApp`,
`planAction`, streaming) and [`index.js`](../index.js) (`ui_render` schema,
`normalizeSpec` for the fixed kinds). Rendered behaviour of each component is in
[components.md](components.md).

---

## 1. Tool envelope

Registered by [`index.js`](../index.js) as `ui_render`:

```jsonc
{
  "spec": {
    "kind": "app",          // required; one of the kinds in the table above
    "title": "…",           // optional heading (all kinds)
    "caption": "…",         // optional footnote (all kinds)
    // … kind-specific fields …
  }
}
```

The tool parameter schema (the `SPEC_PROPERTIES` map in `index.js`) is what the
model sees; the runtime checks below are stricter and are what actually decide
acceptance. Field names are kind-scoped and unambiguous: `value` is a number
(`progress`, `unit`) or a bound prop value, while the playground's JSON text
lives in `source` — an earlier revision called it `value` and collided with
`progress` in the tool schema; the rename fixed that.

After a call, `execute()` also enforces a payload-size budget on the rendered
card: `nodeCount(spec)` counts payload entries per kind (e.g. chart points,
table cells, `app` tree nodes) and rejects anything over `maxNodes`
(default 400, tunable via `apply(ctx, { maxNodes })`).

### Fixed-card fields

All fields below are validated by `normalizeSpec`. Blank optional strings are
dropped (treated as absent), never an error. `tone` is always one of
`neutral | info | success | warn | error` — semantic names only, never colors.

| kind | Required | Optional | Notes |
|---|---|---|---|
| `compare` | `columns` (≥ 2 strings), `rows[{label, cells[]}]` | — | `cells.length` must equal `columns.length` |
| `chart` | `series[{label, value, tone?, hint?}]` (non-empty) | `variant` (`bar`\|`line`\|`pie`\|`donut`, default `bar`), `unit` | `line` needs ≥ 2 points |
| `stats` | `stats[{label, value, tone?, hint?}]` (non-empty) | — | values must be finite numbers |
| `progress` | `value` (number ≥ 0) | `max` (> 0, default 100), `label`, `unit`, `tone` | |
| `steps` | `steps` (non-empty): `"text"` or `{text, detail?}` | — | |
| `table` | `columns`, `rows[][]` | — | every row must have exactly `columns.length` string cells |
| `diagram` | exactly one of `mermaid` **or** `nodes` + `edges` | `layout` (`flow`\|`tree`, default `flow`) | see below |
| `calculator` | — | `mode` (`split`\|`tip`, default `split`), `fields[{label, value, min?, max?}]` | |
| `unit` | `units` (≥ 2 strings) | `factors` (object of multipliers), `value`, `from`, `to` | |
| `note` | `text` | `tone` (default `info`) | |
| `playground` | — | `source` (JSON text of an app spec) | intentionally not deeply validated here — a broken schema must surface in the card, not fail the call |
| `app` | `tree` | `state`, `compute`, `stream`, `title`, `caption` | see §3–§9 |

`diagram` details:

- **Structured form** — `nodes[{id, label, detail?, tone?}]` (unique ids,
  non-empty) + `edges[{from, to, label?}]` (both ends must be declared ids).
  The Host compiles this to Mermaid `flowchart` source **before storing the
  spec** (`compileFlowchart`): `layout: "flow"` → `flowchart LR`,
  `layout: "tree"` → `flowchart TD`; labels are escaped (`&`, `"`, newline);
  each `tone` becomes a `classDef tone_<name>` + `class` assignment that
  resolves to theme tokens on the Client. The normalized spec carries
  `origin: "structured"` and the compiled `mermaid` string.
- **Raw form** — `mermaid`: complete Mermaid source (sequence, state, class,
  ER, mind map, Gantt, pie, …), `origin: "raw"`, capped at 12 000 chars.
- Mixing the two forms, or supplying neither, is an error: the two paths can
  never disagree about what was drawn.

---

## 2. Node shape (`kind: "app"` tree)

Every node in `spec.tree` is:

```jsonc
{
  "id": "people",                 // required: [A-Za-z][A-Za-z0-9_-]{0,63}, unique in the tree
  "type": "slider",               // required: a registry type or chart alias
  "props": { "label": "People" }, // literals; keys must be in the type's prop allow-list
  "bind":  { "value": "people" }, // prop → expression, re-evaluated on every state change
  "on":    { "change": { "action": "set", "path": "people" } },  // event → one action
  "children": [ … ]               // only container types (see the registry table)
}
```

Rules enforced by `normalizeNode`:

- `id` matches `[A-Za-z][A-Za-z0-9_-]{0,63}` and is unique across the whole tree.
- `type` must be registered (`TYPES` or `ALIASES`); anything else is rejected.
- `props` keys must be in the type's allow-list (its own props plus the common
  props `span`, `hidden`, `ariaLabel`) — an unknown key is an error that names
  the allowed set, so typos surface instead of being silently dropped.
- `bind` keys follow the same allow-list; every value must parse as an
  expression (§5).
- `on` keys must be events (`click`, `change`, `input`, `submit`, `confirm`,
  `cancel`); each value is one action (§7).
- `children` is rejected on leaf types; container types default to `[]`.
- `props.series` on `chart` (and its aliases) is the one prop whose **shape** is
  checked, not just its name: each point must be `{label: string|number, value:
  finite number}` with optional `tone`, `hint`, `x`, and empty series is
  rejected — the same data the fixed-card `chart` kind rejects in `index.js`.
  Every other prop keeps name-level validation over JSON-safe values; a
  malformed one degrades to that node's fallback at render time.
- Nesting is at most 8 levels deep (root included); a tree has at most 400
  nodes by default (`opts.maxNodes` overrides per call).
- Common props: `hidden: true` removes the node at render time; `span` (1–3,
  clamped) widens a child inside `grid`/`bento`; `ariaLabel` is available for
  any type.

Chart aliases normalize to `type: "chart"` plus a default `variant` (an
explicit `props.variant` wins):

| Alias | `variant` |
|---|---|
| `barChart` | `bar` |
| `lineChart` | `line` |
| `areaChart` | `area` |
| `pieChart` | `pie` |
| `donutChart` | `donut` |
| `scatterChart` | `scatter` |

The small built-in icon vocabulary (`iconButton.icon`, `button.icon`) is:
`check, close, plus, minus, copy, arrow-left, arrow-right, search, download,
play, pause, refresh, info, warning, calendar, pin`. An unknown name renders no
glyph (it is not a validation error).

---

## 3. Registry: every node type and its props

Generated from `TYPES` in [`engine.cjs`](../engine.cjs). "Children" = the type
is a container (`children: true`). Prop semantics are documented per component
in [components.md](components.md).

### Text

| type | props | children |
|---|---|---|
| `text` | `text`, `tone`, `size`, `align`, `bold`, `italic` | no |
| `title` | `text`, `level`, `align` | no |
| `caption` | `text` | no |
| `label` | `text` | no |
| `bold` | `text` | no |
| `italic` | `text` | no |
| `badge` | `text`, `tone` | no |
| `link` | `text`, `href`, `external` | no |
| `quote` | `text`, `cite` | no |
| `markdown` | `text` | no |
| `code` | `text`, `language`, `wrap` | no |
| `math` | `text`, `display` | no |
| `list` | `items`, `ordered` | no |
| `timeline` | `items` | no |
| `sources` | `items` | no |

### Layout

| type | props | children |
|---|---|---|
| `box` | `padding`, `gap`, `align`, `justify`, `wrap`, `tone` | yes |
| `row` | `gap`, `align`, `justify`, `wrap` | yes |
| `column` | `gap`, `align` | yes |
| `card` | `title`, `subtitle`, `footer`, `accent` | yes |
| `grid` | `columns`, `gap`, `minWidth` | yes |
| `bento` | `gap` | yes |
| `flow` | `gap` | yes |
| `divider` | `label` | no |
| `spacer` | `size` | no |
| `tabs` | `tabs`, `active` | yes |
| `tab` | `label` | yes |
| `accordion` | `multiple` | yes |
| `accordionItem` | `label`, `open` | yes |
| `popover` | `title`, `trigger` | yes |
| `tooltip` | `hint` | yes |
| `carousel` | `height` | yes |
| `responsive` | `gap` | yes |

### Controls

| type | props | children |
|---|---|---|
| `button` | `label`, `variant`, `tone`, `icon`, `disabled`, `fullWidth` | no |
| `iconButton` | `icon`, `label`, `tone`, `disabled` | no |
| `input` | `label`, `type`, `placeholder`, `value`, `required`, `min`, `max`, `step`, `name`, `help` | no |
| `textarea` | `label`, `rows`, `placeholder`, `value`, `required`, `name`, `help` | no |
| `select` | `label`, `options`, `value`, `placeholder`, `name`, `help` | no |
| `combobox` | `label`, `options`, `value`, `placeholder`, `name`, `help` | no |
| `checkbox` | `label`, `checked`, `name`, `help` | no |
| `radio` | `label`, `options`, `value`, `name`, `help` | no |
| `switch` | `label`, `checked`, `name` | no |
| `slider` | `label`, `min`, `max`, `step`, `value`, `unit` | no |
| `datePicker` | `label`, `value`, `min`, `max`, `name` | no |
| `timePicker` | `label`, `value`, `name` | no |
| `segmented` | `label`, `options`, `value` | no |
| `form` | `title`, `submitLabel` | yes |
| `fileUpload` | `label`, `accept`, `multiple` | no |
| `dialog` | `title`, `open`, `confirmLabel`, `cancelLabel` | yes |
| `confirmDialog` | `title`, `message`, `open`, `confirmLabel`, `cancelLabel`, `tone` | no |

### Data visualization

| type | props | children |
|---|---|---|
| `kpi` | `label`, `value`, `unit`, `delta`, `tone`, `hint` | no |
| `progress` | `value`, `max`, `label`, `unit`, `tone`, `variant` | no |
| `chart` | `series`, `variant`, `unit`, `height`, `label` | no |
| `dataTable` | `columns`, `rows`, `pageSize`, `search`, `filterKey`, `selectable`, `exportable`, `caption`, `emptyText` | no |

### Media & map

| type | props | children |
|---|---|---|
| `image` | `src`, `alt`, `caption`, `width`, `fit` | no |
| `gallery` | `images`, `columns`, `height` | yes |
| `lightbox` | `src`, `alt`, `caption`, `width` | no |
| `video` | `src`, `poster`, `caption` | no |
| `svg` | `shapes`, `viewBox`, `caption` | no |
| `diagram` | `mermaid`, `layout`, `height` | no |
| `map` | `places`, `selected`, `height`, `caption` | no |
| `places` | `places`, `selected`, `label` | no |

### System feedback

| type | props | children |
|---|---|---|
| `toast` | `items` | no |
| `loading` | `label` | no |
| `skeleton` | `lines`, `height` | no |
| `errorState` | `message`, `hint`, `retryLabel` | no |
| `emptyState` | `message`, `hint` | no |
| `checklist` | `items`, `label` | no |
| `stepper` | `steps`, `current` | no |

### Instant micro-apps

| type | props | children |
|---|---|---|
| `quiz` | `title`, `questions` | no |
| `flashcard` | `title`, `cards` | no |
| `countdown` | `label`, `target`, `seconds` | no |

All types additionally accept the common props `span`, `hidden`, `ariaLabel`.

Note on allow-lists: each type's allow-list matches what its renderer actually
consumes (e.g. `text` carries `bold`/`italic`), and props outside the
allow-list are rejected at validation — a typo surfaces as a corrective error
instead of being silently dropped. Value *shapes* are checked only for
`chart.series` (above); elsewhere a wrong shape degrades that node at render
time, boxed by its error boundary.

---

## 4. `spec.state`

Plain JSON data: objects, arrays, strings, booleans, finite numbers, `null`.
Anything else (a `Date`, `Map`, class instance, function, `NaN`/`Infinity`) is
rejected with `must be JSON data`. Keys named `__proto__`, `constructor` or
`prototype` are rejected anywhere in the data. Serialized size ≤ 49 152 bytes;
JSON nesting inside one value ≤ 12 levels; any single string ≤ 12 000 chars.

State is the only mutable data. Actions write it (§7); `bind` expressions read
it (§5); `compute` derives from it (§6).

---

## 5. The safe expression language

Used by `compute` values and every `bind` entry. It is a hand-written tokenizer
+ recursive-descent parser (`tokenize` / `parseExpression`) producing a plain
AST that `evaluateExpression` walks. **There is no `eval`, no `new Function`,
no user-defined functions, no assignment and no method calls** — model-authored
JSON can never execute JavaScript.

### Grammar

```bnf
expression := ternary
ternary    := or [ '?' ternary ':' ternary ]
or         := and { ('||' | 'or') and }        # see word-operator note
and        := cmp { ('&&' | 'and') cmp }
cmp        := add { ('==' | '!=' | '<' | '<=' | '>' | '>=') add }
add        := mul { ('+' | '-') mul }
mul        := unary { ('*' | '/' | '%') unary }
unary      := ('-' | '!') unary | primary
primary    := number | string | 'true' | 'false' | 'null'
            | funcName '(' [ expression { ',' expression } ] ')'
            | path | '(' expression ')' | array | object
array      := '[' [ expression { ',' expression } ] ']'
object     := '{' [ key ':' expression { ',' key ':' expression } ] '}'
path       := ident { '.' ident | '[' expression ']' }
```

- **Numbers**: `42`, `3.14`, `1e-3`. **Strings**: `'single'` or `"double"`,
  escapes `\n`, `\t`, `\<char>`. **Operators** are symbolic: `+ - * / %`,
  `== != < <= > >=`, `&& || !`, `? :`, `()`/`[]`/`{}`, `,` `.`.
- **Word-operator note:** `and`, `or`, `not` are reserved words and are
  *rejected* (the parser only accepts `&&`, `||`, `!`). The words exist in the
  reserved list to keep paths from shadowing them; using them as operators is a
  parse error (`reserved word "not"` / `unexpected trailing input`).
- `==` / `!=` are strict (`===`/`!==` semantics). `+` concatenates when either
  side is a string (`null`/`undefined` become `''`), otherwise numeric.
  `- * / %` coerce with `Number()`. Unary `-` coerces, `!` negates truthiness.
- **Ternary is lazy; the `if()` function is not** — call arguments are all
  evaluated before the call, so use `cond ? a : b` when a branch would error on
  a missing value.
- **Paths** read from the scope (`state` keys, then `compute` keys). Missing
  paths read as `undefined`; only own properties are reachable (a
  `flags.toString` read is `undefined`, not the prototype method). Segments
  named `__proto__`, `constructor`, `prototype` are rejected at parse time and
  at evaluation time.
- Limits: 2 000 chars per expression, 32 levels of operator/call nesting.
- Parse errors name the character position, so the model gets a corrective
  message (`expected ")" at 12, got end of expression`).

### Function table (`FUNCS` — everything else is `unknown function`)

| Function | Behaviour |
|---|---|
| `round(x, n = 0)` | round half **away from zero** (`0.5 → 1`, `-0.5 → -1`), `n` clamped 0–10 |
| `floor(x)`, `ceil(x)`, `abs(x)` | numeric, via `Number(x)` |
| `min(...xs)`, `max(...xs)` | numeric min/max over the arguments |
| `clamp(x, lo, hi)` | `min(max(x, lo), hi)` |
| `sum(xs)` | sum of an array (`Number` per item); a scalar becomes `Number(xs)` |
| `avg(xs)` | mean of a non-empty array, else `0` |
| `pluck(xs, key)` | `xs.map(item => item[key])`; non-arrays → `[]` |
| `len(x)` | string/array length; object key count; anything else `0` |
| `if(c, a, b)` | `c ? a : b` — **both branches evaluated first** (see above) |
| `coalesce(...xs)` | first non-`null`/`undefined` argument, else `null` |
| `fmt(x, n = 0)` | locale-stable `en-US` formatting with `n` fraction digits |
| `pct(x, n = 0)` | `fmt(x * 100, n)` + `%` |
| `number(x)` | `Number(x)`; `''`/`null`/`undefined` → `0` |
| `lower(x)`, `upper(x)` | string case |
| `join(xs, sep = ', ')` | array join; non-arrays become `String(xs ?? '')` |

### Examples

```text
budget / people + 2 * 3        # 2006 given budget 8000, people 4
(budget / people + 2) * 3      # parentheses override precedence
-total + 6                     # unary minus
"total " + budget              # string concat → "total 8000"
trip.city                      # nested path → "Kyoto"
items[1].price                 # index path → 30
people > 2 && trip.days < 7    # boolean logic → true
flags.vip ? "VIP" : "std"      # lazy ternary
[people, budget]               # array literal
{per: budget / people}         # object literal
round(budget / 7, 2)           # 1142.86
sum(pluck(items, "price"))     # 42
pct(rate, 1)                   # "18.0%" given rate 0.18
coalesce(missing, trip.city)   # "Kyoto"
trip.missing.deep              # undefined, not an error
```

---

## 6. `spec.compute`

```jsonc
"compute": { "per": "budget / people", "total": "budget * 1.1" }
```

- Keys are plain identifiers (`[A-Za-z_$][A-Za-z0-9_$]*`), not reserved words
  or function names, and must not shadow a `state` key.
- Values are expression sources (validated at acceptance).
- Keys may reference each other regardless of declaration order; the engine
  derives dependency order from expression roots and rejects cycles
  (`spec.compute has a cycle through "x"`).
- At runtime `computeAll(compute, state)` evaluates every key into one flat
  scope `{...state, ...computed}` that `bind` expressions read. Computed values
  are recomputed on every state change.

---

## 7. Actions

One action per event handler (`on.<event>`). Action verbs: `set`, `toggle`,
`copy`, `open`, `submit`, `call`.

| action | Fields | Validation | Plan (`planAction`) → Client effect |
|---|---|---|---|
| `set` | `path` (state path); exactly one of `value` (JSON data) or `expr` (expression); **neither** means `{"$event": true}` | path parses; not both value and expr | `{kind:'set', path, value}` — value is the expression result, the literal, or the **event value**; Client writes it with `setPath` (immutable copy) |
| `toggle` | `path` | path parses | `{kind:'toggle', path, value}` — `value` is the negation of the current boolean at `path`; Client writes it |
| `copy` | exactly one of `text` (string) or `expr` | not both, not neither | `{kind:'copy', text}` — text as-is, otherwise `JSON.stringify` of the value; Client uses `navigator.clipboard.writeText` and toasts success/failure |
| `open` | `url` | must start `http://` or `https://` (re-checked at plan time) | `{kind:'open', url}` or `{kind:'error'}`; Client `window.open(url, '_blank', 'noopener,noreferrer')`, toasts the URL or "browser blocked" |
| `submit` | `form?` (name) | optional string | `{kind:'submit', form}`; Client toasts "submitted" (success is reported by execution, not by the click) |
| `call` | `service` (`[A-Za-z][A-Za-z0-9_.-]{0,63}`), `payload?` (JSON data, default `{}`) | name shape; payload JSON | service found in the runtime registry → `{kind:'call', service, payload, run}` and the Client awaits `run(payload)`; **not found → `{kind:'error', message: 'service "x" is not connected', notConnected: true}`** — an explicit failure, never a fake success |

Permission checks in `planAction` (pure, unit-tested in
`test/engine.mjs`): URL protocol, state-path shape (including the forbidden
prototype segments), service-registry lookup. Any throw becomes
`{kind: 'error', message}`. The Client executes only approved plans and reports
success only once the effect really happened (a blocked popup, a denied
clipboard write or a rejected service call all surface as an error toast).

### Event values

Components pass their own value to the action (`input`/`change` → the field
value, `submit` → `{name: value}` map, quiz → `{score, total, index}`, … — see
[components.md](components.md)). A `set` action without `value`/`expr` writes
that event value to `path`, which is the shortest two-way binding:

```jsonc
{ "id": "s", "type": "slider", "props": {"label": "People", "min": 1, "max": 8},
  "bind": { "value": "people" },
  "on": { "change": { "action": "set", "path": "people" } } }
```

---

## 8. State path rules

Accepted by `parseStatePath`:

```text
name | name.field | name[0].field | name.field[2].deep
regex: ^[A-Za-z_$][A-Za-z0-9_$]*(?:(?:\.[A-Za-z_$][A-Za-z0-9_$]*)|(?:\[\d+\]))*$
```

- Index segments are numeric literals only (`items[0]`), no dynamic indexes in
  a path string — dynamic access lives in the expression language instead.
- Segments `__proto__`, `constructor`, `prototype` are rejected.
- `getPath(root, segments)` reads; missing links read as `undefined`; own
  properties only.
- `setPath(root, segments, value)` writes into a **copy** (shallow clones along
  the path only), so React state updates stay immutable and siblings survive.

---

## 9. Streaming protocol

`spec.stream` opts a card into progressive rendering:

```jsonc
"stream": { "mode": "mock", "intervalMs": 200 }   // mode: "mock" | "off"; intervalMs 16–2000
```

No `stream` block → the finished tree renders at once.

### Event shapes (`STREAM_EVENTS`)

| `type` | Fields | Effect (`applyStreamEvent`) |
|---|---|---|
| `node.add` | `seq`, `session?`, `nodeId`, `node`, `parentId?`, `index?` | inserts `node` under `parentId` at `index` (clamped 0…length, default append). Without `parentId` it **becomes the root**. `node` on the wire carries no `children`; children arrive as their own events. |
| `node.patch` | `seq`, `session?`, `nodeId`, `props?`, `bind?`, `on?` | shallow-merges each provided map onto the named node (any depth) |
| `node.remove` | `seq`, `session?`, `nodeId` | removes the node; removing the root yields an empty tree |
| `stream.done` | `seq`, `session?` | terminal: status `done`, pending events cleared |
| `stream.error` | `seq`, `session?`, `message?` | status `error` with `message` (default `stream failed`); the player **parks**, keeping buffered events |

### Sequence, session, dedupe (`StreamPlayer`)

- `seq` must be an integer ≥ 1 and strictly increasing in *application* order.
  Events may arrive out of order and duplicated: a gap is held in a `pending`
  map until the missing sequence numbers arrive (`nextSeq` tracks the gap),
  then applied contiguously. Anything with `seq` ≤ the last applied, or already
  pending, is dropped (`dropped` counter) — a replayed duplicate is never
  applied twice.
- `session` must equal the player's session when present; foreign-session
  events and unknown `type`s are dropped, not applied.
- Every change emits `onUpdate({tree, status, lastSeq, errorMessage})`.
- On `stream.error`, or when applying an event throws, the player parks with
  `status: 'error'` and stops applying — but keeps buffering. `retry()`
  resumes from the next expected sequence, so a reconnect replays exactly the
  lost tail (verified in `test/engine.mjs`).

### Mock Streaming (`mockStreamEvents`)

Deterministic replay of a finished tree: pre-order `node.add` per node
(children stripped on the wire) followed by `stream.done`. Same tree in → same
event list out. This is what `stream: {"mode": "mock"}` plays — at
`intervalMs` per event (default 90 ms in the AppSurface) — so the page shows
progressive growth exactly as a real LLM stream would arrive. The real source
is a drop-in replacement emitting the same event shape over SSE; the reserved
integration point is `createSseSource` in `client.js` (§11).

---

## 10. Validation rules and what the errors mean

Budgets (`LIMITS` in `engine.cjs`):

| Limit | Value | Meaning |
|---|---|---|
| `maxDepth` | 8 | node-tree nesting, root included |
| `maxNodes` | 400 | nodes per tree (per-call `maxNodes` override exists; the tool also budgets fixed-card payload entries) |
| `maxExprChars` | 2000 | one expression source |
| `maxExprDepth` | 32 | operator/call nesting inside one expression |
| `maxStateBytes` | 49152 | serialized `state` |
| `maxStringChars` | 12000 | any single string value in JSON data |
| `maxSpecChars` | 200000 | total JSON of one normalized spec |
| raw `mermaid` (`index.js`) | 12000 | diagram source length |

Representative error messages (all thrown to the model as tool errors):

| Message pattern | Meaning |
|---|---|
| `spec.tree is required` | `kind: "app"` without a root node |
| `spec must be an object` / `spec.kind must be one of …` | envelope or kind wrong |
| `<path> must be JSON data, got Date` (etc.) | non-plain-object / function / non-finite number reached the spec |
| `<path> is N chars, over the 12000-char limit` | one string too long |
| `spec.state is N bytes, over the 49152-byte limit` | state too large |
| `the spec is N chars, over the 200000-char limit` | whole spec too large |
| `<path>.id must match [A-Za-z][A-Za-z0-9_-]{0,63}, got …` | bad node id |
| `<path>.id "x" is used twice; ids must be unique` | duplicate id |
| `<path>.type "x" is not a known component; see the registry in docs/schema.md` | unknown type |
| `<path>.props.k is not a prop of "t"; allowed: …` | unknown prop/bind key — the message lists the allow-list |
| `<path>.type "t" does not take children` | children on a leaf |
| `the tree has more than N nodes; split it or trim the data` | node budget |
| `<path> nests deeper than 8 levels` | depth budget (JSON data nests deeper than 12) |
| `<path>.on.x is not an event; allowed: click, change, input, submit, confirm, cancel` | unknown event |
| `<path>.action must be one of set, toggle, copy, open, submit, call` | unknown action verb |
| `<path> takes either "value" or "expr", not both` | `set` with both |
| `<path> needs exactly one of "text" or "expr"` | `copy` with zero or both |
| `<path>.url must start with http:// or https://` | non-http(s) `open` |
| `<path>.service must be a simple service name` | bad `call` service name |
| `spec.compute key "x" must be a plain name…` / `shadows a state key` / `has a cycle through "x"` | compute-block problems |
| `state path must look like "name" or "name.field[0]", got …` | bad action path |
| `expression must not be empty` / `is N chars, over the 2000-char limit` / `nests deeper than 32 levels` | expression size |
| `unterminated string at N` / `unexpected trailing input at N` / `unexpected … at N` / `expected ")" at N, got …` | syntax errors with position |
| `unknown function f() at N; the language has no user-defined functions` | not in the function table |
| `"not" is a reserved word at N` | `and`/`or`/`not` word forms (use `&&`/`\|\|`/`!`) |
| `"__proto__" is not allowed in a path at N` | prototype-pollution attempt |
| `spec.stream.mode must be "mock" or "off"` / `intervalMs must be between 16 and 2000` | stream options |

---

## 11. What is real vs. reserved in the protocol

| Mechanism | Status |
|---|---|
| state + compute + bind re-render loop | real |
| actions `set`, `toggle`, `copy`, `open`, `submit` | real |
| action `call` | real plumbing, but **no service ships configured** — an unregistered name reports `not connected` (see `useAppRuntime` in `client.js`) |
| streaming event mechanics (seq, dedupe, out-of-order repair, error + retry) | real, exercised by `test/engine.mjs` |
| Mock Streaming source (`mockStreamEvents`) | real, deterministic |
| Real LLM SSE source (`createSseSource`) | **reserved** — `connect()` rejects with "SSE source is not connected: configure a backend endpoint…" |
