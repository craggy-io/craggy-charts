import 'dart:math' as math;

import 'util.dart';

/// Axis ticks: the covered range, the tick values and the step between them.
class Ticks {
  Ticks(this.min, this.max, this.ticks, this.step);
  double min, max;
  final List<double> ticks;
  final double step;
}

/// Round-number ticks covering [lo, hi].
Ticks niceTicks(num lo0, num hi0, [num count0 = 4]) {
  var lo = lo0.toDouble(), hi = hi0.toDouble();
  if (!lo.isFinite || !hi.isFinite) {
    lo = 0;
    hi = 1;
  }
  if (!(hi > lo)) {
    final a = lo.abs() * 0.1, p = a == 0 || a.isNaN ? 1.0 : a;
    lo -= p;
    hi += p;
  }
  final count = maxD(1, count0);
  final raw = (hi - lo) / count, mag = pow10(log10(raw).floor()), f = raw / mag;
  final step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  final min = (lo / step + 1e-9).floorToDouble() * step, max = (hi / step - 1e-9).ceilToDouble() * step;
  final ticks = <double>[];
  for (var k = 0, v = min; v <= max + step * 1e-6 && k < 1000; k++, v = min + k * step) {
    ticks.add(precise(v));
  }
  return Ticks(precise(min), precise(max), ticks, step);
}

/// Ticks in log10 space: values passed and returned are exponents.
Ticks logTicks(num lo, num hi) {
  final min = lo.floorToDouble(), max = math.max(min + 1, hi.ceilToDouble());
  return Ticks(min, max, [for (var v = min; v <= max; v++) v], 1);
}

const double _sec = 1e3, _min = 60e3, _hour = 3600e3, _day = 86400e3;
const _steps = [_sec, 5 * _sec, 15 * _sec, 30 * _sec, _min, 5 * _min, 15 * _min, 30 * _min, _hour, 3 * _hour, 6 * _hour, 12 * _hour, _day, 2 * _day, 7 * _day, 14 * _day];

/// Calendar-aligned ticks for a UTC time span (ms).
List<double> timeTicks(num t0, num t1, [num count = 5]) {
  final span = maxD(1, t1 - t0), target = span / maxD(1, count);
  final out = <double>[];
  for (final step in _steps) {
    if (step >= target) {
      for (var t = (t0 / step).ceilToDouble() * step; t <= t1 && out.length < 200; t += step) {
        out.add(t);
      }
      return out;
    }
  }
  // Months or years
  final d0 = DateTime.fromMillisecondsSinceEpoch(t0.toInt(), isUtc: true);
  final months = span / (30 * _day) / count;
  final mStep = months <= 1.25 ? 1 : months <= 2.5 ? 2 : months <= 3.5 ? 3 : months <= 7 ? 6 : 12 * (months / 12).ceil();
  final y = d0.year;
  var m = (( d0.month - 1) / mStep).ceil() * mStep;
  for (var k = 0; k < 400; k++) {
    final t = DateTime.utc(y + (m / 12).floor(), m % 12 + 1, 1).millisecondsSinceEpoch.toDouble();
    if (t > t1) break;
    if (t >= t0) out.add(t);
    m += mStep;
  }
  return out;
}
