# Live OpenRouter runs

All three runs used `openai/gpt-oss-20b` with low reasoning and strict structured outputs for specification, logic, level, and repair work. Art used `google/gemini-2.5-flash-image`; trusted code normalized each generated entity into a transparent 64 by 64 PNG. OpenRouter selected providers per request. Cost values below are the API's reported cost for retained successful responses; retries count toward `requestCount` but OpenRouter does not return their usage in the final response object.

| Game | Run | Result | Requests | Active time | Reported cost |
| --- | --- | --- | ---: | ---: | ---: |
| Greenhouse Rescue | `20260909T211322Z-64f94916` | 11/11 stages passed | 7 | 65.748 s | $0.15537234 |
| Moon Base Rescue | `20260909T211338Z-c0505a5e` | 11/11 stages passed | 8 | 70.299 s | $0.15533400 |
| Storm Courier | `20260911T202329Z-7ce1108f` | Attempt 0 failed; model repair; attempt 1 passed 11/11 | 9 | 85.465 s | $0.15576089 |

The logic and level workers overlap with the four-request art workstream in every `events.jsonl` timeline. In Storm, all three workers began within 39 ms. Logic completed after 2.916 s, level after one correction at 15.417 s, and art after 27.559 s. These are actual completion timestamps emitted as each worker settled. The games differ in collection order, movement, objective mode, enemy behavior, pressure, level placement, palette, names, and generated sprites.

Visual inspection found readable HUD text, sufficient foreground/background contrast, distinct entity silhouettes, and visible theme differences. Automated screenshots cover initial, active, win, and loss states. A human full-level completion remains a release check because the automated actual-level bot intentionally proves only one reachable collectible.

The preceding failed run `20260909T172814Z-3cb38f89` exposed a hardcoded reference title in PLAY-01. The autonomous implementation agent observed the mismatch, changed the test to use the active approved spec, corrected failure ownership, ran the full reference harness, and produced the two passing live runs without another human prompt.

Storm is a repeatable, labeled injected-fault demonstration. After preserving the valid generated logic, the orchestrator inserted an exit-unaware victory rule. Attempt 0 failed `PLAY-07`; the classifier assigned it to logic; a real `openai/gpt-oss-20b` repair call returned a complete replacement; and attempt 1 passed contracts, type checks, 131 unit/integration tests, both builds, asset validation, all 14 browser tests, production smoke, and protected-file checks. No human prompt occurred from generation start through verification success. See `AUTONOMOUS-REPAIR.md` and `live-storm/`.
