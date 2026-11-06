// Radial chart types: pie, donut, gauge, radialBar, radar, rose, progress.
import 'dart:math' as math;

import '../core/format.dart';
import '../core/model_types.dart';
import '../core/ticks.dart';
import '../core/types.dart';
import '../core/util.dart';
import 'common.dart';

/// Plot centre and radius of a round chart (tiles).
(double, double, double) _disc(Ctx ctx, [double pad = 1]) =>
    (ctx.grid.cols / 2, ctx.grid.rows / 2, maxD(1, math.min(ctx.grid.cols, ctx.grid.rows) / 2 - pad));

List<dynamic> _catOrWide(Ctx ctx) {
  final rows = ctx.rows, first = rows.isNotEmpty ? rows[0] : const <String, dynamic>{};
  Object? k = ctx.opts['x'];
  if (k == null) {
    for (final q in first.keys) {
      if (first[q] is! num) {
        k = q;
        break;
      }
    }
  }
  return k == null ? [for (var i = 0; i < rows.length; i++) i] : [for (final r in rows) r[jsString(k)]];
}

/// Margin that leaves room for labels around a round chart.
Margin _labelMargin(Ctx ctx) {
  final w = minD(90, maxOf(_catOrWide(ctx).map((l) => math.min(14, labelText(l).length)), 0) * charW + 12);
  return Margin(w, w, 18, 18);
}

/// Cumulative slice angles of the shown values.
List<(double, double)> _slices(List<double> v, [double span = tau]) {
  final total = jsOr(sum(v), 1);
  var a = 0.0;
  return [
    for (final x in v)
      () {
        final a0 = a;
        a += (maxD(0, x) / total) * span;
        return (a0, a);
      }(),
  ];
}

double _inner(Ctx ctx, double dflt) => ctx.opts['inner'] != null ? dbl(ctx.opts['inner']) : dflt;
List<List<RGB>> _ramps(Fixed f) => (f['ramps'] as List).cast<List<RGB>>();

// ── pie / donut ─────────────────────────────────────────────────────────────────────────

ChartTypeDef _pieLike(double inner) => ChartTypeDef(
      kind: 'polar',
      margin: polarMargin,
      hoverModel: true,
      keyed: const ['v', 'ex'],
      model: (ctx) {
        final f = catFixed(ctx);
        return Built(
          {'v': shownValues(ctx, f), 'ex': [for (var i = 0; i < labelsOf(f).length; i++) i == ctx.hover ? 1.0 : 0.0]},
          {...f, 'ramps': [for (final c in colorsOf(f)) shades(ctx.theme.fade, c, 0.55, 1)]},
        );
      },
      keys: keysOfFixed,
      raster: (ctx, m, f, g) {
        final (cx, cy, r) = _disc(ctx, 1.2);
        final r0 = r * _inner(ctx, inner);
        final mv = dl(m['v']);
        final ex = dl(m['ex']);
        final sl = _slices(mv);
        final gap = maxD(0.35, 2.5 / ctx.grid.cell), ramps = _ramps(f);
        for (var j = 0; j < sl.length; j++) {
          final (a0, a1) = sl[j];
          if (a1 - a0 < 1e-4) continue;
          final rj = r + ex[j] * minD(1.2, r * 0.06);
          g.sector(cx, cy, r0, rj, a0, a1, gap, (d, _) => pick(ramps[j], ((d - r0) / jsOr(rj - r0, 1)) * 0.6 + 0.4 + ex[j] * 0.2));
        }
        final total = sum(mv), shownTotal = jsOr(sum(shownValues(ctx, f)), 1);
        final showLabels = ctx.opts['labels'] != null ? ctx.opts['labels'] == true : r0 == 0;
        if (showLabels && r * ctx.grid.cell > 50) {
          for (var j = 0; j < sl.length; j++) {
            final (a0, a1) = sl[j];
            if ((a1 - a0) / tau < 0.06) continue;
            final mid = (a0 + a1) / 2, rr = r0 + (r - r0) * (r0 != 0 ? 0.5 : 0.62);
            final (x, y) = px(ctx, cx + math.sin(mid) * rr, cy + math.cos(mid) * rr);
            ctx.out.texts.add(TextItem(x: x, y: y, text: '${jsNum(jsRound((mv[j] / jsOr(total, 1)) * 100))}%', color: 'textHi', bg: 'tooltip', weight: 700));
          }
        }
        if (r0 > 3 && ctx.opts['axes'] != false) {
          final hot = ctx.hover >= 0 && ctx.hover < labelsOf(f).length;
          final size = maxD(12, minD(34, r0 * ctx.grid.cell * 0.42));
          centreText(ctx, cx, cy, ctx.format(hot ? valuesOf(f)[ctx.hover] : roundLike(total, shownTotal)),
              hot ? namesOf(f)[ctx.hover] : truthy(ctx.opts['label']) ? jsString(ctx.opts['label']) : 'total', size);
        }
      },
      pick: (ctx, m, _, x, y) {
        final (cx, cy, r) = _disc(ctx, 1.2);
        final r0 = r * _inner(ctx, inner);
        final d = hypot(x - cx, y - cy);
        if (d > r + 1.5 || d < r0 - 0.5) return -1;
        final a = angleOf(x, y, cx, cy);
        return _slices(dl(m['v'])).indexWhere((s) => a >= s.$1 && a < s.$2 && s.$2 - s.$1 > 1e-4);
      },
      tip: (ctx, _, f, id) => shareHit(ctx, f, id),
      ids: visibleIds,
      anchor: (ctx, m, _, id) {
        final (cx, cy, r) = _disc(ctx, 1.2);
        final r0 = r * _inner(ctx, inner);
        final sl = _slices(dl(m['v']));
        final (a0, a1) = id < sl.length ? sl[id] : (0.0, 0.0);
        final mid = (a0 + a1) / 2, rr = (r0 + r) / 2;
        return (cx + math.sin(mid) * rr, cy + math.cos(mid) * rr);
      },
      legend: categoryLegend,
      count: (f) => labelsOf(f).length,
    );

