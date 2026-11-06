// ChartCore: the headless engine. Options + data in; a tile field, labels and hit testing out.
// No DOM: it runs the same in the browser, in Node (tests, conformance) and is mirrored in Dart.
import { TOKENS } from '../generated/tokens';
import type { ChartTypeDef, Ctx, Extent, Grid, Margin, Out, XInfo } from './types';
import type { Hit, Model, RGB, Row, Theme, TipRow } from './model-types';
import { Field, raster, type Raster } from './field';
import { approach, clone, remap, zero, type TweenState } from './tween';
import { rowsOf, wide } from './data';
import { makeFormat, labelText, timeLabel } from './format';
import { niceTicks, logTicks, timeTicks, type Ticks } from './ticks';
import { resolveTheme, seriesColors } from './theme';
import { clamp, ease, maxOf, mix, nearest } from './util';

/** At most ~2000 evenly spaced items, for measuring labels of huge series. */
const sample = <T>(a: T[]): T[] => (a.length <= 2000 ? a : a.filter((_, i) => i % Math.ceil(a.length / 2000) === 0));

const REGISTRY: Record<string, ChartTypeDef> = {};
export function registerType(name: string, def: ChartTypeDef) { REGISTRY[name] = def; }
export function typeDef(name: string): ChartTypeDef {
  const d = REGISTRY[name];
  if (!d) throw new Error(`craggy-charts: unknown chart type "${name}" (${Object.keys(REGISTRY).join(', ')})`);
  return d;
}
export const registeredTypes = () => Object.keys(REGISTRY);

/** Average advance of a 10px JetBrains Mono glyph; used for deterministic label layout. */
export const CHAR_W = 6.02;
const SPRING = TOKENS.springs;

interface Part { def: ChartTypeDef; opts: any; rows: Row[]; model: Model; fixed: any; shown: Model | null; keys: string[] | null; derived: Map<string, { opts: any; v: any }> }
interface Domain { ticks: Ticks; log: boolean }

/** Data x range per xs array (rebuilt with the model, so identity is a safe key). */
const dataRanges = new WeakMap<number[], [number, number]>();

/** One fixed-rate spring step for every tile (size towards coverage, colour towards target).
 *  A free function over typed arrays so the hot loop stays monomorphic. Returns true while moving. */
function stepSprings(size: Float32Array, vel: Float32Array, col: Float32Array, glow: Float32Array, tc: Float32Array, tcol: Float32Array, steps: number): boolean {
  const K = SPRING.stiffness, D = SPRING.damping, CK = 1 - (1 - SPRING.colour) ** steps, GK = 0.9 ** steps;
  let moving = false;
  for (let i = 0, n = tc.length; i < n; i++) {
    const t = tc[i], j = i * 3;
    let s = size[i], v = vel[i];
    // Settled tiles were snapped exactly onto their target, so they cost three compares.
    if (s === t && v === 0 && glow[i] === 0 && (t === 0 || (col[j] === tcol[j] && col[j + 1] === tcol[j + 1] && col[j + 2] === tcol[j + 2]))) continue;
    for (let k = 0; k < steps; k++) { v = (v + (t - s) * K) * D; s += v; }
    if (Math.abs(v) > 1e-3 || Math.abs(t - s) > 3e-3) moving = true;
    else { s = t; v = 0; } // close enough: land exactly so the tile goes idle
    size[i] = s; vel[i] = v;
    if (t > 0) {
      const q = s < 0.05 ? 1 : CK;
      col[j] += (tcol[j] - col[j]) * q; col[j + 1] += (tcol[j + 1] - col[j + 1]) * q; col[j + 2] += (tcol[j + 2] - col[j + 2]) * q;
      if (Math.abs(tcol[j] - col[j]) + Math.abs(tcol[j + 1] - col[j + 1]) + Math.abs(tcol[j + 2] - col[j + 2]) > 3) moving = true;
      else { col[j] = tcol[j]; col[j + 1] = tcol[j + 1]; col[j + 2] = tcol[j + 2]; }
    }
    if (glow[i] > 0.01) { glow[i] *= GK; moving = true; } else glow[i] = 0;
  }
  return moving;
}

/** Rows that have no shown position yet (new, or first build) start at their target position, so
 *  they grow in place instead of sliding in from x = 0. */
function seedPositions(shown: Model, model: Model, fresh: boolean) {
  const t = model.px, s = shown.px;
  if (!Array.isArray(t)) return;
  if (fresh || !Array.isArray(s)) { shown.px = t.slice(); return; }
  for (let i = 0; i < t.length; i++) if (typeof s[i] !== 'number') s[i] = t[i];
}

export interface CoreEnv { prefersLight?: boolean; reducedMotion?: boolean }

export class ChartCore {
  opts: any = {};
  rows: Row[] = [];
  parts: Part[] = [];
  theme!: Theme;
  format: (v: number) => string = String;
  hidden = new Set<string>();
  hover = -1;
  /** Highlighted series or category: every other one is dimmed. */
  focus: string | null = null;
  grid: Grid | null = null;
  field: Field | null = null;
  out: Out = { labelsX: [], labelsY: [], texts: [] };
  // tile springs
  size = new Float32Array(0); vel = new Float32Array(0); col = new Float32Array(0); glow = new Float32Array(0);
  // live data
  off = 0; dropped = 0; pushEvery = 1; lastPush = 0;
  /** Bumped whenever positions, domains, the view or the grid change; types cache geometry by it. */
  private version = 0;
  born = NaN; // time of the first frame; NaN until then
  // axes
  dom: { left?: Domain; right?: Domain } = {};
  domS: Record<string, number> = {};
  view: [number, number] = [0, 1]; viewY: [number, number] = [0, 1];
  viewS = [0, 1, 0, 1];
  brush: [number, number] | null = null;
  colors = new Map<string, RGB>();
  env: CoreEnv;
  private g: Raster | null = null;
  private needsLayout = true;

