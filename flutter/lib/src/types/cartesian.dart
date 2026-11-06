// Cartesian chart types: line, area, bar, histogram, scatter, bubble, range, candlestick, ohlc,
// boxplot, waterfall.
import 'dart:math' as math;
import 'dart:typed_data';

import '../core/data.dart';
import '../core/field.dart';
import '../core/model_types.dart';
import '../core/ticks.dart';
import '../core/types.dart';
import '../core/util.dart';
import 'common.dart';

// ── line / area ──────────────────────────────────────────────────────────────────────────

List<List<double>> _percentOf(List<List<double>> values, List<String> names, Set<String> hidden) {
  final n = values.isNotEmpty ? values[0].length : 0;
  final tot = [
    for (var i = 0; i < n; i++)
      sum([for (var s = 0; s < values.length; s++) hidden.contains(names[s]) || !values[s][i].isFinite ? 0.0 : maxD(0, values[s][i])]),
  ];
  return [
    for (var s = 0; s < values.length; s++)
      [for (var i = 0; i < values[s].length; i++) hidden.contains(names[s]) || !values[s][i].isFinite ? 0.0 : (maxD(0, values[s][i]) / jsOr(tot[i], 1)) * 100],
  ];
}

List<List<double>> _vals(Fixed f, [String key = 'vals']) => [for (final v in f[key] as List) (v as List).cast<double>()];
List<String> _sides(Fixed f) => (f['sides'] as List).cast<String>();

List<Extent> _stackedExtents(Ctx ctx, Fixed f, List<List<double>> vals, bool stack, bool zero, bool pad, bool percent) {
  final out = <Extent>[], names = namesOf(f), sides = _sides(f);
  for (final side in const ['left', 'right']) {
    final idx = [for (var s = 0; s < names.length; s++) if (sides[s] == side && !ctx.hidden.contains(names[s])) s];
    if (idx.isEmpty) continue;
    var lo = double.infinity, hi = double.negativeInfinity;
    visibleRange(ctx, labelsOf(f).length, (i) {
      if (stack) {
        var pos = 0.0, neg = 0.0;
        for (final s in idx) {
          final v = vals[s][i];
          if (!v.isFinite) continue;
          if (v >= 0) {
            pos += v;
          } else {
            neg += v;
          }
        }
        hi = maxD(hi, pos);
        lo = minD(lo, neg);
      } else {
        for (final s in idx) {
          final v = vals[s][i];
          if (v.isFinite) {
            lo = minD(lo, v);
            hi = maxD(hi, v);
          }
        }
      }
    });
    if (stack) lo = minD(lo, 0);
    out.add(Extent(lo, hi, side, zero: zero, pad: pad, percent: percent));
  }
  return out;
}

class _Curve {
  _Curve(this.s, this.lower, this.upper);
  final int s;
  final List<double> lower, upper;
}

class _LineGeometry {
  _LineGeometry(this.version, this.xs, this.sub, this.big, this.curves);
  final int version;
  final List<double> xs;
  final int sub;
  final bool big;
  final List<_Curve> curves;
}

/// Tile-space curves per series: upper edge (the line) and lower edge (stack base or zero).
_LineGeometry _lineGeometry(Ctx ctx, Model m, Fixed f, int n, String curve) {
  final cols = ctx.grid.cols, rows = ctx.grid.rows;
  final xs = [for (var i = 0; i < n; i++) ctx.xAt(m, i)];
  final spacing = n > 1 ? (xs[n - 1] - xs[0]).abs() / (n - 1) : cols.toDouble();
  final sub = curve == 'smooth' ? math.min(8, math.max(1, jsRoundInt(spacing / 1.5))) : 1;
  final big = n > cols * 4;
  List<double> shape(List<double> ys, List<double> xv) => curve == 'step' ? steps(xv, ys) : smooth(xv, ys, sub);
  final cum = Float64List(n), base = clamp(ctx.y(0), 0, rows);
  final curves = <_Curve>[];
  List<double> at(List<double> src, List<int>? idx, double Function(double v) map) => [
        if (idx != null) for (final k in idx) map(src[k]) else for (var k = 0; k < n; k++) map(src[k]),
      ];
  final ms = m['s'] as List, ma = dl(m['a']), sides = _sides(f), stack = f['stack'] == true;
  for (var s = 0; s < ms.length; s++) {
    final side = sides[s], row = ms[s] as List, a = ma[s];
    final below = stack ? Float64List.fromList(cum) : null; // the running total underneath this series
    for (var i = 0; i < n; i++) {
      final v = dbl(row[i]);
      cum[i] = stack ? cum[i] + (v.isFinite ? v * a : 0) : v;
    }
    double toY(double v) => ctx.y(v, side);
    final keep = big ? decimate(xs, at(cum, null, toY), cols) : null; // M4 indices for this series
    final xv = keep != null ? [for (final i in keep) xs[i]] : xs;
    final ys = at(cum, keep, toY), lo = below != null ? at(below, keep, toY) : [for (final _ in xv) base];
    curves.add(_Curve(s, big ? [for (var i = 0; i < xv.length; i++) ...[xv[i], lo[i]]] : shape(lo, xv), shape(ys, xv)));
  }
  return _LineGeometry(ctx.version, xs, sub, big, curves);
}

