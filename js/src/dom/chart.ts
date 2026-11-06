// The browser chart: a ChartCore plus a canvas, the text layer, tooltip, legend, interaction and
// accessibility. Every chart shares one animation loop and one WebGL2 context.
import '../core/index';
import { ChartCore } from '../core/chart-core';
import type { ChartOptions } from '../generated/options';
import type { ChartPoint, Hit, Row } from '../core/model-types';
import { clamp, css } from '../core/util';
import { labelText } from '../core/format';
import { WebGLRenderer } from '../render/webgl';
import { Canvas2DRenderer } from '../render/canvas2d';
import { drawText, FONT } from '../render/text';
import { tileShape, type TileRenderer } from '../render/tiles';
import { wake, sleep, type Animated } from './scheduler';
import { injectStyles } from './style';

export type ChartEvent = 'hover' | 'click' | 'select' | 'zoom' | 'legend';
export interface PointEvent extends ChartPoint { title: string; rows: { name: string; value: string; color: string }[] }
export interface SelectEvent { from: any; to: any; indices: [number, number] }
export interface ZoomEvent { view: [number, number]; viewY: [number, number]; from: any; to: any }
export interface LegendEvent { name: string; hidden: boolean; hiddenAll: string[] }
type Handler = (e: any) => void;

// ── Shared renderer ────────────────────────────────────────────────────────────────────

let shared: TileRenderer | null = null;
let forced: 'webgl2' | 'canvas2d' | null = null;

/** Force a renderer for every chart (tests, debugging). */
export function setRenderer(kind: 'webgl2' | 'canvas2d' | null) { forced = kind; shared = null; }

function renderer(): TileRenderer {
  if (shared && !(shared instanceof WebGLRenderer && shared.lost)) return shared;
  shared = (forced !== 'canvas2d' && WebGLRenderer.create()) || new Canvas2DRenderer();
  return shared;
}

export const rendererKind = () => renderer().kind;

// ── Groups ─────────────────────────────────────────────────────────────────────────────

const groups = new Map<string, Set<Chart>>();

const media = (q: string) => (typeof matchMedia === 'function' ? matchMedia(q) : null);

export class Chart implements Animated {
  readonly el: HTMLElement;
  readonly core: ChartCore;
  readonly canvas: HTMLCanvasElement;
  visible = true;
  private ctx: CanvasRenderingContext2D;
  private tipEl: HTMLDivElement;
  private legendEl: HTMLDivElement;
  private headEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private plotEl: HTMLDivElement;
  private liveEl: HTMLDivElement;
  private tableEl: HTMLTableElement;
  private handlers = new Map<string, Set<Handler>>();
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private dpr = 1;
  private pointer: { x: number; y: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x0: number; px: number; py: number; view: [number, number]; viewY: [number, number]; moved: boolean; mode: 'brush' | 'pan' | 'scrub' } | null = null;
  private pinch: { d: number; view: [number, number]; cx: number } | null = null;
  private focusIndex = -1;
  private paused: Row[] = [];
  private legendKey = '';
  private a11yTimer = 0;
  private touchTimer = 0;
  private mqLight = media('(prefers-color-scheme: light)');
  private mqMotion = media('(prefers-reduced-motion: reduce)');
  private cleanup: (() => void)[] = [];
  private syncing = false;
  private destroyed = false;

  constructor(target: string | HTMLElement, options: ChartOptions) {
    const host = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
    if (!host) throw new Error(`craggy-charts: no element matches "${target}"`);
    injectStyles(host.getRootNode() instanceof ShadowRoot ? (host.getRootNode() as ShadowRoot) : document);
    this.core = new ChartCore(options, { prefersLight: !!this.mqLight?.matches, reducedMotion: !!this.mqMotion?.matches });

    const el = (this.el = document.createElement('div'));
    el.className = 'cc';
    el.setAttribute('role', 'figure');
    this.headEl = el.appendChild(document.createElement('div'));
    this.headEl.className = 'cc-head';
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'cc-legend';
    this.bodyEl = el.appendChild(document.createElement('div'));
    this.bodyEl.className = 'cc-body';
    this.plotEl = this.bodyEl.appendChild(document.createElement('div'));
    this.plotEl.className = 'cc-plot';
    this.canvas = this.plotEl.appendChild(document.createElement('canvas'));
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.tipEl = this.plotEl.appendChild(document.createElement('div'));
    this.tipEl.className = 'cc-tip';
    this.tipEl.setAttribute('aria-hidden', 'true');
    this.liveEl = el.appendChild(document.createElement('div'));
    this.liveEl.className = 'cc-sr';
    this.liveEl.setAttribute('aria-live', 'polite');
    this.tableEl = el.appendChild(document.createElement('table'));
    this.tableEl.className = 'cc-sr';
    host.appendChild(el);
    if (host.clientHeight === 0 && !el.style.height) el.style.height = defaultHeight(options.type) + 'px';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('craggy-charts: canvas 2D is unavailable');
    this.ctx = ctx;

    this.listen();
    this.applyChrome();
    this.joinGroup();
    wake(this);
  }

