import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ArtOutput, GameSpec, LevelOutput, LogicOutput, RasterArtOutput } from '../contracts/index';
import { stableJson } from './cli';
import { normalizeImageTo64, renderArtOutput, type AssetId } from './render-pixels';
import { validateArtArtifact, validateLevelArtifact, validateLogicArtifact } from './validate';

export type ReviewArtifacts = {
  logic: LogicOutput;
  level: LevelOutput;
  art: ArtOutput;
};

const roles = ['logic', 'level', 'art'] as const;
export type ReviewRole = (typeof roles)[number];

function reviewRoot(runRoot: string): string {
  return path.join(runRoot, 'review');
}

function currentPath(runRoot: string, role: ReviewRole): string {
  return path.join(reviewRoot(runRoot), 'current', `${role}.json`);
}

function validate(role: ReviewRole, value: unknown, spec: GameSpec): string[] {
  const issues = role === 'logic'
    ? validateLogicArtifact(value)
    : role === 'level'
      ? validateLevelArtifact(spec, value)
      : validateArtArtifact(value);
  return issues.map(({ code, instancePath, message }) => `${instancePath || '/'} ${code}: ${message}`);
}

export function writeReviewArtifacts(runRoot: string, artifacts: ReviewArtifacts): void {
  const current = path.join(reviewRoot(runRoot), 'current');
  mkdirSync(current, { recursive: true });
  for (const role of roles) writeFileSync(currentPath(runRoot, role), stableJson(artifacts[role]));
}

export function readReviewArtifacts(runRoot: string): ReviewArtifacts {
  return Object.fromEntries(roles.map((role) => [
    role,
    JSON.parse(readFileSync(currentPath(runRoot, role), 'utf8')),
  ])) as ReviewArtifacts;
}

export function reviseReviewArtifact(
  runRoot: string,
  role: ReviewRole,
  value: unknown,
  spec: GameSpec,
): { revision: number; artifactPath: string } {
  const errors = validate(role, value, spec);
  if (errors.length) throw new Error(`${role} artifact is invalid: ${errors.join('; ')}`);
  const revisionsRoot = path.join(reviewRoot(runRoot), 'revisions', role);
  mkdirSync(revisionsRoot, { recursive: true });
  const revision = existsSync(revisionsRoot)
    ? readdirSync(revisionsRoot).filter((name) => /^revision-\d+\.json$/u.test(name)).length + 1
    : 1;
  const relative = `review/revisions/${role}/revision-${revision}.json`;
  writeFileSync(path.join(runRoot, relative), stableJson(value));
  writeFileSync(currentPath(runRoot, role), stableJson(value));
  return { revision, artifactPath: relative };
}

export function artPreviewData(art: ArtOutput, palette: readonly string[]): Record<AssetId, string> {
  return Object.fromEntries(
    [...renderArtOutput(art, palette)].map(([id, png]) => [id, `data:image/png;base64,${png.toString('base64')}`]),
  ) as Record<AssetId, string>;
}

export function replaceReviewSprite(
  runRoot: string,
  assetId: AssetId,
  png: Buffer,
  spec: GameSpec,
): { revision: number; artifactPath: string } {
  const current = readReviewArtifacts(runRoot);
  const rendered = renderArtOutput(current.art, spec.theme.palette);
  const normalized = normalizeImageTo64(png);
  const art: RasterArtOutput = {
    schemaVersion: 1,
    format: 'png-64',
    sprites: [...rendered].map(([id, image]) => ({
      id,
      width: 64,
      height: 64,
      mimeType: 'image/png',
      pngBase64: (id === assetId ? normalized : image).toString('base64'),
    })),
  };
  return reviseReviewArtifact(runRoot, 'art', art, spec);
}
