// The text layer: axis labels and type texts, drawn crisp on top of the tiles. Text is never tiled
// (apart from the stat type's numbers, which the core draws as tiles).
import type { ChartCore } from '../core/chart-core';
import type { RGB, TextItem } from '../core/model-types';
import { css } from '../core/util';
import { TOKENS } from '../generated/tokens';

export const FONT = TOKENS.font;

function colorOf(core: ChartCore, c: TextItem['color']): string {
  if (c === 'textHi') return css(core.theme.textHi);
  if (c == null || c === 'text') return css(core.theme.text);
  return css(c as RGB);
}

/** Draw every label of a core's last frame. The context is in device pixels. */
export function drawText(out: CanvasRenderingContext2D, core: ChartCore, dpr: number) {
  const g = core.grid;
  if (!g) return;
  out.save();
  out.scale(dpr, dpr);
  out.textBaseline = 'middle';
  out.font = `400 10px ${FONT}`;
  out.fillStyle = css(core.theme.text);
  out.textAlign = 'center';
  const below = g.oy + g.rows * g.cell + 11;
  for (const l of core.out.labelsX) out.fillText(l.text, l.x, below);
  for (const l of core.out.labelsY) {
    const left = l.side !== 'right';
    out.textAlign = left ? 'right' : 'left';
    out.fillText(l.text, left ? g.ox - 7 : g.ox + g.cols * g.cell + 7, l.y);
  }
  for (const t of core.out.texts) drawItem(out, core, t);
  out.restore();
}

function drawItem(out: CanvasRenderingContext2D, core: ChartCore, t: TextItem) {
  const size = t.size ?? 10;
  out.font = `${t.weight ?? 400} ${size}px ${FONT}`;
  out.textAlign = t.align ?? 'center';
  out.textBaseline = t.baseline ?? 'middle';
  out.globalAlpha = t.alpha ?? 1;
  out.save();
  out.translate(t.x, t.y);
  if (t.rotate) out.rotate((t.rotate * Math.PI) / 180);
  if (t.bg) {
    const w = out.measureText(t.text).width, padX = 4, h = size + 6;
    const x0 = t.align === 'left' ? -padX : t.align === 'right' ? -w - padX : -w / 2 - padX;
    const y0 = t.baseline === 'top' ? -3 : t.baseline === 'bottom' ? -h + 3 : -h / 2;
    out.fillStyle = t.bg === 'tooltip' ? core.theme.tooltipBg : css(t.bg);
    out.beginPath();
    (out as any).roundRect ? (out as any).roundRect(x0, y0, w + padX * 2, h, 3) : out.rect(x0, y0, w + padX * 2, h);
    out.fill();
  }
  out.fillStyle = colorOf(core, t.color);
  out.fillText(t.text, 0, 0);
  out.restore();
  out.globalAlpha = 1;
}
