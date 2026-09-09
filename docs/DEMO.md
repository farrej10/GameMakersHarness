# Demo and submission plan

Use the attached organizer brief as the judging source. Its listed submission deadline is September 14, 2026; the actual submission URL was a placeholder in that attachment. Confirm final organizer instructions before submitting. Do not invent a link or claim submission happened.

## Three-minute video

| Time | Show | Explain |
| --- | --- | --- |
| 0:00-0:20 | Supported prompt and readable spec approval | A user describes a small game and approves what will be built |
| 0:20-1:05 | Play the generated game: movement, collection, damage, victory | The output is an actual playable game |
| 1:05-1:30 | Second generated example and static export | Same system produces different behavior, layout, and theme |
| 1:30-1:50 | Exact contracts, bounded contexts, actual worker overlap | Independent workers own small outputs and integrate through contracts |
| 1:50-2:35 | Real failure, diagnosis, source change, passing rerun | The system detects and repairs a failure without another human prompt |
| 2:35-3:00 | Protected checks, retry limit, human choices, reproduction | Autonomy has observable limits and the result can be reproduced |

Use clearly labeled time compression or recorded runs where generation exceeds the video duration. Do not display replayed events as if they are live model activity. Fixture screenshots and injected faults must be labeled.

### Exact recording sequence

1. Start `npm.cmd run control` and open `http://127.0.0.1:4300`.
2. Paste `examples/greenhouse.txt`, create the spec, show its constrained fields and hash, and approve it.
3. Start generation. Time-compress the waiting period with a visible label.
4. Open the verified build from the report and demonstrate movement, collection, damage, and the win state.
5. Open the second completed live run created from `examples/moon.txt` and show its different theme, level, enemy behavior, and objective.
6. Show the report worker timeline, request/model metadata, initial failed check, before/after diff, passing rerun, and three-repair cap test.
7. End on `npm.cmd run verify`, the public playable URL, and the repository URL.

The two credentialed runs now exist under `evidence/live-greenhouse/` and `evidence/live-moon/`; their reports and screenshots may be shown as live evidence. Screenshots under `evidence/screenshots/` remain reference fixtures and require a persistent `REFERENCE FIXTURE` label.

If the optional UI is absent, use the CLI for prompt/approval and the static HTML report for orchestration/repair evidence. Do not sacrifice the working harness to build a dashboard for the video.

## Required submission checklist

- [x] Clear project name.
- [x] One-to-two sentence product description.
- [x] Public accessible playable browser example: <https://farrej10.github.io/GameMakersHarness/>.
- [x] GitHub repository containing implementation and lockfile: <https://github.com/farrej10/GameMakersHarness>.
- [x] `docs/SPEC.md` updated to reflect final shipped behavior.
- [x] `docs/SYSTEM.md` with actual context boundaries and parallelization evidence.
- [x] Actual harness scripts and tests, with reproduction commands.
- [x] At least one complete autonomous implementation loop with inspectable provenance.
- [x] `docs/AI-DEV-LOG.md` with failures, corrections, and human decisions.
- [x] README with exact tested setup, env variables, API/backend requirements, and exported-play instructions.
- [ ] Shareable video of at most three minutes.
- [x] Current offline evidence links resolve and contains no credentials.
- [x] Two credentialed live games and their static exports pass the complete harness.
- [x] Clean-checkout lockfile install and verification reproduced.

## Submission description draft

Agentic Game Maker turns a short supported description into a playable browser survival game using specialized OpenRouter workers. Its harness tests gameplay, routes failures back to the responsible worker, and records bounded autonomous repairs in an inspectable execution report.

This description matches the implemented and credentialed toolkit. Submission still requires human full-level playthroughs, a public URL, repository publication, and the recorded video.
