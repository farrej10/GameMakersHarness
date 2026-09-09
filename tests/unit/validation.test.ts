import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ArtOutput, GameSpec, LevelOutput } from '../../src/contracts/index';
import {
  validateArtArtifact,
  validateLevelArtifact,
  validateLogicArtifact,
  validateLogicSource,
} from '../../src/toolkit/validate';

function readJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/reference/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

function issueCodes(issues: ReturnType<typeof validateLogicSource>): string[] {
  return issues.map(({ code }) => code);
}

const spec = readJson<GameSpec>('game-spec.json');
const level = readJson<LevelOutput>('level.json');
const art = readJson<ArtOutput>('art.json');
const rules = readFileSync(
  new URL('../fixtures/reference/rules.ts', import.meta.url),
  'utf8',
);

describe('level artifact validation', () => {
  it('accepts the deterministic reference level', () => {
    expect(validateLevelArtifact(spec, level)).toEqual([]);
  });

  it('returns structured schema failures for out-of-bounds points', () => {
    const invalid = structuredClone(level);
    invalid.playerSpawn.x = 39;

    expect(validateLevelArtifact(spec, invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SCHEMA_MINIMUM',
          instancePath: '/playerSpawn/x',
          expected: expect.any(String),
          actual: '39',
        }),
      ]),
    );
  });

  it('checks the seed and entity counts against the approved spec', () => {
    const changedSpec = structuredClone(spec);
    changedSpec.seed += 1;
    changedSpec.collectibles.count -= 1;
    changedSpec.enemies.count -= 1;

    expect(issueCodes(validateLevelArtifact(changedSpec, level))).toEqual(
      expect.arrayContaining([
        'LEVEL_SEED',
        'LEVEL_COLLECTIBLE_COUNT',
        'LEVEL_ENEMY_COUNT',
      ]),
    );
  });

  it('requires consecutive ordered entity IDs', () => {
    const invalid = structuredClone(level);
    invalid.collectibles[0]!.id = 'c2';
    invalid.enemies[1]!.id = 'e3';

    expect(issueCodes(validateLevelArtifact(spec, invalid))).toEqual(
      expect.arrayContaining(['LEVEL_COLLECTIBLE_ID', 'LEVEL_ENEMY_ID']),
    );
  });

  it('rejects placements closer than 48 pixels', () => {
    const invalid = structuredClone(level);
    invalid.collectibles[1]!.x = invalid.collectibles[0]!.x;
    invalid.collectibles[1]!.y = invalid.collectibles[0]!.y;

    expect(issueCodes(validateLevelArtifact(spec, invalid))).toContain(
      'LEVEL_PAIR_DISTANCE',
    );
  });

  it('enforces enemy spawn safety and exit spacing', () => {
    const invalid = structuredClone(level);
    invalid.enemies[0]!.x = 160;
    invalid.enemies[0]!.y = 100;
    invalid.exit.x = 100;
    invalid.exit.y = 200;

    expect(issueCodes(validateLevelArtifact(spec, invalid))).toEqual(
      expect.arrayContaining([
        'LEVEL_ENEMY_SPAWN_DISTANCE',
        'LEVEL_EXIT_DISTANCE',
      ]),
    );
  });

  it('requires collectibles in at least three arena quadrants', () => {
    const invalid = structuredClone(level);
    const positions = [
      [200, 180],
      [260, 180],
      [320, 180],
      [200, 240],
      [260, 240],
      [320, 240],
    ] as const;
    invalid.collectibles.forEach((collectible, index) => {
      [collectible.x, collectible.y] = positions[index]!;
    });

    expect(issueCodes(validateLevelArtifact(spec, invalid))).toContain(
      'LEVEL_QUADRANTS',
    );
  });
});

