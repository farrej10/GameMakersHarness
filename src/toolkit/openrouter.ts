import Ajv, { type ValidateFunction } from 'ajv';

export type ModelRole = 'spec' | 'logic' | 'level' | 'art' | 'repair';
export type ModelRequest = {
  requestId: string;
  role: ModelRole;
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  maxOutputTokens: number;
};
export type ModelResult = {
  content: unknown;
  responseId: string;
  requestedModel: string;
  returnedModel: string;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reportedCostUsd: number | null;
  elapsedMs: number;
};
export interface ModelClient {
  generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResult>;
}

export type RetryNotice = {
  requestId: string;
  retryNumber: number;
  reason: string;
  delayMs: number;
};

export class ModelError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export class RequestBudget {
  private reserved: number;

  public constructor(
    public readonly maximum: number,
    public readonly deadlineMs: number,
    initialReserved = 0,
    private readonly clock: () => number = Date.now,
  ) {
    if (!Number.isInteger(maximum) || maximum < 1) throw new Error('Request maximum must be positive.');
    if (!Number.isInteger(initialReserved) || initialReserved < 0 || initialReserved > maximum) {
      throw new Error('Initial request count is invalid.');
    }
    this.reserved = initialReserved;
  }

  public reserve(): number {
    if (this.clock() >= this.deadlineMs) throw new ModelError('TIME_LIMIT', 'Active execution time limit reached.');
    if (this.reserved >= this.maximum) throw new ModelError('REQUEST_LIMIT', 'Completion request limit reached.');
    this.reserved += 1;
    return this.reserved;
  }

  public get count(): number {
    return this.reserved;
  }

  public get remainingTimeMs(): number {
    return Math.max(0, this.deadlineMs - this.clock());
  }
}

type FetchTransport = (input: string | URL, init?: RequestInit) => Promise<Response>;
type OpenRouterOptions = {
  apiKey: string;
  budget: RequestBudget;
  fetch?: FetchTransport;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  clock?: () => number;
  requestTimeoutMs?: number;
  contextLimitBytes?: number;
  schemaLimitBytes?: number;
  onRetry?: (notice: RetryNotice) => void;
};

const encoder = new TextEncoder();
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sanitize(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replaceAll(/Bearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replaceAll(/sk-or-v1-[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .slice(0, 2_000);
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function defaultDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
      },
      { once: true },
    );
  });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStructuredContent(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const unfenced = text
      .replace(/^\s*```(?:json)?\s*/iu, '')
      .replace(/\s*```\s*$/u, '')
      .trim();
    try {
      return JSON.parse(unfenced);
    } catch {
      const start = unfenced.indexOf('{');
      const end = unfenced.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
      throw new ModelError('MALFORMED_CONTENT', 'Completion content is not valid JSON.');
    }
  }
}

function errorFromResponse(status: number, body: unknown): ModelError {
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  const nested = typeof record.error === 'object' && record.error !== null
    ? record.error as Record<string, unknown>
    : record;
  const message = sanitize(nested.message ?? `OpenRouter returned HTTP ${status}.`);
  const code = status === 401 || status === 403
    ? 'AUTH_ERROR'
    : status === 402
      ? 'CREDIT_ERROR'
      : RETRYABLE_STATUS.has(status)
        ? 'RETRYABLE_HTTP'
        : 'HTTP_ERROR';
  return new ModelError(code, message, status);
}

export class OpenRouterClient implements ModelClient {
  private readonly transport: FetchTransport;
  private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly clock: () => number;
  private readonly timeoutMs: number;
  private readonly contextLimitBytes: number;
  private readonly schemaLimitBytes: number;
  private readonly ajv = new Ajv({ allErrors: true, strict: false });

  public constructor(private readonly options: OpenRouterOptions) {
    if (!options.apiKey.trim()) throw new ModelError('CONFIG_ERROR', 'OpenRouter API key is empty.');
    this.transport = options.fetch ?? globalThis.fetch;
    this.delay = options.delay ?? defaultDelay;
    this.clock = options.clock ?? Date.now;
    this.timeoutMs = options.requestTimeoutMs ?? 90_000;
    this.contextLimitBytes = options.contextLimitBytes ?? 24_000;
    this.schemaLimitBytes = options.schemaLimitBytes ?? 24_000;
  }

  public async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResult> {
    if (!request.model.trim()) throw new ModelError('CONFIG_ERROR', 'A model ID is required.');
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
      throw new ModelError('CONFIG_ERROR', 'maxOutputTokens must be a positive integer.');
    }
    if (encoder.encode(request.system).length + encoder.encode(request.user).length > this.contextLimitBytes) {
      throw new ModelError('CONTEXT_LIMIT', 'Combined system and user context exceeds 24000 bytes.');
    }
    const schemaText = JSON.stringify(request.schema);
    if (encoder.encode(schemaText).length > this.schemaLimitBytes) {
      throw new ModelError('SCHEMA_LIMIT', 'Response schema exceeds 24000 bytes.');
    }
    let validator: ValidateFunction;
    try {
      validator = this.ajv.compile(request.schema);
    } catch (error) {
      throw new ModelError('SCHEMA_ERROR', `Invalid response schema: ${sanitize(error)}`);
    }

