import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Approval, GameSpec, RunState } from '../contracts/index';
import {
  getValidationErrors,
  validateApproval,
  validateGameSpec,
} from '../contracts/index';
import { loadToolkitConfig, publicConfig, type ToolkitConfig } from './config';
import { EventWriter } from './events';
import {
  OpenRouterClient,
  RequestBudget,
  type ModelClient,
} from './openrouter';
import { runSpecWorker } from './workers/spec';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const encoder = new TextEncoder();
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u;

export type RunStatus = {
  schemaVersion: 1;
  runId: string;
  state: RunState;
  requestCount: number;
  activeElapsedMs: number;
  reasonCode: string | null;
  message: string | null;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function atomicJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, stableJson(value), 'utf8');
  renameSync(temporary, filePath);
}

function runId(now = new Date(), entropy: Uint8Array = randomBytes(4)): string {
  const timestamp = now.toISOString().replaceAll(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `${timestamp}-${Buffer.from(entropy).toString('hex')}`;
}

export function safeRunRoot(runsRoot: string, id: string): string {
  if (!RUN_ID.test(id)) throw new Error(`Invalid run ID: ${id}`);
  const root = path.resolve(runsRoot);
  const selected = path.resolve(root, id);
  const relative = path.relative(root, selected);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Run path escapes runs directory.');
  return selected;
}

export function writeRunStatus(runRoot: string, status: RunStatus): void {
  atomicJson(path.join(runRoot, 'status.json'), status);
}

export function readRunStatus(runRoot: string): RunStatus {
  return JSON.parse(readFileSync(path.join(runRoot, 'status.json'), 'utf8')) as RunStatus;
}

function assertPrompt(prompt: string): void {
  const bytes = encoder.encode(prompt.trim()).length;
  if (bytes < 1 || bytes > 4_000) {
    throw new Error('Game description must contain 1 through 4000 UTF-8 bytes.');
  }
}

export async function proposeSpecRun(options: {
  prompt: string;
  seed?: number;
  config: ToolkitConfig;
  client: ModelClient;
  budget?: RequestBudget;
  runsRoot?: string;
  now?: () => Date;
  entropy?: Uint8Array;
  signal?: AbortSignal;
}): Promise<{ runId: string; runRoot: string; spec: GameSpec; hash: string }> {
  assertPrompt(options.prompt);
  const seed = options.seed ?? 42;
  if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) {
    throw new Error('Seed must be an integer from 0 through 2147483647.');
  }
  const now = options.now ?? (() => new Date());
  const id = runId(now(), options.entropy);
  const runsRoot = options.runsRoot ?? path.join(projectRoot, 'runs');
  mkdirSync(runsRoot, { recursive: true });
  const runRoot = safeRunRoot(runsRoot, id);
  mkdirSync(runRoot, { recursive: false });
  mkdirSync(path.join(runRoot, 'workers', 'spec', 'attempt-0'), { recursive: true });
  mkdirSync(path.join(runRoot, 'requests'), { recursive: true });
  writeFileSync(path.join(runRoot, 'prompt.txt'), options.prompt, 'utf8');
  atomicJson(path.join(runRoot, 'config.json'), publicConfig(options.config));
  const status: RunStatus = {
    schemaVersion: 1,
    runId: id,
    state: 'draft',
    requestCount: options.budget?.count ?? 0,
    activeElapsedMs: 0,
    reasonCode: null,
    message: null,
  };
  writeRunStatus(runRoot, status);
  const events = new EventWriter(id, path.join(runRoot, 'events.jsonl'), now);
  events.append({
    type: 'run.created',
    role: null,
    attempt: null,
    data: { promptPath: 'prompt.txt', configPath: 'config.json' },
  });
  const started = performance.now();
  let calls = 0;
  const countingClient: ModelClient = {
    generate: async (request, signal) => {
      calls += 1;
      events.append({
        type: 'worker.started',
        role: 'spec',
        attempt: calls - 1,
        data: { requestId: request.requestId },
      });
      const result = await options.client.generate(request, signal);
      atomicJson(path.join(runRoot, 'requests', `${request.requestId}.json`), {
        request: { ...request, schema: request.schema },
        result,
      });
      return result;
    },
  };

  try {
    const systemPrompt = readFileSync(path.join(projectRoot, 'prompts', 'spec.md'), 'utf8');
    const result = await runSpecWorker({
      prompt: options.prompt,
      seed,
      model: options.config.models.spec,
      systemPrompt,
      client: countingClient,
      signal: options.signal ?? new AbortController().signal,
    });
    result.rejected.forEach((errors, index) =>
      events.append({
        type: 'artifact.rejected',
        role: 'spec',
        attempt: index,
        data: { artifact: 'game-spec.json', errors },
      }),
    );
    const specText = stableJson(result.spec);
    const specPath = path.join(runRoot, 'game-spec.json');
    writeFileSync(specPath, specText, 'utf8');
    atomicJson(
      path.join(runRoot, 'workers', 'spec', 'attempt-0', 'output.json'),
      result.spec,
    );
    const hash = sha256(specText);
    events.append({
      type: 'worker.completed',
      role: 'spec',
      attempt: result.requests.length - 1,
      data: { requestId: result.requests.at(-1)!.request.requestId, artifactPath: 'game-spec.json' },
    });
    events.append({
      type: 'spec.proposed',
      role: 'spec',
      attempt: null,
      data: { specPath: 'game-spec.json', specSha256: hash },
    });
    status.state = 'awaiting-approval';
    status.requestCount = Math.max(calls, options.budget?.count ?? 0);
    status.activeElapsedMs += Math.round(performance.now() - started);
    writeRunStatus(runRoot, status);
    return { runId: id, runRoot, spec: result.spec, hash };
  } catch (error) {
    status.state = 'stopped';
    status.requestCount = Math.max(calls, options.budget?.count ?? 0);
    status.activeElapsedMs += Math.round(performance.now() - started);
    status.reasonCode = error instanceof Error && 'code' in error ? String(error.code) : 'SPEC_FAILED';
    status.message = error instanceof Error ? error.message : String(error);
    writeRunStatus(runRoot, status);
    events.append({
      type: 'run.stopped',
      role: null,
      attempt: null,
      data: { reasonCode: status.reasonCode, message: status.message, reportPath: null },
    });
    throw error;
  }
}

