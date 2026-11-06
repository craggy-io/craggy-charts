// Grid chart types: heatmap, calendar, waffle, treemap, funnel, stat.
import 'dart:math' as math;

import '../core/data.dart';
import '../core/field.dart';
import '../core/format.dart';
import '../core/model_types.dart';
import '../core/types.dart';
import '../core/util.dart';
import 'cartesian.dart' show firstNumberKey;
import 'common.dart';

// ── heatmap / calendar ──────────────────────────────────────────────────────────────────

List<bool> _has(Fixed f) => (f['has'] as List).cast<bool>();

/// Value to colour: the terrain ramp, or the diverging ramp when the data crosses zero.
RGB _heatColor(Ctx ctx, Fixed f, double v) {
  final th = ctx.theme;
  if (f['diverging'] == true) return ramp(th.diverging, 0.5 + 0.5 * clamp(v, -1, 1));
  return v <= 0.004 ? th.grid : ramp(th.terrain, 0.36 + 0.64 * clamp(v));
}

/// Normalise raw values to [0, 1] (or [-1, 1] when diverging).
(bool, List<double>) _normalise(List<double> raw) {
  final fin = raw.where((x) => x.isFinite);
  final lo = minOf(fin, 0), hi = maxOf(fin, 0), diverging = lo < 0 && hi > 0;
  final scale = diverging ? maxD(-lo, hi) : hi > 0 ? hi : jsOr(-lo, 1);
  return (diverging, [for (final x in raw) x.isFinite ? x / jsOr(scale, 1) : 0.0]);
}

({int block, int gap, int top, int left}) _heatFit(Ctx ctx, Fixed f) {
  final cols = ctx.grid.cols, rows = ctx.grid.rows, nx = f['nx'] as int, ny = f['ny'] as int;
  final block = math.max(1, minD(cols / math.max(1, nx), rows / math.max(1, ny)).floor());
  return (block: block, gap: block >= 3 ? 1 : 0, top: ((rows - ny * block) / 2).floor(), left: ((cols - nx * block) / 2).floor());
}

