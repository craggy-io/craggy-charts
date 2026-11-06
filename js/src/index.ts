// craggy-charts: tile-rendered charts. `chart(target, options)` is the whole API.
export { Chart, chart, setRenderer, rendererKind, toSVG } from './dom/chart';
export type { ChartEvent, PointEvent, SelectEvent, ZoomEvent, LegendEvent } from './dom/chart';
export { awakeCount } from './dom/scheduler';
export { WebGLRenderer } from './render/webgl';
export { Canvas2DRenderer } from './render/canvas2d';
export type { TileRenderer, TileShape } from './render/tiles';
export * from './core/index';
