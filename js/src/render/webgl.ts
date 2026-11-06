// WebGL2 renderer. Every chart on the page shares ONE context (browsers cap live contexts at ~16).
// Tile state goes into an RGBA8 texture, one texel per tile (rgb + size), plus an R8 glow texture; a
// single full-screen fragment shader draws every tile as an anti-aliased rounded square from a
// signed distance field. The result is blitted into the chart's own 2D canvas.
import type { ChartCore } from '../core/chart-core';
import type { TileRenderer, TileShape } from './tiles';

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uGlow;
uniform vec2 uGrid;      // cols, rows
uniform vec2 uOrigin;    // device px of the plot's top-left, in GL window coords (y up)
uniform float uCell;     // device px
uniform float uGap;
uniform float uRound;
uniform vec3 uUnlit;
uniform vec3 uGridCol;
uniform vec3 uSnow;
out vec4 o;
float box(vec2 q, float h, float r) { vec2 d = abs(q) - vec2(h - r); return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main() {
  vec2 local = vec2(gl_FragCoord.x - uOrigin.x, uOrigin.y - gl_FragCoord.y);
  vec2 t = floor(local / uCell);
  if (t.x < 0.0 || t.y < 0.0 || t.x >= uGrid.x || t.y >= uGrid.y) { o = vec4(0.0); return; }
  vec4 s = texelFetch(uState, ivec2(t), 0);
  float glow = texelFetch(uGlow, ivec2(t), 0).r;
  vec2 q = local - (t + 0.5) * uCell;
  float half_ = uCell * (1.0 - uGap) * 0.5, r = uCell * uRound;
  float au = clamp(0.5 - box(q, half_, min(r, half_)), 0.0, 1.0);
  vec3 col = mix(uUnlit, uGridCol, glow * 0.6);
  float size = s.a * 1.275;
  float a = au;
  if (size > 0.02) {
    float hl = half_ * min(size, 1.25);
    float al = clamp(0.5 - box(q, hl, min(r, hl)), 0.0, 1.0);
    vec3 lit = mix(s.rgb, uSnow, glow * 0.4);
    col = mix(col, lit, al);
    a = max(au, al);
  } else if (glow > 0.02) {
    float hl = half_ * glow * 0.9;
    float al = clamp(0.5 - box(q, hl, min(r, hl)), 0.0, 1.0);
    col = mix(col, uGridCol, al);
  }
  o = vec4(col * a, a);
}`;

interface Slot { state: WebGLTexture; glow: WebGLTexture; cols: number; rows: number; buf: Uint8Array; gbuf: Uint8Array }

export class WebGLRenderer implements TileRenderer {
  readonly kind = 'webgl2' as const;
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private slots = new WeakMap<ChartCore, Slot>();
  lost = false;

  /** Returns null when WebGL2 is unavailable. */
  static create(): WebGLRenderer | null {
    try {
      const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
      return gl ? new WebGLRenderer(canvas, gl) : null;
    } catch { return null; }
  }

  private constructor(canvas: HTMLCanvasElement | OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas; this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('craggy-charts: shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('craggy-charts: program: ' + gl.getProgramInfoLog(p));
    this.prog = p;
    for (const u of ['uState', 'uGlow', 'uGrid', 'uOrigin', 'uCell', 'uGap', 'uRound', 'uUnlit', 'uGridCol', 'uSnow']) this.loc[u] = gl.getUniformLocation(p, u);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    (canvas as any).addEventListener?.('webglcontextlost', (e: Event) => { e.preventDefault(); this.lost = true; });
  }

  private tex() {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private slot(core: ChartCore): Slot {
    const g = core.grid!;
    let s = this.slots.get(core);
    if (s && s.cols === g.cols && s.rows === g.rows) return s;
    if (s) { this.gl.deleteTexture(s.state); this.gl.deleteTexture(s.glow); }
    s = { state: this.tex(), glow: this.tex(), cols: g.cols, rows: g.rows, buf: new Uint8Array(g.cols * g.rows * 4), gbuf: new Uint8Array(g.cols * g.rows) };
    this.slots.set(core, s);
    return s;
  }

  release(core: ChartCore) {
    const s = this.slots.get(core);
    if (s && !this.lost) { this.gl.deleteTexture(s.state); this.gl.deleteTexture(s.glow); }
    this.slots.delete(core);
  }

  draw(out: CanvasRenderingContext2D, core: ChartCore, dpr: number, shape: TileShape) {
    const g = core.grid, gl = this.gl;
    if (!g || !core.field) return;
    const s = this.slot(core), n = g.cols * g.rows, { size, col, glow } = core, buf = s.buf, gbuf = s.gbuf;
    for (let i = 0; i < n; i++) {
      const j = i * 4, k = i * 3, v = size[i];
      buf[j] = col[k]; buf[j + 1] = col[k + 1]; buf[j + 2] = col[k + 2];
      buf[j + 3] = v <= 0 ? 0 : v >= 1.275 ? 255 : (v * 200 + 0.5) | 0;
      gbuf[i] = glow[i] <= 0 ? 0 : glow[i] >= 1 ? 255 : (glow[i] * 255) | 0;
    }
    // Viewport: the plot area only, at the bottom-left of the shared canvas.
    const pw = Math.ceil(g.cols * g.cell * dpr), ph = Math.ceil(g.rows * g.cell * dpr);
    if (this.canvas.width < pw || this.canvas.height < ph) {
      this.canvas.width = Math.max(this.canvas.width, pw); this.canvas.height = Math.max(this.canvas.height, ph);
    }
    const H = this.canvas.height;
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.state);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, g.cols, g.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, s.glow);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, g.cols, g.rows, 0, gl.RED, gl.UNSIGNED_BYTE, gbuf);
    const th = core.theme, c3 = (c: number[]) => [c[0] / 255, c[1] / 255, c[2] / 255] as const;
    const L = this.loc;
    gl.uniform1i(L.uState, 0); gl.uniform1i(L.uGlow, 1);
    gl.uniform2f(L.uGrid, g.cols, g.rows);
    gl.uniform2f(L.uOrigin, 0, ph);
    gl.uniform1f(L.uCell, g.cell * dpr);
    gl.uniform1f(L.uGap, shape.gap); gl.uniform1f(L.uRound, shape.round);
    gl.uniform3f(L.uUnlit, ...c3(th.unlit)); gl.uniform3f(L.uGridCol, ...c3(th.grid)); gl.uniform3f(L.uSnow, ...c3(th.snow));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // The viewport sits at the bottom of the canvas image.
    out.drawImage(this.canvas as CanvasImageSource, 0, H - ph, pw, ph, Math.round(g.ox * dpr), Math.round(g.oy * dpr), pw, ph);
  }
}
