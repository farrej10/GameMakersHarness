import { describe, expect, it } from 'vitest';
import type {
  GameSnapshot,
  GameSpec,
  InputState,
  LevelOutput,
  RuleFunctions,
} from '../../src/contracts/index';
import {
  createInitialState,
  restartGame,
  startGame,
} from '../../src/runtime/state';
import { stepGame } from '../../src/runtime/step';

const spec: GameSpec = {
  schemaVersion: 1,
  title: 'Gameplay Test',
  description: 'Runtime gameplay fixture.',
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
  enemies: { count: 2, speed: 40, behavior: 'chase' },
  objective: { mode: 'collect-then-exit' },
  identity: { fantasy: 'Test gameplay.', signatureMechanic: 'Collect.', dramaticPressure: 'Enemies.', pacing: 'relaxed' },
  world: { layout: 'open', pressure: 'none' },
  adaptations: [],
};

const level: LevelOutput = {
  schemaVersion: 1,
  seed: 42,
  playerSpawn: { x: 100, y: 100 },
  exit: { x: 700, y: 500 },
  collectibles: [
    { id: 'c1', x: 100, y: 100 },
    { id: 'c2', x: 500, y: 400 },
    { id: 'c3', x: 600, y: 400 },
  ],
  enemies: [
    { id: 'e1', x: 700, y: 100 },
    { id: 'e2', x: 700, y: 200 },
  ],
};

const input: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
};
const rules: RuleFunctions = {
  getEnemyVelocity: () => ({ x: 0, y: 0 }),
  isVictory: ({ mode, score, target, atExit }) =>
    score >= target && (mode === 'collect-all' || atExit),
};

function advance(state: GameSnapshot, ticks: number): GameSnapshot {
  let next = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    next = stepGame(next, input, rules, spec);
  }
  return next;
}

