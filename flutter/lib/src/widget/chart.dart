// The Flutter chart: a ChartCore plus the tile painter, title, legend, tooltip, interaction and
// semantics. The same behaviour as the JS DOM chart (js/src/dom/chart.ts).
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../core/chart_core.dart';
import '../core/export.dart' as svg;
import '../core/model_types.dart';
import '../core/util.dart' hide Row;
import '../generated/options.g.dart';
import 'chrome.dart';
import 'controller.dart';
import 'events.dart';
import 'painter.dart';
import 'style.dart';

/// Default height when the parent does not bound it (the JS chart's defaultHeight).
double defaultHeight(String type) => type == 'progress'
    ? 56
    : type == 'stat'
    ? 140
    : 280;

/// Key of the x column in rows built from typed items.
const String _typedX = '_x';

Map<String, Object?> _typedOptions<T>(
  String type,
  List<T> data,
  Object? Function(T) x,
  List<num? Function(T)> y,
  List<String>? names,
  Map<String, Object?> extra,
) {
  final keys = names ?? [for (var i = 0; i < y.length; i++) 'series ${i + 1}'];
  if (keys.length != y.length) throw ArgumentError('craggy_charts: names must have one entry per y accessor');
  return {
    ...extra,
    'type': type,
    'x': _typedX,
    'y': keys,
    'data': [
      for (final item in data) {_typedX: x(item), for (var i = 0; i < y.length; i++) keys[i]: y[i](item)},
    ],
  };
}

/// A craggy-charts chart. The flat options are the JS options; every one is optional except
/// [type] and [data] (or [value] for single-value types).
class CraggyChart<T> extends StatefulWidget {
  CraggyChart({
    super.key,
    required ChartType type,
    Object? data,
    Object? x,
    Object? y,
    String? by,
    Object? value,
    String? size,
    String? label,
    String? open,
    String? high,
    String? low,
    String? close,
    String? from,
    String? to,
    double? min,
    double? max,
    Object? stack,
    bool? horizontal,
    String? curve,
    bool? fill,
    int? window,
    int? bins,
    double? inner,
    int? units,
    String? sort,
    bool? labels,
    Object? cell,
    double? gap,
    double? round,
    Object? theme,
    Object? colors,
    Map<String, Map<String, Object?>>? series,
    Object? format,
    String? title,
    String? subtitle,
    Object? legend,
    Object? tooltip,
    bool? axes,
    Map<String, Object?>? xAxis,
    Map<String, Object?>? yAxis,
    List<Map<String, Object?>>? annotations,
    List<Map<String, Object?>>? layers,
    Object? zoom,
    Object? brush,
    String? group,
    Object? animate,
    this.controller,
    this.height,
    this.onTap,
    this.onHover,
    this.onSelect,
    this.onZoom,
    this.onLegend,
  }) : options = ChartOptions(
         type: type,
         data: data,
         x: x,
         y: y,
         by: by,
         value: value,
         size: size,
         label: label,
         open: open,
         high: high,
         low: low,
         close: close,
         from: from,
         to: to,
         min: min,
         max: max,
         stack: stack,
         horizontal: horizontal,
         curve: curve,
         fill: fill,
         window: window,
         bins: bins,
         inner: inner,
         units: units,
         sort: sort,
         labels: labels,
         cell: cell,
         gap: gap,
         round: round,
         theme: theme,
         colors: colors,
         series: series,
         format: format,
         title: title,
         subtitle: subtitle,
         legend: legend,
         tooltip: tooltip,
         axes: axes,
         xAxis: xAxis,
         yAxis: yAxis,
         annotations: annotations,
         layers: layers,
         zoom: zoom,
         brush: brush,
         group: group,
         animate: animate,
       ).toJson();

  /// The exact JS options object (validated through [ChartOptions.fromJson]).
  CraggyChart.fromJson(
    Map<String, Object?> json, {
    super.key,
    this.controller,
    this.height,
    this.onTap,
    this.onHover,
    this.onSelect,
    this.onZoom,
    this.onLegend,
  }) : options = ChartOptions.fromJson(json).toJson();

