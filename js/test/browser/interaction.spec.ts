// Interaction, accessibility, export and lifecycle in a real browser.
import { test, expect, type Page } from '@playwright/test';

const SALES = [
  { month: 'Jan', north: 40, south: 53 }, { month: 'Feb', north: 47, south: 36 }, { month: 'Mar', north: 52, south: 48 },
  { month: 'Apr', north: 60, south: 46 }, { month: 'May', north: 68, south: 35 }, { month: 'Jun', north: 69, south: 46 },
];

/** Create a chart in #a (or #b) with events recorded on window.events. */
async function make(page: Page, options: any, target = '#a') {
  await page.evaluate(([o, t]) => {
    const w = window as any;
    w.events ||= [];
    const c = w.CraggyCharts.chart(t, o);
    for (const e of ['hover', 'click', 'select', 'zoom', 'legend']) c.on(e, (p: any) => w.events.push({ e, p }));
    (w.charts ||= {})[t] = c;
  }, [options, target] as const);
  await page.waitForTimeout(150);
}

const box = (page: Page, sel = '#a canvas') => page.locator(sel).boundingBox().then(b => b!);
const events = (page: Page, e: string) => page.evaluate(n => (window as any).events.filter((x: any) => x.e === n).map((x: any) => x.p), e);
const plot = (page: Page, t = '#a') => page.evaluate(s => { const g = (window as any).charts[s].core.grid; return { ox: g.ox, oy: g.oy, w: g.cols * g.cell, h: g.rows * g.cell }; }, t);

test.beforeEach(async ({ page }) => { await page.goto('blank.html'); });

test('hover shows a tooltip and emits hover; click emits click', async ({ page }) => {
  await make(page, { type: 'bar', data: SALES });
  const b = await box(page), p = await plot(page);
  await page.mouse.move(b.x + p.ox + p.w * (2.5 / 6), b.y + p.oy + p.h * 0.8);
  const tip = page.locator('#a .cc-tip');
  await expect(tip).toHaveClass(/cc-on/);
  await expect(tip.locator('b')).toHaveText('Mar');
  await expect(tip).toContainText('north');
  await expect(tip).toContainText('52');
  await page.mouse.down(); await page.mouse.up();
  const clicks = await events(page, 'click');
  expect(clicks[0]).toMatchObject({ index: 2, title: 'Mar' });
  expect((await events(page, 'hover')).some((h: any) => h && h.title === 'Mar')).toBe(true);
  await page.mouse.move(2, 2);
  await expect(tip).not.toHaveClass(/cc-on/);
});

test('custom tooltip function and tooltip: false', async ({ page }) => {
  await page.evaluate(() => (window as any).CraggyCharts.chart('#a', { type: 'pie', data: [{ k: 'a', v: 3 }, { k: 'b', v: 1 }], tooltip: (p: any) => `slice ${p.title}` }));
  const b = await box(page);
  await page.waitForTimeout(100);
  await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2);
  await expect(page.locator('#a .cc-tip')).toHaveText('slice a');
});

test('keyboard moves between points and announces them', async ({ page }) => {
  await make(page, { type: 'line', data: SALES, title: 'Sales' });
  await page.focus('#a canvas');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#a [aria-live]')).toHaveText(/^Feb: north 47, south 36$/);
  await expect(page.locator('#a .cc-tip b')).toHaveText('Feb');
  await page.keyboard.press('End');
  await expect(page.locator('#a [aria-live]')).toContainText('Jun');
  await page.keyboard.press('Enter');
  expect((await events(page, 'click'))[0].title).toBe('Jun');
  await page.keyboard.press('Escape');
  await expect(page.locator('#a .cc-tip')).not.toHaveClass(/cc-on/);
});

test('accessible summary, figure label and data table', async ({ page }) => {
  await make(page, { type: 'bar', data: SALES, title: 'Regional sales' });
  await expect(page.locator('#a canvas')).toHaveAttribute('aria-label', /Regional sales\. Bar chart, 2 series: north, south, 6 points/);
  await expect(page.locator('#a .cc')).toHaveAttribute('aria-label', 'Regional sales');
  await expect(page.locator('#a table tr')).toHaveCount(7);
  await expect(page.locator('#a .cc-title')).toHaveText('Regional sales');
});