ChartTypeDef _heatType(Built Function(Ctx ctx) model) => ChartTypeDef(
      kind: 'grid',
      model: model,
      margin: (ctx) {
        if (ctx.opts['axes'] == false) return const Margin(1, 1, 1, 1);
        final o = ctx.opts, yk = truthy(o['y']) ? jsString(o['y']) : 'y';
        final ys = o['type'] == 'calendar' ? ['Mon'] : {for (final r in ctx.rows) labelText(r[yk])}.toList();
        return Margin(minD(90, maxOf(ys.map((s) => s.length), 3) * charW + 12), 6, 6, 20);
      },
      raster: (ctx, m, f, g) {
        final fit = _heatFit(ctx, f), grid = ctx.grid, block = fit.block, gap = fit.gap;
        final nx = f['nx'] as int, ny = f['ny'] as int, has = _has(f), mv = dl(m['v']), diverging = f['diverging'] == true;
        for (var yi = 0; yi < ny; yi++) {
          for (var xi = 0; xi < nx; xi++) {
            final i = yi * nx + xi;
            if (!has[i]) continue;
            final v = mv[i], y1 = grid.rows - fit.top - yi * block, x0 = fit.left + xi * block, hot = ctx.hover == i;
            final lit = diverging ? v.abs() > 0.004 : v > 0.004;
            g.rect(x0.toDouble(), (y1 - block + gap).toDouble(), (x0 + block - gap).toDouble(), y1.toDouble(), hot ? ctx.theme.snow : _heatColor(ctx, f, v), lit || hot ? 1 : 0.45);
          }
        }
        if (ctx.opts['axes'] == false) return;
        final yLabels = (f['yLabels'] as List).cast<String>(), xLabels = (f['xLabels'] as List).cast<String>(), sparse = f['sparse'] == true;
        for (var yi = 0; yi < yLabels.length; yi++) {
          if (yLabels[yi].isNotEmpty) ctx.out.labelsY.add(LabelY(grid.oy + (fit.top + (yi + 0.5) * block - gap / 2) * grid.cell, yLabels[yi], 'left'));
        }
        final below = grid.oy + (fit.top + ny * block) * grid.cell + 10;
        final stride = math.max(1, ((maxOf(xLabels.map((t) => t.length), 1) * charW + 12) / (block * grid.cell)).ceil());
        for (var xi = 0; xi < xLabels.length; xi++) {
          final t = xLabels[xi];
          if (t.isEmpty || (!sparse && xi % stride != 0)) continue;
          final x = grid.ox + (fit.left + (sparse ? xi : xi + 0.5) * block) * grid.cell;
          ctx.out.texts.add(TextItem(x: x, y: below, text: t, align: sparse ? 'left' : 'center'));
        }
      },
      pick: (ctx, _, f, x, y) {
        final fit = _heatFit(ctx, f), nx = f['nx'] as int, ny = f['ny'] as int;
        final xi = ((x - fit.left) / fit.block).floor(), yi = ((ctx.grid.rows - fit.top - y) / fit.block).floor();
        if (xi < 0 || yi < 0 || xi >= nx || yi >= ny) return -1;
        final i = yi * nx + xi;
        return _has(f)[i] ? i : -1;
      },
      tip: (ctx, m, f, id) {
        final has = _has(f);
        if (id >= has.length || !has[id]) return null;
        final title = (f['titles'] as List)[id] as String, raw = dbl((f['raw'] as List)[id]);
        return Hit(
          index: id,
          title: title,
          rows: [TipRow(_heatColor(ctx, f, dbl((m['v'] as List)[id])), truthy(ctx.opts['label']) ? jsString(ctx.opts['label']) : 'value', ctx.format(raw))],
          point: ChartPoint(type: ctx.opts['type'] as String, index: id, label: title, value: raw, row: (f['rows'] as List)[id] as Row?),
        );
      },
      ids: (_, f) {
        final has = _has(f);
        return [for (var i = 0; i < has.length; i++) if (has[i]) i];
      },
      anchor: (ctx, _, f, id) {
        final fit = _heatFit(ctx, f), nx = f['nx'] as int, xi = id % nx, yi = id ~/ nx;
        return (fit.left + (xi + 0.5) * fit.block, ctx.grid.rows - fit.top - (yi + 0.5) * fit.block);
      },
      count: (f) => _has(f).where((h) => h).length,
    );

final ChartTypeDef _heatmap = _heatType((ctx) {
  final o = ctx.opts, d = ctx.rows;
  final xk = truthy(o['x']) ? o['x'] : 'x', yk = truthy(firstOf(o['y'])) ? firstOf(o['y']) : 'y';
  final vk = o['value'] is String && truthy(o['value']) ? o['value'] : 'value';
  final gx = getter(xk), gy = getter(yk), gv = getter(vk);
  final xs = <String>[], ys = <String>[];
  for (var i = 0; i < d.length; i++) {
    final a = labelText(gx(d[i], i)), b = labelText(gy(d[i], i));
    if (!xs.contains(a)) xs.add(a);
    if (!ys.contains(b)) ys.add(b);
  }
  final n = xs.length * ys.length;
  final raw = List<double>.filled(n, double.nan, growable: true), has = List<bool>.filled(n, false, growable: true);
  final rows = List<Row?>.filled(n, null, growable: true);
  for (var i = 0; i < d.length; i++) {
    final k = ys.indexOf(labelText(gy(d[i], i))) * xs.length + xs.indexOf(labelText(gx(d[i], i)));
    raw[k] = num_(gv(d[i], i));
    has[k] = true;
    rows[k] = d[i];
  }
  final titles = [for (final y in ys) for (final x in xs) '$x · $y'];
  final (diverging, v) = _normalise(raw);
  return Built({'v': v}, {'nx': xs.length, 'ny': ys.length, 'raw': raw, 'has': has, 'titles': titles, 'xLabels': xs, 'yLabels': ys, 'diverging': diverging, 'rows': rows});
});

const double _day = 864e5;

