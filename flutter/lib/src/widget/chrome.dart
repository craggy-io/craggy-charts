// The chart's chrome around the tiles: title, legend chips and the tooltip card. The same layout and
// tokens as the JS DOM chart's CSS (js/src/dom/style.ts).
import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import '../core/chart_core.dart';
import '../core/model_types.dart';
import '../core/theme.dart';
import 'style.dart';

/// Title and subtitle (`.cc-head`).
class ChartHeader extends StatelessWidget {
  const ChartHeader({super.key, required this.theme, this.title, this.subtitle});
  final ChartTheme theme;
  final String? title, subtitle;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (title != null)
          Text(title!, style: chartText(rgbColor(theme.textHi), 13, FontWeight.w700).copyWith(letterSpacing: 0.13), semanticsLabel: title),
        if (subtitle != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(subtitle!, style: chartText(rgbColor(theme.text), 11)),
          ),
      ],
    ),
  );
}

/// Legend chips (`.cc-legend`): tap toggles, double tap isolates, hover focuses a series.
class ChartLegend extends StatelessWidget {
  const ChartLegend({
    super.key,
    required this.theme,
    required this.items,
    required this.vertical,
    required this.onToggle,
    required this.onIsolate,
    required this.onFocus,
  });
  final ChartTheme theme;
  final List<LegendEntry> items;
  final bool vertical;
  final ValueChanged<String> onToggle, onIsolate;
  final ValueChanged<String?> onFocus;

  @override
  Widget build(BuildContext context) {
    final chips = [for (final it in items) _chip(it)];
    if (vertical) {
      return ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.4),
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, spacing: 6, children: chips),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 2),
      child: Wrap(spacing: 14, runSpacing: 4, children: chips),
    );
  }

  Widget _chip(LegendEntry it) {
    final style = chartText(rgbColor(theme.textHi), 11);
    return Semantics(
      button: true,
      toggled: !it.hidden,
      label: it.name,
      excludeSemantics: true,
      child: FocusableActionDetector(
        mouseCursor: SystemMouseCursors.click,
        actions: {ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) => onToggle(it.name))},
        onShowHoverHighlight: (on) => onFocus(on && !it.hidden ? it.name : null),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => onToggle(it.name),
          onDoubleTap: () => onIsolate(it.name),
          child: Opacity(
            opacity: it.hidden ? 0.38 : 1,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                spacing: 6,
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(color: rgbColor(it.color), borderRadius: BorderRadius.circular(2)),
                  ),
                  Text(it.name, style: style, maxLines: 1, softWrap: false),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The tooltip card (`.cc-tip`): a title and one swatch / name / value row per series.
class TooltipCard extends StatelessWidget {
  const TooltipCard({super.key, required this.theme, required this.hit, this.custom});
  final ChartTheme theme;
  final Hit hit;

  /// Content from a `tooltip` function: a widget, or anything shown as text.
  final Object? custom;

  @override
  Widget build(BuildContext context) {
    final hi = chartText(rgbColor(theme.textHi), 11);
    final c = custom;
    final Widget body = c is Widget
        ? c
        : c != null
        ? Text('$c', style: hi)
        : Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  hit.title,
                  style: hi.copyWith(fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  softWrap: false,
                ),
              ),
              for (final r in hit.rows) _row(r, hi),
            ],
          );
    return Container(
      constraints: const BoxConstraints(minWidth: 96, maxWidth: 260),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: cssColor(theme.tooltipBg),
        border: Border.all(color: cssColor(theme.tooltipBorder)),
        borderRadius: BorderRadius.circular(6),
        boxShadow: const [BoxShadow(color: Color(0x47000000), offset: Offset(0, 6), blurRadius: 24)],
      ),
      child: body,
    );
  }

  Widget _row(TipRow r, TextStyle hi) => Row(
    mainAxisSize: MainAxisSize.max,
    spacing: 6,
    children: [
      Container(
        width: 7,
        height: 7,
        decoration: BoxDecoration(color: rgbColor(r.color), borderRadius: BorderRadius.circular(2)),
      ),
      Flexible(
        fit: FlexFit.tight,
        child: Text(
          r.name,
          style: hi.copyWith(color: rgbColor(theme.text), height: 1.6),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          softWrap: false,
        ),
      ),
      Padding(
        padding: const EdgeInsets.only(left: 10),
        child: Text(r.value, style: hi.copyWith(height: 1.6), softWrap: false),
      ),
    ],
  );
}

/// Places the tooltip as the JS chart does: right of and above the point, flipped and clamped to
/// stay inside the plot.
class TooltipPlacement extends SingleChildLayoutDelegate {
  TooltipPlacement(this.at);
  final Offset at;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) => constraints.loosen();

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final bounds = size, w = childSize.width, h = childSize.height;
    var x = at.dx + 14, y = at.dy - h - 10;
    if (x + w > bounds.width - 4) x = at.dx - w - 14;
    if (y < 4) y = at.dy + 16;
    x = x.clamp(4, math.max(4, bounds.width - w - 4));
    y = y.clamp(4, math.max(4, bounds.height - h - 4));
    return Offset(x.roundToDouble(), y.roundToDouble());
  }

  @override
  bool shouldRelayout(TooltipPlacement old) => old.at != at;
}
