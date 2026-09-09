# Product specification

Status: implemented and live-evaluated as of 2026-09-09. Offline verification and two distinct credentialed OpenRouter runs pass; public deployment and final submission remain pending.

## 1. Objective and competition strategy

Convert a supported short description into one playable top-down collection/survival game. A human approves a structured specification; specialized model workers create bounded outputs; the toolkit integrates, tests, and repairs them without another human prompt during the repair loop.

The supplied hackathon brief assigns 25 points to agentic engineering, 25 to harness/autonomous loops, 20 to product quality, 10 to context engineering, 10 to innovation, and 5 each to reproducibility and demo. Prioritize a working game plus inspectable, genuine recovery evidence. Agent count is not an objective.

There are two different engineering processes:

1. Implementation models build this toolkit from the task cards.
2. The implemented toolkit calls OpenRouter workers to generate games.

Record evidence from both and identify which process each artifact demonstrates. A mocked OpenRouter response tests the toolkit but does not establish a live autonomous model repair.

## 2. Fixed product scope

| Item | Decision |
| --- | --- |
| Product interface | CLI, static HTML execution report, and loopback-only local control page |
| Game | One 800 by 600 logical-pixel arena, scaled to fit browser |
| Movement | WASD and arrow keys; normalized diagonal speed; player kept inside arena |
| Simulation | Pure TypeScript fixed-step simulation; Phaser renders and supplies input; no physics engine |
| Entities | One player, 3-10 collectibles, 1-4 enemies, one exit |
| Geometry | Circular collisions; no interior walls, projectiles, doors, navigation mesh, or procedural terrain |
| Enemy behavior | `chase` or `horizontal-patrol`; one behavior family per game |
| Victory | `collect-all` or `collect-then-exit` |
| Defeat | Health reaches zero |
| States | `ready`, `playing`, `won`, `lost` |
| Controls | Enter or Start button begins; R or Restart button restarts after win/loss |
| Art | Model designs a small pixel grid; deterministic renderer creates 32 by 32 PNGs |
| Audio | Excluded |
| Backend | Node using native fetch to OpenRouter; no model credentials in browser |
| Persistence | Files under an immutable run ID; no database or accounts |
| Concurrency | Up to three independent worker requests within one run; only one active build/verification process |
| Distribution | Static production build plus a report; local generation, public static playable example |

Omit countdown/power-drain mechanics even if thematic copy mentions batteries. The demo prompt must not promise a countdown. Unsupported mechanics must appear in the proposed spec's adaptations before approval.

## 3. Fixed runtime vs generated work

The trusted runtime owns input, time, movement integration, collision resolution, collection, damage cooldown, state transitions, restart, rendering, HUD, and test instrumentation.

The logic worker generates real TypeScript implementations of exactly two functions: enemy velocity selection and victory eligibility. The level worker supplies entity placement. The art worker supplies pixel designs. These are meaningful independent outputs with small interfaces.

The logic worker does not rewrite the engine. This deliberate reduction from the initial proposal makes tasks small enough for less capable models and keeps integration predictable. It still permits substantive failures such as unnormalized chase speed, reversed enemy direction, or victory before reaching the exit.

## 4. Gameplay semantics

1. On load, show a Start button, controls, objective, health, and score. Simulation does not advance in `ready`.
2. On Start, state becomes `playing` and elapsed ticks start at zero.
3. Run simulation at 60 ticks per second. Every simulation step receives exactly `1 / 60` seconds; do not use wall time inside rules.
4. Normalize the player's input vector when its length exceeds one. Multiply by player speed in pixels per second and by the fixed step duration.
5. Clamp entity centers to the arena using their collision radius. Player radius is 12, enemy radius 12, collectible radius 8, exit radius 20.
6. The logic module chooses each enemy velocity. Runtime rejects non-finite values as an error; it does not silently repair invalid policy output or normalize it for the worker.
7. Two circles overlap when squared center distance is less than or equal to the square of the sum of their radii.
8. Each overlapping uncollected collectible increases score by one and is removed exactly once.
9. Enemy contact removes one health when cooldown is inactive. Apply at most one damage event per tick even if several enemies overlap. Health cannot fall below zero.
10. Damage cooldown is exactly 60 simulation ticks. First contact at tick T can damage again at T+60. Use integer tick comparisons.
11. After movement and collisions: apply collection, then damage, then defeat, then check victory if still alive. Defeat wins a simultaneous lethal-contact/victory tie.
12. `collect-all`: victory when score reaches collectible count. `collect-then-exit`: victory when score reaches count AND the player overlaps the exit.
13. A won/lost game freezes simulation. Restart creates a fresh copy of the approved generated level, resets score, health, cooldown, tick count, and input, then returns to `ready`.
14. Rendering may animate independently, but animations must not change simulation state.
15. In real-time mode cap the accumulated frame delta at five ticks; discard excess backlog to prevent a large movement jump after tab suspension.

