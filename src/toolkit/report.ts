import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GameSpec, RunEvent, VerifyResult } from '../contracts/index';
import { readRunStatus, stableJson, type RunStatus } from './cli';
import { readEvents } from './events';

type RequestSummary = {
  requestId: string;
  role: string;
  requestedModel: string;
  returnedModel: string;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reportedCostUsd: number | null;
  elapsedMs: number | null;
  contextSha256: string | null;
};

export type ExecutionReport = {
  schemaVersion: 1;
  runId: string;
  provenance: 'live' | 'fixture' | 'injected-fault';
  status: RunStatus;
  prompt: string;
  spec: GameSpec | null;
  approvalHash: string | null;
  artSource: 'generated' | 'fallback';
  requests: RequestSummary[];
  requestCount: number;
  reportedCostUsd: number | null;
  workerIntervals: Array<{
    role: string;
    startedAt: string;
    finishedAt: string | null;
    status: 'completed' | 'failed' | 'running';
  }>;
  verification: VerifyResult | null;
  repairEvidence: Array<{
    attempt: number;
    before: string[];
    after: string[];
    diff: string | null;
  }>;
  playableBuild: string | null;
};

function json<T>(filePath: string): T | null {
  return existsSync(filePath)
    ? (JSON.parse(readFileSync(filePath, 'utf8')) as T)
    : null;
}

function requestSummaries(runRoot: string): RequestSummary[] {
  const root = path.join(runRoot, 'requests');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const stored = json<Record<string, unknown>>(path.join(root, name)) ?? {};
      const request = (stored.request ?? {}) as Record<string, unknown>;
      const response = (stored.response ?? stored.result ?? {}) as Record<string, unknown>;
      const context = (stored.context ?? {}) as Record<string, unknown>;
      return {
        requestId: typeof request.requestId === 'string' ? request.requestId : name.slice(0, -5),
        role: typeof request.role === 'string' ? request.role : 'unknown',
        requestedModel: typeof response.requestedModel === 'string'
          ? response.requestedModel
          : typeof request.model === 'string'
            ? request.model
            : 'unknown',
        returnedModel: typeof response.returnedModel === 'string' ? response.returnedModel : 'unknown',
        provider: typeof response.provider === 'string' ? response.provider : null,
        promptTokens: typeof response.promptTokens === 'number' ? response.promptTokens : null,
        completionTokens: typeof response.completionTokens === 'number' ? response.completionTokens : null,
        reportedCostUsd: typeof response.reportedCostUsd === 'number' ? response.reportedCostUsd : null,
        elapsedMs: typeof response.elapsedMs === 'number' ? response.elapsedMs : null,
        contextSha256: typeof stored.contextSha256 === 'string'
          ? stored.contextSha256
          : typeof context.sha256 === 'string'
            ? context.sha256
            : null,
      };
    });
}

function workerIntervals(events: RunEvent[]): ExecutionReport['workerIntervals'] {
  return events
    .filter((event) => event.type === 'worker.started')
    .map((started) => {
      const finished = events.find(
        (event) =>
          event.sequence > started.sequence &&
          event.role === started.role &&
          (event.type === 'worker.completed' || event.type === 'worker.failed'),
      );
      return {
        role: started.role ?? 'unknown',
        startedAt: started.at,
        finishedAt: finished?.at ?? null,
        status: finished?.type === 'worker.completed'
          ? 'completed' as const
          : finished?.type === 'worker.failed'
            ? 'failed' as const
            : 'running' as const,
      };
    });
}

function latestVerification(runRoot: string): VerifyResult | null {
  const evidenceRoot = path.join(runRoot, 'evidence');
  if (!existsSync(evidenceRoot)) return null;
  const candidates = readdirSync(evidenceRoot)
    .map((name) => ({ name, attempt: Number(name.match(/^attempt-(\d+)$/u)?.[1]) }))
    .filter(({ attempt }) => Number.isInteger(attempt))
    .sort((first, second) => second.attempt - first.attempt);
  for (const candidate of candidates) {
    const result = json<VerifyResult>(path.join(evidenceRoot, candidate.name, 'verify.json'));
    if (result) return result;
  }
  return null;
}

