import '../generated/tokens.g.dart';
import 'util.dart';

/// Resolved theme: colours as RGB.
class ChartTheme {
  ChartTheme({
    required this.name,
    required this.bg,
    required this.unlit,
    required this.grid,
    required this.fade,
    required this.text,
    required this.textHi,
    required this.snow,
    required this.up,
    required this.down,
    required this.tooltipBg,
    required this.tooltipBorder,
    required this.palette,
    required this.terrain,
    required this.diverging,
  });

  final String name;
  final RGB bg, unlit, grid, fade, text, textHi, snow, up, down;

  /// CSS colours (`#rrggbb` or `rgba()`), as the tokens give them.
  final String tooltipBg, tooltipBorder;
  final List<RGB> palette, terrain, diverging;
}

/// The generated design tokens, typed.
abstract final class Tokens {
  static Map<String, dynamic> _map(Object? o) => Map<String, dynamic>.from(o! as Map);
  static Map<String, dynamic> get springs => _map(tokens['springs']);
  static Map<String, dynamic> get cells => _map(tokens['cells']);
  static Map<String, dynamic> get tile => _map(tokens['tile']);
  static Map<String, dynamic> get themes => _map(tokens['themes']);
  static String get font => tokens['font']! as String;
}

List<RGB> _hexes(Object? l) => [for (final c in l! as List) hex(c as String)];

ChartTheme _resolve(String name, Map<String, dynamic> t) => ChartTheme(
      name: name,
      bg: hex(t['bg'] as String),
      unlit: hex(t['unlit'] as String),
      grid: hex(t['grid'] as String),
      fade: hex(t['fade'] as String),
      text: hex(t['text'] as String),
      textHi: hex(t['textHi'] as String),
      snow: hex(t['snow'] as String),
      up: hex(t['up'] as String),
      down: hex(t['down'] as String),
      tooltipBg: t['tooltipBg'] as String,
      tooltipBorder: t['tooltipBorder'] as String,
      palette: _hexes(t['palette']),
      terrain: _hexes(t['terrain']),
      diverging: _hexes(t['diverging']),
    );

Map<String, dynamic> _builtIn(String name) => Map<String, dynamic>.from(Tokens.themes[name] as Map);

/// 'dark' | 'light' | 'auto' | partial tokens (merged over dark, or over light when tokens.base == 'light').
ChartTheme resolveTheme(Object? opt, [bool prefersLight = false]) {
  if (opt == null || opt == 'dark') return _resolve('dark', _builtIn('dark'));
  if (opt == 'light') return _resolve('light', _builtIn('light'));
  if (opt == 'auto') return prefersLight ? _resolve('light', _builtIn('light')) : _resolve('dark', _builtIn('dark'));
  if (opt is Map) {
    final base = opt['base'] == 'light' ? 'light' : 'dark';
    return _resolve('custom', {..._builtIn(base), ...Map<String, dynamic>.from(opt)});
  }
  throw ArgumentError('craggy-charts: unknown theme "$opt"');
}

/// Series colours: options.series[name].color, then options.colors (list or map), then the palette.
List<RGB> seriesColors(Map<String, dynamic> opts, List<String> names, ChartTheme theme) {
  final c = opts['colors'], s = mapOf(opts['series']);
  return [
    for (var i = 0; i < names.length; i++)
      () {
        final sn = s[names[i]];
        final v = (sn is Map && truthy(sn['color']) ? sn['color'] : null) ?? (c is List ? (i < c.length ? c[i] : null) : c is Map ? c[names[i]] : null);
        return truthy(v) ? hex(v as String) : theme.palette[i % theme.palette.length];
      }(),
  ];
}
