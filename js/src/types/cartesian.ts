// Cartesian chart types: line, area, bar, histogram, scatter, bubble, range, candlestick, ohlc,
// boxplot, waterfall.
import { registerType } from '../core/chart-core';
import type { ChartTypeDef, Ctx, Extent } from '../core/types';
import type { Model, RGB } from '../core/model-types';
import { columnsY, decimate, smooth, steps, type Raster } from '../core/field';
import { clamp, maxOf, minOf, mix, pick, shades, sum } from '../core/util';
import { getter, keysOf, num, xKeyOf } from '../core/data';
import { niceTicks } from '../core/ticks';
import { barRamps, orientedRect, seriesFixed, seriesLegend, seriesRows, tipShade, visibleRange, xinfoOf, type SeriesFixed } from './common';

// ── line / area ──────────────────────────────────────────────────────────────────────────

function percentOf(values: number[][], names: string[], hidden: Set<string>): number[][] {
  const n = values[0] ? values[0].length : 0;
  const tot = Array.from({ length: n }, (_, i) => sum(values.map((v, s) => (hidden.has(names[s]) || !Number.isFinite(v[i]) ? 0 : Math.max(0, v[i])))));
  return values.map((v, s) => v.map((x, i) => (hidden.has(names[s]) || !Number.isFinite(x) ? 0 : (Math.max(0, x) / (tot[i] || 1)) * 100)));
}

function stackedExtents(ctx: Ctx, f: SeriesFixed, vals: number[][], stack: boolean, zero: boolean, pad: boolean, percent: boolean): Extent[] {
  const out: Extent[] = [];
  for (const side of ['left', 'right'] as const) {
    const idx = f.names.map((_, s) => s).filter(s => f.sides[s] === side && !ctx.hidden.has(f.names[s]));
    if (!idx.length) continue;
    let lo = Infinity, hi = -Infinity;
    visibleRange(ctx, f.labels.length, i => {
      if (stack) {
        let pos = 0, neg = 0;
        for (const s of idx) { const v = vals[s][i]; if (!Number.isFinite(v)) continue; if (v >= 0) pos += v; else neg += v; }
        hi = Math.max(hi, pos); lo = Math.min(lo, neg);
      } else for (const s of idx) { const v = vals[s][i]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    });
    if (stack) lo = Math.min(lo, 0);
    out.push({ lo, hi, side, zero, pad, percent });
  }
  return out;
}

interface LineGeometry { xs: number[]; sub: number; big: boolean; curves: { s: number; lower: number[]; upper: number[] }[] }

/** Tile-space curves per series: upper edge (the line) and lower edge (stack base or zero). */
function lineGeometry(ctx: Ctx, m: Model, f: any, n: number, curve: string): LineGeometry {
  const { cols, rows } = ctx.grid;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) xs[i] = ctx.xAt(m, i);
  const spacing = n > 1 ? Math.abs(xs[n - 1] - xs[0]) / (n - 1) : cols;
  const sub = curve === 'smooth' ? Math.min(8, Math.max(1, Math.round(spacing / 1.5))) : 1;
  const big = n > cols * 4;
  const shape = (ys: number[], xv: number[]) => (curve === 'step' ? steps(xv, ys) : smooth(xv, ys, sub));
  const cum = new Float64Array(n), base = clamp(ctx.Y(0), 0, rows);
  const curves: LineGeometry['curves'] = [];
  const at = (src: ArrayLike<number>, idx: number[] | null, map: (v: number) => number) => {
    const len = idx ? idx.length : n, out = new Array<number>(len);
    for (let k = 0; k < len; k++) out[k] = map(src[idx ? idx[k] : k]);
    return out;
  };
  for (let s = 0; s < m.s.length; s++) {
    const side = f.sides[s], row = m.s[s], a = m.a[s];
    const below = f.stack ? cum.slice() : null; // the running total underneath this series
    for (let i = 0; i < n; i++) { const v = row[i]; cum[i] = f.stack ? cum[i] + (Number.isFinite(v) ? v * a : 0) : v; }
    const toY = (v: number) => ctx.Y(v, side);
    const keep = big ? decimate(xs, at(cum, null, toY), cols) : null; // M4 indices for this series
    const xv = keep ? keep.map(i => xs[i]) : xs;
    const ys = at(cum, keep, toY), lo = below ? at(below, keep, toY) : xv.map(() => base);
    curves.push({ s, lower: big ? xv.flatMap((x, i) => [x, lo[i]]) : shape(lo, xv), upper: shape(ys, xv) });
  }
  return { xs, sub, big, curves };
}

