// The conformance artefact: a settled tile field plus every label, for one fixture.
// JS output is the reference; the Dart core must reproduce it (coverage and colour within ±1).
import { ChartCore } from '../js/src/core/index';

export interface Fixture { name: string; options: any; width: number; height: number; push?: any[] }
export interface Snapshot {
  name: string; cols: number; rows: number; cell: number; ox: number; oy: number;
  /** Two hex digits of coverage (×255) per tile, row-major from the top-left. */
  cov: string;
  /** Six hex digits of colour per tile whose coverage byte is non-zero, in tile order. */
  col: string;
  labelsX: { x: number; text: string }[];
  labelsY: { y: number; text: string; side: string }[];
  texts: { x: number; y: number; text: string }[];
}

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const r2 = (v: number) => Math.round(v * 100) / 100;

export function render(f: Fixture): ChartCore {
  const c = new ChartCore(f.options);
  c.setSize(f.width, f.height);
  for (const row of f.push || []) c.push([row], 1000);
  c.settle();
  return c;
}

export function snapshot(f: Fixture): Snapshot {
  const c = render(f), g = c.grid!, fl = c.field!;
  let cov = '', col = '';
  for (let i = 0; i < fl.cov.length; i++) {
    const b = hex2(fl.cov[i] * 255);
    cov += b;
    if (b !== '00') col += hex2(fl.col[i * 3]) + hex2(fl.col[i * 3 + 1]) + hex2(fl.col[i * 3 + 2]);
  }
  return {
    name: f.name, cols: g.cols, rows: g.rows, cell: g.cell, ox: r2(g.ox), oy: r2(g.oy), cov, col,
    labelsX: c.out.labelsX.map(l => ({ x: r2(l.x), text: l.text })),
    labelsY: c.out.labelsY.map(l => ({ y: r2(l.y), text: l.text, side: l.side })),
    texts: c.out.texts.map(t => ({ x: r2(t.x), y: r2(t.y), text: t.text })),
  };
}

/** Differences between two snapshots, empty when they conform. */
export function compare(a: Snapshot, b: Snapshot, tol = 1): string[] {
  const out: string[] = [];
  for (const k of ['cols', 'rows', 'cell'] as const) if (a[k] !== b[k]) out.push(`${k}: ${a[k]} vs ${b[k]}`);
  if (out.length) return out;
  if (Math.abs(a.ox - b.ox) > 0.02 || Math.abs(a.oy - b.oy) > 0.02) out.push(`origin: ${a.ox},${a.oy} vs ${b.ox},${b.oy}`);
  let bad = 0, colBad = 0, ia = 0, ib = 0;
  for (let i = 0; i < a.cov.length; i += 2) {
    const x = parseInt(a.cov.slice(i, i + 2), 16), y = parseInt(b.cov.slice(i, i + 2), 16);
    if (Math.abs(x - y) > tol) bad++;
    if (x && y) {
      for (let k = 0; k < 6; k += 2) if (Math.abs(parseInt(a.col.slice(ia + k, ia + k + 2), 16) - parseInt(b.col.slice(ib + k, ib + k + 2), 16)) > tol) { colBad++; break; }
    }
    if (x) ia += 6;
    if (y) ib += 6;
  }
  if (bad) out.push(`${bad} tiles differ in coverage`);
  if (colBad) out.push(`${colBad} tiles differ in colour`);
  const labels = (l: any[]) => l.map(v => `${v.text}@${Math.round((v.x ?? v.y) * 10) / 10}`).join(' | ');
  if (labels(a.labelsX) !== labels(b.labelsX)) out.push(`labelsX: ${labels(a.labelsX)} vs ${labels(b.labelsX)}`);
  if (labels(a.labelsY) !== labels(b.labelsY)) out.push(`labelsY: ${labels(a.labelsY)} vs ${labels(b.labelsY)}`);
  if (labels(a.texts) !== labels(b.texts)) out.push(`texts: ${labels(a.texts)} vs ${labels(b.texts)}`);
  return out;
}
