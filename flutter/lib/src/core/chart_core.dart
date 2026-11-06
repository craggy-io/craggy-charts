// ChartCore: the headless engine. Options + data in; a tile field, labels and hit testing out.
// No Flutter: it runs the same in tests, in the conformance suite and under the widget, and it
// mirrors the TypeScript core line for line.
import 'dart:math' as math;
import 'dart:typed_data';

import '../generated/options.g.dart';
import 'data.dart';
import 'field.dart';
import 'format.dart';
import 'model_types.dart';
import 'registry.dart';
import 'theme.dart';
import 'ticks.dart';
import 'tween.dart';
import 'types.dart';
import 'util.dart';

/// At most about 2000 evenly spaced items, for measuring labels of huge series.
List<T> _sample<T>(List<T> a) {
  if (a.length <= 2000) return a;
  final every = (a.length / 2000).ceil();
  return [for (var i = 0; i < a.length; i += every) a[i]];
}

/// One part of a chart: the main type, series drawn as another type, or a layer.
class Part {
  Part(this.def, this.opts, this.rows);
  final ChartTypeDef def;
  final Map<String, dynamic> opts;
  final List<Row> rows;
  Model model = {};
  Fixed? fixed;
  Model? shown;
  List<String>? keys;
  final Map<String, (Map<String, dynamic>, Object?)> derived = {};
}

class Domain {
  Domain(this.ticks, this.log);
  final Ticks ticks;
  final bool log;
}

class _Acc {
  double lo = double.infinity, hi = double.negativeInfinity;
  bool zero = false, pad = false, percent = false;
}

/// Data x range per xs list (rebuilt with the model, so identity is a safe key).
final _dataRanges = Expando<(double, double)>();

/// One fixed-rate spring step for every tile (size towards coverage, colour towards target).
/// Returns true while moving.
bool _stepSprings(Float32List size, Float32List vel, Float32List col, Float32List glow, Float32List tc, Float32List tcol, int steps) {
  final sp = Tokens.springs;
  final kk = (sp['stiffness'] as num).toDouble(), dd = (sp['damping'] as num).toDouble();
  final ck = 1 - math.pow(1 - (sp['colour'] as num), steps), gk = math.pow(0.9, steps);
  var moving = false;
  for (var i = 0, n = tc.length; i < n; i++) {
    final t = tc[i], j = i * 3;
    double s = size[i], v = vel[i];
    // Settled tiles were snapped exactly onto their target, so they cost three compares.
    if (s == t && v == 0 && glow[i] == 0 && (t == 0 || (col[j] == tcol[j] && col[j + 1] == tcol[j + 1] && col[j + 2] == tcol[j + 2]))) continue;
    for (var k = 0; k < steps; k++) {
      v = (v + (t - s) * kk) * dd;
      s += v;
    }
    if (v.abs() > 1e-3 || (t - s).abs() > 3e-3) {
      moving = true;
    } else {
      s = t; // close enough: land exactly so the tile goes idle
      v = 0;
    }
    size[i] = s;
    vel[i] = v;
    if (t > 0) {
      final q = s < 0.05 ? 1 : ck;
      col[j] += (tcol[j] - col[j]) * q;
      col[j + 1] += (tcol[j + 1] - col[j + 1]) * q;
      col[j + 2] += (tcol[j + 2] - col[j + 2]) * q;
      if ((tcol[j] - col[j]).abs() + (tcol[j + 1] - col[j + 1]).abs() + (tcol[j + 2] - col[j + 2]).abs() > 3) {
        moving = true;
      } else {
        col[j] = tcol[j];
        col[j + 1] = tcol[j + 1];
        col[j + 2] = tcol[j + 2];
      }
    }
    if (glow[i] > 0.01) {
      glow[i] *= gk;
      moving = true;
    } else {
      glow[i] = 0;
    }
  }
  return moving;
}

/// Rows that have no shown position yet (new, or first build) start at their target position, so
/// they grow in place instead of sliding in from x = 0.
void _seedPositions(Model shown, Model model, bool fresh) {
  final t = model['px'], s = shown['px'];
  if (t is! List) return;
  if (fresh || s is! List) {
    shown['px'] = List<dynamic>.of(t);
    return;
  }
  for (var i = 0; i < t.length; i++) {
    if (s[i] is! num) s[i] = t[i];
  }
}

/// Environment the core runs in.
class CoreEnv {
  CoreEnv({this.prefersLight = false, this.reducedMotion = false});
  bool prefersLight;
  bool reducedMotion;
}

/// A legend entry.
typedef LegendEntry = ({String name, RGB color, bool hidden});

/// A brushed or zoomed x range: data values at its ends and their row indices.
typedef Selection = ({Object? from, Object? to, (int, int) indices});

class ChartCore {
  ChartCore(Map<String, dynamic> options, [CoreEnv? env]) : env = env ?? CoreEnv() {
    update(options);
  }

  Map<String, dynamic> opts = {};
  List<Row> rows = [];
  List<Part> parts = [];
  late ChartTheme theme;
  Fmt format = compact;
  final Set<String> hidden = {};
  int hover = -1;

  /// Highlighted series or category: every other one is dimmed.
  String? focus;
  Grid? grid;
  Field? field;
  final Out out = Out();
  // tile springs
  Float32List size = Float32List(0), vel = Float32List(0), col = Float32List(0), glow = Float32List(0);
  // live data
  double off = 0;
  int dropped = 0;
  double pushEvery = 1, lastPush = 0;

  /// Bumped whenever positions, domains, the view or the grid change; types cache geometry by it.
  int _version = 0;

