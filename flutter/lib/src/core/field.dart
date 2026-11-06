// The tile field and its rasteriser. Geometry is drawn as *coverage* per tile (0..1) plus a colour;
// coverage becomes tile size, which is how tiles anti-alias. Coordinates are in tiles, x to the
// right and y UP from the bottom of the plot.
import 'dart:math' as math;
import 'dart:typed_data';

import 'util.dart';

/// Coverage and colour per tile, row-major from the top-left. Stored as float32, like the JS core.
class Field {
  Field(this.cols, this.rows)
      : cov = Float32List(cols * rows),
        col = Float32List(cols * rows * 3);
  final int cols, rows;
  final Float32List cov, col;
  void clear() => cov.fillRange(0, cov.length, 0);

  /// Index of the tile at column c and row r (r counted from the bottom).
  int at(int c, int r) => (rows - 1 - r) * cols + c;
}

/// A paint for [Raster.rect]: one colour, or a colour per tile (c, r).
typedef PaintFn = RGB Function(int c, int r);

/// Texture masks for accessibility patterns.
const Map<String, double Function(int c, int r)?> _masks = {
  'solid': null,
  'checker': _checker,
  'stripe': _stripe,
  'dots': _dots,
};
double _checker(int c, int r) => (c + r) & 1 != 0 ? 0.3 : 1;
double _stripe(int c, int r) => (c + r) % 3 == 0 ? 1 : 0.3;
double _dots(int c, int r) => (c & 1) == 0 && (r & 1) == 0 ? 1 : 0.25;

/// Draws geometry into a [Field].
class Raster {
  Raster(this.f, num cell)
      : cols = f.cols,
        rows = f.rows,
        _dotted = cell <= 4 ? 2 : 1,
        _dmin = Float64List(f.cols * f.rows),
        _stamp = Uint32List(f.cols * f.rows),
        _touched = Int32List(f.cols * f.rows);

  final Field f;
  final int cols, rows;
  final int _dotted;

  /// Texture applied to everything drawn until reset: 'solid' | 'checker' | 'stripe' | 'dots'.
  String pattern = 'solid';

  // Scratch for line(): nearest distance per tile, stamped with a generation so it never needs clearing.
  final Float64List _dmin;
  final Uint32List _stamp;
  final Int32List _touched;
  int _gen = 0;

  double Function(int c, int r)? get _mask => _masks[pattern];

  /// Write coverage + colour into tile i (pattern already applied).
  void _put(int i, double cov, RGB rgb) {
    final tcov = f.cov, tcol = f.col;
    if (cov < tcov[i] && cov < 0.5) return; // later layers win once they are solid enough
    if (cov > tcov[i]) tcov[i] = cov > 1 ? 1 : cov;
    tcol[i * 3] = rgb[0];
    tcol[i * 3 + 1] = rgb[1];
    tcol[i * 3 + 2] = rgb[2];
  }

  void plot(int c, int r, num cov, RGB rgb) {
    if (c < 0 || r < 0 || c >= cols || r >= rows || !(cov > 0.01)) return;
    final mask = _mask;
    _put((rows - 1 - r) * cols + c, mask != null ? cov * mask(c, r) : cov.toDouble(), rgb);
  }

  /// One tile column filled from `base` to `tip` (tile y), shaded along `ramp` from base to tip
  /// (t ** gamma). The fast path for area and band fills.
  void span(int c, double base, double tip, List<RGB> ramp, [double gamma = 1, double scale = 1]) {
    final a = minD(base, tip), b = maxD(base, tip), len = tip - base;
    if (c < 0 || c >= cols || !(b - a > 0.01)) return;
    final r0 = math.max(0, floorI(a)), r1 = math.min(rows - 1, ceilI(b) - 1), last = ramp.length - 1, mask = _mask;
    for (var r = r0; r <= r1; r++) {
      final cov = (minD(r + 1, b) - maxD(r, a)) * scale;
      if (!(cov > 0.01)) continue;
      var t = (r + 0.5 - base) / len;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      _put((rows - 1 - r) * cols + c, mask != null ? cov * mask(c, r) : cov, ramp[jsRoundInt((gamma == 1 ? t : math.pow(t, gamma)) * last)]);
    }
  }

  /// Filled rectangle with area coverage at its edges. `paint` is an [RGB] or a [PaintFn].
  void rect(double x0, double y0, double x1, double y1, Object paint, [double scale = 1]) {
    if (x1 < x0) (x0, x1) = (x1, x0);
    if (y1 < y0) (y0, y1) = (y1, y0);
    if (!(x1 > x0) || !(y1 > y0)) return;
    final c0 = math.max(0, floorI(x0)), c1 = math.min(cols - 1, ceilI(x1) - 1);
    final r0 = math.max(0, floorI(y0)), r1 = math.min(rows - 1, ceilI(y1) - 1);
    final fn = paint is PaintFn ? paint : null, rgb = fn == null ? paint as RGB : null;
    for (var c = c0; c <= c1; c++) {
      final ox = overlap(c, c + 1, x0, x1);
      if (ox <= 0) continue;
      for (var r = r0; r <= r1; r++) {
        plot(c, r, ox * overlap(r, r + 1, y0, y1) * scale, fn != null ? fn(c, r) : rgb!);
      }
    }
  }

