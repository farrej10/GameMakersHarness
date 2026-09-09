# Contracts and file layout

This document is the interface authority for T01. Implement these definitions in `src/contracts/index.ts` using TypeBox, then derive TypeScript types and JSON Schema from the same declarations. Reject extra object properties. All fields are required unless explicitly described as nullable; never silently coerce values or add defaults during validation. Defaults belong in the spec-generation instruction.

## 1. Repository layout to create

```text
src/
  contracts/index.ts
  runtime/{state,step,geometry,input}.ts
  game/{main,GameScene,debug}.ts
  game/styles.css
  toolkit/
    cli.ts
    config.ts
    openrouter.ts
    context.ts
    workers/{spec,logic,level,art,repair}.ts
    orchestrator.ts
    integrate.ts
    validate.ts
    render-pixels.ts
    events.ts
    report.ts
    serve.ts
  generated.d.ts                      # virtual/aliased generated-module declarations
prompts/{spec,logic,level,art,repair}.md
scripts/{verify,doctor}.ts
tests/
  unit/
  integration/
  browser/
  fixtures/{reference,scenarios,responses}/
examples/{greenhouse,moon}.txt
docs/
runs/                                 # ignored; explicitly curated evidence goes under evidence/
evidence/                             # selected real logs, diffs, screenshots, report
index.html
package.json
package-lock.json
tsconfig.json
vite.config.ts
vitest.config.ts
playwright.config.ts
.env.example
.gitignore
```

One selected run per process. CLI accepts a run ID, not an arbitrary filesystem path. Run ID is `YYYYMMDDTHHMMSSZ-` plus eight lowercase hexadecimal random characters. Reject IDs not matching this format. Resolve paths inside the configured runs directory and reject symlinks or traversal in worker-controlled paths.

## 2. GameSpec

Example with all required fields:

```json
{
  "schemaVersion": 1,
  "title": "Greenhouse Rescue",
  "description": "Collect the batteries and return to the charging dock.",
  "seed": 42,
  "theme": {
    "playerName": "Maintenance robot",
    "collectibleName": "Battery",
    "enemyName": "Rogue sprinkler",
    "exitName": "Charging dock",
    "palette": ["#14231D", "#376B4B", "#88C070", "#F2C14E"]
  },
  "arena": { "width": 800, "height": 600 },
  "player": { "speed": 180, "health": 3 },
  "collectibles": { "count": 6 },
  "enemies": { "count": 2, "speed": 60, "behavior": "chase" },
  "objective": { "mode": "collect-then-exit" },
  "adaptations": []
}
```

Constraints:

- `schemaVersion` constant 1; `arena` constants 800 and 600.
- `title`: 1-60 characters; `description`: 1-240; entity names: 1-40.
- `seed`: integer 0 through 2,147,483,647. CLI supplies 42 unless `--seed` is set; the model must echo that seed.
- `palette`: exactly four distinct strings matching `^#[0-9A-Fa-f]{6}$`. Index 0 is background; indices 1-3 are sprite colors. Transparency is a separate pixel symbol.
- Numeric bounds and enums are defined in SPEC section 5 and section 2.
- `adaptations`: zero to eight strings, each 1-200 characters.
- Controls, dimensions, radii, cooldown, simulation rate, and acceptance IDs are deterministic constants, not model-editable spec fields.

Approval is `{schemaVersion: 1, specSha256: string, approvedAt: string}`. SHA-256 is a 64-character lowercase hex string; time is ISO 8601 UTC. Hash the validated file bytes, not a reconstructed object. Generation checks this again before any worker requests.

## 3. AssetManifest and ArtOutput

The orchestrator derives `asset-manifest.json` from approved spec. Do not make a separate model invent paths or dimensions.

```json
{
  "schemaVersion": 1,
  "assets": [
    { "id": "player", "path": "assets/player.png", "width": 64, "height": 64 },
    { "id": "collectible", "path": "assets/collectible.png", "width": 64, "height": 64 },
    { "id": "enemy", "path": "assets/enemy.png", "width": 64, "height": 64 },
    { "id": "exit", "path": "assets/exit.png", "width": 64, "height": 64 }
  ]
}
```

Art output:

