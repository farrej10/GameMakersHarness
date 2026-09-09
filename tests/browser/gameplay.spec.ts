import { expect, test, type Page, type TestInfo } from 'playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  GameDebug,
  GameSnapshot,
  RuleFunctions,
  ScenarioId,
} from '../../src/contracts/index';

type DebugGlobal = typeof globalThis & { gameDebug: GameDebug };
type PolicyGlobal = typeof globalThis & {
  ruleTestApi: RuleFunctions;
};

const expectedSpec = JSON.parse(
  readFileSync(
    process.env.GAME_SPEC_PATH || path.resolve('tests/fixtures/reference/game-spec.json'),
    'utf8',
  ),
) as { title: string; collectibles: { count: number }; player: { health: number } };

async function openTestGame(page: Page): Promise<void> {
  await page.goto('/?clock=manual');
  await expect(page.locator('canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean((globalThis as Partial<DebugGlobal>).gameDebug)))
    .toBe(true);
}

async function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => (globalThis as DebugGlobal).gameDebug.snapshot());
}

async function loadScenario(page: Page, id: ScenarioId): Promise<GameSnapshot> {
  await page.evaluate(
    (scenarioId) => (globalThis as DebugGlobal).gameDebug.loadScenario(scenarioId),
    id,
  );
  return snapshot(page);
}

async function advance(page: Page, ticks: number): Promise<GameSnapshot> {
  await page.evaluate(
    (count) => (globalThis as DebugGlobal).gameDebug.advanceTicks(count),
    ticks,
  );
  return snapshot(page);
}

async function start(page: Page): Promise<void> {
  await page.getByTestId('start-button').click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
}