// ── gauge ───────────────────────────────────────────────────────────────────────────────

const double _gaugeSpan = math.pi * 1.5, _gaugeStart = -math.pi * 0.75;

(double, double, double, double) _gaugeGeo(Ctx ctx) {
  final cols = ctx.grid.cols, rows = ctx.grid.rows;
  final r = maxD(2, minD(cols / 2 - 1, (rows - 2) / 1.707)), cx = cols / 2, cy = 1 + 0.707 * r + (rows - 2 - 1.707 * r) / 2;
  return (cx, cy, r, r * _inner(ctx, 0.74));
}

double _gaugeValue(Map<String, dynamic> o) => o['value'] is num ? dbl(o['value']) : jsOr(toNum(o['value']), 0);
double _optOr(Map<String, dynamic> o, String k, double d) => o[k] != null ? dbl(o[k]) : d;
String _labelOr(Ctx ctx, String d) => truthy(ctx.opts['label']) ? jsString(ctx.opts['label']) : d;

final ChartTypeDef _gauge = ChartTypeDef(
  kind: 'polar',
  margin: polarMargin,
  model: (ctx) {
    final o = ctx.opts, min = _optOr(o, 'min', 0), max = _optOr(o, 'max', 100), v = _gaugeValue(o);
    final color = truthy(o['colors']) ? ctx.colorOf(_labelOr(ctx, 'value'), 0) : null;
    return Built({'f': clamp((v - min) / jsOr(max - min, 1))}, {'min': min, 'max': max, 'v': v, 'color': color, 'names': [_labelOr(ctx, 'value')]});
  },
  raster: (ctx, m, f, g) {
    final (cx, cy, r, r0) = _gaugeGeo(ctx);
    final th = ctx.theme;
    final mf = dbl(m['f']);
    final color = f['color'] as RGB?;
    g.sector(cx, cy, r0, r, _gaugeStart, _gaugeStart + _gaugeSpan, 0, (_, _) => th.grid, 0.4);
    final hot = ctx.hover == 0;
    if (mf > 0.002) {
      g.sector(cx, cy, r0, r, _gaugeStart, _gaugeStart + _gaugeSpan * mf, 0, (_, rel) {
        if (rel > 1 - 0.03 / maxD(mf, 0.03)) return th.snow; // bright leading edge
        final t = rel * (0.6 + 0.4 * mf);
        final c = color != null ? mix(th.fade, color, 0.45 + 0.55 * t) : ramp(th.terrain, 0.5 + 0.5 * t);
        return hot ? mix(c, th.snow, 0.25) : c;
      });
    }
    final size = maxD(14, minD(40, r0 * ctx.grid.cell * 0.5));
    final min = dbl(f['min']), max = dbl(f['max']);
    centreText(ctx, cx, cy, ctx.format(roundLike(min + mf * (max - min), dbl(f['v']))), truthy(ctx.opts['label']) ? jsString(ctx.opts['label']) : null, size);
  },
  pick: (ctx, _, _, x, y) {
    final (cx, cy, r, r0) = _gaugeGeo(ctx);
    final d = hypot(x - cx, y - cy);
    return d <= r + 1 && d >= r0 - 1 ? 0 : -1;
  },
  tip: (ctx, _, f, _) {
    final c = f['color'] as RGB? ?? ctx.theme.palette[0];
    return Hit(
      index: 0,
      title: _labelOr(ctx, 'value'),
      rows: [TipRow(c, 'of ${ctx.format(dbl(f['max']))}', ctx.format(dbl(f['v'])))],
      point: ChartPoint(type: 'gauge', index: 0, value: dbl(f['v'])),
    );
  },
  ids: (_, _) => const [0],
  anchor: (ctx, _, _, _) {
    final (cx, cy, _, _) = _gaugeGeo(ctx);
    return (cx, cy);
  },
  count: (_) => 1,
);

