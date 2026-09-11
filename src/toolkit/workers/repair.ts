import {
  ArtRepairOutputSchema,
  LevelRepairOutputSchema,
  LogicRepairOutputSchema,
  getValidationErrors,
  validateArtRepairOutput,
  validateLevelRepairOutput,
  validateLogicRepairOutput,
  type ArtOutput,
  type CheckResult,
  type GameSpec,
  type LevelOutput,
  type LogicOutput,
  type RepairOutput,
} from '../../contracts/index';
import type { ModelClient, ModelRequest, ModelResult } from '../openrouter';
import { validateArtArtifact, validateLevelArtifact, validateLogicArtifact } from '../validate';
import { normalizeLogicOutput } from './logic';
import { logicContext } from '../context';

export type RepairOwner = 'logic' | 'level' | 'art';
export type OwnerArtifact = LogicOutput | LevelOutput | ArtOutput;
export type RepairWorkerResult = {
  owner: RepairOwner;
  replacement: OwnerArtifact;
  diagnosis: string;
  request: ModelRequest;
  result: ModelResult;
  contextSha256: string;
};

export class RepairRejectedError extends Error {
  public constructor(
    message: string,
    public readonly request: ModelRequest,
    public readonly result: ModelResult,
  ) {
    super(message);
    this.name = 'RepairRejectedError';
  }
}

function schemaFor(owner: RepairOwner) {
  return owner === 'logic'
    ? LogicRepairOutputSchema
    : owner === 'level'
      ? LevelRepairOutputSchema
      : ArtRepairOutputSchema;
}

function validateEnvelope(owner: RepairOwner, value: unknown): value is RepairOutput<OwnerArtifact> {
  return owner === 'logic'
    ? validateLogicRepairOutput(value)
    : owner === 'level'
      ? validateLevelRepairOutput(value)
      : validateArtRepairOutput(value);
}

function envelopeErrors(owner: RepairOwner): string[] {
  const validator = owner === 'logic'
    ? validateLogicRepairOutput
    : owner === 'level'
      ? validateLevelRepairOutput
      : validateArtRepairOutput;
  return getValidationErrors(validator).map(
    ({ instancePath, keyword, message }) => `${instancePath || '/'} ${keyword}: ${message ?? 'invalid'}`,
  );
}

export async function runRepairWorker(options: {
  owner: RepairOwner;
  iteration: number;
  spec: GameSpec;
  current: OwnerArtifact;
  failures: CheckResult[];
  logExcerpt: string;
  model: string;
  systemPrompt: string;
  client: ModelClient;
  signal: AbortSignal;
  previousRepairErrors?: readonly string[];
}): Promise<RepairWorkerResult> {
  const validLogicExample = options.owner === 'logic'
    ? (JSON.parse(logicContext('', options.spec).user) as {
        completeValidExample: { source: string };
      }).completeValidExample.source
    : null;
  const user = JSON.stringify({
    task: `Diagnose the listed ${options.owner} failures and return one complete replacement.`,
    owner: options.owner,
    approvedSpec: {
      seed: options.spec.seed,
      enemies: options.spec.enemies,
      collectibles: options.spec.collectibles,
      objective: options.spec.objective,
      arena: options.spec.arena,
      palette: options.spec.theme.palette,
    },
    ownerContract: options.owner === 'logic'
      ? {
          exactImport: "import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';",
          exactExports: [
            'getEnemyVelocity(context: EnemyContext): Vec2',
            'isVictory(context: VictoryContext): boolean',
          ],
          victoryContextFields: [
            'context.mode',
            'context.score',
            'context.target',
            'context.atExit',
            'context.elapsedTicks',
            'context.survivalTicks',
          ],
          victoryRules: {
            'collect-all': 'context.score >= context.target',
            'collect-then-exit': 'context.score >= context.target && context.atExit',
            'survive-then-exit': 'context.elapsedTicks >= context.survivalTicks && context.atExit',
          },
          completeValidModule: validLogicExample,
          instruction: 'Use the complete valid module as the syntax pattern. Preserve valid enemy behavior. Do not add helpers, switch statements, destructuring, comments, or undeclared fields. Return exactly the import and two exported functions.',
        }
      : null,
    currentArtifact: options.current,
    failures: options.failures.slice(0, 3).map(
      ({ id, message, expected, actual }) => ({ id, message, expected, actual }),
    ),
    logExcerpt: options.logExcerpt.slice(0, 8_000),
    previousRepairErrors: options.previousRepairErrors ?? [],
  });
  if (Buffer.byteLength(options.systemPrompt) + Buffer.byteLength(user) > 24_000) {
    throw new Error('CONTEXT_LIMIT: repair packet exceeds 24000 bytes.');
  }
  const request: ModelRequest = {
    requestId: `repair_${options.iteration}`,
    role: 'repair',
    model: options.model,
    system: options.systemPrompt,
    user,
    schemaName: `${options.owner}_repair_output`,
    schema: schemaFor(options.owner),
    maxOutputTokens: 4_096,
  };
  const result = await options.client.generate(request, options.signal);
  if (!validateEnvelope(options.owner, result.content)) {
    throw new RepairRejectedError(
      `Repair envelope is invalid: ${envelopeErrors(options.owner).join('; ')}`,
      request,
      result,
    );
  }
  const output = options.owner === 'logic'
    ? normalizeLogicOutput(result.content.output) as OwnerArtifact
    : result.content.output;
  const semanticIssues = options.owner === 'logic'
    ? validateLogicArtifact(output)
    : options.owner === 'level'
      ? validateLevelArtifact(options.spec, output)
      : validateArtArtifact(output);
  if (semanticIssues.length) {
    throw new RepairRejectedError(
      `Repair replacement is invalid: ${semanticIssues.map(({ code, message }) => `${code}: ${message}`).join('; ')}`,
      request,
      result,
    );
  }
  const { createHash } = await import('node:crypto');
  return {
    owner: options.owner,
    replacement: output,
    diagnosis: result.content.diagnosis,
    request,
    result,
    contextSha256: createHash('sha256')
      .update(options.systemPrompt)
      .update('\0')
      .update(user)
      .digest('hex'),
  };
}
