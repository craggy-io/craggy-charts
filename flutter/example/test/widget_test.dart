import 'package:craggy_charts/craggy_charts.dart';
import 'package:craggy_charts_example/main.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the gallery builds every chart type and streams the live chart', (tester) async {
    await tester.pumpWidget(const ExampleApp());
    await tester.pump(const Duration(seconds: 2));
    expect(gallery.keys.toSet(), registeredTypes().toSet());
    expect(find.text('Live'), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); // disposes the timer
  });
}
