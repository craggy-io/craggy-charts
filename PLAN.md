# craggy-charts — v1 plan

Charts drawn in the Craggy tile grid: the rounded squares from the logo and the website's terrain animation,
used as pixels for lines, bars, slices and cells. One flat options object to configure them,
beautiful by default, smooth when data changes, and the same API in JavaScript and Flutter.

A working prototype of the look, the API and the animation model is in [`prototype/`](prototype/index.html)
(14 charts, live streaming, tooltips, legend toggles, type morphing, tile-size switching). Run it with the
`charts` entry in `C:\Code\Craggy\.claude\launch.json`, or `python -m http.server -d prototype`.

---

## 1. The idea in one paragraph

The plot area is a grid of tiles. A tile's size is configurable (`cell`: 2px for dense sparklines, 3px for
"fine", 6px "normal", 12px+ "chunky"). Every chart type does the same thing: it **rasterises its geometry into
the grid as coverage** (how much of each tile the shape covers, 0–1) and a colour. Coverage drives the tile's
*size*, so the edge of a bar top, a curve or a slice is drawn with partly-shrunk tiles. That is anti-aliasing
done with tiles, and it is why a chunky chart still reads as smooth. Every tile is a spring, so when the target
field changes (new data, a toggled series, a resize, a different chart type) the tiles grow, shrink and recolour
smoothly. This is the same physics as the website's scroll strip.

## 2. What existing libraries taught us

| Library | What it gets right | What we avoid |
|---|---|---|
| **Chart.js** | One constructor, sensible defaults, everything animates | `data.datasets[]` + a deep `options` tree. You have to remember where every key lives. |
| **ECharts** | Huge catalogue; `setOption` merges and animates | Option tree with cross-references (`xAxisIndex`, `gridIndex`); very hard to hold in your head |
| **Highcharts** | Polished defaults, accessibility module | Same deep tree; commercial licence |
| **Vega-Lite / Observable Plot** | Tidy data plus channels (`x`, `y`, `color: 'field'`) split series automatically; specs are JSON | Grammar-of-graphics vocabulary (marks, encodings, transforms) is a lot to learn for "draw a line" |
| **Tremor / Recharts-style** | Flattest API: `data`, `index`, `categories` props | Composition through child components doesn't port to other languages |
| **uPlot** | Speed: Canvas2D, typed arrays, no data processing in the hot path. Its README claims about 10% CPU for 3,600 points updated at 60fps. | Terse, manual config |
| **fl_chart / Syncfusion / graphic (Flutter)** | Native Dart, CustomPainter. Community benchmarks show rendering speed is not the differentiator. | fl_chart: nested `LineChartBarData` per series. Syncfusion: licence. No shared API with the web. |

Lessons applied:

1. **One flat object, every key optional except `type` and `data`.** No nesting to create a series.
2. **Infer from the data.** With no `x`, the first text or date column is x. With no `y`, every number column is
   a series (wide data). `by: 'region'` splits long/tidy data into series (the Vega/Plot idea, one key).
3. **Per-series overrides are keyed by name, not array index**: `series: { cost: { color, type, axis } }`.
   Only needed when you deviate from the defaults.
4. **One `update()` for everything.** Any option can change at any time, and the chart animates to the new state.
5. **The options object is plain JSON**, so it is identical in every language and can be stored, sent or generated.
6. **Speed comes from the architecture, not tuning knobs** (section 8).

## 3. The API

### JavaScript

```js
import { chart } from 'craggy-charts'

const c = chart('#cpu', {
  type: 'line',
  data: rows,              // [{ t, api, worker }, ...]
  y: ['api', 'worker'],    // optional: defaults to every number column
  window: 60,              // live: keep the last 60 points and scroll
  format: 'percent',
})

c.push({ t: '12:00:05', api: 41, worker: 63 })   // append, scrolls smoothly
c.patch({ close: 182.4 })                        // replace the newest row (live tick)
c.update({ type: 'bar', stack: true })           // change anything; it morphs
c.on('click', p => console.log(p.series, p.x, p.y))
```

The whole option set (all optional except `type`, `data` and the value for single-value types):

