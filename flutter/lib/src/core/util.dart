// Shared math helpers, plus the few JavaScript semantics the port must reproduce exactly
// (rounding, number to string, hypot, log10, stable sort, truthiness), so the Dart core
// produces the same tile field as the TypeScript reference.
import 'dart:math' as math;
import 'dart:typed_data';

/// A colour as three channels in 0..255 (fractional while tweening).
typedef RGB = List<double>;

/// A data row.
typedef Row = Map<String, dynamic>;

const double tau = math.pi * 2;

double clamp(num v, [num lo = 0, num hi = 1]) => (v < lo ? lo : v > hi ? hi : v).toDouble();

RGB mix(RGB a, RGB b, num t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

double ease(num t) {
  final c = clamp(t);
  return c * c * (3 - 2 * c);
}

/// JS Math.max / Math.min for two values: NaN wins, results are doubles.
double maxD(num a, num b) => math.max(a, b).toDouble();
double minD(num a, num b) => math.min(a, b).toDouble();

double overlap(num a0, num a1, num b0, num b1) => maxD(0, minD(a1, b1) - maxD(a0, b0));

double sum(Iterable<num> a) {
  var s = 0.0;
  for (final v in a) {
    s += v;
  }
  return s;
}

RGB hex(String c) {
  final s = c.trim();
  if (s.startsWith('#')) {
    final h = s.length == 4 ? s.substring(1).split('').map((x) => x + x).join() : s.substring(1, math.min(7, s.length));
    return [for (var k = 0; k < 6; k += 2) int.parse(h.substring(k, k + 2), radix: 16).toDouble()];
  }
  final m = RegExp(r'rgba?\(([^)]+)\)').firstMatch(s);
  if (m != null) {
    final p = m.group(1)!.split(',').map((x) => toNum(x)).toList();
    return [p[0], p[1], p[2]];
  }
  throw ArgumentError('craggy-charts: unsupported colour "$c" (use #rrggbb or rgb())');
}

/// A colour ramp from the fade colour (about the background) to the full colour, so fills fade into the grid.
List<RGB> shades(RGB fade, RGB rgb, num lo, num hi, [int n = 16]) =>
    [for (var k = 0; k < n; k++) mix(fade, rgb, lo + ((hi - lo) * k) / (n - 1))];

RGB pick(List<RGB> ramp, num t) => ramp[jsRoundInt(clamp(t) * (ramp.length - 1))];

/// Sample a multi-stop ramp at t in [0, 1].
RGB ramp(List<RGB> stops, num t) {
  final u = clamp(t) * (stops.length - 1);
  final i = math.min(stops.length - 2, u.floor());
  return mix(stops[i], stops[i + 1], u - i);
}

/// Index of the item whose position is closest to x.
int nearest(int n, double Function(int i) at, num x) {
  var best = -1;
  var d = double.infinity;
  for (var i = 0; i < n; i++) {
    final e = (at(i) - x).abs();
    if (e < d) {
      d = e;
      best = i;
    }
  }
  return best;
}

/// A finite number (JS `typeof v === 'number' && Number.isFinite(v)`).
bool isNum(Object? v) => v is num && v.isFinite;

/// Largest value, ignoring NaN.
double maxOf(Iterable<num> a, [double floor = double.negativeInfinity]) {
  var m = floor;
  for (final v in a) {
    if (v > m) m = v.toDouble();
  }
  return m;
}

/// Smallest value, ignoring NaN.
double minOf(Iterable<num> a, [double ceil = double.infinity]) {
  var m = ceil;
  for (final v in a) {
    if (v < m) m = v.toDouble();
  }
  return m;
}

// ── JavaScript semantics ─────────────────────────────────────────────────────────────────

/// JS Math.round: halves round towards +infinity.
double jsRound(num x) {
  final d = x.toDouble();
  final f = d.floorToDouble();
  return d - f >= 0.5 ? f + 1 : f;
}

int jsRoundInt(num x) => jsRound(x).toInt();

/// Math.floor / Math.ceil as loop bounds: infinities become very large ints instead of throwing.
int floorI(num v) => v.isFinite ? v.floor() : v > 0 ? 0x3FFFFFFF : -0x3FFFFFFF;
int ceilI(num v) => v.isFinite ? v.ceil() : v > 0 ? 0x3FFFFFFF : -0x3FFFFFFF;

/// A model or option value as a double; anything that is not a number is NaN (JS `undefined` arithmetic).
double dbl(Object? v) => v is num ? v.toDouble() : double.nan;

/// JS `String(n)` for numbers.
String jsNum(num n) {
  final d = n.toDouble();
  if (d.isNaN) return 'NaN';
  if (d.isInfinite) return d > 0 ? 'Infinity' : '-Infinity';
  if (d == 0) return '0';
  if (n is int) return n.toString();
  final s = d.toString();
  return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
}

/// JS `String(v)`.
String jsString(Object? v) {
  if (v == null) return 'null';
  if (v is num) return jsNum(v);
  if (v is List) return v.map((e) => e == null ? '' : jsString(e)).join(',');
  return v.toString();
}

/// JS `typeof` for the values data can hold.
String jsTypeof(Object? v) {
  if (v is num) return 'number';
  if (v is String) return 'string';
  if (v is bool) return 'boolean';
  if (v is Function) return 'function';
  return 'object';
}

/// JS truthiness.
bool truthy(Object? v) {
  if (v == null || v == false) return false;
  if (v is num) return v != 0 && !v.isNaN;
  if (v is String) return v.isNotEmpty;
  return true;
}

/// JS unary plus.
double toNum(Object? v) {
  if (v is num) return v.toDouble();
  if (v is bool) return v ? 1 : 0;
  if (v is DateTime) return v.millisecondsSinceEpoch.toDouble();
  if (v is String) {
    final s = v.trim();
    if (s.isEmpty) return 0;
    if (RegExp(r'^0[xX][0-9a-fA-F]+$').hasMatch(s)) return int.parse(s.substring(2), radix: 16).toDouble();
    if (s == 'Infinity' || s == '+Infinity') return double.infinity;
    if (s == '-Infinity') return double.negativeInfinity;
    if (!RegExp(r'^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$').hasMatch(s)) return double.nan;
    return double.parse(s);
  }
  if (v == null) return 0;
  return double.nan;
}

/// V8's Math.hypot for two values (scaled, Kahan-compensated), so distances round identically.
double hypot(double a, double b) {
  if (a.isInfinite || b.isInfinite) return double.infinity;
  if (a.isNaN || b.isNaN) return double.nan;
  final x = a.abs(), y = b.abs(), m = math.max(x, y);
  if (m == 0) return 0;
  var s = 0.0, comp = 0.0;
  for (final v in [x, y]) {
    final n = v / m, summand = n * n - comp, pre = s + summand;
    comp = (pre - s) - summand;
    s = pre;
  }
  return math.sqrt(s) * m;
}

// fdlibm's log and log10 (what V8's Math.log / Math.log10 run), bit for bit: the platform log
// differs in the last place for about 2% of inputs, which can move a tick step.
final _bits = ByteData(8);
int _hi(double x) => (_bits..setFloat64(0, x, Endian.little)).getInt32(4, Endian.little);
int _lo(double x) => (_bits..setFloat64(0, x, Endian.little)).getUint32(0, Endian.little);
double _withHi(double x, int hi) => (_bits
      ..setFloat64(0, x, Endian.little)
      ..setInt32(4, hi, Endian.little))
    .getFloat64(0, Endian.little);

double _log(double x) {
  const ln2Hi = 6.93147180369123816490e-01, ln2Lo = 1.90821492927058770002e-10, two54 = 1.80143985094819840000e+16;
  const lg1 = 6.666666666666735130e-01, lg2 = 3.999999999940941908e-01, lg3 = 2.857142874366239149e-01;
  const lg4 = 2.222219843214978396e-01, lg5 = 1.818357216161805012e-01, lg6 = 1.531383769920937332e-01, lg7 = 1.479819860511658591e-01;
  var hx = _hi(x);
  final lx = _lo(x);
  var k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7FFFFFFF) | lx) == 0) return double.negativeInfinity;
    if (hx < 0) return double.nan;
    k -= 54;
    x *= two54;
    hx = _hi(x);
  }
  if (hx >= 0x7FF00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000FFFFF;
  var i = (hx + 0x95F64) & 0x100000;
  x = _withHi(x, hx | (i ^ 0x3FF00000));
  k += i >> 20;
  final f = x - 1.0, dk = k.toDouble();
  if ((0x000FFFFF & (2 + hx)) < 3) {
    if (f == 0) return k == 0 ? 0 : dk * ln2Hi + dk * ln2Lo;
    final r = f * f * (0.5 - 0.33333333333333333 * f);
    return k == 0 ? f - r : dk * ln2Hi - ((r - dk * ln2Lo) - f);
  }
  final s = f / (2.0 + f), z = s * s, w = z * z;
  i = (hx - 0x6147A) | (0x6B851 - hx);
  final r = z * (lg1 + w * (lg3 + w * (lg5 + w * lg7))) + w * (lg2 + w * (lg4 + w * lg6));
  if (i > 0) {
    final hfsq = 0.5 * f * f;
    return k == 0 ? f - (hfsq - s * (hfsq + r)) : dk * ln2Hi - ((hfsq - (s * (hfsq + r) + dk * ln2Lo)) - f);
  }
  return k == 0 ? f - s * (f - r) : dk * ln2Hi - ((s * (f - r) - dk * ln2Lo) - f);
}

