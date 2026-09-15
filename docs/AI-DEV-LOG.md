# AI development log

## 2026-09-08 — Plan and contracts

Provenance: implementation.

The product was constrained to one top-down collection/survival genre. The human selected OpenRouter as the runtime model backend and requested task cards explicit enough for smaller implementation models. T00 through T06 established pinned dependencies, strict contracts, a pure fixed-step runtime, a playable Phaser fixture, browser gameplay scenarios, semantic validators, a TypeScript AST allowlist, and deterministic pixel rendering.

## 2026-09-09 — Offline harness and implementation repair

Provenance: implementation-agent loop.

- Trigger: the first execution of `npm.cmd run verify` failed at `TYPE-REPOSITORY` before a report could be completed.
- Observable failure: Node 24 on Windows returned `Error: spawn EINVAL` when `scripts/verify.ts` attempted to spawn `npm.cmd` directly.
- Automatic action: the implementation agent read the failure, changed the command runner to invoke npm through `process.execPath` and `npm_execpath`, and converted launch errors into captured failed checks.
- Second observable failure: generated-module type checking then returned TypeScript 7 error TS5112 because command-line files require `--ignoreConfig` when a `tsconfig.json` is present.
- Automatic action: the implementation agent added `--ignoreConfig` to that isolated generated-module check.
- Verification after repair: `npm.cmd run verify` passed every stage without a human message between the failed implementation and passing run.
- Human instruction during loop: no.
- Scope label: this proves an autonomous toolkit-development repair loop. It is not presented as a live OpenRouter game-generation repair.

## 2026-09-09 — Orchestration and bounded recovery

Provenance: fixture and injected-fault tests.

T08 through T13 added OpenRouter request validation and retry accounting, exact spec approval, role-specific packets, concurrent generation workers, fixed-path integration, owner routing, a three-iteration repair cap, and escaped execution reports. The injected logic fixture returns an exit-unaware victory rule. The integration test observes a policy failure, requests one complete logic replacement, preserves before/after/diff, integrates it, and observes the next verification pass. A separate test returns three invalid repairs and proves that no fourth request is dispatched.

The parallel orchestration test holds all worker promises behind a barrier. Its recorded start order contains logic, level, and art before any promise resolves; verification is invoked only after all three outputs are accepted and integrated.

## 2026-09-09 — Release review

Provenance: implementation and reference fixture.

The reference verifier passed contracts, protected-file checks, repository and selected-module type checks, 115 unit/integration tests at the T13 checkpoint, isolated test and production builds, PNG decoding, 14 gameplay/policy checks, production smoke, and a final protected-file comparison. Release review also corrected the Phaser scene so run builds display generated 32×32 pixel sprites rather than merely exporting them.

## Release gates

| Gate | Status | Evidence |
| --- | --- | --- |
| G1 Reference game and offline harness | Passed | `evidence/reference/verify.json` |
| G2 Live OpenRouter generation | Passed | `evidence/live-greenhouse/`, `evidence/live-moon/` |
| G3 Controls and bounded recovery | Passed live and in tests | `evidence/live-storm/`, `tests/integration/orchestrator.test.ts` |
| G4 Genuine autonomous repair evidence | Passed for toolkit implementation and live model repair | Implementation repair entry above; `evidence/AUTONOMOUS-REPAIR.md` |
| G5 Playable examples, export, reproduction, public link | Partial | Four playable exports, three curated credentialed runs, clean reproduction, repository, and public Pages URL pass; human full-level checks pending |
| G6 Submission and video | Pending | `docs/DEMO.md` contains the final timed recording script; recording and submission remain pending |

Live model output, passing verification, and public deployment are recorded. Human full-level completion, final video, and submission are not yet claimed.

## 2026-09-09 — Live OpenRouter calibration and recovery

Provenance: credentialed live generation plus implementation-agent recovery. No human prompt occurred between the first failed live generation and the final passing greenhouse and moon runs.

The doctor confirmed `openai/gpt-oss-20b` advertises structured-output support. Early logic completions were truncated, empty, or wrapped; the client was changed to request low reasoning, retry empty/truncated/malformed completions with bounded output growth, and safely extract one unambiguous fenced JSON object before applying the unchanged schema validator. A separate Windows startup failure in `tsx` was corrected with a narrow preload that supplies the existing Windows username when Node's `os.userInfo()` fails.