  constructor(options: any, env: CoreEnv = {}) {
    this.env = env;
    this.update(options);
  }

  get primary(): Part { return this.parts.find(p => p.def.kind === 'cartesian') || this.parts[0]; }
  get kind() { return typeDef(this.opts.type).kind; }
  get cartesian() { return this.kind === 'cartesian'; }
  get horizontal() { return !!this.opts.horizontal && this.cartesian; }
  get live() { return !!this.opts.window; }
  get cellSize(): number {
    const c = this.opts.cell ?? 'normal';
    const v = typeof c === 'string' ? (TOKENS.cells as any)[c] : c;
    if (!(v > 0)) throw new Error(`craggy-charts: cell must be 'fine', 'normal', 'chunky' or a positive number`);
    return v;
  }

  // ── Options and data ──────────────────────────────────────────────────────────────────

  update(next: any) {
    if (!next || typeof next !== 'object') throw new Error('craggy-charts: options must be an object');
    const prevType = this.opts.type;
    const layoutKeys = ['type', 'cell', 'horizontal', 'axes', 'layers', 'series', 'yAxis', 'xAxis', 'theme'];
    if (layoutKeys.some(k => k in next)) this.needsLayout = true;
    this.opts = { ...this.opts, ...next };
    if (!this.opts.type) throw new Error('craggy-charts: options.type is required');
    if ('data' in next) this.rows = rowsOf(next.data);
    this.theme = resolveTheme(this.opts.theme, this.env.prefersLight);
    this.format = makeFormat(this.opts.format);
    this.ticks.clear();
    if (prevType && prevType !== this.opts.type) { for (const p of this.parts) p.shown = null; this.hover = -1; this.view = [0, 1]; }
    if ('series' in next) for (const [n, s] of Object.entries<any>(next.series || {})) if (s && s.hidden) this.hidden.add(n);
    this.rebuild();
  }

  /** Append rows. With `window`, the oldest rows scroll off the left edge at constant speed. */
  push(rows: Row[], now: number) {
    if (this.lastPush > 0) this.pushEvery = this.pushEvery * 0.6 + clamp((now - this.lastPush) / 1000, 0.05, 5) * 0.4;
    this.lastPush = now;
    for (const r of rows) {
      this.rows.push(typeof r === 'number' ? { value: r } : r);
      if (this.live) this.off += 1;
      if (this.live && this.rows.length > this.opts.window) { this.rows.shift(); this.dropped++; }
    }
    this.rebuild();
  }

  /** Replace (merge into) the newest row, e.g. a live tick inside the current candle. */
  patch(row: Row) {
    if (!this.rows.length) return this.push([row], 0);
    this.rows[this.rows.length - 1] = { ...this.rows[this.rows.length - 1], ...row };
    this.rebuild();
  }

  /** Highlight one series or category (null clears). */
  setFocus(name: string | null) { if (name === this.focus) return; this.focus = name; this.rebuild(); }

  toggle(name: string) { this.hidden.has(name) ? this.hidden.delete(name) : this.hidden.add(name); this.rebuild(); }

  setHover(id: number) {
    if (id === this.hover) return false;
    this.hover = id;
    if (this.parts.some(p => p.def.hoverModel)) this.rebuild();
    return true;
  }

  // Split options into parts: the main chart, series drawn as another type, and explicit layers.
  private splitParts(): { def: ChartTypeDef; opts: any; rows: Row[] }[] {
    const o = this.opts, base = { ...o };
    delete base.layers;
    const parts: { def: ChartTypeDef; opts: any; rows: Row[] }[] = [];
    const overrides = Object.entries<any>(o.series || {}).filter(([, s]) => s && s.type && s.type !== o.type);
    if (overrides.length && typeDef(o.type).kind === 'cartesian') {
      const names = wide(this.rows, o).names;
      const moved = new Set(overrides.map(([n]) => n));
      parts.push({ def: typeDef(o.type), opts: { ...base, y: names.filter(n => !moved.has(n)) }, rows: this.rows });
      const byType = new Map<string, string[]>();
      for (const [n, s] of overrides) byType.set(s.type, [...(byType.get(s.type) || []), n]);
      for (const [t, ys] of byType) parts.push({ def: typeDef(t), opts: { ...base, type: t, y: ys, stack: false }, rows: this.rows });
    } else parts.push({ def: typeDef(o.type), opts: base, rows: this.rows });
    for (const layer of o.layers || []) {
      const lo = { ...base, stack: false, ...layer };
      parts.push({ def: typeDef(lo.type || o.type), opts: lo, rows: layer.data ? rowsOf(layer.data) : this.rows });
    }
    return parts;
  }