ChartTypeDef _lineLike(bool area) => ChartTypeDef(
      kind: 'cartesian',
      keyed: const ['px', 's', 'a'],
      model: (ctx) {
        final f = seriesFixed(ctx), o = ctx.opts;
        final stack = area && truthy(o['stack']), percent = stack && o['stack'] == 'percent';
        final names = namesOf(f), values = _vals(f, 'values');
        final vals = percent ? _percentOf(values, names, ctx.hidden) : values;
        return Built(
          {'px': List<double>.of(f['xs'] as List<double>), 's': vals, 'a': [for (final n in names) ctx.hidden.contains(n) ? 0.0 : 1.0]},
          {
            ...f,
            'vals': vals,
            'stack': stack,
            'percent': percent,
            'fill': area || truthy(o['fill']),
            'fills': [for (final c in colorsOf(f)) shades(ctx.theme.fade, c, 0.14, 0.55)],
          },
        );
      },
      keys: keysOfFixed,
      xinfo: xinfoOf,
      extents: (ctx, f) => _stackedExtents(ctx, f, _vals(f), f['stack'] == true, f['fill'] == true, f['fill'] != true, f['percent'] == true),
      raster: (ctx, m, f, g) {
        final ms = m['s'] as List;
        final n = ms.isNotEmpty ? (ms[0] as List).length : 0;
        if (n < 1 || m['px'] == null) return;
        final cols = ctx.grid.cols;
        final lw = maxD(1, 3.2 / ctx.grid.cell);
        final curve = truthy(ctx.opts['curve']) ? ctx.opts['curve'] as String : 'smooth';
        // Geometry only changes when something moves; hover-only frames reuse it (matters at 1M points).
        var geo = f['geo'] as _LineGeometry?;
        if (geo == null || geo.version != ctx.version) f['geo'] = geo = _lineGeometry(ctx, m, f, n, curve);
        final xs = geo.xs, sub = geo.sub, big = geo.big;
        final order = f['stack'] == true ? geo.curves : geo.curves.reversed.toList(); // series 0 ends up on top
        final ma = dl(m['a']), patterns = (f['patterns'] as List).cast<String>(), colors = colorsOf(f);
        // Every fill first, then every line, so no series' fill hides another series' line.
        if (f['fill'] == true) {
          final fills = (f['fills'] as List).cast<List<RGB>>();
          for (final cv in order) {
            if (ma[cv.s] < 0.01) continue;
            g.pattern = patterns[cv.s];
            final top = columnsY(cv.upper, cols), bottom = columnsY(cv.lower, cols), ramp = fills[cv.s];
            for (var c = 0; c < cols; c++) {
              g.span(c, bottom[c], top[c], ramp, 1.3, 0.95 * ma[cv.s]);
            }
          }
        }
        for (final cv in order) {
          if (ma[cv.s] < 0.01) continue;
          g.pattern = patterns[cv.s];
          g.line(cv.upper, lw, colors[cv.s], ma[cv.s]);
        }
        g.pattern = 'solid';
        for (final cv in order) {
          if (ma[cv.s] < 0.01 || big) continue;
          final upper = cv.upper;
          double yAt(int i) => upper[math.min(upper.length ~/ 2 - 1, i * (curve == 'step' ? 3 : sub)) * 2 + 1];
          if (ctx.hover >= 0 && ctx.hover < n) g.disc(xs[ctx.hover], yAt(ctx.hover), lw * 0.6 + 0.9, mix(colors[cv.s], ctx.theme.snow, 0.45));
          if (truthy(ctx.opts['window'])) {
            // the live cursor: newest point pulses, like the logo's cursor tiles
            final pulse = ctx.live ? 0.5 + 0.5 * math.sin(ctx.now / 160) : 0.0;
            g.disc(xs[n - 1], yAt(n - 1), lw * 0.6 + 0.6 + pulse * 0.5, mix(colors[cv.s], ctx.theme.snow, 0.25 + 0.4 * pulse));
          }
        }
        if (ctx.live) ctx.animating = true;
      },
      rowsAt: _percentRows,
      legend: seriesLegend,
    );

List<TipRow> _percentRows(Ctx ctx, Fixed f, int i) =>
    seriesRows(ctx, f, i, f['percent'] == true ? (s) => ' (${jsNum(jsRound(_vals(f)[s][i]))}%)' : null);

// ── bar / histogram ─────────────────────────────────────────────────────────────────────

void _barRaster(Ctx ctx, Model m, Fixed f, Raster g) {
  final ms = m['s'] as List, ns = ms.length, n = ms.isNotEmpty ? (ms[0] as List).length : 0, o = ctx.opts;
  if (n == 0) return;
  final inner = ctx.band.abs() * (f['inner'] != null ? dbl(f['inner']) : 0.72), stack = truthy(f['stack']), each = stack ? inner : inner / math.max(1, ns);
  final showLabels = o['labels'] != null ? o['labels'] == true : ctx.horizontal && ns == 1;
  final sides = f['sides'] != null ? _sides(f) : null, patterns = f['patterns'] != null ? (f['patterns'] as List).cast<String>() : null;
  final hotR = (f['hot'] as List).cast<List<RGB>>(), ramps = (f['ramps'] as List).cast<List<RGB>>();
  for (var i = 0; i < n; i++) {
    final centre = ctx.xAt(m, i);
    var pos = 0.0, neg = 0.0;
    for (var s = 0; s < ns; s++) {
      final raw0 = dbl((ms[s] as List)[i]), v = raw0.isFinite ? raw0 : 0.0, side = sides != null ? sides[s] : 'left';
      var v0 = 0.0, v1 = v;
      if (stack) {
        if (v >= 0) {
          v0 = pos;
          pos += v;
          v1 = pos;
        } else {
          v0 = neg;
          neg += v;
          v1 = neg;
        }
      }
      var a0 = centre - inner / 2 + (stack ? 0 : s * each), a1 = a0 + each;
      if (each >= 2.5) {
        a0 = jsRound(a0);
        a1 = jsRound(a1);
        if (!stack && ns > 1 && a1 - a0 >= 3) a1 -= 1;
      }
      final p0 = ctx.y(v0, side), p1 = ctx.y(v1, side), ramp = (ctx.hover == i ? hotR : ramps)[s];
      g.pattern = patterns != null ? patterns[s] : 'solid';
      orientedRect(ctx, g, a0, a1, p0, p1, tipShade(ctx, ramp, p0, p1));
      if (showLabels && (!stack || s == ns - 1) && (p1 - p0).abs() > 0.01) {
        final raw = stack ? dbl((f['totals'] as List)[i]) : dbl(((f['values'] as List)[s] as List)[i]);
        final grid = ctx.grid, end = stack ? ctx.y(v >= 0 ? pos : neg, side) : p1;
        ctx.out.texts.add(ctx.horizontal
            ? TextItem(x: grid.ox + end * grid.cell + 6, y: grid.oy + ((a0 + a1) / 2) * grid.cell, text: ctx.format(raw), align: 'left', color: 'textHi')
            : TextItem(x: grid.ox + ((a0 + a1) / 2) * grid.cell, y: grid.oy + (grid.rows - end) * grid.cell - 8, text: ctx.format(raw), color: 'textHi'));
      }
    }
  }
  g.pattern = 'solid';
}

