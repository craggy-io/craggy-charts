/// Charts drawn in the Craggy tile grid: one flat options object, beautiful defaults and smooth
/// animation, with the same API and JSON options as the craggy-charts JavaScript package.
library;

export 'src/core/chart_core.dart' show ChartCore, CoreEnv, LegendEntry, Selection;
export 'src/core/format.dart' show Fmt, makeFormat, formats, timeLabel, labelText;
export 'src/core/model_types.dart';
export 'src/core/registry.dart' show registerType, typeDef, registeredTypes;
export 'src/core/theme.dart' show ChartTheme, resolveTheme;
export 'src/core/util.dart' show RGB, Row;
export 'src/generated/options.g.dart';
export 'src/core/export.dart' show toSvg, tileShape, TileShape;
export 'src/widget/chart.dart' show CraggyChart, defaultHeight;
export 'src/widget/controller.dart' show CraggyController;
export 'src/widget/events.dart';
