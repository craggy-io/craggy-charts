// Data normalisation: the flat options API (x / y / by) resolved into series.
import type { Row, Channel } from './model-types';
import { labelText } from './format';

/** Rows from any accepted data shape: rows, plain numbers, or columns. */
export function rowsOf(data: any): Row[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data.map(d => (typeof d === 'number' || d == null ? { value: d } : d));
  if (typeof data === 'object') {
    const keys = Object.keys(data), n = keys.reduce((m, k) => Math.max(m, Array.isArray(data[k]) ? data[k].length : 0), 0);
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) { const r: Row = {}; for (const k of keys) r[k] = data[k][i]; rows.push(r); }
    return rows;
  }
  throw new Error('craggy-charts: data must be rows, numbers or columns');
}

export const getter = (ch: Channel | undefined) =>
  typeof ch === 'function' ? ch : ch == null ? (_r: Row, i: number) => i : (r: Row) => r[ch];

const ISO = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
export const isDateLike = (v: any) => v instanceof Date || (typeof v === 'string' && ISO.test(v));
export function toTime(v: any): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v);
  return Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s);
}
export const num = (v: any) => (v == null || v === '' ? NaN : typeof v === 'number' ? v : +v);

/** Key of the x / label column: options.x, else the first non-number column, else null (row index). */
export function xKeyOf(rows: Row[], x: Channel | undefined): Channel | undefined {
  if (x != null) return x;
  if (!rows.length) return undefined;
  const first = rows[0];
  return Object.keys(first).find(k => first[k] != null && typeof first[k] !== 'number');
}

/** Stable identity per row for keyed transitions: the label, suffixed when a label repeats. */
export function keysOf(labels: any[]): string[] {
  if (ascendingNumbers(labels)) return labels.map(l => 'number:' + l); // no repeats possible, skip the Map
  const seen = new Map<string, number>();
  return labels.map(l => {
    const k = l instanceof Date ? 't' + l.getTime() : typeof l + ':' + String(l);
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return n ? `${k}#${n}` : k;
  });
}

function ascendingNumbers(a: any[]) {
  for (let i = 0; i < a.length; i++) if (typeof a[i] !== 'number' || (i > 0 && !(a[i] > a[i - 1]))) return false;
  return true;
}

export type XKind = 'category' | 'number' | 'time';
export interface Wide {
  xKind: XKind;
  labels: any[];
  /** Numeric x per row: row index for categories, the value for number / time. */
  xs: number[];
  keys: string[];
  names: string[];
  values: number[][];
  rows: Row[];
}

/** Rows → series. Wide data: each y column is a series. Long data: `by` splits rows into series. */
export function wide(rows: Row[], o: any): Wide {
  if (!rows.length) return { xKind: 'category', labels: [], xs: [], keys: [], names: [], values: [], rows };
  const xk = xKeyOf(rows, o.x);
  const gx = getter(xk);
  if (o.by) {
    const names: string[] = [], labels: any[] = [], seenN = new Set<string>(), seenL = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const n = String(rows[i][o.by]), l = gx(rows[i], i), lk = labelText(l) + '|' + (l instanceof Date ? l.getTime() : l);
      if (!seenN.has(n)) { seenN.add(n); names.push(n); }
      if (!seenL.has(lk)) { seenL.set(lk, labels.length); labels.push(l); }
    }
    const gy = getter(Array.isArray(o.y) ? o.y[0] : o.y ?? 'value');
    const values = names.map(() => labels.map(() => NaN));
    for (let i = 0; i < rows.length; i++) {
      const l = gx(rows[i], i), lk = labelText(l) + '|' + (l instanceof Date ? l.getTime() : l);
      values[names.indexOf(String(rows[i][o.by]))][seenL.get(lk)!] = num(gy(rows[i], i));
    }
    return finish(labels, names, values, rows, o);
  }
  const first = rows[0];
  const yKeys: Channel[] = o.y != null ? [].concat(o.y) : Object.keys(first).filter(k => k !== xk && typeof first[k] === 'number');
  const labels = rows.map((r, i) => (xk == null ? i : gx(r, i)));
  const names = yKeys.map((k, i) => (typeof k === 'string' ? k : `series ${i + 1}`));
  const values = yKeys.map(k => { const g = getter(k); return rows.map((r, i) => num(g(r, i))); });
  return finish(labels, names, values, rows, o);
}

function finish(labels: any[], names: string[], values: number[][], rows: Row[], o: any): Wide {
  let xKind: XKind = 'category';
  if (labels.length && labels.every(l => typeof l === 'number')) xKind = 'number'; // includes the row index
  else if (labels.length && labels.every(isDateLike)) xKind = 'time';
  if (o.sort && labels.length) {
    const tot = labels.map((_, i) => values.reduce((s, v) => s + (Number.isFinite(v[i]) ? v[i] : 0), 0));
    const order = labels.map((_, i) => i).sort((a, b) => (o.sort === 'asc' ? tot[a] - tot[b] : tot[b] - tot[a]) || a - b);
    labels = order.map(i => labels[i]);
    values = values.map(v => order.map(i => v[i]));
    rows = order.map(i => rows[i]);
    if (xKind !== 'category') xKind = 'category';
  }
  const xs = labels.map((l, i) => (xKind === 'number' ? l : xKind === 'time' ? toTime(l) : i));
  return { xKind, labels, xs, keys: keysOf(labels), names, values, rows };
}

export interface Cats { labels: any[]; values: number[]; keys: string[]; rows: Row[] }

/** Label / value pairs for part-to-whole types (pie, waffle, treemap, funnel...). */
export function categories(rows: Row[], o: any): Cats {
  if (!rows.length) return { labels: [], values: [], keys: [], rows };
  const first = rows[0];
  const lk = o.x ?? o.label ?? Object.keys(first).find(k => typeof first[k] !== 'number');
  const vk = (Array.isArray(o.y) ? o.y[0] : o.y) ?? (typeof o.value === 'string' ? o.value : undefined) ?? Object.keys(first).find(k => typeof first[k] === 'number');
  const gl = getter(lk), gv = getter(vk);
  let idx = rows.map((_, i) => i);
  const vals = rows.map((r, i) => Math.max(0, num(gv(r, i)) || 0));
  if (o.sort) idx = idx.sort((a, b) => (o.sort === 'asc' ? vals[a] - vals[b] : vals[b] - vals[a]) || a - b);
  const labels = idx.map(i => (lk == null ? `#${i + 1}` : gl(rows[i], i)));
  return { labels, values: idx.map(i => vals[i]), keys: keysOf(labels), rows: idx.map(i => rows[i]) };
}