final ChartTypeDef _calendar = _heatType((ctx) {
  final o = ctx.opts, dk = truthy(o['x']) ? o['x'] : 'date';
  final vk = o['value'] is String && truthy(o['value']) ? o['value'] : truthy(firstOf(o['y'])) ? firstOf(o['y']) : 'value';
  final gd = getter(dk), gv = getter(vk);
  final days = stableSorted<({double t, double v, Row r})>([
    for (var i = 0; i < ctx.rows.length; i++)
      () {
        final time = toTime(gd(ctx.rows[i], i));
        return (t: time.isFinite ? (time / _day).floorToDouble() * _day : double.nan, v: num_(gv(ctx.rows[i], i)), r: ctx.rows[i]);
      }(),
  ].where((d) => d.t.isFinite), (a, b) => cmp(a.t - b.t));
  if (days.isEmpty) {
    return Built({'v': <double>[]}, {'nx': 0, 'ny': 7, 'raw': <double>[], 'has': <bool>[], 'titles': <String>[], 'xLabels': <String>[], 'yLabels': <String>[], 'diverging': false, 'rows': <Row?>[]});
  }
  int dow(double t) => utc(t).weekday - 1; // Monday first
  final start = days[0].t - dow(days[0].t) * _day;
  final nx = ((days.last.t - start) / _day / 7).floor() + 1, n = nx * 7;
  final raw = List<double>.filled(n, double.nan, growable: true), has = List<bool>.filled(n, false, growable: true);
  final titles = List<String>.filled(n, '', growable: true), rows = List<Row?>.filled(n, null, growable: true);
  for (final d in days) {
    final i = dow(d.t) * nx + (jsRound((d.t - start) / _day) / 7).floor();
    raw[i] = raw[i].isFinite ? raw[i] + d.v : d.v;
    has[i] = true;
    rows[i] = d.r;
    titles[i] = isoDate(d.t);
  }
  final xLabels = [
    for (var w = 0; w < nx; w++)
      () {
        final a = utc(start + w * 7 * _day + 6 * _day), b = utc(start + (w - 1) * 7 * _day + 6 * _day); // each week's Sunday
        return w == 0 || a.month != b.month ? monthName(a.month - 1) : '';
      }(),
  ];
  final (diverging, v) = _normalise(raw);
  return Built({'v': v}, {
    'nx': nx, 'ny': 7, 'raw': raw, 'has': has, 'titles': titles, 'xLabels': xLabels, 'sparse': true,
    'yLabels': const ['Mon', '', 'Wed', '', 'Fri', '', ''], 'diverging': diverging, 'rows': rows, //
  });
});

// ── waffle ──────────────────────────────────────────────────────────────────────────────

({int u, int nx, int ny, int k, int block, int x0, int y0}) _waffleGeo(Ctx ctx) {
  final uu = truthy(ctx.opts['units']) ? (ctx.opts['units'] as num).toInt() : 100, cols = ctx.grid.cols, rows = ctx.grid.rows;
  var best = (10, (uu / 10).ceilToDouble(), 0);
  for (final nx in const [10, 20, 25, 50, 5, 4, 2, 1]) {
    final ny = uu / nx, k = minD(cols / nx, rows / ny).floor();
    if (ny == ny.roundToDouble() && k > best.$3) best = (nx, ny, k);
  }
  final (nx, ny0, k0) = best;
  final k = math.max(1, k0);
  final ny = ny0.toInt();
  return (u: uu, nx: nx, ny: ny, k: k, block: k >= 3 ? k - 1 : k, x0: ((cols - nx * k) / 2).floor(), y0: ((rows - ny * k) / 2).floor());
}

/// Largest-remainder split of the units between categories, in data order.
List<int> waffleOwners(List<double> v, int u) {
  final total = jsOr(sum(v), 1), exact = [for (final x in v) (maxD(0, x) / total) * u];
  final counts = [for (final e in exact) e.floor()];
  var left = sum(v) > 0 ? u - counts.fold(0, (s, c) => s + c) : 0;
  final order = stableSorted<(double, int)>([for (var i = 0; i < exact.length; i++) (exact[i] - exact[i].floor(), i)], (a, b) => cmp(b.$1 - a.$1, a.$2 - b.$2));
  for (final (_, i) in order) {
    if (left > 0 && v[i] > 0) {
      counts[i]++;
      left--;
    }
  }
  return [for (var i = 0; i < counts.length; i++) for (var k = 0; k < counts[i]; k++) i];
}

