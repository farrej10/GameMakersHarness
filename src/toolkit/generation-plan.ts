import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stableJson } from './cli';

export type GenerationRole = 'logic' | 'level' | 'art';
export type ArtAssetId = 'player' | 'collectible' | 'enemy' | 'exit';

export type GenerationPlan = {
  sourceRunId: string;
  rerunRoles: GenerationRole[];
  artAssetIds: ArtAssetId[] | null;
};

export function writeGenerationPlan(runRoot: string, plan: GenerationPlan): void {
  writeFileSync(path.join(runRoot, 'generation-plan.json'), stableJson(plan));
}

export function readGenerationPlan(runRoot: string): GenerationPlan | null {
  const file = path.join(runRoot, 'generation-plan.json');
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<GenerationPlan>;
  const validRoles = ['logic', 'level', 'art'];
  const validAssets = ['player', 'collectible', 'enemy', 'exit'];
  if (
    typeof value.sourceRunId !== 'string' ||
    !Array.isArray(value.rerunRoles) ||
    value.rerunRoles.some((role) => !validRoles.includes(role)) ||
    !(value.artAssetIds === null || (
      Array.isArray(value.artAssetIds) &&
      value.artAssetIds.length > 0 &&
      value.artAssetIds.every((id) => validAssets.includes(id))
    ))
  ) {
    throw new Error('Saved generation plan is invalid.');
  }
  return value as GenerationPlan;
}
