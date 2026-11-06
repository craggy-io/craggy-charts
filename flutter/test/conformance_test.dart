// The Dart core against the conformance fields the JS core produced (conformance/expected/).
// The same comparison as compare() in conformance/snapshot.ts: coverage and colour within ±1,
// labels to 0.1px, origin to 0.02.
import 'dart:convert';
import 'dart:io';

import 'package:craggy_charts/src/core/chart_core.dart';
import 'package:craggy_charts/src/core/util.dart';
import 'package:flutter_test/flutter_test.dart';

import 'snapshot.dart';

void main() {
  final fixtures = (jsonDecode(File('../conformance/fixtures.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();

  test('every fixture has an expected field', () {
    expect(fixtures.length, 49);
    for (final f in fixtures) {
      expect(File('../conformance/expected/${f['name']}.json').existsSync(), isTrue, reason: f['name'] as String);
    }
  });

  for (final f in fixtures) {
    test('${f['name']} matches expected/', () {
      final expected = jsonDecode(File('../conformance/expected/${f['name']}.json').readAsStringSync()) as Map<String, dynamic>;
      expect(compare(snapshot(f), expected), isEmpty);
    });
  }

  test('snapshot hex and rounding follow the JS reference', () {
    expect(hex2(127.5), '80');
    expect(hex2(-3), '00');
    expect(r2(1.005), jsRound(100.49999999999999) / 100);
    expect(render(fixtures.first), isA<ChartCore>());
  });
}
