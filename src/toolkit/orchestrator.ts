import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Approval,
  ArtOutput,
  CheckResult,
  GameSpec,
  LevelOutput,
  LogicOutput,
  RunState,
  VerifyResult,
} from '../contracts/index';
import { validateApproval, validateGameSpec } from '../contracts/index';
import { snapshotProtectedFiles } from '../../scripts/verify';
import { loadToolkitConfig, type ToolkitConfig } from './config';
import { EventWriter } from './events';
import { deriveAssetManifest, integrateArtifacts } from './integrate';
import {
  OpenRouterClient,
  RequestBudget,
  type ImageModelRequest,
  type ModelClient,
  type ModelRequest,
  type ModelResult,
  type RetryNotice,
} from './openrouter';
import { generateExecutionReport } from './report';
import {
  readRunStatus,
  safeRunRoot,
  sha256,
  stableJson,
  writeRunStatus,
  type RunStatus,
} from './cli';
import { runArtWorker, type ArtWorkerResult } from './workers/art';
import { runLevelWorker, type LevelWorkerResult } from './workers/level';
import { runLogicWorker, type LogicWorkerResult } from './workers/logic';
import { validateLogicArtifact } from './validate';
import {
  RepairRejectedError,
  runRepairWorker,
  type RepairOwner,
} from './workers/repair';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  draft: ['awaiting-approval', 'stopped'],
  'awaiting-approval': ['generating', 'stopped'],
  generating: ['integrating', 'stopped'],
  integrating: ['verifying', 'stopped'],
  verifying: ['repairing', 'verified', 'stopped'],
  repairing: ['integrating', 'stopped'],
  verified: [],
  stopped: [],
};

export function transitionRun(status: RunStatus, next: RunState): void {
  if (!TRANSITIONS[status.state].includes(next)) {
    throw new Error(`Illegal run transition: ${status.state} -> ${next}`);
  }
  status.state = next;
}

export function selectRepairTarget(
  verification: VerifyResult,
): { owner: RepairOwner; failures: CheckResult[] } | null {
  const failed = verification.checks.filter(({ status }) => status === 'failed');
  if (
    failed.some(
      ({ owner }) => owner !== 'logic' && owner !== 'level' && owner !== 'art',
    )
  ) {
    return null;
  }
  for (const owner of ['logic', 'level', 'art'] as const) {
    const failures = failed.filter((check) => check.owner === owner).slice(0, 3);
    if (failures.length) return { owner, failures };
  }
  return null;
}

function relevantLogs(runRoot: string, failures: readonly CheckResult[]): string {
  let excerpt = '';
  for (const failure of failures) {
    for (const artifactPath of failure.artifactPaths) {
      const candidate = path.resolve(runRoot, artifactPath);
      const relative = path.relative(runRoot, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(candidate)) continue;
      const remaining = 8_000 - Buffer.byteLength(excerpt);
      if (remaining <= 0) return excerpt;
      excerpt += `\n--- ${artifactPath} ---\n${readFileSync(candidate, 'utf8').slice(0, remaining)}`;
    }
  }
  return excerpt.slice(0, 8_000);
}

function replacementDiff(before: unknown, after: unknown): string {
  return `--- before\n+++ after\n-${JSON.stringify(before)}\n+${JSON.stringify(after)}\n`;
}

type Verification = (runId: string, attempt: number) => Promise<VerifyResult>;
type CompletedWorker = LogicWorkerResult | LevelWorkerResult | ArtWorkerResult;

async function settleWithLimit<T>(
  tasks: readonly (() => Promise<T>)[],
  requestedLimit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  const limit = Math.max(1, Math.min(tasks.length, requestedLimit));
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]!() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function injectVictoryDemoFault(logic: LogicOutput): LogicOutput {
  const marker = 'export function isVictory';
  const start = logic.source.lastIndexOf(marker);
  if (start < 0) throw new Error('Cannot inject demo fault: isVictory export was not found.');
  const injected: LogicOutput = {
    schemaVersion: 1,
    source: `${logic.source.slice(0, start)}export function isVictory(context: VictoryContext): boolean {\n  return context.score >= context.target;\n}\n`,
  };
  const issues = validateLogicArtifact(injected);
  if (issues.length) {
    throw new Error(`Cannot inject demo fault: ${issues.map(({ code }) => code).join(', ')}.`);
  }
  return injected;
}

