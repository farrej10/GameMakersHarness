import type {
  GameSnapshot,
  GameSpec,
  InputState,
  LevelOutput,
} from '../contracts/index';

export const EMPTY_INPUT: Readonly<InputState> = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false,
});

function copyInput(input: InputState): InputState {
  return {
    up: input.up,
    down: input.down,
    left: input.left,
    right: input.right,
    ...(input.sprint === undefined ? {} : { sprint: input.sprint }),
    ...(input.action === undefined ? {} : { action: input.action }),
  };
}

export function cloneSnapshot(state: GameSnapshot): GameSnapshot {
  return {
    state: state.state,
    tick: state.tick,
    score: state.score,
    player: { ...state.player },
    enemies: state.enemies.map((enemy) => ({ ...enemy })),
    collectibles: state.collectibles.map((collectible) => ({ ...collectible })),
    exit: { ...state.exit },
    input: copyInput(state.input),
    errors: [...state.errors],
  };
}

export function createInitialState(
  spec: GameSpec,
  level: LevelOutput,
): GameSnapshot {
  return {
    state: 'ready',
    tick: 0,
    score: 0,
    player: {
      x: level.playerSpawn.x,
      y: level.playerSpawn.y,
      health: spec.player.health,
      nextDamageTick: 0,
      stamina: spec.player.movement?.mode === 'sprint'
        ? spec.player.movement.staminaTicks
        : 0,
      nextDashTick: 0,
    },
    enemies: level.enemies.map((enemy) => ({
      ...enemy,
      vx: 0,
      vy: 0,
    })),
    collectibles: level.collectibles.map((collectible) => ({ ...collectible })),
    exit: { ...level.exit },
    input: copyInput(EMPTY_INPUT),
    errors: [],
  };
}

export function startGame(state: GameSnapshot): GameSnapshot {
  const next = cloneSnapshot(state);
  if (next.state === 'ready') {
    next.state = 'playing';
    next.input = copyInput(EMPTY_INPUT);
  }
  return next;
}

export function restartGame(
  spec: GameSpec,
  level: LevelOutput,
): GameSnapshot {
  return createInitialState(spec, level);
}