// ── radialBar ───────────────────────────────────────────────────────────────────────────

(double, double, (double, double) Function(int i)) _ringsGeo(Ctx ctx, int n) {
  final (cx, cy, r) = _disc(ctx, 1);
  final hole = r * _inner(ctx, 0.25);
  final each = (r - hole) / math.max(1, n);
  final width = each >= 3 ? each - 1 : each * 0.75;
  return (cx, cy, (i) {
    final r1 = r - i * each;
    return (r1 - width, r1);
  });
}

final ChartTypeDef _radialBar = ChartTypeDef(
  kind: 'polar',
  margin: polarMargin,
  keyed: const ['v'],
  model: (ctx) {
    final f = catFixed(ctx), max = ctx.opts['max'] != null ? dbl(ctx.opts['max']) : niceTicks(0, maxOf(valuesOf(f), 1e-9), 4).max;
    return Built(
      {'v': [for (final v in shownValues(ctx, f)) clamp(v / jsOr(max, 1))]},
      {...f, 'max': max, 'ramps': [for (final c in colorsOf(f)) shades(ctx.theme.fade, c, 0.5, 1)]},
    );
  },
  keys: keysOfFixed,
  raster: (ctx, m, f, g) {
    final mv = dl(m['v']);
    final n = mv.length;
    final (cx, cy, ring) = _ringsGeo(ctx, n);
    final th = ctx.theme;
    final ramps = _ramps(f);
    for (var i = 0; i < n; i++) {
      final (r0, r1) = ring(i);
      final hot = ctx.hover == i;
      g.sector(cx, cy, r0, r1, 0, _gaugeSpan, 0, (_, _) => th.grid, 0.4);
      if (mv[i] > 0.002) g.sector(cx, cy, r0, r1, 0, _gaugeSpan * mv[i], 0, (_, rel) => pick(ramps[i], hot ? 1 : 0.45 + 0.55 * rel));
      if (ctx.opts['labels'] != false && (r1 - r0) * ctx.grid.cell >= 7) {
        final (x, y) = px(ctx, cx, cy + (r0 + r1) / 2);
        ctx.out.texts.add(TextItem(x: x - 6, y: y, text: '${namesOf(f)[i]} ${ctx.format(valuesOf(f)[i])}', align: 'right', color: hot ? 'textHi' : 'text'));
      }
    }
  },
  pick: (ctx, m, _, x, y) {
    final n = dl(m['v']).length;
    final (cx, cy, ring) = _ringsGeo(ctx, n);
    final d = hypot(x - cx, y - cy);
    final a = angleOf(x, y, cx, cy);
    if (a > _gaugeSpan + 0.1) return -1;
    for (var i = 0; i < n; i++) {
      final (r0, r1) = ring(i);
      if (d >= r0 - 0.5 && d <= r1 + 0.5) return i;
    }
    return -1;
  },
  tip: (ctx, _, f, id) => shareHit(ctx, f, id, false),
  ids: visibleIds,
  anchor: (ctx, m, _, id) {
    final (cx, cy, ring) = _ringsGeo(ctx, dl(m['v']).length);
    final (r0, r1) = ring(id);
    final r = (r0 + r1) / 2;
    return (cx + r, cy);
  },
  legend: categoryLegend,
  count: (f) => labelsOf(f).length,
);

