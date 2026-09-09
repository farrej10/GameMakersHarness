import { ArtOutputSchema, type ArtOutput, type AssetManifest, type GameSpec } from '../../contracts/index';
import { artContext, correctionContext, type ContextPacket } from '../context';
import { ModelError, type ModelClient, type ModelRequest, type ModelResult } from '../openrouter';
import { createFallbackArtOutput } from '../render-pixels';
import { validateArtArtifact } from '../validate';

export type ArtWorkerResult = {
  output: ArtOutput;
  artSource: 'generated' | 'fallback';
  fallbackReason: string | null;
  requests: Array<{ request: ModelRequest; result: ModelResult; context: ContextPacket }>;
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
