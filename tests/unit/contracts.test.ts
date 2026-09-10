import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getValidationErrors,
  validateApproval,
  validateArtOutput,
  validateAssetManifest,
  validateGameSpec,
  validateLevelOutput,
  validateLogicRepairOutput,
  validateLogicOutput,
  validateRunEvent,
  validateVerifyResult,
} from '../../src/contracts/index';

function readJsonFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/reference/${name}`, import.meta.url), 'utf8'),
  );
}

const validSpec = readJsonFixture('game-spec.json');
const validLevel = readJsonFixture('level.json');
const validArt = readJsonFixture('art.json');
const validManifest = readJsonFixture('asset-manifest.json');

describe('GameSpec contract', () => {
  it('accepts the complete reference spec', () => {
    expect(validateGameSpec(validSpec)).toBe(true);
    expect(validateGameSpec.errors).toBeNull();
  });

  it.each([
    [
      'an extra key',
      () => ({ ...(structuredClone(validSpec) as object), surprise: true }),
      'additionalProperties',
    ],
    [
      'a missing field',
      () => {
        const value = structuredClone(validSpec) as Record<string, unknown>;
        delete value.title;
        return value;
      },
      'required',
    ],
    [
      'an unsupported behavior',
      () => {
        const value = structuredClone(validSpec) as {
          enemies: { behavior: string };
        };
        value.enemies.behavior = 'teleport';
        return value;
      },
      'anyOf',
    ],
    [
      'an out-of-bounds speed',
      () => {
        const value = structuredClone(validSpec) as {
          player: { speed: number };
        };
        value.player.speed = 221;
        return value;
      },
      'maximum',
    ],
  ])('rejects %s without modifying it', (_label, makeValue, keyword) => {
    const value = makeValue();
    const before = structuredClone(value);

    expect(validateGameSpec(value)).toBe(false);
    expect(getValidationErrors(validateGameSpec)).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword })]),
    );
    expect(value).toEqual(before);
  });

  it('rejects duplicate palette colors', () => {
    const value = structuredClone(validSpec) as {
      theme: { palette: string[] };
    };
    value.theme.palette[3] = value.theme.palette[0] ?? '#000000';

    expect(validateGameSpec(value)).toBe(false);
    expect(getValidationErrors(validateGameSpec)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: '/theme/palette',
          keyword: 'uniqueItems',
        }),
      ]),
    );
  });

  it('accepts the expanded identity and mechanic vocabulary', () => {
    const value = structuredClone(validSpec) as Record<string, any>;
    value.player.movement = { mode: 'dash', distance: 100, cooldownTicks: 120 };
    value.collectibles.interaction = 'ordered';
    value.enemies.behavior = 'guard';
    value.objective = { mode: 'survive-then-exit', survivalTicks: 1200 };
    value.identity = {
      fantasy: 'A storm keeper restores a fractured circuit.',
      signatureMechanic: 'Dash through numbered shards.',
      dramaticPressure: 'Guardians accelerate over time.',
      pacing: 'escalating',
    };
    value.world = { layout: 'quadrants', pressure: 'rising-danger' };
    expect(validateGameSpec(value)).toBe(true);
  });
});

describe('worker artifact contracts', () => {
  it('accepts the reference level, art, and fixed manifest', () => {
    expect(validateLevelOutput(validLevel)).toBe(true);
    expect(validateArtOutput(validArt)).toBe(true);
    expect(validateAssetManifest(validManifest)).toBe(true);
  });

  it('rejects a malformed sprite row', () => {
    const value = structuredClone(validArt) as {
      sprites: Array<{ rows: string[] }>;
    };
    value.sprites[0]!.rows[0] = 'too-short';

    expect(validateArtOutput(value)).toBe(false);
    expect(getValidationErrors(validateArtOutput)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: '/sprites/0/rows/0',
          keyword: 'pattern',
        }),
      ]),
    );
  });

  it('accepts a bounded logic module envelope', () => {
    const source = readFileSync(
      new URL('../fixtures/reference/rules.ts', import.meta.url),
      'utf8',
    );
    expect(validateLogicOutput({ schemaVersion: 1, source })).toBe(true);
    expect(
      validateLogicRepairOutput({
        schemaVersion: 1,
        diagnosis: 'The chase vector was not normalized.',
        output: { schemaVersion: 1, source },
      }),
    ).toBe(true);
  });

  it('requires the fixed manifest ordering and paths', () => {
    const value = structuredClone(validManifest) as {
      assets: Array<{ path: string }>;
    };
    value.assets[0]!.path = '../player.png';

    expect(validateAssetManifest(value)).toBe(false);
  });
});

describe('approval, verification, and event contracts', () => {
  it('accepts a valid approval and rejects a non-UTC timestamp', () => {
    const approval = {
      schemaVersion: 1,
      specSha256: '0'.repeat(64),
      approvedAt: '2026-09-08T22:00:00.000Z',
    };
    expect(validateApproval(approval)).toBe(true);
    expect(validateApproval({ ...approval, approvedAt: '2026-09-08 22:00' })).toBe(
      false,
    );
  });

  it('accepts the special reference verification ID', () => {
    expect(
      validateVerifyResult({
        schemaVersion: 1,
        runId: 'reference',
        attempt: 0,
        startedAt: '2026-09-08T22:00:00.000Z',
        finishedAt: '2026-09-08T22:00:01.000Z',
        status: 'passed',
        checks: [
          {
            id: 'CONTRACT-01',
            stage: 'contracts',
            status: 'passed',
            owner: 'harness',
            message: 'Reference contracts passed.',
            expected: null,
            actual: null,
            artifactPaths: [],
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts a typed event and rejects unknown event types and data', () => {
    const event = {
      schemaVersion: 1,
      sequence: 1,
      runId: '20260908T220000Z-deadbeef',
      at: '2026-09-08T22:00:00.000Z',
      type: 'run.created',
      role: null,
      attempt: null,
      data: { promptPath: 'prompt.txt', configPath: 'config.json' },
    };

    expect(validateRunEvent(event)).toBe(true);
    expect(validateRunEvent({ ...event, type: 'run.imagined' })).toBe(false);
    expect(
      validateRunEvent({ ...event, data: { ...event.data, extra: true } }),
    ).toBe(false);
  });

  it.each([
    ['run.created', null, null, { promptPath: 'prompt.txt', configPath: 'config.json' }],
    ['spec.proposed', 'spec', 0, { specPath: 'game-spec.json', specSha256: 'a'.repeat(64) }],
    ['spec.approved', null, null, { specSha256: 'a'.repeat(64) }],
    ['worker.started', 'logic', 0, { requestId: 'logic-0' }],
    ['worker.completed', 'logic', 0, { requestId: 'logic-0', artifactPath: 'workers/logic/attempt-0/output.json' }],
    ['worker.failed', 'level', 0, { requestId: 'level-0', code: 'INVALID_OUTPUT', message: 'Level validation failed.' }],
    ['request.retry', 'art', 0, { requestId: 'art-0', retryNumber: 1, reason: 'Provider unavailable.', delayMs: 1_000 }],
    ['artifact.rejected', 'logic', 0, { artifact: 'logic', errors: ['Unexpected export.'] }],
    ['art.fallback', 'art', 0, { reason: 'Art output remained invalid.' }],
    ['integration.completed', null, 0, { integrationPath: 'integration' }],
    ['verify.started', null, 0, { verificationAttempt: 0 }],
    ['verify.completed', null, 0, { verificationAttempt: 0, status: 'failed', verifyPath: 'evidence/attempt-0/verify.json' }],
    ['repair.started', 'repair', 1, { owner: 'logic', requestId: 'repair-1', checkIds: ['POLICY-01'] }],
    ['repair.completed', 'repair', 1, { owner: 'logic', requestId: 'repair-1', artifactPath: 'workers/logic/attempt-1/output.json' }],
    ['run.verified', null, 1, { reportPath: 'report.json', buildPath: 'build' }],
    ['run.stopped', null, 1, { reasonCode: 'RETRY_LIMIT', message: 'Repair limit reached.', reportPath: 'report.json' }],
  ])('accepts %s event data', (type, role, attempt, data) => {
    expect(
      validateRunEvent({
        schemaVersion: 1,
        sequence: 1,
        runId: '20260908T220000Z-deadbeef',
        at: '2026-09-08T22:00:00.000Z',
        type,
        role,
        attempt,
        data,
      }),
    ).toBe(true);
  });
});
