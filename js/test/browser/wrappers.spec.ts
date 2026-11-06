// The React wrapper and the <craggy-chart> Web Component.
import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test.beforeAll(async () => {
  await build({
    entryPoints: [fileURLToPath(new URL('./react-entry.tsx', import.meta.url))],
    outfile: fileURLToPath(new URL('./react.bundle.js', import.meta.url)),
    bundle: true, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
  });
});

test('React: renders, forwards events and updates on prop change', async ({ page }) => {
  await page.goto('react.html');
  const canvas = page.locator('.cc canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Bar chart/);
  const b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.6);
  await expect(page.locator('#clicks')).toHaveText('1');
  await page.evaluate(() => (window as any).setType('line'));
  await expect(canvas).toHaveAttribute('aria-label', /Line chart/);
  await expect(page.locator('.cc')).toHaveCount(1); // updated in place, not re-created
});

test('Web Component: attributes, JSON attributes and src', async ({ page }) => {
  await page.goto('element.html');
  const a = page.locator('#a canvas'), b = page.locator('#b canvas');
  await expect(a).toHaveAttribute('aria-label', /Bar chart, 1 series: v, 3 points/);
  await expect(b).toHaveAttribute('aria-label', /Line chart, 1 series: rev, 4 points. Values from \$\d/);
  await page.evaluate(() => document.querySelector('#a')!.setAttribute('type', 'line'));
  await expect(a).toHaveAttribute('aria-label', /Line chart/);
  await page.evaluate(() => { (document.querySelector('#a') as any).data = [{ day: 'Thu', v: 1 }]; });
  await expect(a).toHaveAttribute('aria-label', /1 points/);
  await page.evaluate(() => document.querySelector('#a')!.remove());
  await expect(page.locator('#a')).toHaveCount(0);
});