  /// Time of the first frame; NaN until then.
  double born = double.nan;
  // axes
  Domain? domLeft, domRight;
  Map<String, dynamic> domS = {};
  List<double> view = [0, 1], viewY = [0, 1];
  List<dynamic> viewS = [0.0, 1.0, 0.0, 1.0];
  (double, double)? brush;
  final Map<String, RGB> colors = {};
  final CoreEnv env;
  Raster? _g;
  bool _needsLayout = true;

  Part get primary => parts.firstWhere((p) => p.def.kind == 'cartesian', orElse: () => parts[0]);
  String get type => opts['type'] as String;
  String get kind => typeDef(type).kind;
  bool get cartesian => kind == 'cartesian';
  bool get horizontal => truthy(opts['horizontal']) && cartesian;
  bool get live => truthy(opts['window']);
  double get cellSize {
    final c = opts['cell'] ?? 'normal';
    final v = c is String ? Tokens.cells[c] : c;
    if (!(v is num && v > 0)) throw ArgumentError("craggy-charts: cell must be 'fine', 'normal', 'chunky' or a positive number");
    return v.toDouble();
  }

  // ── Options and data ──────────────────────────────────────────────────────────────────

  void update(Map<String, dynamic> next0) {
    final next = next0['type'] is ChartType ? {...next0, 'type': chartTypeNames[next0['type']]} : next0;
    final prevType = opts['type'];
    const layoutKeys = ['type', 'cell', 'horizontal', 'axes', 'layers', 'series', 'yAxis', 'xAxis', 'theme'];
    if (layoutKeys.any(next.containsKey)) _needsLayout = true;
    opts = {...opts, ...next};
    if (!truthy(opts['type'])) throw ArgumentError('craggy-charts: options.type is required');
    if (next.containsKey('data')) rows = rowsOf(next['data']);
    theme = resolveTheme(opts['theme'], env.prefersLight);
    format = makeFormat(opts['format']);
    _memo.clear();
    if (prevType != null && prevType != opts['type']) {
      for (final p in parts) {
        p.shown = null;
      }
      hover = -1;
      view = [0, 1];
    }
    if (next.containsKey('series')) {
      for (final e in mapOf(next['series']).entries) {
        if (e.value is Map && truthy((e.value as Map)['hidden'])) hidden.add(e.key);
      }
    }
    rebuild();
  }

  /// Append rows. With `window`, the oldest rows scroll off the left edge at constant speed.
  void push(List<Object?> newRows, double now) {
    if (lastPush > 0) pushEvery = pushEvery * 0.6 + clamp((now - lastPush) / 1000, 0.05, 5) * 0.4;
    lastPush = now;
    for (final r in newRows) {
      rows.add(r is num ? <String, dynamic>{'value': r} : mapOf(r));
      if (live) off += 1;
      if (live && rows.length > (opts['window'] as num)) {
        rows.removeAt(0);
        dropped++;
      }
    }
    rebuild();
  }

  /// Replace (merge into) the newest row, e.g. a live tick inside the current candle.
  void patch(Row row) {
    if (rows.isEmpty) return push([row], 0);
    rows[rows.length - 1] = {...rows[rows.length - 1], ...row};
    rebuild();
  }

  /// Highlight one series or category (null clears).
  void setFocus(String? name) {
    if (name == focus) return;
    focus = name;
    rebuild();
  }

  void toggle(String name) {
    if (!hidden.remove(name)) hidden.add(name);
    rebuild();
  }

  bool setHover(int id) {
    if (id == hover) return false;
    hover = id;
    if (parts.any((p) => p.def.hoverModel)) rebuild();
    return true;
  }

  // Split options into parts: the main chart, series drawn as another type, and explicit layers.
  List<Part> _splitParts() {
    final o = opts, base = {...o}..remove('layers');
    final out = <Part>[];
    final overrides = [
      for (final e in mapOf(o['series']).entries)
        if (e.value is Map && truthy((e.value as Map)['type']) && (e.value as Map)['type'] != o['type']) e,
    ];
    if (overrides.isNotEmpty && typeDef(type).kind == 'cartesian') {
      final names = wide(rows, o)['names'] as List<String>;
      final moved = {for (final e in overrides) e.key};
      out.add(Part(typeDef(type), {...base, 'y': [for (final n in names) if (!moved.contains(n)) n]}, rows));
      final byType = <String, List<String>>{};
      for (final e in overrides) {
        (byType[(e.value as Map)['type'] as String] ??= []).add(e.key);
      }
      for (final e in byType.entries) {
        out.add(Part(typeDef(e.key), {...base, 'type': e.key, 'y': e.value, 'stack': false}, rows));
      }
    } else {
      out.add(Part(typeDef(type), base, rows));
    }
    for (final layer0 in (o['layers'] as List?) ?? const []) {
      final layer = mapOf(layer0);
      final lo = {...base, 'stack': false, ...layer};
      out.add(Part(typeDef((truthy(lo['type']) ? lo['type'] : o['type']) as String), lo, truthy(layer['data']) ? rowsOf(layer['data']) : rows));
    }
    return out;
  }

