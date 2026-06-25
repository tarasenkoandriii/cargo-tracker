import { Injectable } from '@nestjs/common';
import {
  Carrier,
  ErrorCode,
  emptyTrackResult,
  NormalizedStatus,
  ShipmentType,
  TrackingEvent,
  TrackResult,
} from '../models';
import { Connector, TrackContext } from './connector.interface';

/**
 * DEMO connector — deterministic synthetic data, used when DEMO_MODE is on.
 *
 * Why it exists: Vercel Hobby serverless functions cannot run a headless
 * browser, and live tracking sources require credentials / are anti-bot
 * protected. To demonstrate the full pipeline and JSON schema offline, this
 * connector generates plausible-but-fake data deterministically from the
 * number itself. It is NOT a lookup table of specific numbers (ТЗ §13) — it
 * is a pure function of the input — and every result is clearly flagged with
 * `source: "demo"` and a `demo_mode_synthetic_data` warning so it can never be
 * mistaken for real tracking (the agent never invents real data — ТЗ §10.1).
 */
@Injectable()
export class DemoConnector implements Connector {
  readonly name = 'demo';

  supports(): boolean {
    return true;
  }

  async fetch(ctx: TrackContext): Promise<TrackResult> {
    const { normalizedNumber, type, logger } = ctx;
    logger.add('query_demo', 'info', { note: 'synthetic data (DEMO_MODE)' });
    const h = hash(normalizedNumber);

    // Scenario 2 (ТЗ §2): a valid number with no tracking data found.
    if (h % 6 === 0) {
      const r = emptyTrackResult();
      r.found = false;
      r.source_name = this.name;
      r.error = {
        code: ErrorCode.NOT_FOUND,
        message: 'No tracking data found for this number (synthetic demo).',
        source: this.name,
      };
      logger.add('build_result', 'success', { found: false });
      return r;
    }

    // Scenario 1: a valid number with tracking data.
    return type === ShipmentType.SEA
      ? this.sea(normalizedNumber, ctx.userCarrierHint ?? null, h)
      : this.air(normalizedNumber, ctx.userCarrierHint ?? null, h);
  }

  private air(num: string, hint: string | null, h: number): TrackResult {
    const r = emptyTrackResult();
    const airports = ['HKG', 'PVG', 'ICN', 'DXB', 'DOH', 'IST', 'FRA', 'CDG', 'WAW', 'KBP'];
    const origin = airports[h % 4];
    const dest = airports[6 + (h % 4)];
    const transit = airports[4 + (h % 2)];
    const base = Date.now() - (3 + (h % 4)) * 86400000;

    const seq: Array<[string, string, NormalizedStatus, string, number]> = [
      ['RCS', 'Cargo received from shipper', 'received', origin, 0],
      ['DEP', 'Departed origin airport', 'departed', origin, 8],
      ['MAN', 'In transit (transfer)', 'in_transit', transit, 30],
      ['RCF', 'Arrived at destination airport', 'arrived', dest, 54],
    ];
    // progress depends on the number so different shipments show different stages
    const stage = 1 + (h % seq.length);
    const events: TrackingEvent[] = seq.slice(0, stage).map(([code, name, status, loc, hrs]) => ({
      event_code: code,
      event_name: name,
      normalized_status: status,
      location: loc,
      datetime: iso(base + hrs * 3600000),
      raw_text: `${name} at ${loc}`,
      raw_datetime: null,
      is_actual: true,
      timezone: '+00:00',
      timezone_confidence: 'source_provided',
    }));

    const last = events[events.length - 1];
    r.found = true;
    r.carrier = this.carrier(hint, 'XX');
    r.current_status = last.normalized_status;
    r.raw_status = last.raw_text;
    r.events = events;
    r.etd = iso(base + 7 * 3600000);
    r.eta = iso(base + 60 * 3600000);
    r.actual_departure = stage >= 2 ? iso(base + 8 * 3600000) : null;
    r.actual_arrival = stage >= 4 ? iso(base + 54 * 3600000) : null;
    r.origin = origin;
    r.destination = dest;
    r.transit_points = stage >= 3 ? [transit] : [];
    r.source_name = this.name;
    r.url = 'https://www.track-trace.com/aircargo';
    r.warnings = ['demo_mode_synthetic_data'];
    return r;
  }

  private sea(num: string, hint: string | null, h: number): TrackResult {
    const r = emptyTrackResult();
    const ports = ['CNSHA', 'CNNGB', 'SGSIN', 'AEJEA', 'NLRTM', 'DEHAM', 'PLGDN', 'UAODS'];
    const origin = ports[h % 3];
    const dest = ports[5 + (h % 3)];
    const transit = ports[3 + (h % 2)];
    const base = Date.now() - (10 + (h % 8)) * 86400000;

    const seq: Array<[string, string, NormalizedStatus, string, number, Record<string, unknown>]> = [
      ['GTOT-MT', 'Gate out empty', 'container_picked_up', origin, 0, { depot: origin }],
      ['GTIN', 'Gate in full', 'received', origin, 24, {}],
      ['LOAD', 'Loaded on vessel', 'departed', origin, 48, { vessel: 'MV DEMO EXPRESS', voyage: `0${h % 9}E` }],
      ['TS', 'Transshipment', 'in_transit', transit, 200, { vessel: 'MV DEMO EXPRESS' }],
      ['DISC', 'Discharged from vessel', 'arrived', dest, 380, {}],
      ['AVAIL', 'Available for pickup', 'ready_for_pickup', dest, 400, {}],
    ];
    const stage = 2 + (h % (seq.length - 1));
    const events: TrackingEvent[] = seq.slice(0, stage).map(([code, name, status, loc, hrs]) => ({
      event_code: code,
      event_name: name,
      normalized_status: status,
      location: loc,
      datetime: iso(base + hrs * 3600000),
      raw_text: `${name} — ${loc}`,
      raw_datetime: null,
      is_actual: true,
      timezone: '+00:00',
      timezone_confidence: 'source_provided',
    }));

    const last = events[events.length - 1];
    r.found = true;
    r.carrier = this.carrier(hint, null);
    r.current_status = last.normalized_status;
    r.raw_status = last.raw_text;
    r.events = events;
    r.etd = iso(base + 48 * 3600000);
    r.eta = iso(base + 380 * 3600000);
    r.actual_departure = stage >= 3 ? iso(base + 48 * 3600000) : null;
    r.actual_arrival = stage >= 5 ? iso(base + 380 * 3600000) : null;
    r.origin = origin;
    r.destination = dest;
    r.transit_points = stage >= 4 ? [transit] : [];
    r.container_milestones = {
      gate_out_empty: events[0]?.datetime ?? null,
      loaded_on_vessel: stage >= 3 ? events[2].datetime : null,
      discharged: stage >= 5 ? events[4].datetime : null,
    };
    r.source_name = this.name;
    r.url = 'https://www.track-trace.com/container';
    r.warnings = ['demo_mode_synthetic_data'];
    return r;
  }

  private carrier(hint: string | null, code: string | null): Carrier {
    return { name: hint || 'Demo Carrier', code, source: hint ? 'user_hint' : 'source' };
  }
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
