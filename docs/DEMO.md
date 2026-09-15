# Three-minute demo script

Target length: 2:50 to 2:58. The competition requires the first 90 seconds to show the product and the final 90 seconds to explain the agentic engineering system.

## Before recording

1. Start the control page with `npm.cmd run control` and open `http://127.0.0.1:4300`.
2. Open the verified Storm Courier run `20260911T202329Z-7ce1108f` in the control page.
3. Open the public gallery at <https://farrej10.github.io/GameMakersHarness/> in a second tab.
4. Open `evidence/live-storm/report.html` and `docs/SYSTEM.md` in two more tabs.
5. Set browser zoom so the game, worker timeline, and verification results are readable.
6. Record the narration separately if that makes it easier to keep the timing precise.
7. Label saved evidence `RECORDED LIVE RUN`. Label the repair sequence `INJECTED-FAULT DEMONSTRATION`. Never present either as activity occurring during the recording.

## Exact recording script

### 0:00–0:15 — Hook

**Show:** Storm Courier already running. Dash past an enemy and collect a shrine.

**Say:**

> This is Agentic Game Maker. Give it a short game idea and it coordinates specialized agents to produce a playable browser game, test the actual gameplay, and repair failures without waiting for another human prompt.

### 0:15–0:35 — From description to approved design

**Show:** Control page with the Storm prompt, design summary, and exact specification. Briefly point to dash movement, ordered collection, survival objective, and guard enemies.

**Say:**

> I asked for a storm courier dashing between numbered lightning shrines while sentinels guard the routes. The specification agent turned that into bounded mechanics and a distinct identity. I can edit the result, but generation starts only after I approve this exact specification.

### 0:35–1:05 — Play the result

**Show:** Gameplay. Demonstrate movement, dash animation, ordered collection, a damage reaction, the visible survival timer, and the exit. A short montage is fine.

**Say:**

> The result has keyboard movement, a cooldown dash, ordered objectives, guarding enemies, health, scoring, a survival timer, and win and loss states. The runtime also adds dash trails, collection bursts, and hit feedback selected from the game’s visual profile. This is a static browser build; players never need my API key.

### 1:05–1:20 — Breadth inside a controlled scope

**Show:** Public gallery. Switch briefly between Greenhouse Rescue, Moon Base Rescue, and Storm Courier.

**Say:**

> The toolkit stays inside a reliable top-down action collection family, but these games vary movement, enemy behavior, objectives, level layout, pressure, palette, and generated art. That controlled scope makes the output both varied and testable.

### 1:20–1:30 — Human-directed iteration

**Show:** Click **Adjust only enemy** on the verified Storm run. Enter a short instruction, but do not submit it during the recording. Point to **Regenerate agents with changed instructions**.

**Say:**

> I can still direct a verified result. Changing only the enemy art reruns one image request, reuses every unchanged output, and preserves the original verified build as evidence.

### 1:30–1:48 — System design and context boundaries

**Show:** The system diagram at the top of `docs/SYSTEM.md`.

**Say:**

> Behind the interface is a deterministic orchestrator. The spec agent defines intent. Logic receives mechanics, level receives placement constraints, and art receives the visual contract. Outputs must pass strict schemas before trusted code integrates them.

### 1:48–2:05 — Real parallel coordination

**Show:** Storm report worker timeline. Highlight overlapping logic, level, and art intervals.

**Say:**

> Logic, level, and art are independent, so the orchestrator starts them concurrently. In this recorded run, all three began within thirty-nine milliseconds. Logic completed in 2.9 seconds, level in 15.4, and art in 27.6. These are persisted timestamps.

### 2:05–2:38 — Autonomous failure and recovery

**Show:** The `injected-fault` label, failed attempt 0 with `PLAY-07`, repair ownership, before-and-after diff, and passed attempt 1. Keep `INJECTED-FAULT DEMONSTRATION` visible.

**Say:**

> Here is the autonomous loop. Demonstration mode preserved the generated logic and injected a labeled, exit-unaware victory rule. The browser harness failed PLAY-07. The orchestrator routed it to logic, sent the current artifact and exact failure to the repair model, validated the replacement, reintegrated it, and ran the complete harness again. Attempt one passed. No human prompt occurred during recovery, and the loop stops after three attempts.

### 2:38–2:52 — Deterministic back pressure

**Show:** Verification results with contracts, types, unit suite, builds, assets, browser suite, production smoke, and protected checks passing.

**Say:**

> Models provide judgment; deterministic controls provide guarantees. One command checks contracts, types, tests, builds, assets, browser gameplay, production loading, and protected files. A model cannot edit the harness that judges it.

### 2:52–3:00 — Close

**Show:** Public URL and GitHub repository side by side.

**Say:**

> Agentic Game Maker turns one human decision into coordinated, verified work. The games, code, event logs, repair evidence, and reproduction steps are public.

## Optional cuts if the recording runs long

Cut these in order:

1. From 1:05, remove the list after “these games vary.”
2. From 1:30, remove “Their JSON and TypeScript outputs are schema validated.”
3. From 2:38, shorten the checks to “contracts, builds, gameplay, assets, and protected files.”

Do not cut the parallel timing, failed `PLAY-07`, owner routing, passing second attempt, or absence of a human prompt. Those directly address the two largest judging categories.

## On-screen labels

- `RECORDED LIVE OPENROUTER RUN`
- `INJECTED-FAULT DEMONSTRATION`
- `ATTEMPT 0: FAILED PLAY-07`
- `LOGIC OWNER → MODEL REPAIR → FULL RE-VERIFY`
- `ATTEMPT 1: 11/11 STAGES PASSED`
- `NO HUMAN PROMPT DURING RECOVERY`

## Submission links

- Product: <https://farrej10.github.io/GameMakersHarness/>
- Repository: <https://github.com/farrej10/GameMakersHarness>
- System map: `docs/SYSTEM.md`
- Autonomous repair map: `evidence/AUTONOMOUS-REPAIR.md`
- Live-run comparison: `evidence/LIVE-RUNS.md`

## Final recording checks

- The final export is no longer than three minutes.
- Text remains readable at normal playback size.
- No `.env`, API key, request authorization header, or unrelated browser tab appears.
- The first 90 seconds show the working product.
- The final 90 seconds show context boundaries, parallel orchestration, verification, and autonomous recovery.
- Recorded and injected evidence remains visibly labeled.
- Audio is clear and the final URLs remain visible long enough to read.
