/*
 * craggy-charts — design prototype.
 *
 * A throwaway Canvas2D implementation used to prove the look, the flat options API and the
 * animation model before v1 is built (see ../PLAN.md). The pipeline is the real one:
 *
 *   options + data → model (numbers only) → tweened model → rasterised into a tile field
 *   (coverage + colour per tile) → per-tile springs → draw
 *
 * v1 keeps everything up to the springs and replaces draw() with the WebGL2 / Flutter renderers.
 */
(() => {
  'use strict';

  // ── Palette and small helpers ──────────────────────────────────────────────────────────
  const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const sum = a => a.reduce((s, v) => s + v, 0);
  // Animated numbers count with the precision of where they are heading, not the tween's.
  const decimals = v => { const s = String(v), i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
  const roundLike = (v, target) => +v.toFixed(Math.min(4, decimals(target)));

  const RAMP = ['#16222A', '#2A2F2C', '#4A3F2C', '#7A5C30', '#B9852F', '#FFB547', '#FFE3A8'].map(hex);
  const terrain = t => { t = clamp(t) * 6; const i = Math.min(5, Math.floor(t)); return mix(RAMP[i], RAMP[i + 1], t - i); };
  const PALETTE = ['#FFB547', '#5ED6C5', '#8FA8FF', '#FF7F6E', '#C6E36E', '#D99BFF', '#F5E1B8'].map(hex);
  const UNLIT = hex('#17242C'), GRID = hex('#33474F'), SNOW = hex('#FFE3A8'), DARK = hex('#111A20');
  const UP = hex('#5ED6C5'), DOWN = hex('#FF7F6E');
  const TEXT = '#7f908b', TEXT_HI = '#e4ece7';
  const MONO = '"JetBrains Mono", ui-monospace, monospace';
  const TILE = 13 / 16, RADIUS = 3 / 16; // same tile proportions as the logo
  const CELLS = { fine: 3, normal: 6, chunky: 12 };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // A colour ramp from near-background to the full colour, so fills fade into the grid.
  const shades = (rgb, lo, hi, n = 16) => Array.from({ length: n }, (_, k) => mix(DARK, rgb, lo + (hi - lo) * k / (n - 1)));
  const pick = (ramp, t) => ramp[Math.round(clamp(t) * (ramp.length - 1))];

  function compact(v) {
    const a = Math.abs(v);
    const trim = s => s.replace(/\.0$/, '');
    if (a >= 1e9) return trim((v / 1e9).toFixed(1)) + 'B';
    if (a >= 1e6) return trim((v / 1e6).toFixed(1)) + 'M';
    if (a >= 1e4) return trim((v / 1e3).toFixed(0)) + 'k';
    if (a >= 1e3) return trim((v / 1e3).toFixed(1)) + 'k';
    return String(Math.round(v * 100) / 100);
  }
  const FORMATS = {
    compact,
    percent: v => compact(v) + '%',
    currency: v => (v < 0 ? '-$' : '$') + compact(Math.abs(v)),
    bytes: v => (v >= 1024 ? (v / 1024).toFixed(1) + ' TB' : Math.round(v) + ' GB'),
  };

  function niceTicks(lo, hi, count = 4) {
    if (!(hi > lo)) hi = lo + 1;
    const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(+v.toPrecision(12));
    return { min, max, ticks };
  }

  // ── Tweening: every model is plain numbers/arrays/objects, so one function animates any type ──
  let active = false, seedPrev = false;
  const zero = t => (Array.isArray(t) ? t.map(zero) : typeof t === 'number' ? 0
    : t && typeof t === 'object' ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, zero(v)])) : t);
  function approach(s, t, k) {
    if (typeof t === 'number') {
      if (typeof s !== 'number') s = 0;
      const d = t - s;
      if (Math.abs(d) > Math.abs(t) * 1e-4 + 1e-6) { active = true; return s + d * k; }
      return t;
    }
    if (Array.isArray(t)) {
      const out = Array.isArray(s) ? s : [];
      out.length = t.length;
      for (let i = 0; i < t.length; i++) {
        let cur = out[i];
        if (cur === undefined) cur = typeof t[i] === 'number' ? (seedPrev && i > 0 ? out[i - 1] : 0) : Array.isArray(t[i]) ? [] : undefined;
        out[i] = approach(cur, t[i], k);
      }
      return out;
    }
    if (t && typeof t === 'object') {
      const out = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
      for (const key in t) out[key] = approach(out[key], t[key], k);
      return out;
    }
    return t;
  }

  // ── One shared animation loop for every chart; it stops completely when nothing moves ──
  const awake = new Set();
  let raf = 0, last = 0;
  function wake(ch) { awake.add(ch); if (!raf) raf = requestAnimationFrame(loop); }
  function loop(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    for (const ch of awake) if (!ch.visible || !ch.frame(now, dt)) awake.delete(ch);
    if (awake.size) raf = requestAnimationFrame(loop); else last = 0;
  }

  // ── Data normalisation: the flat options API (x / y / by) resolved into series ──
  function firstKey(row, numeric) { return Object.keys(row).find(k => (typeof row[k] === 'number') === numeric); }
  function wide(ch) {
    const o = ch.opts, data = ch.data;
    if (!data.length) return { labels: [], names: [], values: [] };
    const first = data[0];
    const xKey = o.x || firstKey(first, false);
    if (o.by) { // long / tidy data: one row per (x, series) pair
      const names = [...new Set(data.map(r => r[o.by]))];
      const labels = [...new Set(data.map(r => r[xKey]))];
      const yKey = o.y || 'value';
      const at = new Map(data.map(r => [r[o.by] + '\u0000' + r[xKey], +r[yKey]]));
      return { labels, names, values: names.map(n => labels.map(l => at.get(n + '\u0000' + l) || 0)) };
    }
    const yKeys = o.y ? [].concat(o.y) : Object.keys(first).filter(k => k !== xKey && typeof first[k] === 'number');
    return { labels: data.map(r => r[xKey]), names: yKeys, values: yKeys.map(k => data.map(r => +r[k] || 0)) };
  }
  function categories(ch) { // label/value pairs for pie, waffle, treemap...
    const o = ch.opts, data = ch.data;
    if (!data.length) return { labels: [], values: [] };
    const lk = o.x || o.label || firstKey(data[0], false), vk = o.y || o.value || firstKey(data[0], true);
    return { labels: data.map(r => r[lk]), values: data.map(r => Math.max(0, +r[vk] || 0)) };
  }
  function colorsFor(ch, names) {
    const c = ch.opts.colors, s = ch.opts.series || {};
    return names.map((n, i) => {
      const v = (s[n] && s[n].color) || (Array.isArray(c) ? c[i] : c && c[n]);
      return v ? hex(v) : PALETTE[i % PALETTE.length];
    });
  }
  const ticksFor = ch => (ch.rows ? Math.max(2, Math.round((ch.rows * ch.cell) / 48)) : 4);
  const labelText = l => (l instanceof Date ? l.toISOString().slice(5, 10) : String(l));

  // ── Rasteriser: draws geometry into the tile field with sub-tile coverage (= anti-aliasing) ──
  // Coordinates are in tiles, x to the right, y UP from the bottom of the plot.
  function raster(ch) {
    const { cols, rows, tcov, tcol } = ch;
    const plot = (c, r, cov, rgb) => {
      if (c < 0 || r < 0 || c >= cols || r >= rows || cov <= 0.01) return;
      const i = (rows - 1 - r) * cols + c;
      if (cov < tcov[i] && cov < 0.5) return; // later layers win once they are solid enough
      if (cov > tcov[i]) tcov[i] = cov > 1 ? 1 : cov;
      tcol[i * 3] = rgb[0]; tcol[i * 3 + 1] = rgb[1]; tcol[i * 3 + 2] = rgb[2];
    };
    const rect = (x0, y0, x1, y1, color, scale = 1) => {
      if (x1 < x0) [x0, x1] = [x1, x0];
      if (y1 < y0) [y0, y1] = [y1, y0];
      const c0 = Math.max(0, Math.floor(x0)), c1 = Math.min(cols - 1, Math.ceil(x1) - 1);
      const r0 = Math.max(0, Math.floor(y0)), r1 = Math.min(rows - 1, Math.ceil(y1) - 1);
      const fn = typeof color === 'function';
      for (let c = c0; c <= c1; c++) {
        const ox = overlap(c, c + 1, x0, x1);
        if (ox <= 0) continue;
        for (let r = r0; r <= r1; r++) plot(c, r, ox * overlap(r, r + 1, y0, y1) * scale, fn ? color(c, r) : color);
      }
    };
    const line = (pts, w, rgb, scale = 1) => {
      const hw = Math.max(0.7, w / 2);
      for (let p = 0; p + 3 < pts.length; p += 2) {
        const ax = pts[p], ay = pts[p + 1], bx = pts[p + 2], by = pts[p + 3];
        const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1)), c1 = Math.min(cols - 1, Math.ceil(Math.max(ax, bx) + hw + 1));
        const r0 = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1)), r1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by) + hw + 1));
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
          const px = c + 0.5 - ax, py = r + 0.5 - ay, t = clamp((px * dx + py * dy) / l2);
          const d = Math.hypot(px - dx * t, py - dy * t);
          plot(c, r, clamp((hw + 0.4 - d) * 1.8) * scale, rgb);
        }
      }
    };
    const disc = (x, y, rad, rgb, scale = 1) => {
      for (let c = Math.floor(x - rad - 1); c <= x + rad + 1; c++) for (let r = Math.floor(y - rad - 1); r <= y + rad + 1; r++) {
        plot(c, r, clamp(rad + 0.5 - Math.hypot(c + 0.5 - x, r + 0.5 - y)) * scale, rgb);
      }
    };
    const polygon = (pts, rgb, cov) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      for (let c = Math.floor(x0); c <= x1; c++) for (let r = Math.floor(y0); r <= y1; r++) {
        const px = c + 0.5, py = r + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
          const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) plot(c, r, cov, rgb);
      }
    };
    const hline = (row, rgb, cov) => { for (let c = 0; c < cols; c += ch.cell <= 4 ? 2 : 1) plot(c, row, cov, rgb); };
    const vline = (col, rgb, cov) => { for (let r = 0; r < rows; r += ch.cell <= 4 ? 2 : 1) plot(col, r, cov, rgb); };
    return { plot, rect, line, disc, polygon, hline, vline };
  }

  // Catmull-Rom through the points, clamped per segment so curves never overshoot the data.
  function smooth(xs, ys, sub) {
    const n = xs.length, out = [];
    if (n < 3 || sub <= 1) { for (let i = 0; i < n; i++) out.push(xs[i], ys[i]); return out; }
    for (let i = 0; i < n - 1; i++) {
      const p0 = ys[Math.max(0, i - 1)], p1 = ys[i], p2 = ys[i + 1], p3 = ys[Math.min(n - 1, i + 2)];
      const lo = Math.min(p1, p2), hi = Math.max(p1, p2);
      for (let s = 0; s < sub; s++) {
        const t = s / sub, t2 = t * t, t3 = t2 * t;
        out.push(xs[i] + (xs[i + 1] - xs[i]) * t,
          clamp(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3), lo, hi));
      }
    }
    out.push(xs[n - 1], ys[n - 1]);
    return out;
  }
  function columnsY(pts, cols) { // height of a polyline at every tile column centre
    const ys = new Float32Array(cols).fill(NaN);
    let j = 0;
    for (let c = 0; c < cols; c++) {
      const x = c + 0.5;
      if (x < pts[0] || x > pts[pts.length - 2]) continue;
      while (j + 3 < pts.length && pts[j + 2] < x) j += 2;
      const x0 = pts[j], y0 = pts[j + 1], x1 = pts[j + 2] ?? x0, y1 = pts[j + 3] ?? y0;
      ys[c] = y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1));
    }
    return ys;
  }

  // ── Shared cartesian pieces ──
  const cartesianMargin = ch => (ch.opts.axes === false ? { l: 1, r: 1, t: 1, b: 1 } : { l: 42, r: 8, t: 8, b: 20 });
  const polarMargin = () => ({ l: 6, r: 6, t: 6, b: 6 });
  const Y = (ch, m, v) => ((v - m.yMin) / (m.yMax - m.yMin || 1)) * ch.rows;
  function valueAxis(ch, m, g, ticks, horizontal) {
    if (ch.opts.axes === false) return;
    const len = horizontal ? ch.cols : ch.rows;
    for (const t of ticks) {
      const p = ((t - m.yMin) / (m.yMax - m.yMin || 1)) * len;
      if (p < -0.01 || p > len + 0.01) continue;
      const at = Math.min(len - 1, Math.floor(p));
      if (horizontal) { g.vline(at, GRID, 0.2); ch.labelsX.push({ x: ch.ox + (at + 0.5) * ch.cell, text: ch.format(t) }); }
      else { g.hline(at, GRID, 0.2); ch.labelsY.push({ y: ch.oy + (ch.rows - at - 0.5) * ch.cell, text: ch.format(t) }); }
    }
  }
  // Category labels, thinned by a stable index stride so streaming labels slide instead of flickering.
  function categoryLabels(ch, items) {
    if (ch.opts.axes === false || items.length < 1) return;
    const spacing = items.length > 1 ? Math.abs(items[1].x - items[0].x) * ch.cell : 1e9;
    const widest = Math.max(...items.map(i => i.text.length)) * 6.3 + 12;
    const stride = Math.max(1, Math.ceil(widest / spacing));
    const right = ch.ox + ch.cols * ch.cell;
    for (const it of items) {
      const x = ch.ox + it.x * ch.cell;
      const half = it.text.length * 3.15;
      if (it.idx % stride || x < ch.ox - 2 || x > right + 2 || x + half > ch.W || x - half < 0) continue;
      ch.labelsX.push({ x, text: it.text });
    }
  }
  // x position (in tiles) of point i. Live charts with a window anchor to the right edge and
  // slide by `ch.off`, which runs down at a constant rate between pushes: continuous scrolling.
  function pointX(ch, n) {
    const w = ch.opts.window;
    if (w) return i => ((i - n + w - 1 + ch.off) / (w - 2)) * ch.cols;
    return n < 2 ? () => ch.cols / 2 : i => 0.5 + (i / (n - 1)) * (ch.cols - 1);
  }
  function bandX(ch, n, len) {
    const w = ch.opts.window;
    if (w) { const bw = len / (w - 1); return { bw, at: i => (i - n + w - 1 + ch.off - 0.5) * bw }; }
    const bw = len / Math.max(1, n);
    return { bw, at: i => (i + 0.5) * bw };
  }
  const nearest = (n, at, x) => { let best = -1, d = Infinity; for (let i = 0; i < n; i++) { const e = Math.abs(at(i) - x); if (e < d) { d = e; best = i; } } return best; };
  const seriesTip = (ch, i) => ({
    index: i, title: labelText(ch.fixed.labels[i]),
    rows: ch.fixed.names.filter(n => !ch.hidden.has(n)).map(n => {
      const s = ch.fixed.names.indexOf(n);
      return { color: ch.fixed.colors[s], name: n, value: ch.format(ch.fixed.values[s][i]) };
    }),
  });
  const seriesLegend = ch => ch.fixed.names.map((name, i) => ({ name, color: ch.fixed.colors[i] }));
  const categoryLegend = ch => ch.fixed.labels.map((name, i) => ({ name, color: ch.fixed.colors[i] }));
  const shiftAll = ch => { for (const k in ch.shown) if (Array.isArray(ch.shown[k])) for (const a of ch.shown[k]) Array.isArray(a) && a.shift(); };

  // ── Chart types ────────────────────────────────────────────────────────────────────────
  const TYPES = {};

  const lineLike = area => ({
    margin: cartesianMargin,
    legend: seriesLegend,
    shift: shiftAll,
    model(ch) {
      const w = wide(ch), o = ch.opts, fill = area || o.fill, stack = area && o.stack;
      const shown = w.values.filter((_, s) => !ch.hidden.has(w.names[s]));
      let lo = Infinity, hi = -Infinity;
      if (stack) { for (let i = 0; i < w.labels.length; i++) hi = Math.max(hi, sum(shown.map(v => v[i]))); lo = 0; }
      else for (const v of shown) for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (fill) lo = Math.min(0, lo);
      const pad = fill ? 0 : (hi - lo) * 0.1 || 1;
      const nt = niceTicks(lo - pad, hi + (hi - lo) * 0.06, ticksFor(ch));
      const colors = colorsFor(ch, w.names);
      return {
        model: { yMin: nt.min, yMax: nt.max, s: w.values, a: w.names.map(n => (ch.hidden.has(n) ? 0 : 1)) },
        fixed: { ...w, ticks: nt.ticks, colors, fills: colors.map(c => shades(c, 0.14, 0.55)), fill, stack },
      };
    },
    raster(ch, m, g, now) {
      const f = ch.fixed, n = m.s[0] ? m.s[0].length : 0;
      valueAxis(ch, m, g, f.ticks);
      if (n < 2) return;
      const X = pointX(ch, n), xs = Array.from({ length: n }, (_, i) => X(i));
      categoryLabels(ch, f.labels.map((l, i) => ({ x: xs[i], text: labelText(l), idx: i + ch.dropped })));
      if (ch.hover >= 0) g.vline(Math.floor(xs[ch.hover]), GRID, 0.45);
      const lw = Math.max(1, 3.2 / ch.cell), sub = Math.min(8, Math.max(1, Math.round(ch.cols / n / 1.5)));
      const cum = new Float32Array(n), curves = [];
      for (let s = 0; s < m.s.length; s++) {
        const lower = Float32Array.from(cum);
        for (let i = 0; i < n; i++) cum[i] = (f.stack ? cum[i] : 0) + m.s[s][i] * (f.stack ? m.a[s] : 1);
        curves.push({ s, lower: smooth(xs, Array.from(lower, v => Y(ch, m, f.stack ? v : Math.max(m.yMin, 0))), sub), upper: smooth(xs, Array.from(cum, v => Y(ch, m, v)), sub) });
      }
      const order = f.stack ? curves : curves.slice().reverse(); // series 0 ends up on top
      for (const { s, lower, upper } of order) {
        if (m.a[s] < 0.01) continue;
        if (f.fill) {
          const top = columnsY(upper, ch.cols), bottom = columnsY(lower, ch.cols), ramp = f.fills[s];
          for (let c = 0; c < ch.cols; c++) {
            const y1 = top[c], y0 = bottom[c];
            if (!(y1 > y0)) continue;
            g.rect(c, y0, c + 1, y1, (_, r) => pick(ramp, ((r + 0.5 - y0) / (y1 - y0)) ** 1.3), 0.95 * m.a[s]);
          }
        }
        g.line(upper, lw, f.colors[s], m.a[s]);
      }
      for (const { s, upper } of order) { // markers on top of every series
        if (m.a[s] < 0.01) continue;
        const yAt = i => upper[Math.min(upper.length - 1, i * sub) * 2 + 1];
        if (ch.hover >= 0) g.disc(xs[ch.hover], yAt(ch.hover), lw * 0.6 + 0.9, mix(f.colors[s], SNOW, 0.45));
        if (ch.opts.window) { // the live "cursor": newest point pulses, like the logo's cursor tiles
          const pulse = 0.5 + 0.5 * Math.sin(now / 160);
          g.disc(xs[n - 1], yAt(n - 1), lw * 0.6 + 0.6 + pulse * 0.5, mix(f.colors[s], SNOW, 0.25 + 0.4 * pulse));
        }
      }
      ch.live = !!ch.opts.window && now - ch.lastPush < 4000 * ch.pushEvery;
    },
    hit(ch, x) { const n = ch.fixed.labels.length; return n ? seriesTip(ch, nearest(n, pointX(ch, n), x)) : null; },
  });
  TYPES.line = lineLike(false);
  TYPES.area = lineLike(true);

  TYPES.bar = {
    margin: ch => (ch.opts.horizontal ? { l: 84, r: 44, t: 6, b: 20 } : cartesianMargin(ch)),
    legend: seriesLegend,
    shift: shiftAll,
    model(ch) {
      const w = wide(ch), o = ch.opts;
      const shown = w.values.filter((_, s) => !ch.hidden.has(w.names[s]));
      let lo = 0, hi = 0;
      for (let i = 0; i < w.labels.length; i++) {
        if (o.stack) hi = Math.max(hi, sum(shown.map(v => Math.max(0, v[i]))));
        for (const v of shown) { lo = Math.min(lo, v[i]); if (!o.stack) hi = Math.max(hi, v[i]); }
      }
      const nt = niceTicks(lo, hi || 1, ticksFor(ch));
      const colors = colorsFor(ch, w.names);
      return {
        model: { yMin: nt.min, yMax: nt.max, s: w.values.map((v, s) => v.map(x => (ch.hidden.has(w.names[s]) ? 0 : x))) },
        fixed: { ...w, ticks: nt.ticks, colors, ramps: colors.map(c => shades(c, 0.5, 1)), hot: colors.map(c => shades(mix(c, SNOW, 0.35), 0.6, 1)) },
      };
    },
    raster(ch, m, g) {
      const f = ch.fixed, ns = m.s.length, n = m.s[0] ? m.s[0].length : 0, o = ch.opts, hz = !!o.horizontal;
      valueAxis(ch, m, g, f.ticks, hz);
      if (!n) return;
      const L = hz ? ch.rows : ch.cols, V = hz ? ch.cols : ch.rows, span = m.yMax - m.yMin || 1;
      const { bw, at } = bandX(ch, n, L), inner = bw * 0.72, each = o.stack ? inner : inner / ns;
      const pos = v => ((v - m.yMin) / span) * V;
      for (let i = 0; i < n; i++) {
        const centre = at(i);
        let acc = 0;
        for (let s = 0; s < ns; s++) {
          const v = m.s[s][i], v0 = o.stack ? acc : 0, v1 = v0 + v;
          if (o.stack) acc = v1;
          let a0 = centre - inner / 2 + (o.stack ? 0 : s * each), a1 = a0 + each;
          if (each >= 2.5) { a0 = Math.round(a0); a1 = Math.round(a1); if (!o.stack && ns > 1 && a1 - a0 >= 3) a1 -= 1; }
          const p0 = pos(v0), p1 = pos(v1), ramp = (ch.hover === i ? f.hot : f.ramps)[s];
          const shade = (c, r) => pick(ramp, 0.35 + 0.65 * (((hz ? c : r) + 0.5 - Math.min(p0, p1)) / (Math.abs(p1 - p0) || 1)));
          if (hz) g.rect(p0, L - a1, p1, L - a0, shade); else g.rect(a0, p0, a1, p1, shade);
          if (hz && ns === 1 && o.axes !== false) ch.texts.push({ x: ch.ox + p1 * ch.cell + 6, y: ch.oy + centre * ch.cell, text: ch.format(f.values[s][i]), align: 'left', color: TEXT_HI });
        }
        const label = labelText(f.labels[i]);
        if (hz) { if (o.axes !== false) ch.labelsY.push({ y: ch.oy + centre * ch.cell, text: label.length > 11 ? label.slice(0, 10) + '…' : label }); }
      }
      if (!hz) categoryLabels(ch, f.labels.map((l, i) => ({ x: at(i), text: labelText(l), idx: i + ch.dropped })));
    },
    hit(ch, x, y) {
      const n = ch.fixed.labels.length;
      if (!n) return null;
      const hz = !!ch.opts.horizontal, { at } = bandX(ch, n, hz ? ch.rows : ch.cols);
      return seriesTip(ch, nearest(n, at, hz ? ch.rows - y : x));
    },
  };

  TYPES.scatter = {
    margin: cartesianMargin,
    legend: seriesLegend,
    model(ch) {
      const o = ch.opts, d = ch.data, xk = o.x || 'x', yk = o.y || 'y', sk = o.size;
      const names = o.by ? [...new Set(d.map(r => r[o.by]))] : [yk];
      const groups = names.map(n => d.filter(r => !o.by || r[o.by] === n));
      const vis = groups.filter((_, i) => !ch.hidden.has(names[i])).flat();
      const ext = (k) => { const v = (vis.length ? vis : d).map(r => +r[k]); const lo = Math.min(...v), hi = Math.max(...v); return [lo, hi, (hi - lo) * 0.08 || 1]; };
      const [x0, x1, xp] = ext(xk), [y0, y1, yp] = ext(yk);
      const xt = niceTicks(x0 - xp, x1 + xp, Math.max(2, Math.round(ch.cols * ch.cell / 70))), yt = niceTicks(y0 - yp, y1 + yp, ticksFor(ch));
      const rMax = sk ? Math.max(...d.map(r => +r[sk])) || 1 : 1;
      return {
        model: {
          xMin: xt.min, xMax: xt.max, yMin: yt.min, yMax: yt.max,
          X: groups.map(g => g.map(r => +r[xk])), Yv: groups.map(g => g.map(r => +r[yk])),
          R: groups.map((g, i) => g.map(r => (ch.hidden.has(names[i]) ? 0 : sk ? Math.sqrt(+r[sk] / rMax) : 1))),
        },
        fixed: { names, groups, xk, yk, sk, xticks: xt.ticks, ticks: yt.ticks, colors: colorsFor(ch, names), bubble: !!sk },
      };
    },
    seed(shown, model) { shown.X = model.X.map(a => a.slice()); shown.Yv = model.Yv.map(a => a.slice()); },
    place(ch, m) {
      const f = ch.fixed, xs = (m.xMax - m.xMin) || 1, base = Math.max(0.7, 3.2 / ch.cell);
      return (s, i) => [((m.X[s][i] - m.xMin) / xs) * ch.cols, Y(ch, m, m.Yv[s][i]), f.bubble ? m.R[s][i] * Math.max(1.2, 15 / ch.cell) : m.R[s][i] * base];
    },
    raster(ch, m, g) {
      const f = ch.fixed;
      valueAxis(ch, m, g, f.ticks);
      if (ch.opts.axes !== false) for (const t of f.xticks) {
        const x = ((t - m.xMin) / ((m.xMax - m.xMin) || 1)) * ch.cols;
        if (x < 0 || x > ch.cols) continue;
        g.vline(Math.min(ch.cols - 1, Math.floor(x)), GRID, 0.16);
        ch.labelsX.push({ x: ch.ox + x * ch.cell, text: ch.format(t) });
      }
      const at = this.place(ch, m);
      for (let s = m.X.length - 1; s >= 0; s--) for (let i = 0; i < m.X[s].length; i++) {
        const [x, y, r] = at(s, i);
        if (r < 0.05) continue;
        const hot = ch.hover === s * 1e6 + i;
        g.disc(x, y, r, hot ? mix(f.colors[s], SNOW, 0.5) : f.bubble ? mix(DARK, f.colors[s], 0.82) : f.colors[s], 0.95);
      }
    },
    hit(ch, x, y) {
      const m = ch.shown, f = ch.fixed, at = this.place(ch, m);
      let best = null, bd = Infinity;
      for (let s = 0; s < m.X.length; s++) for (let i = 0; i < m.X[s].length; i++) {
        const [px, py, r] = at(s, i);
        const d = Math.hypot(px - x, py - y) - r;
        if (r > 0.05 && d < bd && d < 2.5 + 8 / ch.cell) { bd = d; best = [s, i]; }
      }
      if (!best) return null;
      const [s, i] = best, row = f.groups[s][i];
      const rows = [{ color: f.colors[s], name: f.xk, value: ch.format(+row[f.xk]) }, { color: f.colors[s], name: f.yk, value: ch.format(+row[f.yk]) }];
      if (f.sk) rows.push({ color: f.colors[s], name: f.sk, value: ch.format(+row[f.sk]) });
      return { index: s * 1e6 + i, title: String(f.names[s]), rows };
    },
  };
  TYPES.bubble = TYPES.scatter;

  const pieLike = inner => ({
    polar: true,
    margin: polarMargin,
    legend: categoryLegend,
    hoverModel: true,
    model(ch) {
      const c = categories(ch);
      return {
        model: { v: c.values.map((v, i) => (ch.hidden.has(c.labels[i]) ? 0 : v)), ex: c.labels.map((_, i) => (i === ch.hover ? 1 : 0)) },
        fixed: { ...c, colors: colorsFor(ch, c.labels), ramps: colorsFor(ch, c.labels).map(col => shades(col, 0.55, 1)) },
      };
    },
    geometry(ch, m) {
      const cx = ch.cols / 2, cy = ch.rows / 2, R = Math.min(cx, cy) - 1.2, total = sum(m.v) || 1;
      let a = 0;
      const slices = m.v.map(v => { const a0 = a; a += (v / total) * Math.PI * 2; return [a0, a]; });
      return { cx, cy, R, r0: R * (ch.opts.inner ?? inner), slices };
    },
    raster(ch, m, g) {
      const f = ch.fixed, { cx, cy, R, r0, slices } = this.geometry(ch, m), gap = 0.45;
      for (let c = Math.floor(cx - R - 2); c <= cx + R + 2; c++) for (let r = Math.floor(cy - R - 2); r <= cy + R + 2; r++) {
        const dx = c + 0.5 - cx, dy = r + 0.5 - cy, d = Math.hypot(dx, dy);
        if (d > R + 2 || d < r0 - 1) continue;
        let ang = Math.atan2(dx, dy); if (ang < 0) ang += Math.PI * 2;
        const j = slices.findIndex(([a0, a1]) => ang >= a0 && ang < a1);
        if (j < 0) continue;
        const [a0, a1] = slices[j], Rj = R + m.ex[j] * 1.0;
        const cov = Math.min(clamp(Math.min(d - r0, Rj - d) + 0.5), clamp(Math.min(ang - a0, a1 - ang) * d - gap / 2 + 0.5));
        g.plot(c, r, cov, pick(f.ramps[j], (d - r0) / (Rj - r0 || 1) * 0.6 + 0.4 + m.ex[j] * 0.2));
      }
      if (r0 > 3 && ch.opts.axes !== false) {
        const px = ch.ox + cx * ch.cell, py = ch.oy + (ch.rows - cy) * ch.cell, size = Math.max(12, Math.min(34, r0 * ch.cell * 0.42));
        const hot = ch.hover >= 0 && ch.hover < f.labels.length;
        ch.texts.push({ x: px, y: py - size * 0.28, text: ch.format(hot ? f.values[ch.hover] : roundLike(sum(m.v), sum(ch.model.v))), font: `700 ${size}px ${MONO}`, color: TEXT_HI });
        ch.texts.push({ x: px, y: py + size * 0.55, text: hot ? String(f.labels[ch.hover]) : 'total', color: TEXT });
      }
    },
    hit(ch, x, y) {
      const { cx, cy, R, r0, slices } = this.geometry(ch, ch.shown), d = Math.hypot(x - cx, y - cy);
      if (d > R + 1.5 || d < r0 - 0.5) return null;
      let ang = Math.atan2(x - cx, y - cy); if (ang < 0) ang += Math.PI * 2;
      const j = slices.findIndex(([a0, a1]) => ang >= a0 && ang < a1);
      if (j < 0) return null;
      const f = ch.fixed, total = sum(f.values.filter((_, i) => !ch.hidden.has(f.labels[i]))) || 1;
      return { index: j, title: String(f.labels[j]), rows: [{ color: f.colors[j], name: ch.format(f.values[j]), value: Math.round((f.values[j] / total) * 100) + '%' }] };
    },
  });
  TYPES.pie = pieLike(0);
  TYPES.donut = pieLike(0.62);

  // Heatmap and calendar share one raster: a grid of value blocks coloured on the terrain ramp.
  const heat = v => (v <= 0.004 ? GRID : terrain(0.36 + 0.64 * v));
  const gridMap = {
    margin: ch => (ch.opts.axes === false ? { l: 1, r: 1, t: 1, b: 1 } : { l: 34, r: 6, t: 6, b: 20 }),
    // Block size and the empty rows above the grid, so it sits centred in the plot.
    fit(ch) {
      const { nx, ny } = ch.fixed, block = Math.max(1, Math.floor(Math.min(ch.cols / nx, ch.rows / ny)));
      return { block, gap: block >= 3 ? 1 : 0, top: Math.floor((ch.rows - ny * block) / 2) };
    },
    raster(ch, m, g) {
      const f = ch.fixed, { nx, ny } = f, { block, gap, top } = this.fit(ch);
      for (let yi = 0; yi < ny; yi++) for (let xi = 0; xi < nx; xi++) {
        const v = m.v[yi * nx + xi];
        if (v < 0) continue; // no data for this cell
        const y1 = ch.rows - top - yi * block, hot = ch.hover === yi * nx + xi;
        g.rect(xi * block, y1 - block + gap, (xi + 1) * block - gap, y1, hot ? SNOW : heat(v), v > 0.004 || hot ? 1 : 0.45);
      }
      if (ch.opts.axes === false) return;
      const cell = ch.cell, below = ch.oy + (top + ny * block) * cell + 10;
      f.yLabels.forEach((t, yi) => t && ch.labelsY.push({ y: ch.oy + (top + (yi + 0.5) * block - gap / 2) * cell, text: t }));
      const stride = Math.max(1, Math.ceil((Math.max(...f.xLabels.map(t => t.length)) * 6.3 + 12) / (block * cell)));
      f.xLabels.forEach((t, xi) => t && (f.sparse || xi % stride === 0) && ch.texts.push({ x: ch.ox + xi * block * cell, y: below, text: t, align: 'left', color: TEXT }));
    },
    hit(ch, x, y) {
      const f = ch.fixed, { block, top } = this.fit(ch), xi = Math.floor(x / block), yi = Math.floor((ch.rows - top - y) / block);
      if (xi < 0 || yi < 0 || xi >= f.nx || yi >= f.ny || ch.shown.v[yi * f.nx + xi] < 0) return null;
      const i = yi * f.nx + xi;
      return { index: i, title: f.titles[i], rows: [{ color: heat(ch.model.v[i]), name: 'value', value: ch.format(f.raw[i]) }] };
    },
  };
  TYPES.heatmap = {
    ...gridMap,
    model(ch) {
      const o = ch.opts, d = ch.data, xk = o.x || 'x', yk = o.y || 'y', vk = o.value || 'value';
      const xs = [...new Set(d.map(r => r[xk]))], ys = [...new Set(d.map(r => r[yk]))];
      const raw = new Array(xs.length * ys.length).fill(NaN), titles = [];
      for (const r of d) raw[ys.indexOf(r[yk]) * xs.length + xs.indexOf(r[xk])] = +r[vk];
      const max = Math.max(...raw.filter(isFinite)) || 1;
      ys.forEach(y => xs.forEach(x => titles.push(`${x} · ${y}`)));
      return { model: { v: raw.map(v => (isFinite(v) ? v / max : -1)) }, fixed: { nx: xs.length, ny: ys.length, raw, titles, xLabels: xs.map(String), yLabels: ys.map(String) } };
    },
  };
  TYPES.calendar = {
    ...gridMap,
    model(ch) {
      const o = ch.opts, d = ch.data, dk = o.x || 'date', vk = o.value || o.y || 'value';
      const days = d.map(r => ({ t: new Date(r[dk]), v: +r[vk] })).sort((a, b) => a.t - b.t);
      if (!days.length) return { model: { v: [] }, fixed: { nx: 0, ny: 7, raw: [], titles: [], xLabels: [], yLabels: [] } };
      const DAY = 864e5, start = new Date(days[0].t); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const nx = Math.floor((days[days.length - 1].t - start) / DAY / 7) + 1, raw = new Array(nx * 7).fill(NaN), titles = new Array(nx * 7).fill('');
      for (const { t, v } of days) {
        const i = ((t.getDay() + 6) % 7) * nx + Math.floor(Math.round((t - start) / DAY) / 7);
        raw[i] = v; titles[i] = t.toDateString();
      }
      const max = Math.max(...raw.filter(isFinite)) || 1, MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
      const xLabels = Array.from({ length: nx }, (_, w) => { const a = new Date(+start + w * 7 * DAY), b = new Date(+a - 7 * DAY); return w === 0 || a.getMonth() !== b.getMonth() ? MONTHS[a.getMonth()] : ''; });
      return { model: { v: raw.map(v => (isFinite(v) ? v / max : -1)) }, fixed: { nx, ny: 7, raw, titles, xLabels, sparse: true, yLabels: ['Mon', '', 'Wed', '', 'Fri', '', ''] } };
    },
  };

  TYPES.waffle = {
    polar: true,
    margin: polarMargin,
    legend: categoryLegend,
    model(ch) {
      const c = categories(ch);
      return { model: { v: c.values.map((v, i) => (ch.hidden.has(c.labels[i]) ? 0 : v)) }, fixed: { ...c, colors: colorsFor(ch, c.labels) } };
    },
    layout(ch) {
      const U = ch.opts.units || 100;
      let best = [10, U / 10, 0];
      for (const nx of [10, 20, 25, 50, 5]) { const ny = U / nx, k = Math.floor(Math.min(ch.cols / nx, ch.rows / ny)); if (Number.isInteger(ny) && k > best[2]) best = [nx, ny, k]; }
      const [nx, ny, k0] = best, k = Math.max(1, k0);
      return { U, nx, ny, k, block: k >= 3 ? k - 1 : k, x0: Math.floor((ch.cols - nx * k) / 2), y0: Math.floor((ch.rows - ny * k) / 2) };
    },
    owners(m, U) { // largest-remainder split of the units between categories, in typing order
      const total = sum(m.v) || 1, exact = m.v.map(v => (v / total) * U), counts = exact.map(Math.floor);
      let left = U - sum(counts);
      exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0 && m.v[i] > 0) { counts[i]++; left--; } });
      const out = [];
      counts.forEach((n, i) => { for (let k = 0; k < n; k++) out.push(i); });
      return out;
    },
    raster(ch, m, g) {
      const { U, nx, k, block, x0, y0 } = this.layout(ch), owners = this.owners(m, U), f = ch.fixed;
      owners.forEach((j, u) => {
        const ux = u % nx, uy = Math.floor(u / nx), x = x0 + ux * k, top = ch.rows - y0 - uy * k;
        const col = ch.hover === j ? mix(f.colors[j], SNOW, 0.35) : f.colors[j];
        g.rect(x, top - block, x + block, top, col);
      });
    },
    hit(ch, x, y) {
      const { U, nx, ny, k, x0, y0 } = this.layout(ch), ux = Math.floor((x - x0) / k), uy = Math.floor((ch.rows - y0 - y) / k);
      if (ux < 0 || uy < 0 || ux >= nx || uy >= ny) return null;
      const j = this.owners(ch.shown, U)[uy * nx + ux];
      if (j === undefined) return null;
      const f = ch.fixed, total = sum(f.values.filter((_, i) => !ch.hidden.has(f.labels[i]))) || 1;
      return { index: j, title: String(f.labels[j]), rows: [{ color: f.colors[j], name: ch.format(f.values[j]), value: Math.round((f.values[j] / total) * 100) + '%' }] };
    },
  };

  TYPES.radar = {
    polar: true,
    margin: () => ({ l: 30, r: 30, t: 16, b: 16 }),
    legend: seriesLegend,
    model(ch) {
      const w = wide(ch), max = niceTicks(0, Math.max(1, ...w.values.flat()), 4).max;
      return { model: { s: w.values.map(v => v.map(x => x / max)), a: w.names.map(n => (ch.hidden.has(n) ? 0 : 1)) }, fixed: { ...w, max, colors: colorsFor(ch, w.names) } };
    },
    geo(ch) { return { cx: ch.cols / 2, cy: ch.rows / 2, R: Math.min(ch.cols, ch.rows) / 2 - 1 }; },
    raster(ch, m, g) {
      const f = ch.fixed, n = f.labels.length, { cx, cy, R } = this.geo(ch);
      if (n < 3) return;
      const pt = (i, r) => [cx + Math.sin((i / n) * Math.PI * 2) * r, cy + Math.cos((i / n) * Math.PI * 2) * r];
      const ring = r => { const p = []; for (let i = 0; i <= n; i++) p.push(...pt(i % n, r)); return p; };
      for (let k = 1; k <= 4; k++) g.line(ring((R * k) / 4), 0.5, GRID, 0.45);
      for (let i = 0; i < n; i++) g.line([cx, cy, ...pt(i, R)], 0.5, ch.hover === i ? SNOW : GRID, ch.hover === i ? 0.5 : 0.4);
      const lw = Math.max(1, 2.6 / ch.cell);
      const shapes = m.s.map((v, s) => { const p = []; for (let i = 0; i <= n; i++) p.push(...pt(i % n, v[i % n] * R * m.a[s])); return p; });
      const visible = shapes.map((_, s) => s).filter(s => m.a[s] >= 0.01).reverse();
      for (const s of visible) g.polygon(shapes[s], mix(DARK, f.colors[s], 0.42), 0.62); // fills first,
      for (const s of visible) g.line(shapes[s], lw, f.colors[s]);                       // then every outline,
      for (const s of visible) for (let i = 0; i < n; i++) {                              // then the vertices
        g.disc(...pt(i, m.s[s][i] * R * m.a[s]), lw * 0.5 + 0.5, mix(f.colors[s], SNOW, ch.hover === i ? 0.6 : 0.2));
      }
      for (let i = 0; i < n; i++) {
        const sx = Math.sin((i / n) * Math.PI * 2), [x, y] = pt(i, R);
        ch.texts.push({ x: ch.ox + x * ch.cell + sx * 8, y: ch.oy + (ch.rows - y) * ch.cell - Math.cos((i / n) * Math.PI * 2) * 9, text: String(f.labels[i]), align: Math.abs(sx) < 0.2 ? 'center' : sx > 0 ? 'left' : 'right', color: ch.hover === i ? TEXT_HI : TEXT });
      }
    },
    hit(ch, x, y) {
      const f = ch.fixed, n = f.labels.length, { cx, cy, R } = this.geo(ch);
      if (n < 3 || Math.hypot(x - cx, y - cy) > R + 2) return null;
      let ang = Math.atan2(x - cx, y - cy); if (ang < 0) ang += Math.PI * 2;
      return seriesTip(ch, Math.round((ang / (Math.PI * 2)) * n) % n);
    },
  };

  TYPES.candlestick = {
    margin: cartesianMargin,
    shift: shiftAll,
    model(ch) {
      const o = ch.opts, d = ch.data, k = { o: o.open || 'open', h: o.high || 'high', l: o.low || 'low', c: o.close || 'close' };
      const lo = Math.min(...d.map(r => +r[k.l])), hi = Math.max(...d.map(r => +r[k.h])), pad = (hi - lo) * 0.08 || 1;
      const nt = niceTicks(lo - pad, hi + pad, ticksFor(ch));
      return {
        model: { yMin: nt.min, yMax: nt.max, s: [d.map(r => +r[k.o]), d.map(r => +r[k.h]), d.map(r => +r[k.l]), d.map(r => +r[k.c])] },
        fixed: { labels: d.map(r => r[o.x || firstKey(r, false)]), ticks: nt.ticks, rows: d, k, up: shades(UP, 0.55, 1), down: shades(DOWN, 0.55, 1) },
      };
    },
    raster(ch, m, g) {
      const f = ch.fixed, [O, H, L, C] = m.s, n = O.length;
      valueAxis(ch, m, g, f.ticks);
      if (!n) return;
      const { bw, at } = bandX(ch, n, ch.cols), last = C[n - 1], up = last >= O[n - 1];
      const lastRow = Math.min(ch.rows - 1, Math.max(0, Math.floor(Y(ch, m, last))));
      g.hline(lastRow, up ? UP : DOWN, 0.3);
      if (ch.hover >= 0) g.vline(Math.floor(at(ch.hover)), GRID, 0.45);
      categoryLabels(ch, f.labels.map((l, i) => ({ x: at(i), text: labelText(l), idx: i + ch.dropped })));
      const ww = clamp(bw * 0.14, 0.4, 1);
      for (let i = 0; i < n; i++) {
        const x = at(i), rising = C[i] >= O[i], ramp = rising ? f.up : f.down, hot = ch.hover === i;
        g.rect(x - ww / 2, Y(ch, m, L[i]), x + ww / 2, Y(ch, m, H[i]), pick(ramp, hot ? 1 : 0.45));
        let y0 = Y(ch, m, Math.min(O[i], C[i])), y1 = Y(ch, m, Math.max(O[i], C[i]));
        if (y1 - y0 < 0.7) { const mid = (y0 + y1) / 2; y0 = mid - 0.35; y1 = mid + 0.35; }
        g.rect(x - bw * 0.34, y0, x + bw * 0.34, y1, (_, r) => pick(ramp, hot ? 1 : 0.6 + 0.4 * ((r + 0.5 - y0) / (y1 - y0 || 1))));
      }
      if (ch.opts.axes !== false) ch.texts.push({ x: ch.ox + ch.cols * ch.cell - 3, y: ch.oy + (ch.rows - lastRow - 0.5) * ch.cell, text: ch.format(last), align: 'right', color: '#111a20', bg: css(up ? UP : DOWN), font: `700 10px ${MONO}` });
    },
    hit(ch, x) {
      const f = ch.fixed, n = f.rows.length;
      if (!n) return null;
      const i = nearest(n, bandX(ch, n, ch.cols).at, x), r = f.rows[i], col = +r[f.k.c] >= +r[f.k.o] ? UP : DOWN;
      return { index: i, title: labelText(f.labels[i]), rows: ['o', 'h', 'l', 'c'].map(k => ({ color: col, name: { o: 'open', h: 'high', l: 'low', c: 'close' }[k], value: ch.format(+r[f.k[k]]) })) };
    },
  };

  TYPES.gauge = {
    polar: true,
    margin: polarMargin,
    model(ch) {
      const o = ch.opts, min = o.min ?? 0, max = o.max ?? 100;
      return { model: { f: clamp(((+o.value || 0) - min) / (max - min || 1)) }, fixed: { min, max } };
    },
    raster(ch, m, g) {
      const f = ch.fixed, span = Math.PI * 1.5, start = -Math.PI * 0.75;
      const R = Math.min(ch.cols / 2 - 1, (ch.rows - 2) / 1.707), cx = ch.cols / 2, cy = 1 + 0.707 * R + (ch.rows - 2 - 1.707 * R) / 2, r0 = R * 0.74;
      for (let c = Math.floor(cx - R - 1); c <= cx + R + 1; c++) for (let r = Math.floor(cy - R - 1); r <= cy + R + 1; r++) {
        const dx = c + 0.5 - cx, dy = r + 0.5 - cy, d = Math.hypot(dx, dy);
        const rel = (Math.atan2(dx, dy) - start) / span;
        const radial = clamp(Math.min(d - r0, R - d) + 0.5), ends = clamp(Math.min(rel, 1 - rel) * span * d + 0.5);
        const base = Math.min(radial, ends);
        if (base <= 0) continue;
        const fill = Math.min(base, clamp((m.f - rel) * span * d + 0.5));
        if (fill > 0.02) g.plot(c, r, fill, rel > m.f - 0.02 ? SNOW : terrain(0.5 + 0.5 * (rel / Math.max(m.f, 0.01)) * (0.6 + 0.4 * m.f)));
        else g.plot(c, r, base * 0.26, GRID);
      }
      const px = ch.ox + cx * ch.cell, py = ch.oy + (ch.rows - cy) * ch.cell, size = Math.max(14, Math.min(40, r0 * ch.cell * 0.5));
      ch.texts.push({ x: px, y: py - size * 0.1, text: ch.format(roundLike(f.min + m.f * (f.max - f.min), +ch.opts.value || 0)), font: `700 ${size}px ${MONO}`, color: TEXT_HI });
      if (ch.opts.label) ch.texts.push({ x: px, y: py + size * 0.7, text: ch.opts.label, color: TEXT });
    },
    hit(ch) { return { index: 0, title: ch.opts.label || 'value', rows: [{ color: PALETTE[0], name: 'of ' + ch.format(ch.fixed.max), value: ch.format(+ch.opts.value) }] }; },
  };

  TYPES.treemap = {
    polar: true,
    margin: polarMargin,
    model(ch) {
      const c = categories(ch), order = c.values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(p => p[1]);
      const colors = colorsFor(ch, c.labels);
      return { model: { v: c.values }, fixed: { ...c, order, colors, max: Math.max(...c.values) || 1 } };
    },
    squarify(ch, m) {
      const items = ch.fixed.order.map(i => [i, m.v[i]]).filter(p => p[1] > 1e-6), out = [];
      let x = 0, y = 0, w = ch.cols, h = ch.rows, k = 0;
      const total = sum(items.map(p => p[1])) || 1, area = items.map(p => (p[1] / total) * w * h);
      const worst = (row, s) => { const t = sum(row); return Math.max(...row.map(a => Math.max((s * s * a) / (t * t), (t * t) / (s * s * a)))); };
      while (k < items.length) {
        const short = Math.min(w, h), row = [];
        let best = Infinity;
        while (k < items.length) { const next = worst([...row, area[k]], short); if (row.length && next > best) break; row.push(area[k++]); best = next; }
        const thick = sum(row) / short, first = k - row.length;
        let p = 0;
        row.forEach((a, j) => {
          const len = a / thick, i = items[first + j][0];
          out.push(w >= h ? [i, x, y + p, thick, len] : [i, x + p, y, len, thick]);
          p += len;
        });
        if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      }
      return out;
    },
    raster(ch, m, g) {
      const f = ch.fixed, rects = this.squarify(ch, m);
      ch.rects = rects;
      for (const [i, x, y, w, h] of rects) {
        const snap = w >= 3 && h >= 3;
        const x0 = snap ? Math.round(x) : x + 0.25, x1 = snap ? Math.round(x + w) - 1 : x + w - 0.25;
        const y0 = snap ? Math.round(y) + 1 : y + 0.25, y1 = snap ? Math.round(y + h) : y + h - 0.25;
        const base = mix(f.colors[f.order.indexOf(i) % f.colors.length], SNOW, ch.hover === i ? 0.3 : 0), ramp = shades(base, 0.45 + 0.3 * (m.v[i] / f.max), 1, 8);
        g.rect(x0, y0, x1, y1, (_, r) => pick(ramp, (r + 0.5 - y0) / (y1 - y0 || 1)));
        if (w * ch.cell > 64 && h * ch.cell > 34) {
          const tx = ch.ox + x0 * ch.cell + 6, ty = ch.oy + (ch.rows - y1) * ch.cell + 11;
          ch.texts.push({ x: tx, y: ty, text: String(f.labels[i]), align: 'left', color: TEXT_HI, bg: 'rgba(12,21,26,.82)', font: `700 11px ${MONO}` });
          ch.texts.push({ x: tx, y: ty + 18, text: ch.format(f.values[i]), align: 'left', color: '#b7c2bc', bg: 'rgba(12,21,26,.82)' });
        }
      }
    },
    hit(ch, x, y) {
      const r = (ch.rects || []).find(([, rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h);
      if (!r) return null;
      const f = ch.fixed, i = r[0];
      return { index: i, title: String(f.labels[i]), rows: [{ color: f.colors[f.order.indexOf(i) % f.colors.length], name: 'size', value: ch.format(f.values[i]) }] };
    },
  };

  // ── The chart instance ─────────────────────────────────────────────────────────────────
  const all = new Set();
  let defaults = { cell: 'normal' };

  class Chart {
    constructor(target, options) {
      this.el = typeof target === 'string' ? document.querySelector(target) : target;
      this.el.classList.add('cc');
      this.canvas = this.el.appendChild(document.createElement('canvas'));
      this.tip = this.el.appendChild(Object.assign(document.createElement('div'), { className: 'cc-tip' }));
      this.ctx = this.canvas.getContext('2d');
      this.layer = document.createElement('canvas');
      this.hidden = new Set();
      Object.assign(this, { hover: -1, off: 0, dropped: 0, pushEvery: 1, lastPush: 0, live: false, visible: true, pcell: -1 });
      this.labelsX = []; this.labelsY = []; this.texts = [];
      this.opts = {}; this.data = [];
      this.update(options);
      this.born = performance.now();
      new ResizeObserver(() => { this.layout(); wake(this); }).observe(this.canvas);
      new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) wake(this); }).observe(this.el);
      this.canvas.addEventListener('pointermove', e => this.pointer(e));
      this.canvas.addEventListener('pointerleave', () => this.pointer(null));
      all.add(this);
    }

    /** Change any option (including data or type); the chart animates to the new state. */
    update(options = {}) {
      const typeChanged = options.type && options.type !== this.opts.type && this.type;
      Object.assign(this.opts, options);
      if ('data' in options) this.data = (options.data || []).slice();
      this.type = TYPES[this.opts.type];
      if (!this.type) throw new Error(`craggy-charts: unknown chart type "${this.opts.type}"`);
      const fm = this.opts.format;
      this.format = typeof fm === 'function' ? fm : FORMATS[fm] || compact;
      if (typeChanged) { this.shown = undefined; this.hover = -1; }
      if (typeChanged || 'cell' in options || 'horizontal' in options || 'axes' in options) this.layout();
      this.rebuild();
      return this;
    }
    /** Append rows. With `window`, the oldest rows scroll off the left edge. */
    push(...rows) {
      const now = performance.now();
      if (this.lastPush) this.pushEvery = this.pushEvery * 0.6 + clamp((now - this.lastPush) / 1000, 0.05, 5) * 0.4;
      this.lastPush = now;
      for (const row of rows) {
        this.data.push(row);
        if (this.opts.window) this.off += 1;
        if (this.opts.window && this.data.length > this.opts.window) { this.data.shift(); this.dropped++; this.shown && this.type.shift && this.type.shift(this); }
      }
      this.rebuild();
      return this;
    }
    /** Replace the newest row, e.g. a live price tick inside the current candle. */
    patch(row) { this.data[this.data.length - 1] = { ...this.data[this.data.length - 1], ...row }; this.rebuild(); return this; }
    destroy() { all.delete(this); awake.delete(this); this.el.replaceChildren(); }

    rebuild() {
      const { model, fixed } = this.type.model(this);
      this.model = model; this.fixed = fixed;
      if (!this.shown) {
        this.shown = zero(model);
        for (const k of ['yMin', 'yMax', 'xMin', 'xMax']) if (k in model) this.shown[k] = model[k];
        if (this.type.seed) this.type.seed(this.shown, model);
      }
      this.legend();
      wake(this);
    }

    cellSize() { const c = this.opts.cell ?? defaults.cell; return typeof c === 'string' ? CELLS[c] : c; }

    layout() {
      const rect = this.canvas.getBoundingClientRect(), W = rect.width, H = rect.height;
      if (W < 4 || H < 4) return;
      const dpr = window.devicePixelRatio || 1, cell = this.cellSize();
      const m = this.type.margin(this);
      const cols = Math.max(1, Math.floor((W - m.l - m.r) / cell)), rows = Math.max(1, Math.floor((H - m.t - m.b) / cell));
      Object.assign(this, { W, H, dpr, cell, cols, rows });
      this.ox = m.l + ((W - m.l - m.r) - cols * cell) * (this.type.polar ? 0.5 : 0);
      this.oy = m.t + ((H - m.t - m.b) - rows * cell) * (this.type.polar ? 0.5 : 1);
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
      const n = cols * rows;
      if (!this.size || this.size.length !== n) {
        this.tcov = new Float32Array(n); this.tcol = new Float32Array(n * 3);
        this.size = new Float32Array(n); this.vel = new Float32Array(n);
        this.col = new Float32Array(n * 3); this.glow = new Float32Array(n);
      }
      this.g = raster(this);
      // Unlit tiles never change, so they are drawn once into a cached layer.
      const L = this.layer;
      L.width = this.canvas.width; L.height = this.canvas.height;
      const lc = L.getContext('2d');
      lc.setTransform(dpr, 0, 0, dpr, 0, 0);
      const p = new Path2D(), t = cell * TILE, inset = (cell - t) / 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tile(p, this.ox + c * cell + inset, this.oy + r * cell + inset, t, cell * RADIUS);
      lc.fillStyle = css(UNLIT);
      lc.fill(p);
      this.rebuild(); // tick density and label fit depend on size
    }

    frame(now, dt) {
      if (!this.cols) return false;
      active = false; seedPrev = !!this.opts.window;
      const still = reduceMotion.matches || this.opts.animate === false;
      this.shown = approach(this.shown, this.model, still ? 1 : 1 - Math.exp(-dt * 7));
      if (this.off > 0) { this.off = still ? 0 : Math.max(0, this.off - (dt * (1 + Math.max(0, this.off - 1) * 2)) / this.pushEvery); active = true; }
      const { cols, rows, tcov, tcol, size, vel, col, glow } = this, n = cols * rows;
      tcov.fill(0);
      this.labelsX.length = this.labelsY.length = this.texts.length = 0;
      this.live = false;
      this.type.raster(this, this.shown, this.g, now);
      if (this.live) active = true;
      // Entrance: tiles switch on in a sweep from bottom-left, like the terminal "typing" the chart in.
      const reveal = still ? 1 : clamp((now - this.born) / 1100);
      if (reveal < 1) {
        active = true;
        const edge = ease(reveal) * 1.25;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ((c / cols) * 0.8 + ((rows - 1 - r) / rows) * 0.45 > edge) tcov[r * cols + c] = 0;
      }
      // Springs: the same constants as the website's scroll strip (slight overshoot, quick settle).
      for (let i = 0; i < n; i++) {
        const t = tcov[i];
        if (still) { size[i] = t; vel[i] = 0; }
        else { vel[i] = (vel[i] + (t - size[i]) * 0.17) * 0.7; size[i] += vel[i]; }
        if (t > 0) {
          const k = still || size[i] < 0.05 ? 1 : 0.22, j = i * 3;
          col[j] += (tcol[j] - col[j]) * k; col[j + 1] += (tcol[j + 1] - col[j + 1]) * k; col[j + 2] += (tcol[j + 2] - col[j + 2]) * k;
          if (k < 1 && Math.abs(tcol[j] - col[j]) + Math.abs(tcol[j + 1] - col[j + 1]) + Math.abs(tcol[j + 2] - col[j + 2]) > 3) active = true;
        }
        if (glow[i] > 0.01) { glow[i] *= 0.9; active = true; } else glow[i] = 0;
        if (!active && (Math.abs(vel[i]) > 1e-3 || Math.abs(t - size[i]) > 3e-3)) active = true;
      }
      this.draw();
      return active;
    }

    draw() {
      const { ctx, dpr, cell, cols, rows, ox, oy, size, col, glow } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.layer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Lit tiles, batched into one path per (quantised) colour.
      const full = cell * TILE, paths = new Map();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, a = Math.min(1.18, size[i]), gl = glow[i];
        if (a < 0.02 && gl < 0.03) continue;
        const mk = clamp(a * 1.3), j = i * 3;
        let R = UNLIT[0] + (col[j] - UNLIT[0]) * mk, G = UNLIT[1] + (col[j + 1] - UNLIT[1]) * mk, B = UNLIT[2] + (col[j + 2] - UNLIT[2]) * mk;
        if (gl >= 0.03) { const k = gl * 0.6; R += (SNOW[0] - R) * k; G += (SNOW[1] - G) * k; B += (SNOW[2] - B) * k; }
        const s = Math.max(a >= 0.02 ? full * (0.3 + 0.7 * a) : 0, full * gl);
        const key = ((clamp(R, 0, 255) >> 3) << 10) | ((clamp(G, 0, 255) >> 3) << 5) | (clamp(B, 0, 255) >> 3);
        let p = paths.get(key);
        if (!p) paths.set(key, (p = new Path2D()));
        const inset = (cell - s) / 2;
        tile(p, ox + c * cell + inset, oy + r * cell + inset, s, cell * RADIUS * (s / full));
      }
      for (const [key, p] of paths) {
        ctx.fillStyle = `rgb(${((key >> 10) & 31) * 8 + 4},${((key >> 5) & 31) * 8 + 4},${(key & 31) * 8 + 4})`;
        ctx.fill(p);
      }
      // Text stays real text: crisp at every resolution and readable by the browser.
      ctx.font = `10px ${MONO}`; ctx.fillStyle = TEXT;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const l of this.labelsY) ctx.fillText(l.text, ox - 8, l.y);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const l of this.labelsX) ctx.fillText(l.text, l.x, oy + rows * cell + 6);
      for (const t of this.texts) {
        ctx.font = t.font || `10px ${MONO}`; ctx.textAlign = t.align || 'center'; ctx.textBaseline = 'middle';
        if (t.bg) {
          const w = ctx.measureText(t.text).width + 10, x = t.align === 'right' ? t.x - w + 5 : t.x - 5;
          ctx.fillStyle = t.bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, t.y - 8, w, 16, 3) : ctx.rect(x, t.y - 8, w, 16); ctx.fill();
        }
        ctx.fillStyle = t.color || TEXT;
        ctx.fillText(t.text, t.x, t.y);
      }
    }

    pointer(e) {
      if (!e) { this.tip.classList.remove('on'); this.setHover(-1); this.pcell = -1; return; }
      const b = this.canvas.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
      const x = (px - this.ox) / this.cell, y = this.rows - (py - this.oy) / this.cell;
      const c = Math.floor(x), r = Math.floor(y);
      if (c >= 0 && c < this.cols && r >= 0 && r < this.rows && !reduceMotion.matches) {
        const i = (this.rows - 1 - r) * this.cols + c;
        if (i !== this.pcell) { this.glow[i] = 1; this.pcell = i; wake(this); }
      }
      const hit = this.opts.tooltip === false || !this.type.hit ? null : this.type.hit(this, x, y);
      this.setHover(hit ? hit.index : -1);
      if (!hit) { this.tip.classList.remove('on'); return; }
      this.tip.innerHTML = `<div class="cc-tip-title">${esc(hit.title)}</div>` + hit.rows.map(row =>
        `<div class="cc-tip-row"><i style="background:${css(row.color)}"></i><span>${esc(row.name)}</span><b>${esc(row.value)}</b></div>`).join('');
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight, ex = this.canvas.offsetLeft, ey = this.canvas.offsetTop;
      const left = px + 16 + tw > this.W ? px - tw - 16 : px + 16;
      this.tip.style.transform = `translate(${Math.max(0, left) + ex}px, ${clamp(py - th / 2, 0, this.H - th) + ey}px)`;
      this.tip.classList.add('on');
    }
    setHover(i) {
      if (i === this.hover) return;
      this.hover = i;
      if (this.type.hoverModel) this.rebuild(); else wake(this);
    }

    legend() {
      const items = this.type.legend ? this.type.legend(this) : null;
      const show = items && (this.opts.legend ?? items.length > 1);
      if (!show) { if (this.legendEl) { this.legendEl.remove(); this.legendEl = null; this.legendKey = ''; } return; }
      const key = items.map(i => i.name + css(i.color)).join('|') + '/' + [...this.hidden].join('|');
      if (key === this.legendKey) return;
      this.legendKey = key;
      if (!this.legendEl) { this.legendEl = document.createElement('div'); this.legendEl.className = 'cc-legend'; this.el.insertBefore(this.legendEl, this.canvas); }
      this.legendEl.replaceChildren(...items.map(it => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cc-key' + (this.hidden.has(it.name) ? ' off' : '');
        b.innerHTML = `<i style="background:${css(it.color)}"></i>${esc(it.name)}`;
        b.onclick = () => { this.hidden.has(it.name) ? this.hidden.delete(it.name) : this.hidden.add(it.name); this.rebuild(); };
        return b;
      }));
    }
  }

  function tile(p, x, y, s, rad) {
    if (rad > 0.6 && p.roundRect) p.roundRect(x, y, s, s, Math.min(rad, s / 2));
    else p.rect(x, y, s, s);
  }

  const style = document.createElement('style');
  style.textContent = `
.cc{position:relative;display:flex;flex-direction:column;font:11px ${MONO};color:${TEXT_HI}}
.cc>canvas{flex:1;min-height:0;width:100%;display:block;touch-action:pan-y}
.cc-legend{display:flex;flex-wrap:wrap;gap:4px 14px;padding:0 0 8px 2px}
.cc-key{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:7px;color:#b7c2bc;font-size:11px;transition:opacity .2s,color .2s}
.cc-key:hover{color:#fff}.cc-key:focus-visible{outline:1px solid #ffb547;outline-offset:3px}
.cc-key i{width:8px;height:8px;border-radius:2px}.cc-key.off{opacity:.35}
.cc-tip{position:absolute;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .15s,transform .08s ease-out;background:rgba(12,21,26,.94);border:1px solid #2a3639;border-radius:4px;padding:8px 10px;min-width:120px;backdrop-filter:blur(6px);box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:2}
.cc-tip.on{opacity:1}.cc-tip-title{color:#9ba9a6;margin-bottom:5px}
.cc-tip-row{display:flex;align-items:center;gap:8px;line-height:1.7}.cc-tip-row i{width:8px;height:8px;border-radius:2px}
.cc-tip-row span{flex:1;color:#b7c2bc}.cc-tip-row b{font-weight:700;font-variant-numeric:tabular-nums}`;
  document.head.appendChild(style);

  document.fonts && document.fonts.ready.then(() => all.forEach(wake));
  reduceMotion.addEventListener && reduceMotion.addEventListener('change', () => all.forEach(wake));

  window.CraggyCharts = {
    chart: (target, options) => new Chart(target, options),
    /** Set defaults for every chart that does not override them, e.g. { cell: 'fine' }. */
    defaults(next) { Object.assign(defaults, next); all.forEach(ch => { ch.layout(); wake(ch); }); },
    types: Object.keys(TYPES),
    instances: all,
  };
})();