| Option | Default | Meaning |
|---|---|---|
| `type` | — | Chart type (section 4) |
| `data` | — | Rows (`[{...}]`), plain numbers (`[3, 5, 2]`), or columns (`{ a: [...], b: [...] }`) |
| `x` | first text/date column, else the row index | Category / time / numeric x. A key or an accessor function |
| `y` | every number column | One key or a list of keys; each key is a series |
| `by` | — | Split long data into series by this column |
| `value`, `size`, `label`, `open`/`high`/`low`/`close`, `from`/`to` | conventional names | Extra channels for the types that use them |
| `stack` | `false` | `true` or `'percent'` |
| `horizontal` | `false` | Bars and boxes go sideways |
| `curve` | `'smooth'` | `'smooth' \| 'linear' \| 'step'` |
| `window` | — | Live mode: keep the last N rows and scroll at constant speed |
| `cell` | `'normal'` | Tile size: `'fine' \| 'normal' \| 'chunky'` or pixels |
| `gap`, `round` | logo proportions | Tile gap and corner radius (fractions of the cell) |
| `theme` | `'dark'` | `'dark' \| 'light' \| { ...tokens }` |
| `colors` | Craggy palette | A list, or `{ seriesName: colour }` |
| `series` | — | Per-series overrides: `{ name: { color, type, axis: 'right', label, format, hidden } }` |
| `format` | `'compact'` | `'compact' \| 'percent' \| 'currency' \| 'bytes' \| 'duration' \| fn` |
| `title`, `subtitle` | — | Text above the chart |
| `legend` | auto (when there are 2+ series) | `true \| false \| 'top' \| 'bottom' \| 'right'` |
| `tooltip` | `true` | `false`, or `(point) => string` |
| `axes` | `true` | `false` hides axes and grid (sparklines) |
| `xAxis`, `yAxis` | auto | `{ min, max, label, format, log, ticks }` |
| `annotations` | — | `[{ y: 100, label: 'target' }, { x: 'Mar', label: 'launch' }, { from, to, label }]` |
| `layers` | — | Combo charts: extra option objects drawn on the same axes, each inheriting the parent's options |
| `zoom` | `false` | `true \| 'x' \| 'xy'`: wheel, pinch and drag to zoom and pan |
| `brush` | `false` | `true \| 'x'`: drag to select a range, emits `select` |
| `group` | — | Charts with the same group share crosshair, hover and zoom |
| `animate` | `true` | `false`, or `{ speed }`. `prefers-reduced-motion` is always respected. |

Instance methods: `push(...rows)`, `patch(row)`, `update(options)`, `on(event, fn)` / `off`,
`highlight(series | index)`, `toImage()`, `toSVG()`, `destroy()`.
Events: `hover`, `click`, `select` (brush), `zoom`, `legend`.

### Wrappers (JavaScript)

All wrappers are thin: they pass props straight through as the options object.

```jsx
<Chart type="area" data={revenue} stack format="currency" />           // React / Preact
<craggy-chart type="bar" src="/api/week.json" x="day"></craggy-chart>   // Web Component (any framework or none)
```

### Flutter

Same names, same defaults, same JSON. Map rows work as-is. Typed rows use accessors.

```dart
CraggyChart(
  type: ChartType.line,
  data: rows,                 // List<Map<String, Object?>>
  y: const ['api', 'worker'],
  window: 60,
  format: Format.percent,
  controller: cpu,            // cpu.push({...}), cpu.patch({...}), cpu.update(...)
)

CraggyChart<Sale>.bar(
  data: sales,
  x: (s) => s.month,
  y: [(s) => s.revenue, (s) => s.cost],
  stack: true,
)

CraggyChart.fromJson(spec)    // the exact JS options object
```

### Other languages

Because the spec is JSON, extra languages are cheap. They don't need their own renderer to start with:

* **Python (Jupyter, Streamlit) — in v1**: `craggy_charts.chart(df, type='line', x='date')` serialises the spec
  and renders through the JS package (anywidget). A dataframe maps directly to `data`. Published to PyPI as
  `craggy-charts`.
* **Swift / Kotlin**: native ports later, held to the same conformance suite (section 9). Until then,
  a WebView host or Flutter add-to-app.

## 4. Chart catalogue (all in v1)

Grouped by data shape. Every type supports tooltips, legend toggling where it has series or categories,
animated updates, live data, the light and dark themes, and every tile size.