/// JS Math.log10.
double log10(num v) {
  const ivln10 = 4.34294481903251816668e-01, log10Hi = 3.01029995663611771306e-01, log10Lo = 3.69423907715893078616e-13;
  var x = v.toDouble();
  if (x.isNaN) return x;
  var hx = _hi(x);
  final lx = _lo(x);
  var k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7FFFFFFF) | lx) == 0) return double.negativeInfinity;
    if (hx < 0) return double.nan;
    k -= 54;
    x *= 1.80143985094819840000e+16;
    hx = _hi(x);
  }
  if (hx >= 0x7FF00000) return x + x;
  if (hx == 0x3FF00000 && lx == 0) return 0;
  k += (hx >> 20) - 1023;
  final i = k < 0 ? 1 : 0;
  hx = (hx & 0x000FFFFF) | ((0x3FF - i) << 20);
  final y = (k + i).toDouble();
  return y * log10Lo + ivln10 * _log(_withHi(x, hx)) + y * log10Hi;
}

/// 10 ** e for an integer exponent.
double pow10(int e) => math.pow(10.0, e).toDouble();

/// JS `toPrecision` followed by unary plus: the value rounded to `p` significant digits.
double precise(num v, [int p = 12]) => v.isFinite ? double.parse(v.toStringAsPrecision(p)) : v.toDouble();

