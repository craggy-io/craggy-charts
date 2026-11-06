import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ChartCore, registeredTypes, CHART_TYPES, niceTicks, logTicks, timeTicks, makeFormat, timeLabel, rowsOf, wide, categories } from '../src/core/index';
import { compact, grouped, bytes, duration, roundLike } from '../src/core/format';
import { approach, remap, zero, SNAP_LENGTH } from '../src/core/tween';
import { Field, raster, smooth, steps, columnsY, decimate } from '../src/core/field';
import { resolveTheme } from '../src/core/theme';
import { hex, mix, nearest } from '../src/core/util';
import { quantile } from '../src/types/cartesian';
import { squarify, waffleOwners, glyphWidth, GLYPHS } from '../src/types/grid';
import { toSVG } from '../src/dom/chart';
import { render, type Fixture } from '../../conformance/snapshot';

const fixtures: Fixture[] = JSON.parse(readFileSync(new URL('../../conformance/fixtures.json', import.meta.url), 'utf8'));
const fixture = (name: string) => fixtures.find(f => f.name === name)!;
const settled = (options: any, w = 480, h = 260) => { const c = new ChartCore(options); c.setSize(w, h); c.settle(); return c; };

describe('format', () => {
  it('compacts numbers', () => {
    expect([0, 7, 12.5, 999, 1234, 12345, 1.5e6, 2e9, 3.25e12, 0.0123, -4200].map(compact)).toEqual(['0', '7', '12.5', '999', '1.2k', '12k', '1.5M', '2B', '3.3T', '0.012', '-4.2k']);
  });
  it('groups, bytes and durations', () => {
    expect(grouped(1234567.891)).toBe('1,234,567.89');
    expect(grouped(-1200)).toBe('-1,200');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(3 * 1024 ** 3)).toBe('3.0 GB'.replace('.0', ''));
    expect(duration(450)).toBe('450ms');
    expect(duration(90e3)).toBe('1.5m');
    expect(makeFormat('currency')(-1500)).toBe('-$1.5k');
    expect(makeFormat('percent')(45)).toBe('45%');
  });
  it('rejects unknown formats', () => { expect(() => makeFormat('nope')).toThrow(/unknown format/); });
  it('counts with the precision of the target', () => { expect(roundLike(41.98765, 42.5)).toBe(42); expect(roundLike(3.14159, 3)).toBe(3); });
  it('labels time at the granularity of the span (UTC)', () => {
    const t = Date.UTC(2026, 2, 14, 9, 5, 7);
    expect(timeLabel(t, 60e3)).toBe('09:05:07');
    expect(timeLabel(t, 86400e3)).toBe('09:05');
    expect(timeLabel(t, 30 * 86400e3)).toBe('Mar 14');
    expect(timeLabel(t, 400 * 86400e3)).toBe('Mar 2026');
    expect(timeLabel(t, 4000 * 86400e3)).toBe('2026');
  });
});

