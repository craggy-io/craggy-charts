// Radial chart types: pie, donut, gauge, radialBar, radar, rose, progress.
import { registerType, CHAR_W } from '../core/chart-core';
import type { ChartTypeDef, Ctx } from '../core/types';
import type { RGB } from '../core/model-types';
import { clamp, maxOf, mix, pick, ramp, shades, sum, TAU } from '../core/util';
import { labelText, roundLike } from '../core/format';
import { niceTicks } from '../core/ticks';
import { angleOf, catFixed, categoryLegend, centreText, polarMargin, px, seriesLegend, seriesRows, seriesFixed, shareHit, shownValues, visibleIds } from './common';

/** Plot centre and radius of a round chart (tiles). */
const disc = (ctx: Ctx, pad = 1) => ({ cx: ctx.grid.cols / 2, cy: ctx.grid.rows / 2, R: Math.max(1, Math.min(ctx.grid.cols, ctx.grid.rows) / 2 - pad) });

/** Margin that leaves room for labels around a round chart. */
const labelMargin = (ctx: Ctx) => {
  const f = catOrWide(ctx), w = Math.min(90, maxOf(f.map(l => Math.min(14, labelText(l).length)), 0) * CHAR_W + 12);
  return { l: w, r: w, t: 18, b: 18 };
};
const catOrWide = (ctx: Ctx): any[] => {
  const rows = ctx.rows, first = rows[0] || {}, k = ctx.opts.x ?? Object.keys(first).find(q => typeof first[q] !== 'number');
  return k == null ? rows.map((_, i) => i) : rows.map(r => r[k]);
};

/** Cumulative slice angles of the shown values. */
function slices(v: number[], span = TAU): [number, number][] {
  const total = sum(v) || 1;
  let a = 0;
  return v.map(x => { const a0 = a; a += (Math.max(0, x) / total) * span; return [a0, a]; });
}

// ── pie / donut ─────────────────────────────────────────────────────────────────────────

const pieLike = (inner: number): ChartTypeDef => ({
  kind: 'polar',
  margin: polarMargin,
  hoverModel: true,
  keyed: ['v', 'ex'],
  model(ctx) {
    const f = catFixed(ctx);
    return {
      model: { v: shownValues(ctx, f), ex: f.labels.map((_, i) => (i === ctx.hover ? 1 : 0)) },
      fixed: { ...f, ramps: f.colors.map(c => shades(ctx.theme.fade, c, 0.55, 1)) },
    };
  },
  keys: f => f.keys,
  raster(ctx, m, f, g) {
    const { cx, cy, R } = disc(ctx, 1.2), r0 = R * (ctx.opts.inner ?? inner), sl = slices(m.v);
    const gap = Math.max(0.35, 2.5 / ctx.grid.cell);
    sl.forEach(([a0, a1], j) => {
      if (a1 - a0 < 1e-4) return;
      const Rj = R + m.ex[j] * Math.min(1.2, R * 0.06);
      g.sector(cx, cy, r0, Rj, a0, a1, gap, d => pick(f.ramps[j], ((d - r0) / (Rj - r0 || 1)) * 0.6 + 0.4 + m.ex[j] * 0.2));
    });
    const total = sum(m.v), shownTotal = sum(shownValues(ctx, f)) || 1;
    const showLabels = ctx.opts.labels ?? r0 === 0;
    if (showLabels && R * ctx.grid.cell > 50) sl.forEach(([a0, a1], j) => {
      if ((a1 - a0) / TAU < 0.06) return;
      const mid = (a0 + a1) / 2, rr = r0 + (R - r0) * (r0 ? 0.5 : 0.62);
      const [x, y] = px(ctx, cx + Math.sin(mid) * rr, cy + Math.cos(mid) * rr);
      ctx.out.texts.push({ x, y, text: Math.round((m.v[j] / (total || 1)) * 100) + '%', align: 'center', baseline: 'middle', color: 'textHi', bg: 'tooltip', weight: 700, size: 10 });
    });
    if (r0 > 3 && ctx.opts.axes !== false) {
      const hot = ctx.hover >= 0 && ctx.hover < f.labels.length;
      const size = Math.max(12, Math.min(34, r0 * ctx.grid.cell * 0.42));
      centreText(ctx, cx, cy, ctx.format(hot ? f.values[ctx.hover] : roundLike(total, shownTotal)), hot ? f.names[ctx.hover] : ctx.opts.label || 'total', size);
    }
  },
  pick(ctx, m, _f, x, y) {
    const { cx, cy, R } = disc(ctx, 1.2), r0 = R * (ctx.opts.inner ?? inner), d = Math.hypot(x - cx, y - cy);
    if (d > R + 1.5 || d < r0 - 0.5) return -1;
    const a = angleOf(x, y, cx, cy);
    return slices(m.v).findIndex(([a0, a1]) => a >= a0 && a < a1 && a1 - a0 > 1e-4);
  },
  tip: (ctx, _m, f, id) => shareHit(ctx, f, id),
  ids: visibleIds,
  anchor(ctx, m, _f, id) {
    const { cx, cy, R } = disc(ctx, 1.2), r0 = R * (ctx.opts.inner ?? inner), [a0, a1] = slices(m.v)[id] || [0, 0], mid = (a0 + a1) / 2, rr = (r0 + R) / 2;
    return [cx + Math.sin(mid) * rr, cy + Math.cos(mid) * rr];
  },
  legend: categoryLegend,
  count: f => f.labels.length,
});
registerType('pie', pieLike(0));
registerType('donut', pieLike(0.62));