// ── radar ───────────────────────────────────────────────────────────────────────────────

(double, double) Function(int i, double r) _radarPt(double cx, double cy, int n) =>
    (i, r) => (cx + math.sin((i / n) * tau) * r, cy + math.cos((i / n) * tau) * r);

final ChartTypeDef _radar = ChartTypeDef(
  kind: 'polar',
  margin: _labelMargin,
  keyed: const ['s'],
  model: (ctx) {
    final f = seriesFixed(ctx), values = [for (final v in f['values'] as List) (v as List).cast<double>()];
    final max = ctx.opts['max'] != null ? dbl(ctx.opts['max']) : niceTicks(0, maxOf([for (final v in values) ...v], 1e-9), 4).max;
    return Built({
      's': [for (final v in values) [for (final x in v) x.isFinite ? maxD(0, x) / max : 0.0]],
      'a': [for (final n in namesOf(f)) ctx.hidden.contains(n) ? 0.0 : 1.0],
    }, {...f, 'max': max});
  },
  keys: keysOfFixed,
  raster: (ctx, m, f, g) {
    final n = labelsOf(f).length;
    final (cx, cy, r) = _disc(ctx, 1);
    final th = ctx.theme;
    if (n < 3) return;
    final pt = _radarPt(cx, cy, n);
    List<double> ring(double rr) => [
          for (var i = 0; i <= n; i++) ...[pt(i % n, rr).$1, pt(i % n, rr).$2],
        ];
    for (var k = 1; k <= 4; k++) {
      g.line(ring((r * k) / 4), 0.5, th.grid, 0.45);
    }
    for (var i = 0; i < n; i++) {
      final (x, y) = pt(i, r);
      g.line([cx, cy, x, y], 0.5, ctx.hover == i ? th.snow : th.grid, ctx.hover == i ? 0.5 : 0.4);
    }
    final lw = maxD(1, 2.6 / ctx.grid.cell);
    final ms = [for (final v in m['s'] as List) dl(v)], ma = dl(m['a']), colors = colorsOf(f);
    double at(List<double> v, int i) => i < v.length && v[i] != 0 && !v[i].isNaN ? v[i] : 0;
    final shapes = [
      for (var s = 0; s < ms.length; s++)
        [
          for (var i = 0; i <= n; i++) ...[pt(i % n, at(ms[s], i % n) * r * ma[s]).$1, pt(i % n, at(ms[s], i % n) * r * ma[s]).$2],
        ],
    ];
    final visible = [for (var s = 0; s < shapes.length; s++) if (ma[s] >= 0.01) s].reversed.toList();
    for (final s in visible) {
      g.polygon(shapes[s], mix(th.fade, colors[s], 0.42), 0.62); // fills first,
    }
    for (final s in visible) {
      g.line(shapes[s], lw, colors[s]); // then every outline,
    }
    for (final s in visible) {
      // then the vertices
      for (var i = 0; i < n; i++) {
        final (x, y) = pt(i, at(ms[s], i) * r * ma[s]);
        g.disc(x, y, lw * 0.5 + 0.5, mix(colors[s], th.snow, ctx.hover == i ? 0.6 : 0.2));
      }
    }
    if (ctx.opts['axes'] == false) return;
    for (var i = 0; i < n; i++) {
      final sx = math.sin((i / n) * tau);
      final sy = math.cos((i / n) * tau);
      final (tx, ty) = pt(i, r);
      final (x, y) = px(ctx, tx, ty);
      ctx.out.texts.add(TextItem(
        x: x + sx * 8,
        y: y - sy * 9,
        text: labelText(labelsOf(f)[i]),
        align: sx.abs() < 0.2 ? 'center' : sx > 0 ? 'left' : 'right',
        color: ctx.hover == i ? 'textHi' : 'text',
      ));
    }
    for (var k = 2; k <= 4; k += 2) {
      final (x, y) = px(ctx, cx, cy + (r * k) / 4);
      ctx.out.texts.add(TextItem(x: x + 4, y: y + 6, text: ctx.format((dbl(f['max']) * k) / 4), align: 'left', size: 9, alpha: 0.7));
    }
  },
  pick: (ctx, _, f, x, y) {
    final n = labelsOf(f).length;
    final (cx, cy, r) = _disc(ctx, 1);
    if (n < 3 || hypot(x - cx, y - cy) > r + 2) return -1;
    return jsRoundInt((angleOf(x, y, cx, cy) / tau) * n) % n;
  },
  tip: (ctx, _, f, id) {
    final labels = labelsOf(f);
    if (!(id >= 0 && id < labels.length)) return null;
    final label = labelText(labels[id]);
    return Hit(index: id, title: label, rows: seriesRows(ctx, f, id), point: ChartPoint(type: 'radar', index: id, label: label, row: (f['rows'] as List)[id] as Row?));
  },
  ids: (_, f) => List.generate(labelsOf(f).length, (i) => i),
  anchor: (ctx, _, f, id) {
    final (cx, cy, r) = _disc(ctx, 1);
    return _radarPt(cx, cy, labelsOf(f).length)(id, r * 0.7);
  },
  legend: seriesLegend,
  count: (f) => labelsOf(f).length,
);

