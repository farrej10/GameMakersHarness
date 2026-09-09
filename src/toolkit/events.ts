import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { RunEvent } from '../contracts/index';
import { getValidationErrors, validateRunEvent } from '../contracts/index';

type EventInput = Omit<RunEvent, 'schemaVersion' | 'sequence' | 'runId' | 'at'>;

export class EventWriter {
  private sequence: number;

  public constructor(
    private readonly runId: string,
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.sequence = existsSync(filePath)
      ? readFileSync(filePath, 'utf8').split(/\r?\n/u).filter(Boolean).length
      : 0;
  }

  public append(input: EventInput): RunEvent {
    const event = {
      schemaVersion: 1,
      sequence: this.sequence + 1,
      runId: this.runId,
      at: this.now().toISOString(),
      ...input,
    } as RunEvent;
    if (!validateRunEvent(event)) {
      throw new Error(
        `Refusing to write an invalid run event: ${JSON.stringify(
          getValidationErrors(validateRunEvent),
        )}`,
      );
    }
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
    this.sequence += 1;
    return event;
  }
}

export function readEvents(filePath: string): RunEvent[] {
  if (!existsSync(filePath)) return [];
  let expectedSequence = 1;
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (!validateRunEvent(value)) {
        throw new Error(
          `Invalid event at sequence ${expectedSequence}: ${JSON.stringify(
            getValidationErrors(validateRunEvent),
          )}`,
        );
      }
      if (value.sequence !== expectedSequence) {
        throw new Error(`Event sequence is not monotonic at ${value.sequence}.`);
      }
      expectedSequence += 1;
      return value;
    });
}