// ── gauge ───────────────────────────────────────────────────────────────────────────────

const GAUGE_SPAN = Math.PI * 1.5, GAUGE_START = -Math.PI * 0.75;

function gaugeGeo(ctx: Ctx) {
  const { cols, rows } = ctx.grid;
  const R = Math.max(2, Math.min(cols / 2 - 1, (rows - 2) / 1.707)), cx = cols / 2, cy = 1 + 0.707 * R + (rows - 2 - 1.707 * R) / 2;
  return { cx, cy, R, r0: R * (ctx.opts.inner ?? 0.74) };
}

const gaugeValue = (o: any) => (typeof o.value === 'number' ? o.value : +o.value || 0);

registerType('gauge', {
  kind: 'polar',
  margin: polarMargin,
  model(ctx) {
    const o = ctx.opts, min = o.min ?? 0, max = o.max ?? 100, v = gaugeValue(o);
    const color: RGB | null = o.colors ? ctx.colorOf(o.label || 'value', 0) : null;
    return { model: { f: clamp((v - min) / (max - min || 1)) }, fixed: { min, max, v, color, names: [o.label || 'value'] } };
  },
  raster(ctx, m, f, g) {
    const { cx, cy, R, r0 } = gaugeGeo(ctx), th = ctx.theme;
    g.sector(cx, cy, r0, R, GAUGE_START, GAUGE_START + GAUGE_SPAN, 0, () => th.grid, 0.4);
    const hot = ctx.hover === 0;
    if (m.f > 0.002) g.sector(cx, cy, r0, R, GAUGE_START, GAUGE_START + GAUGE_SPAN * m.f, 0, (_d, rel) => {
      if (rel > 1 - 0.03 / Math.max(m.f, 0.03)) return th.snow; // bright leading edge
      const t = rel * (0.6 + 0.4 * m.f);
      const c = f.color ? mix(th.fade, f.color, 0.45 + 0.55 * t) : ramp(th.terrain, 0.5 + 0.5 * t);
      return hot ? mix(c, th.snow, 0.25) : c;
    });
    const size = Math.max(14, Math.min(40, r0 * ctx.grid.cell * 0.5));
    centreText(ctx, cx, cy, ctx.format(roundLike(f.min + m.f * (f.max - f.min), f.v)), ctx.opts.label || null, size);
  },
  pick(ctx, _m, _f, x, y) {
    const { cx, cy, R, r0 } = gaugeGeo(ctx), d = Math.hypot(x - cx, y - cy);
    return d <= R + 1 && d >= r0 - 1 ? 0 : -1;
  },
  tip(ctx, _m, f) {
    const c = f.color || ctx.theme.palette[0];
    return { index: 0, title: ctx.opts.label || 'value', rows: [{ color: c, name: 'of ' + ctx.format(f.max), value: ctx.format(f.v) }], point: { type: 'gauge', index: 0, value: f.v } };
  },
  ids: () => [0],
  anchor: ctx => { const { cx, cy } = gaugeGeo(ctx); return [cx, cy]; },
  count: () => 1,
});

// ── radialBar ───────────────────────────────────────────────────────────────────────────

