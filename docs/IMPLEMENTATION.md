# Implementation task cards

Status: T00 through T14 and T16 are complete as of 2026-09-09. T15 is locally prepared; public GitHub/Pages URLs, human full-level completion, and video submission require external action.

Use these cards with less capable implementation models. Assign one card at a time. A task is complete only when its stated checks actually pass and the handoff records the commands/results. If a card is too large for one context, finish one numbered step and hand off explicit remaining work; do not claim the entire card passed.

Do not build optional features until T16. Do not ask a worker to infer architecture from the product pitch. Give it CONTRACTS plus the relevant task and files, using TASK-HANDOFF.

## Dependency order

```text
T00 -> T01 -> T02 -> T03 -> T04 -> T05
           -> T06 ---------------------> T07
           -> T08 -> T09
           -> T10 (also needs T06 and T08)
T07 + T09 + T10 -> T11 -> T12 -> T13 -> T14 -> T15
T15 -> T16 optional
```

T07 also requires T05. T08 can proceed independently after T01. T06 can proceed independently of runtime work after T01. These are opportunities for separate implementation agents if the human chooses delegation; parallel runtime game-generation workers are implemented in T11 regardless.

## T00 — Bootstrap and lock dependencies

**Read:** SPEC sections 2 and 7; CONTRACTS layout. **Prerequisites:** none.

**Allowed files:** package/lock files, tsconfig files, Vite/Vitest/Playwright config, index.html, `.gitignore`, `.env.example`, minimal entry `src/game/main.ts`, README setup section.

1. Initialize one private npm package using ESM and TypeScript strict mode. Use separate browser and Node TypeScript configs if required, with one root typecheck command checking both.
2. Install the libraries specified in SPEC and required type declarations. Pin exact resolved versions. Verify the Node target against the selected packages; record actual Node and npm versions.
3. Add real scripts for `typecheck`, `test:unit`, `build`, `dev`. Later tasks add verification/generation scripts when implemented. Do not create success-returning placeholder scripts for missing functionality.
4. Configure browser and Node source boundaries. Do not allow browser imports of toolkit/config/API modules.
5. Ignore node_modules, `.env`, runs, test outputs, and builds; retain `.env.example` and curated evidence. Never ignore all JSON files.
6. Create the smallest visible Phaser canvas using a local scene; no model integration yet.

**Check:** clean dependency installation, typecheck, and Vite build succeed; dev canvas loads. Record browser observations honestly. No invented test suite is required just to test scaffold files.

**Done artifact:** lockfile and exact tested setup commands.

## T01 — Implement authoritative contracts and reference fixture

**Read:** CONTRACTS in full, SPEC gameplay semantics. **Prerequisite:** T00.

**Allowed files:** `src/contracts/**`, `tests/fixtures/reference/**`, `tests/unit/contracts.test.ts`.

1. Implement TypeBox definitions for GameSpec, approval, manifest, art, level, model logic envelope, repair envelope, check/run reports, and event variants.
2. Export inferred types. Declare exact generated rule types and the trusted GameDebug/snapshot interface. Do not change names or enums from CONTRACTS.
3. Compile Ajv validators with all errors enabled, no coercion, no default insertion, and extra keys forbidden.
4. Add the Greenhouse reference spec and valid hand-authored level, art grids, and correct rules module. This is a development fixture, not model evidence.
5. Add valid/invalid schema examples covering extra keys, missing fields, enum rejection, numeric bounds, and malformed art rows.

**Check:** CONTRACT-01 and schema portions of CONTRACT-02/03 pass; reference JSON validates; typecheck passes.

**Handoff:** export names and exact generated rule interface. Subsequent tasks consume these definitions; they must not redeclare divergent copies.

## T02 — Implement deterministic movement and enemy integration

**Read:** SPEC section 4, CONTRACTS sections 5-6. **Prerequisite:** T01.

**Allowed files:** `src/runtime/state.ts`, `src/runtime/geometry.ts`, `src/runtime/step.ts`, `tests/unit/movement.test.ts`.

Export:

```ts
createInitialState(spec: GameSpec, level: LevelOutput): GameSnapshot;
stepGame(state: GameSnapshot, input: InputState, rules: RuleFunctions,
         spec: GameSpec): GameSnapshot;
```

