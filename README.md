# Agentic Game Maker Toolkit

Agentic Game Maker converts a short description into a playable game from a bounded top-down action-collection family. Specialized OpenRouter workers choose a game identity and compatible movement, collection, threat, objective, layout, and pressure mechanics; trusted code validates and integrates their rules, level, and pixel art, runs browser gameplay tests, and performs at most three owner-routed repair attempts without another human prompt.

The deterministic runtime, validation harness, orchestrator, repair loop, reports, CLI, and local control page are implemented. Three distinct live OpenRouter games pass the complete harness and are exported under `release/`; Storm Courier also records a complete model-driven failure, repair, and passing rerun. Human full-level playthroughs and the final video remain release gates.

## Requirements

- Node.js 24.x. Tested with Node 24.16.0 and npm 11.13.0.
- Playwright Chromium.
- An OpenRouter API key and an explicitly selected structured-output-capable model for new generation.
- Windows PowerShell users on this machine should invoke `npm.cmd` and `npx.cmd` because PowerShell blocks the `.ps1` npm launcher.

Install and verify from the project root:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run verify
```

`npm run verify` uses the committed Greenhouse reference fixture and does not require network access or an API key. It validates contracts and protected files, type-checks trusted and generated source, runs unit tests, creates isolated test and production builds, decodes assets, runs gameplay checks, captures evidence, and performs a production smoke test.

## OpenRouter configuration

Copy `.env.example` to `.env` and fill it locally:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=provider/model-id
OPENROUTER_SPEC_MODEL=
OPENROUTER_LOGIC_MODEL=
OPENROUTER_LEVEL_MODEL=
OPENROUTER_ART_MODEL=
OPENROUTER_REPAIR_MODEL=
```

Blank role overrides inherit `OPENROUTER_MODEL`. Keep `.env` local; it is ignored. Validate Node, dependencies, Chromium, credentials, the current model ID, and advertised structured-output support without sending a completion:

```powershell
npm.cmd run doctor
```

OpenRouter model availability changes. Choose a concrete inexpensive model, run `doctor`, and preserve the returned model/provider and measured results in the generated execution report rather than treating any model as permanently preferred.

## Generate a game with the CLI

Create and review the specification:

```powershell
npm.cmd run game:spec -- --prompt-file examples/greenhouse.txt
```

The command prints the run ID and exact SHA-256. Approve those unchanged bytes:

```powershell
npm.cmd run game:approve -- --run <run-id> --hash <printed-hash>
```

Generate, integrate, verify, and autonomously repair eligible generated-artifact failures:

```powershell
npm.cmd run game:generate -- --run <run-id>
```

For a repeatable, transparently labeled demonstration of the same repair path, inject a valid but incorrect victory policy after preserving the original logic:

```powershell
npm.cmd run game:generate -- --run <run-id> --demo-fault logic-victory
```

The real browser harness must fail, the configured OpenRouter repair model receives the owned failure and current artifact, and the full harness must pass before the run is marked verified. Reports label this provenance as `injected-fault`.

Inspect `runs/<run-id>/report.html`. A verified run has a self-contained static build under `runs/<run-id>/build/`. Serve it locally with:

```powershell
npm.cmd run game:serve -- --root runs/<run-id>/build --port 4173
```

The exported build does not require an OpenRouter key.

Generated games can combine standard, stamina sprint, or cooldown dash movement; touch or ordered collection; chase, horizontal patrol, vertical patrol, or guard enemies; collection, collection-and-exit, or survival-and-exit objectives; four placement layouts; and rising-danger or darkness themes. The specification gate requires an identity brief and at least three material choices beyond the plain template.

## Optional local control page

```powershell
npm.cmd run control
```

Open `http://127.0.0.1:4300`. The page shows the proposed fantasy and mechanic choices, exact spec approval, live logic/level/art and repair states, report access, and a verified-game preview. Its optional “Demonstrate autonomous repair” checkbox enables the labeled fault above. Mutations require the loopback page origin. The game runs on a separate static origin, and credentials stay in the Node process.

## Important directories

- `src/contracts/`: strict TypeBox/Ajv contracts.
- `src/runtime/`: pure fixed-step game simulation.
- `src/game/`: Phaser renderer, keyboard input, and test-only debug adapter.
- `src/toolkit/`: validation, OpenRouter, workers, orchestration, repair, reporting, and local servers.
- `tests/`: unit, integration, browser, reference, and injected-fault fixtures.
- `runs/`: ignored per-run prompts, responses, builds, and evidence.
- `evidence/`: curated evidence suitable for review.
- `docs/`: specification, system design, verification map, implementation cards, development log, and demo script.

## Current evidence status

- Offline reference verification passes.
- Unit and integration tests demonstrate overlapping worker calls, fixed-path integration, approval invalidation, art fallback, protected-file detection, and a bounded autonomous logic repair.
- A real implementation failure and repair is recorded in `docs/AI-DEV-LOG.md`.
- Live OpenRouter runs `20260909T211322Z-64f94916`, `20260909T211338Z-c0505a5e`, and `20260911T202329Z-7ce1108f` use generated 64 by 64 image art and pass every verification stage. Storm’s curated report records the injected `PLAY-07` failure, one model repair, and the passing rerun under `evidence/live-storm/`.
- `release/` contains a static three-game site ready for GitHub Pages, with deployment automation in `.github/workflows/pages.yml`.
- Public playable site: <https://farrej10.github.io/GameMakersHarness/>. Verify the deployed landing page and both games with `npm.cmd run check:public -- https://farrej10.github.io/GameMakersHarness/`.
- A clean clone of release commit `8e19f60` completed `npm.cmd ci` with 0 vulnerabilities and passed the full verifier; see `evidence/REPRODUCTION.md`.
- Human full-level playthroughs and the final three-minute video remain pending.
