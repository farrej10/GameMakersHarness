import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyBrowserFailure,
  compareProtectedFiles,
  snapshotProtectedFiles,
} from '../../scripts/verify';
import { startStaticServer, type StaticServer } from '../../src/toolkit/serve';

describe('protected file snapshots', () => {
  it('detects changes, additions, and deletions', () => {
    expect(
      compareProtectedFiles(
        { 'one.ts': 'a', 'deleted.ts': 'b' },
        { 'one.ts': 'changed', 'added.ts': 'c' },
      ),
    ).toEqual(['added.ts', 'deleted.ts', 'one.ts']);
  });

  it('is stable when the workspace is unchanged', () => {
    expect(compareProtectedFiles(snapshotProtectedFiles(), snapshotProtectedFiles())).toEqual([]);
  });
});

describe('browser failure ownership', () => {
  it('classifies the first failed test instead of an earlier passing test name', () => {
    const output = [
      '  ok  1 gameplay.spec.ts › PLAY-01 actual generated game loads',
      '  x   7 gameplay.spec.ts › PLAY-07 collect-then-exit requires exit contact',
      '  x  12 gameplay.spec.ts › POLICY-03 generated victory truth table',
    ].join('\n');
    expect(classifyBrowserFailure(output)).toEqual({ id: 'PLAY-07', owner: 'logic' });
  });
});

describe('static-only server', () => {
  let server: StaticServer | undefined;
  afterEach(async () => server?.close());

  it('serves files from its root and rejects traversal', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'game-maker-server-'));
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'index.html'), '<h1>game</h1>');
    writeFileSync(path.join(root, 'assets', 'value.txt'), 'inside');
    server = await startStaticServer(root, 0);

    const page = await fetch(`${server.origin}/`);
    const asset = await fetch(`${server.origin}/assets/value.txt`);
    const traversal = await fetch(`${server.origin}/%2e%2e/package.json`);
    expect(await page.text()).toBe('<h1>game</h1>');
    expect(await asset.text()).toBe('inside');
    expect(traversal.status).toBeGreaterThanOrEqual(400);
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('<h1>game</h1>');
  });
});
