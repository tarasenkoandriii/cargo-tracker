import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseBuilder, BuildArgs } from './response.builder';
import {
  DetectionResult,
  ShipmentType,
  TrackResult,
  emptyTrackResult,
} from '../models';

function detection(type: ShipmentType): DetectionResult {
  return { type, normalized_number: 'X', carrier: null, warnings: [] };
}

function buildArgs(type: ShipmentType, patch: Partial<TrackResult>): BuildArgs {
  const result: TrackResult = {
    ...emptyTrackResult(),
    found: true,
    events: [
      {
        event_code: 'X',
        event_name: 'e',
        normalized_status: null,
        location: 'A',
        datetime: '2026-01-01T00:00:00Z',
        raw_text: null,
      } as TrackResult['events'][number],
    ],
    eta: '2026-08-10',
    origin: 'NINGBO',
    destination: 'GDANSK',
    source_name: 'pier2pier.com',
    ...patch,
  };
  return {
    input: { id: 'S1', number: 'X' },
    detection: detection(type),
    result,
    primarySource: 'pier2pier.com',
    retrievedAt: '2026-06-26T00:00:00Z',
  };
}

const isPartial = (res: Record<string, unknown>) =>
  (res.errors as Array<{ code: string }>).some((e) => e.code === 'PARTIAL_DATA');

describe('ResponseBuilder.buildFull — stage-aware completeness', () => {
  let b: ResponseBuilder;
  beforeEach(() => {
    b = new ResponseBuilder();
  });

  it('does NOT flag PARTIAL_DATA for an in-transit SEA container missing actual_arrival/etd', () => {
    const res = b.buildFull(
      buildArgs(ShipmentType.SEA, {
        current_status: 'in_transit',
        actual_arrival: null,
        etd: null,
      }),
    );
    expect(isPartial(res)).toBe(false);
    const q = res.quality as { data_complete: boolean; missing_fields: string[] };
    expect(q.data_complete).toBe(true);
    // still surfaced informationally
    expect(q.missing_fields).toEqual(expect.arrayContaining(['etd', 'actual_arrival']));
  });

  it('does NOT flag PARTIAL_DATA for a returned SEA container that HAS actual_arrival', () => {
    const res = b.buildFull(
      buildArgs(ShipmentType.SEA, {
        current_status: 'container_returned',
        actual_arrival: '2026-05-26T00:00:00Z',
        etd: null,
      }),
    );
    expect(isPartial(res)).toBe(false);
  });

  it('DOES flag PARTIAL_DATA for a post-arrival SEA container missing actual_arrival', () => {
    const res = b.buildFull(
      buildArgs(ShipmentType.SEA, {
        current_status: 'container_returned',
        actual_arrival: null,
      }),
    );
    expect(isPartial(res)).toBe(true);
  });

  it('DOES flag PARTIAL_DATA when a core field (origin) is missing', () => {
    const res = b.buildFull(
      buildArgs(ShipmentType.SEA, { current_status: 'in_transit', origin: null }),
    );
    expect(isPartial(res)).toBe(true);
  });

  it('does NOT flag PARTIAL_DATA for a delivered AIR shipment with actual_departure', () => {
    const res = b.buildFull(
      buildArgs(ShipmentType.AIR, {
        current_status: 'delivered',
        actual_departure: '2026-05-25T00:00:00Z',
        etd: '2026-05-24',
      }),
    );
    expect(isPartial(res)).toBe(false);
  });
});

describe('ResponseBuilder.buildFull — source_variant passthrough', () => {
  it('exposes the markup-parser variant in source.source_variant', () => {
    const b = new ResponseBuilder();
    const res = b.buildFull(
      buildArgs(ShipmentType.SEA, {
        current_status: 'in_transit',
        source_variant: 'hapag-lloyd',
      }),
    );
    const source = res.source as { source_variant: string | null; final_source: string | null };
    expect(source.final_source).toBe('pier2pier.com');
    expect(source.source_variant).toBe('hapag-lloyd');
  });

  it('defaults source_variant to null when unset', () => {
    const b = new ResponseBuilder();
    const res = b.buildFull(buildArgs(ShipmentType.AIR, { current_status: 'delivered' }));
    expect((res.source as { source_variant: unknown }).source_variant).toBeNull();
  });
});