final ChartTypeDef _waffle = ChartTypeDef(
  kind: 'grid',
  margin: polarMargin,
  keyed: const ['v'],
  model: (ctx) {
    final f = catFixed(ctx);
    return Built({'v': shownValues(ctx, f)}, f);
  },
  keys: keysOfFixed,
  raster: (ctx, m, f, g) {
    final geo = _waffleGeo(ctx), owners = waffleOwners(dl(m['v']), geo.u), th = ctx.theme, colors = colorsOf(f);
    void cellAt(int u, RGB c, [double scale = 1]) {
      final x = geo.x0 + (u % geo.nx) * geo.k, top = ctx.grid.rows - geo.y0 - (u ~/ geo.nx) * geo.k;
      g.rect(x.toDouble(), (top - geo.block).toDouble(), (x + geo.block).toDouble(), top.toDouble(), c, scale);
    }

    for (var u = owners.length; u < geo.u; u++) {
      cellAt(u, th.grid, 0.3);
    }
    for (var u = 0; u < owners.length; u++) {
      final j = owners[u];
      cellAt(u, ctx.hover == j ? mix(colors[j], th.snow, 0.35) : colors[j]);
    }
  },
  pick: (ctx, m, _, x, y) {
    final geo = _waffleGeo(ctx), ux = ((x - geo.x0) / geo.k).floor(), uy = ((ctx.grid.rows - geo.y0 - y) / geo.k).floor();
    if (ux < 0 || uy < 0 || ux >= geo.nx || uy >= geo.ny) return -1;
    final owners = waffleOwners(dl(m['v']), geo.u), u = uy * geo.nx + ux;
    return u < owners.length ? owners[u] : -1;
  },
  tip: (ctx, _, f, id) => shareHit(ctx, f, id),
  ids: visibleIds,
  anchor: (ctx, m, _, id) {
    final geo = _waffleGeo(ctx), u = waffleOwners(dl(m['v']), geo.u).indexOf(id);
    return u < 0
        ? (ctx.grid.cols / 2, ctx.grid.rows / 2)
        : (geo.x0 + (u % geo.nx) * geo.k + geo.k / 2, ctx.grid.rows - geo.y0 - (u ~/ geo.nx) * geo.k - geo.k / 2);
  },
  legend: categoryLegend,
  count: (f) => labelsOf(f).length,
);

// ── treemap ─────────────────────────────────────────────────────────────────────────────

/// A laid-out item: id and its rectangle (x, y down from the top, w, h) in tiles.
typedef TreeRect = (int id, double x, double y, double w, double h);

