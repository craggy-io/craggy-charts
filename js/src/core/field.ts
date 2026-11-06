// The tile field and its rasteriser. Geometry is drawn as *coverage* per tile (0..1) plus a colour;
// coverage becomes tile size, which is how tiles anti-alias. Coordinates are in tiles, x to the
// right and y UP from the bottom of the plot.
import type { RGB } from './model-types';
import { clamp, overlap, TAU } from './util';

export class Field {
  readonly cov: Float32Array;
  readonly col: Float32Array;
  constructor(readonly cols: number, readonly rows: number) {
    this.cov = new Float32Array(cols * rows);
    this.col = new Float32Array(cols * rows * 3);
  }
  clear() { this.cov.fill(0); }
  /** Index of the tile at column c and row r (r counted from the bottom). */
  at(c: number, r: number) { return (this.rows - 1 - r) * this.cols + c; }
}

export type Pattern = 'solid' | 'checker' | 'stripe' | 'dots';
export type Paint = RGB | ((c: number, r: number) => RGB);

export interface Raster {
  readonly cols: number;
  readonly rows: number;
  /** Texture applied to everything drawn until reset (accessibility patterns). */
  pattern: Pattern;
  plot(c: number, r: number, cov: number, rgb: RGB): void;
  rect(x0: number, y0: number, x1: number, y1: number, paint: Paint, scale?: number): void;
  /** One tile column filled from `base` to `tip` (tile y), shaded along `ramp` from base to tip
   *  (t ** gamma). The fast path for area and band fills. */
  span(c: number, base: number, tip: number, ramp: RGB[], gamma?: number, scale?: number): void;
  line(pts: number[], width: number, rgb: RGB, scale?: number): void;
  disc(x: number, y: number, rad: number, rgb: RGB, scale?: number): void;
  polygon(pts: number[], rgb: RGB, cov: number): void;
  /** Annular sector, angles clockwise from 12 o'clock. `gap` is the space between neighbours in tiles. */
  sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, gap: number, paint: (d: number, rel: number) => RGB, scale?: number): void;
  hline(row: number, rgb: RGB, cov: number): void;
  vline(col: number, rgb: RGB, cov: number): void;
}

const MASKS: Record<Pattern, ((c: number, r: number) => number) | null> = {
  solid: null,
  checker: (c, r) => ((c + r) & 1 ? 0.3 : 1),
  stripe: (c, r) => ((c + r) % 3 === 0 ? 1 : 0.3),
  dots: (c, r) => ((c & 1) === 0 && (r & 1) === 0 ? 1 : 0.25),
};

