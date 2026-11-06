// Grid chart types: heatmap, calendar, waffle, treemap, funnel, stat.
import { registerType, CHAR_W } from '../core/chart-core';
import type { ChartTypeDef, Ctx } from '../core/types';
import type { RGB } from '../core/model-types';
import type { Raster } from '../core/field';
import { clamp, maxOf, minOf, mix, pick, ramp, shades, sum } from '../core/util';
import { labelText, monthName, roundLike } from '../core/format';
import { getter, num, toTime } from '../core/data';
import { catFixed, categoryLegend, polarMargin, px, shareHit, shownValues, visibleIds, type CatFixed } from './common';

// ── heatmap / calendar ──────────────────────────────────────────────────────────────────

interface HeatFixed {
  nx: number; ny: number; raw: number[]; has: boolean[]; titles: string[];
  xLabels: string[]; yLabels: string[]; sparse?: boolean; diverging: boolean; rows: any[];
}

/** Value → colour: the terrain ramp, or the diverging ramp when the data crosses zero. */
function heatColor(ctx: Ctx, f: HeatFixed, v: number): RGB {
  const th = ctx.theme;
  if (f.diverging) return ramp(th.diverging, 0.5 + 0.5 * clamp(v, -1, 1));
  return v <= 0.004 ? th.grid : ramp(th.terrain, 0.36 + 0.64 * clamp(v));
}

/** Normalise raw values to [0, 1] (or [-1, 1] when diverging). */
function normalise(raw: number[]) {
  const fin = raw.filter(Number.isFinite);
  const lo = minOf(fin, 0), hi = maxOf(fin, 0), diverging = lo < 0 && hi > 0;
  const scale = diverging ? Math.max(-lo, hi) : hi > 0 ? hi : -lo || 1;
  return { diverging, v: raw.map(x => (Number.isFinite(x) ? x / (scale || 1) : 0)) };
}

function heatFit(ctx: Ctx, f: HeatFixed) {
  const { cols, rows } = ctx.grid, block = Math.max(1, Math.floor(Math.min(cols / Math.max(1, f.nx), rows / Math.max(1, f.ny))));
  return { block, gap: block >= 3 ? 1 : 0, top: Math.floor((rows - f.ny * block) / 2), left: Math.floor((cols - f.nx * block) / 2) };
}

const heatBase: Omit<ChartTypeDef, 'model'> = {
  kind: 'grid',
  margin(ctx) {
    if (ctx.opts.axes === false) return { l: 1, r: 1, t: 1, b: 1 };
    const rows = ctx.rows, o = ctx.opts;
    const ys = ctx.opts.type === 'calendar' ? ['Mon'] : [...new Set(rows.map(r => labelText(r[o.y || 'y'])))];
    return { l: Math.min(90, maxOf(ys.map(s => s.length), 3) * CHAR_W + 12), r: 6, t: 6, b: 20 };
  },
  raster(ctx, m, f: HeatFixed, g) {
    const { block, gap, top, left } = heatFit(ctx, f), { rows, cell, ox, oy } = ctx.grid;
    for (let yi = 0; yi < f.ny; yi++) for (let xi = 0; xi < f.nx; xi++) {
      const i = yi * f.nx + xi;
      if (!f.has[i]) continue;
      const v = m.v[i], y1 = rows - top - yi * block, x0 = left + xi * block, hot = ctx.hover === i;
      const lit = f.diverging ? Math.abs(v) > 0.004 : v > 0.004;
      g.rect(x0, y1 - block + gap, x0 + block - gap, y1, hot ? ctx.theme.snow : heatColor(ctx, f, v), lit || hot ? 1 : 0.45);
    }
    if (ctx.opts.axes === false) return;
    f.yLabels.forEach((t, yi) => t && ctx.out.labelsY.push({ y: oy + (top + (yi + 0.5) * block - gap / 2) * cell, text: t, side: 'left' }));
    const below = oy + (top + f.ny * block) * cell + 10;
    const stride = Math.max(1, Math.ceil((maxOf(f.xLabels.map(t => t.length), 1) * CHAR_W + 12) / (block * cell)));
    f.xLabels.forEach((t, xi) => {
      if (!t || (!f.sparse && xi % stride)) return;
      const x = ox + (left + (f.sparse ? xi : xi + 0.5) * block) * cell;
      ctx.out.texts.push({ x, y: below, text: t, align: f.sparse ? 'left' : 'center', baseline: 'middle', color: 'text', size: 10 });
    });
  },
  pick(ctx, _m, f: HeatFixed, x, y) {
    const { block, top, left } = heatFit(ctx, f), xi = Math.floor((x - left) / block), yi = Math.floor((ctx.grid.rows - top - y) / block);
    if (xi < 0 || yi < 0 || xi >= f.nx || yi >= f.ny) return -1;
    const i = yi * f.nx + xi;
    return f.has[i] ? i : -1;
  },
  tip(ctx, m, f: HeatFixed, id) {
    if (!f.has[id]) return null;
    return { index: id, title: f.titles[id], rows: [{ color: heatColor(ctx, f, m.v[id]), name: ctx.opts.label || 'value', value: ctx.format(f.raw[id]) }], point: { type: ctx.opts.type, index: id, label: f.titles[id], value: f.raw[id], row: f.rows[id] } };
  },
  ids: (_ctx, f: HeatFixed) => f.has.map((h, i) => (h ? i : -1)).filter(i => i >= 0),
  anchor(ctx, _m, f: HeatFixed, id) {
    const { block, top, left } = heatFit(ctx, f), xi = id % f.nx, yi = Math.floor(id / f.nx);
    return [left + (xi + 0.5) * block, ctx.grid.rows - top - (yi + 0.5) * block];
  },
  count: (f: HeatFixed) => f.has.filter(Boolean).length,
};

