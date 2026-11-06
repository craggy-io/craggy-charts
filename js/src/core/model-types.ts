// Types shared by the core, the renderers and the generated option types.

export type RGB = [number, number, number];
export type Row = Record<string, any>;
export type Data = Row[] | number[] | Record<string, number[]>;
export type Channel = string | ((row: Row, index: number) => any);
export type FormatName = 'compact' | 'number' | 'percent' | 'currency' | 'bytes' | 'duration';

export interface AxisOptions {
  min?: number;
  max?: number;
  label?: string;
  format?: FormatName | ((v: number) => string);
  log?: boolean;
  ticks?: number;
}

export interface Annotation {
  /** Horizontal reference line at this value. */
  y?: number;
  /** Vertical reference line at this x value (category label, number or date). */
  x?: any;
  /** Band start / end; on the x axis unless axis: 'y'. */
  from?: any;
  to?: any;
  axis?: 'x' | 'y';
  label?: string;
  color?: string;
}

/** A data point as reported to events and tooltip functions. */
export interface ChartPoint {
  type: string;
  index: number;
  series?: string;
  label?: string;
  value?: number;
  row?: Row;
}

export interface ThemeTokens {
  bg: string; unlit: string; grid: string; fade: string; text: string; textHi: string; snow: string;
  up: string; down: string; tooltipBg: string; tooltipBorder: string;
  palette: string[]; terrain: string[]; diverging: string[];
}

/** Resolved theme: colours as RGB. */
export interface Theme {
  name: string;
  bg: RGB; unlit: RGB; grid: RGB; fade: RGB; text: RGB; textHi: RGB; snow: RGB; up: RGB; down: RGB;
  tooltipBg: string; tooltipBorder: string;
  palette: RGB[]; terrain: RGB[]; diverging: RGB[];
}

/** Text the renderer draws on top of the tiles. Positions in CSS pixels. */
export interface TextItem {
  x: number; y: number; text: string;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'middle' | 'bottom';
  size?: number; weight?: number;
  color?: RGB | 'text' | 'textHi';
  bg?: RGB | 'tooltip';
  alpha?: number;
  /** Rotation in degrees (axis titles). */
  rotate?: number;
}

export interface TipRow { color: RGB; name: string; value: string }
export interface Hit {
  index: number;
  title: string;
  rows: TipRow[];
  point: ChartPoint;
}

/** Numbers-only model, eased by the tween. Values are number | number[] | number[][]. */
export type Model = Record<string, any>;
