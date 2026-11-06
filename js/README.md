# craggy-charts

Charts drawn in the Craggy tile grid. Every line, bar, slice and cell is made of rounded tiles. A tile's
size is how much of it the shape covers, so edges anti-alias, and tiles spring into place when data changes.
There is one flat options object with good defaults, and 24 chart types in about 38 KB gzipped.

```bash
npm install craggy-charts
```

```js
import { chart } from 'craggy-charts'

const c = chart('#cpu', {
  type: 'line',
  data: rows,              // [{ t, api, worker }, ...], plain numbers, or columns
  y: ['api', 'worker'],    // optional: defaults to every number column
  window: 60,              // live: keep the last 60 points and scroll
  format: 'percent',
})

c.push({ t: '12:00:05', api: 41, worker: 63 })   // append; scrolls at constant speed
c.update({ type: 'area', stack: true })          // change anything; it morphs
c.on('click', p => console.log(p.title, p.rows))
```

**Types:** `line` `area` `bar` `histogram` `scatter` `bubble` `range` `candlestick` `ohlc` `boxplot`
`waterfall` `heatmap` `calendar` `pie` `donut` `gauge` `radialBar` `radar` `rose` `waffle` `treemap` `funnel`
`progress` `stat`. Combos use `layers`, or `series: { name: { type, axis: 'right' } }`.

**Options:** every option is listed in [docs/options.md](../docs/options.md), generated from the schema
that the Dart and Python packages share.

**Instance methods:** `push(...rows)`, `patch(row)`, `update(options)`, `highlight(name | index | null)`,
`toggle(name)`, `on(event, fn)` / `off`, `toImage()`, `toSVG()`, `destroy()`.

**Events:** `hover`, `click`, `select` (brush), `zoom`, `legend`.

## Interaction and accessibility

Built in, with nothing to configure:
* Tooltips and the crosshair.
* Legend: click to toggle a series, double-click to isolate it, hover to focus it.
* Pointer glow.
* Touch: tap for a tooltip. Charts never block page scroll.
* Keyboard: arrow keys move between points, announced through a live region.
* Screen readers get a summary label and a hidden data table.
* `prefers-reduced-motion` and `prefers-color-scheme` (`theme: 'auto'`) are respected.

Opt-in options:
* `zoom` and `brush`: wheel, pinch, drag and pan.
* `group`: shares crosshair, hover and zoom across charts.

## Wrappers

```jsx
import { Chart } from 'craggy-charts/react'
<Chart type="bar" data={sales} x="month" stack onClick={p => ...} />
```

```html
<script type="module">import 'craggy-charts/element'</script>
<craggy-chart type="bar" src="/api/week.json" x="day"></craggy-chart>
```

For a plain `<script>` tag, use `dist/craggy-charts.global.js`, which exposes a global `CraggyCharts`.
The headless core is available on its own as `craggy-charts/core`, with no DOM; it's useful on servers and in tests.

## Rendering and performance

* **WebGL2:** all charts on a page share one WebGL2 context. One shader draws every tile.
* **Canvas2D:** used automatically when WebGL2 is unavailable or the context is lost. `setRenderer('canvas2d')`
  forces it.
* **Idle cost:** charts that have settled cost nothing. One shared animation loop stops when nothing moves, and
  off-screen charts don't animate.
* **Large series:** line data is reduced to min/max per tile column (M4), so a million points draw
  interactively.

## Development

```bash
npm install
npm run build          # spec → generated types, dist/ bundles, .d.ts
npm test               # unit + conformance (vitest)
npx playwright test    # browser: visual goldens, interaction, wrappers, Python widget, then perf budgets
npm run conformance    # regenerate conformance/expected after an intentional rendering change
```

MIT licence.
