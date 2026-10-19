# Component API

Behaviour of every registered node type, derived from the Client registry
(`REGISTRY` in [`client.js`](../client.js)). Prop *names* come from the engine
registry (`TYPES` in [`engine.cjs`](../engine.cjs)); what they mean and what the
component does with them is documented here. Prop shapes, the expression
language and actions are in [schema.md](schema.md).

Conventions used below:

- **Events** — the values in `on` a component actually fires; each fires with
  the payload shown. Anything not listed fires nothing (its `on` map is legal
  but inert).
- **Binding** — `bind: {"prop": "expr"}` overrides the literal `props` value on
  every state change. Controls that keep a *local echo* (their own typing
  state) become fully state-driven as soon as `bind.value` exists.
- **Failure isolation** — each node renders inside `NodeBoundary`: a component
  crash degrades to a `role="alert"` box naming the node id, never blanking the
  card. An unknown `type` or a broken binding renders the same style of inline
  alert; a `hidden: true` node renders nothing.
- **Accessibility** — focus-visible outlines on all interactive elements;
  icon-only controls carry `aria-label`s; error boxes are `role="alert"`.

---

## Text

### `text`

Free paragraph. `text` (string), `tone` (semantic color), `size`
(`"lg"` 15px / `"sm"` 11.5px / default 13px), `align` (CSS text-align),
`bold` and `italic` (booleans).
No events.

### `title`

Heading: `level` 1–3 (clamped, default 2) maps to `h3`–`h5`, sized
17/15/13.5px; `text`, `align`. No events.

### `caption`

Muted footnote text (`text`). No events.

### `label`

Tiny helper text (`text`), styled like field help. No events.

### `bold` / `italic`

Inline `<b>` / `<i>` around `text`. No events.

### `badge`

Pill chip: `text`, `tone` (border+text color, brand when absent). No events.

### `link`

Anchor: `text` (defaults to `href`), `href`, `external` (→ `target="_blank"`,
`rel="noopener noreferrer"`). `href` is only linked when it starts
`http(s)://`; anything else renders as plain text — the same URL policy as the
`open` action. **Fires** `click` (value = `props.href`) when `on.click` exists.

### `quote`

`<blockquote>` with `text` and optional `cite` (`— …`). No events.

### `markdown`

Safe markdown subset rendered as React elements — the source is **never**
turned into HTML. Blocks: `#`/`##`/`###` headings, `-`/`*`/`1.` lists, `>`
quotes, ` ``` ` fenced code (with language label), paragraphs. Inline:
`**bold**`, `*italic*`, `` `code` ``, `[text](https://…)` links (open in a new
tab with `noopener noreferrer`). Anything else degrades to literal text. No
events.

### `code`

Monospace block: `text`, `language` (label above), `wrap` (`true` → `pre-wrap`).
Includes its own **Copy** button (Clipboard API, success/failure toast) that is
independent of `on`. No `on` events fired.

### `math`

Formula display from a small subset: `x^2`, `x_i` (also `^{…}`/`_{…}`),
`\frac{a}{b}`, `\sqrt{x}`. `display: true` centers and enlarges.
`role="math"` with the raw source as `aria-label`. Anything outside the subset
degrades to plain text. **KaTeX was deliberately not used**: its renderer needs
20+ woff2 font files and the plugin route only serves `client.*.js` chunks, so
the fonts cannot ship and formulas would fall back to wrong glyphs. No events.

### `list`

`items` as strings or `{text, detail?}`; `ordered: true` → `<ol>`, else `<ul>`.
No events.

### `timeline`

`items` as strings or `{time?, title?, text?}`; dot + content rows in an `<ol>`.
No events.

### `sources`

Citation list: `items` as strings or `{title, href?, detail?}`; `href` is
linked only for `http(s)://`. No events.

---

## Layout

All containers render `children` in order.

### `box`

Padded flex container: `padding`, `gap` (default 10), `align` (align-items),
`justify`, `wrap: false` → nowrap, `tone` → 3px left border in the tone color.

### `row` / `column` / `flow`

`row`: flex row, wraps by default (`wrap: false` disables), `gap`, `align`,
`justify`. `column`: flex column, `gap`, `align`. `flow`: wrapping flex row of
chips/cards, `gap`. None fire events.

### `card`

Bordered inner card: `title`, `subtitle`, `footer`, `accent: true` → brand left
border.

### `grid`

CSS grid: `columns` (1–6, clamped) for a fixed track count, else auto-fit with
`minWidth` (default 180px); `gap`. Children may use the common `span` prop
(1–3) to widen inside `grid`/`bento`.

### `bento`

