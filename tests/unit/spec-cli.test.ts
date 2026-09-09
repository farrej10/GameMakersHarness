import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameSpec } from '../../src/contracts/index';
import type { ToolkitConfig } from '../../src/toolkit/config';
import {
  approveSpecRun,
  proposeSpecRun,
  sha256,
  stableJson,
  type RunStatus,
} from '../../src/toolkit/cli';
import { readEvents } from '../../src/toolkit/events';
import type {
  ModelClient,
  ModelRequest,
  ModelResult,
} from '../../src/toolkit/openrouter';

const reference = JSON.parse(
  readFileSync(
    new URL('../fixtures/reference/game-spec.json', import.meta.url),
    'utf8',
  ),
) as GameSpec;

const config: ToolkitConfig = {
  apiKey: 'hidden',
  models: {
    spec: 'test/spec',
    logic: 'test/logic',
    level: 'test/level',
    art: 'test/art',
    repair: 'test/repair',
  },
  limits: {
    parallelWorkers: 3,
    maxRequests: 16,
    requestTimeoutMs: 90_000,
    activeBudgetMs: 900_000,
    maxRepairIterations: 3,
    maxInitialCorrections: 1,
    contextBytes: 24_000,
    schemaBytes: 24_000,
    outputTokens: { spec: 2_500, logic: 4_096, level: 3_000, art: 3_000, repair: 4_096 },
  },
};

function result(content: unknown, index: number): ModelResult {
  return {
    content,
    responseId: `response-${index}`,
    requestedModel: 'test/spec',
    returnedModel: 'test/spec',
    provider: 'fake',
    promptTokens: 10,
    completionTokens: 10,
    reportedCostUsd: null,
    elapsedMs: 1,
  };
}

function fakeClient(outputs: unknown[]): { client: ModelClient; generate: ReturnType<typeof vi.fn> } {
  let index = 0;
  const generate = vi.fn(async (_request: ModelRequest) => {
    const content = outputs[index];
    index += 1;
    return result(content, index);
  });
  return { client: { generate }, generate };
}

function workspace(): string {
  return mkdtempSync(path.join(tmpdir(), 'game-maker-runs-'));
}

function fixedOptions(runsRoot: string) {
  return {
    prompt: 'A robot collects batteries and avoids sprinklers.',
    seed: 42,
    config,
    runsRoot,
    now: () => new Date('2026-09-09T12:34:56.000Z'),
    entropy: Buffer.from('1234abcd', 'hex'),
  };
}

describe('spec proposal and approval', () => {
  it('creates a reviewable run with stable bytes, hash, status, and events', async () => {
    const runsRoot = workspace();
    const fake = fakeClient([reference]);
    const proposed = await proposeSpecRun({
      ...fixedOptions(runsRoot),
      client: fake.client,
    });

    expect(proposed.runId).toBe('20260909T123456Z-1234abcd');
    const specBytes = readFileSync(path.join(proposed.runRoot, 'game-spec.json'));
    expect(specBytes.toString('utf8')).toBe(stableJson(reference));
    expect(proposed.hash).toBe(sha256(specBytes));
    const status = JSON.parse(
      readFileSync(path.join(proposed.runRoot, 'status.json'), 'utf8'),
    ) as RunStatus;
    expect(status).toMatchObject({ state: 'awaiting-approval', requestCount: 1 });
    expect(readFileSync(path.join(proposed.runRoot, 'config.json'), 'utf8')).not.toContain(
      'hidden',
    );
    expect(readEvents(path.join(proposed.runRoot, 'events.jsonl')).map(({ type }) => type)).toEqual([
      'run.created',
      'worker.started',
      'worker.completed',
      'spec.proposed',
    ]);

    const approval = approveSpecRun({
      runId: proposed.runId,
      hash: proposed.hash,
      runsRoot,
      now: () => new Date('2026-09-09T12:35:00.000Z'),
    });
    expect(approval.specSha256).toBe(proposed.hash);
    expect(readEvents(path.join(proposed.runRoot, 'events.jsonl')).at(-1)?.type).toBe(
      'spec.approved',
    );
  });

  it('uses exactly one correction for an invalid initial response', async () => {
    const invalid = { ...structuredClone(reference), seed: 99, surprise: true };
    const fake = fakeClient([invalid, reference]);
    const proposed = await proposeSpecRun({
      ...fixedOptions(workspace()),
      client: fake.client,
    });

    expect(fake.generate).toHaveBeenCalledTimes(2);
    const correction = fake.generate.mock.calls[1]?.[0] as ModelRequest;
    expect(correction.user).toContain('validationErrors');
    expect(correction.user).toContain('previousOutput');
    expect(readEvents(path.join(proposed.runRoot, 'events.jsonl')).map(({ type }) => type)).toContain(
      'artifact.rejected',
    );
  });

  it('stops after the correction allowance is exhausted', async () => {
    const runsRoot = workspace();
    const fake = fakeClient([{ invalid: true }, { stillInvalid: true }]);
    await expect(
      proposeSpecRun({ ...fixedOptions(runsRoot), client: fake.client }),
    ).rejects.toThrow(/after one correction/u);
    expect(fake.generate).toHaveBeenCalledTimes(2);
    const runRoot = path.join(runsRoot, '20260909T123456Z-1234abcd');
    expect(
      (JSON.parse(readFileSync(path.join(runRoot, 'status.json'), 'utf8')) as RunStatus).state,
    ).toBe('stopped');
  });

  it('rejects changed or invalid spec bytes during approval', async () => {
    const runsRoot = workspace();
    const proposed = await proposeSpecRun({
      ...fixedOptions(runsRoot),
      client: fakeClient([reference]).client,
    });
    writeFileSync(
      path.join(proposed.runRoot, 'game-spec.json'),
      stableJson({ ...reference, title: 'Changed title' }),
    );
    expect(() =>
      approveSpecRun({ runId: proposed.runId, hash: proposed.hash, runsRoot }),
    ).toThrow(/hash mismatch/u);

    writeFileSync(path.join(proposed.runRoot, 'game-spec.json'), '{"invalid":true}\n');
    expect(() =>
      approveSpecRun({ runId: proposed.runId, hash: sha256('{"invalid":true}\n'), runsRoot }),
    ).toThrow(/Current spec is invalid/u);
  });

  it('rejects empty and oversized input before a model call or run is created', async () => {
    const runsRoot = workspace();
    const fake = fakeClient([reference]);
    await expect(
      proposeSpecRun({ ...fixedOptions(runsRoot), prompt: '', client: fake.client }),
    ).rejects.toThrow(/1 through 4000/u);
    await expect(
      proposeSpecRun({ ...fixedOptions(runsRoot), prompt: 'x'.repeat(4_001), client: fake.client }),
    ).rejects.toThrow(/1 through 4000/u);
    expect(fake.generate).not.toHaveBeenCalled();
  });
});