describe('ticks', () => {
  it('picks round steps covering the range', () => {
    expect(niceTicks(0, 97, 4)).toMatchObject({ min: 0, max: 100, step: 20 });
    expect(niceTicks(-3.2, 7.9, 5).ticks).toEqual([-4, -2, 0, 2, 4, 6, 8]);
    expect(niceTicks(5, 5, 4).ticks.length).toBeGreaterThan(1);
  });
  it('log and time ticks', () => {
    expect(logTicks(0.2, 3.7).ticks).toEqual([0, 1, 2, 3, 4]);
    const t = timeTicks(Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1), 6);
    expect(t.map(v => new Date(v).getUTCMonth())).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('data inference', () => {
  it('accepts rows, numbers and columns', () => {
    expect(rowsOf([3, 5])).toEqual([{ value: 3 }, { value: 5 }]);
    expect(rowsOf({ a: [1, 2], b: [3, 4] })).toEqual([{ a: 1, b: 3 }, { a: 2, b: 4 }]);
  });
  it('infers x and every numeric y; detects time and number x', () => {
    const w = wide(rowsOf([{ m: 'Jan', a: 1, b: 2 }, { m: 'Feb', a: 3, b: 4 }]), {});
    expect(w.names).toEqual(['a', 'b']);
    expect(w.labels).toEqual(['Jan', 'Feb']);
    expect(w.xKind).toBe('category');
    expect(wide(rowsOf([{ d: '2026-01-01', v: 1 }, { d: '2026-01-02', v: 2 }]), {}).xKind).toBe('time');
    expect(wide(rowsOf([{ v: 1 }, { v: 2 }]), { x: (_r: any, i: number) => i * 10 }).xKind).toBe('number');
  });
  it('splits long data with by', () => {
    const w = wide(rowsOf([{ x: 'a', s: 'p', v: 1 }, { x: 'a', s: 'q', v: 2 }, { x: 'b', s: 'p', v: 3 }]), { by: 's', y: 'v' });
    expect(w.names).toEqual(['p', 'q']);
    expect(w.values[1][1]).toBeNaN();
    expect(w.values[0]).toEqual([1, 3]);
  });
  it('sorts categories', () => {
    expect(categories(rowsOf([{ k: 'a', v: 1 }, { k: 'b', v: 3 }]), { sort: 'desc' }).labels).toEqual(['b', 'a']);
  });
});

describe('tween and keyed joins', () => {
  it('eases any model and seeds new rows', () => {
    const st = { active: false, seedPrev: false };
    const s = approach(zero({ a: [0, 0] }), { a: [10, 20], b: 4 }, 0.5, st);
    expect(s).toEqual({ a: [5, 10], b: 2 });
    expect(st.active).toBe(true);
    const live = approach([1, 2], [1, 2, 9], 0, { active: false, seedPrev: true });
    expect(live[2]).toBe(2); // enters from its left neighbour
  });
  it('snaps very long arrays', () => {
    const big = Array.from({ length: SNAP_LENGTH + 1 }, (_, i) => i);
    expect(approach([], big, 0.1, { active: false, seedPrev: false })[100]).toBe(100);
  });
  it('re-orders shown values by key', () => {
    const shown: any = { v: [1, 2, 3], s: [[1, 2, 3]] };
    remap(shown, ['v', 's'], ['a', 'b', 'c'], ['c', 'a', 'x']);
    expect(shown.v.slice(0, 2)).toEqual([3, 1]);
    expect(shown.v[2]).toBeUndefined();
    expect(shown.s[0].slice(0, 2)).toEqual([3, 1]);
  });
  it('moves a re-sorted bar with its label', () => {
    const c = settled({ type: 'bar', data: [{ k: 'a', v: 1 }, { k: 'b', v: 5 }] });
    c.update({ data: [{ k: 'b', v: 5 }, { k: 'a', v: 1 }] });
    const p = c.parts[0];
    expect(p.shown!.s[0]).toEqual([5, 1]); // values travelled with their keys
    expect(p.shown!.px).toEqual([1, 0]);   // and start at their old positions
    expect(p.model.px).toEqual([0, 1]);
  });
});

describe('field and rasterisers', () => {
  it('plots with the later-layer-wins rule', () => {
    const f = new Field(4, 4), g = raster(f, 6);
    g.plot(1, 1, 0.8, [255, 0, 0]);
    g.plot(1, 1, 0.3, [0, 255, 0]); // faint: keeps the stronger colour
    expect([...f.col.slice(f.at(1, 1) * 3, f.at(1, 1) * 3 + 3)]).toEqual([255, 0, 0]);
    g.plot(1, 1, 0.6, [0, 0, 255]); // solid enough: takes over
    expect(f.col[f.at(1, 1) * 3 + 2]).toBe(255);
    expect(f.cov[f.at(1, 1)]).toBeCloseTo(0.8);
  });
  it('rect coverage is the area overlap', () => {
    const f = new Field(4, 4), g = raster(f, 6);
    g.rect(0.5, 0, 2, 1, [1, 2, 3]);
    expect(f.cov[f.at(0, 0)]).toBeCloseTo(0.5);
    expect(f.cov[f.at(1, 0)]).toBeCloseTo(1);
  });
  it('lines are continuous and break at gaps', () => {
    const f = new Field(20, 10), g = raster(f, 6);
    g.line([0.5, 2, 19.5, 8], 1, [9, 9, 9]);
    for (let c = 1; c < 19; c++) { let any = false; for (let r = 0; r < 10; r++) any ||= f.cov[f.at(c, r)] > 0.5; expect(any).toBe(true); }
    const h = new Field(10, 4), gh = raster(h, 6);
    gh.line([0.5, 2, 3.5, 2, NaN, NaN, 6.5, 2, 9.5, 2], 1, [9, 9, 9]);
    expect(h.cov[h.at(5, 2)]).toBeLessThan(0.2);
  });
  it('sector, polygon and disc fill', () => {
    const f = new Field(20, 20), g = raster(f, 6);
    g.sector(10, 10, 0, 8, 0, Math.PI, 0, () => [1, 1, 1]);
    expect(f.cov[f.at(14, 10)]).toBeGreaterThan(0.9); // right half (clockwise from 12)
    expect(f.cov[f.at(5, 10)]).toBe(0);
    g.polygon([0, 0, 4, 0, 0, 4], [2, 2, 2], 1);
    expect(f.cov[f.at(0, 0)]).toBe(1);
    g.disc(16, 16, 2, [3, 3, 3]);
    expect(f.cov[f.at(16, 16)]).toBe(1);
  });
  it('smooth never overshoots; steps and columns', () => {
    const p = smooth([0, 1, 2, 3], [0, 10, 0, 10], 8);
    for (let i = 1; i < p.length; i += 2) { expect(p[i]).toBeGreaterThanOrEqual(0); expect(p[i]).toBeLessThanOrEqual(10); }
    expect(steps([0, 2], [1, 3])).toEqual([0, 1, 1, 1, 1, 3, 2, 3]);
    expect(columnsY([0, 0, 4, 4], 4)[1]).toBeCloseTo(1.5);
  });
  it('M4 decimation keeps extremes and bounds the output', () => {
    const xs = Array.from({ length: 100000 }, (_, i) => (i / 100000) * 50), ys = xs.map((_, i) => (i === 54321 ? 999 : Math.sin(i)));
    const idx = decimate(xs, ys, 50);
    expect(idx.length).toBeLessThanOrEqual(50 * 4 + 4);
    expect(idx.some(i => ys[i] === 999)).toBe(true);
    expect(idx.every((v, k) => k === 0 || v > idx[k - 1])).toBe(true); // ascending, no repeats
  });
});

describe('types', () => {
  it('registers every schema type', () => {
    expect(new Set(registeredTypes())).toEqual(new Set(CHART_TYPES));
  });
  it.each(fixtures.map(f => [f.name, f] as const))('%s renders, labels and answers tooltips', (_name, f) => {
    const c = render(f);
    expect(c.litTiles()).toBeGreaterThan(40);
    const ids = c.ids();
    expect(ids.length).toBeGreaterThan(0);
    const hit = c.tip(ids[0]);
    expect(hit).not.toBeNull();
    expect(hit!.rows.length).toBeGreaterThan(0);
    const [ax, ay] = c.anchor(ids[0]);
    expect(Number.isFinite(ax) && Number.isFinite(ay)).toBe(true);
    expect(c.summary()).toMatch(/chart/);
  });
  it('quartiles and outliers', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const c = render(fixture('boxplot'));
    expect(c.parts[0].fixed.stats[0].out.length).toBeGreaterThan(0);
  });
  it('waterfall running totals', () => {
    const c = render(fixture('waterfall'));
    expect(c.parts[0].fixed.v1).toEqual([100, 140, 125, 95, 95]);
    expect(c.parts[0].fixed.kind).toEqual(['up', 'up', 'down', 'down', 'total']);
  });
  it('waffle and treemap layouts conserve the whole', () => {
    expect(waffleOwners([42, 26, 18, 9, 5], 100).length).toBe(100);
    expect(waffleOwners([1, 1, 1], 100).filter(o => o === 0).length).toBe(34);
    const rects = squarify([[0, 6], [1, 6], [2, 4], [3, 3], [4, 2], [5, 2], [6, 1]], 0, 0, 6, 4);
    expect(rects.reduce((s, r) => s + r[3] * r[4], 0)).toBeCloseTo(24);
  });
  it('the stat glyph font covers every formatted character', () => {
    for (const s of ['1,284', '$1.5k', '-42%', '3.2M', '12:30', '1/2', '450ms', '1.5h', '2d', '+7', '9.9B', '1T', '3G', '1 KB']) for (const ch of s) expect(GLYPHS[ch], ch).toBeDefined();
    expect(glyphWidth('10')).toBe(5 + 1 + 5);
  });
  it('heatmap goes diverging when data crosses zero', () => {
    expect(render(fixture('heatmap')).parts[0].fixed.diverging).toBe(false);
    expect(render(fixture('heatmap-diverging')).parts[0].fixed.diverging).toBe(true);
  });
  it('percent stacks sum to 100', () => {
    const v = render(fixture('area-percent')).parts[0].fixed.vals;
    expect(v[0][3] + v[1][3] + v[2][3]).toBeCloseTo(100);
  });
  it('combo series move to their own part and axis', () => {
    const c = render(fixture('combo'));
    expect(c.parts.map(p => p.opts.type)).toEqual(['bar', 'line']);
    expect(c.dom.right).toBeDefined();
    expect(c.out.labelsY.some(l => l.side === 'right')).toBe(true);
  });
  it('log axis ticks are powers of ten', () => {
    expect(render(fixture('line-log')).out.labelsY.map(l => l.text)).toEqual(['1', '10', '100', '1k', '10k']);
  });
});

describe('interaction state', () => {
  it('picks the nearest index and the slice under the pointer', () => {
    const c = render(fixture('bar'));
    const g = c.grid!;
    const x = g.ox + g.cols * g.cell * (2.5 / 6);
    expect(c.pick(x, g.oy + 10)).toBe(2);
    const p = render(fixture('pie'));
    const pg = p.grid!, cx = pg.ox + (pg.cols * pg.cell) / 2, cy = pg.oy + (pg.rows * pg.cell) / 2;
    expect(p.pick(cx + 20, cy - 40)).toBe(0); // first slice starts at 12 o'clock, clockwise
    expect(p.pick(5, 5)).toBe(-1);
  });
  it('hidden series animate out and leave the legend marked', () => {
    const c = render(fixture('bar-grouped'));
    c.toggle('south');
    c.settle();
    expect(c.legend().find(l => l.name === 'south')!.hidden).toBe(true);
    expect(c.parts[0].model.s[1].every((v: number) => v === 0)).toBe(true);
  });
  it('focus dims every other series', () => {
    const c = render(fixture('bar-grouped'));
    const before = c.colors.get('north')!;
    c.setFocus('south');
    expect(c.colors.get('north')).not.toEqual(before);
    expect(c.colors.get('south')).toEqual(c.theme.palette[1]);
  });
  it('zoom narrows the domain to the visible rows', () => {
    const c = render(fixture('line-time'));
    const full = c.dom.left!.ticks.max;
    c.setView(0, 0.1);
    c.settle();
    expect(c.view).toEqual([0, 0.1]);
    expect(c.selection(0, c.grid!.cols)!.indices[1]).toBeLessThan(10);
    expect(c.dom.left!.ticks.max).toBeLessThanOrEqual(full);
  });
  it('live window drops old rows and scrolls at constant speed', () => {
    const c = new ChartCore({ type: 'line', data: [], window: 10 });
    c.setSize(300, 120);
    for (let i = 0; i < 15; i++) c.push([{ value: i }], 1000 + i * 500);
    expect(c.rows.length).toBe(10);
    expect(c.dropped).toBe(5);
    expect(c.pushEvery).toBeCloseTo(0.5, 1);
    const off = c.off;
    c.frame(10000, 0.1);
    expect(c.off).toBeLessThan(off);
  });
  it('patch merges into the newest row', () => {
    const c = settled({ type: 'candlestick', data: fixture('candlestick').options.data });
    c.patch({ close: 999 });
    expect(c.rows[c.rows.length - 1].close).toBe(999);
    expect(c.rows[c.rows.length - 1].open).toBeDefined();
  });
  it('settles: the frame loop reports idle', () => {
    const c = new ChartCore(fixture('line').options);
    c.setSize(480, 260);
    let t = 0, frames = 0;
    while (c.frame(t, 1 / 60) && frames < 2000) { t += 1000 / 60; frames++; }
    expect(frames).toBeLessThan(400);
    expect(c.frame(t, 1 / 60)).toBe(false);
  });
  it('reduced motion snaps', () => {
    const c = new ChartCore(fixture('bar').options, { reducedMotion: true });
    c.setSize(480, 260);
    expect(c.frame(0, 1 / 60)).toBe(false);
    expect(c.litTiles()).toBeGreaterThan(100);
  });
});

describe('themes and options', () => {
  it('resolves themes and custom tokens', () => {
    expect(resolveTheme('light').bg).toEqual(hex('#F7F5EF'));
    expect(resolveTheme({ base: 'light', palette: ['#ff0000'] }).palette[0]).toEqual([255, 0, 0]);
    expect(resolveTheme('auto', true).name).toBe('light');
    expect(() => resolveTheme('neon')).toThrow();
  });
  it('custom colours and series colour overrides', () => {
    const c = render(fixture('custom-colors'));
    expect(c.colors.get('north')).toEqual([255, 0, 102]);
    const s = settled({ type: 'line', data: fixture('line').options.data, series: { south: { color: '#010203' } } });
    expect(s.colors.get('south')).toEqual([1, 2, 3]);
  });
  it('validates options with helpful errors', () => {
    expect(() => new ChartCore({ data: [] })).toThrow(/type is required/);
    expect(() => new ChartCore({ type: 'sankey' })).toThrow(/unknown chart type "sankey"/);
    expect(() => settled({ type: 'line', data: [1, 2], cell: -1 })).toThrow(/cell/);
  });
  it('cell size changes the resolution', () => {
    expect(render(fixture('fine')).grid!.cols).toBeGreaterThan(render(fixture('line')).grid!.cols * 1.8);
    expect(render(fixture('chunky')).grid!.cell).toBe(12);
  });
  it('util helpers', () => {
    expect(mix([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
    expect(nearest(5, i => i * 2, 5.2)).toBe(3);
  });
});

describe('export', () => {
  it('SVG has one rect per lit tile and the labels as text', () => {
    const c = render(fixture('bar'));
    const svg = toSVG(c);
    const lit = Array.from(c.size).filter(v => v >= 0.02).length;
    expect((svg.match(/<rect /g) || []).length).toBe(lit + 3);
    expect(svg).toContain('>Jan<');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

describe('regressions', () => {
  it('an empty histogram builds and settles', () => {
    const c = new ChartCore({ type: 'histogram', data: [] });
    c.setSize(300, 150);
    expect(() => c.settle()).not.toThrow();
  });
  it('a range band and its first series get different colours', () => {
    const c = new ChartCore({ type: 'range', data: [{ x: 1, from: 1, to: 3, mean: 2 }, { x: 2, from: 2, to: 4, mean: 3 }], x: 'x', y: 'mean' });
    const f = (c as any).primary.fixed;
    expect(f.bandColor).not.toEqual(f.colors[0]);
  });
});
