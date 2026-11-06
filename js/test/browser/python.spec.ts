// The Python package end to end: its anywidget front end, and a page saved by Chart.save().
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const python = fileURLToPath(new URL('../../../python', import.meta.url));

test('anywidget front end: options, height, push and click events', async ({ page }) => {
  await page.goto('widget.html');
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  const canvas = page.locator('#w canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Bar chart, 1 series: v, 2 points/);
  expect(await page.locator('#w').evaluate(el => el.style.height)).toBe('240px');

  await page.evaluate(() => (window as any).model.set('options', { type: 'line', data: [1, 2, 3] }));
  await expect(canvas).toHaveAttribute('aria-label', /Line chart/);
  await page.evaluate(() => (window as any).model.emit('msg:custom', { kind: 'push', rows: [4, 5] }));
  await expect(canvas).toHaveAttribute('aria-label', /5 points/, { timeout: 2000 });

  await page.evaluate(() => (window as any).model.set('options', { type: 'bar', data: [{ m: 'Jan', v: 3 }] }));
  const b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height * 0.7);
  await expect.poll(() => page.evaluate(() => (window as any).sent.map((m: any) => m.event))).toContain('click');

  await page.evaluate(() => (window as any).cleanup());
  await expect(page.locator('#w canvas')).toHaveCount(0);
});

test('Chart.save() writes a standalone page that renders', async ({ page }) => {
  const out = fileURLToPath(new URL('./out', import.meta.url));
  mkdirSync(out, { recursive: true });
  const file = `${out}/py-chart.html`.replace(/\\/g, '/');
  execFileSync('uv', ['run', '--project', python, 'python', '-c',
    `import craggy_charts as cc, pandas as pd
df = pd.DataFrame({"v": [3, 1, 4, 1, 5]}, index=pd.date_range("2024-01-01", periods=5, name="day"))
cc.chart(df, type="area", title="From Python").save(r"${file}")`], { stdio: 'pipe' });
  await page.goto('out/py-chart.html');
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /Area chart, 1 series: v, 5 points/);
  await expect(page.locator('.cc-title')).toHaveText('From Python');
});
