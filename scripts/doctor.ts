import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadToolkitConfig } from '../src/toolkit/config';

type DoctorCheck = { name: string; passed: boolean; message: string };
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'Node.js',
    passed: major === 24,
    message: `Detected ${process.version}; expected major version 24.`,
  });
  const packageJson = JSON.parse(
    readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const required = ['@sinclair/typebox', 'ajv', 'phaser', 'pngjs', 'playwright', 'typescript', 'vite', 'vitest'];
  const missing = required.filter(
    (name) => !packageJson.dependencies?.[name] && !packageJson.devDependencies?.[name],
  );
  checks.push({
    name: 'Dependencies',
    passed: missing.length === 0,
    message: missing.length ? `Missing: ${missing.join(', ')}` : 'Required packages are declared.',
  });
  const browserPath = chromium.executablePath();
  checks.push({
    name: 'Chromium',
    passed: existsSync(browserPath),
    message: existsSync(browserPath) ? `Installed at ${browserPath}` : 'Run npx playwright install chromium.',
  });

  try {
    const config = loadToolkitConfig({ cwd: projectRoot });
    checks.push({ name: 'OpenRouter key', passed: true, message: 'OPENROUTER_API_KEY is present (value hidden).' });
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Model catalog returned HTTP ${response.status}.`);
    const body = await response.json() as { data?: Array<{
      id?: string;
      supported_parameters?: string[];
      architecture?: { output_modalities?: string[] };
    }> };
    const entries = body.data ?? [];
    for (const [role, modelId] of Object.entries(config.models)) {
      const model = entries.find(({ id }) => id === modelId);
      const parameters = model?.supported_parameters ?? [];
      const structured = parameters.includes('response_format') || parameters.includes('structured_outputs');
      const imageOutput = model?.architecture?.output_modalities?.includes('image') ?? false;
      const supported = role === 'art' ? imageOutput : structured;
      checks.push({
        name: `${role} model ${modelId}`,
        passed: Boolean(model) && supported,
        message: !model
          ? 'Model ID was not found in the current OpenRouter catalog.'
          : supported
            ? role === 'art'
              ? 'Catalog advertises image output.'
              : 'Catalog advertises structured-output support.'
            : role === 'art'
              ? 'Catalog does not advertise image output.'
              : 'Catalog does not advertise a structured-output parameter.',
      });
    }
  } catch (error) {
    checks.push({
      name: 'OpenRouter configuration',
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  for (const check of checks) {
    process.stdout.write(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.message}\n`);
  }
  process.exitCode = checks.every(({ passed }) => passed) ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
