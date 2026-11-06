// Number and label formatting. Dependency-free and deterministic (no locale APIs), so the
// JS and Dart cores produce identical strings.
import 'dart:math' as math;

import 'util.dart';

/// A value formatter.
typedef Fmt = String Function(num v);

String _trim(String s) => s.contains('.') ? s.replaceFirst(RegExp(r'\.?0+$'), '') : s;

String compact(num v) {
  if (!v.isFinite) return '–';
  final a = v.abs();
  if (a >= 1e12) return '${_trim((v / 1e12).toStringAsFixed(1))}T';
  if (a >= 1e9) return '${_trim((v / 1e9).toStringAsFixed(1))}B';
  if (a >= 1e6) return '${_trim((v / 1e6).toStringAsFixed(1))}M';
  if (a >= 1e4) return '${_trim((v / 1e3).toStringAsFixed(0))}k';
  if (a >= 1e3) return '${_trim((v / 1e3).toStringAsFixed(1))}k';
  if (a >= 100 || a == 0) return jsNum(jsRound(v));
  if (a >= 1) return _trim(v.toStringAsFixed(2));
  return _trim(v.toStringAsPrecision(2));
}

String grouped(num v) {
  if (!v.isFinite) return '–';
  final neg = v < 0, s = v.abs(), d = s % 1 == 0 ? 0 : s < 1 ? 3 : 2;
  final parts = s.toStringAsFixed(d).split('.');
  final body = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  final frac = parts.length > 1 ? parts[1] : '';
  return (neg ? '-' : '') + body + (frac.isNotEmpty ? '.${frac.replaceFirst(RegExp(r'0+$'), '')}' : '').replaceFirst(RegExp(r'\.$'), '');
}

String bytes(num v) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  var a = v.abs().toDouble();
  var i = 0;
  while (a >= 1024 && i < units.length - 1) {
    a /= 1024;
    i++;
  }
  return '${v < 0 ? '-' : ''}${a >= 100 || i == 0 ? jsNum(jsRound(a)) : _trim(a.toStringAsFixed(1))} ${units[i]}';
}

String duration(num ms) {
  final a = ms.abs(), sign = ms < 0 ? '-' : '';
  if (a < 1000) return '$sign${compact(a)}ms';
  if (a < 60e3) return '$sign${_trim((a / 1000).toStringAsFixed(1))}s';
  if (a < 3600e3) return '$sign${_trim((a / 60e3).toStringAsFixed(1))}m';
  if (a < 86400e3) return '$sign${_trim((a / 3600e3).toStringAsFixed(1))}h';
  return '$sign${_trim((a / 86400e3).toStringAsFixed(1))}d';
}

/// The named formats.
final Map<String, Fmt> formats = {
  'compact': compact,
  'number': grouped,
  'percent': (v) => '${compact(v)}%',
  'currency': (v) => '${v < 0 ? '-\$' : '\$'}${compact(v.abs())}',
  'bytes': bytes,
  'duration': duration,
};

/// A formatter from an option: a name, a function, or null (compact).
Fmt makeFormat(Object? f) {
  if (f is String Function(num)) return f;
  if (f is String Function(double)) return (v) => f(v.toDouble());
  if (f is Function) return (v) => jsString(Function.apply(f, [v]));
  if (f == null) return compact;
  final fn = formats[f];
  if (fn == null) throw ArgumentError('craggy-charts: unknown format "$f" (use ${formats.keys.join(', ')} or a function)');
  return fn;
}

/// Animated numbers count with the precision of where they are heading, not the tween's.
double roundLike(num v, num target) {
  final s = jsNum(target), i = s.indexOf('.');
  final d = i < 0 || s.contains('e') ? 0 : math.min(4, s.length - i - 1);
  return double.parse(v.toStringAsFixed(d));
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
String _pad(int n) => n < 10 ? '0$n' : '$n';

DateTime utc(num t) => DateTime.fromMillisecondsSinceEpoch(t.toInt(), isUtc: true);

/// Date label at a granularity that suits the span (UTC, so output is stable everywhere).
String timeLabel(num t, num span) {
  final d = utc(t);
  if (span < 120e3) return '${_pad(d.hour)}:${_pad(d.minute)}:${_pad(d.second)}';
  if (span < 2 * 86400e3) return '${_pad(d.hour)}:${_pad(d.minute)}';
  if (span < 300 * 86400e3) return '${_months[d.month - 1]} ${d.day}';
  if (span < 3 * 365 * 86400e3) return '${_months[d.month - 1]} ${d.year}';
  return '${d.year}';
}

String monthName(int m) => _months[m];

/// yyyy-mm-dd of a UTC time (JS `toISOString().slice(0, 10)`).
String isoDate(num t) {
  final d = utc(t);
  return '${d.year.toString().padLeft(4, '0')}-${_pad(d.month)}-${_pad(d.day)}';
}

String labelText(Object? v) {
  if (v is DateTime) return isoDate(v.millisecondsSinceEpoch);
  if (v is num) return compact(v);
  return v == null ? '' : jsString(v);
}
