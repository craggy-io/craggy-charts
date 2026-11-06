// Types shared by the core, the renderer and the widget.
import 'util.dart';

/// An x-axis label, centred at x (logical pixels), drawn below the plot.
class LabelX {
  const LabelX(this.x, this.text);
  final double x;
  final String text;
}

/// A y-axis label, vertically centred at y, on the left or right of the plot.
class LabelY {
  const LabelY(this.y, this.text, this.side);
  final double y;
  final String text;

  /// 'left' | 'right'.
  final String side;
}

/// Text the renderer draws on top of the tiles. Positions in logical pixels.
class TextItem {
  const TextItem({
    required this.x,
    required this.y,
    required this.text,
    this.align = 'center',
    this.baseline = 'middle',
    this.size = 10,
    this.weight = 400,
    this.color = 'text',
    this.bg,
    this.alpha = 1,
    this.rotate = 0,
  });
  final double x, y;
  final String text;

  /// 'left' | 'center' | 'right'.
  final String align;

  /// 'top' | 'middle' | 'bottom'.
  final String baseline;
  final double size;
  final int weight;

  /// An [RGB], or 'text' / 'textHi'.
  final Object color;

  /// An [RGB], or 'tooltip'.
  final Object? bg;
  final double alpha;

  /// Rotation in degrees (axis titles).
  final double rotate;
}

/// One line of a tooltip: a colour swatch, a name and a formatted value.
class TipRow {
  const TipRow(this.color, this.name, this.value);
  final RGB color;
  final String name, value;
}

/// A data point as reported to callbacks and tooltip functions.
class ChartPoint {
  const ChartPoint({required this.type, required this.index, this.series, this.label, this.value, this.row});
  final String type;
  final int index;
  final String? series, label;
  final double? value;
  final Row? row;
}

/// Tooltip content for a picked item.
class Hit {
  const Hit({required this.index, required this.title, required this.rows, required this.point});
  final int index;
  final String title;
  final List<TipRow> rows;
  final ChartPoint point;
}
