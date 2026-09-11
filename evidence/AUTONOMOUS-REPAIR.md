# Live autonomous repair: Storm Courier

Run `20260911T202329Z-7ce1108f` demonstrates the complete bounded loop with credentialed OpenRouter workers. The demonstration mode is explicit and recorded as provenance `injected-fault`; it does not claim the defect appeared naturally.

1. Logic, level, and art started in parallel after approval of spec hash `f529eb7d2b12f48b317b5192d602687eae4fd3c606c98e0fbd7508d3d9c56e01`.
2. The orchestrator preserved the original generated logic, then injected a valid but exit-unaware victory function.
3. Verification attempt 0 failed browser check `PLAY-07`, while contracts, protected files, type checks, unit tests, builds, and assets passed.
4. Ownership rules routed `PLAY-07` to the logic repair worker. OpenRouter returned model `openai/gpt-oss-20b` through provider Darkbloom.
5. The replacement restored separate rules for `survive-then-exit`, `collect-all`, and `collect-then-exit`. The trusted validator accepted it and the orchestrator reintegrated it.
6. Verification attempt 1 passed every required stage and the run entered `verified`.

Inspect the chain in:

- `live-storm/events.jsonl` for ordered timestamps.
- `live-storm/evidence/demo-fault/` for original and injected logic.
- `live-storm/evidence/attempt-0/verify.json` for the owned failure.
- `live-storm/evidence/attempt-1/before/`, `after/`, and `change.diff` for the repair.
- `live-storm/evidence/attempt-1/verify.json` for the passing rerun.
- `live-storm/report.html` for the rendered execution report.

No human prompt or callback exists between steps 2 and 6. The fixed loop allows at most three repair iterations and stops on unowned or protected-harness failures.
