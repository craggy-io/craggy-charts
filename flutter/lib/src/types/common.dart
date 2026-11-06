// Helpers shared by the chart types.
import 'dart:math' as math;

import '../core/data.dart';
import '../core/field.dart';
import '../core/format.dart';
import '../core/model_types.dart';
import '../core/types.dart';
import '../core/util.dart';

const Margin polarMarginValue = Margin(6, 6, 6, 6);
Margin polarMargin(Ctx _) => polarMarginValue;

/// Series options for one series name (an empty map when none).
Map<String, dynamic> seriesOpt(Ctx ctx, String name) => mapOf(mapOf(ctx.opts['series'])[name]);

/// Wide series plus colour, axis side and pattern per series.
Fixed seriesFixed(Ctx ctx) {
  final w = ctx.derive('wide', ctx.opts, () => wide(ctx.rows, ctx.opts));
  final names = w['names'] as List<String>;
  return {
    ...w,
    'colors': [for (var i = 0; i < names.length; i++) ctx.colorOf(names[i], i)],
    'sides': [for (final n in names) seriesOpt(ctx, n)['axis'] == 'right' ? 'right' : 'left'],
    'patterns': [for (final n in names) truthy(seriesOpt(ctx, n)['pattern']) ? seriesOpt(ctx, n)['pattern'] as String : 'solid'],
  };
}

List<String> namesOf(Fixed f) => (f['names'] as List).cast<String>();
List<RGB> colorsOf(Fixed f) => (f['colors'] as List).cast<RGB>();
List<dynamic> labelsOf(Fixed f) => f['labels'] as List;
List<String> keysOfFixed(Fixed f) => (f['keys'] as List).cast<String>();

XInfo xinfoOf(Fixed f, [String? kind]) => XInfo(kind ?? f['xKind'] as String, labelsOf(f), (f['xs'] as List).cast<double>(), keysOfFixed(f));
XInfo categoryXInfo(Fixed f) => xinfoOf(f, 'category');

List<LegendItem> seriesLegend(Ctx _, Fixed f) {
  final names = namesOf(f), colors = colorsOf(f);
  return [for (var i = 0; i < names.length; i++) (name: names[i], color: colors[i])];
}

List<LegendItem> categoryLegend(Ctx _, Fixed f) {
  final labels = labelsOf(f), colors = colorsOf(f);
  return [for (var i = 0; i < labels.length; i++) (name: labelText(labels[i]), color: colors[i])];
}

List<LegendItem> noLegend(Ctx _, Fixed f) => const [];

List<TipRow> seriesRows(Ctx ctx, Fixed f, int i, [String Function(int s)? extra]) {
  final names = namesOf(f), colors = colorsOf(f), values = f['values'] as List;
  return [
    for (var s = 0; s < names.length; s++)
      if (!ctx.hidden.contains(names[s]))
        () {
          final so = seriesOpt(ctx, names[s]);
          final row = values[s] as List;
          final v = i < row.length ? dbl(row[i]) : double.nan;
          final fmt = truthy(so['format']) ? (so['format'] is Function ? makeFormat(so['format']) : ctx.format) : ctx.format;
          final label = truthy(so['label']) ? jsString(so['label']) : names[s];
          return TipRow(colors[s], label, (v.isFinite ? fmt(v) : '–') + (extra != null ? extra(s) : ''));
        }(),
  ];
}

/// Rectangle in (category, value) space, oriented for vertical or horizontal charts. Category
/// coordinates come from ctx.x / ctx.xAt; for horizontal charts they run down from the top.
void orientedRect(Ctx ctx, Raster g, double a0, double a1, double p0, double p1, Object paint, [double scale = 1]) {
  if (ctx.horizontal) {
    final rows = ctx.grid.rows;
    g.rect(p0, rows - a1, p1, rows - a0, paint, scale); // paints receive field (c, r) either way
  } else {
    g.rect(a0, p0, a1, p1, paint, scale);
  }
}

