import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';
import type { AssetManifest, GameSpec, GridArtOutput, LevelOutput, LogicOutput } from '../../src/contracts/index';
import { artContext, levelContext, logicContext } from '../../src/toolkit/context';
import { ModelError, type ModelClient, type ModelRequest, type ModelResult } from '../../src/toolkit/openrouter';
import { validateArtArtifact } from '../../src/toolkit/validate';
import { runArtWorker } from '../../src/toolkit/workers/art';
import { runLevelWorker } from '../../src/toolkit/workers/level';
import { runLogicWorker } from '../../src/toolkit/workers/logic';
import { runSpecWorker } from '../../src/toolkit/workers/spec';

function json<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/reference/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

const spec = json<GameSpec>('game-spec.json');
const level = json<LevelOutput>('level.json');
const art = json<GridArtOutput>('art.json');
const manifest = json<AssetManifest>('asset-manifest.json');
const logic: LogicOutput = {
  schemaVersion: 1,
  source: readFileSync(new URL('../fixtures/reference/rules.ts', import.meta.url), 'utf8'),
};

function modelResult(content: unknown, index: number): ModelResult {
  return {
    content,
    responseId: `fake-${index}`,
    requestedModel: 'fake/model',
    returnedModel: 'fake/model',
    provider: 'fixture',
    promptTokens: null,
    completionTokens: null,
    reportedCostUsd: null,
    elapsedMs: 1,
  };
}

function fake(outputs: unknown[]): { client: ModelClient; call: ReturnType<typeof vi.fn> } {
  let index = 0;
  const call = vi.fn(async (_request: ModelRequest) => {
    const output = outputs[index];
    index += 1;
    if (output instanceof Error) throw output;
    return modelResult(output, index);
  });
  return { client: { generate: call }, call };
}

const common = {
  model: 'fake/model',
  systemPrompt: 'trusted instructions',
  signal: new AbortController().signal,
};

describe('role-specific context', () => {
  it('is deterministic, bounded, and excludes unrelated role data', () => {
    const first = logicContext('logic', spec);
    const second = logicContext('logic', structuredClone(spec));
    expect(first).toEqual(second);
    expect(first.bytes).toBeLessThanOrEqual(24_000);
    expect(first.user).not.toContain('playerSpawn');
    expect(levelContext('level', spec).user).not.toContain('OPENROUTER');
    expect(artContext('art', spec, manifest).user).toContain('signatureMechanic');
    expect(artContext('art', spec, manifest).user).not.toContain('playerSpawn');
  });
});

describe('generation workers', () => {
  it('rejects a mechanically generic specification and requests one correction', async () => {
    const generic = structuredClone(spec);
    generic.player.movement = { mode: 'standard' };
    generic.collectibles.interaction = 'touch';
    generic.enemies.behavior = 'chase';
    generic.objective = { mode: 'collect-all' };
    generic.world = { layout: 'open', pressure: 'none' };
    const model = fake([generic, spec]);
    const result = await runSpecWorker({
      prompt: spec.description,
      seed: spec.seed,
      model: common.model,
      systemPrompt: common.systemPrompt,
      client: model.client,
      signal: common.signal,
    });
    expect(model.call).toHaveBeenCalledTimes(2);
    expect(result.rejected[0]?.join(' ')).toContain('at least three categories');
  });

  it('requests four images and normalizes them into the raster art contract', async () => {
    const png = new PNG({ width: 64, height: 64 });
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 4;
      const entity = x >= 16 && x < 48 && y >= 16 && y < 48;
      png.data[offset] = entity ? 220 : 255;
      png.data[offset + 1] = entity ? 80 : 255;
      png.data[offset + 2] = entity ? 40 : 255;
      png.data[offset + 3] = 255;
    }
    const imageBase64 = PNG.sync.write(png).toString('base64');
    const generateImage = vi.fn(async (_request: unknown, _signal: AbortSignal) =>
      modelResult({ mimeType: 'image/png', imageBase64 }, generateImage.mock.calls.length));
    const client: ModelClient = { generate: vi.fn(), generateImage };

    const result = await runArtWorker({ ...common, spec, manifest, client });

    expect(generateImage).toHaveBeenCalledTimes(4);
    expect(result.artSource).toBe('generated');
    expect(result.output).toMatchObject({ schemaVersion: 1, format: 'png-64' });
    expect(validateArtArtifact(result.output)).toEqual([]);
  });

  it('accepts valid logic, level, and art fixture responses', async () => {
    await expect(
      runLogicWorker({ ...common, spec, client: fake([logic]).client }),
    ).resolves.toMatchObject({ output: logic, rejected: [] });
    await expect(
      runLevelWorker({ ...common, spec, client: fake([level]).client }),
    ).resolves.toMatchObject({ output: level, rejected: [] });
    await expect(
      runArtWorker({ ...common, spec, manifest, client: fake([art]).client }),
    ).resolves.toMatchObject({ output: art, artSource: 'generated', rejected: [] });
  });

  it('corrects a level count mismatch exactly once', async () => {
    const wrong = structuredClone(level);
    wrong.collectibles.pop();
    const model = fake([wrong, level]);
    const result = await runLevelWorker({ ...common, spec, client: model.client });

    expect(model.call).toHaveBeenCalledTimes(2);
    expect(result.rejected[0]?.join(' ')).toContain('LEVEL_COLLECTIBLE_COUNT');
    expect((model.call.mock.calls[1]?.[0] as ModelRequest).user).toContain(
      'validationErrors',
    );
  });

  it('rejects model-chosen fields and accepts a complete correction', async () => {
    const withPath = { ...structuredClone(level), path: '../../tests/gameplay.spec.ts' };
    const model = fake([withPath, level]);
    await expect(
      runLevelWorker({ ...common, spec, client: model.client }),
    ).resolves.toMatchObject({ output: level });
    expect((model.call.mock.calls[1]?.[0] as ModelRequest).user).toContain(
      'SCHEMA_ADDITIONALPROPERTIES',
    );
  });

  it('rejects extra logic exports and stops after one correction', async () => {
    const invalid = {
      ...logic,
      source: `${logic.source}\nexport function extra(): boolean { return true; }`,
    };
    const model = fake([invalid, invalid]);
    await expect(
      runLogicWorker({ ...common, spec, client: model.client }),
    ).rejects.toThrow(/after one correction/u);
    expect(model.call).toHaveBeenCalledTimes(2);
  });

  it('uses validated fallback art after the correction allowance', async () => {
    const transparent = structuredClone(art);
    transparent.sprites[0]!.rows = Array.from({ length: 16 }, () => '................');
    const model = fake([transparent, transparent]);
    const result = await runArtWorker({
      ...common,
      spec,
      manifest,
      client: model.client,
    });

    expect(model.call).toHaveBeenCalledTimes(2);
    expect(result.artSource).toBe('fallback');
    expect(validateArtArtifact(result.output)).toEqual([]);
    expect(result.fallbackReason).toContain('ART_OPAQUE_PIXELS');
  });

  it('never hides authentication failure behind art fallback', async () => {
    const model = fake([new ModelError('AUTH_ERROR', 'invalid key', 401)]);
    await expect(
      runArtWorker({ ...common, spec, manifest, client: model.client }),
    ).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(model.call).toHaveBeenCalledOnce();
  });
});
