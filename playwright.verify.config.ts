import path from 'node:path';
import { defineConfig, devices } from 'playwright/test';

const testBuild = path.resolve(
  process.env.GAME_TEST_BUILD || 'test-results/verify/reference/build-test',
);
const productionBuild = path.resolve(
  process.env.GAME_PRODUCTION_BUILD || 'test-results/verify/reference/build',
);
const outputDir = path.resolve(
  process.env.GAME_PLAYWRIGHT_OUTPUT || 'test-results/verify/reference/playwright',
);

function quote(argument: string): string {
  return `"${argument.replaceAll('"', '\\"')}"`;
}

export default defineConfig({
  testDir: './tests/browser',
  outputDir,
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
      command: `npm.cmd run game:serve -- --root ${quote(testBuild)} --port 4173`,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm.cmd run game:serve -- --root ${quote(productionBuild)} --port 4174`,
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
