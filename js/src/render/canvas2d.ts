// Canvas2D fallback: the unlit panel is cached as an image, lit tiles are batched into one Path2D per
// quantised colour, so a frame is a handful of fill calls however many tiles are lit.
import type { ChartCore } from '../core/chart-core';
import { glowColor, type TileRenderer, type TileShape } from './tiles';

interface Panel { key: string; canvas: HTMLCanvasElement | OffscreenCanvas }

const makeCanvas = (w: number, h: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function roundRect(p: Path2D | Ctx2D, x: number, y: number, s: number, r: number) {
  if (r <= 0.25 || !('roundRect' in p)) { p.rect(x, y, s, s); return; }
  (p as any).roundRect(x, y, s, s, r);
}

export class Canvas2DRenderer implements TileRenderer {
  readonly kind = 'canvas2d' as const;
  private panels = new WeakMap<ChartCore, Panel>();

  release(core: ChartCore) { this.panels.delete(core); }

  private panel(core: ChartCore, dpr: number, shape: TileShape) {
    const g = core.grid!, th = core.theme;
    const key = [g.cols, g.rows, g.cell, dpr, shape.gap, shape.round, th.unlit.join()].join('|');
    let p = this.panels.get(core);
    if (p && p.key === key) return p.canvas;
    const cs = g.cell * dpr, full = cs * (1 - shape.gap), off = (cs - full) / 2, r = cs * shape.round;
    const canvas = makeCanvas(Math.max(1, Math.ceil(g.cols * cs)), Math.max(1, Math.ceil(g.rows * cs)));
    const c = canvas.getContext('2d') as Ctx2D;
    c.fillStyle = `rgb(${th.unlit.join(',')})`;
    c.beginPath();
    for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) roundRect(c, col * cs + off, row * cs + off, full, r);
    c.fill();
    this.panels.set(core, { key, canvas });
    return canvas;
  }

  draw(out: CanvasRenderingContext2D, core: ChartCore, dpr: number, shape: TileShape) {
    const g = core.grid!, f = core.field!;
    if (!g || !f) return;
    const cs = g.cell * dpr, X0 = Math.round(g.ox * dpr), Y0 = Math.round(g.oy * dpr), full = cs * (1 - shape.gap), rFull = cs * shape.round;
    out.drawImage(this.panel(core, dpr, shape) as CanvasImageSource, X0, Y0);
    const { size, col, glow } = core, snow = core.theme.snow, grid = core.theme.grid;
    const batches = new Map<number, Path2D>();
    const n = f.cols * f.rows;
    for (let i = 0; i < n; i++) {
      const s = size[i], gl = glow[i];
      if (s < 0.02 && gl < 0.02) continue;
      const c = i % f.cols, r = (i / f.cols) | 0;
      let rgb;
      let side = full * Math.min(1.25, s);
      if (s < 0.02) { rgb = grid; side = full * gl * 0.9; } // glow on an unlit tile
      else rgb = gl > 0.01 ? glowColor(col, glow, i, snow) : [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]];
      const key = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
      let p = batches.get(key);
      if (!p) { p = new Path2D(); batches.set(key, p); }
      const x = X0 + c * cs + (cs - side) / 2, y = Y0 + r * cs + (cs - side) / 2;
      roundRect(p, x, y, side, Math.min(rFull, side / 2));
    }
    for (const [key, p] of batches) {
      out.fillStyle = `rgb(${((key >> 10) & 31) * 8.226 | 0},${((key >> 5) & 31) * 8.226 | 0},${(key & 31) * 8.226 | 0})`;
      out.fill(p);
    }
  }
}
