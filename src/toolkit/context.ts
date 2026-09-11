import { createHash } from 'node:crypto';
import type { AssetManifest, ArtOutput, GameSpec, LevelOutput, LogicOutput } from '../contracts/index';

export type ContextPacket = {
  system: string;
  user: string;
  sha256: string;
  bytes: number;
};

function packet(system: string, data: object): ContextPacket {
  const user = JSON.stringify(data);
  const bytes = Buffer.byteLength(system, 'utf8') + Buffer.byteLength(user, 'utf8');
  if (bytes > 24_000) throw new Error(`CONTEXT_LIMIT: packet is ${bytes} bytes; maximum is 24000.`);
  return {
    system,
    user,
    sha256: createHash('sha256').update(system).update('\0').update(user).digest('hex'),
    bytes,
  };
}

export function logicContext(system: string, spec: GameSpec): ContextPacket {
  return packet(system, {
    task: 'Return the complete generated rules module.',
    mechanics: {
      enemyBehavior: spec.enemies.behavior,
      enemySpeed: spec.enemies.speed,
      objectiveMode: spec.objective.mode,
      collectibleTarget: spec.collectibles.count,
      movement: spec.player.movement ?? { mode: 'standard' },
      collectionInteraction: spec.collectibles.interaction ?? 'touch',
      survivalTicks: spec.objective.mode === 'survive-then-exit'
        ? spec.objective.survivalTicks
        : 1200,
      world: spec.world ?? { layout: 'open', pressure: 'none' },
    },
    exactImport: "import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';",
    exports: [
      'getEnemyVelocity(context: EnemyContext): Vec2',
      'isVictory(context: VictoryContext): boolean',
    ],
    completeValidExample: {
      schemaVersion: 1,
      source:
        "import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';\n\nexport function getEnemyVelocity(context: EnemyContext): Vec2 {\n  if (context.behavior === 'chase' || context.behavior === 'guard') {\n    const dx = context.player.x - context.enemy.x;\n    const dy = context.player.y - context.enemy.y;\n    const distance = Math.hypot(dx, dy);\n    if (distance === 0) return { x: 0, y: 0 };\n    if (context.behavior === 'guard' && distance > 180) return { x: 0, y: 0 };\n    return { x: dx / distance * context.speed, y: dy / distance * context.speed };\n  }\n  if (context.behavior === 'vertical-patrol') {\n    if (context.enemy.y >= context.bounds.maxY) return { x: 0, y: -context.speed };\n    if (context.enemy.y <= context.bounds.minY) return { x: 0, y: context.speed };\n    return { x: 0, y: context.enemy.vy < 0 ? -context.speed : context.speed };\n  }\n  if (context.enemy.x >= context.bounds.maxX) return { x: -context.speed, y: 0 };\n  if (context.enemy.x <= context.bounds.minX) return { x: context.speed, y: 0 };\n  return { x: context.enemy.vx < 0 ? -context.speed : context.speed, y: 0 };\n}\n\nexport function isVictory(context: VictoryContext): boolean {\n  if (context.mode === 'survive-then-exit') return context.elapsedTicks >= context.survivalTicks && context.atExit;\n  const enough = context.score >= context.target;\n  return context.mode === 'collect-all' ? enough : enough && context.atExit;\n}\n",
    },
  });
}

export function levelContext(system: string, spec: GameSpec): ContextPacket {
  return packet(system, {
    task: 'Return one deterministic level shaped by the selected layout and mechanics.',
    seed: spec.seed,
    arena: spec.arena,
    counts: { collectibles: spec.collectibles.count, enemies: spec.enemies.count },
    design: {
      identity: spec.identity,
      layout: spec.world?.layout ?? 'open',
      pressure: spec.world?.pressure ?? 'none',
      collectionInteraction: spec.collectibles.interaction ?? 'touch',
      enemyBehavior: spec.enemies.behavior,
      objective: spec.objective,
    },
    constraints: {
      x: [40, 760],
      y: [40, 560],
      pairDistance: 48,
      enemyPlayerDistance: 180,
      exitPlayerDistance: 160,
      collectibleQuadrants: 3,
      orderedIds: true,
    },
    completeValidExampleForThreeAndOne: {
      schemaVersion: 1,
      seed: spec.seed,
      playerSpawn: { x: 100, y: 100 },
      exit: { x: 700, y: 500 },
      collectibles: [
        { id: 'c1', x: 250, y: 100 },
        { id: 'c2', x: 550, y: 100 },
        { id: 'c3', x: 250, y: 450 },
      ],
      enemies: [{ id: 'e1', x: 500, y: 350 }],
    },
  });
}

export function artContext(
  system: string,
  spec: GameSpec,
  manifest: AssetManifest,
): ContextPacket {
  return packet(system, {
    task: 'Create four isolated 64 by 64 PNG sprites through the image-generation worker.',
    theme: spec.theme,
    identity: spec.identity,
    world: spec.world,
    mechanics: {
      movement: spec.player.movement,
      collection: spec.collectibles.interaction,
      enemyBehavior: spec.enemies.behavior,
      objective: spec.objective,
      animationProfile: spec.animationProfile,
    },
    manifest,
    constraints: {
      outputPixels: 64,
      transparentBackground: true,
      isolatedEntity: true,
      consistentTopDownStyle: true,
      forbidden: ['text', 'labels', 'scenery', 'multiple objects', 'ground shadows'],
    },
  });
}

export function correctionContext<T extends LogicOutput | LevelOutput | ArtOutput>(
  system: string,
  role: 'logic' | 'level' | 'art',
  previousOutput: T | unknown,
  errors: readonly string[],
  trustedContext: object,
): ContextPacket {
  return packet(system, {
    task: `Return a complete corrected ${role} replacement.`,
    trustedContext,
    previousOutput,
    validationErrors: errors,
  });
}
