// Widget tests: semantics, tooltip, legend, controller, reduced motion, JSON specs and the keyboard.
import 'dart:convert';
import 'dart:io';

import 'package:craggy_charts/craggy_charts.dart';
import 'package:craggy_charts/src/widget/chrome.dart';
import 'package:craggy_charts/src/widget/painter.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

final _fixtures = (jsonDecode(File('../conformance/fixtures.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();
Map<String, Object?> optionsOf(String name) => Map<String, Object?>.from(_fixtures.firstWhere((f) => f['name'] == name)['options'] as Map);

final months = [
  for (final (m, n, s) in [('Jan', 40, 53), ('Feb', 47, 48), ('Mar', 53, 49), ('Apr', 60, 47), ('May', 68, 36), ('Jun', 69, 47)])
    {'month': m, 'north': n, 'south': s},
];

/// A chart in a fixed 480 x 260 box, optionally with animations disabled.
Widget host(Widget chart, {bool reducedMotion = false}) => MediaQuery(
      data: MediaQueryData(size: const Size(800, 600), disableAnimations: reducedMotion),
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Align(alignment: Alignment.topLeft, child: SizedBox(width: 480, height: 260, child: chart)),
      ),
    );

final _plot = find.byWidgetPredicate((w) => w is CustomPaint && w.painter is ChartPainter);
final _chart = find.byWidgetPredicate((w) => w is CraggyChart);

ChartPainter painterOf(WidgetTester tester) => tester.widget<CustomPaint>(_plot).painter! as ChartPainter;

/// Logical position of the centre of row [i] of [n] in the plot.
Offset columnCentre(WidgetTester tester, int i) {
  final g = painterOf(tester).core.grid!;
  final plot = tester.getTopLeft(_plot);
  final c = painterOf(tester).core;
  final (x, y) = c.anchor(i);
  expect(x, inInclusiveRange(g.ox, g.ox + g.cols * g.cell));
  return plot + Offset(x, y);
}

void main() {
  testWidgets('the plot is labelled with the core summary', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, title: 'Sales')));
    await tester.pumpAndSettle();
    final summary = painterOf(tester).core.summary();
    expect(summary, startsWith('Sales. Bar chart, 2 series: north, south, 6 points'));
    expect(find.bySemanticsLabel(summary), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a tap shows the tooltip and reports the point', (tester) async {
    PointEvent? tapped;
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, onTap: (p) => tapped = p)));
    await tester.pumpAndSettle();
    await tester.tapAt(columnCentre(tester, 2));
    await tester.pump();
    expect(tapped, isNotNull);
    expect(tapped!.title, 'Mar');
    expect(tapped!.rows.map((r) => r.name), ['north', 'south']);
    final card = find.byType(TooltipCard);
    expect(find.descendant(of: card, matching: find.text('Mar')), findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('53')), findsOneWidget);
    await tester.pump(const Duration(seconds: 2)); // the touch tooltip dismisses itself
    await tester.pumpAndSettle();
  });

  testWidgets('mouse hover shows the tooltip and reports hover', (tester) async {
    final hovered = <String?>[];
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, onHover: (p) => hovered.add(p?.title))));
    await tester.pumpAndSettle();
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(columnCentre(tester, 4));
    await tester.pump();
    expect(hovered.last, 'May');
    expect(find.descendant(of: find.byType(TooltipCard), matching: find.text('May')), findsOneWidget);
    await mouse.moveTo(const Offset(700, 500)); // leaves the chart
    await tester.pump();
    expect(hovered.last, isNull);
    await mouse.removePointer();
    await tester.pumpAndSettle();
  });

  testWidgets('a legend tap toggles a series', (tester) async {
    final events = <LegendEvent>[];
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, onLegend: events.add)));
    await tester.pumpAndSettle();
    expect(find.text('north'), findsOneWidget); // 2+ series: the legend shows by default
    await tester.tap(find.text('south'));
    await tester.pump(kDoubleTapTimeout + const Duration(milliseconds: 20));
    expect(events.single.name, 'south');
    expect(events.single.hidden, isTrue);
    final core = painterOf(tester).core;
    expect(core.hidden, {'south'});
    expect(core.legend().firstWhere((l) => l.name == 'south').hidden, isTrue);
    await tester.pumpAndSettle();
    expect(tester.widget<Opacity>(find.ancestor(of: find.text('south'), matching: find.byType(Opacity)).first).opacity, 0.38);
  });

  testWidgets('legend: false hides it and a position moves it', (tester) async {
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, legend: false)));
    expect(find.text('north'), findsNothing);
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, legend: 'bottom')));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.text('north')).dy, greaterThan(200));
    await tester.pumpWidget(host(CraggyChart(type: ChartType.line, data: [1, 2, 3], legend: true)));
    expect(find.text('value'), findsOneWidget); // forced on for a single series
  });

  testWidgets('controller.push grows the data', (tester) async {
    final controller = CraggyController();
    await tester.pumpWidget(host(CraggyChart(type: ChartType.line, data: [1, 2, 3], controller: controller)));
    await tester.pumpAndSettle();
    final core = painterOf(tester).core;
    expect(core.rows, hasLength(3));
    controller.push({'value': 7});
    controller.push([8, 9]);
    await tester.pumpAndSettle();
    expect(core.rows, hasLength(6));
    expect(core.summary(), contains('6 points'));
    controller.patch({'value': 1});
    expect(core.rows.last['value'], 1);
    controller.update({'type': 'bar'});
    await tester.pumpAndSettle();
    expect(core.type, 'bar');
    expect(controller.toSvg(), startsWith('<svg'));
  });

  testWidgets('a rebuild with other options keeps pushed rows', (tester) async {
    final controller = CraggyController();
    Widget chart(String theme) => host(CraggyChart(type: ChartType.line, data: const [1, 2], theme: theme, controller: controller), reducedMotion: true);
    await tester.pumpWidget(chart('dark'));
    controller.push([3, 4]);
    await tester.pumpWidget(chart('light'));
    final core = painterOf(tester).core;
    expect(core.theme.name, 'light');
    expect(core.rows, hasLength(4));
  });

  testWidgets('controller commands sent before mounting run on attach', (tester) async {
    final controller = CraggyController()..push([4, 5]);
    await tester.pumpWidget(host(CraggyChart(type: ChartType.line, data: [1, 2, 3], controller: controller)));
    expect(controller.attached, isTrue);
    expect(painterOf(tester).core.rows, hasLength(5));
    await tester.pumpAndSettle();
  });

  testWidgets('reduced motion settles in one frame', (tester) async {
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months), reducedMotion: true));
    final core = painterOf(tester).core;
    expect(core.litTiles(), greaterThan(100));
    expect(tester.binding.transientCallbackCount, 0); // no ticker running
    final settled = ChartCore(core.opts)
      ..setSize(core.grid!.w, core.grid!.h)
      ..settle();
    expect(core.size, settled.size);
  });

  testWidgets('animates and stops its ticker when settled', (tester) async {
    await tester.pumpWidget(host(CraggyChart(type: ChartType.line, data: [1, 5, 2, 8])));
    await tester.pump(const Duration(milliseconds: 16));
    expect(tester.binding.transientCallbackCount, greaterThan(0));
    await tester.pumpAndSettle();
    expect(tester.binding.transientCallbackCount, 0);
    expect(painterOf(tester).core.litTiles(), greaterThan(40));
  });

  testWidgets('a muted TickerMode pauses the animation', (tester) async {
    await tester.pumpWidget(TickerMode(enabled: false, child: host(CraggyChart(type: ChartType.line, data: [1, 5, 2, 8]))));
    await tester.pump(const Duration(seconds: 1));
    expect(painterOf(tester).core.litTiles(), 0);
    await tester.pumpWidget(TickerMode(enabled: true, child: host(CraggyChart(type: ChartType.line, data: [1, 5, 2, 8]))));
    await tester.pumpAndSettle();
    expect(painterOf(tester).core.litTiles(), greaterThan(40));
  });

  testWidgets('fromJson draws every conformance fixture', (tester) async {
    for (final f in _fixtures) {
      final controller = CraggyController();
      await tester.pumpWidget(host(CraggyChart.fromJson(Map<String, Object?>.from(f['options'] as Map), key: ValueKey(f['name']), controller: controller),
          reducedMotion: true));
      for (final row in (f['push'] as List?) ?? const []) {
        controller.push(row);
      }
      await tester.pump();
      final core = painterOf(tester).core;
      expect(core.type, f['options']['type'], reason: f['name'] as String);
      expect(core.litTiles(), greaterThan(40), reason: f['name'] as String);
    }
    expect(() => CraggyChart.fromJson(const {'type': 'sankey'}), throwsArgumentError);
  });

  testWidgets('typed rows through accessors', (tester) async {
    final sales = [(month: 'Jan', revenue: 12.0, cost: 8.0), (month: 'Feb', revenue: 15.0, cost: 9.0)];
    await tester.pumpWidget(host(
      CraggyChart<({String month, double revenue, double cost})>.bar(
        data: sales,
        x: (s) => s.month,
        y: [(s) => s.revenue, (s) => s.cost],
        names: const ['revenue', 'cost'],
        stack: true,
      ),
      reducedMotion: true,
    ));
    final core = painterOf(tester).core;
    expect(core.legend().map((l) => l.name), ['revenue', 'cost']);
    expect(core.tip(1)!.title, 'Feb');
    expect(core.tip(1)!.rows.map((r) => r.value), ['15', '9']);
    expect(core.opts['stack'], isTrue);
  });

  testWidgets('keyboard arrows, Home, End, Enter and Escape move the focus', (tester) async {
    final taps = <String>[];
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, onTap: (p) => taps.add(p.title)), reducedMotion: true));
    await tester.tapAt(const Offset(470, 250)); // focus the plot (outside every bar)
    await tester.pump();
    final core = painterOf(tester).core;
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    expect(core.hover, 0);
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    expect(core.hover, 5);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    expect(core.hover, 4);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(taps.last, 'May');
    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pump();
    expect(core.hover, 0);
    expect(find.descendant(of: find.byType(TooltipCard), matching: find.text('Jan')), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    expect(core.hover, -1);
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('scroll zooms, drag brushes and pans', (tester) async {
    final zooms = <ZoomEvent>[];
    Selection? selected;
    final data = [for (var i = 0; i < 40; i++) {'t': i, 'v': i % 7}];
    await tester.pumpWidget(host(
      CraggyChart(type: ChartType.line, data: data, zoom: true, brush: true, onZoom: zooms.add, onSelect: (s) => selected = s),
      reducedMotion: true,
    ));
    final core = painterOf(tester).core, centre = tester.getCenter(_chart);
    await tester.sendEventToBinding(PointerScrollEvent(position: centre, scrollDelta: const Offset(0, -100)));
    await tester.pump();
    expect(zooms, isNotEmpty);
    expect(core.view[1] - core.view[0], lessThan(0.9));
    await tester.dragFrom(centre - const Offset(60, 0), const Offset(120, 0));
    await tester.pump();
    expect(selected, isNotNull);
    expect(selected!.indices.$2, greaterThan(selected!.indices.$1));
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('tooltip: false and a tooltip function', (tester) async {
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, tooltip: false), reducedMotion: true));
    await tester.tapAt(columnCentre(tester, 1));
    await tester.pump();
    expect(find.byType(TooltipCard), findsNothing);
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, tooltip: (PointEvent p) => 'custom ${p.title}'), reducedMotion: true));
    await tester.tapAt(columnCentre(tester, 1));
    await tester.pump();
    expect(find.text('custom Feb'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('default heights follow the type when the parent is unbounded', (tester) async {
    Widget column(ChartType t, Map<String, Object?> o) => MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: Directionality(
            textDirection: TextDirection.ltr,
            child: SingleChildScrollView(child: Column(children: [CraggyChart.fromJson({...o, 'type': t.name})])),
          ),
        );
    for (final (t, h) in [(ChartType.progress, 56.0), (ChartType.stat, 140.0), (ChartType.line, 280.0)]) {
      final o = t == ChartType.line ? {'data': [1, 2]} : {'value': 42};
      await tester.pumpWidget(column(t, o));
      expect(tester.getSize(_chart).height, h);
    }
  });

  testWidgets('new widget options replace the old ones', (tester) async {
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months, title: 'Before'), reducedMotion: true));
    expect(find.text('Before'), findsOneWidget);
    await tester.pumpWidget(host(CraggyChart(type: ChartType.bar, data: months), reducedMotion: true));
    expect(find.text('Before'), findsNothing);
    expect(painterOf(tester).core.opts['title'], isNull);
  });
}