  rebuild() {
    this.version++;
    const specs = this.splitParts();
    const prev = this.parts;
    const reuse = prev.length === specs.length && prev.every((p, i) => p.def === specs[i].def);
    this.colors.clear();
    const parts: Part[] = specs.map((s, i) => ({ ...s, model: {}, fixed: null, shown: reuse ? prev[i].shown : null, keys: reuse ? prev[i].keys : null, derived: new Map() }));
    // Colours are assigned across all parts so a combo's series never share a colour.
    let k = 0;
    for (const p of parts) {
      const ctx = this.ctx(p);
      const built = p.def.model(ctx);
      p.model = built.model; p.fixed = built.fixed;
      // colorNames: every name that takes a palette colour (range's band is drawn but is not a series).
      const names: string[] = p.fixed ? p.fixed.colorNames || p.fixed.names || [] : [];
      for (const n of names) if (!this.colors.has(n)) this.colors.set(n, this.colorFor(n, k++));
    }
    if (this.focus && this.colors.has(this.focus)) for (const [n, c] of this.colors) if (n !== this.focus) this.colors.set(n, mix(c, this.theme.fade, 0.68));
    for (const p of parts) {
      const ctx = this.ctx(p);
      const built = p.def.model(ctx); // second pass now that colours are fixed
      p.model = built.model; p.fixed = built.fixed;
      const keys = p.def.keys ? p.def.keys(p.fixed) : null;
      if (p.shown && p.def.keyed && keys && p.keys) remap(p.shown, p.def.keyed, p.keys, keys);
      p.keys = keys;
      const fresh = !p.shown;
      if (fresh) {
        p.shown = zero(p.model);
        if (p.def.seed) p.def.seed(p.shown!, p.model);
      }
      seedPositions(p.shown!, p.model, fresh);
    }
    this.parts = parts;
    if (this.needsLayout && this.grid) this.layout(this.grid.W, this.grid.H);
    else this.domains();
  }

  private colorFor(name: string, i: number): RGB {
    const c = this.opts.colors, s = this.opts.series || {};
    const v = (s[name] && s[name].color) || (Array.isArray(c) ? c[i] : c && c[name]);
    return v ? seriesColors({ colors: [v] }, [name], this.theme)[0] : this.theme.palette[i % this.theme.palette.length];
  }

  // ── Layout ────────────────────────────────────────────────────────────────────────────

  setSize(W: number, H: number) {
    if (this.grid && this.grid.W === W && this.grid.H === H && !this.needsLayout) return;
    this.layout(W, H);
  }

  private layout(W: number, H: number) {
    this.version++;
    this.needsLayout = false;
    const cell = this.cellSize, o = this.opts, axes = o.axes !== false;
    let m: Margin;
    if (!this.cartesian) {
      const d = this.parts[0].def;
      m = d.margin ? d.margin(this.ctxFor(this.parts[0], { W, H, cell, cols: 1, rows: 1, ox: 0, oy: 0 })) : { l: 4, r: 4, t: 4, b: 4 };
    } else if (!axes) m = { l: 1, r: 1, t: 1, b: 1 };
    else {
      const hz = this.horizontal;
      m = { l: 0, r: 8, t: 8, b: 20 + (o.xAxis?.label ? 16 : 0) };
      // Provisional grid so the domain (and so the label widths) can be known.
      this.grid = { W, H, cell, cols: Math.max(1, Math.floor((W - 48) / cell)), rows: Math.max(1, Math.floor((H - m.t - m.b) / cell)), ox: 40, oy: m.t };
      this.domains();
      const widest = (d?: Domain) => (d ? maxOf(d.ticks.ticks.map(t => this.tickText(t, d).length), 0) : 0);
      if (hz) {
        const pf = this.primary.def.xinfo?.(this.primary.fixed);
        const longest = pf ? maxOf(sample(pf.labels).map(l => Math.min(12, labelText(l).length)), 0) : 4;
        m.l = Math.max(24, longest * CHAR_W + 14);
        m.r = o.labels !== false ? 46 : 10;
      } else {
        m.l = Math.max(24, widest(this.dom.left) * CHAR_W + 14) + (o.yAxis?.label ? 16 : 0);
        m.r = this.dom.right ? widest(this.dom.right) * CHAR_W + 16 : 10;
      }
    }
    const cols = Math.max(1, Math.floor((W - m.l - m.r) / cell)), rows = Math.max(1, Math.floor((H - m.t - m.b) / cell));
    const centred = !this.cartesian;
    const ox = m.l + ((W - m.l - m.r) - cols * cell) * (centred ? 0.5 : 0);
    const oy = m.t + ((H - m.t - m.b) - rows * cell) * (centred ? 0.5 : 1);
    this.grid = { W, H, cell, cols, rows, ox, oy };
    if (!this.field || this.field.cols !== cols || this.field.rows !== rows) {
      const n = cols * rows;
      this.field = new Field(cols, rows);
      this.size = new Float32Array(n); this.vel = new Float32Array(n); this.col = new Float32Array(n * 3); this.glow = new Float32Array(n);
    }
    this.g = raster(this.field, cell);
    this.domains();
  }

  // ── Axes ──────────────────────────────────────────────────────────────────────────────

  private ticks = new Map<string, string>();

  /** Label text, memoised: labels are re-laid out every frame while a chart moves. */
  private memo(key: string, make: () => string) {
    let s = this.ticks.get(key);
    if (s === undefined) {
      s = make();
      if (this.ticks.size > 2048) this.ticks.clear();
      this.ticks.set(key, s);
    }
    return s;
  }

  private tickText(t: number, d: Domain) {
    return this.memo((d.log ? 'L' : 'Y') + t, () => {
      const f = this.opts.yAxis?.format ? makeFormat(this.opts.yAxis.format) : this.format;
      return d.log ? f(10 ** t) : f(t);
    });
  }