export function raster(f: Field, cell: number): Raster {
  const { cols, rows, cov: tcov, col: tcol } = f;
  const dotted = cell <= 4 ? 2 : 1;
  // Scratch for line(): nearest distance per tile, stamped with a generation so it never needs clearing.
  const dmin = new Float64Array(cols * rows), stamp = new Uint32Array(cols * rows), touched = new Int32Array(cols * rows);
  let gen = 0;
  /** Write coverage + colour into tile i (pattern already applied). */
  const put = (i: number, cov: number, rgb: RGB) => {
    if (cov < tcov[i] && cov < 0.5) return; // later layers win once they are solid enough
    if (cov > tcov[i]) tcov[i] = cov > 1 ? 1 : cov;
    tcol[i * 3] = rgb[0]; tcol[i * 3 + 1] = rgb[1]; tcol[i * 3 + 2] = rgb[2];
  };
  const g: Raster = {
    cols, rows, pattern: 'solid',
    plot(c, r, cov, rgb) {
      if (c < 0 || r < 0 || c >= cols || r >= rows || !(cov > 0.01)) return;
      const mask = MASKS[g.pattern];
      put((rows - 1 - r) * cols + c, mask ? cov * mask(c, r) : cov, rgb);
    },
    span(c, base, tip, ramp, gamma = 1, scale = 1) {
      const a = Math.min(base, tip), b = Math.max(base, tip), len = tip - base;
      if (c < 0 || c >= cols || !(b - a > 0.01)) return;
      const r0 = Math.max(0, Math.floor(a)), r1 = Math.min(rows - 1, Math.ceil(b) - 1), last = ramp.length - 1, mask = MASKS[g.pattern];
      for (let r = r0; r <= r1; r++) {
        const cov = (Math.min(r + 1, b) - Math.max(r, a)) * scale;
        if (!(cov > 0.01)) continue;
        let t = (r + 0.5 - base) / len;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        put((rows - 1 - r) * cols + c, mask ? cov * mask(c, r) : cov, ramp[Math.round((gamma === 1 ? t : t ** gamma) * last)]);
      }
    },
    rect(x0, y0, x1, y1, paint, scale = 1) {
      if (x1 < x0) [x0, x1] = [x1, x0];
      if (y1 < y0) [y0, y1] = [y1, y0];
      if (!(x1 > x0) || !(y1 > y0)) return;
      const c0 = Math.max(0, Math.floor(x0)), c1 = Math.min(cols - 1, Math.ceil(x1) - 1);
      const r0 = Math.max(0, Math.floor(y0)), r1 = Math.min(rows - 1, Math.ceil(y1) - 1);
      const fn = typeof paint === 'function';
      for (let c = c0; c <= c1; c++) {
        const ox = overlap(c, c + 1, x0, x1);
        if (ox <= 0) continue;
        for (let r = r0; r <= r1; r++) g.plot(c, r, ox * overlap(r, r + 1, y0, y1) * scale, fn ? (paint as any)(c, r) : (paint as RGB));
      }
    },
    line(pts, width, rgb, scale = 1) {
      // Nearest-segment distance per tile (squared, no sqrt in the inner loop), then one plot per
      // touched tile. Same coverage as plotting every segment, at a fraction of the cost.
      const hw = Math.max(0.7, width / 2), reach = hw + 0.4, reach2 = reach * reach;
      gen++;
      let nt = 0;
      for (let p = 0; p + 3 < pts.length; p += 2) {
        const ax = pts[p], ay = pts[p + 1], bx = pts[p + 2], by = pts[p + 3];
        if (!Number.isFinite(ax + ay + bx + by)) continue; // gaps in the data break the line
        const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), c1 = Math.min(cols - 1, Math.floor(Math.max(ax, bx) + reach));
        const r0 = Math.max(0, Math.floor(Math.min(ay, by) - reach)), r1 = Math.min(rows - 1, Math.floor(Math.max(ay, by) + reach));
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
        for (let c = c0; c <= c1; c++) {
          const px = c + 0.5 - ax;
          for (let r = r0; r <= r1; r++) {
            const py = r + 0.5 - ay;
            let t = (px * dx + py * dy) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = px - dx * t, ey = py - dy * t, d2 = ex * ex + ey * ey;
            if (d2 >= reach2) continue;
            const i = (rows - 1 - r) * cols + c;
            if (stamp[i] !== gen) { stamp[i] = gen; dmin[i] = d2; touched[nt++] = i; }
            else if (d2 < dmin[i]) dmin[i] = d2;
          }
        }
      }
      for (let k = 0; k < nt; k++) {
        const i = touched[k];
        g.plot(i % cols, rows - 1 - ((i / cols) | 0), clamp((reach - Math.sqrt(dmin[i])) * 1.8) * scale, rgb);
      }
    },
    disc(x, y, rad, rgb, scale = 1) {
      if (!Number.isFinite(x + y + rad)) return;
      for (let c = Math.floor(x - rad - 1); c <= x + rad + 1; c++) for (let r = Math.floor(y - rad - 1); r <= y + rad + 1; r++) {
        g.plot(c, r, clamp(rad + 0.5 - Math.hypot(c + 0.5 - x, r + 0.5 - y)) * scale, rgb);
      }
    },
    polygon(pts, rgb, cov) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      for (let c = Math.max(0, Math.floor(x0)); c <= Math.min(cols - 1, x1); c++) for (let r = Math.max(0, Math.floor(y0)); r <= Math.min(rows - 1, y1); r++) {
        const px = c + 0.5, py = r + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
          const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) g.plot(c, r, cov, rgb);
      }
    },
    sector(cx, cy, r0, r1, a0, a1, gap, paint, scale = 1) {
      const span = a1 - a0;
      if (!(span > 0) || !(r1 > r0)) return;
      const full = span >= TAU - 1e-9, start = ((a0 % TAU) + TAU) % TAU;
      for (let c = Math.max(0, Math.floor(cx - r1 - 1)); c <= Math.min(cols - 1, cx + r1 + 1); c++) {
        for (let r = Math.max(0, Math.floor(cy - r1 - 1)); r <= Math.min(rows - 1, cy + r1 + 1); r++) {
          const dx = c + 0.5 - cx, dy = r + 0.5 - cy, d = Math.hypot(dx, dy);
          if (d > r1 + 1 || d < r0 - 1) continue;
          const radial = clamp(Math.min(d - r0, r1 - d) + 0.5);
          if (radial <= 0) continue;
          let rel = Math.atan2(dx, dy) - start;
          rel = ((rel % TAU) + TAU) % TAU;
          let ang = 1;
          if (!full) {
            if (rel > span) { const back = TAU - rel; if (back * d > 1) continue; rel = -back; }
            ang = clamp(Math.min(rel, span - rel) * Math.max(d, 0.5) - gap / 2 + 0.5);
          }
          const cov = Math.min(radial, ang) * scale;
          if (cov > 0.01) g.plot(c, r, cov, paint(d, clamp(rel / span)));
        }
      }
    },
    hline(row, rgb, cov) { for (let c = 0; c < cols; c += dotted) g.plot(c, row, cov, rgb); },
    vline(col, rgb, cov) { for (let r = 0; r < rows; r += dotted) g.plot(col, r, cov, rgb); },
  };
  return g;
}