  /// Polyline (x, y pairs; NaN breaks it) with anti-aliased coverage.
  void line(List<double> pts, double width, RGB rgb, [double scale = 1]) {
    // Nearest-segment distance per tile (squared, no sqrt in the inner loop), then one plot per
    // touched tile. Same coverage as plotting every segment, at a fraction of the cost.
    final hw = maxD(0.7, width / 2), reach = hw + 0.4, reach2 = reach * reach;
    _gen++;
    final gen = _gen & 0xFFFFFFFF;
    var nt = 0;
    for (var p = 0; p + 3 < pts.length; p += 2) {
      final ax = pts[p], ay = pts[p + 1], bx = pts[p + 2], by = pts[p + 3];
      if (!(ax + ay + bx + by).isFinite) continue; // gaps in the data break the line
      final c0 = math.max(0, floorI(minD(ax, bx) - reach)), c1 = math.min(cols - 1, floorI(maxD(ax, bx) + reach));
      final r0 = math.max(0, floorI(minD(ay, by) - reach)), r1 = math.min(rows - 1, floorI(maxD(ay, by) + reach));
      final dx = bx - ax, dy = by - ay, l2s = dx * dx + dy * dy, l2 = l2s == 0 ? 1e-9 : l2s;
      for (var c = c0; c <= c1; c++) {
        final px = c + 0.5 - ax;
        for (var r = r0; r <= r1; r++) {
          final py = r + 0.5 - ay;
          var t = (px * dx + py * dy) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          final ex = px - dx * t, ey = py - dy * t, d2 = ex * ex + ey * ey;
          if (d2 >= reach2) continue;
          final i = (rows - 1 - r) * cols + c;
          if (_stamp[i] != gen) {
            _stamp[i] = gen;
            _dmin[i] = d2;
            _touched[nt++] = i;
          } else if (d2 < _dmin[i]) {
            _dmin[i] = d2;
          }
        }
      }
    }
    for (var k = 0; k < nt; k++) {
      final i = _touched[k];
      plot(i % cols, rows - 1 - i ~/ cols, clamp((reach - math.sqrt(_dmin[i])) * 1.8) * scale, rgb);
    }
  }

  void disc(double x, double y, double rad, RGB rgb, [double scale = 1]) {
    if (!(x + y + rad).isFinite) return;
    for (var c = floorI(x - rad - 1); c <= x + rad + 1; c++) {
      for (var r = floorI(y - rad - 1); r <= y + rad + 1; r++) {
        plot(c, r, clamp(rad + 0.5 - hypot(c + 0.5 - x, r + 0.5 - y)) * scale, rgb);
      }
    }
  }

