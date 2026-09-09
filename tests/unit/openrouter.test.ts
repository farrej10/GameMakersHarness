import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadToolkitConfig, publicConfig } from '../../src/toolkit/config';
import {
  ModelError,
  OpenRouterClient,
  RequestBudget,
  type ModelRequest,
} from '../../src/toolkit/openrouter';

const request: ModelRequest = {
  requestId: 'spec-1',
  role: 'spec',
  model: 'provider/model',
  system: 'Return JSON.',
  user: 'Make a game.',
  schemaName: 'game_spec',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  },
  maxOutputTokens: 100,
};

function success(content = '{"ok":true}'): Response {
  return Response.json({
    id: 'response-1',
    model: 'provider/returned-model',
    provider: 'Provider',
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.001 },
  });
}

function client(options: {
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  maximum?: number;
  deadline?: number;
  clock?: () => number;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onRetry?: (notice: { delayMs: number; retryNumber: number }) => void;
}) {
  const clock = options.clock ?? (() => 1_000);
  const budget = new RequestBudget(
    options.maximum ?? 16,
    options.deadline ?? 100_000,
    0,
    clock,
  );
  return {
    budget,
    instance: new OpenRouterClient({
      apiKey: 'sk-or-v1-private-value',
      budget,
      fetch: options.fetch,
      delay: options.delay ?? (async () => undefined),
      clock,
      onRetry: options.onRetry,
    }),
  };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    expect(error).toBeInstanceOf(ModelError);
    return (error as ModelError).code;
  }
}

describe('OpenRouter client', () => {
  it('sends the strict structured request and parses usage metadata', async () => {
    let sent: RequestInit | undefined;
    const transport = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      sent = init;
      return success();
    });
    const { instance, budget } = client({ fetch: transport });

    await expect(instance.generate(request, new AbortController().signal)).resolves.toEqual({
      content: { ok: true },
      responseId: 'response-1',
      requestedModel: 'provider/model',
      returnedModel: 'provider/returned-model',
      provider: 'Provider',
      promptTokens: 10,
      completionTokens: 3,
      reportedCostUsd: 0.001,
      elapsedMs: 0,
    });
    const body = JSON.parse(String(sent?.body)) as Record<string, unknown>;
    expect(body).toEqual(
      expect.objectContaining({
        model: request.model,
        stream: false,
        max_tokens: 100,
        reasoning: { effort: 'low', exclude: true },
        provider: { require_parameters: true },
        response_format: expect.objectContaining({ type: 'json_schema' }),
      }),
    );
    expect((sent?.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-or-v1-private-value',
    );
    expect(budget.count).toBe(1);
  });

  it('retries network errors and retryable HTTP/body errors within the cap', async () => {
    const delays: number[] = [];
    const notices: number[] = [];
    const transport = vi
      .fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('socket reset'))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 429, message: 'busy' } },
          { headers: { 'Retry-After': '2' } },
        ),
      )
      .mockResolvedValueOnce(success());
    const { instance, budget } = client({
      fetch: transport,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
      onRetry: ({ retryNumber }) => notices.push(retryNumber),
    });

    await expect(instance.generate(request, new AbortController().signal)).resolves.toMatchObject({
      content: { ok: true },
    });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1_000, 3_000]);
    expect(notices).toEqual([1, 2]);
    expect(budget.count).toBe(3);
  });

  it('retries empty and truncated successful completions with a larger output budget', async () => {
    const sentBudgets: number[] = [];
    const transport = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { max_tokens: number };
      sentBudgets.push(body.max_tokens);
      if (sentBudgets.length === 1) {
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] });
      }
      if (sentBudgets.length === 2) {
        return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] });
      }
      return success();
    });
    const { instance } = client({ fetch: transport, delay: async () => undefined });

    await expect(instance.generate(request, new AbortController().signal)).resolves.toMatchObject({
      content: { ok: true },
    });
    expect(sentBudgets).toEqual([100, 2_148, 4_196]);
  });

  it('accepts one fenced structured JSON object from a lower-cost model', async () => {
    const { instance } = client({
      fetch: async () => success('```json\n{"ok":true}\n```'),
    });

    await expect(instance.generate(request, new AbortController().signal)).resolves.toMatchObject({
      content: { ok: true },
    });
  });

  it('honors a longer Retry-After value', async () => {
    const delays: number[] = [];
    const transport = vi
      .fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'slow down' } },
          { status: 429, headers: { 'Retry-After': '7' } },
        ),
      )
      .mockResolvedValueOnce(success());
    const { instance } = client({
      fetch: transport,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await instance.generate(request, new AbortController().signal);
    expect(delays).toEqual([7_000]);
  });

  it('retries timeouts and malformed 5xx response bodies', async () => {
    const transport = vi
      .fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockResolvedValueOnce(new Response('<html>gateway</html>', { status: 503 }))
      .mockResolvedValueOnce(success());
    const { instance, budget } = client({ fetch: transport });

    await expect(instance.generate(request, new AbortController().signal)).resolves.toMatchObject({
      content: { ok: true },
    });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(budget.count).toBe(3);
  });

  it.each([
    [401, 'AUTH_ERROR'],
    [402, 'CREDIT_ERROR'],
    [403, 'AUTH_ERROR'],
    [400, 'HTTP_ERROR'],
  ])('fails fast for HTTP %i', async (status, code) => {
    const transport = vi.fn(async () =>
      Response.json({ error: { message: 'denied' } }, { status }),
    );
    const { instance, budget } = client({ fetch: transport });
    expect(await errorCode(instance.generate(request, new AbortController().signal))).toBe(code);
    expect(transport).toHaveBeenCalledOnce();
    expect(budget.count).toBe(1);
  });

  it.each([
    ['missing choice', Response.json({ choices: [] }), 'EMPTY_RESPONSE'],
    [
      'truncation',
      Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] }),
      'TRUNCATED_RESPONSE',
    ],
    [
      'refusal',
      Response.json({ choices: [{ finish_reason: 'stop', message: { content: '', refusal: 'no' } }] }),
      'REFUSED_RESPONSE',
    ],
    [
      'empty content',
      Response.json({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }),
      'EMPTY_RESPONSE',
    ],
    [
      'malformed content',
      Response.json({ choices: [{ finish_reason: 'stop', message: { content: '```json' } }] }),
      'MALFORMED_CONTENT',
    ],
    ['schema-invalid content', success('{"ok":"yes"}'), 'SCHEMA_VALIDATION'],
  ])('rejects %s', async (_label, response, code) => {
    const { instance } = client({ fetch: async () => response.clone(), delay: async () => undefined });
    expect(await errorCode(instance.generate(request, new AbortController().signal))).toBe(code);
  });

  it('rejects non-JSON response bodies', async () => {
    const { instance } = client({
      fetch: async () => new Response('<html>bad gateway</html>', { status: 200 }),
    });
    expect(await errorCode(instance.generate(request, new AbortController().signal))).toBe(
      'MALFORMED_RESPONSE',
    );
  });

  it('enforces request, active-time, context, and schema limits before transport', async () => {
    const transport = vi.fn(async () => success());
    const exhausted = client({ fetch: transport, maximum: 1 });
    await exhausted.instance.generate(request, new AbortController().signal);
    expect(await errorCode(exhausted.instance.generate(request, new AbortController().signal))).toBe(
      'REQUEST_LIMIT',
    );
    const expired = client({ fetch: transport, deadline: 500 });
    expect(await errorCode(expired.instance.generate(request, new AbortController().signal))).toBe(
      'TIME_LIMIT',
    );
    const limited = new OpenRouterClient({
      apiKey: 'secret',
      budget: new RequestBudget(2, 10_000, 0, () => 0),
      fetch: transport,
      contextLimitBytes: 5,
      schemaLimitBytes: 5,
      clock: () => 0,
    });
    expect(await errorCode(limited.generate(request, new AbortController().signal))).toBe(
      'CONTEXT_LIMIT',
    );
    const schemaLimited = new OpenRouterClient({
      apiKey: 'secret',
      budget: new RequestBudget(2, 10_000, 0, () => 0),
      fetch: transport,
      contextLimitBytes: 1_000,
      schemaLimitBytes: 5,
      clock: () => 0,
    });
    expect(
      await errorCode(
        schemaLimited.generate(
          { ...request, system: '', user: '' },
          new AbortController().signal,
        ),
      ),
    ).toBe('SCHEMA_LIMIT');
  });

  it('redacts API-key-shaped values from transport errors', async () => {
    const { instance } = client({
      fetch: async () => {
        throw new Error('failed with Bearer sk-or-v1-leakedvalue');
      },
    });
    try {
      await instance.generate(request, new AbortController().signal);
    } catch (error) {
      expect(String(error)).not.toContain('leakedvalue');
      expect(String(error)).toContain('[REDACTED]');
    }
  });
});