  /** Index or x-value visibility under the current zoom, for auto-scaling the y axis. */
  inView = (i: number): boolean => {
    if (this.view[0] <= 0 && this.view[1] >= 1) return true;
    const p = this.primary, xi = p.def.xinfo?.(p.fixed);
    if (!xi) return true;
    const n = xi.labels.length, cont = xi.kind !== 'category' && !this.live && !this.parts.some(q => q.def.band);
    let u: number;
    if (cont) { const [a, b] = this.xRange(xi); u = (xi.xs[i] - a) / (b - a || 1); }
    else u = n < 2 ? 0.5 : i / (n - 1);
    const pad = 1 / Math.max(1, n);
    return u >= this.view[0] - pad && u <= this.view[1] + pad;
  };

  private xRange(xi: XInfo): [number, number] {
    let r = dataRanges.get(xi.xs);
    if (!r) {
      let a = Infinity, b = -Infinity;
      const xs = xi.xs;
      for (let i = 0; i < xs.length; i++) { const v = xs[i]; if (Number.isFinite(v)) { if (v < a) a = v; if (v > b) b = v; } }
      if (!Number.isFinite(a)) r = [0, 1];
      else if (xi.kind === 'number') { const t = niceTicks(a, b, 5); r = [t.min, t.max]; }
      else r = [a, b];
      dataRanges.set(xi.xs, r);
    }
    const ax = this.opts.xAxis || {};
    return [ax.min ?? r[0], ax.max ?? r[1]];
  }