async function holdForTicks(
  page: Page,
  key: string,
  ticks: number,
): Promise<GameSnapshot> {
  await page.keyboard.down(key);
  const result = await advance(page, ticks);
  await page.keyboard.up(key);
  return result;
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

test('PLAY-01 actual generated game loads with its HUD', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await openTestGame(page);
  await expect(page.getByTestId('game-title')).toHaveText(expectedSpec.title);
  await expect(page.getByTestId('game-score')).toHaveText(`Score: 0/${expectedSpec.collectibles.count}`);
  await expect(page.getByTestId('game-health')).toHaveText(`Health: ${expectedSpec.player.health}/${expectedSpec.player.health}`);
  await expect(page.getByTestId('game-state')).toHaveText('READY');
  await expect(page.getByText(/Move with WASD or arrow keys/)).toBeVisible();
  await capture(page, testInfo, 'generated-start');

  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('debug snapshots are isolated and commands reject invalid input', async ({ page }) => {
  await openTestGame(page);
  const before = await snapshot(page);
  const afterMutation = await page.evaluate(() => {
    const copy = (globalThis as DebugGlobal).gameDebug.snapshot();
    copy.player.x = -999;
    copy.collectibles.length = 0;
    return (globalThis as DebugGlobal).gameDebug.snapshot();
  });
  expect(afterMutation).toEqual(before);

  const errors = await page.evaluate(() => {
    const debug = (globalThis as DebugGlobal).gameDebug;
    const messages: string[] = [];
    for (const count of [0, 601, 1.5]) {
      try {
        debug.advanceTicks(count);
      } catch (error) {
        messages.push(error instanceof Error ? error.message : String(error));
      }
    }
    try {
      debug.loadScenario('invented' as ScenarioId);
    } catch (error) {
      messages.push(error instanceof Error ? error.message : String(error));
    }
    return messages;
  });
  expect(errors).toHaveLength(4);
  expect(errors.slice(0, 3)).toEqual([
    'Tick count must be an integer from 1 through 600.',
    'Tick count must be an integer from 1 through 600.',
    'Tick count must be an integer from 1 through 600.',
  ]);
  expect(errors[3]).toBe('Unknown debug scenario: invented');
});

test('PLAY-02 and PLAY-03 keyboard movement is exact and normalized', async ({
  page,
}, testInfo) => {
  await openTestGame(page);
  let initial = await loadScenario(page, 'movement');
  await start(page);
  let moved = await holdForTicks(page, 'ArrowRight', 30);
  expect(moved.player.x - initial.player.x).toBeCloseTo(90, 2);
  expect(moved.player.y).toBeCloseTo(initial.player.y, 10);

  initial = await loadScenario(page, 'movement');
  await start(page);
  moved = await holdForTicks(page, 'KeyD', 30);
  expect(moved.player.x - initial.player.x).toBeCloseTo(90, 2);

  initial = await loadScenario(page, 'movement');
  await start(page);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowDown');
  moved = await advance(page, 30);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowDown');
  expect(
    Math.hypot(
      moved.player.x - initial.player.x,
      moved.player.y - initial.player.y,
    ),
  ).toBeCloseTo(90, 2);
  await capture(page, testInfo, 'active-gameplay');
});

test('PLAY-04 player stays within all radius-adjusted boundaries', async ({ page }) => {
  await openTestGame(page);
  await loadScenario(page, 'movement');
  await start(page);
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowUp');
  let state = await advance(page, 600);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
  expect(state.player.x).toBe(12);
  expect(state.player.y).toBe(12);

  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowDown');
  state = await advance(page, 600);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowDown');
  expect(state.player.x).toBe(788);
  expect(state.player.y).toBe(588);
});

test('PLAY-05 collection scores once and removes the item', async ({ page }) => {
  await openTestGame(page);
  await loadScenario(page, 'collection');
  await start(page);
  let state = await holdForTicks(page, 'ArrowRight', 20);
  expect(state.score).toBe(1);
  expect(state.collectibles.map(({ id }) => id)).not.toContain('c1');
  state = await advance(page, 1);
  expect(state.score).toBe(1);
});

test('PLAY-06 damage observes its exact 60-tick cooldown', async ({ page }) => {
  await openTestGame(page);
  await loadScenario(page, 'damage');
  await start(page);
  let state = await advance(page, 1);
  expect(state.player.health).toBe(2);
  expect(state.player.nextDamageTick).toBe(61);
  state = await advance(page, 59);
  expect(state.player.health).toBe(2);
  state = await advance(page, 1);
  expect(state.player.health).toBe(1);
});

test('PLAY-07 collect-then-exit requires both score and exit contact', async ({
  page,
}, testInfo) => {
  await openTestGame(page);
  await loadScenario(page, 'win');
  await start(page);
  let state = await holdForTicks(page, 'ArrowRight', 60);
  expect(state.score).toBe(3);
  expect(state.state).toBe('playing');
  state = await holdForTicks(page, 'ArrowRight', 30);
  expect(state.state).toBe('won');
  await expect(page.getByTestId('game-overlay')).toHaveText('YOU WIN');
  await capture(page, testInfo, 'win');
});

test('PLAY-08 loss freezes movement', async ({ page }, testInfo) => {
  await openTestGame(page);
  await loadScenario(page, 'loss');
  await start(page);
  let state = await advance(page, 1);
  expect(state.player.health).toBe(0);
  expect(state.state).toBe('lost');
  const x = state.player.x;
  state = await holdForTicks(page, 'ArrowRight', 30);
  expect(state.player.x).toBe(x);
  await expect(page.getByTestId('game-overlay')).toHaveText('GAME OVER');
  await capture(page, testInfo, 'loss');
});

test('PLAY-09 restart restores the selected scenario', async ({ page }) => {
  await openTestGame(page);
  const initial = await loadScenario(page, 'win');
  await start(page);
  await holdForTicks(page, 'ArrowRight', 90);
  expect((await snapshot(page)).state).toBe('won');

  await page.getByTestId('restart-button').click();
  const restarted = await snapshot(page);
  expect(restarted.state).toBe('ready');
  expect(restarted.tick).toBe(0);
  expect(restarted.score).toBe(0);
  expect(restarted.player.health).toBe(3);
  expect(restarted.player.nextDamageTick).toBe(0);
  expect(restarted.player.x).toBe(initial.player.x);
  expect(restarted.player.y).toBe(initial.player.y);
  expect(restarted.collectibles).toEqual(initial.collectibles);
  expect(restarted.input).toEqual({
    up: false,
    down: false,
    left: false,
    right: false,
  });
});

test('PLAY-10 lethal contact wins a simultaneous victory tie', async ({ page }) => {
  await openTestGame(page);
  await loadScenario(page, 'tie');
  await start(page);
  const state = await advance(page, 1);
  expect(state.score).toBe(3);
  expect(state.player.health).toBe(0);
  expect(state.state).toBe('lost');
});

test('POLICY-01 and POLICY-02 generated enemy policies pass their truth tables', async ({
  page,
}) => {
  await page.goto('/policy-test.html');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((globalThis as Partial<PolicyGlobal>).ruleTestApi),
      ),
    )
    .toBe(true);

  const velocities = await page.evaluate(() => {
    const api = (globalThis as PolicyGlobal).ruleTestApi;
    const bounds = { minX: 12, maxX: 788, minY: 12, maxY: 588 };
    const chase = (enemyX: number, enemyY: number, playerX: number, playerY: number) =>
      api.getEnemyVelocity({
        behavior: 'chase',
        enemy: { x: enemyX, y: enemyY, vx: 0, vy: 0 },
        player: { x: playerX, y: playerY },
        speed: 10,
        bounds,
      });
    const patrol = (x: number, vx: number) =>
      api.getEnemyVelocity({
        behavior: 'horizontal-patrol',
        enemy: { x, y: 100, vx, vy: 5 },
        player: { x: 0, y: 0 },
        speed: 10,
        bounds,
      });
    return {
      cardinal: chase(0, 0, 10, 0),
      diagonal: chase(0, 0, 3, 4),
      coincident: chase(5, 5, 5, 5),
      leftEdge: patrol(12, -10),
      rightEdge: patrol(788, 10),
      retainLeft: patrol(400, -10),
      initiallyRight: patrol(400, 0),
    };
  });

  expect(velocities.cardinal).toEqual({ x: 10, y: 0 });
  expect(velocities.diagonal.x).toBeCloseTo(6, 10);
  expect(velocities.diagonal.y).toBeCloseTo(8, 10);
  expect(Math.hypot(velocities.diagonal.x, velocities.diagonal.y)).toBeCloseTo(10, 10);
  expect(velocities.coincident).toEqual({ x: 0, y: 0 });
  expect(velocities.leftEdge).toEqual({ x: 10, y: 0 });
  expect(velocities.rightEdge).toEqual({ x: -10, y: 0 });
  expect(velocities.retainLeft).toEqual({ x: -10, y: 0 });
  expect(velocities.initiallyRight).toEqual({ x: 10, y: 0 });
});