final ChartTypeDef _bar = ChartTypeDef(
  kind: 'cartesian',
  band: true,
  keyed: const ['px', 's'],
  model: (ctx) {
    final f = seriesFixed(ctx), o = ctx.opts, stack = truthy(o['stack']), percent = o['stack'] == 'percent';
    final names = namesOf(f), values = _vals(f, 'values');
    final masked = [
      for (var s = 0; s < values.length; s++) [for (final x in values[s]) ctx.hidden.contains(names[s]) || !x.isFinite ? 0.0 : x],
    ];
    final vals = percent ? _percentOf(masked, names, ctx.hidden) : masked;
    final totals = [for (var i = 0; i < labelsOf(f).length; i++) sum([for (final v in masked) v[i]])];
    return Built(
      {'px': [for (var i = 0; i < (f['xs'] as List).length; i++) i.toDouble()], 's': vals},
      {...f, 'vals': vals, 'stack': stack, 'percent': percent, 'totals': totals, ...barRamps(ctx, colorsOf(f))},
    );
  },
  keys: keysOfFixed,
  xinfo: categoryXInfo,
  extents: (ctx, f) => _stackedExtents(ctx, f, _vals(f), f['stack'] == true, true, false, f['percent'] == true),
  raster: _barRaster,
  rowsAt: _percentRows,
  legend: seriesLegend,
);

/// JS Math.log2: exact on powers of two.
double _log2(double x) {
  final e = (math.log(x) / math.ln2).roundToDouble();
  return e.abs() < 1023 && math.pow(2.0, e) == x ? e : math.log(x) / math.ln2;
}

/// The first number column of a row, or null.
String? firstNumberKey(Row? first) {
  if (first == null) return null;
  for (final k in first.keys) {
    if (first[k] is num) return k;
  }
  return null;
}

final ChartTypeDef _histogram = ChartTypeDef(
  kind: 'cartesian',
  band: true,
  model: (ctx) {
    final o = ctx.opts, rows = ctx.rows;
    final vk = firstOf(o['y']) ?? (o['value'] is String ? o['value'] : null) ?? (rows.isNotEmpty ? firstNumberKey(rows[0]) : 'value');
    final gv = getter(vk);
    final vals = [for (var i = 0; i < rows.length; i++) num_(gv(rows[i], i))]..removeWhere((v) => !v.isFinite);
    final name = vk is String && vk != 'value' ? vk : 'count';
    final color = ctx.colorOf(name, 0);
    if (vals.isEmpty) {
      return Built({'px': <double>[], 's': [<double>[]]}, {
        'labels': <dynamic>[], 'xs': <double>[], 'keys': <String>[], 'names': [name], 'values': [<double>[]], 'vals': [<double>[]], 'colors': [color],
        'xKind': 'category', 'inner': 0.94, 'edges': <double>[], ...barRamps(ctx, [color]), //
      });
    }
    var lo = double.infinity, hi = double.negativeInfinity;
    for (final v in vals) {
      lo = minD(lo, v);
      hi = maxD(hi, v);
    }
    final target = truthy(o['bins']) ? dbl(o['bins']) : maxD(5, minD(50, (_log2(vals.length.toDouble()) + 1).ceilToDouble()));
    final t = niceTicks(lo, hi == lo ? lo + 1 : hi, target);
    final edges = t.ticks.length > 1 ? t.ticks : [t.min, t.max];
    final counts = List<double>.filled(edges.length - 1, 0, growable: true);
    for (final v in vals) {
      counts[math.min(counts.length - 1, math.max(0, ((v - edges[0]) / t.step).floor()))]++;
    }
    final labels = [for (var i = 0; i < counts.length; i++) '${ctx.format(edges[i])}–${ctx.format(edges[i + 1])}'];
    final shown = ctx.hidden.contains(name) ? [for (final _ in counts) 0.0] : counts;
    final xs = [for (var i = 0; i < counts.length; i++) i.toDouble()];
    return Built({'px': List<double>.of(xs), 's': [shown]}, {
      'labels': labels, 'xs': xs, 'keys': keysOf(labels), 'names': [name], 'values': [counts], 'vals': [shown], 'colors': [color],
      'sides': ['left'], 'patterns': ['solid'], 'xKind': 'category', 'inner': 0.94, 'edges': edges, ...barRamps(ctx, [color]), //
    });
  },
  xinfo: categoryXInfo,
  extents: (_, f) => [Extent(0, maxOf(_vals(f)[0], 1), 'left', zero: true)],
  raster: _barRaster,
  rowsAt: (ctx, f, i) => [TipRow(colorsOf(f)[0], namesOf(f)[0], jsNum(_vals(f, 'values')[0][i]))],
  legend: noLegend,
);

// ── scatter / bubble ────────────────────────────────────────────────────────────────────

