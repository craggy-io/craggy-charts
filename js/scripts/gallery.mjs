// Renders the README images at 4K (3840 × 2160): 1920 × 1080 CSS pixels at device scale 2, so every tile
// is rendered rather than upscaled.
//   docs/assets/gallery.png    nine conformance fixtures in a 3 × 3 grid, settled
//   docs/assets/dashboard.png  examples/js/live-dashboard.html after a few seconds of live data
//
//   cd js && npm run build && npm run gallery
import { chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);  // the repository root
const NAMES = ['area-stacked', 'bar-grouped', 'line-annotations', 'heatmap', 'donut', 'candlestick', 'treemap', 'radar', 'calendar'];
const fixtures = JSON.parse(readFileSync(new URL('conformance/fixtures.json', root), 'utf8'));
const options = NAMES.map(n => {
  const f = fixtures.find(x => x.name === n);
  if (!f) throw new Error(`no fixture named ${n}`);
  return f.options;
});

const galleryHtml = `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: #111a20; }
  body { width: 1920px; height: 1080px; box-sizing: border-box; padding: 24px; display: grid; gap: 24px;
         grid-template: repeat(3, 1fr) / repeat(3, 1fr); }
</style>
${NAMES.map(() => '<div></div>').join('')}
<script src="${new URL('js/dist/craggy-charts.global.js', root)}"></script>
<script>
  const options = ${JSON.stringify(options)};
  document.querySelectorAll('body > div').forEach((el, i) => CraggyCharts.chart(el, { ...options[i], animate: false }));
  requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
</script>`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

/** Opens a file:// URL at 4K, runs `ready`, and writes a screenshot to docs/assets/<name>. */
async function shoot(url, name, ready) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(url);
  await ready(page);
  await page.mouse.move(0, 0);
  const out = fileURLToPath(new URL(`docs/assets/${name}`, root));
  await page.screenshot({ path: out });
  await page.close();
  console.log(`wrote ${out}`);
}

// The gallery is generated, so it goes through a temporary file:// page that can load the local bundle.
const dir = mkdtempSync(join(tmpdir(), 'craggy-gallery-'));
try {
  const file = join(dir, 'gallery.html');
  writeFileSync(file, galleryHtml);
  // Charts are drawn settled (animate: false); wait two frames for the first paint.
  await shoot(pathToFileURL(file).href, 'gallery.png', p => p.waitForSelector('body[data-ready]', { timeout: 30_000 }));
  // The dashboard streams, so let a window of live data arrive and the animations finish.
  await shoot(new URL('examples/js/live-dashboard.html', root).href, 'dashboard.png', p => p.waitForTimeout(12_000));
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
if (errors.length) throw new Error(errors.join('\n'));