/// Bar-like fill: darker at the base, brighter towards the tip. Returns a paint for orientedRect.
PaintFn tipShade(Ctx ctx, List<RGB> ramp, double p0, double p1) {
  final lo = minD(p0, p1), span = jsOr((p1 - p0).abs(), 1), up = p1 >= p0;
  return (c, r) {
    final along = ctx.horizontal ? c : r;
    final t = (along + 0.5 - lo) / span;
    return ramp[jsRoundInt(maxD(0, minD(1, 0.35 + 0.65 * (up ? t : 1 - t))) * (ramp.length - 1))];
  };
}

Map<String, dynamic> barRamps(Ctx ctx, List<RGB> colors) => {
      'ramps': [for (final c in colors) shades(ctx.theme.fade, c, 0.5, 1)],
      'hot': [for (final c in colors) shades(ctx.theme.fade, mix(c, ctx.theme.snow, 0.35), 0.6, 1)],
    };

/// Visible rows (respecting zoom) for extents.
void visibleRange(Ctx ctx, int n, void Function(int i) fn) {
  for (var i = 0; i < n; i++) {
    if (ctx.inView(i)) fn(i);
  }
}

// ── Part-to-whole helpers (pie, donut, rose, waffle, treemap, funnel, radialBar) ──────────

/// Label / value pairs plus a name and colour per category.
Fixed catFixed(Ctx ctx) {
  final c = ctx.derive('cats', ctx.opts, () => categories(ctx.rows, ctx.opts));
  final names = [for (final l in c['labels'] as List) labelText(l)];
  return {
    ...c,
    'names': names,
    'colors': [for (var i = 0; i < names.length; i++) ctx.colorOf(names[i], i)],
  };
}

List<double> valuesOf(Fixed f) => (f['values'] as List).cast<double>();

/// Category values with hidden ones at zero, so they animate out.
List<double> shownValues(Ctx ctx, Fixed f) {
  final v = valuesOf(f), names = namesOf(f);
  return [for (var i = 0; i < v.length; i++) ctx.hidden.contains(names[i]) ? 0.0 : v[i]];
}

/// Tooltip for category j: its value and share of the visible total.
Hit? shareHit(Ctx ctx, Fixed f, int j, [bool share = true]) {
  final labels = labelsOf(f), names = namesOf(f), values = valuesOf(f), colors = colorsOf(f);
  if (!(j >= 0 && j < labels.length)) return null;
  final total = jsOr(sum([for (var i = 0; i < values.length; i++) if (!ctx.hidden.contains(names[i])) values[i]]), 1);
  final value = ctx.format(values[j]);
  return Hit(
    index: j,
    title: names[j],
    rows: [TipRow(colors[j], share ? value : 'value', share ? '${jsNum(jsRound((values[j] / total) * 100))}%' : value)],
    point: ChartPoint(type: ctx.opts['type'] as String, index: j, label: names[j], value: values[j], row: (f['rows'] as List)[j] as Row?),
  );
}

List<int> visibleIds(Ctx ctx, Fixed f) {
  final names = namesOf(f);
  return [for (var i = 0; i < names.length; i++) if (!ctx.hidden.contains(names[i])) i];
}

/// Angle of (x, y) around (cx, cy), clockwise from 12 o'clock, in [0, tau).
double angleOf(double x, double y, double cx, double cy) {
  final a = math.atan2(x - cx, y - cy);
  return a < 0 ? a + math.pi * 2 : a;
}

/// Big centred number with a caption below (donut, gauge). Sizes in logical pixels.
void centreText(Ctx ctx, double cx, double cy, String big, String? small, double size) {
  final g = ctx.grid, px = g.ox + cx * g.cell, py = g.oy + (g.rows - cy) * g.cell;
  ctx.out.texts.add(TextItem(x: px, y: py - (small != null ? size * 0.18 : 0), text: big, size: size, weight: 700, color: 'textHi'));
  if (small != null) ctx.out.texts.add(TextItem(x: px, y: py + size * 0.62, text: small));
}

/// Logical pixel position of tile point (x, y).
(double, double) px(Ctx ctx, double x, double y) => (ctx.grid.ox + x * ctx.grid.cell, ctx.grid.oy + (ctx.grid.rows - y) * ctx.grid.cell);

/// A model list as doubles.
List<double> dl(Object? l) => [for (final v in l! as List) dbl(v)];
