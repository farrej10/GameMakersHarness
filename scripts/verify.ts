import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArtOutput,
  CheckResult,
  GameSpec,
  VerifyResult,
} from '../src/contracts/index';
import {
  getValidationErrors,
  validateAssetManifest,
  validateGameSpec,
  validateVerifyResult,
} from '../src/contracts/index';
import { inspectPng, renderArtOutput } from '../src/toolkit/render-pixels';
import {
  validateArtArtifact,
  validateLevelArtifact,
  validateLogicSource,
} from '../src/toolkit/validate';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runIdPattern = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u;
const REQUIRED_ASSETS = ['player', 'collectible', 'enemy', 'exit'] as const;
const PROTECTED_ENTRIES = [
  'tests',
  'src/contracts',
  'src/runtime',
  'src/game',
  'src/toolkit',
  'prompts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'playwright.verify.config.ts',
] as const;

type CommandResult = {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  elapsedMs: number;
};

type SelectedArtifacts = {
  runId: string;
  runRoot: string;
  evidenceRoot: string;
  integrationRoot: string | null;
  specPath: string;
  levelPath: string;
  rulesPath: string;
  ruleTypesPath: string;
  manifestPath: string;
  artPath: string | null;
  publicDir: string;
};

function relativeTo(root: string, value: string): string {
  return path.relative(root, value).replaceAll('\\', '/');
}

