import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { type Static, Type, type TSchema } from '@sinclair/typebox';

const closedObject = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

const NonEmptyText = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength });
const NullableText = Type.Union([Type.String(), Type.Null()]);
const RelativeArtifactPath = Type.String({ minLength: 1, maxLength: 500 });
const IsoUtcTime = Type.String({
  pattern:
    '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$',
});

export const GENERATED_RUN_ID_PATTERN =
  '^\\d{8}T\\d{6}Z-[0-9a-f]{8}$';
export const GeneratedRunIdSchema = Type.String({
  pattern: GENERATED_RUN_ID_PATTERN,
});
export const VerificationRunIdSchema = Type.Union([
  Type.Literal('reference'),
  GeneratedRunIdSchema,
]);

export const EnemyBehaviorSchema = Type.Union([
  Type.Literal('chase'),
  Type.Literal('horizontal-patrol'),
]);
export const ObjectiveModeSchema = Type.Union([
  Type.Literal('collect-all'),
  Type.Literal('collect-then-exit'),
]);
export const AssetIdSchema = Type.Union([
  Type.Literal('player'),
  Type.Literal('collectible'),
  Type.Literal('enemy'),
  Type.Literal('exit'),
]);

const HexColorSchema = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });

export const GameSpecSchema = closedObject({
  schemaVersion: Type.Literal(1),
  title: NonEmptyText(60),
  description: NonEmptyText(240),
  seed: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  theme: closedObject({
    playerName: NonEmptyText(40),
    collectibleName: NonEmptyText(40),
    enemyName: NonEmptyText(40),
    exitName: NonEmptyText(40),
    palette: Type.Array(HexColorSchema, {
      minItems: 4,
      maxItems: 4,
      uniqueItems: true,
    }),
  }),
  arena: closedObject({
    width: Type.Literal(800),
    height: Type.Literal(600),
  }),
  player: closedObject({
    speed: Type.Number({ minimum: 140, maximum: 220 }),
    health: Type.Integer({ minimum: 2, maximum: 5 }),
  }),
  collectibles: closedObject({
    count: Type.Integer({ minimum: 3, maximum: 10 }),
  }),
  enemies: closedObject({
    count: Type.Integer({ minimum: 1, maximum: 4 }),
    speed: Type.Number({ minimum: 40, maximum: 100 }),
    behavior: EnemyBehaviorSchema,
  }),
  objective: closedObject({ mode: ObjectiveModeSchema }),
  adaptations: Type.Array(NonEmptyText(200), {
    minItems: 0,
    maxItems: 8,
  }),
});
export type GameSpec = Static<typeof GameSpecSchema>;

export const ApprovalSchema = closedObject({
  schemaVersion: Type.Literal(1),
  specSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  approvedAt: IsoUtcTime,
});
export type Approval = Static<typeof ApprovalSchema>;

const AssetManifestItemSchema = <
  TId extends 'player' | 'collectible' | 'enemy' | 'exit',
  TPath extends string,
>(
  id: TId,
  assetPath: TPath,
) =>
  closedObject({
    id: Type.Literal(id),
    path: Type.Literal(assetPath),
    width: Type.Literal(32),
    height: Type.Literal(32),
  });

export const AssetManifestSchema = closedObject({
  schemaVersion: Type.Literal(1),
  assets: Type.Tuple([
    AssetManifestItemSchema('player', 'assets/player.png'),
    AssetManifestItemSchema('collectible', 'assets/collectible.png'),
    AssetManifestItemSchema('enemy', 'assets/enemy.png'),
    AssetManifestItemSchema('exit', 'assets/exit.png'),
  ]),
});
export type AssetManifest = Static<typeof AssetManifestSchema>;

export const SpriteGridSchema = closedObject({
  id: AssetIdSchema,
  rows: Type.Array(Type.String({ pattern: '^[.123]{16}$' }), {
    minItems: 16,
    maxItems: 16,
  }),
});
export const ArtOutputSchema = closedObject({
  schemaVersion: Type.Literal(1),
  sprites: Type.Array(SpriteGridSchema, { minItems: 4, maxItems: 4 }),
});
export type ArtOutput = Static<typeof ArtOutputSchema>;