/// JS `v || d` for numbers: d when v is 0 or NaN.
double jsOr(num v, num d) => v == 0 || v.isNaN ? d.toDouble() : v.toDouble();

/// JS `%` (the remainder takes the sign of the dividend).
double jsMod(num a, num b) => a.remainder(b).toDouble();

/// A JS comparator result (`a - b || tie`) as a Dart one.
int cmp(num d, [int tie = 0]) => d < 0 ? -1 : d > 0 ? 1 : tie;

/// Stable sort (JS Array.prototype.sort is stable; Dart's List.sort is not).
List<T> stableSorted<T>(Iterable<T> items, int Function(T a, T b) compare) {
  final a = items.toList();
  if (a.length < 2) return a;
  var src = a, dst = List<T>.of(a);
  for (var w = 1; w < a.length; w *= 2) {
    for (var lo = 0; lo < a.length; lo += 2 * w) {
      final mid = math.min(lo + w, a.length), hi = math.min(lo + 2 * w, a.length);
      var i = lo, j = mid, k = lo;
      while (i < mid && j < hi) {
        dst[k++] = compare(src[j], src[i]) < 0 ? src[j++] : src[i++];
      }
      while (i < mid) {
        dst[k++] = src[i++];
      }
      while (j < hi) {
        dst[k++] = src[j++];
      }
    }
    final t = src;
    src = dst;
    dst = t;
  }
  return src;
}

/// The first element of `o` when it is a list, else `o` itself (JS `Array.isArray(o) ? o[0] : o`).
Object? firstOf(Object? o) => o is List ? (o.isEmpty ? null : o[0]) : o;

/// `[].concat(o)`.
List<dynamic> listOf(Object? o) => o is List ? List<dynamic>.of(o) : [o];

/// Options-style map lookup that tolerates null and non-map values.
Map<String, dynamic> mapOf(Object? o) => o is Map<String, dynamic> ? o : o is Map ? Map<String, dynamic>.from(o) : <String, dynamic>{};

/// Array of n doubles, growable (models are eased in place).
List<dynamic> filled(int n, Object? v) => List<dynamic>.filled(n, v, growable: true);