/// Squarified layout (Bruls et al.) of weighted ids into the rectangle (x, y, w, h).
List<TreeRect> squarify(List<(int, double)> items, double x, double y, double w, double h) {
  final list = items.where((p) => p.$2 > 1e-9).toList(), out = <TreeRect>[], total = jsOr(sum(list.map((p) => p.$2)), 1);
  final area = [for (final p in list) (p.$2 / total) * w * h];
  double worst(List<double> row, double s) {
    final t = sum(row);
    return maxOf(row.map((a) => maxD((s * s * a) / (t * t), (t * t) / (s * s * a))));
  }

  var k = 0;
  while (k < list.length) {
    final short = minD(w, h), row = <double>[];
    var best = double.infinity;
    while (k < list.length) {
      final next = worst([...row, area[k]], short);
      if (row.isNotEmpty && next > best) break;
      row.add(area[k++]);
      best = next;
    }
    final thick = sum(row) / jsOr(short, 1), first = k - row.length;
    var p = 0.0;
    for (var j = 0; j < row.length; j++) {
      final len = row[j] / jsOr(thick, 1), id = list[first + j].$1;
      out.add(w >= h ? (id, x, y + p, thick, len) : (id, x + p, y, len, thick));
      p += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
  }
  return out;
}

List<List<int>>? _treeGroups(Fixed f) => f['groups'] == null ? null : [for (final g in f['groups'] as List) (g as List).cast<int>()];

int _byWeight((int, double) a, (int, double) b) => cmp(b.$2 - a.$2, a.$1 - b.$1);

List<TreeRect> _treeRects(Ctx ctx, Model m, Fixed f) {
  final cols = ctx.grid.cols.toDouble(), rows = ctx.grid.rows.toDouble(), mv = dl(m['v']), groups = _treeGroups(f);
  List<(int, double)> byWeight(List<int> ids) => stableSorted([for (final i in ids) (i, mv[i])], _byWeight);
  if (groups == null) return squarify(byWeight(List.generate(labelsOf(f).length, (i) => i)), 0, 0, cols, rows);
  final weights = [for (var gi = 0; gi < groups.length; gi++) (gi, sum([for (final i in groups[gi]) mv[i]]))];
  final out = <TreeRect>[];
  for (final (gi, gx, gy, gw, gh) in squarify(stableSorted(weights, _byWeight), 0, 0, cols, rows)) {
    final pad = gw > 6 && gh > 6 ? 0.5 : 0.0;
    out.addAll(squarify(byWeight(groups[gi]), gx + pad, gy + pad, gw - pad * 2, gh - pad * 2));
  }
  return out;
}

final ChartTypeDef _treemap = ChartTypeDef(
  kind: 'grid',
  margin: polarMargin,
  keyed: const ['v'],
  model: (ctx) {
    final f = catFixed(ctx), o = ctx.opts, frows = (f['rows'] as List).cast<Row>();
    List<List<int>>? groups;
    var groupNames = <String>[];
    if (truthy(o['by'])) {
      final by = jsString(o['by']);
      groupNames = {for (final r in frows) jsString(r[by])}.toList();
      groups = [
        for (final n in groupNames) [for (var i = 0; i < frows.length; i++) if (jsString(frows[i][by]) == n) i],
      ];
    }
    final colorKey = groups != null ? groupNames : namesOf(f);
    final colors = [for (var i = 0; i < colorKey.length; i++) ctx.colorOf(colorKey[i], i)];
    final itemColor = [
      for (var i = 0; i < labelsOf(f).length; i++) groups != null ? colors[groups.indexWhere((g) => g.contains(i))] : colors[i],
    ];
    return Built({'v': shownValues(ctx, f)}, {
      ...f, 'names': colorKey, 'colors': colors, 'itemColor': itemColor, 'groups': groups, 'groupNames': groupNames,
      'max': maxOf(valuesOf(f), 1e-9), //
    });
  },
  keys: keysOfFixed,
  raster: (ctx, m, f, g) {
    final grid = ctx.grid, th = ctx.theme, rows = grid.rows, itemColor = (f['itemColor'] as List).cast<RGB>(), values = valuesOf(f);
    final labels = labelsOf(f), max = dbl(f['max']);
    for (final (i, x, y, w, h) in _treeRects(ctx, m, f)) {
      final snap = w >= 3 && h >= 3;
      final x0 = snap ? jsRound(x) : x + 0.25, x1 = snap ? jsRound(x + w) - 1 : x + w - 0.25;
      final y0 = snap ? jsRound(y) + 1 : y + 0.25, y1 = snap ? jsRound(y + h) : y + h - 0.25;
      if (!(x1 > x0 && y1 > y0)) continue;
      final base = mix(itemColor[i], th.snow, ctx.hover == i ? 0.3 : 0), rampI = shades(th.fade, base, 0.45 + 0.3 * (values[i] / max), 1, 8);
      // Rows count up from the bottom, so the top of each block (y1) is its brightest edge.
      g.rect(x0, rows - y1, x1, rows - y0, (int _, int r) => pick(rampI, (r + 0.5 - (rows - y1)) / jsOr(y1 - y0, 1)));
      if (w * grid.cell > 64 && h * grid.cell > 34) {
        final (tx, ty) = px(ctx, x0, rows - y0);
        ctx.out.texts.add(TextItem(x: tx + 6, y: ty + 11, text: labels[i] == null ? '' : labelText(labels[i]), align: 'left', color: 'textHi', bg: 'tooltip', weight: 700, size: 11));
        ctx.out.texts.add(TextItem(x: tx + 6, y: ty + 29, text: ctx.format(values[i]), align: 'left', bg: 'tooltip'));
      }
    }
  },
  pick: (ctx, m, f, x, y) {
    final ty = ctx.grid.rows - y;
    for (final (id, rx, ry, w, h) in _treeRects(ctx, m, f)) {
      if (x >= rx && x < rx + w && ty >= ry && ty < ry + h) return id;
    }
    return -1;
  },
  tip: (ctx, _, f, id) {
    final itemColor = (f['itemColor'] as List).cast<RGB>();
    final h = shareHit(ctx, {...f, 'colors': itemColor, 'names': [for (final l in labelsOf(f)) labelText(l)]}, id);
    final groups = _treeGroups(f);
    if (h != null && groups != null) {
      h.rows.add(TipRow(itemColor[id], jsString(ctx.opts['by']), (f['groupNames'] as List<String>)[groups.indexWhere((g) => g.contains(id))]));
    }
    return h;
  },
  ids: (ctx, f) {
    final labels = labelsOf(f), values = valuesOf(f);
    return [for (var i = 0; i < labels.length; i++) if (values[i] > 0 && !ctx.hidden.contains(labelText(labels[i]))) i];
  },
  anchor: (ctx, m, f, id) {
    for (final (rid, x, y, w, h) in _treeRects(ctx, m, f)) {
      if (rid == id) return (x + w / 2, ctx.grid.rows - (y + h / 2));
    }
    return (ctx.grid.cols / 2, ctx.grid.rows / 2);
  },
  legend: (_, f) {
    final names = namesOf(f), colors = colorsOf(f);
    return [for (var i = 0; i < names.length; i++) (name: names[i], color: colors[i])];
  },
  count: (f) => labelsOf(f).length,
);

// ── funnel ──────────────────────────────────────────────────────────────────────────────

(double, double) Function(int i) _funnelAt(Ctx ctx, int n) {
  final rows = ctx.grid.rows, band = rows / math.max(1, n), gap = band >= 3 ? 1 : band >= 2 ? 0.5 : 0;
  return (i) => (rows - (i + 1) * band + gap / 2, rows - i * band - gap / 2);
}

final ChartTypeDef _funnel = ChartTypeDef(
  kind: 'grid',
  margin: (ctx) => Margin(4, ctx.opts['labels'] == false ? 4 : 44, 4, 4),
  keyed: const ['v'],
  model: (ctx) {
    final f = catFixed(ctx.withOpts({...ctx.opts, 'sort': ctx.opts['sort'] ?? false}));
    final name = truthy(ctx.opts['label']) ? jsString(ctx.opts['label']) : 'funnel', base = truthy(ctx.opts['colors']) ? null : ctx.colorOf(name, 0);
    final n = labelsOf(f).length;
    final colors = base != null ? [for (var i = 0; i < n; i++) mix(base, ctx.theme.fade, (i / math.max(1, n)) * 0.45)] : colorsOf(f);
    return Built({'v': shownValues(ctx, f)}, {
      ...f, 'colors': colors, 'max': maxOf(valuesOf(f), 1e-9), 'ramps': [for (final c in colors) shades(ctx.theme.fade, c, 0.6, 1)], //
    });
  },
  keys: keysOfFixed,
  raster: (ctx, m, f, g) {
    final mv = dl(m['v']), n = mv.length, grid = ctx.grid, cols = grid.cols, at = _funnelAt(ctx, n), cx = cols / 2;
    final max = dbl(f['max']), ramps = (f['ramps'] as List).cast<List<RGB>>(), names = namesOf(f), values = valuesOf(f);
    for (var i = 0; i < n; i++) {
      final (y0, y1) = at(i);
      final half = (cols / 2) * clamp(mv[i] / max);
      final hot = ctx.hover == i;
      if (half < 0.05) continue;
      g.rect(cx - half, y0, cx + half, y1, (int c, int _) => pick(ramps[i], hot ? 1 : 0.55 + 0.45 * (1 - (c + 0.5 - cx).abs() / jsOr(half, 1))));
      if ((y1 - y0) * grid.cell < 12) continue;
      final (tx, ty) = px(ctx, cx, (y0 + y1) / 2);
      ctx.out.texts.add(TextItem(x: tx, y: ty, text: '${names[i]}  ${ctx.format(values[i])}', color: 'textHi', bg: 'tooltip'));
      if (ctx.opts['labels'] != false && i > 0) {
        ctx.out.texts.add(TextItem(x: grid.ox + cols * grid.cell + 40, y: ty, text: '${jsNum(jsRound((values[i] / jsOr(values[0], 1)) * 100))}%', align: 'right'));
      }
    }
  },
  pick: (ctx, m, f, x, y) {
    final mv = dl(m['v']), n = mv.length, at = _funnelAt(ctx, n), cx = ctx.grid.cols / 2, max = dbl(f['max']);
    for (var i = 0; i < n; i++) {
      final (y0, y1) = at(i);
      final half = (ctx.grid.cols / 2) * clamp(mv[i] / max);
      if (y >= y0 && y <= y1 && (x - cx).abs() <= maxD(half, 2)) return i;
    }
    return -1;
  },
  tip: (ctx, _, f, id) {
    final h = shareHit(ctx, f, id, false), values = valuesOf(f), colors = colorsOf(f);
    String pct(double a, double b) => '${jsNum(jsRound((a / jsOr(b, 1)) * 100))}%';
    if (h != null && id > 0) {
      h.rows
        ..add(TipRow(colors[id], 'of first', pct(values[id], values[0])))
        ..add(TipRow(colors[id], 'of previous', pct(values[id], values[id - 1])));
    }
    return h;
  },
  ids: visibleIds,
  anchor: (ctx, m, _, id) {
    final (y0, y1) = _funnelAt(ctx, dl(m['v']).length)(id);
    return (ctx.grid.cols / 2, (y0 + y1) / 2);
  },
  legend: noLegend,
  count: (f) => labelsOf(f).length,
);

// ── stat ────────────────────────────────────────────────────────────────────────────────

/// 5x7 tile font for the big number.
const Map<String, List<String>> glyphs = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ',': ['00', '00', '00', '00', '01', '01', '10'],
  '%': ['11001', '11001', '00010', '00100', '01000', '10011', '10011'],
  '\$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  '–': ['000', '000', '000', '111', '000', '000', '000'],
  '+': ['000', '000', '010', '111', '010', '000', '000'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'],
  'k': ['1000', '1000', '1001', '1010', '1100', '1010', '1001'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  's': ['0000', '0000', '0111', '1000', '0110', '0001', '1110'],
  'm': ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
  'h': ['1000', '1000', '1110', '1001', '1001', '1001', '1001'],
  'd': ['0001', '0001', '0111', '1001', '1001', '1001', '0111'],
};

Iterable<String> _chars(String text) => text.runes.map(String.fromCharCode);
List<String> _glyph(String ch) => glyphs[ch] ?? glyphs[' ']!;

/// Tile width of a string in the glyph font (one tile of spacing between glyphs).
int glyphWidth(String text) {
  var w = 0, i = 0;
  for (final ch in _chars(text)) {
    w += _glyph(ch)[0].length + (i++ > 0 ? 1 : 0);
  }
  return w;
}

void _drawGlyphs(Raster g, String text, int x, int top, int scale, PaintFn color) {
  var cx = x;
  for (final ch in _chars(text)) {
    final rows = _glyph(ch);
    for (var r = 0; r < 7; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] != '1') continue;
        final x0 = cx + c * scale, y1 = top - r * scale;
        g.rect(x0.toDouble(), (y1 - scale).toDouble(), (x0 + scale).toDouble(), y1.toDouble(), color);
      }
    }
    cx += (rows[0].length + 1) * scale;
  }
}

