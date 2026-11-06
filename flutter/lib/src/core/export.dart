// SVG export of a settled core: the unlit panel as a pattern, one rounded rect per lit tile, and
// every label as text, so it prints sharply. Pure Dart, the same output as the JS toSVG().
import 'dart:math' as math;

import 'chart_core.dart';
import 'model_types.dart';
import 'theme.dart';
import 'util.dart';

/// Tile gap and corner radius as fractions of the cell.
typedef TileShape = ({double gap, double round});

TileShape tileShape(Map<String, dynamic> opts) => (
      gap: opts['gap'] != null ? dbl(opts['gap']) : (Tokens.tile['gap'] as num).toDouble(),
      round: opts['round'] != null ? dbl(opts['round']) : (Tokens.tile['radius'] as num).toDouble(),
    );

/// CSS `rgb()` of a colour (channels truncated, as in the JS core).
String css(RGB c) => 'rgb(${c[0].toInt()},${c[1].toInt()},${c[2].toInt()})';

String _esc(String s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
String _n(num v) => jsNum(double.parse(v.toStringAsFixed(2)));

/// Colour of a text item ('text', 'textHi' or an RGB).
RGB textColor(ChartTheme th, Object color) => color == 'textHi' ? th.textHi : color is RGB ? color : th.text;

String toSvg(ChartCore core) {
  final g = core.grid, f = core.field;
  if (g == null || f == null) return '<svg xmlns="http://www.w3.org/2000/svg"/>';
  final th = core.theme, shape = tileShape(core.opts), full = g.cell * (1 - shape.gap), off = (g.cell - full) / 2, r = g.cell * shape.round;
  final parts = <String>[
    '<svg xmlns="http://www.w3.org/2000/svg" width="${jsNum(g.w)}" height="${jsNum(g.h)}" viewBox="0 0 ${jsNum(g.w)} ${jsNum(g.h)}" font-family=\'${_esc(Tokens.font)}\'>',
    '<defs><pattern id="u" width="${jsNum(g.cell)}" height="${jsNum(g.cell)}" patternUnits="userSpaceOnUse" x="${_n(g.ox)}" y="${_n(g.oy)}"><rect x="${_n(off)}" y="${_n(off)}" width="${_n(full)}" height="${_n(full)}" rx="${_n(r)}" fill="${css(th.unlit)}"/></pattern></defs>',
    '<rect width="100%" height="100%" fill="${css(th.bg)}"/>',
    '<rect x="${_n(g.ox)}" y="${_n(g.oy)}" width="${_n(g.cols * g.cell)}" height="${_n(g.rows * g.cell)}" fill="url(#u)"/>',
  ];
  for (var i = 0; i < f.cols * f.rows; i++) {
    final s = math.min(1.25, core.size[i]);
    if (s < 0.02) continue;
    final side = full * s, c = i % f.cols, row = i ~/ f.cols;
    final x = g.ox + c * g.cell + (g.cell - side) / 2, y = g.oy + row * g.cell + (g.cell - side) / 2;
    parts.add('<rect x="${_n(x)}" y="${_n(y)}" width="${_n(side)}" height="${_n(side)}" rx="${_n(math.min(r, side / 2))}" fill="${css([core.col[i * 3], core.col[i * 3 + 1], core.col[i * 3 + 2]])}"/>');
  }
  void text(double x, double y, String s, String anchor, String fill, [double size = 10, int weight = 400, String extra = '']) => parts.add(
      '<text x="${_n(x)}" y="${_n(y)}" text-anchor="$anchor" dominant-baseline="middle" font-size="${jsNum(size)}" font-weight="$weight" fill="$fill"$extra>${_esc(s)}</text>');
  final below = g.oy + g.rows * g.cell + 11;
  for (final l in core.out.labelsX) {
    text(l.x, below, l.text, 'middle', css(th.text));
  }
  for (final l in core.out.labelsY) {
    text(l.side == 'right' ? g.ox + g.cols * g.cell + 7 : g.ox - 7, l.y, l.text, l.side == 'right' ? 'start' : 'end', css(th.text));
  }
  for (final TextItem t in core.out.texts) {
    final anchor = t.align == 'left' ? 'start' : t.align == 'right' ? 'end' : 'middle';
    text(t.x, t.y, t.text, anchor, css(textColor(th, t.color)), t.size, t.weight, t.rotate != 0 ? ' transform="rotate(${jsNum(t.rotate)} ${_n(t.x)} ${_n(t.y)})"' : '');
  }
  parts.add('</svg>');
  return parts.join();
}
