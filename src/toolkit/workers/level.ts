import { LevelOutputSchema, type GameSpec, type LevelOutput } from '../../contracts/index';
import { correctionContext, levelContext, type ContextPacket } from '../context';
import type { ModelClient, ModelRequest, ModelResult } from '../openrouter';
import { validateLevelArtifact } from '../validate';

export type LevelWorkerResult = {
  output: LevelOutput;
  requests: Array<{ request: ModelRequest; result: ModelResult; context: ContextPacket }>;
  rejected: string[][];
};

export async function runLevelWorker(options: {
  spec: GameSpec;
  model: string;
  systemPrompt: string;
  client: ModelClient;
  signal: AbortSignal;
}): Promise<LevelWorkerResult> {
  const initial = levelContext(options.systemPrompt, options.spec);
  const requests: LevelWorkerResult['requests'] = [];
  const rejected: string[][] = [];
  let context = initial;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request: ModelRequest = {
      requestId: `level_${attempt}`,
      role: 'level',
      model: options.model,
      system: context.system,
      user: context.user,
      schemaName: 'level_output',
      schema: LevelOutputSchema,
      maxOutputTokens: 3_000,
    };
    const result = await options.client.generate(request, options.signal);
    requests.push({ request, result, context });
    const errors = validateLevelArtifact(options.spec, result.content).map(
      ({ code, instancePath, message }) => `${instancePath || '/'} ${code}: ${message}`,
    );
    if (!errors.length) return { output: result.content as LevelOutput, requests, rejected };
    rejected.push(errors);
    if (attempt === 0) {
      context = correctionContext(
        options.systemPrompt,
        'level',
        result.content,
        errors,
        JSON.parse(initial.user) as object,
      );
    }
  }
  throw new Error(`Level validation failed after one correction: ${rejected.at(-1)?.join('; ')}`);
}
