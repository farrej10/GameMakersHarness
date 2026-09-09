# Protected verification plan

Implement these checks before live generation. The evaluator is owned by the toolkit, not by the generating workers. It derives expected behavior from trusted contracts and approved spec.

## 1. Command contract

`npm run verify` checks the committed reference fixture without an API key. `npm run verify -- --run <run-id>` checks that run's current accepted integration. Both use the same required stages and return 0 only when all required checks pass.

Run stages in this order:

1. Validate schemas, semantic constraints, and generated source restrictions.
2. Check protected baseline.
3. Type check trusted source and selected generated module.
4. Run trusted unit/integration tests with mocked network.
5. Build production and test-mode variants into separate clean run-local directories.
6. Decode and inspect PNG assets from production output.
7. Run behavioral Chromium checks against the test build; save screenshots and traces.
8. Run a real-time production smoke test with no debug interface.
9. Recheck protected files; always write final JSON and readable summary.

Dependent stages may be skipped after a prerequisite failure but must be reported as skipped; overall status remains failed. Harness always writes its report even when a subprocess fails or times out. Set subprocess timeouts, terminate owned process trees, and release ports in cleanup. Never reuse an unknown server on the desired port.

Reference runs have their own output directory under ignored test artifacts. Verification of a selected run must never overwrite curated evidence or another run. Capture stdout, stderr, exit status, command ID, and timing for each stage; do not log secret-bearing environment variables.

## 2. Unit and integration acceptance IDs

| ID | Required assertion | Owner on failure |
| --- | --- | --- |
| CONTRACT-01 | Valid spec passes; extra keys, unsupported enum, out-of-bounds number fail with paths | harness |
| CONTRACT-02 | Level counts, IDs, distances, quadrants, seed must match approved spec | level for artifact failure; harness for validator failure |
| CONTRACT-03 | Art row lengths/symbols/IDs/opaque count validated | art |
| CONTRACT-04 | Only exact logic exports, type import, and allowed AST subset accepted | logic |
| SIM-01 | Cardinal and diagonal input travel at the same speed | runtime |
| SIM-02 | Player stays inside all four boundaries | runtime |
| SIM-03 | A collectible scores once and disappears | runtime |
| SIM-04 | First contact damages once; repeated contact before T+60 does not; T+60 damages again | runtime |
| SIM-05 | Several touching enemies cause at most one damage event per tick | runtime |
| SIM-06 | Health floors at zero, defeat wins a simultaneous victory tie | runtime |
| SIM-07 | Won/lost freezes simulation; restart completely resets state/input | runtime |
| PIPE-01 | Logic/level/art calls overlap; integration waits for all accepted outputs | harness |
| PIPE-02 | Failed generated logic routes to repair, replacement integrates, verify reruns without a callback to human input | harness |
| PIPE-03 | Three failed repairs stop; no fourth repair request | harness |
| PIPE-04 | Changed spec hash blocks generation; no model call is dispatched | harness |
| PIPE-05 | Art fallback is usable and recorded; auth failure is never hidden as fallback | harness |
| PIPE-06 | Invalid output gets exactly the specified correction allowance | harness |
| PIPE-07 | Request/time limits include concurrent reservations and transport retries | harness |
| PIPE-08 | Interrupted/failed execution produces terminal report and frees owned resources | harness |
| API-01 | Valid structured response parsed and validated | infrastructure |
| API-02 | Retryable HTTP/network/body errors retry within cap; Retry-After honored | infrastructure |
| API-03 | Auth/credit/config errors fail fast; empty/refused/truncated content rejected | infrastructure |
| PROTECT-01 | Path traversal/model-chosen filenames cannot enter writer; protected file changes fail checks | harness |
| REPORT-01 | HTML escapes model text; failed/skipped checks cannot produce verified status | harness |

Pure runtime tests receive hand-authored policy stubs. Do not import generated code in Node to run them. Mock OpenRouter via an injected `ModelClient`/fetch transport; test runs must never accidentally consume credits.

## 3. Browser fixture design

Use 800 by 600 logical coordinates, Chromium desktop, one browser worker, fresh context per scenario, reduced motion, and a fixed viewport large enough for the complete arena. Tests wait for the Start button/game ready state, not a fixed load delay. Attach console/page errors and failed requests to evidence.

Manual-clock test URLs enable the trusted debug interface. Tests press actual keys with Playwright, wait until snapshot input reflects the key state, advance exact ticks, release the keys, and assert state. Do not implement a debug `moveTo`, `setScore`, `setHealth`, or `win` command.

Named scenario fixtures may replace initial positions and approved numeric values for isolated assertions. They must still use the current generated rules, trusted renderer, actual collision code, and input code. Clearly distinguish these scenario checks from playing the actual generated level.

Fixture constants:

