// Number and label formatting. Kept dependency-free and deterministic (no locale APIs) so that
// JS and Dart produce identical strings.

const trim = (s: string) => (s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s);

export function compact(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e12) return trim((v / 1e12).toFixed(1)) + 'T';
  if (a >= 1e9) return trim((v / 1e9).toFixed(1)) + 'B';
  if (a >= 1e6) return trim((v / 1e6).toFixed(1)) + 'M';
  if (a >= 1e4) return trim((v / 1e3).toFixed(0)) + 'k';
  if (a >= 1e3) return trim((v / 1e3).toFixed(1)) + 'k';
  if (a >= 100 || a === 0) return String(Math.round(v));
  if (a >= 1) return trim(v.toFixed(2));
  return trim(v.toPrecision(2));
}

export function grouped(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const neg = v < 0, s = Math.abs(v), d = s % 1 === 0 ? 0 : s < 1 ? 3 : 2;
  const [int, frac] = s.toFixed(d).split('.');
  const body = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + body + (frac ? '.' + frac.replace(/0+$/, '') : '').replace(/\.$/, '');
}

export function bytes(v: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let a = Math.abs(v), i = 0;
  while (a >= 1024 && i < units.length - 1) { a /= 1024; i++; }
  return (v < 0 ? '-' : '') + (a >= 100 || i === 0 ? String(Math.round(a)) : trim(a.toFixed(1))) + ' ' + units[i];
}

export function duration(ms: number): string {
  const a = Math.abs(ms), sign = ms < 0 ? '-' : '';
  if (a < 1000) return sign + compact(a) + 'ms';
  if (a < 60e3) return sign + trim((a / 1000).toFixed(1)) + 's';
  if (a < 3600e3) return sign + trim((a / 60e3).toFixed(1)) + 'm';
  if (a < 86400e3) return sign + trim((a / 3600e3).toFixed(1)) + 'h';
  return sign + trim((a / 86400e3).toFixed(1)) + 'd';
}

export const FORMATS: Record<string, (v: number) => string> = {
  compact,
  number: grouped,
  percent: v => compact(v) + '%',
  currency: v => (v < 0 ? '-$' : '$') + compact(Math.abs(v)),
  bytes,
  duration,
};

export function makeFormat(f: any): (v: number) => string {
  if (typeof f === 'function') return f;
  if (f == null) return compact;
  const fn = FORMATS[f];
  if (!fn) throw new Error(`craggy-charts: unknown format "${f}" (use ${Object.keys(FORMATS).join(', ')} or a function)`);
  return fn;
}

/** Animated numbers count with the precision of where they are heading, not the tween's. */
export function roundLike(v: number, target: number) {
  const s = String(target), i = s.indexOf('.');
  const d = i < 0 || s.includes('e') ? 0 : Math.min(4, s.length - i - 1);
  return +v.toFixed(d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** Date label at a granularity that suits the span (UTC, so output is stable everywhere). */
export function timeLabel(t: number, span: number): string {
  const d = new Date(t);
  const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  if (span < 120e3) return `${pad(h)}:${pad(mi)}:${pad(s)}`;
  if (span < 2 * 86400e3) return `${pad(h)}:${pad(mi)}`;
  if (span < 300 * 86400e3) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (span < 3 * 365 * 86400e3) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return String(d.getUTCFullYear());
}

export const monthName = (m: number) => MONTHS[m];

export function labelText(v: any): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return compact(v);
  return v == null ? '' : String(v);
}