  void rebuild() {
    _version++;
    final specs = _splitParts();
    final prev = parts;
    var reuse = prev.length == specs.length;
    for (var i = 0; reuse && i < prev.length; i++) {
      reuse = identical(prev[i].def, specs[i].def);
    }
    colors.clear();
    for (var i = 0; i < specs.length; i++) {
      if (reuse) {
        specs[i].shown = prev[i].shown;
        specs[i].keys = prev[i].keys;
      }
    }
    // Colours are assigned across all parts so a combo's series never share a colour.
    var k = 0;
    for (final p in specs) {
      final built = p.def.model(ctx(p));
      p.model = built.model;
      p.fixed = built.fixed;
      // colorNames: every name that takes a palette colour (range's band is drawn but is not a series).
      final names = p.fixed!['colorNames'] ?? p.fixed!['names'];
      if (names is List) {
        for (final n in names) {
          if (!colors.containsKey(n)) colors[n as String] = _colorFor(n, k++);
        }
      }
    }
    if (focus != null && colors.containsKey(focus)) {
      for (final n in colors.keys.toList()) {
        if (n != focus) colors[n] = mix(colors[n]!, theme.fade, 0.68);
      }
    }
    for (final p in specs) {
      final built = p.def.model(ctx(p)); // second pass now that colours are fixed
      p.model = built.model;
      p.fixed = built.fixed;
      final keys = p.def.keys?.call(p.fixed!);
      if (p.shown != null && p.def.keyed != null && keys != null && p.keys != null) remap(p.shown!, p.def.keyed!, p.keys, keys);
      p.keys = keys;
      final fresh = p.shown == null;
      if (fresh) {
        p.shown = zero(p.model) as Model;
        p.def.seed?.call(p.shown!, p.model);
      }
      _seedPositions(p.shown!, p.model, fresh);
    }
    parts = specs;
    if (_needsLayout && grid != null) {
      _layout(grid!.w, grid!.h);
    } else {
      _domains();
    }
  }

  RGB _colorFor(String name, int i) {
    final c = opts['colors'], s = mapOf(opts['series']);
    final sn = s[name];
    final v = (sn is Map && truthy(sn['color']) ? sn['color'] : null) ?? (c is List ? (i < c.length ? c[i] : null) : c is Map ? c[name] : null);
    return truthy(v) ? hex(v as String) : theme.palette[i % theme.palette.length];
  }

  // ── Layout ────────────────────────────────────────────────────────────────────────────

  void setSize(double w, double h) {
    final g = grid;
    if (g != null && g.w == w && g.h == h && !_needsLayout) return;
    _layout(w, h);
  }

  int _widest(Domain? d) => d == null ? 0 : maxOf(d.ticks.ticks.map((t) => _tickText(t, d).length), 0).toInt();

  void _layout(double w, double h) {
    _version++;
    _needsLayout = false;
    final cell = cellSize, o = opts, axes = o['axes'] != false;
    final xAxis = mapOf(o['xAxis']), yAxis = mapOf(o['yAxis']);
    double ml, mr, mt, mb;
    if (!cartesian) {
      final d = parts[0].def;
      final m = d.margin != null ? d.margin!(_ctxFor(parts[0], Grid(w: w, h: h, cell: cell, cols: 1, rows: 1, ox: 0, oy: 0))) : const Margin(4, 4, 4, 4);
      (ml, mr, mt, mb) = (m.l, m.r, m.t, m.b);
    } else if (!axes) {
      (ml, mr, mt, mb) = (1, 1, 1, 1);
    } else {
      final hz = horizontal;
      (ml, mr, mt, mb) = (0, 8, 8, 20 + (truthy(xAxis['label']) ? 16 : 0));
      // Provisional grid so the domain (and so the label widths) can be known.
      grid = Grid(w: w, h: h, cell: cell, cols: math.max(1, ((w - 48) / cell).floor()), rows: math.max(1, ((h - mt - mb) / cell).floor()), ox: 40, oy: mt);
      _domains();
      if (hz) {
        final pf = primary.def.xinfo?.call(primary.fixed!);
        final longest = pf != null ? maxOf(_sample(pf.labels).map((l) => math.min(12, labelText(l).length)), 0) : 4;
        ml = maxD(24, longest * charW + 14);
        mr = o['labels'] != false ? 46 : 10;
      } else {
        ml = maxD(24, _widest(domLeft) * charW + 14) + (truthy(yAxis['label']) ? 16 : 0);
        mr = domRight != null ? _widest(domRight) * charW + 16 : 10;
      }
    }
    final cols = math.max(1, ((w - ml - mr) / cell).floor()), rows = math.max(1, ((h - mt - mb) / cell).floor());
    final centred = !cartesian;
    final ox = ml + ((w - ml - mr) - cols * cell) * (centred ? 0.5 : 0);
    final oy = mt + ((h - mt - mb) - rows * cell) * (centred ? 0.5 : 1);
    grid = Grid(w: w, h: h, cell: cell, cols: cols, rows: rows, ox: ox, oy: oy);
    if (field == null || field!.cols != cols || field!.rows != rows) {
      final n = cols * rows;
      field = Field(cols, rows);
      size = Float32List(n);
      vel = Float32List(n);
      col = Float32List(n * 3);
      glow = Float32List(n);
    }
    _g = Raster(field!, cell);
    _domains();
  }

  // ── Axes ──────────────────────────────────────────────────────────────────────────────

  final Map<String, String> _memo = {};

  /// Label text, memoised: labels are re-laid out every frame while a chart moves.
  String _memoText(String key, String Function() make) {
    var s = _memo[key];
    if (s == null) {
      s = make();
      if (_memo.length > 2048) _memo.clear();
      _memo[key] = s;
    }
    return s;
  }

  String _tickText(double t, Domain d) => _memoText('${d.log ? 'L' : 'Y'}${jsNum(t)}', () {
        final ya = mapOf(opts['yAxis']);
        final f = truthy(ya['format']) ? makeFormat(ya['format']) : format;
        return d.log ? f(math.pow(10, t)) : f(t);
      });