registerType('heatmap', {
  ...heatBase,
  model(ctx) {
    const o = ctx.opts, d = ctx.rows, xk = o.x || 'x', yk = (Array.isArray(o.y) ? o.y[0] : o.y) || 'y', vk = (typeof o.value === 'string' && o.value) || 'value';
    const gx = getter(xk), gy = getter(yk), gv = getter(vk);
    const xs: string[] = [], ys: string[] = [];
    d.forEach((r, i) => { const a = labelText(gx(r, i)), b = labelText(gy(r, i)); if (!xs.includes(a)) xs.push(a); if (!ys.includes(b)) ys.push(b); });
    const n = xs.length * ys.length, raw = new Array(n).fill(NaN), has = new Array(n).fill(false), rows = new Array(n).fill(null);
    d.forEach((r, i) => { const k = ys.indexOf(labelText(gy(r, i))) * xs.length + xs.indexOf(labelText(gx(r, i))); raw[k] = num(gv(r, i)); has[k] = true; rows[k] = r; });
    const titles: string[] = [];
    ys.forEach(y => xs.forEach(x => titles.push(`${x} · ${y}`)));
    const { v, diverging } = normalise(raw);
    return { model: { v }, fixed: { nx: xs.length, ny: ys.length, raw, has, titles, xLabels: xs, yLabels: ys, diverging, rows } };
  },
});