## 5. Supported input and approval

- Description length: 1-2,000 characters after trimming.
- The spec worker proposes supported mechanics and lists adaptations in plain language.
- Defaults: 6 collectibles, 3 health, player speed 180, 2 enemies, enemy speed 60, `chase`, `collect-then-exit`.
- Bounds: player speed 140-220; enemy speed 40-100; health integer 2-5; counts as above.
- A numeric request outside bounds must be explained in adaptations; do not silently clamp it.
- Users may edit the proposed JSON locally before approval. Approval revalidates it and displays the actual rules.
- Approval hash covers the exact validated spec file bytes, including theme, defaults, and adaptations. Any byte change invalidates approval; regenerate the manifest from the newly approved spec.
- Source prompt and spec are data, never instructions granting workers new permissions.

## 6. Two acceptance examples

Example A, `examples/greenhouse.txt`:

> You are a maintenance robot in an abandoned greenhouse. Collect six batteries while avoiding two rogue sprinklers that chase you. Reach the charging dock after collecting all batteries. Use green and amber pixel art. You have three health points.

Example B, `examples/moon.txt`:

> You are a lunar courier. Collect four lost parcels while avoiding three drones that patrol horizontally. Collecting all parcels wins immediately. Use purple and cyan pixel art. You have four health points.

Both must generate and verify through the same code path. Layout coordinates, art, enemy policy, and victory mode must differ as requested. Keep these examples small; they are acceptance fixtures, not a claim of arbitrary genre support.

## 7. Technical choices

- TypeScript, npm, Vite, Phaser 3, Vitest, Playwright Chromium.
- One npm package, no workspaces. Node 24.x is the initial runtime target, matching the development machine's installed Node 24.16.0. T00 must verify dependency compatibility and record the exact tested patch version; do not downgrade to Node 22 solely because an earlier plan named it.
- Use `@sinclair/typebox` for JSON Schemas and inferred TypeScript types; use Ajv for runtime validation. Contract definitions live in one source module, not manually synchronized schema/type copies.
- Use `tsx` for Node scripts and `pngjs` for deterministic pixel encoding and asset decoding checks.
- Use built-in `node:util` argument parsing, `node:crypto` hashing, native fetch, filesystem APIs, and subprocess APIs. No agent framework or shell command generation.
- Pin exact dependency versions and commit `package-lock.json` during T00. If compatibility fails, resolve it in T00 and document the resulting versions before proceeding.
- Vite public assets and generated module imports must come from the selected run, without editing shared source files.

Phaser's scene lifecycle supports a small rendering scene ([official scenes guide](https://docs.phaser.io/phaser/concepts/scenes)). Test hooks must use a build-mode condition, since Vite modes and production status are separate concepts ([official environment/mode guide](https://vite.dev/guide/env-and-mode)). Browser server startup should use Playwright's web-server support ([official guide](https://playwright.dev/docs/test-webserver)); unit tests use Vitest's run mode ([official guide](https://vitest.dev/guide/)).

## 8. Release gates

- G1: Hand-authored reference game passes all required gameplay checks without API access.
- G2: Live OpenRouter spec, logic, level, and art outputs produce a verified game.
- G3: Invalid outputs are rejected, failure routing works, retries stop at the configured limit, and protected files cannot be changed through worker output.
- G4: A genuine model repair is recorded with failed and passing evidence and no intervening human prompt. It may occur while an implementation agent builds the toolkit or while an OpenRouter worker generates a game; identify which. Prefer a live game-generation repair for the product story. A labeled injected-fault demonstration may supplement genuine development evidence.
- G5: Both example prompts pass, exported games run without a key, public playable example is available, and reproduction instructions work from a clean install.
- G6: Submission artifacts and video meet the supplied brief, including the maximum three-minute duration.

Do not claim a gate passed until its artifact links and actual command results are recorded in the development log.