  /// Index or x-value visibility under the current zoom, for auto-scaling the value axis.
  bool inView(int i) {
    if (view[0] <= 0 && view[1] >= 1) return true;
    final p = primary, xi = p.def.xinfo?.call(p.fixed!);
    if (xi == null) return true;
    final n = xi.labels.length, cont = xi.kind != 'category' && !live && !parts.any((q) => q.def.band);
    double u;
    if (cont) {
      final (a, b) = _xRange(xi);
      u = (xi.xs[i] - a) / jsOr(b - a, 1);
    } else {
      u = n < 2 ? 0.5 : i / (n - 1);
    }
    final pad = 1 / math.max(1, n);
    return u >= view[0] - pad && u <= view[1] + pad;
  }

  (double, double) _xRange(XInfo xi) {
    var r = _dataRanges[xi.xs];
    if (r == null) {
      var a = double.infinity, b = double.negativeInfinity;
      for (final v in xi.xs) {
        if (v.isFinite) {
          if (v < a) a = v;
          if (v > b) b = v;
        }
      }
      if (!a.isFinite) {
        r = (0, 1);
      } else if (xi.kind == 'number') {
        final t = niceTicks(a, b, 5);
        r = (t.min, t.max);
      } else {
        r = (a, b);
      }
      _dataRanges[xi.xs] = r;
    }
    final ax = mapOf(opts['xAxis']);
    return (ax['min'] != null ? dbl(ax['min']) : r.$1, ax['max'] != null ? dbl(ax['max']) : r.$2);
  }

  void _domains() {
    domLeft = null;
    domRight = null;
    final g = grid;
    if (!cartesian || g == null) return;
    final ya = mapOf(opts['yAxis']);
    final acc = <String, _Acc>{};
    for (final p in parts) {
      if (p.def.kind != 'cartesian' || p.def.extents == null) continue;
      for (final e in p.def.extents!(ctx(p), p.fixed!)) {
        if (!e.lo.isFinite || !e.hi.isFinite) continue;
        final a = acc[e.side] ??= _Acc();
        a.lo = minD(a.lo, e.lo);
        a.hi = maxD(a.hi, e.hi);
        a.zero |= e.zero;
        a.pad |= e.pad;
        a.percent |= e.percent;
      }
    }
    final v = horizontal ? g.cols : g.rows;
    final count = ya['ticks'] != null ? dbl(ya['ticks']) : maxD(2, jsRound((v * g.cell) / (horizontal ? 90 : 48)));
    for (final side in const ['left', 'right']) {
      final a = acc[side];
      if (a == null) continue;
      var lo = a.lo, hi = a.hi;
      if (a.percent) {
        lo = 0;
        hi = 100;
      }
      final yMin = ya['min'] != null ? dbl(ya['min']) : null, yMax = ya['max'] != null ? dbl(ya['max']) : null;
      Domain dom;
      if (truthy(ya['log']) && side == 'left') {
        lo = log10(maxD(1e-12, lo > 0 ? lo : minD(1, hi)));
        hi = log10(maxD(1e-12, hi));
        if (yMin != null) lo = log10(yMin);
        if (yMax != null) hi = log10(yMax);
        dom = Domain(logTicks(lo, hi), true);
      } else {
        if (a.zero) {
          lo = minD(0, lo);
          hi = maxD(0, hi);
        }
        if (a.pad && !a.percent) {
          final p1 = (hi - lo) * 0.08, p2 = hi.abs() * 0.1;
          final p = truthy(p1) ? p1 : truthy(p2) ? p2 : 1.0;
          if (!(a.zero && lo == 0)) lo -= p;
          hi += p * 0.75;
        }
        if (side == 'left') {
          if (yMin != null) lo = yMin;
          if (yMax != null) hi = yMax;
        }
        final t = niceTicks(lo, hi, count);
        if (side == 'left' && yMin != null) t.min = yMin;
        if (side == 'left' && yMax != null) t.max = yMax;
        dom = Domain(t, false);
      }
      if (side == 'left') {
        domLeft = dom;
      } else {
        domRight = dom;
      }
    }
    domLeft ??= domRight;
  }

  // ── Contexts ──────────────────────────────────────────────────────────────────────────

  Ctx ctx(Part p) => _ctxFor(p, grid ?? Grid(w: 300, h: 150, cell: cellSize, cols: 40, rows: 20, ox: 0, oy: 0));

