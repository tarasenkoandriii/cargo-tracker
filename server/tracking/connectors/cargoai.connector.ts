import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import {
  ErrorCode,
  emptyTrackResult,
  ShipmentType,
  TrackingEvent,
  TrackResult,
} from '../models';
import {
  Connector,
  TrackContext,
  fetchWithTimeout,
  retry,
  TimeoutError,
} from './connector.interface';
import { NormalizerService } from '../normalizer/normalizer.service';

/**
 * CargoAI Track & Trace API connector for air cargo (ТЗ §5, §16).
 *
 * Used only when `CARGOAI_API_KEY` is configured (commercial access). Without
 * a key it returns a structured LOGIN_REQUIRED error rather than failing. The
 * request/response mapping below follows CargoAI's CargoCONNECT shape and is
 * the single place to adjust to the exact contract of your account.
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

    if (!config.cargoaiApiKey) {
      ctx.logger.add('query_cargoai', 'skipped', { reason: 'no_api_key' });
      r.error = {
        code: ErrorCode.LOGIN_REQUIRED,
        message: 'CargoAI API key not configured (set CARGOAI_API_KEY).',
        source: this.name,
      };
      return r;
    }

    const [prefix, serial] = ctx.normalizedNumber.split('-');
    const url = `${config.cargoaiBaseUrl}/tracking/v1/awb/${prefix}/${serial}`;
    r.url = url;

    let data: any;
    try {
      data = await retry(
        async () => {
          const res = await fetchWithTimeout(
            url,
            {
              headers: {
                accept: 'application/json',
                authorization: `Bearer ${config.cargoaiApiKey}`,
              },
            },
            config.timeoutMs,
          );
          if (res.status === 401 || res.status === 403) {
            const e: any = new Error('unauthorized');
            e.code = ErrorCode.LOGIN_REQUIRED;
            throw e;
          }
          if (res.status === 404) {
            const e: any = new Error('not found');
            e.code = ErrorCode.NOT_FOUND;
            throw e;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        config.retries,
        config.rateLimitDelayMs,
      );
    } catch (err: any) {
      ctx.logger.add('query_cargoai', 'error', { reason: String(err?.message ?? err) });
      r.error = {
        code:
          err?.code ??
          (err instanceof TimeoutError ? ErrorCode.TIMEOUT : ErrorCode.SOURCE_UNAVAILABLE),
        message: err?.message ?? 'CargoAI request failed',
        source: this.name,
      };
      return r;
    }

    ctx.logger.add('query_cargoai', 'success', {});
    return this.map(data, ctx, r);
  }

  /** Map a CargoAI payload to the internal TrackResult shape. */
  private map(data: any, ctx: TrackContext, r: TrackResult): TrackResult {
    const milestones: any[] = data?.milestones ?? data?.events ?? [];
    if (!Array.isArray(milestones) || milestones.length === 0) {
      r.error = { code: ErrorCode.NOT_FOUND, message: 'No events returned', source: this.name };
      return r;
    }
    const events: TrackingEvent[] = milestones.map((m) => ({
      event_code: m.code ?? m.statusCode ?? null,
      event_name: m.name ?? m.status ?? null,
      normalized_status: this.normalizer.normalize(m.name ?? m.status ?? '', ShipmentType.AIR),
      location: m.location ?? m.airport ?? null,
      datetime: m.datetime ?? m.timestamp ?? null,
      raw_text: m.description ?? m.name ?? null,
      raw_datetime: m.rawDatetime ?? null,
      is_actual: m.actual ?? null,
      timezone: m.timezone ?? null,
      timezone_confidence: m.timezone ? 'source_provided' : 'unknown',
    }));
    const last = events[events.length - 1];
    r.found = true;
    r.events = events;
    r.current_status = last.normalized_status;
    r.raw_status = last.raw_text;
    r.eta = data?.eta ?? null;
    r.etd = data?.etd ?? null;
    r.actual_departure = data?.actualDeparture ?? null;
    r.actual_arrival = data?.actualArrival ?? null;
    r.origin = data?.origin ?? null;
    r.destination = data?.destination ?? null;
    return r;
  }
}
