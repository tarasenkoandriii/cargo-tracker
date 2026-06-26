import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import {
  ErrorCode,
  emptyTrackResult,
  NormalizedStatus,
  ShipmentType,
  TrackingEvent,
  TrackResult,
} from '../models';
import {
  Connector,
  TrackContext,
  fetchWithTimeout,
  sleep,
  TimeoutError,
} from './connector.interface';
import { NormalizerService } from '../normalizer/normalizer.service';

/**
 * Per-lane pacing gates for CargoAI/RapidAPI. We run ONE independent queue per
 * API key: each lane spaces the *start* of its own calls >= cargoaiMinGapMs
 * apart, so the two key lanes run in parallel and each key only sees ~half the
 * traffic (no per-second 429 burst on either). Gates are per-invocation
 * (serverless isolates invocations): they pace within a single batch and reset
 * afterwards. They do not serialize the requests themselves — once started, the
 * requests still run concurrently.
 */
const cargoLanes: Array<{ gate: Promise<void>; last: number }> = [];
function acquireCargoSlot(lane: number, minGapMs: number): Promise<void> {
  if (!cargoLanes[lane]) cargoLanes[lane] = { gate: Promise.resolve(), last: 0 };
  const L = cargoLanes[lane];
  L.gate = L.gate.then(async () => {
    const wait = Math.max(0, L.last + minGapMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    L.last = Date.now();
  });
  return L.gate;
}

/**
 * Round-robin counter to split air numbers across keys: even calls -> key 0,
 * odd calls -> key 1, etc. Per-invocation; resets between batches.
 */
let cargoKeyRR = 0;

/**
 * Lazily-built undici ProxyAgent for CargoAI requests. Created once per process
 * only if CARGOAI_PROXY_URL / HTTPS_PROXY is set. If `undici` can't be loaded
 * the proxy is silently disabled (requests go direct) rather than crashing.
 */
let cargoDispatcher: unknown = null;
let cargoDispatcherReady = false;
async function getCargoDispatcher(): Promise<unknown> {
  if (cargoDispatcherReady) return cargoDispatcher;
  cargoDispatcherReady = true;
  const proxy = config.cargoaiProxyUrl;
  if (proxy) {
    try {
      const { ProxyAgent } = await import('undici');
      cargoDispatcher = new ProxyAgent(proxy);
    } catch {
      cargoDispatcher = null; // undici unavailable — go direct
    }
  }
  return cargoDispatcher;
}


/**
 * CargoAI Track & Trace API connector for air cargo (ТЗ §5, §16).
 *
 * Two access modes, auto-selected at runtime:
 *  - RapidAPI: if `RAPIDAPI_KEY` is set, auth uses x-rapidapi-key /
 *    x-rapidapi-host headers (CargoAI distributes via RapidAPI);
 *  - Direct: if `CARGOAI_API_KEY` is set, a Bearer token is used instead.
 * With neither configured it returns a structured LOGIN_REQUIRED error rather
 * than failing. The request/response mapping below follows CargoAI's
 * CargoCONNECT shape and is the single place to adjust to your account.
 */
@Injectable()
export class CargoAiConnector implements Connector {
  readonly name = 'cargoai';

  constructor(private readonly normalizer: NormalizerService) {}

  supports(type: ShipmentType): boolean {
    return type === ShipmentType.AIR;
  }

  async fetch(ctx: TrackContext): Promise<TrackResult> {
    const r = emptyTrackResult();
    r.source_name = this.name;

    // Access mode: RapidAPI (x-rapidapi-key) takes precedence if configured,
    // otherwise a direct Bearer key. Neither set → structured LOGIN_REQUIRED.
    const useRapid = !!config.rapidapiKey;
    const hasAuth = useRapid || !!config.cargoaiApiKey;

    if (!hasAuth) {
      ctx.logger.add('query_cargoai', 'skipped', { reason: 'no_api_key' });
      r.error = {
        code: ErrorCode.LOGIN_REQUIRED,
        message:
          'CargoAI not configured: set RAPIDAPI_KEY (RapidAPI access) or ' +
          'CARGOAI_API_KEY (direct access).',
        source: this.name,
      };
      return r;
    }

    const baseUrl =
      config.cargoaiBaseUrl ||
      (useRapid ? `https://${config.rapidapiHost}` : 'https://api.cargoai.co');

    // Build the available key lanes. Each lane = one API key with its own queue.
    const keySets: Array<{ label: string; headers: Record<string, string> }> = [];
    if (useRapid) {
      keySets.push({
        label: 'key0',
        headers: { 'x-rapidapi-key': config.rapidapiKey!, 'x-rapidapi-host': config.rapidapiHost },
      });
      if (config.rapidapiKeyFallback) {
        keySets.push({
          label: 'key1',
          headers: {
            'x-rapidapi-key': config.rapidapiKeyFallback,
            'x-rapidapi-host': config.rapidapiHost,
          },
        });
      }
    } else {
      keySets.push({ label: 'direct', headers: { authorization: `Bearer ${config.cargoaiApiKey}` } });
    }

    // Split air numbers across keys round-robin (even -> key0, odd -> key1, …).
    // Each key runs its own independent queue, so the keys work in parallel and
    // each only sees ~half the traffic (no per-second 429 burst, no rollover).
    const laneIdx = (cargoKeyRR++ % keySets.length + keySets.length) % keySets.length;
    const lane = keySets[laneIdx];

    // Real CargoAI endpoint: GET /track?awb=NNN-NNNNNNNN (RapidAPI & direct).
    const url = `${baseUrl}/track?awb=${encodeURIComponent(ctx.normalizedNumber)}`;
    r.url = url;

    let data: any;
    const dispatcher = await getCargoDispatcher();
    const doFetch = async (headers: Record<string, string>, timeoutMs: number) => {
      const res = await fetchWithTimeout(
        url,
        { headers: { accept: 'application/json', ...headers } },
        timeoutMs,
        dispatcher,
      );
      if (res.status === 401 || res.status === 403) {
        const e: any = new Error('unauthorized');
        e.code = ErrorCode.LOGIN_REQUIRED;
        e.unauthorized = true;
        throw e;
      }
      if (res.status === 404) {
        const e: any = new Error('not found');
        e.code = ErrorCode.NOT_FOUND;
        e.notFound = true;
        throw e;
      }
      if (res.status === 429) {
        const e: any = new Error('rate limited');
        e.code = ErrorCode.SOURCE_UNAVAILABLE;
        e.rateLimited = true;
        throw e;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };

    const isTimeout = (e: any) =>
      e instanceof TimeoutError || e?.name === 'TimeoutError' || e?.name === 'AbortError';

    try {
      // One assigned key, no cross-key fallback. Retry the SAME key on transient
      // errors only (not timeout / bad key / 404). Pacing runs on this key's lane.
      const attempts = 1 + Math.max(0, config.cargoaiRetries);
      let keyErr: any;
      let succeeded = false;
      for (let i = 0; i < attempts; i++) {
        await acquireCargoSlot(laneIdx, config.cargoaiMinGapMs);
        try {
          data = await doFetch(lane.headers, config.cargoaiTimeoutMs);
          keyErr = undefined;
          succeeded = true;
          break;
        } catch (err: any) {
          keyErr = err;
          if (err?.notFound) throw err;
          const retry = !isTimeout(err) && !err?.unauthorized && i < attempts - 1;
          if (!retry) break;
          ctx.logger.add('query_cargoai', 'info', {
            event: 'retry',
            key: lane.label,
            attempt: i + 1,
            rateLimited: !!err?.rateLimited,
          });
          const base = err?.rateLimited ? config.rateLimitDelayMs * 3 : config.rateLimitDelayMs;
          await sleep(base + 300 * i);
        }
      }

      if (!succeeded) throw keyErr ?? new Error('CargoAI request failed');
    } catch (err: any) {
      ctx.logger.add('query_cargoai', 'error', {
        reason: String(err?.message ?? err),
        key: lane.label,
      });
      r.error = {
        code:
          err?.code ??
          (err instanceof TimeoutError ? ErrorCode.TIMEOUT : ErrorCode.SOURCE_UNAVAILABLE),
        message: err?.message ?? 'CargoAI request failed',
        source: this.name,
      };
      return r;
    }

    ctx.logger.add('query_cargoai', 'success', {
      mode: useRapid ? 'rapidapi' : 'direct',
      key: lane.label,
    });
    return this.map(data, ctx, r);
  }

  /**
   * Maps the CargoAI Track response to the internal TrackResult.
   *
   * Real shape (RapidAPI "Air Cargo Track & Trace"): a JSON array of shipments,
   * each `{ awb, origin, destination, events: [...] }`. Events carry IATA
   * milestone codes (BKD, RCS, FOH, DEP, ARR, RCF, …) and, for flight legs, a
   * nested `flight` block with scheduled/actual departure & arrival times.
   */
  /**
   * Test seam: map a raw CargoAI response into a TrackResult, bypassing HTTP.
   * `map` does not use the request context, so an empty one is passed.
   */
  mapForTest(data: unknown): TrackResult {
    return this.map(data, {} as TrackContext, emptyTrackResult());
  }

  private map(data: any, ctx: TrackContext, r: TrackResult): TrackResult {
    const shipment = Array.isArray(data) ? data[0] : data;
    const rawEvents: any[] = shipment?.events;
    if (!shipment || !Array.isArray(rawEvents) || rawEvents.length === 0) {
      r.error = { code: ErrorCode.NOT_FOUND, message: 'No events returned', source: this.name };
      return r;
    }

    const events: TrackingEvent[] = rawEvents.map((m) => {
      const code: string | null = m?.code ?? null;
      const datetime = this.eventDatetime(m);
      const isActual =
        m?.isPlanned === false ? true : m?.isPlanned === true ? false : null;
      const name = code ? CARGOAI_CODE_NAME[code] ?? code : null;
      return {
        event_code: code,
        event_name: name,
        normalized_status: code
          ? CARGOAI_CODE_STATUS[code] ?? 'unknown'
          : 'unknown',
        location: m?.eventLocation ?? m?.origin ?? null,
        datetime,
        raw_text: code ? `${code}${name && name !== code ? ` ${name}` : ''}` : null,
        raw_datetime: datetime,
        is_actual: isActual,
        timezone: null,
        timezone_confidence: datetime && /[+-]\d{2}:?\d{2}$/.test(datetime)
          ? 'source_provided'
          : 'unknown',
      };
    });

    // Chronological order; undated events (e.g. booking) sort first.
    events.sort((a, b) => this.ts(a.datetime) - this.ts(b.datetime));

    // Current status = latest event that actually happened (has a date).
    const actualDated = events.filter((e) => e.is_actual && e.datetime);
    const last = actualDated.length
      ? actualDated[actualDated.length - 1]
      : events[events.length - 1];

    // Trip-level dates derived from flight legs across all events.
    let etd: string | null = null;
    let eta: string | null = null;
    let actualDeparture: string | null = null;
    let actualArrival: string | null = null;
    const transit = new Set<string>();
    for (const m of rawEvents) {
      const f = m?.flight;
      if (f) {
        etd = this.earlier(etd, f.scheduledDeparture);
        actualDeparture = this.earlier(actualDeparture, f.actualDeparture);
        eta = this.later(eta, f.scheduledArrival);
        actualArrival = this.later(actualArrival, f.actualArrival);
        if (f.destination) transit.add(f.destination);
      }
      if (m?.eventLocation) transit.add(m.eventLocation);
    }

    const origin: string | null = shipment.origin ?? null;
    const destination: string | null = shipment.destination ?? null;
    [origin, destination].forEach((a) => a && transit.delete(a));

    r.found = true;
    r.events = events;
    r.current_status = last.normalized_status;
    r.raw_status = last.raw_text;
    r.etd = etd;
    r.eta = eta;
    r.actual_departure = actualDeparture;
    r.actual_arrival = actualArrival;
    r.origin = origin;
    r.destination = destination;
    r.transit_points = [...transit];
    return r;
  }

  /** Best-effort ISO datetime for an event. Never fabricates a value. */
  private eventDatetime(m: any): string | null {
    if (typeof m?.eventDate === 'string') return m.eventDate;
    const f = m?.flight;
    if (f) {
      if (m?.code === 'DEP' && f.actualDeparture) return f.actualDeparture;
      if ((m?.code === 'ARR' || m?.code === 'RCF') && f.actualArrival) return f.actualArrival;
      return f.actualDeparture ?? f.actualArrival ?? f.scheduledDeparture ?? null;
    }
    return m?.scheduledDepartureDate ?? null;
  }

  private ts(iso: string | null): number {
    if (!iso) return -Infinity; // undated → earliest
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : -Infinity;
  }

  private earlier(cur: string | null, next: any): string | null {
    if (typeof next !== 'string') return cur;
    if (!cur) return next;
    return Date.parse(next) < Date.parse(cur) ? next : cur;
  }

  private later(cur: string | null, next: any): string | null {
    if (typeof next !== 'string') return cur;
    if (!cur) return next;
    return Date.parse(next) > Date.parse(cur) ? next : cur;
  }
}

/** IATA air-cargo milestone codes → normalized status vocabulary (ТЗ §7). */
const CARGOAI_CODE_STATUS: Record<string, NormalizedStatus> = {
  FWB: 'created',
  BKG: 'booked',
  BKD: 'booked',
  BKC: 'booked',
  FOH: 'received',
  RCS: 'received',
  ACC: 'received',
  RCV: 'received',
  SCW: 'in_origin_terminal',
  MAN: 'in_origin_terminal',
  CLD: 'in_origin_terminal',
  PRE: 'in_origin_terminal',
  DEP: 'departed',
  TRA: 'in_transit',
  AST: 'in_transit',
  TFD: 'in_transit',
  RCT: 'in_transit',
  ARE: 'in_transit',
  ARR: 'arrived',
  ARV: 'arrived',
  RCF: 'arrived',
  CLC: 'customs',
  NFD: 'ready_for_pickup',
  PIC: 'ready_for_pickup',
  DLV: 'delivered',
};

/** Human-readable names for the milestone codes (for raw_status / display). */
const CARGOAI_CODE_NAME: Record<string, string> = {
  ACC: 'Accepted',
  AST: 'Assigned to another flight',
  ARR: 'Arrived',
  ARE: 'Arrival estimated',
  DLV: 'Delivered',
  DDL: 'Documents Delivered',
  RCV: 'Received',
  DEP: 'Departed',
  MAN: 'Manifested',
  BKC: 'Booking Confirmed',
  BKD: 'Booked',
  BKG: 'Booking Generated',
  RCS: 'Received from Shipper',
  RCF: 'Received from Flight',
  NFD: 'Consignee Notified',
  FOH: 'Freight on Hand',
  AWD: 'Documentation Delivered',
  CLD: 'Cargo Loaded',
  PRE: 'Shipment Prepared',
  ARV: 'Arrived',
  FWB: 'Electronic AWB',
  TRA: 'In Transit',
  AWR: 'Documents Received',
  TFD: 'Transferred',
  RCT: 'Received from other airline',
  SCW: 'Checked into Warehouse',
  CLC: 'Cleared by Customs',
  TPL: 'Temperature Log',
  PIC: 'Available for Pickup',
};
