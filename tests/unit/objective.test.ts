import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameSpec } from '../../src/contracts/index';
import { shouldShowExit } from '../../src/game/objective';

const reference = JSON.parse(
  readFileSync(new URL('../fixtures/reference/game-spec.json', import.meta.url), 'utf8'),
) as GameSpec;

describe('objective presentation', () => {
  it('hides the exit only for pure survival', () => {
    expect(shouldShowExit({
      ...reference,
      objective: { mode: 'survive', survivalTicks: 1800 },
    })).toBe(false);
    expect(shouldShowExit(reference)).toBe(true);
    expect(shouldShowExit({
      ...reference,
      objective: { mode: 'survive-then-exit', survivalTicks: 1800 },
    })).toBe(true);
    expect(shouldShowExit({
      ...reference,
      objective: {
        mode: 'custom',
        winCondition: 'Reach the exit or collect everything.',
        survivalTicks: null,
      },
    })).toBe(true);
  });
});