  Ctx _ctxFor(Part p, Grid grid) {
    final o = p.opts, hz = horizontal;
    final l = hz ? grid.rows : grid.cols, vv = hz ? grid.cols : grid.rows;
    final v0 = dbl(viewS[0]), v1 = dbl(viewS[1]), w0 = dbl(viewS[2]), w1 = dbl(viewS[3]);
    final span = jsOr(v1 - v0, 1), yspan = jsOr(w1 - w0, 1);
    double Function(num v) x = (v) => v.toDouble();
    var band = 1.0;
    double Function(Model m, int i) xAt = (_, i) => x(i);
    final prim = parts.isEmpty ? null : primary;
    final xi = prim != null && prim.fixed != null && prim.def.xinfo != null ? prim.def.xinfo!(prim.fixed!) : null;
    if (cartesian && xi != null) {
      final n = math.max(1, xi.labels.length), win = opts['window'], bandMode = parts.any((q) => q.def.band);
      double pos(Model m, int i, num Function(int i) dflt) {
        final px = m['px'];
        return x(px is List ? (i < px.length ? dbl(px[i]) : double.nan) : dflt(i));
      }

      if (truthy(win)) {
        final w = (win as num).toDouble();
        // w - 1 slots are visible; the oldest row is half-way out on the left, the newest is in the last slot.
        if (bandMode) {
          final bw = 1 / (w - 1);
          x = (i) => (((i - n + w - 1.5 + off) * bw - v0) / span) * l;
          band = (l * bw) / span;
        } else {
          x = (i) => 0.5 + (((i - n + w - 2 + off) / (w - 2) - v0) / span) * (l - 1);
          band = (l - 1) / (w - 2) / span;
        }
      } else if (xi.kind != 'category' && !bandMode) {
        final (a, b) = _xRange(xi);
        final ab = jsOr(b - a, 1);
        x = (v) => 0.5 + (((v - a) / ab - v0) / span) * (l - 1);
        band = (l - 1) / math.max(1, n - 1) / span;
        xAt = (m, i) => pos(m, i, (i) => xi.xs[i]);
      } else if (bandMode) {
        x = (i) => (((i + 0.5) / n - v0) / span) * l;
        band = l / n / span;
        xAt = (m, i) => pos(m, i, (i) => i);
      } else {
        x = (i) => 0.5 + (((n < 2 ? 0.5 : i / (n - 1)) - v0) / span) * (l - 1);
        band = (l - 1) / math.max(1, n - 1) / span;
        xAt = (m, i) => pos(m, i, (i) => i);
      }
      if (truthy(win)) xAt = (_, i) => x(i);
    }
    double y(num v, [String side = 'left']) {
      final d = (side == 'right' ? domRight : domLeft) ?? domLeft;
      if (d == null) return 0;
      final key = side == 'right' && domRight != null ? 'r' : 'l';
      final lo = dbl(domS['${key}0']), hi = dbl(domS['${key}1']);
      final t = d.log ? log10(maxD(1e-12, v)) : v.toDouble();
      return (((t - lo) / jsOr(hi - lo, 1) - w0) / yspan) * vv;
    }

    return Ctx(
      opts: o,
      rows: p.rows,
      theme: theme,
      format: makeFormat(o['format']),
      hidden: hidden,
      hover: hover,
      grid: grid,
      out: out,
      colorOf: (name, i) => colors[name] ?? theme.palette[i % theme.palette.length],
      x: (v) => x(v),
      xAt: (m, i) => xAt(m, i),
      band: band,
      y: y,
      v: vv,
      horizontal: hz,
      inView: inView,
      version: _version,
      derive: <T>(String key, Map<String, dynamic> o, T Function() make) {
        final hit = p.derived[key];
        if (hit != null && identical(hit.$1, o)) return hit.$2 as T;
        final v = make();
        p.derived[key] = (o, v);
        return v;
      },
    );
  }

  // ── Frame ─────────────────────────────────────────────────────────────────────────────

  bool get still => opts['animate'] == false || env.reducedMotion;

  /// Advance one frame. Returns true while anything is still moving.
  bool frame(double now, double dt) {
    if (grid == null || field == null || _g == null) return false;
    final still = this.still;
    final anim = opts['animate'];
    final speed = anim is Map && truthy(anim['speed']) ? dbl(anim['speed']) : 1.0;
    final k = still ? 1.0 : 1 - math.exp(-dt * 7 * speed);
    final st = TweenState(seedPrev: live);
    for (final p in parts) {
      p.shown = approach(p.shown, p.model, k, st) as Model;
    }
    final target = _domTarget();
    for (final key in target.keys) {
      if (!domS.containsKey(key)) domS[key] = target[key]; // first frame: no axis zoom-in
    }
    domS = approach(domS, target, k, st) as Map<String, dynamic>;
    viewS = approach(viewS, [view[0], view[1], viewY[0], viewY[1]], still ? 1 : 1 - math.exp(-dt * 14), st) as List<dynamic>;
    if (off > 0) {
      off = still ? 0 : maxD(0, off - (dt * (1 + maxD(0, off - 1) * 2)) / pushEvery);
      st.active = true;
    }
    if (st.active) _version++;
    if (born.isNaN) born = now;
    final animating = _paint(now);
    final reveal = still ? 1.0 : clamp((now - born) / 1100);
    if (reveal < 1) {
      _mask(ease(reveal) * 1.25);
      st.active = true;
    }
    final moving = _springs(dt, still);
    return st.active || moving || animating;
  }

  /// Jump straight to the final state (tests, conformance, export, reduced motion).
  void settle([double now = 0]) {
    if (grid == null || field == null) return;
    _version++;
    for (final p in parts) {
      p.shown = clone(p.model) as Model;
    }
    domS = _domTarget();
    viewS = [view[0], view[1], viewY[0], viewY[1]];
    off = 0;
    born = double.negativeInfinity; // entrance already complete
    _paint(now);
    size.setAll(0, field!.cov);
    vel.fillRange(0, vel.length, 0);
    col.setAll(0, field!.col);
    glow.fillRange(0, glow.length, 0);
  }

  Map<String, dynamic> _domTarget() => {
        if (domLeft != null) 'l0': domLeft!.ticks.min,
        if (domLeft != null) 'l1': domLeft!.ticks.max,
        if (domRight != null) 'r0': domRight!.ticks.min,
        if (domRight != null) 'r1': domRight!.ticks.max,
      };

  /// Rasterise every part (and axes, annotations, crosshair, brush) into the field.
  bool _paint(double now) {
    final f = field!, g = _g!;
    f.clear();
    out.clear();
    var animating = false;
    final ctxs = [for (final p in parts) ctx(p)], pctx = ctxs[parts.indexOf(primary)];
    if (cartesian) _drawAxes(g, pctx);
    final pulse = live && lastPush > 0 && now - lastPush < 4000 * pushEvery;
    for (var i = 0; i < parts.length; i++) {
      final p = parts[i], c = ctxs[i];
      c.now = now;
      c.live = pulse;
      g.pattern = 'solid';
      p.def.raster(c, p.shown!, p.fixed!, g);
      g.pattern = 'solid';
      animating = animating || c.animating;
    }
    if (cartesian) _drawAnnotations(g, true, pctx);
    if (brush != null) _drawBrush();
    return animating;
  }

