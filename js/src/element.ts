// <craggy-chart> Web Component: attributes and properties map to options.
//   <craggy-chart type="bar" src="/api/week.json" x="day"></craggy-chart>
// Attributes are parsed as JSON when they look like JSON (numbers, booleans, arrays, objects).
import { Chart } from './dom/chart';
import { OPTION_KEYS } from './generated/options';
import type { ChartOptions } from './generated/options';

const parse = (v: string | null): any => {
  if (v == null) return undefined;
  if (v === '') return true;
  const t = v.trim();
  if (/^(-?\d|true$|false$|null$|\[|\{|")/.test(t)) { try { return JSON.parse(t); } catch { /* plain string */ } }
  return v;
};
const attrName = (k: string) => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const BaseElement: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as any) : HTMLElement;

export class CraggyChartElement extends BaseElement {
  static get observedAttributes() { return [...OPTION_KEYS.map(attrName), 'src']; }
  chart: Chart | null = null;
  private props: Partial<ChartOptions> = {};
  private fetched: any = undefined;
  private loading = 0;

  /** Every option, as a property: el.options = { type: 'line', data }. */
  get options(): Partial<ChartOptions> { return { ...this.fromAttributes(), ...this.props }; }
  set options(o: Partial<ChartOptions>) { this.props = { ...o }; this.sync(); }

  get data() { return this.options.data; }
  set data(d: any) { this.props = { ...this.props, data: d }; this.sync(); }

  connectedCallback() {
    if (!this.style.display) this.style.display = 'block';
    this.sync();
    const src = this.getAttribute('src');
    if (src && this.fetched === undefined) this.load(src);
  }

  disconnectedCallback() { this.chart?.destroy(); this.chart = null; }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value) return;
    if (name === 'src') { if (value && this.isConnected) this.load(value); return; }
    this.sync();
  }

  push(...rows: any[]) { this.chart?.push(...rows); return this; }
  patch(row: any) { this.chart?.patch(row); return this; }

  private fromAttributes(): Partial<ChartOptions> {
    const o: any = {};
    for (const k of OPTION_KEYS) { const v = parse(this.getAttribute(attrName(k))); if (v !== undefined) o[k] = v; }
    if (this.fetched !== undefined && o.data === undefined) o.data = this.fetched;
    return o;
  }

  private async load(src: string) {
    const ticket = ++this.loading;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`craggy-charts: ${src} returned ${res.status}`);
    const json = await res.json();
    if (ticket !== this.loading) return;
    this.fetched = json;
    this.sync();
  }

  private sync() {
    if (!this.isConnected) return;
    const o = this.options;
    if (!o.type) return;
    if (!this.chart) { this.chart = new Chart(this, { data: [], ...o } as ChartOptions); return; }
    this.chart.update(o);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('craggy-chart')) customElements.define('craggy-chart', CraggyChartElement);