/** Catmull-Rom through the points, clamped per segment so curves never overshoot the data. */
export function smooth(xs: number[], ys: number[], sub: number): number[] {
  const n = xs.length, out: number[] = [];
  if (n < 3 || sub <= 1) { for (let i = 0; i < n; i++) out.push(xs[i], ys[i]); return out; }
  for (let i = 0; i < n - 1; i++) {
    const p1 = ys[i], p2 = ys[i + 1];
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) { out.push(xs[i], p1); continue; }
    const p0 = Number.isFinite(ys[i - 1]) ? ys[i - 1] : p1, p3 = Number.isFinite(ys[i + 2]) ? ys[i + 2] : p2;
    const lo = Math.min(p1, p2), hi = Math.max(p1, p2);
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push(xs[i] + (xs[i + 1] - xs[i]) * t,
        clamp(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3), lo, hi));
    }
  }
  out.push(xs[n - 1], ys[n - 1]);
  return out;
}

/** Horizontal-then-vertical steps through the points. */
export function steps(xs: number[], ys: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i > 0) { const mid = (xs[i - 1] + xs[i]) / 2; out.push(mid, ys[i - 1], mid, ys[i]); }
    out.push(xs[i], ys[i]);
  }
  return out;
}

/** Height of a polyline at every tile column centre (NaN outside it or across gaps). */
export function columnsY(pts: number[], cols: number): Float64Array {
  const ys = new Float64Array(cols).fill(NaN);
  if (pts.length < 4) return ys;
  let j = 0;
  for (let c = 0; c < cols; c++) {
    const x = c + 0.5;
    if (x < pts[0] || x > pts[pts.length - 2]) continue;
    while (j + 3 < pts.length && pts[j + 2] < x) j += 2;
    const x0 = pts[j], y0 = pts[j + 1], x1 = pts[j + 2] ?? x0, y1 = pts[j + 3] ?? y0;
    ys[c] = y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1));
  }
  return ys;
}

/** M4 decimation: per tile column keep the first, min, max and last point, so a million points
 *  draw as about 4 × columns. `xs` are tile x positions (ascending). Returns the kept indices. */
export function decimate(xs: ArrayLike<number>, ys: ArrayLike<number>, cols: number): number[] {
  const out: number[] = [];
  const n = xs.length;
  let i = 0;
  while (i < n) {
    const c = Math.floor(xs[i]);
    const first = i;
    let last = i, mn = i, mx = i;
    while (i < n && Math.floor(xs[i]) === c) {
      if (ys[i] < ys[mn]) mn = i;
      if (ys[i] > ys[mx]) mx = i;
      last = i++;
    }
    const a = Math.min(mn, mx), b = Math.max(mn, mx);
    out.push(first);
    if (a !== first) out.push(a);
    if (b !== a && b !== first) out.push(b);
    if (last !== b && last !== first) out.push(last);
    if (c >= cols && out.length > 4) break;
  }
  return out;
}