function repairEvidence(runRoot: string): ExecutionReport['repairEvidence'] {
  const evidenceRoot = path.join(runRoot, 'evidence');
  if (!existsSync(evidenceRoot)) return [];
  return readdirSync(evidenceRoot)
    .map((name) => ({ name, attempt: Number(name.match(/^attempt-(\d+)$/u)?.[1]) }))
    .filter(({ attempt }) => Number.isInteger(attempt) && attempt > 0)
    .sort((first, second) => first.attempt - second.attempt)
    .map(({ name, attempt }) => {
      const relativeFiles = (subdirectory: string) => {
        const root = path.join(evidenceRoot, name, subdirectory);
        return existsSync(root)
          ? readdirSync(root).map((file) => `evidence/${name}/${subdirectory}/${file}`)
          : [];
      };
      const diff = path.join(evidenceRoot, name, 'change.diff');
      return {
        attempt,
        before: relativeFiles('before'),
        after: relativeFiles('after'),
        diff: existsSync(diff) ? `evidence/${name}/change.diff` : null,
      };
    });
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function link(relative: string, label = relative): string {
  return `<a href="${escapeHtml(relative.replaceAll('\\', '/'))}">${escapeHtml(label)}</a>`;
}

function html(report: ExecutionReport): string {
  const verified = report.status.state === 'verified' &&
    report.verification?.status === 'passed' &&
    report.verification.checks.every(({ status }) => status === 'passed');
  const checks = report.verification?.checks ?? [];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(report.spec?.title ?? report.runId)} — execution report</title>
<style>body{font:16px system-ui;max-width:1100px;margin:auto;padding:2rem;color:#17231d}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd8d0;padding:.45rem;text-align:left}pre{white-space:pre-wrap;background:#f4f7f5;padding:1rem}.passed{color:#176b3a}.failed{color:#a12626}</style></head><body>
<h1>${escapeHtml(report.spec?.title ?? report.runId)}</h1>
<p class="${verified ? 'passed' : 'failed'}"><strong>${verified ? 'VERIFIED' : escapeHtml(report.status.state.toUpperCase())}</strong> · provenance: ${escapeHtml(report.provenance)}</p>
<p>${verified && report.playableBuild ? link(report.playableBuild, 'Play verified build') : 'No verified playable build is available.'}</p>
<h2>Approved request</h2><pre>${escapeHtml(report.prompt)}</pre>
<p>Approval hash: ${escapeHtml(report.approvalHash ?? 'unknown')}</p>
<p>Art source: ${escapeHtml(report.artSource)} · requests: ${report.requestCount} · reported cost: ${report.reportedCostUsd === null ? 'unknown' : `$${report.reportedCostUsd.toFixed(6)}`}</p>
<h2>Worker timeline</h2><table><thead><tr><th>Role</th><th>Started</th><th>Finished</th><th>Status</th></tr></thead><tbody>${report.workerIntervals.map((item) => `<tr><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.startedAt)}</td><td>${escapeHtml(item.finishedAt ?? 'unknown')}</td><td>${escapeHtml(item.status)}</td></tr>`).join('')}</tbody></table>
<h2>Model requests</h2><table><thead><tr><th>ID</th><th>Role</th><th>Requested / returned</th><th>Provider</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>${report.requests.map((item) => `<tr><td>${escapeHtml(item.requestId)}</td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.requestedModel)} / ${escapeHtml(item.returnedModel)}</td><td>${escapeHtml(item.provider ?? 'unknown')}</td><td>${escapeHtml(item.promptTokens ?? 'unknown')} / ${escapeHtml(item.completionTokens ?? 'unknown')}</td><td>${item.reportedCostUsd === null ? 'unknown' : escapeHtml(item.reportedCostUsd)}</td></tr>`).join('')}</tbody></table>
<h2>Verification</h2><table><thead><tr><th>Check</th><th>Stage</th><th>Owner</th><th>Status</th><th>Message</th></tr></thead><tbody>${checks.map((check) => `<tr><td>${escapeHtml(check.id)}</td><td>${escapeHtml(check.stage)}</td><td>${escapeHtml(check.owner)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.message)}</td></tr>`).join('')}</tbody></table>
<h2>Repair evidence</h2>${report.repairEvidence.length ? report.repairEvidence.map((repair) => `<p>Attempt ${repair.attempt}: ${[...repair.before, ...repair.after, ...(repair.diff ? [repair.diff] : [])].map((item) => link(item)).join(' · ')}</p>`).join('') : '<p>None.</p>'}
</body></html>\n`;
}

export function generateExecutionReport(
  runRoot: string,
  provenance?: ExecutionReport['provenance'],
): ExecutionReport {
  const status = readRunStatus(runRoot);
  const events = readEvents(path.join(runRoot, 'events.jsonl'));
  const requests = requestSummaries(runRoot);
  const verification = latestVerification(runRoot);
  const knownCosts = requests
    .map(({ reportedCostUsd }) => reportedCostUsd)
    .filter((value): value is number => value !== null);
  const inferredProvenance = events.some(({ type }) => type === 'demo.fault.injected')
    ? 'injected-fault'
    : requests.some(({ provider }) => provider === 'fixture')
      ? 'fixture'
      : 'live';
  const verified = status.state === 'verified' &&
    verification?.status === 'passed' &&
    verification.checks.every(({ status: checkStatus }) => checkStatus === 'passed');
  const report: ExecutionReport = {
    schemaVersion: 1,
    runId: status.runId,
    provenance: provenance ?? inferredProvenance,
    status,
    prompt: existsSync(path.join(runRoot, 'prompt.txt'))
      ? readFileSync(path.join(runRoot, 'prompt.txt'), 'utf8')
      : '',
    spec: json<GameSpec>(path.join(runRoot, 'game-spec.json')),
    approvalHash: json<{ specSha256: string }>(path.join(runRoot, 'approval.json'))?.specSha256 ?? null,
    artSource: events.some(({ type }) => type === 'art.fallback') ? 'fallback' : 'generated',
    requests,
    requestCount: status.requestCount,
    reportedCostUsd: knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null,
    workerIntervals: workerIntervals(events),
    verification,
    repairEvidence: repairEvidence(runRoot),
    playableBuild: verified ? 'build/index.html' : null,
  };
  writeFileSync(path.join(runRoot, 'report.json'), stableJson(report));
  writeFileSync(path.join(runRoot, 'report.html'), html(report), 'utf8');
  return report;
}
