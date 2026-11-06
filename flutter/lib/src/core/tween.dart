// Tweening. Every chart model is numbers, lists of numbers and maps of those, so one function
// eases any chart type towards its target.

/// Mutable state of one tween pass.
class TweenState {
  TweenState({this.active = false, this.seedPrev = false});
  bool active;
  bool seedPrev;
}

/// Lists longer than this snap instead of easing: big series stay cheap.
const snapLength = 5000;

dynamic zero(dynamic t) {
  if (t is List) return [for (final v in t) zero(v)];
  if (t is num) return 0.0;
  if (t is Map) return <String, dynamic>{for (final e in t.entries) e.key as String: zero(e.value)};
  return t;
}

dynamic clone(dynamic t) {
  if (t is List) return [for (final v in t) clone(v)];
  if (t is Map) return <String, dynamic>{for (final e in t.entries) e.key as String: clone(e.value)};
  return t;
}

/// Move `s` a fraction `k` of the way to `t`. New list elements start at 0, or at their left
/// neighbour when `seedPrev` (live data enters from the previous value).
dynamic approach(dynamic s, dynamic t, double k, TweenState st) {
  if (t is num) {
    if (s is! num || !s.isFinite) s = t.isFinite ? 0.0 : t;
    if (!t.isFinite) return t;
    final d = t - s;
    if (k < 1 && d.abs() > t.abs() * 1e-4 + 1e-6) {
      st.active = true;
      return s + d * k;
    }
    return t;
  }
  if (t is List) {
    // Eased in place, except typed lists (which cannot hold holes), which are copied first.
    final List<dynamic> out = s is List ? (s is List<num> || s is List<List> ? List<dynamic>.of(s) : s) : <dynamic>[];
    if (t.length > snapLength && t.isNotEmpty && t[0] is num) {
      out.length = t.length;
      for (var i = 0; i < t.length; i++) {
        out[i] = t[i];
      }
      return out;
    }
    out.length = t.length;
    for (var i = 0; i < t.length; i++) {
      final cur = out[i] ??
          (t[i] is num
              ? (st.seedPrev && i > 0 && out[i - 1] is num ? out[i - 1] : 0.0)
              : t[i] is List
                  ? <dynamic>[]
                  : null);
      out[i] = approach(cur, t[i], k, st);
    }
    return out;
  }
  if (t is Map) {
    final out = s is Map<String, dynamic> ? s : <String, dynamic>{};
    for (final key in t.keys) {
      out[key as String] = approach(out[key], t[key], k, st);
    }
    return out;
  }
  return t;
}

/// Keyed join: re-order the per-row lists of `shown` so each row keeps its animated value when
/// rows are inserted, removed or re-sorted. `fields` name model entries whose last dimension is
/// per row (`List<num>` or `List<List<num>>`). New rows come back as holes (null) for `approach` to seed.
void remap(Map<String, dynamic> shown, List<String> fields, List<String>? oldKeys, List<String> newKeys) {
  if (oldKeys == null || identical(oldKeys, newKeys)) return;
  var same = oldKeys.length == newKeys.length;
  for (var i = 0; same && i < newKeys.length; i++) {
    same = oldKeys[i] == newKeys[i];
  }
  if (same) return;
  final at = <String, int>{};
  for (var i = 0; i < oldKeys.length; i++) {
    at[oldKeys[i]] = i;
  }
  List<dynamic> move(List<dynamic> a) => [
        for (final k in newKeys)
          () {
            final j = at[k];
            return j == null || j >= a.length ? null : a[j];
          }(),
      ];
  for (final f in fields) {
    final v = shown[f];
    if (v is! List) continue;
    final nested = (v.isNotEmpty && v[0] is List) || (v.isNotEmpty && v.every((x) => x is List || x == null));
    shown[f] = nested ? [for (final a in v) a is List ? move(a) : a] : move(v);
  }
}
