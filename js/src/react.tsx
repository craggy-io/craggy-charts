// React / Preact wrapper: props are the options object, passed straight through.
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { Chart as CraggyChart, type PointEvent, type SelectEvent, type ZoomEvent, type LegendEvent } from './dom/chart';
import type { ChartOptions } from './generated/options';

export interface ChartProps extends ChartOptions {
  className?: string;
  style?: CSSProperties;
  onHover?: (p: PointEvent | null) => void;
  onClick?: (p: PointEvent) => void;
  onSelect?: (s: SelectEvent) => void;
  onZoom?: (z: ZoomEvent) => void;
  onLegend?: (l: LegendEvent) => void;
}

const EVENTS = { onHover: 'hover', onClick: 'click', onSelect: 'select', onZoom: 'zoom', onLegend: 'legend' } as const;

/** `<Chart type="area" data={rows} stack />`. The ref is the underlying chart (push, patch, toImage...). */
export const Chart = forwardRef<CraggyChart | null, ChartProps>(function Chart(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<CraggyChart | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const { className, style, onHover, onClick, onSelect, onZoom, onLegend, ...options } = props;

  useEffect(() => {
    const c = new CraggyChart(host.current!, options as ChartOptions);
    for (const [prop, ev] of Object.entries(EVENTS)) c.on(ev as any, (e: any) => (handlers.current as any)[prop]?.(e));
    inst.current = c;
    return () => { c.destroy(); inst.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    inst.current?.update(options as ChartOptions);
  });

  useImperativeHandle(ref, () => inst.current!, []);
  return <div ref={host} className={className} style={{ width: '100%', height: '100%', ...style }} />;
});

export default Chart;
export type { PointEvent, SelectEvent, ZoomEvent, LegendEvent };