export const PointSchema = closedObject({
  x: Type.Integer({ minimum: 40, maximum: 760 }),
  y: Type.Integer({ minimum: 40, maximum: 560 }),
});
const CollectiblePlacementSchema = closedObject({
  id: Type.String({ pattern: '^c[1-9][0-9]*$' }),
  x: Type.Integer({ minimum: 40, maximum: 760 }),
  y: Type.Integer({ minimum: 40, maximum: 560 }),
});
const EnemyPlacementSchema = closedObject({
  id: Type.String({ pattern: '^e[1-9][0-9]*$' }),
  x: Type.Integer({ minimum: 40, maximum: 760 }),
  y: Type.Integer({ minimum: 40, maximum: 560 }),
});
export const LevelOutputSchema = closedObject({
  schemaVersion: Type.Literal(1),
  seed: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  playerSpawn: PointSchema,
  exit: PointSchema,
  collectibles: Type.Array(CollectiblePlacementSchema, {
    minItems: 3,
    maxItems: 10,
  }),
  enemies: Type.Array(EnemyPlacementSchema, { minItems: 1, maxItems: 4 }),
});
export type Point = Static<typeof PointSchema>;
export type LevelOutput = Static<typeof LevelOutputSchema>;

export const LogicOutputSchema = closedObject({
  schemaVersion: Type.Literal(1),
  source: Type.String({ minLength: 1, maxLength: 8_000 }),
});
export type LogicOutput = Static<typeof LogicOutputSchema>;

export const createRepairOutputSchema = <T extends TSchema>(output: T) =>
  closedObject({
    schemaVersion: Type.Literal(1),
    diagnosis: NonEmptyText(600),
    output,
  });

export const LogicRepairOutputSchema = createRepairOutputSchema(LogicOutputSchema);
export const LevelRepairOutputSchema = createRepairOutputSchema(LevelOutputSchema);
export const ArtRepairOutputSchema = createRepairOutputSchema(ArtOutputSchema);
export type RepairOutput<T> = {
  schemaVersion: 1;
  diagnosis: string;
  output: T;
};

export type Vec2 = Readonly<{ x: number; y: number }>;
export type EnemyContext = Readonly<{
  behavior: 'chase' | 'horizontal-patrol';
  enemy: Readonly<{ x: number; y: number; vx: number; vy: number }>;
  player: Vec2;
  speed: number;
  bounds: Readonly<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }>;
}>;
export type VictoryContext = Readonly<{
  mode: 'collect-all' | 'collect-then-exit';
  score: number;
  target: number;
  atExit: boolean;
}>;
export type RuleFunctions = Readonly<{
  getEnemyVelocity(context: EnemyContext): Vec2;
  isVictory(context: VictoryContext): boolean;
}>;

export const InputStateSchema = closedObject({
  up: Type.Boolean(),
  down: Type.Boolean(),
  left: Type.Boolean(),
  right: Type.Boolean(),
});
export type InputState = Static<typeof InputStateSchema>;

export const GameSnapshotSchema = closedObject({
  state: Type.Union([
    Type.Literal('ready'),
    Type.Literal('playing'),
    Type.Literal('won'),
    Type.Literal('lost'),
  ]),
  tick: Type.Integer({ minimum: 0 }),
  score: Type.Integer({ minimum: 0 }),
  player: closedObject({
    x: Type.Number(),
    y: Type.Number(),
    health: Type.Integer({ minimum: 0 }),
    nextDamageTick: Type.Integer({ minimum: 0 }),
  }),
  enemies: Type.Array(
    closedObject({
      id: NonEmptyText(80),
      x: Type.Number(),
      y: Type.Number(),
      vx: Type.Number(),
      vy: Type.Number(),
    }),
  ),
  collectibles: Type.Array(
    closedObject({
      id: NonEmptyText(80),
      x: Type.Number(),
      y: Type.Number(),
    }),
  ),
  exit: closedObject({ x: Type.Number(), y: Type.Number() }),
  input: InputStateSchema,
  errors: Type.Array(Type.String()),
});
export type GameSnapshot = Static<typeof GameSnapshotSchema>;
export type ScenarioId =
  | 'movement'
  | 'collection'
  | 'damage'
  | 'win'
  | 'loss'
  | 'tie';
