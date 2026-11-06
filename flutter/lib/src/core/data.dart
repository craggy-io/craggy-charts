// Data normalisation: the flat options API (x / y / by) resolved into series.
import 'format.dart';
import 'util.dart';

/// Reads a channel from a row: a column key, an accessor `(row, index)` / `(row)`, or the row index.
typedef Getter = dynamic Function(Row r, int i);

Row _row(Object? d) => d is Map<String, dynamic> ? d : Map<String, dynamic>.from(d! as Map);

/// Rows from any accepted data shape: rows, plain numbers, or columns.
List<Row> rowsOf(Object? data) {
  if (data == null) return [];
  if (data is List) return [for (final d in data) d is num || d == null ? <String, dynamic>{'value': d} : _row(d)];
  if (data is Map) {
    final keys = data.keys.map((k) => '$k').toList();
    var n = 0;
    for (final k in data.keys) {
      final c = data[k];
      if (c is List && c.length > n) n = c.length;
    }
    return [
      for (var i = 0; i < n; i++)
        {for (final k in keys) k: (data[k] is List && i < (data[k] as List).length) ? (data[k] as List)[i] : null},
    ];
  }
  throw ArgumentError('craggy-charts: data must be rows, numbers or columns');
}

Getter getter(Object? ch) {
  if (ch is Function) {
    if (ch is dynamic Function(Row, int)) return ch;
    if (ch is dynamic Function(Row)) return (r, _) => ch(r);
    return (r, i) => Function.apply(ch, [r, i]);
  }
  if (ch == null) return (_, i) => i;
  final k = jsString(ch);
  return (r, _) => r[k];
}

final _iso = RegExp(r'^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$');
bool isDateLike(Object? v) => v is DateTime || (v is String && _iso.hasMatch(v));

double toTime(Object? v) {
  if (v is DateTime) return v.millisecondsSinceEpoch.toDouble();
  if (v is num) return v.toDouble();
  final s = jsString(v);
  final d = DateTime.tryParse(s.length == 10 ? '${s}T00:00:00Z' : s);
  return d == null ? double.nan : d.millisecondsSinceEpoch.toDouble();
}

/// A cell as a number (JS `+v`; empty is NaN).
double num_(Object? v) => v == null || v == '' ? double.nan : v is num ? v.toDouble() : toNum(v);

/// Key of the x / label column: options.x, else the first non-number column, else null (row index).
Object? xKeyOf(List<Row> rows, Object? x) {
  if (x != null) return x;
  if (rows.isEmpty) return null;
  final first = rows[0];
  for (final k in first.keys) {
    if (first[k] != null && first[k] is! num) return k;
  }
  return null;
}

bool _ascendingNumbers(List<dynamic> a) {
  for (var i = 0; i < a.length; i++) {
    if (a[i] is! num || (i > 0 && !((a[i] as num) > (a[i - 1] as num)))) return false;
  }
  return true;
}

/// Stable identity per row for keyed transitions: the label, suffixed when a label repeats.
List<String> keysOf(List<dynamic> labels) {
  if (_ascendingNumbers(labels)) return [for (final l in labels) 'number:${jsString(l)}'];
  final seen = <String, int>{};
  return [
    for (final l in labels)
      () {
        final k = l is DateTime ? 't${l.millisecondsSinceEpoch}' : '${jsTypeof(l)}:${jsString(l)}';
        final n = seen[k] ?? 0;
        seen[k] = n + 1;
        return n > 0 ? '$k#$n' : k;
      }(),
  ];
}

String _labelKey(Object? l) => '${labelText(l)}|${l is DateTime ? l.millisecondsSinceEpoch : jsString(l)}';

