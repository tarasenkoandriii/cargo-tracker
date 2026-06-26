import { describe, it, expect } from 'vitest';
import { makeErrorResult, patchRow, runPool, summarize } from './rows';
import type { RowState } from './types';

describe('runPool', () => {
  it('processes every item with bounded concurrency', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const seen: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    await runPool(items, 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(n);
      inFlight--;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('passes the correct index to the worker', async () => {
    const idx: number[] = [];
    await runPool(['a', 'b', 'c'], 2, async (_item, i) => {
      idx.push(i);
    });
    expect(idx.sort()).toEqual([0, 1, 2]);
  });
});

describe('makeErrorResult', () => {
  it('produces a renderable result carrying a SOURCE_UNAVAILABLE error', () => {
    const r = makeErrorResult({ id: 'S1', number: '080-1' }, 'boom');
    expect(r.input.number).toBe('080-1');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe('SOURCE_UNAVAILABLE');
    expect(r.errors[0].message).toBe('boom');
    expect(r.tracking.events).toEqual([]);
  });
});

describe('summarize', () => {
  const mk = (loading: boolean, errs: number): RowState => ({
    input: { number: 'n' },
    loading,
    result: loading
      ? null
      : (makeErrorResultWith(errs) as RowState['result']),
  });
  function makeErrorResultWith(n: number) {
    const base = makeErrorResult({ number: 'n' }, 'e');
    base.errors = n ? base.errors : [];
    return base;
  }

  it('counts pending, success and failed', () => {
    const rows: RowState[] = [mk(true, 0), mk(false, 0), mk(false, 1), mk(false, 0)];
    expect(summarize(rows)).toEqual({ total: 4, pending: 1, success: 2, failed: 1 });
  });

  it('treats a still-loading row as pending regardless of prior result', () => {
    expect(summarize([mk(true, 0)])).toEqual({ total: 1, pending: 1, success: 0, failed: 0 });
  });
});

describe('patchRow', () => {
  const rows: RowState[] = [
    { input: { number: 'a' }, loading: true, result: null },
    { input: { number: 'b' }, loading: true, result: null },
  ];

  it('immutably patches a single row by index', () => {
    const next = patchRow(rows, 1, { loading: false })!;
    expect(next).not.toBe(rows);
    expect(next[1].loading).toBe(false);
    expect(next[0].loading).toBe(true);
    expect(rows[1].loading).toBe(true); // original untouched
  });

  it('returns input unchanged for null rows', () => {
    expect(patchRow(null, 0, { loading: false })).toBeNull();
  });
});
