// The conformance artefact (a settled tile field plus every label), as in conformance/snapshot.ts.
import 'package:craggy_charts/src/core/chart_core.dart';
import 'package:craggy_charts/src/core/util.dart';

String hex2(num v) => jsRoundInt(v.clamp(-1e9, 1e9)).clamp(0, 255).toRadixString(16).padLeft(2, '0');
double r2(num v) => jsRound(v * 100) / 100;

/// Construct, size, push rows with now = 1000, settle.
ChartCore render(Map<String, dynamic> f) {
  final c = ChartCore(Map<String, dynamic>.from(f['options'] as Map));
  c.setSize((f['width'] as num).toDouble(), (f['height'] as num).toDouble());
  for (final row in (f['push'] as List?) ?? const []) {
    c.push([row], 1000);
  }
  c.settle();
  return c;
}

Map<String, dynamic> snapshot(Map<String, dynamic> f) {
  final c = render(f), g = c.grid!, fl = c.field!;
  final cov = StringBuffer(), col = StringBuffer();
  for (var i = 0; i < fl.cov.length; i++) {
    final b = hex2(fl.cov[i] * 255);
    cov.write(b);
    if (b != '00') col.write(hex2(fl.col[i * 3]) + hex2(fl.col[i * 3 + 1]) + hex2(fl.col[i * 3 + 2]));
  }
  return {
    'name': f['name'], 'cols': g.cols, 'rows': g.rows, 'cell': g.cell, 'ox': r2(g.ox), 'oy': r2(g.oy), 'cov': '$cov', 'col': '$col',
    'labelsX': [for (final l in c.out.labelsX) {'x': r2(l.x), 'text': l.text}],
    'labelsY': [for (final l in c.out.labelsY) {'y': r2(l.y), 'text': l.text, 'side': l.side}],
    'texts': [for (final t in c.out.texts) {'x': r2(t.x), 'y': r2(t.y), 'text': t.text}],
  };
}

/// Differences between two snapshots, empty when they conform.
List<String> compare(Map<String, dynamic> a, Map<String, dynamic> b, [int tol = 1]) {
  final out = <String>[];
  for (final k in const ['cols', 'rows', 'cell']) {
    if (a[k] != b[k]) out.add('$k: ${a[k]} vs ${b[k]}');
  }
  if (out.isNotEmpty) return out;
  if ((a['ox'] - b['ox']).abs() > 0.02 || (a['oy'] - b['oy']).abs() > 0.02) out.add('origin: ${a['ox']},${a['oy']} vs ${b['ox']},${b['oy']}');
  final ac = a['cov'] as String, bc = b['cov'] as String, acol = a['col'] as String, bcol = b['col'] as String;
  var bad = 0, colBad = 0, ia = 0, ib = 0;
  final badTiles = <String>[];
  // parseInt past the end is NaN in JS, and NaN never counts as a difference.
  int? byte(String s, int i) => i + 2 <= s.length ? int.parse(s.substring(i, i + 2), radix: 16) : null;
  for (var i = 0; i < ac.length; i += 2) {
    final x = byte(ac, i)!, y = byte(bc, i)!;
    if ((x - y).abs() > tol) {
      bad++;
      if (badTiles.length < 12) badTiles.add('#${i ~/ 2}:${x}v$y');
    }
    if (x != 0 && y != 0) {
      for (var k = 0; k < 6; k += 2) {
        final p = byte(acol, ia + k), q = byte(bcol, ib + k);
        if (p != null && q != null && (p - q).abs() > tol) {
          colBad++;
          if (badTiles.length < 12) badTiles.add('c#${i ~/ 2}:${acol.substring(ia, ia + 6)}v${bcol.substring(ib, ib + 6)}');
          break;
        }
      }
    }
    if (x != 0) ia += 6;
    if (y != 0) ib += 6;
  }
  if (bad > 0) out.add('$bad tiles differ in coverage');
  if (colBad > 0) out.add('$colBad tiles differ in colour');
  if (badTiles.isNotEmpty) out.add('first: ${badTiles.join(' ')} (cols ${a['cols']})');
  String labels(List l) => l.map((v) => '${v['text']}@${jsNum(jsRound(((v['x'] ?? v['y']) as num) * 10) / 10)}').join(' | ');
  for (final k in const ['labelsX', 'labelsY', 'texts']) {
    final la = labels(a[k] as List), lb = labels(b[k] as List);
    if (la != lb) out.add('$k: $la vs $lb');
  }
  return out;
}