- `movement`: player (100,100), speed 180, health 3; collectibles and enemies away from tested path; collect-then-exit.
- `collection`: player (100,100), collectible c1 (160,100), remaining collectibles away; enemies away; speed 180.
- `damage`: player and two enemies at (400,300), enemy speed 0 in trusted fixture, health 3; objective unobtainable on tested ticks. Fixture-only zero speed is allowed here, not in generated spec.
- `win`: player (100,100), collectibles at (160,100), (220,100), (280,100), exit (400,100); stationary enemies at (700,500); speed 180; objective mode comes from selected spec. Other fixture values fixed.
- `loss`: same as damage with initial health 1.
- `tie`: health 1, last collectible, player, enemy, and exit overlap at (400,300); damage available at first tick.

The `movement` and `collection` fixture must retain at least one uncollected item outside the path so collect-all cannot terminate unexpectedly. Use fixed trusted fixtures, not model-generated scenarios.

## 4. Browser acceptance IDs

| ID | Procedure and exact oracle | Owner |
| --- | --- | --- |
| PLAY-01 | Actual generated level loads; canvas, title, controls, score and health visible; no page errors or missing assets | harness/runtime, or art for missing asset |
| PLAY-02 | Movement fixture: hold Right for 30 ticks; x increases by 90 +/- 0.01, y unchanged. Repeat using D after reset | runtime |
| PLAY-03 | Movement fixture: hold Right+Down for 30 ticks; Euclidean displacement 90 +/- 0.01 | runtime |
| PLAY-04 | Hold movement into each boundary; center never leaves radius-adjusted arena | runtime |
| PLAY-05 | Collection fixture: hold Right for 20 ticks; c1 absent, score exactly 1; another tick cannot score c1 again | runtime |
| PLAY-06 | Damage fixture: first tick health 2; advance 59 more ticks, still 2; one more tick, health 1 | runtime |
| PLAY-07 | Win fixture: collect all with keyboard. collect-all becomes won; collect-then-exit stays playing until player touches exit | logic |
| PLAY-08 | Loss fixture: first contact yields health 0 and lost overlay; movement no longer changes position | runtime |
| PLAY-09 | Restart through R or button; state ready, score 0, full approved health, original generated placements, cleared input/cooldown | runtime |
| PLAY-10 | Tie fixture: one tick results in lost, never won | runtime |
| POLICY-01 | In browser evaluate current generated chase policy for cardinal, diagonal, coincident inputs; magnitude matches speed and direction toward target | logic |
| POLICY-02 | In browser evaluate patrol at both edges and in both travel directions; y velocity 0, no speed change | logic |
| POLICY-03 | In browser evaluate victory truth table for both modes, score below/equal/above target, and atExit true/false | logic |
| LEVEL-PLAY-01 | On actual generated level, bot uses real keys and snapshots to collect at least one item without fixture replacement | level/logic; ambiguous cases stop for review |
| PROD-01 | Production load has no debug hook even with `?clock=manual`; no errors/missing assets; Start and actual key movement render normally | runtime/harness |

Policy evaluation uses a protected test-only browser entry module imported by test-mode boot. Expose its assertion results through a separate test page, not a production/debug policy replacement API. It imports the same selected rules as the game. Do not add a backdoor that lets browser tests substitute a passing implementation.

`LEVEL-PLAY-01` bot is intentionally modest: choose the nearest collectible, steer toward its coordinates with WASD, stop within collision distance, and use a maximum of 600 ticks. Do not claim it proves the entire level is winnable. A human must complete both real generated examples as a separate product-release check; record that judgment. Full automated generated-level winning is stretch work.

For `PROD-01`, use DOM health/score/state labels and before/after canvas captures to establish loading, start and visible movement; it is a smoke test, not a substitute for exact test-build assertions. No debug access in production.

## 5. Assets, screenshots, and portability

- Decode all four manifest PNG files using pngjs; dimensions exactly 32 by 32; nonempty visible pixels; unique asset IDs and paths.
- Check URLs from exported build rather than only source files.
- Capture actual generated start screen, active gameplay, win, loss, and failed-step screenshot. Label fixture screenshots as fixture scenarios.
- Save browser trace for failures; save video or trace for the curated real repair run where practical.
- Verify relative asset URLs by serving the production export under a non-root URL prefix as well as locally.
- A screenshot is evidence for inspection, not an automatic aesthetic pass. Human checks palette contrast, legibility, entity distinction, and play feel for release.

## 6. Authentic recovery evidence

Automated mock pipeline test: return an incorrect objective implementation from fake logic client; real or stubbed verification appropriate to test layer identifies failure; fake repair returns corrected source; verify again. Label this fixture evidence.

Live recovery: run OpenRouter generation; if generated policy fails the real browser harness, preserve initial source, failure, repair request/response, source diff, and passing full verification. No manual prompt or manual source edit is allowed between that implementation and the passing verification in the claimed loop.

If live generations happen to pass immediately, do not intentionally weaken generation prompts to create a misleading failure. A genuine autonomous loop recorded while an implementation agent built the toolkit can satisfy the competition's workflow requirement; label it as toolkit development. Add a separately labeled injected-fault scenario if useful to demonstrate repeatable runtime recovery. The release log must distinguish genuine implementation loops, genuine live generation loops, mocks, and injected faults.