List<List<Row>> _groups(Fixed f) => [for (final g in f['groups'] as List) (g as List).cast<Row>()];

(double, double) _radii(Ctx ctx) => (maxD(0.7, 3.2 / ctx.grid.cell), maxD(1.2, 15 / ctx.grid.cell));

final ChartTypeDef _scatter = ChartTypeDef(
  kind: 'cartesian',
  xGrid: true,
  freePick: true,
  model: (ctx) {
    final o = ctx.opts, rows = ctx.rows, first = rows.isNotEmpty ? rows[0] : const <String, dynamic>{};
    final numeric = [for (final k in first.keys) if (first[k] is num && k != o['size']) k];
    final xk = o['x'] ?? (numeric.isNotEmpty ? numeric[0] : null) ?? 'x';
    final yk = firstOf(o['y']) ?? numeric.cast<Object?>().firstWhere((k) => k != xk, orElse: () => null) ?? 'y';
    final sk = o['size'];
    final gx = getter(xk), gy = getter(yk), gs = truthy(sk) ? getter(sk) : null;
    final by = truthy(o['by']) ? jsString(o['by']) : null;
    final names = by != null ? {for (final r in rows) jsString(r[by])}.toList() : [yk is String ? yk : 'y'];
    final groups = [for (final n in names) rows.where((r) => by == null || jsString(r[by]) == n).toList()];
    final rMax = gs != null ? maxOf([for (var i = 0; i < rows.length; i++) jsOr(num_(gs(rows[i], i)), 0)], 1e-9) : 1.0;
    final colors = [for (var i = 0; i < names.length; i++) ctx.colorOf(names[i], i)];
    final all = [for (final g in groups) ...g];
    List<double> xsOf(List<Row> g) => [for (var i = 0; i < g.length; i++) num_(gx(g[i], i))];
    return Built({
      'X': [for (final g in groups) xsOf(g)],
      'Yv': [for (final g in groups) [for (var i = 0; i < g.length; i++) num_(gy(g[i], i))]],
      'R': [
        for (var s = 0; s < groups.length; s++)
          [
            for (var i = 0; i < groups[s].length; i++)
              ctx.hidden.contains(names[s]) ? 0.0 : gs != null ? math.sqrt(maxD(0, jsOr(num_(gs(groups[s][i], i)), 0)) / rMax) : 1.0,
          ],
      ],
    }, {
      'names': names, 'groups': groups, 'colors': colors, 'xk': xk, 'yk': yk, 'sk': sk, 'bubble': gs != null || ctx.opts['type'] == 'bubble',
      'labels': xsOf(all), 'xs': xsOf(all), //
    });
  },
  seed: (shown, model) {
    shown['X'] = [for (final a in model['X'] as List) List<dynamic>.of(a as List)];
    shown['Yv'] = [for (final a in model['Yv'] as List) List<dynamic>.of(a as List)];
  },
  xinfo: (f) => XInfo('number', labelsOf(f), (f['xs'] as List).cast<double>(), const []),
  extents: (ctx, f) {
    var lo = double.infinity, hi = double.negativeInfinity;
    final groups = _groups(f), names = namesOf(f), gy = getter(f['yk']);
    for (var s = 0; s < groups.length; s++) {
      if (ctx.hidden.contains(names[s])) continue;
      for (var i = 0; i < groups[s].length; i++) {
        final v = num_(gy(groups[s][i], i));
        if (v.isFinite) {
          lo = minD(lo, v);
          hi = maxD(hi, v);
        }
      }
    }
    return [Extent(lo, hi, 'left', pad: true)];
  },
  raster: (ctx, m, f, g) {
    final (base, big) = _radii(ctx);
    final mx = m['X'] as List, my = m['Yv'] as List, mr = m['R'] as List, colors = colorsOf(f), bubble = f['bubble'] == true;
    for (var s = mx.length - 1; s >= 0; s--) {
      final xs = mx[s] as List, ys = my[s] as List, rs = mr[s] as List;
      for (var i = 0; i < xs.length; i++) {
        final r = dbl(rs[i]) * (bubble ? big : base);
        if (!(r > 0.05)) continue;
        final hot = ctx.hover == s * 100000 + i, col = colors[s];
        g.disc(ctx.x(dbl(xs[i])), ctx.y(dbl(ys[i])), r, hot ? mix(col, ctx.theme.snow, 0.5) : bubble ? mix(ctx.theme.fade, col, 0.82) : col, 0.95);
      }
    }
  },
  pick: (ctx, m, f, x, y) {
    final (base, big) = _radii(ctx);
    final mx = m['X'] as List, my = m['Yv'] as List, mr = m['R'] as List, bubble = f['bubble'] == true;
    var best = -1;
    var bd = double.infinity;
    for (var s = 0; s < mx.length; s++) {
      final xs = mx[s] as List, ys = my[s] as List, rs = mr[s] as List;
      for (var i = 0; i < xs.length; i++) {
        final r = dbl(rs[i]) * (bubble ? big : base);
        if (!(r > 0.05)) continue;
        final d = hypot(ctx.x(dbl(xs[i])) - x, ctx.y(dbl(ys[i])) - y) - r;
        if (d < bd && d < 2.5 + 8 / ctx.grid.cell) {
          bd = d;
          best = s * 100000 + i;
        }
      }
    }
    return best;
  },
  tip: (ctx, m, f, id) {
    final s = id ~/ 100000, i = id % 100000, groups = _groups(f);
    final row = s < groups.length && i < groups[s].length ? groups[s][i] : null;
    if (row == null) return null;
    final c = colorsOf(f)[s], gx = getter(f['xk']), gy = getter(f['yk']);
    final rows = [TipRow(c, jsString(f['xk']), ctx.format(num_(gx(row, i)))), TipRow(c, jsString(f['yk']), ctx.format(num_(gy(row, i))))];
    if (truthy(f['sk'])) rows.add(TipRow(c, jsString(f['sk']), ctx.format(num_(getter(f['sk'])(row, i)))));
    final name = namesOf(f)[s];
    return Hit(index: id, title: name, rows: rows, point: ChartPoint(type: ctx.opts['type'] as String, index: i, series: name, row: row, value: num_(gy(row, i))));
  },
  ids: (ctx, f) {
    final groups = _groups(f), names = namesOf(f);
    return [
      for (var s = 0; s < groups.length; s++)
        if (!ctx.hidden.contains(names[s])) for (var i = 0; i < groups[s].length; i++) s * 100000 + i,
    ];
  },
  anchor: (ctx, m, _, id) {
    final s = id ~/ 100000, i = id % 100000;
    return (ctx.x(dbl(((m['X'] as List)[s] as List)[i])), ctx.y(dbl(((m['Yv'] as List)[s] as List)[i])));
  },
  legend: (ctx, f) => namesOf(f).length > 1 ? seriesLegend(ctx, f) : const [],
);