Auto-fit tile grid (180px min tiles), `gap`; works with `span`.

### `divider` / `spacer`

`divider`: `label` → labelled rule, else `role="separator"` rule. `spacer`:
`size` px (default 12), `aria-hidden`.

### `tabs` + `tab`

`tabs` holds `tab` children; each `tab`'s `label` prop (literal or bound)
becomes its tab button. `active` selects the initial tab (default 0).
Accessibility: `role="tablist"` with `role="tab"` buttons (roving
`tabIndex`, `aria-selected`, `aria-controls`) and a `role="tabpanel"`
(`aria-labelledby`, focusable). **Keyboard:** ArrowLeft/ArrowRight cycle tabs.

### `accordion` + `accordionItem`

Collapsible sections; `accordion.multiple: true` keeps several open, otherwise
opening one closes the rest. Each `accordionItem` supplies `label` and
`open` (initially open; the first item is open by default). Head buttons carry
`aria-expanded`; the ± glyph is `aria-hidden`. No `on` events — the open state
is view-local.

### `popover`

Trigger button (`trigger` text, else `title`, else localized "Apply") toggles a
panel (`role="dialog"`, `aria-label` = title) with children inside. `aria-expanded`
on the trigger; Escape closes. No `on` events.

### `tooltip`

Wraps children; shows `hint` in a `role="tooltip"` bubble on hover **and**
focus. No events.

### `carousel`

Shows one child at a time: `height` (default 220). Prev/next icon buttons and
dot buttons (`aria-current`) when more than one child. `role="group"` +
`aria-roledescription="carousel"`. Empty → localized empty text. No `on`
events.

### `responsive`

Auto-fit grid with `min(260px, 100%)` min track, `gap` — the "one column on
narrow, more on wide" layout.

---

## Controls

Shared behaviour:

- **Form registration** — every field registers with an enclosing `form`
  (`name` = `props.name` ?? `props.label` ?? node id; `required` flag), so
  `submit` can validate and collect them.
- **Echo vs bound** — without `bind.value` a field keeps its own echo state;
  with `bind.value` it is controlled by state (the `set` action writes back).
- **Options** — `options` arrays accept plain strings or `{label, value}`.

### `button`

`label`, `variant` (`"primary"` filled / `"ghost"` transparent / default
outlined), `icon` (from the icon vocabulary), `disabled`, `fullWidth`.
**Fires** `click` (no value). `tone` is accepted by the registry but the
renderer does not use it (variant carries the emphasis).

### `iconButton`

Glyph-only button: `icon` (vocabulary name), `label` → `aria-label`, `disabled`.
**Fires** `click`.

### `input`

Labelled `<input>`: `type` (default `text`; `number` makes values numeric),
`placeholder`, `value`, `required` (marks `*`, joins form validation),
`min`/`max`/`step`, `name`, `help`. **Fires** `input` (every keystroke) and
`change` (commit) with the value.

### `textarea`

`rows` (default 4), `placeholder`, `value`, `required`, `name`, `help`.
**Fires** `input` and `change` with the string on commit.

### `select` / `combobox`

`select`: native `<select>` with `options`, `placeholder` (empty first
option), `value` (defaults to the first option), `label`, `name`, `help`.
`combobox`: text input + `<datalist>` of `options` (free text allowed).
Both **fire** `change` with the value string.

### `checkbox` / `radio` / `switch` / `segmented`

- `checkbox`: `label`, `checked`, `name`, `help`. **Fires** `change` (boolean).
- `radio`: `options`, `value`, `label` as `<fieldset><legend>`. **Fires**
  `change` with the chosen option value.
- `switch`: `role="switch"` button with `aria-checked`; `label`, `checked`.
  **Fires** `change` (boolean).
- `segmented`: `role="group"` of `aria-pressed` toggle buttons; `label`,
  `options`, `value`. **Fires** `change` with the option value.

### `slider`

Range input: `min` (0), `max` (100), `step` (default `(max-min)/100`),
`value`, `label`, `unit` (suffix shown next to the label). **Fires** `change`
with the numeric value.

### `datePicker` / `timePicker`

Native `type="date"` / `type="time"` inputs; `value`, `label`, `name`;
`datePicker` also `min`/`max`. **Fire** `change` with the date/time string.

### `form`

`title`, `submitLabel`. Collects registered fields; on submit it validates
`required` fields (empty/`undefined`/`null`/`false` count as missing) and
toasts `Missing required fields: …` listing them when any fail. Otherwise it
**fires** `submit` with `{name: value}` for all fields; with no `on.submit` it
just toasts "Submitted". Success is reported by the action's execution, not by
reaching the handler.