function ringsGeo(ctx: Ctx, n: number) {
  const { cx, cy, R } = disc(ctx, 1), hole = R * (ctx.opts.inner ?? 0.25), each = (R - hole) / Math.max(1, n);
  const width = each >= 3 ? each - 1 : each * 0.75;
  return { cx, cy, R, ring: (i: number) => { const r1 = R - i * each; return [r1 - width, r1] as [number, number]; } };
}

registerType('radialBar', {
  kind: 'polar',
  margin: polarMargin,
  keyed: ['v'],
  model(ctx) {
    const f = catFixed(ctx), max = ctx.opts.max ?? niceTicks(0, maxOf(f.values, 1e-9), 4).max;
    return { model: { v: shownValues(ctx, f).map(v => clamp(v / (max || 1))) }, fixed: { ...f, max, ramps: f.colors.map(c => shades(ctx.theme.fade, c, 0.5, 1)) } };
  },
  keys: f => f.keys,
  raster(ctx, m, f, g) {
    const n = m.v.length, { cx, cy, ring } = ringsGeo(ctx, n), th = ctx.theme, span = GAUGE_SPAN;
    for (let i = 0; i < n; i++) {
      const [r0, r1] = ring(i), hot = ctx.hover === i;
      g.sector(cx, cy, r0, r1, 0, span, 0, () => th.grid, 0.4);
      if (m.v[i] > 0.002) g.sector(cx, cy, r0, r1, 0, span * m.v[i], 0, (_d, rel) => pick(f.ramps[i], hot ? 1 : 0.45 + 0.55 * rel));
      if (ctx.opts.labels !== false && (r1 - r0) * ctx.grid.cell >= 7) {
        const [x, y] = px(ctx, cx, cy + (r0 + r1) / 2);
        ctx.out.texts.push({ x: x - 6, y, text: `${f.names[i]} ${ctx.format(f.values[i])}`, align: 'right', baseline: 'middle', color: hot ? 'textHi' : 'text', size: 10 });
      }
    }
  },
  pick(ctx, m, _f, x, y) {
    const n = m.v.length, { cx, cy, ring } = ringsGeo(ctx, n), d = Math.hypot(x - cx, y - cy), a = angleOf(x, y, cx, cy);
    if (a > GAUGE_SPAN + 0.1) return -1;
    for (let i = 0; i < n; i++) { const [r0, r1] = ring(i); if (d >= r0 - 0.5 && d <= r1 + 0.5) return i; }
    return -1;
  },
  tip: (ctx, _m, f, id) => shareHit(ctx, f, id, false),
  ids: visibleIds,
  anchor(ctx, m, _f, id) { const { cx, cy, ring } = ringsGeo(ctx, m.v.length), [r0, r1] = ring(id), r = (r0 + r1) / 2; return [cx + r, cy]; },
  legend: categoryLegend,
  count: f => f.labels.length,
});

// ── radar ───────────────────────────────────────────────────────────────────────────────

const radarPt = (cx: number, cy: number, n: number) => (i: number, r: number): [number, number] => [cx + Math.sin((i / n) * TAU) * r, cy + Math.cos((i / n) * TAU) * r];