// ── range ───────────────────────────────────────────────────────────────────────────────

final ChartTypeDef _range = ChartTypeDef(
  kind: 'cartesian',
  keyed: const ['px', 'lo', 'hi', 's'],
  model: (ctx) {
    final o = ctx.opts, rows = ctx.rows;
    final fk = truthy(o['from']) ? jsString(o['from']) : 'from', tk = truthy(o['to']) ? jsString(o['to']) : 'to';
    final f = seriesFixed(ctx.withOpts({...o, 'y': o['y'] ?? <dynamic>[]}));
    final lo = [for (final r in rows) num_(r[fk])], hi = [for (final r in rows) num_(r[tk])];
    final band = truthy(o['label']) ? jsString(o['label']) : '$fk–$tk';
    final names = namesOf(f);
    final colors = [ctx.colorOf(band, 0), for (var i = 0; i < names.length; i++) ctx.colorOf(names[i], i + 1)];
    final hide = ctx.hidden.contains(band);
    return Built({
      'px': List<double>.of(f['xs'] as List<double>),
      'lo': hide ? [for (final _ in lo) 0.0] : lo,
      'hi': hide ? [for (final _ in hi) 0.0] : hi,
      's': f['values'],
      'a': [for (final n in names) ctx.hidden.contains(n) ? 0.0 : 1.0],
      'ba': hide ? 0.0 : 1.0,
    }, {
      ...f, 'band': band, 'bandColor': colors[0], 'colors': colors.sublist(1), 'names': names, 'colorNames': [band, ...names], 'loV': lo, 'hiV': hi,
      'ramp': shades(ctx.theme.fade, colors[0], 0.22, 0.45), //
    });
  },
  keys: keysOfFixed,
  xinfo: xinfoOf,
  extents: (ctx, f) {
    var lo = double.infinity, hi = double.negativeInfinity;
    final loV = (f['loV'] as List).cast<double>(), hiV = (f['hiV'] as List).cast<double>(), values = _vals(f, 'values'), names = namesOf(f);
    visibleRange(ctx, labelsOf(f).length, (i) {
      if (!ctx.hidden.contains(f['band'])) {
        if (loV[i].isFinite) lo = minD(lo, loV[i]);
        if (hiV[i].isFinite) hi = maxD(hi, hiV[i]);
      }
      for (var s = 0; s < values.length; s++) {
        if (!ctx.hidden.contains(names[s]) && values[s][i].isFinite) {
          lo = minD(lo, values[s][i]);
          hi = maxD(hi, values[s][i]);
        }
      }
    });
    return [Extent(lo, hi, 'left', pad: true)];
  },
  raster: (ctx, m, f, g) {
    final mlo = dl(m['lo']), mhi = dl(m['hi']), n = mlo.length;
    if (n == 0) return;
    final cols = ctx.grid.cols, cell = ctx.grid.cell, lw = maxD(1, 3.2 / cell);
    final xs = [for (var i = 0; i < n; i++) ctx.xAt(m, i)];
    final sub = math.min(8, math.max(1, jsRoundInt((n > 1 ? (xs[n - 1] - xs[0]).abs() / (n - 1) : cols) / 1.5)));
    final ba = dbl(m['ba']), ma = dl(m['a']), ms = m['s'] as List, colors = colorsOf(f);
    if (ba > 0.01) {
      final lo = smooth(xs, [for (final v in mlo) ctx.y(v)], sub), hi = smooth(xs, [for (final v in mhi) ctx.y(v)], sub);
      final top = columnsY(hi, cols), bot = columnsY(lo, cols);
      final ramp = (f['ramp'] as List).cast<RGB>();
      for (var c = 0; c < cols; c++) {
        g.span(c, minD(top[c], bot[c]), maxD(top[c], bot[c]), ramp, 1, 0.9 * ba);
      }
      final edge = mix(ctx.theme.fade, f['bandColor'] as RGB, 0.75);
      g.line(lo, maxD(0.8, lw * 0.6), edge, ba);
      g.line(hi, maxD(0.8, lw * 0.6), edge, ba);
    }
    for (var s = ms.length - 1; s >= 0; s--) {
      if (ma[s] > 0.01) g.line(smooth(xs, [for (final v in ms[s] as List) ctx.y(dbl(v))], sub), lw, colors[s], ma[s]);
    }
    if (ctx.hover >= 0 && ctx.hover < n) {
      for (var s = 0; s < ms.length; s++) {
        if (ma[s] > 0.01) g.disc(xs[ctx.hover], ctx.y(dbl((ms[s] as List)[ctx.hover])), lw * 0.6 + 0.9, mix(colors[s], ctx.theme.snow, 0.45));
      }
    }
  },
  rowsAt: (ctx, f, i) => [
    if (!ctx.hidden.contains(f['band']))
      TipRow(f['bandColor'] as RGB, f['band'] as String, '${ctx.format(dbl((f['loV'] as List)[i]))} – ${ctx.format(dbl((f['hiV'] as List)[i]))}'),
    ...seriesRows(ctx, f, i),
  ],
  legend: (_, f) {
    final names = namesOf(f), colors = colorsOf(f);
    return [(name: f['band'] as String, color: f['bandColor'] as RGB), for (var i = 0; i < names.length; i++) (name: names[i], color: colors[i])];
  },
);

