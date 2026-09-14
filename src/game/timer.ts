import type { GameSpec } from '../contracts/index';

export function timerDisplay(spec: GameSpec, elapsedTicks: number): { hidden: boolean; text: string } {
  const survival = spec.objective.mode === 'survive' || spec.objective.mode === 'survive-then-exit';
  const mode = spec.timer?.mode ?? (survival ? 'objective-countdown' : 'hidden');
  if (mode === 'hidden') return { hidden: true, text: '' };
  let ticks = elapsedTicks;
  if (mode === 'objective-countdown' && (
    spec.objective.mode === 'survive' || spec.objective.mode === 'survive-then-exit'
  )) {
    ticks = Math.max(0, spec.objective.survivalTicks - elapsedTicks);
  }
  const seconds = mode === 'objective-countdown' ? Math.ceil(ticks / 60) : Math.floor(ticks / 60);
  const label = spec.timer?.label ?? 'Time';
  return {
    hidden: false,
    text: `${label}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  };
}
