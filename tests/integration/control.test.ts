import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256, stableJson } from '../../src/toolkit/cli';
import { startControlServer, type ControlServer } from '../../src/toolkit/control';
import { EventWriter, readEvents } from '../../src/toolkit/events';

const runId = '20260909T120000Z-abcdef12';

describe('local control page', () => {
  let server: ControlServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('serves the UI, checks mutation origin, and invokes injected actions', async () => {
    const runsRoot = mkdtempSync(path.join(tmpdir(), 'control-runs-'));
    const propose = vi.fn(async () => ({
      runId,
      hash: 'a'.repeat(64),
      spec: { title: 'Fixture game' },
    }));
    const approve = vi.fn(async () => undefined);
    const generate = vi.fn(async () => undefined);
    server = await startControlServer({
      port: 0,
      gamePort: 0,
      runsRoot,
      actions: { propose, approve, generate },
    });

    const page = await fetch(server.origin);
    const pageText = await page.text();
    expect(pageText).toContain('Agentic Game Maker');
    expect(pageText).toContain('Design summary');
    expect(pageText).toContain('Demonstrate autonomous repair');
    expect(pageText).toContain('Agent outputs and errors');
    expect(pageText).toContain('Retry failed run');
    expect(pageText).toContain('class="spinner"');
    expect(pageText).toContain('Agent instructions (optional)');
    const forbidden = await fetch(`${server.origin}/api/spec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'game', seed: 42 }),
    });
    expect(forbidden.status).toBe(403);

    const proposed = await fetch(`${server.origin}/api/spec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({ prompt: 'game', seed: 42 }),
    });
    expect(await proposed.json()).toMatchObject({ runId, hash: 'a'.repeat(64) });
    expect(propose).toHaveBeenCalledWith('game', 42);

    await fetch(`${server.origin}/api/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({ runId, hash: 'a'.repeat(64) }),
    });
    const generated = await fetch(`${server.origin}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({ runId }),
    });
    expect(generated.status).toBe(202);
    expect(approve).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
  });

  it('retries a stopped run as a linked run with the same approved specification', async () => {
    const runsRoot = mkdtempSync(path.join(tmpdir(), 'control-retry-'));
    const sourceRoot = path.join(runsRoot, runId);
    mkdirSync(sourceRoot, { recursive: true });
    const specText = readFileSync(new URL('../fixtures/reference/game-spec.json', import.meta.url), 'utf8');
    const spec = JSON.parse(specText) as object;
    const hash = sha256(stableJson(spec));
    writeFileSync(path.join(sourceRoot, 'prompt.txt'), 'Retry this game.');
    writeFileSync(path.join(sourceRoot, 'config.json'), stableJson({ models: {}, limits: {} }));
    writeFileSync(path.join(sourceRoot, 'game-spec.json'), stableJson(spec));
    writeFileSync(path.join(sourceRoot, 'approval.json'), stableJson({ schemaVersion: 1, specSha256: hash, approvedAt: '2026-09-09T12:00:00.000Z' }));
    writeFileSync(path.join(sourceRoot, 'status.json'), stableJson({
      schemaVersion: 1, runId, state: 'stopped', requestCount: 4, activeElapsedMs: 100,
      reasonCode: 'GENERATION_FAILED', message: 'Logic failed.',
    }));
    const generate = vi.fn(async () => undefined);
    server = await startControlServer({
      port: 0,
      gamePort: 0,
      runsRoot,
      actions: {
        propose: async () => ({ runId, hash, spec }),
        approve: async () => undefined,
        generate,
      },
    });

    const response = await fetch(`${server.origin}/api/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({
        runId,
        pauseForReview: true,
        agentInstructions: { logic: 'Follow the valid source example exactly.' },
      }),
    });
    expect(response.status).toBe(202);
    const retried = await response.json() as { runId: string };
    expect(retried.runId).not.toBe(runId);
    expect((retried as { agentInstructions?: object }).agentInstructions).toEqual({
      logic: 'Follow the valid source example exactly.',
    });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledWith(retried.runId, { pauseForReview: true }));
    expect(readEvents(path.join(runsRoot, retried.runId, 'events.jsonl')).at(-1)).toMatchObject({
      type: 'run.retried', data: { sourceRunId: runId },
    });
  });

  it('serves reports on the control origin and games on a separate origin', async () => {
    const runsRoot = mkdtempSync(path.join(tmpdir(), 'control-play-'));
    const runRoot = path.join(runsRoot, runId);
    mkdirSync(path.join(runRoot, 'build'), { recursive: true });
    writeFileSync(
      path.join(runRoot, 'status.json'),
      stableJson({
        schemaVersion: 1,
        runId,
        state: 'verified',
        requestCount: 4,
        activeElapsedMs: 10,
        reasonCode: null,
        message: null,
      }),
    );
    writeFileSync(path.join(runRoot, 'report.html'), '<h1>Report</h1>');
    writeFileSync(path.join(runRoot, 'build', 'index.html'), '<h1>Playable</h1>');
    const events = new EventWriter(runId, path.join(runRoot, 'events.jsonl'));
    for (const role of ['logic', 'level', 'art'] as const) {
      events.append({ type: 'worker.started', role, attempt: 0, data: { requestId: `${role}_0` } });
      events.append({
        type: 'worker.completed',
        role,
        attempt: 0,
        data: { requestId: `${role}_0`, artifactPath: `workers/${role}/attempt-0/output.json` },
      });
    }
    events.append({
      type: 'demo.fault.injected',
      role: 'logic',
      attempt: null,
      data: {
        owner: 'logic',
        fault: 'logic-victory',
        originalPath: 'evidence/demo-fault/original-logic.json',
        injectedPath: 'evidence/demo-fault/injected-logic.json',
      },
    });
    events.append({
      type: 'repair.started',
      role: 'repair',
      attempt: 1,
      data: { owner: 'logic', requestId: 'repair_1', checkIds: ['PLAY-07'] },
    });
    events.append({
      type: 'artifact.rejected',
      role: 'repair',
      attempt: 1,
      data: { artifact: 'logic', errors: ['invalid'] },
    });
    server = await startControlServer({
      port: 0,
      gamePort: 0,
      runsRoot,
      actions: {
        propose: async () => ({ runId, hash: '', spec: {} }),
        approve: async () => undefined,
        generate: async () => undefined,
      },
    });

    const report = await fetch(`${server.origin}/report/${runId}`);
    expect(await report.text()).toBe('<h1>Report</h1>');
    const play = await fetch(`${server.origin}/api/play`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({ runId }),
    });
    const body = (await play.json()) as { origin: string };
    expect(body.origin).not.toBe(server.origin);
    expect(await (await fetch(body.origin)).text()).toBe('<h1>Playable</h1>');

    const progress = await fetch(`${server.origin}/api/run/${runId}`);
    await expect(progress.json()).resolves.toMatchObject({
      state: 'verified',
      workers: [
        { role: 'logic', status: 'completed' },
        { role: 'level', status: 'completed' },
        { role: 'art', status: 'completed' },
      ],
      repair: { owner: 'logic', attempt: 1, status: 'failed' },
    });
  });
});
