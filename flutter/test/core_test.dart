// Unit tests of the headless Dart core, ported from js/test/core.test.ts.
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:craggy_charts/src/core/chart_core.dart';
import 'package:craggy_charts/src/core/data.dart';
import 'package:craggy_charts/src/core/export.dart';
import 'package:craggy_charts/src/core/field.dart';
import 'package:craggy_charts/src/core/format.dart';
import 'package:craggy_charts/src/core/registry.dart';
import 'package:craggy_charts/src/core/theme.dart';
import 'package:craggy_charts/src/core/ticks.dart';
import 'package:craggy_charts/src/core/tween.dart';
import 'package:craggy_charts/src/core/util.dart';
import 'package:craggy_charts/src/generated/options.g.dart';
import 'package:craggy_charts/src/types/cartesian.dart';
import 'package:craggy_charts/src/types/grid.dart';
import 'package:flutter_test/flutter_test.dart';

import 'snapshot.dart';

final _fixtures = (jsonDecode(File('../conformance/fixtures.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();
Map<String, dynamic> fixture(String name) => _fixtures.firstWhere((f) => f['name'] == name);
Map<String, dynamic> optionsOf(String name) => Map<String, dynamic>.from(fixture(name)['options'] as Map);

ChartCore settled(Map<String, dynamic> options, [double w = 480, double h = 260]) => ChartCore(options)
  ..setSize(w, h)
  ..settle();

Matcher throwsMessage(String part) => throwsA(predicate((e) => '$e'.contains(part), 'error containing "$part"'));

double dt60 = 1 / 60;

void main() {
  group('format', () {
    test('compacts numbers', () {
      expect([0, 7, 12.5, 999, 1234, 12345, 1.5e6, 2e9, 3.25e12, 0.0123, -4200].map(compact).toList(),
          ['0', '7', '12.5', '999', '1.2k', '12k', '1.5M', '2B', '3.3T', '0.012', '-4.2k']);
    });
    test('groups, bytes and durations', () {
      expect(grouped(1234567.891), '1,234,567.89');
      expect(grouped(-1200), '-1,200');
      expect(bytes(1536), '1.5 KB');
      expect(bytes(3 * math.pow(1024, 3)), '3 GB');
      expect(duration(450), '450ms');
      expect(duration(90e3), '1.5m');
      expect(makeFormat('currency')(-1500), '-\$1.5k');
      expect(makeFormat('percent')(45), '45%');
    });
    test('rejects unknown formats', () => expect(() => makeFormat('nope'), throwsMessage('unknown format')));
    test('counts with the precision of the target', () {
      expect(roundLike(41.98765, 42.5), 42);
      expect(roundLike(3.14159, 3), 3);
    });
    test('labels time at the granularity of the span (UTC)', () {
      final t = DateTime.utc(2026, 3, 14, 9, 5, 7).millisecondsSinceEpoch;
      expect(timeLabel(t, 60e3), '09:05:07');
      expect(timeLabel(t, 86400e3), '09:05');
      expect(timeLabel(t, 30 * 86400e3), 'Mar 14');
      expect(timeLabel(t, 400 * 86400e3), 'Mar 2026');
      expect(timeLabel(t, 4000 * 86400e3), '2026');
    });
    test('JS number semantics', () {
      expect([jsRound(2.5), jsRound(-2.5), jsRound(0.49999999999999994)], [3, -2, 0]);
      expect([jsNum(5.0), jsNum(0.1 + 0.2), jsNum(1e21), jsNum(-0.0), jsNum(1e-7)], ['5', '0.30000000000000004', '1e+21', '0', '1e-7']);
      expect([log10(1000), log10(1e-3), log10(2)], [3, -3, 0.3010299956639812]);
      expect(hypot(3, 4), 5);
    });
  });

  group('ticks', () {
    test('picks round steps covering the range', () {
      final t = niceTicks(0, 97, 4);
      expect([t.min, t.max, t.step], [0, 100, 20]);
      expect(niceTicks(-3.2, 7.9, 5).ticks, [-4, -2, 0, 2, 4, 6, 8]);
      expect(niceTicks(5, 5, 4).ticks.length, greaterThan(1));
    });
    test('log and time ticks', () {
      expect(logTicks(0.2, 3.7).ticks, [0, 1, 2, 3, 4]);
      final t = timeTicks(DateTime.utc(2026).millisecondsSinceEpoch, DateTime.utc(2026, 7).millisecondsSinceEpoch, 6);
      expect(t.map((v) => utc(v).month - 1).toList(), [0, 1, 2, 3, 4, 5, 6]);
    });
  });

  group('data inference', () {
    test('accepts rows, numbers and columns', () {
      expect(rowsOf([3, 5]), [
        {'value': 3},
        {'value': 5},
      ]);
      expect(rowsOf({
        'a': [1, 2],
        'b': [3, 4],
      }), [
        {'a': 1, 'b': 3},
        {'a': 2, 'b': 4},
      ]);
    });
    test('infers x and every numeric y; detects time and number x', () {
      final w = wide(rowsOf([
        {'m': 'Jan', 'a': 1, 'b': 2},
        {'m': 'Feb', 'a': 3, 'b': 4},
      ]), {});
      expect(w['names'], ['a', 'b']);
      expect(w['labels'], ['Jan', 'Feb']);
      expect(w['xKind'], 'category');
      expect(wide(rowsOf([
        {'d': '2026-01-01', 'v': 1},
        {'d': '2026-01-02', 'v': 2},
      ]), {})['xKind'], 'time');
      expect(wide(rowsOf([
        {'v': 1},
        {'v': 2},
      ]), {'x': (Row _, int i) => i * 10})['xKind'], 'number');
    });
    test('splits long data with by', () {
      final w = wide(rowsOf([
        {'x': 'a', 's': 'p', 'v': 1},
        {'x': 'a', 's': 'q', 'v': 2},
        {'x': 'b', 's': 'p', 'v': 3},
      ]), {'by': 's', 'y': 'v'});
      final values = w['values'] as List<List<double>>;
      expect(w['names'], ['p', 'q']);
      expect(values[1][1].isNaN, isTrue);
      expect(values[0], [1, 3]);
    });
    test('sorts categories', () {
      expect(categories(rowsOf([
        {'k': 'a', 'v': 1},
        {'k': 'b', 'v': 3},
      ]), {'sort': 'desc'})['labels'], ['b', 'a']);
    });
  });

  group('tween and keyed joins', () {
    test('eases any model and seeds new rows', () {
      final st = TweenState();
      final s = approach(zero({
        'a': [0, 0],
      }), {
        'a': [10, 20],
        'b': 4,
      }, 0.5, st);
      expect(s, {
        'a': [5, 10],
        'b': 2,
      });
      expect(st.active, isTrue);
      final live = approach(<dynamic>[1, 2], [1, 2, 9], 0, TweenState(seedPrev: true)) as List;
      expect(live[2], 2); // enters from its left neighbour
    });
    test('snaps very long arrays', () {
      final big = List.generate(snapLength + 1, (i) => i.toDouble());
      expect((approach(<dynamic>[], big, 0.1, TweenState()) as List)[100], 100);
    });
    test('re-orders shown values by key', () {
      final shown = <String, dynamic>{
        'v': <dynamic>[1, 2, 3],
        's': <dynamic>[
          <dynamic>[1, 2, 3],
        ],
      };
      remap(shown, ['v', 's'], ['a', 'b', 'c'], ['c', 'a', 'x']);
      expect((shown['v'] as List).sublist(0, 2), [3, 1]);
      expect((shown['v'] as List)[2], isNull);
      expect(((shown['s'] as List)[0] as List).sublist(0, 2), [3, 1]);
    });
    test('moves a re-sorted bar with its label', () {
      final c = settled({
        'type': 'bar',
        'data': [
          {'k': 'a', 'v': 1},
          {'k': 'b', 'v': 5},
        ],
      });
      c.update({
        'data': [
          {'k': 'b', 'v': 5},
          {'k': 'a', 'v': 1},
        ],
      });
      final p = c.parts[0];
      expect((p.shown!['s'] as List)[0], [5, 1]); // values travelled with their keys
      expect(p.shown!['px'], [1, 0]); // and start at their old positions
      expect(p.model['px'], [0, 1]);
    });
  });

  group('field and rasterisers', () {
    test('plots with the later-layer-wins rule', () {
      final f = Field(4, 4), g = Raster(f, 6);
      g.plot(1, 1, 0.8, [255, 0, 0]);
      g.plot(1, 1, 0.3, [0, 255, 0]); // faint: keeps the stronger colour
      expect(f.col.sublist(f.at(1, 1) * 3, f.at(1, 1) * 3 + 3), [255, 0, 0]);
      g.plot(1, 1, 0.6, [0, 0, 255]); // solid enough: takes over
      expect(f.col[f.at(1, 1) * 3 + 2], 255);
      expect(f.cov[f.at(1, 1)], closeTo(0.8, 1e-6));
    });
    test('rect coverage is the area overlap', () {
      final f = Field(4, 4), g = Raster(f, 6);
      g.rect(0.5, 0, 2, 1, <double>[1, 2, 3]);
      expect(f.cov[f.at(0, 0)], closeTo(0.5, 1e-6));
      expect(f.cov[f.at(1, 0)], closeTo(1, 1e-6));
    });
    test('lines are continuous and break at gaps', () {
      final f = Field(20, 10), g = Raster(f, 6);
      g.line([0.5, 2, 19.5, 8], 1, [9, 9, 9]);
      for (var c = 1; c < 19; c++) {
        expect([for (var r = 0; r < 10; r++) f.cov[f.at(c, r)]].any((v) => v > 0.5), isTrue);
      }
      final h = Field(10, 4), gh = Raster(h, 6);
      gh.line([0.5, 2, 3.5, 2, double.nan, double.nan, 6.5, 2, 9.5, 2], 1, [9, 9, 9]);
      expect(h.cov[h.at(5, 2)], lessThan(0.2));
    });
    test('sector, polygon and disc fill', () {
      final f = Field(20, 20), g = Raster(f, 6);
      g.sector(10, 10, 0, 8, 0, math.pi, 0, (_, _) => [1, 1, 1]);
      expect(f.cov[f.at(14, 10)], greaterThan(0.9)); // right half (clockwise from 12)
      expect(f.cov[f.at(5, 10)], 0);
      g.polygon([0, 0, 4, 0, 0, 4], [2, 2, 2], 1);
      expect(f.cov[f.at(0, 0)], 1);
      g.disc(16, 16, 2, [3, 3, 3]);
      expect(f.cov[f.at(16, 16)], 1);
    });
    test('smooth never overshoots; steps and columns', () {
      final p = smooth([0, 1, 2, 3], [0, 10, 0, 10], 8);
      for (var i = 1; i < p.length; i += 2) {
        expect(p[i], inInclusiveRange(0, 10));
      }
      expect(steps([0, 2], [1, 3]), [0, 1, 1, 1, 1, 3, 2, 3]);
      expect(columnsY([0, 0, 4, 4], 4)[1], closeTo(1.5, 1e-9));
    });
    test('M4 decimation keeps extremes and bounds the output', () {
      final xs = List.generate(100000, (i) => (i / 100000) * 50), ys = [for (var i = 0; i < xs.length; i++) i == 54321 ? 999.0 : math.sin(i)];
      final idx = decimate(xs, ys, 50);
      expect(idx.length, lessThanOrEqualTo(50 * 4 + 4));
      expect(idx.any((i) => ys[i] == 999), isTrue);
      for (var k = 1; k < idx.length; k++) {
        expect(idx[k], greaterThan(idx[k - 1])); // ascending, no repeats
      }
    });
  });

  group('types', () {
    test('registers every schema type', () => expect(registeredTypes().toSet(), chartTypeNames.values.toSet()));
    for (final f in _fixtures) {
      test('${f['name']} renders, labels and answers tooltips', () {
        final c = render(f);
        expect(c.litTiles(), greaterThan(40));
        final ids = c.ids();
        expect(ids, isNotEmpty);
        final hit = c.tip(ids[0]);
        expect(hit, isNotNull);
        expect(hit!.rows, isNotEmpty);
        final (ax, ay) = c.anchor(ids[0]);
        expect(ax.isFinite && ay.isFinite, isTrue);
        expect(c.summary(), contains('chart'));
      });
    }
    test('quartiles and outliers', () {
      expect(quantile([1, 2, 3, 4], 0.5), 2.5);
      final stats = render(fixture('boxplot')).parts[0].fixed!['stats'] as List<BoxStats>;
      expect(stats[0].out, isNotEmpty);
    });
    test('waterfall running totals', () {
      final f = render(fixture('waterfall')).parts[0].fixed!;
      expect(f['v1'], [100, 140, 125, 95, 95]);
      expect(f['kind'], ['up', 'up', 'down', 'down', 'total']);
    });
    test('waffle and treemap layouts conserve the whole', () {
      expect(waffleOwners([42, 26, 18, 9, 5], 100).length, 100);
      expect(waffleOwners([1, 1, 1], 100).where((o) => o == 0).length, 34);
      final rects = squarify([(0, 6), (1, 6), (2, 4), (3, 3), (4, 2), (5, 2), (6, 1)], 0, 0, 6, 4);
      expect(rects.fold<double>(0, (s, r) => s + r.$4 * r.$5), closeTo(24, 1e-9));
    });
    test('the stat glyph font covers every formatted character', () {
      for (final s in ['1,284', '\$1.5k', '-42%', '3.2M', '12:30', '1/2', '450ms', '1.5h', '2d', '+7', '9.9B', '1T', '3G', '1 KB']) {
        for (final ch in s.split('')) {
          expect(glyphs[ch], isNotNull, reason: ch);
        }
      }
      expect(glyphWidth('10'), 5 + 1 + 5);
    });
    test('heatmap goes diverging when data crosses zero', () {
      expect(render(fixture('heatmap')).parts[0].fixed!['diverging'], isFalse);
      expect(render(fixture('heatmap-diverging')).parts[0].fixed!['diverging'], isTrue);
    });
    test('percent stacks sum to 100', () {
      final v = render(fixture('area-percent')).parts[0].fixed!['vals'] as List;
      expect((v[0] as List)[3] + (v[1] as List)[3] + (v[2] as List)[3], closeTo(100, 1e-9));
    });
    test('combo series move to their own part and axis', () {
      final c = render(fixture('combo'));
      expect(c.parts.map((p) => p.opts['type']).toList(), ['bar', 'line']);
      expect(c.domRight, isNotNull);
      expect(c.out.labelsY.any((l) => l.side == 'right'), isTrue);
    });
    test('log axis ticks are powers of ten', () {
      expect(render(fixture('line-log')).out.labelsY.map((l) => l.text).toList(), ['1', '10', '100', '1k', '10k']);
    });
  });

  group('interaction state', () {
    test('picks the nearest index and the slice under the pointer', () {
      final c = render(fixture('bar'));
      final g = c.grid!;
      expect(c.pick(g.ox + g.cols * g.cell * (2.5 / 6), g.oy + 10), 2);
      final p = render(fixture('pie'));
      final pg = p.grid!, cx = pg.ox + (pg.cols * pg.cell) / 2, cy = pg.oy + (pg.rows * pg.cell) / 2;
      expect(p.pick(cx + 20, cy - 40), 0); // first slice starts at 12 o'clock, clockwise
      expect(p.pick(5, 5), -1);
    });
    test('hidden series animate out and leave the legend marked', () {
      final c = render(fixture('bar-grouped'));
      c.toggle('south');
      c.settle();
      expect(c.legend().firstWhere((l) => l.name == 'south').hidden, isTrue);
      expect(((c.parts[0].model['s'] as List)[1] as List).every((v) => v == 0), isTrue);
    });
    test('focus dims every other series', () {
      final c = render(fixture('bar-grouped'));
      final before = c.colors['north'];
      c.setFocus('south');
      expect(c.colors['north'], isNot(before));
      expect(c.colors['south'], c.theme.palette[1]);
    });
    test('zoom narrows the domain to the visible rows', () {
      final c = render(fixture('line-time'));
      final full = c.domLeft!.ticks.max;
      c.setView(0, 0.1);
      c.settle();
      expect(c.view, [0, 0.1]);
      expect(c.selection(0, c.grid!.cols.toDouble())!.indices.$2, lessThan(10));
      expect(c.domLeft!.ticks.max, lessThanOrEqualTo(full));
    });
    test('live window drops old rows and scrolls at constant speed', () {
      final c = ChartCore({'type': 'line', 'data': <Object>[], 'window': 10});
      c.setSize(300, 120);
      for (var i = 0; i < 15; i++) {
        c.push([
          {'value': i},
        ], 1000.0 + i * 500);
      }
      expect(c.rows.length, 10);
      expect(c.dropped, 5);
      expect(c.pushEvery, closeTo(0.5, 0.05));
      final off = c.off;
      c.frame(10000, 0.1);
      expect(c.off, lessThan(off));
    });
    test('patch merges into the newest row', () {
      final c = settled({'type': 'candlestick', 'data': optionsOf('candlestick')['data']});
      c.patch({'close': 999});
      expect(c.rows.last['close'], 999);
      expect(c.rows.last['open'], isNotNull);
    });
    test('settles: the frame loop reports idle', () {
      final c = ChartCore(optionsOf('line'));
      c.setSize(480, 260);
      var t = 0.0, frames = 0;
      while (c.frame(t, dt60) && frames < 2000) {
        t += 1000 / 60;
        frames++;
      }
      expect(frames, lessThan(400));
      expect(c.frame(t, dt60), isFalse);
    });
    test('reduced motion snaps', () {
      final c = ChartCore(optionsOf('bar'), CoreEnv(reducedMotion: true));
      c.setSize(480, 260);
      expect(c.frame(0, dt60), isFalse);
      expect(c.litTiles(), greaterThan(100));
    });
  });

  group('themes and options', () {
    test('resolves themes and custom tokens', () {
      expect(resolveTheme('light').bg, hex('#F7F5EF'));
      expect(resolveTheme({
        'base': 'light',
        'palette': ['#ff0000'],
      }).palette[0], [255, 0, 0]);
      expect(resolveTheme('auto', true).name, 'light');
      expect(() => resolveTheme('neon'), throwsArgumentError);
    });
    test('custom colours and series colour overrides', () {
      expect(render(fixture('custom-colors')).colors['north'], [255, 0, 102]);
      final s = settled({
        'type': 'line',
        'data': optionsOf('line')['data'],
        'series': {
          'south': {'color': '#010203'},
        },
      });
      expect(s.colors['south'], [1, 2, 3]);
    });
    test('validates options with helpful errors', () {
      expect(() => ChartCore({'data': <Object>[]}), throwsMessage('type is required'));
      expect(() => ChartCore({'type': 'sankey'}), throwsMessage('unknown chart type "sankey"'));
      expect(() => settled({'type': 'line', 'data': [1, 2], 'cell': -1}), throwsMessage('cell'));
    });
    test('cell size changes the resolution', () {
      expect(render(fixture('fine')).grid!.cols, greaterThan(render(fixture('line')).grid!.cols * 1.8));
      expect(render(fixture('chunky')).grid!.cell, 12);
    });
    test('the enum type works as well as its name', () {
      expect(settled({'type': ChartType.radialBar, 'data': optionsOf('pie')['data']}).type, 'radialBar');
    });
    test('util helpers', () {
      expect(mix([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
      expect(nearest(5, (i) => i * 2.0, 5.2), 3);
      expect(stableSorted([3, 1, 2, 1], (a, b) => cmp(a - b)), [1, 1, 2, 3]);
    });
  });

  group('export', () {
    test('SVG has one rect per lit tile and the labels as text', () {
      final c = render(fixture('bar'));
      final svg = toSvg(c);
      final lit = c.size.where((v) => v >= 0.02).length;
      expect(RegExp('<rect ').allMatches(svg).length, lit + 3);
      expect(svg, contains('>Jan<'));
      expect(svg.startsWith('<svg'), isTrue);
    });
  });
}
