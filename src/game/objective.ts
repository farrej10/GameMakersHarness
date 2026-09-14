import type { GameSpec } from '../contracts/index';

export function shouldShowExit(spec: GameSpec): boolean {
  return spec.objective.mode !== 'survive';
}