function loadPublicConfig(runRoot: string, apiKey: string): ToolkitConfig {
  const value = JSON.parse(readFileSync(path.join(runRoot, 'config.json'), 'utf8')) as Omit<ToolkitConfig, 'apiKey'>;
  return { apiKey, models: value.models, limits: value.limits };
}

function recordWorkerResult(
  runRoot: string,
  role: 'logic' | 'level' | 'art',
  completed: CompletedWorker,
): void {
  if (completed.requests.length === 0) {
    const attemptRoot = path.join(runRoot, 'workers', role, 'attempt-0');
    mkdirSync(attemptRoot, { recursive: true });
    writeFileSync(path.join(attemptRoot, 'output.json'), stableJson(completed.output));
    return;
  }
  completed.requests.forEach(({ request, result, context }, index) => {
    const attemptRoot = path.join(runRoot, 'workers', role, `attempt-${index}`);
    mkdirSync(attemptRoot, { recursive: true });
    writeFileSync(
      path.join(attemptRoot, 'output.json'),
      stableJson(role === 'art' && index === completed.requests.length - 1 ? completed.output : result.content),
    );
    writeFileSync(
      path.join(runRoot, 'requests', `${request.requestId}.json`),
      stableJson({
        request,
        context: {
          sha256: context.sha256,
          bytes: context.bytes,
          system: context.system,
          user: context.user,
        },
        response: role === 'art'
          ? { ...result, content: { imageGenerated: true } }
          : result,
      }),
    );
  });
}

function recordingClient(runRoot: string, client: ModelClient): ModelClient {
  const save = (
    request: ModelRequest | ImageModelRequest,
    result: ModelResult,
  ) => {
    writeFileSync(
      path.join(runRoot, 'requests', `${request.requestId}.json`),
      stableJson({
        request,
        response: request.role === 'art'
          ? { ...result, content: { imageGenerated: true } }
          : result,
      }),
    );
    return result;
  };
  return {
    generate: async (request, signal) =>
      save(request, await client.generate(request, signal)),
    ...(client.generateImage
      ? {
          generateImage: async (request: ImageModelRequest, signal: AbortSignal) =>
            save(request, await client.generateImage!(request, signal)),
        }
      : {}),
  };
}

