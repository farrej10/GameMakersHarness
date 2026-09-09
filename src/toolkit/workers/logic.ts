import { LogicOutputSchema, type GameSpec, type LogicOutput } from '../../contracts/index';
import { correctionContext, logicContext, type ContextPacket } from '../context';
import type { ModelClient, ModelRequest, ModelResult } from '../openrouter';
import { validateLogicArtifact } from '../validate';

export type LogicWorkerResult = {
  output: LogicOutput;
  requests: Array<{ request: ModelRequest; result: ModelResult; context: ContextPacket }>;
  rejected: string[][];
};

export async function runLogicWorker(options: {
  spec: GameSpec;
  model: string;
  systemPrompt: string;
  client: ModelClient;
  signal: AbortSignal;
}): Promise<LogicWorkerResult> {
  const initial = logicContext(options.systemPrompt, options.spec);
  const requests: LogicWorkerResult['requests'] = [];
  const rejected: string[][] = [];
  let context = initial;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request: ModelRequest = {
      requestId: `logic_${attempt}`,
      role: 'logic',
      model: options.model,
      system: context.system,
      user: context.user,
      schemaName: 'logic_output',
      schema: LogicOutputSchema,
      maxOutputTokens: 4_096,
    };
    const result = await options.client.generate(request, options.signal);
    requests.push({ request, result, context });
    const errors = validateLogicArtifact(result.content).map(
      ({ code, instancePath, message }) => `${instancePath || '/'} ${code}: ${message}`,
    );
    if (!errors.length) return { output: result.content as LogicOutput, requests, rejected };
    rejected.push(errors);
    if (attempt === 0) {
      context = correctionContext(
        options.systemPrompt,
        'logic',
        result.content,
        errors,
        JSON.parse(initial.user) as object,
      );
    }
  }
  throw new Error(`Logic validation failed after one correction: ${rejected.at(-1)?.join('; ')}`);
}
