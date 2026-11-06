# Changelog

## 1.0.0

* First release: a pure-Dart port of the craggy-charts core. It covers 24 chart types and is
  byte-identical to the JS core on all 49 conformance fixtures.
* `CraggyChart` widget: the flat options API, `CraggyChart.fromJson`, typed `CraggyChart<T>.bar` and
  `.typed`, and `CraggyController` (`push`, `patch`, `update`, `highlight`, `toggle`, `toSvg`).
* One `drawRawAtlas` call for every lit tile; cached panel and labels.
* Tooltip, legend, crosshair, glow, keyboard navigation, semantics, zoom, pan, brush and chart groups.
* Respects reduced motion and `TickerMode`.