// ── rose ────────────────────────────────────────────────────────────────────────────────

final ChartTypeDef _rose = ChartTypeDef(
  kind: 'polar',
  margin: _labelMargin,
  keyed: const ['v'],
  model: (ctx) {
    final f = catFixed(ctx), max = maxOf(valuesOf(f), 1e-9);
    return Built(
      {'v': [for (final v in shownValues(ctx, f)) math.sqrt(v / max)]},
      {...f, 'max': max, 'ramps': [for (final c in colorsOf(f)) shades(ctx.theme.fade, c, 0.45, 1)]},
    );
  },
  keys: keysOfFixed,
  raster: (ctx, m, f, g) {
    final mv = dl(m['v']);
    final n = mv.length;
    final (cx, cy, r) = _disc(ctx, 1);
    final th = ctx.theme;
    final step = tau / math.max(1, n);
    if (n == 0) return;
    for (var k = 1; k <= 3; k++) {
      final rr = (r * k) / 3;
      g.line([for (var a = 0; a <= 64; a++) ...[cx + math.sin((a / 64) * tau) * rr, cy + math.cos((a / 64) * tau) * rr]], 0.5, th.grid, 0.35);
    }
    final gap = maxD(0.35, 2.5 / ctx.grid.cell), ramps = _ramps(f);
    for (var i = 0; i < n; i++) {
      final ri = mv[i] * r;
      if (ri < 0.3) continue;
      final hot = ctx.hover == i;
      g.sector(cx, cy, 0, ri, i * step, (i + 1) * step, gap, (d, _) => pick(ramps[i], hot ? 1 : 0.35 + 0.65 * (d / jsOr(ri, 1))));
    }
    if (ctx.opts['axes'] == false) return;
    for (var i = 0; i < n; i++) {
      final mid = (i + 0.5) * step;
      final sx = math.sin(mid);
      final sy = math.cos(mid);
      final (x, y) = px(ctx, cx + sx * r, cy + sy * r);
      ctx.out.texts.add(TextItem(
        x: x + sx * 8,
        y: y - sy * 9,
        text: namesOf(f)[i],
        align: sx.abs() < 0.2 ? 'center' : sx > 0 ? 'left' : 'right',
        color: ctx.hover == i ? 'textHi' : 'text',
      ));
    }
  },
  pick: (ctx, m, _, x, y) {
    final mv = dl(m['v']);
    final n = mv.length;
    final (cx, cy, r) = _disc(ctx, 1);
    if (n == 0) return -1;
    final i = ((angleOf(x, y, cx, cy) / tau) * n).floor() % n;
    return hypot(x - cx, y - cy) <= maxD(mv[i] * r, 2) + 1 ? i : -1;
  },
  tip: (ctx, _, f, id) => shareHit(ctx, f, id),
  ids: visibleIds,
  anchor: (ctx, m, _, id) {
    final mv = dl(m['v']);
    final (cx, cy, r) = _disc(ctx, 1);
    final mid = ((id + 0.5) / mv.length) * tau;
    final rr = mv[id] * r * 0.6;
    return (cx + math.sin(mid) * rr, cy + math.cos(mid) * rr);
  },
  legend: categoryLegend,
  count: (f) => labelsOf(f).length,
);

