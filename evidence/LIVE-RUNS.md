# Live OpenRouter runs

Both runs used `openai/gpt-oss-20b` with low reasoning and strict structured outputs for specification, logic, and level work. Art used `google/gemini-2.5-flash-image`; trusted code normalized each generated entity into a transparent 64 by 64 PNG. OpenRouter selected providers per request. Cost values below are the API's reported cost for retained successful responses; retries count toward `requestCount` but OpenRouter does not return their usage in the final response object.

| Game | Run | Result | Requests | Active time | Reported cost |
| --- | --- | --- | ---: | ---: | ---: |
| Greenhouse Rescue | `20260909T211322Z-64f94916` | 11/11 stages passed | 7 | 65.748 s | $0.15537234 |
| Moon Base Rescue | `20260909T211338Z-c0505a5e` | 11/11 stages passed | 8 | 70.299 s | $0.15533400 |

The logic and level workers overlap with the four-request art workstream in both `events.jsonl` timelines. The generated games differ in collection count, objective mode, enemy behavior, level placement, palette, names, and image-generated pixel sprites.

Visual inspection found readable HUD text, sufficient foreground/background contrast, distinct entity silhouettes, and visible theme differences. Automated screenshots cover initial, active, win, and loss states. A human full-level completion remains a release check because the automated actual-level bot intentionally proves only one reachable collectible.

The preceding failed run `20260909T172814Z-3cb38f89` exposed a hardcoded reference title in PLAY-01. The autonomous implementation agent observed the mismatch, changed the test to use the active approved spec, corrected failure ownership, ran the full reference harness, and produced the two passing live runs without another human prompt.