`InputState` is the four-boolean input type in CONTRACTS. `RuleFunctions` has the two exact function types. `stepGame` is pure: clone mutable collections before changes, do not mutate its arguments, and return the new snapshot. The timestep is the fixed runtime constant, not a caller-supplied arbitrary duration. A separate trusted transition helper begins play; do not interpret Start/Restart as directional input fields.

1. Initialize entities and enemy velocities from level; initialize score=0, tick=0, health from spec, cooldown=0, errors=[] and state=ready.
2. Implement squared-circle overlap and center clamping helpers.
3. In playing state, increment tick once, apply normalized player movement, invoke enemy velocity policy, integrate and clamp enemy positions.
4. Pass copies of policy context so mutation cannot alter shared state. Validate finite returned velocity components; on policy error, record it and stop advancing that frame with a visible game error.
5. Ready/won/lost snapshots do not advance through `stepGame`.

**Check:** SIM-01/02; input state not mutated; 60 fixed ticks reproduce exactly from same initial state and input sequence; invalid policy velocity becomes observable failure.

**Not this task:** collection, damage, victory, Phaser rendering.

## T03 — Implement collection, health, victory, restart

**Read:** SPEC section 4, VERIFICATION SIM checks. **Prerequisite:** T02.

**Allowed files:** `src/runtime/state.ts`, `src/runtime/step.ts`, `tests/unit/gameplay.test.ts`.

1. Add collection/removal to the step in specified order.
2. Add damage with integer `nextDamageTick`; first damage at tick T sets T+60. Multiple contacts on one tick still remove only one health.
3. Apply loss before calling victory policy; call isVictory with approved mode, score/target, and overlap-derived atExit.
4. Export `startGame(state)` and `restartGame(spec, level)` trusted helpers. Starting ready clears directional input; restarting reconstructs initial state and returns ready.
5. Freeze movement, enemies, health, score, and tick after win/loss.

**Check:** SIM-03 through SIM-07 with independent hand-authored policy stubs. Include lethal-contact/last-collectible same-tick case. Typecheck and earlier runtime tests pass.

## T04 — Render a playable reference game

**Read:** SPEC product scope and semantics; CONTRACTS selected-run mapping. **Prerequisite:** T03.

**Allowed files:** `src/game/**` except debug module, `src/runtime/input.ts`, `src/generated.d.ts`, Vite config, reference asset files as needed.

1. Load selected spec/level/rules through fixed aliases. Default to reference fixture; do not hardcode a particular run path into source.
2. Use one Phaser scene to preload assets, create sprites, and render authoritative simulation state. Input adapter reads WASD/arrows and clears pressed keys on blur.
3. Add a fixed-step accumulator with the backlog cap from SPEC. Do not also enable a second physics movement system.
4. Add readable DOM title/objective/score/health/state labels outside or over the canvas, with stable `data-testid` names: `game-title`, `game-objective`, `game-score`, `game-health`, `game-state`, `start-button`, `restart-button`.
5. Add Start/Enter, Restart/R, win/loss overlays, nearest-neighbor pixel scaling, coherent background and enemy/player contrast. Display policy/runtime errors as an error panel and console error.
6. Render at 800x600 logical coordinates with fit-to-window scaling; keyboard tests target the actual game canvas/window.

**Check:** reference is manually playable through win and loss; restart resets; no browser console errors; production build succeeds. Record play observations without claiming automated verification yet.

## T05 — Add trusted debug scenarios and browser gameplay tests

**Read:** CONTRACTS debug interface; VERIFICATION sections 3-4. **Prerequisite:** T04.

**Allowed files:** `src/game/debug.ts`, minimal hook wiring in GameScene/main, `tests/fixtures/scenarios/**`, `tests/browser/**`, Playwright config.

1. Implement snapshot deep copy, named fixture loader, and manual tick advance with exact bounds.
2. Use build-mode gating; development may inspect, test mode may manually advance, production exposes no debug object.
3. Implement the named scenarios exactly. Fixtures select initial state; they do not replace generated policy or collision functions.
4. Implement PLAY-01 through PLAY-10 using real keys and exact observations. Wait for keyboard-state reflection before advancing manual ticks.
5. Implement protected browser policy-entry tests POLICY-01/02/03. Import actual selected generated rules only in the test build.
6. Implement LEVEL-PLAY-01 and PROD-01; capture labeled screenshots and failure traces.