  void _drawAxes(Raster g, Ctx ctx) {
    final o = opts, grid = this.grid!, th = theme, hz = horizontal;
    final axes = o['axes'] != false;
    _drawAnnotations(g, false, ctx);
    for (final side in const ['left', 'right']) {
      final d = side == 'left' ? domLeft : domRight;
      if (d == null || !axes || (side == 'right' && identical(d, domLeft))) continue;
      final len = hz ? grid.cols : grid.rows;
      for (final t in d.ticks.ticks) {
        final p = ctx.y(d.log ? math.pow(10, t) : t, side);
        if (!(p >= -0.01 && p <= len + 0.01)) continue;
        final at = math.min(len - 1, p.floor());
        final text = _tickText(t, d);
        if (hz) {
          g.vline(at, th.grid, 0.2);
          out.labelsX.add(LabelX(grid.ox + (at + 0.5) * grid.cell, text));
        } else {
          if (side == 'left') g.hline(at, th.grid, 0.2);
          out.labelsY.add(LabelY(grid.oy + (grid.rows - at - 0.5) * grid.cell, text, side));
        }
      }
    }
    // Crosshair under the data.
    final prim = primary;
    if (hover >= 0 && !prim.def.freePick && prim.fixed != null && hover < (prim.def.xinfo?.call(prim.fixed!).labels.length ?? 0)) {
      final x = ctx.xAt(prim.shown!, hover).floor();
      if (hz) {
        g.hline(grid.rows - 1 - x, th.grid, 0.45);
      } else {
        g.vline(x, th.grid, 0.45);
      }
    }
    if (!axes) return;
    final xi = prim.def.xinfo?.call(prim.fixed!);
    if (xi == null || xi.labels.isEmpty) return;
    final xAxis = mapOf(o['xAxis']), yAxis = mapOf(o['yAxis']);
    final n = xi.labels.length, l = hz ? grid.rows : grid.cols;
    final cont = xi.kind != 'category' && !live && !parts.any((q) => q.def.band);
    if (prim.def.xGrid || cont) {
      final (a, b) = _xRange(xi);
      final v0 = dbl(viewS[0]), v1 = dbl(viewS[1]);
      final lo = a + (b - a) * v0, hi = a + (b - a) * v1;
      final ticks = xi.kind == 'time'
          ? timeTicks(lo, hi, maxD(2, jsRound((l * grid.cell) / 110)))
          : niceTicks(lo, hi, maxD(2, jsRound((l * grid.cell) / 80))).ticks;
      final Fmt fx = truthy(xAxis['format']) ? makeFormat(xAxis['format']) : xi.kind == 'time' ? (t) => timeLabel(t, hi - lo) : format;
      var last = double.negativeInfinity;
      for (final t in ticks) {
        final x = ctx.x(t);
        if (x < 0 || x > l) continue;
        if (prim.def.xGrid) g.vline(math.min(l - 1, floorI(x)), th.grid, 0.16);
        final px = grid.ox + x * grid.cell, text = _memoText('X${xi.kind}${jsNum(hi - lo)}:${jsNum(t)}', () => fx(t)), half = (text.length * charW) / 2;
        if (px - half < last + 8 || px + half > grid.w || px - half < 0) continue;
        out.labelsX.add(LabelX(px, text));
        last = px + half;
      }
    } else {
      final sp = ctx.band.abs() * grid.cell, spacing = truthy(sp) ? sp : 1e9;
      String short(Object? lb) => _memoText('C${lb is num ? jsNum(lb) : jsString(lb)}', () {
            final s = labelText(lb);
            return s.length > 12 ? '${s.substring(0, 11)}…' : s;
          });
      final widest = maxOf(_sample(xi.labels).map((lb) => short(lb).length), 1) * charW + 12;
      final stride = hz ? math.max(1, (14 / spacing).ceil()) : math.max(1, (widest / spacing).ceil());
      for (var i = 0; i < n; i++) {
        if ((i + dropped) % stride != 0) continue;
        final pos = ctx.xAt(prim.shown!, i), text = short(xi.labels[i]);
        if (hz) {
          if (pos < -0.5 || pos > l + 0.5) continue;
          out.labelsY.add(LabelY(grid.oy + pos * grid.cell, text, 'left'));
        } else {
          final px = grid.ox + pos * grid.cell, half = (text.length * charW) / 2;
          if (pos < -0.5 || pos > l + 0.5 || px + half > grid.w || px - half < 0) continue;
          out.labelsX.add(LabelX(px, text));
        }
      }
    }
    if (truthy(xAxis['label'])) {
      out.texts.add(TextItem(x: grid.ox + (grid.cols * grid.cell) / 2, y: grid.h - 6, text: jsString(xAxis['label']), baseline: 'bottom'));
    }
    if (truthy(yAxis['label'])) {
      out.texts.add(TextItem(x: 8, y: grid.oy + (grid.rows * grid.cell) / 2, text: jsString(yAxis['label']), rotate: -90));
    }
  }

