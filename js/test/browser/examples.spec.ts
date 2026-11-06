// Every JS example in ../examples/js loads, draws and logs no errors.
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pages: [string, number][] = [
  ['quickstart.html', 1],
  ['live-dashboard.html', 7],
  ['web-component.html', 4],
];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

// Served over http, and opened straight from disk (a double-click), where module scripts and fetch fail.
for (const [file, charts] of pages) {
  for (const [how, url] of [['served', `/examples/js/${file}`], ['from file://', pathToFileURL(fileURLToPath(new URL(`../../../examples/js/${file}`, import.meta.url))).href]]) {
    test(`example ${file} draws ${charts} chart(s), ${how}`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(url);
      // Each chart labels its canvas with a summary once it has data.
      await expect.poll(() => page.locator('canvas[aria-label]').count(), { timeout: 15_000 }).toBe(charts);
      expect(errors).toEqual([]);
    });
  }
}

test('live dashboard streams, morphs and reports events', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/examples/js/live-dashboard.html');
  const cpu = page.locator('#cpu canvas[aria-label]');
  await expect(cpu).toHaveAttribute('aria-label', /\b[3-9] points|\b\d\d points/, { timeout: 15_000 });
  await page.click('#morph');
  await expect(page.locator('#hourly canvas[aria-label]')).toHaveAttribute('aria-label', /Area chart/, { timeout: 5_000 });
  const box = (await page.locator('#hourly').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#log')).toHaveText(/^click \d+h: reads \d+/);
  expect(errors).toEqual([]);
});

test('terminal example prints a coloured field for each type', () => {
  const script = fileURLToPath(new URL('../../../examples/js/terminal.mjs', import.meta.url));
  for (const type of ['area', 'bar', 'donut', 'heatmap', 'treemap']) {
    const out = execFileSync(process.execPath, [script, type], { encoding: 'utf8' });
    const lines = out.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(15);             // the tile rows (the axes take a few) and the summary
    expect(out).toMatch(/\x1b\[38;2;\d+;\d+;\d+m██/);     // some fully covered, coloured tiles
    expect(lines.at(-1)!.toLowerCase()).toContain(type);  // "Area chart, …"
  }
});
