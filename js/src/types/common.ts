import type { Ctx, Margin, XInfo } from '../core/types';
import type { Hit, RGB, TipRow, Model } from '../core/model-types';
import type { Raster, Paint, Pattern } from '../core/field';
import { mix, shades, sum } from '../core/util';
import { labelText } from '../core/format';
import { categories, wide, type Wide } from '../core/data';

export const polarMargin = (): Margin => ({ l: 6, r: 6, t: 6, b: 6 });

export interface SeriesFixed extends Wide {
  colors: RGB[];
  sides: ('left' | 'right')[];
  patterns: Pattern[];
}

/** Wide series plus colour, axis side and pattern per series. */
export function seriesFixed(ctx: Ctx): SeriesFixed {
  const w = ctx.derive('wide', ctx.opts, () => wide(ctx.rows, ctx.opts)), s = ctx.opts.series || {};
  return {
    ...w,
    colors: w.names.map((n, i) => ctx.colorOf(n, i)),
    sides: w.names.map(n => (s[n] && s[n].axis === 'right' ? 'right' : 'left')),
    patterns: w.names.map(n => (s[n] && s[n].pattern) || 'solid'),
  };
}

export const xinfoOf = (f: Wide): XInfo => ({ kind: f.xKind, labels: f.labels, xs: f.xs, keys: f.keys });
export const seriesLegend = (_ctx: Ctx, f: { names: string[]; colors: RGB[] }) => f.names.map((name, i) => ({ name, color: f.colors[i] }));
export const categoryLegend = (_ctx: Ctx, f: { labels: any[]; colors: RGB[] }) => f.labels.map((l, i) => ({ name: labelText(l), color: f.colors[i] }));

export function seriesRows(ctx: Ctx, f: SeriesFixed, i: number, extra?: (s: number) => string): TipRow[] {
  const sf = ctx.opts.series || {};
  return f.names.flatMap((n, s) => {
    if (ctx.hidden.has(n)) return [];
    const v = f.values[s][i];
    const fmt = sf[n] && sf[n].format ? (typeof sf[n].format === 'function' ? sf[n].format : ctx.format) : ctx.format;
    return [{ color: f.colors[s], name: (sf[n] && sf[n].label) || n, value: (Number.isFinite(v) ? fmt(v) : '–') + (extra ? extra(s) : '') }];
  });
}

/** Rectangle in (category, value) space, oriented for vertical or horizontal charts. Category
 *  coordinates come from ctx.X / ctx.xAt; for horizontal charts they run down from the top. */
export function orientedRect(ctx: Ctx, g: Raster, a0: number, a1: number, p0: number, p1: number, paint: Paint, scale = 1) {
  if (ctx.horizontal) {
    const rows = ctx.grid.rows;
    g.rect(p0, rows - a1, p1, rows - a0, paint, scale); // paints receive field (c, r) either way
  } else g.rect(a0, p0, a1, p1, paint, scale);
}

/** Bar-like fill: darker at the base, brighter towards the tip. Returns a paint for orientedRect. */
export function tipShade(ctx: Ctx, ramp: RGB[], p0: number, p1: number): Paint {
  const lo = Math.min(p0, p1), span = Math.abs(p1 - p0) || 1, up = p1 >= p0;
  return (c: number, r: number) => {
    const along = ctx.horizontal ? c : r;
    const t = (along + 0.5 - lo) / span;
    return ramp[Math.round(Math.max(0, Math.min(1, 0.35 + 0.65 * (up ? t : 1 - t))) * (ramp.length - 1))];
  };
}

export const barRamps = (ctx: Ctx, colors: RGB[]) => ({
  ramps: colors.map(c => shades(ctx.theme.fade, c, 0.5, 1)),
  hot: colors.map(c => shades(ctx.theme.fade, mix(c, ctx.theme.snow, 0.35), 0.6, 1)),
});

/** Visible rows (respecting zoom) for extents. */
export function visibleRange(ctx: Ctx, n: number, fn: (i: number) => void) {
  for (let i = 0; i < n; i++) if (ctx.inView(i)) fn(i);
}

export const sideOf = (f: SeriesFixed, s: number) => f.sides[s];

export type { Model };

// ── Part-to-whole helpers (pie, donut, rose, waffle, treemap, funnel, radialBar) ──────────

export interface CatFixed { labels: any[]; values: number[]; keys: string[]; rows: any[]; names: string[]; colors: RGB[] }

/** Label / value pairs plus a colour per category. */
export function catFixed(ctx: Ctx): CatFixed {
  const c = ctx.derive('cats', ctx.opts, () => categories(ctx.rows, ctx.opts)), names = c.labels.map(labelText);
  return { ...c, names, colors: names.map((n, i) => ctx.colorOf(n, i)) };
}

/** Category values with hidden ones at zero, so they animate out. */
export const shownValues = (ctx: Ctx, f: CatFixed) => f.values.map((v, i) => (ctx.hidden.has(f.names[i]) ? 0 : v));

/** Tooltip for category j: its value and share of the visible total. */
export function shareHit(ctx: Ctx, f: CatFixed, j: number, share = true): Hit | null {
  if (!(j >= 0 && j < f.labels.length)) return null;
  const total = sum(f.values.filter((_, i) => !ctx.hidden.has(f.names[i]))) || 1;
  const value = ctx.format(f.values[j]);
  return {
    index: j, title: f.names[j],
    rows: [{ color: f.colors[j], name: share ? value : 'value', value: share ? Math.round((f.values[j] / total) * 100) + '%' : value }],
    point: { type: ctx.opts.type, index: j, label: f.names[j], value: f.values[j], row: f.rows[j] },
  };
}

export const visibleIds = (ctx: Ctx, f: { names: string[] }) => f.names.map((_, i) => i).filter(i => !ctx.hidden.has(f.names[i]));

/** Angle of (x, y) around (cx, cy), clockwise from 12 o'clock, in [0, TAU). */
export function angleOf(x: number, y: number, cx: number, cy: number) {
  const a = Math.atan2(x - cx, y - cy);
  return a < 0 ? a + Math.PI * 2 : a;
}

/** Big centred number with a caption below (donut, gauge). Sizes in CSS pixels. */
export function centreText(ctx: Ctx, cx: number, cy: number, big: string, small: string | null, size: number) {
  const { ox, oy, rows, cell } = ctx.grid, px = ox + cx * cell, py = oy + (rows - cy) * cell;
  ctx.out.texts.push({ x: px, y: py - (small ? size * 0.18 : 0), text: big, size, weight: 700, color: 'textHi', baseline: 'middle', align: 'center' });
  if (small) ctx.out.texts.push({ x: px, y: py + size * 0.62, text: small, color: 'text', baseline: 'middle', align: 'center', size: 10 });
}

/** CSS pixel position of tile point (x, y). */
export const px = (ctx: Ctx, x: number, y: number): [number, number] => [ctx.grid.ox + x * ctx.grid.cell, ctx.grid.oy + (ctx.grid.rows - y) * ctx.grid.cell];