const DAY = 864e5;
registerType('calendar', {
  ...heatBase,
  model(ctx) {
    const o = ctx.opts, dk = o.x || 'date', vk = (typeof o.value === 'string' && o.value) || (Array.isArray(o.y) ? o.y[0] : o.y) || 'value';
    const gd = getter(dk), gv = getter(vk);
    const days = ctx.rows.map((r, i) => ({ t: Math.floor(toTime(gd(r, i)) / DAY) * DAY, v: num(gv(r, i)), r })).filter(d => Number.isFinite(d.t)).sort((a, b) => a.t - b.t);
    if (!days.length) return { model: { v: [] }, fixed: { nx: 0, ny: 7, raw: [], has: [], titles: [], xLabels: [], yLabels: [], diverging: false, rows: [] } };
    const dow = (t: number) => (new Date(t).getUTCDay() + 6) % 7; // Monday first
    const start = days[0].t - dow(days[0].t) * DAY;
    const nx = Math.floor((days[days.length - 1].t - start) / DAY / 7) + 1, n = nx * 7;
    const raw = new Array(n).fill(NaN), has = new Array(n).fill(false), titles = new Array(n).fill(''), rows = new Array(n).fill(null);
    for (const { t, v, r } of days) {
      const i = dow(t) * nx + Math.floor(Math.round((t - start) / DAY) / 7);
      raw[i] = Number.isFinite(raw[i]) ? raw[i] + v : v; has[i] = true; rows[i] = r;
      titles[i] = new Date(t).toISOString().slice(0, 10);
    }
    const xLabels = Array.from({ length: nx }, (_, w) => {
      const a = new Date(start + w * 7 * DAY + 6 * DAY), b = new Date(start + (w - 1) * 7 * DAY + 6 * DAY); // each week's Sunday
      return w === 0 || a.getUTCMonth() !== b.getUTCMonth() ? monthName(a.getUTCMonth()) : '';
    });
    const { v, diverging } = normalise(raw);
    return { model: { v }, fixed: { nx, ny: 7, raw, has, titles, xLabels, sparse: true, yLabels: ['Mon', '', 'Wed', '', 'Fri', '', ''], diverging, rows } };
  },
});

// ── waffle ──────────────────────────────────────────────────────────────────────────────

function waffleGeo(ctx: Ctx) {
  const U = ctx.opts.units || 100, { cols, rows } = ctx.grid;
  let best: [number, number, number] = [10, Math.ceil(U / 10), 0];
  for (const nx of [10, 20, 25, 50, 5, 4, 2, 1]) {
    const ny = U / nx, k = Math.floor(Math.min(cols / nx, rows / ny));
    if (Number.isInteger(ny) && k > best[2]) best = [nx, ny, k];
  }
  const [nx, ny, k0] = best, k = Math.max(1, k0);
  return { U, nx, ny, k, block: k >= 3 ? k - 1 : k, x0: Math.floor((cols - nx * k) / 2), y0: Math.floor((rows - ny * k) / 2) };
}

/** Largest-remainder split of the units between categories, in data order. */
export function waffleOwners(v: number[], U: number): number[] {
  const total = sum(v) || 1, exact = v.map(x => (Math.max(0, x) / total) * U), counts = exact.map(Math.floor);
  let left = sum(v) > 0 ? U - sum(counts) : 0;
  exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0 && v[i] > 0) { counts[i]++; left--; } });
  const out: number[] = [];
  counts.forEach((n, i) => { for (let k = 0; k < n; k++) out.push(i); });
  return out;
}

registerType('waffle', {
  kind: 'grid',
  margin: polarMargin,
  keyed: ['v'],
  model(ctx) { const f = catFixed(ctx); return { model: { v: shownValues(ctx, f) }, fixed: f }; },
  keys: f => f.keys,
  raster(ctx, m, f: CatFixed, g) {
    const { U, nx, k, block, x0, y0 } = waffleGeo(ctx), owners = waffleOwners(m.v, U), th = ctx.theme;
    for (let u = owners.length; u < U; u++) { const x = x0 + (u % nx) * k, top = ctx.grid.rows - y0 - Math.floor(u / nx) * k; g.rect(x, top - block, x + block, top, th.grid, 0.3); }
    owners.forEach((j, u) => {
      const x = x0 + (u % nx) * k, top = ctx.grid.rows - y0 - Math.floor(u / nx) * k;
      g.rect(x, top - block, x + block, top, ctx.hover === j ? mix(f.colors[j], th.snow, 0.35) : f.colors[j]);
    });
  },
  pick(ctx, m, _f, x, y) {
    const { U, nx, ny, k, x0, y0 } = waffleGeo(ctx), ux = Math.floor((x - x0) / k), uy = Math.floor((ctx.grid.rows - y0 - y) / k);
    if (ux < 0 || uy < 0 || ux >= nx || uy >= ny) return -1;
    const j = waffleOwners(m.v, U)[uy * nx + ux];
    return j === undefined ? -1 : j;
  },
  tip: (ctx, _m, f, id) => shareHit(ctx, f, id),
  ids: visibleIds,
  anchor(ctx, m, _f, id) {
    const { U, nx, k, x0, y0 } = waffleGeo(ctx), u = waffleOwners(m.v, U).indexOf(id);
    return u < 0 ? [ctx.grid.cols / 2, ctx.grid.rows / 2] : [x0 + (u % nx) * k + k / 2, ctx.grid.rows - y0 - Math.floor(u / nx) * k - k / 2];
  },
  legend: categoryLegend,
  count: f => f.labels.length,
});