function assertInside(root: string, value: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes its trusted root: ${value}`);
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function safeEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/iu.test(name)) {
      environment[name] = value;
    }
  }
  return { ...environment, ...extra };
}

async function runCommand(
  executable: string,
  args: readonly string[],
  logPath: string,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  const started = Date.now();
  const npmEntry = process.env.npm_execpath;
  const actualExecutable =
    process.platform === 'win32' && executable === 'npm.cmd' && npmEntry
      ? process.execPath
      : executable;
  const actualArgs = actualExecutable === process.execPath && executable === 'npm.cmd'
    ? [npmEntry!, ...args]
    : [...args];
  const child = spawn(actualExecutable, actualArgs, {
    cwd: projectRoot,
    env: safeEnvironment(options.env),
    shell: false,
    windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  }, options.timeoutMs ?? 120_000);
  const exitCode = await new Promise<number | null>((resolve) => {
    let settled = false;
    child.once('error', (error) => {
      output += `${error.message}\n`;
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });
    child.once('close', (code) => {
      if (!settled) {
        settled = true;
        resolve(code);
      }
    });
  }).finally(() => clearTimeout(timeout));
  const result = {
    command: [executable, ...args].join(' '),
    exitCode,
    timedOut,
    output: output.slice(0, 200_000),
    elapsedMs: Date.now() - started,
  };
  writeFileSync(logPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (!lstatSync(root).isDirectory()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) return [fullPath];
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

export function snapshotProtectedFiles(): Record<string, string> {
  const files = PROTECTED_ENTRIES.flatMap((entry) =>
    walkFiles(path.join(projectRoot, entry)),
  ).sort();
  return Object.fromEntries(
    files.map((filePath) => {
      const relative = relativeTo(projectRoot, filePath);
      const stat = lstatSync(filePath);
      const digest = stat.isSymbolicLink()
        ? `symlink:${realpathSync(filePath)}`
        : createHash('sha256').update(readFileSync(filePath)).digest('hex');
      return [relative, digest];
    }),
  );
}

export function compareProtectedFiles(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): string[] {
  const names = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...names]
    .sort()
    .filter((name) => expected[name] !== actual[name]);
}

function selectArtifacts(runId: string, attempt: number): SelectedArtifacts {
  if (runId === 'reference') {
    const fixtureRoot = path.join(projectRoot, 'tests', 'fixtures', 'reference');
    const evidenceRoot = path.join(
      projectRoot,
      'test-results',
      'verify',
      'reference',
      `attempt-${attempt}`,
    );
    return {
      runId,
      runRoot: evidenceRoot,
      evidenceRoot,
      integrationRoot: null,
      specPath: path.join(fixtureRoot, 'game-spec.json'),
      levelPath: path.join(fixtureRoot, 'level.json'),
      rulesPath: path.join(fixtureRoot, 'rules.ts'),
      ruleTypesPath: path.join(fixtureRoot, 'rule-types.ts'),
      manifestPath: path.join(fixtureRoot, 'asset-manifest.json'),
      artPath: path.join(fixtureRoot, 'art.json'),
      publicDir: path.join(evidenceRoot, 'input-public'),
    };
  }
  if (!runIdPattern.test(runId)) throw new Error(`Invalid run ID: ${runId}`);
  const runsRoot = path.join(projectRoot, 'runs');
  const runRoot = path.join(runsRoot, runId);
  assertInside(runsRoot, runRoot);
  if (!existsSync(runRoot) || lstatSync(runRoot).isSymbolicLink()) {
    throw new Error(`Run does not exist or is a symlink: ${runId}`);
  }
  const integrationRoot = path.join(runRoot, 'integration');
  const evidenceRoot = path.join(runRoot, 'evidence', `attempt-${attempt}`);
  return {
    runId,
    runRoot,
    evidenceRoot,
    integrationRoot,
    specPath: path.join(integrationRoot, 'generated', 'game-spec.json'),
    levelPath: path.join(integrationRoot, 'generated', 'level.json'),
    rulesPath: path.join(integrationRoot, 'generated', 'rules.ts'),
    ruleTypesPath: path.join(integrationRoot, 'generated', 'rule-types.ts'),
    manifestPath: path.join(runRoot, 'asset-manifest.json'),
    artPath: null,
    publicDir: path.join(integrationRoot, 'public'),
  };
}

function makeCheck(
  id: string,
  stage: CheckResult['stage'],
  status: CheckResult['status'],
  owner: CheckResult['owner'],
  message: string,
  artifactPaths: string[] = [],
  expected: string | null = null,
  actual: string | null = null,
): CheckResult {
  return { id, stage, status, owner, message, expected, actual, artifactPaths };
}

export function classifyBrowserFailure(output: string): { id: string; owner: CheckResult['owner'] } {
  const id = output.match(
    /^\s*x\s+\d+[^\r\n]*?\b(POLICY-GUARD|LEVEL-PLAY-\d+|PLAY-\d+|ANIM-\d+|POLICY-\d+|PROD-\d+)/mu,
  )?.[1] ?? output.match(/(?:LEVEL-PLAY|PLAY|ANIM|POLICY|PROD)-\d+/u)?.[0] ??
    (output.includes('POLICY-GUARD') ? 'POLICY-GUARD' : 'BROWSER-SUITE');
  if (id.startsWith('POLICY') || id === 'PLAY-07') return { id, owner: 'logic' };
  if (id.startsWith('LEVEL')) return { id, owner: 'level' };
  if (id.startsWith('ANIM')) return { id, owner: 'runtime' };
  if (id === 'PLAY-01') return { id, owner: 'runtime' };
  if (/(?:failed request|404).*(?:asset|png)|(?:asset|png).*(?:failed request|404)/iu.test(output)) {
    return { id, owner: 'art' };
  }
  return { id, owner: id.startsWith('PROD') ? 'harness' : 'runtime' };
}

export async function verifyRun(runId: string, attempt: number): Promise<VerifyResult> {
  const selected = selectArtifacts(runId, attempt);
  const logsRoot = path.join(selected.evidenceRoot, 'logs');
  const browserOutput = path.join(selected.evidenceRoot, 'playwright');
  const reportPath = path.join(selected.evidenceRoot, 'verify.json');
  rmSync(logsRoot, { recursive: true, force: true });
  rmSync(browserOutput, { recursive: true, force: true });
  rmSync(reportPath, { force: true });
  mkdirSync(logsRoot, { recursive: true });
  const testBuild = path.join(
    runId === 'reference' ? selected.evidenceRoot : selected.runRoot,
    'build-test',
  );
  const productionBuild = path.join(
    runId === 'reference' ? selected.evidenceRoot : selected.runRoot,
    'build',
  );
  const startedAt = new Date().toISOString();
  const checks: CheckResult[] = [];
  const invocationBaseline = snapshotProtectedFiles();
  const persistedBaselinePath =
    runId === 'reference'
      ? null
      : path.join(selected.runRoot, 'evidence', 'protected-baseline.json');
  const expectedBaseline =
    persistedBaselinePath && existsSync(persistedBaselinePath)
      ? readJson<Record<string, string>>(persistedBaselinePath)
      : invocationBaseline;
  let prerequisitesPassed = true;

  try {
    const specValue = readJson<unknown>(selected.specPath);
    if (!validateGameSpec(specValue)) {
      checks.push(
        makeCheck(
          'CONTRACT-01',
          'contracts',
          'failed',
          'harness',
          'Selected game specification failed schema validation.',
          [],
          'valid GameSpec',
          JSON.stringify(getValidationErrors(validateGameSpec)),
        ),
      );
      prerequisitesPassed = false;
    } else {
      const spec: GameSpec = specValue;
      const levelIssues = validateLevelArtifact(spec, readJson(selected.levelPath));
      const logicIssues = validateLogicSource(readFileSync(selected.rulesPath, 'utf8'));
      const artIssues = selected.artPath
        ? validateArtArtifact(readJson(selected.artPath))
        : [];
      const contractIssues = [...levelIssues, ...logicIssues, ...artIssues];
      checks.push(
        makeCheck(
          contractIssues.length === 0 ? 'CONTRACTS' : contractIssues[0]!.code,
          'contracts',
          contractIssues.length === 0 ? 'passed' : 'failed',
          logicIssues.length ? 'logic' : levelIssues.length ? 'level' : artIssues.length ? 'art' : 'harness',
          contractIssues.length === 0
            ? 'Selected spec, level, art, and logic satisfy their contracts.'
            : contractIssues.map((entry) => `${entry.code}: ${entry.message}`).join('\n'),
          [],
          'no contract or semantic failures',
          contractIssues.length ? JSON.stringify(contractIssues) : null,
        ),
      );
      prerequisitesPassed = contractIssues.length === 0;

      if (runId === 'reference') {
        mkdirSync(path.join(selected.publicDir, 'assets'), { recursive: true });
        const art = readJson<ArtOutput>(selected.artPath!);
        for (const [id, png] of renderArtOutput(art, spec.theme.palette)) {
          writeFileSync(path.join(selected.publicDir, 'assets', `${id}.png`), png);
        }
      }
    }
  } catch (error) {
    checks.push(
      makeCheck(
        'CONTRACTS',
        'contracts',
        'failed',
        'harness',
        error instanceof Error ? error.message : String(error),
      ),
    );
    prerequisitesPassed = false;
  }

  const initialProtectedChanges = compareProtectedFiles(
    expectedBaseline,
    snapshotProtectedFiles(),
  );
  checks.push(
    makeCheck(
      'PROTECT-01',
      'protected',
      initialProtectedChanges.length ? 'failed' : 'passed',
      'harness',
      initialProtectedChanges.length
        ? `Protected files differ from baseline: ${initialProtectedChanges.join(', ')}`
        : 'Protected files match the trusted baseline.',
      persistedBaselinePath ? [relativeTo(selected.runRoot, persistedBaselinePath)] : [],
      'no added, changed, or deleted protected files',
      initialProtectedChanges.length ? JSON.stringify(initialProtectedChanges) : null,
    ),
  );
  prerequisitesPassed &&= initialProtectedChanges.length === 0;

  const addCommandCheck = async (
    id: string,
    stage: CheckResult['stage'],
    owner: CheckResult['owner'],
    executable: string,
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<CommandResult | null> => {
    const logPath = path.join(logsRoot, `${id.toLowerCase()}.txt`);
    if (!prerequisitesPassed) {
      checks.push(
        makeCheck(id, stage, 'skipped', owner, 'Skipped because a prerequisite stage failed.'),
      );
      return null;
    }
    const command = await runCommand(executable, args, logPath, { env });
    const passed = command.exitCode === 0 && !command.timedOut;
    checks.push(
      makeCheck(
        id,
        stage,
        passed ? 'passed' : 'failed',
        owner,
        passed ? `${id} completed successfully.` : `${id} failed; inspect its captured log.`,
        [relativeTo(selected.runRoot, logPath)],
        'exit code 0 before timeout',
        command.timedOut ? 'timed out' : `exit code ${command.exitCode}`,
      ),
    );
    prerequisitesPassed &&= passed;
    return command;
  };

  await addCommandCheck('TYPE-REPOSITORY', 'types', 'harness', 'npm.cmd', [
    'run',
    'typecheck',
  ]);
  await addCommandCheck('TYPE-GENERATED', 'types', 'logic', 'npm.cmd', [
    'exec',
    '--',
    'tsc',
    '--ignoreConfig',
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    selected.rulesPath,
    selected.ruleTypesPath,
  ]);
  await addCommandCheck('UNIT-SUITE', 'unit', 'harness', 'npm.cmd', [
    'exec',
    '--',
    'vitest',
    'run',
    'tests/unit',
    'tests/integration',
  ]);

  const viteEnvironment = {
    GAME_INTEGRATION_ROOT: selected.integrationRoot ?? '',
    GAME_PUBLIC_DIR: selected.publicDir,
  };
  await addCommandCheck('BUILD-TEST', 'build', 'harness', 'npm.cmd', [
    'exec',
    '--',
    'vite',
    'build',
    '--mode',
    'test',
    '--outDir',
    testBuild,
  ], viteEnvironment);
  await addCommandCheck('BUILD-PRODUCTION', 'build', 'harness', 'npm.cmd', [
    'exec',
    '--',
    'vite',
    'build',
    '--mode',
    'production',
    '--outDir',
    productionBuild,
  ], viteEnvironment);

  if (prerequisitesPassed) {
    const manifest = readJson<unknown>(selected.manifestPath);
    const assetFailures: string[] = [];
    if (!validateAssetManifest(manifest)) {
      assetFailures.push(JSON.stringify(getValidationErrors(validateAssetManifest)));
    } else {
      for (const id of REQUIRED_ASSETS) {
        const assetPath = path.join(productionBuild, 'assets', `${id}.png`);
        try {
          const inspection = inspectPng(readFileSync(assetPath));
          if (inspection.width !== 64 || inspection.height !== 64 || inspection.visiblePixels === 0) {
            assetFailures.push(`${id}: ${JSON.stringify(inspection)}`);
          }
        } catch (error) {
          assetFailures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    checks.push(
      makeCheck(
        'ASSET-01',
        'assets',
        assetFailures.length ? 'failed' : 'passed',
        'art',
        assetFailures.length
          ? `Production asset inspection failed: ${assetFailures.join('; ')}`
          : 'All manifest assets decode as visible 64 by 64 PNGs.',
        [relativeTo(selected.runRoot, productionBuild)],
        'four valid 64 by 64 production PNG assets',
        assetFailures.length ? JSON.stringify(assetFailures) : null,
      ),
    );
    prerequisitesPassed &&= assetFailures.length === 0;
  } else {
    checks.push(makeCheck('ASSET-01', 'assets', 'skipped', 'art', 'Skipped because a prerequisite stage failed.'));
  }

  const playwrightEnvironment = {
    GAME_TEST_BUILD: testBuild,
    GAME_PRODUCTION_BUILD: productionBuild,
    GAME_SPEC_PATH: selected.specPath,
  };
  const browser = await addCommandCheck('BROWSER-SUITE', 'browser', 'runtime', 'npm.cmd', [
    'exec',
    '--',
    'playwright',
    'test',
    '--config',
    'playwright.verify.config.ts',
    '--grep-invert',
    'PROD-01',
  ], { ...playwrightEnvironment, GAME_PLAYWRIGHT_OUTPUT: path.join(browserOutput, 'gameplay') });
  if (browser && browser.exitCode !== 0) {
    const classification = classifyBrowserFailure(browser.output);
    const check = checks.at(-1)!;
    check.id = classification.id;
    check.owner = classification.owner;
  }
  const production = await addCommandCheck('PROD-01', 'production', 'harness', 'npm.cmd', [
    'exec',
    '--',
    'playwright',
    'test',
    '--config',
    'playwright.verify.config.ts',
    '--grep',
    'PROD-01',
  ], { ...playwrightEnvironment, GAME_PLAYWRIGHT_OUTPUT: path.join(browserOutput, 'production') });
  if (production && production.exitCode !== 0) {
    checks.at(-1)!.owner = classifyBrowserFailure(production.output).owner;
  }

  const finalProtectedChanges = compareProtectedFiles(
    invocationBaseline,
    snapshotProtectedFiles(),
  );
  checks.push(
    makeCheck(
      'PROTECT-POST',
      'protected',
      finalProtectedChanges.length ? 'failed' : 'passed',
      'harness',
      finalProtectedChanges.length
        ? `Verification changed protected files: ${finalProtectedChanges.join(', ')}`
        : 'Verification left protected files unchanged.',
      [],
      'no changes during verification',
      finalProtectedChanges.length ? JSON.stringify(finalProtectedChanges) : null,
    ),
  );

  const result: VerifyResult = {
    schemaVersion: 1,
    runId,
    attempt,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: checks.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
    checks,
  };
  if (!validateVerifyResult(result)) {
    throw new Error(`Verifier produced an invalid result: ${JSON.stringify(getValidationErrors(validateVerifyResult))}`);
  }
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const runId = argument('--run') ?? 'reference';
  const attempt = Number(argument('--attempt') ?? '0');
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error('Attempt must be a nonnegative integer.');
  const result = await verifyRun(runId, attempt);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
