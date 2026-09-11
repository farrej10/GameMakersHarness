import type {
  GameSnapshot,
  GameSpec,
  LevelOutput,
  ScenarioId,
} from '../../../src/contracts/index';

export type ScenarioFixture = {
  spec: GameSpec;
  level: LevelOutput;
  initial: Partial<Pick<GameSnapshot, 'score'>> & {
    player?: Partial<GameSnapshot['player']>;
  };
};

const farCollectibles = [
  { id: 'c1', x: 600, y: 400 },
  { id: 'c2', x: 700, y: 400 },
  { id: 'c3', x: 650, y: 500 },
];

function scenarioSpec(base: GameSpec): GameSpec {
  const spec = structuredClone(base);
  spec.player.speed = 180;
  spec.player.health = 3;
  spec.collectibles.count = 3;
  spec.enemies.count = 1;
  spec.enemies.speed = 0;
  spec.objective.mode = 'collect-then-exit';
  return spec;
}

function level(
  collectibles: LevelOutput['collectibles'],
  enemies: LevelOutput['enemies'],
  playerSpawn = { x: 100, y: 100 },
  exit = { x: 700, y: 500 },
): LevelOutput {
  return {
    schemaVersion: 1,
    seed: 42,
    playerSpawn,
    exit,
    collectibles,
    enemies,
  };
}

export function createScenario(
  id: ScenarioId,
  base: GameSpec,
): ScenarioFixture {
  const spec = scenarioSpec(base);

  switch (id) {
    case 'movement':
      return {
        spec,
        level: level(farCollectibles, [{ id: 'e1', x: 700, y: 100 }]),
        initial: {},
      };
    case 'dash':
      spec.player.movement = { mode: 'dash', distance: 100, cooldownTicks: 120 };
      return {
        spec,
        level: level(farCollectibles, [{ id: 'e1', x: 700, y: 100 }]),
        initial: {},
      };
    case 'collection':
      return {
        spec,
        level: level(
          [
            { id: 'c1', x: 160, y: 100 },
            { id: 'c2', x: 600, y: 400 },
            { id: 'c3', x: 700, y: 400 },
          ],
          [{ id: 'e1', x: 700, y: 500 }],
        ),
        initial: {},
      };
    case 'damage':
      spec.enemies.count = 2;
      return {
        spec,
        level: level(
          farCollectibles,
          [
            { id: 'e1', x: 400, y: 300 },
            { id: 'e2', x: 400, y: 300 },
          ],
          { x: 400, y: 300 },
        ),
        initial: {},
      };
    case 'win':
      return {
        spec,
        level: level(
          [
            { id: 'c1', x: 160, y: 100 },
            { id: 'c2', x: 220, y: 100 },
            { id: 'c3', x: 280, y: 100 },
          ],
          [{ id: 'e1', x: 700, y: 500 }],
          { x: 100, y: 100 },
          { x: 400, y: 100 },
        ),
        initial: {},
      };
    case 'loss':
      return {
        spec,
        level: level(
          farCollectibles,
          [{ id: 'e1', x: 400, y: 300 }],
          { x: 400, y: 300 },
        ),
        initial: { player: { health: 1 } },
      };
    case 'tie':
      return {
        spec,
        level: level(
          [{ id: 'c3', x: 400, y: 300 }],
          [{ id: 'e1', x: 400, y: 300 }],
          { x: 400, y: 300 },
          { x: 400, y: 300 },
        ),
        initial: { score: 2, player: { health: 1 } },
      };
  }
}