// ── treemap ─────────────────────────────────────────────────────────────────────────────

type Rect = [number, number, number, number, number]; // id, x, y, w, h

/** Squarified layout (Bruls et al.) of weighted ids into the rectangle (x, y, w, h). */
export function squarify(items: [number, number][], x: number, y: number, w: number, h: number): Rect[] {
  const list = items.filter(p => p[1] > 1e-9), out: Rect[] = [], total = sum(list.map(p => p[1])) || 1;
  const area = list.map(p => (p[1] / total) * w * h);
  const worst = (row: number[], s: number) => { const t = sum(row); return maxOf(row.map(a => Math.max((s * s * a) / (t * t), (t * t) / (s * s * a)))); };
  let k = 0;
  while (k < list.length) {
    const short = Math.min(w, h), row: number[] = [];
    let best = Infinity;
    while (k < list.length) { const next = worst([...row, area[k]], short); if (row.length && next > best) break; row.push(area[k++]); best = next; }
    const thick = sum(row) / (short || 1), first = k - row.length;
    let p = 0;
    row.forEach((a, j) => {
      const len = a / (thick || 1), id = list[first + j][0];
      out.push(w >= h ? [id, x, y + p, thick, len] : [id, x + p, y, len, thick]);
      p += len;
    });
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
  }
  return out;
}

