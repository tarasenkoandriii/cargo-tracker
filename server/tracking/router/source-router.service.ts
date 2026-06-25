import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import { ShipmentType } from '../models';
import { Connector } from '../connectors/connector.interface';
import { TrackTraceConnector } from '../connectors/track-trace.connector';
import { CarrierWebConnector } from '../connectors/carrier-web.connector';
import { CargoAiConnector } from '../connectors/cargoai.connector';
import { DemoConnector } from '../connectors/demo.connector';

/**
 * Chooses the ordered list of connectors to try for a shipment (ТЗ §10).
 *
 * Live order:
 *   air  → CargoAI (if key) → track-trace.com → carrier website (fallback)
 *   sea  → track-trace.com → carrier website (fallback)
 * Demo mode → the deterministic DemoConnector only.
 *
 * Note: when a CargoAI/RapidAPI key is present it is tried first for air, since
 * it is the reliable structured source; track-trace remains as a fallback (it
 * generally can't be scraped from a serverless host without a browser).
 *
 * Adding a new source = register its connector here; the pipeline is unchanged.
 */
@Injectable()
export class SourceRouter {
  constructor(
    private readonly trackTrace: TrackTraceConnector,
    private readonly carrierWeb: CarrierWebConnector,
    private readonly cargoai: CargoAiConnector,
    private readonly demo: DemoConnector,
  ) {}

  route(type: ShipmentType, demoMode: boolean): Connector[] {
    if (demoMode) return [this.demo];

    const chain: Connector[] = [];
    if (type === ShipmentType.AIR && (config.cargoaiApiKey || config.rapidapiKey)) {
      chain.push(this.cargoai);
    }
    chain.push(this.trackTrace);
    chain.push(this.carrierWeb);
    return chain.filter((c) => c.supports(type));
  }
}
