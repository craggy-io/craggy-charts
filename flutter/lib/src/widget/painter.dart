// The renderer: every lit tile in one Canvas.drawRawAtlas call (a pre-rendered rounded square tinted
// per tile), the unlit panel as a cached picture, then the text layer through cached TextPainters.
// Follows js/src/render/canvas2d.ts (tiles and glow) and text.ts (labels).
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';

import '../core/chart_core.dart';
import '../core/export.dart';
import '../core/model_types.dart';
import '../core/util.dart';
import 'style.dart';

/// Side of the sprite in pixels; tiles are scaled down from it.
const double _spriteSide = 64;

/// Lit tile colour with the pointer glow mixed in (glowColor in tiles.ts).
RGB glowColor(Float32List col, Float32List glow, int i, RGB snow) {
  final g = glow[i] * 0.4, j = i * 3;
  return [col[j] + (snow[0] - col[j]) * g, col[j + 1] + (snow[1] - col[j + 1]) * g, col[j + 2] + (snow[2] - col[j + 2]) * g];
}

int _argb(RGB c) => rgbColor(c).toARGB32();

/// GPU-side resources of one chart: the tile sprite, the unlit panel and the per-frame buffers.
/// Owned by the widget state; call [dispose] with it.
class TileResources {
  ui.Image? _sprite;
  double _spriteRound = -1;
  ui.Picture? _panel;
  String _panelKey = '';
  Float32List _xf = Float32List(0), _rects = Float32List(0);
  Int32List _colors = Int32List(0);
  final Map<String, TextPainter> _text = {};