export type GameDebug = {
  snapshot(): GameSnapshot;
  loadScenario(id: ScenarioId): void;
  advanceTicks(count: number): void;
};

export const CheckStageSchema = Type.Union([
  Type.Literal('contracts'),
  Type.Literal('protected'),
  Type.Literal('types'),
  Type.Literal('unit'),
  Type.Literal('build'),
  Type.Literal('assets'),
  Type.Literal('browser'),
  Type.Literal('production'),
]);
export const CheckOwnerSchema = Type.Union([
  Type.Literal('logic'),
  Type.Literal('level'),
  Type.Literal('art'),
  Type.Literal('runtime'),
  Type.Literal('harness'),
  Type.Literal('infrastructure'),
]);
export const CheckResultSchema = closedObject({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  stage: CheckStageSchema,
  status: Type.Union([
    Type.Literal('passed'),
    Type.Literal('failed'),
    Type.Literal('skipped'),
  ]),
  owner: CheckOwnerSchema,
  message: Type.String({ maxLength: 2_000 }),
  expected: NullableText,
  actual: NullableText,
  artifactPaths: Type.Array(RelativeArtifactPath),
});
export type CheckResult = Static<typeof CheckResultSchema>;

export const VerifyResultSchema = closedObject({
  schemaVersion: Type.Literal(1),
  runId: VerificationRunIdSchema,
  attempt: Type.Integer({ minimum: 0 }),
  startedAt: IsoUtcTime,
  finishedAt: IsoUtcTime,
  status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]),
  checks: Type.Array(CheckResultSchema),
});
export type VerifyResult = Static<typeof VerifyResultSchema>;

export const WorkerRoleSchema = Type.Union([
  Type.Literal('spec'),
  Type.Literal('logic'),
  Type.Literal('level'),
  Type.Literal('art'),
  Type.Literal('repair'),
]);
export const RunStateSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('awaiting-approval'),
  Type.Literal('generating'),
  Type.Literal('integrating'),
  Type.Literal('verifying'),
  Type.Literal('repairing'),
  Type.Literal('verified'),
  Type.Literal('stopped'),
]);
export type RunState = Static<typeof RunStateSchema>;

const RequestIdSchema = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: '^[a-z0-9][a-z0-9_-]*$',
});
const RepairOwnerSchema = Type.Union([
  Type.Literal('logic'),
  Type.Literal('level'),
  Type.Literal('art'),
]);
const eventSchema = <TType extends string, TData extends TSchema>(
  type: TType,
  data: TData,
) =>
  closedObject({
    schemaVersion: Type.Literal(1),
    sequence: Type.Integer({ minimum: 1 }),
    runId: GeneratedRunIdSchema,
    at: IsoUtcTime,
    type: Type.Literal(type),
    role: Type.Union([WorkerRoleSchema, Type.Null()]),
    attempt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    data,
  });

