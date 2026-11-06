// Payloads of the chart callbacks: the JS `on(event)` payloads, typed.
import 'dart:ui' show Color;

import '../core/model_types.dart';
import '../core/util.dart';
import 'style.dart';

/// A point the user hovered, tapped or focused: the data point plus its tooltip content.
class PointEvent {
  PointEvent(Hit hit)
    : point = hit.point,
      title = hit.title,
      rows = [for (final r in hit.rows) (name: r.name, value: r.value, color: rgbColor(r.color))];

  final ChartPoint point;
  final String title;
  final List<({String name, String value, Color color})> rows;

  String get type => point.type;
  int get index => point.index;
  String? get series => point.series;
  String? get label => point.label;
  double? get value => point.value;
  Row? get row => point.row;
}

/// The view after a zoom or pan: fractions of the full x / y range, and the x labels at its ends.
typedef ZoomEvent = ({(double, double) view, (double, double) viewY, Object? from, Object? to});

/// A legend change: the toggled name, whether it is now hidden, and every hidden name.
typedef LegendEvent = ({String name, bool hidden, List<String> hiddenAll});
