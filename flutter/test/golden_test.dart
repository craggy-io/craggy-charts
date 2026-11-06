// Golden images of settled charts (reduced motion settles in one frame). Regenerate with
// `flutter test --update-goldens test/golden_test.dart`.
import 'dart:convert';
import 'dart:io';

import 'package:craggy_charts/craggy_charts.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

final _fixtures = (jsonDecode(File('../conformance/fixtures.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();

void main() {
  for (final name in ['line', 'bar-stacked', 'pie', 'heatmap', 'stat', 'light']) {
    testWidgets('golden: $name', (tester) async {
      final f = _fixtures.firstWhere((f) => f['name'] == name);
      final w = (f['width'] as num).toDouble(), h = (f['height'] as num).toDouble();
      await tester.binding.setSurfaceSize(Size(w, h));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MediaQuery(
        data: MediaQueryData(size: Size(w, h), disableAnimations: true),
        child: Directionality(
          textDirection: TextDirection.ltr,
          child: RepaintBoundary(child: CraggyChart.fromJson(Map<String, Object?>.from(f['options'] as Map))),
        ),
      ));
      await expectLater(find.byType(RepaintBoundary).first, matchesGoldenFile('goldens/$name.png'));
    });
  }
}