registerType('radar', {
  kind: 'polar',
  margin: labelMargin,
  keyed: ['s'],
  model(ctx) {
    const f = seriesFixed(ctx);
    const max = ctx.opts.max ?? niceTicks(0, maxOf(f.values.flat(), 1e-9), 4).max;
    return {
      model: { s: f.values.map(v => v.map(x => (Number.isFinite(x) ? Math.max(0, x) / max : 0))), a: f.names.map(n => (ctx.hidden.has(n) ? 0 : 1)) },
      fixed: { ...f, max },
    };
  },
  keys: f => f.keys,
  raster(ctx, m, f, g) {
    const n = f.labels.length, { cx, cy, R } = disc(ctx, 1), th = ctx.theme;
    if (n < 3) return;
    const pt = radarPt(cx, cy, n);
    const ring = (r: number) => { const p: number[] = []; for (let i = 0; i <= n; i++) p.push(...pt(i % n, r)); return p; };
    for (let k = 1; k <= 4; k++) g.line(ring((R * k) / 4), 0.5, th.grid, 0.45);
    for (let i = 0; i < n; i++) g.line([cx, cy, ...pt(i, R)], 0.5, ctx.hover === i ? th.snow : th.grid, ctx.hover === i ? 0.5 : 0.4);
    const lw = Math.max(1, 2.6 / ctx.grid.cell);
    const shapes = m.s.map((v: number[], s: number) => { const p: number[] = []; for (let i = 0; i <= n; i++) p.push(...pt(i % n, (v[i % n] || 0) * R * m.a[s])); return p; });
    const visible = shapes.map((_: any, s: number) => s).filter((s: number) => m.a[s] >= 0.01).reverse();
    for (const s of visible) g.polygon(shapes[s], mix(th.fade, f.colors[s], 0.42), 0.62); // fills first,
    for (const s of visible) g.line(shapes[s], lw, f.colors[s]);                         // then every outline,
    for (const s of visible) for (let i = 0; i < n; i++) {                                // then the vertices
      const [x, y] = pt(i, (m.s[s][i] || 0) * R * m.a[s]);
      g.disc(x, y, lw * 0.5 + 0.5, mix(f.colors[s], th.snow, ctx.hover === i ? 0.6 : 0.2));
    }
    if (ctx.opts.axes === false) return;
    for (let i = 0; i < n; i++) {
      const sx = Math.sin((i / n) * TAU), sy = Math.cos((i / n) * TAU), [x, y] = px(ctx, ...pt(i, R));
      ctx.out.texts.push({ x: x + sx * 8, y: y - sy * 9, text: labelText(f.labels[i]), align: Math.abs(sx) < 0.2 ? 'center' : sx > 0 ? 'left' : 'right', baseline: 'middle', color: ctx.hover === i ? 'textHi' : 'text', size: 10 });
    }
    for (let k = 2; k <= 4; k += 2) {
      const [x, y] = px(ctx, cx, cy + (R * k) / 4);
      ctx.out.texts.push({ x: x + 4, y: y + 6, text: ctx.format((f.max * k) / 4), align: 'left', baseline: 'middle', color: 'text', size: 9, alpha: 0.7 });
    }
  },
  pick(ctx, _m, f, x, y) {
    const n = f.labels.length, { cx, cy, R } = disc(ctx, 1);
    if (n < 3 || Math.hypot(x - cx, y - cy) > R + 2) return -1;
    return Math.round((angleOf(x, y, cx, cy) / TAU) * n) % n;
  },
  tip(ctx, _m, f, id) {
    if (!(id >= 0 && id < f.labels.length)) return null;
    const label = labelText(f.labels[id]);
    return { index: id, title: label, rows: seriesRows(ctx, f, id), point: { type: 'radar', index: id, label, row: f.rows[id] } };
  },
  ids: (_ctx, f) => f.labels.map((_: any, i: number) => i),
  anchor(ctx, _m, f, id) { const { cx, cy, R } = disc(ctx, 1); return radarPt(cx, cy, f.labels.length)(id, R * 0.7); },
  legend: seriesLegend,
  count: f => f.labels.length,
});

// ── rose ────────────────────────────────────────────────────────────────────────────────

