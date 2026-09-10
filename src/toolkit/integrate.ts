import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ArtOutput, AssetManifest, GameSpec, LevelOutput, LogicOutput } from '../contracts/index';
import { stableJson } from './cli';
import { renderArtOutput } from './render-pixels';
import { validateArtArtifact, validateLevelArtifact, validateLogicArtifact } from './validate';

const RULE_TYPES = `export type Vec2 = Readonly<{ x: number; y: number }>;
export type EnemyContext = Readonly<{
  behavior: 'chase' | 'horizontal-patrol' | 'vertical-patrol' | 'guard';
  enemy: Readonly<{ x: number; y: number; vx: number; vy: number }>;
  player: Vec2;
  speed: number;
  bounds: Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;
}>;
export type VictoryContext = Readonly<{
  mode: 'collect-all' | 'collect-then-exit' | 'survive-then-exit';
  score: number;
  target: number;
  atExit: boolean;
  elapsedTicks: number;
  survivalTicks: number;
}>;
`;

export function deriveAssetManifest(): AssetManifest {
  return {
    schemaVersion: 1,
    assets: [
      { id: 'player', path: 'assets/player.png', width: 64, height: 64 },
      { id: 'collectible', path: 'assets/collectible.png', width: 64, height: 64 },
      { id: 'enemy', path: 'assets/enemy.png', width: 64, height: 64 },
      { id: 'exit', path: 'assets/exit.png', width: 64, height: 64 },
    ],
  };
}

function atomicWrite(filePath: string, content: string | Buffer): void {
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, filePath);
}

export function integrateArtifacts(options: {
  runRoot: string;
  spec: GameSpec;
  logic: LogicOutput;
  level: LevelOutput;
  art: ArtOutput;
}): string {
  const issues = [
    ...validateLogicArtifact(options.logic),
    ...validateLevelArtifact(options.spec, options.level),
    ...validateArtArtifact(options.art),
  ];
  if (issues.length) {
    throw new Error(`Refusing to integrate invalid artifacts: ${issues.map(({ code }) => code).join(', ')}`);
  }
  const integrationRoot = path.join(options.runRoot, 'integration');
  const generatedRoot = path.join(integrationRoot, 'generated');
  const assetsRoot = path.join(integrationRoot, 'public', 'assets');
  mkdirSync(generatedRoot, { recursive: true });
  mkdirSync(assetsRoot, { recursive: true });
  atomicWrite(path.join(generatedRoot, 'game-spec.json'), stableJson(options.spec));
  atomicWrite(path.join(generatedRoot, 'level.json'), stableJson(options.level));
  atomicWrite(path.join(generatedRoot, 'rules.ts'), options.logic.source);
  atomicWrite(path.join(generatedRoot, 'rule-types.ts'), RULE_TYPES);
  for (const [id, png] of renderArtOutput(options.art, options.spec.theme.palette)) {
    atomicWrite(path.join(assetsRoot, `${id}.png`), png);
  }
  return integrationRoot;
}
