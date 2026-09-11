import type { AnimationProfile, GameSpec } from '../contracts/index';
import { SIMULATION_HZ } from '../runtime/step';

export const DEFAULT_ANIMATION_PROFILE: AnimationProfile = {
  dash: { style: 'afterimage', durationMs: 180, color: '#7DE2D1' },
  damage: {
    style: 'flash',
    durationMs: 240,
    color: '#FF5C5C',
    cameraShake: 0.004,
  },
  collection: { style: 'pop', durationMs: 260, color: '#FFD166' },
};

export function resolvedAnimationProfile(spec: GameSpec): AnimationProfile {
  return spec.animationProfile ?? DEFAULT_ANIMATION_PROFILE;
}

export function animationTicks(durationMs: number): number {
  return Math.max(1, Math.ceil((durationMs / 1_000) * SIMULATION_HZ));
}