// ── candlestick / ohlc ──────────────────────────────────────────────────────────────────

/// Row labels (the x column, or the row index) of a single-series cartesian type.
List<dynamic> rowLabels(Ctx ctx) {
  final xk = xKeyOf(ctx.rows, ctx.opts['x']), gx = getter(xk);
  return [for (var i = 0; i < ctx.rows.length; i++) xk == null ? i : gx(ctx.rows[i], i)];
}

List<double> _indices(int n) => [for (var i = 0; i < n; i++) i.toDouble()];

ChartTypeDef _candles(String style) => ChartTypeDef(
      kind: 'cartesian',
      band: true,
      keyed: const ['px', 'o', 'h', 'l', 'c'],
      model: (ctx) {
        final o = ctx.opts, rows = ctx.rows;
        String key(String k) => truthy(o[k]) ? jsString(o[k]) : k;
        final k = {'o': key('open'), 'h': key('high'), 'l': key('low'), 'c': key('close')};
        final labels = rowLabels(ctx);
        List<double> col(String key) => [for (final r in rows) num_(r[key])];
        return Built(
          {'px': _indices(labels.length), 'o': col(k['o']!), 'h': col(k['h']!), 'l': col(k['l']!), 'c': col(k['c']!)},
          {
            'labels': labels, 'xs': _indices(labels.length), 'keys': keysOf(labels), 'rows': rows, 'k': k,
            'up': shades(ctx.theme.fade, ctx.theme.up, 0.55, 1), 'down': shades(ctx.theme.fade, ctx.theme.down, 0.55, 1), //
          },
        );
      },
      keys: keysOfFixed,
      xinfo: categoryXInfo,
      extents: (ctx, f) {
        var lo = double.infinity, hi = double.negativeInfinity;
        final rows = (f['rows'] as List).cast<Row>(), k = f['k'] as Map<String, String>;
        visibleRange(ctx, rows.length, (i) {
          lo = minD(lo, num_(rows[i][k['l']]));
          hi = maxD(hi, num_(rows[i][k['h']]));
        });
        return [Extent(lo, hi, 'left', pad: true)];
      },
      raster: (ctx, m, f, g) {
        final mo = dl(m['o']), mh = dl(m['h']), ml = dl(m['l']), mc = dl(m['c']), n = mo.length;
        if (n == 0) return;
        final bw = ctx.band.abs(), grid = ctx.grid, rows = grid.rows, cols = grid.cols, th = ctx.theme;
        final last = mc[n - 1], rising = last >= mo[n - 1];
        final lastRow = math.min(rows - 1, math.max(0, floorI(ctx.y(last))));
        g.hline(lastRow, rising ? th.up : th.down, 0.3);
        final ww = clamp(bw * 0.14, 0.4, 1);
        final upR = (f['up'] as List).cast<RGB>(), downR = (f['down'] as List).cast<RGB>();
        for (var i = 0; i < n; i++) {
          final x = ctx.xAt(m, i), up = mc[i] >= mo[i], ramp = up ? upR : downR, hot = ctx.hover == i;
          if (x < -bw || x > cols + bw) continue;
          if (style == 'ohlc') {
            final col = pick(ramp, hot ? 1 : 0.75);
            g.rect(x - ww / 2, ctx.y(ml[i]), x + ww / 2, ctx.y(mh[i]), col);
            final yo = ctx.y(mo[i]), yc = ctx.y(mc[i]), t = maxD(0.6, ww);
            g.rect(x - bw * 0.36, yo - t / 2, x, yo + t / 2, col);
            g.rect(x, yc - t / 2, x + bw * 0.36, yc + t / 2, col);
            continue;
          }
          g.rect(x - ww / 2, ctx.y(ml[i]), x + ww / 2, ctx.y(mh[i]), pick(ramp, hot ? 1 : 0.45));
          var y0 = ctx.y(minD(mo[i], mc[i])), y1 = ctx.y(maxD(mo[i], mc[i]));
          if (y1 - y0 < 0.7) {
            final mid = (y0 + y1) / 2;
            y0 = mid - 0.35;
            y1 = mid + 0.35;
          }
          final b0 = y0, b1 = y1;
          g.rect(x - bw * 0.34, y0, x + bw * 0.34, y1, (int _, int r) => pick(ramp, hot ? 1 : 0.6 + 0.4 * ((r + 0.5 - b0) / jsOr(b1 - b0, 1))));
        }
        if (ctx.opts['axes'] != false) {
          ctx.out.texts.add(TextItem(
            x: grid.ox + cols * grid.cell - 3,
            y: grid.oy + (rows - lastRow - 0.5) * grid.cell,
            text: ctx.format(precise(last, 10)),
            align: 'right',
            color: th.bg,
            bg: rising ? th.up : th.down,
            weight: 700,
          ));
        }
      },
      rowsAt: (ctx, f, i) {
        final rows = (f['rows'] as List).cast<Row>(), k = f['k'] as Map<String, String>;
        if (i >= rows.length) return const [];
        final r = rows[i];
        final col = num_(r[k['c']]) >= num_(r[k['o']]) ? ctx.theme.up : ctx.theme.down;
        const names = {'o': 'open', 'h': 'high', 'l': 'low', 'c': 'close'};
        return [for (final q in const ['o', 'h', 'l', 'c']) TipRow(col, names[q]!, ctx.format(num_(r[k[q]])))];
      },
      legend: noLegend,
    );

