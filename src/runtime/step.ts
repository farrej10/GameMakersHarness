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

  const movement = spec.player.movement ?? { mode: 'standard' as const };
  let speedMultiplier = 1;
  if (movement.mode === 'sprint') {
    const stamina = next.player.stamina ?? movement.staminaTicks;
    if (input.sprint && stamina > 0 && inputLength > 0) {
      speedMultiplier = movement.multiplier;
      next.player.stamina = stamina - 1;
    } else {
      next.player.stamina = Math.min(movement.staminaTicks, stamina + 1);
    }
  }
  if (
    movement.mode === 'dash' &&
    input.action &&
    inputLength > 0 &&
    next.tick >= (next.player.nextDashTick ?? 0)
  ) {
    next.player.x = clampCenter(
      next.player.x + inputX * movement.distance,
      PLAYER_RADIUS,
      spec.arena.width,
    );
    next.player.y = clampCenter(
      next.player.y + inputY * movement.distance,
      PLAYER_RADIUS,
      spec.arena.height,
    );
    next.player.nextDashTick = next.tick + movement.cooldownTicks;
  }

  next.player.x = clampCenter(
    next.player.x + inputX * spec.player.speed * speedMultiplier * FIXED_STEP_SECONDS,
    PLAYER_RADIUS,
    spec.arena.width,
  );
  next.player.y = clampCenter(
    next.player.y + inputY * spec.player.speed * speedMultiplier * FIXED_STEP_SECONDS,
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
        speed: spec.enemies.speed * (
          spec.world?.pressure === 'rising-danger'
            ? Math.min(1.75, 1 + next.tick / 3600)
            : 1
        ),
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
  const expectedCollectibleId = `c${next.score + 1}`;
  for (const collectible of next.collectibles) {
    if (
      circlesOverlap(
        { ...next.player, radius: PLAYER_RADIUS },
        { ...collectible, radius: COLLECTIBLE_RADIUS },
      ) && (spec.collectibles.interaction !== 'ordered' || collectible.id === expectedCollectibleId)
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
      elapsedTicks: next.tick,
      survivalTicks: spec.objective.mode === 'survive-then-exit'
        ? spec.objective.survivalTicks
        : 1200,
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