  // ── Public API ─────────────────────────────────────────────────────────────────────────

  /** Change any option (data, type, styling...). The chart animates to the new state. */
  update(options: Partial<ChartOptions>) {
    const prevGroup = this.core.opts.group;
    this.core.update(options);
    if ('group' in options && options.group !== prevGroup) { this.leaveGroup(prevGroup); this.joinGroup(); }
    this.applyChrome();
    this.refreshTip();
    wake(this);
    return this;
  }

  /** Append rows (objects or numbers). With `window`, old rows scroll off at constant speed. */
  push(...rows: (Row | number | (Row | number)[])[]) {
    const flat = rows.flat() as Row[];
    if (this.pointer && this.core.live) { this.paused.push(...flat); return this; } // pause-on-hover
    this.core.push(flat, performance.now());
    this.afterData();
    return this;
  }

  /** Merge into the newest row (a live tick inside the current candle). */
  patch(row: Row) {
    this.core.patch(row);
    this.afterData();
    return this;
  }

  /** Highlight a series/category by name, a row by index, or clear with null. */
  highlight(target: string | number | null) {
    if (typeof target === 'number') { this.focusIndex = target; this.setHover(target, true); this.showTip(this.core.anchor(target)); }
    else { this.core.setFocus(target); if (target == null) this.setHover(-1, true); }
    wake(this);
    return this;
  }

  /** Show or hide a series or category, as a legend click does. */
  toggle(name: string) { this.core.toggle(name); this.applyChrome(); wake(this); return this; }

  on(event: 'hover' | 'click', fn: (p: PointEvent | null) => void): this;
  on(event: 'select', fn: (s: SelectEvent) => void): this;
  on(event: 'zoom', fn: (z: ZoomEvent) => void): this;
  on(event: 'legend', fn: (l: LegendEvent) => void): this;
  on(event: ChartEvent, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }

  off(event: ChartEvent, fn?: Handler) {
    if (!fn) this.handlers.delete(event); else this.handlers.get(event)?.delete(fn);
    return this;
  }

  /** PNG data URL of the chart at its final (settled) state, background included. */
  toImage(type = 'image/png'): string {
    this.core.settle(performance.now());
    this.draw();
    const out = document.createElement('canvas');
    out.width = this.canvas.width; out.height = this.canvas.height;
    const c = out.getContext('2d')!;
    c.fillStyle = css(this.core.theme.bg);
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(this.canvas, 0, 0);
    return out.toDataURL(type);
  }

  /** SVG of the settled chart: one rounded rect per lit tile, so it prints sharply. */
  toSVG(): string { this.core.settle(performance.now()); this.draw(); return toSVG(this.core); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    sleep(this);
    clearTimeout(this.a11yTimer); clearTimeout(this.touchTimer);
    this.ro?.disconnect(); this.io?.disconnect();
    for (const f of this.cleanup) f();
    this.leaveGroup(this.core.opts.group);
    renderer().release(this.core);
    this.el.remove();
    this.handlers.clear();
  }

  // ── Frame ──────────────────────────────────────────────────────────────────────────────

  tick(now: number, dt: number): boolean {
    if (this.destroyed || !this.core.grid) return false;
    const moving = this.core.frame(now, dt);
    this.draw();
    return moving;
  }

