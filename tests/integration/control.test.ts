import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stableJson } from '../../src/toolkit/cli';
import { startControlServer, type ControlServer } from '../../src/toolkit/control';

const runId = '20260909T120000Z-abcdef12';

describe('local control page', () => {
  let server: ControlServer | undefined;
  afterEach(async () => server?.close());

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
    expect(await page.text()).toContain('Agentic Game Maker');
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
  });
});
