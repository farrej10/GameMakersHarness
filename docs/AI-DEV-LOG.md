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
| G3 Controls and bounded recovery | Passed in tests | `tests/integration/orchestrator.test.ts` |
| G4 Genuine autonomous repair evidence | Passed for toolkit implementation | Implementation repair entry above |
| G5 Two live examples, export, reproduction, public link | Partial | Two verified live examples and `release/` exports pass; human full-level checks and public URL pending |
| G6 Submission and video | Pending | `docs/DEMO.md` remains the recording/submission checklist |

Live model output and passing verification are recorded. Public deployment, human full-level completion, final video, and submission are not yet claimed.

## 2026-09-09 — Live OpenRouter calibration and recovery

Provenance: credentialed live generation plus implementation-agent recovery. No human prompt occurred between the first failed live generation and the final passing greenhouse and moon runs.

The doctor confirmed `openai/gpt-oss-20b` advertises structured-output support. Early logic completions were truncated, empty, or wrapped; the client was changed to request low reasoning, retry empty/truncated/malformed completions with bounded output growth, and safely extract one unambiguous fenced JSON object before applying the unchanged schema validator. A separate Windows startup failure in `tsx` was corrected with a narrow preload that supplies the existing Windows username when Node's `os.userInfo()` fails.

Run `20260909T172814Z-3cb38f89` then reached the browser harness. Thirteen of fourteen scenarios passed. PLAY-01 failed because the trusted test expected the reference title `Greenhouse Rescue` instead of the active approved title `Greenhouse Repair`. The existing classifier incorrectly routed this runtime assertion to art, so three bounded art repairs could not affect the failure. The agent preserved the run, changed PLAY-01 to derive title, score target, and health from the active spec, fixed ownership classification, and reran the complete reference harness. It passed all stages with 120 unit/integration tests and 14 browser scenarios.

Fresh live runs `20260909T173352Z-9f60806e` and `20260909T173519Z-7e7412f3` then passed all eleven verification stages. Their worker timelines show logic, level, and art running concurrently. The games differ in theme, objective, collection count, enemy policy, level, palette, and generated sprites. Evidence is curated under `evidence/live-recovery/`, `evidence/live-greenhouse/`, and `evidence/live-moon/`.