  void _drawAnnotations(Raster g, bool lines, Ctx ctx) {
    final list = (opts['annotations'] as List?) ?? const [];
    if (list.isEmpty) return;
    final grid = this.grid!, th = theme, hz = horizontal;
    final prim = primary, xi = prim.def.xinfo?.call(prim.fixed!);
    double xOf(Object? v) {
      if (xi == null) return double.nan;
      if (v is num && xi.kind != 'category') return ctx.x(v);
      if (xi.kind == 'time' && !live) return ctx.x(toTime(v));
      final i = xi.labels.indexWhere((l) => l == v || labelText(l) == jsString(v));
      return i < 0 ? double.nan : ctx.xAt(prim.shown!, i);
    }

    for (final a0 in list) {
      final a = mapOf(a0);
      final rgb = truthy(a['color']) ? hex(a['color'] as String) : th.palette[0];
      final vv = hz ? grid.cols : grid.rows, l = hz ? grid.rows : grid.cols;
      final label = truthy(a['label']) ? jsString(a['label']) : null;
      if (a['y'] != null && lines) {
        final py = ctx.y(dbl(a['y']));
        if (py.isNaN) continue;
        final p = math.min(vv - 1, floorI(py));
        if (p < 0) continue;
        if (hz) {
          g.vline(p, rgb, 0.55);
        } else {
          g.hline(p, rgb, 0.55);
        }
        if (label != null) {
          out.texts.add(hz
              ? TextItem(x: grid.ox + (p + 0.5) * grid.cell + 4, y: grid.oy + 6, text: label, align: 'left', color: rgb)
              : TextItem(x: grid.ox + grid.cols * grid.cell - 2, y: grid.oy + (grid.rows - p - 1) * grid.cell - 7, text: label, align: 'right', color: rgb));
        }
      } else if (a['x'] != null && lines) {
        final x = xOf(a['x']);
        if (!(x >= 0 && x <= l)) continue;
        final c = math.min(l - 1, x.floor());
        if (hz) {
          g.hline(grid.rows - 1 - c, rgb, 0.55);
        } else {
          g.vline(c, rgb, 0.55);
        }
        if (label != null) out.texts.add(TextItem(x: grid.ox + (c + 1) * grid.cell + 3, y: grid.oy + 7, text: label, align: 'left', color: rgb));
      } else if (a['from'] != null && a['to'] != null && !lines) {
        final tint = mix(th.unlit, rgb, 0.35);
        if (a['axis'] == 'y') {
          final y0 = ctx.y(dbl(a['from'])), y1 = ctx.y(dbl(a['to']));
          if (hz) {
            g.rect(y0, 0, y1, grid.rows.toDouble(), tint, 0.3);
          } else {
            g.rect(0, y0, grid.cols.toDouble(), y1, tint, 0.3);
          }
        } else {
          var x0 = xOf(a['from']), x1 = xOf(a['to']);
          if (!x0.isFinite || !x1.isFinite) continue;
          final half = parts.any((q) => q.def.band) ? ctx.band / 2 : 0;
          x0 -= half;
          x1 += half;
          if (hz) {
            g.rect(0, grid.rows - x1, grid.cols.toDouble(), grid.rows - x0, tint, 0.3);
          } else {
            g.rect(x0, 0, x1, grid.rows.toDouble(), tint, 0.3);
          }
        }
        if (label != null) out.texts.add(TextItem(x: grid.ox + 6, y: grid.oy + 8, text: label, align: 'left', color: rgb));
      }
    }
  }

  void _drawBrush() {
    final f = field!;
    final th = theme;
    final (a, b) = brush!;
    final x0 = math.max(0, minD(a, b).floor()), x1 = math.min(f.cols - 1, maxD(a, b).floor());
    for (var c = x0; c <= x1; c++) {
      for (var r = 0; r < f.rows; r++) {
        final i = r * f.cols + c;
        if (f.cov[i] < 0.12) {
          f.cov[i] = 0.3;
          f.col[i * 3] = th.grid[0];
          f.col[i * 3 + 1] = th.grid[1];
          f.col[i * 3 + 2] = th.grid[2];
        } else {
          final m = mix([f.col[i * 3], f.col[i * 3 + 1], f.col[i * 3 + 2]], th.snow, 0.3);
          f.col[i * 3] = m[0];
          f.col[i * 3 + 1] = m[1];
          f.col[i * 3 + 2] = m[2];
        }
      }
    }
  }

