// The chart type registry: every built-in type, plus any registered by the app.
import '../types/cartesian.dart';
import '../types/grid.dart';
import '../types/radial.dart';
import 'types.dart';

final Map<String, ChartTypeDef> _registry = {...cartesianTypes, ...radialTypes, ...gridTypes};

/// Add (or replace) a chart type.
void registerType(String name, ChartTypeDef def) => _registry[name] = def;

ChartTypeDef typeDef(String name) {
  final d = _registry[name];
  if (d == null) throw ArgumentError('craggy-charts: unknown chart type "$name" (${_registry.keys.join(', ')})');
  return d;
}

List<String> registeredTypes() => _registry.keys.toList();
