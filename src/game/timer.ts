import type { GameSpec } from '../contracts/index';

export function timerDisplay(spec: GameSpec, elapsedTicks: number): { hidden: boolean; text: string } {
  const survivalTicks = spec.objective.mode === 'survive' || spec.objective.mode === 'survive-then-exit'
    ? spec.objective.survivalTicks
    : spec.objective.mode === 'custom'
      ? spec.objective.survivalTicks
      : null;
  const survival = survivalTicks !== null;
  const mode = spec.timer?.mode ?? (survival ? 'objective-countdown' : 'hidden');
  if (mode === 'hidden') return { hidden: true, text: '' };
  let ticks = elapsedTicks;
  if (mode === 'objective-countdown' && survivalTicks !== null) {
    ticks = Math.max(0, survivalTicks - elapsedTicks);
  }
  const seconds = mode === 'objective-countdown' ? Math.ceil(ticks / 60) : Math.floor(ticks / 60);
  const label = spec.timer?.label ?? 'Time';
  return {
    hidden: false,
    text: `${label}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  };
}
