// The contract every chart type implements, and the context the core hands it.
import type { Field, Raster } from './field';
import type { Hit, Model, RGB, Row, TextItem, Theme, TipRow } from './model-types';

export interface Margin { l: number; r: number; t: number; b: number }

export interface Grid {
  /** CSS pixel size of the whole chart surface. */
  W: number; H: number;
  /** Tile size in CSS pixels, and the plot's tile counts. */
  cell: number; cols: number; rows: number;
  /** CSS pixel offset of the plot's top-left tile. */
  ox: number; oy: number;
}

export interface Out {
  labelsX: { x: number; text: string }[];
  labelsY: { y: number; text: string; side: 'left' | 'right' }[];
  texts: TextItem[];
}

/** What a type is handed while building its model and drawing. */
export interface Ctx {
  opts: any;
  rows: Row[];
  theme: Theme;
  format: (v: number) => string;
  hidden: Set<string>;
  /** Hovered or focused item id (-1 when none). */
  hover: number;
  grid: Grid;
  out: Out;
  now: number;
  colorOf: (name: string, i: number) => RGB;
  /** Cartesian only. Tile x of a row index (window / categories) or x value (continuous). */
  X: (v: number) => number;
  /** Tile x of row i using the model's position channel. */
  xAt: (m: Model, i: number) => number;
  /** Width of one category band in tiles. */
  band: number;
  /** Tile position along the value axis (y, or x for horizontal charts). */
  Y: (v: number, side?: 'left' | 'right') => number;
  /** Length of the value axis in tiles. */
  V: number;
  horizontal: boolean;
  /** True while a live chart is receiving data (drives the cursor pulse). */
  live: boolean;
  /** Whether row i is inside the zoomed view (for auto-scaling the value axis). */
  inView: (i: number) => boolean;
  /** Set by a type when something keeps moving (e.g. the live cursor pulse). */
  animating: boolean;
  /** Changes whenever positions, domains, the view or the grid change: geometry may be cached by it. */
  version: number;
  /** Value derived from rows + opts, computed once per rebuild (types call model() twice). */
  derive: <T>(key: string, opts: any, make: () => T) => T;
}

export interface Extent { lo: number; hi: number; side: 'left' | 'right'; zero?: boolean; pad?: boolean; percent?: boolean }

/** x information a cartesian type exposes so the core can map and label the x axis. */
export interface XInfo { kind: 'category' | 'number' | 'time'; labels: any[]; xs: number[]; keys: string[] }

export interface ChartTypeDef {
  kind: 'cartesian' | 'polar' | 'grid';
  /** Cartesian: categories are bands (bars) rather than points (lines). */
  band?: boolean;
  /** Draw x gridlines (scatter). */
  xGrid?: boolean;
  /** Pick by nearest point (scatter) instead of by x index. */
  freePick?: boolean;
  margin?(ctx: Ctx): Margin;
  model(ctx: Ctx): { model: Model; fixed: any };
  extents?(ctx: Ctx, fixed: any): Extent[];
  xinfo?(fixed: any): XInfo;
  /** Model fields whose last dimension is per row, re-ordered by key on update. */
  keyed?: string[];
  keys?(fixed: any): string[];
  seed?(shown: Model, model: Model): void;
  /** Rebuild the model when hover changes (slice lift, bar highlight that changes geometry). */
  hoverModel?: boolean;
  raster(ctx: Ctx, m: Model, fixed: any, g: Raster): void;
  /** Index-based cartesian tooltip rows for row i. */
  rowsAt?(ctx: Ctx, fixed: any, i: number): TipRow[];
  /** Free picking: item id under tile point (x, y), or -1. */
  pick?(ctx: Ctx, m: Model, fixed: any, x: number, y: number): number;
  /** Tooltip for an item id. */
  tip?(ctx: Ctx, m: Model, fixed: any, id: number): Hit | null;
  /** Keyboard order of item ids. */
  ids?(ctx: Ctx, fixed: any): number[];
  /** Tile point to anchor the tooltip of a focused id. */
  anchor?(ctx: Ctx, m: Model, fixed: any, id: number): [number, number];
  legend?(ctx: Ctx, fixed: any): { name: string; color: RGB }[];
  count?(fixed: any): number;
}

export type { Field };