  /// Filled polygon (even-odd rule) at a constant coverage.
  void polygon(List<double> pts, RGB rgb, double cov) {
    var x0 = double.infinity, x1 = double.negativeInfinity, y0 = double.infinity, y1 = double.negativeInfinity;
    for (var i = 0; i < pts.length; i += 2) {
      x0 = minD(x0, pts[i]);
      x1 = maxD(x1, pts[i]);
      y0 = minD(y0, pts[i + 1]);
      y1 = maxD(y1, pts[i + 1]);
    }
    if (!x0.isFinite || !y0.isFinite) return;
    for (var c = math.max(0, floorI(x0)); c <= minD(cols - 1, x1); c++) {
      for (var r = math.max(0, floorI(y0)); r <= minD(rows - 1, y1); r++) {
        final px = c + 0.5, py = r + 0.5;
        var inside = false;
        for (var i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
          final xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
          if ((yi > py) != (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) plot(c, r, cov, rgb);
      }
    }
  }

  /// Annular sector, angles clockwise from 12 o'clock. `gap` is the space between neighbours in tiles.
  void sector(double cx, double cy, double r0, double r1, double a0, double a1, double gap, RGB Function(double d, double rel) paint,
      [double scale = 1]) {
    final span = a1 - a0;
    if (!(span > 0) || !(r1 > r0)) return;
    if (!(cx + cy).isFinite) return;
    final full = span >= tau - 1e-9, start = jsMod(jsMod(a0, tau) + tau, tau);
    for (var c = math.max(0, floorI(cx - r1 - 1)); c <= minD(cols - 1, cx + r1 + 1); c++) {
      for (var r = math.max(0, floorI(cy - r1 - 1)); r <= minD(rows - 1, cy + r1 + 1); r++) {
        final dx = c + 0.5 - cx, dy = r + 0.5 - cy, d = hypot(dx, dy);
        if (d > r1 + 1 || d < r0 - 1) continue;
        final radial = clamp(minD(d - r0, r1 - d) + 0.5);
        if (radial <= 0) continue;
        var rel = math.atan2(dx, dy) - start;
        rel = jsMod(jsMod(rel, tau) + tau, tau);
        var ang = 1.0;
        if (!full) {
          if (rel > span) {
            final back = tau - rel;
            if (back * d > 1) continue;
            rel = -back;
          }
          ang = clamp(minD(rel, span - rel) * maxD(d, 0.5) - gap / 2 + 0.5);
        }
        final cov = minD(radial, ang) * scale;
        if (cov > 0.01) plot(c, r, cov, paint(d, clamp(rel / span)));
      }
    }
  }

  void hline(int row, RGB rgb, double cov) {
    for (var c = 0; c < cols; c += _dotted) {
      plot(c, row, cov, rgb);
    }
  }

  void vline(int col, RGB rgb, double cov) {
    for (var r = 0; r < rows; r += _dotted) {
      plot(col, r, cov, rgb);
    }
  }
}

/// Catmull-Rom through the points, clamped per segment so curves never overshoot the data.
List<double> smooth(List<double> xs, List<double> ys, int sub) {
  final n = xs.length, out = <double>[];
  if (n < 3 || sub <= 1) {
    for (var i = 0; i < n; i++) {
      out
        ..add(xs[i])
        ..add(ys[i]);
    }
    return out;
  }
  double y(int i) => i >= 0 && i < n ? ys[i] : double.nan;
  for (var i = 0; i < n - 1; i++) {
    final p1 = ys[i], p2 = ys[i + 1];
    if (!p1.isFinite || !p2.isFinite) {
      out
        ..add(xs[i])
        ..add(p1);
      continue;
    }
    final p0 = y(i - 1).isFinite ? y(i - 1) : p1, p3 = y(i + 2).isFinite ? y(i + 2) : p2;
    final lo = minD(p1, p2), hi = maxD(p1, p2);
    for (var s = 0; s < sub; s++) {
      final t = s / sub, t2 = t * t, t3 = t2 * t;
      out
        ..add(xs[i] + (xs[i + 1] - xs[i]) * t)
        ..add(clamp(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3), lo, hi));
    }
  }
  out
    ..add(xs[n - 1])
    ..add(ys[n - 1]);
  return out;
}

/// Horizontal-then-vertical steps through the points.
List<double> steps(List<double> xs, List<double> ys) {
  final out = <double>[];
  for (var i = 0; i < xs.length; i++) {
    if (i > 0) {
      final mid = (xs[i - 1] + xs[i]) / 2;
      out.addAll([mid, ys[i - 1], mid, ys[i]]);
    }
    out
      ..add(xs[i])
      ..add(ys[i]);
  }
  return out;
}

/// Height of a polyline at every tile column centre (NaN outside it or across gaps).
Float64List columnsY(List<double> pts, int cols) {
  final ys = Float64List(cols)..fillRange(0, cols, double.nan);
  if (pts.length < 4) return ys;
  var j = 0;
  for (var c = 0; c < cols; c++) {
    final x = c + 0.5;
    if (x < pts[0] || x > pts[pts.length - 2]) continue;
    while (j + 3 < pts.length && pts[j + 2] < x) {
      j += 2;
    }
    final x0 = pts[j], y0 = pts[j + 1];
    final x1 = j + 2 < pts.length ? pts[j + 2] : x0, y1 = j + 3 < pts.length ? pts[j + 3] : y0;
    final dxs = x1 - x0;
    ys[c] = y0 + (y1 - y0) * ((x - x0) / (dxs == 0 || dxs.isNaN ? 1 : dxs));
  }
  return ys;
}

/// M4 decimation: per tile column keep the first, min, max and last point, so a million points
/// draw as about 4 x columns. `xs` are tile x positions (ascending). Returns the kept indices.
List<int> decimate(List<double> xs, List<double> ys, int cols) {
  final out = <int>[];
  final n = xs.length;
  var i = 0;
  while (i < n) {
    final c = xs[i].isFinite ? xs[i].floor() : null;
    final first = i;
    var last = i, mn = i, mx = i;
    while (i < n && (xs[i].isFinite ? xs[i].floor() : null) == c) {
      if (ys[i] < ys[mn]) mn = i;
      if (ys[i] > ys[mx]) mx = i;
      last = i++;
    }
    if (c == null && i == first) i++; // NaN never equals itself in JS: a lone point
    final a = math.min(mn, mx), b = math.max(mn, mx);
    out.add(first);
    if (a != first) out.add(a);
    if (b != a && b != first) out.add(b);
    if (last != b && last != first) out.add(last);
    if (c != null && c >= cols && out.length > 4) break;
  }
  return out;
}