### `fileUpload`

`accept`, `multiple`, `label` (default "Choose files"). **Fires** `change` with
`[{name, size}]` metadata. **Deliberate simplification:** no upload backend
exists, so only the file *names and sizes* leave the picker — the user is never
told anything was transferred.

### `dialog` / `confirmDialog`

Native `<dialog>` + `showModal()` (real modal semantics, Escape/backdrop via
`onCancel`). `open` is self-managed, or state-driven when `bind.open` exists.
Both render cancel + confirm buttons (`cancelLabel` / `confirmLabel`).
`dialog` holds arbitrary `children` and `title`; `confirmDialog` is fixed to
`title` + `message`, and `tone: "error"` paints the confirm button red.
**Fire** `confirm` and `cancel` (no value).

---

## Data visualization

### `kpi`

Headline figure: `value` (formatted), `unit`, `label`, `hint`, `tone` (left
border), `delta` — rendered `▲`/`▼` with the absolute value, green for
`delta ≥ 0`, red otherwise. No events.

### `progress`

`value`, `max` (default 100), `label`, `unit`, `tone`.
`variant: "bar"` → horizontal bar with `role="progressbar"`
(`aria-valuenow`/`min`/`max`, `aria-label`). Default → the inline-SVG ring
shared with the fixed `progress` card, `role="img"` with a full spoken label.
Clamped 0–100%.

### `chart`

ECharts-backed chart: `series` `[{label, value, tone?, hint?, x?}]` (`x` only
for `scatter`), `variant` (`bar` default, `line`, `area`, `pie`, `donut`,
`scatter` — or use the `barChart`/`lineChart`/… aliases), `unit`, `label`
(title above), `height` (default 220). Colors: `tone` per point, else the
brand color at decreasing opacity steps (never literal colors). Lazy chunk;
if `client.echarts.js` cannot load, a plain bar summary (`PlainBars`) renders
instead — a chart never becomes an empty box. While loading, a "Rendering
chart…" note shows.

### `dataTable`

A working table — all controls are **view-local**; the schema hands over the
rows and nothing is written back (it fires **no** events):

| Prop | Meaning |
|---|---|
| `columns` | strings or `{key, label, align, sortable?}` (`sortable: false` disables sorting for that column) |
| `rows` | arrays of cells, or objects keyed by `column.key` |
| `pageSize` | rows per page, default 10 |
| `search: true` | search box; case-insensitive substring across all cells |
| `filterKey` | column key for an exact-match filter `<select>` built from its distinct values |
| `selectable: true` | checkbox column + selected count |
| `exportable: true` | **Export CSV** button (UTF-8 BOM, RFC-style quote escaping, downloads `table.csv`, toast) |
| `caption` | footnote |
| `emptyText` | shown when the filtered view is empty (default "No matches") |

Sorting: click a column header (button with `aria-label "Sort: <label>"`,
arrow shows direction); numeric when both cells parse as numbers, else
`localeCompare`. Pagination footer appears past one page. Empty → `emptyText`.
Overflow: wide tables scroll sideways; more than 15 rows scroll inside the
card with a pinned header (a `role="region"` + `tabIndex=0` scroll container,
so keyboard users can reach it).

The filter's first option is the localized "All" / "全部" (`all` in the plugin
dictionaries `DICTS`).

---

## Media & map

### `image`

`src`, `alt`, `caption`, `width` (default 100%), `fit` (object-fit, default
`cover`); lazy loading. Load failure or empty `src` → dashed fallback box
("Image failed to load", with the URL shown). No events.

### `gallery` + `lightbox`

`gallery`: `images` `[{src, alt, caption}]`, `columns` (1–4, default 3),
`height` (thumb height, default 120). Clicking a thumb opens the fullscreen
viewer (`role="dialog"`, `aria-modal`). **Keyboard in the viewer:**
Escape closes, ArrowLeft/ArrowRight move between images (wrapping); prev/next
and close buttons are labelled. `lightbox` is the single-image spelling
(`src`, `alt`, `caption`, `width`): zoom button → the same viewer.

### `video`

Native `<video controls preload="metadata">`: `src`, `poster`, `caption`.
Empty `src` → empty placeholder.

### `svg`

A schematic figure from a safe shape vocabulary — the model names shapes and
whitelisted attributes, the Client builds real SVG elements; **raw markup is
never injected**. Shapes: `rect`, `circle`, `ellipse`, `line`, `path`, `text`,
`arrow` (a line with an arrowhead marker); each shape copies only its
whitelisted attributes (e.g. `rect`: `x, y, width, height, rx, fill, stroke,
strokeWidth, opacity`). `viewBox` (default `0 0 400 200`), `caption`
(`role="img"` `aria-label`). No events.