```ts
type ArtOutput = {
  schemaVersion: 1;
  sprites: Array<{
    id: 'player' | 'collectible' | 'enemy' | 'exit';
    rows: string[];
  }>;
};
```

Live image art contains exactly four sprites, one per ID, as base64-encoded PNG payloads normalized by trusted code to 64 by 64 RGBA pixels. Each PNG must decode, contain visible pixels, and retain transparent breathing room. The legacy 16 by 16 `.123` grid remains contract-valid only for deterministic fixtures and fallback; trusted rendering expands each grid cell to a 4 by 4 block in a 64 by 64 PNG. External URLs and arbitrary SVG are forbidden.

If art generation or validation fails after its permitted correction attempt, emit four distinct deterministic placeholder shapes using the same palette and manifest. Record `artSource: "fallback"`; retain the failure. A provider authentication or budget failure stops the run and must not be hidden by fallback.

## 4. LevelOutput

```ts
type Point = { x: number; y: number };
type LevelOutput = {
  schemaVersion: 1;
  seed: number;
  playerSpawn: Point;
  exit: Point;
  collectibles: Array<{ id: string; x: number; y: number }>;
  enemies: Array<{ id: string; x: number; y: number }>;
};
```

- Coordinates are integer pixel centers. All centers have x in [40, 760] and y in [40, 560].
- Collectible IDs are exactly `c1` through `cN`; enemy IDs exactly `e1` through `eN`, in ascending order. Counts equal approved spec.
- Echo approved seed. No additional random choices after this file is generated. A seed makes saved playback deterministic; it does not guarantee an API model regenerates identical output.
- Distances between any two initial entity centers must be at least 48 pixels, except the additional enemy/player requirement below.
- Enemy centers must be at least 180 pixels from player spawn.
- Player spawn and exit must be at least 160 pixels apart.
- Collectibles must occupy at least three arena quadrants: use x < 400 vs x >= 400 and y < 300 vs y >= 300.
- There are no internal obstacles; geometric reachability is guaranteed by the open arena, not by a claimed pathfinding test.
- Semantic validation reports all failures with JSON pointers and expected/actual values. Do not silently relocate model-generated entities.

## 5. Generated logic module

The logic response is `{ "schemaVersion": 1, "source": "<complete TypeScript module>" }`. Source limit is 8,000 characters. Output exactly the two exports below; the only allowed import is the shown type-only import. The orchestrator writes the source to `integration/generated/rules.ts` and writes the matching trusted type declarations to `integration/generated/rule-types.ts`.

```ts
import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';

export function getEnemyVelocity(context: EnemyContext): Vec2 {
  // Worker implementation.
}

export function isVictory(context: VictoryContext): boolean {
  // Worker implementation.
}
```

Exact trusted declarations:

```ts
export type Vec2 = Readonly<{ x: number; y: number }>;
export type EnemyContext = Readonly<{
  behavior: 'chase' | 'horizontal-patrol';
  enemy: Readonly<{ x: number; y: number; vx: number; vy: number }>;
  player: Vec2;
  speed: number;
  bounds: Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;
}>;
export type VictoryContext = Readonly<{
  mode: 'collect-all' | 'collect-then-exit';
  score: number;
  target: number;
  atExit: boolean;
}>;
```

Both functions implement both enum modes, even if the current spec uses only one. This keeps the evaluator stable and makes reuse predictable.

- Chase: velocity points from enemy to player, with magnitude `speed`. Coincident positions return zero velocity. Compute Euclidean length; do not multiply both axis signs by speed.
- Horizontal patrol: y velocity zero; initially move right if previous x velocity is zero. At or beyond maxX move left; at or below minX move right. Otherwise retain previous x direction. Magnitude is speed. Runtime clamps position after integration.
- Victory: score >= target; additionally require atExit for `collect-then-exit`.
- No I/O, timers, randomness, mutation of arguments, imports of runtime values, classes, top-level side effects, or additional exports. Keep the implementation small and synchronous.
- Tests of generated executable behavior run in Chromium, not by importing generated source into the credential-bearing Node process. Source restrictions are contract controls, not a general JavaScript security sandbox.

## 6. Runtime snapshot and debug interface

