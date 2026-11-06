import type { RGB } from './model-types';

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const ease = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
export const sum = (a: number[]) => { let s = 0; for (const v of a) s += v; return s; };
export const css = (c: RGB, alpha = 1) => (alpha >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`);
export const TAU = Math.PI * 2;

export function hex(c: string): RGB {
  const s = c.trim();
  if (s[0] === '#') {
    const h = s.length === 4 ? s.slice(1).split('').map(x => x + x).join('') : s.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2]]; }
  throw new Error(`craggy-charts: unsupported colour "${c}" (use #rrggbb or rgb())`);
}

/** A colour ramp from the fade colour (≈ background) to the full colour, so fills fade into the grid. */
export function shades(fade: RGB, rgb: RGB, lo: number, hi: number, n = 16): RGB[] {
  const out: RGB[] = [];
  for (let k = 0; k < n; k++) out.push(mix(fade, rgb, lo + ((hi - lo) * k) / (n - 1)));
  return out;
}
export const pick = (ramp: RGB[], t: number) => ramp[Math.round(clamp(t) * (ramp.length - 1))];

/** Sample a multi-stop ramp at t ∈ [0, 1]. */
export function ramp(stops: RGB[], t: number): RGB {
  t = clamp(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[i], stops[i + 1], t - i);
}

/** Index of the item whose position is closest to x. */
export function nearest(n: number, at: (i: number) => number, x: number) {
  let best = -1, d = Infinity;
  for (let i = 0; i < n; i++) { const e = Math.abs(at(i) - x); if (e < d) { d = e; best = i; } }
  return best;
}

export const isNum = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);

/** Largest value of an array, ignoring NaN; no argument spread, so safe for millions of items. */
export function maxOf(a: ArrayLike<number>, floor = -Infinity) { let m = floor; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
/** Smallest value of an array, ignoring NaN. */
export function minOf(a: ArrayLike<number>, ceil = Infinity) { let m = ceil; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
