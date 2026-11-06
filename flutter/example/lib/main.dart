// craggy_charts example: a gallery of every chart type, a live chart driven by a controller, and a
// light / dark toggle.
import 'dart:async';
import 'dart:math' as math;

import 'package:craggy_charts/craggy_charts.dart';
import 'package:flutter/material.dart';

void main() => runApp(const ExampleApp());

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

/// Deterministic pseudo-random numbers, so the gallery looks the same on every run.
class _Seeded {
  _Seeded(this._s);
  int _s;
  double next() => (_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  double normal() => math.sqrt(-2 * math.log(next() + 1e-12)) * math.cos(2 * math.pi * next());
}

final _rand = _Seeded(7);
double _round1(double v) => (v * 10).roundToDouble() / 10;

final _regions = [
  for (var i = 0; i < _months.length; i++) {'month': _months[i], 'north': 40 + i * 6, 'south': 53 - i * 2 + (i.isEven ? 4 : -3), 'west': 23 + i * 2},
];
final _shares = [
  for (final (n, v) in [('Search', 42), ('Direct', 26), ('Social', 18), ('Email', 9), ('Other', 5)]) {'name': n, 'value': v},
];
final _candles = () {
  var p = 100.0;
  return [
    for (var d = 1; d <= 24; d++)
      () {
        final open = p, close = _round1(p + _rand.normal() * 3);
        p = close;
        return {'day': 'D$d', 'open': open, 'high': _round1(math.max(open, close) + _rand.next() * 3), 'low': _round1(math.min(open, close) - _rand.next() * 3), 'close': close};
      }(),
  ];
}();

/// One gallery entry per chart type: the same JSON options the JS package takes.
final Map<String, Map<String, Object?>> gallery = {
  'line': {'type': 'line', 'data': _regions, 'title': 'Line', 'subtitle': 'Visits by region'},
  'area': {'type': 'area', 'data': _regions, 'stack': true, 'title': 'Stacked area'},
  'bar': {'type': 'bar', 'data': _regions, 'title': 'Grouped bars', 'labels': false},
  'histogram': {
    'type': 'histogram',
    'data': [for (var i = 0; i < 400; i++) {'latency': _round1(110 + _rand.normal() * 18)}],
    'title': 'Histogram',
  },
  'scatter': {
    'type': 'scatter',
    'data': [for (var i = 0; i < 80; i++) {'height': _round1(20 + _rand.next() * 70), 'weight': _round1(20 + _rand.next() * 50), 'group': i.isEven ? 'a' : 'b'}],
    'x': 'height',
    'y': 'weight',
    'by': 'group',
    'title': 'Scatter',
  },
  'bubble': {
    'type': 'bubble',
    'data': [for (var i = 0; i < 30; i++) {'height': _round1(20 + _rand.next() * 70), 'weight': _round1(20 + _rand.next() * 50), 'size': (_rand.next() * 80).round()}],
    'x': 'height',
    'y': 'weight',
    'size': 'size',
    'title': 'Bubble',
  },
  'range': {
    'type': 'range',
    'data': [for (var h = 0; h < 24; h++) {'hour': h, 'low': _round1(8 + 4 * math.sin(h / 4)), 'high': _round1(16 + 4 * math.sin(h / 4)), 'mean': _round1(12 + 4 * math.sin(h / 4))}],
    'x': 'hour',
    'from': 'low',
    'to': 'high',
    'y': 'mean',
    'title': 'Range',
  },
  'candlestick': {'type': 'candlestick', 'data': _candles, 'title': 'Candlestick', 'zoom': true},
  'ohlc': {'type': 'ohlc', 'data': _candles, 'title': 'OHLC'},
  'boxplot': {
    'type': 'boxplot',
    'data': [
      for (final (s, m) in [('api', 70.0), ('web', 120.0), ('db', 40.0)])
        for (var i = 0; i < 40; i++) {'service': s, 'ms': _round1(m + _rand.normal() * m * 0.25)},
    ],
    'x': 'service',
    'y': 'ms',
    'title': 'Box plot',
  },
  'waterfall': {
    'type': 'waterfall',
    'data': [for (final (s, v) in [('Start', 100), ('Sales', 40), ('Refunds', -15), ('Costs', -30)]) {'step': s, 'v': v}],
    'title': 'Waterfall',
  },
  'heatmap': {
    'type': 'heatmap',
    'data': [
      for (final d in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
        for (var h = 0; h < 24; h += 2) {'x': '${h}h', 'y': d, 'value': (20 + 15 * math.sin(h / 4) + _rand.next() * 10).round()},
    ],
    'title': 'Heatmap',
  },
  'calendar': {
    'type': 'calendar',
    'data': [
      for (var d = 0; d < 120; d++) {'date': DateTime.utc(2026, 1, 1 + d).toIso8601String().substring(0, 10), 'value': (_rand.next() * 9).round()},
    ],
    'title': 'Calendar',
  },
  'pie': {'type': 'pie', 'data': _shares, 'title': 'Pie'},
  'donut': {'type': 'donut', 'data': _shares, 'title': 'Donut', 'legend': 'right'},
  'gauge': {'type': 'gauge', 'value': 72, 'label': 'CPU', 'format': 'percent', 'title': 'Gauge'},
  'radialBar': {'type': 'radialBar', 'data': _shares, 'title': 'Radial bar'},
  'radar': {
    'type': 'radar',
    'data': [for (final (s, a, b) in [('Speed', 80, 50), ('Power', 60, 90), ('Range', 70, 40), ('Cost', 40, 75), ('Grip', 85, 60)]) {'skill': s, 'a': a, 'b': b}],
    'title': 'Radar',
  },
  'rose': {'type': 'rose', 'data': _shares, 'title': 'Rose'},
  'waffle': {'type': 'waffle', 'data': _shares, 'title': 'Waffle'},
  'treemap': {'type': 'treemap', 'data': _shares, 'title': 'Treemap'},
  'funnel': {
    'type': 'funnel',
    'data': [for (final (s, n) in [('Visit', 1000), ('Signup', 420), ('Trial', 180), ('Paid', 64)]) {'stage': s, 'n': n}],
    'title': 'Funnel',
  },
  'progress': {'type': 'progress', 'value': 64, 'label': 'Upload'},
  'stat': {
    'type': 'stat',
    'data': [for (var d = 0; d < 30; d++) {'date': DateTime.utc(2026, 1, 1 + d).toIso8601String().substring(0, 10), 'visits': 1000 + d * 9 + (_rand.next() * 80).round()}],
    'y': 'visits',
    'label': 'Visits',
  },
};

class ExampleApp extends StatefulWidget {
  const ExampleApp({super.key});

  @override
  State<ExampleApp> createState() => _ExampleAppState();
}

class _ExampleAppState extends State<ExampleApp> {
  bool _light = false;

  @override
  Widget build(BuildContext context) {
    final theme = _light ? 'light' : 'dark';
    final bg = _light ? const Color(0xFFECEAE1) : const Color(0xFF0B1216);
    return MaterialApp(
      title: 'craggy_charts',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(brightness: _light ? Brightness.light : Brightness.dark, scaffoldBackgroundColor: bg, colorSchemeSeed: const Color(0xFFFFB547)),
      home: Scaffold(
        appBar: AppBar(
          backgroundColor: bg,
          title: const Text('craggy_charts'),
          actions: [
            IconButton(
              tooltip: _light ? 'Dark theme' : 'Light theme',
              icon: Icon(_light ? Icons.dark_mode : Icons.light_mode),
              onPressed: () => setState(() => _light = !_light),
            ),
          ],
        ),
        body: CustomScrollView(slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            sliver: SliverToBoxAdapter(child: LiveCharts(theme: theme)),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverGrid.extent(
              maxCrossAxisExtent: 560,
              mainAxisSpacing: 16,
              crossAxisSpacing: 16,
              childAspectRatio: 1.75,
              children: [
                for (final e in gallery.entries)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: CraggyChart.fromJson({...e.value, 'theme': theme}, key: ValueKey(e.key)),
                  ),
              ],
            ),
          ),
        ]),
      ),
    );
  }
}

