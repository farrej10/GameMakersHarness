import type {
  GameSnapshot,
  GameSpec,
  InputState,
  RuleFunctions,
} from '../contracts/index';
import {
  clampCenter,
  circlesOverlap,
  COLLECTIBLE_RADIUS,
  ENEMY_RADIUS,
  EXIT_RADIUS,
  PLAYER_RADIUS,
} from './geometry';
import { cloneSnapshot } from './state';

export const SIMULATION_HZ = 60;
export const FIXED_STEP_SECONDS = 1 / SIMULATION_HZ;
export const DAMAGE_COOLDOWN_TICKS = 60;

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedFrame(
  state: GameSnapshot,
  input: InputState,
  message: string,
): GameSnapshot {
  const failed = cloneSnapshot(state);
  failed.input = { ...input };
  failed.errors.push(message);
  return failed;
}

export function stepGame(
  state: GameSnapshot,
  input: InputState,
  rules: RuleFunctions,
  spec: GameSpec,
): GameSnapshot {
  if (state.state !== 'playing') {
    return cloneSnapshot(state);
  }

  const next = cloneSnapshot(state);
  next.input = { ...input };
  next.tick += 1;

  let inputX = Number(input.right) - Number(input.left);
  let inputY = Number(input.down) - Number(input.up);
  const inputLength = Math.hypot(inputX, inputY);
  if (inputLength > 1) {
    inputX /= inputLength;
    inputY /= inputLength;
  }

  next.player.x = clampCenter(
    next.player.x + inputX * spec.player.speed * FIXED_STEP_SECONDS,
    PLAYER_RADIUS,
    spec.arena.width,
  );
  next.player.y = clampCenter(
    next.player.y + inputY * spec.player.speed * FIXED_STEP_SECONDS,
    PLAYER_RADIUS,
    spec.arena.height,
  );

  for (const enemy of next.enemies) {
    let velocity;
    try {
      velocity = rules.getEnemyVelocity({
        behavior: spec.enemies.behavior,
        enemy: { ...enemy },
        player: { x: next.player.x, y: next.player.y },
        speed: spec.enemies.speed,
        bounds: {
          minX: ENEMY_RADIUS,
          maxX: spec.arena.width - ENEMY_RADIUS,
          minY: ENEMY_RADIUS,
          maxY: spec.arena.height - ENEMY_RADIUS,
        },
      });
    } catch (error) {
      return failedFrame(
        state,
        input,
        `Enemy policy failed for ${enemy.id}: ${safeMessage(error)}`,
      );
    }

    if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
      return failedFrame(
        state,
        input,
        `Enemy policy returned a non-finite velocity for ${enemy.id}.`,
      );
    }

    enemy.vx = velocity.x;
    enemy.vy = velocity.y;
  }

  for (const enemy of next.enemies) {
    enemy.x = clampCenter(
      enemy.x + enemy.vx * FIXED_STEP_SECONDS,
      ENEMY_RADIUS,
      spec.arena.width,
    );
    enemy.y = clampCenter(
      enemy.y + enemy.vy * FIXED_STEP_SECONDS,
      ENEMY_RADIUS,
      spec.arena.height,
    );
  }

  const remainingCollectibles = [];
  for (const collectible of next.collectibles) {
    if (
      circlesOverlap(
        { ...next.player, radius: PLAYER_RADIUS },
        { ...collectible, radius: COLLECTIBLE_RADIUS },
      )
    ) {
      next.score += 1;
    } else {
      remainingCollectibles.push(collectible);
    }
  }
  next.collectibles = remainingCollectibles;

  const touchesEnemy = next.enemies.some((enemy) =>
    circlesOverlap(
      { ...next.player, radius: PLAYER_RADIUS },
      { ...enemy, radius: ENEMY_RADIUS },
    ),
  );
  if (touchesEnemy && next.tick >= next.player.nextDamageTick) {
    next.player.health = Math.max(0, next.player.health - 1);
    next.player.nextDamageTick = next.tick + DAMAGE_COOLDOWN_TICKS;
  }

  if (next.player.health === 0) {
    next.state = 'lost';
    return next;
  }

  const atExit = circlesOverlap(
    { ...next.player, radius: PLAYER_RADIUS },
    { ...next.exit, radius: EXIT_RADIUS },
  );

  let won: boolean;
  try {
    won = rules.isVictory({
      mode: spec.objective.mode,
      score: next.score,
      target: spec.collectibles.count,
      atExit,
    });
  } catch (error) {
    return failedFrame(
      state,
      input,
      `Victory policy failed: ${safeMessage(error)}`,
    );
  }

  if (won) {
    next.state = 'won';
  }

  return next;
}