Run `20260909T172814Z-3cb38f89` then reached the browser harness. Thirteen of fourteen scenarios passed. PLAY-01 failed because the trusted test expected the reference title `Greenhouse Rescue` instead of the active approved title `Greenhouse Repair`. The existing classifier incorrectly routed this runtime assertion to art, so three bounded art repairs could not affect the failure. The agent preserved the run, changed PLAY-01 to derive title, score target, and health from the active spec, fixed ownership classification, and reran the complete reference harness. It passed all stages with 120 unit/integration tests and 14 browser scenarios.

Fresh live runs `20260909T211322Z-64f94916` and `20260909T211338Z-c0505a5e` passed all eleven verification stages with image-generated 64 by 64 sprites. Their worker timelines show logic and level running alongside the four-request art workstream. The games differ in theme, objective, collection count, enemy policy, level, palette, and generated sprites. Evidence is curated under `evidence/live-recovery/`, `evidence/live-greenhouse/`, and `evidence/live-moon/`.

## 2026-09-11 — Expanded games, observable coordination, and live repair

Provenance: implementation plus credentialed, labeled fault-injection run.

The game contract was expanded with standard, sprint, and dash movement; touch and ordered collection; chase, two patrol axes, and guard behavior; three objective modes; four layouts; two pressure systems; and an explicit fantasy, signature mechanic, pacing, and dramatic-pressure brief. The art role now makes four independent image requests and trusted code normalizes each result to a transparent 64 by 64 sprite. The control page displays this mechanic summary and polls actual logic, level, art, and repair states.

The orchestrator now enforces `parallelWorkers` with a bounded scheduler and emits each completion event when that worker settles. In Storm run `20260911T202329Z-7ce1108f`, logic, level, and art began within 39 ms; logic finished in 2.916 s, level finished after one contract correction in 15.417 s, and art finished in 27.559 s. This establishes real overlap and shows art as the critical path.

Development runs exposed two harness defects without a new human prompt. First, browser-failure classification matched an earlier passing `PLAY-01` line instead of the failed `PLAY-07`; the classifier was changed to prefer Playwright's failed-test marker and covered by an integration test. Second, restart assertions assumed the original four-key input shape even when expanded mechanics added optional action keys; the assertion now verifies mandatory directions and that every present input is released. The complete reference verifier then passed.

For the final demonstration, `--demo-fault logic-victory` preserved the generated logic and injected an exit-unaware victory policy. Attempt 0 failed `PLAY-07`. The orchestrator routed the failure to logic; a real `openai/gpt-oss-20b` repair call restored the three objective cases; and attempt 1 passed all eleven stages, including 131 unit/integration tests and 14 browser scenarios. No human prompt occurred during generation, failure classification, repair, reintegration, or the passing rerun. The report labels the run `injected-fault`, and original/injected logic, before/after artifacts, diff, failed verification, passing verification, events, and screenshots are preserved under `evidence/live-storm/`.

## 2026-09-11 — Spec-directed action feedback

Provenance: implementation and reference fixture.

The spec contract gained a bounded animation profile for dash, damage, and collection feedback. Current spec workers must select styles, colors, durations, and damage shake intensity that fit the game identity; the field stays optional at schema version 1 so preserved live runs remain readable. The art worker sees the selected profile as pose and contrast guidance, while the trusted Phaser renderer creates all effect objects.

The renderer detects events only by comparing consecutive deterministic snapshots. Dash produces an afterimage, streak, or burst and stretches the player briefly; damage produces hurt flicker plus a flash or shockwave; collection produces a pop, spark, or pulse. Effects expire by simulation tick and restart destroys them. `window.gameDebug.visuals()` exposes animation state, invulnerability, and active effect records in development/test builds only. Browser checks ANIM-01 through ANIM-04 cover activation, expiration, and cleanup without adding simulation mutation commands. Final verification passed all eleven stages with 134 unit/integration tests and 16 browser scenarios; visual inspection confirmed readable dash afterimages and a visible damage shockwave.

## 2026-09-13 — Interactive review and observable failures

Provenance: implementation, commits `fd14744`, `5027eb7`, and `7e2d4eb`.

Commit `fd14744` changed the local control page into an iterative workbench. Its optional durable review gate separates parallel generation from integration, exposes the specification and all three worker contracts, previews every sprite, accepts validated source or JSON edits and PNG replacements, and records numbered revisions before continuing the autonomous harness. The same change added a visible elapsed or countdown HUD, a `survive` objective, and a semantic duration check that converts requested seconds to 60 Hz simulation ticks. It followed a 30-second survival request that had been represented as a hidden 10-second survive-then-exit condition.

