import { describe, expect, it } from 'vitest';
import type {
  GameSnapshot,
  GameSpec,
  InputState,
  LevelOutput,
  RuleFunctions,
} from '../../src/contracts/index';
import { PLAYER_RADIUS } from '../../src/runtime/geometry';
import { createInitialState, startGame } from '../../src/runtime/state';
import { stepGame } from '../../src/runtime/step';

const spec: GameSpec = {
  schemaVersion: 1,
  title: 'Movement Test',
  description: 'Runtime movement fixture.',
  seed: 42,
  theme: {
    playerName: 'Player',
    collectibleName: 'Item',
    enemyName: 'Enemy',
    exitName: 'Exit',
    palette: ['#101010', '#202020', '#303030', '#404040'],
  },
  arena: { width: 800, height: 600 },
  player: { speed: 180, health: 3, movement: { mode: 'standard' } },
  collectibles: { count: 3, interaction: 'touch' },
  enemies: { count: 1, speed: 40, behavior: 'chase' },
  objective: { mode: 'collect-then-exit' },
  identity: { fantasy: 'Test movement.', signatureMechanic: 'Move.', dramaticPressure: 'None.', pacing: 'relaxed' },
  world: { layout: 'open', pressure: 'none' },
  adaptations: [],
};

const level: LevelOutput = {
  schemaVersion: 1,
  seed: 42,
  playerSpawn: { x: 100, y: 100 },
  exit: { x: 700, y: 500 },
  collectibles: [
    { id: 'c1', x: 500, y: 400 },
    { id: 'c2', x: 600, y: 400 },
    { id: 'c3', x: 700, y: 400 },
  ],
  enemies: [{ id: 'e1', x: 700, y: 100 }],
};

const stationaryRules: RuleFunctions = {
  getEnemyVelocity: () => ({ x: 0, y: 0 }),
  isVictory: () => false,
};

const noInput: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

function advance(
  state: GameSnapshot,
  input: InputState,
  ticks: number,
  rules: RuleFunctions = stationaryRules,
): GameSnapshot {
  let next = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    next = stepGame(next, input, rules, spec);
  }
  return next;
}

describe('deterministic movement', () => {
  it('moves cardinally and diagonally at equal speed', () => {
    const initial = startGame(createInitialState(spec, level));
    const cardinal = advance(initial, { ...noInput, right: true }, 30);
    const diagonal = advance(
      initial,
      { ...noInput, right: true, down: true },
      30,
    );

    expect(cardinal.player.x - initial.player.x).toBeCloseTo(90, 10);
    expect(cardinal.player.y).toBe(initial.player.y);
    expect(
      Math.hypot(
        diagonal.player.x - initial.player.x,
        diagonal.player.y - initial.player.y,
      ),
    ).toBeCloseTo(90, 10);
  });

  it('clamps the player center inside every arena boundary', () => {
    let state = startGame(createInitialState(spec, level));
    state = advance(state, { ...noInput, left: true, up: true }, 600);
    expect(state.player.x).toBe(PLAYER_RADIUS);
    expect(state.player.y).toBe(PLAYER_RADIUS);

    state = advance(state, { ...noInput, right: true, down: true }, 600);
    expect(state.player.x).toBe(spec.arena.width - PLAYER_RADIUS);
    expect(state.player.y).toBe(spec.arena.height - PLAYER_RADIUS);
  });

  it('does not mutate the state, input, or policy context', () => {
    const initial = startGame(createInitialState(spec, level));
    const input = { ...noInput, right: true };
    const stateBefore = structuredClone(initial);
    const inputBefore = structuredClone(input);
    const mutatingRules: RuleFunctions = {
      getEnemyVelocity: (context) => {
        const mutableEnemy = context.enemy as {
          x: number;
          y: number;
          vx: number;
          vy: number;
        };
        mutableEnemy.x = 0;
        return { x: 0, y: 0 };
      },
      isVictory: () => false,
    };

    stepGame(initial, input, mutatingRules, spec);

    expect(initial).toEqual(stateBefore);
    expect(input).toEqual(inputBefore);
  });

  it('replays the same input sequence exactly', () => {
    const run = () => {
      let state = startGame(createInitialState(spec, level));
      state = advance(state, { ...noInput, right: true }, 20);
      state = advance(state, { ...noInput, down: true }, 20);
      return advance(state, { ...noInput, left: true, up: true }, 20);
    };

    expect(run()).toEqual(run());
  });

  it('supports bounded sprint stamina and recharge', () => {
    const sprintSpec = structuredClone(spec);
    sprintSpec.player.movement = { mode: 'sprint', multiplier: 2, staminaTicks: 120 };
    let state = startGame(createInitialState(sprintSpec, level));
    state = stepGame(state, { ...noInput, right: true, sprint: true }, stationaryRules, sprintSpec);
    expect(state.player.x).toBeCloseTo(106, 10);
    expect(state.player.stamina).toBe(119);
    state = stepGame(state, noInput, stationaryRules, sprintSpec);
    expect(state.player.stamina).toBe(120);
  });

  it('supports directional dash with a deterministic cooldown', () => {
    const dashSpec = structuredClone(spec);
    dashSpec.player.movement = { mode: 'dash', distance: 100, cooldownTicks: 120 };
    let state = startGame(createInitialState(dashSpec, level));
    state = stepGame(state, { ...noInput, right: true, action: true }, stationaryRules, dashSpec);
    expect(state.player.x).toBeCloseTo(203, 10);
    expect(state.player.nextDashTick).toBe(121);
    state = stepGame(state, { ...noInput, right: true, action: true }, stationaryRules, dashSpec);
    expect(state.player.x).toBeCloseTo(206, 10);
  });

  it('rejects a non-finite policy result without advancing the frame', () => {
    const initial = startGame(createInitialState(spec, level));
    const brokenRules: RuleFunctions = {
      getEnemyVelocity: () => ({ x: Number.NaN, y: 0 }),
      isVictory: () => false,
    };
    const result = stepGame(initial, noInput, brokenRules, spec);

    expect(result.tick).toBe(initial.tick);
    expect(result.player).toEqual(initial.player);
    expect(result.enemies).toEqual(initial.enemies);
    expect(result.errors.at(-1)).toContain('non-finite velocity');
  });
});