### `diagram`

Renders raw `mermaid` source through the Mermaid chunk (`layout`/`height` are
accepted for the structured card family and mostly inert here). Empty source →
empty state; invalid source or missing chunk → "Chart library unavailable"
message plus the parser error in monospace. Mermaid runs with
`securityLevel: 'strict'`, so model-authored labels are sanitized. No events.

### `map` + `places`

A schematic map: the declared `places` (`[{id, name, lat, lng, label?}]`) are
projected equirectangularly onto an SVG plane (real math — points sit where
their coordinates say), with markers and a selected-place popup
(`role="status"`, name + coordinates). `height` (default 260, min 160),
`caption` (`role="img"` `aria-label`), `selected` (place id).

- **Linked selection** — give `map` and `places` the *same* `selected` binding
  and the same `on.change` `set` action; clicking either moves both.
- Markers are `role="button"`, `tabIndex=0`, Enter/Space fires; `places` rows
  are buttons with `aria-current` on the selected one.
- Both **fire** `change` with the place id.

> **Why not MapLibre/Leaflet?** Both need raster tiles from a network service
> (no offline map) and a much larger payload inside a chat card. This
> projection is self-contained and honest about being a schematic; a tile-based
> map can replace it later behind the same node type (comment in `client.js`).

---

## System feedback

### `toast`

Declarative toast list: `items` `[{text, tone?}]` in a sticky stack,
`role="status"` `aria-live="polite"`. (Action feedback uses the runtime's own
transient toast stack, not this node.)

### `loading` / `skeleton`

`loading`: spinner + `label` (default "Loading…"), `role="status"`
`aria-live="polite"`. `skeleton`: `lines` (1–12, default 3) shimmer bars of
`height`, `role="status"` `aria-label="loading"`.

### `errorState` / `emptyState`

`errorState`: `role="alert"` box with `message` (default localized) and
`hint`; a retry button (`retryLabel`) appears **only** when `on.click` exists
and **fires** `click`. `emptyState`: centered `message` (default "Nothing here
yet") + `hint`.

### `checklist`

`items` `[{text, done?}]`, `label`. Checkboxes toggle local done state
(struck-through when done). **Fires** `change` with `{index, done}`.

### `stepper`

`steps` `[{label|text, detail?}]`, `current` (bound via `bind.current`, else
local). Prev/next buttons; step counter. **Fires** `change` with the clamped
new index on every move.

---

## Instant micro-apps

### `quiz`

`title`, `questions` `[{question, options[], answer, explanation?}]`.
One question at a time
(question counter, prev/next); picking an option locks the question and colors
the right/wrong choices (`data-state`), then shows `explanation`. Running
score row (Score `n / total`). Empty question list → empty state.

- On answer: **fires** `change` with `{score, total, index}` — the natural
  input for a `set`/`expr` action that flips a "passed" flag in state.
- Reset button: **fires** `click` with `{reset: true}` (and clears local picks).

### `flashcard`

`title`, `cards` `[{front|question, back|answer}]`. The card is a
`role="button"` (`tabIndex=0`, `aria-label` "Flip"); click, Enter or Space
flips it. Prev/next (wrapping) + flip button + position counter. **Fires**
`click` with `{index, flipped}` on each flip.

### `countdown`

`label`, `target` (ISO date/time string) or `seconds`. Shows d/h/m/s cells in
`role="timer"` (`aria-live="off"` — it must not narrate every tick).

- Pause/start button **fires** `click` with `{running}` (the new value).
- Reset button **fires** `click` with `{reset: true}`.
- On reaching zero it **fires** `change` with `0` once and shows "Time is up"
  (`role="status"`).

---

## Cross-cutting behaviour

| Situation | What the user sees |
|---|---|
| Unknown `type` | `role="alert"` box "Unknown component: <type>" |
| Broken `bind` expression (runtime) | the prop renders as empty + inline `role="alert"` "Binding error · <prop>: …" |
| Component render crash | `NodeBoundary` box: "This component failed to render · <id>: …" |
| Engine chunk (`client.engine.js`) fails to load | `role="alert"` box with the load error |
| Chart chunk fails to load | plain bar fallback (fixed `chart`/`chart` node) |
| Mermaid chunk fails / bad source | "Chart library unavailable" + monospace error |
| Empty lists (`gallery`, `quiz`, `carousel`, …) | localized empty text ("Nothing here yet") |
| Long table | sideways scroll; > 15 rows scroll inside with pinned header |