**Cartesian (x / y)**

| Type | Data | Notes |
|---|---|---|
| `line` | x + 1..n y | smooth / linear / step; live cursor on the newest point; optional `fill` |
| `area` | x + 1..n y | `stack: true \| 'percent'`; gradient fills that fade into the grid |
| `bar` | category + 1..n y | grouped, `stack`, `'percent'`, `horizontal`; value labels on single series; negative values |
| `histogram` | raw numbers | automatic binning (`bins` to override) |
| `scatter` / `bubble` | x, y (+ `size`, `by`) | points glide when data changes |
| `range` | x + `from`/`to` | bands: min/max, confidence intervals, forecast ranges |
| `candlestick` | open/high/low/close | wick drawn as narrower tiles; live price line and tag; `ohlc` style variant |
| `boxplot` | raw values per category | quartiles, whiskers, outliers computed for you |
| `waterfall` | category + delta | running totals, up/down/total colouring |
| `heatmap` | x, y, value | terrain ramp; diverging ramp when the data crosses zero |
| combos | `layers: [...]` | e.g. bars plus a line, with a second axis via `series: { x: { axis: 'right' } }` |

**Radial**

| Type | Data | Notes |
|---|---|---|
| `pie`, `donut` | label + value | hover lifts the slice; centre shows the total or the hovered value |
| `gauge` | `value`, `min`, `max` | 270° arc, terrain ramp, counting number |
| `radialBar` | label + value | concentric progress rings |
| `radar` | axis + 1..n series | |
| `rose` | label + value | polar area |

**Grids, part-to-whole and single values** (formats that tiles are especially good at)

| Type | Data | Notes |
|---|---|---|
| `calendar` | date + value | year or range of days, terrain ramp |
| `waffle` | label + value | units fill in typing order |
| `treemap` | label + value (+ `by` for groups) | squarified; nested groups |
| `funnel` | stage + value | |
| `progress` | `value`, `max` | a single bar meter |
| `stat` | `value` (+ `data` for a trend) | big number drawn **in tiles** (5×7 tile font) plus an optional sparkline |

**Deliberately not in v1:** geographic maps, network/force graphs, sankey/chord, 3D. Each is a different
product (projections, physics layout, flow routing) rather than a tile-rendering of x/y or part-to-whole data.
They can be added later without changing the API. Decided: none of them are in v1.

## 5. Interaction (all in v1)

* Tooltip with series swatches, and a crosshair column of lit tiles. Snaps to the nearest point/bar/slice/cell.
* Pointer glow: the tile under the pointer flashes and fades, like the terrain logo.
* Hover highlight (dim the other series) and legend toggle; double-click a key to isolate it.
* Zoom and pan (wheel, pinch, drag), double-click to reset, and a brush to select a range. Both emit events.
* `group` sync: shared crosshair, hover and zoom across a dashboard.
* Keyboard: the chart is focusable; arrow keys move between points/bars/slices, and Enter fires `click`.
  A live region announces the focused value.
* Touch: tap shows the tooltip and press-drag scrubs. The chart never blocks page scroll (`touch-action: pan-y`).
* Live: `push`/`patch`, constant-speed scroll, and pause-on-hover so a moving point can be read.
* Export: `toImage()` (PNG) and `toSVG()` (one rounded rect per lit tile, so it prints sharply).

## 6. Beautiful by default

* **Craggy palette**: amber `#FFB547` first, then teal, periwinkle, coral, lime, orchid. Checked for contrast
  on `#111A20` and for colour-vision deficiency. Light theme uses `#C26F00` for amber, as in the brand kit.
* **Terrain ramp** (`#16222A` → `#FFE3A8`) for sequential data: heatmaps, calendars, gauges.
* **Unlit tiles**: the whole plot is a faint LED panel, so there is structure without heavy gridlines.
  Gridlines and crosshairs are rows of small dim tiles.
* **Fills fade into the grid**: area and bar gradients run from the series colour down to near-background.
* **Live cursor**: the newest point of a live series pulses toward snow, like the logo's cursor tiles.
* **Text stays text**: axis labels, tooltips and legends use JetBrains Mono with tabular numbers. They are never
  tiled (except `stat` numbers, where the tile font is the point). Labels thin out on a stable stride so they
  slide instead of flickering.