  private draw() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.core.grid) return;
    let r = renderer();
    try { r.draw(c, this.core, this.dpr, tileShape(this.core.opts)); }
    catch (e) { if (r.kind !== 'webgl2') throw e; setRenderer('canvas2d'); r = renderer(); r.draw(c, this.core, this.dpr, tileShape(this.core.opts)); }
    drawText(c, this.core, this.dpr);
  }

  private resize() {
    const w = this.plotEl.clientWidth, h = this.plotEl.clientHeight;
    if (!w || !h) return;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.core.setSize(w, h);
    this.draw();
    wake(this);
  }

  /** Data-only changes (push / patch): the legend may change; the screen-reader summary and
   *  table are refreshed at most twice a second, so a 10 Hz stream does not rebuild DOM per row. */
  private afterData() {
    this.renderLegend();
    if (!this.a11yTimer) this.a11yTimer = window.setTimeout(() => this.renderA11y(), 500);
    this.refreshTip();
    wake(this);
  }

  private renderA11y() {
    clearTimeout(this.a11yTimer);
    this.a11yTimer = 0;
    this.canvas.setAttribute('aria-label', this.core.summary());
    this.renderTable();
  }

  private applyChrome() {
    const o = this.core.opts, th = this.core.theme, s = this.el.style;
    s.setProperty('--cc-bg', css(th.bg)); s.setProperty('--cc-text', css(th.text)); s.setProperty('--cc-text-hi', css(th.textHi));
    s.setProperty('--cc-tip-bg', th.tooltipBg); s.setProperty('--cc-tip-border', th.tooltipBorder);
    this.el.classList.toggle('cc-light', th.name === 'light');
    // Title
    this.headEl.replaceChildren();
    if (o.title) this.headEl.appendChild(Object.assign(document.createElement('div'), { className: 'cc-title', textContent: o.title }));
    if (o.subtitle) this.headEl.appendChild(Object.assign(document.createElement('div'), { className: 'cc-sub', textContent: o.subtitle }));
    this.headEl.style.display = o.title || o.subtitle ? '' : 'none';
    if (o.title) this.el.setAttribute('aria-label', o.title); else this.el.removeAttribute('aria-label');
    this.renderLegend();
    this.renderA11y();
  }

  private renderLegend() {
    const o = this.core.opts, items = this.core.legend();
    const show = o.legend === false ? false : o.legend != null && o.legend !== 'auto' ? items.length > 0 : items.length > 1;
    const pos = typeof o.legend === 'string' && o.legend !== 'auto' ? o.legend : 'top';
    const key = show ? pos + '|' + items.map(i => `${i.name}:${i.hidden}:${i.color.map(Math.round).join(',')}`).join(';') : '';
    if (key === this.legendKey) return;
    this.legendKey = key;
    this.legendEl.remove();
    if (!show) return;
    this.legendEl.className = 'cc-legend' + (pos === 'right' ? ' cc-right' : '');
    this.legendEl.replaceChildren(...items.map(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(!it.hidden));
      const k = b.appendChild(document.createElement('span'));
      k.className = 'cc-key';
      k.style.background = css(it.color);
      b.appendChild(document.createTextNode(it.name));
      let timer = 0;
      b.addEventListener('click', () => { // single click toggles, double click isolates
        clearTimeout(timer);
        timer = window.setTimeout(() => { this.core.toggle(it.name); this.legendChanged(it.name); }, 220);
      });
      b.addEventListener('dblclick', () => { clearTimeout(timer); this.isolate(it.name); });
      b.addEventListener('mouseenter', () => { if (!this.core.hidden.has(it.name)) { this.core.setFocus(it.name); wake(this); } });
      b.addEventListener('mouseleave', () => { this.core.setFocus(null); wake(this); });
      return b;
    }));
    this.bodyEl.classList.toggle('cc-col', false);
    if (pos === 'right') this.bodyEl.appendChild(this.legendEl);
    else if (pos === 'bottom') this.el.insertBefore(this.legendEl, this.liveEl);
    else this.el.insertBefore(this.legendEl, this.bodyEl);
  }

  private isolate(name: string) {
    const names = this.core.legend().map(l => l.name), others = names.filter(n => n !== name);
    const alreadyAlone = !this.core.hidden.has(name) && others.every(n => this.core.hidden.has(n));
    for (const n of names) {
      const hide = alreadyAlone ? false : n !== name;
      if (hide !== this.core.hidden.has(n)) this.core.hidden[hide ? 'add' : 'delete'](n);
    }
    this.core.rebuild();
    this.legendChanged(name);
  }

  private legendChanged(name: string) {
    this.core.setFocus(null);
    this.applyChrome();
    this.emit('legend', { name, hidden: this.core.hidden.has(name), hiddenAll: [...this.core.hidden] } as LegendEvent);
    wake(this);
  }

  private renderTable() {
    const rows = this.core.rows.slice(0, 200);
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const head = document.createElement('tr');
    for (const k of keys) head.appendChild(Object.assign(document.createElement('th'), { textContent: k }));
    const body = rows.map(r => {
      const tr = document.createElement('tr');
      for (const k of keys) tr.appendChild(Object.assign(document.createElement('td'), { textContent: labelText(r[k]) }));
      return tr;
    });
    this.tableEl.replaceChildren(...(keys.length ? [head, ...body] : []));
  }

  // ── Events and interaction ──────────────────────────────────────────────────────────────

  private emit(event: ChartEvent, payload: any) { for (const fn of this.handlers.get(event) || []) fn(payload); }

  private listen() {
    const cv = this.canvas, on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn, opts));
    };
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.plotEl); }
    else requestAnimationFrame(() => this.resize());
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver(es => { const v = es[es.length - 1].isIntersecting; if (v !== this.visible) { this.visible = v; if (v) wake(this); } });
      this.io.observe(this.el);
    }
    if (this.mqLight) on(this.mqLight, 'change', (e: MediaQueryListEvent) => { this.core.env.prefersLight = e.matches; if (this.core.opts.theme === 'auto') this.update({}); });
    if (this.mqMotion) on(this.mqMotion, 'change', (e: MediaQueryListEvent) => { this.core.env.reducedMotion = e.matches; wake(this); });

    on(cv, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(cv, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(cv, 'pointerup', (e: PointerEvent) => this.onUp(e));
    on(cv, 'pointercancel', (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.drag = null; this.pinch = null; this.core.brush = null; });
    // Touch fires pointerleave right after every lift; the tap's tooltip is dismissed by a timer instead.
    on(cv, 'pointerleave', (e: PointerEvent) => { if (e.pointerType !== 'touch') this.onLeave(); });
    on(cv, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(cv, 'dblclick', () => { if (this.core.opts.zoom) this.setView([0, 1], [0, 1]); });
    on(cv, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    on(cv, 'blur', () => { this.focusIndex = -1; if (!this.pointer) { this.setHover(-1); this.hideTip(); } });
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onMove(e: PointerEvent) {
    const p = this.local(e);
    this.pointer = p;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) return this.onPinch();
    const d = this.drag, core = this.core;
    if (d && core.grid) {
      const [tx] = core.toTiles(p.x, p.y);
      if (Math.abs(p.x - d.px) + Math.abs(p.y - d.py) > 4) d.moved = true;
      if (d.mode === 'brush' && d.moved) { core.brush = [d.x0, tx]; wake(this); }
      else if (d.mode === 'pan' && d.moved) {
        const g = core.grid, span = d.view[1] - d.view[0], du = ((p.x - d.px) / (g.cols * g.cell)) * span;
        const a = clamp(d.view[0] - du, 0, 1 - span);
        const ys = d.viewY[1] - d.viewY[0], dv = core.opts.zoom === 'xy' ? ((p.y - d.py) / (g.rows * g.cell)) * ys : 0;
        const b = clamp(d.viewY[0] + dv, 0, 1 - ys);
        this.setView([a, a + span], [b, b + ys]);
      }
    }
    this.hoverAt(p);
  }

  /** Glow, pick and tooltip for a pointer position (hover, or a touch landing). */
  private hoverAt(p: { x: number; y: number }) {
    this.glowAt(p.x, p.y);
    const id = this.core.pick(p.x, p.y);
    this.setHover(id);
    if (id >= 0) this.showTip([p.x, p.y]); else this.hideTip();
  }

  private onDown(e: PointerEvent) {
    const p = this.local(e), o = this.core.opts;
    this.pointers.set(e.pointerId, p);
    if (e.pointerType === 'touch') { clearTimeout(this.touchTimer); this.pointer = p; this.hoverAt(p); } // a tap has no move before it
    if (this.pointers.size === 2 && o.zoom) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.abs(a.x - b.x) || 1, view: [...this.core.view] as [number, number], cx: (a.x + b.x) / 2 };
      this.drag = null; this.core.brush = null;
      return;
    }
    if (!this.core.grid || !this.core.cartesian) { this.drag = { x0: 0, px: p.x, py: p.y, view: [0, 1], viewY: [0, 1], moved: false, mode: 'scrub' }; return; }
    const zoomed = this.core.view[1] - this.core.view[0] < 0.999 || this.core.viewY[1] - this.core.viewY[0] < 0.999;
    const mode = o.brush && !(e.shiftKey && zoomed) ? 'brush' : o.zoom && zoomed ? 'pan' : 'scrub';
    if (mode !== 'scrub' && e.pointerType !== 'touch') this.canvas.setPointerCapture?.(e.pointerId);
    this.drag = { x0: this.core.toTiles(p.x, p.y)[0], px: p.x, py: p.y, view: [...this.core.view] as [number, number], viewY: [...this.core.viewY] as [number, number], moved: false, mode };
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'brush' && d.moved && this.core.brush) {
      const [a, b] = this.core.brush, sel = this.core.selection(a, b);
      if (this.core.opts.zoom && sel && this.core.opts.brush !== 'select') this.zoomToTiles(a, b);
      this.core.brush = null;
      if (sel) this.emit('select', sel as SelectEvent);
      wake(this);
      return;
    }
    if (!d.moved) {
      const hit = this.core.tip(this.core.hover);
      if (hit) this.emit('click', this.payload(hit));
    }
    if (e.pointerType === 'touch') { clearTimeout(this.touchTimer); this.touchTimer = window.setTimeout(() => { if (!this.drag) this.onLeave(); }, 1500); }
  }

  private onLeave() {
    this.pointer = null;
    this.setHover(-1);
    this.hideTip();
    if (this.paused.length) { const rows = this.paused; this.paused = []; this.core.push(rows, performance.now()); this.afterData(); }
  }

  private onWheel(e: WheelEvent) {
    const o = this.core.opts, g = this.core.grid;
    if (!o.zoom || !g || !this.core.cartesian) return;
    e.preventDefault();
    const p = this.local(e), [tx, ty] = this.core.toTiles(p.x, p.y), f = Math.exp(clamp(e.deltaY, -100, 100) * 0.002);
    const zoomAxis = (view: [number, number], u: number): [number, number] => {
      const span = view[1] - view[0], at = view[0] + clamp(u) * span, ns = clamp(span * f, 0.001, 1);
      let a = at - (at - view[0]) * (ns / span);
      a = clamp(a, 0, 1 - ns);
      return [a, a + ns];
    };
    const hz = this.core.horizontal;
    const ux = hz ? 1 - ty / g.rows : tx / g.cols;
    const vx = zoomAxis(this.core.view, ux);
    const vy = o.zoom === 'xy' ? zoomAxis(this.core.viewY, hz ? tx / g.cols : ty / g.rows) : this.core.viewY;
    this.setView(vx, vy as [number, number]);
  }

  private onPinch() {
    const pz = this.pinch!, [a, b] = [...this.pointers.values()], g = this.core.grid!;
    const ratio = pz.d / (Math.abs(a.x - b.x) || 1), span = pz.view[1] - pz.view[0], ns = clamp(span * ratio, 0.001, 1);
    const u = (pz.cx - g.ox) / (g.cols * g.cell), at = pz.view[0] + clamp(u) * span;
    const s = clamp(at - (at - pz.view[0]) * (ns / span), 0, 1 - ns);
    this.setView([s, s + ns], this.core.viewY);
  }

  private zoomToTiles(a: number, b: number) {
    const g = this.core.grid!, [v0, v1] = this.core.view, span = v1 - v0;
    const lo = Math.min(a, b) / g.cols, hi = Math.max(a, b) / g.cols;
    this.setView([v0 + lo * span, v0 + hi * span], this.core.viewY);
  }

  private setView(view: [number, number], viewY: [number, number], fromGroup = false) {
    this.core.setView(view[0], view[1], viewY[0], viewY[1]);
    wake(this);
    const g = this.core.grid;
    const sel = g ? this.core.selection(0, g.cols) : null;
    this.emit('zoom', { view: [...this.core.view], viewY: [...this.core.viewY], from: sel?.from, to: sel?.to } as ZoomEvent);
    if (!fromGroup) this.eachInGroup(c => c.setView(view, viewY, true));
  }

  private onKey(e: KeyboardEvent) {
    const ids = this.core.ids();
    if (!ids.length) return;
    let k = ids.indexOf(this.focusIndex);
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': k = k < 0 ? 0 : Math.min(ids.length - 1, k + 1); break;
      case 'ArrowLeft': case 'ArrowUp': k = k < 0 ? ids.length - 1 : Math.max(0, k - 1); break;
      case 'Home': k = 0; break;
      case 'End': k = ids.length - 1; break;
      case 'Enter': case ' ': {
        const hit = this.core.tip(this.focusIndex);
        if (hit) this.emit('click', this.payload(hit));
        e.preventDefault();
        return;
      }
      case 'Escape': this.focusIndex = -1; this.setHover(-1); this.hideTip(); return;
      default: return;
    }
    e.preventDefault();
    this.focusIndex = ids[k];
    this.setHover(this.focusIndex);
    const hit = this.showTip(this.core.anchor(this.focusIndex));
    if (hit) this.liveEl.textContent = `${hit.title}: ${hit.rows.map(r => `${r.name} ${r.value}`).join(', ')}`;
  }

  private glowAt(x: number, y: number) {
    const g = this.core.grid;
    if (!g || this.core.still) return;
    const [tx, ty] = this.core.toTiles(x, y), c = Math.floor(tx), r = Math.floor(ty);
    const set = (cc: number, rr: number, v: number) => {
      if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) return;
      const i = (g.rows - 1 - rr) * g.cols + cc;
      this.core.glow[i] = Math.max(this.core.glow[i], v);
    };
    set(c, r, 1); set(c - 1, r, 0.45); set(c + 1, r, 0.45); set(c, r - 1, 0.45); set(c, r + 1, 0.45);
    wake(this);
  }

  private setHover(id: number, fromGroup = false) {
    if (!this.core.setHover(id)) return;
    wake(this);
    const hit = id >= 0 ? this.core.tip(id) : null;
    if (!fromGroup) this.emit('hover', hit ? this.payload(hit) : null);
    if (!fromGroup && !this.syncing && this.core.cartesian && !this.core.primary.def.freePick) {
      this.syncing = true;
      this.eachInGroup(c => { if (c.core.cartesian) { c.setHover(id, true); if (id < 0) c.hideTip(); } });
      this.syncing = false;
    }
  }

  private payload(hit: Hit): PointEvent {
    return { ...hit.point, title: hit.title, rows: hit.rows.map(r => ({ name: r.name, value: r.value, color: css(r.color) })) };
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────────────────────

  private lastTipAt: [number, number] | null = null;

  private showTip(at: [number, number]): Hit | null {
    const o = this.core.opts, hit = this.core.tip(this.core.hover);
    this.lastTipAt = at;
    if (!hit || o.tooltip === false) { this.hideTip(); return hit; }
    const t = this.tipEl;
    if (typeof o.tooltip === 'function') {
      const r = o.tooltip(this.payload(hit));
      if (r instanceof Node) t.replaceChildren(r); else t.textContent = String(r ?? '');
    } else {
      const title = document.createElement('b');
      title.textContent = hit.title;
      t.replaceChildren(title, ...hit.rows.map(r => {
        const row = document.createElement('div'), sw = document.createElement('i'), name = document.createElement('span'), val = document.createElement('em');
        sw.style.background = css(r.color);
        name.textContent = r.name; val.textContent = r.value;
        row.append(sw, name, val);
        return row;
      }));
    }
    t.classList.add('cc-on');
    const W = this.plotEl.clientWidth, H = this.plotEl.clientHeight, w = t.offsetWidth, h = t.offsetHeight;
    let x = at[0] + 14, y = at[1] - h - 10;
    if (x + w > W - 4) x = at[0] - w - 14;
    if (y < 4) y = at[1] + 16;
    x = clamp(x, 4, Math.max(4, W - w - 4)); y = clamp(y, 4, Math.max(4, H - h - 4));
    t.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    return hit;
  }

  private refreshTip() {
    if (this.core.hover >= 0 && this.lastTipAt && this.tipEl.classList.contains('cc-on')) this.showTip(this.pointer ? [this.pointer.x, this.pointer.y] : this.lastTipAt);
  }

  private hideTip() { this.tipEl.classList.remove('cc-on'); }

  // ── Groups ──────────────────────────────────────────────────────────────────────────────

  private joinGroup() {
    const g = this.core.opts.group;
    if (!g) return;
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g)!.add(this);
  }

  private leaveGroup(g?: string) { if (g) groups.get(g)?.delete(this); }

  private eachInGroup(fn: (c: Chart) => void) {
    const g = this.core.opts.group;
    if (!g) return;
    for (const c of groups.get(g) || []) if (c !== this) fn(c);
  }
}