```ts
type GameSnapshot = {
  state: 'ready' | 'playing' | 'won' | 'lost';
  tick: number;
  score: number;
  player: { x: number; y: number; health: number; nextDamageTick: number };
  enemies: Array<{ id: string; x: number; y: number; vx: number; vy: number }>;
  collectibles: Array<{ id: string; x: number; y: number }>;
  exit: { x: number; y: number };
  input: { up: boolean; down: boolean; left: boolean; right: boolean };
  errors: string[];
};

type GameDebug = {
  snapshot(): GameSnapshot;
  loadScenario(id: 'movement' | 'collection' | 'damage' | 'win' | 'loss' | 'tie'): void;
  advanceTicks(count: number): void;
};
```

Snapshots are deep copies, not mutable runtime references. `loadScenario` selects trusted fixed data; no arbitrary object setter. `advanceTicks` requires an integer from 1 to 600 and advances the same runtime step as real-time play, using current keyboard state.

Enable hooks only for Vite mode `test` or development. Manual stepping requires test mode AND the explicit `?clock=manual` URL parameter. Production must not expose `window.gameDebug`, and a query string alone must never enable it. The fixture loader must be excluded from production execution by the build-mode branch.

## 7. Worker and repair response

Use a role-specific strict response schema for initial spec, level, art, and logic outputs. Do not use a generic model-controlled file list.

Repair is routed to one owning role and uses that role's output schema with this envelope:

```ts
type RepairOutput<T> = {
  schemaVersion: 1;
  diagnosis: string; // 1-600 characters, concise observable explanation
  output: T;        // complete replacement for exactly one owning artifact
};
```

The orchestrator chooses the owner and destination. The model cannot choose a path, a shell command, tests to remove, or a different approval policy. A diagnosis is a brief work summary, not a request for private chain-of-thought.

## 8. Verification result

```ts
type CheckResult = {
  id: string;
  stage: 'contracts' | 'protected' | 'types' | 'unit' | 'build' | 'assets' | 'browser' | 'production';
  status: 'passed' | 'failed' | 'skipped';
  owner: 'logic' | 'level' | 'art' | 'runtime' | 'harness' | 'infrastructure';
  message: string;
  expected: string | null;
  actual: string | null;
  artifactPaths: string[];
};
type VerifyResult = {
  schemaVersion: 1;
  runId: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  status: 'passed' | 'failed';
  checks: CheckResult[];
};
```

Paths in reports are relative to the run root. A required skipped check means overall failure. Return nonzero process exit status on failure even if the report was written successfully. Fixture verification uses literal run ID `reference` internally; it is not accepted as a generated run-directory ID.

## 9. Events and run artifacts

Every event: `schemaVersion`, monotonically increasing `sequence`, `runId`, ISO UTC `at`, `type`, `role` (nullable), `attempt` (nullable integer), `data` (type-specific validated object). Only the orchestrator writes the append-only events stream; workers return data to it. Reject unknown event types in the report reader.

Required event types: `run.created`, `spec.proposed`, `spec.approved`, `worker.started`, `worker.completed`, `worker.failed`, `request.retry`, `artifact.rejected`, `art.fallback`, `integration.completed`, `verify.started`, `verify.completed`, `repair.started`, `repair.completed`, `run.verified`, `run.stopped`.

```text
runs/<run-id>/
  prompt.txt
  game-spec.json
  approval.json
  asset-manifest.json
  config.json                         # effective limits/models; no secrets
  status.json                         # atomic snapshot derived from orchestration state
  events.jsonl
  requests/<request-id>.json          # context, schema and response; never auth headers
  workers/{logic,level,art}/attempt-<n>/output.json
  integration/generated/{rules,rule-types}.ts
  integration/generated/{game-spec,level}.json
  integration/public/assets/*.png
  evidence/protected-baseline.json
  evidence/attempt-0/                 # initial verification
  evidence/attempt-1/                 # first gameplay repair, etc.
    verify.json
    logs/*.txt
    screenshots/*.png
    traces/*.zip
    before/                          # changed artifact before repair
    after/                           # changed artifact after repair
    change.diff
  build-test/
  build/
  report.json
  report.html
```

Integration changes only the selected run's integration directory. Preserve previous worker outputs and verification evidence. Verification always cleans or replaces its own build output so stale files cannot satisfy checks. Use run-local temporary output and rename after success; do not export an earlier passing build as the current failed result.