export function approveSpecRun(options: {
  runId: string;
  hash: string;
  runsRoot?: string;
  now?: () => Date;
}): Approval {
  const runsRoot = options.runsRoot ?? path.join(projectRoot, 'runs');
  const runRoot = safeRunRoot(runsRoot, options.runId);
  const status = readRunStatus(runRoot);
  if (status.state !== 'awaiting-approval') throw new Error(`Run is ${status.state}; approval is not allowed.`);
  const specBytes = readFileSync(path.join(runRoot, 'game-spec.json'));
  const specValue: unknown = JSON.parse(specBytes.toString('utf8'));
  if (!validateGameSpec(specValue)) {
    throw new Error(`Current spec is invalid: ${JSON.stringify(getValidationErrors(validateGameSpec))}`);
  }
  const actualHash = sha256(specBytes);
  if (actualHash !== options.hash) throw new Error(`Spec hash mismatch. Current hash: ${actualHash}`);
  const approval: Approval = {
    schemaVersion: 1,
    specSha256: actualHash,
    approvedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  if (!validateApproval(approval)) throw new Error('Internal approval record is invalid.');
  atomicJson(path.join(runRoot, 'approval.json'), approval);
  new EventWriter(
    options.runId,
    path.join(runRoot, 'events.jsonl'),
    options.now,
  ).append({
    type: 'spec.approved',
    role: null,
    attempt: null,
    data: { specSha256: actualHash },
  });
  return approval;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'spec') {
    const promptFile = argument('--prompt-file');
    if (!promptFile) throw new Error('Usage: game:spec -- --prompt-file <file> [--seed <integer>]');
    const prompt = readFileSync(path.resolve(promptFile), 'utf8');
    assertPrompt(prompt);
    const config = loadToolkitConfig({ cwd: projectRoot });
    const budget = new RequestBudget(
      config.limits.maxRequests,
      Date.now() + config.limits.activeBudgetMs,
    );
    const client = new OpenRouterClient({
      apiKey: config.apiKey,
      budget,
      requestTimeoutMs: config.limits.requestTimeoutMs,
      contextLimitBytes: config.limits.contextBytes,
      schemaLimitBytes: config.limits.schemaBytes,
    });
    const result = await proposeSpecRun({
      prompt,
      seed: argument('--seed') === undefined ? 42 : Number(argument('--seed')),
      config,
      client,
      budget,
    });
    process.stdout.write(
      `Run: ${result.runId}\nTitle: ${result.spec.title}\nObjective: ${result.spec.description}\nAdaptations: ${
        result.spec.adaptations.length ? result.spec.adaptations.join('; ') : 'none'
      }\nSpec SHA-256: ${result.hash}\nApprove with: npm.cmd run game:approve -- --run ${result.runId} --hash ${result.hash}\n`,
    );
    return;
  }
  if (command === 'approve') {
    const id = argument('--run');
    const hash = argument('--hash');
    if (!id || !hash) throw new Error('Usage: game:approve -- --run <run-id> --hash <hash>');
    approveSpecRun({ runId: id, hash });
    process.stdout.write(`Approved ${id} at spec hash ${hash}.\n`);
    return;
  }
  if (command === 'generate') {
    const id = argument('--run');
    if (!id) throw new Error('Usage: game:generate -- --run <run-id>');
    const { generateRun } = await import('./orchestrator');
    const verification = await generateRun({ runId: id });
    process.stdout.write(`Run ${id}: ${verification.status}.\n`);
    process.exitCode = verification.status === 'passed' ? 0 : 1;
    return;
  }
  throw new Error('Expected command: spec, approve, or generate.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
