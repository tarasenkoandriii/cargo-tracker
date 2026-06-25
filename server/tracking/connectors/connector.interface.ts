import { ShipmentType, TrackResult } from '../models';
import { ShipmentLogger } from '../logger';

export interface TrackContext {
  normalizedNumber: string;
  type: ShipmentType;
  userCarrierHint?: string | null;
  logger: ShipmentLogger;
}

/**
 * A source connector isolates the logic for one tracking source (a website or
 * an API). New carriers/sources are added by implementing this interface and
 * registering the connector in the SourceRouter (ТЗ §10, criterion §13.14).
 */
export interface Connector {
  /** Stable identifier used in the `source` block and logs. */
  readonly name: string;

  /** Whether this connector can handle the given shipment type. */
  supports(type: ShipmentType): boolean;

  /** Attempt to fetch tracking data. Must never throw — return an error result. */
  fetch(ctx: TrackContext): Promise<TrackResult>;
}

/** Wrap a promise with a timeout that rejects with a tagged error. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export class TimeoutError extends Error {}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a thunk for transient failures (ТЗ §11). Timeouts are not retried. */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts: number,
  delayMs: number,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof TimeoutError || i === attempts) break;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

/** fetch() with an AbortController-based timeout. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new TimeoutError(`Request to ${url} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}