({int scale, int top, int left, int sparkRows}) _statGeo(Ctx ctx, String text, bool spark) {
  final cols = ctx.grid.cols, rows = ctx.grid.rows, numRows = spark ? (rows * 0.58).floor() : rows;
  final w = glyphWidth(text), scale = math.max(1, minD(cols / math.max(1, w), numRows / 7).floor());
  return (scale: scale, top: rows - ((numRows - 7 * scale) / 2).floor(), left: ((cols - w * scale) / 2).floor(), sparkRows: spark ? rows - numRows - 1 : 0);
}

final ChartTypeDef _stat = ChartTypeDef(
  kind: 'grid',
  margin: (ctx) => Margin(2, 2, truthy(ctx.opts['label']) ? 20 : 2, 2),
  model: (ctx) {
    final o = ctx.opts, first = ctx.rows.isNotEmpty ? ctx.rows[0] : null;
    final vk = firstOf(o['y']) ?? (o['value'] is String ? o['value'] : null) ?? firstNumberKey(first) ?? 'value';
    final gv = getter(vk);
    final spark = [for (var i = 0; i < ctx.rows.length; i++) num_(gv(ctx.rows[i], i))]..removeWhere((v) => !v.isFinite);
    final v = o['value'] is num ? dbl(o['value']) : spark.isNotEmpty ? spark.last : 0.0;
    final name = truthy(o['label']) ? jsString(o['label']) : 'value', color = ctx.colorOf(name, 0);
    final lo = minOf(spark), hi = maxOf(spark);
    return Built(
      {'v': v, 's': [for (final x in spark) hi > lo ? (x - lo) / (hi - lo) : 0.5]},
      {'v': v, 'spark': spark, 'color': color, 'names': [name], 'ramp': shades(ctx.theme.fade, color, 0.35, 0.75), 'first': spark.isNotEmpty ? spark[0] : double.nan},
    );
  },
  raster: (ctx, m, f, g) {
    final th = ctx.theme, fv = dbl(f['v']), text = ctx.format(roundLike(dbl(m['v']), fv)), ms = dl(m['s']), spark = ms.length > 1;
    final geo = _statGeo(ctx, text, spark), hot = ctx.hover == 0, grid = ctx.grid;
    final glyphTop = geo.top, h = 7 * geo.scale;
    _drawGlyphs(g, text, geo.left, glyphTop, geo.scale, (_, r) => mix(hot ? th.snow : th.textHi, th.snow, (r - (glyphTop - h)) / jsOr(h, 1) * 0.3));
    final ramp = (f['ramp'] as List).cast<RGB>(), sparkRows = geo.sparkRows;
    if (spark && sparkRows >= 2) {
      final n = ms.length, xs = [for (var i = 0; i < n; i++) 0.5 + (i / (n - 1)) * (grid.cols - 1)];
      final ys = [for (final v in ms) 0.5 + v * (sparkRows - 1)];
      for (var c = 0; c < grid.cols; c++) {
        final t = (c + 0.5 - 0.5) / (grid.cols - 1) * (n - 1), i = math.min(n - 2, floorI(t)), y = ys[i] + (ys[i + 1] - ys[i]) * (t - i);
        g.rect(c.toDouble(), 0, c + 1.0, y, (int _, int r) => pick(ramp, r / math.max(1, sparkRows)), 0.8);
      }
      g.line([for (var i = 0; i < n; i++) ...[xs[i], ys[i]]], maxD(1, 2.4 / grid.cell), f['color'] as RGB);
    }
    final label = truthy(ctx.opts['label']) ? jsString(ctx.opts['label']) : null;
    if (label != null) ctx.out.texts.add(TextItem(x: grid.ox, y: grid.oy - 10, text: label, align: 'left'));
    final first = dbl(f['first']);
    if (spark && first.isFinite && first != 0 && label != null) {
      final d = (fv - first) / first.abs() * 100, up = d >= 0;
      ctx.out.texts.add(TextItem(
        x: grid.ox + grid.cols * grid.cell,
        y: grid.oy - 10,
        text: '${up ? '▲' : '▼'} ${d.abs().toStringAsFixed(1)}%',
        align: 'right',
        color: up ? th.up : th.down,
        weight: 700,
      ));
    }
  },
  pick: (_, _, _, _, _) => 0,
  tip: (ctx, _, f, _) => Hit(
    index: 0,
    title: truthy(ctx.opts['label']) ? jsString(ctx.opts['label']) : 'value',
    rows: [TipRow(f['color'] as RGB, 'value', ctx.format(dbl(f['v'])))],
    point: ChartPoint(type: 'stat', index: 0, value: dbl(f['v'])),
  ),
  ids: (_, _) => const [0],
  anchor: (ctx, _, _, _) => (ctx.grid.cols / 2, ctx.grid.rows / 2),
  count: (_) => 1,
);

final Map<String, ChartTypeDef> gridTypes = {
  'heatmap': _heatmap,
  'calendar': _calendar,
  'waffle': _waffle,
  'treemap': _treemap,
  'funnel': _funnel,
  'stat': _stat,
};