// ── progress ────────────────────────────────────────────────────────────────────────────

(double, double) _progressGeo(Ctx ctx) {
  final rows = ctx.grid.rows, thick = rows <= 6 ? rows : math.max(2, jsRoundInt(rows * 0.35));
  final y0 = ((rows - thick) / 2).floorToDouble();
  return (y0, y0 + thick);
}

final ChartTypeDef _progress = ChartTypeDef(
  kind: 'polar',
  margin: (ctx) => Margin(2, 2, truthy(ctx.opts['label']) || ctx.opts['axes'] != false ? 18 : 2, 2),
  model: (ctx) {
    final o = ctx.opts, min = _optOr(o, 'min', 0), max = _optOr(o, 'max', 100), v = _gaugeValue(o), name = _labelOr(ctx, 'progress');
    final color = ctx.colorOf(name, 0);
    return Built(
      {'f': clamp((v - min) / jsOr(max - min, 1))},
      {'min': min, 'max': max, 'v': v, 'color': color, 'names': [name], 'ramp': shades(ctx.theme.fade, color, 0.55, 1)},
    );
  },
  raster: (ctx, m, f, g) {
    final grid = ctx.grid;
    final cols = grid.cols;
    final (y0, y1) = _progressGeo(ctx);
    final th = ctx.theme;
    final hot = ctx.hover == 0;
    final mf = dbl(m['f']);
    final ramp = (f['ramp'] as List).cast<RGB>();
    g.rect(0, y0, cols.toDouble(), y1, th.grid, 0.26);
    final end = cols * mf;
    if (end > 0.01) g.rect(0, y0, end, y1, (int c, int _) => c >= end - 1 ? th.snow : pick(ramp, hot ? 1 : 0.4 + 0.6 * (c / maxD(1, end))));
    if (ctx.opts['axes'] == false && !truthy(ctx.opts['label'])) return;
    final top = grid.oy + (grid.rows - y1) * grid.cell - 7;
    if (truthy(ctx.opts['label'])) ctx.out.texts.add(TextItem(x: grid.ox, y: top, text: jsString(ctx.opts['label']), align: 'left', baseline: 'bottom'));
    final min = dbl(f['min']), max = dbl(f['max']), v = dbl(f['v']);
    final pct = max - min == 100 && min == 0
        ? ctx.format(roundLike(mf * 100, v)) + (truthy(ctx.opts['format']) ? '' : '%')
        : ctx.format(roundLike(min + mf * (max - min), v));
    ctx.out.texts.add(TextItem(x: grid.ox + cols * grid.cell, y: top, text: pct, align: 'right', baseline: 'bottom', color: 'textHi', weight: 700));
  },
  pick: (ctx, _, _, _, y) {
    final (y0, y1) = _progressGeo(ctx);
    return y >= y0 - 0.5 && y <= y1 + 0.5 ? 0 : -1;
  },
  tip: (ctx, _, f, _) => Hit(
    index: 0,
    title: _labelOr(ctx, 'progress'),
    rows: [TipRow(f['color'] as RGB, 'of ${ctx.format(dbl(f['max']))}', ctx.format(dbl(f['v'])))],
    point: ChartPoint(type: 'progress', index: 0, value: dbl(f['v'])),
  ),
  ids: (_, _) => const [0],
  anchor: (ctx, m, _, _) {
    final (_, y1) = _progressGeo(ctx);
    return (ctx.grid.cols * dbl(m['f']), y1);
  },
  count: (_) => 1,
);

final Map<String, ChartTypeDef> radialTypes = {
  'pie': _pieLike(0),
  'donut': _pieLike(0.62),
  'gauge': _gauge,
  'radialBar': _radialBar,
  'radar': _radar,
  'rose': _rose,
  'progress': _progress,
};