/// A streaming line chart and a gauge, both driven by controllers on a timer.
class LiveCharts extends StatefulWidget {
  const LiveCharts({super.key, required this.theme});
  final String theme;

  @override
  State<LiveCharts> createState() => _LiveChartsState();
}

class _LiveChartsState extends State<LiveCharts> {
  final _line = CraggyController(), _gauge = CraggyController();
  final _rng = _Seeded(11);
  late final Timer _timer;
  double _api = 40, _worker = 60;
  int _t = 0;
  String _picked = 'Tap a point';

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 500), (_) => _tick());
  }

  void _tick() {
    _api = (_api + _rng.normal() * 4).clamp(5, 95);
    _worker = (_worker + _rng.normal() * 4).clamp(5, 95);
    _line.push({'t': '${_t++}s', 'api': _round1(_api), 'worker': _round1(_worker)});
    _gauge.update({'value': _round1(_api)});
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: CraggyChart(
            type: ChartType.line,
            data: const <Map<String, Object?>>[],
            window: 60,
            format: 'percent',
            title: 'Live',
            subtitle: 'controller.push every 500 ms; hover pauses the stream',
            theme: widget.theme,
            zoom: true,
            controller: _line,
            onTap: (p) => setState(() => _picked = '${p.title}: ${p.rows.map((r) => '${r.name} ${r.value}').join(', ')}'),
          ),
        ),
        Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(_picked)),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: CraggyChart(type: ChartType.gauge, value: 40, label: 'API load', format: 'percent', theme: widget.theme, controller: _gauge, height: 200),
        ),
      ]);
}
