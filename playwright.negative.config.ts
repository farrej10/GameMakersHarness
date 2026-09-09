import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'rules-guard.spec.ts',
  outputDir: './test-results/negative-rules',
  workers: 1,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4175',
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --mode test-broken-rules --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