function treeRects(ctx: Ctx, m: any, f: any): Rect[] {
  const { cols, rows } = ctx.grid, byWeight = (ids: number[]) => ids.map(i => [i, m.v[i]] as [number, number]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (!f.groups) return squarify(byWeight(f.labels.map((_: any, i: number) => i)), 0, 0, cols, rows);
  const groups: [number, number][] = f.groups.map((g: number[], gi: number) => [gi, sum(g.map(i => m.v[i]))]);
  const out: Rect[] = [];
  for (const [gi, gx, gy, gw, gh] of squarify(groups.sort((a, b) => b[1] - a[1] || a[0] - b[0]), 0, 0, cols, rows)) {
    const pad = gw > 6 && gh > 6 ? 0.5 : 0;
    out.push(...squarify(byWeight(f.groups[gi]), gx + pad, gy + pad, gw - pad * 2, gh - pad * 2));
  }
  return out;
}

registerType('treemap', {
  kind: 'grid',
  margin: polarMargin,
  keyed: ['v'],
  model(ctx) {
    const f = catFixed(ctx), o = ctx.opts;
    let groups: number[][] | null = null, groupNames: string[] = [];
    if (o.by) {
      const names: string[] = [];
      f.rows.forEach(r => { const g = String(r[o.by]); if (!names.includes(g)) names.push(g); });
      groupNames = names;
      groups = names.map(n => f.rows.map((r, i) => (String(r[o.by]) === n ? i : -1)).filter(i => i >= 0));
    }
    const colorKey = groups ? groupNames : f.names;
    const colors = colorKey.map((n, i) => ctx.colorOf(n, i));
    const itemColor = f.labels.map((_, i) => (groups ? colors[groups.findIndex(g => g.includes(i))] : colors[i]));
    return { model: { v: shownValues(ctx, f) }, fixed: { ...f, names: colorKey, colors, itemColor, groups, groupNames, max: maxOf(f.values, 1e-9) } };
  },
  keys: f => f.keys,
  raster(ctx, m, f, g) {
    const { cell } = ctx.grid, th = ctx.theme;
    for (const [i, x, y, w, h] of treeRects(ctx, m, f)) {
      const snap = w >= 3 && h >= 3;
      const x0 = snap ? Math.round(x) : x + 0.25, x1 = snap ? Math.round(x + w) - 1 : x + w - 0.25;
      const y0 = snap ? Math.round(y) + 1 : y + 0.25, y1 = snap ? Math.round(y + h) : y + h - 0.25;
      if (!(x1 > x0 && y1 > y0)) continue;
      const base = mix(f.itemColor[i], th.snow, ctx.hover === i ? 0.3 : 0), rampI = shades(th.fade, base, 0.45 + 0.3 * (f.values[i] / f.max), 1, 8);
      // Rows count up from the bottom, so the top of each block (y1) is its brightest edge.
      g.rect(x0, ctx.grid.rows - y1, x1, ctx.grid.rows - y0, (_c, r) => pick(rampI, (r + 0.5 - (ctx.grid.rows - y1)) / (y1 - y0 || 1)));
      if (w * cell > 64 && h * cell > 34) {
        const [tx, ty] = px(ctx, x0, ctx.grid.rows - y0);
        ctx.out.texts.push({ x: tx + 6, y: ty + 11, text: f.labels[i] == null ? '' : labelText(f.labels[i]), align: 'left', baseline: 'middle', color: 'textHi', bg: 'tooltip', weight: 700, size: 11 });
        ctx.out.texts.push({ x: tx + 6, y: ty + 29, text: ctx.format(f.values[i]), align: 'left', baseline: 'middle', color: 'text', bg: 'tooltip', size: 10 });
      }
    }
  },
  pick(ctx, m, f, x, y) {
    const ty = ctx.grid.rows - y;
    const r = treeRects(ctx, m, f).find(([, rx, ry, w, h]) => x >= rx && x < rx + w && ty >= ry && ty < ry + h);
    return r ? r[0] : -1;
  },
  tip(ctx, _m, f, id) {
    const h = shareHit(ctx, { ...f, colors: f.itemColor, names: f.labels.map(labelText) }, id);
    if (h && f.groups) h.rows.push({ color: f.itemColor[id], name: String(ctx.opts.by), value: f.groupNames[f.groups.findIndex((g: number[]) => g.includes(id))] });
    return h;
  },
  ids: (ctx, f) => f.labels.map((_: any, i: number) => i).filter((i: number) => f.values[i] > 0 && !ctx.hidden.has(labelText(f.labels[i]))),
  anchor(ctx, m, f, id) {
    const r = treeRects(ctx, m, f).find(q => q[0] === id);
    return r ? [r[1] + r[3] / 2, ctx.grid.rows - (r[2] + r[4] / 2)] : [ctx.grid.cols / 2, ctx.grid.rows / 2];
  },
  legend: (_ctx, f) => f.names.map((name: string, i: number) => ({ name, color: f.colors[i] })),
  count: f => f.labels.length,
});

// ── funnel ──────────────────────────────────────────────────────────────────────────────

function funnelGeo(ctx: Ctx, n: number) {
  const { rows } = ctx.grid, band = rows / Math.max(1, n), gap = band >= 3 ? 1 : band >= 2 ? 0.5 : 0;
  return { band, gap, at: (i: number) => [rows - (i + 1) * band + gap / 2, rows - i * band - gap / 2] as [number, number] };
}

registerType('funnel', {
  kind: 'grid',
  margin: ctx => ({ l: 4, r: ctx.opts.labels === false ? 4 : 44, t: 4, b: 4 }),
  keyed: ['v'],
  model(ctx) {
    const f = catFixed({ ...ctx, opts: { ...ctx.opts, sort: ctx.opts.sort ?? false } } as Ctx);
    const name = ctx.opts.label || 'funnel', base = ctx.opts.colors ? null : ctx.colorOf(name, 0);
    const colors = base ? f.labels.map((_, i) => mix(base, ctx.theme.fade, (i / Math.max(1, f.labels.length)) * 0.45)) : f.colors;
    return { model: { v: shownValues(ctx, f) }, fixed: { ...f, colors, max: maxOf(f.values, 1e-9), ramps: colors.map(c => shades(ctx.theme.fade, c, 0.6, 1)) } };
  },
  keys: f => f.keys,
  raster(ctx, m, f, g) {
    const n = m.v.length, { cols, cell, ox } = ctx.grid, { at } = funnelGeo(ctx, n), cx = cols / 2;
    for (let i = 0; i < n; i++) {
      const [y0, y1] = at(i), half = (cols / 2) * clamp(m.v[i] / f.max), hot = ctx.hover === i;
      if (half < 0.05) continue;
      const a = cx - half, b = cx + half;
      g.rect(a, y0, b, y1, c => pick(f.ramps[i], hot ? 1 : 0.55 + 0.45 * (1 - Math.abs(c + 0.5 - cx) / (half || 1))));
      if ((y1 - y0) * cell < 12) continue;
      const [tx, ty] = px(ctx, cx, (y0 + y1) / 2);
      ctx.out.texts.push({ x: tx, y: ty, text: `${f.names[i]}  ${ctx.format(f.values[i])}`, align: 'center', baseline: 'middle', color: 'textHi', bg: 'tooltip', size: 10 });
      if (ctx.opts.labels !== false && i > 0) ctx.out.texts.push({ x: ox + cols * cell + 40, y: ty, text: Math.round((f.values[i] / (f.values[0] || 1)) * 100) + '%', align: 'right', baseline: 'middle', color: 'text', size: 10 });
    }
  },
  pick(ctx, m, f, x, y) {
    const n = m.v.length, { at } = funnelGeo(ctx, n), cx = ctx.grid.cols / 2;
    for (let i = 0; i < n; i++) { const [y0, y1] = at(i), half = (ctx.grid.cols / 2) * clamp(m.v[i] / f.max); if (y >= y0 && y <= y1 && Math.abs(x - cx) <= Math.max(half, 2)) return i; }
    return -1;
  },
  tip(ctx, _m, f, id) {
    const h = shareHit(ctx, f, id, false);
    if (h && id > 0) h.rows.push({ color: f.colors[id], name: 'of first', value: Math.round((f.values[id] / (f.values[0] || 1)) * 100) + '%' });
    if (h && id > 0) h.rows.push({ color: f.colors[id], name: 'of previous', value: Math.round((f.values[id] / (f.values[id - 1] || 1)) * 100) + '%' });
    return h;
  },
  ids: visibleIds,
  anchor(ctx, m, _f, id) { const [y0, y1] = funnelGeo(ctx, m.v.length).at(id); return [ctx.grid.cols / 2, (y0 + y1) / 2]; },
  legend: () => [],
  count: f => f.labels.length,
});

// ── stat ────────────────────────────────────────────────────────────────────────────────

/** 5×7 tile font for the big number. */
export const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ',': ['00', '00', '00', '00', '01', '01', '10'],
  '%': ['11001', '11001', '00010', '00100', '01000', '10011', '10011'],
  '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  '–': ['000', '000', '000', '111', '000', '000', '000'],
  '+': ['000', '000', '010', '111', '010', '000', '000'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'],
  k: ['1000', '1000', '1001', '1010', '1100', '1010', '1001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  s: ['0000', '0000', '0111', '1000', '0110', '0001', '1110'],
  m: ['00000', '00000', '11010', '10101', '10101', '10101', '10101'],
  h: ['1000', '1000', '1110', '1001', '1001', '1001', '1001'],
  d: ['0001', '0001', '0111', '1001', '1001', '1001', '0111'],
};

/** Tile width of a string in the glyph font (one tile of spacing between glyphs). */
export const glyphWidth = (text: string) => [...text].reduce((w, ch, i) => w + (GLYPHS[ch] || GLYPHS[' '])[0].length + (i ? 1 : 0), 0);

function drawGlyphs(g: Raster, text: string, x: number, top: number, scale: number, color: (c: number, r: number) => RGB) {
  let cx = x;
  for (const ch of text) {
    const rows = GLYPHS[ch] || GLYPHS[' '];
    for (let r = 0; r < 7; r++) for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== '1') continue;
      const x0 = cx + c * scale, y1 = top - r * scale;
      g.rect(x0, y1 - scale, x0 + scale, y1, color);
    }
    cx += (rows[0].length + 1) * scale;
  }
}

