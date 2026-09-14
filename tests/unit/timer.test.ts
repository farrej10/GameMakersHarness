import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameSpec } from '../../src/contracts/index';
import { timerDisplay } from '../../src/game/timer';

const reference = JSON.parse(
  readFileSync(new URL('../fixtures/reference/game-spec.json', import.meta.url), 'utf8'),
) as GameSpec;

describe('timer display', () => {
  it('shows an exact survival countdown and reaches zero', () => {
    const spec: GameSpec = {
      ...reference,
      objective: { mode: 'survive', survivalTicks: 1800 },
      timer: { mode: 'objective-countdown', label: 'Dread' },
    };
    expect(timerDisplay(spec, 0)).toEqual({ hidden: false, text: 'Dread: 0:30' });
    expect(timerDisplay(spec, 1799)).toEqual({ hidden: false, text: 'Dread: 0:01' });
    expect(timerDisplay(spec, 1800)).toEqual({ hidden: false, text: 'Dread: 0:00' });
  });

  it('keeps legacy non-timed games uncluttered', () => {
    expect(timerDisplay(reference, 600)).toEqual({ hidden: true, text: '' });
  });
});