// ── boxplot ─────────────────────────────────────────────────────────────────────────────

/// Quartiles by linear interpolation (type 7, as in R and NumPy's default).
double quantile(List<double> sorted, double q) {
  if (sorted.isEmpty) return double.nan;
  final p = (sorted.length - 1) * q, i = p.floor(), f = p - i;
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * f : sorted[i];
}

class BoxStats {
  BoxStats(this.q1, this.q2, this.q3, this.w0, this.w1, this.out, this.n);
  final double q1, q2, q3, w0, w1;
  final List<double> out;
  final int n;
}

List<BoxStats> _stats(Fixed f) => (f['stats'] as List).cast<BoxStats>();

final ChartTypeDef _boxplot = ChartTypeDef(
  kind: 'cartesian',
  band: true,
  keyed: const ['px', 'q1', 'q2', 'q3', 'w0', 'w1'],
  model: (ctx) {
    final o = ctx.opts, rows = ctx.rows, first = rows.isNotEmpty ? rows[0] : const <String, dynamic>{};
    final xk = xKeyOf(rows, o['x']);
    final labels = <dynamic>[];
    final groups = <List<double>>[];
    if (xk != null) {
      final vk = firstOf(o['y']) ?? (o['value'] is String ? o['value'] : null) ?? firstNumberKey(first);
      final gx = getter(xk), gv = getter(vk);
      for (var i = 0; i < rows.length; i++) {
        final l = gx(rows[i], i);
        var j = labels.indexOf(l);
        if (j < 0) {
          j = labels.length;
          labels.add(l);
          groups.add([]);
        }
        final v = num_(gv(rows[i], i));
        if (v.isFinite) groups[j].add(v);
      }
    } else {
      final keys = o['y'] != null ? listOf(o['y']) : [for (final k in first.keys) if (first[k] is num) k];
      labels.addAll(keys);
      for (final k in keys) {
        groups.add([for (final r in rows) num_(r[jsString(k)])]..removeWhere((v) => !v.isFinite));
      }
    }
    final stats = [
      for (final g in groups)
        () {
          final s = stableSorted(g, (a, b) => cmp(a - b)), q1 = quantile(s, 0.25), q2 = quantile(s, 0.5), q3 = quantile(s, 0.75), iqr = q3 - q1;
          final w0 = s.cast<double?>().firstWhere((v) => v! >= q1 - 1.5 * iqr, orElse: () => null) ?? q1;
          final w1 = s.reversed.cast<double?>().firstWhere((v) => v! <= q3 + 1.5 * iqr, orElse: () => null) ?? q3;
          return BoxStats(q1, q2, q3, w0, w1, [for (final v in s) if (v < w0 || v > w1) v], s.length);
        }(),
    ];
    final name = truthy(o['label']) ? jsString(o['label']) : 'distribution', color = ctx.colorOf(name, 0);
    return Built({
      'px': _indices(labels.length),
      'q1': [for (final s in stats) s.q1],
      'q2': [for (final s in stats) s.q2],
      'q3': [for (final s in stats) s.q3],
      'w0': [for (final s in stats) s.w0],
      'w1': [for (final s in stats) s.w1],
    }, {
      'labels': labels, 'xs': _indices(labels.length), 'keys': keysOf(labels), 'stats': stats, 'color': color,
      'ramp': shades(ctx.theme.fade, color, 0.35, 0.8), //
    });
  },
  keys: keysOfFixed,
  xinfo: categoryXInfo,
  extents: (ctx, f) {
    var lo = double.infinity, hi = double.negativeInfinity;
    final stats = _stats(f);
    visibleRange(ctx, stats.length, (i) {
      final s = stats[i];
      if (s.n == 0) return;
      lo = minD(minD(lo, s.w0), minOf(s.out));
      hi = maxD(maxD(hi, s.w1), maxOf(s.out));
    });
    return [Extent(lo, hi, 'left', pad: true)];
  },
  raster: (ctx, m, f, g) {
    final bw = ctx.band.abs(), lw = maxD(0.8, minD(1, bw * 0.1)), stats = _stats(f), th = ctx.theme, color = f['color'] as RGB;
    final q1 = dl(m['q1']), q2 = dl(m['q2']), q3 = dl(m['q3']), w0 = dl(m['w0']), w1 = dl(m['w1']), ramp = (f['ramp'] as List).cast<RGB>();
    for (var i = 0; i < q1.length; i++) {
      if (i >= stats.length || stats[i].n == 0) continue;
      final c = ctx.xAt(m, i), half = bw * 0.3, hot = ctx.hover == i, col = hot ? mix(color, th.snow, 0.35) : color;
      double y(double v) => ctx.y(v);
      final whisker = mix(th.fade, col, 0.7);
      orientedRect(ctx, g, c - lw / 2, c + lw / 2, y(w0[i]), y(q1[i]), whisker);
      orientedRect(ctx, g, c - lw / 2, c + lw / 2, y(q3[i]), y(w1[i]), whisker);
      orientedRect(ctx, g, c - half * 0.6, c + half * 0.6, y(w0[i]) - lw / 2, y(w0[i]) + lw / 2, whisker);
      orientedRect(ctx, g, c - half * 0.6, c + half * 0.6, y(w1[i]) - lw / 2, y(w1[i]) + lw / 2, whisker);
      orientedRect(ctx, g, c - half, c + half, y(q1[i]), y(q3[i]), hot ? col : pick(ramp, 0.75));
      orientedRect(ctx, g, c - half, c + half, y(q2[i]) - lw / 2, y(q2[i]) + lw / 2, th.snow);
      for (final v in stats[i].out) {
        final p = y(v);
        if (ctx.horizontal) {
          g.disc(p, ctx.grid.rows - c, maxD(0.6, lw * 0.7), col, 0.9);
        } else {
          g.disc(c, p, maxD(0.6, lw * 0.7), col, 0.9);
        }
      }
    }
  },
  rowsAt: (ctx, f, i) {
    final stats = _stats(f);
    if (i >= stats.length) return const [];
    final s = stats[i], color = f['color'] as RGB;
    TipRow row(String name, double v) => TipRow(color, name, ctx.format(v));
    return [
      row('max', s.w1), row('q3', s.q3), row('median', s.q2), row('q1', s.q1), row('min', s.w0),
      if (s.out.isNotEmpty) TipRow(color, 'outliers', '${s.out.length}'),
    ];
  },
  legend: noLegend,
);

