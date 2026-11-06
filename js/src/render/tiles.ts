// What every tile renderer needs: the core's springs and grid, plus the tile shape.
import type { ChartCore } from '../core/chart-core';
import type { RGB } from '../core/model-types';
import { TOKENS } from '../generated/tokens';

export interface TileShape { gap: number; round: number }

export const tileShape = (opts: any): TileShape => ({
  gap: opts.gap ?? TOKENS.tile.gap,
  round: opts.round ?? TOKENS.tile.radius,
});

/** Draws the tile field of a core into a 2D context (device pixels; the context is unscaled). */
export interface TileRenderer {
  readonly kind: 'webgl2' | 'canvas2d';
  draw(out: CanvasRenderingContext2D, core: ChartCore, dpr: number, shape: TileShape): void;
  /** Free per-chart resources. */
  release(core: ChartCore): void;
}

/** Lit tile colour with the pointer glow mixed in. */
export function glowColor(col: Float32Array, glow: Float32Array, i: number, snow: RGB): RGB {
  const g = glow[i] * 0.4, j = i * 3;
  return [col[j] + (snow[0] - col[j]) * g, col[j + 1] + (snow[1] - col[j + 1]) * g, col[j + 2] + (snow[2] - col[j + 2]) * g];
}
