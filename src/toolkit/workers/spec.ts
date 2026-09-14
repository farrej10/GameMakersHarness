import { GameSpecSchema, getValidationErrors, validateGameSpec, type GameSpec } from '../../contracts/index';
import type { ModelClient, ModelRequest, ModelResult } from '../openrouter';

export type SpecWorkerResult = {
  spec: GameSpec;
  requests: Array<{ request: ModelRequest; result: ModelResult }>;
  rejected: string[][];
};

function validationErrors(value: unknown, seed: number, originalPrompt: string): string[] {
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
  } else {
    if (!value.animationProfile) {
      errors.push('/animationProfile is required for newly generated games');
    }
    const duration = originalPrompt.match(/\b(\d{1,3})\s*(seconds?|minutes?)\b/iu);
    if (duration && (value.objective.mode === 'survive' || value.objective.mode === 'survive-then-exit')) {
      const amount = Number(duration[1]);
      const expectedTicks = amount * (/minute/iu.test(duration[2]!) ? 3_600 : 60);
      if (value.objective.survivalTicks !== expectedTicks) {
        errors.push(`/objective/survivalTicks must preserve the requested duration: ${expectedTicks} ticks`);
      }
    }
    if (/\bwin\b/iu.test(originalPrompt) && /\b(surviv\w*|timer)\b/iu.test(originalPrompt) && !/\b(exit|door|portal|gate|escape)\b/iu.test(originalPrompt) && value.objective.mode !== 'survive') {
      errors.push('/objective/mode must be survive because the request does not require reaching an exit');
    }
    const differences = [
      value.player.movement.mode !== 'standard',
      value.collectibles.interaction !== 'touch',
      value.enemies.behavior !== 'chase',
      value.objective.mode !== 'collect-all',
      value.world.layout !== 'open',
      value.world.pressure !== 'none',
    ].filter(Boolean).length;
    if (differences < 3) {
      errors.push('/ mechanics must differ from the plain template in at least three categories');
    }
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
    const errors = validationErrors(result.content, options.seed, options.prompt);
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