// ── waterfall ───────────────────────────────────────────────────────────────────────────

final ChartTypeDef _waterfall = ChartTypeDef(
  kind: 'cartesian',
  band: true,
  keyed: const ['px', 'v0', 'v1'],
  model: (ctx) {
    final o = ctx.opts, rows = ctx.rows, first = rows.isNotEmpty ? rows[0] : const <String, dynamic>{};
    Object? vk = firstOf(o['y']);
    if (vk == null) {
      for (final k in first.keys) {
        if (first[k] is num && k != 'total') {
          vk = k;
          break;
        }
      }
    }
    final gv = getter(vk);
    final labels = rowLabels(ctx);
    var run = 0.0;
    final v0 = <double>[], v1 = <double>[], kind = <String>[], deltas = <double>[];
    for (var i = 0; i < rows.length; i++) {
      final d = num_(gv(rows[i], i));
      if (rows[i]['total'] == true || !d.isFinite) {
        v0.add(0);
        v1.add(run);
        kind.add('total');
        deltas.add(run);
      } else {
        v0.add(run);
        run += d;
        v1.add(run);
        kind.add(d >= 0 ? 'up' : 'down');
        deltas.add(d);
      }
    }
    final th = ctx.theme, total = ctx.colorOf('total', 0);
    return Built({'px': _indices(labels.length), 'v0': v0, 'v1': v1}, {
      'labels': labels, 'xs': _indices(labels.length), 'keys': keysOf(labels), 'kind': kind, 'deltas': deltas, 'v0': v0, 'v1': v1,
      'ramps': {'up': shades(th.fade, th.up, 0.5, 1), 'down': shades(th.fade, th.down, 0.5, 1), 'total': shades(th.fade, total, 0.5, 1)},
      'colors': {'up': th.up, 'down': th.down, 'total': total}, //
    });
  },
  keys: keysOfFixed,
  xinfo: categoryXInfo,
  extents: (ctx, f) {
    var lo = 0.0, hi = 0.0;
    final v0 = (f['v0'] as List).cast<double>(), v1 = (f['v1'] as List).cast<double>();
    visibleRange(ctx, labelsOf(f).length, (i) {
      lo = minD(minD(lo, v0[i]), v1[i]);
      hi = maxD(maxD(hi, v0[i]), v1[i]);
    });
    return [Extent(lo, hi, 'left', zero: true)];
  },
  raster: (ctx, m, f, g) {
    final bw = ctx.band.abs(), inner = bw * 0.7, mv0 = dl(m['v0']), mv1 = dl(m['v1']);
    final kind = (f['kind'] as List).cast<String>(), ramps = (f['ramps'] as Map).cast<String, List<RGB>>();
    for (var i = 0; i < mv0.length; i++) {
      final c = ctx.xAt(m, i);
      var a0 = c - inner / 2, a1 = c + inner / 2;
      if (inner >= 2.5) {
        a0 = jsRound(a0);
        a1 = jsRound(a1);
      }
      final p0 = ctx.y(mv0[i]), p1 = ctx.y(mv1[i]), ramp = ramps[kind[i]]!;
      orientedRect(ctx, g, a0, a1, p0, p1, tipShade(ctx, ctx.hover == i ? [for (final x in ramp) mix(x, ctx.theme.snow, 0.3)] : ramp, p0, p1));
      if (i + 1 < mv0.length) {
        // dotted connector to the next bar
        final y = floorI(p1), next = ctx.xAt(m, i + 1) - inner / 2;
        for (var x = ceilI(a1); x < next; x += ctx.grid.cell <= 4 ? 2 : 1) {
          if (ctx.horizontal) {
            g.plot(y, ctx.grid.rows - 1 - x, 0.3, ctx.theme.grid);
          } else {
            g.plot(x, y, 0.3, ctx.theme.grid);
          }
        }
      }
    }
  },
  rowsAt: (ctx, f, i) {
    final k = (f['kind'] as List)[i] as String, colors = (f['colors'] as Map).cast<String, RGB>();
    final delta = dbl((f['deltas'] as List)[i]);
    return [
      TipRow(colors[k]!, k == 'total' ? 'total' : 'change', (k == 'up' ? '+' : '') + ctx.format(delta)),
      if (k != 'total') TipRow(colors['total']!, 'running', ctx.format(dbl((f['v1'] as List)[i]))),
    ];
  },
  legend: noLegend,
);

final Map<String, ChartTypeDef> cartesianTypes = {
  'line': _lineLike(false),
  'area': _lineLike(true),
  'bar': _bar,
  'histogram': _histogram,
  'scatter': _scatter,
  'bubble': _scatter,
  'range': _range,
  'candlestick': _candles('candle'),
  'ohlc': _candles('ohlc'),
  'boxplot': _boxplot,
  'waterfall': _waterfall,
};
