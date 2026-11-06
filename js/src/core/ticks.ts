export interface Ticks { min: number; max: number; ticks: number[]; step: number }

/** Round-number ticks covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): Ticks {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (!(hi > lo)) { const p = Math.abs(lo) * 0.1 || 1; lo -= p; hi += p; }
  count = Math.max(1, count);
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let k = 0, v = min; v <= max + step * 1e-6 && k < 1000; k++, v = min + k * step) ticks.push(+v.toPrecision(12));
  return { min: +min.toPrecision(12), max: +max.toPrecision(12), ticks, step };
}

/** Ticks in log10 space: values passed and returned are exponents. */
export function logTicks(lo: number, hi: number): Ticks {
  const min = Math.floor(lo), max = Math.max(min + 1, Math.ceil(hi));
  const ticks: number[] = [];
  for (let v = min; v <= max; v++) ticks.push(v);
  return { min, max, ticks, step: 1 };
}

const SEC = 1e3, MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const STEPS = [SEC, 5 * SEC, 15 * SEC, 30 * SEC, MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY];

/** Calendar-aligned ticks for a UTC time span (ms). */
export function timeTicks(t0: number, t1: number, count = 5): number[] {
  const span = Math.max(1, t1 - t0), target = span / Math.max(1, count);
  const step = STEPS.find(s => s >= target);
  const out: number[] = [];
  if (step) {
    for (let t = Math.ceil(t0 / step) * step; t <= t1 && out.length < 200; t += step) out.push(t);
    return out;
  }
  // Months or years
  const d0 = new Date(t0);
  const months = span / (30 * DAY) / count;
  const mStep = months <= 1.25 ? 1 : months <= 2.5 ? 2 : months <= 3.5 ? 3 : months <= 7 ? 6 : 12 * Math.ceil(months / 12);
  let y = d0.getUTCFullYear(), m = d0.getUTCMonth();
  m = Math.ceil(m / mStep) * mStep;
  for (let k = 0; k < 400; k++) {
    const t = Date.UTC(y + Math.floor(m / 12), m % 12, 1);
    if (t > t1) break;
    if (t >= t0) out.push(t);
    m += mStep;
  }
  return out;
}