export async function generateRun(options: {
  runId: string;
  runsRoot?: string;
  client?: ModelClient;
  verify?: Verification;
  now?: () => Date;
  signal?: AbortSignal;
  demoFault?: 'logic-victory';
}): Promise<VerifyResult> {
  const runsRoot = options.runsRoot ?? path.join(projectRoot, 'runs');
  const runRoot = safeRunRoot(runsRoot, options.runId);
  const lockPath = path.join(runsRoot, '.active-generation.lock');
  let lock: number | undefined;
  try {
    lock = openSync(lockPath, 'wx');
    writeFileSync(lock, stableJson({ runId: options.runId, pid: process.pid }));
  } catch {
    throw new Error('Another generation run holds the active-run lock.');
  }
  const started = performance.now();
  const now = options.now ?? (() => new Date());
  const events = new EventWriter(options.runId, path.join(runRoot, 'events.jsonl'), now);
  const status = readRunStatus(runRoot);
  try {
    if (status.state !== 'awaiting-approval') {
      throw new Error(`Run is ${status.state}; generation requires awaiting-approval.`);
    }
    const specBytes = readFileSync(path.join(runRoot, 'game-spec.json'));
    const specValue: unknown = JSON.parse(specBytes.toString('utf8'));
    if (!validateGameSpec(specValue)) throw new Error('Approved specification no longer validates.');
    const spec: GameSpec = specValue;
    const approvalValue: unknown = JSON.parse(readFileSync(path.join(runRoot, 'approval.json'), 'utf8'));
    if (!validateApproval(approvalValue)) throw new Error('Approval record is missing or invalid.');
    const approval: Approval = approvalValue;
    if (approval.specSha256 !== sha256(specBytes)) throw new Error('Approved specification hash has changed.');

    mkdirSync(path.join(runRoot, 'evidence'), { recursive: true });
    mkdirSync(path.join(runRoot, 'requests'), { recursive: true });
    writeFileSync(
      path.join(runRoot, 'evidence', 'protected-baseline.json'),
      stableJson(snapshotProtectedFiles()),
    );
    const manifest = deriveAssetManifest();
    writeFileSync(path.join(runRoot, 'asset-manifest.json'), stableJson(manifest));
    transitionRun(status, 'generating');
    writeRunStatus(runRoot, status);

    const apiKey = options.client
      ? ''
      : loadToolkitConfig({ cwd: projectRoot, requireModels: false }).apiKey;
    const config = loadPublicConfig(runRoot, apiKey);
    const budget = new RequestBudget(
      config.limits.maxRequests,
      Date.now() + Math.max(1, config.limits.activeBudgetMs - status.activeElapsedMs),
      status.requestCount,
    );
    const onRetry = (notice: RetryNotice) =>
      events.append({ type: 'request.retry', role: null, attempt: null, data: notice });
    const baseClient = options.client ?? new OpenRouterClient({
      apiKey: config.apiKey,
      budget,
      requestTimeoutMs: config.limits.requestTimeoutMs,
      contextLimitBytes: config.limits.contextBytes,
      schemaLimitBytes: config.limits.schemaBytes,
      onRetry,
    });
    const client = recordingClient(runRoot, baseClient);
    const signal = options.signal ?? new AbortController().signal;
    const prompt = (role: string) => readFileSync(path.join(projectRoot, 'prompts', `${role}.md`), 'utf8');
    const jobs = [
      ['logic', () => runLogicWorker({ spec, model: config.models.logic, systemPrompt: prompt('logic'), client, signal })],
      ['level', () => runLevelWorker({ spec, model: config.models.level, systemPrompt: prompt('level'), client, signal })],
      ['art', () => runArtWorker({ spec, manifest, model: config.models.art, systemPrompt: prompt('art'), client, signal })],
    ] as const;
    const executeJob = async ([role, start]: (typeof jobs)[number]) => {
      events.append({ type: 'worker.started', role, attempt: 0, data: { requestId: `${role}_0` } });
      try {
        const completed = await start();
        recordWorkerResult(runRoot, role, completed);
        completed.rejected.forEach((errors, attempt) =>
          events.append({
            type: 'artifact.rejected',
            role,
            attempt,
            data: { artifact: `${role}.json`, errors },
          }),
        );
        events.append({
          type: 'worker.completed',
          role,
          attempt: Math.max(0, completed.requests.length - 1),
          data: {
            requestId: completed.requests.at(-1)?.request.requestId ?? `${role}_0`,
            artifactPath: `workers/${role}/attempt-${Math.max(0, completed.requests.length - 1)}/output.json`,
          },
        });
        return completed;
      } catch (error) {
        events.append({
          type: 'worker.failed',
          role,
          attempt: 0,
          data: {
            requestId: `${role}_0`,
            code: 'WORKER_FAILED',
            message: boundedMessage(error),
          },
        });
        throw error;
      }
    };
    const settled = await settleWithLimit(
      jobs.map((job) => () => executeJob(job)),
      config.limits.parallelWorkers,
    );
    const failures: Error[] = [];
    settled.forEach((entry) => {
      if (entry.status === 'rejected') {
        const error = entry.reason instanceof Error ? entry.reason : new Error(String(entry.reason));
        failures.push(error);
      }
    });
    status.requestCount = Math.max(status.requestCount + jobs.length, budget.count);
    if (failures.length) throw failures[0];

    const logic = (settled[0] as PromiseFulfilledResult<LogicWorkerResult>).value;
    const level = (settled[1] as PromiseFulfilledResult<LevelWorkerResult>).value;
    const art = (settled[2] as PromiseFulfilledResult<ArtWorkerResult>).value;
    let currentLogic: LogicOutput = logic.output;
    let currentLevel: LevelOutput = level.output;
    let currentArt: ArtOutput = art.output;
    if (options.demoFault === 'logic-victory') {
      const demoRoot = path.join(runRoot, 'evidence', 'demo-fault');
      mkdirSync(demoRoot, { recursive: true });
      writeFileSync(path.join(demoRoot, 'original-logic.json'), stableJson(currentLogic));
      currentLogic = injectVictoryDemoFault(currentLogic);
      writeFileSync(path.join(demoRoot, 'injected-logic.json'), stableJson(currentLogic));
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
    }
    if (art.artSource === 'fallback') {
      events.append({
        type: 'art.fallback',
        role: 'art',
        attempt: null,
        data: { reason: boundedMessage(art.fallbackReason ?? 'Generated art was unavailable.', 1_000) },
      });
    }
    transitionRun(status, 'integrating');
    writeRunStatus(runRoot, status);
    const integrationRoot = integrateArtifacts({
      runRoot,
      spec,
      logic: currentLogic,
      level: currentLevel,
      art: currentArt,
    });
    events.append({
      type: 'integration.completed',
      role: null,
      attempt: null,
      data: { integrationPath: path.relative(runRoot, integrationRoot).replaceAll('\\', '/') },
    });
    transitionRun(status, 'verifying');
    writeRunStatus(runRoot, status);
    events.append({ type: 'verify.started', role: null, attempt: 0, data: { verificationAttempt: 0 } });
    const verifier = options.verify ?? (await import('../../scripts/verify')).verifyRun;
    let verification = await verifier(options.runId, 0);
    events.append({
      type: 'verify.completed',
      role: null,
      attempt: 0,
      data: {
        verificationAttempt: 0,
        status: verification.status,
        verifyPath: 'evidence/attempt-0/verify.json',
      },
    });
    let repairIterations = 0;
    let verificationAttempt = 0;
    const previousRepairErrors: string[] = [];
    while (
      verification.status === 'failed' &&
      repairIterations < config.limits.maxRepairIterations
    ) {
      const target = selectRepairTarget(verification);
      if (!target) break;
      repairIterations += 1;
      if ((status.state as RunState) === 'verifying') transitionRun(status, 'repairing');
      writeRunStatus(runRoot, status);
      const requestId = `repair_${repairIterations}`;
      events.append({
        type: 'repair.started',
        role: 'repair',
        attempt: repairIterations,
        data: {
          owner: target.owner,
          requestId,
          checkIds: target.failures.map(({ id }) => id),
        },
      });
      const current = target.owner === 'logic'
        ? currentLogic
        : target.owner === 'level'
          ? currentLevel
          : currentArt;
      const evidenceRoot = path.join(
        runRoot,
        'evidence',
        `attempt-${repairIterations}`,
      );
      const beforeRoot = path.join(evidenceRoot, 'before');
      const afterRoot = path.join(evidenceRoot, 'after');
      mkdirSync(beforeRoot, { recursive: true });
      mkdirSync(afterRoot, { recursive: true });
      writeFileSync(path.join(beforeRoot, `${target.owner}.json`), stableJson(current));
      try {
        const repair = await runRepairWorker({
          owner: target.owner,
          iteration: repairIterations,
          spec,
          current,
          failures: target.failures,
          logExcerpt: relevantLogs(runRoot, target.failures),
          model: config.models.repair,
          systemPrompt: prompt('repair'),
          client,
          signal,
          previousRepairErrors,
        });
        status.requestCount = Math.max(status.requestCount + 1, budget.count);
        const repairRoot = path.join(
          runRoot,
          'workers',
          'repair',
          `attempt-${repairIterations}`,
        );
        mkdirSync(repairRoot, { recursive: true });
        writeFileSync(path.join(repairRoot, 'output.json'), stableJson(repair.result.content));
        writeFileSync(
          path.join(runRoot, 'requests', `${requestId}.json`),
          stableJson({
            request: repair.request,
            contextSha256: repair.contextSha256,
            response: repair.result,
          }),
        );
        writeFileSync(
          path.join(afterRoot, `${target.owner}.json`),
          stableJson(repair.replacement),
        );
        writeFileSync(
          path.join(evidenceRoot, 'change.diff'),
          replacementDiff(current, repair.replacement),
        );
        if (target.owner === 'logic') currentLogic = repair.replacement as LogicOutput;
        if (target.owner === 'level') currentLevel = repair.replacement as LevelOutput;
        if (target.owner === 'art') currentArt = repair.replacement as ArtOutput;
        transitionRun(status, 'integrating');
        writeRunStatus(runRoot, status);
        integrateArtifacts({
          runRoot,
          spec,
          logic: currentLogic,
          level: currentLevel,
          art: currentArt,
        });
        events.append({
          type: 'repair.completed',
          role: 'repair',
          attempt: repairIterations,
          data: {
            owner: target.owner,
            requestId,
            artifactPath: `evidence/attempt-${repairIterations}/after/${target.owner}.json`,
          },
        });
        transitionRun(status, 'verifying');
        writeRunStatus(runRoot, status);
        events.append({
          type: 'verify.started',
          role: null,
          attempt: repairIterations,
          data: { verificationAttempt: repairIterations },
        });
        verification = await verifier(options.runId, repairIterations);
        verificationAttempt = repairIterations;
        events.append({
          type: 'verify.completed',
          role: null,
          attempt: repairIterations,
          data: {
            verificationAttempt: repairIterations,
            status: verification.status,
            verifyPath: `evidence/attempt-${repairIterations}/verify.json`,
          },
        });
      } catch (error) {
        status.requestCount = Math.max(status.requestCount + 1, budget.count);
        if (!(error instanceof RepairRejectedError)) throw error;
        previousRepairErrors.push(error.message);
        const repairRoot = path.join(
          runRoot,
          'workers',
          'repair',
          `attempt-${repairIterations}`,
        );
        mkdirSync(repairRoot, { recursive: true });
        writeFileSync(path.join(repairRoot, 'output.json'), stableJson(error.result.content));
        writeFileSync(
          path.join(runRoot, 'requests', `${requestId}.json`),
          stableJson({ request: error.request, response: error.result }),
        );
        writeFileSync(path.join(afterRoot, 'rejected.json'), stableJson(error.result.content));
        events.append({
          type: 'artifact.rejected',
          role: 'repair',
          attempt: repairIterations,
          data: { artifact: target.owner, errors: [error.message] },
        });
      }
    }

    if (verification.status === 'passed') {
      transitionRun(status, 'verified');
      events.append({
        type: 'run.verified',
        role: null,
        attempt: null,
        data: {
          reportPath: 'report.html',
          buildPath: 'build',
        },
      });
    } else {
      if ((status.state as RunState) === 'repairing') transitionRun(status, 'stopped');
      else if ((status.state as RunState) === 'verifying') transitionRun(status, 'stopped');
      status.reasonCode = selectRepairTarget(verification)
        ? 'REPAIR_LIMIT'
        : 'UNREPAIRABLE_FAILURE';
      status.message = status.reasonCode === 'REPAIR_LIMIT'
        ? 'Three repair iterations were exhausted.'
        : 'Verification contains a blocking or unowned failure.';
      events.append({
        type: 'run.stopped',
        role: null,
        attempt: null,
        data: {
          reasonCode: status.reasonCode,
          message: status.message,
          reportPath: 'report.html',
        },
      });
    }
    status.activeElapsedMs += Math.round(performance.now() - started);
    writeRunStatus(runRoot, status);
    generateExecutionReport(runRoot);
    return verification;
  } catch (error) {
    if (status.state !== 'stopped' && status.state !== 'verified') {
      transitionRun(status, 'stopped');
      status.reasonCode = error instanceof Error && 'code' in error
        ? String(error.code)
        : 'GENERATION_FAILED';
      status.message = boundedMessage(error);
      status.activeElapsedMs += Math.round(performance.now() - started);
      writeRunStatus(runRoot, status);
      events.append({
        type: 'run.stopped',
        role: null,
        attempt: null,
        data: { reasonCode: status.reasonCode, message: status.message, reportPath: 'report.html' },
      });
      generateExecutionReport(runRoot);
    }
    throw error;
  } finally {
    if (lock !== undefined) closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}
function boundedMessage(value: unknown, maximum = 2_000): string {
  const message = value instanceof Error ? value.message : String(value);
  return (message.trim() || 'Unknown failure.').slice(0, maximum);
}