**Check:** every listed browser test passes on reference, including production debug absence; tests fail against a deliberately wrong rule fixture. Keep that wrong fixture explicitly labeled and outside reference defaults.

**Handoff:** test ID/owner mapping, screenshot paths, browser startup command. Never include generated rule imports in Node test execution.

## T06 — Implement semantic validation, source restrictions, and pixel rendering

**Read:** CONTRACTS sections 2-5; SYSTEM controls. **Prerequisite:** T01; independent of runtime tasks.

**Allowed files:** `src/toolkit/validate.ts`, `src/toolkit/render-pixels.ts`, `tests/unit/validation.test.ts`, `tests/unit/pixels.test.ts`.

1. Validate level/spec count and seed agreement, ID order, bounds, pair distances, spawn safety, exit spacing and quadrant coverage. Return structured failures, not just boolean.
2. Validate unique art IDs, row grammar, visible pixel counts. Render grids with pngjs and approved palette only.
3. Implement four visibly distinct fallback sprites as code-native pixel grids; apply identical validation and rendering.
4. Parse TypeScript source and implement the narrow AST allowlist in SYSTEM. Accept both correct chase/patrol implementations; reject unexpected imports, globals, top-level execution, loops, and extra exports.
5. Decode produced PNGs and confirm dimensions and visibility.

**Check:** CONTRACT-02/03/04, negative spacing cases, all-transparent sprite, malformed source, dynamic import, and valid reference source. Same art JSON produces identical PNG bytes twice.

## T07 — Assemble the single verification command

**Read:** VERIFICATION in full, SYSTEM integration mapping. **Prerequisites:** T05 and T06.

**Allowed files:** `scripts/verify.ts`, `src/toolkit/serve.ts`, verification-related configs, `tests/integration/verify.test.ts`, npm scripts.

1. Implement ordered stages and CheckResult/VerifyResult. CLI missing `--run` selects reference.
2. Typecheck the selected generated module in addition to repository code, without executing it. Resolve its trusted relative type import.
3. Build test and production outputs separately with selected-run aliases/assets. Serve them through a local static-only server that does not expose repository files, `.env`, or traversal paths.
4. Let Playwright own server lifecycle or pass a known process owned by this invocation. Do not trust a preexisting port listener.
5. Hash protected files before/after; detect content changes, additions and deletions.
6. Capture logs, screenshots, traces and required stage statuses; timeout and cleanup all child processes. Pass sanitized environment variables to children.
7. Register `npm run verify`, `test:browser`, and `game:serve` when operational.

**Check:** G1; offline verify passes; intentional rule failure exits nonzero with owner logic; missing asset fails; altered protected file fails; occupied port cannot produce a false pass; report survives failed build. Restore intentional fixture changes after the tests.

## T08 — Implement OpenRouter client and doctor

**Read:** SYSTEM sections 2-4 and linked official docs. **Prerequisite:** T01; can run independently of game tasks.

**Allowed files:** `src/toolkit/config.ts`, `src/toolkit/openrouter.ts`, `scripts/doctor.ts`, `.env.example`, `tests/unit/openrouter.test.ts`, doctor npm script.

1. Implement ModelClient via native fetch, strict schema response, explicit selected model, non-streaming mode, and AbortSignal.
2. Implement sanitized response parsing and all specified transport retries. Inject transport and clock/delay for tests.
3. Enforce context/output/request limits through explicit shared budget input; no hidden retry loop.
4. Config loads Node-only env, validates nonempty model IDs and key for generation, and supports role overrides. Never serialize key into config output.
5. `doctor` checks runtime/dependencies/browser installation, config presence, and chosen model capability metadata from OpenRouter's model catalog. Do not print the key or send billable completion probes by default. Metadata is advisory; generation still requires a compatible endpoint.

**Check:** API-01/02/03 with mocked transport; retries, body errors, timeouts, malformed JSON, missing content, credit error, and redaction. Unit tests pass without a real key or network.

**Model choice:** leave example values blank. Do not invent a permanently best cheap model or hardcode a costly fallback. Record chosen IDs when running the later live evaluation.

## T09 — Implement spec proposal and human approval CLI

