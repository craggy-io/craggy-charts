// anywidget front end: the Python `Chart` widget's `options` trait drives a craggy-charts Chart.
// Bundled to craggy_charts/static/widget.js by python/build.mjs.
import { chart } from '../../js/src/index';

interface Model {
  get(name: string): any;
  on(event: string, fn: (...args: any[]) => void): void;
  off(event: string, fn: (...args: any[]) => void): void;
  send(content: any): void;
}

/** Events forwarded to Python, as plain JSON (rows can hold Dates). */
const EVENTS = ['click', 'select', 'zoom', 'legend'] as const;
const plain = (v: any) => JSON.parse(JSON.stringify(v ?? null));

function render({ model, el }: { model: Model; el: HTMLElement }) {
  el.style.height = (model.get('height') || 320) + 'px';
  const c = chart(el, model.get('options'));
  const onOptions = () => c.update(model.get('options'));
  const onHeight = () => { el.style.height = (model.get('height') || 320) + 'px'; };
  const onMsg = (msg: any) => {
    if (msg?.kind === 'push') c.push(...msg.rows);
    else if (msg?.kind === 'patch') c.patch(msg.row);
    else if (msg?.kind === 'highlight') c.highlight(msg.target);
    else if (msg?.kind === 'toggle') c.toggle(msg.name);
  };
  model.on('change:options', onOptions);
  model.on('change:height', onHeight);
  model.on('msg:custom', onMsg);
  for (const e of EVENTS) c.on(e as any, (p: any) => model.send({ event: e, payload: plain(p) }));
  return () => {
    model.off('change:options', onOptions);
    model.off('change:height', onHeight);
    model.off('msg:custom', onMsg);
    c.destroy();
  };
}

export default { render };