describe('collection, damage, and game states', () => {
  it('scores an overlapping collectible once and removes it', () => {
    let state = startGame(createInitialState(spec, level));
    state = stepGame(state, input, rules, spec);
    expect(state.score).toBe(1);
    expect(state.collectibles.map(({ id }) => id)).not.toContain('c1');

    state = stepGame(state, input, rules, spec);
    expect(state.score).toBe(1);
  });

  it('requires ordered collectibles to be collected by ID sequence', () => {
    const orderedSpec = structuredClone(spec);
    orderedSpec.collectibles.interaction = 'ordered';
    const orderedLevel = structuredClone(level);
    orderedLevel.collectibles[0] = { id: 'c1', x: 500, y: 400 };
    orderedLevel.collectibles[1] = { id: 'c2', x: 100, y: 100 };
    let state = startGame(createInitialState(orderedSpec, orderedLevel));
    state = stepGame(state, input, rules, orderedSpec);
    expect(state.score).toBe(0);
    expect(state.collectibles.map(({ id }) => id)).toContain('c2');
    state.collectibles[0] = { id: 'c1', x: 100, y: 100 };
    state = stepGame(state, input, rules, orderedSpec);
    expect(state.score).toBe(1);
  });

  it('passes survival timing to the victory policy', () => {
    const survivalSpec = structuredClone(spec);
    survivalSpec.objective = { mode: 'survive-then-exit', survivalTicks: 600 };
    const survivalLevel = structuredClone(level);
    survivalLevel.playerSpawn = { ...survivalLevel.exit };
    const survivalRules: RuleFunctions = {
      getEnemyVelocity: () => ({ x: 0, y: 0 }),
      isVictory: ({ mode, elapsedTicks, survivalTicks, atExit }) =>
        mode === 'survive-then-exit' && elapsedTicks >= survivalTicks && atExit,
    };
    let state = startGame(createInitialState(survivalSpec, survivalLevel));
    state.tick = 598;
    state = stepGame(state, input, survivalRules, survivalSpec);
    expect(state.state).toBe('playing');
    state = stepGame(state, input, survivalRules, survivalSpec);
    expect(state.state).toBe('won');
  });

  it('increases policy speed under rising danger with a fixed cap', () => {
    const pressureSpec = structuredClone(spec);
    pressureSpec.world.pressure = 'rising-danger';
    let observedSpeed = 0;
    const pressureRules: RuleFunctions = {
      getEnemyVelocity: ({ speed }) => {
        observedSpeed = speed;
        return { x: 0, y: 0 };
      },
      isVictory: () => false,
    };
    const state = startGame(createInitialState(pressureSpec, level));
    state.tick = 10_000;
    stepGame(state, input, pressureRules, pressureSpec);
    expect(observedSpeed).toBe(pressureSpec.enemies.speed * 1.75);
  });

  it('applies damage at tick T and again at T+60', () => {
    const touchingLevel = structuredClone(level);
    touchingLevel.enemies = [
      { id: 'e1', x: 100, y: 100 },
      { id: 'e2', x: 100, y: 100 },
    ];
    let state = startGame(createInitialState(spec, touchingLevel));

    state = stepGame(state, input, rules, spec);
    expect(state.tick).toBe(1);
    expect(state.player.health).toBe(2);
    expect(state.player.nextDamageTick).toBe(61);

    state = advance(state, 59);
    expect(state.tick).toBe(60);
    expect(state.player.health).toBe(2);

    state = stepGame(state, input, rules, spec);
    expect(state.tick).toBe(61);
    expect(state.player.health).toBe(1);
  });

  it('applies at most one damage event per tick for several enemies', () => {
    const touchingLevel = structuredClone(level);
    touchingLevel.enemies = [
      { id: 'e1', x: 100, y: 100 },
      { id: 'e2', x: 100, y: 100 },
    ];
    const state = stepGame(
      startGame(createInitialState(spec, touchingLevel)),
      input,
      rules,
      spec,
    );
    expect(state.player.health).toBe(2);
  });

  it('makes defeat win a simultaneous lethal victory tie', () => {
    const tieSpec = structuredClone(spec);
    tieSpec.player.health = 2;
    tieSpec.objective.mode = 'collect-then-exit';
    const tieLevel = structuredClone(level);
    tieLevel.playerSpawn = { x: 400, y: 300 };
    tieLevel.exit = { x: 400, y: 300 };
    tieLevel.collectibles = [{ id: 'c3', x: 400, y: 300 }];
    tieLevel.enemies = [{ id: 'e1', x: 400, y: 300 }];
    let state = createInitialState(tieSpec, tieLevel);
    state.score = 2;
    state.player.health = 1;
    state = startGame(state);
    state = stepGame(state, input, rules, tieSpec);

    expect(state.player.health).toBe(0);
    expect(state.state).toBe('lost');
  });

  it('supports both victory modes', () => {
    const collectAllSpec = structuredClone(spec);
    collectAllSpec.collectibles.count = 3;
    collectAllSpec.objective.mode = 'collect-all';
    let collectAll = createInitialState(collectAllSpec, level);
    collectAll.score = 2;
    collectAll.collectibles = [{ id: 'c3', x: 100, y: 100 }];
    collectAll = stepGame(startGame(collectAll), input, rules, collectAllSpec);
    expect(collectAll.state).toBe('won');

    const exitSpec = structuredClone(collectAllSpec);
    exitSpec.objective.mode = 'collect-then-exit';
    let needsExit = createInitialState(exitSpec, level);
    needsExit.score = 2;
    needsExit.collectibles = [{ id: 'c3', x: 100, y: 100 }];
    needsExit = stepGame(startGame(needsExit), input, rules, exitSpec);
    expect(needsExit.state).toBe('playing');
  });

  it('freezes terminal states and restart rebuilds a clean ready state', () => {
    const lost = startGame(createInitialState(spec, level));
    lost.state = 'lost';
    lost.tick = 20;
    lost.score = 2;
    lost.player.health = 0;
    lost.input.right = true;
    const frozen = stepGame(lost, { ...input, left: true }, rules, spec);
    expect(frozen).toEqual(lost);

    const restarted = restartGame(spec, level);
    expect(restarted).toEqual(createInitialState(spec, level));
    expect(restarted.state).toBe('ready');
    expect(restarted.input).toEqual(input);
  });
});
