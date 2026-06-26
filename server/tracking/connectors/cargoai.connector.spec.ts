import { describe, it, expect, beforeEach } from 'vitest';
import { CargoaiConnector } from './cargoai.connector';
import { NormalizerService } from '../normalizer/normalizer.service';

const DELIVERED = [
  {
    awb: '080-12345678',
    origin: 'ICN',
    destination: 'WAW',
    status: 'Delivered',
    events: [
      { code: 'RCS', eventDate: '2026-05-20T08:00:00Z', eventLocation: 'ICN', isPlanned: false },
      {
        code: 'DEP',
        eventLocation: 'ICN',
        isPlanned: false,
        flight: {
          scheduledDeparture: '2026-05-21T10:00:00Z',
          actualDeparture: '2026-05-21T10:30:00Z',
          scheduledArrival: '2026-05-22T06:00:00Z',
          actualArrival: '2026-05-22T06:45:00Z',
          destination: 'WAW',
        },
      },
      { code: 'DLV', eventDate: '2026-05-23T14:00:00Z', eventLocation: 'WAW', isPlanned: false },
    ],
  },
];

describe('CargoaiConnector — response mapper', () => {
  let c: CargoaiConnector;
  beforeEach(() => {
    c = new CargoaiConnector(new NormalizerService());
  });

  it('maps a delivered AWB: status, route, trip dates and events', () => {
    const r = c.mapForTest(DELIVERED);
    expect(r.found).toBe(true);
    expect(r.current_status).toBe('delivered'); // latest actual-dated event (DLV)
    expect(r.origin).toBe('ICN');
    expect(r.destination).toBe('WAW');
    expect(r.events).toHaveLength(3);
  });

  it('derives etd/eta and actual departure/arrival from flight legs', () => {
    const r = c.mapForTest(DELIVERED);
    expect(r.etd).toBe('2026-05-21T10:00:00Z');
    expect(r.eta).toBe('2026-05-22T06:00:00Z');
    expect(r.actual_departure).toBe('2026-05-21T10:30:00Z');
    expect(r.actual_arrival).toBe('2026-05-22T06:45:00Z');
  });

  it('orders events chronologically (DEP uses its flight actualDeparture)', () => {
    const r = c.mapForTest(DELIVERED);
    expect(r.events.map((e) => e.event_code)).toEqual(['RCS', 'DEP', 'DLV']);
  });

  it('maps IATA milestone codes to normalized statuses', () => {
    const r = c.mapForTest(DELIVERED);
    const byCode = Object.fromEntries(r.events.map((e) => [e.event_code, e.normalized_status]));
    expect(byCode.RCS).toBe('received');
    expect(byCode.DEP).toBe('departed');
    expect(byCode.DLV).toBe('delivered');
  });

  it('flags NOT_FOUND when the shipment has no events', () => {
    const r = c.mapForTest([{ awb: 'X', events: [] }]);
    expect(r.found).toBe(false);
    expect(r.error?.code).toBe('NOT_FOUND');
  });

  it('handles an empty/garbage payload without throwing', () => {
    expect(c.mapForTest([]).found).toBe(false);
    expect(c.mapForTest(null).found).toBe(false);
  });
});
