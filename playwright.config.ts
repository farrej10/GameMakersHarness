import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results/playwright',
  fullyParallel: false,
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: [
    {
      command: 'npm.cmd run dev:test -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        'npm.cmd run build && npm.cmd run preview -- --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