registerType('rose', {
  kind: 'polar',
  margin: labelMargin,
  keyed: ['v'],
  model(ctx) {
    const f = catFixed(ctx), max = maxOf(f.values, 1e-9);
    return { model: { v: shownValues(ctx, f).map(v => Math.sqrt(v / max)) }, fixed: { ...f, max, ramps: f.colors.map(c => shades(ctx.theme.fade, c, 0.45, 1)) } };
  },
  keys: f => f.keys,
  raster(ctx, m, f, g) {
    const n = m.v.length, { cx, cy, R } = disc(ctx, 1), th = ctx.theme, step = TAU / Math.max(1, n);
    if (!n) return;
    for (let k = 1; k <= 3; k++) { const r = (R * k) / 3, p: number[] = []; for (let a = 0; a <= 64; a++) p.push(cx + Math.sin((a / 64) * TAU) * r, cy + Math.cos((a / 64) * TAU) * r); g.line(p, 0.5, th.grid, 0.35); }
    const gap = Math.max(0.35, 2.5 / ctx.grid.cell);
    for (let i = 0; i < n; i++) {
      const r = m.v[i] * R;
      if (r < 0.3) continue;
      const hot = ctx.hover === i;
      g.sector(cx, cy, 0, r, i * step, (i + 1) * step, gap, d => pick(f.ramps[i], hot ? 1 : 0.35 + 0.65 * (d / (r || 1))));
    }
    if (ctx.opts.axes === false) return;
    for (let i = 0; i < n; i++) {
      const mid = (i + 0.5) * step, sx = Math.sin(mid), sy = Math.cos(mid), [x, y] = px(ctx, cx + sx * R, cy + sy * R);
      ctx.out.texts.push({ x: x + sx * 8, y: y - sy * 9, text: f.names[i], align: Math.abs(sx) < 0.2 ? 'center' : sx > 0 ? 'left' : 'right', baseline: 'middle', color: ctx.hover === i ? 'textHi' : 'text', size: 10 });
    }
  },
  pick(ctx, m, _f, x, y) {
    const n = m.v.length, { cx, cy, R } = disc(ctx, 1);
    if (!n) return -1;
    const i = Math.floor((angleOf(x, y, cx, cy) / TAU) * n) % n;
    return Math.hypot(x - cx, y - cy) <= Math.max(m.v[i] * R, 2) + 1 ? i : -1;
  },
  tip: (ctx, _m, f, id) => shareHit(ctx, f, id),
  ids: visibleIds,
  anchor(ctx, m, _f, id) { const { cx, cy, R } = disc(ctx, 1), mid = ((id + 0.5) / m.v.length) * TAU, r = m.v[id] * R * 0.6; return [cx + Math.sin(mid) * r, cy + Math.cos(mid) * r]; },
  legend: categoryLegend,
  count: f => f.labels.length,
});

// ── progress ────────────────────────────────────────────────────────────────────────────

function progressGeo(ctx: Ctx) {
  const { rows } = ctx.grid, thick = rows <= 6 ? rows : Math.max(2, Math.round(rows * 0.35));
  const y0 = Math.floor((rows - thick) / 2);
  return { y0, y1: y0 + thick };
}

registerType('progress', {
  kind: 'polar',
  margin: ctx => ({ l: 2, r: 2, t: ctx.opts.label || ctx.opts.axes !== false ? 18 : 2, b: 2 }),
  model(ctx) {
    const o = ctx.opts, min = o.min ?? 0, max = o.max ?? 100, v = gaugeValue(o), name = o.label || 'progress';
    const color = ctx.colorOf(name, 0);
    return { model: { f: clamp((v - min) / (max - min || 1)) }, fixed: { min, max, v, color, names: [name], ramp: shades(ctx.theme.fade, color, 0.55, 1) } };
  },
  raster(ctx, m, f, g) {
    const { cols, cell, ox, oy, rows } = ctx.grid, { y0, y1 } = progressGeo(ctx), th = ctx.theme, hot = ctx.hover === 0;
    g.rect(0, y0, cols, y1, th.grid, 0.26);
    const end = cols * m.f;
    if (end > 0.01) g.rect(0, y0, end, y1, c => (c >= end - 1 ? th.snow : pick(f.ramp, hot ? 1 : 0.4 + 0.6 * (c / Math.max(1, end)))));
    if (ctx.opts.axes === false && !ctx.opts.label) return;
    const top = oy + (rows - y1) * cell - 7;
    if (ctx.opts.label) ctx.out.texts.push({ x: ox, y: top, text: ctx.opts.label, align: 'left', baseline: 'bottom', color: 'text', size: 10 });
    const pct = f.max - f.min === 100 && f.min === 0 ? ctx.format(roundLike(m.f * 100, f.v)) + (ctx.opts.format ? '' : '%') : ctx.format(roundLike(f.min + m.f * (f.max - f.min), f.v));
    ctx.out.texts.push({ x: ox + cols * cell, y: top, text: pct, align: 'right', baseline: 'bottom', color: 'textHi', weight: 700, size: 10 });
  },
  pick(ctx, _m, _f, _x, y) { const { y0, y1 } = progressGeo(ctx); return y >= y0 - 0.5 && y <= y1 + 0.5 ? 0 : -1; },
  tip(ctx, _m, f) {
    return { index: 0, title: ctx.opts.label || 'progress', rows: [{ color: f.color, name: 'of ' + ctx.format(f.max), value: ctx.format(f.v) }], point: { type: 'progress', index: 0, value: f.v } };
  },
  ids: () => [0],
  anchor(ctx, m) { const { y1 } = progressGeo(ctx); return [ctx.grid.cols * m.f, y1]; },
  count: () => 1,
});

