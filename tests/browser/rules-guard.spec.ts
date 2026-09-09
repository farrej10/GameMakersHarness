import { expect, test } from 'playwright/test';
import type { RuleFunctions } from '../../src/contracts/index';

type PolicyGlobal = typeof globalThis & { ruleTestApi: RuleFunctions };

test('POLICY-GUARD requires normalized chase and exit-aware victory', async ({ page }) => {
  await page.goto('/policy-test.html');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((globalThis as Partial<PolicyGlobal>).ruleTestApi),
      ),
    )
    .toBe(true);

  const result = await page.evaluate(() => {
    const api = (globalThis as PolicyGlobal).ruleTestApi;
    const velocity = api.getEnemyVelocity({
      behavior: 'chase',
      enemy: { x: 0, y: 0, vx: 0, vy: 0 },
      player: { x: 3, y: 4 },
      speed: 10,
      bounds: { minX: 12, maxX: 788, minY: 12, maxY: 588 },
    });
    return {
      magnitude: Math.hypot(velocity.x, velocity.y),
      prematureVictory: api.isVictory({
        mode: 'collect-then-exit',
        score: 3,
        target: 3,
        atExit: false,
      }),
    };
  });

  expect(result.magnitude).toBeCloseTo(10, 10);
  expect(result.prematureVictory).toBe(false);
});