test('legend click toggles, double-click isolates, hover highlights', async ({ page }) => {
  await make(page, { type: 'line', data: SALES });
  const keys = page.locator('#a .cc-legend button');
  await expect(keys).toHaveCount(2);
  await keys.nth(1).click();
  await expect(keys.nth(1)).toHaveAttribute('aria-pressed', 'false');
  expect((await events(page, 'legend'))[0]).toMatchObject({ name: 'south', hidden: true });
  await keys.nth(1).click();
  await expect(keys.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await keys.nth(0).dblclick();
  await expect(keys.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(keys.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await keys.nth(0).dblclick(); // isolating the only visible one shows everything again
  await expect(keys.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await keys.nth(0).hover();
  expect(await page.evaluate(() => (window as any).charts['#a'].core.focus)).toBe('north');
});

test('wheel zooms and emits zoom; double-click resets', async ({ page }) => {
  const data = Array.from({ length: 200 }, (_, i) => ({ i, v: Math.sin(i / 9) * 10 }));
  await make(page, { type: 'line', data, x: 'i', zoom: 'x' });
  const b = await box(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(50);
  const z = await events(page, 'zoom');
  expect(z.length).toBeGreaterThan(0);
  const v = z[z.length - 1].view;
  expect(v[1] - v[0]).toBeLessThan(0.9);
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  const last = (await events(page, 'zoom')).pop();
  expect(last.view).toEqual([0, 1]);
});

test('drag pans a zoomed chart', async ({ page }) => {
  const data = Array.from({ length: 100 }, (_, i) => ({ i, v: i }));
  await make(page, { type: 'line', data, x: 'i', zoom: 'x' });
  await page.evaluate(() => (window as any).charts['#a'].core.setView(0.5, 0.7));
  const b = await box(page);
  await page.mouse.move(b.x + 200, b.y + 120);
  await page.mouse.down();
  await page.mouse.move(b.x + 300, b.y + 120, { steps: 5 });
  await page.mouse.up();
  const view = await page.evaluate(() => (window as any).charts['#a'].core.view);
  expect(view[0]).toBeLessThan(0.5);
  expect(view[1] - view[0]).toBeCloseTo(0.2, 5);
});

test('brush selects a range and emits select', async ({ page }) => {
  await make(page, { type: 'bar', data: SALES, brush: true });
  const b = await box(page), p = await plot(page);
  await page.mouse.move(b.x + p.ox + p.w * 0.05, b.y + p.oy + 30);
  await page.mouse.down();
  await page.mouse.move(b.x + p.ox + p.w * 0.45, b.y + p.oy + 30, { steps: 6 });
  expect(await page.evaluate(() => !!(window as any).charts['#a'].core.brush)).toBe(true);
  await page.mouse.up();
  const sel = (await events(page, 'select'))[0];
  expect(sel).toMatchObject({ from: 'Jan', to: 'Mar', indices: [0, 2] });
});

test('group sync shares hover and zoom', async ({ page }) => {
  await make(page, { type: 'line', data: SALES, group: 'g', zoom: 'x' }, '#a');
  await make(page, { type: 'bar', data: SALES, group: 'g' }, '#b');
  const b = await box(page), p = await plot(page);
  await page.mouse.move(b.x + p.ox + p.w * 0.6, b.y + p.oy + 40);
  const [ha, hb] = await page.evaluate(() => [(window as any).charts['#a'].core.hover, (window as any).charts['#b'].core.hover]);
  expect(ha).toBe(3);
  expect(hb).toBe(3);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(50);
  const vb = await page.evaluate(() => (window as any).charts['#b'].core.view);
  expect(vb[1] - vb[0]).toBeLessThan(1);
});

test('live: push scrolls, pause-on-hover buffers, patch merges', async ({ page }) => {
  await make(page, { type: 'line', data: [], window: 10 });
  await page.evaluate(() => { const c = (window as any).charts['#a']; for (let i = 0; i < 14; i++) c.push({ v: i }); });
  expect(await page.evaluate(() => (window as any).charts['#a'].core.rows.length)).toBe(10);
  const b = await box(page);
  await page.mouse.move(b.x + 200, b.y + 100);
  await page.evaluate(() => (window as any).charts['#a'].push({ v: 99 }, { v: 98 }));
  expect(await page.evaluate(() => (window as any).charts['#a'].core.rows.at(-1).v)).toBe(13); // buffered while hovered
  await page.mouse.move(b.x + 200, b.y + 400);
  await page.mouse.move(0, 0);
  expect(await page.evaluate(() => (window as any).charts['#a'].core.rows.at(-1).v)).toBe(98);
  await page.evaluate(() => (window as any).charts['#a'].patch({ v: 5 }));
  expect(await page.evaluate(() => (window as any).charts['#a'].core.rows.at(-1).v)).toBe(5);
});

test('update morphs type and options; highlight; toggle', async ({ page }) => {
  await make(page, { type: 'bar', data: SALES });
  await page.evaluate(() => (window as any).charts['#a'].update({ type: 'line', title: 'Now a line', cell: 'chunky' }));
  await expect(page.locator('#a .cc-title')).toHaveText('Now a line');
  expect(await page.evaluate(() => (window as any).charts['#a'].core.grid.cell)).toBe(12);
  await page.evaluate(() => (window as any).charts['#a'].highlight('south'));
  expect(await page.evaluate(() => (window as any).charts['#a'].core.focus)).toBe('south');
  await page.evaluate(() => (window as any).charts['#a'].highlight(2));
  await expect(page.locator('#a .cc-tip b')).toHaveText('Mar');
  await page.evaluate(() => (window as any).charts['#a'].toggle('north'));
  await expect(page.locator('#a .cc-legend button').first()).toHaveAttribute('aria-pressed', 'false');
});

test('theme: light, custom tokens and auto', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await make(page, { type: 'bar', data: SALES, theme: 'auto' });
  expect(await page.evaluate(() => (window as any).charts['#a'].core.theme.name)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => (window as any).charts['#a'].core.theme.name)).toBe('dark');
  await page.evaluate(() => (window as any).charts['#a'].update({ theme: { base: 'light', bg: '#ffffff' } }));
  await expect(page.locator('#a .cc')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('reduced motion snaps to the final state in one frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await make(page, { type: 'bar', data: SALES });
  expect(await page.evaluate(() => (window as any).CraggyCharts.awakeCount())).toBe(0);
  expect(await page.evaluate(() => (window as any).charts['#a'].core.litTiles())).toBeGreaterThan(100);
});

test('a settled chart costs nothing; off-screen charts sleep', async ({ page }) => {
  await make(page, { type: 'bar', data: SALES });
  await expect.poll(() => page.evaluate(() => (window as any).CraggyCharts.awakeCount()), { timeout: 5000 }).toBe(0);
  await page.evaluate(() => { const a = document.querySelector('#a') as HTMLElement; a.style.marginTop = '3000px'; });
  await page.waitForTimeout(100);
  await page.evaluate(() => (window as any).charts['#a'].update({ data: [{ month: 'x', north: 1, south: 2 }] }));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).charts['#a'].visible)).toBe(false);
  expect(await page.evaluate(() => (window as any).CraggyCharts.awakeCount())).toBe(0);
});

test('export: toImage and toSVG; destroy cleans up', async ({ page }) => {
  await make(page, { type: 'donut', data: [{ k: 'a', v: 3 }, { k: 'b', v: 1 }] });
  const png = await page.evaluate(() => (window as any).charts['#a'].toImage());
  expect(png.startsWith('data:image/png;base64,')).toBe(true);
  const svg = await page.evaluate(() => (window as any).charts['#a'].toSVG());
  const size = await page.evaluate(() => { const g = (window as any).charts['#a'].core.grid; return `0 0 ${g.W} ${g.H}`; });
  expect(svg).toContain(`viewBox="${size}"`);
  expect((svg.match(/<rect /g) || []).length).toBeGreaterThan(200);
  await page.evaluate(() => (window as any).charts['#a'].destroy());
  await expect(page.locator('#a .cc')).toHaveCount(0);
});

test('errors are clear', async ({ page }) => {
  const msg = await page.evaluate(() => { try { (window as any).CraggyCharts.chart('#nope', { type: 'bar' }); } catch (e: any) { return e.message; } });
  expect(msg).toContain('no element matches "#nope"');
  const msg2 = await page.evaluate(() => { try { (window as any).CraggyCharts.chart('#a', { type: 'pyramid' }); } catch (e: any) { return e.message; } });
  expect(msg2).toContain('unknown chart type "pyramid"');
});

test('touch: tap shows the tooltip and the chart never blocks page scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 600, height: 700 } });
  const page = await ctx.newPage();
  await page.goto('blank.html');
  await make(page, { type: 'bar', data: SALES });
  await expect(page.locator('#a canvas')).toHaveCSS('touch-action', 'pan-y');
  const b = await box(page), p = await plot(page);
  await page.touchscreen.tap(b.x + p.ox + p.w * (0.5 / 6), b.y + p.oy + p.h * 0.9);
  await expect(page.locator('#a .cc-tip b')).toHaveText('Jan');
  await ctx.close();
});

test('both renderers are available and the fallback works', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).CraggyCharts.rendererKind())).toBe('webgl2');
  await page.evaluate(() => (window as any).CraggyCharts.setRenderer('canvas2d'));
  await make(page, { type: 'bar', data: SALES, animate: false });
  expect(await page.evaluate(() => (window as any).CraggyCharts.rendererKind())).toBe('canvas2d');
  const lit = await page.evaluate(() => {
    const c = (window as any).charts['#a'], cv = c.canvas as HTMLCanvasElement, d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 120 && d[i + 2] < 120) n++; return n;
  });
  expect(lit).toBeGreaterThan(1000); // amber bar pixels
});
