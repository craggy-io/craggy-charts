// The contract every chart type implements, and the context the core hands it.
import 'field.dart';
import 'format.dart';
import 'model_types.dart';
import 'theme.dart';
import 'util.dart';

/// Average advance of a 10px JetBrains Mono glyph; used for deterministic label layout.
const double charW = 6.02;

class Margin {
  const Margin(this.l, this.r, this.t, this.b);
  final double l, r, t, b;
}

class Grid {
  const Grid({required this.w, required this.h, required this.cell, required this.cols, required this.rows, required this.ox, required this.oy});

  /// Logical pixel size of the whole chart surface.
  final double w, h;

  /// Tile size in logical pixels, and the plot's tile counts.
  final double cell;
  final int cols, rows;

  /// Logical pixel offset of the plot's top-left tile.
  final double ox, oy;
}

/// Labels and texts of the last frame.
class Out {
  final List<LabelX> labelsX = [];
  final List<LabelY> labelsY = [];
  final List<TextItem> texts = [];
  void clear() {
    labelsX.clear();
    labelsY.clear();
    texts.clear();
  }
}

typedef Model = Map<String, dynamic>;
typedef Fixed = Map<String, dynamic>;

/// What a type is handed while building its model and drawing.
class Ctx {
  Ctx({
    required this.opts,
    required this.rows,
    required this.theme,
    required this.format,
    required this.hidden,
    required this.hover,
    required this.grid,
    required this.out,
    required this.colorOf,
    required this.x,
    required this.xAt,
    required this.band,
    required this.y,
    required this.v,
    required this.horizontal,
    required this.inView,
    required this.version,
    required this.derive,
  });

  final Map<String, dynamic> opts;
  final List<Row> rows;
  final ChartTheme theme;
  final Fmt format;
  final Set<String> hidden;

  /// Hovered or focused item id (-1 when none).
  final int hover;
  final Grid grid;
  final Out out;
  double now = 0;
  final RGB Function(String name, int i) colorOf;

  /// Cartesian only. Tile x of a row index (window / categories) or x value (continuous).
  final double Function(num v) x;

  /// Tile x of row i using the model's position channel.
  final double Function(Model m, int i) xAt;

  /// Width of one category band in tiles.
  final double band;

  /// Tile position along the value axis (y, or x for horizontal charts).
  final double Function(num v, [String side]) y;

  /// Length of the value axis in tiles.
  final int v;
  final bool horizontal;

  /// True while a live chart is receiving data (drives the cursor pulse).
  bool live = false;

  /// Whether row i is inside the zoomed view (for auto-scaling the value axis).
  final bool Function(int i) inView;

  /// Set by a type when something keeps moving (e.g. the live cursor pulse).
  bool animating = false;

  /// Changes whenever positions, domains, the view or the grid change: geometry may be cached by it.
  final int version;

  /// Value derived from rows + opts, computed once per rebuild (types call model() twice).
  final T Function<T>(String key, Map<String, dynamic> opts, T Function() make) derive;

  /// The same context with other options (JS `{ ...ctx, opts }`).
  Ctx withOpts(Map<String, dynamic> o) => Ctx(
        opts: o,
        rows: rows,
        theme: theme,
        format: format,
        hidden: hidden,
        hover: hover,
        grid: grid,
        out: out,
        colorOf: colorOf,
        x: x,
        xAt: xAt,
        band: band,
        y: y,
        v: v,
        horizontal: horizontal,
        inView: inView,
        version: version,
        derive: derive,
      )
        ..now = now
        ..live = live;
}

class Extent {
  const Extent(this.lo, this.hi, this.side, {this.zero = false, this.pad = false, this.percent = false});
  final double lo, hi;
  final String side;
  final bool zero, pad, percent;
}

/// x information a cartesian type exposes so the core can map and label the x axis.
class XInfo {
  const XInfo(this.kind, this.labels, this.xs, this.keys);

  /// 'category' | 'number' | 'time'.
  final String kind;
  final List<dynamic> labels;
  final List<double> xs;
  final List<String> keys;
}

/// A built model: numbers to ease, plus everything fixed for this data.
class Built {
  const Built(this.model, this.fixed);
  final Model model;
  final Fixed fixed;
}

typedef LegendItem = ({String name, RGB color});

class ChartTypeDef {
  const ChartTypeDef({
    required this.kind,
    required this.model,
    required this.raster,
    this.band = false,
    this.xGrid = false,
    this.freePick = false,
    this.hoverModel = false,
    this.margin,
    this.extents,
    this.xinfo,
    this.keyed,
    this.keys,
    this.seed,
    this.rowsAt,
    this.pick,
    this.tip,
    this.ids,
    this.anchor,
    this.legend,
    this.count,
  });

  /// 'cartesian' | 'polar' | 'grid'.
  final String kind;

  /// Cartesian: categories are bands (bars) rather than points (lines).
  final bool band;

  /// Draw x gridlines (scatter).
  final bool xGrid;

  /// Pick by nearest point (scatter) instead of by x index.
  final bool freePick;

  /// Rebuild the model when hover changes (slice lift).
  final bool hoverModel;
  final Margin Function(Ctx ctx)? margin;
  final Built Function(Ctx ctx) model;
  final List<Extent> Function(Ctx ctx, Fixed f)? extents;
  final XInfo Function(Fixed f)? xinfo;

  /// Model fields whose last dimension is per row, re-ordered by key on update.
  final List<String>? keyed;
  final List<String> Function(Fixed f)? keys;
  final void Function(Model shown, Model model)? seed;
  final void Function(Ctx ctx, Model m, Fixed f, Raster g) raster;

  /// Index-based cartesian tooltip rows for row i.
  final List<TipRow> Function(Ctx ctx, Fixed f, int i)? rowsAt;

  /// Free picking: item id under tile point (x, y), or -1.
  final int Function(Ctx ctx, Model m, Fixed f, double x, double y)? pick;

  /// Tooltip for an item id.
  final Hit? Function(Ctx ctx, Model m, Fixed f, int id)? tip;

  /// Keyboard order of item ids.
  final List<int> Function(Ctx ctx, Fixed f)? ids;

  /// Tile point to anchor the tooltip of a focused id.
  final (double, double) Function(Ctx ctx, Model m, Fixed f, int id)? anchor;
  final List<LegendItem> Function(Ctx ctx, Fixed f)? legend;
  final int Function(Fixed f)? count;
}