function statGeo(ctx: Ctx, text: string, spark: boolean) {
  const { cols, rows } = ctx.grid, numRows = spark ? Math.floor(rows * 0.58) : rows;
  const w = glyphWidth(text), scale = Math.max(1, Math.floor(Math.min(cols / Math.max(1, w), numRows / 7)));
  return { scale, top: rows - Math.floor((numRows - 7 * scale) / 2), left: Math.floor((cols - w * scale) / 2), sparkRows: spark ? rows - numRows - 1 : 0 };
}

const statValue = (ctx: Ctx, sparkVals: number[]) => {
  const v = ctx.opts.value;
  if (typeof v === 'number') return v;
  return sparkVals.length ? sparkVals[sparkVals.length - 1] : 0;
};

registerType('stat', {
  kind: 'grid',
  margin: ctx => ({ l: 2, r: 2, t: ctx.opts.label ? 20 : 2, b: 2 }),
  model(ctx) {
    const o = ctx.opts, first = ctx.rows[0] || {};
    const vk = (Array.isArray(o.y) ? o.y[0] : o.y) ?? (typeof o.value === 'string' ? o.value : null) ?? Object.keys(first).find(k => typeof first[k] === 'number') ?? 'value';
    const spark = ctx.rows.map((r, i) => num(getter(vk)(r, i))).filter(Number.isFinite);
    const v = statValue(ctx, spark), name = o.label || 'value', color = ctx.colorOf(name, 0);
    const lo = minOf(spark), hi = maxOf(spark);
    return {
      model: { v, s: spark.map(x => (hi > lo ? (x - lo) / (hi - lo) : 0.5)) },
      fixed: { v, spark, color, names: [name], ramp: shades(ctx.theme.fade, color, 0.35, 0.75), first: spark[0] },
    };
  },
  raster(ctx, m, f, g) {
    const th = ctx.theme, text = ctx.format(roundLike(m.v, f.v)), spark = m.s.length > 1;
    const { scale, top, left, sparkRows } = statGeo(ctx, text, spark), hot = ctx.hover === 0;
    const glyphTop = top, h = 7 * scale;
    drawGlyphs(g, text, left, glyphTop, scale, (_c, r) => mix(hot ? th.snow : th.textHi, th.snow, (r - (glyphTop - h)) / (h || 1) * 0.3));
    if (spark && sparkRows >= 2) {
      const n = m.s.length, xs = m.s.map((_: number, i: number) => 0.5 + (i / (n - 1)) * (ctx.grid.cols - 1));
      const ys = m.s.map((v: number) => 0.5 + v * (sparkRows - 1));
      for (let c = 0; c < ctx.grid.cols; c++) {
        const t = (c + 0.5 - 0.5) / (ctx.grid.cols - 1) * (n - 1), i = Math.min(n - 2, Math.floor(t)), y = ys[i] + (ys[i + 1] - ys[i]) * (t - i);
        g.rect(c, 0, c + 1, y, (_c, r) => pick(f.ramp, r / Math.max(1, sparkRows)), 0.8);
      }
      const pts: number[] = [];
      xs.forEach((x: number, i: number) => pts.push(x, ys[i]));
      g.line(pts, Math.max(1, 2.4 / ctx.grid.cell), f.color);
    }
    if (ctx.opts.label) ctx.out.texts.push({ x: ctx.grid.ox, y: ctx.grid.oy - 10, text: ctx.opts.label, align: 'left', baseline: 'middle', color: 'text', size: 10 });
    if (spark && Number.isFinite(f.first) && f.first !== 0 && ctx.opts.label) {
      const d = (f.v - f.first) / Math.abs(f.first) * 100, up = d >= 0;
      ctx.out.texts.push({ x: ctx.grid.ox + ctx.grid.cols * ctx.grid.cell, y: ctx.grid.oy - 10, text: `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%`, align: 'right', baseline: 'middle', color: up ? th.up : th.down, size: 10, weight: 700 });
    }
  },
  pick: () => 0,
  tip(ctx, _m, f) { return { index: 0, title: ctx.opts.label || 'value', rows: [{ color: f.color, name: 'value', value: ctx.format(f.v) }], point: { type: 'stat', index: 0, value: f.v } }; },
  ids: () => [0],
  anchor: ctx => [ctx.grid.cols / 2, ctx.grid.rows / 2],
  count: () => 1,
});