/// Rows to series. Wide data: each y column is a series. Long data: `by` splits rows into series.
/// Keys: xKind ('category' | 'number' | 'time'), labels, xs, keys, names, values, rows.
Map<String, dynamic> wide(List<Row> rows, Map<String, dynamic> o) {
  if (rows.isEmpty) {
    return {'xKind': 'category', 'labels': <dynamic>[], 'xs': <double>[], 'keys': <String>[], 'names': <String>[], 'values': <List<double>>[], 'rows': rows};
  }
  final xk = xKeyOf(rows, o['x']);
  final gx = getter(xk);
  if (truthy(o['by'])) {
    final by = jsString(o['by']);
    final names = <String>[], labels = <dynamic>[], seenN = <String>{}, seenL = <String, int>{};
    for (var i = 0; i < rows.length; i++) {
      final n = jsString(rows[i][by]), l = gx(rows[i], i), lk = _labelKey(l);
      if (seenN.add(n)) names.add(n);
      if (!seenL.containsKey(lk)) {
        seenL[lk] = labels.length;
        labels.add(l);
      }
    }
    final gy = getter(o['y'] is List ? firstOf(o['y']) : o['y'] ?? 'value');
    final values = [for (final _ in names) List<double>.filled(labels.length, double.nan, growable: true)];
    for (var i = 0; i < rows.length; i++) {
      final l = gx(rows[i], i);
      values[names.indexOf(jsString(rows[i][by]))][seenL[_labelKey(l)]!] = num_(gy(rows[i], i));
    }
    return _finish(labels, names, values, rows, o);
  }
  final first = rows[0];
  final List<dynamic> yKeys = o['y'] != null ? listOf(o['y']) : [for (final k in first.keys) if (k != xk && first[k] is num) k];
  final labels = [for (var i = 0; i < rows.length; i++) xk == null ? i : gx(rows[i], i)];
  final names = [for (var i = 0; i < yKeys.length; i++) yKeys[i] is String ? yKeys[i] as String : 'series ${i + 1}'];
  final values = [
    for (final k in yKeys)
      () {
        final g = getter(k);
        return [for (var i = 0; i < rows.length; i++) num_(g(rows[i], i))];
      }(),
  ];
  return _finish(labels, names, values, rows, o);
}

Map<String, dynamic> _finish(List<dynamic> labels, List<String> names, List<List<double>> values, List<Row> rows, Map<String, dynamic> o) {
  var xKind = 'category';
  if (labels.isNotEmpty && labels.every((l) => l is num)) {
    xKind = 'number'; // includes the row index
  } else if (labels.isNotEmpty && labels.every(isDateLike)) {
    xKind = 'time';
  }
  if (truthy(o['sort']) && labels.isNotEmpty) {
    final tot = [for (var i = 0; i < labels.length; i++) values.fold<double>(0, (s, v) => s + (v[i].isFinite ? v[i] : 0))];
    final asc = o['sort'] == 'asc';
    final order = stableSorted<int>(List.generate(labels.length, (i) => i), (a, b) => cmp(asc ? tot[a] - tot[b] : tot[b] - tot[a], a - b));
    labels = [for (final i in order) labels[i]];
    values = [for (final v in values) [for (final i in order) v[i]]];
    rows = [for (final i in order) rows[i]];
    xKind = 'category';
  }
  final xs = [
    for (var i = 0; i < labels.length; i++) xKind == 'number' ? (labels[i] as num).toDouble() : xKind == 'time' ? toTime(labels[i]) : i.toDouble(),
  ];
  return {'xKind': xKind, 'labels': labels, 'xs': xs, 'keys': keysOf(labels), 'names': names, 'values': values, 'rows': rows};
}

/// Label / value pairs for part-to-whole types (pie, waffle, treemap, funnel...).
/// Keys: labels, values, keys, rows.
Map<String, dynamic> categories(List<Row> rows, Map<String, dynamic> o) {
  if (rows.isEmpty) return {'labels': <dynamic>[], 'values': <double>[], 'keys': <String>[], 'rows': rows};
  final first = rows[0];
  Object? firstKey(bool number) {
    for (final k in first.keys) {
      if ((first[k] is num) == number) return k;
    }
    return null;
  }

  final lk = o['x'] ?? o['label'] ?? firstKey(false);
  final vk = firstOf(o['y']) ?? (o['value'] is String ? o['value'] : null) ?? firstKey(true);
  final gl = getter(lk), gv = getter(vk);
  var idx = List.generate(rows.length, (i) => i);
  final vals = [
    for (var i = 0; i < rows.length; i++)
      () {
        final v = num_(gv(rows[i], i));
        return maxD(0, v.isNaN || v == 0 ? 0 : v);
      }(),
  ];
  if (truthy(o['sort'])) {
    final asc = o['sort'] == 'asc';
    idx = stableSorted(idx, (a, b) => cmp(asc ? vals[a] - vals[b] : vals[b] - vals[a], a - b));
  }
  final labels = [for (final i in idx) lk == null ? '#${i + 1}' : gl(rows[i], i)];
  return {'labels': labels, 'values': [for (final i in idx) vals[i]], 'keys': keysOf(labels), 'rows': [for (final i in idx) rows[i]]};
}
