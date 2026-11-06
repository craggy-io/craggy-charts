# craggy_charts

Charts drawn in the Craggy tile grid, for Flutter. Every line, bar, slice and cell is made of rounded
tiles. A tile's size is how much of it the shape covers, so edges anti-alias, and tiles spring into place
when data changes. It uses the same flat options, defaults and JSON as the `craggy-charts` JavaScript
package. The core is pure Dart and gives byte-identical tile fields to the JS core on every conformance
fixture. It has no runtime dependencies beyond Flutter.

```dart
import 'package:craggy_charts/craggy_charts.dart';

CraggyChart(
  type: ChartType.line,
  data: rows,                 // List<Map<String, Object?>>, plain numbers, or columns
  y: const ['api', 'worker'], // optional: defaults to every number column
  window: 60,                 // live: keep the last 60 points and scroll
  format: 'percent',
  controller: cpu,            // cpu.push({...}), cpu.patch({...}), cpu.update({...})
)

CraggyChart<Sale>.bar(
  data: sales,
  x: (s) => s.month,
  y: [(s) => s.revenue, (s) => s.cost],
  names: const ['revenue', 'cost'],
  stack: true,
)

CraggyChart.fromJson(spec)    // the exact JS options object
```

**Types:** `line` `area` `bar` `histogram` `scatter` `bubble` `range` `candlestick` `ohlc` `boxplot`
`waterfall` `heatmap` `calendar` `pie` `donut` `gauge` `radialBar` `radar` `rose` `waffle` `treemap` `funnel`
`progress` `stat`. `CraggyChart<T>.typed(type: ...)` maps typed items for any series type.

**Options:** the same names as the JS package. They are listed in [docs/options.md](../docs/options.md),
which is generated from the schema both packages share. `format` and `tooltip` also take Dart functions:
`String Function(num)`, and `Object? Function(PointEvent)` that returns a `String` or a `Widget`.

**Controller:** `push(rows)`, `patch(row)`, `update(options)`, `highlight(name | index | null)`,
`toggle(name)`, `toSvg()`. Commands sent before the chart mounts run when it attaches.

**Callbacks:** `onTap`, `onHover`, `onSelect` (brush), `onZoom`, `onLegend`.

## Interaction and accessibility

Built in:
* Tooltips, the crosshair and the pointer glow.
* Legend: tap to toggle a series, double-tap to isolate it, hover to focus it. It shows when there
  are 2+ items. `legend: false`, `true`, `'top'`, `'bottom'` or `'right'` changes that.
* Keyboard: the arrow keys, Home and End move between points; Enter activates; Escape clears.
* Screen readers: the plot is labelled with a summary, and keyboard moves are announced.
* `MediaQuery.disableAnimations` settles charts in one frame. `theme: 'auto'` follows the platform
  brightness.
* The animation ticker stops when the chart is idle and pauses under a muted `TickerMode`.

Opt-in options:
* `zoom` and `brush`: scroll wheel, trackpad or touch pinch, drag to brush or pan, double-tap to reset.
* `group`: shares the crosshair, hover and zoom across charts.

With no bounded height from its parent, a chart is 280 px tall (`progress` 56, `stat` 140), or `height`.

## Rendering

All the lit tiles are drawn with a single `Canvas.drawRawAtlas` call: one transform and colour per tile
over a pre-rendered rounded square. The unlit panel is a cached picture, and labels use cached
`TextPainter`s. The core (`ChartCore`) is headless: it can run off-screen, export SVG, or drive another
renderer.

## Example

`example/` has a gallery of every type, a live chart driven by a controller, and a light / dark toggle:

```sh
cd example && flutter run -d chrome
```
