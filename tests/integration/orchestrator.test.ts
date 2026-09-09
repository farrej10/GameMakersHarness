import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ArtOutput, GameSpec, LevelOutput, LogicOutput, VerifyResult } from '../../src/contracts/index';
import type { ToolkitConfig } from '../../src/toolkit/config';
import { approveSpecRun, proposeSpecRun, stableJson, type RunStatus } from '../../src/toolkit/cli';
import { readEvents } from '../../src/toolkit/events';
import type { ModelClient, ModelRequest, ModelResult } from '../../src/toolkit/openrouter';
import { generateRun, transitionRun } from '../../src/toolkit/orchestrator';

function json<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/reference/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

const spec = json<GameSpec>('game-spec.json');
const level = json<LevelOutput>('level.json');
const art = json<ArtOutput>('art.json');
const logic: LogicOutput = {
  schemaVersion: 1,
  source: readFileSync(new URL('../fixtures/reference/rules.ts', import.meta.url), 'utf8'),
};
const config: ToolkitConfig = {
  apiKey: 'fake',
  models: { spec: 'fake', logic: 'fake', level: 'fake', art: 'fake', repair: 'fake' },
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

function response(request: ModelRequest, content: unknown): ModelResult {
  return {
    content,
    responseId: `${request.requestId}-response`,
    requestedModel: request.model,
    returnedModel: request.model,
    provider: 'fixture',
    promptTokens: 1,
    completionTokens: 1,
    reportedCostUsd: null,
    elapsedMs: 1,
  };
}

function verification(
  runId: string,
  status: 'passed' | 'failed' = 'passed',
  owner: 'logic' | 'harness' = 'logic',
): VerifyResult {
  return {
    schemaVersion: 1,
    runId,
    attempt: 0,
    startedAt: '2026-09-09T00:00:00.000Z',
    finishedAt: '2026-09-09T00:00:01.000Z',
    status,
    checks: [
      {
        id: 'fixture',
        stage: 'browser',
        status,
        owner,
        message: 'fixture verification',
        expected: null,
        actual: null,
        artifactPaths: [],
      },
    ],
  };
}

async function approvedRun(): Promise<{ runsRoot: string; runRoot: string; runId: string }> {
  const runsRoot = mkdtempSync(path.join(tmpdir(), 'orchestrator-runs-'));
  const specClient: ModelClient = {
    generate: async (request) => response(request, spec),
  };
  const proposed = await proposeSpecRun({
    prompt: 'Collect batteries while avoiding hazards.',
    seed: 42,
    config,
    client: specClient,
    runsRoot,
    now: () => new Date('2026-09-09T10:00:00.000Z'),
    entropy: Buffer.from('aabbccdd', 'hex'),
  });
  approveSpecRun({ runId: proposed.runId, hash: proposed.hash, runsRoot });
  return { runsRoot, runRoot: proposed.runRoot, runId: proposed.runId };
}

function outputFor(request: ModelRequest): unknown {
  if (request.role === 'logic') return logic;
  if (request.role === 'level') return level;
  if (request.role === 'art') return art;
  throw new Error(`Unexpected role ${request.role}`);
}

describe('orchestrator', () => {
  it('dispatches all three workers before any completes and integrates before verify', async () => {
    const run = await approvedRun();
    const started: string[] = [];
    const completed: string[] = [];
    const pending = new Map<string, () => void>();
    const client: ModelClient = {
      generate: (request) =>
        new Promise((resolve) => {
          started.push(request.role);
          pending.set(request.role, () => {
            completed.push(request.role);
            resolve(response(request, outputFor(request)));
          });
          if (pending.size === 3) {
            for (const role of ['art', 'logic', 'level']) pending.get(role)?.();
          }
        }),
    };
    const verify = vi.fn(async (runId: string) => {
      expect(completed).toHaveLength(3);
      expect(existsSync(path.join(run.runRoot, 'integration', 'generated', 'rules.ts'))).toBe(true);
      return verification(runId);
    });

    await expect(generateRun({ ...run, client, verify })).resolves.toMatchObject({ status: 'passed' });
    expect(started).toEqual(['logic', 'level', 'art']);
    expect(verify).toHaveBeenCalledOnce();
    expect(existsSync(path.join(run.runRoot, 'integration', 'public', 'assets', 'player.png'))).toBe(true);
    const status = JSON.parse(readFileSync(path.join(run.runRoot, 'status.json'), 'utf8')) as RunStatus;
    expect(status.state).toBe('verified');
    expect(status.requestCount).toBe(4);
    const eventTypes = readEvents(path.join(run.runRoot, 'events.jsonl')).map(({ type }) => type);
    expect(eventTypes).toContain('integration.completed');
    expect(eventTypes.at(-1)).toBe('run.verified');
  });

  it('blocks a changed approved spec before any model call', async () => {
    const run = await approvedRun();
    writeFileSync(path.join(run.runRoot, 'game-spec.json'), stableJson({ ...spec, title: 'Edited' }));
    const generate = vi.fn();
    await expect(
      generateRun({ ...run, client: { generate }, verify: async () => verification(run.runId) }),
    ).rejects.toThrow(/hash has changed/u);
    expect(generate).not.toHaveBeenCalled();
    expect(existsSync(path.join(run.runsRoot, '.active-generation.lock'))).toBe(false);
  });

  it('rejects a second concurrent run and releases the owned lock', async () => {
    const run = await approvedRun();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client: ModelClient = {
      generate: async (request) => {
        await gate;
        return response(request, outputFor(request));
      },
    };
    const first = generateRun({ ...run, client, verify: async () => verification(run.runId) });
    await vi.waitFor(() => expect(existsSync(path.join(run.runsRoot, '.active-generation.lock'))).toBe(true));
    await expect(
      generateRun({ ...run, client, verify: async () => verification(run.runId) }),
    ).rejects.toThrow(/active-run lock/u);
    release();
    await first;
    expect(existsSync(path.join(run.runsRoot, '.active-generation.lock'))).toBe(false);
  });

  it('records a failed initial verification as terminal', async () => {
    const run = await approvedRun();
    const client: ModelClient = {
      generate: async (request) => response(request, outputFor(request)),
    };
    await expect(
      generateRun({
        ...run,
        client,
        verify: async () => verification(run.runId, 'failed', 'harness'),
      }),
    ).resolves.toMatchObject({ status: 'failed' });
    const status = JSON.parse(readFileSync(path.join(run.runRoot, 'status.json'), 'utf8')) as RunStatus;
    expect(status).toMatchObject({
      state: 'stopped',
      reasonCode: 'UNREPAIRABLE_FAILURE',
    });
  });

  it('repairs failed generated logic and reruns verification without human input', async () => {
    const run = await approvedRun();
    const brokenLogic: LogicOutput = {
      schemaVersion: 1,
      source: readFileSync(
        new URL('../fixtures/reference/rules-broken.ts', import.meta.url),
        'utf8',
      ),
    };
    const roles: string[] = [];
    const client: ModelClient = {
      generate: async (request) => {
        roles.push(request.role);
        if (request.role === 'logic') return response(request, brokenLogic);
        if (request.role === 'repair') {
          return response(request, {
            schemaVersion: 1,
            diagnosis: 'Victory ignored exit contact; replacement checks it.',
            output: logic,
          });
        }
        return response(request, outputFor(request));
      },
    };
    const verify = vi.fn(async (runId: string, attempt: number) => {
      const integrated = readFileSync(
        path.join(run.runRoot, 'integration', 'generated', 'rules.ts'),
        'utf8',
      );
      if (attempt === 0) {
        expect(integrated).toContain('Math.sign');
        return verification(runId, 'failed');
      }
      expect(integrated).toBe(logic.source);
      return verification(runId, 'passed');
    });

    await expect(generateRun({ ...run, client, verify })).resolves.toMatchObject({
      status: 'passed',
    });
    expect(roles.filter((role) => role === 'repair')).toHaveLength(1);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(existsSync(path.join(run.runRoot, 'evidence', 'attempt-1', 'before', 'logic.json'))).toBe(true);
    expect(existsSync(path.join(run.runRoot, 'evidence', 'attempt-1', 'after', 'logic.json'))).toBe(true);
    expect(readFileSync(path.join(run.runRoot, 'evidence', 'attempt-1', 'change.diff'), 'utf8')).toContain(
      '+++ after',
    );
    expect(readEvents(path.join(run.runRoot, 'events.jsonl')).map(({ type }) => type)).toEqual(
      expect.arrayContaining(['repair.started', 'repair.completed', 'run.verified']),
    );
  });

  it('stops after three rejected repairs and never dispatches a fourth', async () => {
    const run = await approvedRun();
    const invalidRepair = {
      schemaVersion: 1,
      diagnosis: 'This replacement remains invalid.',
      output: {
        ...logic,
        source: `${logic.source}\nexport function forbidden(): boolean { return true; }`,
      },
    };
    let repairCalls = 0;
    const client: ModelClient = {
      generate: async (request) => {
        if (request.role === 'repair') {
          repairCalls += 1;
          return response(request, invalidRepair);
        }
        return response(request, outputFor(request));
      },
    };

    await expect(
      generateRun({
        ...run,
        client,
        verify: async () => verification(run.runId, 'failed'),
      }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(repairCalls).toBe(3);
    const status = JSON.parse(readFileSync(path.join(run.runRoot, 'status.json'), 'utf8')) as RunStatus;
    expect(status).toMatchObject({ state: 'stopped', reasonCode: 'REPAIR_LIMIT' });
    expect(existsSync(path.join(run.runRoot, 'evidence', 'attempt-3', 'after', 'rejected.json'))).toBe(true);
  });
});

describe('run transitions', () => {
  it('permits declared transitions and rejects illegal ones', () => {
    const status: RunStatus = {
      schemaVersion: 1,
      runId: '20260909T000000Z-aabbccdd',
      state: 'awaiting-approval',
      requestCount: 0,
      activeElapsedMs: 0,
      reasonCode: null,
      message: null,
    };
    transitionRun(status, 'generating');
    expect(status.state).toBe('generating');
    expect(() => transitionRun(status, 'verified')).toThrow(/Illegal run transition/u);
  });
});
