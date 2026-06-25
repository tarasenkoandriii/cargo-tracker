import { Injectable } from '@nestjs/common';
import {
  DetectionResult,
  ShipmentInput,
  ShipmentType,
  TrackResult,
} from '../models';

export interface BuildArgs {
  input: ShipmentInput;
  detection: DetectionResult;
  result: TrackResult;
  primarySource: string | null;
  retrievedAt: string;
  debug?: unknown;
}

/**
 * Assembles the stable public JSON for one shipment (ТЗ §8). The structure
 * never changes shape: missing values are `null` or `[]`, never omitted.
 */
@Injectable()
export class ResponseBuilder {
  buildFull(args: BuildArgs): Record<string, unknown> {
    const { input, detection, result, primarySource, retrievedAt, debug } = args;
    const events = result.events ?? [];
    const last = events.length ? events[events.length - 1] : null;

    const allWarnings = [...detection.warnings, ...(result.warnings ?? [])];
    const errors = result.error ? [result.error] : [];
    const { confidence, dataComplete, missing } = this.quality(detection.type, result, errors.length > 0);
    if (!dataComplete && result.found && !errors.length) {
      // Found, but key fields missing → flag PARTIAL_DATA (ТЗ §9).
      errors.push({
        code: 'PARTIAL_DATA',
        message: `Missing key fields: ${missing.join(', ')}`,
        source: result.source_name,
      });
    }

    return {
      input: { id: input.id ?? null, number: input.number },
      detected: {
        type: detection.type,
        normalized_number: detection.normalized_number,
        carrier: detection.carrier ?? result.carrier ?? null,
      },
      tracking: {
        current_status: result.current_status,
        raw_status: result.raw_status,
        last_event: last
          ? {
              event_code: last.event_code,
              event_name: last.event_name,
              location: last.location,
              datetime: last.datetime,
              is_actual: last.is_actual,
            }
          : null,
        dates: {
          etd: result.etd,
          eta: result.eta,
          actual_departure: result.actual_departure,
          actual_arrival: result.actual_arrival,
        },
        route: {
          origin: result.origin,
          destination: result.destination,
          transit_points: result.transit_points ?? [],
        },
        events: events.map((e) => ({
          event_code: e.event_code,
          event_name: e.event_name,
          normalized_status: e.normalized_status,
          location: e.location,
          datetime: e.datetime,
          raw_text: e.raw_text,
        })),
        container_milestones:
          detection.type === ShipmentType.SEA ? result.container_milestones ?? {} : {},
      },
      source: {
        primary_source: primarySource,
        final_source: result.source_name,
        url: result.url,
        retrieved_at: retrievedAt,
      },
      quality: {
        confidence,
        data_complete: dataComplete,
        missing_fields: missing,
        warnings: allWarnings,
      },
      errors,
      ...(debug ? { debug } : {}),
    };
  }

  buildShort(full: Record<string, unknown>): Record<string, unknown> {
    const input = full.input as any;
    const detected = full.detected as any;
    const tracking = full.tracking as any;
    const source = full.source as any;
    return {
      id: input.id,
      number: input.number,
      type: detected.type,
      current_status: tracking.current_status,
      eta: tracking.dates.eta,
      etd: tracking.dates.etd,
      last_event_at: tracking.last_event?.datetime ?? null,
      source: source.final_source,
      errors: full.errors,
    };
  }

  private quality(
    type: ShipmentType,
    r: TrackResult,
    hasError: boolean,
  ): { confidence: number; dataComplete: boolean; missing: string[] } {
    if (!r.found) {
      return { confidence: hasError ? 0.1 : 0.0, dataComplete: false, missing: ['tracking'] };
    }
    const keys: Array<[string, unknown]> = [
      ['current_status', r.current_status],
      ['eta', r.eta],
      ['etd', r.etd],
      ['origin', r.origin],
      ['destination', r.destination],
      ['events', r.events.length ? true : null],
    ];
    if (type === ShipmentType.AIR) keys.push(['actual_departure', r.actual_departure]);
    if (type === ShipmentType.SEA) keys.push(['actual_arrival', r.actual_arrival]);

    const missing = keys.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
    const present = keys.length - missing.length;
    const confidence = Math.round((present / keys.length) * 100) / 100;
    return { confidence, dataComplete: missing.length === 0, missing };
  }
}
