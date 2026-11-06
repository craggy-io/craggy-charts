// Colours and type for the widget layer: the same tokens the JS DOM chart turns into CSS.
import 'package:flutter/painting.dart';

import '../core/export.dart';
import '../core/theme.dart';
import '../core/util.dart';

/// The token font stack as a Flutter family plus fallbacks.
const String fontFamily = 'JetBrains Mono';
const List<String> fontFallback = ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'];

int _channel(num v) => v.round().clamp(0, 255);

/// An [RGB] (0-255 channels) as a Flutter colour.
Color rgbColor(RGB c, [double alpha = 1]) => Color.fromARGB(_channel(alpha * 255), _channel(c[0]), _channel(c[1]), _channel(c[2]));

final _rgba = RegExp(r'^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$');

/// A token CSS colour (`#rrggbb` or `rgb[a](r,g,b[,a])`) as a Flutter colour.
Color cssColor(String s) {
  final m = _rgba.firstMatch(s.trim());
  if (m == null) return rgbColor(hex(s));
  return rgbColor([double.parse(m[1]!), double.parse(m[2]!), double.parse(m[3]!)], m[4] == null ? 1 : double.parse(m[4]!));
}

/// Monospace text in a theme colour, with tabular figures (as `.cc` sets them).
TextStyle chartText(Color color, double size, [FontWeight weight = FontWeight.w400]) => TextStyle(
  color: color,
  fontSize: size,
  fontWeight: weight,
  fontFamily: fontFamily,
  fontFamilyFallback: fontFallback,
  fontFeatures: const [FontFeature.tabularFigures()],
  height: 1.35,
);

/// A CSS numeric font weight as a Flutter weight.
FontWeight weightOf(int w) => FontWeight.values[((w ~/ 100) - 1).clamp(0, 8)];

/// Colour of a text item ('text', 'textHi' or an RGB) at an alpha.
Color itemColor(ChartTheme th, Object color, [double alpha = 1]) => rgbColor(textColor(th, color), alpha);