const lineLike = (area: boolean): ChartTypeDef => ({
  kind: 'cartesian',
  keyed: ['px', 's', 'a'],
  model(ctx) {
    const f = seriesFixed(ctx), o = ctx.opts;
    const stack = area && !!o.stack, percent = stack && o.stack === 'percent';
    const vals = percent ? percentOf(f.values, f.names, ctx.hidden) : f.values;
    return {
      model: { px: f.xs.slice(), s: vals, a: f.names.map(n => (ctx.hidden.has(n) ? 0 : 1)) },
      fixed: { ...f, vals, stack, percent, fill: area || !!o.fill, fills: f.colors.map(c => shades(ctx.theme.fade, c, 0.14, 0.55)) },
    };
  },
  keys: f => f.keys,
  xinfo: f => xinfoOf(f),
  extents: (ctx, f) => stackedExtents(ctx, f, f.vals, f.stack, f.fill, !f.fill, f.percent),
  raster(ctx, m, f, g) {
    const n = m.s[0] ? m.s[0].length : 0;
    if (n < 1 || !m.px) return;
    const { cols } = ctx.grid;
    const lw = Math.max(1, 3.2 / ctx.grid.cell);
    const curve = ctx.opts.curve || 'smooth';
    // Geometry only changes when something moves; hover-only frames reuse it (matters at 1M points).
    if (!f.geo || f.geo.version !== ctx.version) f.geo = { version: ctx.version, ...lineGeometry(ctx, m, f, n, curve) };
    const { xs, sub, big, curves } = f.geo as LineGeometry;
    const order = f.stack ? curves : curves.slice().reverse(); // series 0 ends up on top
    // Every fill first, then every line, so no series' fill hides another series' line.
    if (f.fill) for (const { s, lower, upper } of order) {
      if (m.a[s] < 0.01) continue;
      g.pattern = f.patterns[s];
      const top = columnsY(upper, cols), bottom = columnsY(lower, cols), ramp = f.fills[s];
      for (let c = 0; c < cols; c++) g.span(c, bottom[c], top[c], ramp, 1.3, 0.95 * m.a[s]);
    }
    for (const { s, upper } of order) {
      if (m.a[s] < 0.01) continue;
      g.pattern = f.patterns[s];
      g.line(upper, lw, f.colors[s], m.a[s]);
    }
    g.pattern = 'solid';
    for (const { s, upper } of order) {
      if (m.a[s] < 0.01 || big) continue;
      const yAt = (i: number) => upper[Math.min(upper.length / 2 - 1, i * (curve === 'step' ? 3 : sub)) * 2 + 1];
      if (ctx.hover >= 0 && ctx.hover < n) g.disc(xs[ctx.hover], yAt(ctx.hover), lw * 0.6 + 0.9, mix(f.colors[s], ctx.theme.snow, 0.45));
      if (ctx.opts.window) { // the live cursor: newest point pulses, like the logo's cursor tiles
        const pulse = ctx.live ? 0.5 + 0.5 * Math.sin(ctx.now / 160) : 0;
        g.disc(xs[n - 1], yAt(n - 1), lw * 0.6 + 0.6 + pulse * 0.5, mix(f.colors[s], ctx.theme.snow, 0.25 + 0.4 * pulse));
      }
    }
    if (ctx.live) ctx.animating = true;
  },
  rowsAt: (ctx, f, i) => seriesRows(ctx, f, i, f.percent ? s => ` (${Math.round(f.vals[s][i])}%)` : undefined),
  legend: seriesLegend,
});
registerType('line', lineLike(false));
registerType('area', lineLike(true));

// ── bar / histogram ─────────────────────────────────────────────────────────────────────