  /// A bar chart of typed items: [x] gives the category, each [y] accessor a series, named by
  /// [names]. Any other option goes in [options].
  CraggyChart.bar({
    super.key,
    required List<T> data,
    required Object? Function(T) x,
    required List<num? Function(T)> y,
    List<String>? names,
    Object? stack,
    bool? horizontal,
    String? title,
    Object? format,
    Map<String, Object?> options = const {},
    this.controller,
    this.height,
    this.onTap,
    this.onHover,
    this.onSelect,
    this.onZoom,
    this.onLegend,
  }) : options = _typedOptions('bar', data, x, y, names, {
         ...options,
         'stack': ?stack,
         'horizontal': ?horizontal,
         'title': ?title,
         'format': ?format,
       });

  /// Any series chart (line, area, scatter...) of typed items, as [CraggyChart.bar].
  CraggyChart.typed({
    super.key,
    required ChartType type,
    required List<T> data,
    required Object? Function(T) x,
    required List<num? Function(T)> y,
    List<String>? names,
    String? title,
    Object? format,
    Map<String, Object?> options = const {},
    this.controller,
    this.height,
    this.onTap,
    this.onHover,
    this.onSelect,
    this.onZoom,
    this.onLegend,
  }) : options = _typedOptions(chartTypeNames[type]!, data, x, y, names, {...options, 'title': ?title, 'format': ?format});

  /// The JS options object this widget draws.
  final Map<String, Object?> options;
  final CraggyController? controller;

  /// Height when the parent does not bound it. Default: 56 for progress, 140 for stat, else 280.
  final double? height;

  /// A point was tapped (or activated with Enter / Space).
  final ValueChanged<PointEvent>? onTap;

  /// The hovered point changed (null when the pointer leaves every point).
  final ValueChanged<PointEvent?>? onHover;

  /// A range was brushed.
  final ValueChanged<Selection>? onSelect;

  /// The view was zoomed or panned.
  final ValueChanged<ZoomEvent>? onZoom;

  /// A legend chip toggled or isolated a series.
  final ValueChanged<LegendEvent>? onLegend;

  @override
  State<CraggyChart<T>> createState() => _CraggyChartState<T>();
}

class _Repaint extends ChangeNotifier {
  void paint() => notifyListeners();
}

typedef _Tip = ({Hit hit, Offset at, Object? custom, bool on});

enum _DragMode { brush, pan, scrub }

class _Drag {
  _Drag(this.mode, this.x0, this.start, this.view, this.viewY);
  final _DragMode mode;
  final double x0;
  final Offset start;
  final List<double> view, viewY;
  bool moved = false;
}

typedef _Pinch = ({double d, List<double> view, double cx});

