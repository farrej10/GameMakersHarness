import { ArtOutputSchema, type ArtOutput, type AssetManifest, type GameSpec, type RasterArtOutput } from '../../contracts/index';
import { artContext, correctionContext, type ContextPacket } from '../context';
import { ModelError, type ImageContent, type ImageModelRequest, type ModelClient, type ModelRequest, type ModelResult } from '../openrouter';
import { createFallbackArtOutput, normalizeImageTo64 } from '../render-pixels';
import { validateArtArtifact } from '../validate';

export type ArtWorkerResult = {
  output: ArtOutput;
  artSource: 'generated' | 'fallback';
  fallbackReason: string | null;
  requests: Array<{ request: ModelRequest | ImageModelRequest; result: ModelResult; context: ContextPacket }>;
  rejected: string[][];
};

const STOP_ERRORS = new Set([
  'AUTH_ERROR',
  'CREDIT_ERROR',
  'CONFIG_ERROR',
  'REQUEST_LIMIT',
  'TIME_LIMIT',
  'ABORTED',
]);

export async function runArtWorker(options: {
  spec: GameSpec;
  manifest: AssetManifest;
  model: string;
  systemPrompt: string;
  client: ModelClient;
  signal: AbortSignal;
}): Promise<ArtWorkerResult> {
  const initial = artContext(options.systemPrompt, options.spec, options.manifest);
  const requests: ArtWorkerResult['requests'] = [];
  const rejected: string[][] = [];
  if (options.client.generateImage) {
    try {
      const names = {
        player: options.spec.theme.playerName,
        collectible: options.spec.theme.collectibleName,
        enemy: options.spec.theme.enemyName,
        exit: options.spec.theme.exitName,
      } as const;
      const sprites: RasterArtOutput['sprites'][number][] = [];
      for (const id of ['player', 'collectible', 'enemy', 'exit'] as const) {
        const request: ImageModelRequest = {
          requestId: `art_${id}`,
          role: 'art',
          model: options.model,
          prompt: `${options.systemPrompt}\n\nCreate only the ${id} sprite: ${names[id]}. ` +
            `Approved palette: ${options.spec.theme.palette.join(', ')}. ` +
            `Game theme: ${options.spec.description}. ` +
            `Fantasy: ${options.spec.identity.fantasy}. ` +
            `Visual pressure: ${options.spec.identity.dramaticPressure}. ` +
            `World layout: ${options.spec.world.layout}.`,
        };
        const result = await options.client.generateImage(request, options.signal);
        const content = result.content as Partial<ImageContent>;
        if (content.mimeType !== 'image/png' || typeof content.imageBase64 !== 'string') {
          throw new ModelError('MALFORMED_RESPONSE', `Image model returned no PNG for ${id}.`);
        }
        const normalized = normalizeImageTo64(Buffer.from(content.imageBase64, 'base64'));
        sprites.push({
          id,
          width: 64,
          height: 64,
          mimeType: 'image/png',
          pngBase64: normalized.toString('base64'),
        });
        requests.push({ request, result, context: initial });
      }
      const output: RasterArtOutput = { schemaVersion: 1, format: 'png-64', sprites };
      const errors = validateArtArtifact(output).map(
        ({ code, instancePath, message }) => `${instancePath || '/'} ${code}: ${message}`,
      );
      if (errors.length) throw new Error(`Raster art validation failed: ${errors.join('; ')}`);
      return { output, artSource: 'generated', fallbackReason: null, requests, rejected };
    } catch (error) {
      if (error instanceof ModelError && STOP_ERRORS.has(error.code)) throw error;
      return {
        output: createFallbackArtOutput(),
        artSource: 'fallback',
        fallbackReason: error instanceof Error ? error.message : String(error),
        requests,
        rejected,
      };
    }
  }
  let context = initial;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const request: ModelRequest = {
        requestId: `art_${attempt}`,
        role: 'art',
        model: options.model,
        system: context.system,
        user: context.user,
        schemaName: 'art_output',
        schema: ArtOutputSchema,
        maxOutputTokens: 3_000,
      };
      const result = await options.client.generate(request, options.signal);
      requests.push({ request, result, context });
      const errors = validateArtArtifact(result.content).map(
        ({ code, instancePath, message }) => `${instancePath || '/'} ${code}: ${message}`,
      );
      if (!errors.length) {
        return { output: result.content as ArtOutput, artSource: 'generated', fallbackReason: null, requests, rejected };
      }
      rejected.push(errors);
      if (attempt === 0) {
        context = correctionContext(
          options.systemPrompt,
          'art',
          result.content,
          errors,
          JSON.parse(initial.user) as object,
        );
      }
    }
    return {
      output: createFallbackArtOutput(),
      artSource: 'fallback',
      fallbackReason: `Art validation failed after one correction: ${rejected.at(-1)?.join('; ')}`,
      requests,
      rejected,
    };
  } catch (error) {
    if (error instanceof ModelError && STOP_ERRORS.has(error.code)) throw error;
    return {
      output: createFallbackArtOutput(),
      artSource: 'fallback',
      fallbackReason: error instanceof Error ? error.message : String(error),
      requests,
      rejected,
    };
  }
}
