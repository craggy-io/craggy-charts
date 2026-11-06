// Performance budgets (PLAN section 8), measured as main-thread time per chart frame.
// Headless Chromium renders WebGL with SwiftShader and canvas text in software (both on the CPU), so
// these numbers are pessimistic next to a real GPU. The `perf` project runs this file alone, after
// every other spec, so parallel workers do not skew the timings.
import { test, expect } from '@playwright/test';

test('worst case: full-screen two-series area with new data every frame', async ({ page }) => {
  await page.goto('blank.html');
  const ms = await page.evaluate(() => {
    const { ChartCore } = (window as any).CraggyCharts;
    const data = Array.from({ length: 300 }, (_, i) => ({ a: Math.sin(i / 10) * 50 + 50, b: Math.cos(i / 13) * 30 + 40 }));
    const c = new ChartCore({ type: 'area', data });
    c.setSize(1100, 700); // 6px cells → ~20k tiles
    const tiles = c.grid.cols * c.grid.rows;
    for (let i = 0; i < 30; i++) c.frame(i * 16, 1 / 60); // warm up
    const t0 = performance.now();
    const N = 200;
    for (let i = 0; i < N; i++) { c.update({ data: data.map(r => ({ a: r.a + (i % 7), b: r.b })) }); c.frame(1000 + i * 16, 1 / 60); }
    return { per: (performance.now() - t0) / N, tiles };
  });
  console.log(`core frame incl. data update: ${ms.per.toFixed(3)} ms for ${ms.tiles} tiles`);
  expect(ms.tiles).toBeGreaterThan(19000);
  // Not a PLAN budget: data normally arrives at most ~10 Hz. Guards against regressions in rebuild + fill.
  expect(ms.per).toBeLessThan(2);
});

test('steady-state frame (springs + rasterise) under 0.5 ms at 20k tiles', async ({ page }) => {
  await page.goto('blank.html');
  const per = await page.evaluate(() => {
    const { ChartCore } = (window as any).CraggyCharts;
    const c = new ChartCore({ type: 'line', data: Array.from({ length: 200 }, (_, i) => Math.sin(i / 8) * 40 + 50) });
    c.setSize(1100, 700);
    for (let i = 0; i < 100; i++) c.frame(i * 16, 1 / 60); // past the entrance sweep
    const t0 = performance.now();
    let moving = true;
    for (let i = 0; i < 300; i++) moving = c.frame(2000 + i * 16, 1 / 60);
    return { per: (performance.now() - t0) / 300, moving };
  });
  console.log(`steady frame: ${per.per.toFixed(3)} ms`);
  expect(per.per).toBeLessThan(0.5);
  expect(per.moving).toBe(false); // a settled chart reports idle, so the shared scheduler stops calling it
});

test('50 live charts: script time per frame fits a 60 fps budget', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto('blank.html');
  const r = await page.evaluate(async () => {
    const C = (window as any).CraggyCharts;
    document.body.innerHTML = '';
    document.body.style.cssText = 'display:grid;grid-template-columns:repeat(10,150px);gap:4px;margin:0';
    const charts: any[] = [];
    for (let i = 0; i < 50; i++) {
      const el = document.body.appendChild(document.createElement('div'));
      el.style.height = '90px';
      charts.push(C.chart(el, { type: i % 3 === 0 ? 'bar' : i % 3 === 1 ? 'area' : 'line', data: [], window: 40, axes: i % 2 === 0 }));
    }
    // Instrument: time spent in chart ticks per animation frame.
    let tickTime = 0;
    for (const c of charts) { const orig = c.tick.bind(c); c.tick = (n: number, d: number) => { const t = performance.now(); const m = orig(n, d); tickTime += performance.now() - t; return m; }; }
    let k = 0;
    const timer = setInterval(() => { k++; for (const c of charts) c.push({ v: Math.sin(k / 5 + charts.indexOf(c)) * 40 + 50 }); }, 100);
    await new Promise(res => setTimeout(res, 1000));
    const frames: number[] = [];
    tickTime = 0;
    const start = performance.now();
    await new Promise<void>(res => { const loop = (t: number) => { frames.push(t); if (t - start < 3000) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
    clearInterval(timer);
    return { frames: frames.length, scriptPerFrame: tickTime / frames.length, awake: C.awakeCount() };
  });
  console.log(`50 live charts: ${r.frames} frames in 3s, ${r.scriptPerFrame.toFixed(2)} ms chart script per frame`);
  expect(r.scriptPerFrame).toBeLessThan(12); // leaves headroom inside a 16.7 ms frame
});

test('1M points render through M4 decimation', async ({ page }) => {
  await page.goto('blank.html');
  const ms = await page.evaluate(() => {
    const { ChartCore } = (window as any).CraggyCharts;
    const data = new Array(1_000_000);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 5000) * 50 + Math.sin(i / 7) * 3;
    const t0 = performance.now();
    const c = new ChartCore({ type: 'line', data });
    c.setSize(800, 300);
    c.settle();
    const build = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) c.frame(5000 + i * 16, 1 / 60);
    return { build, frame: (performance.now() - t1) / 10, lit: c.litTiles() };
  });
  console.log(`1M points: build ${ms.build.toFixed(0)} ms, frame ${ms.frame.toFixed(1)} ms`);
  expect(ms.lit).toBeGreaterThan(100);
  expect(ms.build).toBeLessThan(1500);
  expect(ms.frame).toBeLessThan(16); // geometry is cached until something moves, so hover stays smooth
});

test('bundle stays under 40 KB gzipped', async () => {
  const { readFileSync } = await import('node:fs');
  const { gzipSync } = await import('node:zlib');
  const size = gzipSync(readFileSync(new URL('../../dist/craggy-charts.global.js', import.meta.url))).length;
  console.log(`global bundle: ${(size / 1024).toFixed(1)} KB gzipped`);
  expect(size).toBeLessThan(40 * 1024);
});
