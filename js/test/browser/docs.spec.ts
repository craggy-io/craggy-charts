// The docs gallery loads, renders every fixture and logs no errors.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('../../../conformance/fixtures.json', import.meta.url), 'utf8'));

test('gallery renders every fixture without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/docs/index.html');
  await expect.poll(() => page.locator('canvas[aria-label]').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(fixtures.length);
  expect(errors).toEqual([]);
});
