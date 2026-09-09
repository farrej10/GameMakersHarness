import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameSpec, VerifyResult } from '../../src/contracts/index';
import { stableJson, type RunStatus } from '../../src/toolkit/cli';
import { EventWriter } from '../../src/toolkit/events';
import { generateExecutionReport } from '../../src/toolkit/report';

const reference = JSON.parse(
  readFileSync(new URL('../fixtures/reference/game-spec.json', import.meta.url), 'utf8'),
) as GameSpec;
const runId = '20260909T120000Z-abcdef12';

function makeRun(
  state: RunStatus['state'],
  verificationStatus: 'passed' | 'failed',
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'game-report-'));
  const status: RunStatus = {
    schemaVersion: 1,
    runId,
    state,
    requestCount: 1,
    activeElapsedMs: 50,
    reasonCode: state === 'stopped' ? 'VERIFY_FAILED' : null,
    message: state === 'stopped' ? 'failed' : null,
  };
  writeFileSync(path.join(root, 'status.json'), stableJson(status));
  writeFileSync(path.join(root, 'prompt.txt'), 'Make <danger> & collect.', 'utf8');
  writeFileSync(
    path.join(root, 'game-spec.json'),
    stableJson({ ...reference, title: '<script>alert("x")</script>' }),
  );
  writeFileSync(
    path.join(root, 'approval.json'),
    stableJson({ schemaVersion: 1, specSha256: 'a'.repeat(64), approvedAt: '2026-09-09T12:00:00.000Z' }),
  );
  mkdirSync(path.join(root, 'requests'));
  writeFileSync(
    path.join(root, 'requests', 'logic_0.json'),
    stableJson({
      request: { requestId: 'logic_0', role: 'logic', model: 'small/model' },
      response: {
        requestedModel: 'small/model',
        returnedModel: 'small/model',
        provider: 'fixture',
        promptTokens: 10,
        completionTokens: 4,
        reportedCostUsd: null,
        elapsedMs: 2,
      },
      context: { sha256: 'b'.repeat(64) },
    }),
  );
  const events = new EventWriter(runId, path.join(root, 'events.jsonl'), () => new Date('2026-09-09T12:00:00.000Z'));
  events.append({ type: 'run.created', role: null, attempt: null, data: { promptPath: 'prompt.txt', configPath: 'config.json' } });
  events.append({ type: 'worker.started', role: 'logic', attempt: 0, data: { requestId: 'logic_0' } });
  events.append({ type: 'worker.completed', role: 'logic', attempt: 0, data: { requestId: 'logic_0', artifactPath: 'workers/logic/attempt-0/output.json' } });
  mkdirSync(path.join(root, 'evidence', 'attempt-0'), { recursive: true });
  const verification: VerifyResult = {
    schemaVersion: 1,
    runId,
    attempt: 0,
    startedAt: '2026-09-09T12:00:00.000Z',
    finishedAt: '2026-09-09T12:00:01.000Z',
    status: verificationStatus,
    checks: [
      {
        id: 'PLAY-01',
        stage: 'browser',
        status: verificationStatus,
        owner: 'runtime',
        message: '<unsafe check message>',
        expected: null,
        actual: null,
        artifactPaths: [],
      },
    ],
  };
  writeFileSync(path.join(root, 'evidence', 'attempt-0', 'verify.json'), stableJson(verification));
  return root;
}

describe('execution report', () => {
  it('escapes model-controlled text and never labels a failed run verified', () => {
    const root = makeRun('stopped', 'failed');
    const report = generateExecutionReport(root);
    const html = readFileSync(path.join(root, 'report.html'), 'utf8');

    expect(report.provenance).toBe('fixture');
    expect(report.playableBuild).toBeNull();
    expect(report.reportedCostUsd).toBeNull();
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Make &lt;danger&gt; &amp; collect.');
    expect(html).toContain('reported cost: unknown');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('Play verified build');
  });

  it('links only an all-pass verified build with relative local paths', () => {
    const root = makeRun('verified', 'passed');
    const report = generateExecutionReport(root, 'injected-fault');
    const html = readFileSync(path.join(root, 'report.html'), 'utf8');

    expect(report.playableBuild).toBe('build/index.html');
    expect(report.provenance).toBe('injected-fault');
    expect(html).toContain('href="build/index.html"');
    expect(html).toContain('VERIFIED');
    expect(JSON.parse(readFileSync(path.join(root, 'report.json'), 'utf8'))).toEqual(report);
  });

  it('lists repair before/after/diff evidence when present', () => {
    const root = makeRun('stopped', 'failed');
    mkdirSync(path.join(root, 'evidence', 'attempt-1', 'before'), { recursive: true });
    mkdirSync(path.join(root, 'evidence', 'attempt-1', 'after'), { recursive: true });
    writeFileSync(path.join(root, 'evidence', 'attempt-1', 'before', 'logic.json'), '{}');
    writeFileSync(path.join(root, 'evidence', 'attempt-1', 'after', 'logic.json'), '{}');
    writeFileSync(path.join(root, 'evidence', 'attempt-1', 'change.diff'), 'diff');

    const report = generateExecutionReport(root);
    expect(report.repairEvidence[0]).toEqual({
      attempt: 1,
      before: ['evidence/attempt-1/before/logic.json'],
      after: ['evidence/attempt-1/after/logic.json'],
      diff: 'evidence/attempt-1/change.diff',
    });
  });
});