  /// White rounded square whose corner radius is [round] of its side.
  ui.Image sprite(double round) {
    if (_sprite != null && _spriteRound == round) return _sprite!;
    _sprite?.dispose();
    final rec = ui.PictureRecorder(), c = Canvas(rec);
    const s = _spriteSide;
    final r = math.min(s / 2, s * round);
    c.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(0, 0, s, s), Radius.circular(r)), Paint()..color = const Color(0xFFFFFFFF));
    final pic = rec.endRecording();
    _sprite = pic.toImageSync(s.toInt(), s.toInt());
    pic.dispose();
    _spriteRound = round;
    return _sprite!;
  }

  void _ensure(int n) {
    if (_colors.length >= n) return;
    final cap = math.max(n, _colors.length * 2);
    _xf = Float32List(cap * 4);
    _rects = Float32List(cap * 4);
    for (var i = 0; i < cap; i++) {
      _rects[i * 4 + 2] = _spriteSide;
      _rects[i * 4 + 3] = _spriteSide;
    }
    _colors = Int32List(cap);
  }

  void _atlas(Canvas canvas, ui.Image sprite, int n) {
    if (n == 0) return;
    canvas.drawRawAtlas(
      sprite,
      Float32List.sublistView(_xf, 0, n * 4),
      Float32List.sublistView(_rects, 0, n * 4),
      Int32List.sublistView(_colors, 0, n),
      BlendMode.modulate,
      null,
      Paint()..filterQuality = FilterQuality.medium,
    );
  }

  /// Queue tile k: a square of [side] with its top-left at (x, y).
  void _put(int k, double x, double y, double side, int argb) {
    _xf[k * 4] = side / _spriteSide;
    _xf[k * 4 + 1] = 0;
    _xf[k * 4 + 2] = x;
    _xf[k * 4 + 3] = y;
    _colors[k] = argb;
  }

  /// The unlit panel at the origin: every tile at full size in the unlit colour.
  ui.Picture panel(ChartCore core, TileShape shape, ui.Image sprite) {
    final g = core.grid!, th = core.theme;
    final key = [g.cols, g.rows, g.cell, shape.gap, shape.round, th.unlit.join(',')].join('|');
    if (_panel != null && key == _panelKey) return _panel!;
    _panel?.dispose();
    final cs = g.cell, full = cs * (1 - shape.gap), off = (cs - full) / 2, n = g.cols * g.rows, unlit = _argb(th.unlit);
    _ensure(n);
    var k = 0;
    for (var r = 0; r < g.rows; r++) {
      for (var c = 0; c < g.cols; c++) {
        _put(k++, c * cs + off, r * cs + off, full, unlit);
      }
    }
    final rec = ui.PictureRecorder();
    _atlas(Canvas(rec), sprite, k);
    _panel = rec.endRecording();
    _panelKey = key;
    return _panel!;
  }

  /// A laid-out painter for a label, cached by its text and style.
  TextPainter text(String s, TextStyle style) {
    final key = '$s\u0000${style.fontSize}\u0000${style.fontWeight?.value}\u0000${style.color?.toARGB32()}';
    final hit = _text[key];
    if (hit != null) return hit;
    if (_text.length > 600) clearText();
    return _text[key] = TextPainter(
      text: TextSpan(text: s, style: style),
      textDirection: TextDirection.ltr,
    )..layout();
  }

  void clearText() {
    for (final p in _text.values) {
      p.dispose();
    }
    _text.clear();
  }

  void dispose() {
    _sprite?.dispose();
    _panel?.dispose();
    _sprite = null;
    _panel = null;
    clearText();
  }

  /// Draw the unlit panel and the lit tiles (with glow) of a core.
  void paintTiles(Canvas canvas, ChartCore core) {
    final g = core.grid, f = core.field;
    if (g == null || f == null) return;
    final shape = tileShape(core.opts), cs = g.cell, full = cs * (1 - shape.gap);
    final sp = sprite(shape.round / (1 - shape.gap));
    canvas.save();
    canvas.translate(g.ox, g.oy);
    canvas.drawPicture(panel(core, shape, sp));
    canvas.restore();
    final size = core.size, col = core.col, glow = core.glow, snow = core.theme.snow, gridArgb = _argb(core.theme.grid);
    final n = f.cols * f.rows;
    _ensure(n);
    var k = 0;
    for (var i = 0; i < n; i++) {
      final s = size[i], gl = glow[i];
      if (s < 0.02 && gl < 0.02) continue;
      final c = i % f.cols, r = i ~/ f.cols;
      var side = full * math.min(1.25, s);
      final int argb;
      if (s < 0.02) {
        argb = gridArgb; // glow on an unlit tile
        side = full * gl * 0.9;
      } else {
        argb = gl > 0.01 ? _argb(glowColor(col, glow, i, snow)) : _argb([col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]);
      }
      _put(k++, g.ox + c * cs + (cs - side) / 2, g.oy + r * cs + (cs - side) / 2, side, argb);
    }
    _atlas(canvas, sp, k);
  }

  /// Axis labels and type texts on top of the tiles (drawText in text.ts).
  void paintText(Canvas canvas, ChartCore core) {
    final g = core.grid;
    if (g == null) return;
    final th = core.theme, base = chartText(rgbColor(th.text), 10);
    final below = g.oy + g.rows * g.cell + 11;
    for (final l in core.out.labelsX) {
      final p = text(l.text, base);
      p.paint(canvas, Offset(l.x - p.width / 2, below - p.height / 2));
    }
    for (final LabelY l in core.out.labelsY) {
      final p = text(l.text, base), left = l.side != 'right';
      p.paint(canvas, Offset(left ? g.ox - 7 - p.width : g.ox + g.cols * g.cell + 7, l.y - p.height / 2));
    }
    for (final t in core.out.texts) {
      _item(canvas, core, t);
    }
  }

  void _item(Canvas canvas, ChartCore core, TextItem t) {
    final th = core.theme, size = t.size;
    final p = text(t.text, chartText(itemColor(th, t.color, t.alpha), size, weightOf(t.weight)));
    final w = p.width;
    canvas.save();
    canvas.translate(t.x, t.y);
    if (t.rotate != 0) canvas.rotate(t.rotate * math.pi / 180);
    final bg = t.bg;
    if (bg != null) {
      const padX = 4.0;
      final h = size + 6;
      final x0 = t.align == 'left'
          ? -padX
          : t.align == 'right'
          ? -w - padX
          : -w / 2 - padX;
      final y0 = t.baseline == 'top'
          ? -3.0
          : t.baseline == 'bottom'
          ? -h + 3
          : -h / 2;
      final base = bg == 'tooltip' ? cssColor(th.tooltipBg) : rgbColor(bg as RGB);
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(x0, y0, w + padX * 2, h), const Radius.circular(3)),
        Paint()..color = base.withValues(alpha: base.a * t.alpha),
      );
    }
    final dx = t.align == 'left'
        ? 0.0
        : t.align == 'right'
        ? -w
        : -w / 2;
    final dy = t.baseline == 'top'
        ? 0.0
        : t.baseline == 'bottom'
        ? -p.height
        : -p.height / 2;
    p.paint(canvas, Offset(dx, dy));
    canvas.restore();
  }
}

/// Paints a core's current frame. Repaints whenever [repaint] notifies (each animation frame).
class ChartPainter extends CustomPainter {
  ChartPainter(this.core, this.res, Listenable repaint) : super(repaint: repaint);
  final ChartCore core;
  final TileResources res;

  @override
  void paint(Canvas canvas, Size size) {
    res.paintTiles(canvas, core);
    res.paintText(canvas, core);
  }

  @override
  bool shouldRepaint(ChartPainter old) => old.core != core || old.res != res;
}