function defaultHeight(type: string) {
  return type === 'progress' ? 56 : type === 'stat' ? 140 : 280;
}

/** SVG for a settled core: unlit panel as a pattern, one rounded rect per lit tile, text as text. */
export function toSVG(core: ChartCore): string {
  const g = core.grid, f = core.field;
  if (!g || !f) return '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const th = core.theme, shape = tileShape(core.opts), full = g.cell * (1 - shape.gap), off = (g.cell - full) / 2, r = g.cell * shape.round;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n3 = (v: number) => +v.toFixed(2);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}" font-family='${esc(FONT)}'>`,
    `<defs><pattern id="u" width="${g.cell}" height="${g.cell}" patternUnits="userSpaceOnUse" x="${n3(g.ox)}" y="${n3(g.oy)}"><rect x="${n3(off)}" y="${n3(off)}" width="${n3(full)}" height="${n3(full)}" rx="${n3(r)}" fill="${css(th.unlit)}"/></pattern></defs>`,
    `<rect width="100%" height="100%" fill="${css(th.bg)}"/>`,
    `<rect x="${n3(g.ox)}" y="${n3(g.oy)}" width="${n3(g.cols * g.cell)}" height="${n3(g.rows * g.cell)}" fill="url(#u)"/>`,
  ];
  for (let i = 0; i < f.cols * f.rows; i++) {
    const s = Math.min(1.25, core.size[i]);
    if (s < 0.02) continue;
    const side = full * s, c = i % f.cols, row = (i / f.cols) | 0;
    const x = g.ox + c * g.cell + (g.cell - side) / 2, y = g.oy + row * g.cell + (g.cell - side) / 2;
    parts.push(`<rect x="${n3(x)}" y="${n3(y)}" width="${n3(side)}" height="${n3(side)}" rx="${n3(Math.min(r, side / 2))}" fill="${css([core.col[i * 3], core.col[i * 3 + 1], core.col[i * 3 + 2]])}"/>`);
  }
  const text = (x: number, y: number, s: string, anchor: string, fill: string, size = 10, weight = 400, extra = '') =>
    parts.push(`<text x="${n3(x)}" y="${n3(y)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${esc(s)}</text>`);
  const below = g.oy + g.rows * g.cell + 11;
  for (const l of core.out.labelsX) text(l.x, below, l.text, 'middle', css(th.text));
  for (const l of core.out.labelsY) text(l.side === 'right' ? g.ox + g.cols * g.cell + 7 : g.ox - 7, l.y, l.text, l.side === 'right' ? 'start' : 'end', css(th.text));
  for (const t of core.out.texts) {
    const fill = t.color === 'textHi' ? css(th.textHi) : t.color == null || t.color === 'text' ? css(th.text) : css(t.color);
    const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle';
    text(t.x, t.y, t.text, anchor, fill, t.size ?? 10, t.weight ?? 400, t.rotate ? ` transform="rotate(${t.rotate} ${n3(t.x)} ${n3(t.y)})"` : '');
  }
  parts.push('</svg>');
  return parts.join('');
}

/** Create a chart in an element (or selector). */
export const chart = (target: string | HTMLElement, options: ChartOptions) => new Chart(target, options);