export const RunEventSchema = Type.Union([
  eventSchema(
    'run.created',
    closedObject({
      promptPath: RelativeArtifactPath,
      configPath: RelativeArtifactPath,
    }),
  ),
  eventSchema(
    'spec.proposed',
    closedObject({
      specPath: RelativeArtifactPath,
      specSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    }),
  ),
  eventSchema(
    'spec.approved',
    closedObject({ specSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }) }),
  ),
  eventSchema('worker.started', closedObject({ requestId: RequestIdSchema })),
  eventSchema(
    'worker.completed',
    closedObject({
      requestId: RequestIdSchema,
      artifactPath: RelativeArtifactPath,
    }),
  ),
  eventSchema(
    'worker.failed',
    closedObject({
      requestId: RequestIdSchema,
      code: NonEmptyText(80),
      message: NonEmptyText(2_000),
    }),
  ),
  eventSchema(
    'request.retry',
    closedObject({
      requestId: RequestIdSchema,
      retryNumber: Type.Integer({ minimum: 1, maximum: 2 }),
      reason: NonEmptyText(500),
      delayMs: Type.Integer({ minimum: 0 }),
    }),
  ),
  eventSchema(
    'artifact.rejected',
    closedObject({
      artifact: NonEmptyText(80),
      errors: Type.Array(NonEmptyText(1_000), { minItems: 1 }),
    }),
  ),
  eventSchema('art.fallback', closedObject({ reason: NonEmptyText(1_000) })),
  eventSchema(
    'integration.completed',
    closedObject({ integrationPath: RelativeArtifactPath }),
  ),
  eventSchema(
    'verify.started',
    closedObject({ verificationAttempt: Type.Integer({ minimum: 0 }) }),
  ),
  eventSchema(
    'verify.completed',
    closedObject({
      verificationAttempt: Type.Integer({ minimum: 0 }),
      status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]),
      verifyPath: RelativeArtifactPath,
    }),
  ),
  eventSchema(
    'repair.started',
    closedObject({
      owner: RepairOwnerSchema,
      requestId: RequestIdSchema,
      checkIds: Type.Array(NonEmptyText(100), { minItems: 1, maxItems: 3 }),
    }),
  ),
  eventSchema(
    'repair.completed',
    closedObject({
      owner: RepairOwnerSchema,
      requestId: RequestIdSchema,
      artifactPath: RelativeArtifactPath,
    }),
  ),
  eventSchema(
    'run.verified',
    closedObject({
      reportPath: RelativeArtifactPath,
      buildPath: RelativeArtifactPath,
    }),
  ),
  eventSchema(
    'run.stopped',
    closedObject({
      reasonCode: NonEmptyText(80),
      message: NonEmptyText(2_000),
      reportPath: Type.Union([RelativeArtifactPath, Type.Null()]),
    }),
  ),
]);
export type RunEvent = Static<typeof RunEventSchema>;

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
});

export const validateGameSpec = ajv.compile<GameSpec>(GameSpecSchema);
export const validateApproval = ajv.compile<Approval>(ApprovalSchema);
export const validateAssetManifest =
  ajv.compile<AssetManifest>(AssetManifestSchema);
export const validateArtOutput = ajv.compile<ArtOutput>(ArtOutputSchema);
export const validateLevelOutput = ajv.compile<LevelOutput>(LevelOutputSchema);
export const validateLogicOutput = ajv.compile<LogicOutput>(LogicOutputSchema);
export const validateLogicRepairOutput = ajv.compile(
  LogicRepairOutputSchema,
);
export const validateLevelRepairOutput = ajv.compile(
  LevelRepairOutputSchema,
);
export const validateArtRepairOutput = ajv.compile(ArtRepairOutputSchema);
export const validateGameSnapshot = ajv.compile<GameSnapshot>(GameSnapshotSchema);
export const validateCheckResult = ajv.compile<CheckResult>(CheckResultSchema);
export const validateVerifyResult = ajv.compile<VerifyResult>(VerifyResultSchema);
export const validateRunEvent = ajv.compile<RunEvent>(RunEventSchema);

export type ContractValidationError = Pick<
  ErrorObject,
  'instancePath' | 'keyword' | 'message' | 'params' | 'schemaPath'
>;

export function getValidationErrors(
  validator: ValidateFunction,
): ContractValidationError[] {
  return (validator.errors ?? []).map(
    ({ instancePath, keyword, message, params, schemaPath }) => ({
      instancePath,
      keyword,
      message,
      params,
      schemaPath,
    }),
  );
}
