# Live OpenRouter runs

Both runs used `openai/gpt-oss-20b` with low reasoning and strict structured outputs on 2026-09-09. OpenRouter selected providers per request. Cost values below are the API's reported cost for retained successful responses; retries count toward `requestCount` but OpenRouter does not return their usage in the final response object.

| Game | Run | Result | Requests | Active time | Reported cost |
| --- | --- | --- | ---: | ---: | ---: |
| Greenhouse Maintenance | `20260909T173352Z-9f60806e` | 11/11 stages passed | 5 | 43.353 s | $0.00036471 |
| Moon Base Rescue | `20260909T173519Z-7e7412f3` | 11/11 stages passed | 4 | 51.940 s | $0.00024107 |

The logic, level, and art worker intervals overlap in both `events.jsonl` timelines. The generated games differ in collection count, objective mode, enemy behavior, level placement, palette, names, and pixel sprites.

Visual inspection found readable HUD text, sufficient foreground/background contrast, distinct entity silhouettes, and visible theme differences. Automated screenshots cover initial, active, win, and loss states. A human full-level completion remains a release check because the automated actual-level bot intentionally proves only one reachable collectible.

The preceding failed run `20260909T172814Z-3cb38f89` exposed a hardcoded reference title in PLAY-01. The autonomous implementation agent observed the mismatch, changed the test to use the active approved spec, corrected failure ownership, ran the full reference harness, and produced the two passing live runs without another human prompt.
