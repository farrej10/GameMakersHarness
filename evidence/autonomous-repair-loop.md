# Autonomous repair evidence

## Toolkit implementation loop

Provenance: `implementation`.

`npm.cmd run verify` first failed with Windows `spawn EINVAL`. The implementation agent consumed that failure, changed npm launching to use the Node/npm JavaScript entry point, reran the command, consumed TypeScript 7 error TS5112, added `--ignoreConfig`, and reran the full verifier successfully. No human message occurred between implementation and the passing verifier. The exact sequence is recorded in `docs/AI-DEV-LOG.md`.

## Generated-policy recovery test

Provenance: `injected-fault`.

Command: `npm.cmd run test:unit -- --run tests/integration/orchestrator.test.ts`

The test `repairs failed generated logic and reruns verification without human input` performs:

1. Logic, level, and art workers return complete artifacts; the logic fixture uses an intentionally wrong victory policy.
2. Verification attempt 0 returns a logic-owned failure.
3. The orchestrator invokes the repair worker with the current logic and failure.
4. It validates a complete replacement, saves before/after/diff, and reintegrates.
5. Verification attempt 1 passes and the run becomes `verified`.

The companion test `stops after three rejected repairs and never dispatches a fourth` asserts the fixed retry cap. These are deterministic fixture tests and are not labeled as live OpenRouter activity.