  /// Entrance: tiles switch on in a sweep from bottom-left, like the terminal typing the chart in.
  void _mask(double edge) {
    final f = field!, cols = f.cols, rows = f.rows;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if ((c / cols) * 0.8 + ((rows - 1 - r) / rows) * 0.45 > edge) f.cov[r * cols + c] = 0;
      }
    }
  }

  /// Per-tile springs (the website's scroll-strip constants), stepped at a fixed 60Hz.
  bool _springs(double dt, bool still) {
    final f = field!, n = f.cols * f.rows, tc = f.cov, tcol = f.col;
    if (still) {
      size.setAll(0, tc);
      vel.fillRange(0, n, 0);
      for (var i = 0; i < n; i++) {
        if (tc[i] > 0) {
          col[i * 3] = tcol[i * 3];
          col[i * 3 + 1] = tcol[i * 3 + 1];
          col[i * 3 + 2] = tcol[i * 3 + 2];
        }
      }
      glow.fillRange(0, n, 0);
      return false;
    }
    return _stepSprings(size, vel, col, glow, tc, tcol, math.max(1, math.min(4, jsRoundInt(dt * (Tokens.springs['hz'] as num)))));
  }

  // ── Picking, tooltips, keyboard ───────────────────────────────────────────────────────

  /// Tile coordinates (y up) of a logical pixel point.
  (double, double) toTiles(double px, double py) {
    final g = grid!;
    return ((px - g.ox) / g.cell, g.rows - (py - g.oy) / g.cell);
  }

  bool get _indexBased => cartesian && !primary.def.freePick;

  /// Item id under a logical pixel point, or -1.
  int pick(double px, double py) {
    final g = grid;
    if (g == null) return -1;
    final (x, y) = toTiles(px, py);
    if (_indexBased) {
      final p = primary, xi = p.def.xinfo!(p.fixed!), n = xi.labels.length;
      if (n == 0 || x < -1 || y < -1 || x > g.cols + 1 || y > g.rows + 1) return -1;
      final c = ctx(p);
      return nearest(n, (i) => c.xAt(p.shown!, i), horizontal ? g.rows - y : x);
    }
    for (var k = parts.length - 1; k >= 0; k--) {
      final p = parts[k];
      if (p.def.pick == null) continue;
      final id = p.def.pick!(ctx(p), p.shown!, p.fixed!, x, y);
      if (id >= 0) return id + k * 10000000;
    }
    return -1;
  }

  /// Tooltip content for an item id.
  Hit? tip(int id) {
    if (id < 0 || parts.isEmpty) return null;
    if (_indexBased) {
      final p = primary, xi = p.def.xinfo!(p.fixed!);
      if (id >= xi.labels.length) return null;
      final rows = <TipRow>[];
      for (final q in parts) {
        if (q.def.rowsAt != null) rows.addAll(q.def.rowsAt!(ctx(q), q.fixed!, id));
      }
      final label = labelText(xi.labels[id]);
      return Hit(index: id, title: label, rows: rows, point: ChartPoint(type: type, index: id, label: label, row: id < p.rows.length ? p.rows[id] : null));
    }
    final k = id ~/ 10000000;
    if (k >= parts.length) return null;
    final p = parts[k];
    return p.def.tip?.call(ctx(p), p.shown!, p.fixed!, id - k * 10000000);
  }

  /// Item ids in keyboard order.
  List<int> ids() {
    if (_indexBased) return List.generate(primary.def.xinfo!(primary.fixed!).labels.length, (i) => i);
    final p = parts[0];
    return p.def.ids?.call(ctx(p), p.fixed!) ?? [];
  }

  /// Logical pixel point to anchor the tooltip of a (keyboard-)focused id.
  (double, double) anchor(int id) {
    final g = grid!;
    var x = g.cols / 2, y = g.rows / 2;
    if (_indexBased) {
      final p = primary, c = ctx(p);
      final pos = c.xAt(p.shown!, id);
      if (horizontal) {
        x = g.cols * 0.6;
        y = g.rows - pos;
      } else {
        x = pos;
        y = g.rows * 0.6;
      }
    } else {
      final k = id ~/ 10000000;
      final p = k < parts.length ? parts[k] : null;
      if (p != null && p.def.anchor != null) (x, y) = p.def.anchor!(ctx(p), p.shown!, p.fixed!, id - k * 10000000);
    }
    return (g.ox + x * g.cell, g.oy + (g.rows - y) * g.cell);
  }

  List<LegendEntry> legend() {
    final out = <LegendEntry>[], seen = <String>{};
    for (final p in parts) {
      if (p.def.legend == null) continue;
      for (final it in p.def.legend!(ctx(p), p.fixed!)) {
        if (!seen.add(it.name)) continue;
        out.add((name: it.name, color: it.color, hidden: hidden.contains(it.name)));
      }
    }
    return out;
  }

  /// Data range of the x axis between two tile x positions: from / to labels and their indices.
  Selection? selection(double x0, double x1) {
    if (!cartesian) return null;
    final p = primary, xi = p.def.xinfo!(p.fixed!), c = ctx(p), n = xi.labels.length;
    if (n == 0) return null;
    final lo = minD(x0, x1), hi = maxD(x0, x1);
    final idx = [
      for (var i = 0; i < n; i++)
        if (c.xAt(p.shown!, i) >= lo - 0.5 && c.xAt(p.shown!, i) <= hi + 0.5) i,
    ];
    if (idx.isEmpty) return null;
    final a = idx.first, b = idx.last;
    return (from: xi.labels[a], to: xi.labels[b], indices: (a, b));
  }

  /// Zoom to a fraction of the full x range [v0, v1] (and optionally y).
  void setView(double v0, double v1, [double? y0, double? y1]) {
    y0 ??= viewY[0];
    y1 ??= viewY[1];
    final p = primary, n = p.def.xinfo != null ? p.def.xinfo!(p.fixed!).labels.length : 2;
    final minSpan = minD(1, 2 / math.max(2, n - 1));
    var a = clamp(minD(v0, v1)), b = clamp(maxD(v0, v1));
    if (b - a < minSpan) {
      final c = (a + b) / 2;
      a = clamp(c - minSpan / 2, 0, 1 - minSpan);
      b = a + minSpan;
    }
    view = [a, b];
    viewY = [clamp(minD(y0, y1)), clamp(maxD(y0, y1))];
    if (viewY[1] - viewY[0] < 0.02) viewY = [0, 1];
    _domains();
  }

  /// Text summary for screen readers.
  String summary() {
    final t = type, p = parts[0], names = [for (final l in legend()) l.name];
    final n = p.def.xinfo != null ? p.def.xinfo!(p.fixed!).labels.length : p.def.count != null ? p.def.count!(p.fixed!) : rows.length;
    final title = truthy(opts['title']) ? '${jsString(opts['title'])}. ' : '';
    final what = '${t.replaceAllMapped(RegExp('([A-Z])'), (m) => ' ${m[1]}').toLowerCase()} chart';
    final series = names.isNotEmpty
        ? ', ${names.length} ${cartesian ? 'series' : 'categories'}: ${names.take(8).join(', ')}${names.length > 8 ? '…' : ''}'
        : '';
    var range = '';
    final d = domLeft;
    if (d != null) range = '. Values from ${_tickText(d.ticks.min, d)} to ${_tickText(d.ticks.max, d)}';
    if (opts['value'] is num) range = '. Value ${format(opts['value'] as num)}';
    return '$title${what[0].toUpperCase()}${what.substring(1)}$series${n > 0 ? ', $n ${cartesian ? 'points' : 'items'}' : ''}$range.';
  }

  /// Lit tile count; handy for tests.
  int litTiles([double threshold = 0.05]) => size.where((v) => v > threshold).length;
}