  private domains() {
    this.dom = {};
    if (!this.cartesian || !this.grid) return;
    const o = this.opts, ya = o.yAxis || {};
    const acc: Record<string, { lo: number; hi: number; zero: boolean; pad: boolean; percent: boolean } | undefined> = {};
    for (const p of this.parts) {
      if (p.def.kind !== 'cartesian' || !p.def.extents) continue;
      for (const e of p.def.extents(this.ctx(p), p.fixed) as Extent[]) {
        if (!Number.isFinite(e.lo) || !Number.isFinite(e.hi)) continue;
        const a = acc[e.side] || (acc[e.side] = { lo: Infinity, hi: -Infinity, zero: false, pad: false, percent: false });
        a.lo = Math.min(a.lo, e.lo); a.hi = Math.max(a.hi, e.hi);
        a.zero ||= !!e.zero; a.pad ||= !!e.pad; a.percent ||= !!e.percent;
      }
    }
    const V = this.horizontal ? this.grid.cols : this.grid.rows;
    const count = ya.ticks ?? Math.max(2, Math.round((V * this.grid.cell) / (this.horizontal ? 90 : 48)));
    for (const side of ['left', 'right'] as const) {
      const a = acc[side];
      if (!a) continue;
      let lo = a.lo, hi = a.hi;
      if (a.percent) { lo = 0; hi = 100; }
      if (ya.log && side === 'left') {
        lo = Math.log10(Math.max(1e-12, lo > 0 ? lo : Math.min(1, hi))); hi = Math.log10(Math.max(1e-12, hi));
        if (ya.min != null) lo = Math.log10(ya.min);
        if (ya.max != null) hi = Math.log10(ya.max);
        this.dom[side] = { ticks: logTicks(lo, hi), log: true };
        continue;
      }
      if (a.zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
      if (a.pad && !a.percent) { const p = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1; if (!(a.zero && lo === 0)) lo -= p; hi += p * 0.75; }
      if (side === 'left') { if (ya.min != null) lo = ya.min; if (ya.max != null) hi = ya.max; }
      const t = niceTicks(lo, hi, count);
      if (side === 'left' && ya.min != null) t.min = ya.min;
      if (side === 'left' && ya.max != null) t.max = ya.max;
      this.dom[side] = { ticks: t, log: false };
    }
    if (!this.dom.left && this.dom.right) { this.dom.left = this.dom.right; }
  }

  // ── Contexts ──────────────────────────────────────────────────────────────────────────

  private ctx(p: Part): Ctx { return this.ctxFor(p, this.grid || { W: 300, H: 150, cell: this.cellSize, cols: 40, rows: 20, ox: 0, oy: 0 }); }

  private ctxFor(p: Part, grid: Grid): Ctx {
    const self = this, o = p.opts, hz = this.horizontal;
    const L = hz ? grid.rows : grid.cols, V = hz ? grid.cols : grid.rows;
    const [v0, v1, w0, w1] = this.viewS;
    const span = v1 - v0 || 1, yspan = w1 - w0 || 1;
    let X = (v: number) => v, band = 1;
    let xAt = (_m: Model, i: number) => X(i);
    const prim = this.primary;
    const xi = prim && prim.fixed && prim.def.xinfo ? prim.def.xinfo(prim.fixed) : null;
    if (this.cartesian && xi) {
      const n = Math.max(1, xi.labels.length), w = this.opts.window, bandMode = this.parts.some(q => q.def.band);
      if (w) {
        // w - 1 slots are visible; the oldest row is half-way out on the left, the newest is in the last slot.
        if (bandMode) { const bw = 1 / (w - 1); X = i => (((i - n + w - 1.5 + this.off) * bw - v0) / span) * L; band = (L * bw) / span; }
        else { X = i => 0.5 + (((i - n + w - 2 + this.off) / (w - 2) - v0) / span) * (L - 1); band = (L - 1) / (w - 2) / span; }
      } else if (xi.kind !== 'category' && !bandMode) {
        const [a, b] = this.xRange(xi);
        X = v => 0.5 + (((v - a) / (b - a || 1) - v0) / span) * (L - 1);
        band = (L - 1) / Math.max(1, n - 1) / span;
        xAt = (m, i) => X(m.px ? m.px[i] : xi.xs[i]);
      } else if (bandMode) {
        X = i => (((i + 0.5) / n - v0) / span) * L; band = L / n / span;
        xAt = (m, i) => X(m.px ? m.px[i] : i);
      } else {
        X = i => 0.5 + (((n < 2 ? 0.5 : i / (n - 1)) - v0) / span) * (L - 1); band = (L - 1) / Math.max(1, n - 1) / span;
        xAt = (m, i) => X(m.px ? m.px[i] : i);
      }
      if (w) xAt = (_m, i) => X(i);
    }
    const Y = (v: number, side: 'left' | 'right' = 'left') => {
      const d = this.dom[side] || this.dom.left;
      if (!d) return 0;
      const key = side === 'right' && this.dom.right ? 'r' : 'l';
      const lo = this.domS[key + '0'], hi = this.domS[key + '1'];
      const t = d.log ? Math.log10(Math.max(1e-12, v)) : v;
      return (((t - lo) / (hi - lo || 1) - w0) / yspan) * V;
    };
    const ctx: Ctx = {
      opts: o, rows: p.rows, theme: this.theme, format: makeFormat(o.format), hidden: this.hidden, hover: this.hover,
      grid, out: this.out, now: 0,
      colorOf: (name, i) => self.colors.get(name) || self.theme.palette[i % self.theme.palette.length],
      X, xAt, band, Y, V, horizontal: hz, live: false, animating: false, inView: this.inView, version: this.version,
      derive: (key, opts, make) => {
        const hit = p.derived.get(key);
        if (hit && hit.opts === opts) return hit.v;
        const v = make();
        p.derived.set(key, { opts, v });
        return v;
      },
    };
    return ctx;
  }

  // ── Frame ─────────────────────────────────────────────────────────────────────────────

  get still() { return this.opts.animate === false || !!this.env.reducedMotion; }

  /** Advance one frame. Returns true while anything is still moving. */
  frame(now: number, dt: number): boolean {
    if (!this.grid || !this.field || !this.g) return false;
    const still = this.still;
    const speed = typeof this.opts.animate === 'object' && this.opts.animate.speed ? this.opts.animate.speed : 1;
    const k = still ? 1 : 1 - Math.exp(-dt * 7 * speed);
    const st: TweenState = { active: false, seedPrev: this.live };
    for (const p of this.parts) p.shown = approach(p.shown, p.model, k, st);
    const target = this.domTarget();
    for (const key in target) if (!(key in this.domS)) this.domS[key] = target[key]; // first frame: no axis zoom-in
    this.domS = approach(this.domS, target, k, st);
    this.viewS = approach(this.viewS, [this.view[0], this.view[1], this.viewY[0], this.viewY[1]], still ? 1 : 1 - Math.exp(-dt * 14), st);
    if (this.off > 0) {
      this.off = still ? 0 : Math.max(0, this.off - (dt * (1 + Math.max(0, this.off - 1) * 2)) / this.pushEvery);
      st.active = true;
    }
    if (st.active) this.version++;
    if (Number.isNaN(this.born)) this.born = now;
    const animating = this.paint(now);
    const reveal = still ? 1 : clamp((now - this.born) / 1100);
    if (reveal < 1) { this.mask(ease(reveal) * 1.25); st.active = true; }
    const moving = this.springs(dt, still);
    return st.active || moving || animating;
  }

  /** Jump straight to the final state (tests, conformance, export, reduced motion). */
  settle(now = 0) {
    if (!this.grid || !this.field) return;
    this.version++;
    for (const p of this.parts) p.shown = clone(p.model);
    this.domS = this.domTarget();
    this.viewS = [this.view[0], this.view[1], this.viewY[0], this.viewY[1]];
    this.off = 0;
    this.born = -Infinity; // entrance already complete
    this.paint(now);
    this.size.set(this.field.cov);
    this.vel.fill(0);
    this.col.set(this.field.col);
    this.glow.fill(0);
  }

  private domTarget() {
    const t: Record<string, number> = {};
    if (this.dom.left) { t.l0 = this.dom.left.ticks.min; t.l1 = this.dom.left.ticks.max; }
    if (this.dom.right) { t.r0 = this.dom.right.ticks.min; t.r1 = this.dom.right.ticks.max; }
    return t;
  }

  /** Rasterise every part (and axes, annotations, crosshair, brush) into the field. */
  private paint(now: number): boolean {
    const f = this.field!, g = this.g!;
    f.clear();
    this.out.labelsX.length = 0; this.out.labelsY.length = 0; this.out.texts.length = 0;
    let animating = false;
    const ctxs = this.parts.map(p => this.ctx(p)), pctx = ctxs[this.parts.indexOf(this.primary)];
    if (this.cartesian) this.drawAxes(g, pctx);
    const pulse = this.live && this.lastPush > 0 && now - this.lastPush < 4000 * this.pushEvery;
    for (const p of this.parts) {
      const ctx = ctxs[this.parts.indexOf(p)];
      ctx.now = now;
      ctx.live = pulse;
      g.pattern = 'solid';
      p.def.raster(ctx, p.shown!, p.fixed, g);
      g.pattern = 'solid';
      animating ||= ctx.animating;
    }
    if (this.cartesian) this.drawAnnotations(g, true, pctx);
    if (this.brush) this.drawBrush();
    return animating;
  }

  private drawAxes(g: Raster, ctx: Ctx) {
    const o = this.opts, grid = this.grid!, th = this.theme, hz = this.horizontal;
    const axes = o.axes !== false;
    this.drawAnnotations(g, false, ctx);
    for (const side of ['left', 'right'] as const) {
      const d = this.dom[side];
      if (!d || !axes || (side === 'right' && d === this.dom.left)) continue;
      const len = hz ? grid.cols : grid.rows;
      for (const t of d.ticks.ticks) {
        const p = ctx.Y(d.log ? 10 ** t : t, side);
        if (p < -0.01 || p > len + 0.01) continue;
        const at = Math.min(len - 1, Math.floor(p));
        const text = this.tickText(t, d);
        if (hz) { g.vline(at, th.grid, 0.2); this.out.labelsX.push({ x: grid.ox + (at + 0.5) * grid.cell, text }); }
        else {
          if (side === 'left') g.hline(at, th.grid, 0.2);
          this.out.labelsY.push({ y: grid.oy + (grid.rows - at - 0.5) * grid.cell, text, side });
        }
      }
    }
    // Crosshair under the data.
    const prim = this.primary;
    if (this.hover >= 0 && !prim.def.freePick && prim.fixed && this.hover < (prim.def.xinfo?.(prim.fixed).labels.length ?? 0)) {
      const x = Math.floor(ctx.xAt(prim.shown!, this.hover));
      if (hz) g.hline(grid.rows - 1 - x, th.grid, 0.45); else g.vline(x, th.grid, 0.45);
    }
    if (!axes) return;
    const xi = prim.def.xinfo?.(prim.fixed);
    if (!xi || !xi.labels.length) return;
    const n = xi.labels.length, L = hz ? grid.rows : grid.cols;
    const cont = xi.kind !== 'category' && !this.live && !this.parts.some(q => q.def.band);
    if (prim.def.xGrid || cont) {
      const [a, b] = this.xRange(xi), [v0, v1] = this.viewS;
      const lo = a + (b - a) * v0, hi = a + (b - a) * v1;
      const ticks = xi.kind === 'time' ? timeTicks(lo, hi, Math.max(2, Math.round((L * grid.cell) / 110))) : niceTicks(lo, hi, Math.max(2, Math.round((L * grid.cell) / 80))).ticks;
      const fx = o.xAxis?.format ? makeFormat(o.xAxis.format) : xi.kind === 'time' ? (t: number) => timeLabel(t, hi - lo) : this.format;
      let last = -Infinity;
      for (const t of ticks) {
        const x = ctx.X(t);
        if (x < 0 || x > L) continue;
        if (prim.def.xGrid) g.vline(Math.min(L - 1, Math.floor(x)), th.grid, 0.16);
        const px = grid.ox + x * grid.cell, text = this.memo('X' + xi.kind + (hi - lo) + ':' + t, () => fx(t)), half = (text.length * CHAR_W) / 2;
        if (px - half < last + 8 || px + half > grid.W || px - half < 0) continue;
        this.out.labelsX.push({ x: px, text });
        last = px + half;
      }
    } else {
      const spacing = Math.abs(ctx.band) * grid.cell || 1e9;
      const short = (l: any) => this.memo('C' + (typeof l === 'number' ? l : String(l)), () => { const s = labelText(l); return s.length > 12 ? s.slice(0, 11) + '…' : s; });
      const widest = maxOf(sample(xi.labels).map(l => short(l).length), 1) * CHAR_W + 12;
      const stride = hz ? Math.max(1, Math.ceil(14 / spacing)) : Math.max(1, Math.ceil(widest / spacing));
      for (let i = 0; i < n; i++) {
        if ((i + this.dropped) % stride) continue;
        const pos = ctx.xAt(prim.shown!, i), text = short(xi.labels[i]);
        if (hz) {
          if (pos < -0.5 || pos > L + 0.5) continue;
          this.out.labelsY.push({ y: grid.oy + pos * grid.cell, text, side: 'left' });
        } else {
          const px = grid.ox + pos * grid.cell, half = (text.length * CHAR_W) / 2;
          if (pos < -0.5 || pos > L + 0.5 || px + half > grid.W || px - half < 0) continue;
          this.out.labelsX.push({ x: px, text });
        }
      }
    }
    if (o.xAxis?.label) this.out.texts.push({ x: grid.ox + (grid.cols * grid.cell) / 2, y: grid.H - 6, text: o.xAxis.label, baseline: 'bottom', color: 'text' });
    if (o.yAxis?.label) this.out.texts.push({ x: 8, y: grid.oy + (grid.rows * grid.cell) / 2, text: o.yAxis.label, rotate: -90, color: 'text' } as any);
  }

  private drawAnnotations(g: Raster, lines: boolean, ctx: Ctx) {
    const list: any[] = this.opts.annotations || [];
    if (!list.length) return;
    const grid = this.grid!, th = this.theme, hz = this.horizontal;
    const prim = this.primary, xi = prim.def.xinfo?.(prim.fixed);
    const xOf = (v: any): number => {
      if (!xi) return NaN;
      if (typeof v === 'number' && xi.kind !== 'category') return ctx.X(v);
      if (xi.kind === 'time' && !this.live) return ctx.X(+new Date(v));
      const i = xi.labels.findIndex(l => l === v || labelText(l) === String(v));
      return i < 0 ? NaN : ctx.xAt(prim.shown!, i);
    };
    for (const a of list) {
      const rgb: RGB = a.color ? seriesColors({ colors: [a.color] }, ['a'], th)[0] : th.palette[0];
      const V = hz ? grid.cols : grid.rows, L = hz ? grid.rows : grid.cols;
      if (a.y != null && lines) {
        const p = Math.min(V - 1, Math.floor(ctx.Y(a.y)));
        if (p < 0) continue;
        if (hz) g.vline(p, rgb, 0.55); else g.hline(p, rgb, 0.55);
        if (a.label) this.out.texts.push(hz
          ? { x: grid.ox + (p + 0.5) * grid.cell + 4, y: grid.oy + 6, text: a.label, align: 'left', color: rgb, size: 10 }
          : { x: grid.ox + grid.cols * grid.cell - 2, y: grid.oy + (grid.rows - p - 1) * grid.cell - 7, text: a.label, align: 'right', color: rgb, size: 10 });
      } else if (a.x != null && lines) {
        const x = xOf(a.x);
        if (!(x >= 0 && x <= L)) continue;
        const c = Math.min(L - 1, Math.floor(x));
        if (hz) g.hline(grid.rows - 1 - c, rgb, 0.55); else g.vline(c, rgb, 0.55);
        if (a.label) this.out.texts.push({ x: grid.ox + (c + 1) * grid.cell + 3, y: grid.oy + 7, text: a.label, align: 'left', color: rgb, size: 10 });
      } else if (a.from != null && a.to != null && !lines) {
        const tint = mix(th.unlit, rgb, 0.35);
        if (a.axis === 'y') {
          const y0 = ctx.Y(a.from), y1 = ctx.Y(a.to);
          if (hz) g.rect(y0, 0, y1, grid.rows, tint, 0.3); else g.rect(0, y0, grid.cols, y1, tint, 0.3);
        } else {
          let x0 = xOf(a.from), x1 = xOf(a.to);
          if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
          const half = this.parts.some(q => q.def.band) ? ctx.band / 2 : 0;
          x0 -= half; x1 += half;
          if (hz) g.rect(0, grid.rows - x1, grid.cols, grid.rows - x0, tint, 0.3); else g.rect(x0, 0, x1, grid.rows, tint, 0.3);
        }
        if (a.label) this.out.texts.push({ x: grid.ox + 6, y: grid.oy + 8, text: a.label, align: 'left', color: rgb, size: 10 });
      }
    }
  }

  private drawBrush() {
    const f = this.field!, th = this.theme, [a, b] = this.brush!;
    const x0 = Math.max(0, Math.floor(Math.min(a, b))), x1 = Math.min(f.cols - 1, Math.floor(Math.max(a, b)));
    for (let c = x0; c <= x1; c++) for (let r = 0; r < f.rows; r++) {
      const i = r * f.cols + c;
      if (f.cov[i] < 0.12) { f.cov[i] = 0.3; f.col[i * 3] = th.grid[0]; f.col[i * 3 + 1] = th.grid[1]; f.col[i * 3 + 2] = th.grid[2]; }
      else { const m = mix([f.col[i * 3], f.col[i * 3 + 1], f.col[i * 3 + 2]], th.snow, 0.3); f.col[i * 3] = m[0]; f.col[i * 3 + 1] = m[1]; f.col[i * 3 + 2] = m[2]; }
    }
  }

  /** Entrance: tiles switch on in a sweep from bottom-left, like the terminal typing the chart in. */
  private mask(edge: number) {
    const f = this.field!, { cols, rows } = f;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ((c / cols) * 0.8 + ((rows - 1 - r) / rows) * 0.45 > edge) f.cov[r * cols + c] = 0;
  }

  /** Per-tile springs (the website's scroll-strip constants), stepped at a fixed 60Hz. */
  private springs(dt: number, still: boolean): boolean {
    const f = this.field!, { size, vel, col, glow } = this, n = f.cols * f.rows, tc = f.cov, tcol = f.col;
    if (still) {
      size.set(tc); vel.fill(0);
      for (let i = 0; i < n; i++) if (tc[i] > 0) { col[i * 3] = tcol[i * 3]; col[i * 3 + 1] = tcol[i * 3 + 1]; col[i * 3 + 2] = tcol[i * 3 + 2]; }
      glow.fill(0);
      return false;
    }
    return stepSprings(size, vel, col, glow, tc, tcol, Math.max(1, Math.min(4, Math.round(dt * SPRING.hz))));
  }

  // ── Picking, tooltips, keyboard ───────────────────────────────────────────────────────

  /** Tile coordinates (y up) of a CSS pixel point. */
  toTiles(px: number, py: number): [number, number] {
    const g = this.grid!;
    return [(px - g.ox) / g.cell, g.rows - (py - g.oy) / g.cell];
  }

  private indexBased() { return this.cartesian && !this.primary.def.freePick; }

  /** Item id under a CSS pixel point, or -1. */
  pick(px: number, py: number): number {
    if (!this.grid) return -1;
    const [x, y] = this.toTiles(px, py), g = this.grid;
    if (this.indexBased()) {
      const p = this.primary, xi = p.def.xinfo!(p.fixed), n = xi.labels.length;
      if (!n || x < -1 || y < -1 || x > g.cols + 1 || y > g.rows + 1) return -1;
      const ctx = this.ctx(p);
      return nearest(n, i => ctx.xAt(p.shown!, i), this.horizontal ? g.rows - y : x);
    }
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const p = this.parts[k];
      if (!p.def.pick) continue;
      const id = p.def.pick(this.ctx(p), p.shown!, p.fixed, x, y);
      if (id >= 0) return id + k * 1e7;
    }
    return -1;
  }

