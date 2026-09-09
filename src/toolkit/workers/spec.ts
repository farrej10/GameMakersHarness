import { GameSpecSchema, getValidationErrors, validateGameSpec, type GameSpec } from '../../contracts/index';
import type { ModelClient, ModelRequest, ModelResult } from '../openrouter';

export type SpecWorkerResult = {
  spec: GameSpec;
  requests: Array<{ request: ModelRequest; result: ModelResult }>;
  rejected: string[][];
};

function validationErrors(value: unknown, seed: number): string[] {
  const errors: string[] = [];
  if (!validateGameSpec(value)) {
    errors.push(
      ...getValidationErrors(validateGameSpec).map(
        ({ instancePath, keyword, message }) =>
          `${instancePath || '/'} ${keyword}: ${message ?? 'invalid'}`,
      ),
    );
  } else if (value.seed !== seed) {
    errors.push(`/seed must equal the requested seed ${seed}; received ${value.seed}`);
  }
  return errors;
}

export async function runSpecWorker(options: {
  prompt: string;
  seed: number;
  model: string;
  systemPrompt: string;
  client: ModelClient;
  signal: AbortSignal;
}): Promise<SpecWorkerResult> {
  const requests: SpecWorkerResult['requests'] = [];
  const rejected: string[][] = [];
  let user = JSON.stringify({
    task: 'Convert this supported top-down collection/survival game description into GameSpec.',
    seed: options.seed,
    description: options.prompt,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request: ModelRequest = {
      requestId: `spec_${attempt}`,
      role: 'spec',
      model: options.model,
      system: options.systemPrompt,
      user,
      schemaName: 'game_spec',
      schema: GameSpecSchema,
      maxOutputTokens: 2_500,
    };
    const result = await options.client.generate(request, options.signal);
    requests.push({ request, result });
    const errors = validationErrors(result.content, options.seed);
    if (errors.length === 0) {
      return { spec: result.content as GameSpec, requests, rejected };
    }
    rejected.push(errors);
    if (attempt === 0) {
      user = JSON.stringify({
        task: 'Correct the rejected GameSpec and return a complete replacement.',
        seed: options.seed,
        originalDescription: options.prompt,
        previousOutput: result.content,
        validationErrors: errors,
      });
    }
  }
  throw new Error(`Spec validation failed after one correction: ${rejected.at(-1)?.join('; ')}`);
}
