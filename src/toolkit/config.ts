import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ModelRequest } from './openrouter';

export type WorkerRole = ModelRequest['role'];
export type ToolkitLimits = {
  parallelWorkers: number;
  maxRequests: number;
  requestTimeoutMs: number;
  activeBudgetMs: number;
  maxRepairIterations: number;
  maxInitialCorrections: number;
  contextBytes: number;
  schemaBytes: number;
  outputTokens: Record<WorkerRole, number>;
};

export type ToolkitConfig = {
  apiKey: string;
  models: Record<WorkerRole, string>;
  limits: ToolkitLimits;
};

export const DEFAULT_LIMITS: ToolkitLimits = {
  parallelWorkers: 3,
  maxRequests: 16,
  requestTimeoutMs: 90_000,
  activeBudgetMs: 15 * 60_000,
  maxRepairIterations: 3,
  maxInitialCorrections: 1,
  contextBytes: 24_000,
  schemaBytes: 24_000,
  outputTokens: {
    spec: 2_500,
    level: 3_000,
    art: 3_000,
    logic: 4_096,
    repair: 4_096,
  },
};

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

export function readLocalEnvironment(cwd = process.cwd()): Record<string, string> {
  const filePath = path.join(cwd, '.env');
  return existsSync(filePath) ? parseEnvFile(readFileSync(filePath, 'utf8')) : {};
}

export function loadToolkitConfig(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requireApiKey?: boolean;
  requireModels?: boolean;
} = {}): ToolkitConfig {
  const cwd = options.cwd ?? process.cwd();
  const fileValues = readLocalEnvironment(cwd);
  const environment: Record<string, string | undefined> = { ...fileValues };
  for (const [name, value] of Object.entries(options.env ?? process.env)) {
    // Empty inherited variables must not erase a value configured in .env.
    if (value?.trim()) environment[name] = value;
  }
  const apiKey = environment.OPENROUTER_API_KEY?.trim() ?? '';
  const baseModel = environment.OPENROUTER_MODEL?.trim() ?? '';
  const modelFor = (role: Uppercase<WorkerRole>) =>
    environment[`OPENROUTER_${role}_MODEL`]?.trim() || baseModel;
  const models: ToolkitConfig['models'] = {
    spec: modelFor('SPEC'),
    logic: modelFor('LOGIC'),
    level: modelFor('LEVEL'),
    art: modelFor('ART'),
    repair: modelFor('REPAIR'),
  };

  if (options.requireApiKey !== false && !apiKey) {
    throw new Error('OPENROUTER_API_KEY is required for generation.');
  }
  if (options.requireModels !== false) {
    const missing = Object.entries(models)
      .filter(([, model]) => !model)
      .map(([role]) => role);
    if (missing.length) {
      throw new Error(
        `Configure OPENROUTER_MODEL or role overrides for: ${missing.join(', ')}.`,
      );
    }
  }
  return { apiKey, models, limits: structuredClone(DEFAULT_LIMITS) };
}

export function publicConfig(config: ToolkitConfig): Omit<ToolkitConfig, 'apiKey'> {
  return { models: { ...config.models }, limits: structuredClone(config.limits) };
}