bool _deepEqual(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final k in a.keys) {
      if (!b.containsKey(k) || !_deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

/// Charts sharing a `group` (crosshair, hover and zoom).
final Map<String, Set<_CraggyChartState<dynamic>>> _groups = {};

class _CraggyChartState<T> extends State<CraggyChart<T>> with SingleTickerProviderStateMixin implements ChartCommands {
  late final ChartCore core = ChartCore(widget.options, CoreEnv());
  late final Ticker _ticker = createTicker(_onTick);
  final _repaint = _Repaint();
  final _res = TileResources();
  final _focus = FocusNode(debugLabel: 'CraggyChart');
  final _tip = ValueNotifier<_Tip?>(null);
  final _clock = Stopwatch()..start();
  late final ChartPainter _painter = ChartPainter(core, _res, _repaint);

  Duration? _lastTick;
  double _tickBase = 0, _lastNow = 0;
  Offset? _pointer, _lastTipAt;
  final Map<int, Offset> _pointers = {};
  _Drag? _drag;
  _Pinch? _pinch;
  double _panZoomStart = 1;
  int _focusIndex = -1;
  final List<Object?> _paused = [];
  String _announce = '';
  bool _syncing = false;
  Duration? _lastTapAt;
  Offset? _lastTapPos;
  int _touchTimer = 0;

  // ── Lifecycle ───────────────────────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    widget.controller?.attach(this);
    _joinGroup();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final mq = MediaQuery.maybeOf(context);
    final light = mq?.platformBrightness == Brightness.light, reduced = mq?.disableAnimations ?? false;
    final env = core.env;
    if (light != env.prefersLight) {
      env.prefersLight = light;
      if (core.opts['theme'] == 'auto') core.update({});
    }
    env.reducedMotion = reduced;
    _wake();
  }

  @override
  void didUpdateWidget(CraggyChart<T> old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller?.detach(this);
      widget.controller?.attach(this);
    }
    // Only what changed goes to the core (as a JS update(partial)), so rows pushed through the
    // controller survive a rebuild that changes, say, the theme. Keys no longer set reset to null.
    final o = old.options, n = widget.options;
    final changed = {
      for (final k in o.keys)
        if (!n.containsKey(k)) k: null,
      for (final e in n.entries)
        if (!o.containsKey(e.key) || !_deepEqual(o[e.key], e.value)) e.key: e.value,
    };
    if (changed.isNotEmpty) update(changed);
  }

  @override
  void dispose() {
    widget.controller?.detach(this);
    _leaveGroup(core.opts['group'] as String?);
    _ticker.dispose();
    _repaint.dispose();
    _tip.dispose();
    _focus.dispose();
    _res.dispose();
    super.dispose();
  }

  // ── Commands (CraggyController) ─────────────────────────────────────────────────────────

  @override
  void update(Map<String, Object?> options) {
    final prevGroup = core.opts['group'] as String?;
    core.update(options);
    if (options.containsKey('group') && options['group'] != prevGroup) {
      _leaveGroup(prevGroup);
      _joinGroup();
    }
    _chromeChanged();
    _refreshTip();
    _wake();
  }

  @override
  void push(List<Object?> rows) {
    final flat = [
      for (final r in rows) ...(r is List ? r : [r]),
    ];
    if (_pointer != null && core.live) {
      _paused.addAll(flat); // pause-on-hover
      return;
    }
    core.push(flat, _now());
    _afterData();
  }

  @override
  void patch(Map<String, dynamic> row) {
    core.patch(row);
    _afterData();
  }

  @override
  void highlight(Object? target) {
    if (target is int) {
      _focusIndex = target;
      _setHover(target, true);
      _showTip(_anchor(target));
    } else {
      core.setFocus(target as String?);
      if (target == null) _setHover(-1, true);
    }
    _wake();
  }

  @override
  void toggle(String name) {
    core.toggle(name);
    _chromeChanged();
    _wake();
  }

  @override
  String toSvg() {
    core.settle(_now());
    _repaint.paint();
    return svg.toSvg(core);
  }

  // ── Frame ───────────────────────────────────────────────────────────────────────────────

  double _now() => _lastNow = math.max(_lastNow, _clock.elapsedMicroseconds / 1000);

  void _wake() {
    if (core.grid == null || !mounted) return;
    if (core.still) {
      // Reduced motion / animate: false: jump to the final state, no ticker.
      _ticker.stop();
      core.frame(_now(), 1 / 60);
      _repaint.paint();
      return;
    }
    if (!_ticker.isActive) {
      _lastTick = null;
      _tickBase = _now();
      _ticker.start();
    }
  }

  void _onTick(Duration elapsed) {
    final last = _lastTick;
    _lastTick = elapsed;
    final dt = last == null ? 1 / 60 : clamp((elapsed - last).inMicroseconds / 1e6, 0.001, 0.1);
    final now = _lastNow = math.max(_lastNow, _tickBase + elapsed.inMicroseconds / 1000);
    final moving = core.frame(now, dt);
    _repaint.paint();
    if (!moving) _ticker.stop();
  }

  void _afterData() {
    _chromeChanged();
    _refreshTip();
    _wake();
  }

  void _chromeChanged() {
    if (mounted) setState(() {});
  }

  // ── Legend ──────────────────────────────────────────────────────────────────────────────

  void _legendToggle(String name) {
    core.toggle(name);
    _legendChanged(name);
  }

  void _isolate(String name) {
    final names = [for (final l in core.legend()) l.name], others = names.where((n) => n != name);
    final alreadyAlone = !core.hidden.contains(name) && others.every(core.hidden.contains);
    for (final n in names) {
      final hide = !alreadyAlone && n != name;
      if (hide) {
        core.hidden.add(n);
      } else {
        core.hidden.remove(n);
      }
    }
    core.rebuild();
    _legendChanged(name);
  }

  void _legendChanged(String name) {
    core.setFocus(null);
    _chromeChanged();
    widget.onLegend?.call((name: name, hidden: core.hidden.contains(name), hiddenAll: [...core.hidden]));
    _wake();
  }

  void _legendFocus(String? name) {
    core.setFocus(name);
    _wake();
  }

  // ── Pointer ─────────────────────────────────────────────────────────────────────────────

  bool get _zoomed => core.view[1] - core.view[0] < 0.999 || core.viewY[1] - core.viewY[0] < 0.999;

  void _onMove(PointerEvent e) {
    final p = e.localPosition;
    _pointer = p;
    if (_pointers.containsKey(e.pointer)) _pointers[e.pointer] = p;
    if (_pinch != null && _pointers.length == 2) return _onPinch();
    final d = _drag, g = core.grid;
    if (d != null && g != null) {
      final (tx, _) = core.toTiles(p.dx, p.dy);
      if ((p.dx - d.start.dx).abs() + (p.dy - d.start.dy).abs() > 4) d.moved = true;
      if (d.mode == _DragMode.brush && d.moved) {
        core.brush = (d.x0, tx);
        _wake();
      } else if (d.mode == _DragMode.pan && d.moved) {
        final span = d.view[1] - d.view[0], du = ((p.dx - d.start.dx) / (g.cols * g.cell)) * span;
        final a = clamp(d.view[0] - du, 0, 1 - span);
        final ys = d.viewY[1] - d.viewY[0], dv = core.opts['zoom'] == 'xy' ? ((p.dy - d.start.dy) / (g.rows * g.cell)) * ys : 0.0;
        final b = clamp(d.viewY[0] + dv, 0, 1 - ys);
        _setView([a, a + span], [b, b + ys]);
      }
    }
    _hoverAt(p);
  }

  /// Glow, pick and tooltip for a pointer position (hover, or a touch landing).
  void _hoverAt(Offset p) {
    _glowAt(p.dx, p.dy);
    final id = core.pick(p.dx, p.dy);
    _setHover(id);
    if (id >= 0) {
      _showTip(p);
    } else {
      _hideTip();
    }
  }

  void _onDown(PointerDownEvent e) {
    final p = e.localPosition, o = core.opts;
    _pointers[e.pointer] = p;
    _focus.requestFocus();
    if (e.kind == PointerDeviceKind.touch) {
      _touchTimer++; // a tap has no move before it
      _pointer = p;
      _hoverAt(p);
    }
    if (_pointers.length == 2 && truthy(o['zoom'])) {
      final pts = _pointers.values.toList();
      _pinch = (d: (pts[0].dx - pts[1].dx).abs() == 0 ? 1 : (pts[0].dx - pts[1].dx).abs(), view: [...core.view], cx: (pts[0].dx + pts[1].dx) / 2);
      _drag = null;
      core.brush = null;
      return;
    }
    if (core.grid == null || !core.cartesian) {
      _drag = _Drag(_DragMode.scrub, 0, p, const [0, 1], const [0, 1]);
      return;
    }
    final mode = truthy(o['brush']) && !(HardwareKeyboard.instance.isShiftPressed && _zoomed)
        ? _DragMode.brush
        : truthy(o['zoom']) && _zoomed
        ? _DragMode.pan
        : _DragMode.scrub;
    _drag = _Drag(mode, core.toTiles(p.dx, p.dy).$1, p, [...core.view], [...core.viewY]);
  }

  void _onUp(PointerEvent e) {
    _pointers.remove(e.pointer);
    if (_pinch != null) {
      if (_pointers.length < 2) _pinch = null;
      return;
    }
    final d = _drag;
    _drag = null;
    if (d == null) return;
    final brush = core.brush;
    if (d.mode == _DragMode.brush && d.moved && brush != null) {
      final (a, b) = brush;
      final sel = core.selection(a, b);
      if (truthy(core.opts['zoom']) && sel != null && core.opts['brush'] != 'select') _zoomToTiles(a, b);
      core.brush = null;
      if (sel != null) widget.onSelect?.call(sel);
      _wake();
      return;
    }
    if (!d.moved) _tapped(e);
    if (e.kind == PointerDeviceKind.touch) {
      final ticket = ++_touchTimer;
      Future<void>.delayed(const Duration(milliseconds: 1500), () {
        if (mounted && ticket == _touchTimer && _drag == null) _onLeave();
      });
    }
  }

  void _tapped(PointerEvent e) {
    final hit = core.tip(core.hover);
    if (hit != null) widget.onTap?.call(PointEvent(hit));
    // A second tap close in time and place resets the zoom (the JS dblclick).
    final last = _lastTapAt, pos = _lastTapPos;
    final double2 = last != null && pos != null && e.timeStamp - last < kDoubleTapTimeout && (e.localPosition - pos).distance < kDoubleTapSlop;
    _lastTapAt = double2 ? null : e.timeStamp;
    _lastTapPos = e.localPosition;
    if (double2 && truthy(core.opts['zoom'])) _setView([0, 1], [0, 1]);
  }

  void _onCancel(PointerCancelEvent e) {
    _pointers.remove(e.pointer);
    _drag = null;
    _pinch = null;
    core.brush = null;
  }

  void _onLeave() {
    _pointer = null;
    _setHover(-1);
    _hideTip();
    if (_paused.isNotEmpty) {
      final rows = [..._paused];
      _paused.clear();
      core.push(rows, _now());
      _afterData();
    }
  }

  void _onSignal(PointerSignalEvent e) {
    if (e is! PointerScrollEvent || !truthy(core.opts['zoom']) || core.grid == null || !core.cartesian) return;
    GestureBinding.instance.pointerSignalResolver.register(
      e,
      (ev) => _zoomAt((ev as PointerScrollEvent).localPosition, math.exp(clamp(ev.scrollDelta.dy, -100, 100) * 0.002)),
    );
  }

  void _onPanZoomStart(PointerPanZoomStartEvent e) => _panZoomStart = 1;

  /// Trackpad pinch: zoom by the change in scale since the last update.
  void _onPanZoomUpdate(PointerPanZoomUpdateEvent e) {
    if (!truthy(core.opts['zoom']) || core.grid == null || !core.cartesian || e.scale <= 0) return;
    final f = _panZoomStart / e.scale;
    _panZoomStart = e.scale;
    if ((f - 1).abs() > 1e-4) _zoomAt(e.localPosition, f);
  }

  /// Zoom the view by factor [f] about a pointer position (the JS wheel handler).
  void _zoomAt(Offset p, double f) {
    final g = core.grid!;
    final (tx, ty) = core.toTiles(p.dx, p.dy);
    List<double> zoomAxis(List<double> view, double u) {
      final span = view[1] - view[0], at = view[0] + clamp(u) * span, ns = clamp(span * f, 0.001, 1);
      final a = clamp(at - (at - view[0]) * (ns / span), 0, 1 - ns);
      return [a, a + ns];
    }

    final hz = core.horizontal;
    final vx = zoomAxis(core.view, hz ? 1 - ty / g.rows : tx / g.cols);
    final vy = core.opts['zoom'] == 'xy' ? zoomAxis(core.viewY, hz ? tx / g.cols : ty / g.rows) : core.viewY;
    _setView(vx, vy);
  }

  void _onPinch() {
    final pz = _pinch!, pts = _pointers.values.toList(), g = core.grid!;
    final dist = (pts[0].dx - pts[1].dx).abs();
    final ratio = pz.d / (dist == 0 ? 1 : dist), span = pz.view[1] - pz.view[0], ns = clamp(span * ratio, 0.001, 1);
    final u = (pz.cx - g.ox) / (g.cols * g.cell), at = pz.view[0] + clamp(u) * span;
    final s = clamp(at - (at - pz.view[0]) * (ns / span), 0, 1 - ns);
    _setView([s, s + ns], core.viewY);
  }

  void _zoomToTiles(double a, double b) {
    final g = core.grid!, v0 = core.view[0], span = core.view[1] - v0;
    final lo = minD(a, b) / g.cols, hi = maxD(a, b) / g.cols;
    _setView([v0 + lo * span, v0 + hi * span], core.viewY);
  }

  void _setView(List<double> view, List<double> viewY, [bool fromGroup = false]) {
    core.setView(view[0], view[1], viewY[0], viewY[1]);
    _wake();
    final g = core.grid, sel = g != null ? core.selection(0, g.cols.toDouble()) : null;
    widget.onZoom?.call((view: (core.view[0], core.view[1]), viewY: (core.viewY[0], core.viewY[1]), from: sel?.from, to: sel?.to));
    if (!fromGroup) _eachInGroup((c) => c._setView(view, viewY, true));
  }

  void _glowAt(double x, double y) {
    final g = core.grid;
    if (g == null || core.still) return;
    final (tx, ty) = core.toTiles(x, y);
    final c = tx.floor(), r = ty.floor();
    void set(int cc, int rr, double v) {
      if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) return;
      final i = (g.rows - 1 - rr) * g.cols + cc;
      core.glow[i] = math.max(core.glow[i], v);
    }

    set(c, r, 1);
    set(c - 1, r, 0.45);
    set(c + 1, r, 0.45);
    set(c, r - 1, 0.45);
    set(c, r + 1, 0.45);
    _wake();
  }

  void _setHover(int id, [bool fromGroup = false]) {
    if (!core.setHover(id)) return;
    _wake();
    final hit = id >= 0 ? core.tip(id) : null;
    if (!fromGroup) widget.onHover?.call(hit != null ? PointEvent(hit) : null);
    if (!fromGroup && !_syncing && core.cartesian && !core.primary.def.freePick) {
      _syncing = true;
      _eachInGroup((c) {
        if (!c.core.cartesian) return;
        c._setHover(id, true);
        if (id < 0) c._hideTip();
      });
      _syncing = false;
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────────────────

  KeyEventResult _onKey(FocusNode node, KeyEvent e) {
    if (e is! KeyDownEvent && e is! KeyRepeatEvent) return KeyEventResult.ignored;
    final ids = core.ids();
    if (ids.isEmpty) return KeyEventResult.ignored;
    var k = ids.indexOf(_focusIndex);
    final key = e.logicalKey;
    if (key == LogicalKeyboardKey.arrowRight || key == LogicalKeyboardKey.arrowDown) {
      k = k < 0 ? 0 : math.min(ids.length - 1, k + 1);
    } else if (key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.arrowUp) {
      k = k < 0 ? ids.length - 1 : math.max(0, k - 1);
    } else if (key == LogicalKeyboardKey.home) {
      k = 0;
    } else if (key == LogicalKeyboardKey.end) {
      k = ids.length - 1;
    } else if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter || key == LogicalKeyboardKey.space) {
      final hit = core.tip(_focusIndex);
      if (hit != null) widget.onTap?.call(PointEvent(hit));
      return KeyEventResult.handled;
    } else if (key == LogicalKeyboardKey.escape) {
      _focusIndex = -1;
      _setHover(-1);
      _hideTip();
      return KeyEventResult.handled;
    } else {
      return KeyEventResult.ignored;
    }
    _focusIndex = ids[k];
    _setHover(_focusIndex);
    final hit = _showTip(_anchor(_focusIndex));
    if (hit != null) setState(() => _announce = '${hit.title}: ${hit.rows.map((r) => '${r.name} ${r.value}').join(', ')}');
    return KeyEventResult.handled;
  }

  void _onFocusChange(bool focused) {
    if (focused) return;
    _focusIndex = -1;
    if (_pointer == null) {
      _setHover(-1);
      _hideTip();
    }
  }

  Offset _anchor(int id) {
    final (x, y) = core.anchor(id);
    return Offset(x, y);
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────────────────────

  Hit? _showTip(Offset at) {
    final tooltip = core.opts['tooltip'], hit = core.tip(core.hover);
    _lastTipAt = at;
    if (hit == null || tooltip == false) {
      _hideTip();
      return hit;
    }
    final custom = tooltip is Function ? Function.apply(tooltip, [PointEvent(hit)]) : null;
    _tip.value = (hit: hit, at: at, custom: custom, on: true);
    return hit;
  }

  void _refreshTip() {
    final t = _tip.value, at = _lastTipAt;
    if (core.hover >= 0 && at != null && t != null && t.on) _showTip(_pointer ?? at);
  }

  void _hideTip() {
    final t = _tip.value;
    if (t != null && t.on) _tip.value = (hit: t.hit, at: t.at, custom: t.custom, on: false);
  }

  // ── Groups ──────────────────────────────────────────────────────────────────────────────

  void _joinGroup() {
    final g = core.opts['group'];
    if (g is String) _groups.putIfAbsent(g, () => {}).add(this);
  }

  void _leaveGroup(String? g) {
    if (g == null) return;
    final set = _groups[g];
    set?.remove(this);
    if (set != null && set.isEmpty) _groups.remove(g);
  }

  void _eachInGroup(void Function(_CraggyChartState<dynamic> c) fn) {
    final g = core.opts['group'];
    if (g is! String) return;
    for (final c in [...?_groups[g]]) {
      if (!identical(c, this)) fn(c);
    }
  }

  // ── Build ───────────────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final o = core.opts, th = core.theme, items = core.legend();
    final lg = o['legend'];
    final show = lg == false
        ? false
        : lg != null && lg != 'auto'
        ? items.isNotEmpty
        : items.length > 1;
    final pos = lg is String && lg != 'auto' ? lg : 'top';
    final legend = show
        ? ChartLegend(theme: th, items: items, vertical: pos == 'right', onToggle: _legendToggle, onIsolate: _isolate, onFocus: _legendFocus)
        : null;
    final title = o['title'] as String?, subtitle = o['subtitle'] as String?;
    final body = Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(child: _plot()),
        if (legend != null && pos == 'right') legend,
      ],
    );
    final column = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (title != null || subtitle != null) ChartHeader(theme: th, title: title, subtitle: subtitle),
        if (legend != null && pos != 'right' && pos != 'bottom') legend,
        Expanded(child: body),
        if (legend != null && pos == 'bottom') legend,
        // The keyboard read-out for screen readers (the JS aria-live region).
        Semantics(liveRegion: true, label: _announce, child: const SizedBox.shrink()),
      ],
    );
    return LayoutBuilder(
      builder: (context, c) {
        final h = widget.height ?? (c.hasBoundedHeight ? c.maxHeight : defaultHeight(core.type));
        return DefaultTextStyle(
          style: chartText(rgbColor(th.text), 10),
          child: Container(width: c.hasBoundedWidth ? c.maxWidth : null, height: h, color: rgbColor(th.bg), child: column),
        );
      },
    );
  }

  Widget _plot() {
    final duration = core.still ? Duration.zero : const Duration(milliseconds: 120);
    return Focus(
      focusNode: _focus,
      onKeyEvent: _onKey,
      onFocusChange: _onFocusChange,
      child: MouseRegion(
        onExit: (e) => _onLeave(),
        child: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerHover: _onMove,
          onPointerMove: _onMove,
          onPointerDown: _onDown,
          onPointerUp: _onUp,
          onPointerCancel: _onCancel,
          onPointerSignal: _onSignal,
          onPointerPanZoomStart: _onPanZoomStart,
          onPointerPanZoomUpdate: _onPanZoomUpdate,
          child: LayoutBuilder(
            builder: (context, c) {
              final s = c.biggest;
              if (s.width > 0 && s.height > 0) {
                final had = core.grid;
                core.setSize(s.width, s.height);
                if (!identical(had, core.grid)) _wake();
              }
              // Labelled after sizing, so the summary includes the laid-out value range.
              return Semantics(
                label: core.summary(),
                image: true,
                child: Stack(
                  clipBehavior: Clip.hardEdge,
                  children: [
                    Positioned.fill(
                      child: RepaintBoundary(child: CustomPaint(painter: _painter)),
                    ),
                    Positioned.fill(
                      child: IgnorePointer(
                        child: ValueListenableBuilder<_Tip?>(
                          valueListenable: _tip,
                          builder: (context, t, _) => t == null
                              ? const SizedBox.shrink()
                              : AnimatedOpacity(
                                  opacity: t.on ? 1 : 0,
                                  duration: duration,
                                  child: CustomSingleChildLayout(
                                    delegate: TooltipPlacement(t.at),
                                    child: ExcludeSemantics(
                                      child: TooltipCard(theme: core.theme, hit: t.hit, custom: t.custom),
                                    ),
                                  ),
                                ),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