  /** Tooltip content for an item id. */
  tip(id: number): Hit | null {
    if (id < 0 || !this.parts.length) return null;
    if (this.indexBased()) {
      const p = this.primary, xi = p.def.xinfo!(p.fixed);
      if (id >= xi.labels.length) return null;
      const rows: TipRow[] = [];
      for (const q of this.parts) if (q.def.rowsAt) rows.push(...q.def.rowsAt(this.ctx(q), q.fixed, id));
      const label = labelText(xi.labels[id]);
      return { index: id, title: label, rows, point: { type: this.opts.type, index: id, label, row: p.rows[id], value: undefined } };
    }
    const k = Math.floor(id / 1e7), p = this.parts[k];
    return p && p.def.tip ? p.def.tip(this.ctx(p), p.shown!, p.fixed, id - k * 1e7) : null;
  }

  /** Item ids in keyboard order. */
  ids(): number[] {
    if (this.indexBased()) { const p = this.primary; return p.def.xinfo!(p.fixed).labels.map((_, i) => i); }
    const p = this.parts[0];
    return p.def.ids ? p.def.ids(this.ctx(p), p.fixed) : [];
  }

  /** CSS pixel point to anchor the tooltip of a (keyboard-)focused id. */
  anchor(id: number): [number, number] {
    const g = this.grid!;
    let x = g.cols / 2, y = g.rows / 2;
    if (this.indexBased()) {
      const p = this.primary, ctx = this.ctx(p);
      const pos = ctx.xAt(p.shown!, id);
      if (this.horizontal) { x = g.cols * 0.6; y = g.rows - pos; } else { x = pos; y = g.rows * 0.6; }
    } else {
      const k = Math.floor(id / 1e7), p = this.parts[k];
      if (p && p.def.anchor) [x, y] = p.def.anchor(this.ctx(p), p.shown!, p.fixed, id - k * 1e7);
    }
    return [g.ox + x * g.cell, g.oy + (g.rows - y) * g.cell];
  }

