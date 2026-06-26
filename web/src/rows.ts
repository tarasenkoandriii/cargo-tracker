import type { RowState, ShipmentInputItem, ShipmentResult } from './types';

/**
 * Run `worker` over `items` with at most `limit` in flight at once. Used to
 * fan out per-shipment tracking requests from the browser while keeping the
 * number of concurrent serverless invocations bounded.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i], i);
      }
    }),
  );
}

/**
 * Synthesize a minimal ShipmentResult carrying an error, so a transport-level
 * failure (network / non-2xx) renders in its row like any other error (with the
 * retry button) instead of breaking the table.
 */
export function makeErrorResult(input: ShipmentInputItem, message: string): ShipmentResult {
  return {
    input: { id: input.id ?? null, number: input.number },
    detected: { type: 'unknown', normalized_number: null, carrier: null },
    tracking: {
      current_status: null,
      raw_status: null,
      last_event: null,
      dates: { etd: null, eta: null, actual_departure: null, actual_arrival: null },
      route: { origin: null, destination: null, transit_points: [] },
      events: [],
    },
    source: { primary_source: null, final_source: null, url: null, retrieved_at: null },
    quality: { confidence: 0, data_complete: false, missing_fields: [], warnings: [] },
    errors: [{ code: 'SOURCE_UNAVAILABLE', message }],
  };
}

export interface RowSummary {
  total: number;
  success: number;
  failed: number;
  pending: number;
}

/** Live tally derived from current row states (updates as rows stream in). */
export function summarize(rows: RowState[]): RowSummary {
  let success = 0;
  let failed = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.loading) pending++;
    else if (r.result && r.result.errors.length === 0) success++;
    else failed++;
  }
  return { total: rows.length, success, failed, pending };
}

/** Immutably patch one row by index. */
export function patchRow(
  rows: RowState[] | null,
  index: number,
  patch: Partial<RowState>,
): RowState[] | null {
  if (!rows) return rows;
  const copy = rows.slice();
  if (copy[index]) copy[index] = { ...copy[index], ...patch };
  return copy;
}
