import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  emptyTrackResult,
  ShipmentType,
  TrackResult,
} from '../models';
import { Connector, TrackContext } from './connector.interface';

/**
 * Carrier website connector — TEMPLATE / extension point (ТЗ §10, §13.14).
 *
 * This shows the minimal contract for adding a per-carrier fallback (e.g.
 * Maersk, MSC, Emirates SkyCargo). Copy this file, implement `fetch` against
 * the specific carrier's public tracking endpoint, register it in the
 * SourceRouter, and it slots into the pipeline with no other changes.
 *
 * As shipped it is a no-op that returns a structured "not implemented" error,
 * so the router can safely include it as a fallback without breaking.
 */
@Injectable()
export class CarrierWebConnector implements Connector {
  readonly name = 'carrier_website';

  supports(type: ShipmentType): boolean {
    return type === ShipmentType.AIR || type === ShipmentType.SEA;
  }

  async fetch(ctx: TrackContext): Promise<TrackResult> {
    ctx.logger.add('query_carrier_website', 'skipped', { reason: 'template_not_implemented' });
    const r = emptyTrackResult();
    r.source_name = this.name;
    r.error = {
      code: ErrorCode.SOURCE_UNAVAILABLE,
      message:
        'Carrier-specific connector is a template and not implemented for this carrier.',
      source: this.name,
    };
    return r;
  }
}
