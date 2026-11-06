// Imperative access to a CraggyChart: the JS instance methods (push, patch, update, highlight,
// toggle, toSVG). Commands sent before the chart is mounted run when it attaches.
import '../core/util.dart';

/// What a mounted chart does with controller commands.
abstract interface class ChartCommands {
  void push(List<Object?> rows);
  void patch(Row row);
  void update(Map<String, Object?> options);
  void highlight(Object? target);
  void toggle(String name);
  String toSvg();
}

class CraggyController {
  ChartCommands? _chart;
  final List<void Function(ChartCommands)> _queued = [];

  /// Whether a chart is using this controller.
  bool get attached => _chart != null;

  void _run(void Function(ChartCommands c) op) {
    final c = _chart;
    if (c != null) {
      op(c);
    } else {
      _queued.add(op);
    }
  }

  /// Append rows (maps or numbers, or one of them). With `window`, old rows scroll off.
  void push(Object? rows) => _run((c) => c.push(rows is List ? rows : [rows]));

  /// Merge into the newest row (a live tick inside the current candle).
  void patch(Row row) => _run((c) => c.patch(row));

  /// Change any option; the chart animates to the new state.
  void update(Map<String, Object?> options) => _run((c) => c.update(options));

  /// Highlight a series or category by name, a row by index, or clear with null.
  void highlight(Object? target) => _run((c) => c.highlight(target));

  /// Show or hide a series or category, as a legend tap does.
  void toggle(String name) => _run((c) => c.toggle(name));

  /// SVG of the settled chart, or null while no chart is attached.
  String? toSvg() => _chart?.toSvg();

  /// Called by the chart that uses this controller.
  void attach(ChartCommands chart) {
    _chart = chart;
    final ops = List.of(_queued);
    _queued.clear();
    for (final op in ops) {
      op(chart);
    }
  }

  /// Called by the chart when it stops using this controller.
  void detach(ChartCommands chart) {
    if (identical(_chart, chart)) _chart = null;
  }
}