**Read:** SPEC approval flow; CONTRACTS GameSpec; SYSTEM context/limits. **Prerequisite:** T08.

**Allowed files:** `src/toolkit/cli.ts`, `src/toolkit/workers/spec.ts`, `prompts/spec.md`, `src/toolkit/events.ts`, examples, CLI npm scripts, spec/approval tests.

1. Add `game:spec -- --prompt-file <file>` and optional `--seed <integer>`. Read file as UTF-8; validate input length before model call.
2. Create unique run folder, save source prompt/effective non-secret config, emit run.created, and invoke spec worker with defaults and supported limits.
3. Validate output; give one bounded correction if needed. Save valid proposed spec with stable formatting, print summary/adaptations and exact SHA-256, emit spec.proposed, state awaiting-approval.
4. Add `game:approve -- --run <id> --hash <hash>`. Revalidate current file, require matching hash, save approval and event. No model call during approval.
5. Ensure edited spec invalidates earlier approval; generation will independently check again.

**Check:** PIPE-04; fake spec response creates reviewable run; invalid spec never becomes approved; altered hash rejected; request counts persist across invocations. Empty/oversized input fails before API call.

## T10 — Implement the three generation workers and context builder

**Read:** CONTRACTS role outputs; SYSTEM context packets; TASK-HANDOFF runtime prompts. **Prerequisites:** T06 and T08.

**Allowed files:** `src/toolkit/context.ts`, `src/toolkit/workers/{logic,level,art}.ts`, `prompts/{logic,level,art}.md`, worker tests.

1. Implement each role as a function receiving approved task data, ModelClient, and shared budgets. Return validated role output; do not write integration files from workers.
2. Build compact role-specific prompts from trusted instructions plus serialized data. Include one complete valid example per data format and exact policy signatures for logic.
3. On initial invalid output, send one correction with explicit errors. Retain both responses. Logic/level exhausted errors stop; art may return a recorded fallback as specified.
4. Enforce size limits; code arrives as the JSON source field, never a Markdown patch.
5. Record actual request metadata and packet hashes through orchestrator callbacks rather than multiple independent event-file writers.

**Check:** valid fake outputs accepted; level count mismatch rejected/corrected; malformed sprite triggers labeled fallback after limit; logic extra exports rejected; no worker output can choose a path; auth failure stops.

## T11 — Implement parallel orchestration and integration

**Read:** SYSTEM lifecycle/integration; CONTRACTS run layout. **Prerequisites:** T07, T09, T10.

**Allowed files:** `src/toolkit/orchestrator.ts`, `src/toolkit/integrate.ts`, generation CLI wiring, `tests/integration/orchestrator.test.ts`.

1. Implement legal run transitions and exclusive active-run lock.
2. Check approval before any generation call; snapshot protected baseline and derive manifest.
3. Start three independent role calls concurrently with shared atomic budget reservation. Await all settled results; save successes and failures even if a peer fails.
4. Integrate accepted outputs only at fixed paths; generate trusted rule-types and render PNGs. Do not modify shared src or reference fixtures.
5. Invoke full verifier as attempt 0. For this task, a failure stops with complete report; T12 adds repair.
6. Add `game:generate -- --run <id>` command. Make state/log writes atomic where required and cleanup unconditional.

**Check:** PIPE-01/05/07/08; event timestamps establish genuine overlap with a barrier-based fake client, not just `Promise.all` presence; integration never starts before all accepted outputs; second concurrent run rejected; no stale build marked current.

## T12 — Add autonomous repair and evidence preservation

**Read:** SYSTEM routing; VERIFICATION recovery evidence. **Prerequisite:** T11.

**Allowed files:** `src/toolkit/workers/repair.ts`, `prompts/repair.md`, orchestrator repair branch, repair integration tests.

1. Map check IDs/owners deterministically; unknown ownership stops with reason.
2. Build fresh repair packet containing current artifact, approved contract/spec subset, exact failing assertions and bounded relevant logs.
3. Request concise diagnosis and complete replacement of that one role output. Validate and preserve before/after/diff before integrating.
4. Rerun full harness after accepted change. Maintain three-iteration cap shared across owners, no nested correction loop, and all request/time limits.
5. Record repair and verification events without calling an interactive prompt function. Termination is either verified or stopped with evidence.