function barRaster(ctx: Ctx, m: Model, f: any, g: Raster) {
  const ns = m.s.length, n = m.s[0] ? m.s[0].length : 0, o = ctx.opts;
  if (!n) return;
  const inner = Math.abs(ctx.band) * (f.inner ?? 0.72), stack = !!f.stack, each = stack ? inner : inner / Math.max(1, ns);
  const showLabels = o.labels ?? (ctx.horizontal && ns === 1);
  for (let i = 0; i < n; i++) {
    const centre = ctx.xAt(m, i);
    let pos = 0, neg = 0;
    for (let s = 0; s < ns; s++) {
      const v = Number.isFinite(m.s[s][i]) ? m.s[s][i] : 0, side = f.sides ? f.sides[s] : 'left';
      let v0 = 0, v1 = v;
      if (stack) { if (v >= 0) { v0 = pos; pos += v; v1 = pos; } else { v0 = neg; neg += v; v1 = neg; } }
      let a0 = centre - inner / 2 + (stack ? 0 : s * each), a1 = a0 + each;
      if (each >= 2.5) { a0 = Math.round(a0); a1 = Math.round(a1); if (!stack && ns > 1 && a1 - a0 >= 3) a1 -= 1; }
      const p0 = ctx.Y(v0, side), p1 = ctx.Y(v1, side), ramp = (ctx.hover === i ? f.hot : f.ramps)[s];
      g.pattern = f.patterns ? f.patterns[s] : 'solid';
      orientedRect(ctx, g, a0, a1, p0, p1, tipShade(ctx, ramp, p0, p1));
      if (showLabels && (!stack || s === ns - 1) && Math.abs(p1 - p0) > 0.01) {
        const raw = stack ? f.totals[i] : f.values[s][i];
        const { cell, ox, oy, rows } = ctx.grid, end = stack ? ctx.Y(v >= 0 ? pos : neg, side) : p1;
        ctx.out.texts.push(ctx.horizontal
          ? { x: ox + end * cell + 6, y: oy + ((a0 + a1) / 2) * cell, text: ctx.format(raw), align: 'left', color: 'textHi', size: 10 }
          : { x: ox + ((a0 + a1) / 2) * cell, y: oy + (rows - end) * cell - 8, text: ctx.format(raw), align: 'center', color: 'textHi', size: 10 });
      }
    }
  }
  g.pattern = 'solid';
}

registerType('bar', {
  kind: 'cartesian',
  band: true,
  keyed: ['px', 's'],
  model(ctx) {
    const f = seriesFixed(ctx), o = ctx.opts, stack = !!o.stack, percent = o.stack === 'percent';
    const masked = f.values.map((v, s) => v.map(x => (ctx.hidden.has(f.names[s]) || !Number.isFinite(x) ? 0 : x)));
    const vals = percent ? percentOf(masked, f.names, ctx.hidden) : masked;
    const totals = f.labels.map((_, i) => sum(masked.map(v => v[i])));
    return { model: { px: f.xs.map((_, i) => i), s: vals }, fixed: { ...f, vals, stack, percent, totals, ...barRamps(ctx, f.colors) } };
  },
  keys: f => f.keys,
  xinfo: f => ({ ...xinfoOf(f), kind: 'category' }),
  extents: (ctx, f) => stackedExtents(ctx, f, f.vals, f.stack, true, false, f.percent),
  raster: barRaster,
  rowsAt: (ctx, f, i) => seriesRows(ctx, f, i, f.percent ? s => ` (${Math.round(f.vals[s][i])}%)` : undefined),
  legend: seriesLegend,
});

registerType('histogram', {
  kind: 'cartesian',
  band: true,
  model(ctx) {
    const o = ctx.opts, rows = ctx.rows;
    const vk = (Array.isArray(o.y) ? o.y[0] : o.y) ?? (typeof o.value === 'string' ? o.value : null) ?? (rows[0] ? Object.keys(rows[0]).find(k => typeof rows[0][k] === 'number') : 'value');
    const gv = getter(vk);
    const vals = rows.map((r, i) => num(gv(r, i))).filter(Number.isFinite);
    const name = typeof vk === 'string' && vk !== 'value' ? vk : 'count';
    const color = ctx.colorOf(name, 0);
    if (!vals.length) return { model: { px: [], s: [[]] }, fixed: { labels: [], xs: [], keys: [], names: [name], values: [[]], vals: [[]], colors: [color], xKind: 'category', inner: 0.94, edges: [], ...barRamps(ctx, [color]) } };
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const target = o.bins || Math.max(5, Math.min(50, Math.ceil(Math.log2(vals.length) + 1)));
    const t = niceTicks(lo, hi === lo ? lo + 1 : hi, target);
    const edges = t.ticks.length > 1 ? t.ticks : [t.min, t.max];
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of vals) counts[Math.min(counts.length - 1, Math.max(0, Math.floor((v - edges[0]) / t.step)))]++;
    const labels = counts.map((_, i) => `${ctx.format(edges[i])}–${ctx.format(edges[i + 1])}`);
    const shown = ctx.hidden.has(name) ? counts.map(() => 0) : counts;
    return {
      model: { px: counts.map((_, i) => i), s: [shown] },
      fixed: { labels, xs: counts.map((_, i) => i), keys: keysOf(labels), names: [name], values: [counts], vals: [shown], colors: [color], sides: ['left'], patterns: ['solid'], xKind: 'category', inner: 0.94, edges, ...barRamps(ctx, [color]) },
    };
  },
  xinfo: f => ({ kind: 'category', labels: f.labels, xs: f.xs, keys: f.keys }),
  extents: (_ctx, f) => [{ lo: 0, hi: maxOf(f.vals[0], 1), side: 'left', zero: true }],
  raster: barRaster,
  rowsAt: (ctx, f, i) => [{ color: f.colors[0], name: f.names[0], value: String(f.values[0][i]) }],
  legend: () => [],
});