describe('art artifact validation', () => {
  it('accepts the reference sprite grids', () => {
    expect(validateArtArtifact(art)).toEqual([]);
  });

  it('requires each asset ID exactly once', () => {
    const invalid = structuredClone(art);
    invalid.sprites[3]!.id = 'player';

    const issues = validateArtArtifact(invalid).filter(
      ({ code }) => code === 'ART_ASSET_IDS',
    );
    expect(issues).toHaveLength(2);
    expect(issues.every(({ instancePath }) => instancePath === '/sprites')).toBe(
      true,
    );
  });

  it('rejects an all-transparent sprite', () => {
    const invalid = structuredClone(art);
    invalid.sprites[0]!.rows = Array.from({ length: 16 }, () =>
      '................',
    );

    expect(validateArtArtifact(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ART_OPAQUE_PIXELS',
          instancePath: '/sprites/0/rows',
        }),
      ]),
    );
  });

  it('rejects malformed row grammar before semantic checks', () => {
    const invalid = structuredClone(art);
    invalid.sprites[0]!.rows[0] = 'not-a-pixel-row';

    expect(issueCodes(validateArtArtifact(invalid))).toContain('SCHEMA_PATTERN');
  });
});

describe('generated TypeScript allowlist', () => {
  it('accepts the complete reference rules and artifact wrapper', () => {
    expect(validateLogicSource(rules)).toEqual([]);
    expect(validateLogicArtifact({ schemaVersion: 1, source: rules })).toEqual([]);
  });

  it('accepts every approved Math function', () => {
    const approvedMath = rules.replace(
      'Math.hypot(dx, dy)',
      'Math.sqrt(Math.abs(dx)) + Math.sign(dy)',
    );
    expect(validateLogicSource(approvedMath)).toEqual([]);
  });

  it('reports malformed TypeScript', () => {
    expect(issueCodes(validateLogicSource(`${rules}\nexport function broken(`))).toContain(
      'LOGIC_SYNTAX',
    );
  });

  it.each([
    [
      'an unexpected import',
      rules.replace(
        "import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';",
        "import { readFileSync } from 'node:fs';",
      ),
      'LOGIC_IMPORT',
    ],
    [
      'a dynamic import',
      rules.replace(
        "  if (context.behavior === 'chase') {",
        "  const module = import('./evil');\n  if (context.behavior === 'chase') {",
      ),
      'LOGIC_DYNAMIC_IMPORT',
    ],
    [
      'an undeclared global',
      rules.replace(
        "  if (context.behavior === 'chase') {",
        "  const environment = process;\n  if (context.behavior === 'chase') {",
      ),
      'LOGIC_GLOBAL',
    ],
    [
      'a computed property',
      rules.replace('context.speed,', "context['speed'],"),
      'LOGIC_EXPRESSION_KIND',
    ],
    [
      'a non-approved Math call',
      rules.replace('Math.hypot(dx, dy)', 'Math.random()'),
      'LOGIC_CALL',
    ],
    [
      'eval',
      rules.replace(
        "  if (context.behavior === 'chase') {",
        "  const evaluated = eval('1');\n  if (context.behavior === 'chase') {",
      ),
      'LOGIC_CALL',
    ],
    [
      'a loop',
      rules.replace(
        "  if (context.behavior === 'chase') {",
        "  while (context.speed > 0) { return { x: 0, y: 0 }; }\n  if (context.behavior === 'chase') {",
      ),
      'LOGIC_STATEMENT_KIND',
    ],
    [
      'object construction',
      rules.replace(
        "  if (context.behavior === 'chase') {",
        "  const date = new Date();\n  if (context.behavior === 'chase') {",
      ),
      'LOGIC_EXPRESSION_KIND',
    ],
    [
      'an async export',
      rules.replace(
        'export function getEnemyVelocity',
        'export async function getEnemyVelocity',
      ),
      'LOGIC_SIGNATURE',
    ],
    [
      'a top-level statement',
      `${rules}\nconsole.log('unexpected');`,
      'LOGIC_TOP_LEVEL',
    ],
    [
      'an additional function',
      `${rules}\nexport function extra(): boolean { return true; }`,
      'LOGIC_EXTRA_FUNCTION',
    ],
  ])('rejects %s', (_label, source, expectedCode) => {
    expect(issueCodes(validateLogicSource(source))).toContain(expectedCode);
  });

  it('returns schema failures for an invalid logic wrapper', () => {
    expect(
      issueCodes(validateLogicArtifact({ schemaVersion: 1, source: '', extra: true })),
    ).toEqual(
      expect.arrayContaining(['SCHEMA_MINLENGTH', 'SCHEMA_ADDITIONALPROPERTIES']),
    );
  });
});
