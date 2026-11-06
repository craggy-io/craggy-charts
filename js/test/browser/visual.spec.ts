// Visual goldens: every conformance fixture, settled, through the WebGL2 renderer, plus a set through
// the Canvas2D fallback. Update with: npx playwright test visual --update-snapshots
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixtures: { name: string; width: number; height: number }[] = JSON.parse(readFileSync(new URL('../../../conformance/fixtures.json', import.meta.url), 'utf8'));
const CANVAS2D = ['line', 'bar-stacked', 'pie', 'heatmap', 'stat', 'light'];

async function shot(page: any, name: string, renderer: string, w: number, h: number) {
  await page.goto(`fixture.html?name=${name}&renderer=${renderer}`);
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  expect(await page.evaluate(() => (window as any).CraggyCharts.rendererKind())).toBe(renderer);
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
}

for (const f of fixtures) {
  test(`webgl2 ${f.name}`, async ({ page }) => {
    expect(await shot(page, f.name, 'webgl2', f.width, f.height)).toMatchSnapshot(`${f.name}.png`);
  });
}

for (const name of CANVAS2D) {
  const f = fixtures.find(x => x.name === name)!;
  test(`canvas2d ${name}`, async ({ page }) => {
    expect(await shot(page, name, 'canvas2d', f.width, f.height)).toMatchSnapshot(`${name}-canvas2d.png`);
  });
}