**Check:** PIPE-02/03/06; initial wrong objective fixture produces real browser failure, fake repair response fixes it, real verification passes; fourth repair never dispatched; test/protected changes rejected. Label fixture provenance.

**Gate:** toolkit supports the full loop mechanically; this task alone does not prove a live model performed the fix.

## T13 — Generate an inspectable execution report

**Read:** SYSTEM evidence; CONTRACTS reports/events; DEMO. **Prerequisite:** T12.

**Allowed files:** `src/toolkit/report.ts`, report integration wiring, report tests, README commands.

1. Write report.json and static report.html for every terminal run.
2. Display actual worker intervals, model IDs, request counts, available cost, accepted spec/hash, all checks, fallback source, and repair before/after evidence.
3. Use escaped HTML and local relative links; no remote script/CDN dependency.
4. Only verified runs link to their current verified production export. Failed candidates may have clearly labeled diagnostic preview links.
5. Include a visible provenance label and no-credentials-needed instructions for exported games.

**Check:** REPORT-01; script-like title renders as text; missing cost displays unknown; failed/skipped harness result never shows verified; relative evidence links resolve.

## T14 — Run live OpenRouter generation and calibrate smaller models

**Read:** all release gates; VERIFICATION recovery rules. **Prerequisite:** T13.

**Allowed files:** evidence, examples if clarified before run, non-secret model config records, AI-DEV-LOG. Implementation fixes must identify the failed owning task and rerun its affected checks.

1. Select one affordable structured-output-capable configured model using current catalog information. User provides key through local environment, never chat/committed file.
2. Run both fixed prompts through actual spec approval and generation. Record returned model IDs, duration, tokens, cost if available, role validation failures and repair counts.
3. If a role repeatedly fails, inspect whether the contract/example/context is unclear. Improve that narrow instruction and record the change; do not add unrelated context or silently relax acceptance.
4. If using multiple model candidates, compare the same two prompts and same acceptance suite. Report small-sample results without claiming a benchmark winner.
5. Capture live autonomous failure/repair if it occurs. Preserve evidence before making any human edit. A genuine implementation-agent loop from an earlier task can satisfy G4 if its provenance and lack of intervening prompts are evidenced; identify it as toolkit development, not live game generation. If no natural failure occurs in either process, report that truth and use labeled fault injection only as supplementary recovery evidence.
6. Manually finish both actual generated games and record play/visual judgments. Adjust an unplayable approved design through a new approval/run, not a hidden level substitution.

**Check:** G2/G3/G4/G5 evidence status explicitly recorded; two live outputs distinct; fixtures never presented as live calls. If G4 is unmet, keep it outstanding instead of manufacturing a claim.

## T15 — Reproduction and submission

**Read:** DEMO checklist and supplied brief. **Prerequisite:** T14 core product works; explicitly track any unmet evidence gate.

**Allowed files:** README, docs, curated evidence, demo assets; deployment configuration only when needed for static product link.

1. Reproduce install, offline verify, and exported play from a clean checkout with documented runtime version.
2. Document real environment setup, model IDs used, expected commands, external services, known limits, and live versus replay distinction.
3. Curate compact genuine logs and timeline in SYSTEM/AI-DEV-LOG with links to evidence. Avoid checking in unrelated raw runs or credentials.
4. Prepare a public static playable build, repository link, one-to-two sentence description, and maximum three-minute video using DEMO. Publication follows the user's actual hosting authorization.
5. Check submission deadline/details against the organizer-provided final instructions before submitting; no invented submission URL.

**Check:** G5/G6, working links, no API key in production output/repository, all required submission artifacts present. Explicitly list remaining gates if any.

## T16 — Optional local control page, only after core release gates

**Prerequisite:** T15 preparation complete and time remains. This is stretch scope, not required for CLI definition of done.

Add a small local Node control service and one form for prompt, spec review/approval, run progress, report link, and playable preview. Reuse existing orchestration functions and event/report data. Bind service to loopback, keep credentials in Node, check request origin, and serve generated games on a separate static origin. Do not make the public demo host execute untrusted generated code with server credentials.

No accounts, database, streaming model token UI, chat system, or worker avatars. Actual worker status and game preview are sufficient.
