# Demo and submission plan

Use the attached organizer brief as the judging source. Its listed submission deadline is September 14, 2026; the actual submission URL was a placeholder in that attachment. Confirm final organizer instructions before submitting. Do not invent a link or claim submission happened.

## Three-minute video

| Time | Show | Explain |
| --- | --- | --- |
| 0:00-0:20 | Storm prompt, mechanic summary, and exact spec approval | A user describes a game and sees the distinct choices before approving it |
| 0:20-0:45 | Live worker cards, then the report timeline | Logic, level, and art run concurrently and finish at their actual times |
| 0:45-1:25 | Play Storm Courier: animated dash, collection burst, hit reaction, ordered shrines, guarding enemies, survival exit | The output has a specific identity, responsive feedback, and combined mechanics |
| 1:25-1:45 | Greenhouse and Moon exports | The same constrained system produces materially different games |
| 1:45-2:35 | Labeled fault, failed `PLAY-07`, model diff, passing attempt 1 | The harness routes an owned failure and repairs it without another prompt |
| 2:35-3:00 | Protected checks, retry limit, human choices, reproduction | Autonomy has observable limits and the result can be reproduced |

Use clearly labeled time compression or recorded runs where generation exceeds the video duration. Do not display replayed events as if they are live model activity. Fixture screenshots and injected faults must be labeled.

### Exact recording sequence

1. Start `npm.cmd run control` and open `http://127.0.0.1:4300`.
2. Paste `examples/storm.txt`, create the spec, show the fantasy and mechanic chips plus exact JSON and hash, and approve it.
3. Select “Demonstrate autonomous repair” and start generation. Time-compress the waiting period with a visible label while retaining the visible worker-state transitions.
4. Open the verified build from the report and demonstrate the dash trail, collection burst, hit reaction, ordered collection, a guarding sentinel, survival pressure, and the exit objective.
5. Open the Greenhouse and Moon builds briefly to show different movement, collection, enemy behavior, objective, layout, and art.
6. Show Storm’s report timeline, `injected-fault` label, failed `PLAY-07`, before/after diff, OpenRouter repair metadata, passing attempt 1, and the three-repair cap test.
7. End on `npm.cmd run verify`, the public playable URL, and the repository URL.

Three credentialed runs now exist under `evidence/live-greenhouse/`, `evidence/live-moon/`, and `evidence/live-storm/`; their reports and screenshots may be shown as live evidence. Storm’s injected defect must retain the visible `injected-fault` label. Screenshots under `evidence/screenshots/` remain reference fixtures and require a persistent `REFERENCE FIXTURE` label.

If the optional UI is absent, use the CLI for prompt/approval and the static HTML report for orchestration/repair evidence. Do not sacrifice the working harness to build a dashboard for the video.

## Required submission checklist

- [x] Clear project name.
- [x] One-to-two sentence product description.
- [x] Public accessible playable browser example: <https://farrej10.github.io/GameMakersHarness/>.
- [x] GitHub repository containing implementation and lockfile: <https://github.com/farrej10/GameMakersHarness>.
- [x] `docs/SPEC.md` updated to reflect final shipped behavior.
- [x] `docs/SYSTEM.md` with actual context boundaries and parallelization evidence.
- [x] Actual harness scripts and tests, with reproduction commands.
- [x] A complete live model repair loop with inspectable, labeled provenance.
- [x] `docs/AI-DEV-LOG.md` with failures, corrections, and human decisions.
- [x] README with exact tested setup, env variables, API/backend requirements, and exported-play instructions.
- [ ] Shareable video of at most three minutes.
- [x] Current offline evidence links resolve and contains no credentials.
- [x] Three credentialed live games and their static exports pass the complete harness.
- [x] Clean-checkout lockfile install and verification reproduced.

## Submission description draft

Agentic Game Maker turns a short supported description into a playable browser survival game using specialized OpenRouter workers. Its harness tests gameplay, routes failures back to the responsible worker, and records bounded autonomous repairs in an inspectable execution report.

This description matches the implemented and credentialed toolkit. Submission still requires human full-level playthroughs and the recorded video.