describe('OpenRouter configuration', () => {
  it('applies role overrides and excludes the key from public config', () => {
    const config = loadToolkitConfig({
      env: {
        OPENROUTER_API_KEY: 'secret',
        OPENROUTER_MODEL: 'small/default',
        OPENROUTER_LOGIC_MODEL: 'small/logic',
      },
    });
    expect(config.models.logic).toBe('small/logic');
    expect(config.models.art).toBe('small/default');
    expect(publicConfig(config)).not.toHaveProperty('apiKey');
    expect(JSON.stringify(publicConfig(config))).not.toContain('secret');
  });

  it('rejects missing credentials and model IDs for generation', () => {
    expect(() => loadToolkitConfig({ env: {}, cwd: 'Z:/missing' })).toThrow(
      /OPENROUTER_API_KEY/u,
    );
    expect(() =>
      loadToolkitConfig({ env: { OPENROUTER_API_KEY: 'secret' }, cwd: 'Z:/missing' }),
    ).toThrow(/Configure OPENROUTER_MODEL/u);
  });

  it('keeps .env values when inherited variables are empty', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'game-maker-config-'));
    writeFileSync(
      path.join(cwd, '.env'),
      'OPENROUTER_API_KEY=from-file\nOPENROUTER_MODEL=file-model\n',
    );

    const config = loadToolkitConfig({
      cwd,
      env: { OPENROUTER_API_KEY: '', OPENROUTER_MODEL: '' },
    });

    expect(config.apiKey).toBe('from-file');
    expect(config.models.spec).toBe('file-model');
  });
});