  legend(): { name: string; color: RGB; hidden: boolean }[] {
    const out: { name: string; color: RGB; hidden: boolean }[] = [], seen = new Set<string>();
    for (const p of this.parts) {
      if (!p.def.legend) continue;
      for (const it of p.def.legend(this.ctx(p), p.fixed)) {
        if (seen.has(it.name)) continue;
        seen.add(it.name);
        out.push({ ...it, hidden: this.hidden.has(it.name) });
      }
    }
    return out;
  }

  /** Data range of the x axis under the current view: index range for categories, values otherwise. */
  selection(x0: number, x1: number): { from: any; to: any; indices: [number, number] } | null {
    if (!this.cartesian) return null;
    const p = this.primary, xi = p.def.xinfo!(p.fixed), ctx = this.ctx(p), n = xi.labels.length;
    if (!n) return null;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const idx = xi.labels.map((_, i) => i).filter(i => { const x = ctx.xAt(p.shown!, i); return x >= lo - 0.5 && x <= hi + 0.5; });
    if (!idx.length) return null;
    const a = idx[0], b = idx[idx.length - 1];
    return { from: xi.labels[a], to: xi.labels[b], indices: [a, b] };
  }

  /** Zoom to a fraction of the full x range [v0, v1] (and optionally y). */
  setView(v0: number, v1: number, y0 = this.viewY[0], y1 = this.viewY[1]) {
    const p = this.primary, n = p.def.xinfo ? p.def.xinfo(p.fixed).labels.length : 2;
    const minSpan = Math.min(1, 2 / Math.max(2, n - 1));
    let a = clamp(Math.min(v0, v1)), b = clamp(Math.max(v0, v1));
    if (b - a < minSpan) { const c = (a + b) / 2; a = clamp(c - minSpan / 2, 0, 1 - minSpan); b = a + minSpan; }
    this.view = [a, b];
    this.viewY = [clamp(Math.min(y0, y1)), clamp(Math.max(y0, y1))];
    if (this.viewY[1] - this.viewY[0] < 0.02) this.viewY = [0, 1];
    this.domains();
  }

  /** Text summary for screen readers. */
  summary(): string {
    const t = this.opts.type, p = this.parts[0], names = this.legend().map(l => l.name);
    const n = p.def.xinfo ? p.def.xinfo(p.fixed).labels.length : p.def.count ? p.def.count(p.fixed) : this.rows.length;
    const title = this.opts.title ? `${this.opts.title}. ` : '';
    const what = `${t.replace(/([A-Z])/g, ' $1').toLowerCase()} chart`;
    const series = names.length ? `, ${names.length} ${this.cartesian ? 'series' : 'categories'}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}` : '';
    let range = '';
    if (this.dom.left) { const d = this.dom.left.ticks; range = `. Values from ${this.tickText(d.min, this.dom.left)} to ${this.tickText(d.max, this.dom.left)}`; }
    if (this.opts.value != null && typeof this.opts.value === 'number') range = `. Value ${this.format(this.opts.value)}`;
    return `${title}${what[0].toUpperCase()}${what.slice(1)}${series}${n ? `, ${n} ${this.cartesian ? 'points' : 'items'}` : ''}${range}.`;
  }

  /** Lit tile count; handy for tests. */
  litTiles(threshold = 0.05) { let n = 0; for (const v of this.size) if (v > threshold) n++; return n; }
}