* **Smart formatting**: 1.2k / 3.4M / $1.2k / 45%; date ticks pick their granularity from the span.
* **Accessible patterns**: optional per-series tile textures (checker, stripe, hollow) for print and colour-vision deficiency.

## 7. Animation model

Three layers, all cheap:

1. **Data tween.** Every chart type turns options and data into a *model* that holds only numbers. One generic
   function eases the shown model toward the target (exponential, frame-rate independent). This gives growing
   bars, gliding points, slices that re-proportion and a counting gauge. **Keyed joins**: rows are matched by
   their x/label value, not array position, so a re-sorted bar chart moves bars to their new rows.
   The prototype doesn't do this yet; it matches by index.
2. **Tile springs.** Each tile springs toward its target coverage, with the website's constants
   (stiffness 0.17, damping 0.7, slight overshoot) and a colour fade. This also makes **type morphs** free: a line
   turning into bars is just a new target field, and the tiles re-form.
3. **Ambient.** Entrance sweep (tiles switch on from bottom-left, like the terminal typing the chart in),
   pointer glow, and the live cursor pulse.

Live data scrolls at a **constant speed** derived from the measured push interval rather than easing per push,
which is what makes streaming feel smooth instead of jerky. With `prefers-reduced-motion` or `animate: false`,
everything snaps to its final state.

## 8. Rendering and performance

```
options + data
   │ normalise (x / y / by inference, keyed join)              once per change
   ▼
model (numbers only) ──► tween ──► rasterise into the tile field  CPU, typed arrays, no allocation per frame
                                    (coverage + colour per tile)
                                         │
                                         ▼
                                   per-tile springs              one tight loop over Float32Arrays
                                         │
                                         ▼
                                   GPU draw (1 call)             WebGL2 / Flutter drawRawAtlas
```

**Budgets (v1 acceptance criteria)**

* A settled chart costs **zero**: the shared animation loop stops when nothing moves (the prototype already does this).
* Off-screen charts don't animate (IntersectionObserver / Flutter visibility).
* Per active chart per frame: under 0.5 ms CPU at 20k tiles (rasterise + springs), and one draw call.
* 50 live charts on one dashboard at 60 fps on a mid-range laptop. 10 on a mid-range phone.
* 1M-point series render interactively. The line rasteriser aggregates to min/max per tile column
  (M4 decimation): output resolution is the tile grid, so you never draw more than about 2 × columns segments.
  Appends update the aggregate incrementally.
* Bundle: core plus all types under 40 KB gzipped. Types register themselves, so a size-sensitive app can import
  `craggy-charts/core` and only the types it uses.

**Web renderer.** The tile state (RGB + size) goes into a small RGBA8 texture, one texel per tile. A single
full-quad fragment shader draws every tile procedurally: find the tile, read its state, draw a rounded square
from a signed distance field with an anti-aliased edge. The unlit background, gaps and corner radius cost
nothing. Upload is a few tens of KB per frame. Browsers cap live WebGL contexts at around 16, so all charts on a
page share **one** WebGL2 context on an OffscreenCanvas and blit with `transferToImageBitmap`. A Canvas2D
fallback batches tiles into one Path2D per colour, which is what the prototype does: about 1.6 ms per frame for
14k tiles in Chrome. Optional `worker: true` moves rasterising and rendering off the main thread with
OffscreenCanvas.

**Flutter renderer.** `CustomPainter` + `Canvas.drawRawAtlas`: one rounded-square sprite, one `RSTransform`
(position + scale = tile size) and one colour per lit tile. That is a single batched call that Impeller handles well.
Painting is driven by a `Ticker` that runs only while something moves, wrapped in a `RepaintBoundary`, with
repaints triggered through a `Listenable` rather than widget rebuilds. A `FragmentShader` path, the same idea as
the web shader, is a later optimisation once per-frame texture upload is synchronous in Flutter.

**Flutter web is a first-class v1 target.** The same `drawRawAtlas` painter runs on CanvasKit and Skwasm, and
the Flutter golden tests and performance budgets run on web as well as iOS, Android and desktop.

## 9. One API, two languages, no drift

* **The options schema is the single source of truth** (`spec/options.schema.json`). It generates the
  TypeScript types, the Dart option classes and enums, and the reference docs. A new option exists everywhere
  or nowhere.