test('POLICY-03 generated victory policy passes both mode truth tables', async ({ page }) => {
  await page.goto('/policy-test.html');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((globalThis as Partial<PolicyGlobal>).ruleTestApi),
      ),
    )
    .toBe(true);
  const results = await page.evaluate(() => {
    const api = (globalThis as PolicyGlobal).ruleTestApi;
    return [
      api.isVictory({ mode: 'collect-all', score: 2, target: 3, atExit: false }),
      api.isVictory({ mode: 'collect-all', score: 3, target: 3, atExit: false }),
      api.isVictory({ mode: 'collect-all', score: 4, target: 3, atExit: false }),
      api.isVictory({ mode: 'collect-then-exit', score: 3, target: 3, atExit: false }),
      api.isVictory({ mode: 'collect-then-exit', score: 2, target: 3, atExit: true }),
      api.isVictory({ mode: 'collect-then-exit', score: 3, target: 3, atExit: true }),
      api.isVictory({ mode: 'collect-then-exit', score: 4, target: 3, atExit: true }),
    ];
  });
  expect(results).toEqual([false, true, true, false, false, true, true]);
});

test('LEVEL-PLAY-01 bot collects an item on the actual generated level', async ({ page }) => {
  await openTestGame(page);
  await start(page);
  const initial = await snapshot(page);
  const nearest = initial.collectibles.reduce((best, candidate) => {
    const distance = (item: typeof candidate) =>
      Math.hypot(item.x - initial.player.x, item.y - initial.player.y);
    return distance(candidate) < distance(best) ? candidate : best;
  });

  let state = initial;
  for (let elapsed = 0; elapsed < 600 && state.score === 0; elapsed += 5) {
    const horizontal = nearest.x - state.player.x;
    const vertical = nearest.y - state.player.y;
    const keys = [
      horizontal > 4 ? 'ArrowRight' : horizontal < -4 ? 'ArrowLeft' : null,
      vertical > 4 ? 'ArrowDown' : vertical < -4 ? 'ArrowUp' : null,
    ].filter((key): key is string => key !== null);
    for (const key of keys) await page.keyboard.down(key);
    state = await advance(page, 5);
    for (const key of keys) await page.keyboard.up(key);
  }

  expect(state.score).toBeGreaterThanOrEqual(1);
  expect(state.collectibles.length).toBeLessThan(initial.collectibles.length);
});

test('PROD-01 production has no debug hook and responds to real-time input', async ({
  page,
}) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await page.goto('http://127.0.0.1:4174/?clock=manual');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  expect(
    await page.evaluate(
      () => (globalThis as Partial<DebugGlobal>).gameDebug,
    ),
  ).toBeUndefined();
  await page.getByTestId('start-button').click();
  const before = await canvas.screenshot();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowRight');
  const after = await canvas.screenshot();

  await expect(page.getByTestId('game-state')).toHaveText('PLAYING');
  expect(after.equals(before)).toBe(false);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
