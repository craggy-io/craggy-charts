import { defineConfig, devices } from '@playwright/test';

const chrome = { ...devices['Desktop Chrome'], deviceScaleFactor: 1, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };

export default defineConfig({
  testDir: 'test/browser',
  timeout: 60_000,
  expect: { toMatchSnapshot: { maxDiffPixelRatio: 0.002 } },
  snapshotPathTemplate: '{testDir}/goldens/{arg}-{projectName}{ext}',
  use: { baseURL: 'http://localhost:5173/js/test/browser/', deviceScaleFactor: 1, viewport: { width: 1000, height: 800 } },
  projects: [
    { name: 'chromium', use: chrome, testIgnore: /perf\.spec\.ts/ },
    // Timing budgets run alone, after everything else, so parallel workers do not skew them.
    { name: 'perf', use: chrome, testMatch: /perf\.spec\.ts/, dependencies: ['chromium'], fullyParallel: false },
  ],
  webServer: { command: 'node test/browser/serve.mjs', port: 5173, reuseExistingServer: true },
});