* **Two native cores (TypeScript and Dart), not one shared Rust/WASM core.** The core is a few thousand lines of
  pure math (inference, scales, ticks, layout, rasterisers, springs). A shared WASM core would add three build
  targets (web WASM, mobile FFI, Flutter web), async start-up, larger bundles and harder debugging, to save
  porting code that changes slowly.
* **Conformance suite.** Drift between the two ports is caught by a property of the design: **a tile field is
  an exact, comparable artefact.** `conformance/fixtures/*.json` holds options + data + grid size, and
  `expected/*.field` holds per-tile coverage (quantised to 8 bits) and colour. Both cores must produce the same
  field (±1). That catches inference, scale, tick and rasteriser drift long before anything looks wrong.
  Visual goldens (Playwright screenshots; Flutter golden tests) cover the renderers.

## 10. Repository layout

```
craggy-charts/
  spec/            options.schema.json, palette + theme tokens, generators (→ TS, → Dart, → docs)
  conformance/     fixtures/, expected/, runner for each language
  js/              npm `craggy-charts` (core + renderers + all types); subpaths `craggy-charts/react`,
                   `craggy-charts/element` (<craggy-chart>), `craggy-charts/core`
  flutter/         pub.dev `craggy_charts`, example app (mobile, desktop and web)
  python/          PyPI `craggy-charts`: thin anywidget wrapper (spec → JS renderer)
  LICENSE          MIT
  docs/            gallery + reference site, generated from spec/ and the examples
  prototype/       this design prototype (removed once the JS core lands)
```

## 11. Building v1 (one release, everything in it)

This is not a phased rollout: v1 ships with every type and interaction above. These are the work streams that
get it there, in dependency order:

1. **Spec and conformance first**: options schema, generators, palette/theme tokens, and the first fixtures
   (one per type). This locks the API before either core is written.
2. **JS core**: inference, keyed join, scales/ticks/formatting, tween, field + springs, rasterisers, and all types,
   each made to pass its conformance fixtures.
3. **JS renderers**: WebGL2 shared-context renderer, Canvas2D fallback, text layer, tooltip/legend DOM,
   interaction (hover, keyboard, zoom/brush, group sync), export.
4. **Dart core**, ported type by type against the same fixtures (this can run in parallel with step 3).
5. **Flutter renderer and widget**: drawRawAtlas painter, gestures, semantics, controller, `fromJson`.
6. **Wrappers**: React, Web Component, Python.
7. **Docs and gallery** generated from the spec and examples, with the same demos in JS and Flutter.

**Definition of done for v1:** every catalogue type and interaction works in both languages; all conformance
fixtures pass in both cores; visual goldens pass; performance budgets are met on the reference devices and
checked in CI; the accessibility checks pass (keyboard, screen reader summary, reduced motion, contrast);
and the docs cover every option with a live example.

## 12. Decisions (settled 2026-11-06)

1. **Package names**: npm `craggy-charts`, pub.dev `craggy_charts`, PyPI `craggy-charts`. All three were
   unregistered on 2026-11-06; reserve them before announcing anything.
2. **Licence**: MIT (`LICENSE` in the repo root).
3. **Scope**: maps, network graphs, sankey/chord and 3D stay out of v1. v1 is the 22 types in section 4.
4. **Themes**: light and dark both ship in v1.
5. **Platforms**: Flutter web is first-class (tested and benchmarked alongside mobile and desktop), and the
   Python wrapper ships in v1.

## 13. What the prototype proves (and what it doesn't)

Proven in `prototype/`: the coverage-to-tile-size look at 2–18 px tiles; the flat API with inference
(`x`/`y`/`by`); per-tile springs plus a generic model tween for any chart type; type morphing via `update`;
constant-speed live scrolling with `push`/`patch`; tooltips, legend toggles, pointer glow; a shared idle-stopping
animation loop; and 13 chart types (line, area, bar, horizontal bar, scatter/bubble, pie/donut, heatmap,
calendar, waffle, radar, candlestick, gauge, treemap).

Not in the prototype: the WebGL and Flutter renderers, keyed joins, zoom/brush, keyboard navigation,
combos/dual axes, the remaining types, the light theme, and decimation for very large series.
