# Curated evidence

- `reference/verify.json`: offline reference verifier result.
- `reference/harness-summary.md`: the commands and observed browser coverage for that result.
- `autonomous-repair-loop.md`: provenance and assertions for the genuine implementation repair and injected game-policy recovery test.
- `screenshots/`: reference-game captures produced by Playwright and labeled as fixture evidence, including dash and damage animation frames.
- `LIVE-RUNS.md`: provenance, model, timing, cost, visual review, and recovery summary for three credentialed runs.
- `live-greenhouse/`, `live-moon/`, and `live-storm/`: redacted live reports, event timelines, verification results, specifications, and screenshots. Storm also contains the complete labeled fault, repair diff, and passing rerun.
- `AUTONOMOUS-REPAIR.md`: judge-facing walkthrough of the live Storm repair chain and its inspectable artifacts.
- `live-recovery/`: preserved failed live run showing the hardcoded-title harness defect before the autonomous implementation repair.
- `REPRODUCTION.md`: clean-checkout install and complete verifier result for the release commit.

No credential or raw environment file is included. Each live report identifies its provenance and returned model/provider metadata.