// ── scatter / bubble ────────────────────────────────────────────────────────────────────

const scatter: ChartTypeDef = {
  kind: 'cartesian',
  xGrid: true,
  freePick: true,
  model(ctx) {
    const o = ctx.opts, rows = ctx.rows, first = rows[0] || {};
    const numeric = Object.keys(first).filter(k => typeof first[k] === 'number' && k !== o.size);
    const xk = o.x ?? numeric[0] ?? 'x', yk = (Array.isArray(o.y) ? o.y[0] : o.y) ?? numeric.find(k => k !== xk) ?? 'y', sk = o.size;
    const gx = getter(xk), gy = getter(yk), gs = sk ? getter(sk) : null;
    const names: string[] = o.by ? [...new Set(rows.map(r => String(r[o.by])))] : [typeof yk === 'string' ? yk : 'y'];
    const groups = names.map(n => rows.filter(r => !o.by || String(r[o.by]) === n));
    const rMax = gs ? maxOf(rows.map((r, i) => num(gs(r, i)) || 0), 1e-9) : 1;
    const colors = names.map((n, i) => ctx.colorOf(n, i));
    const all = groups.flat();
    return {
      model: {
        X: groups.map(g => g.map((r, i) => num(gx(r, i)))),
        Yv: groups.map(g => g.map((r, i) => num(gy(r, i)))),
        R: groups.map((g, s) => g.map((r, i) => (ctx.hidden.has(names[s]) ? 0 : gs ? Math.sqrt(Math.max(0, num(gs(r, i)) || 0) / rMax) : 1))),
      },
      fixed: {
        names, groups, colors, xk, yk, sk, bubble: !!gs || ctx.opts.type === 'bubble',
        labels: all.map((r, i) => num(gx(r, i))), xs: all.map((r, i) => num(gx(r, i))),
      },
    };
  },
  seed(shown, model) { shown.X = model.X.map((a: number[]) => a.slice()); shown.Yv = model.Yv.map((a: number[]) => a.slice()); },
  xinfo: f => ({ kind: 'number', labels: f.labels, xs: f.xs, keys: [] }),
  extents(ctx, f) {
    let lo = Infinity, hi = -Infinity;
    f.groups.forEach((g: any[], s: number) => { if (!ctx.hidden.has(f.names[s])) g.forEach((r, i) => { const v = num(getter(f.yk)(r, i)); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    return [{ lo, hi, side: 'left', pad: true }];
  },
  raster(ctx, m, f, g) {
    const base = Math.max(0.7, 3.2 / ctx.grid.cell), big = Math.max(1.2, 15 / ctx.grid.cell);
    for (let s = m.X.length - 1; s >= 0; s--) for (let i = 0; i < m.X[s].length; i++) {
      const r = m.R[s][i] * (f.bubble ? big : base);
      if (!(r > 0.05)) continue;
      const hot = ctx.hover === s * 1e5 + i, col = f.colors[s];
      g.disc(ctx.X(m.X[s][i]), ctx.Y(m.Yv[s][i]), r, hot ? mix(col, ctx.theme.snow, 0.5) : f.bubble ? mix(ctx.theme.fade, col, 0.82) : col, 0.95);
    }
  },
  pick(ctx, m, f, x, y) {
    const base = Math.max(0.7, 3.2 / ctx.grid.cell), big = Math.max(1.2, 15 / ctx.grid.cell);
    let best = -1, bd = Infinity;
    for (let s = 0; s < m.X.length; s++) for (let i = 0; i < m.X[s].length; i++) {
      const r = m.R[s][i] * (f.bubble ? big : base);
      if (!(r > 0.05)) continue;
      const d = Math.hypot(ctx.X(m.X[s][i]) - x, ctx.Y(m.Yv[s][i]) - y) - r;
      if (d < bd && d < 2.5 + 8 / ctx.grid.cell) { bd = d; best = s * 1e5 + i; }
    }
    return best;
  },
  tip(ctx, _m, f, id) {
    const s = Math.floor(id / 1e5), i = id % 1e5, row = f.groups[s] && f.groups[s][i];
    if (!row) return null;
    const c = f.colors[s], gx = getter(f.xk), gy = getter(f.yk);
    const rows = [{ color: c, name: String(f.xk), value: ctx.format(num(gx(row, i))) }, { color: c, name: String(f.yk), value: ctx.format(num(gy(row, i))) }];
    if (f.sk) rows.push({ color: c, name: String(f.sk), value: ctx.format(num(getter(f.sk)(row, i))) });
    return { index: id, title: f.names[s], rows, point: { type: ctx.opts.type, index: i, series: f.names[s], row, value: num(gy(row, i)) } };
  },
  ids: (ctx, f) => f.groups.flatMap((g: any[], s: number) => (ctx.hidden.has(f.names[s]) ? [] : g.map((_, i) => s * 1e5 + i))),
  anchor: (ctx, m, _f, id) => { const s = Math.floor(id / 1e5), i = id % 1e5; return [ctx.X(m.X[s][i]), ctx.Y(m.Yv[s][i])]; },
  legend: (ctx, f) => (f.names.length > 1 ? seriesLegend(ctx, f) : []),
};
registerType('scatter', scatter);
registerType('bubble', scatter);

// ── range ───────────────────────────────────────────────────────────────────────────────

registerType('range', {
  kind: 'cartesian',
  keyed: ['px', 'lo', 'hi', 's'],
  model(ctx) {
    const o = ctx.opts, rows = ctx.rows, fk = o.from || 'from', tk = o.to || 'to';
    const f = seriesFixed({ ...ctx, opts: { ...o, y: o.y ?? [] } } as Ctx);
    const lo = rows.map(r => num(r[fk])), hi = rows.map(r => num(r[tk]));
    const band = o.label || `${fk}–${tk}`;
    const colors = [ctx.colorOf(band, 0), ...f.names.map((n, i) => ctx.colorOf(n, i + 1))];
    const hide = ctx.hidden.has(band);
    return {
      model: { px: f.xs.slice(), lo: hide ? lo.map(() => 0) : lo, hi: hide ? hi.map(() => 0) : hi, s: f.values, a: f.names.map(n => (ctx.hidden.has(n) ? 0 : 1)), ba: hide ? 0 : 1 },
      fixed: { ...f, band, bandColor: colors[0], colors: colors.slice(1), names: f.names, colorNames: [band, ...f.names], loV: lo, hiV: hi, ramp: shades(ctx.theme.fade, colors[0], 0.22, 0.45) },
    };
  },
  keys: f => f.keys,
  xinfo: f => xinfoOf(f),
  extents(ctx, f) {
    let lo = Infinity, hi = -Infinity;
    visibleRange(ctx, f.labels.length, i => {
      if (!ctx.hidden.has(f.band)) { if (Number.isFinite(f.loV[i])) lo = Math.min(lo, f.loV[i]); if (Number.isFinite(f.hiV[i])) hi = Math.max(hi, f.hiV[i]); }
      f.values.forEach((v: number[], s: number) => { if (!ctx.hidden.has(f.names[s]) && Number.isFinite(v[i])) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); } });
    });
    return [{ lo, hi, side: 'left', pad: true }];
  },
  raster(ctx, m, f, g) {
    const n = m.lo.length;
    if (!n) return;
    const { cols, cell } = ctx.grid, lw = Math.max(1, 3.2 / cell);
    const xs = Array.from({ length: n }, (_, i) => ctx.xAt(m, i));
    const sub = Math.min(8, Math.max(1, Math.round((n > 1 ? Math.abs(xs[n - 1] - xs[0]) / (n - 1) : cols) / 1.5)));
    if (m.ba > 0.01) {
      const lo = smooth(xs, m.lo.map((v: number) => ctx.Y(v)), sub), hi = smooth(xs, m.hi.map((v: number) => ctx.Y(v)), sub);
      const top = columnsY(hi, cols), bot = columnsY(lo, cols);
      for (let c = 0; c < cols; c++) g.span(c, Math.min(top[c], bot[c]), Math.max(top[c], bot[c]), f.ramp, 1, 0.9 * m.ba);
      const edge = mix(ctx.theme.fade, f.bandColor, 0.75);
      g.line(lo, Math.max(0.8, lw * 0.6), edge, m.ba);
      g.line(hi, Math.max(0.8, lw * 0.6), edge, m.ba);
    }
    for (let s = m.s.length - 1; s >= 0; s--) if (m.a[s] > 0.01) g.line(smooth(xs, m.s[s].map((v: number) => ctx.Y(v)), sub), lw, f.colors[s], m.a[s]);
    if (ctx.hover >= 0 && ctx.hover < n) for (let s = 0; s < m.s.length; s++) if (m.a[s] > 0.01) g.disc(xs[ctx.hover], ctx.Y(m.s[s][ctx.hover]), lw * 0.6 + 0.9, mix(f.colors[s], ctx.theme.snow, 0.45));
  },
  rowsAt(ctx, f, i) {
    const rows = ctx.hidden.has(f.band) ? [] : [{ color: f.bandColor, name: f.band, value: `${ctx.format(f.loV[i])} – ${ctx.format(f.hiV[i])}` }];
    return [...rows, ...seriesRows(ctx, f, i)];
  },
  legend: (_ctx, f) => [{ name: f.band, color: f.bandColor }, ...f.names.map((name: string, i: number) => ({ name, color: f.colors[i] }))],
});

// ── candlestick / ohlc ──────────────────────────────────────────────────────────────────

const candles = (style: 'candle' | 'ohlc'): ChartTypeDef => ({
  kind: 'cartesian',
  band: true,
  keyed: ['px', 'o', 'h', 'l', 'c'],
  model(ctx) {
    const o = ctx.opts, rows = ctx.rows, k = { o: o.open || 'open', h: o.high || 'high', l: o.low || 'low', c: o.close || 'close' };
    const xk = xKeyOf(rows, o.x), gx = getter(xk);
    const labels = rows.map((r, i) => (xk == null ? i : gx(r, i)));
    const col = (key: string) => rows.map(r => num(r[key]));
    return {
      model: { px: labels.map((_, i) => i), o: col(k.o), h: col(k.h), l: col(k.l), c: col(k.c) },
      fixed: { labels, xs: labels.map((_, i) => i), keys: keysOf(labels), rows, k, up: shades(ctx.theme.fade, ctx.theme.up, 0.55, 1), down: shades(ctx.theme.fade, ctx.theme.down, 0.55, 1) },
    };
  },
  keys: f => f.keys,
  xinfo: f => ({ kind: 'category', labels: f.labels, xs: f.xs, keys: f.keys }),
  extents(ctx, f) {
    let lo = Infinity, hi = -Infinity;
    visibleRange(ctx, f.rows.length, i => { const r = f.rows[i]; lo = Math.min(lo, num(r[f.k.l])); hi = Math.max(hi, num(r[f.k.h])); });
    return [{ lo, hi, side: 'left', pad: true }];
  },
  raster(ctx, m, f, g) {
    const n = m.o.length;
    if (!n) return;
    const bw = Math.abs(ctx.band), { rows, cols, cell, ox, oy } = ctx.grid;
    const last = m.c[n - 1], rising = last >= m.o[n - 1];
    const lastRow = Math.min(rows - 1, Math.max(0, Math.floor(ctx.Y(last))));
    g.hline(lastRow, rising ? ctx.theme.up : ctx.theme.down, 0.3);
    const ww = clamp(bw * 0.14, 0.4, 1);
    for (let i = 0; i < n; i++) {
      const x = ctx.xAt(m, i), up = m.c[i] >= m.o[i], ramp = up ? f.up : f.down, hot = ctx.hover === i;
      if (x < -bw || x > cols + bw) continue;
      if (style === 'ohlc') {
        const col = pick(ramp, hot ? 1 : 0.75);
        g.rect(x - ww / 2, ctx.Y(m.l[i]), x + ww / 2, ctx.Y(m.h[i]), col);
        const yo = ctx.Y(m.o[i]), yc = ctx.Y(m.c[i]), t = Math.max(0.6, ww);
        g.rect(x - bw * 0.36, yo - t / 2, x, yo + t / 2, col);
        g.rect(x, yc - t / 2, x + bw * 0.36, yc + t / 2, col);
        continue;
      }
      g.rect(x - ww / 2, ctx.Y(m.l[i]), x + ww / 2, ctx.Y(m.h[i]), pick(ramp, hot ? 1 : 0.45));
      let y0 = ctx.Y(Math.min(m.o[i], m.c[i])), y1 = ctx.Y(Math.max(m.o[i], m.c[i]));
      if (y1 - y0 < 0.7) { const mid = (y0 + y1) / 2; y0 = mid - 0.35; y1 = mid + 0.35; }
      g.rect(x - bw * 0.34, y0, x + bw * 0.34, y1, (_c, r) => pick(ramp, hot ? 1 : 0.6 + 0.4 * ((r + 0.5 - y0) / (y1 - y0 || 1))));
    }
    if (ctx.opts.axes !== false) ctx.out.texts.push({ x: ox + cols * cell - 3, y: oy + (rows - lastRow - 0.5) * cell, text: ctx.format(+last.toPrecision(10)), align: 'right', color: ctx.theme.bg, bg: rising ? ctx.theme.up : ctx.theme.down, weight: 700, size: 10 });
  },
  rowsAt(ctx, f, i) {
    const r = f.rows[i];
    if (!r) return [];
    const col = num(r[f.k.c]) >= num(r[f.k.o]) ? ctx.theme.up : ctx.theme.down;
    return (['o', 'h', 'l', 'c'] as const).map(k => ({ color: col, name: { o: 'open', h: 'high', l: 'low', c: 'close' }[k], value: ctx.format(num(r[f.k[k]])) }));
  },
  legend: () => [],
});
registerType('candlestick', candles('candle'));
registerType('ohlc', candles('ohlc'));

// ── boxplot ─────────────────────────────────────────────────────────────────────────────

/** Quartiles by linear interpolation (type 7, as in R and NumPy's default). */
export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const p = (sorted.length - 1) * q, i = Math.floor(p), f = p - i;
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * f : sorted[i];
}

registerType('boxplot', {
  kind: 'cartesian',
  band: true,
  keyed: ['px', 'q1', 'q2', 'q3', 'w0', 'w1'],
  model(ctx) {
    const o = ctx.opts, rows = ctx.rows, first = rows[0] || {};
    const xk = xKeyOf(rows, o.x);
    let labels: any[], groups: number[][];
    if (xk != null) {
      const vk = (Array.isArray(o.y) ? o.y[0] : o.y) ?? (typeof o.value === 'string' ? o.value : null) ?? Object.keys(first).find(k => typeof first[k] === 'number');
      const gx = getter(xk), gv = getter(vk);
      labels = []; groups = [];
      rows.forEach((r, i) => { const l = gx(r, i); let j = labels.indexOf(l); if (j < 0) { j = labels.length; labels.push(l); groups.push([]); } const v = num(gv(r, i)); if (Number.isFinite(v)) groups[j].push(v); });
    } else {
      const keys: string[] = o.y != null ? [].concat(o.y) : Object.keys(first).filter(k => typeof first[k] === 'number');
      labels = keys;
      groups = keys.map(k => rows.map(r => num(r[k])).filter(Number.isFinite));
    }
    const stats = groups.map(g => {
      const s = g.slice().sort((a, b) => a - b), q1 = quantile(s, 0.25), q2 = quantile(s, 0.5), q3 = quantile(s, 0.75), iqr = q3 - q1;
      const w0 = s.find(v => v >= q1 - 1.5 * iqr) ?? q1, w1 = [...s].reverse().find(v => v <= q3 + 1.5 * iqr) ?? q3;
      return { q1, q2, q3, w0, w1, out: s.filter(v => v < w0 || v > w1), n: s.length };
    });
    const name = o.label || 'distribution', color = ctx.colorOf(name, 0);
    return {
      model: { px: labels.map((_, i) => i), q1: stats.map(s => s.q1), q2: stats.map(s => s.q2), q3: stats.map(s => s.q3), w0: stats.map(s => s.w0), w1: stats.map(s => s.w1) },
      fixed: { labels, xs: labels.map((_, i) => i), keys: keysOf(labels), stats, color, ramp: shades(ctx.theme.fade, color, 0.35, 0.8) },
    };
  },
  keys: f => f.keys,
  xinfo: f => ({ kind: 'category', labels: f.labels, xs: f.xs, keys: f.keys }),
  extents(ctx, f) {
    let lo = Infinity, hi = -Infinity;
    visibleRange(ctx, f.stats.length, i => { const s = f.stats[i]; if (!s.n) return; lo = Math.min(lo, s.w0, minOf(s.out)); hi = Math.max(hi, s.w1, maxOf(s.out)); });
    return [{ lo, hi, side: 'left', pad: true }];
  },
  raster(ctx, m, f, g) {
    const bw = Math.abs(ctx.band), lw = Math.max(0.8, Math.min(1, bw * 0.1));
    for (let i = 0; i < m.q1.length; i++) {
      if (!f.stats[i] || !f.stats[i].n) continue;
      const c = ctx.xAt(m, i), half = bw * 0.3, hot = ctx.hover === i, col = hot ? mix(f.color, ctx.theme.snow, 0.35) : f.color;
      const Y = (v: number) => ctx.Y(v);
      orientedRect(ctx, g, c - lw / 2, c + lw / 2, Y(m.w0[i]), Y(m.q1[i]), mix(ctx.theme.fade, col, 0.7));
      orientedRect(ctx, g, c - lw / 2, c + lw / 2, Y(m.q3[i]), Y(m.w1[i]), mix(ctx.theme.fade, col, 0.7));
      orientedRect(ctx, g, c - half * 0.6, c + half * 0.6, Y(m.w0[i]) - lw / 2, Y(m.w0[i]) + lw / 2, mix(ctx.theme.fade, col, 0.7));
      orientedRect(ctx, g, c - half * 0.6, c + half * 0.6, Y(m.w1[i]) - lw / 2, Y(m.w1[i]) + lw / 2, mix(ctx.theme.fade, col, 0.7));
      orientedRect(ctx, g, c - half, c + half, Y(m.q1[i]), Y(m.q3[i]), hot ? col : pick(f.ramp, 0.75));
      orientedRect(ctx, g, c - half, c + half, Y(m.q2[i]) - lw / 2, Y(m.q2[i]) + lw / 2, ctx.theme.snow);
      for (const v of f.stats[i].out) {
        const p = Y(v);
        if (ctx.horizontal) g.disc(p, ctx.grid.rows - c, Math.max(0.6, lw * 0.7), col, 0.9);
        else g.disc(c, p, Math.max(0.6, lw * 0.7), col, 0.9);
      }
    }
  },
  rowsAt(ctx, f, i) {
    const s = f.stats[i];
    if (!s) return [];
    const row = (name: string, v: number) => ({ color: f.color, name, value: ctx.format(v) });
    return [row('max', s.w1), row('q3', s.q3), row('median', s.q2), row('q1', s.q1), row('min', s.w0), ...(s.out.length ? [{ color: f.color, name: 'outliers', value: String(s.out.length) }] : [])];
  },
  legend: () => [],
});

// ── waterfall ───────────────────────────────────────────────────────────────────────────

registerType('waterfall', {
  kind: 'cartesian',
  band: true,
  keyed: ['px', 'v0', 'v1'],
  model(ctx) {
    const o = ctx.opts, rows = ctx.rows, first = rows[0] || {};
    const xk = xKeyOf(rows, o.x), gx = getter(xk);
    const vk = (Array.isArray(o.y) ? o.y[0] : o.y) ?? Object.keys(first).find(k => typeof first[k] === 'number' && k !== 'total');
    const gv = getter(vk);
    const labels = rows.map((r, i) => (xk == null ? i : gx(r, i)));
    let run = 0;
    const v0: number[] = [], v1: number[] = [], kind: ('up' | 'down' | 'total')[] = [], deltas: number[] = [];
    rows.forEach((r, i) => {
      const d = num(gv(r, i));
      if (r.total === true || !Number.isFinite(d)) { v0.push(0); v1.push(run); kind.push('total'); deltas.push(run); }
      else { v0.push(run); run += d; v1.push(run); kind.push(d >= 0 ? 'up' : 'down'); deltas.push(d); }
    });
    const th = ctx.theme, total = ctx.colorOf('total', 0);
    return {
      model: { px: labels.map((_, i) => i), v0, v1 },
      fixed: { labels, xs: labels.map((_, i) => i), keys: keysOf(labels), kind, deltas, v0, v1,
        ramps: { up: shades(th.fade, th.up, 0.5, 1), down: shades(th.fade, th.down, 0.5, 1), total: shades(th.fade, total, 0.5, 1) }, colors: { up: th.up, down: th.down, total } },
    };
  },
  keys: f => f.keys,
  xinfo: f => ({ kind: 'category', labels: f.labels, xs: f.xs, keys: f.keys }),
  extents(ctx, f) {
    let lo = 0, hi = 0;
    visibleRange(ctx, f.labels.length, i => { lo = Math.min(lo, f.v0[i], f.v1[i]); hi = Math.max(hi, f.v0[i], f.v1[i]); });
    return [{ lo, hi, side: 'left', zero: true }];
  },
  raster(ctx, m, f, g) {
    const bw = Math.abs(ctx.band), inner = bw * 0.7;
    for (let i = 0; i < m.v0.length; i++) {
      const c = ctx.xAt(m, i);
      let a0 = c - inner / 2, a1 = c + inner / 2;
      if (inner >= 2.5) { a0 = Math.round(a0); a1 = Math.round(a1); }
      const p0 = ctx.Y(m.v0[i]), p1 = ctx.Y(m.v1[i]), ramp = f.ramps[f.kind[i]];
      orientedRect(ctx, g, a0, a1, p0, p1, tipShade(ctx, ctx.hover === i ? ramp.map((x: RGB) => mix(x, ctx.theme.snow, 0.3)) : ramp, p0, p1));
      if (i + 1 < m.v0.length) { // dotted connector to the next bar
        const y = Math.floor(p1), next = ctx.xAt(m, i + 1) - inner / 2;
        for (let x = Math.ceil(a1); x < next; x += ctx.grid.cell <= 4 ? 2 : 1) {
          if (ctx.horizontal) g.plot(y, ctx.grid.rows - 1 - x, 0.3, ctx.theme.grid); else g.plot(x, y, 0.3, ctx.theme.grid);
        }
      }
    }
  },
  rowsAt(ctx, f, i) {
    const k = f.kind[i];
    return [{ color: f.colors[k], name: k === 'total' ? 'total' : 'change', value: (k === 'up' ? '+' : '') + ctx.format(f.deltas[i]) }, ...(k === 'total' ? [] : [{ color: f.colors.total, name: 'running', value: ctx.format(f.v1[i]) }])];
  },
  legend: () => [],
});

