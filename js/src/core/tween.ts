// Tweening. Every chart model is numbers, arrays of numbers and objects of those, so one function
// eases any chart type towards its target.
import type { Model } from './model-types';

export interface TweenState { active: boolean; seedPrev: boolean }

/** Arrays longer than this snap instead of easing: big series stay cheap. */
export const SNAP_LENGTH = 5000;

export function zero(t: any): any {
  if (Array.isArray(t)) return t.map(zero);
  if (typeof t === 'number') return 0;
  if (t && typeof t === 'object') { const o: any = {}; for (const k in t) o[k] = zero(t[k]); return o; }
  return t;
}

export function clone(t: any): any {
  if (Array.isArray(t)) return t.map(clone);
  if (t && typeof t === 'object') { const o: any = {}; for (const k in t) o[k] = clone(t[k]); return o; }
  return t;
}

/** Move `s` a fraction `k` of the way to `t`. New array elements start at 0, or at their left
 *  neighbour when `seedPrev` (live data enters from the previous value). */
export function approach(s: any, t: any, k: number, st: TweenState): any {
  if (typeof t === 'number') {
    if (typeof s !== 'number' || !Number.isFinite(s)) s = Number.isFinite(t) ? 0 : t;
    if (!Number.isFinite(t)) return t;
    const d = t - s;
    if (k < 1 && Math.abs(d) > Math.abs(t) * 1e-4 + 1e-6) { st.active = true; return s + d * k; }
    return t;
  }
  if (Array.isArray(t)) {
    const out = Array.isArray(s) ? s : [];
    if (t.length > SNAP_LENGTH && typeof t[0] === 'number') { out.length = t.length; for (let i = 0; i < t.length; i++) out[i] = t[i]; return out; }
    out.length = t.length;
    for (let i = 0; i < t.length; i++) {
      let cur = out[i];
      if (cur === undefined) cur = typeof t[i] === 'number' ? (st.seedPrev && i > 0 && typeof out[i - 1] === 'number' ? out[i - 1] : 0) : Array.isArray(t[i]) ? [] : undefined;
      out[i] = approach(cur, t[i], k, st);
    }
    return out;
  }
  if (t && typeof t === 'object') {
    const out = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
    for (const key in t) out[key] = approach(out[key], t[key], k, st);
    return out;
  }
  return t;
}

/** Keyed join: re-order the per-row arrays of `shown` so each row keeps its animated value when
 *  rows are inserted, removed or re-sorted. `fields` name model entries whose last dimension is
 *  per row (number[] or number[][]). Rows that are new come back as holes for `approach` to seed. */
export function remap(shown: Model, fields: string[], oldKeys: string[], newKeys: string[]) {
  if (!oldKeys || oldKeys === newKeys) return;
  let same = oldKeys.length === newKeys.length;
  for (let i = 0; same && i < newKeys.length; i++) same = oldKeys[i] === newKeys[i];
  if (same) return;
  const at = new Map<string, number>();
  oldKeys.forEach((k, i) => at.set(k, i));
  const move = (a: any[]) => { const out: any[] = new Array(newKeys.length); for (let i = 0; i < newKeys.length; i++) { const j = at.get(newKeys[i]); out[i] = j === undefined ? undefined : a[j]; } return out; };
  for (const f of fields) {
    const v = shown[f];
    if (!Array.isArray(v)) continue;
    shown[f] = Array.isArray(v[0]) || (v.length && v.every((x: any) => Array.isArray(x) || x === undefined)) ? v.map((a: any) => (Array.isArray(a) ? move(a) : a)) : move(v);
  }
}