A live run then showed that an initial worker failure happens before the review gate, leaving its raw attempt visible only in the execution report. Commit `5027eb7` exposed accepted outputs, raw model responses, and validation errors directly in collapsed agent cards for every run state. It also added prior-run reopening, linked retries, and loading indicators. Commit `7e2d4eb` added bounded, persisted guidance for logic, level, art, and repair so a human can redirect one role without replacing its protected contract prompt.

## 2026-09-14 — Targeted iteration and recovery controls

Provenance: implementation, commits `b6b47e1`, `098b08d`, `ab6dc48`, and `3000882`.

Commit `b6b47e1` introduced explicit generation plans for linked iterations. Failed workers and workers whose instructions changed run again; accepted outputs for unchanged workers are copied into the new run and emit `worker.reused`. Art guidance can target player, collectible, enemy, or exit, causing only those image requests to run while the other accepted or manually uploaded sprites remain in the merged art contract. Global art guidance still regenerates all four sprites.

Commit `098b08d` fixed the sprite controls so an “Adjust only” action expands the nested instructions and focuses the selected field. Commit `ab6dc48` made verified games valid iteration sources and placed the regeneration action beside the instructions; the linked run leaves the original passing build and evidence intact. Commit `3000882` corrected retry selection to use each role's latest terminal worker outcome, preventing a recovered art worker's earlier transient failure from forcing another full art generation.

## 2026-09-14 — Portability and broader game objectives

Provenance: implementation, commits `e08de4b` and `dd75313`.

Commit `e08de4b` removed Windows-only `npm.cmd` assumptions from verification, Playwright server startup, CLI help, and documentation. The harness now selects `npm` or `npm.cmd` by platform and quotes generated build paths appropriately on Windows and POSIX shells. Stopped runs also gained an inline execution-report link and a clearer autonomous-repair retry action so failure evidence is reachable from the control page.

Commit `dd75313` added a bounded `custom` objective whose approved formula may combine collection, exit contact, and elapsed time with AND or OR. The context packets and protected prompts describe the formula explicitly, the logic worker still returns only its fixed two-function module, and semantic validation remains authoritative. The renderer hides an exit for pure survival games and the timer derives its countdown from custom time requirements when present. Unit coverage was added for custom objective contracts, formulas, exit visibility, and timer behavior.

## 2026-09-14 — Gallery and submission preparation

Provenance: generated release artifact and documentation, commits `1b45be5` and `e0bd359`.

Commit `1b45be5` published Rancher's Rush as the fourth playable gallery entry with its static build and four generated PNG assets. The public-site checker now validates every discovered game link instead of assuming exactly three entries. Commit `e0bd359` replaced the outline demo plan with a 396-word recording script aligned to the required format: working product in the first 90 seconds, then context boundaries, real parallel timings, deterministic verification, and the labeled autonomous repair loop in the final 90 seconds. This records preparation only; it does not claim that the video was recorded or submitted.

## Commit-backed milestone index

| Commits | Result |
| --- | --- |
| `2c8f7fa` | Initial specification, contracts, runtime, agents, harness, tests, and documentation |
| `8e19f60`, `cf1f410` | Credentialed live generation, release checkpoint, and clean-checkout reproduction |
| `784906c`, `ac2b50c`, `065ae0d`, `191133f` | GitHub Pages deployment, release routing, and public verification |
| `91fcfef`, `d5787d1` | 64-pixel generated sprites and regenerated public examples |
| `030f402` | Expanded identity and mechanic vocabulary |
| `3feb80c` | Measured parallel work and live OpenRouter repair evidence |
| `b7f9c8b` | Spec-directed dash, damage, and collection feedback |
| `fd14744`, `5027eb7`, `7e2d4eb` | Review workbench, inline diagnostics, and per-agent guidance |
| `b6b47e1`, `098b08d`, `ab6dc48`, `3000882` | Targeted role and sprite iteration with reuse of accepted work |
| `e08de4b`, `dd75313` | Cross-platform verification and flexible custom objectives |
| `1b45be5` | Fourth public gallery game, Rancher's Rush |
| `e0bd359` | Final timed demo script |