    const started = this.clock();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.options.budget.reserve();
      const timeoutSignal = AbortSignal.timeout(
        Math.min(this.timeoutMs, Math.max(1, this.options.budget.remainingTimeMs)),
      );
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
      try {
        const response = await this.transport(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: request.model,
              stream: false,
              messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.user },
              ],
              max_tokens: request.maxOutputTokens + attempt * 2_048,
              reasoning: { effort: 'low', exclude: true },
              provider: { require_parameters: true },
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: request.schemaName,
                  strict: true,
                  schema: request.schema,
                },
              },
            }),
            signal: combinedSignal,
          },
        );
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          if (attempt < 2 && RETRYABLE_STATUS.has(response.status)) {
            const requestedDelay = parseRetryAfter(response.headers.get('retry-after'), this.clock());
            const delayMs = Math.max(requestedDelay ?? 0, attempt === 0 ? 1_000 : 3_000);
            if (delayMs >= this.options.budget.remainingTimeMs) {
              throw new ModelError('TIME_LIMIT', 'Retry delay exceeds remaining active time.');
            }
            this.options.onRetry?.({
              requestId: request.requestId,
              retryNumber: attempt + 1,
              reason: `OpenRouter returned malformed HTTP ${response.status} content.`,
              delayMs,
            });
            await this.delay(delayMs, signal);
            continue;
          }
          throw new ModelError('MALFORMED_RESPONSE', 'OpenRouter returned a non-JSON response.', response.status);
        }
        const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
        const bodyStatus = numberOrNull(
          typeof record.error === 'object' && record.error !== null
            ? (record.error as Record<string, unknown>).code
            : null,
        );
        if (!response.ok || record.error) {
          const error = errorFromResponse(bodyStatus ?? response.status, body);
          if (attempt < 2 && error.code === 'RETRYABLE_HTTP') {
            const requestedDelay = parseRetryAfter(response.headers.get('retry-after'), this.clock());
            const delayMs = Math.max(requestedDelay ?? 0, attempt === 0 ? 1_000 : 3_000);
            if (delayMs >= this.options.budget.remainingTimeMs) {
              throw new ModelError('TIME_LIMIT', 'Retry delay exceeds remaining active time.');
            }
            this.options.onRetry?.({
              requestId: request.requestId,
              retryNumber: attempt + 1,
              reason: error.message,
              delayMs,
            });
            await this.delay(delayMs, signal);
            continue;
          }
          throw error;
        }
        const choices = Array.isArray(record.choices) ? record.choices : [];
        const choice = choices[0] as Record<string, unknown> | undefined;
        const message = choice && typeof choice.message === 'object' && choice.message !== null
          ? choice.message as Record<string, unknown>
          : undefined;
        if (message?.refusal || message?.error) {
          throw new ModelError('REFUSED_RESPONSE', sanitize(message.refusal ?? message.error));
        }
        const completionProblem = !choice || !message
          ? new ModelError('EMPTY_RESPONSE', 'OpenRouter returned no completion choice.')
          : choice.finish_reason === 'length' || choice.finish_reason === 'max_tokens'
            ? new ModelError('TRUNCATED_RESPONSE', 'OpenRouter truncated the completion.')
            : typeof message.content !== 'string' || !message.content.trim()
              ? new ModelError('EMPTY_RESPONSE', 'OpenRouter returned empty completion content.')
              : null;
        if (completionProblem) {
          if (attempt < 2) {
            const delayMs = attempt === 0 ? 1_000 : 3_000;
            this.options.onRetry?.({
              requestId: request.requestId,
              retryNumber: attempt + 1,
              reason: completionProblem.message,
              delayMs,
            });
            await this.delay(delayMs, signal);
            continue;
          }
          throw completionProblem;
        }
        if (!choice || !message) throw new ModelError('EMPTY_RESPONSE', 'OpenRouter returned no completion choice.');
        if (typeof message.content !== 'string') throw new ModelError('EMPTY_RESPONSE', 'OpenRouter returned empty completion content.');
        let content: unknown;
        try {
          content = parseStructuredContent(message.content);
        } catch (error) {
          const malformed = error instanceof ModelError
            ? error
            : new ModelError('MALFORMED_CONTENT', 'Completion content is not valid JSON.');
          if (attempt < 2) {
            const delayMs = attempt === 0 ? 1_000 : 3_000;
            this.options.onRetry?.({
              requestId: request.requestId,
              retryNumber: attempt + 1,
              reason: malformed.message,
              delayMs,
            });
            await this.delay(delayMs, signal);
            continue;
          }
          throw malformed;
        }
        if (!validator(content)) {
          throw new ModelError(
            'SCHEMA_VALIDATION',
            `Completion content failed its response schema: ${sanitize(JSON.stringify(validator.errors))}`,
          );
        }
        const usage = typeof record.usage === 'object' && record.usage !== null
          ? record.usage as Record<string, unknown>
          : {};
        return {
          content,
          responseId: typeof record.id === 'string' ? record.id : '',
          requestedModel: request.model,
          returnedModel: typeof record.model === 'string' ? record.model : request.model,
          provider: typeof record.provider === 'string' ? record.provider : null,
          promptTokens: numberOrNull(usage.prompt_tokens),
          completionTokens: numberOrNull(usage.completion_tokens),
          reportedCostUsd: numberOrNull(usage.cost),
          elapsedMs: this.clock() - started,
        };
      } catch (error) {
        if (error instanceof ModelError) throw error;
        if (signal.aborted) throw new ModelError('ABORTED', sanitize(signal.reason ?? error));
        const retryable = attempt < 2;
        if (!retryable) throw new ModelError('NETWORK_ERROR', sanitize(error));
        const delayMs = attempt === 0 ? 1_000 : 3_000;
        if (delayMs >= this.options.budget.remainingTimeMs) {
          throw new ModelError('TIME_LIMIT', 'Retry delay exceeds remaining active time.');
        }
        this.options.onRetry?.({
          requestId: request.requestId,
          retryNumber: attempt + 1,
          reason: sanitize(error),
          delayMs,
        });
        await this.delay(delayMs, signal);
      }
    }
    throw new ModelError('NETWORK_ERROR', 'OpenRouter request attempts were exhausted.');
  }
}
